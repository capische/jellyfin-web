/* eslint-disable compat/compat, sonarjs/cognitive-complexity -- a Node test boundary, not shipped code */
// P7.S11 stand-in services for a disposable JellyfinMod container: TMDB, Prowlarr with its Torznab feeds, and
// Transmission RPC, each over real HTTP, plus a tarpit that accepts connections and never answers (timeouts) and a
// control port bound to loopback that the test harness drives.
//
//   STANDIN_BIND=<address the container can reach> STANDIN_SECRETS=<0600 env file> STANDIN_STATE=<dir> node standins.mjs
//
// The secrets file holds generated fixture credentials only (TMDB_TOKEN, PROWLARR_KEY, TX_USER, TX_PASSWORD); nothing
// here ever logs a credential or a query string. TMDB is served in plain HTTP on its port; a TLS terminator in front of
// it answers as api.themoviedb.org, so the plugin's hard-coded endpoint is used unchanged.
//
// Ports: TMDB 38110, Prowlarr + Torznab 38111, Transmission 38112, tarpit 38113, control 127.0.0.1:38119. STANDIN_PORT_BASE
// moves all five together (base, +1, +2, +3, +9), so two runs on one host (a disposable container's and the acceptance
// instance's) never collide.
// Transmission maps its download folder /downloads to STANDIN_DOWNLOADS on disk; "complete" copies a staged file in.
import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, openSync, readSync, closeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { encode, readTorrent } from './bencode.mjs';

const bind = process.env.STANDIN_BIND ?? '127.0.0.1';
const portBase = Number(process.env.STANDIN_PORT_BASE ?? 38110);
const stateDir = process.env.STANDIN_STATE ?? (() => { throw new Error('STANDIN_STATE is required'); })();
const downloads = process.env.STANDIN_DOWNLOADS ?? (() => { throw new Error('STANDIN_DOWNLOADS is required'); })();
const secrets = Object.fromEntries(readFileSync(process.env.STANDIN_SECRETS, 'utf8').split('\n')
    .filter(line => line.includes('=')).map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()]));
for (const name of ['TMDB_TOKEN', 'PROWLARR_KEY', 'TX_USER', 'TX_PASSWORD']) if (!secrets[name]) throw new Error(`${name} missing from the secrets file`);
mkdirSync(join(stateDir, 'torrents'), { recursive: true });

const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const counters = {};
const count = name => { counters[name] = (counters[name] ?? 0) + 1; };
// Faults the harness switches on: tmdb 'down' | prowlarr '401' | '500' | 'slow' | torznab[<id>] '500' | '429' | 'slow' | 'redirect' |
// 'malformed' | 'autherror' | tx 'down' | 'slow' | webseed 'down' | '<bytes per second>';
// txauth 'off' answers without credentials, like a Transmission with authentication disabled.
const faults = { tmdb: 'ok', prowlarr: 'ok', torznab: 'ok', tx: 'ok', txauth: 'on', webseed: 'ok' };
const log = (...parts) => console.log(new Date().toISOString(), ...parts);
const json = (response, status, body) => {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(body));
};
const readBody = request => new Promise(resolve => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks)));
});

