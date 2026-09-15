import type { CollectionType } from '@jellyfin/sdk/lib/generated-client/models/collection-type';
import type { ItemSortBy } from '@jellyfin/sdk/lib/generated-client/models/item-sort-by';
import { OutboundWebSocketMessageType } from '@jellyfin/sdk/lib/websocket';
import { CardShape } from 'components/cardbuilder/utils/shape';
import focusManager from 'components/focusManager';
import type { CardOptions } from 'types/cardOptions';
import { renderComponent } from 'utils/reactUtils';

import EntryCards from '../components/EntryCards';
import EntryLists from '../components/EntryLists';
import type { BrowseRequest, BrowseResult } from '../api/modApi';
import type { BrowseRow } from '../types/browse';

interface LegacyApiClient {
    ajax(options: Record<string, unknown>): Promise<BrowseResult>;
    getItems(userId: string, query: Record<string, unknown>): Promise<unknown>;
    getCurrentUserId(): string;
    getUrl(path: string): string;
    serverId(): string;
    subscribe(messageTypes: OutboundWebSocketMessageType[], callback: (message: { Data?: unknown }) => void): () => void;
}

interface LegacyQuery {
    ParentId?: string;
    SortBy?: string;
    SortOrder?: string;
    StartIndex?: number;
    Limit?: number;
    NameStartsWith?: string;
    NameLessThan?: string;
    Genres?: string[];
    Years?: number[];
    OfficialRatings?: string[];
    Tags?: string[];
    StudioIds?: string[];
    SeriesStatus?: string[];
    VideoTypes?: string[];
    AudioLanguages?: string[];
    SubtitleLanguages?: string[];
    IsPlayed?: boolean;
    IsFavorite?: boolean;
    IsResumable?: boolean;
    JellyfinModRandomSeed?: string;
}

export interface LegacyBrowseResult {
    Items: BrowseRow[];
    TotalRecordCount: number;
    JellyfinModRows: true;
}

const values = <T>(value?: T[]) => value ?? [];

const toRequest = (query: LegacyQuery, mediaType: 'movie' | 'series'): BrowseRequest => {
    const status: string[] = [];
    if (query.IsPlayed === true) status.push('IsPlayed');
    if (query.IsPlayed === false) status.push('IsUnplayed');
    if (query.IsFavorite) status.push('IsFavorite');
    if (query.IsResumable) status.push('IsResumable');

    const sortBy = (query.SortBy ?? 'SortName').split(',');
    if (sortBy.includes('Random') && !query.JellyfinModRandomSeed) {
        query.JellyfinModRandomSeed = String(Date.now());
    }
    return {
        mediaType,
        targetLibraryId: query.ParentId,
        sortBy,
        sortOrder: query.SortOrder ?? 'Ascending',
        randomSeed: sortBy.includes('Random') ? query.JellyfinModRandomSeed : undefined,
        startIndex: query.StartIndex ?? 0,
        limit: query.Limit && query.Limit > 0 ? query.Limit : undefined,
        alphabet: query.NameLessThan === 'A' ? '#' : query.NameStartsWith,
        filters: {
            genres: values(query.Genres),
            years: values(query.Years),
            officialRatings: values(query.OfficialRatings),
            tags: values(query.Tags),
            studioIds: values(query.StudioIds),
            status,
            seriesStatus: values(query.SeriesStatus),
            videoTypes: values(query.VideoTypes),
            audioLanguages: values(query.AudioLanguages),
            subtitleLanguages: values(query.SubtitleLanguages)
        }
    };
};

/** Use the combined endpoint in legacy TV layouts and retain stock behavior if the plugin is absent. */
export const fetchLegacyBrowse = async (
    apiClient: LegacyApiClient,
    query: LegacyQuery,
    mediaType: 'movie' | 'series'
): Promise<LegacyBrowseResult | unknown> => {
    try {
        const result = await apiClient.ajax({
            type: 'POST',
            url: apiClient.getUrl('JellyfinMod/Browse'),
            data: JSON.stringify(toRequest(query, mediaType)),
            contentType: 'application/json',
            dataType: 'json'
        });
        return {
            Items: result.items,
            TotalRecordCount: result.totalRecordCount,
            JellyfinModRows: true
        };
    } catch {
        return apiClient.getItems(apiClient.getCurrentUserId(), query as Record<string, unknown>);
    }
};

export const isLegacyBrowseResult = (result: unknown): result is LegacyBrowseResult =>
    typeof result === 'object' && result !== null && 'JellyfinModRows' in result;

export const legacyBrowsePlaceholder = '<div class="jfmod-legacyLibraryRoot"></div>';

