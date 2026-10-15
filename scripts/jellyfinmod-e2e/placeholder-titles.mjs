/* eslint-disable compat/compat, no-restricted-globals, @stylistic/max-statements-per-line, no-empty-function, sonarjs/cognitive-complexity -- a Node acceptance runner, not shipped code */
/* global window, document, ApiClient, localStorage, location */
// File-less movies and series as Jellyfin placeholder items (P1.FU26; plan docs/jellyfinmod/design/missing-media-user-actions.md),
// and the user-data cache after a swap (the P1.FU25 follow-up). Against a local environment or a mod instance, nothing
// intercepted, signed in as oleksii with an empty password:
//
//   As a native app (plain HTTP with a user token):
//   - a movie and a series added from TMDb search (POST /JellyfinMod/Entries, what the mod's Add does) become Jellyfin items
//     within a few minutes: the movie a Movie with IsPlaceHolder, its TMDB id and metadata, date added on its release date,
//     CanDownload false; the series a Series whose aired episodes are all placeholders; an unreleased movie gets none;
//   - the entries stay not on disk, name the item as their placeholderItemId, and are found by it (Entries?jellyfinItemId=);
//   - PlaybackInfo answers NotAllowed, Download 404; Latest lists neither; search hints, counts, the Played and Favourite filters
//     and the Favourites tab query (ExcludeLocationTypes=Virtual) include them; ✓ and ♥ work per user (undone);
//   - Browse answers one row per title: the placeholder item, carrying its entry (no separate file-less row).
//   Browser (JELLYFINMOD_LAYOUTS, default desktop), per user:
//   - the movie's card in its library grid: one card, the Not Downloaded mark, no Play on hover, an administrator's centre
//     Get a Release; the mod's own title page (?entryId=) opens Jellyfin's page of the placeholder; the movie's and the series'
//     pages have no Play, keep ✓ ♥; the mod's search shows one card for the movie.
//   With JELLYFINMOD_PT_HOST_ROOT (the host folder of a local environment's /test-media; loopback only) and JELLYFINMOD_PT_SAMPLE
//   (a small video file):
//   - P1.FU25 follow-up: a played and favourite placeholder episode swapped for a file (as the import does) lists played and
//     favourite on /Shows/{id}/Episodes without a restart, even when a list read caught the new item before its first refresh;
//   - the movie's placeholder swapped for a file the same way: the new item carries played, favourite and the date, the entry
//     goes on disk bound to it, and Browse shows it as an ordinary title.
//   With JELLYFINMOD_PT_REMOVE=1: removing the series' entry (never imported) and an Add that is removed at once remove their
//   placeholders and the folders made for them, Jellyfin drops the items, and nothing is backfilled.
//
//   JELLYFINMOD_TEST_URL=http://127.0.0.1:<port>/   JELLYFINMOD_PT_MOVIES=<movie library id>  JELLYFINMOD_PT_SHOWS=<TV library id>
//   [JELLYFINMOD_PT_MOVIE=604] [JELLYFINMOD_PT_SERIES=2996] [JELLYFINMOD_PT_UNRELEASED=1003598] [JELLYFINMOD_PT_SWAP_SERIES=2207]
//   [JELLYFINMOD_PT_CANCEL=605] [JELLYFINMOD_PT_MOVIE_QUERY='the matrix reloaded'] [JELLYFINMOD_PT_SERIES_QUERY='the office'] [JELLYFINMOD_PT_USER=nata] [JELLYFINMOD_BROWSER=chromium|chrome] [JELLYFINMOD_LAYOUTS=desktop,mobile,tv1080]
//   [JELLYFINMOD_SHOTS=<folder>] [JELLYFINMOD_WEB_PATH=/web/]
//
// It adds catalog titles and writes placeholder files into the libraries' writable folders; the swap phase adds video files.
// Run it on a local environment and reset that to its baseline afterwards (envs/bin/reset-to-baseline.sh).
import { copyFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const origin = new URL(process.env.JELLYFINMOD_TEST_URL ?? (() => { throw new Error('JELLYFINMOD_TEST_URL is required'); })());
const loopback = ['127.0.0.1', 'localhost'].includes(origin.hostname);
if (!loopback && !['18096', '28096', '48096'].includes(origin.port)) throw new Error('Runs on the mod instances or a local environment only');
const required = name => process.env[name] ?? (() => { throw new Error(`${name} is required`); })();
const moviesLibrary = required('JELLYFINMOD_PT_MOVIES');
const showsLibrary = required('JELLYFINMOD_PT_SHOWS');
const movieTmdb = Number(process.env.JELLYFINMOD_PT_MOVIE ?? 604);
const seriesTmdb = Number(process.env.JELLYFINMOD_PT_SERIES ?? 2996);
const unreleasedTmdb = Number(process.env.JELLYFINMOD_PT_UNRELEASED ?? 1003598);
const swapSeriesTmdb = Number(process.env.JELLYFINMOD_PT_SWAP_SERIES ?? 2207);
const cancelTmdb = Number(process.env.JELLYFINMOD_PT_CANCEL ?? 605);
const ordinaryUser = process.env.JELLYFINMOD_PT_USER ?? null;
// The host side of a local environment's /test-media: only ever on loopback, never a mod instance's media.
const hostRoot = loopback ? process.env.JELLYFINMOD_PT_HOST_ROOT ?? null : null;
const sample = process.env.JELLYFINMOD_PT_SAMPLE ?? null;
const removeAtEnd = process.env.JELLYFINMOD_PT_REMOVE === '1';
const SHOTS = process.env.JELLYFINMOD_SHOTS ?? '.';
const WEB_PATH = process.env.JELLYFINMOD_WEB_PATH ?? '/web/';
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
const layouts = (process.env.JELLYFINMOD_LAYOUTS ?? 'desktop').split(',').filter(Boolean);
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
    let verdict = pass;
    if (typeof pass === 'boolean') verdict = pass ? 'PASS' : 'FAIL';
    results.push({ label, check, verdict, detail });
    console.log(`${verdict} [${label}] ${check}${detail === undefined ? '' : ' · ' + JSON.stringify(detail).slice(0, 400)}`);
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const norm = id => (id ?? '').replace(/-/g, '').toLowerCase();
const clientFor = user => `MediaBrowser Client="JellyfinMod FU26 runner", Device="node", DeviceId="jfmod-fu26-runner-${user}", Version="1.0"`;

async function signInApi(user) {
    const CLIENT = clientFor(user);
    const response = await fetch(new URL('/Users/AuthenticateByName', origin), {
        method: 'POST', headers: { Authorization: CLIENT, 'Content-Type': 'application/json' },
        body: JSON.stringify({ Username: user, Pw: '' })
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

const waitFor = async (what, read, seconds = 300) => {
    for (let waited = 0; waited <= seconds; waited += 3) {
        const value = await read();
        if (value) return value;
        await sleep(3000);
    }
    return null;
};
const itemsOf = async (call, userId, query) => (await call('GET', `/Items?userId=${userId}&recursive=true&fields=Path,ProviderIds,DateCreated,CanDownload,PremiereDate,Overview&enableUserData=true&${query}`)).json?.Items ?? [];
const byTmdb = async (call, userId, type, tmdbId) => (await itemsOf(call, userId, `includeItemTypes=${type}&hasTmdbId=true`))
    .filter(item => String(item.ProviderIds?.Tmdb) === String(tmdbId));
const BROWSE_FILTERS = { genres: [], years: [], officialRatings: [], tags: [], studioIds: [], status: [], seriesStatus: [], features: [],
    videoBasicFilter: [], videoTypes: [], audioLanguages: [], subtitleLanguages: [] };
const browse = async (call, mediaType, targetLibraryId, query) => (await call('POST', '/JellyfinMod/Browse', {
    mediaType, targetLibraryId, sortBy: ['SortName'], sortOrder: 'Ascending', startIndex: 0, limit: 200, state: [], filters: BROWSE_FILTERS,
    ...(query ? { query } : {})
})).json?.items ?? [];
const addEntry = async (call, mediaType, tmdbId, targetLibraryId) =>
    (await call('POST', '/JellyfinMod/Entries', { mediaType, tmdbId, targetLibraryId })).json?.entry ?? null;

async function apiChecks(admin, ordinary) {
    const label = 'api';
    const { call, userId } = admin;
    // Found through TMDb search, as the mod's Add finds them.
    const found = async (type, tmdbId, query) => (await call('GET', `/JellyfinMod/Discover/Search?q=${encodeURIComponent(query)}&type=${type}`)).json?.items
        ?.some(item => item.tmdbId === tmdbId);
    const searched = { movie: await found('movie', movieTmdb, process.env.JELLYFINMOD_PT_MOVIE_QUERY ?? 'the matrix reloaded'),
        series: await found('series', seriesTmdb, process.env.JELLYFINMOD_PT_SERIES_QUERY ?? 'the office') };
    record(label, 'TMDb search finds the movie and the series to add', searched.movie && searched.series, searched);
    const movie = await addEntry(call, 'movie', movieTmdb, moviesLibrary);
    const series = await addEntry(call, 'series', seriesTmdb, showsLibrary);
    const unreleased = await addEntry(call, 'movie', unreleasedTmdb, moviesLibrary);
    record(label, 'a movie, a series and an unreleased movie are added from TMDb', !!movie && !!series && !!unreleased,
        { movie: movie?.title, series: series?.title, unreleased: unreleased?.title });
    if (!movie || !series || !unreleased) return null;

    // Jellyfin has made the items and refreshed their metadata: the movie has its overview, the series every aired episode.
    const today = new Date().toISOString().slice(0, 10);
    const aired = ((await call('GET', `/JellyfinMod/Entries/${series.id}`)).json?.episodes ?? [])
        .filter(episode => episode.seasonNumber > 0 && episode.airDate && episode.airDate.slice(0, 10) <= today).length;
    const stub = await waitFor('movie item', async () => (await byTmdb(call, userId, 'Movie', movieTmdb)).find(item => item.IsPlaceHolder && item.Overview));
    const show = await waitFor('series item', async () => {
        const [candidate] = await byTmdb(call, userId, 'Series', seriesTmdb);
        if (!candidate) return null;
        const episodes = (await call('GET', `/Shows/${candidate.Id}/Episodes?userId=${userId}&fields=Path,CanDownload,Overview`)).json?.Items ?? [];
        return episodes.length === aired && episodes.every(item => item.Overview) ? { series: candidate, episodes } : null;
    });
    record(label, 'Jellyfin holds the movie as a placeholder Movie with its TMDB metadata', !!stub && !!stub.Overview && stub.Path?.endsWith('.disc'),
        stub && { name: stub.Name, path: stub.Path, overview: !!stub.Overview });
    record(label, 'its date added is its release date and it cannot be downloaded', !!stub && stub.DateCreated?.slice(0, 10) === movie.metadata?.premiereDate?.slice(0, 10)
        && stub.CanDownload === false, stub && { created: stub.DateCreated, release: movie.metadata?.premiereDate, canDownload: stub.CanDownload });
    record(label, 'Jellyfin holds the series with every aired episode a placeholder', !!show && show.episodes.every(item => item.IsPlaceHolder && item.CanDownload === false),
        show ? { name: show.series.Name, episodes: show.episodes.length } : { aired });
    if (!stub || !show) return null;
    // Each placeholder episode is stamped like a held series' (P1.FU24): date added on its air date, TMDB's runtime.
    const stamped = await waitFor('stamped', async () => {
        const episodes = (await call('GET', `/Shows/${show.series.Id}/Episodes?userId=${userId}&fields=DateCreated`)).json?.Items ?? [];
        return episodes.length && episodes.every(item => item.RunTimeTicks > 0 && item.PremiereDate
            && Math.abs(new Date(item.DateCreated) - new Date(item.PremiereDate)) < 36 * 3600 * 1000) ? episodes : null;
    }, 60);
    record(label, 'each placeholder episode has a runtime and its air date as date added', !!stamped, stamped ? { episodes: stamped.length } : undefined);
    await sleep(3000);
    const unreleasedItems = await byTmdb(call, userId, 'Movie', unreleasedTmdb);
    record(label, 'the unreleased movie gets no placeholder', unreleasedItems.length === 0, unreleasedItems.map(item => item.Path));

    const movieDetail = (await call('GET', `/JellyfinMod/Entries/${movie.id}`)).json;
    const seriesDetail = (await call('GET', `/JellyfinMod/Entries/${series.id}`)).json;
    record(label, 'the movie entry stays not on disk and names its placeholder', movieDetail?.entry.state === 'none' && norm(movieDetail.entry.placeholderItemId) === norm(stub.Id),
        { state: movieDetail?.entry.state, placeholderItemId: movieDetail?.entry.placeholderItemId });
    record(label, 'the series entry stays not on disk and names its series item and each episode\'s placeholder',
        seriesDetail?.entry.state === 'none' && norm(seriesDetail.entry.placeholderItemId) === norm(show.series.Id)
            && show.episodes.every(item => seriesDetail.episodes.some(episode => norm(episode.placeholderItemId) === norm(item.Id))),
        { state: seriesDetail?.entry.state, placeholderItemId: seriesDetail?.entry.placeholderItemId });
    for (const [what, itemId, entryId] of [['movie', stub.Id, movie.id], ['series', show.series.Id, series.id], ['episode', show.episodes[0].Id, series.id]]) {
        const lookup = (await call('GET', `/JellyfinMod/Entries?jellyfinItemId=${itemId}&limit=1`)).json?.items ?? [];
        record(label, `the ${what} placeholder finds its entry (Entries?jellyfinItemId=)`, lookup.length === 1 && lookup[0].id === entryId, lookup.map(item => item.title));
    }

    const info = await call('GET', `/Items/${stub.Id}/PlaybackInfo?userId=${userId}`);
    record(label, 'PlaybackInfo of the movie answers NotAllowed with no media source', info.json?.ErrorCode === 'NotAllowed' && !info.json?.MediaSources?.length, info.json);
    record(label, 'Download of the movie answers 404', (await call('GET', `/Items/${stub.Id}/Download`)).status === 404);
    const latest = [...(await call('GET', `/Items/Latest?userId=${userId}&parentId=${moviesLibrary}&limit=50`)).json ?? [],
        ...(await call('GET', `/Items/Latest?userId=${userId}&parentId=${showsLibrary}&limit=50`)).json ?? []];
    record(label, 'Latest lists neither placeholder', !latest.some(item => [norm(stub.Id), norm(show.series.Id)].includes(norm(item.Id))),
        latest.map(item => item.Name));
    const hints = async term => ((await call('GET', `/Search/Hints?searchTerm=${encodeURIComponent(term)}&userId=${userId}`)).json?.SearchHints ?? []).map(hint => norm(hint.Id));
    record(label, 'search hints find the movie and the series', (await hints(stub.Name)).includes(norm(stub.Id)) && (await hints(show.series.Name)).includes(norm(show.series.Id)));

    // Browse: one row per title, the placeholder item carrying the entry.
    const movieRows = (await browse(call, 'movie', moviesLibrary)).filter(row => row.entry?.tmdbId === movieTmdb || String(row.nativeItem?.ProviderIds?.Tmdb) === String(movieTmdb));
    const seriesRows = (await browse(call, 'series', showsLibrary)).filter(row => row.entry?.tmdbId === seriesTmdb || String(row.nativeItem?.ProviderIds?.Tmdb) === String(seriesTmdb));
    record(label, 'Browse: one row for the movie, the placeholder item carrying its entry', movieRows.length === 1 && movieRows[0].kind === 'native'
        && norm(movieRows[0].nativeItem.Id) === norm(stub.Id) && movieRows[0].entry?.id === movie.id && movieRows[0].entry?.state === 'none',
    movieRows.map(row => ({ kind: row.kind, state: row.entry?.state })));
    record(label, 'Browse: one row for the series, the series item carrying its entry', seriesRows.length === 1 && seriesRows[0].kind === 'native'
        && norm(seriesRows[0].nativeItem.Id) === norm(show.series.Id) && seriesRows[0].entry?.id === series.id,
    seriesRows.map(row => ({ kind: row.kind, state: row.entry?.state })));
    const notDownloaded = (await call('POST', '/JellyfinMod/Browse', { mediaType: 'movie', targetLibraryId: moviesLibrary, sortBy: ['SortName'],
        sortOrder: 'Ascending', startIndex: 0, limit: 200, state: ['none'], filters: BROWSE_FILTERS })).json?.items ?? [];
    record(label, 'Browse\'s Not Downloaded filter lists the placeholder movie', notDownloaded.some(row => norm(row.nativeItem?.Id) === norm(stub.Id)));

    // ✓ and ♥ per user, in the filters and the Favourites tab's own query; undone.
    for (const user of [admin, ordinary].filter(Boolean)) {
        const who = user === admin ? 'oleksii' : ordinaryUser;
        await user.call('POST', `/UserFavoriteItems/${stub.Id}?userId=${user.userId}`);
        await user.call('POST', `/UserFavoriteItems/${show.series.Id}?userId=${user.userId}`);
        await user.call('POST', `/UserPlayedItems/${show.series.Id}?userId=${user.userId}`);
        const favourites = (await itemsOf(user.call, user.userId, 'filters=IsFavorite&excludeLocationTypes=Virtual&includeItemTypes=Movie,Series')).map(item => norm(item.Id));
        const played = (await user.call('GET', `/Shows/${show.series.Id}/Episodes?userId=${user.userId}`)).json?.Items ?? [];
        const seriesData = (await user.call('GET', `/Items/${show.series.Id}?userId=${user.userId}`)).json?.UserData;
        record(label, `${who}: ♥ on the movie and the series shows in the Favourites tab's query`, favourites.includes(norm(stub.Id)) && favourites.includes(norm(show.series.Id)));
        record(label, `${who}: ✓ on the series marks every placeholder episode played, and the series played`, played.length > 0
            && played.every(item => item.UserData?.Played) && seriesData?.Played === true, { episodes: played.length, series: seriesData?.Played });
        await user.call('DELETE', `/UserFavoriteItems/${stub.Id}?userId=${user.userId}`);
        await user.call('DELETE', `/UserFavoriteItems/${show.series.Id}?userId=${user.userId}`);
        await user.call('DELETE', `/UserPlayedItems/${show.series.Id}?userId=${user.userId}`);
    }
    const counts = (await call('GET', `/Items/Counts?userId=${userId}`)).json;
    record(label, 'library counts include the placeholders', 'NOTE', counts && { movies: counts.MovieCount, series: counts.SeriesCount, episodes: counts.EpisodeCount });
    return { movie, series, unreleased, stub, show };
}

// ---- Browser ----

const signedIn = page => page.evaluate(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } });

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
const shown = 'node => !!node && getComputedStyle(node).display !== \'none\' && getComputedStyle(node).visibility !== \'hidden\' && node.getClientRects().length > 0';

async function browserChecks(browser, layout, user, isAdmin, context) {
    const label = `${layout}, ${user}`;
    const options = LAYOUTS[layout];
    const browserContext = await browser.newContext({ ...options, tv: undefined });
    const page = await browserContext.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error.message ?? error).split('\n')[0]));
    const shot = name => page.screenshot({ path: `${SHOTS}/pt-${layout}-${user}-${name}.png` }).catch(() => {});
    try {
        await signIn(page, user);
        if (options.tv) {
            await page.evaluate(() => localStorage.setItem('layout', 'tv'));
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => !!window.ApiClient, undefined, { timeout: 30000 });
        }
        const { stub, show, movie } = context;
        const card = `${PAGE} .card[data-id="${stub.Id}"]`;

        // The movie's card in its library grid: one card, the mark, no Play, the centre cloud for an administrator.
        await go(page, `#/movies?topParentId=${moviesLibrary}`);
        await page.waitForSelector(card, { timeout: 30000 }).catch(() => {});
        await page.waitForSelector(`${card} .jfmod-mark--none`, { timeout: 15000 }).catch(() => {});
        await page.evaluate(`window.isShown = ${shown}`);
        const grid = await page.evaluate(({ selector, tmdb, id }) => ({
            cards: document.querySelectorAll(`.page:not(.hide) .card[data-id="${id}"], .page:not(.hide) [data-jfmod-tmdb-id="${tmdb}"]:not([data-id])`).length,
            mark: [...document.querySelectorAll(`${selector} .jfmod-mark--none`)].filter(window.isShown).length,
            noFile: !!document.querySelector(selector)?.closest('[data-jfmod-nofile], [data-jfmod-empty]')
                || !!document.querySelector(selector)?.matches('[data-jfmod-nofile], [data-jfmod-empty]')
        }), { selector: card, tmdb: movieTmdb, id: stub.Id });
        record(label, 'Movies grid: one card for the movie, with the Not Downloaded mark', grid.cards === 1 && grid.mark === 1, grid);
        if (layout === 'desktop') {
            await page.locator(card).first().hover().catch(() => {});
            await page.waitForTimeout(800);
            const hover = await page.evaluate(selector => {
                const node = document.querySelector(selector);
                const play = [...(node?.querySelectorAll('.cardOverlayContainer [data-action="play"], .cardOverlayContainer [data-action="resume"]') ?? [])].filter(window.isShown).length;
                const centre = [...(node?.querySelectorAll('.cardOverlayContainer > .jfmod-cardGet.cardOverlayFab-primary') ?? [])].filter(window.isShown).length;
                return { play, centre };
            }, card);
            record(label, `Movies grid: no Play on hover${isAdmin ? ', Get a Release in the centre' : ''}`, grid.noFile && hover.play === 0 && (isAdmin ? hover.centre === 1 : hover.centre === 0), { ...hover, noFile: grid.noFile });
        }
        await shot('movies-grid');

        // The mod's own title page sends to Jellyfin's page of the placeholder; that page has no Play.
        await go(page, `#/details?entryId=${movie.id}`);
        const redirected = await page.waitForFunction(id => location.hash.includes(`id=${id}`) && !location.hash.includes('entryId='), stub.Id, { timeout: 30000 })
            .then(() => true, () => false);
        record(label, 'the mod\'s file-less movie page opens Jellyfin\'s page of the placeholder', redirected, await page.evaluate(() => location.hash));
        await page.waitForSelector(`${PAGE}[data-jfmod-placeholder]`, { timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(1500);
        await page.evaluate(`window.isShown = ${shown}`);
        const moviePage = await page.evaluate(() => {
            const view = document.querySelector('.page:not(.hide)');
            const count = selector => [...(view?.querySelectorAll(selector) ?? [])].filter(window.isShown).length;
            return { placeholder: view?.hasAttribute('data-jfmod-placeholder'), play: count('.mainDetailButtons .btnPlay, .mainDetailButtons .btnReplay'),
                played: count('.mainDetailButtons .btnPlaystate'), favourite: count('.mainDetailButtons .btnUserRating'), get: count('.jfmod-getRelease') };
        });
        record(label, `the movie's page: no Play, ✓ and ♥ there${isAdmin ? ', Get a Release in the header' : ''}`, moviePage.placeholder && moviePage.play === 0
            && moviePage.played === 1 && moviePage.favourite === 1 && (isAdmin ? moviePage.get >= 1 : moviePage.get === 0), moviePage);
        await shot('movie-page');

        await go(page, `#/details?id=${show.series.Id}`);
        await page.waitForSelector(`${PAGE}[data-jfmod-placeholder]`, { timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(1500);
        await page.evaluate(`window.isShown = ${shown}`);
        const seriesPage = await page.evaluate(() => {
            const view = document.querySelector('.page:not(.hide)');
            const count = selector => [...(view?.querySelectorAll(selector) ?? [])].filter(window.isShown).length;
            return { placeholder: view?.hasAttribute('data-jfmod-placeholder'), play: count('.mainDetailButtons .btnPlay, .mainDetailButtons .btnReplay'),
                played: count('.mainDetailButtons .btnPlaystate'), favourite: count('.mainDetailButtons .btnUserRating'),
                seasons: view?.querySelectorAll('#childrenContent .card').length ?? 0 };
        });
        record(label, 'the series\' page: no Play, ✓ and ♥ there, its seasons listed', seriesPage.placeholder && seriesPage.play === 0
            && seriesPage.played === 1 && seriesPage.favourite === 1 && seriesPage.seasons > 0, seriesPage);
        await shot('series-page');

        // The mod's search: one card for the movie (its placeholder item), none drawn twice.
        await go(page, `#/search?query=${encodeURIComponent(stub.Name)}`);
        await page.waitForSelector(card, { timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(2000);
        const search = await page.evaluate(({ tmdb, id }) => ({
            native: document.querySelectorAll(`.page:not(.hide) .card[data-id="${id}"]`).length,
            fileless: document.querySelectorAll(`.page:not(.hide) [data-jfmod-entry-id][data-jfmod-tmdb-id="${tmdb}"]`).length
        }), { tmdb: movieTmdb, id: stub.Id });
        record(label, 'search: the movie shows once, as its Jellyfin item', search.native === 1 && search.fileless === 0, search);
        await shot('search');
        record(label, 'no page errors', errors.length === 0, errors.slice(0, 5));
    } catch (error) {
        record(label, 'browser run', false, String(error.message ?? error).split('\n')[0]);
        await shot('error');
    } finally {
        await browserContext.close();
    }
}

// ---- The swap (P1.FU25 follow-up and the movie's import swap), with the local environment's folders ----

const containerToHost = path => join(hostRoot, path.replace(/^\/test-media\//, ''));

async function swapChecks(admin, context) {
    const label = 'swap';
    const { call, userId } = admin;
    // The episode list's user-data cache: a played, favourite placeholder episode swapped for a file.
    const swapSeries = await addEntry(call, 'series', swapSeriesTmdb, showsLibrary);
    const held = await waitFor('swap series', async () => {
        const [candidate] = await byTmdb(call, userId, 'Series', swapSeriesTmdb);
        if (!candidate) return null;
        const episodes = (await call('GET', `/Shows/${candidate.Id}/Episodes?userId=${userId}&fields=Path`)).json?.Items ?? [];
        return episodes.find(item => item.IsPlaceHolder && item.ParentIndexNumber === 1 && item.IndexNumber === 1) ? { candidate, episodes } : null;
    });
    if (!swapSeries || !held) {
        record(label, 'a series with a placeholder S01E01 to swap', false);
        return;
    }
    const episode = held.episodes.find(item => item.ParentIndexNumber === 1 && item.IndexNumber === 1);
    await call('POST', `/UserPlayedItems/${episode.Id}?userId=${userId}&datePlayed=2025-09-09T10:00:00Z`);
    await call('POST', `/UserFavoriteItems/${episode.Id}?userId=${userId}`);
    const stubPath = containerToHost(episode.Path);
    const filePath = stubPath.replace(/\.disc$/, ' - 1080p.mkv');
    copyFileSync(sample, filePath);
    unlinkSync(stubPath);
    await call('POST', '/Library/Media/Updated', { Updates: [{ Path: episode.Path.replace(/\/[^/]+$/, ''), UpdateType: 'Modified' }] });
    const timeline = [];
    let last = null;
    const start = Date.now();
    while (Date.now() - start < 150_000) {
        const items = (await call('GET', `/Shows/${held.candidate.Id}/Episodes?userId=${userId}&fields=Path`)).json?.Items ?? [];
        const now = items.find(item => item.ParentIndexNumber === 1 && item.IndexNumber === 1);
        const state = now && `${norm(now.Id).slice(0, 8)}:${now.IsPlaceHolder ? 'stub' : 'file'}:${now.UserData?.Played ? 'played' : 'unplayed'}:${now.UserData?.IsFavorite ? 'fav' : 'nofav'}`;
        if (state !== last) timeline.push(`${((Date.now() - start) / 1000).toFixed(1)}s ${state}`);
        last = state;
        if (now && !now.IsPlaceHolder && now.UserData?.Played && now.UserData?.IsFavorite && Date.now() - start > 5000 && timeline.length > 1) {
            await sleep(3000);
            break;
        }
        await sleep(50);
    }
    const caught = timeline.some(line => line.includes(':file:unplayed'));
    record(label, `a swapped-in episode lists played and favourite on /Shows/{id}/Episodes without a restart${caught ? ' (a list read caught it before its first refresh, then it turned right)' : ''}`,
        /:file:played:fav$/.test(timeline.at(-1) ?? ''), timeline);
    record(label, 'the window between creation and first refresh was observed', caught ? 'PASS' : 'NOTE', caught ? undefined : 'no list read landed in it this time');

    // The movie's placeholder swapped for a file, as its import does: carry-over for a movie, the entry on disk.
    const { stub, movie } = context;
    await call('POST', `/UserPlayedItems/${stub.Id}?userId=${userId}&datePlayed=2025-09-09T10:00:00Z`);
    await call('POST', `/UserFavoriteItems/${stub.Id}?userId=${userId}`);
    const movieStub = containerToHost(stub.Path);
    copyFileSync(sample, movieStub.replace(/\.disc$/, ' - 1080p.mkv'));
    unlinkSync(movieStub);
    await call('POST', '/Library/Media/Updated', { Updates: [{ Path: stub.Path.replace(/\/[^/]+$/, ''), UpdateType: 'Modified' }] });
    const real = await waitFor('movie file', async () => (await byTmdb(call, userId, 'Movie', movieTmdb)).find(item => !item.IsPlaceHolder));
    const single = real && (await call('GET', `/Items/${real.Id}?userId=${userId}`)).json?.UserData;
    record(label, 'the movie\'s file carries played, favourite and the date (a new item)', !!real && norm(real.Id) !== norm(stub.Id) && single?.Played
        && single?.IsFavorite && single?.LastPlayedDate?.startsWith('2025-09-09'), single && { played: single.Played, favourite: single.IsFavorite, date: single.LastPlayedDate });
    const listed = real && (await itemsOf(call, userId, `parentId=${moviesLibrary}&includeItemTypes=Movie`)).find(item => norm(item.Id) === norm(real.Id));
    record(label, 'the movie lists played and favourite (no restart)', !!listed?.UserData?.Played && !!listed?.UserData?.IsFavorite);
    const bound = await waitFor('entry on disk', async () => {
        const detail = (await call('GET', `/JellyfinMod/Entries/${movie.id}`)).json;
        return detail?.entry.state === 'onDisk' ? detail : null;
    }, 120);
    record(label, 'the movie entry goes on disk, bound to the file', !!bound && norm(bound.entry.jellyfinItemId) === norm(real?.Id) && !bound.entry.placeholderItemId,
        bound && { state: bound.entry.state, jellyfinItemId: bound.entry.jellyfinItemId });
    const rows = (await browse(call, 'movie', moviesLibrary)).filter(row => row.entry?.tmdbId === movieTmdb || String(row.nativeItem?.ProviderIds?.Tmdb) === String(movieTmdb));
    record(label, 'Browse shows it once, as an ordinary title', rows.length === 1 && norm(rows[0].nativeItem?.Id) === norm(real?.Id) && rows[0].entry?.state === 'onDisk');
    const completions = (await call('GET', `/JellyfinMod/Entries/${movie.id}`)).json?.history?.filter(item => /complet|watched/i.test(item.eventType ?? '')) ?? [];
    record(label, 'no completion is recorded for the carried-over watch', completions.length === 0, completions.map(item => item.eventType));
}

// ---- Removal (an entry never imported, and an Add removed at once) ----

async function removeChecks(admin, context) {
    const label = 'remove';
    const { call, userId } = admin;
    const { series, show, unreleased } = context;
    const folder = hostRoot && show.episodes[0]?.Path ? containerToHost(show.episodes[0].Path.split('/').slice(0, -2).join('/')) : null;
    const removed = await call('DELETE', `/JellyfinMod/Entries/${series.id}`);
    record(label, 'the series (never imported) can be removed from the catalog', removed.status === 204, removed.status);
    if (folder) record(label, 'its placeholders and the folders made for them are gone', !existsSync(folder), folder);
    const gone = await waitFor('series gone', async () => ((await byTmdb(call, userId, 'Series', seriesTmdb)).length === 0 ? true : null), 480);
    record(label, 'Jellyfin drops the series', !!gone);
    await sleep(15000);
    const backfilled = ((await call('GET', `/JellyfinMod/Entries?mediaType=series&targetLibraryId=${showsLibrary}&limit=200`)).json?.items ?? [])
        .filter(entry => entry.tmdbId === seriesTmdb);
    record(label, 'nothing is backfilled for it', backfilled.length === 0, backfilled.map(entry => entry.title));
    record(label, 'the unreleased movie is removed', (await call('DELETE', `/JellyfinMod/Entries/${unreleased.id}`)).status === 204);
    // An Add removed at once: its placeholder may be in the middle of being written.
    const cancelled = await addEntry(call, 'movie', cancelTmdb, moviesLibrary);
    const cancel = cancelled && await call('DELETE', `/JellyfinMod/Entries/${cancelled.id}`);
    record(label, 'an Add removed at once is removed', cancel?.status === 204, cancel?.status);
    await sleep(10000);
    const left = hostRoot ? readdirSync(join(hostRoot, 'movies-w')).filter(name => name.includes(`[tmdbid-${cancelTmdb}]`)) : [];
    const plan = (await call('GET', `/JellyfinMod/Placeholders/${moviesLibrary}/Plan`)).json;
    record(label, 'it leaves no placeholder or folder behind', left.length === 0 && !(plan?.writes ?? []).some(write => write.path.includes(`[tmdbid-${cancelTmdb}]`)), left);
    await sleep(70000);
    record(label, 'and Jellyfin holds no item for it', (await byTmdb(call, userId, 'Movie', cancelTmdb)).length === 0);
}

const admin = await signInApi('oleksii');
const ordinary = ordinaryUser ? await signInApi(ordinaryUser) : null;
const context = await apiChecks(admin, ordinary);
if (context) {
    const browser = await chromium.launch(tier === 'chrome' ? { headless: true, channel: 'chrome' } : { headless: true });
    try {
        for (const layout of layouts) {
            await browserChecks(browser, layout, 'oleksii', true, context);
            if (ordinaryUser) await browserChecks(browser, layout, ordinaryUser, false, context);
        }
    } finally {
        await browser.close();
    }
    if (removeAtEnd) await removeChecks(admin, context);
    else record('remove', 'removal', 'NOT VERIFIED', 'JELLYFINMOD_PT_REMOVE not set');
    if (hostRoot && sample) await swapChecks(admin, context);
    else record('swap', 'the swap and the user-data cache', 'NOT VERIFIED', 'JELLYFINMOD_PT_HOST_ROOT and JELLYFINMOD_PT_SAMPLE not set (local environments only)');
}
const failed = results.filter(result => result.verdict === 'FAIL').length;
console.log(`${results.length} checks, ${failed} failed (${tier})`);
process.exitCode = failed ? 1 : 0;
/* eslint-enable compat/compat, no-restricted-globals, @stylistic/max-statements-per-line, no-empty-function, sonarjs/cognitive-complexity */
