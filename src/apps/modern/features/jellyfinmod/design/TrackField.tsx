import React, { type FC, type ReactNode, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import focusManager from 'components/focusManager';
import inputManager from 'scripts/inputManager';
import { getKeyName } from 'scripts/keyboardNavigation';
import { isBackKey } from '../shell/dpadModals';
import { Icon, type IconName } from './Icon';
import { DesignContext } from './Root';

type TrackKind = 'v' | 'a' | 's';
interface ChooserTab { name: string; kind: string }

const KIND_ICON: Record<TrackKind, IconName> = { v: 'display', a: 'audio', s: 'subs' };
/** The strip's other choosable fields, in Video, Audio, Subtitles order: the computer chooser's tabs. */
const chooserTabs = (trigger: HTMLElement | null): ChooserTab[] => Array.from(trigger?.parentElement?.querySelectorAll<HTMLElement>('.seg.focusable[data-jfmod-kind]') ?? [])
    .map(field => ({ name: field.dataset.jfmodTrackField ?? '', kind: field.dataset.jfmodKind ?? '' }))
    .sort((a, b) => 'vas'.indexOf(a.kind) - 'vas'.indexOf(b.kind));

/**
 * Left/Right inside an open list: only the pending entry has a button (its X), walked from the entry; a choice row keeps the
 * focus (itself), so a TV remote never leaves the open list sideways.
 */
const sideStop = (row: HTMLElement, key: string) => {
    const stops = [row, ...Array.from(row.querySelectorAll<HTMLElement>('button.focusable'))];
    return stops[stops.indexOf(document.activeElement as HTMLElement) + (key === 'ArrowLeft' ? -1 : 1)] ?? (row.matches('.vrow') ? row : undefined);
};

/** The open list's arrow keys: Up and Down walk its rows (Up from the first returns to the field, or the chooser's tab); Left and
 * Right walk a pending entry's X, and in the computer's chooser they switch to the next tab. */
type Chooser = { kind: string; tabs: ChooserTab[]; switchTo: (name: string) => void } | null;

/** Left and Right on a row of the computer's chooser open the tab beside this one, as the mockup's keys do. */
const switchTab = (event: React.KeyboardEvent<HTMLElement>, key: string, chooser: Chooser) => {
    if (!chooser || (key !== 'ArrowLeft' && key !== 'ArrowRight')) return false;
    const at = chooser.tabs.findIndex(tab => tab.kind === chooser.kind);
    const to = chooser.tabs[(at + (key === 'ArrowLeft' ? -1 : 1) + chooser.tabs.length) % chooser.tabs.length];
    event.preventDefault();
    event.stopPropagation();
    if (to && to.kind !== chooser.kind) chooser.switchTo(to.name);
    return true;
};

/** Up and Down walk the rows; Up from the first returns to the field, or to the chooser's open tab. */
const verticalStop = (list: HTMLElement, row: HTMLElement, key: string, back: HTMLElement | null) => {
    const rows = Array.from(list.querySelectorAll<HTMLElement>('.vrow, .pend'));
    const destination = rows[rows.indexOf(row) + (key === 'ArrowUp' ? -1 : 1)];
    const next = destination?.matches('.vrow') ? destination : destination?.querySelector<HTMLElement>('button.focusable');
    return next ?? (key === 'ArrowUp' && row === rows[0] ? back : undefined);
};

/** Reveal a chooser row in its own list without scrolling the page or the clipped artwork behind it. */
const focusInChooser = (element: HTMLElement, chooser: HTMLElement) => {
    element.focus({ preventScroll: true });
    const scroller = chooser.querySelector<HTMLElement>('.clist');
    if (!scroller?.contains(element)) return;
    const row = element.getBoundingClientRect();
    const box = scroller.getBoundingClientRect();
    if (row.top < box.top) scroller.scrollTop -= box.top - row.top;
    else if (row.bottom > box.bottom) scroller.scrollTop += row.bottom - box.bottom;
};

/** The open list's arrow keys: rows up and down, a pending entry's X sideways, the chooser's tabs sideways from a row. */
const walkList = (event: React.KeyboardEvent<HTMLElement>, chooser: Chooser, trigger: HTMLElement | null) => {
    const key = getKeyName(event.nativeEvent);
    const row = (event.target as HTMLElement).closest<HTMLElement>('.vrow, .pend');
    if (!row || (row.matches('.vrow') && switchTab(event, key, chooser))) return;
    let next: HTMLElement | null | undefined;
    if (key === 'ArrowLeft' || key === 'ArrowRight') next = sideStop(row, key);
    if (key === 'ArrowUp' || key === 'ArrowDown') {
        next = verticalStop(event.currentTarget, row, key, chooser ? event.currentTarget.querySelector<HTMLElement>('.ctab.on') : trigger);
    }
    if (!next) return;
    event.preventDefault();
    event.stopPropagation();
    if (chooser) {
        focusInChooser(next, event.currentTarget);
    } else {
        focusManager.focus(next);
        next.scrollIntoView({ block: 'nearest' });
    }
};

type TabPlace = { left: number; width: number }[] | null;

/**
 * Each tab under its own control (the user 2026-11-10): while the controls share one line, a tab takes its control's left edge and
 * width and the chooser runs from the first tab's control to Close after the last, its edge moved out by its inset so the tabs line
 * up; otherwise (Video on its own line, a 1280 px window) the tabs stay a row.
 */
const useTabsUnderControls = (head: React.RefObject<HTMLDivElement>, tabs: ChooserTab[]): TabPlace => {
    const [place, setPlace] = useState<TabPlace>(null);
    const measure = useCallback(() => {
        const chooser = head.current?.closest<HTMLElement>('.vlist.chooser');
        const strip = chooser?.parentElement;
        const close = head.current?.querySelector<HTMLElement>('.cclose');
        if (!chooser || !strip || !close) return;
        const boxes = tabs.map(tab => strip.querySelector<HTMLElement>(`.seg[data-jfmod-track-field="${tab.name}"]`)?.getBoundingClientRect());
        const first = boxes[0];
        const oneLine = !!first && boxes.every(box => box && Math.abs(box.top - first.top) < 1);
        chooser.classList.toggle('jfmod-tabsUnder', oneLine);
        if (!oneLine) {
            chooser.style.removeProperty('width');
            chooser.style.removeProperty('left');
            setPlace(null);
            return;
        }
        // The chooser starts at the first tab's control (the user 2026-11-10: a plain Video has no tab, so no gap under it).
        const strip0 = strip.getBoundingClientRect().left;
        const origin = Math.min(...boxes.map(box => (box as DOMRect).left));
        const style = getComputedStyle(chooser);
        const inset = parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth);
        const gap = parseFloat(getComputedStyle(head.current as HTMLElement).columnGap) || 0;
        const right = Math.max(...boxes.map(box => (box as DOMRect).right)) - origin;
        chooser.style.left = origin - strip0 - inset + 'px';
        chooser.style.width = right + gap + close.getBoundingClientRect().width + 2 * inset + 'px';
        setPlace(boxes.map(box => ({ left: (box as DOMRect).left - origin, width: (box as DOMRect).width })));
    }, [head, tabs]);
    useLayoutEffect(measure, [measure]);
    useEffect(() => {
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
    }, [measure]);
    return place;
};

