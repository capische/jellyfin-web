/* eslint-disable compat/compat, no-restricted-globals, sonarjs/cognitive-complexity -- a Node acceptance runner, not shipped code */
/* global document, location, window, ApiClient */
// P7.S11 step 1 on a fresh disposable JellyfinMod image container: the setup wizard end to end with its provoked
// refusals, resume and Dismiss; the secret actions and connection Tests from the page; add, grab, import and play
// through stand-ins; retention and automation with settings saved only through the settings area.
//
//   JELLYFINMOD_S11_STEP=libraries|dismiss|wizard|resume|tv-wizard|tests|acquire|import|play|... node s11-fresh.mjs
// Environment as in s11-lib.mjs. Every fixture title carries the JellyfinMod prefix.
import {
    api, carriesSecret, port, control, fixture, launch, newPage, notVerified, onHost, record, saveResults, setTvLayout, signIn, standin, tier, until, wrong
} from './s11-lib.mjs';

const step = process.env.JELLYFINMOD_S11_STEP ?? 'wizard';
const browser = await launch();
console.log('browser', tier, browser.version(), 'step', step);

const section = (page, id) => page.locator(`section[data-section="${id}"]`);
const notice = async (page, id) => (await section(page, id).locator('.jfmod-notice').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
const waitNotice = async (page, id, pattern, timeout = 45000) => {
    await page.waitForFunction(({ id, source }) => {
        const text = document.querySelector(`[data-section="${id}"] .jfmod-notice`)?.textContent ?? '';
        return new RegExp(source).test(text);
    }, { id, source: pattern.source }, { timeout });
    return notice(page, id);
};
const setupState = async page => (await api(page, 'GET', 'JellyfinMod/Setup/State')).body;
const stepStatus = async (page, id) => (await setupState(page)).steps.find(item => item.id === id);
const openWizard = async (page, stepId) => {
    await page.evaluate(id => { location.hash = '#/catalog/settings/setup' + (id ? '?step=' + id : ''); }, stepId);
    await page.locator('.jfmod-check').waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(800);
};
const current = page => page.locator('.jfmod-step[aria-current="true"]').getAttribute('data-step');
const cont = page => page.locator('[data-wizard="continue"]');
const field = (scope, label) => scope.getByLabel(label, { exact: true });
const fill = async (scope, label, value) => { const input = field(scope, label); await input.fill(''); await input.fill(value); };
const setSwitch = async (scope, label, on) => {
    const input = field(scope, label);
    if (await input.isChecked() !== on) await input.click();
};
const choose = async (page, scope, label, optionText) => {
    await field(scope, label).click();
    await page.getByRole('option', { name: optionText }).first().click();
    await page.waitForTimeout(300);
};
/** Types a secret: straight into the input when none is saved, else through Replace. */
const setSecret = async (scope, id, value) => {
    const input = scope.page().locator('#' + id);
    if (!await input.isVisible().catch(() => false)) await scope.getByRole('button', { name: 'Replace' }).first().click();
    await input.fill(value);
};
/**
 * Clicks and watches a notice: every text it shows, sampled every 20 ms, and what it still says 4 s after the result
 * appeared. A result that is shown and then cleared is caught here instead of passing unseen.
 */
const watchNotice = async (page, selector, click, pattern, timeout = 20000) => {
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
    return { result, final, kept: final === result, seen };
};
/** After a save the field can stay in its "New …" edit mode; Keep the saved one returns it to Configured. */
const settleSecret = async scope => {
    const keep = scope.getByRole('button', { name: 'Keep the saved one' });
    if (await keep.isVisible().catch(() => false)) await keep.click();
};
const probePath = async (page, clientPath) => {
    const clientId = (await api(page, 'GET', 'JellyfinMod/Settings/DownloadClients')).body[0].id;
    return (await api(page, 'POST', `JellyfinMod/Settings/DownloadClients/${clientId}/TestImportPath`, { clientPath })).body.code;
};
/** Saves a settings dialog; a refusal throws with the dialog's own notice so the failure names its reason. */
const saveDialog = async (page, dialog) => {
    await dialog.getByRole('button', { name: 'Save' }).click();
    const closed = await dialog.waitFor({ state: 'hidden', timeout: 15000 }).then(() => true, () => false);
    if (!closed) throw new Error('the dialog refused to save: ' + (await dialog.locator('.jfmod-notice').innerText().catch(() => '(no notice)')));
    await page.waitForTimeout(1500);
};
const grabbingEnabled = async page => (await api(page, 'GET', 'JellyfinMod/Settings/Acquisition')).body.enabled;

// ---- libraries: the host's own libraries, created through Jellyfin's API as an administrator ----
async function libraries() {
    const { page, context } = await newPage(browser);
    await signIn(page);
    const existing = (await api(page, 'GET', 'Library/VirtualFolders')).body;
    for (const [name, type, path] of [['Movies', 'movies', '/data/media/movies'], ['Shows', 'tvshows', '/data/media/tv']]) {
        if (existing.some(folder => folder.Name === name)) continue;
        const created = await api(page, 'POST', `Library/VirtualFolders?name=${name}&collectionType=${type}&refreshLibrary=false`,
            { LibraryOptions: { PathInfos: [{ Path: path }], EnableRealtimeMonitor: true } });
        record('libraries', `Library ${name} created`, created.status === 204, { status: created.status });
    }
    const after = (await api(page, 'GET', 'Library/VirtualFolders')).body.map(folder => ({ name: folder.Name, type: folder.CollectionType, locations: folder.Locations }));
    record('libraries', 'Movies and Shows libraries exist on the single data mount', after.length === 2, after);
    saveResults('libraries', browser.version());
    await context.close();
}

// ---- dismiss: the Home banner's Dismiss hides it; the wizard stays reachable from the settings area ----
async function dismiss() {
    const { page, context } = await newPage(browser);
    await signIn(page);
    const banner = page.locator('.jfmod-setupBanner');
    try {
        await banner.waitFor({ state: 'visible', timeout: 30000 });
        record('dismiss', 'A fresh server shows the setup banner on Home to the administrator', true, await banner.innerText());
        await banner.locator('a, button', { hasText: 'Dismiss' }).first().click();
        await until(async () => (await setupState(page)).dismissedAt, { timeout: 20000, label: 'dismissedAt' });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(5000);
        const state = await setupState(page);
        record('dismiss', 'Dismiss hides the banner and the server records it', await banner.count() === 0 && !!state.dismissedAt && !state.complete,
            { dismissed: !!state.dismissedAt, complete: state.complete });
        await page.evaluate(() => { location.hash = '#/catalog/settings'; });
        await page.locator('.jfmod-check').waitFor({ state: 'visible', timeout: 30000 });
        const link = page.locator('a[href="#/catalog/settings/setup"]').first();
        await link.click();
        await page.locator('.jfmod-step').first().waitFor({ state: 'visible', timeout: 30000 });
        record('dismiss', 'After Dismiss the wizard is still reachable from the settings area', await current(page) === 'discovery', { step: await current(page) });
    } catch (error) {
        notVerified('dismiss', 'banner and Dismiss', error);
    }
    saveResults('dismiss', browser.version());
    await context.close();
}

// ---- wizard: every step with its provoked refusals ----
async function wizard() {
    const { page, context } = await newPage(browser);
    await signIn(page);
    try {
        const banner = page.locator('.jfmod-setupBanner');
        const state = await setupState(page);
        if (!state.dismissedAt) {
            await banner.waitFor({ state: 'visible', timeout: 30000 });
            record('wizard', 'Home banner for an administrator whose setup is incomplete', true, await banner.innerText());
            await banner.locator('a, button', { hasText: 'Set up' }).first().click();
            await page.locator('.jfmod-check').waitFor({ state: 'visible', timeout: 30000 });
        } else {
            await openWizard(page);
        }
        await page.waitForTimeout(1000);
        record('wizard', 'The wizard opens at Discovery with Continue refused', await current(page) === 'discovery' && await cont(page).isDisabled(), { step: await current(page) });

        // Step 5 tried first: the server refuses with 409 acquisition_not_ready and the page shows its blockers verbatim.
        await page.locator('.jfmod-step[data-step="enable"]').click();
        const grabbing = section(page, 'grabbing');
        await grabbing.waitFor({ state: 'visible', timeout: 15000 });
        await setSwitch(grabbing, 'Allow grabs', true);
        await page.locator('[data-submit="grabbing"]').click();
        const refused = await waitNotice(page, 'grabbing', /cannot|not ready|blocker|No /i);
        record('wizard', 'Turning grabbing on before setup is refused with 409 acquisition_not_ready, blockers shown', !await grabbingEnabled(page) && /TMDB|indexer|download client|profile/i.test(refused), refused);

        // 1 Discovery: a wrong token fails its Test; the secret's Replace, Keep, Clear and Undo; the right token passes.
        await page.locator('.jfmod-step[data-step="discovery"]').click();
        const discovery = section(page, 'discovery');
        await page.locator('#jfmodTmdbToken').fill(wrong.token);
        await page.locator('[data-submit="discovery"]').click();
        await waitNotice(page, 'discovery', /Saved/);
        await page.locator('[data-test="discovery"]').click();
        const bad = await waitNotice(page, 'discovery', /\((?!ok\))[a-z_]+\)/);
        record('wizard', 'Discovery: a wrong token fails the Test (unauthorized) and Continue stays refused', /unauthorized/.test(bad) && await cont(page).isDisabled(), bad);
        await discovery.getByRole('button', { name: 'Replace' }).click();
        const replacing = await page.locator('#jfmodTmdbToken').isVisible();
        await discovery.getByRole('button', { name: 'Keep the saved one' }).click();
        await discovery.getByRole('button', { name: 'Clear' }).click();
        const pending = await discovery.locator('.jfmod-secret-pending').innerText();
        await discovery.getByRole('button', { name: 'Undo' }).click();
        const restored = await discovery.locator('.jfmod-secret-state').innerText();
        record('wizard', 'Secret field: Replace opens an empty input, Keep returns, Clear is pending until save, Undo restores Configured',
            replacing && /Will be removed on save/.test(pending) && /Configured/.test(restored), { pending: pending.replace(/\s+/g, ' '), restored });
        await discovery.getByRole('button', { name: 'Replace' }).click();
        await page.locator('#jfmodTmdbToken').fill(fixture.TMDB_TOKEN);
        await page.locator('[data-submit="discovery"]').click();
        await waitNotice(page, 'discovery', /Saved/);
        await page.locator('[data-test="discovery"]').click();
        const good = await waitNotice(page, 'discovery', /\(ok\)/);
        await page.waitForFunction(() => document.querySelector('[data-wizard-state]')?.getAttribute('data-wizard-state') === 'done', undefined, { timeout: 30000 });
        record('wizard', 'Discovery: the stand-in TMDB over HTTPS accepts the token; the step is done and Continue unlocks', !await cont(page).isDisabled(), good);
        const discoveryDto = await api(page, 'GET', 'JellyfinMod/Settings/Discovery');
        record('wizard', 'Discovery DTO says configured and carries no token value', discoveryDto.body.tokenConfigured === true && !carriesSecret(discoveryDto.text),
            { tokenConfigured: discoveryDto.body.tokenConfigured, verified: discoveryDto.body.verified });
        await cont(page).click();
        await page.waitForTimeout(800);

        record('wizard', 'Continue moves to Download client', await current(page) === 'downloadClient');
        await clientStep(page);
    } catch (error) {
        notVerified('wizard', 'steps 1-2', error);
        await page.screenshot({ path: `${process.env.JELLYFINMOD_S11_SHOTS ?? "."}/s11-${tier}-wizard-failure.png` }).catch(() => {});
    }
    saveResults('wizard', browser.version());
    await context.close();
}

