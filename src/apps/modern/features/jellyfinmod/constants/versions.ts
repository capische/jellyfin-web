import type { VersionDto, VersionRetention } from '../types/versions';
import { formatBytes } from './queue';

/**
 * The one place a version row is worded (UX §11, P6.M8): resolution, video codec with 10-bit/HDR, audio codec and
 * channels, size, and a retention suffix only when it tells the viewer something.
 */

/** The Health capability a plugin build advertises when entry details carry `versions` (P6.M8). */
export const VERSIONS_CAPABILITY = 'versions';

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
