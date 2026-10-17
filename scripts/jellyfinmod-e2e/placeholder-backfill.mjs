/* eslint-disable compat/compat, no-restricted-globals, @stylistic/max-statements-per-line, no-empty-function, sonarjs/cognitive-complexity -- a Node acceptance runner, not shipped code */
/* global window, document, ApiClient, localStorage, location */
// The backfill's web side (P1.FU27; plan docs/jellyfinmod/design/missing-media-user-actions.md §16), against a local environment
// or a mod instance whose catalogue has placeholders, signed in as oleksii (and JELLYFINMOD_BF_USER, an ordinary user) with an
// empty password. Per layout (JELLYFINMOD_LAYOUTS, default desktop,mobile,tv1080):
//
//   - A placeholder episode's own Jellyfin page (JELLYFINMOD_BF_SERIES, a series with one file and placeholders for the rest of
//     season 1) shows the download block where a file's page has its track selectors, from the queue: Not Downloaded (an
//     administrator's Get a Release), Downloading with its figure and release, a season pack's line and dots, Importing, Failed
//     (an administrator's Search Again); Cancel Download for administrators only; no Play. A placeholder movie's page
//     (JELLYFINMOD_BF_MOVIE) the same for the movie. INTERCEPTED QUEUE ANSWERS: the browser's GET /JellyfinMod/Queue is answered
//     by this runner, as the card-progress runner does; everything else is the real plugin and Jellyfin.
//   - The ring maps through the placeholder: the season page's row of the placeholder shows the pack's download, the movie's grid
//     card the movie's.
//   - No duplicates: on the season page every episode the plugin lists has exactly one row (Jellyfin's placeholder or file row,
//     else the mod's row for an episode with no placeholder), the series page one card per season, and the season card's
//     "N episodes" line matches the season page; search finds the placeholder title once.
//   - The read-only fallback (JELLYFINMOD_BF_READONLY, a series in a read-only folder): its missing episodes keep the mod's rows.
//   - Settings, Missing Episodes (desktop, administrator): the progress line and Sync Now.
//   With JELLYFINMOD_BF_SWAP_SERIES (a series whose missing season-1 episode has no placeholder yet, desktop, administrator): the
//   season page shows the mod's row; Sync Now writes the placeholder, and within a few minutes, with no reload, Jellyfin's own
//   row replaces the mod's (one row for the episode throughout). It writes placeholders (what the backfill would do anyway).
//
//   JELLYFINMOD_TEST_URL=http://127.0.0.1:<port>/  JELLYFINMOD_BF_SERIES='<name>'  JELLYFINMOD_BF_MOVIE='<name>'
//   [JELLYFINMOD_BF_READONLY='Peep Show'] [JELLYFINMOD_BF_SWAP_SERIES='<name>'] [JELLYFINMOD_BF_USER=nata]
//   [JELLYFINMOD_BROWSER=chromium|chrome] [JELLYFINMOD_LAYOUTS=desktop,mobile,tv1080] [JELLYFINMOD_SHOTS=<folder>] [JELLYFINMOD_WEB_PATH=/web/]
import { chromium } from 'playwright';

const origin = new URL(process.env.JELLYFINMOD_TEST_URL ?? (() => { throw new Error('JELLYFINMOD_TEST_URL is required'); })());
const loopback = ['127.0.0.1', 'localhost'].includes(origin.hostname);
if (!loopback && !['18096', '28096', '48096'].includes(origin.port)) throw new Error('Runs on the mod instances or a local environment only');
const required = name => process.env[name] ?? (() => { throw new Error(`${name} is required`); })();
const seriesName = required('JELLYFINMOD_BF_SERIES');
const movieName = required('JELLYFINMOD_BF_MOVIE');
const readOnlyName = process.env.JELLYFINMOD_BF_READONLY ?? null;
const swapName = process.env.JELLYFINMOD_BF_SWAP_SERIES ?? null;
const ordinaryUser = process.env.JELLYFINMOD_BF_USER ?? null;
const SHOTS = process.env.JELLYFINMOD_SHOTS ?? '.';
const WEB_PATH = process.env.JELLYFINMOD_WEB_PATH ?? '/web/';
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
const layouts = (process.env.JELLYFINMOD_LAYOUTS ?? 'desktop,mobile,tv1080').split(',').filter(Boolean);
const LAYOUTS = {
    desktop: { viewport: { width: 1440, height: 900 } },
    mobile: {
        viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
    },
    tv1080: { viewport: { width: 1920, height: 1080 }, tv: true }
};
const PAGE = '.page:not(.hide)';