// 2 Download client: inside a library root, then another filesystem, then the right folder; mappings; import probe.
async function clientStep(page) {
    {
        const client = section(page, 'client');
        await fill(client, 'Name', 'JellyfinMod Standin Transmission');
        await fill(client, 'Transmission RPC address', `http://${standin}:${port(2)}/transmission/rpc`);
        // Username and password left blank, as for a Transmission with authentication off (the stand-in is switched so).
        await fill(client, 'Label added to every grab', 'jellyfinmod');
        await fill(client, 'Download folder as Transmission sees it', '/downloads');
        await fill(client, 'The same folder as this server sees it', '/data/media/movies');
        control('/fault?service=txauth&mode=off');
        await page.locator('[data-submit="client"]').click();
        const inside = await waitNotice(page, 'client', /library|filesystem|folder/i);
        record('wizard', 'Download client inside a library root is refused (destination_inside_library)', /destination_inside_library/.test(inside), inside);
        await fill(client, 'The same folder as this server sees it', '/dev/shm');
        await page.locator('[data-submit="client"]').click();
        const other = await waitNotice(page, 'client', /destination_not_same_filesystem|filesystem/);
        record('wizard', 'Download folder on a second filesystem (/dev/shm) is refused (destination_not_same_filesystem)', /destination_not_same_filesystem/.test(other), other);
        await fill(client, 'The same folder as this server sees it', '/data/downloads');
        await page.locator('[data-submit="client"]').click();
        const saved = await waitNotice(page, 'client', /Saved/);
        const createdClient = (await api(page, 'GET', 'JellyfinMod/Settings/DownloadClients')).body[0];
        record('wizard', 'A new client with the username left blank saves (201) and the folder on the library filesystem is accepted',
            /Saved/.test(saved) && !!createdClient && createdClient.username === '' && createdClient.passwordConfigured === false,
            { notice: saved, username: createdClient?.username, passwordConfigured: createdClient?.passwordConfigured });
        await page.locator('[data-test="client"]').click();
        const tested = await waitNotice(page, 'client', /\([a-z_]+\)/);
        record('wizard', 'Test verifies the stand-in Transmission and the download folder', /\(ok\)/.test(tested), tested);
        // The Test reloads the settings after its notice appears; an edit started before that reload lands is discarded.
        await page.waitForTimeout(3000);
        const selection = await stepStatus(page, 'downloadClient');
        const selected = !selection.reasons.includes('no_download_client');
        record('wizard', 'Saving the first download client selects it, so step 2 can finish inside step 2', selected, { reasons: selection.reasons });
        if (!selected) {
            // Workaround on the unfixed build: select the client in the Grabbing step, with grabbing left off.
            await page.locator('.jfmod-step[data-step="enable"]').click();
            const grabbingSection = section(page, 'grabbing');
            await grabbingSection.waitFor({ state: 'visible', timeout: 15000 });
            await setSwitch(grabbingSection, 'Allow grabs', false);
            await choose(page, grabbingSection, 'Download client', 'JellyfinMod Standin Transmission');
            await page.locator('[data-submit="grabbing"]').click();
            await waitNotice(page, 'grabbing', /Saved/);
            await page.locator('.jfmod-step[data-step="downloadClient"]').click();
            await page.waitForTimeout(2000);
            record('wizard', 'Workaround: selecting the client in the Grabbing step (grabbing off) clears no_download_client',
                !(await stepStatus(page, 'downloadClient')).reasons.includes('no_download_client'));
        }
        // An unverified mapping: its local folder does not exist.
        while (await client.locator('.jfmod-maprow').count()) await client.locator('.jfmod-maprow').first().getByRole('button', { name: 'Remove' }).click();
        await client.getByRole('button', { name: 'Add mapping' }).click();
        const row = client.locator('.jfmod-maprow').last();
        await fill(row, 'Transmission path', '/downloads');
        await fill(row, 'Local path', '/data/downloads-missing');
        await client.getByRole('button', { name: 'Save mappings' }).click();
        await waitNotice(page, 'client', /Mappings saved|mapping|path/i);
        await page.waitForTimeout(1500);
        const unverified = await client.locator('.jfmod-maprow .jfmod-state').first().innerText();
        const blocked = await stepStatus(page, 'downloadClient');
        record('wizard', 'An unverified mapping keeps the step open and Continue refused', blocked.status !== 'done' && await cont(page).isDisabled(),
            { pill: unverified, status: blocked.status, reasons: blocked.reasons, shown: (await page.locator('[data-wizard-state]').innerText()).replace(/\s+/g, ' ') });
        await fill(client.locator('.jfmod-maprow').last(), 'Local path', '/data/downloads');
        await client.getByRole('button', { name: 'Save mappings' }).click();
        await waitNotice(page, 'client', /Mappings saved/);
        await page.waitForTimeout(1500);
        record('wizard', 'The corrected mapping verifies', /verified/.test(await client.locator('.jfmod-maprow .jfmod-state').first().innerText()));
        const noticeSelector = '[data-section="client"] .jfmod-notice';
        await fill(client, 'A path as Transmission reports it', '/elsewhere/film.mkv');
        const unmapped = await watchNotice(page, noticeSelector, () => client.getByRole('button', { name: 'Test import path' }).click(), /path_unmapped/);
        await fill(client, 'A path as Transmission reports it', '/downloads');
        const probed = await watchNotice(page, noticeSelector, () => client.getByRole('button', { name: 'Test import path' }).click(), /\((ok|linked)\)/);
        const serverCodes = { unmapped: await probePath(page, '/elsewhere/film.mkv'), mapped: await probePath(page, '/downloads') };
        record('wizard', 'Test import path (server): an unmapped path is named; the mapped download folder hardlinks into the libraries',
            serverCodes.unmapped === 'path_unmapped' && serverCodes.mapped === 'ok', serverCodes);
        record('wizard', 'Test import path (page): the result is shown and stays', !!unmapped.result && !!probed.result && unmapped.kept && probed.kept,
            { unmappedShown: unmapped.result ?? '(never shown)', unmappedFinal: unmapped.final || '(cleared)', probedShown: probed.result ?? '(never shown)', probedFinal: probed.final || '(cleared)' });
        // Saving mappings changed the client; its Test runs again for the current revision.
        await page.locator('[data-test="client"]').click();
        await waitNotice(page, 'client', /\(ok\)/);
        await page.waitForFunction(() => document.querySelector('[data-wizard-state]')?.getAttribute('data-wizard-state') === 'done', undefined, { timeout: 30000 });
        record('wizard', 'Download client step done; Continue unlocks', !await cont(page).isDisabled());
        await cont(page).click();
        await page.waitForTimeout(800);
        record('wizard', 'Continue moves to Indexers with Continue refused', await current(page) === 'indexers' && await cont(page).isDisabled());
    }
}

async function client() {
    const { page, context } = await newPage(browser);
    await signIn(page);
    try {
        await openWizard(page, 'downloadClient');
        await clientStep(page);
    } catch (error) {
        notVerified('wizard', 'step 2', error);
        await page.screenshot({ path: `${process.env.JELLYFINMOD_S11_SHOTS ?? "."}/s11-${tier}-client-failure.png` }).catch(() => {});
    }
    saveResults('client', browser.version());
    await context.close();
}