/** The computer's one chooser around a field's rows: a tab per choosable field and Close, then the rows (no foot line, the user 2026-11-09). */
const ChooserFrame: FC<{ kind: TrackKind; name: string; tabs: ChooserTab[]; onTab: (name: string) => void; onClose: () => void; children?: ReactNode }> = ({ kind, name, tabs, onTab, onClose, children }) => {
    const head = useRef<HTMLDivElement>(null);
    const place = useTabsUnderControls(head, tabs);
    return <>
        <div ref={head} className='chead'>
            <div className='ctabs' role='group' aria-label='Choose what to change'>{tabs.map((tab, index) => <button key={tab.kind} type='button'
                className={'ctab' + (tab.kind === kind ? ' on' : '')} aria-pressed={tab.kind === kind}
                style={place?.[index] && { left: place[index].left, width: place[index].width }}
                onClick={() => { if (tab.kind !== kind) onTab(tab.name); }}>{tab.name}</button>)}</div>
            <button type='button' className='cclose' aria-label='Close' onClick={onClose}><Icon name='close' /></button>
        </div>
        <ScrollRail name={name}>{children}</ScrollRail>
    </>;
};

/**
 * The list and its rail (the user 2026-11-09, B): while the rows do not fit, an s0 rail at the list's right edge with a chevron at
 * each end (shown while that end has more rows) and a thumb whose length and place are the visible part's; no native scroll bar.
 */
const ScrollRail: FC<{ name: string; children?: ReactNode }> = ({ name, children }) => {
    const list = useRef<HTMLDivElement>(null);
    const [view, setView] = useState({ top: 0, size: 1 });
    const measure = useCallback(() => {
        const node = list.current;
        if (!node) return;
        setView({ top: node.scrollTop / node.scrollHeight, size: node.clientHeight / node.scrollHeight });
    }, []);
    // The rows change with the tab and the selection; measure after each render of them, and when the window resizes.
    useLayoutEffect(measure, [children, measure]);
    useEffect(() => {
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
    }, [measure]);
    const fits = view.size > 0.999;
    const up = !fits && view.top > 0.001;
    const down = !fits && view.top + view.size < 0.999;
    const label = name.toLowerCase();
    return <div className={'cbox' + (fits ? '' : ' scrolls')}>
        <div ref={list} className='clist' role='listbox' aria-label={name} onScroll={measure}>{children}</div>
        {!fits && <div className='crail' role='img' aria-label={[up && `More ${label} above`, down && `More ${label} below`].filter(Boolean).join(', ')}>
            <Icon name='down' className={'up' + (up ? '' : ' off')} />
            <span className='ctrack'><span className='cthumb' style={{ top: view.top * 100 + '%', height: view.size * 100 + '%' }} /></span>
            <Icon name='down' className={down ? undefined : 'off'} />
        </div>}
    </div>;
};

