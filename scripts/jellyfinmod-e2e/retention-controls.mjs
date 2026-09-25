/* eslint-disable compat/compat, no-restricted-globals, @stylistic/max-statements-per-line -- a Node acceptance runner, not shipped code: the browserslist targets TV clients rather than this script */
/* global window, document, ApiClient, localStorage, location */
// PHASE10 E6/E8 acceptance probe: the retention warning, Keep inside it, Stop keeping, the episode window and the
// per-file Keep, in a real browser against the isolated instance, on desktop, mobile and TV by keyboard.
//
//   JELLYFINMOD_TEST_URL=http://<host>:<port>/ JELLYFINMOD_BASE_PATH=/web-mod/ \
//   JELLYFINMOD_WARNED=desktop:<item>,mobile:<item>,tv1080:<item> JELLYFINMOD_SYNCED=<item> \
//   JELLYFINMOD_VERSIONED=<item> JELLYFINMOD_SERIES=<item> node retention-controls.mjs
//
// Second review (RET2): JELLYFINMOD_OVERDUE=<item> is an episode whose warning date has passed (R5);
// JELLYFINMOD_COVERING=<item>:<episode id> is a multi-episode file and the tracked row that holds it (R7);
// JELLYFINMOD_ORDINARY=<item> is checked as a disposable ordinary user (R10), created through the administrator's session
// with a password generated in memory, never printed or stored, and deleted afterwards.
// JELLYFINMOD_BROWSER=chromium|chrome   Playwright's bundled Chromium (default) or real Google Chrome.
// Every Keep a layout makes it takes back, so the fixture's schedule is left as it was. Signs in as the
// administrator with an empty password; no credential is read or printed. Exits non-zero on any failure.
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright';

const testUrl = new URL(process.env.JELLYFINMOD_TEST_URL ?? (() => { throw new Error('JELLYFINMOD_TEST_URL is required'); })());
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
const base = new URL(process.env.JELLYFINMOD_BASE_PATH ?? '/web-mod/', testUrl).href;
const warned = Object.fromEntries((process.env.JELLYFINMOD_WARNED ?? '').split(',').filter(Boolean).map(pair => pair.split(':')));
const synced = process.env.JELLYFINMOD_SYNCED;
const versioned = process.env.JELLYFINMOD_VERSIONED;
const seriesItem = process.env.JELLYFINMOD_SERIES;
const overdueItem = process.env.JELLYFINMOD_OVERDUE;
const [coveringItem, coveringEpisode] = (process.env.JELLYFINMOD_COVERING ?? '').split(':');
const ordinaryItem = process.env.JELLYFINMOD_ORDINARY;

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

async function signIn(page, name = 'oleksii', password = '') {
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
    await field.fill(name);
    await page.waitForTimeout(1000);
    await field.fill(name);
    if (password) await page.locator('#txtManualPassword').fill(password);
    await page.locator('button:visible').filter({ hasText: 'Sign In' }).first().click();
    await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } }, undefined, { timeout: 30000 });
    await page.waitForFunction(() => /#\/home/.test(location.hash), undefined, { timeout: 30000 }).catch(() => undefined);
    await page.waitForTimeout(1500);
}

const SECTION = 'section[aria-label="JellyfinMod"]';

const openDetails = async (page, itemId) => {
    const serverId = await page.evaluate(() => ApiClient.serverId());
    await page.evaluate(([id, server]) => { location.hash = '#/details?id=' + id + '&serverId=' + server; }, [itemId, serverId]);
    await page.waitForFunction(id => location.hash.includes(id), itemId, { timeout: 15000 });
    await page.waitForSelector(SECTION + '[data-jfmod-entry-id]', { timeout: 30000 });
    await page.waitForTimeout(1000);
};

const status = page => page.locator(SECTION + ' p[role=status]').first().textContent();
const waitStatus = (page, pattern) => page.waitForFunction(([selector, source]) =>
    new RegExp(source).test(document.querySelector(selector)?.textContent ?? ''), [SECTION + ' p[role=status]', pattern.source], { timeout: 20000 });
