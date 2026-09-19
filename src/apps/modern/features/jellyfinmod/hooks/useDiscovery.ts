import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useApi } from 'hooks/useApi';
import { searchDiscovery } from '../api/modApi';
import { usePluginHealth } from './useEntries';

const MAX_EMPTY_PAGES = 3;

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
    let trailingEmpty = 0;
    for (let index = pages.length - 1; index >= 0 && pages[index].items.length === 0; index--) trailingEmpty++;
    useEffect(() => {
        // Held/restricted titles can exclude a whole remote page without exhausting search, but auto-follow
        // stops after three empty pages in a row; the "More results" control continues on request (P1.W13).
        if (enabled && trailingEmpty > 0 && trailingEmpty < MAX_EMPTY_PAGES && hasNextPage && !isFetching && !isError) {
            fetchNextPage().catch(console.error);
        }
    }, [enabled, trailingEmpty, hasNextPage, isFetching, isError, fetchNextPage]);
    return result;
};
