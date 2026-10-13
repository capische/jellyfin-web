/* eslint-disable compat/compat, no-restricted-globals, @stylistic/max-statements-per-line, no-empty-function, sonarjs/cognitive-complexity -- a Node acceptance runner, not shipped code */
/* global window, document, ApiClient, localStorage, location, getComputedStyle */
// The download state ring family on every card, row and line (P4.FU1, P4.FU5; the ring family P4.FU6, user-approved design
// 2026-10-13, docs/jellyfinmod/design/download-state-ring-family.html; UX §3.3), in a real browser against a running mod
// instance, signed in as oleksii with an empty password.
//
// INTERCEPTED QUEUE ANSWERS, NOT A LIVE DOWNLOAD: the browser's `GET /JellyfinMod/Queue` is answered by this runner with rows
// built from real entries, episodes and Jellyfin items of the instance (one native season's episodes: downloading, a pack's own
// file, queued, importing, stalled, failed; a season pack on a season Jellyfin does not have; the movie in its states). The
// release picker's search, grab and grab state are answered too. Nothing is grabbed and nothing on the server changes, except
// the browser's own list-view setting of the two libraries (localStorage in this runner's context). What it checks:
//   - cards: the disc (1.6em, the top bar's glass and a white glyph, solid black on the TV, the arrow with the white arc at the percent, bobbing) top right as the first of upstream's
//     indicators, LEFT OF upstream's plain count pill (two icons: no arrow in the pill), or alone in the corner; its tooltip is
//     the figure (`Downloading · 44% · 1 h 05 min left · 5 MB/s`); the two-layer bar at the poster's bottom stays; the other
//     season cards carry none; the missing season card's Not Downloaded hidden by the disc; the film card's queued (clock),
//     importing (turning arc), stalled (pause, dimmed arc) and failed (no download on a card); Next Up where Home shows one;
//   - rows (native and mod season page rows, the pack's episodes each with their own figure, the library list rows): the disc
//     (2.5em, transparent) as the first round icon of the end slot, NO bar, no figure left of the icons, the figure on the meta
//     line after the date (`42% · 12 min left`, `42% · 6 min left`, `queued`, `importing…`, `30% · stalled`, `Failed · …`) and
//     in the disc's tooltip; a failure on a row with Not Downloaded takes that mark (a red bang, an indicator since P1.FU19: no
//     button or, since P1.FU22, the administrator's button disabled; no focus stop, no "search again"), never both; a failure without one is the red bang disc; the light scheme's
//     colours; P1.FU19: the row disc has the box and glyph of upstream's round row buttons beside it (the heart, More), and no
//     disc changes under the mouse (cards, rows, the picker's added row; the added row's X keeps its hover);
//   - the episode detail line: the disc and `In the download queue · 42% · 6 min left · View queue`;
//   - the Queue page: the disc in each row's state cell, its progress bar kept;
//   - the release picker's added row: the disc in the Add slot, the X kept, the figure on the marks line, no bar;
//   - reduced motion: the arrow and the importing arc rest;
//   - one queue read per page, then every 5 s while something is on its way, and no polling once nothing is; no page errors.
//
//   JELLYFINMOD_TEST_URL=http://<host>:<port>/   a mod instance (18096, 28096, 48096) or a local environment on 127.0.0.1
//   JELLYFINMOD_CP_SERIES=<series entry id>        a series with a Jellyfin series item and at least one Jellyfin season
//   [JELLYFINMOD_CP_MOVIE=<entry id>]             a movie entry with a Jellyfin item (its card, list row and states)
//   [JELLYFINMOD_WEB_PATH=/web/]  [JELLYFINMOD_BROWSER=chromium|chrome]  [JELLYFINMOD_LAYOUTS=desktop,mobile,tv1080]
//   [JELLYFINMOD_SHOTS=<folder>]
//   [JELLYFINMOD_LOCAL_DIST=<dist folder>]        serve this local build in place of the instance's (a look before a deploy,
//                                                never acceptance evidence)
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

import { search as pickerSearch } from './picker-compare-fixture.mjs';

const origin = new URL(process.env.JELLYFINMOD_TEST_URL ?? (() => { throw new Error('JELLYFINMOD_TEST_URL is required'); })());
const loopback = ['127.0.0.1', 'localhost'].includes(origin.hostname);
if (!loopback && !['18096', '28096', '48096'].includes(origin.port)) throw new Error('Runs on the mod instances or a local environment only');
const seriesEntryId = process.env.JELLYFINMOD_CP_SERIES ?? (() => { throw new Error('JELLYFINMOD_CP_SERIES is required'); })();
const movieEntryId = process.env.JELLYFINMOD_CP_MOVIE ?? null;
const localDist = process.env.JELLYFINMOD_LOCAL_DIST ?? null;
const WEB_PATH = process.env.JELLYFINMOD_WEB_PATH ?? '/web/';
const SHOTS = process.env.JELLYFINMOD_SHOTS ?? '.';
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
const layouts = (process.env.JELLYFINMOD_LAYOUTS ?? 'desktop,mobile,tv1080').split(',').filter(Boolean);
const LAYOUTS = {
    desktop: { viewport: { width: 1440, height: 900 } },
    mobile: {
        viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
    },
    tv1080: { viewport: { width: 1920, height: 1080 }, tv: true }
};
const AMBER = 'rgb(255, 179, 0)';
const WHITE = 'rgb(255, 255, 255)';
const RED_DARK = 'rgb(255, 90, 79)';
const RED_LIGHT = 'rgb(198, 40, 40)';
const META_DARK = AMBER;
const META_STALLED_DARK = 'rgb(224, 160, 48)';
const META_LIGHT = 'rgb(154, 103, 0)';
const META_STALLED_LIGHT = 'rgb(141, 90, 0)';
const META_FAILED_DARK = 'rgb(255, 123, 114)';
const END_SLOT = '.jfmod-rowMarkHost, .jfmod-missingRowEnd, .jfmod-mark--row, .listViewUserDataButtons, .listItemButton';

