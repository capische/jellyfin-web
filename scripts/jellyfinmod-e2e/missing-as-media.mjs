/* eslint-disable compat/compat, no-restricted-globals, @stylistic/max-statements-per-line, no-empty-function, sonarjs/cognitive-complexity -- a Node acceptance runner, not shipped code */
/* global window, document, ApiClient, localStorage, location */
// Missing episodes as Jellyfin placeholder items (P1.FU24; plan docs/jellyfinmod/design/missing-media-user-actions.md).
// Against a running mod instance or local environment, nothing intercepted, signed in as oleksii with an empty password:
//
//   Plugin and stock API, as a native app calls it (plain HTTP with a user token):
//   - the switch is on by default (user, 2026-10-15: "That's the point"); a library whose folders are all read-only writes
//     nothing (then the run stops there); the dry run (GET /JellyfinMod/Placeholders/{library}/Plan) lists the files a sync
//     would write and changes nothing; turned off, a sync writes none; turned back on, it writes them a few series per run;
//     a second dry run then writes nothing more;
//   - Jellyfin holds each stub as an episode with IsPlaceHolder, its TMDB overview, DateCreated on its air date, a runtime,
//     CanDownload false; the plugin keeps the episode missing (not onDisk) and names the stub as its placeholderItemId;
//   - Next Up leaves the stub out (P1.FU28 puts the series' next real episode in its slot, placeholder-queues.mjs checks
//     which), Latest lists no stub;
//     PlaybackInfo answers NotAllowed with no media source, Download, stream and HLS answer 404, a real episode is untouched;
//     playback reports on the stub (start, progress, stopped, legacy) are dropped and leave it unplayed; marking it played and
//     favourite by hand works (and is undone).
//   Browser (JELLYFINMOD_LAYOUTS, default desktop):
//   - the stub's row on its season page: marked as a placeholder, the Not Downloaded mark (an administrator's button), no Play
//     on its image, no "Ends at", upstream's ✓ ♥ ⋯; ♥ on the row toggles the favourite (checked through the API, undone);
//   - a season card whose episodes are all stubs: no Play on hover, an administrator's centre Get a Release;
//   - the stub's own page: no Play or "Ends at", ✓ ♥ and the administrator's Get a Release in the header; its season's stub
//     cards carry the Not Downloaded mark.
//   Then (JELLYFINMOD_MAM_REMOVE=1) Remove Placeholders: its dry run lists only .disc files, the run removes them, Jellyfin drops
//   the stub items, and the switch is put back as it was.
//
//   JELLYFINMOD_TEST_URL=http://<host>:<port>/   a mod instance (18096, 28096, 48096) or a local environment on 127.0.0.1
//   JELLYFINMOD_MAM_LIBRARY=<TV library id>       a library whose series folders the plugin may write (never production media)
//   JELLYFINMOD_MAM_ENTRY=<series entry id>       a series in it that Jellyfin holds, with missing aired episodes
//   [JELLYFINMOD_MAM_USER=<ordinary user>]  [JELLYFINMOD_MAM_REMOVE=1]  [JELLYFINMOD_BROWSER=chromium|chrome]
//   [JELLYFINMOD_LAYOUTS=desktop,mobile,tv1080]  [JELLYFINMOD_SHOTS=<folder>]  [JELLYFINMOD_WEB_PATH=/web/]
//
// It writes placeholder files into that library (the switch is on by default), and removes them only with
// JELLYFINMOD_MAM_REMOVE=1; every played and favourite mark it sets is undone and the switch is left as it was found.
import { chromium } from 'playwright';

const origin = new URL(process.env.JELLYFINMOD_TEST_URL ?? (() => { throw new Error('JELLYFINMOD_TEST_URL is required'); })());
const loopback = ['127.0.0.1', 'localhost'].includes(origin.hostname);
// Never production on 8096: a remote address must be one of the mod instances; a local environment listens on loopback.
if (!loopback && !['18096', '28096', '48096'].includes(origin.port)) throw new Error('Runs on the mod instances or a local environment only');
const libraryId = process.env.JELLYFINMOD_MAM_LIBRARY ?? (() => { throw new Error('JELLYFINMOD_MAM_LIBRARY is required'); })();
const entryId = process.env.JELLYFINMOD_MAM_ENTRY ?? (() => { throw new Error('JELLYFINMOD_MAM_ENTRY is required'); })();
const ordinaryUser = process.env.JELLYFINMOD_MAM_USER ?? null;
const removeAtEnd = process.env.JELLYFINMOD_MAM_REMOVE === '1';
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

