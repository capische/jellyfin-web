import React, { type FC, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import layoutManager from 'components/layoutManager';
import inputManager from 'scripts/inputManager';

import { formatValue, formatVotes, isKnownScale, provenance, ratingName, SOURCE_LONG, tooltipLines } from '../constants/ratings';
import type { Rating, RatingSource } from '../types/ratings';
import RatingIcon from './RatingIcon';
import './ratings.scss';

interface RatingsGroupProps {
    /** The title's ratings; undefined while unknown. */
    ratings: Rating[] | undefined;
    /** The sources ticked, in their order: the row shows those among IMDb, Rotten Tomatoes and Trakt; the popup shows all of them. */
    sources: RatingSource[];
    /** Whether the answer (or the decision that there is none) has arrived. */
    ready: boolean;
    /** Whether the group may exist at all here (a movie or series, ratings on, a plugin with ratings); undefined while unknown. */
    wanted: boolean | undefined;
    /** The stock star this page shows in place of IMDb, when it is not upstream's (the file-less page's own TMDB star). */
    ownStar?: boolean;
}

/** The sources the row shows, in the row's order (IMDb where the stock star was, Rotten Tomatoes where the tomato was, Trakt). */
const INLINE_SOURCES: RatingSource[] = ['imdb', 'tomatoes_critic', 'tomatoes_audience', 'trakt'];

/** The widest each inline value can be, for the space reserved before the answer arrives. */
const STAND_IN: Rating[] = [
    { source: 'imdb', value: 10, scale: 'ten', provider: 'mdblist', stale: false },
    { source: 'tomatoes_critic', value: 100, scale: 'percent', provider: 'mdblist', stale: false },
    { source: 'tomatoes_audience', value: 100, scale: 'percent', provider: 'mdblist', stale: false },
    { source: 'trakt', value: 100, scale: 'percent', provider: 'mdblist', stale: false }
];

/**
 * When none of the row's sources is ticked, the row shows the first ticked rating the title has, so the popup stays reachable;
 * the space reserved for it is the widest of the ticked others at their longest values (laid out on top of each other).
 */
const FALLBACK_STAND_INS: Rating[] = [
    { source: 'tmdb', value: 100, scale: 'percent', provider: 'mdblist', stale: false },
    { source: 'metacritic', value: 100, scale: 'percent', provider: 'mdblist', stale: false },
    { source: 'metacritic_user', value: 10, scale: 'ten', provider: 'mdblist', stale: false },
    { source: 'letterboxd', value: 5, scale: 'five', provider: 'mdblist', stale: false },
    { source: 'rogerebert', value: 4, scale: 'four', provider: 'mdblist', stale: false }
];

/** The reserve's key when it was measured for the fallback (any one of the other sources). */
const FALLBACK_KEY = 'fallback';

/** Whether focus already sits after `node` in the page, where a change above it would move it. */
const focusIsPast = (node: Element | null | undefined) => {
    const active = document.activeElement;
    if (!node || !active || active === document.body || !active.isConnected || node.contains(active)) return false;
    return (node.compareDocumentPosition(active) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
};

/**
 * What shows in the row: IMDb, Rotten Tomatoes critics and audience, Trakt, in the row's order; when none of them has a value,
 * the first rating there is, if the space for one was reserved.
 */
const inlineOf = (shown: Rating[], fallback: boolean) => {
    const inline = INLINE_SOURCES.map(source => shown.find(rating => rating.source === source)).filter((rating): rating is Rating => !!rating);
    return inline.length || !fallback ? inline : shown.slice(0, 1);
};

/** What a list shows, as a comparable key: a new answer with the same key changes nothing on screen. */
const keyOf = (list: Rating[]) => list.map(rating => [rating.source, rating.value, rating.votes ?? '', rating.fetchedAt ?? '', rating.stale].join(':')).join('|');

/**
 * What may show at all: the sources ticked (the user's own choice, else the server's default; user decision 9), in their
 * order. A source not ticked appears nowhere — not in the row, not in the popup.
 */
const enabledOf = (all: Rating[], sources: RatingSource[]) =>
    sources.map(source => all.find(rating => rating.source === source)).filter((rating): rating is Rating => !!rating);

/** One inline rating: its mark and its value. */
const Item: FC<{ rating: Rating }> = ({ rating }) => <span className={'jfmod-groupItem' + (rating.stale ? ' jfmod-groupItem-stale' : '')}
    data-jfmod-rating={rating.source}>
    <RatingIcon rating={rating} />
    <span className='jfmod-groupValue'>{formatValue(rating)}</span>
</span>;

/**
 * The row's ratings, each with its own mark (Rotten Tomatoes critics' tomato and audience's popcorn apart); the fallback's
 * stand-ins stacked, so the space is the widest one's.
 */
const RowItems: FC<{ list: Rating[]; stack: boolean }> = ({ list, stack }) => {
    const items = list.map(rating => <Item key={rating.source} rating={rating} />);
    return <span className={stack ? 'jfmod-groupStack' : 'jfmod-groupItems'}>{items}</span>;
};

/**
 * The popup (user decision 13): one compact row per ticked rating — its mark, its value, its votes — in aligned columns, exactly
 * as wide as the row's group with all of its sources (`width`, in pixels), never wider; a row that would not fit is clipped, not
 * wrapped. Where a value came from and when is the row's native title and, for a screen reader, hidden text; a value older than
 * the refresh window is dimmed.
 */
const Popup: FC<{ list: Rating[]; id: string; anchor: Element; width: number | null }> = ({ list, id, anchor, width }) => {
    const box = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        const place = () => {
            const tip = box.current;
            if (!tip) return;
            const rect = anchor.getBoundingClientRect();
            const gap = 8;
            const below = rect.bottom + gap + tip.offsetHeight <= window.innerHeight || rect.top - gap - tip.offsetHeight < 0;
            // Below the group if it fits, else above; if neither, as low as it can be while wholly on screen (it may then cover
            // the group; a phone's screen is short), and never above the top (a taller popup scrolls inside, see the styles).
            let top = below ? rect.bottom + gap : rect.top - gap - tip.offsetHeight;
            if (top + tip.offsetHeight > window.innerHeight - gap) top = window.innerHeight - gap - tip.offsetHeight;
            tip.style.top = Math.max(gap, top) + 'px';
            tip.style.left = Math.max(gap, Math.min(rect.left, window.innerWidth - tip.offsetWidth - gap)) + 'px';
        };
        place();
        window.addEventListener('scroll', place, true);
        window.addEventListener('resize', place);
        return () => {
            window.removeEventListener('scroll', place, true);
            window.removeEventListener('resize', place);
        };
    }, [anchor, list, width]);
    return createPortal(<div ref={box} id={id} role='tooltip' className='jfmod-groupPopup' data-jfmod-ratings-popup=''
        style={width ? { width: width + 'px' } : undefined}>
        {list.map(rating => <div key={rating.source} className={'jfmod-popRow' + (rating.stale ? ' jfmod-pop-stale' : '')}
            data-jfmod-rating={rating.source} title={tooltipLines(rating).join('. ')}>
            <span className='jfmod-popMark'><RatingIcon rating={rating} /></span>
            <span className='jfmod-popValue'>{formatValue(rating)}</span>
            <span className='jfmod-popVotes'>{rating.votes ? formatVotes(rating.votes) + ' votes' : ''}</span>
            <span className='jfmod-ratingsHidden'>{SOURCE_LONG[rating.source] + ', ' + provenance(rating)}</span>
        </div>)}
    </div>, document.body);
};

