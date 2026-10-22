/* eslint-disable compat/compat, no-restricted-globals, sonarjs/cognitive-complexity -- a Node acceptance runner, not shipped code */
/* global window, document, ApiClient, location, localStorage */
// P6.FU1 acceptance: the setup wizard with Indexers before the Download Client step, and the download clients Prowlarr
// knows offered there. Real browser, real JellyfinMod, the S11 stand-ins over real HTTP (Prowlarr, its Torznab feed and
// Transmission RPC).
//
//   JELLYFINMOD_TEST_URL=http://127.0.0.1:<local environment port>/ JELLYFINMOD_BROWSER=chromium|chrome \
//   JELLYFINMOD_FU1_FIXTURE_FILE=<0600 stand-in secrets file> JELLYFINMOD_FU1_PROWLARR=<Prowlarr as Jellyfin reaches it> \
//   JELLYFINMOD_FU1_CONTROL=http://127.0.0.1:<stand-in control port> JELLYFINMOD_FU1_TX_PORT=<the port Prowlarr reports> \
//   JELLYFINMOD_FU1_ROOT=<a writable folder as Jellyfin sees it> JELLYFINMOD_FU1_HOST_ROOT=<the same folder on this machine> \
//   node prowlarr-first.mjs
//
// JELLYFINMOD_FU1_LAYOUTS=desktop,mobile,tv1080
// The topology it expects: Prowlarr reports a Transmission at localhost:<TX_PORT>, which does not answer from Jellyfin
// (it is Prowlarr's view, like a client behind a VPN sidecar); the same port on Jellyfin's default gateway reaches the
// stand-in Transmission (a forwarder published on the gateway address only). It needs a fresh environment: no Prowlarr
// source, indexer or download client. It adds a "JellyfinMod FU1 Movies" test library for the download folder's
// filesystem check, and removes it, the client and the Prowlarr source at the end. Signs in as oleksii with an empty
// password; the fixture's Prowlarr key and Transmission password are typed into the page and never printed.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const required = name => process.env[name] ?? (() => { throw new Error(`${name} is required`); })();
const testUrl = new URL(required('JELLYFINMOD_TEST_URL'));
const localEnvironment = ['127.0.0.1', 'localhost'].includes(testUrl.hostname) && ['8096', '9096', '10096', '11096', '12096'].includes(testUrl.port);
if (localEnvironment) {
    const publicInfo = await fetch(new URL('/System/Info/Public', testUrl)).then(response => response.json()).catch(() => ({}));
    if (!/^jellyfinmod-(alpha|bravo|charlie|delta|echo)$/.test(publicInfo.ServerName ?? '')) throw new Error(`${testUrl.host} answers as "${publicInfo.ServerName}", not as a JellyfinMod local environment`);
}
if (!localEnvironment && !['18096', '28096', '48096'].includes(testUrl.port)) throw new Error('Runs on the isolated instances only');
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
const base = new URL('/web/', testUrl).href;
const fixture = Object.fromEntries(readFileSync(required('JELLYFINMOD_FU1_FIXTURE_FILE'), 'utf8').split('\n')
    .filter(line => line.includes('=')).map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()]));
const prowlarrUrl = required('JELLYFINMOD_FU1_PROWLARR');
const control = required('JELLYFINMOD_FU1_CONTROL');
const txPort = Number(required('JELLYFINMOD_FU1_TX_PORT'));
const root = required('JELLYFINMOD_FU1_ROOT');
const hostRoot = required('JELLYFINMOD_FU1_HOST_ROOT');
const only = (process.env.JELLYFINMOD_FU1_LAYOUTS ?? 'desktop,mobile,tv1080').split(',');
const LAYOUTS = {
    desktop: { viewport: { width: 1440, height: 900 } },
    mobile: {
        viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
    },
    tv1080: { viewport: { width: 1920, height: 1080 }, tv: true },
    tv720: { viewport: { width: 1280, height: 720 }, tv: true }
};
const ORDER = ['discovery', 'indexers', 'downloadClient', 'qualityProfile', 'enable', 'optional'];
const SEEDBOX = 'JellyfinMod Seedbox';
const LIBRARY = 'JellyfinMod FU1 Movies';

