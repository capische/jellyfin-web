/* eslint-disable compat/compat, no-restricted-globals, @stylistic/max-statements-per-line, no-empty-function -- a Node acceptance runner, not shipped code */
/* global window, document, ApiClient, location */
// Placeholders come back after a delete in Jellyfin (P1.FU29; user 2026-10-17: after Delete media on a season "I should see the
// season with no files on disk"). Against a LOCAL environment only (it stops and starts the container and removes files inside
// it), nothing intercepted, signed in as oleksii with an empty password, as a native app calls the server (plain HTTP), and
// the series page in a real browser:
//
//   - a season with real files deleted through Jellyfin's own API (DELETE /Items/{season}, what Delete media sends): its aired
//     episodes come back as placeholder items in the same folder names, a played and favourite episode comes back played and
//     favourite, and the series page shows the season all the while (the mod's card, then Jellyfin's), without a reload;
//   - the same for one episode, for a whole series (every season back with its placeholders) and for a movie;
//   - a season folder removed inside the container while the server runs, and one removed while the container is stopped
//     (the batch's check of the catalog's files after start);
//   - the plugin's own removals start nothing: Remove Entry of a placeholder-only series brings nothing back; a library turned
//     off gets nothing back after a delete; a read-only series folder gets nothing written;
//   - no loop: a file arriving beside a placeholder (the import's case) removes it once, and nothing is written again over three
//     sync cycles.
//
//   JELLYFINMOD_TEST_URL=http://127.0.0.1:<port>/   a local environment (loopback only)
//   [JELLYFINMOD_RD_CONTAINER=jellyfinmod-<name>]    its container (docker exec, stop, start); found from the URL, and checked
//                                                    against it when given
//   JELLYFINMOD_RD_ADOLESCENCE, JELLYFINMOD_RD_FAWLTY  the container folders of a one-season series (all files real) and of a
//                                                    two-season series with some real files, both in a writable Shows folder
//   JELLYFINMOD_RD_MOVIE                             the container folder of a movie with a real file in a writable Movies folder
//   JELLYFINMOD_RD_CLIP                              a small video file inside the container, copied for the import case
//   [JELLYFINMOD_RD_HOST_MEDIA]                      the host folder mounted at /test-media; read from docker inspect, and checked
//                                                    against it when given
//   [JELLYFINMOD_RD_STEPS=season,episode,browser,series,movie,rm,stopped,optout,readonly,noloop,removeentry]
//   [JELLYFINMOD_BROWSER=chromium|chrome]  [JELLYFINMOD_SHOTS=<folder>]
//
// It deletes the fixture's files (they are the run's own fixtures) and leaves the placeholders the plugin writes; the
// environment is reset to its baseline afterwards.
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { chromium } from 'playwright';
import { provenLocalEnvironment } from './local-env.mjs';

const origin = new URL(process.env.JELLYFINMOD_TEST_URL ?? (() => { throw new Error('JELLYFINMOD_TEST_URL is required'); })());
if (!['127.0.0.1', 'localhost'].includes(origin.hostname) || ['8096', '18096', '28096', '48096'].includes(origin.port)) {
    throw new Error('Runs on a local environment only (loopback, never 8096 or a Pi instance)');
}
const need = name => process.env[name] ?? (() => { throw new Error(name + ' is required'); })();
// The server, its container and the host folder are proven to be one pool environment before anything else runs (never alpha or beta).
const { container, hostMedia: HOST_MEDIA } = await provenLocalEnvironment(origin,
    { container: process.env.JELLYFINMOD_RD_CONTAINER, hostMedia: process.env.JELLYFINMOD_RD_HOST_MEDIA });
const ADOLESCENCE = need('JELLYFINMOD_RD_ADOLESCENCE');
const FAWLTY = need('JELLYFINMOD_RD_FAWLTY');
const MOVIE = need('JELLYFINMOD_RD_MOVIE');
const CLIP = need('JELLYFINMOD_RD_CLIP');
const steps = new Set((process.env.JELLYFINMOD_RD_STEPS ?? 'season,browser,episode,series,movie,rm,stopped,optout,readonly,noloop,removeentry').split(','));
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
const SHOTS = process.env.JELLYFINMOD_SHOTS ?? '.';
// How long a placeholder may take to come back: the plugin's batch, then Jellyfin's library monitor delay (60 s here).
const BACK_WITHIN = 150_000;

