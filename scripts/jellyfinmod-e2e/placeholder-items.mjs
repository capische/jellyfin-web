/* eslint-disable compat/compat, no-restricted-globals, @stylistic/max-statements-per-line, no-empty-function, sonarjs/cognitive-complexity -- a Node acceptance runner, not shipped code */
/* global document */
// Placeholders as Jellyfin items with no file (P1.FU30, the virtual-items spike). Against a LOCAL environment only (it copies
// files into its /test-media, deletes them through Jellyfin and restarts the container), nothing intercepted, signed in as
// oleksii with an empty password, as a native app calls the server (plain HTTP), and the series page in a real browser for the
// web timings. Every flow is timed: seconds from the action until the API (and, with the browser step, the page) shows it.
//
//   setup      real files for Adolescence (S01E01-E04) and Fawlty Towers (S01E01-E03, S02E01) and The Matrix, a scan, the
//              catalog's entries and their TMDb episode lists; the switch's dry run, then the switch to items
//   backfill   every missing aired episode of Fawlty Towers is a placeholder item (IsPlaceHolder, LocationType Remote,
//              CanDelete and CanDownload false), PlaybackInfo NotAllowed, Download refused, Next Up skips them
//   episode    Delete media of a played and favourite real episode: its placeholder comes back with played, date and favourite
//   season     Delete media of a whole real season (Adolescence): its season and episodes come back, a played one played
//   browser    the series page open while a season is deleted: when the page shows the placeholders again
//   series     Delete media of a whole series (Fawlty Towers): a file-less series with every aired episode comes back,
//              favourite and played kept
//   movie      Delete media of a movie: its placeholder movie comes back, favourite kept
//   note       (P1.FU31) the placeholder episode, season, series and movie overviews start with the note for native apps, once,
//              the title's own overview below it; an edit with the note twice is put right; a forced full metadata refresh
//              (replace all) brings the note back once; PlaybackInfo still refused; the web app's episode, season and movie pages
//              show the overview without the note; the movie's file copied in: the real movie's overview has no note
//   arrive     a real file copied in by hand for a placeholder of a file-less series: the series becomes the real one, the
//              episode the real file with the placeholder's played and favourite, the other placeholders under the real series
//   restart    every placeholder item and its user data survive a restart and a library scan
//   user       an ordinary user (nata) sees the placeholders, cannot delete them
//   optout     with the library switched off a delete brings nothing back; Remove Placeholders removes exactly the plugin's
//              items; switched on again they come back
//   entry      Remove Entry of a file-less movie removes its item and nothing comes back
//   library    the Shows library removed and added again: its placeholders come back
//   cleanup    Remove All Virtual Items leaves no item with the plugin's path in the database
//
//   JELLYFINMOD_TEST_URL=http://127.0.0.1:<port>/   JELLYFINMOD_PI_CONTAINER=jellyfinmod-<name>
//   JELLYFINMOD_PI_HOST_MEDIA=<host folder mounted at /test-media>   JELLYFINMOD_PI_CLIP=<small video file on the host>
//   [JELLYFINMOD_PI_STEPS=setup,backfill,...]  [JELLYFINMOD_PI_OUT=<json file>]  [JELLYFINMOD_BROWSER=chromium|chrome]
//
// The environment is reset to its baseline afterwards (envs/bin/reset-to-baseline.sh).
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const origin = new URL(process.env.JELLYFINMOD_TEST_URL ?? (() => { throw new Error('JELLYFINMOD_TEST_URL is required'); })());
if (!['127.0.0.1', 'localhost'].includes(origin.hostname) || ['8096', '18096', '28096', '48096'].includes(origin.port)) {
    throw new Error('Runs on a local environment only (loopback, never 8096 or a Pi instance)');
}
const need = name => process.env[name] ?? (() => { throw new Error(name + ' is required'); })();
const container = need('JELLYFINMOD_PI_CONTAINER');
if (!/^jellyfinmod-[a-z]+$/.test(container) || container === 'jellyfinmod-alpha') throw new Error('Not a pool environment container');
const HOST_MEDIA = need('JELLYFINMOD_PI_HOST_MEDIA');
const CLIP = need('JELLYFINMOD_PI_CLIP');
const OUT = process.env.JELLYFINMOD_PI_OUT ?? 'placeholder-items.json';
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
const STEPS = new Set((process.env.JELLYFINMOD_PI_STEPS
    ?? 'setup,backfill,episode,season,browser,series,movie,note,arrive,restart,user,optout,entry,library,cleanup').split(','));
const DOCKER = process.env.JELLYFINMOD_DOCKER ?? '/usr/local/bin/docker';
const ADOLESCENCE = 'Adolescence (2025) [tmdbid-249042]';
const FAWLTY = 'Fawlty Towers (1975) [tmdbid-2207]';
const MATRIX = 'The Matrix (1999) [tmdbid-603]';

