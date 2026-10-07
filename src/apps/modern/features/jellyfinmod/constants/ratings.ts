import type { Rating, RatingSource } from '../types/ratings';

/** Ratings on detail pages and `Ratings/Items` (Phase 9). */
export const RATINGS_CAPABILITY = 'ratings';
/** `POST /Browse` takes `ratingSource` and rows carry `rating` (P9.R7). */
export const RATINGS_CARDS_CAPABILITY = 'ratings.cards';
/** The administrator's `Settings/Ratings`, Test, Status and manual refresh. */
export const RATINGS_SETTINGS_CAPABILITY = 'settings.ratings';

/** The per-user preferences, kept in Jellyfin's own per-user display preferences (plan decision 8). */
export const RATINGS_SOURCES_KEY = 'jfmodRatingsSources';
export const RATINGS_CARD_SOURCE_KEY = 'jfmodRatingsCardSource';

/** Every source this release shows, in the complete order; the server's list wins when it has one. */
export const ALL_SOURCES: RatingSource[] = ['imdb', 'tomatoes_critic', 'tomatoes_audience', 'tmdb', 'trakt', 'metacritic', 'metacritic_user',
    'letterboxd', 'rogerebert'];
/** The decided default order (user decision 6, 2026-10-07), used until the server's answer arrives. */
export const DEFAULT_SOURCES: RatingSource[] = ['imdb', 'tomatoes_critic', 'tomatoes_audience', 'tmdb', 'trakt'];

/** Short names for the chips; the long ones for preferences and tooltips. */
// Keyed by the wire names, which are snake_case; built from pairs so the names stay exactly the server's.
export const SOURCE_SHORT = Object.fromEntries([
    ['imdb', 'IMDb'], ['tomatoes_critic', 'RT critics'], ['tomatoes_audience', 'RT audience'], ['tmdb', 'TMDB'], ['trakt', 'Trakt'],
    ['metacritic', 'Metacritic'], ['metacritic_user', 'Metacritic users'], ['letterboxd', 'Letterboxd'], ['rogerebert', 'Roger Ebert']
]) as Record<RatingSource, string>;

export const SOURCE_LONG = Object.fromEntries([
    ['imdb', 'IMDb'], ['tomatoes_critic', 'Rotten Tomatoes critics (Tomatometer)'], ['tomatoes_audience', 'Rotten Tomatoes audience (Popcornmeter)'],
    ['tmdb', 'TMDB'], ['trakt', 'Trakt'], ['metacritic', 'Metacritic critics'], ['metacritic_user', 'Metacritic users'],
    ['letterboxd', 'Letterboxd'], ['rogerebert', 'Roger Ebert']
]) as Record<RatingSource, string>;

export const isRatingSource = (value: unknown): value is RatingSource =>
    typeof value === 'string' && (ALL_SOURCES as string[]).includes(value);

/** A value in its own scale: 8.1, 92%, 4.2/5, 3.5/4. Nothing is converted or combined. */
export const formatValue = (rating: Pick<Rating, 'value' | 'scale'>) => {
    switch (rating.scale) {
        case 'percent': return Math.round(rating.value) + '%';
        case 'five': return rating.value.toFixed(1) + '/5';
        case 'four': return rating.value.toFixed(1) + '/4';
        default: return rating.value.toFixed(1);
    }
};

/** 250000 → 250K, 1234 → 1.2K, 52 → 52. */
export const formatVotes = (votes: number) => {
    if (votes >= 1_000_000) return (votes / 1_000_000).toFixed(votes >= 10_000_000 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (votes >= 1_000) return (votes / 1_000).toFixed(votes >= 10_000 ? 0 : 1).replace(/\.0$/, '') + 'K';
    return String(votes);
};

const formatDate = (iso?: string | null) => {
    const date = iso ? new Date(iso) : null;
    return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString() : null;
};

/** Where a value came from, said plainly: aggregator values can differ from the provider's own site (PHASE9 UX). */
export const provenance = (rating: Rating) => {
    const asOf = formatDate(rating.fetchedAt);
    switch (rating.provider) {
        case 'mdblist': return 'via MDBList' + (asOf ? ', as of ' + asOf : '') + '; may differ from the source’s own site';
        case 'tmdb': return 'via TMDB, from this title’s metadata';
        default: return 'from this server’s own metadata' + (asOf ? ', as of ' + asOf : '');
    }
};

/** The chip's text, with the date when the value is older than the refresh window. */
export const chipText = (rating: Rating) => {
    const votes = rating.votes ? ' (' + formatVotes(rating.votes) + ')' : '';
    const stale = rating.stale ? ' · ' + (formatDate(rating.fetchedAt) ?? 'old') : '';
    return SOURCE_SHORT[rating.source] + ' ' + formatValue(rating) + votes + stale;
};

/** The sentence a screen reader and a tooltip give. */
export const chipLabel = (rating: Rating) =>
    SOURCE_LONG[rating.source] + ' ' + formatValue(rating) + (rating.votes ? ', ' + rating.votes.toLocaleString() + ' votes' : '')
    + ' — ' + provenance(rating);

/**
 * How long one answer is reused: the app's own default. Ratings change on the server's daily schedule, but an administrator
 * turning ratings off or on should reach every page within a minute.
 */
export const RATINGS_STALE_MS = 60 * 1000;
