/* eslint-disable compat/compat, sonarjs/cognitive-complexity, no-await-in-loop -- a Node live runner, not shipped code */
// Phase 13 live list: missed episode watches reach Trakt through the stock Trakt plugin's own export, which JellyfinMod
// schedules. Runs against a LOCAL environment started with JFMOD_TRAKT=1 (envs/compose.trakt.yaml), whose api.trakt.tv is
// the stand-in standins/trakt-export.mjs on this Mac; the real Trakt and anyone's account are never reached. The stock
// Trakt plugin 33 is installed, oleksii (empty password) is linked to the stand-in, and the fixture show
// "JellyfinMod P13 Show (2026) [tvdbid-990113]" with S01E01–E08 is in /test-media/tv.
//
//   P13_ENV=echo P13_OUT=<dir> node scripts/jellyfinmod-e2e/trakt-export.mjs [step ...]
//
// The environment is proven first (trakt-export-env.mjs: container, published port, server name, the stand-in routing of
// api.trakt.tv, the stand-in's control port and the lease); its address, control port and restart target all come from it.
//
// Steps (default: all, in order): setup offline online catchup rewatch failures paging refusal reconnect isolation absent
// writefail reconnectrestart refresh profile activity disconnect import (pace: only sets the test pace, P13_PACE; relink: links
// oleksii again after a stand-in restart)
// Each check prints PASS/FAIL and the run writes <out>/results.json. Desktop Chromium screenshots of Settings › Trakt and
// Home at the states the steps reach go to <out>/shots. No token or secret is printed or written.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { verifiedEnv } from './trakt-export-env.mjs';

const { name: envName, origin, controlUrl, envsBin } = await verifiedEnv();
const out = process.env.P13_OUT ?? 'p13-out';
mkdirSync(join(out, 'shots'), { recursive: true });

