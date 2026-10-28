import type { Api } from '@jellyfin/sdk/lib/api';
import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind';
import type { MediaSourceInfo } from '@jellyfin/sdk/lib/generated-client/models/media-source-info';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { type FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getAncestorsQuery } from 'apps/modern/features/libraries/hooks/api/useAncestors';
import layoutManager from 'components/layoutManager';
import loading from 'components/loading/loading';

import { type EntryDetail, getMediaSources, keepEntry, keepEpisode, setEpisodeRetention, setVersionKept,
    unkeepEpisode } from '../api/modApi';
import { announce } from '../integration/announce';
import { HISTORY_FILES_CAPABILITY, playedBadge, shortDate, showsRetentionStatus } from '../constants/detailPage';
import { EPISODE_CONTROLS_CAPABILITY, EPISODE_RETENTION_CAPABILITY, VERSION_KEEP_CAPABILITY } from '../constants/fileState';
import { type DevicePreference, deleteWarningText, isEpisodeItem, preferredVersion, sameItemId, VERSIONS_CAPABILITY, VERSIONS_REMOVE_CAPABILITY,
    VERSIONS_V1_CAPABILITY, videoRangeTypes } from '../constants/versions';
import { PACKS_CAPABILITY, RELEASES_CAPABILITY, usePluginCapabilities } from '../hooks/useAcquisition';
import { entryDetailQuery, entryIdQuery } from '../hooks/useEntries';
import { useDeleteWarning } from '../hooks/useDeleteWarning';
import { useVersionRemoval } from '../hooks/useVersionRemoval';
import { registerDeleteReturn, registerMoreMenuItem } from '../integration/moreMenuItem';
import { usePlayedBadge, usePlayedRefresh } from '../integration/playedBadge';
import { openReleasePicker, useEpisodeListLoad } from '../integration/releasePicker';
import { restoreFocusTo, useStockHeaderButton } from '../integration/stockHeaderButton';
import { type EntryEpisode, FileState } from '../types/entry';
import type { VersionDto } from '../types/versions';
import DownloadBlock, { type DownloadTarget } from './DownloadBlock';
import EpisodeWindowDialog, { windowDays } from './EpisodeWindowDialog';
import FileChooser, { type PinState, useStockSourceIds, useTrackStrip } from './FileChooser';
import FileHistoryPopover from './FileHistoryPopover';
import HistoryToggle from './HistoryToggle';
import { MissingEpisodeRows, MissingSeasonCards } from './MissingChildren';
import PendingVersion from './PendingVersion';
import QueueStatusLine from './QueueStatusLine';
import RetentionStatus from './RetentionStatus';
import SeasonTotal from './SeasonTotal';
import TrackDropdowns from './TrackDropdown';
import './entryDetails.scss';

interface NativeEntryDetailsProps {
    api: Api;
    userId: string;
    /** The server the page belongs to, for the detail routes the page moves on to after a removal. */
    serverId: string;
    itemId: string;
    /** The native item's type: a `Season` page looks up its series' entry by `seriesId`. */
    itemType?: string;
    seriesId?: string;
    /** A season page's season number (the item's `IndexNumber`). */
    seasonNumber?: number;
    isAdmin: boolean;
    /** The native detail view: its header row, Played button and track selections carry the mod's inserts. */
    view: HTMLElement;
}

/** The versions of this movie or this episode (a series page has none of its own), where the plugin lists them (P6.M8). */
const pageVersions = (detail: EntryDetail, episode: EntryEpisode | undefined, capabilities: string[]) => {
    const isMoviePage = !episode && detail.entry.mediaType === 'movie';
    const versions = (episode ? episode.versions : undefined) ?? (isMoviePage ? detail.versions : undefined) ?? [];
    return capabilities.includes(VERSIONS_CAPABILITY) ? versions : [];
};

/** What a Keep on this page keeps, in words (RET-R7): an untracked episode page keeps the whole series. */
const keptMessage = (keepsEpisode: boolean, detail: EntryDetail): string => {
    if (keepsEpisode) return 'This episode will be kept.';
    if (detail.entry.mediaType === 'series') return `The series ${detail.entry.title} will be kept.`;
    return 'This title will be kept.';
};

/**
 * The tracked episode this native page shows. Any file of the episode opens its page, not only the one the plugin selected
 * (P10.E3). A multi-episode file is also pointed at by the rows of the episodes it covers; its page is the row that holds
 * the file (RET2-R7).
 */
const pageEpisode = (data: EntryDetail | null | undefined, itemId: string) =>
    data?.episodes.find(candidate => (candidate.versions ?? []).some(version => sameItemId(version.jellyfinItemId, itemId)
        || sameItemId(version.mediaSourceId, itemId)))
        ?? data?.episodes.find(candidate => isEpisodeItem(candidate, itemId));

/** A season page has no entry of its own: it is its series' entry, searched by its own season (user, 2026-10-12). */
const pageLookup = (itemId: string, itemType: string | undefined, seriesId: string | undefined, seasonNumber: number | undefined) =>
    (itemType === 'Season' && seriesId ? { lookupId: seriesId, seasonOf: seasonNumber ?? 0 } : { lookupId: itemId, seasonOf: undefined });

/**
 * Whether a page of this type has Get a Release while its entry is not read yet (P1.FU23): a season needs a number and pack
 * search. Once the lookup has answered the page's own rule applies; a title the plugin has no entry for then loses the icon,
 * which on 28096 was 1 title of 164 (2026-10-13).
 */
