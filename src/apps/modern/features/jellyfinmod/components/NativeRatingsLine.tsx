import type { Api } from '@jellyfin/sdk/lib/api';
import { useQuery } from '@tanstack/react-query';
import React, { type FC, useEffect, useState } from 'react';

import { queryClient } from 'utils/query/queryClient';

import { getItemRatings } from '../api/ratingsApi';
import { RATINGS_CAPABILITY, RATINGS_STALE_MS } from '../constants/ratings';
import { usePluginHealthSummary } from '../hooks/useAcquisition';
import { loadPluginCapabilities, loadRatingsPreferences, useRatingsPreferences } from '../hooks/useRatingsPreferences';
import RatingsGroup from './RatingsGroup';

interface NativeRatingsLineProps {
    api: Api;
    userId: string;
    itemId: string;
    /** The item's type, once the page has read it; only a movie or series has ratings. */
    itemType: Promise<string | undefined>;
    /** The type already known when the group mounts (null: the read failed; undefined: not answered yet). */
    knownType?: string | null;
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
 * The ratings on a native movie or series page (P9.R6; user decisions 10 and 13, 2026-10-08): a group in upstream's first metadata
 * row, in place of the stock star and tomato. It is mounted as upstream fills the row, before anything is known, and reserves
 * its space at once; it gives the space back when the item has none (not a movie or series, an older plugin, ratings off).
 */
const NativeRatingsLine: FC<NativeRatingsLineProps> = ({ api, userId, itemId, itemType, knownType }) => {
    const health = usePluginHealthSummary(api);
    const supported = !!health.data?.capabilities.includes(RATINGS_CAPABILITY);
    const preferences = useRatingsPreferences(api);
    const [type, setType] = useState<string | null | undefined>(knownType);
    useEffect(() => {
        let current = true;
        itemType.then(value => current && setType(value ?? null), () => current && setType(null));
        return () => {
            current = false;
        };
    }, [itemType]);
    const ratings = useQuery({
        queryKey: itemRatingsKey(api.basePath, userId, itemId),
        queryFn: ({ signal }) => getItemRatings(api, itemId, { signal }),
        enabled: supported && preferences.enabled,
        retry: false,
        staleTime: RATINGS_STALE_MS,
        // New values (a refresh, the daily task) reach an open page within a minute.
        refetchInterval: RATINGS_STALE_MS
    });
    const typeKnown = type !== undefined;
    let wanted: boolean | undefined;
    if ((typeKnown && type !== 'Movie' && type !== 'Series') || health.isError || (health.isSuccess && !supported)
        || (preferences.loaded && !preferences.enabled)) wanted = false;
    else if (typeKnown && supported && preferences.loaded) wanted = true;
    // A failed minute's read keeps the last answer (react-query keeps its data): only a first answer that failed is "none".
    const ready = wanted === true && (ratings.data !== undefined || ratings.isError);
    return <RatingsGroup ratings={ratings.data?.ratings ?? (ratings.isError ? [] : undefined)} sources={preferences.sources} ready={ready}
        wanted={wanted} />;
};

export default NativeRatingsLine;
