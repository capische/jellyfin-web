import { AbortController as RequestAbortController } from 'abortcontroller-polyfill/dist/cjs-ponyfill';
import { clearBackdrop } from 'components/backdrop/backdrop';
import loading from 'components/loading/loading';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import libraryMenu from 'scripts/libraryMenu';
import { renderComponent } from 'utils/reactUtils';

import { getDiscoverTitle } from '../api/modApi';
import TmdbDetails from '../components/TmdbDetails';
import { preconnectTmdbImages } from '../utils/entryLinks';
import { createFocusOwnership } from '../utils/focusOwnership';

/**
 * The page of a TMDB title that is not in the library (TM2, D196): `#/details?tmdbType=movie|series&tmdbId=N[&season=S[&episode=E]]`,
 * drawn on upstream's detail template from `GET /JellyfinMod/Discover/Title`. Nothing here has a Jellyfin item, so upstream's
 * controller never runs for it.
 */
export default function initializeTmdbDetails(view, params) {
    const mount = document.createElement('div');
    mount.className = 'jfmod-entryDetailsRoot';
    view.appendChild(mount);
    view.classList.add('jfmod-dsBrowse', 'jfmod-dsPage');
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
        preconnectTmdbImages();
        focusOwnership = createFocusOwnership();
        const ownership = focusOwnership;
        const currentGeneration = generation;
        await new Promise(resolve => setTimeout(resolve, 0));
        if (currentGeneration !== generation) return;
        const client = params.serverId ? ServerConnections.getApiClient(params.serverId) : ServerConnections.currentApiClient();
        const api = client && ServerConnections.getApi(client.serverId());
        const mediaType = params.tmdbType === 'series' ? 'series' : 'movie';
        const tmdbId = Number(params.tmdbId);
        const season = params.season !== undefined && mediaType === 'series' ? Number(params.season) : undefined;
        const episode = season !== undefined && params.episode !== undefined ? Number(params.episode) : undefined;
        if (!api || !Number.isInteger(tmdbId) || tmdbId <= 0 || (season !== undefined && !(Number.isInteger(season) && season >= 0))) {
            mount.textContent = 'This title cannot be opened.';
            return;
        }
        abort = new RequestAbortController();
        loading.show();
        try {
            const [data, user] = await Promise.all([
                getDiscoverTitle(api, { type: mediaType, tmdbId, season }, { signal: abort.signal }),
                client.getCurrentUser()
            ]);
            if (currentGeneration !== generation) return;
            libraryMenu.setTitle('');
            renderMount = document.createElement('div');
            mount.appendChild(renderMount);
            unmount = renderComponent(TmdbDetails, { api, data, view, serverId: client.serverId(), userId: client.getCurrentUserId(),
                isAdmin: !!user.Policy?.IsAdministrator, season, episode, focusOwnership: ownership }, renderMount);
        } catch (error) {
            if (currentGeneration !== generation || error.name === 'AbortError' || error.code === 'ERR_CANCELED') return;
            mount.textContent = 'This title could not be read from TMDB. Try again, or return to the search.';
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
        view.classList.remove('jfmod-dsBrowse', 'jfmod-dsPage');
    };
    view.addEventListener('viewshow', show);
    view.addEventListener('viewbeforehide', hide);
    view.addEventListener('viewdestroy', destroy);
}
