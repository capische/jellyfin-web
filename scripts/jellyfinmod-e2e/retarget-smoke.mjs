/* eslint-disable compat/compat, no-restricted-globals, sonarjs/cognitive-complexity -- a Node acceptance runner, not shipped code */
/* global window, document, ApiClient, location */
// Jellyfin 12 retarget smoke (P7.S5, 2026-09-24), on the acceptance instance after the plugin built for Jellyfin
// 12.0.0 on .NET 10 was deployed:
//
//   JELLYFINMOD_TEST_URL=http://<host>:<isolated-port>/ JELLYFINMOD_BROWSER=chromium|chrome node retarget-smoke.mjs
//
// Signs in as oleksii with an empty password, then checks the mod Home, one detail page, the settings area, the
// Dashboard plugin page (no repository error) and authenticated Health (host 12.0.0, targetAbi 12.0.0.0), with no
// page errors. Reads only; writes nothing to the instance.
import { chromium } from 'playwright';

const testUrl = new URL(process.env.JELLYFINMOD_TEST_URL ?? (() => { throw new Error('JELLYFINMOD_TEST_URL is required'); })());
if (!['18096', '28096'].includes(testUrl.port)) throw new Error('Runs on the isolated instances only');
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
const base = new URL('/web/', testUrl).href;
const expectedBundle = process.env.JELLYFINMOD_EXPECT_BUNDLE;
const results = [];
const record = (check, ok, detail) => {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'} ${check}${detail === undefined ? '' : ' :: ' + JSON.stringify(detail)}`);
};

const browser = await chromium.launch(tier === 'chrome' ? { headless: true, channel: 'chrome' } : { headless: true });
console.log('browser', tier, browser.version());
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(String(error).slice(0, 200)));
const api = path => page.evaluate(async p => {
    const response = await fetch(ApiClient.getUrl(p), {
        headers: { Authorization: ApiClient.getAuthorizationHeader?.() ?? `MediaBrowser Token="${ApiClient.accessToken()}"` }
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
}, path);

try {
    // ---- Sign-in lands in the mod shell.
    await page.goto(base, { waitUntil: 'domcontentloaded' });
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
    const meta = await page.evaluate(() => document.querySelector('meta[name="jellyfinmod-web"]')?.content ?? null);
    record('Sign-in as oleksii lands on Home in the mod shell', !!meta && (!expectedBundle || meta === expectedBundle), { meta });

    // ---- Mod Home: the hero and at least one row of cards.
    await page.waitForSelector('.jfmod-homeHeroMount', { timeout: 30000 });
    await page.waitForFunction(() => document.querySelectorAll('.card').length > 0, undefined, { timeout: 30000 });
    const home = await page.evaluate(() => ({
        hero: !!document.querySelector('.jfmod-homeHero'),
        cards: document.querySelectorAll('.card').length,
        sections: [...document.querySelectorAll('.sectionTitle')].filter(node => node.offsetParent !== null)
            .map(node => node.textContent.trim()).filter(Boolean).slice(0, 6)
    }));
    record('Mod Home renders the hero and card rows', home.hero && home.cards > 0, home);

    // ---- Health: authenticated, on the 12.0.0 host, with the bundle this page runs.
    const health = await api('JellyfinMod/Health');
    const anonymous = await page.evaluate(() => fetch('/JellyfinMod/Health').then(r => r.status));
    const web = health.body?.Web ?? health.body?.web ?? {};
    const summary = {
        status: health.status, ok: health.body?.Ok ?? health.body?.ok, version: health.body?.Version ?? health.body?.version,
        hostVersion: web.HostVersion ?? web.hostVersion, bundleId: web.BundleId ?? web.bundleId,
        minimum: (web.SupportedServer ?? web.supportedServer)?.Minimum ?? (web.SupportedServer ?? web.supportedServer)?.minimum,
        blocker: web.Blocker ?? web.blocker ?? null,
        takeover: (web.Takeover ?? web.takeover)?.Status ?? (web.Takeover ?? web.takeover)?.status,
        anonymous
    };
    record('Authenticated Health is ok on host 12.0.0 with the served bundle; anonymous is refused',
        summary.status === 200 && summary.ok === true && summary.hostVersion?.startsWith('12.0.0') && summary.bundleId === meta
        && summary.minimum === '12.0.0.0' && summary.blocker === null && summary.takeover === 'patched' && anonymous === 401, summary);

    // ---- A detail page: the first movie the signed-in user can see.
    const userId = await page.evaluate(() => ApiClient.getCurrentUserId());
    const movies = await api(`Users/${userId}/Items?IncludeItemTypes=Movie&Recursive=true&Limit=1&SortBy=SortName`);
    const movie = movies.body?.Items?.[0];
    await page.evaluate(id => { location.hash = '#/details?id=' + id; }, movie.Id);
    await page.waitForFunction(name => document.querySelector('.detailPagePrimaryContainer, .detailPageContent')
        && document.body.innerText.includes(name), movie.Name, { timeout: 30000 });
    record('A detail page renders the title', true, { name: movie.Name });

    // ---- The settings area.
    await page.evaluate(() => { location.hash = '#/catalog/settings'; });
    await page.locator('.jfmod-check').waitFor({ state: 'visible', timeout: 30000 });
    const sections = await page.evaluate(() => [...document.querySelectorAll('.jfmod-step[data-section]')].map(node => node.dataset.section));
    record('The settings area opens with its sections', sections.length > 0, { sections });

    // ---- Dashboard -> Plugins: JellyfinMod listed, its page shows the version and no repository error.
    await page.evaluate(() => { location.hash = '#/dashboard/plugins'; });
    const card = page.locator('.card, [class*="Card"]', { hasText: 'JellyfinMod' }).first();
    await card.waitFor({ state: 'visible', timeout: 30000 });
    await card.click();
    await page.waitForFunction(() => /#\/dashboard\/plugins\/[0-9a-f-]{32,}/i.test(location.hash), undefined, { timeout: 30000 });
    await page.waitForFunction(() => document.body.innerText.includes('JellyfinMod'), undefined, { timeout: 30000 });
    await page.waitForTimeout(6000);
    const details = await page.evaluate(() => document.body.innerText);
    record('The plugin page shows its version, Active, and no repository error',
        !details.includes('An error occurred') && details.includes('0.1.0.0') && /Active/.test(details),
        { error: details.includes('An error occurred'), active: /Active/.test(details) });
    const plugins = await api('Plugins');
    const plugin = plugins.body?.find(item => item.Name === 'JellyfinMod');
    record('The server reports the plugin Active', plugin?.Status === 'Active', { version: plugin?.Version, status: plugin?.Status });

    record('No page errors', pageErrors.length === 0, pageErrors);
} catch (error) {
    record('Runner completed', false, String(error).slice(0, 300));
} finally {
    await browser.close();
}
const failed = results.filter(ok => !ok).length;
console.log(`${results.length - failed} of ${results.length} passed`);
process.exit(failed ? 1 : 0);
