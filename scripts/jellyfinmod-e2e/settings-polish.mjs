/* eslint-disable compat/compat, no-restricted-globals, sonarjs/cognitive-complexity -- a Node acceptance runner, not shipped code */
/* global window, document, ApiClient, location, localStorage, getComputedStyle */
// Settings polish acceptance (fix/settings-polish, 2026-10-09), on the settings area (/catalog/settings) and on the Dashboard
// plugin page (Dashboard -> Plugins -> JellyfinMod):
//
//   JELLYFINMOD_TEST_URL=http://127.0.0.1:<port>/ JELLYFINMOD_BROWSER=chromium|chrome JELLYFINMOD_SHOTS=<dir> \
//   JELLYFINMOD_TMDB_RESTORE="<path>/configure-tmdb.sh <env name>" node settings-polish.mjs
//
// Runs on a local environment (alpha..echo, ServerName jellyfinmod-<name>) or a leased Pi instance. Signs in as oleksii with an
// empty password. Checks, on both pages:
//   1 a Test icon: untested glyph, spinner and "Testing…" while a real test runs, green tick after a real pass, red cross after a
//     real fail (a Torznab server of its own over HTTP, switched to 500), the date only in the tooltip, hover animation
//     (scale 1.08 over 140 ms, none under reduced motion);
//   2 the TMDB token: a Save at the end of its input writes just the token (one PATCH), then starts the Test (one POST, in that
//     order), which fails for a made-up token and passes again for the real one; the token is never in a response or on the page;
//   3 the Dashboard's side-by-side fields start their inputs on one line in every section and layout;
//   4 the number fields' spin arrows keep 4.5:1 on the field in all six colour schemes, hovered and focused;
//   5 the diagnostics lists scroll in a focusable area of fixed height, with a time on every entry, newest first.
// Fixtures: one JellyfinMod-prefixed indexer (removed at the end) and, for 5, orphan/conflict rows injected at the HTTP boundary
// (layout only: the plugin's own fields are proven by the real-host smoke suite). It leaves the TMDB token as it found it when
// JELLYFINMOD_TMDB_RESTORE names the script that puts the real one back.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

const testUrl = new URL(process.env.JELLYFINMOD_TEST_URL ?? (() => { throw new Error('JELLYFINMOD_TEST_URL is required'); })());
const LOCAL = ['alpha', 'bravo', 'charlie', 'delta', 'echo'];
const isLocal = ['127.0.0.1', 'localhost'].includes(testUrl.hostname) && ['8096', '9096', '10096', '11096', '12096'].includes(testUrl.port);
if (!isLocal && !['18096', '28096', '48096', '58096'].includes(testUrl.port)) throw new Error('Runs on the isolated instances only');
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
const shots = process.env.JELLYFINMOD_SHOTS ?? (() => { throw new Error('JELLYFINMOD_SHOTS is required'); })();
mkdirSync(shots, { recursive: true });
const base = new URL('/web/', testUrl).href;
const only = (process.env.JELLYFINMOD_POLISH_LAYOUTS ?? 'desktop,mobile,tv1080,tv720').split(',');
const LAYOUTS = {
    desktop: { viewport: { width: 1440, height: 900 } },
    mobile: {
        viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
    },
    tv1080: { viewport: { width: 1920, height: 1080 }, tv: true },
    tv720: { viewport: { width: 1280, height: 720 }, tv: true }
};
const THEMES = ['light', 'appletv', 'blueradiance', 'purplehaze', 'wmc', 'dark'];
const DASH_SECTIONS = ['discovery', 'client', 'indexers', 'profiles', 'grabbing', 'import', 'retention', 'automation', 'interface', 'diagnostics'];
// The token flow replaces the TMDB token with a made-up one; the script that puts the real one back is required up front.
const tmdbRestore = process.env.JELLYFINMOD_TMDB_RESTORE ?? (() => { throw new Error('JELLYFINMOD_TMDB_RESTORE ("<path>/configure-tmdb.sh <env name>") is required: the run replaces the TMDB token and must put it back'); })();
const restoreToken = () => { const [script, ...args] = tmdbRestore.split(' '); execFileSync(script, args, { stdio: 'ignore' }); };
const FIXTURE = 'JellyfinMod Polish Indexer';
const JUNK = 'jfmod-polish-junk-' + Date.now().toString(16);

