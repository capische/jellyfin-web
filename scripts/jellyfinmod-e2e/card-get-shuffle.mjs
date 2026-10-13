/* eslint-disable compat/compat, no-restricted-globals, @stylistic/max-statements-per-line, no-empty-function, sonarjs/cognitive-complexity -- a Node acceptance runner, not shipped code */
/* global window, document, ApiClient, localStorage, location, getComputedStyle */
// Get a Release on cards and Shuffle only where it makes sense (P1.FU12, user-approved 2026-10-12; UX §5.7 and §1.1).
// Signed in as oleksii with an empty password (and, when given, an ordinary user with an empty password), in a real browser
// against a running mod instance, it checks:
//   - desktop: hovering a season card (series page, upstream's legacy cards), a movie and a series card (library grids,
//     upstream's React cards) and an episode card (Home, when one is there) shows the cloud icon in the hover overlay after
//     Favorite and before More, as wide as its neighbours and inside the card; its tooltip is Get a Release, or Get Another
//     Quality for a movie or episode on disk; clicking it opens the release picker in the card's scope without leaving the page;
//   - phone and TV (no hover overlay): no icon in any card; the card's item menu (its More button or a long press on the
//     phone, the Menu key on the TV) carries Get a Release, which opens the picker without leaving the page;
//   - an ordinary user sees no icon and no menu item;
//   - P1.FU19: a card with a file keeps upstream's Play in the centre of its overlay and the icon in the bottom row (a card with
//     nothing on disk, Get a Release in the centre instead, is checked by missing-seasons-episodes.mjs);
//   - Shuffle: a drama's series and season pages hide upstream's header Shuffle and offer Shuffle in the More menu; choosing it
//     clicks upstream's own Shuffle button (the click is caught before upstream's handler, so nothing plays); a comedy's series
//     page keeps the header Shuffle and has no extra item.
//
//   JELLYFINMOD_TEST_URL=http://<host>:<port>/   a mod instance (18096, 28096, 48096) or a local environment on 127.0.0.1
//   [JELLYFINMOD_CGS_DRAMA=<series name>]        default "The Wheel of Time" (genres with none of the any-order words)
//   [JELLYFINMOD_CGS_COMEDY=<series name>]       default the first series in the library whose genres include Comedy
//   [JELLYFINMOD_CGS_USER=<ordinary user name>]  also check as this ordinary user (empty password); absent: NOT VERIFIED
//   [JELLYFINMOD_LOCAL_DIST=<dist folder>]       serve this local build in place of the instance's (a look before a deploy,
//                                                never acceptance evidence)
//   [JELLYFINMOD_WEB_PATH=/web/]  [JELLYFINMOD_BROWSER=chromium|chrome]  [JELLYFINMOD_LAYOUTS=desktop,mobile,tv1080]
//   [JELLYFINMOD_SHOTS=<folder for screenshots>]
//
// Reads only, with one exception that is the page's own behaviour: opening the picker runs a release search. Nothing is
// grabbed, nothing is played, every picker and menu is closed.
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const origin = new URL(process.env.JELLYFINMOD_TEST_URL ?? (() => { throw new Error('JELLYFINMOD_TEST_URL is required'); })());
const loopback = ['127.0.0.1', 'localhost'].includes(origin.hostname);
// Never production on 8096: a remote address must be one of the mod instances; a local environment listens on loopback.
if (!loopback && !['18096', '28096', '48096'].includes(origin.port)) throw new Error('Runs on the mod instances or a local environment only');
const dramaName = process.env.JELLYFINMOD_CGS_DRAMA ?? 'The Wheel of Time';
const comedyName = process.env.JELLYFINMOD_CGS_COMEDY ?? null;
const ordinaryUser = process.env.JELLYFINMOD_CGS_USER ?? null;
const localDist = process.env.JELLYFINMOD_LOCAL_DIST ?? null;
const WEB_PATH = process.env.JELLYFINMOD_WEB_PATH ?? '/web/';
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
const layouts = (process.env.JELLYFINMOD_LAYOUTS ?? 'desktop,mobile,tv1080').split(',').filter(Boolean);
const LAYOUTS = {
    desktop: { viewport: { width: 1440, height: 900 } },
    mobile: {
        viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
    },
    tv1080: { viewport: { width: 1920, height: 1080 }, tv: true }
};
const ANY_ORDER = ['comedy', 'sitcom', 'animation', 'reality', 'talk', 'game', 'documentary', 'kids', 'news'];
const PAGE = '.page:not(.hide)';

