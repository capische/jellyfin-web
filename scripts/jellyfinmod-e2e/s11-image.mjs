/* eslint-disable compat/compat, no-restricted-globals, sonarjs/cognitive-complexity -- a Node acceptance runner, not shipped code */
/* global window, document, location, localStorage, performance, ApiClient */
// P7.S11 step 4 on a disposable JellyfinMod image container: what /web serves in each takeover state, in every layout.
// The host-side half (restarts, recreate, rollback, file edits, hashes) is driven by the caller between steps.
//
//   JELLYFINMOD_S11_STEP=stock|mod|interface-off|interface-on node s11-image.mjs
//   JELLYFINMOD_S11_LAYOUTS=desktop,mobile,tv1080,tv720   JELLYFINMOD_S11_LABEL=<row name for the record>
//
// stock          /web renders stock Jellyfin at the unchanged address: no mod bundle ran, the page settles (no reload
//                loop), and the stock login works. A fresh context per layout, so no cached bundle can hide a failure.
// mod            /web is the JellyfinMod shell in each layout; on the TV, arrows, Enter and Back drive Home and the wizard.
// interface-*    the Interface section's switch, clicked in the settings area as an administrator.
import { api, launch, newPage, notVerified, record, saveResults, setTvLayout, signIn, base } from './s11-lib.mjs';

const step = process.env.JELLYFINMOD_S11_STEP ?? 'stock';
const label = process.env.JELLYFINMOD_S11_LABEL ?? step;
const layouts = (process.env.JELLYFINMOD_S11_LAYOUTS ?? 'desktop,mobile,tv1080,tv720').split(',');
const browser = await launch();
console.log('browser', browser.version(), 'step', step, 'label', label);

async function stock() {
    for (const layout of layouts) {
        const { page, context } = await newPage(browser, layout);
        const documents = [];
        const modRequests = [];
        // Full document loads only: hash routing inside the page is not a reload.
        page.on('load', () => documents.push(page.url()));
        page.on('request', request => { if (request.url().includes('/web-mod/')) modRequests.push(request.url()); });
        try {
            if (layout.startsWith('tv')) {
                await page.goto(base('/web/'), { waitUntil: 'domcontentloaded' });
                await page.evaluate(() => localStorage.setItem('layout', 'tv'));
            }
            await page.goto(base('/web/'), { waitUntil: 'domcontentloaded' });
            await page.locator('#txtManualName, .btnManual, .manualLoginForm, #loginPage').first().waitFor({ state: 'attached', timeout: 45000 });
            await page.waitForTimeout(5000);
            const state = await page.evaluate(() => ({
                bundle: window.__jfmodBundle === true,
                marker: document.documentElement.outerHTML.includes('jellyfinmod:takeover'),
                meta: !!document.querySelector('meta[name="jellyfinmod-web"]'),
                address: location.pathname,
                layoutClass: document.documentElement.className.match(/layout-[a-z]+/)?.[0] ?? null,
                loginVisible: !!document.querySelector('#txtManualName, .btnManual')
            }));
            const settled = documents.length;
            await page.waitForTimeout(4000);
            record(label, `${layout}: /web renders stock Jellyfin at the same address, no mod bundle ran, no reload loop`,
                !state.bundle && !state.meta && state.address.startsWith('/web/') && state.loginVisible && documents.length === settled && documents.length <= (layout.startsWith('tv') ? 2 : 1),
                { ...state, documentLoads: documents.length, modRequests: modRequests.length });
        } catch (error) {
            notVerified(label, `${layout}: stock page`, error);
        }
        await context.close();
    }
    // Sign in on the stock page once: it is a working Jellyfin, not just a login form.
    const { page, context } = await newPage(browser);
    try {
        await signIn(page);
        const home = await page.evaluate(() => ({ bundle: window.__jfmodBundle === true, hash: location.hash }));
        await page.evaluate(() => { location.hash = '#/dashboard'; });
        await page.waitForFunction(() => document.body.innerText.includes('Dashboard'), undefined, { timeout: 30000 });
        record(label, 'desktop: the stock page signs in, reaches Home and the Dashboard', !home.bundle && home.hash.startsWith('#/home'), home);
    } catch (error) {
        notVerified(label, 'stock sign-in', error);
    }
    await context.close();
}