// ---- resume: a new browser session resumes at the first incomplete step, then indexers, profile and enable ----
async function resume() {
    const { page, context } = await newPage(browser);
    await signIn(page);
    try {
        await openWizard(page);
        const first = await current(page);
        record('resume', 'A new browser session resumes the wizard at the first incomplete step', first === 'indexers', { step: first });

        // 3 Indexers through Prowlarr: a wrong key fails its Test, the right one passes, Sync imports and verifies.
        const card = page.locator('[data-prowlarr="card"]');
        await fill(card, 'Name', 'JellyfinMod Standin Prowlarr');
        await fill(card, 'Prowlarr address', `http://${standin}:${port(1)}`);
        await page.locator('#jfmodProwlarrKey').fill(wrong.key);
        await card.getByRole('button', { name: 'Add Prowlarr' }).click();
        await card.locator('.jfmod-notice').waitFor({ state: 'visible', timeout: 20000 });
        await card.getByRole('button', { name: 'Test', exact: true }).click();
        await page.waitForFunction(() => /\([a-z_]+\)/.test(document.querySelector('[data-prowlarr="card"] .jfmod-notice')?.textContent ?? ''), undefined, { timeout: 30000 });
        const badKey = (await card.locator('.jfmod-notice').innerText()).replace(/\s+/g, ' ');
        record('resume', 'Prowlarr: a wrong API key fails the Test (unauthorized)', /unauthorized/.test(badKey), badKey);
        await card.getByRole('button', { name: 'Replace' }).click();
        await page.locator('#jfmodProwlarrKey').fill(fixture.PROWLARR_KEY);
        await card.getByRole('button', { name: 'Save', exact: true }).click();
        await page.waitForFunction(() => /Saved/.test(document.querySelector('[data-prowlarr="card"] .jfmod-notice')?.textContent ?? ''), undefined, { timeout: 20000 });
        await card.getByRole('button', { name: 'Test', exact: true }).click();
        await page.waitForFunction(() => /\(ok\)/.test(document.querySelector('[data-prowlarr="card"] .jfmod-notice')?.textContent ?? ''), undefined, { timeout: 30000 });
        record('resume', 'Prowlarr: the right key passes the Test', true, (await card.locator('.jfmod-notice').innerText()).replace(/\s+/g, ' '));
        const sync = await watchNotice(page, '[data-prowlarr="card"] .jfmod-notice', () => page.locator('[data-prowlarr="sync"]').click(), /Synced|changed nothing/);
        const synced = sync.result ?? '';
        const syncedIndexers = (await api(page, 'GET', 'JellyfinMod/Settings/Indexers')).body;
        record('resume', 'Prowlarr Sync adds the stand-in torrent indexer and verifies its caps',
            /1 added/.test(synced) && /1 verified/.test(synced) && syncedIndexers.some(indexer => indexer.managedBy === 'prowlarr' && indexer.verified), synced);
        record('resume', 'Prowlarr Sync: the page keeps showing the outcome', sync.kept, { final: sync.final || '(cleared)' });
        await page.waitForFunction(() => document.querySelector('[data-wizard-state]')?.getAttribute('data-wizard-state') === 'done', undefined, { timeout: 30000 });
        const indexers = (await api(page, 'GET', 'JellyfinMod/Settings/Indexers')).body;
        record('resume', 'Indexers step done: one synced, enabled, verified indexer holding no key of its own',
            indexers.length === 1 && indexers[0].managedBy === 'prowlarr' && indexers[0].verified && !indexers[0].apiKeyConfigured,
            indexers.map(indexer => ({ name: indexer.name, managedBy: indexer.managedBy, verified: indexer.verified, apiKeyConfigured: indexer.apiKeyConfigured })));
        await cont(page).click();
        await page.waitForTimeout(800);

        // 4 Quality profile: an empty profile and a cutoff outside the allowed qualities are refused.
        record('resume', 'Continue moves to Quality profile', await current(page) === 'qualityProfile');
        const profiles = section(page, 'profiles');
        await profiles.getByRole('button', { name: 'Add profile' }).click();
        const dialog = page.locator('.jfmod-settingsDialog').last();
        await dialog.waitFor({ state: 'visible', timeout: 10000 });
        await fill(dialog, 'Name', 'JellyfinMod Standin HD');
        await dialog.getByRole('button', { name: 'Save' }).click();
        await dialog.locator('.jfmod-notice').waitFor({ state: 'visible', timeout: 15000 });
        const empty = (await dialog.locator('.jfmod-notice').innerText()).replace(/\s+/g, ' ');
        record('resume', 'An empty profile is refused', /qualit/i.test(empty), empty);
        const options = await (async () => {
            await field(dialog, 'Add a quality').click();
            const names = await page.getByRole('option').allInnerTexts();
            await page.keyboard.press('Escape');
            return names;
        })();
        const hd = options.find(name => /1080p/i.test(name) && /web/i.test(name)) ?? options.find(name => /1080p/.test(name));
        const other = options.find(name => /720p/.test(name) && name !== hd) ?? options.find(name => name !== hd);
        await choose(page, dialog, 'Add a quality', hd);
        await choose(page, dialog, 'Add a quality', other);
        await choose(page, dialog, 'Upgrade until', other);
        // Remove the cutoff's quality from the allowed list: the cutoff now names a quality the profile does not allow.
        await dialog.locator('.jfmod-qrow', { hasText: other }).getByRole('button', { name: 'Remove' }).click();
        await dialog.getByRole('button', { name: 'Save' }).click();
        await page.waitForTimeout(1500);
        const cutoff = (await dialog.locator('.jfmod-notice').innerText()).replace(/\s+/g, ' ');
        record('resume', 'A cutoff outside the allowed qualities is refused', /cutoff/i.test(cutoff) && await dialog.isVisible(), { cutoff, allowed: hd, cutoffQuality: other });
        await choose(page, dialog, 'Upgrade until', hd);
        await dialog.getByRole('button', { name: 'Save' }).click();
        await dialog.waitFor({ state: 'hidden', timeout: 15000 });
        await page.waitForTimeout(1500);
        await profiles.getByRole('button', { name: 'Make default' }).first().click();
        await waitNotice(page, 'profiles', /Default changed/);
        await page.waitForFunction(() => document.querySelector('[data-wizard-state]')?.getAttribute('data-wizard-state') === 'done', undefined, { timeout: 30000 });
        record('resume', 'A valid profile made default completes the step', !await cont(page).isDisabled(), { quality: hd });
        await cont(page).click();
        await page.waitForTimeout(800);

        // 5 Enable, now ready.
        const grabbing = section(page, 'grabbing');
        await setSwitch(grabbing, 'Allow grabs', true);
        await page.locator('[data-submit="grabbing"]').click();
        await waitNotice(page, 'grabbing', /Saved/);
        await page.waitForFunction(() => document.querySelector('[data-wizard-state]')?.getAttribute('data-wizard-state') === 'done', undefined, { timeout: 30000 });
        record('resume', 'Grabbing turns on once every step passed', await grabbingEnabled(page) === true);
        await cont(page).click();
        await page.waitForTimeout(800);
        const final = await setupState(page);
        record('resume', 'Setup reports complete; the optional step shows retention, automation and the interface',
            final.complete === true && await current(page) === 'optional' && await section(page, 'retention').count() === 1 && await section(page, 'interface').count() === 1,
            { complete: final.complete, steps: final.steps.map(item => `${item.id}:${item.status}`) });
        await importOn(page);
        record('resume', 'No page errors', page.jfmodErrors.length === 0, page.jfmodErrors.slice(0, 3));
    } catch (error) {
        notVerified('resume', 'steps 3-5', error);
        await page.screenshot({ path: `${process.env.JELLYFINMOD_S11_SHOTS ?? "."}/s11-${tier}-resume-failure.png` }).catch(() => {});
    }
    saveResults('resume', browser.version());
    await context.close();
}


// ---- tests: secret Replace / Clear / Undo and every connection Test from the page, against the stand-ins ----
const openSection = async (page, id) => {
    await page.evaluate(sectionId => { location.hash = '#/catalog/settings?section=' + sectionId; }, id);
    await section(page, id).waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(1500);
};
/**
 * Clicks a Test button and waits for its whole cycle: the section is busy until the Test answered and the settings
 * reloaded, and only then is its notice read. Reading earlier would see the previous notice, and editing earlier would
 * be undone by the reload replacing the form's draft.
 */
const busyCycle = async (page, button, timeout = 90000) => {
    await button.click();
    await button.waitFor({ state: 'attached' });
    await page.waitForFunction(element => element.disabled, await button.elementHandle(), { timeout: 5000 }).catch(() => {});
    await page.waitForFunction(element => !element.disabled, await button.elementHandle(), { timeout });
    await page.waitForTimeout(700);
};
const testNotice = async (page, id, button) => {
    await busyCycle(page, button);
    return notice(page, id);
};
const saveSection = async (page, id) => {
    await page.locator(`[data-submit="${id}"]`).click();
    // A click that lands while the section re-renders after its data refetch can be lost; one retry, then fail.
    const saved = await waitNotice(page, id, /Saved/, 12000).then(() => true, () => false);
    if (!saved) {
        await page.locator(`[data-submit="${id}"]`).click();
        await waitNotice(page, id, /Saved/);
    }
    await page.waitForTimeout(1500);
};

