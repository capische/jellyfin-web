/* eslint-disable compat/compat, no-restricted-globals, @stylistic/max-statements-per-line, no-empty-function, sonarjs/cognitive-complexity -- a Node acceptance runner, not shipped code */
/* global document, ApiClient, localStorage, location */
// Next Up shows the next real episode after a gap, and play queues skip placeholders (P1.FU28; plan
// docs/jellyfinmod/design/missing-media-user-actions.md §11). Against a local environment or a mod instance, nothing
// intercepted (requests are only observed), signed in as oleksii with an empty password.
//
//   As a native app (plain HTTP with a user token):
//   - Next Up: a real next episode is untouched; a placeholder next is replaced in its slot by the first episode after it that
//     is not a placeholder (in the season, across a season), built with the request's fields, image and user-data options; a
//     series with no real episode after its placeholder is left out; several series with limit and startIndex keep their
//     totals; rewatching never offers a placeholder; enableResumable=false leaves out a resumable replacement as Next Up does;
//     a user for whom that real episode is hidden by a blocked tag gets the next one they may see; a user without access to
//     the library gets nothing;
//   - Resume leaves out a placeholder that carries a position and keeps a real one;
//   - /Shows/{id}/Episodes: listings keep their placeholders (plain, and isMissing=false as Swiftfin's season list asks), a
//     queue from startItemId leaves out the placeholders after the start item (the start item itself stays);
//   - Instant Mix holds no placeholder; /Items listings keep the placeholder movie (browse is unchanged); PlaybackInfo of a
//     placeholder is still NotAllowed.
//   Browser (JELLYFINMOD_LAYOUTS, default desktop), as oleksii, observing the web's own playback start report
//   (POST /Sessions/Playing, its NowPlayingQueue) and PlaybackInfo requests:
//   - Home's continue row shows the replacement episodes and no placeholder;
//   - the series' Play starts at the next real episode; the season's Play, the series' Shuffle, an episode's Play (the queue
//     that plays on after it) and Play All From Here (on a real row and on a placeholder row) queue no placeholder;
//   - the movie library's Play All and Shuffle queue no placeholder movie.
//   Every played mark, position, tag and user policy it changes is put back as it was.
//
//   JELLYFINMOD_TEST_URL=http://127.0.0.1:<port>/
//   JELLYFINMOD_PQ_SERIES_A=<series id>  episodes, in order: real, real, placeholder(s), real, placeholder(s), real in a later
//                                        season (local layout: Peep Show S01E01-02, S01E03-04 placeholders, S01E05, S01E06
//                                        placeholder, S02E02)
//   JELLYFINMOD_PQ_SERIES_B=<series id>  placeholder(s), one real episode, then only placeholders (Fawlty Towers: S01E04 real)
//   JELLYFINMOD_PQ_MOVIES=<movie library id holding a placeholder movie and a movie the browser plays that sorts first>
//   [JELLYFINMOD_PQ_TAGGED=nata] [JELLYFINMOD_PQ_NOACCESS=nata] [JELLYFINMOD_BROWSER=chromium|chrome]
//   [JELLYFINMOD_LAYOUTS=desktop,mobile,tv1080] [JELLYFINMOD_SHOTS=<folder>] [JELLYFINMOD_WEB_PATH=/web/]
//
// Local setup (envs/README.md; a local environment only, reset to its baseline afterwards): the Shows library pointed at a
// writable copy of the series with small playable .webm files for its real episodes, the plugin's placeholders written for
// the rest, a file-less series added from TMDb with one placeholder swapped for a .webm, a file-less movie added from TMDb and
// a .webm movie in a writable Movies folder.
import { chromium } from 'playwright';

const origin = new URL(process.env.JELLYFINMOD_TEST_URL ?? (() => { throw new Error('JELLYFINMOD_TEST_URL is required'); })());
const loopback = ['127.0.0.1', 'localhost'].includes(origin.hostname);
// Never production on 8096: a remote address must be one of the mod instances; a local environment listens on loopback.
if (!loopback && !['18096', '28096', '48096'].includes(origin.port)) throw new Error('Runs on the mod instances or a local environment only');
const required = name => process.env[name] ?? (() => { throw new Error(`${name} is required`); })();
const seriesA = required('JELLYFINMOD_PQ_SERIES_A');
const seriesB = required('JELLYFINMOD_PQ_SERIES_B');
const moviesLibrary = required('JELLYFINMOD_PQ_MOVIES');
// Ordinary users who see the TV library with no restriction of their own (the local baseline's nata; papa and vika there only
// see items with their allowed tags). One user can serve both checks: each starts from that user's original policy.
const taggedUser = process.env.JELLYFINMOD_PQ_TAGGED ?? 'nata';
const noAccessUser = process.env.JELLYFINMOD_PQ_NOACCESS ?? 'nata';
const SHOTS = process.env.JELLYFINMOD_SHOTS ?? '.';
const WEB_PATH = process.env.JELLYFINMOD_WEB_PATH ?? '/web/';
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
const layouts = (process.env.JELLYFINMOD_LAYOUTS ?? 'desktop').split(',').filter(Boolean);
const LAYOUTS = {
    desktop: { viewport: { width: 1440, height: 900 } },
    mobile: {
        viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
    },
    tv1080: { viewport: { width: 1920, height: 1080 }, tv: true }
};
const PAGE = '.page:not(.hide)';
const HIDDEN_TAG = 'jfmod-fu28-hidden';

