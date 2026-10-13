/* eslint-disable compat/compat, no-restricted-globals, @stylistic/max-statements-per-line, no-empty-function, sonarjs/cognitive-complexity -- a Node acceptance runner, not shipped code */
/* global window, document, ApiClient, localStorage, location, getComputedStyle, performance, requestAnimationFrame, MutationObserver */
// Get a Release without delay, and no Play where nothing can play (P1.FU23, user 2026-10-13: the season card's cloud "was not
// there and appeared after about 1 second"; Kleo's library card showed Play with nothing on disk). Signed in as oleksii with an
// empty password (and, when given, an ordinary user with an empty password), in a real browser against a running mod instance.
//
// A MutationObserver installed before the app's own scripts stamps, with the time and the animation frame:
//   - each card when it is first drawn (it holds its `.cardScalable`), and when its cloud (`.jfmod-cardGet`, `.jfmod-cardGetCentre`)
//     is first in it and not hidden; the first pointer-over of each card;
//   - the detail header row when it is first shown, and when the mod's header cloud (`.jfmod-getRelease`) is first in it;
//   - the card menu's sheet when it is inserted, and whether it holds Get a Release then.
// It checks, for an administrator:
//   - every card place on the desktop (a series page's season cards with files, a season card with nothing on disk, the mod's
//     missing-season card, the Shows and Movies library grids, Home's episode cards, search results): the cloud is in the card
//     no later than the frame after the card is drawn, and already there when the card is pointed at;
//   - every header (native series, season, episode and movie pages; the mod's season and episode pages): the cloud is in the
//     header row no later than the frame after the row is shown;
//   - the card's item menu (the TV's Menu key, the phone's More): the sheet holds Get a Release when it is inserted, without
//     waiting for a lookup (time to the sheet reported);
//   - Play only where something can play: a series Jellyfin holds no episode of (Kleo) has no Play and the cloud in the centre,
//     also while a download is on its way (an intercepted queue answer); a series with files keeps Play and the cloud in the
//     bottom row;
// each in three passes: first (the page opened by in-app navigation, nothing of its title read before in this session), warm (the
// same page again) and reload (a full load of the page with the shared query cache dropped, as after a deploy; this browser's
// kept answers stay). An ordinary user gets no cloud and no Play on Kleo.
//
//   JELLYFINMOD_TEST_URL=http://<host>:<port>/   a mod instance (18096, 28096, 48096) or a local environment on 127.0.0.1
//   [JELLYFINMOD_CND_FILES=Fleabag]  [JELLYFINMOD_CND_NOFILE_SEASONS=Delhi Crime]  [JELLYFINMOD_CND_MISSING=Peep Show]
//   [JELLYFINMOD_CND_SOME=Ted Lasso]  [JELLYFINMOD_CND_EMPTY=Kleo]   series to use; absent ones are NOT VERIFIED
//   [JELLYFINMOD_CND_USER=<ordinary user name>]  also check as this ordinary user (empty password); absent: NOT VERIFIED
//   [JELLYFINMOD_LOCAL_DIST=<dist folder>]       serve this local build in place of the instance's (never acceptance evidence)
//   [JELLYFINMOD_WEB_PATH=/web/]  [JELLYFINMOD_BROWSER=chromium|chrome]  [JELLYFINMOD_LAYOUTS=desktop,mobile,tv1080]
//   [JELLYFINMOD_CND_PASSES=first,warm,reload]  [JELLYFINMOD_SHOTS=<folder for screenshots>]
//
// Reads only: nothing is opened past a card menu, nothing is grabbed, played or changed. The queue answer for the download case
// is intercepted in this browser only.
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const origin = new URL(process.env.JELLYFINMOD_TEST_URL ?? (() => { throw new Error('JELLYFINMOD_TEST_URL is required'); })());
const loopback = ['127.0.0.1', 'localhost'].includes(origin.hostname);
// Never production on 8096: a remote address must be one of the mod instances; a local environment listens on loopback.
if (!loopback && !['18096', '28096', '48096'].includes(origin.port)) throw new Error('Runs on the mod instances or a local environment only');
const names = {
    files: process.env.JELLYFINMOD_CND_FILES ?? 'Fleabag',
    noFileSeasons: process.env.JELLYFINMOD_CND_NOFILE_SEASONS ?? 'Delhi Crime',
    missing: process.env.JELLYFINMOD_CND_MISSING ?? 'Peep Show',
    some: process.env.JELLYFINMOD_CND_SOME ?? 'Ted Lasso',
    empty: process.env.JELLYFINMOD_CND_EMPTY ?? 'Kleo'
};
const ordinaryUser = process.env.JELLYFINMOD_CND_USER ?? null;
const localDist = process.env.JELLYFINMOD_LOCAL_DIST ?? null;
const WEB_PATH = process.env.JELLYFINMOD_WEB_PATH ?? '/web/';
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
const layouts = (process.env.JELLYFINMOD_LAYOUTS ?? 'desktop,mobile,tv1080').split(',').filter(Boolean);
const passes = (process.env.JELLYFINMOD_CND_PASSES ?? 'first,warm,reload').split(',').filter(Boolean);
const SHOTS = process.env.JELLYFINMOD_SHOTS ?? null;
const LAYOUTS = {
    desktop: { viewport: { width: 1440, height: 900 } },
    mobile: {
        viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
    },
    tv1080: { viewport: { width: 1920, height: 1080 }, tv: true }
};
const PAGE = '.page:not(.hide)';
/** The cloud may arrive at most this many frames after what it belongs to (0 is the same frame). */
const FRAMES = 1;
/**
 * A native page seen for the first time (or after a full load) draws its header row when upstream's own item read answers, and
 * the mod's header icon when the mod's item read, sent at the same moment, does: the two land up to three frames apart (10 to
 * 45 ms measured on 28096), which no one can see. A page seen before has its item and draws both in one frame.
 */
