/* eslint-disable compat/compat, no-restricted-globals, @stylistic/max-statements-per-line, sonarjs/cognitive-complexity -- a Node acceptance runner, not shipped code */
/* global document, location, ApiClient, localStorage, getComputedStyle */
// The tab control (D273, guides/tabs.md), live on a local pool environment as oleksii with an empty password, by real clicks, taps and
// arrow keys: the Preferences Subtitles page draws Primary and Secondary as the rail under Subtitle Appearance, never beside Save; the
// selected tab matches the page's own; each profile shows and saves its own Text Size, an unsaved change survives a switch; the player's
// Subtitle Appearance panel draws the same rail and its arrows switch it. Computer, phone and TV, dark and light. Every value it changes is
// put back and saved again.
//
//   JELLYFINMOD_TEST_URL=http://127.0.0.1:<pool port>/  JELLYFINMOD_TABS_PLAYER=<item id with minutes of video>
//   [JELLYFINMOD_BROWSER=chromium|chrome]  [JELLYFINMOD_TABS_SHOTS=<folder>]
import { chromium } from 'playwright';

const origin = new URL(process.env.JELLYFINMOD_TEST_URL ?? (() => { throw new Error('JELLYFINMOD_TEST_URL is required'); })());
if (origin.hostname !== '127.0.0.1' || !['9096', '10096', '11096', '12096'].includes(origin.port)) throw new Error('Runs on 127.0.0.1 at the local pool only');
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
const SHOTS = process.env.JELLYFINMOD_TABS_SHOTS ?? '.';
let failures = 0;
const record = (label, check, ok, detail) => {
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'} [${tier}/${label}] ${check}${detail === undefined ? '' : ' :: ' + JSON.stringify(detail).slice(0, 500)}`);
};
const PHONE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
const DEVICES = { computer: { viewport: { width: 1440, height: 900 } }, phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: PHONE_UA },
    tv: { viewport: { width: 1920, height: 1080 } } };
const browser = await chromium.launch(tier === 'chrome' ? { channel: 'chrome' } : {});

async function session(device, theme) {
    const context = await browser.newContext(DEVICES[device]);
    const page = await context.newPage();
    page.errors = [];
    page.on('pageerror', error => page.errors.push(String(error.message).split('\n')[0]));
    const signedIn = () => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } };
    await page.goto(new URL('/web/', origin).href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId() || /login|selectuser|selectserver/.test(location.hash); } catch { return false; } }, undefined, { timeout: 30000 });
    if (!await page.evaluate(signedIn)) {
        const field = page.locator('#txtManualName');
        await Promise.race([field.waitFor({ state: 'visible', timeout: 15000 }), page.locator('.btnManual').first().waitFor({ state: 'attached', timeout: 15000 })]);
        if (!await field.isVisible().catch(() => false)) await page.locator('.btnManual').first().evaluate(node => node.click());
        await field.waitFor({ state: 'visible', timeout: 15000 });
        await page.waitForTimeout(800);
        await field.fill('oleksii');
        await page.locator('button:visible').filter({ hasText: 'Sign In' }).first().click();
        await page.waitForFunction(signedIn, undefined, { timeout: 30000 });
    }
    await page.evaluate(([name, tv]) => {
        localStorage.setItem(ApiClient.getCurrentUserId() + '-appTheme', name);
        localStorage.setItem('appTheme', name);
        if (tv) localStorage.setItem('layout', 'tv'); else localStorage.removeItem('layout');
    }, [theme, device === 'tv']);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(signedIn, undefined, { timeout: 30000 });
    await page.waitForTimeout(1500);
    return { context, page };
}

