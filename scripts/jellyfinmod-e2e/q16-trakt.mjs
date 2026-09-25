/* eslint-disable compat/compat, no-restricted-globals, sonarjs/cognitive-complexity -- a Node acceptance runner, not shipped code */
/* global window, document, ApiClient, location, localStorage */
// P7.Q16 acceptance: the Trakt indicator, end to end, with the stock Trakt plugin (v31) and a stand-in api.trakt.tv.
//
// On a disposable container from `standins/fresh-env.sh up` with JFMOD_TRAKT=1 (and `stage-trakt`), in this order:
//
//   JELLYFINMOD_Q16_STEP=setup       first-run wizard by API, a throwaway administrator and a second user (generated
//                                    passwords, 0600 files in $JELLYFINMOD_Q16_LOCAL, never printed), Movies and Shows
//                                    libraries on the fixture media, a scan, the fixture ids
//   JELLYFINMOD_Q16_STEP=install     Dashboard → Plugins → Trakt → Install (the server downloads it from its catalog),
//                                    restart, then the installed copy's id, version and status from GET /Plugins
//   JELLYFINMOD_Q16_STEP=authorize   the Trakt plugin's own device authorization for the administrator, approved on the
//                                    stand-in as a user entering the code on trakt.tv would
//   JELLYFINMOD_Q16_STEP=sync        the plugin's "Import watched states … from trakt.tv" task; Jellyfin's user data and
//                                    JellyfinMod's answers before and after, for both users and anonymously
//   JELLYFINMOD_Q16_STEP=nfo         (P7.Q16 review P2-1) Jellyfin's NFO user for watch data set to the administrator, a
//                                    .nfo with <watched>true</watched> beside the unwatched movie and <watched>false</watched>
//                                    beside the Trakt movie, a refresh: Jellyfin imports both (saved with Import) while
//                                    no Trakt task runs, and JellyfinMod records neither and deletes nothing; then a real
//                                    Trakt sync still records
//   JELLYFINMOD_Q16_STEP=browser     the detail pages of the movie, episode, season and series (and three negative
//                                    controls) in desktop, mobile 390 px, TV 1920×1080 and TV 1280×720, for both users;
//                                    JELLYFINMOD_Q16_EXPECT=present|absent says whether the administrator sees it
//   JELLYFINMOD_Q16_STEP=disable     Dashboard → Plugins → Trakt → Enable plugin off, then a restart
//   JELLYFINMOD_Q16_STEP=uninstall   Dashboard → Plugins → Trakt → Uninstall, then a restart
//
// On the acceptance instance (28096), read-only, signed in as oleksii with an empty password:
//
//   JELLYFINMOD_Q16_STEP=degrade JELLYFINMOD_Q16_BUILD=released|q16   four layouts, a movie, an episode, its season and
//                                    series: no indicator, no failed request, no page error; with q16 no Trakt request
//                                    at all (Health says Trakt is absent), an empty mount, and the page geometry and D-pad
//                                    walk equal the released run
//
// Environment: JELLYFINMOD_Q16_URL, JELLYFINMOD_BROWSER=chromium|chrome, JELLYFINMOD_Q16_OUT (JSON, appended),
// JELLYFINMOD_Q16_LOCAL (disposable only), JELLYFINMOD_Q16_SSH and JELLYFINMOD_Q16_TRAKT_CONTROL (the stand-in's loopback
// control port), JELLYFINMOD_Q16_CONTAINER (the disposable container's name, for restarts), JELLYFINMOD_Q16_SHOTS
// (screenshot directory), JELLYFINMOD_Q16_LAYOUTS (default desktop,mobile,tv1080,tv720), JELLYFINMOD_Q16_HOST_ROOT (the
// disposable state directory on the host, for a read-only look at Jellyfin's UserData table).
// A wait that runs out is NOT VERIFIED, never PASS. Nothing here prints a credential or token.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const required = name => process.env[name] ?? (() => { throw new Error(`${name} is required`); })();
const origin = new URL(required('JELLYFINMOD_Q16_URL'));
const step = required('JELLYFINMOD_Q16_STEP');
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
const acceptance = step === 'degrade';
if (acceptance ? origin.port !== '28096' : ['8096', '18096', '28096'].includes(origin.port)) {
    throw new Error(acceptance ? 'degrade runs on the acceptance instance only' : 'Runs only against a disposable container');
}
if (origin.port === '8096') throw new Error('Never production');
const LOCAL = acceptance ? null : required('JELLYFINMOD_Q16_LOCAL');
const TRAKT_ID = '4fe3201e-d6ae-4f2e-8917-e12bda571281';
const ADMIN = 'jfmod-q16-admin';
const VIEWER = 'jfmod-q16-viewer';
const AUTH = 'MediaBrowser Client="JellyfinMod Q16", Device="q16-runner", DeviceId="q16-runner", Version="1.0"';
const LAYOUTS = {
    desktop: { viewport: { width: 1440, height: 900 } },
    mobile: {
        viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
    },
    tv1080: { viewport: { width: 1920, height: 1080 }, tv: true },
    tv720: { viewport: { width: 1280, height: 720 }, tv: true }
};
const layouts = (process.env.JELLYFINMOD_Q16_LAYOUTS ?? 'desktop,mobile,tv1080,tv720').split(',');
const shots = process.env.JELLYFINMOD_Q16_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

// ---- results, scrubbed of addresses, host paths and every generated secret
const secretFile = name => join(LOCAL, name);
const secrets = () => LOCAL ? ['admin', 'viewer'].filter(name => existsSync(secretFile(name)))
    .map(name => readFileSync(secretFile(name), 'utf8').trim()).filter(value => value.length >= 8) : [];