const FRAMES_HEADER_READ = 3;

const results = [];
const timings = [];
const record = (label, check, pass, detail) => {
    let verdict = pass;
    if (typeof pass === 'boolean') verdict = pass ? 'PASS' : 'FAIL';
    results.push({ label, check, verdict, detail });
    console.log(`${verdict} [${label}] ${check}${detail === undefined ? '' : ' · ' + JSON.stringify(detail).slice(0, 400)}`);
};

/** Installed before the app's scripts on every load: stamps cards, header rows and card sheets as they are drawn. */
const STAMPS = () => {
    const T = window.jfmodStamps = { drawn: new WeakMap(), cloud: new WeakMap(), hover: new WeakMap(), frame: 0, sheets: [] };
    const tick = () => { T.frame++; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    const stamp = () => ({ t: performance.now(), f: T.frame });
    const cloudSel = '.jfmod-cardGet, .jfmod-cardGetCentre';
    const scanCard = card => {
        if (!T.drawn.has(card) && card.querySelector('.cardScalable')) T.drawn.set(card, stamp());
        if (!T.cloud.has(card) && [...card.querySelectorAll(cloudSel)].some(button => !button.hidden)) T.cloud.set(card, stamp());
    };
    const scan = node => {
        if (!(node instanceof Element)) return;
        const card = node.closest('.card');
        if (card) scanCard(card);
        node.querySelectorAll('.card').forEach(scanCard);
        if (node.matches('.actionSheet') || node.querySelector('.actionSheet')) {
            const sheet = node.matches('.actionSheet') ? node : node.querySelector('.actionSheet');
            T.sheets.push({ ...stamp(), getRelease: !!sheet.querySelector('.actionSheetMenuItem[data-id="jfmod-more-getRelease"]') });
        }
    };
    new MutationObserver(records => {
        for (const change of records) {
            if (change.type === 'attributes') scan(change.target);
            else change.addedNodes.forEach(scan);
        }
    }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class', 'data-jfmod-nofile', 'data-jfmod-empty'] });
    document.addEventListener('pointerover', event => {
        const card = event.target.closest?.('.card');
        if (card && !T.hover.has(card)) T.hover.set(card, stamp());
    }, true);
    // A navigation's header: polled every frame from the moment it is asked for, so a reused view is measured as shown.
    window.jfmodWatchHeader = () => {
        const header = window.jfmodHeader = { asked: stamp(), shown: null, cloud: null };
        const poll = () => {
            const row = [...document.querySelectorAll('.mainDetailButtons')].find(candidate => candidate.offsetParent
                && [...candidate.children].some(child => child.offsetParent));
            if (row && !header.shown) header.shown = stamp();
            if (row && !header.cloud && row.querySelector(':scope > .jfmod-getRelease')) header.cloud = stamp();
            if (!header.cloud && performance.now() - header.asked.t < 10000) requestAnimationFrame(poll);
        };
        requestAnimationFrame(poll);
    };
};

/** A local build served in place of the instance's: its mod page (jellyfinmod.html) under the web path, its files under one asset root. */
async function serveLocal(page) {
    if (!localDist) return;
    const root = '/web-mod/jfmod-local/';
    const types = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.html': 'text/html', '.svg': 'image/svg+xml',
        '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain' };
    const index = (await readFile(join(localDist, 'jellyfinmod.html'), 'utf8'))
        .replace(/(src|href)="(?!https?:|\/|#|data:)([^"]+)"/g, `$1="${root}$2"`)
        .replace('<head>', `<head><script>window.__jfmodAssetRoot="${root}";</script>`);
    await page.route(url => url.pathname === WEB_PATH || url.pathname === WEB_PATH + 'index.html',
        route => route.fulfill({ status: 200, contentType: 'text/html', body: index }));
    await page.route(url => url.pathname.startsWith(root), async route => {
        const file = decodeURIComponent(new URL(route.request().url()).pathname.slice(root.length));
        try {
            route.fulfill({ status: 200, contentType: types[extname(file)] ?? 'application/octet-stream', body: await readFile(join(localDist, file)) });
        } catch { route.fulfill({ status: 404, body: '' }); }
    });
}

