/* eslint-disable compat/compat, no-restricted-globals, sonarjs/cognitive-complexity, @stylistic/max-statements-per-line, no-empty-function -- a Node acceptance runner, not shipped code */
/* global window, document, ApiClient, location, indexedDB */
// TM2 tm2.u1: Undo right after the search card's + must not bring the title back. Presses + and then Undo in a real browser against
// a running Jellyfin and the live TMDb, waits past the plugin's reconciliation, and asserts no entry and no library item of the
// title remains. Then a real file of a title that was just undone must still be discovered.
//
//   JELLYFINMOD_TEST_URL=http://127.0.0.1:<port>/ [JELLYFINMOD_BROWSER=chromium|chrome] [JELLYFINMOD_WEB_PATH=/web/]
//   [JELLYFINMOD_UNDO_ROUNDS=1]        how many times to go through the titles
//   [JELLYFINMOD_UNDO_DELAYS=1500,1750,2000,2250,2500]   ms between the Undo line appearing and pressing Undo, used in turn
//   [JELLYFINMOD_UNDO_SETTLE=9000]     ms to wait after Undo before looking
//   [JELLYFINMOD_UNDO_KINDS=movie,series]   which titles to use
//   [JELLYFINMOD_UNDO_TITLES=Arrival,Chernobyl]   only these titles, where the others are the environment's own media
//   [JELLYFINMOD_UNDO_LOG=<host path of the environment's Jellyfin log folder>]   count the delays from the moment Jellyfin made the
//                                      title's item, so the removal lands around the plugin's stamp of the new stub, the race
//   [JELLYFINMOD_UNDO_MEDIA=<host path of the /test-media folder>]   runs the two checks below, which need the disk:
//     no entry from nothing, every time: a title with an item in the library, its stub gone and no entry (main-stubs only; main-items
//     writes no stub file). The race itself needs Undo to land inside Jellyfin's metadata refresh, about 1 in 15.
//     a real file of a title just undone is still discovered: with
//   [JELLYFINMOD_UNDO_SOURCE=<a small video file>]   the file to copy for it
//   [JELLYFINMOD_UNDO_REAL=1]   with both: real media whose folder vanishes with the library's folder still there (a disk away, its mount
//                                  point empty), alone and in two overlapping libraries, stays in the library and returns with its file
//
// Every title it adds it removes again.
import { closeSync, copyFileSync, existsSync, fstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium } from 'playwright';

const origin = new URL(process.env.JELLYFINMOD_TEST_URL ?? (() => { throw new Error('JELLYFINMOD_TEST_URL is required'); })());
// The local pool without alpha and beta (the user's own environments, envs/pool.list); never production.
if (!['9096', '10096', '11096', '12096'].includes(origin.port) || origin.hostname !== '127.0.0.1') {
    throw new Error('Runs on the local pool environments bravo, charlie, delta and echo only');
}
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
const WEB_PATH = process.env.JELLYFINMOD_WEB_PATH ?? '/web/';
const ROUNDS = Number(process.env.JELLYFINMOD_UNDO_ROUNDS ?? 1);
const DELAYS = (process.env.JELLYFINMOD_UNDO_DELAYS ?? '1500,1750,2000,2250,2500').split(',').map(Number);
const SETTLE = Number(process.env.JELLYFINMOD_UNDO_SETTLE ?? 9000);
const MEDIA = process.env.JELLYFINMOD_UNDO_MEDIA ?? null;
const SOURCE = process.env.JELLYFINMOD_UNDO_SOURCE ?? null;
const LOG_FOLDER = process.env.JELLYFINMOD_UNDO_LOG ?? null;
const KINDS = process.env.JELLYFINMOD_UNDO_KINDS?.split(',') ?? null;
const base = () => new URL(WEB_PATH, origin).href;
const ALL_TITLES = [
    { query: 'arrival', key: 'movie:329865', type: 'movie', id: 329865, title: 'Arrival' },
    { query: 'chernobyl', key: 'series:87108', type: 'series', id: 87108, title: 'Chernobyl' },
    { query: 'fight club', key: 'movie:550', type: 'movie', id: 550, title: 'Fight Club' },
    { query: 'band of brothers', key: 'series:4613', type: 'series', id: 4613, title: 'Band of Brothers' },
    { query: 'interstellar', key: 'movie:157336', type: 'movie', id: 157336, title: 'Interstellar' },
    { query: 'the night of', key: 'series:66276', type: 'series', id: 66276, title: 'The Night Of' },
    { query: 'inception', key: 'movie:27205', type: 'movie', id: 27205, title: 'Inception' },
    { query: 'parasite', key: 'movie:496243', type: 'movie', id: 496243, title: 'Parasite' },
    ...[['moon', 17431, 'Moon'], ['primer', 14337, 'Primer'], ['coherence', 220289, 'Coherence'], ['snowpiercer', 110415, 'Snowpiercer'],
        ['ex machina', 264660, 'Ex Machina'], ['whiplash', 244786, 'Whiplash'], ['nightcrawler', 242582, 'Nightcrawler'], ['drive', 64690, 'Drive'],
        ['locke', 210479, 'Locke'], ['sicario', 273481, 'Sicario'], ['prisoners', 146233, 'Prisoners']]
        .map(([query, id, title]) => ({ query, key: `movie:${id}`, type: 'movie', id, title }))
];
const ONLY = process.env.JELLYFINMOD_UNDO_TITLES?.split(',');
const TITLES = ALL_TITLES.filter(title => (!KINDS || KINDS.includes(title.type)) && (!ONLY || ONLY.includes(title.title)));

