import type { Api } from '@jellyfin/sdk/lib/api';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { type FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import focusManager from 'components/focusManager';
import layoutManager from 'components/layoutManager';

import { type EntryDetail, getEntries, getEntry, getVideoRangeTypes, keepEntry, keepEpisode, setEpisodeRetention, setVersionKept,
    unkeepEpisode } from '../api/modApi';
import { announce } from '../integration/announce';
import { HISTORY_FILES_CAPABILITY, playedBadge, shortDate, showsRetentionStatus } from '../constants/detailPage';
import { EPISODE_CONTROLS_CAPABILITY, EPISODE_RETENTION_CAPABILITY, keepButtonLabel, VERSION_KEEP_CAPABILITY } from '../constants/fileState';
import { type DevicePreference, deleteWarningText, preferredVersion, sameItemId, VERSIONS_CAPABILITY, VERSIONS_REMOVE_CAPABILITY,
    VERSIONS_V1_CAPABILITY } from '../constants/versions';
import { RELEASES_CAPABILITY, usePluginCapabilities } from '../hooks/useAcquisition';
import { useDeleteWarning } from '../hooks/useDeleteWarning';
import { useVersionRemoval } from '../hooks/useVersionRemoval';
import { registerMoreMenuItem } from '../integration/moreMenuItem';
import { usePlayedBadge, usePlayedRefresh } from '../integration/playedBadge';
import { openReleasePicker } from '../integration/releasePicker';
import { restoreFocusTo, useStockHeaderButton } from '../integration/stockHeaderButton';
import { type EntryEpisode, FileState } from '../types/entry';
import type { VersionDto } from '../types/versions';
import EpisodeWindowDialog, { windowDays } from './EpisodeWindowDialog';
import FileChooser, { type PinState, useStockSourceIds } from './FileChooser';
import FileHistoryPopover from './FileHistoryPopover';
import HistoryToggle from './HistoryToggle';
import QueueStatusLine from './QueueStatusLine';
import RetentionStatus from './RetentionStatus';
import './entryDetails.scss';
import { raisedButtonClass } from '../utils/flatButton';

interface NativeEntryDetailsProps {
    api: Api;
    userId: string;
    /** The server the page belongs to, for the detail routes the page moves on to after a removal. */
    serverId: string;
    itemId: string;
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

const keepLabel = (keepsSeries: boolean, busy: boolean, kept: boolean): string => {
    if (!keepsSeries || busy) return keepButtonLabel(busy, kept);
    return kept ? 'Series Kept' : 'Keep Series';
};

/**
 * The tracked episode this native page shows. Any file of the episode opens its page, not only the one the plugin selected
 * (P10.E3). A multi-episode file is also pointed at by the rows of the episodes it covers; its page is the row that holds
 * the file (RET2-R7).
 */
const pageEpisode = (data: EntryDetail | null | undefined, itemId: string) =>
    data?.episodes.find(candidate => (candidate.versions ?? []).some(version => sameItemId(version.jellyfinItemId, itemId)
        || sameItemId(version.mediaSourceId, itemId)))
        ?? data?.episodes.find(candidate => sameItemId(candidate.jellyfinItemId, itemId));

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

/**
 * The copy this device starts with, or null for Jellyfin's default (V1 decision 4). Only with `versions.v1`: an older
 * plugin's rows do not say which copy the viewer is part-way through, so a preselect could replace a resumable copy. The TV
 * waits for Jellyfin's range types so that Dolby Vision is told apart from HDR before anything is selected.
 */
const usePreferredVersion = (api: Api, userId: string, itemId: string, versions: VersionDto[], capabilities: string[]) => {
    const device = devicePreference();
    const active = capabilities.includes(VERSIONS_V1_CAPABILITY) && device !== 'desktop' && versions.length > 1;
    const ranges = useQuery({
        queryKey: ['JellyfinMod', api.basePath, userId, 'VideoRangeTypes', itemId],
        queryFn: ({ signal }) => getVideoRangeTypes(api, userId, itemId, { signal }),
        enabled: active && device === 'tv',
        retry: false
    });
    if (!active || (device === 'tv' && ranges.isPending)) return null;
    return preferredVersion(versions, device, ranges.data);
};

/** The copies of the page's movie or episode that the plugin lists after a removal. */
const remainingAfterRemove = (fresh: EntryDetail, episode: EntryEpisode | undefined, removed: VersionDto): VersionDto[] => {
    if (removed.isLast) return [];
    const freshEpisode = episode ? fresh.episodes.find(candidate => candidate.id === episode.id) : undefined;
    const remaining = (episode ? freshEpisode?.versions : fresh.versions) ?? [];
    return remaining.filter(version => version.bindingId !== removed.bindingId);
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
    const refresh = sameItemId(next.jellyfinItemId, itemId) ? '&jfmodRefresh=' + Date.now() : '';
    window.location.replace('#/details?id=' + encodeURIComponent(next.jellyfinItemId) + server + refresh);
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

/**
 * "Remove after watching…" in the stock More menu (user, 2026-10-07): an administrator's episode window, on an episode page
 * where the plugin has the episode controls and the episode is not kept by itself. Registered while the page shows.
 */
const useWindowMenuItem = (view: HTMLElement, enabled: boolean, itemIds: string[], open: () => void) => {
    const openRef = useRef(open);
    openRef.current = open;
    const ids = itemIds.join(',');
    useEffect(() => {
        if (!enabled) return;
        const own = ids.split(',');
        return registerMoreMenuItem({
            name: 'Remove After Watching…',
            icon: 'auto_delete',
            // Only this page's own header More button, for this page's own item (or one of its files): a card's menu
            // elsewhere on the page (Next Up, More Like This) is another item's menu and gets nothing.
            matches: options => {
                const button = options.positionTo;
                const header = view.querySelector('.mainDetailButtons');
                return !!button && !!header && document.body.contains(view) && button.classList.contains('btnMoreCommands')
                    && header.contains(button) && own.some(id => sameItemId(id, options.item?.Id));
            },
            run: () => openRef.current()
        }) ?? undefined;
    }, [view, enabled, ids]);
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
    useWindowMenuItem(view, enabled, itemIds, show);
    const value = episode?.retentionPolicy === 'days' && episode.reclaimAfterDays ? String(episode.reclaimAfterDays) : 'inherit';
    const choose = useCallback((next: string) => {
        if (!entryId || !episode) return;
        const count = next === 'inherit' ? null : Number(next);
        const done = count ? `This episode is removed ${windowDays(count)} after watching.` : 'This episode follows its series.';
        change(() => setEpisodeRetention(api, entryId, episode.id, count ? 'days' : 'inherit', count), done).catch(() => undefined);
    }, [api, change, entryId, episode]);
    return enabled ? <EpisodeWindowDialog open={open} value={value} busy={busy} onChange={choose} onClose={close} /> : null;
};

interface SeriesSectionProps {
    api: Api;
    detail: EntryDetail;
    isAdmin: boolean;
    canAcquire: boolean;
    busy: boolean;
    change: (action: () => Promise<unknown>, done: string) => Promise<boolean>;
    openPicker: (opener: HTMLElement) => void;
}

/** The native series page's section, unchanged by the 2026-10-07 design fix: retention list, Search releases, series Keep. */
const SeriesSection: FC<SeriesSectionProps> = ({ api, detail, isAdmin, canAcquire, busy, change, openPicker }) => {
    const section = useRef<HTMLElement>(null);
    // A Keep can remove the very button that made it; focus then falls to the page body, which strands a remote, so it goes
    // to the page's Keep button instead (UX §13).
    useEffect(() => {
        if (busy) return;
        const active = document.activeElement;
        if (active && active !== document.body && active.isConnected) return;
        const target = section.current?.querySelector<HTMLElement>('.jfmod-nativeActions button[aria-pressed]');
        if (target) focusManager.focus(target);
    }, [busy, detail]);
    const searchReleases = useCallback((event: React.MouseEvent<HTMLButtonElement>) => openPicker(event.currentTarget), [openPicker]);
    const keepSeries = useCallback(() => {
        change(() => keepEntry(api, detail.entry.id), keptMessage(false, detail)).catch(() => undefined);
    }, [api, change, detail]);
    // Episodes of this series that are grabbed or downloading; the series entry itself is never projected (P5.I3).
    const inFlightEpisodes = detail.episodes.filter(candidate =>
        candidate.state === FileState.Grabbed || candidate.state === FileState.Downloading);
    const kept = detail.retention.reason === 'kept';
    return <section ref={section} aria-label='JellyfinMod' data-jfmod-entry-id={detail.entry.id}>
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
        <div className='jfmod-nativeActions'>
            {canAcquire && <button className={raisedButtonClass('button-submit')} type='button' onClick={searchReleases}>
                Search Releases
            </button>}
            {isAdmin && <button className={raisedButtonClass()} type='button' aria-busy={busy}
                aria-disabled={busy} aria-pressed={kept} onClick={keepSeries} title='Keep the whole series indefinitely'>
                {keepLabel(true, busy, kept)}
            </button>}
        </div>
        <HistoryToggle label={<>History{detail.history[0] ? ' · ' + detail.history[0].summary : ''}</>}>
            <ol>{detail.history.map(event => <li key={event.id}>
                <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleDateString()}</time>{' · '}{event.summary}
            </li>)}</ol>
        </HistoryToggle>
    </section>;
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

/** Add catalog controls to upstream's own detail page without replacing native playback, seasons or track controls. */
const NativeEntryDetails: FC<NativeEntryDetailsProps> = ({ api, userId, serverId, itemId, isAdmin, view }) => {
    const [busy, setBusy] = useState(false);
    const [historyFor, setHistoryFor] = useState<{ anchor: HTMLElement; version: VersionDto } | null>(null);
    // Every viewer reads the file rows and the badge, so capabilities are read for ordinary users too.
    const capabilities = usePluginCapabilities(api);
    const canAcquire = isAdmin && capabilities.includes(RELEASES_CAPABILITY);
    const queryClient = useQueryClient();
    const detailKey = ['JellyfinMod', api.basePath, userId, 'NativeDetail', itemId];
    const detail = useQuery({
        queryKey: detailKey,
        queryFn: async ({ signal }) => {
            // The server matches any bound copy, and a native episode to its series (P1.P11, P3.T14).
            const entries = await getEntries(api, { jellyfinItemId: itemId, limit: 1 }, { signal });
            const entry = entries.items[0];
            return entry ? getEntry(api, entry.id, { signal }) : null;
        },
        retry: false
    });
    const { data, refetch } = detail;
    const episode = pageEpisode(data, itemId);
    const isSeriesPage = !!data && !episode && data.entry.mediaType === 'series';
    const isFilePage = !!data && !isSeriesPage;
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
            episodeId: episode?.id, intent, onChanged: reload
        }).then(() => restoreFocusTo(opener), () => restoreFocusTo(opener));
    }, [api, data, episode?.id, refetch]);
    const addVersion = useCallback((opener: HTMLElement) => openPicker(opener, 'addVersion'), [openPicker]);
    // Design step 1: the stock-styled header icon; with a file on the page it gets another quality.
    const getRelease = useCallback((button: HTMLElement) => openPicker(button, versions.length > 0 ? 'addVersion' : undefined),
        [openPicker, versions.length]);
    useStockHeaderButton(view, {
        enabled: canAcquire && isFilePage,
        icon: 'cloud_download',
        title: 'Get a Release',
        className: 'jfmod-getRelease',
        onClick: getRelease
    });
    const deleteWarning = usePageDeleteWarning(view, data, versions, capabilities);
    const preferred = usePreferredVersion(api, userId, itemId, versions, capabilities);
    const afterRemove = useCallback((removed: VersionDto) => {
        // The page's data was refetched by the removal; the page moves on from what the plugin now lists.
        leaveAfterRemove(serverId, itemId, queryClient.getQueryData<EntryDetail | null>(detailKey), episode, removed);
    // detailKey is rebuilt from these values on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api.basePath, episode, itemId, queryClient, serverId, userId]);
    const remove = useVersionRemoval({ api, entryId: data?.entry.id, mediaType: data?.entry.mediaType, busy, change,
        onRemoved: afterRemove });
    const canRemove = useCallback((version: VersionDto) => isAdmin && capabilities.includes(VERSIONS_REMOVE_CAPABILITY)
        && !!version.removable && version.tracked !== false, [capabilities, isAdmin]);
    const { pin, onPin } = usePins({ api, data, episode, capabilities, isAdmin, change });
    const refreshAfterPlayed = useCallback(() => {
        refetch().catch(() => undefined);
    }, [refetch]);
    usePlayedRefresh(view, refreshAfterPlayed);
    const { retention, removeDate } = usePageRetention(view, isFilePage ? data : null, episode, versions);
    const showHistory = useCallback((version: VersionDto, anchor: HTMLElement) => setHistoryFor({ anchor, version }), []);
    const closeHistory = useCallback(() => setHistoryFor(null), []);
    const windowDialog = useEpisodeWindow({ api, view, entryId: data?.entry.id,
        episode: isAdmin && capabilities.includes(EPISODE_CONTROLS_CAPABILITY) ? episode : undefined,
        itemIds: [itemId, ...versions.map(version => version.jellyfinItemId), ...versions.map(version => version.mediaSourceId)],
        busy, change });

    if (!detail.data) return null;
    const entry = detail.data.entry;

    if (isSeriesPage) {
        return <SeriesSection api={api} detail={detail.data} isAdmin={isAdmin} canAcquire={canAcquire} busy={busy}
            change={change} openPicker={openPicker} />;
    }

    // The popover lists one file's events, picked by the file's binding; episode-level events are not shown (design step 3).
    const history = detail.data.history;
    return <section aria-label='JellyfinMod' data-jfmod-entry-id={entry.id} data-jfmod-episode-id={episode?.id}>
        {versions.length > 0 && <FileChooser view={view} versions={versions} preferred={preferred} busy={busy}
            onAddVersion={canAcquire ? addVersion : undefined}
            onHistory={capabilities.includes(HISTORY_FILES_CAPABILITY) ? showHistory : undefined}
            pin={pin} onPin={onPin} canRemove={canRemove} onRemove={remove} removeDate={removeDate}
            note={isAdmin ? deleteWarning : null} />}
        <FileHistoryPopover anchor={historyFor?.anchor ?? null} version={historyFor?.version ?? null} history={history}
            onClose={closeHistory} />
        {windowDialog}
        {showsRetentionStatus(retention) && <RetentionStatus retention={retention} />}
        {episode && <QueueStatusLine entryId={entry.id} episodeId={episode.id} state={episode.state} progress={episode.progress} />}
        {!episode && <QueueStatusLine entryId={entry.id} state={entry.state} progress={entry.progress} />}
    </section>;
};

export default NativeEntryDetails;
