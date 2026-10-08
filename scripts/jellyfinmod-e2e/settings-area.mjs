/* eslint-disable compat/compat, no-restricted-globals, sonarjs/cognitive-complexity -- a Node acceptance runner, not shipped code */
/* global window, document, ApiClient, location, localStorage */
// P7.S8 acceptance: the settings area inside the JellyfinMod interface, in every layout.
//
//   JELLYFINMOD_TEST_URL=http://<host>:<isolated-port>/ JELLYFINMOD_BROWSER=chromium|chrome node settings-area.mjs
//
// JELLYFINMOD_SETTINGS_LAYOUTS=desktop,mobile,tv1080,tv720
// Signs in as oleksii with an empty password. Changes the retention days by one and puts them back (through the API in a
// `finally` when a step throws), runs the read-only TMDB test, forces two stale-revision refusals (without and with an
// unsaved edit) and reloads past each, and leaves every value as it was. Saving retention also re-saves seed protection unchanged, which moves both revisions.
import { chromium } from 'playwright';

const testUrl = new URL(process.env.JELLYFINMOD_TEST_URL ?? (() => { throw new Error('JELLYFINMOD_TEST_URL is required'); })());
// The leased mod instances only (test, acceptance, live Phase 5/6); never production on 8096.
if (!['18096', '28096', '48096'].includes(testUrl.port)) throw new Error('Runs on the isolated instances only');
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
const base = new URL('/web/', testUrl).href;
const only = (process.env.JELLYFINMOD_SETTINGS_LAYOUTS ?? 'desktop,mobile,tv1080,tv720').split(',');
const LAYOUTS = {
    desktop: { viewport: { width: 1440, height: 900 } },
    mobile: {
        viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
    },
    tv1080: { viewport: { width: 1920, height: 1080 }, tv: true },
    tv720: { viewport: { width: 1280, height: 720 }, tv: true }
};
const SECTION_IDS = ['overview', 'discovery', 'client', 'indexers', 'profiles', 'grabbing', 'import', 'retention', 'automation', 'interface', 'diagnostics'];
// The headings the page shows for those sections, in order (SettingsPage.tsx, SECTIONS; Title Case since 2026-10-08).
const SECTION_TITLES = ['Overview', 'Discovery', 'Download Client', 'Indexers', 'Quality Profiles', 'Grabbing', 'Import and Seeding', 'Retention',
    'Automation', 'Interface', 'Diagnostics'];
const sameList = (seen, wanted) => seen.length === wanted.length && seen.every((title, index) => title === wanted[index]);
// What Retention says when seed protection was saved and retention was refused for a stale revision (settingsSections.tsx,
// RetentionSection's save; settingsApi.ts, CONFLICT_MESSAGE). It is an error with a Reload, and it outranks the draft's
// "changed somewhere else while you were editing" warning, which keeps an error that already offers a Reload.
const PARTIAL_CONFLICT = 'Seed protection was saved; retention was not. These settings changed somewhere else since this page loaded. '
    + 'Reload to see the current values, then save again.';

const results = [];
const record = (layout, check, ok, detail) => {
    results.push({ layout, check, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'} [${layout}] ${check}${detail === undefined ? '' : ' :: ' + JSON.stringify(detail)}`);
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
        if (await chooser.count()) await chooser.evaluate(node => node.click());
        await field.waitFor({ state: 'visible', timeout: 15000 });
    }
    await field.fill('oleksii');
    await page.waitForTimeout(1500);
    await field.fill('oleksii');
    await page.locator('button:visible').filter({ hasText: 'Sign In' }).first().click();
    await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } }, undefined, { timeout: 30000 });
    // The sign-in flow navigates to Home on its own a moment later; a deep link set before that is overwritten.
    await page.waitForFunction(() => location.hash.startsWith('#/home'), undefined, { timeout: 30000 });
    await page.waitForTimeout(1500);
}