const results = [];
const record = (layout, check, ok, detail) => {
    results.push({ layout, check, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'} [${tier}/${layout}] ${check}${detail === undefined ? '' : ' :: ' + JSON.stringify(detail).slice(0, 700)}`);
};

// ---- a Torznab server of the runner's own: a real HTTP boundary the plugin's Test calls ----
const CAPS = `<?xml version="1.0" encoding="UTF-8"?>
<caps><server title="JellyfinMod polish"/><limits max="100" default="100"/>
<searching><search available="yes" supportedParams="q"/><tv-search available="yes" supportedParams="q,season,ep"/><movie-search available="yes" supportedParams="q,imdbid,tmdbid"/></searching>
<categories><category id="2000" name="Movies"><subcat id="2040" name="Movies/HD"/></category><category id="5000" name="TV"><subcat id="5040" name="TV/HD"/></category></categories></caps>`;
const torznab = { fault: 'ok', delayMs: 0, calls: 0 };
const server = createServer((request, response) => {
    torznab.calls += 1;
    setTimeout(() => {
        if (torznab.fault === '500') { response.writeHead(500); response.end(); return; }
        response.writeHead(200, { 'Content-Type': 'application/xml' });
        response.end(CAPS);
    }, torznab.delayMs);
});
await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
const torznabHost = process.env.JELLYFINMOD_TORZNAB_HOST ?? 'host.docker.internal';
const torznabUrl = `http://${torznabHost}:${server.address().port}/api`;

// ---- a minimal PNG reader (8-bit, not interlaced) to read the pixels of a screenshot ----
const readPng = buffer => {
    let at = 8;
    let width = 0; let height = 0; let depth = 0; let colour = 0;
    const data = [];
    while (at < buffer.length) {
        const length = buffer.readUInt32BE(at);
        const type = buffer.toString('ascii', at + 4, at + 8);
        if (type === 'IHDR') { width = buffer.readUInt32BE(at + 8); height = buffer.readUInt32BE(at + 12); depth = buffer[at + 16]; colour = buffer[at + 17]; }
        if (type === 'IDAT') data.push(buffer.subarray(at + 8, at + 8 + length));
        at += 12 + length;
    }
    if (depth !== 8 || ![2, 6].includes(colour)) throw new Error(`unsupported PNG ${depth}/${colour}`);
    const bpp = colour === 6 ? 4 : 3;
    const raw = inflateSync(Buffer.concat(data));
    const stride = width * bpp;
    const pixels = Buffer.alloc(stride * height);
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)];
        for (let x = 0; x < stride; x++) {
            const value = raw[y * (stride + 1) + 1 + x];
            const left = x >= bpp ? pixels[y * stride + x - bpp] : 0;
            const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
            const upLeft = y > 0 && x >= bpp ? pixels[(y - 1) * stride + x - bpp] : 0;
            let out = value;
            if (filter === 1) out = value + left;
            else if (filter === 2) out = value + up;
            else if (filter === 3) out = value + ((left + up) >> 1);
            else if (filter === 4) {
                const p = left + up - upLeft;
                const pa = Math.abs(p - left); const pb = Math.abs(p - up); const pc = Math.abs(p - upLeft);
                out = value + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
            }
            pixels[y * stride + x] = out & 255;
        }
    }
    return { width, height, at: (x, y) => [pixels[y * stride + x * bpp], pixels[y * stride + x * bpp + 1], pixels[y * stride + x * bpp + 2]] };
};
const luminance = ([r, g, b]) => {
    const lin = v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const contrast = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
};

const browser = await chromium.launch(tier === 'chrome' ? { headless: true, channel: 'chrome' } : { headless: true });
console.log('browser', tier, browser.version());

const info = await (await fetch(new URL('/System/Info/Public', testUrl))).json();
if (isLocal && !LOCAL.some(name => info.ServerName === `jellyfinmod-${name}`)) throw new Error(`ServerName ${info.ServerName} is not a JellyfinMod local environment`);

async function signIn(page) {
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.ApiClient, undefined, { timeout: 30000 });
    await page.waitForFunction(() => {
        try { return !!ApiClient.getCurrentUserId() || /login|selectuser|selectserver/.test(location.hash); } catch { return false; }
    }, undefined, { timeout: 30000 });
    if (await page.evaluate(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } })) return;
    const field = page.locator('#txtManualName');
    if (!await field.isVisible().catch(() => false)) {
        const chooser = page.locator('.btnManual').first();
        if (await chooser.count()) await chooser.evaluate(node => node.click());
        await field.waitFor({ state: 'visible', timeout: 15000 });
    }
    await field.fill('oleksii');
    await page.waitForTimeout(1500);
    await field.fill('oleksii');
    await page.locator('button:visible').filter({ hasText: 'Sign In' }).first().click();
    await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } }, undefined, { timeout: 30000 });
    await page.waitForFunction(() => location.hash.startsWith('#/home'), undefined, { timeout: 30000 });
    await page.waitForTimeout(1500);
}

const api = (page, method, path, body) => page.evaluate(async ({ method: m, path: p, body: b }) => {
    try {
        return await ApiClient.ajax({ type: m, url: ApiClient.getUrl('JellyfinMod/' + p), dataType: 'json', contentType: 'application/json', data: b === undefined ? undefined : JSON.stringify(b) });
    } catch (error) {
        return { __error: error?.status ?? String(error) };
    }
}, { method, path, body });

