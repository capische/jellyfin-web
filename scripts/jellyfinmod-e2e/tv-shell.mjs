/* eslint-disable compat/compat, no-restricted-globals, @stylistic/max-statements-per-line, sonarjs/cognitive-complexity, sonarjs/slow-regex -- a Node acceptance runner, not shipped code: the browserslist targets TV clients rather than this script, and its page-side callbacks read the page's own location */
/* global window, document, ApiClient, localStorage, location, performance, requestAnimationFrame, getComputedStyle, MutationObserver, setTimeout */
// P7 TV-shell acceptance probe: real browser, real server, keyboard only on the TV layouts.
//
//   JELLYFINMOD_TEST_URL=http://<host>:<isolated-port>/ node tv-shell.mjs
//
// JELLYFINMOD_BROWSER=chromium|chrome      Playwright's bundled Chromium (default) or real Google Chrome
// JELLYFINMOD_BASE_PATH=/web/              where the interface is served
// JELLYFINMOD_TV_LAYOUTS=tv1080,tv720,desktop,mobile (and desktoplegacy)
// JELLYFINMOD_TV_SECTIONS=home,search,details,grids,perf
// JELLYFINMOD_TEST_USER=oleksii            signs in with an empty password; no credential is read or printed
// JELLYFINMOD_SEARCH_QUERY=peaky
//
// Nothing is created on the server. The release picker is opened and closed but never activated, so nothing is
// grabbed. Every layout override is removed from the browser profile at the end.
import { chromium } from 'playwright';

const testUrl = new URL(process.env.JELLYFINMOD_TEST_URL ?? (() => { throw new Error('JELLYFINMOD_TEST_URL is required'); })());
if (!['18096', '28096'].includes(testUrl.port)) throw new Error('The TV-shell probe runs on the isolated instances only');
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
const base = new URL(process.env.JELLYFINMOD_BASE_PATH ?? '/web/', testUrl).href;
const only = (process.env.JELLYFINMOD_TV_LAYOUTS ?? 'tv1080,tv720,desktop,mobile').split(',');
const sections = new Set((process.env.JELLYFINMOD_TV_SECTIONS ?? 'home,search,details,grids,perf').split(','));
const testUser = process.env.JELLYFINMOD_TEST_USER ?? 'oleksii';
const searchQuery = process.env.JELLYFINMOD_SEARCH_QUERY ?? 'peaky';

const LAYOUTS = {
    tv1080: { viewport: { width: 1920, height: 1080 }, tv: true, layout: 'tv' },
    tv720: { viewport: { width: 1280, height: 720 }, tv: true, layout: 'tv' },
    desktop: { viewport: { width: 1440, height: 900 }, tv: false },
    // Upstream's other legacy layout, chosen in Display settings: it reaches the same mod grid route as the TV.
    desktoplegacy: { viewport: { width: 1440, height: 900 }, tv: false, layout: 'desktop-legacy' },
    mobile: {
        viewport: { width: 390, height: 844 }, tv: false, isMobile: true, hasTouch: true,
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
    }
};

const results = [];
const record = (layout, check, ok, detail) => {
    results.push({ layout, check, ok, detail });
    let verdict = 'NOTE';
    if (ok === true) verdict = 'PASS';
    else if (ok === false) verdict = 'FAIL';
    console.log(`${verdict} [${layout}] ${check}${detail === undefined ? '' : ' :: ' + JSON.stringify(detail)}`);
};
const notVerified = e => 'NOT VERIFIED: ' + String(e?.message ?? e).split('\n')[0];

const launchOptions = { headless: true };
if (tier === 'chrome') launchOptions.channel = 'chrome';
const browser = await chromium.launch(launchOptions);
console.log('browser', tier, browser.version());

const describeFocus = page => page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return 'BODY';
    const cls = typeof el.className === 'string' ?
        el.className.split(/\s+/).filter(c => /jfmod|card|btn|emby-tab|headerButton|Hero|listItem|Mui(Button|MenuItem|Accordion|Checkbox|IconButton)/i.test(c)).slice(0, 4).join('.') :
        '';
    const text = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    const section = el.closest('.MuiModal-root, .MuiToolbar-root, .verticalSection, .jfmod-homeHero, .skinHeader, .detailPagePrimaryContainer, .detailPageContent, .jfmod-nativeActions, .itemsContainer, .dialog');
    let where = '';
    if (section) {
        const names = section.className.split(/\s+/);
        where = names.find(c => /Mui(Modal|Popover|Menu|Toolbar)-root|jfmod|skinHeader|detailPage|itemsContainer|dialog|section\d/.test(c)) || names[0];
    }
    return `${el.tagName.toLowerCase()}.${cls} "${text}" @${where}`;
});

const press = async (page, key, times = 1) => {
    for (let i = 0; i < times; i++) {
        await page.keyboard.press(key);
        await page.waitForTimeout(250);
    }
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
    await page.waitForTimeout(600);
};

