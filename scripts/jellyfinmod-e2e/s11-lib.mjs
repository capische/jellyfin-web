/* eslint-disable compat/compat, no-restricted-globals -- a Node acceptance runner, not shipped code */
/* global window, document, ApiClient, location, localStorage */
// Shared plumbing for the P7.S11 image runners (s11-fresh.mjs, s11-image.mjs), run against a disposable
// JellyfinMod container only.
//
//   JELLYFINMOD_S11_URL           the disposable container's address (never 8096, 18096 or 28096)
//   JELLYFINMOD_S11_ADMIN_FILE    0600 file with the throwaway administrator's generated password (never printed)
//   JELLYFINMOD_S11_FIXTURE_FILE  0600 env file with the stand-ins' generated fixture credentials (never printed)
//   JELLYFINMOD_S11_STANDIN       the stand-ins' address as the container sees it
//   JELLYFINMOD_S11_SSH           ssh alias of the test host, used only to drive the stand-ins' loopback control port
//   JELLYFINMOD_S11_OUT           JSON results file (appended per step; scrubbed of addresses and secrets)
//   JELLYFINMOD_BROWSER           chromium | chrome
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const required = name => process.env[name] ?? (() => { throw new Error(`${name} is required`); })();
export const origin = new URL(required('JELLYFINMOD_S11_URL'));
if (['8096', '18096', '28096'].includes(origin.port)) throw new Error('Runs only against a disposable image container');
export const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
export const standin = required('JELLYFINMOD_S11_STANDIN');
export const ADMIN = 'jfmod-image-admin';
const adminFile = required('JELLYFINMOD_S11_ADMIN_FILE');
export const fixture = Object.fromEntries(readFileSync(required('JELLYFINMOD_S11_FIXTURE_FILE'), 'utf8').split('\n')
    .filter(line => line.includes('=')).map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()]));
// Wrong credentials for the provoked failures: generated per run, never stored.
export const wrong = { token: 'eyWrong.' + Math.random().toString(36).slice(2) + Date.now(), key: 'f'.repeat(32), password: 'wrong-' + Date.now() };
const secretValues = () => [...Object.entries(fixture).filter(([name]) => name !== 'TX_USER').map(([, value]) => value), ...Object.values(wrong), readFileSync(adminFile, 'utf8').trim()].filter(value => value.length >= 8);

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
    const file = process.env.JELLYFINMOD_S11_OUT;
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

/** Signs in as the throwaway administrator through the login form; lands on Home. */
export async function signIn(page, path = '/web/') {
    const password = readFileSync(adminFile, 'utf8').trim();
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
    await field.fill(ADMIN);
    await page.locator('#txtManualPassword').fill(password);
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
    const ssh = required('JELLYFINMOD_S11_SSH');
    const args = body === undefined ? `curl -s 'http://127.0.0.1:38119${path}'`
        : `curl -s -X POST 'http://127.0.0.1:38119${path}' -d '${JSON.stringify(body).replace(/'/g, "'\\''")}'`;
    return JSON.parse(execFileSync('ssh', [ssh, args], { encoding: 'utf8' }));
}

/** Runs one shell command on the test host (fish there, so wrapped in bash). Output only, trimmed. */
export const onHost = command => execFileSync('ssh', [required('JELLYFINMOD_S11_SSH'), 'bash', '-s'], { input: command, encoding: 'utf8' }).trim();

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
