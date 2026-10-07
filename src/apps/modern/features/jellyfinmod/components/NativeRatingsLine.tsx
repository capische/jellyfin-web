import type { Api } from '@jellyfin/sdk/lib/api';
import { useQuery } from '@tanstack/react-query';
import React, { type FC } from 'react';

import { queryClient } from 'utils/query/queryClient';

import { getItemRatings } from '../api/ratingsApi';
import { RATINGS_CAPABILITY, RATINGS_STALE_MS } from '../constants/ratings';
import { usePluginCapabilities } from '../hooks/useAcquisition';
import { prefetchRatingsPreferences, useRatingsPreferences } from '../hooks/useRatingsPreferences';
import RatingsLine from './RatingsLine';

interface NativeRatingsLineProps {
    api: Api;
    userId: string;
    itemId: string;
}

/** The query key of a native item's ratings, so a manual refresh can ask for it again. */
export const itemRatingsKey = (basePath: string, userId: string, itemId: string) => ['JellyfinMod', basePath, userId, 'Ratings', itemId];

/** Loads a native page's ratings and the user's choice into the cache before the page mounts its line; bounded to 3 s. */
export const prefetchItemRatings = async (api: Api, userId: string, itemId: string) => {
    await prefetchRatingsPreferences(api, userId);
    const capabilities = queryClient.getQueryData<{ capabilities: string[] }>(['JellyfinMod', api.basePath, 'HealthCapabilities'])?.capabilities;
    if (!capabilities?.includes(RATINGS_CAPABILITY)) return;
    await Promise.race([
        queryClient.fetchQuery({ queryKey: itemRatingsKey(api.basePath, userId, itemId), queryFn: ({ signal }) => getItemRatings(api, itemId, { signal }),
            staleTime: RATINGS_STALE_MS, retry: false }).catch(() => undefined),
        new Promise(resolve => setTimeout(resolve, 3000))
    ]);
};

/**
 * The Ratings line on a native movie or series page (P9.R6). It asks only a plugin that lists `ratings`, while ratings are
 * on; any failure, an older plugin or ratings turned off renders nothing, and the page is otherwise unchanged.
 */
const NativeRatingsLine: FC<NativeRatingsLineProps> = ({ api, userId, itemId }) => {
    const supported = usePluginCapabilities(api).includes(RATINGS_CAPABILITY);
    const preferences = useRatingsPreferences(api);
    const ratings = useQuery({
        queryKey: itemRatingsKey(api.basePath, userId, itemId),
        queryFn: ({ signal }) => getItemRatings(api, itemId, { signal }),
        enabled: supported && preferences.enabled,
        retry: false,
        staleTime: RATINGS_STALE_MS,
        // New values (a refresh, the daily task) reach an open page within a minute.
        refetchInterval: RATINGS_STALE_MS
    });
    if (!supported || !preferences.enabled) return null;
    // The line decides once its answer is in whether it may still appear without moving a focused control.
    return <RatingsLine ratings={ratings.data?.ratings} sources={preferences.sources} ready={ratings.isSuccess} />;
};

export default NativeRatingsLine;
