// Phase 9 inline ratings — design preview on the development machine (2026-10-08).
//
// NOT acceptance evidence. There is no Jellyfin here: a small local server serves a built bundle (dist/) and answers the
// handful of Jellyfin and JellyfinMod reads the detail pages and a browse grid make, from fixed fixture data. The pages,
// their CSS, upstream's detail controller, focus handling and the ratings components are the real built code; the answers
// are not. It exists to show the design and to iterate on it without an instance; the same checks run against the isolated
// instance (p9-ratings.mjs) before acceptance. Nothing here reaches any other host: every request that is not to the local
// server is blocked and counted, and the run fails if there is one.
//
//   JFMOD_DIST=<built dist/> JFMOD_DESIGN_SHOTS=<folder> [JELLYFINMOD_BROWSER=chromium|chrome] [JFMOD_DESIGN_CHECKS=0] node p9-design.mjs
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const DIST = process.env.JFMOD_DIST;
if (!DIST) throw new Error('Set JFMOD_DIST to a built dist/ folder');
const SHOTS = process.env.JFMOD_DESIGN_SHOTS;
const CHECKS = process.env.JFMOD_DESIGN_CHECKS !== '0';
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
const LABEL = process.env.JFMOD_DESIGN_LABEL ?? 'after';

const SERVER_ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const USER_ID = '0123456789abcdef0123456789abcdef';
const SERIES_ID = '5e1e5e1e5e1e5e1e5e1e5e1e5e1e5e1e';
const MOVIE_ID = '30f130f130f130f130f130f130f130f1';
const ROTTEN_ID = '40f140f140f140f140f140f140f140f1';
const ENTRY_ID = 'e0e0e0e0-0000-4000-8000-00000000e0e0';
const MOVIES_VIEW = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SHOWS_VIEW = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const recent = new Date(Date.now() - 3 * 86400000).toISOString();
const old = new Date(Date.now() - 40 * 86400000).toISOString();

const mdb = (source, value, scale, votes, extra = {}) => ({ source, value, scale, votes, provider: 'mdblist', fetchedAt: recent, stale: false, ...extra });
// The user's screenshot of 2026-10-08 (a series page): IMDb 8.3, RT critics 94 %, RT audience 55 %, TMDB 83 %, Trakt 83 %.
const RATINGS = {
    [SERIES_ID]: [mdb('imdb', 8.3, 'ten', 108000), mdb('tomatoes_critic', 94, 'percent', 56), mdb('tomatoes_audience', 55, 'percent', null),
        mdb('tmdb', 83, 'percent', 866), mdb('trakt', 83, 'percent', 5700)],
    // A movie whose stock star and tomato show the same values as IMDb and RT critics, a stale Trakt value, and the sources
    // that are off by default.
    [MOVIE_ID]: [mdb('imdb', 8.1, 'ten', 250000), mdb('tomatoes_critic', 91, 'percent', 310), mdb('tomatoes_audience', 88, 'percent', 25000),
        { source: 'tmdb', value: 7.8, scale: 'ten', votes: 1234, provider: 'tmdb', fetchedAt: null, stale: false },
        mdb('trakt', 83, 'percent', 21000, { fetchedAt: old, stale: true }), mdb('metacritic', 74, 'percent', 52),
        mdb('metacritic_user', 8.4, 'ten', 1300), mdb('letterboxd', 4.1, 'five', 90000), mdb('rogerebert', 3.5, 'four', null)],
    // Rotten on both counts.
    [ROTTEN_ID]: [mdb('imdb', 5.2, 'ten', 41000), mdb('tomatoes_critic', 42, 'percent', 120), mdb('tomatoes_audience', 38, 'percent', 2500),
        mdb('tmdb', 54, 'percent', 900), mdb('trakt', 51, 'percent', 800)]
};
const ALL = ['imdb', 'tomatoes_critic', 'tomatoes_audience', 'tmdb', 'trakt', 'metacritic', 'metacritic_user', 'letterboxd', 'rogerebert'];
const DEFAULTS = ['imdb', 'tomatoes_critic', 'tomatoes_audience', 'tmdb', 'trakt'];
let userSources = null; // null: the server's defaults
let currentTheme = 'dark';

