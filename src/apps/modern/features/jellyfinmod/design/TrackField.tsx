import React, { type FC, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import focusManager from 'components/focusManager';
import inputManager from 'scripts/inputManager';
import { getKeyName } from 'scripts/keyboardNavigation';
import { isBackKey } from '../shell/dpadModals';
import { Icon } from './Icon';

/**
 * Left/Right inside an open list: only the pending entry has a button (its X), walked from the entry; a choice row keeps the
 * focus (itself), so a TV remote never leaves the open list sideways.
 */
const sideStop = (row: HTMLElement, key: string) => {
    const stops = [row, ...Array.from(row.querySelectorAll<HTMLElement>('button.focusable'))];
    return stops[stops.indexOf(document.activeElement as HTMLElement) + (key === 'ArrowLeft' ? -1 : 1)] ?? (row.matches('.vrow') ? row : undefined);
};

/** ds2.js stripAt/seg: open lists are paper, inline on narrow screens, anchored to their cell otherwise. */
export const TrackField: FC<{ kind: 'v' | 'a' | 's'; name: string; value: ReactNode; enabled?: boolean; stacked: boolean;
    children?: ReactNode; onOpen?: () => void; onClose?: () => void; closeOnChoose?: boolean; title?: string; extra?: string }> = ({ kind, name, value, enabled = true, stacked, children, onOpen, onClose, closeOnChoose = true, title, extra }) => {
    const [open, setOpen] = useState(false);
    const [focus, setFocus] = useState(false);
    const trigger = useRef<HTMLDivElement>(null);
    const list = useRef<HTMLDivElement>(null);
    const focused = useRef<{ source?: string | null; track?: string | null; control?: string }>();
    const close = useCallback(() => {
        setOpen(false);
        onClose?.();
    }, [onClose]);

    useEffect(() => {
        if (!open) return;
        const key = (event: KeyboardEvent) => {
            if (!isBackKey(getKeyName(event)) || event.defaultPrevented || document.querySelector('.dialogContainer .dialog, .historyportal')) return;
            event.preventDefault();
            event.stopPropagation();
            close();
            trigger.current?.focus();
        };
        const command = (event: Event) => {
            if ((event as CustomEvent<{ command?: string }>).detail?.command !== 'back' || event.defaultPrevented || document.querySelector('.dialogContainer .dialog, .historyportal')) return;
            event.preventDefault();
            close();
            trigger.current?.focus();
        };
        const outside = (event: Event) => {
            if ((event.target as Element).closest('.historyportal')) return;
            if (!trigger.current?.contains(event.target as Node) && !list.current?.contains(event.target as Node)) close();
        };
        window.addEventListener('keydown', key, true);
        document.addEventListener('pointerdown', outside);
        inputManager.on(window, command);
        return () => {
            window.removeEventListener('keydown', key, true);
            document.removeEventListener('pointerdown', outside);
            inputManager.off(window, command);
        };
    }, [close, open]);
    useLayoutEffect(() => {
        if (!open || !list.current) return;
        const selected = list.current.querySelector<HTMLElement>('[aria-selected=true]') ?? list.current.querySelector<HTMLElement>('.focusable');
        if (selected) focusManager.focus(selected);
    }, [open]);
    useLayoutEffect(() => {
        if (!open || !focused.current || document.activeElement !== document.body) return;
        const was = focused.current;
        const rows = Array.from(list.current?.querySelectorAll<HTMLElement>('.vrow') ?? []);
        const row = rows.find(node => was.source ? node.dataset.jfmodMediaSourceId === was.source : node.dataset.jfmodTrack === was.track);
        const action = was.control && (row ?? list.current)?.querySelector<HTMLElement>(`[${was.control}]`);
        focusManager.focus(action || row || trigger.current);
    });
    const choose = (event: React.MouseEvent) => {
        event.stopPropagation();
        if (closeOnChoose && (event.target as HTMLElement).closest('[data-ds-choose]')) {
            close();
            trigger.current?.focus();
        }
    };
    // A dropdown over the page under its own field, stacked or not; only the phone opens it in the card (D197), right
    // under its field (`data-list` orders it there, since a portal appends it after the strip's last field).
    const inCard = stacked && document.documentElement.classList.contains('layout-mobile');
    const sheet = open && <div ref={list} className='vlist focuscontainer-y' data-list={kind} role='listbox' tabIndex={-1} aria-label={name} onClick={choose}
        onFocusCapture={event => {
            const target = event.target as HTMLElement;
            const row = target.closest<HTMLElement>('.vrow');
            focused.current = { source: row?.dataset.jfmodMediaSourceId, track: row?.dataset.jfmodTrack,
                control: target.hasAttribute('data-jfmod-pending-remove') ? 'data-jfmod-pending-remove' : undefined };
        }}
        onKeyDown={event => {
            const key = getKeyName(event.nativeEvent);
            const row = (event.target as HTMLElement).closest<HTMLElement>('.vrow, .pend');
            if (!row) return;
            let next: HTMLElement | null | undefined;
            if (key === 'ArrowLeft' || key === 'ArrowRight') next = sideStop(row, key);
            if (key === 'ArrowUp' || key === 'ArrowDown') {
                const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('.vrow, .pend'));
                const destination = rows[rows.indexOf(row) + (key === 'ArrowUp' ? -1 : 1)];
                next = destination?.matches('.vrow') ? destination : destination?.querySelector<HTMLElement>('button.focusable');
                if (!next && key === 'ArrowUp' && row === rows[0]) next = trigger.current;
            }
            if (!next) return;
            event.preventDefault();
            event.stopPropagation();
            focusManager.focus(next);
            next.scrollIntoView({ block: 'nearest' });
        }}>{children}</div>;
    const toggle = () => {
        if (enabled) {
            if (open) {
                close();
            } else {
                onOpen?.();
                setOpen(true);
            }
        }
    };

    return <><div ref={trigger} role={enabled ? 'button' : undefined} tabIndex={enabled ? 0 : undefined}
        className={'seg ' + kind + ' glassy' + (open || focus ? ' on' : '') + (enabled ? ' focusable' : '')}
        title={title} aria-label={name} aria-haspopup={enabled ? 'listbox' : undefined} aria-expanded={enabled ? open : undefined} data-jfmod-track-field={name}
        onFocus={event => { if (event.target === event.currentTarget) setFocus(true); }} onBlur={() => setFocus(false)}
        onClick={event => { if (!list.current?.contains(event.target as Node)) toggle(); }}
        onKeyDown={event => {
            if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) {
                event.preventDefault();
                toggle();
            }
        }}>
        <span className='cap'>{name}{extra && <span className='x'>{' · ' + extra}</span>}</span><span className='val'>{value}{enabled && <Icon name={open ? 'up' : 'down'} className='chev end' />}</span>
        {!inCard && sheet}
    </div>{inCard && sheet}</>;
};

export const ChooseRow: FC<{ selected: boolean; onChoose: () => void; title?: string; children: ReactNode; sourceId?: string; trackValue?: string }> = ({ selected, onChoose, title, children, sourceId, trackValue }) =>
    <div className={'vrow focusable' + (selected ? ' sel' : '')} tabIndex={0} role='option' aria-selected={selected} title={title}
        data-jfmod-track={trackValue} data-ds-choose='' data-jfmod-media-source-id={sourceId} onClick={onChoose}
        onKeyDown={event => {
            if (event.key === 'Enter' && event.target === event.currentTarget) {
                event.preventDefault();
                event.currentTarget.click();
            }
        }}
        onFocus={event => event.currentTarget.classList.add('foc')} onBlur={event => event.currentTarget.classList.remove('foc')}>{children}</div>;
