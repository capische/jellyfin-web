/* eslint-disable compat/compat, no-restricted-globals, sonarjs/no-os-command-from-path -- a Node acceptance runner, not shipped code */
/* global window, document, ApiClient, location, localStorage */
// Live acceptance for the Home hero (P7.S6, user decision 2026-10-07): the hero is what oleksii is in the middle of,
// else the newest title, and its height follows the window width.
//
// Runs against the isolated test instance as oleksii (empty password). The in-progress states are produced by playing
// real library items for a few seconds; every user-data field the run touches is snapshotted first and written back
// at the end, and the database-level proof is userdata-db.mjs's snapshot/diff around the run.
//
//   JELLYFINMOD_HERO_URL      the test instance (http://<host>:18096); never production
//   JELLYFINMOD_WEB_DIST      optional: a built dist/ to serve from a loopback port inside this runner, with config.json
//                             naming the instance — upstream's own dev setup — so the bundle under test runs against the
//                             real server without replacing the bundle the instance serves to everyone else
//   JELLYFINMOD_WEB_ENTRY     optional, without JELLYFINMOD_WEB_DIST: the page to open on the instance itself, such as
//                             /web/jellyfinmod.html when the host web folder holds the mod shell without a plugin takeover
//   JELLYFINMOD_HERO_EPISODE  a partly watched episode id; JELLYFINMOD_HERO_MOVIE a partly watched movie id
//   JELLYFINMOD_HERO_SHOW_EPISODE  a played episode (with a play date) of a show whose Next Up episode is old in the
//                             library; the nextup step re-watches it so that show is the one watched most recently
//   JELLYFINMOD_HERO_OUT      directory for results.json and screenshots
//   JELLYFINMOD_HERO_STEPS    optional subset of a,finish,b,nextup,c,sections,d,glass; JELLYFINMOD_HERO_LAYOUTS optional subset of the layout names
//   JELLYFINMOD_GLASS_VARIANTS  optional: a JSON file of [{ name, css }] for the glass step to measure instead of the
//                             2026-10-08 bar ("before") and the built one ("after"), for trying values
//   JELLYFINMOD_GLASS_THEMES    optional subset of the glass step's themes (dark,light,appletv,wmc,blueradiance,purplehaze)
//   JELLYFINMOD_SSH_HOST, JELLYFINMOD_DATA_DIR  optional: with both, userdata-db.mjs snapshots every UserData row of the
//                             user before the run, and the run fails unless every row of an item it touched or played
//                             is identical after it (fields the API cannot show or restore included, such as the
//                             remembered audio and subtitle tracks) and any other changed row is explained by another
//                             client's playback in the server's activity log
//   JELLYFINMOD_BROWSER       chromium | chrome
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';

const required = name => process.env[name] ?? (() => { throw new Error(`${name} is required`); })();
const origin = new URL(required('JELLYFINMOD_HERO_URL'));
if (origin.port === '8096') throw new Error('Never against production');
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
const dist = process.env.JELLYFINMOD_WEB_DIST;
const EPISODE = required('JELLYFINMOD_HERO_EPISODE');
const MOVIE = required('JELLYFINMOD_HERO_MOVIE');
// Optional: a played episode of a show whose next episode is old in the library, re-watched to put that show first.
const SHOW_EPISODE = process.env.JELLYFINMOD_HERO_SHOW_EPISODE;
const out = path.join(required('JELLYFINMOD_HERO_OUT'), tier);
const only = (process.env.JELLYFINMOD_HERO_STEPS ?? 'a,finish,b,nextup,c,sections,d,glass').split(',');

// The approved scrolled bar (user, 2026-10-09; values in homeChrome.scss): the theme's bar colour at 12 % (light 20 %,
// Apple TV 30 %) over the page, blurred 12px with contrast(0.7), brightness 0.85 (light 1.1, Apple TV 1.15), no text
// halo on the labels and no hairline or shadow on the bar's lower edge.
const GLASS_VALUES = { default: { tint: 0.12, brightness: 0.85 }, light: { tint: 0.2, brightness: 1.1 }, appletv: { tint: 0.3, brightness: 1.15 } };
function filterNumber(filter, name) {
    const found = new RegExp(`${name}\\((\\d+(?:\\.\\d+)?)(%|px)?\\)`).exec(filter ?? '');
    return found ? Number(found[1]) / (found[2] === '%' ? 100 : 1) : null;
}
function glassValuesMatch(theme, bar) {
    const expected = GLASS_VALUES[theme] ?? GLASS_VALUES.default;
    const near = (value, target, margin) => value !== null && Math.abs(value - target) <= margin;
    return near(filterNumber(bar.filter, 'blur'), 12, 0.01) && near(filterNumber(bar.filter, 'contrast'), 0.7, 0.01) &&
        near(filterNumber(bar.filter, 'brightness'), expected.brightness, 0.01) && near(bar.tintAlpha, expected.tint, 0.02) &&
        (bar.boxShadow === 'none' || bar.boxShadow === null) && parseFloat(bar.borderBottomWidth ?? '0') === 0 &&
        (!bar.labelTextShadow || bar.labelTextShadow === 'none');
}
mkdirSync(out, { recursive: true });

const results = [];
const record = (step, check, verdict, detail) => {
    const normalised = verdict === true ? 'PASS' : verdict === false ? 'FAIL' : verdict;
    const text = detail === undefined ? undefined : JSON.parse(JSON.stringify(detail).split(origin.host).join('<host>'));
    results.push({ step, check, verdict: normalised, detail: text });
    console.log(`${normalised} [${tier}] ${step}: ${check}${text === undefined ? '' : ' :: ' + JSON.stringify(text).slice(0, 500)}`);
};
const save = () => writeFileSync(path.join(out, 'results.json'), JSON.stringify({ browser: tier, results }, null, 1) + '\n');

async function until(check, { timeout = 60000, every = 1000, label = 'condition' } = {}) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const value = await check();
        if (value) return value;
        await new Promise(resolve => setTimeout(resolve, every));
    }
    throw new Error(`timed out after ${timeout / 1000}s waiting for ${label}`);
}

const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.wasm': 'application/wasm',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.webmanifest': 'application/manifest+json' };

/** The bundle under test on a loopback port; config.json points it at the instance. */
const startBundleServer = () => new Promise(resolve => {
    const server = createServer((request, response) => {
        // The mod interface is the jellyfinmod.html entry, the page the takeover serves at /web/.
        const relative = decodeURIComponent(new URL(request.url, 'http://loopback').pathname.slice(1)) || 'jellyfinmod.html';
        const file = path.join(dist, relative);
        if (relative === 'config.json') {
            const config = JSON.parse(readFileSync(file, 'utf8'));
            response.writeHead(200, { 'Content-Type': TYPES['.json'] });
            response.end(JSON.stringify({ ...config, servers: [origin.origin] }));
            return;
        }
        if (!file.startsWith(dist) || !existsSync(file) || !statSync(file).isFile()) {
            response.writeHead(404);
            response.end();
            return;
        }
        response.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
        response.end(readFileSync(file));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
});
const bundleServer = dist ? await startBundleServer() : null;
const webEntry = new URL(process.env.JELLYFINMOD_WEB_ENTRY ?? '/web/', origin);
// The page under test must be on the instance this run is allowed to touch, never another one or production.
if (!bundleServer && webEntry.origin !== origin.origin) throw new Error(`JELLYFINMOD_WEB_ENTRY must be on ${origin.origin}, not ${webEntry.origin}`);
const webBase = bundleServer ? `http://127.0.0.1:${bundleServer.address().port}/` : webEntry.href;

const browser = await chromium.launch(tier === 'chrome' ? { headless: true, channel: 'chrome' } : { headless: true });

/**
 * Every playback request any page of this run makes, read on the way out: the playback-info request that starts one,
 * the stream itself, and the start, progress and stop reports that are the only way a client changes user data by
 * playing. An item outside the allowlist is refused before it can start, so nothing the run did not snapshot is ever
 * played, and the run's own playback record is complete rather than sampled. An item joins the allowlist only once its
 * guards have passed and it is in the ledger: an episode that autoplays at the end of another is refused until then.
 */
const allowedPlayback = new Set();
/** Every request other than a read that any page of this run sent to the server: what the run could have changed. */
const sentRequests = [];
/**
 * The only writes the run lets reach the server. None of them changes user data beyond the item it names: sign-in and
 * capabilities, playback (item-gated above), user-data writes to items already in the ledger, a stop command to one of
 * this run's own sessions, the Home-settings display preferences, and the mod's catalog browse query (a POST that only
 * reads, for Recently Added). Anything else — marking a season played, say,
 * which would change episodes it does not name — is refused before it is sent and fails the run.
 */
const refusedWrites = [];
const allowWrite = request => {
    const pathname = new URL(request.url()).pathname;
    const userItem = /^\/UserItems\/([0-9a-f]{32})\/UserData$/i.exec(pathname);
    if (userItem) return ledger.has(userItem[1].toLowerCase());
    // A stop command reaches another client's playback only if it names that client's session, so only this run's own.
    const stopCommand = /^\/Sessions\/([0-9a-f]+)\/Playing\/Stop$/i.exec(pathname);
    if (stopCommand) return ownSessionIds.has(stopCommand[1].toLowerCase());
    return [
        /^\/Users\/AuthenticateByName$/i, /^\/Sessions\/Capabilities(?:\/Full)?$/i, /^\/Sessions\/Logout$/i,
        /^\/Sessions\/Playing(?:\/Progress|\/Stopped|\/Ping)?$/i, /^\/Items\/[0-9a-f]{32}\/PlaybackInfo$/i,
        /^\/DisplayPreferences\/usersettings$/i, /^\/JellyfinMod\/Browse$/i
    ].some(pattern => pattern.test(pathname));
};
const gateWrites = route => {
    const request = route.request();
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return route.fallback();
    if (allowWrite(request)) return route.fallback();
    refusedWrites.push({ method: request.method(), url: new URL(request.url()).pathname });
    return route.abort('blockedbyclient');
};
const reportedPlayback = new Set();
const refusedPlayback = [];
const PLAYBACK_REQUEST = /\/(?:Items\/([0-9a-f]{32})\/PlaybackInfo|Videos\/([0-9a-f]{32})\/|Audio\/([0-9a-f]{32})\/|Sessions\/Playing(?:\/Progress|\/Stopped|\/Ping)?(?:\?|$))/i;
const gatePlayback = route => {
    const request = route.request();
    const match = PLAYBACK_REQUEST.exec(new URL(request.url()).pathname + '?');
    let itemId = match?.[1] ?? match?.[2] ?? match?.[3];
    if (!itemId) {
        try { itemId = request.postDataJSON()?.ItemId; } catch { /* no JSON body */ }
    }
    if (!itemId) return route.continue();
    const id = String(itemId).replace(/-/g, '').toLowerCase();
    if (!allowedPlayback.has(id)) {
        refusedPlayback.push({ id, url: new URL(request.url()).pathname.replace(/[0-9a-f]{32}/gi, '<id>') });
        return route.abort('blockedbyclient');
    }
    reportedPlayback.add(id);
    return route.continue();
};

async function newPage(viewport, extra = {}) {
    const context = await browser.newContext({ viewport, serviceWorkers: 'block', ...extra });
    await context.route(url => PLAYBACK_REQUEST.test(url.pathname + '?'), gatePlayback);
    // Registered last, so it sees each request first and hands the allowed ones on to the playback gate.
    await context.route(url => url.host === origin.host, gateWrites);
    context.on('request', request => {
        const url = new URL(request.url());
        if (url.host === origin.host && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
            sentRequests.push({ method: request.method(), url: url.pathname + url.search, body: request.postData() ?? '' });
        }
    });
    const page = await context.newPage();
    page.errors = [];
    page.on('pageerror', error => page.errors.push(String(error.message).split('\n')[0]));
    // The server's UserDataChanged pushes this page received: without them nothing on Home refreshes after playback.
    page.userDataPushes = 0;
    // When the feeds were asked for and what they answered, for a hero wait that times out.
    page.feedLog = [];
    const started = Date.now();
    page.on('request', request => {
        const kind = /\/UserItems\/Resume/.test(request.url()) ? 'resume' : /\/Shows\/NextUp/.test(request.url()) ? 'nextup' : null;
        if (kind) page.feedLog.push(`${((Date.now() - started) / 1000).toFixed(1)} ${kind}?`);
    });
    page.on('response', async response => {
        if (!/\/UserItems\/Resume/.test(response.url())) return;
        const first = await response.json().then(body => body.Items?.[0], () => null);
        page.feedLog.push(`${((Date.now() - started) / 1000).toFixed(1)} resume= ${first?.Name} ${first?.UserData?.LastPlayedDate ?? ''}`);
    });
    page.on('websocket', socket => socket.on('framereceived', frame => {
        if (String(frame.payload).includes('"UserDataChanged"')) {
            page.userDataPushes++;
            page.feedLog.push(`${((Date.now() - started) / 1000).toFixed(1)} push`);
        }
    }));
    return { context, page };
}

const signedIn = page => page.evaluate(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } });

