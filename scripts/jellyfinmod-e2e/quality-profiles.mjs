/* eslint-disable compat/compat, no-restricted-globals, sonarjs/cognitive-complexity, sonarjs/no-clear-text-protocols -- a Node acceptance runner, not shipped code */
/* global window, document, ApiClient, location, localStorage */
// Quality profiles (P4.FU9, the approved Quality Profiles redesign, 2026-10-15) in a real browser against a local environment
// running the plugin with the presets, signed in as oleksii with an empty password:
//
//   JELLYFINMOD_TEST_URL=http://127.0.0.1:<local port>/ JELLYFINMOD_BROWSER=chromium|chrome JELLYFINMOD_SHOTS=<dir> \
//   [JELLYFINMOD_QP_LAYOUTS=desktop,mobile,tv1080] [JELLYFINMOD_QP_ENTRY=<series entry id with a missing S01E03>] node quality-profiles.mjs
//
// Checks, on the settings area's Quality Profiles section:
//   1 the presets a fresh install gets: six rows, each with its one-line summary and the Preset chip, the 4K one the Default;
//     Add Preset Profiles hidden while no preset is missing, the footer line;
//   2 Add Preset Profiles appears once a preset profile is removed, adds only that one back (same id), then hides again;
//   3 the simple path: Add Profile starts from the 4K preset with its name, a rename and Save write the preset's record;
//   4 the simple controls: best quality, the fall-back switch and its floor, the size buttons write the order and the limit
//     the summary sentence says;
//   5 Advanced: a matrix tick changes the order and marks the profile Custom (no simple button pressed);
//   6 the live rules: no name, or a cutoff the profile does not allow, refuse Save with the rule shown;
// and in the release picker (a missing Peep Show episode, a Torznab server of the runner's own over real HTTP, answering
// 2160p, 1080p and 720p WEB-DL rows and a 2160p row too large for the 4K profile):
//   7 the picker searches with "Default (4K)", lists the 4K row first, then 1080p, then 720p, the oversized row rejected;
//     choosing the 1080p profile lists the 1080p row first.
// Fixtures: profiles named "JellyfinMod QP …" and the indexer "JellyfinMod QP Indexer", all removed at the end; the removed preset
// is added back by the run itself. Nothing is grabbed.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';

const testUrl = new URL(process.env.JELLYFINMOD_TEST_URL ?? (() => { throw new Error('JELLYFINMOD_TEST_URL is required'); })());
const LOCAL = ['alpha', 'bravo', 'charlie', 'delta', 'echo'];
if (!['127.0.0.1', 'localhost'].includes(testUrl.hostname) || !['8096', '9096', '10096', '11096', '12096'].includes(testUrl.port)) {
    throw new Error('Runs on a local environment only');
}
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
const shots = process.env.JELLYFINMOD_SHOTS ?? (() => { throw new Error('JELLYFINMOD_SHOTS is required'); })();
mkdirSync(shots, { recursive: true });
const base = new URL('/web/', testUrl).href;
const layouts = (process.env.JELLYFINMOD_QP_LAYOUTS ?? 'desktop,mobile').split(',');
const entryId = process.env.JELLYFINMOD_QP_ENTRY ?? 'c01abd2729544572a95cafed3744429b';
const LAYOUTS = {
    desktop: { viewport: { width: 1440, height: 900 } },
    mobile: {
        viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
    },
    // The TV layout is not a target of this administrator dialog; the run only shows it still works there.
    tv1080: { viewport: { width: 1920, height: 1080 } }
};
const PRESETS = ['4K', '2K', '1080p', '720p', 'Any Quality', 'SD'];
const SUMMARIES = {
    '4K': '4K first, then down to 720p · up to 20 GB per hour · no upgrades',
    '2K': '2K first, then down to 720p · up to 10 GB per hour · no upgrades',
    '1080p': '1080p first, then down to 720p · up to 6 GB per hour · no upgrades',
    '720p': '720p only · up to 1 GB per hour · no upgrades',
    'Any Quality': '4K first, then down to 480p · any size · no upgrades',
    SD: 'SD first, then down to 480p · up to 0.5 GB per hour · no upgrades'
};
const FOUR_K = ['remux-2160p', 'bluray-2160p', 'webdl-2160p', 'webrip-2160p', 'hdtv-2160p', 'bluray-1440p', 'webdl-1440p', 'webrip-1440p', 'remux-1080p',
    'bluray-1080p', 'webdl-1080p', 'webrip-1080p', 'hdtv-1080p', 'bluray-720p', 'webdl-720p', 'webrip-720p', 'hdtv-720p'];

