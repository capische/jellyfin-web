import { type Query, useQuery } from '@tanstack/react-query';

import { useApi } from 'hooks/useApi';

import { getQueue } from '../api/modApi';
import { QUEUE_CAPABILITY, QUEUE_POLL_MS } from '../constants/queue';
import type { QueueList, QueueRow } from '../types/queue';
import { usePluginHealth } from './useEntries';

/** 403 `queue_admin_only`: the administrator keeps the queue private. Not an error to retry or spin on. */
export const isQueueAdminOnly = (error: unknown): boolean =>
    (error as { response?: { status?: number } } | null)?.response?.status === 403;

/**
 * Whether this server's plugin serves the queue. `known` is false until Health has answered; an absent or older
 * plugin, or a failed Health read, is known and unavailable, so callers render the UX §14 message, never a spinner.
 */
export const useQueueCapability = () => {
    const health = usePluginHealth();
    const available = health.data?.ok === true && health.data.capabilities.includes(QUEUE_CAPABILITY);
    return {
        available,
        known: health.isSuccess || health.isError,
        pluginMissing: health.isError || health.data?.ok === false
    };
};

interface UseQueueOptions {
    enabled: boolean;
    /** Poll every 3 s while the consumer is mounted (UX §10); react-query pauses it while the tab is hidden. */
    poll: boolean;
}

/**
 * The queue, shared by the route, the user menu probe and every in-flight mark through one query key, so any
 * number of consumers cost one request per tick. Previous rows stay while a poll is in flight, so the list is
 * never unmounted by a poll (UX §13).
 */
export const useQueue = ({ enabled, poll }: UseQueueOptions) => {
    const { api, user } = useApi();
    const query = useQuery({
        queryKey: ['JellyfinMod', api?.basePath, user?.Id, 'Queue'],
        queryFn: ({ signal }) => getQueue(api!, {}, { signal }),
        enabled: enabled && !!api && !!user?.Id,
        placeholderData: previous => previous,
        retry: false,
        // A probe (menu item, View queue links) reuses whatever the last read said for a minute.
        staleTime: poll ? 0 : 60 * 1000,
        refetchOnWindowFocus: poll,
        // A private queue answers 403 until an administrator changes the setting; asking every 3 s changes nothing.
        refetchInterval: (current: Query<QueueList>) => poll && !isQueueAdminOnly(current.state.error) ? QUEUE_POLL_MS : false
    });
    return { ...query, adminOnly: isQueueAdminOnly(query.error) };
};

const IMPORT_FINISHED = new Set(['seeding']);

/**
 * The live queue row for one movie entry or one episode, for marks and detail lines that show `grabbed` or
 * `downloading`. Reading the queue keeps a card ring and the queue row on the same value within one poll (P5.I3).
 */
export const useQueueRowFor = (entryId: string | undefined, episodeId: string | null | undefined, active: boolean): QueueRow | undefined => {
    const capability = useQueueCapability();
    const queue = useQueue({ enabled: active && capability.available && !!entryId, poll: true });
    if (!active || !capability.available || !entryId) return undefined;
    const rows = queue.data?.items.filter(row => row.entry?.id === entryId
        && (episodeId ? row.episode?.id === episodeId : !row.episode)) ?? [];
    return rows.find(row => !IMPORT_FINISHED.has(row.state)) ?? rows[0];
};

/**
 * Whether to offer a way into the queue (the user menu item, **View queue** links): the plugin serves it and the
 * caller may read it. Administrators always may; an ordinary user only when a probe of the queue did not answer 403.
 */
export const useQueueVisible = (wanted = true) => {
    const { user } = useApi();
    const capability = useQueueCapability();
    const isAdmin = !!user?.Policy?.IsAdministrator;
    const probe = useQueue({ enabled: wanted && capability.available && !isAdmin, poll: false });
    if (!wanted || !capability.available) return false;
    if (isAdmin) return true;
    return probe.isSuccess || (probe.isError && !probe.adminOnly);
};
