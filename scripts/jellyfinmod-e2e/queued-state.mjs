/* eslint-disable compat/compat, no-restricted-globals, sonarjs/cognitive-complexity, max-statements-per-line -- a Node acceptance runner, not shipped code */
/* global window, document, location, localStorage, sessionStorage, getComputedStyle, MutationObserver, ApiClient, requestAnimationFrame */
// The queued state from the moment a grab is made until its file is on disk (P4.FU10, user 2026-10-17: "it is better to show
// queued state than a wrong one"). LIVE, on a local environment only: real grabs through the plugin, the stand-ins' Torznab feed
// and Transmission (standins/standins.mjs, run on this Mac), a real import into a writable copy of the series, and real
// browsers signed in as oleksii with an empty password. Nothing is intercepted.
//
// Every page under test carries a sampler installed before the app's scripts: in the animation frame after every DOM mutation
// (before it is painted, so a state shown for one frame is caught) and every 100 ms it records the download state of every season-page row (`row:E3`), card
// (`card:Season 1`, `card:<title>`), the episode page's download block (`block`) and Queue page row (`queue:<title>`): the
// disc's kind (queued, downloading, stalled, importing, failed), `cloud` for a visible Not Downloaded, `unaired`, or `none`.
// The log survives reloads (sessionStorage). The checks read it back:
//   A1 one episode grabbed in the picker from its row: queued at once on the row, never the cloud; the episode page and the
//      Queue page say queued; downloading after the client reports progress; removed from the queue: the cloud again;
//   A2 another version of an episode (API grab, intent addVersion) and of the movie: queued at once on the row or card;
//   A3 a season pack grabbed by another device (API grab) while this page is open, a page reloaded inside the hold, a second
//      browser opened inside the hold, the held row cancelled from the Queue page: queued everywhere, then the cloud again;
//   A4 a pack whose handoff fails at the end of the hold (the client is down): queued, then the cloud again, nothing else;
//   B  the same as A3 on the phone and the TV layout (API grab, reload, second browser, cancel);
//   A5 a Season 2 pack (every episode a placeholder) grabbed in the picker on the series page, the season opened at once, a
//      second browser on the series page, a third on the Queue page and a fourth on an episode's page, all during the hold:
//      queued at once on every row and card, then each episode its own download, importing, and its file, with no cloud and no
//      step back on any surface; the row disc's tooltip and meta line are read where the pointer would rest while it runs.
//
//   JELLYFINMOD_TEST_URL=http://127.0.0.1:<port>/   a local environment (envs/, loopback only)
//   JELLYFINMOD_QS_SECRETS=<0600 env file>          the stand-ins' generated fixture credentials (never printed)
//   JELLYFINMOD_QS_STAGE=<folder>                   small clips: ps-s01e03.mkv … ps-s01e06.mkv, ps-s02e01.mkv … ps-s02e06.mkv,
//                                                  ps-s01e01-v2.mkv, hyh-v2.mkv (each its own encode, a few hundred kB)
//   [JELLYFINMOD_QS_CONTROL=http://127.0.0.1:38119] the stand-ins' control port
//   [JELLYFINMOD_QS_SERIES=Peep Show] [JELLYFINMOD_QS_TVDB=71656] [JELLYFINMOD_QS_MOVIE=Hack Your Health]
//   B8 (opt-in, not in the default steps): the stand-in Transmission's request count while an import waits for its download,
//      with and without a page polling the queue, and with nothing waiting.
//   [JELLYFINMOD_BROWSER=chromium|chrome] [JELLYFINMOD_QS_LAYOUTS=mobile,tv1080] [JELLYFINMOD_QS_STEPS=A1,A2,A3,A4,B,A5,B8]
//   [JELLYFINMOD_SHOTS=<folder>]
//
// Preconditions (envs/README.md): the series' folder is a writable copy under /test-media (its season has two episodes on disk
// and placeholders for the rest), the stand-ins run with STANDIN_DOWNLOADS at the environment's test-media/downloads folder.
// [JELLYFINMOD_QS_PREPARE=<the environment's host test-media folder> JELLYFINMOD_QS_SOURCE=<the series' host folder>] makes it
// from a fresh baseline: an APFS clone of the series into test-media/tv, the Shows library's other folders taken off, the
// episode list loaded and the placeholders written. The run changes the environment (library folders, the indexer's key,
// grabbing on, imported files): reset it to its baseline afterwards (envs/bin/reset-to-baseline.sh).
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const required = name => process.env[name] ?? (() => { throw new Error(`${name} is required`); })();
const origin = new URL(required('JELLYFINMOD_TEST_URL'));
if (!['127.0.0.1', 'localhost'].includes(origin.hostname)) throw new Error('Grabs for real: runs on a local environment only');
const WEB = new URL('/web/', origin).href;
const CONTROL = process.env.JELLYFINMOD_QS_CONTROL ?? 'http://127.0.0.1:38119';
const fixture = Object.fromEntries(readFileSync(required('JELLYFINMOD_QS_SECRETS'), 'utf8').split('\n')
    .filter(line => line.includes('=')).map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()]));
const STAGE = required('JELLYFINMOD_QS_STAGE');
const SERIES = process.env.JELLYFINMOD_QS_SERIES ?? 'Peep Show';
const TVDB = Number(process.env.JELLYFINMOD_QS_TVDB ?? 71656);
const MOVIE = process.env.JELLYFINMOD_QS_MOVIE ?? 'Hack Your Health';
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
const otherLayouts = (process.env.JELLYFINMOD_QS_LAYOUTS ?? 'mobile,tv1080').split(',').filter(Boolean);
const steps = new Set((process.env.JELLYFINMOD_QS_STEPS ?? 'A1,A2,A3,A4,B,A5').split(','));
const SHOTS = process.env.JELLYFINMOD_SHOTS ?? null;
// Optional: make the precondition from a fresh baseline (the environment's host test-media folder and the series' read-only folder).
const PREPARE_MEDIA = process.env.JELLYFINMOD_QS_PREPARE ?? null;
const PREPARE_SOURCE = process.env.JELLYFINMOD_QS_SOURCE ?? null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const LAYOUTS = {
    desktop: { viewport: { width: 1440, height: 900 } },
    mobile: {
        viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
    },
    tv1080: { viewport: { width: 1920, height: 1080 }, tv: true }
};
const TAG = 'JFMQS';
const PACK = `Peep.Show.S01.1080p.WEB-DL.AAC2.0.H.264-${TAG}`;
const EP3 = `Peep.Show.S01E03.720p.WEB-DL.AAC2.0.H.264-${TAG}`;
const EP1V2 = `Peep.Show.S01E01.720p.WEB-DL.AAC2.0.H.264-${TAG}`;
const MOVIEV2 = `Hack.Your.Health.The.Secrets.of.Your.Gut.2024.720p.WEB-DL.AAC2.0.H.264-${TAG}`;
const PACK2 = `Peep.Show.S02.1080p.WEB-DL.AAC2.0.H.264-${TAG}`;

