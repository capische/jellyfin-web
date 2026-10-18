import type { Api } from '@jellyfin/sdk';
import { OutboundWebSocketMessageType } from '@jellyfin/sdk/lib/websocket';
import { useQueryClient, type Query } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useApi } from 'hooks/useApi';

import type { EntryDetail } from '../api/modApi';
import { invalidateCatalog } from '../integration/invalidateCatalog';
import { FileState } from '../types/entry';

/** The first read of a title that is waiting, once its socket is down; later reads are slower (see `SLOW_AFTER`). */
const POLL_MS = 1000;
const SLOW_POLL_MS = 5000;
const SLOW_AFTER_MS = 30 * 1000;
/** How long after the file shows on disk without Jellyfin's item to play it, the plugin's push is waited for. */
const PUSH_GRACE_MS = 5000;
/** A file that never becomes playable is not waited for longer than this. */
const UNPLAYED_LIMIT_MS = 2 * 60 * 1000;

type Waiting = 'download' | 'unplayed' | null;

/** What an open title is waiting for: its download, or Jellyfin's item that plays the file the plugin has bound. */
const waitingFor = (detail: EntryDetail | undefined): Waiting => {
    if (!detail) return null;
    const flying = (state: FileState) => state === FileState.Grabbed || state === FileState.Downloading;
    if (flying(detail.entry.state) || detail.episodes.some(episode => flying(episode.state))) return 'download';
    const movieUnplayed = detail.entry.mediaType === 'movie' && detail.entry.state === FileState.OnDisk && !detail.entry.playableItemId;
    const episodeUnplayed = detail.episodes.some(episode => episode.availability === 'onDisk' && !episode.playableItemId);
    return movieUnplayed || episodeUnplayed ? 'unplayed' : null;
};

/** Whether the push cannot be relied on for a title that has waited since `since`. */
const needsPoll = (kind: 'download' | 'unplayed', since: number, now: number, socketDown: boolean, lastPush: number) => {
    if (kind === 'unplayed' && now - since > UNPLAYED_LIMIT_MS) return false;
    return socketDown || (kind === 'unplayed' && now - since > PUSH_GRACE_MS && lastPush < since);
};

/**
 * Remembers when each waiting title was first seen waiting, and forgets the ones that no longer wait; returns how many stopped
 * waiting since the last look.
 */
const track = (firstSeen: Map<string, number>, hashes: string[], now: number) => {
    const seen = new Set(hashes);
    let stopped = 0;
    for (const hash of firstSeen.keys()) {
        if (!seen.has(hash)) {
            firstSeen.delete(hash);
            stopped++;
        }
    }

    for (const hash of hashes) if (!firstSeen.has(hash)) firstSeen.set(hash, now);
    return stopped;
};

/**
 * Whether the SDK socket that carries `LibraryChanged` (the one `api.subscribe` uses, not the legacy ApiClient's) is open. The SDK
 * keeps its service private and offers no public state, so it is read from there; an unreadable state counts as open, which
 * only leaves the 5 s push grace as the fallback's trigger.
 */
const socketOpen = (api: Api) => {
    const status = (api as unknown as { webSocket?: { socketStatus?: number | string } }).webSocket?.socketStatus;
    return status === undefined || status === WebSocket.OPEN;
};

/**
 * THE ONE FALLBACK POLL of the mod's web (P4.FU12). Every update the mod needs is pushed: the plugin sends Jellyfin's own
 * `LibraryChanged` message at once (to each user, only the items that user may see), and `queryClientEventHandler` reads the
 * titles again on it. This reads an open title's detail again, once a second (every 5 s after 30 s), only while that push cannot
 * be relied on, and nothing else on the web polls for it:
 *   - the title waits for its download or for the item that plays its file, and the socket is down; or
 *   - the file shows on disk without that item and no `LibraryChanged` came within 5 s of it showing.
 * It does nothing while the tab is hidden or nothing open waits, and stops the moment the title reads playable.
 */
export const useEntryFallbackPoll = () => {
    const queryClient = useQueryClient();
    const { api, user } = useApi();

    useEffect(() => {
        if (!api || !user?.Id) return;
        const cache = queryClient.getQueryCache();
        const key = ['JellyfinMod', api.basePath, user.Id, 'EntryDetail'];
        let timer: ReturnType<typeof setTimeout> | undefined;
        let lastPush = 0;
        const firstSeen = new Map<string, number>();
        let pollingSince = 0;

        const open = () => cache.findAll({ queryKey: key }).filter(query => query.getObserversCount() > 0);

        const step = () => {
            timer = undefined;
            const now = Date.now();
            const waiting = open().map(query => ({ query, kind: waitingFor(query.state.data as EntryDetail | undefined) }))
                .filter((item): item is { query: Query; kind: 'download' | 'unplayed' } => item.kind !== null);
            // A title that stopped waiting while this was polling for it is what the push would have said: the catalog is read again
            // as the push's handler does, so the page draws the file (the poll only read the title's own detail).
            if (track(firstSeen, waiting.map(item => item.query.queryHash), now) > 0 && pollingSince) invalidateCatalog(api, user.Id);
            if (waiting.length === 0) {
                pollingSince = 0;
                return;
            }

            if (!document.hidden) {
                const down = !socketOpen(api);
                const due = waiting.filter(item => needsPoll(item.kind, firstSeen.get(item.query.queryHash) ?? now, now, down, lastPush));
                if (due.length > 0) {
                    pollingSince ||= now;
                    for (const item of due) void queryClient.invalidateQueries({ queryKey: item.query.queryKey, refetchType: 'active' });
                } else {
                    pollingSince = 0;
                }
            }

            timer = setTimeout(step, pollingSince && now - pollingSince > SLOW_AFTER_MS ? SLOW_POLL_MS : POLL_MS);
        };

        // Nothing runs until an open title waits: the timer starts from the cache's own events and ends when nothing waits.
        const wake = () => {
            if (timer === undefined && open().some(query => waitingFor(query.state.data as EntryDetail | undefined) !== null)) {
                timer = setTimeout(step, POLL_MS);
            }
        };
        const unsubscribeCache = cache.subscribe(event => {
            if (event.query.queryKey[3] !== 'EntryDetail') return;
            // A title this was waiting for reads playable now: the catalog is read again at once, not a second later.
            if (timer !== undefined && firstSeen.has(event.query.queryHash) && waitingFor(event.query.state.data as EntryDetail | undefined) === null) {
                clearTimeout(timer);
                step();
                return;
            }

            wake();
        });
        const unsubscribePush = api.subscribe([OutboundWebSocketMessageType.LibraryChanged], () => {
            lastPush = Date.now();
        });
        wake();

        return () => {
            unsubscribeCache();
            unsubscribePush();
            if (timer !== undefined) clearTimeout(timer);
        };
    }, [api, queryClient, user?.Id]);
};
