import React, { type FC, type RefObject, type FocusEvent } from 'react';
import type { usePopup } from '../components/RatingsGroup';
import RatingIcon from '../components/RatingIcon';
import type { Rating } from '../types/ratings';
import { formatValue, formatVotes, ratingName, tooltipLines } from '../constants/ratings';

interface Props {
    box: RefObject<HTMLSpanElement>;
    button: RefObject<HTMLButtonElement>;
    popup: ReturnType<typeof usePopup>;
    standIn: boolean;
    label?: string;
    id: string;
    standInList: Rating[];
    inline: Rating[];
    enabled: Rating[];
    onBlur: (event: FocusEvent) => void;
}

/** ds.js ratings: presentation only; RatingsGroup retains values, reserves, focus and Back logic. */
export const DesignRatings: FC<Props> = ({ box, button, popup, standIn, label, id, standInList, inline, enabled, onBlur }) => {
    return <span ref={box} className={'rgwrap' + (popup.open ? ' on' : '')} onPointerEnter={popup.enter} onPointerLeave={popup.leave}>
        <button ref={button} type='button' className='rgroup focusable noautofocus' data-jfmod-ratings-group=''
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
            {(standIn ? standInList : inline).map(rating => <span key={rating.source} className='ritem' data-jfmod-rating={rating.source}>
                <span className='mk0'><RatingIcon rating={rating} /></span><b className={rating.scale === 'percent' ? 'pc' : undefined}>{standIn ? '\u00a0' : formatValue(rating)}</b>
            </span>)}
        </button>
        <span className='rcentre'><div id={id} role='tooltip' className={'pmenu mn from-top rmenu' + (popup.open ? ' open' : '')} data-jfmod-ratings-popup=''>
            {enabled.map(rating => <div key={rating.source} className='rrow' data-jfmod-rating={rating.source}
                title={tooltipLines(rating).join('. ')} aria-label={ratingName(rating) + (rating.votes ? ', ' + formatVotes(rating.votes) + ' votes' : '')}>
                <span className='rmk'><RatingIcon rating={rating} /></span><b className='rval'>{formatValue(rating)}</b>
                <span className='rvt'>{rating.votes ? formatVotes(rating.votes) : ''}</span>
            </div>)}
        </div><span className='rcaret mn' /></span>
    </span>;
};
