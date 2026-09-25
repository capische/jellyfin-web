/* eslint-disable compat/compat, no-restricted-globals -- a Node acceptance runner, not shipped code */
/* global window, document, ApiClient, location, localStorage */
// Shared plumbing for the live acceptance runners (live-*.mjs) of Phases 4-6, run against the dedicated live acceptance
// instance only (standins/live-env.sh). Signs in as oleksii with an empty password.
//
//   JELLYFINMOD_LIVE_URL          the live instance's address (never 8096, 18096, 28096 or 38096)
//   JELLYFINMOD_LIVE_FIXTURE_FILE 0600 env file with the stand-ins' generated fixture credentials (never printed)
//   JELLYFINMOD_LIVE_SSH          ssh alias of the test host, used to drive the stand-ins' loopback control port
//   JELLYFINMOD_LIVE_OUT          JSON results file (appended per step; scrubbed of addresses and secrets)
//   JELLYFINMOD_BROWSER           chromium | chrome
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const required = name => process.env[name] ?? (() => { throw new Error(`${name} is required`); })();
export const origin = new URL(required('JELLYFINMOD_LIVE_URL'));
if (['8096', '18096', '28096', '38096'].includes(origin.port)) throw new Error('Runs only against the live acceptance instance');
export const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
export const portBase = 48110;
export const USER = 'oleksii';
export const fixture = Object.fromEntries(readFileSync(required('JELLYFINMOD_LIVE_FIXTURE_FILE'), 'utf8').split('\n')
    .filter(line => line.includes('=')).map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()]));
const secretValues = () => Object.entries(fixture).filter(([name]) => name !== 'TX_USER').map(([, value]) => value).filter(value => value.length >= 8);

export const LAYOUTS = {
    desktop: { viewport: { width: 1440, height: 900 } },
    mobile: {
        viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
    },
    tv1080: { viewport: { width: 1920, height: 1080 }, tv: true },
    tv720: { viewport: { width: 1280, height: 720 }, tv: true }
};

/** Removes the host address, container addresses, host paths and every known secret value from a detail. */
export const scrub = value => {
    let text = typeof value === 'string' ? value : JSON.stringify(value);
    if (text === undefined) return undefined;
    for (const secret of secretValues()) text = text.split(secret).join('<secret>');
    text = text.split(origin.host).join('<host>').split(origin.hostname).join('<host>');
    text = text.replace(/\b(?:10|127|172\.(?:1[6-9]|2\d|3[01])|192\.168)(?:\.\d{1,3}){2,3}\b/g, '<private-ip>');
    text = text.replace(/\/(?:mnt|home|Users|private)\/[^\s"',)]+/g, '<host-path>');
    return typeof value === 'string' ? text : JSON.parse(text);
};

export const results = [];
export const record = (step, check, verdict, detail) => {
    const normalised = verdict === true ? 'PASS' : verdict === false ? 'FAIL' : verdict;
    const clean = detail === undefined ? undefined : scrub(detail);
    results.push({ step, check, verdict: normalised, detail: clean });
    console.log(`${normalised} [${tier}] ${step}: ${check}${clean === undefined ? '' : ' :: ' + JSON.stringify(clean).slice(0, 600)}`);
};
/** A wait that runs out is NOT VERIFIED, never a pass. */
export const notVerified = (step, check, error) => record(step, check, 'NOT VERIFIED', String(error?.message ?? error).split('\n')[0]);

export const saveResults = (step, browserVersion) => {
    const file = process.env.JELLYFINMOD_LIVE_OUT;
    if (!file) return;
    const all = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { browser: tier, version: browserVersion, runs: [] };
    all.runs.push({ step, at: new Date().toISOString(), results: results.splice(0) });
    writeFileSync(file, JSON.stringify(all, null, 1) + '\n');
};

export const launch = () => chromium.launch(tier === 'chrome' ? { headless: true, channel: 'chrome' } : { headless: true });

export async function newPage(browser, layoutName = 'desktop', options = {}) {
    const layout = LAYOUTS[layoutName];
    const context = await browser.newContext({ viewport: layout.viewport, isMobile: layout.isMobile, hasTouch: layout.hasTouch,
        userAgent: layout.userAgent, serviceWorkers: 'block', ...options });
    const page = await context.newPage();
    page.jfmodErrors = [];
    page.on('pageerror', error => page.jfmodErrors.push(String(error.message).split('\n')[0]));
    return { context, page };
}

export const base = (path = '/web/') => new URL(path, origin).href;

/** Signs in as oleksii with an empty password through the login form; lands on Home. */
export async function signIn(page, path = '/web/', user = USER) {
    await page.goto(base(path), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.ApiClient, undefined, { timeout: 30000 });
    await page.waitForFunction(() => {
        try { return !!ApiClient.getCurrentUserId() || /login|selectuser|selectserver/.test(location.hash); } catch { return false; }
    }, undefined, { timeout: 30000 });
    if (await page.evaluate(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } })) return;
    const field = page.locator('#txtManualName');
    if (!await field.isVisible().catch(() => false)) {
        const chooser = page.locator('.btnManual').first();
        await chooser.waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
        if (await chooser.count()) await chooser.evaluate(node => node.click());
        await field.waitFor({ state: 'visible', timeout: 15000 });
    }
    await page.waitForTimeout(1000);
    await field.fill(user);
    await page.locator('#txtManualPassword').fill('');
    await page.locator('button:visible').filter({ hasText: 'Sign In' }).first().click();
    await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } }, undefined, { timeout: 30000 });
    await page.waitForFunction(() => location.hash.startsWith('#/home'), undefined, { timeout: 30000 });
    await page.waitForTimeout(1500);
}

