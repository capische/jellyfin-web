/* eslint-disable compat/compat, no-restricted-globals, sonarjs/cognitive-complexity -- a Node acceptance runner, not shipped code */
/* global window, document, ApiClient, location */
// P7.S5 acceptance: the JellyfinMod Docker image, on a disposable container started from an empty config.
//
//   JELLYFINMOD_IMAGE_URL=http://<host>:<disposable-port>/ \
//   JELLYFINMOD_IMAGE_SECRET_FILE=<file outside any repository> \
//   JELLYFINMOD_IMAGE_STEP=wizard|review|stock|takeover-off|takeover-on JELLYFINMOD_BROWSER=chromium|chrome node image-review.mjs
//
// wizard  runs the server's first-run wizard in the browser and creates a disposable administrator. The
//         password is generated here, written only to the secret file (mode 0600) and never printed. Use it
//         only against a disposable container that is destroyed, with its config, when the run ends.
// review  signs in as that administrator and checks: the JellyfinMod shell at /web, authenticated Health,
//         Dashboard -> Plugins with the plugin, its version and no repository error, the preconfigured
//         repository, and the settings area.
// stock   checks that /web serves the stock interface (takeover off): no mod bundle, the stock login.
// takeover-off / takeover-on  switch the takeover through the settings endpoint as the administrator.
// repo-remove / repo-add      edit the server's repository list as Manage Repositories does.
// no-repository               with the entry removed: the plugin keeps working, the details panel loses its source.
import { chromium } from 'playwright';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const required = name => process.env[name] ?? (() => { throw new Error(`${name} is required`); })();
const origin = new URL(required('JELLYFINMOD_IMAGE_URL'));
// Never the production port or the shared isolated instances: this runner creates an administrator.
if (['8096', '18096', '28096'].includes(origin.port)) throw new Error('Runs only against a disposable image container');
const secretFile = required('JELLYFINMOD_IMAGE_SECRET_FILE');
const step = process.env.JELLYFINMOD_IMAGE_STEP ?? 'review';
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
const shots = process.env.JELLYFINMOD_IMAGE_SHOTS;
// The archive shape serves the mod entry as a host file beside the fork's stock index.
const base = new URL(process.env.JELLYFINMOD_IMAGE_DOCUMENT ?? '/web/', origin).href;
// A fresh container is patched with no administrator step, so Health says `automatic`; after an administrator
// switched the takeover back on it says `setting`.
const expectPatchedBy = process.env.JELLYFINMOD_IMAGE_PATCHED_BY ?? 'automatic';
const ADMIN = 'jfmod-image-admin';
const PLUGIN_ID = '6f1a2b3c-4d5e-4f60-9a71-8b2c3d4e5f60';
const REPOSITORY_ERROR = 'An error occurred while getting the plugin details from the repository';

const results = [];
const record = (check, ok, detail) => {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'} [${tier}] ${check}${detail === undefined ? '' : ' :: ' + JSON.stringify(detail)}`);
};

const browser = await chromium.launch(tier === 'chrome' ? { headless: true, channel: 'chrome' } : { headless: true });
console.log('browser', tier, browser.version(), 'step', step);
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(String(error.message).split('\n')[0]));
const shot = async name => { if (shots) await page.screenshot({ path: `${shots}/${tier}-${name}.png` }); };

async function runWizard() {
    const password = randomBytes(18).toString('base64url');
    writeFileSync(secretFile, password + '\n', { mode: 0o600 });
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => location.hash.includes('wizard'), undefined, { timeout: 30000 });
    record('A fresh server opens the first-run wizard', true, { bundle: await page.evaluate(() => window.__jfmodBundle === true) });
    for (let pageIndex = 0; pageIndex < 12; pageIndex++) {
        const hash = await page.evaluate(() => location.hash);
        if (!hash.includes('wizard')) break;
        const view = page.locator('.page:not(.hide)').last();
        await view.locator('.button-submit').first().waitFor({ state: 'visible', timeout: 20000 });
        await page.waitForTimeout(800);
        if (await view.locator('#txtUsername').isVisible().catch(() => false)) {
            await view.locator('#txtUsername').fill(ADMIN);
            await view.locator('#txtManualPassword').fill(password);
            await view.locator('#txtPasswordConfirm').fill(password);
        }
        await view.locator('.button-submit').first().click();
        await page.waitForFunction(previous => location.hash !== previous, hash, { timeout: 20000 }).catch(() => {});
    }
    const done = await page.evaluate(() => fetch('/System/Info/Public').then(r => r.json()));
    record('The wizard completes and the server reports it', done.StartupWizardCompleted === true, { version: done.Version });
}

