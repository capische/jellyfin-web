/* eslint-disable compat/compat, no-restricted-globals, sonarjs/cognitive-complexity, sonarjs/no-os-command-from-path -- a Node acceptance runner, not shipped code */
/* global window, document, ApiClient, location, localStorage */
// P7.S11 steps 3/4 on the acceptance instance's bind-mounted shape: the takeover turned off from the settings area's
// Interface section, the restored /web/index.html hashed and compared, the stock checks run on the restored /web/, then
// the takeover turned back on from the mod's own address and the patched hash compared with the one recorded before.
//
//   JELLYFINMOD_TEST_URL=http://<host>:<isolated-port>/ JELLYFINMOD_BROWSER=chromium|chrome
//   JELLYFINMOD_TAKEOVER_SSH=<ssh alias of the host>  JELLYFINMOD_WEB_ROOT=<the web root on that host>
//   JELLYFINMOD_WEB_STATE=<the plugin's web-root state directory on that host>  JELLYFINMOD_TAKEOVER_OUT=<json results file>
//   node takeover-off.mjs
//
// On this shape the web root is the fork's own dist/ (PHASE7 §4.8, decision 8), so "stock" is the fork's stock entry
// index.html as the engine recorded it (state.json stockSha256, index.html.pristine), not the host image's file; the
// byte-identical host-stock claim belongs to the image shape. The served bundle's own index.html is hashed too and
// reported as is: it equals the recorded stock only when the web root holds the same build as the plugin's bundle.
// Host paths are read over SSH and never written to the results. Signs in as oleksii with an empty password.
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const required = name => process.env[name] ?? (() => { throw new Error(`${name} is required`); })();
const testUrl = new URL(required('JELLYFINMOD_TEST_URL'));
if (!['18096', '28096'].includes(testUrl.port)) throw new Error('Runs on the isolated instances only');
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
const ssh = required('JELLYFINMOD_TAKEOVER_SSH');
const webRoot = required('JELLYFINMOD_WEB_ROOT');
const stateDir = required('JELLYFINMOD_WEB_STATE');
const web = new URL('/web/', testUrl).href;
const modAddress = new URL('/web-mod/', testUrl).href;
const LAYOUTS = {
    desktop: { viewport: { width: 1440, height: 900 } },
    mobile: {
        viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
    },
    tv1080: { viewport: { width: 1920, height: 1080 }, tv: true },
    tv720: { viewport: { width: 1280, height: 720 }, tv: true }
};

const results = [];
const record = (step, check, ok, detail) => {
    const verdict = ok === true ? 'PASS' : ok === false ? 'FAIL' : ok;
    results.push({ step, check, verdict, detail });
    console.log(`${verdict} [${tier}] ${step}: ${check}${detail === undefined ? '' : ' :: ' + JSON.stringify(detail).slice(0, 500)}`);
};
const quote = value => `'${String(value).replace(/'/g, "'\\''")}'`;
/** File facts on the host: sha256 (or null when absent) of each name. Only hashes leave the host. */
const hostHashes = () => {
    const script = `for f in ${quote(webRoot + '/index.html')} ${quote(webRoot + '/index.jellyfinmod-stock.html')} ${quote(stateDir + '/index.html.pristine')}; do `
        + 'if [ -f "$f" ]; then sha256sum "$f" | cut -c1-64; else echo absent; fi; done; cat ' + quote(stateDir + '/state.json');
    const [index, stockCopy, pristine, ...state] = execFileSync('ssh', [ssh, 'bash', '-s'], { input: script, encoding: 'utf8' }).trim().split('\n');
    const parsed = JSON.parse(state.join('\n'));
    return { index, stockCopy: stockCopy === 'absent' ? null : stockCopy, pristine, state: { stockSha256: parsed.stockSha256, patchedSha256: parsed.patchedSha256,
        bundleId: parsed.bundleId, patchedBy: parsed.patchedBy } };
};

const browser = await chromium.launch(tier === 'chrome' ? { headless: true, channel: 'chrome' } : { headless: true });
const browserVersion = browser.version();
console.log('browser', tier, browserVersion);

