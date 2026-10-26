/* eslint-disable no-restricted-globals -- a Node acceptance runner, not shipped code */
/* global document, getComputedStyle, localStorage, location, ApiClient */
// Remove from Queue and Remove the Torrent delete the downloaded files (user-approved copy and red Remove, 2026-10-26;
// reviews/queue-remove-delete/ in the workspace), in a real browser against a local environment, signed in as oleksii with an
// empty password.
//
// JELLYFINMOD_RD_MODE=matrix (default): INTERCEPTED ANSWERS, NOTHING IS REMOVED. The queue (a downloading movie row, a seeding
// row and a downloading row for a missing episode) is answered by this runner, and every DELETE of a queue row is stopped
// before it leaves the browser (and counted: the run fails if there is one). Checks the Remove from Queue dialog for a download
// not yet imported (the client option's text; Delete the downloaded files hidden until the client option is ticked, then shown,
// ticked, indented 2.2em with its label under the client option's label; hidden again when unticked) and for a seeding row (the
// seeding text, never a delete option), and the missing episode's Cancel Download confirmation (the new text, the release name,
// Remove red at rest and under the pointer). Every dialog is left with Back. Safe on alpha and beta.
//
// JELLYFINMOD_RD_MODE=live: REMOVES FOR REAL, on a pool environment other than alpha and beta (proven by local-env.mjs). With
// JELLYFINMOD_RD_RELEASE=<release title of a downloading queue row> it removes that row from the Queue page with the client
// option and Delete the downloaded files ticked; with JELLYFINMOD_RD_PICK_ENTRY=<entry id> and JELLYFINMOD_RD_PICK_TITLE=<raw
// title> it adds that release in the picker and removes it again with the added row's X. Both check the request sent
// (removeFromClient and deleteFiles true) and its 200; the files and the client are checked by the caller.
//
//   JELLYFINMOD_LIVE_URL=<local environment>  JELLYFINMOD_LIVE_FIXTURE_FILE=<any 0600 file; none of it is used here>
//   [JELLYFINMOD_LIVE_LAYOUT=desktop|mobile|tv1080]  [JELLYFINMOD_RD_THEME=dark|light]  [JELLYFINMOD_BROWSER=chromium|chrome]
//   [JELLYFINMOD_LIVE_SHOTS=<folder>]  [JELLYFINMOD_RD_PICK_WAIT=<seconds to let the picked release download before X, 10>]
import { provenLocalEnvironment } from './local-env.mjs';
import { api, launch, newPage, notVerified, origin, record, results, saveResults, setTvLayout, signIn, tier, until } from './live-lib.mjs';

if (!['127.0.0.1', 'localhost'].includes(origin.hostname)) throw new Error('Runs on a local environment only');
const mode = process.env.JELLYFINMOD_RD_MODE ?? 'matrix';
if (mode === 'live') await provenLocalEnvironment(origin);
const layout = process.env.JELLYFINMOD_LIVE_LAYOUT ?? 'desktop';
const theme = process.env.JELLYFINMOD_RD_THEME ?? 'dark';
const tv = layout.startsWith('tv');
const shots = process.env.JELLYFINMOD_LIVE_SHOTS ?? '.';
const label = `remove-delete ${mode} ${layout} ${theme}`;
const RED = 'rgb(198, 40, 40)';
const CONFIRM_TEXT = 'Remove this torrent from the download queue? The download stops, the torrent leaves the client and the files it '
    + 'downloaded are deleted. Files already in your library are not touched.';
const SEEDING_TEXT = 'The client forgets the torrent and stops seeding. The seeding copy stays on disk; library files are never touched.';
const shot = (page, name) => page.screenshot({ path: `${shots}/remove-delete-${tier}-${layout}-${theme}-${name}.png` }).catch(() => undefined);

const browser = await launch();
const { context, page } = await newPage(browser, tv ? 'tv1080' : layout);
const deletes = [];
page.on('request', request => {
    if (request.method() === 'DELETE' && /\/JellyfinMod\/Queue\//.test(request.url())) deletes.push(request.postData());
});

async function useTheme() {
    await page.evaluate(name => localStorage.setItem(ApiClient.getCurrentUserId() + '-appTheme', name), theme);
    if (tv) {
        await setTvLayout(page);
        return;
    }
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
        try {
            return !!ApiClient.getCurrentUserId();
        } catch {
            return false;
        }
    }, undefined, { timeout: 30000 });
    await page.waitForTimeout(2000);
}

