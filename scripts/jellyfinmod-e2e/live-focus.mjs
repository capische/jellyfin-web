/* eslint-disable compat/compat, no-restricted-globals -- a Node acceptance runner, not shipped code */
/* global document, getComputedStyle, location */
// Live acceptance (finding 2, review P2-c/P2-d/P2-h): on the file-less detail page no mod button has the browser's light
// button background; on the TV layout the page opens with focus on its first action (Search releases) and its flat buttons
// carry the theme's show-focus; the page gives up placing focus once the user presses a key while it loads (the entry
// request is held back 4 s so the key lands mid-load), and it keeps a focus target that was already valid when it opened
// (a header control). On desktop a flat button shows the focus ring under keyboard focus and none after a mouse click.
//   JELLYFINMOD_LIVE_ENTRY  a file-less entry id
import { launch, newPage, notVerified, record, saveResults, setTvLayout, signIn } from './live-lib.mjs';

const entryId = process.env.JELLYFINMOD_LIVE_ENTRY;
const RING = 'rgb(0, 164, 220)';
const open = (page, id) => page.evaluate(value => {
    location.hash = '#/details?entryId=' + encodeURIComponent(value);
}, id);
const active = page => page.evaluate(() => {
    const element = document.activeElement;
    if (!element || element === document.body) return { text: 'body', header: false };
    return { text: (element.textContent ?? element.getAttribute('title') ?? '').trim().slice(0, 30),
        header: Boolean(element.closest('.skinHeader')), className: element.className };
});
const leave = async page => {
    await page.evaluate(() => {
        location.hash = '#/home';
    });
    await page.waitForTimeout(2500);
};

const browser = await launch();
for (const layout of ['desktop', 'mobile', 'tv1080', 'tv720']) {
    const label = `focus ${layout}`;
    const tv = layout.startsWith('tv');
    const { context, page } = await newPage(browser, layout);
    try {
        await signIn(page);
        if (tv) await setTvLayout(page);
        await open(page, entryId);
        await page.locator('button', { hasText: 'Search releases' }).waitFor({ timeout: 30000 });
        await page.waitForTimeout(2500);
        const info = await page.evaluate(() => ({
            active: document.activeElement === document.body ? 'body' : (document.activeElement?.textContent ?? '').trim().slice(0, 30),
            buttons: [...document.querySelectorAll('.jfmod-entryActions button, .jfmod-historyToggle')]
                .map(button => [(button.textContent ?? '').trim().slice(0, 16), getComputedStyle(button).backgroundColor]),
            flat: [...document.querySelectorAll('.jfmod-flatButton')].map(button => button.classList.contains('show-focus'))
        }));
        record(label, 'No mod button on the file-less detail page has the browser light background',
            info.buttons.every(([, background]) => background !== 'rgb(239, 239, 239)'), info.buttons);
        record(label, tv ? 'TV: every flat mod button carries show-focus' : 'Flat mod buttons carry no TV show-focus',
            info.flat.length > 0 && info.flat.every(value => value === tv), info.flat);
        if (tv) {
            record(label, 'TV: the page opens with focus on its first action (Search releases)', /Search releases/.test(info.active), info.active);

            // A key pressed while the entry is still loading ends the page's focus ownership (P2-c, P2-h).
            await leave(page);
            let held = 0;
            await page.route(/\/JellyfinMod\/Entries\/[0-9a-f]{32}(\?|$)/, async route => {
                held++;
                await new Promise(resolve => setTimeout(resolve, 4000));
                await route.continue();
            });
            await open(page, entryId);
            await page.waitForTimeout(800);
            const loading = await page.locator('button', { hasText: 'Search releases' }).count();
            await page.keyboard.press('ArrowUp');
            const afterKey = await active(page);
            await page.locator('button', { hasText: 'Search releases' }).waitFor({ timeout: 30000 });
            await page.waitForTimeout(2500);
            const afterLoad = await active(page);
            await page.unroute(/\/JellyfinMod\/Entries\/[0-9a-f]{32}(\?|$)/);
            record(label, 'TV: a key pressed while the entry loads keeps the page from moving focus afterwards',
                held > 0 && loading === 0 && !/Search releases/.test(afterLoad.text) && afterLoad.text === afterKey.text,
                { held, loading, afterKey: afterKey.text, afterLoad: afterLoad.text });

            // A focus target already valid when the page opens (a header control) is kept (P2-h).
            await leave(page);
            const header = await page.evaluate(() => {
                const button = [...document.querySelectorAll('.skinHeader button')].find(element => element.offsetParent !== null);
                button?.focus();
                return button ? (button.getAttribute('title') ?? button.className).slice(0, 40) : null;
            });
            await open(page, entryId);
            await page.locator('button', { hasText: 'Search releases' }).waitFor({ timeout: 30000 });
            await page.waitForTimeout(2500);
            const kept = await active(page);
            record(label, 'TV: a header control focused when the page opens keeps focus', Boolean(header) && kept.header, { header, kept });
        } else if (layout === 'desktop') {
            // Keyboard focus shows the ring on a flat button; a mouse click leaves none (P2-d).
            const flat = page.locator('.jfmod-historyToggle.jfmod-flatButton');
            await page.keyboard.press('Shift');
            await flat.focus();
            await page.waitForTimeout(600); // emby-button transitions its box-shadow
            const keyboardRing = await flat.evaluate(element => getComputedStyle(element).boxShadow);
            await page.mouse.click(5, 300);
            const box = await flat.boundingBox();
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
            await page.waitForTimeout(600);
            const mouseRing = await flat.evaluate(element => (document.activeElement === element ? getComputedStyle(element).boxShadow : 'not focused'));
            record(label, 'Desktop: a flat button shows the focus ring under keyboard focus', keyboardRing.includes(RING), keyboardRing);
            record(label, 'Desktop: a mouse click leaves no focus ring on a flat button', !mouseRing.includes(RING), mouseRing);
        }
        record(label, 'No page errors', page.jfmodErrors.length === 0, page.jfmodErrors.slice(0, 3));
    } catch (error) {
        notVerified(label, 'detail page', error);
    }
    saveResults(label, browser.version());
    await context.close();
}
await browser.close();