const results = [];
const record = (label, check, pass, detail) => {
    let verdict = pass;
    if (typeof pass === 'boolean') verdict = pass ? 'PASS' : 'FAIL';
    results.push({ label, check, verdict, detail });
    console.log(`${verdict} [${label}] ${check}${detail === undefined ? '' : ' · ' + JSON.stringify(detail).slice(0, 500)}`);
};

/** A local build served in place of the instance's: its mod page (jellyfinmod.html) under the web path, its files under one asset root. */
async function serveLocal(page) {
    if (!localDist) return;
    const root = '/web-mod/jfmod-local/';
    const types = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.html': 'text/html', '.svg': 'image/svg+xml',
        '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain' };
    const index = (await readFile(join(localDist, 'jellyfinmod.html'), 'utf8'))
        .replace(/(src|href)="(?!https?:|\/|#|data:)([^"]+)"/g, `$1="${root}$2"`)
        .replace('<head>', `<head><script>window.__jfmodAssetRoot="${root}";</script>`);
    await page.route(url => url.pathname === WEB_PATH || url.pathname === WEB_PATH + 'index.html',
        route => route.fulfill({ status: 200, contentType: 'text/html', body: index }));
    await page.route(url => url.pathname.startsWith(root), async route => {
        const file = decodeURIComponent(new URL(route.request().url()).pathname.slice(root.length));
        try {
            route.fulfill({ status: 200, contentType: types[extname(file)] ?? 'application/octet-stream', body: await readFile(join(localDist, file)) });
        } catch { route.fulfill({ status: 404, body: '' }); }
    });
}

async function signIn(page, user) {
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
    await field.fill(user);
    await page.locator('#txtManualPassword').fill('');
    await page.locator('button:visible').filter({ hasText: 'Sign In' }).first().click();
    await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } }, undefined, { timeout: 30000 });
    await page.waitForFunction(() => location.hash.startsWith('#/home'), undefined, { timeout: 30000 });
}

const go = async (page, hash) => {
    await page.evaluate(target => { location.hash = target; }, hash);
    await page.waitForTimeout(800);
};

/** The library's facts this run needs, read through Jellyfin's own API as the signed-in user. */
const libraryFacts = page => page.evaluate(async ([drama, comedy]) => {
    const userId = ApiClient.getCurrentUserId();
    const series = (await ApiClient.getItems(userId, { IncludeItemTypes: 'Series', Recursive: true, Fields: 'Genres', Limit: 1000 })).Items;
    const views = (await ApiClient.getUserViews({}, userId)).Items;
    const byName = name => series.find(item => item.Name.toLowerCase() === name.toLowerCase());
    const pick = item => item && { id: item.Id, name: item.Name, genres: item.Genres ?? [] };
    return {
        drama: pick(byName(drama)),
        comedy: pick(comedy ? byName(comedy) : series.find(item => (item.Genres ?? []).some(genre => /comedy/i.test(genre)))),
        movies: views.find(view => view.CollectionType === 'movies')?.Id ?? null,
        shows: views.find(view => view.CollectionType === 'tvshows')?.Id ?? null
    };
}, [dramaName, comedyName]);

const seasonsOf = (page, seriesId) => page.evaluate(async id => (await ApiClient.getSeasons(id, { userId: ApiClient.getCurrentUserId() })).Items
    .map(item => ({ id: item.Id, number: item.IndexNumber })), seriesId);

