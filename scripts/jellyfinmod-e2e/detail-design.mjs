/* eslint-disable compat/compat, no-restricted-globals, sonarjs/cognitive-complexity, @stylistic/max-statements-per-line, no-empty-function -- a Node acceptance runner, not shipped code */
/* global window, document, ApiClient, localStorage, location, getComputedStyle */
// Detail page design fix acceptance (fix/detail-page-design, 2026-10-07; docs/jellyfinmod/design/episode-page-design-spec.md,
// "Acceptance checklist and evidence"). Every layout: desktop, mobile, TV 1920×1080 and 1280×720 (layout=tv, arrow keys,
// Enter and Back only), signed in as oleksii with an empty password, optionally also as an ordinary user.
//
//   JELLYFINMOD_TEST_URL=http://<host>:18096/ [JELLYFINMOD_BROWSER=chromium|chrome] [JELLYFINMOD_LAYOUTS=desktop,mobile,tv1080,tv720]
//   [JELLYFINMOD_WEB_PATH=/web-mod/]   fixtures: scripts/jellyfinmod-e2e/detail-live.py on the Pi (`ids` prints the ids below)
//   JELLYFINMOD_DD_ONE=<item id of an episode with one file>
//   JELLYFINMOD_DD_TWO=<item id of an episode with two files>
//   JELLYFINMOD_DD_MOVIE=<item id of a movie with a file>
//   JELLYFINMOD_DD_FILELESS=<entry id of a file-less movie>
//   [JELLYFINMOD_DD_GRABBED=<entry id of a file-less movie whose grab is in flight (stand-in client)>]
//   [JELLYFINMOD_DD_BADGE=<item id>:<expected badge text>[,<item id>:<text>...]]   e.g. watched episode with a fast window
//   [JELLYFINMOD_DD_USER=<ordinary user name, empty password>]
//   [JELLYFINMOD_DD_PIN=1]          pin the one-file episode's file, read it back from the plugin, unpin it again
//   [JELLYFINMOD_DD_REMOVE=<item id of a disposable two-file episode>]   remove one copy through the cross, confirmed
//   [JELLYFINMOD_DD_WINDOW=1]       change the one-file episode's window through the More menu dialog and restore it
//
// Read-only unless one of the flags above asks for a change; every change is undone, except the disposable removal.
import { chromium } from 'playwright';

const origin = new URL(process.env.JELLYFINMOD_TEST_URL ?? (() => { throw new Error('JELLYFINMOD_TEST_URL is required'); })());
if (origin.port !== '18096') throw new Error('Runs on the isolated instance 18096 only');
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
const env = name => process.env[name] || null;
const ids = { one: env('JELLYFINMOD_DD_ONE'), two: env('JELLYFINMOD_DD_TWO'), movie: env('JELLYFINMOD_DD_MOVIE'),
    fileless: env('JELLYFINMOD_DD_FILELESS'), grabbed: env('JELLYFINMOD_DD_GRABBED') };
const badges = (env('JELLYFINMOD_DD_BADGE') ?? '').split(',').filter(Boolean).map(pair => {
    const [id, text] = pair.split(':');
    return { id, text };
});
// The mod interface: /web/ where the plugin has taken over the host's web root, /web-mod/ where it serves it beside stock
// (18096's web root is read-only, so its Health reports the takeover as readOnly).
const WEB_PATH = process.env.JELLYFINMOD_WEB_PATH ?? '/web-mod/';
const base = (path = WEB_PATH) => new URL(path, origin).href;
const LAYOUTS = {
    desktop: { viewport: { width: 1440, height: 900 } },
    mobile: {
        viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
    },
    tv1080: { viewport: { width: 1920, height: 1080 }, tv: true },
    tv720: { viewport: { width: 1280, height: 720 }, tv: true }
};

/** A report label (`tv1080/user`) names the layout it ran in (`tv1080`). */
const layoutOf = label => label.split('/')[0];
const isTv = label => !!LAYOUTS[layoutOf(label)].tv;
const isMobile = label => layoutOf(label) === 'mobile';

const results = [];
const record = (layout, check, verdict, detail = '') => {
    let word = verdict;
    if (verdict === true) word = 'PASS';
    else if (verdict === false) word = 'FAIL';
    results.push({ layout, check, verdict: word, detail });
    console.log(`${word} [${tier}/${layout}] ${check}${detail ? ' — ' + String(detail).slice(0, 300) : ''}`);
};
const notVerified = (layout, check, why) => record(layout, check, 'NOT VERIFIED', why);
const norm = id => (id ?? '').replace(/-/g, '').toLowerCase();
const PAGE = '.mainAnimatedPage:not(.hide)';

