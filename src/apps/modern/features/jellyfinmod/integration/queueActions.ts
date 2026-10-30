import type { Api } from '@jellyfin/sdk/lib/api';
import escapeHtml from 'escape-html';

import actionsheet from 'components/actionSheet/actionSheet';
import dialogHelper from 'components/dialogHelper/dialogHelper';
import focusManager from 'components/focusManager';
import layoutManager from 'components/layoutManager';
import toast from 'components/toast/toast';

import { cancelGrab, removeQueueRow, retryImport } from '../api/modApi';
import { actionErrorMessage, formatBytes, isReplace, isRetryable, progressPercent, QUEUE_ROUTE, QUEUE_STATE_LABEL, queueRowTitle, reasonMessage,
    replacedWords, seedingFacts } from '../constants/queue';
import type { QueueRow, QueueState, RemoveQueueRequest } from '../types/queue';

import 'elements/emby-button/emby-button';
import 'elements/emby-button/paper-icon-button-light';
import 'elements/emby-checkbox/emby-checkbox';
import 'material-design-icons-iconfont';
import '../components/removeDialog.scss';

/** A choice of the removal dialog: one button, its result under it (queue Remove dialog, D118, user-approved 2026-10-29). */
interface RemovalChoice {
    /** What the button asks the plugin: delete the files, keep them, or nothing (the safe choice). */
    id: 'delete' | 'keep' | 'cancel';
    name: string;
    red?: boolean;
    text?: string;
}

/** What the dialog shows for a row: its title (the row's action), question, facts and choices. */
interface RemovalPlan {
    title: string;
    question: string;
    /** The facts that decide it: `42% · 3.1 of 7.4 GB downloaded …`; `fail` draws the line in the failure colour. */
    facts: { html: string; fail?: boolean }[];
    notes: string[];
    choices: RemovalChoice[];
    blocklist: boolean;
}

const UNDER_WAY_STATES: ReadonlySet<QueueState> = new Set<QueueState>(['queued', 'downloading', 'stalled', 'unknown']);
const IMPORTING_STATES: ReadonlySet<QueueState> = new Set<QueueState>(['identifying', 'linking', 'scanning']);

/**
 * A pack whose episodes have started importing may already have files in the library (D39). Only for a plugin that sends no
 * `canDeleteFiles`, which is the plugin's own answer.
 */
export const keepsDownloadedFiles = (row: QueueRow) => !!row.pack?.episodes.some(episode => !!episode.importState && episode.importState !== 'waiting');

/** Whether Remove may delete what the download fetched: the plugin's `canDeleteFiles` (D124), else the same guess as before. */
const canDeleteFiles = (row: QueueRow) => row.canDeleteFiles
    ?? ((UNDER_WAY_STATES.has(row.state) || row.state === 'failed' || row.state === 'blocked') && !keepsDownloadedFiles(row));

const clientName = (row: QueueRow) => row.client?.name ?? 'The download client';

/** What a Replace keeps when it is cancelled: `Your 1080p file stays.` */
const replaceStays = (row: QueueRow) => {
    if (!isReplace(row)) return null;
    const { words, many } = replacedWords(row);
    if (words === 'the current file') return 'The current file stays.';
    if (!many) return 'Your ' + words + ' file stays.';
    return 'Your ' + words + (words.endsWith(' files') ? '' : ' files') + ' stay.';
};

const HIT_AND_RUN = 'Stopping earlier gives the tracker less than it asks for; on a private tracker that can count as a hit-and-run.';

/** When the seeding stops by itself, and what leaving earlier means (D122). */
const seedingNote = (seeding: QueueRow['seeding']) => {
    if (seeding && !seeding.releaseEnabled) return 'Automatic stop is off, so it seeds until you stop it.';
    const goals = seeding?.waitingFor.filter(reason => reason !== 'complete') ?? [];
    if (!goals.length) return 'Its goals are met, so JellyfinMod stops it by itself soon.';
    let which = 'the seeding time goal is';
    if (goals.length > 1) which = 'both goals are';
    else if (goals[0] === 'ratio') which = 'the ratio goal is';
    return 'JellyfinMod stops it by itself once ' + which + ' met. ' + HIT_AND_RUN;
};

