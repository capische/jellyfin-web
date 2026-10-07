import type { Api } from '@jellyfin/sdk/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import React, { type FC, useCallback, useEffect, useRef, useState } from 'react';

import { getEntry } from '../api/modApi';
import { getRatingsQueued, refreshEntryRatings } from '../api/ratingsApi';
import { RATINGS_SETTINGS_CAPABILITY } from '../constants/ratings';
import { usePluginCapabilities } from '../hooks/useAcquisition';
import type { Rating } from '../types/ratings';
import { raisedButtonClass } from '../utils/flatButton';

interface RatingsRefreshButtonProps {
    api: Api;
    entryId: string;
    /** Says what happened, in the page's own status line. */
    onMessage: (message: string) => void;
    /** Given the title's ratings once the queued refresh has finished (or the wait ended without knowing). */
    onDone?: (ratings: Rating[]) => void;
}

/** How often, and for how long at most, the button asks whether the queued refresh has run; and how long one request may take. */
const POLL_MS = 2000;
const POLL_LIMIT_MS = 60000;
const REQUEST_MS = 10000;

/** The newest MDBList fetch among a title's ratings, to tell a new answer from the old one. */
const newestFetch = (ratings: Rating[] | undefined) => (ratings ?? []).filter(rating => rating.provider === 'mdblist')
    .reduce((newest, rating) => Math.max(newest, Date.parse(rating.fetchedAt ?? '') || 0), 0);

/** Waits, unless the operation is cancelled first. */
const wait = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
        reject(new Error('cancelled'));
        return;
    }
    const onAbort = () => {
        clearTimeout(timer);
        reject(new Error('cancelled'));
    };
    const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
});

/** What one look at the server's refresh queue said. Only an empty queue is completion; a failed look is not. */
type Look = 'done' | 'waiting' | 'transient' | 'forbidden' | 'unsupported';

const look = async (api: Api, signal: AbortSignal): Promise<Look> => {
    try {
        return (await getRatingsQueued(api, { signal, timeout: REQUEST_MS })) === 0 ? 'done' : 'waiting';
    } catch (error) {
        if (signal.aborted) throw error;
        const status = (error as { response?: { status?: number } } | null)?.response?.status;
        if (status === 401 || status === 403) return 'forbidden';
        if (status === 404 || (error instanceof Error && error.message.startsWith('Unsupported'))) return 'unsupported';
        // A network error, a time-out or a server error: asked again within the deadline.
        return 'transient';
    }
};

/** Follows the queue until it is empty, a look says the server will not tell, or the deadline passes. */
const follow = async (api: Api, signal: AbortSignal): Promise<Look> => {
    const deadline = Date.now() + POLL_LIMIT_MS;
    let state: Look = 'waiting';
    while (Date.now() < deadline && (state === 'waiting' || state === 'transient')) {
        await wait(POLL_MS, signal);
        state = await look(api, signal);
    }
    return state;
};

/** What the status line says once the title has been read again. */
const outcome = (updated: boolean, state: Look) => {
    if (updated) return 'Ratings refreshed.';
    if (state === 'done') return 'The refresh brought no new values (the provider may be unavailable); the values shown are kept.';
    if (state === 'forbidden' || state === 'unsupported') return 'The refresh is queued; this server does not say when it has run, so new values will show when they arrive.';
    return 'The refresh is still waiting; new values will show when it has run.';
};

/**
 * An administrator's manual refresh of one title's ratings (user decision 5), inside the daily budget. A refusal shows the
 * server's own sentence (budget spent, breaker open, no key, ratings off). Once queued, the button follows the server's refresh
 * queue until it is empty — at most a minute, every request with its own time limit, a failed look asked again — then reads
 * the title again and refreshes the page's ratings and the grids' cached rows. A server that will not say (no permission to
 * read the queue, or an older plugin) is reported as such rather than taken for completion. Leaving the page cancels all of it
 * (web review 2026-10-07, P2 3; round 2, P2 2-3). The control keeps focus while its request runs (the `aria-disabled`
 * pattern, UX §13).
 */
const RatingsRefreshButton: FC<RatingsRefreshButtonProps> = ({ api, entryId, onMessage, onDone }) => {
    const available = usePluginCapabilities(api).includes(RATINGS_SETTINGS_CAPABILITY);
    const queryClient = useQueryClient();
    const [busy, setBusy] = useState(false);
    const operation = useRef<AbortController | null>(null);
    useEffect(() => () => operation.current?.abort(), []);
    const refresh = useCallback(async () => {
        if (busy) return;
        operation.current?.abort();
        // eslint-disable-next-line compat/compat -- the legacy bundle installs abortcontroller-polyfill for older engines
        const controller = new AbortController();
        operation.current = controller;
        const { signal } = controller;
        const request = { signal, timeout: REQUEST_MS };
        setBusy(true);
        try {
            const before = newestFetch((await getEntry(api, entryId, request)).ratings);
            if (signal.aborted) return;
            await refreshEntryRatings(api, entryId, request);
            if (signal.aborted) return;
            onMessage('Ratings refresh queued…');
            const state = await follow(api, signal);
            if (signal.aborted) return;
            const ratings = (await getEntry(api, entryId, request)).ratings ?? [];
            if (signal.aborted) return;
            onDone?.(ratings);
            await queryClient.invalidateQueries({ queryKey: ['JellyfinMod', api.basePath] });
            if (signal.aborted) return;
            onMessage(outcome(newestFetch(ratings) > before, state));
        } catch (error) {
            if (signal.aborted) return;
            const title = (error as { response?: { data?: { title?: unknown } } } | null)?.response?.data?.title;
            onMessage(typeof title === 'string' ? title : 'The ratings refresh could not be requested. Please try again.');
        } finally {
            if (operation.current === controller) {
                operation.current = null;
                if (!signal.aborted) setBusy(false);
            }
        }
    }, [api, busy, entryId, onDone, onMessage, queryClient]);
    const onClick = useCallback(() => {
        refresh().catch(() => undefined);
    }, [refresh]);
    if (!available) return null;
    return <button className={raisedButtonClass()} type='button' aria-disabled={busy} aria-busy={busy} onClick={onClick}
        data-jfmod-ratings-refresh=''>Refresh ratings</button>;
};

export default RatingsRefreshButton;