async function newPage(browser, layoutName) {
    const layout = LAYOUTS[layoutName];
    const context = await browser.newContext({ viewport: layout.viewport, isMobile: layout.isMobile, hasTouch: layout.hasTouch,
        userAgent: layout.userAgent, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.jfmodErrors = [];
    page.on('pageerror', error => page.jfmodErrors.push(String(error.message).split('\n')[0]));
    return { context, page };
}

async function signIn(page, user) {
    await page.goto(base(), { waitUntil: 'domcontentloaded' });
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

async function setTvLayout(page) {
    await page.evaluate(() => localStorage.setItem('layout', 'tv'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } }, undefined, { timeout: 30000 });
    await page.waitForTimeout(2500);
}

const apiGet = (page, path, query) => page.evaluate(([p, q]) => ApiClient.getJSON(ApiClient.getUrl(p, q)), [path, query]);

/** Opens a detail page afresh (Home first when the address would not change). */
async function openDetail(page, query, ready) {
    const target = base() + '#/details?' + query;
    if (page.url() === target) {
        await page.goto(base() + '#/home', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1500);
    }
    await page.goto(target, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(`${PAGE} .detailPagePrimaryContainer`, { timeout: 30000 });
    if (ready) await page.waitForSelector(ready, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2500);
}

const activeMatches = (page, selector) => page.evaluate(sel => !!document.activeElement?.matches(sel), selector);
const activeName = page => page.evaluate(() => {
    const el = document.activeElement;
    return el ? `${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 3).join('.')}` : 'none';
});

/** Focus to `selector` by keys only: arrow keys on TV, Tab elsewhere. */
async function reachByKeys(page, layout, selector) {
    const tv = isTv(layout);
    const where = () => page.evaluate(() => {
        const el = document.activeElement;
        const box = el?.getBoundingClientRect();
        return el ? `${el.className}|${Math.round(box.x)},${Math.round(box.y)}` : 'none';
    });
    // TV: down through the page first, then, if the target was above the starting point, back up; at a column edge Right,
    // then Left, as a viewer with a remote would.
    // The first direction is toward the target, as a viewer looking at the screen would press.
    const { above, sameRow } = await page.evaluate(sel => {
        const target = document.querySelector(`.mainAnimatedPage:not(.hide) ${sel}`)?.getBoundingClientRect();
        const active = document.activeElement;
        const from = active && active !== document.body ? active.getBoundingClientRect() : null;
        if (!target || !from) return { above: false, sameRow: false };
        // A target on the focused control's own row (the header's Get a Release beside Play) is reached sideways.
        const row = Math.abs((target.top + target.bottom) / 2 - (from.top + from.bottom) / 2) < from.height / 2;
        return { above: target.top < from.top, sameRow: row };
    }, selector);
    const down = ['ArrowDown', 'ArrowRight', 'ArrowLeft'];
    const up = ['ArrowUp', 'ArrowLeft', 'ArrowRight'];
    let phases = [['Tab']];
    if (tv) phases = above ? [up, down] : [down, up];
    if (tv && sameRow) phases = [['ArrowRight'], ['ArrowLeft'], ...phases];
    for (const keys of phases) {
        for (let presses = 0; presses < (tv ? 60 : 90); presses++) {
            if (await activeMatches(page, selector)) return true;
            const before = await where();
            let moved = false;
            for (const key of keys) {
                await page.keyboard.press(key);
                await page.waitForTimeout(tv ? 220 : 50);
                if (await where() !== before) { moved = true; break; }
            }
            if (!moved) break;
        }
    }
    return activeMatches(page, selector);
}

/** Activates a control the way the layout does: a tap on mobile, keys and Enter on TV and desktop. */
async function activate(page, layout, selector, label) {
    if (isMobile(layout)) {
        const target = page.locator(`${PAGE} ${selector}`).first();
        if (!await target.count()) return false;
        await target.tap({ timeout: 5000 });
        return true;
    }
    const reached = await reachByKeys(page, layout, selector);
    record(layout, `${label} reached by ${isTv(layout) ? 'arrow keys' : 'Tab'}`, reached, await activeName(page));
    if (!reached) return false;
    await page.keyboard.press('Enter');
    return true;
}

/** Back the way the layout sends it: Escape on TV (stock maps it to Back) and in MUI pop-ups, browser Back otherwise. */
const back = async (page, layout, popup = false) => {
    if (popup || isTv(layout)) await page.keyboard.press('Escape');
    else await page.goBack();
    await page.waitForTimeout(700);
};

/** Sizes are compared unfocused: the TV theme enlarges the focused button with a 0.2 s transition. */
const unfocus = async page => {
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.waitForTimeout(500);
};

const pageText = page => page.evaluate(sel => document.querySelector(sel)?.innerText ?? '', PAGE);

/** The header button: before Favorite, the same size as its stock neighbours, styled by stock classes only. */
async function checkHeaderIcon(page, layout, label, admin) {
    await unfocus(page);
    const facts = await page.evaluate(sel => {
        const row = document.querySelector(`${sel} .mainDetailButtons`);
        const icon = row?.querySelector(':scope > .jfmod-getRelease');
        if (!icon) return { present: false };
        const next = icon.nextElementSibling;
        const box = el => { const r = el.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; };
        const visibleStock = [...row.querySelectorAll(':scope > .detailButton:not(.hide):not(.jfmod-getRelease):not(.jfmod-entryMore)')]
            .filter(el => el.getBoundingClientRect().width > 0);
        const pad = el => getComputedStyle(el).padding;
        return { present: true, beforeFavorite: !!next && (next.classList.contains('btnUserRating') || next.classList.contains('jfmod-entryMore')),
            classes: icon.className, title: icon.title, size: box(icon), stock: visibleStock.map(box), padding: pad(icon),
            stockPadding: visibleStock.map(pad), icon: icon.querySelector('.detailButton-icon')?.className ?? '' };
    }, PAGE);
    if (!admin) { record(layout, `${label}: no Get a release icon for an ordinary user`, !facts.present); return; }
    record(layout, `${label}: Get a release icon in the header row`, facts.present, JSON.stringify(facts));
    if (!facts.present) return;
    record(layout, `${label}: icon sits before Favorite`, facts.beforeFavorite);
    record(layout, `${label}: icon is a stock detailButton with cloud_download, titled "Get a release"`,
        /\bbutton-flat\b/.test(facts.classes) && /\bdetailButton\b/.test(facts.classes) && /cloud_download/.test(facts.icon)
        && facts.title === 'Get a release' && (!isTv(layout) || /show-focus/.test(facts.classes)), facts.classes);
    const sameSize = facts.stock.length === 0 || facts.stock.every(([w, h]) => Math.abs(w - facts.size[0]) <= 1 && Math.abs(h - facts.size[1]) <= 1);
    record(layout, `${label}: icon is exactly as big as its stock neighbours`, sameSize, `${facts.size} vs ${JSON.stringify(facts.stock)}`);
}

/** The release picker opens from `selector` and closes with Back; focus returns to the opener. */
async function checkPickerOpens(page, layout, selector, label) {
    if (!await activate(page, layout, selector, label)) { record(layout, `${label} opens the release picker`, false, 'not reached'); return; }
    const dialog = page.locator('.jfmod-releaseDialog');
    const opened = await dialog.first().waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false);
    record(layout, `${label} opens the release picker`, opened);
    if (!opened) return;
    await back(page, layout);
    if (await dialog.count()) await page.locator('.jfmod-releaseDialog .btnCancel, .jfmod-releaseDialog .btnCloseDialog').first().click().catch(() => {});
    await dialog.first().waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
    if (!isMobile(layout)) record(layout, `${label}: focus returns to the opener after the picker`, await activeMatches(page, selector), await activeName(page));
}

/** The page carries none of the old controls. */
async function checkNoOldControls(page, layout, label) {
    const text = await pageText(page);
    const old = await page.locator(`${PAGE} .jfmod-nativeActions, ${PAGE} .jfmod-retentionWarning, ${PAGE} .jfmod-versions`).count();
    record(layout, `${label}: no "Automatic removal is off.", no "Search now", no old button row, warning box or version list`,
        !text.includes('Automatic removal is off.') && !/\bSearch now\b/.test(text) && old === 0, `old ${old}`);
}

/** The one-file Video row: history, pin and cross at its end (admin), history only (user). */
async function checkOneFile(page, layout, admin) {
    await openDetail(page, `id=${ids.one}`, `${PAGE} .selectVideoContainer .jfmod-fileIcons`);
    await checkHeaderIcon(page, layout, 'one-file episode', admin);
    await checkNoOldControls(page, layout, 'one-file episode');
    const icons = await page.evaluate(sel => {
        const host = document.querySelector(`${sel} .selectVideoContainer .jfmod-fileIcons`);
        if (!host) return null;
        const names = [...host.querySelectorAll('button')].map(button => button.querySelector('.material-icons')?.className.replace('material-icons', '').trim());
        const opacity = [...host.querySelectorAll('button')].map(button => getComputedStyle(button).opacity);
        const select = document.querySelector(`${sel} .selectVideoContainer select`);
        return { names, opacity, selectShown: !!select && getComputedStyle(select).display !== 'none',
            chooser: !!document.querySelector(`${sel} .jfmod-videoTrigger`) };
    }, PAGE);
    const want = admin ? ['history', 'push_pin', 'close'] : ['history'];
    record(layout, `one-file episode: Video row ends with ${want.join(', ')}`, !!icons && JSON.stringify(icons.names) === JSON.stringify(want),
        JSON.stringify(icons));
    record(layout, 'one-file episode: no chooser; upstream Video text stays', !!icons && icons.selectShown && !icons.chooser);
    if (icons) {
        const dimmed = isTv(layout) ? icons.opacity.every(value => value === '1') : icons.opacity.every(value => Number(value) < 1 || value === '1');
        record(layout, `one-file episode: icons ${isTv(layout) ? 'always full on TV' : 'dimmed until hovered or focused'}`, dimmed, icons.opacity.join(','));
    }
    await checkHistoryPopover(page, layout, '.selectVideoContainer [data-jfmod-file-history]');
    if (admin) await checkMoreMenuItem(page, layout, true);
    else await checkMoreMenuItem(page, layout, false);
}

/** The per-file history popover: only that file's events; Back closes it; focus returns to the icon. */
async function checkHistoryPopover(page, layout, selector) {
    const opener = `${selector}`;
    if (!await page.locator(`${PAGE} ${opener}`).count()) { notVerified(layout, 'history popover', 'no history icon (plugin without history.files?)'); return; }
    const bindingId = await page.locator(`${PAGE} ${opener}`).first().getAttribute('data-jfmod-file-history');
    if (!await activate(page, layout, opener, 'history icon')) return;
    const popover = page.locator('.jfmod-fileHistory');
    const opened = await popover.first().waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false);
    record(layout, 'history popover opens', opened);
    if (!opened) return;
    const shown = await popover.first().evaluate(node => ({ title: node.querySelector('.jfmod-fileHistoryTitle')?.textContent ?? '',
        lines: [...node.querySelectorAll('li')].map(li => li.textContent) }));
    // The plugin's own list for this file, from the entry detail API.
    const entryId = await page.evaluate(sel => document.querySelector(`${sel} [data-jfmod-entry-id]`)?.getAttribute('data-jfmod-entry-id'), PAGE);
    const detail = entryId ? await apiGet(page, `JellyfinMod/Entries/${entryId}`) : null;
    const own = (detail?.history ?? []).filter(event => norm(event.bindingId) === norm(bindingId));
    const WORDS = { grabbed: 'Grabbed', auto_grabbed: 'Grabbed', imported: 'Imported', version_kept: 'Kept', version_unkept: 'Stopped keeping',
        version_removed: 'Removed', upgrade_replaced: 'Removed', reclaimed: 'Removed' };
    // Each line's own time and action, against the plugin's events for that file sorted newest first.
    const expected = [...own].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .map(event => `${Date.parse(event.createdAt)} ${WORDS[event.eventType] ?? event.eventType}`);
    const actions = await popover.first().evaluate(node => [...node.querySelectorAll('li')].map(li =>
        `${Date.parse(li.querySelector('time')?.getAttribute('datetime') ?? '')} ${li.querySelector('.jfmod-fileHistoryAction')?.textContent ?? ''}`));
    if (own.length === 0) { notVerified(layout, 'history popover lists exactly that file\'s events, newest first', 'this file has no events yet'); } else {
        record(layout, 'history popover lists exactly that file\'s events, newest first', JSON.stringify(actions) === JSON.stringify(expected),
            `shown ${actions.join(', ')} / plugin ${expected.join(', ')} :: ${shown.lines.join(' | ')}`);
    }
    record(layout, 'history popover names no file', !shown.lines.some(line => /\.(mkv|mp4|avi)\b/i.test(line)));
    await back(page, layout, true);
    const closed = await popover.first().waitFor({ state: 'detached', timeout: 5000 }).then(() => true, () => false);
    record(layout, 'Back closes the history popover', closed);
    if (!isMobile(layout)) record(layout, 'focus returns to the history icon', await activeMatches(page, opener), await activeName(page));
}

/** "Remove after watching…" in the stock More menu: an admin's item opens the window dialog; a user's menu has no extra item. */
async function checkMoreMenuItem(page, layout, admin, change = false, why = admin ? 'to an admin' : 'to an ordinary user') {
    const more = `${PAGE} .btnMoreCommands:not(.hide)`;
    if (!await page.locator(more).count()) { notVerified(layout, 'More menu item', 'no stock More button on this page'); return; }
    await page.locator(more).first().click({ timeout: 5000 });
    const sheet = page.locator('.actionSheet');
    const sheetOpened = await sheet.first().waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false);
    record(layout, 'the stock More sheet opens', sheetOpened);
    if (!sheetOpened) return;
    const item = sheet.locator('.actionSheetMenuItem[data-id="jfmod-more-item"]');
    const has = await item.count() > 0;
    record(layout, admin ? `More menu shows "Remove after watching…" ${why}` : `More menu shows nothing extra ${why}`, has === admin,
        has ? await item.first().innerText() : 'absent');
    if (!has) { await back(page, layout); return; }
    await item.first().click({ timeout: 5000 });
    const dialog = page.locator('.jfmod-windowDialog');
    const opened = await dialog.first().waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false);
    record(layout, '"Remove after watching…" opens the window dialog with its select', opened && await dialog.locator('#jfmod-episode-window').count() > 0);
    if (opened && change) await changeWindow(page, layout);
    if (opened) {
        await page.keyboard.press('Escape');
        record(layout, 'Back closes the window dialog', await dialog.first().waitFor({ state: 'detached', timeout: 5000 }).then(() => true, () => false));
    }
}