// ---- TMDB ----
// Movies the stand-in knows. Poster paths are null so no browser fetches an image from the real TMDB.
const MOVIES = [
    { id: 990001, title: 'JellyfinMod Standin Movie', release_date: '2026-01-16', imdb_id: 'tt9900001', runtime: 1, genres: [{ id: 18, name: 'Drama' }] },
    { id: 990002, title: 'JellyfinMod Standin Sequel', release_date: '2026-02-20', imdb_id: 'tt9900002', runtime: 1, genres: [{ id: 18, name: 'Drama' }] },
    { id: 990003, title: 'JellyfinMod Standin Seeder', release_date: '2026-03-13', imdb_id: 'tt9900003', runtime: 1, genres: [{ id: 18, name: 'Drama' }] },
    // Titles with no release anywhere: automation's empty searches, back-off and the indexer circuit breaker.
    ...[4, 5, 6, 7, 8, 9].map(n => ({ id: 990000 + n, title: `JellyfinMod Standin Extra ${n}`, release_date: `2025-0${n}-01`, imdb_id: `tt990000${n}`, runtime: 1,
        genres: [{ id: 18, name: 'Drama' }] }))
];
// Extra titles for a live acceptance instance: STANDIN_CATALOG names a JSON file { movies: [...], series: [...] } that is
// re-read on every request, so a run can add an episode or move an air date without restarting the stand-ins.
const catalog = () => {
    const file = process.env.STANDIN_CATALOG;
    if (!file || !existsSync(file)) return { movies: [], series: [] };
    try {
        const parsed = JSON.parse(readFileSync(file, 'utf8'));
        return { movies: parsed.movies ?? [], series: parsed.series ?? [] };
    } catch {
        return { movies: [], series: [] };
    }
};
const allMovies = () => [...MOVIES, ...catalog().movies.map(movie => ({ runtime: 90, genres: [{ id: 18, name: 'Drama' }], ...movie }))];
const seriesSummary = series => ({
    id: series.id, name: series.name, original_name: series.name, first_air_date: series.first_air_date, overview: `${series.name}, a generated fixture.`,
    poster_path: null, backdrop_path: null, adult: false, vote_average: 5, genre_ids: [18], original_language: 'en', popularity: 1, origin_country: ['US']
});
const seasonName = number => number === 0 ? 'Specials' : `Season ${number}`;
const seriesDetail = series => ({
    ...seriesSummary(series), genres: [{ id: 18, name: 'Drama' }], status: 'Returning Series', episode_run_time: [1], in_production: true,
    number_of_seasons: series.seasons.filter(season => season.season_number > 0).length,
    number_of_episodes: series.seasons.reduce((sum, season) => sum + season.episodes.length, 0),
    seasons: series.seasons.map(season => ({
        id: series.id * 100 + season.season_number, season_number: season.season_number, name: seasonName(season.season_number),
        episode_count: season.episodes.length, air_date: season.episodes[0]?.air_date ?? null, poster_path: null, overview: ''
    })),
    external_ids: { imdb_id: series.imdb_id ?? null, tvdb_id: null }, content_ratings: { results: [] }, images: { backdrops: [], posters: [], logos: [] },
    credits: { cast: [], crew: [] }, videos: { results: [] }, keywords: { results: [] }, networks: [], production_companies: [], created_by: []
});
const seasonDetail = (series, season) => ({
    id: series.id * 100 + season.season_number, _id: `${series.id}-${season.season_number}`, season_number: season.season_number,
    name: seasonName(season.season_number), air_date: season.episodes[0]?.air_date ?? null, overview: '', poster_path: null,
    episodes: season.episodes.map(episode => ({
        id: episode.id, episode_number: episode.episode_number, season_number: season.season_number, name: episode.name ?? `Episode ${episode.episode_number}`,
        overview: '', air_date: episode.air_date ?? null, runtime: 1, still_path: null, vote_average: 0, crew: [], guest_stars: []
    }))
});
const movieSummary = movie => ({
    id: movie.id, title: movie.title, original_title: movie.title, release_date: movie.release_date, overview: `${movie.title}, a generated S11 fixture.`,
    poster_path: null, backdrop_path: null, adult: false, vote_average: 5, genre_ids: movie.genres.map(genre => genre.id), original_language: 'en', popularity: 1
});
const movieDetail = movie => ({
    ...movieSummary(movie), imdb_id: movie.imdb_id, runtime: movie.runtime, genres: movie.genres, status: 'Released', tagline: '',
    production_companies: [], production_countries: [], spoken_languages: [], budget: 0, revenue: 0, vote_count: 1, video: false,
    external_ids: { imdb_id: movie.imdb_id, facebook_id: null, instagram_id: null, twitter_id: null, wikidata_id: null },
    release_dates: { results: [{ iso_3166_1: 'US', release_dates: [{ certification: 'PG', release_date: movie.release_date + 'T00:00:00.000Z', type: 3, note: '', iso_639_1: '' }] }] },
    images: { backdrops: [], posters: [], logos: [] }, credits: { cast: [], crew: [] }, videos: { results: [] }, keywords: { keywords: [] }
});

