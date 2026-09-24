/* eslint-disable compat/compat, no-restricted-globals, sonarjs/cognitive-complexity -- a Node acceptance runner, not shipped code */
/* global document, location, window, ApiClient */
// P7.S11 step 1 on a fresh disposable JellyfinMod image container: the setup wizard end to end with its provoked
// refusals, resume and Dismiss; the secret actions and connection Tests from the page; add, grab, import and play
// through stand-ins; retention and automation with settings saved only through the settings area.
//
//   JELLYFINMOD_S11_STEP=libraries|dismiss|wizard|resume|tv-wizard|tests|acquire|import|play|... node s11-fresh.mjs
// Environment as in s11-lib.mjs. Every fixture title carries the JellyfinMod prefix.
import {
    api, carriesSecret, control, fixture, launch, newPage, notVerified, onHost, record, saveResults, setTvLayout, signIn, standin, tier, until, wrong
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
        await fill(client, 'Transmission RPC address', `http://${standin}:38112/transmission/rpc`);
        await fill(client, 'Username', fixture.TX_USER);
        await fill(client, 'Label added to every grab', 'jellyfinmod');
        await fill(client, 'Download folder as Transmission sees it', '/downloads');
        await fill(client, 'The same folder as this server sees it', '/data/media/movies');
        await setSecret(client, 'jfmodClientPassword', fixture.TX_PASSWORD);
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
        record('wizard', 'The download folder on the library filesystem is accepted', /Saved/.test(saved), saved);
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
        await fill(card, 'Prowlarr address', `http://${standin}:38111`);
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
    await waitNotice(page, id, /Saved/);
    await page.waitForTimeout(1500);
};

async function tests() {
    const { page, context } = await newPage(browser);
    await signIn(page);
    const tx = `http://${standin}:38112/transmission/rpc`;
    try {
        // Download client.
        await openSection(page, 'client');
        const client = section(page, 'client');
        const clientTest = () => testNotice(page, 'client', page.locator('[data-test="client"]'));
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
        await fill(client, 'Transmission RPC address', `http://${standin}:38114/transmission/rpc`);
        await saveSection(page, 'client');
        const unreachable = await clientTest();
        record('tests', 'Transmission Test against an unreachable host', !/\(ok\)/.test(unreachable) && /unreachable|connect/i.test(unreachable), unreachable);
        await fill(client, 'Transmission RPC address', `http://${standin}:38113/transmission/rpc`);
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
        await fill(dialog, 'Name', 'JellyfinMod Probe Indexer');
        await fill(dialog, 'Torznab address', `http://${standin}:38111/1/api`);
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
        await editBase(`http://${standin}:38114/1/api`);
        const indexerUnreachable = await probeTest();
        record('tests', 'Manual indexer Test against an unreachable host', !/\(ok\)/.test(indexerUnreachable), indexerUnreachable);
        await editBase(`http://${standin}:38113/1/api`);
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
        await fill(card, 'Prowlarr address', `http://${standin}:38114`);
        await prowlarrSave();
        const prowlarrUnreachable = await prowlarrTest();
        record('tests', 'Prowlarr Test against an unreachable host', /unreachable/.test(prowlarrUnreachable), prowlarrUnreachable);
        await fill(card, 'Prowlarr address', `http://${standin}:38111`);
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
            return current?.state === 'onDisk' && current.jellyfinItemId ? current : null;
        }, { timeout: 300000, every: 5000, label: 'the entry to be on disk and bound' });
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
        record('import', 'Entry history records the grab and the media becoming available', events.includes('grabbed') && events.includes('media_available'),
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
            return preview?.due >= 1 ? preview : null;
        }, { timeout: 240000, every: 10000, label: 'the watched file to be due' });
        record('retention', 'The watched file is due after the window with no repair run', true, { inspected: due.inspected, due: due.due, blocked: due.blocked });
        const tasks = (await api(page, 'GET', 'ScheduledTasks')).body;
        const task = tasks.find(item => item.Name === 'Reclaim expired JellyfinMod media');
        const started = await api(page, 'POST', `ScheduledTasks/Running/${task.Id}`);
        await until(async () => (await api(page, 'GET', `ScheduledTasks/${task.Id}`)).body.State === 'Idle' && started.status === 204,
            { timeout: 180000, every: 3000, label: 'the reclaim task to finish' });
        await page.waitForTimeout(3000);
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

const steps = { libraries, dismiss, wizard, client, resume, 'import-on': importOnStep, tests, acquire, import: importStep, play, retention };
try {
    if (!steps[step]) throw new Error('unknown step ' + step);
    await steps[step]();
} finally {
    await browser.close();
}
