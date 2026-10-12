/** Entry identities stay out of Jellyfin's native item routes and image APIs. */
export const getEntryPath = (entryId: string, serverId?: string) =>
    '/details?entryId=' + encodeURIComponent(entryId) + (serverId ? '&serverId=' + encodeURIComponent(serverId) : '');

/** TMDB provides image paths, never arbitrary remote image URLs. */
export const getTmdbImage = (path?: string | null, size: 'w154' | 'w185' | 'w300' | 'w342' | 'w500' | 'w1280' = 'w500') =>
    path && /^\/[a-zA-Z0-9_./-]+$/.test(path) ? 'https://image.tmdb.org/t/p/' + size + path : undefined;

let tmdbHint: HTMLLinkElement | undefined;

/**
 * Opens the connection to TMDB's image server while an entry page reads its entry, so the page's images do not also wait for
 * it (P1.FU18): from Sydney the server answers from Los Angeles, and a cold connection took about 0.4 to 0.6 s before the
 * first image could be asked for. A fresh hint each time, as the browser closes an unused connection after a few seconds.
 */
export const preconnectTmdbImages = () => {
    tmdbHint?.remove();
    tmdbHint = document.createElement('link');
    tmdbHint.rel = 'preconnect';
    tmdbHint.href = 'https://image.tmdb.org';
    document.head.appendChild(tmdbHint);
};
