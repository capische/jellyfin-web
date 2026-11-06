import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client';
import type { Rating, RatingSource } from '../types/ratings';

export interface RatingTitle {
    title: string;
    movie: boolean;
    imdbId?: string | null;
    tmdbId?: string | number | null;
    externalUrls?: BaseItemDto['ExternalUrls'];
}

export const nativeRatingTitle = (item: Pick<BaseItemDto, 'Name' | 'SeriesName' | 'ProviderIds' | 'ExternalUrls'> & { Type?: string | null }): RatingTitle => ({
    title: item.SeriesName || item.Name || '', movie: item.Type === 'Movie',
    imdbId: item.ProviderIds?.Imdb, tmdbId: item.ProviderIds?.Tmdb, externalUrls: item.ExternalUrls
});

/** Rebuild only known source title paths. Never carry credentials, query strings or fragments into a link. */
export const checkedRatingUrl = (source: RatingSource, value: unknown): string | undefined => {
    if (typeof value !== 'string') return;
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return;
        const host = url.hostname.replace(/^www\./, '');
        const path = url.pathname;
        const patterns = Object.fromEntries([
            ['imdb', [['imdb.com'], /^\/title\/tt\d{7,10}\/?$/]],
            ['tmdb', [['themoviedb.org'], /^\/(movie|tv)\/\d+(?:-[a-zA-Z0-9-]+)?\/?$/]],
            ['trakt', [['trakt.tv', 'app.trakt.tv'], /^\/(movies|shows)\/[a-zA-Z0-9-]+\/?$/]],
            ['tomatoes_critic', [['rottentomatoes.com'], /^\/(m|tv)\/[a-zA-Z0-9_-]+(?:\/s\d+)?\/?$/]],
            ['tomatoes_audience', [['rottentomatoes.com'], /^\/(m|tv)\/[a-zA-Z0-9_-]+(?:\/s\d+)?\/?$/]],
            ['metacritic', [['metacritic.com'], /^\/(movie|tv)\/[a-zA-Z0-9-]+(?:\/season-\d+)?\/?$/]],
            ['metacritic_user', [['metacritic.com'], /^\/(movie|tv)\/[a-zA-Z0-9-]+(?:\/season-\d+)?\/?$/]],
            ['letterboxd', [['letterboxd.com'], /^\/(?:film\/[a-zA-Z0-9-]+|tmdb\/\d+)\/?$/]],
            ['rogerebert', [['rogerebert.com'], /^\/reviews\/[a-zA-Z0-9-]+\/?$/]]
        ]) as Record<RatingSource, [string[], RegExp]>;
        const [hosts, pattern] = patterns[source];
        if (hosts.includes(host) && pattern.test(path)) return 'https://' + url.hostname + path;
    } catch { /* An invalid value is absent; the caller uses the source's fallback. */ }
};

export const ratingLinkSource = (name: string): RatingSource | undefined => {
    switch (name.toLowerCase().replace(/[^a-z]/g, '')) {
        case 'imdb': return 'imdb';
        case 'tmdb': case 'themoviedb': case 'themoviedatabase': return 'tmdb';
        case 'trakt': return 'trakt';
        case 'rottentomatoes': case 'rottentomatoescritics': return 'tomatoes_critic';
        case 'rottentomatoesaudience': return 'tomatoes_audience';
        case 'metacritic': return 'metacritic';
        case 'metacriticusers': return 'metacritic_user';
        case 'letterboxd': return 'letterboxd';
        case 'rogerebert': return 'rogerebert';
        default: return undefined;
    }
};

/** The title page when known, the approved search otherwise (D276/D277). */
export const ratingHref = (rating: Pick<Rating, 'source' | 'url'>, title: RatingTitle): string | undefined => {
    const source = rating.source;
    if (source === 'letterboxd' && !title.movie) return undefined;
    const external = title.externalUrls?.find(link => ratingLinkSource(link.Name || '') === source);
    const own = ['imdb', 'tmdb', 'trakt'].includes(source) ? external?.Url : rating.url;
    const known = checkedRatingUrl(source, own);
    if (known) return known;
    const imdb = /^tt\d{7,10}$/.test(title.imdbId || '') ? title.imdbId : undefined;
    const tmdb = /^\d+$/.test(String(title.tmdbId ?? '')) ? title.tmdbId : undefined;
    const query = encodeURIComponent(title.title);
    const kind = title.movie ? 'movie' : 'tv';
    const traktKind = title.movie ? 'movies' : 'shows';
    const idType = title.movie ? 'movie' : 'show';
    const traktSearch = tmdb ? `https://trakt.tv/search/tmdb/${tmdb}?id_type=${idType}` : undefined;
    const fallback = Object.fromEntries([
        ['imdb', imdb ? `https://www.imdb.com/title/${imdb}/` : undefined],
        ['tmdb', tmdb ? `https://www.themoviedb.org/${kind}/${tmdb}` : undefined],
        ['trakt', imdb ? `https://trakt.tv/${traktKind}/${imdb}` : traktSearch],
        ['tomatoes_critic', `https://www.rottentomatoes.com/search?search=${query}`],
        ['tomatoes_audience', `https://www.rottentomatoes.com/search?search=${query}`],
        ['metacritic', `https://www.metacritic.com/search/${query}/`],
        ['metacritic_user', `https://www.metacritic.com/search/${query}/`],
        ['letterboxd', title.movie && tmdb ? `https://letterboxd.com/tmdb/${tmdb}/` : undefined],
        ['rogerebert', `https://www.rogerebert.com/?s=${query}`]
    ]) as Record<RatingSource, string | undefined>;
    return fallback[source];
};

/** A shared site link is redundant when either of its rating rows is shown. */
export const hasRatedLink = (name: string, sources: string[]) => {
    const source = ratingLinkSource(name);
    if (!source) return false;
    if (source.startsWith('tomatoes')) return sources.some(value => value.startsWith('tomatoes'));
    if (source.startsWith('metacritic')) return sources.some(value => value.startsWith('metacritic'));
    return sources.includes(source);
};
