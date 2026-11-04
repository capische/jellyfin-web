import React, { type FC, useContext, useState } from 'react';
import { useUserSettings } from 'hooks/useUserSettings';
import { FileState, type Entry, type RetentionSummary } from '../types/entry';
import { daysUntilReclaim, retentionDeadline } from '../constants/fileState';
import { Cloud, Icon } from './Icon';
import { DesignContext } from './Root';

/** One cell of the search grid (TM2, guide `search-card.md`): a library title or a TMDB result. */
export interface SearchCardItem {
    /** `movie:123` for a TMDB identity, else the library row's own key. */
    key: string;
    mediaType: 'movie' | 'series';
    tmdbId?: number;
    title: string;
    year?: number | null;
    /** The release date (ISO) where known: full matches are ordered by it. */
    date?: string | null;
    /** TMDB's votes where known: the grid's order (D253). */
    votes?: number | null;
    /** The two lead actors, at most. */
    cast: string[];
    poster?: string;
    /** Where the card opens: the library page, or the browse page of a TMDB result; absent opens nothing. */
    href?: string;
    /** A library title's entry: its Not Downloaded cloud top right while it has no file; nothing once it has one. */
    entry?: Entry;
    retention?: RetentionSummary | null;
    /** A TMDB result: the + add disc in the poster's centre. */
    add?: { adding: boolean; onAdd: (item: SearchCardItem, button: HTMLElement) => void };
}

/** ds.js cell for the mixed Search grid; the existing search session owns Add and navigation. */

export const SearchCell: FC<{ item: SearchCardItem }> = ({ item }) => {
    const device = useContext(DesignContext);
    const { libraryPageSize } = useUserSettings();
    const [failed, setFailed] = useState<string>();
    const [focused, setFocused] = useState(false);
    const add = device === 'computer' ? item.add : undefined;
    const days = daysUntilReclaim(retentionDeadline(item.retention));
    let mark = null;
    let tip = 'Not Downloaded';
    if (item.entry && [FileState.None, FileState.Reclaimed].includes(item.entry.state)) mark = <Cloud />;
    if (item.entry?.state === FileState.Searching) {
        mark = <Icon name='search' />;
        tip = 'Searching';
    }
    if (days !== null && days <= 3) {
        mark = <span className='num'>{days}d</span>;
        tip = `File will be removed in ${days} days`;
    }
    const body = <div className='tile'><span className='post'>
        {item.poster && failed !== item.poster ? <img src={item.poster} alt='' loading='lazy' onError={() => setFailed(item.poster)} /> :
            <Icon name={item.mediaType === 'movie' ? 'movie' : 'tv'} className='fallback' />}
        {mark && <span className='mark glassy' title={tip}>{mark}</span>}
        {add && <span className={'disc hov glassy' + (add.adding ? ' on' : '')} role='button' tabIndex={0}
            aria-label={`Add ${item.title} to library`} data-tip='Add to Library' aria-busy={add.adding || undefined}
            aria-disabled={add.adding || undefined} data-jfmod-add={item.key}
            onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    event.stopPropagation();
                    event.currentTarget.click();
                }
            }}
            onClick={event => {
                event.preventDefault();
                event.stopPropagation();
                if (!add.adding) add.onAdd(item, event.currentTarget);
            }}>
            <Icon name='plus' />
            {add.adding && <span className='dm importing' aria-hidden='true'><svg className='arc' viewBox='0 0 36 36'><circle className='turn' cx='18' cy='18' r='15.9' fill='none' stroke='currentColor' strokeWidth='2.2' strokeDasharray='28 72' /></svg></span>}
        </span>}
    </span><div className='capt'>
        <div className='ln t'>{item.title}</div>
        <div className='ln'>{item.year && <span>{item.year}</span>}{item.mediaType === 'series' && <span className='k'>TV Series</span>}</div>
        <div className='ln d'>{libraryPageSize ? item.cast.slice(0, 2).join(', ') : ''}</div>
    </div></div>;
    return <a href={item.href} aria-label={item.title} tabIndex={0} className={'cell p focusable' + (add ? ' act' : '') + (focused && device !== 'phone' ? ' focus' : '')}
        data-jfmod-key={item.key} data-jfmod-entry-id={item.entry?.id} data-jfmod-tmdb-id={item.tmdbId} onFocus={() => setFocused(true)}
        onBlur={event => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
        }}>
        {body}
    </a>;
};
