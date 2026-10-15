import { AbortController as RequestAbortController } from 'abortcontroller-polyfill/dist/cjs-ponyfill';
import { clearBackdrop } from 'components/backdrop/backdrop';
import loading from 'components/loading/loading';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import libraryMenu from 'scripts/libraryMenu';
import * as userSettings from 'scripts/settings/userSettings';
import { queryClient } from 'utils/query/queryClient';
import { renderComponent } from 'utils/reactUtils';

import { getEntry } from '../api/modApi';
import { entryDetailQuery } from '../hooks/useEntries';
import EntryDetails from '../components/EntryDetails';
import EntryEpisodeDetails from '../components/EntryEpisodeDetails';
import EntrySeasonDetails from '../components/EntrySeasonDetails';
import { getTmdbImage, preconnectTmdbImages } from '../utils/entryLinks';
import { createFocusOwnership } from '../utils/focusOwnership';

/** Owns the file-less lifecycle before the native detail controller binds native-only actions. */
export default function initializeEntryDetails(view, params) {
    const mount = document.createElement('div');
    mount.className = 'jfmod-entryDetailsRoot';
    view.appendChild(mount);
    let unmount;
    let renderMount;
    let abort;
    let generation = 0;
    let focusOwnership;

    const hide = () => {
        generation++;
        focusOwnership?.release();
        focusOwnership = undefined;
        abort?.abort();
        abort = undefined;
        unmount?.();
        unmount = undefined;
        // renderComponent defers root teardown. Give each visit its own mount so a
        // rapid restore cannot reuse a root which is still waiting to unmount.
        renderMount?.remove();
        renderMount = undefined;
        mount.textContent = '';
        libraryMenu.setTransparentMenu(false);
        clearBackdrop();
        const backdrop = view.querySelector('#itemBackdrop');
        if (backdrop) backdrop.style.backgroundImage = '';
        loading.hide();
    };
    const show = async () => {
        hide();
        // The page's TMDB images (backdrop, poster or still, person portraits) need this connection the moment the entry
        // arrives (P1.FU18).
        preconnectTmdbImages();
        // Focus ownership starts with the visit, before loading: input while the entry loads ends it (P4.A7).
        focusOwnership = createFocusOwnership();
        const ownership = focusOwnership;
        const currentGeneration = generation;
        // Let the deferred React unmount finish removing its portals before
        // restoring a cached view's template slots.
        await new Promise(resolve => setTimeout(resolve, 0));
        if (currentGeneration !== generation) return;
        for (const node of view.querySelectorAll('.detailLogo, .nameContainer, .itemMiscInfo, .detailImageContainer, .itemGenres, .tagline, .overview, .itemDetailsGroup')) {
            node.textContent = '';
        }
        for (const node of view.querySelectorAll('.mainDetailButtons > button, .trackSelections, .recordingFields, .itemTags, .itemExternalLinks, .collectionItems, .nextUpSection, .programGuideSection, .overview-expand')) {
            node.classList.add('hide');
        }
        const client = params.serverId ? ServerConnections.getApiClient(params.serverId) : ServerConnections.currentApiClient();
        const api = client && ServerConnections.getApi(client.serverId());
        if (!api) {
            mount.textContent = 'Connect to Jellyfin to open this entry.';
            return;
        }
        abort = new RequestAbortController();
        loading.show();
        try {
            const detailKey = entryDetailQuery(api, client.getCurrentUserId(), params.entryId).queryKey;
            const read = getEntry(api, params.entryId, { signal: abort.signal }).then(fresh => {
                queryClient.setQueryData(detailKey, fresh);
                return fresh;
            });
            // The mod's season and episode pages open from their series' cards and rows, whose entry was just read: they draw
            // from it at once and take the fresh read when it lands (P1.FU16). Every other page waits for the read.
            const known = params.season !== undefined ? queryClient.getQueryData(detailKey) : undefined;
            if (known) read.catch(() => undefined);
            const [detail, user] = await Promise.all([known ?? read, client.getCurrentUser()]);
            if (currentGeneration !== generation) return;
            // `season=N` is the mod's page for a season Jellyfin has no item for (P1.FU11): it stays, file or no file.
            const season = Number(params.season);
            const isSeason = detail.entry.mediaType === 'series' && params.season !== undefined && Number.isInteger(season) && season >= 0;
            // `&episode=M` on it is the mod's page for an episode Jellyfin has no item for (P1.FU15); once Jellyfin has the
            // episode, its own page opens instead: its file's, or the placeholder Jellyfin holds while it has none (P1.FU24).
            const episodeNumber = Number(params.episode);
            const isEpisode = isSeason && params.episode !== undefined && Number.isInteger(episodeNumber) && episodeNumber >= 0;
            const itemOf = episode => (episode.availability === 'onDisk' ? episode.jellyfinItemId : episode.placeholderItemId);
            const heldIn = current => (isEpisode ? current.episodes.find(episode => episode.seasonNumber === season
                && episode.episodeNumber === episodeNumber && itemOf(episode)) : undefined);
            const openHeld = held => window.location.replace('#/details?id=' + encodeURIComponent(itemOf(held))
                + '&serverId=' + encodeURIComponent(client.serverId()));
            const held = heldIn(detail);
            if (held) {
                openHeld(held);
                return;
            }
            // Drawn from what was known: an episode Jellyfin has had since then opens its own page all the same.
            if (known && isEpisode) {
                read.then(fresh => {
                    const now = heldIn(fresh);
                    if (now && currentGeneration === generation) openHeld(now);
                }, () => undefined);
            }
            // The title's Jellyfin page: its file's, or the placeholder Jellyfin holds while it has none (P1.FU26).
            const titleItem = detail.entry.jellyfinItemId || detail.entry.placeholderItemId;
            if (titleItem && !isSeason) {
                window.location.replace('#/details?id=' + encodeURIComponent(titleItem)
                    + '&serverId=' + encodeURIComponent(client.serverId()));
                return;
            }
            mount.textContent = '';
            libraryMenu.setTitle('');
            const backdrop = view.querySelector('#itemBackdrop');
            const image = getTmdbImage(detail.entry.metadata?.backdropPath, 'w1280');
            if (backdrop && image && userSettings.detailsBanner()) backdrop.style.backgroundImage = `url("${image}")`;
            renderMount = document.createElement('div');
            mount.appendChild(renderMount);
            const seasonProps = { api, userId: client.getCurrentUserId(), serverId: client.serverId(), detail, season, view,
                isAdmin: !!user.Policy?.IsAdministrator, signal: abort.signal, focusOwnership: ownership, update: known ? read : undefined };
            const render = () => {
                if (isEpisode) return renderComponent(EntryEpisodeDetails, { ...seasonProps, episodeNumber }, renderMount);
                if (isSeason) return renderComponent(EntrySeasonDetails, seasonProps, renderMount);
                return renderComponent(EntryDetails, { api, detail, view, isAdmin: !!user.Policy?.IsAdministrator,
                    serverId: client.serverId(), signal: abort.signal, focusOwnership: ownership }, renderMount);
            };
            unmount = render();
        } catch (error) {
            if (currentGeneration !== generation || error.name === 'AbortError' || error.code === 'ERR_CANCELED') return;
            mount.textContent = 'This entry is unavailable. Check that JellyfinMod is enabled, or return to your library.';
            const link = document.createElement('a');
            link.href = '#/home';
            link.textContent = ' Open Home';
            mount.appendChild(link);
        } finally {
            if (currentGeneration === generation) loading.hide();
        }
    };
    const destroy = () => {
        hide();
        view.removeEventListener('viewshow', show);
        view.removeEventListener('viewbeforehide', hide);
        view.removeEventListener('viewdestroy', destroy);
        mount.remove();
    };
    view.addEventListener('viewshow', show);
    view.addEventListener('viewbeforehide', hide);
    view.addEventListener('viewdestroy', destroy);
}
