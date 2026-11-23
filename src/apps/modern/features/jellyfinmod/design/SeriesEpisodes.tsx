import type { Api } from '@jellyfin/sdk/lib/api';
import type { BaseItemDto, BaseItemPerson } from '@jellyfin/sdk/lib/generated-client';
import { ItemFields } from '@jellyfin/sdk/lib/generated-client/models/item-fields';
import { getShowApi } from '@jellyfin/sdk/lib/utils/api/show-api';
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api';
import { useQuery } from '@tanstack/react-query';
import React, { type FC, type ReactNode, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ResizeObserver from 'resize-observer-polyfill';
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
import { DesignContext } from './Root';
import focusManager from 'components/focusManager';

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

/**
 * Play's second line on a computer (ds.t20, option E, the user 2026-11-16): `runtime · Ends 10:49 PM` (a movie: `Ends 11:00 PM`,
 * its runtime is on the facts line), part-way `32m left · Ends 10:32 PM` (`1h 12m left` over an hour). The time follows the
 * locale's clock (24-hour where it is). No runtime, no line.
 */
export const playLine = (ticks: number | null | undefined, position: number, runtime: boolean) => {
    if (!ticks) return '';
    const left = Math.max(0, ticks - position);
    const ends = 'Ends ' + datetime.getDisplayTime(new Date(Date.now() + left / 10000));
    if (position) return `${datetime.getDisplayDuration(left)} left · ${ends}`;
    return runtime ? `${datetime.getDisplayDuration(ticks)} · ${ends}` : ends;
};

/**
 * Play's watch progress (ds.t20, REVIEW.md round 5e/5f): the button filled from the left to position ÷ runtime in the primary,
 * the label drawn again on it in #101010. Only while the title, or the episode on the button, is part-way.
 */
export const PlayFill: FC<{ percent?: number; children: ReactNode }> = ({ percent, children }) => (percent && percent > 0 && percent < 100 ?
    <span className='jfmod-playFill' aria-hidden='true' style={{ clipPath: `inset(0 ${100 - percent}% 0 0)` }}>{children}</span> : null);

/** The series page's main button, first in the pill: Play, Download for an episode with no file, or the air date. */
export const SeriesMainButton: FC<{ series: SeriesModel }> = ({ series }) => {
    const device = useContext(DesignContext);
    const computer = device === 'computer' || device === 'tv';
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
    if (computer) {
        // "Play" in both states (the user, 2026-11-17): the small line says the time left; playback still resumes.
        const word = 'Play';
        const label = <><Icon name='play' /><EpisodeCopy word={word} episode={episode} line={playLine(episode.ticks, episode.progress ? episode.item?.UserData?.PlaybackPositionTicks ?? 0 : 0, true)} /></>;
        return <button type='button' className='play epb focusable' aria-label={episodeLabel(word, episode)} onClick={() => series.play(episode)}>
            {label}<PlayFill percent={episode.progress}>{label}</PlayFill></button>;
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
 * The main button's words in two rows (the user, 2026-11-08): the action and number, then the season and runtime (on a
 * computer `line`, ds.t20). The episode's own name is on its card in the rail, so here it is only the hover hint. A hidden
 * "… Episode 88" sets the width, so the button holds still from episode to episode.
 */
const EpisodeCopy: FC<{ word: string; episode: SeriesEpisode; line?: string }> = ({ word, episode, line }) => {
    const runtime = episode.ticks ? datetime.getDisplayDuration(episode.ticks) : '';
    return <span className='epc' title={ownTitle(episode) || undefined}>
        <b>{episodeWords(word, episode)}</b>
        <span className='ghost' aria-hidden='true'>{word} Episode 88</span>
        <span className='sm f'>{line ?? <>{seasonName(episode.season)}{runtime && ' · ' + runtime}</>}</span>
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
    const name = <>{episode.number != null && episode.number + '. '}{episode.title}</>;
    const device = useContext(DesignContext);
    const tv = device === 'tv';
    const link = device === 'computer' && episode.item?.Id ?
        `#/details?id=${encodeURIComponent(episode.item.Id)}&serverId=${encodeURIComponent(episode.item.ServerId ?? '')}` : undefined;
    return <div role='button' tabIndex={0} aria-pressed={selected} data-season={episode.season} data-key={episode.key}
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
            {onDownload && <button type='button' className={'disc hov glassy' + (tv ? '' : ' focusable')} tabIndex={tv ? -1 : 0} data-ds-primary-action='get' aria-label={'Download ' + episode.title}
                onClick={event => {
                    event.stopPropagation();
                    onDownload(event.currentTarget);
                }}><Cloud /></button>}
        </Poster>
        <div className='capt'><div className='ln t'>{link ?
            // ds.t20: a click on a card selects it; its title opens the episode's own page.
            <a className='jfmod-epLink' href={link} onClick={event => event.stopPropagation()}>{name}</a> : name}</div>
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
export const EpisodeStrip: FC<{ series: SeriesModel }> = ({ series }) => (['computer', 'tv'].includes(useContext(DesignContext) || '') ?
    <EpisodeRow series={series} /> : <EpisodeSlider series={series} />);

const PHI = 1.6180339887;
/** The cards that fit whole in the row, one of them the big selected one: k = 1 + floor((W − Bφ⁶) ÷ (Bφ⁵ + Bφ⁻¹)). */
const useRowCount = (row: React.RefObject<HTMLDivElement>, ready: boolean) => {
    const [count, setCount] = useState(1);
    useLayoutEffect(() => {
        const node = row.current;
        if (!node) return;
        const measure = () => {
            const base = parseFloat(getComputedStyle(node).fontSize);
            setCount(Math.max(1, 1 + Math.floor((node.clientWidth - base * PHI ** 6 + 0.5) / (base * PHI ** 5 + base / PHI))));
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(node);
        return () => observer.disconnect();
    }, [row, ready]);
    return count;
};

const cardOf = (root: HTMLElement | null | undefined, key?: string) => Array.from(root?.querySelectorAll<HTMLElement>('.cell[data-key]') ?? [])
    .find(card => card.dataset.key === key) ?? null;

/** cubic-bezier(0.236, 0, 0, 1), the mod's --ease, solved for x by bisection. */
const ease = (t: number) => {
    const curve = (a: number, b: number, u: number) => 3 * a * u * (1 - u) * (1 - u) + 3 * b * u * u * (1 - u) + u * u * u;
    let lo = 0;
    let hi = 1;
    for (let step = 0; step < 24; step++) {
        const mid = (lo + hi) / 2;
        if (curve(0.236, 0, mid) < t) lo = mid;
        else hi = mid;
    }
    return curve(0, 1, (lo + hi) / 2);
};

/**
 * Round 7d's first screen under the remote or the keyboard (the user, 2026-11-17; series7-bg.html): the hero and the row are both
 * in view, so the TV's scroll manager leaves them alone (`data-scroll-mode-*`) and focus coming back into them from Cast glides the
 * page to the top (on a computer only when the keyboard moved it),
 * 0.618 s (--d3, --d2 × φ) on --ease, instant with reduced motion. Focus entering the row from outside lands on the selected
 * episode; the rest of the D-pad's path is `useDpad` (TitlePage.tsx).
 */
const useTvScreen = (row: React.RefObject<HTMLDivElement>, on: boolean, selectedKey: string | undefined, tv: boolean, select: (key: string) => void) => {
    const selected = useRef(selectedKey);
    selected.current = selectedKey;
    const choose = useRef(select);
    choose.current = select;
    useEffect(() => {
        const node = row.current;
        const screen = node?.closest<HTMLElement>('.jfmod-screen1');
        const head = screen?.querySelector<HTMLElement>('.jfmod-titleHead');
        if (!on || !node || !screen || !head) return;
        if (tv) {
            screen.setAttribute('data-scroll-mode-x', 'custom');
            screen.setAttribute('data-scroll-mode-y', 'custom');
        }
        // On a computer only the keyboard's focus moves the page; the mouse keeps its own scrolling.
        let keyboard = tv;
        const keyed = () => {
            keyboard = true;
        };
        const pointed = () => {
            keyboard = tv;
        };
        document.addEventListener('keydown', keyed, true);
        document.addEventListener('mousedown', pointed, true);
        let frame = 0;
        const glideTo = (y: number) => {
            cancelAnimationFrame(frame);
            const from = window.scrollY;
            if (Math.abs(y - from) < 1 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                window.scrollTo(0, y);
                return;
            }
            const start = performance.now();
            const step = (now: number) => {
                const t = Math.min(1, (now - start) / 618);
                window.scrollTo(0, from + (y - from) * ease(t));
                if (t < 1) frame = requestAnimationFrame(step);
            };
            frame = requestAnimationFrame(step);
        };
        const toSelected = () => {
            const own = cardOf(node, selected.current);
            if (own) focusManager.focus(own);
            return !!own;
        };
        const focus = (event: FocusEvent) => {
            if (!keyboard) return;
            const element = event.target as HTMLElement;
            const from = event.relatedTarget as Node | null;
            if (node.contains(element) && (!from || !node.contains(from)) && cardOf(node, selected.current) !== element && element.matches('.cell')) {
                // A slice without the selected episode (a season jump): the card the focus enters is selected, so Play and the
                // ring describe the same episode (Codex review of 1cfb7e7fec, P2).
                if (!toSelected() && element.dataset.key) choose.current(element.dataset.key);
                return;
            }
            // Back to the top only when the focused control is still in view there (a card: the row's rail, whose height is fixed
            // while the cards resize); a short window reveals it where it is.
            const extent = (element.closest<HTMLElement>('.jfmod-epRow .erail') ?? element).getBoundingClientRect();
            if (extent.bottom + window.scrollY <= window.innerHeight) glideTo(0);
            else element.scrollIntoView({ block: 'nearest' });
        };
        screen.addEventListener('focusin', focus);
        return () => {
            cancelAnimationFrame(frame);
            screen.removeEventListener('focusin', focus);
            document.removeEventListener('keydown', keyed, true);
            document.removeEventListener('mousedown', pointed, true);
            screen.removeAttribute('data-scroll-mode-x');
            screen.removeAttribute('data-scroll-mode-y');
        };
    }, [row, on, tv]);
};

/**
 * Round 7d's slide (the user, 2026-11-17): when the remote or the keyboard moves the selection, the row slides one card under the
 * fixed slot while the arriving card grows and the leaving one shrinks (their widths' own transition); a card leaving the row is
 * drawn once more where it was and fades out, one entering fades in. --d2 (0.382 s) on --ease; nothing moves with reduced motion.
 */
const useRowSlide = (row: React.RefObject<HTMLDivElement>, first: number) => {
    const before = useRef<{ start: number; widths: Map<string, number>; nodes: Map<string, HTMLElement> } | null>(null);
    useLayoutEffect(() => {
        const prev = before.current;
        before.current = null;
        const rail = row.current;
        if (!prev || !rail || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const timing = { duration: 382, easing: 'cubic-bezier(0.236, 0, 0, 1)' };
        const cards = Array.from(rail.querySelectorAll<HTMLElement>('.cell[data-key]'));
        for (const card of cards.filter(candidate => !prev.widths.has(candidate.dataset.key ?? ''))) card.animate([{ opacity: 0 }, { opacity: 1 }], timing);
        const moved = first - prev.start;
        const small = cards.find(card => !card.classList.contains('sel'));
        if (!moved || !small || cards.length < 2) return;
        const gap = parseFloat(getComputedStyle(cards[1]).marginLeft) || 0;
        rail.animate([{ transform: `translateX(${moved * (small.offsetWidth + gap)}px)` }, { transform: 'none' }], timing);
        const last = cards[cards.length - 1];
        let left = 0;
        let right = last.offsetLeft + last.offsetWidth + gap;
        Array.from(prev.nodes.keys()).filter(key => !cards.some(card => card.dataset.key === key)).forEach(key => {
            const ghost = prev.nodes.get(key)!;
            const width = prev.widths.get(key) ?? 0;
            const leftSide = moved > 0;
            if (leftSide) left -= width + gap;
            ghost.classList.add('jfmod-ghost');
            ghost.classList.remove('sel', 'focusable');
            ghost.removeAttribute('data-key');
            ghost.removeAttribute('tabindex');
            ghost.setAttribute('aria-hidden', 'true');
            ghost.setAttribute('inert', '');
            ghost.style.left = (leftSide ? left : right) + 'px';
            ghost.style.width = width + 'px';
            if (!leftSide) right += width + gap;
            rail.appendChild(ghost);
            ghost.animate([{ opacity: 1 }, { opacity: 0 }], timing).onfinish = () => ghost.remove();
        });
    }, [row, first]);
    return useCallback(() => {
        const rail = row.current;
        if (!rail) return;
        const cards = Array.from(rail.querySelectorAll<HTMLElement>('.cell[data-key]'));
        before.current = { start: Number(rail.dataset.first ?? 0), widths: new Map(cards.map(card => [card.dataset.key ?? '', card.offsetWidth])),
            nodes: new Map(cards.map(card => [card.dataset.key ?? '', card.cloneNode(true) as HTMLElement])) };
    }, [row]);
};

/**
 * TV keys on a card (the user, 2026-11-17): Left and Right select the next episode, which takes the focus and grows; OK plays it
 * at once (resuming one started) or, with no file, does what the head's button does (Download); Up goes to the season pill
 * (round 7d), Down to Cast as the D-pad finds it.
 */
interface RowWindow { series: SeriesModel; first: number; count: number; setStart: (start: number) => void; setFocusKey: (key: string) => void; snapshot: () => void }
const useTvKeys = (row: React.RefObject<HTMLDivElement>, on: boolean, state: RowWindow) => {
    const latest = useRef(state);
    latest.current = state;
    useEffect(() => {
        const node = row.current;
        if (!on || !node) return;
        const move = (index: number, step: number) => {
            const { series, first, count, setStart, setFocusKey, snapshot } = latest.current;
            const { episodes } = series;
            const next = Math.max(0, Math.min(episodes.length - 1, index + step));
            // The selection rests in the second slot (the first when only one card fits) and the row slides under it; at the ends
            // the selection moves along (7d).
            const start = Math.max(0, Math.min(next - (count > 1 ? 1 : 0), episodes.length - count));
            if (start !== first && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) snapshot();
            setStart(start);
            series.select(episodes[next].key);
            setFocusKey(episodes[next].key);
        };
        const press = (episode: SeriesEpisode, card: HTMLElement) => {
            const { series } = latest.current;
            if (episode.hasFile) series.play(episode);
            else if (!episode.airs && series.canAcquire && episode.entryEpisode) series.download(episode, card);
        };
        const key = (event: KeyboardEvent) => {
            const card = (event.target as HTMLElement).closest<HTMLElement>('.cell[data-key]');
            const { episodes } = latest.current.series;
            const index = card ? episodes.findIndex(episode => episode.key === card.dataset.key) : -1;
            if (!card || index < 0) return;
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                move(index, event.key === 'ArrowRight' ? 1 : -1);
            } else if (event.key === 'Enter') {
                // Only the card itself plays; its title link and Download button keep their own Enter.
                if (event.target !== card) return;
                press(episodes[index], card);
            } else if (event.key === 'ArrowUp') {
                const pill = node.parentElement?.querySelector<HTMLElement>('.spill');
                if (pill) focusManager.focus(pill);
            } else {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
        };
        node.addEventListener('keydown', key);
        return () => node.removeEventListener('keydown', key);
    }, [row, on]);
};

/**
 * The computer's episode row (ds.t20, the user 2026-11-16, REVIEW.md round 6): full width under the head, small stills Bφ⁵ with
 * their two lines under them and the selected episode, the one on Play, Bφ⁶ with its lines in a glass band. Whole cards only,
 * the rest of the row empty; it opens on the selected episode near its start, earlier episodes filling in behind it. A click
 * selects at once; the arrows page whole cards; the season pill names the first card's season and jumps to a season.
 */
const EpisodeRow: FC<{ series: SeriesModel }> = ({ series }) => {
    const tv = useContext(DesignContext) === 'tv';
    const section = useRef<HTMLDivElement>(null);
    const [focusKey, setFocusKey] = useState<string>();
    const row = useRef<HTMLDivElement>(null);
    const pill = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(false);
    const { episodes, selectedIndex } = series;
    const downloads = useEpisodeDownloads(episodes);
    const total = episodes.length;
    const count = useRowCount(row, total > 0);
    const [start, setStart] = useState<number>();
    const swipeFrom = useRef<number>();
    // Once per series the row opens on the episode selected then; selecting another later never moves the row.
    const seriesKey = episodes[0]?.key ?? '';
    const opened = useRef({ key: '', index: 0 });
    if (opened.current.key !== seriesKey) opened.current = { key: seriesKey, index: Math.max(0, selectedIndex) };
    useEffect(() => setStart(undefined), [seriesKey]);
    // It opens with the selected episode in the second slot, or the first when only one card fits.
    const first = Math.max(0, Math.min(start ?? Math.max(0, opened.current.index - (count > 1 ? 1 : 0)), total - count));
    const seasons = useMemo(() => [...new Set(episodes.map(episode => episode.season))]
        .map(number => ({ number, count: episodes.filter(episode => episode.season === number).length })), [episodes]);
    const close = useCallback(() => setOpen(false), []);
    // The season list opens on the current season, not the first (the user, 2026-11-21); after Menu's own autofocus.
    useLayoutEffect(() => {
        if (!open) return;
        const current = document.querySelector<HTMLElement>('[role="menu"][aria-label="Seasons"] .mi.sel');
        if (current) focusManager.focus(current);
    }, [open]);
    useTvScreen(row, total > 0, series.selected?.key, tv, series.select);
    const snapshot = useRowSlide(row, first);
    // The keyboard is the remote on every layout (the user, 2026-11-17); the mouse keeps its clicks.
    useTvKeys(row, total > 0, { series, first, count, setStart, setFocusKey, snapshot });
    // The TV moves the focus itself, a card at a time; the card it lands on is drawn first, then focused.
    useEffect(() => {
        const card = focusKey ? cardOf(row.current, focusKey) : null;
        if (card && document.activeElement !== card) focusManager.focus(card);
    }, [focusKey, first]);
    if (!total) return null;
    const shown = episodes.slice(first, first + count);
    const season = shown[0]?.season ?? episodes[0].season;
    const page = (step: number) => setStart(Math.max(0, Math.min(first + step * Math.max(1, count - 1), total - count)));
    // A touch screen pages the row with a swipe, as the arrows do (a tablet, the user 2026-11-19); a tap still selects.
    const swipe = (event: React.TouchEvent) => {
        const from = swipeFrom.current;
        swipeFrom.current = undefined;
        const dx = from === undefined ? 0 : event.changedTouches[0].clientX - from;
        if (Math.abs(dx) > 40) page(dx < 0 ? 1 : -1);
    };
    const next = episodes.find(episode => episode.airs);
    return <div ref={section} className='sect plain estrip jfmod-epRow' data-ds-section='episodes'>
        <div className='etop'>
            <button ref={pill} type='button' className='spill glassy focusable' aria-haspopup='menu' aria-expanded={open} onClick={() => setOpen(!open)}>
                {seasonName(season)}<Icon name='down' /></button>
            {next && <span className='jfmod-nextEp'><span className='jfmod-creditLabel'>Next episode</span>{next.airs}</span>}
            <div className={'actbar static glassy arrows' + (total <= count ? ' jfmod-hidden' : '')}>
                <button type='button' className={'dbtn focusable' + (first <= 0 ? ' off' : '')} disabled={first <= 0} aria-label='Previous' onClick={() => page(-1)}><Icon name='prev' /></button>
                <button type='button' className={'dbtn focusable' + (first + count >= total ? ' off' : '')} disabled={first + count >= total} aria-label='Next' onClick={() => page(1)}><Icon name='nextp' /></button>
            </div>
        </div>
        {open && pill.current && <Menu close={close} label='Seasons' anchor={pill.current} anchored>
            {seasons.map(item => <button type='button' key={item.number} className={'mi focusable' + (item.number === season ? ' sel' : '')} onClick={() => {
                close();
                setStart(episodes.findIndex(episode => episode.season === item.number));
            }}>{seasonName(item.number)}<span className='sub'>{item.count} episodes</span></button>)}
        </Menu>}
        <div ref={row} className='erail' data-first={first} onTouchStart={event => { swipeFrom.current = event.touches[0].clientX; }} onTouchEnd={swipe}>
            {shown.map((episode, offset) => {
                const index = first + offset;
                return <EpisodeCard key={episode.key} episode={episode} selected={index === selectedIndex} boundary={false}
                    onSelect={() => series.select(episode.key)}
                    onDownload={series.canAcquire && !episode.hasFile && !episode.airs && episode.entryEpisode && !inFlight(episode) ?
                        opener => series.download(episode, opener) : undefined} download={downloads.get(episode.key)} />;
            })}
        </div>
    </div>;
};

/** Phone, tablet and TV: one continuous slider of every episode (ds.t14). */
const EpisodeSlider: FC<{ series: SeriesModel }> = ({ series }) => {
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
    // The selected card opens second, its previous episode at the left edge, or first when the two do not both fit in the part of
    // the strip the window shows (a phone; the computer's rule, the user 2026-11-23); once per series.
    const placed = useRef('');
    const first = episodes[0]?.key ?? '';
    useLayoutEffect(() => {
        const node = strip.current;
        if (!node || !first || placed.current === first) return;
        placed.current = first;
        const pad = parseFloat(getComputedStyle(node).paddingLeft);
        const selected = node.children[Math.max(0, selectedIndex)] as HTMLElement | undefined;
        let card = node.children[Math.max(0, selectedIndex - 1)] as HTMLElement | undefined;
        if (card && selected && card !== selected) {
            const box = node.getBoundingClientRect();
            const shown = Math.min(box.right, document.documentElement.clientWidth) - box.left;
            if (selected.offsetLeft + selected.offsetWidth - (card.offsetLeft - pad) > shown - pad) card = selected;
        }
        node.scrollLeft = card ? card.offsetLeft - pad : 0;
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
