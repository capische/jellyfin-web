/**
 * Phase 6 version contract, mirroring the plugin's VersionDto and UpgradeStateDto (PHASE6.md, M8). Every field
 * comes from what the pinned host's `MediaSources` expose (M1); a field the host did not report is null.
 */

/** Per-version retention. Ordinary users get `reason` null or the public word `seeding`. */
export interface VersionRetention {
    state: 'scheduled' | 'waiting' | 'blocked' | 'disabled' | string;
    reason: string | null;
}

export interface VersionDto {
    jellyfinItemId: string;
    /** The version's item id in "N" form: the stock `.selectSource` option value. */
    mediaSourceId: string;
    bindingId: string;
    /** For example `1080p WEB-DL`. */
    label: string | null;
    /** For example `webdl-1080p`. */
    quality: string | null;
    resolution: '2160p' | '1080p' | '720p' | '480p' | string | null;
    width: number | null;
    height: number | null;
    videoCodec: string | null;
    /** `SDR`, `HDR`, … or `Unknown`. */
    videoRange: string | null;
    bitDepth: number | null;
    audioCodec: string | null;
    audioChannels: number | null;
    sizeBytes: number | null;
    isDefault: boolean;
    retention: VersionRetention | null;
    /** An administrator kept this file while the title's other versions may go; absent before PHASE10 Q3. */
    kept?: boolean;
    /** False for a file Jellyfin plays that the plugin has not bound yet (empty `bindingId`); absent before V1. */
    tracked?: boolean;
    /** An administrator may remove exactly this file (V1 decision 3). */
    removable?: boolean;
    /** Removing this file removes the title's last copy and stops monitoring it. */
    isLast?: boolean;
    /** The viewer is part-way through this version; no device default replaces it (V1 decision 4). */
    inProgress?: boolean;
    /** `S01E01-E02` for a file holding several episodes. */
    episodeRange?: string | null;
}

/** What Remove this version did (V1). */
export interface VersionRemoveResult {
    bindingId: string;
    logicalBytesUnlinked: number;
    physicalBytesReleased: number | null;
    state: string;
    monitored: boolean;
}

export type UpgradeBlockedReason = 'upgrade_not_allowed' | 'already_held_at_cutoff' | 'held_quality_unknown'
    | 'episode_versions_unsupported' | 'no_file';

/** Administrators only. */
export interface UpgradeStateDto {
    eligible: boolean;
    cutoff: string | null;
    heldBest: string | null;
    mode: 'replace' | 'add';
    blockedReason: UpgradeBlockedReason | string | null;
    openUpgradeState: string | null;
}

/** Why automation is not grabbing right now; `disabled` is the master switch. */
export type AutomationPausedReason = 'disabled' | 'budget_grabs' | 'too_many_open_imports' | 'free_space_floor'
    | 'client_unreachable' | 'acquisition_not_ready' | 'breaker_open';

export interface AutomationSummary {
    enabled: boolean;
    pausedReasons: (AutomationPausedReason | string)[];
}
