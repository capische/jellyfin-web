/* eslint-disable compat/compat, sonarjs/cognitive-complexity, no-await-in-loop -- a Node live runner, not shipped code */
// Phase 13 layout matrix: Settings › Trakt and the administrator's Home notice on desktop (Dark and Light), phone 390 px,
// TV 1920×1080 and TV 1280×720 (D-pad, Enter, Back), in Playwright's Chromium or Google Chrome (P13_BROWSER=chrome). It
// puts the environment in two states through the Trakt stand-in and the stock plugin's own API: "reconnect needed"
// (a short-lived token whose refresh is rejected) and back to "linked". Same environment rules as trakt-export.mjs.
//
//   P13_ENV=echo P13_OUT=<dir> [P13_BROWSER=chrome] [P13_LAYOUTS=tv1080,tv720] node scripts/jellyfinmod-e2e/trakt-export-matrix.mjs
// P13_LAYOUTS runs only the named layouts (desktop, mobile, tv1080, tv720); all by default.
// The environment is proven first, as for trakt-export.mjs (trakt-export-env.mjs).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { verifiedEnv } from './trakt-export-env.mjs';

const { origin, controlUrl } = await verifiedEnv();
const tier = process.env.P13_BROWSER ?? 'chromium';
const out = join(process.env.P13_OUT ?? 'p13-out', tier);
mkdirSync(out, { recursive: true });

const LAYOUTS = {
    desktop: { viewport: { width: 1440, height: 900 } },
    mobile: {
        viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
    },
    tv1080: { viewport: { width: 1920, height: 1080 }, tv: true },
    tv720: { viewport: { width: 1280, height: 720 }, tv: true }
};
const only = process.env.P13_LAYOUTS?.split(',').map(name => name.trim()).filter(Boolean);
const RUNS = [['desktop', 'dark'], ['desktop', 'light'], ['mobile', 'dark'], ['mobile', 'light'], ['tv1080', 'dark'], ['tv720', 'dark']]
    .filter(([layout]) => !only?.length || only.includes(layout));

const results = [];
const verify = (where, check, ok, detail = '') => {
    results.push({ where, check, verdict: ok ? 'PASS' : 'FAIL', detail });
    console.log(`${ok ? 'PASS' : 'FAIL'} [${tier}/${where}] ${check}${detail ? ' :: ' + detail : ''}`);
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

let token = null;
const authHeader = () => `MediaBrowser Client="JellyfinMod P13", Device="p13-matrix", DeviceId="p13-matrix", Version="1"${token ? `, Token="${token}"` : ''}`;
async function jf(method, path, body) {
    const response = await fetch(origin + path, { method, headers: { 'Content-Type': 'application/json', Authorization: authHeader() }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    return text && response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : null;
}
const control = async (path, body) => (await fetch(controlUrl + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })).json();
async function until(label, check, timeout = 300000, every = 3000) {
    const start = Date.now();
    for (;;) {
        const value = await check();
        if (value) return value;
        if (Date.now() - start > timeout) throw new Error(`timed out waiting for ${label}`);
        await sleep(every);
    }
}
let userId;
async function authorize(tokenSeconds) {
    await control('/mode', { tokenSeconds });
    await jf('POST', `/Trakt/Users/${userId}/Authorize`);
    await control('/approve', {});
    await until('Trakt authorized', async () => (await jf('GET', `/Trakt/Users/${userId}/PollAuthorizationStatus`))?.isAuthorized === true, 30000, 1000);
}

async function open(browser, layout, theme, hash) {
    const { tv, ...options } = LAYOUTS[layout];
    const context = await browser.newContext(options);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error.message).split('\n')[0]));
    await page.goto(origin + '/web/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.ApiClient, undefined, { timeout: 30000 });
    if (tv) {
        await page.evaluate(() => localStorage.setItem('layout', 'tv'));
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.ApiClient, undefined, { timeout: 30000 });
    }
    await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId() || /login|selectuser|selectserver/.test(location.hash); } catch { return false; } }, undefined, { timeout: 30000 });
    if (!await page.evaluate(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } })) {
        const field = page.locator('#txtManualName');
        if (!await field.isVisible().catch(() => false)) {
            const chooser = page.locator('.btnManual').first();
            if (await chooser.count()) await chooser.evaluate(node => node.click());
            await field.waitFor({ state: 'visible', timeout: 15000 });
        }
        await field.fill('oleksii');
        await page.waitForTimeout(1200);
        await field.fill('oleksii');
        await page.locator('button:visible').filter({ hasText: 'Sign In' }).first().click();
        await page.waitForFunction(() => location.hash.startsWith('#/home'), undefined, { timeout: 30000 });
    }
    await page.evaluate(next => { location.hash = next; }, hash);
    await page.waitForSelector(hash.includes('settings') ? '.jfmod-check-section[data-section="trakt"]' : '.jfmod-homeHero', { timeout: 30000 });
    await page.waitForTimeout(2500);
    if (theme !== 'dark') await page.evaluate(id => document.documentElement.setAttribute('data-theme', id), theme);
    await page.waitForTimeout(400);
    return { context, page, errors };
}