// ---- the two surfaces ----
const surfaces = {
    settings: {
        label: 'settings area',
        open: async (page, section) => {
            await page.evaluate(id => { location.hash = '#/catalog/settings?section=' + id; }, section);
            await page.locator(`.jfmod-check-section[data-section="${section}"]`).waitFor({ state: 'visible', timeout: 30000 });
            await page.waitForTimeout(600);
        },
        row: (page, id) => page.locator(`.jfmod-brow[data-indexer="${id}"]`),
        tokenInput: page => page.locator('#jfmodTmdbToken')
    },
    dashboard: {
        label: 'Dashboard page',
        open: async (page, section, fresh) => {
            if (fresh || !page.url().includes('configurationpage')) {
                await page.goto(base + '#/dashboard/plugins', { waitUntil: 'domcontentloaded' });
                await page.waitForTimeout(1500);
                await page.evaluate(() => { location.hash = '#/configurationpage?name=JellyfinMod'; });
                await page.waitForFunction(() => document.querySelector('#ReclaimAfterDays')?.value !== '', undefined, { timeout: 30000 });
            }
            // A narrow page (and the TV at 1280) swaps the rail for a picker.
            const picker = page.locator('#JfmodSectionPicker');
            await page.waitForFunction(() => document.querySelector('#JfmodSectionPicker')?.getBoundingClientRect().width > 0 ||
                document.querySelector('.jfmod-step')?.getBoundingClientRect().width > 0, undefined, { timeout: 30000 });
            if (await picker.isVisible().catch(() => false)) await picker.selectOption(section);
            else await page.locator(`.jfmod-step[data-section="${section}"]`).click();
            await page.locator(`.jfmod-check-section[data-section="${section}"]`).waitFor({ state: 'visible', timeout: 30000 });
            await page.waitForTimeout(600);
        },
        row: (page, id) => page.locator(`#IndexerList [data-indexer="${id}"]`),
        tokenInput: page => page.locator('#TmdbReadAccessToken')
    }
};
const testButton = (surface, page, id) => surface.row(page, id).locator('[data-row-action="test"]');
const testState = button => button.getAttribute('data-test-state');
const pillText = (surface, page, id) => surface.row(page, id).locator('.jfmod-state').first().innerText();
const tooltipOf = async (page, button) => {
    // Leave and enter again, so the tooltip opens on the pointer whatever had the pointer or the focus before.
    await page.mouse.move(5, 5);
    await page.waitForTimeout(250);
    await button.hover();
    await page.waitForTimeout(700);
    const title = await button.getAttribute('title');
    if (title) return title;
    return (await page.locator('[role="tooltip"]').last().innerText().catch(() => '')) || '';
};
const reloadSection = (surface, page, section) => (surface === surfaces.dashboard ? page.evaluate(() => { location.hash = '#/dashboard/plugins'; }).then(() => page.waitForTimeout(600)).then(() => surface.open(page, section)) : surface.open(page, section));