/** Picks "3 days after watching" in the dialog, reads it back from the plugin, then restores the previous choice. */
async function changeWindow(page, layout) {
    const episodeId = await page.evaluate(sel => document.querySelector(`${sel} [data-jfmod-episode-id]`)?.getAttribute('data-jfmod-episode-id'), PAGE);
    const entryId = await page.evaluate(sel => document.querySelector(`${sel} [data-jfmod-entry-id]`)?.getAttribute('data-jfmod-entry-id'), PAGE);
    const read = async () => (await apiGet(page, `JellyfinMod/Entries/${entryId}`)).episodes.find(episode => episode.id === episodeId);
    const before = await read();
    const pick = async label => {
        await page.locator('#jfmod-episode-window').click();
        await page.locator('.MuiMenuItem-root', { hasText: label }).first().click();
        await page.waitForTimeout(2500);
    };
    await pick('3 days after watching');
    const after = await read();
    record(layout, 'the dialog\'s select changes the episode window', after?.retentionPolicy === 'days' && after.reclaimAfterDays === 3,
        `${after?.retentionPolicy}/${after?.reclaimAfterDays}`);
    await pick(before?.retentionPolicy === 'days' ? `${before.reclaimAfterDays} day` : 'Series default');
    const restored = await read();
    record(layout, 'the episode window is restored', restored?.retentionPolicy === before?.retentionPolicy
        && restored?.reclaimAfterDays === before?.reclaimAfterDays, `${restored?.retentionPolicy}/${restored?.reclaimAfterDays}`);
}