const signedIn = page => page.evaluate(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } });

async function signIn(page, user) {
    await page.goto(new URL(WEB_PATH, origin).href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.ApiClient, undefined, { timeout: 30000 });
    await page.waitForFunction(() => {
        try { return !!ApiClient.getCurrentUserId() || /login|selectuser|selectserver/.test(location.hash); } catch { return false; }
    }, undefined, { timeout: 30000 });
    if (await signedIn(page)) return;
    const field = page.locator('#txtManualName');
    if (!await field.isVisible().catch(() => false)) {
        const chooser = page.locator('.btnManual').first();
        await chooser.waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
        if (await chooser.count()) await chooser.evaluate(node => node.click());
        await field.waitFor({ state: 'visible', timeout: 15000 });
    }
    await page.waitForTimeout(1000);
    await field.fill(user);
    await page.locator('#txtManualPassword').fill('');
    await page.locator('button:visible').filter({ hasText: 'Sign In' }).first().click();
    await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } }, undefined, { timeout: 30000 });
    await page.waitForFunction(() => location.hash.startsWith('#/home'), undefined, { timeout: 30000 });
}

/** Drops the shared query cache (IndexedDB), as a deploy's new build version does; this browser's kept answers stay. */
const dropQueryCache = page => page.evaluate(() => new Promise(resolve => {
    const request = window.indexedDB.open('keyval-store');
    request.onerror = () => resolve(false);
    request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('keyval')) { db.close(); resolve(false); return; }
        const tx = db.transaction('keyval', 'readwrite');
        tx.objectStore('keyval').delete('jellyfin-query-cache');
        tx.oncomplete = () => { db.close(); resolve(true); };
        tx.onerror = () => { db.close(); resolve(false); };
    };
}));