const press = async (page, key, times = 1) => { for (let i = 0; i < times; i++) { await page.keyboard.press(key); await page.waitForTimeout(350); } };
const focused = page => page.evaluate(() => {
    const element = document.activeElement;
    return element ? `${element.tagName.toLowerCase()}${element.className ? '.' + String(element.className).split(' ')[0] : ''} ${(element.textContent || '').trim().slice(0, 30)}` : 'none';
});

async function mod() {
    for (const layout of layouts) {
        const { page, context } = await newPage(browser, layout);
        try {
            await signIn(page);
            if (layout.startsWith('tv')) await setTvLayout(page);
            const shell = await page.evaluate(() => ({
                bundle: window.__jfmodBundle === true, meta: document.querySelector('meta[name="jellyfinmod-web"]')?.getAttribute('content') ?? null,
                layoutClass: document.documentElement.className.match(/layout-[a-z]+/)?.[0] ?? null, address: location.pathname + location.hash,
                horizontalScroll: document.documentElement.scrollWidth - window.innerWidth
            }));
            record(label, `${layout}: /web is the JellyfinMod shell`, shell.bundle && !!shell.meta && shell.address.startsWith('/web/') && shell.horizontalScroll <= 1, shell);
            if (layout.startsWith('tv')) {
                // Home by keys only.
                const trail = [await focused(page)];
                for (const key of ['ArrowDown', 'ArrowDown', 'ArrowRight', 'ArrowRight']) { await press(page, key); trail.push(await focused(page)); }
                record(label, `${layout}: arrows move focus on Home`, new Set(trail).size >= 3, trail);
                // The wizard: reachable, arrows walk its rail, Enter opens a step, Back leaves.
                await page.evaluate(() => { location.hash = '#/catalog/settings/setup'; });
                await page.locator('.jfmod-step').first().waitFor({ state: 'visible', timeout: 30000 });
                await page.waitForTimeout(1500);
                await page.locator('.jfmod-step').first().focus();
                const steps = [];
                for (let i = 0; i < 3; i++) { await press(page, 'ArrowDown'); steps.push(await page.evaluate(() => document.activeElement?.getAttribute('data-step'))); }
                await press(page, 'Enter');
                const opened = await page.evaluate(() => document.querySelector('.jfmod-step[aria-current="true"]')?.getAttribute('data-step'));
                record(label, `${layout}: the wizard's rail is walked by arrows and Enter opens a step`, steps.filter(Boolean).length >= 2 && opened === steps.at(-1), { steps, opened });
                await press(page, 'Escape');
                await page.waitForTimeout(1500);
                const left = await page.evaluate(() => location.hash);
                record(label, `${layout}: Back leaves the wizard`, !left.includes('settings/setup'), { hash: left });
            }
            record(label, `${layout}: no page errors`, page.jfmodErrors.length === 0, page.jfmodErrors.slice(0, 3));
        } catch (error) {
            notVerified(label, `${layout}: mod shell`, error);
        } finally {
            await page.evaluate(() => localStorage.removeItem('layout')).catch(() => {});
        }
        await context.close();
    }
}

async function setInterface(on) {
    const { page, context } = await newPage(browser);
    try {
        await signIn(page, on ? '/web-mod/' : '/web/');
        await page.evaluate(() => { location.hash = '#/catalog/settings?section=interface'; });
        const area = page.locator('section[data-section="interface"]');
        await area.waitFor({ state: 'visible', timeout: 30000 });
        await page.waitForTimeout(1500);
        const toggle = area.getByLabel('Serve this interface at /web', { exact: true });
        if (await toggle.isChecked() !== on) await toggle.click();
        await page.waitForFunction(wanted => /Saved/.test(document.querySelector('section[data-section="interface"] .jfmod-notice')?.textContent ?? '')
            || false, on, { timeout: 30000 });
        const state = (await api(page, 'GET', 'JellyfinMod/Settings/Interface')).body;
        record(label, `The Interface section's switch turns the takeover ${on ? 'on' : 'off'}`,
            state.TakeoverEnabled === on && state.Status === (on ? 'patched' : 'stock'),
            { enabled: state.TakeoverEnabled, status: state.Status, patchedBy: state.PatchedBy, blocker: state.Blocker });
    } catch (error) {
        notVerified(label, `Interface switch ${on ? 'on' : 'off'}`, error);
    }
    await context.close();
}

try {
    if (step === 'stock') await stock();
    else if (step === 'mod') await mod();
    else if (step === 'interface-off') await setInterface(false);
    else if (step === 'interface-on') await setInterface(true);
    else throw new Error('unknown step ' + step);
} finally {
    saveResults(label, browser.version());
    await browser.close();
}
