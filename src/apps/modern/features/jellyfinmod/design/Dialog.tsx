import React, { type FC, type PropsWithChildren, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import dialogHelper from 'components/dialogHelper/dialogHelper';
import focusManager from 'components/focusManager';
import { getKeyName } from 'scripts/keyboardNavigation';
import { isBackKey } from '../shell/dpadModals';
import { Root } from './Root';
import { DialogContent } from './Controls';
import { isTopDialog } from './dialogHost';

/** React callers use the same history/back/focus lifecycle as imperative dialog callers. */
export const Dialog: FC<PropsWithChildren<{ title: string; close: () => void; narrow?: boolean; className?: string }>> = ({ children, title, close, narrow, className }) => {
    const onClose = useRef(close);
    onClose.current = close;
    const [host] = useState<HTMLElement>(() => {
        const element = dialogHelper.createDialog({ removeOnClose: true, scrollY: false });
        element.className = 'focuscontainer hide jfmod-designDialogHost';
        element.dataset.designDialog = 'true';
        element.style.animation = 'none';
        return element;
    });
    useLayoutEffect(() => {
        const previous = document.activeElement as HTMLElement | null;
        const key = (event: KeyboardEvent) => {
            if (!event.defaultPrevented && isTopDialog(host) && isBackKey(getKeyName(event))) {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                dialogHelper.close(host);
            }
        };
        document.addEventListener('keydown', key);
        void dialogHelper.open(host).then(() => {
            if (previous?.isConnected) focusManager.focus(previous);
            onClose.current();
        });
        return () => {
            document.removeEventListener('keydown', key);
            if (host.isConnected) dialogHelper.close(host);
        };
    }, [host]);
    return createPortal(<Root className='dialogportal'><DialogContent title={title} narrow={narrow} close={() => dialogHelper.close(host)} className={className}>
        {children}</DialogContent></Root>, host);
};
