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

const QUEUE_SLOW_POLL_MS = 60 * 1000;
const intervalOf = (poll: true | 'slow') => (poll === 'slow' ? QUEUE_SLOW_POLL_MS : QUEUE_POLL_MS);

interface UseQueueOptions {
    enabled: boolean;
    /**
     * `true` polls every 3 s while the consumer is mounted (UX §10); `'slow'` once a minute, for a held episode's page that
     * only watches for a pack starting on it (season packs, 2026-10-08); react-query pauses either while the tab is hidden.
     */
    poll: boolean | 'slow';
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
        staleTime: poll === true ? 0 : QUEUE_SLOW_POLL_MS,
        refetchOnWindowFocus: poll === true,
        // A private queue answers 403 until an administrator changes the setting; asking every 3 s changes nothing.
        refetchInterval: (current: Query<QueueList>) => (!poll || isQueueAdminOnly(current.state.error) ? false : intervalOf(poll)),
        // A queue that answered 403 is not asked again on every page that mounts a probe; polling consumers still recover.
        retryOnMount: false
    });
    return { ...query, adminOnly: isQueueAdminOnly(query.error) };
};

const IMPORT_FINISHED = new Set(['seeding']);
/** A pack episode's import that is over: it no longer stands for that episode's current work. */
const EPISODE_IMPORT_OVER = new Set(['completed', 'done', 'cancelled', 'failed', 'refused']);

const ownEpisode = (row: QueueRow, episodeId: string | null | undefined) => row.pack?.episodes.find(item => item.episodeId === episodeId);

/** The pack row still holds this episode: the torrent is not finished and the episode's own import is not over. */
export const packHolds = (row: QueueRow, episodeId: string | null | undefined) => {
    const own = ownEpisode(row, episodeId);
    return !!own && !IMPORT_FINISHED.has(row.state) && (own.importState === null || !EPISODE_IMPORT_OVER.has(own.importState));
};

/** The pack row is moving this episode along: it holds it and the episode's import is not blocked. */
const packWorksOn = (row: QueueRow, episodeId: string | null | undefined) =>
    packHolds(row, episodeId) && ownEpisode(row, episodeId)?.importState !== 'blocked';

/** 2 = current work for the target, 1 = needs attention, 0 = history. */
const rank = (row: QueueRow, episodeId: string | null | undefined) => {
    if (row.pack) {
        if (packWorksOn(row, episodeId)) return 2;
        const own = ownEpisode(row, episodeId);
        return own?.importState === 'failed' || own?.importState === 'blocked' ? 1 : 0;
    }
    if (row.state === 'failed' || row.state === 'blocked') return 1;
    return IMPORT_FINISHED.has(row.state) ? 0 : 2;
};

/**
 * The live row for one movie entry or one episode (or a pack that claimed the episode), for marks and detail lines that
 * show `grabbed` or `downloading`. Reading the queue keeps a card ring and the queue row on the same value within one
 * poll (P5.I3). Current work wins over a row needing attention, which wins over history; the newest first within each,
 * so an older pack's failure never hides an episode's current download (season packs, 2026-10-08). `poll` `'slow'`
 * reads the queue once a minute, for a page that only watches whether a pack starts on a held episode.
 */
export const useQueueRowFor = (entryId: string | undefined, episodeId: string | null | undefined, active: boolean,
    poll: boolean | 'slow' = true):
    QueueRow | undefined => {
    const capability = useQueueCapability();
    const queue = useQueue({ enabled: active && capability.available && !!entryId, poll });
    if (!active || !capability.available || !entryId) return undefined;
    // A pack is one row with no episode of its own; it stands for every episode it claimed.
    const rows = queue.data?.items.filter(row => row.entry?.id === entryId
        && (episodeId ? row.episode?.id === episodeId || !!row.pack?.episodes.some(episode => episode.episodeId === episodeId) :
            !row.episode && !row.pack)) ?? [];
    return [...rows].sort((a, b) => rank(b, episodeId) - rank(a, episodeId) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
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
