import type { Api } from '@jellyfin/sdk/lib/api';
import { useQuery } from '@tanstack/react-query';
import React, { type FC } from 'react';

import { getTraktItemStatus } from '../api/traktApi';
import { TRAKT_CAPABILITY, TRAKT_STALE_MS, traktLabel } from '../constants/trakt';
import { usePluginHealthSummary } from '../hooks/useAcquisition';
import './traktIndicator.scss';

interface TraktIndicatorProps {
    api: Api;
    userId: string;
    itemId: string;
}

/**
 * "Watch history for this title arrived from Trakt for you" (P7.Q16, PHASE7 §7.1.3). Shown on a movie, episode, season
 * or series page only when this server's plugin can answer, the stock Trakt plugin is installed and the signed-in
 * user's history for the title came from a Trakt sync. It is a statement, not a control: nothing here is focusable,
 * and any failure, an older plugin or no Trakt plugin renders nothing at all. Without the Trakt plugin (Health says so)
 * it asks nothing, and nor does it while the latest Health read has failed.
 */
const TraktIndicator: FC<TraktIndicatorProps> = ({ api, userId, itemId }) => {
    // Only a Health answer that is current counts: after a failed refresh React Query keeps the earlier data but reports
    // an error, and a cached "Trakt installed" must not keep the Trakt requests going.
    const healthQuery = usePluginHealthSummary(api);
    const health = healthQuery.isSuccess ? healthQuery.data : undefined;
    const capable = !!health?.capabilities.includes(TRAKT_CAPABILITY) && health.traktInstalled;
    const status = useQuery({
        queryKey: ['JellyfinMod', api.basePath, userId, 'Trakt', itemId],
        queryFn: ({ signal }) => getTraktItemStatus(api, itemId, { signal }),
        enabled: capable,
        retry: false,
        staleTime: TRAKT_STALE_MS
    });
    if (!capable || !status.data?.installed || !status.data.hasHistory) return null;
    const synced = status.data.lastSyncedAt ? new Date(status.data.lastSyncedAt) : null;
    const syncedOn = synced && !Number.isNaN(synced.getTime()) ? synced.toLocaleDateString() : null;
    const label = traktLabel(syncedOn);
    return <p className='jfmod-traktIndicator' role='note' title={label} aria-label={label}>
        <span className='jfmod-traktIndicator-chip'>Trakt</span>{' '}
        <span>Watch history synced{syncedOn && synced ? <>{' · '}<time dateTime={synced.toISOString()}>{syncedOn}</time></> : null}</span>
    </p>;
};

export default TraktIndicator;
