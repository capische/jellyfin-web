import type { Api } from '@jellyfin/sdk/lib/api';
import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind';
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api';
import { type FC, useCallback, useEffect, useRef, useState } from 'react';

import layoutManager from 'components/layoutManager';
import { useApi } from 'hooks/useApi';

import { getEntries } from '../api/modApi';
import { aggregateProgress, downloadProgress, type DownloadProgress, isUnderWay } from '../constants/queue';
import { currentRowFor, packHolds, useQueue, useQueueCapability } from '../hooks/useQueue';
import type { QueueRow } from '../types/queue';

import '../components/fileStateMark.scss';
import '../components/downloadProgress.scss';

/**
 * Downloads on every card and row of the page (P4.FU1, user-approved design 2026-10-12; UX §3.3).
 *
 * Wherever a title, season or episode is on its way, its card gets a thin amber bar along the poster's bottom edge (the watched
 * part in the primary on top) and an arrow: a white one inside upstream's count pill, or an amber one in a dark disc on a card
 * with no count; a season page's or list view's row gets the bar along its bottom edge and its figure (`42% · 12 min left`,
 * Queued, stalled, Importing…, Failed) at its end. A series or season shows the mean of its episodes on their way.
 *
 * One component for the whole app, so every card and row of a page costs one `GET /JellyfinMod/Queue` (the shared queue query):
 * read when a page opens, then every 5 s only while something on the page is on its way. Upstream's cards and rows are not
 * edited: the mod adds its elements beside upstream's, a class on the card's frame and one on the count pill, and takes them
 * away again when the download is over. Upstream cards are found by `data-id` and `data-type`; the mod's own (a file-less
 * title, a missing season or episode) carry `data-jfmod-entry-id`, with `data-jfmod-season` or `data-jfmod-episode-id`.
 * A user who may not read the queue (403) sees none of it.
 */

const TARGETS = '.card[data-id], .card[data-jfmod-entry-id], .listItem[data-id], .listItem[data-jfmod-entry-id]';
const MEDIA_TYPES = new Set(['Movie', 'Series', 'Season', 'Episode']);
const ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" '
    + 'stroke-linejoin="round" aria-hidden="true"><path d="M12 4V17"/><path d="M6.5 11.5L12 17L17.5 11.5"/></svg>';

const normalId = (id: string | null | undefined) => (id ?? '').replace(/-/g, '').toLowerCase();

/** Where a native season or episode sits, read from Jellyfin once per item: its series and its numbers. */
interface Placement {
    seriesId: string;
    season: number | null;
    episode: number | null;
}

/** What a card or row stands for, read from its attributes. */
type Target =
    | { entryId: string; season: number | null; episodeId: string | null }
    | { itemId: string; type: string };

const targetOf = (element: HTMLElement): Target | null => {
    const entryId = element.getAttribute('data-jfmod-entry-id');
    if (entryId) {
        const season = element.getAttribute('data-jfmod-season');
        return { entryId, season: season ? Number(season) : null, episodeId: element.getAttribute('data-jfmod-episode-id') };
    }
    const type = element.getAttribute('data-type') ?? '';
    const itemId = element.getAttribute('data-id');
    return itemId && MEDIA_TYPES.has(type) ? { itemId: normalId(itemId), type } : null;
};

/** The queue's rows, read for the lookups every card and row of one pass needs. */
interface QueueIndex {
    items: QueueRow[];
    /** An entry's Jellyfin item (a movie or a series) to the entry. */
    entryByItem: Map<string, string>;
    /** Whether any row is about an episode, so native seasons and episodes are worth placing. */
    episodic: boolean;
}

const indexQueue = (items: QueueRow[], bound: Map<string, string[]>): QueueIndex => {
    const entryByItem = new Map<string, string>();
    for (const row of items) {
        if (row.entry?.jellyfinItemId) entryByItem.set(normalId(row.entry.jellyfinItemId), row.entry.id);
    }
    for (const [entryId, itemIds] of bound) {
        for (const itemId of itemIds) entryByItem.set(itemId, entryId);
    }
    return { items, entryByItem, episodic: items.some(row => !!row.episode || !!row.pack) };
};

/**
 * The current row of each episode of an entry (of one season, or one episode number, when given) that a row names, a pack's
 * once for every episode it still holds, so a series' or season's mean weighs a pack by its episodes.
 */
const episodeRows = (queue: QueueIndex, entryId: string, season: number | null, number: number | null = null) => {
    const ids = new Set<string>();
    const wanted = (seasonNumber: number, episodeNumber: number) =>
        (season === null || seasonNumber === season) && (number === null || episodeNumber === number);
    for (const row of queue.items) {
        if (row.entry?.id !== entryId) continue;
        if (row.episode && wanted(row.episode.seasonNumber, row.episode.episodeNumber)) ids.add(row.episode.id);
        for (const episode of row.pack?.episodes ?? []) {
            if (wanted(episode.seasonNumber, episode.episodeNumber)) ids.add(episode.episodeId);
        }
    }
    const rows: QueueRow[] = [];
    for (const id of ids) {
        const row = currentRowFor(queue.items, entryId, id);
        if (row && (!row.pack || packHolds(row, id))) rows.push(row);
    }
    return rows;
};

