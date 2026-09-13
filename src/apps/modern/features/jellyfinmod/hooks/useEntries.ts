import { queryOptions, useQuery } from '@tanstack/react-query';
import type { Api } from '@jellyfin/sdk/lib/api';

import { useApi } from 'hooks/useApi';

import { type EntryQuery, getEntries, getPluginHealth } from '../api/modApi';

/**
 * Entries for the current scope.
 *
 * `placeholderData` keeps the previous page on screen while a filter change refetches: a grid that
 * blanks throws D-pad focus to the top of the page, which is a bug on the TV, not a nicety.
 */
export const getEntriesQuery = (api?: Api, params: EntryQuery = {}, userId?: string) =>
    queryOptions({
        queryKey: ['JellyfinMod', api?.basePath, userId, 'Entries', params],
        queryFn: ({ signal }) => getEntries(api!, params, { signal }),
        placeholderData: (previous, previousQuery) => previousQuery?.queryKey[1] === api?.basePath
            && previousQuery?.queryKey[2] === userId ? previous : undefined,
        enabled: !!api && !!userId,
        // The fork must stay usable when the plugin is absent or older than the web bundle.
        retry: false
    });

export const useEntries = (params: EntryQuery = {}) => {
    const { api, user } = useApi();
    return useQuery(getEntriesQuery(api, params, user?.Id));
};

/** Whether the plugin is installed and answering. Drives graceful degradation. */
export const usePluginHealth = () => {
    const { api, user } = useApi();
    return useQuery({
        queryKey: ['JellyfinMod', api?.basePath, user?.Id, 'Health'],
        queryFn: ({ signal }) => getPluginHealth(api!, { signal }),
        enabled: !!api && !!user?.Id,
        retry: false,
        staleTime: 5 * 60 * 1000
    });
};