const results = [];
const secretValues = Object.values(fixture).filter(value => value.length >= 8);
const scrub = value => {
    let text = JSON.stringify(value);
    for (const secret of secretValues) text = text.split(secret).join('<secret>');
    return text;
};
const record = (step, check, verdict, detail) => {
    const normalised = verdict === true ? 'PASS' : verdict === false ? 'FAIL' : verdict;
    results.push({ step, check, verdict: normalised });
    console.log(`${normalised} [${tier}] ${step}: ${check}${detail === undefined ? '' : ' :: ' + scrub(detail).slice(0, 900)}`);
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, { timeout = 60000, every = 250, label = 'condition' } = {}) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const value = await check();
        if (value) return value;
        await sleep(every);
    }
    throw new Error(`timed out after ${timeout / 1000}s waiting for ${label}`);
}

// ---- The server, as oleksii, over its real HTTP API ----
const CLIENT = 'MediaBrowser Client="JellyfinMod queued-state", Device="runner", DeviceId="jfmod-queued-state", Version="1.0"';
let token = null;
async function http(method, path, body) {
    const response = await fetch(new URL(path, origin), {
        method, headers: { Authorization: CLIENT + (token ? `, Token="${token}"` : ''), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    let parsed = text;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    return { status: response.status, body: parsed };
}
const ok = async (method, path, body) => {
    const answer = await http(method, path, body);
    if (answer.status >= 300) throw new Error(`${method} ${path.split('?')[0]} answered ${answer.status} ${scrub(answer.body).slice(0, 300)}`);
    return answer.body;
};
const control = async (path, body) => (await fetch(CONTROL + path, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) })).json();

// ---- The sampler, installed in every page before the app ----
function sampler() {
    const KEY = '__jfmodQs';
    const KINDS = ['queued', 'downloading', 'stalled', 'importing', 'failed'];
    const visible = element => !!element && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden'
        && getComputedStyle(element).display !== 'none' && !element.closest('.hide');
    const first = (root, selector) => Array.from(root.querySelectorAll(selector)).find(visible) ?? null;
    const markOf = element => {
        const disc = first(element, '.jfmod-dlmark');
        if (disc) return { state: KINDS.find(kind => disc.classList.contains('jfmod-dlmark--' + kind)) ?? 'disc', tip: disc.title };
        if (first(element, '.jfmod-mark--none')) return { state: element.classList.contains('jfmod-dlRow--failed') ? 'failed' : 'cloud' };
        if (first(element, '.jfmod-mark--unaired')) return { state: 'unaired' };
        return { state: 'none' };
    };
    const snapshot = () => {
        const out = {};
        for (const row of document.querySelectorAll('.listItem')) {
            if (!visible(row)) continue;
            const text = (row.querySelector('.listItemBodyText')?.textContent ?? row.textContent ?? '').trim();
            const number = /^(\d+)\.\s/.exec(text);
            if (!number) continue;
            const mark = markOf(row);
            const meta = first(row, '.jfmod-dlMeta');
            out['row:E' + number[1]] = mark.state + (meta ? '|' + meta.textContent : '') + (mark.tip ? '|' + mark.tip : '');
        }
        for (const card of document.querySelectorAll('.card')) {
            if (!visible(card)) continue;
            const name = (card.querySelector('.cardText')?.textContent ?? '').trim();
            if (!name || card.closest('.jfmod-releaseDialog')) continue;
            out['card:' + name] = markOf(card).state;
        }
        const block = first(document, '.jfmod-dlblock');
        if (block) out.block = block.getAttribute('data-jfmod-state');
        for (const row of document.querySelectorAll('.jfmod-queueTableRow, .jfmod-queueRow')) {
            if (!visible(row)) continue;
            const title = (row.querySelector('.jfmod-queueTitle')?.textContent ?? '').trim();
            const disc = first(row, '.jfmod-dlmark');
            out['queue:' + title] = disc ? KINDS.find(kind => disc.classList.contains('jfmod-dlmark--' + kind)) ?? 'disc'
                : (row.querySelector('.jfmod-queueState')?.textContent ?? '').trim();
        }
        return out;
    };
    let saved = [];
    try { saved = JSON.parse(sessionStorage.getItem(KEY) ?? '[]'); } catch { /* none */ }
    const log = saved;
    window.__qsLog = log;
    let last = '';
    const tick = () => {
        if (!document.body) return;
        const state = snapshot();
        const text = JSON.stringify(state);
        if (text === last) return;
        last = text;
        log.push({ t: Date.now(), h: location.hash, s: state });
    };
    window.__qsFlush = () => {
        try { sessionStorage.setItem(KEY, JSON.stringify(log)); } catch { /* full */ }
        return log;
    };
    window.addEventListener('pagehide', window.__qsFlush);
    // A change is sampled in the next animation frame, before it is painted: what one frame shows, not what a script changes
    // and changes back before the frame (two observers in one task).
    let frame = 0;
    const soon = () => {
        if (!frame) frame = requestAnimationFrame(() => { frame = 0; tick(); });
    };
    const start = () => {
        new MutationObserver(soon).observe(document.documentElement, { subtree: true, childList: true, attributes: true,
            attributeFilter: ['class', 'style', 'title', 'data-jfmod-state'], characterData: true });
        setInterval(tick, 100);
        tick();
    };
    if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start);
}

const browser = await chromium.launch(tier === 'chrome' ? { headless: true, channel: 'chrome' } : { headless: true });
const errors = [];
async function newSampledPage(layoutName = 'desktop') {
    const layout = LAYOUTS[layoutName];
    const context = await browser.newContext({ viewport: layout.viewport, isMobile: layout.isMobile, hasTouch: layout.hasTouch,
        userAgent: layout.userAgent, serviceWorkers: 'block' });
    await context.addInitScript(sampler);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(String(error.message).split('\n')[0]));
    await signIn(page);
    if (layout.tv) {
        await page.evaluate(() => localStorage.setItem('layout', 'tv'));
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } }, undefined, { timeout: 30000 });
        await page.waitForTimeout(2000);
    }
    page.layoutName = layoutName;
    return page;
}
async function signIn(page) {
    await page.goto(WEB, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.ApiClient, undefined, { timeout: 30000 });
    await page.waitForFunction(() => {
        try { return !!ApiClient.getCurrentUserId() || /login|selectuser|selectserver/.test(location.hash); } catch { return false; }
    }, undefined, { timeout: 30000 });
    if (await page.evaluate(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } })) return;
    const field = page.locator('#txtManualName');
    if (!await field.isVisible().catch(() => false)) {
        const chooser = page.locator('.btnManual').first();
        await chooser.waitFor({ state: 'attached', timeout: 20000 }).catch(() => undefined);
        if (await chooser.count()) await chooser.evaluate(node => node.click());
        await field.waitFor({ state: 'visible', timeout: 15000 });
    }
    await page.waitForTimeout(800);
    await field.fill('oleksii');
    await page.locator('#txtManualPassword').fill('');
    await page.locator('button:visible').filter({ hasText: 'Sign In' }).first().click();
    await page.waitForFunction(() => location.hash.startsWith('#/home'), undefined, { timeout: 30000 });
    await page.waitForTimeout(1200);
}
const go = (page, hash) => page.evaluate(target => { location.hash = target; }, hash);
const logOf = async page => page.evaluate(() => window.__qsLog ?? []);
const shot = async (page, name) => {
    if (SHOTS) await page.screenshot({ path: join(SHOTS, `qs-${tier}-${page.layoutName}-${name}.png`) }).catch(() => undefined);
};