const results = [];
const record = (layout, check, ok, detail) => {
    results.push({ layout, check, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'} [${tier}/${layout}] ${check}${detail === undefined ? '' : ' :: ' + JSON.stringify(detail).slice(0, 600)}`);
};

// ---- a Torznab server of the runner's own: real HTTP the plugin searches ----
const CAPS = `<?xml version="1.0" encoding="UTF-8"?>
<caps><server title="JellyfinMod QP"/><limits max="100" default="100"/>
<searching><search available="yes" supportedParams="q"/><tv-search available="yes" supportedParams="q,season,ep"/><movie-search available="yes" supportedParams="q"/></searching>
<categories><category id="2000" name="Movies"/><category id="5000" name="TV"/></categories></caps>`;
const GiB = 1_000_000_000;
const ROWS = [
    ['Peep.Show.S01E03.720p.WEB-DL.AAC2.0.H.264-QP', 0.4 * GiB, 300],
    ['Peep.Show.S01E03.2160p.WEB-DL.DDP5.1.H.265-QPHUGE', 15 * GiB, 500],
    ['Peep.Show.S01E03.1080p.WEB-DL.DDP5.1.H.264-QP', 1 * GiB, 120],
    ['Peep.Show.S01E03.2160p.WEB-DL.DDP5.1.H.265-QP', 2 * GiB, 10]
];
const feed = () => `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel>${ROWS.map(([title, size, seeders]) => `
<item><title>${title}</title><guid>qp-${title}</guid><link>${torznabBase}/dl/none.torrent</link><size>${size}</size><pubDate>Thu, 15 Oct 2026 10:00:00 +0000</pubDate>
<torznab:attr name="size" value="${size}"/><torznab:attr name="seeders" value="${seeders}"/><torznab:attr name="category" value="5000"/></item>`).join('')}
</channel></rss>`;
const torznab = { calls: 0 };
const server = createServer((request, response) => {
    torznab.calls += 1;
    const url = new URL(request.url, 'http://x');
    response.writeHead(200, { 'Content-Type': 'application/xml' });
    response.end(url.searchParams.get('t') === 'caps' ? CAPS : feed());
});
await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
const torznabBase = `http://${process.env.JELLYFINMOD_TORZNAB_HOST ?? 'host.docker.internal'}:${server.address().port}`;
const torznabUrl = `${torznabBase}/api`;

const browser = await chromium.launch(tier === 'chrome' ? { headless: true, channel: 'chrome' } : { headless: true });
console.log('browser', tier, browser.version());
const info = await (await fetch(new URL('/System/Info/Public', testUrl))).json();
if (!LOCAL.some(name => info.ServerName === `jellyfinmod-${name}`)) throw new Error(`ServerName ${info.ServerName} is not a JellyfinMod local environment`);

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
    await page.waitForTimeout(1000);
}

const api = (page, method, path, body) => page.evaluate(async ({ method: m, path: p, body: b }) => {
    try {
        const answer = await ApiClient.ajax({ type: m, url: ApiClient.getUrl('JellyfinMod/' + p), dataType: m === 'DELETE' ? undefined : 'json',
            contentType: 'application/json', data: b === undefined ? undefined : JSON.stringify(b) });
        return answer ?? {};
    } catch (error) {
        return { __error: error?.status ?? String(error) };
    }
}, { method, path, body });

const openSection = async page => {
    await page.evaluate(() => { location.hash = '#/catalog/settings?section=profiles'; });
    await page.locator('.jfmod-check-section[data-section="profiles"]').waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(800);
};
const rows = page => page.evaluate(() => [...document.querySelectorAll('.jfmod-check-section[data-section="profiles"] .jfmod-brow[data-profile]')].map(row => ({
    id: row.getAttribute('data-profile'), name: row.querySelector('strong')?.textContent.trim(), summary: row.querySelector('[data-qp="row-summary"]')?.textContent.trim(),
    isDefault: [...row.querySelectorAll('.jfmod-chip')].some(chip => chip.textContent.trim() === 'Default'),
    preset: !!row.querySelector('[data-qp="preset-chip"]'), icons: row.querySelectorAll('.jfmod-rowactions button').length
})));
const presetButton = page => page.locator('.jfmod-check-section[data-section="profiles"] [data-test="add-presets"]');
const dialog = page => page.locator('.jfmod-qp');
const dialogState = page => page.evaluate(() => {
    const root = document.querySelector('.jfmod-qp');
    const order = root.querySelector('[data-qp="order"]')?.textContent.replace(/^Order tried:\s*/, '').split(', ').map(item => item.replace(/^\d+\s+/, '')) ?? [];
    return {
        name: root.querySelector('[data-qp="name"]')?.value, preset: root.querySelector('input[name="jfmod-qp-preset"]:checked')?.getAttribute('data-qp-preset') ?? null,
        best: [...root.querySelectorAll('[data-qp^="best-"][aria-pressed="true"]')].map(node => node.getAttribute('data-qp')),
        size: [...root.querySelectorAll('[data-qp^="size-"][aria-pressed="true"]')].map(node => node.getAttribute('data-qp')),
        fallback: root.querySelector('[data-qp="fallback"]')?.checked, floor: root.querySelector('[data-qp="floor"]')?.value,
        summary: root.querySelector('[data-qp="summary"]')?.textContent.trim(), custom: root.querySelector('[data-qp="custom"]')?.textContent.trim(),
        problems: [...root.querySelectorAll('.jfmod-qp-problem')].map(node => node.textContent.trim()),
        saveDisabled: !!document.querySelector('[data-qp="save"]')?.disabled, order
    };
});
const shot = async (page, name, locator) => {
    const path = `${shots}/qp-${tier}-${name}.png`;
    await (locator ?? page).screenshot({ path }).catch(() => undefined);
    return path;
};
const profilesByName = async page => Object.fromEntries((await api(page, 'GET', 'Settings/QualityProfiles')).map(profile => [profile.name, profile]));
const removeFixtures = async page => {
    for (const profile of await api(page, 'GET', 'Settings/QualityProfiles')) {
        if (profile.name?.startsWith('JellyfinMod QP')) await api(page, 'DELETE', `Settings/QualityProfiles/${profile.id}`);
    }
    for (const indexer of await api(page, 'GET', 'Settings/Indexers')) {
        if (indexer.name?.startsWith('JellyfinMod QP')) await api(page, 'DELETE', `Settings/Indexers/${indexer.id}`);
    }
};

async function settingsChecks(page, layout) {
    await openSection(page);
    const listed = await rows(page);
    const byName = Object.fromEntries(listed.map(row => [row.name, row]));
    record(layout, '1 six preset profiles, each with its one-line summary and the Preset chip; 4K is the Default; Make Default, Edit and Remove icons',
        PRESETS.every(name => byName[name]?.summary === SUMMARIES[name] && byName[name].preset) && byName['4K'].isDefault
            && listed.filter(row => row.isDefault).length === 1 && byName['2K'].icons === 3 && byName['4K'].icons === 2, listed);
    record(layout, '1 Add Preset Profiles is hidden while every preset is a profile; the footer says how a title takes its profile',
        await presetButton(page).count() === 0 && /Title default/.test(await page.locator('.jfmod-qp-foot').textContent()), await presetButton(page).count());
    console.log('  shot', await shot(page, `${layout}-section`, page.locator('.jfmod-check-section[data-section="profiles"]')));

    // 2 a removed preset comes back through Add Preset Profiles, with its own id.
    const sd = (await profilesByName(page)).SD;
    await api(page, 'DELETE', `Settings/QualityProfiles/${sd.id}`);
    await page.evaluate(() => { location.hash = '#/home'; });
    await page.waitForTimeout(500);
    await openSection(page);
    const shown = await presetButton(page).isVisible().catch(() => false);
    record(layout, '2 Add Preset Profiles appears once a preset is missing', shown);
    if (shown) {
        await presetButton(page).click();
        await page.waitForFunction(() => /Added 1 preset profile\./.test(document.querySelector('.jfmod-check-section[data-section="profiles"] .jfmod-notice')?.textContent ?? ''),
            undefined, { timeout: 15000 }).catch(() => undefined);
        await page.waitForTimeout(800);
        const back = (await profilesByName(page)).SD;
        record(layout, '2 it adds only the missing preset back, with the same id, and hides again',
            back?.id === sd.id && await presetButton(page).count() === 0 && (await rows(page)).length === listed.length,
            { notice: await page.locator('.jfmod-check-section[data-section="profiles"] .jfmod-notice').textContent().catch(() => null) });
    }

    // 3 the simple path: Add Profile, keep the 4K preset, rename, Save.
    const name = `JellyfinMod QP ${layout} simple`;
    await page.getByRole('button', { name: 'Add Profile', exact: true }).click();
    await dialog(page).waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(400);
    const opened = await dialogState(page);
    record(layout, '3 Add Profile starts from the 4K preset: its name, 4K and Balanced pressed, fall back to 720p, the sentence',
        opened.preset === '4K' && opened.name === '4K' && opened.best.join() === 'best-2160p' && opened.size.join() === 'size-balanced' && opened.fallback && opened.floor === '720p'
            && opened.summary === '4K picks 4K (2160p) first, then down to 720p, files up to 20 GB per hour, and does not upgrade later.'
            && opened.order.join() === FOUR_K.join() && !opened.saveDisabled, opened);
    console.log('  shot', await shot(page, `${layout}-dialog-simple`, page.locator('.jfmod-qp .MuiDialog-paper')));
    await page.locator('[data-qp="name"]').fill(name);
    await page.locator('[data-qp="save"]').click();
    await dialog(page).waitFor({ state: 'detached', timeout: 15000 }).catch(() => undefined);
    const saved = (await profilesByName(page))[name];
    record(layout, '3 Save writes the 4K preset\'s record under the new name',
        !!saved && saved.qualities.join() === FOUR_K.join() && saved.maximumBytesPerHour === 20 * GiB && saved.minimumBytesPerHour === null
            && saved.cutoff === 'remux-2160p' && saved.upgradeAllowed === false && saved.upgradeMode === 'replace' && saved.minimumSeeders === 2 && saved.presetId === null, saved);

    // 4 the simple controls write the order and the size.
    const custom = `JellyfinMod QP ${layout} custom`;
    await page.getByRole('button', { name: 'Add Profile', exact: true }).click();
    await dialog(page).waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('[data-qp="name"]').fill(custom);
    await page.locator('[data-qp="best-1080p"]').click();
    let state = await dialogState(page);
    record(layout, '4 Best 1080p: 1080p by source, then 720p; Balanced is up to 6 GB per hour',
        state.order.join() === 'remux-1080p,bluray-1080p,webdl-1080p,webrip-1080p,hdtv-1080p,bluray-720p,webdl-720p,webrip-720p,hdtv-720p'
            && /1080p \(1080p\) first, then down to 720p, files up to 6 GB per hour/.test(state.summary) && state.preset === null, state);
    await page.locator('[data-qp="fallback"]').uncheck();
    state = await dialogState(page);
    record(layout, '4 Fall back off: 1080p only', state.order.join() === 'remux-1080p,bluray-1080p,webdl-1080p,webrip-1080p,hdtv-1080p' && /picks only 1080p/.test(state.summary), state);
    await page.locator('[data-qp="fallback"]').check();
    await page.locator('[data-qp="floor"]').selectOption('480p');
    await page.locator('[data-qp="size-small"]').click();
    state = await dialogState(page);
    record(layout, '4 Down to 480p and Small: the order ends with DVD 480p, the limit is 2 GB per hour',
        state.order.at(-1) === 'dvd-480p' && state.order.includes('dvd-576p') && /down to 480p, files up to 2 GB per hour/.test(state.summary), state);
    await page.locator('[data-qp="size-large"]').click();
    state = await dialogState(page);
    record(layout, '4 Large: any file size', /any file size/.test(state.summary) && state.size.join() === 'size-large', state.summary);

    // 5 Advanced: untick a matrix cell, the profile is Custom.
    await page.locator('[data-qp="advanced"] > summary').click();
    await page.waitForTimeout(300);
    await page.locator('[data-qp-quality="hdtv-1080p"]').uncheck();
    state = await dialogState(page);
    record(layout, '5 Unticking HDTV 1080p takes it out of the order and makes the profile Custom (no simple button pressed), with no rule broken',
        !state.order.includes('hdtv-1080p') && state.custom === 'custom values' && !state.best.length && !state.size.length && !state.problems.length, state);
    console.log('  shot', await shot(page, `${layout}-dialog-advanced`, page.locator('.jfmod-qp .MuiDialog-paper')));

    // 6 the live rules refuse Save.
    await page.locator('.jfmod-qp [data-row-action="remove"][data-quality="remux-1080p"]').click();
    state = await dialogState(page);
    record(layout, '6 Removing the cutoff quality shows the cutoff rule and refuses Save',
        state.saveDisabled && state.problems.some(text => /cutoff must be one of the profile's allowed qualities/.test(text)), state.problems);
    await page.locator('[data-qp="best-1080p"]').click();
    await page.locator('[data-qp="name"]').fill('');
    state = await dialogState(page);
    record(layout, '6 A simple choice repairs it; an empty name refuses Save', state.saveDisabled && state.problems.join() === 'Give the profile a name.', state.problems);
    await page.locator('[data-qp="name"]').fill(custom);
    state = await dialogState(page);
    record(layout, '6 With a name again, Save is offered', !state.saveDisabled && !state.problems.length, state);
    await page.locator('[data-qp="save"]').click();
    await dialog(page).waitFor({ state: 'detached', timeout: 15000 }).catch(() => undefined);
    const second = (await profilesByName(page))[custom];
    record(layout, '6 the saved record is what the dialog showed (1080p down to 480p, Large, cutoff the first quality)',
        !!second && second.qualities[0] === 'remux-1080p' && second.qualities.at(-1) === 'dvd-480p' && second.maximumBytesPerHour === null
            && second.cutoff === 'remux-1080p', second);
    await openSection(page);
    const customRow = (await rows(page)).find(row => row.name === custom);
    record(layout, '6 its row says what it does', customRow?.summary === '1080p first, then down to 480p · any size · no upgrades' && !customRow.preset, customRow);
}

async function pickerChecks(page, layout) {
    const detail = await api(page, 'GET', `Entries/${entryId}`);
    const episode = detail.episodes?.find(item => item.seasonNumber === 1 && item.episodeNumber === 3);
    if (!episode || episode.jellyfinItemId) {
        record(layout, '7 the picker (needs a missing S01E03)', false, 'no missing S01E03 on the entry');
        return;
    }
    const indexer = await api(page, 'POST', 'Settings/Indexers', {
        name: 'JellyfinMod QP Indexer', baseUrl: torznabUrl, enabled: true, categories: [5000], priority: 1, minIntervalSeconds: 0,
        apiKey: { action: 'replace', value: 'qp-' + Date.now().toString(16) }
    });
    const tested = await api(page, 'POST', `Settings/Indexers/${indexer.id}/Test`);
    record(layout, '7 the runner\'s Torznab indexer is created and verified over HTTP', tested.ok === true, tested);
    const search = await api(page, 'GET', `Releases?entryId=${entryId}&episodeId=${episode.id}`);
    const eligible = (search.candidates ?? []).filter(candidate => candidate.eligible).map(candidate => candidate.rawTitle);
    record(layout, '7 the server ranks the episode\'s releases 4K, 1080p, 720p under the default 4K profile; the oversized 4K is rejected for its size',
        search.profile?.name === '4K' && eligible.join() === [ROWS[3][0], ROWS[2][0], ROWS[0][0]].join()
            && search.candidates.find(candidate => candidate.rawTitle === ROWS[1][0])?.rejections.some(rejection => rejection.code === 'size_above_maximum'),
        (search.candidates ?? []).map(candidate => [candidate.rawTitle, candidate.score, candidate.rejections.map(rejection => rejection.code)]));
    await page.evaluate(([id]) => { location.hash = `#/details?entryId=${id}&season=1&episode=3`; }, [entryId]);
    const opener = page.locator('.page:not(.hide) .mainDetailButtons .jfmod-getRelease').first();
    await opener.waitFor({ state: 'visible', timeout: 30000 });
    await opener.click();
    await page.waitForSelector('.jfmod-releaseDialog .jfmod-releaseList .jfmod-releaseItem', { timeout: 30000 });
    await page.waitForTimeout(1200);
    const listed = () => page.evaluate(() => ({
        rows: [...document.querySelectorAll('.jfmod-releaseDialog .jfmod-releaseItem')].map(item => item.textContent),
        profile: document.querySelector('#jfmod-releaseProfile')?.selectedOptions?.[0]?.textContent ?? null,
        rejected: /(\d+) Rejected/.exec(document.querySelector('.jfmod-releaseDialog')?.textContent ?? '')?.[1] ?? null,
        options: [...(document.querySelector('#jfmod-releaseProfile')?.options ?? [])].map(option => option.textContent)
    }));
    const first = await listed();
    const at = (list, token) => list.rows.findIndex(text => text.includes(token));
    record(layout, '7 the picker searches with "Default (4K)" and lists 4K, then 1080p, then 720p; the oversized 4K is in the collapsed Rejected group',
        first.profile === 'Default (4K)' && at(first, 'H.265-QP') === 0 && at(first, '1080p.WEB-DL') === 1 && at(first, '720p.WEB-DL') === 2
            && first.rows.length === 3 && first.rejected === '1', first);
    console.log('  shot', await shot(page, `${layout}-picker`, page.locator('.jfmod-releaseDialog')));
    await page.locator('#jfmod-releaseProfile').selectOption({ label: '1080p' });
    await page.waitForFunction(() => document.querySelector('.jfmod-releaseDialog .jfmod-releaseItem')?.textContent.includes('1080p.WEB-DL'), undefined, { timeout: 30000 })
        .catch(() => undefined);
    const second = await listed();
    record(layout, '7 with the 1080p profile chosen, the 1080p row is first and both 4K rows are rejected', at(second, '1080p.WEB-DL') === 0 && second.rows.length === 2 && second.rejected === '2', second);
    await page.keyboard.press('Escape');
    await api(page, 'DELETE', `Settings/Indexers/${indexer.id}`);
}

for (const layout of layouts) {
    const context = await browser.newContext(LAYOUTS[layout]);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    try {
        await signIn(page);
        if (layout.startsWith('tv')) {
            await page.evaluate(() => { localStorage.setItem('layout', 'tv'); location.reload(); });
            await page.waitForFunction(() => !!window.ApiClient && document.documentElement.classList.contains('layout-tv'), undefined, { timeout: 30000 })
                .catch(() => undefined);
            await page.waitForTimeout(1500);
            record(layout, 'the TV layout is on', await page.evaluate(() => document.documentElement.classList.contains('layout-tv')));
        }
        await removeFixtures(page);
        await settingsChecks(page, layout);
        if (layout === 'desktop') await pickerChecks(page, layout);
        record(layout, 'no page errors', errors.length === 0, errors.slice(0, 3));
    } catch (error) {
        record(layout, 'the run finished', false, String(error?.message ?? error).split('\n')[0]);
        await page.screenshot({ path: `${shots}/qp-${tier}-${layout}-error.png` }).catch(() => undefined);
    } finally {
        await removeFixtures(page).catch(() => undefined);
        const left = await profilesByName(page).catch(() => ({}));
        record(layout, 'cleanup: no fixture profile is left, and the six presets are profiles again',
            !Object.keys(left).some(name => name.startsWith('JellyfinMod QP')) && PRESETS.every(name => left[name]), Object.keys(left));
        if (layout.startsWith('tv')) await page.evaluate(() => localStorage.removeItem('layout')).catch(() => undefined);
        await context.close();
    }
}
await browser.close();
server.close();
const failed = results.filter(result => !result.ok);
console.log(`${results.length - failed.length}/${results.length} passed${failed.length ? '; FAILED: ' + failed.map(result => `[${result.layout}] ${result.check}`).join(' | ') : ''}`);
process.exitCode = failed.length ? 1 : 0;
/* eslint-enable compat/compat, no-restricted-globals, sonarjs/cognitive-complexity, sonarjs/no-clear-text-protocols */
