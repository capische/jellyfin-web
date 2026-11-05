/* eslint-disable compat/compat, no-restricted-globals, @stylistic/max-statements-per-line -- a Node acceptance runner, not shipped code: the browserslist targets TV clients rather than this script */
/* global window, document, ApiClient, localStorage, location */
// P10.E4 acceptance probe: an episode page's own mod section, in a real browser against the isolated instance.
//
//   JELLYFINMOD_TEST_URL=http://<host>:18096/ JELLYFINMOD_BASE_PATH=/web-mod/ \
//   JELLYFINMOD_EPISODES=desktop:<item>,mobile:<item>,tv1080:<item>,tv720:<item> \
//   JELLYFINMOD_SERIES=<item> node episode-retention.mjs
//
// JELLYFINMOD_BROWSER=chromium|chrome   Playwright's bundled Chromium (default) or real Google Chrome
// Keep moved to each file's pin in the Video list (per-file Keep, 2026-10-12), which can be taken back: each layout keeps its
// episode's first file, proves it on the server and after a reload, reads the file's History, and takes the Keep back.
// TV layouts use the keyboard only: arrow keys to reach the pin, Enter to press it, and the remote's Back key to leave the page.
// Signs in as oleksii with an empty password; no credential is read or printed. Exits non-zero on any failure.
import { chromium } from 'playwright';

const testUrl = new URL(process.env.JELLYFINMOD_TEST_URL ?? (() => { throw new Error('JELLYFINMOD_TEST_URL is required'); })());
if (!['18096', '58096'].includes(testUrl.port) && !(testUrl.hostname === '127.0.0.1' && ['9096', '10096', '11096', '12096'].includes(testUrl.port))) throw new Error('The episode retention probe runs on the isolated test instance or the local pool only');
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
const base = new URL(process.env.JELLYFINMOD_BASE_PATH ?? '/web-mod/', testUrl).href;
const episodes = Object.fromEntries((process.env.JELLYFINMOD_EPISODES ?? '').split(',').filter(Boolean).map(pair => pair.split(':')));
const seriesItem = process.env.JELLYFINMOD_SERIES;

const LAYOUTS = {
    desktop: { viewport: { width: 1440, height: 900 }, tv: false },
    mobile: {
        viewport: { width: 390, height: 844 }, tv: false, isMobile: true, hasTouch: true,
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
    },
    tv1080: { viewport: { width: 1920, height: 1080 }, tv: true },
    tv720: { viewport: { width: 1280, height: 720 }, tv: true }
};

let failures = 0;
const record = (layout, check, ok, detail) => {
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'} [${layout}] ${check}${detail === undefined ? '' : ' :: ' + JSON.stringify(detail)}`);
};

const browser = await chromium.launch({ headless: true, ...(tier === 'chrome' ? { channel: 'chrome' } : {}) });
console.log('browser', tier, browser.version());

async function signIn(page) {
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.ApiClient, undefined, { timeout: 30000 });
    await page.waitForFunction(() => {
        try { return !!ApiClient.getCurrentUserId() || /login|selectuser|selectserver/.test(location.hash); } catch { return /login|selectuser/.test(location.hash); }
    }, undefined, { timeout: 30000 });
    if (await page.evaluate(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } })) return;
    const field = page.locator('#txtManualName');
    if (!await field.isVisible().catch(() => false)) {
        const chooser = page.locator('.btnManual').first();
        if (await chooser.count()) await chooser.evaluate(node => node.click());
        await field.waitFor({ state: 'visible', timeout: 15000 });
    }
    await field.fill('oleksii');
    await page.waitForTimeout(1000);
    await field.fill('oleksii');
    await page.locator('button:visible').filter({ hasText: 'Sign In' }).first().click();
    await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } }, undefined, { timeout: 30000 });
    // The app redirects to Home once sign-in settles; a hash set before that is overwritten.
    await page.waitForFunction(() => /#\/home/.test(location.hash), undefined, { timeout: 30000 }).catch(() => undefined);
    await page.waitForTimeout(1500);
}