/**
 * The popup's state and the group's handlers: hover (a mouse, on a computer), keyboard focus and Escape, a tap, OK on a TV,
 * and the remote's Back, which is taken only while the popup is open; a tap elsewhere closes it, and so does losing what it
 * shows.
 */
const usePopup = (box: React.RefObject<HTMLElement>, popupId: string, hasContent: boolean, tv: boolean) => {
    const [open, setOpen] = useState(false);
    const closing = useRef<number>();
    // What pressed the group: OK on a TV, a tap and the keyboard toggle the popup; a mouse click adds nothing to the hover.
    const pointer = useRef<string | null>(null);
    const hover = !tv && typeof window.matchMedia === 'function' && window.matchMedia('(hover: hover)').matches;
    useEffect(() => {
        if (open && !hasContent) setOpen(false);
    }, [open, hasContent]);
    useEffect(() => {
        const node = box.current;
        if (!node || !open) return;
        const onCommand = (event: Event) => {
            if ((event as CustomEvent<{ command?: string }>).detail?.command !== 'back') return;
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
        };
        inputManager.on(node, onCommand);
        return () => inputManager.off(node, onCommand);
    }, [box, open]);
    useEffect(() => {
        if (!open) return;
        const outside = (event: PointerEvent) => {
            const target = event.target as Node | null;
            if (target && (box.current?.contains(target) || document.getElementById(popupId)?.contains(target))) return;
            setOpen(false);
        };
        document.addEventListener('pointerdown', outside, true);
        return () => document.removeEventListener('pointerdown', outside, true);
    }, [box, open, popupId]);
    const enter = useCallback((event: React.PointerEvent) => {
        if (!hover || event.pointerType !== 'mouse') return;
        window.clearTimeout(closing.current);
        setOpen(true);
    }, [hover]);
    const leave = useCallback((event: React.PointerEvent) => {
        if (!hover || event.pointerType !== 'mouse') return;
        closing.current = window.setTimeout(() => setOpen(false), 150);
    }, [hover]);
    const onPointerDown = useCallback((event: React.PointerEvent) => {
        pointer.current = event.pointerType;
    }, []);
    const toggle = useCallback(() => {
        const byMouse = pointer.current === 'mouse';
        pointer.current = null;
        if (hover && byMouse) return;
        setOpen(value => !value);
    }, [hover]);
    const onFocus = useCallback(() => {
        // Keyboard focus on a computer shows it, as hovering does; a tap's focus leaves the tap's click to decide.
        if (!tv && pointer.current === null) setOpen(true);
    }, [tv]);
    const onBlur = useCallback((event: React.FocusEvent) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
    }, []);
    const onKeyDown = useCallback((event: React.KeyboardEvent) => {
        if (event.key === 'Escape' && !tv && open) {
            setOpen(false);
            event.stopPropagation();
        }
    }, [open, tv]);
    return { open, enter, leave, onPointerDown, toggle, onFocus, onBlur, onKeyDown };
};

