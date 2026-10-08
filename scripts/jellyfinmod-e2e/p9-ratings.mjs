/* eslint-disable compat/compat, no-restricted-globals -- a Node acceptance runner, not shipped code */
/* global window, document, ApiClient, localStorage */
// Phase 9 (R6, R7, R8) browser acceptance on the isolated instance, after `p9-live.py setup … fetch`: the ratings group in the
// first metadata row and its popup (user decisions 10 and 13) on a native and a file-less detail page, Ratings display (sources, order, the card source), the card text, the settings
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
import { savesChain } from './p9-saves.mjs';

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
// The plugin's default sources (user decision 9): IMDb, Rotten Tomatoes critics and audience, Trakt.
const DEFAULT_ORDER = ['imdb', 'tomatoes_critic', 'tomatoes_audience', 'trakt'];

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
// refresh button go only while the revision is still the run's own. This cannot be atomic (the plugin has no conditional Test
// or refresh, and work already started reads the settings again per title), so the run needs 18096 to itself throughout and
// no one may enter a real key meanwhile (see p9-live.py, EXCLUSIVE).
class NotOurs extends Error {}
const { lastRevision, noteRevision, holdSettingsSaves } = savesChain(STATE_FILE);
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
// The ratings group (user decisions 10 and 13): one control in the first metadata row holding IMDb, Rotten Tomatoes critics
// (tomato) and audience (popcorn), and Trakt when the row has room, each its mark and its value; every ticked rating is in its
// popup, one row each (mark, value, votes), the provenance in each row's title.
const GROUP = '[data-jfmod-ratings-group]:not(.jfmod-groupButton-standIn)';
const POPUP = '[data-jfmod-ratings-popup]';
const group = page => page.evaluate(selector => {
    const button = [...document.querySelectorAll(selector)].find(node => node.getClientRects().length);
    if (!button) return null;
    const box = button.closest('.jfmod-ratingsGroup');
    const row = box.closest('.itemMiscInfo');
    const visible = node => node.getClientRects().length > 0 && getComputedStyle(node).display !== 'none';
    const rect = box.getBoundingClientRect();
    const items = [...row.children].filter(visible).map(node => {
        const style = getComputedStyle(node);
        return node.getBoundingClientRect().width + parseFloat(style.marginLeft) + parseFloat(style.marginRight);
    });
    return {
        inline: [...button.querySelectorAll('[data-jfmod-rating]')].map(node => ({ source: node.dataset.jfmodRating,
            text: node.querySelector('.jfmod-groupValue')?.textContent ?? '', icon: node.querySelector('svg.jfmod-ratingIcon')?.getAttribute('data-jfmod-icon') ?? null })),
        tag: button.tagName, tabIndex: button.tabIndex, label: button.getAttribute('aria-label'), inRow: !!button.closest('.itemMiscInfo-primary'),
        inMisc: !!button.closest('.itemMiscInfo-secondary'), focused: document.activeElement === button,
        stockStar: [...row.querySelectorAll('.starRatingContainer')].some(visible), stockTomato: [...row.querySelectorAll('.mediaInfoCriticRating')].some(visible),
        width: rect.width, fullWidth: Number(box.getAttribute('data-jfmod-full-width')) || null, rowWidth: row.getBoundingClientRect().width,
        itemsWidth: items.reduce((sum, width) => sum + width, 0), height: button.getBoundingClientRect().height,
        // Every item of the row on the group's line.
        oneLine: [...row.children].filter(visible).every(node => {
            const other = node.getBoundingClientRect();
            return !other.width || (other.top < rect.bottom - 1 && other.bottom > rect.top + 1);
        })
    };
}, GROUP);
const sources = found => (found?.inline ?? []).map(item => item.source);
const waitGroup = async page => {
    await page.waitForFunction(selector => [...document.querySelectorAll(selector)].some(node => node.getClientRects().length), GROUP,
        { timeout: 20000 }).catch(ignore);
    return group(page);
};
/** Trakt is out of the row only when the row has no room for it (user decision 13); IMDb and Rotten Tomatoes never are. */
const traktRule = (found, onPhone) => {
    if (sources(found).includes('trakt')) return true;
    if (onPhone) return found.fullWidth > found.rowWidth;
    return found.itemsWidth + (found.fullWidth - found.width) > found.rowWidth;
};
const ROW = ['imdb', 'tomatoes_critic', 'tomatoes_audience'];
const rowOk = (found, onPhone) => !!found && sources(found).filter(source => source !== 'trakt').join(',') === ROW.join(',') && traktRule(found, onPhone);
/** The popup's rows (source, value, votes, title), its visible text without the hidden provenance, and its width. */
const popup = page => page.evaluate(selector => {
    const node = document.querySelector(selector);
    if (!node) return null;
    const copy = node.cloneNode(true);
    for (const hidden of copy.querySelectorAll('.jfmod-ratingsHidden')) hidden.remove();
    return { rows: [...node.querySelectorAll('[data-jfmod-rating]')].map(row => ({ source: row.dataset.jfmodRating,
        value: row.querySelector('.jfmod-popValue')?.textContent ?? '', votes: row.querySelector('.jfmod-popVotes')?.textContent ?? '',
        title: row.getAttribute('title') ?? '' })), text: copy.textContent, width: Math.round(node.getBoundingClientRect().width),
    links: node.querySelectorAll('a').length };
}, POPUP);
/** Rows only (no "via …" line, no caveat), the provenance in each row's title, the group's full width, no links. */
const popupOk = (shown, found, expected) => !!shown && JSON.stringify(shown.rows.map(row => row.source)) === JSON.stringify(expected)
    && !/via|as of|differ/i.test(shown.text) && shown.rows.every(row => /via (MDBList, as of|TMDB)|server/i.test(row.title)) && shown.links === 0
    && (!found?.fullWidth || Math.abs(shown.width - found.fullWidth) <= 1);
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

