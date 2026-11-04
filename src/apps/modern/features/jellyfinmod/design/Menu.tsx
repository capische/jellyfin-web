import React, { type FC, type PropsWithChildren, useContext, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import focusManager from 'components/focusManager';
import { isBackKey } from '../shell/dpadModals';
import { getKeyName } from 'scripts/keyboardNavigation';
import { DesignContext, Root } from './Root';

/** Mockup pmenu, with outside dismissal and the app's focus manager. */
export const Menu: FC<PropsWithChildren<{ close: () => void; label: string; id?: string }>> = ({ children, close, label, id }) => {
    const ref = useRef<HTMLDivElement>(null);
    const phone = useContext(DesignContext) === 'phone';
    useLayoutEffect(() => {
        const previous = document.activeElement as HTMLElement | null;
        const outside = (event: Event) => {
            if (!ref.current?.contains(event.target as Node) && !previous?.contains(event.target as Node)) close();
        };
        const key = (event: KeyboardEvent) => {
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
                close();
            }
        };
        ref.current?.querySelectorAll('button.mi, a.mi').forEach(row => {
            row.setAttribute('role', 'menuitem');
        });
        const first = ref.current && focusManager.getFocusableElements(ref.current, 1)[0];
        if (first) focusManager.focus(first);
        document.addEventListener('pointerdown', outside);
        document.addEventListener('keydown', key, true);
        return () => {
            document.removeEventListener('pointerdown', outside);
            document.removeEventListener('keydown', key, true);
            if (previous?.isConnected) focusManager.focus(previous);
        };
    }, [close]);
    const menu = <div ref={ref} className={'pmenu open focuscontainer-y' + (phone ? ' sheet bottom' : '')} id={id} role='menu' aria-label={label}>
        {phone && <span className='sgrab' />}{children}</div>;
    return phone ? createPortal(<Root className='menuportal'><div className='sdim' />{menu}</Root>, document.body) : menu;
};