export async function setTvLayout(page) {
    await page.evaluate(() => localStorage.setItem('layout', 'tv'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } }, undefined, { timeout: 30000 });
    await page.waitForTimeout(2500);
}

/** A request through the signed-in page's own client: real HTTP, the real session. Returns status and body. */
export const api = (page, method, path, body) => page.evaluate(async ({ method, path, body }) => {
    const response = await fetch(ApiClient.getUrl(path), {
        method, headers: { Authorization: `MediaBrowser Token="${ApiClient.accessToken()}"`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    let parsed = text;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    return { status: response.status, body: parsed, text };
}, { method, path, body });

/** True when any known secret value appears in the text. Only a boolean ever leaves this function. */
export const carriesSecret = text => secretValues().some(secret => String(text).includes(secret));

/** Drives the stand-ins' loopback control port on the test host. Returns parsed JSON. */
export function control(path, body) {
    const ssh = required('JELLYFINMOD_LIVE_SSH');
    const args = body === undefined ? `curl -s 'http://127.0.0.1:${portBase + 9}${path}'`
        : `curl -s -X POST 'http://127.0.0.1:${portBase + 9}${path}' -d '${JSON.stringify(body).replace(/'/g, "'\\''")}'`;
    return JSON.parse(execFileSync('ssh', [ssh, args], { encoding: 'utf8' }));
}

/** Runs one shell command on the test host (fish there, so wrapped in bash). Output only, trimmed. */
export const onHost = command => execFileSync('ssh', [required('JELLYFINMOD_LIVE_SSH'), 'bash', '-s'], { input: command, encoding: 'utf8' }).trim();

/** Polls a function until it returns a truthy value or the timeout passes; returns the last value or throws. */
export async function until(check, { timeout = 60000, every = 2000, label = 'condition' } = {}) {
    const deadline = Date.now() + timeout;
    let last;
    while (Date.now() < deadline) {
        last = await check();
        if (last) return last;
        await new Promise(resolve => setTimeout(resolve, every));
    }
    throw new Error(`timed out after ${timeout / 1000}s waiting for ${label}`);
}