const warningText = page => page.locator('.jfmod-retentionWarning').first().textContent().catch(() => null);

/**
 * Moves focus with the arrow keys only until `matches(active element)` holds: Down until focus is in the mod section,
 * then Right along a row, and Down when Right leads nowhere new.
 */
const focusByKeys = async (page, matches, limit = 60) => {
    const path = [];
    const seenAfterRight = new Set();
    const where = () => page.evaluate(() => {
        const el = document.activeElement;
        return el ? el.outerHTML.slice(0, 160) + '|' + [...el.parentElement?.children ?? []].indexOf(el) : '';
    });
    for (let step = 0; step < limit; step++) {
        if (await page.evaluate(matches)) return { reached: true, path: path.join(' ') };
        const before = await where();
        const inSection = await page.evaluate(selector => !!document.activeElement?.closest(selector), SECTION);
        let key = 'ArrowDown';
        if (inSection && !seenAfterRight.has(before)) key = 'ArrowRight';
        await page.keyboard.press(key);
        await page.waitForTimeout(200);
        const after = await where();
        if (key === 'ArrowRight') {
            seenAfterRight.add(before);
            if (after === before) seenAfterRight.add(after);
        }
        const label = await page.evaluate(() => (document.activeElement?.textContent ?? '').trim().slice(0, 18));
        path.push(key.replace('Arrow', '') + (before === after ? '·' : '') + (process.env.JELLYFINMOD_TRACE ? `[${label}]` : ''));
    }
    return { reached: await page.evaluate(matches), path: path.join(' ') };
};

const activate = async (page, layout, name, matches, locator) => {
    if (layout.tv) {
        const { reached, path } = await focusByKeys(page, matches);
        record(name, 'reachable by arrow keys: ' + matches.toString().match(/'([^']+)'/)?.[1], reached, reached ? undefined : path);
        await page.keyboard.press('Enter');
    } else if (layout.isMobile) {
        await locator.tap();
    } else {
        await locator.click();
    }
};

const isWarningKeep = () => !!document.activeElement?.closest('.jfmod-retentionWarning') && document.activeElement.tagName === 'BUTTON';
const isStopKeeping = () => document.activeElement?.textContent?.trim() === 'Stop keeping';
const isFirstVersionKeep = () => /^(Keep|Stop keeping) 480p \(1\)$/.test(document.activeElement?.textContent?.trim() ?? '');

/** The warning, Keep inside it, Stop keeping; every layout. Leaves the episode as it found it. */
const warningFlow = async (page, layout, name, itemId, cause) => {
    await openDetails(page, itemId);
    const text = await warningText(page);
    record(name, 'the warning names the date, the cause and the file', !!text && /Added to retention: this file will be deleted on .+ unless kept\./.test(text)
        && new RegExp('Why: ' + cause.replace(/[()]/g, '\\$&')).test(text) && /S01E\d\d(-E\d\d)?\.mkv/.test(text), text);
    const keepInside = page.locator('.jfmod-retentionWarning button');
    record(name, 'administrators get Keep inside the warning', await keepInside.count() === 1 && /Keep this episode/.test(await keepInside.textContent()));
    await activate(page, layout, name, isWarningKeep, keepInside);
    await waitStatus(page, /This episode will be kept\./);
    await page.waitForTimeout(500);
    record(name, 'Keep inside the warning keeps the episode and the warning goes', await page.locator('.jfmod-retentionWarning').count() === 0);
    const stop = page.locator(SECTION + ' button', { hasText: /^Stop keeping$/ });
    record(name, 'Stop keeping is offered for an episode kept by itself', await stop.count() === 1);
    await activate(page, layout, name, isStopKeeping, stop);
    await waitStatus(page, /This episode is no longer kept\./);
    await page.waitForSelector('.jfmod-retentionWarning', { timeout: 20000 }).catch(() => undefined);
    record(name, 'after Stop keeping the warning is back with a restarted date', await page.locator('.jfmod-retentionWarning').count() === 1,
        await warningText(page));
};