const tmdb = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://tmdb');
    count('tmdb');
    if (faults.tmdb === 'down') { request.socket.destroy(); return; }
    // The plugin authenticates with its Bearer Read Access Token. Jellyfin's own TMDb metadata provider sends its built-in
    // api_key instead; that is a different credential for a different purpose and is answered without checking it.
    const bearer = (request.headers.authorization ?? '').replace(/^Bearer /, '');
    if (!url.searchParams.has('api_key') && !same(bearer, secrets.TMDB_TOKEN)) {
        count('tmdb.unauthorized');
        json(response, 401, { status_code: 7, status_message: 'Invalid API key: You must be granted a valid key.', success: false });
        return;
    }
    const path = url.pathname.replace(/^\/3\//, '');
    log('tmdb', request.method, '/3/' + path, url.searchParams.has('api_key') ? '(host provider)' : '(plugin)');
    if (path === 'configuration') {
        json(response, 200, { images: { base_url: 'http://image.tmdb.invalid/t/p/', secure_base_url: 'https://image.tmdb.invalid/t/p/', poster_sizes: ['w500', 'original'], backdrop_sizes: ['w1280', 'original'], profile_sizes: ['w185'], logo_sizes: ['w500'], still_sizes: ['w300'] }, change_keys: [] });
        return;
    }
    if (path === 'search/movie') {
        const query = (url.searchParams.get('query') ?? '').toLowerCase();
        const results = allMovies().filter(movie => query.split(/\s+/).every(word => movie.title.toLowerCase().includes(word))).map(movieSummary);
        json(response, 200, { page: 1, results, total_pages: 1, total_results: results.length });
        return;
    }
    if (path === 'search/tv') {
        const query = (url.searchParams.get('query') ?? '').toLowerCase();
        const results = catalog().series.filter(series => query.split(/\s+/).every(word => series.name.toLowerCase().includes(word))).map(seriesSummary);
        json(response, 200, { page: 1, results, total_pages: results.length ? 1 : 0, total_results: results.length });
        return;
    }
    if (path === 'search/multi' || path === 'search/person' || path === 'search/collection') {
        json(response, 200, { page: 1, results: [], total_pages: 0, total_results: 0 });
        return;
    }
    const detail = /^movie\/(\d+)$/.exec(path);
    if (detail) {
        const movie = allMovies().find(candidate => candidate.id === Number(detail[1]));
        if (movie) { json(response, 200, movieDetail(movie)); return; }
    }
    const tvDetail = /^tv\/(\d+)$/.exec(path);
    if (tvDetail) {
        const series = catalog().series.find(candidate => candidate.id === Number(tvDetail[1]));
        if (series) { json(response, 200, seriesDetail(series)); return; }
    }
    const tvSeason = /^tv\/(\d+)\/season\/(\d+)$/.exec(path);
    if (tvSeason) {
        const series = catalog().series.find(candidate => candidate.id === Number(tvSeason[1]));
        const season = series?.seasons.find(candidate => candidate.season_number === Number(tvSeason[2]));
        if (series && season) { json(response, 200, seasonDetail(series, season)); return; }
    }
    const byImdb = /^find\/(tt\d+)$/.exec(path);
    if (byImdb) {
        json(response, 200, {
            movie_results: allMovies().filter(movie => movie.imdb_id === byImdb[1]).map(movieSummary),
            tv_results: catalog().series.filter(series => series.imdb_id === byImdb[1]).map(seriesSummary), person_results: []
        });
        return;
    }
    json(response, 404, { status_code: 34, status_message: 'The resource you requested could not be found.', success: false });
});