const pressBack = (page, how) => (how === 'remote' ? pressRemoteBack(page) : press(page, 'Escape'));

const waitHash = (page, fragment, timeout = 20000) => page.waitForFunction(f => location.hash.includes(f), fragment, { timeout });
const currentRoute = page => page.evaluate(() => location.hash.split('?')[0]);
const openModalCount = page => page.evaluate(() => document.querySelectorAll('.MuiModal-root:not(.MuiModal-hidden):not([aria-hidden="true"])').length);

async function signIn(page) {
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.ApiClient, undefined, { timeout: 30000 });
    const signedIn = () => page.evaluate(() => {
        try { return !!ApiClient.getCurrentUserId(); } catch { return false; }
    });
    await page.waitForFunction(() => {
        try { return !!ApiClient.getCurrentUserId() || /login|selectuser|selectserver/.test(location.hash); } catch { return /login|selectuser|selectserver/.test(location.hash); }
    }, undefined, { timeout: 30000 });
    if (await signedIn()) return;
    const field = page.locator('#txtManualName');
    if (!await field.isVisible().catch(() => false)) {
        const chooser = page.locator('.btnManual').first();
        if (await chooser.count()) await chooser.evaluate(node => node.click());
        await field.waitFor({ state: 'visible', timeout: 15000 });
    }
    await field.fill(testUser);
    await page.waitForTimeout(1500);
    await field.fill(testUser);
    await page.locator('button:visible').filter({ hasText: 'Sign In' }).first().click();
    await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } }, undefined, { timeout: 30000 });
}

const libraries = page => page.evaluate(async () => {
    // Straight after a reload the client can still be restoring its session; retry rather than fail the run on it.
    for (let attempt = 0; ; attempt++) {
        try {
            const views = await ApiClient.getUserViews({}, ApiClient.getCurrentUserId());
            return views.Items.filter(v => ['movies', 'tvshows'].includes(v.CollectionType)).map(v => ({ id: v.Id, type: v.CollectionType, name: v.Name }));
        } catch (e) {
            if (attempt >= 5) throw new Error('user views unavailable: ' + (e?.status ?? e));
            await new Promise(resolve => setTimeout(resolve, 1500));
        }
    }
});

/** Which grid is on screen: the modern React grid (MUI toolbar, in the page or the app bar) or the legacy controller. */
const gridKind = page => page.evaluate(() => (document.querySelector('.MuiToolbar-root button[title="Filter"]') ? 'modern' : 'legacy'));

const gridStats = page => page.evaluate(() => {
    const scope = [...document.querySelectorAll('.page:not(.hide)')].find(el => el.querySelector('.itemsContainer')) || document;
    const container = scope.querySelector('.itemsContainer');
    // The modern layout's toolbar lives in its app bar; the legacy layouts' is inside the page.
    const toolbar = [...document.querySelectorAll('.MuiToolbar-root')].find(t => t.querySelector('button[title="Filter"]'));
    return {
        cards: container?.querySelectorAll('.card').length ?? 0,
        modCards: container?.querySelectorAll('.jfmod-entryCard, [data-jfmod-tmdb]').length ?? 0,
        marks: container?.querySelectorAll('.jfmod-mark').length ?? 0,
        filterButton: !!(scope.querySelector('.btnFilter') || toolbar?.querySelector('button[title="Filter"]')),
        paging: ((toolbar?.querySelector('.MuiChip-label') || scope.querySelector('.paging'))?.textContent || '').trim().replace(/\s+/g, ' ')
    };
});

const errorsFor = page => {
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message).slice(0, 200)));
    return errors;
};

// ---------------------------------------------------------------- Home and search (unchanged from the TV shell slice)

async function checkHome(page, name, cfg) {
    try {
        await page.waitForSelector('.jfmod-homeHeroMount', { timeout: 20000 });
        await page.waitForSelector('#homeTab .sections .verticalSection', { timeout: 20000 });
        const home = await page.evaluate(() => ({
            hero: !!document.querySelector('.jfmod-homeHero'),
            sections: [...document.querySelectorAll('#homeTab .sections .verticalSection .sectionTitle')].map(e => e.textContent.trim()).slice(0, 8),
            topbar: document.querySelector('.skinHeader')?.className.includes('jfmod-topbar') ?? false
        }));
        record(name, 'mod Home rendered (hero + sections)', home.hero && home.sections.length > 0, home);
        if (cfg.tv) record(name, 'TV header wears Home topbar', home.topbar, { topbar: home.topbar });
    } catch (e) { record(name, 'mod Home rendered', false, notVerified(e)); }
    if (!cfg.tv) return;
    try {
        await freshHome(page);
        const trail = [await describeFocus(page)];
        record(name, 'Home first focus is the hero Play', /Play/.test(trail[0]) && /jfmod-homeHero/.test(trail[0]), trail[0]);
        for (let i = 0; i < 3; i++) { await press(page, 'ArrowDown'); trail.push(await describeFocus(page)); }
        record(name, 'Home d-pad trail (first focus, 3x Down)', !trail.includes('BODY'), trail);
        await press(page, 'ArrowUp');
        await press(page, 'ArrowUp');
        const before = await describeFocus(page);
        const onCard = await page.evaluate(() => !!document.activeElement?.closest('.card, .jfmod-entryCard'));
        if (!onCard) { record(name, 'merged-row card reachable', false, before); return; }
        await press(page, 'Enter');
        await waitHash(page, 'details', 15000);
        await page.waitForSelector('.page:not(.hide) .detailPagePrimaryContainer', { timeout: 15000 });
        await page.waitForTimeout(1500);
        await press(page, 'Escape');
        await waitHash(page, 'home', 15000);
        await page.waitForTimeout(1500);
        const after = await describeFocus(page);
        record(name, 'Enter on a Home card opens details; Back returns with focus restored', after === before, { before, after });
    } catch (e) { record(name, 'Home d-pad', false, notVerified(e)); }
}