/** The answer, kept as shown: a new answer that shows the same changes nothing. */
const useAnswer = (all: Rating[] | null) => {
    const [shown, setShown] = useState<Rating[] | null>(null);
    const allKey = all ? keyOf(all) : null;
    useLayoutEffect(() => {
        if (all && allKey !== (shown ? keyOf(shown) : null)) setShown(all);
    // `all` is described by `allKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [allKey, shown]);
    return shown;
};

/** How the row is laid out around the group: the stock star and tomato shown or hidden, the space reserved, the group there. */
interface RowLayout {
    hideStar: boolean;
    hideCritic: boolean;
    /** The group's least width (the reserve), or '' for its own. */
    minWidth: string;
    /** The group gives its place back (nothing to show here). */
    gone: boolean;
}

const sameLayout = (a: RowLayout, b: RowLayout) => a.hideStar === b.hideStar && a.hideCritic === b.hideCritic && a.minWidth === b.minWidth && a.gone === b.gone;

const STAR_CLASS = 'jfmod-ratings-hideStar';
const CRITIC_CLASS = 'jfmod-ratings-hideCritic';

/** Hides (or shows again) the stock star and tomato the group stands in for: classes on the row, which upstream's refill keeps. */
const markRow = (row: Element | null, hideStar: boolean, hideCritic: boolean) => {
    row?.classList.toggle(STAR_CLASS, hideStar);
    row?.classList.toggle(CRITIC_CLASS, hideCritic);
};

/**
 * The row's layout for what is known. Before the answer the row is laid out as it will most likely end: the stock star and
 * tomato hidden for the IMDb and Rotten Tomatoes values the group has room for, the room reserved. The answer then only fills
 * it; one without some of those values gives the stock ones back together with the room they needed (the reserve, wider than
 * they are). Nothing to show here (not a movie or series, ratings off, no value in the row) gives the place back.
 */
const rowLayoutOf = (wanted: boolean | undefined, answered: boolean, inline: Rating[], reservedFor: string[], reserve: string): RowLayout => {
    if (wanted === false || (answered && !inline.length)) return { hideStar: false, hideCritic: false, minWidth: '', gone: true };
    if (!answered) {
        return { hideStar: reservedFor.includes('imdb'), hideCritic: reservedFor.some(source => source.startsWith('tomatoes')), minWidth: reserve, gone: false };
    }
    const has = (source: string) => inline.some(rating => rating.source === source);
    const full = reservedFor.every(source => !(INLINE_SOURCES as string[]).includes(source) || has(source));
    return { hideStar: has('imdb'), hideCritic: has('tomatoes_critic') || has('tomatoes_audience'), minWidth: full ? reserve : '', gone: false };
};

/**
 * Applies the row's layout before paint. The first one (the group's first paint, before upstream focuses anything) is applied
 * as it is; every later one is a trial: kept only if the row keeps its height while focus sits past it, and never one that
 * takes the group away while it has focus. A refused change keeps the layout already on screen. Upstream refills the row's
 * content, never the row itself, so the classes stay on it across a refill. Returns whether the group has given its place back.
 */
const useRowLayout = (box: React.RefObject<HTMLElement>, row: () => Element | null, layout: RowLayout, ownStar: boolean) => {
    const applied = useRef<RowLayout | null>(null);
    const rowNode = useRef<Element | null>(null);
    const [gone, setGone] = useState(false);
    useLayoutEffect(() => {
        const node = box.current;
        const target = row();
        const previous = applied.current;
        if (!node || gone || (previous && sameLayout(previous, layout))) return;
        if (layout.gone && node.contains(document.activeElement)) return;
        rowNode.current = target;
        const put = (next: RowLayout) => {
            node.style.minWidth = next.minWidth;
            node.style.display = next.gone ? 'none' : '';
            if (!ownStar) markRow(target, next.hideStar, next.hideCritic);
        };
        const before = target?.getBoundingClientRect().height ?? 0;
        put(layout);
        if (previous && target && focusIsPast(target) && Math.abs(target.getBoundingClientRect().height - before) > 0.5) {
            put(previous);
            return;
        }
        applied.current = layout;
        if (layout.gone) setGone(true);
    // `layout` is described by its fields; `box` and `row` read the current nodes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gone, layout.hideStar, layout.hideCritic, layout.minWidth, layout.gone, ownStar]);
    useEffect(() => () => {
        rowNode.current?.classList.remove(STAR_CLASS, CRITIC_CLASS);
    }, []);
    return gone;
};

/**
 * Whether the group fits its row on one line: no wider than the row, and — outside a phone, whose narrow centred row wraps by
 * design — every item of the row on the group's line.
 */
const fitsOneLine = (row: Element | null, group: HTMLElement) => {
    if (!row) return true;
    const own = row.getBoundingClientRect();
    const box = group.getBoundingClientRect();
    if (box.width > own.width + 0.5) return false;
    if (layoutManager.mobile) return true;
    return [...row.children].every(child => {
        const rect = child.getBoundingClientRect();
        return !rect.width || !rect.height || (rect.top < box.bottom - 1 && rect.bottom > box.top + 1);
    });
};

/** What the reserve was measured for, and what it holds. */
interface Reserve {
    /** The ticked inline sources it was measured for (a change measures again while focus allows). */
    ticked: string;
    /** The sources the row has room for: the ticked ones, less Trakt when it gave way. */
    sources: string[];
    /** The group's least width, in its own em. */
    em: number;
    /** The width of the group with all its ticked inline sources (Trakt included), in em: the popup's width. */
    fullEm: number;
}

/**
 * The space reserved for the row's ratings, decided once, at the group's first paint (before upstream focuses anything): the
 * ticked ones among IMDb, Rotten Tomatoes critics and audience, and Trakt, at their widest (or the fallback's), laid out
 * hidden and measured with the stock star and tomato already out of the row. If the row does not fit on one line with Trakt,
 * Trakt gives way (user decision 13): it is measured out and the row shows it only in the popup; IMDb and Rotten Tomatoes
 * never give way. A change of the ticked sources (the user's own choice, read after the server's default) decides again only
 * while focus is not past the row or on the group, so nothing is decided again under a focused control.
 */
const useReserve = (box: React.RefObject<HTMLElement>, row: () => Element | null, sources: RatingSource[], ownStar: boolean) => {
    const inlineTicked = STAND_IN.filter(rating => sources.includes(rating.source));
    const fallback = !inlineTicked.length && sources.length > 0;
    const standInList = fallback ? FALLBACK_STAND_INS.filter(rating => sources.includes(rating.source)) : inlineTicked;
    const standInKey = fallback ? FALLBACK_KEY : standInList.map(rating => rating.source).join(',');
    const [reserved, setReserved] = useState<Reserve | null>(null);
    const measuring = reserved === null || (reserved.ticked !== standInKey && !focusIsPast(box.current) && !box.current?.contains(document.activeElement));
    useLayoutEffect(() => {
        const node = box.current;
        if (!measuring || !node) return;
        const target = row();
        const items = node.querySelector<HTMLElement>('.jfmod-groupItems');
        // Measured at its own width on one line (a phone's group otherwise wraps inside its box), in the row as it will be:
        // without the stock marks the group stands in for.
        node.style.minWidth = '';
        if (items) items.style.flexWrap = 'nowrap';
        if (!ownStar) markRow(target, standInKey.includes('imdb'), standInKey.includes('tomatoes'));
        const em = Number.parseFloat(getComputedStyle(node).fontSize) || 16;
        const fullEm = node.getBoundingClientRect().width / em;
        let fits = { sources: standInKey.split(','), em: fullEm };
        const trakt = node.querySelector<HTMLElement>('[data-jfmod-rating="trakt"]');
        if (trakt && standInList.length > 1 && !fitsOneLine(target, node)) {
            trakt.style.display = 'none';
            fits = { sources: fits.sources.filter(source => source !== 'trakt'), em: node.getBoundingClientRect().width / em };
            trakt.style.display = '';
        }
        if (items) items.style.flexWrap = '';
        setReserved({ ticked: standInKey, sources: fits.sources, em: fits.em, fullEm });
    // `row` reads the current node.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [box, measuring, standInKey, ownStar]);
    const settled = reserved !== null && !measuring ? reserved : null;
    return {
        // While measuring, every ticked stand-in; after, only those the row has room for.
        standInList: settled ? standInList.filter(rating => fallback || settled.sources.includes(rating.source)) : standInList,
        standInKey, reserved: settled, measuring
    };
};

/**
 * The row's ratings within the space reserved: only the sources it has room for (so Trakt, when it gave way, and any source
 * ticked after focus had passed the row, are in the popup only). A title with none of those values shows one rating instead,
 * if there is room for one (the fallback's, or any two of the row's own): Trakt first, which then has room, else the first ticked.
 */
const inlineWithin = (enabled: Rating[], reservedFor: string[]) => {
    const inline = inlineOf(enabled.filter(rating => !INLINE_SOURCES.includes(rating.source) || reservedFor.includes(rating.source)), false);
    if (inline.length || !(reservedFor.includes(FALLBACK_KEY) || reservedFor.length >= 2)) return inline;
    const one = enabled.find(rating => rating.source === 'trakt') ?? enabled[0];
    return one ? [one] : [];
};

/** The popup's width in pixels: the group's with all its ticked inline sources (Trakt too, even when it gave way in the row). */
const popupWidthOf = (node: HTMLElement | null, reserved: Reserve | null, standInKey: string) => {
    if (!node || !reserved || standInKey === FALLBACK_KEY) return null;
    return Math.round(reserved.fullEm * (Number.parseFloat(getComputedStyle(node).fontSize) || 16));
};

/**
 * The ratings in the title's first metadata row (user decisions 10 and 13, 2026-10-08): IMDb in place of the stock star, Rotten
 * Tomatoes critics (tomato) and audience (popcorn) in place of the stock tomato, and Trakt when the row has room; every ticked
 * rating in a compact popup — hover on a computer, a tap on a phone, OK on a TV (Back closes only the popup).
 *
 * Nothing it does moves a focused control (UX §13 rule 2; web review 2026-10-08, P2 2-5):
 * - its width (and whether Trakt is in the row) is decided at its first paint from the widest values it can show, and the
 *   answer only fills that space: nothing is fitted later, so nothing depends on when focus arrives;
 * - it is one control: on a TV one focus stop, the group itself, which never moves or goes while it has focus;
 * - every later change to the row (the stock marks back, the space released or given back) is kept only if the row keeps its
 *   height while focus sits below it;
 * - Back is taken only while the popup is open, and the popup closes when there is nothing to show.
 */
const RatingsGroup: FC<RatingsGroupProps> = ({ ratings, sources, ready, wanted, ownStar }) => {
    const box = useRef<HTMLSpanElement>(null);
    const button = useRef<HTMLButtonElement>(null);
    const row = () => box.current?.closest('.itemMiscInfo') ?? null;
    const { standInList, standInKey, reserved, measuring } = useReserve(box, row, sources, !!ownStar);
    const popupId = useId();
    const tv = layoutManager.tv;

    const shown = useAnswer(ready && ratings && wanted !== false ? enabledOf(ratings.filter(rating => isKnownScale(rating.scale)), sources) : null);
    const enabled = shown ?? [];
    const reservedFor = reserved ? reserved.sources : standInKey.split(',');
    const inline = inlineWithin(enabled, reservedFor);

    // A phone's row is narrower than the group at its widest, so there the group wraps inside its own box and reserves no
    // width: a phone has no remote focus for a late answer to move (UX §13 rule 2 is the TV's).
    const reserve = reserved && !layoutManager.mobile ? reserved.em + 'em' : '';
    const layout = rowLayoutOf(wanted, shown !== null, inline, reservedFor, reserve);
    const gone = useRowLayout(box, row, layout, !!ownStar);

    const popup = usePopup(box, popupId, inline.length > 0, tv);

    if (gone) return null;
    const standIn = measuring || !inline.length;
    const label = inline.length ? 'Ratings: ' + inline.map(ratingName).join(', ') + '. More ratings' : undefined;
    const { open, enter, leave } = popup;
    const popupWidth = popupWidthOf(box.current, reserved, standInKey);
    return <span ref={box} className='jfmod-ratingsGroup' onPointerEnter={enter} onPointerLeave={leave}
        data-jfmod-full-width={popupWidth ?? undefined}>
        <button ref={button} type='button' className={'jfmod-groupButton noautofocus' + (standIn ? ' jfmod-groupButton-standIn' : '')}
            tabIndex={standIn ? -1 : undefined} aria-hidden={standIn || undefined} aria-label={label} aria-expanded={standIn ? undefined : open}
            aria-describedby={open ? popupId : undefined} onPointerDown={popup.onPointerDown} onClick={standIn ? undefined : popup.toggle}
            onFocus={popup.onFocus} onBlur={popup.onBlur} onKeyDown={popup.onKeyDown} data-jfmod-ratings-group=''>
            <RowItems list={standIn ? standInList : inline} stack={standIn && standInKey === FALLBACK_KEY} />
        </button>
        {open && !standIn && button.current && <span onPointerEnter={enter} onPointerLeave={leave}>
            <Popup list={enabled} id={popupId} anchor={button.current} width={popupWidth} />
        </span>}
    </span>;
};

export default RatingsGroup;
