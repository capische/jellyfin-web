/* eslint-disable */
// P4.FU12 (B1, B3, B4, B5): how long the plugin's own placeholder actions take to reach Jellyfin and the clients. API and
// websocket only (no browser), against a LOCAL environment (a pool environment by JFMOD_ENV, never 8096 or a Pi instance), signed
// in as oleksii with an empty password. Needs the FU29 fixtures (fixtures-bravo.sh in the session scratchpad: Fawlty Towers with
// real and missing episodes, a movie with a real file) and the clip at /test-media/clip.webm. Measured from the request:
//   - Remove Placeholders on the TV and Movies libraries: until Jellyfin holds no placeholder item, and the LibraryChanged frame;
//     nothing written back afterwards;
//   - Sync Now with both libraries having work: until each library's placeholders are Jellyfin items again (not one waiting for
//     another's scan), and the frames;
//   - Remove Entry of a placeholder-only movie: until its item is gone from Jellyfin (it was kept for minutes, in an emptied folder);
//   - a real file copied in beside an episode's placeholder: until Jellyfin binds the file, and until the placeholder is gone;
//   - Remove Placeholders right after Sync Now: no placeholder item or file is back after 75 s and no delete repair ran.
//   JFMOD_ENV=bravo node placeholder-flows.mjs <label>
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const workspace = resolve(here, '../../..');
const envName = process.env.JFMOD_ENV ?? 'bravo';
if (!/^[a-z]+$/.test(envName) || envName === 'alpha') throw Error('bad environment');
const port = readFileSync(join(workspace, 'envs/pool.list'), 'utf8').split('\n').map(line => line.trim().split(/\s+/)).find(([name]) => name === envName)?.[1];
if (!port) throw Error('unknown environment ' + envName);
const label = process.argv[2] ?? 'run';
const base = `http://127.0.0.1:${port}`;
const container = 'jellyfinmod-' + envName;
const output = resolve(here, '../../node_modules/.cache/placeholder-flows');
mkdirSync(output, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const client = 'MediaBrowser Client="Placeholder Flows", Device="node", DeviceId="placeholder-flows", Version="1"';
let auth = client;
let token = '';
const api = async (method, path, body) => {
    const response = await fetch(base + path, { method, headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    if (!response.ok) throw Error(`${method} ${path.split('?')[0]}: ${response.status} ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
};
const until = async (read, message, timeout = 180000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { const value = await read(); if (value) return value; await sleep(200); }
    return null;
};
const exec = (...args) => execFileSync('docker', ['exec', container, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const info = await api('GET', '/System/Info/Public');
if (info.ServerName !== 'jellyfinmod-' + envName) throw Error(envName + ' identity mismatch');
const login = await api('POST', '/Users/AuthenticateByName', { Username: 'oleksii', Pw: '' });
token = login.AccessToken;
auth = client + `, Token="${token}"`;
const libraries = await api('GET', '/Library/VirtualFolders');
const tv = libraries.find(l => l.CollectionType === 'tvshows');
const movies = libraries.find(l => l.CollectionType === 'movies');

// LibraryChanged frames, with their time.
const frames = [];
const socket = new WebSocket(`ws://127.0.0.1:${port}/socket?ApiKey=${token}&deviceId=placeholder-flows-ws`);
socket.onmessage = event => {
    try {
        const message = JSON.parse(String(event.data));
        if (message.MessageType === 'ForceKeepAlive') socket.send(JSON.stringify({ MessageType: 'KeepAlive' }));
        if (message.MessageType === 'LibraryChanged') frames.push({ at: performance.now(), data: message.Data });
    } catch {}
};
await until(() => socket.readyState === 1, 'socket', 10000);

const placeholders = async library => (await api('GET', `/Items?parentId=${library.ItemId}&recursive=true&includeItemTypes=Movie,Episode&isPlaceHolder=true&fields=Path`)).Items;
const startedAt = performance.now();
const results = { label, env: envName, started: new Date().toISOString(), steps: {} };
const seconds = (from, to) => to == null ? null : +((to - from) / 1000).toFixed(2);
const firstFrame = (from, test) => frames.find(f => f.at >= from && test(f.data))?.at;
const waitFrame = async (from, test) => { const at = await until(() => firstFrame(from, test), 'frame', 5000); return at ?? undefined; };

// 0. A stub-only movie entry for Remove Entry (Jellyfin's TMDb connection resolves it; no token is configured).
let movieEntry = (await api('GET', '/JellyfinMod/Entries?mediaType=movie&limit=50')).items.find(e => e.tmdbId === 603);
if (!movieEntry) movieEntry = await api('POST', '/JellyfinMod/Entries', { mediaType: 'movie', tmdbId: 603, targetLibraryId: movies.ItemId });
await until(async () => (await placeholders(movies)).some(item => /Matrix \(1999\)/.test(item.Path ?? '')), 'matrix stub', 60000);
const stubIdsOf = async library => new Set((await placeholders(library)).map(i => i.Id));
// Both libraries start with placeholders Jellyfin holds (a first Sync Now, not measured).
// The series' full episode lists (a detail page opening loads them): the missing episodes are what get placeholders.
for (const entry of (await api('GET', '/JellyfinMod/Entries?mediaType=series&limit=50')).items.filter(e => ['Fawlty Towers', 'Adolescence'].includes(e.title)))
    await api('POST', `/JellyfinMod/Entries/${entry.id}/EpisodeList`).catch(() => {});
for (let attempt = 0; attempt < 24; attempt++) {
    await api('POST', '/JellyfinMod/Placeholders/SyncNow').catch(() => {});
    if (await until(async () => (await placeholders(tv)).length > 0 && (await placeholders(movies)).length > 0, 'starting stubs', 10000)) break;
}

if ((await placeholders(tv)).length === 0 || (await placeholders(movies)).length === 0) throw Error('no starting placeholders in both libraries');
// The first sync's own discovery must be over, or it re-creates items for files removed meanwhile (a race of the test, not measured).
await sleep(15000);

// 1. Remove Placeholders, both libraries.
for (const [name, library] of [['tv', tv], ['movies', movies]]) {
    const before = (await placeholders(library)).length;
    const idsBefore = await stubIdsOf(library);
    const frameFrom = performance.now();
    const t0 = performance.now();
    await api('POST', `/JellyfinMod/Placeholders/${library.ItemId}/Remove`);
    const answered = performance.now();
    const gone = await until(async () => (await placeholders(library)).length === 0 ? performance.now() : null, 'removed', 180000);
    const frame = await waitFrame(frameFrom, data => (data.ItemsRemoved ?? []).some(id => idsBefore.has(id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5'))) || (data.ItemsRemoved ?? []).length > 0);
    await sleep(5000);
    const back = (await placeholders(library)).length;
    results.steps['removePlaceholders-' + name] = { before, answeredSeconds: seconds(t0, answered), itemsGoneSeconds: seconds(t0, gone), frameSeconds: seconds(t0, frame), writtenBackAfter5s: back };
    console.log('removePlaceholders-' + name, JSON.stringify(results.steps['removePlaceholders-' + name]));
}

// 2. Sync Now with both libraries having work.
{
    const t0 = performance.now();
    await api('POST', '/JellyfinMod/Placeholders/SyncNow');
    const answered = performance.now();
    const tvBack = await until(async () => (await placeholders(tv)).length > 0 ? performance.now() : null, 'tv', 180000);
    const moviesBack = await until(async () => (await placeholders(movies)).length > 0 ? performance.now() : null, 'movies', 180000);
    const frame = await waitFrame(t0, data => (data.ItemsAdded ?? []).length > 0);
    results.steps.syncNow = { answeredSeconds: seconds(t0, answered), tvItemsSeconds: seconds(t0, tvBack), moviesItemsSeconds: seconds(t0, moviesBack),
        firstAddedFrameSeconds: seconds(t0, frame), tvStubs: (await placeholders(tv)).length, movieStubs: (await placeholders(movies)).length };
    console.log('syncNow', JSON.stringify(results.steps.syncNow));
}

// 3. A real file copied in beside an episode's placeholder.
{
    const stub = (await placeholders(tv)).find(item => /Fawlty Towers/.test(item.Path ?? '') && /S01E0[4-6]\.disc$/.test(item.Path));
    if (!stub) throw Error('no Fawlty Towers placeholder to copy beside');
    const real = stub.Path.replace(/\.disc$/, '.webm');
    const t0 = performance.now();
    exec('cp', '/test-media/clip.webm', real + '.tmp');
    exec('mv', real + '.tmp', real);
    const bound = await until(async () => {
        const items = (await api('GET', `/Items?parentId=${tv.ItemId}&recursive=true&includeItemTypes=Episode&fields=Path,MediaSources`)).Items;
        return items.some(item => item.Path === real && !item.IsPlaceHolder) ? performance.now() : null;
    }, 'bound', 240000);
    const stubGone = await until(async () => {
        try { exec('test', '-e', stub.Path); return null; } catch { return performance.now(); }
    }, 'stub gone', 240000);
    const stubItemGone = await until(async () => {
        const items = (await api('GET', `/Items?parentId=${tv.ItemId}&recursive=true&includeItemTypes=Episode&fields=Path,MediaSources`)).Items;
        const merged = items.filter(item => item.Path === real);
        return merged.length && merged.every(item => (item.MediaSources ?? []).length === 1) && !items.some(item => item.Path === stub.Path) ? performance.now() : null;
    }, 'one source', 240000);
    const frame = await waitFrame(t0, data => (data.ItemsAdded ?? []).length > 0 || (data.ItemsUpdated ?? []).length > 0);
    results.steps.copiedFile = { jellyfinBoundSeconds: seconds(t0, bound), stubFileGoneSeconds: seconds(t0, stubGone), oneVersionSeconds: seconds(t0, stubItemGone),
        stubGoneAfterBoundSeconds: bound && stubGone ? seconds(bound, stubGone) : null, firstFrameSeconds: seconds(t0, frame) };
    console.log('copiedFile', JSON.stringify(results.steps.copiedFile));
}

// 4. Remove Entry of the stub-only movie.
{
    const idsBefore = await stubIdsOf(movies);
    const stub = (await placeholders(movies)).find(item => /Matrix \(1999\)/.test(item.Path ?? ''));
    const t0 = performance.now();
    const response = await fetch(`${base}/JellyfinMod/Entries/${movieEntry.entry?.id ?? movieEntry.id}`, { method: 'DELETE', headers: { Authorization: auth } });
    const answered = performance.now();
    const gone = await until(async () => (await placeholders(movies)).some(item => item.Id === stub?.Id) ? null : performance.now(), 'entry item gone', 240000);
    const frame = await waitFrame(t0, data => (data.ItemsRemoved ?? []).length > 0);
    results.steps.removeEntry = { status: response.status, answeredSeconds: seconds(t0, answered), itemGoneSeconds: seconds(t0, gone), frameSeconds: seconds(t0, frame) };
    console.log('removeEntry', JSON.stringify(results.steps.removeEntry));
}

// 5. Remove Placeholders while Sync Now's discovery may still run (the finisher's race, P4.FU12): the removal waits for the
// discovery, so no item made late is later read as a user's delete and written back. Checked past Jellyfin's 60 s monitor delay.
{
    const stubFiles = () => Number(exec('sh', '-c', 'find /test-media/tv -name "*.disc" | wc -l').trim());
    await api('POST', `/JellyfinMod/Placeholders/${tv.ItemId}/Remove`);
    await until(async () => stubFiles() === 0, 'tv clean', 30000);
    await sleep(2000);
    // Sync Now answers at once and writes later: the removal goes the moment its stubs are on disk, while its discovery runs.
    await api('POST', '/JellyfinMod/Placeholders/SyncNow');
    const written = await until(async () => (stubFiles() > 0 ? performance.now() : null), 'stubs written', 60000);
    const t0 = performance.now();
    await api('POST', `/JellyfinMod/Placeholders/${tv.ItemId}/Remove`);
    const answered = performance.now();
    await sleep(75000);
    const items = (await placeholders(tv)).length;
    const files = stubFiles();
    const repairs = execFileSync('docker', ['logs', '--since', '90s', container], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
        .split('\n').filter(line => /delete repair batch/.test(line)).length;
    results.steps.removeDuringSync = { writtenToRemoveSeconds: written ? seconds(written, t0) : null, answeredSeconds: seconds(t0, answered), placeholderItemsAfter75s: items, stubFilesAfter75s: Number(files), repairBatches: repairs };
    console.log('removeDuringSync', JSON.stringify(results.steps.removeDuringSync));
}

results.frames = frames.map(f => ({ at: seconds(startedAt, f.at), added: (f.data.ItemsAdded ?? []).length, removed: (f.data.ItemsRemoved ?? []).length, updated: (f.data.ItemsUpdated ?? []).length, folders: (f.data.FoldersAddedTo ?? []).length }));
socket.close();
writeFileSync(join(output, `${label}.json`), JSON.stringify(results, null, 2));
await api('DELETE', '/Devices?id=placeholder-flows').catch(() => {});
console.log('done');
