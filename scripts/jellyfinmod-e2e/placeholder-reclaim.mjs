/* eslint-disable compat/compat, @stylistic/max-statements-per-line -- a Node acceptance runner, not shipped code */
// P1.FU30 flow (d): a retention reclaim leaves a placeholder item, on a real Jellyfin, in items mode. Run after
// placeholder-items.mjs's setup and backfill steps (Fawlty Towers with 4 real episodes and its placeholders, The Matrix
// with a real file), on a local environment only:
//
//   JELLYFINMOD_TEST_URL=http://127.0.0.1:11096/ JELLYFINMOD_PI_HOST_MEDIA=<env>/test-media \
//   JELLYFINMOD_PI_OUT=<file.json> node placeholder-reclaim.mjs
//
// It starts its own Transmission stand-in (seed protection reads it: nothing seeds), turns retention on with a one-minute
// test window for oleksii, marks Fawlty Towers S01E02 and The Matrix played, runs the reclamation task and times how long
// each title takes to stand as the plugin's placeholder item again, with its played mark. Retention is turned off again at
// the end. Signs in as oleksii with an empty password; no credential is read or printed. Exits non-zero on any failure.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const origin = new URL(process.env.JELLYFINMOD_TEST_URL ?? (() => { throw new Error('JELLYFINMOD_TEST_URL is required'); })());
if (!['127.0.0.1', 'localhost'].includes(origin.hostname) || ['8096', '18096', '28096', '48096'].includes(origin.port)) {
    throw new Error('The reclaim runner drives a local environment only, never 8096 or a Pi instance');
}
const HOST_MEDIA = process.env.JELLYFINMOD_PI_HOST_MEDIA ?? (() => { throw new Error('JELLYFINMOD_PI_HOST_MEDIA is required'); })();
const OUT = process.env.JELLYFINMOD_PI_OUT;
const PLUGIN = '6f1a2b3c-4d5e-4f60-9a71-8b2c3d4e5f60';
const BASE = 41110;
const here = dirname(fileURLToPath(import.meta.url));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const results = { checks: [], timings: {} };
let failures = 0;
const record = (check, ok, detail) => {
    if (!ok) failures++;
    results.checks.push({ check, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'} [reclaim] ${check}${detail === undefined ? '' : ' :: ' + JSON.stringify(detail)}`);
};

const client = 'MediaBrowser Client="JellyfinMod Reclaim", Device="node", DeviceId="jfmod-reclaim", Version="1"';
let auth = client;
async function call(method, path, body) {
    const response = await fetch(new URL(path, origin), { method, headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { status: response.status, json };
}
const must = async (method, path, body) => {
    const result = await call(method, path, body);
    if (result.status >= 400) throw new Error(`${method} ${path.split('?')[0]}: ${result.status}`);
    return result.json;
};
async function until(read, timeoutMs, stepMs = 200) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        const value = await read();
        if (value) return { value, seconds: (Date.now() - started) / 1000 };
        await sleep(stepMs);
    }
    return { value: null, seconds: (Date.now() - started) / 1000 };
}

const state = mkdtempSync(join(tmpdir(), 'jfmod-reclaim-'));
const secret = randomUUID();
writeFileSync(join(state, 'secrets'), `TMDB_TOKEN=${secret}\nPROWLARR_KEY=${secret}\nTX_USER=fixture\nTX_PASSWORD=${secret}\n`, { mode: 0o600 });
const standins = spawn(process.execPath, [join(here, 'standins/standins.mjs')], { env: { ...process.env, STANDIN_BIND: '0.0.0.0',
    STANDIN_PORT_BASE: String(BASE), STANDIN_STATE: state, STANDIN_SECRETS: join(state, 'secrets'),
    STANDIN_DOWNLOADS: join(HOST_MEDIA, 'downloads') }, stdio: ['ignore', 'ignore', 'inherit'] });
const control = `http://127.0.0.1:${BASE + 9}`;
let retentionBefore = null;
let windowBefore = 0;
try {
    await until(() => fetch(control + '/state').then(r => r.json()).then(s => s.pid === standins.pid).catch(() => false), 10000);
    await fetch(control + '/fault?service=txauth&mode=off', { method: 'POST' });
    const login = await must('POST', '/Users/AuthenticateByName', { Username: 'oleksii', Pw: '' });
    auth = client + `, Token="${login.AccessToken}"`;
    const user = login.User.Id;

    // Seed protection reads the acquisition client: the stand-in, where nothing seeds.
    const take = (obj, keys) => Object.fromEntries(keys.split(',').filter(k => k in obj).map(k => [k, obj[k]]));
    const download = (await must('GET', '/JellyfinMod/Settings/DownloadClients')).find(x => x.name === 'Stand-in Transmission');
    await must('PATCH', `/JellyfinMod/Settings/DownloadClients/${download.id}`, {
        ...take(download, 'revision,name,kind,baseUrl,username,enabled,label,downloadDirectory,localDirectory,openUrl'),
        baseUrl: `http://host.docker.internal:${BASE + 2}/transmission/rpc`, password: { action: 'clear' } });
    const acquisition = await must('GET', '/JellyfinMod/Settings/Acquisition');
    await must('PATCH', '/JellyfinMod/Settings/Acquisition', { revision: acquisition.revision, enabled: acquisition.enabled,
        downloadClientId: download.id, defaultQualityProfileId: acquisition.defaultQualityProfileId });

    // Retention on, a one-minute test window, oleksii's watches count.
    const config = await must('GET', `/Plugins/${PLUGIN}/Configuration`);
    windowBefore = config.RetentionTestWindowMinutes ?? 0;
    config.RetentionTestWindowMinutes = 1;
    await must('POST', `/Plugins/${PLUGIN}/Configuration`, config);
    retentionBefore = await must('GET', '/JellyfinMod/Settings/Retention');
    await must('PATCH', '/JellyfinMod/Settings/Retention', { enabled: true, reclaimAfterDays: 14, watchedUserMode: 'selectedUser',
        selectedUserId: user, exemptFavourites: false, revision: retentionBefore.revision });
    // The plugin records the switch-on a few seconds after the save; a watch before that does not count.
    await sleep(20000);

    const series = (await must('GET', `/Items?userId=${user}&recursive=true&includeItemTypes=Series&searchTerm=Fawlty`)).Items[0];
    const episodes = (await must('GET', `/Shows/${series.Id}/Episodes?userId=${user}&fields=Path`)).Items;
    const episode = episodes.find(item => item.ParentIndexNumber === 1 && item.IndexNumber === 2 && !item.IsPlaceHolder);
    const movie = (await must('GET', `/Items?userId=${user}&recursive=true&includeItemTypes=Movie&searchTerm=Matrix&fields=Path`)).Items
        .find(item => !item.IsPlaceHolder);
    record('fixture: Fawlty Towers S01E02 and The Matrix are real files', !!episode?.Path && !!movie?.Path,
        { episode: episode?.Path, movie: movie?.Path });
    for (const item of [episode, movie]) {
        await call('DELETE', `/UserPlayedItems/${item.Id}?userId=${user}`);
        await must('POST', `/UserPlayedItems/${item.Id}?userId=${user}`);
    }
    await must('POST', `/UserFavoriteItems/${episode.Id}?userId=${user}`);
    const hostPath = path => join(HOST_MEDIA, path.replace(/^\/test-media\//, ''));

    // Due once the window has passed; the preview says each leaves a placeholder.
    const due = await until(async () => {
        const preview = await must('GET', '/JellyfinMod/Retention/Preview');
        const rows = (preview.items ?? []).filter(row => [episode.Path, movie.Path].includes(row.path) || [episode.Path, movie.Path].includes(row.canonicalPath));
        return rows.length === 2 && rows.every(row => row.state === 'due') ? rows : null;
    }, 240000, 5000);
    record('both files are due after the one-minute window, and the preview says each leaves a placeholder',
        !!due.value && due.value.every(row => row.leavesPlaceholder === true), { seconds: due.seconds, rows: due.value?.map(row => ({ s: row.state, l: row.leavesPlaceholder })) });

    const started = Date.now();
    await must('POST', '/JellyfinMod/Retention/Run');
    const ownEpisode = await until(async () => {
        const list = (await must('GET', `/Shows/${series.Id}/Episodes?userId=${user}&fields=Path`)).Items;
        const found = list.find(item => item.ParentIndexNumber === 1 && item.IndexNumber === 2);
        return found?.Path?.startsWith('jellyfinmod://') && !existsSync(hostPath(episode.Path)) ? found : null;
    }, 120000);
    results.timings.episode_reclaim_to_placeholder = (Date.now() - started) / 1000;
    record('the reclaimed episode\'s file is gone and the episode stands as a placeholder item', !!ownEpisode.value,
        { seconds: ownEpisode.seconds, path: ownEpisode.value?.Path });
    const ownMovie = await until(async () => {
        const list = (await must('GET', `/Items?userId=${user}&recursive=true&includeItemTypes=Movie&searchTerm=Matrix&fields=Path`)).Items;
        const found = list.find(item => item.Name === movie.Name);
        return found?.Path?.startsWith('jellyfinmod://') && !existsSync(hostPath(movie.Path)) ? found : null;
    }, 120000);
    results.timings.movie_reclaim_to_placeholder = (Date.now() - started) / 1000;
    record('the reclaimed movie\'s file is gone and the movie stands as a placeholder item', !!ownMovie.value,
        { seconds: ownMovie.seconds, path: ownMovie.value?.Path });
    // Marks come back by key once Jellyfin's first refresh of the new item has run.
    const marks = await until(async () => {
        const e = ownEpisode.value && await must('GET', `/Items?userId=${user}&ids=${ownEpisode.value.Id}&fields=UserData`);
        const m = ownMovie.value && await must('GET', `/Items?userId=${user}&ids=${ownMovie.value.Id}&fields=UserData`);
        const ed = e?.Items?.[0]?.UserData;
        const md = m?.Items?.[0]?.UserData;
        return ed?.Played && ed?.IsFavorite && md?.Played ? { ed, md } : null;
    }, 90000, 1000);
    results.timings.reclaim_marks_back = marks.seconds;
    record('the placeholders keep the played mark (and the episode its favourite)', !!marks.value, { seconds: marks.seconds });
    const run = await must('GET', '/JellyfinMod/Retention/Runs/Latest');
    record('the reclaim run completed', !!run, run && { state: run.state ?? run.status, reclaimed: run.reclaimed });
} catch (error) {
    record('runner', false, String(error?.message ?? error));
} finally {
    try {
        if (retentionBefore) {
            const now = await must('GET', '/JellyfinMod/Settings/Retention');
            await must('PATCH', '/JellyfinMod/Settings/Retention', { enabled: false, reclaimAfterDays: retentionBefore.reclaimAfterDays,
                watchedUserMode: retentionBefore.watchedUserMode, exemptFavourites: retentionBefore.exemptFavourites, revision: now.revision });
            const config = await must('GET', `/Plugins/${PLUGIN}/Configuration`);
            config.RetentionTestWindowMinutes = windowBefore;
            await must('POST', `/Plugins/${PLUGIN}/Configuration`, config);
        }
    } catch (error) {
        record('restore retention settings', false, String(error?.message ?? error));
    }
    standins.kill();
    if (OUT) writeFileSync(OUT, JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results.timings));
    console.log(failures ? `${failures} check(s) failed` : 'all reclaim checks passed');
    process.exitCode = failures ? 1 : 0;
}