const RAIL = '.page:not(.hide) .jfmod-dsPrefsHost .tabs';
const openPrefs = async page => {
    await page.evaluate(() => { location.hash = '#/mypreferencessubtitles'; });
    await page.waitForSelector(RAIL + ' .tab', { timeout: 30000 });
    await page.waitForTimeout(1200);
};
const railState = page => page.evaluate(rail => {
    const node = document.querySelector(rail);
    const tabs = [...node.querySelectorAll('.tab')];
    const style = node.getBoundingClientRect();
    const host = node.closest('.jfmod-dsPrefsHost');
    const heading = node.previousElementSibling;
    const panel = node.nextElementSibling;
    const source = [...host.closest('.page').querySelectorAll('.subtitleProfiles [role=tab]')];
    const on = tabs.find(tab => tab.classList.contains('on'));
    const em = parseFloat(getComputedStyle(node).fontSize);
    return {
        role: node.getAttribute('role'), tabs: tabs.map(tab => [tab.textContent, tab.getAttribute('role'), tab.getAttribute('aria-selected')]),
        selected: on?.textContent ?? null, sourceSelected: source.find(tab => tab.getAttribute('aria-selected') === 'true')?.textContent?.trim() ?? null,
        onColor: on ? getComputedStyle(on).color : null, onWeight: on ? getComputedStyle(on).fontWeight : null,
        heightEm: Math.round(style.height / em * 1000) / 1000, heading: heading?.matches('h2') ? heading.textContent : null,
        panel: panel?.getAttribute('role'), labelledBy: panel?.getAttribute('aria-labelledby'), onId: on?.id ?? null,
        besideSave: [...host.querySelectorAll('.btnrow button')].map(button => button.textContent).filter(text => /Primary|Secondary/.test(text))
    };
}, RAIL);
const rowBox = (page, title) => page.locator('.page:not(.hide) .jfmod-dsPrefsHost .srow2').filter({ has: page.locator('.tx b', { hasText: new RegExp('^' + title + '$') }) }).locator('.box');
const textSize = page => rowBox(page, 'Text size').locator('.v').innerText();
const press = async (page, device, locator) => {
    if (device === 'tv') { await locator.focus(); await page.keyboard.press('Enter'); } else if (device === 'phone') await locator.tap(); else await locator.click();
};
const pick = async (page, device, title, label) => {
    await press(page, device, rowBox(page, title));
    const option = page.locator('.menuportal .mi, .pmenu .mi').filter({ hasText: new RegExp('^' + label + '$') }).first();
    await option.waitFor({ state: 'visible', timeout: 10000 });
    await press(page, device, option);
    await page.waitForTimeout(800);
};
const tab = (page, name) => page.locator(RAIL + ' .tab', { hasText: name });
const PRIMARY = 'rgb(0, 164, 220)';

