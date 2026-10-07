/* eslint-disable compat/compat, no-restricted-globals, sonarjs/cognitive-complexity, @stylistic/max-statements-per-line -- a Node acceptance runner, not shipped code */
/* global window, document, ApiClient, location, Event */
// Whole-review web findings (chunks 4a, 4b, 4c) on the acceptance instance, signed in as oleksii with an empty password.
//
// Every check drives the built bundle in a real browser against the running server. Where a check needs a fault or a race
// that a live server cannot be asked for (a refresh that fails, a row that a poll removes, a response that lands late), it
// shapes the real traffic: aborts a request, delays a real response, or drops one row from a real response. Nothing is
// invented. Settings it changes are restored in a finally and read back, and every grab it makes is cancelled during its
// hold, by the interface or by a guard that runs in this runner, not in the browser (see grabGuard).
//
// Known limits of this harness (final web review 2, findings 2 and 5). Run it only on the isolated acceptance instance,
// after backing up its plugin database, configuration and secrets.
//  - The grab guard cancels a grab a fixed time after it first sees it (poll or answer), not from the grab's stored
//    creation time; a poll delayed by seconds can leave less margin than intended. A cancellation it cannot confirm turns
//    grabbing off, which the server checks again before sending.
//  - Restoration state lives in this process. A run killed part-way can leave a review client, a review Prowlarr source,
//    changed settings or grabbing turned off. The manual restore: put the backed-up plugin database, bundle, configuration
//    and secrets back with the instance stopped, then compare the configuration with its backup), run the live helper's
//    cleanup, one command per call (whole-review-live.py login, then cleanup, then views, then logout), and check
//    /UserViews shows only the instance's own libraries and the catalog has no "JellyfinMod Review" entry; an entry for the
//    wanted series created by a killed wantedseries command is not in the manifest and is removed by hand.
//  - Placeholder secrets are stored only on records this run creates (its second download client and its Prowlarr
//    source), which are deleted by id afterwards; a route guard aborts any secret write to any other record.
//
//   JELLYFINMOD_TEST_URL=http://<host>:28096/ JELLYFINMOD_REVIEW_ITEM=<native id> JELLYFINMOD_REVIEW_LIBRARY=<library id>
//   JELLYFINMOD_SERIES_ENTRY=<file-less series entry id> [JELLYFINMOD_WANTED_ENTRY=<file-less movie entry id>]
//   [JELLYFINMOD_CHECKS=focus,librarySelect,...] [JELLYFINMOD_BROWSER=chrome]
//     node whole-review-web.mjs
import { chromium } from 'playwright';

const origin = new URL(process.env.JELLYFINMOD_TEST_URL ?? (() => { throw new Error('JELLYFINMOD_TEST_URL is required'); })());
if (origin.port !== '28096') throw new Error('Runs only against the acceptance instance');
const env = name => process.env[name] ?? (() => { throw new Error(name + ' is required'); })();
const ITEM = env('JELLYFINMOD_REVIEW_ITEM');
const LIBRARY = env('JELLYFINMOD_REVIEW_LIBRARY');
const SERIES = env('JELLYFINMOD_SERIES_ENTRY');
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
const only = (process.env.JELLYFINMOD_CHECKS ?? '').split(',').filter(Boolean);
const base = (path = '/web/') => new URL(path, origin).href;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const results = [];
const record = (finding, check, pass, detail = '') => {
    results.push({ finding, check, pass });
    console.log(`${pass ? 'PASS' : 'FAIL'} [${finding}] ${check}${detail ? ' — ' + String(detail).slice(0, 300) : ''}`);
};

/**
 * Runs one restore step of a check's fixtures on its own: a step that throws or reports failure is recorded as a failed
 * check, which fails the run, and the steps after it still run (Codex delta review 6, P2 5).
 */
async function restoreStep(name, step) {
    try {
        const outcome = await step();
        if (outcome !== true) record('restore', name, false, typeof outcome === 'string' ? outcome : JSON.stringify(outcome));
    } catch (error) {
        record('restore', name, false, String(error.message).split('\n')[0]);
    }
}

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
    await page.waitForFunction(() => location.hash.startsWith('#/home'), undefined, { timeout: 30000 });
    await page.waitForTimeout(1500);
}

const api = (page, method, path, body) => page.evaluate(async ({ method, path, body }) => {
    const response = await fetch(ApiClient.getUrl(path), {
        // Marked, so a check can tell its own setup and cleanup traffic from requests the page makes.
        method, headers: { Authorization: `MediaBrowser Token="${ApiClient.accessToken()}"`, 'X-JellyfinMod-Check': '1',
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    let parsed = text;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    return { status: response.status, body: parsed };
}, { method, path, body });

const go = async (page, hash) => {
    await page.evaluate(target => { location.hash = target; }, hash);
    await page.waitForTimeout(1500);
};

// JELLYFINMOD_MOBILE=1 runs the desktop checks in a phone-sized touch viewport instead.
const MOBILE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36' };

async function session(browser, layout = 'desktop', size = { width: 1920, height: 1080 }) {
    const desktop = process.env.JELLYFINMOD_MOBILE ? MOBILE : { viewport: { width: 1440, height: 900 } };
    const context = await browser.newContext({ ...(layout === 'tv' ? { viewport: size } : desktop),
        serviceWorkers: 'block' });
    const page = await context.newPage();
    // A client password the page sends goes only to a client this run made (final web review 2, P2 4): a write that would
    // replace or clear any other client's password is aborted, whatever a check asserts. A check's own handlers fall back
    // to this one.
    await page.route(/\/JellyfinMod\/Settings\/DownloadClients(\/[^/?]+)?(\?.*)?$/, route => {
        const request = route.request();
        if (!/^(PATCH|POST)$/.test(request.method()) || request.headers()['x-jellyfinmod-check']) return route.fallback();
        let body = null;
        try { body = request.postDataJSON(); } catch { /* not JSON */ }
        if (!body?.password || body.password.action === 'unchanged') return route.fallback();
        const id = new URL(request.url()).pathname.split('/').pop();
        return request.method() === 'PATCH' && OWNED_CLIENTS.has(id) ? route.fallback() : route.abort();
    });
    page.errors = [];
    page.on('pageerror', error => page.errors.push(String(error.message).split('\n')[0]));
    await signIn(page);
    if (layout === 'tv') {
        await page.evaluate(() => localStorage.setItem('layout', 'tv'));
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } }, undefined, { timeout: 30000 });
        await page.waitForTimeout(2500);
    }
    return { context, page };
}

/** Closes a session, dropping any route handler still holding a response. */
const closeAll = async context => {
    for (const open of context.pages()) await open.unrouteAll({ behavior: 'ignoreErrors' });
    await context.close();
};

const checks = {};

// 4a P2 2: the mod's raised buttons carry show-focus on the TV, so the focused one is painted.
checks.focus = async browser => {
    const { context, page } = await session(browser, 'tv');
    await go(page, `#/details?id=${ITEM}`);
    await page.waitForSelector('[data-jfmod-remove-version]', { timeout: 30000 });
    await page.waitForTimeout(1500);
    const shape = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('.jfmod-nativeEntryDetails button.emby-button, [data-jfmod-remove-version], .jfmod-versionsMount button.emby-button'));
        const style = node => { const s = getComputedStyle(node); return [s.transform, s.backgroundColor, s.color, s.boxShadow].join('|'); };
        const target = document.querySelector('[data-jfmod-remove-version]');
        const other = document.querySelectorAll('[data-jfmod-remove-version]')[1];
        other?.focus();
        const unfocused = style(target);
        target.focus();
        const focused = style(target);
        return { count: buttons.length, missing: buttons.filter(button => !button.classList.contains('show-focus')).map(button => button.textContent.trim().slice(0, 30)), changed: unfocused !== focused };
    });
    record('4a-2', 'every mod action button on the TV detail page has show-focus', shape.count > 1 && shape.missing.length === 0,
        `${shape.count} buttons, without: ${shape.missing.join(' | ')}`);
    record('4a-2', 'the focused Remove this version is painted differently from an unfocused one', shape.changed);
    await closeAll(context);
};