async function signIn() {
    const password = readFileSync(secretFile, 'utf8').trim();
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.ApiClient, undefined, { timeout: 30000 });
    const field = page.locator('#txtManualName');
    if (!await field.isVisible().catch(() => false)) {
        const chooser = page.locator('.btnManual').first();
        await chooser.waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
        if (await chooser.count()) await chooser.evaluate(node => node.click());
        await field.waitFor({ state: 'visible', timeout: 15000 });
    }
    await page.waitForTimeout(1000);
    await field.fill(ADMIN);
    await page.locator('#txtManualPassword').fill(password);
    await page.locator('button:visible').filter({ hasText: 'Sign In' }).first().click();
    await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } }, undefined, { timeout: 30000 });
    await page.waitForFunction(() => location.hash.startsWith('#/home'), undefined, { timeout: 30000 });
    await page.waitForTimeout(2000);
}

async function review() {
    await signIn();
    const shell = await page.evaluate(() => ({
        bundle: window.__jfmodBundle === true,
        meta: document.querySelector('meta[name="jellyfinmod-web"]')?.getAttribute('content') ?? null,
        address: location.pathname + location.hash
    }));
    record('Sign-in lands in the JellyfinMod shell at /web', shell.bundle && !!shell.meta && shell.address.startsWith('/web/'), shell);
    await shot('home');

    // Health through the signed-in session; the token stays in the page and is never returned.
    const health = await page.evaluate(async () => {
        const response = await fetch('/JellyfinMod/Health', { headers: { Authorization: `MediaBrowser Token="${ApiClient.accessToken()}"` } });
        const body = await response.json();
        const web = body.Web ?? body.web ?? {};
        const takeover = web.Takeover ?? web.takeover ?? {};
        return {
            status: response.status, ok: body.Ok ?? body.ok, version: body.Version ?? body.version,
            bundleId: web.BundleId ?? web.bundleId, hostVersion: web.HostVersion ?? web.hostVersion,
            blocker: web.Blocker ?? web.blocker ?? null,
            takeover: { state: takeover.Status ?? takeover.status, webRoot: takeover.WebRoot ?? takeover.webRoot,
                patchedBy: takeover.PatchedBy ?? takeover.patchedBy, blocker: takeover.Blocker ?? takeover.blocker ?? null }
        };
    });
    const anonymous = await page.evaluate(() => fetch('/JellyfinMod/Health').then(r => r.status));
    record('Authenticated Health is ok; anonymous is refused', health.status === 200 && health.ok === true && anonymous === 401,
        { ...health, anonymous });
    record(`Health reports the takeover of the image's own web root, patched by ${expectPatchedBy}`,
        health.takeover.state === 'patched' && health.takeover.patchedBy === expectPatchedBy && health.takeover.webRoot === 'writable'
        && health.bundleId === shell.meta, health.takeover);

    await page.evaluate(() => { location.hash = '#/dashboard/plugins'; });
    const card = page.locator('.card, [class*="Card"]', { hasText: 'JellyfinMod' }).first();
    await card.waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(3000);
    await shot('plugins');
    record('Dashboard -> Plugins lists JellyfinMod', true);
    // Opened the way an administrator opens it, from the card, so the address carries what the page expects.
    await card.click();
    await page.waitForFunction(() => /#\/dashboard\/plugins\/[0-9a-f-]{32,}/i.test(location.hash), undefined, { timeout: 30000 });
    const detailsAddress = await page.evaluate(() => location.hash);
    await page.waitForFunction(() => document.body.innerText.includes('JellyfinMod'), undefined, { timeout: 30000 });
    // The details panel asks every repository for the package; give the failure banner time to appear if it will.
    await page.waitForTimeout(6000);
    const details = await page.evaluate(() => document.body.innerText);
    await shot('plugin-details');
    record('The plugin page shows its version and no repository error',
        !details.includes('An error occurred') && details.includes('0.1.0.0'),
        { error: details.includes(REPOSITORY_ERROR), version: details.includes('0.1.0.0'),
            installed: /Status\s+Active/.test(details), ownPlugin: detailsAddress.replaceAll('-', '').includes(PLUGIN_ID.replaceAll('-', '')) });

    await page.evaluate(() => { location.hash = '#/dashboard/plugins/repositories'; });
    await page.waitForFunction(() => document.body.innerText.includes('Jellyfin Stable') || document.body.innerText.includes('JellyfinMod'), undefined, { timeout: 30000 });
    await page.waitForTimeout(1500);
    const repositories = await page.evaluate(() => document.body.innerText);
    await shot('repositories');
    const listed = repositories.split('JellyfinMod (this server)').length - 1;
    record('Manage Repositories shows the preconfigured entry once, pointing at the server itself',
        listed === 1 && repositories.includes('localhost:8096/JellyfinMod/Repository'), { listed });

    await page.evaluate(() => { location.hash = '#/catalog/settings'; });
    await page.locator('.jfmod-check').waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(1500);
    const overview = await page.locator('.jfmod-check-main').innerText();
    await shot('settings');
    record('The settings area opens and names this bundle', !!shell.meta && overview.includes(shell.meta));
}

async function stock() {
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.ApiClient, undefined, { timeout: 30000 });
    await page.locator('#txtManualName, .btnManual, .manualLoginForm').first().waitFor({ state: 'attached', timeout: 30000 });
    const state = await page.evaluate(() => ({
        bundle: window.__jfmodBundle === true,
        marker: document.documentElement.outerHTML.includes('jellyfinmod:takeover'),
        meta: !!document.querySelector('meta[name="jellyfinmod-web"]'),
        modAssets: performance.getEntriesByType('resource').filter(entry => entry.name.includes('/web-mod/')).length
    }));
    await shot('stock');
    record('With the takeover off, /web is the stock interface', !state.bundle && !state.marker && !state.meta && state.modAssets === 0, state);
    const mod = await page.evaluate(() => fetch('/web-mod/').then(r => r.status));
    record('The interface stays reachable at /web-mod', mod === 200, { status: mod });
}

