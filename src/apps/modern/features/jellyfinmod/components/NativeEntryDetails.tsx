import type { Api } from '@jellyfin/sdk/lib/api';
import { useQuery } from '@tanstack/react-query';
import React, { type FC } from 'react';

import { getEntries, getEntry } from '../api/modApi';
import './entryDetails.scss';

/** Add catalog history without replacing native playback, seasons or track controls. */
const NativeEntryDetails: FC<{ api: Api; userId: string; itemId: string }> = ({ api, userId, itemId }) => {
    const detail = useQuery({
        queryKey: ['JellyfinMod', api.basePath, userId, 'NativeDetail', itemId],
        queryFn: async ({ signal }) => {
            const entries = await getEntries(api, { jellyfinItemId: itemId, limit: 1 }, { signal });
            const entry = entries.items.find(candidate => candidate.jellyfinItemId?.replace(/-/g, '').toLowerCase() === itemId.replace(/-/g, '').toLowerCase());
            return entry ? getEntry(api, entry.id, { signal }) : null;
        },
        retry: false
    });
    if (!detail.data) return null;
    return <section aria-label='JellyfinMod'>
        <details className='jfmod-entryHistory'>
            <summary>History{detail.data.history[0] ? ' · ' + detail.data.history[0].summary : ''}</summary>
            <ol>{detail.data.history.map(event => <li key={event.id}>
                <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleDateString()}</time>{' · '}{event.summary}
            </li>)}</ol>
        </details>
    </section>;
};

export default NativeEntryDetails;
