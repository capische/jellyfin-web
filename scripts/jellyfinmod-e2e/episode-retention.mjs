/* eslint-disable compat/compat, no-restricted-globals, @stylistic/max-statements-per-line -- a Node acceptance runner, not shipped code: the browserslist targets TV clients rather than this script */
/* global window, document, ApiClient, localStorage, location */
// P10.E4 acceptance probe: an episode page's own mod section, in a real browser against the isolated instance.
//
//   JELLYFINMOD_TEST_URL=http://<host>:18096/ JELLYFINMOD_BASE_PATH=/web-mod/ \
//   JELLYFINMOD_EPISODES=desktop:<item>,mobile:<item>,tv1080:<item>,tv720:<item> \
//   JELLYFINMOD_KEPT_EPISODE=<item> JELLYFINMOD_SERIES=<item> node episode-retention.mjs
//
// JELLYFINMOD_BROWSER=chromium|chrome   Playwright's bundled Chromium (default) or real Google Chrome
// Each layout keeps a different disposable fixture episode, because Keep is one-way. TV layouts use the keyboard only:
// arrow keys to reach Keep, Enter to press it and the History toggle, and the remote's Back key to leave the page.
// Signs in as oleksii with an empty password; no credential is read or printed. Exits non-zero on any failure.
import { chromium } from 'playwright';

const testUrl = new URL(process.env.JELLYFINMOD_TEST_URL ?? (() => { throw new Error('JELLYFINMOD_TEST_URL is required'); })());
if (testUrl.port !== '18096') throw new Error('The episode retention probe runs on the isolated test instance only');
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
const base = new URL(process.env.JELLYFINMOD_BASE_PATH ?? '/web-mod/', testUrl).href;
const episodes = Object.fromEntries((process.env.JELLYFINMOD_EPISODES ?? '').split(',').filter(Boolean).map(pair => pair.split(':')));
const keptEpisode = process.env.JELLYFINMOD_KEPT_EPISODE;
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
    await page.waitForSelector(selector, { timeout: 30000 });
    await page.waitForTimeout(800);
};

