/* eslint-disable compat/compat, no-restricted-globals, sonarjs/cognitive-complexity -- a Node acceptance runner, not shipped code */
/* global window, document, ApiClient, location, localStorage */
// REVIEW-2026-09-24 S8-R1 and S8-R2 acceptance, on the acceptance instance.
//
//   JELLYFINMOD_TEST_URL=http://<host>:<isolated-port>/ JELLYFINMOD_BROWSER=chromium|chrome node review-fixes.mjs
//
// S8-R1: the mod entry's user menu offers JellyfinMod settings; the fork's stock entry, served at
//        /web-mod/<bundleId>/index.html, does not.
// S8-R2: on the TV (1920×1080 and 1280×720), from Home, arrows and Enter alone reach /catalog/settings, open the
//        Indexers section and remove an indexer through the confirmation dialog; Back closes the dialog without
//        removing, and Back with nothing open returns to Home.
// Creates one disposable indexer per TV layout ("JellyfinMod Remove Probe", disabled, pointing at a closed port) and
// removes it through the page; the final check asserts none is left. Signs in as oleksii with an empty password.
import { chromium } from 'playwright';

const testUrl = new URL(process.env.JELLYFINMOD_TEST_URL ?? (() => { throw new Error('JELLYFINMOD_TEST_URL is required'); })());
if (!['18096', '28096'].includes(testUrl.port)) throw new Error('Runs on the isolated instances only');
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
const base = new URL('/web/', testUrl).href;
const PROBE = 'JellyfinMod Remove Probe';
const results = [];
const record = (layout, check, ok, detail) => {
    results.push({ layout, check, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'} [${layout}] ${check}${detail === undefined ? '' : ' :: ' + JSON.stringify(detail)}`);
};
const browser = await chromium.launch(tier === 'chrome' ? { headless: true, channel: 'chrome' } : { headless: true });
console.log('browser', tier, browser.version());

async function signIn(page, url = base) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.ApiClient, undefined, { timeout: 30000 });
    await page.waitForFunction(() => {
        try { return !!ApiClient.getCurrentUserId() || /login|selectuser|selectserver/.test(location.hash); } catch { return false; }
    }, undefined, { timeout: 30000 });
    if (!await page.evaluate(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } })) {
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
    }
    await page.waitForFunction(() => location.hash.startsWith('#/home'), undefined, { timeout: 30000 });
    await page.waitForTimeout(2000);
}
const api = (page, method, path, body) => page.evaluate(async ([m, p, b]) => {
    const response = await fetch(ApiClient.getUrl(p), {
        method: m, headers: { 'Content-Type': 'application/json', Authorization: ApiClient.getAuthorizationHeader?.() ?? `MediaBrowser Token="${ApiClient.accessToken()}"` },
        body: b === undefined ? undefined : JSON.stringify(b)
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
}, [method, path, body]);
const focused = page => page.evaluate(() => {
    const el = document.activeElement;
    return el ? { tag: el.tagName.toLowerCase(), text: (el.textContent || '').trim().slice(0, 40), remove: el.dataset?.indexerRemove ?? null,
        tvSettings: el.hasAttribute?.('data-jfmod-tv-settings') ?? false, confirm: el.dataset?.jfmodConfirm ?? null,
        row: el.closest?.('[data-indexer]')?.getAttribute('data-indexer') ?? null,
        main: !!el.closest?.('.jfmod-check-main') } : null;
});
const remoteBack = async page => {
    const client = await page.context().newCDPSession(page);
    try {
        for (const type of ['rawKeyDown', 'keyUp']) {
            await client.send('Input.dispatchKeyEvent', { type, windowsVirtualKeyCode: 461, nativeVirtualKeyCode: 461, key: 'GoBack', code: '' });
        }
    } finally { await client.detach(); }
    await page.waitForTimeout(700);
};
const pressUntil = async (page, key, predicate, limit) => {
    const path = [];
    for (let index = 0; index < limit; index++) {
        const now = await focused(page);
        path.push(`${now?.tag}:${now?.text}`.slice(0, 28));
        if (predicate(now)) return { reached: true, presses: index, now };
        await page.keyboard.press(key);
        await page.waitForTimeout(250);
    }
    const now = await focused(page);
    return { reached: predicate(now), presses: limit, now, path };
};

// ---- S8-R1, desktop: mod entry offers the item; stock entry does not.
{
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error.message).split('\n')[0]));
    await signIn(page);
    const menuItems = async () => {
        await page.locator('.MuiToolbar-root button[aria-label], .MuiToolbar-root .MuiAvatar-root').last().click();
        await page.locator('.MuiMenuItem-root:visible').first().waitFor({ state: 'visible', timeout: 10000 });
        await page.waitForTimeout(500);
        const items = await page.locator('.MuiMenuItem-root:visible').allInnerTexts();
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
        return items.map(text => text.trim());
    };
    const modItems = await menuItems();
    record('desktop', 'S8-R1: the mod entry\'s user menu offers JellyfinMod settings', modItems.includes('JellyfinMod settings'), modItems);
    const bundle = await page.evaluate(() => document.querySelector('meta[name="jellyfinmod-web"]')?.getAttribute('content'));
    await page.goto(new URL(`/web-mod/${bundle}/index.html#/home`, testUrl).href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => { try { return !!window.ApiClient && !!ApiClient.getCurrentUserId(); } catch { return false; } }, undefined, { timeout: 30000 });
    await page.waitForTimeout(3000);
    const stock = await page.evaluate(() => ({ modBundle: window.__jfmodBundle === true, meta: !!document.querySelector('meta[name="jellyfinmod-web"]') }));
    const stockItems = await menuItems();
    record('desktop', 'S8-R1: the stock entry at /web-mod/<id>/index.html offers no JellyfinMod settings item',
        !stock.modBundle && !stock.meta && !stockItems.includes('JellyfinMod settings'), { bundle, stock, stockItems });
    record('desktop', 'no page errors', errors.length === 0, errors);
    await context.close();
}