/** Two files: the stock Version select hidden, the chooser drives `.selectSource`, Play uses that copy. */
async function checkTwoFiles(page, layout, admin) {
    await openDetail(page, `id=${ids.two}`, `${PAGE} .jfmod-videoTrigger`);
    const facts = await page.evaluate(sel => {
        const source = document.querySelector(`${sel} .selectSourceContainer`);
        return { sourceHidden: !!source && getComputedStyle(source).display === 'none', sourceInDom: !!source?.querySelector('select.selectSource'),
            trigger: document.querySelector(`${sel} .jfmod-videoTrigger`)?.textContent ?? null,
            options: [...document.querySelector(`${sel} .selectSource`)?.options ?? []].map(option => option.value) };
    }, PAGE);
    record(layout, 'two files: stock Version select hidden but still in the page', facts.sourceHidden && facts.sourceInDom, JSON.stringify(facts));
    record(layout, 'two files: the Video value is the chooser trigger', !!facts.trigger, facts.trigger ?? 'none');
    const value = () => page.evaluate(sel => document.querySelector(`${sel} .selectSource`)?.value ?? null, PAGE);
    const audio = () => page.evaluate(sel => document.querySelector(`${sel} .selectAudio`)?.innerHTML ?? '', PAGE);
    const before = await value();
    const audioBefore = await audio();
    if (!await activate(page, layout, '.jfmod-videoTrigger', 'chooser trigger')) return;
    const rows = page.locator(`${PAGE} .jfmod-fileRow:not(.jfmod-fileRow--add)`);
    await rows.first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    record(layout, 'chooser opens with one row per file', await rows.count() === facts.options.length, `${await rows.count()} rows`);
    record(layout, `Get another quality row ${admin ? 'present' : 'absent'}`, (await page.locator(`${PAGE} [data-jfmod-add-version]`).count() > 0) === admin);
    const other = facts.options.find(option => option !== before);
    const target = `.jfmod-fileChoose[data-jfmod-media-source-id="${other}"]`;
    if (!other || !await activate(page, layout, target, 'the other file\'s row')) return;
    await page.waitForTimeout(1200);
    const after = await value();
    record(layout, 'choosing a row sets .selectSource to that file', norm(after) === norm(other), `${before} → ${after}`);
    record(layout, 'the list closes after a choice', await rows.count() === 0);
    const audioAfter = await audio();
    if (audioAfter === audioBefore) notVerified(layout, 'audio select follows the chosen file', 'both files list the same audio tracks');
    else record(layout, 'audio select follows the chosen file', true, 'upstream re-rendered the audio tracks for that file');
    // Play sends that copy's MediaSourceId.
    const request = page.waitForRequest(req => /PlaybackInfo/.test(req.url()) && req.method() === 'POST', { timeout: 15000 }).catch(() => null);
    await page.locator(`${PAGE} .btnPlay:not(.hide)`).first().click({ timeout: 5000 }).catch(() => {});
    const sent = await request;
    const body = sent ? `${sent.url()} ${sent.postData() ?? ''}` : '';
    record(layout, 'Play uses the chosen MediaSourceId', !!sent && norm(body).includes(norm(other)), sent ? 'PlaybackInfo sent' : 'no PlaybackInfo');
    // Real Chrome plays the H.264 fixture: stop it and leave the player by reloading the app, as a viewer closing it would.
    await page.evaluate(() => document.querySelector('video')?.pause());
    await page.goto(base() + '#/home', { waitUntil: 'domcontentloaded' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } }, undefined, { timeout: 30000 });
    await page.waitForTimeout(2500);
    if (admin && layout === 'desktop') {
        await openDetail(page, `id=${ids.two}`, `${PAGE} .jfmod-videoTrigger`);
        await page.locator(`${PAGE} .jfmod-videoTrigger`).click();
        await checkPickerOpens(page, layout, '[data-jfmod-add-version]', 'Get another quality row');
    }
}

