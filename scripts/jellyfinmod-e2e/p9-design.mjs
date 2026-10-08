// Phase 9 ratings group — design preview on the development machine (2026-10-08, user decisions 10 and 13).
//
// NOT acceptance evidence. There is no Jellyfin here: a small local server serves a built bundle (dist/) and answers the
// handful of Jellyfin and JellyfinMod reads the detail pages and a browse grid make, from fixed fixture data. The pages,
// their CSS, upstream's detail controller, focus handling and the ratings components are the real built code; the answers
// are not. It exists to show the design and to iterate on it without an instance; the same checks run against the isolated
// instance (p9-ratings.mjs) before acceptance. Nothing here reaches any other host: every request that is not to the local
// server is blocked and counted, and the run fails if there is one.
//
//   JFMOD_DIST=<built dist/> JFMOD_DESIGN_SHOTS=<folder> [JELLYFINMOD_BROWSER=chromium|chrome] [JFMOD_DESIGN_CHECKS=0]
//     [JFMOD_DESIGN_SHEET=<contact sheet png>] [JFMOD_DESIGN_ONLY=desktop,mobile,tv1080,tv720] [JFMOD_DESIGN_SETTINGS=1] node p9-design.mjs
//
// Every check runs with all nine sources ticked (the server's default answered as all of them), except the fresh-default check
// and the sources unticked in the settings area's checkboxes.
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const DIST = process.env.JFMOD_DIST;
if (!DIST) throw new Error('Set JFMOD_DIST to a built dist/ folder');
const SHOTS = process.env.JFMOD_DESIGN_SHOTS;
const CHECKS = process.env.JFMOD_DESIGN_CHECKS !== '0';
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
const LABEL = process.env.JFMOD_DESIGN_LABEL ?? 'final';
const SERVER_ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const USER_ID = '0123456789abcdef0123456789abcdef';
const SERIES_ID = '5e1e5e1e5e1e5e1e5e1e5e1e5e1e5e1e';
const MOVIE_ID = '30f130f130f130f130f130f130f130f1';
const ROTTEN_ID = '40f140f140f140f140f140f140f140f1';
// A movie MDBList has no IMDb or Rotten Tomatoes value for: Jellyfin's own star and tomato stay (user decision 10).
const STOCK_ID = '57c057c057c057c057c057c057c057c0';
// A movie whose row is longer ("Not Rated", a longer runtime): on a 1280×720 TV Trakt gives way there (user decision 13).
const LONG_ID = '10c010c010c010c010c010c010c010c0';
const ENTRY_ID = 'e0e0e0e0-0000-4000-8000-00000000e0e0';
const MOVIES_VIEW = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SHOWS_VIEW = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const recent = new Date(Date.now() - 3 * 86400000).toISOString();
const old = new Date(Date.now() - 40 * 86400000).toISOString();

const mdb = (source, value, scale, votes, extra = {}) => ({ source, value, scale, votes, provider: 'mdblist', fetchedAt: recent, stale: false, ...extra });
// The user's screenshot of 2026-10-08 (a series page): IMDb 8.3, RT critics 94 %, RT audience 55 %, TMDB 83 %, Trakt 83 %.
// With every source ticked the series also carries the four optional sources, with fixture values.
const RATINGS = {
    [SERIES_ID]: [mdb('imdb', 8.3, 'ten', 108000), mdb('tomatoes_critic', 94, 'percent', 56), mdb('tomatoes_audience', 55, 'percent', null),
        mdb('tmdb', 83, 'percent', 866), mdb('trakt', 83, 'percent', 5700), mdb('metacritic', 85, 'percent', 23), mdb('metacritic_user', 8.6, 'ten', 410),
        mdb('letterboxd', 4.3, 'five', 62000), mdb('rogerebert', 3.5, 'four', null)],
    // A movie whose stock star and tomato show the same values as IMDb and RT critics, a stale Trakt value, and the sources
    // that are off by default.
    [MOVIE_ID]: [mdb('imdb', 8.1, 'ten', 250000), mdb('tomatoes_critic', 91, 'percent', 310), mdb('tomatoes_audience', 88, 'percent', 25000),
        { source: 'tmdb', value: 7.8, scale: 'ten', votes: 1234, provider: 'tmdb', fetchedAt: null, stale: false },
        mdb('trakt', 83, 'percent', 21000, { fetchedAt: old, stale: true }), mdb('metacritic', 74, 'percent', 52),
        mdb('metacritic_user', 8.4, 'ten', 1300), mdb('letterboxd', 4.1, 'five', 90000), mdb('rogerebert', 3.5, 'four', null)],
    [LONG_ID]: [mdb('imdb', 7.6, 'ten', 98000), mdb('tomatoes_critic', 88, 'percent', 240), mdb('tomatoes_audience', 79, 'percent', 10000),
        mdb('tmdb', 74, 'percent', 2100), mdb('trakt', 77, 'percent', 6400), mdb('letterboxd', 3.9, 'five', 41000)],
    [STOCK_ID]: [mdb('tmdb', 72, 'percent', 640), mdb('trakt', 74, 'percent', 1900), mdb('letterboxd', 3.6, 'five', 12000)],
    // Rotten on both counts.
    [ROTTEN_ID]: [mdb('imdb', 5.2, 'ten', 41000), mdb('tomatoes_critic', 42, 'percent', 120), mdb('tomatoes_audience', 38, 'percent', 2500),
        mdb('tmdb', 54, 'percent', 900), mdb('trakt', 51, 'percent', 800)]
};
const ALL = ['imdb', 'tomatoes_critic', 'tomatoes_audience', 'tmdb', 'trakt', 'metacritic', 'metacritic_user', 'letterboxd', 'rogerebert'];
// The plugin's own default since user decision 9 (2026-10-08): IMDb, Rotten Tomatoes critics and audience, Trakt.
const FRESH_DEFAULTS = ['imdb', 'tomatoes_critic', 'tomatoes_audience', 'trakt'];
// What the fixture server answers as the administrator's default list; a Settings/Ratings PATCH changes it, as on an instance.
let serverDefaults = ALL;
let serverRevision = 3;
let userSources = null; // null: the server's defaults
let currentTheme = 'dark';
// The fetcher's state the settings area reads (review 2026-10-08, P3 6-7): the run changes it while the page stays open.
const ratingsStatus = {
    enabled: true, apiKeyConfigured: true, blocker: null, breaker: { open: false, until: null, reason: null, consecutiveFailures: 0 },
    budget: { day: new Date().toISOString().slice(0, 10) + 'T00:00:00Z', used: 12, limit: 500 },
    lastRun: { startedAt: recent, finishedAt: recent, fetched: 12, failed: 0, stopReason: null }, entries: 40, entriesWithoutRatings: 3, queued: 0,
    running: null
};
let statusReads = 0;

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
    [LONG_ID]: { ...base(LONG_ID, 'JellyfinMod Design Long', 'Movie'), ProductionYear: 2019, PremiereDate: '2019-03-01T00:00:00Z',
        OfficialRating: 'Not Rated', CommunityRating: 7.6, CriticRating: 88, RunTimeTicks: 121800000000, IsFolder: false, MediaType: 'Video',
        Overview: 'A fixture movie with a longer metadata row.', Path: '/media/movies/long.mkv', MediaSources: [mediaSource(LONG_ID)],
        MediaStreams: mediaSource(LONG_ID).MediaStreams, ParentId: MOVIES_VIEW },
    [STOCK_ID]: { ...base(STOCK_ID, 'JellyfinMod Design Stock', 'Movie'), ProductionYear: 2021, PremiereDate: '2021-09-01T00:00:00Z',
        OfficialRating: 'PG', CommunityRating: 7.2, CriticRating: 78, RunTimeTicks: 70000000000, IsFolder: false, MediaType: 'Video',
        Overview: 'A fixture movie with Jellyfin\'s own star and tomato and no IMDb or Rotten Tomatoes value from MDBList.', Path: '/media/movies/stock.mkv',
        MediaSources: [mediaSource(STOCK_ID)], MediaStreams: mediaSource(STOCK_ID).MediaStreams, ParentId: MOVIES_VIEW },
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

