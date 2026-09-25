/* eslint-disable compat/compat, no-restricted-globals, sonarjs/cognitive-complexity -- a Node acceptance runner, not shipped code */
/* global window, document, ApiClient, location, localStorage */
// P7.S11 D6 acceptance on the acceptance instance: an administrator's Queue renders its rows (it crashed with its
// first row before web 41b62de63d), the row menu opens as the stock action sheet and closes again: on the TV by Escape
// (the remote's Back); on desktop and mobile by Back, because upstream maps Escape to Back only on the TV layout — the
// runner shows that on the fork's stock entry side by side and records it as UPSTREAM, not as a failure.
//
//   JELLYFINMOD_TEST_URL=http://<host>:<isolated-port>/ JELLYFINMOD_BROWSER=chromium|chrome node queue-d6.mjs
//   JELLYFINMOD_D6_LAYOUTS=desktop,mobile,tv1080,tv720 (default)
//
// Desktop 1440×900 and mobile 390×844 click / tap the row's Actions button; TV (1920×1080, 1280×720) opens the Queue by
// address and uses keys only (arrows to reach a row, Enter to open the sheet, Escape as the remote's Back). Items are
// read by their data-id and never activated: nothing is removed or retried. Signs in as oleksii with an empty password.
import { chromium } from 'playwright';

const testUrl = new URL(process.env.JELLYFINMOD_TEST_URL ?? (() => { throw new Error('JELLYFINMOD_TEST_URL is required'); })());
if (!['18096', '28096'].includes(testUrl.port)) throw new Error('Runs on the isolated instances only');
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
const base = new URL('/web/', testUrl).href;
const only = (process.env.JELLYFINMOD_D6_LAYOUTS ?? 'desktop,mobile,tv1080,tv720').split(',');
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
const record = (layout, check, ok, detail) => {
    const verdict = ok === true ? 'PASS' : ok === false ? 'FAIL' : ok;
    results.push({ layout, check, verdict });
    console.log(`${verdict} [${tier}] [${layout}] ${check}${detail === undefined ? '' : ' :: ' + JSON.stringify(detail).slice(0, 400)}`);
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
        await chooser.waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
        if (await chooser.count()) await chooser.evaluate(node => node.click());
        await field.waitFor({ state: 'visible', timeout: 15000 });
    }
    await page.waitForTimeout(1000);
    await field.fill('oleksii');
    await page.locator('button:visible').filter({ hasText: 'Sign In' }).first().click();
    await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } }, undefined, { timeout: 30000 });
    await page.waitForFunction(() => location.hash.startsWith('#/home'), undefined, { timeout: 30000 });
}

const queueApi = page => page.evaluate(async () => {
    const response = await fetch(ApiClient.getUrl('JellyfinMod/Queue'), { headers: { Authorization: `MediaBrowser Token="${ApiClient.accessToken()}"` } });
    const body = await response.json();
    return { status: response.status, ids: (body.items ?? []).map(item => item.id), states: (body.items ?? []).map(item => item.state) };
});
const sheet = page => page.evaluate(() => {
    const dialog = [...document.querySelectorAll('.actionSheet')].find(node => node.getBoundingClientRect().width > 0 && node.closest('.dialogContainer'));
    if (!dialog) return null;
    return {
        ids: [...dialog.querySelectorAll('[data-id]')].map(node => node.getAttribute('data-id')),
        title: dialog.querySelector('.actionSheetTitle')?.textContent ?? null,
        focusInside: dialog.contains(document.activeElement)
    };
});
const focusInfo = page => page.evaluate(() => {
    const node = document.activeElement;
    return { tag: node?.tagName, cls: String(node?.className ?? '').slice(0, 80), queueId: node?.getAttribute?.('data-jfmod-queue-id') ?? null,
        label: node?.getAttribute?.('aria-label') ?? null };
});

