/* eslint-disable compat/compat, no-restricted-globals, @stylistic/max-statements-per-line -- a Node acceptance runner, not shipped code */
/* global document, location, ApiClient, localStorage */
// Replace from the picker, to the end, on a local pool environment with the stand-in client, as oleksii with an empty password: a movie's
// row's Replace (mouse on a computer, D-pad on the TV) holds, sends with mode replace and reads as replacing; while it downloads the old
// file stays and plays; once the client completes it, the new file is imported, the old one is gone from disk, Jellyfin's item has only
// the new one, played state and favourite are kept, and the history says so. Removes what it replaced for real.
//
//   JELLYFINMOD_TEST_URL=http://127.0.0.1:<pool port>/  JELLYFINMOD_T7_ITEM=<movie item id with one file, the "Inception" of the stand-in's feed>
//   JELLYFINMOD_T7_RELEASE=<raw title published on the feed>  JELLYFINMOD_T7_CONTROL=http://127.0.0.1:<stand-ins' control port>
//   JELLYFINMOD_T7_MEDIA=<host folder of /test-media>  [JELLYFINMOD_T7_PROFILE=<the picker's profile to search under>]  [JELLYFINMOD_LIVE_LAYOUT=desktop|tv1080]  [JELLYFINMOD_LIVE_SHOTS=<folder>]  [JELLYFINMOD_BROWSER=chromium|chrome]
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const required = name => process.env[name] ?? (() => { throw new Error(name + ' is required'); })();
const origin = new URL(required('JELLYFINMOD_TEST_URL'));
if (origin.hostname !== '127.0.0.1' || !['9096', '10096', '11096', '12096'].includes(origin.port)) throw new Error('Runs on 127.0.0.1 at the local pool only');
const ITEM = required('JELLYFINMOD_T7_ITEM');
const RELEASE = required('JELLYFINMOD_T7_RELEASE');
const CONTROL = required('JELLYFINMOD_T7_CONTROL');
const MEDIA = required('JELLYFINMOD_T7_MEDIA');
const layout = process.env.JELLYFINMOD_LIVE_LAYOUT ?? 'desktop';
const tv = layout.startsWith('tv');
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
let failures = 0;
const record = (check, ok, detail) => {
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'} [${tier}/${layout}] ${check}${detail === undefined ? '' : ' :: ' + JSON.stringify(detail).slice(0, 400)}`);
};
const browser = await chromium.launch(tier === 'chrome' ? { channel: 'chrome' } : {});
const context = await browser.newContext({ viewport: tv ? { width: 1920, height: 1080 } : { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(String(error.message).split('\n')[0]));
const grabs = [];
page.on('request', request => { if (request.method() === 'POST' && /\/JellyfinMod\/Releases\/Grab$/.test(new URL(request.url()).pathname)) grabs.push(request.postDataJSON()); });
const signedIn = () => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } };
await page.goto(new URL('/web/', origin).href, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId() || /login|selectuser|selectserver/.test(location.hash); } catch { return false; } }, undefined, { timeout: 30000 });
if (!await page.evaluate(signedIn)) {
    const field = page.locator('#txtManualName');
    await Promise.race([field.waitFor({ state: 'visible', timeout: 15000 }), page.locator('.btnManual').first().waitFor({ state: 'attached', timeout: 15000 })]);
    if (!await field.isVisible().catch(() => false)) await page.locator('.btnManual').first().evaluate(node => node.click());
    await field.waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(800);
    await field.fill('oleksii');
    await page.locator('button:visible').filter({ hasText: 'Sign In' }).first().click();
    await page.waitForFunction(signedIn, undefined, { timeout: 30000 });
}
if (tv) {
    await page.evaluate(() => localStorage.setItem('layout', 'tv'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(signedIn, undefined, { timeout: 30000 });
}
await page.waitForTimeout(1500);
const api = (method, path, body) => page.evaluate(async ([m, p, b]) => {
    const response = await fetch(ApiClient.getUrl(p), { method: m, headers: { Authorization: `MediaBrowser Token="${ApiClient.accessToken()}"`, ...(b === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: b === undefined ? undefined : JSON.stringify(b) });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
}, [method, path, body]);
const userId = await page.evaluate(() => ApiClient.getCurrentUserId());
const readItem = id => api('GET', `Items/${id}?userId=${userId}&fields=MediaSources,Path`);
const hostPath = path => join(MEDIA, path.replace(/^\/test-media\/?/, ''));
const shot = name => page.screenshot({ path: `${process.env.JELLYFINMOD_LIVE_SHOTS ?? '.'}/replace-${tier}-${layout}-${name}.png` }).catch(() => undefined);
try {
    const before = (await readItem(ITEM)).body;
    const oldPaths = before.MediaSources.map(source => source.Path);
    record('the title starts with its files on disk', oldPaths.length > 0 && oldPaths.every(path => existsSync(hostPath(path))), oldPaths);
    const entryId = (await api('GET', `JellyfinMod/Entries?jellyfinItemId=${ITEM}&limit=1`)).body.items[0].id;
    const historyBefore = (await api('GET', `JellyfinMod/Entries/${entryId}`)).body.history.map(event => event.id);
    await page.evaluate(id => { location.hash = '#/details?id=' + id; }, ITEM);
    const opener = page.locator('.page:not(.hide) .jfmod-dsTitleHost .actbar [data-ds-command~=jfmod-getRelease]').first();
    await opener.waitFor({ state: 'visible', timeout: 30000 });
    if (tv) { await opener.focus(); await page.keyboard.press('Enter'); } else await opener.click();
    await page.waitForFunction(() => !/Searching/.test(document.querySelector('.pstatus')?.textContent ?? 'Searching'), undefined, { timeout: 120000 });
    // A title with a file opens on its phones' copy (Add); the release at the held resolution is under the title's own profile.
    const profile = process.env.JELLYFINMOD_T7_PROFILE;
    if (profile) {
        await page.locator('#jfmod-releaseProfile').click();
        const options = page.locator('[aria-label="Quality Profile"][role="menu"] [role="option"]');
        await options.first().waitFor({ state: 'visible', timeout: 10000 });
        await options.filter({ hasText: new RegExp('^' + profile) }).first().click();
    }
    await page.waitForSelector('.pickerDialog .rels .rel', { timeout: 120000 });
    await page.waitForFunction(raw => [...document.querySelectorAll('.pickerDialog .rel')].some(node => node.dataset.dsReleaseTitle === raw), RELEASE, { timeout: 60000 });
    const row = page.locator(`.pickerDialog .rel[data-ds-release-title="${RELEASE}"]`);
    const replace = row.locator('[data-jfmod-release-replace]');
    record('the row offers Replace, its title naming the file', await replace.getAttribute('title') === 'Replace File', await replace.getAttribute('title'));
    const press = async target => { if (tv) { await target.focus(); await page.keyboard.press('Enter'); } else await target.click(); };
    await press(replace);
    // It asks first, and backing out sends nothing.
    const dialog = page.locator('[data-ds-dialog]:not(.pickerDialog)').last();
    await dialog.waitFor({ state: 'visible', timeout: 10000 });
    const asked = (await dialog.innerText()).replace(/\s+/g, ' ');
    record('it asks first, saying the current file goes once the new one is in the library', /Replace File/.test(asked) && /removed once the new one is in the library/.test(asked) && asked.includes(RELEASE), asked);
    const destructive = dialog.locator('button', { hasText: /^Replace File$/ });
    await shot('ask');
    await press(dialog.locator('button', { hasText: /^Cancel$/ }));
    await dialog.waitFor({ state: 'hidden', timeout: 10000 });
    await page.waitForTimeout(800);
    record('Cancel sends nothing', grabs.length === 0, grabs);
    await press(replace);
    await dialog.waitFor({ state: 'visible', timeout: 10000 });
    await press(destructive);
    const x = row.locator('[data-jfmod-release-x]');
    await page.waitForFunction(() => /Replacing the current file\. Sending to the download client/.test(document.querySelector('.grab')?.textContent ?? ''), undefined, { timeout: 10000 });
    record('the press holds, as Replace', grabs.length === 1 && grabs[0].mode === 'replace', grabs.map(grab => grab.mode));
    await page.waitForFunction(() => /In the download queue\. The current file is removed once this one is in the library\./.test(document.querySelector('.picker')?.textContent ?? ''), undefined, { timeout: 30000 });
    await shot('accepted');
    record('the row stays as added, with its X', await x.count() === 1);
    const state = await (await fetch(CONTROL + '/state')).json();
    const torrent = state.torrents.find(candidate => candidate.name.includes(RELEASE));
    record('the client has it', !!torrent, torrent?.name);
    await fetch(`${CONTROL}/progress?hash=${torrent.hashString}&fraction=0.5`);
    await page.waitForTimeout(16000);
    const halfway = (await readItem(ITEM)).body;
    record('while it downloads the old files stay on disk and in the item', oldPaths.every(path => existsSync(hostPath(path))) && halfway.MediaSources.every(source => oldPaths.includes(source.Path)), halfway.MediaSources.map(source => source.Path));
    await fetch(`${CONTROL}/complete?hash=${torrent.hashString}`);
    // The item may change id when its only file does: read through the entry from here on.
    let after = null;
    for (let attempt = 0; attempt < 60; attempt++) {
        await page.waitForTimeout(3000);
        const answer = await api('GET', `JellyfinMod/Entries/${entryId}`);
        if (answer.status !== 200) continue;
        const detail = answer.body;
        const itemId = detail.versions?.[0]?.jellyfinItemId ?? detail.entry.jellyfinItemId;
        const read = itemId ? (await readItem(itemId)).body : null;
        const paths = read?.MediaSources?.map(source => source.Path) ?? [];
        if (paths.length > 0 && !paths.some(path => oldPaths.includes(path)) && oldPaths.every(path => !existsSync(hostPath(path)))) { after = { detail, read, paths }; break; }
    }
    record('after the import the old files are gone from disk and the item has only the new file', !!after && after.paths.length === 1 && after.paths.every(path => existsSync(hostPath(path))), after?.paths ?? oldPaths.map(path => [path, existsSync(hostPath(path))]));
    if (after) {
        const kept = ['Played', 'IsFavorite', 'PlayCount', 'LastPlayedDate'];
        // Jellyfin re-attaches the old item's user data by key after the new item's first refresh, so this waits for it, to a limit.
        const shape = data => Object.fromEntries(kept.map(field => [field, data[field]]));
        const trail = [];
        let data = after.read.UserData;
        const same = () => kept.every(field => data[field] === before.UserData[field]);
        for (let attempt = 0; attempt < 30 && !same(); attempt++) {
            trail.push(shape(data));
            await page.waitForTimeout(3000);
            data = (await readItem(after.read.Id)).body?.UserData ?? data;
        }
        record('played state, favourite, play count and play date are kept', same(), { before: shape(before.UserData), after: shape(data), waited: trail.length * 3 });
        const added = after.detail.history.filter(event => !historyBefore.includes(event.id)).map(event => event.eventType);
        record('the history says what happened', added.includes('imported') && added.some(type => /replaced|removed/.test(type)), added);
        await page.evaluate(id => { location.hash = '#/home'; location.hash = '#/details?id=' + id; }, after.read.Id);
        await page.waitForSelector('.page:not(.hide) .jfmod-dsTitleHost .itemName', { timeout: 30000 });
        await page.waitForTimeout(1500);
        record('the page draws the new file\'s title with Play and no error', await page.locator('.page:not(.hide) .jfmod-dsTitleHost .actbar button', { hasText: /^(Play|Resume)/ }).count() > 0);
        await shot('done');
    }
    record('no page errors', errors.length === 0, errors.slice(0, 3));
} finally {
    await browser.close();
}
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
/* eslint-enable compat/compat, no-restricted-globals, @stylistic/max-statements-per-line */