/** Opens a queue row's menu and picks Remove: the desktop popover, or the action sheet by Enter (TV) or tap (phone). */
async function openRemove(releaseTitle) {
    await page.evaluate(() => {
        location.hash = '#/catalog/queue';
    });
    if (tv) {
        const row = page.locator('.jfmod-queueRow--tv').filter({ hasText: releaseTitle }).first();
        await row.waitFor({ state: 'visible', timeout: 30000 });
        await row.focus();
        await page.keyboard.press('Enter');
    } else {
        const row = page.locator(layout === 'desktop' ? '.jfmod-queueTableRow' : '.jfmod-queueRow--stacked').filter({ hasText: releaseTitle }).first();
        await row.waitFor({ state: 'visible', timeout: 30000 });
        await row.locator('.jfmod-queueMenu').click();
    }
    const item = page.locator('[data-id="remove"]:visible').first();
    await item.waitFor({ state: 'visible', timeout: 10000 });
    if (tv) {
        await item.focus();
        await page.keyboard.press('Enter');
    } else {
        await item.click();
    }
    await page.locator('.jfmod-queueRemoveDialog').waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(500);
}

const dialogState = () => page.evaluate(() => {
    const dlg = document.querySelector('.jfmod-queueRemoveDialog');
    const option = dlg.querySelector('.jfmod-queueRemoveDeleteOption');
    const shown = !!option && !option.classList.contains('hide') && option.getBoundingClientRect().height > 0;
    const labelLeft = node => node?.closest('label')?.querySelector('span')?.getBoundingClientRect().left ?? null;
    const confirm = dlg.querySelector('.jfmod-queueRemoveConfirm');
    return {
        clientText: dlg.querySelector('.jfmod-queueRemoveClientText')?.textContent ?? null,
        clientChecked: dlg.querySelector('.jfmod-queueRemoveClient')?.checked ?? null,
        deleteShown: shown,
        deleteChecked: dlg.querySelector('.jfmod-queueRemoveDelete')?.checked ?? null,
        deleteLabel: dlg.querySelector('.jfmod-queueRemoveDelete')?.closest('label')?.textContent ?? null,
        deleteText: option?.querySelector('.fieldDescription')?.textContent ?? null,
        indentEm: option ? parseFloat(getComputedStyle(option).marginLeft) / parseFloat(getComputedStyle(option).fontSize) : null,
        deleteBoxLeft: shown ? option.querySelector('.checkboxOutline, .emby-checkbox-label, input')?.getBoundingClientRect().left ?? null : null,
        clientLabelLeft: labelLeft(dlg.querySelector('.jfmod-queueRemoveClient')),
        deleteLabelLeft: shown ? labelLeft(dlg.querySelector('.jfmod-queueRemoveDelete')) : null,
        removeBackground: confirm ? getComputedStyle(confirm).backgroundColor : null
    };
});

async function tickClient() {
    const box = page.locator('.jfmod-queueRemoveDialog .jfmod-queueRemoveClient');
    if (tv) {
        // The remote's OK; where the stock checkbox does not toggle on it, the press it stands for.
        const before = await box.isChecked();
        await box.focus();
        await page.keyboard.press('Enter');
        if (await box.isChecked() === before) await box.evaluate(node => node.click());
    } else {
        await page.locator('.jfmod-queueRemoveDialog label:has(.jfmod-queueRemoveClient) > span').last().click();
    }
    await page.waitForTimeout(300);
}

async function back(selector) {
    if (tv) await page.keyboard.press('Escape');
    else await page.locator(`${selector} .btnCancel`).click();
    await page.locator(selector).waitFor({ state: 'detached', timeout: 10000 });
}

