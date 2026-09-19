import type { Api } from '@jellyfin/sdk/lib/api';

import actionsheet from 'components/actionSheet/actionSheet';
import dialogHelper from 'components/dialogHelper/dialogHelper';
import focusManager from 'components/focusManager';
import layoutManager from 'components/layoutManager';
import toast from 'components/toast/toast';
import shell from 'scripts/shell';

import { removeQueueRow, retryImport } from '../api/modApi';
import { actionErrorMessage, isRetryable, QUEUE_ROUTE, queueRowTitle } from '../constants/queue';
import type { QueueRow, RemoveQueueRequest } from '../types/queue';

import 'elements/emby-button/emby-button';
import 'elements/emby-button/paper-icon-button-light';
import 'elements/emby-checkbox/emby-checkbox';
import 'material-design-icons-iconfont';

const DIALOG_HTML = '<div class="formDialogHeader">'
    + '<button is="paper-icon-button-light" class="btnCancel autoSize" tabindex="-1" title="Back">'
    + '<span class="material-icons arrow_back" aria-hidden="true"></span></button>'
    + '<h3 class="formDialogHeaderTitle">Remove from queue</h3></div>'
    + '<div class="formDialogContent smoothScrollY"><div class="dialogContentInner dialog-content-centered jfmod-queueRemove">'
    + '<p class="jfmod-queueRemoveText"></p>'
    + '<div class="checkboxContainer checkboxContainer-withDescription"><label>'
    + '<input type="checkbox" is="emby-checkbox" class="jfmod-queueRemoveClient" />'
    + '<span>Also remove it from the download client</span></label>'
    + '<div class="fieldDescription checkboxFieldDescription">Deletes the torrent and its downloaded data from the client.'
    + ' Library files are never deleted.</div></div>'
    + '<div class="checkboxContainer checkboxContainer-withDescription"><label>'
    + '<input type="checkbox" is="emby-checkbox" class="jfmod-queueRemoveBlocklist" />'
    + '<span>Blocklist this release</span></label>'
    + '<div class="fieldDescription checkboxFieldDescription">Later release searches reject it.</div></div>'
    + '<div class="formDialogFooter">'
    + '<button is="emby-button" type="button" class="raised button-delete block formDialogFooterItem jfmod-queueRemoveConfirm">'
    + 'Remove</button></div></div></div>';

/**
 * The stock form dialog with Remove's two sub-options (UX §10). Back or Escape cancels and the dialog helper
 * returns focus to the row that opened it (UX §13). Resolves null on cancel.
 */
export const confirmQueueRemoval = (row: QueueRow): Promise<RemoveQueueRequest | null> => {
    const dlg = dialogHelper.createDialog({ removeOnClose: true, scrollY: false, size: layoutManager.tv ? 'fullscreen' : 'small' });
    dlg.classList.add('formDialog', 'jfmod-queueRemoveDialog');
    dlg.innerHTML = DIALOG_HTML;
    const text = dlg.querySelector('.jfmod-queueRemoveText');
    if (text) text.textContent = 'Stop importing ' + queueRowTitle(row) + '?';
    let result: RemoveQueueRequest | null = null;
    dlg.querySelector('.btnCancel')?.addEventListener('click', () => dialogHelper.close(dlg));
    dlg.querySelector('.jfmod-queueRemoveConfirm')?.addEventListener('click', () => {
        result = {
            removeFromClient: !!dlg.querySelector<HTMLInputElement>('.jfmod-queueRemoveClient')?.checked,
            blocklist: !!dlg.querySelector<HTMLInputElement>('.jfmod-queueRemoveBlocklist')?.checked
        };
        dialogHelper.close(dlg);
    });
    return dialogHelper.open(dlg).then(() => result, () => result);
};

interface RowMenuOptions {
    api: Api;
    row: QueueRow;
    isAdmin: boolean;
    positionTo: HTMLElement;
    /** Called after a change the server accepted, so the page can refetch and keep focus in the list. */
    onChanged: (row: QueueRow, action: 'remove' | 'retry') => void;
}

/** Actions a row offers the caller. Ordinary users get none (PHASE5 I7: the writes are admin-only). */
export const queueRowActions = (row: QueueRow, isAdmin: boolean) => {
    if (!isAdmin) return [];
    const items = [{ id: 'remove', name: 'Remove', icon: 'delete' }];
    if (isRetryable(row.state)) items.push({ id: 'retry', name: 'Retry', icon: 'refresh' });
    if (row.client?.openUrl) items.push({ id: 'open', name: 'Open in client', icon: 'open_in_new' });
    return items;
};

/** The row menu: the stock action sheet on every layout; on TV it is what Enter on a row opens (UX §13). */
export const openQueueRowMenu = async ({ api, row, isAdmin, positionTo, onChanged }: RowMenuOptions) => {
    const items = queueRowActions(row, isAdmin);
    if (!items.length) return;
    let id: unknown;
    try {
        id = await actionsheet.show({ items, positionTo, title: queueRowTitle(row) });
    } catch {
        return;
    }
    if (id === 'open' && row.client?.openUrl) {
        shell.openUrl(row.client.openUrl, '_blank');
        return;
    }
    if (id === 'retry') {
        try {
            await retryImport(api, row.id);
            toast('Retrying the import.');
            onChanged(row, 'retry');
        } catch (error) {
            toast(actionErrorMessage(error, 'The import could not be retried. Please try again.'));
        }
        return;
    }
    if (id !== 'remove') return;
    // The action sheet has closed; the dialog must return focus to the row, not to a removed sheet item.
    if (document.body.contains(positionTo)) focusManager.focus(positionTo);
    const request = await confirmQueueRemoval(row);
    if (!request) return;
    try {
        await removeQueueRow(api, row.id, request);
        toast('Removed from the queue.');
        onChanged(row, 'remove');
    } catch (error) {
        toast(actionErrorMessage(error, 'It could not be removed. Please try again.'));
    }
};

/** A context menu for a `grabbed` or `downloading` catalog card with a single mod action (P5.I8). */
export const openInFlightCardMenu = async (positionTo: HTMLElement) => {
    try {
        const id = await actionsheet.show({ items: [{ id: 'queue', name: 'View queue', icon: 'download' }], positionTo });
        if (id === 'queue') window.location.hash = '#' + QUEUE_ROUTE;
    } catch {
        // Closed without a choice.
    }
};