const openDetails = async (page, itemId) => {
    const serverId = await page.evaluate(() => ApiClient.serverId());
    const selector = 'section[aria-label="JellyfinMod"][data-jfmod-entry-id]';
    await page.evaluate(([id, server]) => { location.hash = '#/details?id=' + id + '&serverId=' + server; }, [itemId, serverId]);
    await page.waitForFunction(id => location.hash.includes(id), itemId, { timeout: 15000 });
    await page.waitForSelector(selector, { state: 'attached', timeout: 30000 });
    await page.waitForTimeout(1500);
};

const pin = page => page.locator('[data-jfmod-file-pin]').first();
const pinFocused = page => page.evaluate(() => document.activeElement?.hasAttribute('data-jfmod-file-pin') ?? false);
const openVideoList = async (page, tv) => {
    const seg = page.locator('.jfds .gpk .seg.v').first();
    if (await pin(page).count()) return;
    if (tv) {
        await seg.focus();
        await page.keyboard.press('Enter');
    } else {
        await seg.click();
    }
    await pin(page).waitFor({ state: 'visible', timeout: 10000 });
};
/** The D-pad, from wherever the open list put focus, until the pin has it. */
const reachPin = async page => {
    for (let step = 0; step < 12 && !await pinFocused(page); step++) {
        await page.keyboard.press(step < 2 ? 'ArrowDown' : 'ArrowRight');
        await page.waitForTimeout(200);
    }
    return pinFocused(page);
};
const entryFacts = (page, entryId, episodeId) => page.evaluate(async ([entry, episode]) => {
    const detail = await ApiClient.getJSON(ApiClient.getUrl('JellyfinMod/Entries/' + entry));
    const row = detail.episodes.find(candidate => candidate.id === episode);
    return { episode: row?.retentionPolicy, series: detail.entry.retentionPolicy, history: detail.history.map(event => ({ type: event.eventType, summary: event.summary, binding: event.bindingId })) };
}, [entryId, episodeId]);

/** The webOS remote's Back key: keyCode 461, sent through the DevTools protocol as the TV shell expects. */
const pressRemoteBack = async page => {
    const client = await page.context().newCDPSession(page);
    try {
        for (const type of ['rawKeyDown', 'keyUp']) {
            await client.send('Input.dispatchKeyEvent', { type, windowsVirtualKeyCode: 461, nativeVirtualKeyCode: 461, key: 'GoBack', code: '' });
        }
    } finally {
        await client.detach();
    }
};

