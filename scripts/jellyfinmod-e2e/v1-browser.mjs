/* eslint-disable compat/compat, no-restricted-globals, @stylistic/max-statements-per-line -- a Node acceptance runner, not shipped code */
/* global window, document, ApiClient, localStorage, location */
// V1 browser rows (docs/jellyfinmod/V1.md S7 rows 12, 13 and 20) on the acceptance instance, signed in as oleksii with an
// empty password.
//
// Every layout, on the Prefer fixture (three copies; nothing is removed): the version rows; the device's copy (desktop
// keeps Jellyfin's default, mobile takes the 1080p, TV the 2160p HDR); a pick on the stock select that is not a trusted
// event (as webOS's emby-select sends) is never replaced by the preselect; the 720p row reached by keys (arrow keys on
// TV, Tab on desktop, a tap on mobile) and chosen with Enter; Play actually plays that copy (the video advances, the
// playback start report and the server's session name it, every stream request names it); the warning inside stock
// Delete media's confirmation, and never inside Remove's own confirmation after the More menu was opened and closed;
// Remove reachable by keys, its confirmation cancelled by Back, nothing removed.
//
// With JELLYFINMOD_V1_REMOVE=1, desktop only, on the disposable Remove fixture ("JellyfinMod V1 Remove" under the V1
// fixture folder, three copies; recreate it with `v1-live.py media` then `v1-live.py reconcile`): Cancel removes nothing;
// a double click and a double confirm send one request and remove one copy, and the page reloads without that copy; a
// 409 (the copy playing) is shown in words and removes nothing; the last copy's confirmation says it stops monitoring and
// the page moves to the catalog entry.
//
//   JELLYFINMOD_TEST_URL=http://<host>:28096/ JELLYFINMOD_V1_MOVIE=<Prefer main item id> [JELLYFINMOD_BROWSER=chrome]
//     [JELLYFINMOD_LAYOUTS=desktop,mobile,tv1080,tv720] [JELLYFINMOD_V1_REMOVE=1] node v1-browser.mjs
import { chromium } from 'playwright';

const origin = new URL(process.env.JELLYFINMOD_TEST_URL ?? (() => { throw new Error('JELLYFINMOD_TEST_URL is required'); })());
if (origin.port !== '28096') throw new Error('Runs only against the acceptance instance');
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
const USER = 'oleksii';
const FIXTURE_FOLDER = '/v1/movies/';
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
const norm = id => (id ?? '').replace(/-/g, '').toLowerCase();

const selectValue = page => page.evaluate(() => document.querySelector('.selectSource')?.value ?? null);
const optionLabels = page => page.evaluate(() => Array.from(document.querySelector('.selectSource')?.options ?? [])
    .map(option => ({ value: option.value, text: option.textContent })));
const rowSelector = id => `.jfmod-versionRow[data-jfmod-media-source-id="${id}"]`;
const activeMatches = (page, selector) => page.evaluate(sel => !!document.activeElement?.matches(sel), selector);
const activeName = page => page.evaluate(() => document.activeElement?.className?.toString().slice(0, 60) ?? 'none');

/** In-page API calls through the signed-in ApiClient; nothing about the session is printed. */
const apiGet = (page, path, query) => page.evaluate(([p, q]) => ApiClient.getJSON(ApiClient.getUrl(p, q)), [path, query]);
const apiPost = (page, path, body) => page.evaluate(([p, b]) => ApiClient.ajax({ type: 'POST', url: ApiClient.getUrl(p),
    data: JSON.stringify(b ?? {}), contentType: 'application/json' }).then(() => true), [path, body]);

