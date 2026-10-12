/* eslint-disable compat/compat, no-restricted-globals, @stylistic/max-statements-per-line, no-empty-function, sonarjs/cognitive-complexity -- a Node acceptance runner, not shipped code */
/* global window, document, ApiClient, localStorage, location, getComputedStyle */
// Downloads on cards and rows (P4.FU1, user-approved design 2026-10-12; UX §3.3), in a real browser against a running mod
// instance, signed in as oleksii with an empty password.
//
// INTERCEPTED QUEUE ANSWERS, NOT A LIVE DOWNLOAD: the browser's `GET /JellyfinMod/Queue` is answered by this runner with rows
// built from real entries, episodes and Jellyfin items of the instance (a downloading and a stalled episode of one native
// season, and where the season has them a queued, an importing and a failed one; a season pack on a season Jellyfin does not
// have; a file-less movie). Nothing is grabbed and nothing on the server changes. What it checks:
//   - the native season card: the amber bar at the poster's bottom (0.24em, the mean of its episodes), the white arrow inside
//     upstream's count pill (or the amber arrow in the dark disc when it has no count), bobbing, still under reduced motion;
//     the other season cards carry none;
//   - a missing season card with a pack on its way: the disc and the bar, the Not Downloaded icon hidden;
//   - the season page's rows: the figure at the row's end ("42% · 12 min left", "30% · stalled", "Queued", "Importing…",
//     "Failed · …") and the bar along the row's bottom edge in its colour; the light scheme's darker figure (the theme attribute
//     set in the page only, the user's setting is not changed);
//   - the series' card and the file-less movie's card in search results: the aggregate bar and the arrow;
//   - P4.FU5: the pack's episodes on the mod's season page each show their own file (the plugin's `pack.episodes[].progress` and
//     `sizeBytes`): "42% · 6 min left" (its remaining bytes at the pack's rate), "10%" (no size, so no time left), "Importing…"
//     for a file finished or being imported, "Queued" with the track alone for one not started, "Failed · …" for a blocked
//     one, and each bar at that value; the missing season's card keeps one bar for the pack (60%);
//   - one queue read per page, then every 5 s while something is on its way, and no polling once nothing is;
//   - no page errors.
//
//   JELLYFINMOD_TEST_URL=http://<host>:<port>/   a mod instance (18096, 28096, 48096) or a local environment on 127.0.0.1
//   JELLYFINMOD_CP_SERIES=<series entry id>        a series with a Jellyfin series item and at least one Jellyfin season
//   [JELLYFINMOD_CP_FILELESS=<entry id>]          a file-less movie or series entry, found on the search page
//   [JELLYFINMOD_WEB_PATH=/web/]  [JELLYFINMOD_BROWSER=chromium|chrome]  [JELLYFINMOD_LAYOUTS=desktop,mobile,tv1080]
import { chromium } from 'playwright';

const origin = new URL(process.env.JELLYFINMOD_TEST_URL ?? (() => { throw new Error('JELLYFINMOD_TEST_URL is required'); })());
const loopback = ['127.0.0.1', 'localhost'].includes(origin.hostname);
if (!loopback && !['18096', '28096', '48096'].includes(origin.port)) throw new Error('Runs on the mod instances or a local environment only');
const seriesEntryId = process.env.JELLYFINMOD_CP_SERIES ?? (() => { throw new Error('JELLYFINMOD_CP_SERIES is required'); })();
const filelessEntryId = process.env.JELLYFINMOD_CP_FILELESS ?? process.env.JELLYFINMOD_CP_MOVIE ?? null;
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
const AMBER = 'rgb(255, 179, 0)';
const STALLED = 'rgb(224, 160, 48)';
const FAILED = 'rgb(229, 57, 53)';

const results = [];
const record = (label, check, pass, detail) => {
    let verdict = pass;
    if (typeof pass === 'boolean') verdict = pass ? 'PASS' : 'FAIL';
    results.push({ label, check, verdict, detail });
    console.log(`${verdict} [${label}] ${check}${detail === undefined ? '' : ' · ' + JSON.stringify(detail).slice(0, 500)}`);
};

