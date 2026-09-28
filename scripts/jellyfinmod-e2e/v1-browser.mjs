/* eslint-disable compat/compat, no-restricted-globals, @stylistic/max-statements-per-line -- a Node acceptance runner, not shipped code */
/* global window, document, ApiClient, localStorage, location */
// V1 browser rows (docs/jellyfinmod/V1.md S7 rows 12, 13 and 20) on the acceptance instance, signed in as oleksii with an
// empty password: the version rows, choosing a row by Enter, Play asking for the chosen MediaSourceId, the device's copy
// (desktop keeps Jellyfin's default, mobile takes the 1080p, TV the 2160p HDR, a copy in progress always wins), Remove
// buttons for the administrator, and the warning inside stock Delete media's confirmation (cancelled, nothing deleted).
//
//   JELLYFINMOD_TEST_URL=http://<host>:28096/ JELLYFINMOD_V1_MOVIE=<Prefer main item id> [JELLYFINMOD_BROWSER=chrome] node v1-browser.mjs
import { chromium } from 'playwright';

const origin = new URL(process.env.JELLYFINMOD_TEST_URL ?? (() => { throw new Error('JELLYFINMOD_TEST_URL is required'); })());
if (origin.port !== '28096') throw new Error('Runs only against the acceptance instance');
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
const USER = 'oleksii';
const base = (path = '/web/') => new URL(path, origin).href;
const LAYOUTS = {
    desktop: { viewport: { width: 1440, height: 900 } },
    mobile: {
        viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
    },
    tv1080: { viewport: { width: 1920, height: 1080 }, tv: true },
    tv720: { viewport: { width: 1280, height: 720 }, tv: true }
};
const launch = () => chromium.launch(tier === 'chrome' ? { headless: true, channel: 'chrome' } : { headless: true });
async function newPage(browser, layoutName = 'desktop', options = {}) {
    const layout = LAYOUTS[layoutName];
    const context = await browser.newContext({ viewport: layout.viewport, isMobile: layout.isMobile, hasTouch: layout.hasTouch,
        userAgent: layout.userAgent, serviceWorkers: 'block', ...options });
    const page = await context.newPage();
    page.jfmodErrors = [];
    page.on('pageerror', error => page.jfmodErrors.push(String(error.message).split('\n')[0]));
    return { context, page };
}
async function signIn(page, path = '/web/', user = USER) {
    await page.goto(base(path), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.ApiClient, undefined, { timeout: 30000 });
    await page.waitForFunction(() => {
        try { return !!ApiClient.getCurrentUserId() || /login|selectuser|selectserver/.test(location.hash); } catch { return false; }
    }, undefined, { timeout: 30000 });
    if (await page.evaluate(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } })) return;
    const field = page.locator('#txtManualName');
    if (!await field.isVisible().catch(() => false)) {
        const chooser = page.locator('.btnManual').first();
        await chooser.waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
        if (await chooser.count()) await chooser.evaluate(node => node.click());
        await field.waitFor({ state: 'visible', timeout: 15000 });
    }
    await page.waitForTimeout(1000);
    await field.fill(user);
    await page.locator('#txtManualPassword').fill('');
    await page.locator('button:visible').filter({ hasText: 'Sign In' }).first().click();
    await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } }, undefined, { timeout: 30000 });
    await page.waitForFunction(() => location.hash.startsWith('#/home'), undefined, { timeout: 30000 });
    await page.waitForTimeout(1500);
}
async function setTvLayout(page) {
    await page.evaluate(() => localStorage.setItem('layout', 'tv'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } }, undefined, { timeout: 30000 });
    await page.waitForTimeout(2500);
}

const movie = process.env.JELLYFINMOD_V1_MOVIE;
const results = [];
const record = (layout, check, pass, detail = '') => {
    results.push({ layout, check, pass, detail });
    console.log(`${pass ? 'PASS' : 'FAIL'} [${layout}] ${check}${detail ? ' — ' + detail : ''}`);
};

const selectValue = page => page.evaluate(() => document.querySelector('.selectSource')?.value ?? null);
const optionLabels = page => page.evaluate(() => Array.from(document.querySelector('.selectSource')?.options ?? [])
    .map(option => ({ value: option.value, text: option.textContent })));

