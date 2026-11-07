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

const sameId = (left, right) => !!left && !!right && left.replace(/-/g, '').toLowerCase() === right.replace(/-/g, '').toLowerCase();
/** ds.t12: File History, Keep and Remove act on the selected file from the title's More menu (its Selected Version group). */
const MORE = '.mainAnimatedPage:not(.hide) [data-ds-command~=btnMoreCommands]:not(.hide)';
const ENTRY = action => `[data-ds-actionsheet] .mi[data-id="jfmod-version-${action}"]`;
const openMore = async (page, tv) => {
    const more = page.locator(MORE).first();
    if (tv) {
        await more.focus();
        await page.keyboard.press('Enter');
    } else {
        await more.click();
    }
    await page.locator('[data-ds-actionsheet]').first().waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(300);
};
const closeMore = async page => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
};
/** The Keep entry's words for the selected file (`Keep This Version`, `Stop Keeping This Version`), read from a fresh More menu. */
const keepName = async (page, tv) => {
    await openMore(page, tv);
    const name = await page.locator(ENTRY('keep')).first().textContent({ timeout: 3000 }).catch(() => null);
    await closeMore(page);
    return name?.trim() ?? null;
};
const isKept = name => /^stop keeping/i.test(name ?? '');
/** Runs one Selected Version entry; on the TV by focus and Enter, as the remote's walk down the menu ends. */
const versionAction = async (page, tv, action) => {
    await openMore(page, tv);
    const entry = page.locator(ENTRY(action)).first();
    if (tv) {
        await entry.focus();
        await page.keyboard.press('Enter');
    } else {
        await entry.click();
    }
};
/** The binding of the file the stock Version select has selected. */
const selectedBinding = page => page.evaluate(async () => {
    const entry = document.querySelector('section[aria-label="JellyfinMod"][data-jfmod-entry-id]')?.getAttribute('data-jfmod-entry-id');
    const source = document.querySelector('.mainAnimatedPage:not(.hide) .selectSource')?.value ?? '';
    const detail = await ApiClient.getJSON(ApiClient.getUrl('JellyfinMod/Entries/' + entry));
    const all = [...(detail.versions ?? []), ...detail.episodes.flatMap(row => row.versions ?? [])];
    const norm = id => (id ?? '').replace(/-/g, '').toLowerCase();
    return (all.find(version => norm(version.mediaSourceId) === norm(source)) ?? all.find(version => version.isDefault) ?? all[0])?.bindingId ?? null;
});
/** What the server says: the episode's and series' policies, each file's Keep, and the whole history with its bindings. */
const entryFacts = (page, entryId, episodeId) => page.evaluate(async ([entry, episode]) => {
    const detail = await ApiClient.getJSON(ApiClient.getUrl('JellyfinMod/Entries/' + entry));
    const row = detail.episodes.find(candidate => candidate.id === episode);
    return { episode: row?.retentionPolicy, series: detail.entry.retentionPolicy,
        files: (row?.versions ?? []).map(version => ({ binding: version.bindingId, kept: version.kept === true })),
        history: detail.history.map(event => ({ id: event.id, type: event.eventType, summary: event.summary, binding: event.bindingId, at: event.createdAt })) };
}, [entryId, episodeId]);
const fileOf = (facts, binding) => facts.files.find(file => sameId(file.binding, binding));
const eventsOf = (facts, binding) => facts.history.filter(event => sameId(event.binding, binding));
/** A file's complete history as the popover must list it: newest first, the same words as the page's own map. */
const ACTION_WORDS = { grabbed: 'Grabbed', auto_grabbed: 'Grabbed', imported: 'Imported', version_kept: 'Kept', version_unkept: 'Stopped keeping', version_removed: 'Removed',
    upgrade_replaced: 'Removed', reclaimed: 'Removed', pack_replaced: 'Replaced', pack_replace_refused: 'Not replaced', pack_file_skipped: 'Skipped', pack_episode_skipped: 'Skipped' };
