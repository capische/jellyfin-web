/* eslint-disable compat/compat, no-restricted-globals, @stylistic/max-statements-per-line, no-empty-function -- a Node acceptance runner, not shipped code */
/* global window, document, ApiClient, localStorage, location */
// The full episode list of a discovered series (Phase 1 follow-up, 2026-10-12; docs/jellyfinmod/design/p1-full-episode-list.md).
// Opens the series page of a series reconciliation discovered in the library, whose entry says `episodeListLoaded: false`,
// signed in as oleksii with an empty password, opens Get a Release and checks that the picker loads the series' TMDB list
// once: Loading Seasons while it loads, then every season and episode, labelled as before; reopening asks nothing again.
//
//   JELLYFINMOD_TEST_URL=http://<host>:<port>/   a mod instance (18096, 28096, 48096) or a local environment on 127.0.0.1
//   JELLYFINMOD_FEL_ENTRY=<entry id of a discovered series with episodeListLoaded false>
//   [JELLYFINMOD_WEB_PATH=/web/]  [JELLYFINMOD_BROWSER=chromium|chrome]  [JELLYFINMOD_LAYOUTS=desktop,mobile,tv1080]
//   [JELLYFINMOD_FEL_STUB=<file>]  answer the Refresh in the browser with this EntryDetail JSON instead of the plugin, for an
//                                 environment without a TMDB token; every result then says it was stubbed
//   [JELLYFINMOD_FEL_FAIL=503]     answer the Refresh with this status instead: the picker must keep its list and say why
//
// Not read-only: without a stub the first opening runs the plugin's Refresh, which adds the series' TMDB episodes as
// unmonitored rows and one History event. That is the behaviour under test and is not undone.
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const origin = new URL(process.env.JELLYFINMOD_TEST_URL ?? (() => { throw new Error('JELLYFINMOD_TEST_URL is required'); })());
const loopback = ['127.0.0.1', 'localhost'].includes(origin.hostname);
// Never production on 8096: a remote address must be one of the mod instances; a local environment listens on loopback.
if (!loopback && !['18096', '28096', '48096'].includes(origin.port)) throw new Error('Runs on the mod instances or a local environment only');
const entryId = process.env.JELLYFINMOD_FEL_ENTRY ?? (() => { throw new Error('JELLYFINMOD_FEL_ENTRY is required'); })();
const WEB_PATH = process.env.JELLYFINMOD_WEB_PATH ?? '/web/';
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
const stub = process.env.JELLYFINMOD_FEL_STUB ? readFileSync(process.env.JELLYFINMOD_FEL_STUB, 'utf8') : null;
const failStatus = Number(process.env.JELLYFINMOD_FEL_FAIL ?? 0) || null;
const layouts = (process.env.JELLYFINMOD_LAYOUTS ?? 'desktop').split(',').filter(Boolean);
const LAYOUTS = {
    desktop: { viewport: { width: 1440, height: 900 } },
    mobile: {
        viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
    },
    tv1080: { viewport: { width: 1920, height: 1080 }, tv: true }
};
const FAILURES = new Map([
    [404, 'TMDB does not list this series.'],
    [503, 'TMDB is not set up, or the library is busy.'],
    [504, 'TMDB did not answer in time.']
]);
let mode = 'live';
if (failStatus) mode = `stubbed failure ${failStatus}`;
else if (stub) mode = 'stubbed Refresh';

const results = [];
const record = (layout, check, pass, detail) => {
    let verdict = pass;
    if (typeof pass === 'boolean') verdict = pass ? 'PASS' : 'FAIL';
    results.push({ layout, check, verdict, mode, detail });
    console.log(`${verdict} [${layout}, ${mode}] ${check}${detail === undefined ? '' : ' · ' + JSON.stringify(detail).slice(0, 400)}`);
};

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

const getEntry = page => page.evaluate(async id => {
    const response = await fetch(ApiClient.getUrl('JellyfinMod/Entries/' + id),
        { headers: { Authorization: `MediaBrowser Token="${ApiClient.accessToken()}"` } });
    return response.ok ? response.json() : null;
}, entryId);

/** The scope switch as the picker shows it. */
const scopeOptions = page => page.evaluate(() => [...document.querySelectorAll('.jfmod-releaseDialog #jfmod-releaseEpisode option')]
    .map(option => ({ value: option.value, text: option.textContent, disabled: option.disabled })));

/** The scope list the picker should offer for an entry's episodes: All Seasons, each season with aired episodes but specials, every episode. */
const expectedScope = episodes => {
    const pad = value => (value < 10 ? '0' : '') + value;
    const seasons = [...new Set(episodes.filter(episode => episode.seasonNumber > 0 && episode.availability !== 'unaired')
        .map(episode => episode.seasonNumber))].sort((a, b) => a - b);
    const label = episode => `S${pad(episode.seasonNumber)}E${pad(episode.episodeNumber)} · ${episode.title}`
        + (episode.availability === 'onDisk' ? ' (on disk)' : '') + (episode.availability === 'unaired' ? ' (unaired)' : '');
    return [...(seasons.length ? ['All Seasons'] : []), ...seasons.map(season => 'Season ' + season), ...episodes.map(label)];
};

async function openPicker(page, layout) {
    const button = page.locator('.jfmod-getRelease').first();
    await button.waitFor({ state: 'visible', timeout: 30000 });
    if (LAYOUTS[layout].tv) {
        await button.focus();
        await page.keyboard.press('Enter');
    } else {
        await button.click();
    }
    await page.waitForSelector('.jfmod-releaseDialog #jfmod-releaseEpisode', { timeout: 15000 });
}

