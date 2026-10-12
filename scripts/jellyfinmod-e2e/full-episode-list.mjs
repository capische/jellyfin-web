/* eslint-disable compat/compat, no-restricted-globals, @stylistic/max-statements-per-line, no-empty-function, sonarjs/cognitive-complexity -- a Node acceptance runner, not shipped code */
/* global window, document, ApiClient, localStorage, location */
// The full episode list of a discovered series (Phase 1 follow-up, 2026-10-12; docs/jellyfinmod/design/p1-full-episode-list.md).
// Opens the series page of a series reconciliation discovered in the library, whose entry says `episodeListLoaded: false`,
// signed in as oleksii with an empty password, and checks that opening the page alone loads the series' TMDB list once
// through the plugin's EpisodeList (P1.FU9), quietly, and a second visit asks nothing. Then Get a Release: on a fresh page
// (stub and failure modes) the picker shares the page's one request and shows Loading Seasons while it runs; its scope
// switch offers All Seasons and each season, no single episodes (user, 2026-10-12); closing and reopening asks nothing again.
//
//   JELLYFINMOD_TEST_URL=http://<host>:<port>/   a mod instance (18096, 28096, 48096) or a local environment on 127.0.0.1
//   JELLYFINMOD_FEL_ENTRY=<entry id of a discovered series with episodeListLoaded false>
//   [JELLYFINMOD_WEB_PATH=/web/]  [JELLYFINMOD_BROWSER=chromium|chrome]  [JELLYFINMOD_LAYOUTS=desktop,mobile,tv1080]
//   [JELLYFINMOD_FEL_STUB=<file>]  answer EpisodeList in the browser with this EntryDetail JSON instead of the plugin, for an
//                                 environment without a TMDB token; every result then says it was stubbed
//   [JELLYFINMOD_FEL_FAIL=503]     answer EpisodeList with this status instead: the page stays quiet, the picker keeps its
//                                 list and says why
//
// Not read-only: without a stub the first opening runs the plugin's load, which adds the series' TMDB episodes as
// unmonitored rows and one History event. That is the behaviour under test and is not undone, so a live run checks one
// layout: a second layout finds the list loaded.
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
else if (stub) mode = 'stubbed EpisodeList';

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

/** The series page's scope list: All Seasons, then each season with aired episodes other than specials; no episodes. */
const expectedScope = episodes => {
    const seasons = [...new Set(episodes.filter(episode => episode.seasonNumber > 0 && episode.availability !== 'unaired')
        .map(episode => episode.seasonNumber))].sort((a, b) => a - b);
    return [...(seasons.length ? ['All Seasons'] : []), ...seasons.map(season => 'Season ' + season)];
};

async function openPicker(page, layout) {
    const button = page.locator('.jfmod-getRelease:visible').first();
    await button.waitFor({ state: 'visible', timeout: 30000 });
    if (LAYOUTS[layout].tv) {
        await button.focus();
        await page.keyboard.press('Enter');
    } else {
        await button.click();
    }
    await page.waitForSelector('.jfmod-releaseDialog #jfmod-releaseEpisode', { timeout: 15000 });
}

/**
 * Back the way the layout sends it. The picker is an upstream dialog in history: the TV layout maps Escape to Back, but
 * desktop and mobile ignore Escape (keyboardNavigation leaves it uncaptured), so there Back is the browser's.
 */
async function closePicker(page, layout) {
    if (LAYOUTS[layout].tv) await page.keyboard.press('Escape');
    else await page.goBack();
    return page.waitForSelector('.jfmod-releaseDialog', { state: 'detached', timeout: 10000 }).then(() => true, () => false);
}

/** Waits until every EpisodeList request so far has its answer, then a moment for the page's refetch. */
async function settle(page, loads, answered, atLeast) {
    const deadline = Date.now() + 75000;
    while (Date.now() < deadline && (loads.length < atLeast || answered.length < loads.length)) await page.waitForTimeout(250);
    await page.waitForTimeout(2000);
}

/** Lines the page itself (not the picker) shows about the load: there must be none. */
const pageLoadLines = page => page.evaluate(() => [...document.querySelectorAll('.page:not(.hide)')].flatMap(view =>
    [...view.querySelectorAll('.jfmod-episodeListFailure')].map(node => node.textContent)
        .concat(/Loading (Seasons|every season)/.test(view.textContent ?? '') ? ['loading text'] : [])));

