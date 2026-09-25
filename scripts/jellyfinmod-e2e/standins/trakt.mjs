/* eslint-disable compat/compat, sonarjs/cognitive-complexity -- a Node test boundary, not shipped code */
// P7.Q16 stand-in for api.trakt.tv, for a disposable JellyfinMod container with the stock Trakt plugin (v31) installed.
// It serves exactly what that plugin's device authorization and SyncFromTraktTask call (Trakt/Api/TraktURIs.cs,
// TraktApi.cs at tag v31), over plain HTTP behind the TLS terminator that answers as api.trakt.tv, so the plugin's
// hard-coded https://api.trakt.tv is used unchanged:
//
//   POST /oauth/device/code          -> a device code (interval 1 s)
//   POST /oauth/device/token         -> 400 "pending" until the harness approves the user code, then the tokens
//   POST /oauth/token                -> a refresh (not expected: the token lives 90 days)
//   POST /oauth/revoke               -> 200
//   GET  /sync/watched/movies|shows, /sync/history/movies|episodes (paged, X-Pagination-Page-Count: 1),
//        /sync/playback/movies|episodes, /sync/collection/movies|shows, /recommendations/movies|shows
//   POST /sync/collection[/remove], /sync/history[/remove], /sync/ratings, /scrobble/start|pause|stop -> accepted
//
// Every call must carry the plugin's trakt-api-key and trakt-api-version 2; every user call must carry the access token
// this stand-in issued. The token is generated here and never logged. The history it serves is one generated fixture
// movie and episode S01E01 of one generated fixture show, identified by TMDB and TVDB ids the fixture folders carry.
//
//   TRAKT_BIND=<address the TLS terminator reaches> TRAKT_PORT=<port> TRAKT_CONTROL_PORT=<loopback port> node trakt.mjs
//
// Control (loopback only): GET /state (request log without any credential, the approval state and counters);
// POST /approve (the user entering the device code on trakt.tv); POST /history {"movie":bool,"episode":bool} to
// change what Trakt reports as watched.
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';

const bind = process.env.TRAKT_BIND ?? '127.0.0.1';
const port = Number(process.env.TRAKT_PORT ?? 38115);
const controlPort = Number(process.env.TRAKT_CONTROL_PORT ?? 38118);
// The stock plugin's public client id (Trakt/Api/TraktURIs.cs at v31): an application identifier it sends in every
// request header, published in its source; not a user credential.
const CLIENT_ID = 'bfdd2e032c30c35b368f97ef4ec81587b899bcb028b91a1d4ba5589a4b6a7267';

export const FIXTURE = {
    movie: { title: 'JellyfinMod Trakt Movie', year: 2026, ids: { trakt: 9901011, slug: 'jellyfinmod-trakt-movie', imdb: null, tmdb: 990101 } },
    show: { title: 'JellyfinMod Trakt Show', year: 2026, ids: { trakt: 9901021, slug: 'jellyfinmod-trakt-show', tvdb: '990102', imdb: null, tmdb: 990102, tvrage: null } },
    watchedAt: '2026-09-20T19:30:00.000Z'
};