const results = [];
const record = (label, check, pass, detail) => {
    const verdict = pass ? 'PASS' : 'FAIL';
    results.push({ label, check, verdict, detail });
    console.log(`${verdict} [${label}] ${check}${detail === undefined ? '' : ' · ' + JSON.stringify(detail).slice(0, 500)}`);
};
const norm = id => (id ?? '').replace(/-/g, '').toLowerCase();
const clientFor = user => `MediaBrowser Client="JellyfinMod FU27 runner", Device="node", DeviceId="jfmod-fu27-runner-${user}", Version="1.0"`;

async function signInApi(user) {
    const CLIENT = clientFor(user);
    const response = await fetch(new URL('/Users/AuthenticateByName', origin), {
        method: 'POST', headers: { Authorization: CLIENT, 'Content-Type': 'application/json' }, body: JSON.stringify({ Username: user, Pw: '' })
    });
    if (!response.ok) throw new Error(`Sign-in as ${user} failed (${response.status})`);
    const body = await response.json();
    const auth = `${CLIENT}, Token="${body.AccessToken}"`;
    const call = async (method, path, data) => {
        const answer = await fetch(new URL(path, origin), {
            method, headers: { Authorization: auth, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
            body: data === undefined ? undefined : JSON.stringify(data)
        });
        const type = answer.headers.get('content-type') ?? '';
        const json = type.includes('json') ? await answer.json().catch(() => null) : null;
        if (!json) await answer.body?.cancel().catch(() => {});
        return { status: answer.status, json };
    };
    return { userId: body.User.Id, call };
}

const items = async (call, userId, query) => (await call('GET', `/Items?userId=${userId}&recursive=true&fields=Path,ChildCount&${query}`)).json?.Items ?? [];

/** The fixtures, read through the API as a native app: the series, its season 1 and episodes, the movie, the plugin's entries. */
async function fixtures(api) {
    const { call, userId } = api;
    const series = (await items(call, userId, `includeItemTypes=Series&searchTerm=${encodeURIComponent(seriesName)}`))
        .find(item => item.Name === seriesName);
    if (!series) throw new Error(`No series ${seriesName}`);
    const seasons = (await call('GET', `/Shows/${series.Id}/Seasons?userId=${userId}&fields=ChildCount`)).json?.Items ?? [];
    const season = seasons.find(item => item.IndexNumber === 1);
    const episodes = (await call('GET', `/Shows/${series.Id}/Episodes?userId=${userId}&seasonId=${season.Id}&fields=Path`)).json?.Items ?? [];
    const stub = episodes.find(item => item.IsPlaceHolder);
    const entryId = (await call('GET', `/JellyfinMod/Entries?jellyfinItemId=${series.Id}&limit=1`)).json?.items?.[0]?.id;
    const detail = (await call('GET', `/JellyfinMod/Entries/${entryId}`)).json;
    const movie = (await items(call, userId, `includeItemTypes=Movie&searchTerm=${encodeURIComponent(movieName)}`))
        .find(item => item.Name === movieName && item.IsPlaceHolder);
    const movieEntry = movie && (await call('GET', `/JellyfinMod/Entries?jellyfinItemId=${movie.Id}&limit=1`)).json?.items?.[0];
    if (!stub || !detail || !movie || !movieEntry) throw new Error('Fixtures missing: ' + JSON.stringify({ stub: !!stub, detail: !!detail, movie: !!movie, movieEntry: !!movieEntry }));
    return { series, seasons, season, episodes, stub, detail, movie, movieEntry };
}

async function signedIn(page) {
    return page.evaluate(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } });
}