const results = [];
const record = (layout, check, ok, detail) => {
    results.push({ layout, check, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'} [${tier}/${layout}] ${check}${detail === undefined ? '' : ' :: ' + JSON.stringify(detail).slice(0, 600)}`);
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
    await page.waitForFunction(() => location.hash.startsWith('#/home'), undefined, { timeout: 30000 });
    await page.waitForTimeout(1500);
}

/** An authenticated call as the signed-in administrator: status and parsed body. */
const api = (page, method, path, body) => page.evaluate(async ({ method, path, body }) => {
    const response = await fetch(ApiClient.getUrl(path), {
        method, headers: { Authorization: `MediaBrowser Token="${ApiClient.accessToken()}"`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: response.status, body: parsed };
}, { method, path, body });
const standin = (path, body) => fetch(control + path, { method: 'POST', body: JSON.stringify(body) }).then(response => response.json());

const section = (page, id) => page.locator(`section[data-section="${id}"]`);
const noticeText = async (page, id) => (await section(page, id).locator('.jfmod-check-secbody > .jfmod-notice .jfmod-notice-text').first().innerText().catch(() => '')).trim();
const openStep = async (page, id) => {
    await page.evaluate(step => { location.hash = '#/catalog/settings/setup' + (step ? '?step=' + step : ''); }, id);
    await page.locator('.jfmod-check').waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(900);
};
const current = page => page.locator('.jfmod-step[aria-current="true"]').getAttribute('data-step');
const field = (scope, label) => scope.getByLabel(label, { exact: true });
/** Presses a button the way the layout does: Enter on the focused button on the TV, a click elsewhere. */
const press = async (layout, locator) => {
    if (layout.tv) {
        await locator.focus();
        await locator.page().keyboard.press('Enter');
    } else {
        await locator.click();
    }
};
const shot = (page, layout, what) => page.locator('.jfmod-check-main').screenshot({ path: join(process.env.JELLYFINMOD_SHOTS ?? hostRoot, `fu1-${tier}-${layout}-${what}.png`) })
    .catch(() => undefined);
const stepState = page => page.evaluate(() => document.querySelector('[data-wizard-state]')?.getAttribute('data-wizard-state'));

/** Removes the client, unselecting it first, so the next layout starts the Download Client step afresh. */
const removeClients = async page => {
    const acquisition = (await api(page, 'GET', 'JellyfinMod/Settings/Acquisition')).body;
    if (acquisition.downloadClientId) {
        await api(page, 'PATCH', 'JellyfinMod/Settings/Acquisition', {
            enabled: false, downloadClientId: null, defaultQualityProfileId: acquisition.defaultQualityProfileId, revision: acquisition.revision
        });
    }
    for (const client of (await api(page, 'GET', 'JellyfinMod/Settings/DownloadClients')).body ?? []) {
        await api(page, 'DELETE', `JellyfinMod/Settings/DownloadClients/${client.id}`);
    }
};

const bodies = [];
const watchBodies = page => page.on('response', async response => {
    if (/\/JellyfinMod\//.test(response.url())) bodies.push({ url: response.url(), body: await response.text().catch(() => '') });
});

let setupPage;
let ready = false;
// Set once the environment proved fresh (no source, client or indexer): only then is everything there at the end this run's own,
// so only then does the cleanup below remove sources, clients, the test library and the host folder.
let fresh = false;
const setupContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
try {
    setupPage = await setupContext.newPage();
    await signIn(setupPage);
    const sources = (await api(setupPage, 'GET', 'JellyfinMod/Settings/Prowlarr')).body;
    const clients = (await api(setupPage, 'GET', 'JellyfinMod/Settings/DownloadClients')).body;
    const indexers = (await api(setupPage, 'GET', 'JellyfinMod/Settings/Indexers')).body;
    if (sources.length || clients.length || indexers.length) throw new Error('needs a fresh environment: no Prowlarr source, download client or indexer');
    fresh = true;
    await standin('/prowlarr-clients', [
        { name: SEEDBOX, implementation: 'Transmission', host: 'localhost', port: txPort, urlBase: '/transmission/', username: fixture.TX_USER },
        { name: 'JellyfinMod Qbit', implementation: 'QBittorrent', host: 'qbit', port: 8080 }
    ]);
    mkdirSync(join(hostRoot, 'library'), { recursive: true });
    mkdirSync(join(hostRoot, 'downloads'), { recursive: true });
    const added = await api(setupPage, 'POST',
        `Library/VirtualFolders?name=${encodeURIComponent(LIBRARY)}&collectionType=movies&refreshLibrary=false&paths=${encodeURIComponent(root + '/library')}`);
    if (added.status >= 300) throw new Error(`test library not added: ${added.status}`);
    ready = true;
} catch (error) {
    record('setup', 'fixtures ready', false, 'NOT VERIFIED: ' + String(error?.message ?? error).split('\n')[0]);
}

for (const name of ready ? only : []) {
    const layout = LAYOUTS[name];
    const context = await browser.newContext({ viewport: layout.viewport, isMobile: layout.isMobile, hasTouch: layout.hasTouch, userAgent: layout.userAgent });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error.message).split('\n')[0]));
    watchBodies(page);
    try {
        await signIn(page);
        if (layout.tv) {
            await page.evaluate(() => localStorage.setItem('layout', 'tv'));
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } }, undefined, { timeout: 30000 });
            await page.waitForTimeout(2000);
        }
        // ---- The order: Indexers is step 2, the Download Client step 3, in the rail and the server's state alike.
        await openStep(page, null);
        const rail = await page.locator('.jfmod-step').evaluateAll(steps => steps.map(step => step.getAttribute('data-step')));
        const serverOrder = (await api(page, 'GET', 'JellyfinMod/Setup/State')).body.steps.map(step => step.id);
        record(name, 'The rail and Setup/State list Indexers before the Download Client', JSON.stringify(rail) === JSON.stringify(ORDER) &&
            JSON.stringify(serverOrder) === JSON.stringify(ORDER), { rail, serverOrder });
        const firstLayout = !(await api(page, 'GET', 'JellyfinMod/Settings/Prowlarr')).body.length;
        if (firstLayout) {
            record(name, 'A fresh setup resumes at Indexers, the first incomplete step', await current(page) === 'indexers', await current(page));
        }
        await openStep(page, 'indexers');
        record(name, 'Indexers is "Step 2 of 6"', (await section(page, 'indexers').locator('.jfmod-eyebrow').textContent()).trim() === 'Step 2 of 6');
        if (firstLayout) {
            // ---- The Indexers step: Prowlarr's address and key, Add, Sync Now; its synced indexer verifies the step.
            const card = page.locator('[data-prowlarr="card"]');
            await field(card, 'Prowlarr address').fill(prowlarrUrl);
            await page.locator('#jfmodProwlarrKey').fill(fixture.PROWLARR_KEY);
            await press(layout, card.locator('button', { hasText: 'Add Prowlarr' }));
            await page.waitForFunction(() => /Saved/.test(document.querySelector('[data-prowlarr="card"] .jfmod-notice-text')?.textContent ?? ''), undefined, { timeout: 30000 });
            await press(layout, card.locator('[data-prowlarr="sync"]'));
            await page.waitForFunction(() => document.querySelector('[data-wizard-state]')?.getAttribute('data-wizard-state') === 'done', undefined, { timeout: 60000 });
            record(name, 'Prowlarr added and synced in the Indexers step completes it', true,
                await card.locator('.jfmod-notice-text').innerText().catch(() => ''));
            await press(layout, page.locator('[data-wizard="continue"]').first());
            await page.waitForTimeout(900);
            record(name, 'Continue moves from Indexers to the Download Client', await current(page) === 'downloadClient', await current(page));
        } else {
            await openStep(page, 'downloadClient');
        }
        const client = section(page, 'client');
        record(name, 'The Download Client is "Step 3 of 6"', (await client.locator('.jfmod-eyebrow').textContent()).trim() === 'Step 3 of 6');

        // ---- Found in Prowlarr: one button per Transmission client, the unsupported one named, nothing saved by itself.
        const found = page.locator('[data-prowlarr="found"]');
        await found.waitFor({ state: 'visible', timeout: 20000 });
        const use = found.locator(`[data-prowlarr-client="${SEEDBOX}"]`);
        await shot(page, name, 'found');
        const useText = (await use.innerText()).trim();
        record(name, 'Found in Prowlarr offers the Transmission client with its host and port', useText.toLowerCase() === `use ${SEEDBOX} from prowlarr (localhost:${txPort})`.toLowerCase(), useText);
        record(name, 'A client this plugin cannot drive is named as not supported yet',
            /Not supported yet: JellyfinMod Qbit \(QBittorrent\)/.test(await found.locator('[data-prowlarr="unsupported"]').innerText()));
        record(name, 'No password field is filled for the admin', await page.locator('#jfmodClientPassword').inputValue() === '');
        await press(layout, use);
        await page.waitForTimeout(400);
        const filled = {
            name: await field(client, 'Name').inputValue(), address: await field(client, 'Transmission RPC address').inputValue(),
            username: await field(client, 'Username').inputValue()
        };
        record(name, 'Use fills the name, the RPC address and the username', filled.name === SEEDBOX &&
            filled.address === `http://localhost:${txPort}/transmission/rpc` && filled.username === fixture.TX_USER, { name: filled.name, address: filled.address });
        record(name, 'Use saves nothing', !(await api(page, 'GET', 'JellyfinMod/Settings/DownloadClients')).body.length);

        // ---- Save and Test: Prowlarr's localhost does not answer from Jellyfin; the gateway is offered, once.
        await field(client, 'Download folder in Transmission').fill('/downloads');
        await field(client, 'The same folder as this server sees it').fill(root + '/downloads');
        await page.locator('#jfmodClientPassword').fill(fixture.TX_PASSWORD);
        await press(layout, client.locator('[data-submit="client"]'));
        await page.waitForFunction(() => /Saved/.test(document.querySelector('section[data-section="client"] .jfmod-check-secbody > .jfmod-notice .jfmod-notice-text')?.textContent ?? ''),
            undefined, { timeout: 30000 });
        await press(layout, client.locator('[data-test="client"]'));
        await page.waitForFunction(() => /\((client_unreachable|timeout)\)/.test(document.querySelector('section[data-section="client"] .jfmod-check-secbody > .jfmod-notice .jfmod-notice-text')?.textContent ?? ''),
            undefined, { timeout: 45000 });
        record(name, 'The Test of Prowlarr\'s own address fails with its normal message', true, await noticeText(page, 'client'));
        const gatewayAnswer = (await api(page, 'GET', `JellyfinMod/Settings/Prowlarr/${(await api(page, 'GET', 'JellyfinMod/Settings/Prowlarr')).body[0].id}/DownloadClients`)).body;
        const gateway = gatewayAnswer.gateway;
        record(name, 'The server names its private default gateway', /^(10|172\.(1[6-9]|2\d|3[01])|192\.168)\./.test(gateway ?? ''), gateway);
        const suggestion = page.locator('[data-prowlarr="gateway"]');
        await suggestion.waitFor({ state: 'visible', timeout: 15000 });
        const tryButton = suggestion.getByRole('button');
        await shot(page, name, 'gateway');
        record(name, 'The gateway is offered as a suggestion, with the same port', (await tryButton.innerText()).trim() === `Try ${gateway}:${txPort}`, await tryButton.innerText());
        record(name, 'Nothing was tried on the gateway by itself', (await api(page, 'GET', 'JellyfinMod/Settings/DownloadClients')).body[0].baseUrl ===
            `http://localhost:${txPort}/transmission/rpc`);
        await press(layout, tryButton);
        await page.waitForTimeout(400);
        record(name, 'Try fills the gateway address and saves nothing',
            await field(client, 'Transmission RPC address').inputValue() === `http://${gateway}:${txPort}/transmission/rpc` &&
            (await api(page, 'GET', 'JellyfinMod/Settings/DownloadClients')).body[0].baseUrl === `http://localhost:${txPort}/transmission/rpc`);
        await press(layout, client.locator('[data-submit="client"]'));
        await page.waitForFunction(() => /Saved/.test(document.querySelector('section[data-section="client"] .jfmod-check-secbody > .jfmod-notice .jfmod-notice-text')?.textContent ?? ''),
            undefined, { timeout: 30000 });
        record(name, 'After the save the suggestion is gone: one retry only', !await suggestion.isVisible().catch(() => false));
        await press(layout, client.locator('[data-test="client"]'));
        await page.waitForFunction(() => /\(ok\)/.test(document.querySelector('section[data-section="client"] .jfmod-check-secbody > .jfmod-notice .jfmod-notice-text')?.textContent ?? ''),
            undefined, { timeout: 45000 });
        await page.waitForFunction(() => document.querySelector('[data-wizard-state]')?.getAttribute('data-wizard-state') === 'done', undefined, { timeout: 30000 });
        record(name, 'Through the gateway the Test passes and the step is done', await stepState(page) === 'done', await noticeText(page, 'client'));
        record(name, 'With the client verified, Found in Prowlarr is gone', !await found.isVisible().catch(() => false));
        if (name === 'mobile') {
            record(name, 'Mobile: the Download Client step has no horizontal scroll', await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 1);
        }
        record(name, 'No page errors', errors.length === 0, errors.slice(0, 3));
    } catch (error) {
        const where = await page.evaluate(() => `${location.hash}`).catch(() => '?');
        record(name, 'run completed', false, 'NOT VERIFIED: ' + String(error?.message ?? error).split('\n')[0] + ' @ ' + where);
    } finally {
        await shot(page, name, 'end');
        await removeClients(page).catch(() => undefined);
        await page.evaluate(() => localStorage.removeItem('layout')).catch(() => {});
        await context.close();
    }
}

