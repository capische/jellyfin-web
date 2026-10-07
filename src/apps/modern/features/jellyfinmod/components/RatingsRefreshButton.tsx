import type { Api } from '@jellyfin/sdk/lib/api';
import React, { type FC, useCallback, useState } from 'react';

import { refreshEntryRatings } from '../api/ratingsApi';
import { RATINGS_SETTINGS_CAPABILITY } from '../constants/ratings';
import { usePluginCapabilities } from '../hooks/useAcquisition';
import { raisedButtonClass } from '../utils/flatButton';

interface RatingsRefreshButtonProps {
    api: Api;
    entryId: string;
    /** Says what happened, in the page's own status line. */
    onMessage: (message: string) => void;
    /** Asked once the queued fetch has had time to run, so the page can read its ratings again. */
    onQueued?: () => void;
}

/** How long after queueing the page reads its ratings again; one fetch takes about a second. */
const REREAD_MS = 4000;

/**
 * An administrator's manual refresh of one title's ratings (user decision 5), inside the daily budget. A refusal shows the
 * server's own sentence (budget spent, breaker open, no key, ratings off). The control keeps focus while its request runs
 * (the `aria-disabled` pattern, UX §13).
 */
const RatingsRefreshButton: FC<RatingsRefreshButtonProps> = ({ api, entryId, onMessage, onQueued }) => {
    const available = usePluginCapabilities(api).includes(RATINGS_SETTINGS_CAPABILITY);
    const [busy, setBusy] = useState(false);
    const refresh = useCallback(async () => {
        if (busy) return;
        setBusy(true);
        try {
            await refreshEntryRatings(api, entryId);
            onMessage('Ratings refresh queued. New values show in a moment.');
            if (onQueued) setTimeout(onQueued, REREAD_MS);
        } catch (error) {
            const title = (error as { response?: { data?: { title?: unknown } } } | null)?.response?.data?.title;
            onMessage(typeof title === 'string' ? title : 'The ratings refresh could not be requested. Please try again.');
        } finally {
            setBusy(false);
        }
    }, [api, busy, entryId, onMessage, onQueued]);
    const onClick = useCallback(() => {
        refresh().catch(() => undefined);
    }, [refresh]);
    if (!available) return null;
    return <button className={raisedButtonClass()} type='button' aria-disabled={busy} aria-busy={busy} onClick={onClick}
        data-jfmod-ratings-refresh=''>Refresh ratings</button>;
};

export default RatingsRefreshButton;