const scrub = value => {
    let text = typeof value === 'string' ? value : JSON.stringify(value);
    if (text === undefined) return undefined;
    for (const secret of secrets()) text = text.split(secret).join('<secret>');
    text = text.split(origin.host).join('<host>').split(origin.hostname).join('<host>');
    // Not 10.x: plugin ABI versions (10.11.0.0) look like addresses, and neither host uses that range.
    text = text.replace(/\b(?:127|172\.(?:1[6-9]|2\d|3[01])|192\.168)(?:\.\d{1,3}){2,3}\b/g, '<private-ip>');
    text = text.replace(/\/(?:mnt|home|Users|private)\/[^\s"',)]+/g, '<host-path>');
    return typeof value === 'string' ? text : JSON.parse(text);
};
const results = [];
const record = (check, verdict, detail) => {
    const normalised = verdict === true ? 'PASS' : verdict === false ? 'FAIL' : verdict;
    const clean = detail === undefined ? undefined : scrub(detail);
    results.push({ check, verdict: normalised, detail: clean });
    console.log(`${normalised} [${tier}] ${step}: ${check}${clean === undefined ? '' : ' :: ' + JSON.stringify(clean).slice(0, 700)}`);
};
const notVerified = (check, error) => record(check, 'NOT VERIFIED', String(error?.message ?? error).split('\n')[0]);
const save = browserVersion => {
    const file = process.env.JELLYFINMOD_Q16_OUT;
    if (!file) return;
    const all = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { runs: [] };
    all.runs.push({ step, browser: tier, version: browserVersion, expect: process.env.JELLYFINMOD_Q16_EXPECT, build: process.env.JELLYFINMOD_Q16_BUILD,
        at: new Date().toISOString(), results: results.splice(0) });
    writeFileSync(file, JSON.stringify(all, null, 1) + '\n');
};
async function until(check, { timeout = 60000, every = 1000, label = 'condition' } = {}) {
    const deadline = Date.now() + timeout;
    let last;
    while (Date.now() < deadline) {
        last = await check();
        if (last) return last;
        await new Promise(resolve => setTimeout(resolve, every));
    }
    throw new Error(`timed out after ${timeout / 1000}s waiting for ${label}`);
}
const onHost = command => execFileSync('ssh', [required('JELLYFINMOD_Q16_SSH'), 'bash', '-s'], { input: command, encoding: 'utf8' }).trim();
const traktControl = (path, body) => JSON.parse(onHost(body === undefined
    ? `curl -s 'http://127.0.0.1:${required('JELLYFINMOD_Q16_TRAKT_CONTROL')}${path}'`
    : `curl -s -X POST 'http://127.0.0.1:${required('JELLYFINMOD_Q16_TRAKT_CONTROL')}${path}' -d '${JSON.stringify(body)}'`));

// ---- the server API from Node, with a token kept in memory only
const url = path => new URL(path.replace(/^\//, ''), origin).href;
async function http(method, path, { token, body, raw } = {}) {
    const response = await fetch(url(path), {
        method,
        headers: { Authorization: token ? `${AUTH}, Token="${token}"` : AUTH, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    let parsed = text;
    if (!raw) try { parsed = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    return { status: response.status, body: parsed };
}
const password = name => acceptance ? '' : readFileSync(secretFile(name), 'utf8').trim();
async function signInApi(user, name) {
    const response = await http('POST', '/Users/AuthenticateByName', { body: { Username: user, Pw: password(name) } });
    if (response.status !== 200) throw new Error(`sign-in as ${name} answered ${response.status}`);
    return { token: response.body.AccessToken, userId: response.body.User.Id, serverId: response.body.ServerId };
}
const idsFile = () => join(LOCAL, 'ids.json');
const ids = () => JSON.parse(readFileSync(idsFile(), 'utf8'));
const restart = async () => {
    onHost(`docker restart ${required('JELLYFINMOD_Q16_CONTAINER')} >/dev/null`);
    await until(async () => (await fetch(url('/health')).then(r => r.text()).catch(() => '')) === 'Healthy', { timeout: 180000, every: 3000, label: 'Healthy after restart' });
    await until(async () => (await http('GET', '/System/Info/Public').catch(() => ({}))).status === 200, { timeout: 60000, label: 'the API after restart' });
};

// ---- the browser
let browser;
async function newPage(layoutName) {
    const layout = LAYOUTS[layoutName];
    const context = await browser.newContext({ viewport: layout.viewport, isMobile: layout.isMobile, hasTouch: layout.hasTouch,
        userAgent: layout.userAgent, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.q16 = { errors: [], failed: [], trakt: [] };
    page.on('pageerror', error => page.q16.errors.push(String(error.message).split('\n')[0]));
    page.on('requestfailed', request => {
        if (request.url().includes('/JellyfinMod/')) page.q16.failed.push({ url: new URL(request.url()).pathname, error: request.failure()?.errorText });
    });
    page.q16.benign = [];
    page.on('response', response => {
        const path = new URL(response.url()).pathname;
        // An ordinary user's shell asks for the Queue and is told 403 queue_admin_only by design (useQueue.ts); named, not failed.
        if (path.endsWith('/JellyfinMod/Queue') && response.status() === 403) page.q16.benign.push({ url: path, status: 403 });
        else if (path.includes('/JellyfinMod/') && response.status() >= 400) page.q16.failed.push({ url: path, status: response.status() });
        if (path.includes('/JellyfinMod/Trakt/Items/')) page.q16.trakt.push({ id: path.split('/').pop(), status: response.status() });
    });
    return { context, page };
}
async function signInPage(page, name, userName) {
    await page.goto(url('/web/'), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.ApiClient, undefined, { timeout: 30000 });
    await page.waitForFunction(() => {
        try { return !!ApiClient.getCurrentUserId() || /login|selectuser|selectserver/.test(location.hash); } catch { return false; }
    }, undefined, { timeout: 30000 });
    if (!await page.evaluate(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } })) {
        const field = page.locator('#txtManualName');
        if (!await field.isVisible().catch(() => false)) {
            const chooser = page.locator('.btnManual').first();
            await chooser.waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
            if (await chooser.count()) await chooser.evaluate(node => node.click());
            await field.waitFor({ state: 'visible', timeout: 15000 });
        }
        await page.waitForTimeout(1000);
        await field.fill(userName);
        await page.locator('#txtManualPassword').fill(password(name));
        await page.locator('button:visible').filter({ hasText: 'Sign In' }).first().click();
        await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } }, undefined, { timeout: 30000 });
    }
    await page.waitForFunction(() => location.hash.startsWith('#/home'), undefined, { timeout: 30000 });
    await page.waitForTimeout(1500);
}
async function setTv(page) {
    await page.evaluate(() => localStorage.setItem('layout', 'tv'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } }, undefined, { timeout: 30000 });
    await page.waitForFunction(() => document.documentElement.classList.contains('layout-tv'), undefined, { timeout: 15000 });
    await page.waitForTimeout(2000);
}
const describeFocus = page => page.evaluate(() => {
    const node = document.activeElement;
    if (!node || node === document.body) return 'body';
    const text = (node.getAttribute('title') || node.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30);
    return [node.tagName.toLowerCase(), [...node.classList].filter(name => !/focus|hover|ripple/i.test(name)).slice(0, 3).join('.'),
        node.getAttribute('data-action') ?? '', text, node.closest('.jfmod-traktIndicator') ? 'IN-INDICATOR' : ''].join('|');
});
/** Opens a detail page and waits for upstream's render and, when the plugin can answer, JellyfinMod's Trakt answer. */
async function openDetail(page, itemId, serverId, { expectRequest }) {
    const before = page.q16.trakt.length;
    await page.evaluate(({ itemId, serverId }) => { location.hash = `#/details?id=${itemId}&serverId=${serverId}`; }, { itemId, serverId });
    await page.waitForFunction(id => {
        const view = [...document.querySelectorAll('.itemDetailPage')].find(node => !node.classList.contains('hide') && node.offsetParent !== null);
        return !!view && location.hash.includes(id) && !!view.querySelector('.nameContainer')?.textContent?.trim();
    }, itemId, { timeout: 30000 });
    if (expectRequest) {
        await until(() => page.q16.trakt.slice(before).some(entry => entry.id.replace(/-/g, '') === itemId.replace(/-/g, '')),
            { timeout: 15000, every: 200, label: 'the Trakt answer' });
    }
    // Upstream's images load late and move what follows them; measure once they have.
    await page.waitForFunction(() => [...document.images].every(image => image.complete), undefined, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(800);
    return page.evaluate(() => {
        const view = [...document.querySelectorAll('.itemDetailPage')].find(node => !node.classList.contains('hide') && node.offsetParent !== null);
        const indicator = view?.querySelector('.jfmod-traktIndicator');
        const mount = view?.querySelector('.jfmod-traktMount');
        const rect = indicator?.getBoundingClientRect();
        const top = selector => { const node = view?.querySelector(selector); return node && node.offsetParent !== null ? Math.round(node.getBoundingClientRect().top + window.scrollY) : null; };
        const root = parseFloat(getComputedStyle(document.documentElement).fontSize);
        return {
            indicator: !!indicator && indicator.offsetParent !== null,
            text: indicator?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
            title: indicator?.getAttribute('title') ?? null,
            focusable: indicator ? [indicator, ...indicator.querySelectorAll('*')].some(node => node.tabIndex >= 0 || /^(A|BUTTON|INPUT|SELECT)$/.test(node.tagName)) : false,
            insideViewportWidth: rect ? rect.left >= 0 && rect.right <= window.innerWidth + 0.5 : null,
            fontEm: indicator ? Math.round(parseFloat(getComputedStyle(indicator).fontSize) / root * 100) / 100 : null,
            mount: mount ? { children: mount.childElementCount, height: Math.round(mount.getBoundingClientRect().height), firstInSection: mount.parentElement?.firstElementChild === mount } : null,
            horizontalOverflow: document.scrollingElement.scrollWidth > window.innerWidth + 1,
            geometry: { buttons: top('.mainDetailButtons'), genres: top('.itemGenres'), overview: top('.overview'), childrenSection: top('.childrenItemsContainer, #childrenContent') },
            layout: document.documentElement.classList.contains('layout-tv') ? 'tv' : document.documentElement.classList.contains('layout-mobile') ? 'mobile' : 'desktop'
        };
    });
}
async function dpadWalk(page) {
    const walk = [await describeFocus(page)];
    for (const key of ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowRight', 'ArrowDown', 'ArrowDown', 'ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowUp']) {
        await page.keyboard.press(key);
        await page.waitForTimeout(350);
        walk.push(`${key}>${await describeFocus(page)}`);
    }
    return walk;
}
const shot = async (page, name) => { if (shots) await page.screenshot({ path: join(shots, `${tier}-${name}.png`) }); };

// ---- steps
async function setup() {
    mkdirSync(LOCAL, { recursive: true, mode: 0o700 });
    for (const name of ['admin', 'viewer']) writeFileSync(secretFile(name), randomBytes(18).toString('base64url') + '\n', { mode: 0o600 });
    const info = await http('GET', '/System/Info/Public');
    record('A fresh server has not run its first-run wizard', info.body?.StartupWizardCompleted === false, { version: info.body?.Version });
    await http('POST', '/Startup/Configuration', { body: { UICulture: 'en-US', MetadataCountryCode: 'US', PreferredMetadataLanguage: 'en' } });
    await http('GET', '/Startup/User');
    const created = await http('POST', '/Startup/User', { body: { Name: ADMIN, Password: password('admin') } });
    await http('POST', '/Startup/RemoteAccess', { body: { EnableRemoteAccess: true, EnableAutomaticPortMapping: false } });
    const completed = await http('POST', '/Startup/Complete');
    record('The first-run wizard completes with a throwaway administrator', [created.status, completed.status].every(status => status < 300),
        { user: created.status, complete: completed.status });
    const admin = await signInApi(ADMIN, 'admin');
    for (const [name, collectionType, path] of [['Movies', 'movies', '/data/media/movies'], ['Shows', 'tvshows', '/data/media/tv']]) {
        const response = await http('POST', `/Library/VirtualFolders?name=${name}&collectionType=${collectionType}&refreshLibrary=false`,
            { token: admin.token, body: { LibraryOptions: { PathInfos: [{ Path: path }] } } });
        record(`Library ${name} on the fixture folder`, response.status === 204, { status: response.status });
    }
    const viewer = await http('POST', '/Users/New', { token: admin.token, body: { Name: VIEWER, Password: password('viewer') } });
    record('A second, ordinary user exists', viewer.status === 200 && viewer.body?.Policy?.IsAdministrator === false, { status: viewer.status });
    await http('POST', '/Library/Refresh', { token: admin.token });
    const items = await until(async () => {
        const response = await http('GET', `/Items?userId=${admin.userId}&Recursive=true&IncludeItemTypes=Movie,Series,Season,Episode&Fields=ProviderIds,Path&SearchTerm=`, { token: admin.token });
        const list = response.body?.Items ?? [];
        const count = type => list.filter(item => item.Type === type).length;
        return count('Movie') === 2 && count('Series') === 1 && count('Season') === 2 && count('Episode') === 3 ? list : null;
    }, { timeout: 180000, every: 3000, label: 'two movies, one series, two seasons and three episodes' });
    const find = predicate => items.find(predicate);
    const movie = find(item => item.Type === 'Movie' && item.Name.includes('Trakt Movie'));
    const unwatched = find(item => item.Type === 'Movie' && item.Name.includes('Unwatched'));
    const series = find(item => item.Type === 'Series');
    const season1 = find(item => item.Type === 'Season' && item.IndexNumber === 1);
    const season2 = find(item => item.Type === 'Season' && item.IndexNumber === 2);
    const episode = find(item => item.Type === 'Episode' && item.ParentIndexNumber === 1 && item.IndexNumber === 1);
    const episode2 = find(item => item.Type === 'Episode' && item.ParentIndexNumber === 1 && item.IndexNumber === 2);
    const episode3 = find(item => item.Type === 'Episode' && item.ParentIndexNumber === 2 && item.IndexNumber === 1);
    record('The fixtures carry the ids the Trakt stand-in reports', movie?.ProviderIds?.Tmdb === '990101' && series?.ProviderIds?.Tvdb === '990102' &&
        unwatched?.ProviderIds?.Tmdb === '990103' && !!episode && !!episode2 && !!episode3 && !!season1 && !!season2,
    { movie: movie?.ProviderIds, unwatched: unwatched?.ProviderIds, series: series?.ProviderIds });
    writeFileSync(idsFile(), JSON.stringify({
        serverId: admin.serverId, adminId: admin.userId, movie: movie.Id, unwatched: unwatched.Id, series: series.Id, season1: season1.Id,
        season2: season2.Id, episode: episode.Id, episode2: episode2.Id, episode3: episode3.Id
    }, null, 1), { mode: 0o600 });
    await http('POST', '/Sessions/Logout', { token: admin.token });
}

async function dashboardPlugin(page) {
    await page.evaluate(() => { location.hash = '#/dashboard/plugins'; });
    const compact = TRAKT_ID.replace(/-/g, '');
    // The catalog's search box, then the Trakt card (an image link to the plugin's page).
    const search = page.getByRole('textbox', { name: 'Search' }).or(page.locator('input[type="search"], input[placeholder*="Search"]')).first();
    await search.waitFor({ state: 'visible', timeout: 60000 });
    // The page opens on "Installed"; "All" lists the catalog too, installed or not.
    await page.locator('.MuiChip-root').filter({ hasText: /^All$/ }).first().click();
    await search.fill('Trakt');
    const card = page.locator(`a[href*="${compact}"]`).first();
    await card.waitFor({ state: 'visible', timeout: 60000 });
    await card.click();
    await page.waitForFunction(id => location.hash.replace(/-/g, '').includes(id), compact, { timeout: 30000 });
    await page.waitForTimeout(2000);
}

async function install() {
    const admin = await signInApi(ADMIN, 'admin');
    const before = await http('GET', '/Plugins', { token: admin.token });
    record('Trakt is not installed before the run', !before.body.some(plugin => plugin.Id.replace(/-/g, '') === TRAKT_ID.replace(/-/g, '')));
    const packages = await http('GET', '/Packages', { token: admin.token });
    const trakt = packages.body.find(entry => entry.name === 'Trakt');
    record('The server\'s catalog offers Trakt 31.0.0.0 for this server', !!trakt?.versions?.some(version => version.version === '31.0.0.0'),
        { guid: trakt?.guid, versions: trakt?.versions?.slice(0, 3).map(version => ({ version: version.version, targetAbi: version.targetAbi, repository: version.repositoryName })) });
    const { context, page } = await newPage('desktop');
    try {
        await signInPage(page, 'admin', ADMIN);
        await dashboardPlugin(page);
        await shot(page, 'dashboard-trakt-before-install');
        const installButton = page.getByRole('button', { name: 'Install', exact: true });
        await installButton.waitFor({ state: 'visible', timeout: 30000 });
        await installButton.click();
        const confirm = page.getByRole('dialog').getByRole('button', { name: /Install|OK|Confirm/ });
        if (await confirm.isVisible({ timeout: 3000 }).catch(() => false)) await confirm.click();
        const installed = await until(async () => {
            const list = await http('GET', '/Plugins', { token: admin.token });
            return list.body.find(plugin => plugin.Id.replace(/-/g, '') === TRAKT_ID.replace(/-/g, ''));
        }, { timeout: 120000, every: 2000, label: 'Trakt in /Plugins after Install' });
        record('Dashboard → Plugins → Trakt → Install puts it on the server', !!installed, { version: installed.Version, status: installed.Status });
        await shot(page, 'dashboard-trakt-installed');
    } finally {
        await context.close();
    }
    await restart();
    const again = await signInApi(ADMIN, 'admin');
    const plugins = await http('GET', '/Plugins', { token: again.token });
    const copy = plugins.body.find(plugin => plugin.Name === 'Trakt');
    record('After a restart the installed copy reports id 4fe3201e-d6ae-4f2e-8917-e12bda571281, 31.0.0.0, Active',
        copy?.Id?.replace(/-/g, '') === TRAKT_ID.replace(/-/g, '') && copy?.Version === '31.0.0.0' && copy?.Status === 'Active',
        { id: copy?.Id, version: copy?.Version, status: copy?.Status });
    const health = await http('GET', '/JellyfinMod/Health', { token: again.token });
    record('JellyfinMod Health reports Trakt installed with its version and lists trakt.history',
        health.body?.Trakt?.Installed === true && health.body?.Trakt?.Version === '31.0.0.0' && health.body?.Capabilities?.includes('trakt.history'),
        { trakt: health.body?.Trakt, bundle: health.body?.Web?.BundleId, plugin: health.body?.Version });
    await http('POST', '/Sessions/Logout', { token: again.token });
}

async function authorize() {
    const admin = await signInApi(ADMIN, 'admin');
    const started = await http('POST', `/Trakt/Users/${admin.userId}/Authorize`, { token: admin.token });
    record('The Trakt plugin starts device authorization and returns a user code', started.status === 200 && typeof started.body?.userCode === 'string');
    const approved = traktControl('/approve', {});
    record('The code is approved on the stand-in, as a user entering it on trakt.tv would', approved.approved === true);
    const status = await until(async () => {
        const poll = await http('GET', `/Trakt/Users/${admin.userId}/PollAuthorizationStatus`, { token: admin.token });
        return poll.body?.isAuthorized === true ? poll : null;
    }, { timeout: 60000, every: 2000, label: 'isAuthorized' });
    record('The Trakt plugin reports the administrator authorized', status.body.isAuthorized === true);
    const state = traktControl('/state');
    // From the plugin's first call on (a probe of the TLS terminator before it carries no headers).
    state.requests = state.requests.slice(Math.max(0, state.requests.findIndex(request => request.route === '/oauth/device/code')));
    record('The stand-in issued one token through the device flow; every call carried the plugin\'s API key and version',
        state.tokenIssued === true && state.requests.every(request => request.apiHeaders === true) &&
        state.requests.some(request => request.route === '/oauth/device/code' && request.status === 200) &&
        state.requests.some(request => request.route === '/oauth/device/token' && request.status === 200),
        { routes: state.requests.map(request => `${request.method} ${request.route} ${request.status}`) });
    await http('POST', '/Sessions/Logout', { token: admin.token });
}

const traktItem = (token, id) => http('GET', `/JellyfinMod/Trakt/Items/${id}`, { token });
const summary = response => ({ status: response.status, installed: response.body?.installed, hasHistory: response.body?.hasHistory, lastSyncedAt: response.body?.lastSyncedAt ?? null });

async function sync() {
    const known = ids();
    const admin = await signInApi(ADMIN, 'admin');
    const viewer = await signInApi(VIEWER, 'viewer');
    const played = async (session, id) => (await http('GET', `/Users/${session.userId}/Items/${id}`, { token: session.token })).body?.UserData;
    const names = ['movie', 'unwatched', 'series', 'season1', 'season2', 'episode', 'episode2', 'episode3'];
    const beforeData = { movie: await played(admin, known.movie), episode: await played(admin, known.episode) };
    record('Before the sync the administrator has not played the movie or the episode', beforeData.movie?.Played === false && beforeData.episode?.Played === false,
        { movie: beforeData.movie?.Played, episode: beforeData.episode?.Played });
    const before = Object.fromEntries(await Promise.all(names.map(async name => [name, summary(await traktItem(admin.token, known[name]))])));
    record('Before the sync JellyfinMod reports Trakt installed and no history anywhere',
        Object.values(before).every(entry => entry.status === 200 && entry.installed === true && entry.hasHistory === false), before);

    const tasks = await http('GET', '/ScheduledTasks', { token: admin.token });
    const task = tasks.body.find(entry => entry.Key === 'TraktSyncFromTraktTask');
    record('The Trakt plugin\'s import task is registered', !!task, { name: task?.Name });
    const startedAt = new Date();
    await http('POST', `/ScheduledTasks/Running/${task.Id}`, { token: admin.token });
    const finished = await until(async () => {
        const current = await http('GET', `/ScheduledTasks/${task.Id}`, { token: admin.token });
        const result = current.body?.LastExecutionResult;
        return current.body?.State === 'Idle' && result && new Date(result.EndTimeUtc) >= startedAt ? result : null;
    }, { timeout: 180000, every: 2000, label: 'the Trakt import task to finish' });
    record('"Import watched states and playback progress from trakt.tv" completes', finished.Status === 'Completed', { status: finished.Status });

    // Jellyfin's own store, read-only on the host: the API of Jellyfin 12.0.0 keeps serving the user data it had cached
    // before the import until the server restarts (seen in the first Q16 run; upstream, recorded below).
    const stored = dbPlayed([admin.userId, viewer.userId], Object.values(known).filter(value => typeof value === 'string' && value.length === 32));
    const playedIn = (session, name) => stored.some(row => row.user === session.userId.toLowerCase() && row.item === known[name].toLowerCase() && row.played === 1);
    const afterData = Object.fromEntries(['movie', 'unwatched', 'episode', 'episode2', 'episode3'].map(name => [name, playedIn(admin, name)]));
    record('Jellyfin\'s database now has the movie and S01E01 played for the administrator, and nothing else',
        afterData.movie && afterData.episode && !afterData.unwatched && !afterData.episode2 && !afterData.episode3, afterData);
    const viewerData = Object.fromEntries(['movie', 'episode'].map(name => [name, playedIn(viewer, name)]));
    record('The second user\'s data is untouched', !viewerData.movie && !viewerData.episode, viewerData);
    const apiView = Object.fromEntries(await Promise.all(['movie', 'episode'].map(async name => [name, (await played(admin, known[name]))?.Played])));
    record('Jellyfin\'s API view of the same user data before a restart (information: upstream cache)', 'INFO', apiView);

    const after = Object.fromEntries(await Promise.all(names.map(async name => [name, summary(await until(async () => {
        const response = await traktItem(admin.token, known[name]);
        // The listener writes off the event thread; wait for the positive ones, never for a negative.
        return ['movie', 'series', 'season1', 'episode'].includes(name) && response.body?.hasHistory !== true ? null : response;
    }, { timeout: 30000, every: 1000, label: `JellyfinMod's answer for ${name}` }))])));
    record('JellyfinMod reports Trakt history for the movie, S01E01, season 1 and the series',
        ['movie', 'episode', 'season1', 'series'].every(name => after[name].hasHistory === true && !!after[name].lastSyncedAt), after);
    record('…and none for the unwatched movie, S01E02, S02E01 or season 2',
        ['unwatched', 'episode2', 'episode3', 'season2'].every(name => after[name].status === 200 && after[name].hasHistory === false), after);
    const viewerAnswers = Object.fromEntries(await Promise.all(names.map(async name => [name, summary(await traktItem(viewer.token, known[name]))])));
    record('The second user sees no Trakt history on any of them', Object.values(viewerAnswers).every(entry => entry.status === 200 && entry.hasHistory === false), viewerAnswers);
    const anonymous = await http('GET', `/JellyfinMod/Trakt/Items/${known.movie}`);
    record('Anonymous is 401', anonymous.status === 401, { status: anonymous.status });
    const viewerHealth = await http('GET', '/JellyfinMod/Health', { token: viewer.token });
    const adminHealth = await http('GET', '/JellyfinMod/Health', { token: admin.token });
    record('Health tells an ordinary user Trakt is installed but not its version; an administrator sees the version',
        viewerHealth.body?.Trakt?.Installed === true && !('Version' in (viewerHealth.body?.Trakt ?? {})) && adminHealth.body?.Trakt?.Version === '31.0.0.0',
        { viewer: viewerHealth.body?.Trakt, admin: adminHealth.body?.Trakt });
    const unknown = await traktItem(admin.token, '00000000000000000000000000000001');
    record('An unknown item is 404', unknown.status === 404, { status: unknown.status });
    const state = traktControl('/state');
    state.requests = state.requests.slice(Math.max(0, state.requests.findIndex(request => request.route === '/oauth/device/code')));
    const routes = [...new Set(state.requests.map(request => `${request.method} ${request.route} ${request.status}`))];
    record('The sync called the stand-in exactly as SyncFromTraktTask does, authorized, with the plugin\'s headers',
        ['GET /sync/watched/movies 200', 'GET /sync/watched/shows 200', 'GET /sync/history/movies 200', 'GET /sync/history/episodes 200',
            'GET /sync/playback/movies 200', 'GET /sync/playback/episodes 200'].every(route => routes.includes(route)) &&
        state.requests.filter(request => request.route.startsWith('/sync/')).every(request => request.authorized === true && request.apiHeaders === true),
        { routes });
    await http('POST', '/Sessions/Logout', { token: admin.token });
    await http('POST', '/Sessions/Logout', { token: viewer.token });

    // After a restart the API serves what the database holds.
    await restart();
    const again = await signInApi(ADMIN, 'admin');
    const afterRestart = Object.fromEntries(await Promise.all(['movie', 'episode', 'episode2', 'unwatched'].map(async name => [name, (await played(again, known[name]))?.Played])));
    record('After a restart Jellyfin\'s API reports the movie and S01E01 played, nothing else, and JellyfinMod\'s answers are unchanged',
        afterRestart.movie === true && afterRestart.episode === true && !afterRestart.episode2 && !afterRestart.unwatched &&
        (await traktItem(again.token, known.series)).body?.hasHistory === true, afterRestart);
    await http('POST', '/Sessions/Logout', { token: again.token });
}

/** Reads Played from Jellyfin's UserData table on the host, read-only. Returns ids and flags only. */
function dbPlayed(users, items) {
    const database = `${required('JELLYFINMOD_Q16_HOST_ROOT')}/config/data/jellyfin.db`;
    const output = onHost(`python3 - <<'PY'
import sqlite3, json
c = sqlite3.connect('file:${database}?mode=ro', uri=True)
users = ${JSON.stringify(users.map(value => value.toLowerCase()))}
items = ${JSON.stringify(items.map(value => value.toLowerCase()))}
rows = [dict(user=u.lower().replace('-', ''), item=i.lower().replace('-', ''), played=p) for u, i, p in c.execute('select UserId, ItemId, Played from UserData')]
print(json.dumps([r for r in rows if r['user'] in users and r['item'] in items]))
PY`);
    return JSON.parse(output);
}

/** Runs the Trakt plugin's import task and waits for it to finish; returns its result. */
async function runTraktSync(token) {
    const tasks = await http('GET', '/ScheduledTasks', { token });
    const task = tasks.body.find(entry => entry.Key === 'TraktSyncFromTraktTask');
    const startedAt = new Date();
    await http('POST', `/ScheduledTasks/Running/${task.Id}`, { token });
    return until(async () => {
        const current = await http('GET', `/ScheduledTasks/${task.Id}`, { token });
        const result = current.body?.LastExecutionResult;
        return current.body?.State === 'Idle' && result && new Date(result.EndTimeUtc) >= startedAt ? result : null;
    }, { timeout: 180000, every: 2000, label: 'the Trakt import task to finish' });
}

async function nfo() {
    const known = ids();
    const admin = await signInApi(ADMIN, 'admin');
    const before = Object.fromEntries(await Promise.all(['movie', 'unwatched'].map(async name => [name, summary(await traktItem(admin.token, known[name]))])));
    record('Before: JellyfinMod has Trakt history for the Trakt movie and none for the other', before.movie.hasHistory === true && before.unwatched.hasHistory === false, before);
    // Dashboard → Libraries → NFO settings → "User for watch data" is this named configuration's UserId.
    const configuration = await http('GET', '/System/Configuration/xbmcmetadata', { token: admin.token });
    const saved = await http('POST', '/System/Configuration/xbmcmetadata', { token: admin.token, body: { ...configuration.body, UserId: known.adminId } });
    record('Jellyfin\'s NFO user for watch data is the administrator', saved.status === 204 &&
        (await http('GET', '/System/Configuration/xbmcmetadata', { token: admin.token })).body?.UserId?.replace(/-/g, '') === known.adminId.replace(/-/g, ''),
    { status: saved.status });
    const root = required('JELLYFINMOD_Q16_HOST_ROOT');
    onHost(`set -e
M='${root}/data/media/movies'
cat > "$M/JellyfinMod Trakt Unwatched (2026) [tmdbid-990103]/JellyfinMod Trakt Unwatched (2026).nfo" <<'NFO'
<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<movie><title>JellyfinMod Trakt Unwatched</title><year>2026</year><uniqueid type="tmdb" default="true">990103</uniqueid><watched>true</watched><playcount>1</playcount><lastplayed>2026-09-01 12:00:00</lastplayed></movie>
NFO
cat > "$M/JellyfinMod Trakt Movie (2026) [tmdbid-990101]/JellyfinMod Trakt Movie (2026).nfo" <<'NFO'
<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<movie><title>JellyfinMod Trakt Movie</title><year>2026</year><uniqueid type="tmdb" default="true">990101</uniqueid><watched>false</watched></movie>
NFO`);
    const tasks = await http('GET', '/ScheduledTasks', { token: admin.token });
    const traktTask = tasks.body.find(entry => entry.Key === 'TraktSyncFromTraktTask');
    record('The Trakt import task is idle while the NFO files are read', traktTask?.State === 'Idle', { state: traktTask?.State });
    await http('POST', '/Library/Refresh', { token: admin.token });
    for (const name of ['unwatched', 'movie']) {
        await http('POST', `/Items/${known[name]}/Refresh?metadataRefreshMode=FullRefresh&imageRefreshMode=None&replaceAllMetadata=false`, { token: admin.token });
    }
    const imported = await until(() => {
        const rows = dbPlayed([known.adminId], [known.movie, known.unwatched]);
        const played = id => rows.find(row => row.item === id.toLowerCase().replace(/-/g, ''))?.played;
        return played(known.unwatched) === 1 && played(known.movie) === 0 ? { unwatched: 1, movie: 0 } : null;
    }, { timeout: 120000, every: 3000, label: 'Jellyfin to import the NFO watch state' });
    record('Jellyfin imported the NFO watch state (Import): the other movie played, the Trakt movie unplayed', !!imported, imported);
    // The listener would have written within a second of the save; give it five, then look.
    await new Promise(resolve => setTimeout(resolve, 5000));
    const after = Object.fromEntries(await Promise.all(['movie', 'unwatched'].map(async name => [name, summary(await traktItem(admin.token, known[name]))])));
    record('The NFO import records nothing: no Trakt history for the NFO-played movie', after.unwatched.hasHistory === false, after);
    record('…and deletes nothing: the Trakt movie keeps its Trakt history, from the same time', after.movie.hasHistory === true &&
        after.movie.lastSyncedAt === before.movie.lastSyncedAt, after);
    const result = await runTraktSync(admin.token);
    const resynced = await until(async () => {
        const answer = summary(await traktItem(admin.token, known.movie));
        return answer.hasHistory && answer.lastSyncedAt !== before.movie.lastSyncedAt ? answer : null;
    }, { timeout: 30000, label: 'the Trakt movie to be recorded again' });
    const rows = dbPlayed([known.adminId], [known.movie]);
    record('A real Trakt sync afterwards still records: it marks the Trakt movie played again and JellyfinMod records that import',
        result.Status === 'Completed' && rows.some(row => row.played === 1) && !!resynced.lastSyncedAt, { task: result.Status, movie: resynced });
    record('The NFO-played movie stays without Trakt history after the sync', (await traktItem(admin.token, known.unwatched)).body?.hasHistory === false);
    await http('POST', '/Sessions/Logout', { token: admin.token });
}

async function browserPass() {
    const expectPresent = process.env.JELLYFINMOD_Q16_EXPECT !== 'absent';
    const known = ids();
    const positive = ['movie', 'episode', 'season1', 'series'];
    const negative = ['unwatched', 'episode2', 'season2'];
    const walksFile = join(LOCAL, `dpad-${tier}.json`);
    const walks = existsSync(walksFile) ? JSON.parse(readFileSync(walksFile, 'utf8')) : {};
    for (const layoutName of layouts) {
        for (const [who, userName] of [['admin', ADMIN], ['viewer', VIEWER]]) {
            const { context, page } = await newPage(layoutName);
            try {
                await signInPage(page, who, userName);
                if (LAYOUTS[layoutName].tv) await setTv(page);
                for (const name of [...positive, ...negative]) {
                    const label = `${layoutName} ${who} ${name}`;
                    try {
                        const before = page.q16.trakt.length;
                        const view = await openDetail(page, known[name], known.serverId, { expectRequest: expectPresent });
                        if (!expectPresent) {
                            record(`${label}: without the Trakt plugin the page asks JellyfinMod nothing about Trakt`, page.q16.trakt.length === before,
                                { requests: page.q16.trakt.slice(before).length });
                        }
                        const shouldShow = expectPresent && who === 'admin' && positive.includes(name);
                        const layoutOk = view.layout === (LAYOUTS[layoutName].tv ? 'tv' : layoutName === 'mobile' ? 'mobile' : 'desktop');
                        if (shouldShow) {
                            record(`${label}: the indicator shows, says Trakt and when, is not focusable and fits`,
                                layoutOk && view.indicator && /^Trakt Watch history synced · /.test(view.text) && /^Watch history synced from Trakt · /.test(view.title) &&
                                !view.focusable && view.insideViewportWidth && !view.horizontalOverflow && view.mount?.firstInSection === true, view);
                            if (name === 'movie' || name === 'series') await shot(page, `${layoutName}-${who}-${name}`);
                        } else {
                            record(`${label}: no indicator, the empty mount takes no space`,
                                layoutOk && !view.indicator && view.mount?.children === 0 && view.mount?.height === 0 && !view.horizontalOverflow, view);
                        }
                        if (LAYOUTS[layoutName].tv && who === 'admin' && name === 'movie') {
                            const walk = await dpadWalk(page);
                            record(`${label}: the D-pad never lands on the indicator`, walk.every(entry => !entry.includes('IN-INDICATOR')), { walk });
                            const key = `${layoutName}-movie`;
                            if (expectPresent) walks[key] = walk;
                            else if (walks[key]) record(`${label}: the D-pad walk equals the walk with the indicator shown`, JSON.stringify(walks[key]) === JSON.stringify(walk), { with: walks[key], without: walk });
                        }
                    } catch (error) {
                        notVerified(label, error);
                    }
                }
                record(`${layoutName} ${who}: no failed JellyfinMod request and no page error`, page.q16.failed.length === 0 && page.q16.errors.length === 0,
                    { failed: page.q16.failed, errors: page.q16.errors, traktRequests: page.q16.trakt.length, benignRequests: page.q16.benign });
                await page.evaluate(() => ApiClient.logout()).catch(() => {});
            } catch (error) {
                notVerified(`${layoutName} ${who}`, error);
            } finally {
                await context.close();
            }
        }
    }
    writeFileSync(walksFile, JSON.stringify(walks, null, 1), { mode: 0o600 });
    const admin = await signInApi(ADMIN, 'admin');
    const answers = Object.fromEntries(await Promise.all([...positive, ...negative].map(async name => [name, summary(await traktItem(admin.token, known[name]))])));
    const health = await http('GET', '/JellyfinMod/Health', { token: admin.token });
    record(`The API agrees: installed ${expectPresent} and history only where shown`, Object.values(answers).every(entry => entry.status === 200 &&
        entry.installed === expectPresent && (expectPresent || entry.hasHistory === false)) && health.body?.Trakt?.Installed === expectPresent,
    { answers, trakt: health.body?.Trakt });
    await http('POST', '/Sessions/Logout', { token: admin.token });
}

async function disable() {
    const admin = await signInApi(ADMIN, 'admin');
    const { context, page } = await newPage('desktop');
    try {
        await signInPage(page, 'admin', ADMIN);
        await dashboardPlugin(page);
        const toggle = page.getByLabel('Enable plugin');
        await toggle.waitFor({ state: 'visible', timeout: 30000 });
        // Idempotent: after a disable the page shows the switch still on but greyed out, status "Restart" (upstream), so
        // a re-run finds it disabled and does not click it again.
        const wasActive = await toggle.isChecked() && await toggle.isEnabled();
        record('The Dashboard shows the Trakt switch', true, { activeBefore: wasActive });
        if (wasActive) await toggle.click();
        // Jellyfin 12.0.0 answers a disable with "Restart" until the server restarts, then "Disabled"; neither is Active.
        const status = await until(async () => {
            const copy = (await http('GET', '/Plugins', { token: admin.token })).body.find(plugin => plugin.Name === 'Trakt');
            return ['Disabled', 'Restart'].includes(copy?.Status) ? copy : null;
        }, { timeout: 30000, label: 'Trakt no longer Active' });
        record('Dashboard → Plugins → Trakt → Enable plugin off: the plugin is no longer Active', true, { status: status.Status });
        const health = await http('GET', '/JellyfinMod/Health', { token: admin.token });
        record('Health reports Trakt not installed at once, without a restart', health.body?.Trakt?.Installed === false, { trakt: health.body?.Trakt });
        await shot(page, 'dashboard-trakt-disabled');
        record('No page error in the Dashboard', page.q16.errors.length === 0, { errors: page.q16.errors });
    } finally {
        await context.close();
    }
    await http('POST', '/Sessions/Logout', { token: admin.token });
    await restart();
    const again = await signInApi(ADMIN, 'admin');
    const copy = (await http('GET', '/Plugins', { token: again.token })).body.find(plugin => plugin.Name === 'Trakt');
    const health = await http('GET', '/JellyfinMod/Health', { token: again.token });
    record('After a restart the plugin reports Disabled and Health reports it not installed',
        copy?.Status === 'Disabled' && health.body?.Trakt?.Installed === false, { status: copy?.Status, trakt: health.body?.Trakt });
    await http('POST', '/Sessions/Logout', { token: again.token });
}

async function uninstall() {
    const admin = await signInApi(ADMIN, 'admin');
    const { context, page } = await newPage('desktop');
    try {
        await signInPage(page, 'admin', ADMIN);
        await dashboardPlugin(page);
        await page.getByRole('button', { name: 'Uninstall', exact: true }).click();
        const confirm = page.getByRole('dialog').getByRole('button', { name: /Uninstall|OK|Confirm/ });
        await confirm.waitFor({ state: 'visible', timeout: 15000 });
        await confirm.click();
        await page.waitForTimeout(3000);
        record('No page error in the Dashboard', page.q16.errors.length === 0, { errors: page.q16.errors });
    } finally {
        await context.close();
    }
    await http('POST', '/Sessions/Logout', { token: admin.token });
    await restart();
    const again = await signInApi(ADMIN, 'admin');
    const plugins = await http('GET', '/Plugins', { token: again.token });
    const copy = plugins.body.find(plugin => plugin.Id.replace(/-/g, '') === TRAKT_ID.replace(/-/g, ''));
    record('After Uninstall and a restart the server has no Trakt plugin', !copy, { remaining: copy ? { version: copy.Version, status: copy.Status } : null });
    const health = await http('GET', '/JellyfinMod/Health', { token: again.token });
    record('Health reports Trakt absent', health.body?.Trakt?.Installed === false, { trakt: health.body?.Trakt });
    await http('POST', '/Sessions/Logout', { token: again.token });
}

async function degrade() {
    const build = required('JELLYFINMOD_Q16_BUILD');
    const baselineFile = required('JELLYFINMOD_Q16_BASELINE');
    const session = await signInApi('oleksii', 'oleksii');
    const first = async query => (await http('GET', `/Items?userId=${session.userId}&Recursive=true&Limit=1&SortBy=SortName&${query}`, { token: session.token })).body?.Items?.[0];
    const movie = await first('IncludeItemTypes=Movie&HasTmdbId=true');
    const episode = await first('IncludeItemTypes=Episode&IsMissing=false');
    const targets = { movie: movie.Id, episode: episode.Id, season: episode.SeasonId, series: episode.SeriesId };
    const health = await http('GET', '/JellyfinMod/Health', { token: session.token });
    record(`28096 runs the ${build} build`, health.status === 200 && (build === 'q16'
        ? health.body?.Capabilities?.includes('trakt.history') && health.body?.Trakt?.Installed === false
        : !health.body?.Capabilities?.includes('trakt.history')), { bundle: health.body?.Web?.BundleId, takeover: health.body?.Web?.Takeover?.Status, trakt: health.body?.Trakt ?? null });
    const plugins = await http('GET', '/Plugins', { token: session.token });
    record('28096 has no Trakt plugin', !plugins.body.some(plugin => plugin.Name === 'Trakt'));
    await http('POST', '/Sessions/Logout', { token: session.token });
    const baseline = existsSync(baselineFile) ? JSON.parse(readFileSync(baselineFile, 'utf8')) : {};
    const current = {};
    for (const layoutName of layouts) {
        const { context, page } = await newPage(layoutName);
        try {
            await signInPage(page, 'oleksii', 'oleksii');
            if (LAYOUTS[layoutName].tv) await setTv(page);
            const serverId = await page.evaluate(() => ApiClient.serverId());
            for (const [name, id] of Object.entries(targets)) {
                const label = `${layoutName} ${name}`;
                try {
                    const view = await openDetail(page, id, serverId, { expectRequest: false });
                    const answered = page.q16.trakt.filter(entry => entry.id.replace(/-/g, '') === id.replace(/-/g, ''));
                    record(`${label}: no indicator${build === 'q16' ? ', no Trakt request, and the empty mount takes no space' : ''}`,
                        !view.indicator && answered.length === 0 && (build === 'released' ? !view.mount
                            : view.mount?.children === 0 && view.mount?.height === 0),
                        { mount: view.mount, answered });
                    // Where the lazy rows below the overview end varies between two loads of the same released page
                    // (Next Up, Seasons); the header, genres and overview do not, so those are what is compared.
                    const { childrenSection, ...stable } = view.geometry;
                    const entry = { geometry: stable };
                    if (LAYOUTS[layoutName].tv && name === 'movie') entry.walk = await dpadWalk(page);
                    current[label] = entry;
                    if (build === 'q16' && baseline[label]) {
                        delete baseline[label].geometry.childrenSection;
                        record(`${label}: page geometry${entry.walk ? ' and D-pad walk' : ''} equal the released build`,
                            JSON.stringify(baseline[label]) === JSON.stringify(entry), { released: baseline[label], q16: entry });
                    }
                } catch (error) {
                    notVerified(label, error);
                }
            }
            record(`${layoutName}: no failed JellyfinMod request and no page error`, page.q16.failed.length === 0 && page.q16.errors.length === 0,
                { failed: page.q16.failed, errors: page.q16.errors });
            await page.evaluate(() => ApiClient.logout()).catch(() => {});
        } catch (error) {
            notVerified(layoutName, error);
        } finally {
            await context.close();
        }
    }
    if (build === 'released') writeFileSync(baselineFile, JSON.stringify(current, null, 1));
}

const needsBrowser = ['install', 'browser', 'disable', 'uninstall', 'degrade'].includes(step);
if (needsBrowser) browser = await chromium.launch(tier === 'chrome' ? { headless: true, channel: 'chrome' } : { headless: true });
console.log('q16', step, needsBrowser ? `${tier} ${browser.version()}` : 'api');
try {
    const run = { setup, install, authorize, sync, nfo, browser: browserPass, disable, uninstall, degrade }[step];
    if (!run) throw new Error(`unknown step ${step}`);
    await run();
} catch (error) {
    notVerified(`step ${step}`, error);
} finally {
    const version = browser?.version();
    await browser?.close();
    const counts = results.reduce((all, entry) => ({ ...all, [entry.verdict]: (all[entry.verdict] ?? 0) + 1 }), {});
    save(version);
    console.log(`${counts.PASS ?? 0} of ${Object.values(counts).reduce((a, b) => a + b, 0)} passed`, JSON.stringify(counts));
    process.exitCode = Object.keys(counts).some(verdict => !['PASS', 'INFO'].includes(verdict)) ? 1 : 0;
}
