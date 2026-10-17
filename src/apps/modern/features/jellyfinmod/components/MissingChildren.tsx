import type { Api } from '@jellyfin/sdk/lib/api';
import { useQuery } from '@tanstack/react-query';
import React, { type FC, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { resolveCardCssClasses } from 'components/cardbuilder/utils/builder';
import layoutManager from 'components/layoutManager';
import browser from 'scripts/browser';
import datetime from 'scripts/datetime';

import type { EntryDetail } from '../api/modApi';
import { PACKS_CAPABILITY, usePluginCapabilities } from '../hooks/useAcquisition';
import { nativeEpisodesQuery, nativeSeasonsQuery } from '../hooks/useEntries';
import { airDateLong, episodeMark, seasonMark } from '../constants/fileState';
import { sameItemId } from '../constants/versions';
import { CardHoverGet, NoFileCard } from '../integration/cardGetRelease';
import { openReleasePicker } from '../integration/releasePicker';
import { redrawUpstreamChildren } from '../integration/upstreamChildren';
import { restoreFocusTo } from '../integration/stockHeaderButton';
import type { EntryEpisode } from '../types/entry';
import { getEntryPath, getTmdbImage } from '../utils/entryLinks';
import FileStateMark, { CardMarkSlot, type MarkDownload } from './FileStateMark';

import './entryList.scss';
import './missingChildren.scss';

/**
 * Every season and every episode on the native pages (P1.FU11, design approved 2026-10-12, UX §7.4): the seasons and episodes
 * the plugin lists that have no Jellyfin item get a mod card or row, in order among upstream's own, inside upstream's list
 * (`#listChildrenCollapsible .itemsContainer`, where upstream's Series and Season pages put their children). Nothing upstream
 * is edited: the mod's elements are DOM inserts beside upstream's cards and rows, placed again whenever upstream redraws the
 * list, and React draws into them through portals.
 */

const CHILDREN = '#listChildrenCollapsible .itemsContainer';

/** One mod element in upstream's list: `order` is its season or episode number. */
interface Slot {
    key: string;
    order: number;
}

/** Upstream's children by Jellyfin id, with the season or episode number each stands at. */
type NativeOrder = Map<string, number>;

const normalId = (id: string) => id.replace(/-/g, '').toLowerCase();

/**
 * Keeps one element per slot inside `container`, each before the first upstream child with a higher number (or at the end).
 * When upstream redraws its list it replaces the container's children, which takes the mod's elements out; an observer then
 * places them again. Elements live as long as their slot, so a refetch never remounts what is focused.
 */
const useOrderedSlots = (container: Element | null, slots: Slot[], natives: NativeOrder, make: (key: string) => HTMLElement) => {
    const elements = useRef(new Map<string, HTMLElement>());
    const [, setVersion] = useState(0);
    const latest = useRef({ slots, natives, make });
    latest.current = { slots, natives, make };
    const slotKey = slots.map(slot => slot.key + '@' + slot.order).join(',');
    const nativeKey = Array.from(natives).join(',');
    useLayoutEffect(() => {
        if (!container) return;
        const own = elements.current;
        const wanted = new Set(latest.current.slots.map(slot => slot.key));
        let changed = false;
        for (const [key, element] of own) {
            if (!wanted.has(key)) {
                element.remove();
                own.delete(key);
                changed = true;
            }
        }
        for (const slot of latest.current.slots) {
            if (!own.has(slot.key)) {
                own.set(slot.key, latest.current.make(slot.key));
                changed = true;
            }
        }
        const place = () => {
            const order = latest.current.natives;
            const upstream = Array.from(container.children).filter(child => !child.classList.contains('jfmod-missingSlot'));
            const numberOf = (child: Element) => order.get(normalId(child.getAttribute('data-id') ?? ''));
            // A number upstream's own list now draws (a placeholder that appeared and was drawn before React caught up, P1.FU27)
            // takes no mod element back: React removes that slot at its next render, and two rows never show meanwhile.
            const drawn = new Set(upstream.map(numberOf).filter((number): number is number => number !== undefined));
            for (const slot of [...latest.current.slots].sort((a, b) => a.order - b.order)) {
                const element = own.get(slot.key);
                if (!element) continue;
                if (drawn.has(slot.order)) {
                    // Dropped from the map too: an element left out of the list would keep the observer placing the rest.
                    element.remove();
                    own.delete(slot.key);
                    continue;
                }
                const next = upstream.find(child => (numberOf(child) ?? -Infinity) > slot.order);
                container.insertBefore(element, next ?? null);
            }
        };
        place();
        // Only when upstream took an element out: placing never reacts to its own inserts.
        const observer = new MutationObserver(() => {
            if (Array.from(own.values()).some(element => element.parentNode !== container)) place();
        });
        observer.observe(container, { childList: true });
        if (changed) setVersion(version => version + 1);
        return () => observer.disconnect();
    }, [container, slotKey, nativeKey]);
    useEffect(() => () => {
        for (const element of elements.current.values()) element.remove();
        elements.current.clear();
    }, []);
    return elements.current;
};

const upstreamIdsIn = (container: Element) => new Set(Array.from(container.children)
    .filter(child => !child.classList.contains('jfmod-missingSlot'))
    .map(child => normalId(child.getAttribute('data-id') ?? '')).filter(Boolean));

const sameIds = (a: Set<string>, b: Set<string>) => a.size === b.size && Array.from(b).every(id => a.has(id));

/** The ids of upstream's own children in its list, read again whenever the list changes. */
const useUpstreamIds = (container: Element | null) => {
    const [ids, setIds] = useState<Set<string>>(() => new Set());
    useLayoutEffect(() => {
        if (!container) return;
        const read = () => {
            const found = upstreamIdsIn(container);
            setIds(old => (sameIds(old, found) ? old : found));
        };
        read();
        const observer = new MutationObserver(read);
        observer.observe(container, { childList: true });
        return () => observer.disconnect();
    }, [container]);
    return ids;
};

/**
 * The native items that count as held on this page (P1.FU27): those Jellyfin had at the first read, and any added since only once
 * upstream's own list draws it. A placeholder Jellyfin adds while the page is open (the backfill, an import swap) therefore keeps
 * the mod's card or row until upstream shows its own, never a gap; and upstream's list is drawn again when Jellyfin's items and the
 * drawn ones differ (added, or removed by Remove Placeholders), so the swap happens without reloading the page and never shows
 * both for longer than that redraw.
 */
const useHeldNatives = (items: { Id?: string | null }[] | undefined, container: Element | null, redraw: () => Promise<void>) => {
    const initial = useRef<Set<string> | null>(null);
    const ids = useMemo(() => (items ?? []).flatMap(item => (item.Id ? [normalId(item.Id)] : [])), [items]);
    if (items && !initial.current) initial.current = new Set(ids);
    const drawn = useUpstreamIds(container);
    const asked = useRef('');
    const known = initial.current;
    useEffect(() => {
        if (!items || !known || !container) return;
        const listed = new Set(ids);
        const added = ids.filter(id => !known.has(id) && !drawn.has(id));
        const removed = Array.from(drawn).filter(id => !listed.has(id));
        const key = added.join(',') + '|' + removed.join(',');
        if ((!added.length && !removed.length) || asked.current === key) return;
        asked.current = key;
        redraw().catch(error => console.warn('[JellyfinMod] Could not draw the list again', error));
    }, [container, drawn, ids, items, known, redraw]);
    return useMemo(() => new Set(ids.filter(id => known?.has(id) || drawn.has(id))), [drawn, ids, known]);
};

/** Upstream's list on the page, once its template has it. */
const useChildrenContainer = (view: HTMLElement) => {
    const [container, setContainer] = useState<Element | null>(null);
    useLayoutEffect(() => {
        setContainer(view.querySelector(CHILDREN));
    }, [view]);
    return container;
};

/** The release picker opened from a mark, in the scope of its season or episode, as their own pages open it. */
const usePickerFor = (api: Api, detail: EntryDetail, onChanged: () => void) => useCallback(
    (scope: { seasonNumber?: number; episodeId?: string }) => (button: HTMLElement) => {
        openReleasePicker({
            api, entryId: detail.entry.id, title: detail.entry.title, mediaType: detail.entry.mediaType, episodes: detail.episodes,
            episodeId: scope.episodeId, episodePage: !!scope.episodeId, seasonNumber: scope.seasonNumber,
            episodeListLoaded: detail.episodeListLoaded, onChanged
        }).then(() => restoreFocusTo(button), () => restoreFocusTo(button));
    }, [api, detail, onChanged]);

export const episodesWord = (count: number) => count + (count === 1 ? ' episode' : ' episodes');

/**
 * A TMDB poster or still for a season or episode Jellyfin has no item for (P1.FU14), filling upstream's image box as its own
 * image does (cover, centred, lazy). Null while there is none, or once it failed to load (offline, a blocked CDN): the
 * caller then draws the dashed placeholder with the number.
 */
export const useTmdbCover = (path: string | null | undefined, size: 'w185' | 'w300' | 'w342' | 'w500') => {
    const src = getTmdbImage(path, size);
    const [failed, setFailed] = useState<string>();
    const onError = useCallback(() => setFailed(src), [src]);
    return src && failed !== src ? <img className='jfmod-missingImage' src={src} alt='' loading='lazy' decoding='async' onError={onError} /> : null;
};

interface SeasonCardProps {
    season: number;
    /** TMDB's poster of the season, from the series' metadata. */
    posterPath?: string | null;
    episodes: EntryEpisode[];
    href: string;
    download: MarkDownload | null;
}

/**
 * A season with no Jellyfin item: TMDB's season poster where it has one (else a dashed placeholder with its number), the mark
 * top right, the stock card's footer lines.
 */
const MissingSeasonCard: FC<SeasonCardProps> = ({ season, posterPath, episodes, href, download }) => {
    const mark = seasonMark(episodes);
    const cover = useTmdbCover(posterPath, 'w342');
    const poster = cover ?? <span className='jfmod-missingNumber' aria-hidden='true'>{season}</span>;
    const className = 'cardImageContainer cardContent jfmod-missingPoster' + (cover ? '' : ' jfmod-missingEmpty');
    return <div className='cardBox cardBox-bottompadded'>
        <div className='cardScalable'>
            <div className='cardPadder cardPadder-overflowPortrait' />
            {layoutManager.tv ?
                <div className={className}>{poster}</div> :
                <a className={className} href={href} aria-label={'Season ' + season}>{poster}</a>}
            {/* Nothing on disk: an administrator's Get a Release in the centre on hover, where Play would be (P1.FU19). */}
            {download && <CardHoverGet open={download.open} />}
            <FileStateMark state={mark.state} airDate={mark.airDate}
                download={mark.state === 'missing' ? download : null} />
        </div>
        <div className='cardFooter'>
            {/* The title is a link as on upstream's own season cards (plain text on the TV, where the card is the button). */}
            <div className='cardText cardTextCentered cardText-first'><bdi>{layoutManager.tv ? 'Season ' + season :
                <a className='textActionButton' href={href} title={'Season ' + season}>Season {season}</a>}</bdi></div>
            <div className='cardText cardTextCentered cardText-secondary'><bdi>{episodesWord(episodes.length)}</bdi></div>
        </div>
    </div>;
};

/** The seasons the plugin lists that Jellyfin has no item for, by number; specials (season 0) are not offered. */
const missingSeasons = (episodes: EntryEpisode[], held: Set<number>) => {
    const bySeason = new Map<number, EntryEpisode[]>();
    for (const episode of episodes) {
        if (episode.seasonNumber <= 0 || held.has(episode.seasonNumber)) continue;
        bySeason.set(episode.seasonNumber, [...(bySeason.get(episode.seasonNumber) ?? []), episode]);
    }
    return Array.from(bySeason).sort(([a], [b]) => a - b);
};

type SeasonCover = [number, Element];

const sameCovers = (a: SeasonCover[], b: SeasonCover[]) =>
    a.length === b.length && a.every(([season, cover], index) => season === b[index][0] && cover === b[index][1]);

/**
 * The covers of upstream's own season cards in the list, by season number, found again whenever upstream redraws the list (it
 * replaces its cards, so a mark drawn into an old cover would be gone). Each card of a numbered season is stamped with the entry
 * and its number, so its download is drawn with its first frame, before Jellyfin is asked where the season sits (P4.FU10).
 */
const useNativeSeasonCovers = (container: Element | null, natives: NativeOrder, entryId: string) => {
    const [covers, setCovers] = useState<SeasonCover[]>([]);
    const latest = useRef(natives);
    latest.current = natives;
    const nativeKey = Array.from(natives).join(',');
    useLayoutEffect(() => {
        if (!container) return;
        const read = () => {
            const found: SeasonCover[] = [];
            for (const card of Array.from(container.children)) {
                if (card.classList.contains('jfmod-missingSlot')) continue;
                const season = latest.current.get(normalId(card.getAttribute('data-id') ?? ''));
                const cover = card.querySelector('.cardScalable');
                if (season !== undefined && cover) found.push([season, cover]);
                if (season !== undefined && season > 0 && card.getAttribute('data-jfmod-entry-id') !== entryId) {
                    card.setAttribute('data-jfmod-entry-id', entryId);
                    card.setAttribute('data-jfmod-season', String(season));
                }
            }
            setCovers(old => (sameCovers(old, found) ? old : found));
        };
        read();
        const observer = new MutationObserver(read);
        observer.observe(container, { childList: true });
        return () => observer.disconnect();
    }, [container, nativeKey, entryId]);
    return covers;
};

/**
 * The mark on one of upstream's own season cards (P1.FU17, user-approved 2026-10-12): Not Downloaded when none of the season's
 * episodes is on disk, whatever its watched state (Jellyfin keeps a season item for an empty folder and calls it played), the
 * Unaired clock when every episode is unaired with a date; nothing when one is on disk, or when the entry lists no episode of
 * that season. Specials are not offered, as for the missing seasons.
 */
const nativeSeasonMark = (season: number, episodes: EntryEpisode[]) => {
    const own = episodes.filter(episode => episode.seasonNumber === season);
    if (season <= 0 || !own.length || own.some(episode => episode.availability === 'onDisk')) return null;
    return seasonMark(own);
};

/**
 * The "N episodes" line on one of upstream's own season cards (P1.FU21), as the mod's missing season cards carry it: the episodes
 * Jellyfin has in the season (its `ChildCount`); for a season Jellyfin keeps with no episode (an empty folder), the entry's list,
 * as on the mod's cards. Nothing when neither knows of one.
 */
const nativeSeasonCount = (season: number, childCount: number | undefined, episodes: EntryEpisode[]) => {
    const own = episodes.filter(episode => episode.seasonNumber === season);
    if (!childCount) return own.length;
    // Jellyfin's count holds files and placeholders; the season page adds the mod's own rows (unaired episodes, ones with no
    // placeholder yet), so the line counts them too and reads as the page does (P1.FU27).
    return childCount + own.filter(episode => episode.availability !== 'onDisk' && !episode.placeholderItemId && !episode.jellyfinItemId).length;
};

/**
 * A second text line on an upstream card, after its title, in the mod's missing cards' own element and classes, so both read
 * the same. Upstream's season cards put their title straight in the card box after the cover (no `.cardFooter`); the line goes
 * last there, or in the footer where a card has one. It lives inside the card, so it goes with the card when upstream redraws it.
 */
const CardTextLine: FC<{ cover: Element; text: string }> = ({ cover, text }) => {
    const box = cover.parentElement;
    const footer = box && Array.from(box.children).find(child => child.classList.contains('cardFooter'));
    const parent = footer ?? box;
    // Marked by an attribute, not a `jfmod-` class: modFont.scss gives every `jfmod-` class the mod's font, and this line keeps
    // upstream's, as the mod cards' own line does.
    return parent ? createPortal(<div className='cardText cardTextCentered cardText-secondary' data-jfmod-count=''><bdi>{text}</bdi></div>, parent) : null;
};

/** The `#/details?entryId=…&season=N` route: the mod's page for a season Jellyfin does not have (P1.FU11). */
export const seasonPath = (entryId: string, season: number, serverId: string) => getEntryPath(entryId, serverId) + '&season=' + season;

/** The `#/details?entryId=…&season=N&episode=M` route: the mod's page for an episode Jellyfin does not have (P1.FU15). */
export const episodePath = (entryId: string, season: number, episode: number, serverId: string) =>
    seasonPath(entryId, season, serverId) + '&episode=' + episode;

interface SeasonCardsProps {
    api: Api;
    userId: string;
    serverId: string;
    view: HTMLElement;
    seriesItemId: string;
    detail: EntryDetail;
    canAcquire: boolean;
    onChanged: () => void;
}

/**
 * The native series page's Seasons row: one mod card per plugin season with no Jellyfin season item, the mark on upstream's
 * own season cards whose season has no file (P1.FU17), and their "N episodes" line (P1.FU21).
 */
export const MissingSeasonCards: FC<SeasonCardsProps> = ({ api, userId, serverId, view, seriesItemId, detail, canAcquire, onChanged }) => {
    const container = useChildrenContainer(view);
    // Started by the route with the page's entry (P1.FU16).
    const seasons = useQuery(nativeSeasonsQuery(api, userId, seriesItemId));
    const natives = useMemo<NativeOrder>(() => new Map((seasons.data ?? []).filter(item => item.Id && typeof item.IndexNumber === 'number')
        .map(item => [normalId(item.Id!), item.IndexNumber!])), [seasons.data]);
    const childCounts = useMemo(() => new Map((seasons.data ?? []).filter(item => typeof item.IndexNumber === 'number')
        .map(item => [item.IndexNumber!, item.ChildCount ?? 0])), [seasons.data]);
    const redraw = useCallback(() => (container ?
        redrawUpstreamChildren(container, { type: 'Series', itemId: seriesItemId, serverId }) : Promise.resolve()),
    [container, seriesItemId, serverId]);
    const heldIds = useHeldNatives(seasons.data, container, redraw);
    const missing = useMemo(() => (seasons.data ? missingSeasons(detail.episodes,
        new Set(Array.from(natives).filter(([id]) => heldIds.has(id)).map(([, season]) => season))) : []),
    [detail.episodes, heldIds, natives, seasons.data]);
    const slots = useMemo(() => missing.map(([season]) => ({ key: String(season), order: season })), [missing]);
    const make = useCallback((key: string) => {
        const tv = layoutManager.tv;
        const element = document.createElement(tv ? 'button' : 'div');
        element.className = resolveCardCssClasses({ shape: 'overflowPortrait', isTV: tv, isDesktop: layoutManager.desktop,
            enableFocusTransform: !browser.slow && !browser.edge, showChildCountIndicator: false, itemType: 'Season', tagName: 'div' })
            + ' jfmod-missingSlot jfmod-missingCard';
        element.dataset.jfmodSeason = key;
        // The season's download, if one of its episodes is on its way (integration/downloadMarks, P4.FU1).
        element.dataset.jfmodEntryId = detail.entry.id;
        if (tv) {
            (element as HTMLButtonElement).type = 'button';
            element.setAttribute('aria-label', 'Season ' + key);
            // Enter on the card opens the season's page; the mark inside takes its own clicks.
            element.addEventListener('click', () => {
                window.location.hash = '#' + seasonPath(detail.entry.id, Number(key), serverId);
            });
        }
        return element;
    }, [detail.entry.id, serverId]);
    const elements = useOrderedSlots(container, slots, natives, make);
    const covers = useNativeSeasonCovers(container, natives, detail.entry.id);
    const pickerFor = usePickerFor(api, detail, onChanged);
    // A season is searched as a pack, as on its own page: only where the plugin serves packs.
    const packs = usePluginCapabilities(api, canAcquire).includes(PACKS_CAPABILITY);
    const downloadFor = (season: number) => (canAcquire && packs ?
        { label: 'Download This Season', open: pickerFor({ seasonNumber: season }) } : null);
    return <>{missing.map(([season, episodes]) => {
        const element = elements.get(String(season));
        if (!element) return null;
        const posterPath = detail.entry.metadata?.seasons.find(candidate => candidate.number === season)?.posterPath;
        return createPortal(<MissingSeasonCard season={season} posterPath={posterPath} episodes={episodes} download={downloadFor(season)}
            href={'#' + seasonPath(detail.entry.id, season, serverId)} />, element, 'season:' + season);
    })}{covers.map(([season, cover]) => {
        const mark = nativeSeasonMark(season, detail.episodes);
        const count = nativeSeasonCount(season, childCounts.get(season), detail.episodes);
        return <React.Fragment key={'native:' + season}>
            {count > 0 && <CardTextLine cover={cover} text={episodesWord(count)} />}
            {/* No episode on disk: no Play on its hover, Get a Release in the centre for an administrator (P1.FU19). */}
            {mark && <>
                <NoFileCard cover={cover} />
                <CardMarkSlot cover={cover}>
                    <FileStateMark state={mark.state} airDate={mark.airDate} download={mark.state === 'missing' ? downloadFor(season) : null} />
                </CardMarkSlot>
            </>}
        </React.Fragment>;
    })}</>;
};

interface EpisodeRowProps {
    episode: EntryEpisode;
    /** TMDB's rating of the episode, from the series' metadata (P1.FU14). */
    rating?: number;
    download: MarkDownload | null;
}

/**
 * Upstream's meta items for an episode Jellyfin has no item for: the air date (in `airDate`'s format), its runtime format
 * ("42m", "1h 2m") and its star with one decimal (P1.FU14). Shared by the rows and the episode's page (P1.FU15).
 */
export const episodeMetaItems = (episode: EntryEpisode, rating: number | undefined, airDate: (date: string) => string = airDateLong) => [
    episode.airDate && <div className='mediaInfoItem' key='date'>{airDate(episode.airDate)}</div>,
    !!episode.runtimeMinutes && <div className='mediaInfoItem' key='runtime'>{datetime.getDisplayDuration(episode.runtimeMinutes * 600000000)}</div>,
    !!rating && <div className='starRatingContainer mediaInfoItem' key='rating'>
        <span className='material-icons starIcon star' aria-hidden='true' />{rating.toFixed(1)}
    </div>
].filter(Boolean);

/**
 * An episode with no Jellyfin item, drawn as upstream draws an episode row: TMDB's still (else a dashed 16:9 placeholder with
 * its number), "N. Title", the meta line (air date, runtime, rating), the overview, and the mark at the end. The row opens the
 * episode's page (P1.FU15); its title is the page's link for the keyboard.
 */
const MissingEpisodeRow: FC<EpisodeRowProps & { href: string }> = ({ episode, rating, download, href }) => {
    const mark = episodeMark(episode);
    const cover = useTmdbCover(episode.stillPath, layoutManager.tv ? 'w500' : 'w300');
    const meta = episodeMetaItems(episode, rating);
    return <>
        <div className={'listItemImage listItemImage-large jfmod-missingStill' + (cover ? '' : ' jfmod-missingEmpty')
            + (layoutManager.tv ? ' listItemImage-large-tv' : '')}>
            {cover ?? <span className='jfmod-missingNumber' aria-hidden='true'>{episode.episodeNumber}</span>}
        </div>
        <div className='listItemBody'>
            {layoutManager.tv ?
                <h2 className='listItemBodyText'><bdi>{episode.episodeNumber}. {episode.title}</bdi></h2> :
                <div className='listItemBodyText'><bdi><a className='jfmod-missingRowLink' href={href}>
                    {episode.episodeNumber}. {episode.title}</a></bdi></div>}
            {meta.length > 0 && <div className='secondary listItemBodyText jfmod-missingMeta'>{meta}</div>}
            {/* Upstream's own rule hides `listItem-overview` below 50em, so the phone shows none (design 2026-10-12). */}
            {episode.overview && <div className='secondary listItem-overview listItemBodyText'><bdi>{episode.overview}</bdi></div>}
        </div>
        {mark && <div className='jfmod-missingRowEnd'>
            <FileStateMark state={mark} airDate={episode.airDate} variant='row' download={mark === 'missing' ? download : null} />
        </div>}
    </>;
};

/** The plugin's episodes of one season that no Jellyfin episode stands for: not on disk, and no Jellyfin item at their number. */
const missingEpisodes = (episodes: EntryEpisode[], season: number, held: Set<number>, heldIds: Set<string>) => episodes
    .filter(episode => episode.seasonNumber === season && episode.availability !== 'onDisk' && !held.has(episode.episodeNumber)
        && !(episode.jellyfinItemId && heldIds.has(normalId(episode.jellyfinItemId))))
    .sort((a, b) => a.episodeNumber - b.episodeNumber);

/** One of upstream's rows that stands for a placeholder (P1.FU24), and the host for its mark before upstream's buttons. */
type PlaceholderRow = [itemId: string, host: HTMLElement];

const samePlaceholderRows = (a: PlaceholderRow[], b: PlaceholderRow[]) =>
    a.length === b.length && a.every(([id, host], index) => id === b[index][0] && host === b[index][1]);

/**
 * Upstream's rows of placeholder episodes (a media stub Jellyfin calls `IsPlaceHolder`, P1.FU24): each is marked
 * `data-jfmod-placeholder` (its Play and "Ends at" hidden, placeholderPage.scss) and gets a host for the mark at its end, just
 * before upstream's buttons, as a library list row's (P1.FU11). Found again whenever upstream redraws its list. Each is stamped
 * with its entry and episode, so its download is drawn with its first frame (P4.FU10).
 */
const usePlaceholderRows = (container: Element | null, placeholders: Map<string, EntryEpisode>) => {
    const [rows, setRows] = useState<PlaceholderRow[]>([]);
    const key = Array.from(placeholders, ([id, episode]) => id + ':' + episode.id).join(',');
    useLayoutEffect(() => {
        if (!container || !placeholders.size) {
            setRows(old => (old.length ? [] : old));
            return;
        }
        const read = () => {
            const found: PlaceholderRow[] = [];
            for (const row of Array.from(container.children)) {
                const id = normalId(row.getAttribute('data-id') ?? '');
                if (row.classList.contains('jfmod-missingSlot') || !placeholders.has(id)) continue;
                if (!row.hasAttribute('data-jfmod-placeholder')) row.setAttribute('data-jfmod-placeholder', '');
                const episode = placeholders.get(id)!;
                if (row.getAttribute('data-jfmod-episode-id') !== episode.id) {
                    row.setAttribute('data-jfmod-entry-id', episode.entryId);
                    row.setAttribute('data-jfmod-episode-id', episode.id);
                }
                const content = row.querySelector(':scope > .listItem-content') ?? row;
                let host = content.querySelector<HTMLElement>(':scope > .jfmod-rowMarkHost');
                if (!host) {
                    host = document.createElement('div');
                    host.className = 'jfmod-rowMarkHost';
                    content.insertBefore(host, content.querySelector(':scope > .listViewUserDataButtons'));
                }
                found.push([id, host]);
            }
            setRows(old => (samePlaceholderRows(old, found) ? old : found));
        };
        read();
        const observer = new MutationObserver(read);
        observer.observe(container, { childList: true });
        return () => observer.disconnect();
    // `placeholders` is read through its key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [container, key]);
    return rows;
};

interface EpisodeRowsProps {
    api: Api;
    userId: string;
    view: HTMLElement;
    detail: EntryDetail;
    season: number;
    /** The native season page's series and season items; absent on the mod's own season page, which has no upstream rows. */
    native?: { seriesItemId: string; seasonItemId: string };
    serverId: string;
    canAcquire: boolean;
    onChanged: () => void;
}

/** A season page's episode list: one mod row per plugin episode with no Jellyfin episode, in episode order. */
export const MissingEpisodeRows: FC<EpisodeRowsProps> = ({ api, userId, view, detail, season, native, serverId, canAcquire, onChanged }) => {
    const container = useChildrenContainer(view);
    // Started by the route with the page's entry (P1.FU16).
    const jellyfin = useQuery({ ...nativeEpisodesQuery(api, userId, native?.seriesItemId ?? '', native?.seasonItemId ?? ''),
        enabled: !!native });
    const ready = !native || !!jellyfin.data;
    const natives = useMemo<NativeOrder>(() => new Map((jellyfin.data ?? []).filter(item => item.Id && typeof item.IndexNumber === 'number')
        .map(item => [normalId(item.Id!), item.IndexNumber!])), [jellyfin.data]);
    const seasonItemId = native?.seasonItemId;
    const seriesItemId = native?.seriesItemId;
    const redraw = useCallback(() => (container && seasonItemId ? redrawUpstreamChildren(container,
        { type: 'Season', itemId: seasonItemId, seriesId: seriesItemId, serverId }) : Promise.resolve()),
    [container, seasonItemId, seriesItemId, serverId]);
    const counted = useHeldNatives(native ? jellyfin.data : undefined, container, redraw);
    const missing = useMemo(() => {
        if (!ready) return [];
        const held = new Set<number>();
        for (const item of jellyfin.data ?? []) {
            if (typeof item.IndexNumber !== 'number' || !item.Id || !counted.has(normalId(item.Id))) continue;
            // A file with several episodes holds every number it spans.
            for (let number = item.IndexNumber; number <= (item.IndexNumberEnd ?? item.IndexNumber); number++) held.add(number);
        }
        return missingEpisodes(detail.episodes, season, held, counted);
    }, [counted, detail.episodes, jellyfin.data, ready, season]);
    const slots = useMemo(() => missing.map(episode => ({ key: episode.id, order: episode.episodeNumber })), [missing]);
    // Upstream's placeholder rows (P1.FU24): the plugin's episode each stands for, by its placeholder id, else by its number.
    const placeholderEpisodes = useMemo(() => {
        const byId = new Map<string, EntryEpisode>();
        for (const item of jellyfin.data ?? []) {
            if (!item.Id || !item.IsPlaceHolder) continue;
            const episode = detail.episodes.find(candidate => sameItemId(candidate.placeholderItemId, item.Id))
                ?? detail.episodes.find(candidate => candidate.seasonNumber === season && candidate.episodeNumber === item.IndexNumber);
            if (episode && episode.availability !== 'onDisk') byId.set(normalId(item.Id), episode);
        }
        return byId;
    }, [detail.episodes, jellyfin.data, season]);
    const placeholderRows = usePlaceholderRows(container, placeholderEpisodes);
    // The whole row opens the episode's page (P1.FU15), as upstream's rows open theirs: on the TV the row is a button, a focus
    // stop like upstream's, and its administrator's icon a second one; elsewhere a click anywhere on it, except on the icon
    // (which stops its own click) or the title's link (which follows itself).
    const hrefs = useRef(new Map<string, string>());
    hrefs.current = new Map(missing.map(episode => [episode.id,
        '#' + episodePath(detail.entry.id, episode.seasonNumber, episode.episodeNumber, serverId)]));
    const make = useCallback((key: string) => {
        const tv = layoutManager.tv;
        const element = document.createElement(tv ? 'button' : 'div');
        element.className = 'listItem listItem-largeImage jfmod-missingSlot jfmod-missingRow'
            + (tv ? ' listItem-button listItem-focusscale' : '');
        if (tv) (element as HTMLButtonElement).type = 'button';
        element.dataset.jfmodEpisodeId = key;
        element.dataset.jfmodEntryId = detail.entry.id;
        element.addEventListener('click', event => {
            const href = hrefs.current.get(key);
            if (!href || (event.target as Element | null)?.closest('a')) return;
            window.location.hash = href;
        });
        return element;
    }, [detail.entry.id]);
    const elements = useOrderedSlots(container, slots, natives, make);
    const pickerFor = usePickerFor(api, detail, onChanged);
    return <>{placeholderRows.map(([itemId, host]) => {
        const episode = placeholderEpisodes.get(itemId);
        const mark = episode && episodeMark(episode);
        if (!episode || !mark) return null;
        const download = canAcquire && mark === 'missing' ? { label: `Get a Release for Episode ${episode.episodeNumber}, ${episode.title}`,
            open: pickerFor({ episodeId: episode.id }) } : null;
        return createPortal(<FileStateMark state={mark} airDate={episode.airDate} variant='row' download={download} />, host,
            'placeholder:' + itemId);
    })}{missing.map(episode => {
        const element = elements.get(episode.id);
        if (!element) return null;
        // The row's mark is the administrator's button (P1.FU22), named for its episode; its tooltip stays *Not Downloaded*.
        const download = canAcquire ? { label: `Get a Release for Episode ${episode.episodeNumber}, ${episode.title}`,
            open: pickerFor({ episodeId: episode.id }) } : null;
        if (layoutManager.tv) element.setAttribute('aria-label', `${episode.episodeNumber}. ${episode.title}`);
        return createPortal(<MissingEpisodeRow episode={episode} rating={detail.entry.metadata?.episodeRatings?.[episode.tmdbId]}
            download={download} href={hrefs.current.get(episode.id) ?? '#'} />, element, 'episode:' + episode.id);
    })}</>;
};