const expectsRelease = (answered: boolean, itemType: string | undefined, capabilities: string[], seasonOf: number | undefined) =>
    !answered && (itemType === 'Movie' || itemType === 'Episode' || itemType === 'Series'
        || (itemType === 'Season' && capabilities.includes(PACKS_CAPABILITY) && !!seasonOf));

/** What the page shows: a season (only the header icon), a series (its section), or a movie or episode with its files. */
const pageKind = (data: EntryDetail | null | undefined, itemId: string, seasonOf: number | undefined) => {
    const isSeasonPage = seasonOf !== undefined && data?.entry.mediaType === 'series';
    const episode = isSeasonPage ? undefined : pageEpisode(data, itemId);
    const isSeriesPage = !!data && !episode && !isSeasonPage && data.entry.mediaType === 'series';
    return { episode, isSeasonPage, isSeriesPage, isFilePage: !!data && !isSeriesPage && !isSeasonPage };
};

/**
 * Stock Delete media on a title with several files deletes more than one version (V1, analysis C8): its confirmation on
 * this page gets a warning, and the administrator's file list the same line. V1 only: a plugin without `versions.v1`
 * gets the page as it was before V1.
 */
const usePageDeleteWarning = (view: HTMLElement, data: EntryDetail | null | undefined, versions: VersionDto[], capabilities: string[]) => {
    const warning = data && capabilities.includes(VERSIONS_V1_CAPABILITY) && versions.length > 1 ?
        deleteWarningText(versions.length, data.entry.mediaType) : null;
    useDeleteWarning(view, warning);
    return warning;
};

/** Which copy this device starts with (V1 decision 4). */
const devicePreference = (): DevicePreference => {
    if (layoutManager.tv) return 'tv';
    return layoutManager.mobile ? 'mobile' : 'desktop';
};

/** The page item's media sources with their streams: the Video, Audio and Subtitles rows draw their marks from them (P7.FU6). */
const useMediaSources = (api: Api, userId: string, itemId: string, enabled: boolean) => useQuery({
    queryKey: ['JellyfinMod', api.basePath, userId, 'MediaSources', itemId],
    queryFn: ({ signal }) => getMediaSources(api, userId, itemId, { signal }),
    enabled,
    retry: false
});

/**
 * The copy this device starts with, or null for Jellyfin's default (V1 decision 4). Only with `versions.v1`: an older
 * plugin's rows do not say which copy the viewer is part-way through, so a preselect could replace a resumable copy. The TV
 * waits for Jellyfin's range types (from the media sources) so that Dolby Vision is told apart from HDR before anything is
 * selected.
 */
const usePreferredVersion = (versions: VersionDto[], capabilities: string[], sources: { isPending: boolean; data?: MediaSourceInfo[] }) => {
    const device = devicePreference();
    const active = capabilities.includes(VERSIONS_V1_CAPABILITY) && device !== 'desktop' && versions.length > 1;
    if (!active || (device === 'tv' && sources.isPending)) return null;
    return preferredVersion(versions, device, sources.data ? videoRangeTypes(sources.data) : null);
};

/** The copies of the page's movie or episode that the plugin lists after a removal. */
const remainingAfterRemove = (fresh: EntryDetail, episode: EntryEpisode | undefined, removed: VersionDto): VersionDto[] => {
    if (removed.isLast) return [];
    const freshEpisode = episode ? fresh.episodes.find(candidate => candidate.id === episode.id) : undefined;
    const remaining = (episode ? freshEpisode?.versions : fresh.versions) ?? [];
    return remaining.filter(version => version.bindingId !== removed.bindingId);
};

/** The main copy's page, loaded afresh (`jfmodRefresh` when it is this very page, so the route builds a new view). */
const showVersionPage = (serverId: string, itemId: string, target: string) => {
    const refresh = sameItemId(target, itemId) ? '&jfmodRefresh=' + Date.now() : '';
    window.location.replace('#/details?id=' + encodeURIComponent(target) + '&serverId=' + encodeURIComponent(serverId) + refresh);
};

/**
 * Where the page goes after Remove this version: upstream's page still holds the removed copy in its select and its
 * playback sources. With a copy left, the remaining main copy's page loads afresh; with none left, the catalog entry
 * (a movie is Not downloaded; an episode's entry opens its series). `jfmodRefresh` makes the address differ when the
 * main copy is this very page, so the route loads a new view instead of keeping the old one.
 */
const leaveAfterRemove = (serverId: string, itemId: string, fresh: EntryDetail | null | undefined, episode: EntryEpisode | undefined,
    removed: VersionDto) => {
    if (!fresh) return;
    const entryId = fresh.entry.id;
    const remaining = remainingAfterRemove(fresh, episode, removed);
    const server = '&serverId=' + encodeURIComponent(serverId);
    const next = remaining.find(version => version.isDefault) ?? remaining[0];
    if (!next?.jellyfinItemId) {
        window.location.replace('#/details?entryId=' + encodeURIComponent(entryId) + server);
        return;
    }
    showVersionPage(serverId, itemId, next.jellyfinItemId);
};

/** Whether the plugin's files and upstream's Version select (its playback sources) name different copies. */
const sourcesDiffer = (view: HTMLElement, listed: VersionDto[]) => {
    const select = view.querySelector<HTMLSelectElement>('.selectSource');
    if (!select) return false;
    const stock = Array.from(select.options, option => option.value);
    return listed.length !== stock.length || listed.some(version => !stock.some(id => sameItemId(id, version.mediaSourceId)));
};