/** Geometry and contrast of the section: no sideways scroll, every button at least 36 px tall, readable body text. */
const audit = page => page.evaluate(() => {
    const section = document.querySelector('.jfmod-check-section[data-section="trakt"]');
    const rgb = value => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const alpha = value => { const parts = value.match(/[\d.]+/g) ?? []; return parts.length > 3 ? Number(parts[3]) : 1; };
    const lum = ([r, g, b]) => [r, g, b].map(c => c / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
    // The background the text sits on: translucent layers (a notice's tint) composited over the first opaque ancestor.
    const backgroundOf = element => {
        const layers = [];
        for (let node = element; node; node = node.parentElement) {
            const colour = getComputedStyle(node).backgroundColor;
            if (colour === 'transparent' || alpha(colour) === 0) continue;
            layers.push(colour);
            if (alpha(colour) >= 1) break;
        }
        let base = layers.length && alpha(layers.at(-1)) >= 1 ? rgb(layers.pop()) : [16, 16, 16];
        for (const layer of layers.reverse()) {
            const a = alpha(layer);
            base = rgb(layer).map((c, i) => (c * a) + (base[i] * (1 - a)));
        }
        return base;
    };
    const ratio = element => {
        const a = lum(rgb(getComputedStyle(element).color));
        const b = lum(backgroundOf(element));
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    const texts = [...section.querySelectorAll('h2, strong, .jfmod-sub, .fieldDescription, .jfmod-notice-text, .MuiFormControlLabel-label, .jfmod-traktHandle, .jfmod-traktLine, .jfmod-traktDay, .jfmod-activityTitle, .jfmod-activityCount')].filter(node => node.offsetParent);
    // The section's buttons and round icons; the Activity disclosure is a group title (its own guide), measured apart.
    const buttons = [...section.querySelectorAll('button, a.MuiButton-root')].filter(node => node.offsetParent && !node.closest('.jfmod-check-secfoot') &&
        !node.classList.contains('jfmod-activityToggle'));
    const toggle = section.querySelector('.jfmod-activityToggle');
    return {
        overflow: document.scrollingElement.scrollWidth - window.innerWidth,
        buttons: buttons.map(node => ({ text: node.getAttribute('aria-label') || node.textContent.trim(), height: Math.round(node.getBoundingClientRect().height) })),
        toggle: toggle ? Math.round(toggle.getBoundingClientRect().height) : null,
        weakest: Math.min(...texts.map(ratio)),
        weakestText: texts.map(node => ({ node, value: ratio(node) })).sort((a, b) => a.value - b.value).slice(0, 1)
            .map(({ node, value }) => `${node.className || node.tagName} "${node.textContent.trim().slice(0, 40)}" ${value.toFixed(2)}`)[0] ?? '',
        text: section.innerText
    };
});

/** The webOS remote's Back key (keyCode 461), as episode-retention.mjs sends it. */
async function pressRemoteBack(page) {
    const client = await page.context().newCDPSession(page);
    try {
        for (const type of ['rawKeyDown', 'keyUp']) {
            await client.send('Input.dispatchKeyEvent', { type, windowsVirtualKeyCode: 461, nativeVirtualKeyCode: 461, key: 'GoBack', code: '' });
        }
    } finally {
        await client.detach();
    }
}

/**
 * The remote's OK (Enter) toggles the automatic-export switch and saves it (Codex review of the simplified build, P2), and
 * Space does too; while the change is saved the switch keeps the focus (P3). Each press flips the setting, so two presses
 * leave it as it was.
 */
async function tvToggle(page, where, key) {
    const before = (await jf('GET', '/JellyfinMod/Trakt/Export')).autoExport;
    await page.evaluate(() => document.querySelector('[data-jfmod-trakt="auto"] input[type="checkbox"]')?.focus());
    await page.keyboard.press(key);
    await page.waitForTimeout(150);
    const focusedWhileSaving = await page.evaluate(() => document.activeElement?.matches('[data-jfmod-trakt="auto"] input[type="checkbox"]') ?? false);
    const saved = await until(`the switch saved by ${key}`, async () => (await jf('GET', '/JellyfinMod/Trakt/Export')).autoExport !== before, 8000, 500).catch(() => false);
    await page.waitForTimeout(800);
    const focusedAfter = await page.evaluate(() => document.activeElement?.matches('[data-jfmod-trakt="auto"] input[type="checkbox"]') ?? false);
    verify(where, `${key} on the switch changes the server setting`, !!saved, `autoExport ${before} -> ${(await jf('GET', '/JellyfinMod/Trakt/Export')).autoExport}`);
    verify(where, `the switch keeps the focus while ${key} saves it`, focusedWhileSaving && focusedAfter, `${focusedWhileSaving}, ${focusedAfter}`);
}

/**
 * A held OK: the remote repeats its keydown for as long as it is held, here 2 s, well past the first save. Exactly one
 * change reaches the server (Codex re-review, P2); one more press puts the setting back.
 */
async function tvHold(page, where) {
    const before = (await jf('GET', '/JellyfinMod/Trakt/Export')).autoExport;
    await page.evaluate(() => document.querySelector('[data-jfmod-trakt="auto"] input[type="checkbox"]')?.focus());
    const client = await page.context().newCDPSession(page);
    const enter = { windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, key: 'Enter', code: 'Enter' };
    const seen = [];
    try {
        await client.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...enter });
        for (let tick = 0; tick < 20; tick++) {
            await sleep(100);
            await client.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', autoRepeat: true, ...enter });
            seen.push((await jf('GET', '/JellyfinMod/Trakt/Export')).autoExport);
        }
        await client.send('Input.dispatchKeyEvent', { type: 'keyUp', ...enter });
    } finally {
        await client.detach();
    }
    await sleep(1500);
    const after = (await jf('GET', '/JellyfinMod/Trakt/Export')).autoExport;
    const changes = [before, ...seen, after].filter((value, index, all) => index > 0 && value !== all[index - 1]).length;
    verify(where, 'a held OK changes the switch exactly once', after !== before && changes === 1, `${before} -> ${seen.join(',')} -> ${after}`);
    await page.keyboard.press('Enter');
    await until('the setting put back', async () => (await jf('GET', '/JellyfinMod/Trakt/Export')).autoExport === before, 8000, 500).catch(() => false);
}

