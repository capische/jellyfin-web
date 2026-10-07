import React, { type FC } from 'react';

import { chipLabel, chipText } from '../constants/ratings';
import type { Rating, RatingSource } from '../types/ratings';
import './ratings.scss';

interface RatingsLineProps {
    ratings: Rating[] | undefined;
    /** The user's enabled sources, in their order; anything else is not shown. */
    sources: RatingSource[];
    /** Renders inline, beside the stock-style star line, instead of as its own line. */
    inline?: boolean;
}

/**
 * The Ratings line (P9.R6): one short chip per enabled source that has a value — source, value in its own scale, votes —
 * in the user's order. A missing or disabled source is simply not rendered, so the line shrinks instead of showing dashes,
 * and an empty line renders nothing. The tooltip (and each chip's accessible name) says where the value came from and when.
 * It is text, never a focus stop, in every layout: a TV's remote never lands on it.
 */
const RatingsLine: FC<RatingsLineProps> = ({ ratings, sources, inline }) => {
    const shown = sources.map(source => ratings?.find(rating => rating.source === source)).filter((rating): rating is Rating => !!rating);
    if (!shown.length) return null;
    const Tag = inline ? 'span' : 'div';
    return <Tag className={'jfmod-ratingsLine' + (inline ? ' jfmod-ratingsLine-inline' : '')} role='list' aria-label='Ratings'>
        {shown.map(rating => {
            const label = chipLabel(rating);
            return <span key={rating.source} role='listitem' className={'jfmod-ratingChip' + (rating.stale ? ' jfmod-ratingChip-stale' : '')}
                title={label} aria-label={label} data-jfmod-rating={rating.source}
                data-jfmod-provider={rating.provider}>
                {chipText(rating)}
            </span>;
        })}
    </Tag>;
};

export default RatingsLine;
