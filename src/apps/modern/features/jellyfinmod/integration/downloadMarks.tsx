import type { Api } from '@jellyfin/sdk/lib/api';
import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind';
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api';
import { useQueryClient } from '@tanstack/react-query';
import { type FC, useCallback, useEffect, useRef, useState } from 'react';

import { useApi } from 'hooks/useApi';

import { type EntryDetail, getEntries, GRAB_EVENT } from '../api/modApi';
import { entryDetailQuery } from '../hooks/useEntries';
import { aggregateProgress, describeDownload, downloadProgress, type DownloadProgress, isUnderWay } from '../constants/queue';
import { currentRowFor, finishedRow, packEpisodeView, packHolds, useQueue, useQueueCapability } from '../hooks/useQueue';
import type { QueueRow } from '../types/queue';

import { paintDownloadMark } from '../components/DownloadStateMark';

import '../components/fileStateMark.scss';
import '../components/downloadProgress.scss';

/**
 * Downloads on every card and row of the page (P4.FU1, user-approved design 2026-10-12; the ring family P4.FU6, approved
 * 2026-10-13; UX §3.3).
 *
 * Wherever a title, season or episode is on its way, its card gets a thin icon-colour bar along the poster's bottom edge (the watched
 * part in the primary on top) and the download disc (`DownloadStateMark`: the arrow and the icon-colour arc, a clock, the importing
 * spinner, the pause) top right, left of upstream's tick or count pill, with the figure in its tooltip; a season page's or list
 * view's row gets the disc as the first round icon of its end slot (no bar) and the figure on its meta line (`42% · 12 min
 * left`, `Stalled · 42%`, `Queued`, `Importing…`, `Failed · reason`). A series or season shows the mean of its episodes on
 * their way.
 *
 * One component for the whole app, so every card and row of a page costs one `GET /JellyfinMod/Queue` (the shared queue query):
 * read when a page opens, then every 5 s only while something on the page is on its way. Upstream's cards and rows are not
 * edited: the mod adds its elements beside upstream's and a class on the card's frame, and takes them away again when the
 * download is over. Upstream cards are found by `data-id` and `data-type`; the mod's own (a file-less title, a missing season
 * or episode) carry `data-jfmod-entry-id`, with `data-jfmod-season` or `data-jfmod-episode-id`. A user who may not read the
 * queue (403) sees none of it.
 */

const TARGETS = '.card[data-id], .card[data-jfmod-entry-id], .listItem[data-id], .listItem[data-jfmod-entry-id]';
const MEDIA_TYPES = new Set(['Movie', 'Series', 'Season', 'Episode']);

/** What a card or row is drawn on at once for: itself, a mark in it (Not Downloaded, Unaired), or its entry's stamp. */
const URGENT = TARGETS + ', .jfmod-mark';
const STAMPS = ['data-jfmod-entry-id', 'data-jfmod-episode-id', 'data-jfmod-season'];

/** A mutation that adds a card, a row or a mark, or stamps a card or row with its entry. */
const isUrgent = (record: MutationRecord) => (record.type === 'attributes' ? true : Array.from(record.addedNodes)
    .some(node => node instanceof Element && (node.matches(URGENT) || !!node.querySelector(URGENT))));

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
    /** The rows on their way (no seeding copy). */
    items: QueueRow[];
    /** Every row, finished imports included: whether a download a card or row showed ended with its file. */
    all: QueueRow[];
    /** An entry's Jellyfin item (a movie or a series) to the entry. */
    entryByItem: Map<string, string>;
    /** Whether any row is about an episode, so native seasons and episodes are worth placing. */
    episodic: boolean;
}

const indexQueue = (items: QueueRow[], all: QueueRow[], bound: Map<string, string[]>, seriesEntries: Map<string, string | null>): QueueIndex => {
    const entryByItem = new Map<string, string>();
    for (const [seriesId, entryId] of seriesEntries) {
        if (entryId) entryByItem.set(seriesId, entryId);
    }
    for (const row of all) {
        if (row.entry?.jellyfinItemId) entryByItem.set(normalId(row.entry.jellyfinItemId), row.entry.id);
    }
    for (const [entryId, itemIds] of bound) {
        for (const itemId of itemIds) entryByItem.set(itemId, entryId);
    }
    return { items, all, entryByItem, episodic: all.some(row => !!row.episode || !!row.pack) };
};