/** Opens a place: by a full load with the query cache dropped (reload), else by in-app navigation. */
async function open(page, hash, pass, tv) {
    if (pass === 'reload') {
        await dropQueryCache(page);
        await page.goto(new URL(WEB_PATH + hash, origin).href, { waitUntil: 'commit' });
        await page.waitForFunction(() => typeof window.jfmodWatchHeader === 'function', undefined, { timeout: 30000 });
        await page.evaluate(() => window.jfmodWatchHeader());
        if (tv) await page.waitForFunction(() => document.documentElement.classList.contains('layout-tv'), undefined, { timeout: 30000 }).catch(() => {});
    } else {
        await page.evaluate(() => { location.hash = '#/home'; });
        await page.waitForTimeout(1200);
        await page.evaluate(target => { window.jfmodWatchHeader(); location.hash = target; }, hash);
    }
}

/** What the stamps say of a card, and how its overlay looks now. */
const cardStamps = (page, handle) => page.evaluate(card => {
    const T = window.jfmodStamps;
    const button = [...card.querySelectorAll('.jfmod-cardGet, .jfmod-cardGetCentre')].find(node => !node.hidden);
    const play = card.querySelector('.cardOverlayButton[data-action="play"], .cardOverlayButton[data-action="resume"]');
    return { drawn: T.drawn.get(card) ?? null, cloud: T.cloud.get(card) ?? null, hover: T.hover.get(card) ?? null,
        centre: !!button?.classList.contains('cardOverlayFab-primary') || !!button?.classList.contains('jfmod-cardGetCentre'),
        playPresent: !!play, playShown: !!play && getComputedStyle(play).display !== 'none',
        empty: card.hasAttribute('data-jfmod-empty'), noFile: card.hasAttribute('data-jfmod-nofile') };
}, handle);

/**
 * A card place on the desktop: the card is pointed at as soon as it is drawn; its cloud must be in it no later than the frame
 * after it was drawn and before it was pointed at. `expect` names where the cloud sits and whether Play stays.
 */
async function cardPlace(page, label, pass, name, hash, selector, expect) {
    await open(page, hash, pass, false);
    const card = page.locator(`${PAGE} ${selector}`).first();
    if (!await card.waitFor({ state: 'visible', timeout: 20000 }).then(() => true, () => false)) {
        record(label, `${pass}: ${name}`, 'NOT VERIFIED', 'card not found');
        return null;
    }
    await card.scrollIntoViewIfNeeded().catch(() => {});
    await card.hover({ timeout: 5000 }).catch(() => {});
    const handle = await card.elementHandle();
    await page.waitForFunction(node => !!window.jfmodStamps.cloud.get(node), handle, { timeout: 4000 }).catch(() => {});
    const facts = await cardStamps(page, handle);
    const frames = facts.cloud && facts.drawn ? facts.cloud.f - facts.drawn.f : null;
    const ms = facts.cloud && facts.drawn ? Math.round(facts.cloud.t - facts.drawn.t) : null;
    const afterHover = facts.cloud && facts.hover ? Math.round(facts.cloud.t - facts.hover.t) : null;
    timings.push({ layout: label, pass, place: name, msAfterDrawn: ms, framesAfterDrawn: frames, msAfterPointed: afterHover });
    if (expect.cloud === false) {
        record(label, `${pass}: ${name}: no cloud`, !facts.cloud, facts);
    } else {
        record(label, `${pass}: ${name}: the cloud is in the card no later than the frame after it is drawn, before it is pointed at`,
            frames !== null && frames <= FRAMES && (afterHover === null || afterHover <= 0), { frames, ms, afterHover });
        record(label, `${pass}: ${name}: the cloud sits ${expect.centre ? 'in the centre' : 'in the bottom row'}`, facts.centre === expect.centre, facts);
    }
    if (expect.play !== undefined) {
        record(label, `${pass}: ${name}: Play ${expect.play ? 'stays' : 'is hidden'}`,
            expect.play ? facts.playShown : !facts.playShown, { playPresent: facts.playPresent, playShown: facts.playShown, empty: facts.empty, noFile: facts.noFile });
    }
    return facts;
}