const user = {
    Name: 'oleksii', ServerId: SERVER_ID, Id: USER_ID, HasPassword: false, HasConfiguredPassword: false, EnableAutoLogin: false,
    Configuration: { PlayDefaultAudioTrack: true, SubtitleMode: 'Default', OrderedViews: [], LatestItemsExcludes: [], MyMediaExcludes: [],
        GroupedFolders: [], HidePlayedInLatest: true, RememberAudioSelections: true, RememberSubtitleSelections: true, EnableNextEpisodeAutoPlay: true },
    Policy: { IsAdministrator: true, IsHidden: false, IsDisabled: false, EnableAllFolders: true, EnableMediaPlayback: true, EnableContentDeletion: false,
        EnableRemoteControlOfOtherUsers: true, EnableSharedDeviceControl: true, EnableLiveTvAccess: false, EnablePublicSharing: false,
        EnableSubtitleManagement: true, EnableLyricManagement: false, AuthenticationProviderId: 'x', PasswordResetProviderId: 'x', BlockedTags: [],
        AllowedTags: [], EnableUserPreferenceAccess: true, AccessSchedules: [], BlockUnratedItems: [], EnabledDevices: [], EnabledChannels: [],
        EnabledFolders: [], EnableAllDevices: true, EnableAllChannels: true, SyncPlayAccess: 'None' }
};
const stream = (type, index, extra) => ({ Type: type, Index: index, IsDefault: index === 0 || type === 'Audio', IsExternal: false, ...extra });
const mediaSource = id => ({ Id: id, Protocol: 'File', Type: 'Default', Container: 'mkv', Name: 'Design', IsRemote: false, RunTimeTicks: 81000000000,
    SupportsDirectPlay: true, SupportsDirectStream: true, SupportsTranscoding: true, MediaStreams: [
        stream('Video', 0, { Codec: 'hevc', Width: 3840, Height: 2160, DisplayTitle: '4K HEVC', VideoRange: 'SDR', VideoRangeType: 'SDR' }),
        stream('Audio', 1, { Codec: 'eac3', Language: 'eng', DisplayTitle: 'English - Dolby Digital+ - 5.1', Channels: 6 }),
        stream('Subtitle', 2, { Codec: 'subrip', Language: 'eng', DisplayTitle: 'English - SUBRIP' })
    ], DefaultAudioStreamIndex: 1 });
const base = (id, name, type) => ({ Id: id, Name: name, ServerId: SERVER_ID, Type: type, ImageTags: {}, BackdropImageTags: [], UserData: {
    PlaybackPositionTicks: 0, PlayCount: 0, IsFavorite: false, Played: false, Key: id }, LocationType: 'FileSystem', CanDelete: false,
CanDownload: false, People: [], Studios: [], GenreItems: [{ Name: 'Drama', Id: 'g1' }], Genres: ['Drama'], Taglines: [], ProviderIds: { Tmdb: '1' },
RemoteTrailers: [], ExternalUrls: [] });
const ITEMS = {
    [SERIES_ID]: { ...base(SERIES_ID, 'JellyfinMod Design Series', 'Series'), ProductionYear: 2022, PremiereDate: '2022-12-18T00:00:00Z',
        EndDate: '2025-04-06T00:00:00Z', Status: 'Ended', OfficialRating: 'TV-MA', CommunityRating: 8.3, IsFolder: true, ChildCount: 2,
        Overview: 'A fixture series for the ratings design preview.', MediaType: 'Unknown', ParentId: SHOWS_VIEW },
    [MOVIE_ID]: { ...base(MOVIE_ID, 'JellyfinMod Design Movie', 'Movie'), ProductionYear: 2024, PremiereDate: '2024-05-01T00:00:00Z',
        OfficialRating: 'PG-13', CommunityRating: 8.1, CriticRating: 91, RunTimeTicks: 81000000000, IsFolder: false, MediaType: 'Video',
        Overview: 'A fixture movie whose stock star and tomato match IMDb and RT critics.', Path: '/media/movies/design.mkv',
        MediaSources: [mediaSource(MOVIE_ID)], MediaStreams: mediaSource(MOVIE_ID).MediaStreams, ParentId: MOVIES_VIEW, HasSubtitles: true },
    [ROTTEN_ID]: { ...base(ROTTEN_ID, 'JellyfinMod Design Rotten', 'Movie'), ProductionYear: 2023, PremiereDate: '2023-02-01T00:00:00Z',
        OfficialRating: 'R', CommunityRating: 5.6, CriticRating: 42, RunTimeTicks: 64000000000, IsFolder: false, MediaType: 'Video',
        Overview: 'A fixture movie with rotten scores.', Path: '/media/movies/rotten.mkv', MediaSources: [mediaSource(ROTTEN_ID)],
        MediaStreams: mediaSource(ROTTEN_ID).MediaStreams, ParentId: MOVIES_VIEW }
};
const views = [
    { ...base(MOVIES_VIEW, 'Movies', 'CollectionFolder'), CollectionType: 'movies', IsFolder: true },
    { ...base(SHOWS_VIEW, 'Shows', 'CollectionFolder'), CollectionType: 'tvshows', IsFolder: true }
];
const seasons = [1, 2].map(number => ({ ...base('5ea5' + number + '0'.repeat(27), 'Season ' + number, 'Season'), IndexNumber: number,
    SeriesId: SERIES_ID, SeriesName: ITEMS[SERIES_ID].Name, IsFolder: true }));
