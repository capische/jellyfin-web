import type { Api } from '@jellyfin/sdk/lib/api';

import dialogHelper from 'components/dialogHelper/dialogHelper';
import layoutManager from 'components/layoutManager';
import { renderComponent } from 'utils/reactUtils';

import { getEntry } from '../api/modApi';
import ReleasePickerDialog, { type ReleasePickerEpisode } from '../components/ReleasePickerDialog';
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
    /** `addVersion` for Get another quality (P6.M8); omitted is an ordinary acquire search. */
    intent?: ReleaseIntent;
    onChanged?: () => void;
}

const pad = (value: number) => (value < 10 ? '0' : '') + value;

/** Episode choices: aired episodes without media first, then the rest in broadcast order. */
export const pickerEpisodes = (episodes: EntryEpisode[]): ReleasePickerEpisode[] => [
    ...episodes.filter(episode => episode.availability === 'missing' || episode.availability === 'reclaimed'),
    ...episodes.filter(episode => episode.availability !== 'missing' && episode.availability !== 'reclaimed')
].map(episode => ({
    id: episode.id,
    label: `S${pad(episode.seasonNumber)}E${pad(episode.episodeNumber)} · ${episode.title}`
        + (episode.availability === 'onDisk' ? ' (on disk)' : '') + (episode.availability === 'unaired' ? ' (unaired)' : '')
}));

/**
 * Opens the release picker as a dialog, not a route (UX §9). The dialog helper owns Back/Escape and returns
 * focus to the element that opened it (UX §13).
 */
export const openReleasePicker = (options: OpenOptions): Promise<void> => {
    const dlg = dialogHelper.createDialog({ removeOnClose: true, scrollY: false, size: layoutManager.tv ? 'fullscreen' : 'medium' });
    dlg.classList.add('formDialog', 'jfmod-releaseDialog');
    dlg.innerHTML = '<div class="formDialogHeader">'
        + '<button is="paper-icon-button-light" class="btnCancel autoSize" tabindex="-1" title="Back">'
        + '<span class="material-icons arrow_back" aria-hidden="true"></span></button>'
        + '<h3 class="formDialogHeaderTitle"></h3></div>'
        + '<div class="formDialogContent smoothScrollY"><div class="jfmod-releaseDialogContent"></div></div>';
    const heading = dlg.querySelector('.formDialogHeaderTitle');
    if (heading) heading.textContent = (options.intent === 'addVersion' ? 'Another quality for ' : 'Releases for ') + options.title;
    const close = () => dialogHelper.close(dlg);
    dlg.querySelector('.btnCancel')?.addEventListener('click', close);
    const content = dlg.querySelector<HTMLElement>('.jfmod-releaseDialogContent')!;
    const unmount = renderComponent(ReleasePickerDialog, {
        api: options.api,
        entryId: options.entryId,
        mediaType: options.mediaType,
        episodes: pickerEpisodes(options.episodes ?? []),
        initialEpisodeId: options.episodeId,
        intent: options.intent,
        onClose: close,
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
    await openReleasePicker({
        api,
        entryId,
        title: detail.entry.title,
        mediaType: detail.entry.mediaType,
        episodes: detail.episodes,
        // An episode page names its episode, since the More menu's item may be another version of it.
        episodeId: episodeId ?? detail.episodes.find(episode => sameId(episode.jellyfinItemId))?.id,
        intent
    });
};