// ---- Prowlarr and its per-indexer Torznab feeds ----
const INDEXERS = [
    {
        id: 1, name: 'JellyfinMod Standin Indexer', protocol: 'torrent', enable: true, priority: 10, supportsRedirect: false, indexerUrls: [],
        capabilities: { categories: [{ id: 2000, name: 'Movies', subCategories: [{ id: 2040, name: 'Movies/HD' }] }, { id: 5000, name: 'TV', subCategories: [{ id: 5040, name: 'TV/HD' }] }] }
    }
];
const releasesFile = join(stateDir, 'releases.json');
const releases = () => existsSync(releasesFile) ? JSON.parse(readFileSync(releasesFile, 'utf8')) : [];
const CAPS = `<?xml version="1.0" encoding="UTF-8"?>
<caps>
  <server title="JellyfinMod S11 stand-in"/>
  <limits max="100" default="100"/>
  <searching>
    <search available="yes" supportedParams="q"/>
    <tv-search available="yes" supportedParams="q,season,ep"/>
    <movie-search available="yes" supportedParams="q,imdbid,tmdbid"/>
  </searching>
  <categories>
    <category id="2000" name="Movies"><subcat id="2040" name="Movies/HD"/></category>
    <category id="5000" name="TV"><subcat id="5040" name="TV/HD"/></category>
  </categories>
</caps>`;
const xml = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const feed = (items, origin) => {
    let body = '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel>';
    body += `<torznab:response offset="0" total="${items.length}"/>`;
    for (const item of items) {
        const link = `${origin}/${item.indexerId}/download?file=${encodeURIComponent(item.id)}`;
        body += `<item><title>${xml(item.title)}</title><guid>${xml(item.id)}</guid><pubDate>Thu, 24 Sep 2026 10:00:00 +0000</pubDate>`;
        body += `<size>${item.size}</size><link>${xml(link)}</link><enclosure url="${xml(link)}" length="${item.size}" type="application/x-bittorrent"/>`;
        body += `<torznab:attr name="category" value="${item.category ?? 2040}"/><torznab:attr name="size" value="${item.size}"/>`;
        body += `<torznab:attr name="seeders" value="${item.seeders ?? 25}"/><torznab:attr name="peers" value="${(item.seeders ?? 25) + 3}"/>`;
        if (item.imdbid) body += `<torznab:attr name="imdbid" value="${xml(item.imdbid.replace(/^tt/, ''))}"/>`;
        if (item.tmdbid) body += `<torznab:attr name="tmdbid" value="${item.tmdbid}"/>`;
        body += '</item>';
    }
    return body + '</channel></rss>';
};

