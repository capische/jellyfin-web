/* eslint-disable compat/compat, sonarjs/cognitive-complexity -- a Node test boundary, not shipped code */
// Phase 13 stand-in for api.trakt.tv: a Trakt account with a real watch history, for the stock Trakt plugin (v33) in a local
// environment started with JFMOD_TRAKT=1 (envs/compose.trakt.yaml). It terminates TLS itself with the environment's
// api.trakt.tv certificate (TRAKT_TLS_DIR, made by envs/bin/up.sh), so the plugin's hard-coded https://api.trakt.tv is used
// unchanged and the real Trakt is never reached. It serves what the plugin's device authorization, scrobbling and export
// ("Export library to trakt.tv", SyncLibraryTask) call at tag v33:
//
//   POST /oauth/device/code, /oauth/device/token, /oauth/token (refresh), /oauth/revoke
//   GET  /users/settings (the account's username and avatar, which JellyfinMod reads for Settings › Trakt, D49)
//   GET  /sync/watched/shows[?extended=progress], /sync/watched/episodes, /sync/watched/movies, /sync/collection/*,
//        /sync/playback/*, /sync/last_activities (paged with X-Pagination-* headers at the page size set by control; the
//        last activities move whenever the history changes, so the plugin's import, SyncFromTraktTask, reads it again)
//   POST /sync/history (adds one play per episode at its watched_at), /sync/history/remove (recorded, removes nothing
//        unless asked), /sync/collection[/remove], /scrobble/start|pause|stop (a stop at 80 % or more adds a play now)
//
// Every call must carry the plugin's trakt-api-key and trakt-api-version 2; user calls the access token issued here
// (never logged). The account's history is plays of the fixture show (matched by its TVDB or TMDB id) plus, for the
// paging check, filler shows.
//
//   TRAKT_TLS_DIR=<env>/trakt-standin TRAKT_PORT=<env port + 30000> TRAKT_CONTROL_PORT=<loopback port> node trakt-export.mjs
//
// Control (loopback only): GET /state (plays, counters, request log without credentials); POST /approve; POST /mode
// {down, rejectRefresh, tokenSeconds, pageSize, failGets:{status,count}, failHistory:{status,count}, slowGets:ms, username, avatar:bool,
// unknown:[{season,number}] (episodes Trakt answers as not found, in a history write and a scrobble)};
// GET /avatar.svg (the account's avatar, for the browser); POST /plays {plays:[{season,number,watched_at}]}
// to seed; POST /forget {season,number}; POST /filler {shows:n}; POST /reset (history and log, keeps the token).
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';

const port = Number(process.env.TRAKT_PORT ?? 42096);
const controlPort = Number(process.env.TRAKT_CONTROL_PORT ?? 42097);
const tlsDir = process.env.TRAKT_TLS_DIR;
// The stock plugin's public client id (Trakt/Api/TraktURIs.cs): an application identifier it sends in every request
// header, published in its source; not a user credential.
const CLIENT_ID = 'bfdd2e032c30c35b368f97ef4ec81587b899bcb028b91a1d4ba5589a4b6a7267';

export const SHOW = { title: 'JellyfinMod P13 Show', year: 2026, ids: { trakt: 9913001, slug: 'jellyfinmod-p13-show', tvdb: '990113', imdb: null, tmdb: null, tvrage: null } };

const state = {
    deviceCode: null, userCode: null, approved: false, codeUsed: false, accessToken: null, refreshToken: null, tokens: new Set(),
    mode: { down: false, rejectRefresh: false, tokenSeconds: 7776000, pageSize: 1000, failGets: null, failHistory: null, slowGets: 0, username: 'p13-standin', avatar: true, unknown: [] },
    plays: [], removals: [], collectionPosts: 0, filler: 0, nextId: 1, requests: [], counters: {}
};
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const log = entry => {
    state.requests.push({ at: new Date().toISOString(), ...entry });
    if (state.requests.length > 1000) state.requests.shift();
    state.counters[entry.route] = (state.counters[entry.route] ?? 0) + 1;
    console.log(new Date().toISOString(), entry.method, entry.route + (entry.query ?? ''), entry.status);
};
const send = (response, status, body, headers = {}) => {
    response.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    response.end(body === undefined ? '' : JSON.stringify(body));
};
const readJson = request => new Promise(resolve => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { resolve(null); }
    });
});
const syncResponse = (added = 0) => ({
    added: { movies: 0, episodes: added }, deleted: { movies: 0, episodes: 0 }, updated: { movies: 0, episodes: 0 },
    existing: { movies: 0, episodes: 0 }, not_found: { movies: [], shows: [], episodes: [], seasons: [], people: [] }
});
const minute = iso => new Date(Math.floor(new Date(iso).getTime() / 60000) * 60000).toISOString();
const isShow = ids => !!ids && (String(ids.tvdb) === String(SHOW.ids.tvdb) || ids.trakt === SHOW.ids.trakt || ids.slug === SHOW.ids.slug);
// When the account's watch history last changed, as Trakt's /sync/last_activities reports it.
let activityAt = new Date().toISOString();
const touched = () => { activityAt = new Date().toISOString(); };
const addPlay = (season, number, watchedAt, source) => {
    touched();
    // Trakt keeps a watch to the minute (observed 2026-10-07).
    state.plays.push({ id: state.nextId++, season, number, watched_at: minute(watchedAt ?? new Date().toISOString()), source });
};

