import type { VersionDto, VersionRetention } from '../types/versions';
import { formatBytes } from './queue';

/**
 * The one place a version row is worded (UX §11, P6.M8): resolution, video codec with 10-bit/HDR, audio codec and
 * channels, size, and a retention suffix only when it tells the viewer something.
 */

/** The Health capability a plugin build advertises when entry details carry `versions` (P6.M8). */
export const VERSIONS_CAPABILITY = 'versions';

/** Versions read from Jellyfin 12's media sources, with untracked rows, progress and episode ranges (V1). */
export const VERSIONS_V1_CAPABILITY = 'versions.v1';

/** Remove this version (V1 decision 3). */
export const VERSIONS_REMOVE_CAPABILITY = 'versions.remove';

const VIDEO_CODECS = new Map([
    ['hevc', 'HEVC'], ['h265', 'HEVC'], ['h264', 'H.264'], ['avc', 'H.264'], ['av1', 'AV1'], ['vp9', 'VP9'], ['vp8', 'VP8'],
    ['mpeg2video', 'MPEG-2'], ['mpeg4', 'MPEG-4'], ['vc1', 'VC-1'], ['msmpeg4v3', 'DivX']
]);

const AUDIO_CODECS = new Map([
    ['truehd', 'TrueHD'], ['dts', 'DTS'], ['dca', 'DTS'], ['eac3', 'E-AC3'], ['ac3', 'AC3'], ['aac', 'AAC'], ['flac', 'FLAC'],
    ['opus', 'Opus'], ['mp3', 'MP3'], ['vorbis', 'Vorbis'], ['pcm_s16le', 'PCM'], ['pcm_s24le', 'PCM']
]);

const CHANNELS = new Map([[1, 'mono'], [2, '2.0'], [3, '2.1'], [6, '5.1'], [7, '6.1'], [8, '7.1']]);

/** SDR and an unreported range say nothing worth a word on the row. */
const QUIET_RANGES = new Set(['sdr', 'unknown', '']);

/** Item and media source ids compare in either the dashed or the "N" form. */
export const sameItemId = (a: string | null | undefined, b: string | null | undefined) =>
    !!a && !!b && a.replace(/-/g, '').toLowerCase() === b.replace(/-/g, '').toLowerCase();

/** `2160p`, else a height the host reported, else the plugin's label. */
export const versionResolution = (version: VersionDto): string => {
    if (version.resolution) return version.resolution;
    if (version.height) return version.height + 'p';
    return version.label ?? 'Unknown quality';
};

/** `HEVC 10-bit HDR10`: codec first, then depth and range only when the host exposed them. */
export const versionVideo = (version: VersionDto): string | null => {
    const codec = version.videoCodec ? VIDEO_CODECS.get(version.videoCodec.toLowerCase()) ?? version.videoCodec.toUpperCase() : null;
    const depth = version.bitDepth && version.bitDepth >= 10 ? version.bitDepth + '-bit' : null;
    const range = version.videoRange && !QUIET_RANGES.has(version.videoRange.toLowerCase()) ? version.videoRange : null;
    return [codec, depth, range].filter(Boolean).join(' ') || null;
};

/** `AC3 5.1`. */
export const versionAudio = (version: VersionDto): string | null => {
    const codec = version.audioCodec ? AUDIO_CODECS.get(version.audioCodec.toLowerCase()) ?? version.audioCodec.toUpperCase() : null;
    let channels: string | null = null;
    if (version.audioChannels) channels = CHANNELS.get(version.audioChannels) ?? version.audioChannels + ' ch';
    return [codec, channels].filter(Boolean).join(' ') || null;
};

/**
 * A short suffix for the few retention states worth reading on a row: a copy that is still seeding, or one the
 * next retention run may remove. Anything else says nothing, so ordinary rows stay short.
 */
export const versionRetentionSuffix = (retention: VersionRetention | null | undefined): string | null => {
    if (!retention) return null;
    const reason = retention.reason ?? '';
    if (reason === 'seeding' || reason.startsWith('seed_') || reason.startsWith('seeding_')) return 'waiting for seeding';
    if (retention.state === 'scheduled') return 'scheduled for removal';
    return null;
};

/** Everything a row shows, worded once for all layouts. */
export const describeVersion = (version: VersionDto) => {
    const resolution = versionResolution(version);
    // The label adds the source (`WEB-DL`, `Remux`) when it says more than the resolution alone.
    const label = version.label && version.label !== resolution ? version.label : null;
    return {
        resolution,
        label,
        video: versionVideo(version),
        audio: versionAudio(version),
        size: formatBytes(version.sizeBytes),
        retention: versionRetentionSuffix(version.retention)
    };
};

/** Picker and More menu sentences for an `addVersion` refusal the server can send. */
export const ADD_VERSION_UNAVAILABLE = new Map([
    ['no_playable_version', 'This title has no playable version yet. Use Search releases instead.'],
    ['episode_versions_unsupported', 'Another version of an episode cannot be added while episode upgrades are off.'],
    ['held_quality', 'This quality is already in the library.']
]);