async function signIn(page) {
    await page.goto(new URL(WEB_PATH, origin).href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.ApiClient, undefined, { timeout: 30000 });
    await page.waitForFunction(() => {
        try { return !!ApiClient.getCurrentUserId() || /login|selectuser|selectserver/.test(location.hash); } catch { return false; }
    }, undefined, { timeout: 30000 });
    if (await page.evaluate(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } })) return;
    const field = page.locator('#txtManualName');
    if (!await field.isVisible().catch(() => false)) {
        const chooser = page.locator('.btnManual').first();
        await chooser.waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
        if (await chooser.count()) await chooser.evaluate(node => node.click());
        await field.waitFor({ state: 'visible', timeout: 15000 });
    }
    await page.waitForTimeout(1000);
    await field.fill('oleksii');
    await page.locator('#txtManualPassword').fill('');
    await page.locator('button:visible').filter({ hasText: 'Sign In' }).first().click();
    await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } }, undefined, { timeout: 30000 });
    await page.waitForFunction(() => location.hash.startsWith('#/home'), undefined, { timeout: 30000 });
}

const apiGet = (page, path) => page.evaluate(async url => {
    const response = await fetch(ApiClient.getUrl(url), { headers: { Authorization: `MediaBrowser Token="${ApiClient.accessToken()}"` } });
    return response.ok ? response.json() : null;
}, path);

const go = async (page, hash) => {
    await page.evaluate(target => { location.hash = target; }, hash);
    await page.waitForTimeout(500);
};

const now = () => new Date().toISOString();
let serial = 0;
/** One queue row as the plugin answers it. */
const queueRow = (entry, { episode = null, pack = null, state, progress = null, etaSeconds = null, message = null, downloadRateBytes = null }) => ({
    id: `00000000-0000-4000-8000-${String(++serial).padStart(12, '0')}`,
    grabId: `00000000-0000-4000-9000-${String(serial).padStart(12, '0')}`,
    entry: { id: entry.id, mediaType: entry.mediaType, title: entry.title, year: entry.year ?? null, posterPath: null,
        jellyfinItemId: entry.jellyfinItemId ?? null, targetLibraryId: null },
    episode, releaseTitle: 'JellyfinMod card progress fixture', state, importState: state, reason: message ? 'fixture' : null, message,
    progress, sizeBytes: null, downloadedBytes: null, downloadRateBytes, etaSeconds, stalledSince: null, observedAt: now(),
    versionLabel: null, intent: 'acquire', createdAt: now(), updatedAt: now(), client: null, seeding: null, pack
});
const episodeRef = episode => ({ id: episode.id, seasonNumber: episode.seasonNumber, episodeNumber: episode.episodeNumber, title: episode.title });

/** What a card shows of a download: its bar, the arrow in the pill or the disc, and whether a Not Downloaded mark is visible. */
const cardState = (page, selector) => page.evaluate(sel => {
    const card = [...document.querySelectorAll(sel)].find(node => !node.closest('.hide'));
    if (!card) return null;
    const frame = card.querySelector('.cardScalable') ?? card;
    const bar = frame.querySelector('.jfmod-dlCardBar');
    const fill = bar?.querySelector('.jfmod-dlBar-fill');
    const pill = frame.querySelector('.countIndicator');
    const disc = frame.querySelector('.jfmod-dlDisc');
    const none = frame.querySelector('.jfmod-mark--none');
    const before = pill ? getComputedStyle(pill, '::before') : null;
    const fontSize = parseFloat(getComputedStyle(frame).fontSize);
    return {
        bar: !!bar,
        percent: fill ? parseFloat(fill.style.width) : null,
        colour: fill ? getComputedStyle(fill).backgroundColor : null,
        heightEm: bar ? Math.round(bar.getBoundingClientRect().height / fontSize * 100) / 100 : null,
        barVisible: bar ? getComputedStyle(bar).visibility === 'visible' && bar.getBoundingClientRect().height > 0 : false,
        atBottom: bar ? Math.abs(bar.getBoundingClientRect().bottom - frame.getBoundingClientRect().bottom) < 1.5 : false,
        pill: pill ? { arrow: pill.classList.contains('jfmod-countArrow'), content: before.content, animation: before.animationName, text: pill.textContent.trim() } : null,
        disc: disc ? { colour: getComputedStyle(disc).color, animation: getComputedStyle(disc.querySelector('svg')).animationName, title: disc.title,
            visible: disc.getBoundingClientRect().width > 0 } : null,
        noneShown: !!none && getComputedStyle(none).display !== 'none',
        upstreamBarHidden: [...frame.querySelectorAll('.itemProgressBar, .itemLinearProgress')].every(node => getComputedStyle(node).visibility === 'hidden')
    };
}, selector);

