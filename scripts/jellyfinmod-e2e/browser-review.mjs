/* eslint-disable compat/compat -- a Node runner; the browserslist targets TV clients, not this script */
/* global document, window, localStorage, navigator, indexedDB, HTMLElement, ApiClient */
// JellyfinMod browser acceptance. Runs against the built app and the real isolated server; no synthetic API responses.
// Node 22+ is required. The browser itself comes from one of three places, chosen by environment variables:
//   - JELLYFINMOD_CDP_URL set: attach to an already-running, already-signed-in Chrome over CDP. Opt-in only, for
//     watching a run; this is the one mode that can steal OS focus, because it drives someone's visible window.
//   - JELLYFINMOD_BROWSER=chrome: launch the machine's own installed Google Chrome, headless, in a dedicated
//     profile. This is the acceptance tier: only a result from real Chrome counts as acceptance evidence, both
//     because it is the browser real users run and because it is the only one of the two launch tiers with
//     H.264/AAC decoding, which future playback checks will depend on.
//   - JELLYFINMOD_BROWSER=chromium (default): launch Playwright's own bundled Chromium, headless, in a dedicated
//     profile. Reproducible across machines without depending on what happens to be installed; use it for
//     day-to-day iteration. Run `npx playwright install chromium` once in this directory to fetch it.
// Both launch tiers use a persistent, git-ignored profile outside the repo so sign-in and per-viewer settings
// (layout, subtitle appearance, etc.) survive between runs; JELLYFINMOD_HEADED=true opens either with a visible
// window for the rare case someone wants to watch a launched (not attached) run.
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const testUrl = new URL(process.env.JELLYFINMOD_TEST_URL);
// The isolated instances, and nothing else. Production is 8096 and must stay impossible to reach from here,
// whatever else this list grows to hold.
const ISOLATED_PORTS = ['18096', '28096'];
if (!ISOLATED_PORTS.includes(testUrl.port)) {
    throw new Error('Only the isolated instances on ports ' + ISOLATED_PORTS.join(' and ') + ' are allowed');
}
const cdpUrl = process.env.JELLYFINMOD_CDP_URL;
const browserTier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
if (!cdpUrl && browserTier !== 'chromium' && browserTier !== 'chrome') {
    throw new Error('JELLYFINMOD_BROWSER must be "chromium" or "chrome", got ' + JSON.stringify(browserTier));
}
const headed = process.env.JELLYFINMOD_HEADED === 'true';
// Outside the repo, so a launched profile's cookies and settings never end up in git or in a worktree; one
// directory per tier, so the two browsers never share (and cannot corrupt each other's) profile data.
const cacheRoot = process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Caches')
    : (process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'));
const profileDir = process.env.JELLYFINMOD_CHROME_PROFILE_DIR ?? path.join(cacheRoot, 'jellyfinmod-e2e', 'profile-' + browserTier);
const server = new URL('/web/', testUrl).href;
// Fixture-dependent gates are optional so this runner works against either isolated instance. What cannot be
// supplied is skipped and named in the summary, never quietly passed; a run with skips still exits non-zero
// unless JELLYFINMOD_ALLOW_SKIPS says a partial run was intended.
const entryId = process.env.JELLYFINMOD_NATIVE_ENTRY_ID;
// Derived from the signed-in user's own views when not given, so a browse gate does not need a fixture id.
let libraryId = process.env.JELLYFINMOD_LIBRARY_ID;
const retentionEntryTitle = process.env.JELLYFINMOD_RETENTION_ENTRY_TITLE ?? 'JellyfinMod R4 Movie';
const expectedNormalCountdown = process.env.JELLYFINMOD_EXPECT_NORMAL_COUNTDOWN;
const expectedFilteredCountdown = process.env.JELLYFINMOD_EXPECT_FILTER_COUNTDOWN;
const expectedDueCards = Number(process.env.JELLYFINMOD_EXPECT_DUE_CARDS ?? 0);
const testUser = process.env.JELLYFINMOD_TEST_USER ?? 'oleksii';
const expectAdmin = process.env.JELLYFINMOD_EXPECT_ADMIN !== 'false';
const reclaimedEntryId = process.env.JELLYFINMOD_RECLAIMED_ENTRY_ID;
const nativePlaybackItemId = process.env.JELLYFINMOD_NATIVE_PLAYBACK_ITEM_ID;
const searchQuery = process.env.JELLYFINMOD_SEARCH_QUERY ?? 'blade';
const pagingQuery = process.env.JELLYFINMOD_PAGING_QUERY ?? (process.env.JELLYFINMOD_SEARCH_QUERY ?? 'matrix');
// Quick mode is a post-deploy smoke subset. It never counts as full acceptance.
const quick = process.env.JELLYFINMOD_QUICK === 'true';
const skippedByQuickMode = quick ? [
    'failed add focus (TMDB discovery)',
    'successful in-flight add scope and duplicate activation guard (TMDB discovery)',
    'empty first discovery page with seeded held titles and continuation (TMDB discovery, fixtures)',
    'Home library exclusion and provider deduplication (fixtures, user configuration)'
] : [];

const runStarted = Date.now();
const seconds = milliseconds => Math.round(milliseconds / 100) / 10;
/** Wall-clock seconds per step, in run order. */
const timings = {};
/** Aggregated wait time by kind. Kinds overlap: a networkIdle inside a hard reload or discovery wait counts in both. */
const waits = {};
const timed = async (kind, work) => {
    const started = Date.now();
    try {
        return await work();
    } finally {
        const total = waits[kind] ??= { seconds: 0, count: 0 };
        total.seconds = seconds(total.seconds * 1000 + Date.now() - started);
        total.count++;
    }
};
/** Runs one named step, records its duration and reports it as it finishes. */
const step = async (name, work) => {
    const started = Date.now();
    try {
        const result = await work();
        timings[name] = seconds(Date.now() - started);
        console.log(`passed ${name} (${timings[name]}s)`);
        return result;
    } catch (error) {
        timings[name] = seconds(Date.now() - started);
        console.error(`failed ${name} (${timings[name]}s)`);
        throw error;
    }
};

// The dedicated profile holds the signed-in session, so a returning run reuses it; a fresh one signs in itself
// (see the "sign in from a cleared session" step below), which also means a fresh profile needs no manual setup.
let browser;
let context;
let closeBrowser;
const browserInfo = { requestedTier: cdpUrl ? 'cdp-attach' : browserTier, headless: !headed };
if (cdpUrl) {
    browser = await chromium.connectOverCDP(cdpUrl);
    context = browser.contexts()[0];
    if (!context) throw new Error('The dedicated Chrome at ' + cdpUrl + ' exposes no browser context');
    browserInfo.cdpUrl = cdpUrl;
    // Disconnect only; the dedicated Chrome and its profile stay running for whoever attached it.
    closeBrowser = () => browser.close();
} else {
    const launchOptions = { headless: !headed };
    if (browserTier === 'chrome') launchOptions.channel = 'chrome';
    try {
        context = await chromium.launchPersistentContext(profileDir, launchOptions);
    } catch (error) {
        if (browserTier === 'chrome') {
            // Report clearly rather than silently falling back to the bundled browser, which would quietly
            // stop this being the real-Chrome acceptance tier the run was asked for.
            const fallbackPath = process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : null;
            if (!fallbackPath) throw new Error('Playwright channel "chrome" failed to launch and no known executablePath fallback applies on this platform: ' + error.message);
            console.error('Playwright channel "chrome" failed (' + error.message + '); falling back to executablePath ' + fallbackPath);
            launchOptions.executablePath = fallbackPath;
            delete launchOptions.channel;
            context = await chromium.launchPersistentContext(profileDir, launchOptions);
        } else {
            throw new Error('Could not launch Playwright\'s bundled Chromium: ' + error.message
                + '. Run `npx playwright install chromium` in scripts/jellyfinmod-e2e first.');
        }
    }
    browserInfo.profileDir = profileDir;
    closeBrowser = () => context.close();
}
const page = context.pages()[0] ?? await context.newPage();
page.setDefaultTimeout(30000);
const cdp = await context.newCDPSession(page);
if (cdpUrl) {
    // Attaching over CDP shares one browser window that may hold other tabs; a background tab gets no focus
    // events from the OS, and TV center-focus depends on them. A launched context's page is always the
    // foreground (if headless, still notionally "focused") tab of its own dedicated browser, so it already
    // receives them without forcing this.
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
}
browserInfo.name = context.browser()?.browserType()?.name() ?? null;
browserInfo.version = context.browser()?.version() ?? null;
console.log('browser: ' + JSON.stringify(browserInfo));

const browserErrors = [];
const entryPostRequests = [];
const browseRequests = [];
const allRequestUrls = [];
const skippedGates = [];
const inflight = new Set();
// Requests the test deliberately holds at the HTTP boundary; they do not count as page activity.
const heldRequests = new Set();
let lastNetworkActivity = Date.now();
page.on('pageerror', error => browserErrors.push(error.stack ?? error.message));
page.on('request', request => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
        // A new document cancels the old one's pending requests, but Playwright never reports those as failed;
        // left in place they would hold every later networkIdle wait to its full timeout.
        for (const pending of inflight) if (!heldRequests.has(pending)) inflight.delete(pending);
    }
    inflight.add(request);
    lastNetworkActivity = Date.now();
    allRequestUrls.push(request.url());
    if (request.method() !== 'POST') return;
    const { pathname } = new URL(request.url());
    if (pathname === '/JellyfinMod/Entries') entryPostRequests.push(request);
    if (pathname === '/JellyfinMod/Browse') browseRequests.push(request.postData());
});
for (const event of ['requestfinished', 'requestfailed']) {
    page.on(event, request => {
        inflight.delete(request);
        lastNetworkActivity = Date.now();
    });
}

