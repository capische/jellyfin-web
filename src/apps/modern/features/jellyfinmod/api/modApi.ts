import type { Api } from '@jellyfin/sdk/lib/api';
import type { AxiosRequestConfig } from 'axios';

import type { AcquisitionSummary, GrabOperation, QualityProfile, ReleaseIntent, ReleaseSearch } from '../types/acquisition';
import type { Entry, EntryEpisode, HistoryRecord, RetentionSummary, TmdbMetadata } from '../types/entry';
import type { BrowseRow } from '../types/browse';
import type { ImportOperation, QueueList, QueueQuery, RemoveQueueRequest } from '../types/queue';
import type { UpgradeStateDto, VersionDto } from '../types/versions';
import type { Filters } from 'types/library';

/**
 * Thin client for the plugin's own endpoints. Hand-written on purpose: these are ours, so they
 * are not in the generated SDK, and the fork must keep working when the plugin is absent.
 */

const BASE = '/JellyfinMod';

export interface EntryQuery {
    jellyfinItemId?: string;
    mediaType?: 'movie' | 'series';
    /** Server-side file-state filter; omit for everything. */
    state?: string[];
    query?: string;
    targetLibraryId?: string;
    startIndex?: number;
    limit?: number;
    sortBy?: 'SortName' | 'DateCreated' | 'ProductionYear';
    sortOrder?: 'Ascending' | 'Descending';
}

export interface EntriesResult {
    items: Entry[];
    totalRecordCount: number;
}

export const getEntries = async (
    api: Api,
    params: EntryQuery = {},
    options?: AxiosRequestConfig
): Promise<EntriesResult> => {
    const response = await api.axiosInstance.get<EntriesResult>(
        api.basePath + BASE + '/Entries',
        { ...options, headers: api.authorizationHeader ? { Authorization: api.authorizationHeader } : undefined, params, paramsSerializer: { indexes: null } }
    );
    return response.data;
};

export const getPluginHealth = async (api: Api, options?: AxiosRequestConfig) => {
    const response = await api.axiosInstance.get(
        api.basePath + BASE + '/Health',
        { ...options, headers: api.authorizationHeader ? { Authorization: api.authorizationHeader } : undefined }
    );
    const data = response.data as { Name?: unknown; Version?: unknown; Ok?: unknown; Capabilities?: unknown };
    if (typeof data.Name !== 'string' || typeof data.Version !== 'string' || typeof data.Ok !== 'boolean') {
        throw new Error('Unsupported JellyfinMod health response');
    }
    // An older plugin lists no capabilities; newer request fields are then not sent (P1.W14).
    const capabilities = Array.isArray(data.Capabilities) ?
        data.Capabilities.filter((value): value is string => typeof value === 'string') :
        [];
    return { name: data.Name, version: data.Version, ok: data.Ok, capabilities };
};

export interface CreateEntryRequest {
    mediaType: 'movie' | 'series';
    tmdbId: number;
    targetLibraryId: string;
}

export interface CreateEntryResult {
    entry: Entry;
    created: boolean;
}

export interface EntryDetail {
    entry: Entry;
    history: HistoryRecord[];
    episodes: EntryEpisode[];
    retention: RetentionSummary;
    /** Newest grab of a movie entry; absent from older plugins (P4.A6). */
    acquisition?: AcquisitionSummary | null;
    /** Playable versions of a movie with files; absent from plugins without `versions` (P6.M8). */
    versions?: VersionDto[];
    /** Administrators only: whether an upgrade is due and why not (P6.M5). */
    upgrade?: UpgradeStateDto | null;
}

export interface DiscoveryQuery {
    q: string;
    type: 'movie' | 'series';
    targetLibraryId?: string;
    page?: number;
}

export interface DiscoveryResult {
    items: TmdbMetadata[];
    nextPage: number | null;
}

const authorization = (api: Api) => api.authorizationHeader ? { Authorization: api.authorizationHeader } : undefined;