/** The states one label took in a log between two times, consecutive repeats dropped: [{ t, v }] (v is the state, without words). */
const trace = (log, label, from, to = Infinity, { seed = false } = {}) => {
    const out = [];
    let previous = null;
    // `seed`: start with the state the label had when the window opened.
    const before = seed ? log.filter(entry => entry.t < from && entry.s[label] !== undefined).at(-1) : null;
    if (before) {
        previous = before.s[label].split('|')[0];
        out.push({ t: 0, v: previous, raw: before.s[label] });
    }
    for (const entry of log) {
        if (entry.t < from || entry.t > to) continue;
        const raw = entry.s[label];
        const value = raw === undefined ? null : raw.split('|')[0];
        if (value === previous) continue;
        previous = value;
        if (value !== null) out.push({ t: entry.t - from, v: value, raw });
    }
    return out;
};
const states = list => list.map(item => item.v);
const RANK = { queued: 1, downloading: 2, stalled: 2, importing: 3 };
/** No step back: queued, then downloading or stalled, then importing; `none` only once it is over (or before it is drawn). */
const monotonic = list => {
    let rank = 0;
    for (const item of list) {
        // A Queue page row's done is its seeding copy.
        if (item.v === 'none' || item.v === 'Seeding') { if (rank > 0) rank = 4; continue; }
        const next = RANK[item.v];
        if (next === undefined || next < rank) return false;
        if (rank === 4) return false;
        rank = next;
    }
    return true;
};

// ---- Fixture: the series, its season and episodes, the movie, the releases ----
const ids = {};
async function prepare() {
    const auth = await http('POST', '/Users/AuthenticateByName', { Username: 'oleksii', Pw: '' });
    if (auth.status !== 200) throw new Error('could not sign in as oleksii');
    token = auth.body.AccessToken;
    ids.user = auth.body.User.Id;
    if (PREPARE_MEDIA && PREPARE_SOURCE) await prepareLibrary();
    await control('/fault?service=txauth&mode=off');
    await control('/fault?service=tx&mode=ok');
    const [indexer] = (await ok('GET', '/JellyfinMod/Settings/Indexers')).filter(row => row.baseUrl.includes(':38111/'));
    if (!indexer) throw new Error('no stand-in indexer in the settings (envs/bin/seed-fixtures.sh)');
    if (!indexer.apiKeyConfigured || indexer.minIntervalSeconds > 1) {
        await ok('PATCH', `/JellyfinMod/Settings/Indexers/${indexer.id}`, { name: indexer.name, baseUrl: indexer.baseUrl,
            apiKey: indexer.apiKeyConfigured ? { action: 'unchanged' } : { action: 'replace', value: fixture.PROWLARR_KEY }, enabled: true,
            automateTitleMatches: indexer.automateTitleMatches, categories: indexer.categories, priority: indexer.priority, downloadHosts: indexer.downloadHosts,
            minimumSeedRatio: indexer.minimumSeedRatio, minimumSeedMinutes: indexer.minimumSeedMinutes, minIntervalSeconds: 1,
            dailyQueryBudget: indexer.dailyQueryBudget, revision: indexer.revision });
    }
    await ok('POST', `/JellyfinMod/Settings/Indexers/${indexer.id}/Test`);
    const [client] = (await ok('GET', '/JellyfinMod/Settings/DownloadClients')).filter(row => row.baseUrl.includes(':38112/'));
    await ok('POST', `/JellyfinMod/Settings/DownloadClients/${client.id}/Test`);
    let acquisition = await ok('GET', '/JellyfinMod/Settings/Acquisition');
    if (!acquisition.enabled) {
        acquisition = await ok('PATCH', '/JellyfinMod/Settings/Acquisition', { enabled: true, revision: acquisition.revision,
            downloadClientId: client.id, defaultQualityProfileId: acquisition.defaultQualityProfileId });
    }
    if (!acquisition.ready) throw new Error('acquisition not ready: ' + acquisition.blockers.join(', '));
    ids.hold = acquisition.holdSeconds;

    const entries = (await ok('GET', '/JellyfinMod/Entries?limit=200')).items;
    const series = entries.find(entry => entry.title === SERIES);
    const movie = entries.find(entry => entry.title.startsWith(MOVIE));
    if (!series || !movie) throw new Error('the local titles are missing');
    ids.series = series.id;
    ids.seriesItem = series.jellyfinItemId;
    ids.movie = movie;
    const detail = await ok('GET', `/JellyfinMod/Entries/${series.id}`);
    ids.episodes = Object.fromEntries(detail.episodes.filter(episode => episode.seasonNumber === 1)
        .map(episode => [episode.episodeNumber, episode]));
    const seasons = await ok('GET', `/Shows/${ids.seriesItem}/Seasons?userId=${ids.user}`);
    ids.seasons = Object.fromEntries(seasons.Items.map(item => [item.IndexNumber, item.Id]));
    ids.season = ids.seasons[1];
    const natives = await ok('GET', `/Shows/${ids.seriesItem}/Episodes?userId=${ids.user}&fields=Path`);
    ids.natives = {};
    for (const item of natives.Items) (ids.natives[item.ParentIndexNumber] ??= {})[item.IndexNumber] = item;
    ids.native = ids.natives[1] ?? {};
    const missing = [3, 4, 5, 6].filter(number => ids.episodes[number]?.availability !== 'onDisk');
    const season2 = detail.episodes.filter(episode => episode.seasonNumber === 2);
    record('prepare', `${SERIES} S1: E01 and E02 on disk, E03–E06 without a file; S2: six episodes without a file; Jellyfin items for each (placeholders)`,
        missing.length === 4 && [1, 2].every(number => ids.episodes[number]?.availability === 'onDisk') && [1, 2, 3, 4, 5, 6].every(number => ids.native[number])
        && season2.length === 6 && season2.every(episode => episode.availability !== 'onDisk') && [1, 2, 3, 4, 5, 6].every(number => ids.natives[2]?.[number]),
        { missing, natives: Object.fromEntries(Object.entries(ids.native).map(([number, item]) => [number, (item.Path ?? '').split('/').pop()])), hold: ids.hold });

    const publish = (id, title, extra) => control('/release', { id, indexerId: 1, title, torrentName: title + (extra.files ? '' : '.mkv'), seeders: 40, ...extra });
    await publish('qs-pack', PACK, { tvdbid: TVDB, seasons: [1], episode: null, category: 5040,
        files: [3, 4, 5, 6].map(number => ({ path: `Peep.Show.S01E0${number}.1080p.WEB-DL.AAC2.0.H.264-${TAG}.mkv`, file: join(STAGE, `ps-s01e0${number}.mkv`) })) });
    await publish('qs-pack2', PACK2, { tvdbid: TVDB, seasons: [2], episode: null, category: 5040,
        files: [1, 2, 3, 4, 5, 6].map(number => ({ path: `Peep.Show.S02E0${number}.1080p.WEB-DL.AAC2.0.H.264-${TAG}.mkv`, file: join(STAGE, `ps-s02e0${number}.mkv`) })) });
    await publish('qs-e03', EP3, { tvdbid: TVDB, seasons: [1], episode: 3, category: 5040, file: join(STAGE, 'ps-s01e03.mkv') });
    await publish('qs-e01v2', EP1V2, { tvdbid: TVDB, seasons: [1], episode: 1, category: 5040, file: join(STAGE, 'ps-s01e01-v2.mkv') });
    await publish('qs-moviev2', MOVIEV2, { imdbid: movie.imdbId, tmdbid: movie.tmdbId, category: 2040, file: join(STAGE, 'hyh-v2.mkv') });
}

