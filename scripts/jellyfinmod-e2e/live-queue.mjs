/* eslint-disable compat/compat, no-restricted-globals, sonarjs/cognitive-complexity -- a Node acceptance runner, not shipped code */
/* global document */
// Live acceptance (P5 I3/I8/I9.7): while a real download runs, the Movies card ring and the queue row agree; the grid
// never blanks during polls; on TV the focused queue row keeps focus through ten polls and the list never unmounts.
//
//   JELLYFINMOD_LIVE_ENTRY   entry id of the downloading title;  JELLYFINMOD_LIVE_LIBRARY  its Movies library id
//   JELLYFINMOD_LIVE_TITLE   its title as the card shows it;     JELLYFINMOD_LIVE_LAYOUTS  comma list (default all four)
import { api, launch, newPage, notVerified, record, saveResults, setTvLayout, signIn, tier } from './live-lib.mjs';

const entryId = process.env.JELLYFINMOD_LIVE_ENTRY;
const libraryId = process.env.JELLYFINMOD_LIVE_LIBRARY;
const title = process.env.JELLYFINMOD_LIVE_TITLE;
const layouts = (process.env.JELLYFINMOD_LIVE_LAYOUTS ?? 'desktop,mobile,tv1080,tv720').split(',');
const browser = await launch();

const cardPercent = page => page.evaluate(name => {
    const card = [...document.querySelectorAll('.card')].find(node => (node.textContent ?? '').includes(name));
    const mark = card?.querySelector('.jfmod-mark--inFlight');
    return { found: !!card, inFlight: !!mark, text: mark?.textContent?.trim() ?? null, cards: document.querySelectorAll('.card').length };
}, title);
const queuePercent = page => page.evaluate(name => {
    const rows = [...document.querySelectorAll('.jfmod-queueRow, .jfmod-queueTableRow')];
    const row = rows.find(node => (node.textContent ?? '').includes(name));
    const bar = row?.querySelector('[role="progressbar"]');
    return { found: !!row, percent: bar ? Number(bar.getAttribute('aria-valuenow')) : null, text: row?.textContent?.replace(/\s+/g, ' ').slice(0, 200) ?? null };
}, title);

for (const layout of layouts) {
    const label = `queue ${layout}`;
    const { context, page } = await newPage(browser, layout);
    try {
        await signIn(page);
        if (layout.startsWith('tv')) await setTvLayout(page);
        // Movies grid: the card shows the in-flight ring with a percentage; sample it across polls and count cards.
        await page.evaluate(id => { location.hash = '#/movies?topParentId=' + id; }, libraryId);
        // Wait for the Movies route itself (Home also shows the card in Recently Added).
        await page.waitForFunction(name => location.hash.startsWith('#/movies')
            && [...document.querySelectorAll('.card')].some(node => (node.textContent ?? '').includes(name)), title, { timeout: 45000 });
        await page.waitForTimeout(1500);
        const samples = [];
        for (let i = 0; i < 5; i++) { samples.push(await cardPercent(page)); await page.waitForTimeout(3500); }
        const api1 = await api(page, 'GET', `JellyfinMod/Queue?entryId=${entryId}`);
        record(label, 'The Movies card shows the in-flight ring with a percentage, and the grid never blanks while it polls',
            samples.every(sample => sample.inFlight && sample.cards > 0), { samples, queue: api1.body?.items?.[0] && { state: api1.body.items[0].state, progress: api1.body.items[0].progress } });
        const cardValue = Number(/(\d+)%/.exec(samples.at(-1).text ?? '')?.[1]);
        // Queue route: the row's progress bar agrees with the card within one poll.
        await page.evaluate(() => { location.hash = '#/catalog/queue'; });
        await page.waitForFunction(name => [...document.querySelectorAll('.jfmod-queueRow, .jfmod-queueTableRow')].some(node => (node.textContent ?? '').includes(name)), title, { timeout: 30000 });
        const row = await queuePercent(page);
        record(label, 'The queue row shows the same progress as the card (within one poll)', row.found && Math.abs(row.percent - cardValue) <= 2, { card: cardValue, row });
        if (layout.startsWith('tv')) {
            const focused = await page.evaluate(() => document.activeElement?.className ?? '');
            // Ten polls (3 s each): the same element keeps focus and the list is never replaced.
            await page.evaluate(() => { window.jfmodListNode = document.querySelector('.jfmod-queueList'); window.jfmodFocusNode = document.activeElement; });
            const checks = [];
            for (let i = 0; i < 10; i++) {
                await page.waitForTimeout(3100);
                checks.push(await page.evaluate(() => ({ sameFocus: document.activeElement === window.jfmodFocusNode, sameList: document.querySelector('.jfmod-queueList') === window.jfmodListNode,
                    percent: Number(document.activeElement?.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')) })));
            }
            record(label, 'TV: the first row is focused on open, keeps focus across ten polls and the list never unmounts',
                /jfmod-queueRow/.test(focused) && checks.every(check => check.sameFocus && check.sameList), { focused, percents: checks.map(check => check.percent) });
            // Enter opens the action sheet with the two actions; Back closes it and focus returns to the row.
            await page.keyboard.press('Enter');
            await page.waitForTimeout(1200);
            const sheet = await page.evaluate(() => [...document.querySelectorAll('.actionSheet button, .actionsheetMenuItem')].map(node => node.textContent?.trim()).filter(Boolean));
            await page.keyboard.press('Escape'); // the remote's Back on the TV layout
            await page.waitForTimeout(1200);
            const after = await page.evaluate(() => ({ focused: document.activeElement?.className ?? '', sheet: !!document.querySelector('.actionSheet') }));
            record(label, 'TV: Enter opens the row actions (Remove; Open in client only when configured); Back closes them and focus returns to the row',
                sheet.some(text => /Remove/.test(text)) && !after.sheet && /jfmod-queueRow/.test(after.focused), { sheet, after });
        }
        record(label, 'No page errors', page.jfmodErrors.length === 0, page.jfmodErrors.slice(0, 3));
    } catch (error) {
        notVerified(label, 'queue and card progress', error);
        await page.screenshot({ path: `${process.env.JELLYFINMOD_LIVE_SHOTS ?? '.'}/live-${tier}-queue-${layout}.png` }).catch(() => {});
    }
    saveResults(label, browser.version());
    await context.close();
}
await browser.close();