/** The origin the page's ApiClient sends every request to; each write below first checks that it is the instance under test. */
const pageServer = page => page.evaluate(() => new URL(ApiClient.serverAddress()).origin);
/** Stops the run before any further write when the page no longer talks to the instance under test (after a reload). */
async function assertServer(page, when) {
    const server = await pageServer(page);
    if (server !== testUrl.origin) throw new Error(`after ${when} the page's server is ${server}, not ${testUrl.origin}; stopped before writing again`);
}

/** The server's retention settings, read as the signed-in administrator. */
const retentionNow = page => page.evaluate(() => ApiClient.ajax({ type: 'GET', url: ApiClient.getUrl('JellyfinMod/Settings/Retention'), dataType: 'json' }));
/** The line under Retention's Save, as the server's revisions now make it (settingsSections.tsx, RetentionSection saveMeta). */
const savedMeta = page => page.evaluate(async () => {
    const read = path => ApiClient.ajax({ type: 'GET', url: ApiClient.getUrl('JellyfinMod/Settings/' + path), dataType: 'json' });
    const [retention, seed] = await Promise.all([read('Retention'), read('SeedProtection')]);
    return `Retention revision ${retention.revision} · seed protection revision ${seed.revision}.`;
});

/** Loads the app again from the instance under test and waits for its signed-in ApiClient, as a clean-up retry needs. */
async function reloadApp(page) {
    await page.goto(base, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
    await page.waitForFunction(() => typeof ApiClient !== 'undefined' && !!ApiClient.getCurrentUserId(), undefined, { timeout: 30000 })
        .catch(() => undefined);
}

/**
 * Puts the retention days back to `days` through the API when a run stopped before doing so, and reports what it found.
 * Only the days change; every other field is sent as the server has it, with its current revision.
 */
async function restoreRetentionDays(page, days) {
    let refused;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const outcome = await page.evaluate(async ({ target, wanted }) => {
                // A page that came back talking to another server is not written to; the run reports the days as not put back.
                const server = new URL(ApiClient.serverAddress()).origin;
                if (server !== wanted) return { restored: false, days: undefined, refused: server };
                const url = ApiClient.getUrl('JellyfinMod/Settings/Retention');
                const current = await ApiClient.ajax({ type: 'GET', url, dataType: 'json' });
                if (current.reclaimAfterDays === target) return { restored: false, days: current.reclaimAfterDays };
                await ApiClient.ajax({ type: 'PATCH', url, contentType: 'application/json', dataType: 'json',
                    data: JSON.stringify({ enabled: current.enabled, reclaimAfterDays: target, watchedUserMode: current.watchedUserMode,
                        selectedUserId: current.selectedUserId ?? null, exemptFavourites: current.exemptFavourites, revision: current.revision }) });
                const after = await ApiClient.ajax({ type: 'GET', url, dataType: 'json' });
                return { restored: true, days: after.reclaimAfterDays };
            }, { target: days, wanted: testUrl.origin });
            if (outcome.days === days) return outcome;
            refused = outcome.refused ?? refused;
            // A page talking to another server: load the app from the instance under test and retry.
            if (outcome.refused) await reloadApp(page);
        } catch {
            // A page left mid-navigation: load the app again and retry.
            await reloadApp(page);
        }
    }
    return { restored: false, days: undefined, refused };
}

