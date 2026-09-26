/* eslint-disable compat/compat, no-restricted-globals, sonarjs/cognitive-complexity -- a Node acceptance runner, not shipped code */
/* global document */
// Live acceptance (P4 A8 remaining browser rows), per layout:
//  - profile change: choosing another profile runs a new search in place (the dialog stays open, the rows re-evaluate),
//    and the entry's saved profile is unchanged afterwards;
//  - late indexer: with one feed answering only after its timeout, the rows appear once, and a focused row keeps focus
//    and position for 15 s (nothing refetches underneath it);
//  - rejected-only list: focus lands on the rejected group toggle, which opens by Enter.
//   JELLYFINMOD_LIVE_ENTRY  a file-less movie entry with a 1080p fixture release; JELLYFINMOD_LIVE_PROFILE  the 720p-only profile name
import { api, control, launch, newPage, notVerified, record, saveResults, setTvLayout, signIn, tier } from './live-lib.mjs';

const entryId = process.env.JELLYFINMOD_LIVE_ENTRY;
const otherProfile = process.env.JELLYFINMOD_LIVE_PROFILE ?? 'Live 720p only';
const layouts = (process.env.JELLYFINMOD_LIVE_LAYOUTS ?? 'desktop,mobile,tv1080,tv720').split(',');
const browser = await launch();

const openPicker = async page => {
    await page.evaluate(id => { location.hash = '#/details?entryId=' + encodeURIComponent(id); }, entryId);
    const search = page.locator('button', { hasText: 'Search releases' }).first();
    await search.waitFor({ state: 'visible', timeout: 30000 });
    await search.focus();
    await page.keyboard.press('Enter');
    await page.waitForSelector('.jfmod-releasePicker', { timeout: 15000 });
    await page.waitForFunction(() => !/Searching/.test(document.querySelector('.jfmod-releaseStatus')?.textContent ?? 'Searching'), undefined, { timeout: 120000 });
};

for (const layout of layouts) {
    const label = `picker-extra ${layout}`;
    const { context, page } = await newPage(browser, layout);
    try {
        await signIn(page);
        if (layout.startsWith('tv')) await setTvLayout(page);
        const before = (await api(page, 'GET', `JellyfinMod/Entries/${entryId}`)).body.entry.qualityProfileId;

        // Late indexer: feed 3 never answers, so the search waits for its timeout; rows appear once and hold still.
        control('/fault?service=torznab3&mode=slow');
        await openPicker(page);
        await page.evaluate(() => { window.jfmodRow = document.querySelector('.jfmod-releaseList .jfmod-releaseRow'); window.jfmodRow?.focus(); });
        const top = await page.evaluate(() => window.jfmodRow?.getBoundingClientRect().top ?? null);
        await page.waitForTimeout(15000);
        const held = await page.evaluate(() => ({ same: document.activeElement === window.jfmodRow && window.jfmodRow.isConnected,
            top: window.jfmodRow?.getBoundingClientRect().top ?? null, notice: document.querySelector('.jfmod-releaseNotice')?.textContent ?? null }));
        record(label, 'A feed that answers late yields one partial result; the focused row keeps focus and position for 15 s',
            held.same && held.top === top && /Partial results/.test(held.notice ?? ''), { top, ...held });
        control('/fault?service=torznab3&mode=ok');

        // Profile change: a new search in place, the dialog stays, the rows re-evaluate, the entry keeps its profile.
        const rowsBefore = await page.locator('.jfmod-releaseList .jfmod-releaseRow').count();
        const option = await page.locator('#jfmod-releaseProfile option', { hasText: otherProfile }).getAttribute('value');
        await page.locator('#jfmod-releaseProfile').selectOption(option);
        await page.waitForFunction(() => !/Searching/.test(document.querySelector('.jfmod-releaseStatus')?.textContent ?? 'Searching'), undefined, { timeout: 120000 });
        await page.waitForTimeout(1500);
        const after = await page.evaluate(() => ({ open: !!document.querySelector('.jfmod-releasePicker'), eligible: document.querySelectorAll('.jfmod-releaseList .jfmod-releaseRow').length,
            status: document.querySelector('.jfmod-releaseStatus')?.textContent ?? '', focus: document.activeElement?.className ?? '' }));
        const saved = (await api(page, 'GET', `JellyfinMod/Entries/${entryId}`)).body.entry.qualityProfileId;
        record(label, 'Choosing another profile re-searches in place; the 1080p fixture is now rejected; the entry\'s saved profile is unchanged',
            after.open && rowsBefore > 0 && after.eligible === 0 && saved === before, { rowsBefore, after, before, saved });
        // Rejected-only list: focus sits on the rejected-group toggle, which opens by Enter.
        const onToggle = /jfmod-rejectedToggle/.test(after.focus);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(800);
        const opened = await page.locator('.jfmod-releaseRow--rejected').count();
        record(label, 'Rejected-only list: focus is on the rejected group, and Enter opens it with reasons', onToggle && opened > 0, { focus: after.focus, opened });
        record(label, 'No page errors', page.jfmodErrors.length === 0, page.jfmodErrors.slice(0, 3));
    } catch (error) {
        notVerified(label, 'picker extras', error);
        await page.screenshot({ path: `${process.env.JELLYFINMOD_LIVE_SHOTS ?? '.'}/live-${tier}-picker-extra-${layout}.png` }).catch(() => {});
        control('/fault?service=torznab3&mode=ok');
    }
    saveResults(label, browser.version());
    await context.close();
}
await browser.close();