const results = [];
const timings = {};
const record = (label, check, pass, detail) => {
    results.push({ label, check, verdict: pass ? 'PASS' : 'FAIL', detail });
    console.log(`${pass ? 'PASS' : 'FAIL'} [${label}] ${check}${detail === undefined ? '' : ' · ' + JSON.stringify(detail).slice(0, 400)}`);
};
const time = (name, seconds) => { timings[name] = Math.round(seconds * 100) / 100; console.log(`TIME ${name} ${timings[name]} s`); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const norm = id => (id ?? '').replace(/-/g, '').toLowerCase();
const docker = (...args) => execFileSync(DOCKER, args, { encoding: 'utf8' });
const inContainer = (...args) => docker('exec', container, ...args);

const client = user => `MediaBrowser Client="JellyfinMod virtual items runner", Device="node", DeviceId="jfmod-pi-${user}", Version="1.0"`;
const sessions = {};
async function signIn(user) {
    const response = await fetch(new URL('/Users/AuthenticateByName', origin), {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: client(user) }, body: JSON.stringify({ Username: user, Pw: '' })
    });
    if (!response.ok) throw new Error(`sign-in ${user}: ${response.status}`);
    const body = await response.json();
    sessions[user] = { token: body.AccessToken, id: norm(body.User.Id), auth: `${client(user)}, Token="${body.AccessToken}"` };
    return sessions[user];
}
async function call(method, path, body, user = 'oleksii') {
    const response = await fetch(new URL(path, origin), {
        method, headers: { Authorization: sessions[user].auth, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch {}
    return { status: response.status, json, text };
}
const get = async (path, user) => (await call('GET', path, undefined, user)).json;
async function until(read, timeoutMs, stepMs = 100) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        const value = await read().catch(() => null);
        if (value) return { value, seconds: (Date.now() - started) / 1000 };
        await sleep(stepMs);
    }
    return { value: null, seconds: (Date.now() - started) / 1000 };
}

const own = item => (item?.Path ?? '').startsWith('jellyfinmod://');
// The note the plugin puts in front of a placeholder's overview (PlaceholderItems.Note, P1.FU31).
const NOTE = 'Not downloaded yet. Request it from the JellyfinMod web app.';
const noteOnce = text => typeof text === 'string' && text.startsWith(NOTE) && !text.slice(NOTE.length).includes(NOTE);
const below = text => (noteOnce(text) && text.startsWith(NOTE + '\n\n') ? text.slice(NOTE.length + 2) : '');
const noNote = text => !(text ?? '').includes(NOTE);
const overviewOf = async id => (await get(`/Items/${id}?userId=${sessions.oleksii.id}`))?.Overview ?? null;
async function signedInPage(browser) {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    await page.goto(new URL('/web/', origin).href);
    await page.waitForFunction(() => !!window.ApiClient);
    await page.locator('.btnManual').first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    if (!await page.locator('#txtManualName').isVisible()) await page.locator('.btnManual').first().evaluate(node => node.click());
    await page.waitForTimeout(1000);
    await page.locator('#txtManualName').fill('oleksii');
    await page.locator('#txtManualPassword').fill('');
    await page.locator('button:visible').filter({ hasText: 'Sign In' }).first().click();
    await page.waitForFunction(() => location.hash.startsWith('#/home'), undefined, { timeout: 30000 });
    return page;
}
let shows; let movies;
async function libraries() {
    const folders = await get('/Library/VirtualFolders');
    shows = norm(folders.find(folder => folder.CollectionType === 'tvshows').ItemId);
    movies = norm(folders.find(folder => folder.CollectionType === 'movies').ItemId);
}
async function seriesNamed(name) {
    const items = (await get(`/Items?Recursive=true&IncludeItemTypes=Series&ParentId=${shows}&Fields=Path,ProviderIds`))?.Items ?? [];
    return items.filter(item => item.Name === name);
}
async function episodesOf(seriesId, user = 'oleksii') {
    return (await get(`/Shows/${seriesId}/Episodes?UserId=${sessions[user].id}&Fields=Path,CanDelete,CanDownload`, user))?.Items ?? [];
}
async function seasonsOf(seriesId) {
    return (await get(`/Shows/${seriesId}/Seasons?UserId=${sessions.oleksii.id}&Fields=Path`))?.Items ?? [];
}
const at = (episodes, season, episode) => episodes.find(item => item.ParentIndexNumber === season && item.IndexNumber === episode);
async function userData(itemId, user = 'oleksii') {
    return (await get(`/Users/${sessions[user].id}/Items/${itemId}`, user))?.UserData ?? null;
}
async function mark(itemId, user = 'oleksii') {
    await call('POST', `/UserPlayedItems/${itemId}?userId=${sessions[user].id}&datePlayed=2025-08-01T10:00:00.000Z`, undefined, user);
    await call('POST', `/UserFavoriteItems/${itemId}?userId=${sessions[user].id}`, undefined, user);
}
const marked = data => !!data?.Played && !!data?.IsFavorite && (data.LastPlayedDate ?? '').startsWith('2025-08-01');
async function entryOf(tmdbId) {
    const page = await get('/JellyfinMod/Entries?limit=200');
    return (page?.items ?? []).find(entry => entry.tmdbId === tmdbId);
}
async function ownCount() {
    const items = (await get('/Items?Recursive=true&IncludeItemTypes=Episode,Movie,Season,Series&Fields=Path'))?.Items ?? [];
    return items.filter(own).length;
}
async function scan() {
    await call('POST', '/Library/Refresh');
    await sleep(1500);
    await until(async () => {
        const tasks = await get('/ScheduledTasks?isHidden=false');
        return tasks.find(task => task.Key === 'RefreshLibrary')?.State === 'Idle';
    }, 300000, 1000);
}
const seriesFolder = name => `/test-media/tv/${name}`;
function realFile(folder, name) {
    inContainer('sh', '-c', `mkdir -p "${folder}" && cp /test-media/pi-clip.webm "${folder}/${name}"`);
}

async function main() {
    // The server may still be starting (503) right after a deploy.
    for (let tries = 0; !sessions.oleksii && tries < 60; tries++) await signIn('oleksii').catch(() => sleep(2000));
    await libraries();
    const info = (await get('/System/Info/Public'));
    record('env', 'a local environment on Jellyfin 12.2', info.Version?.startsWith('12.2') && info.ServerName === container, { version: info.Version, name: info.ServerName });

    if (STEPS.has('setup')) {
        copyFileSync(CLIP, join(HOST_MEDIA, 'pi-clip.webm'));
        const a = join(HOST_MEDIA, 'tv', ADOLESCENCE, 'Season 01');
        mkdirSync(a, { recursive: true });
        for (const e of [1, 2, 3, 4]) copyFileSync(CLIP, join(a, `Adolescence (2025) S01E0${e}.webm`));
        const b = join(HOST_MEDIA, 'tv', FAWLTY);
        mkdirSync(join(b, 'Season 01'), { recursive: true });
        mkdirSync(join(b, 'Season 02'), { recursive: true });
        for (const e of [1, 2, 3]) copyFileSync(CLIP, join(b, 'Season 01', `Fawlty Towers (1975) S01E0${e}.webm`));
        copyFileSync(CLIP, join(b, 'Season 02', 'Fawlty Towers (1975) S02E01.webm'));
        const m = join(HOST_MEDIA, 'movies', MATRIX);
        mkdirSync(m, { recursive: true });
        copyFileSync(CLIP, join(m, `${MATRIX}.webm`));
        // A second movie, so the movie folder is never left empty (the catalog's absence check refuses to prove a file gone in
        // an empty folder, which may be an unmounted mount point).
        const n = join(HOST_MEDIA, 'movies', 'Nosferatu (2024) [tmdbid-426063]');
        mkdirSync(n, { recursive: true });
        copyFileSync(CLIP, join(n, 'Nosferatu (2024) [tmdbid-426063].webm'));
        await scan();
        const entries = await until(async () => {
            const [x, y, z] = [await entryOf(249042), await entryOf(2207), await entryOf(603)];
            return x && y && z ? [x, y, z] : null;
        }, 180000, 2000);
        record('setup', 'the scan made catalog entries of the three fixture titles', !!entries.value, { seconds: entries.seconds });
        for (const entry of entries.value?.slice(0, 2) ?? []) await call('POST', `/JellyfinMod/Entries/${entry.id}/EpisodeList`);
        const mode = await call('GET', '/JellyfinMod/Placeholders/Mode');
        if ([404, 405].includes(mode.status)) {
            // The items-only build (feat/virtual-items-only) has no stubs and no switch: placeholders are items from the start.
            record('setup', 'an items-only build: no placeholder mode to switch', true);
        } else {
            record('setup', 'the switch\'s dry run counts stubs and the items it would make', mode.json?.mode === 'stubs' || mode.json?.mode === 'items', mode.json);
            const started = Date.now();
            const switched = await call('PUT', '/JellyfinMod/Placeholders/Mode', { mode: 'items' });
            time('switch_to_items', (Date.now() - started) / 1000);
            record('setup', 'switched to items', switched.status === 200 && switched.json?.mode === 'items', switched.json);
        }
    }

    let fawlty = (await seriesNamed('Fawlty Towers'))[0];
    const adolescence = (await seriesNamed('Adolescence'))[0];
    if (STEPS.has('backfill')) {
        const filled = await until(async () => {
            const episodes = await episodesOf(fawlty.Id);
            return episodes.filter(item => item.IsPlaceHolder && own(item)).length >= 8 ? episodes : null;
        }, 60000);
        time('backfill_fawlty_8_placeholders', filled.seconds);
        const episodes = filled.value ?? [];
        const placeholder = at(episodes, 1, 4);
        record('backfill', 'Fawlty Towers: its 8 missing aired episodes are placeholder items beside the 4 real ones',
            episodes.length === 12 && episodes.filter(own).length === 8, { count: episodes.length, own: episodes.filter(own).length });
        record('backfill', 'a placeholder item is IsPlaceHolder, LocationType Remote, CanDelete and CanDownload false',
            placeholder?.IsPlaceHolder === true && placeholder.LocationType === 'Remote' && placeholder.CanDelete === false && placeholder.CanDownload === false,
            { placeholder: placeholder && { p: placeholder.IsPlaceHolder, l: placeholder.LocationType, d: placeholder.CanDelete, dl: placeholder.CanDownload } });
        const placeholderOverview = await overviewOf(placeholder.Id);
        record('backfill', 'a placeholder episode\'s overview starts with the note, once, and its own overview follows',
            below(placeholderOverview).length > 0, { overview: placeholderOverview?.slice(0, 160) });
        const playback = await call('POST', `/Items/${placeholder.Id}/PlaybackInfo?userId=${sessions.oleksii.id}`, {});
        record('backfill', 'PlaybackInfo answers NotAllowed with no source', playback.json?.ErrorCode === 'NotAllowed' && !(playback.json?.MediaSources ?? []).length, playback.json);
        const download = await call('GET', `/Items/${placeholder.Id}/Download`);
        record('backfill', 'Download is refused', download.status >= 400, { status: download.status });
        const deleting = await call('DELETE', `/Items/${placeholder.Id}`);
        record('backfill', 'Jellyfin refuses to delete a placeholder item', deleting.status >= 400 && !!(await get(`/Items/${placeholder.Id}`)), { status: deleting.status });
        const seasons = await seasonsOf(fawlty.Id);
        record('backfill', 'Fawlty Towers lists exactly two seasons (its real season folders hold the placeholders)', seasons.length === 2,
            seasons.map(season => ({ name: season.Name, path: season.Path })));
        // Next Up after S01E01-E03 played: the placeholder S01E04 is skipped, the real S02E01 is next.
        for (const e of [1, 2, 3]) await call('POST', `/UserPlayedItems/${at(episodes, 1, e).Id}?userId=${sessions.oleksii.id}`);
        const next = await get(`/Shows/NextUp?userId=${sessions.oleksii.id}&seriesId=${fawlty.Id}&enableResumable=false`);
        record('backfill', 'Next Up skips the placeholders (offers the real S02E01)', next?.Items?.[0]?.ParentIndexNumber === 2 && next.Items[0].IndexNumber === 1,
            next?.Items?.map(item => `S${item.ParentIndexNumber}E${item.IndexNumber}`));
        for (const e of [1, 3]) await call('DELETE', `/UserPlayedItems/${at(episodes, 1, e).Id}?userId=${sessions.oleksii.id}`);
        const latest = await get(`/Items/Latest?userId=${sessions.oleksii.id}&parentId=${shows}&limit=50&groupItems=false&IncludeItemTypes=Episode`);
        record('backfill', 'Latest lists no placeholder episode', (latest ?? []).every(item => !own(item)), (latest ?? []).map(item => item.Name));
        // User data kept through the steps below: S01E02 (real) and S01E04 (placeholder) played on 2025-08-01 and favourite.
        await mark(at(episodes, 1, 2).Id);
        await mark(placeholder.Id);
        record('backfill', 'played and favourite set on a real episode and on a placeholder',
            marked(await userData(at(episodes, 1, 2).Id)) && marked(await userData(placeholder.Id)));
    }

    if (STEPS.has('episode')) {
        const before = at(await episodesOf(fawlty.Id), 1, 2);
        const started = Date.now();
        const deleted = await call('DELETE', `/Items/${before.Id}`);
        const back = await until(async () => {
            const item = at(await episodesOf(fawlty.Id), 1, 2);
            return item && own(item) ? item : null;
        }, 60000);
        time('delete_episode_back_api', (Date.now() - started) / 1000);
        record('episode', 'Delete media of a real episode: its placeholder comes back', deleted.status === 204 && !!back.value, { status: deleted.status, seconds: back.seconds });
        const data = back.value && await userData(back.value.Id);
        record('episode', 'it is played on its date and favourite, by id and in the season list',
            marked(data) && marked(at(await episodesOf(fawlty.Id), 1, 2)?.UserData), data);
    }

    if (STEPS.has('season')) {
        let episodes = await episodesOf(adolescence.Id);
        await call('POST', `/UserPlayedItems/${at(episodes, 1, 2).Id}?userId=${sessions.oleksii.id}&datePlayed=2025-08-01T10:00:00.000Z`);
        const season = (await seasonsOf(adolescence.Id))[0];
        await call('POST', `/UserFavoriteItems/${season.Id}?userId=${sessions.oleksii.id}`);
        const started = Date.now();
        const deleted = await call('DELETE', `/Items/${season.Id}`);
        const back = await until(async () => {
            const list = await episodesOf(adolescence.Id);
            return list.length === 4 && list.every(own) ? list : null;
        }, 60000);
        time('delete_season_back_api', (Date.now() - started) / 1000);
        record('season', 'Delete media of a real season: its 4 episodes come back as placeholders', deleted.status === 204 && !!back.value,
            { status: deleted.status, seconds: back.seconds });
        episodes = back.value ?? [];
        const seasons = await seasonsOf(adolescence.Id);
        record('season', 'one Season 1, the plugin\'s, favourite kept', seasons.length === 1 && own(seasons[0]) && seasons[0].UserData?.IsFavorite === true,
            seasons.map(item => ({ path: item.Path, fav: item.UserData?.IsFavorite })));
        record('season', 'S01E02 is played again', at(episodes, 1, 2)?.UserData?.Played === true);
    }

    if (STEPS.has('browser') && STEPS.has('season')) {
        // Real files back for Adolescence's season (copied in the container; the library monitor finds them), then the season
        // deleted again while its series page is open.
        for (const e of [1, 2]) realFile(`${seriesFolder(ADOLESCENCE)}/Season 01`, `Adolescence (2025) S01E0${e}.webm`);
        const arrived = await until(async () => {
            const now = await episodesOf(adolescence.Id);
            return now.length === 4 && now.filter(item => !own(item)).length === 2;
        }, 180000, 1000);
        time('file_arrives_placeholder_swapped_api', arrived.seconds);
        const list = await episodesOf(adolescence.Id);
        record('browser', 'two real files copied in by hand replace their placeholders (no duplicate), the others stay',
            list.length === 4 && list.filter(own).length === 2 && at(list, 1, 2)?.UserData?.Played === true,
            list.map(item => `${item.IndexNumber}:${own(item) ? 'p' : 'f'}`));
        const realOverviews = await Promise.all(list.filter(item => !own(item)).map(item => overviewOf(item.Id)));
        record('browser', 'the real episodes that took the placeholders\' place have no note', realOverviews.length === 2 && realOverviews.every(noNote),
            realOverviews.map(text => text?.slice(0, 80)));
        const browser = await chromium.launch(tier === 'chrome' ? { headless: true, channel: 'chrome' } : { headless: true });
        try {
            const page = await signedInPage(browser);
            const season = (await seasonsOf(adolescence.Id)).find(item => !own(item)) ?? (await seasonsOf(adolescence.Id))[0];
            await page.goto(new URL(`/web/#/details?id=${season.Id}`, origin).href);
            await page.waitForSelector('.page:not(.hide) #listChildrenCollapsible .listItem', { timeout: 30000 });
            const count = () => page.evaluate(() => document.querySelectorAll('.page:not(.hide) #listChildrenCollapsible .listItem').length);
            record('browser', 'the season page shows 4 episode rows', await count() === 4);
            await page.goto(new URL(`/web/#/details?id=${adolescence.Id}`, origin).href);
            await page.waitForSelector('.page:not(.hide) .card', { timeout: 30000 });
            const started = Date.now();
            const deleted = await call('DELETE', `/Items/${season.Id}`);
            const samples = [];
            const shown = await until(async () => {
                const cards = await page.evaluate(() => [...document.querySelectorAll('.page:not(.hide) #childrenContent .card, .page:not(.hide) .card[data-type="Season"]')]
                    .map(card => card.getAttribute('data-id')));
                samples.push({ at: Date.now() - started, cards });
                const api = await seasonsOf(adolescence.Id);
                return api.length === 1 && own(api[0]) && cards.includes(api[0].Id) ? cards : null;
            }, 90000, 250);
            time('delete_season_back_web_series_page', (Date.now() - started) / 1000);
            record('browser', 'the open series page shows the season back without a reload', deleted.status === 204 && !!shown.value,
                { seconds: shown.seconds, gapSamples: samples.filter(sample => sample.cards.length === 0).length });
            await page.screenshot({ path: OUT.replace(/\.json$/, '-series-page.png') }).catch(() => {});
        } finally {
            await browser.close();
        }
    }

    if (STEPS.has('series')) {
        const before = await episodesOf(fawlty.Id);
        await call('POST', `/UserFavoriteItems/${fawlty.Id}?userId=${sessions.oleksii.id}`);
        const started = Date.now();
        const deleted = await call('DELETE', `/Items/${fawlty.Id}`);
        const back = await until(async () => {
            const series = (await seriesNamed('Fawlty Towers'))[0];
            if (!series || !own(series)) return null;
            const list = await episodesOf(series.Id);
            return list.length === 12 && list.every(own) ? { series, list } : null;
        }, 90000);
        time('delete_series_back_api', (Date.now() - started) / 1000);
        record('series', 'Delete media of a whole series: a file-less series with its 12 aired episodes comes back', deleted.status === 204 && !!back.value,
            { status: deleted.status, before: before.length, seconds: back.seconds });
        if (back.value) {
            fawlty = back.value.series;
            const list = back.value.list;
            const kept = await until(async () => {
                const now = await episodesOf(fawlty.Id);
                return marked(at(now, 1, 2)?.UserData) && marked(at(now, 1, 4)?.UserData) && (await userData(fawlty.Id))?.IsFavorite === true;
            }, 45000, 500);
            record('series', 'S01E02 and S01E04 played on their date and favourite, the series favourite', !!kept.value,
                { e2: at(list, 1, 2)?.UserData, e4: at(list, 1, 4)?.UserData, series: (await userData(fawlty.Id))?.IsFavorite, seconds: kept.seconds });
            record('series', 'the series lists two seasons, both the plugin\'s', (await seasonsOf(fawlty.Id)).length === 2);
            const counts = await get(`/Items/${fawlty.Id}?userId=${sessions.oleksii.id}`);
            record('series', 'a file-less series is not "watched" (it has unplayed placeholders)', counts?.UserData?.Played === false,
                { played: counts?.UserData?.Played, unplayed: counts?.UserData?.UnplayedItemCount });
        }
    }

    if (STEPS.has('movie')) {
        const movie = (await get(`/Items?Recursive=true&IncludeItemTypes=Movie&ParentId=${movies}&Fields=Path,ProviderIds`)).Items.find(item => item.ProviderIds?.Tmdb === '603');
        await call('POST', `/UserFavoriteItems/${movie.Id}?userId=${sessions.oleksii.id}`);
        const started = Date.now();
        const deleted = await call('DELETE', `/Items/${movie.Id}`);
        const back = await until(async () => (await get(`/Items?Recursive=true&IncludeItemTypes=Movie&ParentId=${movies}&Fields=Path,ProviderIds`)).Items
            .find(item => item.ProviderIds?.Tmdb === '603' && own(item)), 60000);
        time('delete_movie_back_api', (Date.now() - started) / 1000);
        record('movie', 'Delete media of a movie: its placeholder movie comes back, favourite kept', deleted.status === 204 && !!back.value
            && (await userData(back.value.Id))?.IsFavorite === true, { seconds: back.seconds });
    }

    if (STEPS.has('note') && STEPS.has('series') && STEPS.has('movie')) {
        const movieItem = (await get(`/Items?Recursive=true&IncludeItemTypes=Movie&ParentId=${movies}&Fields=Path,ProviderIds`)).Items
            .find(item => item.ProviderIds?.Tmdb === '603' && own(item));
        const items = { episode: at(await episodesOf(fawlty.Id), 1, 4), season: (await seasonsOf(fawlty.Id))[0], series: fawlty, movie: movieItem };
        record('note', 'the file-less series, its season, an episode and the movie are placeholder items',
            Object.values(items).every(own), Object.fromEntries(Object.entries(items).map(([kind, item]) => [kind, item?.Path])));
        const overviews = async () => Object.fromEntries(await Promise.all(Object.entries(items).map(async ([kind, item]) => [kind, await overviewOf(item.Id)])));
        // A season the plugin made has no overview of its own; it gets the note with its first refresh.
        let last = {};
        const first = await until(async () => {
            last = await overviews();
            return Object.values(last).every(noteOnce) ? last : null;
        }, 90000, 500);
        record('note', 'episode, season, series and movie: the overview starts with the note, exactly once', !!first.value,
            { seconds: first.seconds, overviews: Object.fromEntries(Object.entries(last).map(([kind, text]) => [kind, text?.slice(0, 100)])) });
        record('note', 'the episode\'s, series\' and movie\'s own overviews follow the note after a blank line',
            ['episode', 'series', 'movie'].every(kind => below(last[kind]).length > 0));
        const own0 = Object.fromEntries(Object.entries(last).map(([kind, text]) => [kind, below(text)]));

        // An edit that puts the note in twice (with a marker) is put right by the plugin: the note once, the marker kept.
        const MARKER = 'Runner marker, replaced by the refresh below.';
        const edits = [];
        for (const item of Object.values(items)) {
            const dto = await get(`/Items/${item.Id}?userId=${sessions.oleksii.id}`);
            edits.push((await call('POST', `/Items/${item.Id}`, { ...dto, Overview: `${NOTE}\n\n${NOTE}\n\n${MARKER}` })).status);
        }
        const normal = await until(async () => {
            last = await overviews();
            return Object.values(last).every(text => noteOnce(text) && below(text) === MARKER) ? last : null;
        }, 30000, 200);
        record('note', 'an edit with the note twice is put right on all four: the note once, the rest kept', edits.every(status => status === 204) && !!normal.value,
            { edits, seconds: normal.seconds, overviews: Object.fromEntries(Object.entries(last).map(([kind, text]) => [kind, text?.slice(0, 140)])) });

        // A forced full refresh that replaces all metadata (Jellyfin writes TMDb's overview over the note): the note comes back once.
        const gaps = Object.fromEntries(Object.keys(items).map(kind => [kind, 0]));
        const started = Date.now();
        for (const item of Object.values(items)) {
            await call('POST', `/Items/${item.Id}/Refresh?metadataRefreshMode=FullRefresh&imageRefreshMode=Default&replaceAllMetadata=true&replaceAllImages=false`);
        }
        const refreshed = await until(async () => {
            last = await overviews();
            for (const [kind, text] of Object.entries(last)) if (!noteOnce(text)) gaps[kind]++;
            return Object.values(last).every(text => noteOnce(text) && !text.includes(MARKER)) ? last : null;
        }, 120000, 100);
        time('note_back_after_full_refresh_api', (Date.now() - started) / 1000);
        record('note', 'after a full refresh with replace all metadata the note is back on all four, exactly once', !!refreshed.value,
            { seconds: refreshed.seconds, samplesWithoutNote: gaps, overviews: Object.fromEntries(Object.entries(last).map(([kind, text]) => [kind, text?.slice(0, 100)])) });
        record('note', 'the refresh did replace the overviews (the marker is gone); below the note each title\'s own overview as before the edit',
            !!refreshed.value && Object.keys(items).every(kind => below(last[kind]) === own0[kind]) && ['episode', 'series', 'movie'].every(kind => own0[kind].length > 0));
        await sleep(5000);
        const settled = await overviews();
        record('note', 'five seconds later still the note once (no second prefix from a later save)', Object.values(settled).every(text => noteOnce(text) && !text.includes(MARKER)));
        for (const kind of ['episode', 'movie']) {
            const playback = await call('POST', `/Items/${items[kind].Id}/PlaybackInfo?userId=${sessions.oleksii.id}`, {});
            record('note', `PlaybackInfo of the placeholder ${kind} is still refused (NotAllowed, no source)`,
                playback.json?.ErrorCode === 'NotAllowed' && !(playback.json?.MediaSources ?? []).length, { status: playback.status, error: playback.json?.ErrorCode });
        }

        // The web app shows its own marks and never the note: the episode, its season and the movie pages, in a real browser.
        const browser = await chromium.launch(tier === 'chrome' ? { headless: true, channel: 'chrome' } : { headless: true });
        try {
            const page = await signedInPage(browser);
            for (const kind of ['episode', 'movie']) {
                await page.goto(new URL(`/web/#/details?id=${items[kind].Id}`, origin).href);
                await page.waitForSelector('.page:not(.hide) .overview:not(.hide)', { timeout: 30000 }).catch(() => {});
                await page.waitForTimeout(2000);
                const shown = await page.evaluate(() => ({
                    overview: [...document.querySelectorAll('.page:not(.hide) .overview')].map(node => node.innerText).join(' | '),
                    text: document.querySelector('.page:not(.hide)')?.innerText ?? ''
                }));
                const expected = below(settled[kind]).replace(/\s+/g, ' ').trim().slice(0, 60);
                record('note', `the web app's ${kind} page shows the overview without the note`,
                    noNote(shown.text) && expected.length > 0 && shown.overview.replace(/\s+/g, ' ').includes(expected), { overview: shown.overview.slice(0, 160) });
                await page.screenshot({ path: OUT.replace(/\.json$/, `-note-${kind}-page.png`) }).catch(() => {});
            }
            await page.goto(new URL(`/web/#/details?id=${items.season.Id}`, origin).href);
            await page.waitForSelector('.page:not(.hide) #listChildrenCollapsible .listItem', { timeout: 30000 }).catch(() => {});
            await page.waitForTimeout(2000);
            const rows = await page.evaluate(() => ({
                rows: [...document.querySelectorAll('.page:not(.hide) #listChildrenCollapsible .listItem-overview, .page:not(.hide) #listChildrenCollapsible .listItem-bottomoverview')]
                    .map(node => node.innerText),
                text: document.querySelector('.page:not(.hide)')?.innerText ?? ''
            }));
            record('note', 'the web app\'s season page: no note anywhere, the episode rows show their own overviews',
                noNote(rows.text) && rows.rows.length > 0 && rows.rows.every(text => text.trim().length > 0), { rows: rows.rows.length, first: rows.rows[0]?.slice(0, 80) });
            await page.screenshot({ path: OUT.replace(/\.json$/, '-note-season-page.png') }).catch(() => {});
        } finally {
            await browser.close();
        }

        // The movie's file copied in: the real movie that takes the placeholder's place has no note; a real item given the note
        // loses it. Then Delete media again, so the steps below have the file-less movie.
        realFile(`/test-media/movies/${MATRIX}`, `${MATRIX}.webm`);
        const arrivedAt = Date.now();
        await scan();
        const real = await until(async () => {
            const list = (await get(`/Items?Recursive=true&IncludeItemTypes=Movie&ParentId=${movies}&Fields=Path,ProviderIds`)).Items
                .filter(item => item.ProviderIds?.Tmdb === '603');
            return list.length === 1 && !own(list[0]) ? list[0] : null;
        }, 180000, 1000);
        time('note_movie_file_arrives_real_api', (Date.now() - arrivedAt) / 1000);
        const realOverview = real.value && await overviewOf(real.value.Id);
        record('note', 'the movie\'s file copied in: one real movie, the placeholder gone, its overview has no note',
            !!real.value && noNote(realOverview), { seconds: real.seconds, overview: realOverview?.slice(0, 80) });
        if (real.value) {
            const dto = await get(`/Items/${real.value.Id}?userId=${sessions.oleksii.id}`);
            await call('POST', `/Items/${real.value.Id}`, { ...dto, Overview: `${NOTE}\n\n${dto.Overview ?? ''}` });
            const stripped = await until(async () => {
                const text = await overviewOf(real.value.Id);
                return noNote(text) ? text ?? '' : null;
            }, 30000, 200);
            record('note', 'a real item given the note loses it, its own overview kept', stripped.value !== null && (stripped.value ?? '') === (dto.Overview ?? ''),
                { seconds: stripped.seconds });
            await call('DELETE', `/Items/${real.value.Id}`);
            const back = await until(async () => (await get(`/Items?Recursive=true&IncludeItemTypes=Movie&ParentId=${movies}&Fields=Path,ProviderIds`)).Items
                .find(item => item.ProviderIds?.Tmdb === '603' && own(item)), 60000);
            // The catalog has no overview for this fixture movie, so the note comes with the placeholder's first refresh.
            const noted = back.value && await until(async () => noteOnce(await overviewOf(back.value.Id)), 60000, 200);
            record('note', 'Delete media again: the placeholder movie is back, the note on it once refreshed', !!noted?.value,
                { back: back.seconds, note: noted?.seconds });
        }
    }

    if (STEPS.has('arrive') && STEPS.has('series')) {
        // A file for the file-less Fawlty Towers' S01E04 (played and favourite) copied in by hand: the series becomes real.
        const started = Date.now();
        realFile(`${seriesFolder(FAWLTY)}/Season 01`, 'Fawlty Towers (1975) S01E04.webm');
        const swapped = await until(async () => {
            const series = await seriesNamed('Fawlty Towers');
            if (series.length !== 1 || own(series[0])) return null;
            const list = await episodesOf(series[0].Id);
            return list.length === 12 && list.filter(item => !own(item)).length === 1 ? { series: series[0], list } : null;
        }, 200000, 500);
        time('file_arrives_fileless_series_becomes_real_api', (Date.now() - started) / 1000);
        record('arrive', 'one real series, its real S01E04 and 11 placeholders under it; no duplicate series', !!swapped.value, { seconds: swapped.seconds });
        if (swapped.value) {
            fawlty = swapped.value.series;
            const real = at(swapped.value.list, 1, 4);
            const kept = await until(async () => marked(await userData(real.Id)) && marked(at(await episodesOf(fawlty.Id), 1, 2)?.UserData)
                && (await userData(fawlty.Id))?.IsFavorite === true, 45000, 500);
            record('arrive', 'the real S01E04 is played on its date and favourite, S01E02 still too, the real series favourite', !!kept.value,
                { e4: await userData(real.Id), series: (await userData(fawlty.Id))?.IsFavorite, seconds: kept.seconds });
            record('arrive', 'Season 1 is the real folder, Season 2 the plugin\'s', (await seasonsOf(fawlty.Id)).map(s => own(s)).join() === 'false,true',
                (await seasonsOf(fawlty.Id)).map(s => s.Path));
            const realSeason = (await seasonsOf(fawlty.Id)).find(s => !own(s));
            const texts = { series: await overviewOf(fawlty.Id), season: realSeason && await overviewOf(realSeason.Id), episode: await overviewOf(real.Id) };
            record('arrive', 'the real series, its real Season 1 and the real S01E04 have no note', Object.values(texts).every(noNote),
                Object.fromEntries(Object.entries(texts).map(([kind, text]) => [kind, text?.slice(0, 80)])));
            const left = at(swapped.value.list, 1, 5);
            record('arrive', 'a placeholder left under the real series (S01E05) still has the note once', noteOnce(left && await overviewOf(left.Id)));
        }
    }

    if (STEPS.has('restart')) {
        const before = await ownCount();
        const data = fawlty && marked(at(await episodesOf(fawlty.Id), 1, 2)?.UserData);
        docker('restart', container);
        await until(async () => (await fetch(new URL('/System/Info/Public', origin)).catch(() => null))?.ok, 120000, 1000);
        await sleep(3000);
        delete sessions.oleksii;
        for (let tries = 0; !sessions.oleksii && tries < 60; tries++) await signIn('oleksii').catch(() => sleep(2000));
        record('restart', 'every placeholder item survives a restart', await ownCount() === before, { before, after: await ownCount() });
        await scan();
        await sleep(2000);
        record('restart', 'and a library scan; user data unchanged', await ownCount() === before && data === marked(at(await episodesOf(fawlty.Id), 1, 2)?.UserData),
            { after: await ownCount() });
    }

    if (STEPS.has('user')) {
        await signIn('nata').catch(() => null);
        if (sessions.nata) {
            const list = await episodesOf(fawlty.Id, 'nata');
            const placeholder = list.find(own);
            record('user', 'nata sees the placeholders, not deletable', list.length === 12 && placeholder?.CanDelete === false, { count: list.length });
            const deleting = await call('DELETE', `/Items/${placeholder?.Id}`, undefined, 'nata');
            record('user', 'nata cannot delete one', deleting.status >= 400, { status: deleting.status });
        } else {
            record('user', 'nata can sign in', false);
        }
    }

    if (STEPS.has('optout')) {
        await call('PUT', `/JellyfinMod/Placeholders/${shows}`, { enabled: false });
        const real = at(await episodesOf(fawlty.Id), 1, 4);
        await call('DELETE', `/Items/${real.Id}`);
        await sleep(6000);
        record('optout', 'with the library off a delete brings no placeholder back', !at(await episodesOf(fawlty.Id), 1, 4));
        const removal = await get(`/JellyfinMod/Placeholders/${shows}/Removal`);
        const ownBefore = (await get(`/Items?Recursive=true&ParentId=${shows}&IncludeItemTypes=Episode&Fields=Path`)).Items.filter(own).length;
        const removed = await call('POST', `/JellyfinMod/Placeholders/${shows}/Remove`);
        const after = (await get(`/Items?Recursive=true&ParentId=${shows}&IncludeItemTypes=Series,Season,Episode&Fields=Path`)).Items;
        record('optout', 'Remove Placeholders removes exactly the plugin\'s items (dry run = done), every real item stays',
            removal?.existing === ownBefore && removed.json?.removals?.length === ownBefore && after.every(item => !own(item))
            && after.some(item => item.Type === 'Episode' && item.Name),
            { dry: removal?.existing, ownBefore, removed: removed.json?.removals?.length, left: after.filter(own).length });
        const started = Date.now();
        await call('PUT', `/JellyfinMod/Placeholders/${shows}`, { enabled: true });
        const back = await until(async () => (await get(`/Items?Recursive=true&ParentId=${shows}&IncludeItemTypes=Episode&Fields=Path`)).Items.filter(own).length > 0, 60000);
        time('opt_in_back_api', (Date.now() - started) / 1000);
        record('optout', 'switched on again, the placeholders come back', !!back.value);
    }

    if (STEPS.has('entry')) {
        const entry = await entryOf(603);
        const removed = await call('DELETE', `/JellyfinMod/Entries/${entry.id}`);
        await sleep(5000);
        const left = (await get(`/Items?Recursive=true&IncludeItemTypes=Movie&ParentId=${movies}&Fields=Path,ProviderIds`)).Items.filter(item => item.ProviderIds?.Tmdb === '603');
        record('entry', 'Remove Entry of the file-less movie removes its item, nothing comes back', removed.status === 204 && left.length === 0,
            { status: removed.status, left: left.length });
    }

    if (STEPS.has('library')) {
        const folders = await get('/Library/VirtualFolders');
        const library = folders.find(folder => folder.CollectionType === 'tvshows');
        const before = (await get(`/Items?Recursive=true&ParentId=${shows}&IncludeItemTypes=Episode&Fields=Path`)).Items.filter(own).length;
        await call('DELETE', `/Library/VirtualFolders?name=${encodeURIComponent(library.Name)}&refreshLibrary=true`);
        const vanished = await until(async () => (await get('/Items?Recursive=true&IncludeItemTypes=Episode,Season,Series&Fields=Path'))?.Items?.filter(own).length === 0, 120000, 1000);
        const gone = (await get('/Items?Recursive=true&IncludeItemTypes=Episode,Season,Series&Fields=Path')).Items.filter(own).length;
        record('library', 'removing the library removes its placeholder items', gone === 0, { seconds: vanished.seconds });
        const started = Date.now();
        const paths = library.Locations.map(Path => ({ Path }));
        await call('POST', `/Library/VirtualFolders?name=${encodeURIComponent(library.Name)}&collectionType=tvshows&refreshLibrary=true`,
            { LibraryOptions: { ...library.LibraryOptions, PathInfos: paths } });
        await libraries();
        // Jellyfin 12.2 drops a library's scan request while another scan runs (the removal's): scan once it is idle, as the
        // nightly scan or an administrator would.
        await scan();
        const back = await until(async () => {
            const plan = await get(`/JellyfinMod/Placeholders/${shows}/Plan`);
            const count = (await get(`/Items?Recursive=true&ParentId=${shows}&IncludeItemTypes=Episode&Fields=Path`))?.Items?.filter(own).length ?? 0;
            return plan?.pending === 0 && count > 0 && count === plan.existing ? count : null;
        }, 300000, 1000);
        time('library_readded_placeholders_back_api', (Date.now() - started) / 1000);
        record('library', 'added again, its placeholders come back', !!back.value, { before, seconds: back.seconds });
    }

    if (STEPS.has('cleanup')) {
        const dry = await get('/JellyfinMod/Placeholders/Items');
        const removed = await call('POST', '/JellyfinMod/Placeholders/Items/Remove');
        await sleep(2000);
        const left = await ownCount();
        record('cleanup', 'Remove All Virtual Items removes every item of the plugin and turns placeholders off', removed.status === 200 && left === 0
            && (removed.json?.itemsRemoved ?? removed.json?.removed) === dry?.items, { dry: dry?.items, removed: removed.json, left });
    }
}

try {
    await main();
} catch (error) {
    record('runner', 'the run finished', false, String(error.stack ?? error).slice(0, 600));
} finally {
    writeFileSync(OUT, JSON.stringify({ results, timings }, null, 2));
    const failed = results.filter(result => result.verdict === 'FAIL');
    console.log(`${results.length} checks, ${failed.length} failed (${tier}); timings ${JSON.stringify(timings)}`);
    process.exitCode = failed.length ? 1 : 0;
}