const results = [];
const record = (step, check, verdict, detail = '') => {
    results.push({ step, check, verdict, detail });
    console.log(`${verdict} [${step}] ${check}${detail ? ' :: ' + detail : ''}`);
};
const verify = (step, check, ok, detail) => record(step, check, ok ? 'PASS' : 'FAIL', detail);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// ---- Jellyfin as oleksii (the token lives in memory only)
let token = null;
const DEVICE = 'p13-runner';
const authHeader = () => `MediaBrowser Client="JellyfinMod P13", Device="${DEVICE}", DeviceId="${DEVICE}", Version="1"${token ? `, Token="${token}"` : ''}`;
async function jf(method, path, body, { auth = true, raw = false } = {}) {
    const response = await fetch(origin + path, {
        method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: authHeader() } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (raw) return response;
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${path} -> ${response.status}`);
    return text ? JSON.parse(text) : null;
}
async function signIn() {
    token = null;
    const reply = await jf('POST', '/Users/AuthenticateByName', { Username: 'oleksii', Pw: '' });
    token = reply.AccessToken;
    return reply.User.Id;
}
const control = async (path, body) => {
    const response = await fetch(controlUrl + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return response.json();
};
const plays = async () => (await control('/state')).plays;
const playsOf = (list, number) => list.filter(play => play.season === 1 && play.number === number);
const status = () => jf('GET', '/JellyfinMod/Trakt/Export');
async function until(label, check, timeout = 300000, every = 3000) {
    const start = Date.now();
    for (;;) {
        const value = await check();
        if (value) return value;
        if (Date.now() - start > timeout) throw new Error(`timed out after ${Math.round(timeout / 1000)} s waiting for ${label}`);
        await sleep(every);
    }
}
// The restart target is the verified environment, with no JFMOD_* override from this shell.
const env = script => execFileSync(join(envsBin, script), [envName], {
    encoding: 'utf8', env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('JFMOD_')))
});
async function restart() {
    env('down.sh');
    env('up.sh');
    await until('Jellyfin answering', async () => {
        try { return (await fetch(origin + '/health')).ok; } catch { return false; }
    }, 180000, 2000);
    await sleep(5000);
    userId = await signIn();
}

// ---- fixtures
let userId;
let episodes = [];
const loadEpisodes = async () => {
    const series = await jf('GET', `/Items?userId=${userId}&IncludeItemTypes=Series&Recursive=true&SearchTerm=JellyfinMod%20P13`);
    if (!series.Items.length) throw new Error('the fixture show is not in the library');
    const list = await jf('GET', `/Shows/${series.Items[0].Id}/Episodes?userId=${userId}&Fields=ProviderIds`);
    episodes = list.Items.sort((a, b) => a.IndexNumber - b.IndexNumber);
    return series.Items[0];
};
const episode = number => episodes.find(item => item.IndexNumber === number);
const userData = async number => (await jf('GET', `/Items/${episode(number).Id}?userId=${userId}`)).UserData;
async function playToEnd(number) {
    const item = episode(number);
    const session = `p13-${number}-${Date.now()}`;
    await jf('POST', '/Sessions/Playing', { ItemId: item.Id, PlaySessionId: session, PositionTicks: 0, CanSeek: true, PlayMethod: 'DirectPlay', IsPaused: false });
    await sleep(1500);
    await jf('POST', '/Sessions/Playing/Stopped', { ItemId: item.Id, PlaySessionId: session, PositionTicks: item.RunTimeTicks ?? 120000000 });
    await sleep(800);
}
const unplay = number => jf('DELETE', `/UserPlayedItems/${episode(number).Id}?userId=${userId}`);
// The environment's own Jellyfin log (a local environment's config folder), the lines written since `since`.
const logLines = since => {
    const folder = join(envsBin, '..', 'pool', envName, 'config', 'log');
    return readdirSync(folder).filter(name => /^log_\d{8}\.log$/.test(name)).sort().slice(-2)
        .flatMap(name => readFileSync(join(folder, name), 'utf8').split('\n'))
        .filter(line => {
            const at = /^\[(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d\.\d+) ([+-]\d\d:\d\d)\]/.exec(line);
            return at && new Date(`${at[1]}T${at[2]}${at[3]}`) >= since;
        });
};
const minute = iso => new Date(Math.floor(new Date(iso).getTime() / 60000) * 60000).toISOString();

// ---- plugin settings (the XML of an isolated environment; the Trakt plugin's own configuration is read and written
// back unchanged except for one switch, in memory only)
const plugins = () => jf('GET', '/Plugins');
async function modConfig(change) {
    const mod = (await plugins()).find(plugin => plugin.Name === 'JellyfinMod');
    const config = await jf('GET', `/Plugins/${mod.Id}/Configuration`);
    change(config);
    await jf('POST', `/Plugins/${mod.Id}/Configuration`, config);
}
async function traktSwitch(name, value) {
    const trakt = (await plugins()).find(plugin => plugin.Name === 'Trakt');
    const config = await jf('GET', `/Plugins/${trakt.Id}/Configuration`);
    for (const user of config.TraktUsers ?? []) user[name] = value;
    await jf('POST', `/Plugins/${trakt.Id}/Configuration`, config);
}
const setAuto = autoExport => jf('PUT', '/JellyfinMod/Trakt/Export/Settings', { autoExport });
async function authorize(tokenSeconds) {
    await control('/mode', { tokenSeconds });
    await jf('POST', `/Trakt/Users/${userId}/Authorize`);
    await control('/approve', {});
    await until('Trakt authorized', async () => (await jf('GET', `/Trakt/Users/${userId}/PollAuthorizationStatus`)).isAuthorized === true, 30000, 1000);
}
const lastRunAfter = async when => {
    const now = await status();
    return !now.running && now.lastRun && new Date(now.lastRun.startedAt) > when ? now : null;
};

// ---- screenshots (desktop Chromium, one browser at a time)
let browser = null;
/** A desktop page signed in as oleksii, at `path`, settled. */
async function openPage(path = '#/catalog/settings?section=trakt') {
    browser ??= await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(origin + '/web/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.ApiClient, undefined, { timeout: 30000 });
    await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId() || /login|selectuser|selectserver/.test(location.hash); } catch { return false; } }, undefined, { timeout: 30000 });
    if (!await page.evaluate(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } })) {
        const field = page.locator('#txtManualName');
        if (!await field.isVisible().catch(() => false)) {
            const chooser = page.locator('.btnManual').first();
            if (await chooser.count()) await chooser.evaluate(node => node.click());
            await field.waitFor({ state: 'visible', timeout: 15000 });
        }
        await field.fill('oleksii');
        await page.waitForTimeout(1200);
        await field.fill('oleksii');
        await page.locator('button:visible').filter({ hasText: 'Sign In' }).first().click();
        await page.waitForFunction(() => location.hash.startsWith('#/home'), undefined, { timeout: 30000 });
    }
    await page.evaluate(hash => { location.hash = hash; }, path);
    if (path.includes('settings')) await page.waitForSelector('.jfmod-check-section[data-section="trakt"]', { timeout: 30000 });
    else await page.waitForSelector('.jfmod-homeHero', { timeout: 30000 });
    await page.waitForTimeout(2500);
    return page;
}
const traktText = page => page.evaluate(() => document.querySelector('.jfmod-check-section[data-section="trakt"]')?.innerText ?? '');
async function shot(name, path = '#/catalog/settings?section=trakt', scrollToNotice = false) {
    const page = await openPage(path);
    try {
        if (scrollToNotice) await page.evaluate(() => document.querySelector('.jfmod-traktNoticeMount')?.scrollIntoView({ block: 'center' }));
        await page.waitForTimeout(500);
        const file = join(out, 'shots', `${name}.png`);
        await page.screenshot({ path: file });
        const text = await page.evaluate(() => (document.querySelector('.jfmod-check-section[data-section="trakt"]') ?? document.querySelector('.jfmod-traktNoticeMount'))?.innerText ?? '');
        return text;
    } finally {
        await page.close();
    }
}

// ---- the steps
const steps = {
    async setup() {
        userId = await signIn();
        await loadEpisodes();
        verify('setup', 'fixture show has eight episodes', episodes.length === 8, `${episodes.length}`);
        await control('/reset', {});
        // A restarted stand-in has forgotten the token it issued: link oleksii again through the plugin's device flow.
        if (!(await control('/state')).tokenIssued) await authorize(7776000);
        await modConfig(config => { config.TraktExportTestMinutes = 1; });
        await setAuto(false);
        // The export's steps run with the import off; the import step turns it on (its default) and leaves it on.
        await jf('PUT', '/JellyfinMod/Trakt/Export/Settings', { import: false });
        for (const item of episodes) if ((await userData(item.IndexNumber)).Played) await unplay(item.IndexNumber);
        const now = await status();
        verify('setup', 'stock Trakt plugin 33 installed and oleksii linked', now.installed && now.version?.startsWith('33') &&
            now.users.some(user => user.name === 'oleksii' && user.state === 'linked'), JSON.stringify({ version: now.version, users: now.users }));
        verify('setup', 'automatic export off by default after reset', now.autoExport === false);
        verify('setup', 'test pace: quiet period of one minute', now.quietMinutes === 1, `${now.quietMinutes}`);
        verify('setup', 'no response carries a token field', !/token/i.test(JSON.stringify(now)));
        const text = await shot('01-off');
        verify('setup', 'section shows Off and the switch', /Send missed watches automatically/.test(text) && /Automatic sending is off/.test(text), text.slice(0, 120));
    },

    async offline() {
        await control('/mode', { down: true });
        const before = Date.now();
        for (const number of [1, 2, 3]) await playToEnd(number);
        const data = await Promise.all([1, 2, 3].map(userData));
        verify('offline', 'E01–E03 played in Jellyfin while Trakt is unreachable', data.every(entry => entry.Played), data.map(entry => entry.Played).join(','));
        verify('offline', 'playback not slowed: three plays reported in under 15 s', Date.now() - before < 15000, `${Date.now() - before} ms`);
        await setAuto(true);
        const failed = await until('a failed export while down', async () => {
            const now = await status();
            return now.lastRun?.status === 'Failed' && now.nextAttemptAt ? now : null;
            // The plugin sends one request at a time and retries each for about 90 s, so the export waits behind the
            // six scrobble calls of the three plays (about 9 minutes) before its own first read fails.
        }, 1500000, 5000);
        verify('offline', 'automatic export ran after the quiet period, failed, and set a retry', !!failed.nextAttemptAt, `${failed.lastRun.status}, next ${failed.nextAttemptAt}`);
        verify('offline', 'Trakt got no play', (await plays()).length === 0);
        const text = await shot('02-waiting');
        verify('offline', 'section says Waiting for Trakt with the next try', /Waiting for Trakt/.test(text) && /Trakt could not be reached/.test(text) && /Next try/.test(text), text.slice(0, 160));
        const played = Object.fromEntries(await Promise.all([1, 2, 3].map(async number => [number, (await userData(number)).LastPlayedDate])));
        writeFileSync(join(out, 'played-e01-e03.json'), JSON.stringify(played, null, 1));
        await restart();
        await loadEpisodes();
        const after = await Promise.all([1, 2, 3].map(userData));
        verify('offline', 'watched state and times kept across a restart', after.every((entry, index) => entry.Played && entry.LastPlayedDate === played[index + 1]));
        const kept = await status();
        verify('offline', 'last failed run kept across the restart (host task history)', kept.lastRun?.status === 'Failed', kept.lastRun?.status);
    },

    async online() {
        const played = Object.fromEntries(await Promise.all([1, 2, 3].map(async number => [number, (await userData(number)).LastPlayedDate])));
        await control('/mode', { down: false });
        const done = await until('a completed export', async () => {
            const now = await status();
            return now.lastRun?.status === 'Completed' && !now.running ? now : null;
        }, 600000, 5000);
        const list = await plays();
        verify('online', 'export completed by itself once Trakt answered', !!done, done.lastRun.startedAt);
        for (const number of [1, 2, 3]) {
            const mine = playsOf(list, number);
            verify('online', `E0${number}: exactly one play at Jellyfin's watch time (to the minute)`, mine.length === 1 && mine[0].watched_at === minute(played[number]),
                `${mine.length} play(s), ${mine[0]?.watched_at} vs ${minute(played[number])}`);
        }
        const text = await shot('03-ok');
        verify('online', 'section says On · last export', /Last export: .* completed/.test(text), text.slice(0, 160));
        const mark = new Date();
        const first = await jf('POST', '/JellyfinMod/Trakt/Export', undefined, { raw: true });
        const second = await jf('POST', '/JellyfinMod/Trakt/Export', undefined, { raw: true });
        verify('online', 'Sync Missing Watches Now accepted twice (the second joins)', first.status === 202 && second.status === 202, `${first.status} ${second.status}`);
        await until('the manual run to end', () => lastRunAfter(mark), 300000, 3000);
        await restart();
        await sleep(90000);
        verify('online', 'two more runs and a restart add no play', (await plays()).length === 3, `${(await plays()).length} plays`);
    },

    async catchup() {
        await control('/plays', { plays: [{ season: 1, number: 4, watched_at: '2026-09-01T20:00:00Z' }, { season: 1, number: 5, watched_at: '2026-09-02T20:00:00Z' }] });
        const seeded = (await plays()).filter(play => play.source === 'seed').map(play => ({ ...play }));
        await control('/mode', { down: true });
        for (const number of [4, 5, 6, 7, 8]) await playToEnd(number);
        // A restart during the outage drops the plugin's queued scrobbles (in memory), so only the export can deliver these;
        // a scrobble still queued when Trakt returns would land with the return time instead (stock behaviour, noted).
        await sleep(5000);
        await restart();
        await loadEpisodes();
        const mark = new Date();
        await control('/mode', { down: false });
        await until('a completed export after the catch-up plays', async () => {
            const now = await lastRunAfter(mark);
            return now?.lastRun.status === 'Completed' ? now : null;
        }, 900000, 5000);
        const list = await plays();
        verify('catchup', 'E04, E05 (already on Trakt) keep exactly their one play, id and time', seeded.every(old => {
            const mine = playsOf(list, old.number);
            return mine.length === 1 && mine[0].id === old.id && mine[0].watched_at === old.watched_at;
        }), JSON.stringify(playsOf(list, 4).concat(playsOf(list, 5))));
        for (const number of [6, 7, 8]) {
            const local = (await userData(number)).LastPlayedDate;
            const mine = playsOf(list, number);
            verify('catchup', `E0${number} (missing) added once at its watch time`, mine.length === 1 && mine[0].watched_at === minute(local), `${mine.length} play(s)`);
        }
    },

    async rewatch() {
        const mark = new Date();
        await playToEnd(1);
        const scrobbled = await until('the live scrobble', async () => playsOf(await plays(), 1).length === 2, 60000, 2000).catch(() => false);
        verify('rewatch', 'a play ending online is scrobbled live once (E01 now two plays)', !!scrobbled);
        await until('the export after the quiet period', () => lastRunAfter(mark), 420000, 5000);
        verify('rewatch', 'the following export adds nothing (quiet period)', playsOf(await plays(), 1).length === 2, `${playsOf(await plays(), 1).length}`);
    },

    async failures() {
        const total = (await plays()).length;
        await control('/mode', { failGets: { status: 500, count: 3 } });
        const mark = new Date();
        await jf('POST', '/JellyfinMod/Trakt/Export');
        await until('the run to fail on 500s', () => lastRunAfter(mark), 420000, 5000);
        // JellyfinMod judges the run in its background check (every 15 s at the test pace), which sets the retry.
        const failed = await until('the failed run judged', async () => {
            const state = await lastRunAfter(mark);
            return state && state.failures >= 1 && state.nextAttemptAt ? state : null;
        }, 90000, 3000).catch(() => lastRunAfter(mark));
        verify('failures', 'three 500 answers fail the run and set a retry', failed.lastRun.status === 'Failed' && !!failed.nextAttemptAt && failed.failures >= 1,
            `${failed.lastRun.status}, failures ${failed.failures}, next ${failed.nextAttemptAt}`);
        const wait = new Date(failed.nextAttemptAt) - new Date(failed.lastRun.endedAt);
        verify('failures', 'retry wait within the bound (test pace: 1 min × 1–24)', wait >= 50000 && wait <= 24 * 60000 + 5000, `${Math.round(wait / 1000)} s`);
        await control('/mode', { failGets: { status: 429, count: 2 } });
        const retried = await until('the retried run to complete', async () => {
            const now = await status();
            return now.lastRun?.status === 'Completed' && new Date(now.lastRun.startedAt) > new Date(failed.lastRun.startedAt) && !now.running ? now : null;
        }, 600000, 5000);
        verify('failures', 'the next run rides out two 429s and completes', !!retried, `failures now ${retried.failures}`);
        verify('failures', 'no play added by failures and retries', (await plays()).length === total, `${(await plays()).length} vs ${total}`);
    },

    async paging() {
        const total = (await plays()).length;
        await control('/filler', { shows: 150 });
        await control('/mode', { pageSize: 100 });
        const mark = new Date();
        await jf('POST', '/JellyfinMod/Trakt/Export');
        await until('the paged run', () => lastRunAfter(mark), 300000, 3000);
        const pages = (await control('/state')).requests.filter(entry => entry.route === '/sync/watched/shows' && /page=2/.test(entry.query ?? ''));
        verify('paging', 'the plugin read the second page of watched shows', pages.length > 0, `${pages.length} page-2 read(s)`);
        verify('paging', 'history on page 2 is found: no play sent again', (await plays()).length === total, `${(await plays()).length} vs ${total}`);
        await control('/filler', { shows: 0 });
        await control('/mode', { pageSize: 1000 });
    },

    async refusal() {
        await traktSwitch('PostUnwatchedHistory', true);
        const now = await status();
        verify('refusal', 'post unwatched history on: export refused', now.refusal === 'unwatched_history', now.refusal);
        const post = await jf('POST', '/JellyfinMod/Trakt/Export', undefined, { raw: true });
        verify('refusal', 'Sync Now answers 409', post.status === 409, `${post.status}`);
        const before = now.lastRun?.startedAt;
        // E02 unwatched here while Trakt has it (the export would remove it), and a new play of E03 makes an export due.
        await unplay(2);
        await playToEnd(3);
        await sleep(100000);
        const after = await status();
        verify('refusal', 'no automatic run while refused', after.lastRun?.startedAt === before);
        verify('refusal', 'nothing removed on Trakt', (await control('/state')).removals === 0);
        const text = await shot('04-refused');
        verify('refusal', 'section explains the refusal', /Post unwatched history is on/.test(text), text.slice(0, 160));
        await traktSwitch('PostUnwatchedHistory', false);
        await playToEnd(2);
    },

    async reconnect() {
        await authorize(60);
        await control('/forget', { season: 1, number: 8 });
        await control('/mode', { rejectRefresh: true });
        await sleep(50000);
        await jf('POST', '/JellyfinMod/Trakt/Export');
        const broken = await until('reconnect needed', async () => {
            const now = await status();
            return !now.running && now.users.some(user => user.state === 'reconnect') ? now : null;
        }, 300000, 3000);
        verify('reconnect', 'rejected refresh: oleksii needs reconnecting, since the expiry', !!broken.users[0].since, JSON.stringify(broken.users));
        const settings = await shot('05-reconnect');
        verify('reconnect', 'section shows Reconnect needed and Reconnect Trakt', /Trakt gets nothing from oleksii/.test(settings) && /Reconnect Trakt/.test(settings), settings.slice(0, 160));
        const home = await shot('06-home-reconnect', '#/home', true);
        verify('reconnect', 'Home notice for the administrator', /Trakt stopped receiving watches from oleksii/.test(home), home.slice(0, 120));
        const mark = new Date();
        await sleep(90000);
        verify('reconnect', 'E08 stays missing on Trakt while the account is not linked', playsOf(await plays(), 8).length === 0);
        await control('/mode', { rejectRefresh: false });
        await authorize(7776000);
        const resumed = await until('E08 sent after reconnecting', async () => playsOf(await plays(), 8).length === 1, 300000, 5000).catch(() => false);
        verify('reconnect', 'reconnect: the export starts by itself and sends the waiting watch once', !!resumed);
        const now = await status();
        verify('reconnect', 'linked again, no notice', now.users.every(user => user.state === 'linked') && new Date(now.lastRun.startedAt) > mark);
        const homeAfter = await shot('07-home-after', '#/home');
        verify('reconnect', 'Home notice gone after reconnecting', !/Trakt stopped receiving/.test(homeAfter));
    },

    async isolation() {
        const anonymous = await jf('GET', '/JellyfinMod/Trakt/Export', undefined, { auth: false, raw: true });
        verify('isolation', 'anonymous: 401', anonymous.status === 401, `${anonymous.status}`);
        const created = await jf('POST', '/Users/New', { Name: 'p13viewer', Password: '' });
        try {
            const adminToken = token;
            token = null;
            const viewer = await jf('POST', '/Users/AuthenticateByName', { Username: 'p13viewer', Pw: '' });
            token = viewer.AccessToken;
            const get = await jf('GET', '/JellyfinMod/Trakt/Export', undefined, { raw: true });
            const post = await jf('POST', '/JellyfinMod/Trakt/Export', undefined, { raw: true });
            const put = await jf('PUT', '/JellyfinMod/Trakt/Export/Settings', { autoExport: false }, { raw: true });
            verify('isolation', 'ordinary user: 403 on read, run and switch', [get, post, put].every(response => response.status === 403), [get, post, put].map(r => r.status).join(','));
            await jf('POST', '/Sessions/Logout').catch(() => undefined);
            token = adminToken;
        } finally {
            await jf('DELETE', `/Users/${created.Id}`);
        }
        const gone = (await jf('GET', '/Users')).every(user => user.Name !== 'p13viewer');
        verify('isolation', 'test user removed', gone);
    },

    async absent() {
        const trakt = (await plugins()).find(plugin => plugin.Name === 'Trakt');
        await jf('POST', `/Plugins/${trakt.Id}/${trakt.Version}/Disable`);
        const now = await status();
        verify('absent', 'Trakt plugin disabled: reported not installed, nothing runs', !now.installed && now.refusal === 'not_installed', JSON.stringify({ installed: now.installed, refusal: now.refusal }));
        const text = await shot('08-not-installed');
        verify('absent', 'section says the Trakt plugin is not installed', /Trakt plugin is not installed/.test(text), text.slice(0, 120));
        await jf('POST', `/Plugins/${trakt.Id}/${trakt.Version}/Enable`);
        await restart();
        const back = await status();
        verify('absent', 'enabled again after a restart: installed and linked', back.installed && back.users.some(user => user.state === 'linked'));
    },

    // Links oleksii again when the stand-in has no token (a restarted stand-in), and changes nothing else.
    async relink() {
        const linked = (await status()).users.some(user => user.name === 'oleksii' && user.state === 'linked');
        if (!(await control('/state')).tokenIssued || !linked) await authorize(7776000);
        verify('relink', 'oleksii linked to the stand-in', (await status()).users.some(user => user.name === 'oleksii' && user.state === 'linked'));
    },

    // Only the pace: TraktExportTestMinutes from P13_PACE (default 1; 0 is the real pace), nothing else changed.
    async pace() {
        const minutes = Number(process.env.P13_PACE ?? 1);
        await modConfig(config => { config.TraktExportTestMinutes = minutes; });
        verify('pace', `pace set to ${minutes || 'the real 10/15 minutes'}`, (await status()).quietMinutes === (minutes || 10));
    },

    // Codex P2-1: Trakt refuses the history write while the reads succeed; the plugin logs it and its task says Completed.
    async writefail() {
        await setAuto(true);
        await control('/forget', { season: 1, number: 7 });
        // One refused write: the plugin does not retry a history write, it logs the error and completes its task.
        await control('/mode', { failHistory: { status: 500, count: 1 } });
        const mark = new Date();
        await jf('POST', '/JellyfinMod/Trakt/Export');
        const done = await until('the run with a refused write', () => lastRunAfter(mark), 300000, 3000);
        // JellyfinMod judges a run in its background check (every 15 s at the test pace), never in the status read.
        const now = await until('the run judged', async () => {
            const state = await status();
            return state.lastRunConfirmed === true || state.lastRunConfirmed === false ? state : null;
        }, 90000, 3000);
        verify('writefail', 'the host reports the run Completed although Trakt refused the write', done.lastRun.status === 'Completed');
        verify('writefail', 'JellyfinMod judges it not clean and sets a retry', now.lastRunConfirmed === false && !!now.nextAttemptAt,
            JSON.stringify({ lastRunConfirmed: now.lastRunConfirmed, nextAttemptAt: now.nextAttemptAt, failures: now.failures }));
        verify('writefail', 'E07 is still missing on Trakt after that run', playsOf(await plays(), 7).length === 0);
        const text = await shot('09-write-refused');
        verify('writefail', 'Settings says not every watch reached Trakt', /not every watch reached Trakt/.test(text), text.slice(0, 200));
        const sent = await until('E07 sent by the retry', async () => playsOf(await plays(), 7).length === 1, 420000, 5000).catch(() => false);
        verify('writefail', 'the retry sends the refused watch once', !!sent);
        // The retry is a new run: wait for it to be the last one and to be judged, not the refused run's cached result.
        const after = await until('the retried run judged', async () => {
            const state = await status();
            return !state.running && state.lastRun && state.lastRun.startedAt !== done.lastRun.startedAt &&
                (state.lastRunConfirmed === true || state.lastRunConfirmed === false) ? state : null;
        }, 90000, 3000);
        verify('writefail', 'the retried run is clean', after.lastRunConfirmed === true && !after.nextAttemptAt, JSON.stringify({ lastRunConfirmed: after.lastRunConfirmed }));
    },

    // Codex P2-2: an account needing reconnect, a restart, then the reconnect before JellyfinMod looks again.
    async reconnectrestart() {
        await setAuto(true);
        await authorize(60);
        await control('/forget', { season: 1, number: 8 });
        await control('/mode', { rejectRefresh: true });
        await sleep(50000);
        await jf('POST', '/JellyfinMod/Trakt/Export', undefined, { raw: true });
        await until('reconnect needed', async () => {
            const now = await status();
            return !now.running && now.users.some(user => user.state === 'reconnect') ? now : null;
        }, 300000, 3000);
        const post = await jf('POST', '/JellyfinMod/Trakt/Export', undefined, { raw: true });
        verify('reconnectrestart', 'no account linked (all need reconnecting): Sync Now refused', post.status === 409, `${post.status}`);
        // Give a run that would skip the account (the old behaviour) time to happen, and JellyfinMod time to note the account.
        const mark = new Date();
        await sleep(150000);
        const skipped = await lastRunAfter(mark);
        verify('reconnectrestart', 'no export runs while no account is linked', !skipped, skipped ? `${skipped.lastRun.status} at ${skipped.lastRun.startedAt}` : 'none');
        await control('/mode', { rejectRefresh: false });
        await restart();
        await authorize(7776000);
        const sent = await until('E08 sent after the restart and reconnect', async () => playsOf(await plays(), 8).length === 1, 300000, 5000).catch(() => false);
        verify('reconnectrestart', 'after a restart and a reconnect the waiting watch is still sent, once', !!sent);
    },

    // Codex P2-5: the Home notice and Settings › Trakt follow the state while they stay open.
    async refresh() {
        browser ??= await chromium.launch({ headless: true });
        const open = async hash => {
            const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
            await page.goto(origin + '/web/', { waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => !!window.ApiClient, undefined, { timeout: 30000 });
            await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId() || /login|selectuser|selectserver/.test(location.hash); } catch { return false; } }, undefined, { timeout: 30000 });
            if (!await page.evaluate(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } })) {
                const field = page.locator('#txtManualName');
                if (!await field.isVisible().catch(() => false)) {
                    const chooser = page.locator('.btnManual').first();
                    if (await chooser.count()) await chooser.evaluate(node => node.click());
                    await field.waitFor({ state: 'visible', timeout: 15000 });
                }
                await field.fill('oleksii');
                await page.waitForTimeout(1200);
                await field.fill('oleksii');
                await page.locator('button:visible').filter({ hasText: 'Sign In' }).first().click();
                await page.waitForFunction(() => location.hash.startsWith('#/home'), undefined, { timeout: 30000 });
            }
            await page.evaluate(next => { location.hash = next; }, hash);
            await page.waitForTimeout(3000);
            return page;
        };
        const home = await open('#/home');
        const settings = await open('#/catalog/settings?section=trakt');
        try {
            const noticeShown = () => home.evaluate(() => !!document.querySelector('.jfmod-traktNoticeMount .jfmod-notice'));
            const settingsText = () => settings.evaluate(() => document.querySelector('.jfmod-check-section[data-section="trakt"]')?.innerText ?? '');
            verify('refresh', 'linked: no Home notice at first', !await noticeShown());
            await authorize(60);
            await control('/mode', { rejectRefresh: true });
            await sleep(50000);
            await jf('POST', '/JellyfinMod/Trakt/Export', undefined, { raw: true });
            const appeared = await until('the Home notice without a reload', noticeShown, 150000, 3000).catch(() => false);
            verify('refresh', 'the Home notice appears while Home stays open', !!appeared);
            const reconnectShown = await until('Settings to say Reconnect needed', async () => /Trakt gets nothing from oleksii/.test(await settingsText()), 150000, 3000).catch(() => false);
            verify('refresh', 'Settings › Trakt left open idle shows Reconnect needed', !!reconnectShown);
            const rail = await settings.evaluate(() => document.querySelector('.jfmod-step[data-section="trakt"] .jfmod-s')?.textContent ?? '');
            verify('refresh', 'the Settings rail entry for Trakt says Reconnect needed too', /Reconnect needed/.test(rail), rail);
            await control('/mode', { rejectRefresh: false });
            await authorize(7776000);
            const gone = await until('the Home notice to go', async () => !await noticeShown(), 150000, 3000).catch(() => false);
            verify('refresh', 'the Home notice goes after reconnecting, without a reload', !!gone);
        } finally {
            await home.close();
            await settings.close();
        }
    }