const prowlarr = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://prowlarr');
    const origin = `http://${request.headers.host}`;
    count('prowlarr');
    if (faults.prowlarr === 'slow') return; // never answers: the caller's timeout fires
    const key = request.headers['x-api-key'] ?? url.searchParams.get('apikey');
    if (url.pathname.startsWith('/api/v1/')) {
        log('prowlarr', request.method, url.pathname);
        if (!same(key, secrets.PROWLARR_KEY) || faults.prowlarr === '401') { count('prowlarr.unauthorized'); json(response, 401, { message: 'Unauthorized' }); return; }
        if (faults.prowlarr === '500') { json(response, 500, { message: 'stand-in failure' }); return; }
        if (url.pathname === '/api/v1/system/status') { json(response, 200, { appName: 'Prowlarr', version: '1.99.0-s11-standin' }); return; }
        if (url.pathname === '/api/v1/health') { json(response, 200, []); return; }
        if (url.pathname === '/api/v1/indexer') { json(response, 200, INDEXERS); return; }
        if (url.pathname === '/api/v1/indexerstatus') { json(response, 200, []); return; }
        json(response, 404, { message: 'Not found' });
        return;
    }
    const torznab = /^\/(\d+)\/api$/.exec(url.pathname);
    if (torznab) {
        const mode = url.searchParams.get('t');
        count('torznab.' + mode);
        count(`torznab${torznab[1]}.${mode}`); // per feed, to compare with the plugin's per-indexer query counts
        log('torznab', torznab[1], 't=' + mode, url.searchParams.has('imdbid') ? 'imdbid' : '', url.searchParams.has('q') ? 'q' : '');
        // A fault can target one feed (service torznab<id>) or all of them (service torznab).
        const fault = faults['torznab' + torznab[1]] ?? faults.torznab;
        if (fault === '500') { response.writeHead(500); response.end(); return; }
        if (fault === '429') { response.writeHead(429, { 'Retry-After': '60' }); response.end(); return; }
        if (fault === 'slow') return;
        if (fault === 'redirect') { response.writeHead(302, { Location: 'http://redirect.invalid/api' }); response.end(); return; }
        if (fault === 'malformed') { response.writeHead(200, { 'Content-Type': 'application/xml' }); response.end('<?xml version="1.0"?><rss><channel><item><title>broken'); return; }
        if (fault === 'autherror') {
            response.writeHead(200, { 'Content-Type': 'application/xml' });
            response.end('<?xml version="1.0"?><error code="100" description="Incorrect user credentials"/>');
            return;
        }
        response.writeHead(200, { 'Content-Type': 'application/xml' });
        if (!same(key, secrets.PROWLARR_KEY)) { response.end('<?xml version="1.0"?><error code="100" description="Incorrect user credentials"/>'); return; }
        if (mode === 'caps') { response.end(CAPS); return; }
        const imdb = url.searchParams.get('imdbid')?.replace(/^tt/, '');
        const tmdbId = url.searchParams.get('tmdbid');
        const words = (url.searchParams.get('q') ?? '').toLowerCase().split(/[\s.]+/).filter(Boolean);
        const items = releases().filter(item => String(item.indexerId) === torznab[1] && (
            (imdb && item.imdbid?.replace(/^tt/, '') === imdb) || (tmdbId && String(item.tmdbid) === tmdbId)
            || (!imdb && !tmdbId && words.length > 0 && words.every(word => item.title.toLowerCase().includes(word)))));
        response.end(feed(items, origin));
        return;
    }
    const download = /^\/(\d+)\/download$/.exec(url.pathname);
    if (download) {
        const item = releases().find(candidate => candidate.id === url.searchParams.get('file'));
        count('download');
        log('prowlarr download', item ? item.id : '(unknown)');
        if (!item) { response.writeHead(404); response.end(); return; }
        response.writeHead(200, { 'Content-Type': 'application/x-bittorrent' });
        response.end(readFileSync(join(stateDir, 'torrents', item.id + '.torrent')));
        return;
    }
    response.writeHead(404);
    response.end();
});