// The fixture show's watched seasons plus filler shows (each one watched episode) for the paging check.
const fillerShow = index => ({
    plays: 1, last_watched_at: '2026-01-01T00:00:00.000Z', last_updated_at: '2026-01-01T00:00:00.000Z', reset_at: null,
    show: { title: `Filler ${index}`, year: 2000, ids: { trakt: 8000000 + index, slug: `filler-${index}`, tvdb: String(8000000 + index), imdb: null, tmdb: null, tvrage: null } },
    seasons: [{ number: 1, episodes: [{ number: 1, plays: 1, last_watched_at: '2026-01-01T00:00:00.000Z', last_updated_at: '2026-01-01T00:00:00.000Z' }] }]
});
const watchedShows = () => {
    const shows = [];
    for (let index = 0; index < state.filler; index++) shows.push(fillerShow(index));
    if (state.plays.length) {
        const seasons = new Map();
        for (const play of state.plays) {
            const season = seasons.get(play.season) ?? new Map();
            const episode = season.get(play.number) ?? { number: play.number, plays: 0, last_watched_at: play.watched_at, last_updated_at: play.watched_at };
            episode.plays++;
            if (play.watched_at > episode.last_watched_at) episode.last_watched_at = play.watched_at;
            season.set(play.number, episode);
            seasons.set(play.season, season);
        }
        const last = state.plays.map(play => play.watched_at).sort().at(-1);
        shows.push({
            plays: state.plays.length, last_watched_at: last, last_updated_at: last, reset_at: null, show: SHOW,
            seasons: [...seasons].sort((a, b) => a[0] - b[0]).map(([number, episodes]) => ({ number, episodes: [...episodes.values()].sort((a, b) => a.number - b.number) }))
        });
    }
    return shows;
};
const watchedEpisodes = () => watchedShows().flatMap(show => show.seasons.flatMap(season => season.episodes.map(episode => ({
    plays: episode.plays, last_watched_at: episode.last_watched_at, last_updated_at: episode.last_updated_at,
    episode: { season: season.number, number: episode.number, title: null, ids: { trakt: null, tvdb: null, imdb: null, tmdb: null, tvrage: null } },
    show: show.show
}))));
const paged = (url, items) => {
    const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit') ?? 1000), state.mode.pageSize));
    const page = Math.max(1, Number(url.searchParams.get('page') ?? 1));
    const count = Math.max(1, Math.ceil(items.length / limit));
    return {
        body: items.slice((page - 1) * limit, page * limit),
        headers: { 'X-Pagination-Page': String(page), 'X-Pagination-Limit': String(limit), 'X-Pagination-Page-Count': String(count), 'X-Pagination-Item-Count': String(items.length) }
    };
};