async function signIn(page, user) {
    await page.goto(new URL(WEB_PATH, origin).href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.ApiClient, undefined, { timeout: 30000 });
    await page.waitForFunction(() => {
        try { return !!ApiClient.getCurrentUserId() || /login|selectuser|selectserver/.test(location.hash); } catch { return false; }
    }, undefined, { timeout: 30000 });
    if (await signedIn(page)) return;
    const field = page.locator('#txtManualName');
    if (!await field.isVisible().catch(() => false)) {
        const chooser = page.locator('.btnManual').first();
        await chooser.waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
        if (await chooser.count()) await chooser.evaluate(node => node.click());
        await field.waitFor({ state: 'visible', timeout: 15000 });
    }
    await page.waitForTimeout(1000);
    await field.fill(user);
    await page.locator('#txtManualPassword').fill('');
    await page.locator('button:visible').filter({ hasText: 'Sign In' }).first().click();
    await page.waitForFunction(() => location.hash.startsWith('#/home'), undefined, { timeout: 30000 });
}

const go = async (page, hash) => {
    await page.evaluate(target => { location.hash = target; }, hash);
    await page.waitForTimeout(500);
};

// ---------------------------------------------------------------- queue answers

const now = () => new Date().toISOString();
let serial = 0;
const uuid = (group = 8000) => `00000000-0000-4000-${group}-${String(++serial).padStart(12, '0')}`;
const entryRef = entry => ({ id: entry.id, mediaType: entry.mediaType, title: entry.title, year: entry.year ?? null, posterPath: null,
    jellyfinItemId: entry.jellyfinItemId ?? null, targetLibraryId: null });
const PARSED = { resolution: '1080p', source: 'WEB-DL', codec: 'h264', audio: 'AAC', languages: ['English'] };
const queueRow = (entry, { episode = null, pack = null, state, progress = null, message = null }) => ({
    id: uuid(), grabId: uuid(9000), entry: entryRef(entry), episode, releaseTitle: 'JellyfinMod.FU27.Fixture.1080p.WEB-DL', state,
    importState: state, reason: message ? 'fixture' : null, message, progress, sizeBytes: 2_400_000_000, downloadedBytes: null,
    downloadRateBytes: state === 'downloading' ? 3_100_000 : null, etaSeconds: state === 'downloading' ? 720 : null, stalledSince: null,
    observedAt: now(), versionLabel: null, intent: 'acquire', createdAt: now(), updatedAt: now(), client: null, seeding: null, pack,
    parsed: PARSED, indexerName: 'Fixture Indexer'
});
const episodeRef = episode => ({ id: episode.id, seasonNumber: episode.seasonNumber, episodeNumber: episode.episodeNumber, title: episode.title });

/** The download block's state on the page: its word, figure, release, pack line, dots and actions. */
const blockState = page => page.evaluate(() => {
    const block = [...document.querySelectorAll('.page:not(.hide) .jfmod-dlblock')].find(node => node.getClientRects().length > 0);
    if (!block) return null;
    const text = selector => block.querySelector(selector)?.textContent?.trim() ?? null;
    const visible = selector => [...block.querySelectorAll(selector)].filter(node => node.getClientRects().length > 0).length;
    const play = [...document.querySelectorAll('.page:not(.hide) .mainDetailButtons .btnPlay, .page:not(.hide) .mainDetailButtons .btnReplay')]
        .filter(node => getComputedStyle(node).display !== 'none' && node.getClientRects().length > 0).length;
    const tracks = document.querySelector('.page:not(.hide) .trackSelections');
    return {
        state: block.getAttribute('data-jfmod-state'), word: text('.jfmod-dlblock-word'), figure: text('.jfmod-dlblock-figure'),
        release: text('.jfmod-dlblock-release'), pack: text('.jfmod-dlblock-pack > span'), dots: visible('.jfmod-dlblock-dot'),
        get: visible('.jfmod-dlblock-get'), search: visible('.jfmod-dlblock-search'), cancel: visible('.jfmod-dlblock-cancel'),
        queue: visible('.jfmod-dlblock-queue'), ring: visible('.jfmod-dlmark'), play,
        beforeTracks: !!tracks && !!block.closest('.jfmod-dlblockSlot') && block.closest('.jfmod-dlblockSlot').nextElementSibling === tracks
    };
});

