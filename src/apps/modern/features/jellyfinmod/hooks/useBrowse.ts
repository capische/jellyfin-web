import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi } from 'hooks/useApi';
import { useUserSettings } from 'hooks/useUserSettings';
import type { LibraryViewSettings, ParentId } from 'types/library';
import { LibraryTab } from 'types/libraryTab';

import { browseEntries, type BrowseRequest } from '../api/modApi';
import { RATINGS_CARDS_CAPABILITY } from '../constants/ratings';
import { usePluginHealth } from './useEntries';
import { useRatingsPreferences } from './useRatingsPreferences';

export function useBrowse(viewType: LibraryTab | undefined, libraryId: ParentId, settings: LibraryViewSettings) {
    const { api, user } = useApi();
    const health = usePluginHealth();
    // One rating on cards (P9.R7): asked for only when the user chose a source and this plugin understands the field, so an
    // older plugin never sees it (P1.W14) and, with the preference off, the request and the cards are exactly as before.
    const { cardSource } = useRatingsPreferences(api);
    const ratingSource = cardSource && health.data?.capabilities?.includes(RATINGS_CARDS_CAPABILITY) ? cardSource : undefined;
    const { libraryPageSize } = useUserSettings();
    // This seed only stabilizes shuffle order across pages; it is not a security token.
    // eslint-disable-next-line sonarjs/pseudo-random
    const [randomSeed] = useState(() => String(Math.random()));
    const filters = settings.Filters;
    const request: BrowseRequest = {
        mediaType: viewType === LibraryTab.Series ? 'series' : 'movie',
        targetLibraryId: libraryId || undefined,
        sortBy: settings.SortBy,
        sortOrder: settings.SortOrder,
        randomSeed,
        startIndex: settings.StartIndex,
        limit: libraryPageSize || undefined,
        alphabet: settings.Alphabet,
        state: filters?.FileStates,
        // An older plugin rejects the unknown field with 400 (P1.W14).
        dueWithinDays: health.data?.capabilities?.includes('browse.dueWithinDays') ? filters?.RetentionDueWithinDays : undefined,
        ratingSource,
        filters: {
            genres: filters?.Genres,
            years: filters?.Years,
            officialRatings: filters?.OfficialRatings,
            tags: filters?.Tags,
            studioIds: filters?.StudioIds,
            status: filters?.Status,
            seriesStatus: filters?.SeriesStatus,
            features: filters?.Features,
            videoBasicFilter: filters?.VideoBasicFilter,
            videoTypes: filters?.VideoTypes,
            audioLanguages: filters?.AudioLanguages,
            subtitleLanguages: filters?.SubtitleLanguages
        }
    };
    const supported = viewType === LibraryTab.Movies || viewType === LibraryTab.Series;
    const result = useQuery({
        queryKey: ['JellyfinMod', api?.basePath, user?.Id, 'Browse', libraryId, request],
        queryFn: ({ signal }) => browseEntries(api!, request, { signal }),
        enabled: !!api && !!user?.Id && health.data?.ok === true && supported,
        placeholderData: (previous, previousQuery) => previousQuery?.queryKey[1] === api?.basePath
            && previousQuery?.queryKey[2] === user?.Id && previousQuery?.queryKey[4] === libraryId
            && (previousQuery?.queryKey[5] as BrowseRequest | undefined)?.mediaType === request.mediaType ? previous : undefined,
        retry: false
    });
    // A failed background refetch keeps the catalog rows already shown; only a missing plugin (404) or a
    // first load that never succeeded falls back to the native grid (P1.W14).
    const missing = (result.error as { response?: { status?: number } } | null)?.response?.status === 404;
    return {
        ...result,
        // Favorites, Collections, Studios and the other tabs share the Movies request's key: their cached or placeholder
        // rows must never stand in for the tab's own native results (whole-review chunk 4c, P2 1).
        data: !supported || health.isError || missing ? undefined : result.data,
        isSelectingSource: supported && !!user?.Id && (health.isPending || health.data?.ok === true && result.isPending)
    };
}
