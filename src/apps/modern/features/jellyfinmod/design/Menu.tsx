import React, { type FC, type PropsWithChildren, useContext, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import focusManager from 'components/focusManager';
import { isBackKey } from '../shell/dpadModals';
import { getKeyName } from 'scripts/keyboardNavigation';
import { DesignContext, Root } from './Root';
import { menuPosition } from './menuPosition';

const layers: Array<HTMLElement | null> = [];

/** Mockup pmenu, with outside dismissal and the app's focus manager. */
export const Menu: FC<PropsWithChildren<{ close: () => void; label: string; id?: string; anchored?: boolean; anchor?: HTMLElement; className?: string; surface?: string }>> = ({ children, close, label, id, anchored, anchor, className = '', surface = 'pmenu' }) => {
    const ref = useRef<HTMLDivElement>(null);
    const device = useContext(DesignContext);
    const phone = device === 'phone' && !anchored;
    useLayoutEffect(() => {
        const layer = ref.current;
        if (layer) layers.push(layer);
        const focused = document.activeElement;
        const previous = anchor ?? (focused instanceof HTMLElement && focused !== document.body && focused !== document.documentElement && focused.matches('button, a, input, select, textarea, [tabindex]') ? focused : null);
        let closing = false;
        let timer: ReturnType<typeof setTimeout>;
        const dismiss = () => {
            if (closing) return;
            closing = true;
            ref.current?.classList.remove('open');
            const durations = ref.current ? getComputedStyle(ref.current).transitionDuration.split(',') : [];
            timer = setTimeout(close, Math.max(0, ...durations.map(value => parseFloat(value) * 1000)));
        };
        ref.current?.getBoundingClientRect();
        ref.current?.classList.add('open');
        const outside = (event: Event) => {
            if (layers.slice(-1)[0] !== layer) return;
            if (!ref.current?.contains(event.target as Node) && !previous?.contains(event.target as Node)) dismiss();
        };
        const key = (event: KeyboardEvent) => {
            if (event.defaultPrevented || closing || layers.slice(-1)[0] !== layer) return;
            const name = getKeyName(event);
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(name) && ref.current) {
                const items = focusManager.getFocusableElements(ref.current);
                const step = name === 'ArrowUp' || name === 'ArrowLeft' ? -1 : 1;
                const index = items.indexOf(document.activeElement as HTMLElement);
                const next = items[(index + step + items.length) % items.length];
                if (next) {
                    event.preventDefault();
                    event.stopPropagation();
                    focusManager.focus(next);
                    next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                }
            }
            if (isBackKey(name)) {
                event.preventDefault();
                event.stopPropagation();
                dismiss();
            }
        };
        ref.current?.querySelectorAll('button.mi, a.mi').forEach(row => {
            if (!row.hasAttribute('role')) row.setAttribute('role', 'menuitem');
        });
        const place = () => {
            if (!anchor || phone || !ref.current) return;
            const at = menuPosition(anchor, ref.current);
            const phoneSurface = device === 'phone' && (surface === 'ipop' || className === 'srcmenu');
            Object.assign(ref.current.style, { position: 'fixed', top: at.top + 'px', left: phoneSurface ? '' : at.left + 'px' });
        };
        place();
        window.addEventListener('resize', place);
        if (ref.current) focusManager.autoFocus(ref.current);
        document.addEventListener('pointerdown', outside);
        document.addEventListener('keydown', key, true);
        return () => {
            if (layer) layers.splice(layers.indexOf(layer), 1);
            window.removeEventListener('resize', place);
            document.removeEventListener('pointerdown', outside);
            document.removeEventListener('keydown', key, true);
            clearTimeout(timer);
            if (previous?.isConnected) focusManager.focus(previous);
        };
    }, [close, phone, anchor, device, surface, className]);
    const menu = <div ref={ref} className={surface + ' ' + className + ' focuscontainer-y' + (phone ? ' sheet bottom msheet' : ' mn from-top')} id={id} role='menu' aria-label={label}>
        {phone && <span className='sgrab' />}{children}</div>;
    if (phone) return createPortal(<Root className='menuportal phonesheet'><div className='sdim' />{menu}</Root>, document.body);
    return anchor ? createPortal(<Root className='menuportal'>{menu}</Root>, document.body) : menu;
};