/** The account row on any layout: avatar, "oleksii · <username> on Trakt", the round Disconnect, and where it sits. */
const accountRow = page => page.evaluate(() => {
    const row = document.querySelector('[data-jfmod-trakt-user="oleksii"]');
    if (!row) return null;
    const box = node => node?.getBoundingClientRect();
    const icon = row.querySelector('[data-jfmod-trakt-disconnect="oleksii"]');
    const title = row.querySelector('strong');
    const avatar = row.querySelector('.jfmod-traktAvatar');
    return {
        title: title?.textContent ?? '', avatar: avatar?.tagName ?? '', iconLabel: icon?.getAttribute('aria-label') ?? '',
        icon: { top: Math.round(box(icon).top), bottom: Math.round(box(icon).bottom), right: Math.round(box(icon).right), size: Math.round(box(icon).height) },
        titleBottom: Math.round(box(title).bottom), rowRight: Math.round(box(row).right), avatarSize: Math.round(box(avatar).height),
        red: getComputedStyle(icon).backgroundColor
    };
});

/** Opens Activity with the pointer or the remote, checks it, screenshots it and closes it again. */
async function openActivity(page, where, file, remote) {
    if (remote) {
        await page.evaluate(() => document.querySelector('.jfmod-activityToggle')?.focus());
        await page.keyboard.press('Enter');
    } else {
        await page.locator('.jfmod-activityToggle').click();
        await page.mouse.move(2, 2);
    }
    await page.waitForTimeout(500);
    const open = await page.evaluate(() => ({
        expanded: document.querySelector('.jfmod-activityToggle')?.getAttribute('aria-expanded'),
        runs: document.querySelectorAll('[data-jfmod-trakt="activity"] .jfmod-scrolllist .jfmod-traktItem').length,
        overflow: document.scrollingElement.scrollWidth - window.innerWidth
    }));
    verify(where, 'Activity opens and lists the titles', open.expanded === 'true' && open.runs > 0 && open.overflow <= 1, JSON.stringify(open));
    const geometry = await audit(page);
    verify(where, 'Activity text keeps 4.5:1', geometry.weakest >= 4.5, geometry.weakestText);
    await page.evaluate(() => document.querySelector('[data-jfmod-trakt="activity"]')?.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(out, file) });
    return open;
}

