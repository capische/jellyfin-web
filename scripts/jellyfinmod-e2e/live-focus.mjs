/* eslint-disable compat/compat, no-restricted-globals -- a Node acceptance runner, not shipped code */
/* global document, getComputedStyle */
// Live acceptance (finding 2): on the file-less detail page no mod button has the browser's light button background,
// and on the TV layout the page opens with focus on its first action (Search releases for an administrator).
//   JELLYFINMOD_LIVE_ENTRY  a file-less entry id
import { launch, newPage, notVerified, record, saveResults, setTvLayout, signIn } from './live-lib.mjs';

const entryId = process.env.JELLYFINMOD_LIVE_ENTRY;
const browser = await launch();
for (const layout of ['desktop', 'mobile', 'tv1080', 'tv720']) {
    const label = `focus ${layout}`;
    const { context, page } = await newPage(browser, layout);
    try {
        await signIn(page);
        if (layout.startsWith('tv')) await setTvLayout(page);
        await page.evaluate(id => { location.hash = '#/details?entryId=' + encodeURIComponent(id); }, entryId);
        await page.locator('button', { hasText: 'Search releases' }).waitFor({ timeout: 30000 });
        await page.waitForTimeout(2500);
        const info = await page.evaluate(() => ({
            active: document.activeElement === document.body ? 'body' : (document.activeElement?.textContent ?? '').trim().slice(0, 30),
            buttons: [...document.querySelectorAll('.jfmod-entryActions button, .jfmod-historyToggle')]
                .map(button => [(button.textContent ?? '').trim().slice(0, 16), getComputedStyle(button).backgroundColor])
        }));
        record(label, 'No mod button on the file-less detail page has the browser light background',
            info.buttons.every(([, background]) => background !== 'rgb(239, 239, 239)'), info.buttons);
        if (layout.startsWith('tv')) record(label, 'TV: the page opens with focus on its first action (Search releases)', /Search releases/.test(info.active), info.active);
        record(label, 'No page errors', page.jfmodErrors.length === 0, page.jfmodErrors.slice(0, 3));
    } catch (error) {
        notVerified(label, 'detail page', error);
    }
    saveResults(label, browser.version());
    await context.close();
}
await browser.close();