/** An episode's current row, a pack's only while it holds the episode; `own` is the episode's own file of a pack (P4.FU5). */
const heldRow = (queue: QueueIndex, entryId: string, episodeId: string, own: boolean) => {
    const row = currentRowFor(queue.items, entryId, episodeId);
    if (!row || (row.pack && !packHolds(row, episodeId))) return undefined;
    return own ? packEpisodeView(row, episodeId) : row;
};

/** The episodes of an entry (of one season, or one episode number, when given) that the rows name. */
const namedEpisodes = (items: QueueRow[], entryId: string, season: number | null, number: number | null) => {
    const ids = new Set<string>();
    const wanted = (seasonNumber: number, episodeNumber: number) =>
        (season === null || seasonNumber === season) && (number === null || episodeNumber === number);
    for (const row of items) {
        if (row.entry?.id !== entryId) continue;
        if (row.episode && wanted(row.episode.seasonNumber, row.episode.episodeNumber)) ids.add(row.episode.id);
        for (const episode of row.pack?.episodes ?? []) {
            if (wanted(episode.seasonNumber, episode.episodeNumber)) ids.add(episode.episodeId);
        }
    }
    return ids;
};

/**
 * The current row of each episode of an entry (of one season, or one episode number, when given) that a row names, a pack's
 * once for every episode it still holds, so a series' or season's mean weighs a pack by its episodes. One episode (a number
 * given) shows its own file of a pack; a season or series keeps the pack's whole torrent.
 */
const episodeRows = (queue: QueueIndex, entryId: string, season: number | null, number: number | null = null) => {
    const rows: QueueRow[] = [];
    for (const id of namedEpisodes(queue.items, entryId, season, number)) {
        const row = heldRow(queue, entryId, id, number !== null);
        if (row) rows.push(row);
    }
    return rows;
};

/**
 * What one card or row stands for in the queue's terms: an entry, and within it a season, an episode number or an episode;
 * all null for a whole title. Null when the queue names nothing of it, undefined while a native season or episode is not
 * placed yet.
 */
interface Scope {
    entryId: string;
    season: number | null;
    number: number | null;
    episodeId: string | null;
}

const scopeOf = (queue: QueueIndex, target: Target, placements: Map<string, Placement | null>): Scope | null | undefined => {
    if ('entryId' in target) return { entryId: target.entryId, season: target.episodeId ? null : target.season, number: null, episodeId: target.episodeId };
    if (target.type === 'Movie' || target.type === 'Series') {
        const entryId = queue.entryByItem.get(target.itemId);
        return entryId ? { entryId, season: null, number: null, episodeId: null } : null;
    }
    if (!queue.episodic) return null;
    const placement = placements.get(target.itemId);
    if (placement === undefined) return undefined;
    const entryId = placement ? queue.entryByItem.get(normalId(placement.seriesId)) : undefined;
    if (!placement || !entryId || placement.season === null) return null;
    return { entryId, season: placement.season, number: target.type === 'Episode' ? placement.episode : null, episodeId: null };
};

/** The rows of a scope: one episode's own (its file of a pack), a title's own row (a movie), or the episodes' of a season or series. */
const rowsIn = (queue: QueueIndex, scope: Scope): QueueRow[] => {
    if (scope.episodeId) {
        const row = currentRowFor(queue.items, scope.entryId, scope.episodeId);
        return row ? [packEpisodeView(row, scope.episodeId)] : [];
    }
    const own = scope.season === null && scope.number === null ? currentRowFor(queue.items, scope.entryId, null) : undefined;
    return own ? [own] : episodeRows(queue, scope.entryId, scope.season, scope.number);
};

/**
 * Whether the downloads a card or row showed (by their grabs) ended with their files: everything of the scope that the rows name
 * is in the library now, by one of those grabs. A cancelled or failed download, or an older import, is not.
 */
const scopeDone = (queue: QueueIndex, scope: Scope, grabs: Set<string>) => {
    const by = (row: QueueRow | undefined) => !!row && grabs.has(row.grabId);
    if (scope.episodeId) return by(finishedRow(queue.all, scope.entryId, scope.episodeId));
    if (scope.season === null && scope.number === null && currentRowFor(queue.all, scope.entryId, null)) {
        return by(finishedRow(queue.all, scope.entryId, null));
    }
    const ids = Array.from(namedEpisodes(queue.all, scope.entryId, scope.season, scope.number));
    const rows = ids.map(id => finishedRow(queue.all, scope.entryId, id));
    return rows.length > 0 && rows.every(row => !!row) && rows.some(by);
};