/** The page an address opens: its route and item (`#/details?id=…`), whatever else the address carries. */
const pageOf = (href: string) => {
    const hash = href.split('#')[1] ?? '';
    const [route, query = ''] = hash.split('?');
    return route + '?' + (new URLSearchParams(query).get('id') ?? '').toLowerCase();
};

/**
 * When the pending download ends, however it ends (Codex review of the upgrade status, P2 1, and its re-reviews): the entry is
 * read again, and when its files are no longer the ones upstream's Version select and playback sources hold (an import added
 * one, a Replace removed one) the page loads afresh on the title's main copy, as after Remove this version. A cancelled download
 * changes no file and reloads nothing. Only for the visit it belongs to: the page the controller was opened on (its item id),
 * checked against the address before the read and after it, so a navigation already under way (its destination still loading, this page
 * still on screen) is never replaced; nor once the page went away.
 */
const usePendingFinished = (view: HTMLElement, refetch: () => Promise<{ data?: EntryDetail }>, serverId: string, itemId: string,
    episodeId: string | undefined) => {
    const mounted = useRef(true);
    // The page as the controller was opened on it (its own route parameter, `itemId`), never the address at mount, which may
    // already be another page's while the controller waited for its item (Codex re-review 3 of the upgrade status).
    const opened = pageOf('#/details?id=' + itemId);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    return useCallback(() => {
        const here = () => mounted.current && pageOf(window.location.href) === opened && !view.classList.contains('hide');
        if (!here()) return;
        refetch().then(({ data }) => {
            if (!data || !here()) return;
            const listed = (episodeId ? data.episodes.find(candidate => candidate.id === episodeId)?.versions : data.versions) ?? [];
            const next = listed.find(version => version.isDefault) ?? listed[0];
            if (next?.jellyfinItemId && sourcesDiffer(view, listed)) showVersionPage(serverId, itemId, next.jellyfinItemId);
        }).catch(() => undefined);
    }, [view, refetch, serverId, itemId, episodeId, opened]);
};

/** What the pin on a file's row does when pressed. */
type PinAction = 'keepFile' | 'unkeepFile' | 'keepEpisode' | 'unkeepEpisode' | 'keepTitle';

interface PinPlan extends PinState {
    action?: PinAction;
}

/**
 * The pin on a file's row (design step 2; implementation choice 6 in the design record). With per-file Keep it keeps that
 * file; a file kept through its episode's own Keep shows the pin filled and pressing it stops keeping the episode; a
 * title-level Keep, which has no un-Keep, shows it filled and read-only. Without per-file Keep the pin keeps the episode
 * (episode pages) or the movie. An untracked file has no binding to keep by.
 */
const keptEpisodePin = (canUnkeep: boolean): PinPlan => (canUnkeep ?
    { kept: true, title: 'Stop Keeping the Episode', action: 'unkeepEpisode' } :
    { kept: true, title: 'Kept', locked: 'This episode is kept' });

const pinPlan = (version: VersionDto, detail: EntryDetail, episode: EntryEpisode | undefined, capabilities: string[]): PinPlan | null => {
    const titleLock = detail.entry.mediaType === 'series' ? 'Kept with the whole series' : 'Kept indefinitely';
    const titlePin: PinPlan | null = detail.entry.retentionPolicy === 'never' ? { kept: true, title: titleLock, locked: titleLock } : null;
    const episodePin = episode?.retentionPolicy === 'never' ? keptEpisodePin(capabilities.includes(EPISODE_CONTROLS_CAPABILITY)) : null;
    if (capabilities.includes(VERSION_KEEP_CAPABILITY)) {
        if (version.tracked === false || !/[1-9a-f]/i.test(version.bindingId ?? '')) return null;
        if (version.kept) return { kept: true, title: 'Stop Keeping', action: 'unkeepFile' };
        return episodePin ?? titlePin ?? { kept: false, title: 'Keep', action: 'keepFile' };
    }
    if (episode && capabilities.includes(EPISODE_RETENTION_CAPABILITY)) {
        return episodePin ?? titlePin ?? { kept: false, title: 'Keep the Episode', action: 'keepEpisode' };
    }
    return titlePin ?? { kept: false, title: episode ? 'Keep the Whole Series' : 'Keep the Movie', action: 'keepTitle' };
};

const PIN_DONE: Record<PinAction, string> = {
    keepFile: 'This file will be kept.',
    unkeepFile: 'This file is no longer kept.',
    keepEpisode: 'This episode will be kept.',
    unkeepEpisode: 'This episode is no longer kept.',
    keepTitle: 'This title will be kept.'
};

/** The page's own Keep, for the badge's `∞`: the title, the episode itself, or a file of it. */
const pageKept = (detail: EntryDetail, episode: EntryEpisode | undefined, versions: VersionDto[]) =>
    detail.entry.retentionPolicy === 'never' || episode?.retentionPolicy === 'never' || (episode ?? detail).retention?.reason === 'kept'
    || versions.some(version => version.kept);

interface PageMenuItem {
    enabled: boolean;
    /** The page's own item and its files' items: the menus the item belongs to. */
    itemIds: string[];
    name: string;
    icon: string;
    run: () => void;
}

/**
 * True when a More menu is this page's own header More button, for this page's own item (or one of its files): a card's menu
 * elsewhere on the page (Next Up, More Like This) is another item's menu.
 */