const REAL = process.env.JELLYFINMOD_UNDO_REAL === '1';
const REAL_MEDIA = !REAL ? [] : [
    { key: 'real:movie', type: 'movie', id: 374720, title: 'Dunkirk', area: 'movies', folder: 'Dunkirk (2017) [tmdbid-374720]', file: 'Dunkirk (2017) [tmdbid-374720].mkv' },
    { key: 'real:series', type: 'series', id: 95396, title: 'Severance', area: 'tv', folder: 'Severance (2022) [tmdbid-95396]', file: 'Season 01/Severance (2022) - S01E01 - Good News About Hell.mkv' },
    // No TMDB id: reconciliation leaves it unmatched, with no entry, the case the review named.
    { key: 'real:unmatched', type: 'series', id: null, title: 'Zzqx Nobody Series', area: 'tv', folder: 'Zzqx Nobody Series 7741', file: 'Season 01/Zzqx Nobody Series 7741 - S01E01.mkv' }
];

const results = [];
const record = (check, verdict, detail = '') => {
    results.push({ check, verdict });
    console.log(`${verdict ? 'PASS' : 'FAIL'} [${tier}] ${check}${detail ? ' — ' + String(detail).slice(0, 500) : ''}`);
};

async function signIn(page) {
    await page.goto(base(), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.ApiClient, undefined, { timeout: 30000 });
    await page.waitForFunction(() => {
        try { return !!ApiClient.getCurrentUserId() || /login|selectuser|selectserver/.test(location.hash); } catch { return false; }
    }, undefined, { timeout: 30000 });
    if (await page.evaluate(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } })) return;
    const field = page.locator('#txtManualName');
    if (!await field.isVisible().catch(() => false)) {
        const chooser = page.locator('.btnManual').first();
        await chooser.waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
        if (await chooser.count()) await chooser.evaluate(node => node.click());
        await field.waitFor({ state: 'visible', timeout: 15000 });
    }
    await page.waitForTimeout(1000);
    await field.fill('oleksii');
    await page.locator('#txtManualPassword').fill('');
    await page.locator('button:visible').filter({ hasText: 'Sign In' }).first().click();
    await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } }, undefined, { timeout: 30000 });
    await page.waitForTimeout(1500);
}

const apiJson = (page, path, query) => page.evaluate(([p, q]) => ApiClient.getJSON(ApiClient.getUrl(p, q)), [path, query]);
const apiPost = (page, path) => page.evaluate(p => ApiClient.ajax({ type: 'POST', url: ApiClient.getUrl(p) }).then(() => true), path);
const apiDelete = (page, path) => page.evaluate(p => ApiClient.ajax({ type: 'DELETE', url: ApiClient.getUrl(p) }).then(() => true), path);

const entriesOf = async (page, { type, id }) => (await apiJson(page, 'JellyfinMod/Entries')).items.filter(entry => entry.mediaType === type && entry.tmdbId === id);