/**
 * A download that ended with its file, on a card or row whose page has not drawn the file's own item yet (P4.FU10, P4.FU12): it
 * keeps reading as importing until it has, so the cloud never comes back between the import and the file. It is the plugin's
 * fresh entry detail that says when the file is playable (`playableItemId`) and the card or row's own `data-id` that says the page
 * drew it, never a mark that may be absent for a frame while upstream redraws. Only an ended or cancelled download stops it;
 * after this long it stops anyway, as a safety, with its tooltip saying it takes longer than usual from DELAYED_MS on.
 */
const IMPORTED_CARRY_MS = 10 * 60 * 1000;
/** From this long after the import ended the carried ring says it is taking longer than usual; the entry is read every 5 s, not every 1 s. */
const DELAYED_MS = 30 * 1000;

/** While a page's first queue read is under way, its Not Downloaded marks wait hidden (downloadProgress.scss), this long at most. */
const READING_CLASS = 'jfmod-dlReading';
const READING_MS = 1500;
const endReading = () => document.documentElement.classList.remove(READING_CLASS);
const IMPORTED = describeDownload('importing', 100, false);
const IMPORTED_DELAYED = { ...IMPORTED, tooltip: IMPORTED.tooltip + ' (taking longer than usual)' };
const showsNoFile = (element: HTMLElement) => !!element.querySelector('.jfmod-mark--none, .jfmod-mark--unaired');

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
    frame.querySelector('.jfmod-dlmark')?.remove();
};

/**
 * The bar at the poster's bottom (download beneath, watched on top) and the disc top right: the first of upstream's indicators,
 * left of the played tick or the plain count pill (two icons, user 2026-10-13), or alone in the corner.
 */
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

    // The disc lives on the card's frame, not in upstream's indicator cluster: the cluster sits in the image container, whose
    // `contain: strict` puts it under the hover veil (white at half, user 2026-10-17). It is placed just left of the cluster.
    let disc = frame.querySelector<HTMLElement>('.jfmod-dlmark');
    if (!disc) {
        disc = document.createElement('span');
        // A click on it is a click on the card, as it was under the veil.
        disc.addEventListener('click', () => frame.querySelector<HTMLElement>('.cardOverlayContainer')?.click());
    }
    paintDownloadMark(disc, progress, 'card', 'jfmod-dlmark--corner');
    if (disc.parentNode !== frame) frame.appendChild(disc);
    const indicators = frame.querySelector('.cardIndicators');
    const size = parseFloat(getComputedStyle(disc).fontSize) || 16;
    const cluster = indicators ? indicators.getBoundingClientRect().width / size : 0;
    const side = getComputedStyle(frame).direction === 'rtl' ? 'left' : 'right';
    const offset = (0.225 + (cluster > 0 ? cluster + 0.25 : 0)).toFixed(3) + 'em';
    if (disc.style[side] !== offset) disc.style[side] = offset;
};

/** A row's end slot: the first of these is where the disc goes before (the mark's host, upstream's buttons). */
const END_SLOT = '.jfmod-rowMarkHost, .jfmod-missingRowEnd, .jfmod-mark--row, .listViewUserDataButtons, .listItemButton';

/**
 * A failure borrows the Not Downloaded mark: its tooltip (and a button's name) become the failure's, and the administrator's
 * button (P1.FU22) is disabled, so the red bang stays an indicator as on every other row; both are given back after.
 */
const borrowTitle = (mark: HTMLElement, title: string | null) => {
    const own = mark.getAttribute('data-jfmod-title');
    const button = mark instanceof HTMLButtonElement ? mark : null;
    if (title === null) {
        if (own === null) return;
        mark.title = own;
        if (button) {
            button.setAttribute('aria-label', mark.getAttribute('data-jfmod-label') ?? own);
            button.disabled = false;
        }
        mark.removeAttribute('data-jfmod-title');
        mark.removeAttribute('data-jfmod-label');
        return;
    }
    if (own === null) {
        mark.setAttribute('data-jfmod-title', mark.title);
        if (button) mark.setAttribute('data-jfmod-label', button.getAttribute('aria-label') ?? mark.title);
    }
    if (mark.title !== title) mark.title = title;
    if (button) {
        if (button.getAttribute('aria-label') !== title) button.setAttribute('aria-label', title);
        button.disabled = true;
    }
};

