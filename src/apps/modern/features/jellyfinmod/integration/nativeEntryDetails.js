import actionsheet from 'components/actionSheet/actionSheet';
import loading from 'components/loading/loading';
import itemContextMenu, { executeCommand } from 'components/itemContextMenu';
import toast from 'components/toast/toast';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import { renderComponent } from 'utils/reactUtils';

import { getEntries } from '../api/modApi';
import NativeEntryDetails from '../components/NativeEntryDetails';
import { openReleasePickerForEntry } from './releasePicker';

/**
 * A native item that no longer exists (for example after reclaim) opens its catalog entry instead of an
 * endless spinner, or says plainly that it is unavailable (P3.T14).
 */
export async function handleMissingNativeItem(view, params, error) {
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
    let unmount;
    let generation = 0;
    const hide = () => {
        generation++;
        unmount?.();
        unmount = undefined;
        mount?.remove();
        mount = undefined;
    };
    const show = async () => {
        hide();
        const currentGeneration = generation;
        const client = params.serverId ? ServerConnections.getApiClient(params.serverId) : ServerConnections.currentApiClient();
        const api = client && ServerConnections.getApi(client.serverId());
        const target = view.querySelector('.detailSectionContent');
        if (!api || !target || !params.id) return;
        const user = await client.getCurrentUser();
        if (currentGeneration !== generation) return;
        mount = document.createElement('div');
        mount.className = 'jfmod-nativeEntryDetails';
        target.appendChild(mount);
        unmount = renderComponent(NativeEntryDetails, {
            api,
            userId: client.getCurrentUserId(),
            itemId: params.id,
            isAdmin: !!user?.Policy?.IsAdministrator
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

/** Extend only the native Details More menu after an accessible entry has loaded. */
export async function showNativeEntryMenu(options, view) {
    if (!view.querySelector('.jfmod-nativeEntryDetails .jfmod-entryHistory')) {
        return itemContextMenu.show(options);
    }
    // Administrators get Search releases only when the plugin advertises it (P4.A7).
    const acquisition = view.querySelector('.jfmod-nativeEntryDetails [data-jfmod-can-acquire="true"]');
    if (!acquisition) return itemContextMenu.show(options);
    const commands = await itemContextMenu.getCommands(options);
    commands.push({ id: 'jfmod-search-releases', name: 'Search releases', icon: 'search' });
    const id = await actionsheet.show({ items: commands, positionTo: options.positionTo, resolveOnClick: ['share'] });
    if (id === 'jfmod-search-releases') {
        const client = options.item?.ServerId ? ServerConnections.getApiClient(options.item.ServerId) : ServerConnections.currentApiClient();
        const api = client && ServerConnections.getApi(client.serverId());
        if (api) {
            openReleasePickerForEntry(api, acquisition.dataset.jfmodEntryId, options.item?.Id).catch(error => {
                console.error('[JellyfinMod] Could not open the release picker', error);
                toast('Releases could not be loaded. Please try again.');
            });
        }
        return { command: id, updated: false, deleted: false };
    }
    return executeCommand(options.item, id, options);
}
