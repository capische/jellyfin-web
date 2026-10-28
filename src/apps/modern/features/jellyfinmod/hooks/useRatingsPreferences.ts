import type { Api } from '@jellyfin/sdk/lib/api';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { getDisplayPreferencesQuery, useDisplayPreferences } from 'hooks/api/useDisplayPreferences';
import { useApi } from 'hooks/useApi';
import { currentSettings as userSettings } from 'scripts/settings/userSettings';
import Events from 'utils/events';
import { queryClient } from 'utils/query/queryClient';

import { getPluginHealth } from '../api/modApi';
import { getRatingsDefaults } from '../api/ratingsApi';
import { DEFAULT_SOURCES, RATINGS_CAPABILITY, RATINGS_CARD_SOURCE_KEY, RATINGS_SOURCES_KEY, RATINGS_STALE_MS, isRatingSource } from '../constants/ratings';
import type { RatingSource } from '../types/ratings';
import { usePluginHealthSummary } from './useAcquisition';

/**
 * How long a reader of the ratings preferences waits for the plugin's Health and the defaults before it goes on without them:
 * the same bound as the detail pages' own prefetch.
 */
export const RATINGS_ANSWER_DEADLINE_MS = 3000;

/** The query key of the ratings defaults, so the settings area can invalidate it after a save. */
export const ratingsDefaultsKey = (basePath: string | undefined) => ['JellyfinMod', basePath, 'RatingsDefaults'];

/** The capabilities (shared with every other reader) — the first step of each ratings prefetch. */
export const loadPluginCapabilities = (api: Api) => queryClient.fetchQuery({
    queryKey: ['JellyfinMod', api.basePath, 'HealthCapabilities'],
    queryFn: ({ signal }) => getPluginHealth(api, { signal }),
    staleTime: 5 * 60 * 1000,
    retry: false
});

/** Loads the ratings defaults and the user's display preferences into the cache, without a deadline; never throws. */
export const loadRatingsPreferences = async (api: Api, userId: string) => {
    try {
        const health = await loadPluginCapabilities(api);
        if (!health.capabilities.includes(RATINGS_CAPABILITY)) return;
        await Promise.all([
            queryClient.fetchQuery({ queryKey: ratingsDefaultsKey(api.basePath), queryFn: ({ signal }) => getRatingsDefaults(api, { signal }),
                staleTime: RATINGS_STALE_MS, retry: false }),
            queryClient.fetchQuery({ ...getDisplayPreferencesQuery(api, { displayPreferencesId: 'usersettings', client: 'emby', userId }),
                staleTime: RATINGS_STALE_MS })
        ]);
    } catch {
        // The line's own hooks read again; a failed prefetch only means it decides later.
    }
};

/**
 * Loads what a ratings line needs before a detail page mounts it — the plugin's capabilities, the ratings defaults and the
 * user's display preferences — into the same query cache the hooks read, so the line is ready in the page's first paint and
 * never arrives later above a focused control (web review 2026-10-07, P2 2). Bounded: a slow answer does not hold the page.
 */
export const prefetchRatingsPreferences = async (api: Api, userId: string, timeoutMs = 3000) => {
    await Promise.race([loadRatingsPreferences(api, userId), new Promise(resolve => setTimeout(resolve, timeoutMs))]);
};

type CustomPrefs = Record<string, string | null | undefined> | null | undefined;

/**
 * A stored preference: upstream's user settings once they are bound to the signed-in user, or the same display preferences
 * as the query read them while the binding is still loading (a page mounted right after sign-in would otherwise read nothing
 * and never read again).
 */
const readPref = (name: string, prefs: CustomPrefs) => userSettings.get(name) ?? prefs?.[name] ?? null;

/** The user's own source list, or null when they never chose one (the administrator's default then applies). */
const readSources = (prefs: CustomPrefs): RatingSource[] | null => {
    const raw = readPref(RATINGS_SOURCES_KEY, prefs);
    if (typeof raw !== 'string' || !raw) return null;
    try {
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter(isRatingSource).filter((value, index, all) => all.indexOf(value) === index) : null;
    } catch {
        return null;
    }
};

