import type { MediaSourceInfo } from '@jellyfin/sdk/lib/generated-client/models/media-source-info';
import type { MediaStream } from '@jellyfin/sdk/lib/generated-client/models/media-stream';

import type { ParsedRelease } from '../types/acquisition';
import type { VersionDto } from '../types/versions';
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

/** Whether a Jellyfin item is this episode: its file's item, or the placeholder that stands for it while it has none (P1.FU24). */
export const isEpisodeItem = (episode: { jellyfinItemId: string | null; placeholderItemId?: string | null }, itemId: string | null | undefined) =>
    sameItemId(episode.jellyfinItemId, itemId) || sameItemId(episode.placeholderItemId, itemId);

/**
 * `2160p`, else a height the host reported, else the plugin's label. The plugin files every standard-definition size
 * under `480p`, so a standard-definition file shows its real height (a 576-line file reads `576p`, as the stock row says).
 */
export const versionResolution = (version: VersionDto): string => {
    if (version.resolution === '480p' && version.height) return version.height + 'p';
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

/** The codec names the release marks know (`h265` draws HEVC), and the audio words their Dolby and DTS chips match. */
const MARK_CODECS = new Map([['hevc', 'h265'], ['h265', 'h265'], ['h264', 'h264'], ['avc', 'h264'], ['av1', 'av1'], ['vc1', 'vc1'],
    ['mpeg2video', 'mpeg2']]);
const MARK_AUDIO = new Map([['eac3', 'DD+'], ['ac3', 'DD']]);

/**
 * A file's streams in the shape the release picker's media marks take (user, 2026-10-12: the Video dropdown shows the same
 * marks): codec; 10-bit, the range and Dolby Vision; the audio format and its channels.
 */
export const versionMarks = (version: VersionDto): MarkSource => {
    const video = version.videoCodec?.toLowerCase() ?? '';
    const audio = version.audioCodec?.toLowerCase() ?? '';
    const range = version.videoRange && !QUIET_RANGES.has(version.videoRange.toLowerCase()) ? version.videoRange : null;
    const hdr = [version.bitDepth && version.bitDepth >= 10 ? version.bitDepth + '-bit' : null,
        range && /dovi|dolby/i.test(range) ? 'DV' : range].filter(Boolean).join(' ');
    let channels: string | null = null;
    if (version.audioChannels) channels = CHANNELS.get(version.audioChannels) ?? version.audioChannels + ' ch';
    return {
        codec: video ? MARK_CODECS.get(video) ?? VIDEO_CODECS.get(video) ?? video.toUpperCase() : null,
        hdr: hdr || null,
        audio: audio ? MARK_AUDIO.get(audio) ?? AUDIO_CODECS.get(audio) ?? audio.toUpperCase() : null,
        audioChannels: channels
    };
};

type MarkSource = Pick<ParsedRelease, 'codec' | 'hdr' | 'audio' | 'audioChannels'>;

/** `5.1` from the channel count, else from the layout Jellyfin read (`5.1(side)`). */
const streamChannels = (stream: MediaStream): string | null => {
    if (stream.Channels) return CHANNELS.get(stream.Channels) ?? stream.Channels + ' ch';
    return /^\d\.\d/.exec(stream.ChannelLayout ?? '')?.[0] ?? null;
};

/**
 * The audio words the media marks match, from a stream's codec and profile: `TrueHD Atmos`, `DD+`, `DTS-HD MA`, `HE-AAC`; any
 * other format is its plain name (`AAC`, `FLAC`), drawn as a word chip.
 */
const streamAudio = (stream: MediaStream): string | null => {
    const codec = stream.Codec?.toLowerCase() ?? '';
    const profile = stream.Profile ?? '';
    const atmos = /atmos/i.test(profile) ? ' Atmos' : '';
    if (codec === 'truehd') return 'TrueHD' + atmos;
    if (codec === 'eac3') return 'DD+' + atmos;
    if (codec === 'ac3') return 'DD';
    if (codec === 'dts' || codec === 'dca') {
        if (/DTS:X/i.test(profile)) return 'DTS:X';
        return /\bMA\b/.test(profile) ? 'DTS-HD MA' : 'DTS';
    }
    if (codec === 'aac' && /^HE/i.test(profile)) return 'HE-AAC';
    return codec ? AUDIO_CODECS.get(codec) ?? codec.toUpperCase() : null;
};

/** 10-bit and the range a video stream reports: Dolby Vision draws its chip, HDR10, HDR10+ and HLG their words. */
const streamHdr = (stream: MediaStream): string | null => {
    const type = stream.VideoRangeType ?? '';
    let range: string | null = null;
    if (DOLBY_VISION.test(type)) range = 'DV';
    else if (/^hdr10plus$/i.test(type)) range = 'HDR10+';
    else if (/^(hdr10|hlg)$/i.test(type)) range = type.toUpperCase();
    else if (stream.VideoRange && !QUIET_RANGES.has(stream.VideoRange.toLowerCase())) range = stream.VideoRange;
    const depth = stream.BitDepth && stream.BitDepth >= 10 ? stream.BitDepth + '-bit' : null;
    return [depth, range].filter(Boolean).join(' ') || null;
};

/**
 * One media stream in the shape the release picker's media marks take (P7.FU6): a video stream's codec and range, an audio
 * stream's format and channels. Read from Jellyfin's own stream fields, never from a file name.
 */
export const streamMarks = (stream: MediaStream): MarkSource => {
    if (stream.Type === 'Video') {
        const video = stream.Codec?.toLowerCase() ?? '';
        return { codec: video ? MARK_CODECS.get(video) ?? VIDEO_CODECS.get(video) ?? video.toUpperCase() : null, hdr: streamHdr(stream),
            audio: null, audioChannels: null };
    }
    return { codec: null, hdr: null, audio: streamAudio(stream), audioChannels: streamChannels(stream) };
};

/**
 * A file's video marks and its default audio track's marks, apart (P7.FU6: the Video value shows no audio): from the file's
 * streams once the page has read them, else from the plugin's row.
 */
export const fileMarks = (version: VersionDto, source?: MediaSourceInfo | null): { video: MarkSource; audio: MarkSource } => {
    const row = versionMarks(version);
    const streams = source?.MediaStreams ?? [];
    const video = streams.find(stream => stream.Type === 'Video');
    const audio = streams.find(stream => stream.Type === 'Audio' && stream.Index === source?.DefaultAudioStreamIndex)
        ?? streams.find(stream => stream.Type === 'Audio');
    return {
        video: video ? streamMarks(video) : { codec: row.codec, hdr: row.hdr, audio: null, audioChannels: null },
        audio: audio ? streamMarks(audio) : { codec: null, hdr: null, audio: row.audio, audioChannels: row.audioChannels }
    };
};

const SUBTITLE_FORMATS = new Map([['subrip', 'SRT'], ['srt', 'SRT'], ['ass', 'ASS'], ['ssa', 'SSA'], ['pgssub', 'PGS'], ['pgs', 'PGS'],
    ['webvtt', 'VTT'], ['vtt', 'VTT'], ['dvdsub', 'VOBSUB'], ['dvd_subtitle', 'VOBSUB'], ['mov_text', 'TX3G'], ['dvbsub', 'DVB']]);

/** A subtitle stream's format mark: `SRT`, `PGS`, `ASS`. */
export const subtitleFormat = (stream: MediaStream): string | null => {
    const codec = stream.Codec?.toLowerCase() ?? '';
    return codec ? SUBTITLE_FORMATS.get(codec) ?? codec.toUpperCase() : null;
};

/** The media source a stock `.selectSource` value names. */
export const findSource = (sources: MediaSourceInfo[] | null | undefined, id: string | null | undefined) =>
    sources?.find(source => sameItemId(source.Id, id)) ?? null;

/** Jellyfin's `VideoRangeType` of each copy, from the item's media sources (V1 decision 4). */
export const videoRangeTypes = (sources: MediaSourceInfo[]): VideoRangeTypes => {
    const types: VideoRangeTypes = {};
    for (const source of sources) {
        const video = (source.MediaStreams ?? []).find(stream => stream.Type === 'Video');
        if (source.Id && video?.VideoRangeType) types[mediaSourceKey(source.Id)] = video.VideoRangeType;
    }
    return types;
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
        size: formatBytes(version.sizeBytes)
    };
};