const clearRow = (row: HTMLElement) => {
    if (!row.classList.contains('jfmod-dlRow')) return;
    row.classList.remove('jfmod-dlRow', 'jfmod-dlRow--failed');
    row.querySelector('.jfmod-dlmark')?.remove();
    row.querySelector('.jfmod-dlMeta')?.remove();
    const mark = row.querySelector<HTMLElement>('.jfmod-mark--none');
    if (mark) borrowTitle(mark, null);
};

/** Where a row's meta line is shown: upstream's media info or the mod's, unless the layout hides it (upstream does below 50em). */
const metaHost = (row: HTMLElement) => Array.from(row.querySelectorAll<HTMLElement>('.listItemMediaInfo, .jfmod-missingMeta'))
    .find(host => getComputedStyle(host).display !== 'none') ?? null;

/**
 * A row (P4.FU6, ring only, no bar): the disc as the first round icon of its end slot, and the figure on its meta line after the
 * date (`42% · 12 min left`), or as the last line of its text where the layout shows no meta line. A failure takes the Not
 * Downloaded mark's place where the row has one: a red bang, an indicator (an administrator's button disabled meanwhile; never
 * both); a row without it (a file on disk) gets the red bang as a plain disc.
 */
const drawRow = (row: HTMLElement, progress: DownloadProgress | null) => {
    if (!progress) {
        clearRow(row);
        return;
    }
    row.classList.add('jfmod-dlRow');
    row.classList.toggle('jfmod-dlRow--failed', progress.kind === 'failed');
    drawRowDisc(row, progress);
    drawRowMeta(row, progress);
};

/** The disc first in the end slot, or the failure on the Not Downloaded button. */
const drawRowDisc = (row: HTMLElement, progress: DownloadProgress) => {
    // Upstream's React list rows wrap their content once (`.listItem-content`); the legacy rows and the mod's do not.
    const line: HTMLElement = ownChild(row, 'listItem-content') ?? row;
    const mark = row.querySelector<HTMLElement>('.jfmod-mark--none');
    const existing = row.querySelector<HTMLElement>('.jfmod-dlmark');
    if (progress.kind === 'failed' && mark) {
        existing?.remove();
        borrowTitle(mark, progress.tooltip);
        return;
    }
    if (mark) borrowTitle(mark, null);
    const disc = existing ?? document.createElement('span');
    paintDownloadMark(disc, progress, 'row');
    const anchor = Array.from(line.children).find(child => !child.classList.contains('jfmod-dlmark') && child.matches(END_SLOT)) ?? null;
    if (anchor ? disc.nextElementSibling !== anchor : disc.parentElement !== line) line.insertBefore(disc, anchor);
};

/** The figure on the meta line after the date, or the last line of the row's text where no meta line shows. */
const drawRowMeta = (row: HTMLElement, progress: DownloadProgress) => {
    const host = metaHost(row);
    const parent = host ?? row.querySelector('.listItemBody') ?? ownChild(row, 'listItem-content') ?? row;
    const meta = row.querySelector<HTMLElement>('.jfmod-dlMeta') ?? document.createElement('div');
    setClass(meta, (host ? 'mediaInfoItem' : 'secondary listItemBodyText') + ' jfmod-dlMeta jfmod-dlMeta--' + progress.kind
        + (progress.stale ? ' jfmod-dlMeta--stale' : ''));
    if (meta.textContent !== progress.text) meta.textContent = progress.text;
    if (meta.title !== progress.tooltip) meta.title = progress.tooltip;
    if (parent.lastElementChild !== meta) parent.appendChild(meta);
};

/** Removes every mark this pass did not draw, once nothing on the page is on its way. */
const clearAll = () => {
    document.querySelectorAll('.jfmod-dlCard').forEach(clearCard);
    document.querySelectorAll<HTMLElement>('.jfmod-dlRow').forEach(clearRow);
};

/**
 * The entry of each series a native season or episode belongs to, by the plugin's own lookup (`GET /Entries?jellyfinItemId=`),
 * once per series. A season's series is not always the entry's Jellyfin item: a library with two folders for one show (the
 * acceptance instance's 1923, its read-only folder and the mod's download folder) gets two series items, and the series page
 * lists the seasons of both, each under its own series (P1.FU17).
 */
