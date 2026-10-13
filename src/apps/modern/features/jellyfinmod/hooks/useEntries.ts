import { queryOptions, useQuery } from '@tanstack/react-query';
import type { Api } from '@jellyfin/sdk/lib/api';
import { ItemFields } from '@jellyfin/sdk/lib/generated-client/models/item-fields';
import { getShowApi } from '@jellyfin/sdk/lib/utils/api/show-api';

import { useApi } from 'hooks/useApi';
import { queryClient } from 'utils/query/queryClient';

import { type EntryQuery, getEntries, getEntry, getPluginHealth } from '../api/modApi';

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

/*
 * A native detail page's entry, read as soon as the page's route is known and kept by entry, so every page of one title (the
 * series, its seasons, the mod's own season and episode pages) draws at once from what any of them read before and refreshes
 * it in the background (P1.FU16). The shared query client keeps it across visits and, through its persister, across reloads.
 */

const normalId = (id: string) => id.replace(/-/g, '').toLowerCase();

/** The entry a Jellyfin item belongs to (a native episode finds its series), or null when the plugin has none. */
export const entryIdQuery = (api: Api, userId: string, jellyfinItemId: string) => queryOptions({
    queryKey: ['JellyfinMod', api.basePath, userId, 'EntryFor', normalId(jellyfinItemId)],
    queryFn: async ({ signal }) => (await getEntries(api, { jellyfinItemId, limit: 1 }, { signal })).items[0]?.id ?? null,
    retry: false
});

/** An entry's detail: its episodes, seasons, versions and history. */
export const entryDetailQuery = (api: Api, userId: string, entryId: string) => queryOptions({
    queryKey: ['JellyfinMod', api.basePath, userId, 'EntryDetail', entryId],
    queryFn: ({ signal }) => getEntry(api, entryId, { signal }),
    retry: false
});

/** What a native page needs to know of its item before it draws: its type, a season's series and number, a series' genres. */
export interface NativeItemFacts {
    Id?: string;
    Type?: string;
    SeriesId?: string;
    IndexNumber?: number;
    Genres?: string[];
}

type NativeItem = { Id?: string; Type?: string; SeriesId?: string | null; IndexNumber?: number | null; Genres?: string[] | null };

/** The facts kept of a native item read from Jellyfin. */
export const nativeItemFacts = (item: NativeItem | null | undefined): NativeItemFacts => ({ Id: item?.Id, Type: item?.Type,
    SeriesId: item?.SeriesId ?? undefined, IndexNumber: item?.IndexNumber ?? undefined, Genres: item?.Genres ?? undefined });

/** A native item's facts; they never change, so a page seen before (or a season listed on its series' page) needs no read. */
export const nativeItemKey = (api: Api, userId: string, itemId: string) => ['JellyfinMod', api.basePath, userId, 'NativeItem', normalId(itemId)];

const keepItemFacts = (api: Api, userId: string, items: NativeItem[]) => {
    for (const item of items) {
        if (item.Id) queryClient.setQueryData<NativeItemFacts>(nativeItemKey(api, userId, item.Id), nativeItemFacts(item));
    }
};

/**
 * A series' Jellyfin seasons; each is kept as a known item, so opening one from here needs no item read. Each carries its
 * `ChildCount`, the episodes Jellyfin has, for the season cards' "N episodes" line (P1.FU21).
 */
export const nativeSeasonsQuery = (api: Api, userId: string, seriesId: string) => queryOptions({
    queryKey: ['JellyfinMod', api.basePath, userId, 'NativeSeasons', seriesId],
    queryFn: async ({ signal }) => {
        const items = (await getShowApi(api).getSeasons({ seriesId, userId, fields: [ItemFields.ChildCount] }, { signal })).data.Items ?? [];
        keepItemFacts(api, userId, items);
        return items;
    },
    retry: false
});

/** A season's Jellyfin episodes. */
export const nativeEpisodesQuery = (api: Api, userId: string, seriesId: string, seasonId: string) => queryOptions({
    queryKey: ['JellyfinMod', api.basePath, userId, 'NativeEpisodes', seasonId],
    queryFn: async ({ signal }) => (await getShowApi(api).getEpisodes({ seriesId, seasonId, userId }, { signal })).data.Items ?? [],
    retry: false
});

/** Starts reading the entry of a native page's item (for a season, its series'), unless it is fresh already. */
export const prefetchNativeEntry = (api: Api, userId: string, jellyfinItemId: string) => {
    queryClient.fetchQuery(entryIdQuery(api, userId, jellyfinItemId)).then(entryId => (entryId ?
        queryClient.prefetchQuery(entryDetailQuery(api, userId, entryId)) : undefined)).catch(() => undefined);
};

/** Starts the reads a native series or season page draws its missing seasons or episodes from (P1.FU11). */
export const prefetchNativeChildren = (api: Api, userId: string, itemId: string, facts: NativeItemFacts) => {
    if (facts.Type === 'Series') queryClient.prefetchQuery(nativeSeasonsQuery(api, userId, itemId)).catch(() => undefined);
    if (facts.Type === 'Season' && facts.SeriesId) {
        queryClient.prefetchQuery(nativeEpisodesQuery(api, userId, facts.SeriesId, itemId)).catch(() => undefined);
    }
};