/** The library's items of the title, as a viewer's own queries find them. */
const itemsOf = async (page, { type, id, title }) => {
    const userId = await page.evaluate(() => ApiClient.getCurrentUserId());
    const answer = await apiJson(page, `Users/${userId}/Items`, { IncludeItemTypes: type === 'movie' ? 'Movie' : 'Series', Recursive: true, SearchTerm: title, Fields: 'ProviderIds,Path' });
    return answer.Items.filter(item => item.ProviderIds?.Tmdb === String(id));
};

/** The titles proven absent when this run began: the only ones it may ever remove anything of. */
const ownTitles = new Set();

/** Refuses a title already in the environment, or it could not tell its own fixtures from media someone has. */
async function requireAbsent(page, title) {
    const entries = await entriesOf(page, title);
    const items = await itemsOf(page, title);
    const area = `${MEDIA ?? ''}/${title.type === 'movie' ? 'movies' : 'tv'}`;
    const folder = MEDIA && readdirSync(area).find(name => name.includes(`[tmdbid-${title.id}]`));
    if (entries.length || items.length || folder) {
        throw new Error(`Refusing to run: ${title.title} is already here (${entries.length} entries, ${items.length} items, folder ${folder ?? 'none'})`);
    }
    ownTitles.add(title.key);
}

/**
 * Removes what this run made of a title it proved absent, and only that: its entries, and items whose path carries the title's own
 * TMDB tag under /test-media. Anything else is left and the check reports it.
 */
async function clean(page, title) {
    if (!ownTitles.has(title.key)) throw new Error(`${title.title} was not proven absent; nothing of it may be removed`);
    for (const entry of await entriesOf(page, title)) await apiDelete(page, `JellyfinMod/Entries/${entry.id}`).catch(() => {});
    const left = await entriesOf(page, title);
    // What a failed attempt leaves: an item of no file, and an entry bound to it, which is refused until the item has gone.
    for (const item of await itemsOf(page, title)) {
        if (item.Path?.startsWith('/test-media/') && item.Path.includes(`[tmdbid-${title.id}]`)) await apiDelete(page, `Items/${item.Id}`).catch(() => {});
    }
    for (let wait = 0; wait < 10 && left.length && (await entriesOf(page, title)).length; wait++) {
        await page.waitForTimeout(1000);
        for (const entry of await entriesOf(page, title)) await apiDelete(page, `JellyfinMod/Entries/${entry.id}`).catch(() => {});
    }
}

const fstatFile = path => {
    const fd = openSync(path, 'r');
    try { return fstatSync(fd).size; } finally { closeSync(fd); }
};
const currentLog = () => `${LOG_FOLDER}/${readdirSync(LOG_FOLDER).filter(name => name.startsWith('log_')).sort().at(-1)}`;

/** Waits for a line about this title in Jellyfin's log; false if it never comes. */
async function logLine(page, title, path, from, pattern) {
    const fd = openSync(path, 'r');
    try {
        let offset = from;
        let text = '';
        for (let wait = 0; wait < 300; wait++) {
            const size = fstatSync(fd).size;
            if (size > offset) {
                const buffer = Buffer.alloc(size - offset);
                readSync(fd, buffer, 0, buffer.length, offset);
                offset = size;
                text += buffer.toString('utf8');
                if (text.split('\n').some(line => pattern.test(line) && line.includes(title.title))) return true;
            }
            await page.waitForTimeout(25);
        }
        return false;
    } finally {
        closeSync(fd);
    }
}

async function addThenUndo(page, title, delay) {
    const logPath = LOG_FOLDER && currentLog();
    const logStart = LOG_FOLDER ? fstatFile(logPath) : 0;
    const undo = await pressAdd(page, title);
    if (LOG_FOLDER && !(await logLine(page, title, logPath, logStart, /Process new item/))) console.log(`note: no new item seen for ${title.title}`);
    // With the log: that many ms after Jellyfin made the item, for the plugin stamps a new stub 2 s after it (PlaceholderItemListener).
    await page.waitForTimeout(delay);
    await undo.click();
    await page.waitForFunction(() => !document.querySelector('[data-ds-notice=undo]'), undefined, { timeout: 30000 });
}