const api = (method, path, query, body) => {
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
        return { Name: 'JellyfinMod', Version: '0.1.0.0', Ok: true, Capabilities: ['ratings', 'ratings.cards', 'settings.ratings', 'settings.overview'], Trakt: { Installed: false } };
    }
    if (p === '/jellyfinmod/settings/overview') return { plugin: { version: '0.1.0.0' }, areas: [], setup: { complete: true, steps: [] } };
    if (p === '/jellyfinmod/settings/ratings') {
        if (method === 'PATCH') {
            // The settings area's save: the ticked sources become the default every page reads (the plugin keeps the order sent).
            const sent = body ? JSON.parse(body) : {};
            if (Array.isArray(sent.defaultSources)) serverDefaults = sent.defaultSources.filter(source => ALL.includes(source));
            serverRevision++;
        }
        return { enabled: true, apiKeyConfigured: true, refreshDays: 14, dailyBudget: 500, defaultSources: serverDefaults, availableSources: ALL,
            verified: true, verifiedAt: recent, providerOverride: false, revision: serverRevision };
    }
    if (p === '/jellyfinmod/ratings/status') {
        statusReads++;
        return ratingsStatus;
    }
    if (p === '/jellyfinmod/ratings/defaults') return { enabled: true, defaultSources: serverDefaults, availableSources: ALL, refreshDays: 14 };
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
        const answer = api(request.method, path, url.searchParams, Buffer.concat(chunks).toString());
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

/** A whole-page picture (the settings area's run). */
const shot = async (page, name) => {
    if (!SHOTS) return;
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, `${LABEL}-${name}.png`) });
};

/** The ratings group's controls and states, read in the page. */
const GROUP = '[data-jfmod-ratings-group]';
const POPUP = '[data-jfmod-ratings-popup]';
const SHOWN_GROUP = `${GROUP}:not(.jfmod-groupButton-standIn)`;

/** A detail page with its ratings group answered (not the reserved stand-in). */
const groupDetail = async (page, url) => {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    try {
        await page.locator('.itemMiscInfo:visible').first().waitFor({ timeout: 30000 });
        await page.locator(SHOWN_GROUP).first().waitFor({ state: 'attached', timeout: 30000 });
    } catch (error) {
        if (SHOTS) await page.screenshot({ path: join(SHOTS, 'debug-detail.png') });
        console.log('fixture server had no answer for: ' + [...unknown].join(', '));
        throw error;
    }
    await page.waitForTimeout(1000);
};
const nativeUrl = id => `${ORIGIN}/web-mod/#/details?id=${id}&serverId=${SERVER_ID}`;
const entryUrl = () => `${ORIGIN}/web-mod/#/details?entryId=${ENTRY_ID}&serverId=${SERVER_ID}`;

