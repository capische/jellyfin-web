import type { Api } from '@jellyfin/sdk/lib/api';
import { useQuery } from '@tanstack/react-query';
import React, { type FC, useCallback, useState } from 'react';

import { getEntries, getEntry, keepEntry } from '../api/modApi';
import RetentionStatus from './RetentionStatus';
import './entryDetails.scss';

/** Add catalog history without replacing native playback, seasons or track controls. */
const NativeEntryDetails: FC<{ api: Api; userId: string; itemId: string; isAdmin: boolean }> = ({ api, userId, itemId, isAdmin }) => {
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const detail = useQuery({
        queryKey: ['JellyfinMod', api.basePath, userId, 'NativeDetail', itemId],
        queryFn: async ({ signal }) => {
            const entries = await getEntries(api, { jellyfinItemId: itemId, limit: 1 }, { signal });
            const entry = entries.items.find(candidate => candidate.jellyfinItemId?.replace(/-/g, '').toLowerCase() === itemId.replace(/-/g, '').toLowerCase());
            return entry ? getEntry(api, entry.id, { signal }) : null;
        },
        retry: false
    });
    const keep = useCallback(async () => {
        if (!detail.data) return;
        setBusy(true);
        setMessage('');
        try {
            await keepEntry(api, detail.data.entry.id);
            await detail.refetch();
            setMessage('This title will be kept.');
        } catch {
            setMessage('The change could not be saved. Please try again.');
        } finally {
            setBusy(false);
        }
    }, [api, detail]);
    if (!detail.data) return null;
    return <section aria-label='JellyfinMod'>
        <p role='status'>{message}</p>
        <RetentionStatus retention={detail.data.retention} />
        {isAdmin && <button className='emby-button raised' type='button' disabled={busy}
            aria-pressed={detail.data.retention.reason === 'kept'} onClick={keep}>
            {detail.data.retention.reason === 'kept' ? 'Kept' : 'Keep'}
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
