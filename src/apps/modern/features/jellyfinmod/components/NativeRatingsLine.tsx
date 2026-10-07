import type { Api } from '@jellyfin/sdk/lib/api';
import { useQuery } from '@tanstack/react-query';
import React, { type FC } from 'react';

import { getItemRatings } from '../api/ratingsApi';
import { RATINGS_CAPABILITY, RATINGS_STALE_MS } from '../constants/ratings';
import { usePluginCapabilities } from '../hooks/useAcquisition';
import { useRatingsPreferences } from '../hooks/useRatingsPreferences';
import RatingsLine from './RatingsLine';

interface NativeRatingsLineProps {
    api: Api;
    userId: string;
    itemId: string;
}

/** The query key of a native item's ratings, so a manual refresh can ask for it again. */
export const itemRatingsKey = (basePath: string, userId: string, itemId: string) => ['JellyfinMod', basePath, userId, 'Ratings', itemId];

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
        staleTime: RATINGS_STALE_MS
    });
    if (!supported || !preferences.enabled || !ratings.data) return null;
    return <RatingsLine ratings={ratings.data.ratings} sources={preferences.sources} />;
};

export default NativeRatingsLine;
