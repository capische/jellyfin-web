import type { Api } from '@jellyfin/sdk/lib/api';
import { useQuery } from '@tanstack/react-query';
import React, { type FC, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';

import focusManager from 'components/focusManager';

import { type EntryDetail, getEntries, getEntry, keepEntry, keepEpisode, requestSearch } from '../api/modApi';
import { EPISODE_RETENTION_CAPABILITY, keepButtonLabel } from '../constants/fileState';
import { AUTOMATION_CAPABILITY } from '../constants/queue';
import { sameItemId, VERSIONS_CAPABILITY } from '../constants/versions';
import { RELEASES_CAPABILITY, usePluginCapabilities } from '../hooks/useAcquisition';
import { openReleasePicker } from '../integration/releasePicker';
import { type EntryEpisode, FileState } from '../types/entry';
import HistoryToggle from './HistoryToggle';
import QueueStatusLine from './QueueStatusLine';
import RetentionControls from './RetentionControls';
import RetentionStatus from './RetentionStatus';
import RetentionWarning from './RetentionWarning';
import VersionRows from './VersionRows';
import './entryDetails.scss';

interface NativeEntryDetailsProps {
    api: Api;
    userId: string;
    itemId: string;
    isAdmin: boolean;
    /** The native detail view, whose stock `.selectSource` the version rows drive (P6.M8). */
    view: HTMLElement;
    /** Where the version rows render: beside the stock track selections, never inside them. */
    versionsMount?: HTMLElement | null;
}

/** Back from the picker returns to the row that opened it; the dialog helper already does this on TV (UX §13). */
const restoreFocus = (opener: HTMLElement) => {
    const active = document.activeElement;
    if (!opener.isConnected || (active && active !== document.body && document.body.contains(active))) return;
    focusManager.focus(opener);
};

/**
 * What Phase 6 adds to this page (P6.M8): the versions of this movie or this episode (a series page has none of its
 * own), Get another quality where there is a version to add beside and release search, and Search now for an
 * upgrade-eligible movie. A title without a file is served by the file-less page, which has its own Search now.
 */
const versionSurfaces = (detail: EntryDetail, episode: EntryEpisode | undefined, capabilities: string[], canAcquire: boolean,
    isAdmin: boolean) => {
    const isMoviePage = !episode && detail.entry.mediaType === 'movie';
    const versions = (episode ? episode.versions : undefined) ?? (isMoviePage ? detail.versions : undefined) ?? [];
    const showVersions = capabilities.includes(VERSIONS_CAPABILITY) && versions.length > 0;
    return {
        versions: showVersions ? versions : [],
        canAddVersion: showVersions && canAcquire,
        canSearchNow: isAdmin && isMoviePage && capabilities.includes(AUTOMATION_CAPABILITY) && !!detail.upgrade?.eligible
    };
};

/** What a Keep on this page keeps, in words (RET-R7): an untracked episode page keeps the whole series. */
const keptMessage = (keepsEpisode: boolean, detail: EntryDetail): string => {
    if (keepsEpisode) return 'This episode will be kept.';
    if (detail.entry.mediaType === 'series') return `The series ${detail.entry.title} will be kept.`;
    return 'This title will be kept.';
};

const keepLabel = (keepsSeries: boolean, busy: boolean, kept: boolean): string => {
    if (!keepsSeries || busy) return keepButtonLabel(busy, kept);
    return kept ? 'Series kept' : 'Keep series';
};

/** The running window of this episode, or of this movie (PHASE10 Q8); a series page has none of its own. */
const pageWarning = (detail: EntryDetail, episode: EntryEpisode | undefined) =>
    episode ? episode.retentionWarning : detail.retentionWarning;

const warningKeepLabel = (keepsEpisode: boolean, keepsSeries: boolean) =>
    keepsEpisode ? 'Keep this episode' : keepLabel(keepsSeries, false, false);

/** Add catalog history without replacing native playback, seasons or track controls. */
const NativeEntryDetails: FC<NativeEntryDetailsProps> = ({ api, userId, itemId, isAdmin, view, versionsMount }) => {
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    // Every viewer reads the version rows, so capabilities are read for ordinary users too.
    const capabilities = usePluginCapabilities(api);
    const canAcquire = isAdmin && capabilities.includes(RELEASES_CAPABILITY);
    const detail = useQuery({
        queryKey: ['JellyfinMod', api.basePath, userId, 'NativeDetail', itemId],
        queryFn: async ({ signal }) => {
            // The server matches any bound copy, and a native episode to its series (P1.P11, P3.T14).
            const entries = await getEntries(api, { jellyfinItemId: itemId, limit: 1 }, { signal });
            const entry = entries.items[0];
            return entry ? getEntry(api, entry.id, { signal }) : null;
        },
        retry: false
    });
    const { data, refetch } = detail;
    const sameId = (value?: string | null) => sameItemId(value, itemId);
    // Any file of the episode opens its page, not only the one the plugin selected (P10.E3).
    const episode = data?.episodes.find(candidate => sameId(candidate.jellyfinItemId)
        || (candidate.versions ?? []).some(version => sameId(version.jellyfinItemId)));
    // An episode page keeps that episode alone where the plugin supports it; the series page keeps the series (P10.E2).
    const keepsEpisode = !!episode && capabilities.includes(EPISODE_RETENTION_CAPABILITY);
    const change = useCallback(async (action: () => Promise<unknown>, done: string) => {
        if (busy) return;
        setBusy(true);
        setMessage('');
        try {
            await action();
            const refreshed = await refetch();
            if (refreshed.error) throw refreshed.error;
            setMessage(done);
        } catch {
            setMessage('The change could not be saved. Please try again.');
        } finally {
            setBusy(false);
        }
    }, [busy, refetch]);
    const keep = useCallback(() => {
        if (!data) return;
        const action = keepsEpisode && episode ? () => keepEpisode(api, data.entry.id, episode.id) : () => keepEntry(api, data.entry.id);
        change(action, keptMessage(keepsEpisode, data)).catch(() => undefined);
    }, [api, change, data, episode, keepsEpisode]);
    const openPicker = useCallback((opener: HTMLElement, intent?: 'addVersion') => {
        if (!data) return;
        const reload = () => {
            refetch().catch(() => undefined);
        };
        openReleasePicker({
            api, entryId: data.entry.id, title: data.entry.title, mediaType: data.entry.mediaType, episodes: data.episodes,
            episodeId: episode?.id, intent, onChanged: reload
        }).then(() => restoreFocus(opener), () => restoreFocus(opener));
    }, [api, data, episode?.id, refetch]);
    const addVersion = useCallback((opener: HTMLElement) => openPicker(opener, 'addVersion'), [openPicker]);
    const searchReleases = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
        openPicker(event.currentTarget);
    }, [openPicker]);
    const addVersionFromButton = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
        addVersion(event.currentTarget);
    }, [addVersion]);
    const searchNow = useCallback(async () => {
        if (busy || !data) return;
        setBusy(true);
        setMessage('');
        try {
            await requestSearch(api, data.entry.id);
            setMessage('Search requested. The next automation run searches this title.');
        } catch {
            setMessage('The search could not be requested. Please try again.');
        } finally {
            setBusy(false);
        }
    }, [api, busy, data]);
    if (!detail.data) return null;
    // A native episode page shows its own retention; a native series page lists every episode's (P3.T14).
    const isSeriesPage = !episode && detail.data.entry.mediaType === 'series';
    // Episodes of this series that are grabbed or downloading; the series entry itself is never projected (P5.I3).
    const inFlightEpisodes = isSeriesPage ? detail.data.episodes.filter(candidate =>
        candidate.state === FileState.Grabbed || candidate.state === FileState.Downloading) : [];
    const { versions, canAddVersion, canSearchNow } = versionSurfaces(detail.data, episode, capabilities, canAcquire, isAdmin);
    const kept = (keepsEpisode ? episode?.retention?.reason : detail.data.retention.reason) === 'kept';
    const keepsSeries = !keepsEpisode && detail.data.entry.mediaType === 'series';
    const warning = pageWarning(detail.data, episode);
    // An episode page lists that episode's own events; the series and movie pages list every event (P10.E3).
    const history = keepsEpisode && episode ?
        detail.data.history.filter(event => event.episodeId && sameItemId(event.episodeId, episode.id)) :
        detail.data.history;
    return <section aria-label='JellyfinMod' data-jfmod-entry-id={detail.data.entry.id}
        data-jfmod-episode-id={episode?.id}>
        {versions.length > 0 && versionsMount && createPortal(
            <VersionRows view={view} versions={versions} onAddVersion={canAddVersion ? addVersion : undefined} />, versionsMount)}
        <p role='status'>{message}</p>
        {warning && <RetentionWarning warning={warning} busy={busy} onKeep={isAdmin ? keep : undefined}
            keepLabel={warningKeepLabel(keepsEpisode, keepsSeries)} />}
        <RetentionStatus retention={episode ? episode.retention : detail.data.retention} />
        {episode && <QueueStatusLine entryId={detail.data.entry.id} episodeId={episode.id} state={episode.state} progress={episode.progress} />}
        {!episode && detail.data.entry.mediaType === 'movie'
            && <QueueStatusLine entryId={detail.data.entry.id} state={detail.data.entry.state} progress={detail.data.entry.progress} />}
        {inFlightEpisodes.map(candidate => <div className='jfmod-episodeRow' key={'queue:' + candidate.id}>
            <span>S{candidate.seasonNumber} E{candidate.episodeNumber} · {candidate.title}</span>
            <QueueStatusLine entryId={candidate.entryId} episodeId={candidate.id} state={candidate.state} progress={candidate.progress} />
        </div>)}
        {isSeriesPage && detail.data.episodes.some(candidate => candidate.retention) && <HistoryToggle label='Episode retention'>
            {detail.data.episodes.map(candidate => <div className='jfmod-episodeRow' key={candidate.id}>
                <span>S{candidate.seasonNumber} E{candidate.episodeNumber} · {candidate.title}</span>
                <RetentionStatus retention={candidate.retention} compact />
            </div>)}
        </HistoryToggle>}
        {/*
          * The mod's own actions, at the mod's own call site (P7.S6).
          *
          * These used to be appended to the stock More menu, which meant wrapping `itemContextMenu.show` inside
          * upstream's detail controller. The mod interface owns this route now, so the wrap — and the patch to
          * `itemDetails/index.js` that carried it — is gone, and the commands are plain buttons beside Keep.
          */}
        <div className='jfmod-nativeActions'>
            {canAcquire && <button className='emby-button raised' type='button' onClick={searchReleases}>
                Search releases
            </button>}
            {canAddVersion && <button className='emby-button raised' type='button'
                onClick={addVersionFromButton}>
                Get another quality
            </button>}
            {canSearchNow && <button className='emby-button raised' type='button' aria-disabled={busy}
                onClick={searchNow}>Search now</button>}
            {isAdmin && <button className='emby-button raised' type='button' aria-busy={busy}
                aria-disabled={busy} aria-pressed={kept} onClick={keep}
                title={keepsSeries ? 'Keep the whole series indefinitely' : 'Keep indefinitely'}>
                {keepLabel(keepsSeries, busy, kept)}
            </button>}
            {isAdmin && <RetentionControls api={api} entryId={detail.data.entry.id} busy={busy} change={change}
                episode={keepsEpisode ? episode : undefined} versions={versions} capabilities={capabilities} />}
        </div>
        <HistoryToggle label={<>History{history[0] ? ' · ' + history[0].summary : ''}</>}>
            <ol>{history.map(event => <li key={event.id}>
                <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleDateString()}</time>{' · '}{event.summary}
            </li>)}</ol>
        </HistoryToggle>
    </section>;
};

export default NativeEntryDetails;