// The same endpoint the settings area's Interface section saves through, called from the signed-in page.
async function setTakeover(enabled) {
    await signIn();
    const state = await page.evaluate(async wanted => {
        const response = await fetch('/JellyfinMod/Settings/Interface', {
            method: 'PATCH',
            headers: { Authorization: `MediaBrowser Token="${ApiClient.accessToken()}"`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ takeoverEnabled: wanted })
        });
        const body = await response.json();
        return { status: response.status, enabled: body.takeoverEnabled ?? body.TakeoverEnabled, state: body.status ?? body.Status,
            stockSha256: body.stockSha256 ?? body.StockSha256, patchedBy: body.patchedBy ?? body.PatchedBy, blocker: body.blocker ?? body.Blocker };
    }, enabled);
    record(`Takeover switched ${enabled ? 'on' : 'off'} from the signed-in page`,
        state.status === 200 && state.enabled === enabled && state.state === (enabled ? 'patched' : 'stock'), state);
}

// The server's own repository list, edited through the endpoint Manage Repositories saves with.
async function editRepositories(add) {
    await signIn();
    const result = await page.evaluate(async wanted => {
        const headers = { Authorization: `MediaBrowser Token="${ApiClient.accessToken()}"`, 'Content-Type': 'application/json' };
        const current = await fetch('/Repositories', { headers }).then(r => r.json());
        const others = current.filter(entry => !(entry.Url ?? '').includes('/JellyfinMod/Repository'));
        const next = wanted
            ? [...others, { Name: 'JellyfinMod (this server)', Url: 'http://localhost:8096/JellyfinMod/Repository', Enabled: true }]
            : others;
        const response = await fetch('/Repositories', { method: 'POST', headers, body: JSON.stringify(next) });
        const after = await fetch('/Repositories', { headers }).then(r => r.json());
        return { status: response.status, mod: after.filter(entry => (entry.Url ?? '').includes('/JellyfinMod/Repository')).length, total: after.length };
    }, add);
    record(`Repository entry ${add ? 're-added' : 'removed'} as an administrator`, result.status === 204 && result.mod === (add ? 1 : 0), result);
}

