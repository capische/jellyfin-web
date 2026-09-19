import type { Api } from '@jellyfin/sdk/lib/api';
import { useQuery } from '@tanstack/react-query';
import React, { type FC, useCallback, useState } from 'react';

import { getEntries, getEntry, keepEntry } from '../api/modApi';
import { keepButtonLabel } from '../constants/fileState';
import RetentionStatus from './RetentionStatus';
import './entryDetails.scss';

/** Add catalog history without replacing native playback, seasons or track controls. */
const NativeEntryDetails: FC<{ api: Api; userId: string; itemId: string; isAdmin: boolean }> = ({ api, userId, itemId, isAdmin }) => {
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
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
    return <section aria-label='JellyfinMod'>
        <p role='status'>{message}</p>
        <RetentionStatus retention={episode ? episode.retention : detail.data.retention} />
        {isSeriesPage && detail.data.episodes.some(candidate => candidate.retention) && <details className='jfmod-entryHistory'>
            <summary>Episode retention</summary>
            {detail.data.episodes.map(candidate => <div className='jfmod-episodeRow' key={candidate.id}>
                <span>S{candidate.seasonNumber} E{candidate.episodeNumber} · {candidate.title}</span>
                <RetentionStatus retention={candidate.retention} compact />
            </div>)}
        </details>}
        {isAdmin && <button className='emby-button raised' type='button' aria-busy={busy}
            aria-disabled={busy} aria-pressed={detail.data.retention.reason === 'kept'} onClick={keep}>
            {keepButtonLabel(busy, detail.data.retention.reason === 'kept')}
        </button>}
        <details className='jfmod-entryHistory'>
            <summary>History{detail.data.history[0] ? ' · ' + detail.data.history[0].summary : ''}</summary>
            <ol>{detail.data.history.map(event => <li key={event.id}>
                <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleDateString()}</time>{' · '}{event.summary}
            </li>)}</ol>
        </details>
    </section>;
};

export default NativeEntryDetails;
