/**
 * Every Play starts the device's copy (Phase 12 M35; user, 2026-10-28: TVs and computers the best copy, phones the copy at 1080p or
 * below). Upstream's playback manager picks a played item's media source in one step, `getOptimalMediaSource`, and prefers the
 * item's own source (its main, highest copy) even where a phone would have it converted. A title with several files starts here
 * the copy the detail page preselects for the device (`constants/versions.ts` `preferredVersion`), from every Play: a card's, the
 * hero's, Continue Watching and Next Up.
 *
 * Upstream decides as before when the viewer asked for a source (the detail page's Video choice), when playback resumes (a copy
 * part-way through always wins: the resumed item is that copy), when the item has one source, and outside the JellyfinMod
 * interface (the stock entry stays stock).
 */
import layoutManager from 'components/layoutManager';

interface SourceStream {
    Type?: string | null;
    Width?: number | null;
    Height?: number | null;
    VideoRangeType?: string | null;
}

interface PlayableSource {
    Id?: string | null;
    MediaStreams?: SourceStream[] | null;
    enableDirectPlay?: boolean;
    SupportsDirectStream?: boolean;
    SupportsTranscoding?: boolean;
}

interface PlayOptions {
    startPosition?: number | null;
}

/** 4 for 2160p down to 1 for SD, 0 when unknown, by the larger of the width and height tiers (the plugin's `NativeResolution`). */
const rank = (stream: SourceStream | undefined) => {
    const width = stream?.Width ?? 0;
    const height = stream?.Height ?? 0;
    if (width <= 0 && height <= 0) return 0;
    if (width > 2560 || height > 1440) return 4;
    if (width > 1280 || height > 962) return 3;
    if (width > 1024 || height > 576) return 2;
    return 1;
};

/** 2 for Dolby Vision, 1 for HDR10, HDR10+ or HLG, 0 for SDR or unknown. */
const range = (stream: SourceStream | undefined) => {
    const type = stream?.VideoRangeType ?? '';
    if (/^dovi(?!invalid)/i.test(type)) return 2;
    return /^(hdr10|hdr10plus|hlg)$/i.test(type) ? 1 : 0;
};

const video = (source: PlayableSource) => source.MediaStreams?.find(stream => stream.Type === 'Video');

/** Whether phones may play a source: 1080p or below (a 1920×1080 box), never a 1440p (D114). */
const fitsPhone = (stream: SourceStream | undefined) => {
    const width = stream?.Width ?? 0;
    const height = stream?.Height ?? 0;
    return (width > 0 || height > 0) && width <= 1920 && height <= 1080;
};

const playable = (source: PlayableSource) => !!(source.enableDirectPlay || source.SupportsDirectStream || source.SupportsTranscoding);

/**
 * The media source this device should start, or null to let upstream choose. TVs and computers: the highest resolution, then Dolby
 * Vision, HDR, SDR. Phones: the best source at 1080p or below (never a 1440p), SDR first; none when every source is larger.
 */
export function deviceMediaSource<T extends PlayableSource>(sources: T[], requestedSourceId: string | null | undefined,
    options: PlayOptions | null | undefined): T | null {
    if (!window.__jfmodBundle || sources.length < 2 || requestedSourceId || (options?.startPosition ?? 0) > 0) return null;
    const candidates = sources.filter(playable);
    const score = layoutManager.mobile ?
        (source: T) => {
            const stream = video(source);
            return fitsPhone(stream) ? rank(stream) * 10 - range(stream) : Number.NEGATIVE_INFINITY;
        } :
        (source: T) => rank(video(source)) * 10 + range(video(source));
    const best = [...candidates].sort((a, b) => score(b) - score(a))[0];
    return best && score(best) > Number.NEGATIVE_INFINITY && rank(video(best)) > 0 ? best : null;
}
