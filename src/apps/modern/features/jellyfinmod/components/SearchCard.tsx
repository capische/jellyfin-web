import React, { type FC, type MouseEvent, useCallback, useState } from 'react';

import layoutManager from 'components/layoutManager';

import type { Entry, RetentionSummary } from '../types/entry';
import FileStateMark from './FileStateMark';

import './searchGrid.scss';

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

/**
 * The + on a TMDB result, drawn as a library poster's centre Play or cloud (upstream's `cardOverlayFab-primary`); while adding,
 * the importing arc's turning segment (download-state-mark.md) runs round it.
 */
const AddDisc: FC<{ item: SearchCardItem }> = ({ item }) => {
    const add = item.add!;
    const onClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();
        if (!add.adding) add.onAdd(item, event.currentTarget);
    }, [add, item]);
    // The library poster's own centre button (upstream's hover overlay, as Play and the mod's cloud are drawn on a library card):
    // the dimmed poster and the round button appear on the card's hover or focus, the button grows under the pointer.
    return <div className='jfmod-searchAddBox'>
        <div className='jfmod-searchAddPad' />
        <div className={'cardOverlayContainer jfmod-searchOverlay' + (add.adding ? ' jfmod-searchOverlay-adding' : '')}>
            <button type='button' className='paper-icon-button-light cardOverlayButton cardOverlayButton-hover cardOverlayFab-primary jfmod-searchAdd'
                aria-label={`Add ${item.title} to library`} title='Add to Library' aria-busy={add.adding || undefined}
                aria-disabled={add.adding || undefined} data-jfmod-add={item.key} onClick={onClick}>
                <span className='material-icons cardOverlayButtonIcon cardOverlayButtonIcon-hover add' aria-hidden='true' />
                {add.adding && <svg className='jfmod-searchAddArc' viewBox='0 0 36 36' aria-hidden='true' focusable='false'>
                    <circle className='jfmod-searchAddSeg' cx='18' cy='18' r='17' pathLength={100} />
                </svg>}
            </button>
        </div>
    </div>;
};

/** The poster, falling back to the kind's icon when there is none or it fails to load. */
const Poster: FC<{ item: SearchCardItem }> = ({ item }) => {
    const [failed, setFailed] = useState<string>();
    const onError = useCallback(() => setFailed(item.poster), [item.poster]);
    const shown = item.poster && failed !== item.poster ? item.poster : undefined;
    return <div className='jfmod-searchPoster'>
        {shown ? <img src={shown} alt='' loading='lazy' decoding='async' onError={onError} /> :
            <span className={'material-icons jfmod-searchBlank ' + (item.mediaType === 'movie' ? 'movie' : 'tv')} aria-hidden='true' />}
        {item.entry && <FileStateMark entry={item.entry} retention={item.retention} interactive={false} />}
    </div>;
};

/**
 * The search card (D202, D203): a 2:3 poster and a three-line caption in a cell padded 1em, lit in paper under the pointer and
 * the TV focus. The whole cell opens the title; the + disc on a TMDB result adds it without opening it.
 */
const SearchCard: FC<{ item: SearchCardItem }> = ({ item }) => {
    const body = <>
        <Poster item={item} />
        <div className='jfmod-searchCaption'>
            <div className='jfmod-searchLine jfmod-searchTitle' title={item.title}><bdi>{item.title}</bdi></div>
            <div className='jfmod-searchLine'>
                {item.year ? <span>{item.year}</span> : null}
                {item.mediaType === 'series' && <span className='jfmod-searchKind'>TV Series</span>}
            </div>
            <div className='jfmod-searchLine jfmod-searchCast'>{item.cast.slice(0, 2).join(', ')}</div>
        </div>
    </>;
    // Desktop only, as a library card's hover overlay; on the phone and the TV a TMDB result is added from its browse page, as a
    // library card's cloud is reached from its menu there.
    const add = item.add && layoutManager.desktop;
    return <div className={'jfmod-searchCell' + (add ? ' card-hoverable' : '')} data-jfmod-key={item.key}
        data-jfmod-tmdb-id={item.tmdbId}>
        {item.href ?
            <a className='jfmod-searchOpen' href={item.href} aria-label={item.title}>{body}</a> :
            <div className='jfmod-searchOpen'>{body}</div>}
        {add && <AddDisc item={item} />}
    </div>;
};

export default SearchCard;
