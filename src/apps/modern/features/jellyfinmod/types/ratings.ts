/** One rating in its own scale (Phase 9, PHASE9 "One rating model"). A missing source is absent, never zero. */
export interface Rating {
    source: RatingSource;
    value: number;
    scale: 'ten' | 'percent' | 'five' | 'four';
    votes?: number | null;
    /** `tmdb` (the entry's own snapshot), `mdblist`, or the host's own item: `host_omdb`, `host_tmdb`. */
    provider: 'tmdb' | 'mdblist' | 'host_omdb' | 'host_tmdb';
    fetchedAt?: string | null;
    url?: string | null;
    /** Older than the server's refresh window: shown with its date, never as current. */
    stale: boolean;
}

export type RatingSource = 'imdb' | 'tomatoes_critic' | 'tomatoes_audience' | 'tmdb' | 'trakt' | 'metacritic' | 'metacritic_user'
    | 'letterboxd' | 'rogerebert';

/** What every signed-in user may read: whether ratings are on and the administrator's default order. */
export interface RatingsDefaults {
    enabled: boolean;
    defaultSources: RatingSource[];
    availableSources: RatingSource[];
    refreshDays: number;
}

/** A native movie's or series' ratings, with or without a catalog entry. */
export interface ItemRatings {
    entryId?: string | null;
    ratings: Rating[];
}
