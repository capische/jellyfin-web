/* eslint-disable compat/compat, no-restricted-globals, @stylistic/max-statements-per-line -- a Node acceptance runner, not shipped code */
/* global window, document, ApiClient, localStorage, location */
// The last round's small findings, live on a local pool environment as oleksii with an empty password: a cached Preferences page
// stops its form scan while hidden and starts it again on show; upstream's sentence-case action labels read in Title Case on a
// title page; Escape from the selection menu raises no unhandled rejection; a title row's round action has its 40 px target.
//
//   JELLYFINMOD_TEST_URL=http://127.0.0.1:<pool port>/  JELLYFINMOD_T7_MOVIE=<item id of an unplayed movie with a file>  JELLYFINMOD_T7_SEASON=<season item id>  JELLYFINMOD_T7_PLAYER=<item id with minutes of video>
//   [JELLYFINMOD_BROWSER=chromium|chrome]
import { chromium } from 'playwright';

const origin = new URL(process.env.JELLYFINMOD_TEST_URL ?? (() => { throw new Error('JELLYFINMOD_TEST_URL is required'); })());
if (origin.hostname !== '127.0.0.1' || !['9096', '10096', '11096', '12096'].includes(origin.port)) throw new Error('Runs on 127.0.0.1 at the local pool only');
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
let failures = 0;
const record = (check, ok, detail) => {
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'} [${tier}] ${check}${detail === undefined ? '' : ' :: ' + JSON.stringify(detail).slice(0, 900)}`);
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

// 5. Real Tab: never the browser's ring on what the design draws, on Home, a title page and in the player; the rulebook's on a pill's button.
const focusLook = () => page.evaluate(() => {
    const active = document.activeElement;
    if (!active || active === document.body) return null;
    const style = getComputedStyle(active);
    return { tag: active.tagName, cls: String(active.className), design: !!active.closest('.jfds'), visible: active.matches(':focus-visible'), outline: style.outlineStyle, width: parseFloat(style.outlineWidth), offset: parseFloat(style.outlineOffset), color: style.outlineColor, shadow: style.boxShadow, em: parseFloat(style.fontSize) };
});
const tabThrough = async (count, onMove) => {
    const looks = [];
    for (let index = 0; index < count; index++) {
        if (onMove) await onMove(index);
        await page.keyboard.press('Tab');
        await page.waitForTimeout(60);
        const look = await focusLook();
        if (look?.design && look.visible) looks.push(look);
    }
    return looks;
};
const PRIMARY = 'rgb(0, 164, 220)';
// The player's rating button keeps upstream's paper-icon class, whose !important outline gives way to the same primary colour as a 0.135em shadow.
const ringed = look => (look.outline === 'solid' && look.color === PRIMARY && Math.abs(look.width - 0.15 * look.em) < 0.8 && Math.abs(look.offset - 0.15 * look.em) < 0.8)
    || (look.cls.includes('paper-icon-button-light') && look.shadow.startsWith(PRIMARY));
await go('#/home', '.homePage:not(.hide)');
await page.mouse.move(2, 2);
let looks = await tabThrough(30);
record('Home by Tab: no stop draws the browser\'s ring', looks.length > 0 && looks.every(look => look.outline !== 'auto'), looks.filter(look => look.outline === 'auto').map(look => look.tag + '.' + look.cls));
await go('#/details?id=' + process.env.JELLYFINMOD_T7_MOVIE, '.jfmod-dsTitleHost .actbar button');
await page.mouse.move(2, 2);
looks = await tabThrough(30);
const pills = looks.filter(look => /(^|\s)(dbtn|play)(\s|$)/.test(look.cls));
record('a title page by Tab: no browser ring, and a pill\'s buttons draw the primary 0.15em ring 0.15em off', looks.every(look => look.outline !== 'auto') && pills.length > 0 && pills.every(ringed), pills.slice(0, 2));
// A title long enough for the player to stay up (JELLYFINMOD_T7_PLAYER, minutes of real video): its round Pause and row of buttons.
await go('#/details?id=' + process.env.JELLYFINMOD_T7_PLAYER, '.jfmod-dsTitleHost .actbar button');
await page.locator('.page:not(.hide) .jfmod-dsTitleHost .actbar button', { hasText: /^(Play|Resume)/ }).first().click();
await page.waitForFunction(() => location.hash.includes('/video'), undefined, { timeout: 30000 });
await page.waitForSelector('button.play.round.btnPause', { state: 'attached', timeout: 30000 });
await page.waitForTimeout(3000);
await page.mouse.move(700, 500);
await page.waitForTimeout(400);
// The bar shows while the pointer moves; the Tab order reaches it past the side menu's links.
looks = await tabThrough(40, async index => page.mouse.move(700 + index, 500));
const inPlayer = await page.evaluate(() => !!document.querySelector('button.play.round.btnPause')?.offsetParent);
const osd = looks.filter(look => /(^|\s)(dbtn|play)(\s|$)/.test(look.cls));
record('the player by Tab: no browser ring, and its Pause and buttons draw the primary ring', inPlayer && looks.every(look => look.outline !== 'auto') && osd.some(look => look.cls.includes('btnPause')) && osd.every(ringed), { inPlayer, stops: looks.length, classes: osd.map(look => look.cls.split(' ').slice(0, 3).join('.')), others: looks.filter(look => look.outline === 'auto' || (osd.includes(look) && !ringed(look))) });
await page.screenshot({ path: `${process.env.JELLYFINMOD_T7_SHOTS ?? '.'}/ds-t7-player-${tier}.png` }).catch(() => undefined);
await page.goBack();
await page.waitForTimeout(1500);
record('no page errors', errors.length === 0, errors.slice(0, 3));
await browser.close();
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
/* eslint-enable compat/compat, no-restricted-globals, @stylistic/max-statements-per-line */
