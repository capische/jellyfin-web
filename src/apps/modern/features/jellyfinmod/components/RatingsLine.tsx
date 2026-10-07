import React, { type FC, useCallback, useLayoutEffect, useRef, useState } from 'react';

import layoutManager from 'components/layoutManager';

import { chipLabel, chipText, isKnownScale, provenance, SOURCE_LONG } from '../constants/ratings';
import type { Rating, RatingSource } from '../types/ratings';
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

/** Where the focused control is: a change is judged by whether this moves, wherever the line sits (its own row or a shared one). */
const focusPlace = () => {
    const rect = document.activeElement?.getBoundingClientRect();
    return rect ? { top: rect.top, left: rect.left } : null;
};

interface Shown {
    list: Rating[];
    /**
     * A change being tried while focus sits below the line: kept only if neither the line's height nor the focused control's
     * place changed. The focused control is what counts: an inline line that keeps its own height can still wrap the row it
     * shares and push everything below it down (review round 3, P2 3).
     */
    trial?: { previous: Rating[]; height: number; focus: { top: number; left: number } | null };
}

/**
 * The Ratings line (P9.R6): one short chip per enabled source that has a value — source, value in its own scale, votes —
 * in the user's order. A missing or disabled source is simply not rendered, so the line shrinks instead of showing dashes,
 * and an empty line renders nothing.
 *
 * It never moves a focused control (UX §13 rule 2; web review 2026-10-07 P2 2 and round 2, P2 1). Whatever arrives later —
 * the first answer, a minute's refetch, a refresh, a change of sources or of the server's defaults — is shown at once while
 * focus is above the line or inside it; while focus sits below it, a change is applied only if the line keeps its height,
 * and otherwise waits for the next visit. A failed read never removes what is shown. On a TV it is read-only text, never a
 * focus stop. Elsewhere each chip is a button that shows where its value came from, for keyboard and touch as well as hover
 * (web review 2026-10-07, P3 6).
 */
const RatingsLine: FC<RatingsLineProps> = ({ ratings, sources, inline, ready = true }) => {
    const anchor = useRef<HTMLSpanElement>(null);
    const box = useRef<HTMLElement>(null);
    const [shown, setShown] = useState<Shown | null>(null);
    const [open, setOpen] = useState<RatingSource | null>(null);
    const rejected = useRef<string | null>(null);
    const candidate = ready ? sources.map(source => ratings?.find(rating => rating.source === source))
        .filter((rating): rating is Rating => !!rating && isKnownScale(rating.scale)) : null;
    const candidateKey = candidate ? keyOf(candidate) : null;
    const height = () => box.current?.getBoundingClientRect().height ?? 0;

    useLayoutEffect(() => {
        if (!candidate || candidateKey === null) return;
        if (shown?.trial) {
            // The trial has rendered: keep it unless it changed the line's height under a focused control below.
            const now = focusPlace();
            const before = shown.trial.focus;
            const focusMoved = !!before && !!now && (Math.abs(now.top - before.top) > 0.5 || Math.abs(now.left - before.left) > 0.5);
            const moved = focusIsPast(anchor.current) && (focusMoved || Math.abs(height() - shown.trial.height) > 0.5);
            if (moved) rejected.current = keyOf(shown.list);
            setShown({ list: moved ? shown.trial.previous : shown.list });
            return;
        }

        if (shown && keyOf(shown.list) === candidateKey) return;
        if (rejected.current === candidateKey) return;
        if (!shown) {
            // The first decision: shown unless focus has already moved past where it would appear.
            setShown({ list: focusIsPast(anchor.current) ? [] : candidate });
            return;
        }

        rejected.current = null;
        setShown(focusIsPast(anchor.current) ? { list: candidate, trial: { previous: shown.list, height: height(), focus: focusPlace() } } : { list: candidate });
    // `candidate` is described by `candidateKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [candidateKey, shown]);

    const toggle = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
        const source = event.currentTarget.dataset.jfmodRating as RatingSource;
        setOpen(current => current === source ? null : source);
    }, []);

    const list = shown?.list ?? [];
    if (!list.length) return <span ref={anchor} hidden />;
    const tv = layoutManager.tv;
    const Tag = inline ? 'span' : 'div';
    const opened = list.find(rating => rating.source === open);
    return <Tag ref={box as React.RefObject<HTMLDivElement>} className={'jfmod-ratingsLine' + (inline ? ' jfmod-ratingsLine-inline' : '')}>
        <span ref={anchor} hidden />
        <span role='list' aria-label='Ratings' className='jfmod-ratingsChips'>
            {list.map(rating => {
                const label = chipLabel(rating);
                const className = 'jfmod-ratingChip' + (rating.stale ? ' jfmod-ratingChip-stale' : '');
                return <span key={rating.source} role='listitem'>
                    {tv ?
                        <span className={className} title={label} aria-label={label} data-jfmod-rating={rating.source}
                            data-jfmod-provider={rating.provider}>{chipText(rating)}</span> :
                        <button type='button' className={className + ' jfmod-ratingChip-button'} title={label} aria-label={label}
                            aria-expanded={open === rating.source} data-jfmod-rating={rating.source} data-jfmod-provider={rating.provider}
                            onClick={toggle}>{chipText(rating)}</button>}
                </span>;
            })}
        </span>
        {opened && <span className='jfmod-ratingNote' role='status' data-jfmod-rating-note={opened.source}>
            {SOURCE_LONG[opened.source]}: {provenance(opened)}
        </span>}
    </Tag>;
};

export default RatingsLine;
