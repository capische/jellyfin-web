import type { AcquisitionSummary } from './acquisition';
import type { VersionDto } from './versions';

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

/** An entry's or an episode's own retention override. */
export type RetentionPolicyWire = 'inherit' | 'days' | 'never';

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
    retentionPolicy: RetentionPolicyWire;
    state: FileState;
    monitored: boolean;
    /** Set from OnDisk onward. */
    jellyfinItemId?: string | null;
    /**
     * The Jellyfin item that stands for the title while it has no file (P1.FU26): the plugin's placeholder movie, or the series
     * item its placeholder episodes make. Set on entry detail and Browse answers only.
     */
    placeholderItemId?: string | null;
    /**
     * The Jellyfin item that plays this movie's file once Jellyfin can play it (P4.FU12): bound, not a placeholder, refreshed and
     * probed. Read from Jellyfin by the plugin on entry detail answers; null while the file is only listed or absent, absent
     * from older plugins. An import's ring is kept until the page has drawn this item.
     */
    playableItemId?: string | null;
    targetLibraryId?: string | null;
    /** 0-100, while downloading. */
    progress?: number | null;
    addedAt: string;
    watchedAt?: string | null;
    /** Absolute timestamp, never a countdown — a cached "5 days left" goes stale. */
    reclaimAt?: string | null;
    /** Administrator-assigned quality profile; null inherits the default (P4.A2). */
    qualityProfileId?: string | null;
}

export interface HistoryRecord {
    id: string;
    entryId: string;
    eventType: string;
    summary: string;
    createdAt: string;
    /** The episode the event is about; null for the title, absent from plugins before P10.E3. */
    episodeId?: string | null;
    /** The binding of the one file the event is about; null for title and episode events and older events (`history.files`). */
    bindingId?: string | null;
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
    /** TMDB's vote count beside the score (Phase 9); absent from snapshots taken before it. */
    voteCount?: number | null;
    runtimeMinutes: number | null;
    genres: string[];
    certifications: { country: string; rating: string }[];
    /** A season's overview is absent from plugins before P1.FU14, and from a series not refreshed since. */
    seasons: { number: number; name: string; episodeCount: number; airDate: string | null; posterPath: string | null; overview?: string | null }[];
    /**
     * TMDB's rating of each episode by TMDB episode id (P1.FU14); null or absent when the series' metadata predates it, which
     * makes opening the series load its list once more.
     */
    episodeRatings?: Record<string, number> | null;
    /**
     * The series' regular cast as TMDB credits it, by billing, at most 15 (P1.FU15); absent when the series' metadata predates
     * it, which makes opening the series load its list once more, and empty when TMDB names nobody.
     */
    cast?: TmdbCastCredit[] | null;
}

/** A person TMDB credits as cast (P1.FU15): a series' regular, or an episode's guest star. */
export interface TmdbCastCredit {
    id: number;
    name: string;
    character?: string | null;
    profilePath?: string | null;
    order: number;
}

/** A person on an episode's crew whom Jellyfin keeps (P1.FU15): `type` is Jellyfin's person kind, `job` TMDB's job. */
export interface TmdbCrewCredit {
    id: number;
    name: string;
    type: 'Director' | 'Writer' | 'Producer';
    job: string;
    profilePath?: string | null;
}

/** An episode's guest stars and crew as Jellyfin's TMDB provider keeps them for an episode it has (P1.FU15). */
export interface EpisodeCredits {
    guestStars: TmdbCastCredit[];
    crew: TmdbCrewCredit[];
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
    /** The episode's own retention override; absent from plugins before P10.E3. */
    retentionPolicy?: RetentionPolicyWire;
    /** The episode's own window in days when `retentionPolicy` is `days` (PHASE10 Q4). */
    reclaimAfterDays?: number | null;
    state: FileState;
    availability: 'onDisk' | 'missing' | 'unaired' | 'reclaimed';
    jellyfinItemId: string | null;
    /**
     * The Jellyfin placeholder item (a media stub, `IsPlaceHolder`) that stands for this missing episode (P1.FU24); absent when
     * the episode has a file, no placeholder, or the plugin is older.
     */
    placeholderItemId?: string | null;
    /** The Jellyfin item that plays this episode's file once Jellyfin can play it (P4.FU12); see the entry's `playableItemId`. */
    playableItemId?: string | null;
    /** 0-100 while `state` is projected as `downloading`; `availability` stays the file truth (P5.I3). */
    progress?: number | null;
    retention: RetentionSummary | null;
    /** Newest grab of this episode; absent from older plugins (P4.A6). */
    acquisition?: AcquisitionSummary | null;
    /** The episode's running retention window; absent from older plugins (PHASE10 Q8). */
    retentionWarning?: RetentionWarning | null;
    /** Playable versions, empty unless the episode has a file; absent from plugins without `versions` (P6.M8). */
    versions?: VersionDto[];
    /** TMDB's guest stars and crew (P1.FU15); null until the series' list is loaded with them, absent from older plugins. */
    credits?: EpisodeCredits | null;
}

/** A running retention window, shown to every viewer (PHASE10 Q8, Q11). */
export interface RetentionWarning {
    deadline: string;
    /** Why the window started, for example `watched on another device (Trakt)`. */
    cause: string;
    /** The files that will be deleted; kept files are left out. Empty for ordinary users, who see the date and cause (RET2-R10). */
    files: string[];
    /** The date has passed: the files go at the next retention run (RET2-R5). */
    overdue?: boolean;
}

export interface RetentionSummary {
    enabled: boolean;
    policy: RetentionPolicyWire;
    state: 'disabled' | 'blocked' | 'waiting' | 'scheduled' | 'mixed';
    reason: string;
    deadline: string | null;
}
