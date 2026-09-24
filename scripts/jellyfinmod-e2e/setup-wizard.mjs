/* eslint-disable compat/compat, no-restricted-globals, sonarjs/cognitive-complexity -- a Node acceptance runner, not shipped code */
/* global window, document, ApiClient, location, localStorage */
// P7.S10 acceptance: the first-run wizard and the Home banner, on a configured instance, reversibly.
//
//   JELLYFINMOD_TEST_URL=http://<host>:<isolated-port>/ JELLYFINMOD_BROWSER=chromium|chrome node settings-area.mjs
//
// JELLYFINMOD_SETTINGS_LAYOUTS=desktop,mobile,tv1080,tv720
// Signs in as oleksii with an empty password. Saves the TMDB token unchanged, which advances the discovery revision
// and makes step 1 incomplete again without touching any value; the wizard's own Test then completes it.
import { chromium } from 'playwright';

const testUrl = new URL(process.env.JELLYFINMOD_TEST_URL ?? (() => { throw new Error('JELLYFINMOD_TEST_URL is required'); })());
if (!['18096', '28096'].includes(testUrl.port)) throw new Error('Runs on the isolated instances only');
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
const base = new URL('/web/', testUrl).href;
const only = (process.env.JELLYFINMOD_SETTINGS_LAYOUTS ?? 'desktop,mobile,tv1080').split(',');
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

const unverify = page => page.evaluate(async () => {
    const url = ApiClient.getUrl('JellyfinMod/Settings/Discovery');
    const current = await ApiClient.ajax({ type: 'GET', url, dataType: 'json' });
    await ApiClient.ajax({ type: 'PATCH', url, contentType: 'application/json', dataType: 'json',
        data: JSON.stringify({ token: { action: 'unchanged' }, revision: current.revision }) });
});
const setupState = page => page.evaluate(() => ApiClient.ajax({ type: 'GET', url: ApiClient.getUrl('JellyfinMod/Setup/State'), dataType: 'json' }));

for (const name of only) {
    const layout = LAYOUTS[name];
    const context = await browser.newContext({ viewport: layout.viewport, isMobile: layout.isMobile, hasTouch: layout.hasTouch, userAgent: layout.userAgent });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error.message).split('\n')[0]));
    try {
        await signIn(page);
        if (layout.tv) {
            await page.evaluate(() => localStorage.setItem('layout', 'tv'));
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } }, undefined, { timeout: 30000 });
            await page.waitForTimeout(2000);
        }
        const initial = await setupState(page);
        if (initial.dismissedAt) throw new Error('setup was dismissed on this instance; the banner cannot be shown');
        await unverify(page);
        await page.evaluate(() => { location.hash = '#/home'; });
        await page.reload({ waitUntil: 'domcontentloaded' });
        const banner = page.locator('.jfmod-setupBanner');
        await banner.waitFor({ state: 'visible', timeout: 30000 });
        record(name, 'An incomplete setup shows the Home banner to an administrator', true, await banner.innerText());
        if (layout.tv) await page.evaluate(() => { location.hash = '#/catalog/settings/setup'; });
        else await banner.locator('a, button', { hasText: 'Set up' }).click();
        await page.locator('.jfmod-check').waitFor({ state: 'visible', timeout: 30000 });
        const step = await page.locator('.jfmod-step[aria-current="true"]').getAttribute('data-step');
        const cont = page.locator('[data-wizard="continue"]');
        record(name, 'The wizard opens at the first incomplete step with Continue refused', step === 'discovery' && await cont.isDisabled(), { step });
        if (layout.tv) {
            await page.locator('[data-test="discovery"]').focus();
            await page.keyboard.press('Enter');
        } else {
            await page.locator('[data-test="discovery"]').click();
        }
        await page.waitForFunction(() => document.querySelector('[data-wizard-state]')?.getAttribute('data-wizard-state') === 'done', undefined, { timeout: 60000 });
        record(name, 'A passing Test completes the step and unlocks Continue', !await cont.isDisabled());
        if (layout.tv) {
            await cont.focus();
            await page.keyboard.press('Enter');
        } else {
            await cont.click();
        }
        await page.waitForTimeout(800);
        record(name, 'Continue moves to the next step', await page.locator('.jfmod-step[aria-current="true"]').getAttribute('data-step') === 'downloadClient');
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.locator('.jfmod-check').waitFor({ state: 'visible', timeout: 30000 });
        const state = await setupState(page);
        record(name, 'Setup is complete again once the wizard\'s Test passed', state.complete === true, { complete: state.complete });
        if (layout.tv) {
            await page.evaluate(() => { location.hash = '#/home'; });
            await page.waitForTimeout(2500);
            await page.evaluate(() => { location.hash = '#/catalog/settings/setup'; });
            await page.locator('.jfmod-check').waitFor({ state: 'visible', timeout: 30000 });
            await page.keyboard.press('Escape');
            await page.waitForTimeout(1500);
            record(name, 'TV: Back leaves the wizard', await page.evaluate(() => !location.hash.includes('settings/setup')), await page.evaluate(() => location.hash));
        }
        await page.evaluate(() => { location.hash = '#/home'; });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(4000);
        record(name, 'With setup complete the banner is gone', await banner.count() === 0);
        if (name === 'mobile') {
            await page.evaluate(() => { location.hash = '#/catalog/settings/setup'; });
            await page.locator('.jfmod-check').waitFor({ state: 'visible', timeout: 30000 });
            record(name, 'Mobile: the wizard has no horizontal scroll', await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 1);
        }
        record(name, 'No page errors', errors.length === 0, errors.slice(0, 3));
    } catch (error) {
        const where = await page.evaluate(() => `${location.hash} banner=${document.querySelectorAll('.jfmod-setupBanner').length} check=${document.querySelectorAll('.jfmod-check').length}`).catch(() => '?');
        record(name, 'run completed', false, 'NOT VERIFIED: ' + String(error?.message ?? error).split('\n')[0] + ' @ ' + where);
    } finally {
        await page.evaluate(() => localStorage.removeItem('layout')).catch(() => {});
        await context.close();
    }
}

await browser.close();
const failed = results.filter(result => !result.ok).length;
console.log(`${results.length - failed} of ${results.length} checks pass`);
process.exit(failed ? 1 : 0);
