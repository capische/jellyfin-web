import type { Api } from '@jellyfin/sdk/lib/api';
import { useQuery } from '@tanstack/react-query';
import React, { type FC, useCallback, useState } from 'react';

import { getEntries, getEntry, keepEntry } from '../api/modApi';
import { keepButtonLabel } from '../constants/fileState';
import { useAcquisitionAvailable } from '../hooks/useAcquisition';
import { FileState } from '../types/entry';
import HistoryToggle from './HistoryToggle';
import QueueStatusLine from './QueueStatusLine';
import RetentionStatus from './RetentionStatus';
import './entryDetails.scss';

/** Add catalog history without replacing native playback, seasons or track controls. */
const NativeEntryDetails: FC<{ api: Api; userId: string; itemId: string; isAdmin: boolean }> = ({ api, userId, itemId, isAdmin }) => {
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const canAcquire = useAcquisitionAvailable(api, isAdmin);
    const detail = useQuery({
        queryKey: ['JellyfinMod', api.basePath, userId, 'NativeDetail', itemId],
        queryFn: async ({ signal }) => {
            // The server matches any bound copy, and a native episode to its series (P1.P11, P3.T14).
            const entries = await getEntries(api, { jellyfinItemId: itemId, limit: 1 }, { signal });
            const entry = entries.items[0];
            return entry ? getEntry(api, entry.id, { signal }) : null;
        },
        retry: false
    });
    const keep = useCallback(async () => {
        if (busy || !detail.data) return;
        setBusy(true);
        setMessage('');
        try {
            await keepEntry(api, detail.data.entry.id);
            const refreshed = await detail.refetch();
            if (refreshed.error) throw refreshed.error;
            setMessage('This title will be kept.');
        } catch {
            setMessage('The change could not be saved. Please try again.');
        } finally {
            setBusy(false);
        }
    }, [api, busy, detail]);
    if (!detail.data) return null;
    const sameId = (value?: string | null) => value?.replace(/-/g, '').toLowerCase() === itemId.replace(/-/g, '').toLowerCase();
    // A native episode page shows its own retention; a native series page lists every episode's (P3.T14).
    const episode = detail.data.episodes.find(candidate => sameId(candidate.jellyfinItemId));
    const isSeriesPage = !episode && detail.data.entry.mediaType === 'series';
    // Episodes of this series that are grabbed or downloading; the series entry itself is never projected (P5.I3).
    const inFlightEpisodes = isSeriesPage ? detail.data.episodes.filter(candidate =>
        candidate.state === FileState.Grabbed || candidate.state === FileState.Downloading) : [];
    // The native More menu reads these to offer Search releases for this entry (P4.A7).
    return <section aria-label='JellyfinMod' data-jfmod-entry-id={detail.data.entry.id}
        data-jfmod-can-acquire={canAcquire ? 'true' : undefined}>
        <p role='status'>{message}</p>
        <RetentionStatus retention={episode ? episode.retention : detail.data.retention} />
        {episode && <QueueStatusLine entryId={detail.data.entry.id} episodeId={episode.id} state={episode.state} progress={episode.progress} />}
        {!episode && detail.data.entry.mediaType === 'movie'
            && <QueueStatusLine entryId={detail.data.entry.id} state={detail.data.entry.state} progress={detail.data.entry.progress} />}
        {inFlightEpisodes.map(candidate => <div className='jfmod-episodeRow' key={'queue:' + candidate.id}>
            <span>S{candidate.seasonNumber} E{candidate.episodeNumber} · {candidate.title}</span>
            <QueueStatusLine entryId={candidate.entryId} episodeId={candidate.id} state={candidate.state} progress={candidate.progress} />
        </div>)}
        {isSeriesPage && detail.data.episodes.some(candidate => candidate.retention) && <HistoryToggle label='Episode retention'>
            {detail.data.episodes.map(candidate => <div className='jfmod-episodeRow' key={candidate.id}>
                <span>S{candidate.seasonNumber} E{candidate.episodeNumber} · {candidate.title}</span>
                <RetentionStatus retention={candidate.retention} compact />
            </div>)}
        </HistoryToggle>}
        {isAdmin && <button className='emby-button raised' type='button' aria-busy={busy}
            aria-disabled={busy} aria-pressed={detail.data.retention.reason === 'kept'} onClick={keep}>
            {keepButtonLabel(busy, detail.data.retention.reason === 'kept')}
        </button>}
        <HistoryToggle label={<>History{detail.data.history[0] ? ' · ' + detail.data.history[0].summary : ''}</>}>
            <ol>{detail.data.history.map(event => <li key={event.id}>
                <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleDateString()}</time>{' · '}{event.summary}
            </li>)}</ol>
        </HistoryToggle>
    </section>;
};

export default NativeEntryDetails;
