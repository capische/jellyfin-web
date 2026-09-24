/* eslint-disable compat/compat, no-restricted-globals, sonarjs/cognitive-complexity -- a Node acceptance runner, not shipped code */
/* global window, document, ApiClient, location, localStorage */
// S11 step 2 (P7): a bundle upgrade with a desktop and a TV-layout session left open.
//
//   JELLYFINMOD_TEST_URL=http://<host>:<isolated-port>/ JELLYFINMOD_GO_FILE=<path> \
//   JELLYFINMOD_BROWSER=chromium|chrome node upgrade-sessions.mjs
//
// Signs in as oleksii (empty password) in two contexts, desktop 1600x1000 and TV 1920x1080 with
// layout=tv, records the running bundle id, prints READY and waits for JELLYFINMOD_GO_FILE to exist:
// the operator deploys a new bundle and restarts the server meanwhile. Then, WITHOUT reloading, each
// session keeps navigating (desktop by hash route, TV by keys only) and must keep working on the
// bundle it loaded (lazy chunks served 200 from the retained bundle path, API calls answered, no page
// error). Finally a full reload must run the new bundle. Reads only; writes nothing to the instance.
import fs from 'node:fs';
import { chromium } from 'playwright';

const testUrl = new URL(process.env.JELLYFINMOD_TEST_URL ?? (() => { throw new Error('JELLYFINMOD_TEST_URL is required'); })());
if (!['18096', '28096'].includes(testUrl.port)) throw new Error('Runs on the isolated instances only');
const goFile = process.env.JELLYFINMOD_GO_FILE ?? (() => { throw new Error('JELLYFINMOD_GO_FILE is required'); })();
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
const base = new URL('/web/', testUrl).href;
const results = [];
const record = (layout, check, ok, detail) => {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'} [${layout}] ${check}${detail === undefined ? '' : ' :: ' + JSON.stringify(detail)}`);
};
const signedIn = page => page.evaluate(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } });

async function signIn(page) {
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.ApiClient, undefined, { timeout: 30000 });
    await page.waitForFunction(() => {
        try { return !!ApiClient.getCurrentUserId() || /login|selectuser|selectserver/.test(location.hash); } catch { return false; }
    }, undefined, { timeout: 30000 });
    if (!await signedIn(page)) {
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
}

const bundleOf = page => page.evaluate(() => document.querySelector('meta[name="jellyfinmod-web"]')?.content ?? null);

const browser = await chromium.launch(tier === 'chrome' ? { headless: true, channel: 'chrome' } : { headless: true });
console.log('browser', tier, browser.version());
const sessions = {};
try {
    for (const [name, viewport, layout] of [['desktop', { width: 1600, height: 1000 }, null], ['tv1080', { width: 1920, height: 1080 }, 'tv']]) {
        const context = await browser.newContext({ viewport });
        const page = await context.newPage();
        const s = { page, errors: [], requests: [] };
        page.on('pageerror', error => s.errors.push(String(error).slice(0, 200)));
        page.on('response', response => {
            const url = new URL(response.url());
            if (url.pathname.includes('/web-mod/') || url.pathname.startsWith('/Users') || url.pathname.startsWith('/Items') || url.pathname.startsWith('/JellyfinMod')) {
                s.requests.push({ path: url.pathname.replace(/[0-9a-f]{32}/g, '<id>'), status: response.status() });
            }
        });
        await signIn(page);
        if (layout) {
            await page.evaluate(value => localStorage.setItem('layout', value), layout);
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => location.hash.startsWith('#/home') && document.documentElement.classList.contains('layout-tv'), undefined, { timeout: 30000 });
        }
        await page.waitForSelector('.card', { timeout: 30000 });
        s.oldBundle = await bundleOf(page);
        record(name, 'Session open on Home before the upgrade', !!s.oldBundle, { bundle: s.oldBundle });
        sessions[name] = s;
    }

    console.log('READY');
    const deadline = Date.now() + 20 * 60 * 1000;
    while (!fs.existsSync(goFile)) {
        if (Date.now() > deadline) throw new Error('Timed out waiting for the go file (NOT VERIFIED)');
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    console.log('GO received');

    for (const [name, s] of Object.entries(sessions)) {
        const { page } = s;
        s.requests.length = 0;
        const errorsBefore = s.errors.length;
        if (name === 'desktop') {
            await page.evaluate(() => { location.hash = '#/movies'; });
            await page.waitForFunction(() => location.hash.startsWith('#/movies') && document.querySelectorAll('.card').length > 0, undefined, { timeout: 45000 });
            const firstId = await page.evaluate(() => document.querySelector('.card[data-id]')?.getAttribute('data-id'));
            await page.evaluate(id => { location.hash = '#/details?id=' + id; }, firstId);
            await page.waitForFunction(() => location.hash.startsWith('#/details') && !!document.querySelector('.detailPagePrimaryContainer, .jfmod-detail, [class*="jfmod-detail"]'), undefined, { timeout: 45000 });
            await page.evaluate(() => { location.hash = '#/search'; });
            await page.waitForFunction(() => location.hash.startsWith('#/search'), undefined, { timeout: 20000 });
            await page.waitForTimeout(2000);
        } else {
            // Keys only: move into the first Home row and open the focused card.
            for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowDown'); await page.waitForTimeout(400); }
            await page.keyboard.press('Enter');
            await page.waitForFunction(() => !location.hash.startsWith('#/home'), undefined, { timeout: 45000 });
            await page.waitForTimeout(2500);
            await page.keyboard.press('Escape');
            await page.waitForFunction(() => location.hash.startsWith('#/home'), undefined, { timeout: 30000 });
            await page.waitForTimeout(1500);
        }
        const stillBundle = await bundleOf(page);
        const modRequests = s.requests.filter(r => r.path.includes('/web-mod/'));
        const failed = s.requests.filter(r => r.status >= 400);
        record(name, 'Open session keeps working on the bundle it loaded, without a reload', stillBundle === s.oldBundle
            && failed.length === 0 && s.errors.length === errorsBefore && s.requests.some(r => r.path.startsWith('/Items') || r.path.startsWith('/Users')), {
            bundle: stillBundle, hash: await page.evaluate(() => location.hash.slice(0, 40)),
            modAssetRequests: modRequests.length, modAssetPaths: [...new Set(modRequests.map(r => r.path.split('/').slice(0, 3).join('/')))],
            failed, pageErrors: s.errors.slice(errorsBefore)
        });

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => location.hash.length > 1 && !!document.querySelector('meta[name="jellyfinmod-web"]'), undefined, { timeout: 30000 });
        await page.evaluate(() => { location.hash = '#/home'; });
        await page.waitForSelector('.card', { timeout: 45000 });
        const newBundle = await bundleOf(page);
        record(name, 'A full reload runs the new bundle', !!newBundle && newBundle !== s.oldBundle, { from: s.oldBundle, to: newBundle, signedIn: await signedIn(page) });
        if (name === 'tv1080') await page.evaluate(() => localStorage.removeItem('layout'));
    }
} finally {
    await browser.close();
}
const failures = results.filter(ok => !ok).length;
console.log(`${results.length - failures} of ${results.length} passed on ${tier}`);
process.exit(failures ? 1 : 0);
