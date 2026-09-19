import type { Api } from '@jellyfin/sdk/lib/api';
import { useQuery } from '@tanstack/react-query';
import React, { type FC, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';

import focusManager from 'components/focusManager';

import { type EntryDetail, getEntries, getEntry, keepEntry } from '../api/modApi';
import { keepButtonLabel } from '../constants/fileState';
import { AUTOMATION_CAPABILITY } from '../constants/queue';
import { sameItemId, VERSIONS_CAPABILITY } from '../constants/versions';
import { RELEASES_CAPABILITY, usePluginCapabilities } from '../hooks/useAcquisition';
import { openReleasePicker } from '../integration/releasePicker';
import { type EntryEpisode, FileState } from '../types/entry';
import HistoryToggle from './HistoryToggle';
import QueueStatusLine from './QueueStatusLine';
import RetentionStatus from './RetentionStatus';
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
    const keep = useCallback(async () => {
        if (busy || !detail.data) return;
        setBusy(true);
        setMessage('');
        try {
            await keepEntry(api, detail.data.entry.id);
            const refreshed = await detail.refetch();
            if (refreshed.error) throw refreshed.error;
            setMessage('This title will be kept.');
        } catch {
            setMessage('The change could not be saved. Please try again.');
        } finally {
            setBusy(false);
        }
    }, [api, busy, detail]);
    const { data, refetch } = detail;
    const sameId = (value?: string | null) => sameItemId(value, itemId);
    const episode = data?.episodes.find(candidate => sameId(candidate.jellyfinItemId));
    const addVersion = useCallback((opener: HTMLElement) => {
        if (!data) return;
        const reload = () => {
            refetch().catch(() => undefined);
        };
        openReleasePicker({
            api, entryId: data.entry.id, title: data.entry.title, mediaType: data.entry.mediaType, episodes: data.episodes,
            episodeId: episode?.id, intent: 'addVersion', onChanged: reload
        }).then(() => restoreFocus(opener), () => restoreFocus(opener));
    }, [api, data, episode?.id, refetch]);
    if (!detail.data) return null;
    // A native episode page shows its own retention; a native series page lists every episode's (P3.T14).
    const isSeriesPage = !episode && detail.data.entry.mediaType === 'series';
    // Episodes of this series that are grabbed or downloading; the series entry itself is never projected (P5.I3).
    const inFlightEpisodes = isSeriesPage ? detail.data.episodes.filter(candidate =>
        candidate.state === FileState.Grabbed || candidate.state === FileState.Downloading) : [];
    const { versions, canAddVersion, canSearchNow } = versionSurfaces(detail.data, episode, capabilities, canAcquire, isAdmin);
    // The native More menu reads these to offer Search releases, Get another quality and Search now (P4.A7, P6.M8).
    return <section aria-label='JellyfinMod' data-jfmod-entry-id={detail.data.entry.id}
        data-jfmod-episode-id={episode?.id}
        data-jfmod-can-acquire={canAcquire ? 'true' : undefined}
        data-jfmod-can-add-version={canAddVersion ? 'true' : undefined}
        data-jfmod-can-search-now={canSearchNow ? 'true' : undefined}>
        {versions.length > 0 && versionsMount && createPortal(
            <VersionRows view={view} versions={versions} onAddVersion={canAddVersion ? addVersion : undefined} />, versionsMount)}
        <p role='status'>{message}</p>
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
        {isAdmin && <button className='emby-button raised' type='button' aria-busy={busy}
            aria-disabled={busy} aria-pressed={detail.data.retention.reason === 'kept'} onClick={keep}>
            {keepButtonLabel(busy, detail.data.retention.reason === 'kept')}
        </button>}
        <HistoryToggle label={<>History{detail.data.history[0] ? ' · ' + detail.data.history[0].summary : ''}</>}>
            <ol>{detail.data.history.map(event => <li key={event.id}>
                <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleDateString()}</time>{' · '}{event.summary}
            </li>)}</ol>
        </HistoryToggle>
    </section>;
};

export default NativeEntryDetails;