/** The row holding the group, as laid out: how many lines, what upstream shows beside it, the group's own box, Play's place. */
const groupState = page => page.evaluate(selector => {
    const button = [...document.querySelectorAll(selector)].find(node => node.getClientRects().length);
    const group = button?.closest('.jfmod-ratingsGroup');
    const row = group?.closest('.itemMiscInfo');
    if (!row) return null;
    const visible = node => node.getClientRects().length > 0 && getComputedStyle(node).display !== 'none';
    const items = [...row.children].filter(visible).map(node => node.getBoundingClientRect()).filter(rect => rect.width > 0).sort((a, b) => a.top - b.top);
    let lines = 0;
    let bottom = -Infinity;
    for (const rect of items) {
        if (rect.top >= bottom - 1) {
            lines++;
            bottom = rect.bottom;
        } else { bottom = Math.max(bottom, rect.bottom); }
    }
    const shown = sel => [...row.querySelectorAll(sel)].some(visible);
    const play = document.querySelector('.mainDetailButtons .btnPlay:not(.hide)')?.getBoundingClientRect();
    const box = group.getBoundingClientRect();
    return {
        lines, rowHeight: Math.round(row.getBoundingClientRect().height * 10) / 10, groupWidth: Math.round(box.width * 10) / 10,
        groupLeft: Math.round(box.left * 10) / 10, stockStar: shown('.starRatingContainer'), stockTomato: shown('.mediaInfoCriticRating'),
        entryStar: shown('.jfmod-entryStar'), standIn: button.classList.contains('jfmod-groupButton-standIn'),
        inline: [...button.querySelectorAll('[data-jfmod-rating]')].map(node => node.getAttribute('data-jfmod-rating')), text: button.innerText.replace(/\s+/g, ' ').trim(),
        focusStops: [...row.querySelectorAll('button, a, [tabindex]')].filter(node => node.tabIndex >= 0 && visible(node)).length,
        links: row.querySelectorAll('a').length, playMiddle: play ? Math.round((play.top + play.height / 2) * 10) / 10 : null,
        focus: document.activeElement?.hasAttribute('data-jfmod-ratings-group') ? 'group' : (document.activeElement?.className ?? '').toString().slice(0, 60),
        buttonHeight: button.getBoundingClientRect().height,
        // The group's width with all its ticked inline sources (Trakt too), as measured at its first paint: the popup's width.
        fullWidth: Number(group.getAttribute('data-jfmod-full-width')) || null,
        // The group inside its row's box (on a phone the row is narrow and the poster sits beside it).
        inRow: (() => {
            const own = row.getBoundingClientRect();
            return box.left >= own.left - 0.5 && box.right <= own.right + 0.5;
        })(),
        // Each mark's drawn size: a mark squeezed to a sliver is a defect even when the value shows.
        marks: [...button.querySelectorAll('svg')].map(svg => Math.round(svg.getBoundingClientRect().width)),
        // The row's own width and what each visible item takes, with its margins (how close the row is to wrapping).
        rowWidth: Math.round(row.getBoundingClientRect().width),
        itemWidths: [...row.children].filter(visible).map(node => {
            const style = getComputedStyle(node);
            return Math.round(node.getBoundingClientRect().width + parseFloat(style.marginLeft) + parseFloat(style.marginRight));
        })
    };
}, GROUP);

/**
 * The popup's ratings, in order: its visible text (without the hidden provenance a screen reader gets), each row's title, its
 * width, whether any row wraps or overflows, and whether it is wholly on screen.
 */
const popupState = async page => {
    const popup = page.locator(POPUP);
    if (!await popup.count()) return { open: false, sources: [], text: '' };
    return popup.evaluate(node => {
        const copy = node.cloneNode(true);
        copy.querySelectorAll('.jfmod-ratingsHidden').forEach(hidden => hidden.remove());
        const rect = node.getBoundingClientRect();
        const rows = [...node.querySelectorAll('[data-jfmod-rating]')];
        // An empty votes cell (no count) has no height.
        const valueHeights = [...node.querySelectorAll('.jfmod-popValue, .jfmod-popVotes')].map(cell => cell.getBoundingClientRect().height).filter(Boolean);
        return {
            open: true, sources: rows.map(row => row.getAttribute('data-jfmod-rating')), text: copy.textContent.replace(/\s+/g, ' ').trim(),
            titles: rows.map(row => row.getAttribute('title') ?? ''), hiddenText: [...node.querySelectorAll('.jfmod-ratingsHidden')].map(hidden => hidden.textContent),
            links: node.querySelectorAll('a').length, width: Math.round(rect.width),
            // One line per row: every value and votes cell one line high, nothing wider than the popup.
            oneLine: valueHeights.every(height => height < 2 * Math.min(...valueHeights)) && node.scrollWidth <= node.clientWidth + 1,
            stale: rows.filter(row => row.classList.contains('jfmod-pop-stale')).map(row => row.getAttribute('data-jfmod-rating')),
            inside: rect.left >= 0 && rect.top >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight
        };
    });
};

/**
 * The popup as user decision 13 has it: rows only (mark, value, votes; no "via …" line, no caveat, no heading or footer),
 * every ticked rating in order, as wide as the row's group with all its sources (on a phone, no wider than the screen allows),
 * no row wrapping, the provenance in each row's title and hidden text.
 */
const popupOk = (pop, state, expected, viewportWidth) => {
    const width = Math.min(state.fullWidth ?? 0, viewportWidth - 16);
    return pop.open && pop.inside && pop.oneLine && pop.links === 0 && pop.sources.join(',') === expected.join(',')
        && !/via|as of|MDBList|differ|Source|Votes/.test(pop.text) && pop.titles.every(title => /via (MDBList, as of|TMDB)/i.test(title))
        && pop.hiddenText.every(text => /via (MDBList|TMDB)/.test(text)) && Math.abs(pop.width - width) <= 1;
};