/** Makes the precondition on a fresh baseline: a writable copy of the series is the Shows library's only folder, with placeholders. */
async function prepareLibrary() {
    const folders = await ok('GET', '/Library/VirtualFolders');
    const shows = folders.find(folder => folder.CollectionType === 'tvshows');
    const copy = join(PREPARE_MEDIA, 'tv', basename(PREPARE_SOURCE));
    if (!existsSync(copy)) {
        execFileSync('cp', ['-c', '-R', PREPARE_SOURCE, join(PREPARE_MEDIA, 'tv') + '/']);
        execFileSync('chmod', ['-R', 'u+w', copy]);
    }
    for (const location of shows.Locations.filter(path => !path.startsWith('/test-media/'))) {
        await ok('DELETE', `/Library/VirtualFolders/Paths?name=${encodeURIComponent(shows.Name)}&path=${encodeURIComponent(location)}&refreshLibrary=true`);
    }
    const seriesPath = async () => {
        const found = await ok('GET', `/Items?userId=${ids.user}&includeItemTypes=Series&recursive=true&fields=Path&searchTerm=${encodeURIComponent(SERIES)}`);
        return found.Items.find(item => item.Name === SERIES && (item.Path ?? '').startsWith('/test-media/'));
    };
    await until(seriesPath, { timeout: 180000, every: 2000, label: 'the series scanned from its writable copy' });
    const entries = (await ok('GET', '/JellyfinMod/Entries?limit=200')).items;
    const series = entries.find(entry => entry.title === SERIES);
    await until(async () => {
        const entry = (await ok('GET', `/JellyfinMod/Entries/${series.id}`)).entry;
        return entry.jellyfinItemId === (await seriesPath())?.Id;
    }, { timeout: 120000, every: 2000, label: 'the entry bound to the copy' });
    await ok('POST', `/JellyfinMod/Entries/${series.id}/EpisodeList`);
    await ok('POST', `/JellyfinMod/Placeholders/${shows.ItemId}/Sync`);
    await until(async () => {
        const item = await seriesPath();
        const episodes = await ok('GET', `/Shows/${item.Id}/Episodes?userId=${ids.user}&fields=Path`);
        const has = (season, number) => episodes.Items.some(episode => episode.ParentIndexNumber === season && episode.IndexNumber === number);
        return [3, 4, 5, 6].every(number => has(1, number)) && [1, 2, 3, 4, 5, 6].every(number => has(2, number));
    }, { timeout: 240000, every: 3000, label: 'the placeholders in Jellyfin' });
    record('prepare', 'the series is a writable copy with placeholders (fresh baseline made ready)', true);
}

// ---- Grabs ----
const searchFor = async query => {
    const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined && value !== null));
    return until(async () => {
        const answer = await http('GET', `/JellyfinMod/Releases?${params}`);
        return answer.status === 200 ? answer.body : null;
    }, { timeout: 30000, every: 1200, label: 'a release search' });
};
async function apiGrab(query, title, mode) {
    const found = await searchFor(query);
    const candidate = found.candidates.find(item => item.rawTitle === title);
    if (!candidate) throw new Error(`the search found no ${title}: ${found.candidates.map(item => item.rawTitle).join(', ')} ${found.grab.reason ?? ''}`);
    return ok('POST', '/JellyfinMod/Releases/Grab', { searchId: found.searchId, releaseId: candidate.releaseId, idempotencyKey: randomUUID(),
        ...(mode ? { mode } : {}) });
}
const grabState = async id => (await ok('GET', `/JellyfinMod/Grabs/${id}`)).state;
const queueRows = async () => (await ok('GET', '/JellyfinMod/Queue')).items;
const torrentOf = async title => (await control('/state')).torrents.find(torrent => torrent.name.startsWith(title));
/** Removes a grab's download: its queue row and its torrent (the client forgets it; nothing is deleted). */
async function removeGrab(grabId) {
    const row = (await queueRows()).find(item => item.grabId === grabId);
    if (row) await http('DELETE', `/JellyfinMod/Queue/${row.id}`, { removeFromClient: true, blocklist: false });
}

/** The picker on the page, its scope chosen when given, a release's Add pressed. Returns the time of the press. */
async function pickerGrab(page, opener, scope, title) {
    await opener.click();
    const dialog = page.locator('.jfmod-releaseDialog');
    await dialog.waitFor({ state: 'visible', timeout: 20000 });
    if (scope) {
        const select = dialog.locator('select#jfmod-releaseEpisode, #jfmod-releaseEpisode select, select').first();
        await until(async () => (await select.locator(`option[value="${scope}"]`).count()) > 0, { timeout: 30000, label: 'the scope ' + scope });
        await select.selectOption(scope);
    }
    const row = dialog.locator('.jfmod-releaseItem').filter({ hasText: title }).first();
    await row.waitFor({ state: 'visible', timeout: 45000 });
    const add = row.locator('[data-jfmod-release-add]').first();
    const at = Date.now();
    await add.click();
    await until(async () => (await dialog.locator('.jfmod-releaseItem--added').count()) > 0, { timeout: 10000, every: 100, label: 'the added row' });
    return at;
}
const closePicker = async page => {
    await page.locator('.jfmod-releaseDialog .jfmod-releaseDialogClose').first().click().catch(() => page.keyboard.press('Escape'));
    await page.locator('.jfmod-releaseDialog').waitFor({ state: 'detached', timeout: 10000 }).catch(() => undefined);
};

