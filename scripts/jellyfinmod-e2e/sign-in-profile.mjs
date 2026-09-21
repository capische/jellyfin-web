/* eslint-disable compat/compat, @stylistic/max-statements-per-line, no-empty-function, sonarjs/cognitive-complexity, no-nested-ternary, sonarjs/no-nested-conditional, @typescript-eslint/no-unused-vars, sonarjs/no-dead-store, sonarjs/no-unused-vars, no-restricted-globals, @typescript-eslint/no-shadow, sonarjs/void-use, sonarjs/no-os-command-from-path, sonarjs/slow-regex -- a Node acceptance runner, not shipped code: the browserslist targets TV clients rather than this script, and the product lint profile does not fit a linear runner with page-side callbacks and deliberate no-op catch handlers */
/* global window, ApiClient */
// Signs the dedicated parity profile in to the isolated test server, once, so parity.mjs meets its own
// precondition ("an already-signed-in browser", PARITY.md §1.2) whichever tier it then launches.
//
// parity.mjs decides "am I signed in?" by reading location.hash immediately after window.ApiClient
// appears, which on a cold profile is a race the router has not finished losing yet; it then makes an
// authenticated call and fails with a bare "Response" (ApiClient.ajax rejects with the 401 Response).
// Pre-signing the profile removes the race instead of guessing a sleep.
//
//   JELLYFINMOD_TEST_URL=http://<host>:28096/ JELLYFINMOD_BROWSER=chrome node sign-in-profile.mjs
//
// The account is `oleksii` with an EMPTY password (workspace rule); nothing here stores a password.
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';

const testUrl = new URL(process.env.JELLYFINMOD_TEST_URL ?? (() => { throw new Error('JELLYFINMOD_TEST_URL is required'); })());
const ISOLATED_PORTS = ['18096', '28096'];
if (!ISOLATED_PORTS.includes(testUrl.port)) {
    throw new Error('Only the isolated instances on ports ' + ISOLATED_PORTS.join(' and ') + ' are allowed');
}
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
if (tier !== 'chromium' && tier !== 'chrome') throw new Error('JELLYFINMOD_BROWSER must be "chromium" or "chrome"');
const user = process.env.JELLYFINMOD_TEST_USER ?? 'oleksii';
const cacheRoot = process.platform === 'darwin' ?
    path.join(os.homedir(), 'Library', 'Caches') :
    (process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'));
const profileDir = process.env.JELLYFINMOD_CHROME_PROFILE_DIR
    ?? path.join(cacheRoot, 'jellyfinmod-e2e', 'parity-profile-' + tier);

const launchOptions = { headless: process.env.JELLYFINMOD_HEADED !== 'true' };
if (tier === 'chrome') launchOptions.channel = 'chrome';
const context = await chromium.launchPersistentContext(profileDir, launchOptions);
const page = context.pages()[0] ?? await context.newPage();
page.setDefaultTimeout(30000);
try {
    await page.goto(new URL('/web/', testUrl).href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.ApiClient, undefined, { timeout: 30000 });
    // Wait for the router to settle on either the login screen or a signed-in page, rather than reading
    // the hash the instant ApiClient appears.
    await page.waitForFunction(() => {
        try {
            return !!ApiClient.getCurrentUserId() || location.hash.includes('/login') || location.hash.includes('/selectuser');
        } catch { return location.hash.includes('/login') || location.hash.includes('/selectuser'); }
    }, undefined, { timeout: 30000 });
    if (!await page.evaluate(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } })) {
        const field = page.locator('#txtManualName');
        if (!await field.isVisible().catch(() => false)) {
            const chooser = page.locator('.btnManual').first();
            if (await chooser.count()) {
                await chooser.waitFor({ state: 'attached', timeout: 15000 });
                await chooser.evaluate(node => node.click());
            }
            await field.waitFor({ state: 'visible', timeout: 15000 });
        }
        await field.fill(user);
        // The password field stays empty on purpose; this account has no password.
        await page.locator('button:visible').filter({ hasText: 'Sign In' }).first().click();
        await page.waitForFunction(() => {
            try { return !!ApiClient.getCurrentUserId(); } catch { return false; }
        }, undefined, { timeout: 30000 });
    }
    const signedIn = await page.evaluate(() => !!ApiClient.getCurrentUserId());
    console.log('profile ' + profileDir + ' signed in: ' + signedIn);
    if (!signedIn) process.exitCode = 1;
} finally {
    await context.close();
}
/* eslint-enable compat/compat, @stylistic/max-statements-per-line, no-empty-function, sonarjs/cognitive-complexity, no-nested-ternary, sonarjs/no-nested-conditional, @typescript-eslint/no-unused-vars, sonarjs/no-dead-store, sonarjs/no-unused-vars, no-restricted-globals, @typescript-eslint/no-shadow, sonarjs/void-use, sonarjs/no-os-command-from-path, sonarjs/slow-regex -- closes the file-level exemption above */