/** The title's header (name, rows, buttons) and the popup, cropped from the page, for the contact sheet. */
const headerShot = async (page, name) => {
    if (!SHOTS) return;
    mkdirSync(SHOTS, { recursive: true });
    const clip = await page.evaluate(() => {
        const nodes = ['.nameContainer', '.itemMiscInfo', '.mainDetailButtons', '[data-jfmod-ratings-popup]', '.jfmod-entryActions']
            .flatMap(selector => [...document.querySelectorAll(selector)]).filter(node => node.getClientRects().length);
        // Only what is in the viewport and has content (an empty upstream row has no width).
        const rects = nodes.map(node => node.getBoundingClientRect()).filter(rect => rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight);
        const top = Math.max(0, Math.min(...rects.map(rect => rect.top)) - 24);
        const bottom = Math.min(window.innerHeight, Math.max(...rects.map(rect => rect.bottom)) + 24);
        const left = Math.max(0, Math.min(...rects.map(rect => rect.left)) - 24);
        const right = Math.min(window.innerWidth, Math.max(...rects.map(rect => rect.right)) + 24);
        return { x: left, y: top, width: right - left, height: bottom - top };
    });
    await page.screenshot({ path: join(SHOTS, `${LABEL}-${name}.png`), clip });
    shotsTaken.push(name);
};
const shotsTaken = [];

/** The row's sources: IMDb, Rotten Tomatoes critics and audience, each its own mark, then Trakt (when it has room). */
const INLINE = ['imdb', 'tomatoes_critic', 'tomatoes_audience', 'trakt'];

/**
 * Whether Trakt is out of the row only because the row has no room for it (user decision 13): the row's items plus the width
 * Trakt would take (the group's full width less its width now) are more than the row; on a phone, the group with Trakt is
 * wider than the row. IMDb and Rotten Tomatoes are never out.
 */
const traktRule = (state, layoutName) => {
    if (state.inline.includes('trakt')) return true;
    const traktWidth = (state.fullWidth ?? 0) - state.groupWidth;
    if (layoutName === 'mobile') return state.fullWidth > state.rowWidth;
    return traktWidth > 0 && state.itemWidths.reduce((sum, width) => sum + width, 0) + traktWidth > state.rowWidth;
};

/**
 * The ratings group's checks and pictures on every layout, with every source ticked; then, on the desktop, the fresh default
 * and sources unticked in the settings area.
 */