const expectedActions = (facts, binding) => eventsOf(facts, binding)
    .slice()
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .map(event => ACTION_WORDS[event.type] ?? event.summary.split(' ')[0] ?? event.type);
/** Puts a file's Keep back through the API, for a probe that stopped between pressing Keep and Stop Keeping. */
const setKept = (page, entryId, binding, kept) => page.evaluate(async ([entry, id, on]) => {
    const url = ApiClient.getUrl('JellyfinMod/Entries/' + encodeURIComponent(entry) + '/Versions/' + encodeURIComponent(id) + '/Keep');
    await ApiClient.ajax({ type: on ? 'POST' : 'DELETE', url });
}, [entryId, binding, kept]);

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
    let entryId = null;
    let protection = null;
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
        entryId = await section.getAttribute('data-jfmod-entry-id');
        const episodeId = await section.getAttribute('data-jfmod-episode-id');
        record(name, 'episode page resolves its own tracked episode', !!episodeId, { episodeId });
        const start = await entryFacts(page, entryId, episodeId);
        const binding = await selectedBinding(page);
        const startFile = fileOf(start, binding);
        const before = await keepName(page, layout.tv);
        // Stop here on anything but an unkept file: pressing Keep would change protection the probe did not set.
        const startsClean = !!startFile && startFile.kept === false && /^keep this version$/i.test(before ?? '');
        record(name, 'the selected file\'s Keep starts as Keep This Version in More, and unkept on the server', startsClean, { binding, before, server: startFile ?? null });
        if (!startsClean) continue;
        protection = { entryId, binding, kept: false };
        await versionAction(page, layout.tv, 'keep');
        await page.waitForFunction(([entry, id]) => ApiClient.getJSON(ApiClient.getUrl('JellyfinMod/Entries/' + entry)).then(detail => [...(detail.versions ?? []), ...detail.episodes.flatMap(row => row.versions ?? [])]
            .find(version => version.bindingId === id)?.kept === true), [entryId, binding], { timeout: 20000, polling: 1000 });
        const message = await page.evaluate(() => [...document.querySelectorAll('.toast, [role=status], [aria-live]')].map(node => node.textContent));
        record(name, 'Keep keeps this file and says so', message.some(text => /This file will be kept/.test(text)), { message });
        if (layout.tv) record(name, 'focus returns to More after Keep', await page.evaluate(() => !!document.activeElement?.matches('[data-ds-command~=btnMoreCommands]')));
        const kept = await entryFacts(page, entryId, episodeId);
        const added = kept.history.filter(event => !start.history.some(earlier => earlier.id === event.id));
        record(name, 'the server keeps this file only, not its other files, the episode or the series, and records it on this file',
            fileOf(kept, binding)?.kept === true && kept.files.every(file => sameId(file.binding, binding) || file.kept === fileOf(start, file.binding)?.kept)
            && kept.episode === start.episode && kept.series === start.series
            && added.length === 1 && added[0].type === 'version_kept' && sameId(added[0].binding, binding), { episode: kept.episode, series: kept.series, files: kept.files, added });
        await versionAction(page, layout.tv, 'history');
        await page.locator('.hpop').waitFor({ state: 'visible', timeout: 10000 });
        const shown = await page.locator('.hpop ol li [data-ds-history-action]').allTextContents();
        const expected = expectedActions(kept, binding);
        record(name, 'the file\'s History lists exactly this file\'s complete history, its Keep first',
            shown.length === expected.length && shown.every((action, index) => action === expected[index]) && shown[0] === 'Kept', { shown, expected });
        if (layout.tv) await page.keyboard.press('Escape');
        else await page.locator('.hpop .hh .rb').click();
        await page.locator('.hpop').waitFor({ state: 'detached', timeout: 5000 });
        // The Keep survives a reload, and comes off again.
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('section[aria-label="JellyfinMod"]', { state: 'attached', timeout: 30000 });
        await page.waitForTimeout(2000);
        record(name, 'the Keep is still there after a reload', isKept(await keepName(page, layout.tv)) && fileOf(await entryFacts(page, entryId, episodeId), binding)?.kept === true);
        await versionAction(page, layout.tv, 'keep');
        await page.waitForFunction(([entry, id]) => ApiClient.getJSON(ApiClient.getUrl('JellyfinMod/Entries/' + entry)).then(detail => [...(detail.versions ?? []), ...detail.episodes.flatMap(row => row.versions ?? [])]
            .find(version => version.bindingId === id)?.kept === false), [entryId, binding], { timeout: 20000, polling: 1000 });
        const restored = await entryFacts(page, entryId, episodeId);
        record(name, 'Stop Keeping restores the file on the server, and only this file\'s history gained the event',
            fileOf(restored, binding)?.kept === false && restored.episode === start.episode && restored.series === start.series
            && restored.history.length === kept.history.length + 1 && sameId(restored.history.find(event => event.type === 'version_unkept')?.binding, binding)
            && !isKept(await keepName(page, layout.tv)), eventsOf(restored, binding).slice(0, 2));

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
        // Whatever stopped the probe, the file leaves it as it found it.
        if (protection) {
            const { binding, kept } = protection;
            const now = await page.evaluate(([entry, id]) => ApiClient.getJSON(ApiClient.getUrl('JellyfinMod/Entries/' + entry)).then(detail => [...(detail.versions ?? []), ...detail.episodes.flatMap(row => row.versions ?? [])]
                .find(version => version.bindingId === id)?.kept === true), [protection.entryId, binding]).catch(() => null);
            if (now !== kept) {
                await setKept(page, protection.entryId, binding, kept).then(() => record(name, 'the probe stopped mid-way and put the file\'s Keep back', false, { binding, kept }))
                    .catch(error => record(name, 'the probe could not put the file\'s Keep back', false, { binding, kept, error: String(error?.message ?? error).split('\n')[0] }));
            }
        }
        await page.evaluate(() => localStorage.removeItem('layout')).catch(() => undefined);
        await context.close();
    }
}

await browser.close();
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
/* eslint-enable compat/compat, no-restricted-globals, @stylistic/max-statements-per-line */
