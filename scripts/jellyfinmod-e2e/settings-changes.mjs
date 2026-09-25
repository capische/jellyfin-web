/* eslint-disable compat/compat, no-restricted-globals, sonarjs/cognitive-complexity -- a Node acceptance runner, not shipped code */
/* global window, document, ApiClient, location */
// P7.S11 runner step 2 on the acceptance instance: the settings changes in the browser, against stand-ins over real HTTP.
//
//   JELLYFINMOD_TEST_URL=http://<host>:<isolated-port>/ JELLYFINMOD_BROWSER=chromium|chrome
//   JELLYFINMOD_STANDIN=<stand-in address as the instance sees it> JELLYFINMOD_STANDIN_PORT_BASE=28110
//   JELLYFINMOD_STANDIN_SECRETS=<0600 file: PROWLARR_KEY, TX_USER, TX_PASSWORD> JELLYFINMOD_STANDIN_SSH=<ssh alias of the stand-ins' host>
//   JELLYFINMOD_CHANGES_OUT=<json results file> node settings-changes.mjs
//
// Stand-ins: scripts/jellyfinmod-e2e/standins/standins.mjs (Transmission RPC, Prowlarr and its Torznab feed), never a
// real Transmission or Prowlarr. Signs in as oleksii with an empty password. Every fixture is JellyfinMod-prefixed and
// removed through the pages; the run ends by comparing the settings lists with the snapshot it took first. It never
// changes the selected download client, the acquisition switch or any existing client, indexer or profile, and it never
// runs a Test against an existing indexer or client that is not a stand-in.
//
//   1 Dashboard plugin page: a new download client with the username left blank saves (201) and, because another client
//     exists, is not selected; its Test reaches the stand-in Transmission.
//   2 Settings area, Indexers: a provoked validation error names its field; Add an indexer with its defaults (stand-in
//     Torznab) saves; its API key replaced from the dialog reads Configured again and the Test follows the key.
//   3 Settings area, Prowlarr card: the API key replaced and saved returns to Configured; Test and Sync against the
//     stand-in; the sync outcome stays on the page; Remove takes the synced indexer with it.
//   4 Settings area, Download client (the selected client, read only): the import-path probe's outcome stays.
//   5 Cleanup through the pages, then the settings lists equal the snapshot; no response carried a fixture secret.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const required = name => process.env[name] ?? (() => { throw new Error(`${name} is required`); })();
const testUrl = new URL(required('JELLYFINMOD_TEST_URL'));
if (!['18096', '28096'].includes(testUrl.port)) throw new Error('Runs on the isolated instances only');
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
const base = new URL('/web/', testUrl).href;
const standin = required('JELLYFINMOD_STANDIN');
const portBase = Number(process.env.JELLYFINMOD_STANDIN_PORT_BASE ?? 38110);
const secrets = Object.fromEntries(readFileSync(required('JELLYFINMOD_STANDIN_SECRETS'), 'utf8').split('\n')
    .filter(line => line.includes('=')).map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()]));
const wrongKey = 'f'.repeat(32);
const secretValues = [secrets.PROWLARR_KEY, secrets.TX_PASSWORD, secrets.TMDB_TOKEN].filter(Boolean);
const TX = `http://${standin}:${portBase + 2}/transmission/rpc`;
const PROWLARR = `http://${standin}:${portBase + 1}`;
const TORZNAB = `${PROWLARR}/1/api`;
const NAMES = { client: 'JellyfinMod Standin Transmission', indexer: 'JellyfinMod Standin Torznab', invalid: 'JellyfinMod Invalid Indexer', prowlarr: 'JellyfinMod Standin Prowlarr' };

const control = path => JSON.parse(execFileSync('ssh', [required('JELLYFINMOD_STANDIN_SSH'), `curl -s 'http://127.0.0.1:${portBase + 9}${path}'`], { encoding: 'utf8' }));
const scrub = value => {
    let text = JSON.stringify(value);
    if (text === undefined) return undefined;
    for (const secret of secretValues) text = text.split(secret).join('<secret>');
    text = text.split(testUrl.host).join('<host>').replace(/\b(?:10|127|172\.(?:1[6-9]|2\d|3[01])|192\.168)(?:\.\d{1,3}){2,3}\b/g, '<private-ip>');
    return JSON.parse(text);
};
const results = [];
const record = (step, check, ok, detail) => {
    const verdict = ok === true ? 'PASS' : ok === false ? 'FAIL' : ok;
    const clean = detail === undefined ? undefined : scrub(detail);
    results.push({ step, check, verdict, detail: clean });
    console.log(`${verdict} [${tier}] ${step}: ${check}${clean === undefined ? '' : ' :: ' + JSON.stringify(clean).slice(0, 500)}`);
};