async function indexerFlow(page, surfaceKey, id, name, first) {
    const surface = surfaces[surfaceKey];
    const tag = `[${surface.label}]`;
    await surface.open(page, 'indexers');
    const button = testButton(surface, page, id);
    await button.waitFor({ state: 'visible', timeout: 30000 });
    // 1 untested
    const box = await button.boundingBox();
    // The second page sees what the first page's tests left on the server: the state follows the record, not the page.
    record('desktop', `${tag} the Test icon ${first ? 'of an untested indexer is the plain glyph' : 'shows what the server remembers'}, named after its row, at least 40 px`,
        await testState(button) === (first ? 'idle' : 'ok') && await surface.row(page, id).locator('.jfmod-testmark').count() === 0 && await surface.row(page, id).locator('.jfmod-testsig').count() === 1 &&
        (await button.getAttribute('aria-label')) === `Test ${name}` && box.width >= 39.5 && box.height >= 39.5, { state: await testState(button), box });
    // 2 a real pass, slowly, so the spinner can be seen
    torznab.fault = 'ok';
    torznab.delayMs = 1800;
    await button.click();
    await page.waitForTimeout(500);
    const spinning = await page.evaluate(({ rowId, dash }) => {
        const row = document.querySelector(dash ? `#IndexerList [data-indexer="${rowId}"]` : `.jfmod-brow[data-indexer="${rowId}"]`);
        const button = row.querySelector('[data-row-action="test"]');
        const needle = button.querySelector('.jfmod-testsig-needle');
        const live = dash ? document.querySelector('#JfmodLive') : row.querySelector('[aria-live="polite"]');
        return {
            state: button.getAttribute('data-test-state'), animation: getComputedStyle(needle).animationName,
            pill: row.querySelector('.jfmod-state')?.innerText.trim(), live: live?.textContent.trim(), liveAttr: live?.getAttribute('aria-live'),
            corner: !!button.querySelector('.jfmod-testmark')
        };
    }, { rowId: id, dash: surfaceKey === 'dashboard' });
    record('desktop', `${tag} while it runs the needle sweeps across the arcs and the status reads "Testing…", said politely`,
        spinning.state === 'testing' && /jfmod-testsweep/.test(spinning.animation) && !spinning.corner && /Testing/.test(spinning.pill) && /Testing/.test(spinning.live ?? spinning.pill) && spinning.liveAttr === 'polite', spinning);
    console.log('  shot', await shot(page, `${surfaceKey}-indexer-testing`));
    await page.waitForFunction(({ rowId, dash }) => {
        const row = document.querySelector(dash ? `#IndexerList [data-indexer="${rowId}"]` : `.jfmod-brow[data-indexer="${rowId}"]`);
        return row?.querySelector('[data-row-action="test"]')?.getAttribute('data-test-state') === 'ok';
    }, { rowId: id, dash: surfaceKey === 'dashboard' }, { timeout: 30000 });
    const passed = await page.evaluate(({ rowId, dash }) => {
        document.activeElement?.blur?.();
        const row = document.querySelector(dash ? `#IndexerList [data-indexer="${rowId}"]` : `.jfmod-brow[data-indexer="${rowId}"]`);
        const glyph = row.querySelector('.jfmod-testsig');
        const needle = row.querySelector('.jfmod-testsig-needle');
        return { glyphColour: getComputedStyle(glyph).color, needle: getComputedStyle(needle).transform, corner: !!row.querySelector('.jfmod-testmark'), pill: row.querySelector('.jfmod-state')?.innerText.trim(), text: row.innerText };
    }, { rowId: id, dash: surfaceKey === 'dashboard' });
    const tipPass = await tooltipOf(page, button);
    record('desktop', `${tag} after a real pass the whole glyph is green with its needle up; there is no corner mark; the status says "verified" without a date; the date is in the tooltip`,
        passed.glyphColour === 'rgb(129, 199, 132)' && passed.needle === 'none' && !passed.corner && /^verified$/.test(passed.pill) &&
        !/\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}/.test(passed.text) && /passed/.test(tipPass) && /last checked/.test(tipPass) && /\d/.test(tipPass), { passed, tipPass });
    console.log('  shot', await shot(page, `${surfaceKey}-indexer-passed`));
    // 3 a real fail after a pass
    torznab.fault = '500';
    torznab.delayMs = 0;
    await testButton(surface, page, id).click();
    await page.waitForFunction(({ rowId, dash }) => {
        const row = document.querySelector(dash ? `#IndexerList [data-indexer="${rowId}"]` : `.jfmod-brow[data-indexer="${rowId}"]`);
        return row?.querySelector('[data-row-action="test"]')?.getAttribute('data-test-state') === 'fail';
    }, { rowId: id, dash: surfaceKey === 'dashboard' }, { timeout: 30000 });
    const failed = await page.evaluate(({ rowId, dash }) => {
        document.activeElement?.blur?.();
        const row = document.querySelector(dash ? `#IndexerList [data-indexer="${rowId}"]` : `.jfmod-brow[data-indexer="${rowId}"]`);
        const glyph = row.querySelector('.jfmod-testsig');
        const needle = row.querySelector('.jfmod-testsig-needle');
        return { glyphColour: getComputedStyle(glyph).color, needle: getComputedStyle(needle).transform, corner: !!row.querySelector('.jfmod-testmark'), pill: row.querySelector('.jfmod-state')?.innerText.trim() };
    }, { rowId: id, dash: surfaceKey === 'dashboard' });
    const tipFail = await tooltipOf(page, testButton(surface, page, id));
    record('desktop', `${tag} a test that fails after a pass turns the whole glyph red and drops its needle; the status says it failed; the reason is in the tooltip`,
        failed.glyphColour === 'rgb(255, 123, 114)' && /^matrix\(0\.34/.test(failed.needle) && !failed.corner && /failed/.test(failed.pill) && /failed/.test(tipFail), { failed, tipFail });
    console.log('  shot', await shot(page, `${surfaceKey}-indexer-failed`));
    // 4 hover: scale and duration, none under reduced motion
    const hover = async () => {
        // A clicked icon keeps the focus (and its focus fill); the hover is what an unfocused one does.
        await page.evaluate(() => document.activeElement?.blur?.());
        await page.mouse.move(5, 5);
        await page.waitForTimeout(300);
        const target = testButton(surface, page, id);
        await target.hover();
        await page.waitForTimeout(400);
        return target.evaluate(node => ({ transform: getComputedStyle(node).transform, duration: getComputedStyle(node).transitionDuration, property: getComputedStyle(node).transitionProperty }));
    };
    const normal = await hover();
    record('desktop', `${tag} hover scales the icon to about 1.08 over 140 ms (transform and background colour only)`,
        /matrix\(1\.0\d*,/.test(normal.transform) && Math.abs(Number(normal.transform.match(/matrix\(([\d.]+)/)[1]) - 1.08) < 0.005 && /0\.14s/.test(normal.duration) && /transform/.test(normal.property), normal);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const reduced = await hover();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    record('desktop', `${tag} under reduced motion the icon neither scales nor animates`, reduced.transform === 'none' && /^0s/.test(reduced.duration), reduced);
    await page.mouse.move(5, 5);
    // 5 a pass again
    torznab.fault = 'ok';
    await testButton(surface, page, id).click();
    await page.waitForFunction(({ rowId, dash }) => {
        const row = document.querySelector(dash ? `#IndexerList [data-indexer="${rowId}"]` : `.jfmod-brow[data-indexer="${rowId}"]`);
        return row?.querySelector('[data-row-action="test"]')?.getAttribute('data-test-state') === 'ok';
    }, { rowId: id, dash: surfaceKey === 'dashboard' }, { timeout: 30000 });
    record('desktop', `${tag} the next pass brings the tick back`, true);
}

const shotCount = {};
async function shot(page, name) {
    shotCount[name] = (shotCount[name] ?? 0) + 1;
    const file = join(shots, `${tier}-${name}.png`);
    await page.screenshot({ path: file });
    return file;
}

async function tokenFlow(page, surfaceKey) {
    const surface = surfaces[surfaceKey];
    const tag = `[${surface.label}]`;
    const requests = [];
    const bodies = [];
    const onRequest = request => {
        const url = new URL(request.url());
        if (/\/JellyfinMod\/Settings\/Discovery/.test(url.pathname) && request.method() !== 'GET') requests.push({ method: request.method(), path: url.pathname.replace(/^.*Settings\//, ''), body: request.postData() ?? '' });
    };
    const onResponse = async response => { if (/\/JellyfinMod\//.test(response.url())) bodies.push(await response.text().catch(() => '')); };
    page.on('request', onRequest);
    page.on('response', onResponse);
    await surface.open(page, 'discovery', true);
    const slot = surfaceKey === 'dashboard' ? page.locator('[data-secret-slot="TmdbReadAccessToken"]') : page.locator('.jfmod-check-section[data-section="discovery"] .jfmod-secret').first();
    const testIcon = slot.locator('[data-secret-action="test"]');
    // the real token's test passes (when the environment has one)
    {
        const before = await testState(testIcon);
        await testIcon.click();
        await page.waitForTimeout(150);
        const during = await testState(testIcon);
        await page.waitForFunction(el => el && el.getAttribute('data-test-state') === 'ok', await testIcon.elementHandle(), { timeout: 30000 }).catch(() => undefined);
        const after = await testState(slot.locator('[data-secret-action="test"]'));
        record('desktop', `${tag} the token's Test icon spins, then shows a green tick for the real token`, during === 'testing' && after === 'ok', { before, during, after });
        console.log('  shot', await shot(page, `${surfaceKey}-token-passed`));
    }
    // Replace → type → Save
    await slot.locator('[data-secret-action="replace"]').click();
    const input = surface.tokenInput(page);
    await input.waitFor({ state: 'visible', timeout: 10000 });
    // One field: Replace swaps the Configured box for the input (Save and Keep at its end); Keep swaps it back.
    const visibleBox = () => slot.evaluate(node => { const row = node.querySelector('.jfmod-secret-row'); return !!row && row.getBoundingClientRect().width > 0; });
    const editing = { box: await visibleBox(), save: await slot.locator('[data-secret-action="save"]').isVisible(), keep: await slot.locator('[data-secret-action="keep"]').isVisible() };
    await slot.locator('[data-secret-action="keep"]').click();
    await page.waitForTimeout(300);
    const kept = { box: await visibleBox(), input: await input.isVisible().catch(() => false) };
    record('desktop', `${tag} the token is one field: Replace turns the box into the input with Save and Keep at its end; Keep turns it back`,
        !editing.box && editing.save && editing.keep && kept.box && !kept.input, { editing, kept });
    await slot.locator('[data-secret-action="replace"]').click();
    await input.waitFor({ state: 'visible', timeout: 10000 });
    const save = slot.locator('[data-secret-action="save"]');
    await save.waitFor({ state: 'visible', timeout: 10000 });
    const emptyRefused = await save.getAttribute('aria-disabled');
    const saveBox = await save.boundingBox();
    const inputBox = await input.boundingBox();
    // One field: the Save sits inside it, at its right end, level with the text.
    const fieldBox = await input.evaluate(node => { const field = node.closest('.jfmod-secret-inputrow, .MuiFilledInput-root'); const r = field.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
    record('desktop', `${tag} the token's field holds a round Save inside, at its right end (named, at least 40 px, level with the text), refused while it is empty`,
        emptyRefused === 'true' && /Save/.test(await save.getAttribute('aria-label')) && saveBox.width >= 39.5 &&
        saveBox.x >= fieldBox.x && saveBox.x + saveBox.width <= fieldBox.x + fieldBox.width + 1 && saveBox.x >= inputBox.x + inputBox.width - 2 &&
        Math.abs((saveBox.y + saveBox.height / 2) - (fieldBox.y + fieldBox.height / 2)) < 8, { emptyRefused, saveBox, inputBox, fieldBox });
    await input.fill(JUNK);
    record('desktop', `${tag} Save is ready once something is typed`, (await save.getAttribute('aria-disabled')) !== 'true');
    console.log('  shot', await shot(page, `${surfaceKey}-token-save`));
    requests.length = 0;
    await save.click();
    const seen = [];
    for (let i = 0; i < 40; i++) {
        const now = await testState(slot.locator('[data-secret-action="test"]')).catch(() => null);
        if (now && seen[seen.length - 1] !== now) seen.push(now);
        if (now === 'fail') break;
        await page.waitForTimeout(150);
    }
    record('desktop', `${tag} Save writes just the token (one PATCH) and then starts the Test (one POST, after it): the icon spins, then shows a red cross for a made-up token`,
        requests.length === 2 && requests[0].method === 'PATCH' && requests[1].method === 'POST' && /Test$/.test(requests[1].path) &&
        Object.keys(JSON.parse(requests[0].body)).sort().join() === 'revision,token' && seen.includes('fail') && (seen.includes('testing') || seen.length >= 1), { requests: requests.map(r => r.method + ' ' + r.path), seen });
    console.log('  shot', await shot(page, `${surfaceKey}-token-failed`));
    // The box was drawn again after the save: the focus that sat on the Save or the input has gone to the Test icon.
    const focusAfter = await page.evaluate(() => document.activeElement?.dataset?.secretAction ?? document.activeElement?.tagName);
    record('desktop', `${tag} after the save the focus is on the Test icon, not lost to the page`, focusAfter === 'test', focusAfter);
    const configured = await slot.innerText();
    const pageText = await page.evaluate(() => document.body.innerText);
    record('desktop', `${tag} the saved token reads Configured again and is nowhere on the page or in a response`,
        /Configured/.test(configured) && !pageText.includes(JUNK) && !bodies.some(body => body.includes(JUNK)), { responses: bodies.length });
    page.off('request', onRequest);
    page.off('response', onResponse);
}

async function alignmentFlow(browserContextFactory) {
    for (const name of only) {
        const layout = LAYOUTS[name];
        const { context, page } = await browserContextFactory(layout);
        try {
            const sectionsChecked = [];
            for (const section of DASH_SECTIONS) {
                await surfaces.dashboard.open(page, section);
                const groups = await page.evaluate(id => [...document.querySelectorAll(`.jfmod-check-section[data-section="${id}"] .jfmod-two, .jfmod-check-section[data-section="${id}"] .jfmod-three`)]
                    .filter(group => group.getBoundingClientRect().width > 0).map(group => {
                        // the input, select or (for a secret) its Configured box or its field, whichever the cell shows
                        const cells = [...group.children].map(cell => [...cell.querySelectorAll('.jfmod-secret-inputrow, input:not([type="checkbox"]), select, .jfmod-secret-row')].find(el => el.getBoundingClientRect().width > 0)).filter(Boolean);
                        const labels = [...group.children].map(cell => [...cell.children].find(el => /inputLabel|selectLabel/.test(el.className))).filter(Boolean);
                        const columns = getComputedStyle(group).gridTemplateColumns.split(' ').length;
                        return { columns, tops: cells.map(el => Math.round(el.getBoundingClientRect().top)), labelTops: labels.map(el => Math.round(el.getBoundingClientRect().top)), count: cells.length };
                    }), section);
                const misaligned = groups.filter(group => group.columns > 1 && group.count > 1 && (Math.max(...group.tops) - Math.min(...group.tops) > 1 ||
                    Math.max(...group.labelTops) - Math.min(...group.labelTops) > 1));
                sectionsChecked.push(`${section}:${groups.length}`);
                if (misaligned.length) record(name, `Dashboard ${section}: fields side by side start their inputs on one line`, false, misaligned);
                if (section === 'import') console.log('  shot', await shot(page, `dashboard-import-${name}`));
            }
            record(name, `Dashboard: in every section the fields side by side start their inputs on one line (${sectionsChecked.join(' ')})`,
                !results.some(r => r.layout === name && !r.ok && /start their inputs/.test(r.check)));
        } finally {
            await context.close();
        }
    }
}

async function spinnerFlow(page, surfaceKey) {
    const surface = surfaces[surfaceKey];
    await surface.open(page, 'import');
    const selector = surfaceKey === 'dashboard' ? '#ImportPollSeconds' : '.jfmod-check-section[data-section="import"] input[type="number"]';
    const input = page.locator(selector).first();
    await input.scrollIntoViewIfNeeded();
    const worst = {};
    for (const theme of THEMES) {
        await page.evaluate(id => document.documentElement.setAttribute('data-theme', id), theme);
        await page.waitForTimeout(300);
        for (const state of ['hover', 'focus']) {
            await page.mouse.move(5, 5);
            const box = await input.boundingBox();
            if (state === 'hover') await page.mouse.move(box.x + box.width - 9, box.y + box.height / 2);
            else { await input.focus(); await page.mouse.move(5, 5); }
            await page.waitForTimeout(250);
            const png = readPng(await page.screenshot({ clip: { x: Math.floor(box.x), y: Math.floor(box.y), width: Math.ceil(box.width), height: Math.ceil(box.height) } }));
            // the field's own colour: its left padding; the arrows: the right 22 px
            const bg = png.at(3, Math.floor(png.height / 2));
            let best = 1;
            for (let x = png.width - 22; x < png.width - 1; x++) for (let y = 3; y < png.height - 3; y++) best = Math.max(best, contrast(png.at(x, y), bg));
            worst[`${theme}/${state}`] = Number(best.toFixed(2));
        }
        // what the arrows were before the fix: the browser's default scheme for the same field
        if (theme === 'dark') {
            await input.evaluate(node => { node.style.colorScheme = 'normal'; });
            await page.mouse.move(5, 5);
            const box = await input.boundingBox();
            await page.mouse.move(box.x + box.width - 9, box.y + box.height / 2);
            await page.waitForTimeout(250);
            const png = readPng(await page.screenshot({ clip: { x: Math.floor(box.x), y: Math.floor(box.y), width: Math.ceil(box.width), height: Math.ceil(box.height) } }));
            const bg = png.at(3, Math.floor(png.height / 2));
            let darkest = null;
            for (let x = png.width - 22; x < png.width - 1; x++) for (let y = 3; y < png.height - 3; y++) if (!darkest || luminance(png.at(x, y)) < luminance(darkest)) darkest = png.at(x, y);
            const arrow = contrast(darkest, bg);
            worst['dark/before-fix(normal scheme, the darkest arrow pixel against the field)'] = Number(arrow.toFixed(2));
            await input.evaluate(node => { node.style.colorScheme = ''; });
        }
    }
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    const failing = Object.entries(worst).filter(([key, value]) => !/before-fix/.test(key) && value < 4.5);
    record('desktop', `[${surface.label}] the number fields' spin arrows keep 4.5:1 on the field, hovered and focused, in all six colour schemes`, failing.length === 0, worst);
}

async function diagnosticsFlow(page, surfaceKey, layoutName, tv) {
    const surface = surfaces[surfaceKey];
    const now = Date.now();
    const orphans = Array.from({ length: 30 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, title: `JellyfinMod Polish Orphan ${i + 1}`, mediaType: 'movie', tmdbId: 9000 + i, targetLibraryId: null, state: 'none', addedAt: new Date(now - i * 3600e3 * 5).toISOString() }));
    const conflicts = Array.from({ length: 12 }, (_, i) => ({ id: `10000000-0000-4000-8000-${String(i).padStart(12, '0')}`, entryId: `20000000-0000-4000-8000-${String(i).padStart(12, '0')}`, title: `JellyfinMod Polish Show ${i + 1}`, jellyfinItemId: `30000000-0000-4000-8000-${String(i).padStart(12, '0')}`, trackedTmdbId: 1, trackedSeasonNumber: 1, trackedEpisodeNumber: i + 1, observedTmdbId: 2, observedSeasonNumber: 1, observedEpisodeNumber: i + 2, detectedAt: new Date(now - i * 3600e3 * 3).toISOString() }));
    await page.route('**/JellyfinMod/Reconciliation/Orphans', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(orphans.slice().reverse()) }));
    await page.route('**/JellyfinMod/Reconciliation/Conflicts', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(conflicts.slice().reverse()) }));
    try {
        if (surfaceKey === 'dashboard') await page.goto(base + '#/dashboard/plugins', { waitUntil: 'domcontentloaded' });
        else await page.goto(base + '#/home', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(800);
        await page.reload();
        await page.waitForTimeout(1500);
        await surface.open(page, 'diagnostics');
        const area = page.locator(surfaceKey === 'dashboard' ? '#OrphanedEntries' : '.jfmod-scrolllist[aria-label^="Entries in removed"]');
        await area.scrollIntoViewIfNeeded();
        const facts = await area.evaluate(node => {
            const s = getComputedStyle(node);
            const times = [...node.querySelectorAll('time.jfmod-when')];
            const rows = [...node.querySelectorAll('.jfmod-brow')];
            const stamps = times.map(time => Date.parse(time.getAttribute('datetime')));
            return {
                overflow: s.overflowY, client: node.clientHeight, scroll: node.scrollHeight, fontSize: parseFloat(s.fontSize), tab: node.tabIndex, role: node.getAttribute('role'),
                focusable: node.classList.contains('focusable'), rows: rows.length, times: times.length, newestFirst: stamps.every((v, i) => i === 0 || stamps[i - 1] >= v),
                timeText: times[0]?.textContent, timeColour: getComputedStyle(times[0]).color, timeSize: parseFloat(getComputedStyle(times[0]).fontSize)
            };
        });
        record(layoutName, `[${surface.label}] orphans: a fixed-height scrolling area (focusable region) with a time on every entry, newest first`,
            facts.overflow === 'auto' && facts.scroll > facts.client && facts.client <= 17.1 * facts.fontSize && facts.tab === 0 && facts.role === 'region' && facts.focusable &&
            facts.rows === 30 && facts.times === 30 && facts.newestFirst && /\d/.test(facts.timeText ?? '') && facts.timeSize < facts.fontSize, facts);
        // the keyboard / remote scrolls it and then lets go; the ring shows
        await area.focus();
        const ring = await area.evaluate(node => { const s = getComputedStyle(node); return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) }; });
        record(layoutName, `[${surface.label}] the scrolling area shows a focus ring when focused`, ring.style !== 'none' && ring.width >= 1, ring);
        const start = await area.evaluate(node => node.scrollTop);
        for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
        const moved = await area.evaluate(node => node.scrollTop);
        for (let i = 0; i < 90 && await area.evaluate(node => node.scrollTop < node.scrollHeight - node.clientHeight - 2); i++) await page.keyboard.press('ArrowDown');
        const end = await area.evaluate(node => ({ top: node.scrollTop, max: node.scrollHeight - node.clientHeight }));
        const stillThere = await area.evaluate(node => document.activeElement === node);
        await page.keyboard.press('ArrowDown');
        const after = await page.evaluate(() => document.activeElement?.tagName);
        record(layoutName, `[${surface.label}] the arrow keys scroll the area to its end${tv ? ' (the remote)' : ''}`, moved > start && end.top >= end.max - 2 && stillThere, { start, moved, end, after });
        console.log('  shot', await shot(page, `${surfaceKey}-diagnostics-${layoutName}`));
        if (surfaceKey === 'dashboard' && tv) {
            // On the remote an action inside a conflict row keeps the arrows for moving between rows: they do not scroll the list under it
            // (a pointer device's own arrow-key scrolling of the ancestor is the browser's, not ours).
            const conflictsArea = page.locator('#EpisodeConflicts');
            await conflictsArea.scrollIntoViewIfNeeded();
            const action = conflictsArea.locator('[data-row-action="rebind"]').first();
            await action.focus();
            const before = await conflictsArea.evaluate(node => node.scrollTop);
            await page.keyboard.press('ArrowDown');
            await page.waitForTimeout(150);
            const afterTop = await conflictsArea.evaluate(node => node.scrollTop);
            record(layoutName, `[${surface.label}] arrows pressed on a conflict's action do not scroll the list`, afterTop === before, { before, afterTop });
        }
    } finally {
        await page.unroute('**/JellyfinMod/Reconciliation/Orphans');
        await page.unroute('**/JellyfinMod/Reconciliation/Conflicts');
    }
}

const newContext = async layout => {
    const context = await browser.newContext({ ...layout, serviceWorkers: 'block' });
    if (layout.tv) await context.addInitScript(() => localStorage.setItem('layout', 'tv'));
    const page = await context.newPage();
    page.on('dialog', dialog => dialog.accept());
    await signIn(page);
    return { context, page };
};

let fixtureId = null;
const errors = [];
try {
    const { context, page } = await newContext(LAYOUTS.desktop);
    page.on('pageerror', error => errors.push(String(error.message).split('\n')[0]));
    try {
        // fixture: an indexer on the runner's Torznab server
        const stale = (await api(page, 'GET', 'Settings/Indexers')) ?? [];
        for (const row of stale.filter(item => item.name === FIXTURE)) await api(page, 'DELETE', `Settings/Indexers/${row.id}`);
        const created = await api(page, 'POST', 'Settings/Indexers', {
            name: FIXTURE, baseUrl: torznabUrl, apiKey: { action: 'replace', value: 'jfmod-polish-fixture-key' }, enabled: true, automateTitleMatches: false,
            categories: [2000, 5000], priority: 99, downloadHosts: []
        });
        if (created.__error) throw new Error('could not create the fixture indexer: ' + created.__error);
        fixtureId = created.id;
        record('desktop', 'fixture indexer on the runner\'s Torznab server created, untested', created.verified === false, { id: fixtureId });

        for (const key of ['settings', 'dashboard']) await indexerFlow(page, key, fixtureId, FIXTURE, key === 'settings');
        // Each flow ends with a made-up token saved; the real one goes back after each, before the other page reads it.
        for (const key of ['settings', 'dashboard']) {
            try {
                await tokenFlow(page, key);
            } finally {
                restoreToken();
            }
        }
        for (const key of ['settings', 'dashboard']) await spinnerFlow(page, key);
        record('desktop', 'no page errors so far', errors.length === 0, errors.slice(0, 3));
    } finally {
        if (fixtureId) {
            await api(page, 'DELETE', `Settings/Indexers/${fixtureId}`);
            const left = ((await api(page, 'GET', 'Settings/Indexers')) ?? []).filter(item => item.name === FIXTURE).length;
            record('desktop', 'the fixture indexer is removed', left === 0, { left });
        }
        await context.close();
    }
    await alignmentFlow(newContext);
    for (const name of only) {
        const { context: ctx, page: pg } = await newContext(LAYOUTS[name]);
        try {
            for (const key of ['settings', 'dashboard']) await diagnosticsFlow(pg, key, name, !!LAYOUTS[name].tv);
        } catch (error) {
            record(name, 'diagnostics run completed', false, 'NOT VERIFIED: ' + String(error?.message ?? error).split('\n')[0]);
        } finally {
            await ctx.close();
        }
    }
} catch (error) {
    record('run', 'run completed', false, 'NOT VERIFIED: ' + String(error?.message ?? error).split('\n')[0]);
} finally {
    server.close();
    await browser.close();
}
const failed = results.filter(result => !result.ok).length;
console.log(`${results.length - failed} of ${results.length} checks pass`);
process.exit(failed ? 1 : 0);
