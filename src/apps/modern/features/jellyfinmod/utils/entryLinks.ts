/** Entry identities stay out of Jellyfin's native item routes and image APIs. */
export const getEntryPath = (entryId: string, serverId?: string) =>
    '/details?entryId=' + encodeURIComponent(entryId) + (serverId ? '&serverId=' + encodeURIComponent(serverId) : '');

/**
 * The page of a TMDB title that is not in the library (TM2): upstream's detail route with the mod's `tmdbType`/`tmdbId`, a
 * season's or an episode's with `season` and `episode`.
 */
export const getTmdbPath = (mediaType: 'movie' | 'series', tmdbId: number, serverId?: string, season?: number, episode?: number) =>
    '/details?tmdbType=' + mediaType + '&tmdbId=' + tmdbId + (season !== undefined ? '&season=' + season : '')
    + (episode !== undefined ? '&episode=' + episode : '') + (serverId ? '&serverId=' + encodeURIComponent(serverId) : '');

/** A series page with one of its episodes selected (`episodeId`), as an episode on Home opens it (the user, 2026-11-10). */
export const seriesEpisodePath = (episode: { Id?: string | null; SeriesId?: string | null }, serverId?: string | null) =>
    '#/details?id=' + encodeURIComponent(episode.SeriesId ?? '') + '&episodeId=' + encodeURIComponent(episode.Id ?? '')
    + (serverId ? '&serverId=' + encodeURIComponent(serverId) : '');

/** The episode a series page was opened on (`seriesEpisodePath`), if any. */
export const selectedEpisodeParam = () => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('episodeId') ?? undefined;

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