/** The native page's group and its popup on the desktop: placement, values, one focus stop, hover, keyboard focus, Escape. */
async function nativeGroup(page, layout) {
    // Native page: the group sits where the stock star and tomato were; each rating its mark and its value.
    await go(page, `#/details?id=${STATE.hostItem}`);
    const found = await waitGroup(page);
    const byId = Object.fromEntries((found?.inline ?? []).map(item => [item.source, item]));
    record(layout, 'The native page shows IMDb, RT critics and RT audience in the row in place of the stock star and tomato, and Trakt',
        rowOk(found, false) && sources(found).includes('trakt') && !found.stockStar && !found.stockTomato, found);
    record(layout, 'Each rating is its source\'s mark and its value in its own scale (RT critics a tomato, audience a popcorn), no votes in the row',
        byId.imdb?.text === '8.1' && byId.imdb?.icon === 'imdb' && byId.tomatoes_critic?.text === '91%' && byId.tomatoes_critic?.icon === 'tomatoesCritic'
        && byId.tomatoes_audience?.text === '88%' && /tomatoesAudience/.test(byId.tomatoes_audience?.icon ?? '') && byId.trakt?.text === '83%'
        && !(found?.inline ?? []).some(item => /votes/.test(item.text)), found?.inline);
    record(layout, 'The group is one button in the first row, in the tab order, and the row stays on one line', found?.tag === 'BUTTON'
        && found.tabIndex >= 0 && found.inRow && found.oneLine, found && { tag: found.tag, tabIndex: found.tabIndex, inRow: found.inRow, oneLine: found.oneLine });
    // The popup: on hover and on keyboard focus, one row per ticked rating with its votes; leaving or Escape closes it.
    await page.locator(GROUP).first().hover();
    await page.locator(POPUP).waitFor({ timeout: 3000 }).catch(ignore);
    const hovered = await popup(page);
    await shot(page, `${layout}-popup`);
    await page.mouse.move(2, 2);
    await page.waitForTimeout(400);
    const goneAfterHover = await page.locator(POPUP).count();
    await page.locator(GROUP).first().focus();
    await page.waitForTimeout(300);
    const focusedPopup = await popup(page);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const closed = await page.locator(POPUP).count();
    record(layout, 'Hover and keyboard focus open the popup: rows of mark, value and votes, as wide as the group with all its sources; leaving or Escape closes it',
        popupOk(hovered, found, DEFAULT_ORDER) && hovered.rows[0].votes === '250K votes' && /via MDBList, as of/i.test(hovered.rows[0].title)
        && goneAfterHover === 0 && popupOk(focusedPopup, found, DEFAULT_ORDER) && closed === 0, { hovered, goneAfterHover, closed });
    const order = await page.evaluate(() => {
        const row = [...document.querySelectorAll('.itemMiscInfo-primary')].find(node => node.offsetParent !== null);
        return row ? [...row.children].map(node => node.className) : [];
    });
    const mountAt = order.findIndex(name => name.includes('jfmod-ratingsMount'));
    const starAt = order.findIndex(name => name.includes('starRatingContainer'));
    record(layout, 'The ratings mount sits where the stock star was (just before it)', mountAt >= 0 && (starAt < 0 || mountAt === starAt - 1), order);
    return found;
}

