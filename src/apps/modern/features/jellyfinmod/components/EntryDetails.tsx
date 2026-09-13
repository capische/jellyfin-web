import type { Api } from '@jellyfin/sdk/lib/api';
import React, { type ChangeEvent, type FC, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';

import { type EntryDetail, patchEntry, patchEpisode, refreshEntry, removeEntry } from '../api/modApi';
import { getTmdbImage } from '../utils/entryLinks';
import FileStateMark from './FileStateMark';

import './entryDetails.scss';

interface EntryDetailsProps {
    api: Api;
    detail: EntryDetail;
    view: HTMLElement;
    isAdmin: boolean;
    serverId: string;
    signal: AbortSignal;
}

/** Reuses the existing detail template's slots without constructing a synthetic native item. */
const EntryDetails: FC<EntryDetailsProps> = ({ api, detail, view, isAdmin, serverId, signal }) => {
    const [entry, setEntry] = useState(detail.entry);
    const [episodes, setEpisodes] = useState(detail.episodes);
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);
    const mount = (selector: string, content: React.ReactNode) => {
        const node = view.querySelector(selector);
        return node ? createPortal(content, node) : null;
    };
    const poster = getTmdbImage(entry.posterPath);
    const mutate = useCallback(async (action: () => Promise<void>) => {
        setBusy(true);
        setMessage('');
        try {
            await action();
        } catch {
            if (!signal.aborted) setMessage('The change could not be saved. Please try again.');
        } finally {
            if (!signal.aborted) setBusy(false);
        }
    }, [signal]);
    const searchReleases = useCallback(() => setMessage('Release search is not available yet. No download has started.'), []);
    const toggleMonitoring = useCallback(() => mutate(async () => {
        const updated = await patchEntry(api, entry.id, !entry.monitored, { signal });
        if (!signal.aborted) setEntry(updated);
    }), [api, entry.id, entry.monitored, mutate, signal]);
    const remove = useCallback(() => mutate(async () => {
        await removeEntry(api, entry.id, { signal });
        if (!signal.aborted) window.location.hash = '#/home';
    }), [api, entry.id, mutate, signal]);
    const toggleEpisode = useCallback((event: ChangeEvent<HTMLInputElement>) => {
        const id = event.currentTarget.dataset.episodeId;
        const monitored = event.currentTarget.checked;
        if (!id) return;
        return mutate(async () => {
            const updated = await patchEpisode(api, entry.id, id, monitored, { signal });
            if (!signal.aborted) setEpisodes(episodes.map(item => item.id === updated.id ? updated : item));
        });
    }, [api, entry.id, episodes, mutate, signal]);
    const refresh = useCallback(() => mutate(async () => {
        const updated = await refreshEntry(api, entry.id, { signal });
        if (!signal.aborted) {
            setEntry(updated.entry);
            setEpisodes(updated.episodes);
            setMessage('Metadata refreshed.');
        }
    }), [api, entry.id, mutate, signal]);
    const availabilityLabel = (availability: EntryDetail['episodes'][number]['availability']) => {
        if (availability === 'onDisk') return 'On disk';
        if (availability === 'unaired') return 'Unaired';
        return 'Missing';
    };
    return <>
        {mount('.nameContainer', <h1>{entry.title}</h1>)}
        {mount('.itemMiscInfo-primary', <>{[entry.year, entry.metadata?.runtimeMinutes ? entry.metadata.runtimeMinutes + ' min' : null].filter(Boolean).join(' · ')}</>)}
        {mount('.itemMiscInfo-secondary', entry.metadata?.communityRating ? <>★ {entry.metadata.communityRating.toFixed(1)} on TMDB</> : null)}
        {Array.from(view.querySelectorAll('.detailImageContainer')).map((node, index) => createPortal(
            <div className='jfmod-entryPoster'>{poster && <img src={poster} alt={entry.title} />}<FileStateMark entry={entry} /></div>, node, String(index)))}
        {mount('.mainDetailButtons', <div className='jfmod-entryActions'>
            {entry.jellyfinItemId && <a className='emby-button raised button-submit'
                href={'#/details?id=' + encodeURIComponent(entry.jellyfinItemId) + '&serverId=' + encodeURIComponent(serverId)}>
                Open in Jellyfin
            </a>}
            <button className='emby-button raised button-submit' type='button'
                onClick={searchReleases}>
                Search releases
            </button>
            {isAdmin && <>
                <label><input type='checkbox' checked={entry.monitored} disabled={busy}
                    onChange={toggleMonitoring} /> Monitor</label>
                <button className='emby-button' type='button' disabled={busy}
                    onClick={remove}>Remove entry</button>
                {entry.mediaType === 'series' && <button className='emby-button' type='button' disabled={busy}
                    onClick={refresh}>Refresh metadata</button>}
            </>}
        </div>)}
        {mount('.itemGenres', entry.metadata?.genres.join(' · '))}
        {mount('.overview', entry.overview)}
        {mount('.itemDetailsGroup', <>
            <p role='status'>{message}</p>
            <details className='jfmod-entryHistory'>
                <summary>History{detail.history[0] ? ' · ' + detail.history[0].summary : ''}</summary>
                <ol>{detail.history.map(event => <li key={event.id}>
                    <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleDateString()}</time>{' · '}{event.summary}
                </li>)}</ol>
            </details>
            {episodes.length > 0 && <section aria-label='Episodes'>
                <h2>Episodes</h2>
                {episodes.map(episode => <div className='jfmod-episodeRow' key={episode.id}>
                    <span>S{episode.seasonNumber} E{episode.episodeNumber} · {episode.title}</span>
                    <span>{episode.jellyfinItemId ? <a href={'#/details?id=' + encodeURIComponent(episode.jellyfinItemId) + '&serverId=' + encodeURIComponent(serverId)}>Open episode</a> : availabilityLabel(episode.availability)}</span>
                    {isAdmin && <label><input type='checkbox' checked={episode.monitored} disabled={busy}
                        data-episode-id={episode.id} onChange={toggleEpisode} /> Monitor</label>}
                </div>)}
            </section>}
        </>)}
    </>;
};

export default EntryDetails;