const toTv = async page => {
    await page.evaluate(() => { localStorage.setItem('layout', 'tv'); location.reload(); });
    await page.waitForFunction(() => !!window.ApiClient && document.documentElement.classList.contains('layout-tv'), undefined, { timeout: 30000 });
    await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } }, undefined, { timeout: 30000 });
};

/** RET2-R5 and R7, as the administrator: a passed date reads as overdue; a double file opens the row that holds it. */
const reviewTwoAdminChecks = async (page, layout, name) => {
    if (overdueItem) {
        await openDetails(page, overdueItem);
        const text = await warningText(page);
        record(name, 'a passed date reads as overdue, never as a past countdown (RET2-R5)',
            !!text && /Added to retention: (this file was|these \d+ files were) due on .+ and will be deleted at the next retention run unless kept\./.test(text), text);
        if (layout.tv) {
            const { reached, path } = await focusByKeys(page, isWarningKeep);
            record(name, 'Keep inside the overdue warning is reachable by arrow keys', reached, reached ? undefined : path);
        }
    }
    if (coveringItem) {
        await openDetails(page, coveringItem);
        const shown = await page.locator(SECTION).first().getAttribute('data-jfmod-episode-id');
        record(name, 'a multi-episode file opens the row that holds it, not a covered row (RET2-R7)',
            shown?.replace(/-/g, '').toLowerCase() === coveringEpisode.replace(/-/g, '').toLowerCase(), shown);
    }
};

/** RET2-R10: an ordinary user reads the date and cause, no file names, and gets no Keep. */
const ordinaryChecks = async (name, layout, account) => {
    const context = await browser.newContext({ viewport: layout.viewport, isMobile: layout.isMobile, hasTouch: layout.hasTouch, userAgent: layout.userAgent });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error.message).split('\n')[0]));
    try {
        await signIn(page, account.name, account.password);
        if (layout.tv) await toTv(page);
        await openDetails(page, ordinaryItem);
        const text = await warningText(page);
        record(name + '/ordinary', 'an ordinary user reads the date and cause but no file names (RET2-R10)',
            !!text && /Added to retention: this episode (will be deleted on|was due on) .+ unless kept\./.test(text) && /Why: /.test(text)
            && !/\.mkv/.test(text) && await page.locator('.jfmod-retentionWarningFiles').count() === 0, text);
        record(name + '/ordinary', 'an ordinary user gets no Keep', await page.locator('.jfmod-retentionWarning button').count() === 0
            && await page.locator(SECTION + ' .jfmod-nativeActions button', { hasText: /Keep/ }).count() === 0);
        record(name + '/ordinary', 'no page errors', errors.length === 0, errors);
    } catch (error) {
        record(name + '/ordinary', 'probe completed', false, String(error?.message ?? error).split('\n')[0]);
    } finally {
        await page.evaluate(() => localStorage.removeItem('layout')).catch(() => undefined);
        await context.close();
    }
};

let ordinaryAccount = null;
let adminPage = null;