/** The device's copy (V1 decision 4) is still chosen through the chooser's select on TV and mobile. */
async function checkDevicePreference(page, layout) {
    if (layoutOf(layout) === 'desktop') return;
    await openDetail(page, `id=${ids.two}`, `${PAGE} .jfmod-videoTrigger`);
    const detail = await page.evaluate(sel => document.querySelector(`${sel} .selectSource`)?.value ?? null, PAGE);
    const entryId = await page.evaluate(sel => document.querySelector(`${sel} [data-jfmod-entry-id]`)?.getAttribute('data-jfmod-entry-id'), PAGE);
    const entry = await apiGet(page, `JellyfinMod/Entries/${entryId}`);
    const holds = episode => (episode.versions ?? []).some(version => norm(version.jellyfinItemId) === norm(ids.two)
        || norm(version.mediaSourceId) === norm(ids.two));
    const versions = entry.episodes.find(holds)?.versions ?? [];
    const rank = version => Number.parseInt(version.resolution ?? '0', 10) || version.height || 0;
    const sorted = [...versions].sort((a, b) => rank(b) - rank(a));
    const want = isTv(layout) ? sorted[0] : sorted.find(version => rank(version) <= 1080) ?? sorted[sorted.length - 1];
    record(layout, `device preference: ${isTv(layout) ? 'TV takes the best copy' : 'mobile takes the best copy at or below 1080p'}`,
        !!want && norm(detail) === norm(want.mediaSourceId), `${detail} vs ${want?.mediaSourceId}`);
}