/** The overlay's bottom-right group of a card, in DOM order, with each button's width, and whether it stays inside the card. */
const overlayFacts = (page, cardSelector) => page.evaluate(selector => {
    const card = document.querySelector(selector);
    const group = card?.querySelector('.cardOverlayContainer .cardOverlayButton-br');
    if (!group) return null;
    const box = (card.querySelector('.cardScalable') ?? card).getBoundingClientRect();
    const buttons = [...group.children].filter(node => getComputedStyle(node).display !== 'none').map(node => {
        let kind = node.getAttribute('data-action') === 'menu' ? 'more' : 'other';
        if (node.classList.contains('jfmod-cardGet')) kind = 'get';
        else if (node.matches('[is="emby-ratingbutton"]') || node.querySelector('[data-testid="FavoriteIcon"], .favorite')) kind = 'favorite';
        else if (node.matches('[is="emby-playstatebutton"]') || node.querySelector('[data-testid="CheckIcon"], .check')) kind = 'played';
        const rect = node.getBoundingClientRect();
        return { kind, width: Math.round(rect.width * 10) / 10, height: Math.round(rect.height * 10) / 10, top: Math.round(rect.top) };
    });
    const rect = group.getBoundingClientRect();
    const get = group.querySelector('.jfmod-cardGet');
    // Upstream's own buttons measured again with the icon taken out of the layout: the icon must not change them.
    let without = null;
    if (get) {
        get.style.display = 'none';
        without = [...group.children].filter(node => node !== get && getComputedStyle(node).display !== 'none')
            .map(node => Math.round(node.getBoundingClientRect().width * 10) / 10);
        get.style.display = '';
    }
    return {
        order: buttons.map(button => button.kind), buttons, without,
        inside: rect.left >= box.left - 1 && rect.right <= box.right + 1 && rect.bottom <= box.bottom + 1,
        title: get?.getAttribute('title') ?? null, aria: get?.getAttribute('aria-label') ?? null,
        icon: get?.querySelector('.material-icons')?.classList.contains('cloud_download') ?? false
    };
}, cardSelector);

const scopeOptions = page => page.evaluate(() => [...document.querySelectorAll('.jfmod-releaseDialog #jfmod-releaseEpisode option')]
    .map(option => ({ text: option.textContent, selected: option.selected })));

async function closeDialog(page, selector) {
    await page.keyboard.press('Escape');
    let closed = await page.waitForSelector(selector, { state: 'detached', timeout: 5000 }).then(() => true, () => false);
    if (!closed) {
        await page.goBack();
        closed = await page.waitForSelector(selector, { state: 'detached', timeout: 5000 }).then(() => true, () => false);
    }
    return closed;
}

/** Runs `open`, then checks the picker opened on this page with the expected heading and scope; closes it. */
async function checkPicker(page, label, what, open, { heading, scope }) {
    const before = await page.evaluate(() => location.hash);
    await open();
    const opened = await page.waitForSelector('.jfmod-releaseDialog', { timeout: 15000 }).then(() => true, () => false);
    await page.waitForTimeout(1500);
    const title = opened ? await page.locator('.jfmod-releaseDialog .formDialogHeaderTitle').innerText().catch(() => null) : null;
    const options = opened ? await scopeOptions(page) : [];
    const after = await page.evaluate(() => location.hash);
    const selected = options.find(option => option.selected)?.text ?? null;
    const scopeOk = scope ? scope(options, selected) : true;
    record(label, `${what}: opens the picker "${heading}" on the page${scope ? ', in the card\'s scope' : ''}`,
        opened && title === heading && after === before && scopeOk, { title, selected, options: options.map(option => option.text).slice(0, 6), before, after });
    if (opened) record(label, `${what}: the picker closes`, await closeDialog(page, '.jfmod-releaseDialog'));
}

