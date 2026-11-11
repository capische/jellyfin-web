import type { Api } from '@jellyfin/sdk/lib/api';
import type { BaseItemDto, BaseItemPerson } from '@jellyfin/sdk/lib/generated-client';
import { ItemFields } from '@jellyfin/sdk/lib/generated-client/models/item-fields';
import { getShowApi } from '@jellyfin/sdk/lib/utils/api/show-api';
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api';
import { useQuery } from '@tanstack/react-query';
import React, { type FC, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { playbackManager } from 'components/playback/playbackmanager';
import datetime from 'scripts/datetime';
import globalize from 'lib/globalize';
import { useApi } from 'hooks/useApi';
import { entryDetailQuery, entryIdQuery } from '../hooks/useEntries';
import { RELEASES_CAPABILITY, usePluginCapabilities } from '../hooks/useAcquisition';
import { openReleasePicker } from '../integration/releasePicker';
import { restoreFocusTo } from '../integration/stockHeaderButton';
import { sameItemId } from '../constants/versions';
import { getTmdbImage, selectedEpisodeParam } from '../utils/entryLinks';
import { type EntryEpisode, FileState } from '../types/entry';
import { BrowseCell } from './BrowsePage';
import { Icon, Cloud } from './Icon';
import { Menu } from './Menu';
import { Poster } from './Poster';
import { DownloadMark } from './StateMark';
import { ProgressDisc, discState } from './ProgressDisc';
import { downloadProgress, type DownloadProgress, isUnderWay } from '../constants/queue';
import { currentRowFor, packEpisodeView, useQueue, useQueueCapability } from '../hooks/useQueue';
import { TitleRow } from './TitleRow';

/** One card of the series page's slider (ds.t14): Jellyfin's episode, the plugin's episode, or both. */
export interface SeriesEpisode {
    key: string;
    season: number;
    number: number | null;
    title: string;
    ticks?: number | null;
    rating?: number | null;
    image?: string;
    item?: BaseItemDto;
    entryEpisode?: EntryEpisode;
    played: boolean;
    progress?: number;
    hasFile: boolean;
    /** The air date words of an episode not aired yet ("14 Nov", with the year when it is not this one). */
    airs?: string;
}

/** An episode's chosen file and stream indexes (Jellyfin's `MediaStream.Index`; -1 is subtitles off); unset is the file's default. */
export interface EpisodeTracks {
    key: string;
    source?: string;
    audio?: number;
    subtitle?: number;
}

const seasonRank = (season: number) => (season > 0 ? season : 100000);
const order = (a: SeriesEpisode, b: SeriesEpisode) => seasonRank(a.season) - seasonRank(b.season) || (a.number ?? 0) - (b.number ?? 0);

const airsLabel = (date: string | null | undefined) => {
    if (!date) return undefined;
    const when = new Date(date);
    if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) return undefined;
    const year = when.getFullYear() !== new Date().getFullYear();
    return when.toLocaleDateString(globalize.getCurrentDateTimeLocale(), { day: 'numeric', month: 'short', year: year ? 'numeric' : undefined });
};

const nativeImage = (basePath: string, item: BaseItemDto) => (item.Id && item.ImageTags?.Primary ?
    `${basePath}/Items/${encodeURIComponent(item.Id)}/Images/Primary?fillWidth=640&quality=90&tag=${encodeURIComponent(item.ImageTags.Primary)}` : undefined);

const matches = (episode: EntryEpisode, item: BaseItemDto) => [episode.jellyfinItemId, episode.placeholderItemId, episode.playableItemId]
    .some(id => sameItemId(id, item.Id)) || (episode.seasonNumber === item.ParentIndexNumber && episode.episodeNumber === item.IndexNumber);