const lookUpSeries = (api: Api, seriesEntries: Map<string, string | null>, ids: string[]) => Promise.all(ids
    .filter(id => !seriesEntries.has(id))
    .map(id => getEntries(api, { jellyfinItemId: id, limit: 1 })
        .then(found => seriesEntries.set(id, found.items[0]?.id ?? null), () => seriesEntries.set(id, null))));

/**
 * Places native seasons and episodes (their series and numbers), once per item and in one request per pass for those not
 * placed yet, and finds each series' entry. An item that cannot be read is placed nowhere.
 */
const usePlacements = (api: Api | undefined, userId: string | undefined, onPlaced: () => void) => {
    const placements = useRef(new Map<string, Placement | null>());
    const seriesEntries = useRef(new Map<string, string | null>());
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
                const series = new Set((data.Items ?? []).flatMap(item => (item.SeriesId ? [normalId(item.SeriesId)] : [])));
                return lookUpSeries(api, seriesEntries.current, Array.from(series));
            }, () => {
                for (const id of wanted.slice(0, 200)) placements.current.set(id, null);
            })
            .finally(() => {
                asking.current = false;
                onPlaced();
            });
    }, [api, userId, onPlaced]);
    return { placements: placements.current, seriesEntries: seriesEntries.current, place };
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

/**
 * What showed a download on this visit, by what it stands for (an entry and its season, episode number or episode), so a card or
 * row upstream draws again keeps it: the grabs it was, and when it was seen to end with its file (0 while it runs).
 */
type Carried = Map<string, { grabs: Set<string>; ended: number; clean: number }>;
const keyOf = (scope: Scope) => [scope.entryId, scope.season, scope.number, scope.episodeId].join('|');

interface PassContext {
    index: QueueIndex;
    placements: Map<string, Placement | null>;
    carried: Carried;
    now: number;
    /** Only finished imports are left: what showed a download is looked at again, and nothing is placed. */
    idle: boolean;
    /** Native seasons and episodes to place, filled by the pass. */
    unplaced: string[];
    /** An entry's detail as the plugin last answered it (what names the playable items), or undefined when not read yet. */
    detailOf: (entryId: string) => EntryDetail | undefined;
}

/**
 * Whether the page has drawn what the plugin says is playable for a scope (P4.FU12). A movie, or one native episode: the card or
 * row is the playable item itself. A season or series (or a card of the mod's): every episode the download named is playable. An
 * entry detail not read yet, or one that does not name the item, means not yet.
 */
const playableDrawn = (element: HTMLElement, scope: Scope, { index, detailOf }: PassContext): 'no' | 'yes' | 'itself' => {
    const detail = detailOf(scope.entryId);
    if (!detail) return 'no';
    const drawn = normalId(element.getAttribute('data-id'));
    // The card or row is Jellyfin's item of the file itself: the playable item, or (a detail read before the import ended) an
    // item that is not the placeholder the title had. A placeholder drawn again keeps its id, so this never ends the ring early.
    const isFile = (playable: string | null | undefined, placeholder: string | null | undefined) => !!drawn
        && (normalId(playable) === drawn || (!!placeholder && normalId(placeholder) !== drawn));
    if (detail.entry.mediaType === 'movie') {
        if (isFile(detail.entry.playableItemId, detail.entry.placeholderItemId)) return 'itself';
        const playable = detail.entry.playableItemId;
        return !!playable && !drawn ? 'yes' : 'no';
    }
    const ids = scope.episodeId ? [scope.episodeId] : Array.from(namedEpisodes(index.all, scope.entryId, scope.season, scope.number));
    const episodes = ids.map(id => detail.episodes.find(episode => episode.id === id));
    if (episodes.length === 0) return 'no';
    // A season's or series' card is not the episode: only a card or row of one episode must be the playable item itself.
    const itself = !!scope.episodeId || scope.number !== null;
    if (itself && drawn) return isFile(episodes[0]?.playableItemId, episodes[0]?.placeholderItemId) ? 'itself' : 'no';
    return episodes.every(episode => !!episode?.playableItemId) ? 'yes' : 'no';
};