// With nothing in flight the block reads the queue once a minute (P1.FU20); once a download shows, every 3 seconds.
async function waitBlock(page, kind, extra = () => true) {
    for (let waited = 0; waited < 75000; waited += 500) {
        const state = await blockState(page);
        if (state?.state === kind && extra(state)) return state;
        await page.waitForTimeout(500);
    }
    return blockState(page);
}

// ---------------------------------------------------------------- per layout and user

async function browserChecks(browser, layout, user, isAdmin, fx, api) {
    const label = `${layout}, ${user}`;
    const options = LAYOUTS[layout];
    const context = await browser.newContext({ ...options, tv: undefined });
    const page = await context.newPage();
    const errors = [];
    let where = '';
    page.on('pageerror', error => errors.push(String(error.message ?? error).split('\n')[0] + ' @ ' + where + ' ' + String(error.stack ?? '').split('\n').slice(1, 4).join(' | ')));
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) where = frame.url().replace(/^[^#]*/, ''); });
    const shot = name => page.screenshot({ path: `${SHOTS}/bf-${tier}-${layout}-${user}-${name}.png` }).catch(() => {});
    let answer = { items: [], totalRecordCount: 0, generatedAt: now(), clientStatus: { reachable: true, checkedAt: now(), reason: null },
        importEnabled: true, seedReleaseEnabled: true };
    const setRows = rows => { answer = { ...answer, items: rows, totalRecordCount: rows.length }; };
    await page.route(url => /\/JellyfinMod\/Queue$/i.test(url.pathname), route => {
        if (route.request().method() !== 'GET') return route.continue();
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...answer, generatedAt: now() }) });
    });
    try {
        await signIn(page, user);
        if (options.tv) {
            await page.evaluate(() => localStorage.setItem('layout', 'tv'));
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } }, undefined, { timeout: 30000 });
        }
        const { stub, detail, movie, movieEntry, season } = fx;
        const pluginEpisode = detail.episodes.find(item => item.seasonNumber === stub.ParentIndexNumber && item.episodeNumber === stub.IndexNumber);
        const entry = { ...detail.entry };

        // The placeholder episode's page: the block in the selectors' place, from the queue.
        setRows([]);
        await go(page, `#/details?id=${stub.Id}&serverId=${await page.evaluate(() => ApiClient.serverId())}`);
        await page.waitForSelector(`${PAGE} .jfmod-dlblock`, { timeout: 30000 }).catch(() => {});
        let state = await waitBlock(page, 'none');
        record(label, 'Placeholder episode page: the download block reads Not Downloaded, before the track selectors, no Play',
            state?.state === 'none' && state.word === 'Not Downloaded' && state.play === 0 && state.beforeTracks, state);
        record(label, isAdmin ? 'Administrator: Get a Release in the block' : 'Ordinary user: no Get a Release in the block',
            isAdmin ? state?.get === 1 : state?.get === 0, state);
        await shot('episode-none');

        setRows([queueRow(entry, { episode: episodeRef(pluginEpisode), state: 'downloading', progress: 0.42 })]);
        state = await waitBlock(page, 'downloading');
        record(label, 'Downloading: the word, 42% in the figure, the release and its ring',
            state?.word === 'Downloading' && /42%/.test(state.figure ?? '') && state.release === 'JellyfinMod.FU27.Fixture.1080p.WEB-DL' && state.ring >= 1, state);
        record(label, isAdmin ? 'Administrator: Cancel Download and View Queue' : 'Ordinary user: no Cancel Download',
            isAdmin ? state?.cancel === 1 && state.queue === 1 : state?.cancel === 0, state);
        await shot('episode-downloading');

        // The pack holds every season-1 episode the plugin lists without a file, each at 30% of its own file.
        const packed = (await fixtures(api)).detail.episodes.filter(item => item.seasonNumber === 1 && item.availability !== 'onDisk');
        const pack = { scope: 'season', label: 'Season 1 pack · 1080p', mode: 'fill', episodes: packed.map(item => ({
            episodeId: item.id, seasonNumber: item.seasonNumber, episodeNumber: item.episodeNumber, importId: null, importState: null,
            reason: null, progress: 0.3, sizeBytes: 800_000_000 })) };
        setRows([queueRow(entry, { pack, state: 'downloading', progress: 0.5 })]);
        state = await waitBlock(page, 'downloading', current => !!current.pack);
        const index = packed.findIndex(item => item.id === pluginEpisode.id) + 1;
        record(label, 'A season pack: its own file\'s 30%, the pack line naming its file and one dot per episode',
            /30%/.test(state?.figure ?? '') && state?.pack === `Season 1 pack · this episode is file ${index} of ${packed.length}` && state.dots === packed.length, state);

        setRows([queueRow(entry, { episode: episodeRef(pluginEpisode), state: 'linking', progress: 1 })]);
        state = await waitBlock(page, 'importing');
        record(label, 'Importing', state?.word === 'Importing', state);
        setRows([queueRow(entry, { episode: episodeRef(pluginEpisode), state: 'failed', progress: 0.7, message: 'The download stopped.' })]);
        state = await waitBlock(page, 'failed');
        record(label, isAdmin ? 'Failed, with Search Again for an administrator' : 'Failed, with no Search Again',
            state?.word === 'Failed' && (isAdmin ? state.search === 1 : state.search === 0), state);
        await shot('episode-failed');

        // The ring maps through the placeholder: the season page's row of the placeholder shows the pack's download.
        setRows([queueRow(entry, { pack, state: 'downloading', progress: 0.5 })]);
        await go(page, `#/details?id=${season.Id}&serverId=${await page.evaluate(() => ApiClient.serverId())}`);
        await page.waitForSelector(`${PAGE} .listItem[data-id="${stub.Id}"]`, { timeout: 30000 }).catch(() => {});
        const ring = await waitForValue(page, () => page.evaluate(id => {
            const row = document.querySelector(`.page:not(.hide) .listItem[data-id="${id}"]`);
            return row && row.classList.contains('jfmod-dlRow') && row.querySelector('.jfmod-dlmark') ? { meta: row.querySelector('.jfmod-dlMeta')?.textContent } : null;
        }, stub.Id), 20000);
        record(label, 'Season page: the placeholder\'s own row shows its pack episode\'s download (ring and figure)', !!ring && /30%/.test(ring.meta ?? ''), ring);

        // No duplicates on the season page: each listed episode has exactly one row. Read again now: opening a series' page loads
        // its full TMDB list once (P1.FU9), which can add episodes and their placeholders.
        setRows([]);
        await page.waitForTimeout(1500);
        const fresh = await fixtures(api);
        const freshDetail = fresh.detail;
        const freshEpisodes = fresh.episodes;
        const rows = await page.evaluate(() => {
            const container = document.querySelector('.page:not(.hide) #listChildrenCollapsible .itemsContainer');
            const ids = [...(container?.children ?? [])].map(node => ({ id: node.getAttribute('data-id'), mod: node.classList.contains('jfmod-missingSlot'),
                episode: node.getAttribute('data-jfmod-episode-id') }));
            return ids;
        });
        const nativeNumbers = new Map(freshEpisodes.map(item => [norm(item.Id), item.IndexNumber]));
        const counts = new Map();
        for (const row of rows) {
            const number = row.mod ? freshDetail.episodes.find(item => item.id === row.episode)?.episodeNumber : nativeNumbers.get(norm(row.id));
            counts.set(number, (counts.get(number) ?? 0) + 1);
        }
        const listed = [...new Set(freshDetail.episodes.filter(item => item.seasonNumber === 1).map(item => item.episodeNumber))];
        record(label, 'Season page: every listed episode has exactly one row (Jellyfin\'s placeholder or file, else the mod\'s)',
            listed.every(number => counts.get(number) === 1) && [...counts.values()].every(count => count === 1), Object.fromEntries(counts));
        await shot('season');

        // The series page: one card per season; the season card's count line matches the season page.
        await go(page, `#/details?id=${fx.series.Id}&serverId=${await page.evaluate(() => ApiClient.serverId())}`);
        await page.waitForSelector(`${PAGE} .card[data-id="${season.Id}"]`, { timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(1500);
        const seasonCards = await page.evaluate(id => ({
            cards: document.querySelectorAll(`.page:not(.hide) #listChildrenCollapsible .card[data-id="${id}"]`).length,
            mod: document.querySelectorAll('.page:not(.hide) #listChildrenCollapsible .jfmod-missingCard[data-jfmod-season="1"]').length,
            count: document.querySelector(`.page:not(.hide) .card[data-id="${id}"] [data-jfmod-count]`)?.textContent?.trim() ?? null
        }), season.Id);
        record(label, 'Series page: one card for season 1, no mod card beside it, its line counts every listed episode',
            seasonCards.cards === 1 && seasonCards.mod === 0 && seasonCards.count === `${listed.length} episodes`, seasonCards);

        // The placeholder movie's page and its grid card.
        const movieRow = queueRow({ ...movieEntry }, { state: 'downloading', progress: 0.25 });
        setRows([movieRow]);
        await go(page, `#/details?id=${movie.Id}&serverId=${await page.evaluate(() => ApiClient.serverId())}`);
        await page.waitForSelector(`${PAGE} .jfmod-dlblock`, { timeout: 30000 }).catch(() => {});
        state = await waitBlock(page, 'downloading');
        record(label, 'Placeholder movie page: the block shows the movie\'s download, no Play',
            state?.word === 'Downloading' && /25%/.test(state.figure ?? '') && state.play === 0, state);
        await shot('movie-downloading');
        setRows([]);
        state = await waitBlock(page, 'none');
        record(label, 'Placeholder movie page with nothing queued: Not Downloaded', state?.word === 'Not Downloaded', state);

        // Search finds the placeholder title once.
        await go(page, `#/search?query=${encodeURIComponent(movieName)}`);
        await page.waitForTimeout(4000);
        const found = await page.evaluate(id => document.querySelectorAll(`.page:not(.hide) .card[data-id="${id}"]`).length, movie.Id);
        record(label, 'Search: the placeholder movie appears once', found === 1, { found });

        if (readOnlyName) await readOnlyChecks(page, label, api);
        if (layout === 'desktop' && isAdmin) await settingsChecks(page, label);
        record(label, 'No page errors', errors.length === 0, errors.slice(0, 3));
    } finally {
        await context.close();
    }
}

