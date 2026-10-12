/* eslint-disable compat/compat, no-restricted-globals, sonarjs/cognitive-complexity -- a Node acceptance runner, not shipped code */
/* global document, getComputedStyle */
// Live acceptance (P4 A8, P5 I3-I9): drives the built release picker against the live instance.
//
//   JELLYFINMOD_LIVE_STEP=grab    opens the entry (or episode), searches, records eligible and rejected rows, focuses the
//                                 row whose raw title contains JELLYFINMOD_LIVE_ROW and presses Enter once; waits for
//                                 the hold and the accepted handoff
//   JELLYFINMOD_LIVE_STEP=cancel  the same, but presses Enter on the row's red X during the hold and waits for `cancelled`
//   (2026-10-12: the grabbed row is the added row, tick or falling arrow in Add and an X in Replace; the block has no Cancel)
//   JELLYFINMOD_LIVE_ENTRY        entry id;  JELLYFINMOD_LIVE_EPISODE  optional episode id (series), searched from its row
//   JELLYFINMOD_LIVE_LAYOUT       desktop | mobile | tv1080 | tv720 (TV is driven by keys only)
import { api, launch, newPage, notVerified, record, saveResults, setTvLayout, signIn, tier, until } from './live-lib.mjs';

const step = process.env.JELLYFINMOD_LIVE_STEP ?? 'grab';
const entryId = process.env.JELLYFINMOD_LIVE_ENTRY;
const episodeId = process.env.JELLYFINMOD_LIVE_EPISODE ?? '';
const wanted = process.env.JELLYFINMOD_LIVE_ROW ?? '';
const layout = process.env.JELLYFINMOD_LIVE_LAYOUT ?? 'desktop';
const tv = layout.startsWith('tv');
const label = `${step} ${layout}`;