const isOwnHeaderMore = (view: HTMLElement, own: string[], options: { item?: { Id?: string } | null; positionTo?: Element | null }) => {
    const button = options.positionTo;
    const header = view.querySelector('.mainDetailButtons');
    return !!button && !!header && document.body.contains(view) && button.classList.contains('btnMoreCommands')
        && header.contains(button) && own.some(id => sameItemId(id, options.item?.Id));
};

/**
 * A mod item in the page's stock More menu, registered while the page shows: "Remove after watching…" on an episode page
 * (user, 2026-10-07), "Keep Series" on a series page (user, 2026-10-12).
 */
const usePageMenuItem = (view: HTMLElement, { enabled, itemIds, name, icon, run }: PageMenuItem) => {
    const runRef = useRef(run);
    runRef.current = run;
    const ids = itemIds.join(',');
    useEffect(() => {
        if (!enabled) return;
        const own = ids.split(',');
        return registerMoreMenuItem({
            name,
            icon,
            matches: options => isOwnHeaderMore(view, own, options),
            run: () => runRef.current()
        }) ?? undefined;
    }, [view, enabled, ids, name, icon]);
};

/**
 * A movie's or a series' Delete in the page's More menu goes to the title's library, where the placeholder the plugin makes for it
 * shows, instead of upstream's folder list of the physical folder its files were in (user, 2026-10-27; `registerDeleteReturn`).
 * The library is the item's `CollectionFolder` ancestor, read while the page shows (the top bar reads the same query), because
 * the item is gone once the delete is answered. The menu deletes the version picked in the page's version select, which may be
 * another item than the page's (a grouped version), so the page's own ids include every version the select and the plugin list.
 */
const useDeleteReturn = (api: Api, userId: string, view: HTMLElement, itemId: string, itemType: string | undefined, ownIds: string[]) => {
    const enabled = itemType === BaseItemKind.Movie || itemType === BaseItemKind.Series;
    const ancestors = useQuery({ ...getAncestorsQuery(api, { itemId, userId }), enabled: enabled && !!itemId });
    const library = ancestors.data?.find(ancestor => ancestor.Type === BaseItemKind.CollectionFolder);
    const ids = ownIds.join(',');
    useEffect(() => {
        if (!enabled || !library) return;
        const own = ids.split(',');
        return registerDeleteReturn({ matches: options => isOwnHeaderMore(view, own, options), target: () => library }) ?? undefined;
    }, [enabled, ids, library, view]);
};

interface EpisodeWindowOptions {
    api: Api;
    view: HTMLElement;
    entryId: string | undefined;
    /** The page's episode when this administrator may edit its window; undefined otherwise. */
    episode: EntryEpisode | undefined;
    /** The page's own item and its files' items: the menus the item belongs to. */
    itemIds: string[];
    busy: boolean;
    change: (action: () => Promise<unknown>, done: string) => Promise<boolean>;
}

/**
 * The episode's own window, moved into the stock More menu (user, 2026-10-07): the item exists while the episode is not kept
 * by itself, as the select did before; it opens a small MUI dialog with the same choices. Returns the dialog to render.
 */
const useEpisodeWindow = ({ api, view, entryId, episode, itemIds, busy, change }: EpisodeWindowOptions) => {
    const [open, setOpen] = useState(false);
    const enabled = !!entryId && !!episode && episode.retentionPolicy !== 'never';
    const show = useCallback(() => setOpen(true), []);
    const close = useCallback(() => setOpen(false), []);
    // An administrator's episode window, where the plugin has the episode controls and the episode is not kept by itself.
    usePageMenuItem(view, { enabled, itemIds, name: 'Remove After Watching…', icon: 'auto_delete', run: show });
    const value = episode?.retentionPolicy === 'days' && episode.reclaimAfterDays ? String(episode.reclaimAfterDays) : 'inherit';
    const choose = useCallback((next: string) => {
        if (!entryId || !episode) return;
        const count = next === 'inherit' ? null : Number(next);
        const done = count ? `This episode is removed ${windowDays(count)} after watching.` : 'This episode follows its series.';
        change(() => setEpisodeRetention(api, entryId, episode.id, count ? 'days' : 'inherit', count), done).catch(() => undefined);
    }, [api, change, entryId, episode]);
    return enabled ? <EpisodeWindowDialog open={open} value={value} busy={busy} onChange={choose} onClose={close} /> : null;
};

/**
 * The native series page's section: the retention status, the episodes on their way and the episode retention list. Get a
 * Release is the header icon and Keep Series a More-menu item (user, 2026-10-12); History stays as it was.
 */
const SeriesSection: FC<{ detail: EntryDetail }> = ({ detail }) => {
    // Episodes of this series that are grabbed or downloading; the series entry itself is never projected (P5.I3).
    const inFlightEpisodes = detail.episodes.filter(candidate =>
        candidate.state === FileState.Grabbed || candidate.state === FileState.Downloading);
    return <section aria-label='JellyfinMod' data-jfmod-entry-id={detail.entry.id}>
        <RetentionStatus retention={detail.retention} />
        {inFlightEpisodes.map(candidate => <div className='jfmod-episodeRow' key={'queue:' + candidate.id}>
            <span>S{candidate.seasonNumber} E{candidate.episodeNumber} · {candidate.title}</span>
            <QueueStatusLine entryId={candidate.entryId} episodeId={candidate.id} state={candidate.state} progress={candidate.progress} />
        </div>)}
        {detail.episodes.some(candidate => candidate.retention) && <HistoryToggle label='Episode Retention'>
            {detail.episodes.map(candidate => <div className='jfmod-episodeRow' key={candidate.id}>
                <span>S{candidate.seasonNumber} E{candidate.episodeNumber} · {candidate.title}</span>
                <RetentionStatus retention={candidate.retention} compact />
            </div>)}
        </HistoryToggle>}
        <HistoryToggle label={<>History{detail.history[0] ? ' · ' + detail.history[0].summary : ''}</>}>
            <ol>{detail.history.map(event => <li key={event.id}>
                <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleDateString()}</time>{' · '}{event.summary}
            </li>)}</ol>
        </HistoryToggle>
    </section>;
};