/** A detail header: the cloud must be in the header row no later than the frame after the row is shown. */
async function headerPlace(page, label, pass, name, hash, tv, admin) {
    await open(page, hash, pass, tv);
    await page.waitForFunction(() => !!window.jfmodHeader?.cloud, undefined, { timeout: admin ? 10000 : 5000 }).catch(() => {});
    const header = await page.evaluate(() => window.jfmodHeader);
    const frames = header?.cloud && header.shown ? header.cloud.f - header.shown.f : null;
    const ms = header?.cloud && header.shown ? Math.round(header.cloud.t - header.shown.t) : null;
    timings.push({ layout: label, pass, place: name, msAfterDrawn: ms, framesAfterDrawn: frames });
    if (!admin) { record(label, `${pass}: ${name}: no header cloud`, !!header?.shown && !header.cloud, header); return; }
    const allowed = pass === 'warm' ? FRAMES : FRAMES_HEADER_READ;
    record(label, `${pass}: ${name}: the header cloud is in the row no later than ${allowed} frame(s) after the row is shown`,
        frames !== null && frames <= allowed, { frames, ms, shownAfterAsk: header?.shown ? Math.round(header.shown.t - header.asked.t) : null });
}

/** A card's item menu (the TV's Menu key, the phone's More): the sheet holds Get a Release when it is inserted. */
async function menuPlace(page, label, pass, { name, hash, selector, tv, admin }) {
    await open(page, hash, pass, tv);
    const card = page.locator(`${PAGE} ${selector}`).first();
    if (!await card.waitFor({ state: 'visible', timeout: 20000 }).then(() => true, () => false)) {
        record(label, `${pass}: ${name}`, 'NOT VERIFIED', 'card not found');
        return;
    }
    await card.scrollIntoViewIfNeeded().catch(() => {});
    const more = card.locator('[data-action="menu"]');
    const useMore = !tv && await more.count() > 0;
    if (!tv && !useMore) { record(label, `${pass}: ${name}`, 'NOT VERIFIED', 'upstream draws no More on this card on the phone'); return; }
    const asked = await (useMore ? more.first() : card).evaluate((node, viaMore) => {
        window.jfmodStamps.sheets = [];
        const at = performance.now();
        if (viaMore) {
            node.click();
        } else {
            node.focus();
            node.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        }
        return at;
    }, useMore);
    await page.waitForFunction(() => window.jfmodStamps.sheets.length > 0, undefined, { timeout: 8000 }).catch(() => {});
    const sheet = await page.evaluate(() => window.jfmodStamps.sheets[0] ?? null);
    const ms = sheet ? Math.round(sheet.t - asked) : null;
    timings.push({ layout: label, pass, place: name, msToSheet: ms });
    record(label, `${pass}: ${name}: the sheet ${admin ? 'holds Get a Release when it is inserted' : 'has no Get a Release'}`,
        !!sheet && sheet.getRelease === admin, { ms, getRelease: sheet?.getRelease });
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(500);
}