const results = [];
const record = (label, check, pass, detail) => {
    let verdict = pass;
    if (typeof pass === 'boolean') verdict = pass ? 'PASS' : 'FAIL';
    results.push({ label, check, verdict, detail });
    console.log(`${verdict} [${label}] ${check}${detail === undefined ? '' : ' · ' + JSON.stringify(detail).slice(0, 500)}`);
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const norm = id => (id ?? '').replace(/-/g, '').toLowerCase();
// One device per sign-in: Jellyfin ends a device's earlier session when the same device signs in again.
const clientFor = (user, role) => `MediaBrowser Client="JellyfinMod FU28 runner", Device="node", DeviceId="jfmod-fu28-runner-${user}-${role}", Version="1.0"`;

// ---- A native app: plain HTTP with a user token (never printed) ----

async function signInApi(user, role = 'main') {
    const CLIENT = clientFor(user, role);
    const response = await fetch(new URL('/Users/AuthenticateByName', origin), {
        method: 'POST', headers: { Authorization: CLIENT, 'Content-Type': 'application/json' },
        body: JSON.stringify({ Username: user, Pw: '' })
    });
    if (!response.ok) throw new Error(`Sign-in as ${user} failed (${response.status})`);
    const body = await response.json();
    const auth = `${CLIENT}, Token="${body.AccessToken}"`;
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
    return { user, userId: body.User.Id, call };
}

const ordered = items => items.filter(item => item.ParentIndexNumber > 0)
    .sort((a, b) => a.ParentIndexNumber - b.ParentIndexNumber || a.IndexNumber - b.IndexNumber);
const episodesOf = async (api, seriesId, query = '') => (await api.call('GET',
    `/Shows/${seriesId}/Episodes?userId=${api.userId}&enableUserData=true${query}`)).json?.Items ?? [];
const name = item => item ? `S${String(item.ParentIndexNumber).padStart(2, '0')}E${String(item.IndexNumber).padStart(2, '0')}` : 'none';
const names = items => (items ?? []).map(item => `${item.SeriesName ?? item.Name} ${name(item)}${item.IsPlaceHolder ? ' (placeholder)' : ''}`);
const setPlayed = (api, id, played) => api.call(played ? 'POST' : 'DELETE', `/UserPlayedItems/${id}?userId=${api.userId}`);
const setPosition = (api, id, ticks) => api.call('POST', `/UserItems/${id}/UserData?userId=${api.userId}`, { PlaybackPositionTicks: ticks });
const nextUp = async (api, query) => (await api.call('GET', `/Shows/NextUp?userId=${api.userId}${query}`)).json;

/** Exactly these episodes played for this user, every other one of the two series unplayed. */
async function playedOnly(api, episodes, ids) {
    const wanted = new Set(ids.map(norm));
    for (const item of episodes) {
        const fresh = (await api.call('GET', `/UserItems/${item.Id}/UserData?userId=${api.userId}`)).json;
        if (!!fresh?.Played !== wanted.has(norm(item.Id))) await setPlayed(api, item.Id, wanted.has(norm(item.Id)));
    }
}

/** Jellyfin's rule with placeholders skipped: the first episode after the last played one that is not a placeholder. */
function expectedNext(list, playedIds) {
    const played = new Set(playedIds.map(norm));
    const last = list.reduce((found, item, index) => (played.has(norm(item.Id)) ? index : found), -1);
    return list.slice(last + 1).find(item => !item.IsPlaceHolder && !played.has(norm(item.Id))) ?? null;
}

async function saveUserData(api, items) {
    const saved = [];
    for (const item of items) {
        const data = (await api.call('GET', `/UserItems/${item.Id}/UserData?userId=${api.userId}`)).json;
        saved.push({ id: item.Id, played: !!data?.Played, ticks: data?.PlaybackPositionTicks ?? 0 });
    }
    return saved;
}

async function restoreUserData(api, saved) {
    for (const { id, played, ticks } of saved) {
        const data = (await api.call('GET', `/UserItems/${id}/UserData?userId=${api.userId}`)).json;
        if (!!data?.Played !== played) await setPlayed(api, id, played);
        if ((data?.PlaybackPositionTicks ?? 0) !== ticks) await setPosition(api, id, ticks);
    }
}

async function setTags(admin, itemId, tags) {
    const item = (await admin.call('GET', `/Items/${itemId}?userId=${admin.userId}`)).json;
    if (!item) return false;
    return (await admin.call('POST', `/Items/${itemId}`, { ...item, Tags: tags })).status === 204;
}

async function apiChecks(admin, tagged, noAccess, world) {
    const label = 'api';
    const { a, b, movieStub, movieReal } = world;
    const stubIds = new Set([...a, ...b].filter(item => item.IsPlaceHolder).map(item => norm(item.Id)));
    const hasStub = items => (items ?? []).some(item => item.IsPlaceHolder || stubIds.has(norm(item.Id)));
    const [aFirst, aSecond] = a;
    const aStub = a.find(item => item.IsPlaceHolder);
    const aGapReal = a.slice(a.indexOf(aStub) + 1).find(item => !item.IsPlaceHolder);
    const bReal = b.find(item => !item.IsPlaceHolder);
    record(label, 'the layout: series A real, real, placeholder…, real; series B placeholders around one real episode',
        !aFirst?.IsPlaceHolder && !aSecond?.IsPlaceHolder && !!aStub && !!aGapReal && !!bReal && b[0]?.IsPlaceHolder
            && b.slice(b.indexOf(bReal) + 1).every(item => item.IsPlaceHolder) && b.indexOf(bReal) < b.length - 1,
        { a: names(a), b: names(b) });

    // A real next episode is Jellyfin's own answer, untouched.
    await playedOnly(admin, [...a, ...b], [aFirst.Id]);
    let answer = await nextUp(admin, `&seriesId=${seriesA}`);
    record(label, `Next Up with ${name(aFirst)} played: ${name(aSecond)}, untouched`,
        answer?.Items.length === 1 && norm(answer.Items[0].Id) === norm(aSecond.Id) && answer.TotalRecordCount === 1, names(answer?.Items));

    // A placeholder next: the first real episode after the gap takes its slot.
    await playedOnly(admin, [...a, ...b], [aFirst.Id, aSecond.Id]);
    const expectA = expectedNext(a, [aFirst.Id, aSecond.Id]);
    answer = await nextUp(admin, `&seriesId=${seriesA}&fields=Path,Overview`);
    record(label, `Next Up with ${name(aSecond)} played (${name(aStub)} a placeholder): ${name(expectA)}, a full item answer`,
        answer?.Items.length === 1 && norm(answer.Items[0].Id) === norm(expectA?.Id) && answer.TotalRecordCount === 1
            && !!answer.Items[0].Path && !!answer.Items[0].Overview && !!answer.Items[0].UserData && !!answer.Items[0].SeriesName,
        { items: names(answer?.Items), total: answer?.TotalRecordCount, path: !!answer?.Items[0]?.Path, overview: !!answer?.Items[0]?.Overview });
    answer = await nextUp(admin, `&seriesId=${seriesA}&enableUserData=false&enableImages=false`);
    const bare = answer?.Items[0];
    record(label, 'the replacement honours the request\'s options: no Path unless asked, no user data or images when turned off',
        !!bare && norm(bare.Id) === norm(expectA?.Id) && !bare.Path && !bare.UserData && !Object.keys(bare.ImageTags ?? {}).length,
        { path: bare?.Path, userData: !!bare?.UserData, images: Object.keys(bare?.ImageTags ?? {}) });

    // Across a season.
    const playedAcross = a.slice(0, a.indexOf(expectA) + 1).filter(item => !item.IsPlaceHolder).map(item => item.Id);
    await playedOnly(admin, [...a, ...b], playedAcross);
    const expectAcross = expectedNext(a, playedAcross);
    answer = await nextUp(admin, `&seriesId=${seriesA}`);
    record(label, `Next Up with ${name(expectA)} played: ${name(expectAcross)}${expectAcross && expectAcross.ParentIndexNumber !== expectA.ParentIndexNumber ? ', across the season' : ''}`,
        !!expectAcross && answer?.Items.length === 1 && norm(answer.Items[0].Id) === norm(expectAcross.Id), names(answer?.Items));

    // A placeholder at the end: nothing real follows, the series is left out.
    await playedOnly(admin, [...a, ...b], [bReal.Id]);
    answer = await nextUp(admin, `&seriesId=${seriesB}`);
    record(label, `Next Up with ${name(bReal)} played and only placeholders after it: the series is left out, total 0`,
        answer?.Items.length === 0 && answer.TotalRecordCount === 0, { items: names(answer?.Items), total: answer?.TotalRecordCount });

    // Several series, paging and totals.
    const bPlayed = [b[0].Id];
    await playedOnly(admin, [...a, ...b], [aFirst.Id, aSecond.Id, ...bPlayed]);
    const expectB = expectedNext(b, bPlayed);
    const wanted = [norm(expectA.Id), norm(expectB?.Id)];
    answer = await nextUp(admin, '&limit=50');
    const ids = (answer?.Items ?? []).map(item => norm(item.Id));
    record(label, `Next Up for every series (${name(b[0])} of series B a placeholder marked played): ${name(expectA)} and ${name(expectB)}, no placeholder, the total right`,
        !!expectB && wanted.every(id => ids.includes(id)) && !hasStub(answer?.Items) && answer.TotalRecordCount === answer.Items.length,
        { items: names(answer?.Items), total: answer?.TotalRecordCount });
    const pageOne = await nextUp(admin, '&limit=1&startIndex=0');
    const pageTwo = await nextUp(admin, '&limit=1&startIndex=1');
    const paged = [...(pageOne?.Items ?? []), ...(pageTwo?.Items ?? [])].map(item => norm(item.Id));
    record(label, 'limit=1 with startIndex 0 and 1: one item each, together both replacements, the total 2 on both pages',
        pageOne?.Items.length === 1 && pageTwo?.Items.length === 1 && wanted.every(id => paged.includes(id))
            && pageOne.TotalRecordCount === answer?.TotalRecordCount && pageTwo.TotalRecordCount === answer?.TotalRecordCount,
        { one: names(pageOne?.Items), two: names(pageTwo?.Items), totals: [pageOne?.TotalRecordCount, pageTwo?.TotalRecordCount] });
    answer = await nextUp(admin, '&limit=50&enableTotalRecordCount=false');
    record(label, 'enableTotalRecordCount=false: the same items, no placeholder', !hasStub(answer?.Items)
        && wanted.every(id => answer.Items.some(item => norm(item.Id) === id)), { items: names(answer?.Items), total: answer?.TotalRecordCount });
    answer = await nextUp(admin, '&limit=50&enableRewatching=true');
    record(label, 'enableRewatching=true offers no placeholder', !!answer && !hasStub(answer.Items), names(answer?.Items));
    answer = await nextUp(admin, `&limit=50&parentId=${world.showsLibrary}&nextUpDateCutoff=2000-01-01`);
    record(label, 'parentId (the TV library) and nextUpDateCutoff: the same replacements', !!answer && !hasStub(answer.Items)
        && wanted.every(id => answer.Items.some(item => norm(item.Id) === id)), names(answer?.Items));

    // enableResumable=false leaves out a series whose next episode has a position, also when it is the replacement.
    await setPosition(admin, expectA.Id, 600000000);
    const resumable = await nextUp(admin, `&seriesId=${seriesA}`);
    const notResumable = await nextUp(admin, `&seriesId=${seriesA}&enableResumable=false`);
    record(label, `with a position on ${name(expectA)}: listed by default, left out with enableResumable=false (as Next Up does)`,
        resumable?.Items.length === 1 && notResumable?.Items.length === 0, { default: names(resumable?.Items), notResumable: names(notResumable?.Items) });

    // Resume: a placeholder carrying a position (from the file it stands in for) is left out, a real one stays.
    await setPosition(admin, aStub.Id, 600000000);
    const resume = (await admin.call('GET', `/UserItems/Resume?userId=${admin.userId}&limit=50`)).json;
    const legacy = (await admin.call('GET', `/Users/${admin.userId}/Items/Resume?limit=50`)).json;
    record(label, `Resume (and its legacy route): ${name(expectA)} listed, the placeholder ${name(aStub)} with a position left out, the total right`,
        [resume, legacy].every(page => !!page && page.Items.some(item => norm(item.Id) === norm(expectA.Id))
            && !page.Items.some(item => norm(item.Id) === norm(aStub.Id)) && page.TotalRecordCount === page.Items.length),
        { resume: names(resume?.Items), total: resume?.TotalRecordCount, legacy: names(legacy?.Items) });
    await setPosition(admin, aStub.Id, 0);
    await setPosition(admin, expectA.Id, 0);

    // /Shows/{id}/Episodes: listings keep placeholders; a queue from a start item leaves out those after it.
    const plain = await episodesOf(admin, seriesA);
    const notMissing = await episodesOf(admin, seriesA, '&isMissing=false');
    record(label, 'the series\' episode list keeps its placeholders (plain, and isMissing=false as Swiftfin\'s season list asks)',
        plain.filter(item => item.IsPlaceHolder).length === a.filter(item => item.IsPlaceHolder).length
            && notMissing.filter(item => item.IsPlaceHolder).length === a.filter(item => item.IsPlaceHolder).length,
        { plain: plain.length, notMissing: notMissing.length });
    const fromSecond = (await admin.call('GET', `/Shows/${seriesA}/Episodes?userId=${admin.userId}&isMissing=false&isVirtualUnaired=false&startItemId=${aSecond.Id}&limit=100`)).json;
    const queueAfter = a.slice(a.indexOf(aSecond)).filter(item => !item.IsPlaceHolder).map(item => norm(item.Id));
    record(label, `a queue from ${name(aSecond)} (startItemId, as upstream web and Android TV build it): the real episodes after it only, the total right`,
        !!fromSecond && JSON.stringify(fromSecond.Items.map(item => norm(item.Id))) === JSON.stringify(queueAfter) && fromSecond.TotalRecordCount === queueAfter.length,
        { items: names(fromSecond?.Items), total: fromSecond?.TotalRecordCount });
    const fromStub = (await admin.call('GET', `/Shows/${seriesA}/Episodes?userId=${admin.userId}&startItemId=${aStub.Id}`)).json;
    record(label, `a queue from the placeholder ${name(aStub)}: it stays first (its playback is refused), the placeholders after it left out`,
        !!fromStub && norm(fromStub.Items[0]?.Id) === norm(aStub.Id) && !fromStub.Items.slice(1).some(item => item.IsPlaceHolder),
        names(fromStub?.Items));

    // Instant Mix (audio only in Jellyfin 12) and browse listings.
    const mixes = await Promise.all([movieStub.Id, seriesA, aStub.Id, world.showsLibrary].map(async id =>
        (await admin.call('GET', `/Items/${id}/InstantMix?userId=${admin.userId}&limit=50`)).json?.Items ?? null));
    record(label, 'Instant Mix of the placeholder movie, the series, a placeholder episode and the library holds no placeholder',
        mixes.every(items => Array.isArray(items) && !items.some(item => item.IsPlaceHolder)), mixes.map(items => items?.length));
    const movies = (await admin.call('GET', `/Items?userId=${admin.userId}&parentId=${moviesLibrary}&recursive=true&includeItemTypes=Movie`)).json?.Items ?? [];
    const webQueue = (await admin.call('GET', `/Items?userId=${admin.userId}&ParentId=${moviesLibrary}&Filters=IsNotFolder&Recursive=true&SortBy=SortName&MediaTypes=Audio,Video&ExcludeLocationTypes=Virtual&EnableTotalRecordCount=false`)).json?.Items ?? [];
    record(label, 'the movie library\'s listings keep the placeholder movie (browse unchanged; the web\'s queue builder leaves it out)',
        movies.some(item => norm(item.Id) === norm(movieStub.Id)) && webQueue.some(item => norm(item.Id) === norm(movieStub.Id)),
        { movies: movies.map(item => item.Name), queueShape: webQueue.map(item => item.Name) });
    const info = await admin.call('POST', `/Items/${aStub.Id}/PlaybackInfo?userId=${admin.userId}`, {});
    const realInfo = await admin.call('POST', `/Items/${movieReal.Id}/PlaybackInfo?userId=${admin.userId}`, {});
    record(label, 'PlaybackInfo: NotAllowed for a placeholder, media sources for a real item (unchanged)',
        info.json?.ErrorCode === 'NotAllowed' && !realInfo.json?.ErrorCode && realInfo.json?.MediaSources?.length > 0);

    // A user for whom the real episode after the gap is hidden by a blocked tag gets the next one they may see.
    const taggedPolicy = (await admin.call('GET', `/Users/${tagged.userId}`)).json?.Policy;
    const noAccessPolicy = (await admin.call('GET', `/Users/${noAccess.userId}`)).json?.Policy;
    try {
        await setTags(admin, expectA.Id, [HIDDEN_TAG]);
        await admin.call('POST', `/Users/${tagged.userId}/Policy`, { ...taggedPolicy, BlockedTags: [HIDDEN_TAG] });
        await playedOnly(tagged, a, [aFirst.Id, aSecond.Id]);
        const hidden = (await tagged.call('GET', `/Items/${expectA.Id}?userId=${tagged.userId}`)).status;
        const expectTagged = expectedNext(a.filter(item => norm(item.Id) !== norm(expectA.Id)), [aFirst.Id, aSecond.Id]);
        const taggedAnswer = await nextUp(tagged, `&seriesId=${seriesA}`);
        const adminAnswer = await nextUp(admin, `&seriesId=${seriesA}`);
        record(label, `${taggedUser} with ${name(expectA)} hidden by a blocked tag: Next Up gives ${name(expectTagged)}, never the hidden one; oleksii still gets ${name(expectA)}`,
            hidden === 404 && taggedAnswer?.Items.length === 1 && norm(taggedAnswer.Items[0].Id) === norm(expectTagged?.Id)
                && norm(adminAnswer?.Items[0]?.Id) === norm(expectA.Id),
            { hidden, tagged: names(taggedAnswer?.Items), admin: names(adminAnswer?.Items) });

        // A user without access to the TV library gets nothing from it, replacements included.
        await playedOnly(noAccess, a, [aFirst.Id, aSecond.Id]);
        const before = await nextUp(noAccess, `&seriesId=${seriesA}`);
        await admin.call('POST', `/Users/${noAccess.userId}/Policy`, { ...noAccessPolicy, EnableAllFolders: false, EnabledFolders: [moviesLibrary] });
        const all = await nextUp(noAccess, '&limit=50');
        const one = await nextUp(noAccess, `&seriesId=${seriesA}`);
        const shown = [...(all?.Items ?? []), ...(one?.Items ?? [])].filter(item => [norm(seriesA), norm(seriesB)].includes(norm(item.SeriesId)));
        record(label, `${noAccessUser}, who had series A in Next Up, without access to the TV library: Next Up holds nothing of it`,
            before?.Items.length === 1 && !!all && !!one && shown.length === 0 && one.TotalRecordCount === 0,
            { before: names(before?.Items), all: names(all?.Items), one: names(one?.Items) });
    } finally {
        await setTags(admin, expectA.Id, []);
        if (taggedPolicy) await admin.call('POST', `/Users/${tagged.userId}/Policy`, taggedPolicy);
        if (noAccessPolicy) await admin.call('POST', `/Users/${noAccess.userId}/Policy`, noAccessPolicy);
    }

    // The state the browser part starts from.
    await playedOnly(admin, [...a, ...b], [aFirst.Id, aSecond.Id, ...bPlayed]);
    return { expectA, expectB, aStub, aSecond, bStubNext: b[1], stubIds };
}

// ---- The browser ----

const signedIn = page => page.evaluate(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } });

