/* eslint-disable compat/compat, sonarjs/cognitive-complexity -- a Node acceptance runner, not shipped code */
/* global window, document, location, localStorage, ApiClient */
// P7.S11 step 5: the full-replacement sweep (PHASE7 §2.2). Every inventory row is OPENED FROM THE SHELL — the drawer or
// library navigation, the user menu, the preferences menu, links and cards on the pages themselves — in every layout,
// and the TV layouts are driven by keys alone (arrows, Enter, Back as Escape or the webOS remote's 461). A row is typed
// as an address only where the shell has no link to it in that layout, and the row then says so.
//
//   JELLYFINMOD_TEST_URL=http://<host>:<isolated-port>/ JELLYFINMOD_BROWSER=chromium|chrome node replacement-sweep.mjs
//
// JELLYFINMOD_SWEEP_LAYOUTS=desktop,mobile,tv1080,tv720
// JELLYFINMOD_SWEEP_PLAY=<movie title>   a movie that direct-plays in Chrome (H.264/AAC), found through search and played
// JELLYFINMOD_SWEEP_SERIES=<series title>  a series with episodes on disk, opened from the TV grid
// JELLYFINMOD_SWEEP_OUT=<file.json>      per-row results (addresses scrubbed)
// JELLYFINMOD_TEST_USER=oleksii          signs in with an empty password through the login form
//
// Each row passes only when the page renders its own content, no "page not found" shows, no uncaught page error is
// raised and no request fails other than the known-benign ones listed in BENIGN (each named in the output). A wait
// that runs out is NOT VERIFIED, never a pass. Playing the title changes its user data; the runner snapshots that
// item's user data first and writes it back exactly afterwards (POST /UserItems/{id}/UserData), and stops playback.
// Stock-for-now library types without a library on the instance are recorded as NOT PRESENT. Nothing else is written;
// the layout override is removed from every profile at the end.
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const testUrl = new URL(process.env.JELLYFINMOD_TEST_URL ?? 'http://127.0.0.1:28096/');
if (!['18096', '28096'].includes(testUrl.port)) throw new Error('The sweep runs only against an isolated instance (18096 or 28096)');
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
const base = new URL('/web/', testUrl).href;
const testUser = process.env.JELLYFINMOD_TEST_USER ?? 'oleksii';
const playTitle = process.env.JELLYFINMOD_SWEEP_PLAY ?? 'Night of the Living Dead';
// A series with episodes on disk, so the season page lists episodes to open.
const seriesTitle = process.env.JELLYFINMOD_SWEEP_SERIES ?? "A Good Girl's Guide to Murder";
const escapeRe = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const only = (process.env.JELLYFINMOD_SWEEP_LAYOUTS ?? 'desktop,mobile,tv1080,tv720').split(',');
const outFile = process.env.JELLYFINMOD_SWEEP_OUT;

const LAYOUTS = {
    desktop: { viewport: { width: 1440, height: 900 }, tv: false },
    mobile: {
        viewport: { width: 390, height: 844 }, tv: false, mobile: true, isMobile: true, hasTouch: true,
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
    },
    tv1080: { viewport: { width: 1920, height: 1080 }, tv: true },
    tv720: { viewport: { width: 1280, height: 720 }, tv: true }
};

