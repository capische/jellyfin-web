/* eslint-disable no-restricted-globals -- a Node acceptance runner, not shipped code */
/* global document, getComputedStyle, localStorage, location, ApiClient */
// Removing a download deletes its files only when the person chose that (the removal dialog, D118–D124, which replaced the
// 2026-10-26 checkboxes), in a real browser against a local environment, signed in as oleksii with an empty password.
//
// JELLYFINMOD_RD_MODE=matrix (default): INTERCEPTED ANSWERS, NOTHING IS REMOVED. The queue (a downloading movie row that may delete,
// one that may not, a seeding row and a downloading row for a missing episode) is answered by this runner, and every DELETE of a queue row
// is stopped before it leaves the browser (and counted: the run fails if there is one). Checks each dialog's outcomes and their
// words: the one that deletes files named and red at rest and under the pointer, never offered where the row may not delete or
// on a seeding row; and the missing episode's Cancel Download, the same dialog with the release name. Every dialog is left by
// the safe choice or Back. Safe on alpha and beta.
//
// JELLYFINMOD_RD_MODE=live: REMOVES FOR REAL, on a pool environment other than alpha and beta (proven by local-env.mjs). With
// JELLYFINMOD_RD_RELEASE=<release title of a downloading queue row> it removes that row from the Queue page with Delete the
// Download; with JELLYFINMOD_RD_PICK_ENTRY=<entry id> and JELLYFINMOD_RD_PICK_TITLE=<raw title> it adds that release in the picker
// and removes it again with the added row's X. Both check the request sent (removeFromClient and deleteFiles true) and its 200;
// the files and the client are checked by the caller.
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
const HOVER_RED = 'rgb(216, 67, 67)';
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

const DIALOG = '.jfmod-removeDialog';

/** Opens a queue row's menu and picks Remove: the desktop popover, or the action sheet by Enter (TV) or tap (phone). */
async function openRemove(releaseTitle) {
    await page.evaluate(() => {
        location.hash = '#/catalog/queue';
    });
    if (tv) {
        const row = page.locator('.qrow').filter({ hasText: releaseTitle }).first();
        await row.waitFor({ state: 'visible', timeout: 30000 });
        await row.focus();
        await page.keyboard.press('Enter');
    } else {
        const row = page.locator(layout === 'desktop' ? '.qrow' : '.qrow').filter({ hasText: releaseTitle }).first();
        await row.waitFor({ state: 'visible', timeout: 30000 });
        await row.locator('.ib[aria-label^="Actions"]').click();
    }
    const item = page.locator('[data-id="remove"]:visible').first();
    await item.waitFor({ state: 'visible', timeout: 10000 });
    if (tv) {
        await item.focus();
        await page.keyboard.press('Enter');
    } else {
        await item.click();
    }
    await page.locator(DIALOG).waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(500);
}

const dialogState = selector => page.evaluate(sel => {
    const dialog = document.querySelector(sel);
    const words = which => [...dialog.querySelectorAll(which)].map(node => node.textContent);
    return {
        title: dialog.querySelector('[data-ds-dialog] .dlghead h3')?.textContent ?? null,
        question: dialog.querySelector('[data-ds-question]')?.textContent ?? null,
        facts: words('[data-ds-fact]'),
        notes: words('[data-ds-note]'),
        release: dialog.querySelector('.rname')?.textContent ?? null,
        choices: [...dialog.querySelectorAll('[data-ds-dialog] .btn[data-choice]')].map(button => ({ id: button.getAttribute('data-choice'), name: button.textContent,
            red: button.matches('.destroy'), background: getComputedStyle(button).backgroundColor, help: button.nextElementSibling?.matches('.help') ? button.nextElementSibling.textContent : null })),
        focused: document.activeElement?.getAttribute?.('data-choice') ?? null
    };
}, selector);
const choice = (state, id) => state.choices.find(item => item.id === id);

async function back() {
    if (tv) await page.keyboard.press('Escape');
    else await page.locator(`${DIALOG} [data-choice="cancel"]`).click();
    await page.locator(DIALOG).waitFor({ state: 'detached', timeout: 10000 });
    await page.waitForTimeout(400);
}