for (const [name, layout] of Object.entries(LAYOUTS)) {
    const itemId = episodes[name];
    if (!itemId) continue;
    const context = await browser.newContext({ viewport: layout.viewport, isMobile: layout.isMobile, hasTouch: layout.hasTouch, userAgent: layout.userAgent });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error.message).split('\n')[0]));
    try {
        await signIn(page);
        if (layout.tv) {
            await page.evaluate(() => { localStorage.setItem('layout', 'tv'); location.reload(); });
            await page.waitForFunction(() => !!window.ApiClient && document.documentElement.classList.contains('layout-tv'), undefined, { timeout: 30000 });
            await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } }, undefined, { timeout: 30000 });
        }

        // The series page has no episode binding; Keep Series is a More-menu item (user, 2026-10-12), read and not pressed.
        if (seriesItem && name === 'desktop') {
            await openDetails(page, seriesItem);
            const section = page.locator('section[aria-label="JellyfinMod"]');
            await page.locator('.jfmod-dsTitleHost .actbar [data-ds-command~=btnMoreCommands]').first().click();
            await page.waitForSelector('[data-ds-actionsheet]', { timeout: 10000 });
            const items = await page.locator('[data-ds-actionsheet] .mi').allInnerTexts();
            record(name, 'series page has no episode binding and offers Keep Series in More',
                !await section.getAttribute('data-jfmod-episode-id') && items.some(text => /Keep Series/.test(text)), items);
            await page.mouse.click(5, 450);
            await page.waitForTimeout(500);
        }

        await openDetails(page, itemId);
        const section = page.locator('section[aria-label="JellyfinMod"]');
        const entryId = await section.getAttribute('data-jfmod-entry-id');
        const episodeId = await section.getAttribute('data-jfmod-episode-id');
        record(name, 'episode page resolves its own tracked episode', !!episodeId, { episodeId });
        const start = await entryFacts(page, entryId, episodeId);
        await openVideoList(page, layout.tv);
        const before = await pin(page).getAttribute('aria-pressed');
        record(name, 'the file\'s Keep starts unpressed', before === 'false', { before, label: await pin(page).getAttribute('aria-label') });
        if (layout.tv) {
            record(name, 'a pin is reachable by arrow keys', await reachPin(page));
            await pin(page).focus();
            await page.keyboard.press('Enter');
        } else {
            await pin(page).click();
        }
        await page.waitForFunction(() => document.querySelector('[data-jfmod-file-pin]')?.getAttribute('aria-pressed') === 'true', undefined, { timeout: 20000 });
        const message = await page.evaluate(() => [...document.querySelectorAll('.toast, [role=status], [aria-live]')].map(node => node.textContent));
        record(name, 'Keep keeps this file and says so', message.some(text => /This file will be kept/.test(text)), { message });
        if (layout.tv) record(name, 'focus stays on the pin after it succeeds', await pinFocused(page));
        const kept = await entryFacts(page, entryId, episodeId);
        const added = kept.history.slice(0, kept.history.length - start.history.length);
        record(name, 'the server records Keep on the file only, not the episode or the series',
            kept.episode === start.episode && kept.series === start.series && added.some(event => !!event.binding), { episode: kept.episode, series: kept.series, added });
        const history = page.locator('[data-jfmod-file-history]').first();
        if (layout.tv) {
            await history.focus();
            await page.keyboard.press('Enter');
        } else {
            await history.click();
        }
        await page.locator('.hpop').waitFor({ state: 'visible', timeout: 10000 });
        const events = await page.locator('.hpop ol li').allTextContents();
        record(name, 'the file\'s History lists its Keep', events.some(text => /kept|keep/i.test(text)), events.slice(0, 5));
        if (layout.tv) await page.keyboard.press('Escape');
        else await page.locator('.hpop .hh .rb').click();
        await page.locator('.hpop').waitFor({ state: 'detached', timeout: 5000 });
        // The Keep survives a reload, and comes off again.
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('section[aria-label="JellyfinMod"]', { state: 'attached', timeout: 30000 });
        await page.waitForTimeout(2000);
        await openVideoList(page, layout.tv);
        record(name, 'the Keep is still there after a reload', await pin(page).getAttribute('aria-pressed') === 'true');
        if (layout.tv) {
            await pin(page).focus();
            await page.keyboard.press('Enter');
        } else {
            await pin(page).click();
        }
        await page.waitForFunction(() => document.querySelector('[data-jfmod-file-pin]')?.getAttribute('aria-pressed') === 'false', undefined, { timeout: 20000 });
        const restored = await entryFacts(page, entryId, episodeId);
        record(name, 'Stop Keeping restores the file', restored.episode === start.episode && restored.series === start.series && await pin(page).getAttribute('aria-pressed') === 'false', restored.history.slice(0, 2));

        if (layout.tv) {
            await page.keyboard.press('Escape'); // closes the Video list
            await page.waitForTimeout(400);
            await pressRemoteBack(page);
            await page.waitForTimeout(1500);
            const after = await page.evaluate(() => location.hash);
            record(name, 'remote Back leaves the episode page', !after.includes(itemId), { after: after.slice(0, 40) });
        }

        record(name, 'no page errors', errors.length === 0, errors);
    } catch (error) {
        record(name, 'probe completed', false, String(error?.message ?? error).split('\n')[0]);
    } finally {
        await page.evaluate(() => localStorage.removeItem('layout')).catch(() => undefined);
        await context.close();
    }
}

await browser.close();
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
/* eslint-enable compat/compat, no-restricted-globals, @stylistic/max-statements-per-line */