const readCardSource = (prefs: CustomPrefs): RatingSource | null => {
    const raw = readPref(RATINGS_CARD_SOURCE_KEY, prefs);
    return isRatingSource(raw) ? raw : null;
};

/**
 * The signed-in user's ratings display (Phase 9, plan decision 8): which sources show, in which order, and the one source a
 * card may show (off by default). Kept in Jellyfin's own per-user display preferences, so it follows the user to every
 * device; until the user chooses, the administrator's default order applies.
 */
export const useRatingsPreferences = (api: Api | undefined) => {
    // Whether the plugin offers ratings stays unknown until its Health has answered (web review 2026-10-08 round 10, P2 2): an
    // answer still on its way is not "no ratings".
    const health = usePluginHealthSummary(api);
    const supported = !!health.data?.capabilities.includes(RATINGS_CAPABILITY);
    const healthKnown = health.isSuccess || health.isError;
    const defaults = useQuery({
        queryKey: ratingsDefaultsKey(api?.basePath),
        queryFn: ({ signal }) => getRatingsDefaults(api!, { signal }),
        enabled: !!api && supported,
        retry: false,
        staleTime: RATINGS_STALE_MS,
        // An administrator turning ratings off or changing the default order reaches every open page within a minute
        // (web review 2026-10-07, P2 1): staleness alone would only refetch on the next mount.
        refetchInterval: RATINGS_STALE_MS
    });
    const { user } = useApi();
    // The same per-user display preferences upstream's user settings load: when they arrive, the choice is read again.
    const displayPreferences = useDisplayPreferences({ displayPreferencesId: 'usersettings', client: 'emby' });
    const prefs = displayPreferences.data?.CustomPrefs as CustomPrefs;
    const [revision, setRevision] = useState(0);
    useEffect(() => {
        const onChange = () => setRevision(value => value + 1);
        Events.on(userSettings, 'change', onChange);
        return () => Events.off(userSettings, 'change', onChange);
    }, []);
    // The stored values are re-read whenever a setting changes (the revision), the preferences arrive or the user changes.
    const own = useMemo(() => ({ revision, user: user?.Id, sources: readSources(prefs), cardSource: readCardSource(prefs) }),
        [revision, prefs, user?.Id]);
    // Waiting is bounded (web review 2026-10-08 round 11, P2): when Health or the defaults have not answered within
    // RATINGS_ANSWER_DEADLINE_MS, the reader goes on as if ratings were unavailable and says so; an answer that comes later
    // still counts — the hooks keep reading, and ratings, the page and the detail groups come back by themselves.
    const answered = healthKnown && (!supported || defaults.isSuccess || defaults.isError);
    const [waitedOut, setWaitedOut] = useState(false);
    useEffect(() => {
        if (answered) return;
        const timer = window.setTimeout(() => setWaitedOut(true), RATINGS_ANSWER_DEADLINE_MS);
        return () => window.clearTimeout(timer);
    }, [answered]);
    const enabled = supported && defaults.data?.enabled === true;
    const fallback = defaults.data?.defaultSources.filter(isRatingSource) ?? DEFAULT_SOURCES;
    const sources = own.sources ?? fallback;
    const setSources = useCallback((next: RatingSource[] | null) => {
        userSettings.set(RATINGS_SOURCES_KEY, next ? JSON.stringify(next) : '');
    }, []);
    const setCardSource = useCallback((next: RatingSource | null) => {
        userSettings.set(RATINGS_CARD_SOURCE_KEY, next ?? '');
    }, []);
    return {
        /** The plugin offers ratings and the administrator has them on. */
        enabled,
        /** The plugin answered, whatever it said (its Health, and, when it offers ratings, the defaults), or the wait ran out. */
        loaded: answered || waitedOut,
        /** The wait ran out with no answer yet: shown as unavailable until an answer comes. */
        unanswered: !answered && waitedOut,
        available: defaults.data?.availableSources.filter(isRatingSource) ?? [],
        defaultSources: fallback,
        sources,
        ownChoice: own.sources !== null,
        cardSource: enabled ? own.cardSource : null,
        setSources,
        setCardSource
    };
};