async function freshHome(page) {
    await page.evaluate(() => { location.hash = '#/home'; });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#homeTab .sections .verticalSection', { timeout: 20000 });
    await page.waitForTimeout(4000);
}

async function checkSearch(page, name, cfg) {
    try {
        if (cfg.tv) {
            await freshHome(page);
            for (let i = 0; i < 4; i++) {
                await press(page, 'ArrowUp');
                if (/skinHeader/.test(await describeFocus(page))) break;
            }
            await press(page, 'ArrowLeft', 8);
            let found = false;
            for (let i = 0; i < 14 && !found; i++) {
                found = /headerSearchButton|"Search"/.test(await describeFocus(page));
                if (!found) await press(page, 'ArrowRight');
            }
            if (!found) { record(name, 'Search button reachable in header', false, await describeFocus(page)); return; }
            await press(page, 'Enter');
            await waitHash(page, 'search', 10000);
            await page.waitForSelector('#searchTextInput', { timeout: 10000 });
            await page.waitForTimeout(1000);
            if (!await page.evaluate(() => document.activeElement?.id === 'searchTextInput')) await page.focus('#searchTextInput');
            await page.keyboard.type(searchQuery, { delay: 60 });
        } else {
            await page.goto(base + '#/search', { waitUntil: 'domcontentloaded' });
            await page.waitForSelector('#searchTextInput', { timeout: 15000 });
            await page.fill('#searchTextInput', searchQuery);
        }
        await page.waitForSelector('.page:not(.hide) .jfmod-discovery', { timeout: 20000 });
        await page.waitForTimeout(3000);
        const s = await page.evaluate(() => {
            const pg = document.querySelector('.page:not(.hide)') || document;
            return {
                zones: [...pg.querySelectorAll('.verticalSection .sectionTitle, .jfmod-discoveryHeading')].map(e => e.textContent.trim()).slice(0, 8),
                marks: pg.querySelectorAll('.jfmod-mark').length,
                focusInField: document.activeElement?.id === 'searchTextInput'
            };
        });
        record(name, 'Search: upstream zone + Add from TMDB' + (cfg.tv ? '; focus stays in field' : ''), s.zones.length >= 2 && (!cfg.tv || s.focusInField), s);
        if (!cfg.tv) return;
        const trail = [];
        for (let i = 0; i < 8; i++) {
            await press(page, 'ArrowDown');
            trail.push(await describeFocus(page));
            if (/jfmod-discovery/.test(trail.at(-1))) break;
        }
        record(name, 'Search: results and Add from TMDB reachable by ArrowDown', trail.some(f => /jfmod-discovery/.test(f)), trail);
        await press(page, 'Escape');
        await page.waitForTimeout(1500);
        record(name, 'Back from search', !(await currentRoute(page)).includes('search'), await currentRoute(page));
    } catch (e) { record(name, 'Search', false, notVerified(e)); }
}

// ---------------------------------------------------------------- Details and the release picker

async function walkRowTo(page, rowSelector, label) {
    // Move along the row one key at a time, choosing the direction from the DOM order, and stop on the label.
    for (let step = 0; step < 12; step++) {
        const where = await page.evaluate(({ sel, text }) => {
            const buttons = [...document.querySelectorAll(sel + ' button')].filter(b => b.offsetParent);
            const current = buttons.indexOf(document.activeElement);
            const target = buttons.findIndex(b => b.textContent.includes(text));
            return { current, target };
        }, { sel: rowSelector, text: label });
        if (where.target < 0) return false;
        if (where.current === where.target) return true;
        if (where.current < 0) return false;
        await press(page, where.current < where.target ? 'ArrowRight' : 'ArrowLeft');
    }
    return false;
}

