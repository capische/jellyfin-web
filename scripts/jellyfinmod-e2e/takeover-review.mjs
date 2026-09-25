// Focused S4 takeover acceptance on the isolated test service only.
import { chromium } from 'playwright';

const origin = process.env.JELLYFINMOD_TEST_URL ?? 'http://127.0.0.1:18096';
const target = new URL(origin);
// The isolated instances only (18096 test, 28096 acceptance); production 8096 stays unreachable from here.
if (!['18096', '28096'].includes(target.port)) throw new Error('Takeover acceptance runs only on an isolated instance (18096 or 28096)');
const prefix = process.env.JELLYFINMOD_BASE_URL ?? '';
const browser = await chromium.launch({ headless: true, ...(process.env.JELLYFINMOD_BROWSER === 'chrome' ? { channel: 'chrome' } : {}) });
const context = await browser.newContext({ serviceWorkers: 'block' });
const page = await context.newPage();
const entry = `${target.origin}${prefix}/web/`;
const requests = [];
page.on('request', request => {
    if (request.url().includes('/web-mod/')) requests.push(request.url());
});

async function expectStock(label) {
    await page.waitForFunction(() => !document.documentElement.outerHTML.includes('jellyfinmod:takeover'), null, { timeout: 15000 });
    await page.locator('#txtManualName, .btnManual, .homePage, .dashboardPage').first().waitFor({ state: 'attached', timeout: 15000 });
    if (!page.url().includes(`${prefix}/web/`)) throw new Error(`${label}: unexpected address ${page.url()}`);
    console.log(`PASS: ${label}`);
}

try {
    await page.goto(entry, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__jfmodBundle === true, null, { timeout: 20000 });
    await page.waitForTimeout(1000);
    if (!requests.some(url => url.includes(`${prefix}/web-mod/`))) {
        throw new Error('Mod assets were not fetched under the configured URL prefix');
    }
    console.log('PASS: mod entry and prefixed assets');

    await page.route('**/web-mod/**', route => route.abort('failed'));
    await page.goto(entry, { waitUntil: 'domcontentloaded' });
    await expectStock('first failed bundle load');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expectStock('reload in the same tab');
    await page.goto(entry, { waitUntil: 'domcontentloaded' });
    await expectStock('repeat visit in the same tab');

    const manual = page.locator('#txtManualName');
    if (!await manual.count()) {
        await page.locator('.btnManual').first().evaluate(node => node.click());
    }
    await manual.waitFor({ state: 'visible', timeout: 15000 });
    await manual.fill('oleksii');
    await page.locator('button:visible').filter({ hasText: 'Sign In' }).first().click();
    await page.waitForURL(url => url.hash.includes('/home'), { timeout: 15000 });
    console.log('PASS: stock login and Home');
    await page.goto(entry + '#/dashboard', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.body.innerText.includes('Dashboard'), null, { timeout: 15000 });
    console.log('PASS: stock Dashboard');

    const stockRequests = [];
    await page.route('**/index.jellyfinmod-stock.html*', route => {
        stockRequests.push(route.request().resourceType());
        return route.abort('failed');
    });
    await page.goto(entry, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(2500);
    const count = stockRequests.length;
    await page.waitForTimeout(2500);
    if (count < 1 || count > 3 || stockRequests.length !== count) {
        throw new Error(`Unavailable stock copy caused an unbounded fallback: ${stockRequests.join(', ')}`);
    }
    console.log('PASS: unavailable stock copy does not loop');

    const modContext = await browser.newContext({ serviceWorkers: 'block' });
    const modPage = await modContext.newPage();
    const chunks = [];
    modPage.on('request', request => {
        if (request.url().includes('.chunk.js')) chunks.push(request.url());
    });
    await modPage.goto(entry, { waitUntil: 'domcontentloaded' });
    await modPage.waitForFunction(() => window.__jfmodBundle === true, null, { timeout: 20000 });
    const modManual = modPage.locator('#txtManualName');
    if (!await modManual.count()) await modPage.locator('.btnManual').first().evaluate(node => node.click());
    await modManual.waitFor({ state: 'visible', timeout: 15000 });
    let previousValue;
    for (let attempt = 0; attempt < 15; attempt++) {
        const value = await modManual.inputValue().catch(() => '');
        if (value === previousValue) break;
        previousValue = value;
        await modPage.waitForTimeout(200);
    }
    await modManual.fill('oleksii');
    if (await modManual.inputValue() !== 'oleksii') {
        await modPage.waitForTimeout(300);
        await modManual.fill('oleksii');
    }
    await modPage.locator('button:visible').filter({ hasText: 'Sign In' }).first().click();
    await modPage.waitForURL(url => url.hash.includes('/home'), { timeout: 15000 }).catch(async () => {
        const state = await modPage.evaluate(() => ({ hash: location.hash, loginVisible: !!document.querySelector('#txtManualName')?.getClientRects().length }));
        throw new Error(`Mod sign-in did not reach Home: ${JSON.stringify(state)}`);
    });
    await modPage.evaluate(() => { location.hash = '#/dashboard'; });
    await modPage.waitForFunction(() => document.body.innerText.includes('Dashboard'), null, { timeout: 15000 });
    if (!chunks.length || chunks.some(url => !url.includes(`${prefix}/web-mod/`))) {
        throw new Error(`Lazy chunks did not load under the configured URL prefix: ${chunks.join(', ')}`);
    }
    console.log('PASS: mod Home, Dashboard navigation and lazy chunks');

    const interfaceRequest = (method, route, body) => modPage.evaluate(async request => {
        const options = { url: ApiClient.getUrl(request.route), type: request.method };
        if (request.body) {
            options.data = JSON.stringify(request.body);
            options.contentType = 'application/json';
        }
        const response = await ApiClient.ajax(options, true);
        return { status: response.status, body: await response.json() };
    }, { method, route, body });
    const takeoverStatus = response => response.body.status ?? response.body.Status;
    try {
        const restored = await interfaceRequest('POST', 'JellyfinMod/Settings/Interface/RestoreStock');
        if (restored.status !== 200 || takeoverStatus(restored) !== 'stock') {
            throw new Error(`Stock restore failed: ${restored.status} ${takeoverStatus(restored)}`);
        }
        const stockPage = await modContext.request.get(entry);
        if (!stockPage.ok() || (await stockPage.text()).includes('jellyfinmod:takeover')) {
            throw new Error('The host still serves a patched page after stock restore');
        }
        console.log('PASS: live stock restore');
    } finally {
        const reapplied = await interfaceRequest('PATCH', 'JellyfinMod/Settings/Interface', { takeoverEnabled: true });
        if (reapplied.status !== 200 || takeoverStatus(reapplied) !== 'patched') {
            throw new Error(`Takeover re-apply failed: ${reapplied.status} ${takeoverStatus(reapplied)}`);
        }
        console.log('PASS: live takeover re-apply');
    }
} finally {
    await browser.close();
}
