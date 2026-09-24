/* eslint-disable compat/compat, no-restricted-globals, sonarjs/cognitive-complexity, sonarjs/no-os-command-from-path -- a Node acceptance runner, not shipped code */
/* global document, location */
// S11 step 6 (P7): the security sweep, including the ordinary-user half, on an isolated instance.
//
//   JELLYFINMOD_TEST_URL=http://<host>:<isolated-port>/ JELLYFINMOD_BROWSER=chromium|chrome \
//   JELLYFINMOD_SECRET_STORE_CMD='<command printing the plugin secret store JSON>' node security-sweep.mjs
//
// 1. Creates a disposable non-administrator user (`JellyfinMod S11 ordinary …`), signs it in over HTTP.
// 2. Every JellyfinMod route: anonymous must be 401 (except the anonymous bundle and repository routes),
//    the ordinary user must be 403 on every administrator route and 200 on Health.
// 3. Leak check over every response body of the sweep plus every administrator GET: no `sec_` reference,
//    no `apikey=` / `api_key=`, no non-empty password field, and none of the values actually held in the
//    plugin secret store (read into memory through JELLYFINMOD_SECRET_STORE_CMD, never printed).
// 4. Served-bundle path traversal: every form is 404.
// 5. The ordinary user in a real browser, desktop and mobile: the user menu offers neither *JellyfinMod
//    settings* nor the Dashboard, the settings area and the setup wizard refuse, Home shows no setup banner,
//    no settings request is made, no page error.
// 6. Deletes the user and proves it is gone. The user has no password: authorization is about the policy,
//    and an empty password means no credential is ever generated, typed or stored.
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import { chromium } from 'playwright';