/** The season page's rows that show a download: the figure, its colour, and the bar's kind and length. */
const rowStates = page => page.evaluate(() => [...document.querySelectorAll('.page:not(.hide) .jfmod-dlRow')].map(row => {
    const figure = row.querySelector('.jfmod-dlRowFigure');
    const bar = row.querySelector('.jfmod-dlRowBar');
    const fill = bar?.querySelector('.jfmod-dlBar-fill');
    const box = row.getBoundingClientRect();
    return {
        id: row.getAttribute('data-id') ?? row.getAttribute('data-jfmod-episode-id'),
        text: figure?.textContent ?? null,
        colour: figure ? getComputedStyle(figure).color : null,
        tabular: figure ? getComputedStyle(figure).fontVariantNumeric : null,
        // At the row's end; on the phone, the last line of the row's text.
        figureAtEnd: !!figure && (document.documentElement.classList.contains('layout-mobile') ? figure.parentElement?.classList.contains('listItemBody')
            && figure === figure.parentElement.lastElementChild : figure.getBoundingClientRect().right > box.left + box.width * 0.5),
        bar: bar ? { percent: parseFloat(fill.style.width), colour: getComputedStyle(fill).backgroundColor,
            atBottom: Math.abs(bar.getBoundingClientRect().bottom - box.bottom) < 1.5, animation: getComputedStyle(fill).animationName } : null,
        noneShown: [...row.querySelectorAll('.jfmod-mark--none')].some(node => getComputedStyle(node).display !== 'none')
    };
}));