const results = [];
const record = (label, check, pass, detail) => {
    const verdict = pass ? 'PASS' : 'FAIL';
    results.push({ label, check, verdict, detail });
    console.log(`${verdict} [${label}] ${check}${detail === undefined ? '' : ' · ' + JSON.stringify(detail).slice(0, 500)}`);
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const norm = id => (id ?? '').replace(/-/g, '').toLowerCase();
// Docker by its absolute path (OrbStack's), never one found on PATH.
const DOCKER = process.env.JELLYFINMOD_DOCKER ?? '/usr/local/bin/docker';
const inContainer = (...args) => execFileSync(DOCKER, ['exec', container, ...args], { encoding: 'utf8' });

const CLIENT = 'MediaBrowser Client="JellyfinMod FU29 runner", Device="node", DeviceId="jfmod-fu29-runner", Version="1.0"';
let auth = null;
let userId = null;
async function signIn() {
    for (let attempt = 0; attempt < 60; attempt++) {
        try {
            const response = await fetch(new URL('/Users/AuthenticateByName', origin), {
                method: 'POST', headers: { Authorization: CLIENT, 'Content-Type': 'application/json' },
                body: JSON.stringify({ Username: 'oleksii', Pw: '' })
            });
            if (response.ok) {
                const body = await response.json();
                auth = `${CLIENT}, Token="${body.AccessToken}"`;
                userId = body.User.Id;
                return body.AccessToken;
            }
        } catch { /* starting */ }
        await sleep(2000);
    }
    throw new Error('Sign-in failed');
}
const call = async (method, path, data) => {
    const answer = await fetch(new URL(path, origin), {
        method, headers: { Authorization: auth, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: data === undefined ? undefined : JSON.stringify(data)
    });
    const type = answer.headers.get('content-type') ?? '';
    const json = type.includes('json') ? await answer.json().catch(() => null) : null;
    if (!json) await answer.body?.cancel().catch(() => {});
    return { status: answer.status, json };
};

// How long Jellyfin's own DELETE took (the 204), kept for the steps' reports: times below are from the 204, add this for the request's start.
let lastDeleteSeconds = 0;
const deleteItem = async id => {
    const started = Date.now();
    const answer = await call('DELETE', `/Items/${id}`);
    lastDeleteSeconds = Math.round((Date.now() - started) / 100) / 10;
    return answer;
};
const itemsByPath = async (types, folder) => ((await call('GET',
    `/Items?userId=${userId}&recursive=true&includeItemTypes=${types}&fields=Path,ParentId&enableUserData=true&limit=500`)).json?.Items ?? [])
    .filter(item => (item.Path ?? '').startsWith(folder));
const seriesAt = async folder => (await itemsByPath('Series', folder)).find(item => item.Path === folder) ?? null;
const episodesAt = folder => itemsByPath('Episode', folder);
const entryFor = async itemId => (await call('GET', `/JellyfinMod/Entries?jellyfinItemId=${itemId}`)).json?.items?.[0] ?? null;
const syncNow = async () => {
    for (let attempt = 0; attempt < 30; attempt++) {
        const answer = await call('POST', '/JellyfinMod/Placeholders/SyncNow');
        if (answer.status !== 409) return answer.json;
        await sleep(3000);
    }
    return null;
};
const sxe = item => `S${String(item.ParentIndexNumber).padStart(2, '0')}E${String(item.IndexNumber).padStart(2, '0')}`;
async function waitFor(predicate, within = BACK_WITHIN) {
    const started = Date.now();
    while (Date.now() - started < within) {
        const value = await predicate();
        if (value) return { value, seconds: Math.round((Date.now() - started) / 100) / 10 };
        await sleep(500);
    }
    return { value: null, seconds: Math.round((Date.now() - started) / 100) / 10 };
}
const listing = folder => inContainer('sh', '-c', `find "${folder}" -type f 2>/dev/null | sort || true`).trim().split('\n').filter(Boolean);
const stubsIn = folder => listing(folder).filter(path => path.endsWith('.disc'));

/** Fills a series' placeholders (the episode list loaded, Sync Now) and waits for Jellyfin to hold them. */
async function settle(folder, label, expected) {
    const series = await seriesAt(folder);
    const entry = series && await entryFor(series.Id);
    if (entry) await call('POST', `/JellyfinMod/Entries/${entry.id}/EpisodeList`);
    await syncNow();
    const done = await waitFor(async () => {
        const episodes = await episodesAt(folder);
        return episodes.length >= expected ? episodes : null;
    });
    record(label, `the series holds ${expected} episodes (files and placeholders) before the delete`, !!done.value,
        { held: done.value?.length, seconds: done.seconds });
    return { series, entry };
}

async function seasonStep() {
    const label = 'season';
    const { series, entry } = await settle(ADOLESCENCE, label, 4);
    if (!series || !entry) return record(label, 'the series and its entry exist', false);
    const episodes = await episodesAt(ADOLESCENCE);
    const first = episodes.find(item => sxe(item) === 'S01E01');
    await call('POST', `/UserPlayedItems/${first.Id}?userId=${userId}`);
    await call('POST', `/UserFavoriteItems/${first.Id}?userId=${userId}`);
    const season = (await itemsByPath('Season', ADOLESCENCE))[0];
    const deleted = await deleteItem(season.Id);
    record(label, 'Jellyfin deletes the season with its files (Delete media)', deleted.status === 204 && listing(ADOLESCENCE).length === 0,
        { status: deleted.status, left: listing(ADOLESCENCE), deleteSeconds: lastDeleteSeconds });
    const back = await waitFor(async () => {
        const now = await episodesAt(ADOLESCENCE);
        return now.length === 4 && now.every(item => item.IsPlaceHolder) ? now : null;
    });
    record(label, 'all 4 aired episodes come back as placeholders in Season 01', !!back.value,
        { seconds: back.seconds, deleteSeconds: lastDeleteSeconds, stubs: stubsIn(ADOLESCENCE).map(path => path.slice(ADOLESCENCE.length)) });
    // Jellyfin re-attaches the parked user data when it first saves the new item, and the plugin refreshes the cached copy a moment
    // later (P4.FU12: a few seconds after the placeholders): the marks are read until they are back.
    const marked = await waitFor(async () => {
        const item = (await episodesAt(ADOLESCENCE)).find(candidate => sxe(candidate) === 'S01E01');
        return item?.UserData?.Played && item.UserData.IsFavorite ? item : null;
    }, 20_000);
    const again = marked.value ?? (await episodesAt(ADOLESCENCE)).find(item => sxe(item) === 'S01E01');
    record(label, 'the played and favourite episode comes back played and favourite',
        !!again?.UserData?.Played && !!again?.UserData?.IsFavorite, { seconds: marked.seconds, data: marked.value ? undefined : again?.UserData });
    const listed = await waitFor(async () => {
        const detail = (await call('GET', `/JellyfinMod/Entries/${entry.id}`)).json;
        const rows = (detail?.episodes ?? []).filter(item => item.seasonNumber === 1);
        return rows.length === 4 && rows.every(item => item.availability !== 'onDisk' && item.placeholderItemId) ? rows : null;
    }, 20_000);
    const s1 = listed.value ?? [];
    record(label, 'the catalog lists them as not on disk with their placeholder item', s1.length === 4, { seconds: listed.seconds });
    // Put the played and favourite marks back as they were.
    if (again) {
        await call('DELETE', `/UserPlayedItems/${again.Id}?userId=${userId}`);
        await call('DELETE', `/UserFavoriteItems/${again.Id}?userId=${userId}`);
    }
}

async function browserStep() {
    // The series page open while a season is deleted: it never goes blank; the season shows all the while and Jellyfin's own
    // card replaces the mod's without a reload.
    const label = 'browser';
    const { series } = await settle(FAWLTY, label, 12);
    if (!series) return record(label, 'the series exists', false);
    const browser = await chromium.launch(tier === 'chrome' ? { channel: 'chrome', headless: true } : { headless: true });
    try {
        const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(new URL('/web/', origin).href, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.ApiClient, undefined, { timeout: 30000 });
        await page.waitForFunction(() => {
            try { return !!ApiClient.getCurrentUserId() || /login|selectuser|selectserver/.test(location.hash); } catch { return false; }
        }, undefined, { timeout: 30000 });
        const field = page.locator('#txtManualName');
        if (!await field.isVisible().catch(() => false)) {
            const chooser = page.locator('.btnManual').first();
            await chooser.waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
            if (await chooser.count()) await chooser.evaluate(node => node.click());
            await field.waitFor({ state: 'visible', timeout: 15000 });
        }
        await page.waitForTimeout(1000);
        await field.fill('oleksii');
        await page.locator('#txtManualPassword').fill('');
        await page.locator('button:visible').filter({ hasText: 'Sign In' }).first().click();
        await page.waitForFunction(() => location.hash.startsWith('#/home'), undefined, { timeout: 30000 });
        await page.evaluate(target => { location.hash = target; }, `#/details?id=${series.Id}`);
        await page.waitForSelector('#listChildrenCollapsible .itemsContainer .card', { timeout: 30000 });
        const seasonCards = () => page.evaluate(() => Array.from(document.querySelectorAll('#listChildrenCollapsible .itemsContainer > *'))
            .map(card => ({
                mod: card.classList.contains('jfmod-missingSlot'),
                season: card.getAttribute('data-jfmod-season'),
                id: (card.getAttribute('data-id') ?? '').replace(/-/g, '').toLowerCase()
            })));
        const before = await seasonCards();
        record(label, 'the series page shows its two seasons', before.length === 2 && before.every(card => !card.mod), before);
        const season1 = (await itemsByPath('Season', FAWLTY)).find(item => item.IndexNumber === 1);
        const deleted = await call('DELETE', `/Items/${season1.Id}`);
        const samples = [];
        const started = Date.now();
        let fallback = null;
        let swapped = null;
        while (Date.now() - started < BACK_WITHIN) {
            await sleep(2000);
            const cards = await seasonCards();
            const seconds = Math.round((Date.now() - started) / 1000);
            samples.push({ seconds, cards: cards.map(card => (card.mod ? 'mod:' + card.season : 'jf:' + card.id.slice(0, 6))) });
            if (fallback === null && cards.some(card => card.mod && card.season === '1')) fallback = seconds;
            const native = (await itemsByPath('Season', FAWLTY)).find(item => item.IndexNumber === 1);
            // Back: Jellyfin holds Season 1 again with its placeholders, and upstream's own card for it is drawn.
            if (native && cards.some(card => !card.mod && card.id === norm(native.Id)) && !cards.some(card => card.mod)) { swapped = seconds; break; }
        }
        await page.screenshot({ path: `${SHOTS}/fu29-${tier}-series-after-delete.png` });
        record(label, 'Jellyfin deleted the season', deleted.status === 204, deleted.status);
        record(label, 'the page never showed fewer than two seasons while the season came back',
            samples.every(sample => sample.cards.length >= 2), samples.filter(sample => sample.cards.length < 2).slice(0, 5));
        // P4.FU12: the season is back within seconds, so the mod's stand-in card may never be drawn at all (seconds null).
        record(label, 'Jellyfin\'s own Season 1 card is back within 10 s without a reload, the mod\'s card (if it was drawn at all) gone',
            swapped !== null && swapped <= 10, { seconds: swapped, modCardSeen: fallback, last: samples.at(-1) });
        record(label, 'no page error', errors.length === 0, errors.slice(0, 3));
    } finally {
        await browser.close();
    }
}

async function episodeStep() {
    const label = 'episode';
    await settle(FAWLTY, label, 12);
    const episode = (await episodesAt(FAWLTY)).find(item => !item.IsPlaceHolder);
    if (!episode) return record(label, 'a real episode to delete', false);
    const deleted = await deleteItem(episode.Id);
    const back = await waitFor(async () => (await episodesAt(FAWLTY)).find(item => sxe(item) === sxe(episode) && item.IsPlaceHolder) ?? null);
    record(label, `${sxe(episode)} deleted through Jellyfin comes back as a placeholder`, deleted.status === 204 && !!back.value,
        { status: deleted.status, seconds: back.seconds, deleteSeconds: lastDeleteSeconds });
}

async function seriesStep() {
    const label = 'series';
    const { series } = await settle(FAWLTY, label, 12);
    if (!series) return record(label, 'the series exists', false);
    const deleted = await deleteItem(series.Id);
    record(label, 'Jellyfin deletes the series and its folder', deleted.status === 204 && listing(FAWLTY).length === 0, { status: deleted.status, deleteSeconds: lastDeleteSeconds });
    const back = await waitFor(async () => {
        const now = await episodesAt(FAWLTY);
        return now.length === 12 && now.every(item => item.IsPlaceHolder) && await seriesAt(FAWLTY) ? now : null;
    });
    record(label, 'the series comes back in a folder of the same name with its 12 aired episodes as placeholders', !!back.value,
        { seconds: back.seconds, stubs: stubsIn(FAWLTY).length, deleteSeconds: lastDeleteSeconds });
    // Every season comes back too, each holding its six placeholders (user 2026-10-19: "the show should stay but files are gone").
    const now = await seriesAt(FAWLTY);
    const seasons = now ? (await call('GET', `/Shows/${now.Id}/Seasons?userId=${userId}`)).json?.Items ?? [] : [];
    const perSeason = await Promise.all(seasons.map(async season => ({ season: season.IndexNumber,
        episodes: ((await call('GET', `/Shows/${now.Id}/Episodes?userId=${userId}&seasonId=${season.Id}`)).json?.Items ?? []).length })));
    record(label, 'both seasons come back under the series, six placeholders each',
        perSeason.length === 2 && perSeason.every(season => season.episodes === 6), perSeason);
}

async function movieStep() {
    const label = 'movie';
    const movie = (await itemsByPath('Movie', MOVIE))[0];
    if (!movie || movie.IsPlaceHolder) return record(label, 'the movie has its real file', false, movie?.Path);
    const deleted = await deleteItem(movie.Id);
    const back = await waitFor(async () => (await itemsByPath('Movie', MOVIE)).find(item => item.IsPlaceHolder) ?? null);
    record(label, 'a movie deleted through Jellyfin comes back as a placeholder movie', deleted.status === 204 && !!back.value,
        { status: deleted.status, seconds: back.seconds, path: back.value?.Path, deleteSeconds: lastDeleteSeconds });
}

async function rmStep() {
    const label = 'rm';
    await settle(ADOLESCENCE, label, 4);
    // Real files again for the season, then the folder removed inside the container while Jellyfin runs.
    for (const stub of stubsIn(ADOLESCENCE)) inContainer('sh', '-c', `cp "${CLIP}" "${stub.replace(/\.disc$/, '.webm')}" && rm "${stub}"`);
    const real = await waitFor(async () => {
        const now = await episodesAt(ADOLESCENCE);
        return now.length === 4 && now.every(item => !item.IsPlaceHolder) ? now : null;
    });
    record(label, 'the season holds 4 real files again', !!real.value, { seconds: real.seconds });
    // The catalog binds them (reconciliation after Jellyfin's events) before the folder goes.
    const entry = await entryFor((await seriesAt(ADOLESCENCE))?.Id);
    const bound = await waitFor(async () => ((await call('GET', `/JellyfinMod/Entries/${entry?.id}`)).json?.episodes ?? [])
        .filter(item => item.seasonNumber === 1 && item.availability === 'onDisk').length === 4 || null);
    record(label, 'the catalog holds the 4 files on disk', !!bound.value, { seconds: bound.seconds });
    inContainer('rm', '-rf', `${ADOLESCENCE}/Season 01`);
    const back = await waitFor(async () => {
        const now = await episodesAt(ADOLESCENCE);
        return now.length === 4 && now.every(item => item.IsPlaceHolder) ? now : null;
    }, BACK_WITHIN + 60_000);
    record(label, 'a season folder removed on disk while the server runs comes back as placeholders', !!back.value, { seconds: back.seconds });
}

async function stoppedStep() {
    const label = 'stopped';
    await settle(ADOLESCENCE, label, 4);
    for (const stub of stubsIn(ADOLESCENCE)) inContainer('sh', '-c', `cp "${CLIP}" "${stub.replace(/\.disc$/, '.webm')}" && rm "${stub}"`);
    const real = await waitFor(async () => {
        const now = await episodesAt(ADOLESCENCE);
        return now.length === 4 && now.every(item => !item.IsPlaceHolder) ? now : null;
    });
    record(label, 'the season holds 4 real files again', !!real.value, { seconds: real.seconds });
    // The catalog binds them (reconciliation after Jellyfin's events) before the folder goes.
    const entry = await entryFor((await seriesAt(ADOLESCENCE))?.Id);
    const bound = await waitFor(async () => ((await call('GET', `/JellyfinMod/Entries/${entry?.id}`)).json?.episodes ?? [])
        .filter(item => item.seasonNumber === 1 && item.availability === 'onDisk').length === 4 || null);
    record(label, 'the catalog holds the 4 files on disk', !!bound.value, { seconds: bound.seconds });
    // Stopped, the folder removed, started: Jellyfin still lists the episodes until it looks; the batch's check after start does.
    execFileSync(DOCKER, ['stop', container]);
    // Removed from the host side of the bind mount (the container is stopped, so it has nothing cached).
    rmSync(`${HOST_MEDIA}${ADOLESCENCE.slice('/test-media'.length)}/Season 01`, { recursive: true });
    execFileSync(DOCKER, ['start', container]);
    const token = await signIn();
    const back = await waitFor(async () => {
        const now = await episodesAt(ADOLESCENCE).catch(() => []);
        return now.length === 4 && now.every(item => item.IsPlaceHolder) ? now : null;
    }, 15 * 60_000);
    record(label, 'a season folder removed while the server was down comes back as placeholders after start', !!back.value,
        { seconds: back.seconds });
    return token;
}

async function optOutStep() {
    const label = 'optout';
    const series = await seriesAt(ADOLESCENCE);
    const libraryId = series && (await call('GET', `/Items/${series.Id}/Ancestors?userId=${userId}`)).json?.find(item => item.CollectionType === 'tvshows')?.Id;
    if (!libraryId) return record(label, 'the series and its library', false);
    await call('PUT', `/JellyfinMod/Placeholders/${libraryId}`, { enabled: false });
    const season = (await itemsByPath('Season', ADOLESCENCE))[0];
    const deleted = await call('DELETE', `/Items/${season.Id}`);
    await sleep(BACK_WITHIN);
    record(label, 'with the library turned off a deleted placeholder season does not come back',
        deleted.status === 204 && stubsIn(ADOLESCENCE).length === 0 && (await episodesAt(ADOLESCENCE)).length === 0,
        { status: deleted.status, stubs: stubsIn(ADOLESCENCE).length });
    // Turned back on, the library is synced at once (its own behaviour, P1.FU24).
    await call('PUT', `/JellyfinMod/Placeholders/${libraryId}`, { enabled: true });
    const back = await waitFor(async () => ((await episodesAt(ADOLESCENCE)).length === 4 ? true : null));
    record(label, 'turned back on, the season comes back', !!back.value, { seconds: back.seconds });
}

async function readOnlyStep() {
    const label = 'readonly';
    await settle(ADOLESCENCE, label, 4);
    // The series folder made read-only, then its season deleted on disk: nothing can be written, so nothing is.
    inContainer('sh', '-c', `rm -rf "${ADOLESCENCE}/Season 01" && chmod 0555 "${ADOLESCENCE}"`);
    try {
        await sleep(BACK_WITHIN);
        await syncNow();
        const plan = (await call('GET', '/JellyfinMod/Placeholders')).json;
        record(label, 'a read-only series folder gets nothing written', listing(ADOLESCENCE).length === 0, { files: listing(ADOLESCENCE), libraries: plan?.length });
    } finally {
        inContainer('chmod', '0755', ADOLESCENCE);
    }
    await syncNow();
    const back = await waitFor(async () => ((await episodesAt(ADOLESCENCE)).length === 4 ? true : null));
    record(label, 'writable again, the season comes back', !!back.value, { seconds: back.seconds });
}

async function noLoopStep() {
    const label = 'noloop';
    await settle(ADOLESCENCE, label, 4);
    // The import's case: a file arrives beside a placeholder, the sync removes the placeholder (the plugin's own removal), and
    // nothing is written again for it.
    const stub = stubsIn(ADOLESCENCE)[0];
    if (!stub) return record(label, 'a placeholder to put a file beside', false);
    const code = /(S\d\dE\d\d)\.disc$/.exec(stub)[1];
    inContainer('cp', CLIP, stub.replace(/\.disc$/, '.webm'));
    await syncNow();
    const swapped = await waitFor(async () => {
        const now = await episodesAt(ADOLESCENCE);
        const same = now.filter(item => sxe(item) === code);
        return same.length === 1 && !same[0].IsPlaceHolder ? true : null;
    });
    record(label, 'a file beside a placeholder replaces it once', !!swapped.value && !listing(ADOLESCENCE).some(path => path.endsWith(code + '.disc')),
        { seconds: swapped.seconds });
    const before = listing(ADOLESCENCE).join('|');
    const since = new Date().toISOString();
    for (let cycle = 0; cycle < 3; cycle++) {
        await syncNow();
        await sleep(70_000);
    }
    // What the plugin's runs wrote or removed meanwhile, from its own log lines.
    const log = execFileSync(DOCKER, ['logs', '--since', since, container], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const changes = log.split('\n').filter(line => /JellyfinMod placeholders in library .*: (wrote [1-9]|wrote \d+, removed [1-9])/.test(line));
    record(label, 'three sync cycles write and remove nothing more', changes.length === 0 && listing(ADOLESCENCE).join('|') === before,
        { changes: changes.slice(0, 3), files: listing(ADOLESCENCE).map(path => path.slice(ADOLESCENCE.length)) });
}

async function removeEntryStep() {
    const label = 'removeentry';
    // Fawlty Towers is placeholders only by now (series step): Remove Entry takes its placeholders and nothing comes back.
    const series = await seriesAt(FAWLTY);
    const entry = series && await entryFor(series.Id);
    if (!entry) return record(label, 'the placeholder-only series and its entry', false);
    const removed = await call('DELETE', `/JellyfinMod/Entries/${entry.id}`);
    await sleep(BACK_WITHIN);
    await syncNow();
    await sleep(10_000);
    record(label, 'Remove Entry: its placeholders go and nothing is written back',
        removed.status < 300 && listing(FAWLTY).length === 0 && (await episodesAt(FAWLTY)).length === 0,
        { status: removed.status, files: listing(FAWLTY).length });
}

await signIn();
if (steps.has('season')) await seasonStep();
if (steps.has('browser')) await browserStep();
if (steps.has('episode')) await episodeStep();
if (steps.has('movie')) await movieStep();
if (steps.has('rm')) await rmStep();
if (steps.has('stopped')) await stoppedStep();
if (steps.has('optout')) await optOutStep();
if (steps.has('readonly')) await readOnlyStep();
if (steps.has('noloop')) await noLoopStep();
if (steps.has('series')) await seriesStep();
if (steps.has('removeentry')) await removeEntryStep();
const failed = results.filter(result => result.verdict === 'FAIL').length;
console.log(`\n${results.length} checks, ${failed} failed (${tier})`);
process.exitCode = failed ? 1 : 0;
/* eslint-enable compat/compat, no-restricted-globals, @stylistic/max-statements-per-line, no-empty-function */