/** Swallows an expected rejection, such as an optional wait that times out. */
const ignore = () => undefined;
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
/** Reads until the value satisfies `done` or the timeout passes; returns the last reading so failures report it. */
const poll = async (read, done, { timeout = 15000, interval = 250 } = {}) => {
    const deadline = Date.now() + timeout;
    let value = await read();
    while (!done(value) && Date.now() < deadline) {
        await sleep(interval);
        value = await read();
    }
    return value;
};
/** Requests still pending when a networkIdle wait timed out, by method, type and path (no query, so no tokens). */
const idleTimeouts = {};
/** Waits until the page has had no request in flight for `quiet` ms. Used before absence checks, where no element can be awaited. */
const networkIdle = ({ quiet = 750, timeout = 20000 } = {}) => timed('networkIdle', async () => {
    const deadline = Date.now() + timeout;
    const pending = () => [...inflight].filter(request => !heldRequests.has(request));
    while (Date.now() < deadline && (pending().length || Date.now() - lastNetworkActivity < quiet)) await sleep(100);
    if (Date.now() >= deadline) {
        const stuck = pending().map(request => request.method() + ' ' + request.resourceType() + ' ' + new URL(request.url()).pathname);
        for (const key of stuck.length ? stuck : ['(continuous activity)']) idleTimeouts[key] = (idleTimeouts[key] ?? 0) + 1;
    }
    // Let React commit what the last response rendered. Not requestAnimationFrame: an occluded window never paints.
    await sleep(100);
});
/** Waits that depend on TMDB-backed discovery responses. */
const discoveryWait = work => timed('discoveryWaits', work);
const appReady = async () => {
    await page.waitForFunction(() => !!window.ApiClient && !!document.querySelector('.page:not(.hide)'));
    await networkIdle();
};
const navigate = async url => {
    await page.goto(url);
    await appReady();
};
const reload = ({ ignoreCache = false } = {}) => timed(ignoreCache ? 'hardReloads' : 'softReloads', async () => {
    const loaded = page.waitForEvent('load');
    await cdp.send('Page.reload', { ignoreCache });
    await loaded;
    await appReady();
});
const apiRequest = (path, method = 'GET', body) => page.evaluate(async request => {
    const options = { url: ApiClient.getUrl(request.path), type: request.method };
    if (request.body !== undefined) {
        options.data = JSON.stringify(request.body);
        options.contentType = 'application/json';
    }
    const response = await ApiClient.ajax(options, true);
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
}, { path, method, body });
const activeMatches = selector => page.evaluate(match => document.activeElement?.matches(match) ?? false, selector);
/** A trusted key press, as a remote or keyboard produces it; waits briefly for the app to move focus in response. */
const pressKey = async key => {
    const before = await page.evaluateHandle(() => document.activeElement);
    await page.keyboard.press(key);
    await page.waitForFunction(previous => document.activeElement !== previous, before, { timeout: 1000 }).catch(ignore);
    await before.dispose();
};
/** Activates the focused control the way a keyboard or remote does. */
const enterFocused = async () => {
    if (!await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement !== document.body)) {
        throw new Error('No focused control was available for activation');
    }
    await page.keyboard.press('Enter');
};
/** Controls that a screen reader could not name through text, aria-label or title. */
const unnamedControls = scope => page.evaluate(within => Array.from(document.querySelectorAll(within))
    .filter(node => node.offsetParent !== null)
    .filter(node => !node.textContent.trim() && !node.getAttribute('aria-label') && !node.getAttribute('title'))
    .map(node => node.outerHTML.slice(0, 120)), scope);
const clearQueryCache = () => page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('keyval-store');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains('keyval')) {
            database.close();
            resolve();
            return;
        }
        const transaction = database.transaction('keyval', 'readwrite');
        transaction.objectStore('keyval').delete('jellyfin-query-cache');
        transaction.oncomplete = () => {
            database.close();
            resolve();
        };
        transaction.onerror = () => reject(transaction.error);
    };
}));
const searchInput = page.locator('#searchTextInput');
/** Types a query as the user does and waits for the search scope and its discovery section to settle. */
const setSearch = query => discoveryWait(async () => {
    await searchInput.fill(query);
    await page.waitForFunction(expected => document.querySelector('#searchTextInput')?.value === expected
        && document.querySelector('.jfmod-discovery')?.getAttribute('aria-busy') !== 'true', query);
    await networkIdle();
});
const snapshot = () => page.evaluate(() => ({
    headings: Array.from(document.querySelectorAll('#searchPage .sectionTitle')).map(node => node.textContent.trim()),
    cards: Array.from(document.querySelectorAll('#searchPage .card')).map(node => node.getAttribute('aria-label') || node.textContent.trim()).filter(Boolean).slice(0, 30),
    notice: document.querySelector('.jfmod-searchNotice')?.textContent.trim() ?? null,
    discovery: !!document.querySelector('.jfmod-discovery'),
    addButtons: document.querySelectorAll('.jfmod-discoveryCard button:not(:disabled)').length,
    librarySelectors: document.querySelectorAll('.jfmod-discovery select').length,
    active: document.activeElement ? {
        tag: document.activeElement.tagName,
        aria: document.activeElement.getAttribute('aria-label'),
        id: document.activeElement.id,
        classes: document.activeElement.className
    } : null
}));
/** Picks the first writable library in every unset discovery selector, as a user would. */
const selectDiscoveryLibraries = async () => {
    const selects = page.locator('.jfmod-discovery select');
    for (let index = 0; index < await selects.count(); index++) {
        const select = selects.nth(index);
        const pick = await select.evaluate(node => (!node.value && node.options.length > 1 ? node.options[1].value : null));
        if (pick) await select.selectOption(pick);
    }
};
const movieIds = () => page.evaluate(() => Array.from(document.querySelectorAll('[data-jfmod-add^="movie:"]'))
    .map(button => Number(button.dataset.jfmodAdd.split(':')[1])));
