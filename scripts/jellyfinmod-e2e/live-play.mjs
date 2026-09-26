/* eslint-disable compat/compat, no-restricted-globals -- a Node acceptance runner, not shipped code */
/* global document */
// Live acceptance (P5 I5/I9.1): an imported title plays in the built browser in desktop, mobile and TV layouts. Opens the
// native item's detail page, starts Play (TV: by Enter on the focused Play button), and requires the video element to
// advance at least 3 s of media time. Real Chrome is the tier that decodes H.264 without a transcode.
//   JELLYFINMOD_LIVE_ITEM  the imported native item id
import { launch, newPage, notVerified, record, saveResults, setTvLayout, signIn, until } from './live-lib.mjs';

const itemId = process.env.JELLYFINMOD_LIVE_ITEM;
const layouts = (process.env.JELLYFINMOD_LIVE_LAYOUTS ?? 'desktop,mobile,tv1080').split(',');
const browser = await launch();
for (const layout of layouts) {
    const label = `play ${layout}`;
    const { context, page } = await newPage(browser, layout);
    const playbackRequests = [];
    page.on('request', request => { if (/\/(Videos\/[^/]+\/(stream|master)|PlaybackInfo)/.test(request.url())) playbackRequests.push(new URL(request.url()).pathname.replace(/[0-9a-f]{32}/g, '<id>')); });
    try {
        await signIn(page);
        if (layout.startsWith('tv')) await setTvLayout(page);
        await page.evaluate(id => { location.hash = '#/details?id=' + id; }, itemId);
        const play = page.locator('.mainDetailButtons .btnPlay:not(.hide)').first();
        await play.waitFor({ state: 'visible', timeout: 30000 });
        await page.waitForTimeout(1500);
        if (layout.startsWith('tv')) {
            const focused = await page.evaluate(() => document.activeElement?.classList.contains('btnPlay') ?? false);
            record(label, 'TV: Play has focus on the detail page', focused);
            if (!focused) await play.focus();
            await page.keyboard.press('Enter');
        } else {
            await play.click();
        }
        const advanced = await until(() => page.evaluate(() => {
            const video = document.querySelector('video');
            return video && video.currentTime >= 3 && !video.paused ? Math.round(video.currentTime) : null;
        }), { timeout: 60000, every: 1000, label: 'the video to play 3 s' });
        record(label, 'The imported title plays (media time advances past 3 s)', advanced >= 3, { seconds: advanced, requests: [...new Set(playbackRequests)].slice(0, 4) });
        record(label, 'No page errors', page.jfmodErrors.length === 0, page.jfmodErrors.slice(0, 3));
    } catch (error) {
        notVerified(label, 'playback', error);
    }
    saveResults(label, browser.version());
    await context.close();
}
await browser.close();