async function matrix() {
    await page.route(/\/JellyfinMod\/Queue\/[0-9a-f]+/, route => (route.request().method() === 'DELETE' ? route.abort() : route.continue()));
    // 0. The environment's own seeding row, when it has one (alpha and beta keep an imported download seeding): no delete option.
    const real = (await api(page, 'GET', 'JellyfinMod/Queue')).body?.items?.find(item => item.state === 'seeding');
    if (real) {
        await openRemove(real.releaseTitle);
        await tickClient();
        const own = await dialogState();
        record(label, 'The environment\'s own seeding row: the seeding text, no delete option with the client option ticked',
            own.clientText === SEEDING_TEXT && own.clientChecked === true && !own.deleteShown, { release: real.releaseTitle, ...own });
        await shot(page, 'dialog-real-seeding');
        await back('.jfmod-queueRemoveDialog');
    }
    const entries = (await api(page, 'GET', 'JellyfinMod/Entries?limit=50')).body;
    const items = entries?.items ?? entries;
    const movie = items.find(item => item.mediaType === 'movie' && item.state === 'onDisk');
    const show = items.find(item => item.title === 'Peep Show');
    const detail = (await api(page, 'GET', `JellyfinMod/Entries/${show.id}`)).body;
    const episode = detail.episodes.find(item => item.state !== 'onDisk' && item.seasonNumber === 1);
    if (!movie || !episode) throw new Error('no movie on disk or no missing Peep Show episode');
    const at = new Date().toISOString();
    const row = (id, entry, ep, title, state, extra = {}) => ({ id, grabId: id.replace(/^./, 'f'), entry: { id: entry.id, mediaType: entry.mediaType,
        title: entry.title, year: entry.year ?? null, posterPath: null, jellyfinItemId: null, targetLibraryId: null },
    episode: ep ? { id: ep.id, seasonNumber: ep.seasonNumber, episodeNumber: ep.episodeNumber, title: ep.title } : null, releaseTitle: title, state,
    importState: state === 'seeding' ? 'completed' : 'waiting', reason: null, message: null, progress: state === 'seeding' ? 1 : 0.42,
    sizeBytes: 4600000000, downloadedBytes: state === 'seeding' ? 4600000000 : 1900000000, downloadRateBytes: state === 'seeding' ? 0 : 3100000,
    etaSeconds: state === 'seeding' ? null : 720, stalledSince: null, observedAt: at, versionLabel: null, intent: 'acquire', createdAt: at, updatedAt: at,
    client: { id: 'c0000000000000000000000000000001', name: 'Shared Transmission', openUrl: null }, seeding: null, pack: null, ...extra });
    const DOWNLOADING = 'Remove.Delete.Downloading.2021.1080p.WEB-DL-GRP';
    const SEEDING = 'Remove.Delete.Seeding.2021.1080p.WEB-DL-GRP';
    const EPISODE = 'Remove.Delete.Episode.S01E03.1080p.WEB-DL-GRP';
    const rows = [
        row('11111111111111111111111111111111', movie, null, DOWNLOADING, 'downloading'),
        row('22222222222222222222222222222222', movie, null, SEEDING, 'seeding', { seeding: { id: '3'.repeat(32), state: 'waiting', reason: null, ratio: 0.4,
            goalRatio: 1, seedingSeconds: 3600, goalSeconds: null, waitingFor: ['ratio'], goalMetAt: null, libraryLinkPresent: true, releaseEnabled: true } }),
        row('44444444444444444444444444444444', show, episode, EPISODE, 'downloading')
    ];
    await page.route(/\/JellyfinMod\/Queue(\?|$)/, route => (route.request().method() === 'GET' ? route.fulfill({ json: { items: rows, totalRecordCount: rows.length,
        generatedAt: new Date().toISOString(), clientStatus: { reachable: true, checkedAt: new Date().toISOString(), reason: null }, importEnabled: true,
        seedReleaseEnabled: true, automation: null } }) : route.continue()));

    // 1. A download not yet imported.
    await openRemove(DOWNLOADING);
    const closed = await dialogState();
    record(label, 'Not imported: the client option reads "The client forgets the torrent." and is unticked; Delete the downloaded files is hidden',
        closed.clientText === 'The client forgets the torrent.' && closed.clientChecked === false && !closed.deleteShown, closed);
    await tickClient();
    const open = await dialogState();
    record(label, 'Ticking the client option shows Delete the downloaded files, ticked, with its description, indented 2.2em, its label under the client option\'s label',
        open.clientChecked === true && open.deleteShown && open.deleteChecked === true && open.deleteLabel?.trim() === 'Delete the downloaded files'
            && open.deleteText === 'What this torrent downloaded so far. Library files are never touched.' && Math.abs(open.indentEm - 2.2) < 0.01
            && Math.abs(open.deleteBoxLeft - open.clientLabelLeft) <= 6, open);
    record(label, 'The dialog\'s Remove is red', open.removeBackground === RED, open.removeBackground);
    if (!tv) {
        await page.locator('.jfmod-queueRemoveConfirm').hover();
        await page.waitForTimeout(300);
        const hovered = await dialogState();
        record(label, 'The dialog\'s Remove stays red under the pointer', hovered.removeBackground === RED, hovered.removeBackground);
        await page.mouse.move(2, 2);
    }
    await shot(page, 'dialog-downloading');
    await tickClient();
    const unticked = await dialogState();
    record(label, 'Unticking the client option hides the delete option again', unticked.clientChecked === false && !unticked.deleteShown, unticked);
    await back('.jfmod-queueRemoveDialog');

    // 2. A seeding (imported) row: never a delete option.
    await openRemove(SEEDING);
    await tickClient();
    const seeding = await dialogState();
    record(label, 'Seeding: the client option says the seeding copy stays; no delete option even with the client option ticked',
        seeding.clientText === SEEDING_TEXT && seeding.clientChecked === true && !seeding.deleteShown, seeding);
    await shot(page, 'dialog-seeding');
    await back('.jfmod-queueRemoveDialog');

    // 3. The missing episode's Cancel Download: Remove the Torrent.
    // A placeholder's own page where Jellyfin holds one, else the mod's page for an episode Jellyfin does not have.
    await page.evaluate(({ item, entry, season, number }) => {
        location.hash = item ? '#/details?id=' + item : `#/details?entryId=${entry}&season=${season}&episode=${number}`;
    }, { item: episode.jellyfinItemId, entry: show.id, season: episode.seasonNumber, number: episode.episodeNumber });
    const cancel = page.locator('.page:not(.hide) .jfmod-dlblock-cancel').first();
    await cancel.waitFor({ state: 'visible', timeout: 30000 });
    if (tv) {
        await cancel.focus();
        await page.keyboard.press('Enter');
    } else {
        await cancel.click();
    }
    const dialog = page.locator('#jfmodTorrentRemoval');
    await dialog.waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(500);
    const confirmState = async () => page.evaluate(() => {
        const dlg = document.querySelector('#jfmodTorrentRemoval');
        const text = dlg.querySelector('.text');
        const name = text?.querySelector('.jfmod-confirmName')?.textContent ?? null;
        const remove = dlg.querySelector('.btnOption[data-id="ok"]');
        return { title: dlg.querySelector('.formDialogHeaderTitle')?.textContent ?? null, text: text ? text.textContent.replace(name ?? '', '') : null, name,
            removeLabel: remove?.textContent ?? null, removeBackground: remove ? getComputedStyle(remove).backgroundColor : null };
    });
    const asked = await confirmState();
    record(label, 'Cancel Download asks Remove the Torrent with the new text and the release name',
        asked.title === 'Remove the Torrent' && asked.text === CONFIRM_TEXT && asked.name === EPISODE, asked);
    record(label, 'Remove the Torrent\'s Remove is red at rest', asked.removeLabel === 'Remove' && asked.removeBackground === RED, asked.removeBackground);
    if (!tv) {
        await dialog.locator('.btnOption[data-id="ok"]').hover();
        await page.waitForTimeout(300);
        const hovered = await confirmState();
        record(label, 'Remove the Torrent\'s Remove stays red under the pointer', hovered.removeBackground === RED, hovered.removeBackground);
        await page.mouse.move(2, 2);
    }
    await shot(page, 'confirm');
    // Back on the TV and the phone; on the computer Escape, or Cancel when the page keeps Escape for itself.
    await page.keyboard.press(tv ? 'Backspace' : 'Escape');
    if (!await dialog.waitFor({ state: 'hidden', timeout: 2000 }).then(() => true, () => false)) {
        await dialog.locator('.btnOption[data-id="cancel"]').click();
        await dialog.waitFor({ state: 'hidden', timeout: 10000 });
    }
    record(label, 'Back left every dialog and no queue removal left the browser', deletes.length === 0, deletes);
}

