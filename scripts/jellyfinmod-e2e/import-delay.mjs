/* eslint-disable */
// P4.FU11: real local import timing, no intercepted responses. Seed with import-delay-fixture.py (JFMOD_ENV=<name>) while
// the environment is stopped (charlie unless JFMOD_ENV names another), start with JFMOD_TMDB=0, then run this script. Always reset charlie afterwards.
// Records 100 ms DOM samples, HTTP item polls, LibraryChanged frames, web reads and filesystem swaps.
// node import-delay.mjs before|after [chromium|chrome]
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const workspace = resolve(here, '../../..');
// The environment under test: charlie by default (P4.FU11), any other pool environment by JFMOD_ENV (its port is read from
// envs/pool.list), with its own stand-in ports so two sessions' stand-ins never meet.
const envName = process.env.JFMOD_ENV ?? 'charlie';
if (!/^[a-z]+$/.test(envName) || envName === 'alpha') throw Error('bad environment');
const poolPort = readFileSync(join(workspace, 'envs/pool.list'), 'utf8').split('\n').map(line => line.trim().split(/\s+/))
    .find(([name]) => name === envName)?.[1];
if (!poolPort) throw Error('unknown environment ' + envName);
const portBase = Number(process.env.IMPORT_DELAY_PORT_BASE ?? 39110);
const state = join(workspace, 'envs/pool', envName);
const output = resolve(here, '../../node_modules/.cache/import-delay');
const label = process.argv[2] ?? 'before';
const tier = process.argv[3] ?? 'chromium';
if (!/^[a-z0-9-]+$/.test(label)) throw Error('bad output label');
const fixtures = JSON.parse(readFileSync(join(output, 'fixtures.json')));
const base = `http://127.0.0.1:${poolPort}`;
const control = `http://127.0.0.1:${portBase + 9}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const secret = randomUUID();
const standinState = mkdtempSync(join(output, 'standin-'));
const secretFile = join(standinState, 'secrets');
writeFileSync(secretFile, `TMDB_TOKEN=${secret}\nPROWLARR_KEY=${secret}\nTX_USER=fixture\nTX_PASSWORD=${secret}\n`, { mode: 0o600 });
const standins = spawn(process.execPath, [join(here, 'standins/standins.mjs')], { env: { ...process.env,
    STANDIN_BIND: '0.0.0.0', STANDIN_PORT_BASE: String(portBase), STANDIN_STATE: standinState,
    STANDIN_SECRETS: secretFile, STANDIN_DOWNLOADS: join(state, 'test-media/downloads') }, stdio: ['ignore', 'ignore', 'inherit'] });
const client = 'MediaBrowser Client="Import Delay Measurement", Device="node", DeviceId="import-delay-api", Version="1"';
let auth = client;
async function api(method, path, body) {
    const response = await fetch(base + path, { method, headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    if (!response.ok) throw Error(`${method} ${path.split('?')[0]}: ${response.status} ${text.slice(0, 800)}`);
    return text ? JSON.parse(text) : null;
}
async function ctl(path, body) {
    const response = await fetch(control + path, { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined });
    if (!response.ok) throw Error(`standin ${path.split('?')[0]}: ${response.status}`);
    return response.json();
}
async function until(read, message, timeout = 180000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { const value = await read(); if (value) return value; await sleep(200); }
    throw Error(message);
}
let browser;
const results = { label, tier, started: new Date().toISOString(), cases: [] };
try {
    await until(() => fetch(control + '/state').then(r => r.json()).then(s => s.pid === standins.pid).catch(() => false), 'own standins unavailable', 10000);
    await ctl('/fault?service=txauth&mode=off');
    const info = await api('GET', '/System/Info/Public');
    if (info.ServerName !== 'jellyfinmod-' + envName) throw Error(envName + ' identity mismatch');
    const login = await api('POST', '/Users/AuthenticateByName', { Username: 'oleksii', Pw: '' });
    auth = client + `, Token="${login.AccessToken}"`;
    const user = login.User.Id;
    // IMPORT_DELAY_ORDINARY=open|blocked (P4.FU12, B7): also a page for an ordinary user, who cannot read the queue, on the season page
    // of the episode case; `blocked` stops the page's websocket from opening, so only the fallback can move it.
    const ordinaryMode = process.env.IMPORT_DELAY_ORDINARY;
    if (ordinaryMode && !(await api('GET', '/Users')).some(u => u.Name === 'ordinary')) await api('POST', '/Users/New', { Name: 'ordinary', Password: '' });
    const health = await api('GET', '/JellyfinMod/Health');
    results.build = { version: health.Version, web: health.Web.BundleId, pluginSha256: createHash('sha256').update(readFileSync(join(state, 'config/plugins/JellyfinMod/JellyfinMod.dll'))).digest('hex') };
    // Configure and verify the existing stand-in rows through the real settings API. No TMDB token is set.
    const take = (obj, keys) => Object.fromEntries(keys.split(',').filter(k => k in obj).map(k => [k, obj[k]]));
    const indexer = (await api('GET', '/JellyfinMod/Settings/Indexers')).find(x => x.name === 'Stand-in Indexer');
    await api('PATCH', `/JellyfinMod/Settings/Indexers/${indexer.id}`, { ...take(indexer, 'revision,name,baseUrl,enabled,automateTitleMatches,categories,priority,downloadHosts,minimumSeedRatio,minimumSeedMinutes,minIntervalSeconds,dailyQueryBudget'), baseUrl: `http://host.docker.internal:${portBase + 1}/1/api`,
        apiKey: { action: 'replace', value: secret }, minIntervalSeconds: 0 });
    await api('POST', `/JellyfinMod/Settings/Indexers/${indexer.id}/Test`);
    const download = (await api('GET', '/JellyfinMod/Settings/DownloadClients')).find(x => x.name === 'Stand-in Transmission');
    // Strip read-only DTO fields before writes (the API rejects unknown properties).
    const d = take(download, 'revision,name,kind,baseUrl,username,enabled,label,downloadDirectory,localDirectory,openUrl');
    await api('PATCH', `/JellyfinMod/Settings/DownloadClients/${download.id}`, { ...d, baseUrl: `http://host.docker.internal:${portBase + 2}/transmission/rpc`, password: { action: 'clear' } });
    await api('POST', `/JellyfinMod/Settings/DownloadClients/${download.id}/Test`);
    const settings = await api('GET', '/JellyfinMod/Settings/Acquisition');
    await api('PATCH', '/JellyfinMod/Settings/Acquisition', { revision: settings.revision, enabled: true,
        downloadClientId: download.id, defaultQualityProfileId: settings.defaultQualityProfileId });
    const staging = join(state, 'test-media/staging');
    mkdirSync(staging, { recursive: true });
    execFileSync('docker', ['exec', 'jellyfinmod-' + envName, '/usr/lib/jellyfin-ffmpeg/ffmpeg', '-v', 'error', '-y',
        '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=24', '-t', '3', '-c:v', 'libx264', '-preset', 'ultrafast',
        '/test-media/staging/clip.mkv']);
    for (const library of await api('GET', '/Library/VirtualFolders')) {
        const options = library.LibraryOptions;
        options.TypeOptions = ['Movie', 'Series', 'Season', 'Episode'].map(Type => ({ Type, MetadataFetchers: [], ImageFetchers: [] }));
        options.SubtitleDownloadLanguages = [];
        options.DisabledSubtitleFetchers = ['Open Subtitles'];
        await api('POST', '/Library/VirtualFolders/LibraryOptions', { Id: library.ItemId, LibraryOptions: options });
    }
    await api('POST', '/Library/Refresh');
    await until(async () => (await api('GET', '/Items?recursive=true&includeItemTypes=Movie,Episode&fields=Path,ProviderIds')).Items
        .filter(x => x.Path?.includes('JellyfinMod Import Delay') && x.IsPlaceHolder).length === 6, 'six placeholders not indexed');
    browser = await chromium.launch({ headless: true, args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'], ...(tier === 'chrome' ? { channel: 'chrome' } : {}) });
    const signIn = async (page, name = 'oleksii') => {
        await page.goto(base + '/web/');
        await page.waitForFunction(() => !!window.ApiClient);
        await page.locator('.btnManual').first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
        if (!await page.locator('#txtManualName').isVisible()) await page.locator('.btnManual').first().evaluate(n => n.click());
        // As in missing-as-media.mjs, let the legacy login controller finish attaching before submitting the form.
        await page.waitForTimeout(1000);
        await page.locator('#txtManualName').fill(name);
        await page.locator('#txtManualPassword').fill('');
        await page.locator('button:visible').filter({ hasText: 'Sign In' }).first().click();
        await page.waitForFunction(() => location.hash.startsWith('#/home'));
    };
    for (const fx of fixtures.filter(f => !process.env.IMPORT_DELAY_CASE || f.case === process.env.IMPORT_DELAY_CASE)) {
        const result = { case: fx.case, events: [], dom: {}, operations: [], network: [], websockets: [], errors: [] };
        results.cases.push(result);
        const event = (kind, data) => { result.events.push({ at: Date.now(), kind, data }); writeFileSync(join(output, `${label}-${tier}.json`), JSON.stringify(results, null, 2)); if (kind === 'queue') console.log(fx.case, data.map(r => r.state).join(',')); };
        const items = (await api('GET', '/Items?recursive=true&includeItemTypes=Series,Season,Movie,Episode&fields=Path,MediaSources,ProviderIds')).Items;
        const selected = items.filter(x => x.Path?.includes(fx.title));
        const stubs = selected.filter(x => x.IsPlaceHolder && ['Episode', 'Movie'].includes(x.Type));
        if (stubs.length !== (fx.episodes.length || 1)) throw Error(`${fx.case}: placeholder count ${stubs.length}`);
        const series = selected.find(x => x.Type === 'Series');
        const season = selected.find(x => x.Type === 'Season');
        // The library grid's card of the title too (P2-6 of the 2026-10-22 review): a page that never reads the title's detail.
        // It is found by its name, because a movie's card is a new item once the file is in.
        const grid = fx.case === 'movie'
            ? { name: 'grid-movie-card', url: `#/movies?topParentId=${fx.library.replaceAll('-', '').toLowerCase()}&collectionType=movies`, target: '.page:not(.hide) .card', text: fx.title }
            : { name: 'grid-series-card', url: `#/tv?topParentId=${fx.library.replaceAll('-', '').toLowerCase()}&collectionType=tvshows`, target: '.page:not(.hide) .card', text: fx.title };
        const surfaces = fx.case === 'movie' ? [{ name: 'movie', id: stubs[0].Id, target: '.page:not(.hide)' }, grid]
            : [{ name: 'season-rows', id: season.Id, target: '.page:not(.hide) #listChildrenCollapsible' },
                { name: 'series-season-card', id: series.Id, target: `.page:not(.hide) .card[data-id="${season.Id}"]` }, grid,
                ...(ordinaryMode && fx.case === 'episode' ? [{ name: 'ordinary-season-rows', id: season.Id, target: '.page:not(.hide) #listChildrenCollapsible', user: 'ordinary', block: ordinaryMode === 'blocked' }] : [])];
        const dotted = fx.title.replaceAll(' ', '.');
        const releaseTitle = `${dotted}.${fx.case === 'movie' ? '2025' : fx.case === 'pack' ? 'S01' : 'S01E01'}.1080p.WEB-DL.H264-JFMOD`;
        const release = await ctl('/release', { id: label + '-' + fx.case, title: releaseTitle,
            torrentName: releaseTitle + (fx.case === 'pack' ? '' : '.mkv'), tmdbid: fx.tmdb, imdbid: 'tt' + fx.tmdb, tvdbid: fx.tmdb,
            seasons: [1], episode: fx.case === 'episode' ? 1 : null, category: fx.case === 'movie' ? 2040 : 5040,
            ...(fx.case === 'pack' ? { files: fx.episodes.map((_, i) => ({ path: `${dotted}.S01E0${i + 1}.1080p.WEB-DL.H264-JFMOD.mkv`, file: join(staging, 'clip.mkv') })) }
                : { file: join(staging, 'clip.mkv') }) });
        const found = await api('GET', `/JellyfinMod/Releases?entryId=${fx.entry}` + (fx.case === 'pack' ? '&scope=season&seasonNumber=1' : fx.case === 'episode' ? '&episodeId=' + fx.episodes[0] : ''));
        const candidate = found.candidates.find(x => x.eligible);
        if (!candidate) throw Error(`${fx.case}: no eligible release ${JSON.stringify(found.candidates.map(x => ({ title: x.title, rejections: x.rejections })))}`);
        const grab = await api('POST', '/JellyfinMod/Releases/Grab', { searchId: found.searchId, releaseId: candidate.releaseId, idempotencyKey: randomUUID() });
        await until(async () => (await api('GET', `/JellyfinMod/Grabs/${grab.id}`)).state === 'accepted', 'grab not accepted');
        const pages = [];
        for (const surface of surfaces) {
            const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
            if (surface.block) await context.addInitScript(() => {
                // The socket never opens: a closed stand-in answers (error, then close) at once.
                const Native = window.WebSocket;
                window.WebSocket = function (url, protocols) {
                    if (!String(url).includes('/socket')) return new Native(url, protocols);
                    const fake = new EventTarget();
                    Object.assign(fake, { readyState: 3, url: String(url), send() {}, close() {}, onopen: null, onmessage: null, onerror: null, onclose: null });
                    setTimeout(() => {
                        for (const event of [new Event('error'), new Event('close')]) {
                            fake['on' + event.type]?.(event);
                            fake.dispatchEvent(event);
                        }
                    }, 0);
                    return fake;
                };
                window.WebSocket.prototype = Native.prototype;
                for (const key of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) window.WebSocket[key] = Native[key];
            });
            const page = await context.newPage();
            pages.push(page);
            page.on('pageerror', error => result.errors.push(error.message));
            page.on('response', async r => {
                const u = new URL(r.url());
                if (u.origin === base && /\/Items|\/Shows\/|\/JellyfinMod\/Entries|\/JellyfinMod\/Queue/.test(u.pathname)) {
                    const row = { at: Date.now(), surface: surface.name, path: u.pathname, status: r.status() };
                    try { const data = await r.json(); const xs = data.Items ?? (data.Id ? [data] : []);
                        row.items = xs.filter(x => ['Episode', 'Movie', 'Season'].includes(x.Type)).map(x => ({ id: x.Id, placeholder: x.IsPlaceHolder, path: x.Path }));
                    } catch {}
                    result.network.push(row);
                }
            });
            page.on('websocket', ws => ws.on('framereceived', frame => {
                try { const m = JSON.parse(String(frame.payload)); if (m.MessageType === 'LibraryChanged')
                    result.websockets.push({ at: Date.now(), surface: surface.name, data: m.Data }); } catch {}
            }));
            await signIn(page, surface.user);
            await page.goto(base + '/web/' + (surface.url ?? '#/details?id=' + surface.id));
            await page.waitForSelector(surface.target, { timeout: 30000 });
            if (surface.text) await page.locator(surface.target).filter({ hasText: surface.text }).first().waitFor({ timeout: 30000 });
            if (surface.name !== 'movie' && !surface.user && !surface.text) await page.locator(surface.target).hover().catch(() => {});
            await page.evaluate(({ selector, name, text }) => {
                window.importSamples = [];
                const shown = n => n && getComputedStyle(n).display !== 'none' && getComputedStyle(n).visibility !== 'hidden' && n.getClientRects().length > 0;
                window.importTimer = setInterval(() => {
                    const n = text ? [...document.querySelectorAll(selector)].find(card => card.textContent.includes(text)) : document.querySelector(selector);
                    if (!n) { window.importSamples.push({ at: Date.now(), missing: true }); return; }
                    const rows = name.endsWith('season-rows') ? [...n.querySelectorAll('.listItem')] : [n];
                    window.importSamples.push({ at: Date.now(), rows: rows.map(r => ({ id: r.getAttribute('data-id'),
                        ring: [...r.querySelectorAll('.jfmod-dlmark:not(.jfmod-dlblock-none):not(.jfmod-dlblock-unaired)')].filter(shown).length,
                        cloud: [...r.querySelectorAll('.jfmod-mark--none,.jfmod-dlblock-none')].filter(shown).length,
                        importing: [...r.querySelectorAll('.jfmod-dlmark')].some(d => d.getAttribute('data-jfmod-kind') === 'importing'),
                        play: [...r.querySelectorAll('.listItemImageButton,[data-action="play"],[data-action="resume"],.btnPlay')].filter(shown).length,
                        placeholder: r.hasAttribute('data-jfmod-placeholder'), word: r.querySelector('.jfmod-dlMeta,.jfmod-dlblock-word')?.textContent })) });
                }, 100);
            }, { selector: surface.target, name: surface.name, text: surface.text });
        }
        console.log(`${fx.case}: observing queued pages`);
        await until(async () => pages[0].evaluate(() => window.importSamples.some(s => s.rows?.some(r => r.ring))), 'download ring did not appear', 80000).catch(async error => {
            result.dom.waiting = await pages[0].evaluate(() => ({ samples: window.importSamples, html: document.querySelector('.page:not(.hide)')?.outerHTML }));
            throw error;
        });
        await ctl('/complete?hash=' + release.infoHash);
        result.finishedAt = Date.now();
        event('download-finished');
        let previousQueue = '', previousItems = '', swap = false;
        const end = Date.now() + 200000;
        let completedAt;
        while (Date.now() < end) {
            const queue = await api('GET', '/JellyfinMod/Queue?entryId=' + fx.entry);
            const states = queue.items.map(r => ({ id: r.id, state: r.state, importState: r.importState, pack: r.pack?.episodes, updatedAt: r.updatedAt }));
            if (JSON.stringify(states) !== previousQueue) { event('queue', states); previousQueue = JSON.stringify(states); }
            const native = (await api('GET', `/Items?ids=${stubs.map(x => x.Id).join(',')}&fields=Path,MediaSources`)).Items;
            const current = native.map(x => ({ id: x.Id, placeholder: x.IsPlaceHolder, path: x.Path, sources: x.MediaSources?.map(s => ({ path: s.Path, streams: s.MediaStreams?.length })) }));
            if (JSON.stringify(current) !== previousItems) { event('items-by-original-id', current); previousItems = JSON.stringify(current); }
            const real = (await api('GET', `/Items?parentId=${fx.library}&recursive=true&includeItemTypes=Movie,Episode&fields=Path,MediaSources`)).Items.filter(x => x.Path?.includes(fx.title));
            const realSignature = JSON.stringify(real.map(x => ({ id: x.Id, placeholder: x.IsPlaceHolder, path: x.Path, sources: x.MediaSources })));
            if (realSignature !== result.lastReal) { event('items-by-parent', JSON.parse(realSignature)); result.lastReal = realSignature; }
            if (!swap && fx.stubs.every(p => !existsSync(p))) { event('swap-observed'); swap = true; }
            if (queue.items.length && queue.items.every(r => r.state === 'seeding')) completedAt ??= Date.now();
            if (queue.items.some(r => ['blocked', 'failed'].includes(r.state))) throw Error(`${fx.case}: import failed: ${JSON.stringify(states)}`);
            if (completedAt && Date.now() - completedAt > 45000) {
                const latest = (await api('GET', '/Items?recursive=true&includeItemTypes=Movie,Episode&fields=Path,MediaSources')).Items.filter(x => x.Path?.includes(fx.title) && !x.IsPlaceHolder);
                if (latest.length === stubs.length) {
                    result.finalItems = latest.map(x => ({ id: x.Id, path: x.Path, placeholder: x.IsPlaceHolder, sources: x.MediaSources }));
                    result.playback = await Promise.all(latest.map(async item => {
                        const playback = await api('GET', `/Items/${item.Id}/PlaybackInfo?userId=${user}`);
                        const playable = !playback.ErrorCode && playback.MediaSources?.some(source => source.MediaStreams?.some(stream => stream.Type === 'Video'));
                        if (!playable) throw Error(`${fx.case}: the real item is not playable`);
                        return { id: item.Id, playable };
                    }));
                    break;
                }
            }
            await sleep(100);
        }
        if (!completedAt) { for (let i = 0; i < pages.length; i++) result.dom[surfaces[i].name] = await pages[i].evaluate(() => window.importSamples); throw Error(`${fx.case}: import did not complete`); }
        for (let i = 0; i < pages.length; i++) {
            result.dom[surfaces[i].name] = await pages[i].evaluate(() => { clearInterval(window.importTimer); return window.importSamples; });
            // What each surface holds at the end, to see what kept a ring (P4.FU12).
            (result.finalHtml ??= {})[surfaces[i].name] = await pages[i].evaluate(({ selector, text }) => (text ? [...document.querySelectorAll(selector)]
                .find(card => card.textContent.includes(text)) : document.querySelector(selector))?.outerHTML?.slice(0, 6000), { selector: surfaces[i].target, text: surfaces[i].text });
            await pages[i].screenshot({ path: join(output, `${label}-${tier}-${fx.case}-${surfaces[i].name}.png`), timeout: 5000, animations: 'disabled' }).catch(() => {});
            await pages[i].close();
        }
        result.operations = await Promise.all([...new Set(result.events.filter(e => e.kind === 'queue').flatMap(e => e.data.flatMap(r => [r.id, ...(r.pack ?? []).map(p => p.importId)]))).values()].filter(Boolean).map(id => api('GET', '/JellyfinMod/Imports/' + id)));
        result.serverLog = execFileSync('docker', ['logs', '--timestamps', '--since', new Date(result.finishedAt).toISOString(), 'jellyfinmod-' + envName], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).split('\n').filter(line => /JellyfinMod removed .*placeholder|requested an immediate refresh|will be refreshed|Validating media library/.test(line));
        writeFileSync(join(output, `${label}-${tier}.json`), JSON.stringify(results, null, 2));
        console.log(`${fx.case}: completed, ${result.events.length} transitions, ${result.websockets.length} LibraryChanged frames, DOM saved`);
    }
} finally {
    writeFileSync(join(output, `${label}-${tier}.json`), JSON.stringify(results, null, 2));
    await browser?.close();
    if (standins.exitCode === null) {
        const stopped = new Promise(resolve => standins.once('exit', resolve));
        standins.kill();
        await stopped;
    }
    rmSync(standinState, { recursive: true, force: true });
}