async function openDetail(page) {
    await page.goto(base('/web/') + `#/details?id=${movie}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.jfmod-versions .jfmod-versionRow', { timeout: 30000 });
    await page.waitForTimeout(2500);
}

async function checkDeleteWarning(page, layout, label) {
        // Stock Delete media: the warning is inside upstream's own confirmation; Cancel, nothing deleted.
        await page.locator('.btnMoreCommands:visible').first().click({ timeout: 5000 });
        await page.locator('.actionSheetMenuItem[data-id="delete"]').first().click({ timeout: 5000 });
        const warning = page.locator('.dialog .jfmod-deleteWarning');
        await warning.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
        const text = await warning.textContent().catch(() => null);
        if (!text) {
            console.log('DEBUG item', await page.evaluate(async id => {
                const response = await fetch(ApiClient.getUrl('Items/' + id), { headers: { Authorization: ApiClient.getAuthorizationHeader?.() ?? '' } });
                return response.status + ' ' + (await response.text()).slice(0, 80);
            }, movie));
            console.log('DEBUG', await page.evaluate(() => JSON.stringify({
                note: document.querySelector('.jfmod-versionsNote')?.textContent?.slice(0, 40) ?? null,
                layoutClass: document.documentElement.className.slice(0, 80),
                armed: document.body.dataset.jfmodDeleteWarning ?? null,
                heading: Array.from(document.querySelectorAll('.dialog .formDialogHeaderTitle')).map(node => node.textContent),
                text: Array.from(document.querySelectorAll('.dialog .text')).map(node => (node.textContent ?? '').slice(0, 60)),
                dialogs: document.querySelectorAll(".dialog").length, warnings: document.querySelectorAll(".jfmod-deleteWarning").length
            })));
        }
        record(layout, `stock Delete confirmation carries the warning${label}`, !!text && text.includes('3 files'), (text ?? 'none').slice(0, 80));
        await page.locator('.dialog button', { hasText: /Cancel/i }).first().click({ timeout: 5000 });
        await page.waitForTimeout(800);
        record(layout, `Cancel leaves the title in place${label}`, await page.locator('.jfmod-versions .jfmod-versionRow').count() >= 3);
}

async function checkLayout(browser, layout) {
    const { context, page } = await newPage(browser, layout);
    try {
        await signIn(page);
        if (LAYOUTS[layout].tv) await setTvLayout(page);
        await openDetail(page);
        const rows = await page.locator('.jfmod-versions .jfmod-versionRow:not(.jfmod-versionRow--add)').allTextContents();
        record(layout, 'three version rows with resolution and codec', rows.length === 3 &&
            rows.every(text => /(2160p|1080p|720p)/.test(text) && /(H\.264|HEVC)/.test(text)), rows.map(text => text.slice(0, 40)).join(' | '));
        const options = await optionLabels(page);
        const value = await selectValue(page);
        const chosen = options.find(option => option.value === value)?.text ?? '';
        const expected = { desktop: null, mobile: '1080p', tv1080: '2160p', tv720: '2160p' }[layout];
        const firstOption = options[0]?.value;
        record(layout, 'the device starts on its copy', expected === null ? value === firstOption : chosen.includes(expected),
            `selected "${chosen.trim()}"`);
        const removeButtons = await page.locator('[data-jfmod-remove-version]').count();
        record(layout, 'Remove buttons for the administrator', removeButtons === 3, `${removeButtons}`);

        await checkDeleteWarning(page, layout, '');
        // Choose the 720p row by keys, then Play: the request names that media source.
        const row720 = page.locator('.jfmod-versionRow', { hasText: '720p' }).first();
        await row720.focus();
        await page.keyboard.press('Enter');
        await page.waitForTimeout(800);
        const after = await selectValue(page);
        const want = await row720.getAttribute('data-jfmod-media-source-id');
        record(layout, 'Enter on a row drives the stock select', after?.replace(/-/g, '') === want, `${after}`);
        const requests = [];
        page.on('request', request => { if (/PlaybackInfo|\/stream/.test(request.url())) requests.push(request.url()); });
        await page.locator('.btnPlay:visible, .detailButton-primary:visible').first().click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(4000);
        // The stock player asks for the chosen copy itself: its PlaybackInfo, or a stream naming it as the media source.
        record(layout, 'Play asks for the chosen media source', requests.some(url => url.toLowerCase().includes(`/items/${want}/playbackinfo`) ||
            url.toLowerCase().includes(`mediasourceid=${want}`)),
            requests[0]?.replace(/^https?:\/\/[^/]+/, '').slice(0, 120) ?? 'no request');
        await page.keyboard.press('Escape').catch(() => {});
        await page.goBack().catch(() => {});
        await openDetail(page);
        await checkDeleteWarning(page, layout, ' (after playback and Back)');

        record(layout, 'no page errors', page.jfmodErrors.length === 0, page.jfmodErrors.slice(0, 2).join(' | '));
    } catch (error) {
        record(layout, 'layout ran', false, String(error.message).split('\n')[0]);
    } finally {
        await context.close();
    }
}

const browser = await launch();
for (const layout of (process.env.JELLYFINMOD_LAYOUTS ?? 'desktop,mobile,tv1080,tv720').split(',')) await checkLayout(browser, layout);
await browser.close();
const failed = results.filter(result => !result.pass).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