/** Jellyfin's episodes, joined to the plugin's list where the series has an entry: its file state, air dates and missing episodes. */
const mergeEpisodes = (basePath: string, items: BaseItemDto[], entryEpisodes: EntryEpisode[] | undefined): SeriesEpisode[] => {
    const left = new Set(entryEpisodes ?? []);
    const merged: SeriesEpisode[] = items.map(item => {
        const entryEpisode = entryEpisodes?.find(candidate => left.has(candidate) && matches(candidate, item));
        if (entryEpisode) left.delete(entryEpisode);
        const nativeFile = item.LocationType !== 'Virtual' && !item.IsPlaceHolder;
        const hasFile = entryEpisode ? entryEpisode.availability === 'onDisk' : nativeFile;
        const position = item.UserData?.PlaybackPositionTicks ?? 0;
        return { key: item.Id ?? String(item.IndexNumber), season: item.ParentIndexNumber ?? 0, number: item.IndexNumber ?? null,
            title: item.Name ?? '', ticks: item.RunTimeTicks, rating: item.CommunityRating, image: nativeImage(basePath, item), item, entryEpisode,
            played: !!item.UserData?.Played, progress: !item.UserData?.Played && position && item.RunTimeTicks ? 100 * position / item.RunTimeTicks : undefined,
            hasFile, airs: hasFile ? undefined : airsLabel(entryEpisode?.airDate ?? item.PremiereDate) };
    });
    // TMDB's specials Jellyfin does not have stay out, as on the stock page (Peep Show lists 45 of them).
    for (const episode of Array.from(left).filter(candidate => candidate.seasonNumber > 0)) {
        merged.push({ key: 'entry:' + episode.id, season: episode.seasonNumber, number: episode.episodeNumber, title: episode.title,
            ticks: episode.runtimeMinutes ? episode.runtimeMinutes * 600000000 : null, image: getTmdbImage(episode.stillPath, 'w500'),
            entryEpisode: episode, played: false, hasFile: episode.availability === 'onDisk', airs: airsLabel(episode.airDate) });
    }
    return merged.sort(order);
};

/** The first episode not watched yet, aired and not a special; the first episode when every one is watched. */
const firstUnwatched = (episodes: SeriesEpisode[]) => {
    const index = episodes.findIndex(episode => !episode.played && !episode.airs && episode.season > 0);
    return index < 0 ? 0 : index;
};