/** Opens the search and presses the card's +; returns its Undo button. */
async function pressAdd(page, title) {
    await page.goto(base() + `#/search?query=${encodeURIComponent(title.query)}`, { waitUntil: 'domcontentloaded' });
    // A title this check removed through the API is still a library card for a minute in the page's own stored queries, as upstream
    // keeps them (utils/query/queryClient): a fresh page with none each time.
    await page.evaluate(() => { indexedDB.deleteDatabase('keyval-store'); });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } }, undefined, { timeout: 30000 });
    await page.waitForFunction(() => document.querySelector('.grid.searchgrid')?.getAttribute('aria-busy') === 'false'
        && document.querySelectorAll('.cell[data-jfmod-key]').length > 0, undefined, { timeout: 45000 });
    const cell = page.locator(`.cell[data-jfmod-key="${title.key}"]`);
    await cell.waitFor({ state: 'attached', timeout: 15000 });
    await cell.scrollIntoViewIfNeeded();
    await cell.hover();
    await page.waitForTimeout(200);
    await cell.locator('[data-jfmod-add]').click();
    const undo = page.locator('[data-ds-notice=undo] button');
    await undo.waitFor({ state: 'visible', timeout: 45000 });
    return undo;
}

/**
 * A title that stays in the catalog keeps its entry when its stub goes (a user's delete): only a title with no entry is dropped.
 */
async function checkEntryStays(page, title) {
    const area = `${MEDIA}/movies`;
    await pressAdd(page, title);
    let items = [];
    for (let wait = 0; wait < 30 && !items.length; wait++) {
        await page.waitForTimeout(1000);
        items = await itemsOf(page, title);
    }
    await page.waitForTimeout(4000);
    const folder = readdirSync(area).find(name => name.includes(`[tmdbid-${title.id}]`));
    if (!folder || !items.length) {
        console.log(`note: ${title.title} has no stub on disk here, the entry-stays check does not apply`);
        await clean(page, title);
        return;
    }
    const before = (await entriesOf(page, title)).map(entry => entry.id).join();
    rmSync(`${area}/${folder}`, { recursive: true, force: true });
    const userId = await page.evaluate(() => ApiClient.getCurrentUserId());
    await page.evaluate(async ([user, id]) => {
        const item = await ApiClient.getItem(user, id);
        item.Name += ' again';
        return ApiClient.updateItem(item);
    }, [userId, items[0].Id]).catch(() => {});
    await page.waitForTimeout(SETTLE);
    const after = (await entriesOf(page, title)).map(entry => entry.id).join();
    record(`${title.title}, in the catalog with its stub gone: the entry stays`, before.length > 0 && before === after, `${before} and ${after}`);
    await clean(page, title);
}

/**
 * A title's item with its stub file gone and no entry, not removed by Undo, then saved with changed metadata as a refresh does. No entry
 * may come from it. With no record of a removal the plugin deletes nothing, so this no longer proves the drop: the race check does.
 */
async function checkLeftBehind(page, title) {
    const area = `${MEDIA}/${title.type === 'movie' ? 'movies' : 'tv'}`;
    const undo = await pressAdd(page, title);
    let items = [];
    for (let wait = 0; wait < 30 && !items.length; wait++) {
        await page.waitForTimeout(1000);
        items = await itemsOf(page, title);
    }
    await page.waitForTimeout(4000);
    const folder = readdirSync(area).find(name => name.includes(`[tmdbid-${title.id}]`));
    if (!folder || !items.length) {
        console.log(`note: ${title.title} has no stub on disk or no item here: ${folder ?? 'no folder'}, ${items.length} items`);
        await undo.click();
        await page.waitForFunction(() => !document.querySelector('[data-ds-notice=undo]'), undefined, { timeout: 30000 });
        return false;
    }
    rmSync(`${area}/${folder}`, { recursive: true, force: true });
    await undo.click();
    await page.waitForFunction(() => !document.querySelector('[data-ds-notice=undo]'), undefined, { timeout: 30000 });
    await page.waitForTimeout(1000);
    const left = await itemsOf(page, title);
    record(`${title.title}, left behind: the item is there, its stub gone, no entry`, left.length === 1 && !(await entriesOf(page, title)).length, `${left.length} items`);
    if (!left.length) return true;
    const userId = await page.evaluate(() => ApiClient.getCurrentUserId());
    const saved = await page.evaluate(async ([user, id]) => {
        const item = await ApiClient.getItem(user, id);
        item.Name += ' again';
        return ApiClient.updateItem(item).then(() => true);
    }, [userId, left[0].Id]).catch(error => String(error));
    console.log(`note: ${title.title} saved with changed metadata: ${saved}`);
    await page.waitForTimeout(SETTLE);
    const entries = await entriesOf(page, title);
    const items2 = await itemsOf(page, title);
    record(`${title.title}, left behind: no entry comes back`, entries.length === 0, entries.map(entry => `${entry.id} state ${entry.state}`).join(', '));
    // No Undo removed this stub, so the plugin has no record of it and deletes nothing: the item waits for Jellyfin's next scan (tm2.u2).
    record(`${title.title}, left behind: the item stays for Jellyfin's scan`, items2.length === 1, items2.map(item => `${item.Id} ${item.Path ?? ''}`).join(', '));
    await clean(page, title);
    return true;
}

