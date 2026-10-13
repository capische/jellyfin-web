/* eslint-disable no-restricted-globals, sonarjs/no-clear-text-protocols -- a Node acceptance runner, not shipped code */
/* global document, getComputedStyle */
// Release picker: the indexer name as the release page link and Open Transmission, before and after a row is added (UX §9.1,
// approved 2026-10-12), in a real browser against a local environment, signed in as oleksii with an empty password.
//
// INTERCEPTED ANSWERS, NOT A LIVE GRAB: the search (the picker-compare fixture with a page link on every row but one, the
// episode searched for a plain add, so each row has Add alone), the grab and its state (held 3 s, then accepted), the queue's
// row for it (42 %, 12 min left) and the acquisition settings' download client are answered by this runner. Nothing is grabbed
// and nothing on the server changes. What it checks:
//   - before a grab, every row whose candidate has a page link carries the link, over the name's own box, with the candidate's
//     own href, opening a new tab without the opener; the row without one shows the plain name and has no link;
//   - after Add, while held and once the client has it (tick or disc, X), the added row still has its link, still exactly over
//     the name (the row's two slots move the name left) and on top where it is drawn, so the pointer reaches it (2026-10-13:
//     on 28096 it stayed where the one-slot row had put it);
//   - Open Transmission between Show Names and Close for an administrator, with the client's own web link, opening a new tab;
//   - TV: no link on any row, the added row included, and no Open Transmission.
//
//   JELLYFINMOD_LIVE_URL=<local environment>  JELLYFINMOD_LIVE_FIXTURE_FILE=<any 0600 file; none of it is used here>
//   [JELLYFINMOD_LIVE_LAYOUT=desktop|mobile|tv1080]  [JELLYFINMOD_BROWSER=chromium|chrome]  [JELLYFINMOD_LIVE_SHOTS=<folder>]
//   [JELLYFINMOD_PICKER_ENTRY=<series entry id with an episode in Jellyfin; default: the local baseline's Peep Show>]
import { api, launch, newPage, notVerified, origin, record, results, saveResults, setTvLayout, signIn, tier, until } from './live-lib.mjs';
import { search } from './picker-compare-fixture.mjs';

if (!['127.0.0.1', 'localhost'].includes(origin.hostname)) throw new Error('Runs on a local environment only');
const layout = process.env.JELLYFINMOD_LIVE_LAYOUT ?? 'desktop';
const tv = layout.startsWith('tv');
const shots = process.env.JELLYFINMOD_LIVE_SHOTS ?? '.';
const entryId = process.env.JELLYFINMOD_PICKER_ENTRY ?? 'c01abd2729544572a95cafed3744429b';
const label = `added-row ${layout}`;
const WANTED = 'rel2';
const NO_LINK = 'rel3';
const pageOf = id => `https://indexer.invalid/torrent/${id}/`;
const CLIENT = { id: 'c0000000000000000000000000000001', name: 'Acceptance Transmission', baseUrl: 'http://transmission-acceptance:9091/transmission/rpc',
    openUrl: 'http://client.invalid:29091/transmission/web/' };

