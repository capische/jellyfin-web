import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi } from 'hooks/useApi';
import { useUserSettings } from 'hooks/useUserSettings';
import type { LibraryViewSettings, ParentId } from 'types/library';
import { LibraryTab } from 'types/libraryTab';

import { browseEntries, type BrowseRequest } from '../api/modApi';
import { usePluginHealth } from './useEntries';

export function useBrowse(viewType: LibraryTab | undefined, libraryId: ParentId, settings: LibraryViewSettings) {
    const { api, user } = useApi();
    const health = usePluginHealth();
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
    return {
        ...result,
        data: result.isError || health.isError ? undefined : result.data,
        isSelectingSource: supported && !!user?.Id && (health.isPending || health.data?.ok === true && result.isPending)
    };
}