async function tests() {
    const { page, context } = await newPage(browser);
    await signIn(page);
    const tx = `http://${standin}:${port(2)}/transmission/rpc`;
    try {
        // Download client.
        await openSection(page, 'client');
        const client = section(page, 'client');
        const clientTest = () => testNotice(page, 'client', page.locator('[data-test="client"]'));
        // Authentication on in the stand-in; the client gets its username and password from the page.
        control('/fault?service=txauth&mode=on');
        const noCredentials = await clientTest();
        await fill(client, 'Username', fixture.TX_USER);
        await setSecret(client, 'jfmodClientPassword', fixture.TX_PASSWORD);
        await saveSection(page, 'client');
        const withCredentials = await clientTest();
        record('tests', 'Transmission with authentication on: refused without credentials, verified once username and password are saved',
            /client_auth_failed/.test(noCredentials) && /\(ok\)/.test(withCredentials), { without: noCredentials, with: withCredentials });
        await client.getByRole('button', { name: 'Clear' }).click();
        const pending = await client.locator('.jfmod-secret-pending').innerText();
        await client.getByRole('button', { name: 'Undo' }).click();
        record('tests', 'Client password: Clear is pending until save and Undo restores Configured', /Will be removed on save/.test(pending)
            && /Configured/.test(await client.locator('.jfmod-secret-state').innerText()));
        await setSecret(client, 'jfmodClientPassword', wrong.password);
        await saveSection(page, 'client');
        const wrongPassword = await clientTest();
        record('tests', 'Transmission Test with a wrong password', /unauthorized|auth/i.test(wrongPassword) && !/\(ok\)/.test(wrongPassword), wrongPassword);
        const afterSave = await client.getByRole('button', { name: 'Keep the saved one' }).isVisible();
        record('tests', 'After saving a replaced password the field returns to Configured', !afterSave, { stillEditing: afterSave });
        await settleSecret(client);
        await client.getByRole('button', { name: 'Clear' }).click();
        await saveSection(page, 'client');
        const cleared = (await api(page, 'GET', 'JellyfinMod/Settings/DownloadClients')).body[0];
        const noPassword = await clientTest();
        record('tests', 'Client password Clear saved: not configured, and the Test is refused', cleared.passwordConfigured === false && !/\(ok\)/.test(noPassword),
            { passwordConfigured: cleared.passwordConfigured, test: noPassword });
        await setSecret(client, 'jfmodClientPassword', fixture.TX_PASSWORD);
        await saveSection(page, 'client');
        record('tests', 'Client password replaced: the Test passes again', /\(ok\)/.test(await clientTest()));
        await fill(client, 'Transmission RPC address', `http://${standin}:${port(4)}/transmission/rpc`);
        await saveSection(page, 'client');
        const unreachable = await clientTest();
        record('tests', 'Transmission Test against an unreachable host', !/\(ok\)/.test(unreachable) && /unreachable|connect/i.test(unreachable), unreachable);
        await fill(client, 'Transmission RPC address', `http://${standin}:${port(3)}/transmission/rpc`);
        await saveSection(page, 'client');
        const started = Date.now();
        const timeout = await clientTest();
        record('tests', 'Transmission Test against a host that never answers times out', /timeout/.test(timeout), { notice: timeout, seconds: Math.round((Date.now() - started) / 1000) });
        await fill(client, 'Transmission RPC address', tx);
        await saveSection(page, 'client');
        record('tests', 'Transmission restored: the Test passes', /\(ok\)/.test(await clientTest()));

        // Import path: a mapping into a library is refused; a mapping to another filesystem is saved unverified.
        const mappingNotice = '[data-section="client"] .jfmod-notice';
        await client.getByRole('button', { name: 'Add mapping' }).click();
        let row = client.locator('.jfmod-maprow').last();
        await fill(row, 'Transmission path', '/library');
        await fill(row, 'Local path', '/data/media/movies');
        await client.getByRole('button', { name: 'Save mappings' }).click();
        const inside = await waitNotice(page, 'client', /mapping_inside_library|inside a library/);
        record('tests', 'A mapping into a library folder is refused (mapping_inside_library)', /mapping_inside_library/.test(inside), inside);
        await fill(row, 'Transmission path', '/shm');
        await fill(row, 'Local path', '/dev/shm');
        await client.getByRole('button', { name: 'Save mappings' }).click();
        await waitNotice(page, 'client', /Mappings saved/);
        await page.waitForTimeout(1500);
        row = client.locator('.jfmod-maprow').last();
        const crossPill = await row.locator('.jfmod-state').innerText();
        await fill(client, 'A path as Transmission reports it', '/shm');
        const cross = await watchNotice(page, mappingNotice, () => client.getByRole('button', { name: 'Test import path' }).click(), /\([a-z_]+\)/);
        const crossCode = await probePath(page, '/shm');
        record('tests', 'Import path on another filesystem: the mapping is saved unverified (cross_filesystem) and imports cannot use it',
            /different filesystem/i.test(crossPill) && crossCode !== 'ok', { pill: crossPill, probeThroughIt: crossCode });
        record('tests', 'Import path on another filesystem: the page shows the probe result and keeps it', !!cross.result && cross.kept,
            { shown: cross.result ?? '(never shown)', final: cross.final || '(cleared)' });
        await row.getByRole('button', { name: 'Remove' }).click();
        await client.getByRole('button', { name: 'Save mappings' }).click();
        await waitNotice(page, 'client', /Mappings saved/);
        await busyCycle(page, page.locator('[data-test="client"]'));

        // Indexers: the synced one through a failing feed; a manual one with a wrong key, an unreachable host and a tarpit.
        await openSection(page, 'indexers');
        const indexers = section(page, 'indexers');
        const syncedRow = indexers.locator('.jfmod-brow', { hasText: 'JellyfinMod Standin Indexer' });
        control('/fault?service=torznab&mode=500');
        const failing = await testNotice(page, 'indexers', syncedRow.getByRole('button', { name: 'Test' }));
        control('/fault?service=torznab&mode=ok');
        await page.waitForTimeout(1500);
        const recovered = await testNotice(page, 'indexers', syncedRow.getByRole('button', { name: 'Test' }));
        record('tests', 'Synced indexer Test: a failing feed is reported, a healthy one passes', !/\(ok\)/.test(failing), { failing, recovered });
        await indexers.getByRole('button', { name: 'Add indexer' }).click();
        let dialog = page.locator('.jfmod-settingsDialog').last();
        await dialog.waitFor({ state: 'visible', timeout: 10000 });
        await fill(dialog, 'Name', 'JellyfinMod Invalid Indexer');
        await fill(dialog, 'Torznab address', `http://${standin}:${port(1)}/1/api`);
        await field(dialog, 'Priority (lower first)').fill('');
        await dialog.getByRole('button', { name: 'Save' }).click();
        await dialog.locator('.jfmod-notice').waitFor({ state: 'visible', timeout: 15000 });
        const invalid = (await dialog.locator('.jfmod-notice').innerText()).replace(/\s+/g, ' ');
        record('tests', 'A provoked validation error names its field (priority left empty)', /priority/i.test(invalid) && !/LineNumber/.test(invalid), invalid);
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        await dialog.waitFor({ state: 'hidden', timeout: 10000 });
        await indexers.getByRole('button', { name: 'Add indexer' }).click();
        dialog = page.locator('.jfmod-settingsDialog').last();
        await dialog.waitFor({ state: 'visible', timeout: 10000 });
        await fill(dialog, 'Name', 'JellyfinMod Probe Indexer');
        await fill(dialog, 'Torznab address', `http://${standin}:${port(1)}/1/api`);
        await fill(dialog, 'Categories', '2000, 5000');
        await page.locator('#jfmodIndexerKey').fill(wrong.key);
        await dialog.getByRole('button', { name: 'Save' }).click();
        const savedAsIs = await dialog.waitFor({ state: 'hidden', timeout: 15000 }).then(() => true, () => false);
        record('tests', 'Add an indexer with its defaults saves (automation switch untouched)', savedAsIs,
            savedAsIs ? undefined : { refused: await dialog.locator('.jfmod-notice').innerText().catch(() => '') });
        if (!savedAsIs) {
            // Workaround on the unfixed bundle: touching the switch twice gives the draft an explicit false.
            const automate = field(dialog, 'Let automation grab title-and-year matches from it');
            await automate.click();
            await automate.click();
            await saveDialog(page, dialog);
        }
        await page.waitForTimeout(1500);
        const probeRow = () => indexers.locator('.jfmod-brow', { hasText: 'JellyfinMod Probe Indexer' });
        const probeTest = () => testNotice(page, 'indexers', probeRow().getByRole('button', { name: 'Test' }));
        const badKey = await probeTest();
        record('tests', 'Manual indexer Test with a wrong API key', !/\(ok\)/.test(badKey) && /unauthori|credential|key/i.test(badKey), badKey);
        const editBase = async url => {
            await probeRow().getByRole('button', { name: 'Edit' }).click();
            dialog = page.locator('.jfmod-settingsDialog').last();
            await dialog.waitFor({ state: 'visible', timeout: 10000 });
            await fill(dialog, 'Torznab address', url);
            await saveDialog(page, dialog);
        };
        await editBase(`http://${standin}:${port(4)}/1/api`);
        const indexerUnreachable = await probeTest();
        record('tests', 'Manual indexer Test against an unreachable host', !/\(ok\)/.test(indexerUnreachable), indexerUnreachable);
        await editBase(`http://${standin}:${port(3)}/1/api`);
        const indexerStarted = Date.now();
        const indexerTimeout = await probeTest();
        record('tests', 'Manual indexer Test against a host that never answers', /timeout/.test(indexerTimeout),
            { notice: indexerTimeout, seconds: Math.round((Date.now() - indexerStarted) / 1000) });
        await probeRow().locator('[data-indexer-remove]').click();
        await page.locator('[data-jfmod-confirm="confirm"]').click();
        await waitNotice(page, 'indexers', /Removed/);
        record('tests', 'The probe indexer is removed', (await api(page, 'GET', 'JellyfinMod/Settings/Indexers')).body.every(indexer => !/Probe/.test(indexer.name)));

        // Prowlarr: wrong key, unreachable, timeout, then the right settings and a sync that keeps the indexer verified.
        const card = page.locator('[data-prowlarr="card"]');
        const prowlarrTest = async () => {
            await busyCycle(page, card.getByRole('button', { name: 'Test', exact: true }));
            return (await card.locator('.jfmod-notice').innerText()).replace(/\s+/g, ' ');
        };
        const prowlarrSave = async () => {
            await card.getByRole('button', { name: 'Save', exact: true }).click();
            await page.waitForFunction(() => /Saved/.test(document.querySelector('[data-prowlarr="card"] .jfmod-notice')?.textContent ?? ''), undefined, { timeout: 20000 });
            await page.waitForTimeout(1500);
        };
        await setSecret(card, 'jfmodProwlarrKey', wrong.key);
        await prowlarrSave();
        const prowlarrWrong = await prowlarrTest();
        record('tests', 'Prowlarr Test with a wrong API key', /unauthorized/.test(prowlarrWrong), prowlarrWrong);
        await setSecret(card, 'jfmodProwlarrKey', fixture.PROWLARR_KEY);
        await fill(card, 'Prowlarr address', `http://${standin}:${port(4)}`);
        await prowlarrSave();
        const prowlarrUnreachable = await prowlarrTest();
        record('tests', 'Prowlarr Test against an unreachable host', /unreachable/.test(prowlarrUnreachable), prowlarrUnreachable);
        await fill(card, 'Prowlarr address', `http://${standin}:${port(1)}`);
        await prowlarrSave();
        control('/fault?service=prowlarr&mode=slow');
        const prowlarrStarted = Date.now();
        const prowlarrTimeout = await prowlarrTest();
        control('/fault?service=prowlarr&mode=ok');
        record('tests', 'Prowlarr Test against a host that never answers times out', /timeout/.test(prowlarrTimeout),
            { notice: prowlarrTimeout, seconds: Math.round((Date.now() - prowlarrStarted) / 1000) });
        await page.waitForTimeout(1500);
        const prowlarrOk = await prowlarrTest();
        const sync = await watchNotice(page, '[data-prowlarr="card"] .jfmod-notice', () => page.locator('[data-prowlarr="sync"]').click(), /Synced|changed nothing/);
        const after = (await api(page, 'GET', 'JellyfinMod/Settings/Indexers')).body;
        record('tests', 'Prowlarr restored: Test passes, Sync keeps one verified synced indexer', /\(ok\)/.test(prowlarrOk) && after.length === 1 && after[0].verified,
            { test: prowlarrOk, sync: sync.result });

        // Leak check over every settings response the area reads.
        const paths = ['Settings/Overview', 'Settings/Discovery', 'Settings/SeedProtection', 'Settings/Retention', 'Settings/Acquisition', 'Settings/Indexers',
            'Settings/DownloadClients', 'Settings/QualityProfiles', 'Settings/Import', 'Settings/Automation', 'Settings/Interface', 'Settings/Prowlarr',
            'Setup/State', 'Health', 'Automation/Status', 'Queue', 'Entries'];
        const leaks = [];
        for (const path of paths) {
            const answer = await api(page, 'GET', 'JellyfinMod/' + path);
            if (carriesSecret(answer.text) || /sec_[0-9a-f]/.test(answer.text) || /apikey=/i.test(answer.text)) leaks.push(path);
        }
        record('tests', `No settings response carries a secret value, reference or apikey (${paths.length} routes)`, leaks.length === 0, { leaks });
        record('tests', 'No page errors', page.jfmodErrors.length === 0, page.jfmodErrors.slice(0, 3));
    } catch (error) {
        notVerified('tests', 'tests from the page', error);
        await page.screenshot({ path: `${process.env.JELLYFINMOD_S11_SHOTS ?? '.'}/s11-${tier}-tests-failure.png` }).catch(() => {});
        control('/fault?service=torznab&mode=ok');
        control('/fault?service=prowlarr&mode=ok');
    }
    saveResults('tests', browser.version());
    await context.close();
}

