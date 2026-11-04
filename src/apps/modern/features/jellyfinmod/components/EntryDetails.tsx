import type { Api } from '@jellyfin/sdk/lib/api';
import escapeHtml from 'escape-html';
import React, { type FC, type MouseEvent, useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import confirm from 'components/confirm/confirm';
import focusManager from 'components/focusManager';
import layoutManager from 'components/layoutManager';

import { announce } from '../integration/announce';
import { invalidateCatalog } from '../integration/invalidateCatalog';
import { getEntry, type EntryDetail, keepEntry, patchEntry, patchEpisode, refreshEntry, removeEntry } from '../api/modApi';
import { openNativePage, useLiveEntryDetail } from '../hooks/useEntries';
import { showsRetentionStatus } from '../constants/detailPage';
import { keepButtonLabel } from '../constants/fileState';
import { RELEASES_CAPABILITY, usePluginCapabilities } from '../hooks/useAcquisition';
import { openReleasePicker, useEpisodeListLoad } from '../integration/releasePicker';
import { restoreFocusTo, useStockHeaderButton } from '../integration/stockHeaderButton';
import type { AcquisitionSummary } from '../types/acquisition';
import { getEntryPath, getTmdbImage } from '../utils/entryLinks';
import type { FocusOwnership } from '../utils/focusOwnership';
import FileStateMark from './FileStateMark';
import HistoryToggle from './HistoryToggle';
import QueueStatusLine from './QueueStatusLine';
import RatingsGroup from './RatingsGroup';
import { useRatingsRefresh } from './RatingsRefreshButton';
import type { Rating } from '../types/ratings';
import TitlePoster from './TitlePoster';
import LibraryUndo from './LibraryUndo';
import RetentionStatus from './RetentionStatus';
import { useRatingsPreferences } from '../hooks/useRatingsPreferences';

const ACQUISITION_LABELS: Record<AcquisitionSummary['state'], string> = {
    pending: 'Grab held, not sent yet', submitting: 'Sending to the download client', accepted: 'Sent to the download client',
    failed: 'Last grab failed', unknown: 'Grab not confirmed by the download client', cancelled: 'Last grab cancelled'
};

const AcquisitionLine: FC<{ acquisition?: AcquisitionSummary | null }> = ({ acquisition }) => {
    if (!acquisition) return null;
    return <p className='tags'>{ACQUISITION_LABELS[acquisition.state]}
        {acquisition.releaseTitle ? ' · ' + acquisition.releaseTitle : ''}</p>;
};

import { DesignEnvironment } from '../design/Root';
import { Menu } from '../design/Menu';
import { Icon } from '../design/Icon';
import DownloadBlock from './DownloadBlock';
import { BrowseCell } from '../design/BrowsePage';
import { TitleRow } from '../design/TitleRow';

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
 * Refresh Ratings in a file-less movie's More menu, whose actions are all there (review 2026-10-28, P2 3); the menu opens for
 * administrators only, and the item shows only where the plugin offers the refresh.
 */
const useRefreshRatingsMenuItem = (api: Api, entryId: string, onDone: (ratings: Rating[]) => void,
    closeMenu: (anchor: null) => void) => {
    const { available, busy, run } = useRatingsRefresh({ api, entryId, onMessage: announce, onDone });
    const choose = useCallback(() => {
        closeMenu(null);
        run();
    }, [closeMenu, run]);
    return available ? <button type='button' className='mi focusable' onClick={choose} aria-disabled={busy} data-jfmod-menu='refresh-ratings'>
        <Icon name='star' /><span className='tx0'>Refresh Ratings</span>
    </button> : null;
};

const EntryDetails: FC<EntryDetailsProps> = ({ api, detail, view, isAdmin, serverId, signal, focusOwnership }) => {
    const [entry, setEntry] = useState(detail.entry);
    // A title with no file opens Jellyfin's page once Jellyfin holds an item for it: its placeholder, written while the page is
    // open (the backfill, P1.FU27), or its file. The route opens it when the page is opened later.
    const live = useLiveEntryDetail(api, detail);
    const titleItem = live.entry.jellyfinItemId || live.entry.placeholderItemId;
    useEffect(() => {
        if (titleItem && !signal.aborted) openNativePage(titleItem, serverId);
    }, [titleItem, serverId, signal]);
    const [episodes, setEpisodes] = useState(detail.episodes);
    const [history, setHistory] = useState(detail.history);
    // An older plugin omits the summary; the page must still render (P1.W14).
    const [retention, setRetention] = useState<EntryDetail['retention'] | null>(detail.retention ?? null);
    const [acquisition, setAcquisition] = useState(detail.acquisition ?? null);
    // Ratings come with the entry; the user's choice is loaded before the page mounts (entryDetails.js), so the line is in the
    // page's first paint (Phase 9). An older plugin sends none.
    const [ratings, setRatings] = useState(detail.ratings);
    // Whether the ratings group hides the page's own star (it tells, from its own layout decision).
    const [groupHidesStar, setGroupHidesStar] = useState(false);
    const ratingsPreferences = useRatingsPreferences(api);
    // A series discovered in the library lists only its files until its TMDB list loads (P1.FU); an older plugin omits it.
    const [listLoaded, setListLoaded] = useState(detail.episodeListLoaded !== false);
    // Release search is administrator-only and gated on the plugin's advertised capability (P4.A7).
    const capabilities = usePluginCapabilities(api, isAdmin);
    const canAcquire = capabilities.includes(RELEASES_CAPABILITY);
    const [busy, setBusy] = useState(false);
    // A file-less movie is the page the 2026-10-07 design fix redraws: a header icon and a More menu in upstream's header
    // row, and one raised Get a release where the track block would be. A file-less series keeps its rows.
    const isMovie = entry.mediaType === 'movie';
    const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

    const mount = (selector: string, content: React.ReactNode) => {
        const node = view.querySelector(selector === '.itemDetailsGroup' ? '[data-ds-slot="augment"]' : selector);
        return node ? createPortal(content, node) : null;
    };
    const poster = getTmdbImage(entry.posterPath);
    const mutate = useCallback(async (action: () => Promise<void>) => {
        setBusy(true);
        try {
            await action();
        } catch {
            if (!signal.aborted) announce('The change could not be saved. Please try again.');
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
            setListLoaded(updated.episodeListLoaded !== false);
        } catch {
            // The picker already showed the outcome; the page keeps its last good state.
        }
    }, [api, entry.id, signal]);
    const openPicker = useCallback((opener: HTMLElement) => {
        openReleasePicker({
            api, entryId: entry.id, title: entry.title, mediaType: entry.mediaType, episodes,
            // An episode row's search offers that episode, its season and All Seasons, as an episode's page does.
            episodeId: opener.dataset.episodeId, episodePage: !!opener.dataset.episodeId, episodeListLoaded: listLoaded,
            onChanged: reload
        }).then(() => restoreFocusTo(opener), () => restoreFocusTo(opener));
    }, [api, entry.id, entry.mediaType, entry.title, episodes, listLoaded, reload]);
    // Anyone opening a discovered series sees every season and episode, not only its files: the page loads the TMDB list
    // once (P1.FU9), sharing the request with a picker opened meanwhile, then refetches. A failure keeps the list.
    useEpisodeListLoad(api, { ...detail, entry, episodeListLoaded: listLoaded }, reload);
    const searchReleases = useCallback((event: MouseEvent<HTMLButtonElement>) => openPicker(event.currentTarget), [openPicker]);
    // Design step 1 and the user's decision of 2026-10-07 for this page: Get a release and More in upstream's header row.
    useStockHeaderButton(view, { enabled: canAcquire, icon: 'cloud_download', title: 'Get a Release',
        className: 'jfmod-getRelease', onClick: openPicker, before: ['jfmod-entryMore'] });
    useStockHeaderButton(view, { enabled: isAdmin, icon: 'more_vert', title: 'More', className: 'jfmod-entryMore',
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
        const first = view.querySelector<HTMLElement>('.jfmod-dsTitleHost .actbar button');
        if (first && focusOwnership.mayFocus(first)) {
            focusManager.focus(first);
            focusOwnership.placed(first);
        }
    }, [view, canAcquire, isAdmin, focusOwnership]);
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
            await confirm({ title: 'Remove Entry', text: escapeHtml(`Remove ${entry.title} from the catalog?`),
                confirmText: 'Remove', primary: 'delete' });
        } catch {
            return;
        }
        return mutate(async () => {
            await removeEntry(api, entry.id, { signal });
            invalidateCatalog(api);
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
                announce('This title will be kept.');
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
                setListLoaded(true);
                announce('Metadata refreshed.');
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
    const rereadRatings = useCallback((updated: Rating[]) => {
        if (!signal.aborted) setRatings(updated);
    }, [signal]);
    const refreshRatingsItem = useRefreshRatingsMenuItem(api, entry.id, rereadRatings, setMenuAnchor);
    return <>
        {view.querySelector('[data-ds-slot="ratings"]') && createPortal(<DesignEnvironment><RatingsGroup ratings={ratingsPreferences.enabled ? ratings : []} sources={ratingsPreferences.sources} ready={ratingsPreferences.loaded}
            wanted={ratingsPreferences.loaded ? ratingsPreferences.enabled : undefined} ownStar onHidesStar={setGroupHidesStar} /></DesignEnvironment>, view.querySelector('[data-ds-slot="ratings"]')!)}
        {isMovie && <DownloadBlock anchor={view.querySelector('.trackSelections')} entryId={entry.id}
            episode={{ id: null, state: entry.state, progress: entry.progress, availability: 'missing', airDate: null }} isAdmin={isAdmin}
            canAcquire={canAcquire} onGetRelease={openPicker} onChanged={reload} />}
        <LibraryUndo entryId={entry.id} view={view} />
        {mount('.nameContainer', <h1>{entry.title}</h1>)}
        {mount('.itemMiscInfo-primary', <>
            {entry.year && <span className='mediaInfoItem'>{entry.year}</span>}
            {entry.metadata?.runtimeMinutes ? <span className='mediaInfoItem'>{entry.metadata.runtimeMinutes + ' min'}</span> : null}
            {/* The page's own star (TMDB's score) gives way whenever the group shows, as the group itself decides (user,
                2026-10-30; Codex review 2026-10-30, P2 2: one source of truth, fallback and reservation included). */}
            {entry.metadata?.communityRating && !groupHidesStar ?
                <span className='jfmod-entryStar'>★ {entry.metadata.communityRating.toFixed(1)} on TMDB</span> : null}

        </>)}
        {Array.from(view.querySelectorAll('.detailImageContainer')).map((node, index) => createPortal(
            <TitlePoster src={poster} title={entry.title}><FileStateMark entry={entry} retention={retention} interactive={false} /></TitlePoster>, node, String(index)))}
        {menuAnchor && <DesignEnvironment><Menu anchor={menuAnchor} close={closeMenu} label='More'>
            <button type='button' className='mi focusable' role='menuitemcheckbox' aria-checked={entry.monitored} aria-disabled={busy} onClick={monitorFromMenu}
                data-jfmod-menu='monitor'><Icon name='check' /><span className='tx0'>{entry.monitored ? 'Stop Monitoring' : 'Monitor'}</span></button>
            {!isMovie && <>
                <button type='button' className='mi focusable' aria-disabled={busy} aria-pressed={retention?.reason === 'kept'} onClick={keep}><Icon name='pin' /><span className='tx0'>{keepButtonLabel(busy, retention?.reason === 'kept')}</span></button>
                <button type='button' className='mi focusable' aria-disabled={busy} onClick={refresh}><Icon name='history' /><span className='tx0'>Refresh Metadata</span></button>
            </>}
            {refreshRatingsItem}
            <button type='button' className='mi focusable' onClick={removeFromMenu} aria-disabled={busy} data-jfmod-menu='remove'>
                <Icon name='close' /><span className='tx0'>Remove Entry</span>
            </button>
        </Menu></DesignEnvironment>}
        {mount('.itemGenres', entry.metadata?.genres.join(' · '))}
        {mount('.overview', entry.overview)}
        {mount('.itemDetailsGroup', <>
            {showsRetentionStatus(retention) && <RetentionStatus retention={retention} />}
            <AcquisitionLine acquisition={acquisition} />
            {!isMovie && <QueueStatusLine entryId={entry.id} state={entry.state} progress={entry.progress} />}
            <HistoryToggle label='History' summary={history[0]?.summary}>
                <div role='list'>{history.map(event => <div className='er' role='listitem' key={event.id}><span>
                    <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleDateString()}</time>{' · '}{event.summary}
                </span></div>)}</div>
            </HistoryToggle>
            {view.querySelector('[data-ds-slot="sections"]') && createPortal(<>
                {!isMovie && <TitleRow title='Seasons' name='seasons'>{[...new Set(episodes.map(episode => episode.seasonNumber))].filter(number => number > 0).sort((a, b) => a - b).map(number => {
                    const metadata = entry.metadata?.seasons.find(season => season.number === number);
                    return <BrowseCell key={number} title={metadata?.name || 'Season ' + number} second={episodes.filter(episode => episode.seasonNumber === number).length + ' episodes'}
                        image={getTmdbImage(metadata?.posterPath ?? entry.posterPath)} href={'#' + getEntryPath(entry.id, serverId) + '&season=' + number} />;
                })}</TitleRow>}
                {(entry.metadata?.cast?.length ?? 0) > 0 && <TitleRow title='Cast & Crew' name='cast'>{entry.metadata?.cast?.map(person => <BrowseCell key={person.id + ':' + person.order} person
                    title={person.name} second={person.character ?? undefined} image={getTmdbImage(person.profilePath, 'w185')} />)}</TitleRow>}
            </>, view.querySelector('[data-ds-slot="sections"]')!)}
            {episodes.length > 0 && <HistoryToggle label='Episodes' summary='Monitoring and release actions'>
                <div>{episodes.map(episode => <div className='er' key={episode.id} data-jfmod-episode-id={episode.id}>
                    <span><span><a className='focusable' href={episode.jellyfinItemId ? '#/details?id=' + encodeURIComponent(episode.jellyfinItemId) + '&serverId=' + encodeURIComponent(serverId) :
                        '#' + getEntryPath(entry.id, serverId) + '&season=' + episode.seasonNumber + '&episode=' + episode.episodeNumber}>S{episode.seasonNumber} E{episode.episodeNumber} · {episode.title}</a></span> · {availabilityLabel(episode.availability)}
                    <RetentionStatus retention={episode.retention} compact /><AcquisitionLine acquisition={episode.acquisition} />
                    <QueueStatusLine entryId={entry.id} episodeId={episode.id} state={episode.state} progress={episode.progress} /></span>
                    <span>
                        {canAcquire && <button className='rb focusable' type='button' data-episode-id={episode.id}
                            title='Search Releases' aria-label={`Search releases for S${episode.seasonNumber} E${episode.episodeNumber}`} onClick={searchReleases}><Icon name='cloud' /></button>}
                        {isAdmin && <button className={'rb focusable' + (episode.monitored ? ' on' : '')} type='button' role='switch' aria-checked={episode.monitored}
                            aria-disabled={busy} data-episode-id={episode.id} title={episode.monitored ? 'Stop Monitoring' : 'Monitor'}
                            aria-label={`Monitor S${episode.seasonNumber} E${episode.episodeNumber}`} onClick={toggleEpisode}><Icon name='check' /></button>}
                    </span>
                </div>)}</div>
            </HistoryToggle>}
        </>)}
    </>;
};

const DesignEntryDetails: FC<EntryDetailsProps> = props => <DesignEnvironment><EntryDetails {...props} /></DesignEnvironment>;
export default DesignEntryDetails;