// Failed requests that are not a defect of the page, each with its reason. Anything else fails the row.
const BENIGN = [
    { name: 'aborted by navigation', test: f => /ERR_ABORTED|NS_BINDING_ABORTED/.test(f.failure ?? '') },
    { name: 'missing artwork (404 on an Images route)', test: f => f.status === 404 && /\/Images\//.test(f.path) },
    { name: 'stock Dashboard polls the plugin repository catalog', test: f => /\/Packages$/.test(f.path) && f.status >= 500 }
];

const scrub = text => String(text).split(testUrl.host).join('<host>').split(testUrl.hostname).join('<host>')
    .replace(/\b(?:10|127|172\.(?:1[6-9]|2\d|3[01])|192\.168)(?:\.\d{1,3}){2,3}\b/g, '<private-ip>')
    .replace(/[?&](?:api_key|ApiKey|X-Emby-Token|Tag)=[^&"\s]*/gi, '')
    .replace(/\b[0-9a-f]{32}\b/gi, '<id>');

const results = [];
const record = (layout, row, verdict, how, detail) => {
    const entry = { layout, row, verdict, how, detail: detail === undefined ? undefined : JSON.parse(scrub(JSON.stringify(detail))) };
    results.push(entry);
    console.log(`${verdict} [${tier}] [${layout}] ${row} (${how})${detail === undefined ? '' : ' :: ' + JSON.stringify(entry.detail).slice(0, 500)}`);
};

const launchOptions = { headless: true };
if (tier === 'chrome') launchOptions.channel = 'chrome';
const browser = await chromium.launch(launchOptions);
const browserVersion = browser.version();
console.log('browser', tier, browserVersion);

// ------------------------------------------------------------------------------------------------ primitives

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function poll(check, { timeout = 20000, every = 400 } = {}) {
    const deadline = Date.now() + timeout;
    let last;
    while (Date.now() < deadline) {
        last = await check().catch(() => undefined);
        if (last?.ok) return last;
        await sleep(every);
    }
    return last ?? { ok: false };
}

const hash = page => page.evaluate(() => location.hash);

/** Visible and not inside a hidden legacy page. */
const VISIBLE = 'function vis(e){if(!e)return false;const r=e.getBoundingClientRect();if(!r.width||!r.height)return false;if(e.closest(".hide,[aria-hidden=\\"true\\"]"))return false;const s=getComputedStyle(e);return s.visibility!=="hidden"&&s.display!=="none";}';

/**
 * Finds the first visible element matching a CSS selector whose text (or aria-label/title) matches `text`
 * (a regex source, case-insensitive), inside an optional scope selector. Runs in the page.
 */
const FIND = `${VISIBLE};function find(q){const scopes=q.scope?[...document.querySelectorAll(q.scope)].filter(vis):[document];for(const s of scopes){for(const e of s.querySelectorAll(q.sel)){if(!vis(e))continue;if(q.text){const re=new RegExp(q.text,'i');if(![e.getAttribute('aria-label'),e.getAttribute('title'),e.textContent].some(t=>t&&re.test(t.replace(/\\s+/g,' '))))continue;}if(q.not&&e.matches(q.not))continue;return e;}}return null;}`;

async function click(page, q, timeout = 15000) {
    const found = await poll(() => page.evaluate(({ q, FIND }) => {
        // eslint-disable-next-line no-eval -- the finder is shared text so the TV seek and the pointer click agree
        const find = (0, eval)(`(()=>{${FIND};return find;})()`);
        const e = find(q);
        if (!e) return { ok: false };
        // A card's centre carries the desktop hover overlay's Play button: open a card through its title link.
        // A card's centre carries the desktop hover overlay's Play button: open a card through the top-left corner of
        // its image (the overlay's link), and a list item through its text.
        const isCard = e.matches('.card');
        const inner = isCard ? e.querySelector('.cardScalable, .cardImageContainer') ?? e : e.matches('.listItem') ? e.querySelector('.listItemBody') ?? e : e;
        inner.scrollIntoView({ block: 'center', inline: 'center' });
        const r = inner.getBoundingClientRect();
        return isCard ? { ok: true, x: r.left + Math.min(14, r.width / 4), y: r.top + Math.min(14, r.height / 4) } : { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, { q, FIND }), { timeout });
    if (!found.ok) {
        const why = await page.evaluate(q => {
            const all = [...document.querySelectorAll((q.scope ? q.scope + ' ' : '') + q.sel.split(', ')[0])];
            const first = all[0];
            const hidden = first?.closest('.hide,[aria-hidden="true"]');
            return { matches: all.length, firstRect: first ? Math.round(first.getBoundingClientRect().width) + 'x' + Math.round(first.getBoundingClientRect().height) : null,
                hiddenBy: hidden ? `${hidden.tagName}.${String(hidden.className).slice(0, 60)}#${hidden.id}` : null };
        }, q).catch(() => null);
        throw new Error('timed out: no visible ' + JSON.stringify(q) + ' ' + JSON.stringify(why));
    }
    await page.mouse.move(found.x, found.y);
    await sleep(200);
    await page.mouse.click(found.x, found.y);
    await sleep(600);
}

const describeFocus = page => page.evaluate(() => {
    const e = document.activeElement;
    if (!e || e === document.body) return 'BODY';
    return `${e.tagName.toLowerCase()}.${String(e.className).split(/\s+/).slice(0, 2).join('.')} "${(e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30)}"`;
});

const press = async (page, key, times = 1) => {
    for (let i = 0; i < times; i++) {
        await page.keyboard.press(key);
        await sleep(220);
    }
};

/** The webOS remote's Back key (461), sent through the DevTools protocol as tv-shell.mjs does. */
async function remoteBack(page) {
    const client = await page.context().newCDPSession(page);
    try {
        for (const type of ['rawKeyDown', 'keyUp']) {
            await client.send('Input.dispatchKeyEvent', { type, windowsVirtualKeyCode: 461, nativeVirtualKeyCode: 461, key: 'GoBack', code: '' });
        }
    } finally { await client.detach(); }
    await sleep(700);
}

/**
 * TV: moves focus onto the target with arrow keys only. The DOM is read to choose which arrow to press — the way a
 * person looks at the screen — but only key presses move focus. Returns the number of presses.
 */
async function seek(page, q, { max = 70, timeout = 20000 } = {}) {
    const present = await poll(() => page.evaluate(({ q, FIND }) => {
        const find = (0, eval)(`(()=>{${FIND};return find;})()`);
        return { ok: !!find(q) };
    }, { q, FIND }), { timeout });
    if (!present.ok) throw new Error('timed out: target never appeared ' + JSON.stringify(q));
    let presses = 0;
    let detoured = null;
    const tried = new Map();
    for (; presses < max; presses++) {
        const s = await page.evaluate(({ q, FIND }) => {
            const find = (0, eval)(`(()=>{${FIND};return find;})()`);
            const t = find(q);
            if (!t) return { missing: true };
            const a = document.activeElement;
            if (a && a !== document.body && (a === t || t.contains(a))) return { done: true };
            const tr = t.getBoundingClientRect();
            const ar = a && a !== document.body ? a.getBoundingClientRect() : null;
            // The element's own identity as well as its place: in a scrolling list (the settings rail on a 720p TV) every
            // step scrolls into the same spot with the same classes, and a position-only key took a new step for one
            // already tried, so the walk gave up on keys it had never pressed there (P7.S11 verification re-run 2).
            const who = a && a !== document.body ? (a.dataset?.section ?? a.dataset?.id ?? a.getAttribute('href') ?? (a.textContent || '').trim().slice(0, 40)) : '';
            const key = a && a !== document.body ? (a.id || '') + '|' + String(a.className) + '|' + who + '|' + Math.round(ar.left) + ',' + Math.round(ar.top) : 'BODY';
            return { tr: { x: tr.left + tr.width / 2, y: tr.top + tr.height / 2 }, ar: ar ? { x: ar.left + ar.width / 2, y: ar.top + ar.height / 2, h: ar.height, w: ar.width } : null, key };
        }, { q, FIND });
        if (s.done) {
            if (detoured) page.jfmodDetours = [...(page.jfmodDetours ?? []), detoured];
            return presses;
        }
        if (s.missing) { await sleep(500); continue; }
        const order = [];
        if (!s.ar) order.push('ArrowDown', 'ArrowRight');
        else {
            const dx = s.tr.x - s.ar.x;
            const dy = s.tr.y - s.ar.y;
            const vertical = Math.abs(dy) > Math.max(s.ar.h / 2, 12);
            const horizontal = Math.abs(dx) > Math.max(s.ar.w / 2, 12);
            const v = dy > 0 ? 'ArrowDown' : 'ArrowUp';
            const h = dx > 0 ? 'ArrowRight' : 'ArrowLeft';
            if (vertical) order.push(v);
            if (horizontal) order.push(h);
            if (!vertical && !horizontal) order.push(h, v);
            if (vertical && !horizontal) order.push('ArrowRight', 'ArrowLeft');
            if (horizontal && !vertical) order.push('ArrowDown', 'ArrowUp');
        }
        const used = tried.get(s.key) ?? new Set();
        const next = order.find(k => !used.has(k));
        if (!next && !detoured) {
            // Upstream's Dashboard drawer (identical on the stock entry) traps the D-pad on its server link: no arrow
            // moves on from it except Right, into the page. Take that one detour, as a remote user would, and say so.
            detoured = await describeFocus(page);
            tried.clear();
            await press(page, 'ArrowRight');
            continue;
        }
        if (!next) throw new Error('focus is stuck at ' + await describeFocus(page) + ' before ' + JSON.stringify(q));
        used.add(next);
        tried.set(s.key, used);
        await press(page, next);
    }
    throw new Error(`target not reached in ${max} key presses: ${JSON.stringify(q)} (focus ${await describeFocus(page)})`);
}

/** Opens a target: TV seeks it by arrows and presses Enter; the other layouts click it. */
async function activate(page, cfg, q) {
    if (cfg.tv) {
        const presses = await seek(page, q);
        await press(page, 'Enter');
        await sleep(700);
        return presses;
    }
    await click(page, q);
    return 0;
}

/** Reads what the visible page shows. */
const readPage = (page, expect) => page.evaluate(({ expect, VISIBLE }) => {
    const vis = (0, eval)(`(()=>{${VISIBLE};return vis;})()`);
    const h = location.hash;
    const notFound = [...document.querySelectorAll('h1, h2')].filter(vis).some(e => /page not found/i.test(e.textContent));
    // Upstream's error boundary replaces a page that threw while rendering.
    const crashed = [...document.querySelectorAll('#errorBoundary')].filter(vis).map(e => e.textContent.trim().replace(/\s+/g, ' ').slice(0, 160))[0];
    const content = expect.selector ? [...document.querySelectorAll(expect.selector)].filter(vis) : [];
    const text = content.map(e => e.textContent.trim().replace(/\s+/g, ' ')).join(' | ').slice(0, 160);
    const hashOk = !expect.hash || new RegExp(expect.hash).test(h);
    const textOk = !expect.text || new RegExp(expect.text, 'i').test(content.map(e => e.textContent).join(' '));
    return { ok: hashOk && content.length > 0 && textOk && !notFound && !crashed, hash: h.split('?')[0], hashOk, found: content.length, textOk, notFound, crashed, text };
}, { expect, VISIBLE });

// ------------------------------------------------------------------------------------------------ one layout

async function sweepLayout(name) {
    const cfg = LAYOUTS[name];
    const context = await browser.newContext({ viewport: cfg.viewport, isMobile: cfg.isMobile, hasTouch: cfg.hasTouch, userAgent: cfg.userAgent, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    const errors = [];
    const failed = [];
    page.on('pageerror', e => errors.push(String(e.message).split('\n')[0].slice(0, 200)));
    page.on('requestfailed', r => failed.push({ path: new URL(r.url()).pathname, method: r.method(), failure: r.failure()?.errorText ?? 'failed' }));
    page.on('response', r => {
        if (r.status() >= 400) failed.push({ path: new URL(r.url()).pathname, method: r.request().method(), status: r.status() });
    });

    /** Runs one inventory row: open it the way the layout is driven, then check the page. */
    async function row(label, how, open, expect, { settle = 1500, before = 0, benignHere = [] } = {}) {
        const e0 = errors.length;
        const f0 = failed.length;
        let verdict;
        let detail;
        try {
            page.jfmodDetours = [];
            const opened = await open();
            if (before) await sleep(before);
            const state = await poll(() => readPage(page, expect), { timeout: expect.timeout ?? 20000 });
            await sleep(settle);
            if (expect.itemType) {
                const id = new URLSearchParams((await hash(page)).split('?')[1] ?? '').get('id');
                state.itemType = id ? (await api('GET', `Users/${userId}/Items/${id}`)).body?.Type : null;
                if (!new RegExp(expect.itemType).test(state.itemType ?? '')) state.ok = false;
            }
            verdict = state.ok ? 'PASS' : 'FAIL';
            detail = { ...state, ...(opened && typeof opened === 'object' ? opened : {}), ...(page.jfmodDetours?.length ? { dpadDetour: 'Right from ' + page.jfmodDetours.join(', ') + ' (upstream drawer trap, same on stock)' } : {}) };
            if (!state.ok && state.found === 0 && !state.notFound && !state.crashed) verdict = 'NOT VERIFIED';
        } catch (error) {
            verdict = /timed out|Timeout/i.test(error.message) ? 'NOT VERIFIED' : 'FAIL';
            detail = { error: String(error.message).split('\n')[0].slice(0, 300), focus: cfg.tv ? await describeFocus(page).catch(() => '') : undefined, hash: await hash(page).catch(() => '') };
        }
        const rowErrors = errors.slice(e0);
        const rowFailed = failed.slice(f0);
        const known = [...BENIGN, ...benignHere];
        const benign = rowFailed.map(f => ({ ...f, benign: known.find(b => b.test(f))?.name })).filter(f => f.benign);
        const bad = rowFailed.filter(f => !known.some(b => b.test(f)));
        if (verdict === 'PASS' && (rowErrors.length || bad.length)) verdict = 'FAIL';
        detail = { ...detail, pageErrors: rowErrors.length ? rowErrors : undefined, failedRequests: bad.length ? bad : undefined,
            benignRequests: benign.length ? [...new Set(benign.map(b => `${b.benign}: ${b.method} ${b.path.replace(/[0-9a-f]{32}/gi, '<id>')}`))] : undefined };
        record(name, label, verdict, how, detail);
        return verdict;
    }

    let userId;
    const shell = 'shell';
    const keys = 'keys';
    const api = (method, path, body) => page.evaluate(async ({ method, path, body }) => {
        const response = await fetch(ApiClient.getUrl(path), { method, headers: { Authorization: `MediaBrowser Token="${ApiClient.accessToken()}"`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
        const text = await response.text();
        try { return { status: response.status, body: text ? JSON.parse(text) : null }; } catch { return { status: response.status, body: text }; }
    }, { method, path, body });

    // ---- the login form, by pointer or by keys
    async function signIn() {
        await poll(() => page.evaluate(() => ({ ok: /login|selectuser|selectserver/.test(location.hash) || !!document.querySelector('#txtManualName, .btnManual') })), { timeout: 30000 });
        const fieldVisible = () => page.evaluate(() => { const f = document.querySelector('#txtManualName'); return !!f && f.getClientRects().length > 0 && !f.closest('.hide'); });
        // The login view renders in steps (server check, then the manual form or the user list); wait for either.
        await poll(() => page.evaluate(() => ({ ok: [...document.querySelectorAll('#txtManualName, .btnManual')].some(e => e.getClientRects().length > 0 && !e.closest('.hide')) })), { timeout: 30000 });
        await sleep(800);
        if (cfg.tv) {
            if (!await fieldVisible()) await activate(page, cfg, { sel: '.btnManual' });
            await seek(page, { sel: '#txtManualName' });
            await page.waitForTimeout(800);
            await page.keyboard.press('Control+A').catch(() => {});
            await page.keyboard.type(testUser, { delay: 40 });
            await activate(page, cfg, { sel: '.manualLoginForm button[type="submit"]' });
        } else {
            if (!await fieldVisible()) await click(page, { sel: '.btnManual' });
            const field = page.locator('#txtManualName');
            await field.waitFor({ state: 'visible' });
            await page.waitForTimeout(800);
            await field.fill(testUser);
            await click(page, { sel: '.manualLoginForm button[type="submit"]' });
        }
        await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId() && location.hash.startsWith('#/home'); } catch { return false; } }, undefined, { timeout: 30000 });
    }

    const userMenu = async item => {
        await click(page, { sel: 'button[aria-label="User Menu"]' });
        await click(page, { sel: '.MuiMenuItem-root', text: `^\\s*${item}\\s*$`, scope: '.MuiPopover-root:not([aria-hidden="true"])' });
    };
    const library = async libraryName => {
        if (cfg.mobile) {
            await click(page, { sel: 'button[aria-label="Open Menu"]' });
            await click(page, { sel: 'a.MuiListItemButton-root', text: `^\\s*${libraryName}\\s*$`, scope: '.MuiDrawer-root' });
        } else {
            await click(page, { sel: 'a.MuiButton-root', text: `^\\s*${libraryName}\\s*$`, scope: '.MuiToolbar-root' });
        }
    };
    /** TV: back to Home through the header's Home button, by keys. */
    const tvHome = async () => {
        // Upstream hides the header's Home button on Home itself.
        if (!await page.evaluate(() => location.hash.startsWith('#/home'))) await activate(page, cfg, { sel: '.headerHomeButton' });
        await poll(() => page.evaluate(() => ({ ok: location.hash.startsWith('#/home') && !!document.querySelector('.homePage:not(.hide) .sections .verticalSection') })), { timeout: 20000 });
        await sleep(2000);
    };
    const home = async () => {
        if (cfg.tv) return tvHome();
        if (cfg.mobile) {
            await click(page, { sel: 'button[aria-label="Open Menu"]' });
            await click(page, { sel: 'a.MuiListItemButton-root', text: '^\\s*Home\\s*$', scope: '.MuiDrawer-root' });
        } else {
            await click(page, { sel: 'a.MuiButton-root', text: '.', scope: '.MuiToolbar-root' }); // the server name links Home
        }
        await poll(() => page.evaluate(() => ({ ok: location.hash.startsWith('#/home') })), { timeout: 15000 });
        await sleep(1500);
    };
    /** TV: libraries are the "My Media" cards on Home. */
    const tvLibrary = async libraryName => {
        await tvHome();
        return activate(page, cfg, { sel: '.card', text: `^\\s*${libraryName}\\s*$`, scope: '.page:not(.hide)' });
    };
    const openLibrary = libraryName => (cfg.tv ? tvLibrary(libraryName) : library(libraryName));
    const viewMenu = async tab => {
        await activate(page, cfg, { sel: 'button[aria-controls="library-view-menu"]' });
        await activate(page, cfg, { sel: '.MuiMenuItem-root', text: `^\\s*${tab}\\s*$`, scope: '#library-view-menu' });
    };
    const viewTabs = () => page.evaluate(() => [...document.querySelectorAll('#library-view-menu .MuiMenuItem-root')].map(e => e.textContent.trim()));
    const back = async () => {
        if (cfg.tv) await press(page, 'Escape');
        else await page.goBack();
        await sleep(1500);
    };
    /** Opens the preferences menu: the user menu's Settings, or on the TV the header's user button. */
    const prefsMenu = async () => {
        if (cfg.tv) await activate(page, cfg, { sel: '.headerUserButton' });
        else await userMenu('Settings');
        await poll(() => page.evaluate(() => ({ ok: !!document.querySelector('.page:not(.hide) .lnkDisplayPreferences') })), { timeout: 15000 });
    };

    const DETAIL = { hash: '^#/details\\?', selector: '#itemDetailPage:not(.hide) .itemName, .page:not(.hide) .detailPagePrimaryContainer h1, .page:not(.hide) .jfmod-entryDetailsRoot h1' };
    const GRID = '.page:not(.hide) .itemsContainer .card, main .itemsContainer .card, .page:not(.hide) .card, main .card, .page:not(.hide) .noItemsMessage, main .noItemsMessage, main .MuiTypography-root';

    // ---- sign in (setup, not a row) and the layout
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.ApiClient, undefined, { timeout: 30000 });
    if (cfg.tv) {
        await page.evaluate(() => localStorage.setItem('layout', 'tv'));
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.ApiClient, undefined, { timeout: 30000 });
    }
    const signedIn = await page.evaluate(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } });
    if (!signedIn) await signIn();
    userId = await page.evaluate(() => ApiClient.getCurrentUserId());
    const bundle = await page.evaluate(() => ({ modBundle: window.__jfmodBundle === true, layoutTv: document.documentElement.classList.contains('layout-tv') }));
    if (cfg.tv && !bundle.layoutTv) throw new Error('TV layout did not apply');

    // ---- Home
    await row('Home', 'landing after sign-in', async () => ({ ...bundle }), { hash: '^#/home', selector: '.homePage:not(.hide) .sections .verticalSection, .jfmod-homeHero' });

    // ---- Movies and each Movies tab
    for (const [libraryName, hashRoute] of [['Movies', 'movies'], ['Shows', 'tv']]) {
        const label = libraryName === 'Movies' ? 'Movies' : 'TV';
        await row(`${label} library`, cfg.tv ? keys + ': Home My Media card' : shell + (cfg.mobile ? ': drawer' : ': toolbar library link'),
            () => openLibrary(libraryName), { hash: `^#/${hashRoute}\\?`, selector: '.page:not(.hide) .itemsContainer .card, main .itemsContainer .card' });
        let tabs = [];
        try {
            await activate(page, cfg, { sel: 'button[aria-controls="library-view-menu"]' });
            await sleep(800);
            tabs = await viewTabs();
            if (cfg.tv) await press(page, 'Escape'); else await page.keyboard.press('Escape');
            await sleep(600);
        } catch (error) { record(name, `${label} tabs menu`, 'NOT VERIFIED', cfg.tv ? keys : shell, { error: error.message.slice(0, 200) }); }
        for (const [index, tab] of tabs.entries()) {
            if (!index) continue;
            await row(`${label} tab: ${tab}`, (cfg.tv ? keys : shell) + ': library view menu', () => viewMenu(tab),
                { hash: `^#/${hashRoute}\\?.*tab=${index}(&|$)`, selector: GRID }, { before: 2000 });
        }
        if (tabs.length) await row(`${label} tab: ${tabs[0]}`, (cfg.tv ? keys : shell) + ': library view menu', () => viewMenu(tabs[0]),
            { hash: `^#/${hashRoute}\\?(?!.*tab=[1-9])`, selector: '.page:not(.hide) .itemsContainer .card, main .itemsContainer .card' }, { before: 2000 });

        if (libraryName === 'Movies') {
            await row('Movie detail', (cfg.tv ? keys : shell) + ': first movie card in the grid',
                () => activate(page, cfg, { sel: '.itemsContainer .card[data-type="Movie"], .itemsContainer .card', scope: '.page:not(.hide), main' }), { ...DETAIL, itemType: '^Movie$' });
            await row('Person detail (Embed)', (cfg.tv ? keys : shell) + ': cast card on the movie detail', async () => {
                await activate(page, cfg, { sel: '#castContent .card, .peopleSection .card', scope: '#itemDetailPage:not(.hide)' });
                await poll(() => page.evaluate(() => ({ ok: /details\?id=/.test(location.hash) })));
                await sleep(1200);
                const id = new URLSearchParams((await hash(page)).split('?')[1]).get('id');
                const item = await api('GET', `Users/${userId}/Items/${id}`);
                return { personType: item.body?.Type };
            }, { ...DETAIL, selector: '#itemDetailPage:not(.hide) .itemName', itemType: '^Person$' });
            await back();
            await back();
        } else {
            await row('Series detail', (cfg.tv ? keys : shell) + ': the series card in the grid',
                () => activate(page, cfg, { sel: '.itemsContainer .card', text: '^\\s*' + escapeRe(seriesTitle), scope: '.page:not(.hide), main' }), { ...DETAIL, itemType: '^Series$' });
            await row('Season detail', (cfg.tv ? keys : shell) + ': first season card on the series',
                () => activate(page, cfg, { sel: '#childrenContent .card, #childrenContent .listItem', scope: '#itemDetailPage:not(.hide)' }), { ...DETAIL, itemType: '^Season$' });
            // Upstream's season list gives a desktop row no action of its own (itemDetails passes action 'none' when
            // layoutManager.desktop); there the episode opens from the row's Info button, as a mouse user does.
            const episodeTarget = !cfg.tv && !cfg.mobile ?
                { sel: '#childrenContent .listItem button[data-action="link"]', scope: '#itemDetailPage:not(.hide)' } :
                { sel: '#childrenContent .listItem, #childrenContent .card', scope: '#itemDetailPage:not(.hide)' };
            await row('Episode detail', (cfg.tv ? keys : shell) + (!cfg.tv && !cfg.mobile ? ': Info button of the first episode on the season' : ': first episode on the season'),
                () => activate(page, cfg, episodeTarget), { ...DETAIL, itemType: '^Episode$' });
        }
    }

    // ---- Search, then play a title found there
    await row('Search', cfg.tv ? keys + ': header Search button, query typed' : shell + ': toolbar Search', async () => {
        // From Home: inside a library the toolbar's Search is scoped to that library.
        await home();
        if (cfg.tv) await activate(page, cfg, { sel: '.headerSearchButton' }); else await click(page, { sel: 'a[aria-label="Search"]', scope: '.MuiToolbar-root' });
        await page.waitForSelector('#searchTextInput', { state: 'visible', timeout: 15000 });
        if (cfg.tv) { await seek(page, { sel: '#searchTextInput' }); await page.keyboard.type(playTitle, { delay: 40 }); } else await page.fill('#searchTextInput', playTitle);
    }, { hash: '^#/search', selector: '.page:not(.hide) .verticalSection:not(.jfmod-discovery) .card, main .verticalSection:not(.jfmod-discovery) .card', text: playTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') });

    const titlePattern = '^\\s*' + playTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let played = null;
    const before = { userData: null };
    await row('Movie detail from search', (cfg.tv ? keys : shell) + ': search result card', async () => {
        await activate(page, cfg, { sel: '.card', text: titlePattern, scope: '.page:not(.hide) .verticalSection:not(.jfmod-discovery), main .verticalSection:not(.jfmod-discovery)' });
        await poll(() => page.evaluate(() => ({ ok: /details\?id=/.test(location.hash) })));
        played = new URLSearchParams((await hash(page)).split('?')[1]).get('id');
        before.userData = (await api('GET', `Users/${userId}/Items/${played}`)).body?.UserData ?? null;
    }, DETAIL);

    if (played) {
        const video = { advanced: 0 };
        const verdict = await row('Video player (play a few seconds, then Back)', (cfg.tv ? keys + ': Play, then remote Back (461)' : shell + ': Play, then Back'), async () => {
            await activate(page, cfg, { sel: '.btnPlay, .jfmod-play, button', text: '^\\s*(Play|Resume)\\b', scope: '#itemDetailPage:not(.hide) .mainDetailButtons, #itemDetailPage:not(.hide) .detailButtons, .page:not(.hide) .jfmod-entryActions' });
            await poll(() => page.evaluate(() => ({ ok: location.hash.startsWith('#/video') && !!document.querySelector('video') })), { timeout: 20000 });
            const progressed = await poll(() => page.evaluate(() => {
                const v = document.querySelector('video');
                return { ok: !!v && v.currentTime > 3, t: v?.currentTime ?? 0, error: v?.error?.code ?? null };
            }), { timeout: 45000 });
            video.advanced = Math.round((progressed.t ?? 0) * 10) / 10;
            video.mediaError = progressed.error;
            if (!progressed.ok) throw new Error(`timed out: the video did not advance past 3 s (at ${video.advanced} s, media error ${progressed.error})`);
            if (cfg.tv) await remoteBack(page); else await page.goBack();
            await poll(() => page.evaluate(() => ({ ok: /details\?id=/.test(location.hash) })), { timeout: 20000 });
            await sleep(2500);
            const sessions = await api('GET', 'Sessions');
            const deviceId = await page.evaluate(() => ApiClient.deviceId());
            const mine = (sessions.body ?? []).find(s => s.DeviceId === deviceId);
            return { playedSeconds: video.advanced, stillPlaying: !!mine?.NowPlayingItem };
        }, DETAIL, { settle: 500 });
        if (verdict !== 'PASS' && tier === 'chromium' && !video.advanced) {
            results.at(-1).verdict = 'SKIP';
            results.at(-1).reason = "Playwright's bundled Chromium has no H.264/AAC decoding (REVIEW.md browser tiers); Chrome carries this row";
            console.log('  -> SKIP on the bundled Chromium: no proprietary codecs');
        }
        // Put the title's user data back exactly (playing moves LastPlayedDate and may store a position).
        if (before.userData) {
            const u = before.userData;
            const restored = await api('POST', `UserItems/${played}/UserData?userId=${userId}`, {
                Played: !!u.Played, PlayCount: u.PlayCount ?? 0, IsFavorite: !!u.IsFavorite, PlaybackPositionTicks: u.PlaybackPositionTicks ?? 0,
                LastPlayedDate: u.LastPlayedDate ?? null, Rating: u.Rating ?? null, Likes: u.Likes ?? null
            });
            const after = (await api('GET', `Users/${userId}/Items/${played}`)).body?.UserData ?? {};
            const same = ['Played', 'PlayCount', 'IsFavorite', 'PlaybackPositionTicks', 'LastPlayedDate'].every(k => (after[k] ?? null) === (u[k] ?? null));
            record(name, 'played title user data restored', same ? 'PASS' : 'FAIL', 'api', { status: restored.status, same });
        }
    }

    // ---- Queue
    if (cfg.tv) {
        await row('Queue', 'address typed: on the TV the shell links the Queue only from a title with an open import (QueueStatusLine), and nothing is queued',
            async () => { await page.evaluate(() => { location.hash = '#/catalog/queue'; }); }, { hash: '^#/catalog/queue', selector: '.jfmod-queue, .jfmod-queueEmpty' });
    } else {
        await row('Queue', shell + ': user menu', () => userMenu('Queue'), { hash: '^#/catalog/queue', selector: '.jfmod-queue, .jfmod-queueEmpty' });
    }

    // ---- JellyfinMod settings and the setup wizard
    await row('JellyfinMod settings', cfg.tv ? keys + ': the settings link below the Home rows' : shell + ': user menu', async () => {
        if (cfg.tv) { await tvHome(); await activate(page, cfg, { sel: '[data-jfmod-tv-settings]' }); } else await userMenu('JellyfinMod settings');
    }, { hash: '^#/catalog/settings$|^#/catalog/settings\\?', selector: '#jfmodSettingsPage .jfmod-step, #jfmodSettingsPage .jfmod-check-main section[data-section]' });
    await row('JellyfinMod setup wizard', (cfg.tv ? keys : shell) + ': settings area link "Setup wizard"',
        () => activate(page, cfg, { sel: 'a[href="#/catalog/settings/setup"]' }), { hash: '^#/catalog/settings/setup', selector: '#jfmodSetupPage .jfmod-wizardSection, #jfmodSetupPage h1, #jfmodSetupPage h2' });

    // ---- Jellyfin preferences
    await row('Jellyfin preferences menu', cfg.tv ? keys + ': header user button' : shell + ': user menu Settings', async () => {
        if (cfg.tv) await tvHome();
        await prefsMenu();
    }, { hash: '^#/mypreferencesmenu', selector: '.page:not(.hide) .lnkDisplayPreferences' });
    const PREFS = [
        ['User profile', '.lnkUserProfile', '^#/userprofile', '.page:not(.hide) #txtUserName, .page:not(.hide) .username, .page:not(.hide) form, main form'],
        ['Display preferences', '.lnkDisplayPreferences', '^#/mypreferencesdisplay', '.page:not(.hide) select, main select, .page:not(.hide) .selectContainer, main .MuiFormControl-root, main .MuiSelect-select'],
        ['Home screen preferences', '.lnkHomePreferences', '^#/mypreferenceshome', '.page:not(.hide) select, main select, .page:not(.hide) .selectContainer, main .MuiFormControl-root, main .MuiSelect-select'],
        ['Playback preferences', '.lnkPlaybackPreferences', '^#/mypreferencesplayback', '.page:not(.hide) select, main select, .page:not(.hide) .selectContainer, main .MuiFormControl-root, main .MuiSelect-select'],
        ['Subtitle preferences', '.lnkSubtitlePreferences', '^#/mypreferencessubtitles', '.page:not(.hide) select, main select, .page:not(.hide) .selectContainer, main .MuiFormControl-root, main .MuiSelect-select'],
        ['Controls preferences', '.lnkControlsPreferences', '^#/mypreferencescontrols', '.page:not(.hide) form input, main form input, .page:not(.hide) form .checkboxContainer'],
        ['Quick Connect', '.lnkQuickConnectPreferences', '^#/quickconnect', '.page:not(.hide) #txtQuickConnectCode, main #txtQuickConnectCode, .page:not(.hide) form input']
    ];
    for (const [label, link, route, selector] of PREFS) {
        // Outside the TV the preferences menu leaves Quick Connect to the user menu (checked below).
        if (!cfg.tv && link === '.lnkQuickConnectPreferences') continue;
        if (cfg.mobile && link === '.lnkControlsPreferences') {
            // Upstream's preferences menu renders the Controls link only when !browser.mobile (user/settings/index.tsx).
            record(name, label, 'NOT PRESENT', 'preferences menu', { reason: 'upstream shows no Controls link on a mobile browser' });
            continue;
        }
        await row(label, (cfg.tv ? keys : shell) + ': preferences menu', async () => {
            if (!await page.evaluate(() => location.hash.startsWith('#/mypreferencesmenu'))) {
                if (cfg.tv) await tvHome();
                await prefsMenu();
            }
            await activate(page, cfg, { sel: link, scope: '.page:not(.hide)' });
        }, { hash: route, selector });
        await back();
    }
    if (!cfg.tv) {
        await row('Quick Connect (user menu)', shell + ': user menu', () => userMenu('Quick Connect'), { hash: '^#/quickconnect', selector: '.page:not(.hide) #txtQuickConnectCode, main #txtQuickConnectCode, .page:not(.hide) form input, main form input' });
        await row('Metadata manager', shell + ': user menu', () => userMenu('Metadata Manager'), { hash: '^#/metadata', selector: '.page:not(.hide) .metadataEditorPage, .metadataEditorPage:not(.hide), .page:not(.hide) .editPageSidebar, main .editPageSidebar, .page:not(.hide) .libraryTree' });
    }

    // ---- Sign out and back in
    await row('Sign out', cfg.tv ? keys + ': preferences menu Sign Out' : shell + ': user menu Sign Out', async () => {
        if (cfg.tv) { await tvHome(); await prefsMenu(); await activate(page, cfg, { sel: '.btnLogout', scope: '.page:not(.hide)' }); } else await userMenu('Sign Out');
        const confirm = await poll(() => page.evaluate(() => ({ ok: /login|selectuser/.test(location.hash) || !!document.querySelector('.dialog .btnSubmit, .actionSheet [data-id]') })), { timeout: 15000 });
        return { confirmDialog: confirm.ok && !/login|selectuser/.test(await hash(page)) };
    }, { hash: '#/(login|selectuser|selectserver)', selector: '#txtManualName, .btnManual' }, {
        benignHere: [{ name: 'a GET still in flight with the token Sign Out just revoked (401)', test: f => f.status === 401 && f.method === 'GET' && ['/System/Info', '/Users'].includes(f.path) }]
    });
    await row('Sign back in', cfg.tv ? keys + ': login form' : 'login form', () => signIn(), { hash: '^#/home', selector: '.homePage:not(.hide) .sections .verticalSection, .jfmod-homeHero' });

    // ---- Dashboard
    /** TV: to the Dashboard by keys, the way the Dashboard row goes (Home, the settings link, the Dashboard link). */
    const tvDashboard = async () => {
        await tvHome();
        await activate(page, cfg, { sel: '[data-jfmod-tv-settings]' });
        await poll(() => page.evaluate(() => ({ ok: !!document.querySelector('#jfmodSettingsPage .jfmod-step') })));
        await activate(page, cfg, { sel: 'a[href="#/dashboard"]', scope: '#jfmodSettingsPage' });
        await poll(() => page.evaluate(() => ({ ok: /^#\/dashboard/.test(location.hash) })), { timeout: 20000 });
        await sleep(1500);
    };
    await row('Dashboard', cfg.tv ? keys + ': settings area link "Dashboard"' : shell + ': user menu', async () => {
        if (cfg.tv) {
            await tvDashboard();
        } else await userMenu('Dashboard');
    }, { hash: '^#/dashboard$|^#/dashboard\\?', selector: 'main a[href="#/dashboard/settings"], main .MuiButton-root, main .MuiCard-root', timeout: 25000 });
    const openDashboardLink = async href => {
        // A row that failed on the TV leaves focus wherever it stopped; every Dashboard row starts inside the Dashboard.
        if (cfg.tv && !await page.evaluate(() => location.hash.startsWith('#/dashboard'))) await tvDashboard();
        const visible = await page.evaluate(({ href, VISIBLE }) => {
            const vis = (0, eval)(`(()=>{${VISIBLE};return vis;})()`);
            return [...document.querySelectorAll(`a[href="${href}"]`)].some(vis);
        }, { href, VISIBLE });
        if (!visible && cfg.mobile) {
            // Open the Dashboard's drawer only while it is closed, then wait for the link: pressing Open Menu again on a
            // drawer that was still opening closed it, and the link was then hidden by the closed drawer (P7.S11
            // verification re-run 2; tapping the menu opens the drawer every time on the mod and the stock entry).
            const drawerState = () => page.evaluate(({ href, VISIBLE }) => {
                const vis = (0, eval)(`(()=>{${VISIBLE};return vis;})()`);
                return { link: [...document.querySelectorAll(`a[href="${href}"]`)].some(vis),
                    open: !!document.querySelector('.MuiDrawer-root.MuiModal-root:not([aria-hidden="true"]):not(.MuiModal-hidden)') };
            }, { href, VISIBLE });
            for (let attempt = 0; attempt < 3; attempt++) {
                const now = await drawerState();
                if (now.link) break;
                if (!now.open) await click(page, { sel: 'button[aria-label="Open Menu"]' });
                const shown = await poll(async () => ({ ok: (await drawerState()).link }), { timeout: 5000 });
                if (shown.ok) break;
            }
        }
        const group = { '#/dashboard/libraries': 'Libraries' }[href];
        const inGroup = await page.evaluate(({ href, VISIBLE }) => {
            const vis = (0, eval)(`(()=>{${VISIBLE};return vis;})()`);
            return [...document.querySelectorAll(`a[href="${href}"]`)].some(vis);
        }, { href, VISIBLE });
        // Some Dashboard links sit in a collapsed group of its navigation; open the group the way a user does.
        if (!inGroup && group) await activate(page, cfg, { sel: 'div.MuiListItemButton-root', text: `^\\s*${group}\\s*$` });
        return activate(page, cfg, { sel: `a.MuiListItemButton-root[href="${href}"]` });
    };
    const DASH = [
        ['Dashboard: General', '#/dashboard/settings', '.MuiTextField-root, form input, form select'],
        ['Dashboard: Users', '#/dashboard/users', '.card, .MuiCard-root, a[href*="/dashboard/users/profile"]', 'oleksii'],
        ['Dashboard: Libraries', '#/dashboard/libraries', '.card, .MuiCard-root', 'Movies'],
        ['Dashboard: Plugins', '#/dashboard/plugins', '.card, .MuiCard-root', 'JellyfinMod'],
        ['Dashboard: Scheduled tasks', '#/dashboard/tasks', '.MuiListItemText-root, .listItem, .MuiTypography-root', 'Scan Media Library'],
        ['Dashboard: Logs', '#/dashboard/logs', '.MuiListItemText-root, .listItem, a[href*="/dashboard/logs/"], .MuiTypography-root', '\\.log']
    ];
    for (const [label, href, selector, text] of DASH) {
        await row(label, (cfg.tv ? keys : shell) + ': Dashboard navigation', () => openDashboardLink(href),
            { hash: '^' + href.replace(/[/]/g, '\\/') + '($|\\?)', selector: selector.split(', ').map(s => 'main ' + s).join(', '), text, timeout: 25000 });
        if (label === 'Dashboard: Plugins') {
            await row('Dashboard: Plugins → JellyfinMod', (cfg.tv ? keys : shell) + ': plugin card', async () => {
                await activate(page, cfg, { sel: '.card, .MuiCard-root, a', text: 'JellyfinMod', scope: 'main' });
            }, { hash: '^#/dashboard/plugins/[0-9a-f-]{32,}', selector: 'main h1, main h2, main .MuiTypography-root', text: 'JellyfinMod', timeout: 25000 });
            await back();
        }
    }
    if (cfg.tv) {
        // The TV's legacy header and preferences menu do not link the metadata manager; the Dashboard's navigation is
        // the only place left to look for it, and it is not there either, so the row is typed and says so.
        // Only a link the user can see counts: a hidden drawer's copy is not a way there.
        const inDashboard = await page.evaluate(VISIBLE_SRC => {
            const vis = (0, eval)(`(()=>{${VISIBLE_SRC};return vis;})()`);
            return [...document.querySelectorAll('a[href="#/metadata"]')].some(vis);
        }, VISIBLE);
        await row('Metadata manager', inDashboard ? keys + ': link' : 'address typed: the TV shell (legacy header, preferences menu, settings area, Dashboard navigation) has no link to it',
            async () => {
                if (inDashboard) await activate(page, cfg, { sel: 'a[href="#/metadata"]' });
                else await page.evaluate(() => { location.hash = '#/metadata'; });
            }, { hash: '^#/metadata', selector: '.page:not(.hide) .metadataEditorPage, .metadataEditorPage:not(.hide), .page:not(.hide) .editPageSidebar, main .editPageSidebar, .page:not(.hide) .libraryTree' });
    }

    // ---- stock-for-now library types: present only if the instance has such a library
    const views = (await api('GET', `UserViews?userId=${userId}`)).body?.Items ?? [];
    for (const [label, types] of [['Music', ['music']], ['Live TV', ['livetv']], ['Books', ['books']], ['Photos and home videos', ['photos', 'homevideos']],
        ['Playlists', ['playlists']], ['Collections (boxsets library)', ['boxsets']], ['Music videos', ['musicvideos']], ['Mixed folders', ['folders', 'mixed']]]) {
        const present = views.filter(v => types.includes(v.CollectionType));
        if (!present.length) record(name, `Stock for now: ${label}`, 'NOT PRESENT', 'user views', { reason: 'no library of this type on the instance' });
        else record(name, `Stock for now: ${label}`, 'NOT VERIFIED', 'user views', { reason: 'library present but this sweep has no step for it', libraries: present.length });
    }

    // ---- leave nothing behind in the profile
    await page.evaluate(() => localStorage.removeItem('layout'));
    const leftover = await page.evaluate(() => localStorage.getItem('layout'));
    record(name, 'layout override removed', leftover === null ? 'PASS' : 'FAIL', 'localStorage', { layout: leftover });
    await context.close();
}

const started = Date.now();
const timings = {};
try {
    for (const name of only) {
        const t0 = Date.now();
        try {
            await sweepLayout(name);
        } catch (error) {
            record(name, 'layout run', 'NOT VERIFIED', 'setup', { error: String(error.message).split('\n')[0] });
        }
        timings[name] = Math.round((Date.now() - t0) / 100) / 10;
    }
} finally {
    await browser.close();
}
const counts = results.reduce((all, r) => ({ ...all, [r.verdict]: (all[r.verdict] ?? 0) + 1 }), {});
const summary = { runner: 'replacement-sweep', browser: { tier, version: browserVersion }, bundleExpectation: 'mod entry at /web/', counts, timings: { ...timings, total: Math.round((Date.now() - started) / 100) / 10 }, results };
if (outFile) writeFileSync(outFile, JSON.stringify(summary, null, 1) + '\n');
console.log(JSON.stringify({ counts, timings: summary.timings }));
process.exitCode = counts.FAIL || counts['NOT VERIFIED'] ? 1 : 0;
