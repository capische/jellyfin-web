/* eslint-disable compat/compat, no-restricted-globals -- a Node acceptance runner, not shipped code */
// P1.FU13 live check: the plugin reaches TMDB through Jellyfin's built-in TMDb connection. Read-only.
//
//   JELLYFINMOD_TEST_URL=http://<host>:<isolated-port>/ node tmdb-via-jellyfin.mjs
//
// Signs in as oleksii with an empty password, over HTTP only (no browser), and:
// 1. reads the discovery settings and says which source the plugin uses now (`token` or `jellyfin`);
// 2. runs the administrator diagnostic `POST /JellyfinMod/Settings/Discovery/Test?source=jellyfin`, which goes through
//    Jellyfin's TmdbClientManager whatever token is saved: a real series details call and one season fetch of
//    Breaking Bad (TMDB 1396, 5 seasons, 7 episodes in season 1), counts only;
// 3. reads the discovery settings again: the diagnostic recorded nothing (revision, verified and verifiedAt unchanged);
// 4. only when no token is saved (source `jellyfin`), one real discovery search through the ordinary path, which then
//    also goes through Jellyfin's connection; with a saved token it is NOT RUN, since it would test the token.
// Nothing is saved or changed. The access token is never printed. The plugin log names the source of each real call
// ("TMDB request … through Jellyfin's TMDb connection").
const testUrl = new URL(process.env.JELLYFINMOD_TEST_URL ?? (() => { throw new Error('JELLYFINMOD_TEST_URL is required'); })());
// The leased mod instances, or a local environment of this Mac (alpha..echo on 127.0.0.1, envs/pool.list); never production on 8096 of the Pi.
const localEnvironment = ['127.0.0.1', 'localhost'].includes(testUrl.hostname) && ['8096', '9096', '10096', '11096', '12096', '58096'].includes(testUrl.port);
if (localEnvironment) {
    const publicInfo = await fetch(new URL('/System/Info/Public', testUrl)).then(response => response.json()).catch(() => ({}));
    if (!/^jellyfinmod-(alpha|bravo|charlie|delta|echo|local)$/.test(publicInfo.ServerName ?? '')) throw new Error(`${testUrl.host} answers as "${publicInfo.ServerName}", not as a JellyfinMod local environment`);
}
if (!localEnvironment && !['18096', '28096', '48096'].includes(testUrl.port)) throw new Error('Runs on the isolated instances only');
const origin = testUrl.origin;
const client = 'MediaBrowser Client="fu13-tmdb", Device="fu13-tmdb", DeviceId="fu13-tmdb-via-jellyfin", Version="1.0"';
const results = [];
const record = (check, ok, detail) => {
    results.push({ check, ok });
    console.log(`${ok === null ? 'NOT RUN' : ok ? 'PASS' : 'FAIL'} ${check}${detail === undefined ? '' : ' :: ' + JSON.stringify(detail)}`);
};

async function call(method, path, token, body) {
    const headers = { Authorization: token ? `${client}, Token="${token}"` : client };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(origin + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: response.status, json };
}

const signIn = await call('POST', '/Users/AuthenticateByName', null, { Username: 'oleksii', Pw: '' });
if (signIn.status !== 200) throw new Error(`sign-in as oleksii failed: ${signIn.status}`);
const token = signIn.json.AccessToken;

const health = await call('GET', '/JellyfinMod/Health', token);
record('Health answers for oleksii', health.status === 200, { status: health.status, version: health.json?.Version ?? health.json?.version });

const before = await call('GET', '/JellyfinMod/Settings/Discovery', token);
const source = before.json?.source;
record('The discovery settings name the source in use', before.status === 200 && ['token', 'jellyfin', 'none'].includes(source),
    { status: before.status, source, tokenConfigured: before.json?.tokenConfigured });

const started = Date.now();
const probe = await call('POST', '/JellyfinMod/Settings/Discovery/Test?source=jellyfin', token);
const counts = /answered: (\d+) seasons, (\d+) episodes in season 1/.exec(probe.json?.message ?? '');
record('The Jellyfin-source diagnostic reads a series and a season through Jellyfin\'s TMDb connection',
    probe.status === 200 && probe.json?.ok === true && probe.json?.code === 'ok' && probe.json?.source === 'jellyfin' &&
        !!counts && Number(counts[1]) >= 5 && Number(counts[2]) >= 7,
    { status: probe.status, ok: probe.json?.ok, code: probe.json?.code, source: probe.json?.source, message: probe.json?.message,
        seconds: (Date.now() - started) / 1000 });

const after = await call('GET', '/JellyfinMod/Settings/Discovery', token);
const same = key => after.json?.[key] === before.json?.[key];
record('The diagnostic recorded nothing', after.status === 200 && ['revision', 'verified', 'verifiedAt', 'source', 'tokenConfigured'].every(same),
    { revision: after.json?.revision, verified: after.json?.verified });

if (source === 'jellyfin') {
    const search = await call('GET', '/JellyfinMod/Discover/Search?q=Breaking%20Bad&type=series', token);
    const items = search.json?.items ?? [];
    record('With no token saved, an ordinary discovery search answers through Jellyfin\'s TMDb connection',
        search.status === 200 && Array.isArray(items) && search.json?.nextPage === null,
        { status: search.status, items: items.length, nextPage: search.json?.nextPage, skipped: search.json?.skipped });
} else {
    record('An ordinary discovery search through Jellyfin\'s TMDb connection', null, `the instance uses source "${source}", so a search would not use it`);
}

const failed = results.filter(result => result.ok === false).length;
console.log(`${results.length - failed} of ${results.length} passed or not run, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