async function signIn(page, user) {
    await page.goto(new URL(WEB_PATH, origin).href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.ApiClient, undefined, { timeout: 30000 });
    await page.waitForFunction(() => {
        try { return !!ApiClient.getCurrentUserId() || /login|selectuser|selectserver/.test(location.hash); } catch { return false; }
    }, undefined, { timeout: 30000 });
    if (await signedIn(page)) return;
    const field = page.locator('#txtManualName');
    if (!await field.isVisible().catch(() => false)) {
        const chooser = page.locator('.btnManual').first();
        await chooser.waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
        if (await chooser.count()) await chooser.evaluate(node => node.click());
        await field.waitFor({ state: 'visible', timeout: 15000 });
    }
    await page.waitForTimeout(1000);
    await field.fill(user);
    await page.locator('#txtManualPassword').fill('');
    await page.locator('button:visible').filter({ hasText: 'Sign In' }).first().click();
    await page.waitForFunction(() => location.hash.startsWith('#/home'), undefined, { timeout: 30000 });
}

const go = async (page, hash) => {
    await page.evaluate(target => { location.hash = target; }, hash);
    await page.waitForTimeout(500);
};

/** A fresh signed-in page per flow, so each queue starts from nothing; the web's playback requests are observed. */
async function withPage(browser, layout, run) {
    const options = LAYOUTS[layout];
    const context = await browser.newContext({ ...options, tv: undefined });
    const page = await context.newPage();
    const seen = { infos: [], starts: [], errors: [] };
    page.on('pageerror', error => seen.errors.push(String(error.message ?? error).split('\n')[0]));
    page.on('request', request => {
        const url = new URL(request.url());
        const info = /\/Items\/([0-9a-f-]{32,36})\/PlaybackInfo$/i.exec(url.pathname);
        if (info && request.method() === 'POST') seen.infos.push(norm(info[1]));
        if (/\/Sessions\/Playing$/i.test(url.pathname) && request.method() === 'POST') {
            try {
                const body = JSON.parse(request.postData() ?? '{}');
                seen.starts.push({ item: norm(body.ItemId), queue: (body.NowPlayingQueue ?? []).map(entry => norm(entry.Id)) });
            } catch { /* not JSON */ }
        }
    });
    try {
        await signIn(page, 'oleksii');
        if (options.tv) {
            await page.evaluate(() => localStorage.setItem('layout', 'tv'));
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => !!window.ApiClient, undefined, { timeout: 30000 });
        }
        return await run(page, seen);
    } finally {
        await page.goBack().catch(() => {});
        await page.waitForTimeout(1500);
        await context.close();
    }
}