/** A file-less title: its own row (a movie) or its episodes' (a series). */
const entryRows = (queue: QueueIndex, entryId: string) => {
    const own = currentRowFor(queue.items, entryId, null);
    return own ? [own] : episodeRows(queue, entryId, null);
};

/** A native season's or episode's rows, by its series and numbers; undefined while it is not placed yet. */
const placedRows = (queue: QueueIndex, type: string, placement: Placement | null | undefined): QueueRow[] | undefined => {
    if (placement === undefined) return undefined;
    const entryId = placement ? queue.entryByItem.get(normalId(placement.seriesId)) : undefined;
    if (!placement || !entryId || placement.season === null) return [];
    return episodeRows(queue, entryId, placement.season, type === 'Episode' ? placement.episode : null);
};

/** The rows one card or row stands for; undefined while a native season or episode is not placed yet. */
const rowsOf = (queue: QueueIndex, target: Target, placements: Map<string, Placement | null>): QueueRow[] | undefined => {
    if ('entryId' in target) {
        if (target.episodeId) {
            const row = currentRowFor(queue.items, target.entryId, target.episodeId);
            return row ? [row] : [];
        }
        return target.season === null ? entryRows(queue, target.entryId) : episodeRows(queue, target.entryId, target.season);
    }
    if (target.type === 'Movie' || target.type === 'Series') {
        const entryId = queue.entryByItem.get(target.itemId);
        return entryId ? entryRows(queue, entryId) : [];
    }
    return queue.episodic ? placedRows(queue, target.type, placements.get(target.itemId)) : [];
};

/**
 * A card's download: the mean of what is on its way (a failed, blocked or finished download is not). A row's: one episode's or
 * movie's own, a failure included, or the mean of a series' or season's episodes on their way.
 */
const progressOf = (rows: QueueRow[], row: boolean): DownloadProgress | null => {
    if (row && rows.length === 1 && rows[0].state !== 'seeding') return downloadProgress(rows[0]);
    return aggregateProgress(rows.filter(isUnderWay));
};

const ownChild = (parent: Element, className: string) =>
    Array.from(parent.children).find(child => child.classList.contains(className)) as HTMLElement | undefined;

const setClass = (element: Element, value: string) => {
    if (element.className !== value) element.className = value;
};

const setWidth = (element: HTMLElement, percent: number | null) => {
    const width = (percent ?? 0) + '%';
    if (element.style.width !== width) element.style.width = width;
};

/** The watched part upstream's own bar shows: the legacy card's foreground width, or the React card's value. */
const watchedPercent = (frame: Element): number | null => {
    const legacy = frame.querySelector<HTMLElement>('.itemProgressBarForeground');
    const modern = frame.querySelector('.itemLinearProgress');
    const value = legacy ? parseFloat(legacy.style.width) : parseFloat(modern?.getAttribute('aria-valuenow') ?? '');
    return Number.isFinite(value) && value > 0 && value < 100 ? value : null;
};

const clearCard = (frame: Element) => {
    if (!frame.classList.contains('jfmod-dlCard')) return;
    frame.classList.remove('jfmod-dlCard');
    ownChild(frame, 'jfmod-dlCardBar')?.remove();
    frame.querySelector('.jfmod-dlDisc')?.remove();
    frame.querySelector('.jfmod-countArrow')?.classList.remove('jfmod-countArrow');
};

/** The bar at the poster's bottom (download beneath, watched on top) and the arrow in the count pill or the corner. */
const drawCard = (card: HTMLElement, progress: DownloadProgress | null) => {
    const frame = card.querySelector('.cardScalable') ?? card;
    if (!progress) {
        clearCard(frame);
        return;
    }
    frame.classList.add('jfmod-dlCard');
    let bar = ownChild(frame, 'jfmod-dlCardBar');
    if (!bar) {
        bar = document.createElement('div');
        bar.setAttribute('aria-hidden', 'true');
        bar.innerHTML = '<span class="jfmod-dlBar-fill"></span><span class="jfmod-dlBar-fill jfmod-dlBar-watched"></span>';
        frame.appendChild(bar);
    }
    setClass(bar, 'jfmod-dlBar jfmod-dlCardBar jfmod-dlBar--' + progress.kind);
    const [fill, watched] = Array.from(bar.children) as HTMLElement[];
    setWidth(fill, progress.percent);
    setWidth(watched, watchedPercent(frame));

    const count = frame.querySelector('.countIndicator');
    let disc = frame.querySelector<HTMLElement>('.jfmod-dlDisc');
    if (count) {
        count.classList.add('jfmod-countArrow');
        disc?.remove();
        return;
    }
    if (!disc) {
        disc = document.createElement('div');
        disc.className = 'jfmod-mark jfmod-mark--downloading jfmod-dlDisc';
        disc.title = 'Downloading';
        disc.innerHTML = ARROW;
    }
    // Before upstream's indicators (the played tick), or alone in the corner on a card without them.
    const indicators = frame.querySelector('.cardIndicators');
    if (indicators) {
        if (indicators.firstElementChild !== disc) indicators.insertBefore(disc, indicators.firstChild);
    } else if (disc.parentNode !== frame) {
        frame.appendChild(disc);
    }
};

