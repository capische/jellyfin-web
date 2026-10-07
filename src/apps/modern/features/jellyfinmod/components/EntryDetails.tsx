import type { Api } from '@jellyfin/sdk/lib/api';
import escapeHtml from 'escape-html';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import React, { type FC, type MouseEvent, useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import confirm from 'components/confirm/confirm';
import focusManager from 'components/focusManager';
import layoutManager from 'components/layoutManager';

import { getEntry, type EntryDetail, keepEntry, patchEntry, patchEpisode, refreshEntry, removeEntry } from '../api/modApi';
import { showsRetentionStatus } from '../constants/detailPage';
import { keepButtonLabel } from '../constants/fileState';
import { RELEASES_CAPABILITY, usePluginCapabilities } from '../hooks/useAcquisition';
import { openReleasePicker } from '../integration/releasePicker';
import { restoreFocusTo, useStockHeaderButton } from '../integration/stockHeaderButton';
import type { AcquisitionSummary } from '../types/acquisition';
import { FileState } from '../types/entry';
import { getTmdbImage } from '../utils/entryLinks';
import type { FocusOwnership } from '../utils/focusOwnership';
import FileStateMark from './FileStateMark';
import HistoryToggle from './HistoryToggle';
import QueueStatusLine from './QueueStatusLine';
import RetentionStatus from './RetentionStatus';
import { flatButtonClass, raisedButtonClass } from '../utils/flatButton';

const ACQUISITION_LABELS: Record<AcquisitionSummary['state'], string> = {
    pending: 'Grab held, not sent yet', submitting: 'Sending to the download client', accepted: 'Sent to the download client',
    failed: 'Last grab failed', unknown: 'Grab not confirmed by the download client', cancelled: 'Last grab cancelled'
};

const AcquisitionLine: FC<{ acquisition?: AcquisitionSummary | null }> = ({ acquisition }) => {
    if (!acquisition) return null;
    return <p className='jfmod-acquisitionLine'>{ACQUISITION_LABELS[acquisition.state]}
        {acquisition.releaseTitle ? ' · ' + acquisition.releaseTitle : ''}</p>;
};

import './entryDetails.scss';

interface EntryDetailsProps {
    api: Api;
    detail: EntryDetail;
    view: HTMLElement;
    isAdmin: boolean;
    serverId: string;
    signal: AbortSignal;
    focusOwnership?: FocusOwnership;
}

/**
 * Where upstream's track block would be (design step 5): a mount placed just before the hidden `.trackSelections`, so the
 * raised Get a release (or the queue line while a grab is in flight) sits under the header row like Video, Audio and
 * Subtitles do on a page with a file.
 */
const useTrackBlockMount = (view: HTMLElement, enabled: boolean) => {
    const [node, setNode] = useState<HTMLElement | null>(null);
    useLayoutEffect(() => {
        const tracks = view.querySelector('.trackSelections');
        if (!enabled || !tracks?.parentNode) return;
        const element = document.createElement('div');
        element.className = 'jfmod-trackBlock';
        tracks.parentNode.insertBefore(element, tracks);
        setNode(element);
        return () => {
            element.remove();
            setNode(null);
        };
    }, [view, enabled]);
    return node;
};

/** Reuses the existing detail template's slots without constructing a synthetic native item. */
const EntryDetails: FC<EntryDetailsProps> = ({ api, detail, view, isAdmin, serverId, signal, focusOwnership }) => {
    const [entry, setEntry] = useState(detail.entry);
    const [episodes, setEpisodes] = useState(detail.episodes);
    const [history, setHistory] = useState(detail.history);
    // An older plugin omits the summary; the page must still render (P1.W14).
    const [retention, setRetention] = useState<EntryDetail['retention'] | null>(detail.retention ?? null);
    const [acquisition, setAcquisition] = useState(detail.acquisition ?? null);
    const [message, setMessage] = useState('');
    // Release search is administrator-only and gated on the plugin's advertised capability (P4.A7).
    const capabilities = usePluginCapabilities(api, isAdmin);
    const canAcquire = capabilities.includes(RELEASES_CAPABILITY);
    const [busy, setBusy] = useState(false);
    // A file-less movie is the page the 2026-10-07 design fix redraws: a header icon and a More menu in upstream's header
    // row, and one raised Get a release where the track block would be. A file-less series keeps its rows.
    const isMovie = entry.mediaType === 'movie';
    const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
    const releaseMount = useTrackBlockMount(view, isMovie);
    const mount = (selector: string, content: React.ReactNode) => {
        const node = view.querySelector(selector);
        return node ? createPortal(content, node) : null;
    };
    const poster = getTmdbImage(entry.posterPath);
    const mutate = useCallback(async (action: () => Promise<void>) => {
        setBusy(true);
        setMessage('');
        try {
            await action();
        } catch {
            if (!signal.aborted) setMessage('The change could not be saved. Please try again.');
        } finally {
            if (!signal.aborted) setBusy(false);
        }
    }, [signal]);
    const reload = useCallback(async () => {
        try {
            const updated = await getEntry(api, entry.id, { signal });
            if (signal.aborted) return;
            setEntry(updated.entry);
            setEpisodes(updated.episodes);
            setHistory(updated.history);
            setRetention(updated.retention);
            setAcquisition(updated.acquisition ?? null);
        } catch {
            // The picker already showed the outcome; the page keeps its last good state.
        }
    }, [api, entry.id, signal]);
    const openPicker = useCallback((opener: HTMLElement) => {
        openReleasePicker({
            api, entryId: entry.id, title: entry.title, mediaType: entry.mediaType, episodes,
            episodeId: opener.dataset.episodeId, onChanged: reload
        }).then(() => restoreFocusTo(opener), () => restoreFocusTo(opener));
    }, [api, entry.id, entry.mediaType, entry.title, episodes, reload]);
    const searchReleases = useCallback((event: MouseEvent<HTMLButtonElement>) => openPicker(event.currentTarget), [openPicker]);
    // Design step 1 and the user's decision of 2026-10-07 for this page: Get a release and More in upstream's header row.
    useStockHeaderButton(view, { enabled: canAcquire && isMovie, icon: 'cloud_download', title: 'Get a release',
        className: 'jfmod-getRelease', onClick: openPicker, before: ['jfmod-entryMore'] });
    useStockHeaderButton(view, { enabled: isAdmin && isMovie, icon: 'more_vert', title: 'More', className: 'jfmod-entryMore',
        onClick: setMenuAnchor });
    const closeMenu = useCallback(() => setMenuAnchor(null), []);
    // Declared after the header buttons' hooks, so their inserts exist when this runs (Get a release leads on the TV).
    // On the TV layout the stock detail page focuses its first action; this page mounts its actions itself, so it does
    // the same once they exist (the release action appears when the capabilities arrive), unless focus is already set.
    // On TV the page places focus on its first action, and moves it forward when a new first action arrives (Search
    // releases comes with the capabilities), only while it owns focus: ownership began at viewshow and ends on any user
    // input, and a focus target that was already valid is kept (see utils/focusOwnership).
    useEffect(() => {
        if (!layoutManager.tv || !focusOwnership) return;
        const first = view.querySelector<HTMLElement>('.mainDetailButtons .jfmod-getRelease, .mainDetailButtons .jfmod-entryMore, '
            + '.jfmod-entryActions a, .jfmod-entryActions button, .jfmod-getReleaseRaised');
        if (first && focusOwnership.mayFocus(first)) {
            focusManager.focus(first);
            focusOwnership.placed(first);
        }
    }, [view, canAcquire, isAdmin, focusOwnership, releaseMount]);
    // Busy controls stay focusable (aria-disabled) so D-pad focus is not lost mid-request (P3.T19).
    const toggleMonitoring = useCallback(() => {
        if (busy) return;
        return mutate(async () => {
            const updated = await patchEntry(api, entry.id, !entry.monitored, { signal });
            if (!signal.aborted) setEntry(updated);
        });
    }, [api, busy, entry.id, entry.monitored, mutate, signal]);
    const remove = useCallback(async () => {
        if (busy) return;
        try {
            // Sanitized HTML in the stock dialog: a title from metadata is escaped (whole-review P1 11).
            await confirm({ title: 'Remove entry', text: escapeHtml(`Remove ${entry.title} from the catalog?`),
                confirmText: 'Remove', primary: 'delete' });
        } catch {
            return;
        }
        return mutate(async () => {
            await removeEntry(api, entry.id, { signal });
            if (!signal.aborted) window.location.hash = '#/home';
        });
    }, [api, busy, entry.id, entry.title, mutate, signal]);
    const keep = useCallback(() => {
        if (busy) return;
        return mutate(async () => {
            await keepEntry(api, entry.id, { signal });
            const updated = await getEntry(api, entry.id, { signal });
            if (!signal.aborted) {
                setEntry(updated.entry);
                setEpisodes(updated.episodes);
                setHistory(updated.history);
                setRetention(updated.retention);
                setMessage('This title will be kept.');
            }
        });
    }, [api, busy, entry.id, mutate, signal]);
    const toggleEpisode = useCallback((event: MouseEvent<HTMLButtonElement>) => {
        const id = event.currentTarget.dataset.episodeId;
        const monitored = event.currentTarget.getAttribute('aria-checked') !== 'true';
        if (!id || busy) return;
        return mutate(async () => {
            const updated = await patchEpisode(api, entry.id, id, monitored, { signal });
            if (!signal.aborted) setEpisodes(episodes.map(item => item.id === updated.id ? updated : item));
        });
    }, [api, busy, entry.id, episodes, mutate, signal]);
    const refresh = useCallback(() => {
        if (busy) return;
        return mutate(async () => {
            const updated = await refreshEntry(api, entry.id, { signal });
            if (!signal.aborted) {
                setEntry(updated.entry);
                setEpisodes(updated.episodes);
                setHistory(updated.history);
                setRetention(updated.retention);
                setMessage('Metadata refreshed.');
            }
        });
    }, [api, busy, entry.id, mutate, signal]);
    const monitorFromMenu = useCallback(() => {
        void toggleMonitoring();
    }, [toggleMonitoring]);
    const removeFromMenu = useCallback(() => {
        setMenuAnchor(null);
        void remove();
    }, [remove]);
    const availabilityLabel = (availability: EntryDetail['episodes'][number]['availability']) => {
        if (availability === 'onDisk') return 'On disk';
        if (availability === 'unaired') return 'Unaired';
        if (availability === 'reclaimed') return 'Removed after watching';
        return 'Missing';
    };
    return <>
        {mount('.nameContainer', <h1>{entry.title}</h1>)}
        {mount('.itemMiscInfo-primary', <>{[entry.year, entry.metadata?.runtimeMinutes ? entry.metadata.runtimeMinutes + ' min' : null].filter(Boolean).join(' · ')}</>)}
        {mount('.itemMiscInfo-secondary', entry.metadata?.communityRating ? <>★ {entry.metadata.communityRating.toFixed(1)} on TMDB</> : null)}
        {Array.from(view.querySelectorAll('.detailImageContainer')).map((node, index) => createPortal(
            <div className='jfmod-entryPoster'>{poster && <img src={poster} alt={entry.title} />}<FileStateMark entry={entry} retention={retention} /></div>, node, String(index)))}
        {!isMovie && mount('.mainDetailButtons', <div className='jfmod-entryActions'>
            {entry.jellyfinItemId && <a className={raisedButtonClass('button-submit')}
                href={'#/details?id=' + encodeURIComponent(entry.jellyfinItemId) + '&serverId=' + encodeURIComponent(serverId)}>
                Open in Jellyfin
            </a>}
            {canAcquire && <button className={raisedButtonClass('button-submit')} type='button'
                onClick={searchReleases}>
                {entry.state === 'reclaimed' ? 'Get again' : 'Search releases'}
            </button>}
            {isAdmin && <>
                <button className={raisedButtonClass()} type='button' aria-busy={busy}
                    aria-disabled={busy} aria-pressed={retention?.reason === 'kept'} onClick={keep}>
                    {keepButtonLabel(busy, retention?.reason === 'kept')}
                </button>
                <button className={raisedButtonClass()} type='button' role='switch' aria-checked={entry.monitored}
                    aria-disabled={busy} onClick={toggleMonitoring}>
                    {entry.monitored ? '☑' : '☐'} Monitor
                </button>
                <button className={flatButtonClass()} type='button' aria-disabled={busy}
                    onClick={remove}>Remove entry</button>
                {entry.mediaType === 'series' && <button className={flatButtonClass()} type='button' aria-disabled={busy}
                    onClick={refresh}>Refresh metadata</button>}
            </>}
        </div>)}
        {isMovie && <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={closeMenu} className='jfmod-entryMenu'>
            <MenuItem role='menuitemcheckbox' aria-checked={entry.monitored} aria-disabled={busy} onClick={monitorFromMenu}
                data-jfmod-menu='monitor'>
                <ListItemIcon><span className={'material-icons ' + (entry.monitored ? 'check_box' : 'check_box_outline_blank')}
                    aria-hidden='true' /></ListItemIcon>
                <ListItemText>Monitor</ListItemText>
            </MenuItem>
            <MenuItem onClick={removeFromMenu} aria-disabled={busy} data-jfmod-menu='remove'>
                <ListItemIcon><span className='material-icons delete' aria-hidden='true' /></ListItemIcon>
                <ListItemText>Remove entry</ListItemText>
            </MenuItem>
        </Menu>}
        {isMovie && releaseMount && createPortal(entry.state === FileState.Grabbed || entry.state === FileState.Downloading ?
            <QueueStatusLine entryId={entry.id} state={entry.state} progress={entry.progress} /> :
            canAcquire && <button className={raisedButtonClass('button-submit jfmod-getReleaseRaised')} type='button' onClick={searchReleases}>
                <span className='material-icons cloud_download' aria-hidden='true' />
                <span>Get a release</span>
            </button>, releaseMount)}
        {mount('.itemGenres', entry.metadata?.genres.join(' · '))}
        {mount('.overview', entry.overview)}
        {mount('.itemDetailsGroup', <>
            <p role='status'>{message}</p>
            {showsRetentionStatus(retention) && <RetentionStatus retention={retention} />}
            <AcquisitionLine acquisition={acquisition} />
            {!isMovie && <QueueStatusLine entryId={entry.id} state={entry.state} progress={entry.progress} />}
            <HistoryToggle label={<>History{history[0] ? ' · ' + history[0].summary : ''}</>}>
                <ol>{history.map(event => <li key={event.id}>
                    <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleDateString()}</time>{' · '}{event.summary}
                </li>)}</ol>
            </HistoryToggle>
            {episodes.length > 0 && <section aria-label='Episodes'>
                <h2>Episodes</h2>
                {episodes.map(episode => <div className='jfmod-episodeRow' key={episode.id}>
                    <span>S{episode.seasonNumber} E{episode.episodeNumber} · {episode.title}</span>
                    <span>{episode.jellyfinItemId ? <a href={'#/details?id=' + encodeURIComponent(episode.jellyfinItemId) + '&serverId=' + encodeURIComponent(serverId)}>Open episode</a> : availabilityLabel(episode.availability)}</span>
                    <RetentionStatus retention={episode.retention} compact />
                    <AcquisitionLine acquisition={episode.acquisition} />
                    <QueueStatusLine entryId={entry.id} episodeId={episode.id} state={episode.state} progress={episode.progress} />
                    {canAcquire && <button className={flatButtonClass()} type='button' data-episode-id={episode.id}
                        onClick={searchReleases}>Search releases</button>}
                    {isAdmin && <button className={flatButtonClass()} type='button' role='switch' aria-checked={episode.monitored}
                        aria-disabled={busy} data-episode-id={episode.id} onClick={toggleEpisode}>
                        {episode.monitored ? '☑' : '☐'} Monitor
                    </button>}
                </div>)}
            </section>}
        </>)}
    </>;
};

export default EntryDetails;
