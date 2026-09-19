/**
 * Phase 4 acquisition contract, mirroring the plugin's release and grab DTOs (PHASE4.md A1).
 * The server never sends a download link, passkey or credential; nothing here can hold one.
 */

export interface ParsedRelease {
    title: string | null;
    year: number | null;
    seasonNumber: number | null;
    episodeNumbers: number[];
    seasonPack: boolean;
    absoluteNumbering: boolean;
    dailyNumbering: boolean;
    resolution: string | null;
    source: string | null;
    codec: string | null;
    audio: string | null;
    hdr: string | null;
    group: string | null;
    proper: boolean;
    repack: boolean;
    quality: string | null;
}

export interface ReleaseRejection {
    code: string;
    message: string;
}

export interface ScoreContribution {
    code: string;
    points: number;
}

export interface ReleaseCandidate {
    releaseId: string;
    indexerId: string;
    indexerName: string;
    rawTitle: string;
    parsed: ParsedRelease;
    match: { identity: string; method: string };
    size: number | null;
    seeders: number | null;
    peers: number | null;
    publishedAt: string | null;
    freeleech: boolean | null;
    proper: boolean;
    repack: boolean;
    infoHash: string | null;
    sameHashReleaseIds: string[];
    score: number;
    contributions: ScoreContribution[];
    eligible: boolean;
    rejections: ReleaseRejection[];
    seedRatio: number | null;
    seedMinutes: number | null;
}

export interface IndexerOutcome {
    indexerId: string;
    name: string;
    /** `ok` and `no_results` are complete; anything else is a failure worth showing. */
    status: string;
    message: string | null;
    resultCount: number;
    truncated: boolean;
    retryAfterSeconds: number | null;
}

export interface ReleaseSearch {
    searchId: string;
    createdAt: string;
    expiresAt: string;
    target: {
        entryId: string;
        episodeId: string | null;
        mediaType: 'movie' | 'series';
        title: string;
        year: number | null;
        seasonNumber: number | null;
        episodeNumber: number | null;
    };
    profile: { id: string; name: string; revision: number; inherited: boolean };
    grab: { available: boolean; reason: string | null; holdSeconds: number; activeOperationId: string | null };
    candidates: ReleaseCandidate[];
    eligibleCount: number;
    rejectedCount: number;
    indexers: IndexerOutcome[];
    partial: boolean;
    truncated: boolean;
}

/** `pending` is the cancellable server-side hold (user decision 2). */
export type GrabState = 'pending' | 'submitting' | 'accepted' | 'failed' | 'unknown' | 'cancelled';

export interface GrabOperation {
    id: string;
    state: GrabState;
    active: boolean;
    cancellable: boolean;
    entryId: string | null;
    episodeId: string | null;
    releaseTitle: string;
    indexerName: string;
    quality: string | null;
    size: number | null;
    infoHash: string | null;
    score: number;
    seedRatio: number | null;
    seedMinutes: number | null;
    holdUntil: string;
    createdAt: string;
    updatedAt: string;
    submittedAt: string | null;
    acceptedAt: string | null;
    cancelledAt: string | null;
    failureCode: string | null;
    message: string;
    /** Credential-free client link, only after verified acceptance. */
    openUrl: string | null;
}

export interface QualityProfile {
    id: string;
    name: string;
    qualities: string[];
    minimumBytesPerHour: number | null;
    maximumBytesPerHour: number | null;
    revision: number;
    isDefault: boolean;
}

/** Newest grab for an entry or episode on detail reads (P4.A6). Ordinary users see only state and time. */
export interface AcquisitionSummary {
    state: GrabState;
    updatedAt: string;
    operationId: string | null;
    releaseTitle: string | null;
    quality: string | null;
    failureCode: string | null;
}