/** TV: OK on Disconnect opens the confirmation on Cancel; Right reaches Disconnect, Left comes back; Back closes it. */
async function tvDisconnect(page, where) {
    // The section's actions wait while a change of the switch is saved (the previous check's last press).
    await page.waitForFunction(() => document.querySelector('[data-jfmod-trakt-disconnect="oleksii"]')?.getAttribute('aria-disabled') !== 'true', undefined, { timeout: 10000 });
    await page.evaluate(() => document.querySelector('[data-jfmod-trakt-disconnect="oleksii"]')?.focus());
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-jfmod-confirm]', { timeout: 8000 }).catch(() => null);
    await page.waitForTimeout(500);
    const first = await page.evaluate(() => document.activeElement?.getAttribute('data-jfmod-confirm') ?? '');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(250);
    const right = await page.evaluate(() => document.activeElement?.getAttribute('data-jfmod-confirm') ?? '');
    await page.screenshot({ path: join(out, `tv-confirm-${where.replace(/\//g, '-')}.png`) });
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(250);
    const left = await page.evaluate(() => document.activeElement?.getAttribute('data-jfmod-confirm') ?? '');
    verify(where, 'OK on Disconnect opens the confirmation on Cancel; Right reaches Disconnect, Left comes back', first === 'cancel' && right === 'confirm' && left === 'cancel', `${first} → ${right} → ${left}`);
    await pressRemoteBack(page);
    await page.waitForTimeout(800);
    const after = await page.evaluate(() => ({
        open: !!document.querySelector('[data-jfmod-confirm]'),
        focus: document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName
    }));
    const still = (await jf('GET', '/JellyfinMod/Trakt/Export')).users.some(user => user.name === 'oleksii');
    verify(where, 'Back closes it, nothing is disconnected, focus returns to Disconnect', !after.open && still && after.focus === 'Disconnect Trakt for oleksii', JSON.stringify(after));
}