const results = [];
const record = (label, check, pass, detail) => {
    let verdict = pass;
    if (typeof pass === 'boolean') verdict = pass ? 'PASS' : 'FAIL';
    results.push({ label, check, verdict, detail });
    console.log(`${verdict} [${label}] ${check}${detail === undefined ? '' : ' · ' + JSON.stringify(detail).slice(0, 400)}`);
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const norm = id => (id ?? '').replace(/-/g, '').toLowerCase();

// ---- A native app: plain HTTP with a user token (never printed) ----

// One device per user: Jellyfin ends a device's earlier session when the same device signs in again.
const clientFor = user => `MediaBrowser Client="JellyfinMod FU24 runner", Device="node", DeviceId="jfmod-fu24-runner-${user}", Version="1.0"`;

async function signInApi(user) {
    const CLIENT = clientFor(user);
    const response = await fetch(new URL('/Users/AuthenticateByName', origin), {
        method: 'POST', headers: { Authorization: CLIENT, 'Content-Type': 'application/json' },
        body: JSON.stringify({ Username: user, Pw: '' })
    });
    if (!response.ok) throw new Error(`Sign-in as ${user} failed (${response.status})`);
    const body = await response.json();
    const auth = `${CLIENT}, Token="${body.AccessToken}"`;
    const call = async (method, path, data, headers = {}) => {
        const answer = await fetch(new URL(path, origin), {
            method, headers: { Authorization: auth, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
            body: data === undefined ? undefined : JSON.stringify(data)
        });
        const type = answer.headers.get('content-type') ?? '';
        const json = type.includes('json') ? await answer.json().catch(() => null) : null;
        if (!json) await answer.body?.cancel().catch(() => {});
        return { status: answer.status, json };
    };
    return { userId: body.User.Id, call };
}

const episodesOf = async (call, userId, seriesId) => (await call('GET',
    `/Shows/${seriesId}/Episodes?userId=${userId}&fields=Path,Overview,DateCreated,CanDownload,PremiereDate&enableUserData=true`)).json?.Items ?? [];

async function apiChecks(admin, ordinary) {
    const label = 'api';
    const { call, userId } = admin;
    const library = (await call('GET', '/JellyfinMod/Placeholders')).json?.find(item => norm(item.libraryId) === norm(libraryId));
    record(label, 'the library is listed with its switch, on by default', !!library && library.enabled, library);
    if (!library) return null;
    const wasEnabled = library.enabled;
    if (!library.writable) {
        // A library whose every folder is read-only (a production media mount) gets nothing, and the dry run says why.
        const plan = (await call('GET', `/JellyfinMod/Placeholders/${libraryId}/Plan`)).json;
        const run = (await call('POST', `/JellyfinMod/Placeholders/${libraryId}/Sync`)).json;
        record(label, 'a read-only library: the dry run and a sync write nothing, and say read_only',
            !!plan && !!run && plan.writes.length === 0 && run.writes.length === 0 && plan.skipped.length > 0
                && plan.skipped.every(skip => skip.reason === 'read_only'),
            { writes: [plan?.writes.length, run?.writes.length], skipped: plan?.skipped.map(skip => skip.reason) });
        return null;
    }
    const detail = (await call('GET', `/JellyfinMod/Entries/${entryId}`)).json;
    const seriesId = detail?.entry?.jellyfinItemId;
    record(label, 'the series entry has its Jellyfin series', !!seriesId, detail?.entry?.state);
    if (!seriesId) return null;

    const plan = (await call('GET', `/JellyfinMod/Placeholders/${libraryId}/Plan`)).json;
    const stubsBefore = (await episodesOf(call, userId, seriesId)).filter(item => item.IsPlaceHolder).length;
    record(label, 'the dry run lists .disc paths in Season folders and changes nothing',
        !!plan?.dryRun && plan.writes.every(write => /\/Season \d+\/[^/]+ S\d\dE\d\d\.disc$/.test(write.path))
            && (await episodesOf(call, userId, seriesId)).filter(item => item.IsPlaceHolder).length === stubsBefore,
        { writes: plan?.writes.length, removals: plan?.removals.length, skipped: plan?.skipped.length, existing: plan?.existing, sample: plan?.writes[0]?.path });
    // Turned off by an administrator, a library gets nothing: a sync writes none of what the dry run lists.
    if (plan?.writes.length) {
        await call('PUT', `/JellyfinMod/Placeholders/${libraryId}`, { enabled: false });
        const off = (await call('POST', `/JellyfinMod/Placeholders/${libraryId}/Sync`)).json;
        record(label, 'a library turned off gets nothing', !!off && !off.enabled && off.writes.length === 0, { writes: off?.writes.length });
        await call('PUT', `/JellyfinMod/Placeholders/${libraryId}`, { enabled: true }).then(answer => {
            record(label, 'turning it back on syncs at once, a few series per run', !!answer.json && answer.json.enabled
                && answer.json.writes.length + (answer.json.pending ?? 0) === plan.writes.length && !(answer.json.failures ?? []).length,
            { written: answer.json?.writes.length, pending: answer.json?.pending });
        });
    }
    // On by default, a library is filled by the plugin's own runs; the runner asks for them rather than waiting 15 minutes.
    for (let round = 0; round < 50; round++) {
        const next = (await call('GET', `/JellyfinMod/Placeholders/${libraryId}/Plan`)).json;
        if (!next?.writes.length) break;
        await call('POST', `/JellyfinMod/Placeholders/${libraryId}/Sync`);
    }
    // Jellyfin adds them as it scans the folders the plugin reported.
    const wanted = detail.episodes.filter(episode => episode.availability === 'missing' && episode.seasonNumber > 0).length;
    let items = [];
    for (let waited = 0; waited < 300; waited += 5) {
        items = await episodesOf(call, userId, seriesId);
        const fresh = (await call('GET', `/JellyfinMod/Entries/${entryId}`)).json;
        const named = fresh?.episodes.filter(episode => episode.placeholderItemId).length ?? 0;
        if (named >= wanted - (plan?.skipped ?? []).reduce((sum, skip) => sum + skip.episodes, 0) && named > 0) break;
        await sleep(5000);
    }
    const fresh = (await call('GET', `/JellyfinMod/Entries/${entryId}`)).json;
    const named = new Map(fresh.episodes.filter(episode => episode.placeholderItemId).map(episode => [norm(episode.placeholderItemId), episode]));
    const stubs = items.filter(item => named.has(norm(item.Id)));
    record(label, 'Jellyfin holds a placeholder item for each episode the plugin writes one for', stubs.length > 0 && stubs.length === named.size,
        { stubs: stubs.length, named: named.size });
    const second = (await call('GET', `/JellyfinMod/Placeholders/${libraryId}/Plan`)).json;
    record(label, 'a second dry run writes nothing more', second?.writes.length === 0, { writes: second?.writes.length, existing: second?.existing });
    const bad = stubs.filter(item => !(item.IsPlaceHolder && item.Overview && item.CanDownload === false && item.RunTimeTicks > 0
        && item.PremiereDate && Math.abs(new Date(item.DateCreated) - new Date(item.PremiereDate)) < 36 * 3600 * 1000));
    record(label, 'each placeholder: IsPlaceHolder, TMDB overview, a runtime, date added on its air date, CanDownload false', bad.length === 0,
        bad.slice(0, 3).map(item => ({ s: item.ParentIndexNumber, e: item.IndexNumber, created: item.DateCreated, aired: item.PremiereDate, rt: item.RunTimeTicks, dl: item.CanDownload })));
    record(label, 'the plugin keeps every placeholder episode missing, never on disk',
        [...named.values()].every(episode => episode.availability === 'missing' && episode.state !== 'onDisk' && !episode.jellyfinItemId));

    // The first placeholder after a real episode, for Next Up and the playback checks.
    const ordered = items.filter(item => item.ParentIndexNumber > 0).sort((a, b) => a.ParentIndexNumber - b.ParentIndexNumber || a.IndexNumber - b.IndexNumber);
    const stubIndex = ordered.findIndex(item => named.has(norm(item.Id)));
    const stub = ordered[stubIndex];
    const real = ordered.find(item => !item.IsPlaceHolder);
    if (!stub || !real) {
        record(label, 'a placeholder and a real episode to check playback with', false, { stub: !!stub, real: !!real });
        return { seriesId, stub, real, wasEnabled, named };
    }
    const before = ordered.slice(0, stubIndex).filter(item => !item.UserData?.Played);
    for (const item of before) await call('POST', `/UserPlayedItems/${item.Id}?userId=${userId}`);
    const nextUp = (await call('GET', `/Shows/NextUp?userId=${userId}&seriesId=${seriesId}`)).json;
    record(label, `Next Up leaves out S${stub.ParentIndexNumber}E${stub.IndexNumber} (its placeholder is next)`,
        !!nextUp && !nextUp.Items.some(item => item.IsPlaceHolder || norm(item.Id) === norm(stub.Id)) && nextUp.TotalRecordCount === nextUp.Items.length,
        { total: nextUp?.TotalRecordCount, items: nextUp?.Items.map(item => [item.ParentIndexNumber, item.IndexNumber]) });
    const allNextUp = (await call('GET', `/Shows/NextUp?userId=${userId}&limit=50`)).json;
    record(label, 'Next Up for all series lists none of the plugin\'s placeholders', !!allNextUp && !allNextUp.Items.some(item => named.has(norm(item.Id))));
    const latest = (await call('GET', `/Users/${userId}/Items/Latest?limit=50&includeItemTypes=Episode&groupItems=false&parentId=${libraryId}`)).json;
    // A user's own .disc stub (no marker) is Jellyfin's to list; only the plugin's placeholders are left out.
    record(label, 'Latest lists none of the plugin\'s placeholders', Array.isArray(latest) && !latest.some(item => named.has(norm(item.Id))),
        { latest: latest?.map(item => [item.ParentIndexNumber, item.IndexNumber, item.IsPlaceHolder ?? false]) });

    const getInfo = await call('GET', `/Items/${stub.Id}/PlaybackInfo?userId=${userId}`);
    const postInfo = await call('POST', `/Items/${stub.Id}/PlaybackInfo?userId=${userId}`, { DeviceProfile: {} });
    record(label, 'PlaybackInfo for the placeholder: NotAllowed, no media source (GET and POST)',
        [getInfo, postInfo].every(answer => answer.status === 200 && answer.json?.ErrorCode === 'NotAllowed' && answer.json?.MediaSources?.length === 0),
        [getInfo.status, getInfo.json?.ErrorCode, postInfo.status, postInfo.json?.ErrorCode]);
    const realInfo = await call('POST', `/Items/${real.Id}/PlaybackInfo?userId=${userId}`, {});
    record(label, 'PlaybackInfo for a real episode is untouched', realInfo.status === 200 && !realInfo.json?.ErrorCode && realInfo.json?.MediaSources?.length > 0);
    const blocked = {
        download: (await call('GET', `/Items/${stub.Id}/Download`)).status,
        stream: (await call('GET', `/Videos/${stub.Id}/stream?static=true`)).status,
        master: (await call('GET', `/Videos/${stub.Id}/master.m3u8?mediaSourceId=${stub.Id}`)).status
    };
    record(label, 'Download, stream and HLS of the placeholder answer 404', Object.values(blocked).every(status => status === 404), blocked);
    const realDownload = (await call('GET', `/Items/${real.Id}/Download`, undefined, { Range: 'bytes=0-0' })).status;
    record(label, 'Download of a real episode is untouched', realDownload === 200 || realDownload === 206, realDownload);
    const reports = [
        (await call('POST', '/Sessions/Playing', { ItemId: stub.Id, CanSeek: false })).status,
        (await call('POST', '/Sessions/Playing/Progress', { ItemId: stub.Id, PositionTicks: 0 })).status,
        (await call('POST', '/Sessions/Playing/Stopped', { ItemId: stub.Id })).status,
        (await call('POST', `/PlayingItems/${stub.Id}`)).status,
        (await call('DELETE', `/PlayingItems/${stub.Id}`)).status
    ];
    const afterReports = (await call('GET', `/UserItems/${stub.Id}/UserData?userId=${userId}`)).json;
    record(label, 'playback reports on the placeholder are dropped and leave it unplayed',
        reports.every(status => status === 204) && afterReports?.Played === false, { reports, played: afterReports?.Played });
    const marked = [(await call('POST', `/UserPlayedItems/${stub.Id}?userId=${userId}`)).status,
        (await call('POST', `/UserFavoriteItems/${stub.Id}?userId=${userId}`)).status];
    const afterMarks = (await call('GET', `/UserItems/${stub.Id}/UserData?userId=${userId}`)).json;
    record(label, 'marking the placeholder played and favourite by hand works', marked.every(status => status === 200)
        && afterMarks?.Played === true && afterMarks?.IsFavorite === true, { marked, played: afterMarks?.Played, favourite: afterMarks?.IsFavorite });
    await call('DELETE', `/UserPlayedItems/${stub.Id}?userId=${userId}`);
    await call('DELETE', `/UserFavoriteItems/${stub.Id}?userId=${userId}`);
    for (const item of before) await call('DELETE', `/UserPlayedItems/${item.Id}?userId=${userId}`);
    const undone = (await call('GET', `/UserItems/${stub.Id}/UserData?userId=${userId}`)).json;
    record(label, 'the marks this run set are undone', undone?.Played === false && undone?.IsFavorite === false);

    if (ordinary) {
        const answer = await ordinary.call('GET', `/Items/${stub.Id}/PlaybackInfo?userId=${ordinary.userId}`);
        const plugin = await ordinary.call('GET', '/JellyfinMod/Placeholders');
        record('api, ordinary user', 'PlaybackInfo NotAllowed for an ordinary user too; the placeholder settings are administrators only',
            answer.json?.ErrorCode === 'NotAllowed' && plugin.status === 403, { info: answer.json?.ErrorCode, settings: plugin.status });
    } else {
        record('api, ordinary user', 'ordinary user checks', 'NOT VERIFIED', 'JELLYFINMOD_MAM_USER not given');
    }
    return { seriesId, stub, real, wasEnabled, named };
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

const visible = 'node => !!node && getComputedStyle(node).display !== \'none\' && getComputedStyle(node).visibility !== \'hidden\' && node.getClientRects().length > 0';

async function browserChecks(browser, layout, user, isAdmin, context, api) {
    const label = `${layout}, ${user}`;
    const options = LAYOUTS[layout];
    const browserContext = await browser.newContext({ ...options, tv: undefined });
    const page = await browserContext.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error.message ?? error).split('\n')[0]));
    try {
        await signIn(page, user);
        if (options.tv) {
            await page.evaluate(() => localStorage.setItem('layout', 'tv'));
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => !!window.ApiClient, undefined, { timeout: 30000 });
        }
        await page.evaluate(`window.isShown = ${visible}`);
        const { stub, seriesId, real } = context;

        // The stub's row on its season page.
        await go(page, `#/details?id=${stub.SeasonId}`);
        const rowSelector = `.page:not(.hide) #listChildrenCollapsible .listItem[data-id="${stub.Id}"]`;
        await page.waitForSelector(`${rowSelector}[data-jfmod-placeholder] .jfmod-mark--none`, { timeout: 30000 }).catch(() => {});
        await page.evaluate(`window.isShown = ${visible}`);
        // Upstream's own row buttons differ by layout (the phone and the TV draw fewer): the placeholder's row has the ones a
        // real episode's row has.
        const buttonsOf = selector => page.evaluate(target => {
            const node = document.querySelector(target);
            return node ? [...node.querySelectorAll('button')].filter(window.isShown)
                .map(button => button.getAttribute('is') ?? button.getAttribute('data-action') ?? '').filter(name => name && name !== 'paper-icon-button-light').sort() : null;
        }, selector);
        const realButtons = await buttonsOf(`.page:not(.hide) #listChildrenCollapsible .listItem[data-id="${real.Id}"]`);
        const stubButtons = await buttonsOf(rowSelector);
        const row = await page.evaluate(selector => {
            const node = document.querySelector(selector);
            if (!node) return null;
            const mark = node.querySelector('.jfmod-mark--none');
            return {
                placeholder: node.hasAttribute('data-jfmod-placeholder'),
                mark: !!mark && window.isShown(mark), button: mark?.tagName === 'BUTTON', label: mark?.getAttribute('aria-label'),
                play: [...node.querySelectorAll('.listItemImageButton')].some(window.isShown),
                endsAt: [...node.querySelectorAll('.endsAt')].some(window.isShown)
            };
        }, rowSelector);
        const sameButtons = !!realButtons && !!stubButtons && realButtons.every(name => stubButtons.includes(name));
        record(label, `S${stub.ParentIndexNumber}E${stub.IndexNumber}'s row: a placeholder, the Not Downloaded mark${isAdmin ? ' (a Get a Release button)' : ' (an indicator)'}, no Play, no "Ends at", upstream's row buttons as on a real episode's row`,
            !!row && row.placeholder && row.mark && row.button === isAdmin && !row.play && !row.endsAt && sameButtons, { ...row, realButtons, stubButtons });
        await page.locator(rowSelector).first().scrollIntoViewIfNeeded().catch(() => {});
        await page.screenshot({ path: `${SHOTS}/mam-${layout}-${user}-season-row.png` });
        if (stubButtons?.includes('emby-ratingbutton')) {
            await page.locator(`${rowSelector} button[is="emby-ratingbutton"]`).first().click().catch(() => {});
            await page.waitForTimeout(1500);
            const liked = (await api.call('GET', `/UserItems/${stub.Id}/UserData?userId=${api.userId}`)).json?.IsFavorite;
            await page.locator(`${rowSelector} button[is="emby-ratingbutton"]`).first().click().catch(() => {});
            await page.waitForTimeout(1500);
            const unliked = (await api.call('GET', `/UserItems/${stub.Id}/UserData?userId=${api.userId}`)).json?.IsFavorite;
            if (unliked) await api.call('DELETE', `/UserFavoriteItems/${stub.Id}?userId=${api.userId}`);
            record(label, '♥ on the placeholder row sets and clears its favourite', liked === true && unliked === false, { liked, unliked });
        }

        // A season card whose episodes are all placeholders, on the series page.
        const seasons = (await api.call('GET', `/Shows/${seriesId}/Seasons?userId=${api.userId}&fields=ChildCount`)).json?.Items ?? [];
        const episodes = await episodesOf(api.call, api.userId, seriesId);
        const allStub = seasons.find(season => season.ChildCount > 0 && episodes.filter(item => item.SeasonId === season.Id).every(item => item.IsPlaceHolder));
        if (allStub) {
            await go(page, `#/details?id=${seriesId}`);
            const card = `.page:not(.hide) #listChildrenCollapsible .card[data-id="${allStub.Id}"]`;
            await page.waitForSelector(card, { timeout: 30000 }).catch(() => {});
            await page.waitForTimeout(1500);
            if (layout === 'desktop') await page.locator(`${card} .cardImageContainer`).first().hover().catch(() => {});
            await page.waitForTimeout(600);
            await page.evaluate(`window.isShown = ${visible}`);
            const look = await page.evaluate(selector => {
                const node = document.querySelector(selector);
                if (!node) return null;
                return {
                    noFile: node.hasAttribute('data-jfmod-nofile') || node.hasAttribute('data-jfmod-empty'),
                    mark: !!node.querySelector('.jfmod-mark--none'),
                    play: [...node.querySelectorAll('.cardOverlayButton[data-action="play"], .cardOverlayButton[data-action="resume"]')].some(window.isShown),
                    centre: [...node.querySelectorAll('.jfmod-cardGet.cardOverlayFab-primary')].some(window.isShown)
                };
            }, card);
            record(label, `${allStub.Name} (only placeholders): Not Downloaded, no Play${layout === 'desktop' && isAdmin ? ', Get a Release in the centre on hover' : ''}`,
                !!look && look.noFile && look.mark && !look.play && (layout !== 'desktop' || look.centre === isAdmin), look);
            await page.screenshot({ path: `${SHOTS}/mam-${layout}-${user}-season-card.png` });
        } else {
            record(label, 'a season card with only placeholders', 'NOT VERIFIED', 'no season of this series holds only placeholders');
        }

        // The stub's own page.
        await go(page, `#/details?id=${stub.Id}`);
        await page.waitForSelector('.page:not(.hide) .mainDetailButtons', { timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(2500);
        await page.evaluate(`window.isShown = ${visible}`);
        const header = await page.evaluate(() => {
            const view = document.querySelector('.page:not(.hide)');
            const buttons = view?.querySelector('.mainDetailButtons');
            return {
                placeholder: !!view?.hasAttribute('data-jfmod-placeholder'),
                play: [...(buttons?.querySelectorAll('.btnPlay, .btnReplay') ?? [])].some(window.isShown),
                endsAt: [...(view?.querySelectorAll('.itemMiscInfo .endsAt') ?? [])].some(window.isShown),
                played: window.isShown(buttons?.querySelector('.btnPlaystate')),
                favourite: window.isShown(buttons?.querySelector('.btnUserRating')),
                getRelease: window.isShown(buttons?.querySelector('.jfmod-getRelease')),
                stubCards: view?.querySelectorAll('.card[data-type="Episode"] [data-jfmod-stubmark]').length ?? 0,
                stubCardsPlay: [...(view?.querySelectorAll('.card[data-jfmod-empty] .cardOverlayButton[data-action="play"]') ?? [])].some(window.isShown)
            };
        });
        record(label, `the placeholder's page: no Play, no "Ends at", ✓ and ♥${isAdmin ? ', Get a Release' : ''}; its season's placeholder cards marked`,
            header.placeholder && !header.play && !header.endsAt && header.played && header.favourite && header.getRelease === isAdmin
                && header.stubCards > 0 && !header.stubCardsPlay, header);
        await page.screenshot({ path: `${SHOTS}/mam-${layout}-${user}-episode-page.png` });
        record(label, 'no page errors', errors.length === 0, errors);
    } catch (error) {
        record(label, 'the run completed', false, String(error?.message ?? error).split('\n')[0]);
    } finally {
        await browserContext.close();
    }
}

async function removeChecks(admin, context) {
    const label = 'remove';
    const { call, userId } = admin;
    await call('PUT', `/JellyfinMod/Placeholders/${libraryId}`, { enabled: false });
    const plan = (await call('GET', `/JellyfinMod/Placeholders/${libraryId}/Removal`)).json;
    record(label, 'the removal dry run lists only .disc files', !!plan && plan.removals.length > 0 && plan.removals.every(removal => removal.path.endsWith('.disc')),
        { removals: plan?.removals.length });
    const done = (await call('POST', `/JellyfinMod/Placeholders/${libraryId}/Remove`)).json;
    record(label, 'Remove Placeholders removes them all', !!done && done.removals.length === plan.removals.length && !(done.failures ?? []).length,
        { removed: done?.removals.length, failures: done?.failures });
    let left = -1;
    for (let waited = 0; waited < 300; waited += 5) {
        left = (await episodesOf(call, userId, context.seriesId)).filter(item => context.named.has(norm(item.Id))).length;
        if (left === 0) break;
        await sleep(5000);
    }
    record(label, 'Jellyfin drops the placeholder items', left === 0, { left });
    if (context.wasEnabled) await call('PUT', `/JellyfinMod/Placeholders/${libraryId}`, { enabled: true });
}

const admin = await signInApi('oleksii');
const ordinary = ordinaryUser ? await signInApi(ordinaryUser) : null;
const context = await apiChecks(admin, ordinary);
if (context?.stub) {
    const browser = await chromium.launch(tier === 'chrome' ? { headless: true, channel: 'chrome' } : { headless: true });
    try {
        for (const layout of layouts) {
            await browserChecks(browser, layout, 'oleksii', true, context, admin);
            if (ordinaryUser) await browserChecks(browser, layout, ordinaryUser, false, context, ordinary);
        }
    } finally {
        await browser.close();
    }
}
if (context && removeAtEnd) await removeChecks(admin, context);
else record('remove', 'Remove Placeholders', 'NOT VERIFIED', 'JELLYFINMOD_MAM_REMOVE not set; the placeholders stay');
const failed = results.filter(result => result.verdict === 'FAIL').length;
console.log(`${results.length} checks, ${failed} failed (${tier})`);
process.exitCode = failed ? 1 : 0;
/* eslint-enable compat/compat, no-restricted-globals, @stylistic/max-statements-per-line, no-empty-function, sonarjs/cognitive-complexity */