/** Hovers a card and checks its overlay; returns whether the icon showed. */
async function checkOverlay(page, label, what, cardSelector, expectedTitle) {
    const card = page.locator(cardSelector).first();
    await card.scrollIntoViewIfNeeded().catch(() => {});
    await card.hover().catch(() => {});
    const shown = await page.waitForSelector(`${cardSelector} .jfmod-cardGet:not([hidden])`, { timeout: 10000 }).then(() => true, () => false);
    await page.waitForTimeout(400);
    const facts = await overlayFacts(page, cardSelector);
    if (!shown) {
        record(label, `${what}: hovering shows Get a Release in the overlay`, false, facts);
        return false;
    }
    const play = await page.evaluate(selector => {
        const button = document.querySelector(`${selector} .cardOverlayContainer > .cardOverlayFab-primary:not(.jfmod-cardGet)`);
        return !!button && getComputedStyle(button).display !== 'none' && button.getBoundingClientRect().width > 0;
    }, cardSelector);
    record(label, `${what}: upstream's Play kept in the centre (the card has a file), the icon not there (P1.FU19)`, play
        && !await page.locator(`${cardSelector} .cardOverlayContainer > .jfmod-cardGet`).count(), play);
    const iconIndex = facts.order.indexOf('get');
    const upstream = facts.buttons.filter(button => button.kind !== 'get').map(button => button.width);
    const icon = facts.buttons[iconIndex];
    const more = facts.buttons.find(button => button.kind === 'more');
    record(label, `${what}: the icon sits after Favorite and before More (cloud_download)`, facts.order[iconIndex - 1] === 'favorite'
        && facts.order[iconIndex + 1] === 'more' && facts.icon, facts.order);
    record(label, `${what}: its tooltip reads "${expectedTitle}"`, facts.title === expectedTitle && facts.aria === expectedTitle, facts.title);
    record(label, `${what}: Played, Favorite and More keep their widths; the icon is More's size, in the same row, inside the card`,
        JSON.stringify(upstream) === JSON.stringify(facts.without) && !!more && Math.abs(icon.width - more.width) <= 1.5
        && Math.abs(icon.height - more.height) <= 1.5 && new Set(facts.buttons.map(button => button.top)).size === 1 && facts.inside,
        { buttons: facts.buttons, withoutIcon: facts.without });
    return true;
}

/** Opens a card's item menu the way the layout does and returns the sheet's mod item, if any. */
async function openCardMenu(page, cardSelector, tv) {
    const card = page.locator(cardSelector).first();
    await card.scrollIntoViewIfNeeded().catch(() => {});
    const more = card.locator('[data-action="menu"]');
    if (!tv && await more.count()) {
        await more.first().click();
    } else {
        // The TV's Menu key and a long press on the phone both arrive as `contextmenu` on the card.
        if (tv) await card.focus();
        await card.dispatchEvent('contextmenu');
    }
    const opened = await page.waitForSelector('.actionSheet', { timeout: 10000 }).then(() => true, () => false);
    await page.waitForTimeout(300);
    const item = page.locator('.actionSheet .actionSheetMenuItem[data-id="jfmod-more-getRelease"]');
    return { opened, item, text: await item.count() ? (await item.first().innerText()).trim() : null };
}

