import type { Api } from '@jellyfin/sdk/lib/api';
import type { AxiosRequestConfig } from 'axios';

/** The plugin's answer for one item, for the signed-in user only (P7.Q16). */
export interface TraktItemStatus {
    /** The stock Trakt plugin is installed and active on the server. */
    installed: boolean;
    /** Watch history for this movie or episode, or an episode of this season or series, arrived from Trakt. */
    hasHistory: boolean;
    /** When it last arrived (UTC), or absent. */
    lastSyncedAt?: string | null;
}

export const getTraktItemStatus = async (api: Api, itemId: string, options?: AxiosRequestConfig): Promise<TraktItemStatus> => {
    const response = await api.axiosInstance.get<TraktItemStatus>(
        api.basePath + '/JellyfinMod/Trakt/Items/' + encodeURIComponent(itemId),
        { ...options, headers: api.authorizationHeader ? { Authorization: api.authorizationHeader } : undefined }
    );
    const data = response.data;
    if (typeof data?.installed !== 'boolean' || typeof data.hasHistory !== 'boolean') {
        throw new Error('Unsupported JellyfinMod Trakt response');
    }
    return data;
};
