/* eslint-disable compat/compat, no-restricted-globals, sonarjs/cognitive-complexity -- a Node acceptance runner, not shipped code */
/* global window, document, ApiClient, location */
// P7.S7 acceptance: the Dashboard plugin page saves and re-reads through the typed settings endpoints.
//
//   JELLYFINMOD_TEST_URL=http://<host>:<isolated-port>/ JELLYFINMOD_BROWSER=chromium|chrome node settings-dashboard.mjs
//
// Signs in as oleksii with an empty password. Changes the retention days by one and puts them back, runs the TMDB
// and seed-protection Tests (read-only), and leaves every value as it found it.
import { chromium } from 'playwright';

const testUrl = new URL(process.env.JELLYFINMOD_TEST_URL ?? (() => { throw new Error('JELLYFINMOD_TEST_URL is required'); })());
if (!['18096', '28096'].includes(testUrl.port)) throw new Error('Runs on the isolated instances only');
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
const base = new URL('/web/', testUrl).href;
const results = [];
const record = (check, ok, detail) => {
    results.push({ check, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${check}${detail === undefined ? '' : ' :: ' + JSON.stringify(detail)}`);
};

const browser = await chromium.launch(tier === 'chrome' ? { headless: true, channel: 'chrome' } : { headless: true });
console.log('browser', tier, browser.version());
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error.message).split('\n')[0]));
const settingsResponses = [];
page.on('response', async response => {
    if (/\/JellyfinMod\/Settings\//.test(response.url())) settingsResponses.push(await response.text().catch(() => ''));
});

async function signIn() {
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
}

async function openPage() {
    // A cold load of #/configurationpage lands on Home, so arrive the way an administrator does: from the Dashboard.
    await page.goto(base + '#/dashboard/plugins', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => location.hash.startsWith('#/dashboard/plugins'), undefined, { timeout: 30000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => { location.hash = '#/configurationpage?name=JellyfinMod'; });
    await page.locator('.jfmod-step[data-section="retention"]').waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForFunction(() => !document.querySelector('.docspinner:not(.hide)') || true);
    await page.waitForFunction(() => document.querySelector('#ReclaimAfterDays')?.value !== '', undefined, { timeout: 30000 });
}

const noticeText = slot => page.locator(`[data-notice="${slot}"] .jfmod-notice-text`).innerText({ timeout: 30000 });

try {
    await signIn();
    await openPage();

    await page.locator('.jfmod-step[data-section="discovery"]').click();
    const discoveryState = await page.locator('[data-secstate="discovery"]').innerText();
    record('Discovery shows the moved token as configured', /Read access token configured/.test(discoveryState), discoveryState);
    await page.locator('#TestDiscovery').click();
    const discoveryNotice = await noticeText('discovery');
    record('Discovery Test reports a code and a sentence', /\((ok|unauthorized|timeout|unreachable|not_configured)\)$/.test(discoveryNotice), discoveryNotice);
    await page.locator('[data-notice="discovery"]').waitFor();
    const testedState = await page.locator('[data-secstate="discovery"]').innerText();
    record('A passing Test marks discovery tested', /tested/.test(testedState) && !/not tested/.test(testedState), testedState);

    await page.locator('.jfmod-step[data-section="retention"]').click();
    const days = await page.locator('#ReclaimAfterDays').inputValue();
    const source = await page.locator('#SeedProtectionSource').inputValue();
    record('Retention and seed protection load from the typed endpoints', days !== '' && ['acquisitionClient', 'separate'].includes(source),
        { days, source });
    await page.locator('#TestSeedProtection').click();
    const seedNotice = await noticeText('seedprotection');
    record('Seed-protection Test reports a code and a sentence', /\((ok|unauthorized|timeout|unreachable|not_configured|invalid_response)\)/.test(seedNotice), seedNotice);

    const changed = String(Number(days) + 1);
    await page.locator('#ReclaimAfterDays').fill(changed);
    await page.locator('[data-submit="retention"]').click();
    await page.waitForFunction(value => document.querySelector('[data-savemeta="retention"]')?.textContent.includes('Retention revision') &&
        !document.querySelector('[data-notice="retention"] .jfmod-notice-err'), changed, { timeout: 30000 });
    const meta = await page.locator('[data-savemeta="retention"]').innerText();
    await openPage();
    await page.locator('.jfmod-step[data-section="retention"]').click();
    const reread = await page.locator('#ReclaimAfterDays').inputValue();
    record('A retention save re-reads when the page is opened again', reread === changed, { saved: changed, reread, meta });

    await page.locator('#ReclaimAfterDays').fill(days);
    await page.locator('[data-submit="retention"]').click();
    await page.waitForFunction(value => document.querySelector('#ReclaimAfterDays')?.value === value &&
        !document.querySelector('[data-notice="retention"] .jfmod-notice-err'), days, { timeout: 30000 });
    await openPage();
    record('The original retention days are restored', await page.locator('#ReclaimAfterDays').inputValue() === days, days);

    const leaked = settingsResponses.filter(body => /sec_[0-9a-f]/.test(body));
    record('No settings response carries a secret reference', leaked.length === 0, { responses: settingsResponses.length });
    record('No page errors', errors.length === 0, errors.slice(0, 3));
} catch (error) {
    record('run completed', false, 'NOT VERIFIED: ' + String(error?.message ?? error).split('\n')[0]);
} finally {
    await browser.close();
}

const failed = results.filter(result => !result.ok).length;
console.log(`${results.length - failed} of ${results.length} checks pass`);
process.exit(failed ? 1 : 0);
