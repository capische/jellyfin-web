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
    | 'client_unreachable' | 'acquisition_not_ready';

export interface AutomationSummary {
    enabled: boolean;
    pausedReasons: (AutomationPausedReason | string)[];
}