/** The series page's episodes, the selected one, and what its main button does (title-pages.md, ds.t14). */
export const useSeriesEpisodes = (series?: BaseItemDto) => {
    const { api, user } = useApi();
    const userId = user?.Id ?? '';
    const seriesId = series?.Type === 'Series' ? series.Id ?? '' : '';
    const enabled = !!api && !!userId && !!seriesId;
    const natives = useQuery({
        queryKey: ['JellyfinMod', api?.basePath, userId, 'SeriesEpisodes', seriesId],
        queryFn: async ({ signal }) => (await getShowApi(api!).getEpisodes({ seriesId, userId, fields: [ItemFields.PrimaryImageAspectRatio] }, { signal })).data.Items ?? [],
        enabled, staleTime: 2000, retry: false
    });
    // useApi has no api for a moment after sign-in: the queries wait (`enabled`), keyed on a stand-in until then.
    const keyApi = api ?? ({ basePath: '' } as Api);
    const entryId = useQuery({ ...entryIdQuery(keyApi, userId, seriesId), enabled }).data ?? '';
    const detail = useQuery({ ...entryDetailQuery(keyApi, userId, entryId), enabled: enabled && !!entryId });
    const capabilities = usePluginCapabilities(api, enabled);
    const canAcquire = !!user?.Policy?.IsAdministrator && capabilities.includes(RELEASES_CAPABILITY) && !!detail.data;
    const episodes = useMemo(() => (natives.data && api ? mergeEpisodes(api.basePath, natives.data, detail.data?.episodes) : []),
        [api, natives.data, detail.data?.episodes]);
    // Opened from an episode on Home, that episode starts selected (`seriesEpisodePath`).
    const [chosen, setChosen] = useState<string | undefined>(selectedEpisodeParam);
    useEffect(() => setChosen(selectedEpisodeParam()), [seriesId]);
    let selectedIndex = episodes.findIndex(episode => episode.key === chosen);
    if (selectedIndex < 0) selectedIndex = firstUnwatched(episodes);
    const selected = episodes[selectedIndex] as SeriesEpisode | undefined;
    // The file, audio and subtitles chosen for an episode on the computer's controls (ds.t19); Play sends them as a title page does.
    const [tracks, setTracks] = useState<EpisodeTracks>();
    const play = useCallback((episode: SeriesEpisode) => {
        if (!episode.item?.Id) return;
        const picked = tracks?.key === episode.key ? tracks : undefined;
        playbackManager.play({ ids: [episode.item.Id], serverId: series?.ServerId,
            startPositionTicks: episode.progress ? episode.item.UserData?.PlaybackPositionTicks ?? 0 : undefined,
            mediaSourceId: picked?.source, audioStreamIndex: picked?.audio, subtitleStreamIndex: picked?.subtitle }).catch(console.error);
    }, [series?.ServerId, tracks]);
    const refetch = detail.refetch;
    const download = useCallback((episode: SeriesEpisode, opener: HTMLElement) => {
        const data = detail.data;
        if (!api || !data || !episode.entryEpisode) return;
        openReleasePicker({ api, entryId: data.entry.id, title: data.entry.title, mediaType: data.entry.mediaType, episodes: data.episodes,
            episodeId: episode.entryEpisode.id, episodePage: true, episodeListLoaded: data.episodeListLoaded,
            onChanged: () => { refetch().catch(() => undefined); } })
            .then(() => restoreFocusTo(opener), () => restoreFocusTo(opener));
    }, [api, detail.data, refetch]);
    // The series page's main button follows the selection; Get Another Quality only beside Play (the user, 2026-11-07).
    return { episodes, selected, selectedIndex, select: setChosen, play, download, canAcquire, active: episodes.length > 0, showsPlay: !!selected?.hasFile,
        tracks, setTracks };
};
export type SeriesModel = ReturnType<typeof useSeriesEpisodes>;

/** The series page's main button, first in the pill: Play, Download for an episode with no file, or the air date. */
export const SeriesMainButton: FC<{ series: SeriesModel }> = ({ series }) => {
    const episode = series.selected;
    if (!episode) return null;
    if (episode.airs) {
        return <button type='button' className='play off focusable' aria-disabled='true' aria-label={'Airs ' + episode.airs}><Icon name='clock' />Airs {episode.airs}</button>;
    }
    if (!episode.hasFile) {
        if (!series.canAcquire) return null;
        return <button type='button' className='play mainb epb focusable' aria-label={episodeLabel('Download', episode)}
            onClick={event => series.download(episode, event.currentTarget)}><Cloud /><EpisodeCopy word='Download' episode={episode} /></button>;
    }
    return <button type='button' className='play epb focusable' aria-label={episodeLabel('Play', episode)} onClick={() => series.play(episode)}>
        <Icon name='play' /><EpisodeCopy word='Play' episode={episode} /></button>;
};

const seasonName = (season: number) => (season > 0 ? 'Season ' + season : 'Specials');
/** An episode's own name; none when the show only numbers them ("Episode 3"). */
const ownTitle = (episode: SeriesEpisode) => (/^\s*(episode|ep\.?)\s*\d+\s*$/i.test(episode.title) ? '' : episode.title.trim());
const episodeWords = (word: string, episode: SeriesEpisode) => (episode.number == null ? word : `${word} Episode ${episode.number}`);
const episodeLabel = (word: string, episode: SeriesEpisode) => [episodeWords(word, episode), ownTitle(episode)].filter(Boolean).join(', ');

/**
 * The main button's words in two rows (the user, 2026-11-08): the action and number, then the season and runtime. The episode's
 * own name is on its card in the rail, so here it is only the hover hint. A hidden "… Episode 88" sets the width, so the
 * button holds still from episode to episode.
 */
