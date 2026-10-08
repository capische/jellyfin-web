/* eslint-disable compat/compat, no-restricted-globals, sonarjs/cognitive-complexity -- a Node preview runner, not shipped code */
/* global window, document, ApiClient, location, localStorage */
// Preview shots for the settings-row icons and Title Case change (fix/settings-rows-case, 2026-10-08). Read-only: it opens
// editors and types into an unsaved mapping row, and saves nothing.
//
//   JELLYFINMOD_TEST_URL=http://<host>:<isolated-port>/ JELLYFINMOD_SHOTS=<dir> node rows-preview.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const testUrl = new URL(process.env.JELLYFINMOD_TEST_URL ?? (() => { throw new Error('JELLYFINMOD_TEST_URL is required'); })());
if (!['28096', '18096', '58096'].includes(testUrl.port)) throw new Error('Runs on the isolated instances only');
const shots = process.env.JELLYFINMOD_SHOTS ?? (() => { throw new Error('JELLYFINMOD_SHOTS is required'); })();
mkdirSync(shots, { recursive: true });
const base = new URL('/web/', testUrl).href;

const browser = await chromium.launch({ headless: true });
const shot = async (page, name, options = {}) => {
    const file = join(shots, `${name}.png`);
    await page.screenshot({ path: file, ...options });
    console.log('shot', file);
};

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
    await page.waitForFunction(() => location.hash.startsWith('#/home'), undefined, { timeout: 30000 });
    await page.waitForTimeout(1500);
}