const openSettings = async (page, section) => {
    await page.evaluate(id => { location.hash = '#/catalog/settings' + (id ? '?section=' + id : ''); }, section);
    await page.locator('.jfmod-check').waitFor({ state: 'visible', timeout: 30000 });
};
const heading = page => page.locator('.jfmod-check-main h2').first().innerText();
const focusInfo = page => page.evaluate(() => {
    const el = document.activeElement;
    return el ? `${el.tagName.toLowerCase()}${el.dataset.section ? '[' + el.dataset.section + ']' : ''} ${(el.textContent || '').trim().slice(0, 30)}` : 'none';
});
const pressRemoteBack = async page => {
    const client = await page.context().newCDPSession(page);
    try {
        for (const type of ['rawKeyDown', 'keyUp']) {
            await client.send('Input.dispatchKeyEvent', { type, windowsVirtualKeyCode: 461, nativeVirtualKeyCode: 461, key: 'GoBack', code: '' });
        }
    } finally {
        await client.detach();
    }
    await page.waitForTimeout(600);
};
/** Saves retention through the API as another session would, unchanged, which moves its revision. */
const competingSave = (page, current) => page.evaluate(async ({ server, wanted }) => {
    if (new URL(ApiClient.serverAddress()).origin !== wanted) throw new Error(`the page's server is not ${wanted}; nothing was saved`);
    const url = ApiClient.getUrl('JellyfinMod/Settings/Retention');
    const saved = await ApiClient.ajax({ type: 'PATCH', url, contentType: 'application/json', dataType: 'json',
        data: JSON.stringify({ enabled: server.enabled, reclaimAfterDays: server.reclaimAfterDays, watchedUserMode: server.watchedUserMode,
            selectedUserId: server.selectedUserId ?? null, exemptFavourites: server.exemptFavourites, revision: server.revision }) });
    return { revision: saved.revision };
}, { server: current, wanted: testUrl.origin });
/** The answer to this page's next PATCH of `path` (Settings/Retention or Settings/SeedProtection). */
const nextPatch = (page, path) => page.waitForResponse(response => response.request().method() === 'PATCH'
    && new URL(response.url()).pathname.endsWith('/JellyfinMod/' + path), { timeout: 30000 });
/** Every notice in the open section, once its save has settled, so a notice that replaces another would be seen. */
const settledNotices = async page => {
    await page.locator('[data-submit="retention"]:not([disabled])').waitFor({ timeout: 30000 });
    await page.waitForTimeout(1000);
    return page.locator('.jfmod-check-main .jfmod-notice').evaluateAll(nodes => nodes.map(node => ({
        kind: node.className, role: node.getAttribute('role'), text: node.querySelector('.jfmod-notice-text')?.textContent ?? '',
        actions: [...node.querySelectorAll('.jfmod-notice-action button')].map(button => button.textContent.trim())
    })));
};
/** Exactly one notice: the partial-save error with the conflict sentence and one Reload. */
const isPartialConflict = notices => notices.length === 1 && notices[0].kind === 'jfmod-notice jfmod-notice-err' && notices[0].role === 'alert'
    && notices[0].text === PARTIAL_CONFLICT && notices[0].actions.length === 1 && notices[0].actions[0] === 'Reload';
/** Presses the notice's Reload and waits for the notice to go and the field to show the server's days. */
const reloadPast = async (page, days) => {
    await page.locator('.jfmod-check-main .jfmod-notice .jfmod-notice-action button', { hasText: /^Reload$/ }).click();
    await page.locator('.jfmod-check-main .jfmod-notice').waitFor({ state: 'detached', timeout: 30000 });
    await page.waitForFunction(value => document.querySelector('.jfmod-check-main input[type="number"]')?.value === value, days, { timeout: 30000 });
};
const openMenus = page => page.evaluate(() => document.querySelectorAll('.MuiPopover-root:not([aria-hidden="true"]), .MuiMenu-root:not([aria-hidden="true"])').length);