async function signIn(page) {
    await page.goto(webBase, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.ApiClient, undefined, { timeout: 30000 });
    await page.waitForFunction(() => {
        try { return !!ApiClient.getCurrentUserId() || /login|selectuser|selectserver/.test(location.hash); } catch { return false; }
    }, undefined, { timeout: 30000 });
    if (!await signedIn(page)) {
        const field = page.locator('#txtManualName');
        if (!await field.isVisible().catch(() => false)) {
            const chooser = page.locator('.btnManual').first();
            await chooser.waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
            if (await chooser.count()) await chooser.evaluate(node => node.click());
            await field.waitFor({ state: 'visible', timeout: 15000 });
        }
        await page.waitForTimeout(800);
        await field.fill('oleksii');
        await page.locator('#txtManualPassword').fill('');
        await page.locator('button:visible').filter({ hasText: 'Sign In' }).first().click();
        await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } }, undefined, { timeout: 30000 });
    }
    await page.waitForFunction(() => location.hash.startsWith('#/home'), undefined, { timeout: 30000 });
}

const api = (page, method, apiPath, body) => page.evaluate(async ({ method, apiPath, body }) => {
    const response = await fetch(ApiClient.getUrl(apiPath), {
        method, headers: { Authorization: `MediaBrowser Token="${ApiClient.accessToken()}"`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    let parsed = text;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    return { status: response.status, body: parsed };
}, { method, apiPath, body });

const userId = page => page.evaluate(() => ApiClient.getCurrentUserId());
const userData = async (page, id) => (await api(page, 'GET', `Items/${id}?userId=${await userId(page)}`)).body;

/** A request that must succeed: anything but 2xx throws, so a failed write is never mistaken for a done one. */
const checked = async (request, what) => {
    const response = await request;
    if (response.status < 200 || response.status >= 300) throw new Error(`${what}: HTTP ${response.status}`);
    return response;
};
const postUserData = async (page, id, data) =>
    checked(api(page, 'POST', `UserItems/${id}/UserData?userId=${await userId(page)}`, data), `user data of ${id}`);

/**
 * Every item whose user data this run changes, as it was before the first change: the one list the cleanup restores,
 * whichever step changed it and however the run ends.
 */
const ledger = new Map();
const remember = async (page, id) => {
    if (ledger.has(id)) return ledger.get(id);
    const item = await userData(page, id);
    if (!item?.UserData) throw new Error(`no user data to remember for ${id}`);
    ledger.set(id, item);
    return item;
};
/** The remembered items this run actually changed, by a write or by playing them: the only ones written back. */
const mutated = new Set();
/** Changes an item's user data, remembering how it was first. */
const writeUserData = async (page, id, data) => {
    await remember(page, id);
    mutated.add(id);
    return postUserData(page, id, data);
};

const RESTORED_FIELDS = ['Played', 'PlayCount', 'PlaybackPositionTicks', 'LastPlayedDate'];

/**
 * Whether changing an item's user data would add database rows, which the API cannot remove. Jellyfin writes a row
 * under the item's own id for every one of its user-data keys whenever it saves the item, and an item saved since the
 * 10.11 migration therefore has one keyed by its own id. One without it (older user data kept under the placeholder
 * item 00000000-…-0001, or none at all) would gain rows. Only known with the database snapshot.
 */
/**
 * Whether playing an item would leave a trace the API cannot write back: playback stores the audio and subtitle track
 * it used, and an item with none remembered yet (null in its rows) would keep the new ones. Only with the snapshot.
 */
const playingLeavesTracks = id => {
    if (!databaseBefore) return false;
    const dashed = id.toLowerCase().replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
    return readFileSync(databaseBefore, 'utf8').split('\n').filter(row => row.toLowerCase().startsWith(`${dashed}|`))
        .some(row => row.split('|')[2] === 'null' || row.split('|')[3] === 'null');
};

const addsRows = id => {
    if (!databaseBefore) return false;
    const dashed = id.toLowerCase().replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
    return !readFileSync(databaseBefore, 'utf8').split('\n').some(row => row.toLowerCase().startsWith(`${dashed}|${dashed}|`));
};
/** Writes back the fields playback and this run change, exactly as they were. */
const restore = (page, item) => postUserData(page, item.Id, {
    Played: item.UserData.Played, PlayCount: item.UserData.PlayCount, PlaybackPositionTicks: item.UserData.PlaybackPositionTicks,
    ...(item.UserData.LastPlayedDate ? { LastPlayedDate: item.UserData.LastPlayedDate } : {})
});

/** Restores every remembered item, each on its own so one failure cannot strand the rest, then reads each back. */
const restoreAll = async page => {
    const unresolved = [];
    // Writing back an item the run never changed would itself be a change (and, for an item with detached rows, one
    // the API cannot undo), so only changed items are written; every remembered item is still read back below.
    for (const item of [...ledger.values()].filter(entry => mutated.has(entry.Id) || reportedPlayback.has(entry.Id))) {
        try {
            await restore(page, item);
        } catch (error) {
            unresolved.push({ id: item.Id, name: item.Name, error: String(error?.message ?? error) });
        }
    }
    for (const item of ledger.values()) {
        try {
            const now = (await userData(page, item.Id)).UserData;
            const wrong = RESTORED_FIELDS.filter(field => now[field] !== item.UserData[field]);
            if (wrong.length) unresolved.push({ id: item.Id, name: item.Name, fields: Object.fromEntries(wrong.map(field => [field, [item.UserData[field], now[field]]])) });
        } catch (error) {
            unresolved.push({ id: item.Id, name: item.Name, error: String(error?.message ?? error) });
        }
    }
    // Kept with the results, so anything left unresolved can still be put right by hand.
    writeFileSync(path.join(out, 'restore-ledger.json'), JSON.stringify({ items: [...ledger.values()].map(item => ({ Id: item.Id, Name: item.Name, UserData: item.UserData })), unresolved }, null, 1));
    return unresolved;
};

/** This browser's own session on the server, by its device id. */
/** Every item this browser's own session was seen playing: the database check holds the run to all of them. */
const observedPlaying = new Set();
/** The server sessions of this run's own browser contexts, found by their device ids; the only ones it may command. */
const ownSessionIds = new Set();
const session = async page => {
    const deviceId = await page.evaluate(() => ApiClient.deviceId());
    const sessions = (await api(page, 'GET', `Sessions?deviceId=${encodeURIComponent(deviceId)}`)).body ?? [];
    const own = sessions.find(entry => entry.DeviceId === deviceId);
    if (own?.Id) ownSessionIds.add(String(own.Id).toLowerCase());
    if (own?.NowPlayingItem?.Id) observedPlaying.add(own.NowPlayingItem.Id);
    return own;
};

const goHome = async page => {
    await page.evaluate(() => { location.hash = '#/home'; });
    await page.waitForFunction(() => location.hash.startsWith('#/home'), undefined, { timeout: 15000 });
};

/** What the hero shows, how big it is, and the first card of Continue watching. */
const heroState = page => page.evaluate(() => {
    const hero = document.querySelector('.jfmod-homeHero');
    if (!hero) return null;
    const box = hero.getBoundingClientRect();
    const sections = [...document.querySelectorAll('.verticalSection')].filter(section => section.querySelector('.sectionTitle')?.textContent?.trim() === 'Continue Watching');
    const cards = [...sections[0]?.querySelectorAll('.card[data-id]') ?? []].map(card => card.getAttribute('data-id'));
    const url = /url\("?(.*?)"?\)/.exec(hero.style.backgroundImage)?.[1];
    return {
        title: hero.querySelector('h1')?.textContent ?? null,
        episode: hero.querySelector('.jfmod-homeHeroEpisode')?.textContent ?? null,
        overview: hero.querySelector('.jfmod-homeHeroContent > p')?.textContent?.slice(0, 80) ?? null,
        backdropItem: url ? /Items\/([0-9a-f]+)\//.exec(url)?.[1] : null,
        backdropPosition: getComputedStyle(hero).backgroundPosition,
        more: hero.querySelector('.jfmod-homeHeroActions a')?.getAttribute('href'),
        heroId: /[?&]id=([0-9a-f]+)/.exec(hero.querySelector('.jfmod-homeHeroActions a')?.getAttribute('href') ?? '')?.[1] ?? null,
        box: { top: Math.round(box.top), width: Math.round(box.width), height: Math.round(box.height) },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        firstCardId: cards[0] ?? null,
        rowIds: cards
    };
});

/**
 * The card the hero should be: the first movie or episode in the row that has a backdrop to show (an episode's comes
 * from its series), read from the server. A card without one — another session's fixture, say — is passed over.
 */
const firstWithBackdrop = async (page, ids) => {
    const uid = await userId(page);
    for (const id of ids) {
        const item = (await api(page, 'GET', `Items/${id}?userId=${uid}`)).body;
        let tag = item?.Type === 'Episode' ? item.ParentBackdropImageTags?.[0] : item?.Type === 'Movie' ? item.BackdropImageTags?.[0] : undefined;
        // An episode with artwork of its own carries no inherited pair; its series' backdrop is the one the hero shows.
        if (!tag && item?.Type === 'Episode' && item.SeriesId) tag = (await api(page, 'GET', `Items/${item.SeriesId}?userId=${uid}`)).body?.BackdropImageTags?.[0];
        if (tag) return { id, skipped: ids.slice(0, ids.indexOf(id)) };
    }
    return { id: null, skipped: ids };
};

const waitHero = async (page, predicate = () => true, label = 'the hero') => {
    let last = null;
    try {
        return await until(async () => {
            last = await heroState(page);
            return last && predicate(last) ? last : null;
        }, { timeout: 45000, label });
    } catch (error) {
        // Say what the hero did show, so a timeout explains itself.
        throw new Error(`${error.message}; the hero showed ${JSON.stringify(last && { title: last.title, episode: last.episode, heroId: last.heroId, rowIds: last.rowIds?.slice(0, 4) })}; UserDataChanged pushes received: ${page.userDataPushes}; feeds: ${page.feedLog.slice(-8).join(' | ')}`);
    }
};

/** Waits for the video to advance, then lets it play for `seconds`. */
const playFor = async (page, seconds) => {
    await until(() => page.evaluate(() => {
        const video = document.querySelector('video');
        return video && !video.paused && video.currentTime > 0.5;
    }), { timeout: 90000, label: 'the video to play' });
    await page.waitForTimeout(seconds * 1000);
};

/** Back out of the player and wait until the server has the session stopped. */
const stop = async page => {
    await page.goBack();
    await until(async () => !(await session(page))?.NowPlayingItem, { timeout: 45000, label: 'playback to stop' });
    await page.waitForTimeout(2500);
};

/**
 * Makes sure nothing of this run is still playing before user data is written back: a stop report arriving after the
 * restore would overwrite it. Asks the server to stop this browser's session if a step failed mid-playback.
 */
const ensureStopped = async page => {
    const current = await session(page).catch(() => null);
    if (current?.NowPlayingItem) {
        await api(page, 'POST', `Sessions/${current.Id}/Playing/Stop`).catch(() => {});
        await page.evaluate(() => { location.hash = '#/home'; }).catch(() => {});
    }
    return until(async () => !(await session(page))?.NowPlayingItem, { timeout: 45000, label: 'playback to stop before restoring' })
        .then(() => true, () => false);
};

/** Waits for this session to report what it plays; anything but the expected item is stopped and ends the run. */
const nowPlaying = async (page, expectedId) => {
    const now = await until(async () => {
        const current = await session(page);
        return current?.NowPlayingItem ? current : null;
    }, { timeout: 90000, every: 1500, label: 'the server session to report the item' });
    if (now.NowPlayingItem.Id !== expectedId) {
        await ensureStopped(page);
        throw new Error(`playing ${now.NowPlayingItem.Id} (${now.NowPlayingItem.Name}), not the expected ${expectedId}; stopped`);
    }
    return now;
};

const playFromDetails = async (page, id) => {
    await page.evaluate(itemId => { location.hash = '#/details?id=' + itemId; }, id);
    const play = page.locator('.mainDetailButtons .btnPlay:not(.hide)').first();
    await play.waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(1200);
    await play.click();
    await nowPlaying(page, id);
    await playFor(page, 6);
    await stop(page);
};

/** Presses the hero's Play only when the hero shows the expected item, so the run never plays one it did not snapshot. */
const clickHeroPlay = async (page, expectedId) => {
    // Checked and pressed in one task in the page, so the hero cannot change between the check and the press.
    const shown = await page.evaluate(expected => {
        const hero = document.querySelector('.jfmod-homeHero');
        const id = /[?&]id=([0-9a-f]+)/.exec(hero?.querySelector('.jfmod-homeHeroActions a')?.getAttribute('href') ?? '')?.[1] ?? null;
        if (id === expected) hero.querySelector('.jfmod-homeHeroActions .button-submit').click();
        return { id, title: hero?.querySelector('h1')?.textContent ?? null };
    }, expectedId);
    if (shown.id !== expectedId) throw new Error(`the hero shows ${shown.id} (${shown.title}), not the expected ${expectedId}; Play not pressed`);
    return nowPlaying(page, expectedId);
};

const displayName = item => item.Type === 'Episode' ? `S${item.ParentIndexNumber}:E${item.IndexNumber} - ${item.Name}` : item.Name;

const { context, page } = await newPage({ width: 1920, height: 1080 });
let runStart = new Date().toISOString();
let databaseBefore = null;
const databaseCheck = process.env.JELLYFINMOD_SSH_HOST && process.env.JELLYFINMOD_DATA_DIR;
const databaseTool = path.join(path.dirname(new URL(import.meta.url).pathname), 'userdata-db.mjs');
if (databaseCheck) {
    databaseBefore = path.join(out, 'userdata-before.txt');
    // The attribution window opens with the baseline (a few seconds early for the two clocks), not before it.
    runStart = new Date(Date.now() - 5000).toISOString();
    execFileSync(process.execPath, [databaseTool, 'snapshot', databaseBefore], { stdio: 'pipe' });
}
try {
    await signIn(page);
    // Checked before anything is remembered, so a refused item is never written to, not even to restore it.
    if (playingLeavesTracks(EPISODE) || playingLeavesTracks(MOVIE)) {
        throw new Error('the episode or the movie has no remembered audio and subtitle tracks; playing it would set ones the API cannot clear');
    }
    if (addsRows(EPISODE) || addsRows(MOVIE)) {
        throw new Error('the episode or the movie has never been saved since the 10.11 migration; playing it would add rows the API cannot remove');
    }
    const episode = await remember(page, EPISODE);
    const movie = await remember(page, MOVIE);
    // Playback sets LastPlayedDate, and the API cannot set it back to empty, so only items already played are used.
    if (!episode.UserData.LastPlayedDate || !movie.UserData.LastPlayedDate) {
        throw new Error('the episode and the movie must both have been played before (a LastPlayedDate), so playing them can be undone exactly');
    }
    allowedPlayback.add(EPISODE);
    allowedPlayback.add(MOVIE);
    record('setup', 'Snapshot of the two items taken; both restorable exactly', true, {
        episode: { name: displayName(episode), series: episode.SeriesName, userData: episode.UserData },
        movie: { name: movie.Name, userData: movie.UserData }
    });

    if (only.includes('a')) {
        await playFromDetails(page, EPISODE);
        record('a', 'The episode as the server has it after a few seconds of play', 'INFO', (await userData(page, EPISODE)).UserData);
        await goHome(page);
        const hero = await waitHero(page, state => state.episode !== null && state.title === episode.SeriesName, 'the episode hero');
        record('a', 'Hero shows the series of the partly watched episode', hero.title === episode.SeriesName, hero);
        record('a', 'Episode line under it in the card form', hero.episode === displayName(episode), { episode: hero.episode });
        record('a', 'Backdrop is the series\'', hero.backdropItem === (episode.ParentBackdropItemId ?? episode.SeriesId), { backdropItem: hero.backdropItem });
        const expectedA = await firstWithBackdrop(page, hero.rowIds);
        record('a', 'Hero is the first Continue watching card with a backdrop', hero.heroId === EPISODE && expectedA.id === EPISODE, { heroId: hero.heroId, ...expectedA });
        record('a', 'More info opens the episode', String(hero.more).includes(EPISODE), { more: hero.more });
        await page.screenshot({ path: path.join(out, 'a-episode-hero-1920.png') });
        const savedTicks = (await userData(page, EPISODE)).UserData.PlaybackPositionTicks;
        const now = await clickHeroPlay(page, EPISODE);
        const startedTicks = now.PlayState?.PositionTicks ?? 0;
        record('a', 'Play: server session NowPlayingItem is that episode', now.NowPlayingItem.Id === EPISODE,
            { nowPlaying: now.NowPlayingItem.Id, type: now.NowPlayingItem.Type });
        // Resumed, not restarted: the first reported position sits at the saved one, allowing for a few seconds played.
        record('a', 'Play resumes the episode at its saved position', savedTicks > 0 && startedTicks >= savedTicks - 5e7 && startedTicks <= savedTicks + 30e7,
            { savedSeconds: Math.round(savedTicks / 1e7), positionSeconds: Math.round(startedTicks / 1e7) });
        await playFor(page, 3);
        await stop(page);
    }

    if (only.includes('finish')) {
        // Finish the episode for real: resume it from 95% and stop there, which the server records as watched.
        await goHome(page);
        await waitHero(page, state => state.title === episode.SeriesName, 'the episode hero');
        const resumeRefetched = page.waitForResponse(response => response.url().includes('/UserItems/Resume'), { timeout: 30000 });
        await writeUserData(page, EPISODE, { PlaybackPositionTicks: Math.round(episode.RunTimeTicks * 0.95) });
        await resumeRefetched;
        await page.waitForTimeout(1500);
        await page.evaluate(() => { window.jfmodNoReload = true; });
        const now = await clickHeroPlay(page, EPISODE);
        record('finish', 'Play resumes the episode at 95%', now.NowPlayingItem.Id === EPISODE && (now.PlayState?.PositionTicks ?? 0) >= episode.RunTimeTicks * 0.9,
            { positionSeconds: Math.round((now.PlayState?.PositionTicks ?? 0) / 1e7), runtimeSeconds: Math.round(episode.RunTimeTicks / 1e7) });
        await playFor(page, 4);
        await stop(page);
        const finished = (await userData(page, EPISODE)).UserData;
        record('finish', 'Server recorded the episode as watched', finished.Played === true, finished);
        await goHome(page);
        const moved = await waitHero(page, state => !(state.title === episode.SeriesName && state.episode === displayName(episode)), 'the hero to move on');
        const stillSamePage = await page.evaluate(() => window.jfmodNoReload === true);
        record('finish', 'Hero moved on from the finished episode without a reload', stillSamePage, moved);
        const settled = await waitHero(page, state => !!state.firstCardId && !state.rowIds.includes(EPISODE) && state.heroId !== EPISODE, 'Continue watching to move on');
        const expectedFinish = await firstWithBackdrop(page, settled.rowIds);
        record('finish', 'Hero is the new first Continue watching card with a backdrop', settled.heroId === expectedFinish.id && settled.heroId !== EPISODE,
            { heroId: settled.heroId, title: settled.title, ...expectedFinish });
        await page.screenshot({ path: path.join(out, 'finish-moved-on-1920.png') });
        await restore(page, episode);
    }

    if (only.includes('b')) {
        await restore(page, episode);
        await playFromDetails(page, MOVIE);
        const saved = (await userData(page, MOVIE)).UserData;
        await goHome(page);
        const hero = await waitHero(page, state => state.title === movie.Name, 'the movie hero');
        record('b', 'Hero shows the partly watched movie, more recent than any episode', hero.title === movie.Name && hero.episode === null, hero);
        const expectedB = await firstWithBackdrop(page, hero.rowIds);
        record('b', 'Hero is the first Continue watching card with a backdrop', hero.heroId === MOVIE && expectedB.id === MOVIE, { heroId: hero.heroId, ...expectedB });
        await page.screenshot({ path: path.join(out, 'b-movie-hero-1920.png') });
        const now = await clickHeroPlay(page, MOVIE);
        await playFor(page, 3);
        const playing = await session(page);
        const position = playing?.PlayState?.PositionTicks ?? 0;
        record('b', 'Play resumes the movie near the saved position', now.NowPlayingItem.Id === MOVIE && Math.abs(position - saved.PlaybackPositionTicks) < 120e7, {
            nowPlaying: now.NowPlayingItem.Id, savedSeconds: Math.round(saved.PlaybackPositionTicks / 1e7), positionSeconds: Math.round(position / 1e7)
        });
        await stop(page);
        // The invalidation on its own, with no navigation: a user-data change pushed by the server while Home stays
        // open must move the hero. Writing the movie's old state back makes it older than the rest again.
        await goHome(page);
        await waitHero(page, state => state.heroId === MOVIE, 'the movie hero again');
        await page.evaluate(() => { window.jfmodNoReload = true; });
        await restore(page, movie);
        const moved = await waitHero(page, state => !!state.heroId && state.heroId !== MOVIE, 'the hero to follow a server user-data change');
        const expectedMoved = await firstWithBackdrop(page, moved.rowIds);
        record('b', 'With Home left open, a server user-data change moves the hero (UserDataChanged invalidation)',
            await page.evaluate(() => window.jfmodNoReload === true && location.hash.startsWith('#/home')) && moved.heroId === expectedMoved.id,
            { heroId: moved.heroId, title: moved.title, ...expectedMoved });
    }

    if (only.includes('nextup')) {
        // Next Up is ordered by when the user last watched the show (user, 2026-10-08): re-watching an episode of a show
        // whose next episode is old in the library must put that next episode first, ahead of older resumed titles.
        if (!SHOW_EPISODE) throw new Error('nextup needs JELLYFINMOD_HERO_SHOW_EPISODE');
        await restore(page, episode);
        await restore(page, movie);
        const uid = await userId(page);
        if (playingLeavesTracks(SHOW_EPISODE)) {
            throw new Error('JELLYFINMOD_HERO_SHOW_EPISODE has no remembered audio and subtitle tracks; re-watching it would set ones the API cannot clear');
        }
        if (addsRows(SHOW_EPISODE)) {
            throw new Error('JELLYFINMOD_HERO_SHOW_EPISODE has never been saved since the 10.11 migration; re-watching it would add rows the API cannot remove. Pick an episode played since then');
        }
        const watched = await remember(page, SHOW_EPISODE);
        if (watched.Type !== 'Episode' || watched.UserData.Played !== true || !watched.UserData.LastPlayedDate) {
            throw new Error('JELLYFINMOD_HERO_SHOW_EPISODE must be a played episode with a play date, so re-watching it can be undone exactly');
        }
        allowedPlayback.add(SHOW_EPISODE);
        const nextOf = async () => (await checked(api(page, 'GET', `Shows/NextUp?userId=${uid}&seriesId=${watched.SeriesId}&enableResumable=false&limit=1`), 'Next Up of the show')).body.Items?.[0];
        const nextBefore = await nextOf();
        // Resumed from 95 % and stopped: the server records the episode watched again, now, and the show's next
        // episode stays the same one.
        await writeUserData(page, SHOW_EPISODE, { Played: false, PlaybackPositionTicks: Math.round(watched.RunTimeTicks * 0.95) });
        await playFromDetails(page, SHOW_EPISODE);
        const rewatched = (await userData(page, SHOW_EPISODE)).UserData;
        const nextNow = await nextOf();
        record('nextup', `${watched.SeriesName}: the episode is watched again now and the show's next episode is unchanged`,
            rewatched.Played === true && Date.parse(rewatched.LastPlayedDate) > Date.parse(watched.UserData.LastPlayedDate) && !!nextNow && nextNow.Id === nextBefore?.Id,
            { lastPlayed: rewatched.LastPlayedDate, next: nextNow && displayName(nextNow) });
        const nextItem = (await api(page, 'GET', `Items/${nextNow.Id}?userId=${uid}&fields=DateCreated`)).body;
        // Under the previous rule the next episode was ordered by its own play date, else when it was added.
        const oldKey = nextItem.UserData?.LastPlayedDate ?? nextItem.DateCreated;
        const resumed = (await api(page, 'GET', `UserItems/Resume?userId=${uid}&limit=12&mediaTypes=Video&fields=DateCreated`)).body.Items;
        const when = date => (date ? Date.parse(date) : Number.NEGATIVE_INFINITY);
        const wouldLead = resumed.filter(item => when(item.UserData?.LastPlayedDate ?? item.DateCreated) > when(oldKey));
        record('nextup', 'Under the previous rule older resumed titles would have led it', wouldLead.length > 0,
            { nextAdded: nextItem.DateCreated, nextOwnPlayed: nextItem.UserData?.LastPlayedDate ?? null, wouldLead: wouldLead.map(item => item.SeriesName ?? item.Name) });
        await goHome(page);
        const hero = await waitHero(page, state => state.heroId === nextNow.Id, `${watched.SeriesName}'s next episode as the hero`);
        const laterResumed = wouldLead.map(item => item.Id).filter(id => hero.rowIds.includes(id));
        record('nextup', 'Its Next Up card leads Continue watching, ahead of the older resumed titles',
            hero.rowIds[0] === nextNow.Id && laterResumed.length > 0 && laterResumed.every(id => hero.rowIds.indexOf(id) > 0),
            { first: hero.rowIds[0], resumedAfterIt: laterResumed.length });
        record('nextup', 'The hero shows that show and its next episode', hero.title === watched.SeriesName && hero.episode === displayName(nextItem),
            { title: hero.title, episode: hero.episode });
        await page.screenshot({ path: path.join(out, 'nextup-show-leads-1920.png') });
        await restore(page, watched);
    }

    if (only.includes('c')) {
        await restore(page, episode);
        await restore(page, movie);
        const uid = await userId(page);
        const resume = (await api(page, 'GET', `UserItems/Resume?userId=${uid}&limit=100&mediaTypes=Video`)).body.Items;
        const positions = resume.map(item => ({ Id: item.Id, ticks: item.UserData.PlaybackPositionTicks }));
        const detached = positions.filter(item => addsRows(item.Id));
        if (detached.length) throw new Error(`resume items never saved since the 10.11 migration cannot be cleared and restored exactly: ${detached.map(item => item.Id).join(', ')}`);
        writeFileSync(path.join(out, 'c-resume-positions.json'), JSON.stringify(positions, null, 1));
        try {
            for (const item of positions) await writeUserData(page, item.Id, { PlaybackPositionTicks: 0 });  // each remembered first
            await page.evaluate(id => localStorage.setItem(`${id}-maxDaysForNextUp`, '0'), uid);
            const today = new Date().toISOString().slice(0, 10);
            const left = (await api(page, 'GET', `UserItems/Resume?userId=${uid}&limit=12&mediaTypes=Video`)).body.Items.length;
            const nextUpIds = (await api(page, 'GET', `Shows/NextUp?userId=${uid}&limit=24&enableResumable=false&nextUpDateCutoff=${today}`)).body.Items.map(item => item.Id);
            // Another session on the shared instance may have played something today; what it leaves in Next Up must
            // at least have no backdrop, so that nothing the hero could show is in progress.
            const showable = await firstWithBackdrop(page, nextUpIds);
            record('c', 'Nothing in progress the hero could show: resume empty, Next Up (0-day setting) empty or backdrop-less',
                left === 0 && showable.id === null, { resume: left, nextUp: nextUpIds.length, backdropLess: showable.skipped });
            const newest = (await api(page, 'GET', `Items?userId=${uid}&recursive=true&includeItemTypes=Movie,Series&fields=RecursiveItemCount&enableImageTypes=Backdrop&imageTypeLimit=1&sortBy=DateCreated&sortOrder=Descending&limit=200`)).body.Items
                .find(item => item.BackdropImageTags?.length && (item.Type === 'Movie' || item.RecursiveItemCount > 0));
            await page.reload({ waitUntil: 'domcontentloaded' });
            const hero = await waitHero(page, state => state.title === newest.Name, 'the newest-title hero');
            record('c', 'Hero falls back to the newest title with a backdrop and a file', hero.title === newest.Name && hero.episode === null, { expected: newest.Name, hero });
            await page.screenshot({ path: path.join(out, 'c-newest-hero-1920.png') });
        } finally {
            // Each on its own, so one failed write cannot leave the others cleared; the final cleanup retries any of them.
            for (const item of positions) {
                await postUserData(page, item.Id, { PlaybackPositionTicks: item.ticks })
                    .catch(error => record('c', `restore ${item.Id}`, 'FAIL', String(error?.message ?? error)));
            }
            await page.evaluate(id => localStorage.removeItem(`${id}-maxDaysForNextUp`), uid);
            const back = (await api(page, 'GET', `UserItems/Resume?userId=${uid}&limit=100&mediaTypes=Video`)).body.Items;
            record('c', 'Resume positions written back', positions.every(item => back.find(entry => entry.Id === item.Id)?.UserData.PlaybackPositionTicks === item.ticks),
                { count: positions.length });
        }
    }

    if (only.includes('sections')) {
        // The hero and the row read only the feeds whose sections the user shows on Home. Both feeds are cached first,
        // so a disabled query handing back cached data (the shared-cache fault) would show up in the row and the hero.
        await restore(page, episode);
        await restore(page, movie);
        const uid = await userId(page);
        const prefsPath = `DisplayPreferences/usersettings?userId=${uid}&client=emby`;
        const original = (await api(page, 'GET', prefsPath)).body;
        writeFileSync(path.join(out, 'sections-displayprefs.json'), JSON.stringify(original, null, 1));
        const keyOf = value => Object.keys(original.CustomPrefs ?? {}).find(key => /^homesection\d$/.test(key) && original.CustomPrefs[key] === value);
        // The two feeds exactly as the app asks for them (same limits, the user's Next Up cutoff and rewatching setting).
        const feedIds = async () => {
            const nextUpOptions = await page.evaluate(id => {
                const days = parseInt(localStorage.getItem(`${id}-maxDaysForNextUp`) ?? '', 10);
                const cutoff = new Date();
                cutoff.setDate(cutoff.getDate() - (days === 0 ? 0 : days || 365));
                return { cutoff: cutoff.toISOString().split('T')[0], rewatching: localStorage.getItem(`${id}-enableRewatchingInNextUp`) === 'true' };
            }, uid);
            const resume = (await checked(api(page, 'GET', `UserItems/Resume?userId=${uid}&limit=12&mediaTypes=Video&enableTotalRecordCount=false`), 'resume feed')).body.Items;
            const nextUp = (await checked(api(page, 'GET', `Shows/NextUp?userId=${uid}&limit=24&enableResumable=false&enableTotalRecordCount=false&nextUpDateCutoff=${nextUpOptions.cutoff}&enableRewatching=${nextUpOptions.rewatching}`), 'Next Up feed')).body.Items;
            return { resume: new Set(resume.map(item => item.Id)), nextup: new Set(nextUp.map(item => item.Id)) };
        };
        try {
            await goHome(page);
            // The feeds first, then a row that shows cards from each, so another session changing its own items in between
            // cannot leave the check without a sentinel.
            let both = await feedIds();
            const holdsBoth = state => !!state.firstCardId && state.rowIds.some(id => both.nextup.has(id) && !both.resume.has(id))
                && state.rowIds.some(id => both.resume.has(id) && !both.nextup.has(id));
            const warm = await waitHero(page, holdsBoth, 'the row with cards from both feeds').catch(async () => {
                both = await feedIds();
                return waitHero(page, holdsBoth, 'the row with cards from both feeds');
            });
            for (const [hide, keep] of [['nextup', 'resume'], ['resume', 'nextup']]) {
                const key = keyOf(hide);
                if (!key) {
                    record('sections', `${hide} is one of the user's Home sections`, 'NOT VERIFIED', original.CustomPrefs);
                    continue;
                }
                await checked(api(page, 'POST', prefsPath, { ...original, CustomPrefs: { ...original.CustomPrefs, [key]: 'none' } }), 'Home settings');
                const keptIds = both[keep];
                // Sentinels: cards the row drew from the feed about to be hidden, and only from it. They are in the
                // cache, so a hidden feed leaking through the shared cache would bring them back.
                const sentinels = warm.rowIds.filter(id => both[hide].has(id) && !keptIds.has(id));
                if (!sentinels.length) {
                    record('sections', `${hide}: a card only that feed supplies is in the row before hiding it`, 'NOT VERIFIED', { rowIds: warm.rowIds });
                    continue;
                }
                // The app reads display preferences through the query cache (60 s fresh), so the reload waits that out;
                // the feeds' own cache entries stay persisted across it, which is the case under test.
                await page.waitForTimeout(62000);
                await page.reload({ waitUntil: 'domcontentloaded' });
                const hero = await waitHero(page, state => !!state.heroId && !!state.firstCardId, `the hero with ${hide} hidden`);
                const rowIds = await page.evaluate(() => {
                    const section = [...document.querySelectorAll('.verticalSection')].find(node => node.querySelector('.sectionTitle')?.textContent?.trim() === 'Continue Watching');
                    return [...section?.querySelectorAll('.card[data-id]') ?? []].map(card => card.getAttribute('data-id'));
                });
                const foreign = rowIds.filter(id => !keptIds.has(id));
                const leaked = rowIds.filter(id => sentinels.includes(id));
                record('sections', `${hide} hidden from Home: the hero and every row card come from ${keep} only, and none of its ${sentinels.length} cached cards return`,
                    keptIds.has(hero.heroId) && !sentinels.includes(hero.heroId) && rowIds.length > 0 && foreign.length === 0 && leaked.length === 0,
                    { heroId: hero.heroId, title: hero.title, rowCards: rowIds.length, sentinels: sentinels.length, foreign, leaked });
                await page.screenshot({ path: path.join(out, `sections-${hide}-hidden-1920.png`) });
            }
        } finally {
            await checked(api(page, 'POST', prefsPath, original), 'Home settings');
            const back = (await api(page, 'GET', prefsPath)).body;
            record('sections', 'Home settings written back exactly', JSON.stringify(back.CustomPrefs) === JSON.stringify(original.CustomPrefs),
                Object.fromEntries(Object.entries(back.CustomPrefs ?? {}).filter(([key]) => key.startsWith('homesection'))));
        }
    }
} catch (error) {
    record('run', 'step', 'NOT VERIFIED', String(error?.message ?? error).split('\n')[0]);
} finally {
    const stopped = await ensureStopped(page);
    record('restore', 'Playback stopped before user data is written back', stopped);
    // A stop report still in flight lands before the restore, never after it.
    await page.waitForTimeout(3000);
    const unresolved = await restoreAll(page).catch(error => [{ error: String(error?.message ?? error) }]);
    record('restore', `All ${ledger.size} changed items written back and read back equal`, unresolved.length === 0, { unresolved });
    record('run', 'No page errors on the desktop page', page.errors.length === 0, page.errors.slice(0, 3));
    await context.close();
}

// (d) The hero's size across layouts, on the natural state.
const LAYOUTS = [
    { name: 'desktop-1280', viewport: { width: 1280, height: 800 } },
    { name: 'desktop-1920', viewport: { width: 1920, height: 1080 } },
    { name: 'desktop-2000', viewport: { width: 2000, height: 1125 } },
    { name: 'desktop-2560', viewport: { width: 2560, height: 1440 } },
    { name: 'mobile-390', viewport: { width: 390, height: 844 }, extra: { isMobile: true, hasTouch: true,
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36' } },
    { name: 'mobile-844-landscape', viewport: { width: 844, height: 390 }, extra: { isMobile: true, hasTouch: true,
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36' } },
    { name: 'tv-1920', viewport: { width: 1920, height: 1080 }, tv: true },
    { name: 'tv-1280', viewport: { width: 1280, height: 720 }, tv: true }
];
// The hero's rules before this change (P7.S6 2026-09-21), restored inside the page for the "before" capture only.
const OLD_HERO_CSS = '.jfmod-homeHero.jfmod-homeHero.jfmod-homeHero { height: auto !important; max-height: none !important; background-position: center 20% !important; }'
    + ' .layout-mobile .jfmod-homeHero.jfmod-homeHero.jfmod-homeHero { min-height: 29em !important; }'
    + ' .layout-mobile .jfmod-homeHeroContent.jfmod-homeHeroContent { padding-bottom: 3.5em !important; }'
    + ' .layout-mobile .jfmod-homeHeroContent.jfmod-homeHeroContent p { -webkit-line-clamp: 3 !important; }';

const measure = page => page.evaluate(async () => {
    const element = document.querySelector('.jfmod-homeHero');
    const url = /url\("?(.*?)"?\)/.exec(element.style.backgroundImage)?.[1];
    const image = new Image();
    image.src = url;
    await image.decode();
    const box = element.getBoundingClientRect();
    const scale = Math.max(box.width / image.naturalWidth, box.height / image.naturalHeight);
    const visible = selector => {
        const rect = document.querySelector(selector)?.getBoundingClientRect();
        return rect ? rect.top >= 0 && rect.bottom <= window.innerHeight : false;
    };
    return {
        top: Math.round(box.top), width: Math.round(box.width), height: Math.round(box.height),
        viewport: `${window.innerWidth}x${window.innerHeight}`, natural: `${image.naturalWidth}x${image.naturalHeight}`,
        shownHeightFraction: Math.round(box.height / (image.naturalHeight * scale) * 100) / 100,
        shownWidthFraction: Math.round(box.width / (image.naturalWidth * scale) * 100) / 100,
        rootFontPx: parseFloat(getComputedStyle(document.documentElement).fontSize),
        heroFontPx: parseFloat(getComputedStyle(element).fontSize),
        layoutClass: ['layout-tv', 'layout-mobile', 'layout-desktop'].find(name => document.documentElement.classList.contains(name)),
        backdropPosition: getComputedStyle(element).backgroundPosition,
        titleOnScreen: visible('#jfmod-homeHero-title'), playOnScreen: visible('.jfmod-homeHeroActions .button-submit'),
        // Inside the hero's own box, whatever sits above the hero on the page.
        contentInHero: ['#jfmod-homeHero-title', '.jfmod-homeHeroActions .button-submit'].every(selector => {
            const rect = document.querySelector(selector)?.getBoundingClientRect();
            return rect ? rect.top >= box.top && rect.bottom <= box.bottom : false;
        })
    };
});

const layoutFilter = process.env.JELLYFINMOD_HERO_LAYOUTS?.split(',');
if (only.includes('d')) for (const layout of LAYOUTS.filter(entry => !layoutFilter || layoutFilter.includes(entry.name))) {
    const { context: layoutContext, page: layoutPage } = await newPage(layout.viewport, layout.extra);
    try {
        await signIn(layoutPage);
        if (layout.tv) {
            await layoutPage.evaluate(() => localStorage.setItem('layout', 'tv'));
            await layoutPage.reload({ waitUntil: 'domcontentloaded' });
            await layoutPage.waitForFunction(() => location.hash.startsWith('#/home'), undefined, { timeout: 30000 });
        }
        const hero = await waitHero(layoutPage);
        await layoutPage.waitForTimeout(2000);
        const after = await measure(layoutPage);
        // The rules, worked by hand: height = ratio × width, capped at 80vh, floored at the layout's em minimum (none on
        // a phone on its side), plus the 3em top padding the box carries under the top bar.
        const rule = layout.tv ? { ratio: 0.435, floorEm: 37 } : layout.extra?.isMobile ?
            { ratio: 0.5625, floorEm: layout.viewport.height <= 480 ? 0 : 29 } : { ratio: 0.435, floorEm: 34 };
        const font = after.heroFontPx;
        const expectedHeight = Math.max(rule.floorEm * font, Math.min(rule.ratio * layout.viewport.width, 0.8 * layout.viewport.height)) + 3 * font;
        record(`d ${layout.name}`, 'Hero height is the width rule (within 2 px)', Math.abs(after.height - expectedHeight) <= 2,
            { height: after.height, expected: Math.round(expectedHeight), rule });
        if (!layout.tv && !layout.extra?.isMobile) {
            record(`d ${layout.name}`, 'Desktop shows at least three quarters of the backdrop\'s height', after.shownHeightFraction >= 0.75,
                { shownHeightFraction: after.shownHeightFraction });
        }
        // Desktop and mobile: title and Play sit inside the hero and the hero fits the screen, so at the top of Home they
        // are in view whatever sits above the hero (the plugin's setup banner can, on an instance not yet set up). TV:
        // in view after first focus has scrolled.
        const fits = layout.tv ? after.titleOnScreen && after.playOnScreen : after.contentInHero && after.height <= layout.viewport.height;
        record(`d ${layout.name}`, layout.tv ? 'Title and Play on screen' : 'Title and Play inside the hero, and the hero fits the screen', fits,
            { ...after, title: hero.title, episode: hero.episode });
        await layoutPage.screenshot({ path: path.join(out, `d-${layout.name}.png`) });
        if (layout.tv) {
            const focus = () => layoutPage.evaluate(() => {
                const active = document.activeElement;
                return { inHero: !!active?.closest('.jfmod-homeHero'), text: active?.textContent?.trim().slice(0, 30), card: active?.closest('.card')?.getAttribute('data-id') ?? null };
            });
            const first = await until(async () => { const value = await focus(); return value.inHero ? value : null; }, { timeout: 10000, label: 'TV first focus on the hero' }).catch(() => null);
            record(`d ${layout.name}`, 'TV: first focus is the hero\'s Play', first?.inHero === true && /Play/.test(first?.text ?? ''), first);
            await layoutPage.keyboard.press('ArrowDown');
            await layoutPage.waitForTimeout(1200);
            const down = await focus();
            const cardOnScreen = await layoutPage.evaluate(() => {
                const card = document.activeElement?.getBoundingClientRect();
                return card ? card.top >= 0 && card.bottom <= window.innerHeight : false;
            });
            record(`d ${layout.name}`, 'TV: Down moves into the first row, and the focused card is on screen', !!down.card && cardOnScreen, down);
            await layoutPage.screenshot({ path: path.join(out, `d-${layout.name}-down.png`) });
            // Up walks back to the hero; the plugin's setup banner, when the instance shows one, sits in between.
            const walk = [];
            for (let press = 0; press < 3; press++) {
                await layoutPage.keyboard.press('ArrowUp');
                await layoutPage.waitForTimeout(1000);
                const now = await focus();
                walk.push(now.inHero ? 'hero' : now.text);
                if (now.inHero) break;
            }
            const back = await measure(layoutPage);
            record(`d ${layout.name}`, 'TV: Up returns to the hero, title and Play on screen', walk.at(-1) === 'hero' && back.titleOnScreen && back.playOnScreen,
                { walk, top: back.top });
            // Up once more reaches the bar, whose focused button must still show its ring now that the bar is transparent.
            await layoutPage.keyboard.press('ArrowUp');
            await layoutPage.waitForTimeout(1000);
            const barFocus = await layoutPage.evaluate(() => {
                const active = document.activeElement;
                const header = active?.closest('.skinHeader');
                if (!header) return { inBar: false, text: active?.textContent?.trim().slice(0, 30) ?? null };
                const focused = getComputedStyle(active);
                const sibling = [...header.querySelectorAll('button, a')].find(element => element !== active && element.getBoundingClientRect().width > 0);
                const resting = sibling ? getComputedStyle(sibling) : null;
                const look = style => style && [style.backgroundColor, style.color, style.boxShadow, style.outlineStyle, style.transform].join(' | ');
                return { inBar: true, text: active.textContent.trim().slice(0, 30) || active.getAttribute('aria-label') || active.title,
                    focused: look(focused), resting: look(resting), differs: !!resting && look(focused) !== look(resting) };
            });
            record(`d ${layout.name}`, 'TV: Up from the hero reaches the bar, and its focused button looks focused', barFocus.inBar && barFocus.differs, barFocus);
            await layoutPage.screenshot({ path: path.join(out, `d-${layout.name}-bar-focus.png`) });
            if (layout.name === 'tv-1920') {
                // Home opened over a stale cache (older than the client's one-minute staleness) whose refetches take
                // longer than the first-focus window: the hero is picked from the cache, so Play takes the first focus
                // before the feeds answer, rather than a row taking it and the hero then arriving above the ring.
                await layoutPage.waitForTimeout(61000);
                const held = [];
                const FEEDS = /\/UserItems\/Resume|\/Shows\/NextUp|\/Items\?.*sortBy=DatePlayed/i;
                const slowFeeds = async route => {
                    const started = Date.now();
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    held.push({ path: new URL(route.request().url()).pathname, releasedAt: Date.now(), heldMs: Date.now() - started });
                    return route.fallback();
                };
                const isFeed = url => url.host === origin.host && FEEDS.test(url.pathname + url.search);
                await layoutContext.route(isFeed, slowFeeds);
                const reloadedAt = Date.now();
                await layoutPage.reload({ waitUntil: 'domcontentloaded' });
                const stale = await until(async () => { const value = await focus(); return value.inHero || value.card ? { ...value, at: Date.now() } : null; },
                    { timeout: 15000, every: 100, label: 'TV first focus over a stale cache' }).catch(() => null);
                await layoutPage.waitForTimeout(6000);
                await layoutContext.unroute(isFeed, slowFeeds);
                const firstRelease = Math.min(...held.map(entry => entry.releasedAt));
                record(`d ${layout.name}`, 'TV over a stale cache with slow refetches: Play takes the first focus before the feeds answer',
                    held.length > 0 && stale?.inHero === true && stale.at < firstRelease,
                    { focus: stale && { inHero: stale.inHero, text: stale.text, card: stale.card, afterReloadMs: stale.at - reloadedAt },
                        refetches: held.map(entry => ({ path: entry.path, releasedAfterReloadMs: entry.releasedAt - reloadedAt })) });
                const settledFocus = await focus();
                record(`d ${layout.name}`, 'TV over a stale cache: once the feeds answer, focus is still in the hero', settledFocus.inHero, settledFocus);
            }
            await layoutPage.evaluate(() => localStorage.removeItem('layout'));
        }
        // The bar once Home is scrolled: frosted glass on computer and phone, transparent on TV with its gradient scrim
        // as the only treatment (user, 2026-10-08). Here only what each layout draws; how much shows through and how the
        // text reads, the glass step measures from the pixels.
        const bar = await layoutPage.evaluate(async tv => {
            // The TV's header scrolls away with the page, so it is read just past the 40 px at which it used to turn
            // solid, while still on screen.
            window.scrollTo(0, tv ? 60 : 600);
            await new Promise(resolve => setTimeout(resolve, 600));
            // Desktop and mobile: Home's MUI app bar, which upstream turns to its solid default colour on scroll. TV: the
            // legacy header, which Home's integration marks solid past 40 px.
            // The one the user sees: the TV can keep a hidden React app bar off screen beside its header.
            const header = [...document.querySelectorAll('.jfmod-homeAppBar, .skinHeader.jfmod-topbar')].find(element => {
                const rect = element.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && getComputedStyle(element).visibility !== 'hidden';
            }) ?? null;
            const style = header ? getComputedStyle(header) : null;
            // The tint's alpha through a canvas, which resolves color(), color-mix() and rgba() alike.
            const canvas = document.createElement('canvas');
            canvas.width = 1;
            canvas.height = 1;
            const context = canvas.getContext('2d');
            if (style) {
                context.fillStyle = style.backgroundColor;
                context.fillRect(0, 0, 1, 1);
            }
            return {
                scrollY: Math.round(window.scrollY), bar: header?.classList.contains('jfmod-homeAppBar') ? 'app bar' : header ? 'legacy header' : null,
                solidClass: !!header && (header.classList.contains('MuiAppBar-colorDefault') || header.classList.contains('jfmod-topbarSolid')),
                background: style?.backgroundColor ?? null, image: style?.backgroundImage ?? null,
                tintAlpha: style ? Math.round(context.getImageData(0, 0, 1, 1).data[3] / 255 * 100) / 100 : null,
                filter: style ? style.backdropFilter || style.webkitBackdropFilter || 'none' : null,
                theme: document.documentElement.getAttribute('data-theme'),
                boxShadow: style?.boxShadow ?? null, borderBottomWidth: style?.borderBottomWidth ?? null,
                labelTextShadow: header?.querySelector('.MuiButton-root') ? getComputedStyle(header.querySelector('.MuiButton-root')).textShadow : null
            };
        }, !!layout.tv);
        const glass = bar.solidClass && glassValuesMatch(bar.theme, bar);
        // Scrolled past the point where it used to turn solid, with no fill under the scrim and no filter.
        const transparent = bar.bar === 'legacy header' && bar.solidClass && bar.filter === 'none' && bar.tintAlpha === 0 && /linear-gradient/.test(bar.image ?? '');
        record(`d ${layout.name}`, layout.tv ? 'Scrolled, the TV bar stays transparent (its gradient scrim only: no fill, no backdrop filter)' :
            'Scrolled, the bar is frosted glass with the approved values (tint, blur 12, contrast 0.7, brightness; no halo, no hairline)', layout.tv ? transparent : glass, bar);
        if (!layout.tv) await layoutPage.screenshot({ path: path.join(out, `d-${layout.name}-scrolled-bar.png`) });
        await layoutPage.evaluate(() => window.scrollTo(0, 0));
        // Before: the same page with the hero's previous rules put back.
        await layoutPage.addStyleTag({ content: OLD_HERO_CSS });
        await layoutPage.evaluate(() => window.scrollTo(0, 0));
        await layoutPage.waitForTimeout(800);
        const before = await measure(layoutPage);
        record(`d ${layout.name}`, 'Before (previous fixed-em rules), for comparison', 'INFO', before);
        await layoutPage.screenshot({ path: path.join(out, `d-${layout.name}-before.png`) });
        record(`d ${layout.name}`, 'No page errors', layoutPage.errors.length === 0, layoutPage.errors.slice(0, 3));
    } catch (error) {
        record(`d ${layout.name}`, 'layout', 'NOT VERIFIED', String(error?.message ?? error).split('\n')[0]);
    }
    await layoutContext.close();
}

// The scrolled bar as glass (user, 2026-10-08: "opaque … liquid style, a little bit of blur"): the page beneath must
// show through, blurred, and the bar's text must still read over the brightest thing likely to pass under it. Measured
// from the pixels, not the stylesheet. Each place is captured twice: the bar with its contents hidden (the glass
// alone) and the page with the bar hidden (what lies beneath). Over blocks of 16 × 8 px, the regression slope of the
// glass's luminance on the beneath's is the share of the underlying brightness that shows through; the text's
// contrast is taken against every block of the glass, and the worst block counts. Places: the top of the hero, the
// brightest of the first poster rows, and mid-grey, plain white and plain black panels slid under the bar (the grey is held
// to the 4.5:1 bound, the extremes are for the record).
// Contrast is taken in the band the bar's labels occupy, across the whole width, since that is where text meets what
// passes beneath. The TV draws the legacy header instead, with no glass (user, 2026-10-08: transparent, its gradient
// scrim the only treatment), and is measured the same way.
const BAR_SELECTOR = '.jfmod-homeAppBar, .skinHeader.jfmod-topbar';
// The bar as first shipped on 2026-10-08 (commit 12322785b6), put back over the built one for the comparison: its
// stricter bound, the page at 48 % brightness under a 35 % tint over a plain white panel, held what showed through
// to about a quarter of the page in the dark themes. The built bar's halo behind the labels is switched off meanwhile.
const OLD_GLASS_CSS = `.jfmod-homeAppBar.jfmod-homeAppBar.MuiAppBar-colorDefault {
    background: color-mix(in srgb, color-mix(in srgb, var(--AppBar-background) 80%, var(--AppBar-color)) 35%, transparent) !important;
    -webkit-backdrop-filter: blur(14px) saturate(180%) brightness(0.48) !important; backdrop-filter: blur(14px) saturate(180%) brightness(0.48) !important;
    text-shadow: none !important; }
    [data-theme='light'] .jfmod-homeAppBar.jfmod-homeAppBar.MuiAppBar-colorDefault {
    background: color-mix(in srgb, var(--AppBar-background) 45%, transparent) !important;
    -webkit-backdrop-filter: blur(14px) saturate(170%) contrast(0.75) brightness(1.15) !important; backdrop-filter: blur(14px) saturate(170%) contrast(0.75) brightness(1.15) !important; }
    [data-theme='appletv'] .jfmod-homeAppBar.jfmod-homeAppBar.MuiAppBar-colorDefault {
    background: color-mix(in srgb, color-mix(in srgb, var(--AppBar-background) 70%, #fff) 55%, transparent) !important;
    -webkit-backdrop-filter: blur(14px) saturate(170%) contrast(0.7) brightness(1.25) !important; backdrop-filter: blur(14px) saturate(170%) contrast(0.7) brightness(1.25) !important; }
    .jfmod-homeAppBar.jfmod-homeAppBar.MuiAppBar-colorDefault svg { filter: none !important; }
    .layout-tv .skinHeader.jfmod-topbar.jfmod-topbarSolid { background: #101010 !important; }`;
const GLASS_VARIANTS = process.env.JELLYFINMOD_GLASS_VARIANTS ?
    JSON.parse(readFileSync(process.env.JELLYFINMOD_GLASS_VARIANTS, 'utf8')) :
    [{ name: 'before', css: OLD_GLASS_CSS }, { name: 'after', css: '' }];
const glassThemeFilter = process.env.JELLYFINMOD_GLASS_THEMES?.split(',');
const luminanceOf = ([red, green, blue]) => {
    const channel = value => {
        const unit = value / 255;
        return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
};
const contrastOf = (left, right) => (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
const round = (value, places = 2) => Math.round(value * 10 ** places) / 10 ** places;

/**
 * Repaints the bar after the probe changes its styles: it sits on its own compositing layer (backdrop-filter), and
 * Chrome was seen keeping its icons painted in a removed style's colour.
 */
const repaintBar = page => page.evaluate(async () => {
    const bar = document.querySelector('[data-jfmod-glass]');
    if (bar) {
        bar.style.setProperty('visibility', 'hidden', 'important');
        bar.getBoundingClientRect();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        bar.style.removeProperty('visibility');
        bar.getBoundingClientRect();
    }
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
});

/** The bar's area as 16 × 8 px block means, with `hide` ('contents' or 'bar') hidden; the hairline rows left out. */
/** Marks the bar the user sees (data-jfmod-glass): the TV keeps a hidden React app bar off screen beside its header. */
const markBar = page => page.evaluate(selector => {
    document.querySelectorAll('[data-jfmod-glass]').forEach(element => element.removeAttribute('data-jfmod-glass'));
    const bar = [...document.querySelectorAll(selector)].find(element => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && getComputedStyle(element).visibility !== 'hidden';
    });
    if (!bar) {
        throw new Error(`no visible bar: ${JSON.stringify([...document.querySelectorAll(selector)].map(element => {
            const rect = element.getBoundingClientRect();
            return [element.className.slice(0, 60), Math.round(rect.top), Math.round(rect.bottom), getComputedStyle(element).visibility];
        }))} at scrollY ${Math.round(window.scrollY)}`);
    }
    bar.setAttribute('data-jfmod-glass', '');
    return bar.classList.contains('jfmod-homeAppBar') ? 'app bar' : 'legacy header';
}, BAR_SELECTOR);

async function barBlocks(page, hide) {
    const box = await page.evaluate(({ hidden }) => {
        document.getElementById('jfmod-glass-hide')?.remove();
        const bar = document.querySelector('[data-jfmod-glass]');
        const style = document.createElement('style');
        style.id = 'jfmod-glass-hide';
        style.textContent = hidden === 'bar' ? '[data-jfmod-glass] { visibility: hidden !important; }' :
            '[data-jfmod-glass] * { visibility: hidden !important; }';
        document.head.append(style);
        const rect = bar.getBoundingClientRect();
        // Only the part on screen: the TV's header scrolls away with the page.
        return { width: Math.floor(rect.width), height: Math.floor(Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0)) };
    }, { hidden: hide });
    await repaintBar(page);
    await page.waitForTimeout(250);
    const png = await page.screenshot({ clip: { x: 0, y: 0, width: box.width, height: box.height } });
    await page.evaluate(() => document.getElementById('jfmod-glass-hide')?.remove());
    await repaintBar(page);
    return page.evaluate(async ({ data, width }) => {
        const bytes = Uint8Array.from(atob(data), character => character.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(bitmap, 0, 0);
        // Screenshot pixels per CSS pixel, so the blocks are the same CSS size on every screen.
        const scale = bitmap.width / width;
        const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
        const blocks = [];
        const blockWidth = Math.round(16 * scale);
        const blockHeight = Math.round(8 * scale);
        for (let top = Math.round(2 * scale); top + blockHeight <= bitmap.height - Math.round(3 * scale); top += blockHeight) {
            for (let left = 0; left + blockWidth <= bitmap.width; left += blockWidth) {
                const sum = [0, 0, 0];
                for (let y = top; y < top + blockHeight; y++) {
                    for (let x = left; x < left + blockWidth; x++) {
                        const index = (y * bitmap.width + x) * 4;
                        sum[0] += pixels[index];
                        sum[1] += pixels[index + 1];
                        sum[2] += pixels[index + 2];
                    }
                }
                blocks.push({ rgb: sum.map(value => value / (blockWidth * blockHeight)), top: top / scale, bottom: (top + blockHeight) / scale });
            }
        }
        return blocks;
    }, { data: png.toString('base64'), width: box.width });
}

/**
 * The text's contrast where it is drawn: each visible control of the bar is captured as drawn and again with its glyphs
 * (text and icons) recoloured, which leaves any text shadow or icon drop shadow as it was. Pixels that differ are the
 * glyphs. Their colour as drawn is the brightest tenth of those pixels (the darkest, for dark text), since a dimmed nav
 * label is not the bar's main text colour. The background they sit on is the ring from 2 to 5 px around them (the first
 * pixel is their antialiased edge), any halo included; its 98th-percentile luminance (2nd, for dark text) against the
 * glyphs' is the control's contrast, and the worst control counts. Transitions are held off meanwhile, or MUI's fade of
 * the icons' fill would leave the recolouring half done. A control that paints its own opaque ground (the user's avatar
 * disc) carries its own contrast and is left out; an image inside a control (the server logo) is left out of its ring.
 */
async function glyphContrast(page, textRgb) {
    await page.evaluate(() => {
        const still = document.createElement('style');
        still.id = 'jfmod-glass-still';
        still.textContent = '[data-jfmod-glass], [data-jfmod-glass] * { transition: none !important; }';
        document.head.append(still);
    });
    const shot = async hideGlyphs => {
        const rects = await page.evaluate(hidden => {
            document.getElementById('jfmod-glass-hide')?.remove();
            if (hidden) {
                const style = document.createElement('style');
                style.id = 'jfmod-glass-hide';
                style.textContent = '[data-jfmod-glass] * { color: #f0f !important; fill: #f0f !important; caret-color: #f0f !important; }';
                document.head.append(style);
            }
            const bar = document.querySelector('[data-jfmod-glass]');
            return [...bar.querySelectorAll('a, button')].map(element => ({ element, rect: element.getBoundingClientRect() }))
                .filter(({ element, rect }) => rect.width > 0 && rect.bottom > 0 && rect.top < window.innerHeight
                    && getComputedStyle(element).visibility !== 'hidden' && !element.querySelector('a, button')
                    && ![element, ...element.querySelectorAll('*')].some(node =>
                        /^rgba?\((?:\d+, ){2}\d+(?:, (?:0\.[6-9]\d*|1))?\)$/.test(getComputedStyle(node).backgroundColor)))
                .map(({ element, rect }) => ({ x: rect.left, y: Math.max(0, rect.top), width: rect.width, height: Math.min(rect.bottom, window.innerHeight) - Math.max(0, rect.top),
                    // A logo beside the text is a picture, not background: its pixels are left out of the ring.
                    images: [...element.querySelectorAll('img')].map(image => image.getBoundingClientRect())
                        .map(box => ({ left: box.left, top: box.top, right: box.right, bottom: box.bottom })),
                    label: element.textContent.trim().slice(0, 20) || element.getAttribute('aria-label') || element.title || element.tagName }));
        }, hideGlyphs);
        await repaintBar(page);
        await page.waitForTimeout(250);
        const box = await page.evaluate(() => {
            const rect = document.querySelector('[data-jfmod-glass]').getBoundingClientRect();
            return { width: Math.floor(rect.width), height: Math.floor(Math.min(rect.bottom, window.innerHeight)) };
        });
        const png = await page.screenshot({ clip: { x: 0, y: 0, width: box.width, height: box.height } });
        await page.evaluate(() => document.getElementById('jfmod-glass-hide')?.remove());
        await repaintBar(page);
        return { rects, png: png.toString('base64'), width: box.width };
    };
    const drawn = await shot(false);
    const bare = await shot(true);
    await page.evaluate(() => document.getElementById('jfmod-glass-still')?.remove());
    await repaintBar(page);
    return page.evaluate(async ({ drawnPng, barePng, width, rects, text }) => {
        const decode = async data => {
            const bytes = Uint8Array.from(atob(data), character => character.charCodeAt(0));
            const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
            const canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const context = canvas.getContext('2d', { willReadFrequently: true });
            context.drawImage(bitmap, 0, 0);
            return { pixels: context.getImageData(0, 0, bitmap.width, bitmap.height).data, width: bitmap.width, height: bitmap.height };
        };
        const one = await decode(drawnPng);
        const two = await decode(barePng);
        const scale = one.width / width;
        const channel = value => {
            const unit = value / 255;
            return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
        };
        const luminance = (red, green, blue) => 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
        const textLum = luminance(...text);
        const glyph = new Uint8Array(one.width * one.height);
        for (let index = 0; index < glyph.length; index++) {
            const at = index * 4;
            const difference = Math.max(Math.abs(one.pixels[at] - two.pixels[at]), Math.abs(one.pixels[at + 1] - two.pixels[at + 1]), Math.abs(one.pixels[at + 2] - two.pixels[at + 2]));
            if (difference > 24) glyph[index] = 1;
        }
        const grow = (mask, reach) => {
            const out = new Uint8Array(mask.length);
            for (let y = 0; y < one.height; y++) {
                for (let x = 0; x < one.width; x++) {
                    if (!mask[y * one.width + x]) continue;
                    for (let dy = -reach; dy <= reach; dy++) {
                        for (let dx = -reach; dx <= reach; dx++) {
                            const ny = y + dy;
                            const nx = x + dx;
                            if (ny >= 0 && ny < one.height && nx >= 0 && nx < one.width) out[ny * one.width + nx] = 1;
                        }
                    }
                }
            }
            return out;
        };
        const edge = grow(glyph, Math.max(1, Math.round(scale)));
        const ring = grow(glyph, Math.round(5 * scale));
        const light = textLum > 0.5;
        const controls = rects.map(rect => {
            const values = [];
            const glyphValues = [];
            let glyphs = 0;
            const left = Math.max(0, Math.round(rect.x * scale));
            const right = Math.min(one.width, Math.round((rect.x + rect.width) * scale));
            const top = Math.max(0, Math.round(rect.y * scale));
            const bottom = Math.min(one.height, Math.round((rect.y + rect.height) * scale));
            for (let y = top; y < bottom; y++) {
                for (let x = left; x < right; x++) {
                    const index = y * one.width + x;
                    const at = index * 4;
                    if (glyph[index]) {
                        glyphs++;
                        glyphValues.push(luminance(one.pixels[at], one.pixels[at + 1], one.pixels[at + 2]));
                    }
                    if (edge[index] || !ring[index]) continue;
                    if (rect.images.some(box => x >= box.left * scale && x < box.right * scale && y >= box.top * scale && y < box.bottom * scale)) continue;
                    values.push(luminance(one.pixels[at], one.pixels[at + 1], one.pixels[at + 2]));
                }
            }
            values.sort((a, b) => a - b);
            glyphValues.sort((a, b) => a - b);
            // Behind light text the brightest background counts; behind dark text, the darkest.
            const background = light ? values[Math.floor(values.length * 0.98)] : values[Math.floor(values.length * 0.02)];
            const drawnGlyph = light ? glyphValues[Math.floor(glyphValues.length * 0.9)] : glyphValues[Math.floor(glyphValues.length * 0.1)];
            const contrast = (Math.max(drawnGlyph, background) + 0.05) / (Math.min(drawnGlyph, background) + 0.05);
            return { label: rect.label, glyphPixels: glyphs, glyph: Math.round(drawnGlyph * 1000) / 1000, background: Math.round(background * 1000) / 1000,
                contrast: Math.round(contrast * 100) / 100 };
        }).filter(control => control.glyphPixels > 0 && Number.isFinite(control.contrast));
        controls.sort((a, b) => a.contrast - b.contrast);
        return { worst: controls[0] ?? null, controls };
    }, { drawnPng: drawn.png, barePng: bare.png, width: drawn.width, rects: drawn.rects, text: textRgb });
}

/** Glass and beneath at the current scroll position, reduced to the numbers the checks use. */
async function sampleGlass(page) {
    const mean = values => values.reduce((total, value) => total + value, 0) / values.length;
    const grey = blocks => round(mean(blocks.map(([red, green, blue]) => (red + green + blue) / 3)), 0);
    const glassBlocks = await barBlocks(page, 'contents');
    const glass = glassBlocks.map(block => block.rgb);
    const beneath = (await barBlocks(page, 'bar')).map(block => block.rgb);
    const text = await page.evaluate(() => {
        const header = document.querySelector('[data-jfmod-glass]');
        const controls = [...header.querySelectorAll('a, button')].filter(element => {
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.bottom > 0 && rect.top < window.innerHeight && getComputedStyle(element).visibility !== 'hidden';
        });
        const label = controls.find(element => element.textContent.trim()) ?? controls[0];
        // The TV's header can be on screen only by its scrim, its buttons already scrolled away: nothing to read there.
        if (!label) return null;
        // The band the labels and icons occupy, from the top of the highest to the bottom of the lowest.
        const rects = controls.map(element => element.getBoundingClientRect());
        const band = { top: Math.min(...rects.map(rect => rect.top)), bottom: Math.max(...rects.map(rect => rect.bottom)) };
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const context = canvas.getContext('2d');
        context.fillStyle = getComputedStyle(label).color;
        context.fillRect(0, 0, 1, 1);
        return { rgb: [...context.getImageData(0, 0, 1, 1).data].slice(0, 3), band,
            label: label.textContent.trim().slice(0, 20) || label.getAttribute('aria-label') };
    });
    if (!text) {
        return { showThrough: null, glassGrey: grey(glass), beneathGrey: grey(beneath), controls: 0, glyphContrast: null, note: 'no control of the bar on screen' };
    }
    const atGlyphs = await glyphContrast(page, text.rgb);
    const glassLum = glass.map(luminanceOf);
    const beneathLum = beneath.map(luminanceOf);
    const glassMean = mean(glassLum);
    const beneathMean = mean(beneathLum);
    const variance = mean(beneathLum.map(value => (value - beneathMean) ** 2));
    const covariance = mean(beneathLum.map((value, index) => (value - beneathMean) * (glassLum[index] - glassMean)));
    // The same slope in encoded sRGB grey levels, closer to how much of the page the eye sees through the bar.
    const greyOf = ([red, green, blue]) => (red + green + blue) / 3;
    const glassGreys = glass.map(greyOf);
    const beneathGreys = beneath.map(greyOf);
    const glassGreyMean = mean(glassGreys);
    const beneathGreyMean = mean(beneathGreys);
    const greyVariance = mean(beneathGreys.map(value => (value - beneathGreyMean) ** 2));
    const greyCovariance = mean(beneathGreys.map((value, index) => (value - beneathGreyMean) * (glassGreys[index] - glassGreyMean)));
    const textLum = luminanceOf(text.rgb);
    const inBand = glassBlocks.map(block => block.bottom > text.band.top && block.top < text.band.bottom);
    const contrasts = glassLum.filter((value, index) => inBand[index]).map(value => contrastOf(textLum, value)).sort((left, right) => left - right);
    return {
        // Undefined over a plain panel, where the beneath does not vary.
        showThrough: greyVariance > 1 ? round(greyCovariance / greyVariance) : null,
        showThroughLinear: variance > 1e-5 ? round(covariance / variance) : null,
        glassGrey: grey(glass), beneathGrey: grey(beneath),
        beneathBrightestGrey: round(Math.max(...beneath.map(([red, green, blue]) => (red + green + blue) / 3)), 0),
        text: `rgb(${text.rgb.join(', ')})`, label: text.label, band: [Math.round(text.band.top), Math.round(text.band.bottom)],
        worstContrast: round(contrasts[0]), contrast5thPercentile: round(contrasts[Math.floor(contrasts.length * 0.05)]),
        blocks: glass.length, blocksInBand: contrasts.length,
        // The figure the readability check uses: the glyphs against what they are drawn on, halo included.
        glyphContrast: atGlyphs.worst?.contrast ?? null, worstControl: atGlyphs.worst?.label ?? null, controls: atGlyphs.controls.length
    };
}

/** Scrolls so the bar sits over the place named, and waits for images there to load. */
async function placeBar(page, place, rowMiddle) {
    await page.evaluate(({ where, middle }) => {
        document.getElementById('jfmod-glass-panel')?.remove();
        // Measured where it is, scrolled or not: the TV's header can be off screen until this scroll brings it back.
        const header = [...document.querySelectorAll('.jfmod-homeAppBar, .skinHeader.jfmod-topbar')].find(element => element.getBoundingClientRect().width > 0);
        const bar = header.getBoundingClientRect();
        if (where === 'row') {
            window.scrollTo(0, middle - bar.height / 2);
            return;
        }
        // The TV's header scrolls with the page, so it is measured at the top of Home and just past the 40 px at
        // which it used to turn solid; the other bars stay put and are measured once Home has scrolled.
        window.scrollTo(0, where === 'top' ? 0 : where === 'past' ? 45 : 160);
        if (where === 'white' || where === 'black' || where === 'grey') {
            // Under the bar, over the page.
            const panel = document.createElement('div');
            panel.id = 'jfmod-glass-panel';
            const layer = Math.max(0, (Number.parseInt(getComputedStyle(header).zIndex, 10) || 1) - 1);
            panel.style.cssText = `position:fixed;left:0;top:0;width:100%;height:${bar.height + 40}px;z-index:${layer};background:${{ white: '#fff', black: '#000', grey: '#808080' }[where]}`;
            document.body.append(panel);
        }
    }, { where: place, middle: rowMiddle });
    await page.waitForTimeout(900);
    // Scrolling can swap which bar shows; mark again where the bar now is.
    await markBar(page);
}

const glassLayouts = LAYOUTS.filter(entry => ['desktop-1920', 'mobile-390', 'tv-1920'].includes(entry.name) && (!layoutFilter || layoutFilter.includes(entry.name)));
// A filter that leaves nothing to measure must not pass by omission.
if (only.includes('glass') && glassLayouts.length === 0) {
    record('glass', 'layouts', 'NOT VERIFIED', `JELLYFINMOD_HERO_LAYOUTS selects none of desktop-1920, mobile-390, tv-1920 (got ${process.env.JELLYFINMOD_HERO_LAYOUTS})`);
}
if (only.includes('glass')) for (const layout of glassLayouts) {
    const { context: glassContext, page: glassPage } = await newPage(layout.viewport, layout.extra);
    try {
        await signIn(glassPage);
        const themeKey = `${await userId(glassPage)}-appTheme`;
        if (layout.tv) await glassPage.evaluate(() => localStorage.setItem('layout', 'tv'));
        // Every theme on the computer, since each has its own bar and text colours; the default and the light theme on
        // the phone; the TV in its default dark theme, the one it ships with. Light-mode themes draw dark text.
        const themes = (layout.tv ? ['dark'] : layout.extra?.isMobile ? ['dark', 'light'] :
            ['dark', 'light', 'appletv', 'wmc', 'blueradiance', 'purplehaze']).filter(theme => !glassThemeFilter || glassThemeFilter.includes(theme));
        if (themes.length === 0) record(`glass ${layout.name}`, 'themes', 'NOT VERIFIED', `JELLYFINMOD_GLASS_THEMES selects none of this layout's themes (got ${process.env.JELLYFINMOD_GLASS_THEMES})`);
        for (const theme of themes) {
            // The theme is a setting this browser keeps for the user (appTheme, not saved on the server).
            await glassPage.evaluate(({ key, value }) => (value === 'dark' ? localStorage.removeItem(key) : localStorage.setItem(key, value)),
                { key: themeKey, value: theme });
            await glassPage.reload({ waitUntil: 'domcontentloaded' });
            await waitHero(glassPage);
            await glassPage.waitForTimeout(1500);
            const step = `glass ${layout.name} ${theme}`;
            const shown = await glassPage.evaluate(() => document.documentElement.getAttribute('data-theme'));
            if (shown !== theme) throw new Error(`theme ${theme} did not apply (data-theme ${shown})`);
            // The rows' images, which the poster-row case needs, arrive after the hero.
            await glassPage.waitForFunction(() => [...document.querySelectorAll('.cardImageContainer')]
                .filter(image => !image.closest('.jfmod-homeHero') && getComputedStyle(image).backgroundImage.startsWith('url(')).length >= 6,
            undefined, { timeout: 30000 }).catch(() => {});
            // The first poster rows, by the middle of their card images. Each is measured under the bar and the one where
            // the text reads worst counts: a row's average says nothing about the poster under one label.
            const rowMiddles = await glassPage.evaluate(() => {
                const middles = [];
                for (const image of document.querySelectorAll('.cardImageContainer')) {
                    const rect = image.getBoundingClientRect();
                    if (rect.height < 40 || image.closest('.jfmod-homeHero')) continue;
                    const middle = Math.round(rect.top + window.scrollY + rect.height / 2);
                    if (!middles.some(seen => Math.abs(seen - middle) < 20)) middles.push(middle);
                }
                return middles.sort((left, right) => left - right).slice(0, 4);
            });
            if (!layout.tv && rowMiddles.length === 0) throw new Error('no poster rows to measure the bar over');
            // Room below the last row, so every row can be scrolled up under the bar; Home is shorter than that by itself.
            await glassPage.evaluate(() => {
                const spacer = document.createElement('div');
                spacer.id = 'jfmod-glass-spacer';
                // Absolute, below the current end: Jellyfin's pages are themselves absolutely placed, so an in-flow spacer adds
                // no room.
                spacer.style.cssText = `position:absolute;left:0;width:1px;top:${document.documentElement.scrollHeight}px;height:${window.innerHeight}px`;
                document.body.append(spacer);
            });
            const measured = {};
            const clip = { x: 0, y: 0, width: layout.viewport.width, height: layout.extra?.isMobile ? 300 : 360 };
            for (const variant of GLASS_VARIANTS) {
                await glassPage.evaluate(css => {
                    document.getElementById('jfmod-glass-variant')?.remove();
                    if (!css) return;
                    const style = document.createElement('style');
                    style.id = 'jfmod-glass-variant';
                    style.textContent = css;
                    document.head.append(style);
                }, variant.css);
                measured[variant.name] = { rows: [] };
                for (const place of layout.tv ? ['top', 'past'] : ['hero', 'grey', 'white', 'black']) {
                    await placeBar(glassPage, place);
                    const sample = await sampleGlass(glassPage);
                    measured[variant.name][place] = sample;
                    record(step, `${variant.name}: over the ${place}`, 'INFO', sample);
                    await glassPage.screenshot({ path: path.join(out, `glass-${layout.name}-${theme}-${variant.name}-${place}.png`), clip });
                }
                for (const [index, middle] of (layout.tv ? [] : rowMiddles).entries()) {
                    await placeBar(glassPage, 'row', middle);
                    // The row's cards must really be under the bar, not short of it.
                    const under = await glassPage.evaluate(target => {
                        const bar = document.querySelector('[data-jfmod-glass]').getBoundingClientRect();
                        return Math.abs(target - window.scrollY - (bar.top + bar.height / 2)) <= 4;
                    }, middle);
                    if (!under) throw new Error(`poster row ${index + 1} could not be scrolled under the bar`);
                    const sample = await sampleGlass(glassPage);
                    measured[variant.name].rows.push(sample);
                    record(step, `${variant.name}: over poster row ${index + 1}`, 'INFO', sample);
                    await glassPage.screenshot({ path: path.join(out, `glass-${layout.name}-${theme}-${variant.name}-row${index + 1}.png`), clip });
                }
                const rows = measured[variant.name].rows;
                const worst = rows.reduce((found, sample, index) =>
                    (found === null || (sample.glyphContrast ?? Infinity) < (rows[found].glyphContrast ?? Infinity) ? index : found), null);
                measured[variant.name].row = worst === null ? null : rows[worst];
                measured[variant.name].rowIndex = worst;
                await glassPage.evaluate(() => document.getElementById('jfmod-glass-panel')?.remove());
            }
            await glassPage.evaluate(() => {
                document.getElementById('jfmod-glass-variant')?.remove();
                document.getElementById('jfmod-glass-spacer')?.remove();
            });
            const after = measured.after;
            if (after && layout.tv) {
                // Over the poster rows the TV's header is already off screen, so it never sits over them.
                const offScreen = [];
                for (const middle of rowMiddles) {
                    offScreen.push(await glassPage.evaluate(async rowMiddle => {
                        const header = document.querySelector('.skinHeader.jfmod-topbar');
                        window.scrollTo(0, rowMiddle - header.getBoundingClientRect().height / 2);
                        await new Promise(resolve => setTimeout(resolve, 600));
                        return Math.round(header.getBoundingClientRect().bottom);
                    }, middle));
                }
                record(step, 'TV: with a poster row under the top of the screen, the header has scrolled away (never over the rows)',
                    offScreen.length > 0 && offScreen.every(bottom => bottom <= 0), { headerBottomPerRow: offScreen });
                record(step, 'TV after: the header text and icons read at 4.5:1 or better where drawn, at the top of Home and past the old solid point (where any is on screen)',
                    after.top.glyphContrast >= 4.5 && (after.past.controls === 0 || after.past.glyphContrast >= 4.5),
                    { top: after.top.glyphContrast, topWorst: after.top.worstControl, past: after.past.glyphContrast, pastWorst: after.past.worstControl });
                // That it no longer fills in is the layout step's check (its computed style); here, for the record, what the
                // eye gets past the old solid point: the glass against what lies beneath, before and after.
                record(step, 'TV: past the old solid point, the header against what lies beneath (grey levels)', 'INFO',
                    { before: measured.before && { glass: measured.before.past.glassGrey, beneath: measured.before.past.beneathGrey },
                        after: { glass: after.past.glassGrey, beneath: after.past.beneathGrey } });
            } else if (after) {
                // The bound is real imagery (user, 2026-10-09: see-through over the old plain-white floor): the hero, every poster
                // row measured and a mid-grey panel. The plain white (or black) panel that is hardest for the theme's text is
                // recorded, not required: it is wider than any poster's brightest area.
                const extreme = ['light', 'appletv'].includes(theme) ? 'black' : 'white';
                // The approved values hold in this theme (computed style of the bar the user sees).
                const style = await glassPage.evaluate(async () => {
                    const header = document.querySelector('[data-jfmod-glass]');
                    const computed = getComputedStyle(header);
                    const canvas = document.createElement('canvas');
                    canvas.width = 1;
                    canvas.height = 1;
                    const context = canvas.getContext('2d');
                    context.fillStyle = computed.backgroundColor;
                    context.fillRect(0, 0, 1, 1);
                    const label = header.querySelector('.MuiButton-root');
                    return { filter: computed.backdropFilter || computed.webkitBackdropFilter || 'none',
                        tintAlpha: Math.round(context.getImageData(0, 0, 1, 1).data[3] / 255 * 100) / 100,
                        boxShadow: computed.boxShadow, borderBottomWidth: computed.borderBottomWidth,
                        labelTextShadow: label ? getComputedStyle(label).textShadow : null };
                });
                record(step, 'The bar has the approved values (tint, blur 12, contrast 0.7, brightness; no text halo, no hairline)', glassValuesMatch(theme, style), style);
                // Readability is a measurement, not a bound (user, 2026-10-09: see-through over the old 4.5:1 floor): the
                // worst label over the hero, each poster row and a mid-grey panel is recorded for the user's judgement.
                record(step, `After, for the record: the controls' text and icons over the hero, each of ${after.rows.length} poster rows and a mid-grey panel (the 4.5:1 floor no longer applies)`, 'INFO',
                    { hero: after.hero.glyphContrast, heroWorst: after.hero.worstControl, rows: after.rows.map(sample => sample.glyphContrast),
                        worstRow: after.rowIndex === null ? null : after.rowIndex + 1, rowWorst: after.row?.worstControl, grey: after.grey.glyphContrast });
                record(step, `After, for the record: the same labels over a plain ${extreme} panel, the extreme the bar is no longer held to`, 'INFO',
                    { [extreme]: after[extreme].glyphContrast, worst: after[extreme].worstControl });
                const before = measured.before;
                if (before?.rows?.length === after.rows.length && after.row) {
                    // More of the page through the bar than the first glass, over the hero and over the same poster row.
                    const sameRow = before.rows[after.rowIndex];
                    const more = after.hero.showThrough > before.hero.showThrough && after.row.showThrough > sameRow.showThrough;
                    record(step, 'After shows more of the page than before, over the hero and the poster row', more,
                        { showThrough: { hero: [before.hero.showThrough, after.hero.showThrough], row: [sameRow.showThrough, after.row.showThrough] },
                            heroGrey: [before.hero.glassGrey, after.hero.glassGrey], beneathHeroGrey: after.hero.beneathGrey });
                }
            }
        }
        await glassPage.evaluate(key => {
            localStorage.removeItem(key);
            localStorage.removeItem('layout');
        }, themeKey);
        record(`glass ${layout.name}`, 'No page errors', glassPage.errors.length === 0, glassPage.errors.slice(0, 3));
    } catch (error) {
        record(`glass ${layout.name}`, 'glass', 'NOT VERIFIED', String(error?.message ?? error).split('\n')[0]);
    }
    await glassContext.close();
}

if (databaseCheck) {
    // Every UserData row of the user, the fields the API hides included, identical to before the run.
    try {
        execFileSync(process.execPath, [databaseTool, 'snapshot', path.join(out, 'userdata-after.txt')], { stdio: 'pipe' });
        let output;
        try {
            output = execFileSync(process.execPath, [databaseTool, 'diff', databaseBefore, path.join(out, 'userdata-after.txt')], { encoding: 'utf8' });
        } catch (error) {
            output = String(error?.stdout ?? '');  // exits 1 when any row differs; the rows are classified below
        }
        const { userData: rows } = JSON.parse(output);
        // Rows are keyed by user-data key (shared by every version of a title), so the run's items are matched by it.
        const { page: checkPage, context: checkContext } = await newPage({ width: 1280, height: 800 });
        try {
            await signIn(checkPage);
            const uid = await userId(checkPage);
            // A row is keyed by the title's user-data key or, for some items, by the item's own id in dashed form.
            const dashed = id => id.replace(/-/g, '').toLowerCase().replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
            const keysOf = async id => [dashed(id), (await api(checkPage, 'GET', `Items/${id}?userId=${uid}`)).body?.UserData?.Key?.toLowerCase()].filter(Boolean);
            const touchedKeys = new Set([...ledger.values()].flatMap(item => [dashed(item.Id), item.UserData.Key?.toLowerCase()]).filter(Boolean));
            // Everything this run played, from its own outgoing reports (complete) and the session polls (a cross-check).
            const playedUnremembered = [...new Set([...reportedPlayback, ...observedPlaying])].filter(id => !ledger.has(id));
            for (const id of playedUnremembered) (await keysOf(id)).forEach(key => touchedKeys.add(key));
            // Each changed row with every key that names it: its own, its item's id, and its item's user-data key.
            const differing = [];
            for (const row of [...rows.onlyBefore, ...rows.onlyAfter]) {
                const [item, key] = row.split('|');
                differing.push({ item, key: key.toLowerCase(), keys: [...new Set([key.toLowerCase(), ...await keysOf(item)])] });
            }
            const ours = differing.filter(row => row.keys.some(key => touchedKeys.has(key)));
            const others = differing.filter(row => !row.keys.some(key => touchedKeys.has(key)));
            // A changed row of an item this run did not snapshot is the run's fault if any request the run sent named it
            // (every non-read request of every page is logged above, playback reports and the runner's own API writes
            // alike), and then fails the run. One that no request of the run named was changed by another client; the
            // server's activity log adds, where it has one, this same user playing an item with that key in the window.
            const runEnd = new Date(Date.now() + 5000).toISOString();
            const activity = (await api(checkPage, 'GET', `System/ActivityLog/Entries?minDate=${encodeURIComponent(runStart)}&limit=500`)).body?.Items ?? [];
            const sameUser = id => String(id ?? '').replace(/-/g, '').toLowerCase() === String(uid).replace(/-/g, '').toLowerCase();
            const playedByAnyone = new Set();
            for (const entry of activity.filter(entry => /^VideoPlayback/.test(entry.Type ?? '') && entry.ItemId && sameUser(entry.UserId)
                && Date.parse(entry.Date) >= Date.parse(runStart) && Date.parse(entry.Date) <= Date.parse(runEnd))) {
                (await keysOf(entry.ItemId)).forEach(key => playedByAnyone.add(key));
            }
            const compact = text => String(text).replace(/-/g, '').toLowerCase();
            const sentText = sentRequests.map(request => compact(request.url + ' ' + request.body));
            const namedByRun = row => row.keys.some(key => sentText.some(text => text.includes(compact(key))));
            const unexplained = others.filter(namedByRun);
            const attributed = others.filter(row => !namedByRun(row)).map(row => ({
                ...row, evidence: row.keys.some(key => playedByAnyone.has(key)) ? 'same-user playback in the activity log' : 'no request of this run names it'
            }));
            record('restore', 'Database: every UserData row of every item this run touched or played identical to before it (hidden fields included)',
                // Rows added or removed are in the same differing set and classified the same way, so no global count test.
                ours.length === 0 && playedUnremembered.length === 0,
                { rowsBefore: rows.rowsBefore, rowsAfter: rows.rowsAfter, differingTouched: ours, playedUnremembered });
            // With every write outside the allowlist refused (checked at the end of the run) and none of the allowed ones
            // reaching past the item it names, a row no request of the run names was not changed by the run.
            record('restore', 'Database: no other changed row was named by any request this run sent', unexplained.length === 0,
                { requestsLogged: sentRequests.length, unexplained, window: [runStart, runEnd] });
            if (attributed.length) record('restore', 'Database: rows another client changed during the run (not this run\'s to restore)', 'INFO', { attributed });
        } finally {
            await checkContext.close();
        }
    } catch (error) {
        record('restore', 'Database: every UserData row of every item this run touched identical to before it (hidden fields included)', false, String(error?.message ?? error).slice(0, 600));
    }
}

// Last, once every context of the run has closed: a refused request means something tried to play an item outside the
// allowlist (a wrong hero, an autoplayed next episode); it was stopped before it started, and is listed so the cause
// can be checked.
record('restore', 'Nothing outside the snapshot tried to play in any page of the run (any attempt was refused before it started)',
    refusedPlayback.length === 0, { reported: [...reportedPlayback], refused: refusedPlayback });
record('restore', 'No write outside the allowlist was attempted in any page of the run (any attempt was refused before it was sent)',
    refusedWrites.length === 0, { refused: refusedWrites,
        sent: [...new Set(sentRequests.map(request => `${request.method} ${request.url.split('?')[0].replace(/[0-9a-f]{32}/gi, '<id>')}`))] });

save();
await browser.close();
bundleServer?.close();
const failed = results.filter(result => result.verdict !== 'PASS' && result.verdict !== 'INFO');
console.log(`${results.length - failed.length} of ${results.length} PASS [${tier}]`);
process.exitCode = failed.length ? 1 : 0;