// ---- Transmission RPC ----
const sessionId = randomBytes(16).toString('hex');
const torrents = new Map(); // hash -> torrent
const expectedAuth = 'Basic ' + Buffer.from(`${secrets.TX_USER}:${secrets.TX_PASSWORD}`).toString('base64');
const localPath = clientPath => {
    if (clientPath === '/downloads' || clientPath.startsWith('/downloads/')) return join(downloads, clientPath.slice('/downloads'.length));
    throw new Error('outside /downloads');
};
const describe = (torrent, index) => {
    const size = torrent.files.reduce((sum, file) => sum + file.length, 0);
    const done = torrent.files.reduce((sum, file) => sum + file.completed, 0);
    const complete = done === size;
    return {
        id: index, hashString: torrent.hash, name: torrent.name, downloadDir: torrent.downloadDir, labels: torrent.labels,
        percentDone: size ? done / size : 0, sizeWhenDone: size, leftUntilDone: size - done, totalSize: size,
        rateDownload: complete ? 0 : 1000000, eta: complete ? -1 : 600, status: complete ? 6 : 4, isFinished: false,
        uploadRatio: torrent.uploadRatio, secondsSeeding: torrent.secondsSeeding, seedRatioMode: torrent.seedRatioMode,
        seedRatioLimit: torrent.seedRatioLimit, seedIdleMode: torrent.seedIdleMode, seedIdleLimit: torrent.seedIdleLimit, etaIdle: -1,
        error: 0, errorString: '', addedDate: torrent.addedDate, doneDate: torrent.doneDate ?? 0, activityDate: torrent.addedDate,
        files: torrent.files.map(file => ({ name: file.name, length: file.length, bytesCompleted: file.completed })),
        fileStats: torrent.files.map(file => ({ wanted: true, bytesCompleted: file.completed, priority: 0 }))
    };
};
const transmission = createServer(async (request, response) => {
    count('tx');
    if (faults.tx === 'down') { request.socket.destroy(); return; }
    if (faults.tx === 'slow') return;
    if (faults.txauth !== 'off' && request.headers.authorization !== expectedAuth) { count('tx.unauthorized'); response.writeHead(401); response.end('<h1>401: Unauthorized</h1>'); return; }
    if (request.headers['x-transmission-session-id'] !== sessionId) {
        response.writeHead(409, { 'X-Transmission-Session-Id': sessionId });
        response.end('<h1>409: Conflict</h1>');
        return;
    }
    let body;
    try { body = JSON.parse((await readBody(request)).toString('utf8')); } catch { response.writeHead(400); response.end(); return; }
    const args = body.arguments ?? {};
    log('transmission', body.method);
    let result = {};
    switch (body.method) {
        case 'session-get':
            result = { version: '4.0.6 (s11 stand-in)', 'rpc-version': 17, 'rpc-version-minimum': 14, seedRatioLimited: false, seedRatioLimit: 2,
                'idle-seeding-limit-enabled': false, 'idle-seeding-limit': 30, 'incomplete-dir-enabled': false, 'rename-partial-files': false,
                'download-dir': '/downloads' };
            break;
        case 'torrent-get': {
            const ids = Array.isArray(args.ids) ? new Set(args.ids.map(id => String(id).toLowerCase())) : null;
            result = { torrents: [...torrents.values()].map((torrent, at) => [torrent, at + 1]).filter(([torrent]) => !ids || ids.has(torrent.hash))
                .map(([torrent, at]) => describe(torrent, at)) };
            break;
        }
        case 'torrent-add': {
            if (!args.metainfo) { result = {}; body.error = 'only metainfo is supported'; break; }
            const parsed = readTorrent(Buffer.from(args.metainfo, 'base64'));
            if (torrents.has(parsed.infoHash)) { result = { 'torrent-duplicate': { hashString: parsed.infoHash, id: 1, name: parsed.name } }; break; }
            torrents.set(parsed.infoHash, {
                hash: parsed.infoHash, name: parsed.name, downloadDir: args['download-dir'] ?? '/downloads', labels: args.labels ?? [],
                files: parsed.files.map(file => ({ ...file, completed: 0 })), uploadRatio: 0, secondsSeeding: 0, seedRatioMode: 0, seedRatioLimit: 2,
                seedIdleMode: 0, seedIdleLimit: 30, addedDate: Math.floor(Date.now() / 1000)
            });
            log('transmission added', parsed.infoHash, parsed.name);
            result = { 'torrent-added': { hashString: parsed.infoHash, id: torrents.size, name: parsed.name } };
            break;
        }
        case 'torrent-set':
            for (const id of args.ids ?? []) {
                const torrent = torrents.get(String(id).toLowerCase());
                if (!torrent) continue;
                for (const field of ['seedRatioMode', 'seedRatioLimit', 'seedIdleMode', 'seedIdleLimit']) if (field in args) torrent[field] = args[field];
                if (Array.isArray(args.labels)) torrent.labels = args.labels;
            }
            break;
        case 'torrent-remove':
            for (const id of args.ids ?? []) {
                const torrent = torrents.get(String(id).toLowerCase());
                if (!torrent) continue;
                torrents.delete(torrent.hash);
                if (args['delete-local-data']) for (const file of torrent.files) rmSync(localPath(torrent.downloadDir + '/' + file.name), { force: true });
                log('transmission removed', torrent.hash, args['delete-local-data'] ? 'with data' : 'kept data');
            }
            break;
        default:
            json(response, 200, { result: 'method name not recognized', arguments: {} });
            return;
    }
    json(response, 200, { result: body.error ?? 'success', arguments: result });
});

