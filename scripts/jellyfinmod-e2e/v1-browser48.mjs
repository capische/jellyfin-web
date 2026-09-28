/* eslint-disable compat/compat, no-restricted-globals, @stylistic/max-statements-per-line -- a Node acceptance runner, not shipped code */
/* global window, document, ApiClient, localStorage, location */
// V1 row 20 (part) on the live instance 48096 (docs/jellyfinmod/V1.md S7): on a title with several versions,
//   admin      Get another quality from the version row, reached and opened by keys, opens the picker (held quality
//              marked); Back (the Escape key in the TV layout, the browser's Back on desktop) closes it and focus returns
//              to that row; desktop and TV 1920x1080;
//   ordinary   an ordinary user sees the version rows but no Remove and no Get another quality;
//   oldplugin  with the pre-V1 plugin loaded: no version rows, no Get another quality or Remove, and no warning in the
//              stock Delete confirmation (cancelled, nothing deleted); no page error.
//
//   JELLYFINMOD_TEST_URL=http://127.0.0.1:48096/ JELLYFINMOD_V1_MOVIE=<main item id> JELLYFINMOD_V1_MODE=admin|ordinary|oldplugin
//   [JELLYFINMOD_V1_USER=<ordinary user with an empty password>] [JELLYFINMOD_BROWSER=chrome] node v1-browser48.mjs
import { chromium } from 'playwright';

const origin = new URL(process.env.JELLYFINMOD_TEST_URL ?? (() => { throw new Error('JELLYFINMOD_TEST_URL is required'); })());
if (origin.port !== '48096') throw new Error('Runs only against the live instance on port 48096');
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
const mode = process.env.JELLYFINMOD_V1_MODE ?? 'admin';
const USER = mode === 'ordinary' ? process.env.JELLYFINMOD_V1_USER : 'oleksii';
if (!USER) throw new Error('JELLYFINMOD_V1_USER is required for the ordinary mode');
const movie = process.env.JELLYFINMOD_V1_MOVIE;
const base = (path = '/web/') => new URL(path, origin).href;
const LAYOUTS = { desktop: { viewport: { width: 1440, height: 900 } }, tv1080: { viewport: { width: 1920, height: 1080 }, tv: true } };
const launch = () => chromium.launch(tier === 'chrome' ? { headless: true, channel: 'chrome' } : { headless: true });

const results = [];
const record = (layout, check, pass, detail = '') => {
    results.push({ layout, check, pass, detail });
    console.log(`${pass ? 'PASS' : 'FAIL'} [${tier} ${mode} ${layout}] ${check}${detail ? ' — ' + detail : ''}`);
};

