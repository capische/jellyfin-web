/* eslint-disable compat/compat, @stylistic/max-statements-per-line, no-empty-function, sonarjs/cognitive-complexity, no-nested-ternary, sonarjs/no-nested-conditional, @typescript-eslint/no-unused-vars, sonarjs/no-dead-store, sonarjs/no-unused-vars, no-restricted-globals, @typescript-eslint/no-shadow, sonarjs/void-use, sonarjs/no-os-command-from-path, sonarjs/slow-regex -- a Node acceptance runner, not shipped code: the browserslist targets TV clients rather than this script, and the product lint profile does not fit a linear runner with page-side callbacks and deliberate no-op catch handlers */
/* global document, window, localStorage, ApiClient */
// Stock-versus-mod parity acceptance. See docs/jellyfinmod/PARITY.md for the plan this implements;
// every area, threshold and pass/fail rule below is that document's, not a fresh design.
//
// Unlike browser-review.mjs (a single-origin acceptance of mod surfaces), this run is two-origin and
// paired: `/web/` (stock, S) versus `/web-mod/` (mod, M) on the SAME server, SAME account, SAME data.
// It never launches a browser; it attaches over CDP to an already-running, already-signed-in Chrome,
// exactly as PARITY.md §1.2/§2 requires. No browser window may appear or take focus as a result of
// this script; CDP attach drives whatever window already exists.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { chromium } from 'playwright-core';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const gitRevShort = () => new Promise(resolve => {
    execFile('git', ['rev-parse', '--short', 'HEAD'], { cwd: scriptDir }, (error, stdout) => {
        resolve(error ? 'unknown (not a git checkout here)' : stdout.trim());
    });
});

// ---------------------------------------------------------------------------------------------
// Configuration and hard limits (PARITY.md §1.1, §1.2)
// ---------------------------------------------------------------------------------------------
const testUrl = new URL(process.env.JELLYFINMOD_TEST_URL ?? (() => { throw new Error('JELLYFINMOD_TEST_URL is required'); })());
// Production 8096 must stay unreachable from this script no matter what else changes.
const ISOLATED_PORTS = ['18096', '28096'];
if (!ISOLATED_PORTS.includes(testUrl.port)) {
    throw new Error('Only the isolated instances on ports ' + ISOLATED_PORTS.join(' and ') + ' are allowed');
}
const cdpUrl = process.env.JELLYFINMOD_CDP_URL ?? 'http://127.0.0.1:9223';
const testUser = process.env.JELLYFINMOD_TEST_USER ?? 'oleksii';
const outDir = process.env.JELLYFINMOD_PARITY_OUT ?? (() => { throw new Error('JELLYFINMOD_PARITY_OUT is required'); })();
const quick = process.env.JELLYFINMOD_PARITY_QUICK === 'true';
const sampleSize = Number(process.env.JELLYFINMOD_PARITY_SAMPLE ?? 12);
const skipPlayback = process.env.JELLYFINMOD_PARITY_SKIP_PLAYBACK === 'true';
const fixedTwoVersionId = process.env.JELLYFINMOD_PARITY_TWO_VERSION_ID;
const allowSkips = process.env.JELLYFINMOD_ALLOW_SKIPS === 'true';
// Not part of PARITY.md: an explicit, clearly-labelled escape hatch for a SUPPLEMENTARY diagnostic
// pass that keeps going past an A1 gate failure, so a real inventory defect doesn't also block every
// other area from ever being exercised. A run started this way NEVER counts as the gated acceptance
// result (fullAcceptance is forced false and the summary/report say so loudly).
const continuePastGate = process.env.JELLYFINMOD_PARITY_CONTINUE_PAST_GATE === 'true';

const baseS = new URL('/web/', testUrl).href;
const baseM = new URL('/web-mod/', testUrl).href;

await fs.mkdir(outDir, { recursive: true });
const networkDir = path.join(outDir, 'network');
const shotsDir = path.join(outDir, 'shots');
await fs.mkdir(networkDir, { recursive: true });
await fs.mkdir(shotsDir, { recursive: true });

// ---------------------------------------------------------------------------------------------
// Shared primitives, copied verbatim in spirit from browser-review.mjs (same names/semantics).
// ---------------------------------------------------------------------------------------------
const runStarted = Date.now();
const seconds = milliseconds => Math.round(milliseconds / 100) / 10;
const timings = {};
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
const step = async (name, work) => {
    const started = Date.now();
    try {
        const result = await work();
        timings[name] = seconds(Date.now() - started);
        console.log(`passed ${name} (${timings[name]}s)`);
        return result;
    } catch (error) {
        timings[name] = seconds(Date.now() - started);
        console.error(`failed ${name} (${timings[name]}s): ${error.message}`);
        throw error;
    }
};
const ignore = () => undefined;
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
/**
 * Playwright's actionability-gated `.click()` reliably hangs to its own 30s timeout on this app's
 * MUI buttons and custom `is="emby-button"`/actionSheet elements in this headless CDP context,
 * even though the element is independently confirmed visible, enabled and stable the whole time
 * (same class of flakiness browser-review.mjs already works around for `.btnManual`). Wait for the
 * element to be attached, then dispatch a native click directly on the DOM node, bypassing
 * Playwright's actionability pipeline for this one known-flaky interaction only.
 */
const nativeClick = async locator => {
    await locator.waitFor({ state: 'attached', timeout: 10000 });
    await locator.evaluate(node => node.click());
};
const poll = async (read, done, { timeout = 15000, interval = 250 } = {}) => {
    const deadline = Date.now() + timeout;
    let value = await read();
    while (!done(value) && Date.now() < deadline) {
        await sleep(interval);
        value = await read();
    }
    return value;
};
const idleTimeouts = {};

// ---------------------------------------------------------------------------------------------
// Rows, skips and diff reporting (PARITY.md §2.2, §11.2)
// ---------------------------------------------------------------------------------------------
/** One row per checked feature. verdict is one of PASS/FAIL/SKIPPED/SHARED-GAP/EXPECTED-FALLBACK/RECORDED/CLEANUP-FAILED. */
const rows = [];
const failuresDetail = [];
const skipped = [];
const knownGapsObserved = [];
const pushRow = (id, area, feature, stockResult, modResult, verdict, detail) => {
    rows.push({ id, area, feature, stock: stockResult, mod: modResult, verdict });
    if (verdict === 'FAIL' || verdict === 'CLEANUP-FAILED') failuresDetail.push({ id, feature, detail });
    if (verdict === 'SKIPPED') skipped.push({ id, feature, reason: detail });
    return verdict;
};
const normId = id => String(id ?? '').replace(/-/g, '').toLowerCase();
const normSet = ids => new Set(ids.map(normId));
/** Formats a set difference per §2.2: item by item, never as a bare count. */
const describeSetDiff = (label, stockIds, modIds, titleOf, urlOf) => {
    const s = normSet(stockIds);
    const m = normSet(modIds);
    const missingFromMod = [...s].filter(id => !m.has(id));
    const extraInMod = [...m].filter(id => !s.has(id));
    if (!missingFromMod.length && !extraInMod.length) return { equal: true, text: '' };
    const lines = [
        label,
        `stock: ${s.size} ids    mod: ${m.size} ids`,
        `missing from mod (${missingFromMod.length}):`,
        ...missingFromMod.map(id => `  ${id}  ${titleOf?.(id) ?? ''}  ${urlOf ? urlOf(id, 'mod') : ''}`),
        `extra in mod (${extraInMod.length}):`,
        ...extraInMod.map(id => `  ${id}  ${titleOf?.(id) ?? ''}  ${urlOf ? urlOf(id, 'mod') : ''}`)
    ];
    return { equal: false, text: lines.join('\n') };
};

/** Writes the human-readable report (§11.2). Called once, in the finally block, with whatever rows exist. */
async function writeMarkdownReport(summary) {
    const date = new Date().toISOString().slice(0, 10);
    const lines = [];
    lines.push('# Parity report — ' + date, '');
    lines.push(`Instance: <test-host>:${testUrl.port} · user: ${testUser} · web HEAD: ${summary.header.webHeadShort ?? 'unknown'} · plugin: ${summary.header.health?.Version ?? 'unknown'}`);
    lines.push(`Bundle: ${summary.header.health?.bundleId ?? 'unknown'} (${summary.header.health?.webCommit ?? 'unknown'}) · host: ${summary.header.health?.hostVersion ?? 'unknown'} · mode: ${summary.mode}${summary.aborted ? ' · ABORTED' : ''}`);
    lines.push(`Takeover before: ${JSON.stringify(summary.takeover.before)} · after: ${JSON.stringify(summary.takeover.after)}`, '');
    lines.push('| # | Area | Feature | Stock (/web) | Mod (/web-mod) | Verdict |');
    lines.push('|---|------|---------|--------------|----------------|---------|');
    for (const row of summary.rows) {
        const esc = value => String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 200);
        lines.push(`| ${esc(row.id)} | ${esc(row.area)} | ${esc(row.feature)} | ${esc(row.stock)} | ${esc(row.mod)} | ${row.verdict === 'FAIL' ? '**FAIL**' : row.verdict} |`);
    }
    lines.push('', '## Failures');
    if (!failuresDetail.length) lines.push('None.');
    for (const failure of failuresDetail) {
        lines.push(`### ${failure.id} — ${failure.feature}`);
        lines.push('```', String(failure.detail ?? '').slice(0, 4000), '```', '');
    }
    lines.push('## Skipped');
    if (!skipped.length) lines.push('None.');
    for (const item of skipped) lines.push(`- **${item.id}** ${item.feature}: ${item.reason}`);
    lines.push('', '## Known gaps observed (not failures)');
    lines.push('See PARITY.md §8.');
    for (const gap of knownGapsObserved) lines.push(`- ${gap}`);
    lines.push('', '## Cleanup');
    lines.push(`${userDataSnapshots.size} item(s) touched; cleanupFailed=${summary.cleanupFailed}. See userdata-before.json / userdata-after.json / restore-actions.json.`);
    lines.push('', '## Verdict summary');
    lines.push('```', JSON.stringify(summary.verdictCounts, null, 2), '```');
    await fs.writeFile(path.join(outDir, 'parity-report.md'), lines.join('\n') + '\n');
}

// ---------------------------------------------------------------------------------------------
// Get a browser. Two tiers, the same two browser-review.mjs offers, chosen by JELLYFINMOD_BROWSER:
//   - unset (default): attach over CDP to an already-running, already-signed-in Chrome (PARITY.md §1.2).
//   - "chromium" / "chrome": launch that browser here, headless, in a dedicated persistent profile
//     outside the repo. The workspace rules require the final acceptance to run on real Google Chrome
//     ("chrome"), which no attach tier can guarantee, so this run must be able to launch it itself.
// ---------------------------------------------------------------------------------------------
const browserTier = process.env.JELLYFINMOD_BROWSER ?? '';
if (browserTier && browserTier !== 'chromium' && browserTier !== 'chrome') {
    throw new Error('JELLYFINMOD_BROWSER must be "chromium" or "chrome", got ' + JSON.stringify(browserTier));
}
let browser;
let context;
const browserInfo = {};
if (!browserTier) {
    // Some Chrome builds throw "Browser context management is not supported" from inside
    // connectOverCDP when the browser has zero open targets at all; make sure at least one exists
    // first, using the plain CDP HTTP endpoint (no Playwright involved yet).
    try {
        const list = await fetch(new URL('/json/list', cdpUrl)).then(r => r.json());
        if (!list.some(target => target.type === 'page')) {
            await fetch(new URL('/json/new?about:blank', cdpUrl), { method: 'PUT' }).catch(() => fetch(new URL('/json/new?about:blank', cdpUrl)));
        }
    } catch { /* best effort; connectOverCDP below will surface any real problem */ }
    browser = await chromium.connectOverCDP(cdpUrl);
    context = browser.contexts()[0];
    if (!context) throw new Error('The dedicated Chrome at ' + cdpUrl + ' exposes no browser context');
    browserInfo.requestedTier = 'cdp-attach';
    browserInfo.cdpUrl = cdpUrl;
} else {
    const cacheRoot = process.platform === 'darwin' ?
        path.join(os.homedir(), 'Library', 'Caches') :
        (process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'));
    const profileDir = process.env.JELLYFINMOD_CHROME_PROFILE_DIR
        ?? path.join(cacheRoot, 'jellyfinmod-e2e', 'parity-profile-' + browserTier);
    const launchOptions = { headless: process.env.JELLYFINMOD_HEADED !== 'true' };
    if (browserTier === 'chrome') launchOptions.channel = 'chrome';
    try {
        context = await chromium.launchPersistentContext(profileDir, launchOptions);
    } catch (error) {
        if (browserTier !== 'chrome') throw error;
        // Say so rather than silently falling back to the bundled browser, which would quietly stop this
        // being the real-Chrome tier the run was asked for.
        const fallbackPath = process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : null;
        if (!fallbackPath) throw new Error('Playwright channel "chrome" failed and no known executablePath fallback applies here: ' + error.message);
        console.error('Playwright channel "chrome" failed (' + error.message + '); falling back to executablePath ' + fallbackPath);
        delete launchOptions.channel;
        launchOptions.executablePath = fallbackPath;
        context = await chromium.launchPersistentContext(profileDir, launchOptions);
    }
    browser = context.browser();
    browserInfo.requestedTier = browserTier;
    browserInfo.profileDir = profileDir;
    browserInfo.headless = launchOptions.headless;
}
browserInfo.name = context.browser()?.browserType()?.name() ?? null;
browserInfo.version = context.browser()?.version() ?? null;
console.log('browser: ' + JSON.stringify(browserInfo));

// Refuse to race another agent already driving one of the isolated ports.
const existingPages = context.pages();
const busy = [];
for (const existing of existingPages) {
    const url = existing.url();
    if (url.includes(testUrl.host) && !url.includes('/web/#/home') && url !== 'about:blank') {
        busy.push(url);
    }
}
if (busy.length > 1) {
    throw new Error('The dedicated Chrome already has tabs actively navigated on this host beyond an idle Home page: '
        + JSON.stringify(busy) + '. Stop and confirm with the user before racing another agent.');
}

const homePage = existingPages.find(p => p.url().startsWith(testUrl.origin)) ?? existingPages.find(p => p.url() === 'about:blank');
const pageS = homePage ?? await context.newPage();
const pageM = await context.newPage();
for (const p of [pageS, pageM]) p.setDefaultTimeout(30000);

console.log('parity: preamble ready; connected to ' + cdpUrl + ', server ' + testUrl.origin);

// ---------------------------------------------------------------------------------------------
// Per-page harness factory (PARITY.md §2: "every copied per-page helper becomes a factory taking a page").
// ---------------------------------------------------------------------------------------------
const manualLoginField = page => page.locator('#txtManualName');
const signInManually = async (page, username) => {
    const field = manualLoginField(page);
    if (!await field.isVisible().catch(() => false)) {
        const chooser = page.locator('.btnManual').first();
        if (await chooser.count()) {
            await chooser.waitFor({ state: 'attached', timeout: 15000 });
            await chooser.evaluate(node => node.click());
        }
        await field.waitFor({ state: 'visible', timeout: 15000 });
    }
    let previousValue;
    for (let attempt = 0; attempt < 15; attempt++) {
        const value = await field.inputValue().catch(() => '');
        if (value === previousValue) break;
        previousValue = value;
        await sleep(200);
    }
    await field.fill(username);
    if (await field.inputValue() !== username) {
        await sleep(300);
        await field.fill(username);
    }
    if (await field.inputValue() !== username) {
        throw new Error('The manual-login username field would not hold a value long enough to submit');
    }
    await page.locator('button:visible').filter({ hasText: 'Sign In' }).first().click();
};

function harness(page, base, label) {
    const inflight = new Set();
    const heldRequests = new Set();
    let lastNetworkActivity = Date.now();
    const allRequestUrls = [];
    /** Every request this page issued, kept for area C capture (bodies) and E-7 (id-leak) checks. */
    const requestLog = [];
    page.on('request', request => {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
            for (const pending of inflight) if (!heldRequests.has(pending)) inflight.delete(pending);
        }
        inflight.add(request);
        lastNetworkActivity = Date.now();
        allRequestUrls.push(request.url());
        requestLog.push({ method: request.method(), url: request.url(), postData: request.method() === 'POST' ? request.postData() : null, t: Date.now(), request });
    });
    for (const event of ['requestfinished', 'requestfailed']) {
        page.on(event, request => {
            inflight.delete(request);
            lastNetworkActivity = Date.now();
        });
    }
    const networkIdle = ({ quiet = 750, timeout = 20000 } = {}) => timed('networkIdle:' + label, async () => {
        const deadline = Date.now() + timeout;
        const pending = () => [...inflight].filter(request => !heldRequests.has(request));
        while (Date.now() < deadline && (pending().length || Date.now() - lastNetworkActivity < quiet)) await sleep(100);
        if (Date.now() >= deadline) {
            const stuck = pending().map(request => request.method() + ' ' + request.resourceType() + ' ' + new URL(request.url()).pathname);
            for (const key of stuck.length ? stuck : ['(continuous activity)']) idleTimeouts[key] = (idleTimeouts[key] ?? 0) + 1;
        }
        await sleep(100);
    });
    const appReady = async () => {
        await page.waitForFunction(() => !!window.ApiClient && !!document.querySelector('.page:not(.hide)'));
        await networkIdle();
    };
    const reload = ({ ignoreCache = false } = {}) => timed(ignoreCache ? 'hardReloads:' + label : 'softReloads:' + label, async () => {
        const cdp = await page.context().newCDPSession(page);
        const loaded = page.waitForEvent('load');
        await cdp.send('Page.reload', { ignoreCache });
        await loaded;
        await cdp.detach().catch(ignore);
        await appReady();
    });
    /**
     * `page.goto` to the exact URL the page is already on (same path AND hash) is a same-document
     * no-op in Chrome: no navigation fires, so a route that depends on remounting to refresh its
     * data (e.g. re-reading UserData after Stop lands back on the same #/details?id= hash) would
     * silently keep showing stale state. Detect that case and force a real reload instead.
     */
    const navigate = async url => {
        if (page.url() === url) {
            await reload();
            return;
        }
        await page.goto(url);
        await appReady();
    };
    const apiRequest = (route, method = 'GET', body) => page.evaluate(async request => {
        const options = { url: ApiClient.getUrl(request.path), type: request.method };
        if (request.body !== undefined) {
            options.data = JSON.stringify(request.body);
            options.contentType = 'application/json';
        }
        const response = await ApiClient.ajax(options, true);
        const text = await response.text();
        return { status: response.status, body: text ? JSON.parse(text) : null };
    }, { path: route, method, body });
    const activeMatches = selector => page.evaluate(match => document.activeElement?.matches(match) ?? false, selector);
    const pressKey = async key => {
        const before = await page.evaluateHandle(() => document.activeElement);
        await page.keyboard.press(key);
        await page.waitForFunction(previous => document.activeElement !== previous, before, { timeout: 1000 }).catch(ignore);
        await before.dispose();
    };
    const enterFocused = async () => {
        if (!await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement !== document.body)) {
            throw new Error('No focused control was available for activation on ' + label);
        }
        await page.keyboard.press('Enter');
    };
    /**
     * What a UI actually rendered, as a SET of normalised ids (PARITY.md §2.1, primitive 2).
     *
     * Only what is VISIBLE counts. This is a single-page app: navigating from the library grid to a
     * detail page leaves the grid's cards in the DOM, merely hidden, so an unfiltered query on a
     * detail page returns the previous screen's series cards. That made A3 compare two tabs' stale
     * grids (each left on a different page) and report dozens of "episode set" differences that were
     * really series ids. An element with no client rects is not rendered.
     */
    const shownIds = () => page.evaluate(() => Array.from(document.querySelectorAll('.card[data-id], [data-id].listItem'))
        .filter(node => node.getClientRects().length > 0)
        .map(node => node.dataset.id.replace(/-/g, '').toLowerCase()));
    return {
        page, base, label, inflight, heldRequests, allRequestUrls, requestLog,
        networkIdle, appReady, navigate, reload, apiRequest, pressKey, enterFocused, activeMatches, shownIds,
        get lastNetworkActivity() { return lastNetworkActivity; },
        signIn: username => signInManually(page, username)
    };
}