const EpisodeCopy: FC<{ word: string; episode: SeriesEpisode }> = ({ word, episode }) => {
    const runtime = episode.ticks ? datetime.getDisplayDuration(episode.ticks) : '';
    return <span className='epc' title={ownTitle(episode) || undefined}>
        <b>{episodeWords(word, episode)}</b>
        <span className='ghost' aria-hidden='true'>{word} Episode 88</span>
        <span className='sm f'>{seasonName(episode.season)}{runtime && ' · ' + runtime}</span>
    </span>;
};

/** A file is on its way: the card's progress ring says so (the user, 2026-11-07, ds.t16); no Download meanwhile. */
const inFlight = (episode: SeriesEpisode) => [FileState.Searching, FileState.Grabbed, FileState.Downloading].includes(episode.entryEpisode?.state ?? FileState.None);

/**
 * Each episode's download as the queue says (read every 3 s while one is on its way, the cards' own reads): its own file of a
 * pack, or its own row. A failed one too; one in the library (seeding) or not in the queue has none.
 */
const useEpisodeDownloads = (episodes: SeriesEpisode[]) => {
    const capability = useQueueCapability();
    const watching = episodes.some(inFlight);
    const queue = useQueue({ enabled: capability.available && watching, poll: 'cards' });
    const items = queue.data?.items;
    return useMemo(() => {
        const found = new Map<string, DownloadProgress>();
        if (!items || !watching) return found;
        for (const episode of episodes) {
            const own = episode.entryEpisode;
            if (!own || episode.hasFile || !inFlight(episode)) continue;
            const row = currentRowFor(items, own.entryId, own.id);
            const view = row && (row.pack ? packEpisodeView(row, own.id) : row);
            if (view && (isUnderWay(view) || view.state === 'failed' || view.state === 'blocked')) found.set(episode.key, downloadProgress(view));
        }
        return found;
    }, [items, episodes, watching]);
};

const EpisodeCard: FC<{ episode: SeriesEpisode; selected: boolean; boundary: boolean; onSelect: () => void; onDownload?: (opener: HTMLElement) => void; download?: DownloadProgress }> = ({ episode, selected, boundary, onSelect, onDownload, download }) => {
    const runtime = episode.ticks ? datetime.getDisplayDuration(episode.ticks) : '';
    const moving = !!download && download.kind !== 'failed';
    return <div role='button' tabIndex={0} aria-pressed={selected} data-season={episode.season}
        aria-label={`S${episode.season}:E${episode.number ?? ''} ${episode.title}`}
        className={'cell w focusable ecard' + (onDownload ? ' act' : '') + (selected ? ' sel' : '') + (boundary ? ' sfirst' : '') + (download ? ' jfmod-pdOn' : '')}
        onClick={onSelect} onKeyDown={event => { if (event.key === 'Enter') onSelect(); }}>
        <div className='tile'><Poster src={episode.image} icon='tv'>
            <span className='corner'>
                {episode.played && <span className='pill2 tick'><Icon name='check' /></span>}
                {episode.airs && <span className='cmark glassy air'>Airs {episode.airs}</span>}
                {moving && <span className='cmark glassy' data-ds-download=''><DownloadMark progress={download} size='card' /></span>}
                {!episode.airs && !episode.hasFile && !moving && <span className='cmark glassy' data-ds-state-kind='not-downloaded' title='Not Downloaded'><DownloadMark kind='not-downloaded' size='card' /></span>}
            </span>
            <ProgressDisc state={download ? discState(download) : null} />
            {!!episode.progress && <span className='prog'><i style={{ width: episode.progress + '%' }} /></span>}
            {onDownload && <button type='button' className='disc hov glassy focusable' data-ds-primary-action='get' aria-label={'Download ' + episode.title}
                onClick={event => {
                    event.stopPropagation();
                    onDownload(event.currentTarget);
                }}><Cloud /></button>}
        </Poster>
        <div className='capt'><div className='ln t'>{episode.number != null && episode.number + '. '}{episode.title}</div>
            <div className='ln d'>{runtime && <span>{runtime}</span>}{runtime && !!episode.rating && <span className='bullet' aria-hidden='true'>•</span>}
                {!!episode.rating && <span className='star'><Icon name='star' />{episode.rating.toFixed(1)}</span>}</div></div>
        </div>
    </div>;
};

