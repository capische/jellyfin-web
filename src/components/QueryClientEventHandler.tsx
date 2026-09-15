import type { LibraryUpdateInfo } from '@jellyfin/sdk/lib/generated-client/models/library-update-info';
import type { TaskInfo } from '@jellyfin/sdk/lib/generated-client/models/task-info';
import type { UserDataChangeInfo } from '@jellyfin/sdk/lib/generated-client/models/user-data-change-info';
import { OutboundWebSocketMessageType } from '@jellyfin/sdk/lib/websocket';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, type FC } from 'react';

import { EventType } from 'constants/eventType';
import { useApi } from 'hooks/useApi';
import Events from 'utils/events';

/** Component that handles mapping events to query client actions. */
const QueryClientEventHandler: FC = () => {
    const queryClient = useQueryClient();
    const { api, user } = useApi();
    const libraryRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const reconciliationTaskRunning = useRef(false);

    const invalidateCatalogQueries = useCallback(() => {
        if (!user?.Id) return;

        void queryClient.invalidateQueries({ queryKey: ['User', user.Id, 'Items'] });
        if (api) {
            void queryClient.invalidateQueries({
                queryKey: ['JellyfinMod', api.basePath, user.Id]
            });
        }
    }, [api, queryClient, user?.Id]);

    const invalidateUserDataQueries = useCallback(() => {
        if (!user?.Id) return;

        void queryClient.invalidateQueries({ queryKey: ['User', user.Id, 'Items'] });
        if (api) {
            const userDataSurfaces = new Set(['HomeHero', 'HomeRecent', 'Browse', 'SearchBrowse', 'NativeDetail']);
            void queryClient.invalidateQueries({
                predicate: query => query.queryKey[0] === 'JellyfinMod'
                    && query.queryKey[1] === api.basePath
                    && query.queryKey[2] === user.Id
                    && userDataSurfaces.has(String(query.queryKey[3]))
            });
        }
    }, [api, queryClient, user?.Id]);

    const onUserDataChanged = useCallback(({ Data }: { Data?: UserDataChangeInfo }) => {
        const changedUserId = Data?.UserId?.replace(/-/g, '').toLowerCase();
        const currentUserId = user?.Id?.replace(/-/g, '').toLowerCase();
        if (!changedUserId || changedUserId === currentUserId) {
            invalidateUserDataQueries();
        }
    }, [invalidateUserDataQueries, user?.Id]);

    const onLibraryChanged = useCallback(({ Data }: { Data?: LibraryUpdateInfo }) => {
        if (!Data || !(Data.ItemsAdded?.length || Data.ItemsRemoved?.length || Data.ItemsUpdated?.length)) {
            return;
        }

        if (libraryRefreshTimer.current) clearTimeout(libraryRefreshTimer.current);
        libraryRefreshTimer.current = setTimeout(invalidateCatalogQueries, 10000);
    }, [invalidateCatalogQueries]);

    const onScheduledTasksChanged = useCallback(({ Data }: { Data?: TaskInfo[] | null }) => {
        const tasks = Data?.filter(task => task.Key === 'RefreshLibrary'
            || task.Key === 'JellyfinModCatalogReconciliation');
        if (!tasks?.length) return;

        const isRunning = tasks.some(task => task.State !== 'Idle');
        if (reconciliationTaskRunning.current && !isRunning) {
            if (libraryRefreshTimer.current) clearTimeout(libraryRefreshTimer.current);
            libraryRefreshTimer.current = null;
            invalidateCatalogQueries();
        }
        reconciliationTaskRunning.current = isRunning;
    }, [invalidateCatalogQueries]);

    useEffect(() => {
        Events.on(document, EventType.REFRESH_NEEDED, invalidateCatalogQueries);

        const unsubscribe = api ? [
            api.subscribe([OutboundWebSocketMessageType.UserDataChanged], onUserDataChanged),
            api.subscribe([OutboundWebSocketMessageType.LibraryChanged], onLibraryChanged),
            api.subscribe([OutboundWebSocketMessageType.ScheduledTasksInfo], onScheduledTasksChanged)
        ] : [];

        return () => {
            Events.off(document, EventType.REFRESH_NEEDED, invalidateCatalogQueries);
            unsubscribe.forEach(handler => {
                handler();
            });
            if (libraryRefreshTimer.current) clearTimeout(libraryRefreshTimer.current);
        };
    }, [api, invalidateCatalogQueries, onLibraryChanged, onScheduledTasksChanged, onUserDataChanged]);

    return null;
};

export default QueryClientEventHandler;