const getCardOptions = (viewStyle: string, context: string, serverId: string): CardOptions => {
    const baseOptions = { context, serverId, showTitle: true, showYear: true, centerText: true };
    if (viewStyle === 'Thumb') {
        return {
            ...baseOptions,
            shape: CardShape.Backdrop,
            preferThumb: true,
            overlayPlayButton: context === 'movies',
            overlayMoreButton: context === 'tvshows'
        };
    }
    if (viewStyle === 'ThumbCard') {
        return { ...baseOptions, shape: CardShape.Backdrop, preferThumb: true, cardLayout: true };
    }
    if (viewStyle === 'Banner') {
        return { ...baseOptions, shape: CardShape.Banner, preferBanner: true };
    }
    if (viewStyle === 'PosterCard') {
        return { ...baseOptions, shape: CardShape.Portrait, cardLayout: true };
    }
    return {
        ...baseOptions,
        shape: CardShape.Portrait,
        overlayPlayButton: context === 'movies',
        overlayMoreButton: context === 'tvshows'
    };
};

const findFocusTarget = (container: HTMLElement, restoreId?: string | null, restoreTmdbId?: string | null) => {
    if (restoreId) {
        return Array.from(container.querySelectorAll<HTMLElement>('[data-id]'))
            .find(element => element.dataset.id === restoreId);
    }
    if (restoreTmdbId) {
        return Array.from(container.querySelectorAll<HTMLElement>('[data-jfmod-tmdb-id]'))
            .find(element => element.dataset.jfmodTmdbId === restoreTmdbId);
    }
};

export const mountLegacyBrowse = (
    container: HTMLElement,
    rows: BrowseRow[],
    viewStyle: string,
    context: string,
    sortBy: string | undefined,
    restoreId?: string | null,
    restoreTmdbId?: string | null
) => {
    const root = container.querySelector<HTMLElement>('.jfmod-legacyLibraryRoot');
    if (!root) return;
    root.style.display = 'contents';
    const serverId = window.ApiClient.serverId();
    let unmount: () => void;
    if (viewStyle === 'List') {
        unmount = renderComponent(EntryLists, {
            rows,
            listOptions: {
                context: context as CollectionType,
                sortBy: sortBy?.split(',')[0] as ItemSortBy | undefined
            },
            serverId
        }, root);
    } else {
        unmount = renderComponent(EntryCards, {
            rows,
            cardOptions: getCardOptions(viewStyle, context, serverId)
        }, root);
    }

    const focusTarget = findFocusTarget(container, restoreId, restoreTmdbId);
    if (focusTarget) focusManager.focus(focusTarget);
    return unmount;
};

export const getFocusedBrowseIdentity = (container: HTMLElement) => {
    const focused = container.contains(document.activeElement) ? document.activeElement?.closest<HTMLElement>('[data-id], [data-jfmod-tmdb-id]') : null;
    return {
        id: focused?.dataset.id,
        tmdbId: focused?.dataset.jfmodTmdbId
    };
};

/** Keep legacy TV grids aligned with the plugin's asynchronous reconciliation work. */
export const subscribeLegacyBrowse = (apiClient: LegacyApiClient, refresh: () => void) => {
    let libraryTimer: ReturnType<typeof setTimeout> | undefined;
    let trackedTaskRunning = false;
    const currentUserId = apiClient.getCurrentUserId().replace(/-/g, '').toLowerCase();
    const unsubscribers = [
        apiClient.subscribe([OutboundWebSocketMessageType.UserDataChanged], ({ Data }) => {
            const changedUserId = (Data as { UserId?: string } | undefined)?.UserId?.replace(/-/g, '').toLowerCase();
            if (!changedUserId || changedUserId === currentUserId) refresh();
        }),
        apiClient.subscribe([OutboundWebSocketMessageType.LibraryChanged], ({ Data }) => {
            const update = Data as { ItemsAdded?: string[]; ItemsRemoved?: string[]; ItemsUpdated?: string[] } | undefined;
            if (!(update?.ItemsAdded?.length || update?.ItemsRemoved?.length || update?.ItemsUpdated?.length)) return;
            if (libraryTimer) clearTimeout(libraryTimer);
            libraryTimer = setTimeout(refresh, 10000);
        }),
        apiClient.subscribe([OutboundWebSocketMessageType.ScheduledTasksInfo], ({ Data }) => {
            const tasks = (Data as Array<{ Key?: string; State?: string }> | undefined)?.filter(task =>
                task.Key === 'RefreshLibrary' || task.Key === 'JellyfinModCatalogReconciliation');
            if (!tasks?.length) return;
            const isRunning = tasks.some(task => task.State !== 'Idle');
            if (trackedTaskRunning && !isRunning) {
                if (libraryTimer) clearTimeout(libraryTimer);
                libraryTimer = undefined;
                refresh();
            }
            trackedTaskRunning = isRunning;
        })
    ];
    return () => {
        if (libraryTimer) clearTimeout(libraryTimer);
        unsubscribers.forEach(unsubscribe => {
            unsubscribe();
        });
    };
};
