import type { Api } from '@jellyfin/sdk/lib/api';

import { ServerConnections } from 'lib/jellyfin-apiclient';
import { queryClient } from 'utils/query/queryClient';

/**
 * Reads the library and the mod's catalog again (P4.FU12): after an action of the person's own that changes what Jellyfin or the
 * catalog holds (Remove Entry, Sync Now, Remove Placeholders), the page does not wait for the plugin's push to say so.
 */
export const invalidateCatalog = (api: Api, userId?: string) => {
    const id = userId ?? ServerConnections.currentApiClient()?.getCurrentUserId();
    if (!id) return;
    // The queue first (P4.FU12): a page that draws the new file a moment later must already know that its download ended, or its
    // marks would draw the last answer's queued or downloading on the file for a frame.
    const queue = ['JellyfinMod', api.basePath, id, 'Queue'];
    void queryClient.invalidateQueries({ queryKey: queue, exact: true }).catch(() => undefined).finally(() => {
        void queryClient.invalidateQueries({ queryKey: ['User', id, 'Items'] });
        void queryClient.invalidateQueries({ queryKey: ['User', id, 'LatestMedia'] });
        void queryClient.invalidateQueries({ predicate: query => query.queryKey[0] === 'JellyfinMod' && query.queryKey[1] === api.basePath
            && query.queryKey[2] === id && query.queryKey[3] !== 'Queue' });
    });
};
