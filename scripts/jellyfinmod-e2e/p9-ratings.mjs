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
const STATE = JSON.parse(readFileSync(required('JFMOD_P9_STATE'), 'utf8'));
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
async function open(browser, layoutName) {
    const layout = LAYOUTS[layoutName];
    const context = await browser.newContext({ viewport: layout.viewport, isMobile: layout.isMobile, hasTouch: layout.hasTouch,
        userAgent: layout.userAgent, serviceWorkers: 'block' });
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
    // Administrator: Refresh ratings queues one fetch.
    const refresh = page.locator('[data-jfmod-ratings-refresh]:visible').first();
    await refresh.click();
    await page.waitForTimeout(1500);
    const message = await page.locator('.jfmod-nativeEntryDetails [role="status"]').first().innerText().catch(() => '');
    record(layout, 'Refresh ratings queues a refresh and says so', /queued/i.test(message), message);
    // It then waits for the server's refresh queue to empty and reads the title again (web review P2 3).
    await page.waitForFunction(() => /Ratings refreshed|no new values|still waiting/.test(document.querySelector('.jfmod-nativeEntryDetails [role="status"]')
        ?.textContent ?? ''), undefined, { timeout: 75000 }).catch(ignore);
    const finished = await page.locator('.jfmod-nativeEntryDetails [role="status"]').first().innerText().catch(() => '');
    const after = await waitChips(page);
    record(layout, 'When the queued refresh has run the page says the ratings were refreshed and still shows the line', finished === 'Ratings refreshed.'
        && after.length === 5, { finished, chips: after.length });

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
    await page.locator('[data-test="ratings"]').click();
    await page.waitForFunction(() => /MDBList accepted the key/.test(document.querySelector('section[data-section="ratings"]')?.textContent ?? ''), undefined,
        { timeout: 20000 }).catch(ignore);
    const sectionText = await page.locator('section[data-section="ratings"]').innerText();
    record(layout, 'The settings area\'s Ratings section shows the key as configured, Test passes and the stand-in is flagged', /Configured/.test(sectionText)
        && /MDBList accepted the key/.test(sectionText) && /test address/.test(sectionText) && /calls/.test(sectionText), sectionText.slice(0, 400));
    await shot(page, `${layout}-settings`);
    // Saving the section reaches the title pages of this browser at once, not after the cache's minute (web review P2 1).
    const saveEnabled = async on => {
        await go(page, '#/catalog/settings?section=ratings');
        await page.waitForSelector('section[data-section="ratings"]', { timeout: 20000 });
        const toggle = page.locator('section[data-section="ratings"]').getByLabel('Fetch and show title ratings');
        if (await toggle.isChecked() !== on) await toggle.click();
        await page.locator('[data-submit="ratings"]').click();
        await page.waitForFunction(() => /Saved/.test(document.querySelector('section[data-section="ratings"]')?.textContent ?? ''), undefined,
            { timeout: 20000 }).catch(ignore);
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
    const before = await api(page2, 'GET', '/JellyfinMod/Settings/Ratings');
    await api(page2, 'PATCH', '/JellyfinMod/Settings/Ratings', { revision: before.body.revision, enabled: false });
    await reopened.context.close();
    const off = await open(browser, layout);
    const page3 = off.page;
    await go(page3, `#/details?id=${STATE.hostItem}`);
    await page3.waitForTimeout(3000);
    const offChips = await chips(page3);
    const playVisible = await page3.locator('#itemDetailPage:not(.hide) .mainDetailButtons button:visible').count();
    record(layout, 'Ratings turned off: the line is absent and the page otherwise unchanged', offChips.length === 0 && playVisible > 0, { buttons: playVisible });
    const now = await api(page3, 'GET', '/JellyfinMod/Settings/Ratings');
    await api(page3, 'PATCH', '/JellyfinMod/Settings/Ratings', { revision: now.body.revision, enabled: true });
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
    await shot(page, `${layout}-native`);
    await go(page, `#/details?entryId=${STATE.fileless}`);
    const fileless = await waitChips(page);
    record(layout, 'The file-less entry page shows the line', fileless.length === 5, fileless.map(chip => chip.text));
    await preferencesPage(page, layout);
    record(layout, 'No page errors', page.jfmodErrors.length === 0, page.jfmodErrors);
    await context.close();
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
    await shot(page, `${layout}-native`);
    await page.evaluate(() => localStorage.removeItem('layout'));
    record(layout, 'No page errors', page.jfmodErrors.length === 0, page.jfmodErrors);
    await context.close();
}

const PREF_KEYS = ['jfmodRatingsSources', 'jfmodRatingsCardSource'];
const prefsPath = page => page.evaluate(() => `/DisplayPreferences/usersettings?userId=${ApiClient.getCurrentUserId()}&client=emby`);
/** oleksii's ratings display keys: each one's value, and only the keys that exist. */
const prefsSnapshot = async page => {
    const prefs = await api(page, 'GET', await prefsPath(page));
    const custom = prefs.body?.CustomPrefs ?? {};
    return Object.fromEntries(PREF_KEYS.filter(key => key in custom).map(key => [key, custom[key]]));
};

const browser = await chromium.launch(tier === 'chrome' ? { headless: true, channel: 'chrome' } : { headless: true });
const version = browser.version();
let prefsBefore = null;
try {
    const first = await open(browser, 'desktop');
    prefsBefore = await prefsSnapshot(first.page);
    await first.context.close();
    await desktop(browser);
    await mobile(browser);
    await tv(browser, 'tv1080');
    await tv(browser, 'tv720');
} finally {
    if (prefsBefore) {
        const last = await open(browser, 'desktop');
        const path = await prefsPath(last.page);
        const prefs = (await api(last.page, 'GET', path)).body;
        const custom = prefs.CustomPrefs ?? {};
        for (const key of PREF_KEYS) {
            if (key in prefsBefore) custom[key] = prefsBefore[key];
            else delete custom[key];
        }
        prefs.CustomPrefs = custom;
        await api(last.page, 'POST', path, prefs);
        const after = await prefsSnapshot(last.page);
        record('all', 'oleksii\'s ratings display preferences are exactly as they were before the run', JSON.stringify(after) === JSON.stringify(prefsBefore),
            { keysBefore: Object.keys(prefsBefore), keysAfter: Object.keys(after) });
        await last.context.close();
    }
    await browser.close();
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