/**
 * Keep Series in the series page's stock More menu, for administrators (user, 2026-10-12: the page's button moved there). Once
 * kept it reads "Series Kept" and choosing it changes nothing, as the read-only kept button did.
 */
const useKeepSeriesItem = (api: Api, view: HTMLElement, detail: EntryDetail | null | undefined, itemId: string, change: (action: () => Promise<unknown>, done: string) => Promise<boolean>) => {
    const kept = detail?.retention.reason === 'kept';
    const run = useCallback(() => {
        if (!detail || kept) return;
        change(() => keepEntry(api, detail.entry.id), keptMessage(false, detail)).catch(() => undefined);
    }, [api, change, detail, kept]);
    usePageMenuItem(view, { enabled: !!detail, itemIds: [itemId], name: kept ? 'Series Kept' : 'Keep Series',
        icon: kept ? 'check' : 'push_pin', run });
};

/**
 * The time the badge is computed at, moved on at the next local midnight and at the deadline, so a page left open never
 * shows yesterday's count or `0` past the deadline (the count is never cached; this only re-renders it).
 */
const useDayClock = (deadline: string | undefined) => {
    const [now, setNow] = useState(() => new Date());
    // A deadline that appears or changes (a played toggle on a page left open) is counted from the current moment.
    useEffect(() => {
        setNow(new Date());
    }, [deadline]);
    useEffect(() => {
        if (!deadline) return;
        const current = new Date();
        const midnight = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1).getTime();
        const due = new Date(deadline).getTime();
        const next = Math.min(midnight, due > current.getTime() ? due : midnight) - current.getTime() + 1000;
        // setTimeout holds at most about 24.8 days; a later moment is reached by the midnights before it.
        const timer = window.setTimeout(() => setNow(new Date()), Math.min(next, 2147483647));
        return () => window.clearTimeout(timer);
    }, [deadline, now]);
    return now;
};

interface PinsOptions {
    api: Api;
    data: EntryDetail | null | undefined;
    episode: EntryEpisode | undefined;
    capabilities: string[];
    isAdmin: boolean;
    change: (action: () => Promise<unknown>, done: string) => Promise<boolean>;
}

/** The pin on each file's row and what pressing it does (design step 2). Administrators only. */
const usePins = ({ api, data, episode, capabilities, isAdmin, change }: PinsOptions) => {
    const pin = useCallback((version: VersionDto) => (data && isAdmin ? pinPlan(version, data, episode, capabilities) : null),
        [capabilities, data, episode, isAdmin]);
    const onPin = useCallback((version: VersionDto) => {
        const plan = pin(version);
        if (!data || !plan?.action || plan.locked) return;
        const entryId = data.entry.id;
        const actions: Record<PinAction, () => Promise<unknown>> = {
            keepFile: () => setVersionKept(api, entryId, version.bindingId, true),
            unkeepFile: () => setVersionKept(api, entryId, version.bindingId, false),
            keepEpisode: () => (episode ? keepEpisode(api, entryId, episode.id) : Promise.resolve()),
            unkeepEpisode: () => (episode ? unkeepEpisode(api, entryId, episode.id) : Promise.resolve()),
            keepTitle: () => keepEntry(api, entryId)
        };
        change(actions[plan.action], PIN_DONE[plan.action]).catch(() => undefined);
    }, [api, change, data, episode, pin]);
    return { pin, onPin };
};

/**
 * The page's retention as the design shows it: the countdown on the stock Played tick for every viewer (design step 4; `∞`
 * only while retention runs), and each scheduled file's own date on its row. `data` is null on a page without a file.
 */
const usePageRetention = (view: HTMLElement, data: EntryDetail | null | undefined, episode: EntryEpisode | undefined,
    versions: VersionDto[]) => {
    const target = episode ?? data;
    const warning = target?.retentionWarning ?? null;
    const retention = target?.retention ?? null;
    const removeDate = useCallback((version: VersionDto) => (warning && !version.kept && version.retention?.state === 'scheduled' ?
        shortDate(warning.deadline) : null), [warning]);
    const kept = !!data && !!retention?.enabled && pageKept(data, episode, versions);
    const now = useDayClock(warning?.deadline);
    usePlayedBadge(view, data ? playedBadge(warning, kept, now) : null);
    return { retention, removeDate };
};

/** The lookup answers null for a title the plugin has no entry for; a failed read has none to show either. */
const hasNoEntry = (lookup: { isSuccess: boolean; isError: boolean; data?: string | null }, detail: { isError: boolean }) =>
    (lookup.isSuccess && !lookup.data) || lookup.isError || detail.isError;

/**
 * The header icon is drawn before the page's entry is read (P1.FU23): a press before then shows upstream's spinner and opens the
 * picker once the entry is in; when there is none, the spinner goes and the icon with it.
 */