/** The file-less movie page: header icon and More, the raised Get a release, the queue line during a grab. */
async function checkFileless(page, layout, admin) {
    await openDetail(page, `entryId=${ids.fileless}`, admin ? `${PAGE} .jfmod-getReleaseRaised` : null);
    await checkHeaderIcon(page, layout, 'file-less movie', admin);
    await checkNoOldControls(page, layout, 'file-less movie');
    const raised = await page.evaluate(sel => {
        const button = document.querySelector(`${sel} .jfmod-trackBlock .jfmod-getReleaseRaised`);
        return button ? { classes: button.className, text: button.textContent.trim(), icon: !!button.querySelector('.cloud_download') } : null;
    }, PAGE);
    if (!admin) {
        record(layout, 'file-less movie: no raised button and no More for an ordinary user',
            !raised && await page.locator(`${PAGE} .jfmod-entryMore`).count() === 0);
        return;
    }
    record(layout, 'file-less movie: raised "Get a release" where the track block would be',
        !!raised && /\braised\b/.test(raised.classes) && /\bbutton-submit\b/.test(raised.classes) && raised.icon && raised.text === 'Get a release',
        JSON.stringify(raised));
    await checkPickerOpens(page, layout, '.jfmod-getReleaseRaised', 'raised Get a release');
    await checkPickerOpens(page, layout, '.jfmod-getRelease', 'header Get a release');
    // The More menu: Monitor (with its state) and Remove entry; Back closes it and focus returns to ⋯.
    if (await activate(page, layout, '.jfmod-entryMore', 'file-less More')) {
        const menu = page.locator('.jfmod-entryMenu .MuiMenu-list');
        const opened = await menu.first().waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false);
        const items = opened ? await menu.first().evaluate(node => [...node.querySelectorAll('[role^="menuitem"]')].map(item =>
            `${item.textContent.trim()}${item.hasAttribute('aria-checked') ? ':' + item.getAttribute('aria-checked') : ''}`)) : [];
        record(layout, 'file-less More holds Monitor (with its state) and Remove entry',
            items.length === 2 && /^Monitor:(true|false)$/.test(items[0]) && items[1] === 'Remove entry', items.join(' | '));
        await page.keyboard.press('Escape');
        await menu.first().waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
        if (!isMobile(layout)) record(layout, 'Back closes the file-less More; focus returns to ⋯', await activeMatches(page, '.jfmod-entryMore'), await activeName(page));
    }
    if (!ids.grabbed) { notVerified(layout, 'queue line replaces the raised button during a grab', 'JELLYFINMOD_DD_GRABBED not set'); return; }
    await openDetail(page, `entryId=${ids.grabbed}`, `${PAGE} .jfmod-trackBlock`);
    const inFlight = await page.evaluate(sel => ({ line: document.querySelector(`${sel} .jfmod-trackBlock .jfmod-queueStatusLine`)?.textContent ?? null,
        raised: !!document.querySelector(`${sel} .jfmod-getReleaseRaised`) }), PAGE);
    record(layout, 'during a grab the queue line takes the raised button\'s place', !!inFlight.line && !inFlight.raised, inFlight.line ?? 'no line');
}

/** The Played badge: expected text, inside the stock button, the button no bigger than its neighbours, survives a toggle. */
async function checkBadge(page, layout, { id, text }) {
    await openDetail(page, `id=${id}`, `${PAGE} .btnPlaystate .jfmod-playedBadge`);
    await unfocus(page);
    const facts = await page.evaluate(sel => {
        const button = document.querySelector(`${sel} .mainDetailButtons .btnPlaystate`);
        const badge = button?.querySelector('.detailButton-content > .jfmod-playedBadge');
        const box = el => { const r = el.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; };
        const play = [...document.querySelectorAll(`${sel} .mainDetailButtons > .detailButton:not(.hide):not(.btnPlaystate)`)]
            .find(el => el.getBoundingClientRect().width > 0);
        return { text: badge?.textContent ?? null, title: badge?.title ?? null, color: badge ? getComputedStyle(badge).color : null,
            size: button ? box(button) : null, neighbour: play ? box(play) : null,
            played: button?.querySelector('.detailButton-icon')?.className ?? '', second: badge === button?.querySelector('.detailButton-content')?.children[1] };
    }, PAGE);
    record(layout, `badge on the Played tick reads "${text}"`, facts.text === text, JSON.stringify(facts));
    record(layout, 'badge is the second child of the stock button\'s content', !!facts.second);
    record(layout, 'badge tooltip gives the date and cause, or Kept', !!facts.title && (/Removed on|Was due on|Kept/.test(facts.title)), facts.title ?? '');
    if (text === '∞') record(layout, '∞ is drawn in primary #00a4dc', facts.color === 'rgb(0, 164, 220)', facts.color);
    record(layout, 'the Played button stays as big as its neighbour', !!facts.size && !!facts.neighbour
        && Math.abs(facts.size[0] - facts.neighbour[0]) <= 1 && Math.abs(facts.size[1] - facts.neighbour[1]) <= 1, `${facts.size} vs ${facts.neighbour}`);
    record(layout, 'no retention warning box', await page.locator(`${PAGE} .jfmod-retentionWarning`).count() === 0);
    // The stock click still toggles played, and the badge survives both toggles.
    const playstate = `${PAGE} .mainDetailButtons .btnPlaystate`;
    const iconClass = () => page.evaluate(sel => document.querySelector(sel)?.querySelector('.detailButton-icon')?.className ?? '', playstate);
    const start = await iconClass();
    await page.locator(playstate).click();
    await page.waitForTimeout(2500);
    const toggled = await iconClass();
    await page.locator(playstate).click();
    await page.waitForTimeout(2500);
    const restored = await iconClass();
    record(layout, 'the stock Played click still toggles played (and back)', toggled !== start && restored === start, `${start} → ${toggled} → ${restored}`);
    await page.waitForTimeout(4000);
    const after = await page.evaluate(sel => [...document.querySelectorAll(`${sel} .jfmod-playedBadge`)].map(span => span.textContent), playstate);
    record(layout, 'after the toggles there is exactly one badge again', after.length === 1, after.join(','));
}

