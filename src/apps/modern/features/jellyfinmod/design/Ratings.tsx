import React, { type FC, type RefObject, type FocusEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { usePopup } from '../components/RatingsGroup';
import RatingIcon from '../components/RatingIcon';
import { Icon } from './Icon';
import type { Rating } from '../types/ratings';
import { formatValue, formatVotes, provenance, SOURCE_LONG, tooltipLines } from '../constants/ratings';

interface Props {
    box: RefObject<HTMLSpanElement>;
    tv: boolean;
    href: (rating: Rating) => string | undefined;
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
    resolvedSources?: string;
    button: RefObject<HTMLButtonElement>;
    popup: ReturnType<typeof usePopup>;
    standIn: boolean;
    stack: boolean;
    label?: string;
    fullWidth?: number;
    id: string;
    standInList: Rating[];
    inline: Rating[];
    enabled: Rating[];
    onBlur: (event: FocusEvent) => void;
    /** The plugin is fetching the title's ratings (ds.t16). */
    fetching: boolean;
}

const reducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
/** φ⁻³ s leaving (TV φ⁻⁴ s), φ⁻² s arriving, the next one φ⁻⁴ s later (reviews/progress-ratings/ratings.html, Timing). */
const LEAVE_MS = 236;
const TV_MS = 146;
const ARRIVE_MS = 382;
const STAGGER_MS = 146;

/** One mark's box (s0): a white 30 % track and a φ⁻² (38.2 %) arc turning once a second. */
const Spinner: FC<{ out?: boolean }> = ({ out }) => <span className={'jfmod-rspin' + (out ? ' out' : '')} aria-hidden='true'>
    <svg viewBox='0 0 24 24'><circle className='tr' cx='12' cy='12' r='9.25' /><circle className='ar' cx='12' cy='12' r='9.25' pathLength='100' /></svg>
</span>;

/**
 * The hand-over (option B, the user 2026-11-07, ds.t16). While the plugin fetches, the pill shows what it has (TMDb) and a
 * spinner. When the fetched ratings come, what is no longer shown (TMDb) and the spinner step out, then the new marks fade in
 * one after another. A failed or empty fetch only takes the spinner away. The pill's first answer, and everything under reduced
 * motion, is drawn at once.
 */
const useHandOver = (inline: Rating[], standIn: boolean, fetching: boolean, tv: boolean) => {
    const sources = standIn ? '' : inline.map(rating => rating.source).join(',');
    const [held, setHeld] = useState<{ list: Rating[]; gone: string[] } | null>(null);
    const [entering, setEntering] = useState<{ list: string[]; run: boolean }>({ list: [], run: false });
    const [spinOut, setSpinOut] = useState(false);
    const last = useRef({ sources, fetching, inline });
    const timers = useRef<number[]>([]);
    const later = (run: () => void, ms: number) => timers.current.push(window.setTimeout(run, ms));
    useLayoutEffect(() => {
        const was = last.current;
        last.current = { sources, fetching, inline };
        if (!was.sources || !sources || reducedMotion()) return;
        const leaveMs = tv ? TV_MS : LEAVE_MS;
        if (was.fetching && !fetching) {
            setSpinOut(true);
            later(() => setSpinOut(false), leaveMs);
        }
        const old = was.sources.split(',');
        const now = sources.split(',');
        const added = now.filter(source => !old.includes(source));
        const gone = old.filter(source => !now.includes(source));
        if (!added.length) return;
        if (!gone.length) {
            setEntering({ list: added, run: false });
            return;
        }
        setHeld({ list: was.inline, gone });
        later(() => {
            setHeld(null);
            setEntering({ list: added, run: false });
        }, leaveMs);
    // `inline` is described by `sources`; its latest values are kept below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sources, fetching]);
    useLayoutEffect(() => {
        last.current.inline = inline;
    });
    useEffect(() => {
        if (!entering.list.length) return;
        if (!entering.run) {
            // The marks are on the page at their start (faded, s-2 to the left); the next frames let them move.
            const run = () => setEntering(value => ({ ...value, run: true }));
            const frame = requestAnimationFrame(() => requestAnimationFrame(run));
            return () => cancelAnimationFrame(frame);
        }
        const done = window.setTimeout(() => setEntering({ list: [], run: false }), (tv ? TV_MS : ARRIVE_MS) + entering.list.length * STAGGER_MS);
        return () => window.clearTimeout(done);
    }, [entering, tv]);
    useEffect(() => () => {
        for (const timer of timers.current) window.clearTimeout(timer);
    }, []);
    const itemClass = (source: string) => {
        if (held?.gone.includes(source)) return ' out';
        return entering.list.includes(source) && !entering.run ? ' in0' : '';
    };
    const itemDelay = (source: string) => {
        const index = entering.run ? entering.list.indexOf(source) : -1;
        return index > 0 ? { transitionDelay: index * STAGGER_MS + 'ms' } : undefined;
    };
    return { list: held?.list ?? inline, spinner: fetching || spinOut || !!held, spinnerOut: !fetching && (spinOut || !!held),
        arriving: entering.list.length, itemClass, itemDelay };
};

/**
 * On a computer the glass glides to its new width, and the marks that stay and the chevron slide to their new places (FLIP), over
 * the arrivals' time, or φ⁻³ s when it closes up. The TV steps at once (width is no transform).
 */
const useGlide = (button: RefObject<HTMLButtonElement>, shape: string, arriving: number, off: boolean) => {
    const was = useRef<{ width: number; at: Map<string, number> } | null>(null);
    useLayoutEffect(() => {
        const node = button.current;
        if (!node) return;
        // What stays on screen (the marks that do not arrive now, and the chevron), by key.
        const movers = Array.from(node.querySelectorAll<HTMLElement>('.ritem:not(.in0), .jfmod-rchev'));
        const keyOf = (element: HTMLElement) => element.getAttribute('data-jfmod-rating') ?? 'chevron';
        node.style.width = '';
        node.style.overflow = '';
        for (const mover of movers) mover.style.transform = '';
        const box = node.getBoundingClientRect();
        const now = { width: box.width, at: new Map(movers.map(mover => [keyOf(mover), mover.getBoundingClientRect().left - box.left])) };
        const before = was.current;
        was.current = now;
        if (off || !before || reducedMotion() || Math.abs(before.width - now.width) < 0.5) return;
        const ms = now.width > before.width ? ARRIVE_MS + Math.max(0, arriving - 1) * STAGGER_MS : LEAVE_MS;
        const moved = movers.filter(mover => before.at.has(keyOf(mover)));
        node.style.transition = 'none';
        node.style.width = before.width + 'px';
        node.style.overflow = 'hidden';
        for (const mover of moved) {
            mover.style.transition = 'none';
            mover.style.transform = `translateX(${(before.at.get(keyOf(mover)) ?? 0) - (now.at.get(keyOf(mover)) ?? 0)}px)`;
        }
        node.getBoundingClientRect();
        node.style.transition = `width ${ms}ms var(--ease), background-color var(--d1) var(--ease)`;
        node.style.width = now.width + 'px';
        for (const mover of moved) {
            mover.style.transition = `transform ${ms}ms var(--ease)`;
            mover.style.transform = '';
        }
        const end = window.setTimeout(() => {
            node.style.transition = '';
            node.style.width = '';
            node.style.overflow = '';
            for (const mover of moved) mover.style.transition = '';
        }, ms);
        return () => window.clearTimeout(end);
    // `arriving` and `off` are read at the change of shape.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [shape]);
};

/** ds.js ratings: presentation only; RatingsGroup retains values, reserves, focus and Back logic. */
export const DesignRatings: FC<Props> = ({ box, button, popup, standIn, stack, label, id, standInList, inline, enabled, onBlur, fullWidth, tv, href, onClick, resolvedSources, fetching }) => {
    const hand = useHandOver(inline, standIn, fetching, tv);
    const shown = standIn ? standInList : hand.list;
    const shape = shown.map(rating => rating.source).join(',') + (hand.spinner ? '+spin' : '');
    useGlide(button, standIn ? '' : shape, hand.arriving, tv || standIn);
    return <span ref={box} data-jfmod-full-width={fullWidth} data-jfmod-rating-sources={resolvedSources} className={'rgwrap jfmod-ratingsAnchor' + (tv ? '' : ' jfmod-ratingLinks') + (popup.open ? ' on' : '')} onBlur={onBlur} onPointerEnter={popup.enter} onPointerLeave={popup.leave}>
        <button ref={button} type='button' className={'rgroup noautofocus' + (standIn ? '' : ' focusable')} data-jfmod-ratings-group='' data-ds-reserve-stack={standIn && stack || undefined}
            tabIndex={standIn ? -1 : 0} aria-hidden={standIn || undefined} aria-label={label} aria-expanded={standIn ? undefined : popup.open}
            aria-controls={id} onPointerDown={popup.onPointerDown} onClick={standIn ? undefined : onClick}
            onFocus={event => {
                event.currentTarget.classList.add('foc');
                popup.onFocus();
            }}
            onBlur={event => {
                event.currentTarget.classList.remove('foc');
                onBlur(event);
            }} onKeyDown={popup.onKeyDown}>
            {shown.map(rating => <span key={rating.source} className={'ritem' + (!tv && href(rating) ? ' jfmod-ratingMarkLink' : '') + (standIn ? '' : hand.itemClass(rating.source))}
                style={standIn ? undefined : hand.itemDelay(rating.source)} data-ds-stale={rating.stale || undefined} data-jfmod-rating={rating.source}>
                <span className='mk0'><RatingIcon className={'rm' + (rating.source.startsWith('tomatoes') ? ' rt' : '')} rating={rating} /></span><b className={rating.scale === 'percent' ? 'pc' : undefined}>{formatValue(rating)}</b>
            </span>)}
            {!standIn && hand.spinner && <Spinner out={hand.spinnerOut} />}
            {!tv && <Icon name='down' className='jfmod-rchev' />}
        </button>
        <span className='rcentre'><div id={id} aria-hidden={!popup.open || undefined} className={'pmenu mn from-top rmenu' + (popup.open ? ' open' : '')} data-jfmod-ratings-popup='' role='group' aria-label='Ratings sources'>
            {enabled.map(rating => {
                const url = href(rating);
                const Row = url ? 'a' : 'div';
                return <Row key={rating.source} className='rrow' data-ds-stale={rating.stale || undefined} data-jfmod-rating={rating.source}
                    href={url} target={url ? '_blank' : undefined} rel={url ? 'noreferrer' : undefined} tabIndex={url && !popup.open ? -1 : undefined}
                    onKeyDown={url ? popup.onKeyDown : undefined} onClick={url ? popup.close : undefined} aria-label={tooltipLines(rating).join('. ') + (url ? '. Open on ' + SOURCE_LONG[rating.source] : '')}>
                    <span className='rmk'><RatingIcon className={'rm' + (rating.source.startsWith('tomatoes') ? ' rt' : '')} rating={rating} /></span><b className='rval'>{formatValue(rating)}</b>
                    <span className='rvt'>{rating.votes ? formatVotes(rating.votes) : ''}</span>
                    <span className='jfmod-ratingsHidden'>{SOURCE_LONG[rating.source] + ', ' + provenance(rating)}</span>
                </Row>;
            })}
            {fetching && <div className='rrow jfmod-rfetch' aria-label='Fetching ratings'><span className='rmk'><Spinner /></span><b className='rval'>Fetching…</b><span className='rvt' /></div>}
        </div><span className='rcaret mn' /></span>
    </span>;
};