const seasonHash = (season = 1) => `#/details?id=${ids.seasons[season]}`;
const seriesHash = () => `#/details?id=${ids.seriesItem}`;
const episodeHash = (number, season = 1) => `#/details?id=${ids.natives[season][number].Id}`;
const waitRows = (page, numbers) => until(async () => {
    const log = await logOf(page);
    const lastState = log.at(-1)?.s ?? {};
    return numbers.every(number => lastState['row:E' + number]) ? lastState : null;
}, { timeout: 30000, every: 100, label: 'the season rows' });
/** The last sampled state of a label. */
const now = async (page, label) => ((await logOf(page)).at(-1)?.s[label] ?? '').split('|')[0];

/**
 * Checks a label's trace from a start: drawn within `within` ms of being there, never in a forbidden state, no step back, and
 * (when given) ending in `end`.
 */
function judge(step, what, list, { forbid = ['cloud', 'failed'], end = null, ordered = true } = {}) {
    const bad = list.filter(item => forbid.includes(item.v));
    const pass = list.length > 0 && bad.length === 0 && (!ordered || monotonic(list)) && (end === null || list.at(-1)?.v === end);
    record(step, what, pass, list.map(item => `${item.v}@${item.t}`).join(' → ') + (bad.length ? ` (wrong at ${bad.map(item => item.t + ' ms').join(', ')})` : ''));
    return pass;
}

// ---- A1: one episode, grabbed in the picker from its row ----
async function stepA1() {
    const page = await newSampledPage();
    await go(page, seasonHash());
    await waitRows(page, [1, 2, 3, 4, 5, 6]);
    await page.waitForTimeout(1500);
    const before = await now(page, 'row:E3');
    const opener = page.locator('.listItem').filter({ hasText: /^3\.\s/ }).locator('.jfmod-mark--none').first();
    const t0 = await pickerGrab(page, opener, null, EP3);
    const grab = (await queueRows()).find(row => row.releaseTitle === EP3);
    record('A1', 'the Queue answer holds the held grab at once, queued, with the episode', !!grab && grab.state === 'queued'
        && grab.importState === 'held' && grab.episode?.episodeNumber === 3, grab && { state: grab.state, importState: grab.importState });
    await closePicker(page);
    await shot(page, 'a1-held-row');
    const grabId = (await ok('GET', '/JellyfinMod/Grabs')).find(operation => operation.releaseTitle === EP3)?.id;
    // The episode page and the Queue page while it is held, then back to the season page.
    const second = await newSampledPage();
    await go(second, episodeHash(3));
    await until(async () => (await now(second, 'block')) && (await now(second, 'block')) !== 'none', { timeout: 15000, every: 100, label: 'the episode block' })
        .catch(() => undefined);
    const blockHeld = await now(second, 'block');
    await go(second, '#/catalog/queue');
    const queueHeld = await until(async () => {
        const state = (await logOf(second)).at(-1)?.s ?? {};
        return Object.entries(state).find(([label]) => label.startsWith('queue:') && label.includes('S01E03'))?.[1] ?? null;
    }, { timeout: 15000, every: 100, label: 'the Queue page row' }).catch(() => null);
    record('A1', 'while held: the episode page\'s block and the Queue page\'s row say queued', blockHeld === 'queued' && queueHeld === 'queued',
        { blockHeld, queueHeld });
    await until(async () => (await grabState(grabId)) === 'accepted', { timeout: 30000, label: 'the client accepting the grab' });
    const tAccepted = Date.now();
    const torrent = await torrentOf(EP3);
    await control(`/progress?hash=${torrent.hashString}&fraction=0.3`);
    await until(async () => (await now(page, 'row:E3')) === 'downloading', { timeout: 20000, every: 200, label: 'the row downloading' }).catch(() => undefined);
    const tDownloading = Date.now();
    await shot(page, 'a1-downloading-row');
    await removeGrab(grabId);
    await until(async () => (await now(page, 'row:E3')) === 'cloud', { timeout: 20000, every: 200, label: 'the cloud back' }).catch(() => undefined);
    const log = await logOf(page);
    record('A1', 'before the grab the row showed Not Downloaded', before === 'cloud', before);
    judge('A1', 'the row from 1.2 s after Add (the grab request and one draw) until removed: queued, then downloading, never the cloud',
        trace(log, 'row:E3', t0 + 1200, tDownloading + 500, { seed: true }), { end: 'downloading' });
    const after = trace(log, 'row:E3', tDownloading + 500, Infinity, { seed: true });
    record('A1', 'removed from the queue: the row shows Not Downloaded again', after.at(-1)?.v === 'cloud', states(after).join(' → '));
    const firstQueued = trace(log, 'row:E3', t0).find(item => item.v === 'queued');
    record('A1', 'queued drawn within 1.5 s of pressing Add (the picker\'s own request included)', !!firstQueued && firstQueued.t < 1500, firstQueued?.t);
    record('A1', 'accepted to downloading measured', 'INFO', { acceptedAfter: tAccepted - t0, downloadingAfter: tDownloading - t0 });
    await page.context().close();
    await second.context().close();
}

