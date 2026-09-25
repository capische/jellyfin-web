/* eslint-disable compat/compat, no-restricted-globals -- a Node acceptance runner, not shipped code */
/* global document */
// Live acceptance helper: signs in, opens JELLYFINMOD_LIVE_HASH in JELLYFINMOD_LIVE_LAYOUT and records the text of the
// elements matching JELLYFINMOD_LIVE_SELECTOR (for example a stale queue row), as a named check with an expected pattern.
import { launch, newPage, notVerified, record, saveResults, setTvLayout, signIn } from './live-lib.mjs';

const layout = process.env.JELLYFINMOD_LIVE_LAYOUT ?? 'desktop';
const check = process.env.JELLYFINMOD_LIVE_CHECK ?? 'snapshot';
const expect = new RegExp(process.env.JELLYFINMOD_LIVE_EXPECT ?? '.');
const browser = await launch();
const { context, page } = await newPage(browser, layout);
try {
    await signIn(page);
    if (layout.startsWith('tv')) await setTvLayout(page);
    await page.evaluate(hash => { location.hash = hash; }, process.env.JELLYFINMOD_LIVE_HASH);
    await page.waitForSelector(process.env.JELLYFINMOD_LIVE_SELECTOR, { timeout: 30000 });
    await page.waitForTimeout(Number(process.env.JELLYFINMOD_LIVE_SETTLE ?? 2000));
    const texts = (await page.locator(process.env.JELLYFINMOD_LIVE_SELECTOR).allInnerTexts()).map(text => text.replace(/\s+/g, ' ').trim());
    record(`snap ${layout}`, check, texts.some(text => expect.test(text)), texts.slice(0, 6));
} catch (error) {
    notVerified(`snap ${layout}`, check, error);
}
saveResults(`snap ${layout}`, browser.version());
await context.close();
await browser.close();