async function desktop(browser) {
    const layout = 'desktop';
    const { context, page } = await open(browser, layout);
    // The user menu offers Ratings display.
    await page.locator('[aria-controls="app-user-menu"]').first().click();
    await page.waitForTimeout(800);
    const menu = await page.locator('#app-user-menu').innerText().catch(() => '');
    record(layout, 'The user menu offers Ratings display', menu.includes('Ratings Display'), menu.split('\n').filter(Boolean));
    await page.keyboard.press('Escape');
    await preferencesPage(page, layout);

    let found = await nativeGroup(page, layout);
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
    const after = await waitGroup(page);
    record(layout, 'When the queued refresh has run the page says so, the button is free although a background read stalls, and the group stays',
        finished === 'Ratings refreshed.' && busy === 'false' && stalledReads > 0 && sources(after).length === 4,
        { finished, busy, stalledReads, inline: sources(after) });
    await page.unroute('**/JellyfinMod/Ratings/Items/**');
    await Promise.all(stalled.map(route => route.abort().catch(ignore)));
    // With focus on the group, a minute's refetch that changes a value is shown at once (inside the reserved space) and focus
    // stays on the group (review round 4, P3 3).
    await page.locator(GROUP).first().focus();
    await page.keyboard.press('Escape');
    let widened = 0;
    await page.route('**/JellyfinMod/Ratings/Items/**', async route => {
        widened++;
        const response = await route.fetch();
        const body = await response.json();
        body.ratings = body.ratings.map(rating => rating.source === 'imdb' ? { ...rating, value: 10 } : rating);
        return route.fulfill({ response, json: body });
    });
    await page.waitForTimeout(65000);
    await page.unroute('**/JellyfinMod/Ratings/Items/**');
    const changed = await group(page);
    record(layout, 'With focus on the group, a refetch with a wider value is shown at once, the group keeps its width and its focus',
        widened > 0 && changed?.inline.find(item => item.source === 'imdb')?.text === '10.0' && changed.focused && Math.abs(changed.width - found.width) < 0.5,
        { widened, inline: changed?.inline, focused: changed?.focused, width: [found?.width, changed?.width] });

    // File-less entry page: the line beside the TMDB star; TMDB is the entry's own.
    await go(page, `#/details?entryId=${STATE.fileless}`);
    found = await waitGroup(page);
    const ownStar = await page.evaluate(() => [...document.querySelectorAll('.jfmod-entryStar')].some(node => node.offsetParent !== null));
    record(layout, 'The file-less entry page shows the group in its own star\'s row, IMDb in place of that star',
        rowOk(found, false) && found.inMisc && !ownStar, { inline: sources(found), ownStar });
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
    found = await waitGroup(page);
    await page.locator(GROUP).first().hover();
    await page.locator(POPUP).waitFor({ timeout: 3000 }).catch(ignore);
    const own = await popup(page);
    await page.mouse.move(2, 2);
    record(layout, 'The popup follows the user\'s own sources and order; the row keeps IMDb, RT critics and audience, Trakt',
        JSON.stringify(own?.rows.map(row => row.source)) === JSON.stringify([...DEFAULT_ORDER.slice(0, 3), 'letterboxd', 'trakt'])
        && sources(found).join(',') === DEFAULT_ORDER.join(','), { popup: own?.rows.map(row => row.source), inline: sources(found) });
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
        icon: node.querySelector('svg.jfmod-ratingIcon')?.getAttribute('data-jfmod-icon') ?? null, title: node.closest('[title]')?.getAttribute('title') ?? null,
        badge: !!node.closest('.cardIndicators, .cardOverlayContainer') })));
    record(layout, 'With IMDb chosen each card carries its mark and value in its secondary text line, no badge and no tooltip', cardText.length >= 2
        && cardText.every(card => /8\.1/.test(card.text) && card.icon === 'imdb' && card.inSecondary && !card.badge && !card.title)
        && page.jfmodBrowse.some(body => body.ratingSource === 'imdb'), cardText);
    const stale = await page.$$eval('.jfmod-cardRating', nodes => nodes.map(node => ({ text: node.textContent.replace(/^\s*·\s*/, ''),
        stale: node.classList.contains('jfmod-cardRating-stale'), title: node.closest('.card')?.querySelector('.cardText-first')?.textContent ?? '' })));
    record(layout, 'A stale card value says how old it is, compactly; a current one does not', stale.some(card => card.stale
        && /^8\.1 \([A-Z][a-z]{2} \d{4}\)$/.test(card.text) && /Second/.test(card.title))
        && stale.some(card => !card.stale && card.text === '8.1' && /Host/.test(card.title)), stale);
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
        return sources(await group(page));
    };
    const offNow = await saveEnabled(false);
    const onNow = await saveEnabled(true);
    record(layout, 'The settings area\'s Save sends the revision it loaded (the run\'s), unchanged, and the plugin answers with the next one',
        page.jfmodSaves.length === 2 && page.jfmodSaves.every(save => save.forwarded && save.status === 200 && save.answered === save.sent + 1),
        page.jfmodSaves);
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
    const oldChips = sources(await group(oldPage));
    await oldPage.locator('[aria-controls="app-user-menu"]').first().click();
    await oldPage.waitForTimeout(800);
    const oldMenu = await oldPage.locator('#app-user-menu').innerText().catch(() => '');
    await oldPage.keyboard.press('Escape');
    record(layout, 'A plugin without the ratings capabilities: no group, no menu item, no card rating and no ratingSource sent (card choice still on)',
        oldChips.length === 0 && !oldMenu.includes('Ratings Display') && oldCards === 0 && oldPage.jfmodBrowse.length > 0
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
    const offChips = sources(await group(page3));
    const playVisible = await page3.locator('#itemDetailPage:not(.hide) .mainDetailButtons button:visible').count();
    record(layout, 'Ratings turned off: the group is absent and the page otherwise unchanged', offChips.length === 0 && playVisible > 0, { buttons: playVisible });
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
    const found = await waitGroup(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    record(layout, 'The native page shows the group (Trakt only if the narrow row has room), without horizontal scroll', rowOk(found, true) && overflow <= 0,
        { inline: sources(found), overflow });
    // The group is a real touch target; a tap opens the popup, a tap elsewhere closes it.
    await page.locator(GROUP).first().tap();
    await page.locator(POPUP).waitFor({ timeout: 3000 }).catch(ignore);
    const tapped = await popup(page);
    await shot(page, `${layout}-popup`);
    await page.locator('.nameContainer:visible').tap();
    await page.waitForTimeout(400);
    const closedAfterTap = await page.locator(POPUP).count();
    record(layout, 'The group is at least 43 px high; a tap opens the popup (rows of mark, value, votes) and a tap elsewhere closes it',
        found?.height >= 43 && popupOk(tapped, found, DEFAULT_ORDER) && closedAfterTap === 0, { height: found?.height, tapped, closedAfterTap });
    await shot(page, `${layout}-native`);
    await go(page, `#/details?entryId=${STATE.fileless}`);
    const fileless = await waitGroup(page);
    record(layout, 'The file-less entry page shows the group', rowOk(fileless, true), sources(fileless));
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
 * With focus on a control below the group's row, a minute's refetch that fails, and then one that brings wider (stale, dated)
 * values, must not move it: the group keeps its last answer through an error and its reserved width through any change (web
 * review 2026-10-07 round 2, P2 1). Each wait crosses the one-minute refetch.
 */
async function laterUpdates(page, layout) {
    // Two minutes of waiting: once, at the larger TV size.
    if (layout !== 'tv1080') return;
    const lineBottom = () => page.evaluate(() => {
        const button = [...document.querySelectorAll('[data-jfmod-ratings-group]')].find(node => node.getClientRects().length);
        return button ? button.closest('.itemMiscInfo').getBoundingClientRect().bottom : null;
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
    const chipsAfterError = sources(await group(page)).length;
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
    const chipsAfterWider = sources(await group(page)).length;
    await page.unroute('**/JellyfinMod/Ratings/Items/**');
    record(layout, 'Focus below the group stays put through a failed refetch (the group keeps its values) and a refetch with wider values',
        below && errorReads > 0 && reads > 0 && chipsAfterError >= 3 && chipsAfterWider === chipsAfterError
        && JSON.stringify(before) === JSON.stringify(afterError) && JSON.stringify(before) === JSON.stringify(afterWider),
        { below, errorReads, widerReads: reads, before, afterError, afterWider, chipsAfterError, chipsAfterWider });
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

    // The title page: the group is in the row above the buttons; the first focus is Play, Up reaches the group (one focus stop),
    // OK opens the popup and the remote's Back closes only that; with no popup open Back leaves the page (user decisions 10, 13).
    await go(page, '#/home');
    await go(page, `#/details?id=${STATE.hostItem}`);
    const where = () => page.evaluate(() => {
        const node = document.activeElement;
        return { tag: node?.tagName ?? null, text: node?.textContent?.trim().slice(0, 30) ?? null, top: Math.round(node?.getBoundingClientRect().top ?? -1) };
    });
    const focusedFirst = await where();
    const found = await waitGroup(page);
    await page.waitForTimeout(2500);
    const focusedLater = await where();
    record(layout, 'Nothing the ratings bring in moves the focused control (same control, same place, once the group is there)',
        focusedFirst.tag === 'BUTTON' && JSON.stringify(focusedFirst) === JSON.stringify(focusedLater), { focusedFirst, focusedLater });
    const onPlay = await page.evaluate(() => !!document.activeElement?.classList.contains('btnPlay'));
    record(layout, 'The TV title page shows IMDb, RT critics and audience (Trakt if the row has room) on one line; its first focus is Play',
        onPlay && rowOk(found, false) && found.oneLine, { inline: sources(found), oneLine: found?.oneLine, onPlay, rowWidth: found?.rowWidth });
    const onGroup = () => page.evaluate(() => !!document.activeElement?.hasAttribute('data-jfmod-ratings-group'));
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(300);
    const up = await onGroup();
    const noPopupOnFocus = await page.locator(POPUP).count() === 0;
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    const shown = await popup(page);
    const hash = await page.evaluate(() => window.location.hash);
    await shot(page, `${layout}-popup`);
    await pressRemoteBack(page);
    const afterBack = { hash: await page.evaluate(() => window.location.hash), popup: await page.locator(POPUP).count(), on: await onGroup() };
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(300);
    const down = await page.evaluate(() => !!document.activeElement?.closest('.mainDetailButtons'));
    record(layout, 'Up from Play reaches the group, OK opens the popup (rows of mark, value, votes), Back closes only that, Down returns to the buttons',
        up && noPopupOnFocus && popupOk(shown, found, DEFAULT_ORDER) && afterBack.hash === hash && afterBack.popup === 0 && afterBack.on && down,
        { up, noPopupOnFocus, shown, afterBack, down });
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(300);
    const before = await onGroup();
    await pressRemoteBack(page);
    const leftPage = await page.evaluate(() => window.location.hash);
    record(layout, 'With the group focused and no popup open, the remote\'s Back leaves the page as usual', before && leftPage !== hash, { before, leftPage });
    await go(page, `#/details?id=${STATE.hostItem}`);
    await waitGroup(page);
    await page.waitForTimeout(1500);
    await laterUpdates(page, layout);
    await shot(page, `${layout}-native`);
    await page.evaluate(() => localStorage.removeItem('layout'));
    record(layout, 'No page errors', page.jfmodErrors.length === 0, page.jfmodErrors);
    await context.close();
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