async function waitForValue(page, read, ms) {
    for (let waited = 0; waited < ms; waited += 500) {
        const value = await read();
        if (value) return value;
        await page.waitForTimeout(500);
    }
    return null;
}

/** A series in a read-only folder gets no placeholders: its missing episodes keep the mod's rows, one per episode. */
async function readOnlyChecks(page, label, { call, userId }) {
    const series = (await items(call, userId, `includeItemTypes=Series&searchTerm=${encodeURIComponent(readOnlyName)}`)).find(item => item.Name === readOnlyName);
    const seasons = series ? (await call('GET', `/Shows/${series.Id}/Seasons?userId=${userId}`)).json?.Items ?? [] : [];
    const season = seasons.find(item => item.IndexNumber === 1);
    if (!season) { record(label, 'Read-only series found', false, { readOnlyName }); return; }
    await go(page, `#/details?id=${season.Id}&serverId=${await page.evaluate(() => ApiClient.serverId())}`);
    await page.waitForSelector(`${PAGE} .jfmod-missingRow`, { timeout: 30000 }).catch(() => {});
    const state = await page.evaluate(() => ({
        mod: document.querySelectorAll('.page:not(.hide) .jfmod-missingRow').length,
        placeholders: document.querySelectorAll('.page:not(.hide) .listItem[data-jfmod-placeholder]').length
    }));
    record(label, `Read-only fallback (${readOnlyName} season 1): the mod's rows for its missing episodes, no placeholder rows`, state.mod > 0 && state.placeholders === 0, state);
}

