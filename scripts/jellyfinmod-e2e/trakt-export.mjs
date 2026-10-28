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
// writefail reconnectrestart refresh profile activity disconnect (pace: only sets the test pace, P13_PACE; relink: links
// oleksii again after a stand-in restart)
// Each check prints PASS/FAIL and the run writes <out>/results.json. Desktop Chromium screenshots of Settings › Trakt and
// Home at the states the steps reach go to <out>/shots. No token or secret is printed or written.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
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
        if (!(await control('/state')).tokenIssued) await authorize(7776000);
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

    // D50, D73: each run in Activity with why it ran and what it sent, from the plugin's own count lines.
    async activity() {
        // First bring Trakt level with Jellyfin (a restarted stand-in has no history), then take E06 away so the next run sends one.
        const level = new Date();
        await jf('POST', '/JellyfinMod/Trakt/Export');
        const levelled = await until('the levelling run', () => lastRunAfter(level), 300000, 3000);
        await control('/forget', { season: 1, number: 6 });
        const mark = new Date();
        await jf('POST', '/JellyfinMod/Trakt/Export');
        await until('the Sync Now run', () => lastRunAfter(mark), 300000, 3000);
        const judged = await until('the run judged', async () => {
            const now = await status();
            return now.activity?.[0]?.startedAt === now.lastRun?.startedAt ? now : null;
        }, 90000, 3000).catch(() => null);
        const run = judged?.activity?.[0];
        verify('activity', 'the run is listed first: Sync Now, clean, 1 episode sent as watched', run?.why === 'sync_now' && run.clean && run.episodesWatched === 1,
            JSON.stringify(run));
        verify('activity', 'E06 reached Trakt once', playsOf(await plays(), 6).length === 1);
        const before = judged?.activity?.[1];
        verify('activity', 'the levelling run seconds before it is listed too, as Sync Now', before?.startedAt === levelled.lastRun.startedAt && before?.why === 'sync_now',
            JSON.stringify(before));
        const page = await openPage();
        try {
            const closed = await page.evaluate(() => document.querySelector('.jfmod-activityToggle')?.getAttribute('aria-expanded'));
            await page.locator('.jfmod-activityToggle').click();
            await page.mouse.move(5, 995);
            await page.waitForTimeout(400);
            const shown = await page.evaluate(() => ({
                expanded: document.querySelector('.jfmod-activityToggle')?.getAttribute('aria-expanded'),
                first: document.querySelector('[data-jfmod-trakt="activity"] .jfmod-scrolllist .jfmod-brow')?.innerText.replace(/\n/g, ' | ') ?? ''
            }));
            verify('activity', 'Activity is closed at first and opens', closed === 'false' && shown.expanded === 'true');
            verify('activity', 'the first run reads "… · Sync Now" then "Completed · 1 episode marked watched…"', /· Sync Now/.test(shown.first) && /Completed \| · 1 episode marked watched/.test(shown.first), shown.first);
            await page.screenshot({ path: join(out, 'shots', '12-activity-open.png'), fullPage: true });
        } finally {
            await page.close();
        }
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
