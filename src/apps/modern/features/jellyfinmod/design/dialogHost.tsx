import React, { type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import focusManager from 'components/focusManager';
import layoutManager from 'components/layoutManager';
import { getKeyName } from 'scripts/keyboardNavigation';
import { isBackKey } from '../shell/dpadModals';
import { Root } from './Root';

/** The route scope is removed before Dashboard/settings/setup paints. */
export const hasDesignPage = () => {
    const html = document.documentElement;
    // The legacy TV player hides the bar (the page's DS root); its dialogs still belong to the signed-in user shell.
    return html.classList.contains('jfmod-chrome') && (!!document.querySelector('.jfds') || html.classList.contains('jfmod-chromePlayer'));
};

/** A nested field list consumes Back before its dialog; only the top modal owns other keys. */
export const isTopDialog = (host: HTMLElement) => {
    const opened = document.querySelectorAll('.dialogContainer > .opened');
    return opened[opened.length - 1] === host;
};

/** Keep dialogHelper's host, history, backdrop and focus scope;
replace only its contents. */
export const mountDialog = (host: HTMLElement, children: ReactNode, close: () => void, menu = false) => {
    host.className = 'focuscontainer hide jfmod-designDialogHost';
    host.dataset.designDialog = 'true';
    host.style.animation = 'none';
    const root = createRoot(host);
    const previous = document.activeElement as HTMLElement | null;
    let closing = false;
    const key = (event: KeyboardEvent) => {
        if (event.defaultPrevented || closing || !isTopDialog(host)) return;
        const name = getKeyName(event);
        if (isBackKey(name)) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            close();
        } else if (menu && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(name)) {
            const items = focusManager.getFocusableElements(host);
            const step = name === 'ArrowUp' || name === 'ArrowLeft' ? -1 : 1;
            const index = items.indexOf(document.activeElement as HTMLElement);
            const next = items[(index + step + items.length) % items.length];
            if (next) {
                event.preventDefault();
                event.stopPropagation();
                focusManager.focus(next);
                next.scrollIntoView({ block: 'nearest' });
            }
        }
    };
    flushSync(() => root.render(<Root className={'dialogportal' + (menu ? ' sheetportal' : '')}>{children}</Root>));
    host.addEventListener('open', () => {
        document.addEventListener('keydown', key);
    }, { once: true });
    host.addEventListener('closing', () => {
        closing = true;
    }, { once: true });
    host.addEventListener('close', () => {
        document.removeEventListener('keydown', key);
        root.unmount();
        if (previous?.isConnected) focusManager.focus(previous);
        // The opener can go while the dialog is open (a grab replaces Get a Release): the D-pad must not fall to the top bar.
        else if (layoutManager.tv) focusManager.autoFocus(document.querySelector('.mainAnimatedPage:not(.hide)'));
    }, { once: true });
};