const libraryWord = (row: QueueRow) => {
    if (row.pack) return 'The episodes stay in your library.';
    return row.episode ? 'The episode stays in your library.' : 'The film stays in your library.';
};

/** Stop Seeding (D122): no delete, no blocklist; its file is the library's under a second name. */
const seedingPlan = (row: QueueRow): RemovalPlan => {
    const figures = row.seeding ? seedingFacts(row.seeding).figures : null;
    const files = row.seeding?.libraryLinkPresent === false ?
        'Its file stays in the download folder; it is not deleted from here.' :
        'Nothing to delete: the seeding file and the library file are one file under two names (a hardlink), so it takes no extra space.';
    return {
        title: 'Stop Seeding', question: 'Stop seeding ' + queueRowTitle(row) + ' now?',
        facts: [{ html: '<span class="jfmod-removeOk">In your library</span>' + (figures ? ' · ' + escapeHtml(figures) : '') }],
        notes: [seedingNote(row.seeding), files],
        choices: [{ id: 'keep', name: 'Stop Seeding', red: true, text: clientName(row) + ' removes the torrent. ' + libraryWord(row) },
            { id: 'cancel', name: 'Keep Seeding' }],
        blocklist: false
    };
};

/** A pack episode's import that put its file in the library (linked, being scanned, or bound); a failure before the link did not. */
const IN_LIBRARY: ReadonlySet<string> = new Set(['linked', 'scanning', 'completed']);

/**
 * The plugin's blocked reasons that come only after a successful link, the library hardlink kept (ImportService: Jellyfin did not
 * bind the file after two scans; `scan_timeout` from older plugins); every other blocked reason is set before the link.
 */
const BLOCKED_AFTER_LINK: ReadonlySet<string> = new Set(['binding_not_observed', 'scan_timeout']);

const inLibrary = (episode: { importState: string | null; reason: string | null }) => !!episode.importState
    && (IN_LIBRARY.has(episode.importState) || (episode.importState === 'blocked' && !!episode.reason && BLOCKED_AFTER_LINK.has(episode.reason)));

const importedEpisodes = (row: QueueRow) => row.pack?.episodes.filter(inLibrary).length ?? 0;

/** How much is on disk: `3.1 GB`, from the client's bytes or the progress of the size. */
const downloadedWords = (row: QueueRow) => {
    if (row.downloadedBytes !== null) return formatBytes(row.downloadedBytes);
    return row.progress !== null && row.sizeBytes !== null ? formatBytes(row.progress * row.sizeBytes) : null;
};

/** The waiting episodes' own files together (P5.FU3), when the plugin sends each one's progress. */
const waitingPercent = (waiting: NonNullable<QueueRow['pack']>['episodes']) => {
    const own = waiting.map(episode => episode.progress).filter((value): value is number => typeof value === 'number');
    return own.length && own.length === waiting.length ? progressPercent(own.reduce((sum, value) => sum + value, 0) / own.length) : null;
};

/** The facts line under the question: the progress and what is on disk, or what of a pack is in the library. */
const progressFacts = (row: QueueRow, underWay: boolean, deletable: boolean): string | null => {
    const percent = progressPercent(row.progress);
    const imported = importedEpisodes(row);
    // The library's promise only where nothing is deleted (Codex review P2 1): a deletable pack says what the delete removes.
    if (row.pack && imported > 0 && !deletable) {
        const waiting = row.pack.episodes.filter(episode => !episode.importState || episode.importState === 'waiting');
        const restPercent = waitingPercent(waiting) ?? percent;
        const rest = underWay && waiting.length > 0 && restPercent !== null ? ' · the other ' + waiting.length + ' at ' + restPercent + '%' : '';
        return '<span class="jfmod-removeOk">' + imported + ' of ' + row.pack.episodes.length + ' episodes are in your library</span> and stay there' + rest;
    }
    if (!deletable) return null;
    const where = underWay ? 'nothing of it is in your library yet' : 'nothing of it is in your library';
    if (underWay && !row.progress) return escapeHtml('Not started yet · ' + where);
    const downloaded = downloadedWords(row);
    const size = underWay ? formatBytes(row.sizeBytes) : null;
    const ofSize = size ? ' of ' + size : '';
    const amount = downloaded ? downloaded + ofSize + ' downloaded' : null;
    return escapeHtml([underWay && percent !== null ? percent + '%' : null, amount, where].filter(Boolean).join(' · '));
};