// Without the repository entry the plugin still runs; only the details panel loses its source.
async function withoutRepository() {
    await signIn();
    const shell = await page.evaluate(() => window.__jfmodBundle === true);
    const health = await page.evaluate(async () => {
        const body = await fetch('/JellyfinMod/Health', { headers: { Authorization: `MediaBrowser Token="${ApiClient.accessToken()}"` } }).then(r => r.json());
        return { ok: body.Ok ?? body.ok, state: (body.Web ?? body.web)?.Takeover?.Status ?? (body.Web ?? body.web)?.takeover?.status };
    });
    const entries = await page.evaluate(async () => (await fetch('/JellyfinMod/Entries', { headers: { Authorization: `MediaBrowser Token="${ApiClient.accessToken()}"` } })).status);
    record('Without its repository the interface, Health and the catalog API keep working', shell && health.ok === true && entries === 200,
        { shell, ...health, entries });
    await page.evaluate(() => { location.hash = '#/dashboard/plugins'; });
    const card = page.locator('.card, [class*="Card"]', { hasText: 'JellyfinMod' }).first();
    await card.waitFor({ state: 'visible', timeout: 30000 });
    await card.click();
    await page.waitForFunction(() => document.body.innerText.includes('Revision History') || document.body.innerText.includes('JellyfinMod'), undefined, { timeout: 30000 });
    await page.waitForTimeout(6000);
    const details = await page.evaluate(() => document.body.innerText);
    await shot('plugin-details-no-repository');
    record('Only the details panel notices: the plugin page reports no repository source',
        /Status\s+Active/.test(details) && !/Repository\s+JellyfinMod \(this server\)/.test(details),
        { repositoryError: details.includes(REPOSITORY_ERROR), active: /Status\s+Active/.test(details) });
}

// What the Interface section reports, read as the administrator.
async function interfaceState() {
    await signIn();
    const state = await page.evaluate(async () => {
        const body = await fetch('/JellyfinMod/Settings/Interface', { headers: { Authorization: `MediaBrowser Token="${ApiClient.accessToken()}"` } }).then(r => r.json());
        return { enabled: body.takeoverEnabled ?? body.TakeoverEnabled, state: body.status ?? body.Status, webRoot: body.webRoot ?? body.WebRoot,
            blocker: body.blocker ?? body.Blocker ?? null, modAddress: body.modAddress ?? body.ModAddress };
    });
    const expected = process.env.JELLYFINMOD_IMAGE_EXPECT_TAKEOVER !== 'false';
    // forkServedByHost is the archive shape: the host serves the fork's own build and the engine stays out.
    const status = process.env.JELLYFINMOD_IMAGE_EXPECT_STATE ?? (expected ? 'patched' : 'stock');
    record(`The Interface section reports switch ${expected ? 'on' : 'off'}, state ${status}`,
        state.enabled === expected && state.state === status && !state.blocker, state);
}

// Archive shape: the host serves the fork's dist/, and the mod entry runs from it with no plugin path involved.
async function archiveEntry() {
    const modRequests = [];
    page.on('request', request => { if (request.url().includes('/web-mod/')) modRequests.push(request.url()); });
    await signIn();
    const shell = await page.evaluate(() => ({ bundle: window.__jfmodBundle === true, address: location.pathname + location.hash,
        meta: document.querySelector('meta[name="jellyfinmod-web"]')?.getAttribute('content') ?? null }));
    await shot('archive-home');
    record('The fork served by the host runs the mod entry from /web with nothing loaded from /web-mod',
        shell.bundle && shell.address.startsWith('/web/jellyfinmod.html') && modRequests.length === 0, { ...shell, modRequests: modRequests.length });
}

try {
    if (step === 'archive') await archiveEntry();
    else if (step === 'interface') await interfaceState();
    else if (step === 'repo-remove') await editRepositories(false);
    else if (step === 'repo-add') await editRepositories(true);
    else if (step === 'no-repository') await withoutRepository();
    else if (step === 'takeover-off') await setTakeover(false);
    else if (step === 'takeover-on') await setTakeover(true);
    else if (step === 'wizard') await runWizard();
    else if (step === 'stock') await stock();
    else await review();
} catch (error) {
    record('runner', false, String(error.message).split('\n')[0]);
    await shot('failure').catch(() => {});
} finally {
    if (errors.length) console.log('page errors:', JSON.stringify([...new Set(errors)].slice(0, 5)));
    await browser.close();
}
const failed = results.filter(ok => !ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
