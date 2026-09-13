import { AbortController as RequestAbortController } from 'abortcontroller-polyfill/dist/cjs-ponyfill';
import { clearBackdrop } from 'components/backdrop/backdrop';
import loading from 'components/loading/loading';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import libraryMenu from 'scripts/libraryMenu';
import * as userSettings from 'scripts/settings/userSettings';
import { renderComponent } from 'utils/reactUtils';

import { getEntry } from '../api/modApi';
import EntryDetails from '../components/EntryDetails';
import { getTmdbImage } from '../utils/entryLinks';

/** Owns the file-less lifecycle before the native detail controller binds native-only actions. */
export default function initializeEntryDetails(view, params) {
    const mount = document.createElement('div');
    mount.className = 'jfmod-entryDetailsRoot';
    view.appendChild(mount);
    let unmount;
    let renderMount;
    let abort;
    let generation = 0;

    const hide = () => {
        generation++;
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
            const [detail, user] = await Promise.all([getEntry(api, params.entryId, { signal: abort.signal }), client.getCurrentUser()]);
            if (currentGeneration !== generation) return;
            if (detail.entry.jellyfinItemId) {
                window.location.replace('#/details?id=' + encodeURIComponent(detail.entry.jellyfinItemId)
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
            unmount = renderComponent(EntryDetails, { api, detail, view, isAdmin: !!user.Policy?.IsAdministrator,
                serverId: client.serverId(), signal: abort.signal }, renderMount);
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
