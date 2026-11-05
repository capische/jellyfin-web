import type { Api } from '@jellyfin/sdk/lib/api';
import { useEffect, useRef } from 'react';

import dialogHelper from 'components/dialogHelper/dialogHelper';
import layoutManager from 'components/layoutManager';
import { renderComponent } from 'utils/reactUtils';

import { type EntryDetail, getEntry, loadEntryEpisodeList } from '../api/modApi';
import { type ReleasePickerEpisode } from '../components/ReleasePickerDialog';
import { ReleasePicker } from '../design/ReleasePicker';
import { isTopDialog, returnFocus } from '../design/dialogHost';
import { getKeyName } from 'scripts/keyboardNavigation';
import { isBackKey } from '../shell/dpadModals';
import type { ReleaseIntent } from '../types/acquisition';
import type { EntryEpisode } from '../types/entry';

interface OpenOptions {
    api: Api;
    entryId: string;
    title: string;
    mediaType: 'movie' | 'series';
    episodes?: EntryEpisode[];
    /** Preselects an episode, for example from a native episode page or an episode row. */
    episodeId?: string;
    /** Opened from `episodeId`'s own page: the scope switch offers that episode, its season and All Seasons. */
    episodePage?: boolean;
    /** Opened from a season's own page: the scope switch offers that season, preselected, and All Seasons. */
    seasonNumber?: number;
    /** `addVersion` for Get another quality (P6.M8); omitted is an ordinary acquire search. */
    intent?: ReleaseIntent;
    /** The entry's `episodeListLoaded`: false loads the series' full TMDB list when the picker opens (P1.FU). */
    episodeListLoaded?: boolean;
    onChanged?: () => void;
}

const pad = (value: number) => (value < 10 ? '0' : '') + value;

/** Loads already asked for, by entry and page, so a page visit asks once per entry, never again after a failure. */
const listLoads = new Map<string, Promise<EntryDetail>>();

/**
 * Loads the full TMDB season and episode list of a series discovered in the library (P1.FU), through the plugin's
 * EpisodeList, which any user who may see the series can call (P1.FU9), once per entry per page visit: a picker and the
 * page it was opened from share the one request.
 */
export const loadEpisodeList = (api: Api, entryId: string): Promise<EntryDetail> => {
    const key = entryId + ' ' + window.location.href;
    let load = listLoads.get(key);
    if (!load) {
        load = loadEntryEpisodeList(api, entryId);
        listLoads.set(key, load);
    }
    return load;
};

/**
 * Opening a series whose entry says its list is not loaded loads it (P1.FU9), for every user: once per entry per page
 * visit, quietly, sharing the request with a picker opened meanwhile. `onLoaded` gets the entry's new detail. A failure, or
 * an older plugin (no `episodeListLoaded`, or no endpoint), changes nothing. A list loaded before the series' metadata kept
 * episode ratings and season overviews (no `episodeRatings`, P1.FU14) or its cast and the episodes' guest stars and crew (no
 * `cast`, P1.FU15) is loaded once more the same way.
 */
export const useEpisodeListLoad = (api: Api, detail: EntryDetail | null | undefined, onLoaded: (loaded: EntryDetail) => void) => {
    const onLoadedRef = useRef(onLoaded);
    onLoadedRef.current = onLoaded;
    const entryId = detail?.entry.mediaType === 'series' && (detail.episodeListLoaded === false
        || (detail.episodeListLoaded === true && (detail.entry.metadata?.episodeRatings == null || detail.entry.metadata.cast == null))) ?
        detail.entry.id : undefined;
    useEffect(() => {
        if (!entryId) return;
        let live = true;
        loadEpisodeList(api, entryId).then(loaded => {
            if (live) onLoadedRef.current(loaded);
        }, () => undefined);
        return () => {
            live = false;
        };
    }, [api, entryId]);
};