const testUrl = new URL(process.env.JELLYFINMOD_TEST_URL ?? (() => { throw new Error('JELLYFINMOD_TEST_URL is required'); })());
if (!['18096', '28096'].includes(testUrl.port)) throw new Error('Runs on the isolated instances only');
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
const origin = testUrl.origin;
const results = [];
const record = (check, ok, detail) => {
    results.push({ check, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${check}${detail === undefined ? '' : ' :: ' + JSON.stringify(detail)}`);
};
const client = 'MediaBrowser Client="s11-security", Device="s11-security", DeviceId="s11-security-sweep", Version="1.0"';
const bodies = [];

async function call(method, path, token, body) {
    const headers = { Authorization: token ? `${client}, Token="${token}"` : client };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(origin + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    const text = await response.text();
    bodies.push({ where: `${method} ${path}`, text });
    return { status: response.status, text };
}
async function signIn(name) {
    const response = await call('POST', '/Users/AuthenticateByName', null, { Username: name, Pw: '' });
    if (response.status !== 200) throw new Error(`sign-in as ${name} failed: ${response.status}`);
    const parsed = JSON.parse(response.text);
    bodies.pop(); // the sign-in response carries the access token itself; it is not a JellyfinMod response
    return { token: parsed.AccessToken, userId: parsed.User.Id };
}

const G = '00000000-0000-4000-8000-000000000001';
// [method, path, anonymous expectation, ordinary expectation]
const ADMIN = 403;
const routes = [
    ['GET', '/JellyfinMod/Health', 401, 200],
    ['GET', '/JellyfinMod/Settings/Overview', 401, ADMIN],
    ['GET', '/JellyfinMod/Settings/Discovery', 401, ADMIN], ['PATCH', '/JellyfinMod/Settings/Discovery', 401, ADMIN], ['POST', '/JellyfinMod/Settings/Discovery/Test', 401, ADMIN],
    ['GET', '/JellyfinMod/Settings/SeedProtection', 401, ADMIN], ['PATCH', '/JellyfinMod/Settings/SeedProtection', 401, ADMIN], ['POST', '/JellyfinMod/Settings/SeedProtection/Test', 401, ADMIN],
    ['GET', '/JellyfinMod/Settings/Retention', 401, ADMIN], ['PATCH', '/JellyfinMod/Settings/Retention', 401, ADMIN],
    ['GET', '/JellyfinMod/Settings/Interface', 401, ADMIN], ['PATCH', '/JellyfinMod/Settings/Interface', 401, ADMIN], ['POST', '/JellyfinMod/Settings/Interface/RestoreStock', 401, ADMIN],
    ['GET', '/JellyfinMod/Settings/Prowlarr', 401, ADMIN], ['POST', '/JellyfinMod/Settings/Prowlarr', 401, ADMIN], ['PATCH', `/JellyfinMod/Settings/Prowlarr/${G}`, 401, ADMIN],
    ['DELETE', `/JellyfinMod/Settings/Prowlarr/${G}`, 401, ADMIN], ['POST', `/JellyfinMod/Settings/Prowlarr/${G}/Test`, 401, ADMIN], ['POST', `/JellyfinMod/Settings/Prowlarr/${G}/Sync`, 401, ADMIN],
    ['GET', '/JellyfinMod/Setup/State', 401, ADMIN], ['POST', '/JellyfinMod/Setup/Dismiss', 401, ADMIN],
    ['GET', '/JellyfinMod/Settings/Indexers', 401, ADMIN], ['POST', '/JellyfinMod/Settings/Indexers', 401, ADMIN], ['PATCH', `/JellyfinMod/Settings/Indexers/${G}`, 401, ADMIN],
    ['DELETE', `/JellyfinMod/Settings/Indexers/${G}`, 401, ADMIN], ['POST', `/JellyfinMod/Settings/Indexers/${G}/Test`, 401, ADMIN],
    ['GET', '/JellyfinMod/Settings/DownloadClients', 401, ADMIN], ['POST', '/JellyfinMod/Settings/DownloadClients', 401, ADMIN], ['PATCH', `/JellyfinMod/Settings/DownloadClients/${G}`, 401, ADMIN],
    ['DELETE', `/JellyfinMod/Settings/DownloadClients/${G}`, 401, ADMIN], ['POST', `/JellyfinMod/Settings/DownloadClients/${G}/Test`, 401, ADMIN],
    ['GET', `/JellyfinMod/Settings/DownloadClients/${G}/PathMappings`, 401, ADMIN], ['PUT', `/JellyfinMod/Settings/DownloadClients/${G}/PathMappings`, 401, ADMIN],
    ['POST', `/JellyfinMod/Settings/DownloadClients/${G}/TestImportPath`, 401, ADMIN],
    ['GET', '/JellyfinMod/Settings/QualityProfiles', 401, ADMIN], ['POST', '/JellyfinMod/Settings/QualityProfiles', 401, ADMIN], ['PATCH', `/JellyfinMod/Settings/QualityProfiles/${G}`, 401, ADMIN],
    ['DELETE', `/JellyfinMod/Settings/QualityProfiles/${G}`, 401, ADMIN],
    ['GET', '/JellyfinMod/Settings/Acquisition', 401, ADMIN], ['PATCH', '/JellyfinMod/Settings/Acquisition', 401, ADMIN],
    ['GET', '/JellyfinMod/Settings/Import', 401, ADMIN], ['PATCH', '/JellyfinMod/Settings/Import', 401, ADMIN],
    ['GET', '/JellyfinMod/Settings/Automation', 401, ADMIN], ['PATCH', '/JellyfinMod/Settings/Automation', 401, ADMIN],
    ['GET', '/JellyfinMod/Automation/Status', 401, ADMIN], ['POST', '/JellyfinMod/Automation/Run', 401, ADMIN],
    ['GET', '/JellyfinMod/Automation/Decisions', 401, ADMIN], ['GET', '/JellyfinMod/Automation/Targets', 401, ADMIN],
    ['GET', '/JellyfinMod/Retention/Preview', 401, ADMIN], ['GET', '/JellyfinMod/Retention/Runs/Latest', 401, ADMIN], ['POST', '/JellyfinMod/Retention/Run', 401, ADMIN],
    ['GET', '/JellyfinMod/Releases', 401, ADMIN], ['POST', '/JellyfinMod/Releases/Grab', 401, ADMIN], ['GET', '/JellyfinMod/Grabs', 401, ADMIN],
    ['GET', `/JellyfinMod/Grabs/${G}`, 401, ADMIN],
    ['GET', '/JellyfinMod/Seeding', 401, ADMIN], ['POST', `/JellyfinMod/Imports/${G}/Retry`, 401, ADMIN], ['DELETE', `/JellyfinMod/Queue/${G}`, 401, ADMIN]
];
const traversal = ['/web-mod/../../etc/passwd', '/web-mod/%2e%2e/%2e%2e/etc/passwd', '/web-mod/..%2f..%2fetc%2fpasswd', '/web-mod/..%5c..%5cjellyfinmod.db',
    '/web-mod/000000000000/index.html', '/web-mod/{id}/../../jellyfinmod.db', '/web-mod/{id}/..%2f..%2facquisition-secrets.json', '/web-mod/{id}/%2e%2e%2f%2e%2e%2fweb-root%2fstate.json',
    '/web-mod/{id}/....//....//etc/passwd'];

// The secret store's values, held in memory only.
const secretValues = [];
if (process.env.JELLYFINMOD_SECRET_STORE_CMD) {
    const walk = value => {
        if (typeof value === 'string' && value.length >= 6) secretValues.push(value);
        else if (value && typeof value === 'object') Object.values(value).forEach(walk);
    };
    walk(JSON.parse(execSync(process.env.JELLYFINMOD_SECRET_STORE_CMD, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })));
    // Keys of the store are references (sec_…), which must not appear either; they are caught by the sec_ rule.
}
console.log('secret values loaded (count only):', secretValues.length);

const admin = await signIn('oleksii');
const userName = 'JellyfinMod S11 ordinary ' + crypto.randomBytes(3).toString('hex');
let ordinaryId = null;
let browser = null;
try {
    const created = await call('POST', '/Users/New', admin.token, { Name: userName });
    ordinaryId = JSON.parse(created.text).Id;
    const policy = JSON.parse((await call('GET', `/Users/${ordinaryId}`, admin.token)).text).Policy;
    record('Disposable ordinary user created, not an administrator', created.status === 200 && policy.IsAdministrator === false, { status: created.status, isAdministrator: policy.IsAdministrator });
    const ordinary = await signIn(userName);

    const bundleId = JSON.parse((await call('GET', '/JellyfinMod/Health', admin.token)).text).Web?.BundleId;
    const wrong = [];
    for (const [method, path, anonExpected, ordinaryExpected] of routes) {
        const body = ['POST', 'PATCH', 'PUT'].includes(method) ? {} : undefined;
        const anon = await call(method, path, null, body);
        const user = await call(method, path, ordinary.token, body);
        if (anon.status !== anonExpected || user.status !== ordinaryExpected) wrong.push({ route: `${method} ${path}`, anonymous: anon.status, ordinary: user.status });
    }
    record(`Every JellyfinMod route (${routes.length}): anonymous 401, ordinary user 403 on administrator routes and 200 on Health`, wrong.length === 0, wrong);

    const anonymousOk = [];
    for (const path of ['/JellyfinMod/Repository', `/web-mod/${bundleId}/jellyfinmod-web.json`, '/web-mod/']) anonymousOk.push([path, (await call('GET', path, null)).status]);
    record('Anonymous bundle and repository routes answer 200, as designed', anonymousOk.every(([, status]) => status === 200), anonymousOk);

    const traversalResults = [];
    for (const raw of traversal) {
        const path = raw.replace('{id}', bundleId);
        // fetch() normalizes dot segments; send the raw path through a request line of its own.
        const status = await new Promise(resolve => {
            import('node:http').then(http => {
                const request = http.request({ host: testUrl.hostname, port: testUrl.port, path, method: 'GET' }, response => { response.resume(); resolve(response.statusCode); });
                request.on('error', () => resolve('error'));
                request.end();
            });
        });
        traversalResults.push([raw, status]);
    }
    record('Served-bundle path traversal: every form is 404 (or 400)', traversalResults.every(([, status]) => status === 404 || status === 400), traversalResults);

    // Administrator reads, for the leak check.
    for (const [method, path] of routes) if (method === 'GET') await call(method, path, admin.token);
    const leaks = [];
    for (const { where, text } of bodies) {
        if (/sec_[A-Za-z0-9]/.test(text)) leaks.push({ where, rule: 'sec_ reference' });
        if (/api_?key=/i.test(text)) leaks.push({ where, rule: 'apikey=' });
        if (/"(password|apiKey|token|accessToken)"\s*:\s*"[^"]+"/i.test(text)) leaks.push({ where, rule: 'secret-named field with a value' });
        if (secretValues.some(value => text.includes(value))) leaks.push({ where, rule: 'a value held in the secret store' });
    }
    record(`Leak check over ${bodies.length} responses (anonymous, ordinary, administrator): no secret reference, key or value`, leaks.length === 0 && secretValues.length > 0, { leaks, secretValuesCompared: secretValues.length });

    // ---- The ordinary user in a real browser.
    browser = await chromium.launch(tier === 'chrome' ? { headless: true, channel: 'chrome' } : { headless: true });
    console.log('browser', tier, browser.version());
    for (const [layout, viewport] of [['desktop', { width: 1600, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
        const context = await browser.newContext({ viewport, isMobile: layout === 'mobile', hasTouch: layout === 'mobile' });
        const page = await context.newPage();
        const errors = [];
        const settingsRequests = [];
        page.on('pageerror', error => errors.push(String(error).slice(0, 200)));
        page.on('request', request => { if (/\/JellyfinMod\/(Settings|Setup)\//.test(request.url())) settingsRequests.push(new URL(request.url()).pathname); });
        await page.goto(origin + '/web/', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => /login|selectuser|selectserver|home/.test(location.hash), undefined, { timeout: 30000 });
        const field = page.locator('#txtManualName');
        if (!await field.isVisible().catch(() => false)) {
            const chooser = page.locator('.btnManual').first();
            if (await chooser.count()) await chooser.evaluate(node => node.click());
            await field.waitFor({ state: 'visible', timeout: 15000 });
        }
        await field.fill(userName);
        await page.waitForTimeout(1000);
        await field.fill(userName);
        await page.locator('button:visible').filter({ hasText: 'Sign In' }).first().click();
        await page.waitForFunction(() => location.hash.startsWith('#/home'), undefined, { timeout: 30000 });
        await page.waitForTimeout(3000);
        const meta = await page.evaluate(() => document.querySelector('meta[name="jellyfinmod-web"]')?.content ?? null);
        const banner = await page.locator('.jfmod-setupBanner, [class*="setupBanner"]').count();
        record(`[${layout}] Ordinary user signs in to the mod shell; Home shows no setup banner`, !!meta && banner === 0, { meta, banner });

        // The user menu: the last labelled button (the avatar) in the mod shell's app bar.
        let menuText = null;
        await page.locator('.MuiToolbar-root button[aria-label], .MuiToolbar-root .MuiAvatar-root').last().click();
        await page.locator('.MuiMenuItem-root:visible').first().waitFor({ state: 'visible', timeout: 10000 });
        await page.waitForTimeout(500);
        menuText = (await page.locator('.MuiMenuItem-root:visible').allInnerTexts()).map(text => text.trim());
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
        record(`[${layout}] The user menu offers neither JellyfinMod settings nor the Dashboard`, Array.isArray(menuText) && menuText.length > 0
            && !menuText.some(text => /JellyfinMod settings|Dashboard/i.test(text)), { menu: menuText });

        await page.evaluate(() => { location.hash = '#/catalog/settings'; });
        await page.waitForTimeout(3000);
        const settingsText = await page.evaluate(() => document.querySelector('.jfmod-lead')?.textContent ?? document.body.innerText.slice(0, 200));
        await page.evaluate(() => { location.hash = '#/catalog/settings/setup'; });
        await page.waitForTimeout(3000);
        const setupText = await page.evaluate(() => document.querySelector('.jfmod-lead')?.textContent ?? document.body.innerText.slice(0, 200));
        record(`[${layout}] The settings area and the setup wizard refuse the ordinary user`, /for administrators/i.test(settingsText) && /for administrators/i.test(setupText), { settingsText, setupText });
        record(`[${layout}] No settings or setup request was sent for the ordinary user; no page error`, settingsRequests.length === 0 && errors.length === 0, { settingsRequests, errors });
        await context.close();
    }
} finally {
    if (browser) await browser.close();
    if (ordinaryId) {
        const deleted = await call('DELETE', `/Users/${ordinaryId}`, admin.token);
        const after = await call('GET', `/Users/${ordinaryId}`, admin.token);
        const list = JSON.parse((await call('GET', '/Users', admin.token)).text).map(user => user.Name);
        const devices = JSON.parse((await call('GET', '/Devices', admin.token)).text).Items.filter(device => device.LastUserId === ordinaryId).length;
        record('The disposable user is deleted and gone (user, list, devices)', [200, 204].includes(deleted.status) && after.status === 404
            && !list.includes(userName) && devices === 0, { deleted: deleted.status, get: after.status, users: list.length, devices });
    }
    await call('POST', '/Sessions/Logout', admin.token);
}
const failures = results.filter(result => !result.ok).length;
console.log(`${results.length - failures} of ${results.length} passed on ${tier}`);
process.exit(failures ? 1 : 0);