/** Why the files stay (D123, D124): the plugin's refusal, or part of it already in the library. */
const keptNote = (row: QueueRow, refused: string | null) => {
    if (refused) return refused;
    const imported = importedEpisodes(row);
    const others = row.pack ? row.pack.episodes.length - imported : 0;
    return 'Its files cannot be deleted from here, because part of it is already in your library.'
        + (imported > 0 && others > 0 ? ' What the other ' + others + ' episodes downloaded stays in the download folder.' : '');
};

/** Delete the Download, and for a failure Keep the Files (D121). */
const deleteChoices = (row: QueueRow, underWay: boolean): RemovalChoice[] => {
    const client = clientName(row);
    const downloaded = downloadedWords(row);
    let what = 'what it downloaded.';
    if (downloaded) what = underWay ? 'the ' + downloaded + ' downloaded so far.' : 'its ' + downloaded + '.';
    const choices: RemovalChoice[] = [{ id: 'delete', name: 'Delete the Download', red: true, text: client + ' removes the torrent and deletes ' + what }];
    if (!underWay) {
        const kept = downloaded ? 'the ' + downloaded : 'what it downloaded';
        choices.push({ id: 'keep', name: 'Keep the Files', text: client + ' removes the torrent; ' + kept + ' stays in the download folder.' });
    }
    return choices;
};

/** The choices (D121, D123): Delete the Download where it may, else a removal keeping the files; then the safe one. */
const removalChoices = (row: QueueRow, underWay: boolean, deletable: boolean): RemovalChoice[] => {
    let choices: RemovalChoice[];
    if (deletable) {
        choices = deleteChoices(row, underWay);
    } else {
        const imported = importedEpisodes(row);
        const episodes = imported > 1 ? ' imported episodes' : ' imported episode';
        const seeds = imported > 0 ? ' and stops seeding the ' + imported + episodes : '';
        choices = [{ id: 'keep', name: underWay ? 'Stop the Download' : 'Remove from Queue', red: true,
            text: clientName(row) + ' removes the torrent' + seeds + '. No file is deleted.' }];
    }
    choices.push({ id: 'cancel', name: underWay ? 'Keep Downloading' : 'Cancel' });
    return choices;
};

/** The plan of the dialog for a row (D119–D123); `refused` is the plugin's sentence when it refused a delete. */
const removalPlan = (row: QueueRow, refused: string | null): RemovalPlan => {
    if (row.state === 'seeding') return seedingPlan(row);
    const underWay = UNDER_WAY_STATES.has(row.state);
    const deletable = !refused && canDeleteFiles(row);
    const facts: RemovalPlan['facts'] = [];
    if (!underWay) {
        const why = reasonMessage(row.reason, row.message);
        facts.push({ html: escapeHtml(QUEUE_STATE_LABEL[row.state] + (why ? ': ' + why : '')), fail: true });
    }
    const progress = progressFacts(row, underWay, deletable);
    if (progress) facts.push({ html: progress });
    const notes: string[] = [];
    const stays = replaceStays(row);
    if (stays) notes.push(stays);
    if (!deletable) notes.push(keptNote(row, refused));
    const title = queueRowTitle(row);
    return {
        title: underWay ? 'Cancel Download' : 'Remove Download',
        question: underWay ? 'Stop downloading ' + title + '?' : 'Remove ' + title + ' from the queue?',
        facts, notes, choices: removalChoices(row, underWay, deletable), blocklist: true
    };
};

/**
 * The removal dialog (D118): the row's action as its title, the question about the title, the facts that decide it, then one
 * button per outcome with its result under it; the destructive one red, the safe one focused and changing nothing. Blocklist is
 * one checkbox, independent of the choice. The close X in the header, Back on the TV and Escape on a computer are the safe choice
 * too; the dialog helper returns focus to the opener.
 */