export interface BrowseRequest {
    mediaType: 'movie' | 'series';
    targetLibraryId?: string;
    query?: string;
    state?: string[];
    dueWithinDays?: number;
    sortBy?: string[];
    sortOrder?: string;
    randomSeed?: string;
    startIndex?: number;
    limit?: number;
    alphabet?: string | null;
    filters?: Partial<Record<Uncapitalize<Exclude<keyof Filters,
        'FileStates' | 'RetentionDueWithinDays' | 'EpisodeFilter' | 'EpisodesStatus'>>, unknown>>;
}

export interface BrowseResult {
    items: BrowseRow[];
    totalRecordCount: number;
    hasCatalogEntries: boolean;
}

export const browseEntries = async (api: Api, request: BrowseRequest, options?: AxiosRequestConfig): Promise<BrowseResult> => {
    const response = await api.axiosInstance.post<BrowseResult>(api.basePath + BASE + '/Browse', request,
        { ...options, headers: authorization(api) });
    return response.data;
};

export const createEntry = async (api: Api, request: CreateEntryRequest, options?: AxiosRequestConfig): Promise<CreateEntryResult> => {
    const response = await api.axiosInstance.post<CreateEntryResult>(api.basePath + BASE + '/Entries', request,
        { ...options, headers: authorization(api) });
    return response.data;
};

export const getEntry = async (api: Api, id: string, options?: AxiosRequestConfig): Promise<EntryDetail> => {
    const response = await api.axiosInstance.get<EntryDetail>(api.basePath + BASE + '/Entries/' + encodeURIComponent(id),
        { ...options, headers: authorization(api) });
    return response.data;
};

export const refreshEntry = async (api: Api, id: string, options?: AxiosRequestConfig): Promise<EntryDetail> => {
    const response = await api.axiosInstance.post<EntryDetail>(api.basePath + BASE + '/Entries/' + encodeURIComponent(id) + '/Refresh', undefined,
        { ...options, headers: authorization(api) });
    return response.data;
};

export const patchEntry = async (api: Api, id: string, monitored: boolean, options?: AxiosRequestConfig): Promise<Entry> => {
    const response = await api.axiosInstance.patch<Entry>(api.basePath + BASE + '/Entries/' + encodeURIComponent(id), { monitored },
        { ...options, headers: authorization(api) });
    return response.data;
};

export const keepEntry = async (api: Api, id: string, options?: AxiosRequestConfig): Promise<Entry> => {
    const response = await api.axiosInstance.post<Entry>(api.basePath + BASE + '/Entries/' + encodeURIComponent(id) + '/Keep', undefined,
        { ...options, headers: authorization(api) });
    return response.data;
};

export const patchEpisode = async (api: Api, entryId: string, episodeId: string, monitored: boolean, options?: AxiosRequestConfig): Promise<EntryEpisode> => {
    const response = await api.axiosInstance.patch<EntryEpisode>(api.basePath + BASE + '/Entries/' + encodeURIComponent(entryId)
        + '/Episodes/' + encodeURIComponent(episodeId), { monitored }, { ...options, headers: authorization(api) });
    return response.data;
};

/**
 * Administrator-only. Asks the next automation run to search this title, or one episode of it, and resets its
 * backoff (P6.M3). The target's monitoring is left as it is.
 */
export const requestSearch = async (api: Api, entryId: string, episodeId?: string, options?: AxiosRequestConfig): Promise<void> => {
    const path = api.basePath + BASE + '/Entries/' + encodeURIComponent(entryId)
        + (episodeId ? '/Episodes/' + encodeURIComponent(episodeId) : '');
    await api.axiosInstance.patch(path, { searchNow: true }, { ...options, headers: authorization(api) });
};

export const removeEntry = async (api: Api, id: string, options?: AxiosRequestConfig): Promise<void> => {
    await api.axiosInstance.delete(api.basePath + BASE + '/Entries/' + encodeURIComponent(id), { ...options, headers: authorization(api) });
};

export const searchDiscovery = async (api: Api, params: DiscoveryQuery, options?: AxiosRequestConfig): Promise<DiscoveryResult> => {
    const response = await api.axiosInstance.get<DiscoveryResult>(api.basePath + BASE + '/Discover/Search',
        { ...options, headers: authorization(api), params });
    return response.data;
};