/** A computer's quiet control (ds.t19): the kind's icon, the value, a chevron when there is a choice; plain and no focus stop without. */
interface QuietFieldProps {
    kind: TrackKind;
    name: string;
    enabled: boolean;
    open: boolean;
    onToggle: () => void;
    onKeyDown: (event: React.KeyboardEvent) => void;
    children: ReactNode;
}

const QuietField = React.forwardRef<HTMLDivElement, QuietFieldProps>(({ kind, name, enabled, open, onToggle, onKeyDown, children }, ref) => {
    if (!enabled) {
        return <div ref={ref} className={'seg ' + kind} data-jfmod-track-field={name} data-jfmod-kind={kind}>
            <Icon name={KIND_ICON[kind]} className='kicon' /><span className='val'>{children}</span>
        </div>;
    }
    return <div ref={ref} role='button' tabIndex={0} aria-haspopup='listbox' aria-expanded={open} aria-label={name} className={'seg ' + kind + ' focusable'}
        data-jfmod-track-field={name} data-jfmod-kind={kind} onClick={onToggle} onKeyDown={onKeyDown}>
        <Icon name={KIND_ICON[kind]} className='kicon' /><span className='val'>{children}</span><Icon name='down' className='chev' />
    </div>;
});
QuietField.displayName = 'QuietField';

/**
 * ds2.js stripAt/seg: open lists are paper, inline on narrow screens, anchored to their cell otherwise. On a computer (ds.t19, the
 * user 2026-11-08) the field is a quiet control (its kind's icon, the value, a chevron) and its list opens in one paper chooser
 * under the strip, with a tab per choosable field: a tab closes this list and opens that field's, so each field keeps its own rows.
 */
export const TrackField: FC<{ kind: TrackKind; name: string; value: ReactNode; enabled?: boolean; stacked: boolean;
    children?: ReactNode; onOpen?: () => void; onClose?: () => void; closeOnChoose?: boolean; title?: string; extra?: string;
    /** The closed value on a computer, where no caption names the field (`Subtitles Off`); `value` otherwise. */
    quietValue?: ReactNode }> = ({ kind, name, value, enabled = true, stacked, children, onOpen, onClose, closeOnChoose = true, title, extra, quietValue }) => {
    const quiet = useContext(DesignContext) === 'computer';
    const [open, setOpen] = useState(false);
    const [tabs, setTabs] = useState<ChooserTab[]>([]);
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
        if (selected) {
            if (quiet) focusInChooser(selected, list.current);
            else focusManager.focus(selected);
        }
    }, [open, quiet]);
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
    const switchTo = (other: string) => {
        close();
        trigger.current?.parentElement?.querySelector<HTMLElement>(`.seg[data-jfmod-track-field="${other}"]`)?.click();
    };
    const back = () => {
        close();
        trigger.current?.focus();
    };
    const sheet = open && <div ref={list} className={'vlist focuscontainer-y' + (quiet ? ' chooser' : '')} data-list={kind}
        role={quiet ? undefined : 'listbox'} aria-label={quiet ? undefined : name} tabIndex={-1} onClick={choose}
        onFocusCapture={event => {
            const target = event.target as HTMLElement;
            const row = target.closest<HTMLElement>('.vrow');
            focused.current = { source: row?.dataset.jfmodMediaSourceId, track: row?.dataset.jfmodTrack,
                control: target.hasAttribute('data-jfmod-pending-remove') ? 'data-jfmod-pending-remove' : undefined };
        }}
        onKeyDown={event => walkList(event, quiet ? { kind, tabs, switchTo } : null, trigger.current)}>{quiet ? <ChooserFrame kind={kind} name={name} tabs={tabs} onTab={switchTo} onClose={back}>{children}</ChooserFrame> : children}</div>;
    const toggle = () => {
        if (!enabled) return;
        if (open) {
            close();
            return;
        }
        // The computer chooser's tabs (only its quiet fields carry a kind, so elsewhere this is empty).
        setTabs(chooserTabs(trigger.current));
        onOpen?.();
        setOpen(true);
    };
    const keys = (event: React.KeyboardEvent) => {
        if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) {
            event.preventDefault();
            toggle();
        }
    };
    const role = enabled ? 'button' : undefined;
    const control = enabled ? { tabIndex: 0, 'aria-haspopup': 'listbox' as const, 'aria-expanded': open } : {};
    if (quiet) {
        return <><QuietField ref={trigger} kind={kind} name={name} enabled={enabled} open={open} onToggle={toggle}
            onKeyDown={keys}>{quietValue ?? value}</QuietField>{sheet}</>;
    }

    return <><div ref={trigger} role={role} {...control}
        className={'seg ' + kind + ' glassy' + (open || focus ? ' on' : '') + (enabled ? ' focusable' : '')}
        title={title} aria-label={name} data-jfmod-track-field={name}
        onFocus={event => { if (event.target === event.currentTarget) setFocus(true); }} onBlur={() => setFocus(false)}
        onClick={event => { if (!list.current?.contains(event.target as Node)) toggle(); }}
        onKeyDown={keys}>
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
