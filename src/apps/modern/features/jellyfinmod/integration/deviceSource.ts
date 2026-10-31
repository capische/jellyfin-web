/**
 * Every Play starts the device's copy (Phase 12 M35; user, 2026-10-28: TVs and computers the best copy, phones the copy at 1080p or
 * below). Upstream's playback manager picks a played item's media source in one step, `getOptimalMediaSource`, and prefers the
 * item's own source (its main, highest copy) even where a phone would have it converted. A title with several files starts here
 * the copy the detail page preselects for the device (`constants/versions.ts` `preferredVersion`), from every Play: a card's, the
 * hero's, Continue Watching and Next Up.
 *
 * Upstream decides as before when the viewer asked for a source (the detail page's Video choice), when playback resumes (a copy
 * part-way through always wins: the resumed item is that copy), when the item has one source, and outside the JellyfinMod
 * interface (the stock entry stays stock). Before upstream matches the remembered audio and subtitle tracks of the item played
 * before, `playbackmanager.js` asks here for the device's source of an item no source was asked or kept for, so the tracks are
 * matched to that file and the item's own id is never taken for the viewer's choice (Codex review of Phase 12, P2).
 */
import layoutManager from 'components/layoutManager';

import { linesOfSize, pickCopy } from '../constants/versions';

interface SourceStream {
    Type?: string | null;
    Width?: number | null;
    Height?: number | null;
    VideoRangeType?: string | null;
}

interface PlayableSource {
    Id?: string | null;
    Size?: number | null;
    MediaStreams?: SourceStream[] | null;
    enableDirectPlay?: boolean;
    SupportsDirectStream?: boolean;
    SupportsTranscoding?: boolean;
}

interface PlayOptions {
    startPosition?: number | null;
}

/** 2 for Dolby Vision, 1 for HDR10, HDR10+ or HLG, 0 for SDR or unknown. */
const range = (stream: SourceStream | undefined) => {
    const type = stream?.VideoRangeType ?? '';
    if (/^dovi(?!invalid)/i.test(type)) return 2;
    return /^(hdr10|hdr10plus|hlg)$/i.test(type) ? 1 : 0;
};

const video = (source: PlayableSource) => source.MediaStreams?.find(stream => stream.Type === 'Video');

const playable = (source: PlayableSource) => !!(source.enableDirectPlay || source.SupportsDirectStream || source.SupportsTranscoding);

/**
 * The media source this device should start, or null to let upstream choose: the detail page's rule (`pickCopy` in
 * `constants/versions.ts`), so a Play and the detail page always start the same file (Codex review of Phase 12, P2). TVs and
 * computers the best copy; phones the best at 1080p or below, SDR first, or the smallest when every copy is larger.
 */
export function deviceMediaSource<T extends PlayableSource>(sources: T[], requestedSourceId: string | null | undefined,
    options: PlayOptions | null | undefined): T | null {
    if (!window.__jfmodBundle || sources.length < 2 || requestedSourceId || (options?.startPosition ?? 0) > 0) return null;
    const candidates = sources.filter(playable);
    const best = pickCopy(candidates, source => {
        const stream = video(source);
        return { lines: linesOfSize(stream?.Width, stream?.Height), range: range(stream), size: source.Size ?? 0 };
    }, layoutManager.mobile ? 'mobile' : 'desktop');
    return best && linesOfSize(video(best)?.Width, video(best)?.Height) > 0 ? best : null;
}