for (const name of only) {
    const layout = LAYOUTS[name];
    const context = await browser.newContext({ viewport: layout.viewport, isMobile: layout.isMobile, hasTouch: layout.hasTouch, userAgent: layout.userAgent });
    const page = await context.newPage();
    const errors = [];
    const bodies = [];
    page.on('pageerror', error => errors.push(String(error.message).split('\n')[0]));
    page.on('response', async response => {
        if (/\/JellyfinMod\/(Settings|Setup)\//.test(response.url())) bodies.push(await response.text().catch(() => ''));
    });
    let originalDays;
    try {
        await signIn(page);
        // Every write below goes through the page's ApiClient: it must talk to the instance named in the URL, never another.
        const server = await pageServer(page);
        const sameServer = server === testUrl.origin;
        record(name, 'The page talks to the instance under test', sameServer, { server, wanted: testUrl.origin });
        if (!sameServer) throw new Error(`the page's server ${server} is not ${testUrl.origin}; nothing was changed`);
        if (layout.tv) {
            await page.evaluate(() => localStorage.setItem('layout', 'tv'));
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => document.documentElement.classList.contains('layout-tv'), undefined, { timeout: 30000 });
            await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } }, undefined, { timeout: 30000 });
            await assertServer(page, 'the TV reload');
        }

        if (name === 'desktop') {
            await page.evaluate(() => { location.hash = '#/home'; });
            await page.waitForTimeout(3000);
            const menuButton = page.locator('.MuiToolbar-root button[aria-label], .MuiToolbar-root .MuiAvatar-root').last();
            await menuButton.click();
            const item = page.locator('.MuiMenuItem-root', { hasText: /^\s*JellyfinMod Settings\s*$/ });
            await item.waitFor({ state: 'visible', timeout: 10000 });
            record(name, 'The user menu offers JellyfinMod Settings to an administrator', true);
            await item.click();
            await page.locator('.jfmod-check').waitFor({ state: 'visible', timeout: 30000 });
            record(name, 'The menu item opens the settings area', await page.evaluate(() => location.hash.startsWith('#/catalog/settings')));
        } else {
            await openSettings(page);
        }

        const steps = await page.locator('.jfmod-step').count();
        const pageBundle = await page.evaluate(() => document.querySelector('meta[name="jellyfinmod-web"]')?.getAttribute('content'));
        const overviewText = await page.locator('.jfmod-check-main').innerText();
        record(name, 'Overview shows the server bundle equal to this page\'s meta tag', !!pageBundle && overviewText.split(pageBundle).length > 2,
            { pageBundle, steps });

        if (layout.tv) {
            await page.waitForTimeout(800);
            const first = await focusInfo(page);
            record(name, 'TV: focus starts on the current rail step', /button\[overview\]/.test(first), first);
            const seen = [];
            for (let index = 1; index < SECTION_IDS.length; index++) {
                await page.keyboard.press('ArrowDown');
                await page.waitForTimeout(200);
                await page.keyboard.press('Enter');
                await page.waitForTimeout(700);
                seen.push(await heading(page));
                // Enter moves focus to the heading; the rail step is the D-pad's way back.
                await page.evaluate(id => document.querySelector(`.jfmod-step[data-section="${id}"]`)?.focus(), SECTION_IDS[index]);
            }
            record(name, 'TV: every section reached by arrows and Enter', sameList(seen, SECTION_TITLES.slice(1)), seen);
            await openSettings(page, 'retention');
            await page.waitForTimeout(500);
            const select = page.locator('.jfmod-check-main [role="combobox"]').first();
            await select.focus();
            await page.keyboard.press('Enter');
            await page.waitForTimeout(600);
            const opened = await openMenus(page);
            await page.keyboard.press('Escape');
            await page.waitForTimeout(600);
            const afterEscape = await openMenus(page);
            const stillHere = await page.evaluate(() => location.hash.includes('catalog/settings'));
            record(name, 'TV: Back (Escape) closes an open menu and stays on the page', opened > 0 && afterEscape === 0 && stillHere, { opened, afterEscape });
            await select.focus();
            await page.keyboard.press('Enter');
            await page.waitForTimeout(600);
            const reopened = await openMenus(page);
            await pressRemoteBack(page);
            const afterRemote = await openMenus(page);
            const onOpener = await select.evaluate(node => node === document.activeElement);
            record(name, 'TV: the remote\'s Back (461) closes it too, focus back on its opener',
                reopened > 0 && afterRemote === 0 && onOpener && await page.evaluate(() => location.hash.includes('catalog/settings')),
                { reopened, afterRemote, onOpener, focus: await focusInfo(page) });
            await page.evaluate(() => { location.hash = '#/home'; });
            await page.waitForTimeout(2500);
            await openSettings(page, 'interface');
            await page.waitForTimeout(800);
            await pressRemoteBack(page);
            record(name, 'TV: Back with nothing open returns to the page that opened settings', await page.evaluate(() => !location.hash.includes('catalog/settings')),
                await page.evaluate(() => location.hash));
        } else {
            const titles = [];
            for (const id of SECTION_IDS) {
                if (name === 'mobile') await openSettings(page, id);
                else await page.locator(`.jfmod-step[data-section="${id}"]`).click();
                await page.waitForTimeout(300);
                titles.push(await heading(page));
            }
            record(name, 'Every section opens', sameList(titles, SECTION_TITLES), titles);
            if (name === 'mobile') {
                const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
                record(name, 'Mobile: no horizontal scroll', overflow <= 1, { overflow });
                record(name, 'Mobile: the section picker replaces the rail', await page.locator('.jfmod-check-picker').isVisible());
            }

            if (name === 'desktop') {
                await openSettings(page, 'discovery');
                await page.locator('[data-test="discovery"]').click();
                const notice = await page.locator('.jfmod-check-main .jfmod-notice-text').innerText({ timeout: 30000 });
                record(name, 'Discovery Test shows a code and a sentence', /\((ok|unauthorized|timeout|unreachable|not_configured)\)$/.test(notice), notice);

                await openSettings(page, 'retention');
                const days = page.locator('.jfmod-check-main input[type="number"]').first();
                // The value to put back, read from the server before anything changes; restored in `finally` even when a step throws.
                originalDays = (await retentionNow(page)).reclaimAfterDays;
                const original = String(originalDays);
                const shown = await days.inputValue();
                const changed = String(originalDays + 1);
                await days.fill(changed);
                await page.locator('[data-submit="retention"]').click();
                await page.locator('.jfmod-check-main .jfmod-notice-ok').waitFor({ timeout: 30000 });
                const meta = await page.locator('[data-savemeta="retention"]').innerText();
                const metaWanted = await savedMeta(page);
                await page.reload({ waitUntil: 'domcontentloaded' });
                await page.locator('.jfmod-check').waitFor({ state: 'visible', timeout: 30000 });
                await assertServer(page, 'the reload after the save');
                const reread = await page.locator('.jfmod-check-main input[type="number"]').first().inputValue();
                record(name, 'Retention saves, echoes its revisions and re-reads after a reload',
                    shown === original && reread === changed && meta === metaWanted, { original, shown, changed, reread, meta, metaWanted });

                // A stale revision without an edit: another session saves first, then this page saves as loaded. Seed protection
                // is saved (200) and retention refused (409); the page says which half was saved, with the conflict sentence and
                // a Reload, and Reload clears it. Before the fix this showed only "The request failed." with no Reload.
                const plain = await retentionNow(page);
                const plainElsewhere = await competingSave(page, plain);
                const plainSeed = nextPatch(page, 'Settings/SeedProtection');
                const plainRefused = nextPatch(page, 'Settings/Retention');
                await page.locator('[data-submit="retention"]').click();
                const plainStatuses = [(await plainSeed).status(), (await plainRefused).status()];
                await page.locator('.jfmod-check-main .jfmod-notice-err').waitFor({ state: 'visible', timeout: 30000 });
                const plainNotices = await settledNotices(page);
                const plainField = await days.inputValue();
                record(name, 'A stale save without an edit says seed protection was saved and retention was not, with Reload',
                    plainElsewhere.revision > plain.revision && plainStatuses[0] === 200 && plainStatuses[1] === 409
                    && isPartialConflict(plainNotices) && plainField === changed,
                    { before: plain.revision, elsewhere: plainElsewhere.revision, statuses: plainStatuses, notices: plainNotices, field: plainField });
                await reloadPast(page, changed);
                const plainCleared = await days.inputValue();
                // The Reload took the server's revisions: the same save, still unedited, is accepted now.
                const plainAccepted = nextPatch(page, 'Settings/Retention');
                await page.locator('[data-submit="retention"]').click();
                const plainAcceptedStatus = (await plainAccepted).status();
                const plainOk = await page.locator('.jfmod-check-main .jfmod-notice-ok .jfmod-notice-text').innerText({ timeout: 30000 });
                record(name, 'Its Reload clears the notice and shows the server\'s days; the save is then accepted',
                    plainCleared === changed && plainAcceptedStatus === 200 && plainOk === 'Saved.', { plainCleared, plainAcceptedStatus, plainOk });

                // A stale revision with an edit: the same refusal while the field holds an unsaved value. The partial-save error
                // with its Reload stays (the draft's own warning gives way to an error that offers a Reload) and the edit is
                // kept. Reload takes the server's copy, and the next save is accepted.
                const before = await retentionNow(page);
                const elsewhere = await competingSave(page, before);
                await days.fill(original);
                const editedSeed = nextPatch(page, 'Settings/SeedProtection');
                const refused = nextPatch(page, 'Settings/Retention');
                await page.locator('[data-submit="retention"]').click();
                const statuses = [(await editedSeed).status(), (await refused).status()];
                await page.locator('.jfmod-check-main .jfmod-notice-err').waitFor({ state: 'visible', timeout: 30000 });
                const notices = await settledNotices(page);
                const kept = await days.inputValue();
                record(name, 'A stale save with an edit shows the same error with Reload, keeping the edit',
                    elsewhere.revision > before.revision && statuses[0] === 200 && statuses[1] === 409 && isPartialConflict(notices) && kept === original,
                    { before: before.revision, elsewhere: elsewhere.revision, statuses, notices, kept });

                await reloadPast(page, changed);
                const afterReload = await days.inputValue();
                await days.fill(original);
                const accepted = nextPatch(page, 'Settings/Retention');
                await page.locator('[data-submit="retention"]').click();
                const acceptedStatus = (await accepted).status();
                const ok = await page.locator('.jfmod-check-main .jfmod-notice-ok .jfmod-notice-text').innerText({ timeout: 30000 });
                record(name, 'Reload takes the server\'s copy and clears the error; the next save succeeds',
                    afterReload === changed && acceptedStatus === 200 && ok === 'Saved.', { afterReload, acceptedStatus, ok });
                await page.reload({ waitUntil: 'domcontentloaded' });
                await page.locator('.jfmod-check').waitFor({ state: 'visible', timeout: 30000 });
                // The field and the API read are this instance's only if the reloaded page still talks to it.
                const finalServer = await pageServer(page);
                const restoredField = await page.locator('.jfmod-check-main input[type="number"]').first().inputValue();
                const restoredServer = (await retentionNow(page)).reclaimAfterDays;
                record(name, 'The original retention days are restored', finalServer === testUrl.origin && restoredField === original
                    && restoredServer === originalDays, { original, restoredField, restoredServer, server: finalServer });
            }
        }

        record(name, 'No settings response carries a secret reference', !bodies.some(body => /sec_[0-9a-f]/.test(body)), { responses: bodies.length });
        record(name, 'No page errors', errors.length === 0, errors.slice(0, 3));
    } catch (error) {
        record(name, 'run completed', false, 'NOT VERIFIED: ' + String(error?.message ?? error).split('\n')[0]);
    } finally {
        if (originalDays !== undefined) {
            const put = await restoreRetentionDays(page, originalDays);
            if (put.days !== originalDays) record(name, 'Retention days put back after the run', false, { original: originalDays, now: put.days, refused: put.refused });
            else if (put.restored) console.log(`NOTE [${name}] the run stopped early; retention days put back to ${originalDays} through the API`);
        }
        await page.evaluate(() => localStorage.removeItem('layout')).catch(() => {});
        await context.close();
    }
}

await browser.close();
const failed = results.filter(result => !result.ok).length;
console.log(`${results.length - failed} of ${results.length} checks pass`);
process.exit(failed ? 1 : 0);
