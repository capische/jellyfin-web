import type { CollectionType } from '@jellyfin/sdk/lib/generated-client/models/collection-type';
import type { ItemSortBy } from '@jellyfin/sdk/lib/generated-client/models/item-sort-by';
import { OutboundWebSocketMessageType } from '@jellyfin/sdk/lib/websocket';
import { CardShape } from 'components/cardbuilder/utils/shape';
import focusManager from 'components/focusManager';
import type { CardOptions } from 'types/cardOptions';
import { renderComponent } from 'utils/reactUtils';

import EntryCards from '../components/EntryCards';
import './legacyLibrary.scss';
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

/** A legacy value is a delimited string from the filter dialog, an array, or empty after a reset. */
type LegacyList = string | number | Array<string | number> | null | undefined;

interface LegacyQuery {
    ParentId?: string;
    SortBy?: string;
    SortOrder?: string;
    StartIndex?: number;
    Limit?: number;
    NameStartsWith?: string;
    NameLessThan?: string;
    Genres?: LegacyList;
    Years?: LegacyList;
    OfficialRatings?: LegacyList;
    Tags?: LegacyList;
    StudioIds?: LegacyList;
    SeriesStatus?: LegacyList;
    VideoTypes?: LegacyList;
    AudioLanguages?: LegacyList;
    SubtitleLanguages?: LegacyList;
    Filters?: LegacyList;
    IsPlayed?: boolean | null;
    IsFavorite?: boolean | null;
    IsResumable?: boolean | null;
    IsHD?: boolean | null;
    Is4K?: boolean | null;
    Is3D?: boolean | null;
    HasSubtitles?: boolean | null;
    HasTrailer?: boolean | null;
    HasSpecialFeature?: boolean | null;
    HasThemeSong?: boolean | null;
    HasThemeVideo?: boolean | null;
    JellyfinModRandomSeed?: string;
    JellyfinModState?: LegacyList;
    JellyfinModDueWithinDays?: number | null;
}

export interface LegacyBrowseResult {
    Items: BrowseRow[];
    TotalRecordCount: number;
    JellyfinModRows: true;
}

/**
 * Splits the legacy filter dialog's values (P1.W8). It writes genres, tags and ratings joined with `|`, years,
 * series status, video types and `Filters` joined with `,`, and an empty string after a reset.
 */
const list = (value: LegacyList, delimiter: string): string[] => {
    if (value === null || value === undefined) return [];
    const parts = Array.isArray(value) ? value.map(String) : String(value).split(delimiter);
    return [...new Set(parts.map(part => part.trim()).filter(part => part.length > 0))];
};

const FEATURES = ['HasSubtitles', 'HasTrailer', 'HasSpecialFeature', 'HasThemeSong', 'HasThemeVideo'] as const;

const toRequest = (query: LegacyQuery, mediaType: 'movie' | 'series'): BrowseRequest => {
    // The dialog writes `IsUnPlayed`; Jellyfin reads Filters tokens case-insensitively, and so does this.
    const statusTokens = ['IsPlayed', 'IsUnplayed', 'IsFavorite', 'IsResumable'];
    const status = new Set<string>(list(query.Filters, ',').flatMap(token =>
        statusTokens.filter(known => known.toLowerCase() === token.toLowerCase())));
    if (query.IsPlayed === true) status.add('IsPlayed');
    if (query.IsPlayed === false) status.add('IsUnplayed');
    if (query.IsFavorite) status.add('IsFavorite');
    if (query.IsResumable) status.add('IsResumable');
    const videoBasicFilter: string[] = [];
    if (query.IsHD === true) videoBasicFilter.push('IsHD');
    if (query.IsHD === false) videoBasicFilter.push('IsSD');
    if (query.Is4K) videoBasicFilter.push('Is4K');
    if (query.Is3D) videoBasicFilter.push('Is3D');
    const state = list(query.JellyfinModState, ',');

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
        state: state.length > 0 ? state : undefined,
        dueWithinDays: query.JellyfinModDueWithinDays ?? undefined,
        filters: {
            genres: list(query.Genres, '|'),
            years: list(query.Years, ',').map(Number).filter(Number.isInteger),
            officialRatings: list(query.OfficialRatings, '|'),
            tags: list(query.Tags, '|'),
            studioIds: list(query.StudioIds, ','),
            status: [...status],
            seriesStatus: list(query.SeriesStatus, ','),
            videoTypes: list(query.VideoTypes, ','),
            features: FEATURES.filter(feature => query[feature] === true),
            videoBasicFilter,
            audioLanguages: list(query.AudioLanguages, ','),
            subtitleLanguages: list(query.SubtitleLanguages, ',')
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
    } catch (error) {
        // Without the plugin (404) the stock grid is expected; anything else is a mod bug that must not hide
        // file-less and reclaimed titles silently (P1.W8).
        const status = (error as { status?: number } | undefined)?.status;
        if (status !== 404) console.error('[JellyfinMod] Browse failed; showing the native grid instead', status, error);
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
    // The wrapper lays cards out itself instead of relying on display: contents, which engines older than
    // Chromium 65 ignore and which collapsed the grid to one card per row (P1.W11).
    root.className = ['jfmod-legacyLibraryRoot', viewStyle === 'List' ? 'vertical-list' : 'vertical-wrap',
        container.classList.contains('centered') ? 'centered' : ''].filter(Boolean).join(' ');
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

/**
 * Keep legacy TV grids aligned with the plugin's asynchronous reconciliation work. While the view is hidden
 * behind another page, changes are only remembered and one refresh runs when it is shown again, so a hidden
 * grid never shows the spinner, scrolls or steals focus from the visible page (P2.R10).
 */
export const subscribeLegacyBrowse = (apiClient: LegacyApiClient, onRefresh: () => void, view?: HTMLElement) => {
    let libraryTimer: ReturnType<typeof setTimeout> | undefined;
    let trackedTaskRunning = false;
    let hidden = false;
    let pendingRefresh = false;
    const refresh = () => {
        if (hidden) {
            pendingRefresh = true;
            return;
        }
        onRefresh();
    };
    const onHide = () => {
        hidden = true;
    };
    const onShow = () => {
        hidden = false;
        if (!pendingRefresh) return;
        pendingRefresh = false;
        onRefresh();
    };
    view?.addEventListener('viewbeforehide', onHide);
    view?.addEventListener('viewshow', onShow);
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
        view?.removeEventListener('viewbeforehide', onHide);
        view?.removeEventListener('viewshow', onShow);
        unsubscribers.forEach(unsubscribe => {
            unsubscribe();
        });
    };
};
