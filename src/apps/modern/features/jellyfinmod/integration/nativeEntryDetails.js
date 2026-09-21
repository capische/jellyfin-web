import loading from 'components/loading/loading';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import { renderComponent } from 'utils/reactUtils';

import { getEntries } from '../api/modApi';
import NativeEntryDetails from '../components/NativeEntryDetails';

/**
 * A native item that no longer exists (for example after reclaim) opens its catalog entry instead of an
 * endless spinner, or says plainly that it is unavailable (P3.T14).
 */
async function handleMissingNativeItem(view, params, error) {
    if (error?.status !== 404 || !params.id) return;
    const client = params.serverId ? ServerConnections.getApiClient(params.serverId) : ServerConnections.currentApiClient();
    const api = client && ServerConnections.getApi(client.serverId());
    try {
        const entries = api ? await getEntries(api, { jellyfinItemId: params.id, limit: 1 }) : null;
        const entry = entries?.items[0];
        if (entry) {
            window.location.replace('#/details?entryId=' + encodeURIComponent(entry.id)
                + '&serverId=' + encodeURIComponent(client.serverId()));
            return;
        }
    } catch (lookupError) {
        console.error('[JellyfinMod] Could not look up the entry for a missing item', lookupError);
    }

    loading.hide();
    const content = view.querySelector('.detailPageContent') ?? view;
    const message = document.createElement('p');
    message.className = 'jfmod-nativeUnavailable padded-left padded-right';
    message.textContent = 'This item is no longer in the library. ';
    const link = document.createElement('a');
    link.href = '#/home';
    link.textContent = 'Open Home';
    message.appendChild(link);
    content.prepend(message);
}

export default function initializeNativeEntryDetails(view, params) {
    let mount;
    let versionsMount;
    let unmount;
    let generation = 0;
    const hide = () => {
        generation++;
        unmount?.();
        unmount = undefined;
        mount?.remove();
        mount = undefined;
        versionsMount?.remove();
        versionsMount = undefined;
    };
    const show = async () => {
        hide();
        const currentGeneration = generation;
        const client = params.serverId ? ServerConnections.getApiClient(params.serverId) : ServerConnections.currentApiClient();
        const api = client && ServerConnections.getApi(client.serverId());
        const target = view.querySelector('.detailSectionContent');
        if (!api || !target || !params.id) return;
        // Asked for here rather than read out of upstream's failure. Upstream's controller does its own
        // getItem and, when the item is gone (a reclaim, a library removal), logs and leaves the page empty;
        // reading that used to mean a patch inside its catch. Owning the route means asking the same question
        // ourselves. It costs one extra request per native detail page, which is the price of the patch
        // coming out (P7.S6, P3.T14).
        let user;
        try {
            [, user] = await Promise.all([
                client.getItem(client.getCurrentUserId(), params.id),
                client.getCurrentUser()
            ]);
        } catch (error) {
            if (currentGeneration !== generation) return;
            await handleMissingNativeItem(view, params, error);
            return;
        }
        if (currentGeneration !== generation) return;
        mount = document.createElement('div');
        mount.className = 'jfmod-nativeEntryDetails';
        target.appendChild(mount);
        // Version rows sit beside the stock track selections, outside their horizontal focus container (P6.M8).
        const trackSelections = view.querySelector('.trackSelections');
        if (trackSelections) {
            versionsMount = document.createElement('div');
            versionsMount.className = 'jfmod-versionsMount';
            // insertBefore rather than after(): older TV engines lack ChildNode.after.
            trackSelections.parentNode.insertBefore(versionsMount, trackSelections.nextSibling);
        }
        unmount = renderComponent(NativeEntryDetails, {
            api,
            userId: client.getCurrentUserId(),
            itemId: params.id,
            isAdmin: !!user?.Policy?.IsAdministrator,
            view,
            versionsMount
        }, mount);
    };
    const destroy = () => {
        hide();
        view.removeEventListener('viewshow', show);
        view.removeEventListener('viewbeforehide', hide);
        view.removeEventListener('viewdestroy', destroy);
    };
    view.addEventListener('viewshow', show);
    view.addEventListener('viewbeforehide', hide);
    view.addEventListener('viewdestroy', destroy);
}