async function run(browser, layout) {
    const { tv, ...options } = LAYOUTS[layout];
    const context = await browser.newContext(options);
    const page = await context.newPage();
    const loads = [];
    const answered = [];
    const refreshes = [];
    const isLoad = url => /\/JellyfinMod\/Entries\/[^/]+\/EpisodeList/.test(url);
    page.on('requestfinished', request => { if (isLoad(request.url())) answered.push(request.url()); });
    page.on('requestfailed', request => { if (isLoad(request.url())) answered.push(request.url()); });
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
        // A stub answers slowly enough to read the picker's loading state; the plugin's own answer may come before it can be read.
        await page.route(/\/JellyfinMod\/Entries\/[^/]+\/EpisodeList/, async route => {
            loads.push(route.request().method());
            if (!stub && !failStatus) {
                await route.continue();
                return;
            }
            await new Promise(resolve => setTimeout(resolve, 1500));
            await (failStatus ?
                route.fulfill({ status: failStatus, contentType: 'application/problem+json', body: JSON.stringify({ status: failStatus, title: 'Stubbed' }) }) :
                route.fulfill({ status: 200, contentType: 'application/json', body: stub }));
        });
        // The administrator's Refresh is no longer how a page or the picker loads the list.
        await page.route(/\/JellyfinMod\/Entries\/[^/]+\/Refresh/, async route => {
            refreshes.push(route.request().method());
            await route.continue();
        });
        const target = before.entry.jellyfinItemId ? `id=${before.entry.jellyfinItemId}` : `entryId=${entryId}`;
        const openSeriesPage = () => page.evaluate(path => { location.hash = '#/details?' + path; }, target);

        // 1. The page alone, no picker: one quiet load.
        await openSeriesPage();
        await settle(page, loads, answered, 1);
        record(layout, 'opening the series page with no picker loads the list once, through EpisodeList', loads.length === 1 && refreshes.length === 0,
            { loads, refreshes });
        const quiet = await pageLoadLines(page);
        record(layout, 'the page shows no loading or error line for the load', quiet.length === 0, quiet);
        if (!stub && !failStatus) {
            const loaded = await getEntry(page);
            record(layout, 'the entry now says its list is loaded, with one episodes_listed event and more episodes than the library holds',
                loaded?.episodeListLoaded === true && loaded.history.filter(event => event.eventType === 'episodes_listed').length === 1
                    && loaded.episodes.length > before.episodes.length,
                { episodeListLoaded: loaded?.episodeListLoaded, before: before.episodes.length, after: loaded?.episodes.length });
        }

        // 2. A second visit asks nothing.
        await page.evaluate(() => { location.hash = '#/home'; });
        await page.waitForTimeout(1500);
        await openSeriesPage();
        await page.waitForTimeout(4000);
        record(layout, 'a second visit to the series page asks for nothing', loads.length === 1, loads);

        if (!await page.locator('.jfmod-getRelease:visible').count()) {
            record(layout, 'the picker shares the load and offers seasons only', 'NOT VERIFIED', 'no Get a Release on this page (not an administrator, or no release search)');
            return;
        }
        // 3. The picker. On a fresh page (stub and failure modes, where the list is still unloaded) it opens while the
        // page's load runs and shares it; live, the list is loaded and the picker asks nothing.
        const loadsBefore = loads.length;
        if (stub || failStatus) {
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } }, undefined, { timeout: 30000 });
        }
        await openPicker(page, layout);
        const early = await scopeOptions(page);
        const loadingLine = early.find(option => option.text === 'Loading Seasons…');
        if (loadingLine) {
            record(layout, 'the scope switch shows a disabled Loading Seasons line while the list loads', loadingLine.disabled, early.slice(0, 4));
            const status = await page.locator('.jfmod-releaseStatus').innerText();
            record(layout, 'no search runs while the list loads; the status says it is loading', /Loading every season from TMDB/.test(status), status);
        } else {
            record(layout, 'the scope switch shows a disabled Loading Seasons line while the list loads', 'NOT VERIFIED',
                stub || failStatus ? 'the list had loaded before the switch could be read' : 'live: the page had loaded the list already');
        }
        await page.waitForFunction(() => ![...document.querySelectorAll('.jfmod-releaseDialog #jfmod-releaseEpisode option')]
            .some(option => option.textContent === 'Loading Seasons…'), undefined, { timeout: 70000 });
        await settle(page, loads, answered, loadsBefore);
        const after = await scopeOptions(page);
        const texts = after.map(option => option.text);
        record(layout, 'the switch starts at Choose what to search for, which is no choice', texts[0] === 'Choose what to search for', texts.slice(0, 2));
        const choices = texts.filter(text => text !== 'Choose what to search for');
        record(layout, 'the picker made no request of its own: the page and the picker share one load per visit',
            loads.length === loadsBefore + (stub || failStatus ? 1 : 0) && refreshes.length === 0, { loads, refreshes });
        if (failStatus) {
            const line = await page.locator('.jfmod-episodeListFailure').innerText().catch(() => '');
            const reason = FAILURES.get(failStatus) ?? 'TMDB could not be reached.';
            record(layout, 'a failed load keeps the list and says why in one quiet line in the picker',
                line === `Could not load every season from TMDB. ${reason} Only the episodes in the library are listed.`, line);
            record(layout, 'the scope switch keeps the seasons it had, no single episodes', JSON.stringify(choices) === JSON.stringify(expectedScope(before.episodes)),
                choices.slice(0, 8));
        } else {
            const loaded = stub ? JSON.parse(stub) : await getEntry(page);
            const expected = expectedScope(loaded.episodes);
            record(layout, 'the scope switch offers All Seasons and every season with aired episodes, no single episodes',
                JSON.stringify(choices) === JSON.stringify(expected), { shown: choices, expected });
        }
        record(layout, 'Back closes the picker', await closePicker(page, layout));
        await page.waitForTimeout(1000);
        await openPicker(page, layout);
        await page.waitForTimeout(2000);
        record(layout, 'reopening on the same page asks for nothing again', loads.length === loadsBefore + (stub || failStatus ? 1 : 0), loads);
        await closePicker(page, layout);
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
/* eslint-enable compat/compat, no-restricted-globals, @stylistic/max-statements-per-line, no-empty-function, sonarjs/cognitive-complexity */
