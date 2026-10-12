import type { Api } from '@jellyfin/sdk/lib/api';
import { useEffect, useRef } from 'react';

import dialogHelper from 'components/dialogHelper/dialogHelper';
import layoutManager from 'components/layoutManager';
import { renderComponent } from 'utils/reactUtils';

import { type EntryDetail, getEntry, loadEntryEpisodeList } from '../api/modApi';
import ReleasePickerDialog, { type ReleasePickerEpisode } from '../components/ReleasePickerDialog';
import type { ReleaseIntent } from '../types/acquisition';
import type { EntryEpisode } from '../types/entry';

// webpack's `?raw` rule (webpack.common.js) hands the drawing over as text; the eslint resolver does not know the query.
// eslint-disable-next-line import/no-unresolved
import namesToggleGlyph from '../assets/names-toggle.svg?raw';

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

/** Show Names (user, 2026-10-11): every row shows its file name while it is on. Off by default, remembered per browser. */
const NAMES_KEY = 'jfmod-releaseNames';

const readNames = () => {
    try {
        return localStorage.getItem(NAMES_KEY) === '1';
    } catch {
        return false;
    }
};

const saveNames = (on: boolean) => {
    try {
        localStorage.setItem(NAMES_KEY, on ? '1' : '0');
    } catch {
        // A browser without storage just forgets the choice.
    }
};

/** Puts the state on the dialog (its class shows the names), on the button (pressed, label, tooltip) and in storage. */
const applyNames = (dlg: HTMLElement, toggle: HTMLElement, on: boolean) => {
    const label = on ? 'Hide Names' : 'Show Names';
    dlg.classList.toggle('jfmod-releaseDialog--names', on);
    toggle.setAttribute('aria-pressed', String(on));
    toggle.setAttribute('aria-label', label);
    toggle.setAttribute('title', label);
};

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
 * visit, quietly, sharing the request with a picker opened meanwhile. `onLoaded` refetches the page's data. A failure, or
 * an older plugin (no `episodeListLoaded`, or no endpoint), changes nothing.
 */
export const useEpisodeListLoad = (api: Api, detail: EntryDetail | null | undefined, onLoaded: () => void) => {
    const onLoadedRef = useRef(onLoaded);
    onLoadedRef.current = onLoaded;
    const entryId = detail?.entry.mediaType === 'series' && detail.episodeListLoaded === false ? detail.entry.id : undefined;
    useEffect(() => {
        if (!entryId) return;
        let live = true;
        loadEpisodeList(api, entryId).then(() => {
            if (live) onLoadedRef.current();
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
    dlg.classList.add('formDialog', 'jfmod-releaseDialog');
    // The title first and a close cross at the right, in place of upstream's back arrow; Back and Escape still close it
    // through the dialog helper (user, 2026-10-08).
    dlg.innerHTML = '<div class="formDialogHeader">'
        + '<h3 class="formDialogHeaderTitle"></h3>'
        + '<button is="paper-icon-button-light" type="button" class="autoSize jfmod-releaseAction jfmod-namesToggle"'
        + ' title="Show Names" aria-label="Show Names" aria-pressed="false">'
        + namesToggleGlyph.replace('<svg ', '<svg class="jfmod-releaseGlyph" ') + '</button>'
        + '<button is="paper-icon-button-light" class="btnCancel autoSize jfmod-releaseAction jfmod-releaseDialogClose" tabindex="-1"'
        + ' title="Close"'
        + ' aria-label="Close"><svg class="jfmod-releaseGlyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"'
        + ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6L18 18M18 6L6 18"/></svg></button></div>'
        + '<div class="formDialogContent smoothScrollY"><div class="jfmod-releaseDialogContent"></div></div>';
    const heading = dlg.querySelector('.formDialogHeaderTitle');
    // The title the design draws: what the dialog does, in Title Case; the choices below name the episode or season.
    if (heading) heading.textContent = options.intent === 'addVersion' ? 'Get Another Quality' : 'Get a Release';
    const toggle = dlg.querySelector<HTMLElement>('.jfmod-namesToggle')!;
    applyNames(dlg, toggle, readNames());
    toggle.addEventListener('click', () => {
        const on = toggle.getAttribute('aria-pressed') !== 'true';
        applyNames(dlg, toggle, on);
        saveNames(on);
    });
    const close = () => dialogHelper.close(dlg);
    dlg.querySelector('.btnCancel')?.addEventListener('click', close);
    const content = dlg.querySelector<HTMLElement>('.jfmod-releaseDialogContent')!;
    const unmount = renderComponent(ReleasePickerDialog, {
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
    }, content);
    const release = () => {
        unmount();
    };
    return dialogHelper.open(dlg).then(release, release);
};

/** Loads an entry's episodes first, for openers that only know its id (native Details More menu). */
export const openReleasePickerForEntry = async (api: Api, entryId: string, nativeItemId?: string, intent?: ReleaseIntent,
    episodeId?: string) => {
    const detail = await getEntry(api, entryId);
    const sameId = (value?: string | null) => !!value && !!nativeItemId
        && value.replace(/-/g, '').toLowerCase() === nativeItemId.replace(/-/g, '').toLowerCase();
    // An episode page names its episode, since the More menu's item may be another version of it.
    const pageEpisodeId = episodeId ?? detail.episodes.find(episode => sameId(episode.jellyfinItemId))?.id;
    await openReleasePicker({
        api,
        entryId,
        title: detail.entry.title,
        mediaType: detail.entry.mediaType,
        episodes: detail.episodes,
        episodeId: pageEpisodeId,
        episodePage: !!pageEpisodeId,
        intent,
        episodeListLoaded: detail.episodeListLoaded
    });
};