async function live() {
    const release = process.env.JELLYFINMOD_RD_RELEASE;
    if (release) {
        await openRemove(release);
        await tickClient();
        const state = await dialogState();
        record(label, 'Live: the downloading row offers Delete the downloaded files, ticked, once the client option is ticked',
            state.deleteShown && state.deleteChecked === true, state);
        await shot(page, 'live-dialog');
        const answered = page.waitForResponse(response => response.request().method() === 'DELETE' && /\/JellyfinMod\/Queue\//.test(response.url()));
        await page.locator('.jfmod-queueRemoveConfirm').click();
        const response = await answered;
        const body = JSON.parse(response.request().postData() ?? '{}');
        record(label, 'Live: Remove sends removeFromClient and deleteFiles, and the plugin answers 200',
            body.removeFromClient === true && body.deleteFiles === true && response.status() === 200, { body, status: response.status() });
        await until(async () => !(await page.locator('.jfmod-queue').filter({ hasText: release }).count()), { timeout: 20000, every: 500, label: 'the row to leave' });
        record(label, 'Live: the row left the queue', true);
    }
    const entryId = process.env.JELLYFINMOD_RD_PICK_ENTRY;
    const title = process.env.JELLYFINMOD_RD_PICK_TITLE;
    if (entryId && title) {
        await page.evaluate(id => {
            location.hash = '#/details?entryId=' + id;
        }, entryId);
        const opener = page.locator('.page:not(.hide) .mainDetailButtons .jfmod-getRelease').first();
        await opener.waitFor({ state: 'visible', timeout: 30000 });
        await opener.click();
        await page.waitForSelector('.jfmod-releaseDialog .jfmod-releaseList .jfmod-releaseItem', { timeout: 120000 });
        // The search answers indexer by indexer: wait for the wanted row.
        const id = await until(() => page.evaluate(raw => {
            const item = [...document.querySelectorAll('.jfmod-releaseDialog .jfmod-releaseItem')].find(node => node.textContent.includes(raw));
            return item?.querySelector('[data-jfmod-release-add]')?.getAttribute('data-jfmod-release-add') ?? null;
        }, title), { timeout: 150000, every: 1000, label: 'the picker row ' + title }).catch(() => null);
        if (!id) throw new Error('the picker lists no row named ' + title);
        await page.locator(`.jfmod-releaseDialog [data-jfmod-release-add="${id}"]`).click();
        const x = page.locator(`.jfmod-releaseDialog [data-jfmod-release-x="${id}"][title="Remove from Queue"]`);
        await x.waitFor({ state: 'visible', timeout: 90000 });
        // Let it download a little first, so there are files to delete (JELLYFINMOD_RD_PICK_WAIT seconds, default 10).
        await page.waitForTimeout(Number(process.env.JELLYFINMOD_RD_PICK_WAIT ?? 10) * 1000);
        await x.click();
        const dialog = page.locator('#jfmodTorrentRemoval');
        await dialog.waitFor({ state: 'visible', timeout: 10000 });
        await page.waitForTimeout(400);
        const remove = dialog.locator('.btnOption[data-id="ok"]');
        const text = await dialog.locator('.text').textContent();
        const background = await remove.evaluate(node => getComputedStyle(node).backgroundColor);
        record(label, 'Live: the picker\'s X asks Remove the Torrent with the new text, Remove red', text.startsWith(CONFIRM_TEXT) && background === RED,
            { background });
        await shot(page, 'live-confirm');
        const answered = page.waitForResponse(response => response.request().method() === 'DELETE' && /\/JellyfinMod\/Queue\//.test(response.url()));
        await remove.click();
        const response = await answered;
        const body = JSON.parse(response.request().postData() ?? '{}');
        record(label, 'Live: the X sends removeFromClient and deleteFiles, and the plugin answers 200',
            body.removeFromClient === true && body.deleteFiles === true && response.status() === 200, { body, status: response.status() });
    }
}

try {
    await signIn(page);
    await useTheme();
    if (mode === 'live') await live();
    else await matrix();
    record(label, 'No page errors', page.jfmodErrors.length === 0, page.jfmodErrors.slice(0, 3));
} catch (error) {
    notVerified(label, 'the remove dialogs', error);
    await shot(page, 'error');
}
await page.evaluate(() => localStorage.removeItem(ApiClient.getCurrentUserId() + '-appTheme')).catch(() => undefined);
if (results.some(result => result.verdict !== 'PASS')) process.exitCode = 1;
saveResults(label, browser.version());
await context.close();
await browser.close();
/* eslint-enable no-restricted-globals */