/** The run's titles, read through Jellyfin's own API and the plugin's lookup as the signed-in user. */
const facts = page => page.evaluate(async wanted => {
    const userId = ApiClient.getCurrentUserId();
    const items = (await ApiClient.getItems(userId, { IncludeItemTypes: 'Series,Movie', Recursive: true, EnableImages: false, Fields: 'RecursiveItemCount' })).Items;
    const byName = name => items.find(item => item.Type === 'Series' && item.Name.toLowerCase() === name.toLowerCase()) ?? null;
    const lookup = async id => {
        const response = await fetch(ApiClient.getUrl('JellyfinMod/Entries', { jellyfinItemId: id, limit: 1 }),
            { headers: { Authorization: `MediaBrowser Token="${ApiClient.accessToken()}"` } });
        return response.ok ? (await response.json()).items?.[0] ?? null : null;
    };
    const out = { serverId: ApiClient.serverId(), views: (await ApiClient.getUserViews({}, userId)).Items.map(view => ({ id: view.Id, type: view.CollectionType })) };
    for (const [key, name] of Object.entries(wanted)) {
        const item = byName(name);
        out[key] = item && { id: item.Id, name: item.Name, episodes: item.RecursiveItemCount ?? null };
    }
    out.movie = items.find(item => item.Type === 'Movie') ?? null;
    out.movie = out.movie && { id: out.movie.Id, name: out.movie.Name };
    if (out.files) {
        const seasons = (await ApiClient.getSeasons(out.files.id, { userId })).Items.filter(season => season.IndexNumber > 0);
        out.filesSeason = seasons[0]?.Id ?? null;
        out.filesEpisode = out.filesSeason ? (await ApiClient.getEpisodes(out.files.id, { userId, seasonId: out.filesSeason })).Items[0]?.Id ?? null : null;
    }
    if (out.missing) {
        const entry = await lookup(out.missing.id);
        const seasons = new Set((await ApiClient.getSeasons(out.missing.id, { userId })).Items.map(season => season.IndexNumber));
        const detail = entry ? await (await fetch(ApiClient.getUrl('JellyfinMod/Entries/' + entry.id),
            { headers: { Authorization: `MediaBrowser Token="${ApiClient.accessToken()}"` } })).json() : null;
        const season = detail?.episodes.map(episode => episode.seasonNumber).find(number => number > 0 && !seasons.has(number)) ?? null;
        out.missingEntry = entry && season ? { id: entry.id, season, episode: detail.episodes.find(episode => episode.seasonNumber === season).episodeNumber } : null;
    }
    if (out.empty) {
        const entry = await lookup(out.empty.id);
        out.emptyEntry = entry && { id: entry.id, mediaType: entry.mediaType, title: entry.title, year: entry.year, jellyfinItemId: out.empty.id };
    }
    return out;
}, names);

/** One queue row as the plugin answers it: the empty series' first episode on its way (the download-only case). */
const downloadingRow = entry => {
    const at = new Date().toISOString();
    return { id: '00000000-0000-4000-8000-000000000001', grabId: '00000000-0000-4000-9000-000000000001',
        entry: { id: entry.id, mediaType: 'series', title: entry.title, year: entry.year ?? null, posterPath: null, jellyfinItemId: entry.jellyfinItemId,
            targetLibraryId: null },
        episode: null, releaseTitle: 'JellyfinMod cloud fixture', state: 'downloading', importState: 'downloading', reason: null, message: null,
        progress: 0.42, sizeBytes: null, downloadedBytes: null, downloadRateBytes: 3100000, etaSeconds: 720, stalledSince: null, observedAt: at,
        versionLabel: null, intent: 'acquire', createdAt: at, updatedAt: at, client: null, seeding: null, pack: null };
};