// ---- A2: another version of an episode and of the movie ----
async function stepA2() {
    const page = await newSampledPage();
    await go(page, seasonHash());
    await waitRows(page, [1]);
    await page.waitForTimeout(1200);
    const t0 = Date.now();
    const grab = await apiGrab({ entryId: ids.series, episodeId: ids.episodes[1].id, intent: 'addVersion' }, EP1V2, 'add');
    // Another device's grab: nothing on this page knows of it, so it shows within one slow poll at most; a hashchange reads at once.
    await go(page, seriesHash());
    await page.waitForTimeout(400);
    await go(page, seasonHash());
    const back = Date.now();
    await until(async () => (await now(page, 'row:E1')) === 'queued', { timeout: 10000, every: 100, label: 'E1 queued' }).catch(() => undefined);
    await until(async () => (await grabState(grab.id)) === 'accepted', { timeout: 30000, label: 'the client accepting the grab' });
    await page.waitForTimeout(5500);
    const log = await logOf(page);
    const list = trace(log, 'row:E1', back + 1000, Infinity, { seed: true });
    record('A2', 'grab to the season page drawn again (ms)', 'INFO', back - t0);
    judge('A2', 'another version of E01 (on disk): queued from the page\'s first read during the hold, still queued once accepted, never the cloud',
        list, { end: 'queued' });
    await removeGrab(grab.id);

    const movieCard = `card:${ids.movie.title}`;
    const views = await ok('GET', `/UserViews?userId=${ids.user}`);
    const movies = views.Items.find(view => view.CollectionType === 'movies');
    await go(page, `#/movies?topParentId=${movies.Id}&collectionType=movies`);
    await until(async () => !!(await now(page, movieCard)), { timeout: 20000, every: 200, label: 'the movie card' }).catch(() => undefined);
    const t1 = Date.now();
    const movieGrab = await apiGrab({ entryId: ids.movie.id, intent: 'addVersion' }, MOVIEV2, 'add');
    await go(page, '#/home');
    await page.waitForTimeout(500);
    await go(page, `#/movies?topParentId=${movies.Id}&collectionType=movies`);
    const backToGrid = Date.now();
    await until(async () => (await now(page, movieCard)) === 'queued', { timeout: 10000, every: 100, label: 'the movie card queued' }).catch(() => undefined);
    await shot(page, 'a2-movie-card');
    await until(async () => (await grabState(movieGrab.id)) === 'accepted', { timeout: 30000, label: 'the client accepting the movie grab' });
    await page.waitForTimeout(5500);
    const movieList = trace(await logOf(page), movieCard, backToGrid + 1500, Infinity, { seed: true });
    record('A2', 'movie grab to the grid drawn again (ms)', 'INFO', backToGrid - t1);
    judge('A2', 'another version of the movie: its library card is queued once the grid is drawn again during the hold, and stays queued',
        movieList, { end: 'queued' });
    await removeGrab(movieGrab.id);
    await page.context().close();
}

// ---- A3 and B: a season pack grabbed by another device, a reload and a second browser inside the hold, cancelled ----
async function stepHeldPack(step, layout, { cancelInUi = false } = {}) {
    const page = await newSampledPage(layout);
    await go(page, seasonHash());
    await waitRows(page, [3, 4, 5, 6]);
    await page.waitForTimeout(1000);
    const second = await newSampledPage(layout);
    const queuePage = cancelInUi ? await newSampledPage(layout) : null;
    if (queuePage) {
        await go(queuePage, '#/catalog/queue');
        await queuePage.waitForTimeout(1500);
    }
    const t0 = Date.now();
    const grab = await apiGrab({ entryId: ids.series, scope: 'season', seasonNumber: 1 }, PACK, 'fill');
    const created = Date.now();
    // Another device opened during the hold, and this page reloaded during it.
    await go(second, seasonHash());
    await page.reload({ waitUntil: 'domcontentloaded' });
    const reloaded = Date.now();
    await waitRows(page, [3, 4, 5, 6]);
    await waitRows(second, [3, 4, 5, 6]);
    let cancelled = false;
    if (queuePage) {
        // The Queue page's held row offers Cancel; the hold is short, so it is pressed as soon as the row is there.
        const row = queuePage.locator('.jfmod-queueTableRow, .jfmod-queueRow').filter({ hasText: 'Season 1 pack' }).first();
        try {
            await row.waitFor({ state: 'visible', timeout: Math.max(500, grab.holdUntil ? Date.parse(grab.holdUntil) - Date.now() : 4000) });
            await row.locator('.jfmod-queueMenu').click();
            // The desktop table's popover (2026-10-19) or the action sheet.
            const item = queuePage.locator('.actionSheet [data-id="cancel"], .jfmod-queueMenuPopover [data-id="cancel"]').first();
            await item.click({ timeout: 2000 });
            cancelled = true;
        } catch (error) {
            record(step, 'the Queue page\'s held row cancelled by its Cancel action', 'NOT VERIFIED', String(error.message).split('\n')[0]);
        }
    }
    if (!cancelled) await http('POST', `/JellyfinMod/Grabs/${grab.id}/Cancel`);
    const state = await until(async () => {
        const value = await grabState(grab.id);
        return value === 'cancelled' || value === 'accepted' ? value : null;
    }, { timeout: 20000, label: 'the grab ending' });
    const tCancelled = Date.now();
    if (state !== 'cancelled') {
        record(step, 'the pack was cancelled inside its hold', 'NOT VERIFIED', state);
        await removeGrab(grab.id);
    } else if (queuePage) {
        record(step, 'the Queue page\'s held row cancelled by its Cancel action', cancelled, state);
    }
    await until(async () => (await now(page, 'row:E3')) === 'cloud' && (await now(second, 'row:E3')) === 'cloud',
        { timeout: 70000, every: 250, label: 'the cloud back on both' }).catch(() => undefined);
    const tEnd = Date.now();
    for (const [name, target, from] of [['this browser, reloaded inside the hold', page, reloaded], ['a second browser opened inside the hold', second, created]]) {
        const log = await logOf(target);
        for (const number of [3, 4, 5, 6]) {
            const held = trace(log, 'row:E' + number, from, tCancelled).filter(item => item.v !== 'none' || item.t > 50);
            const during = held.filter((item, index) => !(index === 0 && item.v === 'none'));
            judge(step, `${layout} ${name}: E0${number} queued from its first draw until cancelled, never the cloud`, during, { end: 'queued' });
        }
        const after = trace(log, 'row:E3', tCancelled, tEnd, { seed: true });
        record(step, `${layout} ${name}: cancelled, E03 shows Not Downloaded again`, after.at(-1)?.v === 'cloud', states(after).join(' → '));
    }
    if (queuePage) {
        const queueLog = await logOf(queuePage);
        const label = queueLog.flatMap(entry => Object.keys(entry.s)).find(key => key.startsWith('queue:') && key.includes('Season 1 pack'));
        const list = label ? trace(queueLog, label, t0) : [];
        record(step, `${layout} the Queue page lists the held pack as queued, then not at all once cancelled`, list.length > 0
            && list.every(item => item.v === 'queued'), states(list).join(' → ') || 'never listed');
        await shot(queuePage, `${step}-queue`);
        await queuePage.context().close();
    }
    await shot(page, `${step}-cancelled`);
    await page.context().close();
    await second.context().close();
}

