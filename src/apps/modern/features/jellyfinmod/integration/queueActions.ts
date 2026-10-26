import type { Api } from '@jellyfin/sdk/lib/api';
import escapeHtml from 'escape-html';

import actionsheet from 'components/actionSheet/actionSheet';
import confirm from 'components/confirm/confirm';
import dialogHelper from 'components/dialogHelper/dialogHelper';
import focusManager from 'components/focusManager';
import layoutManager from 'components/layoutManager';
import toast from 'components/toast/toast';

import { cancelGrab, removeQueueRow, retryImport } from '../api/modApi';
import { actionErrorMessage, isRetryable, QUEUE_ROUTE, queueRowTitle } from '../constants/queue';
import type { QueueRow, QueueState, RemoveQueueRequest } from '../types/queue';

import 'elements/emby-button/emby-button';
import 'elements/emby-button/paper-icon-button-light';
import 'elements/emby-checkbox/emby-checkbox';
import 'material-design-icons-iconfont';

const DIALOG_HTML = '<div class="formDialogHeader">'
    + '<button is="paper-icon-button-light" class="btnCancel autoSize" tabindex="-1" title="Back">'
    + '<span class="material-icons arrow_back" aria-hidden="true"></span></button>'
    + '<h3 class="formDialogHeaderTitle">Remove from Queue</h3></div>'
    + '<div class="formDialogContent smoothScrollY"><div class="dialogContentInner dialog-content-centered jfmod-queueRemove">'
    + '<p class="jfmod-queueRemoveText"></p>'
    + '<div class="checkboxContainer checkboxContainer-withDescription"><label>'
    + '<input type="checkbox" is="emby-checkbox" class="jfmod-queueRemoveClient" />'
    + '<span>Also remove it from the download client</span></label>'
    + '<div class="fieldDescription checkboxFieldDescription jfmod-queueRemoveClientText"></div></div>'
    + '<div class="checkboxContainer checkboxContainer-withDescription jfmod-queueRemoveDeleteOption hide"><label>'
    + '<input type="checkbox" is="emby-checkbox" class="jfmod-queueRemoveDelete" checked />'
    + '<span>Delete the downloaded files</span></label>'
    + '<div class="fieldDescription checkboxFieldDescription">What this torrent downloaded so far. Library files are never touched.'
    + '</div></div>'
    + '<div class="checkboxContainer checkboxContainer-withDescription"><label>'
    + '<input type="checkbox" is="emby-checkbox" class="jfmod-queueRemoveBlocklist" />'
    + '<span>Blocklist this release</span></label>'
    + '<div class="fieldDescription checkboxFieldDescription">Later release searches reject it.</div></div>'
    + '<div class="formDialogFooter">'
    + '<button is="emby-button" type="button" class="raised button-delete block formDialogFooterItem jfmod-queueRemoveConfirm">'
    + 'Remove</button></div></div></div>';

/** Rows whose download is not imported yet, so Remove can also delete what it downloaded (user, 2026-10-26). */
const DELETABLE_STATES: ReadonlySet<QueueState> = new Set<QueueState>(['queued', 'downloading', 'stalled', 'failed']);

/**
 * The stock form dialog with Remove's sub-options (UX §10). For a download not imported yet, Delete the downloaded files sits
 * under the client option, shown (ticked) only while that one is ticked; an imported or seeding row has no delete option.
 * Back or Escape cancels and the dialog helper returns focus to the row that opened it (UX §13). Resolves null on cancel.
 */
export const confirmQueueRemoval = (row: QueueRow): Promise<RemoveQueueRequest | null> => {
    const dlg = dialogHelper.createDialog({ removeOnClose: true, scrollY: false, size: layoutManager.tv ? 'fullscreen' : 'small' });
    dlg.classList.add('formDialog', 'jfmod-queueRemoveDialog');
    dlg.innerHTML = DIALOG_HTML;
    const text = dlg.querySelector('.jfmod-queueRemoveText');
    if (text) text.textContent = 'Stop importing ' + queueRowTitle(row) + '?';
    const deletable = DELETABLE_STATES.has(row.state);
    const clientText = dlg.querySelector('.jfmod-queueRemoveClientText');
    if (clientText) {
        clientText.textContent = deletable ? 'The client forgets the torrent.' :
            'The client forgets the torrent and stops seeding. The seeding copy stays on disk; library files are never touched.';
    }
    const client = dlg.querySelector<HTMLInputElement>('.jfmod-queueRemoveClient');
    const deleteOption = dlg.querySelector('.jfmod-queueRemoveDeleteOption');
    const deleteFiles = dlg.querySelector<HTMLInputElement>('.jfmod-queueRemoveDelete');
    if (deletable) client?.addEventListener('change', () => deleteOption?.classList.toggle('hide', !client.checked));
    let result: RemoveQueueRequest | null = null;
    dlg.querySelector('.btnCancel')?.addEventListener('click', () => dialogHelper.close(dlg));
    dlg.querySelector('.jfmod-queueRemoveConfirm')?.addEventListener('click', () => {
        const removeFromClient = !!client?.checked;
        result = {
            removeFromClient,
            blocklist: !!dlg.querySelector<HTMLInputElement>('.jfmod-queueRemoveBlocklist')?.checked,
            // Only a shown option counts: hidden, its tick is not sent.
            deleteFiles: deletable && removeFromClient && !!deleteFiles?.checked
        };
        dialogHelper.close(dlg);
    });
    return dialogHelper.open(dlg).then(() => result, () => result);
};

