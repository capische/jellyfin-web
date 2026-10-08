import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind';
import { ImageType } from '@jellyfin/sdk/lib/generated-client/models/image-type';
import { ItemFields } from '@jellyfin/sdk/lib/generated-client/models/item-fields';
import { ItemSortBy } from '@jellyfin/sdk/lib/generated-client/models/item-sort-by';
import { SortOrder } from '@jellyfin/sdk/lib/generated-client/models/sort-order';
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { getNextUpQuery } from 'apps/legacy/features/libraries/api/useNextUp';
import { getResumeItemsQuery } from 'apps/legacy/features/libraries/api/useResumeItems';
import { useApi } from 'hooks/useApi';
import * as userSettings from 'scripts/settings/userSettings';
import type { ItemDto } from 'types/base/models/item-dto';
import { toIsoDateOnlyString } from 'utils/date';

interface ContinueWatchingOptions {
    includeResume?: boolean;
    includeNextUp?: boolean;
}

const IMAGE_TYPES = [ImageType.Primary, ImageType.Backdrop, ImageType.Thumb];

/**
 * How many of the user's most recently played episodes one request reads to date every Next Up show. A show whose
 * last play is not among them is read on its own, which only happens when the batch is full of dated plays.
 */
const RECENT_EPISODES = 100;

/**
 * A date's instant, for ordering; a missing or unreadable date sorts last. Compared as instants, not strings: the
 * server writes six or seven fractional digits, and `.1Z` would sort after `.11Z` as text.
 */
const instant = (date?: string | null) => {
    const time = date ? Date.parse(date) : Number.NaN;
    return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
};

const latest = (left?: string | null, right?: string | null) =>
    instant(left) >= instant(right) ? left ?? undefined : right ?? undefined;

/** The day before which a series no longer counts as in progress, from the user's "Max days in Next Up". */
const nextUpCutoff = () => {
    const oldest = new Date();
    oldest.setDate(oldest.getDate() - userSettings.maxDaysForNextUp());
    return toIsoDateOnlyString(oldest);
};

/**
 * What the user is in the middle of: upstream's resume and Next Up feeds merged into one list (P7.S6, UX §7.3).
 *
 * The merged Continue watching row and the Home hero both read this, with the same request parameters, so they share
 * one cache entry per feed and cannot disagree about what comes first. Next Up honours the user's own Next Up
 * settings exactly as upstream's Next Up section does. Resume wins when the same episode is in both feeds. The list is
 * newest first: a resumed item by when it was last played, a Next Up episode by when the user last played any episode
 * of its show (user, 2026-10-08: "sort next up by when I last watched the show"), each falling back to when the item
 * was added. Each feed takes part only when the user's Home settings show its section (Continue Watching, Next Up), as
 * the row always did.
 *
 * The server gives no show-level play date (a series' own `UserData.LastPlayedDate` is empty), so the dates come from
 * the user's most recently played episodes, one request for every show at once.
 */