// ---- The secrets never came back, and the fixtures are gone.
record('all', 'No response carried the Prowlarr key or the Transmission password',
    !bodies.some(item => item.body.includes(fixture.PROWLARR_KEY) || item.body.includes(fixture.TX_PASSWORD)), { responses: bodies.length });
record('all', 'The download-client read never carried a password, masked or not',
    bodies.filter(item => /\/DownloadClients$/.test(new URL(item.url).pathname) && /Prowlarr/.test(item.url)).every(item => !/password|\*{8}/i.test(item.body)));
try {
    if (!fresh) throw new Error('cleanup skipped: the environment was not proven fresh, so nothing was removed');
    await removeClients(setupPage);
    for (const source of (await api(setupPage, 'GET', 'JellyfinMod/Settings/Prowlarr')).body ?? []) {
        await api(setupPage, 'DELETE', `JellyfinMod/Settings/Prowlarr/${source.id}`);
    }
    // With a refresh: without one the library's view outlives its folder (an orphan view in UserViews).
    await api(setupPage, 'DELETE', `Library/VirtualFolders?name=${encodeURIComponent(LIBRARY)}&refreshLibrary=true`);
    await standin('/prowlarr-clients', []);
    const userId = await setupPage.evaluate(() => ApiClient.getCurrentUserId());
    let views = [];
    for (let attempt = 0; attempt < 12; attempt++) {
        views = (await api(setupPage, 'GET', `UserViews?userId=${userId}`)).body.Items.map(item => item.Name).sort();
        if (!views.includes(LIBRARY)) break;
        await setupPage.waitForTimeout(5000);
    }
    rmSync(hostRoot, { recursive: true, force: true });
    const left = {
        sources: (await api(setupPage, 'GET', 'JellyfinMod/Settings/Prowlarr')).body.length,
        clients: (await api(setupPage, 'GET', 'JellyfinMod/Settings/DownloadClients')).body.length,
        indexers: (await api(setupPage, 'GET', 'JellyfinMod/Settings/Indexers')).body.length
    };
    record('all', 'Cleanup: only Movies and Shows remain, and no source, client or indexer', JSON.stringify(views) === '["Movies","Shows"]' &&
        !left.sources && !left.clients && !left.indexers, { views, ...left });
} catch (error) {
    record('all', 'cleanup completed', false, String(error?.message ?? error).split('\n')[0]);
}
await setupContext.close();
await browser.close();
const failed = results.filter(result => !result.ok).length;
console.log(`${results.length - failed} of ${results.length} checks pass`);
process.exit(failed ? 1 : 0);