const handler = async (request, response) => {
    const url = new URL(request.url, 'https://api.trakt.tv');
    const route = url.pathname;
    const entry = { method: request.method, route, query: url.search || undefined };
    const reply = (status, body, headers) => {
        entry.status = status;
        log(entry);
        send(response, status, body, headers);
    };
    entry.apiHeaders = request.headers['trakt-api-version'] === '2' && request.headers['trakt-api-key'] === CLIENT_ID;
    if (!entry.apiHeaders) return reply(403, { error: 'missing trakt-api-key or trakt-api-version' });
    const tokenReply = () => {
        state.accessToken = randomBytes(32).toString('hex');
        // As on Trakt, a new authorization does not end the tokens issued before it: they stay valid until they expire.
        state.tokens.add(state.accessToken);
        return { access_token: state.accessToken, token_type: 'bearer', expires_in: state.mode.tokenSeconds, refresh_token: state.refreshToken, scope: 'public', created_at: Math.floor(Date.now() / 1000) };
    };

    if (request.method === 'POST' && route === '/oauth/device/code') {
        const body = await readJson(request);
        if (body?.client_id !== CLIENT_ID) return reply(401, { error: 'invalid_client' });
        state.deviceCode = randomBytes(20).toString('hex');
        state.userCode = 'JFMP' + randomBytes(2).toString('hex').toUpperCase();
        state.approved = false;
        state.codeUsed = false;
        return reply(200, { device_code: state.deviceCode, user_code: state.userCode, verification_url: 'https://trakt.tv/activate', expires_in: 600, interval: 1 });
    }
    if (request.method === 'POST' && route === '/oauth/device/token') {
        const body = await readJson(request);
        if (!state.deviceCode || !same(body?.code, state.deviceCode) || body?.client_id !== CLIENT_ID) return reply(404, { error: 'invalid_device_code' });
        if (!state.approved) return reply(400, { error: 'authorization_pending' });
        if (state.codeUsed) return reply(409, { error: 'already_used' });
        state.codeUsed = true;
        state.refreshToken = randomBytes(32).toString('hex');
        return reply(200, tokenReply());
    }
    if (request.method === 'POST' && route === '/oauth/token') {
        const body = await readJson(request);
        if (state.mode.rejectRefresh || !state.refreshToken || !same(body?.refresh_token, state.refreshToken)) return reply(401, { error: 'invalid_grant' });
        return reply(200, tokenReply());
    }
    if (request.method === 'POST' && route === '/oauth/revoke') return reply(200, {});

    const bearer = (request.headers.authorization ?? '').replace(/^Bearer /, '');
    entry.authorized = [...state.tokens].some(issued => same(bearer, issued));
    if (!entry.authorized) return reply(401, { error: 'invalid_token' });

    if (request.method === 'GET') {
        // A slow Trakt: every read waits, so a run lasts long enough to change the plugin's links while it goes.
        if (state.mode.slowGets > 0) await new Promise(resolve => setTimeout(resolve, state.mode.slowGets));
        const fail = state.mode.failGets;
        if (fail && fail.count > 0) {
            fail.count--;
            return reply(fail.status, { error: 'injected' }, fail.status === 429 ? { 'Retry-After': '1' } : {});
        }
        if (route === '/users/settings') {
            // The avatar is served by the control port on this Mac, which the browser reaches (the real Trakt's comes from its CDN).
            const avatar = state.mode.avatar ? { full: `http://127.0.0.1:${controlPort}/avatar.svg` } : { full: null };
            return reply(200, { user: { username: state.mode.username, private: false, name: 'P13 Stand-in', vip: false, images: { avatar } }, account: { timezone: 'Australia/Sydney' } });
        }
        let items;
        switch (route) {
            case '/sync/watched/shows': items = watchedShows(); break;
            case '/sync/watched/episodes': items = watchedEpisodes(); break;
            case '/sync/watched/movies':
            case '/sync/collection/movies':
            case '/sync/collection/shows':
            case '/sync/playback/movies':
            case '/sync/playback/episodes':
                items = []; break;
            case '/sync/last_activities': {
                const quiet = '2026-01-01T00:00:00.000Z';
                return reply(200, { all: activityAt, movies: { watched_at: quiet, paused_at: quiet }, episodes: { watched_at: activityAt, paused_at: quiet },
                    shows: { hidden_at: quiet } });
            }
            default: return reply(404, { error: 'not found' });
        }
        const { body, headers } = paged(url, items);
        return reply(200, body, headers);
    }
    if (request.method === 'POST') {
        const body = await readJson(request) ?? {};
        if (route === '/sync/history') {
            // A write Trakt refuses (the reads before it succeed): the plugin logs it and its task still says Completed.
            const fail = state.mode.failHistory;
            if (fail && fail.count > 0) {
                fail.count--;
                return reply(fail.status, { error: 'injected' });
            }
            let added = 0;
            const notFound = syncResponse();
            for (const show of body.shows ?? []) {
                if (!isShow(show.ids)) {
                    notFound.not_found.shows.push(show);
                    continue;
                }
                for (const season of show.seasons ?? []) {
                    for (const episode of season.episodes ?? []) {
                        // An episode Trakt does not know: named back by season and number, as Trakt answers a show's episode.
                        if (state.mode.unknown.some(lost => lost.season === season.number && lost.number === episode.number)) {
                            notFound.not_found.episodes.push({ season: season.number, number: episode.number, ids: {} });
                            continue;
                        }
                        addPlay(season.number, episode.number, episode.watched_at, 'history');
                        added++;
                    }
                }
            }
            // Episodes sent by their own ids are unknown here: the plugin sends them again by show, season and number.
            for (const episode of body.episodes ?? []) notFound.not_found.episodes.push(episode);
            notFound.added.episodes = added;
            entry.added = added;
            return reply(201, notFound);
        }
        if (route === '/sync/history/remove') {
            state.removals.push(body);
            return reply(200, syncResponse());
        }
        if (route === '/sync/collection' || route === '/sync/collection/remove') {
            state.collectionPosts++;
            return reply(201, syncResponse());
        }
        if (route.startsWith('/scrobble/')) {
            const action = route.slice('/scrobble/'.length);
            const progress = Number(body.progress ?? 0);
            // An episode Trakt does not know: its scrobble is answered 404, as Trakt does, and adds nothing.
            if (state.mode.unknown.some(lost => lost.season === body.episode?.season && lost.number === body.episode?.number)) return reply(404, { error: 'not found' });
            const scrobbled = action === 'stop' && progress >= 80 && isShow(body.show?.ids) && body.episode?.season !== undefined;
            if (scrobbled) addPlay(body.episode.season, body.episode.number, null, 'scrobble');
            entry.scrobbled = scrobbled;
            return reply(201, { id: state.nextId, action: scrobbled ? 'scrobble' : action, progress, show: body.show ?? null, episode: body.episode ?? null });
        }
    }
    return reply(404, { error: 'not found' });
};