for (const [device, theme] of [['computer', 'dark'], ['computer', 'light'], ['phone', 'dark'], ['phone', 'light'], ['tv', 'dark'], ['tv', 'light']]) {
    const label = `${device} ${theme}`;
    const { context, page } = await session(device, theme);
    try {
        await openPrefs(page);
        let state = await railState(page);
        record(label, 'Preferences: Primary and Secondary are a tablist under Subtitle Appearance, the fields its tabpanel, none beside Save',
            state.role === 'tablist' && state.tabs.length === 2 && state.tabs.every(([, role]) => role === 'tab') && /Subtitle Appearance/i.test(state.heading ?? '')
            && state.panel === 'tabpanel' && state.labelledBy === state.onId && state.besideSave.length === 0, state);
        record(label, 'the rail is a field high, its selected tab blue and 700, the same as the page\'s own', Math.abs(state.heightEm - 2.7816) < 0.05 && state.onColor === PRIMARY
            && Number(state.onWeight) === 700 && state.selected === state.sourceSelected && state.selected === 'Primary', state);
        await page.locator(RAIL).screenshot({ path: `${SHOTS}/tabs-${tier}-${device}-${theme}-prefs.png` }).catch(() => undefined);
        const primary = await textSize(page);
        // Secondary by the device's own way: a click, a tap, or the arrow on the TV and on a computer's keyboard.
        if (device === 'tv' || theme === 'light') {
            await tab(page, 'Primary').focus();
            await page.keyboard.press('ArrowRight');
        } else await press(page, device, tab(page, 'Secondary'));
        await page.waitForTimeout(800);
        state = await railState(page);
        const focused = await page.evaluate(() => document.activeElement?.textContent ?? '');
        record(label, 'Secondary is selected, on the page\'s own tabs too' + (device === 'tv' || theme === 'light' ? ', and the arrow kept focus on it' : ''),
            state.selected === 'Secondary' && state.sourceSelected === 'Secondary' && state.labelledBy === state.onId
            && (device !== 'tv' && theme !== 'light' || focused === 'Secondary'), { ...state, focused });
        if (device === 'computer' && theme === 'dark') {
            const secondary = await textSize(page);
            const options = await (async () => { await rowBox(page, 'Text size').click(); const list = await page.locator('.menuportal .mi, .pmenu .mi').allInnerTexts(); await page.keyboard.press('Escape'); await page.waitForTimeout(400); return list; })();
            const changed = options.find(option => option !== secondary && option !== primary) ?? options.find(option => option !== secondary);
            await pick(page, device, 'Text size', changed);
            record(label, 'Secondary takes its own Text Size', await textSize(page) === changed, { primary, secondary, changed });
            await page.keyboard.press('Shift+Tab').catch(() => undefined);
            await tab(page, 'Primary').focus();
            await page.keyboard.press('ArrowLeft');
            await page.waitForTimeout(800);
            record(label, 'back on Primary by the arrow, Primary keeps its own value', (await railState(page)).selected === 'Primary' && await textSize(page) === primary, { now: await textSize(page), primary });
            await page.keyboard.press('End');
            await page.waitForTimeout(800);
            record(label, 'End goes to Secondary, its unsaved change kept', (await railState(page)).selected === 'Secondary' && await textSize(page) === changed, await textSize(page));
            await page.locator('.page:not(.hide) .jfmod-dsPrefsHost .btnrow button', { hasText: 'Save' }).click();
            await page.waitForTimeout(2500);
            await page.evaluate(() => { location.hash = '#/mypreferencesmenu'; });
            await page.waitForTimeout(1500);
            await openPrefs(page);
            const savedPrimary = await textSize(page);
            await tab(page, 'Secondary').click();
            await page.waitForTimeout(800);
            const savedSecondary = await textSize(page);
            record(label, 'saved and read again: each profile shows its own value', savedPrimary === primary && savedSecondary === changed, { savedPrimary, savedSecondary });
            await pick(page, device, 'Text size', secondary);
            await page.locator('.page:not(.hide) .jfmod-dsPrefsHost .btnrow button', { hasText: 'Save' }).click();
            await page.waitForTimeout(2500);
            await page.evaluate(() => { location.hash = '#/mypreferencesmenu'; });
            await page.waitForTimeout(1500);
            await openPrefs(page);
            await tab(page, 'Secondary').click();
            await page.waitForTimeout(800);
            record(label, 'Secondary\'s Text Size put back and saved', await textSize(page) === secondary, await textSize(page));
        }
        // The player's own panel: the same rail, its arrow switching it.
        if (theme === 'dark' || device === 'computer') {
            await page.evaluate(id => { location.hash = '#/details?id=' + id; }, process.env.JELLYFINMOD_TABS_PLAYER);
            await page.waitForSelector('.page:not(.hide) .jfmod-dsTitleHost .actbar button', { timeout: 30000 });
            await page.waitForTimeout(1200);
            await press(page, device, page.locator('.page:not(.hide) .jfmod-dsTitleHost .actbar button', { hasText: /^(Play|Resume)/ }).first());
            await page.waitForSelector('button.play.round.btnPause', { state: 'attached', timeout: 30000 });
            await page.waitForTimeout(3000);
            await page.mouse.move(700, 500);
            const settings = page.locator('.btnVideoOsdSettings').first();
            await settings.waitFor({ state: 'visible', timeout: 10000 });
            await press(page, device, settings);
            const item = page.locator('[data-ds-actionsheet] [data-id="subtitleappearance"], .actionSheet [data-id="subtitleappearance"]').first();
            await item.waitFor({ state: 'visible', timeout: 10000 });
            await press(page, device, item);
            const profiles = page.locator('.playerSubtitleSettings-profiles');
            await profiles.waitFor({ state: 'visible', timeout: 15000 });
            await page.waitForTimeout(800);
            const look = await profiles.evaluate(node => {
                const em = parseFloat(getComputedStyle(node).fontSize);
                const on = node.querySelector('[aria-selected="true"]');
                return { role: node.getAttribute('role'), heightEm: Math.round(node.getBoundingClientRect().height / em * 1000) / 1000, shadow: getComputedStyle(node).boxShadow.slice(0, 40),
                    on: on?.textContent?.trim(), onColor: on && getComputedStyle(on).color, onWeight: on && getComputedStyle(on).fontWeight, inDesign: !!node.closest('.jfds') };
            });
            record(label, 'the player panel draws the same rail, Primary selected in blue 700', look.role === 'tablist' && look.inDesign && Math.abs(look.heightEm - 2.7816) < 0.06
                && look.on === 'Primary' && (device === 'tv' || look.onColor === PRIMARY) && Number(look.onWeight) === 700, look);
            await profiles.screenshot({ path: `${SHOTS}/tabs-${tier}-${device}-${theme}-player.png` }).catch(() => undefined);
            await page.locator('.playerSubtitleSettings-profile[data-profile="primary"]').focus();
            await page.keyboard.press('ArrowRight');
            await page.waitForTimeout(600);
            const after = await profiles.evaluate(node => ({ on: node.querySelector('[aria-selected="true"]')?.textContent?.trim(), focused: document.activeElement?.textContent?.trim(),
                panel: document.querySelector('.playerSubtitleSettings-fields')?.getAttribute('aria-labelledby') }));
            record(label, 'in the player the arrow selects Secondary and keeps focus on it', after.on === 'Secondary' && after.focused === 'Secondary' && /Secondary/.test(after.panel ?? ''), after);
            if (device === 'tv') {
                const tvLook = await page.evaluate(() => { const node = document.activeElement; const style = getComputedStyle(node); return { bg: style.backgroundColor, color: style.color, transform: style.transform }; });
                record(label, 'TV focus on a player tab: filled primary, white label, grown 1.08', tvLook.bg === PRIMARY && tvLook.color === 'rgb(255, 255, 255)' && /matrix\(1\.08/.test(tvLook.transform), tvLook);
            }
            await page.keyboard.press('Escape');
            await page.waitForTimeout(600);
        }
        record(label, 'no page errors', page.errors.length === 0, page.errors.slice(0, 3));
    } catch (error) {
        record(label, 'ran to the end', false, String(error.message).split('\n')[0]);
    } finally {
        await context.close();
    }
}
await browser.close();
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
/* eslint-enable compat/compat, no-restricted-globals, @stylistic/max-statements-per-line, sonarjs/cognitive-complexity */