/** Episode choices: aired episodes without media first, then the rest in broadcast order. */
export const pickerEpisodes = (episodes: EntryEpisode[]): ReleasePickerEpisode[] => [
    ...episodes.filter(episode => episode.availability === 'missing' || episode.availability === 'reclaimed'),
    ...episodes.filter(episode => episode.availability !== 'missing' && episode.availability !== 'reclaimed')
].map(episode => ({
    id: episode.id,
    label: `S${pad(episode.seasonNumber)}E${pad(episode.episodeNumber)} · ${episode.title}`
        + (episode.availability === 'onDisk' ? ' (on disk)' : '') + (episode.availability === 'unaired' ? ' (unaired)' : ''),
    seasonNumber: episode.seasonNumber,
    episodeNumber: episode.episodeNumber,
    title: episode.title,
    unaired: episode.availability === 'unaired'
}));

/**
 * Opens the release picker as a dialog, not a route (UX §9). The dialog helper owns Back/Escape and returns
 * focus to the element that opened it (UX §13).
 */
export const openReleasePicker = (options: OpenOptions): Promise<void> => {
    const dlg = dialogHelper.createDialog({ removeOnClose: true, scrollY: false, size: layoutManager.tv ? 'fullscreen' : 'medium' });
    dlg.className = 'focuscontainer hide jfmod-designDialogHost';
    dlg.dataset.designDialog = 'true';
    dlg.style.animation = 'none';
    const opener = document.activeElement as HTMLElement | null;
    let closing = false;
    dlg.addEventListener('closing', () => {
        closing = true;
    });
    const close = () => {
        if (!closing) dialogHelper.close(dlg);
    };
    const key = (event: KeyboardEvent) => {
        if (!event.defaultPrevented && isTopDialog(dlg) && isBackKey(getKeyName(event))) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            close();
        }
    };
    document.addEventListener('keydown', key);
    const unmount = renderComponent(ReleasePicker, {
        title: options.title,
        close,
        api: options.api,
        entryId: options.entryId,
        mediaType: options.mediaType,
        episodes: pickerEpisodes(options.episodes ?? []),
        initialEpisodeId: options.episodeId,
        episodePage: options.episodePage,
        seasonPage: options.seasonNumber,
        intent: options.intent,
        loadEpisodes: options.mediaType === 'series' && options.episodeListLoaded === false ?
            () => loadEpisodeList(options.api, options.entryId).then(detail => pickerEpisodes(detail.episodes)) : undefined,
        onChanged: options.onChanged
    }, dlg);
    const release = () => {
        document.removeEventListener('keydown', key);
        unmount();
        returnFocus(opener);
    };
    return dialogHelper.open(dlg).then(release, release);
};

/** Where a picker opened by entry id starts: a native episode (its page's scope list) or a season (that season's scope). */
export interface PickerScope {
    /** A native episode's Jellyfin id; its version on another item still finds its episode. */
    nativeItemId?: string;
    intent?: ReleaseIntent;
    /** A season's number, for a season card (P1.FU12). */
    seasonNumber?: number;
}

/** Loads an entry's episodes first, for openers that only know its id (a card's mark, a card's Get a Release). */
export const openReleasePickerForEntry = async (api: Api, entryId: string, { nativeItemId, intent, seasonNumber }: PickerScope = {}) => {
    const detail = await getEntry(api, entryId);
    const sameId = (value?: string | null) => !!value && !!nativeItemId
        && value.replace(/-/g, '').toLowerCase() === nativeItemId.replace(/-/g, '').toLowerCase();
    // An episode page names its episode, since the More menu's item may be another version of it.
    const pageEpisodeId = nativeItemId ? detail.episodes.find(episode => sameId(episode.jellyfinItemId) || sameId(episode.placeholderItemId)
        || (episode.versions ?? []).some(version => sameId(version.jellyfinItemId)))?.id : undefined;
    await openReleasePicker({
        api,
        entryId,
        title: detail.entry.title,
        mediaType: detail.entry.mediaType,
        episodes: detail.episodes,
        episodeId: pageEpisodeId,
        episodePage: !!pageEpisodeId,
        seasonNumber,
        intent,
        episodeListLoaded: detail.episodeListLoaded
    });
};
