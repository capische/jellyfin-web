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
}

export interface QueueQuery {
    state?: QueueState[];
    entryId?: string;
}

export interface RemoveQueueRequest {
    /** Removes the torrent and its data from the client; only torrents the plugin added. */
    removeFromClient: boolean;
    /** Stores the infohash and indexer GUID so later searches reject the release. */
    blocklist: boolean;
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