/** Pin on the one-file episode: the plugin reports the file kept; pressing it again stops keeping it. */
async function checkPin(page, layout) {
    await openDetail(page, `id=${ids.one}`, `${PAGE} [data-jfmod-file-pin]`);
    const pin = `${PAGE} [data-jfmod-file-pin]`;
    const bindingId = await page.locator(pin).first().getAttribute('data-jfmod-file-pin');
    const entryId = await page.evaluate(sel => document.querySelector(`${sel} [data-jfmod-entry-id]`)?.getAttribute('data-jfmod-entry-id'), PAGE);
    const kept = async () => {
        const detail = await apiGet(page, `JellyfinMod/Entries/${entryId}`);
        const versions = [...detail.versions ?? [], ...detail.episodes.flatMap(episode => episode.versions ?? [])];
        return versions.find(version => version.bindingId === bindingId)?.kept ?? null;
    };
    const before = await kept();
    await page.locator(pin).first().click();
    await page.waitForTimeout(3000);
    const after = await kept();
    record(layout, 'pin toggles Keep and the plugin reports the file kept', before === false && after === true, `${before} → ${after}`);
    record(layout, 'the pin shows kept (pressed, primary)', await page.locator(pin).first().getAttribute('aria-pressed') === 'true');
    await page.locator(pin).first().click();
    await page.waitForTimeout(3000);
    record(layout, 'pressing the pin again stops keeping the file', await kept() === false);
}

/** The cross on a disposable two-file episode: the stock confirmation, one copy removed, the page moves on. */
async function checkRemove(page, layout, itemId) {
    await openDetail(page, `id=${itemId}`, `${PAGE} .jfmod-videoTrigger`);
    await page.locator(`${PAGE} .jfmod-videoTrigger`).click();
    const cross = page.locator(`${PAGE} .jfmod-fileRow [data-jfmod-file-remove]`);
    await cross.first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    const bindingId = await cross.last().getAttribute('data-jfmod-file-remove');
    const entryId = await page.evaluate(sel => document.querySelector(`${sel} [data-jfmod-entry-id]`)?.getAttribute('data-jfmod-entry-id'), PAGE);
    const episodeId = await page.evaluate(sel => document.querySelector(`${sel} [data-jfmod-episode-id]`)?.getAttribute('data-jfmod-episode-id'), PAGE);
    const bindings = async () => {
        const detail = await apiGet(page, `JellyfinMod/Entries/${entryId}`);
        const versions = episodeId ? detail.episodes.find(episode => episode.id === episodeId)?.versions ?? [] : detail.versions ?? [];
        return versions.map(version => version.bindingId);
    };
    const before = await bindings();
    await cross.last().click();
    const dialog = page.locator('.dialog', { hasText: 'Only the' });
    const shown = await dialog.first().waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false);
    record(layout, 'cross opens the stock confirmation saying what goes and what stays', shown);
    if (!shown) return;
    await page.locator('.dialog button', { hasText: /Remove this version/ }).first().click();
    await page.waitForTimeout(6000);
    const remaining = await bindings();
    const others = before.filter(id => id !== bindingId);
    record(layout, 'exactly that copy removed; every other copy kept', !remaining.includes(bindingId)
        && others.every(id => remaining.includes(id)) && remaining.length === before.length - 1, `${before.length} → ${remaining.length}`);
    const moved = await page.evaluate(() => location.hash);
    const playable = await page.locator(`${PAGE} .btnPlay:not(.hide)`).count();
    record(layout, 'the page moved on to the remaining copy, which plays', /details\?id=/.test(moved) && playable > 0, moved);
}

async function checkUserViews(page) {
    const views = await apiGet(page, `Users/${await page.evaluate(() => ApiClient.getCurrentUserId())}/Views`);
    const names = (views.Items ?? []).map(view => view.Name).sort();
    record('cleanup', 'GET /UserViews for oleksii lists only Movies and Shows', JSON.stringify(names) === JSON.stringify(['Movies', 'Shows']), names.join(', '));
}