/** Picker and More menu sentences for an `addVersion` refusal the server can send. */
export const ADD_VERSION_UNAVAILABLE = new Map([
    ['no_playable_version', 'This title has no playable version yet. Use Search releases instead.'],
    ['episode_versions_unsupported', 'Another version of an episode cannot be added while “Upgrade episodes and allow Replace” is off.'],
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

/**
 * Jellyfin's `VideoRangeType` for each copy, keyed by media source id in "N" form, as the native item's media sources
 * report it (`DOVIWithHDR10`, `HDR10`, `HLG`, `SDR`, ...). The plugin's rows carry only the broad range (`HDR` / `SDR`),
 * which cannot tell Dolby Vision from HDR10.
 */
export type VideoRangeTypes = Record<string, string>;

/** `VideoRangeType` keys compare in the "N" form. */
export const mediaSourceKey = (id: string) => id.replace(/-/g, '').toLowerCase();

const DOLBY_VISION = /^dovi(?!invalid)/i;
const HIGH_RANGE_TYPES = /^(hdr10|hdr10plus|hlg)$/i;

/**
 * 2 for Dolby Vision, 1 for another high dynamic range (HDR10, HDR10+, HLG, or a range the host only calls HDR), 0 for SDR
 * or unknown (V1 decision 4: Dolby Vision, then HDR, then SDR).
 */
export const dynamicRangeRank = (version: VersionDto, rangeTypes?: VideoRangeTypes | null): number => {
    const type = rangeTypes?.[mediaSourceKey(version.mediaSourceId)] ?? '';
    if (DOLBY_VISION.test(type) || /dovi|dolby\s*vision/i.test(version.videoRange ?? '')) return 2;
    if (HIGH_RANGE_TYPES.test(type)) return 1;
    return version.videoRange && !QUIET_RANGES.has(version.videoRange.toLowerCase()) ? 1 : 0;
};

/** Lines of picture per resolution the plugin reads, finer than `versionRank` (a 1440p is above a 1080p). */
const RESOLUTION_LINES = new Map([['2160p', 2160], ['1440p', 1440], ['1080p', 1080], ['720p', 720], ['576p', 576], ['480p', 480]]);

/**
 * Lines of picture for a picture's size, on the plugin's boxes (`VersionQuality.FineNativeResolution`, `OrderOf`): 4K above
 * 2560×1440, 1440p above 1920×1088, 1080p above 1280×962, 720p above 1024×576, then 576p from 540 lines, else 480p; 0 when
 * unknown. A scope-ratio 3840×1600 is 2160p, 1920×800 is 1080p.
 */
export const linesOfSize = (width?: number | null, height?: number | null): number => {
    const w = width ?? 0;
    const h = height ?? 0;
    if (w <= 0 && h <= 0) return 0;
    if (w > 2560 || h > 1440) return 2160;
    if (w > 1920 || h > 1088) return 1440;
    if (w > 1280 || h > 962) return 1080;
    if (w > 1024 || h > 576) return 720;
    return h >= 540 ? 576 : 480;
};

const linesOf = (version: VersionDto) => RESOLUTION_LINES.get(version.resolution ?? '') ?? linesOfSize(version.width, version.height);

/** What two copies of a title are compared on (D114): lines of picture, the range (2 Dolby Vision, 1 HDR, 0 SDR), the size. */
export interface CopyFacts {
    lines: number;
    range: number;
    size: number;
}

const bestOrder = (a: CopyFacts, b: CopyFacts) => b.lines - a.lines || b.range - a.range || b.size - a.size;
const phoneOrder = (a: CopyFacts, b: CopyFacts) => b.lines - a.lines || a.range - b.range || b.size - a.size;
const smallestOrder = (a: CopyFacts, b: CopyFacts) => a.lines - b.lines || a.range - b.range || a.size - b.size;

/**
 * The copy a device starts among a title's files, the one rule of the detail page and every Play (Codex review of Phase 12,
 * P2): TVs and computers the best (more lines, then Dolby Vision, HDR, SDR, then the larger file); phones the best at 1080p or
 * below (never 1440p), SDR first, then the larger file, or the smallest when every copy is larger. Ties keep the given order.
 */
export const pickCopy = <T>(items: T[], facts: (item: T) => CopyFacts, device: DevicePreference): T | null => {
    const ranked = items.map((item, index) => ({ item, index, facts: facts(item) }));
    const first = (list: typeof ranked, order: (a: CopyFacts, b: CopyFacts) => number) =>
        [...list].sort((a, b) => order(a.facts, b.facts) || a.index - b.index)[0]?.item ?? null;
    if (device !== 'mobile') return first(ranked, bestOrder);
    const fitting = ranked.filter(item => item.facts.lines > 0 && item.facts.lines <= 1080);
    return fitting.length > 0 ? first(fitting, phoneOrder) : first(ranked, smallestOrder);
};

const versionFacts = (rangeTypes?: VideoRangeTypes | null) => (version: VersionDto): CopyFacts => ({
    lines: linesOf(version), range: dynamicRangeRank(version, rangeTypes), size: version.sizeBytes ?? 0
});

/**
 * A title's files best first (user, 2026-10-29, D114: a title can hold many files): the higher resolution, then Dolby Vision,
 * HDR, SDR, then the larger file; files that tie keep the plugin's order. The Video list shows them in this order, and its top
 * file is the one TVs and computers start.
 */
export const bestFirst = (versions: VersionDto[], rangeTypes?: VideoRangeTypes | null): VersionDto[] => {
    const facts = versionFacts(rangeTypes);
    return versions.map((version, index) => ({ version, index, facts: facts(version) }))
        .sort((a, b) => bestOrder(a.facts, b.facts) || a.index - b.index)
        .map(item => item.version);
};

/**
 * The copy this device should start with, or null to leave Jellyfin's own default (V1 decision 4; Phase 12, user 2026-10-28:
 * TVs and computers the best copy, phones the phone copy). A TV and a computer take the highest resolution and, at equal
 * resolution, Dolby Vision, then HDR, then SDR. A phone takes the file the plugin marks as the phone copy, else the best copy at
 * or below 1080p, standard dynamic range first, or the smallest when every copy is larger. A version the viewer is part-way
 * through always wins, so resuming never switches copies.
 */
export const preferredVersion = (versions: VersionDto[], device: DevicePreference,
    rangeTypes?: VideoRangeTypes | null): VersionDto | null => {
    if (versions.length < 2) return null;
    const resuming = versions.find(version => version.inProgress);
    if (resuming) return resuming;
    // The plugin's mark follows the same rule (PhoneCopies.Mark), so it is the phone's file when there is one.
    const marked = device === 'mobile' ? versions.find(version => version.phoneCopy) : undefined;
    return marked ?? pickCopy(versions, versionFacts(rangeTypes), device);
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
