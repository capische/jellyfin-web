/* eslint-disable compat/compat, no-restricted-globals, sonarjs/cognitive-complexity -- a Node acceptance runner, not shipped code */
/* global document */
// Live acceptance (P4 A8, P5 I3-I9): drives the built release picker against the live instance.
//
//   JELLYFINMOD_LIVE_STEP=grab    opens the entry (or episode), searches, records eligible and rejected rows, focuses the
//                                 row whose raw title contains JELLYFINMOD_LIVE_ROW and presses Enter once; waits for
//                                 the hold and the accepted handoff
//   JELLYFINMOD_LIVE_STEP=cancel  the same, but presses Enter on Cancel during the hold and waits for `cancelled`
//   JELLYFINMOD_LIVE_ENTRY        entry id;  JELLYFINMOD_LIVE_EPISODE  optional episode id (series)
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
    const detail = await api(page, 'GET', `JellyfinMod/Entries/${entryId}`);
    await page.evaluate(id => { location.hash = '#/details?entryId=' + encodeURIComponent(id); }, entryId);
    const search = page.locator('button', { hasText: 'Search releases' }).first();
    await search.waitFor({ state: 'visible', timeout: 30000 });
    if (tv) {
        // Reach the action by keys only: record what has focus on open, then arrow along until Search releases has it.
        await page.waitForTimeout(1500);
        const onOpen = await page.evaluate(() => document.activeElement === document.body ? 'body' : (document.activeElement?.textContent ?? '').trim().slice(0, 30));
        const isSearch = () => page.evaluate(() => document.activeElement?.tagName === 'BUTTON' && /Search releases/.test(document.activeElement.textContent ?? ''));
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
    if (episodeId) {
        await page.locator('#jfmod-releaseEpisode').selectOption(episodeId);
    }
    await page.waitForFunction(() => !/Searching/.test(document.querySelector('.jfmod-releaseStatus')?.textContent ?? 'Searching'), undefined, { timeout: 120000 });
    const status = (await page.locator('.jfmod-releaseStatus').innerText()).trim();
    const notice = await page.locator('.jfmod-releaseNotice').allInnerTexts();
    const eligible = (await page.locator('.jfmod-releaseList .jfmod-releaseRow').allInnerTexts()).map(text => text.replace(/\s+/g, ' ').trim());
    const firstFocused = await page.evaluate(() => document.activeElement?.classList.contains('jfmod-releaseRow') ?? false);
    const toggle = page.locator('.jfmod-rejectedToggle');
    let rejected = [];
    if (await toggle.count()) {
        await toggle.click();
        rejected = (await page.locator('.jfmod-releaseRow--rejected').allInnerTexts()).map(text => text.replace(/\s+/g, ' ').trim());
        await toggle.click();
    }
    record(label, 'The picker lists eligible rows (raw title visible) and a collapsed rejected group with reasons', eligible.length > 0,
        { status, notice, eligible: eligible.slice(0, 12), rejected: rejected.slice(0, 12), eligibleCount: eligible.length, rejectedCount: rejected.length });
    record(label, 'Focus starts on the first eligible row', firstFocused);
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
        record(label, 'One Enter starts a held grab with a countdown and a focusable Cancel', !!held && await page.locator('.jfmod-grabCancel').count() === 1, held);
        if (step === 'cancel') {
            await page.locator('.jfmod-grabCancel').focus();
            await page.keyboard.press('Enter');
            const cancelled = await until(async () => {
                const text = (await page.locator('.jfmod-releasePicker').innerText()).replace(/\s+/g, ' ');
                return /cancel/i.test(text) && !/Sending to the download client in/.test(text) ? text.slice(0, 300) : null;
            }, { timeout: 20000, every: 500, label: 'the cancelled state' });
            record(label, 'Cancel by Enter during the hold ends the grab as cancelled', !!cancelled, cancelled);
        } else {
            const accepted = await until(async () => /The download client accepted the torrent/.test(await page.locator('.jfmod-releasePicker').innerText())
                || /could not|failed/i.test(await page.locator('.jfmod-grabStatus').innerText().catch(() => '')) ? await page.locator('.jfmod-grabStatus').innerText() : null,
            { timeout: 60000, every: 500, label: 'the handoff' });
            record(label, 'After the hold the picker reports the verified handoff', /accepted the torrent/.test(accepted), accepted.replace(/\s+/g, ' '));
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
    if (tv) record(label, 'Back closes the picker and restores focus to the opener', !back.open && /Search releases/.test(back.focus ?? ''), back);
    else record(label, 'Back closes the picker', !back.open, back);
    record(label, 'Entry read', detail.status === 200, { title: detail.body?.title });
} catch (error) {
    notVerified(label, 'picker flow', error);
    await page.screenshot({ path: `${process.env.JELLYFINMOD_LIVE_SHOTS ?? '.'}/live-${tier}-${step}-${layout}.png` }).catch(() => {});
}
saveResults(label, browser.version());
await context.close();
await browser.close();