const clearRow = (row: HTMLElement) => {
    if (!row.classList.contains('jfmod-dlRow')) return;
    row.classList.remove('jfmod-dlRow', 'jfmod-dlRow--failed');
    ownChild(row, 'jfmod-dlRowBar')?.remove();
    row.querySelector('.jfmod-dlRowFigure')?.remove();
};

/** The bar along the row's bottom edge and the figure at its end, after the row's text. */
const drawRow = (row: HTMLElement, progress: DownloadProgress | null) => {
    if (!progress) {
        clearRow(row);
        return;
    }
    row.classList.add('jfmod-dlRow');
    // A failure keeps the Not Downloaded button beside its figure, so it can be searched again.
    row.classList.toggle('jfmod-dlRow--failed', progress.kind === 'failed');
    let bar = ownChild(row, 'jfmod-dlRowBar');
    if (!bar) {
        bar = document.createElement('span');
        bar.setAttribute('aria-hidden', 'true');
        bar.innerHTML = '<span class="jfmod-dlBar-fill"></span>';
        row.appendChild(bar);
    }
    setClass(bar, 'jfmod-dlBar jfmod-dlRowBar jfmod-dlBar--' + progress.kind);
    setWidth(bar.firstElementChild as HTMLElement, progress.percent);
    // Upstream's React list rows wrap their content once (`.listItem-content`); the legacy rows and the mod's do not.
    const line = ownChild(row, 'listItem-content') ?? row;
    let figure = row.querySelector<HTMLElement>('.jfmod-dlRowFigure') ?? undefined;
    if (!figure) figure = document.createElement('span');
    setClass(figure, 'jfmod-dlFigure jfmod-dlRowFigure jfmod-dlFigure--' + progress.kind + (progress.stale ? ' jfmod-dlFigure--stale' : ''));
    if (figure.textContent !== progress.text) figure.textContent = progress.text;
    const body = ownChild(line, 'listItemBody');
    // On the phone the row's end has no room beside its buttons (the title shrank to "1. Leave…" on 28096): the figure is the
    // last line of the row's text instead.
    if (layoutManager.mobile && body) {
        if (body.lastElementChild !== figure) body.appendChild(figure);
        return;
    }
    if (body ? body.nextElementSibling !== figure : figure.parentElement !== line) line.insertBefore(figure, body ? body.nextSibling : null);
};

/** Removes every mark this pass did not draw, once nothing on the page is on its way. */
const clearAll = () => {
    document.querySelectorAll('.jfmod-dlCard').forEach(clearCard);
    document.querySelectorAll<HTMLElement>('.jfmod-dlRow').forEach(clearRow);
};

/**
 * Places native seasons and episodes (their series and numbers), once per item and in one request per pass for those not
 * placed yet. An item that cannot be read is placed nowhere.
 */
const usePlacements = (api: Api | undefined, userId: string | undefined, onPlaced: () => void) => {
    const placements = useRef(new Map<string, Placement | null>());
    const asking = useRef(false);
    const place = useCallback((ids: string[]) => {
        const wanted = ids.filter(id => !placements.current.has(id));
        if (!api || !userId || asking.current || wanted.length === 0) return;
        asking.current = true;
        getLibraryApi(api).getItems({ userId, ids: wanted.slice(0, 200), enableImages: false, enableUserData: false })
            .then(({ data }) => {
                for (const id of wanted.slice(0, 200)) placements.current.set(id, null);
                for (const item of data.Items ?? []) {
                    if (!item.Id || !item.SeriesId) continue;
                    placements.current.set(normalId(item.Id), item.Type === 'Season' ?
                        { seriesId: item.SeriesId, season: item.IndexNumber ?? null, episode: null } :
                        { seriesId: item.SeriesId, season: item.ParentIndexNumber ?? null, episode: item.IndexNumber ?? null });
                }
            }, () => {
                for (const id of wanted.slice(0, 200)) placements.current.set(id, null);
            })
            .finally(() => {
                asking.current = false;
                onPlaced();
            });
    }, [api, userId, onPlaced]);
    return { placements: placements.current, place };
};