const api = (page, method, path, body) => page.evaluate(async ([m, p, b]) => {
    const response = await fetch(ApiClient.getUrl(p), {
        method: m, headers: { 'Content-Type': 'application/json', Authorization: ApiClient.getAuthorizationHeader?.() ?? `MediaBrowser Token="${ApiClient.accessToken()}"` },
        body: b === undefined ? undefined : JSON.stringify(b)
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
}, [method, path, body]);
const FIXTURE = 'JellyfinMod Preview Profile';

const section = async (page, id) => {
    await page.evaluate(target => { location.hash = '#/catalog/settings?section=' + target; }, id);
    await page.locator(`.jfmod-check-section[data-section="${id}"]`).waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(800);
};

// ---- Desktop ----
{
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await signIn(page);
    await section(page, 'overview');
    await shot(page, 'desktop-rail-and-heading');
    await section(page, 'indexers');
    await shot(page, 'desktop-indexers-rows', { fullPage: true });
    await page.locator('.jfmod-rowactions [data-row-action="remove"]').first().hover();
    await page.waitForTimeout(700);
    await shot(page, 'desktop-indexers-remove-tooltip');
    await page.mouse.move(1, 899);
    // A second profile for the shot only, so a row with Make Default shows; removed below.
    const created = await api(page, 'POST', 'JellyfinMod/Settings/QualityProfiles', { name: FIXTURE, qualities: ['webdl-720p'], upgradeAllowed: false, upgradeMode: 'replace' });
    console.log('fixture profile', created.status);
    // The settings area reads its data when it mounts: leave it and come back so the new profile is read.
    await page.evaluate(() => { location.hash = '#/home'; });
    await page.waitForTimeout(2000);
    await section(page, 'profiles');
    await page.locator('.jfmod-brow[data-profile]').nth(1).waitFor({ state: 'visible', timeout: 15000 }).catch(() => console.log('second profile row not shown'));
    await shot(page, 'desktop-profiles-rows', { fullPage: true });
    await page.locator('.jfmod-rowactions [data-row-action="edit"]').first().click();
    await page.locator('.MuiDialog-paper').waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(600);
    await page.evaluate(() => document.querySelector('.MuiDialog-paper .jfmod-qlist')?.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(300);
    await shot(page, 'desktop-profile-dialog-quality-order');
    await page.locator('.MuiDialog-paper button', { hasText: 'Cancel' }).click();
    await page.waitForTimeout(500);
    await page.evaluate(() => { location.hash = '#/configurationpage?name=JellyfinMod'; });
    await page.locator('#JellyfinModConfigPage .jfmod-step').first().waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(2500);
    await page.evaluate(() => document.querySelector('#JellyfinModConfigPage .jfmod-step[data-section="profiles"]')?.click());
    await page.waitForTimeout(800);
    await shot(page, 'desktop-dashboard-profiles-make-default');
    if (created.body?.id) console.log('fixture removed', (await api(page, 'DELETE', `JellyfinMod/Settings/QualityProfiles/${created.body.id}`)).status);
    const left = (await api(page, 'GET', 'JellyfinMod/Settings/QualityProfiles')).body.filter(profile => profile.name === FIXTURE).length;
    console.log('fixture profiles left', left);
    await section(page, 'client');
    // An unsaved mapping row, typed for the shot only: nothing is saved.
    if (!await page.locator('.jfmod-maprow').count()) {
        await page.locator('button', { hasText: 'Add Mapping' }).click();
        const fields = page.locator('.jfmod-maprow').last().locator('input');
        await fields.nth(0).fill('/downloads/complete');
        await fields.nth(1).fill('/media/downloads/complete');
    }
    await page.evaluate(() => document.querySelector('.jfmod-maprow')?.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(400);
    await shot(page, 'desktop-client-path-mappings');
    await section(page, 'discovery');
    await page.locator('button[aria-label="User Menu"]').click();
    await page.locator('.MuiPopover-root:not([aria-hidden="true"]) .MuiMenuItem-root', { hasText: 'JellyfinMod Settings' }).waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(500);
    await shot(page, 'desktop-user-menu');
    await page.keyboard.press('Escape');
    await page.evaluate(() => { location.hash = '#/catalog/settings/setup?step=indexers'; });
    await page.locator('#jfmodSetupPage .jfmod-wizardSection').first().waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(800);
    await shot(page, 'desktop-wizard-indexers');
    // The Dashboard page: Indexers, Quality Profiles with a profile's quality order, Download Client mappings.
    await page.evaluate(() => { location.hash = '#/configurationpage?name=JellyfinMod'; });
    await page.locator('#JellyfinModConfigPage .jfmod-step').first().waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(2500);
    const dashSection = async id => {
        await page.evaluate(target => document.querySelector(`#JellyfinModConfigPage .jfmod-step[data-section="${target}"]`)?.click(), id);
        await page.waitForTimeout(800);
    };
    await dashSection('indexers');
    await shot(page, 'desktop-dashboard-indexers');
    await dashSection('profiles');
    await shot(page, 'desktop-dashboard-profiles');
    await page.locator('#ProfileList [data-row-action="edit"]').first().click();
    await page.locator('#JfmodSheet').waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(600);
    await shot(page, 'desktop-dashboard-profile-sheet');
    await page.locator('#JfmodSheetCancel').click();
    await page.waitForTimeout(500);
    await dashSection('client');
    if (!await page.locator('#MappingRows .jfmod-maprow').count()) {
        await page.locator('#AddMapping').click();
        await page.waitForTimeout(300);
    }
    await page.evaluate(() => document.querySelector('#MappingRows')?.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(400);
    await shot(page, 'desktop-dashboard-client-mappings');
    await dashSection('diagnostics');
    await shot(page, 'desktop-dashboard-diagnostics');
    await context.close();
}

// ---- Mobile ----
{
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await signIn(page);
    await section(page, 'indexers');
    await shot(page, 'mobile-indexers-rows', { fullPage: true });
    await section(page, 'profiles');
    await shot(page, 'mobile-profiles-rows', { fullPage: true });
    await context.close();
}

// ---- TV 1080: Indexers with a row icon focused, by keys ----
{
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await context.newPage();
    await signIn(page);
    await page.evaluate(() => localStorage.setItem('layout', 'tv'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.documentElement.classList.contains('layout-tv'), undefined, { timeout: 30000 });
    await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } }, undefined, { timeout: 30000 });
    await section(page, 'indexers');
    await page.locator('.jfmod-rowactions [data-row-action="test"]').first().focus();
    const walked = [];
    for (let step = 0; step < 3; step++) {
        walked.push(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')));
        if (step < 2) {
            await page.keyboard.press('ArrowRight');
            await page.waitForTimeout(250);
        }
    }
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(400);
    walked.push(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')));
    console.log('tv arrows', JSON.stringify(walked));
    await shot(page, 'tv1080-indexers-row-icon-focused');
    await section(page, 'profiles');
    await page.locator('.jfmod-rowactions [data-row-action="edit"]').first().click();
    await page.locator('.MuiDialog-paper').waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(600);
    await page.locator('.MuiDialog-paper .jfmod-qrow [data-row-action="down"]').first().focus();
    await page.evaluate(() => document.activeElement?.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(600);
    await shot(page, 'tv1080-profile-dialog-down-focused');
    await page.keyboard.press('Escape');
    await page.evaluate(() => localStorage.removeItem('layout'));
    await context.close();
}

await browser.close();