for (const [name, layout] of Object.entries(LAYOUTS)) {
    const context = await browser.newContext({ viewport: layout.viewport, isMobile: layout.isMobile, hasTouch: layout.hasTouch, userAgent: layout.userAgent });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error.message).split('\n')[0]));
    try {
        await signIn(page);
        if (ordinaryItem && !ordinaryAccount) {
            // The administrator's own session creates the disposable ordinary user; the password lives in this process only.
            const account = { name: 'jfmod-probe-' + randomBytes(4).toString('hex'), password: randomBytes(18).toString('base64url') };
            account.id = await page.evaluate(async ([user, pw]) => (await ApiClient.createUser({ Name: user, Password: pw })).Id,
                [account.name, account.password]);
            ordinaryAccount = account;
            adminPage = { context: await browser.newContext(), page: null };
            adminPage.page = await adminPage.context.newPage();
            await signIn(adminPage.page);
        }
        if (layout.tv) {
            await page.evaluate(() => { localStorage.setItem('layout', 'tv'); location.reload(); });
            await page.waitForFunction(() => !!window.ApiClient && document.documentElement.classList.contains('layout-tv'), undefined, { timeout: 30000 });
            await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } }, undefined, { timeout: 30000 });
        }

        if (name === 'desktop' && seriesItem) {
            // RET-R7: a page without an episode of its own keeps the series and says so on the button.
            await openDetails(page, seriesItem);
            const label = await page.locator('.jfmod-nativeActions button', { hasText: /series/ }).first().textContent().catch(() => null);
            record(name, 'the series page offers Keep series, not a bare Keep', /^(Keep series|Series kept)$/.test(label ?? ''), label);
        }

        if (warned[name]) await warningFlow(page, layout, name, warned[name], 'marked played');
        if (name === 'tv1080' && synced) await warningFlow(page, layout, name, synced, 'watched on another device (synced)');
        await reviewTwoAdminChecks(page, layout, name);

        if (name === 'desktop' && warned[name]) {
            // The episode's own window, through upstream's select.
            const select = page.locator('select[id^="jfmod-episode-window-"]');
            record(name, 'the episode window select is offered', await select.count() === 1);
            await select.selectOption('3');
            await waitStatus(page, /removed 3 days after watching/);
            record(name, 'choosing 3 days sets the episode window', /removed 3 days after watching/.test(await status(page)));
        }

        if (name === 'tv720' && versioned) {
            // Per-file Keep by keyboard, then taken back.
            await openDetails(page, versioned);
            const first = page.locator(SECTION + ' button', { hasText: /^(Keep|Stop keeping) 480p \(1\)$/ });
            record(name, 'each file of a two-file episode has its own Keep', await page.locator(SECTION + ' button', { hasText: /480p \(\d\)$/ }).count() === 2);
            // The file may already be kept (the fixture keeps one copy): the probe toggles it and toggles it back.
            const wasKept = await first.getAttribute('aria-pressed') === 'true';
            const kept = /This file will be kept\./;
            const unkept = /This file is no longer kept\./;
            await activate(page, layout, name, isFirstVersionKeep, first);
            await waitStatus(page, wasKept ? unkept : kept);
            record(name, 'Enter toggles the file\'s Keep and the button says so',
                await first.getAttribute('aria-pressed') === String(!wasKept) && (wasKept ? /^Keep/ : /^Stop keeping/).test(await first.textContent()));
            await page.keyboard.press('Enter');
            await waitStatus(page, wasKept ? kept : unkept);
            record(name, 'Enter again puts the file\'s Keep back', await first.getAttribute('aria-pressed') === String(wasKept));
        }

        if (layout.tv) {
            const current = await page.evaluate(() => new URLSearchParams(location.hash.split('?')[1]).get('id'));
            const client = await context.newCDPSession(page);
            for (const type of ['rawKeyDown', 'keyUp']) {
                await client.send('Input.dispatchKeyEvent', { type, windowsVirtualKeyCode: 461, nativeVirtualKeyCode: 461, key: 'GoBack', code: '' });
            }
            await client.detach();
            await page.waitForTimeout(1500);
            record(name, 'the remote Back key leaves the page it was on', !(await page.evaluate(() => location.hash)).includes(current));
        }
        record(name, 'no page errors', errors.length === 0, errors);
    } catch (error) {
        record(name, 'probe completed', false, String(error?.message ?? error).split('\n')[0]);
    } finally {
        await page.evaluate(() => localStorage.removeItem('layout')).catch(() => undefined);
        await context.close();
    }
}

if (ordinaryAccount) {
    for (const [name, layout] of Object.entries(LAYOUTS)) await ordinaryChecks(name, layout, ordinaryAccount);
    const gone = await adminPage.page.evaluate(async id => {
        await ApiClient.deleteUser(id);
        try { await ApiClient.getUser(id); return false; } catch { return true; }
    }, ordinaryAccount.id);
    record('all', 'the disposable ordinary user is deleted and gone', gone);
    await adminPage.context.close();
}

await browser.close();
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
/* eslint-enable compat/compat, no-restricted-globals, @stylistic/max-statements-per-line */