const REMOVE_TEXT = 'Remove this torrent from the download queue? The download stops, the torrent leaves the client and the files '
    + 'it downloaded are deleted. Files already in your library are not touched.';

/**
 * The torrent removal's confirmation (2026-10-12): the release picker's added-row X and a missing episode's Cancel Download
 * (P1.FU20) ask the same question, and since 2026-10-26 delete what the torrent downloaded, so Remove is the red delete
 * button. Resolves when confirmed, rejects when declined.
 */
export const confirmTorrentRemoval = (releaseTitle: string): Promise<void> => {
    // The stock dialog takes its options' `dialogOptions` (an id here), which the confirm passes through: releasePicker.scss
    // keeps Remove red under the pointer by it, where the stock `.raised:hover` would turn it grey.
    const options = { title: 'Remove the Torrent', text: REMOVE_TEXT + '<span class="jfmod-confirmName">' + escapeHtml(releaseTitle) + '</span>',
        confirmText: 'Remove', primary: 'delete', dialogOptions: { id: 'jfmodTorrentRemoval' } };
    return confirm(options);
};

/** The torrent removal itself: the client forgets the torrent and deletes what it downloaded, nothing else (user, 2026-10-26). */
export const TORRENT_REMOVAL: RemoveQueueRequest = { removeFromClient: true, blocklist: false, deleteFiles: true };

export interface RowMenuOptions {
    api: Api;
    row: QueueRow;
    isAdmin: boolean;
    positionTo: HTMLElement;
    /** Called after a change the server accepted, so the page can refetch and keep focus in the list. */
    onChanged: (row: QueueRow, action: 'remove' | 'retry') => void;
}

/** A grab the client has not accepted yet (P4.FU10): queued, with nothing in the client to remove. */
export const isHeldRow = (row: QueueRow) => row.importState === 'held' || row.importState === 'submitting';

/**
 * Cancels a held grab or removes a download from the queue (the client forgets the torrent and deletes what it downloaded):
 * what the missing episode page's Cancel Download does.
 */
export const cancelDownload = (api: Api, row: QueueRow) => (isHeldRow(row) ?
    cancelGrab(api, row.grabId).then(() => undefined) :
    removeQueueRow(api, row.id, TORRENT_REMOVAL).then(() => undefined));

/** Actions a row offers the caller. Ordinary users get none (PHASE5 I7: the writes are admin-only). */
export const queueRowActions = (row: QueueRow, isAdmin: boolean) => {
    if (!isAdmin) return [];
    // A held grab is cancelled; one being sent can be neither cancelled nor removed until the client answers.
    if (isHeldRow(row)) return row.importState === 'held' ? [{ id: 'cancel', name: 'Cancel', icon: 'close' }] : [];
    const items = [{ id: 'remove', name: 'Remove', icon: 'delete' }];
    if (isRetryable(row.state)) items.push({ id: 'retry', name: 'Retry', icon: 'refresh' });
    return items;
};

/**
 * The row menu on the phone and the TV: the stock action sheet (on TV what Enter on a row opens, UX §13), its items only (user
 * 2026-10-19: "No need for such header at all. Just show menu Remove"). The desktop table opens its own popover (QueuePage).
 */
export const openQueueRowMenu = async (options: RowMenuOptions) => {
    const items = queueRowActions(options.row, options.isAdmin);
    if (!items.length) return;
    let id: unknown;
    try {
        id = await actionsheet.show({ items, positionTo: options.positionTo });
    } catch {
        return;
    }
    await runQueueRowAction(options, id);
};

/** What a row menu's item does, whichever menu it was chosen in. */
export const runQueueRowAction = async ({ api, row, positionTo, onChanged }: RowMenuOptions, id: unknown) => {
    if (id === 'cancel') {
        try {
            await cancelGrab(api, row.grabId);
            toast('Cancelled.');
            onChanged(row, 'remove');
        } catch (error) {
            toast(actionErrorMessage(error, 'It could not be cancelled. Please try again.'));
        }
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
        const id = await actionsheet.show({ items: [{ id: 'queue', name: 'View Queue', icon: 'download' }], positionTo });
        if (id === 'queue') window.location.hash = '#' + QUEUE_ROUTE;
    } catch {
        // Closed without a choice.
    }
};