/** Which copy a device starts with (V1 decision 4, answered 2026-09-28): the TV the best, a phone at most 1080p. */
export type DevicePreference = 'tv' | 'mobile' | 'desktop';

const RESOLUTION_RANK = new Map([['2160p', 4], ['1080p', 3], ['720p', 2], ['576p', 1], ['480p', 1]]);

/** 4 for 2160p down to 1 for SD, 0 when unknown: the resolution the plugin read, else the height the host reported. */
export const versionRank = (version: VersionDto): number => {
    const named = version.resolution ? RESOLUTION_RANK.get(version.resolution) : undefined;
    if (named) return named;
    const height = version.height ?? 0;
    if (height >= 2000) return 4;
    if (height >= 1000) return 3;
    if (height >= 700) return 2;
    return height > 0 ? 1 : 0;
};

/** 1 for a high dynamic range copy (HDR10, HLG, Dolby Vision as the host reports it), else 0. */
const hdrRank = (version: VersionDto) => (version.videoRange && !QUIET_RANGES.has(version.videoRange.toLowerCase()) ? 1 : 0);

/**
 * The copy this device should start with, or null to leave Jellyfin's own default (V1 decision 4). The TV takes the highest
 * resolution, high dynamic range first at equal resolution. A phone takes the best copy at or below 1080p, standard dynamic
 * range first, or the smallest when every copy is larger. A desktop keeps Jellyfin's default. A version the viewer is
 * part-way through always wins, so resuming never switches copies. The full device presets are Phase 12 (M10–M21).
 */
export const preferredVersion = (versions: VersionDto[], device: DevicePreference): VersionDto | null => {
    if (versions.length < 2 || device === 'desktop') return null;
    const resuming = versions.find(version => version.inProgress);
    if (resuming) return resuming;
    const byScore = (score: (version: VersionDto) => number) =>
        [...versions].sort((a, b) => score(b) - score(a))[0] ?? null;
    if (device === 'tv') return byScore(version => versionRank(version) * 10 + hdrRank(version));
    const fitting = versions.filter(version => versionRank(version) > 0 && versionRank(version) <= 3);
    if (fitting.length === 0) return byScore(version => -versionRank(version));
    return [...fitting].sort((a, b) => (versionRank(b) * 10 - hdrRank(b)) - (versionRank(a) * 10 - hdrRank(a)))[0] ?? null;
};

/** How a version is named in a sentence: its label, else its resolution. */
export const versionName = (version: VersionDto): string => {
    const text = describeVersion(version);
    return text.label ? `${text.resolution} ${text.label}` : text.resolution;
};

/** The confirmation for Remove this version: what goes, what stays, and that the last copy stops monitoring (V1). */
export const removeVersionText = (version: VersionDto, mediaType: 'movie' | 'series'): string => {
    const subject = mediaType === 'series' ? 'episode' : 'title';
    const range = version.episodeRange ? ` This file holds ${version.episodeRange}; those episodes lose this copy.` : '';
    if (version.isLast) {
        return `This removes the last copy and stops monitoring. Only the ${versionName(version)} file is deleted: its folder, `
            + `subtitles and artwork stay, and the ${subject} stays in the library as not downloaded.${range}`;
    }
    return `Only the ${versionName(version)} file is deleted. Its folder, subtitles, artwork and the other versions stay, `
        + `and the ${subject} stays in the library.${range}`;
};

/** Why Remove this version refused, in words. */
export const REMOVE_VERSION_REFUSED = new Map([
    ['version_kept', 'This file is kept. Stop keeping it first.'],
    ['active_session', 'This file is playing. Try again when playback stops.'],
    ['active_session_unknown', 'Playback state could not be read. Try again.'],
    ['multi_part_unsupported', 'This version is split into several parts and cannot be removed here.'],
    ['media_not_writable', 'The library folder cannot be written.'],
    ['shared_path_not_all_eligible', 'Another title uses this same file.'],
    ['operation_open', 'A removal of this file is still in progress.']
]);

/**
 * The line added to stock Delete media's confirmation when a title has more than one file (V1 decision 3, analysis C8).
 * Upstream deletes a movie's whole folder when the movie has one of its own, and for an episode the file with every file
 * whose name starts with it.
 */
export const deleteWarningText = (fileCount: number, mediaType: 'movie' | 'series'): string => {
    if (mediaType === 'movie') {
        return `This movie has ${fileCount} files. Delete removes its whole folder when it has one of its own: every version, `
            + 'subtitles, artwork and extras. To delete one file, use Remove this version instead.';
    }
    return `This episode has ${fileCount} files. Delete removes the selected file and every file whose name starts with it, `
        + 'which can include another version\'s subtitles. To delete exactly one file, use Remove this version instead.';
};