const state = {
    deviceCode: null, userCode: null, approved: false, codeUsed: false, accessToken: null, refreshToken: null,
    history: { movie: true, episode: true }, requests: [], counters: {}
};
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const log = entry => {
    state.requests.push({ at: new Date().toISOString(), ...entry });
    if (state.requests.length > 500) state.requests.shift();
    state.counters[entry.route] = (state.counters[entry.route] ?? 0) + 1;
    console.log(new Date().toISOString(), entry.method, entry.route, entry.status);
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
const syncResponse = () => ({
    added: { movies: 0, episodes: 0 }, deleted: { movies: 0, episodes: 0 }, updated: { movies: 0, episodes: 0 },
    not_found: { movies: [], shows: [], episodes: [], seasons: [], people: [] }
});
const PAGE = { 'X-Pagination-Page-Count': '1', 'X-Pagination-Page': '1' };

const watchedMovies = () => state.history.movie ? [{
    plays: 1, last_watched_at: FIXTURE.watchedAt, last_updated_at: FIXTURE.watchedAt, movie: FIXTURE.movie
}] : [];
const watchedShows = () => state.history.episode ? [{
    plays: 1, last_watched_at: FIXTURE.watchedAt, last_updated_at: FIXTURE.watchedAt, reset_at: null, show: FIXTURE.show,
    seasons: [{ number: 1, episodes: [{ number: 1, plays: 1, last_watched_at: FIXTURE.watchedAt, last_updated_at: FIXTURE.watchedAt }] }]
}] : [];
const movieHistory = () => state.history.movie ? [{
    id: 1, watched_at: FIXTURE.watchedAt, action: 'watch', type: 'movie', movie: FIXTURE.movie
}] : [];
// The episode carries only its Trakt id, so the plugin matches it by show, season and number (Extensions.IsMatch).
const episodeHistory = () => state.history.episode ? [{
    id: 2, watched_at: FIXTURE.watchedAt, action: 'watch', type: 'episode',
    episode: { season: 1, number: 1, title: 'Pilot', ids: { trakt: 9901031, tvdb: null, imdb: null, tmdb: null, tvrage: null } },
    show: FIXTURE.show
}] : [];

const api = createServer(async (request, response) => {
    const url = new URL(request.url, 'https://api.trakt.tv');
    const route = url.pathname;
    const entry = { method: request.method, route };
    const reply = (status, body, headers) => {
        entry.status = status;
        log(entry);
        send(response, status, body, headers);
    };
    // Every request of the plugin carries its application key and API version (TraktApi.GetHttpClient).
    entry.apiHeaders = request.headers['trakt-api-version'] === '2' && request.headers['trakt-api-key'] === CLIENT_ID;
    if (!entry.apiHeaders) return reply(403, { error: 'missing trakt-api-key or trakt-api-version' });

    if (request.method === 'POST' && route === '/oauth/device/code') {
        const body = await readJson(request);
        if (body?.client_id !== CLIENT_ID) return reply(401, { error: 'invalid_client' });
        state.deviceCode = randomBytes(20).toString('hex');
        state.userCode = 'JFMQ' + randomBytes(2).toString('hex').toUpperCase();
        state.approved = false;
        state.codeUsed = false;
        return reply(200, { device_code: state.deviceCode, user_code: state.userCode, verification_url: 'https://trakt.tv/activate', expires_in: 600, interval: 1 });
    }
    if (request.method === 'POST' && route === '/oauth/device/token') {
        const body = await readJson(request);
        if (!state.deviceCode || !same(body?.code, state.deviceCode) || body?.client_id !== CLIENT_ID) return reply(404, { error: 'invalid_device_code' });
        if (!state.approved) return reply(400, { error: 'authorization_pending' });
        if (state.codeUsed) return reply(409, { error: 'already_used' });
        // One Trakt account: a new authorization replaces the previous token.
        state.codeUsed = true;
        state.accessToken = randomBytes(32).toString('hex');
        state.refreshToken = randomBytes(32).toString('hex');
        return reply(200, {
            access_token: state.accessToken, token_type: 'bearer', expires_in: 7776000, refresh_token: state.refreshToken,
            scope: 'public', created_at: Math.floor(Date.now() / 1000)
        });
    }
    if (request.method === 'POST' && route === '/oauth/token') {
        const body = await readJson(request);
        if (!state.refreshToken || !same(body?.refresh_token, state.refreshToken)) return reply(401, { error: 'invalid_grant' });
        state.accessToken = randomBytes(32).toString('hex');
        return reply(200, { access_token: state.accessToken, token_type: 'bearer', expires_in: 7776000, refresh_token: state.refreshToken, scope: 'public', created_at: Math.floor(Date.now() / 1000) });
    }
    if (request.method === 'POST' && route === '/oauth/revoke') return reply(200, {});

    // Everything else is a user call.
    const bearer = (request.headers.authorization ?? '').replace(/^Bearer /, '');
    entry.authorized = !!state.accessToken && same(bearer, state.accessToken);
    if (!entry.authorized) return reply(401, { error: 'invalid_token' });

    if (request.method === 'GET') {
        switch (route) {
            case '/sync/watched/movies': return reply(200, watchedMovies(), PAGE);
            case '/sync/watched/shows': return reply(200, watchedShows(), PAGE);
            case '/sync/history/movies': return reply(200, movieHistory(), PAGE);
            case '/sync/history/episodes': return reply(200, episodeHistory(), PAGE);
            case '/sync/playback/movies':
            case '/sync/playback/episodes':
            case '/sync/collection/movies':
            case '/sync/collection/shows':
            case '/recommendations/movies':
            case '/recommendations/shows':
                return reply(200, [], PAGE);
            default: return reply(404, { error: 'not found' });
        }
    }
    if (request.method === 'POST') {
        await readJson(request);
        if (['/sync/collection', '/sync/collection/remove', '/sync/history', '/sync/history/remove', '/sync/ratings'].includes(route)) return reply(201, syncResponse());
        if (route.startsWith('/scrobble/')) return reply(201, { id: '1', action: route.slice('/scrobble/'.length), progress: 0 });
    }
    return reply(404, { error: 'not found' });
});

const control = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://control');
    if (request.method === 'GET' && url.pathname === '/state') {
        return send(response, 200, {
            deviceCodeIssued: !!state.deviceCode, approved: state.approved, tokenIssued: !!state.accessToken,
            history: state.history, counters: state.counters, requests: state.requests
        });
    }
    if (request.method === 'POST' && url.pathname === '/approve') {
        if (!state.deviceCode) return send(response, 409, { error: 'no device code yet' });
        state.approved = true;
        return send(response, 200, { approved: true });
    }
    if (request.method === 'POST' && url.pathname === '/history') {
        const body = await readJson(request);
        if (typeof body?.movie === 'boolean') state.history.movie = body.movie;
        if (typeof body?.episode === 'boolean') state.history.episode = body.episode;
        return send(response, 200, { history: state.history });
    }
    return send(response, 404, { error: 'not found' });
});

api.listen(port, bind, () => console.log(`trakt stand-in on ${bind}:${port}`));
control.listen(controlPort, '127.0.0.1', () => console.log(`trakt control on 127.0.0.1:${controlPort}`));
