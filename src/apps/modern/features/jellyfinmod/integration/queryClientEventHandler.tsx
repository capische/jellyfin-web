import type { LibraryUpdateInfo } from '@jellyfin/sdk/lib/generated-client/models/library-update-info';
import type { TaskInfo } from '@jellyfin/sdk/lib/generated-client/models/task-info';
import type { UserDataChangeInfo } from '@jellyfin/sdk/lib/generated-client/models/user-data-change-info';
import { OutboundWebSocketMessageType } from '@jellyfin/sdk/lib/websocket';
import { hashKey, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, type FC } from 'react';

import { EventType } from 'constants/eventType';
import { useApi } from 'hooks/useApi';
import Events from 'utils/events';

import { invalidateCatalog } from './invalidateCatalog';
import { useEntryFallbackPoll } from '../hooks/useEntryFallbackPoll';
import type { QueueList } from '../types/queue';

/** Keeps JellyfinMod catalog surfaces current without changing upstream query ownership. */
const JellyfinModQueryClientEventHandler: FC = () => {
    const queryClient = useQueryClient();
    const { api, user } = useApi();
    const libraryRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const reconciliationTaskRunning = useRef(false);
    // The one fallback for a push that does not come (P4.FU12).
    useEntryFallbackPoll();

    const invalidateCatalogQueries = useCallback(() => {
        if (api) invalidateCatalog(api, user?.Id);
    }, [api, user?.Id]);

    const invalidateUserDataQueries = useCallback(() => {
        if (!user?.Id) return;

        void queryClient.invalidateQueries({ queryKey: ['User', user.Id, 'Items'] });
        // Continue Watching is drawn from these: an episode finished on another device moves it on.
        void queryClient.invalidateQueries({ queryKey: ['User', user.Id, 'ResumeItems'] });
        void queryClient.invalidateQueries({ queryKey: ['User', user.Id, 'NextUp'] });
        if (api) {
            // ContinueWatching holds the show play dates Next Up is ordered by.
            const userDataSurfaces = new Set(['HomeHero', 'HomeRecent', 'ContinueWatching', 'Browse', 'SearchBrowse', 'EntryDetail']);
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

        if (libraryRefreshTimer.current) return;
        libraryRefreshTimer.current = setTimeout(() => {
            libraryRefreshTimer.current = null;
            invalidateCatalogQueries();
        }, 250);
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

    // An import that finished (P4.FU11, P4.FU12): its queue row turned `seeding`, or a pack episode's import `completed`. The
    // plugin completes an import only once Jellyfin can play the file and tells the clients itself at once (an early
    // LibraryChanged), but a client that missed that (a lost socket, a reload) reads its items again from the shared queue read.
    useEffect(() => {
        if (!api || !user?.Id) return;
        const queueHash = hashKey(['JellyfinMod', api.basePath, user.Id, 'Queue']);
        const finished = new Map<string, boolean>();
        return queryClient.getQueryCache().subscribe(event => {
            if (event.type !== 'updated' || event.action.type !== 'success' || event.query.queryHash !== queueHash) return;
            let done = false;
            // A row already finished in the first answer after a reload or a lost socket (P4.FU12) counts too, when it finished
            // lately: the page read its items before the import ended, and nothing else tells it.
            const lately = (updatedAt: string) => Date.now() - Date.parse(updatedAt) < 5 * 60 * 1000;
            const note = (id: string, now: boolean, updatedAt: string) => {
                if (now && (finished.get(id) === false || (finished.get(id) === undefined && lately(updatedAt)))) done = true;
                finished.set(id, now);
            };
            for (const row of (event.query.state.data as QueueList | undefined)?.items ?? []) {
                note(row.id, row.state === 'seeding', row.updatedAt);
                for (const episode of row.pack?.episodes ?? []) {
                    note(row.id + ':' + episode.episodeId, episode.importState === 'completed', row.updatedAt);
                }
            }
            if (done) invalidateCatalogQueries();
        });
    }, [api, invalidateCatalogQueries, queryClient, user?.Id]);

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

export default JellyfinModQueryClientEventHandler;