const keepButton = page => page.locator('.jfmod-nativeActions button', { hasText: /^(Keep|Kept|Keeping…)$/ });
const activeIsKeep = page => page.evaluate(() => {
    const el = document.activeElement;
    return !!el && el.closest('.jfmod-nativeActions') !== null && /^(Keep|Kept|Keeping…)$/.test(el.textContent.trim());
});

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

        // The series page keeps the series-level Keep and lists every episode's retention.
        if (seriesItem && name === 'desktop') {
            await openDetails(page, seriesItem);
            const section = page.locator('section[aria-label="JellyfinMod"]');
            record(name, 'series page has no episode binding and offers series Keep',
                !await section.getAttribute('data-jfmod-episode-id') && await keepButton(page).count() === 1);
        }

        if (keptEpisode && name === 'desktop') {
            await openDetails(page, keptEpisode);
            const pressed = await keepButton(page).getAttribute('aria-pressed');
            const status = await page.locator('.jfmod-retentionStatus').first().textContent();
            record(name, 'an episode kept through the API shows Kept on its own page', pressed === 'true' && /Kept indefinitely/.test(status), { pressed, status });
        }

        await openDetails(page, itemId);
        const section = page.locator('section[aria-label="JellyfinMod"]');
        const episodeId = await section.getAttribute('data-jfmod-episode-id');
        record(name, 'episode page resolves its own tracked episode', !!episodeId, { episodeId });
        const before = await keepButton(page).getAttribute('aria-pressed');
        // JELLYFINMOD_ALLOW_KEPT=1 re-checks an episode an earlier run already kept (Keep is one-way).
        const alreadyKept = before === 'true' && process.env.JELLYFINMOD_ALLOW_KEPT === '1';
        record(name, alreadyKept ? 'episode was kept by an earlier run' : 'episode Keep starts unpressed',
            before === 'false' || alreadyKept, { before });

        if (alreadyKept && layout.tv) {
            let reached = await activeIsKeep(page);
            for (let step = 0; step < 40 && !reached; step++) {
                await page.keyboard.press(await page.evaluate(() => !!document.activeElement?.closest('.jfmod-nativeActions')) ? 'ArrowRight' : 'ArrowDown');
                await page.waitForTimeout(250);
                reached = await activeIsKeep(page);
            }
            record(name, 'Keep is reachable by arrow keys', reached);
        } else if (layout.tv) {
            // Keyboard only: walk the page with the arrow keys until Keep has focus, then press Enter.
            // Down until focus enters the mod's action row, then right along the row to Keep.
            const inActions = () => page.evaluate(() => !!document.activeElement?.closest('.jfmod-nativeActions'));
            let reached = await activeIsKeep(page);
            for (let step = 0; step < 40 && !reached; step++) {
                await page.keyboard.press(await inActions() ? 'ArrowRight' : 'ArrowDown');
                await page.waitForTimeout(250);
                reached = await activeIsKeep(page);
            }
            record(name, 'Keep is reachable by arrow keys', reached);
            await page.keyboard.press('Enter');
        } else {
            await keepButton(page).click();
        }

        await page.waitForFunction(() => {
            const button = [...document.querySelectorAll('.jfmod-nativeActions button')].find(b => /^(Keep|Kept|Keeping…)$/.test(b.textContent.trim()));
            return button?.getAttribute('aria-pressed') === 'true';
        }, undefined, { timeout: 20000 });
        if (!alreadyKept) {
            const message = await page.locator('section[aria-label="JellyfinMod"] p[role=status]').textContent();
            record(name, 'Keep keeps this episode and says so', /This episode will be kept/.test(message), { message });
            if (layout.tv) record(name, 'focus stays on Keep after it succeeds', await activeIsKeep(page));
        }

        const kept = await page.evaluate(async ([entryId, id]) => {
            const detail = await ApiClient.getJSON(ApiClient.getUrl('JellyfinMod/Entries/' + entryId)).catch(() => null);
            if (!detail) return null;
            return {
                episode: detail.episodes.find(candidate => candidate.id === id)?.retentionPolicy,
                series: detail.entry.retentionPolicy,
                history: detail.history.filter(event => event.episodeId === id).map(event => event.summary)
            };
        }, [await section.getAttribute('data-jfmod-entry-id'), episodeId]);
        if (kept) {
            record(name, 'server records Keep on the episode only', kept.episode === 'never' && kept.series === 'inherit',
                { episode: kept.episode, series: kept.series });
        }

        // History lists this episode's own events.
        const toggle = page.locator('section[aria-label="JellyfinMod"] [aria-expanded]').last();
        if (layout.tv) {
            // From Keep, the way a viewer would: down first, then back along the action row and down from its start.
            const onToggle = () => page.evaluate(() => !!document.activeElement?.hasAttribute('aria-expanded')
                && /History/.test(document.activeElement.textContent));
            const path = [];
            let reachedToggle = false;
            for (const [key, times] of [['ArrowDown', 3], ['ArrowUp', 3], ['ArrowLeft', 6], ['ArrowDown', 3]]) {
                for (let step = 0; step < times && !reachedToggle; step++) {
                    await page.keyboard.press(key);
                    await page.waitForTimeout(250);
                    path.push(key.replace('Arrow', ''));
                    reachedToggle = await onToggle();
                }
                if (reachedToggle) break;
            }
            record(name, 'History toggle is reachable by arrow keys', reachedToggle, path.join(' '));
            await page.keyboard.press('Enter');
        } else {
            await toggle.click();
        }
        await page.waitForTimeout(500);
        const events = await page.locator('section[aria-label="JellyfinMod"] ol li').allTextContents();
        // The page lists exactly the events the server attributes to this episode, its Keep among them.
        const expected = kept?.history ?? [];
        record(name, 'episode History lists exactly this episode\'s events', events.length === expected.length
            && expected.every(summary => events.some(text => text.endsWith(summary)))
            && events.some(text => /Kept S01E\d\d indefinitely/.test(text)), events);

        if (layout.tv) {
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