async function signIn(page, address) {
    await page.goto(address, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.ApiClient, undefined, { timeout: 30000 });
    await page.waitForFunction(() => {
        try { return !!ApiClient.getCurrentUserId() || /login|selectuser|selectserver/.test(location.hash); } catch { return false; }
    }, undefined, { timeout: 30000 });
    if (!await page.evaluate(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } })) {
        const field = page.locator('#txtManualName');
        if (!await field.isVisible().catch(() => false)) {
            const chooser = page.locator('.btnManual').first();
            await chooser.waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
            if (await chooser.count()) await chooser.evaluate(node => node.click());
            await field.waitFor({ state: 'visible', timeout: 15000 });
        }
        await page.waitForTimeout(1000);
        await field.fill('oleksii');
        await page.locator('button:visible').filter({ hasText: 'Sign In' }).first().click();
        await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } }, undefined, { timeout: 30000 });
    }
    await page.waitForFunction(() => location.hash.startsWith('#/home'), undefined, { timeout: 30000 });
    await page.waitForTimeout(1500);
}
const interfaceState = page => page.evaluate(async () => {
    const response = await fetch(ApiClient.getUrl('JellyfinMod/Settings/Interface'), { headers: { Authorization: `MediaBrowser Token="${ApiClient.accessToken()}"` } });
    const body = await response.json();
    return { enabled: body.TakeoverEnabled, status: body.Status, stockSha256: body.StockSha256, patchedSha256: body.PatchedSha256, bundleId: body.BundleId,
        patchedBy: body.PatchedBy, blocker: body.Blocker ?? null };
});
/** Flips the Interface section's switch in the page and waits for the server to report the wanted status. */
async function toggle(page, wanted) {
    await page.evaluate(() => { location.hash = '#/catalog/settings?section=interface'; });
    const section = page.locator('section[data-section="interface"]');
    await section.waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(1500);
    const control = section.getByLabel('Serve this interface at /web', { exact: true });
    const on = await control.isChecked();
    if (on === (wanted === 'patched')) throw new Error(`the switch already reads ${on ? 'on' : 'off'}`);
    await control.click();
    await page.waitForFunction(() => /Saved/.test(document.querySelector('[data-section="interface"] .jfmod-notice')?.textContent ?? ''), undefined, { timeout: 30000 });
    await page.waitForTimeout(1500);
    return { shown: (await section.locator('.jfmod-kv').innerText()).replace(/\s+/g, ' '), switchOn: await control.isChecked(), server: await interfaceState(page) };
}

const recorded = hostHashes();
const bundleIndex = await (await fetch(new URL(`/web-mod/${recorded.state.bundleId}/index.html`, testUrl))).text();
const bundleIndexSha = (await import('node:crypto')).createHash('sha256').update(bundleIndex).digest('hex');
console.log('before', JSON.stringify({ ...recorded, bundleIndexSha }));
if (recorded.index !== recorded.state.patchedSha256) throw new Error('the web root is not in its recorded patched state; refusing to start');

