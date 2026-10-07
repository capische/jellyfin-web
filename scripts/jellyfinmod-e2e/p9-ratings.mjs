/* eslint-disable compat/compat, no-restricted-globals -- a Node acceptance runner, not shipped code */
/* global window, document, ApiClient, localStorage */
// Phase 9 (R6, R7, R8) browser acceptance on the isolated instance, after `p9-live.py setup … fetch`: the Ratings line on a
// native and a file-less detail page, Ratings display (sources, order, the card source), the card text, the settings
// section and Test, an older plugin (Health without the ratings capabilities) and ratings turned off — on desktop, mobile
// and the TV layout at 1920×1080 and 1280×720 by keys only. Signs in as oleksii with an empty password. Run `p9-live.py age`
// first (one title's values 40 days old, for the stale card). oleksii's own ratings display choice is read at the start and
// put back exactly at the end, including whether each key existed (web review 2026-10-07, P3 7).
//
//   JFMOD_P9_URL=<the isolated instance, port 18096> JFMOD_P9_KEY_FILE=<0600 fixture key> JFMOD_P9_STATE=<p9-live state file>
//   JELLYFINMOD_BROWSER=chromium|chrome JFMOD_P9_BROWSER_OUT=<results JSON> JFMOD_P9_SHOTS=<folder> node p9-ratings.mjs
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const required = name => {
    const value = process.env[name];
    if (value === undefined) throw new Error(`${name} is required`);
    return value;
};
/** A wait that may time out: the check that follows reports what is missing. */
const ignore = () => undefined;
/** Whether the page has a signed-in user (runs in the browser). */
const signedIn = () => {
    try {
        return !!ApiClient.getCurrentUserId();
    } catch {
        return false;
    }
};
const origin = new URL(required('JFMOD_P9_URL'));
if (origin.port !== '18096') throw new Error('Runs only against the isolated instance (18096)');
const KEY = readFileSync(required('JFMOD_P9_KEY_FILE'), 'utf8').trim();
const STATE_FILE = required('JFMOD_P9_STATE');
const STATE = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
const SHOTS = process.env.JFMOD_P9_SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const BASE = new URL('/web-mod/', origin).href;
const DEFAULT_ORDER = ['imdb', 'tomatoes_critic', 'tomatoes_audience', 'tmdb', 'trakt'];

const results = [];
const record = (layout, check, verdict, detail) => {
    const text = detail === undefined ? undefined : JSON.stringify(detail).split(KEY).join('<secret>').slice(0, 500);
    results.push({ layout, check, verdict: verdict ? 'PASS' : 'FAIL', detail: text });
    console.log(`${verdict ? 'PASS' : 'FAIL'} [${tier}/${layout}] ${check}${text ? ' :: ' + text.slice(0, 240) : ''}`);
    return verdict;
};

const LAYOUTS = {
    desktop: { viewport: { width: 1440, height: 900 } },
    mobile: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36' },
    tv1080: { viewport: { width: 1920, height: 1080 }, tv: true },
    tv720: { viewport: { width: 1280, height: 720 }, tv: true }
};

const responses = [];
async function open(browser, layoutName, prepare) {
    const layout = LAYOUTS[layoutName];
    const context = await browser.newContext({ viewport: layout.viewport, isMobile: layout.isMobile, hasTouch: layout.hasTouch,
        userAgent: layout.userAgent, serviceWorkers: 'block' });
    // Routes a check needs from the very first request (before the app reads and caches anything).
    if (prepare) await prepare(context);
    const page = await context.newPage();
    page.jfmodErrors = [];
    page.jfmodBrowse = [];
    page.on('pageerror', error => page.jfmodErrors.push(String(error.message).split('\n')[0]));
    page.on('request', request => {
        if (request.url().includes('/JellyfinMod/Browse') && request.method() === 'POST') page.jfmodBrowse.push(request.postDataJSON());
    });
    page.on('response', async response => {
        if (!response.url().includes('/JellyfinMod/')) return;
        try {
            responses.push(await response.text());
        } catch { /* a body that is gone */ }
    });
    await signIn(page);
    if (layout.tv) {
        await page.evaluate(() => localStorage.setItem('layout', 'tv'));
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(signedIn, undefined, { timeout: 30000 });
        await page.waitForTimeout(2500);
    }
    return { context, page };
}

async function signIn(page) {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.ApiClient, undefined, { timeout: 30000 });
    await page.waitForFunction(() => {
        try {
            return !!ApiClient.getCurrentUserId() || /login|selectuser|selectserver/.test(location.hash);
        } catch {
            return false;
        }
    }, undefined, { timeout: 30000 });
    if (await page.evaluate(signedIn)) return;
    const field = page.locator('#txtManualName');
    if (!await field.isVisible().catch(() => false)) {
        const chooser = page.locator('.btnManual').first();
        await chooser.waitFor({ state: 'attached', timeout: 20000 }).catch(ignore);
        if (await chooser.count()) await chooser.evaluate(node => node.click());
        await field.waitFor({ state: 'visible', timeout: 15000 });
    }
    await page.waitForTimeout(800);
    await field.fill('oleksii');
    await page.locator('#txtManualPassword').fill('');
    await page.locator('button:visible').filter({ hasText: 'Sign In' }).first().click();
    await page.waitForFunction(signedIn, undefined, { timeout: 30000 });
    await page.waitForTimeout(1500);
}