/**
 * What a card or row shows once its download is no longer on its way: the import while its downloads ended with their files and
 * the page has not drawn the file's own item (P4.FU12), else nothing (a cancelled or failed download, or the page caught up).
 * The page has caught up at once when a card or row of the episode or movie is the file's own item, and otherwise (a season's or
 * series' card) when the plugin names every playable item and the card shows no missing file for two passes running; until then
 * a mark that is absent for a frame while upstream redraws changes nothing.
 */
const afterwards = (element: HTMLElement, scope: Scope, context: PassContext) => {
    const { index, carried, now } = context;
    const key = keyOf(scope);
    const memory = carried.get(key);
    if (!memory) return null;
    const ended = memory.ended || now;
    if (!scopeDone(index, scope, memory.grabs) || now - ended >= IMPORTED_CARRY_MS) {
        carried.delete(key);
        return null;
    }
    const drawn = showsNoFile(element) ? 'no' : playableDrawn(element, scope, context);
    const clean = drawn === 'no' ? 0 : memory.clean + 1;
    // The file's own item drawn ends it at once (P4.FU12): a new card or row is the file, never a frame of a placeholder.
    if (drawn === 'itself' || clean >= 2) {
        carried.delete(key);
        return null;
    }
    carried.set(key, { grabs: memory.grabs, ended, clean });
    return now - ended >= DELAYED_MS ? IMPORTED_DELAYED : IMPORTED;
};

/** One card's or row's download, drawn for this pass; true when it shows one on its way. */
const markElement = (element: HTMLElement, context: PassContext): boolean => {
    const { index, placements, carried, idle, unplaced } = context;
    const isRow = element.classList.contains('listItem');
    const target = targetOf(element);
    const scope = target ? scopeOf(index, target, placements) : null;
    if (scope === undefined && !idle && target && 'itemId' in target) unplaced.push(target.itemId);
    const live = idle ? null : scope;
    const rows = live ? rowsIn(index, live) : [];
    // A card that stands for one episode of the mod's (the missing episode page's still) shows its download as a row does, a
    // failure included.
    let progress = live ? progressOf(rows, isRow || element.hasAttribute('data-jfmod-episode-id')) : null;
    const onItsWay = !!live && !!progress && progress.kind !== 'failed';
    if (onItsWay) {
        const key = keyOf(live);
        const grabs = carried.get(key)?.grabs ?? new Set<string>();
        for (const row of rows) grabs.add(row.grabId);
        carried.set(key, { grabs, ended: 0, clean: 0 });
    } else if (!progress && scope) {
        progress = afterwards(element, scope, context);
    }
    if (isRow) drawRow(element, progress);
    else drawCard(element, progress);
    return onItsWay;
};