/** The season of the first card wholly in view at the strip's left edge. */
const seasonAtEdge = (strip: HTMLElement) => {
    const edge = strip.scrollLeft + parseFloat(getComputedStyle(strip).paddingLeft) - 1;
    const cards = Array.from(strip.children) as HTMLElement[];
    const card = cards.find(node => node.offsetLeft >= edge) ?? cards[cards.length - 1];
    return card ? Number(card.dataset.season) : undefined;
};

/**
 * One continuous slider of every episode, with a season pill that follows the scroll and jumps to a season (the user, 2026-11-07,
 * mockup reviews/title-golden/series.html). A season's first card has a wider gap before it; clicking a card selects it.
 */
export const EpisodeStrip: FC<{ series: SeriesModel }> = ({ series }) => {
    const strip = useRef<HTMLDivElement>(null);
    const pill = useRef<HTMLButtonElement>(null);
    const [season, setSeason] = useState<number>();
    const [open, setOpen] = useState(false);
    const [ends, setEnds] = useState({ start: true, end: true });
    const { episodes, selectedIndex } = series;
    const downloads = useEpisodeDownloads(episodes);
    const seasons = useMemo(() => [...new Set(episodes.map(episode => episode.season))]
        .map(number => ({ number, count: episodes.filter(episode => episode.season === number).length })), [episodes]);
    const sync = useCallback(() => {
        const node = strip.current;
        if (!node) return;
        setSeason(seasonAtEdge(node));
        setEnds({ start: node.scrollLeft <= 1, end: node.scrollLeft >= node.scrollWidth - node.clientWidth - 1 });
    }, []);
    // The selected card opens second, its previous episode at the left edge; once per series.
    const placed = useRef('');
    const first = episodes[0]?.key ?? '';
    useLayoutEffect(() => {
        const node = strip.current;
        if (!node || !first || placed.current === first) return;
        placed.current = first;
        const card = node.children[Math.max(0, selectedIndex - 1)] as HTMLElement | undefined;
        node.scrollLeft = card ? card.offsetLeft - parseFloat(getComputedStyle(node).paddingLeft) : 0;
        sync();
    }, [first, selectedIndex, sync]);
    useEffect(() => {
        window.addEventListener('resize', sync);
        return () => window.removeEventListener('resize', sync);
    }, [sync]);
    const page = (step: number) => {
        const node = strip.current;
        const cards = node?.children;
        if (!node || !cards || cards.length < 2) return;
        const pitch = (cards[1] as HTMLElement).offsetLeft - (cards[0] as HTMLElement).offsetLeft;
        const pad = parseFloat(getComputedStyle(node).paddingLeft);
        node.scrollBy({ left: step * Math.max(1, Math.floor((node.clientWidth - 2 * pad) / pitch)) * pitch, behavior: 'smooth' });
    };
    const jump = (number: number) => {
        const node = strip.current;
        const card = node?.querySelector<HTMLElement>(`[data-season="${number}"]`);
        if (!node || !card) return;
        node.scrollTo({ left: card.offsetLeft - parseFloat(getComputedStyle(node).paddingLeft), behavior: 'smooth' });
        setSeason(number);
    };
    // A card selected while partly off the strip slides to its left edge, whole (the user, 2026-11-10).
    const choose = (index: number) => {
        series.select(episodes[index].key);
        const node = strip.current;
        const card = node?.children[index] as HTMLElement | undefined;
        if (!node || !card) return;
        const pad = parseFloat(getComputedStyle(node).paddingLeft);
        const hidden = card.offsetLeft < node.scrollLeft + pad || card.offsetLeft + card.offsetWidth > node.scrollLeft + node.clientWidth - pad;
        if (hidden) node.scrollTo({ left: card.offsetLeft - pad, behavior: 'smooth' });
    };
    const close = useCallback(() => setOpen(false), []);
    if (!episodes.length) return null;
    const shown = season ?? episodes[0].season;
    return <div className='sect plain estrip' data-ds-section='episodes'>
        <div className='etop'>
            <button ref={pill} type='button' className='spill glassy focusable' aria-haspopup='menu' aria-expanded={open} onClick={() => setOpen(!open)}>
                {seasonName(shown)}<Icon name='down' /></button>
            <div className='actbar static glassy arrows'>
                <button type='button' className={'dbtn focusable' + (ends.start ? ' off' : '')} disabled={ends.start} aria-label='Previous' onClick={() => page(-1)}><Icon name='prev' /></button>
                <button type='button' className={'dbtn focusable' + (ends.end ? ' off' : '')} disabled={ends.end} aria-label='Next' onClick={() => page(1)}><Icon name='nextp' /></button>
            </div>
        </div>
        {open && pill.current && <Menu close={close} label='Seasons' anchor={pill.current} anchored>
            {seasons.map(item => <button type='button' key={item.number} className={'mi focusable' + (item.number === shown ? ' sel' : '')} onClick={() => {
                close();
                jump(item.number);
            }}>{seasonName(item.number)}<span className='sub'>{item.count} episodes</span></button>)}
        </Menu>}
        <div ref={strip} className='erail' onScroll={sync}>
            {episodes.map((episode, index) => <EpisodeCard key={episode.key} episode={episode} selected={index === selectedIndex}
                boundary={index > 0 && episodes[index - 1].season !== episode.season} onSelect={() => choose(index)}
                onDownload={series.canAcquire && !episode.hasFile && !episode.airs && episode.entryEpisode && !inFlight(episode) ?
                    opener => series.download(episode, opener) : undefined} download={downloads.get(episode.key)} />)}
        </div>
    </div>;
};