const entry = {
    id: ENTRY_ID, mediaType: 'movie', tmdbId: 4242, imdbId: 'tt4242', title: 'JellyfinMod Design Entry', year: 2026,
    overview: 'A file-less catalog entry for the ratings design preview.', posterPath: null, retentionPolicy: 'inherit', state: 'none',
    monitored: true, jellyfinItemId: null, targetLibraryId: MOVIES_VIEW, addedAt: recent, metadata: { mediaType: 'movie', tmdbId: 4242,
        title: 'JellyfinMod Design Entry', premiereDate: '2026-03-01', overview: null, posterPath: null, backdropPath: null, imdbId: 'tt4242',
        tvdbId: null, adult: false, communityRating: 7.8, voteCount: 1234, runtimeMinutes: 118, genres: ['Drama'], certifications: [], seasons: [] }
};
const bound = (itemId, suffix) => ({ ...entry, id: ENTRY_ID.slice(0, -2) + suffix, title: ITEMS[itemId].Name, year: ITEMS[itemId].ProductionYear,
    state: 'onDisk', jellyfinItemId: itemId });
const entryRatings = [mdb('imdb', 7.9, 'ten', 18000), mdb('tomatoes_critic', 72, 'percent', 85), mdb('tomatoes_audience', 64, 'percent', 900),
    { source: 'tmdb', value: 7.8, scale: 'ten', votes: 1234, provider: 'tmdb', fetchedAt: null, stale: false }, mdb('trakt', 76, 'percent', 400)];

const json = (response, status, body) => {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(body === undefined ? '' : JSON.stringify(body));
};
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
    '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.gif': 'image/gif' };
const unknown = new Set();