const realPath = fixture => `${MEDIA}/${fixture.area}/${fixture.folder}`;
const awayPath = fixture => `${MEDIA}/holding/tm2-away-${fixture.key.replace(':', '-')}`;
const itemById = (page, id) => page.evaluate(async itemId => {
    try {
        const item = await ApiClient.getItem(ApiClient.getCurrentUserId(), itemId);
        return { id: item.Id, name: item.Name };
    } catch {
        return null;
    }
}, id);
const findReal = async (page, fixture) => {
    const userId = await page.evaluate(() => ApiClient.getCurrentUserId());
    const answer = await apiJson(page, `Users/${userId}/Items`, { IncludeItemTypes: fixture.type === 'movie' ? 'Movie' : 'Series', Recursive: true, Fields: 'Path,ProviderIds', GroupItems: false });
    return answer.Items.filter(item => item.Path?.startsWith(`/test-media/${fixture.area}/${fixture.folder}`));
};
const saveChanged = (page, id, suffix) => page.evaluate(async ([itemId, added]) => {
    const item = await ApiClient.getItem(ApiClient.getCurrentUserId(), itemId);
    item.Name += added;
    return ApiClient.updateItem(item).then(() => true);
}, [id, suffix]).catch(error => String(error));

/** The review's case: real media whose folder vanishes while the library's folder is still there, as a disk away leaves its mount point. */
async function checkRealMediaStays(page, label) {
    for (const fixture of REAL_MEDIA) {
        let items = [];
        for (let wait = 0; wait < 40 && !items.length; wait++) {
            await page.waitForTimeout(3000);
            items = await findReal(page, fixture);
        }
        if (!items.length) { record(`${label}: ${fixture.title} became a library item`, false); continue; }
        const entries = async () => (fixture.id ? (await apiJson(page, 'JellyfinMod/Entries')).items.filter(entry => entry.mediaType === fixture.type && entry.tmdbId === fixture.id) : []);
        let before = await entries();
        for (let wait = 0; wait < 20 && fixture.id && !before.some(entry => entry.state === 'onDisk'); wait++) {
            await page.waitForTimeout(2000);
            before = await entries();
        }
        const away = awayPath(fixture);
        renameSync(realPath(fixture), away);
        const saved = await saveChanged(page, items[0].Id, ' x');
        await page.waitForTimeout(SETTLE + 4000);
        const stays = await itemById(page, items[0].Id);
        const after = await entries();
        record(`${label}: ${fixture.title} with its folder gone stays a library item`, !!stays, `${stays?.name ?? 'deleted'}; saved ${saved}`);
        record(`${label}: ${fixture.title} with its folder gone keeps its entries`, before.map(entry => entry.id).sort().join() === after.map(entry => entry.id).sort().join(), `${before.length} and ${after.length}`);
        record(`${label}: ${fixture.title}'s file is untouched`, existsSync(`${away}/${fixture.file}`));
        renameSync(away, realPath(fixture));
        await apiPost(page, 'Library/Refresh');
        let back = [];
        for (let wait = 0; wait < 40 && (!back.length || (fixture.id && !(await entries()).some(entry => entry.state === 'onDisk'))); wait++) {
            await page.waitForTimeout(3000);
            back = await findReal(page, fixture);
        }
        record(`${label}: ${fixture.title} returns with its file`, back.length > 0 && (!fixture.id || (await entries()).some(entry => entry.state === 'onDisk')), `${back.length} items; ${(await entries()).map(entry => entry.state).join(', ')}`);
    }
}

