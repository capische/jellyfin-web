import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useApi } from 'hooks/useApi';
import { searchDiscovery } from '../api/modApi';
import { usePluginHealth } from './useEntries';

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
    const emptyPage = data?.pages[data.pages.length - 1]?.items.length === 0;
    useEffect(() => {
        // Held/restricted titles can exclude a whole remote page without exhausting search.
        if (enabled && emptyPage && hasNextPage && !isFetching && !isError) {
            fetchNextPage().catch(console.error);
        }
    }, [enabled, emptyPage, hasNextPage, isFetching, isError, fetchNextPage]);
    return result;
};
