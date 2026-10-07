import React, { type FC, useCallback, useLayoutEffect, useRef, useState } from 'react';

import layoutManager from 'components/layoutManager';

import { chipLabel, chipText, isKnownScale, provenance, SOURCE_LONG } from '../constants/ratings';
import type { Rating, RatingSource } from '../types/ratings';
import './ratings.scss';

interface RatingsLineProps {
    ratings: Rating[] | undefined;
    /** The user's enabled sources, in their order; anything else is not shown. */
    sources: RatingSource[];
    /** Renders inline, beside the stock-style star line, instead of as its own line. */
    inline?: boolean;
    /** Whether everything the line depends on has arrived; until then it renders nothing and decides nothing. */
    ready?: boolean;
}

/** Whether focus already sits after `node` in the page, where content inserted above it would move it. */
const focusIsPast = (node: Element | null) => {
    const active = document.activeElement;
    if (!node || !active || active === document.body || !active.isConnected || node.contains(active)) return false;
    return (node.compareDocumentPosition(active) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
};

/**
 * The Ratings line (P9.R6): one short chip per enabled source that has a value — source, value in its own scale, votes —
 * in the user's order. A missing or disabled source is simply not rendered, so the line shrinks instead of showing dashes,
 * and an empty line renders nothing.
 *
 * It never moves a focused control (UX §13 rule 2, web review 2026-10-07 P2 2): when its data arrives after the user has
 * already moved focus past where it would appear, it stays out for this visit. On a TV it is read-only text, never a focus
 * stop. Elsewhere each chip is a button that shows where its value came from, for keyboard and touch as well as hover
 * (web review 2026-10-07, P3 6).
 */
const RatingsLine: FC<RatingsLineProps> = ({ ratings, sources, inline, ready = true }) => {
    const anchor = useRef<HTMLSpanElement>(null);
    const [show, setShow] = useState<boolean | null>(null);
    const [open, setOpen] = useState<RatingSource | null>(null);
    useLayoutEffect(() => {
        if (show === null && ready) setShow(!focusIsPast(anchor.current));
    }, [ready, show]);
    const toggle = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
        const source = event.currentTarget.dataset.jfmodRating as RatingSource;
        setOpen(current => current === source ? null : source);
    }, []);
    const shown = sources.map(source => ratings?.find(rating => rating.source === source))
        .filter((rating): rating is Rating => !!rating && isKnownScale(rating.scale));
    if (!show || !ready || !shown.length) return <span ref={anchor} hidden />;
    const tv = layoutManager.tv;
    const Tag = inline ? 'span' : 'div';
    const opened = shown.find(rating => rating.source === open);
    return <Tag className={'jfmod-ratingsLine' + (inline ? ' jfmod-ratingsLine-inline' : '')}>
        <span ref={anchor} hidden />
        <span role='list' aria-label='Ratings' className='jfmod-ratingsChips'>
            {shown.map(rating => {
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