const personImage = (basePath: string, person: BaseItemPerson) => (person.Id && person.PrimaryImageTag ?
    `${basePath}/Items/${encodeURIComponent(person.Id)}/Images/Primary?fillWidth=240&quality=90&tag=${encodeURIComponent(person.PrimaryImageTag)}` : undefined);

/** The selected episode's guest stars: Jellyfin's people when it has the episode, else the plugin's TMDB credits. */
export const GuestStars: FC<{ series: SeriesModel; serverId?: string | null }> = ({ series, serverId }) => {
    const { api, user } = useApi();
    const episode = series.selected;
    const itemId = episode?.item?.Id ?? '';
    const people = useQuery({
        queryKey: ['JellyfinMod', api?.basePath, user?.Id, 'EpisodePeople', itemId],
        queryFn: async ({ signal }) => (await getLibraryApi(api!).getItem({ itemId, userId: user?.Id }, { signal })).data.People ?? [],
        enabled: !!api && !!user?.Id && !!itemId, staleTime: 60000, retry: false
    });
    if (!episode || !api) return null;
    const native = (people.data ?? []).filter(person => person.Type === 'GuestStar').map(person => ({ key: person.Id ?? person.Name ?? '',
        name: person.Name ?? '', role: person.Role ?? '', image: personImage(api.basePath, person),
        href: person.Id ? `#/details?id=${encodeURIComponent(person.Id)}&serverId=${encodeURIComponent(serverId ?? '')}` : undefined }));
    const guests = native.length || itemId ? native : (episode.entryEpisode?.credits?.guestStars ?? []).map(person => ({ key: String(person.id),
        name: person.name, role: person.character ?? '', image: getTmdbImage(person.profilePath, 'w185'), href: undefined }));
    if (!guests.length) return null;
    const code = `S${episode.season}:E${episode.number ?? ''}`;
    return <TitleRow name='guests' title={<>Guest Stars<small className='rowsub'>{code} · {episode.title}</small></>}>
        {guests.map(person => <BrowseCell key={person.key} person image={person.image} title={person.name} second={person.role} href={person.href} />)}
    </TitleRow>;
};
