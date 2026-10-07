import type { Api } from '@jellyfin/sdk/lib/api';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useDisplayPreferences } from 'hooks/api/useDisplayPreferences';
import { useApi } from 'hooks/useApi';
import { currentSettings as userSettings } from 'scripts/settings/userSettings';
import Events from 'utils/events';

import { getRatingsDefaults } from '../api/ratingsApi';
import { DEFAULT_SOURCES, RATINGS_CAPABILITY, RATINGS_CARD_SOURCE_KEY, RATINGS_SOURCES_KEY, RATINGS_STALE_MS, isRatingSource } from '../constants/ratings';
import type { RatingSource } from '../types/ratings';
import { usePluginCapabilities } from './useAcquisition';

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
    const capabilities = usePluginCapabilities(api);
    const supported = capabilities.includes(RATINGS_CAPABILITY);
    const defaults = useQuery({
        queryKey: ['JellyfinMod', api?.basePath, 'RatingsDefaults'],
        queryFn: ({ signal }) => getRatingsDefaults(api!, { signal }),
        enabled: !!api && supported,
        retry: false,
        staleTime: RATINGS_STALE_MS
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
        /** The plugin answered, whatever it said. */
        loaded: !supported || defaults.isSuccess || defaults.isError,
        available: defaults.data?.availableSources.filter(isRatingSource) ?? [],
        defaultSources: fallback,
        sources,
        ownChoice: own.sources !== null,
        cardSource: enabled ? own.cardSource : null,
        setSources,
        setCardSource
    };
};