const api = (method, path, query) => {
    const p = path.toLowerCase();
    if (p === '/system/info/public' || p === '/system/info') {
        return { Id: SERVER_ID, ServerName: 'design', Version: '12.0.0', ProductName: 'Jellyfin Server', LocalAddress: 'http://127.0.0.1', StartupWizardCompleted: true, OperatingSystem: 'Linux' };
    }
    if (p === '/users/authenticatebyname') return { User: user, AccessToken: 'design-preview', ServerId: SERVER_ID, SessionInfo: { Id: 's', UserId: USER_ID } };
    if (p === '/users/public') return [];
    if (p === '/users/me' || p === '/users/' + USER_ID) return user;
    if (p.endsWith('/ancestors') || p === '/syncplay/list') return [];
    if (p === '/system/endpoint') return { IsLocal: true, IsInNetwork: true };
    if (p === '/playback/bitratetest') return '';
    if (p === '/users') return [user];
    if (p.startsWith('/displaypreferences/')) {
        const prefs = {};
        if (userSources) prefs.jfmodRatingsSources = JSON.stringify(userSources);
        prefs.appTheme = currentTheme;
        if (query.get('client') === 'emby') prefs.jfmodRatingsCardSource = 'imdb';
        return { Id: path.split('/').pop(), SortBy: 'SortName', SortOrder: 'Ascending', RememberIndexing: false, RememberSorting: false,
            ShowBackdrop: true, ShowSidebar: false, ScrollDirection: 'Horizontal', IndexBy: null, PrimaryImageHeight: 250, PrimaryImageWidth: 250,
            CustomPrefs: prefs, Client: query.get('client') ?? 'emby' };
    }
    if (p === '/userviews' || p === `/users/${USER_ID}/views`) return { Items: views, TotalRecordCount: views.length, StartIndex: 0 };
    for (const id of Object.keys(ITEMS)) {
        if (p === `/users/${USER_ID}/items/${id}` || p === `/items/${id}`) return ITEMS[id];
        if (p === `/items/${id}/similar` || p === `/items/${id}/specialfeatures` || p === `/items/${id}/localtrailers`) return p.endsWith('similar') ? { Items: [], TotalRecordCount: 0 } : [];
        if (p === `/items/${id}/thememedia`) return { ThemeVideosResult: { Items: [] }, ThemeSongsResult: { Items: [] }, SoundtrackSongsResult: { Items: [] } };
        if (p === `/jellyfinmod/ratings/items/${id}`) return { entryId: null, ratings: RATINGS[id] };
        if (p === `/items/${id}/playbackinfo`) return { MediaSources: ITEMS[id].MediaSources ?? [] };
    }
    if (p === `/shows/${SERIES_ID}/seasons`) return { Items: seasons, TotalRecordCount: seasons.length };
    if (p.startsWith('/shows/') && p.endsWith('/nextup')) return { Items: [], TotalRecordCount: 0 };
    if (p === '/jellyfinmod/health') {
        return { Name: 'JellyfinMod', Version: '0.1.0.0', Ok: true, Capabilities: ['ratings', 'ratings.cards', 'settings.ratings'], Trakt: { Installed: false } };
    }
    if (p === '/jellyfinmod/ratings/defaults') return { enabled: true, defaultSources: DEFAULTS, availableSources: ALL, refreshDays: 14 };
    if (p === '/jellyfinmod/entries') return { items: [], totalRecordCount: 0 };
    if (p === `/jellyfinmod/entries/${ENTRY_ID}`) {
        return { entry, ratings: entryRatings, history: [], episodes: [], retention: { enabled: false, policy: 'inherit', state: 'disabled', reason: 'disabled', deadline: null }, acquisition: null, versions: [], upgrade: null, retentionWarning: null };
    }
    if (p === '/jellyfinmod/browse' && method === 'POST') {
        // The combined grid: two native movies (one with a value past the refresh window) and the file-less entry.
        const rows = [
            // An on-disk title has its entry (the backfill makes one for every native movie); its card is upstream's card.
            { kind: 'native', nativeItem: ITEMS[MOVIE_ID], entry: bound(MOVIE_ID, 'a1'), rating: RATINGS[MOVIE_ID][0] },
            { kind: 'native', nativeItem: ITEMS[ROTTEN_ID], entry: bound(ROTTEN_ID, 'a2'), rating: { ...RATINGS[ROTTEN_ID][0], fetchedAt: old, stale: true } },
            { kind: 'entry', entry, rating: entryRatings[0] }
        ];
        return { items: rows, totalRecordCount: rows.length, hasCatalogEntries: true };
    }
    if (p.startsWith('/jellyfinmod/')) return undefined;
    if (method === 'POST' || method === 'DELETE') return null;
    if (p.startsWith('/items') || p.startsWith('/useritems') || p.startsWith('/users/') || p.startsWith('/shows/') || p.startsWith('/persons') || p.startsWith('/studios')
        || p.startsWith('/genres') || p.startsWith('/livetv') || p.startsWith('/channels')) {
        return { Items: [], TotalRecordCount: 0, StartIndex: 0 };
    }
    if (p === '/branding/configuration') return { LoginDisclaimer: '', CustomCss: '', SplashscreenEnabled: false };
    if (p === '/branding/css' || p === '/branding/css.css') return '';
    if (p === '/quickconnect/enabled') return false;
    if (p === '/plugins' || p === '/packages' || p === '/sessions' || p === '/scheduledtasks') return [];
    if (p === '/system/configuration') return { EnableFolderView: false, DisplaySpecialsWithinSeasons: true, EnableGroupingIntoCollections: false };
    if (p.startsWith('/localization/')) return [];
    unknown.add(method + ' ' + path);
    return undefined;
};