for (const name of only) {
    const layout = LAYOUTS[name];
    const context = await browser.newContext({ viewport: layout.viewport, isMobile: layout.isMobile, hasTouch: layout.hasTouch, userAgent: layout.userAgent,
        serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error.message).split('\n')[0]));
    try {
        await signIn(page);
        if (layout.tv) {
            await page.evaluate(() => localStorage.setItem('layout', 'tv'));
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId() && document.documentElement.classList.contains('layout-tv'); } catch { return false; } },
                undefined, { timeout: 30000 });
            await page.waitForTimeout(2000);
        }
        const expected = await queueApi(page);
        await page.evaluate(() => { location.hash = '#/catalog/queue'; });
        const rowSelector = layout.tv ? '.jfmod-queueRow--tv' : name === 'mobile' ? '.jfmod-queueRow--stacked' : '.jfmod-queueTableRow';
        const rendered = await page.waitForFunction(({ sel, count }) => document.querySelectorAll('#jfmodQueuePage ' + sel).length >= count && count > 0,
            { sel: rowSelector, count: expected.ids.length }, { timeout: 30000 }).then(() => true, () => false);
        const view = await page.evaluate(sel => ({
            rows: document.querySelectorAll('#jfmodQueuePage ' + sel).length,
            layoutClass: document.querySelector('.jfmod-queue')?.className ?? null,
            errorBoundary: !!document.querySelector('.jfmod-errorBoundary, [data-jfmod-error]') || /Something went wrong|is not a function/.test(document.body.innerText),
            titles: [...document.querySelectorAll('#jfmodQueuePage .jfmod-queueTitle')].map(node => node.textContent)
        }), rowSelector);
        record(name, `The Queue renders every row the API lists (${expected.ids.length}, states ${expected.states.join(', ')}) with no error boundary`,
            rendered && view.rows === expected.ids.length && !view.errorBoundary, { ...view, api: expected.states });

        let opener;
        if (layout.tv) {
            // Keys only: the page focuses its first row, or arrows reach it.
            for (let press = 0; press < 8; press++) {
                if ((await focusInfo(page)).queueId) break;
                await page.keyboard.press('ArrowDown');
                await page.waitForTimeout(300);
            }
            opener = await focusInfo(page);
            record(name, 'Keys reach a Queue row', !!opener.queueId, opener);
            await page.keyboard.press('Enter');
        } else {
            const button = page.locator('#jfmodQueuePage .jfmod-queueMenu').first();
            opener = { label: await button.getAttribute('aria-label') };
            if (name === 'mobile') await button.tap(); else await button.click();
        }
        const opened = await page.waitForFunction(() => [...document.querySelectorAll('.actionSheet')].some(node => node.getBoundingClientRect().width > 0),
            undefined, { timeout: 10000 }).then(() => true, () => false);
        const shown = await sheet(page);
        record(name, 'The row menu opens the stock action sheet with the admin actions (read by data-id, none activated)',
            opened && !!shown && shown.ids.includes('remove'), shown);
        const sheetGone = () => page.waitForFunction(() => ![...document.querySelectorAll('.actionSheet')].some(node => node.getBoundingClientRect().width > 0),
            undefined, { timeout: 10000 }).then(() => true, () => false);
        await page.keyboard.press('Escape');
        const closed = await sheetGone();
        await page.waitForTimeout(700);
        const after = await focusInfo(page);
        const stillThere = await queueApi(page);
        if (layout.tv || closed) {
            record(name, 'Escape closes the menu, changes nothing, and focus returns to the opener' + (layout.tv ? ' row' : ''),
                closed && stillThere.ids.join() === expected.ids.join() && (layout.tv ? after.queueId === opener.queueId : /jfmod-queueMenu/.test(after.cls)),
                { closed, focus: after, queueUnchanged: stillThere.ids.join() === expected.ids.join() });
        } else {
            // Upstream keyboardNavigation.js maps Escape to Back only when layoutManager.tv; outside TV a stock dialog closes on
            // the browser's Back (dialogHelper's history entry) or a click outside. Check the fork's stock entry the same way.
            const itemId = await page.evaluate(async () => {
                const response = await fetch(ApiClient.getUrl('JellyfinMod/Queue'), { headers: { Authorization: `MediaBrowser Token="${ApiClient.accessToken()}"` } });
                return (await response.json()).items?.[0]?.entry?.jellyfinItemId ?? null;
            });
            const bundleId = await page.evaluate(() => document.querySelector('meta[name="jellyfinmod-web"]')?.content ?? null);
            const stock = await context.newPage();
            let stockVerdict = null;
            try {
                await stock.goto(new URL(`/web-mod/${bundleId}/index.html#/details?id=${itemId}`, testUrl).href, { waitUntil: 'domcontentloaded' });
                const more = stock.locator('.btnMoreCommands:visible').first();
                await more.waitFor({ state: 'visible', timeout: 30000 });
                await stock.waitForTimeout(1500);
                if (name === 'mobile') await more.tap(); else await more.click();
                const stockOpened = await stock.waitForFunction(() => [...document.querySelectorAll('.actionSheet')].some(node => node.getBoundingClientRect().width > 0),
                    undefined, { timeout: 10000 }).then(() => true, () => false);
                await stock.keyboard.press('Escape');
                const stockClosed = await stock.waitForFunction(() => ![...document.querySelectorAll('.actionSheet')].some(node => node.getBoundingClientRect().width > 0),
                    undefined, { timeout: 5000 }).then(() => true, () => false);
                stockVerdict = { stockEntry: true, opened: stockOpened, escapeClosed: stockClosed };
            } catch (error) {
                stockVerdict = { error: String(error.message).split('\n')[0] };
            }
            await stock.close();
            const identical = stockVerdict?.opened === true && stockVerdict.escapeClosed === false;
            record(name, 'Escape: not a close key outside TV, identical on the fork\'s stock entry (upstream keyboardNavigation.js)', identical ? 'UPSTREAM' : 'FAIL',
                { mod: { escapeClosed: closed }, stock: stockVerdict });
            await page.bringToFront();
            await page.goBack();
            const backClosed = await sheetGone();
            await page.waitForTimeout(700);
            const hashAfter = await page.evaluate(() => location.hash);
            const unchanged = (await queueApi(page)).ids.join() === expected.ids.join();
            record(name, 'Back closes the menu, stays on the Queue and changes nothing', backClosed && /^#\/catalog\/queue/.test(hashAfter) && unchanged,
                { backClosed, hash: hashAfter, queueUnchanged: unchanged });
        }
        record(name, 'No page errors', errors.length === 0, errors.slice(0, 3));
    } catch (error) {
        record(name, 'run', 'NOT VERIFIED', String(error.message).split('\n')[0]);
    }
    await page.evaluate(() => localStorage.removeItem('layout')).catch(() => {});
    await context.close();
}
await browser.close();
const failed = results.filter(result => result.verdict === 'FAIL' || result.verdict === 'NOT VERIFIED').length;
const upstream = results.filter(result => result.verdict === 'UPSTREAM').length;
console.log(`${results.length - failed - upstream} of ${results.length} checks passed, ${upstream} upstream, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