/** JELLYFINMOD_DD_ONLY=badge,... runs only the named scenarios (for a focused re-run, such as the minute-window badges). */
const only = env('JELLYFINMOD_DD_ONLY')?.split(',');
const wanted = name => !only || only.includes(name);

async function checkLayout(browser, layout, user, admin) {
    const { context, page } = await newPage(browser, layout);
    const label = admin ? layout : `${layout}/user`;
    try {
        await signIn(page, user);
        if (isTv(layout)) await setTvLayout(page);
        const run = async (name, step) => {
            if (!wanted(name.split(' ')[0])) return;
            try { await step(); } catch (error) { record(label, name, false, String(error.message).split('\n')[0]); }
        };
        // The pin first (desktop administrator, flagged): its Keep and Stop keeping give the one-file history popover events to list.
        if (admin && layout === 'desktop') {
            if (process.env.JELLYFINMOD_DD_PIN === '1' && ids.one) await run('pin', () => checkPin(page, label));
            else notVerified(label, 'pin keeps and stops keeping the file', 'JELLYFINMOD_DD_PIN not set');
        }
        if (ids.one) await run('one-file episode', () => checkOneFile(page, label, admin)); else if (!only) notVerified(label, 'one-file episode', 'JELLYFINMOD_DD_ONE not set');
        if (ids.two) {
            await run('two-file episode', () => checkTwoFiles(page, label, admin));
            await run('device preference', () => checkDevicePreference(page, layout));
        } else { notVerified(label, 'two-file episode', 'JELLYFINMOD_DD_TWO not set'); }
        if (ids.movie) {
            await run('movie page', async () => {
                await openDetail(page, `id=${ids.movie}`, `${PAGE} .selectVideoContainer .jfmod-fileIcons`);
                await checkHeaderIcon(page, label, 'movie', admin);
                await checkNoOldControls(page, label, 'movie');
                await checkHistoryPopover(page, label, '[data-jfmod-file-history]');
                // Movies have no per-title window, so their menu is upstream's for everyone (implementation choice 8).
                await checkMoreMenuItem(page, label, false, false, 'on a movie page');
            });
        } else { notVerified(label, 'movie page', 'JELLYFINMOD_DD_MOVIE not set'); }
        if (ids.fileless) await run('file-less movie', () => checkFileless(page, label, admin)); else if (!only) notVerified(label, 'file-less movie', 'JELLYFINMOD_DD_FILELESS not set');
        for (const badge of badges) await run(`badge ${badge.text}`, () => checkBadge(page, label, badge));
        if (badges.length === 0 && wanted('badge')) notVerified(label, 'Played badge', 'JELLYFINMOD_DD_BADGE not set');
        if (admin && layout === 'desktop') {
            if (process.env.JELLYFINMOD_DD_WINDOW === '1' && ids.one) {
                await run('window dialog', async () => {
                    await openDetail(page, `id=${ids.one}`, `${PAGE} .jfmod-fileIcons`);
                    await checkMoreMenuItem(page, label, true, true);
                });
            } else { notVerified(label, 'the window dialog changes the episode window', 'JELLYFINMOD_DD_WINDOW not set'); }
            if (env('JELLYFINMOD_DD_REMOVE')) await run('remove', () => checkRemove(page, label, env('JELLYFINMOD_DD_REMOVE')));
            else notVerified(label, 'cross removes exactly one copy', 'JELLYFINMOD_DD_REMOVE not set');
            if (process.env.JELLYFINMOD_DD_CLEANUP === '1') await run('cleanup', () => checkUserViews(page));
            else notVerified(label, 'no fixtures left (GET /UserViews)', 'JELLYFINMOD_DD_CLEANUP not set: run it after detail-live.py cleanup');
        }
        record(label, 'no page errors', page.jfmodErrors.length === 0, page.jfmodErrors.slice(0, 3).join(' | '));
    } finally {
        await context.close();
    }
}

const browser = await chromium.launch(tier === 'chrome' ? { headless: true, channel: 'chrome' } : { headless: true });
console.log('browser', tier, browser.version());
try {
    for (const layout of (process.env.JELLYFINMOD_LAYOUTS ?? 'desktop,mobile,tv1080,tv720').split(',').filter(Boolean)) {
        await checkLayout(browser, layout, 'oleksii', true);
        if (env('JELLYFINMOD_DD_USER')) await checkLayout(browser, layout, env('JELLYFINMOD_DD_USER'), false);
    }
} finally {
    await browser.close();
}
const failed = results.filter(result => result.verdict === 'FAIL').length;
const open = results.filter(result => result.verdict === 'NOT VERIFIED').length;
console.log(`\n${results.length - failed - open} passed, ${failed} failed, ${open} not verified (${tier})`);
// 1: something failed; 2: nothing failed but some required check could not run (incomplete acceptance).
let exitCode = 0;
if (failed) exitCode = 1;
else if (open) exitCode = 2;
process.exit(exitCode);
/* eslint-enable compat/compat, no-restricted-globals, sonarjs/cognitive-complexity, @stylistic/max-statements-per-line, no-empty-function */