const browser = await launch();
const { context, page } = await newPage(browser, tv ? 'tv1080' : layout);
try {
    await signIn(page);
    if (tv) await setTvLayout(page);
    const detail = await api(page, 'GET', `JellyfinMod/Entries/${entryId}`);
    const episode = detail.body?.episodes?.find(item => item.jellyfinItemId);
    if (!episode) throw new Error('the entry has no episode in Jellyfin');
    const answer = () => {
        const found = search(episode.id);
        found.intent = 'acquire';
        found.target = { ...found.target, entryId, episodeId: episode.id };
        found.grab = { ...found.grab, modes: ['fill'] };
        found.candidates = found.candidates.map(candidate => ({ ...candidate, detailsUrl: candidate.releaseId === NO_LINK ? null : pageOf(candidate.releaseId) }));
        return found;
    };
    const wanted = answer().candidates.find(candidate => candidate.releaseId === WANTED);
    const opId = '33333333333333333333333333333333';
    let holdUntil = 0;
    const op = () => {
        const accepted = holdUntil > 0 && Date.now() >= holdUntil;
        const at = new Date().toISOString();
        return { id: opId, state: accepted ? 'accepted' : 'pending', active: true, cancellable: !accepted, entryId, episodeId: episode.id,
            releaseTitle: wanted.rawTitle, indexerName: wanted.indexerName, quality: 'webdl-1080p', size: wanted.size, infoHash: 'b'.repeat(40), score: wanted.score,
            seedRatio: null, seedMinutes: null, holdUntil: new Date(holdUntil).toISOString(), createdAt: at, updatedAt: at, submittedAt: accepted ? at : null,
            acceptedAt: accepted ? at : null, cancelledAt: null, failureCode: null, message: accepted ? 'The download client accepted the torrent.' : '', openUrl: null,
            scope: 'episode', seasonNumber: null, mode: 'fill' };
    };
    const queueRow = () => ({ id: '44444444444444444444444444444444', grabId: opId,
        entry: { id: entryId, mediaType: 'series', title: detail.body.entry?.title ?? null, year: null, posterPath: null, jellyfinItemId: null, targetLibraryId: null },
        episode: { id: episode.id, seasonNumber: episode.seasonNumber, episodeNumber: episode.episodeNumber, title: episode.title },
        releaseTitle: wanted.rawTitle, state: 'downloading', importState: 'downloading', reason: null, message: null, progress: 0.42, sizeBytes: wanted.size,
        downloadedBytes: null, downloadRateBytes: 3100000, etaSeconds: 720, stalledSince: null, observedAt: new Date().toISOString(), versionLabel: null,
        intent: 'acquire', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), client: { id: CLIENT.id, name: CLIENT.name, openUrl: null },
        seeding: null, pack: null });
    await page.route(/\/JellyfinMod\/Releases\?/, route => route.fulfill({ json: answer() }));
    await page.route(/\/JellyfinMod\/Releases\/Progress\//, route => route.fulfill({ status: 404, json: {} }));
    await page.route(/\/JellyfinMod\/Releases\/Grab$/, route => {
        holdUntil = Date.now() + 3000;
        return route.fulfill({ status: 202, json: op() });
    });
    await page.route(/\/JellyfinMod\/Grabs\//, route => route.fulfill({ json: op() }));
    await page.route(/\/JellyfinMod\/Queue(\?|$)/, route => route.fulfill({ json: { items: holdUntil && Date.now() >= holdUntil ? [queueRow()] : [], totalRecordCount: 0,
        generatedAt: new Date().toISOString(), clientStatus: 'ok', importEnabled: true, seedReleaseEnabled: false, automation: null } }));
    await page.route(/\/JellyfinMod\/Settings\/Acquisition$/, async route => {
        if (route.request().method() !== 'GET') return route.continue();
        const response = await route.fetch();
        return route.fulfill({ response, json: { ...await response.json(), downloadClientId: CLIENT.id } });
    });
    await page.route(/\/JellyfinMod\/Settings\/DownloadClients$/, route => (route.request().method() === 'GET' ? route.fulfill({ json: [CLIENT] }) : route.continue()));

    await page.evaluate(id => {
        location.hash = '#/details?id=' + id;
    }, episode.jellyfinItemId);
    const opener = page.locator('.page:not(.hide) .mainDetailButtons .jfmod-getRelease').first();
    await opener.waitFor({ state: 'visible', timeout: 30000 });
    if (tv) {
        await opener.focus();
        await page.keyboard.press('Enter');
    } else {
        await opener.click();
    }
    await page.waitForSelector('.jfmod-releaseDialog .jfmod-releaseList .jfmod-releaseItem', { timeout: 20000 });
    await page.waitForTimeout(800);

    // Every row: its link (href, new tab, over the name's box) or its plain name; the added row also whether the pointer reaches it.
    const rows = () => page.evaluate(() => [...document.querySelectorAll('.jfmod-releaseDialog .jfmod-releaseList .jfmod-releaseItem')].map(item => {
        const id = item.querySelector('[data-jfmod-release-row]')?.getAttribute('data-jfmod-release-row') ?? null;
        const added = item.classList.contains('jfmod-releaseItem--added');
        const name = item.querySelector('.jfmod-releaseCol--indexer');
        const link = item.querySelector(':scope > .jfmod-releaseIndexerLink');
        if (!link) return { id, added, link: null, nameShown: !!name && getComputedStyle(name).visibility === 'visible' };
        if (added) item.scrollIntoView({ block: 'center' });
        const a = link.getBoundingClientRect();
        const b = name.getBoundingClientRect();
        const hit = document.elementFromPoint(a.left + a.width / 2, a.top + a.height / 2);
        return { id, added, link: link.getAttribute('href'), last: item.lastElementChild === link, target: link.target, rel: link.rel, title: link.title,
            shown: getComputedStyle(link).visibility === 'visible', dx: Math.round(a.left - b.left), dy: Math.round(a.top - b.top),
            over: Math.abs(a.left - b.left) <= 1 && Math.abs(a.top - b.top) <= 1 && Math.abs(a.width - b.width) <= 1, reached: !!hit && link.contains(hit),
            text: link.textContent === name.textContent };
    }));
    const linkRight = (row, href) => row.link === href && row.last && row.target === '_blank' && /noopener/.test(row.rel) && /^Open on /.test(row.title)
        && row.shown && row.over && row.text;
    const shot = name => page.locator('.jfmod-releaseDialog').screenshot({ path: `${shots}/added-row-${tier}-${layout}-${name}.png` }).catch(() => undefined);

    const before = await rows();
    if (tv) {
        record(label, 'TV: no indexer name is a link, every name is shown plainly', before.every(row => !row.link && row.nameShown), before);
    } else {
        record(label, 'Before a grab: each row with a page link has the link over its name with that row\'s own href; the row without one shows the plain name',
            before.length > 0 && before.every(row => (row.id === NO_LINK ? !row.link && row.nameShown : linkRight(row, pageOf(row.id)))), before);
    }

    // Open Transmission: administrators only (oleksii is one), never on the TV.
    const client = await page.evaluate(() => {
        const link = document.querySelector('.jfmod-releaseDialog .jfmod-clientOpen');
        const header = [...document.querySelectorAll('.jfmod-releaseDialog .formDialogHeader > *')].map(node => node.className.split(' ').find(name =>
            /jfmod-(namesToggle|clientOpen|releaseDialogClose)$/.test(name)) ?? node.tagName);
        return { shown: !!link && !link.hidden && link.getBoundingClientRect().width > 0, href: link?.getAttribute('href') ?? null, title: link?.title ?? null,
            target: link?.target ?? null, header };
    });
    if (tv) {
        record(label, 'TV: no Open Transmission icon', !client.shown, client);
    } else {
        record(label, 'Open Transmission (administrator, the client has a web link): between Show Names and Close, the client\'s link, its name, a new tab',
            client.shown && client.href === CLIENT.openUrl && client.title === 'Open ' + CLIENT.name && client.target === '_blank'
                && client.header.indexOf('jfmod-clientOpen') === client.header.indexOf('jfmod-namesToggle') + 1
                && client.header.indexOf('jfmod-releaseDialogClose') === client.header.indexOf('jfmod-clientOpen') + 1, client);
    }

    // Add on the wanted row: a click, or Enter on its Add on the TV.
    const add = page.locator(`.jfmod-releaseDialog [data-jfmod-release-add="${WANTED}"]`);
    if (tv) {
        await add.focus();
        await page.keyboard.press('Enter');
    } else {
        await add.click();
        await page.mouse.move(2, 2);
    }
    const addedNow = async kind => {
        const list = await rows();
        const row = list.find(item => item.added);
        return row?.id === WANTED ? { row, kind } : null;
    };
    const held = await until(() => addedNow('held'), { timeout: 10000, every: 200, label: 'the added row' });
    await page.waitForTimeout(400);
    const heldRow = (await rows()).find(item => item.added);
    await shot('held');
    const accepted = await until(async () => (await page.locator('.jfmod-releaseDialog .jfmod-releaseItem--added .jfmod-addedFigure').count() ? addedNow('accepted') : null),
        { timeout: 20000, every: 300, label: 'the accepted added row with its download figure' });
    await page.waitForTimeout(400);
    const acceptedRow = (await rows()).find(item => item.added);
    await shot('accepted');
    if (tv) {
        record(label, 'TV: the added row has no link either, while held and once the client has it', !!held && !heldRow.link && !acceptedRow.link && acceptedRow.nameShown,
            { heldRow, acceptedRow });
    } else {
        record(label, 'Held: the added row keeps its link, exactly over its name (moved by the X slot), reached by the pointer',
            !!held && linkRight(heldRow, pageOf(WANTED)) && heldRow.reached, heldRow);
        record(label, 'Accepted (disc and X, the download figure): the added row keeps its link, exactly over its name, reached by the pointer',
            !!accepted && linkRight(acceptedRow, pageOf(WANTED)) && acceptedRow.reached, acceptedRow);
    }
    record(label, 'No page errors', page.jfmodErrors.length === 0, page.jfmodErrors.slice(0, 3));
} catch (error) {
    notVerified(label, 'the added row\'s link', error);
    await page.screenshot({ path: `${shots}/added-row-${tier}-${layout}-error.png` }).catch(() => undefined);
}
if (results.some(result => result.verdict !== 'PASS')) process.exitCode = 1;
saveResults(label, browser.version());
await context.close();
await browser.close();
/* eslint-enable no-restricted-globals, sonarjs/no-clear-text-protocols */