/** Shuffle on a series or season page: hidden in the header and offered in More, or kept in the header. */
async function checkShuffle(page, label, what, itemId, inHeader) {
    await go(page, `#/details?id=${itemId}`);
    await page.waitForFunction(sel => !!document.querySelector(`${sel} .mainDetailButtons .btnMoreCommands:not(.hide)`), PAGE, { timeout: 30000 })
        .catch(() => {});
    await page.waitForTimeout(2000);
    const header = await page.evaluate(sel => {
        const button = document.querySelector(`${sel} .mainDetailButtons .btnShuffle`);
        return { present: !!button, upstreamShown: !!button && !button.classList.contains('hide'),
            visible: !!button && getComputedStyle(button).display !== 'none' && button.getBoundingClientRect().width > 0 };
    }, PAGE);
    record(label, `${what}: the header Shuffle is ${inHeader ? 'shown' : 'hidden'}`, header.upstreamShown && header.visible === inHeader, header);
    await page.locator(`${PAGE} .mainDetailButtons .btnMoreCommands:not(.hide)`).first().click();
    const opened = await page.waitForSelector('.actionSheet', { timeout: 10000 }).then(() => true, () => false);
    await page.waitForTimeout(300);
    const item = page.locator('.actionSheet .actionSheetMenuItem[data-id="jfmod-more-shuffle"]');
    const text = await item.count() ? (await item.first().innerText()).trim() : null;
    record(label, `${what}: More ${inHeader ? 'has no Shuffle item' : 'offers Shuffle'}`, opened && (inHeader ? text === null : text === 'Shuffle'), text);
    if (!opened) return;
    if (inHeader || text === null) { await closeDialog(page, '.actionSheet'); return; }
    // Catch the click on upstream's Shuffle before its own listener, so the check proves the item presses it and nothing plays.
    await page.evaluate(() => {
        window.jfmodShuffleClicks = 0;
        window.jfmodShuffleCatch = event => {
            if (!event.target.closest?.('.btnShuffle')) return;
            window.jfmodShuffleClicks++;
            event.stopPropagation();
            event.preventDefault();
        };
        document.addEventListener('click', window.jfmodShuffleCatch, true);
    });
    await item.first().click();
    await page.waitForTimeout(1500);
    const clicks = await page.evaluate(() => {
        document.removeEventListener('click', window.jfmodShuffleCatch, true);
        return window.jfmodShuffleClicks;
    });
    const playing = await page.evaluate(() => !!document.querySelector('.videoPlayerContainer, video, audio[src]'));
    record(label, `${what}: choosing Shuffle presses upstream's Shuffle button once (caught before it plays)`, clicks === 1 && !playing, { clicks, playing });
}