/** Puts the fixtures on disk, runs the check alone and then with each kind's folder in a second library too, and takes them away again. */
async function checkRealMedia(page) {
    const overlap = [['TM2 Overlap Movies', 'movies', '/test-media/movies'], ['TM2 Overlap Shows', 'tvshows', '/test-media/tv']];
    const before = (await apiJson(page, 'Library/VirtualFolders')).map(folder => folder.Name);
    if (overlap.some(([name]) => before.includes(name)) || REAL_MEDIA.some(fixture => existsSync(realPath(fixture)) || existsSync(awayPath(fixture)))) throw new Error('Refusing to run: the real media fixtures are already here');
    try {
        for (const fixture of REAL_MEDIA) {
            mkdirSync(dirname(`${realPath(fixture)}/${fixture.file}`), { recursive: true });
            copyFileSync(SOURCE, `${realPath(fixture)}/${fixture.file}`);
        }
        await apiPost(page, 'Library/Refresh');
        await checkRealMediaStays(page, 'alone');
        for (const [name, type, path] of overlap) {
            await page.evaluate(([n, t, p]) => ApiClient.ajax({ type: 'POST', url: ApiClient.getUrl('Library/VirtualFolders', { name: n, collectionType: t, paths: p, refreshLibrary: true }),
                data: JSON.stringify({ LibraryOptions: { PathInfos: [{ Path: p }] } }), contentType: 'application/json' }), [name, type, path]);
        }
        await page.waitForTimeout(15000);
        const series = await findReal(page, REAL_MEDIA[1]);
        const shared = (await apiJson(page, 'Library/VirtualFolders')).find(folder => folder.Name === 'TM2 Overlap Shows');
        let inBoth = false;
        for (let wait = 0; wait < 20 && !inBoth; wait++) {
            await page.waitForTimeout(3000);
            const answer = await apiJson(page, `Users/${await page.evaluate(() => ApiClient.getCurrentUserId())}/Items`, { ParentId: shared?.ItemId, IncludeItemTypes: 'Series', Recursive: true });
            inBoth = answer.Items.some(item => item.Id === series[0]?.Id);
        }
        record('overlap: the series sits in both libraries', inBoth);
        await checkRealMediaStays(page, 'overlapping');
    } finally {
        for (const fixture of REAL_MEDIA) {
            if (existsSync(awayPath(fixture))) renameSync(awayPath(fixture), realPath(fixture));
            const items = await findReal(page, fixture);
            rmSync(realPath(fixture), { recursive: true, force: true });
            for (const item of items) await apiDelete(page, `Items/${item.Id}`).catch(() => {});
        }
        for (const [name] of overlap) await apiDelete(page, `Library/VirtualFolders?name=${encodeURIComponent(name)}&refreshLibrary=true`).catch(error => console.log(`note: removing ${name}: ${error}`));
        await page.waitForTimeout(3000);
        for (const fixture of REAL_MEDIA.filter(item => item.id)) {
            ownTitles.add(fixture.key);
            for (let wait = 0; wait < 10; wait++) {
                const entries = (await apiJson(page, 'JellyfinMod/Entries')).items.filter(entry => entry.mediaType === fixture.type && entry.tmdbId === fixture.id);
                if (!entries.length) break;
                for (const entry of entries) await apiDelete(page, `JellyfinMod/Entries/${entry.id}`).catch(() => {});
                await page.waitForTimeout(1500);
            }
        }
    }
    // A library goes from the viewer's list only with its refresh: read what the viewer sees, and wait for it.
    const wanted = before.slice().sort().join();
    let left = '';
    for (let wait = 0; wait < 40 && left !== wanted; wait++) {
        await page.waitForTimeout(3000);
        left = (await apiJson(page, 'UserViews')).Items.map(view => view.Name).sort().join();
    }
    record('the real media check left the libraries as they were', left === wanted, left);
}


