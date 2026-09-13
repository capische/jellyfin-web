import type { Api } from '@jellyfin/sdk/lib/api';
import type { AxiosRequestConfig } from 'axios';

import type { Entry, EntryEpisode, HistoryRecord, TmdbMetadata } from '../types/entry';
import type { BrowseRow } from '../types/browse';
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
    const data = response.data as { Name?: unknown; Version?: unknown; Ok?: unknown };
    if (typeof data.Name !== 'string' || typeof data.Version !== 'string' || typeof data.Ok !== 'boolean') {
        throw new Error('Unsupported JellyfinMod health response');
    }
    return { name: data.Name, version: data.Version, ok: data.Ok };
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
    sortBy?: string[];
    sortOrder?: string;
    randomSeed?: string;
    startIndex?: number;
    limit?: number;
    alphabet?: string | null;
    filters?: Partial<Record<Uncapitalize<Exclude<keyof Filters, 'FileStates' | 'EpisodeFilter' | 'EpisodesStatus'>>, unknown>>;
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

export const patchEpisode = async (api: Api, entryId: string, episodeId: string, monitored: boolean, options?: AxiosRequestConfig): Promise<EntryEpisode> => {
    const response = await api.axiosInstance.patch<EntryEpisode>(api.basePath + BASE + '/Entries/' + encodeURIComponent(entryId)
        + '/Episodes/' + encodeURIComponent(episodeId), { monitored }, { ...options, headers: authorization(api) });
    return response.data;
};

export const removeEntry = async (api: Api, id: string, options?: AxiosRequestConfig): Promise<void> => {
    await api.axiosInstance.delete(api.basePath + BASE + '/Entries/' + encodeURIComponent(id), { ...options, headers: authorization(api) });
};

export const searchDiscovery = async (api: Api, params: DiscoveryQuery, options?: AxiosRequestConfig): Promise<DiscoveryResult> => {
    const response = await api.axiosInstance.get<DiscoveryResult>(api.basePath + BASE + '/Discover/Search',
        { ...options, headers: authorization(api), params });
    return response.data;
};