// ---- A4: the handoff fails at the end of the hold ----
async function stepA4() {
    const page = await newSampledPage();
    await go(page, seasonHash());
    await waitRows(page, [3, 4, 5, 6]);
    await page.waitForTimeout(1000);
    await control('/fault?service=tx&mode=down');
    let grab;
    try {
        const t0 = Date.now();
        grab = await apiGrab({ entryId: ids.series, scope: 'season', seasonNumber: 1 }, PACK, 'fill');
        await go(page, seriesHash());
        await page.waitForTimeout(300);
        await go(page, seasonHash());
        const back = Date.now();
        await until(async () => (await grabState(grab.id)) === 'failed', { timeout: 40000, label: 'the handoff failing' });
        const tFailed = Date.now();
        await until(async () => (await now(page, 'row:E3')) === 'cloud', { timeout: 70000, every: 250, label: 'the cloud back' }).catch(() => undefined);
        const log = await logOf(page);
        record('A4', 'grab to the season page drawn again, and to the failure (ms)', 'INFO', { back: back - t0, failed: tFailed - t0 });
        const during = trace(log, 'row:E4', back + 1000, tFailed, { seed: true });
        judge('A4', 'while held: E04 queued, never the cloud', during, { end: 'queued' });
        const after = trace(log, 'row:E4', tFailed, Infinity, { seed: true });
        record('A4', 'the handoff failed (client down): E04 shows Not Downloaded again and nothing else', after.at(-1)?.v === 'cloud'
            && after.every(item => item.v === 'queued' || item.v === 'cloud'), states(after).join(' → ') + ` (cloud after ${after.find(item => item.v === 'cloud')?.t} ms)`);
        const rows = await queueRows();
        record('A4', 'the failed grab is not in the Queue answer', !rows.some(row => row.grabId === grab.id), rows.map(row => row.releaseTitle));
    } finally {
        await control('/fault?service=tx&mode=ok');
        await page.context().close();
    }
}

// ---- A5: the whole way, from the picker to the files: a Season 2 pack, every episode a placeholder ----
async function stepA5() {
    const page = await newSampledPage();
    const seriesPage = await newSampledPage();
    const queuePage = await newSampledPage();
    const episodePage = await newSampledPage();
    const card = 'card:Season 2';
    const numbers = [1, 2, 3, 4, 5, 6];
    await go(page, seriesHash());
    await until(async () => !!(await now(page, card)), { timeout: 20000, every: 200, label: 'the Season 2 card' });
    await page.waitForTimeout(1500);
    const cardBefore = await now(page, card);
    const opener = page.locator('.page:not(.hide) .mainDetailButtons .jfmod-getRelease').first();
    const t0 = await pickerGrab(page, opener, 'season:2', PACK2);
    await closePicker(page);
    const tClosed = Date.now();
    // The season opened at once, as the user did, and three more browsers during the hold: the series page, the Queue page and
    // E04's page.
    await go(page, seasonHash(2));
    await waitRows(page, numbers);
    const tSeason = Date.now();
    await Promise.all([go(seriesPage, seriesHash()), go(queuePage, '#/catalog/queue'), go(episodePage, episodeHash(4, 2))]);
    const tOthers = Date.now();
    await shot(page, 'a5-season-held');
    const grab = (await queueRows()).find(row => row.releaseTitle === PACK2);
    record('A5', 'the held pack is in the Queue answer with its six episodes, none with an import yet', !!grab && grab.importState === 'held'
        && grab.pack?.episodes.length === 6 && grab.pack.episodes.every(episode => episode.importId === null && episode.progress === null),
    grab && { importState: grab.importState, mode: grab.pack?.mode, episodes: grab.pack?.episodes.map(episode => episode.episodeNumber) });
    const grabId = (await ok('GET', '/JellyfinMod/Grabs')).find(operation => operation.releaseTitle === PACK2)?.id;
    await until(async () => (await grabState(grabId)) === 'accepted', { timeout: 30000, label: 'the client accepting the pack' });
    const tAccepted = Date.now();
    await page.waitForTimeout(2500);
    const torrent = await torrentOf(PACK2);
    const files = torrent.files.map(file => file.name.split('/').pop());
    const index = number => files.findIndex(name => name.includes(`S02E0${number}`));
    const done = new Map();
    const importedAt = async () => {
        const detail = await ok('GET', `/JellyfinMod/Entries/${ids.series}`);
        for (const episode of detail.episodes) {
            if (episode.seasonNumber === 2 && episode.availability === 'onDisk' && !done.has(episode.episodeNumber)) done.set(episode.episodeNumber, Date.now());
        }
    };
    // E03 half way: its row downloads, the others stay queued.
    await control(`/progress?hash=${torrent.hashString}&file=${index(3)}&fraction=0.5`);
    await until(async () => (await now(page, 'row:E3')) === 'downloading', { timeout: 30000, every: 200, label: 'E03 downloading' }).catch(() => undefined);
    const e3Words = (await logOf(page)).at(-1)?.s['row:E3'];
    const others = await Promise.all([1, 2, 4, 5, 6].map(number => now(page, 'row:E' + number)));
    record('A5', 'E03 half done: its row downloads with its own figure (meta line and tooltip), the other five stay queued',
        (e3Words ?? '').startsWith('downloading|50%') && /Downloading · 50%/.test(e3Words ?? '') && others.every(value => value === 'queued'), { e3Words, others });
    await shot(page, 'a5-e03-downloading');
    await checkTooltips(page, 'row 3 downloading', /^Downloading · 50%/, /^50%/);
    // E03 complete: importing while the rest still wait; E01 and E02 complete together; then the rest.
    await control(`/progress?hash=${torrent.hashString}&file=${index(3)}&fraction=1`);
    await until(async () => (await now(page, 'row:E3')) === 'importing', { timeout: 30000, every: 200, label: 'E03 importing' }).catch(() => undefined);
    await checkTooltips(page, 'row 3 importing', /^Importing…$/, /^Importing…$/);
    await shot(page, 'a5-e03-importing');
    for (const number of [1, 2]) await control(`/progress?hash=${torrent.hashString}&file=${index(number)}&fraction=1`);
    await until(async () => { await importedAt(); return done.has(3); }, { timeout: 180000, every: 500, label: 'E03 imported' }).catch(() => undefined);
    for (const number of [4, 5, 6]) await control(`/progress?hash=${torrent.hashString}&file=${index(number)}&fraction=1`);
    await until(async () => { await importedAt(); return numbers.every(number => done.has(number)); }, { timeout: 300000, every: 500, label: 'every episode imported' })
        .catch(() => undefined);
    const tImported = Date.now();
    // The page catches up: each row is Jellyfin's real episode with no mark.
    await until(async () => (await Promise.all(numbers.map(number => now(page, 'row:E' + number)))).every(value => value === 'none'),
        { timeout: 240000, every: 300, label: 'every row without a mark' }).catch(() => undefined);
    await page.waitForTimeout(6000);
    const tEnd = Date.now();
    await shot(page, 'a5-done');
    const log = await logOf(page);
    record('A5', 'the Season 2 card had Not Downloaded before; behind the closed picker it is queued already', cardBefore === 'cloud'
        && trace(log, card, t0 + 1200, tClosed + 200, { seed: true }).every(item => item.v === 'queued'),
    { cardBefore, after: states(trace(log, card, t0, tClosed + 200, { seed: true })), closedAfter: tClosed - t0 });
    for (const number of numbers) {
        const list = trace(log, 'row:E' + number, tSeason - 1500).filter((item, at) => !(at === 0 && item.v === 'none'));
        judge('A5', `season page E0${number}: queued from its first draw, then its own download, importing and its file, never the cloud, no step back`,
            list, { end: 'none' });
        const rowDone = list.find(item => item.v === 'none');
        record('A5', `E0${number}: imported (the entry says on disk) and the row showing its file, ms after Add`, 'INFO',
            { imported: done.has(number) ? done.get(number) - t0 : null, rowShowsFile: rowDone ? rowDone.t + tSeason - 1500 - t0 : null });
    }
    const first = trace(log, 'row:E3', tSeason - 1500)[0];
    record('A5', 'the season page, opened at once, drew its rows queued on first sight', !!first && first.v === 'queued', first);
    for (const [name, target, label, ordered] of [['series page (Season 2 card)', seriesPage, card, true], ['episode page (E04)', episodePage, 'block', false]]) {
        const list = trace(await logOf(target), label, tOthers - 1500).filter((item, at) => !(at === 0 && item.v === 'none'));
        judge('A5', `${name}, opened during the hold: queued, then downloading or importing, and done, never Not Downloaded, no step back`, list,
            { ordered, end: label === 'block' ? null : 'none' });
    }
    const queueLog = await logOf(queuePage);
    const queueLabel = queueLog.flatMap(entry => Object.keys(entry.s)).find(key => key.startsWith('queue:') && key.includes('Season 2 pack'));
    if (queueLabel) judge('A5', 'Queue page, opened during the hold: the pack row queued, downloading, importing, never a step back', trace(queueLog, queueLabel, tOthers - 1500));
    else record('A5', 'Queue page: the pack row listed', false, 'never listed');
    record('A5', 'timings (ms after Add)', 'INFO', { closed: tClosed - t0, season: tSeason - t0, accepted: tAccepted - t0, imported: tImported - t0, end: tEnd - t0 });
    for (const target of [page, seriesPage, queuePage, episodePage]) await target.context().close();
}