const browser = await chromium.launch(tier === 'chrome' ? { headless: true, channel: 'chrome' } : { headless: true });
console.log('browser', tier, browser.version());
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(String(error.message).split('\n')[0]));
let attempts = 0;
let back = 0;
let stray = 0;
try {
    await signIn(page);
    await page.waitForTimeout(1000);
    for (const title of [...TITLES, ...REAL_MEDIA.filter(fixture => fixture.id)]) await requireAbsent(page, title);
    for (let round = 0; round < ROUNDS; round++) {
        for (const title of TITLES) {
            const delay = DELAYS[attempts % DELAYS.length];
            attempts += 1;
            if ((await entriesOf(page, title)).length) await clean(page, title);
            let label = `${title.title}, Undo ${delay} ms after its line`;
            try {
                await addThenUndo(page, title, delay);
            } catch (error) {
                record(`${label}: the add and Undo ran`, false, error.message.split('\n')[0]);
                await clean(page, title);
                continue;
            }
            await page.waitForTimeout(SETTLE);
            const entries = await entriesOf(page, title);
            const items = await itemsOf(page, title);
            label += ` (${round + 1}/${ROUNDS})`;
            record(`${label}: no entry comes back`, entries.length === 0, entries.map(entry => `${entry.id} state ${entry.state}`).join(', '));
            record(`${label}: no library item remains`, items.length === 0, items.map(item => `${item.Id} ${item.Path ?? ''}`).join(', '));
            if (entries.length) back += 1;
            if (items.length) stray += 1;
            await clean(page, title);
            if (items.length) await page.waitForTimeout(1500);
        }
    }


    if (MEDIA) {
        const movie = TITLES.find(title => title.type === 'movie');
        const series = ALL_TITLES.find(title => title.type === 'series');
        for (const title of [movie, series]) {
            await clean(page, title);
            await checkLeftBehind(page, title);
            await clean(page, title);
        }
        await checkEntryStays(page, movie);
    }

    // A real file of a title just undone is a title the library holds: it is still discovered, and it binds.
    if (MEDIA && SOURCE) {
        const title = TITLES[0];
        await clean(page, title);
        await addThenUndo(page, title, 0);
        await page.waitForTimeout(SETTLE);
        const folder = `${MEDIA}/movies/Arrival (2016) [tmdbid-329865]`;
        const leftover = existsSync(folder) ? readdirSync(folder) : [];
        mkdirSync(folder, { recursive: true });
        const file = `${folder}/Arrival (2016) [tmdbid-329865].mkv`;
        copyFileSync(SOURCE, file);
        try {
            await apiPost(page, 'Library/Refresh');
            let found = [];
            for (let wait = 0; wait < 40 && !found.some(entry => entry.state === 'onDisk'); wait++) {
                await page.waitForTimeout(3000);
                found = await entriesOf(page, title);
            }
            record('a real file of the undone title is discovered and on disk', found.length === 1 && found[0].state === 'onDisk',
                [found.map(entry => `${entry.id} state ${entry.state}`).join(', ') || 'no entry', `beside it before: ${leftover.join(', ') || 'nothing'}`].join('; '));
            const items = await itemsOf(page, title);
            record('the real file is the library\'s item', items.length === 1 && items[0].Path?.endsWith('.mkv'), items.map(item => item.Path).join(', '));
            record('the file was not touched', existsSync(file));
        } finally {
            rmSync(folder, { recursive: true, force: true });
            for (const item of await itemsOf(page, title)) await apiDelete(page, `Items/${item.Id}`).catch(() => {});
            for (let wait = 0; wait < 10 && (await entriesOf(page, title)).length; wait++) {
                await page.waitForTimeout(1500);
                await clean(page, title);
            }
        }
        const left = await entriesOf(page, title);
        record('the real file check cleaned up', left.length === 0, left.map(entry => entry.state).join(', '));
    }

    if (REAL && MEDIA && SOURCE) await checkRealMedia(page);
} finally {
    for (const title of ALL_TITLES) if (ownTitles.has(title.key)) await clean(page, title).catch(() => {});
    record('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await browser.close();
}
const failed = results.filter(result => !result.verdict).length;
console.log(`\n${attempts} undos: ${back} brought the title back, ${stray} left a library item`);
console.log(`${results.length - failed} passed, ${failed} failed (${tier})`);
process.exit(failed ? 1 : 0);
/* eslint-enable compat/compat, no-restricted-globals, sonarjs/cognitive-complexity, @stylistic/max-statements-per-line, no-empty-function */