const S = harness(pageS, baseS, 'S');
const M = harness(pageM, baseM, 'M');

// ---------------------------------------------------------------------------------------------
// User-data snapshot and restoration (PARITY.md §7) — mandatory, and must survive an abort.
// ---------------------------------------------------------------------------------------------
let userId;
const userDataSnapshots = new Map(); // itemId -> UserData object
const restoreRoute = { kind: null }; // recorded once discovered, per §7 "discover it once, record which was used"

const snapshotUserData = async itemId => {
    const result = await S.apiRequest('Items/' + encodeURIComponent(itemId) + '?userId=' + encodeURIComponent(userId));
    const data = result.body?.UserData ?? null;
    userDataSnapshots.set(itemId, data);
    await fs.writeFile(path.join(outDir, 'userdata-before.json'), JSON.stringify(Object.fromEntries(userDataSnapshots), null, 2));
    return data;
};

/** Applies a UserData mutation through the app's own client, discovering the route once. */
const setUserData = async (page, itemId, mutation) => {
    return page.evaluate(async ({ id, uid, mutation: m }) => {
        const calls = [];
        if (m.played !== undefined) {
            calls.push(m.played ? ApiClient.markPlayed(uid, id, new Date()) : ApiClient.markUnplayed(uid, id));
        }
        if (m.favorite !== undefined) {
            calls.push(ApiClient.updateFavoriteStatus(uid, id, m.favorite));
        }
        if (m.positionTicks !== undefined) {
            // The app's own client route for writing a resume point outside of real playback: the same
            // Sessions/Playing/Progress report a paused player would send.
            calls.push(ApiClient.reportPlaybackProgress({ ItemId: id, PositionTicks: m.positionTicks, IsPaused: true, PlayMethod: 'DirectPlay' }));
        }
        await Promise.all(calls);
    }, { id: itemId, uid: userId, mutation });
};

/**
 * Restores one item's UserData to its exact snapshot. `setUserData`'s app-client calls
 * (markPlayed/markUnplayed/reportPlaybackProgress) are the right shape for SIMULATING a user
 * action, but their side effects on `PlayCount`/`LastPlayedDate` don't necessarily land back on
 * the pre-run number (markPlayed increments it; real playback during the run may have incremented
 * it further) — restoration needs an exact overwrite, not another action. §7 says to read the
 * direct route from this server's own openapi.json rather than guess: on this server it is
 * `POST /UserItems/{itemId}/UserData`, whose body accepts every field this run can have touched
 * (Played, PlayCount, IsFavorite, PlaybackPositionTicks, LastPlayedDate, Rating) as an exact set,
 * not a toggle. Discovered and recorded once, then reused.
 */
const restoreUserData = async itemId => {
    const before = userDataSnapshots.get(itemId);
    if (before === undefined) return { itemId, skipped: true };
    const current = (await S.apiRequest('Items/' + encodeURIComponent(itemId) + '?userId=' + encodeURIComponent(userId))).body?.UserData ?? null;
    if (before === null) return { itemId, note: 'no prior UserData object; nothing to restore' };
    if (!restoreRoute.kind) {
        const spec = await S.apiRequest('api-docs/openapi.json');
        const hasDirectRoute = !!spec.body?.paths?.['/UserItems/{itemId}/UserData']?.post;
        restoreRoute.kind = hasDirectRoute ? 'POST /UserItems/{itemId}/UserData (exact overwrite)' : 'app-client markPlayed/markUnplayed/updateFavoriteStatus/reportPlaybackProgress (side-effect based, best effort)';
        restoreRoute.direct = hasDirectRoute;
    }
    if (restoreRoute.direct) {
        const payload = {
            Played: !!before.Played,
            PlayCount: before.PlayCount ?? 0,
            IsFavorite: !!before.IsFavorite,
            PlaybackPositionTicks: before.PlaybackPositionTicks ?? 0,
            LastPlayedDate: before.LastPlayedDate ?? null,
            Rating: before.Rating ?? null
        };
        await S.apiRequest('UserItems/' + encodeURIComponent(itemId) + '/UserData', 'POST', payload);
    } else {
        await setUserData(pageS, itemId, {
            played: !!before.Played,
            favorite: !!before.IsFavorite,
            positionTicks: before.PlaybackPositionTicks ?? 0
        });
    }
    return { itemId, from: current, to: before, route: restoreRoute.kind };
};

const restoreAllUserData = async () => {
    const results = [];
    for (const itemId of userDataSnapshots.keys()) {
        results.push(await restoreUserData(itemId).catch(error => ({ itemId, error: error.message })));
    }
    return results;
};

const verifyRestoration = async () => {
    const after = {};
    const mismatches = [];
    for (const [itemId, before] of userDataSnapshots) {
        const current = (await S.apiRequest('Items/' + encodeURIComponent(itemId) + '?userId=' + encodeURIComponent(userId))).body?.UserData ?? null;
        after[itemId] = current;
        if (before === null) continue;
        const fields = ['Played', 'PlayCount', 'PlaybackPositionTicks', 'IsFavorite', 'Rating', 'PlayedPercentage'];
        for (const field of fields) {
            const beforeValue = before[field];
            const currentValue = current?.[field];
            // Allow small resume-position drift only if both are effectively "no position".
            if (field === 'PlaybackPositionTicks' && !beforeValue && !currentValue) continue;
            if (beforeValue !== currentValue) mismatches.push({ itemId, field, expected: beforeValue, observed: currentValue });
        }
    }
    await fs.writeFile(path.join(outDir, 'userdata-after.json'), JSON.stringify({ after, mismatches }, null, 2));
    return mismatches;
};

// ---------------------------------------------------------------------------------------------
// The /web takeover toggle (environment fact, not in PARITY.md — required to get the A/B this run needs).
// ---------------------------------------------------------------------------------------------
const getInterfaceSettings = () => S.apiRequest('JellyfinMod/Settings/Interface');
const setTakeover = enabled => S.apiRequest('JellyfinMod/Settings/Interface', 'PATCH', { TakeoverEnabled: enabled });

// ---------------------------------------------------------------------------------------------
// Main run
// ---------------------------------------------------------------------------------------------
const report = { header: {}, takeover: {} };
let originalLayoutS; let originalLayoutM;
let aborted = false;
/** True the moment preflight or A1 (PARITY.md's two hard gates) fails, regardless of continuePastGate. */
let gateFailed = false;
const failGate = () => { gateFailed = true; aborted = !continuePastGate; };
let summarized = false;
let moviesViewId; let showsViewId;

