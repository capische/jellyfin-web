import React, { type FC, type RefObject, type FocusEvent } from 'react';
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
}

/** ds.js ratings: presentation only; RatingsGroup retains values, reserves, focus and Back logic. */
export const DesignRatings: FC<Props> = ({ box, button, popup, standIn, stack, label, id, standInList, inline, enabled, onBlur, fullWidth, tv, href, onClick, resolvedSources }) => {
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
            {(standIn ? standInList : inline).map(rating => <span key={rating.source} className={'ritem' + (!tv && href(rating) ? ' jfmod-ratingMarkLink' : '')} data-ds-stale={rating.stale || undefined} data-jfmod-rating={rating.source}>
                <span className='mk0'><RatingIcon className={'rm' + (rating.source.startsWith('tomatoes') ? ' rt' : '')} rating={rating} /></span><b className={rating.scale === 'percent' ? 'pc' : undefined}>{formatValue(rating)}</b>
            </span>)}
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
        </div><span className='rcaret mn' /></span>
    </span>;
};