// ---- acquire: search TMDB through the stand-in, add, open the entry, search releases and grab ----
const entryByTmdb = async (page, tmdbId) => (await api(page, 'GET', 'JellyfinMod/Entries?limit=200')).body.items.find(entry => entry.tmdbId === tmdbId);

async function addTitle(page, title, tmdbId) {
    await page.evaluate(query => { location.hash = '#/search?query=' + encodeURIComponent(query); }, title);
    const add = page.locator(`[data-jfmod-add="movie:${tmdbId}"]`);
    await add.waitFor({ state: 'visible', timeout: 45000 });
    await add.click();
    return until(() => entryByTmdb(page, tmdbId), { timeout: 30000, label: 'the new entry' });
}

async function grabTitle(page, entry) {
    await page.evaluate(id => { location.hash = '#/details?entryId=' + encodeURIComponent(id); }, entry.id);
    const search = page.locator('button', { hasText: 'Search releases' }).first();
    await search.waitFor({ state: 'visible', timeout: 30000 });
    await search.click();
    await page.waitForSelector('.jfmod-releaseDialog', { timeout: 15000 });
    await page.waitForFunction(() => !/Searching/.test(document.querySelector('.jfmod-releaseStatus')?.textContent ?? 'Searching'), undefined, { timeout: 60000 });
    const rows = await page.locator('.jfmod-releaseDialog .jfmod-releaseRow').allInnerTexts();
    const row = page.locator('.jfmod-releaseDialog .jfmod-releaseRow:not([aria-disabled="true"])').first();
    await row.click();
    const status = await until(async () => {
        const text = await page.locator('.jfmod-releaseDialog').innerText().catch(() => '');
        return /Sent to the download client|accepted|Grabbed/i.test(text) ? text : null;
    }, { timeout: 60000, label: 'the grab to be accepted' });
    return { rows: rows.map(text => text.replace(/\s+/g, ' ').slice(0, 160)), status: status.replace(/\s+/g, ' ').slice(0, 200) };
}

async function acquire() {
    const { page, context } = await newPage(browser);
    await signIn(page);
    const title = process.env.JELLYFINMOD_S11_TITLE ?? 'JellyfinMod Standin Movie';
    const tmdbId = Number(process.env.JELLYFINMOD_S11_TMDB ?? 990001);
    try {
        const entry = await entryByTmdb(page, tmdbId) ?? await addTitle(page, title, tmdbId);
        record('acquire', `Search finds ${title} under Add from TMDB (stand-in) and + adds the entry`, !!entry && entry.state === 'none',
            { state: entry?.state, monitored: entry?.monitored });
        const grab = await grabTitle(page, entry);
        const torrents = control('/state').torrents;
        const release = control('/state').releases.find(item => item.tmdbid === tmdbId);
        const held = torrents.find(torrent => torrent.hashString === release.infoHash);
        record('acquire', 'The picker lists the stand-in release; one click grabs it after the hold; the stand-in Transmission holds the torrent',
            !!held && held.downloadDir === '/downloads' && held.labels.includes('jellyfinmod'), { ...grab, torrent: held && { name: held.name, labels: held.labels, percentDone: held.percentDone } });
        record('acquire', 'No page errors', page.jfmodErrors.length === 0, page.jfmodErrors.slice(0, 3));
    } catch (error) {
        notVerified('acquire', 'add and grab', error);
        await page.screenshot({ path: `${process.env.JELLYFINMOD_S11_SHOTS ?? '.'}/s11-${tier}-acquire-failure.png` }).catch(() => {});
    }
    saveResults('acquire', browser.version());
    await context.close();
}