export const useContinueWatching = ({ includeResume = true, includeNextUp = true }: ContinueWatchingOptions = {}) => {
    const { api, user } = useApi();
    const queries = useQueries({ queries: [
        { ...getResumeItemsQuery(api, {
            // DateCreated is the sort's fallback for a resume point with no play date (one set by an import or the API).
            userId: user?.Id, limit: 12, fields: [ItemFields.PrimaryImageAspectRatio, ItemFields.DateCreated, ItemFields.Overview], imageTypeLimit: 1,
            enableImageTypes: IMAGE_TYPES, enableTotalRecordCount: false, mediaTypes: ['Video']
        }), enabled: !!api && !!user?.Id && includeResume },
        { ...getNextUpQuery(api, {
            userId: user?.Id, limit: 24, fields: [ItemFields.PrimaryImageAspectRatio, ItemFields.DateCreated, ItemFields.Overview],
            imageTypeLimit: 1, enableImageTypes: IMAGE_TYPES, enableTotalRecordCount: false,
            nextUpDateCutoff: nextUpCutoff(), enableResumable: false, enableRewatching: userSettings.enableRewatchingInNextUp()
        }), enabled: !!api && !!user?.Id && includeNextUp }
    ] });
    // A feed the caller left out contributes nothing, even when another reader has its entry in the shared cache: a
    // disabled query still hands back cached data, which would put a Home section the user hid back into the row.
    const resume = includeResume ? queries[0].data : undefined;
    const next = includeNextUp ? queries[1].data : undefined;
    const nextUpItems = (next?.Items ?? []) as ItemDto[];
    // When the user last played each show, from their most recently played episodes. Keyed under ContinueWatching, which
    // a user-data change invalidates with the feeds.
    const recent = useQuery({
        queryKey: ['JellyfinMod', api?.basePath, user?.Id, 'ContinueWatching', 'RecentEpisodes'],
        queryFn: async ({ signal }) => (await getLibraryApi(api!).getItems({
            userId: user?.Id, recursive: true, includeItemTypes: [BaseItemKind.Episode], sortBy: [ItemSortBy.DatePlayed],
            sortOrder: [SortOrder.Descending], limit: RECENT_EPISODES, enableImages: false, enableTotalRecordCount: false
        }, { signal })).data.Items ?? [],
        // Alongside the feeds rather than after Next Up answers, so dating the shows costs no extra round trip.
        enabled: !!api && !!user?.Id && includeNextUp
    });
    const showPlayed = useMemo(() => {
        const dates = new Map<string, string>();
        for (const episode of recent.data ?? []) {
            const played = episode.UserData?.LastPlayedDate;
            if (episode.SeriesId && played && !dates.has(episode.SeriesId)) dates.set(episode.SeriesId, played);
        }
        return dates;
    }, [recent.data]);
    // A batch that is full of dated plays may have cut a show off; those shows, and only those, are read one by one.
    const batchComplete = !!recent.data && (recent.data.length < RECENT_EPISODES || !recent.data.at(-1)?.UserData?.LastPlayedDate);
    const unread = recent.data && !batchComplete ?
        [...new Set(nextUpItems.map(item => item.SeriesId).filter((id): id is string => !!id && !showPlayed.has(id)))] : [];
    const perShow = useQueries({ queries: unread.map(seriesId => ({
        queryKey: ['JellyfinMod', api?.basePath, user?.Id, 'ContinueWatching', 'ShowPlayed', seriesId],
        queryFn: async ({ signal }: { signal: AbortSignal }) => (await getLibraryApi(api!).getItems({
            userId: user?.Id, parentId: seriesId, recursive: true, includeItemTypes: [BaseItemKind.Episode],
            sortBy: [ItemSortBy.DatePlayed], sortOrder: [SortOrder.Descending], limit: 1, enableImages: false, enableTotalRecordCount: false
        }, { signal })).data.Items?.[0]?.UserData?.LastPlayedDate ?? null,
        enabled: !!api && !!user?.Id
    })) });
    const perShowDates = perShow.map(query => query.data);
    const unreadKey = unread.join(',');
    const datesKey = perShowDates.join(',');
    const items = useMemo(() => {
        const played = new Map(showPlayed);
        unread.forEach((seriesId, index) => {
            const date = perShowDates[index];
            if (date) played.set(seriesId, date);
        });
        const byId = new Map<string, ItemDto>();
        const resumed = new Set<string>();
        for (const item of (resume?.Items ?? []) as ItemDto[]) {
            if (item.Id && !byId.has(item.Id)) {
                byId.set(item.Id, item);
                resumed.add(item.Id);
            }
        }
        for (const item of nextUpItems) if (item.Id && !byId.has(item.Id)) byId.set(item.Id, item);
        const sortKey = (item: ItemDto) => {
            if (resumed.has(item.Id!)) return item.UserData?.LastPlayedDate ?? item.DateCreated;
            const show = item.SeriesId ? played.get(item.SeriesId) : undefined;
            return latest(show, item.UserData?.LastPlayedDate) ?? item.DateCreated;
        };
        return [...byId.values()].sort((left, right) => instant(sortKey(right)) - instant(sortKey(left)) || 0).slice(0, 24);
    // unread and perShowDates are rebuilt on every render; what they hold is the dependency.
    }, [resume, next, showPlayed, unreadKey, datesKey]);
    // Settled once every enabled feed has answered or failed (a feed left out counts as settled and empty) and the show
    // dates Next Up is ordered by have been read, with nothing of either still being fetched again: after a user-data
    // change the feeds can answer before the dates, and the hero must not be chosen from new feeds and old dates.
    // Answered is the same without the refetches: what is cached is complete, if possibly about to change. A hero not
    // yet showing anything picks from that, so a Home opened over a stale cache has its hero inside the TV first-focus
    // window instead of after the refetches, which then update it in place.
    const settledBy = (done: (query: { isPending: boolean; isFetching: boolean }) => boolean) => {
        const showsDated = !includeNextUp || nextUpItems.length === 0 || (done(recent) && perShow.every(done));
        return (!includeResume || done(queries[0])) && (!includeNextUp || done(queries[1])) && showsDated;
    };
    const settled = settledBy(query => !query.isPending && !query.isFetching);
    const answered = settledBy(query => !query.isPending);
    return { items, settled, answered };
};