// 4a P2 3: global search's library selectors are emby-select, which a webOS remote can open.
checks.librarySelect = async browser => {
    const { context, page } = await session(browser);
    await go(page, '#/search?query=' + encodeURIComponent('The Matrix'));
    await page.waitForSelector('.jfmod-discovery', { timeout: 60000 });
    await page.waitForFunction(() => !document.querySelector('.jfmod-discovery[aria-busy="true"]'), undefined, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(2000);
    const selects = await page.evaluate(() => Array.from(document.querySelectorAll('.jfmod-discoveryHeading select'))
        .map(select => select.getAttribute('is') ?? 'native'));
    record('4a-3', 'each library selector in Add from TMDB is an emby-select', selects.length > 0 && selects.every(kind => kind === 'emby-select'),
        selects.join(', ') || 'no selector');
    await closeAll(context);
};

/** Opens the series' picker and searches the given episode; returns the eligible rows' count. */
async function openPicker(page, episodeId) {
    await go(page, `#/details?entryId=${SERIES}`);
    const search = page.locator('button', { hasText: 'Search releases' }).first();
    await search.waitFor({ state: 'visible', timeout: 30000 });
    await search.click();
    await page.waitForSelector('.jfmod-releasePicker', { timeout: 15000 });
    await page.locator('#jfmod-releaseEpisode').selectOption(episodeId);
    await page.waitForFunction(() => !/Searching/.test(document.querySelector('.jfmod-releaseStatus')?.textContent ?? 'Searching'), undefined, { timeout: 180000 });
    return page.locator('.jfmod-releaseList .jfmod-releaseRow:not([aria-disabled="true"])').count();
}

/**
 * Calls the server from this runner, not the browser, with the session's token read once: it keeps working when the page or
 * its routes fail. Every request gives up after five seconds.
 */
const runnerCall = token => async (method, path, body) => {
    const response = await fetch(new URL(path, origin), { method, signal: AbortSignal.timeout(5000), headers: {
        Authorization: `MediaBrowser Token="${token}"`, 'X-JellyfinMod-Check': '1', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    let parsed = text;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    return { status: response.status, body: parsed };
};

/**
 * Keeps every test grab from being sent, independently of the browser (final web review, P2 5). The acceptance instance holds
 * a grab five seconds before sending it, counted from when the grab is stored (its creation itself can take seconds). The
 * guard works from this runner, with the session's token read once at setup:
 *  - a poll of the server's active grabs every 400 ms finds every pending grab of this run's own fixture entries as soon as
 *    it is stored, whether or not its answer ever reaches the page, and cancels it `ms` - 500 after it first appears;
 *  - a grab answered to the page is also cancelled `ms` after its answer arrived, whichever comes first;
 *  - a cancellation is read back; when it does not hold or cannot be read, grabbing is turned off at once and read back
 *    (the server checks the switch again when a grab commits to sending, plugin wrf.3), and the check fails;
 *  - every request it makes gives up after five seconds;
 *  - close() cancels and reads back every grab once more and records the outcome. When grabbing was turned off it waits (up
 *    to 30 s) until every test grab is in a state that can no longer be sent, and only then puts the switch back; a grab it
 *    cannot read counts as one that might still be sent.
 */
async function grabGuard(page, ms = 3000) {
    const call = runnerCall(await page.evaluate(() => ApiClient.accessToken()));
    // The switch to put back is read first; without it no grab may start, since restoring a guess could leave grabbing off
    // (Pi review 1, P2 5).
    const snapshot = await call('GET', 'JellyfinMod/Settings/Acquisition');
    const original = snapshot.body;
    if (snapshot.status !== 200 || typeof original?.enabled !== 'boolean') {
        throw new Error(`grab guard: the acquisition settings could not be read (${snapshot.status}); the check does not start`);
    }
    const fixtures = new Set([SERIES, process.env.JELLYFINMOD_WANTED_ENTRY].filter(Boolean).map(id => id.replaceAll('-', '').toLowerCase()));
    const owned = new Map(); // id -> { at: its cancellation deadline, settled: its cancellations }
    const created = [];
    const failures = [];
    let switchedOff = false;
    // Turned off only counts once it is read back off; a refused or unanswered attempt is tried again.
    const failSafe = async reason => {
        failures.push(reason);
        for (let attempt = 0; attempt < 3 && !switchedOff; attempt++) {
            const now = (await call('GET', 'JellyfinMod/Settings/Acquisition').catch(() => null))?.body;
            if (!now) continue;
            if (now.enabled) {
                await call('PATCH', 'JellyfinMod/Settings/Acquisition', { enabled: false, downloadClientId: now.downloadClientId ?? null,
                    defaultQualityProfileId: now.defaultQualityProfileId ?? null, revision: now.revision }).catch(() => null);
            }
            switchedOff = (await call('GET', 'JellyfinMod/Settings/Acquisition').catch(() => null))?.body?.enabled === false;
        }
        if (!switchedOff) failures.push('grabbing could not be turned off');
    };
    // A cancellation that does not hold turns grabbing off at once, before any retry, while the hold may still run.
    const settle = async id => {
        let state = null;
        for (let attempt = 0; attempt < 3 && state !== 'cancelled'; attempt++) {
            await call('POST', `JellyfinMod/Grabs/${id}/Cancel`).catch(() => null);
            state = (await call('GET', `JellyfinMod/Grabs/${id}`).catch(() => null))?.body?.state ?? null;
            if (state !== 'cancelled' && attempt === 0) await failSafe(`grab ${id} was ${state} after cancelling`).catch(() => null);
        }
        return state;
    };
    // The earliest of the poll's and the answer's deadlines wins: a later one adds nothing.
    const schedule = (id, delay) => {
        const at = Date.now() + Math.max(0, delay);
        const known = owned.get(id);
        if (known && known.at <= at) return;
        if (!known) created.push(id);
        owned.set(id, { at, settled: Promise.all([known?.settled, sleep(at - Date.now()).then(() => settle(id))]) });
    };
    const inflight = new Set();
    await page.route('**/JellyfinMod/Releases/Grab', route => {
        if (route.request().method() !== 'POST') return route.continue();
        const handled = (async () => {
            const response = await route.fetch();
            const body = await response.json().catch(() => null);
            if (body?.id) schedule(body.id, ms);
            await route.fulfill({ response }).catch(() => null);
        })().catch(() => null);
        inflight.add(handled);
        return handled;
    });
    const startedAt = Date.now() - 1000;
    let polling = true;
    const poller = (async () => {
        while (polling) {
            const active = (await call('GET', 'JellyfinMod/Grabs').catch(() => null))?.body;
            for (const grab of Array.isArray(active) ? active : []) {
                const entry = String(grab.entryId ?? '').replaceAll('-', '').toLowerCase();
                if (grab.state === 'pending' && fixtures.has(entry) && Date.parse(grab.createdAt) >= startedAt - 60000) schedule(grab.id, ms - 500);
            }
            await sleep(400);
        }
    })();
    return {
        created,
        async close(finding) {
            // A grab request still on its way is answered first, and the server is watched a little longer, so a grab made
            // just before the check ended is still cancelled.
            await Promise.all(inflight);
            await sleep(1500);
            polling = false;
            await poller;
            const states = [];
            for (const [id, { settled }] of owned) { await settled; states.push(await settle(id)); }
            record(finding, 'every test grab ended cancelled, nothing sent', states.every(state => state === 'cancelled') && failures.length === 0,
                `${states.join(',') || 'no grab'}${failures.length ? '; ' + failures.join('; ') : ''}`);
            if (!switchedOff) return;
            // Grabbing was turned off: it goes back on only once no test grab can still be sent. A held grab ends refused
            // when its hold runs out; one that cannot be read is not known to be safe.
            const sendable = state => state === null || state === 'pending' || state === 'submitting';
            let finals = [];
            for (let waited = 0; waited <= 30000; waited += 1000) {
                finals = await Promise.all([...owned.keys()].map(async id =>
                    (await call('GET', `JellyfinMod/Grabs/${id}`).catch(() => null))?.body?.state ?? null));
                if (!finals.some(sendable)) break;
                await sleep(1000);
            }
            if (finals.some(sendable)) {
                record(finding, 'grabbing is turned back on', false, `left off: a test grab could still be sent (${finals.join(',')})`);
                return;
            }
            await restoreStep('grabbing is turned back on', async () => {
                const now = (await call('GET', 'JellyfinMod/Settings/Acquisition')).body;
                const back = await call('PATCH', 'JellyfinMod/Settings/Acquisition', { enabled: !!original.enabled,
                    downloadClientId: now.downloadClientId ?? null, defaultQualityProfileId: now.defaultQualityProfileId ?? null,
                    revision: now.revision });
                return back.status === 200 && (await call('GET', 'JellyfinMod/Settings/Acquisition')).body?.enabled === !!original.enabled ?
                    true : `answered ${back.status}`;
            });
        }
    };
}

async function seriesEpisodes(page) {
    const detail = await api(page, 'GET', `JellyfinMod/Entries/${SERIES}`);
    return (detail.body?.episodes ?? []).filter(episode => episode.seasonNumber > 0).slice(0, 3).map(episode => episode.id);
}

// 4a P2 4: the grab's status and Cancel stay in view while a changed search runs and after it no longer lists the release.
checks.pickerStatus = async browser => {
    const { context, page } = await session(browser);
    // The guard is set up inside the try: when it cannot start, the session is still closed (Pi review 2, P3 3).
    let guard;
    try {
        guard = await grabGuard(page, 4000);
        const [first, second] = await seriesEpisodes(page);
        const rows = await openPicker(page, first);
        if (!rows) { record('4a-4', 'the picker has an eligible release to grab', false, 'no eligible release'); return; }
        // Only the page's own Cancel counts: the guard's requests come from this runner and carry X-JellyfinMod-Check.
        const pageCancels = [];
        page.on('request', request => {
            if (request.method() === 'POST' && /\/JellyfinMod\/Grabs\/[^/]+\/Cancel$/.test(new URL(request.url()).pathname)
                && !request.headers()['x-jellyfinmod-check']) pageCancels.push(request.url());
        });
        await page.locator('.jfmod-releaseList .jfmod-releaseRow:not([aria-disabled="true"])').first().click();
        if (!await page.waitForSelector('.jfmod-grabCancel', { timeout: 10000 }).then(() => true).catch(() => false)) {
            record('4a-4', 'the grab starts its hold', false, `${(await page.locator('.jfmod-releaseStatus').innerText().catch(() => '')).trim()}; `
                + (await page.locator('.jfmod-releasePicker').innerText().catch(() => '')).replaceAll('\n', ' | ').slice(0, 250));
            return;
        }
        // While the grab is still held, the search changes to another episode.
        await page.locator('#jfmod-releaseEpisode').selectOption(second);
        await page.waitForTimeout(400);
        const during = await page.evaluate(() => ({
            searching: /Searching/.test(document.querySelector('.jfmod-releaseStatus')?.textContent ?? ''),
            cancel: !!document.querySelector('.jfmod-grabCancel'),
            status: (document.querySelector('.jfmod-grabStatus')?.textContent ?? '').trim().slice(0, 80)
        }));
        record('4a-4', 'while the grab is held and the changed search runs, its status and Cancel stay shown',
            during.searching && during.cancel && !!during.status, JSON.stringify(during));
        if (during.cancel) await page.locator('.jfmod-grabCancel').click();
        await page.waitForFunction(() => /Cancelled/.test(document.querySelector('.jfmod-grabStatus')?.textContent ?? ''), undefined, { timeout: 5000 }).catch(() => {});
        const cancelled = (await page.locator('.jfmod-grabStatus').innerText().catch(() => '')).trim();
        const state = guard.created[0] ? (await api(page, 'GET', `JellyfinMod/Grabs/${guard.created[0]}`)).body?.state : 'none';
        record('4a-4', 'Cancel pressed during the changed search cancels the held grab', pageCancels.length === 1 && state === 'cancelled'
            && /Cancelled/.test(cancelled), `${pageCancels.length} page cancel(s), state ${state}, "${cancelled}"`);
        await page.waitForFunction(() => !/Searching/.test(document.querySelector('.jfmod-releaseStatus')?.textContent ?? 'Searching'), undefined, { timeout: 180000 });
        await page.waitForTimeout(1000);
        const after = (await page.locator('.jfmod-grabStatus').innerText().catch(() => '')).trim();
        record('4a-4', 'after the changed search completes, the grab status is still shown', !!after, `"${after}"`);
    } finally {
        await guard?.close('4a-4');
        await closeAll(context);
    }
};

// 4a P2 5: a poll answered late for an earlier grab never replaces the grab being followed.
checks.pickerPolls = async browser => {
    const { context, page } = await session(browser);
    let guard;
    try {
        guard = await grabGuard(page, 4300);
        const created = guard.created;
        const [first] = await seriesEpisodes(page);
        const rows = await openPicker(page, first);
        if (rows < 1) { record('4a-5', 'the picker has an eligible release', false, `${rows}`); return; }
        // Every read of the first grab is answered 3 s late (the real response, delayed).
        let firstId = null;
        await page.route('**/JellyfinMod/Grabs/*', async route => {
            const id = new URL(route.request().url()).pathname.split('/').pop();
            if (route.request().method() === 'GET' && id === firstId) {
                const response = await route.fetch();
                await sleep(3000);
                await route.fulfill({ response }).catch(() => {});
                return;
            }
            await route.continue();
        });
        const cancels = [];
        page.on('request', request => {
            const match = /\/JellyfinMod\/Grabs\/([^/]+)\/Cancel$/.exec(new URL(request.url()).pathname);
            if (request.method() === 'POST' && match) cancels.push(match[1]);
        });
        const eligible = page.locator('.jfmod-releaseList .jfmod-releaseRow:not([aria-disabled="true"])');
        await eligible.nth(0).click();
        await page.waitForSelector('.jfmod-grabCancel', { timeout: 10000 });
        firstId = created[0];
        await page.waitForTimeout(1300); // a poll for the first grab is now on its way, late
        await page.locator('.jfmod-grabCancel').click();
        await page.waitForFunction(() => !document.querySelector('.jfmod-grabCancel'), undefined, { timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(300);
        // The second grab is a new operation: another release when there is one, else the same release again.
        await eligible.nth(rows > 1 ? 1 : 0).click();
        await page.waitForFunction(() => !!document.querySelector('.jfmod-grabCancel'), undefined, { timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(2500); // the first grab's late answers land now
        const secondId = created[1];
        const cancelButton = page.locator('.jfmod-grabCancel');
        const mark = cancels.length;
        if (await cancelButton.count()) await cancelButton.click();
        await page.waitForTimeout(500);
        // The interface's own Cancel request (the guard's come from this runner and are never seen here).
        const lastCancel = cancels[mark];
        record('4a-5', 'Cancel after a late answer for the earlier grab cancels the grab being followed', !!secondId && lastCancel === secondId,
            `followed ${secondId}, cancelled ${cancels.join(' then ')}`);
        record('4a-5', 'two test grabs were made', created.length === 2, `${created.length}`);
    } finally {
        await guard?.close('4a-5');
        await closeAll(context);
    }
};

// 4a P3 6: a refresh that fails says so, with the time of the rows shown.
checks.queueStale = async browser => {
    const { context, page } = await session(browser);
    await go(page, '#/catalog/queue');
    await page.waitForSelector('.jfmod-queue', { timeout: 30000 });
    await page.route('**/JellyfinMod/Queue*', route => route.abort());
    const shown = await page.waitForSelector('[data-jfmod-queue-refresh-failed]', { timeout: 15000 }).then(() => true).catch(() => false);
    const rows = await page.locator('.jfmod-queue').count();
    record('4a-6', 'a failed queue refresh is announced and the last rows stay', shown && rows === 1);
    await page.unroute('**/JellyfinMod/Queue*');
    await closeAll(context);
};

// 4a P3 7: a row a poll removes takes the TV focus to its neighbour, not to the document.
checks.queueFocus = async browser => {
    const { context, page } = await session(browser, 'tv');
    await go(page, '#/catalog/queue');
    await page.waitForSelector('[data-jfmod-queue-id]', { timeout: 30000 });
    const ids = await page.evaluate(() => Array.from(document.querySelectorAll('[data-jfmod-queue-id]')).map(row => row.dataset.jfmodQueueId));
    if (ids.length < 2) { record('4a-7', 'the queue has two rows', false, `${ids.length}`); await closeAll(context); return; }
    await page.evaluate(id => document.querySelector(`[data-jfmod-queue-id="${id}"]`).focus(), ids[0]);
    // The next polls answer the real queue without the focused row, as an automatic seed release would.
    await page.route('**/JellyfinMod/Queue*', async route => {
        const response = await route.fetch();
        const body = await response.json();
        body.items = body.items.filter(item => item.id !== ids[0]);
        await route.fulfill({ response, json: body });
    });
    await page.waitForFunction(id => !document.querySelector(`[data-jfmod-queue-id="${id}"]`), ids[0], { timeout: 15000 });
    await page.waitForTimeout(500);
    const focus = await page.evaluate(() => document.activeElement === document.body ? 'body' : document.activeElement?.dataset?.jfmodQueueId ?? document.activeElement?.tagName);
    record('4a-7', 'focus moves to the neighbouring row when a poll removes the focused one', focus === ids[1], focus);
    await page.unroute('**/JellyfinMod/Queue*');
    await closeAll(context);
};

const sectionSave = page => page.locator('.jfmod-check-main button', { hasText: /^Save$/ }).first();

// 4b P2 1: seed protection is saved first; a refused seed source leaves retention exactly as it was.
checks.settingsPartial = async browser => {
    const { context, page } = await session(browser);
    const retention = (await api(page, 'GET', 'JellyfinMod/Settings/Retention')).body;
    const seed = (await api(page, 'GET', 'JellyfinMod/Settings/SeedProtection')).body;
    try {
        await go(page, '#/catalog/settings?section=retention');
        const days = page.getByLabel('Days to keep a file after it is finished');
        await days.waitFor({ timeout: 30000 });
        await days.fill(String(retention.reclaimAfterDays + 1));
        await page.getByRole('combobox', { name: 'Read seeding state from' }).click();
        await page.getByRole('option', { name: 'A separate Transmission' }).click();
        await page.getByLabel('Transmission RPC address').fill('not an address');
        await sectionSave(page).click();
        await page.waitForTimeout(2500);
        const after = (await api(page, 'GET', 'JellyfinMod/Settings/Retention')).body;
        const seedAfter = (await api(page, 'GET', 'JellyfinMod/Settings/SeedProtection')).body;
        const notice = await page.locator('.jfmod-notice').first().innerText().catch(() => '');
        record('4b-1', 'a refused seed source leaves retention unchanged', after.revision === retention.revision && after.reclaimAfterDays === retention.reclaimAfterDays
        && after.enabled === retention.enabled, `retention ${retention.revision}/${retention.reclaimAfterDays} → ${after.revision}/${after.reclaimAfterDays}; ${notice}`);
        record('4b-1', 'seed protection is unchanged too', seedAfter.revision === seed.revision && seedAfter.source === seed.source);
    } finally {
        // Whatever happened, both settings are put back and read again (final web review, P2 5).
        await restoreStep('the retention settings', () => restoreRetention(page, retention));
        await restoreStep('the seed protection source', () => restoreSeed(page, seed));
        await closeAll(context);
    }
};

/** Puts retention back as it was and reads it again. */
async function restoreRetention(page, original) {
    const keys = ['enabled', 'reclaimAfterDays', 'watchedUserMode', 'selectedUserId', 'exemptFavourites'];
    const same = current => keys.every(key => (current?.[key] ?? null) === (original[key] ?? null));
    const now = (await api(page, 'GET', 'JellyfinMod/Settings/Retention')).body;
    if (!same(now)) {
        const patched = await api(page, 'PATCH', 'JellyfinMod/Settings/Retention', { ...Object.fromEntries(keys.map(key => [key, original[key] ?? null])),
            revision: now.revision });
        if (patched.status !== 200) return `restoring retention answered ${patched.status}`;
    }
    return same((await api(page, 'GET', 'JellyfinMod/Settings/Retention')).body) ? true : 'retention differs from the original';
}

/** Puts the seed protection source back as it was (its stored password unchanged) and reads it again. */
async function restoreSeed(page, original) {
    const keys = ['source', 'rpcUrl', 'username'];
    const same = current => keys.every(key => (current?.[key] ?? null) === (original[key] ?? null));
    const now = (await api(page, 'GET', 'JellyfinMod/Settings/SeedProtection')).body;
    if (!same(now)) {
        const separate = original.source === 'separate';
        const patched = await api(page, 'PATCH', 'JellyfinMod/Settings/SeedProtection', { source: original.source,
            rpcUrl: separate ? original.rpcUrl ?? '' : null, username: separate ? original.username ?? '' : null,
            password: { action: 'unchanged', value: null }, revision: now.revision });
        if (patched.status !== 200) return `restoring seed protection answered ${patched.status}`;
    }
    return same((await api(page, 'GET', 'JellyfinMod/Settings/SeedProtection')).body) ? true : 'seed protection differs from the original';
}

// 4b P2 2: a list field keeps its comma while it is typed.
checks.listField = async browser => {
    const { context, page } = await session(browser);
    await go(page, '#/catalog/settings?section=indexers');
    await page.locator('.jfmod-brow [data-row-action="edit"]').first().click();
    const field = page.getByLabel('Categories');
    await field.waitFor({ timeout: 15000 });
    await field.fill('');
    await field.pressSequentially('2000,');
    const typed = await field.inputValue();
    await field.pressSequentially('5000');
    const both = await field.inputValue();
    record('4b-2', 'typing a comma keeps it, and the next number starts a new entry', typed === '2000,' && both === '2000,5000', `"${typed}" then "${both}"`);
    await page.getByRole('button', { name: 'Cancel' }).click();
    await closeAll(context);
};

// 4b P2 3: on the TV, arrows reach a settings select.
checks.tvSelect = async browser => {
    const { context, page } = await session(browser, 'tv');
    await go(page, '#/catalog/settings?section=retention');
    await page.getByLabel('Days to keep a file after it is finished').waitFor({ timeout: 30000 });
    await page.getByLabel('Days to keep a file after it is finished').focus();
    let reached = false;
    const path = [];
    for (let step = 0; step < 6 && !reached; step++) {
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(300);
        const active = await page.evaluate(() => ({ role: document.activeElement?.getAttribute('role'), text: (document.activeElement?.textContent ?? '').trim().slice(0, 30) }));
        path.push(active.role ?? active.text);
        reached = active.role === 'combobox';
    }
    record('4b-3', 'Down from the days field reaches the "Start the window when" select', reached, path.join(' → '));
    await closeAll(context);
};

// 4b P2 4: an edit survives a background refresh that brings a change made elsewhere, which is announced.
checks.dirtyDraft = async browser => {
    const { context, page } = await session(browser);
    const original = (await api(page, 'GET', 'JellyfinMod/Settings/Import')).body;
    await go(page, '#/catalog/settings?section=import');
    const field = page.getByLabel(/stalled/i).first();
    await field.waitFor({ timeout: 30000 });
    const edited = String((original.stalledAfterHours ?? 24) + 5);
    await field.fill(edited);
    // Another administrator saves the same values: only the revision moves.
    const { revision, ...values } = original;
    const changed = await api(page, 'PATCH', 'JellyfinMod/Settings/Import', { ...values, revision });
    await page.evaluate(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange', { bubbles: true })); });
    await page.waitForTimeout(3000);
    const kept = await field.inputValue();
    const notice = await page.locator('.jfmod-notice').first().innerText().catch(() => '');
    record('4b-4', 'the unsaved edit is kept and the change elsewhere is announced', changed.status === 200 && kept === edited && /changed somewhere else/.test(notice),
        `patch ${changed.status}, field "${kept}", notice "${notice}"`);
    await closeAll(context);
};

// 4b P2 5: a failed read is shown with a retry; the wizard fails its load without the overview.
checks.failedReads = async browser => {
    let { context, page } = await session(browser);
    await page.route('**/JellyfinMod/Settings/Indexers', route => (route.request().method() === 'GET' ? route.abort() : route.continue()));
    await go(page, '#/catalog/settings?section=indexers');
    const shown = await page.waitForSelector('[data-jfmod-settings-failures]', { timeout: 20000 }).then(node => node.innerText()).catch(() => '');
    record('4b-5', 'a settings area that could not be read is named with a Retry', /Settings\/Indexers/.test(shown) && /Retry/.test(shown), shown);
    await page.unroute('**/JellyfinMod/Settings/Indexers');
    await closeAll(context);
    // A fresh session, so the wizard's first load is the one without its overview.
    ({ context, page } = await session(browser));
    await page.route('**/JellyfinMod/Settings/Overview', route => route.abort());
    await go(page, '#/catalog/settings/setup');
    await page.waitForTimeout(6000);
    const wizard = await page.locator('.jfmod-notice').first().innerText().catch(() => '');
    record('4b-5', 'the wizard without its overview says it could not load, with a Retry', /could not be loaded/.test(wizard) && /Retry/.test(wizard), wizard);
    await page.unroute('**/JellyfinMod/Settings/Overview');
    await closeAll(context);
};

// 4b P3 6: a profile editor that meets a conflict offers a Reload that makes Save work.
checks.dialogReload = async browser => {
    const { context, page } = await session(browser);
    await go(page, '#/catalog/settings?section=profiles');
    await page.locator('.jfmod-check-main [data-row-action="edit"]').first().click();
    await page.locator('.jfmod-settingsDialog').waitFor({ timeout: 15000 });
    const title = (await page.locator('.jfmod-settingsDialog h2').innerText()).replace(/^Edit /, '');
    const profiles = (await api(page, 'GET', 'JellyfinMod/Settings/QualityProfiles')).body;
    const profile = profiles.find(item => item.name === title);
    const { id, revision, ...rest } = profile;
    const body = Object.fromEntries(Object.entries(rest).filter(([key]) => ['name', 'qualities', 'cutoff', 'upgradeAllowed', 'upgradeMode', 'minimumBytesPerHour',
        'maximumBytesPerHour', 'preferredWords', 'rejectedWords', 'minimumAutoScore', 'minimumSeeders'].includes(key)));
    const elsewhere = await api(page, 'PATCH', `JellyfinMod/Settings/QualityProfiles/${id}`, { ...body, revision });
    await page.locator('.jfmod-settingsDialog button', { hasText: /^Save$/ }).click();
    await page.waitForTimeout(1500);
    const reload = page.locator('.jfmod-settingsDialog .jfmod-notice button', { hasText: 'Reload' });
    const offered = await reload.count() === 1;
    let saved = false;
    if (offered) {
        await reload.click();
        await page.waitForTimeout(1500);
        await page.locator('.jfmod-settingsDialog button', { hasText: /^Save$/ }).click();
        saved = await page.locator('.jfmod-settingsDialog').waitFor({ state: 'detached', timeout: 10000 }).then(() => true).catch(() => false);
    } else {
        await page.locator('.jfmod-settingsDialog button', { hasText: 'Cancel' }).click();
    }
    record('4b-6', 'a conflict in the profile editor offers Reload, after which Save succeeds', elsewhere.status === 200 && offered && saved,
        `elsewhere ${elsewhere.status}, reload ${offered}, saved ${saved}`);
    await closeAll(context);
};

// 4c P2 1: another library tab never shows the Movies tab's catalog rows.
checks.libraryTabs = async browser => {
    const { context, page } = await session(browser);
    await go(page, `#/movies?topParentId=${LIBRARY}&collectionType=movies&tab=0`);
    await page.waitForSelector('.jfmod-entryCard, [data-jfmod-entry], .card', { timeout: 30000 });
    await page.waitForTimeout(2000);
    const moviesTab = await page.evaluate(() => document.querySelectorAll('[data-jfmod-entry-id], .jfmod-entryCard').length);
    await go(page, `#/movies?topParentId=${LIBRARY}&collectionType=movies&tab=3`);
    await page.waitForTimeout(4000);
    const favorites = await page.evaluate(() => document.querySelectorAll('[data-jfmod-entry-id], .jfmod-entryCard').length);
    record('4c-1', 'the Favorites tab shows no catalog row from the Movies tab', moviesTab > 0 && favorites === 0, `movies ${moviesTab}, favorites ${favorites}`);
    await closeAll(context);
};

// 4c P2 2: after leaving Home, nothing of it keeps fetching.
checks.homeLeak = async browser => {
    const { context, page } = await session(browser);
    for (let round = 0; round < 3; round++) {
        await go(page, '#/home');
        await page.waitForTimeout(3000);
        await go(page, `#/details?id=${ITEM}`);
        await page.waitForTimeout(2000);
    }
    const reads = [];
    page.on('request', request => {
        const path = new URL(request.url()).pathname;
        if (/\/JellyfinMod\/Browse|\/Items\/Latest|\/UserItems\/Resume|\/Shows\/NextUp/.test(path)) reads.push(path);
    });
    // A real user-data change: the server tells every session, and every Home row still observing its queries refetches.
    const userId = await page.evaluate(() => ApiClient.getCurrentUserId());
    const wasPlayed = await playedState(page, userId);
    try {
        const played = await api(page, 'POST', `UserPlayedItems/${ITEM}?userId=${userId}`);
        await page.waitForTimeout(4000);
        record('4c-2', 'on a detail page after three visits to Home, no Home row fetches on a user-data change', played.status < 300 && reads.length === 0,
            `${played.status}; ${reads.slice(0, 5).join(' ')}`);
    } finally {
        await restoreStep('the review item\'s played state', () => restorePlayed(page, userId, wasPlayed));
        await closeAll(context);
    }
};

const USER_DATA_KEYS = ['Played', 'PlayCount', 'PlaybackPositionTicks', 'LastPlayedDate', 'IsFavorite'];

/**
 * The review item's complete user data, after making sure it is this run's own disposable fixture: an item of the review
 * library the live helper created (final web review, P2 4). Anything else is refused before it is changed.
 */
async function playedState(page, userId) {
    const item = await api(page, 'GET', `Items/${ITEM}?userId=${userId}`);
    if (item.status !== 200) throw new Error(`the review item could not be read (${item.status})`);
    const ancestors = await api(page, 'GET', `Items/${ITEM}/Ancestors?userId=${userId}`);
    if (!(ancestors.body ?? []).some(ancestor => String(ancestor.Id).replaceAll('-', '') === String(LIBRARY).replaceAll('-', ''))) {
        throw new Error('the review item is not in the review library this run created; refusing to change its user data');
    }
    return Object.fromEntries(USER_DATA_KEYS.map(key => [key, item.body?.UserData?.[key] ?? null]));
}

/**
 * Puts the review item's complete user data back and reads it again. Jellyfin's user-data update leaves a field it is sent
 * as null or false unchanged, so an unplayed original is first marked unplayed (which clears the play count, position and
 * last-played date), then every recorded value is written back.
 */
async function restorePlayed(page, userId, before) {
    const statuses = [];
    if (!before.Played) statuses.push((await api(page, 'DELETE', `UserPlayedItems/${ITEM}?userId=${userId}`)).status);
    const values = Object.fromEntries(Object.entries(before).filter(([, value]) => value !== null));
    statuses.push((await api(page, 'POST', `UserItems/${ITEM}/UserData?userId=${userId}`, values)).status);
    const now = await playedState(page, userId);
    const differs = USER_DATA_KEYS.filter(key => JSON.stringify(now[key]) !== JSON.stringify(before[key]));
    return statuses.every(status => status < 300) && differs.length === 0 ? true :
        `restore ${statuses.join(',')}, differs in ${differs.map(key => `${key} ${now[key]} (was ${before[key]})`).join(', ')}`;
}

// 4c P2 3: Home's native sections fetch their first data. oleksii's Home has Active Recordings, an upstream section the mod
// does not merge: opening Home must ask for the recordings in progress.
checks.homeSections = async browser => {
    // A fresh session: its first Home is the one that has to ask (later visits may read upstream's query cache).
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    const reads = [];
    page.on('request', request => {
        const url = new URL(request.url());
        if (/\/LiveTv\/Recordings/i.test(url.pathname)) reads.push(url.pathname + url.search.slice(0, 60));
    });
    await signIn(page);
    await page.waitForTimeout(6000);
    record('4c-3', 'the first Home asks for the Active Recordings section\'s data', reads.length >= 1, reads.slice(0, 3).join(' '));
    await closeAll(context);
};

// 4c P2 4: a change of user data from elsewhere refreshes Continue Watching's native queries.
checks.homeInvalidation = async browser => {
    const { context, page } = await session(browser);
    await go(page, '#/home');
    await page.waitForTimeout(5000);
    const reads = [];
    page.on('request', request => {
        const path = new URL(request.url()).pathname;
        if (/\/UserItems\/Resume|\/Items\/Resume|\/Shows\/NextUp/.test(path)) reads.push(path);
    });
    const userId = await page.evaluate(() => ApiClient.getCurrentUserId());
    const wasPlayed = await playedState(page, userId);
    try {
        const played = await api(page, 'POST', `UserPlayedItems/${ITEM}?userId=${userId}`);
        await page.waitForTimeout(4000);
        record('4c-4', 'a played state changed elsewhere refreshes Continue Watching', played.status < 300 && reads.length > 0, `${played.status}; ${reads.slice(0, 3).join(' ')}`);
    } finally {
        await restoreStep('the review item\'s played state', () => restorePlayed(page, userId, wasPlayed));
        await closeAll(context);
    }
};

// 4c P2 5: a missing-item lookup that lands after the user moved on does not take them back.
//
// Why the link is not a genuine stale one (final web review, P3 7): a native id whose item has gone finds its entry only for
// as long as something remembers it. Reconciliation removes the bindings of a vanished item (plugin ReconciliationService,
// absent and stale bindings), so the one lasting path is the audit of a completed retention reclaim (EntriesController's
// RetentionOperations clause). Making one needs a real retention deletion of a watched owned item after a window of at least
// one day (the server refuses fewer days), which a browser check cannot wait for and which would run the delete path on the
// acceptance instance. The race under test is the page's alone: the lookup's real response for an id that does not exist is
// held, then answered with this run's own review entry, as the audit would answer it.
checks.missingLookup = async browser => {
    const { context, page } = await session(browser);
    let asked = 0;
    const reviewEntry = (await api(page, 'GET', `JellyfinMod/Entries?jellyfinItemId=${ITEM}&limit=1`)).body?.items?.[0];
    await page.route('**/JellyfinMod/Entries?*', async route => {
        if (!/jellyfinItemId=/.test(route.request().url())) return route.continue();
        asked++;
        const response = await route.fetch();
        const body = await response.json();
        await sleep(4000);
        // The lookup answers with the review entry, as for a reclaimed title whose old link was opened.
        const entry = reviewEntry;
        await route.fulfill({ response, json: { ...body, items: entry ? [entry] : body.items, totalRecordCount: entry ? 1 : body.totalRecordCount } }).catch(() => {});
    });
    await page.evaluate(() => { location.hash = '#/details?id=4f1c0de0a1b2c3d4e5f60718293a4b5c'; });
    // Move on as soon as the fallback lookup is under way (its answer is held 4 s).
    for (let waited = 0; waited < 15000 && !asked; waited += 100) await page.waitForTimeout(100);
    await page.waitForTimeout(300);
    await page.evaluate(() => { location.hash = '#/home'; });
    await page.waitForTimeout(7000);
    const hash = await page.evaluate(() => location.hash);
    record('4c-5', 'a late missing-item lookup leaves the user where they went', asked > 0 && hash.startsWith('#/home'), `lookups ${asked}, now ${hash}`);
    await closeAll(context);
};

// Fixes review P2 1: a grab refused as already active looks its owner up; another grab started meanwhile stays the one the
// picker follows, and Cancel targets it.
checks.pickerRecovery = async browser => {
    const { context, page } = await session(browser);
    // The acceptance instance sends a grab five seconds after it is made: the guard cancels every grab before that.
    const at = { step: 'start' };
    let guard;
    try {
        guard = await grabGuard(page, 3500);
        const created = guard.created;
        // The guard cancels the competing grab 3.5 s after it is requested, inside the server's 5 s hold. A picker grab the
        // server answers only after that finds the target free again and is accepted: that attempt proves nothing either
        // way, and the run is repeated (at most three times).
        for (let attempt = 1; attempt <= 3; attempt++) {
            const outcome = await pickerRecoveryRun(page, created, at);
            if (outcome !== 'slow') break;
            console.log(`fr-1 attempt ${attempt}: the picker's grab was answered after the guard cancelled the competing grab; repeating`);
            for (const id of created) await api(page, 'POST', `JellyfinMod/Grabs/${id}/Cancel`).catch(() => {});
            await sleep(1000);
            const states = await Promise.all(created.map(async id => (await api(page, 'GET', `JellyfinMod/Grabs/${id}`)).body?.state));
            record('fr-1', `the repeated attempt's grabs ended cancelled, nothing sent (attempt ${attempt})`,
                states.every(state => state === 'cancelled'), states.join(','));
            created.length = 0;
            await page.unroute('**/JellyfinMod/Grabs/*').catch(() => {});
            // A fresh page: the previous attempt's picker is still open over the details page.
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(2000);
            at.step = `attempt ${attempt + 1}`;
            if (attempt === 3) record('fr-1', 'the picker\'s grab is answered while the competing grab is still held', false, 'three slow attempts');
        }
    } catch (error) {
        record('fr-1', `ran to the end (stopped at ${at.step})`, false, String(error.message).split('\n')[0]);
    } finally {
        // Every grab this check made is cancelled and read back before the session closes, whatever happened.
        await guard?.close('fr-1');
        await closeAll(context);
    }
};

async function pickerRecoveryRun(page, created, at) {
    // The server holds a grab for only a few seconds before sending it, so every grab here is cancelled within its hold.
    // A file-less movie is used: public trackers answer movie searches far more steadily than episode ones. The picker's
    // second grab comes from a second, deliberate search with another profile.
    const movie = process.env.JELLYFINMOD_WANTED_ENTRY;
    if (!movie) { record('fr-1', 'JELLYFINMOD_WANTED_ENTRY names a file-less movie', false); return; }
    await go(page, `#/details?entryId=${movie}`);
    const open = page.locator('button', { hasText: 'Search releases' }).first();
    await open.waitFor({ state: 'visible', timeout: 30000 });
    // The picker's own search: the other administrator's grab reuses it, so no further indexer query is needed.
    const pickerSearch = page.waitForResponse(response => response.request().method() === 'GET'
        && /\/JellyfinMod\/Releases$/.test(new URL(response.url()).pathname), { timeout: 180000 }).catch(() => null);
    await open.click();
    const searched = await pickerSearch;
    if (!searched) { record('fr-1', 'the picker searches', false, 'no search response'); return 'done'; }
    const search = await searched.json();
    await page.waitForSelector('.jfmod-releasePicker', { timeout: 15000 });
    const settled = () => page.waitForFunction(() => !/Searching/.test(document.querySelector('.jfmod-releaseStatus')?.textContent ?? 'Searching'),
        undefined, { timeout: 180000 });
    await settled();
    const eligible = page.locator('.jfmod-releaseList .jfmod-releaseRow:not([aria-disabled="true"])');
    if (!await eligible.count()) {
        record('fr-1', 'the picker has an eligible release', false, (await page.locator('.jfmod-releaseStatus').innerText().catch(() => '')).trim());
        return;
    }
    let releaseLookup;
    const lookupHeld = new Promise(resolve => { releaseLookup = resolve; });
    let otherId = null;
    // The picker's lookup of the other grab is answered only after the picker has started a grab of its own.
    await page.route('**/JellyfinMod/Grabs/*', async route => {
        const id = new URL(route.request().url()).pathname.split('/').pop();
        if (route.request().method() === 'GET' && id === otherId) {
            const response = await route.fetch();
            await Promise.race([lookupHeld, sleep(60000)]);
            await route.fulfill({ response }).catch(() => {});
            return;
        }
        await route.continue();
    });
    // Another grab of the same movie (another tab or administrator) is made after this picker searched and is still held
    // when the picker's grab arrives: the server refuses the picker's grab with a real 409 grab_active naming it. That
    // grab is cancelled at once, well within its hold; the picker's lookup of it is the real response, held back above
    // until the picker has started a grab of its own (Codex delta review 4, P3 5).
    const candidate = search.candidates.find(item => item.eligible);
    const otherKey = 'fr1-' + Date.now();
    const other = await api(page, 'POST', 'JellyfinMod/Releases/Grab', { searchId: search.searchId, releaseId: candidate.releaseId,
        idempotencyKey: otherKey });
    const otherAt = Date.now();
    otherId = other.body?.id ?? null;
    if (!otherId) { record('fr-1', 'the competing grab is made', false, `${other.status} ${JSON.stringify(other.body)}`); return; }
    // The picker's own request, never the competing one's response, which can still be in flight to this runner.
    const refusal = page.waitForResponse(response => response.request().method() === 'POST'
        && /\/JellyfinMod\/Releases\/Grab$/.test(new URL(response.url()).pathname)
        && response.request().postDataJSON()?.idempotencyKey !== otherKey, { timeout: 10000 }).catch(() => null);
    at.step = 'refused click';
    await eligible.first().evaluate(node => node.click());
    const refused = await refusal;
    if (refused?.status() === 202 && Date.now() - otherAt > 3000) {
        console.log(`fr-1: the picker's grab was answered ${Date.now() - otherAt} ms after the competing grab was made`);
        return 'slow';
    }
    await api(page, 'POST', `JellyfinMod/Grabs/${otherId}/Cancel`);
    const refusedBody = refused ? await refused.json().catch(() => null) : null;
    const conflict = refused?.status() === 409 && refusedBody?.type === 'grab_active'
        && String(refusedBody?.operationId ?? '').toLowerCase() === String(otherId).toLowerCase();
    at.step = `refusal ${refused?.status()} ${refusedBody?.type}`;
    const profiles = await page.locator('#jfmod-releaseProfile option').evaluateAll(options => options.map(option => option.value));
    at.step = 'profile switch';
    await page.locator('#jfmod-releaseProfile').selectOption(profiles.find(value => value) ?? '');
    await settled();
    at.step = 'own grab click: ' + (await page.locator('.jfmod-releaseStatus').innerText().catch(() => '')).trim();
    const ownCreated = page.waitForResponse(response => response.request().method() === 'POST'
        && /\/Releases\/Grab$/.test(new URL(response.url()).pathname) && response.status() === 202, { timeout: 60000 }).catch(() => null);
    await eligible.first().waitFor({ timeout: 30000 });
    await eligible.first().evaluate(node => node.click());
    const ownId = (await (await ownCreated)?.json().catch(() => null))?.id ?? null;
    await page.waitForFunction(() => !!document.querySelector('.jfmod-grabCancel'), undefined, { timeout: 1500 }).catch(() => {});
    // The held real answer to the picker's lookup of the other grab is released, and the check waits until it has reached the
    // page and the page has had a frame to act on it, before it presses Cancel (Codex delta review 6, P3 7).
    const lookupDelivered = page.waitForResponse(response => response.request().method() === 'GET'
        && new URL(response.url()).pathname.endsWith(`/JellyfinMod/Grabs/${otherId}`), { timeout: 15000 }).catch(() => null);
    releaseLookup();
    const delivered = await lookupDelivered;
    // The held answer's body has fully arrived, and the page has had frames to act on it; its grab status is still shown.
    await delivered?.finished().catch(() => null);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 200)))));
    const cancelShown = await page.locator('.jfmod-grabCancel').count() > 0;
    at.step = 'cancel';
    // Only the page's own Cancel counts: the check's setup and safety-net requests carry X-JellyfinMod-Check.
    const cancelAnswered = page.waitForResponse(response => response.request().method() === 'POST'
        && /\/JellyfinMod\/Grabs\/[^/]+\/Cancel$/.test(new URL(response.url()).pathname)
        && !response.request().headers()['x-jellyfinmod-check'], { timeout: 15000 }).catch(() => null);
    if (cancelShown) await page.locator('.jfmod-grabCancel').first().evaluate(node => node.click());
    const cancelResponse = await cancelAnswered;
    const cancelledId = cancelResponse ? new URL(cancelResponse.url()).pathname.split('/').slice(-2)[0] : null;
    for (const id of created) await api(page, 'POST', `JellyfinMod/Grabs/${id}/Cancel`);
    const followedOwn = conflict && !!otherId && !!ownId && delivered?.status() === 200 && cancelShown && cancelResponse?.status() === 200
        && cancelledId === ownId;
    record('fr-1', 'a late lookup after a refused grab never replaces the grab started since', followedOwn,
        `refused ${conflict} (${refused?.status()} ${refusedBody?.type ?? ''} ${refusedBody?.operationId ?? refusedBody?.id ?? ''}), other ${otherId}, own ${ownId}, lookup delivered ${delivered?.status()}, Cancel shown ${cancelShown}, the page cancelled `
        + `${cancelledId ?? 'nothing'} (${cancelResponse?.status()})`);
    await sleep(1000);
    const states = await Promise.all(created.map(async id => (await api(page, 'GET', `JellyfinMod/Grabs/${id}`)).body?.state));
    record('fr-1', 'every test grab ended cancelled, nothing sent', states.length === 2 && states.every(state => state === 'cancelled'), states.join(','));
    return 'done';
}

/** Waits for a completed response to `method` on a path matching `pattern`. */
const responseTo = (page, method, pattern, timeout = 30000) => page.waitForResponse(response => response.request().method() === method
    && pattern.test(new URL(response.url()).pathname), { timeout });
/** Waits until the section's first notice shows text matching `pattern`; returns the text, or '' when it never does. */
const noticeMatching = async (page, pattern, timeout = 15000) => {
    const done = await page.waitForFunction(source => {
        const text = document.querySelector('.jfmod-notice')?.textContent ?? '';
        return new RegExp(source).test(text);
    }, pattern.source, { timeout }).then(() => true).catch(() => false);
    return done ? (await page.locator('.jfmod-notice').first().innerText().catch(() => '')).trim() : '';
};
const CLIENTS = /\/JellyfinMod\/Settings\/DownloadClients$/;

/** The selected download client, as the settings page picks it. */
async function selectedClientOf(page) {
    const acquisition = (await api(page, 'GET', 'JellyfinMod/Settings/Acquisition')).body;
    const clients = (await api(page, 'GET', 'JellyfinMod/Settings/DownloadClients')).body ?? [];
    return { acquisition, clients, client: clients.find(client => client.id === acquisition?.downloadClientId) ?? clients[0] };
}

// Fixes review P2 2: a probe, a test or a mappings save never discards an unsaved edit of the client. Each action must
// have succeeded, its refetch landed and its outcome rendered before the edit is read (Codex delta review 4, P3 4).
checks.nonSaveKeeps = async browser => {
    const { context, page } = await session(browser);
    await go(page, '#/catalog/settings?section=client');
    const name = page.getByLabel('Name', { exact: true });
    await name.waitFor({ timeout: 30000 });
    const original = await name.inputValue();
    const edited = original + ' (edited)';
    await name.fill(edited);
    await page.getByLabel('A path as Transmission reports it').fill('/downloads/probe.mkv');
    const probed = responseTo(page, 'POST', /\/TestImportPath$/);
    const probeRefetch = responseTo(page, 'GET', CLIENTS);
    await page.getByRole('button', { name: 'Test import path' }).click();
    const probe = await probed;
    const probeCode = (await probe.json().catch(() => null))?.code ?? '?';
    const probeReread = (await probeRefetch.catch(() => null))?.status();
    const probeNotice = await noticeMatching(page, new RegExp(`\\(${probeCode}\\)`));
    const afterProbe = await name.inputValue();
    const saved = responseTo(page, 'PUT', /\/PathMappings$/);
    const savedRefetch = responseTo(page, 'GET', CLIENTS);
    await page.getByRole('button', { name: 'Save mappings' }).click();
    const save = await saved;
    const saveReread = (await savedRefetch.catch(() => null))?.status();
    const saveNotice = await noticeMatching(page, /Mappings saved/);
    const afterMappings = await name.inputValue();
    const completed = probe.status() === 200 && probeReread === 200 && !!probeNotice && save.status() === 200 && saveReread === 200 && !!saveNotice;
    record('fr-2', 'an unsaved client edit survives a completed Test import path and a completed Save mappings, each refetched and shown',
        completed && afterProbe === edited && afterMappings === edited,
        `probe ${probe.status()}/${probeReread} "${probeNotice}" → "${afterProbe}"; mappings ${save.status()}/${saveReread} "${saveNotice}" → "${afterMappings}"`);
    await closeAll(context);
};

/** The mappings version a client's mappings stand at now; every replacement names it (plugin wrf.4). */
const mappingsVersionOf = async (page, clientId) => ((await api(page, 'GET', 'JellyfinMod/Settings/DownloadClients')).body ?? [])
    .find(item => item.id === clientId)?.mappingsVersion ?? null;

/** A client's mappings as prefixes, for comparing. */
const mappingKey = list => (list ?? []).map(mapping => `${mapping.clientPathPrefix}>${mapping.localPathPrefix}`).join('|');

/** Puts a client's mappings back as they were and reads them again. */
async function restoreMappings(page, client) {
    const wanted = (client.pathMappings ?? []).map(mapping => ({ clientPathPrefix: mapping.clientPathPrefix, localPathPrefix: mapping.localPathPrefix }));
    const path = `JellyfinMod/Settings/DownloadClients/${client.id}/PathMappings`;
    if (mappingKey((await api(page, 'GET', path)).body) !== mappingKey(wanted)) {
        const put = await api(page, 'PUT', path, { pathMappings: wanted, mappingsVersion: await mappingsVersionOf(page, client.id) });
        if (put.status !== 200) return `saving the original mappings answered ${put.status}`;
    }
    const after = (await api(page, 'GET', path)).body;
    return mappingKey(after) === mappingKey(wanted) ? true : `mappings are now "${mappingKey(after)}"`;
}

/** Puts the acquisition selection and switch back as they were and reads them again. */
async function restoreSelection(page, acquisition) {
    const now = (await api(page, 'GET', 'JellyfinMod/Settings/Acquisition')).body;
    if (now?.downloadClientId !== acquisition.downloadClientId || now?.enabled !== acquisition.enabled) {
        const patched = await api(page, 'PATCH', 'JellyfinMod/Settings/Acquisition', { enabled: !!acquisition.enabled,
            downloadClientId: acquisition.downloadClientId ?? null, defaultQualityProfileId: acquisition.defaultQualityProfileId ?? null,
            revision: now.revision });
        if (patched.status !== 200) return `restoring the selection answered ${patched.status} ${JSON.stringify(patched.body)}`;
    }
    const after = (await api(page, 'GET', 'JellyfinMod/Settings/Acquisition')).body;
    const restored = after?.downloadClientId === acquisition.downloadClientId && after?.enabled === acquisition.enabled;
    return restored || `selection is now ${after?.downloadClientId}/${after?.enabled}`;
}

/**
 * Deletes the second client a check made: by the id it registered, or, when a creation's answer was lost, by this run's own
 * unique name (no client had it before: a collision refuses before anything is made). Then reads the list again to confirm
 * none is left (Codex delta review 8, P2 3; final web review, P2 3).
 */
async function removeSecondClients(page, owner) {
    const listed = (await api(page, 'GET', 'JellyfinMod/Settings/DownloadClients')).body ?? [];
    const ids = new Set([...(owner.id ? [owner.id] : []),
        ...(owner.attempted ? listed.filter(item => item.name === SECOND_CLIENT).map(item => item.id) : [])]);
    const statuses = [];
    for (const id of ids) {
        if (listed.some(item => item.id === id)) statuses.push((await api(page, 'DELETE', `JellyfinMod/Settings/DownloadClients/${id}`)).status);
    }
    const left = ((await api(page, 'GET', 'JellyfinMod/Settings/DownloadClients')).body ?? [])
        .filter(item => ids.has(item.id) || item.name === SECOND_CLIENT);
    return left.length === 0 ? true : `delete answered ${statuses.join(',')}, still listed ${left.map(item => item.id).join(',')}`;
}

/** The clients this run made: the only ones a page may send a password to. */
const OWNED_CLIENTS = new Set();

/** This run's own second client; a client with this name that the run did not make is a collision, never deleted. */
const SECOND_CLIENT = `JellyfinMod Review Client B ${Math.random().toString(16).slice(2, 10)}`;

/**
 * Makes a turned-off second client and selects it with grabbing turned off, as another administrator would; the server
 * refuses a turned-off selection while grabbing is on. Returns its id, or null with the reason recorded.
 */
async function selectSecondClient(page, client, finding, owner) {
    if (((await api(page, 'GET', 'JellyfinMod/Settings/DownloadClients')).body ?? []).some(item => item.name === SECOND_CLIENT)) {
        record(finding, 'a second client is made for the check', false, `a client named ${SECOND_CLIENT} already exists; it is not this run's`);
        return null;
    }
    owner.attempted = true;
    const made = await api(page, 'POST', 'JellyfinMod/Settings/DownloadClients', {
        name: SECOND_CLIENT, kind: 'transmission', baseUrl: 'http://127.0.0.1:9/transmission/rpc', username: '', password: { action: 'unchanged', value: null },
        enabled: false, label: client.label ?? 'jellyfinmod', downloadDirectory: client.downloadDirectory, localDirectory: client.localDirectory
    });
    const other = made.body?.id ?? null;
    // Registered with the caller's cleanup at once, before anything else can throw.
    owner.id = other;
    if (other) OWNED_CLIENTS.add(other);
    if (!other) { record(finding, 'a second client is made for the check', false, `${made.status} ${JSON.stringify(made.body)}`); return null; }
    const current = (await api(page, 'GET', 'JellyfinMod/Settings/Acquisition')).body;
    const selected = await api(page, 'PATCH', 'JellyfinMod/Settings/Acquisition', { enabled: false, downloadClientId: other,
        defaultQualityProfileId: current.defaultQualityProfileId ?? null, revision: current.revision });
    // The check goes on only with the second client selected and read back so (final web review 2, P2 4).
    const now = (await api(page, 'GET', 'JellyfinMod/Settings/Acquisition')).body;
    if (selected.status !== 200 || now?.downloadClientId !== other) {
        record(finding, 'the second client is selected', false, `${selected.status}, selected ${now?.downloadClientId === other ? 'the second client' : 'another client'}`);
        return null;
    }
    return other;
}

/** Runs the client Test and waits until its refetch has landed and its outcome is shown. */
async function testClientRefetched(page) {
    const tested = responseTo(page, 'POST', /\/DownloadClients\/[^/]+\/Test$/, 60000).catch(() => null);
    const reread = responseTo(page, 'GET', CLIENTS, 60000).catch(() => null);
    await page.locator('[data-test="client"]').click();
    const test = await tested;
    const body = await test?.json().catch(() => null);
    const rereadStatus = (await reread)?.status();
    const notice = await noticeMatching(page, new RegExp(`\\(${body?.code ?? 'none'}\\)`));
    return { ok: test?.status() === 200 && rereadStatus === 200 && !!notice, detail: `test ${test?.status()} "${notice}", refetch ${rereadStatus}` };
}

/** Adds one mapping row with the given prefixes. */
async function addMappingRow(page, clientPrefix, localPrefix) {
    await page.getByRole('button', { name: 'Add mapping' }).waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: 'Add mapping' }).click();
    const row = page.locator('.jfmod-maprow').last();
    await row.getByLabel('Transmission path').fill(clientPrefix);
    await row.getByLabel('Local path').fill(localPrefix);
}

// Fixes review P2 3 and Codex delta reviews 4 and 6: edited mappings survive a completed client test. Another administrator
// then saves the mappings (a real competing save, which does not advance the client's revision): this page's save sends the
// version its edits started from and gets the conflict. A Reload while the selection's read fails keeps the edits and says
// so; the next Reload takes the server's copy. The client's mappings are put back afterwards.
checks.mappingsDraft = async browser => {
    const { context, page } = await session(browser);
    const { client } = await selectedClientOf(page);
    try {
        await go(page, '#/catalog/settings?section=client');
        await addMappingRow(page, '/fr3/client', '/fr3/local');
        const refetched = await testClientRefetched(page);
        const rows = await page.locator('.jfmod-maprow').count();
        const kept = rows ? await page.locator('.jfmod-maprow').last().getByLabel('Transmission path').inputValue() : '';
        record('fr-3', 'an unsaved path mapping survives a completed client test', refetched.ok && kept === '/fr3/client',
            `${refetched.detail}; ${rows} row(s), last "${kept}"`);
        // The other administrator saves a different set: the server's mappings now differ from the copy edited here.
        const competingSet = [...(client.pathMappings ?? []).map(mapping => ({ clientPathPrefix: mapping.clientPathPrefix,
            localPathPrefix: mapping.localPathPrefix })), { clientPathPrefix: '/d6-other/client', localPathPrefix: '/d6-other/local' }];
        const competing = await api(page, 'PUT', `JellyfinMod/Settings/DownloadClients/${client.id}/PathMappings`, {
            pathMappings: competingSet, mappingsVersion: client.mappingsVersion
        });
        const sent = page.waitForRequest(item => item.method() === 'PUT' && /\/PathMappings$/.test(new URL(item.url()).pathname), { timeout: 15000 })
            .catch(() => null);
        const answered = responseTo(page, 'PUT', /\/PathMappings$/, 15000).catch(() => null);
        await page.getByRole('button', { name: 'Save mappings' }).click();
        const body = (await sent)?.postDataJSON() ?? null;
        const saveStatus = (await answered)?.status();
        const conflictText = await noticeMatching(page, /changed somewhere else|changed since/, 8000);
        const sentEdits = (body?.pathMappings ?? []).some(mapping => mapping.clientPathPrefix === '/fr3/client');
        const conflicted = competing.status === 200 && sentEdits && body?.mappingsVersion === client.mappingsVersion
            && body?.revision === client.revision && saveStatus === 409 && !!conflictText;
        record('d6-6', 'after a competing save, Save mappings sends the version its edits started from and gets the conflict', conflicted,
            `competing ${competing.status}; sent version ${body?.mappingsVersion} (started from ${client.mappingsVersion}), revision ${body?.revision}, `
            + `answered ${saveStatus}, notice "${conflictText}"`);
        // The Reload's read of the client selection fails once.
        let failedOnce = false;
        await page.route('**/JellyfinMod/Settings/Acquisition', route => {
            if (failedOnce || route.request().method() !== 'GET') return route.continue();
            failedOnce = true;
            return route.abort();
        });
        const failedRead = page.waitForEvent('requestfailed', { predicate: item => /\/Settings\/Acquisition$/.test(new URL(item.url()).pathname),
            timeout: 15000 }).then(() => true).catch(() => false);
        const reload = page.locator('.jfmod-notice button', { hasText: 'Reload' }).first();
        if (await reload.count()) await reload.click();
        const readFailed = await failedRead;
        // The section's own notice says which read failed and offers another Reload; the page's banner is not enough.
        const failedNotice = await page.waitForFunction(() => [...document.querySelectorAll('.jfmod-notice')]
            .map(node => node.textContent ?? '').find(text => /Your edits are kept; reload again/.test(text)) ?? null,
        undefined, { timeout: 8000 }).then(handle => handle.jsonValue()).catch(() => '');
        await page.waitForTimeout(500);
        const keptAfterFailure = await page.locator('.jfmod-maprow').evaluateAll(found =>
            found.some(row => [...row.querySelectorAll('input')].some(input => input.value === '/fr3/client')));
        record('d6-3', 'a Reload whose read of the client selection fails keeps the edited mappings and says what failed',
            readFailed && keptAfterFailure && /Settings\/Acquisition/.test(failedNotice),
            `read failed ${readFailed}, edits kept ${keptAfterFailure}, notice "${failedNotice}"`);
        await page.unroute('**/JellyfinMod/Settings/Acquisition');
        const again = page.locator('.jfmod-notice button', { hasText: 'Reload' }).first();
        if (await again.count()) await again.click();
        // The Reload reads every settings area again; the slowest read decides when the drafts are reset.
        const afterReload = !await page.waitForFunction(() => ![...document.querySelectorAll('.jfmod-maprow input')]
            .some(input => input.value === '/fr3/client'), undefined, { timeout: 30000 }).then(() => true).catch(() => false);
        record('d6-3', 'the next Reload takes the server\'s mappings', !afterReload, `edited row still shown ${afterReload}`);
    } finally {
        await restoreStep('the client\'s mappings', () => restoreMappings(page, client));
        await closeAll(context);
    }
};

// Codex delta review 6, P2 1: another administrator saves this client's mappings while they are edited here, and the page
// refetches. Saving the stale edits is refused with a Reload; nothing overwrites the newer mappings.
checks.mappingsStale = async browser => {
    const { context, page } = await session(browser);
    const { client } = await selectedClientOf(page);
    try {
        await go(page, '#/catalog/settings?section=client');
        await addMappingRow(page, '/d61/client', '/d61/local');
        // The other administrator saves a different set: the server's mappings now differ from the copy edited here.
        const competingSet = [...(client.pathMappings ?? []).map(mapping => ({ clientPathPrefix: mapping.clientPathPrefix,
            localPathPrefix: mapping.localPathPrefix })), { clientPathPrefix: '/d6-other/client', localPathPrefix: '/d6-other/local' }];
        const competing = await api(page, 'PUT', `JellyfinMod/Settings/DownloadClients/${client.id}/PathMappings`, {
            pathMappings: competingSet, mappingsVersion: client.mappingsVersion
        });
        const refetched = await testClientRefetched(page);
        const puts = [];
        page.on('request', item => { if (item.method() === 'PUT' && /\/PathMappings$/.test(new URL(item.url()).pathname)) puts.push(item.url()); });
        await page.getByRole('button', { name: 'Save mappings' }).click();
        const notice = await noticeMatching(page, /mappings changed somewhere else/, 8000);
        await page.waitForTimeout(1500);
        const now = (await api(page, 'GET', `JellyfinMod/Settings/DownloadClients/${client.id}/PathMappings`)).body;
        const refused = competing.status === 200 && refetched.ok && puts.length === 0 && mappingKey(now) === mappingKey(competingSet) && !!notice;
        record('d6-1', 'edited mappings whose server copy changed meanwhile are not saved over it', refused,
            `competing ${competing.status}, ${refetched.detail}, PUTs ${puts.length}, mappings now "${mappingKey(now)}", notice "${notice}"`);
    } finally {
        await restoreStep('the client\'s mappings', () => restoreMappings(page, client));
        await closeAll(context);
    }
};

// Codex delta review 4, P2 1: mappings edited for one client are never saved to another client that another administrator
// selected meanwhile. A second, turned-off client is made and selected for the check; every change is put back afterwards
// and read again.
checks.mappingIdentity = async browser => {
    const { context, page } = await session(browser);
    const { acquisition, client } = await selectedClientOf(page);
    let other = null;
    const second = { id: null };
    try {
        await go(page, '#/catalog/settings?section=client');
        await addMappingRow(page, '/d41/client', '/d41/local');
        other = await selectSecondClient(page, client, 'd4-1', second);
        if (!other) return;
        await testClientRefetched(page);
        const shown = await page.waitForFunction(expected => [...document.querySelectorAll('input')].some(input => input.value === expected),
            SECOND_CLIENT, { timeout: 15000 }).then(() => true).catch(() => false);
        const puts = [];
        page.on('request', item => { if (item.method() === 'PUT' && /\/PathMappings$/.test(new URL(item.url()).pathname)) puts.push(item.url()); });
        await page.getByRole('button', { name: 'Save mappings' }).click();
        const notice = await noticeMatching(page, /selected download client changed/, 8000);
        await page.waitForTimeout(1500);
        const otherMappings = (await api(page, 'GET', `JellyfinMod/Settings/DownloadClients/${other}/PathMappings`)).body ?? [];
        record('d4-1', 'mappings edited for one client are not saved to another selected meanwhile',
            shown && puts.length === 0 && otherMappings.length === 0 && !!notice,
            `other shown ${shown}, PUTs ${puts.length}, other's mappings ${otherMappings.length}, notice "${notice}"`);
    } finally {
        await restoreStep('the client selection and grabbing switch', () => restoreSelection(page, acquisition));
        await restoreStep('the second client is deleted', () => removeSecondClients(page, second));
        await restoreStep('the client\'s mappings', () => restoreMappings(page, client));
        await closeAll(context);
    }
};

// Codex delta review 6, P2 2: a new password typed for one client is never saved to another client that another
// administrator selected meanwhile.
checks.passwordIdentity = async browser => {
    const { context, page } = await session(browser);
    const { acquisition, client } = await selectedClientOf(page);
    let other = null;
    const second = { id: null };
    try {
        await go(page, '#/catalog/settings?section=client');
        const passwordField = page.locator('#jfmodClientPassword');
        await page.getByRole('button', { name: 'Add mapping' }).waitFor({ timeout: 30000 });
        if (!await passwordField.isVisible().catch(() => false)) await page.getByRole('button', { name: 'Replace' }).first().click();
        await passwordField.fill('jfmod-review-not-a-password');
        other = await selectSecondClient(page, client, 'd6-2', second);
        if (!other) return;
        await testClientRefetched(page);
        const shown = await page.waitForFunction(expected => [...document.querySelectorAll('input')].some(input => input.value === expected),
            SECOND_CLIENT, { timeout: 15000 }).then(() => true).catch(() => false);
        const patches = [];
        page.on('request', item => { if (item.method() === 'PATCH' && /\/DownloadClients\/[^/]+$/.test(new URL(item.url()).pathname)) patches.push(item.url()); });
        await sectionSave(page).click();
        const notice = await noticeMatching(page, /selected download client changed/, 8000);
        await page.waitForTimeout(1500);
        const otherNow = ((await api(page, 'GET', 'JellyfinMod/Settings/DownloadClients')).body ?? []).find(item => item.id === other);
        record('d6-2', 'a password typed for one client is not saved to another selected meanwhile',
            shown && patches.length === 0 && otherNow?.passwordConfigured === false && !!notice,
            `other shown ${shown}, PATCHes ${patches.length}, other's password configured ${otherNow?.passwordConfigured}, notice "${notice}"`);
    } finally {
        await restoreStep('the client selection and grabbing switch', () => restoreSelection(page, acquisition));
        await restoreStep('the second client is deleted', () => removeSecondClients(page, second));
        await closeAll(context);
    }
};

// Codex delta review 8, P2 1: a password typed against one revision of a client is never saved over a newer revision that
// another administrator saved meanwhile. The check works on a turned-off second client it makes and selects (grabbing off),
// so the acceptance client's own credentials are never touched; everything is put back and read again.
checks.passwordRevision = async browser => {
    const { context, page } = await session(browser);
    const { acquisition, client } = await selectedClientOf(page);
    const second = { id: null };
    try {
        const other = await selectSecondClient(page, client, 'd8-1', second);
        if (!other) return;
        await go(page, '#/catalog/settings?section=client');
        const shown = await page.waitForFunction(expected => [...document.querySelectorAll('input')].some(input => input.value === expected),
            SECOND_CLIENT, { timeout: 30000 }).then(() => true).catch(() => false);
        const before = ((await api(page, 'GET', 'JellyfinMod/Settings/DownloadClients')).body ?? []).find(item => item.id === other);
        const passwordField = page.locator('#jfmodClientPassword');
        if (!await passwordField.isVisible().catch(() => false)) await page.getByRole('button', { name: 'Replace' }).first().click();
        await passwordField.fill('jfmod-review-not-a-password');
        // Another administrator changes the client's credentials: its revision moves on.
        const competing = await api(page, 'PATCH', `JellyfinMod/Settings/DownloadClients/${other}`, {
            ...Object.fromEntries(['name', 'kind', 'baseUrl', 'enabled', 'label', 'downloadDirectory', 'localDirectory', 'openUrl']
                .map(key => [key, before?.[key] ?? null])),
            username: 'jfmod-other-admin', password: { action: 'unchanged', value: null }, revision: before?.revision
        });
        const newer = ((await api(page, 'GET', 'JellyfinMod/Settings/DownloadClients')).body ?? []).find(item => item.id === other);
        // The window regains focus: the settings refetch and the form shows the newer copy.
        const reread = responseTo(page, 'GET', CLIENTS).catch(() => null);
        await page.evaluate(() => {
            document.dispatchEvent(new Event('visibilitychange'));
            window.dispatchEvent(new Event('visibilitychange'));
            window.dispatchEvent(new Event('focus'));
        });
        await reread;
        const rendered = await page.waitForFunction(() => [...document.querySelectorAll('input')].some(input => input.value === 'jfmod-other-admin'),
            undefined, { timeout: 10000 }).then(() => true).catch(() => false);
        const sent = page.waitForRequest(item => item.method() === 'PATCH' && new URL(item.url()).pathname.endsWith(`/DownloadClients/${other}`),
            { timeout: 15000 }).catch(() => null);
        const answered = responseTo(page, 'PATCH', new RegExp(`/DownloadClients/${other}$`), 15000).catch(() => null);
        await sectionSave(page).click();
        const body = (await sent)?.postDataJSON() ?? null;
        const status = (await answered)?.status();
        await page.waitForTimeout(1000);
        const after = ((await api(page, 'GET', 'JellyfinMod/Settings/DownloadClients')).body ?? []).find(item => item.id === other);
        record('d8-1', 'a password typed before another administrator\'s save is refused with the revision it started from, never saved over it',
            shown && competing.status === 200 && newer?.revision !== before?.revision && rendered && body?.password?.action === 'replace'
                && body?.revision === before?.revision && status === 409 && after?.passwordConfigured === false
                && after?.username === 'jfmod-other-admin',
            `competing ${competing.status} (revision ${before?.revision} -> ${newer?.revision}), refetch rendered ${rendered}; sent revision `
            + `${body?.revision} with password ${body?.password?.action}, answered ${status}; password configured ${after?.passwordConfigured}, `
            + `username "${after?.username}"`);
    } finally {
        await restoreStep('the client selection and grabbing switch', () => restoreSelection(page, acquisition));
        await restoreStep('the second client is deleted', () => removeSecondClients(page, second));
        await closeAll(context);
    }
};

// Codex delta review 8, P3 6: mappings edited before another administrator saved the client itself (its revision moves on,
// its mappings do not) are saved with the revision they started from and refused, not sent with the newer revision. On a
// turned-off second client the check makes and selects, as above.
checks.mappingsRevision = async browser => {
    const { context, page } = await session(browser);
    const { acquisition, client } = await selectedClientOf(page);
    const second = { id: null };
    try {
        const other = await selectSecondClient(page, client, 'd8-6', second);
        if (!other) return;
        await go(page, '#/catalog/settings?section=client');
        const shown = await page.waitForFunction(expected => [...document.querySelectorAll('input')].some(input => input.value === expected),
            SECOND_CLIENT, { timeout: 30000 }).then(() => true).catch(() => false);
        const before = ((await api(page, 'GET', 'JellyfinMod/Settings/DownloadClients')).body ?? []).find(item => item.id === other);
        await addMappingRow(page, '/d86/client', '/d86/local');
        const competing = await api(page, 'PATCH', `JellyfinMod/Settings/DownloadClients/${other}`, {
            ...Object.fromEntries(['name', 'kind', 'baseUrl', 'enabled', 'label', 'downloadDirectory', 'localDirectory', 'openUrl']
                .map(key => [key, before?.[key] ?? null])),
            username: 'jfmod-other-admin', password: { action: 'unchanged', value: null }, revision: before?.revision
        });
        const newer = ((await api(page, 'GET', 'JellyfinMod/Settings/DownloadClients')).body ?? []).find(item => item.id === other);
        const reread = responseTo(page, 'GET', CLIENTS).catch(() => null);
        await page.evaluate(() => {
            document.dispatchEvent(new Event('visibilitychange'));
            window.dispatchEvent(new Event('visibilitychange'));
            window.dispatchEvent(new Event('focus'));
        });
        await reread;
        const rendered = await page.waitForFunction(() => [...document.querySelectorAll('input')].some(input => input.value === 'jfmod-other-admin'),
            undefined, { timeout: 10000 }).then(() => true).catch(() => false);
        const sent = page.waitForRequest(item => item.method() === 'PUT' && /\/PathMappings$/.test(new URL(item.url()).pathname), { timeout: 15000 })
            .catch(() => null);
        const answered = responseTo(page, 'PUT', /\/PathMappings$/, 15000).catch(() => null);
        await page.getByRole('button', { name: 'Save mappings' }).click();
        const body = (await sent)?.postDataJSON() ?? null;
        const status = (await answered)?.status();
        const notice = await noticeMatching(page, /changed somewhere else|changed since/, 5000);
        await page.waitForTimeout(1000);
        const mappingsNow = (await api(page, 'GET', `JellyfinMod/Settings/DownloadClients/${other}/PathMappings`)).body ?? [];
        // Either the page refuses the stale edits itself (nothing sent), or it sends the revision they started from and the
        // server refuses it; never the newer revision.
        const refusedHere = !body && !!notice;
        const refusedThere = body?.revision === before?.revision && status === 409;
        record('d8-6', 'mappings edited before another administrator saved the client are never sent with the newer revision',
            shown && competing.status === 200 && newer?.revision !== before?.revision && rendered && (refusedHere || refusedThere)
                && mappingsNow.length === 0,
            `competing ${competing.status} (revision ${before?.revision} -> ${newer?.revision}), refetch rendered ${rendered}; sent `
            + `${body ? `revision ${body.revision}, answered ${status}` : 'nothing'}; notice "${notice}"; mappings now ${mappingsNow.length}`);
    } finally {
        await restoreStep('the client selection and grabbing switch', () => restoreSelection(page, acquisition));
        await restoreStep('the second client is deleted', () => removeSecondClients(page, second));
        await closeAll(context);
    }
};

// Codex delta review 10, P2 2: a password typed into the new-client form (the clients could not be read) is never saved to
// an existing client that the next read brings back. On a turned-off second client the check makes and selects, so the
// acceptance client's credentials are never touched; everything is put back and read again.
checks.passwordNewClient = async browser => {
    const { context, page } = await session(browser);
    const { acquisition, client } = await selectedClientOf(page);
    const second = { id: null };
    let refuse = true;
    try {
        const other = await selectSecondClient(page, client, 'd10-2', second);
        if (!other) return;
        await page.route('**/JellyfinMod/Settings/DownloadClients', route =>
            route.request().method() === 'GET' && refuse && !route.request().headers()['x-jellyfinmod-check'] ? route.abort() : route.fallback());
        await go(page, '#/catalog/settings?section=client');
        const failed = await page.waitForSelector('[data-jfmod-settings-failures]', { timeout: 20000 }).then(() => true).catch(() => false);
        const passwordField = page.locator('#jfmodClientPassword');
        if (!await passwordField.isVisible().catch(() => false)) await page.getByRole('button', { name: 'Replace' }).first().click().catch(() => {});
        await passwordField.fill('jfmod-review-not-a-password');
        refuse = false;
        const reread = responseTo(page, 'GET', CLIENTS).catch(() => null);
        await page.locator('[data-jfmod-settings-failures] button', { hasText: 'Retry' }).first().click();
        await reread;
        const shown = await page.waitForFunction(expected => [...document.querySelectorAll('input')].some(input => input.value === expected),
            SECOND_CLIENT, { timeout: 15000 }).then(() => true).catch(() => false);
        const writes = [];
        page.on('request', item => {
            if (/^(PATCH|POST)$/.test(item.method()) && /\/DownloadClients(\/[^/]+)?$/.test(new URL(item.url()).pathname) && !item.headers()['x-jellyfinmod-check'])
                writes.push(`${item.method()} ${new URL(item.url()).pathname}`);
        });
        await sectionSave(page).click();
        const notice = await noticeMatching(page, /selected download client changed/, 8000);
        await page.waitForTimeout(1500);
        const otherNow = ((await api(page, 'GET', 'JellyfinMod/Settings/DownloadClients')).body ?? []).find(item => item.id === other);
        record('d10-2', 'a password typed into the new-client form is not saved to an existing client the next read brings back',
            failed && shown && writes.length === 0 && otherNow?.passwordConfigured === false && !!notice,
            `read failed ${failed}, client shown ${shown}, writes ${writes.join(', ') || 'none'}, password configured `
            + `${otherNow?.passwordConfigured}, notice "${notice}"`);
    } finally {
        await page.unroute('**/JellyfinMod/Settings/DownloadClients').catch(() => {});
        await restoreStep('the client selection and grabbing switch', () => restoreSelection(page, acquisition));
        await restoreStep('the second client is deleted', () => removeSecondClients(page, second));
        await closeAll(context);
    }
};

/** Puts the import settings back as they were and reads them again. */
async function restoreImport(page, original) {
    const values = Object.fromEntries(Object.entries(original).filter(([key]) => key !== 'revision'));
    const now = (await api(page, 'GET', 'JellyfinMod/Settings/Import')).body;
    const same = current => Object.keys(values).every(key => JSON.stringify(current?.[key]) === JSON.stringify(values[key]));
    if (!same(now)) {
        const patched = await api(page, 'PATCH', 'JellyfinMod/Settings/Import', { ...values, revision: now.revision });
        if (patched.status !== 200) return `restoring the import settings answered ${patched.status}`;
    }
    return same((await api(page, 'GET', 'JellyfinMod/Settings/Import')).body) ? true : 'the import settings differ from the original';
}

// Codex delta review 6, P2 4: a draft's own "changed somewhere else" warning reloads through the section's Reload: when that
// read fails the edits stay and the page says so, instead of adopting a copy it never read.
checks.draftWarningReload = async browser => {
    const { context, page } = await session(browser);
    const original = (await api(page, 'GET', 'JellyfinMod/Settings/Import')).body;
    try {
        await go(page, '#/catalog/settings?section=import');
        const field = page.getByLabel(/stalled/i).first();
        await field.waitFor({ timeout: 30000 });
        const edited = String((original.stalledAfterHours ?? 24) + 5);
        await field.fill(edited);
        const { revision, ...values } = original;
        const elsewhere = await api(page, 'PATCH', 'JellyfinMod/Settings/Import', { ...values, revision });
        // The window regains focus: the settings refetch, and the draft sees the newer copy under its edits.
        const reread = responseTo(page, 'GET', /\/JellyfinMod\/Settings\/Import$/).catch(() => null);
        await page.evaluate(() => {
            document.dispatchEvent(new Event('visibilitychange'));
            window.dispatchEvent(new Event('visibilitychange'));
            window.dispatchEvent(new Event('focus'));
        });
        await reread;
        const warning = await noticeMatching(page, /changed somewhere else while you were editing/, 10000);
        let failedOnce = false;
        await page.route('**/JellyfinMod/Settings/Overview', route => {
            if (failedOnce || route.request().method() !== 'GET') return route.continue();
            failedOnce = true;
            return route.abort();
        });
        const failedRead = page.waitForEvent('requestfailed', { predicate: item => /\/Settings\/Overview$/.test(new URL(item.url()).pathname),
            timeout: 10000 }).then(() => true).catch(() => false);
        const reload = page.locator('.jfmod-notice button', { hasText: 'Reload' }).first();
        if (await reload.count()) await reload.click();
        const readFailed = await failedRead;
        const failedNotice = await noticeMatching(page, /could not be read/, 8000);
        await page.waitForTimeout(500);
        const afterFailed = await field.inputValue();
        record('d6-4', 'the warning\'s Reload reads again first; when that read fails the edits stay and the page says so',
            elsewhere.status === 200 && !!warning && readFailed && afterFailed === edited && !!failedNotice,
            `elsewhere ${elsewhere.status}, warning "${warning}", read failed ${readFailed}, field "${afterFailed}" (edited "${edited}"), notice "${failedNotice}"`);
        await page.unroute('**/JellyfinMod/Settings/Overview');
    } finally {
        await restoreStep('the import settings', () => restoreImport(page, original));
        await closeAll(context);
    }
};

// ---- Final web review, P2 1 and 2: secret drafts bound to their record, and edits typed while a save is under way ----

/**
 * The boundary a secret typed in a check never crosses (final web review 2, P2 4). First the competing save must have moved
 * the record past the revision the secret was typed at, or the check stops before anything is saved. Then a PATCH of the
 * record that replaces or clears the secret goes through only when its revision is older than the record's revision read
 * from this runner at that moment, so the server can only refuse it; any other such PATCH is aborted. Returns the PATCH
 * bodies seen, or null when the check must stop.
 */
async function guardSecret(page, glob, secretKey, typedAt, readRevision, finding) {
    const now = await readRevision().catch(() => null);
    if (!(typeof now === 'number' && now > typedAt)) {
        record(finding, 'the competing save moved the record on before the check saves', false, `revision ${now}, typed at ${typedAt}`);
        return null;
    }
    const bodies = [];
    await page.route(glob, async route => {
        if (route.request().method() !== 'PATCH') return route.fallback();
        const body = route.request().postDataJSON();
        bodies.push(body);
        if (body?.[secretKey]?.action === 'unchanged') return route.fallback();
        const current = await readRevision().catch(() => null);
        return typeof body?.revision === 'number' && typeof current === 'number' && body.revision < current ? route.fallback() : route.abort();
    });
    return bodies;
}

/** The revision of a settings record, read from this runner. */
const revisionReader = (call, path, id) => async () => {
    const read = (await call('GET', path)).body;
    return (id ? (read ?? []).find(item => item.id === id) : read)?.revision;
};

/** The window regains focus: the section reads its settings again. Waits for that read. */
async function refetchOnFocus(page, pattern) {
    const reread = responseTo(page, 'GET', pattern, 15000).catch(() => null);
    await page.evaluate(() => {
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('focus'));
    });
    return (await reread)?.status();
}

/** A secret field's replacement input, opening it with Replace when the secret is configured. */
async function typeSecret(scope, label, inputId, value) {
    const input = scope.locator(`#${inputId}`);
    if (!await input.isVisible().catch(() => false)) {
        await scope.locator('.jfmod-secret').filter({ hasText: label }).getByRole('button', { name: 'Replace' }).click();
    }
    await input.fill(value);
}

/** What a secret field shows: "configured" (the saved one), "empty" (an empty replacement input) or "typed". */
const secretShown = async (scope, inputId) => {
    if (!await scope.locator(`#${inputId}`).count()) return 'configured';
    return await scope.locator(`#${inputId}`).inputValue() ? 'typed' : 'empty';
};

// The TMDB token typed before another administrator saved Discovery is refused, and the section's Reload clears it.
checks.secretDiscovery = async browser => {
    const { context, page } = await session(browser);
    const before = (await api(page, 'GET', 'JellyfinMod/Settings/Discovery')).body;
    try {
        await go(page, '#/catalog/settings?section=discovery');
        await typeSecret(page, 'TMDB', 'jfmodTmdbToken', 'jfmod-review-not-a-token');
        const elsewhere = await api(page, 'PATCH', 'JellyfinMod/Settings/Discovery', { token: { action: 'unchanged', value: null }, revision: before.revision });
        const call = runnerCall(await page.evaluate(() => ApiClient.accessToken()));
        const bodies = await guardSecret(page, '**/JellyfinMod/Settings/Discovery', 'token', before.revision,
            revisionReader(call, 'JellyfinMod/Settings/Discovery'), 'wrfw-1');
        if (!bodies) return;
        const reread = await refetchOnFocus(page, /\/JellyfinMod\/Settings\/Discovery$/);
        await page.waitForTimeout(800);
        const answered = responseTo(page, 'PATCH', /\/JellyfinMod\/Settings\/Discovery$/, 15000).catch(() => null);
        await sectionSave(page).click();
        const status = (await answered)?.status();
        const conflict = await noticeMatching(page, /changed somewhere else/);
        const after = (await api(page, 'GET', 'JellyfinMod/Settings/Discovery')).body;
        record('wrfw-1', 'a TMDB token typed before another administrator\'s save is refused with the revision it started from',
            elsewhere.status === 200 && reread === 200 && bodies[0]?.revision === before.revision && bodies[0]?.token?.action === 'replace'
                && status === 409 && !!conflict && after.revision === elsewhere.body?.revision,
            `elsewhere ${elsewhere.status}, refetch ${reread}, sent revision ${bodies[0]?.revision} (typed at ${before.revision}), answered ${status}, `
            + `revision now ${after.revision} (elsewhere ${elsewhere.body?.revision}), notice "${conflict.slice(0, 60)}"`);
        // A Reload whose read of Discovery itself fails keeps the token and says so (final web review 2, P2 8).
        let failedOnce = false;
        await page.route('**/JellyfinMod/Settings/Discovery', route => {
            if (failedOnce || route.request().method() !== 'GET') return route.fallback();
            failedOnce = true;
            return route.abort();
        });
        const firstReload = page.locator('.jfmod-notice button', { hasText: 'Reload' }).first();
        if (await firstReload.count()) await firstReload.click();
        const unread = await noticeMatching(page, /could not be read/, 10000);
        const keptOnFailure = await secretShown(page, 'jfmodTmdbToken');
        record('wrfw-1', 'a Reload whose Discovery read fails keeps the token and says so', failedOnce && !!unread && keptOnFailure === 'typed',
            `read failed ${failedOnce}, notice "${unread.slice(0, 60)}", field ${keptOnFailure}`);
        const reload = page.locator('.jfmod-notice button', { hasText: 'Reload' }).first();
        if (await reload.count()) await reload.click();
        await page.waitForFunction(() => ![...document.querySelectorAll('.jfmod-notice')].some(node => /changed somewhere else|could not be read/.test(node.textContent ?? '')),
            undefined, { timeout: 15000 }).catch(() => null);
        await page.waitForTimeout(500);
        const shown = await secretShown(page, 'jfmodTmdbToken');
        record('wrfw-1', 'the section\'s Reload clears the refused token', shown !== 'typed', shown);
    } finally {
        await page.unroute('**/JellyfinMod/Settings/Discovery').catch(() => null);
        // The other administrator's save cleared the token's test: it is tested again, with the stored token.
        await restoreStep('the TMDB token is verified again', async () => {
            const now = (await api(page, 'GET', 'JellyfinMod/Settings/Discovery')).body;
            if (before.verified && !now.verified) await api(page, 'POST', 'JellyfinMod/Settings/Discovery/Test');
            const final = (await api(page, 'GET', 'JellyfinMod/Settings/Discovery')).body;
            return final.tokenConfigured === before.tokenConfigured && final.verified === before.verified ? true :
                `configured ${final.tokenConfigured}, verified ${final.verified}`;
        });
        await closeAll(context);
    }
};

// A Prowlarr key typed before another administrator saved the source is refused, and Reload clears it. The source is this
// run's own (the instance has none), made with a placeholder key and deleted by its id.
checks.secretProwlarr = async browser => {
    const { context, page } = await session(browser);
    let made = null;
    try {
        if (((await api(page, 'GET', 'JellyfinMod/Settings/Prowlarr')).body ?? []).length) {
            record('wrfw-1', 'a Prowlarr source is made for the check', false, 'the instance already has one; it is not this run\'s');
            return;
        }
        const created = await api(page, 'POST', 'JellyfinMod/Settings/Prowlarr', { name: `JellyfinMod Review Prowlarr ${SECOND_CLIENT.slice(-8)}`,
            baseUrl: 'http://127.0.0.1:9', enabled: false, syncIntervalMinutes: 360, apiKey: { action: 'replace', value: 'jfmod-review-placeholder' } });
        made = created.body?.id ?? null;
        if (!made) { record('wrfw-1', 'a Prowlarr source is made for the check', false, `${created.status}`); return; }
        await go(page, '#/catalog/settings?section=indexers');
        const card = page.locator('[data-prowlarr="card"]');
        await card.waitFor({ timeout: 30000 });
        await typeSecret(card, 'API key', 'jfmodProwlarrKey', 'jfmod-review-not-a-key');
        const elsewhere = await api(page, 'PATCH', `JellyfinMod/Settings/Prowlarr/${made}`, { name: created.body.name, baseUrl: created.body.baseUrl,
            enabled: false, syncIntervalMinutes: 360, apiKey: { action: 'unchanged', value: null }, revision: created.body.revision });
        const call = runnerCall(await page.evaluate(() => ApiClient.accessToken()));
        const bodies = await guardSecret(page, `**/JellyfinMod/Settings/Prowlarr/${made}`, 'apiKey', created.body.revision,
            revisionReader(call, 'JellyfinMod/Settings/Prowlarr', made), 'wrfw-1');
        if (!bodies) return;
        const reread = await refetchOnFocus(page, /\/JellyfinMod\/Settings\/Prowlarr$/);
        await page.waitForTimeout(800);
        const answered = responseTo(page, 'PATCH', new RegExp(`/Settings/Prowlarr/${made}$`), 15000).catch(() => null);
        await card.locator('button', { hasText: /^Save$/ }).click();
        const status = (await answered)?.status();
        await page.waitForTimeout(800);
        const conflict = (await card.locator('.jfmod-notice').first().innerText().catch(() => '')).trim();
        record('wrfw-1', 'a Prowlarr key typed before another administrator\'s save is refused with the revision it started from',
            elsewhere.status === 200 && reread === 200 && bodies[0]?.revision === created.body.revision && bodies[0]?.apiKey?.action === 'replace'
                && status === 409 && /changed somewhere else/.test(conflict),
            `elsewhere ${elsewhere.status}, refetch ${reread}, sent revision ${bodies[0]?.revision} (typed at ${created.body.revision}), answered ${status}, "${conflict}"`);
        const reload = card.locator('.jfmod-notice button', { hasText: 'Reload' }).first();
        if (await reload.count()) await reload.click();
        await page.waitForFunction(() => ![...document.querySelectorAll('.jfmod-notice')].some(node => /changed somewhere else/.test(node.textContent ?? '')),
            undefined, { timeout: 15000 }).catch(() => null);
        await page.waitForTimeout(500);
        const shown = await secretShown(card, 'jfmodProwlarrKey');
        record('wrfw-1', 'the card\'s Reload clears the refused Prowlarr key', shown !== 'typed', shown);
    } finally {
        await page.unrouteAll({ behavior: 'ignoreErrors' });
        if (made) {
            await restoreStep('this run\'s Prowlarr source is deleted', async () => {
                const removed = await api(page, 'DELETE', `JellyfinMod/Settings/Prowlarr/${made}`);
                const left = ((await api(page, 'GET', 'JellyfinMod/Settings/Prowlarr')).body ?? []).some(item => item.id === made);
                return !left ? true : `delete answered ${removed.status}, still listed`;
            });
        }
        await closeAll(context);
    }
};

// The indexer editor's Reload after a conflict clears a key typed against the old copy; Save then leaves the key alone.
checks.secretIndexer = async browser => {
    const { context, page } = await session(browser);
    const indexers = (await api(page, 'GET', 'JellyfinMod/Settings/Indexers')).body ?? [];
    try {
        await go(page, '#/catalog/settings?section=indexers');
        await page.locator('.jfmod-check-main [data-row-action="edit"]').first().click();
        const dialog = page.locator('.jfmod-settingsDialog');
        await dialog.waitFor({ timeout: 15000 });
        const title = (await dialog.locator('h2').innerText()).replace(/^Edit /, '');
        const indexer = indexers.find(item => item.name === title);
        await typeSecret(dialog, 'API key', 'jfmodIndexerKey', 'jfmod-review-not-a-key');
        const elsewhere = await api(page, 'PATCH', `JellyfinMod/Settings/Indexers/${indexer.id}`, {
            ...Object.fromEntries(['name', 'baseUrl', 'enabled', 'automateTitleMatches', 'categories', 'priority', 'downloadHosts', 'minimumSeedRatio',
                'minimumSeedMinutes', 'minIntervalSeconds', 'dailyQueryBudget'].map(key => [key, indexer[key] ?? null])),
            apiKey: { action: 'unchanged', value: null }, revision: indexer.revision });
        const call = runnerCall(await page.evaluate(() => ApiClient.accessToken()));
        const bodies = await guardSecret(page, `**/JellyfinMod/Settings/Indexers/${indexer.id}`, 'apiKey', indexer.revision,
            revisionReader(call, 'JellyfinMod/Settings/Indexers', indexer.id), 'wrfw-1');
        if (!bodies) return;
        const refused = responseTo(page, 'PATCH', new RegExp(`/Settings/Indexers/${indexer.id}$`), 15000).catch(() => null);
        await dialog.locator('button', { hasText: /^Save$/ }).click();
        const refusedStatus = (await refused)?.status();
        const reload = dialog.locator('.jfmod-notice button', { hasText: 'Reload' });
        await reload.waitFor({ timeout: 10000 }).catch(() => null);
        if (await reload.count()) await reload.click();
        await page.waitForFunction(() => ![...document.querySelectorAll('.jfmod-notice')].some(node => /changed somewhere else/.test(node.textContent ?? '')),
            undefined, { timeout: 15000 }).catch(() => null);
        await page.waitForTimeout(500);
        const shown = await secretShown(dialog, 'jfmodIndexerKey');
        const saved = responseTo(page, 'PATCH', new RegExp(`/Settings/Indexers/${indexer.id}$`), 15000).catch(() => null);
        await dialog.locator('button', { hasText: /^Save$/ }).click();
        const savedStatus = (await saved)?.status();
        const closed = await dialog.waitFor({ state: 'detached', timeout: 10000 }).then(() => true).catch(() => false);
        record('wrfw-1', 'after a conflict, the indexer editor\'s Reload clears the typed key, and Save leaves the stored key alone',
            elsewhere.status === 200 && refusedStatus === 409 && bodies[0]?.revision === indexer.revision && shown !== 'typed'
                && bodies[1]?.apiKey?.action === 'unchanged' && savedStatus === 200 && closed,
            `elsewhere ${elsewhere.status}, first save ${refusedStatus} at ${bodies[0]?.revision}, after Reload ${shown}, `
            + `second save ${savedStatus} with key ${bodies[1]?.apiKey?.action}, closed ${closed}`);
    } finally {
        await page.unrouteAll({ behavior: 'ignoreErrors' });
        // Saving an indexer clears its verification: each one the check saved is tested again with its stored key.
        await restoreStep('the indexers are verified again', async () => {
            const now = (await api(page, 'GET', 'JellyfinMod/Settings/Indexers')).body ?? [];
            for (const item of now) {
                if (indexers.find(old => old.id === item.id)?.verified && !item.verified) await api(page, 'POST', `JellyfinMod/Settings/Indexers/${item.id}/Test`);
            }
            const final = (await api(page, 'GET', 'JellyfinMod/Settings/Indexers')).body ?? [];
            const lost = indexers.filter(old => old.verified && !final.find(item => item.id === old.id)?.verified);
            return lost.length === 0 ? true : `not verified: ${lost.map(item => item.name).join(', ')}`;
        });
        await closeAll(context);
    }
};

// A seed-protection password typed before another administrator saved seed protection is refused, and Reload clears it.
// Seed protection is switched to a separate, unreachable Transmission for the check and put back in a finally.
checks.secretSeed = async browser => {
    const { context, page } = await session(browser);
    const retention = (await api(page, 'GET', 'JellyfinMod/Settings/Retention')).body;
    const seed = (await api(page, 'GET', 'JellyfinMod/Settings/SeedProtection')).body;
    try {
        const separate = await api(page, 'PATCH', 'JellyfinMod/Settings/SeedProtection', { source: 'separate', rpcUrl: 'http://127.0.0.1:9/transmission/rpc',
            username: '', password: { action: 'unchanged', value: null }, revision: seed.revision });
        if (separate.status !== 200) { record('wrfw-1', 'seed protection is switched to a separate client for the check', false, `${separate.status}`); return; }
        await go(page, '#/catalog/settings?section=retention');
        await page.locator('#jfmodSeedPassword').waitFor({ timeout: 30000 });
        await page.locator('#jfmodSeedPassword').fill('jfmod-review-not-a-password');
        const elsewhere = await api(page, 'PATCH', 'JellyfinMod/Settings/SeedProtection', { source: 'separate', rpcUrl: 'http://127.0.0.1:9/transmission/rpc',
            username: '', password: { action: 'unchanged', value: null }, revision: separate.body.revision });
        const call = runnerCall(await page.evaluate(() => ApiClient.accessToken()));
        const bodies = await guardSecret(page, '**/JellyfinMod/Settings/SeedProtection', 'password', separate.body.revision,
            revisionReader(call, 'JellyfinMod/Settings/SeedProtection'), 'wrfw-1');
        if (!bodies) return;
        const reread = await refetchOnFocus(page, /\/JellyfinMod\/Settings\/SeedProtection$/);
        await page.waitForTimeout(800);
        const answered = responseTo(page, 'PATCH', /\/JellyfinMod\/Settings\/SeedProtection$/, 15000).catch(() => null);
        await sectionSave(page).click();
        const status = (await answered)?.status();
        const conflict = await noticeMatching(page, /changed somewhere else/);
        const after = (await api(page, 'GET', 'JellyfinMod/Settings/SeedProtection')).body;
        record('wrfw-1', 'a seed-protection password typed before another administrator\'s save is refused with the revision it started from',
            elsewhere.status === 200 && reread === 200 && bodies[0]?.revision === separate.body.revision && bodies[0]?.password?.action === 'replace'
                && status === 409 && !!conflict && after.passwordConfigured === false,
            `elsewhere ${elsewhere.status}, refetch ${reread}, sent revision ${bodies[0]?.revision} (typed at ${separate.body.revision}), answered ${status}, `
            + `password configured ${after.passwordConfigured}`);
        const reload = page.locator('.jfmod-notice button', { hasText: 'Reload' }).first();
        if (await reload.count()) await reload.click();
        await page.waitForFunction(() => ![...document.querySelectorAll('.jfmod-notice')].some(node => /changed somewhere else/.test(node.textContent ?? '')),
            undefined, { timeout: 15000 }).catch(() => null);
        await page.waitForTimeout(500);
        const value = await page.locator('#jfmodSeedPassword').inputValue().catch(() => '(none)');
        record('wrfw-1', 'the section\'s Reload clears the refused password', value === '', value === '' ? 'empty' : 'a typed value is still shown');
    } finally {
        await page.unrouteAll({ behavior: 'ignoreErrors' });
        await restoreStep('the seed protection source', () => restoreSeed(page, seed));
        await restoreStep('the retention settings', () => restoreRetention(page, retention));
        await closeAll(context);
    }
};

// An edit typed while the section's save is under way survives that save's refetch, and a second Save sends it.
checks.editDuringSave = async browser => {
    const { context, page } = await session(browser);
    const original = (await api(page, 'GET', 'JellyfinMod/Settings/Import')).body;
    try {
        await go(page, '#/catalog/settings?section=import');
        const stalled = page.getByLabel(/stalled/i).first();
        const scan = page.getByLabel(/Ask for a library scan again/i).first();
        await stalled.waitFor({ timeout: 30000 });
        const first = String((original.stalledAfterHours ?? 24) + 5);
        const later = String((original.scanTimeoutMinutes ?? 30) + 7);
        await stalled.fill(first);
        // The save's real request is held for 2.5 s, as on a slow connection.
        await page.route('**/JellyfinMod/Settings/Import', async route => {
            if (route.request().method() !== 'PATCH') return route.continue();
            await sleep(2500);
            return route.continue();
        });
        const savedOnce = responseTo(page, 'PATCH', /\/JellyfinMod\/Settings\/Import$/, 20000).catch(() => null);
        await sectionSave(page).click();
        await page.waitForTimeout(500);
        await scan.fill(later);
        const firstStatus = (await savedOnce)?.status();
        await noticeMatching(page, /^Saved/, 10000);
        await page.waitForTimeout(2500);
        const kept = await scan.inputValue();
        const server = (await api(page, 'GET', 'JellyfinMod/Settings/Import')).body;
        record('wrfw-2', 'an edit typed while the save was under way is kept after the save and its refetch',
            firstStatus === 200 && kept === later && String(server.stalledAfterHours) === first && server.scanTimeoutMinutes === original.scanTimeoutMinutes,
            `first save ${firstStatus}, field "${kept}" (typed "${later}"), server stalled ${server.stalledAfterHours}, scan ${server.scanTimeoutMinutes}`);
        await page.unroute('**/JellyfinMod/Settings/Import');
        const savedTwice = responseTo(page, 'PATCH', /\/JellyfinMod\/Settings\/Import$/, 15000).catch(() => null);
        await sectionSave(page).click();
        const secondStatus = (await savedTwice)?.status();
        await page.waitForTimeout(1000);
        const finalServer = (await api(page, 'GET', 'JellyfinMod/Settings/Import')).body;
        record('wrfw-2', 'a second Save sends that edit with the revision of the first save', secondStatus === 200 && String(finalServer.scanTimeoutMinutes) === later,
            `second save ${secondStatus}, server scan ${finalServer.scanTimeoutMinutes}`);
    } finally {
        await page.unrouteAll({ behavior: 'ignoreErrors' });
        await restoreStep('the import settings', () => restoreImport(page, original));
        await closeAll(context);
    }
};

// A password typed while the client's save is under way stays pending after that save. On a turned-off second client the
// check makes and selects, as above.
checks.passwordDuringSave = async browser => {
    const { context, page } = await session(browser);
    const { acquisition, client } = await selectedClientOf(page);
    const second = { id: null };
    try {
        const other = await selectSecondClient(page, client, 'wrfw-2', second);
        if (!other) return;
        await go(page, '#/catalog/settings?section=client');
        const shownClient = await page.waitForFunction(expected => [...document.querySelectorAll('input')].some(input => input.value === expected),
            SECOND_CLIENT, { timeout: 30000 }).then(() => true).catch(() => false);
        if (!shownClient) { record('wrfw-2', 'the second client is shown before a password is typed', false); return; }
        const passwordField = page.locator('#jfmodClientPassword');
        if (!await passwordField.isVisible().catch(() => false)) await page.getByRole('button', { name: 'Replace' }).first().click();
        await passwordField.fill('jfmod-review-first');
        await page.route(`**/JellyfinMod/Settings/DownloadClients/${other}`, async route => {
            if (route.request().method() !== 'PATCH') return route.fallback();
            await sleep(2500);
            return route.fallback();
        });
        const saved = responseTo(page, 'PATCH', new RegExp(`/DownloadClients/${other}$`), 20000).catch(() => null);
        await sectionSave(page).click();
        await page.waitForTimeout(500);
        await passwordField.fill('jfmod-review-second');
        const status = (await saved)?.status();
        await page.waitForTimeout(3000);
        const shown = await page.locator('#jfmodClientPassword').inputValue().catch(() => '');
        const after = ((await api(page, 'GET', 'JellyfinMod/Settings/DownloadClients')).body ?? []).find(item => item.id === other);
        record('wrfw-2', 'a password typed while the client\'s save was under way is still pending after it',
            status === 200 && after?.passwordConfigured === true && shown === 'jfmod-review-second',
            `save ${status}, password configured ${after?.passwordConfigured}, field ${shown === 'jfmod-review-second' ? 'keeps the newer value' : `"${shown ? 'another value' : ''}"`}`);
        // The kept password stands on the revision the first save returned, so its own save is accepted (final web review 2, P2 6).
        await page.unroute(`**/JellyfinMod/Settings/DownloadClients/${other}`);
        const sentAgain = page.waitForRequest(item => item.method() === 'PATCH' && new URL(item.url()).pathname.endsWith(`/DownloadClients/${other}`),
            { timeout: 15000 }).catch(() => null);
        const savedAgain = responseTo(page, 'PATCH', new RegExp(`/DownloadClients/${other}$`), 15000).catch(() => null);
        await sectionSave(page).click();
        const againBody = (await sentAgain)?.postDataJSON() ?? null;
        const againStatus = (await savedAgain)?.status();
        await page.waitForTimeout(1500);
        const pendingAfter = await page.locator('#jfmodClientPassword').inputValue().catch(() => '');
        record('wrfw-2', 'the kept password is then saved, with the revision the first save returned',
            againStatus === 200 && againBody?.password?.action === 'replace' && againBody?.revision === after?.revision && !pendingAfter,
            `second save ${againStatus} with password ${againBody?.password?.action} at revision ${againBody?.revision} (client at ${after?.revision}), `
            + `field ${pendingAfter ? 'still holds a value' : 'cleared'}`);
    } finally {
        await page.unrouteAll({ behavior: 'ignoreErrors' });
        await restoreStep('the client selection and grabbing switch', () => restoreSelection(page, acquisition));
        await restoreStep('the second client is deleted', () => removeSecondClients(page, second));
        await closeAll(context);
    }
};

// Another administrator saves between this section's save and its refetch: the edit typed during the save is kept, the
// change is announced, and the next Save is refused instead of overwriting the other save (final web review 2, P2 1).
checks.competingDuringSave = async browser => {
    const { context, page } = await session(browser);
    const original = (await api(page, 'GET', 'JellyfinMod/Settings/Import')).body;
    const call = runnerCall(await page.evaluate(() => ApiClient.accessToken()));
    let competingDone = null;
    try {
        await go(page, '#/catalog/settings?section=import');
        const stalled = page.getByLabel(/stalled/i).first();
        const scan = page.getByLabel(/Ask for a library scan again/i).first();
        await stalled.waitFor({ timeout: 30000 });
        await stalled.fill(String((original.stalledAfterHours ?? 24) + 5));
        const otherPoll = (original.importPollSeconds ?? 60) + 3;
        let competing = null;
        // The save's real answer is held; meanwhile another administrator saves on top of it, so the refetch brings theirs.
        // The handler's own PATCH is awaited before restoring, so it can never land after the restore (final Pi review, P2 3).
        await page.route('**/JellyfinMod/Settings/Import', route => {
            if (route.request().method() !== 'PATCH') return route.fallback();
            competingDone = (async () => {
                const response = await route.fetch();
                await sleep(1500);
                const now = (await call('GET', 'JellyfinMod/Settings/Import')).body;
                competing = await call('PATCH', 'JellyfinMod/Settings/Import', { ...Object.fromEntries(Object.entries(now).filter(([key]) => key !== 'revision')),
                    importPollSeconds: otherPoll, revision: now.revision });
                await route.fulfill({ response }).catch(() => null);
            })();
            return competingDone;
        });
        const saved = responseTo(page, 'PATCH', /\/JellyfinMod\/Settings\/Import$/, 20000).catch(() => null);
        await sectionSave(page).click();
        await page.waitForTimeout(400);
        const later = String((original.scanTimeoutMinutes ?? 30) + 7);
        await scan.fill(later);
        const firstStatus = (await saved)?.status();
        const warned = await noticeMatching(page, /changed somewhere else/, 10000);
        await page.unroute('**/JellyfinMod/Settings/Import');
        const kept = await scan.inputValue();
        const refused = responseTo(page, 'PATCH', /\/JellyfinMod\/Settings\/Import$/, 15000).catch(() => null);
        await sectionSave(page).click();
        const secondStatus = (await refused)?.status();
        await page.waitForTimeout(800);
        const server = (await api(page, 'GET', 'JellyfinMod/Settings/Import')).body;
        record('wrfw-2', 'a save another administrator saved over before its refetch keeps the later edit, says so, and its next Save is refused',
            firstStatus === 200 && competing?.status === 200 && !!warned && kept === later && secondStatus === 409 && server.importPollSeconds === otherPoll
                && server.scanTimeoutMinutes === original.scanTimeoutMinutes,
            `first save ${firstStatus}, competing ${competing?.status}, notice "${warned.slice(0, 50)}", field "${kept}", second save ${secondStatus}, `
            + `server poll ${server.importPollSeconds} (other ${otherPoll}), scan ${server.scanTimeoutMinutes}`);
    } finally {
        await page.unrouteAll({ behavior: 'wait' }).catch(() => null);
        await competingDone?.catch(() => null);
        await restoreStep('the import settings', () => restoreImport(page, original));
        await closeAll(context);
    }
};

// An editor edited while its save was under way stays open with that edit, and closes without saving it on Cancel
// (final web review 2, P2 7).
checks.editorDuringSave = async browser => {
    const { context, page } = await session(browser);
    const profiles = (await api(page, 'GET', 'JellyfinMod/Settings/QualityProfiles')).body ?? [];
    try {
        await go(page, '#/catalog/settings?section=profiles');
        await page.locator('.jfmod-check-main [data-row-action="edit"]').first().click();
        const dialog = page.locator('.jfmod-settingsDialog');
        await dialog.waitFor({ timeout: 15000 });
        const title = (await dialog.locator('h2').innerText()).replace(/^Edit /, '');
        const profile = profiles.find(item => item.name === title);
        await page.route('**/JellyfinMod/Settings/QualityProfiles/*', async route => {
            if (route.request().method() !== 'PATCH') return route.fallback();
            await sleep(2000);
            return route.fallback();
        });
        const saved = responseTo(page, 'PATCH', /\/Settings\/QualityProfiles\/[^/]+$/, 20000).catch(() => null);
        await dialog.locator('button', { hasText: /^Save$/ }).click();
        await page.waitForTimeout(400);
        const seeders = dialog.getByLabel('Minimum seeders');
        const typed = String((profile?.minimumSeeders ?? 0) + 17);
        await seeders.fill(typed);
        const status = (await saved)?.status();
        await page.waitForTimeout(1000);
        const open = await dialog.count() === 1;
        const kept = open ? await seeders.inputValue() : '';
        const notice = open ? (await dialog.locator('.jfmod-notice').first().innerText().catch(() => '')).trim() : '';
        if (open) await dialog.locator('button', { hasText: 'Cancel' }).click();
        await page.waitForTimeout(800);
        const after = ((await api(page, 'GET', 'JellyfinMod/Settings/QualityProfiles')).body ?? []).find(item => item.id === profile?.id);
        record('wrfw-7', 'an editor edited during its save stays open with the edit, and Cancel leaves it unsaved',
            status === 200 && open && kept === typed && /not saved yet/.test(notice) && after?.minimumSeeders === profile?.minimumSeeders,
            `save ${status}, open ${open}, field "${kept}" (typed "${typed}"), notice "${notice.slice(0, 60)}", seeders now ${after?.minimumSeeders}`);
    } finally {
        await page.unrouteAll({ behavior: 'ignoreErrors' });
        await closeAll(context);
    }
};

// A Prowlarr key typed while another key of the source was saving stays, and is then saved with the revision that save
// returned (final web review 2, P2 6). The source is this run's own, made with a placeholder key and deleted by its id.
checks.secretDuringSave = async browser => {
    const { context, page } = await session(browser);
    let made = null;
    try {
        if (((await api(page, 'GET', 'JellyfinMod/Settings/Prowlarr')).body ?? []).length) {
            record('wrfw-6', 'a Prowlarr source is made for the check', false, 'the instance already has one; it is not this run\'s');
            return;
        }
        const created = await api(page, 'POST', 'JellyfinMod/Settings/Prowlarr', { name: `JellyfinMod Review Prowlarr ${SECOND_CLIENT.slice(-8)}`,
            baseUrl: 'http://127.0.0.1:9', enabled: false, syncIntervalMinutes: 360, apiKey: { action: 'replace', value: 'jfmod-review-placeholder' } });
        made = created.body?.id ?? null;
        if (!made) { record('wrfw-6', 'a Prowlarr source is made for the check', false, `${created.status}`); return; }
        await go(page, '#/catalog/settings?section=indexers');
        const card = page.locator('[data-prowlarr="card"]');
        await card.waitFor({ timeout: 30000 });
        await typeSecret(card, 'API key', 'jfmodProwlarrKey', 'jfmod-review-first-key');
        await page.route(`**/JellyfinMod/Settings/Prowlarr/${made}`, async route => {
            if (route.request().method() !== 'PATCH') return route.fallback();
            await sleep(2000);
            return route.fallback();
        });
        const first = responseTo(page, 'PATCH', new RegExp(`/Settings/Prowlarr/${made}$`), 20000).catch(() => null);
        await card.locator('button', { hasText: /^Save$/ }).click();
        await page.waitForTimeout(400);
        await card.locator('#jfmodProwlarrKey').fill('jfmod-review-second-key');
        const firstStatus = (await first)?.status();
        await page.waitForTimeout(2500);
        const keptShown = await secretShown(card, 'jfmodProwlarrKey');
        await page.unroute(`**/JellyfinMod/Settings/Prowlarr/${made}`);
        const sentAgain = page.waitForRequest(item => item.method() === 'PATCH' && new URL(item.url()).pathname.endsWith(`/Settings/Prowlarr/${made}`),
            { timeout: 15000 }).catch(() => null);
        const second = responseTo(page, 'PATCH', new RegExp(`/Settings/Prowlarr/${made}$`), 15000).catch(() => null);
        await card.locator('button', { hasText: /^Save$/ }).click();
        const againBody = (await sentAgain)?.postDataJSON() ?? null;
        const secondStatus = (await second)?.status();
        await page.waitForTimeout(1500);
        const finalShown = await secretShown(card, 'jfmodProwlarrKey');
        record('wrfw-6', 'a key typed during its source\'s save stays and is then saved with the revision that save returned',
            firstStatus === 200 && keptShown === 'typed' && againBody?.apiKey?.action === 'replace' && secondStatus === 200 && finalShown !== 'typed',
            `first save ${firstStatus}, kept ${keptShown}, second save ${secondStatus} with key ${againBody?.apiKey?.action} at revision `
            + `${againBody?.revision}, then ${finalShown}`);
    } finally {
        await page.unrouteAll({ behavior: 'ignoreErrors' });
        if (made) {
            await restoreStep('this run\'s Prowlarr source is deleted', async () => {
                const removed = await api(page, 'DELETE', `JellyfinMod/Settings/Prowlarr/${made}`);
                const left = ((await api(page, 'GET', 'JellyfinMod/Settings/Prowlarr')).body ?? []).some(item => item.id === made);
                return !left ? true : `delete answered ${removed.status}, still listed`;
            });
        }
        await closeAll(context);
    }
};

// The profile editor's Save sends once however often it is pressed while its request is under way.
checks.saveOnce = async browser => {
    const { context, page } = await session(browser);
    try {
        await go(page, '#/catalog/settings?section=profiles');
        await page.locator('.jfmod-check-main [data-row-action="edit"]').first().click();
        const dialog = page.locator('.jfmod-settingsDialog');
        await dialog.waitFor({ timeout: 15000 });
        const patches = [];
        await page.route('**/JellyfinMod/Settings/QualityProfiles/*', async route => {
            if (route.request().method() !== 'PATCH') return route.continue();
            patches.push(route.request().url());
            await sleep(1500);
            return route.continue();
        });
        const save = dialog.locator('button', { hasText: /^Save$/ });
        await save.click();
        await save.click({ force: true, timeout: 2000 }).catch(() => null);
        await save.evaluate(node => node.click()).catch(() => null);
        const closed = await dialog.waitFor({ state: 'detached', timeout: 10000 }).then(() => true).catch(() => false);
        await page.waitForTimeout(1000);
        record('wrfw-9', 'pressing the editor\'s Save three times during its request sends one save', patches.length === 1 && closed,
            `${patches.length} PATCH(es), closed ${closed}`);
    } finally {
        await page.unrouteAll({ behavior: 'ignoreErrors' });
        await closeAll(context);
    }
};

// Fixes review P2 4 and Codex delta reviews 4 and 6: the wizard names a section it could not read, with a Retry that recovers.
// On the TV at 1280x720, Retry pressed with Enter leaves focus on the step's heading; from there the remote's Down and the
// keyboard's Tab stay in the step, and Back leaves the wizard.
checks.wizardFailures = async browser => {
    const { context, page } = await session(browser, 'tv', { width: 1280, height: 720 });
    let refused = 0;
    await page.route('**/JellyfinMod/Settings/DownloadClients', route => {
        if (route.request().method() === 'GET' && refused === 0) { refused++; return route.abort(); }
        return route.continue();
    });
    await go(page, '#/home');
    await go(page, '#/catalog/settings/setup');
    const shown = await page.waitForSelector('[data-jfmod-settings-failures]', { timeout: 20000 }).then(node => node.innerText()).catch(() => '');
    const retry = page.locator('[data-jfmod-settings-failures] button', { hasText: 'Retry' }).first();
    let recovered = false;
    let heading = null;
    const where = () => page.evaluate(() => {
        const active = document.activeElement;
        return { tag: active?.tagName ?? '', id: active?.id ?? '', inStep: !!active?.closest('.jfmod-check-main') };
    });
    let down = null;
    let tab = null;
    let back = null;
    if (await retry.count()) {
        const reread = responseTo(page, 'GET', CLIENTS).catch(() => null);
        await retry.focus();
        await page.keyboard.press('Enter');
        const status = (await reread)?.status();
        recovered = status === 200 && await page.waitForSelector('[data-jfmod-settings-failures]', { state: 'detached', timeout: 15000 })
            .then(() => true).catch(() => false);
        heading = await page.waitForFunction(() => document.activeElement?.id?.startsWith('jfmod-h-') ? document.activeElement.id : null,
            undefined, { timeout: 5000 }).then(handle => handle.jsonValue()).catch(() => null);
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(400);
        down = await where();
        await page.keyboard.press('Tab');
        await page.waitForTimeout(300);
        tab = await where();
        // The TV layout's Back from a keyboard is Escape (keyboardNavigation: Escape is 'back' when layoutManager.tv).
        await page.evaluate(() => document.activeElement?.blur());
        await page.keyboard.press('Escape');
        await page.waitForTimeout(1500);
        back = await page.evaluate(() => location.hash);
    }
    record('fr-4', 'the wizard names a section it could not read, and its Retry recovers', /Settings\/DownloadClients/.test(shown) && recovered,
        `${shown.replace(/\s+/g, ' ')}; recovered ${recovered}`);
    record('d4-3', 'after a Retry pressed with Enter recovers, focus is on the current step\'s heading', !!heading, String(heading));
    const control = state => state?.inStep && /BUTTON|INPUT|SELECT|TEXTAREA|A/.test(state.tag);
    record('d6-8', 'from there, Down and Tab move to controls of the step, and Back leaves the wizard (TV, 1280x720)',
        control(down) && control(tab) && !!back && !back.startsWith('#/catalog/settings/setup'),
        `down ${JSON.stringify(down)}, tab ${JSON.stringify(tab)}, back to "${back}"`);
    await page.unroute('**/JellyfinMod/Settings/DownloadClients');
    await closeAll(context);
};

// Fixes review P3 5: after a conflict, one Reload makes the section current and Save works. A Reload whose read fails
// keeps the edits and says so, with another Reload (Codex delta review 4, P2 2). The import settings are put back.
checks.conflictReload = async browser => {
    const { context, page } = await session(browser);
    const original = (await api(page, 'GET', 'JellyfinMod/Settings/Import')).body;
    try {
        await go(page, '#/catalog/settings?section=import');
        const field = page.getByLabel(/stalled/i).first();
        await field.waitFor({ timeout: 30000 });
        const edited = String((original.stalledAfterHours ?? 24) + 3);
        await field.fill(edited);
        const { revision, ...values } = original;
        const elsewhere = await api(page, 'PATCH', 'JellyfinMod/Settings/Import', { ...values, revision });
        await sectionSave(page).click();
        const conflictText = await noticeMatching(page, /changed somewhere else/);
        const reload = page.locator('.jfmod-notice button', { hasText: 'Reload' }).first();
        // The first Reload's read of the overview fails.
        let failedOnce = false;
        await page.route('**/JellyfinMod/Settings/Overview', route => {
            if (failedOnce || route.request().method() !== 'GET') return route.continue();
            failedOnce = true;
            return route.abort();
        });
        const failedRead = page.waitForEvent('requestfailed', { predicate: item => /\/Settings\/Overview$/.test(new URL(item.url()).pathname),
            timeout: 15000 }).then(() => true).catch(() => false);
        if (await reload.count()) await reload.click();
        const readFailed = await failedRead;
        const failedNotice = await noticeMatching(page, /could not be read/, 8000);
        await page.waitForTimeout(500);
        const afterFailed = await field.inputValue();
        const offersReload = await page.locator('.jfmod-notice button', { hasText: 'Reload' }).count() > 0;
        record('d4-2', 'a Reload whose read fails keeps the edits and says so, with another Reload',
            readFailed && afterFailed === edited && !!failedNotice && offersReload,
            `read failed ${readFailed}, field "${afterFailed}" (edited "${edited}"), notice "${failedNotice}"`);
        await page.unroute('**/JellyfinMod/Settings/Overview');
        const reread = responseTo(page, 'GET', /\/JellyfinMod\/Settings\/Import$/).catch(() => null);
        const again = page.locator('.jfmod-notice button', { hasText: 'Reload' }).first();
        if (await again.count()) await again.click();
        const rereadStatus = (await reread)?.status();
        await page.waitForFunction(expected => [...document.querySelectorAll('input')].some(input => input.value === expected),
            String(original.stalledAfterHours), { timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(1000);
        const afterReload = await field.inputValue();
        const notice = await page.locator('.jfmod-notice').first().innerText().catch(() => '');
        const savedResponse = responseTo(page, 'PATCH', /\/JellyfinMod\/Settings\/Import$/).catch(() => null);
        await sectionSave(page).click();
        const saveStatus = (await savedResponse)?.status();
        const saved = await noticeMatching(page, /^Saved/);
        const oneClick = elsewhere.status === 200 && !!conflictText && rereadStatus === 200 && afterReload === String(original.stalledAfterHours)
            && !/changed somewhere else/.test(notice) && saveStatus === 200 && !!saved;
        record('fr-5', 'one Reload after a conflict takes the server copy, and Save then succeeds', oneClick,
            `elsewhere ${elsewhere.status}, conflict "${conflictText}", reread ${rereadStatus}, field "${afterReload}", notice "${notice}", then ${saveStatus} "${saved}"`);
    } finally {
        await restoreStep('the import settings', () => restoreImport(page, original));
        await closeAll(context);
    }
};

const browser = await chromium.launch(tier === 'chrome' ? { headless: true, channel: 'chrome' } : { headless: true });
try {
    for (const [name, run] of Object.entries(checks)) {
        if (only.length && !only.includes(name)) continue;
        try {
            await run(browser);
        } catch (error) {
            record(name, 'ran to the end', false, String(error.message).split('\n')[0]);
        }
    }
} finally {
    await browser.close();
}

const failed = results.filter(result => !result.pass).length;
console.log(`${results.length - failed}/${results.length} passed (${tier})`);
process.exit(failed ? 1 : 0);