/** Settings, Missing Episodes: the progress line and Sync Now. */
async function settingsChecks(page, label) {
    await go(page, '#/catalog/settings?section=placeholders');
    await page.waitForSelector('[data-jfmod-placeholder-progress] strong', { timeout: 30000 }).catch(() => {});
    await page.waitForFunction(() => !/reading/.test(document.querySelector('[data-jfmod-placeholder-progress] strong')?.textContent ?? 'reading'),
        undefined, { timeout: 30000 }).catch(() => {});
    const line = await page.locator('[data-jfmod-placeholder-progress] strong').first().textContent().catch(() => null);
    record(label, 'Settings: "Placeholders: N of M titles done · P placeholders pending"', /^Placeholders: \d+ of \d+ titles? done · \d+ placeholders? pending$/.test(line ?? ''), { line });
    await page.screenshot({ path: `${SHOTS}/bf-${tier}-settings.png`, fullPage: false }).catch(() => {});
    await page.locator('[data-jfmod-placeholder-progress] button').filter({ hasText: 'Sync Now' }).click();
    const notice = await waitForValue(page, () => page.evaluate(() => document.querySelector('.jfmod-notice-text')?.textContent ?? null), 120000);
    record(label, 'Settings: Sync Now runs a batch and says how far the placeholders are', /^Synced: \d+ of \d+ titles? done/.test(notice ?? '')
        || /running already/.test(notice ?? ''), { notice });
    // Restore Watched State: its dry run first; a confirmation is cancelled here, so nothing is restored by this runner.
    await page.evaluate(() => { document.querySelectorAll('.jfmod-notice-text').forEach(node => { node.textContent = ''; }); });
    await page.locator('[data-jfmod-placeholder-progress] button').filter({ hasText: 'Restore Watched State' }).click();
    const answer = await waitForValue(page, () => page.evaluate(() => {
        const dialog = document.querySelector('[data-jfmod-confirm] .MuiDialogTitle-root, [data-jfmod-confirm] h2');
        if (dialog) return { dialog: dialog.textContent };
        const text = document.querySelector('.jfmod-notice-text')?.textContent;
        return text ? { notice: text } : null;
    }), 60000);
    if (answer?.dialog) await page.locator('[data-jfmod-confirm="cancel"]').click();
    record(label, 'Settings: Restore Watched State shows its dry run first (a confirmation naming the marks, or nothing to restore)',
        /^Restore \d+ watched marks?\?$/.test(answer?.dialog ?? '') || /^Nothing to restore from retention history/.test(answer?.notice ?? ''), answer);
}