async function checkDetails(page, name, cfg, movieLib) {
    const movieId = await page.evaluate(async parentId => {
        const r = await ApiClient.getItems(ApiClient.getCurrentUserId(), { ParentId: parentId, IncludeItemTypes: 'Movie', Recursive: true, Limit: 1, SortBy: 'SortName' });
        return r.Items[0]?.Id;
    }, movieLib.id);
    try {
        await page.goto(base + '#/details?id=' + movieId, { waitUntil: 'domcontentloaded' });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.jfmod-nativeActions button', { timeout: 25000 });
        const d = await page.evaluate(() => ({
            name: document.querySelector('.itemName, h1, h3.itemName')?.textContent?.trim().slice(0, 40),
            modActions: [...document.querySelectorAll('.jfmod-nativeActions button')].map(b => b.textContent.trim()),
            upstreamPlay: !!document.querySelector('.btnPlay:not(.hide), .detailButton.btnPlay')
        }));
        record(name, 'Details: upstream actions + mod section', d.modActions.length > 0 && d.upstreamPlay, d);
        if (!cfg.tv) return;
        await page.waitForTimeout(1500);
        const trail = [await describeFocus(page)];
        let reached = false;
        for (let i = 0; i < 10 && !reached; i++) {
            await press(page, 'ArrowDown');
            trail.push(await describeFocus(page));
            reached = await page.evaluate(() => !!document.activeElement?.closest('.jfmod-nativeActions'));
        }
        record(name, 'Details: mod actions reachable by ArrowDown', reached, trail);
        if (!reached || !d.modActions.some(a => /Search releases/.test(a))) return;
        for (const how of ['escape', 'remote']) {
            const onButton = await walkRowTo(page, '.jfmod-nativeActions', 'Search releases');
            record(name, `Details: Search releases reached along the action row by arrows (${how})`, onButton, await describeFocus(page));
            if (!onButton) return;
            await press(page, 'Enter');
            await page.waitForSelector('.dialogContainer .dialog.opened.jfmod-releaseDialog', { timeout: 10000 });
            // The search runs against the configured indexers; the picker moves focus to its top row when it lands.
            await page.waitForFunction(() => !/Searching/.test(document.querySelector('.jfmod-releaseStatus')?.textContent ?? 'Searching'), undefined, { timeout: 45000 });
            await page.waitForTimeout(800);
            const landed = await describeFocus(page);
            const inDialog = await page.evaluate(() => !!document.activeElement?.closest('.jfmod-releaseDialog'));
            const moves = [landed];
            for (const key of ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown']) { await press(page, key); moves.push(await describeFocus(page)); }
            const stillInside = await page.evaluate(() => !!document.activeElement?.closest('.jfmod-releaseDialog'));
            const rows = await page.evaluate(() => document.querySelectorAll('.jfmod-releaseDialog .jfmod-releaseRow').length);
            record(name, `Release picker opens by Enter, focus lands inside, arrows stay inside (${how})`, inDialog && stillInside, { rows, moves });
            if (how === 'escape') {
                // The profile select opens upstream's action sheet by Enter; Back closes the sheet, not the picker.
                for (let i = 0; i < 4 && !await page.evaluate(() => document.activeElement?.id === 'jfmod-releaseProfile'); i++) await press(page, 'ArrowUp');
                if (await page.evaluate(() => document.activeElement?.id === 'jfmod-releaseProfile')) {
                    await press(page, 'Enter');
                    await page.waitForTimeout(800);
                    const sheet = await page.evaluate(() => ({ sheets: document.querySelectorAll('.dialogContainer .dialog.opened.actionSheet').length, focus: document.activeElement?.textContent?.trim().slice(0, 30) }));
                    await press(page, 'Escape');
                    await page.waitForTimeout(900);
                    const afterSheet = await page.evaluate(() => ({ sheets: document.querySelectorAll('.dialogContainer .dialog.opened.actionSheet').length, picker: !!document.querySelector('.dialogContainer .dialog.opened.jfmod-releaseDialog'), focusId: document.activeElement?.id }));
                    record(name, 'Release picker: profile select opens its action sheet by Enter; Back closes only the sheet', sheet.sheets === 1 && afterSheet.sheets === 0 && afterSheet.picker, { sheet, afterSheet });
                } else {
                    record(name, 'Release picker: profile select reachable by ArrowUp', undefined, await describeFocus(page));
                }
            }
            await pressBack(page, how);
            await page.waitForTimeout(1200);
            const after = await page.evaluate(() => ({
                open: !!document.querySelector('.dialogContainer .dialog.opened'),
                route: location.hash.split('?')[0],
                focus: document.activeElement?.textContent?.trim().slice(0, 30)
            }));
            record(name, `Back closes the release picker, stays on details, focus on the opener (${how})`,
                !after.open && after.route.includes('details') && /Search releases/.test(after.focus ?? ''), after);
        }
    } catch (e) { record(name, 'Details', false, notVerified(e)); }
}

// ---------------------------------------------------------------- Grids

const gridRoute = lib => (lib.type === 'movies' ? 'movies' : 'tv');
const gridUrl = lib => `${base}#/${gridRoute(lib)}?topParentId=${lib.id}&collectionType=${lib.type}`;

async function openGrid(page, lib) {
    await page.goto(gridUrl(lib), { waitUntil: 'domcontentloaded' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.page:not(.hide) .itemsContainer .jfmod-entryCard, .page:not(.hide) .itemsContainer [data-jfmod-tmdb]', { timeout: 30000 });
    await page.waitForTimeout(2500);
}

/** Up from the grid into the toolbar, then along it to the control whose title matches. */
async function focusToolbarControl(page, title) {
    const trail = [await describeFocus(page)];
    for (let i = 0; i < 6; i++) {
        if (await page.evaluate(() => !!document.activeElement?.closest('.MuiToolbar-root'))) break;
        await press(page, 'ArrowUp');
        trail.push(await describeFocus(page));
    }
    for (let step = 0; step < 16; step++) {
        const where = await page.evaluate(t => {
            const controls = [...document.querySelectorAll('.page:not(.hide) .MuiToolbar-root button')].filter(b => b.offsetParent && !b.disabled);
            return { current: controls.indexOf(document.activeElement), target: controls.findIndex(b => (b.getAttribute('title') || b.textContent).trim() === t) };
        }, title);
        if (where.target < 0 || where.current < 0) return { ok: false, trail };
        if (where.current === where.target) return { ok: true, trail };
        await press(page, where.current < where.target ? 'ArrowRight' : 'ArrowLeft');
        trail.push(await describeFocus(page));
    }
    return { ok: false, trail };
}

async function checkPopoverBack(page, name, route, title, how, exercise) {
    const reach = await focusToolbarControl(page, title);
    if (!reach.ok) { record(name, `${route} grid: ${title} reachable by d-pad`, false, reach.trail); return; }
    await press(page, 'Enter');
    await page.waitForTimeout(700);
    const opened = await page.evaluate(() => {
        const modals = [...document.querySelectorAll('.MuiModal-root:not(.MuiModal-hidden):not([aria-hidden="true"])')];
        const top = modals.at(-1);
        return { open: modals.length, focusInside: !!top && top.contains(document.activeElement) };
    });
    const detail = exercise ? await exercise() : undefined;
    record(name, `${route} grid: ${title} opens by Enter with focus inside`, opened.open > 0 && opened.focusInside, { ...opened, focus: await describeFocus(page), detail });
    await pressBack(page, how);
    await page.waitForTimeout(800);
    const after = { open: await openModalCount(page), route: await currentRoute(page), focus: await describeFocus(page) };
    record(name, `${route} grid: Back (${how}) closes ${title}, stays on ${route}, focus back on the opener`,
        after.open === 0 && after.route === '#/' + route && after.focus.includes(`"${title}"`), after);
}

const visibleCards = page => page.evaluate(() => document.querySelectorAll('.page:not(.hide) .itemsContainer .card').length);

async function exerciseFilter(page) {
    // Down to the File group, open it, and filter the grid by remote: Enter on "Not downloaded", then Enter again.
    const trail = [];
    let onFile = false;
    for (let i = 0; i < 8 && !onFile; i++) {
        onFile = await page.evaluate(() => /^File$/.test(document.activeElement?.textContent?.trim() ?? ''));
        if (!onFile) { await press(page, 'ArrowDown'); trail.push(await describeFocus(page)); }
    }
    if (!onFile) return { fileGroup: false, trail };
    await press(page, 'Enter');
    await page.waitForTimeout(600);
    const options = await page.evaluate(() => [...document.querySelectorAll('.MuiPopover-root [aria-labelledby="jfmodFileFilters-header"] input, .MuiPopover-root #jfmodFileFilters-content input')].map(i => i.closest('label')?.textContent?.trim()));
    const focusedLabel = () => page.evaluate(() => document.activeElement?.closest('label')?.textContent?.trim() ?? document.activeElement?.textContent?.trim());
    const checked = () => page.evaluate(() => !!document.activeElement?.checked);
    for (let i = 0; i < 4 && await focusedLabel() !== 'Not downloaded'; i++) await press(page, 'ArrowDown');
    const onOption = await focusedLabel();
    const before = await visibleCards(page);
    await press(page, 'Enter');
    await page.waitForTimeout(3000);
    const filtered = { checked: await checked(), cards: await visibleCards(page), stillOpen: await openModalCount(page) };
    await press(page, 'Enter');
    await page.waitForTimeout(3000);
    const cleared = { checked: await checked(), cards: await visibleCards(page) };
    return { fileGroup: true, options, onOption, before, filtered, cleared, trail };
}

async function checkModernGrid(page, name, lib) {
    const route = gridRoute(lib);
    const first = await describeFocus(page);
    record(name, `${route} grid: first focus on a card`, /card/.test(first) && /itemsContainer/.test(first), first);
    for (const how of ['escape', 'remote']) {
        const filterExercise = how === 'escape' ? () => exerciseFilter(page) : undefined;
        await checkPopoverBack(page, name, route, 'Filter', how, filterExercise);
        await checkPopoverBack(page, name, route, 'Sort', how, async () => {
            const opened = await describeFocus(page);
            await press(page, 'ArrowDown');
            return { opened, afterDown: await describeFocus(page) };
        });
        await checkPopoverBack(page, name, route, 'View settings', how, async () => {
            // Right into the grid-view row's settings button, Enter to open the card settings, Down into them.
            const walk = [await describeFocus(page)];
            await press(page, 'ArrowRight');
            walk.push(await describeFocus(page));
            await press(page, 'Enter');
            await page.waitForTimeout(500);
            await press(page, 'ArrowDown');
            walk.push(await describeFocus(page));
            await press(page, 'ArrowDown');
            walk.push(await describeFocus(page));
            return walk;
        });
    }
    // The view menu switches tabs by remote; Back returns to the grid tab.
    const viewLabel = route === 'movies' ? 'Movies' : 'Shows';
    const reachView = await focusToolbarControl(page, viewLabel);
    if (reachView.ok) {
        await press(page, 'Enter');
        await page.waitForTimeout(700);
        const menu = [await describeFocus(page)];
        await press(page, 'ArrowDown');
        menu.push(await describeFocus(page));
        await press(page, 'Enter');
        await page.waitForTimeout(3000);
        const tab = await page.evaluate(() => ({ hash: location.hash, sections: document.querySelectorAll('.page:not(.hide) .verticalSection, .page:not(.hide) .sectionTitle').length, cards: document.querySelectorAll('.page:not(.hide) .card').length }));
        record(name, `${route} grid: view menu switches to Suggestions by remote`, /tab=1/.test(tab.hash) && tab.cards > 0, { menu, tab });
        await pressRemoteBack(page);
        await page.waitForTimeout(2500);
        const back = await page.evaluate(() => ({ hash: location.hash, cards: document.querySelectorAll('.page:not(.hide) .itemsContainer .card').length }));
        record(name, `${route} grid: remote Back returns to the grid tab`, !/tab=1/.test(back.hash) && back.hash.includes(route) && back.cards > 0, back);
    } else {
        record(name, `${route} grid: view menu reachable by d-pad`, false, reachView.trail);
    }
    // Paging by remote where the library has more than one page.
    const paging = await gridStats(page);
    const reachNext = await focusToolbarControl(page, 'Next');
    if (reachNext.ok) {
        const firstBefore = await page.evaluate(() => document.querySelector('.page:not(.hide) .itemsContainer .card')?.getAttribute('data-id'));
        await press(page, 'Enter');
        await page.waitForFunction(id => {
            const c = document.querySelector('.page:not(.hide) .itemsContainer .card');
            return c && c.getAttribute('data-id') !== id;
        }, firstBefore, { timeout: 15000 });
        await page.waitForTimeout(1500);
        const page2 = await gridStats(page);
        record(name, `${route} grid: Next page by remote`, page2.cards > 0 && page2.paging !== paging.paging, { before: paging.paging, after: page2 });
        const reachPrev = await focusToolbarControl(page, 'Previous');
        if (reachPrev.ok) { await press(page, 'Enter'); await page.waitForTimeout(2500); }
        record(name, `${route} grid: Previous page by remote`, reachPrev.ok && (await gridStats(page)).paging === paging.paging, (await gridStats(page)).paging);
    } else {
        record(name, `${route} grid: single page, Next not offered`, !/\d+-\d+ of/.test(paging.paging), paging.paging);
    }
    // Card by Enter, Back returns to the same card: down from the toolbar's left end, into the grid.
    await focusToolbarControl(page, viewLabel);
    await press(page, 'ArrowDown', 2);
    await press(page, 'ArrowRight', 2);
    const before = await describeFocus(page);
    const cardId = await page.evaluate(() => document.activeElement?.closest('.card')?.getAttribute('data-id'));
    if (cardId) {
        await press(page, 'Enter');
        await waitHash(page, 'details', 15000);
        await page.waitForTimeout(2000);
        await press(page, 'Escape');
        await waitHash(page, route, 15000);
        await page.waitForTimeout(2500);
        const restored = await page.evaluate(() => document.activeElement?.closest('.card')?.getAttribute('data-id'));
        record(name, `${route} grid: Enter opens a card, Back returns with focus on it`, restored === cardId, { before, after: await describeFocus(page) });
    } else {
        record(name, `${route} grid: card focused for Enter`, false, before);
    }
    // With nothing open, Back leaves the grid as before.
    await pressRemoteBack(page);
    await page.waitForTimeout(1200);
    record(name, `${route} grid: remote Back with nothing open navigates back`, (await currentRoute(page)) !== '#/' + route, await currentRoute(page));
}

async function checkLegacyGrid(page, name, lib) {
    const route = gridRoute(lib);
    const trail = [await describeFocus(page)];
    await press(page, 'ArrowUp');
    trail.push(await describeFocus(page));
    let onFilter = false;
    for (let j = 0; j < 8 && !onFilter; j++) {
        onFilter = await page.evaluate(() => !!document.activeElement?.classList.contains('btnFilter'));
        if (!onFilter) { await press(page, 'ArrowRight'); trail.push(await describeFocus(page)); }
    }
    record(name, `${route} legacy grid: filter button d-pad reachable`, onFilter, trail);
    if (!onFilter) return;
    await press(page, 'Enter');
    await page.waitForSelector('.dialog .jfmodFileFilters', { timeout: 10000 });
    record(name, `${route} legacy grid: filter dialog carries the File group`, await page.evaluate(() => !document.querySelector('.dialog .jfmodFileFilters')?.classList.contains('hide')));
    await press(page, 'Escape');
    await page.waitForTimeout(1200);
}

async function checkGrids(page, name, cfg, libs) {
    for (const lib of libs) {
        const route = gridRoute(lib);
        try {
            await openGrid(page, lib);
            const kind = await gridKind(page);
            const g = await gridStats(page);
            record(name, `${route} grid (${kind}): cards, mod cards and file-state marks`, g.modCards > 0 && g.marks > 0 && g.filterButton, g);
            if (!cfg.tv) continue;
            if (kind === 'modern') await checkModernGrid(page, name, lib);
            else await checkLegacyGrid(page, name, lib);
        } catch (e) { record(name, `${route} grid`, false, notVerified(e)); }
    }
}

// ---------------------------------------------------------------- Performance (TV 1920x1080)

const installPerfProbe = page => page.evaluate(() => {
    if (window.jfmodPerf) return;
    const perf = { keyAt: null, focusLatencies: [], frameLatencies: [] };
    window.jfmodPerf = perf;
    window.addEventListener('keydown', () => { perf.keyAt = performance.now(); }, true);
    document.addEventListener('focusin', () => {
        if (perf.keyAt === null) return;
        const start = perf.keyAt;
        perf.keyAt = null;
        perf.focusLatencies.push(performance.now() - start);
        requestAnimationFrame(() => requestAnimationFrame(() => perf.frameLatencies.push(performance.now() - start)));
    }, true);
});

/** In-app navigation from Home to the grid, timed to the first card and to the settled grid. */
const timeNavigation = (page, hash) => page.evaluate(target => new Promise(resolve => {
    const start = performance.now();
    let firstCard = null;
    let lastCount = -1;
    let stableSince = null;
    const cards = () => {
        const pg = [...document.querySelectorAll('.page:not(.hide)')].find(el => el.querySelector('.itemsContainer .card'));
        return pg ? pg.querySelectorAll('.itemsContainer .card').length : 0;
    };
    const tick = () => {
        const now = performance.now();
        const count = cards();
        if (count && firstCard === null) firstCard = now - start;
        if (count !== lastCount) { lastCount = count; stableSince = now; }
        if (count && now - stableSince > 1500) { resolve({ firstCard, settled: stableSince - start, cards: count }); return; }
        if (now - start > 30000) { resolve({ firstCard, settled: null, cards: count, timedOut: true }); return; }
        requestAnimationFrame(tick);
    };
    location.hash = target;
    requestAnimationFrame(tick);
}), hash);

const timePageChange = (page, clickSelector) => page.evaluate(sel => new Promise(resolve => {
    const firstId = () => document.querySelector('.page:not(.hide) .itemsContainer .card')?.getAttribute('data-id');
    const before = firstId();
    const button = [...document.querySelectorAll(sel)].find(b => b.offsetParent && !b.disabled);
    if (!button) { resolve({ error: 'no next-page control' }); return; }
    const start = performance.now();
    let changed = null;
    let lastCount = -1;
    let stableSince = null;
    const observer = new MutationObserver(() => {
        if (changed === null && firstId() && firstId() !== before) changed = performance.now() - start;
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const tick = () => {
        const now = performance.now();
        const count = document.querySelectorAll('.page:not(.hide) .itemsContainer .card').length;
        if (count !== lastCount) { lastCount = count; stableSince = now; }
        if (changed !== null && now - stableSince > 1500) { observer.disconnect(); resolve({ firstCardChanged: changed, settled: stableSince - start, cards: count }); return; }
        if (now - start > 30000) { observer.disconnect(); resolve({ firstCardChanged: changed, timedOut: true }); return; }
        requestAnimationFrame(tick);
    };
    button.focus();
    button.click();
    requestAnimationFrame(tick);
}), clickSelector);

const median = values => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted.length ? Math.round(sorted[Math.floor(sorted.length / 2)] * 10) / 10 : null;
};
const p95 = values => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] * 10) / 10 : null;
};

async function measurePerf(page, name, libs) {
    for (const lib of libs) {
        const route = gridRoute(lib);
        try {
            const nav = [];
            for (let run = 0; run < 3; run++) {
                await freshHome(page);
                nav.push(await timeNavigation(page, `#/${route}?topParentId=${lib.id}&collectionType=${lib.type}`));
            }
            const kind = await gridKind(page);
            record(name, `perf ${route} (${kind}): Home -> grid, ms to first card / settled`, undefined, {
                firstCard: nav.map(n => Math.round(n.firstCard)), settled: nav.map(n => Math.round(n.settled ?? -1)), cards: nav.map(n => n.cards)
            });
            await page.waitForTimeout(1500);
            await installPerfProbe(page);
            await page.evaluate(() => {
                const card = document.querySelector('.page:not(.hide) .itemsContainer .card');
                card?.focus();
                window.jfmodPerf.focusLatencies.length = 0;
                window.jfmodPerf.frameLatencies.length = 0;
            });
            for (let i = 0; i < 10; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(150); }
            for (let i = 0; i < 10; i++) { await page.keyboard.press('ArrowDown'); await page.waitForTimeout(150); }
            await page.waitForTimeout(500);
            const lat = await page.evaluate(() => ({ focus: window.jfmodPerf.focusLatencies, frame: window.jfmodPerf.frameLatencies }));
            record(name, `perf ${route} (${kind}): key -> focus / key -> painted frame, ms (median, p95, n)`, undefined, {
                focus: [median(lat.focus), p95(lat.focus), lat.focus.length], frame: [median(lat.frame), p95(lat.frame), lat.frame.length]
            });
            const pageChange = await timePageChange(page, kind === 'modern' ? '.page:not(.hide) .MuiToolbar-root button[title="Next"]' : '.page:not(.hide) .btnNextPage');
            record(name, `perf ${route} (${kind}): next page, ms to first new card / settled`, undefined, pageChange);
        } catch (e) { record(name, `perf ${route}`, false, notVerified(e)); }
    }
}

// ---------------------------------------------------------------- Run

async function runLayout(name) {
    const cfg = LAYOUTS[name];
    const context = await browser.newContext({ viewport: cfg.viewport, isMobile: cfg.isMobile, hasTouch: cfg.hasTouch, ...(cfg.userAgent ? { userAgent: cfg.userAgent } : {}) });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    const errors = errorsFor(page);
    try {
        await signIn(page);
        await page.evaluate(layout => { if (layout) localStorage.setItem('layout', layout); else localStorage.removeItem('layout'); }, cfg.layout ?? null);
        await page.goto(base + '#/home', { waitUntil: 'domcontentloaded' });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.ApiClient && /layout-/.test(document.documentElement.className), undefined, { timeout: 30000 });
        const layoutClass = await page.evaluate(() => document.documentElement.className);
        let layoutOk = /layout-desktop/.test(layoutClass);
        if (cfg.tv) layoutOk = /layout-tv/.test(layoutClass);
        else if (name === 'mobile') layoutOk = /layout-mobile/.test(layoutClass);
        record(name, 'layout class', layoutOk, layoutClass);
        record(name, 'mod bundle', true, await page.evaluate(() => document.querySelector('meta[name="jellyfinmod-web"]')?.content));

        if (sections.has('home')) await checkHome(page, name, cfg);
        if (sections.has('search')) await checkSearch(page, name, cfg);
        const libs = await libraries(page);
        const movieLib = libs.find(l => l.type === 'movies');
        const showLib = libs.find(l => l.type === 'tvshows');
        if (sections.has('details')) await checkDetails(page, name, cfg, movieLib);
        if (sections.has('grids')) await checkGrids(page, name, cfg, [showLib, movieLib]);
        if (sections.has('perf') && name === 'tv1080') await measurePerf(page, name, [showLib, movieLib]);
        // Upstream's emby-select leaves its action sheet's cancellation unhandled (no catch on actionsheet.show), so
        // backing out of any select on the TV logs this in stock Jellyfin too. It is reported, not counted.
        const upstreamKnown = errors.filter(e => e === 'ActionSheet closed without resolving');
        if (upstreamKnown.length) record(name, 'upstream emby-select cancellation (not a mod error)', undefined, upstreamKnown.length);
        const pageErrors = errors.filter(e => e !== 'ActionSheet closed without resolving');
        record(name, 'page errors', pageErrors.length === 0, pageErrors.slice(0, 5));
        const layoutStyle = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
        record(name, 'root font size', undefined, layoutStyle);
    } finally {
        await page.evaluate(() => localStorage.removeItem('layout')).catch(() => undefined);
        await context.close();
    }
}

for (const name of only) await runLayout(name);
await browser.close();
const failed = results.filter(r => r.ok === false);
console.log(`\nSUMMARY ${tier}: ${results.filter(r => r.ok === true).length} pass, ${failed.length} fail`);
process.exitCode = failed.length ? 1 : 0;
/* eslint-enable compat/compat, no-restricted-globals, @stylistic/max-statements-per-line, sonarjs/cognitive-complexity, sonarjs/slow-regex */