,

    // D49: the server reads the linked account's Trakt username and avatar (the stand-in's /users/settings) and Settings shows
    // them; with no avatar on Trakt, the person glyph on the grey disc. The token never reaches the browser.
    async profile() {
        await control('/mode', { username: 'p13-standin', avatar: true });
        const read = await until('the Trakt profile read', async () => {
            const user = (await status()).users.find(entry => entry.name === 'oleksii');
            return user?.traktUsername && user.avatarUrl ? user : null;
        }, 150000, 3000).catch(() => null);
        verify('profile', 'the server read the Trakt username and avatar', read?.traktUsername === 'p13-standin' && /^http:\/\/127\.0\.0\.1:\d+\/avatar\.svg$/.test(read?.avatarUrl ?? ''),
            JSON.stringify({ traktUsername: read?.traktUsername, avatarUrl: read?.avatarUrl }));
        const calls = (await control('/state')).requests.filter(entry => entry.route === '/users/settings');
        verify('profile', 'one read-only /users/settings call with the plugin\'s headers and its token', calls.length >= 1 && calls.every(entry => entry.method === 'GET' && entry.apiHeaders && entry.authorized),
            `${calls.length} call(s)`);
        verify('profile', 'no response carries a token field', !/token/i.test(JSON.stringify(await status())));
        const page = await openPage();
        try {
            const row = await page.evaluate(() => {
                const node = document.querySelector('[data-jfmod-trakt-user="oleksii"]');
                const image = node?.querySelector('img.jfmod-traktAvatar');
                return { title: node?.querySelector('strong')?.textContent ?? '', loaded: !!image && image.complete && image.naturalWidth > 0,
                    disconnect: node?.querySelector('[data-jfmod-trakt-disconnect="oleksii"]')?.getAttribute('aria-label') ?? '' };
            });
            verify('profile', 'the row shows the avatar and "oleksii · p13-standin on Trakt"', row.loaded && row.title === 'oleksii · p13-standin on Trakt', JSON.stringify(row));
            verify('profile', 'the row has the Disconnect icon named for the account', row.disconnect === 'Disconnect Trakt for oleksii', row.disconnect);
            await page.screenshot({ path: join(out, 'shots', '10-linked-avatar.png') });
        } finally {
            await page.close();
        }
        // No avatar on Trakt: linked again (a new link makes the server read the profile again), the person glyph.
        await control('/mode', { avatar: false });
        await authorize(7776000);
        const none = await until('the profile without an avatar', async () => {
            const user = (await status()).users.find(entry => entry.name === 'oleksii');
            return user && !user.avatarUrl ? user : null;
        }, 150000, 3000).catch(() => null);
        const fallback = await openPage();
        try {
            const glyph = await fallback.evaluate(() => !!document.querySelector('[data-jfmod-trakt-user="oleksii"] .jfmod-traktAvatar-none svg'));
            verify('profile', 'no avatar on Trakt: the person glyph on the grey disc', !!none && glyph);
            await fallback.screenshot({ path: join(out, 'shots', '11-no-avatar.png') });
        } finally {
            await fallback.close();
        }
        await control('/mode', { avatar: true });
        await authorize(7776000);
        await until('the avatar back', async () => !!(await status()).users.find(entry => entry.name === 'oleksii')?.avatarUrl, 150000, 3000).catch(() => null);
    },

    // D125–D130, D134, D135: Activity is one row per title, "media · time · action", under a day heading. A watch here waits
    // for the export that the next-export line names, then reads marked watched on Trakt; a title Trakt does not know reads
    // failed without holding back the run; a play reported live reads watching now, then where it stopped.
    async activity() {
        await setAuto(true);
        // Bring Trakt level with Jellyfin first (a restarted stand-in has no history), then take E06 away so a watch sends it.
        const level = new Date();
        await jf('POST', '/JellyfinMod/Trakt/Export');
        await until('the levelling run', () => lastRunAfter(level), 300000, 3000);
        await until('the levelling run judged', async () => (await status()).lastRunConfirmed === true, 90000, 3000).catch(() => null);
        await control('/forget', { season: 1, number: 6 });
        await unplay(6);
        const rowOf = (list, code, direction = 'to') => (list ?? []).find(row => row.code === code && row.direction === direction && row.title === 'JellyfinMod P13 Show');
        const itemText = (page, code) => page.evaluate(match => [...document.querySelectorAll('[data-jfmod-trakt="activity"] .jfmod-traktItem')]
            .find(node => node.getAttribute('data-jfmod-trakt-item')?.startsWith('to:') && node.getAttribute('data-jfmod-trakt-item').endsWith(match))?.innerText.replace(/\s+/g, ' ').trim() ?? '', `JellyfinMod P13 Show ${code}`);
        const dotOf = (page, code) => page.evaluate(match => [...document.querySelectorAll('[data-jfmod-trakt="activity"] .jfmod-traktItem')]
            .find(node => node.getAttribute('data-jfmod-trakt-item')?.startsWith('to:') && node.getAttribute('data-jfmod-trakt-item').endsWith(match))?.querySelector('.jfmod-state')?.className ?? '', `JellyfinMod P13 Show ${code}`);
        const openActivity = async page => {
            const closed = await page.evaluate(() => document.querySelector('.jfmod-activityToggle')?.getAttribute('aria-expanded'));
            await page.locator('.jfmod-activityToggle').click();
            await page.mouse.move(5, 995);
            await page.waitForTimeout(400);
            return closed;
        };

        // A watch here: the row waits for the export the next-export line names, at the same time.
        const watched = new Date();
        await playToEnd(6);
        const waiting = await until('the watch listed, waiting', async () => {
            const now = await status();
            return rowOf(now.activity, 'S01E06')?.state === 'waiting' && now.nextExportAt ? now : null;
        }, 30000, 1000).catch(() => null);
        const due = waiting?.nextExportAt ? new Date(waiting.nextExportAt) : null;
        verify('activity', 'the watch is listed at once, waiting, with the export due a quiet minute after it ended', !!due && due - watched >= 50000 && due - watched <= 75000,
            JSON.stringify({ row: rowOf(waiting?.activity, 'S01E06'), nextExportAt: waiting?.nextExportAt }));
        const page = await openPage();
        try {
            const hint = await page.evaluate(() => document.querySelector('.jfmod-activityHint')?.textContent ?? '');
            const closed = await openActivity(page);
            const openHint = await page.evaluate(() => document.querySelector('.jfmod-activityHint')?.textContent ?? '');
            verify('activity', 'Activity is closed at first with "Each title sent to Trakt or brought from it, the last 30 days", and opens',
                closed === 'false' && hint === 'Each title sent to Trakt or brought from it, the last 30 days' && openHint === 'The last 30 days, newest first', `${hint} | ${openHint}`);
            // The time as the page writes it, in the browser's own locale.
            const clock = due ? await page.evaluate(iso => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), due.toISOString()) : '?';
            const text = await itemText(page, 'S01E06');
            const next = await page.evaluate(() => document.querySelector('[data-jfmod-trakt-next]')?.textContent ?? '');
            const heading = await page.evaluate(() => document.querySelector('[data-jfmod-trakt="activity"] .jfmod-traktDay')?.textContent ?? '');
            verify('activity', `the row reads "JellyfinMod P13 Show S01E06 · <time> · waiting: the export runs at ${clock}" under Today, amber`,
                heading === 'Today' && text.startsWith('JellyfinMod P13 Show S01E06 · ') && text.endsWith(`waiting: the export runs at ${clock}`) && /jfmod-state-warn/.test(await dotOf(page, 'S01E06')), `${heading} | ${text}`);
            verify('activity', `the next-export line names the same time: "The next export runs at ${clock}, 1 minute after the last episode ended."`,
                next === `The next export runs at ${clock}, 1 minute after the last episode ended.`, next);
            await page.screenshot({ path: join(out, 'shots', '12-activity-waiting.png'), fullPage: true });
        } finally {
            await page.close();
        }
        const sent = await until('the automatic export to send it', async () => {
            const now = await status();
            return rowOf(now.activity, 'S01E06')?.state === 'sent' ? now : null;
        }, 240000, 3000).catch(() => null);
        verify('activity', 'the automatic export sends it: the row reads marked watched on Trakt, once on Trakt', !!sent && playsOf(await plays(), 6).length >= 1,
            JSON.stringify(rowOf(sent?.activity, 'S01E06')));

        // A title Trakt does not know: failed, and the run still counts as delivered (no retry).
        await control('/mode', { unknown: [{ season: 1, number: 7 }] });
        await control('/forget', { season: 1, number: 7 });
        await unplay(7);
        await playToEnd(7);
        const lost = await until('the export to answer E07 not found', async () => {
            const now = await status();
            return rowOf(now.activity, 'S01E07')?.state === 'failed' ? now : null;
        }, 240000, 3000).catch(() => null);
        verify('activity', 'the title Trakt answered as not found reads failed', !!lost, JSON.stringify(rowOf((await status()).activity, 'S01E07')));
        const judged = await until('the not-found run judged', async () => {
            const now = await status();
            return now.lastRunConfirmed === true || now.lastRunConfirmed === false ? now : null;
        }, 90000, 3000).catch(() => null);
        verify('activity', 'it does not hold back the run: delivered, no failure and no retry', judged?.lastRunConfirmed === true && judged.failures === 0 && !judged.nextAttemptAt,
            JSON.stringify({ lastRunConfirmed: judged?.lastRunConfirmed, failures: judged?.failures, nextAttemptAt: judged?.nextAttemptAt }));
        await control('/mode', { unknown: [] });

        // Live: a play by the linked account (the Trakt plugin's Scrobble on) reads watching now; stopped early, where it stopped.
        const live = (await jf('GET', `/Items?userId=${userId}&ids=${episode(8).Id}&Fields=RunTimeTicks`)).Items[0];
        const runtime = live.RunTimeTicks ?? 0;
        const session = `p13-live-${Date.now()}`;
        await jf('POST', '/Sessions/Playing', { ItemId: live.Id, PlaySessionId: session, PositionTicks: 0, CanSeek: true, PlayMethod: 'DirectPlay', IsPaused: false });
        const playing = await until('the play listed as watching now', async () => rowOf((await status()).activity, 'S01E08')?.state === 'playing', 20000, 1000).catch(() => false);
        verify('activity', 'a play by the linked account is listed at once as playing', !!playing);
        const livePage = await openPage();
        try {
            await openActivity(livePage);
            const text = await itemText(livePage, 'S01E08');
            verify('activity', 'it reads "watching now on Trakt (reported live by the Trakt plugin)", amber', text.endsWith('watching now on Trakt (reported live by the Trakt plugin)') &&
                /jfmod-state-warn/.test(await dotOf(livePage, 'S01E08')), text);
            await livePage.screenshot({ path: join(out, 'shots', '12b-activity-playing.png'), fullPage: true });
        } finally {
            await livePage.close();
        }
        // The fixture episodes run 12 s, under the host's minimum resume duration (300 s), so any stop would mark them played:
        // for this stop the minimum is 0, and the server's own value is put back after it.
        const server = await jf('GET', '/System/Configuration');
        const resume = server.MinResumeDurationSeconds;
        await jf('POST', '/System/Configuration', { ...server, MinResumeDurationSeconds: 0 });
        try {
            await jf('POST', '/Sessions/Playing/Stopped', { ItemId: live.Id, PlaySessionId: session, PositionTicks: Math.round(runtime * 0.3) });
        } finally {
            await jf('POST', '/System/Configuration', { ...(await jf('GET', '/System/Configuration')), MinResumeDurationSeconds: resume });
        }
        const stopped = await until('the play stopped', async () => {
            const row = rowOf((await status()).activity, 'S01E08');
            return row?.state === 'stopped' ? row : null;
        }, 20000, 1000).catch(() => null);
        verify('activity', 'stopped at 30 %: the row says where it stopped', runtime > 0 && stopped?.detail === 30, JSON.stringify({ runtime, stopped }));
        const endPage = await openPage();
        try {
            await openActivity(endPage);
            const rows = {
                e06: await itemText(endPage, 'S01E06'), e07: await itemText(endPage, 'S01E07'), e08: await itemText(endPage, 'S01E08'),
                e07dot: await dotOf(endPage, 'S01E07')
            };
            verify('activity', 'E06 reads marked watched on Trakt, E07 failed in red, E08 stopped at 30 %', rows.e06.endsWith('· marked watched on Trakt') &&
                rows.e07.endsWith('· failed: Trakt does not know this episode') && /jfmod-state-err/.test(rows.e07dot) &&
                rows.e08.endsWith('· stopped at 30 % (reported live by the Trakt plugin)'), JSON.stringify(rows));
            await endPage.screenshot({ path: join(out, 'shots', '12c-activity-open.png'), fullPage: true });
        } finally {
            await endPage.close();
        }
        await playToEnd(7);
    },

    // Both ways (user, 2026-10-29): Sync Now runs the Trakt plugin's own import first, then the export. A watch made
    // elsewhere (on Trakt) lands in Jellyfin at its Trakt time and is not sent back as a new play: the import saves with
    // the reason Import, which the plugin's ServerMediator ignores, and the export finds the play already on Trakt.
    async import() {
        const on = await jf('PUT', '/JellyfinMod/Trakt/Export/Settings', { import: true });
        verify('import', 'the import switch is on, and the import is allowed', on.importEnabled === true && !on.importRefusal, JSON.stringify({ importEnabled: on.importEnabled, importRefusal: on.importRefusal }));
        await control('/forget', { season: 1, number: 5 });
        await unplay(5);
        const watchedAt = '2026-09-05T19:30:00Z';
        await control('/plays', { plays: [{ season: 1, number: 5, watched_at: watchedAt }] });
        const before = await control('/state');
        const scrobbles = Object.entries(before.counters).filter(([route]) => route.startsWith('/scrobble/')).reduce((sum, [, count]) => sum + count, 0);
        verify('import', 'E05 starts unwatched in Jellyfin, with one play on Trakt', !(await userData(5)).Played && playsOf(before.plays, 5).length === 1);
        const mark = new Date();
        await jf('POST', '/JellyfinMod/Trakt/Export');
        const both = await until('the import and then the export', async () => {
            const now = await status();
            const imported = now.activity?.find(row => row.direction === 'from' && row.code === 'S01E05' && row.state === 'imported' && new Date(row.at) >= mark);
            return imported && now.lastRun && new Date(now.lastRun.startedAt) > mark && !now.running && !now.importRunning ? { now, imported } : null;
        }, 600000, 3000).catch(() => null);
        const ran = logLines(mark).filter(line => /starts the Trakt plugin's (import|export) \(/.test(line)).map(line => line.replace(/^.*starts the Trakt plugin's /, ''));
        verify('import', 'Sync Now ran the import, then the export after it', !!both && /^import \("requested by an administrator"\)/.test(ran[0] ?? '') &&
            /^export \("after the import from Trakt"\)/.test(ran[1] ?? ''), ran.join(' || '));
        // Read from the library query: Jellyfin 12.2's single-item answer (/Items/{id}) keeps the user data it cached before
        // the import saved (found 2026-10-29; upstream, see PHASE13), while the library's own query reads what was saved.
        const listed = (await jf('GET', `/Items?userId=${userId}&ids=${episode(5).Id}&Fields=UserData`)).Items[0].UserData;
        const single = await userData(5);
        verify('import', 'E05 is watched in Jellyfin at its Trakt time', listed.Played && minute(listed.LastPlayedDate) === minute(watchedAt),
            `library query: ${listed.Played} ${listed.LastPlayedDate}; single item: ${single.Played} ${single.LastPlayedDate ?? ''}`);
        verify('import', 'Activity lists E05 as brought from Trakt, at its time here', !!both && Math.abs(new Date(both.imported.at) - Date.now()) < 600000, JSON.stringify(both?.imported));
        const after = await control('/state');
        const scrobblesAfter = Object.entries(after.counters).filter(([route]) => route.startsWith('/scrobble/')).reduce((sum, [, count]) => sum + count, 0);
        verify('import', 'nothing is sent back: E05 keeps its one Trakt play, no scrobble', playsOf(after.plays, 5).length === 1 && scrobblesAfter === scrobbles,
            `${playsOf(after.plays, 5).length} play(s), scrobbles ${scrobbles} → ${scrobblesAfter}`);
        const page = await openPage();
        try {
            const row = await page.evaluate(() => ({
                label: document.querySelector('[data-jfmod-trakt="import"] .MuiFormControlLabel-label')?.textContent ?? '',
                checked: document.querySelector('[data-jfmod-trakt="import"] input[type="checkbox"]')?.checked
            }));
            verify('import', 'Settings shows "Also import watches from Trakt", on', row.label === 'Also import watches from Trakt' && row.checked === true, JSON.stringify(row));
            await page.screenshot({ path: join(out, 'shots', '15-import-switch.png') });
            await page.locator('.jfmod-activityToggle').click();
            await page.mouse.move(5, 995);
            await page.waitForTimeout(400);
            const line = await page.evaluate(() => [...document.querySelectorAll('[data-jfmod-trakt="activity"] .jfmod-traktItem')]
                .find(node => node.getAttribute('data-jfmod-trakt-item') === 'from:imported:JellyfinMod P13 Show S01E05')?.innerText.replace(/\s+/g, ' ').trim() ?? '');
            verify('import', 'Activity reads "JellyfinMod P13 Show S01E05 · <time> · marked watched in Jellyfin (from Trakt)"',
                line.startsWith('JellyfinMod P13 Show S01E05 · ') && line.endsWith('· marked watched in Jellyfin (from Trakt)'), line);
            await page.evaluate(() => document.querySelector('[data-jfmod-trakt="activity"]')?.scrollIntoView({ block: 'start' }));
            await page.waitForTimeout(300);
            await page.screenshot({ path: join(out, 'shots', '16-activity-import.png') });
        } finally {
            await page.close();
        }
        // With the switch off, Sync Now runs the export alone.
        await jf('PUT', '/JellyfinMod/Trakt/Export/Settings', { import: false });
        const alone = new Date();
        await jf('POST', '/JellyfinMod/Trakt/Export');
        const done = await until('the export alone', () => lastRunAfter(alone), 300000, 3000).catch(() => null);
        const alone2 = logLines(alone).filter(line => /starts the Trakt plugin's (import|export) \(/.test(line)).map(line => line.replace(/^.*starts the Trakt plugin's /, ''));
        verify('import', 'with the switch off, Sync Now runs the export alone', !!done && alone2.length === 1 && /^export \("requested by an administrator"\)/.test(alone2[0]), alone2.join(' || '));
        await jf('PUT', '/JellyfinMod/Trakt/Export/Settings', { import: true });
    },

    // D48, D68: Disconnect asks first (Cancel focused), then the Trakt plugin's own Deauthorize removes its entry for the
    // user; the row leaves and the section says so. Linked again afterwards.
    async disconnect() {
        const page = await openPage();
        try {
            await page.locator('[data-jfmod-trakt-disconnect="oleksii"]').click();
            await page.waitForSelector('[data-jfmod-confirm]', { timeout: 10000 });
            await page.waitForTimeout(400);
            const dialog = await page.evaluate(() => ({
                text: document.querySelector('.MuiDialog-paper')?.innerText ?? '',
                focused: document.activeElement?.getAttribute('data-jfmod-confirm') ?? ''
            }));
            verify('disconnect', 'the confirmation names the account and starts on Cancel', /Disconnect Trakt for oleksii\?/.test(dialog.text) && /the Trakt account p13-standin/.test(dialog.text) && dialog.focused === 'cancel',
                dialog.text.replace(/\n/g, ' ').slice(0, 220));
            verify('disconnect', 'it says the Trakt plugin\'s settings for oleksii are reset', /settings for oleksii are reset/.test(dialog.text));
            await page.screenshot({ path: join(out, 'shots', '13-confirm.png') });
            await page.locator('[data-jfmod-confirm="confirm"]').click();
            const gone = await until('the row to leave', async () => (await page.locator('[data-jfmod-trakt-user="oleksii"]').count()) === 0, 30000, 1000).catch(() => false);
            const text = await traktText(page);
            verify('disconnect', 'the row leaves and the section says Trakt is disconnected for oleksii', !!gone && /Trakt is disconnected for oleksii\./.test(text), text.slice(0, 160));
            await page.screenshot({ path: join(out, 'shots', '14-disconnected.png') });
        } finally {
            await page.close();
        }
        // Nobody connected (D128, D129): the account bar first with Connect Trakt; the switches and Sync Now dimmed under one hint.
        const bare = await openPage();
        try {
            const view = await bare.evaluate(() => {
                const section = document.querySelector('.jfmod-check-section[data-section="trakt"]');
                const body = section?.querySelector('.jfmod-check-secbody');
                const first = [...(body?.children ?? [])].find(node => !node.classList.contains('jfmod-notice'));
                const bar = section?.querySelector('.jfmod-traktAccount [data-jfmod-trakt-user=""]');
                const connect = bar?.querySelector('[data-jfmod-trakt-connect]');
                const off = [...section.querySelectorAll('.jfmod-traktOff')].map(node => node.getAttribute('data-jfmod-trakt'));
                const inputs = [...section.querySelectorAll('.jfmod-traktOff input[type="checkbox"]')].map(input => input.getAttribute('aria-disabled'));
                const sync = section.querySelector('[data-jfmod-trakt="export"] .MuiButton-root');
                return {
                    first: first?.className ?? '', title: bar?.querySelector('strong')?.textContent ?? '', pill: bar?.querySelector('.jfmod-state')?.textContent ?? '',
                    connect: connect ? { text: connect.textContent, href: connect.getAttribute('href') } : null, off, inputs,
                    hint: section.querySelector('.jfmod-traktConnectHint')?.textContent ?? '', opacity: getComputedStyle(section.querySelector('.jfmod-traktOff .MuiFormControlLabel-root')).opacity,
                    sync: { disabled: sync?.getAttribute('aria-disabled'), title: sync?.getAttribute('title') }, next: section.querySelector('[data-jfmod-trakt-next]')?.textContent ?? '',
                    warning: /No Jellyfin user is linked/.test(section.innerText), activity: !!section.querySelector('[data-jfmod-trakt="activity"]')
                };
            });
            verify('disconnect', 'the account bar comes first: "oleksii · not connected to Trakt", Not connected, Connect Trakt to the Trakt plugin\'s page',
                /jfmod-traktAccount/.test(view.first) && view.title === 'oleksii · not connected to Trakt' && view.pill === 'Not connected' &&
                view.connect?.text === 'Connect Trakt' && view.connect.href === '#/configurationpage?name=trakt', JSON.stringify(view));
            verify('disconnect', 'the switches and Sync Now stay, dimmed to 45 % and aria-disabled, under "Connect a Trakt account to turn these on."',
                view.off.join(',') === 'auto,import,export' && view.inputs.every(value => value === 'true') && view.inputs.length === 2 && view.opacity === '0.45' &&
                view.hint === 'Connect a Trakt account to turn these on.' && view.sync.disabled === 'true' && view.sync.title === 'Connect a Trakt account first.', JSON.stringify(view));
            verify('disconnect', 'no separate no-account warning, no Activity, and the next line says nothing is sent until an account is connected',
                !view.warning && !view.activity && view.next === 'Nothing is sent until a Trakt account is connected.', JSON.stringify(view));
            const before = (await status()).autoExport;
            await bare.locator('[data-jfmod-trakt="auto"] input[type="checkbox"]').click({ force: true });
            await bare.waitForTimeout(1500);
            verify('disconnect', 'a press on the dimmed switch changes nothing', (await status()).autoExport === before);
            await bare.screenshot({ path: join(out, 'shots', '14b-not-connected.png'), fullPage: true });
        } finally {
            await bare.close();
        }
        const trakt = (await plugins()).find(plugin => plugin.Name === 'Trakt');
        const config = await jf('GET', `/Plugins/${trakt.Id}/Configuration`);
        verify('disconnect', 'the Trakt plugin no longer holds an entry for oleksii', !(config.TraktUsers ?? []).some(user => user.LinkedMbUserId?.replace(/-/g, '') === userId.replace(/-/g, '')));
        const now = await status();
        verify('disconnect', 'no account is linked: the export is refused', now.refusal === 'no_users' && now.users.length === 0, now.refusal);
        await authorize(7776000);
        const back = await until('linked again', async () => (await status()).users.some(user => user.name === 'oleksii' && user.state === 'linked'), 60000, 2000).catch(() => false);
        verify('disconnect', 'authorizing again links oleksii with the plugin\'s defaults', !!back);
    }
};

const chosen = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(steps);
try {
    userId = await signIn();
    await loadEpisodes();
    for (const name of chosen) {
        console.log(`---- ${name}`);
        try {
            await steps[name]();
        } catch (error) {
            record(name, 'step ran to the end', 'FAIL', String(error?.message ?? error).split('\n')[0]);
        }
    }
} finally {
    await browser?.close();
    writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 1));
    const failed = results.filter(entry => entry.verdict !== 'PASS');
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    process.exitCode = failed.length ? 1 : 0;
}