/** A placeholder written while the season page is open replaces the mod's row without a reload, never two rows meanwhile. */
async function swapCheck(browser, api) {
    const label = 'desktop, mid-visit swap';
    const { call, userId } = api;
    const series = (await items(call, userId, `includeItemTypes=Series&searchTerm=${encodeURIComponent(swapName)}`)).find(item => item.Name === swapName);
    const season = series && ((await call('GET', `/Shows/${series.Id}/Seasons?userId=${userId}`)).json?.Items ?? []).find(item => item.IndexNumber === 1);
    if (!season) { record(label, 'Swap series found', false, { swapName }); return; }
    const context = await browser.newContext(LAYOUTS.desktop);
    const page = await context.newPage();
    try {
        await signIn(page, 'oleksii');
        await go(page, `#/details?id=${season.Id}&serverId=${await page.evaluate(() => ApiClient.serverId())}`);
        await page.waitForSelector(`${PAGE} .jfmod-missingRow`, { timeout: 30000 });
        await page.evaluate(() => { window.jfmodSwapMarker = true; });
        const before = await page.evaluate(() => [...document.querySelectorAll('.page:not(.hide) .jfmod-missingRow')].map(node => node.getAttribute('data-jfmod-episode-id')));
        record(label, 'Before: the episode with no placeholder has the mod\'s row', before.length >= 1, { before });
        const sync = await call('POST', '/JellyfinMod/Placeholders/SyncNow');
        record(label, 'Sync Now writes the pending placeholders', sync.status === 200 || sync.status === 409, { status: sync.status, pending: sync.json?.pending });
        // Each sample: the episode numbers drawn by both a Jellyfin row and a mod row at once (each row's "N. Title" line).
        const both = [];
        const swapped = await waitForValue(page, async () => {
            const state = await page.evaluate(ids => {
                const container = document.querySelector('.page:not(.hide) #listChildrenCollapsible .itemsContainer');
                const numberOf = row => Number(/^\s*(\d+)\./.exec(row.querySelector('.listItemBodyText')?.textContent ?? '')?.[1] ?? NaN);
                const rows = [...(container?.children ?? [])];
                const native = new Set(rows.filter(row => !row.classList.contains('jfmod-missingSlot')).map(numberOf));
                const modNumbers = rows.filter(row => row.classList.contains('jfmod-missingSlot')).map(numberOf);
                const mod = ids.filter(id => container?.querySelector(`[data-jfmod-episode-id="${id}"]`)).length;
                const placeholders = container?.querySelectorAll('.listItem[data-jfmod-placeholder]').length ?? 0;
                return { mod, placeholders, total: rows.length, marker: window.jfmodSwapMarker === true,
                    numbered: [...native].filter(Number.isFinite).length,
                    both: modNumbers.filter(number => Number.isFinite(number) && native.has(number)) };
            }, before);
            both.push(...state.both);
            return state.mod === 0 ? state : null;
        }, 300000);
        record(label, 'After: Jellyfin\'s placeholder row replaced the mod\'s, without a reload', !!swapped && swapped.marker && swapped.placeholders >= 1, swapped);
        record(label, 'No episode ever had a Jellyfin row and a mod row at once while it swapped (rows read by number)',
            both.length === 0 && (swapped?.numbered ?? 0) > 0, { both: [...new Set(both)], numbered: swapped?.numbered });
        await page.screenshot({ path: `${SHOTS}/bf-${tier}-swap.png` }).catch(() => {});
    } finally {
        await context.close();
    }
}

async function main() {
    const admin = await signInApi('oleksii');
    const fx = await fixtures(admin);
    console.log(`Fixtures: ${seriesName} season 1 (${fx.episodes.length} Jellyfin episodes, placeholder ${fx.stub.Name}), movie ${movieName}`);
    const browser = await chromium.launch(tier === 'chrome' ? { headless: true, channel: 'chrome' } : { headless: true });
    try {
        for (const layout of layouts) {
            await browserChecks(browser, layout, 'oleksii', true, fx, admin);
            if (ordinaryUser) await browserChecks(browser, layout, ordinaryUser, false, fx, admin);
        }
        if (swapName) await swapCheck(browser, admin);
    } finally {
        await browser.close();
    }
    const failed = results.filter(result => result.verdict === 'FAIL');
    console.log(`\n${results.length} checks, ${failed.length} failed (${tier})`);
    process.exitCode = failed.length ? 1 : 0;
}

main().catch(error => {
    console.error(error);
    process.exitCode = 2;
});
/* eslint-enable compat/compat, no-restricted-globals, @stylistic/max-statements-per-line, no-empty-function, sonarjs/cognitive-complexity */