const confirmRemoval = (row: QueueRow, refused: string | null): Promise<RemoveQueueRequest | null> => {
    const plan = removalPlan(row, refused);
    const dlg = dialogHelper.createDialog({ removeOnClose: true, scrollY: false, size: layoutManager.tv ? 'fullscreen' : undefined });
    dlg.classList.add('formDialog', 'jfmod-removeDialog', 'align-items-center', 'justify-content-center');
    if (!layoutManager.tv) dlg.classList.add('dialog-fullscreen-lowres');
    let html = '<div class="formDialogContent smoothScrollY no-grow jfmod-removeContent"><div class="jfmod-remove">'
        + '<div class="jfmod-removeHead"><h1 class="jfmod-removeTitle">' + escapeHtml(plan.title) + '</h1>'
        + '<button is="paper-icon-button-light" type="button" class="jfmod-removeClose" title="Close" aria-label="Close">'
        + '<span class="material-icons close" aria-hidden="true"></span></button></div>'
        + '<p class="jfmod-removeQuestion">' + escapeHtml(plan.question) + '</p>';
    for (const fact of plan.facts) html += '<p class="jfmod-removeFacts' + (fact.fail ? ' jfmod-removeFacts--fail' : '') + '">' + fact.html + '</p>';
    for (const note of plan.notes) html += '<p class="jfmod-removeNote">' + escapeHtml(note) + '</p>';
    html += '<p class="jfmod-removeRelease jfmod-mono">' + escapeHtml(row.releaseTitle) + '</p>';
    if (plan.blocklist) {
        html += '<div class="checkboxContainer checkboxContainer-withDescription jfmod-removeBlocklist"><label>'
            + '<input type="checkbox" is="emby-checkbox" class="jfmod-removeBlocklistBox" /><span>Blocklist this release</span></label>'
            + '<div class="fieldDescription checkboxFieldDescription">Later searches skip it.</div></div>';
    }
    for (const choice of plan.choices) {
        html += '<button is="emby-button" type="button" class="raised block jfmod-removeChoice' + (choice.red ? ' button-delete' : '') + '" data-choice="'
            + choice.id + '"' + (choice.id === 'cancel' ? ' autofocus' : '') + '>' + escapeHtml(choice.name) + '</button>';
        if (choice.text) html += '<div class="fieldDescription jfmod-removeChoiceText">' + escapeHtml(choice.text) + '</div>';
    }
    dlg.innerHTML = html + '</div></div>';
    let result: RemoveQueueRequest | null = null;
    // It closes once. The helper starts its close at once but marks the dialog closed only after the 120 ms animation, so a
    // second Escape, X, Back, choice, click or right-click outside in between closed it again: the focus scope was popped and history went
    // Back twice, leaving the page (or the release picker under it). Every later attempt is dropped from the first `closing` on,
    // and a later choice no longer changes the answer.
    let closing = false;
    dlg.addEventListener('closing', () => {
        closing = true;
    });
    const close = () => {
        if (!closing) dialogHelper.close(dlg);
    };
    const holdWhileClosing = (event: Event) => {
        if (closing && (event.type !== 'command' || (event as CustomEvent<{ command?: string }>).detail?.command === 'back')) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    };
    // The TV's Back and a click or right-click outside reach the helper's own handlers; they are held here first.
    dlg.addEventListener('command', holdWhileClosing, true);
    dlg.querySelector('.jfmod-removeClose')?.addEventListener('click', close);
    // Escape closes it on a computer too (the TV already maps Escape to Back), wherever focus is.
    const onKey = (event: KeyboardEvent) => {
        if (event.key === 'Escape' && !layoutManager.tv) close();
    };
    document.addEventListener('keydown', onKey);
    dlg.querySelectorAll<HTMLButtonElement>('.jfmod-removeChoice').forEach(button => {
        button.addEventListener('click', () => {
            if (closing) return;
            const id = button.getAttribute('data-choice');
            if (id === 'delete' || id === 'keep') {
                result = {
                    removeFromClient: true,
                    deleteFiles: id === 'delete',
                    blocklist: !!dlg.querySelector<HTMLInputElement>('.jfmod-removeBlocklistBox')?.checked
                };
            }
            close();
        });
    });
    // The dialog helper gives focus back on the TV only; on a computer and a phone the opener gets it here, so the keyboard keeps
    // its place in the list.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const done = () => {
        document.removeEventListener('keydown', onKey);
        if (!layoutManager.tv && opener?.isConnected) focusManager.focus(opener);
        return result;
    };
    const opened = dialogHelper.open(dlg).then(done, done);
    const container = (dlg as HTMLElement & { dialogContainer?: HTMLElement }).dialogContainer;
    container?.addEventListener('click', holdWhileClosing, true);
    container?.addEventListener('contextmenu', holdWhileClosing, true);
    return opened;
};

