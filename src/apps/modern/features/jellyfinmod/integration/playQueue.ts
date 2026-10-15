/**
 * Play queues skip placeholders (P1.FU28; plan docs/jellyfinmod/design/missing-media-user-actions.md §11).
 *
 * Upstream's playback manager builds every local queue (Play, Play All, Shuffle, Play from here, Instant Mix, a season's or a
 * series' Play, Add to queue and Play next) through one step, `translateItemsForPlayback`, which also sets the queue's start
 * index. A placeholder (`IsPlaceHolder`: a missing episode or movie the plugin holds as a Jellyfin media stub) is a real item
 * that is never playable, so it is left out of the queue there: playback, and the next episode after the one that ends, jump
 * the gap. The start moves to the first playable item at or after the one asked for.
 *
 * When nothing playable is left, or nothing playable follows the start, the queue is handed back unchanged: upstream then
 * refuses the placeholder with its own message (`PlaybackErrorPlaceHolder`) instead of the button doing nothing.
 */
interface QueueItem {
    IsPlaceHolder?: boolean | null
}

interface QueueOptions {
    startIndex?: number
}

export function skipPlaceholders<T extends QueueItem>(items: T[], options: QueueOptions): T[] {
    if (!items.some(item => item?.IsPlaceHolder)) return items;

    const start = options.startIndex || 0;
    const kept: T[] = [];
    let keptStart: number | undefined;
    items.forEach((item, index) => {
        if (item?.IsPlaceHolder) return;
        if (keptStart === undefined && index >= start) keptStart = kept.length;
        kept.push(item);
    });

    if (keptStart === undefined) return items;
    options.startIndex = keptStart;
    return kept;
}