/**
 * The Jellyfin items of a title the queue names without one (`entry.jellyfinItemId` is null): a series or movie with no file
 * yet whose Jellyfin item already exists (season folders, a reclaimed title) still has a native card, which the plugin binds to
 * the entry. Found once per entry: Jellyfin's items with the title's name, each confirmed by the plugin's own lookup
 * (`GET /Entries?jellyfinItemId=`), one entry at a time.
 */
/** The item's id when the plugin finds this very entry for it, else null. */
const boundTo = (api: Api, entryId: string, itemId: string) => getEntries(api, { jellyfinItemId: itemId, limit: 1 })
    .then(found => (found.items[0]?.id === entryId ? normalId(itemId) : null), () => null);

const useBoundItems = (api: Api | undefined, userId: string | undefined, onBound: () => void) => {
    const bound = useRef(new Map<string, string[]>());
    const asking = useRef(false);
    const bind = useCallback((rows: QueueRow[]) => {
        const entry = rows.map(row => row.entry).find(candidate => candidate && !candidate.jellyfinItemId && !bound.current.has(candidate.id));
        if (!api || !userId || asking.current || !entry) return;
        asking.current = true;
        const kind = entry.mediaType === 'movie' ? BaseItemKind.Movie : BaseItemKind.Series;
        getLibraryApi(api).getItems({ userId, searchTerm: entry.title, includeItemTypes: [kind], recursive: true, limit: 5,
            enableImages: false, enableUserData: false })
            .then(({ data }) => Promise.all((data.Items ?? []).flatMap(item => (item.Id ? [boundTo(api, entry.id, item.Id)] : []))))
            .then(ids => bound.current.set(entry.id, ids.filter((id): id is string => !!id)),
                () => bound.current.set(entry.id, []))
            .finally(() => {
                asking.current = false;
                onBound();
            });
    }, [api, userId, onBound]);
    return { bound: bound.current, bind };
};

const DownloadMarks: FC = () => {
    const { api, user } = useApi();
    const capability = useQueueCapability();
    const [watching, setWatching] = useState(false);
    const queue = useQueue({ enabled: capability.available, poll: watching ? 'cards' : false });
    const [placed, setPlaced] = useState(0);
    const onPlaced = useCallback(() => setPlaced(value => value + 1), []);
    const { placements, place } = usePlacements(api, user?.Id, onPlaced);
    const { bound, bind } = useBoundItems(api, user?.Id, onPlaced);
    const items = queue.data?.items;

    // One read when a page opens (the app's first page too: the query cache is kept across reloads), joining a read already
    // under way; a queue kept private (403) is not asked again.
    const { refetch } = queue;
    const readable = capability.available && !queue.adminOnly;
    useEffect(() => {
        if (!readable) return;
        const onPage = () => {
            refetch({ cancelRefetch: false }).catch(() => undefined);
        };
        onPage();
        window.addEventListener('hashchange', onPage);
        return () => window.removeEventListener('hashchange', onPage);
    }, [readable, refetch]);

    useEffect(() => {
        const relevant = (items ?? []).filter(row => row.state !== 'seeding');
        if (!readable || relevant.length === 0) {
            clearAll();
            setWatching(false);
            return;
        }
        bind(relevant);
        const index = indexQueue(relevant, bound);
        let timer: number | undefined;
        // Cards arrive after the page (lazy rows, a grid's next page, upstream redrawing a list): another pass, at most one
        // per 150 ms; the pass's own changes are dropped from the record so they do not start another.
        const observer = new MutationObserver(() => {
            if (timer === undefined) timer = window.setTimeout(pass, 150);
        });
        function pass() {
            timer = undefined;
            let shown = 0;
            const unplaced: string[] = [];
            document.querySelectorAll<HTMLElement>(TARGETS).forEach(element => {
                const target = targetOf(element);
                const rows = target ? rowsOf(index, target, placements) : [];
                if (rows === undefined && target && 'itemId' in target) unplaced.push(target.itemId);
                const isRow = element.classList.contains('listItem');
                const progress = rows ? progressOf(rows, isRow) : null;
                if (isRow) drawRow(element, progress);
                else drawCard(element, progress);
                if (progress && progress.kind !== 'failed' && !element.closest('.hide')) shown++;
            });
            observer.takeRecords();
            setWatching(shown > 0);
            place(unplaced);
        }
        observer.observe(document.body, { childList: true, subtree: true });
        pass();
        return () => {
            observer.disconnect();
            if (timer !== undefined) window.clearTimeout(timer);
        };
    }, [items, readable, placed, placements, place, bound, bind]);

    useEffect(() => clearAll, []);
    return null;
};

export default DownloadMarks;