async function run(browser, layout) {
    const { tv, ...options } = LAYOUTS[layout];
    const context = await browser.newContext(options);
    const page = await context.newPage();
    const refreshes = [];
    try {
        await signIn(page);
        if (tv) {
            await page.evaluate(() => localStorage.setItem('layout', 'tv'));
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } }, undefined, { timeout: 30000 });
        }
        const before = await getEntry(page);
        if (!before) throw new Error('the entry could not be read');
        record(layout, 'the entry is a discovered series whose list is not loaded', before.entry.mediaType === 'series' && before.episodeListLoaded === false,
            { episodeListLoaded: before.episodeListLoaded, episodes: before.episodes.length });
        // A stub answers slowly enough to read the loading state; the plugin's own answer may come before it can be read.
        await page.route(/\/JellyfinMod\/Entries\/[^/]+\/Refresh/, async route => {
            refreshes.push(route.request().method());
            if (!stub && !failStatus) {
                await route.continue();
                return;
            }
            await new Promise(resolve => setTimeout(resolve, 1500));
            await (failStatus ?
                route.fulfill({ status: failStatus, contentType: 'application/problem+json', body: JSON.stringify({ status: failStatus, title: 'Stubbed' }) }) :
                route.fulfill({ status: 200, contentType: 'application/json', body: stub }));
        });
        const target = before.entry.jellyfinItemId ? `id=${before.entry.jellyfinItemId}` : `entryId=${entryId}`;
        await page.evaluate(path => { location.hash = '#/details?' + path; }, target);
        await openPicker(page, layout);
        const early = await scopeOptions(page);
        const loadingLine = early.find(option => option.text === 'Loading Seasons…');
        if (loadingLine) {
            record(layout, 'the scope switch shows a disabled Loading Seasons line while the list loads', loadingLine.disabled, early.slice(0, 4));
            const status = await page.locator('.jfmod-releaseStatus').innerText();
            record(layout, 'no search runs while the list loads; the status says it is loading', /Loading every season from TMDB/.test(status), status);
        } else {
            record(layout, 'the scope switch shows a disabled Loading Seasons line while the list loads', 'NOT VERIFIED',
                'the list had loaded before the switch could be read');
        }
        await page.waitForFunction(() => ![...document.querySelectorAll('.jfmod-releaseDialog #jfmod-releaseEpisode option')]
            .some(option => option.textContent === 'Loading Seasons…'), undefined, { timeout: 70000 });
        await page.waitForTimeout(500);
        const after = await scopeOptions(page);
        const texts = after.map(option => option.text).filter(text => text !== 'Choose what to search for' && text !== 'Choose an episode');
        if (failStatus) {
            const line = await page.locator('.jfmod-episodeListFailure').innerText().catch(() => '');
            const reason = FAILURES.get(failStatus) ?? 'TMDB could not be reached.';
            record(layout, 'a failed load keeps the list and says why in one quiet line',
                line === `Could not load every season from TMDB. ${reason} Only the episodes in the library are listed.`, line);
            const ordered = [...before.episodes.filter(e => e.availability === 'missing' || e.availability === 'reclaimed'),
                ...before.episodes.filter(e => e.availability !== 'missing' && e.availability !== 'reclaimed')];
            record(layout, 'the scope switch keeps the episodes it had', JSON.stringify(texts) === JSON.stringify(expectedScope(ordered)), texts.slice(0, 8));
        } else {
            const loaded = stub ? JSON.parse(stub) : await getEntry(page);
            const ordered = [...loaded.episodes.filter(e => e.availability === 'missing' || e.availability === 'reclaimed'),
                ...loaded.episodes.filter(e => e.availability !== 'missing' && e.availability !== 'reclaimed')];
            const expected = expectedScope(ordered);
            record(layout, 'the scope switch offers All Seasons, every season with aired episodes and every episode, labelled as before',
                JSON.stringify(texts) === JSON.stringify(expected), { shown: texts.length, expected: expected.length, first: texts.slice(0, 6) });
            record(layout, 'the list grew beyond the episodes in the library', loaded.episodes.length > before.episodes.length,
                { before: before.episodes.length, after: loaded.episodes.length });
            if (!stub) {
                record(layout, 'the entry now says its list is loaded, with one episodes_listed event', loaded.episodeListLoaded === true
                    && loaded.history.filter(event => event.eventType === 'episodes_listed').length === 1, { episodeListLoaded: loaded.episodeListLoaded });
            }
        }
        record(layout, 'one Refresh for the opening', refreshes.length === 1, refreshes);
        await page.keyboard.press('Escape');
        await page.waitForSelector('.jfmod-releaseDialog', { state: 'detached', timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(1000);
        await openPicker(page, layout);
        await page.waitForTimeout(2000);
        record(layout, 'reopening on the same page asks for nothing again', refreshes.length === 1, refreshes);
        await page.keyboard.press('Escape');
    } catch (error) {
        record(layout, 'the run completed', false, String(error?.message ?? error).split('\n')[0]);
    } finally {
        await context.close();
    }
}

const browser = await chromium.launch(tier === 'chrome' ? { headless: true, channel: 'chrome' } : { headless: true });
try {
    for (const layout of layouts) await run(browser, layout);
} finally {
    await browser.close();
}
const failed = results.filter(result => result.verdict === 'FAIL').length;
console.log(`${results.length} checks, ${failed} failed (${mode}, ${tier})`);
process.exitCode = failed ? 1 : 0;
/* eslint-enable compat/compat, no-restricted-globals, @stylistic/max-statements-per-line, no-empty-function */