const browser = await launch();
const { context, page } = await newPage(browser, layout);
const requests = [];
page.on('request', request => { if (/\/JellyfinMod\/(Releases|Grabs)/.test(request.url())) requests.push(request.method() + ' ' + new URL(request.url()).pathname); });
try {
    await signIn(page);
    if (tv) await setTvLayout(page);
    await page.evaluate(() => localStorage.removeItem('jfmod-releaseNames'));
    const detail = await api(page, 'GET', `JellyfinMod/Entries/${entryId}`);
    await page.evaluate(id => { location.hash = '#/details?entryId=' + encodeURIComponent(id); }, entryId);
    // A series picker offers seasons only (user, 2026-10-12): an episode is searched from its own row's Search Releases.
    const searchSelector = episodeId ? `button[data-episode-id="${episodeId}"][title="Search Releases"]` : null;
    const search = searchSelector ? page.locator(searchSelector) : page.locator('button', { hasText: 'Search releases' }).first();
    await search.waitFor({ state: 'visible', timeout: 30000 });
    if (tv) {
        // Reach the action by keys only: record what has focus on open, then arrow along until Search releases has it.
        await page.waitForTimeout(1500);
        const onOpen = await page.evaluate(() => document.activeElement === document.body ? 'body' : (document.activeElement?.textContent ?? '').trim().slice(0, 30));
        const isSearch = () => page.evaluate(selector => document.activeElement?.tagName === 'BUTTON' && (selector ?
            document.activeElement.matches(selector) : /Search releases/i.test(document.activeElement.textContent ?? '')), searchSelector);
        let reached = await isSearch();
        const path = [];
        for (let i = 0; i < 25 && !reached; i++) {
            await page.keyboard.press(i < 3 ? 'ArrowDown' : i < 15 ? 'ArrowRight' : 'ArrowLeft');
            path.push(await page.evaluate(() => (document.activeElement?.textContent ?? '').trim().slice(0, 20)));
            reached = await isSearch();
        }
        record(label, 'TV: the detail page focuses a control on open', onOpen !== 'body', onOpen);
        record(label, 'TV: Search releases is reachable by arrow keys', reached, path);
        if (!reached) await search.focus();
        await page.keyboard.press('Enter');
    } else {
        await search.click();
    }
    await page.waitForSelector('.jfmod-releasePicker', { timeout: 15000 });
    await page.waitForFunction(() => !/Searching/.test(document.querySelector('.jfmod-releaseStatus')?.textContent ?? 'Searching'), undefined, { timeout: 120000 });
    const status = (await page.locator('.jfmod-releaseStatus').innerText()).trim();
    const notice = await page.locator('.jfmod-releaseNotice').allInnerTexts();
    // textContent, not innerText: the file name shows only while Show Names is on, but it is always in the page.
    const rowTexts = locator => locator.evaluateAll(nodes => nodes.map(node => node.textContent));
    const eligible = (await rowTexts(page.locator('.jfmod-releaseList .jfmod-releaseRow'))).map(text => text.replace(/\s+/g, ' ').trim());
    const firstFocused = await page.evaluate(() => document.activeElement?.classList.contains('jfmod-releaseRow') ?? false);
    const toggle = page.locator('.jfmod-rejectedToggle');
    let rejected = [];
    if (await toggle.count()) {
        await toggle.click();
        rejected = (await rowTexts(page.locator('.jfmod-releaseRow--rejected'))).map(text => text.replace(/\s+/g, ' ').trim());
        await toggle.click();
    }
    record(label, 'The picker lists eligible rows (raw title present; shown while Show Names is on) and a collapsed rejected group with reasons', eligible.length > 0,
        { status, notice, eligible: eligible.slice(0, 12), rejected: rejected.slice(0, 12), eligibleCount: eligible.length, rejectedCount: rejected.length });
    record(label, 'Focus starts on the first eligible row', firstFocused);
    // The indexer name is the link to the release's page (2026-10-12): a sibling of the row's button, the item's last child (one
    // stop after Replace), laid over the name's own box, opening a new tab; plain text on the TV.
    const links = await page.evaluate(() => [...document.querySelectorAll('.jfmod-releaseList .jfmod-releaseItem')].map(item => {
        const link = item.querySelector(':scope > .jfmod-releaseIndexerLink');
        const name = item.querySelector('.jfmod-releaseCol--indexer');
        if (!link) return { link: false, nameShown: getComputedStyle(name).visibility === 'visible' };
        const a = link.getBoundingClientRect();
        const b = name.getBoundingClientRect();
        return { link: true, last: item.lastElementChild === link, target: link.target, rel: link.rel, title: link.title, href: /^https?:/.test(link.href),
            over: Math.abs(a.left - b.left) <= 1 && Math.abs(a.top - b.top) <= 1 && Math.abs(a.width - b.width) <= 1, text: link.textContent === name.textContent };
    }));
    const linked = links.filter(row => row.link);
    if (tv) {
        record(label, 'TV: no indexer name is a link', linked.length === 0 && links.every(row => row.nameShown), links.slice(0, 5));
    } else if (linked.length === 0) {
        notVerified(label, 'Indexer name links', 'no row of this search carries a page link');
    } else {
        record(label, 'Indexer names with a page link are links over the name, after the actions, opening a new tab without the opener',
            linked.every(row => row.last && row.target === '_blank' && /noopener/.test(row.rel) && /^Open on /.test(row.title) && row.href && row.over && row.text),
            linked.slice(0, 5));
    }
    // Open Transmission (2026-10-12): Show Names, then the client icon, then Close; administrators only, never on the TV.
    const client = await page.evaluate(() => {
        const link = document.querySelector('.jfmod-releaseDialog .jfmod-clientOpen');
        const header = [...document.querySelectorAll('.jfmod-releaseDialog .formDialogHeader > *')].map(node => node.className.split(' ').find(name =>
            /jfmod-(namesToggle|clientOpen|releaseDialogClose)$/.test(name)) ?? node.tagName);
        return { shown: !!link && !link.hidden && link.getBoundingClientRect().width > 0, title: link?.title ?? null, target: link?.target ?? null, header };
    });
    if (tv) {
        record(label, 'TV: no Open Transmission icon', !client.shown, client);
    } else if (!client.shown) {
        notVerified(label, 'Open Transmission icon', 'hidden: no selected download client with a web link, or not an administrator');
    } else {
        record(label, 'Open Transmission sits between Show Names and Close, named after the client, opening a new tab',
            /^Open /.test(client.title) && client.target === '_blank' && client.header.indexOf('jfmod-clientOpen') === client.header.indexOf('jfmod-namesToggle') + 1
                && client.header.indexOf('jfmod-releaseDialogClose') === client.header.indexOf('jfmod-clientOpen') + 1, client);
    }
    // Show Names (user, 2026-10-11, look T3): off by default; the glyph's state is aria-pressed and the label, not a colour.
    const namesToggle = page.locator('.jfmod-namesToggle');
    const namesState = () => page.evaluate(() => {
        const button = document.querySelector('.jfmod-namesToggle');
        const titles = [...document.querySelectorAll('.jfmod-releaseList .jfmod-releaseItem .jfmod-releaseTitle')];
        return { pressed: button?.getAttribute('aria-pressed'), label: button?.getAttribute('aria-label'), tooltip: button?.getAttribute('title'),
            rows: titles.length, shown: titles.filter(node => node.getBoundingClientRect().height > 0).length, stored: localStorage.getItem('jfmod-releaseNames') };
    });
    const before = await namesState();
    record(label, 'Show Names is off by default: aria-pressed false, label Show Names, no row shows a file name',
        before.pressed === 'false' && before.label === 'Show Names' && before.tooltip === 'Show Names' && before.rows > 0 && before.shown === 0, before);
    if (tv) {
        // One D-pad stop in the title row: arrow up from the first row until it has focus.
        await page.locator('.jfmod-releaseList .jfmod-releaseRow').first().focus();
        const path = [];
        let onToggle = false;
        for (let i = 0; i < 6 && !onToggle; i++) {
            await page.keyboard.press('ArrowUp');
            onToggle = await page.evaluate(() => document.activeElement?.classList.contains('jfmod-namesToggle') ?? false);
            path.push(await page.evaluate(() => (document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.className ?? '').slice(0, 30)));
        }
        record(label, 'TV: Show Names is reached by arrow keys', onToggle, path);
        if (!onToggle) await namesToggle.focus();
        await page.keyboard.press('Enter');
    } else {
        await namesToggle.click();
    }
    const on = await namesState();
    record(label, 'Show Names on: aria-pressed true, label Hide Names, every row shows its file name, the choice is stored',
        on.pressed === 'true' && on.label === 'Hide Names' && on.tooltip === 'Hide Names' && on.shown === on.rows && on.rows > 0 && on.stored === '1', on);
    if (tv) await page.keyboard.press('Enter'); else await namesToggle.click();
    const off = await namesState();
    record(label, 'Show Names off again: no file names, stored 0', off.pressed === 'false' && off.shown === 0 && off.stored === '0', off);
    if (tv) await page.keyboard.press('Enter'); else await namesToggle.click(); // on again: the reload check below needs it stored
    const order = eligible.map(text => Number(/score (-?\d+)/.exec(text)?.[1]));
    record(label, 'Eligible rows are ordered by descending score', order.every((score, index) => index === 0 || order[index - 1] >= score), order);

    if (step === 'grab' || step === 'cancel') {
        const rows = page.locator('.jfmod-releaseList .jfmod-releaseRow');
        const index = eligible.findIndex(text => text.includes(wanted));
        if (index < 0) throw new Error(`no eligible row contains the wanted raw title (${wanted})`);
        // Keys only: from the first row, ArrowDown to the wanted one, then a single Enter.
        await rows.first().focus();
        for (let i = 0; i < index; i++) await page.keyboard.press('ArrowDown');
        const focusedText = await page.evaluate(() => document.activeElement?.textContent ?? '');
        if (!focusedText.includes(wanted)) await rows.nth(index).focus();
        await page.keyboard.press('Enter');
        await page.keyboard.press('Enter'); // a second Enter while the grab is in flight must not grab twice
        const held = await until(async () => (await page.locator('.jfmod-grabStatus').allInnerTexts()).join(' ').match(/Sending to the download client in \d+ s/)?.[0],
            { timeout: 15000, every: 250, label: 'the hold' });
        const addedRow = () => page.evaluate(() => {
            const item = document.querySelector('.jfmod-releaseItem--added');
            return item && {
                x: item.querySelector('[data-jfmod-release-x]')?.getAttribute('title') ?? null,
                drop: !!item.querySelector('.jfmod-releaseAction--add.jfmod-releaseAction--working'),
                tick: !!item.querySelector('.jfmod-releaseAction--add.jfmod-releaseAction--done'),
                tickStop: item.querySelector('[data-jfmod-release-add]')?.getAttribute('tabindex') !== '-1',
                figure: item.querySelector('.jfmod-addedFigure')?.textContent ?? null,
                bar: !!item.querySelector('.jfmod-addedBar'),
                label: item.querySelector('.jfmod-releaseRow')?.getAttribute('aria-label') ?? '',
                blockButtons: document.querySelectorAll('.jfmod-grabStatus button').length
            };
        });
        const heldRow = await addedRow();
        record(label, 'One Enter starts a held grab: a countdown in the block (no Cancel button there), the falling arrow in Add, a red X that cancels, the row labelled added',
            !!held && heldRow?.x === 'Cancel' && heldRow.drop && !heldRow.tickStop && heldRow.blockButtons === 0 && /, added/.test(heldRow.label), { held, heldRow });
        if (step === 'cancel') {
            await page.locator('.jfmod-releaseItem--added [data-jfmod-release-x]').focus();
            await page.keyboard.press('Enter');
            // A cancelled grab leaves nothing behind: the status block goes and every action is idle again (picker redesign).
            const cancelled = await until(async () => {
                const block = await page.locator('.jfmod-grabStatus').count();
                const working = await page.locator('.jfmod-releaseAction--working').count();
                const added = await page.locator('.jfmod-releaseItem--added').count();
                return block === 0 && working === 0 && added === 0 ? 'the status block is gone, no action is working, no row is added' : null;
            }, { timeout: 20000, every: 500, label: 'the cancelled state' });
            record(label, 'Cancel by Enter during the hold ends the grab as cancelled', !!cancelled, cancelled);
        } else {
            const accepted = await until(async () => /The download client accepted the torrent/.test(await page.locator('.jfmod-releasePicker').innerText())
                || /could not|failed/i.test(await page.locator('.jfmod-grabStatus').innerText().catch(() => '')) ? await page.locator('.jfmod-grabStatus').innerText() : null,
            { timeout: 60000, every: 500, label: 'the handoff' });
            record(label, 'After the hold the picker reports the verified handoff', /accepted the torrent/.test(accepted), accepted.replace(/\s+/g, ' '));
            // The added row once the client has it: a green tick (no stop), the X is Remove from Queue (oleksii is an
            // administrator), and the download figure from the queue, read right after the handoff.
            const done = await until(async () => {
                const row = await addedRow();
                return row?.tick && row.figure ? row : null;
            }, { timeout: 20000, every: 500, label: 'the added row\'s download figure' }).catch(() => null);
            record(label, 'The added row: a green tick, an X to remove it from the queue, a progress bar and figure (Queued, a percentage or Importing…)',
                !!done && done.x === 'Remove from Queue' && !done.tickStop && done.bar && /^(Queued|\d+%|Importing…|Failed · )/.test(done.figure), done);
        }
        const grabs = requests.filter(line => line === 'POST /JellyfinMod/Releases/Grab').length;
        record(label, 'Exactly one grab request despite the second Enter', grabs === 1, requests);
    }
    record(label, 'No page errors', page.jfmodErrors.length === 0, page.jfmodErrors.slice(0, 3));
    // Back closes the dialog and returns focus to the opener.
    // Back: Escape is the remote's Back on the TV layout; elsewhere upstream closes dialogs on browser Back.
    if (tv) await page.keyboard.press('Escape'); else await page.goBack();
    await page.waitForTimeout(800);
    const back = await page.evaluate(() => ({ open: !!document.querySelector('.jfmod-releasePicker'), focus: document.activeElement?.textContent?.trim().slice(0, 40) }));
    // Stock dialogHelper restores focus to the opener only on the TV layout; elsewhere closing is the whole contract.
    if (tv) record(label, 'Back closes the picker and restores focus to the opener', !back.open && /Search releases/i.test(back.focus ?? ''), back);
    else record(label, 'Back closes the picker', !back.open, back);
    // The choice survives a reload: reopen the picker and read the toggle, then switch it off for the next run.
    await page.reload();
    const reopen = page.locator('button', { hasText: 'Search releases' }).first();
    await reopen.waitFor({ state: 'visible', timeout: 30000 });
    if (tv) { await reopen.focus(); await page.keyboard.press('Enter'); } else await reopen.click();
    await page.waitForSelector('.jfmod-releasePicker .jfmod-namesToggle, .jfmod-releaseDialog .jfmod-namesToggle', { timeout: 15000 });
    const kept = await namesState();
    record(label, 'Show Names survives a reload', kept.pressed === 'true' && kept.label === 'Hide Names', kept);
    if (step === 'grab') {
        // Reopened while the grab is active, the row whose infohash it carries shows as added again.
        const again = await until(async () => page.evaluate(() => {
            const item = document.querySelector('.jfmod-releaseItem--added');
            return item && { tick: !!item.querySelector('.jfmod-releaseAction--done'), x: item.querySelector('[data-jfmod-release-x]')?.title ?? null };
        }), { timeout: 120000, every: 1000, label: 'the added row after reopening' }).catch(() => null);
        record(label, 'Reopened, the picker shows the grabbed row as added (tick and X), found by the active operation\'s infohash', !!again?.tick, again);
    }
    await namesToggle.click();
    await page.evaluate(() => localStorage.setItem('jfmod-releaseNames', '0'));
    record(label, 'Entry read', detail.status === 200, { title: detail.body?.title });
} catch (error) {
    notVerified(label, 'picker flow', error);
    await page.screenshot({ path: `${process.env.JELLYFINMOD_LIVE_SHOTS ?? '.'}/live-${tier}-${step}-${layout}.png` }).catch(() => {});
}
saveResults(label, browser.version());
await context.close();
await browser.close();