const api = tlsDir ?
    createHttpsServer({ key: readFileSync(join(tlsDir, 'trakt.key')), cert: readFileSync(join(tlsDir, 'trakt.crt')) }, handler) :
    createHttpServer(handler);
// "Trakt cannot be reached": every connection fails at once. The forwarder in front (BusyBox nc) keeps the client's side
// open when this side only closes, which would make every request hang until HttpClient's timeout; a few bytes that are
// not TLS end the handshake immediately instead, so the client fails as fast as on a lost route or a failed DNS lookup.
api.on('connection', socket => {
    if (state.mode.down) {
        log({ method: 'CONNECT', route: '(down)', status: 0 });
        socket.end('unreachable\r\n');
        setTimeout(() => socket.destroy(), 200);
    }
});

const control = createHttpServer(async (request, response) => {
    const url = new URL(request.url, 'http://control');
    if (request.method === 'GET' && url.pathname === '/avatar.svg') {
        response.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
        return response.end(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'trakt-avatar.svg')));
    }
    if (request.method === 'GET' && url.pathname === '/state') {
        return send(response, 200, {
            deviceCodeIssued: !!state.deviceCode, approved: state.approved, tokenIssued: !!state.accessToken, mode: state.mode,
            plays: state.plays, removals: state.removals.length, collectionPosts: state.collectionPosts, filler: state.filler,
            counters: state.counters, requests: state.requests
        });
    }
    if (request.method === 'POST' && url.pathname === '/approve') {
        if (!state.deviceCode) return send(response, 409, { error: 'no device code yet' });
        state.approved = true;
        return send(response, 200, { approved: true });
    }
    const body = request.method === 'POST' ? await readJson(request) ?? {} : {};
    if (request.method === 'POST' && url.pathname === '/mode') {
        for (const key of ['down', 'rejectRefresh', 'avatar']) if (typeof body[key] === 'boolean') state.mode[key] = body[key];
        if (typeof body.username === 'string') state.mode.username = body.username;
        for (const key of ['tokenSeconds', 'pageSize', 'slowGets']) if (Number.isFinite(body[key])) state.mode[key] = body[key];
        if ('failGets' in body) state.mode.failGets = body.failGets;
        if ('failHistory' in body) state.mode.failHistory = body.failHistory;
        if (Array.isArray(body.unknown)) state.mode.unknown = body.unknown;
        return send(response, 200, { mode: state.mode });
    }
    if (request.method === 'POST' && url.pathname === '/plays') {
        for (const play of body.plays ?? []) addPlay(play.season, play.number, play.watched_at, 'seed');
        return send(response, 200, { plays: state.plays });
    }
    if (request.method === 'POST' && url.pathname === '/forget') {
        // Trakt no longer has this episode's plays (as if removed on trakt.tv): the next export must send it again.
        state.plays = state.plays.filter(play => !(play.season === body.season && play.number === body.number));
        touched();
        return send(response, 200, { plays: state.plays });
    }
    if (request.method === 'POST' && url.pathname === '/filler') {
        state.filler = Number(body.shows ?? 0);
        return send(response, 200, { filler: state.filler });
    }
    if (request.method === 'POST' && url.pathname === '/reset') {
        state.plays = [];
        touched();
        state.removals = [];
        state.collectionPosts = 0;
        state.filler = 0;
        state.requests = [];
        state.counters = {};
        state.mode = { ...state.mode, down: false, rejectRefresh: false, pageSize: 1000, failGets: null, failHistory: null, slowGets: 0, username: 'p13-standin', avatar: true, unknown: [] };
        return send(response, 200, { reset: true });
    }
    return send(response, 404, { error: 'not found' });
});

api.listen(port, '127.0.0.1', () => console.log(`trakt export stand-in on 127.0.0.1:${port}${tlsDir ? ' (TLS)' : ''}`));
control.listen(controlPort, '127.0.0.1', () => console.log(`trakt export control on 127.0.0.1:${controlPort}`));