const useOpenWhenRead = (ready: boolean, gone: boolean, open: (button: HTMLElement) => void) => {
    const waiting = useRef<HTMLElement | null>(null);
    useEffect(() => {
        const button = waiting.current;
        if (!button || (!ready && !gone)) return;
        waiting.current = null;
        loading.hide();
        if (ready) open(button);
    }, [gone, open, ready]);
    useEffect(() => () => {
        if (waiting.current) loading.hide();
    }, []);
    return useCallback((button: HTMLElement) => {
        if (ready) {
            open(button);
            return;
        }
        waiting.current = button;
        loading.show();
    }, [open, ready]);
};

/**
 * On a placeholder's page (P1.FU24) its entry and episode are remembered; once its import swaps the placeholder for the file
 * (P1.FU25) and the entry is read again, Jellyfin's page for the file opens, as the mod's own episode page does (P1.FU20). The
 * placeholder's item is gone by then, so the page can no longer find its entry or episode by it: the entry is read by its id.
 */
const usePlaceholderSwap = (api: Api, userId: string, data: EntryDetail | null | undefined, episode: EntryEpisode | undefined,
    itemId: string, serverId: string) => {
    const [remembered, setRemembered] = useState<{ entryId: string; episodeId: string | null } | null>(null);
    const isPlaceholder = !!data && !!episode && episode.availability !== 'onDisk' && sameItemId(episode.placeholderItemId, itemId);
    // A placeholder movie's page follows its import the same way (P1.FU26).
    const isMoviePlaceholder = !!data && !episode && data.entry.mediaType === 'movie' && sameItemId(data.entry.placeholderItemId, itemId);
    const entryId = isPlaceholder || isMoviePlaceholder ? data.entry.id : null;
    const episodeId = isPlaceholder ? episode.id : null;
    useEffect(() => {
        if (entryId) setRemembered({ entryId, episodeId });
    }, [entryId, episodeId]);
    const latest = useQuery({ ...entryDetailQuery(api, userId, remembered?.entryId ?? ''), enabled: !!remembered });
    const swapped = remembered?.episodeId ? latest.data?.episodes.find(candidate => candidate.id === remembered.episodeId) : undefined;
    const movie = remembered && !remembered.episodeId ? latest.data?.entry : undefined;
    const episodeFile = swapped?.availability === 'onDisk' ? swapped.jellyfinItemId : null;
    const movieFile = movie?.state === FileState.OnDisk ? movie.jellyfinItemId : null;
    const file = episodeFile ?? movieFile;
    const fileItem = file && !sameItemId(file, itemId) ? file : null;
    useEffect(() => {
        if (fileItem) window.location.replace('#/details?id=' + encodeURIComponent(fileItem) + '&serverId=' + encodeURIComponent(serverId));
    }, [fileItem, serverId]);
};

/**
 * The download block's target on a placeholder's own page (P1.FU27): the episode the placeholder stands for, or the placeholder
 * movie's entry; null on any other page. Jellyfin's page for a placeholder then shows the block where a file's page has its
 * Video, Audio and Subtitle selectors, as the mod's own missing-episode page does (P1.FU20).
 */
const placeholderTarget = (data: EntryDetail | null | undefined, episode: EntryEpisode | undefined, itemId: string): DownloadTarget | null => {
    if (!data) return null;
    if (episode) return episode.availability !== 'onDisk' && sameItemId(episode.placeholderItemId, itemId) ? episode : null;
    const entry = data.entry;
    if (entry.mediaType !== 'movie' || entry.state === FileState.OnDisk || !sameItemId(entry.placeholderItemId, itemId)) return null;
    return { id: null, state: entry.state, progress: entry.progress, availability: 'missing', airDate: null };
};

interface PlaceholderSectionProps {
    view: HTMLElement;
    entryId: string;
    episodeId?: string;
    target: DownloadTarget;
    isAdmin: boolean;
    canAcquire: boolean;
    onGetRelease: (opener: HTMLElement) => void;
    onChanged: () => void;
}

/** A placeholder's page: the download block in the track selectors' place (P1.FU27); it has no file to list. */
const PlaceholderSection: FC<PlaceholderSectionProps> = ({ view, entryId, episodeId, target, isAdmin, canAcquire, onGetRelease, onChanged }) =>
    <section aria-label='JellyfinMod' data-jfmod-entry-id={entryId} data-jfmod-episode-id={episodeId}>
        <DownloadBlock anchor={view.querySelector('.trackSelections')} entryId={entryId} episode={target} isAdmin={isAdmin}
            canAcquire={canAcquire} onGetRelease={onGetRelease} onChanged={onChanged} />
    </section>;

/** The value when the condition holds, else null. */
const onlyWhen = <T,>(condition: boolean, value: T) => (condition ? value : null);

/**
 * The line about the page's movie or episode download, while one is on its way. A page with files shows it as the pending entry
 * under the track strip instead (D9).
 */
const DownloadLine: FC<{ entry: EntryDetail['entry']; episode: EntryEpisode | undefined; files: boolean }> = ({ entry, episode, files }) => {
    if (files) return null;
    return episode ?
        <QueueStatusLine entryId={entry.id} episodeId={episode.id} state={episode.state} progress={episode.progress} /> :
        <QueueStatusLine entryId={entry.id} state={entry.state} progress={entry.progress} />;
};

