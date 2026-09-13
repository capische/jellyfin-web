import actionsheet from 'components/actionSheet/actionSheet';
import itemContextMenu, { executeCommand } from 'components/itemContextMenu';
import toast from 'components/toast/toast';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import { renderComponent } from 'utils/reactUtils';

import NativeEntryDetails from '../components/NativeEntryDetails';

export default function initializeNativeEntryDetails(view, params) {
    let mount;
    let unmount;
    const hide = () => {
        unmount?.();
        unmount = undefined;
        mount?.remove();
        mount = undefined;
    };
    const show = () => {
        hide();
        const client = params.serverId ? ServerConnections.getApiClient(params.serverId) : ServerConnections.currentApiClient();
        const api = client && ServerConnections.getApi(client.serverId());
        const target = view.querySelector('.detailSectionContent');
        if (!api || !target || !params.id) return;
        mount = document.createElement('div');
        mount.className = 'jfmod-nativeEntryDetails';
        target.appendChild(mount);
        unmount = renderComponent(NativeEntryDetails, { api, userId: client.getCurrentUserId(), itemId: params.id }, mount);
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
    const commands = await itemContextMenu.getCommands(options);
    commands.push({ id: 'jfmod-search-releases', name: 'Search releases', icon: 'search' });
    const id = await actionsheet.show({ items: commands, positionTo: options.positionTo, resolveOnClick: ['share'] });
    if (id === 'jfmod-search-releases') {
        toast('Release search is not available yet. No download has started.');
        return { command: id, updated: false, deleted: false };
    }
    return executeCommand(options.item, id, options);
}
