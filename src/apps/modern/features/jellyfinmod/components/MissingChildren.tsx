import type { Api } from '@jellyfin/sdk/lib/api';
import { getShowApi } from '@jellyfin/sdk/lib/utils/api/show-api';
import { useQuery } from '@tanstack/react-query';
import React, { type FC, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { resolveCardCssClasses } from 'components/cardbuilder/utils/builder';
import layoutManager from 'components/layoutManager';
import browser from 'scripts/browser';

import type { EntryDetail } from '../api/modApi';
import { PACKS_CAPABILITY, usePluginCapabilities } from '../hooks/useAcquisition';
import { airDateLong, episodeMark, seasonMark } from '../constants/fileState';
import { openReleasePicker } from '../integration/releasePicker';
import { restoreFocusTo } from '../integration/stockHeaderButton';
import type { EntryEpisode } from '../types/entry';
import { getEntryPath } from '../utils/entryLinks';
import FileStateMark, { type MarkDownload } from './FileStateMark';

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
            for (const slot of [...latest.current.slots].sort((a, b) => a.order - b.order)) {
                const element = own.get(slot.key);
                if (!element) continue;
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

interface SeasonCardProps {
    season: number;
    episodes: EntryEpisode[];
    href: string;
    download: MarkDownload | null;
}

/** A season with no Jellyfin item: a dashed placeholder with its number, the mark top right, the stock card's footer lines. */
const MissingSeasonCard: FC<SeasonCardProps> = ({ season, episodes, href, download }) => {
    const mark = seasonMark(episodes);
    const poster = <span className='jfmod-missingNumber' aria-hidden='true'>{season}</span>;
    return <div className='cardBox cardBox-bottompadded'>
        <div className='cardScalable'>
            <div className='cardPadder cardPadder-overflowPortrait' />
            {layoutManager.tv ?
                <div className='cardImageContainer cardContent jfmod-missingPoster'>{poster}</div> :
                <a className='cardImageContainer cardContent jfmod-missingPoster' href={href} aria-label={'Season ' + season}>{poster}</a>}
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

/** The `#/details?entryId=…&season=N` route: the mod's page for a season Jellyfin does not have (P1.FU11). */
export const seasonPath = (entryId: string, season: number, serverId: string) => getEntryPath(entryId, serverId) + '&season=' + season;

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

/** The native series page's Seasons row: one mod card per plugin season with no Jellyfin season item. */
export const MissingSeasonCards: FC<SeasonCardsProps> = ({ api, userId, serverId, view, seriesItemId, detail, canAcquire, onChanged }) => {
    const container = useChildrenContainer(view);
    const seasons = useQuery({
        queryKey: ['JellyfinMod', api.basePath, userId, 'NativeSeasons', seriesItemId],
        queryFn: async ({ signal }) => (await getShowApi(api).getSeasons({ seriesId: seriesItemId, userId }, { signal })).data.Items ?? [],
        retry: false
    });
    const natives = useMemo<NativeOrder>(() => new Map((seasons.data ?? []).filter(item => item.Id && typeof item.IndexNumber === 'number')
        .map(item => [normalId(item.Id!), item.IndexNumber!])), [seasons.data]);
    const missing = useMemo(() => (seasons.data ? missingSeasons(detail.episodes, new Set(natives.values())) : []),
        [detail.episodes, natives, seasons.data]);
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
    const pickerFor = usePickerFor(api, detail, onChanged);
    // A season is searched as a pack, as on its own page: only where the plugin serves packs.
    const packs = usePluginCapabilities(api, canAcquire).includes(PACKS_CAPABILITY);
    return <>{missing.map(([season, episodes]) => {
        const element = elements.get(String(season));
        if (!element) return null;
        const download = canAcquire && packs ? { label: 'Download This Season', open: pickerFor({ seasonNumber: season }) } : null;
        return createPortal(<MissingSeasonCard season={season} episodes={episodes} download={download}
            href={'#' + seasonPath(detail.entry.id, season, serverId)} />, element, 'season:' + season);
    })}</>;
};

interface EpisodeRowProps {
    episode: EntryEpisode;
    download: MarkDownload | null;
}

/** An episode with no Jellyfin item: a dashed 16:9 placeholder with its number, the title, the air date, the overview, the mark. */
const MissingEpisodeRow: FC<EpisodeRowProps> = ({ episode, download }) => {
    const mark = episodeMark(episode);
    return <>
        <div className={'listItemImage listItemImage-large jfmod-missingStill' + (layoutManager.tv ? ' listItemImage-large-tv' : '')}>
            <span className='jfmod-missingNumber' aria-hidden='true'>{episode.episodeNumber}</span>
        </div>
        <div className='listItemBody'>
            {layoutManager.tv ?
                <h2 className='listItemBodyText'><bdi>{episode.episodeNumber}. {episode.title}</bdi></h2> :
                <div className='listItemBodyText'><bdi>{episode.episodeNumber}. {episode.title}</bdi></div>}
            {episode.airDate && <div className='secondary listItemBodyText'><bdi>{airDateLong(episode.airDate)}</bdi></div>}
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

interface EpisodeRowsProps {
    api: Api;
    userId: string;
    view: HTMLElement;
    detail: EntryDetail;
    season: number;
    /** The native season page's series and season items; absent on the mod's own season page, which has no upstream rows. */
    native?: { seriesItemId: string; seasonItemId: string };
    canAcquire: boolean;
    onChanged: () => void;
}

/** A season page's episode list: one mod row per plugin episode with no Jellyfin episode, in episode order. */
export const MissingEpisodeRows: FC<EpisodeRowsProps> = ({ api, userId, view, detail, season, native, canAcquire, onChanged }) => {
    const container = useChildrenContainer(view);
    const jellyfin = useQuery({
        queryKey: ['JellyfinMod', api.basePath, userId, 'NativeEpisodes', native?.seasonItemId],
        queryFn: async ({ signal }) => (await getShowApi(api).getEpisodes({ seriesId: native!.seriesItemId, seasonId: native!.seasonItemId,
            userId }, { signal })).data.Items ?? [],
        enabled: !!native,
        retry: false
    });
    const ready = !native || !!jellyfin.data;
    const natives = useMemo<NativeOrder>(() => new Map((jellyfin.data ?? []).filter(item => item.Id && typeof item.IndexNumber === 'number')
        .map(item => [normalId(item.Id!), item.IndexNumber!])), [jellyfin.data]);
    const missing = useMemo(() => {
        if (!ready) return [];
        const held = new Set<number>();
        for (const item of jellyfin.data ?? []) {
            if (typeof item.IndexNumber !== 'number') continue;
            // A file with several episodes holds every number it spans.
            for (let number = item.IndexNumber; number <= (item.IndexNumberEnd ?? item.IndexNumber); number++) held.add(number);
        }
        const heldIds = new Set((jellyfin.data ?? []).flatMap(item => (item.Id ? [normalId(item.Id)] : [])));
        return missingEpisodes(detail.episodes, season, held, heldIds);
    }, [detail.episodes, jellyfin.data, ready, season]);
    const slots = useMemo(() => missing.map(episode => ({ key: episode.id, order: episode.episodeNumber })), [missing]);
    const make = useCallback((key: string) => {
        const element = document.createElement('div');
        element.className = 'listItem listItem-largeImage jfmod-missingSlot jfmod-missingRow';
        element.dataset.jfmodEpisodeId = key;
        element.dataset.jfmodEntryId = detail.entry.id;
        return element;
    }, [detail.entry.id]);
    const elements = useOrderedSlots(container, slots, natives, make);
    const pickerFor = usePickerFor(api, detail, onChanged);
    return <>{missing.map(episode => {
        const element = elements.get(episode.id);
        if (!element) return null;
        const download = canAcquire ? { label: 'Download This Episode', open: pickerFor({ episodeId: episode.id }) } : null;
        return createPortal(<MissingEpisodeRow episode={episode} download={download} />, element, 'episode:' + episode.id);
    })}</>;
};
