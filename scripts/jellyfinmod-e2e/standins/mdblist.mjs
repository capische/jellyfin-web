/* eslint-disable compat/compat, sonarjs/cognitive-complexity -- a Node test boundary, not shipped code */
// Phase 9 (R8) stand-in for api.mdblist.com, for the isolated instance only. It serves the shape the R1 evidence records:
//
//   GET /tmdb/{movie|show}/{tmdbId}?apikey=<key>  -> {title, year, type, ids, score, score_average, ratings: [{source, value, score, votes, url}]}
//
// with X-RateLimit-* headers, scripted per mode: full (default), partial (no audience score), unauthorized (401),
// errorkey (200 with an "Invalid API key" error), ratelimited (429, Retry-After: 120), fail (503), slow (answers after 20 s),
// malformed, notfound (404). A wrong key is answered 401 whatever the mode.
//
//   MDBLIST_BIND=<address the container reaches> MDBLIST_PORT=<port> MDBLIST_CONTROL_PORT=<loopback port>
//   MDBLIST_KEY_FILE=<0600 file holding the fixture key> node mdblist.mjs
//
// The key is read from its file, compared in constant time and never logged or returned. Control (loopback only):
// GET /state (each call's time, kind, id and whether the key matched — never the key or the query string),
// POST /mode {"mode": "...", "titles": {"<tmdbId>": "<mode>"}}, POST /reset (clears the call log).
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';

const bind = process.env.MDBLIST_BIND ?? '127.0.0.1';
const port = Number(process.env.MDBLIST_PORT ?? 18120);
const controlPort = Number(process.env.MDBLIST_CONTROL_PORT ?? 18121);
const key = readFileSync(process.env.MDBLIST_KEY_FILE ?? 'mdblist-key', 'utf8').trim();
if (key.length < 16) throw new Error('the fixture key file is missing or too short');

const state = { mode: 'full', titles: {}, calls: [] };
const same = value => typeof value === 'string' && value.length === key.length && timingSafeEqual(Buffer.from(value), Buffer.from(key));
const send = (response, status, body, headers = {}) => {
    response.writeHead(status, { 'Content-Type': 'application/json', 'X-RateLimit-Limit': '1000', 'X-RateLimit-Remaining': '900', ...headers });
    response.end(typeof body === 'string' ? body : JSON.stringify(body));
};

const ratings = (id, full) => {
    const list = [
        { source: 'imdb', value: 8.1, score: 81, votes: 250000, url: `https://www.imdb.com/title/tt${id}/` },
        { source: 'metacritic', value: 74, score: 74, votes: 52, url: null },
        { source: 'metacriticuser', value: 8.4, score: 84, votes: 1300, url: null },
        { source: 'trakt', value: 83, score: 83, votes: 21000, url: null },
        { source: 'tomatoes', value: 91, score: 91, votes: 310, url: null },
        { source: 'letterboxd', value: 4.1, score: 82, votes: 90000, url: null },
        { source: 'rogerebert', value: 3.5, score: 88, votes: null, url: null },
        { source: 'tmdb', value: 79, score: 79, votes: 15000, url: null },
        { source: 'myanimelist', value: 7.2, score: 72, votes: 10, url: null }
    ];
    if (full) list.push({ source: 'popcorn', value: 88, score: 88, votes: 25000, url: null });
    return list;
};

createServer((request, response) => {
    const url = new URL(request.url, 'http://boundary');
    const match = /^\/tmdb\/(movie|show)\/(\d+)$/.exec(url.pathname);
    if (request.method !== 'GET' || !match) return send(response, 404, { error: 'Not found' });
    const [, kind, id] = match;
    const keyOk = same(url.searchParams.get('apikey'));
    const mode = state.titles[id] ?? state.mode;
    state.calls.push({ at: new Date().toISOString(), kind, id: Number(id), keyOk, mode });
    if (state.calls.length > 5000) state.calls.shift();
    console.log(new Date().toISOString(), kind, id, keyOk ? 'key ok' : 'wrong key', mode);
    if (!keyOk && mode !== 'errorkey') return send(response, 401, { error: 'Invalid API key!' });
    const body = full => ({
        title: `Fixture ${id}`, year: 2026, type: kind, ids: { imdb: `tt${id}`, tmdb: Number(id), trakt: 1, tvdb: null },
        score: 82, score_average: 82, ratings: ratings(id, full)
    });
    switch (mode) {
        case 'unauthorized': return send(response, 401, { error: 'Invalid API key!' });
        case 'errorkey': return send(response, 200, { response: false, error: 'Invalid API key!' });
        case 'ratelimited': return send(response, 429, { error: 'API limit reached' }, { 'Retry-After': '120', 'X-RateLimit-Remaining': '0' });
        case 'fail': return send(response, 503, 'upstream down');
        case 'slow': return setTimeout(() => send(response, 200, body(true)), 20000);
        case 'malformed': return send(response, 200, '{"title":"x","ratings":"not an array"');
        case 'notfound': return send(response, 404, { error: 'Not found' });
        case 'partial': return send(response, 200, body(false));
        default: return send(response, 200, body(true));
    }
}).listen(port, bind, () => console.log(`MDBList stand-in on ${bind}:${port}`));

createServer((request, response) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
        if (request.method === 'GET' && request.url === '/state') return send(response, 200, state);
        if (request.method === 'POST' && request.url === '/reset') {
            state.calls = [];
            return send(response, 200, { ok: true });
        }
        if (request.method === 'POST' && request.url === '/mode') {
            try {
                const change = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
                if (change.mode) state.mode = change.mode;
                if (change.titles) state.titles = change.titles;
                return send(response, 200, { mode: state.mode, titles: state.titles });
            } catch {
                return send(response, 400, { error: 'bad json' });
            }
        }
        return send(response, 404, { error: 'unknown control' });
    });
}).listen(controlPort, '127.0.0.1', () => console.log(`control on 127.0.0.1:${controlPort}`));
