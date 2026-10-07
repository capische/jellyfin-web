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
    /** Given the title's ratings once the queued refresh has finished (or the wait ran out). */
    onDone?: (ratings: Rating[]) => void;
}

/** How often, and for how long at most, the button asks whether the queued refresh has run. */
const POLL_MS = 2000;
const POLL_LIMIT_MS = 60000;

/** The newest MDBList fetch among a title's ratings, to tell a new answer from the old one. */
const newestFetch = (ratings: Rating[] | undefined) => (ratings ?? []).filter(rating => rating.provider === 'mdblist')
    .reduce((newest, rating) => Math.max(newest, Date.parse(rating.fetchedAt ?? '') || 0), 0);

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * An administrator's manual refresh of one title's ratings (user decision 5), inside the daily budget. A refusal shows the
 * server's own sentence (budget spent, breaker open, no key, ratings off). Once queued, the button waits until the server's
 * refresh queue is empty — bounded to a minute — then reads the title again and refreshes the page's ratings and the grids'
 * cached rows (web review 2026-10-07, P2 3). The control keeps focus while its request runs (the `aria-disabled` pattern,
 * UX §13).
 */
const RatingsRefreshButton: FC<RatingsRefreshButtonProps> = ({ api, entryId, onMessage, onDone }) => {
    const available = usePluginCapabilities(api).includes(RATINGS_SETTINGS_CAPABILITY);
    const queryClient = useQueryClient();
    const [busy, setBusy] = useState(false);
    const mounted = useRef(true);
    useEffect(() => () => {
        mounted.current = false;
    }, []);
    const refresh = useCallback(async () => {
        if (busy) return;
        setBusy(true);
        try {
            const before = newestFetch((await getEntry(api, entryId)).ratings);
            await refreshEntryRatings(api, entryId);
            onMessage('Ratings refresh queued…');
            const deadline = Date.now() + POLL_LIMIT_MS;
            let finished = false;
            while (mounted.current && Date.now() < deadline && !finished) {
                await wait(POLL_MS);
                finished = (await getRatingsQueued(api).catch(() => 0)) === 0;
            }
            if (!mounted.current) return;
            const ratings = (await getEntry(api, entryId)).ratings ?? [];
            const updated = newestFetch(ratings) > before;
            onDone?.(ratings);
            await queryClient.invalidateQueries({ queryKey: ['JellyfinMod', api.basePath] });
            if (!mounted.current) return;
            if (updated) onMessage('Ratings refreshed.');
            else if (finished) onMessage('The refresh brought no new values (the provider may be unavailable); the values shown are kept.');
            else onMessage('The refresh is still waiting; new values will show when it has run.');
        } catch (error) {
            const title = (error as { response?: { data?: { title?: unknown } } } | null)?.response?.data?.title;
            onMessage(typeof title === 'string' ? title : 'The ratings refresh could not be requested. Please try again.');
        } finally {
            if (mounted.current) setBusy(false);
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