const movieLibrarySelect = () => page.locator('.jfmod-discovery label').filter({ hasText: 'Movie library' }).locator('select').first();

// Holds POST /JellyfinMod/Entries at the real HTTP boundary so the test can fail or release it.
const pausedEntryRoutes = [];
const entriesRoute = url => url.pathname === '/JellyfinMod/Entries';
const holdEntryPosts = async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    heldRequests.add(route.request());
    pausedEntryRoutes.push(route);
};
const pluginRoute = '**/JellyfinMod/**';
const blockPlugin = route => route.abort('blockedbyclient');

let originalLayout;
const checks = [];
const createdEntryIds = [];
let originalUserConfiguration;
let originalUserId;
let summarized = false;
try {
    await step('setup and hard reload', async () => {
        await page.goto(server);
        await page.waitForFunction(() => !!window.ApiClient && !!document.querySelector('.page:not(.hide)'));
        const manualName = page.locator('#txtManualName');
        if (await manualName.isVisible()) {
            // Empty password by policy; the password field is never touched.
            await manualName.fill(testUser);
            await page.locator('button:visible').filter({ hasText: 'Sign In' }).first().click();
            await page.waitForFunction(() => !window.location.hash.includes('/login'), undefined, { timeout: 15000 }).catch(ignore);
        }
        await appReady();
        if (await page.evaluate(() => window.location.hash.includes('/login') || window.location.hash.includes('/selectuser'))) {
            throw new Error('Sign into the dedicated test browser as ' + testUser + ' with an empty password, then rerun');
        }
        await page.evaluate(() => Promise.all([
            navigator.serviceWorker?.getRegistrations().then(registrations => Promise.all(registrations.map(registration => registration.unregister()))) ?? Promise.resolve(),
            window.caches?.keys().then(keys => Promise.all(keys.map(key => window.caches.delete(key)))) ?? Promise.resolve()
        ]));
        await clearQueryCache();
        await reload({ ignoreCache: true });
        originalLayout = await page.evaluate(() => localStorage.getItem('layout'));
        await page.evaluate(() => localStorage.setItem('layout', 'desktop'));
        if (!libraryId) {
            libraryId = await page.evaluate(async () => {
                const views = await ApiClient.getUserViews({}, ApiClient.getCurrentUserId());
                return (views.Items ?? []).find(view => view.CollectionType === 'movies')?.Id ?? null;
            });
            if (!libraryId) throw new Error('No movie library on this server; set JELLYFINMOD_LIBRARY_ID');
        }
    });
    await step('sign in from a cleared session', async () => {
        // This runner used to sign in only when it happened to find a login form, so on an already-authenticated
        // profile the login path was never exercised — which is how a Sign In button that authenticated and then
        // never re-rendered reached a user. The session is now cleared deliberately on every run.
        const wasModBundle = await page.evaluate(() => window.__jfmodBundle === true);
        await page.evaluate(async () => {
            try {
                await window.ApiClient?.logout();
            } catch {
                // Already signed out; dropping the stored token below is what actually clears the session.
            }
            // A cleared session means no access token, not a wiped browser. Clearing all of localStorage would
            // also drop the server list, leaving the app at "add a server", which is not the state a signed-out
            // user is in — and logging out alone leaves a token the app signs straight back in with.
            try {
                const raw = localStorage.getItem('jellyfin_credentials');
                if (raw) {
                    const credentials = JSON.parse(raw);
                    for (const stored of credentials.Servers ?? []) {
                        delete stored.AccessToken;
                        delete stored.UserId;
                    }
                    localStorage.setItem('jellyfin_credentials', JSON.stringify(credentials));
                }
            } catch {
                // No stored credentials to trim; the login form is what we wanted anyway.
            }
        });
        await reload({ ignoreCache: true });
        await page.waitForFunction(() => !!window.ApiClient, undefined, { timeout: 30000 });

        const manualName = page.locator('#txtManualName');
        await manualName.waitFor({ state: 'visible', timeout: 25000 });
        // Empty password by policy; the password field is never touched.
        await manualName.fill(testUser);
        await page.locator('button:visible').filter({ hasText: 'Sign In' }).first().click();

        // Deliberately no reload: the whole point is that signing in renders Home on its own. A reload here
        // would hide exactly the defect this step exists to catch.
        const readLanding = () => page.evaluate(() => ({
            hash: window.location.hash,
            rendered: Array.from(document.querySelectorAll('.skinBody'))
                .some(element => (element.textContent ?? '').trim().length > 20),
            // Visibility, not presence: legacy views stay in the DOM with `.hide`, so asking whether the
            // element exists would pass while the login form was still covering the screen.
            loginVisible: (() => {
                const field = document.querySelector('#txtManualName');
                return !!field && !!field.offsetParent && field.getClientRects().length > 0;
            })(),
            modBundle: window.__jfmodBundle === true
        }));
        const landedOk = state => state.hash.includes('/home') && state.rendered && !state.loginVisible;
        const landing = await poll(readLanding, landedOk, { timeout: 30000 });
        if (!landedOk(landing)) {
            throw new Error('Signing in did not reach a rendered Home without a reload: ' + JSON.stringify(landing));
        }
        if (wasModBundle && !landing.modBundle) {
            throw new Error('The JellyfinMod bundle stopped running across sign-in; the failsafe or the stock entry took over');
        }

        // Navigating straight after sign-in is the same code path, so a router that is not the rendered one
        // shows up here too rather than three steps later.
        await navigate(server + '#/movies?topParentId=' + encodeURIComponent(libraryId) + '&collectionType=movies');
        const browsed = await poll(
            () => page.evaluate(() => ({
                hash: window.location.hash,
                cards: document.querySelectorAll('.card, .listItem').length
            })),
            state => state.hash.includes('/movies') && state.cards > 0,
            { timeout: 25000 }
        );
        if (!browsed.hash.includes('/movies') || browsed.cards === 0) {
            throw new Error('Navigation after sign-in did not render the library: ' + JSON.stringify(browsed));
        }

        checks.push({ signIn: 'rendered home without a reload', modBundle: landing.modBundle });
        // The layout survives a token trim, but set it again so this step cannot leave the rest of the run
        // depending on what a previous one happened to store.
        await page.evaluate(() => localStorage.setItem('layout', 'desktop'));
    });
    await step('library countdown and due filter', async () => {
        await navigate(server + '#/movies?topParentId=' + encodeURIComponent(libraryId) + '&collectionType=movies');
        await page.locator('.jfmod-entryCard:visible').first().waitFor();
        if (expectedNormalCountdown) {
            const expected = expectedNormalCountdown === 'none' ? null : expectedNormalCountdown;
            const readCountdown = () => page.evaluate(title => {
                const card = Array.from(document.querySelectorAll('.jfmod-entryCard')).find(candidate =>
                    candidate.offsetParent !== null && candidate.getAttribute('aria-label') === title);
                return card?.querySelector('.jfmod-countdown')?.textContent.trim() ?? null;
            }, retentionEntryTitle);
            const normalCountdown = await poll(readCountdown, actual => actual === expected, { timeout: 10000 });
            if (normalCountdown !== expected) {
                throw new Error('Normal library countdown mismatch: ' + JSON.stringify({ expected, actual: normalCountdown }));
            }
        }
        const filterButton = page.locator('button[aria-label="Filter"]:visible, button[title="Filter"]:visible').first();
        if (!await filterButton.waitFor().then(() => true, () => false)) throw new Error('Library filter button is unavailable');
        await filterButton.click();
        const fileGroup = page.locator('button:visible').filter({ hasText: /^\s*File\s*$/ }).first();
        if (!await fileGroup.waitFor({ timeout: 10000 }).then(() => true, () => false)) {
            const fileFilterState = await page.evaluate(() => ({
                opened: false,
                cards: document.querySelectorAll('.jfmod-entryCard').length,
                filterHeadings: Array.from(document.querySelectorAll('[role="presentation"] h3')).map(candidate => candidate.textContent.trim())
            }));
            throw new Error('File filter group is unavailable after the combined browse response: ' + JSON.stringify(fileFilterState));
        }
        await fileGroup.click();
        const dueCheckbox = page.locator('label').filter({ hasText: 'Due within 7 days' }).locator('input[type="checkbox"]').first();
        if (!await dueCheckbox.waitFor({ state: 'attached', timeout: 10000 }).then(() => true, () => false)) {
            throw new Error('Due within 7 days filter is unavailable');
        }
        // Set, not toggle: an interrupted earlier run can leave the filter persisted as checked.
        if (!await dueCheckbox.isChecked()) {
            const browsed = page.waitForResponse(response => response.request().method() === 'POST'
                && new URL(response.url()).pathname === '/JellyfinMod/Browse');
            await dueCheckbox.check();
            await browsed;
        }
        const readDue = () => page.evaluate(() => {
            const visible = Array.from(document.querySelectorAll('.jfmod-entryCard')).filter(candidate => candidate.offsetParent !== null);
            return {
                dueChecked: Array.from(document.querySelectorAll('label')).find(candidate => candidate.textContent.includes('Due within 7 days'))
                    ?.querySelector('input[type="checkbox"]')?.checked ?? false,
                cards: visible.length,
                countdowns: visible.map(candidate => candidate.querySelector('.jfmod-countdown')?.textContent.trim()).filter(Boolean)
            };
        });
        const dueMatches = result => result.dueChecked && result.cards === expectedDueCards
            && (!expectedFilteredCountdown || result.countdowns.includes(expectedFilteredCountdown));
        const dueResult = await poll(readDue, dueMatches, { timeout: 10000 });
        if (!dueMatches(dueResult)) {
            throw new Error('Due filter did not render the expected eligible set: ' + JSON.stringify(dueResult));
        }
        await dueCheckbox.uncheck();
        const restored = await poll(() => page.evaluate(() => Array.from(document.querySelectorAll('.jfmod-entryCard'))
            .some(candidate => candidate.offsetParent !== null)), Boolean);
        if (!restored) throw new Error('Clearing the Due filter did not restore the isolated library');
        checks.push({ dueFilter: 'passed', eligibleSet: 'passed' });
    });
    if (!expectedNormalCountdown) skippedGates.push('normal-library countdown (JELLYFINMOD_EXPECT_NORMAL_COUNTDOWN)');
    if (!expectedFilteredCountdown) skippedGates.push('filtered countdown (JELLYFINMOD_EXPECT_FILTER_COUNTDOWN)');
    if (!reclaimedEntryId) skippedGates.push('reclaimed details without playback (JELLYFINMOD_RECLAIMED_ENTRY_ID)');
    if (!nativePlaybackItemId) skippedGates.push('native playback action (JELLYFINMOD_NATIVE_PLAYBACK_ITEM_ID)');
    const playbackPattern = /^(play|resume|continue)/i;
    const detailControls = () => page.evaluate(() => Array.from(document.querySelectorAll('#itemDetailPage:not(.hide) button, #itemDetailPage:not(.hide) a'))
        .filter(candidate => candidate.offsetParent !== null)
        .map(candidate => ({ text: candidate.textContent.trim(), title: candidate.getAttribute('title'), aria: candidate.getAttribute('aria-label'), classes: candidate.className })));
    const isPlayback = control => [control.text, control.title ?? '', control.aria ?? ''].some(value => playbackPattern.test(value));
    if (reclaimedEntryId) {
        await step('reclaimed details without playback', async () => {
            await navigate(server + '#/details?entryId=' + encodeURIComponent(reclaimedEntryId));
            // Entry details portal their actions into the stock detail buttons, so wait for them before judging absence.
            const actionsRendered = await page.locator('#itemDetailPage:not(.hide) .jfmod-entryActions').waitFor({ timeout: 15000 }).then(() => true, () => false);
            await networkIdle();
            const controls = await detailControls();
            const reclaimed = {
                filelessRoot: await page.locator('#itemDetailPage:not(.hide) .jfmod-entryDetailsRoot').count() > 0,
                actionsRendered,
                playback: controls.filter(isPlayback)
            };
            if (!reclaimed.filelessRoot || !reclaimed.actionsRendered || reclaimed.playback.length) {
                throw new Error('Reclaimed details exposed a dead playback action: ' + JSON.stringify(reclaimed));
            }
            checks.push({ reclaimedPlayback: 'absent' });
        });
    }
    if (nativePlaybackItemId) {
        await step('native playback action', async () => {
            await navigate(server + '#/details?id=' + encodeURIComponent(nativePlaybackItemId));
            const controls = await poll(detailControls, candidates => candidates.some(isPlayback));
            if (!controls.some(isPlayback)) throw new Error('Native movie lost its playback action: ' + JSON.stringify(controls));
            checks.push({ nativePlayback: 'present' });
        });
    }
    const keepSelector = '#itemDetailPage:not(.hide) .jfmod-nativeEntryDetails button[aria-pressed]';
    /** Reaches Keep the way the layout is driven, activates it with Enter and checks focus and state. */
    const keepByKeyboard = async (layout, width) => {
        // Reach Keep the way this layout is driven: the D-pad on TV, Tab elsewhere, from the first detail action.
        await page.locator('#itemDetailPage:not(.hide) .mainDetailButtons button:not(.hide)').first().focus();
        const key = layout === 'tv' ? 'ArrowDown' : 'Tab';
        let reached = false;
        for (let press = 0; press < 40 && !reached; press++) {
            await pressKey(key);
            reached = await activeMatches(keepSelector);
        }
        if (!reached) throw new Error('Keep is not reachable by ' + key + ' in ' + layout);
        const kept = page.waitForResponse(response => response.request().method() === 'POST'
            && /\/JellyfinMod\/Entries\/[^/]+\/Keep$/.test(new URL(response.url()).pathname), { timeout: 15000 });
        await page.keyboard.press('Enter');
        await kept.catch(ignore);
        const readKept = () => page.evaluate(selector => ({
            focused: document.activeElement?.matches(selector) ?? false,
            label: document.activeElement?.textContent.trim() ?? null,
            pressed: document.activeElement?.getAttribute('aria-pressed') ?? null,
            status: document.querySelector('#itemDetailPage:not(.hide) .jfmod-nativeEntryDetails .jfmod-retentionStatus')?.textContent.trim() ?? null
        }), keepSelector);
        const keptOk = state => state.focused && state.label === 'Kept' && state.pressed === 'true' && state.status === 'Kept indefinitely.';
        const keptState = await poll(readKept, keptOk, { timeout: 10000 });
        if (!keptOk(keptState)) {
            throw new Error('Keep by ' + key + ' and Enter did not keep focus and state in ' + layout + ': ' + JSON.stringify(keptState));
        }
        checks.push({ layout, width, keepByKeyboard: key + '+Enter', keepFocus: 'passed', retentionStatus: 'passed' });
    };
    if (!entryId) skippedGates.push('native details and Keep by keyboard (JELLYFINMOD_NATIVE_ENTRY_ID)');
    for (const [layout, width, height] of (entryId ? [['desktop', 1440, 900], ['mobile', 390, 844], ['tv', 1920, 1080], ['tv', 1280, 720]] : [])) {
        await step(`native details ${layout} ${width}x${height}`, async () => {
            await page.setViewportSize({ width, height });
            await page.evaluate(value => localStorage.setItem('layout', value), layout);
            // The layout is read at startup; reload so the whole iteration runs in it.
            await reload();
            await navigate(server + '#/details?entryId=' + encodeURIComponent(entryId));
            const readNative = () => page.evaluate(expectedLayout => ({
                layoutApplied: document.documentElement.classList.contains('layout-' + expectedLayout),
                nativeRoute: window.location.hash.includes('id=') && !window.location.hash.includes('entryId='),
                seasons: Array.from(document.querySelectorAll('#itemDetailPage:not(.hide) .sectionTitle')).some(title =>
                    title.textContent.trim() === 'Seasons' && !!title.parentElement?.querySelector('.card, .listItem')),
                history: !!document.querySelector('#itemDetailPage:not(.hide) .jfmod-nativeEntryDetails .jfmod-entryHistory'),
                filelessRoot: !!document.querySelector('#itemDetailPage:not(.hide) .jfmod-entryDetailsRoot')
            }), layout);
            const nativeOk = native => native.layoutApplied && native.nativeRoute && native.seasons && native.history && !native.filelessRoot;
            const native = await poll(readNative, nativeOk, { timeout: 20000 });
            if (!nativeOk(native)) throw new Error('Bound series lost native details in ' + layout + ': ' + JSON.stringify(native));
            await page.locator('#itemDetailPage:not(.hide) .btnMoreCommands:not(.hide)').first().click();
            const menuHasSearch = await page.locator('[data-id="jfmod-search-releases"]').filter({ hasText: 'Search releases' }).first()
                .waitFor({ timeout: 10000 }).then(() => true, () => false);
            if (!menuHasSearch) throw new Error('Search releases missing from native More menu in ' + layout);
            checks.push({ layout, width, height, nativeDetails: 'passed' });
            // Escape is the app's Back on TV and closes the sheet. With focus on the body, desktop and mobile keep the
            // sheet open, so waiting there only ran out its timeout; the reload that follows discards the sheet.
            await page.keyboard.press('Escape');
            if (layout === 'tv') {
                await page.locator('[data-id="jfmod-search-releases"]').first().waitFor({ state: 'hidden', timeout: 10000 }).catch(ignore);
            }
        });
        await step(`keep by keyboard ${layout} ${width}x${height}`, async () => {
            await reload();
            await page.locator('#itemDetailPage:not(.hide) .jfmod-nativeEntryDetails').first().waitFor();
            if (expectAdmin) await page.locator(keepSelector).first().waitFor({ timeout: 15000 }).catch(ignore);
            await networkIdle();
            const unnamed = await unnamedControls('#itemDetailPage:not(.hide) .jfmod-nativeEntryDetails button, '
                + '#itemDetailPage:not(.hide) .mainDetailButtons button:not(.hide)');
            if (unnamed.length) throw new Error('Controls without text, aria-label or title in ' + layout + ': ' + JSON.stringify(unnamed));
            const hasKeep = await page.locator(keepSelector).count() > 0;
            if (expectAdmin) {
                if (!hasKeep) throw new Error('Admin Keep action is missing from native details in ' + layout);
                await keepByKeyboard(layout, width);
            } else {
                if (hasKeep) throw new Error('Restricted user can see the admin-only Keep action in ' + layout);
                checks.push({ layout, width, restrictedKeep: 'absent' });
            }
        });
    }
    if (!quick) {
        let identity;
        let firstPage;
        let continued;
        const addButton = id => page.locator(`[data-jfmod-add="${id}"]`);
        const homeRows = () => page.evaluate(() => Array.from(document.querySelectorAll('.jfmod-homeRowRoot')).map(root => ({
            title: root.querySelector('.sectionTitle')?.textContent.trim(),
            ids: Array.from(root.querySelectorAll('[data-jfmod-tmdb-id]')).map(node => node.getAttribute('data-jfmod-tmdb-id'))
        })));
        await step('reload and open discovery', async () => {
            await page.setViewportSize({ width: 1440, height: 900 });
            await page.evaluate(() => localStorage.setItem('layout', 'desktop'));
            // Setup already bypassed the HTTP cache once; this reload only applies the layout.
            await reload();
            await navigate(server + '#/search?query=' + encodeURIComponent(searchQuery));
            if (!await page.locator('#searchPage:not(.hide)').count()) {
                const searchButton = page.locator('button[aria-label="Search"]').first();
                if (!await searchButton.count()) throw new Error('Search route could not be activated');
                await searchButton.click();
            }
            await page.locator('#searchPage:not(.hide)').waitFor();
            await discoveryWait(() => page.locator('.jfmod-discovery select').first().waitFor({ state: 'attached', timeout: 20000 }).catch(ignore));
            await selectDiscoveryLibraries();
            const firstAdd = page.locator('[data-jfmod-add]:not(:disabled)').first();
            await discoveryWait(() => firstAdd.waitFor({ timeout: 20000 }).catch(ignore));
            identity = await firstAdd.getAttribute('data-jfmod-add', { timeout: 1000 }).catch(() => null);
            if (!identity) throw new Error('Fixture query needs an unheld TMDB result and a writable library');
        });
        await step('failed add focus', async () => {
            // Fail the actual HTTP transport. No fake API success or client response is injected.
            const failedRequestStart = entryPostRequests.length;
            const failedPauseStart = pausedEntryRoutes.length;
            await page.route(entriesRoute, holdEntryPosts);
            await addButton(identity).focus();
            if (await page.evaluate(() => document.activeElement?.getAttribute('data-jfmod-add')) !== identity) {
                throw new Error('TV focus manager moved the failed-add fixture before Enter');
            }
            await enterFocused();
            await poll(() => pausedEntryRoutes.length, count => count > failedPauseStart, { timeout: 5000, interval: 100 });
            if (pausedEntryRoutes.length !== failedPauseStart + 1) throw new Error('Failed-add fixture did not reach the real HTTP boundary');
            heldRequests.clear();
            await pausedEntryRoutes[failedPauseStart].abort('failed');
            const focused = await poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-jfmod-add')), value => value === identity,
                { timeout: 5000 });
            await networkIdle();
            await page.unroute(entriesRoute, holdEntryPosts);
            if (entryPostRequests.length !== failedRequestStart + 1 || focused !== identity) {
                throw new Error('Failed add did not send one request and return focus to its Add button: requests='
                    + (entryPostRequests.length - failedRequestStart) + ', paused=' + (pausedEntryRoutes.length - failedPauseStart)
                    + ', focused=' + focused + ', expected=' + identity);
            }
            checks.push({ failedAddFocus: 'passed' });
        });

        await step('successful in-flight add scope', async () => {
            const successfulAdd = await page.evaluate(() => {
                const button = document.querySelector('[data-jfmod-add]:not(:disabled)');
                if (!button) return null;
                const mediaType = button.dataset.jfmodAdd.split(':')[0];
                const label = mediaType === 'movie' ? 'Movie library' : 'TV library';
                const select = Array.from(document.querySelectorAll('.jfmod-discovery label')).find(node => node.textContent.includes(label))?.querySelector('select');
                return {
                    identity: button.dataset.jfmodAdd,
                    tmdbId: Number(button.dataset.jfmodAdd.split(':')[1]),
                    mediaType,
                    title: button.getAttribute('aria-label').replace(/^Add | to catalog$/g, ''),
                    targetLibraryId: select?.value
                };
            });
            if (!successfulAdd?.targetLibraryId) throw new Error('Successful-add fixture needs a selected writable library');
            const requestStart = entryPostRequests.length;
            const pausedStart = pausedEntryRoutes.length;
            await page.route(entriesRoute, holdEntryPosts);
            await addButton(successfulAdd.identity).focus();
            // A remote's repeated Enter: the second press lands wherever the first left focus, which may be the disabled button or the body.
            await enterFocused();
            await page.keyboard.press('Enter');
            await poll(() => pausedEntryRoutes.length, count => count > pausedStart, { timeout: 5000, interval: 100 });
            await networkIdle({ quiet: 500, timeout: 3000 });
            if (pausedEntryRoutes.length !== pausedStart + 1) {
                throw new Error('Repeated Enter did not produce exactly one paused Add request: paused='
                    + (pausedEntryRoutes.length - pausedStart) + ', sent=' + (entryPostRequests.length - requestStart));
            }
            const changedQuery = 'jfmod-inflight-' + Date.now();
            await searchInput.focus();
            await setSearch(changedQuery);
            const changedBeforeRelease = await snapshot();
            if (changedBeforeRelease.active?.id !== 'searchTextInput') throw new Error('Changing scope lost search input focus before Add completed');
            const added = page.waitForResponse(response => response.request().method() === 'POST' && entriesRoute(new URL(response.url())));
            heldRequests.clear();
            await pausedEntryRoutes[pausedStart].continue();
            await added;
            // An old request must not restore anything in the new scope; nothing can be awaited for an absence, so wait for quiet.
            await networkIdle({ quiet: 1500 });
            await page.unroute(entriesRoute, holdEntryPosts);
            if (entryPostRequests.length !== requestStart + 1) throw new Error('Repeated Enter sent more than one Add request');
            const changedAfterRelease = await page.evaluate(tmdbId => ({
                query: document.querySelector('#searchTextInput')?.value,
                active: document.activeElement?.id,
                oldTitle: !!document.querySelector(`[data-jfmod-tmdb-id="${tmdbId}"]`)
            }), successfulAdd.tmdbId);
            if (changedAfterRelease.query !== changedQuery || changedAfterRelease.active !== 'searchTextInput' || changedAfterRelease.oldTitle) {
                throw new Error('Completed Add changed the new search scope: ' + JSON.stringify(changedAfterRelease));
            }
            await setSearch(searchQuery);
            const canonicalCount = await discoveryWait(() => poll(() => page.locator(`[data-jfmod-tmdb-id="${successfulAdd.tmdbId}"]`).count(), count => count === 1));
            if (canonicalCount !== 1) throw new Error('Returning to the original search did not show one canonical added title');
            const createdLookup = await apiRequest('JellyfinMod/Entries?mediaType=' + successfulAdd.mediaType
                + '&targetLibraryId=' + encodeURIComponent(successfulAdd.targetLibraryId) + '&limit=200');
            const createdEntry = createdLookup.body.items.find(entry => entry.tmdbId === successfulAdd.tmdbId);
            if (!createdEntry) throw new Error('Successful Add did not persist its canonical entry');
            createdEntryIds.push(createdEntry.id);
            await apiRequest('JellyfinMod/Entries/' + encodeURIComponent(createdEntry.id), 'DELETE');
            createdEntryIds.pop();
            checks.push({ successfulAddScope: 'passed', repeatedActivations: 2, requests: 1 });
        });

        await step('empty discovery page and continuation', async () => {
            await setSearch(pagingQuery);
            await selectDiscoveryLibraries();
            const readFirstPage = async () => ({ ids: await movieIds(), targetLibraryId: await movieLibrarySelect().inputValue({ timeout: 1000 }).catch(() => undefined) });
            firstPage = await discoveryWait(() => poll(readFirstPage, result => result.targetLibraryId && result.ids.length >= 10));
            if (!firstPage.targetLibraryId || firstPage.ids.length < 10) throw new Error('Paging fixture needs a writable movie library and a full discovery page');
            const beforeMore = firstPage.ids.length;
            const moreButton = page.locator('.jfmod-discovery > button').filter({ hasText: 'More movie results' }).first();
            if (!await moreButton.waitFor({ state: 'attached', timeout: 5000 }).then(() => true, () => false)) {
                throw new Error('The first discovery page did not expose movie continuation');
            }
            await moreButton.focus();
            await enterFocused();
            await discoveryWait(() => poll(() => movieIds().then(ids => ids.length), count => count > beforeMore, { timeout: 30000 }));
            await networkIdle();
            const explicitContinuation = await page.evaluate(() => ({
                ids: Array.from(document.querySelectorAll('[data-jfmod-add^="movie:"]')).map(button => Number(button.dataset.jfmodAdd.split(':')[1])),
                active: document.activeElement?.textContent?.trim()
            }));
            if (explicitContinuation.ids.length <= beforeMore || new Set(explicitContinuation.ids).size !== explicitContinuation.ids.length
                || !explicitContinuation.active?.includes('More movie results')) {
                throw new Error('Explicit discovery continuation repeated titles or lost focus: ' + JSON.stringify(explicitContinuation));
            }

            const seedQuery = pagingQuery === pagingQuery.toUpperCase() ? pagingQuery.toLowerCase() : pagingQuery.toUpperCase();
            await navigate(server);
            await navigate(server + '#/search?query=' + encodeURIComponent(seedQuery));
            const seedSettled = result => result.query === seedQuery && result.busy === 'false' && result.ids.length >= 10 && result.ids.length <= 20;
            const seedPage = await discoveryWait(() => poll(async () => ({
                query: await page.evaluate(() => document.querySelector('#searchTextInput')?.value),
                busy: await page.evaluate(() => document.querySelector('.jfmod-discovery')?.getAttribute('aria-busy')),
                ids: await movieIds()
            }), seedSettled, { timeout: 30000, interval: 500 }));
            const seedIds = seedPage?.ids ?? [];
            if (!seedSettled(seedPage)) {
                throw new Error('Automatic-page fixture did not settle on one full first page: ' + JSON.stringify(seedPage));
            }
            await timed('fixtureSeeding', async () => {
                for (const tmdbId of seedIds) {
                    const created = await apiRequest('JellyfinMod/Entries', 'POST', { mediaType: 'movie', tmdbId, targetLibraryId: firstPage.targetLibraryId });
                    if (created.body.created) createdEntryIds.push(created.body.entry.id);
                }
            });
            console.log(`seeded ${createdEntryIds.length} reversible held titles for empty-page acceptance`);
            const verificationQuery = seedQuery.slice(0, 1).toLowerCase() + seedQuery.slice(1, 2).toUpperCase() + seedQuery.slice(2).toLowerCase();
            await navigate(server);
            await navigate(server + '#/search?query=' + encodeURIComponent(verificationQuery));
            const readContinuation = () => page.evaluate(() => ({
                ids: Array.from(document.querySelectorAll('[data-jfmod-add^="movie:"]')).map(button => Number(button.dataset.jfmodAdd.split(':')[1])),
                more: Array.from(document.querySelectorAll('.jfmod-discovery > button')).some(button => button.textContent.includes('More movie results')),
                busy: document.querySelector('.jfmod-discovery')?.getAttribute('aria-busy'),
                notice: document.querySelector('.jfmod-searchNotice')?.textContent?.trim(),
                query: document.querySelector('#searchTextInput')?.value,
                hash: window.location.hash
            }));
            const continuation = await discoveryWait(() => poll(readContinuation,
                result => result.query === verificationQuery && result.ids.length && !result.ids.some(id => seedIds.includes(id)),
                { timeout: 30000, interval: 500 }));
            if (!continuation?.ids.length || continuation.ids.some(id => seedIds.includes(id))) {
                throw new Error('An entirely held first page did not advance automatically to distinct page-two results: ' + JSON.stringify(continuation));
            }
            continued = { ids: continuation.ids };
            await timed('fixtureCleanup', async () => {
                for (const id of createdEntryIds.splice(0)) await apiRequest('JellyfinMod/Entries/' + encodeURIComponent(id), 'DELETE');
            });
            checks.push({ emptyDiscoveryPage: 'passed', automaticPage: 2, explicitContinuation: 'passed' });
        });

        await step('home library exclusion and provider deduplication', async () => {
            const homeLibraryOptions = await movieLibrarySelect().evaluate(select => Array.from(select.options).map(option => option.value).filter(Boolean))
                .catch(() => []);
            const userState = await page.evaluate(async () => {
                const user = await ApiClient.getCurrentUser(false);
                return { id: user.Id, configuration: user.Configuration };
            });
            const userViews = await apiRequest('Users/' + encodeURIComponent(userState.id) + '/Views');
            const homeMovieLibraryIds = new Set((userViews.body.Items ?? [])
                .filter(view => view.CollectionType === 'movies').map(view => view.Id));
            const homeLibraries = homeLibraryOptions.filter(id => homeMovieLibraryIds.has(id));
            if (homeLibraries.length < 2 || continued.ids.length < 2) throw new Error('Home acceptance needs two writable movie Home views and two unheld provider titles');
            const [excludedLibraryId, includedLibraryId] = homeLibraries;
            const [duplicateTmdbId, excludedTmdbId] = continued.ids;
            await movieLibrarySelect().selectOption(excludedLibraryId);
            const addFromUi = async tmdbId => {
                const button = addButton('movie:' + tmdbId);
                if (!await button.count()) throw new Error('Home UI fixture lost discovery title ' + tmdbId);
                await button.focus();
                await enterFocused();
                if (!await button.waitFor({ state: 'detached', timeout: 30000 }).then(() => true, () => false)) {
                    throw new Error('Home UI fixture add did not complete for ' + tmdbId);
                }
            };
            await timed('fixtureSeeding', async () => {
                await addFromUi(duplicateTmdbId);
                await addFromUi(excludedTmdbId);
            });
            const primaryEntries = await poll(() => apiRequest('JellyfinMod/Entries?mediaType=movie&targetLibraryId='
                + encodeURIComponent(excludedLibraryId) + '&limit=200'),
            result => [duplicateTmdbId, excludedTmdbId].every(tmdbId => result.body.items.some(entry => entry.tmdbId === tmdbId)),
            { timeout: 30000, interval: 500 });
            for (const tmdbId of [duplicateTmdbId, excludedTmdbId]) {
                const entry = primaryEntries?.body.items.find(candidate => candidate.tmdbId === tmdbId);
                if (!entry) throw new Error('UI add did not persist Home fixture ' + tmdbId);
                createdEntryIds.push(entry.id);
            }
            const duplicateTitle = primaryEntries.body.items.find(entry => entry.tmdbId === duplicateTmdbId).title;
            const excludedTitle = primaryEntries.body.items.find(entry => entry.tmdbId === excludedTmdbId).title;
            const duplicateCopy = await apiRequest('JellyfinMod/Entries', 'POST', {
                mediaType: 'movie', tmdbId: duplicateTmdbId, targetLibraryId: includedLibraryId
            });
            if (!duplicateCopy.body.created) throw new Error('Home fixture duplicate copy already existed unexpectedly');
            createdEntryIds.push(duplicateCopy.body.entry.id);
            originalUserId = userState.id;
            originalUserConfiguration = userState.configuration;
            const includedConfiguration = { ...originalUserConfiguration,
                LatestItemsExcludes: (originalUserConfiguration.LatestItemsExcludes ?? [])
                    .filter(id => id !== excludedLibraryId && id !== includedLibraryId) };
            const applyHomeConfiguration = async configuration => {
                await page.evaluate(update => ApiClient.updateUserConfiguration(update.userId, update.configuration),
                    { userId: originalUserId, configuration });
                await clearQueryCache();
                // Recently Added reads POST /JellyfinMod/Browse, which the HTTP cache never serves; a plain reload resets the app.
                await reload();
                await page.evaluate(async applied => {
                    const user = await ApiClient.getCurrentUser(false);
                    user.Configuration = applied;
                }, configuration);
                await navigate(server + '#/home.html');
            };
            const homeCounts = () => page.evaluate(titles => {
                const root = Array.from(document.querySelectorAll('.jfmod-homeRowRoot')).find(node => node.querySelector('.sectionTitle')?.textContent.trim() === 'Recently Added');
                const labels = Array.from(root?.querySelectorAll('[aria-label]') ?? []).map(node => node.getAttribute('aria-label'));
                return {
                    duplicate: labels.filter(label => label === titles.duplicateTitle).length,
                    excluded: labels.filter(label => label === titles.excludedTitle).length
                };
            }, { duplicateTitle, excludedTitle });
            const waitForHomeCounts = (duplicate, excluded) => poll(homeCounts, result => result.duplicate === duplicate && result.excluded === excluded,
                { timeout: 30000, interval: 1000 });
            const browseRequest = targetLibraryId => ({
                mediaType: 'movie', targetLibraryId, sortBy: ['DateCreated'], sortOrder: 'Descending', startIndex: 0, limit: 24,
                state: [],
                filters: {
                    genres: [], years: [], officialRatings: [], tags: [], studioIds: [], status: [], seriesStatus: [],
                    features: [], videoBasicFilter: [], videoTypes: [], audioLanguages: [], subtitleLanguages: []
                }
            });
            await applyHomeConfiguration(includedConfiguration);
            let counts = await waitForHomeCounts(1, 1);
            if (counts.duplicate !== 1 || counts.excluded !== 1) {
                const browse = await Promise.all([excludedLibraryId, includedLibraryId].map(id => apiRequest('JellyfinMod/Browse', 'POST', browseRequest(id))));
                throw new Error('Recently Added did not deduplicate accessible provider copies: '
                    + JSON.stringify({ counts, excludedLibraryId, includedLibraryId,
                        browse: browse.map(result => ({ status: result.status, ids: result.body?.items?.map(row => row.entry?.tmdbId) })),
                        homeBrowseRequests: browseRequests.slice(-12), home: await homeRows() }));
            }
            const excludedConfiguration = { ...includedConfiguration,
                LatestItemsExcludes: [...new Set([...(includedConfiguration.LatestItemsExcludes ?? []), excludedLibraryId])] };
            await applyHomeConfiguration(excludedConfiguration);
            counts = await waitForHomeCounts(1, 0);
            if (counts.duplicate !== 1 || counts.excluded !== 0) {
                const includedBrowse = await apiRequest('JellyfinMod/Browse', 'POST', browseRequest(includedLibraryId));
                throw new Error('Recently Added exposed a title from an excluded library: '
                    + JSON.stringify({ counts, duplicateTmdbId, includedLibraryId,
                        includedIds: includedBrowse.body.items.map(row => row.entry?.tmdbId),
                        homeBrowseRequests: browseRequests.slice(-12), home: await homeRows() }));
            }
            await applyHomeConfiguration(includedConfiguration);
            counts = await waitForHomeCounts(1, 1);
            if (counts.duplicate !== 1 || counts.excluded !== 1) throw new Error('Restoring Latest libraries did not restore the excluded catalog title: ' + JSON.stringify(counts));
            await page.evaluate(async ({ userId, configuration }) => {
                await ApiClient.updateUserConfiguration(userId, configuration);
                const user = await ApiClient.getCurrentUser(false);
                user.Configuration = configuration;
            }, { userId: originalUserId, configuration: originalUserConfiguration });
            originalUserConfiguration = undefined;
            await timed('fixtureCleanup', async () => {
                for (const id of createdEntryIds.splice(0)) await apiRequest('JellyfinMod/Entries/' + encodeURIComponent(id), 'DELETE');
            });
            checks.push({ homeLibraryExclusion: 'passed', providerDeduplication: 'passed', accessibleCopies: 2 });
        });
    }

    await step('plugin transport outage', async () => {
        if (quick) {
            // Full mode resets the layout before its discovery steps; quick mode skips them, so reset here. The reload below applies it.
            await page.setViewportSize({ width: 1440, height: 900 });
            await page.evaluate(() => localStorage.setItem('layout', 'desktop'));
        }
        // Any bound entry proves the outage behaviour; the fixture id is only a way to name one.
        const boundEntry = entryId ?
            (await apiRequest('JellyfinMod/Entries/' + encodeURIComponent(entryId))).body.entry :
            (await apiRequest('JellyfinMod/Entries?limit=50')).body?.items?.find(entry => entry.jellyfinItemId);
        const nativeItemId = boundEntry?.jellyfinItemId;
        if (!nativeItemId) throw new Error('Plugin outage gate needs an entry bound to a native item');
        await clearQueryCache();
        await page.route(pluginRoute, blockPlugin);
        // Routing disables the HTTP cache, so the run keeps its single cache-bypassing reload for setup.
        await reload();
        await navigate(server + '#/details?id=' + encodeURIComponent(nativeItemId));
        const nativeWithoutPlugin = await poll(() => page.evaluate(() => ({
            title: document.querySelector('#itemDetailPage:not(.hide) .itemName')?.textContent?.trim(),
            actions: document.querySelectorAll('#itemDetailPage:not(.hide) .mainDetailButtons button:not(.hide)').length,
            pluginDetails: !!document.querySelector('#itemDetailPage:not(.hide) .jfmod-nativeEntryDetails')
        })), result => result.title && result.actions);
        if (!nativeWithoutPlugin.title || !nativeWithoutPlugin.actions) {
            throw new Error('Native details did not degrade cleanly while plugin transport was absent: ' + JSON.stringify(nativeWithoutPlugin));
        }
        await navigate(server + '#/search?query=' + encodeURIComponent(boundEntry.title));
        const nativeSearchWithoutPlugin = await poll(() => page.evaluate(() => ({
            sections: Array.from(document.querySelectorAll('#searchPage .sectionTitle')).map(node => node.textContent.trim()),
            cards: document.querySelectorAll('#searchPage .card').length,
            discovery: !!document.querySelector('#searchPage .jfmod-discovery')
        })), result => result.cards > 0);
        if (!nativeSearchWithoutPlugin.cards) {
            throw new Error('Native search did not degrade cleanly while plugin transport was absent: ' + JSON.stringify(nativeSearchWithoutPlugin));
        }
        await page.unroute(pluginRoute, blockPlugin);
        checks.push({ pluginTransportAbsent: 'passed', nativeDetails: 'usable', nativeSearch: 'usable',
            cachedPluginDetails: nativeWithoutPlugin.pluginDetails, cachedDiscovery: nativeSearchWithoutPlugin.discovery });
    });

    // The Home Continue watching row must show when Jellyfin has resumable items for this user.
    await step('home resume row', async () => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await navigate(server + '#/home');
        const resume = await apiRequest('UserItems/Resume?limit=12&mediaTypes=Video');
        const resumeIds = (resume.body?.Items ?? []).map(item => item.Id.replace(/-/g, '').toLowerCase());
        if (!resumeIds.length) {
            skippedGates.push('Home resume row (the test user has no resumable item)');
        } else {
            const row = await poll(() => page.evaluate(() => {
                const title = Array.from(document.querySelectorAll('.sectionTitle')).find(node => /^continue watching$/i.test(node.textContent.trim()));
                const section = title?.closest('.verticalSection') ?? title?.parentElement?.parentElement;
                return { present: !!title, ids: Array.from(section?.querySelectorAll('.card[data-id]') ?? []).map(card => card.dataset.id.replace(/-/g, '').toLowerCase()) };
            }), result => result.present && result.ids.some(id => resumeIds.includes(id)));
            if (!row.present || !row.ids.some(id => resumeIds.includes(id))) {
                throw new Error('Home Continue watching row is missing resumable items: ' + JSON.stringify({ row, resumeIds }));
            }
            checks.push({ homeResumeRow: 'passed', resumable: resumeIds.length, shown: row.ids.length });
        }
    });

    // Catalog entry IDs belong to /JellyfinMod only; a native request carrying one would 404 or leak.
    await step('plugin ID leak check', async () => {
        const entries = await apiRequest('JellyfinMod/Entries?limit=200');
        const entryIds = new Set([...(entries.body?.items ?? []).map(entry => entry.id), ...createdEntryIds]
            .map(id => String(id).replace(/-/g, '').toLowerCase()));
        const leaked = allRequestUrls.filter(url => {
            const parsed = new URL(url, server);
            if (parsed.pathname.includes('/JellyfinMod/') || parsed.host !== new URL(server).host) return false;
            const text = decodeURIComponent(parsed.pathname + parsed.search).replace(/-/g, '').toLowerCase();
            return [...entryIds].some(id => text.includes(id)) || text.includes('pending:');
        });
        if (leaked.length) throw new Error('Native requests carried plugin entry IDs: ' + JSON.stringify(leaked.slice(0, 10)));
        checks.push({ nativeRequestsWithPluginIds: 0, requestsChecked: allRequestUrls.length });
    });

    await step('search scope isolation', async () => {
        await navigate(server + '#/search');
        await searchInput.waitFor();
        await setSearch('jfmod-no-results-' + Date.now());
        const empty = await snapshot();
        if (empty.cards.length) throw new Error('Prior search cards leaked into the new query');
        checks.push({ searchScope: 'passed' });
    });
    if (browserErrors.length) throw new Error('Browser threw uncaught exceptions: ' + JSON.stringify(browserErrors));
    timings.total = seconds(Date.now() - runStarted);
    summarized = true;
    console.log(JSON.stringify({
        mode: quick ? 'quick' : 'full',
        fullAcceptance: !quick,
        ...(quick ? { note: 'Quick smoke run; it does not count as full acceptance.' } : {}),
        browser: browserInfo,
        acceptanceEvidence: browserInfo.requestedTier === 'chrome' ?
            'This ran on real, installed Google Chrome; it counts as acceptance evidence.' :
            'This ran on ' + browserInfo.requestedTier + ', not real Chrome; rerun with JELLYFINMOD_BROWSER=chrome before calling anything accepted.',
        // No check here plays a <video> element or inspects decode state, so none is currently codec-sensitive;
        // revisit this note (and skip any that need it, rather than let them fail) once a check switches audio
        // tracks or subtitles and depends on H.264/AAC, which the bundled Chromium tier does not have.
        mediaDecodeCoverage: 'no check in this suite currently exercises real playback/decode',
        checks, skippedGates, skippedByQuickMode, timings, waits, idleTimeouts,
        waitNote: 'Wait kinds overlap: networkIdle inside hard reloads or discovery waits counts in each.',
        physicalTv: 'not tested',
        remaining: ['physical webOS acceptance']
    }, null, 2));
    if (skippedGates.length && process.env.JELLYFINMOD_ALLOW_SKIPS !== 'true') {
        console.error('Skipped gates make this run incomplete; set JELLYFINMOD_ALLOW_SKIPS=true only for a partial run.');
        process.exitCode = 2;
    }
} finally {
    if (!summarized) {
        timings.total = seconds(Date.now() - runStarted);
        console.error(JSON.stringify({ mode: quick ? 'quick' : 'full', partialTimings: timings, waits, idleTimeouts }));
    }
    for (const route of pausedEntryRoutes) await route.abort('failed').catch(ignore);
    await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(ignore);
    if (originalUserConfiguration && originalUserId) {
        await page.evaluate(({ userId, configuration }) => ApiClient.updateUserConfiguration(userId, configuration),
            { userId: originalUserId, configuration: originalUserConfiguration }).catch(ignore);
    }
    for (const id of createdEntryIds) await apiRequest('JellyfinMod/Entries/' + encodeURIComponent(id), 'DELETE').catch(ignore);
    if (originalLayout !== undefined) {
        await page.evaluate(layout => (layout === null ? localStorage.removeItem('layout') : localStorage.setItem('layout', layout)), originalLayout)
            .catch(ignore);
    }
    await page.close().catch(ignore);
    // In CDP-attach mode this only disconnects; the dedicated Chrome and its profile stay running. In either
    // launch mode this closes the browser process this run started.
    await closeBrowser().catch(ignore);
}
/* eslint-enable compat/compat */
