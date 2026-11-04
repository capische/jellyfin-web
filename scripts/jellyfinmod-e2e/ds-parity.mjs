// Usage: node ds-parity.mjs <mockup URL> <real URL> <selector> [selector ...]
// DS_CDP optionally reuses a signed-in browser; DS_WIDTH/DS_HEIGHT set the shared viewport.
import { chromium } from 'playwright';

const [mockupUrl, realUrl, ...selectors] = process.argv.slice(2);
if (!mockupUrl || !realUrl || !selectors.length) {
    throw new Error('Expected mockup URL, real page URL and at least one selector');
}
const browser = process.env.DS_CDP
    ? await chromium.connectOverCDP(process.env.DS_CDP) : await chromium.launch({ headless: true });
const context = process.env.DS_CDP ? browser.contexts()[0] : await browser.newContext();
const viewport = { width: Number(process.env.DS_WIDTH || 1440), height: Number(process.env.DS_HEIGHT || 900) };
const properties = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontSize', 'fontWeight',
    'color', 'background', 'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius',
    'borderBottomLeftRadius', 'backdropFilter'];
const pages = [];
try {
    const snapshots = [];
    for (const url of [mockupUrl, realUrl]) {
        const page = await context.newPage();
        pages.push(page);
        await page.setViewportSize(viewport);
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.evaluate(() => document.fonts.ready);
        const snapshot = {};
        for (const selector of selectors) {
            const element = page.locator(selector).first();
            await element.waitFor({ state: 'attached' });
            snapshot[selector] = await element.evaluate((node, keys) => {
                const style = getComputedStyle(node);
                const rect = node.getBoundingClientRect();
                return { width: `${rect.width}px`, height: `${rect.height}px`,
                    ...Object.fromEntries(keys.map(key => [key, style[key]])) };
            }, properties);
        }
        snapshots.push(snapshot);
    }
    let differences = 0;
    for (const selector of selectors) {
        for (const [property, expected] of Object.entries(snapshots[0][selector])) {
            const actual = snapshots[1][selector][property];
            const lengths = expected.endsWith('px') && actual.endsWith('px');
            if (expected === actual || lengths && Math.abs(parseFloat(expected) - parseFloat(actual)) <= 1) continue;
            console.log(`${selector} | ${property}: mockup=${expected} real=${actual}`);
            differences++;
        }
    }
    console.log(`${differences} differences (length differences <= 1px ignored)`);
    process.exitCode = differences ? 1 : 0;
} finally {
    await Promise.all(pages.map(page => page.close()));
    if (process.env.DS_CDP) await browser.close(); // Disconnects CDP; the user's browser stays open.
    else await context.close().then(() => browser.close());
}
