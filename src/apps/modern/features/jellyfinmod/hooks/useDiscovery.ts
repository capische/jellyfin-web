import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useApi } from 'hooks/useApi';
import { searchDiscovery } from '../api/modApi';
import { usePluginHealth } from './useEntries';

const MAX_EMPTY_PAGES = 3;

/**
 * Whether a search has run out of its budget: its last pages were all empty after filtering (held or restricted titles), though TMDB
 * offers more. Nothing follows such a search by itself, neither this hook nor the search grid's end of page (tm2.r1).
 */
export const isDiscoveryExhausted = (pages: { items: unknown[] }[] | undefined) => {
    let trailing = 0;
    for (let index = (pages?.length ?? 0) - 1; index >= 0 && pages![index].items.length === 0; index--) trailing++;
    return trailing >= MAX_EMPTY_PAGES;
};

export const useDiscovery = (mediaType: 'movie' | 'series', parentId: string | undefined, query: string, enabled: boolean) => {
    const { api, user } = useApi();
    const health = usePluginHealth();
    const result = useInfiniteQuery({
        queryKey: ['JellyfinMod', api?.basePath, user?.Id, 'DiscoverPages', mediaType, parentId, query],
        queryFn: ({ signal, pageParam }) => searchDiscovery(api!, {
            q: query, type: mediaType, targetLibraryId: parentId, page: pageParam
        }, { signal }),
        initialPageParam: 1,
        getNextPageParam: page => page.nextPage,
        enabled: enabled && !!api && !!user?.Id && health.data?.ok === true && query.length >= 2,
        retry: false
    });
    const { data, hasNextPage, isFetching, isError, fetchNextPage } = result;
    const pages = data?.pages ?? [];
    const lastEmpty = pages.at(-1)?.items.length === 0;
    const exhausted = isDiscoveryExhausted(pages);
    useEffect(() => {
        // Held/restricted titles can exclude a whole remote page without exhausting search, but auto-follow
        // stops after three empty pages in a row (P1.W13).
        if (enabled && lastEmpty && !exhausted && hasNextPage && !isFetching && !isError) {
            fetchNextPage().catch(console.error);
        }
    }, [enabled, lastEmpty, exhausted, pages.length, hasNextPage, isFetching, isError, fetchNextPage]);
    return result;
};
