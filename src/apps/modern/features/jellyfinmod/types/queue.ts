import type { ParsedRelease } from './acquisition';
import type { AutomationSummary } from './versions';

/**
 * Phase 5 queue and import contract, mirroring the plugin's Queue and ImportOperation DTOs (PHASE5.md, API contract).
 * Rows never carry a credential or a credential-bearing URL; physical paths appear only in the admin block.
 */

export type QueueState = 'queued' | 'downloading' | 'stalled' | 'identifying' | 'linking' | 'scanning' | 'seeding'
    | 'blocked' | 'failed' | 'unknown';

export interface QueueEntryRef {
    id: string;
    mediaType: 'movie' | 'series';
    title: string;
    year: number | null;
    posterPath: string | null;
    jellyfinItemId: string | null;
    targetLibraryId: string | null;
}

export interface QueueEpisodeRef {
    id: string;
    seasonNumber: number;
    episodeNumber: number;
    title: string;
}

/** Administrators only; null for ordinary users. `openUrl` is credential-free. */
export interface QueueClient {
    id: string;
    name: string;
    openUrl: string | null;
}

export type SeedWaitReason = 'complete' | 'ratio' | 'time';

export interface QueueSeeding {
    id: string;
    state: 'waiting' | 'removing' | 'blocked';
    reason: string | null;
    ratio: number | null;
    goalRatio: number | null;
    seedingSeconds: number | null;
    goalSeconds: number | null;
    waitingFor: SeedWaitReason[];
    goalMetAt: string | null;
    libraryLinkPresent: boolean | null;
    releaseEnabled: boolean;
}

/** Present only for administrators. */
export interface QueueAdminDetail {
    sourcePath: string | null;
    sourceClientPath: string | null;
    destinationPath: string | null;
    sourcePhysicalIdentity: string | null;
    destinationPhysicalIdentity: string | null;
    hardlinkCountAfter: number | null;
    error: string | null;
    infoHash: string | null;
}

export interface QueueRow {
    /** The import operation id. */
    id: string;
    grabId: string;
    entry: QueueEntryRef | null;
    episode: QueueEpisodeRef | null;
    releaseTitle: string;
    state: QueueState;
    /**
     * The import's own step; for a grab the client has not accepted yet (P4.FU10) `held` while it can be cancelled and
     * `submitting` after, with the grab's id as the row's `id` (the row turns into the import's once the client has it).
     */
    importState: string;
    reason: string | null;
    /** The server's sentence for `reason`. */
    message: string | null;
    /** 0..1; null when never observed. An `unknown` row keeps its last value. */
    progress: number | null;
    sizeBytes: number | null;
    downloadedBytes: number | null;
    downloadRateBytes: number | null;
    etaSeconds: number | null;
    stalledSince: string | null;
    observedAt: string | null;
    versionLabel: string | null;
    intent: 'acquire' | 'addVersion';
    createdAt: string;
    updatedAt: string;
    client: QueueClient | null;
    seeding: QueueSeeding | null;
    admin?: QueueAdminDetail;
    /** A season or series pack's one row; `episode` is then null. Absent from plugins without `acquisition.packs`. */
    pack?: QueuePack | null;
    /** The release as the picker parsed it when it was grabbed (P1.FU20); absent from older plugins, null when none was kept. */
    parsed?: ParsedRelease | null;
    /** The indexer the release came from (P1.FU20); absent from older plugins. */
    indexerName?: string | null;
    /**
     * The grab's mode (the upgrade status, 2026-10-28): `fill` a first download, `add` another version beside what the title
     * holds, `replace` one that then replaces it. Absent from older plugins.
     */
    mode?: 'fill' | 'add' | 'replace' | null;
    /** A movie's or an episode's Replace: the files it removes, with the resolution their names give. Null for any other row. */
    replaces?: QueueReplaceTarget[] | null;
    /**
     * Web only: this row (or a pack episode's view of it, `packEpisodeView`) brings a title that already plays another version.
     * Absent on the server's rows, where `intent` and the pack's `held` say it (`isNewVersion`).
     */
    newVersion?: boolean;
}

/** One file a Replace removes; `label` is its resolution (`1080p`) when its file name gives one. */
export interface QueueReplaceTarget {
    bindingId: string;
    label: string | null;
}

/** One claimed episode of a pack and its newest import, if one has started. */
export interface QueuePackEpisode {
    episodeId: string;
    seasonNumber: number;
    episodeNumber: number;
    importId: string | null;
    importState: string | null;
    reason: string | null;
    /**
     * The episode's own file, 0..1 (next-up priority, P5.FU3): read from the client while it downloads, 1 once its import left
     * waiting, null when unknown. Absent from older plugins, which show the pack's figure on every episode.
     */
    progress?: number | null;
    /** The episode's file length while the client lists it (P4.FU5), for its time left at the pack's rate. */
    sizeBytes?: number | null;
    /** The episode held a file when the pack claimed it, so an `add` or `replace` pack brings it a new version. */
    held?: boolean;
}

/** A pack's row detail (season packs, 2026-10-08): `Season 1 pack · 4 episodes`, its mode and each claimed episode. */
export interface QueuePack {
    scope: 'season' | 'series';
    label: string;
    mode: 'fill' | 'add' | 'replace';
    episodes: QueuePackEpisode[];
}

export interface QueueClientStatus {
    reachable: boolean;
    checkedAt: string | null;
    reason: string | null;
}

export interface QueueList {
    items: QueueRow[];
    totalRecordCount: number;
    generatedAt: string;
    clientStatus: QueueClientStatus;
    importEnabled: boolean;
    seedReleaseEnabled: boolean;
    /** Automation state (P6.M8); null or absent from an older plugin. */
    automation?: AutomationSummary | null;
}

export interface QueueQuery {
    state?: QueueState[];
    entryId?: string;
}

export interface RemoveQueueRequest {
    /** The client forgets the torrent; only torrents the plugin added. */
    removeFromClient: boolean;
    /** Stores the infohash and indexer GUID so later searches reject the release. */
    blocklist: boolean;
    /**
     * With `removeFromClient`, the client also deletes what the torrent downloaded; the plugin refuses it (409
     * `delete_not_allowed`) once any of its files was imported (user, 2026-10-26). Absent or false keeps the files.
     */
    deleteFiles?: boolean;
}

export interface ImportOperation {
    id: string;
    grabId: string;
    entryId: string | null;
    episodeId: string | null;
    state: string;
    reason: string | null;
    message: string | null;
    releaseTitle: string;
    versionLabel: string | null;
    progress: number | null;
    nativeItemId: string | null;
    scanAttempts: number;
    createdAt: string;
    updatedAt: string;
    completedDownloadAt: string | null;
    linkedAt: string | null;
    scanRequestedAt: string | null;
    boundAt: string | null;
    completedAt: string | null;
    retryOfId: string | null;
    admin?: QueueAdminDetail;
}
