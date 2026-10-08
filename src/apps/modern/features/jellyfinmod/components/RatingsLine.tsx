import React, { type FC, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import layoutManager from 'components/layoutManager';
import inputManager from 'scripts/inputManager';

import { formatValue, isKnownScale, ratingName, tooltipLines } from '../constants/ratings';
import type { Rating, RatingSource } from '../types/ratings';
import RatingIcon from './RatingIcon';
import './ratings.scss';

interface RatingsLineProps {
    /** The title's ratings; undefined while unknown. A failed background read passes the last answer, not undefined. */
    ratings: Rating[] | undefined;
    /** The user's enabled sources, in their order; anything else is not shown. */
    sources: RatingSource[];
    /** Renders inline, beside the stock-style star line, instead of as its own line. */
    inline?: boolean;
    /** Whether everything the line depends on has arrived; until then it keeps what it shows and decides nothing new. */
    ready?: boolean;
}

/** Whether focus already sits after `node` in the page, where content changing above it would move it. */
const focusIsPast = (node: Element | null) => {
    const active = document.activeElement;
    if (!node || !active || active === document.body || !active.isConnected || node.contains(active)) return false;
    return (node.compareDocumentPosition(active) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
};

/** What the line shows, as a comparable key: a new answer with the same key changes nothing on screen. */
const keyOf = (list: Rating[]) => list.map(rating => [rating.source, rating.value, rating.scale, rating.votes ?? '', rating.provider,
    rating.fetchedAt ?? '', rating.stale ? 1 : 0].join(':')).join('|');

/** The focused control and where it is: a change is judged by whether that same control moves (its own row or a shared one). */
const focusPlace = () => {
    const element = document.activeElement;
    if (!element || element === document.body) return null;
    const rect = element.getBoundingClientRect();
    return { element, top: rect.top, left: rect.left };
};

/** Whether the control focused when the trial began has moved, or is gone. */
const focusMovedFrom = (before: { element: Element; top: number; left: number } | null) => {
    if (!before) return false;
    if (!before.element.isConnected) return true;
    const rect = before.element.getBoundingClientRect();
    return Math.abs(rect.top - before.top) > 0.5 || Math.abs(rect.left - before.left) > 0.5;
};

interface Shown {
    list: Rating[];
    /**
     * A change being tried while focus sits below the line: kept only if the focused control did not move (and, for a line
     * that already showed something, if the line kept its height). The focused control is what counts: the line shares its
     * row with the stock year, rating and star, and a row that wraps pushes everything below it down (review round 3, P2 3).
     */
    trial?: { previous: Rating[]; height: number | null; focus: { element: Element; top: number; left: number } | null; key: string };
}

/** Whether a rendered trial moved what it must not: the focused control, or the line's height when it showed something. */
const trialMoved = (trial: NonNullable<Shown['trial']>, height: number) =>
    focusMovedFrom(trial.focus) || (trial.height !== null && Math.abs(height - trial.height) > 0.5);

/**
 * What a rendered trial leads to: kept when nothing focused moved; one rating fewer when the row would still move it; the
 * previous list when not even one fits. `reject` marks the answer as decided for this visit (shown in part, or not at all).
 */
const settleTrial = (shown: Required<Shown>, candidates: number, height: number): { next: Shown; reject: boolean } => {
    if (!trialMoved(shown.trial, height)) return { next: { list: shown.list }, reject: shown.list.length !== candidates };
    if (shown.list.length > 1) return { next: { list: shown.list.slice(0, -1), trial: shown.trial }, reject: false };
    return { next: { list: shown.trial.previous }, reject: true };
};

/** The stock star's value in the row the line sits in (upstream's `.starRatingContainer`, or the entry page's own star). */
const starValue = (row: Element) => {
    const own = row.querySelector<HTMLElement>('[data-jfmod-star]')?.dataset.jfmodStar;
    const text = own ?? row.querySelector('.starRatingContainer')?.textContent ?? '';
    const value = Number.parseFloat(text.replace(',', '.'));
    return Number.isFinite(value) ? value.toFixed(1) : null;
};

/** The stock critic score (upstream's own tomato in the same row). */
const criticValue = (row: Element) => {
    const value = Number.parseFloat(row.querySelector('.mediaInfoCriticRating')?.textContent ?? '');
    return Number.isFinite(value) ? Math.round(value) : null;
};

/**
 * Hides what the row would otherwise say twice (PHASE9, *Inline ratings*): the stock star when a shown IMDb or TMDB value
 * is the same number, and the stock tomato when the shown Rotten Tomatoes critics score is. A different value is a
 * different source's, so it stays. Classes on the row itself, which upstream keeps when it refills the row's content.
 */
const markDuplicates = (row: Element | null | undefined, list: Rating[]) => {
    if (!row) return;
    const star = starValue(row);
    const ten = list.filter(rating => rating.source === 'imdb' || rating.source === 'tmdb')
        .map(rating => (rating.scale === 'percent' ? rating.value / 10 : rating.value).toFixed(1));
    row.classList.toggle('jfmod-ratings-hideStar', star !== null && ten.includes(star));
    const critic = criticValue(row);
    const shownCritic = list.find(rating => rating.source === 'tomatoes_critic');
    row.classList.toggle('jfmod-ratings-hideCritic', critic !== null && !!shownCritic && Math.round(shownCritic.value) === critic);
};

/** Where the tooltip goes: under its rating, or above it when there is no room below, always inside the window. */
const placeTooltip = (tip: HTMLElement, anchor: Element) => {
    const rect = anchor.getBoundingClientRect();
    const width = tip.offsetWidth;
    const height = tip.offsetHeight;
    const gap = 6;
    const below = rect.bottom + gap + height <= window.innerHeight || rect.top - gap - height < 0;
    tip.style.top = (below ? rect.bottom + gap : rect.top - gap - height) + 'px';
    tip.style.left = Math.max(gap, Math.min(rect.left, window.innerWidth - width - gap)) + 'px';
};

/**
 * The Ratings line (P9.R6; inline design of 2026-10-08): each enabled source that has a value, as its mark and its value in
 * its own scale, in the user's order, in the same row as the title's year and stock star. A missing or disabled source is
 * simply not rendered, and an empty line renders nothing. A value older than the refresh window is dimmed.
 *
 * Each rating is a button with a tooltip (role `tooltip`, `aria-describedby`): its votes, where it came from and how old it
 * is. On a computer the tooltip shows on hover and on keyboard focus, and Escape closes it; on a touch screen a tap shows it
 * and a tap elsewhere closes it; on a TV the ratings are focus stops — Up from the button row reaches them, Left and Right
 * move between them, OK shows the tooltip and Back closes it without leaving the page. They never take the page's first
 * focus (`noautofocus`; the TV's autofocus also prefers Play).
 *
 * It never moves a focused control (UX §13 rule 2; web review 2026-10-07 P2 2 and round 2, P2 1). Whatever arrives — the
 * first answer, a minute's refetch, a refresh, a change of sources or of the server's defaults — is shown at once while focus
 * is above the line or inside it; while focus sits below it, the change is tried before paint and kept only if the focused
 * control stays where it was, and otherwise waits for the next visit. A failed read never removes what is shown.
 */
const RatingsLine: FC<RatingsLineProps> = ({ ratings, sources, inline, ready = true }) => {
    const anchor = useRef<HTMLSpanElement>(null);
    const box = useRef<HTMLElement>(null);
    const tip = useRef<HTMLDivElement>(null);
    const [shown, setShown] = useState<Shown | null>(null);
    const [open, setOpen] = useState<{ source: RatingSource; button: HTMLButtonElement } | null>(null);
    const pointer = useRef<string | null>(null);
    const rejected = useRef<string | null>(null);
    const tipId = useId();
    const tv = layoutManager.tv;
    const candidate = ready ? sources.map(source => ratings?.find(rating => rating.source === source))
        .filter((rating): rating is Rating => !!rating && isKnownScale(rating.scale)) : null;
    const candidateKey = candidate ? keyOf(candidate) : null;
    const height = () => box.current?.getBoundingClientRect().height ?? 0;
    // The line itself when it is shown (so focus on one of its ratings counts as inside it), else its hidden anchor (review
    // round 4, P3 3: the anchor alone does not contain the ratings, so a focused rating was taken for focus below the line).
    const place = () => box.current ?? anchor.current;
    const row = () => anchor.current?.closest('.itemMiscInfo');

    // Before the trial below measures anything: what the row would say twice is hidden by what is now rendered, so a trial
    // that is undone restores the stock star too.
    useLayoutEffect(() => {
        markDuplicates(row(), shown?.list ?? []);
    }, [shown]);
    useEffect(() => () => markDuplicates(row(), []), []);
    // Upstream fills the row (and may fill it again) after the line has rendered: the duplicates are judged again then,
    // and a change that would move a focused control below the row is undone.
    useEffect(() => {
        const target = row();
        if (!target) return;
        const watch = new MutationObserver(() => {
            const before = focusPlace();
            const classes = target.className;
            markDuplicates(target, shown?.list ?? []);
            if (classes !== target.className && focusIsPast(target) && focusMovedFrom(before)) target.className = classes;
        });
        watch.observe(target, { childList: true });
        return () => watch.disconnect();
    }, [shown]);

    useLayoutEffect(() => {
        if (!candidate || candidateKey === null) return;
        if (shown?.trial) {
            // The trial has rendered: keep it unless it moved the control that was focused below the line, or (for a line
            // that showed something before) the line's own height. When the whole list would wrap the row, the user's first
            // ratings are tried, one fewer each time, so as many as fit the row are shown rather than none (a TV at 1280×720
            // with a long row); all of this happens before paint.
            const settled = settleTrial(shown as Required<Shown>, candidate.length, height());
            if (settled.reject) rejected.current = shown.trial.key;
            setShown(settled.next);
            return;
        }

        if (shown && keyOf(shown.list) === candidateKey) return;
        if (rejected.current === candidateKey) return;
        const past = focusIsPast(place());
        if (!shown) {
            // The first decision: shown at once, unless focus has already moved past where it appears — then tried, and kept
            // only if the focused control stays put (the line sits in the row above a TV's first focus, Play).
            setShown(past ? { list: candidate, trial: { previous: [], height: null, focus: focusPlace(), key: candidateKey } } : { list: candidate });
            return;
        }

        rejected.current = null;
        setShown(past ? { list: candidate, trial: { previous: shown.list, height: shown.list.length ? height() : null, focus: focusPlace(), key: candidateKey } } :
            { list: candidate });
    // `candidate` is described by `candidateKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [candidateKey, shown]);

    const list = shown?.list ?? [];
    const opened = open && list.find(rating => rating.source === open.source);

    // The open tooltip follows its rating while the page scrolls or resizes, and goes when its rating does.
    useLayoutEffect(() => {
        if (!opened || !open || !tip.current) return;
        if (!open.button.isConnected) {
            setOpen(null);
            return;
        }
        const follow = () => tip.current && placeTooltip(tip.current, open.button);
        follow();
        window.addEventListener('scroll', follow, true);
        window.addEventListener('resize', follow);
        return () => {
            window.removeEventListener('scroll', follow, true);
            window.removeEventListener('resize', follow);
        };
    }, [open, opened]);

    // A tap elsewhere closes a tooltip a tap opened; on a TV, Back closes it and stays on the page.
    useEffect(() => {
        if (!open) return;
        const outside = (event: PointerEvent) => {
            const target = event.target as Node | null;
            if (target && (open.button.contains(target) || tip.current?.contains(target))) return;
            setOpen(null);
        };
        document.addEventListener('pointerdown', outside, true);
        return () => document.removeEventListener('pointerdown', outside, true);
    }, [open]);
    useEffect(() => {
        const node = box.current;
        if (!node || !open) return;
        const onCommand = (event: Event) => {
            if ((event as CustomEvent<{ command?: string }>).detail?.command !== 'back') return;
            event.preventDefault();
            event.stopPropagation();
            setOpen(null);
        };
        inputManager.on(node, onCommand);
        return () => inputManager.off(node, onCommand);
    }, [open]);

    const sourceOf = (button: HTMLButtonElement) => button.dataset.jfmodRating as RatingSource;
    const show = useCallback((button: HTMLButtonElement) => setOpen({ source: sourceOf(button), button }), []);
    const hide = useCallback((button: HTMLButtonElement) =>
        setOpen(current => current?.button === button ? null : current), []);
    const onPointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
        pointer.current = event.pointerType;
    }, []);
    const onPointerEnter = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
        if (!tv && event.pointerType === 'mouse') show(event.currentTarget);
    }, [show, tv]);
    const onPointerLeave = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
        // Focus a click gave stays quiet: only keyboard focus (focus-visible) keeps the tooltip once the pointer leaves.
        if (event.pointerType === 'mouse' && !event.currentTarget.matches(':focus-visible')) hide(event.currentTarget);
    }, [hide]);
    const onFocus = useCallback((event: React.FocusEvent<HTMLButtonElement>) => {
        // Keyboard focus on a computer shows it; a tap focuses too, and the tap's click decides.
        if (!tv && pointer.current !== 'touch') show(event.currentTarget);
    }, [show, tv]);
    const onBlur = useCallback((event: React.FocusEvent<HTMLButtonElement>) => hide(event.currentTarget), [hide]);
    const onClick = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
        // OK on a TV and a tap toggle it; a mouse click adds nothing to the hover.
        const button = event.currentTarget;
        if (tv || pointer.current === 'touch') {
            setOpen(current => current?.button === button ? null : { source: sourceOf(button), button });
        }
        pointer.current = null;
    }, [tv]);
    const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLButtonElement>) => {
        if (event.key === 'Escape' && !tv) {
            hide(event.currentTarget);
            event.stopPropagation();
        }
    }, [hide, tv]);

    if (!list.length) return <span ref={anchor} hidden />;
    const Tag = inline ? 'span' : 'div';
    return <Tag ref={box as React.RefObject<HTMLDivElement>} className={'jfmod-ratingsLine' + (inline ? ' jfmod-ratingsLine-inline' : '')}>
        <span ref={anchor} hidden />
        <span role='list' aria-label='Ratings' className='jfmod-ratings'>
            {list.map(rating => <span key={rating.source} role='listitem' className='jfmod-ratingItem'>
                <button type='button' className={'jfmod-rating noautofocus' + (rating.stale ? ' jfmod-rating-stale' : '')}
                    aria-label={ratingName(rating)} aria-describedby={opened?.source === rating.source ? tipId : undefined}
                    data-jfmod-rating={rating.source} data-jfmod-provider={rating.provider}
                    onPointerDown={onPointerDown} onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave}
                    onFocus={onFocus} onBlur={onBlur} onClick={onClick} onKeyDown={onKeyDown}>
                    <RatingIcon rating={rating} />
                    <span className='jfmod-ratingValue' aria-hidden='true'>{formatValue(rating)}</span>
                </button>
            </span>)}
        </span>
        {opened && createPortal(<div ref={tip} id={tipId} role='tooltip' className='jfmod-ratingTooltip' data-jfmod-rating-note={opened.source}>
            {tooltipLines(opened).map(line => <div key={line}>{line}</div>)}
        </div>, document.body)}
    </Tag>;
};

export default RatingsLine;