// ---- B8 (opt-in): how often the plugin reads the client (P4.FU12 B8) ----
// The stand-in Transmission's request count over a window: an import waiting for its download with no page open (the monitor's
// 2 s pace), the same with a season page polling the queue (one shared client read per freshness window, not one per reader),
// and with nothing waiting (no client read at all).
async function stepB8() {
    const WINDOW = 30000;
    const txCount = async () => (await control('/state')).counters.tx ?? 0;
    const over = async () => {
        const before = await txCount();
        await new Promise(resolve => setTimeout(resolve, WINDOW));
        return (await txCount()) - before;
    };
    const grab = await apiGrab({ entryId: ids.series, episodeId: ids.episodes[3].id }, EP3);
    await until(async () => (await grabState(grab.id)) === 'accepted', { timeout: 30000, label: 'the client accepting E03' });
    const torrent = await torrentOf(EP3);
    await control(`/progress?hash=${torrent.hashString}&fraction=0.5`);
    await new Promise(resolve => setTimeout(resolve, 3000));
    const waiting = await over();
    const page = await newSampledPage();
    await go(page, seasonHash());
    await waitRows(page, [1, 2, 3, 4, 5, 6]);
    const withPage = await over();
    await page.context().close();
    await removeGrab(grab.id);
    await new Promise(resolve => setTimeout(resolve, 5000));
    const idle = await over();
    const perTwo = WINDOW / 2000;
    record('B8', 'an import waiting for its download: the client is read about every 2 s (requests in 30 s)', waiting >= perTwo * 0.6 && waiting <= perTwo * 1.6, waiting);
    record('B8', 'the same with a season page polling the queue: still about one client read per 2 s, shared', withPage <= perTwo * 1.6, withPage);
    record('B8', 'nothing waiting: the client is not read (requests in 30 s)', idle <= 1, idle);
}

/** A row disc's tooltip and meta line, read where the pointer would rest: nothing may cover the disc (P4.FU10, "the text is not popping"). */
async function checkTooltips(page, what, title, meta) {
    const seen = await page.evaluate(() => {
        const row = Array.from(document.querySelectorAll('.listItem')).find(item => /^3\.\s/.test((item.querySelector('.listItemBodyText')?.textContent ?? '').trim())
            && item.getClientRects().length);
        const disc = row?.querySelector('.jfmod-dlmark');
        if (!disc) return null;
        disc.scrollIntoView({ block: 'center' });
        const box = disc.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        const line = row.querySelector('.jfmod-dlMeta');
        return { title: disc.title, label: disc.getAttribute('aria-label'), reached: !!hit && (hit === disc || disc.contains(hit)),
            events: getComputedStyle(disc).pointerEvents, meta: line?.textContent ?? null, metaTitle: line?.title ?? null,
            metaShown: !!line && line.getClientRects().length > 0 && getComputedStyle(line).visibility !== 'hidden' };
    });
    record('A5', `${what}: the disc is the topmost element under the pointer (its tooltip can show), its tooltip and the meta line read the state`,
        !!seen && seen.reached && seen.events !== 'none' && title.test(seen.title) && seen.metaShown && meta.test(seen.meta ?? ''), seen);
    // The browser's own tooltip is not in the DOM; hovering is checked to land on the disc, and the shot shows the state words.
    if (seen?.reached) {
        const box = await page.locator('.listItem').filter({ hasText: /^3\.\s/ }).locator('.jfmod-dlmark').first().boundingBox();
        if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(300);
        await shot(page, `a5-${what.replace(/\s+/g, '-')}-hover`);
        await page.mouse.move(2, 2);
    }
}

try {
    await prepare();
    if (steps.has('A1')) await stepA1().catch(error => record('A1', 'runs', false, String(error.message).split('\n')[0]));
    if (steps.has('A2')) await stepA2().catch(error => record('A2', 'runs', false, String(error.message).split('\n')[0]));
    if (steps.has('A3')) await stepHeldPack('A3', 'desktop', { cancelInUi: true }).catch(error => record('A3', 'runs', false, String(error.message).split('\n')[0]));
    if (steps.has('A4')) await stepA4().catch(error => record('A4', 'runs', false, String(error.message).split('\n')[0]));
    if (steps.has('B')) {
        for (const layout of otherLayouts) await stepHeldPack('B', layout).catch(error => record('B', `${layout} runs`, false, String(error.message).split('\n')[0]));
    }
    if (steps.has('A5')) await stepA5().catch(error => record('A5', 'runs', false, String(error.message).split('\n')[0]));
    if (steps.has('B8')) await stepB8().catch(error => record('B8', 'runs', false, String(error.message).split('\n')[0]));
    record('all', 'no page errors', errors.length === 0, errors.slice(0, 5));
} finally {
    await browser.close();
}
const count = verdict => results.filter(item => item.verdict === verdict).length;
console.log(`\n${tier}: ${count('PASS')} passed, ${count('FAIL')} failed, ${count('NOT VERIFIED')} not verified, ${count('INFO')} info`);
process.exit(count('FAIL') > 0 ? 1 : 0);