async function matrix() {
    await page.route(/\/JellyfinMod\/Queue\/[0-9a-f]+/, route => (route.request().method() === 'DELETE' ? route.abort() : route.continue()));
    // 0. The environment's own seeding row, when it has one (alpha and beta keep an imported download seeding): no delete option.
    const real = (await api(page, 'GET', 'JellyfinMod/Queue')).body?.items?.find(item => item.state === 'seeding');
    if (real) {
        await openRemove(real.releaseTitle);
        const own = await dialogState(DIALOG);
        record(label, 'The environment\'s own seeding row: Stop Seeding, the seeding copy stays, no delete option',
            own.title === 'Stop Seeding' && !choice(own, 'delete'), { release: real.releaseTitle, ...own });
        await shot(page, 'dialog-real-seeding');
        await back();
    }
    const entries = (await api(page, 'GET', 'JellyfinMod/Entries?limit=50')).body;
    const items = entries?.items ?? entries;
    const movie = items.find(item => item.mediaType === 'movie' && item.state === 'onDisk');
    const showName = process.env.JELLYFINMOD_RD_SHOW ?? 'Peep Show';
    const show = items.find(item => item.title === showName);
    const detail = (await api(page, 'GET', `JellyfinMod/Entries/${show.id}`)).body;
    const episode = detail.episodes.find(item => item.state !== 'onDisk' && item.seasonNumber > 0);
    if (!movie || !episode) throw new Error(`no movie on disk or no missing ${showName} episode`);
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
    const KEPT = 'Remove.Delete.Kept.2021.1080p.WEB-DL-GRP';
    const EPISODE = 'Remove.Delete.Episode.S01E03.1080p.WEB-DL-GRP';
    const rows = [
        row('11111111111111111111111111111111', movie, null, DOWNLOADING, 'downloading', { canDeleteFiles: true }),
        row('55555555555555555555555555555555', movie, null, KEPT, 'downloading', { canDeleteFiles: false }),
        row('22222222222222222222222222222222', movie, null, SEEDING, 'seeding', { seeding: { id: '3'.repeat(32), state: 'waiting', reason: null, ratio: 0.4,
            goalRatio: 1, seedingSeconds: 3600, goalSeconds: null, waitingFor: ['ratio'], goalMetAt: null, libraryLinkPresent: true, releaseEnabled: true } }),
        row('44444444444444444444444444444444', show, episode, EPISODE, 'downloading', { canDeleteFiles: true })
    ];
    await page.route(/\/JellyfinMod\/Queue(\?|$)/, route => (route.request().method() === 'GET' ? route.fulfill({ json: { items: rows, totalRecordCount: rows.length,
        generatedAt: new Date().toISOString(), clientStatus: { reachable: true, checkedAt: new Date().toISOString(), reason: null }, importEnabled: true,
        seedReleaseEnabled: true, automation: null } }) : route.continue()));

    // 1. A download not yet imported, whose files may be deleted.
    await openRemove(DOWNLOADING);
    const open = await dialogState(DIALOG);
    const del = choice(open, 'delete');
    record(label, 'Under way and deletable: Cancel Download, its one red outcome Delete the Download, which says the client deletes what it downloaded, the safe Keep Downloading focused',
        open.title === 'Cancel Download' && open.choices.map(item => item.id).join() === 'delete,cancel' && del?.red && del.name === 'Delete the Download'
            && /removes the torrent and deletes the .*downloaded so far\./.test(del.help ?? '') && choice(open, 'cancel')?.name === 'Keep Downloading' && open.focused === 'cancel', open);
    record(label, 'Delete the Download is red', del?.background === RED, del?.background);
    if (!tv) {
        await page.locator(`${DIALOG} [data-choice="delete"]`).hover();
        await page.waitForTimeout(400);
        const hovered = choice(await dialogState(DIALOG), 'delete');
        record(label, 'Delete the Download stays red under the pointer (the lighter destroy red)', hovered?.background === HOVER_RED, hovered?.background);
        await page.mouse.move(2, 2);
    }
    await shot(page, 'dialog-downloading');
    await back();

    // 2. A download whose files may not be deleted: no outcome says it deletes, and the dialog says no file is deleted.
    await openRemove(KEPT);
    const kept = await dialogState(DIALOG);
    record(label, 'Not deletable: Stop the Download instead, "No file is deleted", no delete outcome',
        kept.title === 'Cancel Download' && !choice(kept, 'delete') && choice(kept, 'keep')?.name === 'Stop the Download' && /No file is deleted\./.test(choice(kept, 'keep')?.help ?? ''), kept);
    await shot(page, 'dialog-kept');
    await back();

    // 3. A seeding (imported) row: never a delete option.
    await openRemove(SEEDING);
    const seeding = await dialogState(DIALOG);
    record(label, 'Seeding: Stop Seeding, no delete option', seeding.title === 'Stop Seeding' && !choice(seeding, 'delete') && choice(seeding, 'keep')?.red === true, seeding);
    await shot(page, 'dialog-seeding');
    await back();

    // 4. The missing episode's Cancel Download: the same dialog, naming its release.
    // A placeholder's own page where Jellyfin holds one, else the mod's page for an episode Jellyfin does not have.
    await page.evaluate(({ item, entry, season, number }) => {
        location.hash = item ? '#/details?id=' + item : `#/details?entryId=${entry}&season=${season}&episode=${number}`;
    }, { item: episode.jellyfinItemId, entry: show.id, season: episode.seasonNumber, number: episode.episodeNumber });
    const cancel = page.locator('.page:not(.hide) .dlb .act .btn:not(.main):not(.destroy)').filter({ hasText: 'Cancel Download' }).first();
    await cancel.waitFor({ state: 'visible', timeout: 30000 });
    if (tv) {
        await cancel.focus();
        await page.keyboard.press('Enter');
    } else {
        await cancel.click();
    }
    await page.locator(DIALOG).waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(500);
    const asked = await dialogState(DIALOG);
    record(label, 'The episode\'s Cancel Download asks the removal dialog, with the release name and Delete the Download in red',
        asked.title === 'Cancel Download' && asked.release === EPISODE && choice(asked, 'delete')?.background === RED, asked);
    await shot(page, 'confirm');
    await back();
    record(label, 'Every dialog closed and no queue removal left the browser', deletes.length === 0, deletes);
}