const refusedDelete = (error: unknown) => {
    const data = (error as { response?: { data?: { type?: unknown; title?: unknown } } })?.response?.data;
    return data?.type === 'delete_not_allowed' && typeof data.title === 'string' ? data.title : null;
};

/** Two frames: React has rendered what was just set (an enabled opener, a closed menu and its focus trap gone). */
const nextFrames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

/** Enables the opener a request disabled, lets it render, and gives it focus back before the dialog asks again. */
const refocus = async (opener: HTMLElement | null, busy?: (on: boolean) => void) => {
    busy?.(false);
    await nextFrames();
    if (opener?.isConnected) focusManager.focus(opener);
};

/**
 * Asks the removal dialog and removes the row as chosen: every surface's Remove, Cancel Download and Stop Seeding (D120). A held
 * grab has no torrent yet and is cancelled without a question (P4.FU10). A delete the plugin still refuses (`delete_not_allowed`:
 * a file linked elsewhere, data outside the mapped folder) asks again without it, with the plugin's sentence (D124). Resolves
 * true once removed, false when the person kept it; rejects with the plugin's error otherwise. `busy(true)` runs as a request goes,
 * after the dialog has closed and returned focus; `busy(false)` before a refused delete asks again, so the opener is enabled and
 * focused again first, and the dialog returns focus to it whatever the person picks.
 */
export const removeWithDialog = async (api: Api, row: QueueRow, busy?: (on: boolean) => void): Promise<boolean> => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (isHeldRow(row)) {
        busy?.(true);
        await cancelGrab(api, row.grabId);
        return true;
    }
    let refused: string | null = null;
    for (;;) {
        const request = await confirmRemoval(row, refused);
        if (!request) return false;
        busy?.(true);
        try {
            await removeQueueRow(api, row.id, request);
            return true;
        } catch (error) {
            const why = request.deleteFiles ? refusedDelete(error) : null;
            if (!why) throw error;
            refused = why;
            await refocus(opener, busy);
        }
    }
};

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
 * Actions a row offers the caller, each named by its outcome (D119): Cancel Download while anything downloads, Remove for a failed
 * or blocked row (with Retry), Stop Seeding for one in the library; none while it imports. Ordinary users get none (PHASE5 I7).
 */
export const queueRowActions = (row: QueueRow, isAdmin: boolean) => {
    if (!isAdmin) return [];
    // A held grab is cancelled; one being sent can be neither cancelled nor removed until the client answers.
    if (isHeldRow(row)) return row.importState === 'held' ? [{ id: 'cancel', name: 'Cancel', icon: 'close' }] : [];
    if (IMPORTING_STATES.has(row.state)) return [];
    if (row.state === 'seeding') return [{ id: 'remove', name: 'Stop Seeding', icon: 'stop' }];
    if (!isRetryable(row.state)) return [{ id: 'remove', name: 'Cancel Download', icon: 'close' }];
    return [{ id: 'remove', name: 'Remove', icon: 'delete' }, { id: 'retry', name: 'Retry', icon: 'refresh' }];
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
    // The menu has closed (the desktop popover once React has rendered it closed, so its focus trap lets go); the dialog must
    // return focus to the row or its ⋮, not to a removed menu item.
    await nextFrames();
    if (document.body.contains(positionTo)) focusManager.focus(positionTo);
    try {
        if (!await removeWithDialog(api, row)) return;
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