// ---- import: the stand-in finishes the download with the real file; the plugin hardlinks it into the library ----
async function importStep() {
    const { page, context } = await newPage(browser);
    await signIn(page);
    const tmdbId = Number(process.env.JELLYFINMOD_S11_TMDB ?? 990001);
    try {
        const release = control('/state').releases.find(item => item.tmdbid === tmdbId);
        const done = control(`/complete?hash=${release.infoHash}`);
        record('import', 'The stand-in Transmission reports the torrent complete with the real file in the download folder', done.percentDone === 1, { status: done.status });
        const entry = await until(async () => {
            const current = await entryByTmdb(page, tmdbId);
            if (current?.state !== 'onDisk' || !current.jellyfinItemId) return null;
            // The import is finished only when it has recorded itself; binding by reconciliation can come first, and a
            // watch before the import completes is (rightly) not counted by retention.
            const detail = (await api(page, 'GET', `JellyfinMod/Entries/${current.id}`)).body;
            return (detail.history ?? []).some(event => (event.eventType ?? event.type ?? event.kind) === 'imported') ? current : null;
        }, { timeout: 300000, every: 5000, label: 'the import to complete' });
        record('import', 'The plugin imports the download and Jellyfin indexes it: the entry is on disk and bound', true,
            { state: entry.state, bound: !!entry.jellyfinItemId });
        const links = onHost(`cd ${JSON.stringify(process.env.JELLYFINMOD_S11_HOST_ROOT)}/data && stat -c '%h %i' "downloads/${release.title}.mkv" && find media/movies -name '*.mkv' -exec stat -c '%h %i %n' {} +`);
        const lines = links.split('\n');
        const download = lines[0].split(' ');
        const library = lines.filter(line => /media\/movies/.test(line)).map(line => line.split(' '));
        const same = library.find(parts => parts[1] === download[1]);
        record('import', 'Imported by hardlink: the library file and the download share one inode with link count 2',
            download[0] === '2' && !!same && same[0] === '2', { download: { links: download[0] }, library: same ? { links: same[0], path: same.slice(2).join(' ').replace(/^media\//, '') } : null });
        const history = (await api(page, 'GET', `JellyfinMod/Entries/${entry.id}`)).body;
        const events = (history.history ?? []).map(event => event.eventType ?? event.type ?? event.kind);
        record('import', 'Entry history records the grab, the media becoming available and the import', events.includes('grabbed') && events.includes('media_available') && events.includes('imported'),
            { events: (history.history ?? []).map(event => event.eventType ?? event.type ?? event.kind).slice(0, 8) });
    } catch (error) {
        notVerified('import', 'import by hardlink', error);
    }
    saveResults('import', browser.version());
    await context.close();
}

// ---- play: the imported file plays in the browser to the end, and Jellyfin records it as played ----
async function play() {
    const { page, context } = await newPage(browser);
    await signIn(page);
    const tmdbId = Number(process.env.JELLYFINMOD_S11_TMDB ?? 990001);
    try {
        const entry = await entryByTmdb(page, tmdbId);
        const itemId = entry.jellyfinItemId;
        await page.evaluate(id => { location.hash = '#/details?id=' + id; }, itemId);
        const playButton = page.locator('button.btnPlay:visible, button[data-action="resume"]:visible, button[data-action="play"]:visible').first();
        await playButton.waitFor({ state: 'visible', timeout: 30000 });
        await playButton.click();
        await page.waitForFunction(() => { const video = document.querySelector('video'); return video && video.currentTime > 2; }, undefined, { timeout: 60000 });
        const started = await page.evaluate(() => { const video = document.querySelector('video'); return { width: video.videoWidth, height: video.videoHeight, time: Math.round(video.currentTime) }; });
        record('play', 'The imported file plays in the browser', started.width > 0, started);
        const userId = await page.evaluate(() => ApiClient.getCurrentUserId());
        const played = await until(async () => (await api(page, 'GET', `Users/${userId}/Items/${itemId}`)).body?.UserData?.Played === true,
            { timeout: 120000, every: 3000, label: 'Jellyfin to record the item as played' });
        record('play', 'Playing to the end marks it played for the administrator', played === true);
    } catch (error) {
        notVerified('play', 'playback', error);
        await page.screenshot({ path: `${process.env.JELLYFINMOD_S11_SHOTS ?? '.'}/s11-${tier}-play-failure.png` }).catch(() => {});
    }
    saveResults('play', browser.version());
    await context.close();
}

// ---- retention: the T18 cycle with a minute-scale test window; every product setting saved through the area ----
async function retention() {
    const { page, context } = await newPage(browser);
    await signIn(page);
    const root = JSON.stringify(process.env.JELLYFINMOD_S11_HOST_ROOT);
    const folder = 'data/media/movies/JellyfinMod Standin Movie (2026) [tmdbid-990001]';
    try {
        await openSection(page, 'retention');
        const area = section(page, 'retention');
        await setSwitch(area, 'Delete media files after they are watched', true);
        await fill(area, 'Days to keep a file after it is finished', '1');
        await choose(page, area, 'Start the window when', 'Any user with library access has watched it');
        await saveSection(page, 'retention');
        const saved = (await api(page, 'GET', 'JellyfinMod/Settings/Retention')).body;
        record('retention', 'Retention turned on through the settings area: Any user, 1 day (test window 1 minute from the XML)',
            saved.enabled === true && saved.watchedUserMode === 'anyUser' && saved.reclaimAfterDays === 1, saved);
        const entry = await entryByTmdb(page, 990001);
        const before = onHost(`cd ${root} && ls "${folder}" && stat -c '%h' data/downloads/*Standin.Movie*.mkv`);
        const due = await until(async () => {
            const preview = (await api(page, 'GET', 'JellyfinMod/Retention/Preview')).body;
            const seedBlocked = (preview?.items ?? []).some(item => item.state === 'blocked' && /^seed/.test(item.reason ?? ''));
            return preview?.due >= 1 || seedBlocked ? preview : null;
        }, { timeout: 240000, every: 10000, label: 'the watched file to be due or held by seeding' });
        record('retention', 'After the window the watched file is due, or held only by its seeding copy, with no repair run', true,
            { inspected: due.inspected, due: due.due, blocked: due.blocked, items: (due.items ?? []).map(item => `${item.state}:${item.reason}`) });
        const tasks = (await api(page, 'GET', 'ScheduledTasks')).body;
        const task = tasks.find(item => item.Name === 'Reclaim expired JellyfinMod media');
        const runTask = async () => {
            const started = await api(page, 'POST', `ScheduledTasks/Running/${task.Id}`);
            await page.waitForTimeout(3000);
            await until(async () => (await api(page, 'GET', `ScheduledTasks/${task.Id}`)).body.State === 'Idle' && started.status === 204,
                { timeout: 180000, every: 3000, label: 'the reclaim task to finish' });
            await page.waitForTimeout(3000);
        };
        const release = control('/state').releases.find(item => item.tmdbid === 990001);
        // T18 item 5: the seeding copy is below its goal (ratio 0, just added), so the due file must stay.
        const held = control('/state').torrents.find(torrent => torrent.hashString === release.infoHash);
        if (process.env.JELLYFINMOD_S11_SEED_MET !== 'true') {
        await runTask();
        const blockedRun = (await api(page, 'GET', 'JellyfinMod/Retention/Runs/Latest')).body;
        const stillThere = onHost(`cd ${root} && ls "${folder}"`).split('\n').some(name => name.endsWith('.mkv'));
        const blockedPreview = (await api(page, 'GET', 'JellyfinMod/Retention/Preview')).body;
        record('retention', 'T18 item 5: with the seeding torrent below its goal the due file stays and the run counts it blocked',
            stillThere && blockedRun?.reclaimed === 0 && blockedRun?.blocked >= 1,
            { torrent: { uploadRatio: held?.uploadRatio, secondsSeeding: held?.secondsSeeding }, run: { status: blockedRun?.status, reclaimed: blockedRun?.reclaimed, blocked: blockedRun?.blocked },
                reasons: JSON.stringify(blockedPreview).match(/seed[a-z_]*/g)?.filter((value, index, all) => all.indexOf(value) === index) ?? [] });
        }
        control(`/seed?hash=${release.infoHash}&ratio=10&seconds=864000`);
        // The import monitor reads the client on its own poll; the goal counts as met once it has seen it.
        const nowDue = await until(async () => ((await api(page, 'GET', 'JellyfinMod/Retention/Preview')).body?.due ?? 0) >= 1,
            { timeout: 240000, every: 10000, label: 'the seed goal to be observed as met' });
        record('retention', 'Once the seeding copy meets its goal the file becomes due', nowDue === true);
        await runTask();
        const after = onHost(`cd ${root} && ls "${folder}"; stat -c '%h' data/downloads/*Standin.Movie*.mkv`);
        const run = (await api(page, 'GET', 'JellyfinMod/Retention/Runs/Latest')).body;
        const detail = (await api(page, 'GET', `JellyfinMod/Entries/${entry.id}`)).body;
        const events = (detail.history ?? []).map(event => event.eventType ?? event.type ?? event.kind);
        const files = after.split('\n');
        record('retention', 'Reclaimed: the media file is unlinked; the folder and every sidecar (.nfo, .srt, poster) stay (decision 5)',
            !files.some(name => name.endsWith('.mkv')) && files.includes('movie.nfo') && files.some(name => name.endsWith('.en.srt')) && files.includes('poster.jpg'),
            { before: before.split('\n'), after: files });
        record('retention', 'The seeding copy keeps its data (link count back to 1); the entry and its history stay, with one reclaimed event',
            files.at(-1) === '1' && !!(detail.entry?.id ?? detail.id) && events.filter(event => event === 'reclaimed').length === 1,
            { state: detail.entry?.state ?? detail.state, entryKept: !!(detail.entry?.id ?? detail.id), events: events.slice(0, 8) });
        record('retention', 'The run records its counts', run && run.status === 'completed' && run.reclaimed >= 1,
            { status: run?.status, inspected: run?.inspected, due: run?.due, reclaimed: run?.reclaimed, blocked: run?.blocked, failed: run?.failed, logicalBytes: run?.logicalBytes, physicalBytes: run?.physicalBytes });
        // Back to the real settings: off, 14 days, All users.
        await openSection(page, 'retention');
        await setSwitch(section(page, 'retention'), 'Delete media files after they are watched', false);
        await fill(section(page, 'retention'), 'Days to keep a file after it is finished', '14');
        await choose(page, section(page, 'retention'), 'Start the window when', 'All users with library access have watched it');
        await saveSection(page, 'retention');
        record('retention', 'Retention restored to off, 14 days, All users through the area', (await api(page, 'GET', 'JellyfinMod/Settings/Retention')).body.enabled === false);
    } catch (error) {
        notVerified('retention', 'T18 cycle', error);
        await page.screenshot({ path: `${process.env.JELLYFINMOD_S11_SHOTS ?? '.'}/s11-${tier}-retention-failure.png` }).catch(() => {});
    }
    saveResults('retention', browser.version());
    await context.close();
}

// ---- mobile: the settings area at 390 px ----
async function mobileSettings() {
    const { page, context } = await newPage(browser, 'mobile');
    await signIn(page);
    try {
        await page.evaluate(() => { location.hash = '#/catalog/settings'; });
        await page.locator('.jfmod-check').waitFor({ state: 'visible', timeout: 30000 });
        const seen = [];
        for (const id of ['discovery', 'client', 'indexers', 'profiles', 'grabbing', 'retention', 'automation', 'interface']) {
            await openSection(page, id);
            const width = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
            seen.push({ id, overflow: width, heading: await section(page, id).locator('h2').innerText() });
        }
        record('mobile', 'Settings area at 390 px: every section opens with no horizontal scroll', seen.every(item => item.overflow <= 1), seen);
        await openSection(page, 'client');
        await setSecret(section(page, 'client'), 'jfmodClientPassword', fixture.TX_PASSWORD);
        await saveSection(page, 'client');
        const test = await testNotice(page, 'client', page.locator('[data-test="client"]'));
        record('mobile', 'Mobile data entry: a secret replaced and saved, the client Test passes, the field returns to Configured',
            /\(ok\)/.test(test) && /Configured/.test(await section(page, 'client').locator('.jfmod-secret-state').first().innerText()), test);
        record('mobile', 'No page errors', page.jfmodErrors.length === 0, page.jfmodErrors.slice(0, 3));
    } catch (error) {
        notVerified('mobile', 'settings area at 390 px', error);
        await page.screenshot({ path: `${process.env.JELLYFINMOD_S11_SHOTS ?? '.'}/s11-${tier}-mobile-failure.png` }).catch(() => {});
    }
    saveResults('mobile', browser.version());
    await context.close();
}

// ---- automation: the Phase 6 live checklist, every setting saved through the settings area ----
const automationStatus = async page => (await api(page, 'GET', 'JellyfinMod/Automation/Status')).body;
const decisions = async page => (await api(page, 'GET', 'JellyfinMod/Automation/Decisions?limit=200')).body.items ?? [];
/** Run now from the Automation section; waits for a new completed run and returns it. */
async function runNow(page) {
    const before = (await automationStatus(page)).lastRun?.id ?? null;
    await openSection(page, 'automation');
    await section(page, 'automation').getByRole('button', { name: 'Run now' }).click();
    return until(async () => {
        const status = await automationStatus(page);
        return status.lastRun && status.lastRun.id !== before && !status.running && status.lastRun.status !== 'running' ? status.lastRun : null;
    }, { timeout: 300000, every: 4000, label: 'the automation run to finish' });
}
async function saveAutomation(page, values) {
    await openSection(page, 'automation');
    const area = section(page, 'automation');
    for (const [label, value] of Object.entries(values)) {
        if (typeof value === 'boolean') await setSwitch(area, label, value);
        else await fill(area, label, String(value));
    }
    await saveSection(page, 'automation');
}
const since = (list, runId) => list.filter(item => item.runId === runId);
const summary = list => list.map(item => `${(item.title ?? '').replace('JellyfinMod Standin ', '')}:${item.kind}:${item.reason}`);

async function automation() {
    const { page, context } = await newPage(browser);
    await signIn(page);
    const phase = process.env.JELLYFINMOD_S11_PHASE ?? 'a';
    try {
        if (phase === 'a') {
            const health = (await api(page, 'GET', 'JellyfinMod/Health')).body;
            const capabilities = health.Capabilities ?? health.capabilities ?? [];
            const off = (await api(page, 'GET', 'JellyfinMod/Settings/Automation')).body;
            if (process.env.JELLYFINMOD_S11_RERUN !== 'true') record('automation', '1: Health lists automation and versions; migrations applied; automation off', capabilities.includes('automation')
                && capabilities.includes('versions') && off.automationEnabled === false, { automationEnabled: off.automationEnabled });
            // Wanted titles: two with a release, six with none.
            for (const [title, id] of [['JellyfinMod Standin Seeder', 990003], ['JellyfinMod Standin Sequel', 990002],
                ...[4, 5, 6, 7, 8, 9].map(n => [`JellyfinMod Standin Extra ${n}`, 990000 + n])]) {
                if (!await entryByTmdb(page, id)) await addTitle(page, title, id);
            }
            record('automation', 'Eight wanted, monitored entries added from search', (await api(page, 'GET', 'JellyfinMod/Entries?limit=200')).body.items
                .filter(entry => entry.monitored && entry.state === 'none').length === 8);
            // 2: profile cutoff and upgrades, indexer limits, small budgets, automation on with a 1-hour interval.
            const profile0 = (await api(page, 'GET', 'JellyfinMod/Settings/QualityProfiles')).body[0];
            let dialog;
            if (!(profile0.cutoff === 'webdl-1080p' && profile0.upgradeAllowed && profile0.qualities.includes('webdl-720p'))) {
            await openSection(page, 'profiles');
            await section(page, 'profiles').getByRole('button', { name: 'Edit' }).first().click();
            dialog = page.locator('.jfmod-settingsDialog').last();
            await dialog.waitFor({ state: 'visible', timeout: 10000 });
            await choose(page, dialog, 'Add a quality', 'webdl-720p');
            await choose(page, dialog, 'Upgrade until', 'webdl-1080p');
            await setSwitch(dialog, 'Upgrade automatically until the cutoff', true);
            await saveDialog(page, dialog);
            }
            const profile = (await api(page, 'GET', 'JellyfinMod/Settings/QualityProfiles')).body[0];
            await openSection(page, 'indexers');
            await section(page, 'indexers').locator('.jfmod-brow', { hasText: 'JellyfinMod Standin Indexer' }).getByRole('button', { name: 'Edit' }).click();
            dialog = page.locator('.jfmod-settingsDialog').last();
            await dialog.waitFor({ state: 'visible', timeout: 10000 });
            await fill(dialog, 'Seconds between searches', '2');
            await fill(dialog, 'Searches per day', '60');
            await saveDialog(page, dialog);
            const indexer = (await api(page, 'GET', 'JellyfinMod/Settings/Indexers')).body[0];
            // The test host's disk is over 90 % full, so the default floor (10 %, at least 25 GB) is above its free space and
            // stops every grab (seen on the first attempt). 1 % keeps the 25 GB minimum.
            await saveAutomation(page, { 'Search and grab on a schedule': true, 'Run every (hours)': 1, 'Automatic grabs per day': 1,
                'Keep this much of the library disk free (%)': 1 });
            const settings = (await api(page, 'GET', 'JellyfinMod/Settings/Automation')).body;
            record('automation', '2: saved through the area — profile cutoff and upgrades, synced indexer limits, grab budget 1, automation on every hour',
                profile.cutoff === 'webdl-1080p' && profile.upgradeAllowed && indexer.minIntervalSeconds === 2 && indexer.dailyQueryBudget === 60
                && settings.automationEnabled && settings.automationIntervalHours === 1 && settings.dailyAutoGrabBudget === 1,
                { profile: { qualities: profile.qualities, cutoff: profile.cutoff, upgradeAllowed: profile.upgradeAllowed, upgradeMode: profile.upgradeMode },
                    indexer: { minIntervalSeconds: indexer.minIntervalSeconds, dailyQueryBudget: indexer.dailyQueryBudget },
                    automation: { enabled: settings.automationEnabled, interval: settings.automationIntervalHours, grabBudget: settings.dailyAutoGrabBudget } });
            // Search now on every wanted title: resets any back-off (the floor skip of a first attempt retries in 6 h).
            for (const entry of (await api(page, 'GET', 'JellyfinMod/Entries?limit=200')).body.items.filter(item => item.state === 'none')) {
                await api(page, 'PATCH', `JellyfinMod/Entries/${entry.id}`, { searchNow: true });
            }
            const feedBefore = control('/state').counters['torznab.movie'] ?? 0;
            const run1 = await runNow(page);
            const d1 = since(await decisions(page), run1.id);
            const feedAfter = control('/state').counters['torznab.movie'] ?? 0;
            const grabbed = d1.filter(item => item.reason === 'grabbed');
            record('automation', '3: run 1 — one wanted movie auto-grabbed, the grab budget stops the second, titles with no release searched empty',
                grabbed.length === 1 && d1.some(item => item.reason === 'budget_grabs') && d1.filter(item => item.reason === 'no_eligible_candidate').length === 6,
                { run: { status: run1.status, targetsConsidered: run1.targetsConsidered, searched: run1.searched, grabbed: run1.grabbed }, decisions: summary(d1),
                    feedQueries: feedAfter - feedBefore });
            const reportedQueries = Object.values(run1.queriesByIndexer ?? {}).reduce((sum, value) => sum + value, 0);
            record('automation', '3: the stand-in feed saw exactly the queries the run reports per indexer', feedAfter - feedBefore === reportedQueries,
                { feed: feedAfter - feedBefore, reportedQueries, titlesSearched: run1.searched });
        }
        if (phase === 'a' || phase === 'a2') {
            const lastRun = (await automationStatus(page)).lastRun;
            const grabbed = since(await decisions(page), lastRun.id).filter(item => item.reason === 'grabbed');
            const grabbedTitle = grabbed[0]?.title ?? '';
            const tmdbId = /Sequel/.test(grabbedTitle) ? 990002 : 990003;
            const release = control('/state').releases.find(item => item.tmdbid === tmdbId && /1080p/.test(item.title));
            await until(() => control('/state').torrents.some(torrent => torrent.hashString === release.infoHash),
                { timeout: 60000, every: 2000, label: 'the automatic grab to reach the client after its hold' });
            control(`/complete?hash=${release.infoHash}`);
            const imported = await until(async () => {
                const entry = await entryByTmdb(page, tmdbId);
                if (entry?.state !== 'onDisk') return null;
                const detail = (await api(page, 'GET', `JellyfinMod/Entries/${entry.id}`)).body;
                return (detail.history ?? []).some(event => (event.eventType ?? event.type) === 'imported') ? detail : null;
            }, { timeout: 300000, every: 5000, label: 'the automatic grab to be imported' });
            const events = (imported.history ?? []).map(event => event.eventType ?? event.type);
            record('automation', '3: the automatic grab is imported (history auto_grabbed, imported)', events.includes('auto_grabbed') && events.includes('imported'),
                { title: grabbedTitle, events: events.slice(0, 6) });
            const extras = [];
            for (const n of [4, 5, 6, 7, 8, 9]) {
                const entry = await entryByTmdb(page, 990000 + n);
                const answer = (await api(page, 'GET', `JellyfinMod/Automation/Targets?entryId=${entry.id}`)).body;
                extras.push(...(Array.isArray(answer) ? answer : answer.items ?? [answer]).filter(target => target.consecutiveEmpty >= 1));
            }
            const hours = extras.map(target => Math.round((new Date(target.nextSearchAt) - new Date(target.lastSearchedAt)) / 36e5));
            record('automation', '3: an empty search backs off 12 h', extras.length === 6 && hours.every(value => value === 12), { hours });
            const status = await automationStatus(page);
            const df = Number(onHost(`df -B1 --output=avail ${JSON.stringify(process.env.JELLYFINMOD_S11_HOST_ROOT)} | tail -1`));
            record('automation', '6: the free space automation reports matches df for the same filesystem (within 1 %)',
                Math.abs(status.budgets.freeBytes - df) / df < 0.01, { freeBytes: status.budgets.freeBytes, df, floorBytes: status.budgets.freeFloorBytes });
        }
        if (phase === 'b') {
            const banner = async () => {
                await page.evaluate(() => { location.hash = '#/catalog/queue'; });
                await page.waitForTimeout(3500);
                return (await page.locator('body').innerText()).match(/Automation[^\n]*paused[^\n]*|paused[^\n]*/i)?.[0] ?? '';
            };
            if (process.env.JELLYFINMOD_S11_FROM !== 'floor') {
            // After a container restart: no duplicate grab or import; the budget still stops the other title.
            const beforeTorrents = control('/state').torrents.length;
            const run2 = await runNow(page);
            const d2 = since(await decisions(page), run2.id);
            record('automation', '4: after a restart, run 2 grabs nothing twice; the budget still holds; backed-off titles are not searched',
                control('/state').torrents.length === beforeTorrents && d2.every(item => item.reason !== 'grabbed') && run2.searched <= 1,
                { run: { searched: run2.searched, grabbed: run2.grabbed, targetsConsidered: run2.targetsConsidered }, decisions: summary(d2), torrents: control('/state').torrents.length });
            // 5a: the breaker — five searches against a failing feed.
            await saveAutomation(page, { 'Automatic grabs per day': 5 });
            for (const n of [4, 5, 6, 7, 8]) {
                const entry = await entryByTmdb(page, 990000 + n);
                await api(page, 'PATCH', `JellyfinMod/Entries/${entry.id}`, { searchNow: true });
            }
            control('/fault?service=torznab&mode=500');
            const run3 = await runNow(page);
            control('/fault?service=torznab&mode=ok');
            const status3 = await automationStatus(page);
            const d3 = since(await decisions(page), run3.id);
            record('automation', '5: five failing searches open the indexer breaker; the status names it', !!status3.indexers[0]?.breakerOpenUntil,
                { breakerOpenUntil: status3.indexers[0]?.breakerOpenUntil, decisions: summary(d3), paused: status3.pausedReasons });
            record('automation', '5: the queue shows the breaker pause', /breaker/i.test(await banner()), { banner: await banner(), pausedReasons: status3.pausedReasons });
            }
            // 5b: the free-space floor above the free space.
            await saveAutomation(page, { 'Keep this much of the library disk free (%)': 90 });
            const run4 = await runNow(page);
            const status4 = await automationStatus(page);
            record('automation', '5: a free-space floor above the free space stops grabs', status4.pausedReasons.includes('free_space_floor')
                || since(await decisions(page), run4.id).some(item => item.reason === 'free_space_floor'),
                { paused: status4.pausedReasons, decisions: summary(since(await decisions(page), run4.id)), banner: await banner() });
            await saveAutomation(page, { 'Keep this much of the library disk free (%)': 1 });
            // 5c: the download client down.
            control('/fault?service=tx&mode=down');
            const run5 = await runNow(page);
            const status5 = await automationStatus(page);
            control('/fault?service=tx&mode=ok');
            record('automation', '5: the download client down stops grabs', status5.pausedReasons.includes('client_unreachable')
                || since(await decisions(page), run5.id).some(item => item.reason === 'client_unreachable'),
                { paused: status5.pausedReasons, run: run5.status, decisions: summary(since(await decisions(page), run5.id)) });
            // 5d: the master switch off: the run touches no indexer.
            await saveAutomation(page, { 'Search and grab on a schedule': false });
            const feed = control('/state').counters['torznab.movie'] ?? 0;
            const run6 = await runNow(page);
            record('automation', '5: automation off — the run is recorded as disabled and queries no indexer',
                (control('/state').counters['torznab.movie'] ?? 0) === feed && /disabled/.test(run6.status), { run: run6.status });
            record('automation', '5: the queue shows the automation-off banner', /off|disabled/i.test(await banner()), { banner: await banner() });
            // 9: security.
            const anonymous = await page.evaluate(async () => Promise.all(['Automation/Status', 'Settings/Automation', 'Automation/Decisions']
                .map(path => fetch('/JellyfinMod/' + path).then(response => response.status))));
            const extra = await entryByTmdb(page, 990009);
            const addVersion = await api(page, 'GET', `JellyfinMod/Releases?entryId=${extra.id}&intent=addVersion`);
            record('automation', '9: anonymous 401 on automation routes; intent=addVersion refused for a file-less target', anonymous.every(code => code === 401)
                && addVersion.status >= 400, { anonymous, addVersion: { status: addVersion.status, type: addVersion.body?.type ?? addVersion.body?.code } });
            // 10: the version rows on the imported title, with Get another quality for an administrator.
            const held = (await api(page, 'GET', 'JellyfinMod/Entries?limit=200')).body.items.find(entry => entry.state === 'onDisk');
            await page.evaluate(id => { location.hash = '#/details?id=' + id; }, held.jellyfinItemId);
            await page.locator('.jfmod-versions, [class*="jfmod-version"]').first().waitFor({ state: 'visible', timeout: 30000 });
            const rows = (await page.locator('.jfmod-versions, [class*="jfmod-version"]').first().innerText()).replace(/\s+/g, ' ');
            record('automation', '10: the version rows show resolution, codec, audio and size, with Get another quality for an administrator',
                /1080|1920/.test(rows) && /Get another quality/i.test(rows), rows.slice(0, 300));
            record('automation', 'No page errors', page.jfmodErrors.length === 0, page.jfmodErrors.slice(0, 3));
        }
    } catch (error) {
        notVerified('automation', `phase ${phase}`, error);
        await page.screenshot({ path: `${process.env.JELLYFINMOD_S11_SHOTS ?? '.'}/s11-${tier}-automation-${phase}-failure.png` }).catch(() => {});
    }
    saveResults('automation-' + phase, browser.version());
    await context.close();
}

// ---- queue: the page renders for an administrator with rows, and shows each automation pause ----
async function queueBanners() {
    const { page, context } = await newPage(browser);
    await signIn(page);
    const read = async () => {
        await page.evaluate(() => { location.hash = '#/catalog/queue'; });
        await page.locator('.jfmod-queue').waitFor({ state: 'visible', timeout: 30000 });
        await page.waitForTimeout(2500);
        return { rows: await page.locator('.jfmod-queueTableRow, .jfmod-queueRow').count(),
            notices: (await page.locator('.jfmod-queueBanner, .jfmod-queueNotice').allInnerTexts()).map(text => text.replace(/\s+/g, ' ')) };
    };
    try {
        const off = await read();
        record('queue', 'The queue renders for an administrator with rows and the row menu (was a crash); automation off shows its notice',
            off.rows >= 1 && off.notices.some(text => /Automation is off/.test(text)), off);
        await page.locator('.jfmod-queueMenu').first().click();
        await page.waitForTimeout(1200);
        const menu = await page.locator('.actionSheet .actionSheetMenuItem, [role="menu"] [role="menuitem"]').allInnerTexts();
        record('queue', 'The row menu opens its actions', menu.length > 0, menu.map(text => text.trim()).slice(0, 5));
        await page.keyboard.press('Escape');
        await saveAutomation(page, { 'Search and grab on a schedule': true, 'Keep this much of the library disk free (%)': 90 });
        const floor = await read();
        record('queue', 'A free-space floor above the free space shows the paused banner', floor.notices.some(text => /Automation paused/.test(text) && /space/i.test(text)), floor.notices);
        await saveAutomation(page, { 'Search and grab on a schedule': false, 'Keep this much of the library disk free (%)': 1 });
        record('queue', 'No page errors', page.jfmodErrors.length === 0, page.jfmodErrors.slice(0, 3));
    } catch (error) {
        notVerified('queue', 'queue banners', error);
    }
    saveResults('queue', browser.version());
    await context.close();
}

// ---- restart: a run after a container restart grabs nothing twice ----
async function afterRestart() {
    const { page, context } = await newPage(browser);
    await signIn(page);
    try {
        const phase = process.env.JELLYFINMOD_S11_PHASE ?? 'before';
        if (phase === 'before') {
            await saveAutomation(page, { 'Search and grab on a schedule': true });
            record('restart', 'Automation on before the restart', (await api(page, 'GET', 'JellyfinMod/Settings/Automation')).body.automationEnabled === true);
        } else {
            const torrents = control('/state').torrents.map(torrent => torrent.name);
            const run = await runNow(page);
            const made = since(await decisions(page), run.id);
            const after = control('/state').torrents.map(torrent => torrent.name);
            record('restart', '4: after a container restart the run grabs nothing it already grabbed and imports nothing twice',
                !made.some(item => item.reason === 'grabbed' && /Seeder/.test(item.title ?? '')) && after.filter(name => /Seeder/.test(name)).length === 1,
                { decisions: summary(made), torrentsBefore: torrents.length, torrentsAfter: after.length });
            await saveAutomation(page, { 'Search and grab on a schedule': false });
            record('restart', '11: automation switched off through the area at the end', (await api(page, 'GET', 'JellyfinMod/Settings/Automation')).body.automationEnabled === false);
        }
    } catch (error) {
        notVerified('restart', 'run after restart', error);
    }
    saveResults('restart', browser.version());
    await context.close();
}

// Import is its own settings section, off until an administrator turns it on; then the banner is gone.
async function importOn(page) {
        // Import is its own settings section, off until an administrator turns it on.
        await page.evaluate(() => { location.hash = '#/catalog/settings?section=import'; });
        const importing = section(page, 'import');
        await importing.waitFor({ state: 'visible', timeout: 30000 });
        await setSwitch(importing, 'Import completed downloads', true);
        await page.locator('[data-submit="import"]').click();
        await waitNotice(page, 'import', /Saved/);
        record('import-on', 'Import turned on from the settings area', (await api(page, 'GET', 'JellyfinMod/Settings/Import')).body.importEnabled === true);
        await page.evaluate(() => { location.hash = '#/home'; });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(5000);
        record('import-on', 'With setup complete the Home banner is gone', await page.locator('.jfmod-setupBanner').count() === 0);
}

async function importOnStep() {
    const { page, context } = await newPage(browser);
    await signIn(page);
    try {
        await importOn(page);
    } catch (error) {
        notVerified('import-on', 'import switch', error);
    }
    saveResults('import-on', browser.version());
    await context.close();
}

const steps = { libraries, dismiss, wizard, client, resume, 'import-on': importOnStep, tests, acquire, import: importStep, play, retention, mobile: mobileSettings, automation, queue: queueBanners, restart: afterRestart };
try {
    if (!steps[step]) throw new Error('unknown step ' + step);
    await steps[step]();
} finally {
    await browser.close();
}