async function signIn(page) {
    await page.goto(base(), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.ApiClient, undefined, { timeout: 30000 });
    await page.waitForFunction(() => {
        try { return !!ApiClient.getCurrentUserId() || /login|selectuser|selectserver/.test(location.hash); } catch { return false; }
    }, undefined, { timeout: 30000 });
    const field = page.locator('#txtManualName');
    if (!await field.isVisible().catch(() => false)) {
        const chooser = page.locator('.btnManual').first();
        await chooser.waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
        if (await chooser.count()) await chooser.evaluate(node => node.click());
        await field.waitFor({ state: 'visible', timeout: 15000 });
    }
    await page.waitForTimeout(1000);
    await field.fill(USER);
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

async function openDetail(page, expectRows = true) {
    await page.goto(base() + `#/details?id=${movie}`, { waitUntil: 'domcontentloaded' });
    if (expectRows) await page.waitForSelector('.jfmod-versions .jfmod-versionRow', { timeout: 30000 });
    else await page.waitForSelector('.detailPagePrimaryContainer, .itemName', { timeout: 30000 });
    await page.waitForTimeout(3000);
}

const activeIsAddRow = page => page.evaluate(() => !!document.activeElement?.classList.contains('jfmod-versionRow--add'));

async function adminLayout(page, layout) {
    const rows = await page.locator('.jfmod-versions .jfmod-versionRow:not(.jfmod-versionRow--add)').allTextContents();
    record(layout, 'version rows listed', rows.length >= 2, rows.map(text => text.slice(0, 30)).join(' | '));
    // Reach the Get another quality row by keys: arrow keys on TV, Tab on desktop.
    let reached = false;
    for (let presses = 0; presses < 60 && !reached; presses++) {
        await page.keyboard.press(LAYOUTS[layout].tv ? 'ArrowDown' : 'Tab');
        await page.waitForTimeout(LAYOUTS[layout].tv ? 250 : 60);
        reached = await activeIsAddRow(page);
    }
    record(layout, `Get another quality reached by ${LAYOUTS[layout].tv ? 'arrow keys' : 'Tab'}`, reached);
    if (!reached) await page.locator('.jfmod-versionRow--add').focus();
    await page.keyboard.press('Enter');
    const dialog = page.locator('.jfmod-releaseDialog');
    await dialog.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    const heading = await dialog.locator('.formDialogHeaderTitle').textContent().catch(() => null);
    record(layout, 'Enter opens the picker for another quality', !!heading && heading.startsWith('Another quality for'), heading ?? 'no dialog');
    await page.locator('.jfmod-releaseDialog .jfmod-releaseRow').first().waitFor({ state: 'visible', timeout: 60000 }).catch(() => {});
    const held = await page.locator('.jfmod-releaseDialog .jfmod-releaseHeld').count();
    const releases = await page.locator('.jfmod-releaseDialog .jfmod-releaseRow').count();
    record(layout, 'the picker marks the held quality', held >= 1, `${held} held of ${releases} rows`);
    // Back: on TV the remote's Back arrives as Escape (stock keyboardNavigation maps it to 'back' in the TV layout only);
    // on desktop Back is the browser's own Back, which the stock dialog helper follows through its history entry.
    if (LAYOUTS[layout].tv) await page.keyboard.press('Escape'); else await page.goBack();
    await dialog.waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(800);
    record(layout, `Back (${LAYOUTS[layout].tv ? 'Escape key' : 'browser Back'}) closes the picker`, await dialog.count() === 0);
    record(layout, 'focus returns to the Get another quality row', await activeIsAddRow(page),
        await page.evaluate(() => document.activeElement?.className?.toString().slice(0, 60) ?? 'none'));
    record(layout, 'still on the title', (await page.evaluate(() => location.hash)).includes(movie));
}

async function ordinaryLayout(page, layout) {
    const rows = await page.locator('.jfmod-versions .jfmod-versionRow:not(.jfmod-versionRow--add)').count();
    record(layout, 'the ordinary user sees the version rows', rows >= 2, `${rows}`);
    record(layout, 'no Remove this version', await page.locator('[data-jfmod-remove-version]').count() === 0);
    record(layout, 'no Get another quality', await page.locator('.jfmod-versionRow--add').count() === 0
        && await page.getByText('Get another quality').count() === 0);
}

async function oldPluginLayout(page, layout) {
    const rowCount = await page.locator('.jfmod-versions .jfmod-versionRow:not(.jfmod-versionRow--add)').count();
    record(layout, 'no version rows', rowCount === 0, `${rowCount} rows`);
    const addCount = await page.locator('.jfmod-versionRow--add').count();
    record(layout, 'no Get another quality', addCount === 0, `${addCount}`);
    const removeCount = await page.locator('[data-jfmod-remove-version]').count();
    record(layout, 'no Remove this version', removeCount === 0, `${removeCount}`);
    const sources = await page.evaluate(() => document.querySelectorAll('.selectSource option').length);
    record(layout, 'the stock version select still lists the versions', sources >= 2, `${sources} options`);
    await page.locator('.btnMoreCommands:visible').first().click({ timeout: 5000 });
    await page.locator('.actionSheetMenuItem[data-id="delete"]').first().click({ timeout: 5000 });
    await page.locator('.dialog').last().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const confirmation = await page.locator('.dialog').last().textContent().catch(() => '');
    const warning = await page.locator('.jfmod-deleteWarning').first().textContent().catch(() => null);
    record(layout, 'stock Delete confirmation without the warning', !warning && /delete/i.test(confirmation ?? ''),
        warning ? `warning: ${warning.slice(0, 90)}` : (confirmation ?? '').replace(/\s+/g, ' ').slice(0, 80));
    await page.locator('.dialog button', { hasText: /Cancel/i }).first().click({ timeout: 5000 });
    await page.waitForTimeout(1000);
    record(layout, 'Cancel leaves the title in place', (await page.evaluate(() => location.hash)).includes(movie));
}

const browser = await launch();
for (const layout of (process.env.JELLYFINMOD_LAYOUTS ?? 'desktop,tv1080').split(',')) {
    const context = await browser.newContext({ viewport: LAYOUTS[layout].viewport, serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error.message).split('\n')[0]));
    try {
        await signIn(page);
        if (LAYOUTS[layout].tv) await setTvLayout(page);
        await openDetail(page, mode !== 'oldplugin');
        await { admin: adminLayout, ordinary: ordinaryLayout, oldplugin: oldPluginLayout }[mode](page, layout);
        record(layout, 'no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
    } catch (error) {
        record(layout, 'layout ran', false, String(error.message).split('\n')[0]);
    } finally {
        if (LAYOUTS[layout].tv) await page.evaluate(() => localStorage.removeItem('layout')).catch(() => {});
        await context.close();
    }
}
await browser.close();
const failed = results.filter(result => !result.pass).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