/** TV: OK on the Activity header opens it; Down reaches the list, whose arrows scroll it; OK on the header closes it. */
async function tvActivity(page, where) {
    await openActivity(page, where, `tv-activity-${where.replace(/\//g, '-')}.png`, true);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(300);
    const list = await page.evaluate(() => {
        const active = document.activeElement;
        return { region: active?.getAttribute('role') === 'region' && !!active.closest('[data-jfmod-trakt="activity"]'), top: active?.scrollTop ?? -1,
            room: active ? active.scrollHeight - active.clientHeight : 0 };
    });
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(300);
    const scrolled = await page.evaluate(() => document.activeElement?.scrollTop ?? -1);
    verify(where, 'Down reaches the run list, and its arrows scroll it', list.region && (list.room <= 1 || scrolled > list.top), JSON.stringify({ ...list, scrolled }));
    await page.evaluate(() => document.querySelector('.jfmod-activityToggle')?.focus());
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    verify(where, 'OK on the header closes Activity', await page.evaluate(() => document.querySelector('.jfmod-activityToggle')?.getAttribute('aria-expanded')) === 'false');
}

async function tvWalk(page) {
    // From the section's heading, Down walks the section's stops in order; the switch, Sync Now and (when shown)
    // Reconnect Trakt must each take the focus, then Back leaves the settings page.
    await page.evaluate(() => document.querySelector('.jfmod-check-section[data-section="trakt"] h2')?.focus());
    const seen = [];
    for (let step = 0; step < 14; step++) {
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(250);
        const label = await page.evaluate(() => {
            const active = document.activeElement;
            if (!active?.closest('.jfmod-check-section[data-section="trakt"]')) return null;
            if (active.type === 'checkbox') return 'switch';
            if (active.classList.contains('jfmod-activityToggle')) return 'Activity';
            return active.getAttribute('aria-label') || active.textContent.trim();
        });
        if (label && !seen.includes(label)) seen.push(label);
    }
    return seen;
}

