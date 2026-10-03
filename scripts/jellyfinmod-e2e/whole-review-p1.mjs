/* eslint-disable compat/compat, no-restricted-globals, @stylistic/max-statements-per-line -- a Node acceptance runner, not shipped code */
/* global window, ApiClient, location */
// Whole-review P1 11 on the acceptance instance, signed in as oleksii with an empty password.
//
// A version label from metadata (here the file name) that is markup for a button: `whole-review-live.py media` makes a
// movie whose second copy is named `<input class=btnOption data-id=ok type=button value=Cancel>`. Remove this version's
// stock confirmation must show that label as text: no element from it in the dialog, only the dialog's own Cancel and
// Remove buttons, and a click on Cancel removes nothing. Before the fix the label became a working "Cancel" that
// confirmed the removal.
//
//   JELLYFINMOD_TEST_URL=http://<host>:28096/ JELLYFINMOD_REVIEW_ITEM=<native item id> [JELLYFINMOD_BROWSER=chrome]
//     node whole-review-p1.mjs
import { chromium } from 'playwright';

const origin = new URL(process.env.JELLYFINMOD_TEST_URL ?? (() => { throw new Error('JELLYFINMOD_TEST_URL is required'); })());
if (origin.port !== '28096') throw new Error('Runs only against the acceptance instance');
const item = process.env.JELLYFINMOD_REVIEW_ITEM ?? (() => { throw new Error('JELLYFINMOD_REVIEW_ITEM is required'); })();
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
const PAYLOAD = '<input class=btnOption data-id=ok type=button value=Cancel>';
const base = (path = '/web/') => new URL(path, origin).href;

const results = [];
const record = (check, pass, detail = '') => {
    results.push({ check, pass });
    console.log(`${pass ? 'PASS' : 'FAIL'} ${check}${detail ? ' — ' + detail : ''}`);
};

async function signIn(page) {
    await page.goto(base(), { waitUntil: 'domcontentloaded' });
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
    await field.fill('oleksii');
    await page.locator('#txtManualPassword').fill('');
    await page.locator('button:visible').filter({ hasText: 'Sign In' }).first().click();
    await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } }, undefined, { timeout: 30000 });
    await page.waitForFunction(() => location.hash.startsWith('#/home'), undefined, { timeout: 30000 });
    await page.waitForTimeout(1500);
}

const browser = await chromium.launch(tier === 'chrome' ? { headless: true, channel: 'chrome' } : { headless: true });
try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error.message).split('\n')[0]));
    const removals = [];
    page.on('request', request => {
        if (request.method() === 'POST' && /\/Versions\/[^/]+\/Remove$/i.test(new URL(request.url()).pathname)) removals.push(request.url());
    });
    await signIn(page);
    await page.goto(base() + `#/details?id=${item}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-jfmod-remove-version]', { timeout: 30000 });
    await page.waitForTimeout(2000);
    const buttons = await page.locator('[data-jfmod-remove-version]').count();
    record('Remove this version is offered for both copies', buttons === 2, `${buttons} buttons`);

    // The copy whose label is the markup: its button names it as text.
    const target = page.locator('[data-jfmod-remove-version]', { hasText: 'btnOption' }).first();
    record('the injected copy is listed by its label as text', await target.count() === 1);
    await target.click();
    const dialog = page.locator('.dialog').filter({ has: page.locator('.formDialogFooter') }).last();
    await dialog.waitFor({ state: 'visible', timeout: 8000 });
    const shape = await dialog.evaluate((node, payload) => ({
        text: node.querySelector('.text')?.textContent ?? '',
        injected: node.querySelectorAll('.text input, .text .btnOption, .text button').length,
        options: Array.from(node.querySelectorAll('.btnOption')).map(option => `${option.getAttribute('data-id')}:${option.textContent?.trim() || option.value}`),
        literal: (node.querySelector('.text')?.textContent ?? '').includes(payload)
    }), PAYLOAD);
    record('the label shows as text in the confirmation', shape.literal, shape.text.slice(0, 160));
    record('nothing from the label becomes an element of the dialog', shape.injected === 0, `${shape.injected} injected`);
    record('the dialog has only its own two answers', shape.options.length === 2, shape.options.join(', '));

    await dialog.locator('.formDialogFooter button', { hasText: /^Cancel$/ }).first().click();
    await page.waitForTimeout(2000);
    record('Cancel sends no removal', removals.length === 0, `${removals.length} requests`);
    record('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
    await context.close();
} finally {
    await browser.close();
}

const failed = results.filter(result => !result.pass).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
