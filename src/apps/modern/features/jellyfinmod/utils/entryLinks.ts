/** Entry identities stay out of Jellyfin's native item routes and image APIs. */
export const getEntryPath = (entryId: string, serverId?: string) =>
    '/details?entryId=' + encodeURIComponent(entryId) + (serverId ? '&serverId=' + encodeURIComponent(serverId) : '');

/** TMDB provides image paths, never arbitrary remote image URLs. */
export const getTmdbImage = (path?: string | null, size: 'w500' | 'w1280' = 'w500') =>
    path && /^\/[a-zA-Z0-9_./-]+$/.test(path) ? 'https://image.tmdb.org/t/p/' + size + path : undefined;