/** Waits for the first PlaybackInfo and, when the browser can play the item, the start report with its queue. */
async function playback(seen, wantStart = true) {
    for (let waited = 0; waited < 25000 && !(seen.infos.length && (seen.starts.length || !wantStart)); waited += 500) await sleep(500);
    return { first: seen.infos[0] ?? null, start: seen.starts[0] ?? null };
}

async function clickButton(page, selector) {
    const button = page.locator(selector).first();
    await button.waitFor({ state: 'visible', timeout: 30000 });
    await button.click();
}

async function browserChecks(browser, layout, world, flow) {
    const label = `${layout}`;
    const { expectA, expectB, aStub, aSecond, bStubNext, stubIds, a, movieStub } = { ...world, ...flow };
    const queueClean = start => !!start && !start.queue.some(id => stubIds.has(id) || id === norm(movieStub.Id));
    const realA = a.filter(item => !item.IsPlaceHolder).map(item => norm(item.Id));

    // Home's continue row: the replacements, no placeholder.
    await withPage(browser, layout, async page => {
        await go(page, '#/home');
        const wantedIds = [norm(expectA.Id), norm(expectB.Id)];
        await page.waitForFunction(ids => ids.every(id => document.querySelector(`.page:not(.hide) [data-id="${id}"]`)), wantedIds, { timeout: 30000 }).catch(() => {});
        const shown = await page.evaluate(() => [...document.querySelectorAll('.page:not(.hide) [data-id]')].map(node => node.getAttribute('data-id')));
        await page.screenshot({ path: `${SHOTS}/pq-${layout}-home.png` });
        record(label, `Home's continue row shows ${name(expectA)} of series A and ${name(expectB)} of series B, and no placeholder`,
            wantedIds.every(id => shown.includes(id)) && !shown.some(id => stubIds.has(norm(id))) && !shown.includes(norm(bStubNext.Id)),
            { found: wantedIds.map(id => shown.includes(id)), placeholders: shown.filter(id => stubIds.has(norm(id))) });
    });

    // The series' Play starts at the next real episode (upstream asks Next Up where to start).
    await withPage(browser, layout, async (page, seen) => {
        await go(page, `#/details?id=${seriesA}`);
        await clickButton(page, `${PAGE} .mainDetailButtons .btnPlay`);
        const { first, start } = await playback(seen);
        await page.screenshot({ path: `${SHOTS}/pq-${layout}-series-play.png` });
        record(label, `the series' Play starts at ${name(expectA)} (the next real episode) and queues no placeholder`,
            first === norm(expectA.Id) && start?.item === norm(expectA.Id) && queueClean(start), { first, start, errors: seen.errors });
    });

    // The season's Play: upstream starts at the first unplayed episode, a placeholder; the queue starts at the next real one.
    await withPage(browser, layout, async (page, seen) => {
        await go(page, `#/details?id=${aStub.SeasonId}`);
        await clickButton(page, `${PAGE} .mainDetailButtons .btnPlay`);
        const { first, start } = await playback(seen);
        const season = realA.filter(id => a.find(item => norm(item.Id) === id)?.SeasonId === aStub.SeasonId);
        record(label, `the season's Play starts at ${name(expectA)} and queues the season's real episodes only`,
            first === norm(expectA.Id) && start?.item === norm(expectA.Id) && JSON.stringify(start?.queue) === JSON.stringify(season),
            { first, start, season });
    });

    // The series' Shuffle.
    await withPage(browser, layout, async (page, seen) => {
        await go(page, `#/details?id=${seriesA}`);
        await clickButton(page, `${PAGE} .mainDetailButtons .btnShuffle`);
        const { first, start } = await playback(seen);
        record(label, 'the series\' Shuffle starts on a real episode and queues no placeholder',
            !!first && !stubIds.has(first) && queueClean(start) && start.queue.length === realA.length, { first, start });
    });

    // An episode's Play: the queue that plays on after it (auto-play of the next episode) jumps the gap.
    await withPage(browser, layout, async (page, seen) => {
        await go(page, `#/details?id=${aSecond.Id}`);
        await clickButton(page, `${PAGE} .mainDetailButtons .btnPlay`);
        const { first, start } = await playback(seen);
        const after = realA.slice(realA.indexOf(norm(aSecond.Id)));
        record(label, `${name(aSecond)}'s Play queues the real episodes after it (${name(expectA)} next), no placeholder`,
            first === norm(aSecond.Id) && start?.item === norm(aSecond.Id) && JSON.stringify(start?.queue) === JSON.stringify(after),
            { first, start, after });
    });

    // Play All From Here on the season page, from a real row and from a placeholder row (desktop and phone rows carry ⋯).
    for (const [from, expected] of [[aSecond, aSecond], [aStub, expectA]]) {
        await withPage(browser, layout, async (page, seen) => {
            await go(page, `#/details?id=${aStub.SeasonId}`);
            const row = `${PAGE} #listChildrenCollapsible .listItem[data-id="${norm(from.Id)}"]`;
            await page.waitForSelector(row, { timeout: 30000 }).catch(() => {});
            const menu = page.locator(`${row} button[data-action="menu"]`).first();
            if (!await menu.isVisible().catch(() => false)) {
                record(label, `Play All From Here on ${name(from)}'s row`, 'NOT VERIFIED', 'no ⋯ on the row in this layout');
                return;
            }
            await menu.click();
            const item = page.locator('.actionSheet button[data-id="playallfromhere"]').first();
            await item.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
            if (!await item.isVisible().catch(() => false)) {
                record(label, `Play All From Here on ${name(from)}'s row`, 'NOT VERIFIED', 'the menu offers no Play All From Here');
                return;
            }
            await item.click();
            const { first, start } = await playback(seen);
            record(label, `Play All From Here on ${name(from)}${from.IsPlaceHolder ? ' (a placeholder)' : ''}: starts at ${name(expected)}, no placeholder queued`,
                first === norm(expected.Id) && start?.item === norm(expected.Id) && queueClean(start), { first, start });
        });
    }

    // The movie library's Play All and Shuffle (a placeholder movie in it, FU26).
    for (const action of ['Play All', 'Shuffle']) {
        await withPage(browser, layout, async (page, seen) => {
            await go(page, `#/movies?topParentId=${moviesLibrary}`);
            // The grid's toolbar sits in the app bar, outside the page.
            await clickButton(page, `button[title="${action}"]:visible`);
            const { first, start } = await playback(seen, action === 'Play All');
            // Play All starts on a movie this browser plays (the .webm sorts first by name), so its start report shows the queue;
            // Shuffle may start on one it cannot play here (H.264 in Chromium), and then only its first PlaybackInfo is seen.
            const reported = action === 'Shuffle' ? !start || queueClean(start) : queueClean(start);
            record(label, `the movie library's ${action}: starts on a real movie, the placeholder movie not queued`,
                !!first && first !== norm(movieStub.Id) && reported, { first, start });
        });
    }
}

