import type { Api } from '@jellyfin/sdk/lib/api';
import { useQuery } from '@tanstack/react-query';
import React, { type FC } from 'react';

import { queryClient } from 'utils/query/queryClient';

import { getItemRatings } from '../api/ratingsApi';
import { RATINGS_CAPABILITY, RATINGS_STALE_MS } from '../constants/ratings';
import { usePluginCapabilities } from '../hooks/useAcquisition';
import { loadPluginCapabilities, loadRatingsPreferences, useRatingsPreferences } from '../hooks/useRatingsPreferences';
import RatingsLine from './RatingsLine';

interface NativeRatingsLineProps {
    api: Api;
    userId: string;
    itemId: string;
}

/** The query key of a native item's ratings, so a manual refresh can ask for it again. */
export const itemRatingsKey = (basePath: string, userId: string, itemId: string) => ['JellyfinMod', basePath, userId, 'Ratings', itemId];

/**
 * Loads a native page's ratings and the user's choice into the cache before the page mounts its line. Both loads run side
 * by side under one 3 s deadline (web review 2026-10-07 round 2: they were two 3 s waits one after the other).
 */
export const prefetchItemRatings = async (api: Api, userId: string, itemId: string) => {
    const ratings = (async () => {
        const health = await loadPluginCapabilities(api);
        if (!health.capabilities.includes(RATINGS_CAPABILITY)) return;
        await queryClient.fetchQuery({ queryKey: itemRatingsKey(api.basePath, userId, itemId),
            queryFn: ({ signal }) => getItemRatings(api, itemId, { signal }), staleTime: RATINGS_STALE_MS, retry: false });
    })().catch(() => undefined);
    await Promise.race([Promise.all([loadRatingsPreferences(api, userId), ratings]), new Promise(resolve => setTimeout(resolve, 3000))]);
};

/**
 * The ratings on a native movie or series page (P9.R6), inline in the row with the stock star. It asks only a plugin that lists `ratings`, while ratings are
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
    if (!supported) return null;
    // Ratings turned off later empties the line through the same rule as any other change, so it never jumps under a
    // focused control. A failed minute's read keeps the last answer (react-query keeps its data): only a first answer that
    // failed counts as "nothing to show" (web review 2026-10-07 round 2, P2 1).
    const ready = preferences.loaded && (!preferences.enabled || ratings.data !== undefined || ratings.isError);
    return <RatingsLine ratings={preferences.enabled ? ratings.data?.ratings : []} sources={preferences.sources} ready={ready} inline />;
};

export default NativeRatingsLine;