const groupRun = async () => {
    const only = (process.env.JFMOD_DESIGN_ONLY ?? '').split(',').filter(Boolean);
    serverDefaults = ALL;
    for (const layoutName of Object.keys(LAYOUTS).filter(name => !only.length || only.includes(name))) {
        const tv = layoutName.startsWith('tv');
        const { context, page } = await open(layoutName);
        try {
            for (const [name, id] of [['series', SERIES_ID], ['movie', MOVIE_ID], ['long', LONG_ID], ['stock', STOCK_ID]]) {
                if (tv && CHECKS && (name === 'series' || name === 'movie')) {
                    // A late answer: the ratings arrive 5 s after the page (past its 3 s prefetch bound), with Play focused.
                    const pattern = `**/JellyfinMod/Ratings/Items/${id}`;
                    await page.route(pattern, async route => {
                        await new Promise(resolve => setTimeout(resolve, 5000));
                        await route.continue().catch(() => undefined);
                    });
                    await page.goto(`${ORIGIN}/web-mod/#/home`, { waitUntil: 'domcontentloaded' });
                    await page.waitForTimeout(500);
                    await page.goto(nativeUrl(id), { waitUntil: 'domcontentloaded' });
                    await page.waitForFunction(() => document.activeElement?.classList.contains('btnPlay'), null, { timeout: 15000 }).catch(() => undefined);
                    await page.waitForTimeout(300);
                    const early = await groupState(page);
                    await page.locator(SHOWN_GROUP).first().waitFor({ state: 'attached', timeout: 15000 }).catch(() => undefined);
                    await page.waitForTimeout(600);
                    const late = await groupState(page);
                    check(`${layoutName} ${name}: before the answer the space is reserved; the late answer fills it and Play keeps focus and place`,
                        !!early && !!late && early.standIn && !late.standIn && /btnPlay/.test(early.focus) && /btnPlay/.test(late.focus)
                            && early.playMiddle === late.playMiddle && early.rowHeight === late.rowHeight && Math.abs(early.groupWidth - late.groupWidth) < 0.5
                            && early.groupLeft === late.groupLeft,
                        { early, late });
                    await page.unroute(pattern);
                }
                await groupDetail(page, nativeUrl(id));
                const state = await groupState(page);
                await headerShot(page, `${name}-${layoutName}`);
                if (!CHECKS) continue;
                if (name === 'stock') {
                    check(`${layoutName} stock: without IMDb or Rotten Tomatoes values the stock star and tomato stay, the group shows Trakt`,
                        state.stockStar && state.stockTomato && state.inline.join(',') === 'trakt', state);
                    continue;
                }
                check(`${layoutName} ${name}: IMDb, RT critics (tomato) and RT audience (popcorn) inline in place of the stock star and tomato; Trakt too${state.inline.includes('trakt') ? '' : ' — given way, the row has no room'}`,
                    state.inline.filter(source => source !== 'trakt').join(',') === 'imdb,tomatoes_critic,tomatoes_audience' && traktRule(state, layoutName)
                        && !state.stockStar && !state.stockTomato,
                    state);
                check(`${layoutName} ${name}: no votes and no links in the row; the group is the row's one focus stop`,
                    !/votes|\(\d/.test(state.text) && state.links === 0 && state.focusStops === 1, state);
                check(`${layoutName} ${name}: every mark in the row is drawn at its size (none squeezed)`,
                    state.marks.length >= 3 && state.marks.every(width => width >= 12), state.marks);
                if (layoutName !== 'mobile') { check(`${layoutName} ${name}: the row with the group stays on one line`, state.lines === 1, state); } else {
                    check(`mobile ${name}: the group stays inside the phone's narrow row (wrapping inside its own box), clear of the poster`,
                        state.inRow, state);
                }
                if (layoutName !== 'mobile') check(`${layoutName} ${name}: the group stays inside its row`, state.inRow, state);
                const expectedPopup = RATINGS[id].map(rating => rating.source).sort((a, b) => ALL.indexOf(a) - ALL.indexOf(b));
                const viewportWidth = LAYOUTS[layoutName].viewport.width;
                if (name === 'long') {
                    if (layoutName === 'tv720') await headerShot(page, 'long-tv720');
                    continue;
                }
                if (tv) {
                    check(`${layoutName} ${name}: first focus is Play`, /btnPlay/.test(state.focus), state.focus);
                    if (name === 'movie') await headerShot(page, `movie-${layoutName}-play`);
                    await page.keyboard.press('ArrowUp');
                    await page.waitForTimeout(300);
                    const up = await groupState(page);
                    await page.keyboard.press('ArrowRight');
                    await page.waitForTimeout(250);
                    const right = await groupState(page);
                    await page.keyboard.press('ArrowLeft');
                    await page.waitForTimeout(250);
                    check(`${layoutName} ${name}: Up reaches the group, one focus stop (Right leaves it), no popup on focus`,
                        up.focus === 'group' && right.focus !== 'group' && !(await popupState(page)).open, { up: up.focus, right: right.focus });
                    if ((await groupState(page)).focus !== 'group') {
                        await page.locator(GROUP).first().focus();
                    }
                    await page.keyboard.press('Enter');
                    await page.locator(POPUP).waitFor({ timeout: 3000 }).catch(() => undefined);
                    const pop = await popupState(page);
                    if (name === 'movie') await headerShot(page, `movie-${layoutName}-ok`);
                    check(`${layoutName} ${name}: OK opens the popup: one row per ticked rating (mark, value, votes), the group's full width, no row wrapping, provenance only in titles`,
                        popupOk(pop, state, expectedPopup, viewportWidth) && (name === 'series' ? /108K/ : /250K/).test(pop.text)
                            && (name === 'series' || pop.stale.join(',') === 'trakt'),
                        { pop, fullWidth: state.fullWidth });
                    const hash = await page.evaluate(() => location.hash);
                    const playBefore = (await groupState(page)).playMiddle;
                    await page.keyboard.press('Escape');
                    await page.waitForTimeout(500);
                    const afterBack = await groupState(page);
                    check(`${layoutName} ${name}: Back closes only the popup; focus stays on the group, the page stays`,
                        !(await popupState(page)).open && afterBack.focus === 'group' && await page.evaluate(() => location.hash) === hash, afterBack.focus);
                    // Upstream refills the row when it renders the item again (a userdata change, a return to the page):
                    // fillPrimaryMediaInfo replaces the row's content. Done here with upstream's own HTML for the row, with the
                    // group focused.
                    const refill = await page.evaluate(() => new Promise(resolve => {
                        // The page on screen (the app keeps earlier pages in the document, hidden).
                        const row = [...document.querySelectorAll('.detailRibbon .itemMiscInfo-primary')].find(node => node.getClientRects().length);
                        const mount = row.querySelector('.jfmod-ratingsMount');
                        const copy = row.cloneNode(true);
                        copy.querySelector('.jfmod-ratingsMount')?.remove();
                        const index = [...row.children].indexOf(mount);
                        row.innerHTML = copy.innerHTML;
                        requestAnimationFrame(() => resolve({ back: row.contains(mount), index, indexAfter: [...row.children].indexOf(mount),
                            focused: !!document.activeElement?.hasAttribute('data-jfmod-ratings-group') }));
                    }));
                    const afterRefill = await groupState(page);
                    check(`${layoutName} ${name}: an upstream refill of the row puts the group back in its place, focused, same width, one line`,
                        refill.back && refill.index === refill.indexAfter && refill.focused && afterRefill.focus === 'group'
                            && Math.abs(afterRefill.groupWidth - afterBack.groupWidth) < 0.5 && afterRefill.lines === 1 && afterRefill.playMiddle === afterBack.playMiddle
                            && !afterRefill.stockStar && !afterRefill.stockTomato,
                        { refill, afterRefill });
                    await page.keyboard.press('ArrowDown');
                    await page.waitForTimeout(300);
                    const down = await groupState(page);
                    const inButtons = await page.evaluate(() => !!document.activeElement?.closest('.mainDetailButtons'));
                    check(`${layoutName} ${name}: Down returns to the buttons; Play never moved`,
                        inButtons && down.playMiddle === playBefore, { inButtons, playBefore, down });
                    if (name === 'movie') {
                        // With no popup open, Back is the app's: it leaves the page (finding 5). Reached in the app from Home, so the
                        // entry before it is Home (the visits above were loaded at the same address, which Back would return to).
                        await page.evaluate(() => {
                            location.hash = '#/home';
                        });
                        await page.waitForTimeout(1500);
                        await page.evaluate(url => {
                            location.hash = url.slice(url.indexOf('#'));
                        }, nativeUrl(id));
                        await page.locator(SHOWN_GROUP).first().waitFor({ state: 'attached', timeout: 15000 }).catch(() => undefined);
                        await page.waitForFunction(() => document.activeElement?.classList.contains('btnPlay'), null, { timeout: 15000 }).catch(() => undefined);
                        await page.waitForTimeout(500);
                        await page.keyboard.press('ArrowUp');
                        await page.waitForTimeout(250);
                        const before = { focus: (await groupState(page)).focus, popup: (await popupState(page)).open,
                            history: await page.evaluate(() => history.length) };
                        await page.keyboard.press('Escape');
                        await page.waitForTimeout(1200);
                        check(`${layoutName}: with the group focused and no popup open, Back leaves the page as usual`,
                            before.focus === 'group' && !before.popup && /^#\/home/.test(await page.evaluate(() => location.hash)),
                            { before, hash: await page.evaluate(() => location.hash) });
                    }
                } else if (layoutName === 'desktop') {
                    await page.locator(SHOWN_GROUP).first().hover();
                    await page.locator(POPUP).waitFor({ timeout: 3000 }).catch(() => undefined);
                    const pop = await popupState(page);
                    if (name === 'movie') await headerShot(page, 'movie-desktop-hover');
                    if (name === 'series') await headerShot(page, 'series-desktop-hover');
                    check(`desktop ${name}: hovering the group opens the popup: rows of mark, value and votes, as wide as the group with all its sources`,
                        popupOk(pop, state, expectedPopup, viewportWidth), { pop, fullWidth: state.fullWidth });
                    const box = await page.locator(POPUP).boundingBox();
                    if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
                    await page.waitForTimeout(400);
                    const inside = (await popupState(page)).open;
                    await page.mouse.move(2, 2);
                    await page.waitForTimeout(400);
                    check(`desktop ${name}: the popup stays open with the pointer on it and closes when it leaves`, inside && !(await popupState(page)).open,
                        { inside });
                    await page.locator(GROUP).first().focus();
                    await page.waitForTimeout(200);
                    const byKeyboard = (await popupState(page)).open;
                    await page.keyboard.press('Escape');
                    await page.waitForTimeout(200);
                    check(`desktop ${name}: keyboard focus opens it, Escape closes it`, byKeyboard && !(await popupState(page)).open, { byKeyboard });
                    await page.locator('.nameContainer:visible').first().click();
                } else {
                    await page.locator(SHOWN_GROUP).first().tap();
                    await page.locator(POPUP).waitFor({ timeout: 3000 }).catch(() => undefined);
                    const pop = await popupState(page);
                    if (name === 'movie') await headerShot(page, 'movie-mobile-tap');
                    check(`mobile ${name}: a tap opens the popup (rows only, on screen, no row wrapping); the group is a full touch target`,
                        popupOk(pop, state, expectedPopup, viewportWidth) && state.buttonHeight >= 40, { pop, fullWidth: state.fullWidth, height: state.buttonHeight });
                    await page.locator('.nameContainer:visible').first().tap();
                    await page.waitForTimeout(300);
                    check(`mobile ${name}: a tap elsewhere closes it`, !(await popupState(page)).open);
                }
            }
            if (layoutName !== 'tv720') {
                await groupDetail(page, entryUrl());
                const state = await groupState(page);
                await headerShot(page, `entry-${layoutName}`);
                if (CHECKS) {
                    check(`${layoutName} file-less entry: the group in the entry's row, IMDb in place of its own TMDB star`,
                        state.inline.filter(source => source !== 'trakt').join(',') === 'imdb,tomatoes_critic,tomatoes_audience' && traktRule(state, layoutName)
                            && !state.entryStar && (layoutName === 'mobile' || state.lines === 1), state);
                }
            }
        } finally {
            await context.close();
        }
    }
    if (!only.length || only.includes('desktop')) await defaultsAndSettings();
};

/**
 * On the desktop: a fresh server's default (IMDb, RT critics and audience, Trakt; user decision 9) shows only those, inline
 * and in the popup; and a source unticked in the settings area's checkboxes is gone from both, with RT down to one number.
 */
const defaultsAndSettings = async () => {
    const { context, page } = await open('desktop');
    try {
        serverDefaults = FRESH_DEFAULTS;
        await groupDetail(page, nativeUrl(SERIES_ID));
        let state = await groupState(page);
        await page.locator(SHOWN_GROUP).first().hover();
        await page.locator(POPUP).waitFor({ timeout: 3000 }).catch(() => undefined);
        let pop = await popupState(page);
        await headerShot(page, 'series-desktop-fresh-defaults');
        await page.mouse.move(2, 2);
        if (CHECKS) {
            check('fresh default: only IMDb, RT critics, RT audience and Trakt — inline and in the popup (TMDB and the rest off)',
                state.inline.join(',') === INLINE.join(',') && pop.sources.join(',') === FRESH_DEFAULTS.join(','), { state, pop });
        }
        // The settings area's checkboxes: every source ticked, then Trakt, RT audience and TMDB unticked and saved.
        serverDefaults = ALL;
        await page.goto(`${ORIGIN}/web-mod/#/catalog/settings?section=ratings`, { waitUntil: 'domcontentloaded' });
        const section = page.locator('section[data-section="ratings"]');
        await section.waitFor({ timeout: 30000 });
        await page.waitForTimeout(800);
        if (SHOTS) {
            serverDefaults = FRESH_DEFAULTS;
            await page.reload({ waitUntil: 'domcontentloaded' });
            await section.waitFor({ timeout: 30000 });
            await page.waitForTimeout(800);
            const group = section.locator('.jfmod-group').filter({ has: page.locator('[data-jfmod-default-source]') });
            await group.scrollIntoViewIfNeeded();
            await group.screenshot({ path: join(SHOTS, '..', 'settings-checkboxes.png') });
            const ticked = await section.locator('[data-jfmod-default-source]').evaluateAll(rows => rows
                .filter(row => row.querySelector('input[type="checkbox"]')?.checked).map(row => row.getAttribute('data-jfmod-default-source')));
            if (CHECKS) {
                check('settings: one checkbox per source; a fresh server ticks IMDb, RT critics, RT audience and Trakt', ticked.join(',') === FRESH_DEFAULTS.join(',')
                && await section.locator('[data-jfmod-default-source] input[type="checkbox"]').count() === ALL.length, ticked);
            }
            serverDefaults = ALL;
            await page.reload({ waitUntil: 'domcontentloaded' });
            await section.waitFor({ timeout: 30000 });
            await page.waitForTimeout(800);
        }
        for (const source of ['trakt', 'tomatoes_audience', 'tmdb']) await section.locator(`[data-jfmod-default-source="${source}"] input[type="checkbox"]`).click();
        await section.locator('[data-submit="ratings"]').click();
        await page.waitForFunction(() => /Saved/.test(document.querySelector('section[data-section="ratings"]')?.textContent ?? ''), null, { timeout: 10000 })
            .catch(() => undefined);
        const saved = serverDefaults.join(',');
        await groupDetail(page, nativeUrl(MOVIE_ID));
        state = await groupState(page);
        await page.locator(SHOWN_GROUP).first().hover();
        await page.locator(POPUP).waitFor({ timeout: 3000 }).catch(() => undefined);
        pop = await popupState(page);
        await headerShot(page, 'movie-desktop-unticked');
        await page.mouse.move(2, 2);
        if (CHECKS) {
            const gone = ['trakt', 'tomatoes_audience', 'tmdb'];
            check(`unticked in the settings area (Trakt, RT audience, TMDB): gone inline and from the popup; RT shows one number`,
                saved === ALL.filter(source => !gone.includes(source)).join(',') && !state.inline.some(source => gone.includes(source))
                    && !pop.sources.some(source => gone.includes(source)) && pop.sources.length === ALL.length - gone.length
                    && state.inline.join(',') === 'imdb,tomatoes_critic' && !state.text.includes('88'),
                { saved, state, pop });
        }
    } finally {
        serverDefaults = ALL;
        await context.close();
    }
};

/** The run's crops on one page, labelled. */
const contactSheet = async path => {
    // Phones are narrow: one column; everything else two.
    const tiles = [
        ['series-desktop-hover', 'Desktop · series ("1923"-like values), hover popup'], ['movie-desktop-hover', 'Desktop · movie, hover popup'],
        ['stock-desktop', 'Desktop · no IMDb or RT values: stock ★ and tomato stay'], ['entry-desktop', 'Desktop · file-less entry'],
        ['movie-tv1080-play', 'TV 1920×1080 · Play focused'], ['movie-tv1080-ok', 'TV 1080 · Up, then OK: popup'],
        ['movie-tv720-play', 'TV 1280×720 · Play focused (Trakt fits)'], ['long-tv720', 'TV 720 · a longer row: Trakt gives way'],
        ['movie-tv720-ok', 'TV 720 · Up, then OK: popup'],
        ['series-tv720', 'TV 720 · series'], ['stock-tv720', 'TV 720 · stock ★ and tomato kept'],
        ['entry-tv1080', 'TV 1080 · file-less entry'], ['series-mobile', 'Mobile 390 · series'],
        ['movie-mobile-tap', 'Mobile 390 · tap: popup'], ['entry-mobile', 'Mobile 390 · file-less entry'],
        ['series-desktop-fresh-defaults', 'Fresh default: IMDb, RT ×2, Trakt only'], ['movie-desktop-unticked', 'Trakt, RT audience, TMDB unticked']
    ].filter(([name]) => shotsTaken.includes(name));
    const image = name => 'data:image/png;base64,' + readFileSync(join(SHOTS, `${LABEL}-${name}.png`)).toString('base64');
    const html = `<!doctype html><html><head><style>
        body { margin: 0; padding: 24px; background: #181818; color: #eee; font: 15px/1.3 'Noto Sans', sans-serif; width: 2352px; }
        h1 { font-size: 26px; margin: 0 0 4px; } p { margin: 0 0 18px; color: #aaa; font-size: 15px; }
        .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 18px; align-items: start; }
        figure { margin: 0; } figcaption { font-weight: 600; margin: 0 0 6px; }
        img { width: 100%; display: block; border: 1px solid #333; }
        .wide { grid-column: span 2; }
    </style></head><body><h1>Ratings in the metadata row and their popup (user decisions 10 and 13)</h1>
    <p>Design preview: the real build in ${tier === 'chrome' ? 'Google Chrome' : 'Chromium'} against fixture data (not a Jellyfin instance), every source ticked unless the
    tile says otherwise. Crops of the title header and the popup.</p>
    <div class="grid">${tiles.map(([name, caption]) => `<figure class="${/mobile/.test(name) ? '' : 'wide'}"><figcaption>${caption}</figcaption><img src="${image(name)}"></figure>`).join('')}</div>
    </body></html>`;
    const sheet = await browser.newPage({ viewport: { width: 2400, height: 1000 }, deviceScaleFactor: 1 });
    await sheet.setContent(html, { waitUntil: 'load' });
    await sheet.screenshot({ path, fullPage: true });
    await sheet.close();
};

/** The settings area's Ratings section keeps its status, header and rail summary current while it is open (P3 6-7). */
const settingsRun = async () => {
    const { context, page } = await open('desktop');
    try {
        await page.goto(`${ORIGIN}/web-mod/#/catalog/settings?section=ratings`, { waitUntil: 'domcontentloaded' });
        try {
            await page.locator('section[data-section="ratings"]').waitFor({ timeout: 30000 });
        } catch (error) {
            if (SHOTS) await page.screenshot({ path: join(SHOTS, 'debug-settings.png') });
            console.log('fixture server had no answer for: ' + [...unknown].join(', '));
            throw error;
        }
        const rail = () => page.locator('.jfmod-step[data-section="ratings"] .jfmod-s').innerText().catch(() => '');
        const header = () => page.locator('section[data-section="ratings"]').innerText().catch(() => '');
        check('settings: idle at first, nothing says fetching', !/Fetching/.test(await rail()) && !/title\(s\) left/.test(await header()), await rail());
        await page.waitForTimeout(4000);
        // A pass starts later, while the section stays open and idle.
        Object.assign(ratingsStatus, { running: { kind: 'arrivals', startedAt: new Date().toISOString(), remaining: 7 } });
        const started = Date.now();
        await page.waitForFunction(() => /Fetching, 7 title/.test(document.querySelector('section[data-section="ratings"]')?.textContent ?? ''), null,
            { timeout: 25000 }).catch(() => undefined);
        const seenAfter = (Date.now() - started) / 1000;
        const railRunning = await rail();
        check(`settings: a pass that starts while the section is idle appears within the idle interval (${seenAfter.toFixed(1)} s), panel and rail alike`,
            /Fetching, 7 title/.test(await header()) && /Fetching · 7/.test(railRunning) && seenAfter < 20, { seenAfter, railRunning });
        await shot(page, 'settings-running');
        Object.assign(ratingsStatus, { running: null, entriesWithoutRatings: 0, lastRun: { ...ratingsStatus.lastRun, startedAt: new Date().toISOString(), fetched: 7 } });
        const ended = Date.now();
        await page.waitForFunction(() => !/Fetching, \d+ title/.test(document.querySelector('section[data-section="ratings"]')?.textContent ?? ''), null,
            { timeout: 15000 }).catch(() => undefined);
        await page.waitForTimeout(300);
        const railAfter = await rail();
        check(`settings: when the pass ends, panel, header and rail all stop saying fetching (${((Date.now() - ended) / 1000).toFixed(1)} s)`,
            !/Fetching/.test(railAfter) && !/title\(s\) left/.test(await header()) && /0 of 40/.test(await header()), { railAfter });
        const reads = statusReads;
        await page.waitForTimeout(16000);
        check('settings: idle, it keeps reading the status, slowly (bounded)', statusReads - reads >= 1 && statusReads - reads <= 2, statusReads - reads);
        await shot(page, 'settings-idle');
    } finally {
        await context.close();
    }
};

/**
 * The rest, on the desktop and the TV: the rotten marks below 60 %, the popup in the user's own order, a user's own choice that
 * leaves two of the three row providers (Trakt still the one to give way), and the cards' single rating (P9.R7).
 */
const extrasRun = async () => {
    const only = (process.env.JFMOD_DESIGN_ONLY ?? '').split(',').filter(Boolean);
    // Each part opens its own visit: the user's own choice is read when the app starts.
    const visit = async (layoutName, sourcesForUser, work) => {
        userSources = sourcesForUser;
        const { context, page } = await open(layoutName);
        try {
            await work(page);
        } finally {
            userSources = null;
            await context.close();
        }
    };
    for (const layoutName of ['desktop', 'tv720'].filter(name => !only.length || only.includes(name))) {
        await visit(layoutName, null, async page => {
            await groupDetail(page, nativeUrl(ROTTEN_ID));
            const kinds = await page.locator(SHOWN_GROUP).first().locator('svg.jfmod-ratingIcon')
                .evaluateAll(nodes => nodes.map(node => node.getAttribute('data-jfmod-icon')));
            if (CHECKS) check(`${layoutName}: below 60 % the splat and the spilled bucket`, kinds.includes('tomatoesCriticRotten') && kinds.includes('tomatoesAudienceSpilled'), kinds);
        });
        // A user's own choice without IMDb: Rotten Tomatoes and Trakt; Trakt still the one to give way, on the longer row too.
        await visit(layoutName, ['tomatoes_critic', 'tomatoes_audience', 'trakt', 'tmdb'], async page => {
            await groupDetail(page, nativeUrl(LONG_ID));
            const state = await groupState(page);
            await headerShot(page, `long-${layoutName}-own-sources`);
            if (CHECKS) {
                check(`${layoutName}: a user's own two of the three (RT and Trakt) follow the same rule — the stock star back, RT kept, Trakt only if the row has room`,
                    state.inline.filter(source => source !== 'trakt').join(',') === 'tomatoes_critic,tomatoes_audience' && traktRule(state, layoutName)
                        && state.stockStar && !state.stockTomato && state.lines === 1, state);
            }
        });
    }
    if (only.length && !only.includes('desktop')) return;
    // The popup follows the user's own order, with every source.
    const order = ['letterboxd', 'trakt', 'imdb', 'metacritic', 'metacritic_user', 'rogerebert', 'tomatoes_audience', 'tomatoes_critic', 'tmdb'];
    await visit('desktop', order, async page => {
        await groupDetail(page, nativeUrl(MOVIE_ID));
        const own = await groupState(page);
        await page.locator(SHOWN_GROUP).first().hover();
        await page.locator(POPUP).waitFor({ timeout: 3000 }).catch(() => undefined);
        const pop = await popupState(page);
        if (CHECKS) {
            check('desktop: the popup follows the user\'s own order with every source; the row keeps IMDb, RT critics, RT audience, Trakt',
                pop.sources.join(',') === order.join(',') && own.inline.join(',') === INLINE.join(','), { pop: pop.sources, inline: own.inline });
        }
    });
    await visit('desktop', null, async page => {
        await page.goto(`${ORIGIN}/web-mod/#/movies?topParentId=${MOVIES_VIEW}&collectionType=movies`, { waitUntil: 'domcontentloaded' });
        await page.locator('.jfmod-cardRating:visible').first().waitFor({ timeout: 30000 }).catch(() => undefined);
        await page.waitForTimeout(800);
        const cards = await page.locator('.jfmod-cardRating:visible').evaluateAll(nodes => nodes.map(node => ({
            icon: node.querySelector('svg.jfmod-ratingIcon')?.getAttribute('data-jfmod-icon') ?? null, text: node.textContent.trim(),
            title: node.getAttribute('title') ?? node.closest('[title]')?.getAttribute('title') ?? null,
            focusable: !!node.querySelector('button, a, [tabindex]') })));
        if (CHECKS) {
            check('desktop: cards show the chosen source\'s mark and value, with no tooltip or focus stop of their own',
                cards.length === 3 && cards.every(card => card.icon === 'imdb' && /\d/.test(card.text) && !card.title && !card.focusable)
                    && cards.some(card => /\(\w+ \d{4}\)/.test(card.text)), cards);
        }
    });
};

if (process.env.JFMOD_DESIGN_SETTINGS) {
    await settingsRun();
} else {
    await groupRun();
    await extrasRun();
    if (SHOTS && process.env.JFMOD_DESIGN_SHEET) await contactSheet(process.env.JFMOD_DESIGN_SHEET);
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