const browser = await chromium.launch(tier === 'chrome' ? { headless: true, channel: 'chrome' } : { headless: true });
console.log('browser', tier, browser.version());
try {
    const signedIn = await fetch(origin + '/Users/AuthenticateByName', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: authHeader() }, body: JSON.stringify({ Username: 'oleksii', Pw: '' }) }).then(r => r.json());
    token = signedIn.AccessToken;
    userId = signedIn.User.Id;

    for (const state of ['reconnect', 'linked']) {
        if (state === 'reconnect') {
            await authorize(60);
            await control('/mode', { rejectRefresh: true });
            await sleep(50000);
            await jf('POST', '/JellyfinMod/Trakt/Export');
            await until('reconnect needed', async () => {
                const now = await jf('GET', '/JellyfinMod/Trakt/Export');
                return !now.running && now.users.some(user => user.state === 'reconnect');
            });
        } else {
            await control('/mode', { rejectRefresh: false });
            await authorize(7776000);
            await until('linked', async () => (await jf('GET', '/JellyfinMod/Trakt/Export')).users.every(user => user.state === 'linked'));
        }
        // A new link makes the server read the Trakt profile again (within a minute at the real pace).
        await until('the Trakt profile', async () => !!(await jf('GET', '/JellyfinMod/Trakt/Export')).users[0]?.avatarUrl, 180000, 3000);
        for (const [layout, theme] of RUNS) {
            const where = `${state}/${layout}/${theme}`;
            const { context, page, errors } = await open(browser, layout, theme, '#/catalog/settings?section=trakt');
            try {
                await page.screenshot({ path: join(out, `settings-${state}-${layout}-${theme}.png`), fullPage: layout === 'mobile' });
                const geometry = await audit(page);
                verify(where, 'no sideways scroll', geometry.overflow <= 1, `${geometry.overflow} px`);
                // The settings area's own buttons (Missing Episodes' Sync Now, Save) measure 35 px on a computer, 34 on the phone.
                verify(where, 'section buttons the settings area\'s size (34 px or more)', geometry.buttons.every(button => button.height >= 34), JSON.stringify(geometry.buttons));
                verify(where, 'section text keeps 4.5:1', geometry.weakest >= 4.5, geometry.weakestText);
                verify(where, 'the Activity header is a target of 24 px or more', (geometry.toggle ?? 0) >= 24, `${geometry.toggle} px`);
                verify(where, state === 'reconnect' ? 'Reconnect needed with Reconnect Trakt' : 'linked account, no reconnect notice',
                    state === 'reconnect' ? /Trakt gets nothing from oleksii/.test(geometry.text) && geometry.buttons.some(button => button.text === 'Reconnect Trakt') :
                        /Linked/.test(geometry.text) && !/Trakt gets nothing/.test(geometry.text));
                const row = await accountRow(page);
                verify(where, 'the account row: avatar, "oleksii · p13-standin on Trakt", a round red Disconnect of 40 px or more',
                    !!row && row.avatar === 'IMG' && row.title === 'oleksii · p13-standin on Trakt' && row.iconLabel === 'Disconnect Trakt for oleksii' && row.icon.size >= 40 &&
                        row.red === 'rgb(198, 40, 40)', JSON.stringify(row));
                if (layout === 'mobile') {
                    verify(where, 'phone: Disconnect goes under the text at the right', !!row && row.icon.top >= row.titleBottom && row.rowRight - row.icon.right <= 2, JSON.stringify(row?.icon));
                }
                if (!LAYOUTS[layout].tv && state === 'linked') await openActivity(page, where, `activity-${layout}-${theme}.png`, false);
                if (LAYOUTS[layout].tv) {
                    const walk = await tvWalk(page);
                    const wanted = ['switch', 'Sync Missing Watches Now', ...(state === 'reconnect' ? ['Reconnect Trakt'] : []), 'Disconnect Trakt for oleksii', 'Activity'];
                    verify(where, 'D-pad Down reaches every stop of the section', wanted.every(stop => walk.includes(stop)), walk.join(' → '));
                    if (state === 'linked') {
                        await tvToggle(page, where, 'Enter');
                        await tvToggle(page, where, 'Space');
                        await tvHold(page, where);
                        await tvDisconnect(page, where);
                        await tvActivity(page, where);
                    }
                    const before = await page.evaluate(() => location.hash);
                    await pressRemoteBack(page);
                    await page.waitForTimeout(1500);
                    verify(where, 'Back leaves the Trakt section', await page.evaluate(() => location.hash) !== before);
                }
                verify(where, 'no page error', errors.length === 0, errors.join(' | '));
            } finally {
                await context.close();
            }
            if (theme === 'dark') {
                const home = await open(browser, layout, theme, '#/home');
                try {
                    await home.page.evaluate(() => document.querySelector('.jfmod-traktNoticeMount')?.scrollIntoView({ block: 'center' }));
                    await home.page.waitForTimeout(600);
                    await home.page.screenshot({ path: join(out, `home-${state}-${layout}.png`) });
                    const notice = await home.page.evaluate(() => {
                        const node = document.querySelector('.jfmod-traktNoticeMount .jfmod-notice');
                        return node ? { text: node.innerText, overflow: document.scrollingElement.scrollWidth - window.innerWidth } : null;
                    });
                    verify(where, state === 'reconnect' ? 'Home notice shown under the hero' : 'no Home notice', state === 'reconnect' ? !!notice && /Trakt stopped receiving/.test(notice.text) && notice.overflow <= 1 : !notice,
                        notice ? notice.text.replace(/\n/g, ' ').slice(0, 90) : 'none');
                } finally {
                    await home.context.close();
                }
            }
        }
    }
} finally {
    await browser.close();
    writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 1));
    const failed = results.filter(entry => entry.verdict !== 'PASS');
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    process.exitCode = failed.length ? 1 : 0;
}