const admin = await signInApi('oleksii');
const tagged = await signInApi(taggedUser, 'tagged');
const noAccess = await signInApi(noAccessUser, 'noaccess');
const views = (await admin.call('GET', `/UserViews?userId=${admin.userId}`)).json?.Items ?? [];
const a = ordered(await episodesOf(admin, seriesA));
const b = ordered(await episodesOf(admin, seriesB));
const moviesList = (await admin.call('GET', `/Items?userId=${admin.userId}&parentId=${moviesLibrary}&recursive=true&includeItemTypes=Movie&sortBy=SortName`)).json?.Items ?? [];
const world = {
    a, b,
    showsLibrary: views.find(view => view.CollectionType === 'tvshows')?.Id,
    movieStub: moviesList.find(item => item.IsPlaceHolder),
    movieReal: moviesList.find(item => !item.IsPlaceHolder)
};
if (!world.movieStub || !world.movieReal || !world.showsLibrary) throw new Error('A TV library and a movie library with a placeholder and a real movie are required');
const savedData = [
    [admin, await saveUserData(admin, [...a, ...b, ...moviesList])],
    [tagged, await saveUserData(tagged, a)],
    [noAccess, await saveUserData(noAccess, a)]
];
try {
    const flow = await apiChecks(admin, tagged, noAccess, world);
    const browser = await chromium.launch({ headless: true, ...(tier === 'chrome' ? { channel: 'chrome' } : {}), args: ['--autoplay-policy=no-user-gesture-required'] });
    try {
        for (const layout of layouts) {
            try {
                await browserChecks(browser, layout, world, flow);
            } catch (error) {
                record(layout, 'the browser run completed', false, String(error?.message ?? error).split('\n')[0]);
            }
        }
    } finally {
        await browser.close();
    }
} finally {
    for (const [api, saved] of savedData) await restoreUserData(api, saved);
    const left = await saveUserData(admin, [...a, ...b]);
    const before = savedData[0][1];
    record('restore', 'played marks and positions put back as they were', left.every(item => {
        const was = before.find(entry => entry.id === item.id);
        return was && was.played === item.played && was.ticks === item.ticks;
    }));
}
const failed = results.filter(result => result.verdict === 'FAIL').length;
console.log(`${results.length} checks, ${failed} failed (${tier}, ${layouts.join(',')})`);
process.exitCode = failed ? 1 : 0;
/* eslint-enable compat/compat, no-restricted-globals, @stylistic/max-statements-per-line, no-empty-function, sonarjs/cognitive-complexity */