const api = (page, method, path, body) => page.evaluate(async request => {
    const response = await fetch(ApiClient.getUrl(request.path), {
        method: request.method,
        headers: { Authorization: `MediaBrowser Token="${ApiClient.accessToken()}"`, ...(request.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: request.body === undefined ? undefined : JSON.stringify(request.body)
    });
    const text = await response.text();
    try {
        return { status: response.status, body: text ? JSON.parse(text) : null };
    } catch {
        return { status: response.status, body: text };
    }
}, { method, path, body });

// ---- The ratings settings are this run's only while they are as p9-live.py's chain left them (web review round 5): every
// save here is sent against the revision the run last wrote — a save by anyone else in between (the user's own key) is
// refused with 409 and stops the run — and the revision each save produced is handed back to that chain. Test and the
// refresh button go only while the revision is still the run's own. The plugin has no conditional Test or refresh, so a save
// between that check and the click is not excluded (one round trip).
class NotOurs extends Error {}
const lastRevision = () => JSON.parse(readFileSync(STATE_FILE, 'utf8')).lastRevision;
const noteRevision = revision => {
    const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    state.lastRevision = revision;
    writeFileSync(STATE_FILE, JSON.stringify(state), { mode: 0o600 });
};
const expectOwn = async page => {
    const current = await api(page, 'GET', '/JellyfinMod/Settings/Ratings');
    if (current.status !== 200 || current.body.revision !== lastRevision()) {
        throw new NotOurs('the ratings settings are not as this run left them');
    }
};
const saveRatings = async (page, change) => {
    const saved = await api(page, 'PATCH', '/JellyfinMod/Settings/Ratings', { ...change, revision: lastRevision() });
    if (saved.status !== 200) throw new NotOurs(`a ratings save was refused (${saved.status})`);
    noteRevision(saved.body.revision);
    return saved;
};
/** The settings area's own Save, held to the same chain: the request's revision is the run's, and the answer's is noted. */
const holdSettingsSaves = async page => {
    await page.route('**/JellyfinMod/Settings/Ratings', async route => {
        if (route.request().method() !== 'PATCH') return route.continue();
        const body = { ...route.request().postDataJSON(), revision: lastRevision() };
        const response = await route.fetch({ postData: JSON.stringify(body) });
        const answer = await response.json();
        if (response.status() === 200) noteRevision(answer.revision);
        else page.jfmodNotOurs = `a ratings save from the settings area was refused (${response.status()})`;
        return route.fulfill({ response, json: answer });
    });
};

const go = async (page, hash) => {
    await page.evaluate(target => {
        window.location.hash = target;
    }, hash);
    await page.waitForTimeout(2500);
};
/** The webOS remote's Back key: keyCode 461, which no browser maps to Escape. Sent through the DevTools protocol. */
const pressRemoteBack = async page => {
    const client = await page.context().newCDPSession(page);
    try {
        for (const type of ['rawKeyDown', 'keyUp']) {
            await client.send('Input.dispatchKeyEvent', { type, windowsVirtualKeyCode: 461, nativeVirtualKeyCode: 461, key: 'GoBack', code: '' });
        }
    } finally {
        await client.detach();
    }
    await page.waitForTimeout(1500);
};
const shot = async (page, name) => {
    if (SHOTS) await page.screenshot({ path: join(SHOTS, `${tier}-${name}.png`) });
};
const chips = page => page.$$eval('#itemDetailPage:not(.hide) .jfmod-ratingChip, .page:not(.hide) .jfmod-ratingChip', nodes => nodes
    .filter(node => node.offsetParent !== null)
    .map(node => ({ source: node.dataset.jfmodRating, provider: node.dataset.jfmodProvider, text: node.textContent, title: node.title,
        tabIndex: node.tabIndex, tag: node.tagName, inSection: !!node.closest('.detailSectionContent'), inMisc: !!node.closest('.itemMiscInfo-secondary') })));
const waitChips = async page => {
    await page.waitForFunction(() => [...document.querySelectorAll('.jfmod-ratingChip')].some(node => node.offsetParent !== null), undefined,
        { timeout: 20000 }).catch(ignore);
    return chips(page);
};
async function preferencesPage(page, layout) {
    await go(page, '#/catalog/preferences');
    await page.waitForSelector('[data-jfmod-source-toggle="imdb"]', { timeout: 20000 });
    const reset = page.locator('[data-jfmod-ratings-reset]');
    if (await reset.count()) {
        await reset.click();
        await page.waitForTimeout(800);
    }
    await page.locator('[data-jfmod-card-source=""]').click();
    await page.waitForTimeout(500);
    const order = await page.$$eval('[data-jfmod-source-toggle][aria-checked="true"]', nodes => nodes.map(node => node.dataset.jfmodSourceToggle));
    record(layout, 'Ratings display starts from the administrator\'s default order', JSON.stringify(order) === JSON.stringify(DEFAULT_ORDER), order);
    await shot(page, `${layout}-preferences`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    record(layout, 'Ratings display has no horizontal scroll', overflow <= 0, { overflow });
}

async function desktop(browser) {
    const layout = 'desktop';
    const { context, page } = await open(browser, layout);
    // The user menu offers Ratings display.
    await page.locator('[aria-controls="app-user-menu"]').first().click();
    await page.waitForTimeout(800);
    const menu = await page.locator('#app-user-menu').innerText().catch(() => '');
    record(layout, 'The user menu offers Ratings display', menu.includes('Ratings display'), menu.split('\n').filter(Boolean));
    await page.keyboard.press('Escape');
    await preferencesPage(page, layout);

    // Native page: the line leads the detail section, in the default order, never a focus stop.
    await go(page, `#/details?id=${STATE.hostItem}`);
    let found = await waitChips(page);
    record(layout, 'The native page shows the Ratings line in the default order', JSON.stringify(found.map(chip => chip.source)) === JSON.stringify(DEFAULT_ORDER),
        found.map(chip => chip.text));
    record(layout, 'Each chip shows its value in its own scale with votes, and says where it came from', found[0]?.text === 'IMDb 8.1 (250K)'
        && found[1]?.text === 'RT critics 91% (310)' && found[3]?.text === 'TMDB 79% (15K)' && /via MDBList, as of/.test(found[0]?.title ?? ''), found.slice(0, 4));
    record(layout, 'The line sits in the detail section; outside TV each chip is a button in the tab order', found.every(chip => chip.inSection
        && chip.tabIndex >= 0 && chip.tag === 'BUTTON'), found.map(chip => ({ tag: chip.tag, tabIndex: chip.tabIndex })));
    // Provenance by keyboard: Enter on a chip shows where its value came from; Enter again hides it (web review P3 6).
    const firstChip = page.locator('#itemDetailPage:not(.hide) .jfmod-ratingChip').first();
    await firstChip.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    const note = await page.locator('#itemDetailPage:not(.hide) [data-jfmod-rating-note]').innerText().catch(() => '');
    const expanded = await firstChip.getAttribute('aria-expanded');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    const closed = await page.locator('#itemDetailPage:not(.hide) [data-jfmod-rating-note]').count();
    record(layout, 'Enter on a chip shows where its value came from, and Enter again hides it', /^IMDb.*via MDBList, as of/.test(note)
        && expanded === 'true' && closed === 0, { note, expanded, closed });
    const order = await page.evaluate(() => {
        const section = document.querySelector('#itemDetailPage:not(.hide) .detailSectionContent') ?? document.querySelector('.detailSectionContent');
        return [...section.children].slice(0, 3).map(node => node.className);
    });
    record(layout, 'The Ratings mount leads the detail section content', order[0]?.includes('jfmod-ratingsMount'), order);
    await shot(page, `${layout}-native`);
    // Administrator: Refresh ratings queues one fetch. Every other read of this title's ratings stalls meanwhile: the button
    // must not wait on those background reads (review round 3, P2 4).
    const stalled = [];
    await page.route('**/JellyfinMod/Ratings/Items/**', route => {
        stalled.push(route);
    });
    const refresh = page.locator('[data-jfmod-ratings-refresh]:visible').first();
    await expectOwn(page);
    await refresh.click();
    await page.waitForTimeout(1500);
    const message = await page.locator('.jfmod-nativeEntryDetails [role="status"]').first().innerText().catch(() => '');
    record(layout, 'Refresh ratings queues a refresh and says so', /queued/i.test(message), message);
    // It then waits for the server's refresh queue to empty and reads the title again (web review P2 3).
    await page.waitForFunction(() => /Ratings refreshed|no new values|still waiting/.test(document.querySelector('.jfmod-nativeEntryDetails [role="status"]')
        ?.textContent ?? ''), undefined, { timeout: 75000 }).catch(ignore);
    const finished = await page.locator('.jfmod-nativeEntryDetails [role="status"]').first().innerText().catch(() => '');
    await page.waitForTimeout(500);
    const busy = await refresh.getAttribute('aria-busy');
    const stalledReads = stalled.length;
    const after = await waitChips(page);
    record(layout, 'When the queued refresh has run the page says so, the button is free although a background read stalls, and the line stays',
        finished === 'Ratings refreshed.' && busy === 'false' && stalledReads > 0 && after.length === 5,
        { finished, busy, stalledReads, chips: after.length });
    await page.unroute('**/JellyfinMod/Ratings/Items/**');
    await Promise.all(stalled.map(route => route.abort().catch(ignore)));
    // Focus on a chip is focus inside the line: a minute's refetch that widens an earlier chip is shown at once and focus stays
    // on the same chip (review round 4, P3 3).
    const tmdbChip = page.locator('#itemDetailPage:not(.hide) .jfmod-ratingChip[data-jfmod-rating="tmdb"]');
    await tmdbChip.focus();
    let widened = 0;
    await page.route('**/JellyfinMod/Ratings/Items/**', async route => {
        widened++;
        const response = await route.fetch();
        const body = await response.json();
        body.ratings = body.ratings.map(rating => rating.source === 'imdb' ? { ...rating, votes: 123456789 } : rating);
        return route.fulfill({ response, json: body });
    });
    await page.waitForTimeout(65000);
    await page.unroute('**/JellyfinMod/Ratings/Items/**');
    const imdbText = await page.locator('#itemDetailPage:not(.hide) .jfmod-ratingChip[data-jfmod-rating="imdb"]').innerText().catch(() => '');
    const stillOn = await page.evaluate(() => document.activeElement?.dataset?.jfmodRating ?? null);
    record(layout, 'With focus on a chip, a refetch that widens an earlier chip is shown at once and focus stays on that chip',
        widened > 0 && imdbText === 'IMDb 8.1 (123M)' && stillOn === 'tmdb', { widened, imdbText, stillOn });

    // File-less entry page: the line beside the TMDB star; TMDB is the entry's own.
    await go(page, `#/details?entryId=${STATE.fileless}`);
    found = await waitChips(page);
    record(layout, 'The file-less entry page shows the line beside the TMDB star, TMDB first-party', found.length === 5 && found.every(chip => chip.inMisc)
        && found.find(chip => chip.source === 'tmdb')?.provider === 'tmdb', found.map(chip => `${chip.text} [${chip.provider}]`));
    await shot(page, `${layout}-fileless`);

    // Sources and order: Letterboxd on, moved above Trakt; the page follows.
    await go(page, '#/catalog/preferences');
    await page.locator('[data-jfmod-source-toggle="letterboxd"]').click();
    await page.waitForTimeout(500);
    await page.locator('[data-jfmod-source="letterboxd"][data-jfmod-move="up"]').click();
    await page.waitForTimeout(500);
    const status = await page.locator('.jfmod-prefStatus').innerText();
    const focused = await page.evaluate(() => document.activeElement?.dataset?.jfmodMove ?? null);
    record(layout, 'Moving a source keeps focus on the control that moved it and says it was saved', focused === 'up' && /Saved/.test(status), { focused, status });
    await go(page, `#/details?id=${STATE.hostItem}`);
    found = await waitChips(page);
    record(layout, 'The detail line follows the user\'s own sources and order', JSON.stringify(found.map(chip => chip.source))
        === JSON.stringify([...DEFAULT_ORDER.slice(0, 4), 'letterboxd', 'trakt']), found.map(chip => chip.source));
    const prefs = await api(page, 'GET', `/DisplayPreferences/usersettings?userId=${await page.evaluate(() => ApiClient.getCurrentUserId())}&client=emby`);
    record(layout, 'The choice is saved in Jellyfin\'s per-user display preferences', (prefs.body?.CustomPrefs?.jfmodRatingsSources ?? '').includes('letterboxd'),
        prefs.body?.CustomPrefs?.jfmodRatingsSources);

    // Cards: off by default (no ratingSource), one source when chosen.
    const grid = `#/movies?topParentId=${STATE.libraryId}&collectionType=movies`;
    page.jfmodBrowse.length = 0;
    await go(page, grid);
    await page.waitForSelector('.card', { timeout: 20000 }).catch(ignore);
    await page.waitForTimeout(1500);
    let cardText = await page.$$eval('.jfmod-cardRating', nodes => nodes.map(node => node.textContent));
    record(layout, 'Cards are unchanged with the preference off: no card rating and no ratingSource sent', cardText.length === 0
        && page.jfmodBrowse.length > 0 && page.jfmodBrowse.every(body => !('ratingSource' in body)), { cardText, requests: page.jfmodBrowse.length });
    await go(page, '#/catalog/preferences');
    await page.locator('[data-jfmod-card-source="imdb"]').click();
    await page.waitForTimeout(800);
    page.jfmodBrowse.length = 0;
    await go(page, grid);
    await page.waitForSelector('.jfmod-cardRating', { timeout: 20000 }).catch(ignore);
    cardText = await page.$$eval('.jfmod-cardRating', nodes => nodes.map(node => ({ text: node.textContent, inSecondary: !!node.closest('.cardText-secondary'),
        badge: !!node.closest('.cardIndicators, .cardOverlayContainer') })));
    record(layout, 'With IMDb chosen each card carries it in its secondary text line, no badge', cardText.length >= 2
        && cardText.every(card => /IMDb 8\.1/.test(card.text) && card.inSecondary && !card.badge)
        && page.jfmodBrowse.some(body => body.ratingSource === 'imdb'), cardText);
    const stale = await page.$$eval('.jfmod-cardRating', nodes => nodes.map(node => ({ text: node.textContent.replace(/^\s*·\s*/, ''),
        stale: node.classList.contains('jfmod-cardRating-stale'), title: node.closest('.card')?.querySelector('.cardText-first')?.textContent ?? '' })));
    record(layout, 'A stale card value says how old it is, compactly; a current one does not', stale.some(card => card.stale
        && /^IMDb 8\.1 \([A-Z][a-z]{2} \d{4}\)$/.test(card.text) && /Second/.test(card.title))
        && stale.some(card => !card.stale && card.text === 'IMDb 8.1' && /Host/.test(card.title)), stale);
    const focusables = await page.$$eval('.card .jfmod-cardRating', nodes => nodes.filter(node => node.tabIndex >= 0 || node.querySelector('[tabindex]')).length);
    record(layout, 'The card rating adds no focus stop', focusables === 0);
    await shot(page, `${layout}-cards`);

    // Settings area: the Ratings section and Test.
    await go(page, '#/catalog/settings?section=ratings');
    await page.waitForSelector('section[data-section="ratings"]', { timeout: 20000 });
    await expectOwn(page);
    await page.locator('[data-test="ratings"]').click();
    await page.waitForFunction(() => /MDBList accepted the key/.test(document.querySelector('section[data-section="ratings"]')?.textContent ?? ''), undefined,
        { timeout: 20000 }).catch(ignore);
    const sectionText = await page.locator('section[data-section="ratings"]').innerText();
    record(layout, 'The settings area\'s Ratings section shows the key as configured, Test passes and the stand-in is flagged', /Configured/.test(sectionText)
        && /MDBList accepted the key/.test(sectionText) && /test address/.test(sectionText) && /calls/.test(sectionText), sectionText.slice(0, 400));
    await shot(page, `${layout}-settings`);
    // Saving the section reaches the title pages of this browser at once, not after the cache's minute (web review P2 1).
    await holdSettingsSaves(page);
    const saveEnabled = async on => {
        await go(page, '#/catalog/settings?section=ratings');
        await page.waitForSelector('section[data-section="ratings"]', { timeout: 20000 });
        const toggle = page.locator('section[data-section="ratings"]').getByLabel('Fetch and show title ratings');
        if (await toggle.isChecked() !== on) await toggle.click();
        await page.locator('[data-submit="ratings"]').click();
        await page.waitForFunction(() => /Saved/.test(document.querySelector('section[data-section="ratings"]')?.textContent ?? ''), undefined,
            { timeout: 20000 }).catch(ignore);
        if (page.jfmodNotOurs) throw new NotOurs(page.jfmodNotOurs);
        await go(page, `#/details?id=${STATE.hostItem}`);
        await page.waitForTimeout(1500);
        return chips(page);
    };
    const offNow = await saveEnabled(false);
    const onNow = await saveEnabled(true);
    record(layout, 'Turning ratings off and on in the settings area changes the title page in the same visit, without waiting', offNow.length === 0
        && onNow.length > 0, { off: offNow.length, on: onNow.length });

    await context.close();

    // An older plugin: Health without the ratings capabilities hides the line, the menu item and the card request field. A new
    // context, so nothing a newer plugin answered is in the persisted query cache (as on a device that never saw it).
    const older = await browser.newContext({ viewport: LAYOUTS.desktop.viewport, serviceWorkers: 'block' });
    await older.route('**/JellyfinMod/Health', async route => {
        const response = await route.fetch();
        const body = await response.json();
        body.Capabilities = body.Capabilities.filter(name => !name.startsWith('ratings') && name !== 'settings.ratings');
        await route.fulfill({ response, json: body });
    });
    const oldPage = await older.newPage();
    oldPage.jfmodErrors = [];
    oldPage.jfmodBrowse = [];
    oldPage.on('pageerror', error => oldPage.jfmodErrors.push(String(error.message).split('\n')[0]));
    oldPage.on('request', request => {
        if (request.url().includes('/JellyfinMod/Browse') && request.method() === 'POST') oldPage.jfmodBrowse.push(request.postDataJSON());
    });
    await signIn(oldPage);
    await go(oldPage, grid);
    await oldPage.waitForSelector('.card', { timeout: 20000 }).catch(ignore);
    await oldPage.waitForTimeout(1500);
    const oldCards = await oldPage.$$eval('.jfmod-cardRating', nodes => nodes.length);
    await go(oldPage, `#/details?id=${STATE.hostItem}`);
    await oldPage.waitForTimeout(2500);
    const oldChips = await chips(oldPage);
    await oldPage.locator('[aria-controls="app-user-menu"]').first().click();
    await oldPage.waitForTimeout(800);
    const oldMenu = await oldPage.locator('#app-user-menu').innerText().catch(() => '');
    await oldPage.keyboard.press('Escape');
    record(layout, 'A plugin without the ratings capabilities: no line, no menu item, no card rating and no ratingSource sent (card choice still on)',
        oldChips.length === 0 && !oldMenu.includes('Ratings display') && oldCards === 0 && oldPage.jfmodBrowse.length > 0
        && oldPage.jfmodBrowse.every(body => !('ratingSource' in body)), { chips: oldChips.length, cards: oldCards, requests: oldPage.jfmodBrowse.length });
    await older.close();

    // Ratings turned off by the administrator: the line is absent on the next visit, the page otherwise unchanged.
    const reopened = await open(browser, layout);
    const page2 = reopened.page;
    await saveRatings(page2, { enabled: false });
    await reopened.context.close();
    const off = await open(browser, layout);
    const page3 = off.page;
    await go(page3, `#/details?id=${STATE.hostItem}`);
    await page3.waitForTimeout(3000);
    const offChips = await chips(page3);
    const playVisible = await page3.locator('#itemDetailPage:not(.hide) .mainDetailButtons button:visible').count();
    record(layout, 'Ratings turned off: the line is absent and the page otherwise unchanged', offChips.length === 0 && playVisible > 0, { buttons: playVisible });
    await saveRatings(page3, { enabled: true });
    record(layout, 'No page errors', page3.jfmodErrors.length === 0, page3.jfmodErrors);
    await off.context.close();

    // Leave the user's preferences as they were: the default order and no card rating (a new visit, as ratings are on again).
    const last = await open(browser, layout);
    await preferencesPage(last.page, layout);
    await last.context.close();
}

async function mobile(browser) {
    const layout = 'mobile';
    const { context, page } = await open(browser, layout);
    await go(page, `#/details?id=${STATE.hostItem}`);
    const found = await waitChips(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    record(layout, 'The native page shows the Ratings line, wrapped, without horizontal scroll', found.length === 5 && overflow <= 0, { chips: found.length, overflow });
    // Each chip is a real touch target, and a tap shows where its value came from (web review 2026-10-07 round 2, P3 6).
    const chipsOnPage = page.locator('#itemDetailPage:not(.hide) .jfmod-ratingChip');
    const boxes = [];
    for (let index = 0; index < await chipsOnPage.count(); index++) boxes.push(await chipsOnPage.nth(index).boundingBox());
    const gaps = boxes.slice(1).map((box, index) => Math.abs(box.y - boxes[index].y) < 2 ? box.x - (boxes[index].x + boxes[index].width) : null)
        .filter(gap => gap !== null);
    await chipsOnPage.nth(1).tap();
    await page.waitForTimeout(400);
    const tapped = await page.locator('#itemDetailPage:not(.hide) [data-jfmod-rating-note]').innerText().catch(() => '');
    await chipsOnPage.nth(1).tap();
    await page.waitForTimeout(400);
    const closedAfterTap = await page.locator('#itemDetailPage:not(.hide) [data-jfmod-rating-note]').count();
    record(layout, 'Each chip is at least 44 px high with room beside it, and a tap shows its provenance and a second tap hides it',
        boxes.every(box => box.height >= 43) && gaps.every(gap => gap >= 6) && /^Rotten Tomatoes critics.*via MDBList/.test(tapped) && closedAfterTap === 0,
        { heights: boxes.map(box => Math.round(box.height)), gaps: gaps.map(Math.round), tapped, closedAfterTap });
    await shot(page, `${layout}-native`);
    await go(page, `#/details?entryId=${STATE.fileless}`);
    const fileless = await waitChips(page);
    record(layout, 'The file-less entry page shows the line', fileless.length === 5, fileless.map(chip => chip.text));
    await preferencesPage(page, layout);
    record(layout, 'No page errors', page.jfmodErrors.length === 0, page.jfmodErrors);
    await context.close();
}

/** The focused control and where it is (runs in the browser). */
const focusedBox = page => page.evaluate(() => {
    const node = document.activeElement;
    const rect = node?.getBoundingClientRect();
    return { tag: node?.tagName ?? null, text: node?.textContent?.trim().slice(0, 30) ?? null, top: Math.round(rect?.top ?? -1) };
});

/**
 * With focus on a control below the line, a minute's refetch that fails, and then one that brings wider (stale, dated) values,
 * must not move it: the line keeps its last answer through an error and never changes height under a focused control below
 * (web review 2026-10-07 round 2, P2 1). Each wait crosses the line's one-minute refetch.
 */
async function laterUpdates(page, layout) {
    // Two minutes of waiting: once, at the larger TV size.
    if (layout !== 'tv1080') return;
    const lineBottom = () => page.evaluate(() => {
        const line = [...document.querySelectorAll('.jfmod-ratingsLine')].find(node => node.offsetParent !== null);
        return line ? line.getBoundingClientRect().bottom : null;
    });
    let below = false;
    for (let press = 0; press < 15 && !below; press++) {
        const [bottom, box] = [await lineBottom(), await focusedBox(page)];
        below = bottom !== null && box.top > bottom;
        if (!below) {
            await page.keyboard.press('ArrowDown');
            await page.waitForTimeout(200);
        }
    }
    const before = await focusedBox(page);
    let reads = 0;
    await page.route('**/JellyfinMod/Ratings/Items/**', route => {
        reads++;
        return route.fulfill({ status: 500, body: 'forced failure' });
    });
    await page.waitForTimeout(65000);
    const afterError = await focusedBox(page);
    const chipsAfterError = (await chips(page)).length;
    await page.unroute('**/JellyfinMod/Ratings/Items/**');
    const errorReads = reads;
    reads = 0;
    await page.route('**/JellyfinMod/Ratings/Items/**', async route => {
        reads++;
        const response = await route.fetch();
        const body = await response.json();
        body.ratings = body.ratings.map(rating => ({ ...rating, stale: true, fetchedAt: '2025-01-15T00:00:00Z', votes: (rating.votes ?? 0) * 1000 + 1 }));
        return route.fulfill({ response, json: body });
    });
    await page.waitForTimeout(65000);
    const afterWider = await focusedBox(page);
    const chipsAfterWider = (await chips(page)).length;
    await page.unroute('**/JellyfinMod/Ratings/Items/**');
    record(layout, 'Focus below the line stays put through a failed refetch (the line keeps its values) and a refetch with wider values',
        below && errorReads > 0 && reads > 0 && chipsAfterError === 5 && chipsAfterWider === 5
        && JSON.stringify(before) === JSON.stringify(afterError) && JSON.stringify(before) === JSON.stringify(afterWider),
        { below, errorReads, widerReads: reads, before, afterError, afterWider, chipsAfterError, chipsAfterWider });
}

/** The file-less page's ratings line, the misc-info row it shares with the TMDB star, and the line's chips (runs in the browser). */
const sharedRow = page => page.evaluate(() => {
    const row = [...document.querySelectorAll('.itemMiscInfo-secondary')].find(node => node.offsetParent !== null);
    const line = row?.querySelector('.jfmod-ratingsLine');
    return { row: row ? Math.round(row.getBoundingClientRect().height) : null, line: line ? Math.round(line.getBoundingClientRect().height) : null,
        chips: line ? line.querySelectorAll('.jfmod-ratingChip').length : 0 };
});

/** Answers the ratings defaults with `count()` sources on (in the complete order), on a page or a whole context. */
const routeDefaults = async (target, count) => {
    let reads = 0;
    await target.route('**/JellyfinMod/Ratings/Defaults', async route => {
        reads++;
        const response = await route.fetch();
        const body = await response.json();
        return route.fulfill({ response, json: { ...body, defaultSources: body.availableSources.slice(0, count()) } });
    });
    return () => reads;
};

/**
 * Finds, from the page's own CSS, a row width and two source counts where the shorter line sits beside the TMDB star and the
 * longer one keeps the line's own height but no longer fits beside the star, so the shared row wraps (runs in the browser on a
 * page showing every source, at 1920×1080). Each candidate is laid out in a hidden copy of the row.
 */
const findWrap = page => page.evaluate(() => {
    const row = [...document.querySelectorAll('.itemMiscInfo-secondary')].find(node => node.offsetParent !== null);
    if (!row) return null;
    const shape = (count, width) => {
        const copy = row.cloneNode(true);
        Object.assign(copy.style, { position: 'absolute', visibility: 'hidden', width: width + 'px', left: '0', top: '0' });
        [...copy.querySelectorAll('[role="listitem"]')].forEach((item, index) => {
            if (index >= count) item.remove();
        });
        row.parentElement.appendChild(copy);
        const line = copy.querySelector('.jfmod-ratingsLine');
        const result = { row: Math.round(copy.getBoundingClientRect().height), line: Math.round(line.getBoundingClientRect().height) };
        copy.remove();
        return result;
    };
    const single = shape(1, 4000);
    // Row widths the 1920×1080 TV window or a narrower one gives, so the window under test is a real TV size.
    for (let width = Math.floor(row.getBoundingClientRect().width); width >= 500; width -= 10) {
        for (let shorter = 2; shorter <= 8; shorter++) {
            const beside = shape(shorter, width);
            if (beside.row !== single.row || beside.line !== single.line) continue;
            for (let longer = shorter + 1; longer <= 9; longer++) {
                const wrapped = shape(longer, width);
                if (wrapped.line === single.line && wrapped.row > single.row) return { width, shorter, longer, rowWidth: Math.round(row.getBoundingClientRect().width) };
            }
        }
    }
    return null;
});

/**
 * The file-less page's line shares the misc-info row with the TMDB star (review round 3, P2 3). A wider line can keep its own
 * height and still wrap that row, pushing everything below it down. The check finds a window width and two source counts that
 * do exactly that, confirms it in real visits, then — with focus on a control below the row — lets a minute's defaults refetch
 * turn the longer set on: focus must not move and the line waits; the next visit shows it. Once, at the TV layout.
 */
async function sharedRowWrap(browser, layout) {
    if (layout !== 'tv1080') return;
    // The page with every source on, at two window widths: the CSS layout, and how the row's width follows the window's.
    const probe = await open(browser, layout, target => routeDefaults(target, () => 9));
    await go(probe.page, `#/details?entryId=${STATE.fileless}`);
    await waitChips(probe.page);
    const found = await findWrap(probe.page);
    await probe.page.setViewportSize({ width: 1600, height: 1080 });
    await probe.page.waitForTimeout(500);
    const narrower = await probe.page.evaluate(() => Math.round([...document.querySelectorAll('.itemMiscInfo-secondary')]
        .find(node => node.offsetParent !== null).getBoundingClientRect().width));
    await probe.context.close();
    if (!found) {
        record(layout, 'The page has a row width where a longer line keeps its height but wraps the shared row', false);
        return;
    }
    const perPixel = (found.rowWidth - narrower) / 320;
    const windowWidth = Math.round(1920 - (found.rowWidth - found.width - 5) / perPixel);
    const visit = async count => {
        const { context, page } = await open(browser, layout, target => routeDefaults(target, () => count));
        await page.setViewportSize({ width: windowWidth, height: 1080 });
        await go(page, `#/details?entryId=${STATE.fileless}`);
        await waitChips(page);
        const shape = await sharedRow(page);
        await context.close();
        return shape;
    };
    const base = await visit(found.shorter);
    const wider = await visit(found.longer);
    const exact = base.chips === found.shorter && wider.chips === found.longer && wider.line === base.line && wider.row > base.row;
    record(layout, 'At this window width the longer line keeps its own height and wraps the shared row (the case under test)', exact,
        { found, windowWidth, base, wider });
    if (!exact) return;
    let count = found.shorter;
    const { context, page } = await open(browser, layout, target => routeDefaults(target, () => count));
    await page.setViewportSize({ width: windowWidth, height: 1080 });
    await go(page, `#/details?entryId=${STATE.fileless}`);
    await waitChips(page);
    let below = false;
    for (let press = 0; press < 15 && !below; press++) {
        const box = await focusedBox(page);
        const rowBottom = await page.evaluate(() => [...document.querySelectorAll('.itemMiscInfo-secondary')].find(node => node.offsetParent !== null)
            ?.getBoundingClientRect().bottom ?? null);
        below = rowBottom !== null && box.top > rowBottom;
        if (!below) {
            await page.keyboard.press('ArrowDown');
            await page.waitForTimeout(200);
        }
    }
    const before = await focusedBox(page);
    count = found.longer;
    await page.waitForTimeout(65000);
    const after = await focusedBox(page);
    const held = await sharedRow(page);
    await go(page, '#/home');
    await go(page, `#/details?entryId=${STATE.fileless}`);
    await waitChips(page);
    const next = await sharedRow(page);
    await context.close();
    record(layout, 'A wider line that keeps its own height but wraps the shared row above a focused control waits; the next visit shows it',
        below && JSON.stringify(before) === JSON.stringify(after) && held.chips === found.shorter && held.row === base.row
        && next.chips === found.longer && next.row === wider.row,
        { below, focus: [before.text, before.top, after.top], held, next });
}

async function tv(browser, layout) {
    const { context, page } = await open(browser, layout);
    // Home: the Ratings display link is reachable by Down alone.
    await go(page, '#/home');
    await page.waitForTimeout(2000);
    let reached = false;
    for (let press = 0; press < 80 && !reached; press++) {
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(150);
        reached = await page.evaluate(() => document.activeElement?.hasAttribute('data-jfmod-tv-ratings') ?? false);
    }
    record(layout, 'Down from Home reaches the Ratings display link', reached);
    if (reached) {
        await page.keyboard.press('Enter');
        await page.waitForTimeout(2500);
    } else {
        await go(page, '#/catalog/preferences');
    }
    await page.waitForSelector('[data-jfmod-source-toggle="imdb"]', { timeout: 20000 });
    await page.waitForTimeout(800);
    const first = await page.evaluate(() => document.activeElement?.dataset?.jfmodSourceToggle ?? null);
    record(layout, 'Ratings display opens with focus on its first switch', first === 'imdb', first);
    // Down to Letterboxd (the seventh row), Enter turns it on, Enter again off: switches toggle with Enter.
    let target = null;
    for (let press = 0; press < 12 && target !== 'letterboxd'; press++) {
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(200);
        target = await page.evaluate(() => document.activeElement?.dataset?.jfmodSourceToggle ?? null);
    }
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
    const on = await page.evaluate(() => document.querySelector('[data-jfmod-source-toggle="letterboxd"]').getAttribute('aria-checked'));
    const stillFocused = await page.evaluate(() => document.activeElement?.dataset?.jfmodSourceToggle ?? null);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
    const off = await page.evaluate(() => document.querySelector('[data-jfmod-source-toggle="letterboxd"]').getAttribute('aria-checked'));
    record(layout, 'Down reaches a source, Enter toggles it and focus stays on it', target === 'letterboxd' && on === 'true' && off === 'false'
        && stillFocused === 'letterboxd', { target, on, off, stillFocused });
    // The user's own choice now exists, so "Use the server's default" shows; Enter on it removes it, and focus moves to the
    // first source switch rather than staying on a control that is gone (web review P2 4).
    let onReset = false;
    for (let press = 0; press < 12 && !onReset; press++) {
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(200);
        onReset = await page.evaluate(() => document.activeElement?.hasAttribute('data-jfmod-ratings-reset') ?? false);
    }
    await page.keyboard.press('Enter');
    await page.waitForTimeout(800);
    const afterReset = await page.evaluate(() => ({ source: document.activeElement?.dataset?.jfmodSourceToggle ?? null,
        reset: !!document.querySelector('[data-jfmod-ratings-reset]'), body: document.activeElement === document.body }));
    record(layout, 'Enter on "Use the server\'s default" moves focus to the first source switch', onReset && afterReset.source === 'imdb'
        && !afterReset.reset, { onReset, ...afterReset });
    await shot(page, `${layout}-preferences`);
    await pressRemoteBack(page);
    const left = await page.evaluate(() => window.location.hash);
    record(layout, 'The remote\'s Back leaves Ratings display for the page that opened it', !left.includes('catalog/preferences'), left);

    // The title page: the line is visible and the remote never lands on it.
    await go(page, `#/details?id=${STATE.hostItem}`);
    const where = () => page.evaluate(() => {
        const node = document.activeElement;
        return { tag: node?.tagName ?? null, text: node?.textContent?.trim().slice(0, 30) ?? null, top: Math.round(node?.getBoundingClientRect().top ?? -1) };
    });
    const focusedFirst = await where();
    const found = await waitChips(page);
    await page.waitForTimeout(2500);
    const focusedLater = await where();
    record(layout, 'Nothing the ratings bring in moves the focused control (same control, same place, once the line is there)',
        focusedFirst.tag === 'BUTTON' && JSON.stringify(focusedFirst) === JSON.stringify(focusedLater), { focusedFirst, focusedLater });
    const start = focusedLater.tag;
    let landed = false;
    for (let press = 0; press < 25; press++) {
        await page.keyboard.press(press % 5 === 4 ? 'ArrowRight' : 'ArrowDown');
        await page.waitForTimeout(120);
        landed = landed || await page.evaluate(() => !!document.activeElement?.closest('.jfmod-ratingsLine'));
    }
    record(layout, 'The line shows on the TV title page and D-pad navigation never focuses it', found.length === 5 && !landed && start === 'BUTTON',
        { chips: found.length, start });
    await laterUpdates(page, layout);
    await shot(page, `${layout}-native`);
    await page.evaluate(() => localStorage.removeItem('layout'));
    record(layout, 'No page errors', page.jfmodErrors.length === 0, page.jfmodErrors);
    await context.close();
    await sharedRowWrap(browser, layout);
}

// oleksii's own ratings display choice, read before anything changes it and put back at the end over plain HTTP — not
// through the interface, so a failed page cannot stop it (web review 2026-10-07 round 2, P3 5). A read that fails stops the
// run before anything is changed: a guess would later delete keys that existed.
const PREF_KEYS = ['jfmodRatingsSources', 'jfmodRatingsCardSource'];
const CLIENT = 'MediaBrowser Client="jfmod-p9-ratings", Device="cli", DeviceId="jfmod-p9-ratings", Version="1"';
const server = async (method, path, body, token) => {
    const response = await fetch(new URL(path, origin).href, {
        method,
        headers: { Authorization: token ? `${CLIENT}, Token="${token}"` : CLIENT, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    return { status: response.status, body: text && (response.headers.get('content-type') ?? '').includes('json') ? JSON.parse(text) : null };
};
const signInOverHttp = async () => {
    // A server still starting answers 503 with a text page; it is waited for, up to two minutes.
    let signedInNow = await server('POST', '/Users/AuthenticateByName', { Username: 'oleksii', Pw: '' });
    for (let attempt = 0; attempt < 40 && signedInNow.status === 503; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        signedInNow = await server('POST', '/Users/AuthenticateByName', { Username: 'oleksii', Pw: '' });
    }
    if (signedInNow.status !== 200) throw new Error(`sign-in for the preference snapshot failed (${signedInNow.status})`);
    return { token: signedInNow.body.AccessToken, userId: signedInNow.body.User.Id };
};
const prefsSnapshot = async ({ token, userId }) => {
    const prefs = await server('GET', `/DisplayPreferences/usersettings?userId=${userId}&client=emby`, undefined, token);
    if (prefs.status !== 200 || typeof prefs.body?.CustomPrefs !== 'object' || prefs.body.CustomPrefs === null) {
        throw new Error(`display preferences could not be read (${prefs.status})`);
    }
    return { prefs: prefs.body, keys: Object.fromEntries(PREF_KEYS.filter(key => key in prefs.body.CustomPrefs).map(key => [key, prefs.body.CustomPrefs[key]])) };
};

const session = await signInOverHttp();
const prefsBefore = (await prefsSnapshot(session)).keys;
const browser = await chromium.launch(tier === 'chrome' ? { headless: true, channel: 'chrome' } : { headless: true });
const version = browser.version();
// JFMOD_P9_ONLY (a comma list of desktop, mobile, tv1080, tv720) runs only those layouts while iterating; acceptance runs all.
const only = (process.env.JFMOD_P9_ONLY ?? '').split(',').filter(Boolean);
const wanted = layout => !only.length || only.includes(layout);
let stopped = null;
try {
    if (wanted('desktop')) await desktop(browser);
    if (wanted('mobile')) await mobile(browser);
    if (wanted('tv1080')) await tv(browser, 'tv1080');
    if (wanted('tv720')) await tv(browser, 'tv720');
} catch (error) {
    if (!(error instanceof NotOurs)) throw error;
    stopped = error.message;
} finally {
    await browser.close().catch(ignore);
    const { prefs } = await prefsSnapshot(session);
    for (const key of PREF_KEYS) {
        if (key in prefsBefore) prefs.CustomPrefs[key] = prefsBefore[key];
        else delete prefs.CustomPrefs[key];
    }
    await server('POST', `/DisplayPreferences/usersettings?userId=${session.userId}&client=emby`, prefs, session.token);
    const after = (await prefsSnapshot(session)).keys;
    record('all', 'oleksii\'s ratings display preferences are exactly as they were before the run', JSON.stringify(after) === JSON.stringify(prefsBefore),
        { keysBefore: Object.keys(prefsBefore), keysAfter: Object.keys(after) });
    await server('POST', '/Sessions/Logout', undefined, session.token).catch(ignore);
}
if (stopped) {
    record('all', 'STOPPED: the ratings settings are not as this run left them (someone else saved; perhaps the user\'s own key). Nothing '
        + 'tested, refreshed or saved over it. Report this; do not continue the run', false, stopped);
}
record('all', `None of the ${responses.length} JellyfinMod responses the browser received carries the key`, responses.every(body => !body.includes(KEY)));
const failed = results.filter(result => result.verdict !== 'PASS');
console.log(`${tier} ${version}: ${results.length - failed.length} passed, ${failed.length} failed`);
const out = process.env.JFMOD_P9_BROWSER_OUT;
if (out) {
    const all = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : { runs: [] };
    all.runs.push({ browser: tier, version, at: new Date().toISOString(), results });
    writeFileSync(out, JSON.stringify(all, null, 1) + '\n');
}
process.exit(failed.length ? 1 : 0);
/* eslint-enable compat/compat, no-restricted-globals */