// ---- Web seed (BEP 19): serves a release's files by byte range, optionally throttled ----
// GET /<release id>/<torrent name>[/<path inside the torrent>]. faults.webseed: 'ok' | 'down' | '<bytes per second>'.
const webseed = createServer((request, response) => {
    count('webseed');
    const mode = faults.webseed ?? 'ok';
    if (mode === 'down') { request.socket.destroy(); return; }
    const segments = new URL(request.url, 'http://webseed').pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const release = releases().find(item => item.id === segments[0]);
    const inner = segments.slice(2).join('/');
    const part = release && segments[1] === release.torrentName
        ? release.parts.find(candidate => (candidate.path ?? '') === inner) : null;
    if (!part) { response.writeHead(404); response.end(); return; }
    const length = statSync(part.file).size;
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '');
    const from = range ? Number(range[1]) : 0;
    const to = range && range[2] ? Math.min(Number(range[2]), length - 1) : length - 1;
    if (from > to) { response.writeHead(416, { 'Content-Range': `bytes */${length}` }); response.end(); return; }
    response.writeHead(range ? 206 : 200, {
        'Content-Type': 'application/octet-stream', 'Content-Length': to - from + 1, 'Accept-Ranges': 'bytes',
        ...(range ? { 'Content-Range': `bytes ${from}-${to}/${length}` } : {})
    });
    const bytesPerSecond = Number(mode) > 0 ? Number(mode) : Number(process.env.STANDIN_WEBSEED_BPS ?? 0);
    const handle = openSync(part.file, 'r');
    let at = from;
    const step = 65536;
    const pump = () => {
        if (at > to || response.destroyed) { closeSync(handle); response.end(); return; }
        const buffer = Buffer.alloc(Math.min(step, to - at + 1));
        const read = readSync(handle, buffer, 0, buffer.length, at);
        at += read;
        const ok = response.write(buffer.subarray(0, read));
        const delay = bytesPerSecond > 0 ? Math.round(read / bytesPerSecond * 1000) : 0;
        if (!ok) response.once('drain', () => setTimeout(pump, delay)); else setTimeout(pump, delay);
    };
    response.on('close', () => { at = to + 1; });
    pump();
});
const webseedHost = process.env.STANDIN_WEBSEED_HOST ?? bind;

// ---- Tarpit: accepts a connection and never answers, so a client's own timeout fires ----
const held = new Set();
const tarpit = createTcpServer(socket => { count('tarpit'); held.add(socket); socket.on('close', () => held.delete(socket)); socket.on('error', () => {}); });