const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    let path = url.pathname;
    if (path === '/' || path === '/web-mod') {
        response.writeHead(302, { Location: '/web-mod/' });
        response.end();
        return;
    }
    // The mod interface's document, as the plugin serves it on an instance (P7.S2).
    if (path.startsWith('/web-mod/')) {
        const relative = normalize(decodeURIComponent(path.slice(9)) || 'jellyfinmod.html');
        if (relative.startsWith('..')) return json(response, 400);
        const file = join(DIST, relative === '.' || relative === 'index.html' ? 'jellyfinmod.html' : relative);
        try {
            if (statSync(file).isFile()) {
                response.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
                response.end(readFileSync(file));
                return;
            }
        } catch { /* falls through */ }
        return json(response, 404);
    }
    if (path.toLowerCase().startsWith('/items/') && path.toLowerCase().includes('/images/')) return json(response, 404);
    if (path === '/socket') return json(response, 404);
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
        path = path.replace(/\/+$/, '');
        const answer = api(request.method, path, url.searchParams);
        if (process.env.JFMOD_DESIGN_DEBUG) console.log(`  ${request.method} ${path}${url.search} -> ${answer === undefined ? 404 : Array.isArray(answer) ? 'array' : typeof answer}`);
        if (answer === undefined) return json(response, 404, { title: 'Not in the design fixtures' });
        if (answer === null) return json(response, 204);
        if (typeof answer === 'string') {
            response.writeHead(200, { 'Content-Type': 'text/css' });
            return response.end(answer);
        }
        return json(response, 200, answer);
    });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

const results = [];
const check = (name, ok, detail) => {
    results.push({ name, ok, detail });
    console.log(`${ok ? 'ok' : 'FAIL'} - ${name}${!ok && detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''}`);
};
const external = [];
const iconRequests = [];
const browser = await chromium.launch(tier === 'chrome' ? { channel: 'chrome', headless: true } : { headless: true });
console.log(`browser: ${tier} ${browser.version()}`);

const LAYOUTS = {
    desktop: { viewport: { width: 1440, height: 900 }, layout: 'desktop' },
    mobile: { viewport: { width: 390, height: 844 }, layout: 'mobile', isMobile: true, hasTouch: true },
    tv1080: { viewport: { width: 1920, height: 1080 }, layout: 'tv' },
    tv720: { viewport: { width: 1280, height: 720 }, layout: 'tv' }
};

const open = async (layoutName, theme = 'dark') => {
    const layout = LAYOUTS[layoutName];
    currentTheme = theme;
    const context = await browser.newContext({ viewport: layout.viewport, isMobile: layout.isMobile, hasTouch: layout.hasTouch,
        deviceScaleFactor: 1, colorScheme: theme === 'light' ? 'light' : 'dark' });
    await context.route('**/*', route => {
        const url = route.request().url();
        if (!url.startsWith(ORIGIN)) {
            external.push(url);
            return route.abort();
        }
        if (/\.(svg|png|webp|jpg)(\?|$)/i.test(url) && /rating|tomato|imdb|trakt|tmdb|popcorn|letterboxd|metacritic/i.test(url)) iconRequests.push(url);
        return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => console.log(`[${layoutName}] page error: ${error.message}`));
    page.on('console', message => {
        if (message.type() === 'error' && process.env.JFMOD_DESIGN_DEBUG) console.log(`[${layoutName}] console: ${message.text().slice(0, 300)}`);
    });
    await page.goto(ORIGIN + '/web-mod/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(([layoutValue, themeValue, userId]) => {
        localStorage.setItem('layout', layoutValue);
        localStorage.setItem(userId + '-appTheme', themeValue);
        localStorage.setItem('appTheme', themeValue);
    }, [layout.layout, theme, USER_ID]);
    // A hash change alone does not reload; the layout and theme are read at start-up.
    await page.goto(ORIGIN + '/web-mod/#/login', { waitUntil: 'domcontentloaded' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    // Manual sign-in as oleksii, empty password (the fixture server accepts it).
    const manual = page.locator('.btnManual');
    await page.locator('#txtManualName, .btnManual').first().waitFor({ timeout: 30000 });
    if (await manual.isVisible().catch(() => false)) await manual.click();
    await page.locator('#txtManualName').fill('oleksii');
    await page.locator('.manualLoginForm .button-submit').click();
    await page.waitForFunction(() => !location.hash.includes('login'), null, { timeout: 30000 });
    return { context, page };
};

const detail = async (page, id) => {
    await page.goto(`${ORIGIN}/web-mod/#/details?id=${id}&serverId=${SERVER_ID}`, { waitUntil: 'domcontentloaded' });
    try {
        await page.locator('.itemMiscInfo-primary:visible').waitFor({ timeout: 30000 });
        // The ratings: inline marks after the change, the chip line before it.
        await page.locator('.jfmod-rating:visible, .jfmod-ratingChip:visible').first().waitFor({ timeout: 30000 });
    } catch (error) {
        if (SHOTS) await page.screenshot({ path: join(SHOTS, 'debug-detail.png') });
        console.log('fixture server had no answer for: ' + [...unknown].join(', '));
        throw error;
    }
    await page.waitForTimeout(1200);
};

const shot = async (page, name) => {
    if (!SHOTS) return;
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, `${LABEL}-${name}.png`) });
};