async function live() {
    const release = process.env.JELLYFINMOD_RD_RELEASE;
    if (release) {
        await openRemove(release);
        const state = await dialogState(DIALOG);
        record(label, 'Live: the downloading row offers Delete the Download', choice(state, 'delete')?.red === true, state);
        await shot(page, 'live-dialog');
        const answered = page.waitForResponse(response => response.request().method() === 'DELETE' && /\/JellyfinMod\/Queue\//.test(response.url()));
        await page.locator(`${DIALOG} [data-choice="delete"]`).click();
        const response = await answered;
        const body = JSON.parse(response.request().postData() ?? '{}');
        record(label, 'Live: Delete the Download sends removeFromClient and deleteFiles, and the plugin answers 200',
            body.removeFromClient === true && body.deleteFiles === true && response.status() === 200, { body, status: response.status() });
        await until(async () => !(await page.locator('.queue').filter({ hasText: release }).count()), { timeout: 20000, every: 500, label: 'the row to leave' });
        record(label, 'Live: the row left the queue', true);
    }
    const entryId = process.env.JELLYFINMOD_RD_PICK_ENTRY;
    const title = process.env.JELLYFINMOD_RD_PICK_TITLE;
    if (entryId && title) {
        await page.evaluate(id => {
            location.hash = '#/details?entryId=' + id;
        }, entryId);
        const opener = page.locator('.page:not(.hide) .jfmod-dsTitleHost .actbar [data-ds-command~=jfmod-getRelease]').first();
        await opener.waitFor({ state: 'visible', timeout: 30000 });
        await opener.click();
        await page.waitForSelector('.pickerDialog .rels .rel', { timeout: 120000 });
        // The search answers indexer by indexer: wait for the wanted row.
        const id = await until(() => page.evaluate(raw => {
            const item = [...document.querySelectorAll('.pickerDialog .rel')].find(node => node.textContent.includes(raw));
            return item?.querySelector('[data-jfmod-release-add]')?.getAttribute('data-jfmod-release-add') ?? null;
        }, title), { timeout: 150000, every: 1000, label: 'the picker row ' + title }).catch(() => null);
        if (!id) throw new Error('the picker lists no row named ' + title);
        await page.locator(`.pickerDialog [data-jfmod-release-add="${id}"]`).click();
        const x = page.locator(`.pickerDialog [data-jfmod-release-x="${id}"][title="Remove from Queue"]`);
        await x.waitFor({ state: 'visible', timeout: 90000 });
        // Let it download a little first, so there are files to delete (JELLYFINMOD_RD_PICK_WAIT seconds, default 10).
        await page.waitForTimeout(Number(process.env.JELLYFINMOD_RD_PICK_WAIT ?? 10) * 1000);
        await x.click();
        await page.locator(DIALOG).waitFor({ state: 'visible', timeout: 10000 });
        await page.waitForTimeout(400);
        const remove = page.locator(`${DIALOG} [data-choice="delete"]`);
        const asked = await dialogState(DIALOG);
        record(label, 'Live: the picker\'s X asks the removal dialog, Delete the Download red', choice(asked, 'delete')?.background === RED && asked.release === title, asked);
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