/** A series with nothing but placeholders has nothing to play: its page loses Play as a placeholder's does (P1.FU26). */
const usePlaceholderSeries = (view: HTMLElement, data: EntryDetail | null | undefined, isSeriesPage: boolean, itemId: string) => {
    const placeholderSeries = isSeriesPage && !!data && sameItemId(data.entry.placeholderItemId, itemId);
    useEffect(() => {
        if (!placeholderSeries) return;
        view.setAttribute('data-jfmod-placeholder', '');
        return () => view.removeAttribute('data-jfmod-placeholder');
    }, [placeholderSeries, view]);
};

/** Add catalog controls to upstream's own detail page without replacing native playback, seasons or track controls. */
const NativeEntryDetails: FC<NativeEntryDetailsProps> = ({ api, userId, serverId, itemId, itemType, seriesId, seasonNumber, isAdmin,
    view }) => {
    const [busy, setBusy] = useState(false);
    const [historyFor, setHistoryFor] = useState<{ anchor: HTMLElement; version: VersionDto } | null>(null);
    // Every viewer reads the file rows and the badge, so capabilities are read for ordinary users too.
    const capabilities = usePluginCapabilities(api);
    const canAcquire = isAdmin && capabilities.includes(RELEASES_CAPABILITY);
    const { lookupId, seasonOf } = pageLookup(itemId, itemType, seriesId, seasonNumber);
    const queryClient = useQueryClient();
    // The server matches any bound copy, and a native episode to its series (P1.P11, P3.T14). The entry is kept by its id, so
    // a season page after its series' page (or any page seen before) draws at once while it refreshes (P1.FU16); the route
    // started both reads before this mounted (integration/nativeEntryDetails).
    const entryLookup = useQuery(entryIdQuery(api, userId, lookupId));
    const entryId = entryLookup.data ?? undefined;
    const detailOptions = entryDetailQuery(api, userId, entryId ?? '');
    const detailKey = detailOptions.queryKey;
    const detail = useQuery({ ...detailOptions, enabled: !!entryId });
    const { data } = detail;
    const refetch = detail.refetch;
    const { episode, isSeasonPage, isSeriesPage, isFilePage } = pageKind(data, itemId, seasonOf);
    usePlaceholderSwap(api, userId, data, episode, itemId, serverId);
    usePlaceholderSeries(view, data, isSeriesPage, itemId);
    // Anyone opening a series or season page of a series whose TMDB list was never loaded loads it (P1.FU9), quietly; its
    // answer is the entry's new detail, drawn straight away.
    useEpisodeListLoad(api, isSeriesPage || isSeasonPage ? data : null, loaded => {
        queryClient.setQueryData(detailKey, loaded);
    });
    const stockIds = useStockSourceIds(view);
    // Only files Jellyfin still lists for this item: a binding left on an item Jellyfin re-created is not a file here.
    const versions = useMemo(() => {
        const listed = data && isFilePage ? pageVersions(data, episode, capabilities) : [];
        if (stockIds === null) return listed;
        const ids = stockIds.split(',');
        return listed.filter(version => ids.some(id => sameItemId(id, version.mediaSourceId)));
    }, [capabilities, data, episode, isFilePage, stockIds]);
    const change = useCallback(async (action: () => Promise<unknown>, done: string) => {
        if (busy) return false;
        setBusy(true);
        let made = false;
        try {
            await action();
            made = true;
            const refreshed = await refetch();
            if (refreshed.error) throw refreshed.error;
            // Upstream's toast, not a line in the page: a line added under the overview pushed the page down (user, 2026-10-08).
            if (done) announce(done);
        } catch (error) {
            announce((error as { jfmodMessage?: string } | null)?.jfmodMessage ?? 'The change could not be saved. Please try again.');
        } finally {
            setBusy(false);
        }
        return made;
    }, [busy, refetch]);
    const openPicker = useCallback((opener: HTMLElement, intent?: 'addVersion') => {
        if (!data) return;
        const reload = () => {
            refetch().catch(() => undefined);
        };
        openReleasePicker({
            api, entryId: data.entry.id, title: data.entry.title, mediaType: data.entry.mediaType, episodes: data.episodes,
            episodeId: episode?.id, episodePage: !!episode?.id, seasonNumber: isSeasonPage ? seasonOf : undefined, intent,
            episodeListLoaded: data.episodeListLoaded, onChanged: reload
        }).then(() => restoreFocusTo(opener), () => restoreFocusTo(opener));
    }, [api, data, episode?.id, isSeasonPage, refetch, seasonOf]);
    const addVersion = useCallback((opener: HTMLElement) => openPicker(opener, 'addVersion'), [openPicker]);
    // Design step 1: the stock-styled header icon; with a file on the page it gets another quality. A series page and a season
    // page have it too (user, 2026-10-12); a season is searched as a pack, so its page needs the plugin's pack search.
    const openRelease = useCallback((button: HTMLElement) => openPicker(button, versions.length > 0 ? 'addVersion' : undefined),
        [openPicker, versions.length]);
    // Drawn with the header from the page's own type, before the entry is read (P1.FU23).
    const noEntry = hasNoEntry(entryLookup, detail);
    const getRelease = useOpenWhenRead(!!data, noEntry, openRelease);
    const seasonSearch = isSeasonPage && capabilities.includes(PACKS_CAPABILITY) && !!seasonOf;
    useStockHeaderButton(view, {
        enabled: canAcquire && (isFilePage || isSeriesPage || seasonSearch || expectsRelease(!!data || noEntry, itemType, capabilities, seasonOf)),
        icon: 'cloud_download',
        title: 'Get a Release',
        className: 'jfmod-getRelease',
        onClick: getRelease,
        before: ['jfmod-seasonTotal']
    });
    const deleteWarning = usePageDeleteWarning(view, data, versions, capabilities);
    const sources = useMediaSources(api, userId, itemId, versions.length > 0);
    const preferred = usePreferredVersion(versions, capabilities, sources);
    const afterRemove = useCallback((removed: VersionDto) => {
        // The page's data was refetched by the removal; the page moves on from what the plugin now lists.
        leaveAfterRemove(serverId, itemId, queryClient.getQueryData<EntryDetail>(detailKey), episode, removed);
    // detailKey is rebuilt from these values on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api.basePath, entryId, episode, itemId, queryClient, serverId, userId]);
    const remove = useVersionRemoval({ api, entryId: data?.entry.id, mediaType: data?.entry.mediaType, busy, change,
        onRemoved: afterRemove });
    const canRemove = useCallback((version: VersionDto) => isAdmin && capabilities.includes(VERSIONS_REMOVE_CAPABILITY)
        && !!version.removable && version.tracked !== false, [capabilities, isAdmin]);
    const { pin, onPin } = usePins({ api, data, episode, capabilities, isAdmin, change });
    const refreshAfterPlayed = useCallback(() => {
        if (entryId) refetch().catch(() => undefined);
    }, [entryId, refetch]);
    usePlayedRefresh(view, refreshAfterPlayed);
    const { retention, removeDate } = usePageRetention(view, isFilePage ? data : null, episode, versions);
    const showHistory = useCallback((version: VersionDto, anchor: HTMLElement) => setHistoryFor({ anchor, version }), []);
    const closeHistory = useCallback(() => setHistoryFor(null), []);
    const windowDialog = useEpisodeWindow({ api, view, entryId: data?.entry.id,
        episode: isAdmin && capabilities.includes(EPISODE_CONTROLS_CAPABILITY) ? episode : undefined,
        itemIds: [itemId, ...versions.map(version => version.jellyfinItemId), ...versions.map(version => version.mediaSourceId)],
        busy, change });
    useKeepSeriesItem(api, view, onlyWhen(isAdmin && isSeriesPage, data), itemId, change);
    useDeleteReturn(api, userId, view, itemId, itemType, [itemId, ...(stockIds?.split(',') ?? []),
        ...versions.flatMap(version => [version.jellyfinItemId, version.mediaSourceId])].filter((id): id is string => !!id));
    // Video, Audio and Subtitles as one strip with the pending download under it (D4–D9), on a page that lists files.
    const strip = useTrackStrip(view, versions.length > 0);
    const pendingFinished = usePendingFinished(view, refetch, serverId, itemId, episode?.id);

    if (!detail.data) return null;
    // A season page shows only the header icon and, beside upstream's rows, the episodes Jellyfin has no item for (P1.FU11).
    if (isSeasonPage) {
        return <>
            <SeasonTotal view={view} entryId={detail.data.entry.id} season={seasonOf ?? 0} />
            <MissingEpisodeRows api={api} userId={userId} serverId={serverId} view={view} detail={detail.data} season={seasonOf ?? 0}
                native={{ seriesItemId: seriesId ?? '', seasonItemId: itemId }} canAcquire={canAcquire} onChanged={refreshAfterPlayed} />
        </>;
    }
    const entry = detail.data.entry;

    if (isSeriesPage) {
        return <>
            <SeriesSection detail={detail.data} />
            <SeasonTotal view={view} entryId={detail.data.entry.id} season={null} />
            <MissingSeasonCards api={api} userId={userId} serverId={serverId} view={view} seriesItemId={itemId} detail={detail.data}
                canAcquire={canAcquire} onChanged={refreshAfterPlayed} />
        </>;
    }

    // The popover lists one file's events, picked by the file's binding; episode-level events are not shown (design step 3).
    const history = detail.data.history;
    const placeholder = placeholderTarget(detail.data, episode, itemId);
    if (placeholder) {
        return <PlaceholderSection view={view} entryId={entry.id} episodeId={episode?.id} target={placeholder} isAdmin={isAdmin}
            canAcquire={canAcquire} onGetRelease={openPicker} onChanged={refreshAfterPlayed} />;
    }
    return <section aria-label='JellyfinMod' data-jfmod-entry-id={entry.id} data-jfmod-episode-id={episode?.id}>
        {strip && <FileChooser view={view} versions={versions} preferred={preferred} busy={busy}
            onAddVersion={canAcquire ? addVersion : undefined}
            onHistory={capabilities.includes(HISTORY_FILES_CAPABILITY) ? showHistory : undefined}
            pin={pin} onPin={onPin} canRemove={canRemove} onRemove={remove} removeDate={removeDate}
            note={isAdmin ? deleteWarning : null} sources={sources.data} strip={strip}
            pending={<PendingVersion entryId={entry.id} episodeId={episode?.id} versions={versions} isAdmin={isAdmin}
                onFinished={pendingFinished} />} />}
        {strip && <TrackDropdowns api={api} view={view} sources={sources.data} strip={strip} />}
        <FileHistoryPopover anchor={historyFor?.anchor ?? null} version={historyFor?.version ?? null} history={history}
            onClose={closeHistory} />
        {windowDialog}
        {showsRetentionStatus(retention) && <RetentionStatus retention={retention} />}
        <DownloadLine entry={entry} episode={episode} files={versions.length > 0} />
    </section>;
};

export default NativeEntryDetails;