const rowSources = page => page.locator('.itemMiscInfo-primary:visible .jfmod-rating')
    .evaluateAll(nodes => nodes.map(node => node.getAttribute('data-jfmod-rating')));

for (const theme of ['dark', 'light']) {
    for (const layoutName of Object.keys(LAYOUTS)) {
        const { context, page } = await open(layoutName, theme);
        try {
            await detail(page, SERIES_ID);
            await shot(page, `series-${layoutName}-${theme}`);
            if (theme !== 'dark') continue;
            await detail(page, MOVIE_ID);
            await shot(page, `movie-${layoutName}-${theme}`);
            await page.goto(`${ORIGIN}/web-mod/#/movies?topParentId=${MOVIES_VIEW}&collectionType=movies`, { waitUntil: 'domcontentloaded' });
            await page.locator('.jfmod-cardRating:visible').first().waitFor({ timeout: 30000 }).catch(() => undefined);
            await page.waitForTimeout(800);
            await shot(page, `cards-${layoutName}-${theme}`);
            if (LABEL === 'after' && CHECKS) {
                const cards = await page.locator('.jfmod-cardRating:visible').evaluateAll(nodes => nodes.map(node => ({
                    icon: node.querySelector('svg.jfmod-ratingIcon')?.getAttribute('data-jfmod-icon') ?? null, text: node.textContent.trim(),
                    title: node.getAttribute('title') ?? node.closest('[title]')?.getAttribute('title') ?? null,
                    focusable: !!node.querySelector('button, a, [tabindex]') })));
                check(`${layoutName}: cards show the chosen source's mark and value, with no tooltip or focus stop of their own`,
                    cards.length === 3 && cards.every(card => card.icon === 'imdb' && /\d/.test(card.text) && !card.title && !card.focusable)
                        && cards.some(card => /\(\w+ \d{4}\)/.test(card.text)), cards);
            }
            await detail(page, MOVIE_ID);
            if (LABEL !== 'after' || !CHECKS) continue;
            const tv = layoutName.startsWith('tv');
            const row = page.locator('.itemMiscInfo-primary:visible');
            const sources = await rowSources(page);
            // A TV's focus is already on Play when the answer arrives: the row shows as many of the user's first ratings as fit
            // without wrapping (a 1280×720 TV with a long movie row fits four); everywhere else, all of them.
            const fitted = layoutName === 'tv720';
            check(`${layoutName}: the ratings sit in the stock star's row, in the default order${fitted ? ' (as many as fit)' : ''}`,
                fitted ? sources.length >= 3 && DEFAULTS.join(',').startsWith(sources.join(',')) : sources.join(',') === DEFAULTS.join(','), sources);
            if (fitted) {
                const lines = await row.evaluate(node => new Set([...node.children].filter(child => child.offsetParent).map(child =>
                    Math.round(child.getBoundingClientRect().top + child.getBoundingClientRect().height / 2))).size);
                check(`${layoutName}: the row stays on one line`, lines === 1, lines);
            }
            const icons = await row.locator('.jfmod-rating svg.jfmod-ratingIcon').evaluateAll(nodes => nodes.map(node => ({
                kind: node.getAttribute('data-jfmod-icon'), width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })));
            check(`${layoutName}: each rating renders its inline mark`, icons.length === sources.length && icons.every(icon => icon.width > 4 && icon.height > 8), icons);
            check(`${layoutName}: vote counts are not in the row`, !/\(\d|K\)|votes/.test(await row.innerText()), await row.innerText());
            check(`${layoutName}: the stock star and tomato that repeat IMDb 8.1 and RT 91 are hidden`,
                await row.evaluate(node => node.classList.contains('jfmod-ratings-hideStar') && node.classList.contains('jfmod-ratings-hideCritic')
                    && getComputedStyle(node.querySelector('.starRatingContainer')).display === 'none'));
            if (sources.includes('trakt')) {
                check(`${layoutName}: the stale Trakt value is dimmed`, await row.locator('[data-jfmod-rating="trakt"]').evaluate(node =>
                    node.classList.contains('jfmod-rating-stale') && Number(getComputedStyle(node).opacity) < 0.7));
            }
            if (layoutName === 'desktop') {
                const imdb = row.locator('[data-jfmod-rating="imdb"]');
                await imdb.hover();
                const tip = page.locator('[role="tooltip"].jfmod-ratingTooltip');
                await tip.waitFor({ timeout: 3000 });
                const text = await tip.innerText();
                check('desktop: hovering a rating shows its tooltip with the vote count and provenance',
                    text.includes('250,000 votes') && /via MDBList/i.test(text) && await imdb.getAttribute('aria-describedby') === await tip.getAttribute('id'), text);
                await shot(page, `movie-desktop-hover`);
                await page.mouse.move(5, 5);
                await page.waitForTimeout(200);
                check('desktop: moving away hides it', await tip.count() === 0);
                await row.locator('[data-jfmod-rating="trakt"]').focus();
                await page.keyboard.press('Shift+Tab');
                await page.keyboard.press('Tab');
                const focused = await page.locator('[role="tooltip"].jfmod-ratingTooltip').innerText().catch(() => '');
                check('desktop: keyboard focus shows the same tooltip (stale note included)', focused.includes('21,000 votes') && focused.includes('Older than the refresh window'), focused);
                await page.keyboard.press('Escape');
                await page.waitForTimeout(150);
                check('desktop: Escape closes it', await page.locator('[role="tooltip"]').count() === 0);
                const anchors = await row.locator('a').count();
                check('desktop: the row has no links', anchors === 0, anchors);
            }
            if (layoutName === 'mobile') {
                await row.locator('[data-jfmod-rating="tomatoes_critic"]').tap();
                const tip = page.locator('[role="tooltip"].jfmod-ratingTooltip');
                await tip.waitFor({ timeout: 3000 });
                const text = await tip.innerText();
                check('mobile: a tap shows the tooltip with the vote count', text.includes('310 votes'), text);
                await shot(page, `movie-mobile-tap`);
                await page.locator('.nameContainer:visible').tap();
                await page.waitForTimeout(200);
                check('mobile: a tap elsewhere closes it', await tip.count() === 0);
                const size = await row.locator('[data-jfmod-rating="imdb"]').evaluate(node => node.getBoundingClientRect().height);
                check('mobile: each rating is a full touch target (about 44 px)', size >= 40, size);
            }
            if (tv) {
                const focusedClass = () => page.evaluate(() => document.activeElement?.className ?? '');
                await page.waitForTimeout(600);
                check(`${layoutName}: the first focus is Play, not a rating`, /btnPlay|btnResume/.test(await focusedClass()), await focusedClass());
                const playBox = await page.locator('.mainDetailButtons:visible .btnPlay').boundingBox();
                await page.keyboard.press('ArrowUp');
                await page.waitForTimeout(300);
                const up = await page.evaluate(() => document.activeElement?.getAttribute('data-jfmod-rating'));
                check(`${layoutName}: Up from the buttons reaches a rating`, !!up, up);
                await page.keyboard.press('ArrowRight');
                await page.waitForTimeout(200);
                const right = await page.evaluate(() => document.activeElement?.getAttribute('data-jfmod-rating'));
                check(`${layoutName}: Right moves to the next rating`, !!right && right !== up, { up, right });
                await page.keyboard.press('Enter');
                const tip = page.locator('[role="tooltip"].jfmod-ratingTooltip');
                await tip.waitFor({ timeout: 3000 });
                check(`${layoutName}: OK shows the tooltip with the vote count`, /votes/.test(await tip.innerText()), await tip.innerText());
                await shot(page, `movie-${layoutName}-ok`);
                const hash = await page.evaluate(() => location.hash);
                await page.keyboard.press('Escape');
                await page.waitForTimeout(500);
                check(`${layoutName}: Back closes only the tooltip and stays on the page`,
                    await tip.count() === 0 && await page.evaluate(() => location.hash) === hash
                        && await page.evaluate(() => document.activeElement?.getAttribute('data-jfmod-rating')) === right);
                const playAfter = await page.locator('.mainDetailButtons:visible .btnPlay').boundingBox();
                // A focused TV button is drawn larger; its centre is where it is.
                const middle = box => box.y + box.height / 2;
                check(`${layoutName}: Play did not move`, playBox && playAfter && Math.abs(middle(playBox) - middle(playAfter)) < 0.5, { playBox, playAfter });
                check(`${layoutName}: no links in the ratings row`, await row.locator('a').count() === 0);
                await page.keyboard.press('ArrowDown');
                await page.waitForTimeout(300);
                check(`${layoutName}: Down returns to the button row`, await page.evaluate(() => !!document.activeElement?.closest('.mainDetailButtons')),
                    await focusedClass());
            }
        } finally {
            await context.close();
        }
    }
}