async function runLayout(browser, layout, user) {
    const admin = user === 'oleksii';
    const label = `${layout}, ${tier}, ${admin ? 'administrator' : 'ordinary user'}`;
    const tv = !!LAYOUTS[layout].tv;
    const options = { ...LAYOUTS[layout] };
    delete options.tv;
    const context = await browser.newContext(options);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error.message).slice(0, 200)));
    await page.addInitScript(STAMPS);
    await serveLocal(page);
    try {
        await signIn(page, user);
        if (tv) {
            await page.evaluate(() => localStorage.setItem('layout', 'tv'));
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } }, undefined, { timeout: 30000 });
        }
        await page.waitForTimeout(1500);
        const f = await facts(page);
        const shows = f.views.find(view => view.type === 'tvshows')?.id;
        const movies = f.views.find(view => view.type === 'movies')?.id;
        const details = id => `#/details?id=${id}&serverId=${f.serverId}`;
        const showsGrid = `#/tv?topParentId=${shows}&collectionType=tvshows&tab=0`;
        if (f.empty) record(label, `${f.empty.name} is a series Jellyfin holds no episode of`, f.empty.episodes === 0, f.empty);
        if (f.some) record(label, `${f.some.name} is a series with episodes on disk`, f.some.episodes > 0, f.some);
        for (const [key, name] of Object.entries(names)) if (!f[key]) record(label, `the series "${name}"`, 'NOT VERIFIED', 'not in this library');

        for (const pass of passes) {
            if (layout === 'desktop') {
                const cloud = admin ? undefined : false;
                if (f.files) await cardPlace(page, label, pass, `${f.files.name}'s season card (files)`, details(f.files.id), '#listChildrenCollapsible .card[data-type="Season"]', { cloud, centre: false, play: true });
                if (f.noFileSeasons) await cardPlace(page, label, pass, `${f.noFileSeasons.name}'s season card (nothing on disk)`, details(f.noFileSeasons.id), '#listChildrenCollapsible .card[data-type="Season"]', { cloud, centre: true, play: false });
                if (f.missing && admin) await cardPlace(page, label, pass, `${f.missing.name}'s missing-season card (the mod's)`, details(f.missing.id), '#listChildrenCollapsible .jfmod-missingCard', { centre: true });
                if (f.some && shows) await cardPlace(page, label, pass, `Shows grid: ${f.some.name} (some files)`, showsGrid, `.card[data-id="${f.some.id}"]`, { cloud, centre: false, play: true });
                if (f.empty && shows) await cardPlace(page, label, pass, `Shows grid: ${f.empty.name} (no files)`, showsGrid, `.card[data-id="${f.empty.id}"]`, { cloud, centre: true, play: false });
                if (movies) await cardPlace(page, label, pass, 'Movies grid: a movie', `#/movies?topParentId=${movies}&collectionType=movies&tab=0`, '.card[data-type="Movie"]', { cloud, centre: false, play: true });
                await cardPlace(page, label, pass, 'Home: an episode card', '#/home', '.card[data-type="Episode"]', { cloud, centre: false, play: true });
                if (f.some) await cardPlace(page, label, pass, `search: ${f.some.name}`, `#/search?query=${encodeURIComponent(f.some.name)}`, `.card[data-id="${f.some.id}"]`, { cloud, centre: false, play: true });
                if (f.empty) await cardPlace(page, label, pass, `search: ${f.empty.name} (no files)`, `#/search?query=${encodeURIComponent(f.empty.name)}`, `.card[data-id="${f.empty.id}"]`, { cloud, centre: true, play: false });
            } else if (admin) {
                const menuCard = tv && f.files ? [details(f.files.id), '#listChildrenCollapsible .card[data-type="Season"]', `${f.files.name}'s season card menu (Menu key)`] :
                    [`#/movies?topParentId=${movies}&collectionType=movies&tab=0`, '.card[data-type="Movie"]', 'a movie card\'s More menu'];
                await menuPlace(page, label, pass, { name: menuCard[2], hash: menuCard[0], selector: menuCard[1], tv, admin });
                if (!tv && f.empty) {
                    // The phone's overlay Play on a series with nothing on disk.
                    await open(page, `#/search?query=${encodeURIComponent(f.empty.name)}`, pass, false);
                    const card = page.locator(`${PAGE} .card[data-id="${f.empty.id}"]`).first();
                    if (await card.waitFor({ state: 'visible', timeout: 20000 }).then(() => true, () => false)) {
                        const state = await cardStamps(page, await card.elementHandle());
                        record(label, `${pass}: search: ${f.empty.name} (no files): no overlay Play on the phone`, !state.playShown, state);
                    }
                }
            }
            if (f.files) {
                await headerPlace(page, label, pass, `${f.files.name} series page header`, details(f.files.id), tv, admin);
                if (f.filesSeason) await headerPlace(page, label, pass, `${f.files.name} season page header`, details(f.filesSeason), tv, admin);
                if (f.filesEpisode) await headerPlace(page, label, pass, `${f.files.name} episode page header`, details(f.filesEpisode), tv, admin);
            }
            if (f.movie) await headerPlace(page, label, pass, `movie page header (${f.movie.name})`, details(f.movie.id), tv, admin);
            if (f.missingEntry && admin) {
                const base = `#/details?entryId=${f.missingEntry.id}&serverId=${f.serverId}&season=${f.missingEntry.season}`;
                await headerPlace(page, label, pass, `${f.missing.name} Season ${f.missingEntry.season} (the mod's season page) header`, base, tv, admin);
                await headerPlace(page, label, pass, `${f.missing.name} S${f.missingEntry.season}E${f.missingEntry.episode} (the mod's episode page) header`,
                    `${base}&episode=${f.missingEntry.episode}`, tv, admin);
            }
        }

        // A series with nothing on disk and a download on its way: still no Play, the cloud in the centre.
        if (layout === 'desktop' && f.emptyEntry && shows) {
            await page.route(url => /\/JellyfinMod\/Queue$/i.test(url.pathname), route => (route.request().method() === 'GET' ?
                route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [downloadingRow(f.emptyEntry)], totalRecordCount: 1,
                    generatedAt: new Date().toISOString(), clientStatus: { reachable: true, checkedAt: new Date().toISOString(), reason: null },
                    importEnabled: true, seedReleaseEnabled: true }) }) : route.continue()));
            await cardPlace(page, label, 'warm', `Shows grid: ${f.empty.name} (no files, a download on its way; intercepted queue answer)`, showsGrid,
                `.card[data-id="${f.empty.id}"]`, { cloud: admin ? undefined : false, centre: true, play: false });
            if (SHOTS) await page.screenshot({ path: `${SHOTS}/cnd-${tier}-${layout}-${admin ? 'admin' : 'user'}-empty-downloading.png` }).catch(() => {});
            await page.unroute(url => /\/JellyfinMod\/Queue$/i.test(url.pathname)).catch(() => {});
        }
        record(label, 'no page errors', errors.length === 0, errors.slice(0, 5));
    } finally {
        await context.close();
    }
}

// A local build is served by this runner, which the browser then treats as a public page asking a private address; the instance
// is on the local network, so that check is turned off for such a run.
const args = localDist ? ['--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights'] : [];
const browser = await chromium.launch(tier === 'chrome' ? { channel: 'chrome', args } : { args });
try {
    for (const layout of layouts) {
        await runLayout(browser, layout, 'oleksii');
        if (ordinaryUser) await runLayout(browser, layout, ordinaryUser);
        else record(`${layout}, ${tier}`, 'an ordinary user gets no cloud and no Play on a series with nothing on disk', 'NOT VERIFIED', 'no JELLYFINMOD_CND_USER');
    }
} finally {
    await browser.close();
}
console.log('\nTIMINGS ' + JSON.stringify(timings));
const count = verdict => results.filter(result => result.verdict === verdict).length;
console.log(`\n${count('PASS')} passed, ${count('FAIL')} failed, ${count('NOT VERIFIED')} not verified`);
process.exitCode = count('FAIL') ? 1 : 0;
/* eslint-enable compat/compat, no-restricted-globals, @stylistic/max-statements-per-line, no-empty-function, sonarjs/cognitive-complexity */
