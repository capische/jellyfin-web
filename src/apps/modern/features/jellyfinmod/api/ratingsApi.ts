import type { Api } from '@jellyfin/sdk/lib/api';
import type { AxiosRequestConfig } from 'axios';

import type { ItemRatings, RatingsDefaults } from '../types/ratings';

const headers = (api: Api) => api.authorizationHeader ? { Authorization: api.authorizationHeader } : undefined;

/** A native movie's or series' ratings (Phase 9); 404 for an item the user cannot see. */
export const getItemRatings = async (api: Api, itemId: string, options?: AxiosRequestConfig): Promise<ItemRatings> => {
    const response = await api.axiosInstance.get<ItemRatings>(api.basePath + '/JellyfinMod/Ratings/Items/' + encodeURIComponent(itemId),
        { ...options, headers: headers(api) });
    if (!Array.isArray(response.data?.ratings)) throw new Error('Unsupported JellyfinMod ratings response');
    return response.data;
};

/** Whether ratings are on and the administrator's default order, for every signed-in user. */
export const getRatingsDefaults = async (api: Api, options?: AxiosRequestConfig): Promise<RatingsDefaults> => {
    const response = await api.axiosInstance.get<RatingsDefaults>(api.basePath + '/JellyfinMod/Ratings/Defaults',
        { ...options, headers: headers(api) });
    if (typeof response.data?.enabled !== 'boolean' || !Array.isArray(response.data.defaultSources)) {
        throw new Error('Unsupported JellyfinMod ratings defaults');
    }
    return response.data;
};

/** Queues one title's ratings refresh (administrators); a refusal is a 409 whose `title` says why. */
export const refreshEntryRatings = async (api: Api, entryId: string, options?: AxiosRequestConfig) => {
    await api.axiosInstance.post(api.basePath + '/JellyfinMod/Entries/' + encodeURIComponent(entryId) + '/Ratings/Refresh', undefined,
        { ...options, headers: headers(api) });
};

/** How many manual refreshes are still waiting or running (administrators); the refresh button's completion signal. */
export const getRatingsQueued = async (api: Api, options?: AxiosRequestConfig): Promise<number> => {
    const response = await api.axiosInstance.get<{ queued?: unknown }>(api.basePath + '/JellyfinMod/Ratings/Status',
        { ...options, headers: headers(api) });
    if (typeof response.data?.queued !== 'number') throw new Error('Unsupported JellyfinMod ratings status');
    return response.data.queued;
};