// ---- S8-R2, TV: Home → settings → remove an indexer, by keys alone.
for (const [name, viewport] of [['tv1080', { width: 1920, height: 1080 }], ['tv720', { width: 1280, height: 720 }]]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error.message).split('\n')[0]));
    let probeId = null;
    try {
        await signIn(page);
        const created = await api(page, 'POST', 'JellyfinMod/Settings/Indexers', {
            name: PROBE, baseUrl: 'http://127.0.0.1:9/api', enabled: false, categories: [2000], apiKey: { action: 'unchanged' }
        });
        probeId = created.body?.id ?? null;
        record(name, 'fixture indexer created (disabled, closed port)', created.status === 201, created.status);
        await page.evaluate(() => localStorage.setItem('layout', 'tv'));
        await page.evaluate(() => { location.hash = '#/home'; });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.documentElement.classList.contains('layout-tv'), undefined, { timeout: 30000 });
        await page.locator('[data-jfmod-tv-settings]').waitFor({ state: 'attached', timeout: 30000 });
        await page.waitForTimeout(3000);
        const toLink = await pressUntil(page, 'ArrowDown', now => now?.tvSettings, 40);
        record(name, 'S8-R2: Down from Home reaches the JellyfinMod settings button', toLink.reached, { presses: toLink.presses, focus: toLink.now });
        await page.keyboard.press('Enter');
        await page.locator('.jfmod-check').waitFor({ state: 'visible', timeout: 30000 });
        record(name, 'S8-R2: Enter opens /catalog/settings', await page.evaluate(() => location.hash.startsWith('#/catalog/settings')));
        await page.waitForTimeout(800);
        for (let index = 0; index < 3; index++) { await page.keyboard.press('ArrowDown'); await page.waitForTimeout(200); }
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1000);
        const title = await page.locator('.jfmod-check-main h2').first().innerText();
        record(name, 'S8-R2: the rail reaches Indexers by arrows and Enter', title === 'Indexers', title);
        // Right from the rail into the section, down to the fixture's row, then Right along it to Remove.
        const intoMain = await pressUntil(page, 'ArrowRight', now => now?.main, 3);
        record(name, 'S8-R2: Right moves from the rail into the section', intoMain.reached, intoMain.now);
        const toRow = await pressUntil(page, 'ArrowDown', now => now?.row === probeId, 25);
        const toRemove = toRow.reached ? await pressUntil(page, 'ArrowRight', now => now?.remove === probeId, 6) : toRow;
        record(name, 'S8-R2: arrows reach the fixture\'s Remove button', toRemove.reached, toRemove.reached ? toRemove.now : toRemove.path);
        await page.keyboard.press('Enter');
        await page.locator('[data-jfmod-confirm=""]').waitFor({ state: 'visible', timeout: 10000 });
        await page.waitForTimeout(400);
        const inDialog = await focused(page);
        record(name, 'S8-R2: Remove opens a confirmation dialog (not window.confirm) with focus on Cancel', inDialog?.confirm === 'cancel', inDialog);
        await remoteBack(page);
        const afterBack = await focused(page);
        const stillThere = (await api(page, 'GET', 'JellyfinMod/Settings/Indexers')).body.some(row => row.id === probeId);
        record(name, 'S8-R2: the remote\'s Back closes the dialog, removes nothing and returns focus to Remove',
            await page.locator('[data-jfmod-confirm=""]').count() === 0 && stillThere && afterBack?.remove === probeId, afterBack);
        await page.keyboard.press('Enter');
        await page.locator('[data-jfmod-confirm=""]').waitFor({ state: 'visible', timeout: 10000 });
        await page.waitForTimeout(400);
        const toConfirm = await pressUntil(page, 'ArrowRight', now => now?.confirm === 'confirm', 4);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(2000);
        const gone = !(await api(page, 'GET', 'JellyfinMod/Settings/Indexers')).body.some(row => row.id === probeId);
        record(name, 'S8-R2: Right then Enter confirms and the indexer is removed', toConfirm.reached && gone, toConfirm.now);
        if (gone) probeId = null;
        await remoteBack(page);
        await page.waitForTimeout(1500);
        record(name, 'S8-R2: Back with nothing open returns to Home, the opener', await page.evaluate(() => location.hash.startsWith('#/home')),
            await page.evaluate(() => location.hash));
        record(name, 'no page errors', errors.length === 0, errors);
    } catch (error) {
        record(name, 'run completed', false, String(error).split('\n')[0]);
    } finally {
        if (probeId) await api(page, 'DELETE', `JellyfinMod/Settings/Indexers/${probeId}`).catch(() => null);
        await page.evaluate(() => localStorage.removeItem('layout')).catch(() => null);
        const left = (await api(page, 'GET', 'JellyfinMod/Settings/Indexers').catch(() => ({ body: [] }))).body.filter(row => row.name === PROBE);
        record(name, 'hygiene: no fixture indexer left', left.length === 0, left.length);
        await context.close();
    }
}

await browser.close();
const failed = results.filter(result => !result.ok).length;
console.log(`${results.length - failed} of ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