const context = await browser.newContext({ viewport: LAYOUTS.desktop.viewport, serviceWorkers: 'block' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(String(error.message).split('\n')[0]));
let turnedOff = false;
const hashes = { before: { ...recorded, bundleIndexSha } };
try {
    // ---- Off, from the Interface section of the mod at /web/
    await signIn(page, web);
    const off = await toggle(page, 'stock');
    turnedOff = off.server.status === 'stock';
    const afterOff = hostHashes();
    hashes.off = afterOff;
    record('off', 'The Interface switch turned off in the page; the server reports stock and the section shows it',
        turnedOff && off.server.enabled === false && !off.switchOn && /stock/.test(off.shown), { server: off.server, shown: off.shown });
    record('off', 'The restored web-root index.html equals state.json stockSha256 and the pristine copy (the fork\'s stock entry on this shape)',
        afterOff.index === recorded.state.stockSha256 && afterOff.index === afterOff.pristine,
        { restored: afterOff.index, stockSha256: recorded.state.stockSha256, pristine: afterOff.pristine });
    record('off', 'index.jellyfinmod-stock.html is gone from the web root', afterOff.stockCopy === null, { stockCopy: afterOff.stockCopy });
    record('off', 'The served bundle\'s own index.html compared with the restored file (reported; equal only if the web root holds the same build)',
        afterOff.index === bundleIndexSha ? 'PASS' : 'INFO', { restored: afterOff.index, bundleIndex: bundleIndexSha, equal: afterOff.index === bundleIndexSha });
    const served = await (await fetch(web)).text();
    record('off', 'The host serves the restored file at /web/ (no takeover marker, no mod meta tag)', !served.includes('jellyfinmod:takeover')
        && !served.includes('jellyfinmod-web'), { bytes: served.length });

    // ---- Stock checks on the restored /web/, every layout, fresh contexts
    for (const [name, layout] of Object.entries(LAYOUTS)) {
        const stockContext = await browser.newContext({ viewport: layout.viewport, isMobile: layout.isMobile, hasTouch: layout.hasTouch, userAgent: layout.userAgent,
            serviceWorkers: 'block' });
        const stock = await stockContext.newPage();
        const stockErrors = [];
        const modRequests = [];
        stock.on('pageerror', error => stockErrors.push(String(error.message).split('\n')[0]));
        stock.on('request', request => { if (request.url().includes('/web-mod/')) modRequests.push(new URL(request.url()).pathname); });
        try {
            await signIn(stock, web);
            if (layout.tv) {
                await stock.evaluate(() => localStorage.setItem('layout', 'tv'));
                await stock.reload({ waitUntil: 'domcontentloaded' });
                await stock.waitForFunction(() => document.documentElement.classList.contains('layout-tv'), undefined, { timeout: 30000 });
            }
            await stock.waitForFunction(() => document.querySelectorAll('.homePage:not(.hide) .verticalSection .card').length > 0, undefined, { timeout: 30000 });
            const home = await stock.evaluate(() => ({
                bundle: window.__jfmodBundle === true, meta: !!document.querySelector('meta[name="jellyfinmod-web"]'),
                marker: document.documentElement.outerHTML.includes('jellyfinmod:takeover'),
                // The fork's stock entry keeps the Phase 1-6 additions it always carried (the accepted top-bar redesign's
                // jfmod-topbar); the Phase 7 mod entry is what must be absent. Reported, not failed.
                forkStockClasses: [...new Set([...document.querySelectorAll('[class*="jfmod-"]')].flatMap(node => [...node.classList].filter(name => name.startsWith('jfmod-'))))],
                sections: [...document.querySelectorAll('.homePage:not(.hide) .verticalSection .sectionTitle')].map(node => node.textContent.trim()).slice(0, 6),
                cards: document.querySelectorAll('.homePage:not(.hide) .card').length, address: location.pathname
            }));
            record('stock ' + name, 'Restored /web/ signs in to the stock entry\'s Home: no mod bundle, meta tag or marker, nothing fetched from /web-mod/',
                !home.bundle && !home.meta && !home.marker && home.cards > 0 && modRequests.length === 0 && home.address.endsWith('/web/'),
                { ...home, modRequests: modRequests.length });
            if (layout.tv) {
                // Keys only: a card takes focus, Enter opens the stock details page, Back returns Home.
                for (let press = 0; press < 6; press++) {
                    if (await stock.evaluate(() => !!document.activeElement?.closest('.card'))) break;
                    await stock.keyboard.press('ArrowDown');
                    await stock.waitForTimeout(400);
                }
                const focused = await stock.evaluate(() => !!document.activeElement?.closest('.card'));
                await stock.keyboard.press('Enter');
                const opened = await stock.waitForFunction(() => /#\/details/.test(location.hash) && !!document.querySelector('.itemDetailPage:not(.hide) .itemName, .itemDetailPage:not(.hide) h1'),
                    undefined, { timeout: 20000 }).then(() => true, () => false);
                await stock.keyboard.press('Escape');
                const back = await stock.waitForFunction(() => location.hash.startsWith('#/home'), undefined, { timeout: 15000 }).then(() => true, () => false);
                record('stock ' + name, 'Keys: a Home card takes focus, Enter opens the stock details page, Back (Escape) returns Home', focused && opened && back,
                    { focused, opened, back });
            } else {
                const itemId = await stock.evaluate(async () => {
                    const response = await fetch(ApiClient.getUrl(`Users/${ApiClient.getCurrentUserId()}/Items`, { IncludeItemTypes: 'Movie', Recursive: true, Limit: 1, SortBy: 'SortName' }),
                        { headers: { Authorization: `MediaBrowser Token="${ApiClient.accessToken()}"` } });
                    return (await response.json()).Items?.[0]?.Id ?? null;
                });
                await stock.evaluate(id => { location.hash = '#/details?id=' + id; }, itemId);
                const detail = await stock.waitForFunction(() => {
                    const pageNode = document.querySelector('.itemDetailPage:not(.hide)');
                    return pageNode && pageNode.querySelector('.itemName, h1')?.textContent?.trim() && pageNode.querySelector('.btnPlay, .btnResume, .detailButton');
                }, undefined, { timeout: 20000 }).then(() => true, () => false);
                await stock.evaluate(() => { location.hash = '#/mypreferencesmenu'; });
                await stock.waitForFunction(() => !!document.querySelector('.page:not(.hide) .lnkDisplayPreferences'), undefined, { timeout: 20000 });
                const prefs = await stock.evaluate(() => ({ jfmodSettings: /JellyfinMod settings/.test(document.querySelector('.page:not(.hide)')?.textContent ?? '') }));
                await stock.evaluate(() => { location.hash = '#/dashboard'; });
                // The mobile Dashboard has no "Dashboard" title; its server card is on every layout.
                const dashboard = await stock.waitForFunction(() => location.hash.startsWith('#/dashboard') && /Server version/.test(document.body.innerText), undefined, { timeout: 20000 })
                    .then(() => true, () => false);
                record('stock ' + name, 'Stock details page, preferences menu without JellyfinMod settings, and the Dashboard', detail && !prefs.jfmodSettings && dashboard,
                    { detail, jfmodSettingsInPreferences: prefs.jfmodSettings, dashboard });
            }
            record('stock ' + name, 'No page errors on the restored stock page', stockErrors.length === 0, stockErrors.slice(0, 3));
        } catch (error) {
            record('stock ' + name, 'run', 'NOT VERIFIED', String(error.message).split('\n')[0]);
        }
        await stock.evaluate(() => localStorage.removeItem('layout')).catch(() => {});
        await stockContext.close();
    }
} catch (error) {
    record('off', 'run', 'NOT VERIFIED', String(error.message).split('\n')[0]);
} finally {
    // ---- Back on, from the mod's own address (the settings area stays reachable there while /web/ is stock)
    if (turnedOff) {
        try {
            await signIn(page, modAddress);
            const on = await toggle(page, 'patched');
            const afterOn = hostHashes();
            hashes.on = afterOn;
            record('on', 'Turned back on from /web-mod/: the server reports patched, set by an administrator', on.server.status === 'patched' && on.server.enabled === true
                && on.server.patchedBy === 'setting', { server: on.server, shown: on.shown });
            record('on', 'The re-patched index.html equals the patched hash recorded before; the stock copy is back and equals the stock hash',
                afterOn.index === recorded.state.patchedSha256 && afterOn.stockCopy === recorded.state.stockSha256 && afterOn.state.patchedSha256 === recorded.state.patchedSha256,
                { index: afterOn.index, recordedPatched: recorded.state.patchedSha256, stockCopy: afterOn.stockCopy });
            const check = await browser.newContext({ serviceWorkers: 'block' });
            const modPage = await check.newPage();
            await modPage.goto(web, { waitUntil: 'domcontentloaded' });
            const meta = await modPage.waitForFunction(() => window.__jfmodBundle === true && document.querySelector('meta[name="jellyfinmod-web"]')?.content, undefined, { timeout: 30000 })
                .then(handle => handle.jsonValue(), () => null);
            record('on', '/web/ runs the mod bundle again', meta === recorded.state.bundleId, { meta });
            await check.close();
        } catch (error) {
            record('on', 'run', 'NOT VERIFIED', String(error.message).split('\n')[0]);
        }
    }
    record('on', 'No page errors in the administrator\'s page', errors.length === 0, errors.slice(0, 3));
}
await context.close();
await browser.close();
if (process.env.JELLYFINMOD_TAKEOVER_OUT) {
    writeFileSync(process.env.JELLYFINMOD_TAKEOVER_OUT, JSON.stringify({ browser: tier, version: browserVersion, hashes, results }, null, 1) + '\n');
}
const failed = results.filter(result => result.verdict === 'FAIL' || result.verdict === 'NOT VERIFIED').length;
console.log(`${results.length - failed} of ${results.length} checks passed or reported, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
