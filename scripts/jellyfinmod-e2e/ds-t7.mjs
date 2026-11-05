/* eslint-disable compat/compat, no-restricted-globals, @stylistic/max-statements-per-line -- a Node acceptance runner, not shipped code */
/* global window, document, ApiClient, localStorage, location */
// The last round's small findings, live on a local pool environment as oleksii with an empty password: a cached Preferences page
// stops its form scan while hidden and starts it again on show; upstream's sentence-case action labels read in Title Case on a
// title page; Escape from the selection menu raises no unhandled rejection; a title row's round action has its 40 px target.
//
//   JELLYFINMOD_TEST_URL=http://127.0.0.1:<pool port>/  JELLYFINMOD_T7_MOVIE=<item id of a movie with a file>  JELLYFINMOD_T7_SEASON=<season item id>
//   [JELLYFINMOD_BROWSER=chromium|chrome]
import { chromium } from 'playwright';

const origin = new URL(process.env.JELLYFINMOD_TEST_URL ?? (() => { throw new Error('JELLYFINMOD_TEST_URL is required'); })());
if (origin.hostname !== '127.0.0.1' || !['9096', '10096', '11096', '12096'].includes(origin.port)) throw new Error('Runs on 127.0.0.1 at the local pool only');
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
let failures = 0;
const record = (check, ok, detail) => {
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'} [${tier}] ${check}${detail === undefined ? '' : ' :: ' + JSON.stringify(detail).slice(0, 400)}`);
};
const browser = await chromium.launch(tier === 'chrome' ? { channel: 'chrome' } : {});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
// Every 500 ms timer, as the page starts and clears them.
await context.addInitScript(() => {
    const set = window.setInterval.bind(window);
    const clear = window.clearInterval.bind(window);
    window.scans = new Set();
    window.setInterval = (fn, ms, ...args) => {
        const id = set(fn, ms, ...args);
        if (ms === 500) window.scans.add(id);
        return id;
    };
    window.clearInterval = id => {
        window.scans.delete(id);
        clear(id);
    };
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(String(error.message).split('\n')[0]));
await page.goto(new URL('/web/', origin).href, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId() || /login|selectuser|selectserver/.test(location.hash); } catch { return false; } }, undefined, { timeout: 30000 });
if (!await page.evaluate(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } })) {
    const field = page.locator('#txtManualName');
    await Promise.race([field.waitFor({ state: 'visible', timeout: 15000 }), page.locator('.btnManual').first().waitFor({ state: 'attached', timeout: 15000 })]);
    if (!await field.isVisible().catch(() => false)) await page.locator('.btnManual').first().evaluate(node => node.click());
    await field.waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(800);
    await field.fill('oleksii');
    await page.locator('#txtManualPassword').fill('');
    await page.locator('button:visible').filter({ hasText: 'Sign In' }).first().click();
    await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } }, undefined, { timeout: 30000 });
}
const go = async (hash, selector) => {
    await page.evaluate(target => { location.hash = target; }, hash);
    await page.waitForSelector(selector, { timeout: 30000 });
    await page.waitForTimeout(1500);
};
const scans = () => page.evaluate(() => window.scans.size);

// 1. A hidden Preferences page.
await go('#/home', '.hero2, .homePage:not(.hide)');
const atHome = await scans();
await go('#/mypreferencesdisplay', '.page:not(.hide) .jfmod-dsPrefsHost .scard');
const shown = await scans();
await go('#/home', '.homePage:not(.hide)');
const hidden = await scans();
record('a hidden Preferences page stops its 500 ms form scan', shown === atHome + 1 && hidden === atHome, { atHome, shown, hidden });
await page.goBack();
await page.waitForSelector('.page:not(.hide) .jfmod-dsPrefsHost .scard', { timeout: 30000 });
await page.waitForTimeout(1500);
record('shown again, the page scans again', await scans() === atHome + 1, await scans());

// 2. Title Case, on a title page's actions and a row's.
await go('#/details?id=' + process.env.JELLYFINMOD_T7_MOVIE, '.jfmod-dsTitleHost .actbar [data-ds-command~=btnPlaystate]');
const labels = selector => page.evaluate(sel => [...document.querySelectorAll(sel)].map(node => [node.getAttribute('data-tip'), node.getAttribute('aria-label')]).flat().filter(Boolean), selector);
const pill = await labels('.page:not(.hide) .jfmod-dsTitleHost .actbar button');
record('the title page\'s action labels are Title Case, Mark Played among them', pill.includes('Mark Played') && !pill.some(text => /^Mark played$|^Mark unplayed$/.test(text)), pill);
await go('#/details?id=' + process.env.JELLYFINMOD_T7_SEASON, '.jfmod-dsTitleHost .ep .acts');
const rows = await labels('.page:not(.hide) .jfmod-dsTitleHost .ep .acts button');
record('a row\'s action labels are Title Case', rows.length > 0 && !rows.some(text => /^Mark played$|^Add to favorites$/.test(text)), [...new Set(rows)]);

// 3. A row action's target: 2.5em to the eye, 40 px to the pointer.
const target = await page.evaluate(() => {
    const row = document.querySelector('.page:not(.hide) .jfmod-dsTitleHost .ep .acts button');
    if (!row) return null;
    const box = row.getBoundingClientRect();
    return { size: Math.round(box.width), hits: [[19.5, 0], [-19.5, 0], [0, 19.5], [0, -19.5]].every(([dx, dy]) => document.elementFromPoint(box.left + box.width / 2 + dx, box.top + box.height / 2 + dy)?.closest('button') === row) };
});
record('a title row\'s round action answers 19.5 px from its centre in all four directions', !!target?.hits && target.size >= 37, target);

// 4. Escape from the selection menu: long-press equivalent is the card's Select, then the panel's menu.
await go('#/movies?topParentId=' + process.env.JELLYFINMOD_T7_LIBRARY, '.cell[data-id]');
await page.locator('.cell[data-id]').first().click({ button: 'right' });
await page.waitForSelector('[data-ds-actionsheet] [data-id="multiSelect"]', { timeout: 10000 });
await page.locator('[data-ds-actionsheet] [data-id="multiSelect"]').click();
await page.waitForSelector('.selectionCommandsPanel', { timeout: 10000 });
await page.waitForTimeout(600);
await page.locator('.selectionCommandsPanel .btnSelectionPanelOptions').click();
await page.waitForSelector('[data-ds-actionsheet]', { timeout: 10000 });
const before = errors.length;
await page.keyboard.press('Escape');
await page.waitForTimeout(1000);
record('Escape from the selection menu raises no unhandled rejection', errors.length === before && !await page.locator('[data-ds-actionsheet]').count(), errors.slice(before));
await page.locator('.selectionCommandsPanel .btnCloseSelectionPanel').click();
await page.waitForTimeout(500);
record('no page errors', errors.length === 0, errors.slice(0, 3));
await browser.close();
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
/* eslint-enable compat/compat, no-restricted-globals, @stylistic/max-statements-per-line */
