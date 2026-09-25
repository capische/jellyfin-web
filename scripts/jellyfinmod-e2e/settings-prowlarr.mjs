/* eslint-disable compat/compat, no-restricted-globals, sonarjs/cognitive-complexity -- a Node acceptance runner, not shipped code */
/* global window, document, ApiClient, location, localStorage */
// P7.S9 acceptance: the Prowlarr card in the settings area's Indexers section, against an unreachable source.
//
//   JELLYFINMOD_TEST_URL=http://<host>:<isolated-port>/ JELLYFINMOD_BROWSER=chromium|chrome node settings-area.mjs
//
// Signs in as oleksii with an empty password. Adds a "JellyfinMod Prowlarr" source pointing at a closed port with a
// dummy key, tests and syncs it (both must report unreachable and change nothing), then removes it. No real Prowlarr
// is contacted; the sync rules themselves are proven by the plugin suite against a Prowlarr boundary server.
import { chromium } from 'playwright';

const testUrl = new URL(process.env.JELLYFINMOD_TEST_URL ?? (() => { throw new Error('JELLYFINMOD_TEST_URL is required'); })());
if (!['18096', '28096'].includes(testUrl.port)) throw new Error('Runs on the isolated instances only');
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
const base = new URL('/web/', testUrl).href;
const only = (process.env.JELLYFINMOD_SETTINGS_LAYOUTS ?? 'desktop,mobile,tv1080,tv720').split(',');
const LAYOUTS = {
    desktop: { viewport: { width: 1440, height: 900 } },
    mobile: {
        viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
    },
    tv1080: { viewport: { width: 1920, height: 1080 }, tv: true },
    tv720: { viewport: { width: 1280, height: 720 }, tv: true }
};
const SECTION_IDS = ['overview', 'discovery', 'client', 'indexers', 'profiles', 'grabbing', 'import', 'retention', 'automation', 'interface', 'diagnostics'];

const results = [];
const record = (layout, check, ok, detail) => {
    results.push({ layout, check, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'} [${layout}] ${check}${detail === undefined ? '' : ' :: ' + JSON.stringify(detail)}`);
};

const browser = await chromium.launch(tier === 'chrome' ? { headless: true, channel: 'chrome' } : { headless: true });
console.log('browser', tier, browser.version());

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
    // The sign-in flow navigates to Home on its own a moment later; a deep link set before that is overwritten.
    await page.waitForFunction(() => location.hash.startsWith('#/home'), undefined, { timeout: 30000 });
    await page.waitForTimeout(1500);
}

const openSettings = async (page, section) => {
    await page.evaluate(id => { location.hash = '#/catalog/settings' + (id ? '?section=' + id : ''); }, section);
    await page.locator('.jfmod-check').waitFor({ state: 'visible', timeout: 30000 });
};
const heading = page => page.locator('.jfmod-check-main h2').first().innerText();
const focusInfo = page => page.evaluate(() => {
    const el = document.activeElement;
    return el ? `${el.tagName.toLowerCase()}${el.dataset.section ? '[' + el.dataset.section + ']' : ''} ${(el.textContent || '').trim().slice(0, 30)}` : 'none';
});
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
const openMenus = page => page.evaluate(() => document.querySelectorAll('.MuiPopover-root:not([aria-hidden="true"]), .MuiMenu-root:not([aria-hidden="true"])').length);

const DUMMY = 'jfmod-dummy-' + Date.now().toString(16);
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.on('dialog', dialog => dialog.accept());
const errors = [];
const bodies = [];
page.on('pageerror', error => errors.push(String(error.message).split('\n')[0]));
page.on('response', async response => {
    if (/\/JellyfinMod\//.test(response.url())) bodies.push(await response.text().catch(() => ''));
});
const card = () => page.locator('[data-prowlarr="card"]');
const notice = () => card().locator('.jfmod-notice-text').innerText({ timeout: 30000 });
try {
    await signIn(page);
    await openSettings(page, 'indexers');
    await card().waitFor({ state: 'visible', timeout: 30000 });
    record('desktop', 'The Indexers section carries the Prowlarr card', true);
    const inputs = card().locator('input');
    await inputs.nth(0).fill('JellyfinMod Prowlarr');
    await inputs.nth(1).fill('http://127.0.0.1:9');
    await card().locator('input[type="password"]').fill(DUMMY);
    await card().locator('button', { hasText: 'Add Prowlarr' }).click();
    record('desktop', 'Adding a source saves it', /Saved/.test(await notice()), await notice());
    await card().locator('button', { hasText: /^Test$/ }).click();
    await page.waitForFunction(() => /\(unreachable\)/.test(document.querySelector('[data-prowlarr="card"] .jfmod-notice-text')?.textContent ?? ''), undefined, { timeout: 60000 });
    record('desktop', 'Test reports an unreachable source with a code and a sentence', true, await notice());
    await card().locator('[data-prowlarr="sync"]').click();
    await page.waitForFunction(() => /changed nothing \(unreachable\)/.test(document.querySelector('[data-prowlarr="card"] .jfmod-notice-text')?.textContent ?? ''), undefined, { timeout: 60000 });
    record('desktop', 'A failed sync says it changed nothing', true, await notice());
    const synced = await page.locator('.jfmod-brow .jfmod-sub', { hasText: 'Synced from Prowlarr' }).count();
    record('desktop', 'No indexer was created by the failed sync', synced === 0, { synced });
    await card().locator('button', { hasText: 'Remove' }).click();
    // Since REVIEW-2026-09-24 S8-R2 removal asks through the settings area's own dialog, not window.confirm.
    await page.locator('[data-jfmod-confirm="confirm"]').click({ timeout: 10000 });
    await page.waitForFunction(() => !!document.querySelector('[data-prowlarr="card"] button') &&
        [...document.querySelectorAll('[data-prowlarr="card"] button')].some(button => /Add Prowlarr/.test(button.textContent ?? '')), undefined, { timeout: 30000 });
    record('desktop', 'Removing the source leaves the card empty again', true);
    const sources = await page.evaluate(() => ApiClient.ajax({ type: 'GET', url: ApiClient.getUrl('JellyfinMod/Settings/Prowlarr'), dataType: 'json' }));
    record('desktop', 'No Prowlarr source is left behind', Array.isArray(sources) && sources.length === 0, { sources: sources.length });
    record('desktop', 'No response ever carried the key', !bodies.some(body => body.includes(DUMMY)), { responses: bodies.length });
    record('desktop', 'No page errors', errors.length === 0, errors.slice(0, 3));
} catch (error) {
    record('desktop', 'run completed', false, 'NOT VERIFIED: ' + String(error?.message ?? error).split('\n')[0]);
} finally {
    await context.close();
}

await browser.close();
const failed = results.filter(result => !result.ok).length;
console.log(`${results.length - failed} of ${results.length} checks pass`);
process.exit(failed ? 1 : 0);