async function openDetail(page, id = movie) {
    await page.goto(base('/web/') + `#/details?id=${id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.jfmod-versions .jfmod-versionRow', { timeout: 30000 });
    await page.waitForTimeout(2500);
}

/**
 * Moves focus to `exact` by keys only: arrow keys on TV (down to the first match of `coarse`, then right along a row of
 * buttons), Tab on desktop. Returns whether focus got there.
 */
async function reachByKeys(page, layout, exact, coarse = exact) {
    const tv = !!LAYOUTS[layout].tv;
    for (let presses = 0; presses < 60; presses++) {
        if (await activeMatches(page, exact)) return true;
        let key = 'Tab';
        if (tv) key = await activeMatches(page, coarse) ? 'ArrowRight' : 'ArrowDown';
        await page.keyboard.press(key);
        await page.waitForTimeout(tv ? 250 : 60);
    }
    return activeMatches(page, exact);
}

/** Chooses a control the way this layout does: keys and Enter on TV and desktop, a tap on mobile. */
async function chooseControl(page, layout, exact, coarse) {
    if (layout === 'mobile') {
        await page.locator(exact).first().tap({ timeout: 5000 });
        return true;
    }
    const reached = await reachByKeys(page, layout, exact, coarse);
    record(layout, `${exact.includes('remove') ? 'Remove' : 'the 720p row'} reached by ${LAYOUTS[layout].tv ? 'arrow keys' : 'Tab'}`,
        reached, await activeName(page));
    if (!reached) return false;
    await page.keyboard.press('Enter');
    return true;
}

async function checkDeleteWarning(page, layout, label, count) {
    // Stock Delete media: the warning is inside upstream's own confirmation; Cancel, nothing deleted.
    await page.locator('.btnMoreCommands:visible').first().click({ timeout: 5000 });
    await page.locator('.actionSheetMenuItem[data-id="delete"]').first().click({ timeout: 5000 });
    const warning = page.locator('.dialog .jfmod-deleteWarning');
    await warning.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
    const text = await warning.textContent().catch(() => null);
    record(layout, `stock Delete confirmation carries the warning${label}`, !!text && text.includes(`${count} files`), (text ?? 'none').slice(0, 80));
    await page.locator('.dialog button', { hasText: /Cancel/i }).first().click({ timeout: 5000 });
    await page.waitForTimeout(800);
    record(layout, `Cancel leaves the title in place${label}`, await page.locator('.jfmod-versions .jfmod-versionRow:not(.jfmod-versionRow--add)').count() === count);
}

/** Opens the More menu and closes it without choosing anything, then opens Remove: Remove's dialog has no Delete warning. */
async function checkRemoveHasNoDeleteWarning(page, layout) {
    await page.locator('.btnMoreCommands:visible').first().click({ timeout: 5000 });
    await page.locator('.actionSheet').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    await page.keyboard.press('Escape');
    await page.locator('.actionSheet').first().waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
    await page.locator('[data-jfmod-remove-version]').first().click({ timeout: 5000 });
    const dialog = page.locator('.dialog', { hasText: 'Only the' });
    await dialog.first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
    const opened = await dialog.count() > 0;
    const warned = await page.locator('.dialog .jfmod-deleteWarning').count();
    record(layout, 'Remove after More + close: no Delete warning in its confirmation', opened && warned === 0, `dialog ${opened}, warnings ${warned}`);
    await page.locator('.dialog button', { hasText: /Cancel/i }).first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(800);
}

/** A pick on the stock select sent as an untrusted `change` (webOS's emby-select) survives upstream's re-render. */
async function checkUntrustedPick(page, layout, want) {
    await page.evaluate(id => {
        const select = document.querySelector('.selectSource');
        const option = Array.from(select.options).find(candidate => candidate.value.replace(/-/g, '') === id);
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
    }, want);
    await page.waitForTimeout(4000);
    const after = await selectValue(page);
    record(layout, 'an untrusted pick on the stock select is kept after upstream re-renders', norm(after) === norm(want), `${after}`);
}

/** Play: the chosen copy is the one that actually plays. */
async function checkPlayback(page, layout, want) {
    const starts = [];
    const streams = [];
    const onRequest = request => {
        const url = new URL(request.url());
        if (request.method() === 'POST' && /\/sessions\/playing$/i.test(url.pathname)) {
            try { starts.push(JSON.parse(request.postData() ?? '{}').MediaSourceId ?? null); } catch { starts.push(null); }
        }
        if (/\/videos\/[^/]+\/(stream|master|main|hls)/i.test(url.pathname)) {
            const key = [...url.searchParams.keys()].find(name => name.toLowerCase() === 'mediasourceid');
            streams.push(key ? url.searchParams.get(key) : null);
        }
    };
    page.on('request', onRequest);
    await page.locator('.btnPlay:visible, .detailButton-primary:visible').first().click({ timeout: 5000 }).catch(() => {});
    const started = await page.waitForFunction(() => {
        const video = document.querySelector('video');
        return !!video && video.currentTime > 0.5;
    }, undefined, { timeout: 25000 }).then(() => true, () => false);
    await page.waitForTimeout(1500);
    const sessions = await apiGet(page, 'Sessions', { deviceId: await page.evaluate(() => ApiClient.deviceId()) }).catch(() => []);
    page.off('request', onRequest);
    const playing = sessions.map(session => session.PlayState?.MediaSourceId).filter(Boolean);
    record(layout, 'playback started (the video advances)', started);
    record(layout, 'the playback start report names the chosen copy', starts.some(id => norm(id) === norm(want)),
        starts.map(id => (id ?? 'none').slice(0, 8)).join(','));
    record(layout, "the server's session plays the chosen copy", playing.some(id => norm(id) === norm(want)),
        playing.map(id => id.slice(0, 8)).join(',') || 'no session');
    record(layout, 'every stream request names the chosen copy', streams.length > 0 && streams.every(id => norm(id) === norm(want)),
        `${streams.length} stream requests`);
    await page.keyboard.press('Escape').catch(() => {});
    await page.goBack().catch(() => {});
    await page.waitForTimeout(1500);
}

/** Remove by keys on TV: reachable, Enter opens its confirmation, Back cancels it, nothing is removed. */
async function checkRemoveByKeys(page, layout, count) {
    const requests = [];
    const onRequest = request => { if (/\/Versions\/[^/]+\/Remove$/i.test(new URL(request.url()).pathname)) requests.push(request.url()); };
    page.on('request', onRequest);
    const opened = await chooseControl(page, layout, '[data-jfmod-remove-version]', '.jfmod-nativeActions button');
    const dialog = page.locator('.dialog', { hasText: 'Only the' });
    await dialog.first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
    record(layout, 'Enter on Remove opens its confirmation', opened && await dialog.count() > 0);
    await page.keyboard.press('Escape');
    await dialog.first().waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(800);
    page.off('request', onRequest);
    record(layout, 'Back closes the confirmation and removes nothing', await dialog.count() === 0 && requests.length === 0
        && await page.locator('.jfmod-versions .jfmod-versionRow:not(.jfmod-versionRow--add)').count() === count);
    record(layout, 'focus returns to a Remove button', await activeMatches(page, '[data-jfmod-remove-version]'), await activeName(page));
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
        record(layout, 'the device starts on its copy', expected === null ? value === options[0]?.value : chosen.includes(expected),
            `selected "${chosen.trim()}"`);
        const removeButtons = await page.locator('[data-jfmod-remove-version]').count();
        record(layout, 'Remove buttons for the administrator', removeButtons === 3, `${removeButtons}`);

        await checkDeleteWarning(page, layout, '', 3);
        if (layout === 'desktop') await checkRemoveHasNoDeleteWarning(page, layout);
        if (LAYOUTS[layout].tv) {
            const pick = options.find(option => option.text.includes('1080p'))?.value;
            if (pick) await checkUntrustedPick(page, layout, pick);
            await checkRemoveByKeys(page, layout, 3);
            await openDetail(page);
        }

        // Choose the 720p row by keys (a tap on mobile), then Play: that copy is the one that plays.
        const want = await page.locator('.jfmod-versionRow', { hasText: '720p' }).first().getAttribute('data-jfmod-media-source-id');
        // Desktop starts Tab from the top of the page; the TV keeps the focus its layout gave (the Play button).
        if (!LAYOUTS[layout].tv) await page.evaluate(() => document.activeElement?.blur?.());
        await chooseControl(page, layout, rowSelector(want));
        await page.waitForTimeout(1500);
        const after = await selectValue(page);
        record(layout, 'choosing the row drives the stock select', norm(after) === norm(want), `${after}`);
        await checkPlayback(page, layout, want);
        await openDetail(page);
        await checkDeleteWarning(page, layout, ' (after playback and Back)', 3);

        record(layout, 'no page errors', page.jfmodErrors.length === 0, page.jfmodErrors.slice(0, 2).join(' | '));
    } catch (error) {
        record(layout, 'layout ran', false, String(error.message).split('\n')[0]);
    } finally {
        await context.close();
    }
}

// --- Remove this version on the disposable Remove fixture (JELLYFINMOD_V1_REMOVE=1, desktop) ---

/** The Remove fixture's native item, refused unless it is the V1 fixture under the fixture folder. */
async function removeFixture(page) {
    const found = await apiGet(page, `Users/${await page.evaluate(() => ApiClient.getCurrentUserId())}/Items`,
        { SearchTerm: 'JellyfinMod V1 Remove', IncludeItemTypes: 'Movie', Recursive: true, Fields: 'Path' });
    const items = (found.Items ?? []).filter(item => item.Name?.startsWith('JellyfinMod V1 Remove') && item.Path?.includes(FIXTURE_FOLDER));
    if (items.length !== 1) throw new Error(`REFUSED: expected one disposable Remove fixture, found ${items.length}`);
    return items[0];
}

async function fixtureVersions(page, itemId) {
    const entries = await apiGet(page, 'JellyfinMod/Entries', { jellyfinItemId: itemId, limit: 1 });
    const entry = entries.items?.[0];
    if (!entry?.title?.startsWith('JellyfinMod V1')) throw new Error('REFUSED: the entry is not a V1 fixture');
    const detail = await apiGet(page, `JellyfinMod/Entries/${entry.id}`);
    return { entry: detail.entry, versions: detail.versions ?? [] };
}

const removeButton = (page, resolution) => page.locator('[data-jfmod-remove-version]', { hasText: resolution }).first();

async function checkRemove(browser) {
    const layout = 'desktop';
    const { context, page } = await newPage(browser, layout);
    const removals = [];
    page.on('request', request => {
        if (request.method() === 'POST' && /\/Versions\/[^/]+\/Remove$/i.test(new URL(request.url()).pathname)) removals.push(request.url());
    });
    try {
        await signIn(page);
        const fixture = await removeFixture(page);
        let state = await fixtureVersions(page, fixture.Id);
        const entryId = state.entry.id;
        if (state.versions.length !== 3) throw new Error(`the Remove fixture has ${state.versions.length} copies, not 3: recreate it`);
        await openDetail(page, fixture.Id);

        // Cancel: nothing is removed.
        await removeButton(page, '720p').click();
        const confirmation = page.locator('.dialog', { hasText: 'Only the' });
        await confirmation.first().waitFor({ state: 'visible', timeout: 8000 });
        await page.locator('.dialog button', { hasText: /Cancel/i }).first().click();
        await page.waitForTimeout(1500);
        state = await fixtureVersions(page, fixture.Id);
        record(layout, 'Remove, Cancel: no request, three copies', removals.length === 0 && state.versions.length === 3,
            `${removals.length} requests, ${state.versions.length} copies`);

        // Double click, double confirm: one confirmation, one request, exactly the 720p gone, the page reloaded without it.
        const removed = state.versions.find(version => version.resolution === '720p');
        await removeButton(page, '720p').evaluate(button => { button.click(); button.click(); });
        await confirmation.first().waitFor({ state: 'visible', timeout: 8000 });
        await page.waitForTimeout(500);
        const dialogs = await confirmation.count();
        await page.locator('.dialog .formDialogFooter .button-delete').first().evaluate(button => { button.click(); button.click(); });
        await page.waitForFunction(id => !Array.from(document.querySelector('.selectSource')?.options ?? [])
            .some(option => option.value.replace(/-/g, '') === id), norm(removed.mediaSourceId), { timeout: 30000 }).catch(() => {});
        await page.waitForSelector('.jfmod-versions .jfmod-versionRow', { timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(2500);
        state = await fixtureVersions(page, fixture.Id);
        const ids = state.versions.map(version => version.bindingId);
        record(layout, 'a double click opens one confirmation', dialogs === 1, `${dialogs}`);
        record(layout, 'a double confirm sends one request and removes exactly the 720p', removals.length === 1
            && state.versions.length === 2 && !ids.includes(removed.bindingId), `${removals.length} requests, ${state.versions.length} copies`);
        const options = await optionLabels(page);
        record(layout, 'the page reloads: the stock select no longer offers the removed copy',
            options.length === 2 && !options.some(option => norm(option.value) === norm(removed.mediaSourceId)), `${options.length} options`);

        // A refusal: the 1080p playing -> 409 in words, nothing removed.
        const playingCopy = state.versions.find(version => version.resolution === '1080p');
        const main = state.versions.find(version => version.isDefault) ?? state.versions[0];
        const body = { ItemId: main.jellyfinItemId, MediaSourceId: playingCopy.mediaSourceId, PositionTicks: 10_000_000,
            PlayMethod: 'DirectPlay', PlaySessionId: 'jfmod-v1-browser-refusal' };
        await apiPost(page, 'Sessions/Playing', body);
        try {
            await page.waitForTimeout(1500);
            await removeButton(page, '1080p').click();
            await confirmation.first().waitFor({ state: 'visible', timeout: 8000 });
            await page.locator('.dialog .formDialogFooter .button-delete').first().click();
            await page.waitForFunction(() => /playing/i.test(document.querySelector('[aria-label="JellyfinMod"] p[role="status"]')?.textContent ?? ''),
                undefined, { timeout: 15000 }).catch(() => {});
            const message = await page.locator('[aria-label="JellyfinMod"] p[role="status"]').first().textContent().catch(() => '');
            state = await fixtureVersions(page, fixture.Id);
            record(layout, 'a 409 is shown in words and removes nothing', /playing/i.test(message ?? '') && state.versions.length === 2,
                (message ?? '').slice(0, 60));
        } finally {
            await apiPost(page, 'Sessions/Playing/Stopped', { ...body, PositionTicks: 0 }).catch(() => {});
        }

        // Down to the last copy: its confirmation says it stops monitoring; the page moves to the catalog entry.
        await page.waitForTimeout(2000);
        await removeButton(page, '1080p').click();
        await confirmation.first().waitFor({ state: 'visible', timeout: 8000 });
        await page.locator('.dialog .formDialogFooter .button-delete').first().click();
        await page.waitForSelector('.jfmod-versions .jfmod-versionRow', { timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(3000);
        state = await fixtureVersions(page, fixture.Id).catch(() => null);
        record(layout, 'the 1080p removed, one copy left', state?.versions.length === 1, `${state?.versions.length}`);
        const last = page.locator('[data-jfmod-remove-version]').first();
        await last.click();
        const lastDialog = page.locator('.dialog', { hasText: 'This removes the last copy and stops monitoring' });
        await lastDialog.first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
        const lastButton = await page.locator('.dialog .formDialogFooter .button-delete').first().textContent().catch(() => '');
        record(layout, 'the last copy: the confirmation says it stops monitoring', await lastDialog.count() > 0
            && /last copy/i.test(lastButton ?? ''), (lastButton ?? '').trim());
        await page.locator('.dialog .formDialogFooter .button-delete').first().click();
        await page.waitForFunction(() => location.hash.includes('entryId='), undefined, { timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(3000);
        const hash = await page.evaluate(() => location.hash);
        record(layout, 'after the last copy the page is the catalog entry', hash.includes(`entryId=${entryId}`),
            hash.replace(/serverId=[^&]+/, 'serverId=…').slice(0, 70));
        const gone = (await apiGet(page, `JellyfinMod/Entries/${entryId}`)).entry;
        record(layout, 'the entry is Not downloaded and no longer monitored', gone.state === 'none' && gone.monitored === false,
            `${gone.state}, monitored ${gone.monitored}`);
        record(layout, 'Remove: four requests in all', removals.length === 4, `${removals.length}`);
        record(layout, 'Remove: no page errors', page.jfmodErrors.length === 0, page.jfmodErrors.slice(0, 2).join(' | '));
    } catch (error) {
        record(layout, 'Remove ran', false, String(error.message).split('\n')[0]);
    } finally {
        await context.close();
    }
}

const browser = await launch();
for (const layout of (process.env.JELLYFINMOD_LAYOUTS ?? 'desktop,mobile,tv1080,tv720').split(',')) await checkLayout(browser, layout);
if (process.env.JELLYFINMOD_V1_REMOVE === '1') await checkRemove(browser);
await browser.close();
const failed = results.filter(result => !result.pass).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
