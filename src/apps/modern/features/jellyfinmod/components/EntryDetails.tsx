import type { Api } from '@jellyfin/sdk/lib/api';
import React, { type FC, type MouseEvent, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';

import confirm from 'components/confirm/confirm';

import { getEntry, type EntryDetail, keepEntry, patchEntry, patchEpisode, refreshEntry, removeEntry } from '../api/modApi';
import { keepButtonLabel } from '../constants/fileState';
import { useAcquisitionAvailable } from '../hooks/useAcquisition';
import { openReleasePicker } from '../integration/releasePicker';
import type { AcquisitionSummary } from '../types/acquisition';
import { getTmdbImage } from '../utils/entryLinks';
import FileStateMark from './FileStateMark';
import HistoryToggle from './HistoryToggle';
import RetentionStatus from './RetentionStatus';

const ACQUISITION_LABELS: Record<AcquisitionSummary['state'], string> = {
    pending: 'Grab held, not sent yet', submitting: 'Sending to the download client', accepted: 'Sent to the download client',
    failed: 'Last grab failed', unknown: 'Grab not confirmed by the download client', cancelled: 'Last grab cancelled'
};

const AcquisitionLine: FC<{ acquisition?: AcquisitionSummary | null }> = ({ acquisition }) => {
    if (!acquisition) return null;
    return <p className='jfmod-acquisitionLine'>{ACQUISITION_LABELS[acquisition.state]}
        {acquisition.releaseTitle ? ' · ' + acquisition.releaseTitle : ''}</p>;
};

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
    const [history, setHistory] = useState(detail.history);
    // An older plugin omits the summary; the page must still render (P1.W14).
    const [retention, setRetention] = useState<EntryDetail['retention'] | null>(detail.retention ?? null);
    const [acquisition, setAcquisition] = useState(detail.acquisition ?? null);
    const [message, setMessage] = useState('');
    // Release search is administrator-only and gated on the plugin's advertised capability (P4.A7).
    const canAcquire = useAcquisitionAvailable(api, isAdmin);
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
    const reload = useCallback(async () => {
        try {
            const updated = await getEntry(api, entry.id, { signal });
            if (signal.aborted) return;
            setEntry(updated.entry);
            setEpisodes(updated.episodes);
            setHistory(updated.history);
            setRetention(updated.retention);
            setAcquisition(updated.acquisition ?? null);
        } catch {
            // The picker already showed the outcome; the page keeps its last good state.
        }
    }, [api, entry.id, signal]);
    const searchReleases = useCallback((event: MouseEvent<HTMLButtonElement>) => {
        void openReleasePicker({
            api, entryId: entry.id, title: entry.title, mediaType: entry.mediaType, episodes,
            episodeId: event.currentTarget.dataset.episodeId, onChanged: reload
        });
    }, [api, entry.id, entry.mediaType, entry.title, episodes, reload]);
    // Busy controls stay focusable (aria-disabled) so D-pad focus is not lost mid-request (P3.T19).
    const toggleMonitoring = useCallback(() => {
        if (busy) return;
        return mutate(async () => {
            const updated = await patchEntry(api, entry.id, !entry.monitored, { signal });
            if (!signal.aborted) setEntry(updated);
        });
    }, [api, busy, entry.id, entry.monitored, mutate, signal]);
    const remove = useCallback(async () => {
        if (busy) return;
        try {
            await confirm({ title: 'Remove entry', text: `Remove ${entry.title} from the catalog?`,
                confirmText: 'Remove', primary: 'delete' });
        } catch {
            return;
        }
        return mutate(async () => {
            await removeEntry(api, entry.id, { signal });
            if (!signal.aborted) window.location.hash = '#/home';
        });
    }, [api, busy, entry.id, entry.title, mutate, signal]);
    const keep = useCallback(() => {
        if (busy) return;
        return mutate(async () => {
            await keepEntry(api, entry.id, { signal });
            const updated = await getEntry(api, entry.id, { signal });
            if (!signal.aborted) {
                setEntry(updated.entry);
                setEpisodes(updated.episodes);
                setHistory(updated.history);
                setRetention(updated.retention);
                setMessage('This title will be kept.');
            }
        });
    }, [api, busy, entry.id, mutate, signal]);
    const toggleEpisode = useCallback((event: MouseEvent<HTMLButtonElement>) => {
        const id = event.currentTarget.dataset.episodeId;
        const monitored = event.currentTarget.getAttribute('aria-checked') !== 'true';
        if (!id || busy) return;
        return mutate(async () => {
            const updated = await patchEpisode(api, entry.id, id, monitored, { signal });
            if (!signal.aborted) setEpisodes(episodes.map(item => item.id === updated.id ? updated : item));
        });
    }, [api, busy, entry.id, episodes, mutate, signal]);
    const refresh = useCallback(() => {
        if (busy) return;
        return mutate(async () => {
            const updated = await refreshEntry(api, entry.id, { signal });
            if (!signal.aborted) {
                setEntry(updated.entry);
                setEpisodes(updated.episodes);
                setHistory(updated.history);
                setRetention(updated.retention);
                setMessage('Metadata refreshed.');
            }
        });
    }, [api, busy, entry.id, mutate, signal]);
    const availabilityLabel = (availability: EntryDetail['episodes'][number]['availability']) => {
        if (availability === 'onDisk') return 'On disk';
        if (availability === 'unaired') return 'Unaired';
        if (availability === 'reclaimed') return 'Removed after watching';
        return 'Missing';
    };
    return <>
        {mount('.nameContainer', <h1>{entry.title}</h1>)}
        {mount('.itemMiscInfo-primary', <>{[entry.year, entry.metadata?.runtimeMinutes ? entry.metadata.runtimeMinutes + ' min' : null].filter(Boolean).join(' · ')}</>)}
        {mount('.itemMiscInfo-secondary', entry.metadata?.communityRating ? <>★ {entry.metadata.communityRating.toFixed(1)} on TMDB</> : null)}
        {Array.from(view.querySelectorAll('.detailImageContainer')).map((node, index) => createPortal(
            <div className='jfmod-entryPoster'>{poster && <img src={poster} alt={entry.title} />}<FileStateMark entry={entry} retention={retention} /></div>, node, String(index)))}
        {mount('.mainDetailButtons', <div className='jfmod-entryActions'>
            {entry.jellyfinItemId && <a className='emby-button raised button-submit'
                href={'#/details?id=' + encodeURIComponent(entry.jellyfinItemId) + '&serverId=' + encodeURIComponent(serverId)}>
                Open in Jellyfin
            </a>}
            {canAcquire && <button className='emby-button raised button-submit' type='button'
                onClick={searchReleases}>
                {entry.state === 'reclaimed' ? 'Get again' : 'Search releases'}
            </button>}
            {isAdmin && <>
                <button className='emby-button raised' type='button' aria-busy={busy}
                    aria-disabled={busy} aria-pressed={retention?.reason === 'kept'} onClick={keep}>
                    {keepButtonLabel(busy, retention?.reason === 'kept')}
                </button>
                <button className='emby-button raised' type='button' role='switch' aria-checked={entry.monitored}
                    aria-disabled={busy} onClick={toggleMonitoring}>
                    {entry.monitored ? '☑' : '☐'} Monitor
                </button>
                <button className='emby-button' type='button' aria-disabled={busy}
                    onClick={remove}>Remove entry</button>
                {entry.mediaType === 'series' && <button className='emby-button' type='button' aria-disabled={busy}
                    onClick={refresh}>Refresh metadata</button>}
            </>}
        </div>)}
        {mount('.itemGenres', entry.metadata?.genres.join(' · '))}
        {mount('.overview', entry.overview)}
        {mount('.itemDetailsGroup', <>
            <p role='status'>{message}</p>
            <RetentionStatus retention={retention} />
            <AcquisitionLine acquisition={acquisition} />
            <HistoryToggle label={<>History{history[0] ? ' · ' + history[0].summary : ''}</>}>
                <ol>{history.map(event => <li key={event.id}>
                    <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleDateString()}</time>{' · '}{event.summary}
                </li>)}</ol>
            </HistoryToggle>
            {episodes.length > 0 && <section aria-label='Episodes'>
                <h2>Episodes</h2>
                {episodes.map(episode => <div className='jfmod-episodeRow' key={episode.id}>
                    <span>S{episode.seasonNumber} E{episode.episodeNumber} · {episode.title}</span>
                    <span>{episode.jellyfinItemId ? <a href={'#/details?id=' + encodeURIComponent(episode.jellyfinItemId) + '&serverId=' + encodeURIComponent(serverId)}>Open episode</a> : availabilityLabel(episode.availability)}</span>
                    <RetentionStatus retention={episode.retention} compact />
                    <AcquisitionLine acquisition={episode.acquisition} />
                    {canAcquire && <button className='emby-button' type='button' data-episode-id={episode.id}
                        onClick={searchReleases}>Search releases</button>}
                    {isAdmin && <button className='emby-button' type='button' role='switch' aria-checked={episode.monitored}
                        aria-disabled={busy} data-episode-id={episode.id} onClick={toggleEpisode}>
                        {episode.monitored ? '☑' : '☐'} Monitor
                    </button>}
                </div>)}
            </section>}
        </>)}
    </>;
};

export default EntryDetails;