// The other pages and states, desktop and TV only, after the change.
if (LABEL === 'after') {
    for (const layoutName of ['desktop', 'tv1080', 'mobile']) {
        const { context, page } = await open(layoutName);
        try {
            await detail(page, ROTTEN_ID);
            await shot(page, `rotten-${layoutName}-dark`);
            if (CHECKS) {
                const kinds = await page.locator('.itemMiscInfo-primary:visible .jfmod-ratingIcon')
                    .evaluateAll(nodes => nodes.map(node => node.getAttribute('data-jfmod-icon')));
                check(`${layoutName}: below 60 % the splat and the spilled bucket`, kinds.includes('tomatoesCriticRotten') && kinds.includes('tomatoesAudienceSpilled'), kinds);
            }
            await page.goto(`${ORIGIN}/web-mod/#/details?entryId=${ENTRY_ID}&serverId=${SERVER_ID}`, { waitUntil: 'domcontentloaded' });
            await page.locator('.jfmod-rating').first().waitFor({ timeout: 30000 });
            await page.waitForTimeout(800);
            await shot(page, `entry-${layoutName}-dark`);
            if (CHECKS) {
                const own = page.locator('[data-jfmod-star]');
                check(`${layoutName}: the file-less entry's own star is hidden while TMDB 7.8 shows with its mark`,
                    await own.count() === 1 && !await own.isVisible());
            }
        } finally {
            await context.close();
        }
    }

    // The user's own order and every source.
    userSources = ['letterboxd', 'trakt', 'imdb', 'metacritic', 'metacritic_user', 'rogerebert', 'tomatoes_audience', 'tomatoes_critic', 'tmdb'];
    const { context, page } = await open('desktop');
    try {
        await detail(page, MOVIE_ID);
        await shot(page, 'movie-desktop-all-sources');
        if (CHECKS) check('desktop: the order follows the user\'s preference, with every source', (await rowSources(page)).join(',') === userSources.join(','),
            await rowSources(page));
    } finally {
        await context.close();
        userSources = null;
    }
}

// Upstream's Chromecast support asks Google for its sender script on every page; that is upstream's, blocked here like
// everything else, and the only outside request allowed to have been attempted.
const UPSTREAM_CAST = /^https:\/\/www\.gstatic\.com\/cv\/js\/sender\/v1\/cast_sender\.js/;
const outside = external.filter(url => !UPSTREAM_CAST.test(url));
check(`no request left the machine apart from upstream's cast sender (${external.length - outside.length} of those, all blocked)`,
    outside.length === 0, outside.slice(0, 5));
check('no icon was requested as a file', iconRequests.length === 0, iconRequests);
if (unknown.size) console.log('note - fixture server had no answer for: ' + [...unknown].slice(0, 30).join(', '));
await browser.close();
server.close();
if (process.env.JFMOD_DESIGN_OUT) writeFileSync(process.env.JFMOD_DESIGN_OUT, JSON.stringify({ tier, results }, null, 2));
const failed = results.filter(result => !result.ok).length;
console.log(`${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