export interface ReleaseQuery {
    entryId: string;
    /** Required for a series: one stable episode per search (P4.A1). */
    episodeId?: string;
    /** Rescores this search only; never changes the entry's saved profile. */
    profileId?: string;
    /** Omitted means `acquire`; `addVersion` needs the `versions` capability (P6.M6). */
    intent?: ReleaseIntent;
}

/** Searches enabled indexers for one target. Never starts a download. Administrator-only. */
export const searchReleases = async (api: Api, params: ReleaseQuery, options?: AxiosRequestConfig): Promise<ReleaseSearch> => {
    const response = await api.axiosInstance.get<ReleaseSearch>(api.basePath + BASE + '/Releases',
        { ...options, headers: authorization(api), params });
    return response.data;
};

/** Grabs one eligible release; the server holds it before sending it to the client (user decision 2). */
export const grabRelease = async (api: Api, request: { searchId: string; releaseId: string; idempotencyKey: string },
    options?: AxiosRequestConfig): Promise<GrabOperation> => {
    const response = await api.axiosInstance.post<GrabOperation>(api.basePath + BASE + '/Releases/Grab', request,
        { ...options, headers: authorization(api) });
    return response.data;
};

export const getGrab = async (api: Api, id: string, options?: AxiosRequestConfig): Promise<GrabOperation> => {
    const response = await api.axiosInstance.get<GrabOperation>(api.basePath + BASE + '/Grabs/' + encodeURIComponent(id),
        { ...options, headers: authorization(api) });
    return response.data;
};

/** Cancels a held grab. Idempotent; the server answers 409 once submission has started. */
export const cancelGrab = async (api: Api, id: string, options?: AxiosRequestConfig): Promise<GrabOperation> => {
    const response = await api.axiosInstance.post<GrabOperation>(api.basePath + BASE + '/Grabs/' + encodeURIComponent(id) + '/Cancel',
        undefined, { ...options, headers: authorization(api) });
    return response.data;
};

export const getQualityProfiles = async (api: Api, options?: AxiosRequestConfig): Promise<QualityProfile[]> => {
    const response = await api.axiosInstance.get<QualityProfile[]>(api.basePath + BASE + '/Settings/QualityProfiles',
        { ...options, headers: authorization(api) });
    return response.data;
};

/**
 * The download queue (P5.I7). Answers 403 `queue_admin_only` to an ordinary user while the administrator keeps
 * the queue private, which is the default.
 */
export const getQueue = async (api: Api, params: QueueQuery = {}, options?: AxiosRequestConfig): Promise<QueueList> => {
    const response = await api.axiosInstance.get<QueueList>(api.basePath + BASE + '/Queue',
        { ...options, headers: authorization(api), params, paramsSerializer: { indexes: null } });
    return response.data;
};

/** Administrator-only. Cancels the import; never deletes a library file. */
export const removeQueueRow = async (api: Api, id: string, request: RemoveQueueRequest, options?: AxiosRequestConfig): Promise<ImportOperation> => {
    const response = await api.axiosInstance.delete<ImportOperation>(api.basePath + BASE + '/Queue/' + encodeURIComponent(id),
        { ...options, headers: authorization(api), data: request });
    return response.data;
};

/** Administrator-only. Starts a new import for the same grab from a blocked or failed one (202). */
export const retryImport = async (api: Api, id: string, options?: AxiosRequestConfig): Promise<ImportOperation> => {
    const response = await api.axiosInstance.post<ImportOperation>(api.basePath + BASE + '/Imports/' + encodeURIComponent(id) + '/Retry',
        undefined, { ...options, headers: authorization(api) });
    return response.data;
};

export const getImport = async (api: Api, id: string, options?: AxiosRequestConfig): Promise<ImportOperation> => {
    const response = await api.axiosInstance.get<ImportOperation>(api.basePath + BASE + '/Imports/' + encodeURIComponent(id),
        { ...options, headers: authorization(api) });
    return response.data;
};