const browser = await chromium.launch(tier === 'chrome' ? { headless: true, channel: 'chrome' } : { headless: true });
const browserVersion = browser.version();
console.log('browser', tier, browserVersion);
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
const page = await context.newPage();
const errors = [];
const leaks = [];
let responses = 0;
page.on('pageerror', error => errors.push(String(error.message).split('\n')[0]));
// Every write to the download clients, in order, with the id it concerned: if a fixture client is ever left for the
// fallback again (seen once on Chrome in the 2026-09-25 verification, not reproduced), this says who created it.
const clientWrites = [];
page.on('response', response => {
    const url = new URL(response.url());
    if (!/\/JellyfinMod\/Settings\/DownloadClients/.test(url.pathname) || response.request().method() === 'GET') return;
    clientWrites.push({ at: new Date().toISOString().slice(11, 23), method: response.request().method(), status: response.status(),
        path: url.pathname.replace(/^.*\/Settings\//, ''), page: new URL(response.frame().url()).hash.split('?')[0] });
});
page.on('response', async response => {
    if (!/\/JellyfinMod\//.test(response.url())) return;
    responses++;
    const text = await response.text().catch(() => '');
    if (secretValues.some(secret => text.includes(secret))) leaks.push(new URL(response.url()).pathname);
});

const api = (method, path, body) => page.evaluate(async ({ method, path, body }) => {
    const response = await fetch(ApiClient.getUrl(path), {
        method, headers: { Authorization: `MediaBrowser Token="${ApiClient.accessToken()}"`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    let parsed = text;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    return { status: response.status, body: parsed };
}, { method, path, body });

async function signIn() {
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.ApiClient, undefined, { timeout: 30000 });
    await page.waitForFunction(() => {
        try { return !!ApiClient.getCurrentUserId() || /login|selectuser|selectserver/.test(location.hash); } catch { return false; }
    }, undefined, { timeout: 30000 });
    if (!await page.evaluate(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } })) {
        const field = page.locator('#txtManualName');
        if (!await field.isVisible().catch(() => false)) {
            const chooser = page.locator('.btnManual').first();
            await chooser.waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
            if (await chooser.count()) await chooser.evaluate(node => node.click());
            await field.waitFor({ state: 'visible', timeout: 15000 });
        }
        await page.waitForTimeout(1000);
        await field.fill('oleksii');
        await page.locator('button:visible').filter({ hasText: 'Sign In' }).first().click();
        await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } }, undefined, { timeout: 30000 });
    }
    await page.waitForFunction(() => location.hash.startsWith('#/home'), undefined, { timeout: 30000 });
    await page.waitForTimeout(1500);
}

// The comparable state of every settings list: ids with their revisions and user-set fields. Status fields the server
// refreshes on its own (lastError, verifiedAt, capabilities) are left out.
const LIST_KEYS = {
    'Settings/Indexers': ['id', 'name', 'baseUrl', 'enabled', 'automateTitleMatches', 'categories', 'priority', 'revision', 'managedBy', 'apiKeyConfigured'],
    'Settings/DownloadClients': ['id', 'name', 'baseUrl', 'username', 'passwordConfigured', 'enabled', 'label', 'downloadDirectory', 'localDirectory', 'revision', 'pathMappings'],
    'Settings/QualityProfiles': ['id', 'name', 'qualities', 'cutoff', 'isDefault', 'revision'],
    'Settings/Prowlarr': ['id', 'name', 'baseUrl', 'revision']
};
async function snapshot() {
    const out = {};
    for (const [path, keys] of Object.entries(LIST_KEYS)) {
        out[path] = ((await api('GET', 'JellyfinMod/' + path)).body ?? []).map(item => Object.fromEntries(keys.map(key => [key, item[key]])));
    }
    const acquisition = (await api('GET', 'JellyfinMod/Settings/Acquisition')).body;
    out.acquisition = { enabled: acquisition.enabled, downloadClientId: acquisition.downloadClientId, defaultQualityProfileId: acquisition.defaultQualityProfileId,
        revision: acquisition.revision, holdSeconds: acquisition.holdSeconds };
    out.retention = (await api('GET', 'JellyfinMod/Settings/Retention')).body;
    out.automation = (await api('GET', 'JellyfinMod/Settings/Automation')).body;
    out.import = (await api('GET', 'JellyfinMod/Settings/Import')).body;
    return out;
}

// ---- settings-area helpers
const section = id => page.locator(`section[data-section="${id}"]`);
const noticeText = async locator => (await locator.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
const field = (scope, label) => scope.getByLabel(label, { exact: true });
const fill = async (scope, label, value) => { const input = field(scope, label); await input.fill(''); await input.fill(value); };
const openSection = async id => {
    await page.evaluate(sectionId => { location.hash = '#/catalog/settings?section=' + sectionId; }, id);
    await section(id).waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(1500);
};
/** Clicks a button that disables itself while its request runs, and waits for the whole cycle. */
const busyCycle = async (button, timeout = 60000) => {
    const handle = await button.elementHandle();
    await button.click();
    await page.waitForFunction(element => element.disabled, handle, { timeout: 5000 }).catch(() => {});
    await page.waitForFunction(element => !element.disabled, handle, { timeout });
    await page.waitForTimeout(700);
};
/**
 * Clicks and samples a notice every 20 ms until it shows the pattern, then 4 s more: a result that appears and is
 * cleared again is caught instead of passing unseen.
 */
const watchNotice = async (selector, click, pattern, timeout = 30000) => {
    await page.evaluate(sel => {
        window.__jfmodSeen = [];
        clearInterval(window.__jfmodTimer);
        window.__jfmodTimer = setInterval(() => {
            const text = (document.querySelector(sel)?.textContent ?? '').replace(/\s+/g, ' ').trim();
            if (window.__jfmodSeen.at(-1) !== text) window.__jfmodSeen.push(text);
        }, 20);
    }, selector);
    await click();
    const appeared = await page.waitForFunction(source => window.__jfmodSeen.some(text => new RegExp(source).test(text)), pattern.source, { timeout })
        .then(() => true, () => false);
    await page.waitForTimeout(appeared ? 4000 : 0);
    const seen = await page.evaluate(() => { clearInterval(window.__jfmodTimer); return window.__jfmodSeen; });
    const result = seen.find(text => pattern.test(text));
    const final = seen.at(-1);
    return { result, final, kept: !!result && final === result };
};
const dialog = () => page.locator('.jfmod-settingsDialog').last();
const secretState = async scope => ({
    configured: await scope.locator('.jfmod-secret-state').first().innerText().catch(() => null),
    editing: await scope.getByRole('button', { name: 'Keep the saved one' }).isVisible().catch(() => false)
});

const before = { at: new Date().toISOString() };
let createdClientId = null;
try {
    await signIn();
    Object.assign(before, await snapshot());
    control('/fault?service=txauth&mode=off');

    // ---- 1 Dashboard plugin page: a new client, username blank, while another client exists
    await page.goto(base + '#/dashboard/plugins', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await page.evaluate(() => { location.hash = '#/configurationpage?name=JellyfinMod'; });
    await page.locator('.jfmod-step[data-section="client"]').waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(1500);
    await page.locator('.jfmod-step[data-section="client"]').click();
    await page.locator('#NewClient').click();
    await page.locator('#ClientName').fill(NAMES.client);
    await page.locator('#ClientUrl').fill(TX);
    await page.locator('#ClientUsername').fill('');
    await page.locator('#ClientDownloadDirectory').fill('/downloads');
    await page.locator('#ClientLocalDirectory').fill('/accept/downloads');
    const posted = page.waitForResponse(response => /\/JellyfinMod\/Settings\/DownloadClients$/.test(new URL(response.url()).pathname)
        && response.request().method() === 'POST', { timeout: 20000 });
    await page.locator('section[data-section="client"] [data-submit="client"]').click();
    const created = await posted;
    const createdBody = await created.json().catch(() => null);
    createdClientId = createdBody?.id ?? null;
    record('1 client', 'Dashboard page: a new download client with the username left blank saves (201)', created.status() === 201
        && createdBody?.username === '' && createdBody?.passwordConfigured === false, { status: created.status(), username: createdBody?.username, passwordConfigured: createdBody?.passwordConfigured });
    await page.waitForTimeout(2000);
    const acquisitionAfter = (await api('GET', 'JellyfinMod/Settings/Acquisition')).body;
    record('1 client', 'Creating a client while another exists does not select it; the acquisition switch is unchanged',
        acquisitionAfter.downloadClientId === before.acquisition.downloadClientId && acquisitionAfter.enabled === before.acquisition.enabled
        && acquisitionAfter.revision === before.acquisition.revision,
        { selectedUnchanged: acquisitionAfter.downloadClientId === before.acquisition.downloadClientId, enabled: acquisitionAfter.enabled, revision: acquisitionAfter.revision });
    const picked = await page.locator('#ClientPicker').evaluate(select => select.options[select.selectedIndex]?.textContent ?? null).catch(() => null);
    const grabbingSelect = await page.locator('#AcquisitionClient').evaluate(select => select.options[select.selectedIndex]?.textContent ?? null).catch(() => null);
    record('1 client', 'The page edits the new client, and its Grabbing section still names the selected client', picked === NAMES.client
        && grabbingSelect !== NAMES.client, { editing: picked, grabbingSelects: grabbingSelect });
    await page.locator('#TestClient').click();
    await page.waitForFunction(() => /\([a-z_]+\)/.test(document.querySelector('[data-notice="client"]')?.textContent ?? ''), undefined, { timeout: 60000 });
    const tested = await noticeText(page.locator('[data-notice="client"]'));
    record('1 client', 'Its Test reaches the stand-in Transmission (no credentials, as the stand-in expects here)', /\(ok\)/.test(tested), tested);

    // ---- 2 Settings area, Indexers
    await page.evaluate(() => { location.hash = '#/home'; });
    await page.waitForTimeout(1500);
    await openSection('indexers');
    const indexers = section('indexers');
    await indexers.getByRole('button', { name: 'Add indexer' }).click();
    await dialog().waitFor({ state: 'visible', timeout: 10000 });
    await fill(dialog(), 'Name', NAMES.invalid);
    await fill(dialog(), 'Torznab address', TORZNAB);
    await field(dialog(), 'Priority (lower first)').fill('');
    await dialog().getByRole('button', { name: 'Save', exact: true }).click();
    await dialog().locator('.jfmod-notice').waitFor({ state: 'visible', timeout: 15000 });
    const invalid = await noticeText(dialog().locator('.jfmod-notice'));
    record('2 indexers', 'A provoked validation error names its field (priority left empty), with no parser detail', /priority/i.test(invalid) && !/LineNumber|BytePosition|\$\./.test(invalid), invalid);
    await dialog().getByRole('button', { name: 'Cancel' }).click();
    await dialog().waitFor({ state: 'hidden', timeout: 10000 });
    record('2 indexers', 'The refused indexer was not created', ((await api('GET', 'JellyfinMod/Settings/Indexers')).body ?? []).every(item => item.name !== NAMES.invalid));

    await indexers.getByRole('button', { name: 'Add indexer' }).click();
    await dialog().waitFor({ state: 'visible', timeout: 10000 });
    await fill(dialog(), 'Name', NAMES.indexer);
    await fill(dialog(), 'Torznab address', TORZNAB);
    await page.locator('#jfmodIndexerKey').fill(secrets.PROWLARR_KEY);
    const indexerPosted = page.waitForResponse(response => /\/JellyfinMod\/Settings\/Indexers$/.test(new URL(response.url()).pathname)
        && response.request().method() === 'POST', { timeout: 20000 });
    await dialog().getByRole('button', { name: 'Save', exact: true }).click();
    const indexerCreated = await indexerPosted;
    const closed = await dialog().waitFor({ state: 'hidden', timeout: 15000 }).then(() => true, () => false);
    const mine = ((await api('GET', 'JellyfinMod/Settings/Indexers')).body ?? []).find(item => item.name === NAMES.indexer);
    record('2 indexers', 'Add an indexer with its defaults (stand-in Torznab) saves (201): enabled, automation off, categories 2000, 5000, priority 25',
        indexerCreated.status() === 201 && closed && !!mine && mine.enabled === true && mine.automateTitleMatches === false
        && mine.categories.join() === '2000,5000' && mine.priority === 25 && mine.apiKeyConfigured === true,
        { status: indexerCreated.status(), closed, enabled: mine?.enabled, automateTitleMatches: mine?.automateTitleMatches, categories: mine?.categories, priority: mine?.priority });
    await page.waitForTimeout(1500);
    const row = () => indexers.locator(`.jfmod-brow[data-indexer="${mine.id}"]`);
    const indexerNotice = () => noticeText(indexers.locator('.jfmod-notice').first());
    await busyCycle(row().getByRole('button', { name: 'Test' }));
    const firstTest = await indexerNotice();
    record('2 indexers', 'Its Test verifies the stand-in Torznab feed', /\(ok\)/.test(firstTest), firstTest);
    const editKey = async value => {
        await row().getByRole('button', { name: 'Edit' }).click();
        await dialog().waitFor({ state: 'visible', timeout: 10000 });
        const shown = await secretState(dialog());
        await dialog().getByRole('button', { name: 'Replace' }).click();
        await page.locator('#jfmodIndexerKey').fill(value);
        await dialog().getByRole('button', { name: 'Save', exact: true }).click();
        await dialog().waitFor({ state: 'hidden', timeout: 15000 });
        await page.waitForTimeout(1500);
        return shown;
    };
    const shownBefore = await editKey(wrongKey);
    await row().getByRole('button', { name: 'Edit' }).click();
    await dialog().waitFor({ state: 'visible', timeout: 10000 });
    const shownAfter = await secretState(dialog());
    await dialog().getByRole('button', { name: 'Cancel' }).click();
    await dialog().waitFor({ state: 'hidden', timeout: 10000 });
    await busyCycle(row().getByRole('button', { name: 'Test' }));
    const wrongTest = await indexerNotice();
    await editKey(secrets.PROWLARR_KEY);
    await busyCycle(row().getByRole('button', { name: 'Test' }));
    const rightTest = await indexerNotice();
    record('2 indexers', 'The indexer API key replaced from the dialog reads Configured again, and the Test follows the saved key',
        /Configured/.test(shownBefore.configured ?? '') && /Configured/.test(shownAfter.configured ?? '') && !shownAfter.editing
        && !/\(ok\)/.test(wrongTest) && /\(ok\)/.test(rightTest), { before: shownBefore, after: shownAfter, wrongKeyTest: wrongTest, rightKeyTest: rightTest });

    // ---- 3 Prowlarr card: add, replace the key, Test, Sync, Remove
    const card = page.locator('[data-prowlarr="card"]');
    const cardNotice = () => noticeText(card.locator('.jfmod-notice').first());
    await fill(card, 'Name', NAMES.prowlarr);
    await fill(card, 'Prowlarr address', PROWLARR);
    await page.locator('#jfmodProwlarrKey').fill(secrets.PROWLARR_KEY);
    await card.getByRole('button', { name: 'Add Prowlarr' }).click();
    await page.waitForFunction(() => /Saved/.test(document.querySelector('[data-prowlarr="card"] .jfmod-notice')?.textContent ?? ''), undefined, { timeout: 20000 });
    await page.waitForTimeout(1500);
    const addedState = await secretState(card);
    await card.getByRole('button', { name: 'Replace' }).click();
    await page.locator('#jfmodProwlarrKey').fill(wrongKey);
    await card.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForFunction(() => /Saved/.test(document.querySelector('[data-prowlarr="card"] .jfmod-notice')?.textContent ?? ''), undefined, { timeout: 20000 });
    await page.waitForTimeout(1500);
    const replacedState = await secretState(card);
    await busyCycle(card.getByRole('button', { name: 'Test', exact: true }));
    const prowlarrWrong = await cardNotice();
    record('3 prowlarr', 'Prowlarr: the API key replaced and saved returns to Configured (not an empty New field), and the Test uses it (unauthorized)',
        /Configured/.test(addedState.configured ?? '') && /Configured/.test(replacedState.configured ?? '') && !replacedState.editing && /unauthorized/.test(prowlarrWrong),
        { afterAdd: addedState, afterReplace: replacedState, test: prowlarrWrong });
    await card.getByRole('button', { name: 'Replace' }).click();
    await page.locator('#jfmodProwlarrKey').fill(secrets.PROWLARR_KEY);
    await card.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForFunction(() => /Saved/.test(document.querySelector('[data-prowlarr="card"] .jfmod-notice')?.textContent ?? ''), undefined, { timeout: 20000 });
    await page.waitForTimeout(1500);
    await busyCycle(card.getByRole('button', { name: 'Test', exact: true }));
    const prowlarrOk = await cardNotice();
    const sync = await watchNotice('[data-prowlarr="card"] .jfmod-notice', () => page.locator('[data-prowlarr="sync"]').click(), /Synced|changed nothing/);
    const synced = ((await api('GET', 'JellyfinMod/Settings/Indexers')).body ?? []).filter(item => item.managedBy === 'prowlarr');
    record('3 prowlarr', 'Prowlarr: the right key passes the Test; Sync adds the stand-in indexer and its outcome stays on the page',
        /\(ok\)/.test(prowlarrOk) && /Synced: 1 seen, 1 added/.test(sync.result ?? '') && sync.kept && synced.length === 1,
        { test: prowlarrOk, shown: sync.result ?? '(never shown)', final: sync.final || '(cleared)', synced: synced.map(item => item.name) });
    await card.locator('[data-prowlarr="remove"]').click();
    await page.locator('[data-jfmod-confirm="confirm"]').click({ timeout: 10000 });
    await page.waitForFunction(() => [...document.querySelectorAll('[data-prowlarr="card"] button')].some(button => /Add Prowlarr/.test(button.textContent ?? '')),
        undefined, { timeout: 30000 });
    const afterRemove = (await api('GET', 'JellyfinMod/Settings/Indexers')).body ?? [];
    record('3 prowlarr', 'Removing the Prowlarr source removes the indexer it synced', ((await api('GET', 'JellyfinMod/Settings/Prowlarr')).body ?? []).length === 0
        && afterRemove.every(item => item.managedBy !== 'prowlarr'), { indexers: afterRemove.length });

    // ---- 4 Download client section (the selected client): the import-path probe keeps its outcome
    await openSection('client');
    const client = section('client');
    const shownName = await field(client, 'Name').inputValue();
    const selected = before['Settings/DownloadClients'].find(item => item.id === before.acquisition.downloadClientId);
    record('4 probe', 'The settings area still edits the selected client, not the new one', shownName === selected?.name, { shown: shownName });
    const probeNotice = '[data-section="client"] .jfmod-notice';
    await fill(client, 'A path as Transmission reports it', '/elsewhere/film.mkv');
    const unmapped = await watchNotice(probeNotice, () => client.getByRole('button', { name: 'Test import path' }).click(), /path_unmapped/);
    await fill(client, 'A path as Transmission reports it', selected.downloadDirectory);
    const mapped = await watchNotice(probeNotice, () => client.getByRole('button', { name: 'Test import path' }).click(), /\((ok|linked)\)/);
    record('4 probe', 'Test import path: an unmapped path and the client\'s download folder each show their outcome, and it stays',
        unmapped.kept && mapped.kept, { unmapped: unmapped.result ?? '(never shown)', unmappedFinal: unmapped.final || '(cleared)', mapped: mapped.result ?? '(never shown)',
            mappedFinal: mapped.final || '(cleared)' });

    // ---- 5 Cleanup through the pages
    await openSection('indexers');
    await indexers.locator(`[data-indexer-remove="${mine.id}"]`).click();
    await page.locator('[data-jfmod-confirm="confirm"]').click({ timeout: 10000 });
    await page.waitForFunction(() => /Removed/.test(document.querySelector('[data-section="indexers"] .jfmod-notice')?.textContent ?? ''), undefined, { timeout: 20000 });
    record('5 cleanup', 'The fixture indexer is removed through the settings area', ((await api('GET', 'JellyfinMod/Settings/Indexers')).body ?? []).every(item => item.id !== mine.id));
    await page.goto(base + '#/dashboard/plugins', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await page.evaluate(() => { location.hash = '#/configurationpage?name=JellyfinMod'; });
    await page.locator('.jfmod-step[data-section="client"]').waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(1500);
    await page.locator('.jfmod-step[data-section="client"]').click();
    await page.locator('#ClientPicker').selectOption(createdClientId);
    await page.waitForTimeout(800);
    const editingName = await page.locator('#ClientName').inputValue();
    if (editingName !== NAMES.client) throw new Error('the Dashboard page is not editing the fixture client: ' + editingName);
    page.once('dialog', nativeDialog => nativeDialog.accept());
    await page.locator('#DeleteClient').click();
    // The stock confirm dialog; its confirm button is selected by data-id, never by position.
    const confirmButton = page.locator('.dialogContainer .formDialogFooterItem[data-id="ok"], .dialogContainer button[data-id="ok"]').first();
    if (await confirmButton.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false)) await confirmButton.click();
    await page.waitForFunction(async id => {
        const response = await fetch(ApiClient.getUrl('JellyfinMod/Settings/DownloadClients'), { headers: { Authorization: `MediaBrowser Token="${ApiClient.accessToken()}"` } });
        return (await response.json()).every(item => item.id !== id);
    }, createdClientId, { timeout: 20000, polling: 1000 });
    record('5 cleanup', 'The fixture client is deleted through the Dashboard page', true);
    createdClientId = null;
} catch (error) {
    record('run', 'completed', 'NOT VERIFIED', String(error.message).split('\n')[0]);
    await page.screenshot({ path: `${process.env.JELLYFINMOD_CHANGES_SHOTS ?? '.'}/settings-changes-${tier}-failure.png` }).catch(() => {});
} finally {
    control('/fault?service=txauth&mode=on');
}

// ---- Hygiene: every fixture gone (removed by API only if a page step failed), then the lists equal the snapshot
try {
    const leftovers = [];
    for (const item of (await api('GET', 'JellyfinMod/Settings/Prowlarr')).body ?? []) {
        if (/^JellyfinMod/.test(item.name)) { leftovers.push('prowlarr ' + item.name); await api('DELETE', `JellyfinMod/Settings/Prowlarr/${item.id}`); }
    }
    for (const item of (await api('GET', 'JellyfinMod/Settings/Indexers')).body ?? []) {
        if (/^JellyfinMod/.test(item.name) && item.managedBy !== 'prowlarr') { leftovers.push('indexer ' + item.name); await api('DELETE', `JellyfinMod/Settings/Indexers/${item.id}`); }
    }
    for (const item of (await api('GET', 'JellyfinMod/Settings/DownloadClients')).body ?? []) {
        if (/^JellyfinMod/.test(item.name)) {
            leftovers.push({ kind: 'client', name: item.name, id: item.id.slice(0, 8), revision: item.revision, writes: clientWrites.map(write => ({ ...write, path: write.path.replace(/[0-9a-f]{32}/, id => id.slice(0, 8)) })) });
            await api('DELETE', `JellyfinMod/Settings/DownloadClients/${item.id}`);
        }
    }
    record('5 cleanup', 'No fixture had to be removed by the fallback', leftovers.length === 0, leftovers);
    const after = await snapshot();
    const differences = Object.keys(after).filter(key => JSON.stringify(after[key]) !== JSON.stringify(before[key]));
    record('5 cleanup', 'Indexers, clients, profiles, Prowlarr sources, acquisition, retention, automation and import settings equal the snapshot',
        differences.length === 0, { differences, counts: Object.fromEntries(Object.keys(LIST_KEYS).map(key => [key, after[key].length])) });
    record('5 cleanup', `No response carried a fixture secret (${responses} JellyfinMod responses)`, leaks.length === 0, leaks);
    record('5 cleanup', 'No page errors', errors.length === 0, errors.slice(0, 3));
} catch (error) {
    record('hygiene', 'completed', 'NOT VERIFIED', String(error.message).split('\n')[0]);
}
await context.close();
await browser.close();
if (process.env.JELLYFINMOD_CHANGES_OUT) {
    writeFileSync(process.env.JELLYFINMOD_CHANGES_OUT, JSON.stringify({ browser: tier, version: browserVersion, results }, null, 1) + '\n');
}
const failed = results.filter(result => result.verdict !== 'PASS').length;
console.log(`${results.length - failed} of ${results.length} checks passed`);
process.exitCode = failed ? 1 : 0;
