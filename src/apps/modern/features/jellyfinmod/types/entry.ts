/**
 * A JellyfinMod entry. One per title, with or without a media file behind it.
 * Mirrors the plugin's Entry; see docs/jellyfinmod/UX.md §4.
 */

/** Where the media file stands. Not a workflow — just the file. */
export enum FileState {
    /** Wanted; nothing on disk and nothing in flight. */
    None = 'none',
    /** Searching indexers. */
    Searching = 'searching',
    /** Grabbed and queued at the download client. */
    Grabbed = 'grabbed',
    /** Downloading. */
    Downloading = 'downloading',
    /** On disk and playable. */
    OnDisk = 'onDisk',
    /** Watched, then reclaimed; a placeholder remains. */
    Reclaimed = 'reclaimed'
}

export interface Entry {
    id: string;
    mediaType: 'movie' | 'series';
    tmdbId: number;
    imdbId?: string | null;
    title: string;
    year?: number | null;
    overview?: string | null;
    /** TMDB path, used only when there is no Jellyfin item to take artwork from. */
    posterPath?: string | null;
    metadata?: TmdbMetadata | null;
    reclaimAfterDays?: number | null;
    state: FileState;
    monitored: boolean;
    /** Set from OnDisk onward. */
    jellyfinItemId?: string | null;
    targetLibraryId?: string | null;
    /** 0-100, while downloading. */
    progress?: number | null;
    addedAt: string;
    watchedAt?: string | null;
    /** Absolute timestamp, never a countdown — a cached "5 days left" goes stale. */
    reclaimAt?: string | null;
}

export interface HistoryRecord {
    id: string;
    entryId: string;
    eventType: string;
    summary: string;
    createdAt: string;
}

export interface TmdbMetadata {
    mediaType: 'movie' | 'series';
    tmdbId: number;
    title: string;
    premiereDate: string | null;
    overview: string | null;
    posterPath: string | null;
    backdropPath: string | null;
    imdbId: string | null;
    tvdbId: number | null;
    adult: boolean;
    communityRating: number | null;
    runtimeMinutes: number | null;
    genres: string[];
    certifications: { country: string; rating: string }[];
    seasons: { number: number; name: string; episodeCount: number; airDate: string | null; posterPath: string | null }[];
}

export interface EntryEpisode {
    id: string;
    entryId: string;
    tmdbId: number;
    seasonNumber: number;
    episodeNumber: number;
    title: string;
    overview: string | null;
    stillPath: string | null;
    airDate: string | null;
    runtimeMinutes: number | null;
    monitored: boolean;
    state: FileState;
    availability: 'onDisk' | 'missing' | 'unaired';
    jellyfinItemId: string | null;
}