// ---- Control, loopback only ----
const control = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://control');
    try {
        if (url.pathname === '/state') {
            json(response, 200, { faults, counters, torrents: [...torrents.values()].map((torrent, at) => describe(torrent, at + 1)), releases: releases() });
            return;
        }
        if (url.pathname === '/fault') { faults[url.searchParams.get('service')] = url.searchParams.get('mode'); json(response, 200, faults); return; }
        if (url.pathname === '/release') {
            // Publishes a release of a real, staged file: the .torrent carries the file's real piece hashes.
            // A multi-file release lists `files: [{ path, file }]` (path inside the torrent, file on disk). `webseed: true`
            // adds a BEP 19 url-list pointing at this stand-in's web seed, so a real Transmission can download it with no peer.
            const spec = JSON.parse((await readBody(request)).toString('utf8'));
            const parts = spec.files ? spec.files.map(part => ({ path: part.path, file: part.file, length: statSync(part.file).size }))
                : [{ path: null, file: spec.file, length: statSync(spec.file).size }];
            const size = parts.reduce((sum, part) => sum + part.length, 0);
            const pieceLength = 262144;
            const pieces = [];
            let pending = Buffer.alloc(0);
            const chunk = Buffer.alloc(pieceLength);
            for (const part of parts) {
                const handle = openSync(part.file, 'r');
                for (let offset = 0; offset < part.length; offset += pieceLength) {
                    const read = readSync(handle, chunk, 0, pieceLength, offset);
                    pending = Buffer.concat([pending, chunk.subarray(0, read)]);
                    while (pending.length >= pieceLength) {
                        pieces.push(createHash('sha1').update(pending.subarray(0, pieceLength)).digest());
                        pending = pending.subarray(pieceLength);
                    }
                }
                closeSync(handle);
            }
            if (pending.length) pieces.push(createHash('sha1').update(pending).digest());
            const info = spec.files
                ? { files: parts.map(part => ({ length: part.length, path: part.path.split('/') })), name: spec.torrentName, 'piece length': pieceLength, pieces: Buffer.concat(pieces), private: 1 }
                : { length: size, name: spec.torrentName, 'piece length': pieceLength, pieces: Buffer.concat(pieces), private: 1 };
            const torrent = { announce: 'http://tracker.invalid/announce', 'created by': 'JellyfinMod stand-in', info };
            if (spec.webseed) torrent['url-list'] = [`${process.env.STANDIN_WEBSEED_BASE || `http://${webseedHost}:${portBase + 4}/`}${encodeURIComponent(spec.id)}/`];
            const torrentBytes = encode(torrent);
            writeFileSync(join(stateDir, 'torrents', spec.id + '.torrent'), torrentBytes);
            const list = releases().filter(item => item.id !== spec.id);
            list.push({ id: spec.id, indexerId: spec.indexerId ?? 1, title: spec.title, size, seeders: spec.seeders ?? 25, category: spec.category ?? 2040,
                imdbid: spec.imdbid, tmdbid: spec.tmdbid, file: spec.file ?? parts[0].file, torrentName: spec.torrentName,
                parts: parts.map(part => ({ path: part.path, file: part.file })), infoHash: readTorrent(torrentBytes).infoHash });
            writeFileSync(releasesFile, JSON.stringify(list, null, 1));
            json(response, 200, list.at(-1));
            return;
        }
        if (url.pathname === '/withdraw') {
            // Takes a release off the feeds (the torrent file stays, so a client that already has it keeps its web seed).
            const list = releases().filter(item => item.id !== url.searchParams.get('id'));
            writeFileSync(releasesFile, JSON.stringify(list, null, 1));
            json(response, 200, { releases: list.length });
            return;
        }
        if (url.pathname === '/complete') {
            // Finishes a download: copies the staged file into the torrent's download folder, then reports it complete.
            const torrent = torrents.get(url.searchParams.get('hash'));
            const release = releases().find(item => item.infoHash === url.searchParams.get('hash'));
            if (!torrent || !release) { json(response, 404, { error: 'unknown torrent' }); return; }
            const target = localPath(torrent.downloadDir + '/' + torrent.files[0].name);
            mkdirSync(dirname(target), { recursive: true });
            copyFileSync(release.file, target);
            torrent.files[0].completed = torrent.files[0].length;
            torrent.doneDate = Math.floor(Date.now() / 1000);
            json(response, 200, describe(torrent, 1));
            return;
        }
        if (url.pathname === '/seed') {
            const torrent = torrents.get(url.searchParams.get('hash'));
            if (!torrent) { json(response, 404, { error: 'unknown torrent' }); return; }
            torrent.uploadRatio = Number(url.searchParams.get('ratio') ?? torrent.uploadRatio);
            torrent.secondsSeeding = Number(url.searchParams.get('seconds') ?? torrent.secondsSeeding);
            json(response, 200, describe(torrent, 1));
            return;
        }
        json(response, 404, {});
    } catch (error) {
        json(response, 500, { error: String(error.message) });
    }
});

tmdb.listen(portBase, bind);
prowlarr.listen(portBase + 1, bind);
transmission.listen(portBase + 2, bind);
tarpit.listen(portBase + 3, bind);
webseed.listen(portBase + 4, bind);
control.listen(portBase + 9, '127.0.0.1');
log(`stand-ins listening: tmdb ${portBase}, prowlarr ${portBase + 1}, transmission ${portBase + 2}, tarpit ${portBase + 3}, webseed ${portBase + 4}, control ${portBase + 9} (loopback)`);