const results = [];
const record = (label, check, pass, detail) => {
    let verdict = pass;
    if (typeof pass === 'boolean') verdict = pass ? 'PASS' : 'FAIL';
    results.push({ label, check, verdict, detail });
    console.log(`${verdict} [${label}] ${check}${detail === undefined ? '' : ' · ' + JSON.stringify(detail).slice(0, 600)}`);
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

async function signIn(page) {
    await page.goto(new URL(WEB_PATH, origin).href, { waitUntil: 'domcontentloaded' });
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
    await page.waitForFunction(() => location.hash.startsWith('#/home'), undefined, { timeout: 30000 });
}

const apiGet = (page, path) => page.evaluate(async url => {
    const response = await fetch(ApiClient.getUrl(url), { headers: { Authorization: `MediaBrowser Token="${ApiClient.accessToken()}"` } });
    return response.ok ? response.json() : null;
}, path);

const go = async (page, hash) => {
    await page.evaluate(target => { location.hash = target; }, hash);
    await page.waitForTimeout(500);
};

const now = () => new Date().toISOString();
let serial = 0;
const uuid = (group = 8000) => `00000000-0000-4000-${group}-${String(++serial).padStart(12, '0')}`;
/** One queue row as the plugin answers it. */
const queueRow = (entry, { episode = null, pack = null, state, progress = null, etaSeconds = null, message = null, downloadRateBytes = null,
    grabId = null, intent = 'acquire' }) => ({
    id: uuid(), grabId: grabId ?? uuid(9000),
    entry: { id: entry.id, mediaType: entry.mediaType, title: entry.title, year: entry.year ?? null, posterPath: null,
        jellyfinItemId: entry.jellyfinItemId ?? null, targetLibraryId: null },
    episode, releaseTitle: 'JellyfinMod ring family fixture', state, importState: state, reason: message ? 'fixture' : null, message,
    progress, sizeBytes: null, downloadedBytes: null, downloadRateBytes, etaSeconds, stalledSince: null, observedAt: now(),
    versionLabel: null, intent, createdAt: now(), updatedAt: now(), client: null, seeding: null, pack
});
const episodeRef = episode => ({ id: episode.id, seasonNumber: episode.seasonNumber, episodeNumber: episode.episodeNumber, title: episode.title });
const packEpisode = (episode, own) => ({ episodeId: episode.id, seasonNumber: episode.seasonNumber, episodeNumber: episode.episodeNumber,
    importId: own.importState ? `00000000-0000-4000-a000-${String(++serial).padStart(12, '0')}` : null, importState: own.importState ?? null,
    reason: own.reason ?? null, progress: own.progress ?? null, sizeBytes: own.sizeBytes ?? null });

/** A card's download: its bar, its disc and where the disc sits beside upstream's indicators. */
const cardState = (page, selector) => page.evaluate(sel => {
    const card = [...document.querySelectorAll(sel)].find(node => !node.closest('.hide'));
    if (!card) return null;
    const frame = card.querySelector('.cardScalable') ?? card;
    const bar = frame.querySelector('.jfmod-dlCardBar');
    const fill = bar?.querySelector('.jfmod-dlBar-fill');
    const disc = frame.querySelector('.jfmod-dlmark');
    const pill = frame.querySelector('.countIndicator');
    const indicators = frame.querySelector('.cardIndicators');
    const none = frame.querySelector('.jfmod-mark--none');
    const fontSize = parseFloat(getComputedStyle(frame).fontSize);
    const discBox = disc?.getBoundingClientRect();
    const arc = disc?.querySelector('.jfmod-dlmark-fill');
    const pillBefore = pill ? getComputedStyle(pill, '::before').content : null;
    return {
        bar: !!bar,
        percent: fill ? parseFloat(fill.style.width) : null,
        colour: fill ? getComputedStyle(fill).backgroundColor : null,
        heightEm: bar ? Math.round(bar.getBoundingClientRect().height / fontSize * 100) / 100 : null,
        atBottom: bar ? Math.abs(bar.getBoundingClientRect().bottom - frame.getBoundingClientRect().bottom) < 1.5 : false,
        disc: disc ? {
            kind: disc.getAttribute('data-jfmod-kind'), card: disc.classList.contains('jfmod-dlmark--card'), title: disc.title,
            colour: getComputedStyle(disc).color, background: getComputedStyle(disc).backgroundColor, backdrop: getComputedStyle(disc).backdropFilter,
            arcColour: arc ? getComputedStyle(arc).stroke : null,
            sizeEm: Math.round(discBox.width / fontSize * 100) / 100, visible: discBox.width > 0,
            glyphAnimation: getComputedStyle(disc.querySelector('.jfmod-dlmark-glyph')).animationName,
            arcAnimation: disc.querySelector('.jfmod-dlmark-arc') ? getComputedStyle(disc.querySelector('.jfmod-dlmark-arc')).animationName : null,
            arc: arc ? { offset: parseFloat(getComputedStyle(arc).strokeDashoffset), dash: arc.getAttribute('stroke-dasharray'),
                opacity: getComputedStyle(arc).opacity } : null,
            firstIndicator: indicators ? indicators.firstElementChild === disc : null,
            corner: disc.classList.contains('jfmod-dlmark--corner'),
            topRight: discBox.right > frame.getBoundingClientRect().left + frame.getBoundingClientRect().width * 0.6
                && discBox.top < frame.getBoundingClientRect().top + frame.getBoundingClientRect().height * 0.3
        } : null,
        // Upstream's own pill: the number alone, no arrow drawn into it; the disc to its left.
        pill: pill ? { text: pill.textContent.trim(), arrow: !!pill.querySelector('svg, .jfmod-dlmark') || (pillBefore !== 'none' && pillBefore !== 'normal'),
            discLeft: !!discBox && discBox.right <= pill.getBoundingClientRect().left + 1 } : null,
        tick: !!frame.querySelector('.playedIndicator'),
        noneShown: !!none && getComputedStyle(none).display !== 'none',
        upstreamBarHidden: [...frame.querySelectorAll('.itemProgressBar, .itemLinearProgress')].every(node => getComputedStyle(node).visibility === 'hidden')
    };
}, selector);

/** The rows that show a download: the disc and where it sits, the meta figure and where it sits, no bar, a failure's button. */
const rowStates = page => page.evaluate(endSlot => [...document.querySelectorAll('.page:not(.hide) .jfmod-dlRow')].map(row => {
    const disc = row.querySelector('.jfmod-dlmark');
    const meta = row.querySelector('.jfmod-dlMeta');
    const cloud = row.querySelector('.jfmod-mark--none');
    const font = parseFloat(getComputedStyle(row).fontSize);
    const siblings = disc ? [...disc.parentElement.children] : [];
    const at = siblings.indexOf(disc);
    const before = cloud ? getComputedStyle(cloud, '::before') : null;
    return {
        id: row.getAttribute('data-id') ?? row.getAttribute('data-jfmod-episode-id'),
        disc: disc ? {
            kind: disc.getAttribute('data-jfmod-kind'), row: disc.classList.contains('jfmod-dlmark--row'), title: disc.title,
            colour: getComputedStyle(disc).color, background: getComputedStyle(disc).backgroundColor,
            sizeEm: Math.round(disc.getBoundingClientRect().width / font * 100) / 100,
            // The first round icon of the end slot: nothing of the slot before it, the slot (or nothing) after it.
            firstOfEnd: !siblings.slice(0, at).some(node => node.matches(endSlot)) && (at === siblings.length - 1 || siblings[at + 1].matches(endSlot)),
            atEnd: disc.getBoundingClientRect().left > row.getBoundingClientRect().left + row.getBoundingClientRect().width * 0.5,
            arcOffset: disc.querySelector('.jfmod-dlmark-fill') ? parseFloat(getComputedStyle(disc.querySelector('.jfmod-dlmark-fill')).strokeDashoffset) : null
        } : null,
        meta: meta ? {
            text: meta.textContent, title: meta.title, colour: getComputedStyle(meta).color, tabular: getComputedStyle(meta).fontVariantNumeric,
            where: (meta.parentElement.matches('.listItemMediaInfo, .jfmod-missingMeta') && 'meta line')
                || (meta.parentElement.classList.contains('listItemBody') && 'last line') || 'elsewhere',
            visible: meta.getBoundingClientRect().width > 0, ellipsis: getComputedStyle(meta).textOverflow
        } : null,
        bars: row.querySelectorAll('.jfmod-dlBar, .jfmod-dlRowBar').length,
        oldFigure: row.querySelectorAll('.jfmod-dlRowFigure, .jfmod-dlFigure').length,
        failedButton: cloud && row.classList.contains('jfmod-dlRow--failed') ? {
            shown: getComputedStyle(cloud).display !== 'none', button: cloud.tagName === 'BUTTON', disabled: cloud.disabled === true, title: cloud.title, tabIndex: cloud.tabIndex,
            cursor: getComputedStyle(cloud).cursor,
            glyphHidden: getComputedStyle(cloud.querySelector('.jfmod-markGlyph')).display === 'none',
            bang: /svg/.test(before.backgroundImage) && before.width !== '0px', bangColour: /%23ff5a4f/.test(before.backgroundImage) ? 'dark' : /%23c62828/.test(before.backgroundImage) ? 'light' : null
        } : null,
        noneShown: !!cloud && getComputedStyle(cloud).display !== 'none'
    };
}), END_SLOT);

const findRow = (rows, ...ids) => rows.find(row => ids.some(id => id && (row.id ?? '').replace(/-/g, '').toLowerCase() === id.replace(/-/g, '').toLowerCase()));

const INERT_PROPS = ['backgroundColor', 'boxShadow', 'outlineStyle', 'transform', 'opacity', 'color', 'filter'];

/**
 * A disc or mark that is no control (P1.FU19, user 2026-10-13): its computed look (background, shadow, outline, transform,
 * opacity, colour, its ::before veil) is the same under the mouse as without it, the pointer is the default arrow, it is no focus
 * stop (a decorative button may hold it: `holder`; an administrator's row button is disabled while a failure takes it, P1.FU22),
 * and its tooltip stays. Desktop only.
 */
async function checkInert(page, label, what, locator, holder = false) {
    if (!await locator.count()) { record(label, `${what}: present`, 'NOT VERIFIED', 'not on the page'); return; }
    const read = () => locator.first().evaluate((node, props) => {
        const own = getComputedStyle(node);
        const veil = getComputedStyle(node, '::before');
        const titled = node.getAttribute('title') ?? node.querySelector('[title]')?.getAttribute('title');
        return { styles: props.map(prop => own[prop]).join(' | '), veil: `${veil.content} ${veil.opacity} ${veil.backgroundColor}`,
            cursor: own.cursor, title: titled, tag: node.tagName, tabIndex: node.tabIndex, disabled: node.disabled === true };
    }, INERT_PROPS);
    await locator.first().scrollIntoViewIfNeeded().catch(() => {});
    await page.mouse.move(1, 1);
    await page.waitForTimeout(400);
    const before = await read();
    const box = await locator.first().boundingBox();
    if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(450);
    const after = await read();
    await page.mouse.move(1, 1);
    record(label, `${what}: no hover look (nothing changes under the mouse), no pointer, no focus stop, the tooltip kept`, !!box
        && after.styles === before.styles && after.veil === before.veil && before.cursor === 'default' && after.cursor === 'default'
        && !!before.title && (before.tabIndex < 0 || before.disabled) && (holder || before.tag !== 'BUTTON' || before.disabled), { before, after });
}

async function run(browser, layout) {
    const label = `${layout}, ${tier}`;
    const tv = !!LAYOUTS[layout].tv;
    const options = { ...LAYOUTS[layout] };
    delete options.tv;
    const context = await browser.newContext(options);
    const page = await context.newPage();
    const errors = [];
    const shot = (name, fullPage = false) => page.screenshot({ path: `${SHOTS}/cp-${tier}-${layout}-${name}.png`, fullPage }).catch(() => {});
    const shotOf = (locator, name) => locator.first().screenshot({ path: `${SHOTS}/cp-${tier}-${layout}-${name}.png` }).catch(() => {});
    page.on('pageerror', error => errors.push(String(error.message).slice(0, 200)));
    let answer = { items: [], totalRecordCount: 0, generatedAt: now(), clientStatus: { reachable: true, checkedAt: now(), reason: null },
        importEnabled: true, seedReleaseEnabled: true };
    const setItems = items => { answer = { ...answer, items, totalRecordCount: items.length }; };
    const reads = [];
    await page.route(url => /\/JellyfinMod\/Queue$/i.test(url.pathname), route => {
        if (route.request().method() !== 'GET') return route.continue();
        reads.push(Date.now());
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...answer, generatedAt: now() }) });
    });
    try {
        await serveLocal(page);
        await signIn(page);
        if (tv) {
            await page.evaluate(() => localStorage.setItem('layout', 'tv'));
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } }, undefined, { timeout: 30000 });
        }
        const health = await apiGet(page, 'JellyfinMod/Health');
        const capabilities = health?.Capabilities ?? health?.capabilities ?? [];
        if (!capabilities.includes('queue')) { record(label, 'the plugin serves the queue', 'NOT VERIFIED', capabilities); return; }

        // Opening the series page loads its full TMDB list once (P1.FU9); read the entry after that.
        let detail = await apiGet(page, 'JellyfinMod/Entries/' + seriesEntryId);
        if (detail?.entry.mediaType !== 'series') throw new Error('JELLYFINMOD_CP_SERIES is not a series entry');
        const seriesId = detail.entry.jellyfinItemId;
        if (!seriesId) throw new Error('the series entry has no Jellyfin item');
        await go(page, `#/details?id=${seriesId}`);
        await page.waitForSelector('.page:not(.hide) #listChildrenCollapsible .itemsContainer .card', { timeout: 30000 });
        await page.waitForTimeout(2500);
        detail = await apiGet(page, 'JellyfinMod/Entries/' + seriesEntryId);
        const seasons = await page.evaluate(async id => (await ApiClient.getSeasons(id, { userId: ApiClient.getCurrentUserId() })).Items
            .map(item => ({ id: item.Id, number: item.IndexNumber })), seriesId);
        const native = seasons.find(season => season.number > 0 && detail.episodes.filter(episode => episode.seasonNumber === season.number).length >= 2);
        if (!native) throw new Error('no Jellyfin season with two plugin episodes');
        const inSeason = detail.episodes.filter(episode => episode.seasonNumber === native.number).sort((a, b) => a.episodeNumber - b.episodeNumber);
        const held = new Set(seasons.map(season => season.number));
        const missingSeason = [...new Set(detail.episodes.map(episode => episode.seasonNumber))].find(number => number > 0 && !held.has(number));
        const entry = detail.entry;

        // The native season: E[0] downloading on its own; E[1] its own file of a season pack (1.2 GB at 42%, the pack at 2 MB/s:
        // 696 MB left, 348 s, "6 min left"); E[2] queued, E[3] importing, E[4] stalled, E[5] failed.
        const SEASON = [
            { state: 'downloading', progress: 0.42, etaSeconds: 720, downloadRateBytes: 3100000, meta: '42% · 12 min left',
                tooltip: 'Downloading · 42% · 12 min left · 3 MB/s', kind: 'downloading', percent: 42 },
            { pack: true, meta: '42% · 6 min left', tooltip: 'Downloading · 42% · 6 min left · 2 MB/s', kind: 'downloading', percent: 42 },
            { state: 'queued', meta: 'queued', tooltip: 'Queued', kind: 'queued' },
            { state: 'linking', progress: 1, meta: 'importing…', tooltip: 'Importing…', kind: 'importing' },
            { state: 'stalled', progress: 0.3, meta: '30% · stalled', tooltip: 'Stalled at 30%', kind: 'stalled', percent: 30 },
            { state: 'failed', progress: 0.1, message: 'No space left on the download disk.', meta: 'Failed · No space left on the download disk.',
                tooltip: 'Failed · No space left on the download disk.', kind: 'failed' }
        ].slice(0, inSeason.length);
        const seasonItems = [];
        SEASON.forEach((fixture, index) => {
            const episode = inSeason[index];
            if (fixture.pack) {
                seasonItems.push(queueRow(entry, { state: 'downloading', progress: 0.5, etaSeconds: 3900, downloadRateBytes: 2000000,
                    pack: { scope: 'season', label: `Season ${native.number} pack`, mode: 'add',
                        episodes: [packEpisode(episode, { importState: 'waiting', progress: 0.42, sizeBytes: 1200000000 })] } }));
            } else {
                seasonItems.push(queueRow(entry, { episode: episodeRef(episode), ...fixture }));
            }
        });
        // The season card: the mean of its episodes on their way, the pack's whole torrent (50%) for E[1]: (42+50+0+100+30)/5.
        const counted = [42, 50, 0, 100, 30].slice(0, Math.min(5, inSeason.length));
        const seasonMean = Math.floor(counted.reduce((sum, value) => sum + value, 0) / counted.length);
        const seasonTooltip = inSeason.length >= 2 ? `Downloading · ${seasonMean}% · 1 h 05 min left · 5 MB/s` : `Downloading · ${seasonMean}% · 12 min left · 3 MB/s`;

        // The pack's episodes on the missing season, each with its own file (P4.FU5).
        const PACK_OWN = [
            { importState: 'scanning', progress: 1, meta: 'importing…', kind: 'importing' },
            { importState: 'waiting', progress: 0.42, sizeBytes: 1200000000, meta: '42% · 6 min left', kind: 'downloading' },
            { importState: 'waiting', progress: 0.1, meta: '10%', kind: 'downloading' },
            { importState: 'waiting', progress: 1, meta: 'importing…', kind: 'importing' },
            { importState: 'waiting', progress: 0, meta: 'queued', kind: 'queued' },
            { importState: 'blocked', reason: 'source_missing', progress: 0.3, meta: 'Failed · The downloaded file could not be found.', kind: 'failed' }
        ];
        const packEpisodes = missingSeason === undefined ? [] : detail.episodes.filter(episode => episode.seasonNumber === missingSeason)
            .sort((a, b) => a.episodeNumber - b.episodeNumber);
        const packExpected = packEpisodes.map((episode, index) => ({ episode, ...(PACK_OWN[index] ?? { importState: null, progress: null, meta: 'queued', kind: 'queued' }) }));
        const packItems = missingSeason === undefined ? [] : [queueRow(entry, { state: 'downloading', progress: 0.6, etaSeconds: 3900,
            downloadRateBytes: 2000000, pack: { scope: 'season', label: `Season ${missingSeason} pack`, mode: 'fill',
                episodes: packExpected.map(({ episode, ...own }) => packEpisode(episode, own)) } })];

        const movieDetail = movieEntryId ? await apiGet(page, 'JellyfinMod/Entries/' + movieEntryId) : null;
        const movie = movieDetail?.entry?.mediaType === 'movie' && movieDetail.entry.jellyfinItemId ? movieDetail.entry : null;
        const movieRow = (state, extra = {}) => (movie ? [queueRow(movie, { state, intent: 'addVersion', ...extra })] : []);
        const movieDownloading = () => movieRow('downloading', { progress: 0.25, etaSeconds: 300 });
        setItems([...seasonItems, ...packItems, ...movieDownloading()]);

        // ---- The series page: season cards.
        reads.length = 0;
        await go(page, '#/home');
        await go(page, `#/details?id=${seriesId}`);
        await page.waitForSelector('.page:not(.hide) #listChildrenCollapsible .itemsContainer .card', { timeout: 30000 });
        await page.waitForFunction(id => !!document.querySelector(`.page:not(.hide) .card[data-id="${id}"] .jfmod-dlmark`), native.id, { timeout: 20000 })
            .catch(() => {});
        await page.waitForTimeout(1000);
        const opened = reads.length;
        const nativeCard = `.page:not(.hide) #listChildrenCollapsible .card[data-id="${native.id}"]`;
        const season = await cardState(page, nativeCard);
        record(label, `Season ${native.number} card: the amber bar at the poster's bottom, ${seasonMean}% (the mean of its episodes on their way), 0.24em`,
            !!season?.bar && season.atBottom && Math.abs(season.percent - seasonMean) <= 1 && season.colour === AMBER
            && Math.abs(season.heightEm - 0.24) < 0.03 && season.upstreamBarHidden, season);
        record(label, `Season ${native.number} card: the 1.6em disc top right, the arrow bobbing, the white arc at ${seasonMean}%`,
            season?.disc?.card && season.disc.kind === 'downloading' && Math.abs(season.disc.sizeEm - 1.6) < 0.05 && season.disc.topRight
            && season.disc.colour === WHITE && season.disc.arcColour === WHITE && season.disc.glyphAnimation === 'jfmod-dlmarkBob'
            && Math.abs((season.disc.arc?.offset ?? -1) - (100 - seasonMean)) <= 1, season?.disc);
        // P4.FU7: the top bar's glass (a tinted ground over a blur) on the computer and the phone, the solid black 66 % on the TV.
        const filter = season?.disc?.backdrop ?? '';
        if (layout === 'tv1080') {
            record(label, `Season ${native.number} card: the TV's disc is solid black 66 %, no blur`,
                season?.disc?.background === 'rgba(0, 0, 0, 0.66)' && filter === 'none', season?.disc);
        } else {
            record(label, `Season ${native.number} card: the disc is the top bar's glass (12 % tint, blur 12px)`,
                /blur\(12px\)/.test(filter) && /saturate\(1\.8\)/.test(filter) && /contrast\(0\.7\)/.test(filter)
                && /brightness\(0\.85\)/.test(filter) && /[,/] 0\.12\)$/.test(season?.disc?.background ?? ''), season?.disc);
        }
        record(label, `Season ${native.number} card: the tooltip is the figure ("${seasonTooltip}")`, season?.disc?.title === seasonTooltip, season?.disc?.title);
        if (layout === 'desktop') await checkInert(page, label, `Season ${native.number} card's download disc`, page.locator(`${nativeCard} .jfmod-dlmark`));
        if (season?.pill) {
            record(label, `Season ${native.number} card: two icons, the disc first of upstream's indicators and left of the plain count pill (no arrow in it)`,
                season.disc?.firstIndicator === true && season.pill.discLeft && !season.pill.arrow && /^\d+$/.test(season.pill.text), season.pill);
        } else {
            record(label, `Season ${native.number} card: the disc first of upstream's indicators (no count pill on this card)`,
                season?.disc?.firstIndicator !== false, { tick: season?.tick, firstIndicator: season?.disc?.firstIndicator });
        }
        const others = await page.evaluate(id => [...document.querySelectorAll('.page:not(.hide) #listChildrenCollapsible .card[data-id]')]
            .filter(card => card.getAttribute('data-id') !== id && !card.classList.contains('jfmod-missingCard'))
            .map(card => !!card.querySelector('.jfmod-dlCardBar, .jfmod-dlmark')), native.id);
        record(label, 'the other upstream season cards show no download', others.every(shown => !shown), others);
        await page.locator(nativeCard).scrollIntoViewIfNeeded().catch(() => {});
        await shotOf(page.locator(nativeCard), 'card-season-two-icons');
        await shot('series-page');
        if (missingSeason !== undefined) {
            const missingCard = `.page:not(.hide) .jfmod-missingCard[data-jfmod-season="${missingSeason}"]`;
            const pack = await cardState(page, missingCard);
            record(label, `missing Season ${missingSeason} card with a pack: the disc alone in the corner, a 60% bar, Not Downloaded hidden (never both)`,
                !!pack?.disc?.visible && pack.disc.kind === 'downloading' && pack.disc.topRight && Math.abs(pack.percent - 60) <= 1 && !pack.noneShown
                && pack.disc.title === 'Downloading · 60% · 1 h 05 min left · 2 MB/s', pack);
            await page.locator(missingCard).scrollIntoViewIfNeeded().catch(() => {});
            await shotOf(page.locator(missingCard), 'card-missing-season');
        } else {
            record(label, 'a missing season card with a pack on its way', 'NOT VERIFIED', 'the series has no season Jellyfin lacks');
        }

        // Reduced motion: the arrow rests.
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.waitForTimeout(300);
        const still = await cardState(page, nativeCard);
        record(label, 'reduced motion: the card disc\'s arrow rests', still?.disc?.glyphAnimation === 'none', still?.disc);
        await page.emulateMedia({ reducedMotion: 'no-preference' });

        // Polling: every 5 s while something on the page is on its way.
        const before = reads.length;
        await page.waitForTimeout(11000);
        const polled = reads.length - before;
        record(label, 'one queue read when the page opens, then every 5 s while something is on its way', opened >= 1 && opened <= 2
            && polled >= 2 && polled <= 3, { opened, polledIn11s: polled });

        // ---- The pack's episodes on the mod's season page, each with its own file.
        const serverId = await page.evaluate(() => ApiClient.serverId());
        if (missingSeason !== undefined) {
            await go(page, `#/details?entryId=${encodeURIComponent(entry.id)}&serverId=${encodeURIComponent(serverId)}&season=${missingSeason}`);
            await page.waitForFunction(count => document.querySelectorAll('.page:not(.hide) .jfmod-dlRow').length >= count, packExpected.length,
                { timeout: 30000 }).catch(() => {});
            await page.waitForTimeout(800);
            const packRows = await rowStates(page);
            await shot('rows-pack-season', true);
            for (const expected of packExpected) {
                const row = findRow(packRows, expected.episode.id);
                const failed = expected.kind === 'failed';
                const discOk = failed ? !row?.disc && row?.failedButton?.shown && row.failedButton.bang && row.failedButton.glyphHidden :
                    row?.disc?.kind === expected.kind && row.disc.firstOfEnd && row.disc.atEnd && !row.noneShown;
                record(label, `pack Season ${missingSeason} E${expected.episode.episodeNumber}: its own "${expected.meta}" on the meta line, the ${failed ? 'red bang on Not Downloaded' : expected.kind + ' disc'}, no bar`,
                    !!row && row.meta?.text === expected.meta && row.meta.where !== 'elsewhere' && row.bars === 0 && row.oldFigure === 0 && !!discOk, row);
            }
        } else {
            record(label, 'a pack\'s episodes with their own progress', 'NOT VERIFIED', 'the series has no season Jellyfin lacks');
        }

        // ---- The native season page's rows (native and mod rows).
        await go(page, `#/details?id=${native.id}`);
        await page.waitForSelector('.page:not(.hide) #listChildrenCollapsible .itemsContainer .listItem', { timeout: 30000 });
        await page.waitForFunction(count => document.querySelectorAll('.page:not(.hide) .jfmod-dlRow').length >= count, SEASON.length,
            { timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(1000);
        const rows = await rowStates(page);
        await page.locator('.page:not(.hide) .jfmod-dlRow').first().scrollIntoViewIfNeeded().catch(() => {});
        await shot('rows-season-dark', true);
        const itemOf = new Map((await page.evaluate(async ([seriesItem, seasonItem]) => (await ApiClient.getEpisodes(seriesItem,
            { seasonId: seasonItem, userId: ApiClient.getCurrentUserId() })).Items.map(item => [item.IndexNumber, item.Id]),
        [seriesId, native.id])));
        for (const [index, expected] of SEASON.entries()) {
            const episode = inSeason[index];
            const row = findRow(rows, itemOf.get(episode.episodeNumber), episode.id);
            const kind = row?.id && itemOf.get(episode.episodeNumber) && row.id.replace(/-/g, '') === itemOf.get(episode.episodeNumber).replace(/-/g, '') ? 'native' : 'mod';
            let discOk;
            if (expected.kind === 'failed' && row?.failedButton) {
                discOk = !row.disc && row.failedButton.shown && row.failedButton.bang && row.failedButton.bangColour === 'dark'
                    && row.failedButton.title === expected.tooltip && (!row.failedButton.button || row.failedButton.disabled)
                    // The TV layout hides the pointer on its buttons (`cursor: none`).
                    && (row.failedButton.tabIndex < 0 || row.failedButton.disabled) && (row.failedButton.cursor === 'default' || (tv && row.failedButton.cursor === 'none'));
            } else {
                discOk = row?.disc?.row && row.disc.kind === expected.kind && Math.abs(row.disc.sizeEm - 2.78) < 0.05 && row.disc.firstOfEnd
                    && row.disc.atEnd && row.disc.title === expected.tooltip && row.disc.background === 'rgba(0, 0, 0, 0)' && !row.noneShown
                    && row.disc.colour === (expected.kind === 'failed' ? RED_DARK : AMBER)
                    && (expected.percent === undefined || Math.abs(row.disc.arcOffset - (100 - expected.percent)) <= 1);
            }
            record(label, `season page E${episode.episodeNumber} (${kind} row): ${expected.kind === 'failed' && row?.failedButton ? 'the red bang takes Not Downloaded, an indicator' : 'the ' + expected.kind + ' disc (2.78em) first in the end slot'}, "${expected.meta}" on the meta line, no bar, no figure left of the icons`,
                !!row && !!discOk && row.meta?.text === expected.meta && row.meta.where !== 'elsewhere' && row.meta.visible && row.bars === 0
                && row.oldFigure === 0 && /tabular-nums/.test(row.meta.tabular ?? '')
                && (expected.kind === 'queued' || expected.kind === 'failed' || row.meta.colour === (expected.kind === 'stalled' ? META_STALLED_DARK : META_DARK))
                && (expected.kind !== 'failed' || row.meta.colour === META_FAILED_DARK), row);
        }
        const failedNative = SEASON.findIndex(fixture => fixture.kind === 'failed');
        if (failedNative < 0) record(label, 'a failed row', 'NOT VERIFIED', 'the season has fewer than six plugin episodes');

        // The light scheme (the theme attribute set in this page only).
        await page.evaluate(() => { window.jfmodTheme = document.documentElement.getAttribute('data-theme'); document.documentElement.setAttribute('data-theme', 'light'); });
        await page.waitForTimeout(300);
        const light = await rowStates(page);
        await shot('rows-season-light', true);
        const lightDownloading = light.find(row => row.meta?.text === '42% · 12 min left');
        const lightStalled = light.find(row => row.meta?.text === '30% · stalled');
        const lightFailed = light.find(row => row.meta?.text?.startsWith('Failed · '));
        record(label, 'light scheme: the figure is the darker amber (#9a6700, stalled #8d5a00), the disc keeps #ffb300, a failure #c62828',
            lightDownloading?.meta?.colour === META_LIGHT && lightDownloading.disc?.colour === AMBER
            && (!lightStalled || lightStalled.meta.colour === META_STALLED_LIGHT)
            && (!lightFailed || lightFailed.meta.colour === RED_LIGHT) && (!lightFailed?.failedButton || lightFailed.failedButton.bangColour === 'light')
            && (!lightFailed?.disc || lightFailed.disc.colour === RED_LIGHT), { lightDownloading, lightStalled, lightFailed });
        await page.evaluate(() => document.documentElement.setAttribute('data-theme', window.jfmodTheme ?? 'dark'));

        // P1.FU19: the row disc is upstream's round row button's size (user 2026-10-13: "make the episode [state icon] the same
        // size as info and fav and heart icons"); no disc or failure mark changes under the mouse, and the failure is no stop.
        const size = await page.evaluate(() => {
            const box = node => { const rect = node.getBoundingClientRect(); return { w: rect.width, h: rect.height, cy: rect.top + rect.height / 2 }; };
            const row = [...document.querySelectorAll('.page:not(.hide) #listChildrenCollapsible .listItem.jfmod-dlRow')].find(candidate => candidate.querySelector('.jfmod-dlmark'));
            const disc = row?.querySelector('.jfmod-dlmark');
            const heart = [...document.querySelectorAll('.page:not(.hide) #listChildrenCollapsible .listItem button.listItemButton')].find(button => button.getBoundingClientRect().width > 0);
            const font = disc ? parseFloat(getComputedStyle(disc).fontSize) : 0;
            return disc ? { disc: box(disc), glyph: box(disc.querySelector('.jfmod-dlmark-glyph')), font,
                heart: heart ? { box: box(heart), glyph: box(heart.querySelector('.material-icons, svg')), cy: box(heart).cy } : null } : null;
        });
        if (size) {
            const near = (a, b) => Math.abs(a - b) <= 0.6;
            const expectedBox = size.heart ? size.heart.box.w : size.font * (1.6695652173913 + 1.112);
            const expectedGlyph = size.heart ? size.heart.glyph.w : size.font * 1.6695652173913;
            record(label, `season page row disc: the box and glyph of upstream's round row buttons${size.heart ? ' (measured on the row\'s heart, More or info), centred on the same line' : ' (upstream\'s formula; upstream draws no round buttons on TV rows)'}`,
                near(size.disc.w, expectedBox) && near(size.disc.h, expectedBox) && near(size.glyph.w, expectedGlyph) && near(size.glyph.h, expectedGlyph)
                && (!size.heart || Math.abs(size.disc.cy - size.heart.cy) <= 1.5), { ...size, expectedBox, expectedGlyph });
            await shotOf(page.locator('.page:not(.hide) #listChildrenCollapsible .listItem.jfmod-dlRow').first(), 'row-disc-size');
        } else {
            record(label, 'season page row disc size', 'NOT VERIFIED', 'no row with a disc');
        }
        if (layout === 'desktop') {
            await checkInert(page, label, 'a season page row\'s download disc', page.locator('.page:not(.hide) .listItem .jfmod-dlmark'));
            await checkInert(page, label, 'a failed row\'s red bang', page.locator('.page:not(.hide) .jfmod-dlRow--failed .jfmod-mark--none'));
        }

        // ---- The episode detail line: E[1]'s own file of the pack.
        const packedItem = inSeason[1] && itemOf.get(inSeason[1].episodeNumber);
        if (packedItem) {
            await go(page, `#/details?id=${packedItem}`);
            await page.waitForSelector('.page:not(.hide) .jfmod-queueStatusLine', { timeout: 20000 }).catch(() => {});
            await page.waitForTimeout(800);
            const line = await page.evaluate(() => {
                const node = document.querySelector('.page:not(.hide) .jfmod-queueStatusLine');
                const disc = node?.querySelector('.jfmod-dlmark');
                return node ? { text: node.textContent.replace(/\s+/g, ' ').trim(), disc: disc?.getAttribute('data-jfmod-kind') ?? null,
                    discFirst: node.firstElementChild === disc, title: disc?.title ?? null, link: !!node.querySelector('a[href="#/catalog/queue"]') } : null;
            });
            record(label, 'episode detail line: the disc, then "In the download queue · 42% · 6 min left · View queue"',
                line?.disc === 'downloading' && line.discFirst && line.text === 'In the download queue · 42% · 6 min left · View queue' && line.link, line);
            await page.locator('.page:not(.hide) .jfmod-queueStatusLine').scrollIntoViewIfNeeded().catch(() => {});
            await shotOf(page.locator('.page:not(.hide) .jfmod-queueStatusLine'), 'detail-line');
        } else {
            record(label, 'the episode detail line', 'NOT VERIFIED', 'the season\'s second episode has no Jellyfin item');
        }

        // ---- The release picker's added row: the disc in the Add slot, the X kept, the figure, no bar.
        const pickerItem = itemOf.get(inSeason[0].episodeNumber);
        if (pickerItem) {
            const opId = uuid(7000);
            const hash = 'a'.repeat(40);
            const searchAnswer = () => {
                const found = pickerSearch(inSeason[0].id);
                found.target = { ...found.target, entryId: entry.id, episodeId: inSeason[0].id };
                found.candidates = found.candidates.map((candidate, index) => (index === 2 ? { ...candidate, infoHash: hash } : candidate));
                found.grab = { ...found.grab, activeOperationId: opId };
                return found;
            };
            const op = { id: opId, state: 'accepted', active: false, cancellable: false, entryId: entry.id, episodeId: inSeason[0].id,
                releaseTitle: searchAnswer().candidates[2].rawTitle, indexerName: 'TorrentGalaxy', quality: '1080p', size: 4.6e9, infoHash: hash, score: 820,
                seedRatio: null, seedMinutes: null, holdUntil: now(), createdAt: now(), updatedAt: now(), submittedAt: now(), acceptedAt: now(),
                cancelledAt: null, failureCode: null, message: '', openUrl: null, scope: 'episode', mode: 'add' };
            await page.route(/\/JellyfinMod\/Releases\?/, route => route.fulfill({ json: searchAnswer() }));
            await page.route(/\/JellyfinMod\/Releases\/Progress\//, route => route.fulfill({ status: 404, json: {} }));
            await page.route(/\/JellyfinMod\/Grabs\//, route => route.fulfill({ json: op }));
            setItems([...seasonItems, ...packItems, ...movieDownloading(), queueRow(entry, { episode: episodeRef(inSeason[0]), state: 'downloading',
                progress: 0.42, etaSeconds: 720, downloadRateBytes: 3100000, grabId: opId })]);
            await go(page, `#/details?id=${pickerItem}`);
            await page.locator('.page:not(.hide) .mainDetailButtons .jfmod-getRelease').first().click({ timeout: 20000 });
            await page.waitForSelector('.jfmod-releaseDialog .jfmod-releaseItem--added .jfmod-dlmark', { timeout: 20000 }).catch(() => {});
            await page.waitForTimeout(800);
            const added = await page.evaluate(() => {
                const item = document.querySelector('.jfmod-releaseDialog .jfmod-releaseItem--added');
                const disc = item?.querySelector('[data-jfmod-release-add] .jfmod-dlmark');
                return item ? { disc: disc?.getAttribute('data-jfmod-kind') ?? null, title: disc?.title ?? null, x: !!item.querySelector('[data-jfmod-release-x]'),
                    figure: item.querySelector('.jfmod-addedFigure')?.textContent ?? null, bars: item.querySelectorAll('.jfmod-dlBar, .jfmod-addedBar').length } : null;
            });
            record(label, 'release picker\'s added row: the disc in the Add slot, the X kept, "42% · 12 min left" on the marks line, no bar',
                added?.disc === 'downloading' && added.x && added.figure === '42% · 12 min left' && added.bars === 0
                && added.title === 'Downloading · 42% · 12 min left · 3 MB/s', added);
            if (layout === 'desktop') {
                // P1.FU19 (user 2026-10-13: "I don't think we need highlight / hover over non clickable icon"): the Add slot that holds
                // the disc changes nothing under the mouse; the X, a control, keeps its veil.
                await checkInert(page, label, 'release picker\'s added row: the Add slot holding the disc', page.locator('.jfmod-releaseDialog .jfmod-releaseItem--added [data-jfmod-release-add]'), true);
                const x = page.locator('.jfmod-releaseDialog .jfmod-releaseItem--added [data-jfmod-release-x]');
                if (await x.count()) {
                    const veil = () => x.first().evaluate(node => getComputedStyle(node, '::before').opacity);
                    await page.mouse.move(1, 1);
                    await page.waitForTimeout(300);
                    const atRest = await veil();
                    await x.first().hover();
                    await page.waitForTimeout(400);
                    const hovered = await veil();
                    record(label, 'release picker\'s added row: the X keeps its hover veil', atRest === '0' && Number(hovered) > 0, { atRest, hovered });
                    await page.mouse.move(1, 1);
                }
            }
            await shotOf(page.locator('.jfmod-releaseDialog .jfmod-releaseItem--added'), 'picker-added-row');
            await shot('picker');
            await page.keyboard.press('Escape');
            await page.waitForTimeout(600);
            await page.unroute(/\/JellyfinMod\/Releases\?/);
            await page.unroute(/\/JellyfinMod\/Releases\/Progress\//);
            await page.unroute(/\/JellyfinMod\/Grabs\//);
            setItems([...seasonItems, ...packItems, ...movieDownloading()]);
        } else {
            record(label, 'the release picker\'s added row', 'NOT VERIFIED', 'the season\'s first episode has no Jellyfin item');
        }

        // ---- The Queue page: the disc in each row's state cell, the progress bar kept.
        await go(page, '#/catalog/queue');
        await page.waitForSelector('.jfmod-queueRow, .jfmod-queueTableRow', { timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(800);
        const queueRows = await page.evaluate(() => [...document.querySelectorAll('.page:not(.hide) .jfmod-queueRow, .page:not(.hide) .jfmod-queueTableRow')]
            .map(row => ({ disc: row.querySelector('.jfmod-queueState--disc .jfmod-dlmark')?.getAttribute('data-jfmod-kind') ?? null,
                bar: !!row.querySelector('[role="progressbar"]'), word: row.querySelector('.jfmod-queueState:not(.jfmod-queueState--disc)')?.textContent ?? null })));
        const kinds = new Set(queueRows.map(row => row.disc));
        record(label, 'Queue page: the disc in place of the state word (downloading, queued, importing, stalled, failed), the progress bar kept',
            ['downloading', 'queued', 'importing', 'stalled', 'failed'].filter(kind => SEASON.some(fixture => fixture.kind === kind)).every(kind => kinds.has(kind))
            && queueRows.every(row => row.disc && !row.word) && queueRows.some(row => row.bar), queueRows);
        await shot('queue-page', true);

        // ---- The film card's states, in the movie's library grid; then the library list rows.
        const views = await page.evaluate(async () => (await ApiClient.getUserViews({}, ApiClient.getCurrentUserId())).Items
            .map(view => ({ id: view.Id, type: view.CollectionType })));
        const moviesView = views.find(view => view.type === 'movies');
        const showsView = views.find(view => view.type === 'tvshows');
        if (movie && moviesView) {
            const movieCard = `.page:not(.hide) .card[data-id="${movie.jellyfinItemId}"]`;
            await go(page, `#/movies?topParentId=${moviesView.id}`);
            await page.waitForSelector(movieCard, { timeout: 30000 }).catch(() => {});
            const STATES = [
                { kind: 'downloading', rows: movieDownloading(), title: 'Downloading · 25% · 5 min left', glyph: 'jfmod-dlmarkBob' },
                { kind: 'queued', rows: movieRow('queued'), title: 'Queued' },
                { kind: 'importing', rows: movieRow('scanning', { progress: 1 }), title: 'Importing…', arc: 'jfmod-dlmarkSpin' },
                { kind: 'stalled', rows: movieRow('stalled', { progress: 0.3 }), title: 'Stalled at 30%', dim: true }
            ];
            for (const state of STATES) {
                setItems(state.rows);
                await page.waitForFunction(([sel, kind]) => document.querySelector(sel + ' .jfmod-dlmark')?.getAttribute('data-jfmod-kind') === kind,
                    [movieCard, state.kind], { timeout: 12000 }).catch(() => {});
                await page.waitForTimeout(500);
                const card = await cardState(page, movieCard);
                record(label, `film card ${state.kind}: the ${state.kind} disc top right, tooltip "${state.title}", the bar`,
                    card?.disc?.kind === state.kind && card.disc.topRight && card.disc.title === state.title && card.bar
                    && (!state.glyph || card.disc.glyphAnimation === state.glyph) && (!state.arc || card.disc.arcAnimation === state.arc)
                    && (!state.dim || card.disc.arc?.opacity === '0.55') && (state.kind !== 'queued' || !card.disc.arc), card?.disc);
                await page.locator(movieCard).scrollIntoViewIfNeeded().catch(() => {});
                await shotOf(page.locator(movieCard), `card-film-${state.kind}`);
                if (state.kind === 'importing') {
                    await page.emulateMedia({ reducedMotion: 'reduce' });
                    await page.waitForTimeout(300);
                    const rest = await cardState(page, movieCard);
                    record(label, 'reduced motion: the importing arc rests', rest?.disc?.arcAnimation === 'none', rest?.disc);
                    await page.emulateMedia({ reducedMotion: 'no-preference' });
                }
            }
            setItems(movieRow('failed', { progress: 0.1, message: 'The torrent contains no video file.' }));
            await page.waitForFunction(sel => !document.querySelector(sel + ' .jfmod-dlmark'), movieCard, { timeout: 12000 }).catch(() => {});
            const failedCard = await cardState(page, movieCard);
            record(label, 'film card with a failed download: nothing drawn on the card', !failedCard?.disc && !failedCard?.bar, failedCard);

            // The library list views (the browser's own view setting, in this context only).
            await page.evaluate(([moviesId, showsId]) => {
                const list = { ShowTitle: true, ShowYear: true, ViewMode: 'list', ImageType: 'Primary', CardLayout: false, SortBy: ['SortName'],
                    SortOrder: 'Ascending', StartIndex: 0 };
                localStorage.setItem('movies - ' + moviesId, JSON.stringify(list));
                if (showsId) localStorage.setItem('series - ' + showsId, JSON.stringify(list));
            }, [moviesView.id, showsView?.id ?? null]);
            await go(page, '#/home');
            await go(page, `#/movies?topParentId=${moviesView.id}`);
            const movieListRow = `.page:not(.hide) .listItem[data-id="${movie.jellyfinItemId}"]`;
            await page.waitForSelector(movieListRow + '.jfmod-dlRow', { timeout: 20000 }).catch(() => {});
            await page.waitForTimeout(800);
            const listRows = await rowStates(page);
            const failedList = findRow(listRows, movie.jellyfinItemId);
            record(label, 'library list row (a film on disk) with a failed download: the red bang disc first in the end slot, "Failed · …" after its meta, no bar',
                failedList?.disc?.kind === 'failed' && failedList.disc.colour === RED_DARK && failedList.disc.firstOfEnd && failedList.bars === 0
                && failedList.meta?.text === 'Failed · The torrent contains no video file.' && failedList.meta.where !== 'elsewhere' && !failedList.failedButton, failedList);
            await page.locator(movieListRow).scrollIntoViewIfNeeded().catch(() => {});
            await shotOf(page.locator(movieListRow), 'row-list-failed');
            await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
            await page.waitForTimeout(300);
            const failedLight = findRow(await rowStates(page), movie.jellyfinItemId);
            record(label, 'light scheme: the failed disc is #c62828', failedLight?.disc?.colour === RED_LIGHT, failedLight?.disc);
            await shotOf(page.locator(movieListRow), 'row-list-failed-light');
            await page.evaluate(() => document.documentElement.setAttribute('data-theme', window.jfmodTheme ?? 'dark'));
        } else {
            record(label, 'the film card\'s states and the library list row', 'NOT VERIFIED', 'JELLYFINMOD_CP_MOVIE not given or without a Jellyfin item');
        }
        setItems([...seasonItems, ...packItems]);
        if (showsView) {
            await go(page, `#/tv?topParentId=${showsView.id}`);
            const seriesListRow = `.page:not(.hide) .listItem[data-id="${seriesId}"]`;
            await page.waitForSelector(seriesListRow + '.jfmod-dlRow', { timeout: 20000 }).catch(() => {});
            await page.waitForTimeout(800);
            const seriesRow = findRow(await rowStates(page), seriesId);
            if (!seriesRow && !(await page.locator(seriesListRow).count())) {
                record(label, 'library list row of the series', 'NOT VERIFIED', 'the shows library did not draw the series as a list row');
            } else {
                record(label, 'library list row (the series): the downloading disc first in the end slot, its figure after the meta, no bar',
                    seriesRow?.disc?.kind === 'downloading' && seriesRow.disc.firstOfEnd && seriesRow.bars === 0 && /^\d+% · /.test(seriesRow.meta?.text ?? '')
                    && seriesRow.meta.where !== 'elsewhere' && seriesRow.disc.title.startsWith('Downloading · '), seriesRow);
                await page.locator(seriesListRow).scrollIntoViewIfNeeded().catch(() => {});
                await shotOf(page.locator(seriesListRow), 'row-list-series');
            }
        }
        await page.evaluate(([moviesId, showsId]) => {
            if (moviesId) localStorage.removeItem('movies - ' + moviesId);
            if (showsId) localStorage.removeItem('series - ' + showsId);
        }, [moviesView?.id ?? null, showsView?.id ?? null]);

        // ---- The series' card in search and in its library grid; Home's Next Up when it shows one of the season's episodes.
        await go(page, `#/search?query=${encodeURIComponent(entry.title)}`);
        await page.waitForFunction(id => !!document.querySelector(`.page:not(.hide) .card[data-id="${id}"] .jfmod-dlmark`), seriesId, { timeout: 30000 })
            .catch(() => {});
        const seriesCard = await cardState(page, `.page:not(.hide) .card[data-id="${seriesId}"]`);
        await shotOf(page.locator(`.page:not(.hide) .card[data-id="${seriesId}"]`), 'card-series-search');
        record(label, 'search: the series card shows the bar and the downloading disc (two icons beside a count pill), the figure in its tooltip',
            !!seriesCard?.bar && seriesCard.colour === AMBER && seriesCard.disc?.kind === 'downloading' && seriesCard.disc.title.startsWith('Downloading · ')
            && (!seriesCard.pill || (seriesCard.pill.discLeft && !seriesCard.pill.arrow)), seriesCard);
        // The series page's own Next Up first, then Home's rows.
        const episodeIds = [...itemOf.values()];
        await go(page, `#/details?id=${seriesId}`);
        await page.waitForTimeout(2500);
        if (!await page.evaluate(ids => ids.some(id => document.querySelector(`.page:not(.hide) .card[data-type="Episode"][data-id="${id}"]`)), episodeIds)) {
            await go(page, '#/home');
        }
        await page.waitForFunction(ids => ids.some(id => document.querySelector(`.page:not(.hide) .card[data-id="${id}"] .jfmod-dlmark`)), episodeIds,
            { timeout: 15000 }).catch(() => {});
        const nextUp = await page.evaluate(ids => {
            const card = [...document.querySelectorAll('.page:not(.hide) .card[data-type="Episode"]')].find(node => ids.includes(node.getAttribute('data-id')));
            return card ? { id: card.getAttribute('data-id'), landscape: /backdrop|overflowBackdrop|thumb/i.test(card.className) } : null;
        }, episodeIds);
        if (nextUp) {
            const view = await cardState(page, `.page:not(.hide) .card[data-type="Episode"][data-id="${nextUp.id}"]`);
            record(label, 'a landscape Next Up episode card (series page or Home) shows its download disc, the figure in its tooltip', !!view?.disc?.visible && view.disc.topRight && view.disc.title.startsWith('Downloading · ') && !!view.bar, { nextUp, disc: view?.disc });
            await shotOf(page.locator(`.page:not(.hide) .card[data-type="Episode"][data-id="${nextUp.id}"]`), 'card-next-up');
        } else {
            record(label, 'a Next Up card with a download', 'NOT VERIFIED', 'neither the series page nor Home shows one of the season\'s episodes');
        }

        // Nothing on its way: the marks go and the queue is read once per page, not polled.
        setItems([]);
        await go(page, `#/details?id=${seriesId}`);
        await page.waitForTimeout(2000);
        const quietFrom = reads.length;
        await page.waitForTimeout(16000);
        const left = await page.evaluate(() => document.querySelectorAll('.jfmod-dlCard, .jfmod-dlRow, .jfmod-dlmark, .jfmod-dlMeta').length);
        record(label, 'nothing on its way: every mark is gone and the queue is not polled', left === 0 && reads.length - quietFrom <= 1,
            { left, readsIn16s: reads.length - quietFrom });
        record(label, 'no page errors', errors.length === 0, errors.slice(0, 3));
    } catch (error) {
        record(label, 'card progress run', 'NOT VERIFIED', String(error.message ?? error).slice(0, 300));
    } finally {
        await page.screenshot({ path: `${SHOTS}/cp-${tier}-${layout}-last.png` }).catch(() => {});
        await context.close();
    }
}

const args = localDist ? ['--disable-features=PrivateNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,LocalNetworkAccessChecks'] : [];
const browser = await chromium.launch(tier === 'chrome' ? { channel: 'chrome', args } : { args });
for (const layout of layouts) await run(browser, layout);
await browser.close();
const failed = results.filter(result => result.verdict === 'FAIL').length;
console.log(`\n${results.length} checks: ${results.filter(result => result.verdict === 'PASS').length} pass, ${failed} fail, `
    + `${results.filter(result => result.verdict === 'NOT VERIFIED').length} not verified (intercepted queue answers, not a live download${localDist ? '; LOCAL BUILD, not acceptance' : ''})`);
process.exit(failed ? 1 : 0);