async function run(browser, layout, user, admin) {
    const label = `${layout}, ${admin ? 'administrator' : 'ordinary user'}`;
    const tv = !!LAYOUTS[layout].tv;
    const options = { ...LAYOUTS[layout] };
    delete options.tv;
    const context = await browser.newContext(options);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error.message).slice(0, 200)));
    const shot = name => page.screenshot({ path: `${process.env.JELLYFINMOD_SHOTS ?? '.'}/card-get-shuffle-${tier}-${layout}-${name}.png` }).catch(() => {});
    try {
        await serveLocal(page);
        await signIn(page, user);
        if (tv) {
            await page.evaluate(() => localStorage.setItem('layout', 'tv'));
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } }, undefined, { timeout: 30000 });
        }
        const facts = await libraryFacts(page);
        if (!facts.drama) throw new Error(`no series named ${dramaName}`);
        const anyOrder = genres => genres.some(genre => ANY_ORDER.some(word => genre.toLowerCase().includes(word)));
        if (anyOrder(facts.drama.genres)) throw new Error(`${facts.drama.name} has an any-order genre: ${facts.drama.genres.join(', ')}`);
        const dramaSeasons = (await seasonsOf(page, facts.drama.id)).filter(season => season.number > 0);

        // Shuffle (every layout and user: the header and the More menu are the same on each).
        await checkShuffle(page, label, `${facts.drama.name} (${facts.drama.genres.join(', ')}) series page`, facts.drama.id, false);
        if (dramaSeasons[0]) await checkShuffle(page, label, `${facts.drama.name} Season ${dramaSeasons[0].number} page`, dramaSeasons[0].id, false);
        if (facts.comedy) {
            await checkShuffle(page, label, `${facts.comedy.name} (${facts.comedy.genres.join(', ')}) series page`, facts.comedy.id, true);
        } else {
            record(label, 'a comedy keeps the header Shuffle', 'NOT VERIFIED', 'no series with a Comedy genre');
        }

        // Get a Release on cards: the drama's series page lists its seasons as upstream's cards.
        await go(page, `#/details?id=${facts.drama.id}`);
        await page.waitForSelector(`${PAGE} #listChildrenCollapsible .card[data-type="Season"]`, { timeout: 30000 });
        await page.waitForTimeout(1500);
        const season = dramaSeasons[0];
        const seasonCard = `${PAGE} #listChildrenCollapsible .card[data-id="${season.id}"]`;
        const seasonScope = (choices, selected) => selected === `Season ${season.number}`;
        if (layout === 'desktop') {
            if (!admin) {
                await page.locator(seasonCard).hover().catch(() => {});
                await page.waitForTimeout(2500);
                const icons = await page.locator(`${PAGE} .jfmod-cardGet:not([hidden])`).count();
                record(label, 'an ordinary user\'s card overlay has no Get a Release', icons === 0, icons);
            } else if (await checkOverlay(page, label, `Season ${season.number} card`, seasonCard, 'Get a Release')) {
                await shot('season-card');
                await checkPicker(page, label, `Season ${season.number} card's Get a Release`,
                    () => page.locator(`${seasonCard} .jfmod-cardGet`).click(), { heading: 'Get a Release', scope: seasonScope });
                // Keyboard: Tab onto the icon shows the cyan ring.
                await page.locator(`${seasonCard} .jfmod-cardGet`).focus();
                await page.keyboard.press('Shift+Tab');
                await page.keyboard.press('Tab');
                await page.waitForTimeout(400);
                const ring = await page.evaluate(sel => {
                    const active = document.activeElement;
                    return active?.matches(`${sel} .jfmod-cardGet`) ? getComputedStyle(active).boxShadow : null;
                }, seasonCard);
                record(label, 'keyboard focus on the icon draws the cyan ring', !!ring && ring.includes('rgb(0, 164, 220)'), ring);
                // The overlay's More opens the card's item menu, the same menu a phone's More and the TV's Menu key open.
                await page.locator(seasonCard).hover();
                const menu = await openCardMenu(page, seasonCard, false);
                record(label, `Season ${season.number} card's More menu offers Get a Release`, menu.opened && menu.text === 'Get a Release', menu.text);
                if (menu.opened) await closeDialog(page, '.actionSheet');
            }
        } else {
            const icons = await page.locator(`${PAGE} .jfmod-cardGet`).count();
            record(label, 'no hover-overlay icon on this layout', icons === 0, icons);
            // The TV opens any card's menu with the Menu key. On the phone a long press starts upstream's multi-select, so the
            // menu is the card's More button, which upstream draws on library grids but not on a series page's season cards.
            let menuCard = seasonCard;
            let what = `Season ${season.number} card`;
            let expected = 'Get a Release';
            let scope = seasonScope;
            if (!tv && !await page.locator(`${seasonCard} [data-action="menu"]`).count()) {
                record(label, `Season ${season.number} card on the phone: upstream draws no More (Play only); its season page has the header icon`, 'NOTE');
                if (facts.movies) {
                    await go(page, `#/movies?topParentId=${facts.movies}`);
                    await page.waitForSelector(`${PAGE} .card[data-type="Movie"][data-id] [data-action="menu"]`, { timeout: 30000 }).catch(() => {});
                    const id = await page.locator(`${PAGE} .card[data-type="Movie"][data-id]`).first().getAttribute('data-id').catch(() => null);
                    menuCard = id ? `${PAGE} .card[data-type="Movie"][data-id="${id}"]` : null;
                    what = 'Movie card in the library grid';
                    expected = 'Get Another Quality';
                    scope = null;
                } else {
                    menuCard = null;
                }
            }
            const reachable = menuCard && (tv ? await page.locator(menuCard).count() : await page.locator(`${menuCard} [data-action="menu"]`).count());
            if (reachable) {
                const menu = await openCardMenu(page, menuCard, tv);
                await shot('card-menu');
                record(label, `${what}'s menu ${admin ? 'offers ' + expected : 'has no Get a Release'}`,
                    menu.opened && (admin ? menu.text === expected : menu.text === null), menu.text);
                if (admin && menu.text) {
                    await checkPicker(page, label, `${what}'s menu item`, () => menu.item.first().click(), { heading: expected, scope });
                } else if (menu.opened) {
                    await closeDialog(page, '.actionSheet');
                }
            } else {
                record(label, 'a card\'s item menu on this layout', 'NOT VERIFIED', 'upstream draws no More on these cards (a long press is multi-select)');
            }
        }

        // Library grids: a movie and a series card (upstream's React cards). Desktop administrators only; the other layouts use
        // the same menu item checked above.
        if (layout === 'desktop' && admin) {
            for (const [view, type, path] of [[facts.movies, 'Movie', 'movies'], [facts.shows, 'Series', 'tv']]) {
                if (!view) { record(label, `a ${type} card in its library grid`, 'NOT VERIFIED', 'no such library'); continue; }
                await go(page, `#/${path}?topParentId=${view}`);
                const found = await page.waitForSelector(`${PAGE} .card[data-type="${type}"][data-id] .cardOverlayContainer`, { timeout: 30000 })
                    .then(() => true, () => false);
                if (!found) { record(label, `a ${type} card in its library grid`, 'NOT VERIFIED', 'no card with an overlay'); continue; }
                await page.waitForTimeout(1000);
                const id = await page.locator(`${PAGE} .card[data-type="${type}"][data-id]`).first().getAttribute('data-id');
                const card = `${PAGE} .card[data-type="${type}"][data-id="${id}"]`;
                const expected = type === 'Movie' ? 'Get Another Quality' : 'Get a Release';
                if (await checkOverlay(page, label, `${type} card`, card, expected)) {
                    await shot(type.toLowerCase() + '-card');
                    await checkPicker(page, label, `${type} card's ${expected}`, () => page.locator(`${card} .jfmod-cardGet`).click(),
                        { heading: expected, scope: type === 'Series' ? choices => choices.some(option => option.text === 'All Seasons')
                            && !choices.some(option => /S\d+E\d+/.test(option.text)) : null });
                }
            }
            // Home: an episode card (Next Up, Latest), when the library offers one.
            await go(page, '#/home');
            const episode = await page.waitForSelector(`${PAGE} .card[data-type="Episode"][data-id] .cardOverlayContainer`, { timeout: 20000 })
                .then(() => true, () => false);
            if (episode) {
                await page.waitForTimeout(1000);
                const id = await page.locator(`${PAGE} .card[data-type="Episode"][data-id]`).first().getAttribute('data-id');
                const card = `${PAGE} .card[data-type="Episode"][data-id="${id}"]`;
                if (await checkOverlay(page, label, 'Episode card on Home', card, 'Get Another Quality')) {
                    await checkPicker(page, label, 'Episode card\'s Get Another Quality', () => page.locator(`${card} .jfmod-cardGet`).click(),
                        { heading: 'Get Another Quality', scope: (choices, selected) => /S\d+E\d+/.test(selected ?? '') });
                }
            } else {
                record(label, 'an episode card on Home', 'NOT VERIFIED', 'Home shows no episode card');
            }
        }
        record(label, 'no page errors', errors.length === 0, errors);
    } catch (error) {
        record(label, 'run', false, String(error?.message ?? error).slice(0, 300));
        await shot('error');
    } finally {
        if (tv) await page.evaluate(() => localStorage.removeItem('layout')).catch(() => {});
        await context.close();
    }
}

// A served local index has no network address of its own, so Chromium's local-network checks would block its API calls.
const args = localDist ? ['--disable-features=PrivateNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,LocalNetworkAccessChecks'] : [];
const browser = await chromium.launch(tier === 'chrome' ? { headless: true, channel: 'chrome', args } : { headless: true, args });
try {
    for (const layout of layouts) {
        await run(browser, layout, 'oleksii', true);
        if (ordinaryUser) await run(browser, layout, ordinaryUser, false);
        else record(`${layout}, ordinary user`, 'ordinary user checks', 'NOT VERIFIED', 'JELLYFINMOD_CGS_USER not given');
    }
} finally {
    await browser.close();
}
const failed = results.filter(result => result.verdict === 'FAIL').length;
console.log(`\n${results.length - failed - results.filter(result => result.verdict === 'NOT VERIFIED').length} passed, ${failed} failed, `
    + `${results.filter(result => result.verdict === 'NOT VERIFIED').length} not verified (${tier}${localDist ? ', LOCAL BUILD, not acceptance' : ''})`);
process.exitCode = failed ? 1 : 0;
/* eslint-enable compat/compat, no-restricted-globals, @stylistic/max-statements-per-line, no-empty-function, sonarjs/cognitive-complexity */
