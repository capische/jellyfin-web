import React, { type FC, type RefObject, type FocusEvent } from 'react';
import type { usePopup } from '../components/RatingsGroup';
import RatingIcon from '../components/RatingIcon';
import type { Rating } from '../types/ratings';
import { formatValue, formatVotes, provenance, ratingName, SOURCE_LONG, tooltipLines } from '../constants/ratings';

interface Props {
    box: RefObject<HTMLSpanElement>;
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
export const DesignRatings: FC<Props> = ({ box, button, popup, standIn, stack, label, id, standInList, inline, enabled, onBlur, fullWidth }) => {
    return <span ref={box} data-jfmod-full-width={fullWidth} className={'rgwrap' + (popup.open ? ' on' : '')} onPointerEnter={popup.enter} onPointerLeave={popup.leave}>
        <button ref={button} type='button' className={'rgroup noautofocus' + (standIn ? '' : ' focusable')} data-jfmod-ratings-group='' data-ds-reserve-stack={standIn && stack || undefined}
            tabIndex={standIn ? -1 : 0} aria-hidden={standIn || undefined} aria-label={label} aria-expanded={standIn ? undefined : popup.open}
            aria-describedby={popup.open ? id : undefined} onPointerDown={popup.onPointerDown} onClick={standIn ? undefined : popup.toggle}
            onFocus={event => {
                event.currentTarget.classList.add('foc');
                popup.onFocus();
            }}
            onBlur={event => {
                event.currentTarget.classList.remove('foc');
                onBlur(event);
            }} onKeyDown={popup.onKeyDown}>
            {(standIn ? standInList : inline).map(rating => <span key={rating.source} className='ritem' data-ds-stale={rating.stale || undefined} data-jfmod-rating={rating.source}>
                <span className='mk0'><RatingIcon className={'rm' + (rating.source.startsWith('tomatoes') ? ' rt' : '')} rating={rating} /></span><b className={rating.scale === 'percent' ? 'pc' : undefined}>{formatValue(rating)}</b>
            </span>)}
        </button>
        <span className='rcentre'><div id={id} role='tooltip' className={'pmenu mn from-top rmenu' + (popup.open ? ' open' : '')} data-jfmod-ratings-popup=''>
            {enabled.map(rating => <div key={rating.source} className='rrow' data-ds-stale={rating.stale || undefined} data-jfmod-rating={rating.source}
                title={tooltipLines(rating).join('. ')} aria-label={ratingName(rating) + (rating.votes ? ', ' + formatVotes(rating.votes) + ' votes' : '')}>
                <span className='rmk'><RatingIcon className={'rm' + (rating.source.startsWith('tomatoes') ? ' rt' : '')} rating={rating} /></span><b className='rval'>{formatValue(rating)}</b>
                <span className='rvt'>{rating.votes ? formatVotes(rating.votes) : ''}</span>
                <span className='jfmod-ratingsHidden'>{SOURCE_LONG[rating.source] + ', ' + provenance(rating)}</span>
            </div>)}
        </div><span className='rcaret mn' /></span>
    </span>;
};