async function run(browser, layout) {
    const label = `${layout}, ${tier}`;
    const tv = !!LAYOUTS[layout].tv;
    const options = { ...LAYOUTS[layout] };
    delete options.tv;
    const context = await browser.newContext(options);
    const page = await context.newPage();
    const errors = [];
    const shot = (name, fullPage = false) => page.screenshot({ path: `${process.env.JELLYFINMOD_SHOTS ?? '.'}/card-progress-${tier}-${layout}-${name}.png`,
        fullPage }).catch(() => {});
    page.on('pageerror', error => errors.push(String(error.message).slice(0, 200)));
    let answer = { items: [], totalRecordCount: 0, generatedAt: now(), clientStatus: { reachable: true, checkedAt: now(), reason: null },
        importEnabled: true, seedReleaseEnabled: true };
    const reads = [];
    await page.route(url => /\/JellyfinMod\/Queue$/i.test(url.pathname), route => {
        if (route.request().method() !== 'GET') return route.continue();
        reads.push(Date.now());
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...answer, generatedAt: now() }) });
    });
    try {
        await signIn(page);
        if (tv) {
            await page.evaluate(() => localStorage.setItem('layout', 'tv'));
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } }, undefined, { timeout: 30000 });
        }
        const health = await apiGet(page, 'JellyfinMod/Health');
        const capabilities = health?.Capabilities ?? health?.capabilities ?? [];
        if (!capabilities.includes('queue')) { record(label, 'the plugin serves the queue', 'NOT VERIFIED', capabilities); return; }

        const detail = await apiGet(page, 'JellyfinMod/Entries/' + seriesEntryId);
        if (detail?.entry.mediaType !== 'series') throw new Error('JELLYFINMOD_CP_SERIES is not a series entry');
        const seriesId = detail.entry.jellyfinItemId;
        if (!seriesId) throw new Error('the series entry has no Jellyfin item');
        const seasons = await page.evaluate(async id => (await ApiClient.getSeasons(id, { userId: ApiClient.getCurrentUserId() })).Items
            .map(item => ({ id: item.Id, number: item.IndexNumber })), seriesId);
        const native = seasons.find(season => season.number > 0 && detail.episodes.filter(episode => episode.seasonNumber === season.number).length >= 2);
        if (!native) throw new Error('no Jellyfin season with two plugin episodes');
        const inSeason = detail.episodes.filter(episode => episode.seasonNumber === native.number).sort((a, b) => a.episodeNumber - b.episodeNumber);
        const held = new Set(seasons.map(season => season.number));
        const missingSeason = [...new Set(detail.episodes.map(episode => episode.seasonNumber))].find(number => number > 0 && !held.has(number));
        const entry = detail.entry;
        const items = [
            queueRow(entry, { episode: episodeRef(inSeason[0]), state: 'downloading', progress: 0.42, etaSeconds: 720 }),
            queueRow(entry, { episode: episodeRef(inSeason[1]), state: 'stalled', progress: 0.3 })
        ];
        const expectedRows = [{ id: inSeason[0], text: '42% · 12 min left', colour: AMBER }, { id: inSeason[1], text: '30% · stalled', colour: STALLED }];
        if (inSeason.length >= 5) {
            items.push(queueRow(entry, { episode: episodeRef(inSeason[2]), state: 'queued' }),
                queueRow(entry, { episode: episodeRef(inSeason[3]), state: 'linking', progress: 1 }),
                queueRow(entry, { episode: episodeRef(inSeason[4]), state: 'failed', progress: 0.1, message: 'No space left on the download disk.' }));
            expectedRows.push({ id: inSeason[2], text: 'Queued' }, { id: inSeason[3], text: 'Importing…', colour: AMBER },
                { id: inSeason[4], text: 'Failed · No space left on the download disk.', failed: true });
        }
        // The season card's mean: the episodes on their way (downloading 42, stalled 30, queued 0, importing 100; failed is not).
        const counted = inSeason.length >= 5 ? [42, 30, 0, 100] : [42, 30];
        const seasonMean = Math.floor(counted.reduce((sum, value) => sum + value, 0) / counted.length);
        // The pack's episodes each with their own file (P4.FU5), in episode order: one being imported, one downloading with its
        // size (1.2 GB at 42%, the pack at 2 MB/s: 696 MB left, 348 s, "6 min left"), one with no size, one finished but not
        // imported yet, one not started, and the rest not started either (no import yet), except a sixth that is blocked.
        const PACK_OWN = [
            { importState: 'scanning', progress: 1, text: 'Importing…', percent: 100 },
            { importState: 'waiting', progress: 0.42, sizeBytes: 1200000000, text: '42% · 6 min left', percent: 42 },
            { importState: 'waiting', progress: 0.1, text: '10%', percent: 10 },
            { importState: 'waiting', progress: 1, text: 'Importing…', percent: 100 },
            { importState: 'waiting', progress: 0, text: 'Queued', percent: 0 },
            { importState: 'blocked', reason: 'source_missing', progress: 0.3, text: 'Failed · The downloaded file could not be found.', percent: 30, failed: true }
        ];
        const packEpisodes = missingSeason === undefined ? [] : detail.episodes.filter(episode => episode.seasonNumber === missingSeason)
            .sort((a, b) => a.episodeNumber - b.episodeNumber);
        const packExpected = packEpisodes.map((episode, index) => ({ episode, ...(PACK_OWN[index] ?? { importState: null, progress: null, text: 'Queued', percent: 0 }) }));
        if (missingSeason !== undefined) {
            items.push(queueRow(entry, { state: 'downloading', progress: 0.6, etaSeconds: 3900, downloadRateBytes: 2000000, pack: { scope: 'season',
                label: `Season ${missingSeason} pack`, mode: 'fill', episodes: packExpected.map(({ episode, importState, reason, progress, sizeBytes }) => ({
                    episodeId: episode.id, seasonNumber: episode.seasonNumber, episodeNumber: episode.episodeNumber,
                    importId: importState ? `00000000-0000-4000-a000-${String(episode.episodeNumber).padStart(12, '0')}` : null,
                    importState: importState ?? null, reason: reason ?? null, progress, sizeBytes: sizeBytes ?? null })) } }));
        }
        // A file-less title: a movie's own row, or a series' first episode (its card shows the mean of one episode).
        const filelessDetail = filelessEntryId ? await apiGet(page, 'JellyfinMod/Entries/' + filelessEntryId) : null;
        const movie = filelessDetail?.entry ?? null;
        const firstEpisode = movie?.mediaType === 'series' ? [...filelessDetail.episodes].filter(episode => episode.seasonNumber > 0)
            .sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber)[0] : null;
        // Jellyfin may already hold the file-less title's item (season folders, a reclaimed file): its card is then upstream's,
        // which the plugin binds to the entry although the entry names no item.
        const boundItem = movie ? await page.evaluate(async ([title, id, kind]) => {
            const found = await ApiClient.getItems(ApiClient.getCurrentUserId(), { searchTerm: title, IncludeItemTypes: kind, Recursive: true, Limit: 5 });
            for (const item of found.Items) {
                const response = await fetch(ApiClient.getUrl('JellyfinMod/Entries', { jellyfinItemId: item.Id, limit: 1 }),
                    { headers: { Authorization: `MediaBrowser Token="${ApiClient.accessToken()}"` } });
                if (response.ok && (await response.json()).items?.[0]?.id === id) return item.Id;
            }
            return null;
        }, [movie.title, movie.id, movie.mediaType === 'movie' ? 'Movie' : 'Series']) : null;
        if (movie) {
            items.push(queueRow(movie, { episode: firstEpisode ? episodeRef(firstEpisode) : null, state: 'downloading', progress: 0.25,
                etaSeconds: 300 }));
        }
        answer = { ...answer, items, totalRecordCount: items.length };

        // The series page: one read when it opens.
        reads.length = 0;
        await go(page, `#/details?id=${seriesId}`);
        await page.waitForSelector('.page:not(.hide) #listChildrenCollapsible .itemsContainer .card', { timeout: 30000 });
        await page.waitForFunction(id => !!document.querySelector(`.page:not(.hide) .card[data-id="${id}"] .jfmod-dlCardBar`), native.id, { timeout: 20000 })
            .catch(() => {});
        await page.waitForTimeout(1000);
        const opened = reads.length;
        const season = await cardState(page, `.page:not(.hide) #listChildrenCollapsible .card[data-id="${native.id}"]`);
        record(label, `Season ${native.number} card: the amber bar at the poster's bottom, ${seasonMean}% (the mean of its episodes on their way)`,
            !!season?.bar && season.barVisible && season.atBottom && Math.abs(season.percent - seasonMean) <= 1 && season.colour === AMBER, season);
        record(label, `Season ${native.number} card: the bar is 0.24em, with no figure`, Math.abs((season?.heightEm ?? 0) - 0.24) < 0.03
            && !await page.locator('.page:not(.hide) .card .jfmod-dlRowFigure').count(), season?.heightEm);
        record(label, `Season ${native.number} card: the white arrow bobs inside the count pill, or the amber arrow in the disc without a count`,
            season?.pill ? season.pill.arrow && season.pill.content !== 'none' && season.pill.animation === 'jfmod-dlBob' && !season.disc :
                season?.disc?.colour === AMBER && season.disc.animation === 'jfmod-dlBob' && season.disc.title === 'Downloading', season);
        const others = await page.evaluate(id => [...document.querySelectorAll('.page:not(.hide) #listChildrenCollapsible .card[data-id]')]
            .filter(card => card.getAttribute('data-id') !== id && !card.classList.contains('jfmod-missingCard'))
            .map(card => !!card.querySelector('.jfmod-dlCardBar, .jfmod-dlDisc, .jfmod-countArrow')), native.id);
        record(label, 'the other season cards show no download', others.every(shown => !shown), others);
        await page.locator(`.page:not(.hide) #listChildrenCollapsible .card[data-id="${native.id}"]`).scrollIntoViewIfNeeded().catch(() => {});
        await shot('series-page');
        if (missingSeason !== undefined) {
            const pack = await cardState(page, `.page:not(.hide) .jfmod-missingCard[data-jfmod-season="${missingSeason}"]`);
            record(label, `missing Season ${missingSeason} card with a pack on its way: the disc and a 60% bar, Not Downloaded hidden`,
                !!pack?.disc?.visible && pack.disc.colour === AMBER && Math.abs(pack.percent - 60) <= 1 && !pack.noneShown, pack);
        } else {
            record(label, 'a missing season card with a pack on its way', 'NOT VERIFIED', 'the series has no season Jellyfin lacks');
        }
        // P4.FU5: the pack's episodes on the mod's season page, each with its own file.
        if (missingSeason !== undefined) {
            const serverId = await page.evaluate(() => ApiClient.serverId());
            await go(page, `#/details?entryId=${encodeURIComponent(entry.id)}&serverId=${encodeURIComponent(serverId)}&season=${missingSeason}`);
            await page.waitForFunction(count => document.querySelectorAll('.page:not(.hide) .jfmod-dlRow').length >= count, packExpected.length,
                { timeout: 30000 }).catch(() => {});
            await page.waitForTimeout(800);
            const packRows = await rowStates(page);
            await shot('pack-season-rows', true);
            for (const expected of packExpected) {
                const row = packRows.find(shown => shown.id === expected.episode.id);
                const colourOk = expected.failed ? row?.bar?.colour === FAILED : expected.text === 'Queued' || row?.colour === AMBER;
                record(label, `pack Season ${missingSeason} E${expected.episode.episodeNumber}: its own "${expected.text}" and a ${expected.percent}% bar, `
                    + 'not the pack\'s 60%', !!row && row.text === expected.text && Math.abs((row.bar?.percent ?? -1) - expected.percent) <= 1
                    && !!row.bar?.atBottom && row.figureAtEnd && colourOk && (expected.failed || !row.noneShown), row);
            }
            await go(page, `#/details?id=${seriesId}`);
            await page.waitForSelector('.page:not(.hide) #listChildrenCollapsible .itemsContainer .card', { timeout: 30000 });
            await page.waitForTimeout(800);
        } else {
            record(label, 'a pack\'s episodes with their own progress', 'NOT VERIFIED', 'the series has no season Jellyfin lacks');
        }

        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.waitForTimeout(300);
        const still = await cardState(page, `.page:not(.hide) #listChildrenCollapsible .card[data-id="${native.id}"]`);
        record(label, 'reduced motion: the arrow rests', (still?.pill?.animation ?? still?.disc?.animation) === 'none', still?.pill ?? still?.disc);
        await page.emulateMedia({ reducedMotion: 'no-preference' });

        // Polling: every 5 s while something on the page is on its way.
        const before = reads.length;
        await page.waitForTimeout(11000);
        const polled = reads.length - before;
        record(label, 'one queue read when the page opens, then every 5 s while something is on its way', opened >= 1 && opened <= 2
            && polled >= 2 && polled <= 3, { opened, polledIn11s: polled });

        // The season page's rows.
        await go(page, `#/details?id=${native.id}`);
        await page.waitForSelector('.page:not(.hide) #listChildrenCollapsible .itemsContainer .listItem', { timeout: 30000 });
        await page.waitForFunction(count => document.querySelectorAll('.page:not(.hide) .jfmod-dlRow').length >= count, expectedRows.length,
            { timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(800);
        const rows = await rowStates(page);
        await page.locator('.page:not(.hide) .jfmod-dlRow').first().scrollIntoViewIfNeeded().catch(() => {});
        await shot('season-rows');
        const itemOf = new Map((await page.evaluate(async ([seriesItem, seasonItem]) => (await ApiClient.getEpisodes(seriesItem,
            { seasonId: seasonItem, userId: ApiClient.getCurrentUserId() })).Items.map(item => [item.IndexNumber, item.Id.replace(/-/g, '').toLowerCase()]),
        [seriesId, native.id])));
        for (const expected of expectedRows) {
            const nativeId = itemOf.get(expected.id.episodeNumber);
            const row = rows.find(shown => (shown.id ?? '').replace(/-/g, '').toLowerCase() === nativeId || shown.id === expected.id.id);
            const colourOk = expected.failed ? row?.bar?.colour === FAILED : !expected.colour || row?.colour === expected.colour;
            record(label, `season page E${expected.id.episodeNumber}: "${expected.text}" at the row's end, the bar along its bottom`,
                !!row && row.text === expected.text && row.figureAtEnd && !!row.bar?.atBottom && colourOk && /tabular-nums/.test(row.tabular ?? '')
                && (expected.failed || !row.noneShown), row);
        }
        // The light scheme's darker figure: the theme attribute set in this page only.
        await page.evaluate(() => { window.jfmodTheme = document.documentElement.getAttribute('data-theme'); document.documentElement.setAttribute('data-theme', 'light'); });
        const light = await rowStates(page);
        await shot('season-rows-light');
        await page.evaluate(() => document.documentElement.setAttribute('data-theme', window.jfmodTheme ?? 'dark'));
        const lightDownloading = light.find(row => row.text === '42% · 12 min left');
        const lightStalled = light.find(row => row.text === '30% · stalled');
        record(label, 'light scheme: the figure is the darker amber (#9a6700, stalled #8d5a00), the bar keeps #ffb300',
            lightDownloading?.colour === 'rgb(154, 103, 0)' && lightStalled?.colour === 'rgb(141, 90, 0)' && lightDownloading?.bar?.colour === AMBER,
            { lightDownloading, lightStalled });

        // The series' card and the movie's card in search results.
        await go(page, `#/search?query=${encodeURIComponent(entry.title)}`);
        await page.waitForFunction(id => !!document.querySelector(`.page:not(.hide) .card[data-id="${id}"] .jfmod-dlCardBar`), seriesId, { timeout: 30000 })
            .catch(() => {});
        const seriesCard = await cardState(page, `.page:not(.hide) .card[data-id="${seriesId}"]`);
        await shot('search-series');
        record(label, 'search: the series card shows the bar and the arrow (the mean of its episodes on their way)', !!seriesCard?.bar
            && seriesCard.colour === AMBER && (seriesCard.pill?.arrow || !!seriesCard.disc), seriesCard);
        if (movie) {
            await go(page, `#/search?query=${encodeURIComponent(movie.title)}`);
            const selector = `.page:not(.hide) .card[data-jfmod-entry-id="${movie.id}"]` + (boundItem ? `, .page:not(.hide) .card[data-id="${boundItem}"]` : '');
            await page.waitForFunction(sel => [...document.querySelectorAll(sel)].some(card => !!card.querySelector('.jfmod-dlCardBar')), selector,
                { timeout: 30000 }).catch(() => {});
            const movieCard = await cardState(page, selector);
            await page.locator(selector).first().scrollIntoViewIfNeeded().catch(() => {});
            await shot('search-fileless');
            record(label, `search: the file-less ${movie.mediaType} card (${boundItem ? 'upstream\'s, bound to the entry' : 'the mod\'s'}) shows a 25% bar `
                + 'and the arrow, Not Downloaded hidden', !!movieCard?.bar && Math.abs(movieCard.percent - 25) <= 1
                && (movieCard.disc?.colour === AMBER || !!movieCard.pill?.arrow) && !movieCard.noneShown, movieCard);
        } else {
            record(label, 'a file-less card', 'NOT VERIFIED', 'JELLYFINMOD_CP_FILELESS not given');
        }

        // Nothing on its way: the marks go and the queue is read once per page, not polled.
        answer = { ...answer, items: [], totalRecordCount: 0 };
        await go(page, `#/details?id=${seriesId}`);
        await page.waitForTimeout(2000);
        const quietFrom = reads.length;
        await page.waitForTimeout(16000);
        const left = await page.evaluate(() => document.querySelectorAll('.jfmod-dlCard, .jfmod-dlRow, .jfmod-countArrow, .jfmod-dlDisc').length);
        // The series page's own queue line (QueueStatusLine) may read the shared queue once on its slow cadence; a 5 s poll
        // would read three times in 16 s.
        record(label, 'nothing on its way: every mark is gone and the queue is not polled', left === 0 && reads.length - quietFrom <= 1,
            { left, readsIn16s: reads.length - quietFrom });
        record(label, 'no page errors', errors.length === 0, errors.slice(0, 3));
    } catch (error) {
        record(label, 'card progress run', 'NOT VERIFIED', String(error.message ?? error).slice(0, 300));
    } finally {
        await page.screenshot({ path: `${process.env.JELLYFINMOD_SHOTS ?? '.'}/card-progress-${tier}-${layout}.png` }).catch(() => {});
        await context.close();
    }
}

const browser = await chromium.launch(tier === 'chrome' ? { channel: 'chrome' } : {});
for (const layout of layouts) await run(browser, layout);
await browser.close();
const failed = results.filter(result => result.verdict === 'FAIL').length;
console.log(`\n${results.length} checks: ${results.filter(result => result.verdict === 'PASS').length} pass, ${failed} fail, `
    + `${results.filter(result => result.verdict === 'NOT VERIFIED').length} not verified (intercepted queue answers, not a live download)`);
process.exit(failed ? 1 : 0);