try { // OUTER — guarantees cleanup (§7 restore, hygiene, report) even on an unexpected throw.
    try {
        let takeoverBefore;
        await step('setup: read and disable /web takeover', async () => {
        // Establish a session on pageS first (against whatever /web currently serves) so the API call
        // to flip the takeover has a signed-in ApiClient to run through.
            await pageS.goto(baseS);
            await pageS.waitForFunction(() => !!window.ApiClient, undefined, { timeout: 30000 });
            if (await pageS.evaluate(() => window.location.hash.includes('/login') || window.location.hash.includes('/selectuser'))) {
                await S.signIn(testUser);
                await pageS.waitForFunction(() => !window.location.hash.includes('/login'), undefined, { timeout: 15000 }).catch(ignore);
            }
            await S.appReady();
            takeoverBefore = (await getInterfaceSettings()).body;
            report.takeover.before = { TakeoverEnabled: takeoverBefore?.TakeoverEnabled, BundleId: takeoverBefore?.BundleId };
            if (takeoverBefore?.TakeoverEnabled !== true) {
                throw new Error('Expected the /web takeover to be ON at the start of this run (environment note said so); found ' + JSON.stringify(takeoverBefore));
            }
            const patched = await setTakeover(false);
            if (patched.status >= 300) throw new Error('PATCH JellyfinMod/Settings/Interface {TakeoverEnabled:false} failed: ' + JSON.stringify(patched));
        });

        await step('setup: navigate both tabs and sign in', async () => {
        // Reload pageS now that /web serves stock (takeover off); this is a fresh document, not the
        // mod bundle that was cached in memory from the pre-toggle load.
            await S.navigate(baseS);
            if (await pageS.evaluate(() => window.location.hash.includes('/login') || window.location.hash.includes('/selectuser'))) {
                await S.signIn(testUser);
                await pageS.waitForFunction(() => !window.location.hash.includes('/login'), undefined, { timeout: 15000 }).catch(ignore);
                await S.appReady();
            }
            await M.navigate(baseM);
            if (await pageM.evaluate(() => window.location.hash.includes('/login') || window.location.hash.includes('/selectuser'))) {
                await M.signIn(testUser);
                await pageM.waitForFunction(() => !window.location.hash.includes('/login'), undefined, { timeout: 15000 }).catch(ignore);
                await M.appReady();
            }
            originalLayoutS = await pageS.evaluate(() => localStorage.getItem('layout'));
            originalLayoutM = await pageM.evaluate(() => localStorage.getItem('layout'));
        });

        // -----------------------------------------------------------------------------------------
        // Preflight (§1.4) — a hard gate, abort on failure.
        // -----------------------------------------------------------------------------------------
        await step('preflight', async () => {
            const userIdS = await pageS.evaluate(() => window.ApiClient.getCurrentUserId());
            const userIdM = await pageM.evaluate(() => window.ApiClient.getCurrentUserId());
            if (!userIdS || userIdS !== userIdM) {
                throw new Error('PREFLIGHT GATE: pageS and pageM are not signed in as the same user: ' + JSON.stringify({ userIdS, userIdM }));
            }
            userId = userIdS;
            const userS = await S.apiRequest('Users/' + userId);
            const userM = await M.apiRequest('Users/' + userId);
            if (userS.body?.Name !== testUser || userM.body?.Name !== testUser) {
                throw new Error('PREFLIGHT GATE: signed-in user is not ' + testUser + ': ' + JSON.stringify({ S: userS.body?.Name, M: userM.body?.Name }));
            }

            const servedS = await pageS.evaluate(() => ({
                meta: document.querySelector('meta[name="jellyfinmod-web"]')?.content ?? null,
                assetRoot: window.__jfmodAssetRoot ?? null,
                bundle: window.__jfmodBundle === true
            }));
            const servedM = await pageM.evaluate(() => ({
                meta: document.querySelector('meta[name="jellyfinmod-web"]')?.content ?? null,
                assetRoot: window.__jfmodAssetRoot ?? null,
                bundle: window.__jfmodBundle === true
            }));
            report.header.servedS = servedS;
            report.header.servedM = servedM;
            if (servedS.bundle) {
                throw new Error('PREFLIGHT GATE: /web still serves the mod bundle after disabling the takeover: ' + JSON.stringify(servedS));
            }
            if (!servedM.bundle) {
                throw new Error('PREFLIGHT GATE: /web-mod does not serve the mod bundle: ' + JSON.stringify(servedM));
            }

            const health = await S.apiRequest('JellyfinMod/Health');
            report.header.health = {
                Version: health.body?.Version,
                bundleId: health.body?.Web?.BundleId,
                webCommit: health.body?.Web?.WebCommit,
                hostVersion: health.body?.Web?.HostVersion,
                Capabilities: health.body?.Capabilities
            };

            report.header.webHeadShort = await gitRevShort();

            // No request from the mod tab should touch /web/ (the S3 rooting rule).
            const modAssetLeaks = M.allRequestUrls.filter(url => {
                try {
                    const parsed = new URL(url);
                    return parsed.host === testUrl.host && parsed.pathname.startsWith('/web/');
                } catch { return false; }
            });
            if (modAssetLeaks.length) {
                throw new Error('PREFLIGHT GATE: the mod tab requested assets under /web/: ' + JSON.stringify(modAssetLeaks.slice(0, 10)));
            }

            const viewsS = await S.apiRequest('UserViews');
            const viewsM = await M.apiRequest('UserViews');
            const idsS = (viewsS.body?.Items ?? []).map(i => i.Id);
            const idsM = (viewsM.body?.Items ?? []).map(i => i.Id);
            if (JSON.stringify(idsS) !== JSON.stringify(idsM)) {
                throw new Error('PREFLIGHT GATE: UserViews differ in id/order between stock and mod: ' + JSON.stringify({ idsS, idsM }));
            }
            report.header.userViews = (viewsS.body?.Items ?? []).map(i => ({ Id: i.Id, Name: i.Name, CollectionType: i.CollectionType }));
            moviesViewId = report.header.userViews.find(v => v.CollectionType === 'movies')?.Id;
            showsViewId = report.header.userViews.find(v => v.CollectionType === 'tvshows')?.Id;
            if (!moviesViewId || !showsViewId) throw new Error('PREFLIGHT GATE: could not resolve Movies/Shows view ids from UserViews');

            const entriesBefore = await S.apiRequest('JellyfinMod/Entries?limit=200');
            await fs.writeFile(path.join(outDir, 'entries-before.json'), JSON.stringify(entriesBefore.body ?? { items: [] }, null, 2));

            pushRow('preflight', 'Preflight', 'Same user, same views, bundle correctly rooted', 'ok', 'ok', 'PASS');
        });
    } catch (error) {
        failGate();
        console.error('ABORT: ' + error.message);
        pushRow('abort', 'Preflight', error.message.startsWith('PREFLIGHT') ? 'Preflight gate' : 'Setup', 'n/a', 'n/a', 'FAIL', error.message);
    }

    // =================================================================================================
    // Area A — inventory parity (PARITY.md §3)
    // =================================================================================================
    /** Paginates an Items query to exhaustion, returning the full array. */
    const pageAllItems = async (harnessSide, query) => {
        const items = [];
        let startIndex = 0;
        const limit = 200;
        for (;;) {
            const result = await harnessSide.apiRequest(query + '&Limit=' + limit + '&StartIndex=' + startIndex);
            const batch = result.body?.Items ?? [];
            items.push(...batch);
            const total = result.body?.TotalRecordCount ?? items.length;
            startIndex += batch.length;
            if (startIndex >= total || !batch.length) break;
        }
        return items;
    };

    /**
 * Forces full coverage of an item grid, per PARITY.md A2 step 2: scroll to load everything if the
 * view lazy-loads, or walk every page (upstream's `.btnNextPage` pager, libraryBrowser.js) and union
 * the ids if it paginates instead. Returns the UNION of ids seen across however many pages/scrolls
 * it took, and which mode was used.
 */
    const forceFullLazyLoad = async (harnessSide, { timeout = 60000 } = {}) => {
        const union = new Set();
        let mode = 'lazy-load';
        // `.btnNextPage` is the legacy pager's button; the modern route renders a MUI button whose only
        // stable identity is its accessible name. Accept either, or this walks nothing and silently
        // reports one page as if it were the whole library.
        const nextButton = harnessSide.page.locator('.btnNextPage, button[title="Next"], button[aria-label="Next"]').first();
        if (await nextButton.count().catch(() => 0)) {
            mode = 'paged';
            for (let guard = 0; guard < 50; guard++) {
                await harnessSide.networkIdle({ quiet: 500, timeout: 8000 });
                for (const id of await harnessSide.shownIds()) union.add(id);
                const disabled = await nextButton.evaluate(node => node.disabled || node.classList.contains('hide') || node.hasAttribute('disabled')).catch(() => true);
                if (disabled) break;
                await nextButton.evaluate(node => node.click()).catch(() => {});
                await sleep(150);
            }
            // Walking the pager leaves the grid on its LAST page, and the route remembers that position,
            // so the next step to look at this tab would measure page N instead of the library. Walk back.
            const previousButton = harnessSide.page.locator('.btnPreviousPage, button[title="Previous"], button[aria-label="Previous"]').first();
            if (await previousButton.count().catch(() => 0)) {
                for (let guard = 0; guard < 50; guard++) {
                    const disabled = await previousButton.evaluate(node => node.disabled || node.classList.contains('hide') || node.hasAttribute('disabled')).catch(() => true);
                    if (disabled) break;
                    await previousButton.evaluate(node => node.click()).catch(() => {});
                    await harnessSide.networkIdle({ quiet: 500, timeout: 8000 });
                }
            }
            return { ids: [...union], mode };
        }

        // No pager control found: fall back to scroll-to-load, in case a route uses true infinite scroll.
        const deadline = Date.now() + timeout;
        let previousCount = -1;
        let stableRounds = 0;
        while (Date.now() < deadline && stableRounds < 2) {
            await harnessSide.page.evaluate(() => {
                const container = document.querySelector('.itemsContainer, .scrollFrameY, .pageTabContent:not(.hide)') ?? document.scrollingElement;
                container?.scrollTo?.(0, container.scrollHeight);
                window.scrollTo(0, document.body.scrollHeight);
            });
            await harnessSide.networkIdle({ quiet: 500, timeout: 8000 });
            const ids = await harnessSide.shownIds();
            if (ids.length === previousCount) stableRounds++; else stableRounds = 0;
            previousCount = ids.length;
        }
        return { ids: await harnessSide.shownIds(), mode };
    };

    await step('A1: library views and totals', async () => {
        if (aborted) return;
        try {
            for (const [name, viewId, type] of [['Movies', moviesViewId, 'Movie'], ['TV', showsViewId, 'Series']]) {
                const totalS = (await S.apiRequest(`Items?ParentId=${viewId}&Recursive=true&IncludeItemTypes=${type}&Limit=0`)).body?.TotalRecordCount;
                const totalM = (await M.apiRequest(`Items?ParentId=${viewId}&Recursive=true&IncludeItemTypes=${type}&Limit=0`)).body?.TotalRecordCount;
                if (totalS !== totalM) {
                    failGate();
                    pushRow('A1', 'Inventory', name + ' total count (API, both tabs)', totalS, totalM, 'FAIL', `TotalRecordCount differs: stock ${totalS} vs mod ${totalM}`);
                    return;
                }
                pushRow('A1', 'Inventory', name + ' total count (API, both tabs)', totalS, totalM, 'PASS');
            }

            // The grid states its own total as "1-100 of 105". The legacy route puts that in `.paging`;
            // the modern (MUI) route, which is what Movies and TV render here, puts it in a plain element
            // with no such class, so reading only `.paging` returned null and the caller then fell back to
            // counting the cards of page ONE — 100 against an API total of 105, which reads as five lost
            // series when the five are simply on page two. Read the phrase wherever it is rendered.
            const gridTotal = async harnessSide => harnessSide.page.evaluate(() => {
                const paging = document.querySelector('.paging, .listPaging');
                const scoped = paging?.textContent?.match(/of\s+([\d,]+)/i);
                if (scoped) return Number(scoped[1].replace(/,/g, ''));
                const anywhere = document.body.innerText.match(/\b\d[\d,]*\s*[-\u2013]\s*\d[\d,]*\s+of\s+([\d,]+)\b/i);
                return anywhere ? Number(anywhere[1].replace(/,/g, '')) : null;
            });
            for (const [name, viewId, type, route] of [['Movies', moviesViewId, 'Movie', '#/movies'], ['TV', showsViewId, 'Series', '#/tv']]) {
                await S.navigate(baseS + route + '?topParentId=' + viewId);
                await M.navigate(baseM + route + '?topParentId=' + viewId);
                await S.networkIdle();
                await M.networkIdle();
                let gridS = await gridTotal(S);
                let gridM = await gridTotal(M);
                if (gridS === null) gridS = (await forceFullLazyLoad(S)).ids.length;
                if (gridM === null) gridM = (await forceFullLazyLoad(M)).ids.length;
                const apiTotal = (await S.apiRequest(`Items?ParentId=${viewId}&Recursive=true&IncludeItemTypes=${type}&Limit=0`)).body?.TotalRecordCount;
                if (gridS !== gridM || (typeof gridS === 'number' && typeof apiTotal === 'number' && gridS !== apiTotal)) {
                    failGate();
                    pushRow('A1', 'Inventory', name + ' grid reported total', gridS, gridM, 'FAIL',
                        `stock grid total=${gridS} mod grid total=${gridM} api total=${apiTotal}`);
                    return;
                }
                pushRow('A1', 'Inventory', name + ' grid reported total', gridS, gridM, 'PASS');
            }
        } catch (error) {
            failGate();
            pushRow('A1', 'Inventory', 'A1 gate', 'n/a', 'n/a', 'FAIL', error.message);
        }
    });

    /** A2 reference sets, kept module-level so B0's sample can reuse them. */
    const a2 = { movies: { ref: [], s: [], m: [] }, tv: { ref: [], s: [], m: [] } };

    if (!aborted) {
        await step('A2: item id sets (Movies, TV)', async () => {
            try {
                for (const [key, viewId, type, route] of [
                    ['movies', moviesViewId, 'Movie', '#/movies'],
                    ['tv', showsViewId, 'Series', '#/tv']
                ]) {
                    const ref = await pageAllItems(S, `Items?ParentId=${viewId}&Recursive=true&IncludeItemTypes=${type}&SortBy=SortName&SortOrder=Ascending&Fields=ProviderIds`);
                    await S.navigate(baseS + route + '?topParentId=' + viewId);
                    const { ids: idsS, mode: modeS } = await forceFullLazyLoad(S);
                    await M.navigate(baseM + route + '?topParentId=' + viewId);
                    const { ids: idsM, mode: modeM } = await forceFullLazyLoad(M);
                    const refIds = ref.map(i => i.Id);
                    a2[key] = { ref, s: idsS, m: idsM };

                    const titleOf = id => ref.find(i => normId(i.Id) === id)?.Name ?? '(unknown)';
                    const urlOf = (id, side) => (side === 'mod' ? baseM : baseS) + '#/details?id=' + id;
                    const diffSM = describeSetDiff(`A2 ${key} grid: stock vs mod`, idsS, idsM, titleOf, urlOf);
                    const diffSRef = describeSetDiff(`A2 ${key}: stock vs reference API`, idsS, refIds, titleOf, urlOf);
                    const diffMRef = describeSetDiff(`A2 ${key}: mod vs reference API`, idsM, refIds, titleOf, urlOf);

                    const sharedGapIds = refIds.filter(id => !normSet(idsS).has(normId(id)) && !normSet(idsM).has(normId(id)));
                    if (sharedGapIds.length) {
                        for (const id of sharedGapIds) {
                            pushRow('A2', 'Inventory', `${key} item present in API but neither UI: ${titleOf(id)}`, 'absent', 'absent', 'SHARED-GAP', id);
                        }
                    }

                    if (diffSM.equal) {
                        pushRow('A2', 'Inventory', `${key} id set (stock vs mod), lazy-load mode ${modeS}/${modeM}`, `${idsS.length} ids`, `${idsM.length} ids`, 'PASS');
                    } else {
                        pushRow('A2', 'Inventory', `${key} id set (stock vs mod)`, `${idsS.length} ids`, `${idsM.length} ids`, 'FAIL', diffSM.text);
                    }
                    if (!diffSRef.equal) pushRow('A2', 'Inventory', `${key} id set (stock vs API)`, `${idsS.length} ids`, `${refIds.length} ids (ref)`, 'FAIL', diffSRef.text);
                    if (!diffMRef.equal) pushRow('A2', 'Inventory', `${key} id set (mod vs API)`, `${idsM.length} ids`, `${refIds.length} ids (ref)`, 'FAIL', diffMRef.text);
                }
            } catch (error) {
                pushRow('A2', 'Inventory', 'A2 id sets', 'n/a', 'n/a', 'FAIL', error.message);
            }
        });
    }

    // A3 — seasons and episodes. §9.3 escape hatch: sample like B0 once the TV library exceeds ~40 series.
    const A3_SERIES_CAP = 40;
    if (!aborted) {
        await step('A3: seasons and episodes', async () => {
            try {
                const allSeries = [...a2.tv.ref].sort((x, y) => x.Id.localeCompare(y.Id));
                let sample = allSeries;
                if (allSeries.length > A3_SERIES_CAP) {
                    const step_ = allSeries.length / A3_SERIES_CAP;
                    sample = Array.from({ length: A3_SERIES_CAP }, (_, i) => allSeries[Math.floor(i * step_)]);
                    knownGapsObserved.push(`A3 sampled ${sample.length} of ${allSeries.length} series (§9.3 escape hatch: library exceeds ~40 series) rather than exhaustive coverage.`);
                }
                let seasonFails = 0; let episodeFails = 0;
                for (const series of sample) {
                    const seasonsRef = (await S.apiRequest(`Shows/${series.Id}/Seasons`)).body?.Items ?? [];
                    const seasonRefIds = seasonsRef.map(s => s.Id);
                    // The first season by index, as the reference to check the default-open season against.
                    // `Shows/{id}/Episodes` does not return a season id on its items without an explicit,
                    // version-sensitive `Fields` request (verified live: a plain call omits it), so the
                    // season's own episodes are fetched with the `seasonId` filter instead — a query the
                    // server accepts directly and confirmed live to return exactly that season's episodes.
                    const sortedSeasonsRef = [...seasonsRef].sort((a, b) => (a.IndexNumber ?? 0) - (b.IndexNumber ?? 0));
                    const firstSeasonRef = sortedSeasonsRef[0];
                    const firstSeasonEpisodesRef = firstSeasonRef
                        ? ((await S.apiRequest(`Shows/${series.Id}/Episodes?seasonId=${firstSeasonRef.Id}`)).body?.Items ?? []).map(e => e.Id)
                        : [];

                    // Current UI (2026-09): the series detail page renders each season as an ordinary card
                    // (`.card[data-id][data-type="Season"]`) inside `#childrenContent`, not as `.seasonTabs`/
                    // `.selectSeason` (that markup no longer exists — it read 0 on both sides, every time).
                    // Opening a season navigates to its own `#/details?id=` page, where episodes render as
                    // `[data-id].listItem` rows (already covered by shownIds()) rather than as cards.
                    const collectRendered = async harnessSide => {
                        await harnessSide.navigate(harnessSide.base + '#/details?id=' + series.Id);
                        await harnessSide.networkIdle();
                        const seasonIds = await harnessSide.page.evaluate(() => Array.from(document.querySelectorAll('.card[data-id][data-type="Season"]'))
                            .filter(node => node.getClientRects().length > 0)
                            .map(node => node.dataset.id.replace(/-/g, '').toLowerCase()));
                        let episodeIds = [];
                        if (firstSeasonRef) {
                            await harnessSide.navigate(harnessSide.base + '#/details?id=' + firstSeasonRef.Id);
                            await harnessSide.networkIdle();
                            // Not shownIds(): a season page also renders its Cast & Crew as `.card[data-id]`
                            // person cards alongside the `[data-id].listItem` episode rows, so the generic,
                            // page-wide selector doubles the count (verified live: Ahsoka season 1 read 16 —
                            // 8 episodes + 8 cast — against an API count of 8). Scope to Episode rows only.
                            episodeIds = await harnessSide.page.evaluate(() => Array.from(document.querySelectorAll('[data-id][data-type="Episode"]'))
                                .filter(node => node.getClientRects().length > 0)
                                .map(node => node.dataset.id.replace(/-/g, '').toLowerCase()));
                        }
                        return { seasonIds, episodeIds };
                    };
                    const renderedS = await collectRendered(S);
                    const renderedM = await collectRendered(M);

                    const seasonDiff = describeSetDiff(`A3 ${series.Name} season set`, renderedS.seasonIds, renderedM.seasonIds);
                    if (!seasonDiff.equal || normSet(renderedS.seasonIds).size !== normSet(seasonRefIds).size) {
                        seasonFails++;
                        pushRow('A3', 'Seasons/Episodes', `${series.Name} (${series.Id}) season set`, `${renderedS.seasonIds.length}`, `${renderedM.seasonIds.length}`, 'FAIL',
                            seasonDiff.text || `stock/mod season count differs from API (${seasonRefIds.length})`);
                    }
                    const episodeDiff = describeSetDiff(`A3 ${series.Name} season 1 episode set`, renderedS.episodeIds, renderedM.episodeIds);
                    const episodeVsRef = describeSetDiff(`A3 ${series.Name} season 1 episode set vs API`, renderedS.episodeIds, firstSeasonEpisodesRef);
                    if (!episodeDiff.equal || (firstSeasonRef && !episodeVsRef.equal)) {
                        episodeFails++;
                        pushRow('A3', 'Seasons/Episodes', `${series.Name} (${series.Id}) episode set (season 1)`, `${renderedS.episodeIds.length}`, `${renderedM.episodeIds.length}`, 'FAIL',
                            [episodeDiff.text, episodeVsRef.text].filter(Boolean).join('\n\n') || `stock/mod episode count differs from API (${firstSeasonEpisodesRef.length})`);
                    }
                }
                if (!seasonFails && !episodeFails) {
                    pushRow('A3', 'Seasons/Episodes', `Seasons and episodes for ${sample.length} series`, 'match', 'match', 'PASS');
                }
            } catch (error) {
                pushRow('A3', 'Seasons/Episodes', 'A3', 'n/a', 'n/a', 'FAIL', error.message);
            }
        });
    }

    // A4 — sort orders
    if (!aborted) {
        await step('A4: sort orders', async () => {
            try {
                // Upstream's Sort control (SortButton.tsx) is a MUI popover: a button titled "Sort" opens a
                // MenuList of translated labels; clicking the already-selected label toggles asc/desc.
                const applySort = async (harnessSide, label, desiredOrder) => {
                    const openMenuItem = async () => {
                        await nativeClick(harnessSide.page.locator('button[title="Sort" i]').first());
                        const item = harnessSide.page.locator('.MuiMenuItem-root', { hasText: label }).first();
                        await item.waitFor({ state: 'visible', timeout: 5000 });
                        return item;
                    };
                    let item = await openMenuItem();
                    const upCount = await item.locator('svg[data-testid="ArrowUpwardIcon"]').count();
                    const downCount = await item.locator('svg[data-testid="ArrowDownwardIcon"]').count();
                    const wasSelected = upCount > 0 || downCount > 0;
                    const currentOrder = upCount > 0 ? 'Ascending' : (downCount > 0 ? 'Descending' : null);
                    await nativeClick(item); // unselected -> Ascending; selected -> toggles
                    await harnessSide.networkIdle();
                    const resultingOrder = wasSelected ? (currentOrder === 'Ascending' ? 'Descending' : 'Ascending') : 'Ascending';
                    if (resultingOrder !== desiredOrder) {
                        item = await openMenuItem();
                        await nativeClick(item);
                        await harnessSide.networkIdle();
                    }
                };
                const sorts = quick ?
                    [{ sortBy: 'SortName', sortOrder: 'Ascending', label: 'Name' }] :
                    [
                        { sortBy: 'SortName', sortOrder: 'Ascending', label: 'Name' },
                        { sortBy: 'DateCreated', sortOrder: 'Descending', label: 'Date Added' },
                        { sortBy: 'PremiereDate', sortOrder: 'Descending', label: 'Release Date' },
                        { sortBy: 'CommunityRating', sortOrder: 'Descending', label: 'Community Rating' }
                    ];
                for (const { sortBy, sortOrder, label } of sorts) {
                    const refResult = await S.apiRequest(`Items?ParentId=${moviesViewId}&Recursive=true&IncludeItemTypes=Movie&SortBy=${sortBy}&SortOrder=${sortOrder}&Limit=60&Fields=SortName`);
                    const refSeq = (refResult.body?.Items ?? []).map(i => normId(i.Id));

                    const readSeq = async harnessSide => {
                        await harnessSide.navigate(harnessSide.base + '#/movies?topParentId=' + moviesViewId);
                        await harnessSide.networkIdle();
                        await applySort(harnessSide, label, sortOrder);
                        const { ids } = await forceFullLazyLoad(harnessSide);
                        return ids.slice(0, 60);
                    };
                    const seqS = await readSeq(S);
                    const seqM = await readSeq(M);
                    let divergeIndex = -1;
                    for (let i = 0; i < Math.max(seqS.length, seqM.length); i++) {
                        if (seqS[i] !== seqM[i]) { divergeIndex = i; break; }
                    }
                    if (divergeIndex === -1) {
                        pushRow('A4', 'Sort orders', `Movies sort: ${label} ${sortOrder}`, `${seqS.length} ids`, `${seqM.length} ids`, 'PASS');
                    } else {
                        pushRow('A4', 'Sort orders', `Movies sort: ${label} ${sortOrder}`, seqS[divergeIndex] ?? '(end)', seqM[divergeIndex] ?? '(end)', 'FAIL',
                            `First divergence at index ${divergeIndex}: stock=${seqS[divergeIndex]} mod=${seqM[divergeIndex]} api-ref=${refSeq[divergeIndex]}`);
                    }
                }
            } catch (error) {
                pushRow('A4', 'Sort orders', 'A4', 'n/a', 'n/a', 'FAIL', error.message);
            }
        });
    }

    // A5 — filters (FilterButton.tsx: a MUI popover of accordions; each section unmounts when collapsed).
    const openFilterAccordion = async (harnessSide, accordionId) => {
        await nativeClick(harnessSide.page.locator('button[title="Filter" i]').first());
        const summary = harnessSide.page.locator('#' + accordionId);
        await summary.waitFor({ state: 'visible', timeout: 8000 });
        const isExpanded = await summary.evaluate(el => el.closest('.MuiAccordion-root')?.classList.contains('Mui-expanded'));
        if (!isExpanded) await nativeClick(summary);
    };
    const clickFilterCheckbox = async (harnessSide, checkboxText) => {
        const label = harnessSide.page.locator('.MuiAccordionDetails-root label', { hasText: checkboxText }).first();
        await label.waitFor({ state: 'visible', timeout: 8000 });
        await nativeClick(label);
        await harnessSide.page.keyboard.press('Escape');
        await harnessSide.networkIdle();
    };
    const clearFilters = async harnessSide => {
        await nativeClick(harnessSide.page.locator('button[title="Filter" i]').first());
        const reset = harnessSide.page.locator('button, [role="button"]', { hasText: /reset filters/i }).first();
        if (await reset.count().catch(() => 0)) await nativeClick(reset).catch(() => {});
        await harnessSide.page.keyboard.press('Escape');
        await harnessSide.networkIdle();
    };

    if (!aborted) {
        await step('A5: filters', async () => {
            try {
                const genresRef = (await S.apiRequest(`Genres?ParentId=${moviesViewId}`)).body?.Items ?? [];
                // First genre with >=2 items in the library, per PARITY.md A5.
                let chosenGenre = null;
                for (const genre of genresRef) {
                    const count = (await S.apiRequest(`Items?ParentId=${moviesViewId}&Recursive=true&IncludeItemTypes=Movie&GenreIds=${genre.Id}&Limit=0`)).body?.TotalRecordCount ?? 0;
                    if (count >= 2) { chosenGenre = { ...genre, count }; break; }
                }
                // Most populated year in the library, derived from the A2 reference set.
                const yearCounts = new Map();
                for (const movie of a2.movies.ref) {
                    const year = movie.ProductionYear;
                    if (year) yearCounts.set(year, (yearCounts.get(year) ?? 0) + 1);
                }
                const chosenYear = [...yearCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

                const filterCases = [];
                if (chosenGenre) filterCases.push({ name: `Genre: ${chosenGenre.Name}`, accordion: 'filtersGenres-header', checkbox: chosenGenre.Name, apiQuery: `GenreIds=${chosenGenre.Id}` });
                if (chosenYear) filterCases.push({ name: `Year: ${chosenYear}`, accordion: 'filtersYears-header', checkbox: String(chosenYear), apiQuery: `Years=${chosenYear}` });
                filterCases.push({ name: 'Played', accordion: 'filtersStatus-header', checkbox: 'Played', apiQuery: 'IsPlayed=true' });
                filterCases.push({ name: 'Unplayed', accordion: 'filtersStatus-header', checkbox: 'Unplayed', apiQuery: 'IsPlayed=false' });
                filterCases.push({ name: 'Favourites', accordion: 'filtersStatus-header', checkbox: 'Favorite', apiQuery: 'IsFavorite=true' });

                for (const filterCase of filterCases) {
                    const refSet = (await pageAllItems(S, `Items?ParentId=${moviesViewId}&Recursive=true&IncludeItemTypes=Movie&${filterCase.apiQuery}`)).map(i => i.Id);
                    const readFiltered = async harnessSide => {
                        await harnessSide.navigate(harnessSide.base + '#/movies?topParentId=' + moviesViewId);
                        await harnessSide.networkIdle();
                        await clearFilters(harnessSide);
                        await openFilterAccordion(harnessSide, filterCase.accordion);
                        await clickFilterCheckbox(harnessSide, filterCase.checkbox);
                        const { ids } = await forceFullLazyLoad(harnessSide);
                        await clearFilters(harnessSide);
                        return ids;
                    };
                    const idsS = await readFiltered(S);
                    const idsM = await readFiltered(M);
                    const diff = describeSetDiff(`A5 filter ${filterCase.name}`, idsS, idsM);
                    const diffRef = describeSetDiff(`A5 filter ${filterCase.name} vs API`, idsS, refSet);
                    if (diff.equal && diffRef.equal) {
                        pushRow('A5', 'Filters', `Movies filter: ${filterCase.name}`, `${idsS.length} ids`, `${idsM.length} ids`, 'PASS');
                    } else {
                        pushRow('A5', 'Filters', `Movies filter: ${filterCase.name}`, `${idsS.length} ids`, `${idsM.length} ids`, 'FAIL', diff.equal ? diffRef.text : diff.text);
                    }
                }
            } catch (error) {
                pushRow('A5', 'Filters', 'A5', 'n/a', 'n/a', 'FAIL', error.message);
            }
        });
    }

    // A6 — collections/boxsets
    if (!aborted && !quick) {
        await step('A6: collections', async () => {
            try {
                const refSet = (await S.apiRequest('Items?IncludeItemTypes=BoxSet&Recursive=true')).body?.Items?.map(i => i.Id) ?? [];
                const openCollectionsTab = async harnessSide => {
                    await harnessSide.navigate(harnessSide.base + '#/movies?topParentId=' + moviesViewId + '&tab=' + 3);
                    await harnessSide.networkIdle();
                    const { ids } = await forceFullLazyLoad(harnessSide);
                    return ids;
                };
                const idsS = await openCollectionsTab(S);
                const idsM = await openCollectionsTab(M);
                const diff = describeSetDiff('A6 collections tab', idsS, idsM);
                pushRow('A6', 'Collections', 'Movies collections tab id set', `${idsS.length} ids`, `${idsM.length} ids`, diff.equal ? 'PASS' : 'FAIL', diff.text);

                if (refSet.length) {
                    const firstBoxSetId = normId(refSet[0]);
                    const openBoxSet = async harnessSide => {
                        await harnessSide.navigate(harnessSide.base + '#/details?id=' + refSet[0]);
                        await harnessSide.networkIdle();
                        return harnessSide.shownIds();
                    };
                    const childS = await openBoxSet(S);
                    const childM = await openBoxSet(M);
                    const childDiff = describeSetDiff('A6 first boxset children', childS, childM);
                    pushRow('A6', 'Collections', `First boxset children (${firstBoxSetId})`, `${childS.length} ids`, `${childM.length} ids`, childDiff.equal ? 'PASS' : 'FAIL', childDiff.text);
                } else {
                    pushRow('A6', 'Collections', 'First boxset children', 'n/a', 'n/a', 'SKIPPED', 'no BoxSet exists in this library');
                }
            } catch (error) {
                pushRow('A6', 'Collections', 'A6', 'n/a', 'n/a', 'FAIL', error.message);
            }
        });
    }

    // A7 — non-Latin titles
    if (!aborted) {
        await step('A7: non-Latin titles', async () => {
            try {
                const nonLatinPattern = /[^ -ɏ]/;
                const candidates = [...a2.movies.ref, ...a2.tv.ref].filter(item => nonLatinPattern.test(item.Name));
                if (!candidates.length) {
                    pushRow('A7', 'Non-Latin titles', 'Non-Latin titles present', 'none in library', 'none in library', 'RECORDED');
                } else {
                    let failures = 0;
                    for (const item of candidates) {
                        const nfc = s => (s ?? '').normalize('NFC');
                        const readCardText = async harnessSide => harnessSide.page.evaluate(id => {
                            const card = document.querySelector(`.card[data-id="${id}"], .card[data-id="${id.toLowerCase()}"]`);
                            return card?.getAttribute('aria-label') ?? card?.textContent?.trim() ?? null;
                        }, item.Id);
                        const inGridS = normSet(a2.movies.ref.includes(item) ? a2.movies.s : a2.tv.s).has(normId(item.Id));
                        const inGridM = normSet(a2.movies.ref.includes(item) ? a2.movies.m : a2.tv.m).has(normId(item.Id));

                        await S.navigate(baseS + '#/search?query=' + encodeURIComponent(item.Name));
                        await S.networkIdle();
                        const searchIdsS = await S.shownIds();
                        await M.navigate(baseM + '#/search?query=' + encodeURIComponent(item.Name));
                        await M.networkIdle();
                        const searchIdsM = await M.shownIds();
                        const foundInSearchS = normSet(searchIdsS).has(normId(item.Id));
                        const foundInSearchM = normSet(searchIdsM).has(normId(item.Id));

                        const ok = inGridS && inGridM && foundInSearchS && foundInSearchM;
                        if (!ok) failures++;
                        pushRow('A7', 'Non-Latin titles', `"${item.Name}" (${item.Id}) present in grid + findable via search`,
                            `grid:${inGridS} search:${foundInSearchS}`, `grid:${inGridM} search:${foundInSearchM}`, ok ? 'PASS' : 'FAIL',
                            ok ? undefined : `nfc-form check: stock/mod title bytes ${nfc(item.Name)}`);
                    }
                    if (!failures) knownGapsObserved.push(`A7: ${candidates.length} non-Latin title(s) verified present and findable on both sides.`);
                }
            } catch (error) {
                pushRow('A7', 'Non-Latin titles', 'A7', 'n/a', 'n/a', 'FAIL', error.message);
            }
        });
    }

    // =================================================================================================
    // Area B — detail parity (PARITY.md §4)
    // =================================================================================================
    /**
 * Reads the detail page's own rendered fields, using this fork's ACTUAL current markup (verified
 * live against the running instance; PARITY.md's suggested `.genresGroup`/`.studiosGroup`/
 * `.peopleSection` selectors are stale for this build — Director/Studios/Genres now render as
 * `.itemDetailsGroup .detailsGroupItem` blocks labelled by a `.label` element, and Tags render as
 * `.itemTags`. `.itemName`, `.itemMiscInfo`, `.mediaInfoOfficialRating`, `.starRatingContainer`,
 * `.mediaInfoCriticRating`, `.overview` and `select.selectSource` remain exactly as PARITY.md says.
 *
 * This is a single-page app that keeps previously visited `#itemDetailPage` instances in the DOM,
 * merely hidden (verified live: after visiting three movies in sequence, `document.querySelectorAll(
 * '.page')` held all three, only the last without `.hide`). Every selector below therefore MUST be
 * scoped to the current, visible page (`.page:not(.hide)`, the same root `appReady()` waits for) —
 * an unscoped `document.querySelector('.itemName')` or `document.querySelectorAll('.sectionTitle')`
 * matches document order, which is oldest-hidden-page-first, not the page actually on screen. That
 * staleness is what made B1's Title read the previous sampled item's name and made B3's cast id
 * sequence come from the wrong (or a now-absent) page.
 */
    const readDetailFields = harnessSide => harnessSide.page.evaluate(() => {
        const root = document.querySelector('.page:not(.hide)') ?? document;
        const text = el => (el?.textContent ?? '').trim();
        const groupItem = label => Array.from(root.querySelectorAll('.detailsGroupItem'))
            .find(node => text(node.querySelector('.label')) === label);
        const groupLinks = label => Array.from(groupItem(label)?.querySelectorAll('a') ?? []).map(a => a.textContent.trim());
        const castHeading = Array.from(root.querySelectorAll('.sectionTitle')).find(node => /cast\s*&?\s*crew/i.test(node.textContent));
        const castContainer = castHeading?.closest('.verticalSection, div')?.querySelector('[is="emby-itemscontainer"], .itemsContainer');
        return {
            title: text(root.querySelector('.itemName')),
            parentTitle: text(root.querySelector('.parentItemName')),
            miscInfo: Array.from(root.querySelectorAll('.itemMiscInfo')).map(text).join(' | '),
            officialRating: text(root.querySelector('.mediaInfoOfficialRating')),
            communityRating: text(root.querySelector('.starRatingContainer')),
            criticRating: text(root.querySelector('.mediaInfoCriticRating')),
            genres: groupLinks('Genres'),
            studios: groupLinks('Studios'),
            director: groupLinks('Director'),
            writer: groupLinks('Writer'),
            tags: Array.from(root.querySelectorAll('.itemTags a')).map(a => a.textContent.trim()),
            overview: text(root.querySelector('.overview')),
            castIds: Array.from(castContainer?.querySelectorAll('.card[data-id]') ?? [])
                .filter(node => node.getClientRects().length > 0)
                .map(n => n.dataset.id),
            mediaInfoBadges: Array.from(root.querySelectorAll('.mediaInfoItem')).map(text),
            primarySrc: root.querySelector('.detailImageContainer .cardImageContainer, .detailImageContainer img')?.style?.backgroundImage
            ?? root.querySelector('.detailImageContainer img')?.getAttribute('src') ?? null,
            backdropSrc: root.querySelector('#itemBackdrop')?.style?.backgroundImage ?? null,
            logoSrc: root.querySelector('.detailLogo')?.style?.backgroundImage ?? null,
            sourceOptions: Array.from(root.querySelectorAll('select.selectSource option')).map(o => ({ value: o.value, label: o.textContent.trim() })),
            sourceSelected: root.querySelector('select.selectSource')?.value ?? null,
            resumeOffered: !!root.querySelector('.btnResume, [data-action="resume"]'),
            playButtonPresent: !!root.querySelector('.btnPlay, .detailButton-icon.btnPlay, [data-action="play"]')
        };
    });

    /** Extracts the /Items/{id}/Images/{type} path and tag from a CSS url(...) background-image string. */
    const imagePathAndTag = cssUrl => {
        const match = /url\(["']?([^"')]+)["']?\)/.exec(cssUrl ?? '');
        if (!match) return null;
        try {
            const url = new URL(match[1], testUrl);
            return { path: url.pathname, tag: url.searchParams.get('tag') };
        } catch { return null; }
    };

    // B0 — the sample, chosen deterministically per PARITY.md.
    let b0Sample = [];
    if (!aborted) {
        await step('B0: choose detail/playback sample', async () => {
            try {
                const moviesSorted = [...a2.movies.ref].sort((x, y) => x.Id.localeCompare(y.Id));
                const picked = new Set();
                const nonLatinPattern = /[^ -ɏ]/;
                const nonLatin = moviesSorted.filter(i => nonLatinPattern.test(i.Name)).slice(0, 3);
                for (const item of nonLatin) picked.add(item.Id);
                const twoVersion = moviesSorted.find(i => (i.MediaSources?.length ?? 0) >= 2 || i.Id === fixedTwoVersionId);
                if (twoVersion) picked.add(twoVersion.Id);
                let i = 0;
                while (picked.size < sampleSize && i < moviesSorted.length) {
                    const index = Math.floor((i * moviesSorted.length) / sampleSize);
                    picked.add(moviesSorted[index]?.Id);
                    i++;
                }
                b0Sample = moviesSorted.filter(item => picked.has(item.Id)).slice(0, Math.max(sampleSize, nonLatin.length + (twoVersion ? 1 : 0)));
                report.header.b0Sample = b0Sample.map(i => ({ Id: i.Id, Name: i.Name }));
                pushRow('B0', 'Detail sample', `Sample chosen: ${b0Sample.length} movies + ${a2.tv.ref.length} series`, JSON.stringify(b0Sample.map(i => i.Id)), 'same sample (data-level, both sides read the same ids)', 'RECORDED');
            } catch (error) {
                pushRow('B0', 'Detail sample', 'B0', 'n/a', 'n/a', 'FAIL', error.message);
            }
        });
    }

    // B1, B2, B3 — metadata, artwork, cast
    if (!aborted) {
        await step('B1/B2/B3: metadata, artwork, cast', async () => {
            try {
                const sampleItems = quick ? b0Sample.slice(0, 3) : b0Sample;
                for (const item of sampleItems) {
                    const apiRef = (await S.apiRequest(`Items/${item.Id}?Fields=Overview,Genres,Studios,Taglines,ProviderIds,MediaSources,MediaStreams,People`)).body;
                    await S.navigate(baseS + '#/details?id=' + item.Id);
                    await S.networkIdle();
                    const fieldsS = await readDetailFields(S);
                    await M.navigate(baseM + '#/details?id=' + item.Id);
                    await M.networkIdle();
                    const fieldsM = await readDetailFields(M);

                    // B1 metadata
                    const compareField = (name, sVal, mVal, apiVal) => {
                        const norm = v => (Array.isArray(v) ? v.join(', ') : String(v ?? '')).trim();
                        if (norm(sVal) === norm(mVal)) {
                            pushRow('B1', 'Detail metadata', `${item.Name} (${item.Id}): ${name}`, norm(sVal).slice(0, 80), norm(mVal).slice(0, 80), 'PASS');
                        } else if (apiVal !== undefined && norm(sVal) !== norm(apiVal) && norm(mVal) !== norm(apiVal)) {
                            pushRow('B1', 'Detail metadata', `${item.Name} (${item.Id}): ${name}`, norm(sVal).slice(0, 80), norm(mVal).slice(0, 80), 'SHARED-GAP', `api: ${norm(apiVal).slice(0, 80)}`);
                        } else {
                            pushRow('B1', 'Detail metadata', `${item.Name} (${item.Id}): ${name}`, norm(sVal).slice(0, 200), norm(mVal).slice(0, 200), 'FAIL');
                        }
                    };
                    compareField('Title', fieldsS.title, fieldsM.title, item.Name);
                    compareField('Misc info (year/runtime)', fieldsS.miscInfo, fieldsM.miscInfo);
                    compareField('Official rating', fieldsS.officialRating, fieldsM.officialRating, apiRef?.OfficialRating);
                    compareField('Genres', fieldsS.genres, fieldsM.genres, apiRef?.Genres);
                    compareField('Overview', fieldsS.overview, fieldsM.overview, apiRef?.Overview);
                    compareField('Studios', fieldsS.studios, fieldsM.studios, (apiRef?.Studios ?? []).map(s => s.Name));
                    compareField('Tags', fieldsS.tags, fieldsM.tags);

                    // B2 artwork
                    const primaryS = imagePathAndTag(fieldsS.primarySrc);
                    const primaryM = imagePathAndTag(fieldsM.primarySrc);
                    const rootedUnderWeb = p => p?.path?.startsWith('/web/') || p?.path?.startsWith('/web-mod/');
                    if (primaryS?.path === primaryM?.path && primaryS?.tag === primaryM?.tag && !rootedUnderWeb(primaryM)) {
                        pushRow('B2', 'Artwork', `${item.Name} (${item.Id}): primary image path/tag`, primaryS?.path, primaryM?.path, 'PASS');
                    } else {
                        pushRow('B2', 'Artwork', `${item.Name} (${item.Id}): primary image path/tag`, JSON.stringify(primaryS), JSON.stringify(primaryM), 'FAIL');
                    }

                    // B3 cast
                    const castDiff = describeSetDiff(`B3 ${item.Name} cast`, fieldsS.castIds, fieldsM.castIds);
                    if (castDiff.equal) {
                        pushRow('B3', 'Cast/crew', `${item.Name} (${item.Id}): cast id sequence`, `${fieldsS.castIds.length}`, `${fieldsM.castIds.length}`, 'PASS');
                    } else {
                        pushRow('B3', 'Cast/crew', `${item.Name} (${item.Id}): cast id sequence`, `${fieldsS.castIds.length}`, `${fieldsM.castIds.length}`, 'FAIL', castDiff.text);
                    }
                }
            } catch (error) {
                pushRow('B1', 'Detail metadata', 'B1/B2/B3', 'n/a', 'n/a', 'FAIL', error.message);
            }
        });
    }

    // B4 — media info
    if (!aborted) {
        await step('B4: media info', async () => {
            try {
                const sampleItems = quick ? b0Sample.slice(0, 3) : b0Sample;
                for (const item of sampleItems) {
                    const apiRef = (await S.apiRequest(`Items/${item.Id}?Fields=MediaSources,MediaStreams`)).body;
                    await S.navigate(baseS + '#/details?id=' + item.Id);
                    await S.networkIdle();
                    const badgesS = (await readDetailFields(S)).mediaInfoBadges;
                    await M.navigate(baseM + '#/details?id=' + item.Id);
                    await M.networkIdle();
                    const badgesM = (await readDetailFields(M)).mediaInfoBadges;
                    const streamSummary = (apiRef?.MediaSources ?? [])[0];
                    const apiSummary = streamSummary ? `${streamSummary.Container} ${(streamSummary.MediaStreams ?? []).find(s => s.Type === 'Video')?.Codec ?? ''} ${(streamSummary.MediaStreams ?? []).find(s => s.Type === 'Video')?.Width ?? ''}x${(streamSummary.MediaStreams ?? []).find(s => s.Type === 'Video')?.Height ?? ''}` : 'n/a';
                    if (JSON.stringify(badgesS) === JSON.stringify(badgesM)) {
                        pushRow('B4', 'Media info', `${item.Name} (${item.Id}): media info badges`, badgesS.join(' / '), badgesM.join(' / '), 'PASS');
                    } else {
                        pushRow('B4', 'Media info', `${item.Name} (${item.Id}): media info badges`, badgesS.join(' / '), badgesM.join(' / '), 'FAIL', `api reference: ${apiSummary}`);
                    }
                }
            } catch (error) {
                pushRow('B4', 'Media info', 'B4', 'n/a', 'n/a', 'FAIL', error.message);
            }
        });
    }

    // B5 — episode lists and season navigation (uses the A3 sample; skipped if A3 found nothing usable)
    if (!aborted && !quick) {
        await step('B5: episode lists and season navigation', async () => {
            try {
                if (!a2.tv.ref.length) {
                    pushRow('B5', 'Episodes/Seasons', 'B5', 'n/a', 'n/a', 'SKIPPED', 'no TV series in this library');
                } else {
                    const series = [...a2.tv.ref].sort((x, y) => x.Id.localeCompare(y.Id))[0];
                    const seasonsRef = (await S.apiRequest(`Shows/${series.Id}/Seasons`)).body?.Items ?? [];
                    if (!seasonsRef.length) {
                        pushRow('B5', 'Episodes/Seasons', `${series.Name}: seasons`, 'n/a', 'n/a', 'SKIPPED', 'series has no seasons via API');
                    } else {
                        const readSeasonNav = async harnessSide => {
                            await harnessSide.navigate(harnessSide.base + '#/details?id=' + series.Id);
                            await harnessSide.networkIdle();
                            const seasonSelectValues = await harnessSide.page.evaluate(() => Array.from(document.querySelectorAll('.selectSeason option, [data-id].emby-select-option'))
                                .map(o => o.value ?? o.dataset.id).filter(Boolean));
                            const episodeIds = await harnessSide.shownIds();
                            return { seasonSelectValues, episodeIds };
                        };
                        const navS = await readSeasonNav(S);
                        const navM = await readSeasonNav(M);
                        const seasonDiff = describeSetDiff(`B5 ${series.Name} season selector`, navS.seasonSelectValues, navM.seasonSelectValues);
                        const episodeDiff = describeSetDiff(`B5 ${series.Name} default episode list`, navS.episodeIds, navM.episodeIds);
                        pushRow('B5', 'Episodes/Seasons', `${series.Name}: season selector`, navS.seasonSelectValues.length, navM.seasonSelectValues.length, seasonDiff.equal ? 'PASS' : 'FAIL', seasonDiff.text);
                        pushRow('B5', 'Episodes/Seasons', `${series.Name}: default season episode list`, navS.episodeIds.length, navM.episodeIds.length, episodeDiff.equal ? 'PASS' : 'FAIL', episodeDiff.text);
                    }
                }
            } catch (error) {
                pushRow('B5', 'Episodes/Seasons', 'B5', 'n/a', 'n/a', 'FAIL', error.message);
            }
        });
    }

    // B6 — continue watching and next up
    if (!aborted) {
        await step('B6: continue watching and next up', async () => {
            try {
                if (!a2.tv.ref.length || b0Sample.length === 0) {
                    pushRow('B6', 'Home rows', 'B6', 'n/a', 'n/a', 'SKIPPED', 'no series or no sampled movie available to seed state');
                } else {
                    const series = [...a2.tv.ref].sort((x, y) => x.Id.localeCompare(y.Id))[0];
                    const episodesRef = (await S.apiRequest(`Shows/${series.Id}/Episodes`)).body?.Items ?? [];
                    if (episodesRef.length < 2) {
                        pushRow('B6', 'Home rows', 'B6', 'n/a', 'n/a', 'SKIPPED', `${series.Name} has fewer than 2 episodes`);
                    } else {
                        const [predecessor, target] = episodesRef;
                        await snapshotUserData(predecessor.Id);
                        await snapshotUserData(target.Id);
                        const runtimeTicks = target.RunTimeTicks ?? 3000000000;
                        await setUserData(pageS, predecessor.Id, { played: true });
                        await setUserData(pageS, target.Id, { positionTicks: Math.floor(runtimeTicks * 0.25) });

                        const resumeRef = (await S.apiRequest('UserItems/Resume?limit=24&mediaTypes=Video')).body?.Items?.map(i => i.Id) ?? [];
                        const nextUpRef = (await S.apiRequest(`Shows/NextUp?limit=24&seriesId=${series.Id}`)).body?.Items?.map(i => i.Id) ?? [];

                        const readHomeRows = async harnessSide => {
                            await harnessSide.navigate(harnessSide.base + '#/home');
                            await harnessSide.networkIdle();
                            return harnessSide.page.evaluate(() => {
                                const rowIds = label => {
                                    const title = Array.from(document.querySelectorAll('.sectionTitle')).find(node => new RegExp('^' + label + '$', 'i').test(node.textContent.trim()));
                                    const section = title?.closest('.verticalSection') ?? title?.parentElement?.parentElement;
                                    return Array.from(section?.querySelectorAll('.card[data-id]') ?? []).map(c => c.dataset.id);
                                };
                                return { continueWatching: rowIds('Continue Watching'), nextUp: rowIds('Next Up') };
                            });
                        };
                        const rowsS = await readHomeRows(S);
                        const rowsM = await readHomeRows(M);
                        const cwDiff = describeSetDiff('B6 Continue Watching', rowsS.continueWatching, rowsM.continueWatching);
                        const nuDiff = describeSetDiff('B6 Next Up', rowsS.nextUp, rowsM.nextUp);
                        pushRow('B6', 'Home rows', 'Continue Watching row', rowsS.continueWatching.length, rowsM.continueWatching.length,
                            cwDiff.equal && normSet(rowsS.continueWatching).has(normId(target.Id)) ? 'PASS' : 'FAIL', cwDiff.text);
                        pushRow('B6', 'Home rows', 'Next Up row', rowsS.nextUp.length, rowsM.nextUp.length, nuDiff.equal ? 'PASS' : 'FAIL', nuDiff.text);
                    }
                }
            } catch (error) {
                pushRow('B6', 'Home rows', 'B6', 'n/a', 'n/a', 'FAIL', error.message);
            }
        });
    }

    // B7 — version selector (the two-version title)
    let twoVersionItem = null;
    if (!aborted) {
        await step('B7: version selector', async () => {
            try {
                // a2.movies.ref only carries Fields=ProviderIds (A2 doesn't need MediaSources), so detecting
                // a multi-version title needs its own query with that field, not a reuse of the A2 reference.
                if (fixedTwoVersionId) {
                    twoVersionItem = { Id: fixedTwoVersionId };
                } else {
                    const withSources = await pageAllItems(S, `Items?ParentId=${moviesViewId}&Recursive=true&IncludeItemTypes=Movie&SortBy=SortName&SortOrder=Ascending&Fields=MediaSources`);
                    twoVersionItem = [...withSources].sort((x, y) => x.Id.localeCompare(y.Id)).find(i => (i.MediaSources?.length ?? 0) >= 2);
                }
                if (!twoVersionItem) {
                    pushRow('B7', 'Version selector', 'B7', 'n/a', 'n/a', 'SKIPPED', 'no title with >=2 MediaSources exists (§8.4 known in-flight defect)');
                } else {
                    const apiItem = (await S.apiRequest(`Items/${twoVersionItem.Id}?Fields=MediaSources`)).body;
                    twoVersionItem = apiItem;
                    const readVersions = async harnessSide => {
                        await harnessSide.navigate(harnessSide.base + '#/details?id=' + apiItem.Id);
                        await harnessSide.networkIdle();
                        return harnessSide.page.evaluate(() => Array.from(document.querySelectorAll('select.selectSource option')).map(o => ({ value: o.value, label: o.textContent.trim() })));
                    };
                    const versionsS = await readVersions(S);
                    const versionsM = await readVersions(M);
                    const seqEqual = JSON.stringify(versionsS.map(v => normId(v.value))) === JSON.stringify(versionsM.map(v => normId(v.value)));
                    pushRow('B7', 'Version selector', `${apiItem.Name} (${apiItem.Id}): version list`, JSON.stringify(versionsS), JSON.stringify(versionsM), seqEqual ? 'PASS' : 'FAIL',
                        seqEqual ? undefined : 'Version id list or order differs between stock and mod');
                }
            } catch (error) {
                pushRow('B7', 'Version selector', 'B7', 'n/a', 'n/a', 'FAIL', error.message);
            }
        });
    }

    // =================================================================================================
    // Area C — playback parity (PARITY.md §5). The user's stated emphasis; most of the runtime.
    // =================================================================================================
    const waitForRequestMatching = async (harnessSide, predicate, { since = 0, timeout = 20000 } = {}) => {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
            const found = harnessSide.requestLog.find(entry => entry.t >= since && predicate(entry));
            if (found) return found;
            await sleep(150);
        }
        return null;
    };
    const parsePostData = entry => { try { return JSON.parse(entry.postData); } catch { return null; } };
    /**
 * For DirectPlay/DirectStream, an audio/subtitle switch reports itself via a
 * Sessions/Playing/Progress POST almost immediately. For Transcode, playbackmanager.js's
 * setAudioStreamIndex/setSubtitleStreamIndex instead calls changeStream(), which fetches new
 * PlaybackInfo and loads a whole new stream URL — there is no Progress ping for the switch itself.
 * Polling the session directly is the one signal that is correct in both cases: it is what
 * actually matters (what index the server now believes is playing), not which code path produced it.
 * Returns the last-seen value regardless of whether it ever matched, so a failure still reports
 * what the server actually settled on.
 */
    const pollSessionStreamIndex = (harnessSide, itemId, field, targetIndex, { timeout = 12000, interval = 500 } = {}) =>
        poll(async () => {
            const sessions = (await harnessSide.apiRequest('Sessions')).body ?? [];
            return sessions.find(s => normId(s.NowPlayingItem?.Id ?? '') === normId(itemId))?.PlayState?.[field] ?? null;
        }, value => value === targetIndex, { timeout, interval });

    /** Reveals the OSD the way a mouse or remote would, then waits briefly for controls to paint. */
    const revealOsd = async harnessSide => {
        await harnessSide.page.mouse.move(200, 200);
        await harnessSide.page.mouse.move(210, 210);
        await sleep(300);
    };

    // An action-sheet item is always selected by its `data-id`, never by position: upstream unshifts a
    // "Secondary Subtitles" entry into position 0 whenever a subtitle is already playing, so a positional
    // click lands on a different command depending on player state. That already produced one false
    // "mod-only defect" report. Dispatch the click natively (see nativeClick) because Playwright's
    // actionability-gated `.click()` can hang on these `is="emby-button"` custom elements.

    let fixtures = {};
    if (!aborted) {
        await step('C0: fixture selection', async () => {
            try {
                const moviesFull = await pageAllItems(S, `Items?ParentId=${moviesViewId}&Recursive=true&IncludeItemTypes=Movie&Fields=MediaSources,MediaStreams,Path`);
                const sorted = [...moviesFull].sort((a, b) => a.Id.localeCompare(b.Id));
                const video = item => (item.MediaSources?.[0]?.MediaStreams ?? []).find(s => s.Type === 'Video') ?? {};
                const audios = item => (item.MediaSources?.[0]?.MediaStreams ?? []).filter(s => s.Type === 'Audio');
                const subs = item => (item.MediaSources?.[0]?.MediaStreams ?? []).filter(s => s.Type === 'Subtitle');
                const container = item => (item.MediaSources?.[0]?.Container ?? '').toLowerCase();
                const predicates = {
                    'C-4KHDR': item => video(item).Width >= 3000 && video(item).VideoRange && video(item).VideoRange !== 'SDR',
                    'C-1080': item => video(item).Width >= 1800 && video(item).Width <= 1999 && (video(item).VideoRange ?? 'SDR') === 'SDR',
                    'C-MULTIAUDIO': item => audios(item).length >= 2,
                    'C-EMBEDSUB': item => subs(item).some(s => s.IsExternal === false),
                    'C-EXTSUB': item => subs(item).some(s => s.IsExternal === true),
                    'C-M2TS': item => /m2ts|mts/.test(container(item)) || item.VideoType === 'BluRay',
                    'C-AVI': item => container(item) === 'avi'
                };
                fixtures = {};
                for (const [name, predicate] of Object.entries(predicates)) {
                    const match = sorted.find(predicate);
                    if (match) {
                        fixtures[name] = { id: match.Id, title: match.Name, mediaSourceId: match.MediaSources[0].Id, container: container(match), width: video(match).Width, videoRange: video(match).VideoRange };
                    } else {
                        skipped.push({ id: name, feature: 'Fixture selection', reason: 'no item in the library matches this predicate' });
                    }
                }
                // C-TVNEXT: first series (by Id) with >=2 episodes in one season; episode 1 of that season.
                for (const series of [...a2.tv.ref].sort((a, b) => a.Id.localeCompare(b.Id))) {
                    const episodes = (await S.apiRequest(`Shows/${series.Id}/Episodes?Fields=MediaSources`)).body?.Items ?? [];
                    const bySeason = new Map();
                    for (const ep of episodes) {
                        const list = bySeason.get(ep.ParentIndexNumber) ?? [];
                        list.push(ep);
                        bySeason.set(ep.ParentIndexNumber, list);
                    }
                    const season = [...bySeason.values()].find(list => list.length >= 2);
                    if (season) {
                        season.sort((a, b) => (a.IndexNumber ?? 0) - (b.IndexNumber ?? 0));
                        fixtures['C-TVNEXT'] = { id: season[0].Id, title: `${series.Name} - ${season[0].Name}`, seriesId: series.Id, nextEpisodeId: season[1].Id, mediaSourceId: season[0].MediaSources?.[0]?.Id };
                        break;
                    }
                }
                if (!fixtures['C-TVNEXT']) skipped.push({ id: 'C-TVNEXT', feature: 'Fixture selection', reason: 'no series with >=2 episodes in one season' });

                if (twoVersionItem && (twoVersionItem.MediaSources?.length ?? 0) >= 2) {
                    fixtures['C-TWOVER'] = { id: twoVersionItem.Id, title: twoVersionItem.Name, sources: twoVersionItem.MediaSources.map(m => ({ id: m.Id, container: m.Container, width: (m.MediaStreams ?? []).find(s => s.Type === 'Video')?.Width })) };
                } else {
                    skipped.push({ id: 'C-TWOVER', feature: 'Fixture selection', reason: 'no title with >=2 MediaSources exists (§8.4 known in-flight defect)' });
                }

                report.header.fixtures = fixtures;
                await fs.writeFile(path.join(outDir, 'fixtures.json'), JSON.stringify(fixtures, null, 2));
                pushRow('C0', 'Playback', `Fixtures chosen: ${Object.keys(fixtures).join(', ')}`, 'n/a', 'n/a', 'RECORDED');
            } catch (error) {
                pushRow('C0', 'Playback', 'C0 fixture selection', 'n/a', 'n/a', 'FAIL', error.message);
            }
        });
    }

    /**
 * Runs the full per-fixture procedure (§5.1) on one side and returns a capture object. `itemId` is
 * the item to open; `mediaSourceId` (optional) is explicitly selected via the version `<select>`
 * first, for C-TWOVER.
 */
    const playFixtureOnSide = async (harnessSide, itemId, { mediaSourceId, hasMultiAudio, hasEmbedSub, hasExtSub, seekOnly } = {}) => {
        const capture = { side: harnessSide.label };
        await harnessSide.navigate(harnessSide.base + '#/details?id=' + itemId);
        await harnessSide.networkIdle();
        if (mediaSourceId) {
            const select = harnessSide.page.locator('select.selectSource');
            if (await select.count()) {
                await select.selectOption(mediaSourceId).catch(() => {});
                await sleep(300);
            }
        }
        const t0 = Date.now();
        const playButton = harnessSide.page.locator('.btnPlay:visible').first();
        await nativeClick(playButton);
        await harnessSide.page.waitForSelector('video', { timeout: 30000 });
        const playingReq = await waitForRequestMatching(harnessSide, e => e.method === 'POST' && new URL(e.url).pathname === '/Sessions/Playing', { since: t0, timeout: 20000 });
        const playingBody = playingReq ? parsePostData(playingReq) : null;
        capture.playingCount = harnessSide.requestLog.filter(e => e.t >= t0 && e.method === 'POST' && new URL(e.url).pathname === '/Sessions/Playing').length;
        capture.itemId = playingBody?.ItemId ?? null;
        capture.mediaSourceId = playingBody?.MediaSourceId ?? null;
        capture.playMethod = playingBody?.PlayMethod ?? null;
        capture.audioStreamIndex = playingBody?.AudioStreamIndex ?? null;
        capture.subtitleStreamIndex = playingBody?.SubtitleStreamIndex ?? null;
        capture.playSessionId = playingBody?.PlaySessionId ?? null;

        await sleep(500);
        const sessions = (await harnessSide.apiRequest('Sessions')).body ?? [];
        const nowPlaying = sessions.find(s => s.NowPlayingItem?.Id && normId(s.NowPlayingItem.Id) === normId(itemId)) ?? sessions[0];
        capture.serverPlayMethod = nowPlaying?.PlayState?.PlayMethod ?? null;
        capture.serverTranscodingInfo = nowPlaying?.TranscodingInfo ? {
            isVideoDirect: nowPlaying.TranscodingInfo.IsVideoDirect,
            isAudioDirect: nowPlaying.TranscodingInfo.IsAudioDirect,
            reasons: nowPlaying.TranscodingInfo.TranscodeReasons ?? []
        } : null;

        const streamReq = harnessSide.requestLog.find(e => e.t >= t0 && /\/Videos\/.*\/(stream|main\.m3u8|master\.m3u8|hls1)/i.test(e.url));
        capture.streamShape = streamReq ? (/static=true/i.test(streamReq.url) ? 'static' : (/m3u8|hls1/i.test(streamReq.url) ? 'hls' : 'other')) : 'unknown';

        // Seek: reveal OSD, ArrowRight x10.
        const beforeTime = await harnessSide.page.evaluate(() => document.querySelector('video')?.currentTime ?? null);
        await revealOsd(harnessSide);
        const seekMarker = Date.now();
        for (let i = 0; i < 10; i++) await harnessSide.page.keyboard.press('ArrowRight');
        await sleep(1500);
        const afterTime = await harnessSide.page.evaluate(() => document.querySelector('video')?.currentTime ?? null);
        const progressAfterSeek = await waitForRequestMatching(harnessSide, e => e.method === 'POST' && new URL(e.url).pathname === '/Sessions/Playing/Progress', { since: seekMarker, timeout: 8000 });
        capture.seek = { before: beforeTime, after: afterTime, delta: (afterTime ?? 0) - (beforeTime ?? 0), reported: !!progressAfterSeek, reportedPositionTicks: progressAfterSeek ? parsePostData(progressAfterSeek)?.PositionTicks ?? null : null };

        if (hasMultiAudio && !seekOnly) {
            await revealOsd(harnessSide);
            const audioBtn = harnessSide.page.locator('.btnAudio:visible').first();
            if (await audioBtn.count()) {
                const marker = Date.now();
                await nativeClick(audioBtn);
                const items = harnessSide.page.locator('.actionSheetMenuItem');
                await items.first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
                // Read every option's data-id (the stream Index — video/index.js showAudioTrackSelection
                // sets `id: stream.Index`) and pick one that is NOT the currently playing index, so the
                // click forces a genuine change instead of possibly re-selecting the same track (which
                // Jellyfin's own code no-ops: `if (index !== currentIndex) setAudioStreamIndex(...)`).
                const optionIds = await items.evaluateAll(nodes => nodes.map(n => n.getAttribute('data-id')));
                const currentIndexStr = String(capture.audioStreamIndex ?? '');
                const targetId = optionIds.find(id => id !== currentIndexStr) ?? null;
                if (targetId !== null) {
                    await nativeClick(harnessSide.page.locator(`.actionSheetMenuItem[data-id="${targetId}"]`).first());
                    // Progress-ping is only how DirectPlay reports it; Transcode reloads the stream
                    // instead (see pollSessionStreamIndex's comment), so poll the session directly.
                    const progress = await waitForRequestMatching(harnessSide, e => e.method === 'POST' && new URL(e.url).pathname === '/Sessions/Playing/Progress', { since: marker, timeout: 3000 });
                    const serverIndex = await pollSessionStreamIndex(harnessSide, itemId, 'AudioStreamIndex', Number(targetId), { timeout: 15000 });
                    capture.audioSwitch = {
                        fromIndex: capture.audioStreamIndex,
                        targetIndex: Number(targetId),
                        reportedIndex: progress ? parsePostData(progress)?.AudioStreamIndex ?? null : null,
                        reported: !!progress,
                        serverIndex,
                        actuallyChanged: serverIndex === Number(targetId) && Number(targetId) !== capture.audioStreamIndex
                    };
                } else {
                    capture.audioSwitch = { skipped: 'every action-sheet entry has the same index as the currently playing track — this file cannot exercise a real switch' };
                }
            } else {
                capture.audioSwitch = { skipped: '.btnAudio not present' };
            }
        }

        if ((hasEmbedSub || hasExtSub) && !seekOnly) {
            await revealOsd(harnessSide);
            const subBtn = harnessSide.page.locator('.btnSubtitles:visible').first();
            if (await subBtn.count()) {
                const marker = Date.now();
                await nativeClick(subBtn);
                const items = harnessSide.page.locator('.actionSheetMenuItem');
                await items.first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
                // "Off" always carries data-id="-1", but its POSITION moves: with a subtitle playing,
                // a "Secondary Subtitles" entry is unshifted ahead of it. Always match on data-id.
                // Pick a real, non-Off entry whose index genuinely differs from whatever is
                // currently selected, same rigor as the audio switch above.
                const optionIds = await items.evaluateAll(nodes => nodes.map(n => n.getAttribute('data-id')));
                const currentIndexStr = String(capture.subtitleStreamIndex ?? '-1');
                const targetId = optionIds.find(id => id !== '-1' && id !== currentIndexStr) ?? null;
                if (targetId !== null) {
                    await nativeClick(harnessSide.page.locator(`.actionSheetMenuItem[data-id="${targetId}"]`).first());
                    // Progress-ping is only how DirectPlay reports it; Transcode reloads the stream
                    // instead, so poll the session directly (see pollSessionStreamIndex's comment).
                    const progress = await waitForRequestMatching(harnessSide, e => e.method === 'POST' && new URL(e.url).pathname === '/Sessions/Playing/Progress', { since: marker, timeout: 3000 });
                    const reportedIndex = progress ? parsePostData(progress)?.SubtitleStreamIndex ?? null : null;
                    const serverIndex = await pollSessionStreamIndex(harnessSide, itemId, 'SubtitleStreamIndex', Number(targetId), { timeout: 15000 });
                    // Seek forward to reach cues, then check for rendering by either mechanism.
                    await harnessSide.page.keyboard.press('ArrowRight'); await harnessSide.page.keyboard.press('ArrowRight');
                    const rendering = await poll(() => harnessSide.page.evaluate(() => {
                        const overlay = document.querySelector('.videoSubtitlesInner');
                        const overlayText = overlay?.textContent?.trim() ?? '';
                        const video = document.querySelector('video');
                        const tracks = video ? Array.from(video.textTracks) : [];
                        const nativeShowing = tracks.find(t => t.mode === 'showing' && t.activeCues && t.activeCues.length > 0);
                        return { overlayNonEmpty: overlayText.length > 0, nativeActive: !!nativeShowing };
                    }), r => r.overlayNonEmpty || r.nativeActive, { timeout: 15000, interval: 500 });
                    capture.subtitleSwitch = {
                        fromIndex: capture.subtitleStreamIndex, targetIndex: Number(targetId), reportedIndex, reported: !!progress, serverIndex,
                        actuallyChanged: serverIndex === Number(targetId),
                        mechanism: rendering.overlayNonEmpty ? 'custom-overlay' : (rendering.nativeActive ? 'native-texttrack' : 'none-observed')
                    };

                    // Now Off.
                    await nativeClick(subBtn);
                    await items.first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
                    // Select "Off" by its data-id, never by position: once a subtitle is playing,
                    // video/index.js unshifts a "Secondary Subtitles" entry, so position 0 opens that
                    // submenu and leaves the primary track showing — which reads exactly like a broken
                    // Off and already produced one false "mod-only defect" report.
                    await nativeClick(harnessSide.page.locator('.actionSheetMenuItem[data-id="-1"]').first());
                    const serverIndexOff = await pollSessionStreamIndex(harnessSide, itemId, 'SubtitleStreamIndex', -1, { timeout: 15000 });
                    await sleep(500); // let the player actually tear down the rendered track after the server confirms Off
                    const offState = await harnessSide.page.evaluate(() => {
                        const overlay = document.querySelector('.videoSubtitlesInner');
                        const video = document.querySelector('video');
                        const tracks = video ? Array.from(video.textTracks) : [];
                        return { overlayEmpty: !(overlay?.textContent?.trim()), noneShowing: !tracks.some(t => t.mode === 'showing' && t.activeCues && t.activeCues.length > 0) };
                    });
                    capture.subtitleOff = { ...offState, serverIndexOff, isOff: serverIndexOff === null || serverIndexOff === -1 };
                } else {
                    capture.subtitleSwitch = { skipped: 'every action-sheet entry has the same index as the currently selected subtitle track (or none besides Off exists) — this file cannot exercise a real switch' };
                }
            } else {
                capture.subtitleSwitch = { skipped: '.btnSubtitles not present' };
            }
        }

        // Stop. Escape only hides the OSD in this player (video/index.js: case 'Escape' calls hideOsd(),
        // never playbackManager.stop()) — verified by reading the source, not assumed. What actually
        // stops playback is the router leaving the video view (`viewbeforehide` -> onViewHideStopPlayback
        // -> playbackManager.stop()), exactly what a real "back" press does. Navigate to the details
        // route directly, which is the deterministic way to trigger that regardless of what hash Play
        // used, and works whether or not the video route changed the URL (navigate() forces a reload if
        // it turns out to be the same URL rather than silently no-op'ing).
        const stopMarker = Date.now();
        await harnessSide.navigate(harnessSide.base + '#/details?id=' + itemId);
        const stoppedReq = await waitForRequestMatching(harnessSide, e => e.method === 'POST' && new URL(e.url).pathname === '/Sessions/Playing/Stopped', { since: stopMarker, timeout: 10000 });
        capture.stoppedPositionTicks = stoppedReq ? parsePostData(stoppedReq)?.PositionTicks ?? null : null;
        capture.stoppedCount = harnessSide.requestLog.filter(e => e.t >= t0 && e.method === 'POST' && new URL(e.url).pathname === '/Sessions/Playing/Stopped').length;
        await harnessSide.networkIdle();

        // Resume: reopen the detail page (already there; navigate() reloads since the URL matches, so
        // the resume affordance reflects the just-written UserData rather than stale pre-stop state).
        await harnessSide.navigate(harnessSide.base + '#/details?id=' + itemId);
        await harnessSide.networkIdle();
        const resumeTitle = await harnessSide.page.locator('.btnPlay:visible').first().getAttribute('title').catch(() => null);
        capture.resumeOffered = /resume/i.test(resumeTitle ?? '');
        if (capture.resumeOffered && capture.stoppedPositionTicks) {
            const resumeMarker = Date.now();
            await nativeClick(harnessSide.page.locator('.btnPlay:visible').first());
            await harnessSide.page.waitForSelector('video', { timeout: 30000 }).catch(() => {});
            const resumePlaying = await waitForRequestMatching(harnessSide, e => e.method === 'POST' && new URL(e.url).pathname === '/Sessions/Playing', { since: resumeMarker, timeout: 15000 });
            const resumeBody = resumePlaying ? parsePostData(resumePlaying) : null;
            capture.resumePositionTicks = resumeBody?.StartPositionTicks ?? resumeBody?.PositionTicks ?? null;
            await sleep(500);
            await harnessSide.navigate(harnessSide.base + '#/details?id=' + itemId);
            await waitForRequestMatching(harnessSide, e => e.method === 'POST' && new URL(e.url).pathname === '/Sessions/Playing/Stopped', { since: resumeMarker, timeout: 10000 });
            await harnessSide.networkIdle();
        }
        return capture;
    };

    const withinSeconds = (ticksA, ticksB, seconds_) => {
        if (ticksA == null || ticksB == null) return false;
        return Math.abs(ticksA - ticksB) <= seconds_ * 10000000;
    };

    /** Runs one fixture on both sides in strict series (never interleaved, §1.3), diffs per §5.2, and restores UserData. */
    const runFixtureBothSides = async (name, fixture, options) => {
        if (!fixture) { pushRow(name.split('-')[0], 'Playback', name, 'n/a', 'n/a', 'SKIPPED', `no fixture selected for ${name}`); return; }
        try {
            await snapshotUserData(fixture.id);
            const capS = await playFixtureOnSide(S, fixture.id, { mediaSourceId: fixture.mediaSourceId, ...options });
            await restoreUserData(fixture.id);
            const capM = await playFixtureOnSide(M, fixture.id, { mediaSourceId: fixture.mediaSourceId, ...options });
            await restoreUserData(fixture.id);

            const rows_ = [
                ['a', 'start (one Sessions/Playing, same item/source)', capS.playingCount === 1 && capM.playingCount === 1 && capS.itemId && normId(capS.itemId) === normId(capM.itemId) && normId(capS.mediaSourceId ?? '') === normId(capM.mediaSourceId ?? ''), `S:${capS.playingCount} playing, item ${capS.itemId} src ${capS.mediaSourceId}`, `M:${capM.playingCount} playing, item ${capM.itemId} src ${capM.mediaSourceId}`],
                ['b', 'play method', capS.serverPlayMethod === capM.serverPlayMethod && !!capS.serverTranscodingInfo === !!capM.serverTranscodingInfo, capS.serverPlayMethod, capM.serverPlayMethod],
                ['c', 'transcode reasons', !capS.serverTranscodingInfo && !capM.serverTranscodingInfo ? true : JSON.stringify((capS.serverTranscodingInfo?.reasons ?? []).sort()) === JSON.stringify((capM.serverTranscodingInfo?.reasons ?? []).sort()), JSON.stringify(capS.serverTranscodingInfo?.reasons ?? []), JSON.stringify(capM.serverTranscodingInfo?.reasons ?? [])],
                ['d', 'stream shape', capS.streamShape === capM.streamShape, capS.streamShape, capM.streamShape],
                ['e', 'seek', capS.seek.reported && capM.seek.reported && Math.abs(capS.seek.delta - capM.seek.delta) <= 2, JSON.stringify(capS.seek), JSON.stringify(capM.seek)]
            ];
            if (options?.hasMultiAudio) {
                rows_.push(['f', 'audio switch (forced to a genuinely different track)',
                    capS.audioSwitch?.actuallyChanged && capM.audioSwitch?.actuallyChanged
                    && capS.audioSwitch.targetIndex === capM.audioSwitch.targetIndex
                    && capS.audioSwitch.serverIndex === capM.audioSwitch.serverIndex,
                    JSON.stringify(capS.audioSwitch), JSON.stringify(capM.audioSwitch)]);
            }
            if (options?.hasEmbedSub || options?.hasExtSub) {
                rows_.push(['g', 'subtitle switch (forced to a genuinely different track) + render',
                    capS.subtitleSwitch?.actuallyChanged && capM.subtitleSwitch?.actuallyChanged
                    && capS.subtitleSwitch.targetIndex === capM.subtitleSwitch.targetIndex
                    && capS.subtitleSwitch.mechanism !== 'none-observed' && capM.subtitleSwitch.mechanism !== 'none-observed'
                    && capS.subtitleSwitch.mechanism === capM.subtitleSwitch.mechanism,
                    JSON.stringify(capS.subtitleSwitch), JSON.stringify(capM.subtitleSwitch)]);
                rows_.push(['h', 'subtitle off', !!capS.subtitleOff?.overlayEmpty && !!capS.subtitleOff?.noneShowing && !!capS.subtitleOff?.isOff
                && !!capM.subtitleOff?.overlayEmpty && !!capM.subtitleOff?.noneShowing && !!capM.subtitleOff?.isOff,
                JSON.stringify(capS.subtitleOff), JSON.stringify(capM.subtitleOff)]);
            }
            rows_.push(['i', 'stop and resume', withinSeconds(capS.stoppedPositionTicks, capM.stoppedPositionTicks, 9999999) && capS.resumeOffered && capM.resumeOffered
            && withinSeconds(capS.resumePositionTicks, capS.stoppedPositionTicks, 5) && withinSeconds(capM.resumePositionTicks, capM.stoppedPositionTicks, 5),
            JSON.stringify({ stopped: capS.stoppedPositionTicks, resumeOffered: capS.resumeOffered, resumed: capS.resumePositionTicks }),
            JSON.stringify({ stopped: capM.stoppedPositionTicks, resumeOffered: capM.resumeOffered, resumed: capM.resumePositionTicks })]);
            rows_.push(['j', 'single reporting (no duplicate Playing/Stopped)', capS.playingCount === 1 && capM.playingCount === 1 && capS.stoppedCount === 1 && capM.stoppedCount === 1, `playing:${capS.playingCount} stopped:${capS.stoppedCount}`, `playing:${capM.playingCount} stopped:${capM.stoppedCount}`]);

            for (const [rowId, label, pass, sVal, mVal] of rows_) {
                pushRow(`${name}-${rowId}`, 'Playback', `${fixture.title ?? fixture.id} (${fixture.id}): ${label}`, sVal, mVal, pass ? 'PASS' : 'FAIL',
                    pass ? undefined : `stock: ${sVal}\nmod: ${mVal}`);
            }
        } catch (error) {
            pushRow(name, 'Playback', `${fixture?.title ?? name}: fixture run`, 'n/a', 'n/a', 'FAIL', error.message);
            await restoreUserData(fixture.id).catch(ignore);
        }
    };

    if (!aborted && !skipPlayback) {
        await step('C: playback fixtures', async () => {
            const plan = [
                ['C-4KHDR', { seekOnly: true }],
                ['C-1080', {}],
                ['C-MULTIAUDIO', { hasMultiAudio: true }],
                ['C-EMBEDSUB', { hasEmbedSub: true }],
                ['C-EXTSUB', { hasExtSub: true }],
                ['C-M2TS', { hasMultiAudio: true, hasEmbedSub: true, hasExtSub: true }],
                ['C-AVI', { hasMultiAudio: true, hasEmbedSub: true, hasExtSub: true }]
            ];
            const activePlan = quick ? plan.filter(([name]) => ['C-1080', 'C-MULTIAUDIO'].includes(name)) : plan;
            for (const [name, options] of activePlan) {
                await runFixtureBothSides(name, fixtures[name], options);
            }

            // C-TVNEXT: play to near the end, let it end, record what each side does.
            if (!quick) {
                const tvFixture = fixtures['C-TVNEXT'];
                if (!tvFixture) {
                    pushRow('C-TVNEXT', 'Playback', 'C-TVNEXT', 'n/a', 'n/a', 'SKIPPED', 'no eligible series/season found');
                } else {
                    try {
                        const episodeRef = (await S.apiRequest(`Items/${tvFixture.id}`)).body;
                        const runtimeSeconds = (episodeRef?.RunTimeTicks ?? 12000000000) / 10000000;
                        const runToEnd = async harnessSide => {
                            await snapshotUserData(tvFixture.id);
                            await harnessSide.navigate(harnessSide.base + '#/details?id=' + tvFixture.id);
                            await harnessSide.networkIdle();
                            await nativeClick(harnessSide.page.locator('.btnPlay:visible').first());
                            await harnessSide.page.waitForSelector('video', { timeout: 30000 });
                            const hashDuringPlayback = await harnessSide.page.evaluate(() => window.location.hash);
                            await harnessSide.page.evaluate(seconds_ => {
                                const v = document.querySelector('video');
                                if (v && v.duration) v.currentTime = Math.max(0, v.duration - 20);
                                else if (v) v.currentTime = Math.max(0, seconds_ - 20);
                            }, runtimeSeconds);
                            // Wait until either the video reports ended, or the app navigates away on its own
                            // (auto-advance to the next episode, or back to details) — whichever happens first.
                            const landed = await poll(() => harnessSide.page.evaluate(() => ({
                                hash: window.location.hash,
                                ended: document.querySelector('video')?.ended ?? false
                            })), r => r.ended || r.hash !== hashDuringPlayback, { timeout: 40000, interval: 1000 });
                            await restoreUserData(tvFixture.id);
                            return landed;
                        };
                        const landedS = await runToEnd(S);
                        const landedM = await runToEnd(M);
                        const same = landedS.hash === landedM.hash || (landedS.ended === landedM.ended);
                        pushRow('C-TVNEXT', 'Playback', `${tvFixture.title}: end-of-episode behaviour`, JSON.stringify(landedS), JSON.stringify(landedM), same ? 'PASS' : 'FAIL');
                    } catch (error) {
                        pushRow('C-TVNEXT', 'Playback', 'C-TVNEXT', 'n/a', 'n/a', 'FAIL', error.message);
                    }
                }
            }

            // C-TWOVER: explicit version selection must be honoured, and map identically on both sides.
            const twoVer = fixtures['C-TWOVER'];
            if (!twoVer) {
                pushRow('C-TWOVER', 'Playback', 'C-TWOVER', 'n/a', 'n/a', 'SKIPPED', 'no title with >=2 MediaSources (§8.4 known in-flight defect)');
            } else {
                try {
                    await snapshotUserData(twoVer.id);
                    const mapping = async harnessSide => {
                        const result = {};
                        for (const source of twoVer.sources) {
                            await harnessSide.navigate(harnessSide.base + '#/details?id=' + twoVer.id);
                            await harnessSide.networkIdle();
                            const select = harnessSide.page.locator('select.selectSource');
                            await select.selectOption(source.id).catch(() => {});
                            await sleep(300);
                            const marker = Date.now();
                            await nativeClick(harnessSide.page.locator('.btnPlay:visible').first());
                            await harnessSide.page.waitForSelector('video', { timeout: 30000 }).catch(() => {});
                            const playingReq = await waitForRequestMatching(harnessSide, e => e.method === 'POST' && new URL(e.url).pathname === '/Sessions/Playing', { since: marker, timeout: 15000 });
                            result[source.id] = playingReq ? parsePostData(playingReq)?.MediaSourceId ?? null : null;
                            await harnessSide.navigate(harnessSide.base + '#/details?id=' + twoVer.id); // stop: see the Stop comment in playFixtureOnSide
                            await waitForRequestMatching(harnessSide, e => e.method === 'POST' && new URL(e.url).pathname === '/Sessions/Playing/Stopped', { since: marker, timeout: 10000 });
                            await harnessSide.networkIdle();
                        }
                        return result;
                    };
                    const mapS = await mapping(S);
                    const mapM = await mapping(M);
                    await restoreUserData(twoVer.id);
                    const honoured = twoVer.sources.every(s => normId(mapS[s.id] ?? '') === normId(s.id) && normId(mapM[s.id] ?? '') === normId(s.id));
                    const sameMapping = JSON.stringify(mapS) === JSON.stringify(mapM);
                    pushRow('C-TWOVER', 'Playback', `${twoVer.title} (${twoVer.id}): version selection honoured`, JSON.stringify(mapS), JSON.stringify(mapM), honoured && sameMapping ? 'PASS' : 'FAIL');
                } catch (error) {
                    pushRow('C-TWOVER', 'Playback', 'C-TWOVER', 'n/a', 'n/a', 'FAIL', error.message);
                    await restoreUserData(twoVer.id).catch(ignore);
                }
            }
        });
    } else if (skipPlayback) {
        pushRow('C', 'Playback', 'Entire playback area', 'n/a', 'n/a', 'SKIPPED', 'JELLYFINMOD_PARITY_SKIP_PLAYBACK=true (never valid for an acceptance run)');
    }

    // =================================================================================================
    // Area D — user-data parity (PARITY.md §6, Area D)
    // =================================================================================================
    if (!aborted) {
        await step('D: user-data parity', async () => {
            try {
                const movieItem = b0Sample[0];
                const seriesForEpisode = [...a2.tv.ref].sort((a, b) => a.Id.localeCompare(b.Id))[0];
                const episodeItem = seriesForEpisode ? ((await S.apiRequest(`Shows/${seriesForEpisode.Id}/Episodes`)).body?.Items ?? [])[0] : null;
                const targets = [movieItem && { id: movieItem.Id, label: `movie ${movieItem.Name}` }, episodeItem && { id: episodeItem.Id, label: `episode ${episodeItem.Name}` }].filter(Boolean);
                if (!targets.length) {
                    pushRow('D', 'User data', 'D', 'n/a', 'n/a', 'SKIPPED', 'no sampled movie or episode available');
                }
                for (const target of targets) {
                    await snapshotUserData(target.id);
                    for (const [dir, actor, observer] of [['S to M', S, M], ['M to S', M, S]]) {
                        const actorPage = actor.page;
                        const countPosts = (harnessSide, pathname, since) => harnessSide.requestLog.filter(e => e.t >= since && e.method === 'POST' && new URL(e.url).pathname.includes(pathname)).length;

                        // D-1/D-2: watched / unwatched
                        let since = Date.now();
                        await setUserData(actorPage, target.id, { played: true });
                        await sleep(300);
                        const playedOnServer = (await S.apiRequest(`Items/${target.id}?userId=${userId}`)).body?.UserData?.Played === true;
                        await observer.reload();
                        const playedOnObserver = await observer.page.evaluate(id => window.ApiClient.getItem(window.ApiClient.getCurrentUserId(), id), target.id).then(i => i.UserData?.Played === true);
                        pushRow('D-1', 'User data', `${target.label}: mark watched (${dir})`, `server:${playedOnServer}`, `observer(${observer.label}):${playedOnObserver}`, playedOnServer && playedOnObserver ? 'PASS' : 'FAIL');

                        since = Date.now();
                        await setUserData(actorPage, target.id, { played: false });
                        await sleep(300);
                        const unplayedOnServer = (await S.apiRequest(`Items/${target.id}?userId=${userId}`)).body?.UserData?.Played === false;
                        await observer.reload();
                        const unplayedOnObserver = await observer.page.evaluate(id => window.ApiClient.getItem(window.ApiClient.getCurrentUserId(), id), target.id).then(i => i.UserData?.Played === false);
                        pushRow('D-2', 'User data', `${target.label}: mark unwatched (${dir})`, `server:${unplayedOnServer}`, `observer(${observer.label}):${unplayedOnObserver}`, unplayedOnServer && unplayedOnObserver ? 'PASS' : 'FAIL');
                        void since;

                        // D-3/D-4: favourite / unfavourite
                        await setUserData(actorPage, target.id, { favorite: true });
                        await sleep(300);
                        const favOnServer = (await S.apiRequest(`Items/${target.id}?userId=${userId}`)).body?.UserData?.IsFavorite === true;
                        await observer.reload();
                        const favOnObserver = await observer.page.evaluate(id => window.ApiClient.getItem(window.ApiClient.getCurrentUserId(), id), target.id).then(i => i.UserData?.IsFavorite === true);
                        pushRow('D-3', 'User data', `${target.label}: favourite (${dir})`, `server:${favOnServer}`, `observer(${observer.label}):${favOnObserver}`, favOnServer && favOnObserver ? 'PASS' : 'FAIL');

                        await setUserData(actorPage, target.id, { favorite: false });
                        await sleep(300);
                        const unfavOnServer = (await S.apiRequest(`Items/${target.id}?userId=${userId}`)).body?.UserData?.IsFavorite === false;
                        await observer.reload();
                        const unfavOnObserver = await observer.page.evaluate(id => window.ApiClient.getItem(window.ApiClient.getCurrentUserId(), id), target.id).then(i => i.UserData?.IsFavorite === false);
                        pushRow('D-4', 'User data', `${target.label}: unfavourite (${dir})`, `server:${unfavOnServer}`, `observer(${observer.label}):${unfavOnObserver}`, unfavOnServer && unfavOnObserver ? 'PASS' : 'FAIL');
                        void countPosts;
                    }
                    await restoreUserData(target.id);
                }
            } catch (error) {
                pushRow('D', 'User data', 'D', 'n/a', 'n/a', 'FAIL', error.message);
            }
        });
    }

    // =================================================================================================
    // Area E — mod-only surfaces are additive; stock is unchanged (PARITY.md §6, Area E)
    // =================================================================================================
    if (!aborted) {
        await step('E: mod-only surfaces and stock-unchanged', async () => {
            try {
                // E-1: file-state marks — recorded, not required, on either side.
                const marksS = await pageS.evaluate(() => document.querySelectorAll('[class*="jfmod-fileMark" i], [class*="jfmod-file-state" i]').length);
                const marksM = await pageM.evaluate(() => document.querySelectorAll('[class*="jfmod-fileMark" i], [class*="jfmod-file-state" i]').length);
                pushRow('E-1', 'Mod-only', 'File-state marks present (recorded)', marksS, marksM, 'RECORDED');

                // E-3: Queue reachable from the mod user menu.
                await M.navigate(baseM + '#/catalog/queue');
                await M.networkIdle();
                const queueOk = await pageM.evaluate(() => document.body.textContent.trim().length > 20 && !document.querySelector('.errorMessage:not(.hide)'));
                pushRow('E-3', 'Mod-only', 'Queue reachable at #/catalog/queue on mod', queueOk ? 'n/a (mod-only)' : 'n/a', queueOk, queueOk ? 'PASS' : 'FAIL');

                // E-4: search shows Add-from-TMDB zone plus upstream's own result sections; upstream section id sets equal stock's.
                const query = a2.movies.ref[0]?.Name?.split(' ')[0] ?? 'the';
                await S.navigate(baseS + '#/search?query=' + encodeURIComponent(query));
                await S.networkIdle();
                const idsS = await S.shownIds();
                await M.navigate(baseM + '#/search?query=' + encodeURIComponent(query));
                await M.networkIdle();
                const idsM = await M.shownIds();
                const discoveryPresent = await pageM.evaluate(() => !!document.querySelector('.jfmod-discovery'));
                const upstreamDiff = describeSetDiff('E-4 search upstream sections', idsS, idsM);
                pushRow('E-4', 'Mod-only', `Search "${query}": Add-from-TMDB zone present + upstream results match`, `${idsS.length} ids`, `discovery:${discoveryPresent}, ${idsM.length} ids`, discoveryPresent && upstreamDiff.equal ? 'PASS' : 'FAIL', upstreamDiff.text);

                // E-6: plugin transport blocked — mod shell must still render a usable native list and detail page.
                const pluginRoute = '**/JellyfinMod/**';
                const blockPlugin = route => route.abort('blockedbyclient');
                await pageM.route(pluginRoute, blockPlugin);
                await M.navigate(baseM + '#/movies?topParentId=' + moviesViewId);
                await M.networkIdle();
                const rendersWithoutPlugin = await pageM.evaluate(() => document.querySelectorAll('.card[data-id]').length > 0);
                let detailUsable = false;
                if (b0Sample[0]) {
                    await M.navigate(baseM + '#/details?id=' + b0Sample[0].Id);
                    await M.networkIdle();
                    detailUsable = await pageM.evaluate(() => !!document.querySelector('.itemName') && !!document.querySelector('.btnPlay'));
                }
                await pageM.unroute(pluginRoute, blockPlugin);
                pushRow('E-6', 'Mod-only', 'Degrades cleanly with plugin transport blocked (UX §14)', 'n/a', `grid:${rendersWithoutPlugin} detail:${detailUsable}`, rendersWithoutPlugin && detailUsable ? 'PASS' : 'FAIL');

                // E-7: no request outside /JellyfinMod/** carries a catalog entry id or "pending:".
                const entries = await S.apiRequest('JellyfinMod/Entries?limit=200');
                const entryIds = new Set((entries.body?.items ?? []).map(e => String(e.id).replace(/-/g, '').toLowerCase()));
                const leakCheck = harnessSide => harnessSide.allRequestUrls.filter(url => {
                    let parsed;
                    try { parsed = new URL(url); } catch { return false; }
                    if (parsed.pathname.includes('/JellyfinMod/') || parsed.host !== testUrl.host) return false;
                    const text = decodeURIComponent(parsed.pathname + parsed.search).replace(/-/g, '').toLowerCase();
                    return [...entryIds].some(id => text.includes(id)) || text.includes('pending:');
                });
                const leakedS = leakCheck(S);
                const leakedM = leakCheck(M);
                pushRow('E-7', 'Mod-only', 'No id leak outside /JellyfinMod/** on either tab', leakedS.length, leakedM.length, !leakedS.length && !leakedM.length ? 'PASS' : 'FAIL', JSON.stringify([...leakedS, ...leakedM].slice(0, 10)));

                // E-5: stock-unchanged spot check — re-verify A1's Movies total on stock alone.
                const totalNow = (await S.apiRequest(`Items?ParentId=${moviesViewId}&Recursive=true&IncludeItemTypes=Movie&Limit=0`)).body?.TotalRecordCount;
                pushRow('E-5', 'Mod-only', 'Stock Movies total re-checked alone matches paired run', a2.movies.ref.length, totalNow, totalNow === a2.movies.ref.length ? 'PASS' : 'FAIL');
            } catch (error) {
                pushRow('E', 'Mod-only', 'E', 'n/a', 'n/a', 'FAIL', error.message);
            }
        });
    }

    // =================================================================================================
    // Area F — TV layout: record, do not require (PARITY.md §6, Area F)
    // =================================================================================================
    if (!aborted && !quick) {
        await step('F: TV layout (recorded)', async () => {
            try {
                await pageS.evaluate(() => localStorage.setItem('layout', 'tv'));
                for (const [w, h] of [[1920, 1080], [1280, 720]]) {
                    for (const harnessSide of [S, M]) {
                        await harnessSide.page.setViewportSize({ width: w, height: h });
                        await harnessSide.reload();
                        const rendered = await harnessSide.page.evaluate(() => document.body.textContent.trim().length > 20);
                        const legacyHeader = await harnessSide.page.evaluate(() => !!document.querySelector('.skinHeader'));
                        let navigable = false;
                        if (rendered) {
                            await harnessSide.pressKey('ArrowRight').catch(() => {});
                            await harnessSide.pressKey('ArrowDown').catch(() => {});
                            navigable = await harnessSide.page.evaluate(() => document.activeElement !== document.body);
                        }
                        pushRow('F', 'TV layout', `${harnessSide.label} at ${w}x${h}: renders/legacy-header/navigable`, harnessSide === S ? `${rendered}/${legacyHeader}/${navigable}` : undefined, harnessSide === M ? `${rendered}/${legacyHeader}/${navigable}` : undefined,
                            'EXPECTED-FALLBACK');
                    }
                }
                knownGapsObserved.push('Area F (TV layout) recorded per PARITY.md §8.3/Area F: ModAppLayout deliberately falls back to LegacyAppLayout on TV. Not asserted as pass/fail.');
            } catch (error) {
                pushRow('F', 'TV layout', 'F', 'n/a', 'n/a', 'FAIL', error.message);
            } finally {
                for (const harnessSide of [S, M]) await harnessSide.page.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
                await pageS.evaluate(() => localStorage.removeItem('layout')).catch(() => {});
                await S.reload().catch(() => {});
                await M.reload().catch(() => {});
            }
        });
    }

    // =================================================================================================
    // Area G — reachability smoke for stock-for-now screens (PARITY.md §6, Area G)
    // =================================================================================================
    if (!aborted) {
        await step('G: reachability smoke', async () => {
            try {
                for (const route of ['#/music', '#/livetv', '#/books', '#/playlists', '#/boxsets', '#/dashboard', '#/mypreferencesmenu']) {
                    await M.navigate(baseM + route);
                    await M.networkIdle();
                    const ok = await pageM.evaluate(() => document.body.textContent.trim().length > 0);
                    const hasError = await pageM.evaluate(() => !!document.querySelector('.errorMessage:not(.hide)'));
                    pushRow('G', 'Reachability', `Mod ${route} renders without an uncaught exception`, 'n/a (mod-only smoke)', ok && !hasError, ok && !hasError ? 'PASS' : 'FAIL');
                }
            } catch (error) {
                pushRow('G', 'Reachability', 'G', 'n/a', 'n/a', 'FAIL', error.message);
            }
        });
    }
} catch (unexpectedError) {
    aborted = true;
    console.error('UNEXPECTED: ' + (unexpectedError?.stack ?? unexpectedError?.message ?? unexpectedError));
    pushRow('unexpected', 'Run', 'Unhandled error', 'n/a', 'n/a', 'FAIL', String(unexpectedError?.stack ?? unexpectedError));
} finally {
    // -----------------------------------------------------------------------------------------
    // §7 restoration and hygiene — must run even on an aborted/partial run.
    // -----------------------------------------------------------------------------------------
    let cleanupFailed = false;
    try {
        const restored = await restoreAllUserData();
        await fs.writeFile(path.join(outDir, 'restore-actions.json'), JSON.stringify(restored, null, 2));
        const mismatches = await verifyRestoration();
        if (mismatches.length) {
            cleanupFailed = true;
            for (const m of mismatches) {
                pushRow('cleanup', 'Cleanup', `UserData restore: item ${m.itemId} field ${m.field}`, m.expected, m.observed, 'CLEANUP-FAILED');
            }
        } else if (userDataSnapshots.size) {
            pushRow('cleanup', 'Cleanup', `UserData restored and verified for ${userDataSnapshots.size} item(s)`, 'restored', 'restored', 'PASS');
        }
    } catch (error) {
        cleanupFailed = true;
        pushRow('cleanup', 'Cleanup', 'UserData restore', 'n/a', 'n/a', 'CLEANUP-FAILED', error.message);
    }

    // No JellyfinMod-prefixed title anywhere, and the plugin's own entry set is unchanged (this run creates none).
    try {
        const leaked = await S.apiRequest('Items?searchTerm=JellyfinMod&Recursive=true');
        const leakedNames = (leaked.body?.Items ?? []).map(i => i.Name);
        if (leakedNames.length) {
            cleanupFailed = true;
            pushRow('cleanup', 'Cleanup', 'No JellyfinMod-prefixed title in any library', 'none expected', JSON.stringify(leakedNames), 'CLEANUP-FAILED');
        } else {
            pushRow('cleanup', 'Cleanup', 'No JellyfinMod-prefixed title in any library', 'none', 'none', 'PASS');
        }
        const entriesAfter = await S.apiRequest('JellyfinMod/Entries?limit=200');
        const idsBefore = new Set((JSON.parse(await fs.readFile(path.join(outDir, 'entries-before.json'), 'utf8').catch(() => '{"items":[]}')).items ?? []).map(e => e.id));
        const idsAfter = new Set((entriesAfter.body?.items ?? []).map(e => e.id));
        const sameEntries = idsBefore.size === idsAfter.size && [...idsBefore].every(id => idsAfter.has(id));
        pushRow('cleanup', 'Cleanup', 'JellyfinMod/Entries set unchanged', idsBefore.size + ' entries', idsAfter.size + ' entries', sameEntries ? 'PASS' : 'CLEANUP-FAILED');
        if (!sameEntries) cleanupFailed = true;
    } catch (error) {
        pushRow('cleanup', 'Cleanup', 'Hygiene assertions', 'n/a', 'n/a', 'CLEANUP-FAILED', error.message);
        cleanupFailed = true;
    }

    // Restore the layout key on both tabs (§1.3, §7).
    try {
        for (const [side, original] of [[pageS, originalLayoutS], [pageM, originalLayoutM]]) {
            await side.evaluate(value => (value === null || value === undefined ? localStorage.removeItem('layout') : localStorage.setItem('layout', value)), original).catch(ignore);
        }
    } catch { /* best effort */ }

    // Restore the /web takeover to what it was before this run, and verify.
    try {
        if (report.takeover.before) {
            const wanted = report.takeover.before.TakeoverEnabled;
            await setTakeover(wanted);
            await sleep(500);
            const after = (await getInterfaceSettings()).body;
            report.takeover.after = { TakeoverEnabled: after?.TakeoverEnabled, BundleId: after?.BundleId };
            // Verify /web actually serves what the takeover flag now claims.
            await S.reload({ ignoreCache: true }).catch(ignore);
            const servesModAfter = await pageS.evaluate(() => window.__jfmodBundle === true).catch(() => 'unknown');
            report.takeover.webServesModAfterRestore = servesModAfter;
            const restoredOk = after?.TakeoverEnabled === wanted && (wanted ? servesModAfter === true : servesModAfter !== true);
            pushRow('takeover', 'Cleanup', 'Restore /web takeover to pre-run state', JSON.stringify(report.takeover.before), JSON.stringify(report.takeover.after), restoredOk ? 'PASS' : 'CLEANUP-FAILED');
            if (!restoredOk) cleanupFailed = true;
        }
    } catch (error) {
        cleanupFailed = true;
        pushRow('takeover', 'Cleanup', 'Restore /web takeover', 'n/a', 'n/a', 'CLEANUP-FAILED', error.message);
    }

    // -----------------------------------------------------------------------------------------
    // Write the report and the machine summary (§11).
    // -----------------------------------------------------------------------------------------
    timings.total = seconds(Date.now() - runStarted);
    const verdictCounts = rows.reduce((acc, row) => { acc[row.verdict] = (acc[row.verdict] ?? 0) + 1; return acc; }, {});
    const summary = {
        mode: quick ? 'quick' : 'full',
        fullAcceptance: !quick && !aborted && !gateFailed,
        aborted,
        gateFailed,
        continuedPastGate: continuePastGate,
        ...(gateFailed && continuePastGate ? {
            gateNote: 'PARITY.md\'s A1/preflight gate FAILED. This run was started with JELLYFINMOD_PARITY_CONTINUE_PAST_GATE=true, a non-plan escape hatch, so it kept going past the gate to gather supplementary diagnostic evidence for the remaining areas. Per PARITY.md §11.3 this can NEVER count as a passing or accepted run — the gate failure alone already fails it.'
        } : {}),
        browser: browserInfo,
        // State the tier that actually ran and let the reader judge it. Only the "chrome" tier is real
        // Google Chrome; an attached browser is whatever someone else launched, and the bundled Chromium
        // is not Chrome. Claiming chrome-tier acceptance for any other tier is how a run gets misread.
        acceptanceEvidence: browserTier === 'chrome' ?
            'Launched real Google Chrome (Playwright channel "chrome") in a dedicated profile ('
                + JSON.stringify(browserInfo) + '); this run is chrome-tier acceptance evidence.' :
            browserTier === 'chromium' ?
                'Launched Playwright\'s bundled Chromium (' + JSON.stringify(browserInfo)
                    + '). Iteration evidence only: the workspace rules require the same checks to pass on real Google Chrome before anything is called accepted.' :
                'Attached over CDP to an already-running browser at ' + cdpUrl + ' (' + JSON.stringify(browserInfo)
                    + '). This run did not launch the browser, so it cannot assert which build it was; treat it as chrome-tier evidence only if the attached browser is verified to be real Google Chrome.',
        takeover: report.takeover,
        header: report.header,
        verdictCounts,
        rows, skipped, knownGapsObserved,
        timings, waits, idleTimeouts,
        cleanupFailed
    };
    await fs.writeFile(path.join(outDir, 'parity-summary.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));

    try {
        await writeMarkdownReport(summary);
    } catch (error) {
        console.error('Failed to write markdown report: ' + error.message);
    }

    summarized = true;
    if (cleanupFailed) process.exitCode = 1;
    else if (aborted || verdictCounts.FAIL) process.exitCode = 1;
    else if (skipped.length && !allowSkips) process.exitCode = 2;
    else process.exitCode = 0;

    await pageM.close().catch(ignore);
    await pageS.close().catch(ignore);
    // CDP attach: this disconnects the Playwright client only. The dedicated Chrome and its
    // signed-in profile stay running for whoever else uses it.
    if (browserTier) await context.close().catch(ignore);
    else await browser.close().catch(ignore);
}
/* eslint-enable compat/compat, @stylistic/max-statements-per-line, no-empty-function, sonarjs/cognitive-complexity, no-nested-ternary, sonarjs/no-nested-conditional, @typescript-eslint/no-unused-vars, sonarjs/no-dead-store, sonarjs/no-unused-vars, no-restricted-globals, @typescript-eslint/no-shadow, sonarjs/void-use, sonarjs/no-os-command-from-path, sonarjs/slow-regex -- closes the file-level exemption above */
