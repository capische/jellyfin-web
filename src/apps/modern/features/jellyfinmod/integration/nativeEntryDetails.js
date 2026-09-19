import actionsheet from 'components/actionSheet/actionSheet';
import loading from 'components/loading/loading';
import itemContextMenu, { executeCommand } from 'components/itemContextMenu';
import toast from 'components/toast/toast';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import { renderComponent } from 'utils/reactUtils';

import { getEntries, requestSearch } from '../api/modApi';
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
        const user = await client.getCurrentUser();
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

/**
 * The mod's More menu commands for the loaded entry, all administrator-only and each gated on the plugin's advertised
 * capability: Search releases (P4.A7), Get another quality for a title with a file and Search now for an
 * upgrade-eligible one (P6.M8).
 */
const modCommands = section => {
    const commands = [];
    if (section.dataset.jfmodCanAcquire === 'true') commands.push({ id: 'jfmod-search-releases', name: 'Search releases', icon: 'search' });
    if (section.dataset.jfmodCanAddVersion === 'true') commands.push({ id: 'jfmod-add-version', name: 'Get another quality', icon: 'hd' });
    if (section.dataset.jfmodCanSearchNow === 'true') commands.push({ id: 'jfmod-search-now', name: 'Search now', icon: 'autorenew' });
    return commands;
};

const runModCommand = (id, section, options) => {
    const client = options.item?.ServerId ? ServerConnections.getApiClient(options.item.ServerId) : ServerConnections.currentApiClient();
    const api = client && ServerConnections.getApi(client.serverId());
    if (!api) return;
    const entryId = section.dataset.jfmodEntryId;
    if (id === 'jfmod-search-now') {
        requestSearch(api, entryId).then(() => {
            toast('Search requested. The next automation run searches this title.');
        }).catch(error => {
            console.error('[JellyfinMod] Could not request a search', error);
            toast('The search could not be requested. Please try again.');
        });
        return;
    }
    const intent = id === 'jfmod-add-version' ? 'addVersion' : undefined;
    openReleasePickerForEntry(api, entryId, options.item?.Id, intent, intent ? section.dataset.jfmodEpisodeId : undefined).catch(error => {
        console.error('[JellyfinMod] Could not open the release picker', error);
        toast('Releases could not be loaded. Please try again.');
    });
};

/** Extend only the native Details More menu after an accessible entry has loaded. */
export async function showNativeEntryMenu(options, view) {
    if (!view.querySelector('.jfmod-nativeEntryDetails .jfmod-entryHistory')) {
        return itemContextMenu.show(options);
    }
    const section = view.querySelector('.jfmod-nativeEntryDetails [data-jfmod-entry-id]');
    const extra = section ? modCommands(section) : [];
    if (!extra.length) return itemContextMenu.show(options);
    const commands = await itemContextMenu.getCommands(options);
    commands.push(...extra);
    const id = await actionsheet.show({ items: commands, positionTo: options.positionTo, resolveOnClick: ['share'] });
    if (extra.some(command => command.id === id)) {
        runModCommand(id, section, options);
        return { command: id, updated: false, deleted: false };
    }
    return executeCommand(options.item, id, options);
}