const DownloadMarks: FC = () => {
    const { api, user } = useApi();
    const queryClient = useQueryClient();
    const capability = useQueueCapability();
    const [watching, setWatching] = useState(false);
    // A grab was just made here: the queue is read at once and then every 5 s for three minutes (a plugin that lists held grabs
    // shows it at once anyway; an older one only once the client has it).
    const [grabbed, setGrabbed] = useState(false);
    // Nothing on its way on the page: still read once a minute, so a grab made on another device shows without a navigation
    // (P4.FU10). Opening a page, a reload and coming back to the tab read at once.
    const queue = useQueue({ enabled: capability.available, poll: watching || grabbed ? 'cards' : 'slow' });
    const [placed, setPlaced] = useState(0);
    const onPlaced = useCallback(() => setPlaced(value => value + 1), []);
    const { placements, seriesEntries, place } = usePlacements(api, user?.Id, onPlaced);
    const { bound, bind } = useBoundItems(api, user?.Id, onPlaced);
    const carried = useRef<Carried>(new Map());
    const items = queue.data?.items;
    const detailOf = useCallback((entryId: string) => (api && user?.Id ?
        queryClient.getQueryData<EntryDetail>(entryDetailQuery(api, user.Id, entryId).queryKey) : undefined), [api, queryClient, user?.Id]);

    // An import that ended waits for the page to draw the file's own item (P4.FU12). The plugin pushes that (an early LibraryChanged,
    // after which the catalog queries are read again), so a page pass follows each answer for an entry's detail; the one fallback for
    // a push that does not come is `useEntryFallbackPoll`, not this file.
    useEffect(() => {
        const timers = new Set<number>();
        const unsubscribe = queryClient.getQueryCache().subscribe(event => {
            if (event.type === 'updated' && event.action.type === 'success' && event.query.queryKey[3] === 'EntryDetail' && carried.current.size > 0) {
                onPlaced();
                // The ring ends after two clean passes (see `afterwards`): the second follows the first by a moment, a pass of the
                // page only (no request), so it does not wait for the next answer.
                const timer = window.setTimeout(() => {
                    timers.delete(timer);
                    onPlaced();
                }, 400);
                timers.add(timer);
            }
        });
        return () => {
            unsubscribe();
            for (const timer of timers) window.clearTimeout(timer);
        };
    }, [queryClient, onPlaced]);

    // One read when a page opens (the app's first page too: the query cache is kept across reloads), joining a read already
    // under way, and when the tab is shown again; a queue kept private (403) is not asked again. Until a page's read has been
    // drawn (at most READING_MS), its Not Downloaded marks wait hidden: the cached answer may predate a grab made elsewhere, and
    // "queued" a moment later beats a wrong Not Downloaded now (P4.FU10).
    const { refetch, dataUpdatedAt } = queue;
    const readable = capability.available && !queue.adminOnly;
    const readingSince = useRef(0);
    useEffect(() => {
        if (!readable) return;
        let cap: number | undefined;
        const onPage = () => {
            readingSince.current = Date.now();
            document.documentElement.classList.add(READING_CLASS);
            window.clearTimeout(cap);
            cap = window.setTimeout(endReading, READING_MS);
            refetch({ cancelRefetch: false }).catch(() => undefined);
        };
        const onShown = () => {
            if (document.visibilityState === 'visible') onPage();
        };
        onPage();
        window.addEventListener('hashchange', onPage);
        document.addEventListener('visibilitychange', onShown);
        return () => {
            window.removeEventListener('hashchange', onPage);
            document.removeEventListener('visibilitychange', onShown);
            window.clearTimeout(cap);
            endReading();
        };
    }, [readable, refetch]);

    useEffect(() => {
        let timer: number | undefined;
        const onGrab = () => {
            refetch({ cancelRefetch: false }).catch(() => undefined);
            setGrabbed(true);
            window.clearTimeout(timer);
            timer = window.setTimeout(() => setGrabbed(false), 3 * 60 * 1000);
        };
        window.addEventListener(GRAB_EVENT, onGrab);
        return () => {
            window.removeEventListener(GRAB_EVENT, onGrab);
            window.clearTimeout(timer);
        };
    }, [refetch]);

    useEffect(() => {
        const all = items ?? [];
        const relevant = all.filter(row => row.state !== 'seeding');
        const read = dataUpdatedAt >= readingSince.current;
        if (!readable || all.length === 0) {
            clearAll();
            carried.current.clear();
            setWatching(false);
            if (read) endReading();
            return;
        }
        bind(relevant);
        const index = indexQueue(relevant, all, bound, seriesEntries);
        let timer: number | undefined;
        // Cards arrive after the page (lazy rows, a grid's next page, upstream redrawing a list): another pass, at most one per
        // 150 ms, except that a new card, row or mark is drawn on at once, before it is painted, so its first frame never shows
        // Not Downloaded for something on its way (P4.FU10). The pass's own changes are dropped from the record.
        const observer = new MutationObserver(records => {
            if (records.some(isUrgent)) {
                window.clearTimeout(timer);
                pass();
            } else if (timer === undefined) {
                timer = window.setTimeout(pass, 150);
            }
        });
        function pass() {
            timer = undefined;
            let shown = 0;
            const unplaced: string[] = [];
            const context: PassContext = { index, placements, carried: carried.current, now: Date.now(), idle: relevant.length === 0, unplaced, detailOf };
            document.querySelectorAll<HTMLElement>(TARGETS).forEach(element => {
                if (markElement(element, context) && !element.closest('.hide')) shown++;
            });
            observer.takeRecords();
            setWatching(shown > 0);
            place(unplaced);
            if (read) endReading();
        }
        observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: STAMPS });
        pass();
        return () => {
            observer.disconnect();
            if (timer !== undefined) window.clearTimeout(timer);
        };
    }, [items, dataUpdatedAt, readable, placed, placements, seriesEntries, place, bound, bind, detailOf]);

    useEffect(() => clearAll, []);
    return null;
};

export default DownloadMarks;
