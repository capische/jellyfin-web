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
//   [JELLYFINMOD_DD_PACK=<item id of an episode with a file>]   season and series packs (season-packs-design.md, acceptance
//                                   items 1–3, 6–7 as far as the picker shows them, 11 and 12): the scope switch, coverage
//                                   chips, Add and Replace and the unavailable message. Runs three real indexer searches per
//                                   layout and never grabs; checked only when the plugin advertises acquisition.packs.
//   [JELLYFINMOD_DD_ADDED=<item id of an episode that gained a lower-resolution version through Add after 2026-10-09>]
//                                   its default copy must stay the higher resolution; groups made before the fix keep
//                                   Jellyfin's order and are only checked for the desktop starting on their default
//   [JELLYFINMOD_DD_TRACKS=<item id>[,<item id>...]]   the track block's dropdowns (P7.FU6): the Video value without audio and
//                                   with its size at the right end, the list's rows, the Audio and Subtitles dropdowns against
//                                   the item's streams, keys, a one-track field, the light theme and what Play sends; changes
//                                   only the page's own selection (and, on desktop, starts and leaves playback once)
//   [JELLYFINMOD_DD_UPGRADES=1]     with JELLYFINMOD_DD_PACK: search the Season scope again with episode upgrades switched the
//                                   other way (Add alone when off, Add and Replace when on; user, 2026-10-09), then restore it
//
// Read-only unless one of the flags above asks for a change; every change is undone, except the disposable removal. One
// exception since the Phase 1 follow-up (2026-10-12): opening the picker of a series whose entry says
// `episodeListLoaded: false` (discovered in the library) runs the plugin's Refresh once, which adds the series' TMDB
// episodes as unmonitored rows; full-episode-list.mjs checks that behaviour.
import { chromium } from 'playwright';

const origin = new URL(process.env.JELLYFINMOD_TEST_URL ?? (() => { throw new Error('JELLYFINMOD_TEST_URL is required'); })());
// The mod instances only: each Pi instance under its lease (18096 test, 28096 acceptance, 48096 live) and the Mac's local
// copy of the test instance (envs/local, 127.0.0.1:58096); never production on 8096.
// The local pool (envs/pool.list) adds bravo to echo on 9096–12096; alpha's 8096 stays refused, as production's number.
if (!['18096', '28096', '48096', '58096', '9096', '10096', '11096', '12096'].includes(origin.port)) {
    throw new Error('Runs on the isolated instances 18096, 28096, 48096, the local 58096 or the local pool 9096–12096 only');
}
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
const env = name => process.env[name] || null;
const ids = { one: env('JELLYFINMOD_DD_ONE'), two: env('JELLYFINMOD_DD_TWO'), movie: env('JELLYFINMOD_DD_MOVIE'),
    fileless: env('JELLYFINMOD_DD_FILELESS'), grabbed: env('JELLYFINMOD_DD_GRABBED'), pack: env('JELLYFINMOD_DD_PACK'),
    added: env('JELLYFINMOD_DD_ADDED') };
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
            // Once the focus is on the target's own row (a file row and its icons) a viewer presses Right or Left along it;
            // the first-row check above only covered the row the walk started on.
            const along = tv && await page.evaluate(sel => {
                const target = document.querySelector(`.mainAnimatedPage:not(.hide) ${sel}`)?.getBoundingClientRect();
                const active = document.activeElement;
                const from = active && active !== document.body ? active.getBoundingClientRect() : null;
                if (!target || !from || Math.abs((target.top + target.bottom) / 2 - (from.top + from.bottom) / 2) >= from.height / 2) return null;
                return target.left >= from.left ? 'ArrowRight' : 'ArrowLeft';
            }, selector);
            for (const key of along ? [along, ...keys] : keys) {
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
    record(layout, `${label}: icon is a stock detailButton with cloud_download, titled "Get a Release"`,
        /\bbutton-flat\b/.test(facts.classes) && /\bdetailButton\b/.test(facts.classes) && /cloud_download/.test(facts.icon)
        && facts.title === 'Get a Release' && (!isTv(layout) || /show-focus/.test(facts.classes)), facts.classes);
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
    // User, 2026-10-08: a cross at the right closes it (no back arrow, no Close button); its choices share one line; on a
    // large screen it takes most of the screen and its content scrolls inside.
    await settled(page, '.jfmod-releaseDialog');
    const shape = await page.evaluate(() => {
        const dlg = document.querySelector('.jfmod-releaseDialog');
        const box = dlg.getBoundingClientRect();
        const title = dlg.querySelector('.formDialogHeaderTitle')?.getBoundingClientRect();
        const cross = dlg.querySelector('.jfmod-releaseDialogClose');
        const content = dlg.querySelector('.formDialogContent');
        const lines = new Set([...dlg.querySelectorAll('.jfmod-releaseControls > .selectContainer')].map(node => Math.round(node.getBoundingClientRect().top)));
        return { cross: !!cross && cross.querySelector('.material-icons')?.classList.contains('close') && cross.getBoundingClientRect().left > (title?.right ?? 0),
            back: !!dlg.querySelector('.material-icons.arrow_back'), closeButton: [...dlg.querySelectorAll('button')].some(button => button.textContent.trim() === 'Close'),
            lines: lines.size, size: [Math.round(box.width), Math.round(box.height)], viewport: [innerWidth, innerHeight],
            scrolls: !!content && ['auto', 'scroll'].includes(getComputedStyle(content).overflowY) && content.clientHeight < box.height };
    });
    record(layout, `${label}: the picker closes with a cross at the right; no back arrow, no Close button`, shape.cross && !shape.back && !shape.closeButton,
        JSON.stringify(shape));
    // A phone's width wraps the two choices by design (each takes at least 20em).
    if (!isMobile(layout)) record(layout, `${label}: the picker's choices share one line`, shape.lines <= 1, `${shape.lines} lines`);
    if (layoutOf(layout) === 'desktop' && shape.viewport[0] >= 1280) {
        record(layout, `${label}: the picker takes most of a large screen and scrolls inside`, shape.size[0] >= 0.85 * shape.viewport[0]
            && shape.size[1] >= 0.85 * shape.viewport[1] && shape.scrolls, `${shape.size} of ${shape.viewport}`);
    }
    await back(page, layout);
    if (await dialog.count()) await page.locator('.jfmod-releaseDialog .jfmod-releaseDialogClose').first().click().catch(() => {});
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
const ROW_GREY = 'rgba(255, 255, 255, 0.7)';
const ROW_PRIMARY = 'rgb(0, 164, 220)';
const ROW_RED = 'rgb(198, 40, 40)';
/** The pin's tooltips the page can show (implementation choice 6): file, episode and title Keep, and the read-only kinds. */
const PIN_TITLES = { false: ['Keep', 'Keep the Episode', 'Keep the Whole Series', 'Keep the Movie'],
    true: ['Stop Keeping', 'Stop Keeping the Episode', 'This episode is kept', 'Kept with the whole series', 'Kept indefinitely'] };

/**
 * A row action's expected colour, tooltip and accessible name at rest, from its icon and pressed state (user rules,
 * 2026-10-08): grey, the cross red, the pin primary while kept; every name ends with its file. Null for an unknown action.
 */
function rowActionExpectation(button) {
    const file = / (the \d+p file)$/.exec(button.label ?? '')?.[1];
    if (!file) return null;
    if (button.icon === 'history') return { color: ROW_GREY, title: 'History', label: `History of ${file}` };
    if (button.icon === 'close') return { color: ROW_RED, title: 'Remove This Version', label: `Remove ${file}` };
    if (button.icon !== 'push_pin') return null;
    const kept = button.pressed === 'true';
    // The tooltip must be one the page offers for this state; the name then follows from it exactly.
    if (!PIN_TITLES[kept].includes(button.title)) return { color: kept ? ROW_PRIMARY : ROW_GREY, title: PIN_TITLES[kept].join(' | '), label: '?' };
    const fileLevel = { Keep: `Keep ${file}`, 'Stop Keeping': `Stop keeping ${file}` };
    const label = fileLevel[button.title] ?? `${button.title}, on ${file}`;
    return { color: kept ? ROW_PRIMARY : ROW_GREY, title: button.title, label };
}

/** Waits until an element's box has stopped moving (upstream's dialog scales up from 0.5; the file list slides open). */
async function settled(page, selector) {
    let last = '';
    for (let i = 0; i < 40; i++) {
        const box = await page.evaluate(sel => {
            const rect = document.querySelector(sel)?.getBoundingClientRect();
            return rect ? [rect.x, rect.y, rect.width, rect.height].map(Math.round).join(',') : '';
        }, selector);
        if (box && box === last) return;
        last = box;
        await page.waitForTimeout(150);
    }
}

/** Opens the Video row's list of files (the chooser is a dropdown also with one file, user 2026-10-08). */
async function openFileList(page, layout) {
    if (await page.locator(`${PAGE} .jfmod-fileList--open`).count()) return true;
    if (!await activate(page, layout, '.jfmod-videoTrigger', 'Video dropdown')) return false;
    return page.locator(`${PAGE} .jfmod-fileList .jfmod-fileRow`).first().waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false);
}

async function checkOneFile(page, layout, admin) {
    await openDetail(page, `id=${ids.one}`, `${PAGE} .jfmod-videoTrigger`);
    // Colours are read at rest: no pointer over the row (stock icon buttons turn primary on hover).
    await page.mouse.move(0, 0);
    await checkHeaderIcon(page, layout, 'one-file episode', admin);
    await checkNoOldControls(page, layout, 'one-file episode');
    // User, 2026-10-08: the Video row keeps upstream's track-row height and its label stays level with the value.
    const row = await page.evaluate(sel => {
        const box = el => el?.getBoundingClientRect();
        const video = document.querySelector(`${sel} .selectVideoContainer`);
        const audio = document.querySelector(`${sel} .selectAudioContainer`);
        const label = box(video?.querySelector('label, .selectLabel'));
        const trigger = box(document.querySelector(`${sel} .jfmod-videoTrigger`));
        return { video: Math.round(box(video)?.height ?? 0), audio: Math.round(box(audio)?.height ?? 0),
            labelTop: Math.round(label?.top ?? -1), valueTop: Math.round(trigger?.top ?? -2) };
    }, PAGE);
    record(layout, 'one-file episode: the Video value is a dropdown, the row as tall as Audio, its label level',
        row.video > 0 && Math.abs(row.video - row.audio) <= 1 && Math.abs(row.labelTop - row.valueTop) <= 1, JSON.stringify(row));
    if (!await openFileList(page, layout)) { record(layout, 'one-file episode: the dropdown opens its one file', false); return; }
    await page.mouse.move(0, 0);
    await page.waitForTimeout(300);
    const icons = await page.evaluate(sel => {
        const rows = document.querySelectorAll(`${sel} .jfmod-fileList .jfmod-fileRow:not(.jfmod-fileRow--add)`);
        const host = rows[0]?.querySelector('.jfmod-fileIcons');
        if (!host) return null;
        const root = parseFloat(getComputedStyle(document.documentElement).fontSize);
        const buttons = [...host.querySelectorAll('button')];
        const shape = buttons.map(button => {
            const glyph = button.querySelector('.material-icons');
            const hit = getComputedStyle(button, '::before');
            return { w: Math.round(button.getBoundingClientRect().width), h: Math.round(button.getBoundingClientRect().height),
                hitW: parseFloat(hit.width) || 0, hitH: parseFloat(hit.height) || 0, min: Math.floor(2.5 * root) - 1,
                round: getComputedStyle(button).borderRadius === '50%', color: getComputedStyle(button).color, opacity: getComputedStyle(button).opacity,
                label: button.getAttribute('aria-label'), title: button.title, pressed: button.getAttribute('aria-pressed'),
                icon: glyph?.className.replace('material-icons', '').trim(), tilt: glyph ? getComputedStyle(glyph).transform : 'none',
                background: getComputedStyle(button).backgroundColor };
        });
        return { rows: rows.length, add: !!document.querySelector(`${sel} [data-jfmod-add-version]`), names: shape.map(button => button.icon), shape };
    }, PAGE);
    // User, 2026-10-29: no Get Another Quality row; the header's cloud icon opens the picker for another quality.
    record(layout, 'one-file episode: the list has one file and no Get Another Quality row',
        !!icons && icons.rows === 1 && !icons.add, JSON.stringify({ rows: icons?.rows, add: icons?.add }));
    const want = admin ? ['history', 'push_pin', 'close'] : ['history'];
    record(layout, `one-file episode: the file's row ends with ${want.join(', ')}`, !!icons && JSON.stringify(icons.names) === JSON.stringify(want),
        JSON.stringify(icons?.names));
    if (icons) {
        // User, 2026-10-08: drawn the track row's height, round, each answering a 2.5em circle; grey, the cross red.
        record(layout, 'one-file episode: row actions are round, no taller than the row, each answering a 2.5em circle',
            icons.shape.every(button => button.round && button.h <= row.audio + 1 && button.hitW >= button.min && button.hitH >= button.min),
            JSON.stringify(icons.shape.map(b => [b.w, b.h, b.hitW, b.hitH, b.min])));
        const expected = icons.shape.map(rowActionExpectation);
        record(layout, 'one-file episode: grey at rest, the cross red, the pin primary only while kept',
            expected.every((rowWant, index) => !!rowWant && icons.shape[index].color === rowWant.color),
            icons.shape.map((b, index) => `${b.icon}=${b.color} (want ${expected[index]?.color})`).join(', '));
        record(layout, 'one-file episode: each action names its file and has its Title Case tooltip',
            expected.every((rowWant, index) => !!rowWant && icons.shape[index].label === rowWant.label && icons.shape[index].title === rowWant.title),
            icons.shape.map((b, index) => `${b.label} / ${b.title} (want ${expected[index]?.label} / ${expected[index]?.title})`).join(', '));
        record(layout, 'one-file episode: icons are not dimmed', icons.shape.every(button => button.opacity === '1'), icons.shape.map(b => b.opacity).join(','));
        const pin = icons.shape.find(button => button.icon === 'push_pin');
        if (pin) {
            // The pin looks pinned: tilted while loose, upright on the primary tint while kept.
            const pinned = pin.pressed === 'true';
            record(layout, 'one-file episode: the pin is tilted when loose and upright on a tint when kept',
                pinned ? pin.tilt === 'none' && pin.background !== 'rgba(0, 0, 0, 0)' : pin.tilt !== 'none',
                `${pin.pressed} ${pin.tilt} ${pin.background}`);
        }
    }
    await checkHistoryPopover(page, layout, '.jfmod-fileList [data-jfmod-file-history]');
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
        version_removed: 'Removed', upgrade_replaced: 'Removed', reclaimed: 'Removed', pack_replaced: 'Replaced',
        pack_replace_refused: 'Not replaced', pack_file_skipped: 'Skipped', pack_episode_skipped: 'Skipped' };
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
    record(layout, 'no Get another quality row', await page.locator(`${PAGE} [data-jfmod-add-version]`).count() === 0);
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
        await openDetail(page, `id=${ids.two}`, `${PAGE} .jfmod-getRelease`);
        await checkPickerOpens(page, layout, '.jfmod-getRelease', 'the cloud icon on a title with files');
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

/**
 * The default copy (user, 2026-10-09). On the episode that gained a lower version through Add after the fix
 * (JELLYFINMOD_DD_ADDED), the plugin's default row, Jellyfin's main version, is its highest resolution. On any two-file
 * episode the desktop page, which keeps Jellyfin's default, starts on that default row; a group made before the fix keeps
 * whatever default Jellyfin gave it (decision 5), so only that is checked there.
 */
async function checkDefaultVersion(page, layout, itemId, postFix) {
    await openDetail(page, `id=${itemId}`, `${PAGE} .jfmod-videoTrigger`);
    const selected = await page.evaluate(sel => document.querySelector(`${sel} .selectSource`)?.value ?? null, PAGE);
    const entryId = await page.evaluate(sel => document.querySelector(`${sel} [data-jfmod-entry-id]`)?.getAttribute('data-jfmod-entry-id'), PAGE);
    const entry = await apiGet(page, `JellyfinMod/Entries/${entryId}`);
    const holds = episode => (episode.versions ?? []).some(version => norm(version.jellyfinItemId) === norm(itemId)
        || norm(version.mediaSourceId) === norm(itemId));
    const versions = entry.episodes.find(holds)?.versions ?? [];
    const chosen = versions.find(version => version.isDefault);
    const described = versions.map(version => `${version.resolution ?? version.height ?? '?'}${version.isDefault ? ' (default)' : ''}`).join(', ');
    const which = postFix ? 'added after the fix' : 'two-file episode';
    if (versions.length < 2) {
        notVerified(layout, `default version (${which}): the desktop page starts on the default copy`, `copies ${described || 'none'}`);
    } else {
        record(layout, `default version (${which}): the desktop page starts on the default copy`, !!chosen && norm(selected) === norm(chosen.mediaSourceId),
            `${selected} vs ${chosen?.mediaSourceId}`);
    }
    if (!postFix) return;
    const rank = version => Number.parseInt(version.resolution ?? '0', 10) || version.height || 0;
    const ranks = versions.map(rank);
    if (versions.length < 2 || ranks.some(value => !value) || new Set(ranks).size < 2) {
        notVerified(layout, 'default version: after Add the higher resolution stays the default copy', `copies ${described || 'none'}: no lower one to compare`);
        return;
    }
    record(layout, 'default version: after Add the higher resolution stays the default copy', !!chosen && rank(chosen) === Math.max(...ranks), described);
}

/** The file-less movie page: header icon and More, the raised Get a release, the queue line during a grab. */
/**
 * P7.FU6, the track block's dropdowns (user-approved design 2026-10-17, UX §11.2). What each entry must show is worked out here
 * from Jellyfin's own streams (`Items/{id}` media sources), not from the page.
 */
const CHANNEL_WORDS = { 1: 'mono', 2: '2.0', 3: '2.1', 6: '5.1', 7: '6.1', 8: '7.1' };
const DOLBY_CHIPS = { eac3: 'Dolby Digital Plus', ac3: 'Dolby Digital', truehd: 'Dolby TrueHD' };
const WORD_CHIPS = { aac: 'AAC', mp3: 'MP3', flac: 'FLAC', opus: 'OPUS', vorbis: 'VORBIS' };
const SUBTITLE_WORDS = { subrip: 'SRT', srt: 'SRT', ass: 'ASS', ssa: 'SSA', pgssub: 'PGS', webvtt: 'VTT', dvdsub: 'VOBSUB', dvd_subtitle: 'VOBSUB', mov_text: 'TX3G' };

const dtsLabel = profile => {
    if (/DTS:X/i.test(profile)) return 'DTS:X';
    return /\bMA\b/.test(profile) ? 'DTS-HD Master Audio' : 'DTS';
};

/** The chips' names, in order (Atmos before its format), and the channel tag; null labels when the format has no fixed word. */
function expectedAudio(stream) {
    const codec = (stream.Codec ?? '').toLowerCase();
    const profile = stream.Profile ?? '';
    const labels = /atmos/i.test(profile) ? ['Dolby Atmos'] : [];
    if (DOLBY_CHIPS[codec]) labels.push(DOLBY_CHIPS[codec]);
    else if (codec === 'dts' || codec === 'dca') labels.push(dtsLabel(profile));
    else if (codec === 'aac' && /^HE/i.test(profile)) labels.push('HE-AAC');
    else if (WORD_CHIPS[codec]) labels.push(WORD_CHIPS[codec]);
    else return { labels: null, channels: CHANNEL_WORDS[stream.Channels] ?? null };
    return { labels, channels: CHANNEL_WORDS[stream.Channels] ?? (stream.Channels ? `${stream.Channels} ch` : null) };
}

/** Default, Forced, SDH, then the stream's own title when it adds a word (design: Default / Forced / Commentary muted). */
function expectedFlags(stream, language) {
    const flags = [];
    if (stream.IsDefault) flags.push('Default');
    if (stream.IsForced) flags.push('Forced');
    if (stream.IsHearingImpaired) flags.push('SDH');
    const title = (stream.Title ?? '').trim();
    if (title && ![...flags, language].some(flag => flag.toLowerCase() === title.toLowerCase())) flags.push(title);
    return flags;
}

const plainWord = text => (text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[\s(]/)[0];

/** Installs `window.jfmodTrack(el)`: what one field or list entry draws. */
const installTrackReader = page => page.evaluate(() => {
    window.jfmodTrack = el => ({
        language: el.querySelector('.jfmod-trackLanguage')?.textContent.trim() ?? null,
        labels: [...el.querySelectorAll('.jfmod-releaseTag[aria-label]')].map(node => node.getAttribute('aria-label')).filter(label => label !== 'Dolby Vision'),
        channels: el.querySelector('.jfmod-releaseMark--channels')?.textContent.trim() ?? null,
        words: [...el.querySelectorAll('.jfmod-fileMarks > .jfmod-releaseMark')].map(node => node.textContent.trim()),
        flags: [...el.querySelectorAll('.jfmod-fileExtra')].map(node => node.textContent.replace(/^·\s*/, '').trim())
    });
});

/** Compares one drawn entry with its stream; returns the differences, empty when it matches. */
function trackDifferences(drawn, stream, optionText) {
    const problems = [];
    if (!drawn.language || !plainWord(optionText).length || !optionText.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(plainWord(drawn.language))) {
        problems.push(`language "${drawn.language}" not in upstream's "${optionText}"`);
    }
    if (stream.Type === 'Audio') {
        const want = expectedAudio(stream);
        if (want.labels && JSON.stringify(drawn.labels) !== JSON.stringify(want.labels)) problems.push(`marks ${drawn.labels} want ${want.labels}`);
        if (want.channels && drawn.channels !== want.channels) problems.push(`channels ${drawn.channels} want ${want.channels}`);
    } else {
        const codec = (stream.Codec ?? '').toLowerCase();
        const want = SUBTITLE_WORDS[codec] ?? codec.toUpperCase();
        if (JSON.stringify(drawn.words) !== JSON.stringify([want])) problems.push(`format ${drawn.words} want ${want}`);
    }
    const flags = expectedFlags(stream, drawn.language ?? '');
    if (JSON.stringify(drawn.flags) !== JSON.stringify(flags)) problems.push(`flags ${drawn.flags} want ${flags}`);
    return problems;
}

/** A track field's facts: tag, chevron, focusability, its hidden select's value and options, and what it draws. */
const trackField = (page, name) => page.evaluate(([sel, fieldName]) => {
    const el = document.querySelector(`${sel} [data-jfmod-track-field="${fieldName}"]`);
    if (!el) return null;
    const select = el.closest('.selectContainer')?.querySelector('select');
    const video = document.querySelector(`${sel} .selectVideoContainer .jfmod-videoTrigger`);
    // Whether the field takes the focus; the focus then goes back where it was.
    const previous = document.activeElement;
    el.focus?.();
    const focusable = document.activeElement === el;
    if (previous instanceof HTMLElement && previous !== document.body) previous.focus();
    else el.blur?.();
    return { tag: el.tagName, chevron: !!el.querySelector('.jfmod-videoChevron'), focusable, title: el.title,
        height: Math.round(el.getBoundingClientRect().height), videoHeight: Math.round(video?.getBoundingClientRect().height ?? 0),
        selectInDom: !!select, selectHidden: !!select && getComputedStyle(select).display === 'none', value: select?.value ?? null,
        options: [...select?.options ?? []].map(option => ({ value: option.value, text: option.textContent })), drawn: window.jfmodTrack(el),
        background: getComputedStyle(el).backgroundColor };
}, [PAGE, name]);

const LISTBOX = '.jfmod-trackMenu [role="listbox"]';

/** The open list's entries: value, selected, its bar, what it draws; and which entry has the focus. */
const trackList = page => page.evaluate(box => {
    const list = document.querySelector(box);
    if (!list) return null;
    const entries = [...list.querySelectorAll('[role="option"]')].map(node => ({ value: node.getAttribute('data-jfmod-track'),
        selected: node.getAttribute('aria-selected') === 'true', bar: getComputedStyle(node).borderLeftColor,
        barWidth: parseFloat(getComputedStyle(node).borderLeftWidth), text: node.title, drawn: window.jfmodTrack(node) }));
    const paper = list.closest('.MuiPaper-root');
    return { entries, focused: document.activeElement?.getAttribute('data-jfmod-track') ?? null,
        paper: paper ? getComputedStyle(paper).backgroundColor : null };
}, LISTBOX);

/** Moves the list's focus to `value` with the arrow keys (TV and desktop) or taps it (phone), then picks it. */
async function pickTrack(page, layout, value) {
    if (isMobile(layout)) {
        await page.locator(`${LISTBOX} [data-jfmod-track="${value}"]`).tap({ timeout: 5000 });
        return true;
    }
    const order = (await trackList(page))?.entries.map(entry => entry.value) ?? [];
    for (let presses = 0; presses < order.length + 2; presses++) {
        const focused = (await trackList(page))?.focused;
        if (focused === value) break;
        await page.keyboard.press(order.indexOf(value) > order.indexOf(focused) ? 'ArrowDown' : 'ArrowUp');
        await page.waitForTimeout(isTv(layout) ? 220 : 60);
    }
    if ((await trackList(page))?.focused !== value) return false;
    await page.keyboard.press('Enter');
    return true;
}

const relativeLuminance = rgb => {
    const [r, g, b] = (rgb.match(/\d+(\.\d+)?/g) ?? ['0', '0', '0']).slice(0, 3).map(Number);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};

/** Opens a track field's list, checks it against the streams, picks `target` and checks the hidden select took it. */
async function checkTrackList(page, layout, name, streams, target) {
    const selector = `[data-jfmod-track-field="${name}"]`;
    if (!await activate(page, layout, selector, `${name} dropdown`)) { record(layout, `${name}: the dropdown opens`, false, 'not reached'); return null; }
    const opened = await page.locator(LISTBOX).first().waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false);
    record(layout, `${name}: the dropdown opens a list`, opened);
    if (!opened) return null;
    await page.waitForTimeout(400);
    const before = await trackField(page, name);
    const list = await trackList(page);
    record(layout, `${name}: one entry per upstream option, in its order`, JSON.stringify(list.entries.map(entry => entry.value))
        === JSON.stringify(before.options.map(option => option.value)), `${list.entries.length} entries, ${before.options.length} options`);
    const current = list.entries.filter(entry => entry.selected);
    record(layout, `${name}: the current entry has the blue left bar, the others none`, current.length === 1 && current[0].value === before.value
        && current[0].bar === 'rgb(0, 164, 220)' && current[0].barWidth > 0 && list.entries.filter(entry => !entry.selected).every(entry => entry.bar === 'rgba(0, 0, 0, 0)'),
    JSON.stringify(current.map(entry => [entry.value, entry.bar, entry.barWidth])));
    if (!isMobile(layout)) record(layout, `${name}: the list opens on the current entry`, list.focused === before.value, `focused ${list.focused}`);
    const problems = [];
    for (const entry of list.entries) {
        if (entry.value === '-1') {
            if (entry.drawn.language !== 'Off') problems.push(`-1 reads ${entry.drawn.language}`);
            continue;
        }
        const stream = streams.find(candidate => String(candidate.Index) === entry.value);
        if (!stream) { problems.push(`no stream ${entry.value}`); continue; }
        problems.push(...trackDifferences(entry.drawn, stream, entry.text).map(problem => `#${entry.value}: ${problem}`));
    }
    record(layout, `${name}: every entry is language, the marks read from its stream, and its flags`, problems.length === 0, problems.slice(0, 6).join('; '));
    if (!await pickTrack(page, layout, target)) { record(layout, `${name}: an entry is chosen by ${isMobile(layout) ? 'a tap' : 'arrows and Enter'}`, false); return null; }
    await page.waitForTimeout(600);
    const after = await trackField(page, name);
    const closed = await page.locator(LISTBOX).count() === 0;
    record(layout, `${name}: choosing an entry sets upstream's hidden select to that stream index and closes the list`,
        after.value === target && closed && after.selectHidden && after.selectInDom, `${before.value} → ${after.value}, closed ${closed}`);
    record(layout, `${name}: the field then reads the chosen entry`, after.title === before.options.find(option => option.value === target)?.text, after.title);
    if (!isMobile(layout)) record(layout, `${name}: focus returns to the field`, await activeMatches(page, selector), await activeName(page));
    return { before, after };
}

async function checkTracks(page, layout, itemId) {
    await openDetail(page, `id=${itemId}`, `${PAGE} .jfmod-trackChooser`);
    await page.mouse.move(0, 0);
    await installTrackReader(page);
    const item = await page.evaluate(id => ApiClient.getItem(ApiClient.getCurrentUserId(), id), itemId);
    const sourceId = await page.evaluate(sel => document.querySelector(`${sel} .selectSource`)?.value ?? null, PAGE);
    const source = item.MediaSources.find(candidate => norm(candidate.Id) === norm(sourceId)) ?? item.MediaSources[0];
    const streams = source.MediaStreams ?? [];
    const audioStreams = streams.filter(stream => stream.Type === 'Audio');
    const subtitleStreams = streams.filter(stream => stream.Type === 'Subtitle');
    const tag = `tracks ${item.Name}`;

    // The Video value: video only, the size at its right end before the chevron, in the secondary colour.
    const video = await page.evaluate(sel => {
        const trigger = document.querySelector(`${sel} .selectVideoContainer .jfmod-videoTrigger`);
        if (!trigger) return null;
        const box = el => el?.getBoundingClientRect();
        const size = trigger.querySelector(':scope > .jfmod-fileSize');
        const chevron = trigger.querySelector(':scope > .jfmod-videoChevron');
        const text = trigger.querySelector(':scope > .jfmod-videoTriggerText');
        return { audio: window.jfmodTrack(trigger), size: size?.textContent ?? null, sizeBeforeChevron: !!size && size.nextElementSibling === chevron,
            gap: Math.round((box(chevron)?.left ?? 0) - (box(size)?.right ?? 0)), clear: Math.round((box(size)?.left ?? 0) - (box(text)?.right ?? 0)),
            em: parseFloat(getComputedStyle(trigger).fontSize), sizeColour: size ? `${getComputedStyle(size).color} × ${getComputedStyle(size).opacity}` : null,
            colour: `${getComputedStyle(text).color} × ${getComputedStyle(text).opacity}` };
    }, PAGE);
    record(layout, `${tag}: the Video value shows no audio marks`, !!video && video.audio.labels.length === 0 && !video.audio.channels, JSON.stringify(video?.audio));
    record(layout, `${tag}: the file size sits at the Video value's right end, just before the chevron, in the secondary colour`,
        !!video?.size && video.sizeBeforeChevron && video.gap >= 0 && video.gap <= video.em && video.clear >= 0 && video.sizeColour !== video.colour,
        JSON.stringify(video));

    // The open Video list: video │ audio and extras … size at each row's end, the selected row's size the value's.
    if (await openFileList(page, layout)) {
        await page.mouse.move(0, 0);
        await page.waitForTimeout(400);
        const rows = await page.evaluate(sel => [...document.querySelectorAll(`${sel} .jfmod-fileList .jfmod-fileRow:not(.jfmod-fileRow--add)`)].map(row => {
            const button = row.querySelector('.jfmod-fileChoose');
            const size = button.querySelector(':scope > .jfmod-fileSize');
            const videoLine = row.querySelector('.jfmod-fileLine:not(.jfmod-fileLine--audio)');
            const audioLine = row.querySelector('.jfmod-fileLine--audio');
            const box = el => el?.getBoundingClientRect() ?? { top: 0, bottom: 0, right: 0 };
            return { selected: row.classList.contains('jfmod-fileRow--selected'), id: button.getAttribute('data-jfmod-media-source-id'),
                size: size?.textContent ?? null, sizeRight: Math.round(box(size).right),
                end: Math.round(box(button).right - parseFloat(getComputedStyle(button).paddingRight)),
                video: window.jfmodTrack(videoLine), audio: window.jfmodTrack(audioLine),
                divider: getComputedStyle(row.querySelector('.jfmod-fileDivider')).display !== 'none',
                videoTop: Math.round(box(videoLine).top), videoBottom: Math.round(box(videoLine).bottom), audioTop: Math.round(box(audioLine).top), audioBottom: Math.round(box(audioLine).bottom),
                sizeTop: Math.round(box(size).top) };
        }), PAGE);
        const selected = rows.find(row => row.selected) ?? rows[0];
        record(layout, `${tag}: each file's size is right-aligned at its row's end, one column for every row`, rows.length > 0
            && rows.every(row => row.size && Math.abs(row.sizeRight - row.end) <= 1 && Math.abs(row.sizeRight - rows[0].sizeRight) <= 1),
        JSON.stringify(rows.map(row => [row.size, row.sizeRight, row.end])));
        record(layout, `${tag}: the selected row's size is the closed value's`, selected?.size === video?.size, `${selected?.size} / ${video?.size}`);
        const defaultAudio = audioStreams.find(stream => stream.Index === source.DefaultAudioStreamIndex) ?? audioStreams[0];
        const want = defaultAudio ? expectedAudio(defaultAudio) : null;
        record(layout, `${tag}: a row's video part has no audio; its audio part is its default track's marks`, !!selected && selected.video.labels.length === 0
            && !selected.video.channels && (!want?.labels || JSON.stringify(selected.audio.labels) === JSON.stringify(want.labels))
            && (!want?.channels || selected.audio.channels === want.channels), JSON.stringify({ video: selected?.video, audio: selected?.audio, want }));
        if (isMobile(layout)) {
            record(layout, `${tag}: on a phone the audio and extras take a second line, the size stays on the first`, !!selected && !selected.divider
                && selected.audioTop >= selected.videoBottom - 1 && selected.sizeTop < selected.audioTop, JSON.stringify(selected));
        } else {
            record(layout, `${tag}: video, a hairline, then audio on one line`, !!selected && selected.divider
                && Math.abs(selected.audioTop + selected.audioBottom - selected.videoTop - selected.videoBottom) <= 4,
            JSON.stringify(selected && [selected.videoTop, selected.videoBottom, selected.audioTop, selected.audioBottom]));
        }
        await activate(page, layout, '.selectVideoContainer .jfmod-videoTrigger', 'Video dropdown (close)');
        await page.waitForTimeout(500);
    } else {
        record(layout, `${tag}: the Video dropdown opens`, false);
    }

    // Audio.
    const audio = await trackField(page, 'Audio');
    record(layout, `${tag}: Audio is drawn as a field the Video value's height, upstream's select hidden but in the page`,
        !!audio && audio.selectInDom && audio.selectHidden && Math.abs(audio.height - audio.videoHeight) <= 1, JSON.stringify(audio && { ...audio, options: audio.options.length }));
    if (audio && audioStreams.length > 1) {
        const currentStream = audioStreams.find(stream => String(stream.Index) === audio.value);
        record(layout, `${tag}: the Audio field reads its current track's language, marks and flags`, !!currentStream
            && trackDifferences(audio.drawn, currentStream, audio.title).length === 0, currentStream ? trackDifferences(audio.drawn, currentStream, audio.title).join('; ') : 'no stream');
        record(layout, `${tag}: with several tracks Audio is a focusable dropdown with a chevron`, audio.tag === 'BUTTON' && audio.chevron && audio.focusable);
        const target = audio.options.find(option => option.value !== audio.value)?.value;
        const chosen = await checkTrackList(page, layout, 'Audio', audioStreams, target);
        if (chosen && !isMobile(layout)) {
            // Escape closes the list without a change and gives the focus back to the field.
            await page.keyboard.press('Enter');
            await page.locator(LISTBOX).first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
            await back(page, layout, true);
            const after = await trackField(page, 'Audio');
            record(layout, `${tag}: Escape closes the Audio list unchanged and focus returns to the field`, await page.locator(LISTBOX).count() === 0
                && after.value === target && await activeMatches(page, '[data-jfmod-track-field="Audio"]'), `${after.value} ${await activeName(page)}`);
        }
        page.jfmodChosenAudio = chosen ? target : null;
    } else if (audio) {
        record(layout, `${tag}: one audio track is the same field without a chevron, not clickable and not a focus stop`,
            audio.tag !== 'BUTTON' && !audio.chevron && !audio.focusable, JSON.stringify({ tag: audio.tag, chevron: audio.chevron, focusable: audio.focusable }));
        const one = audioStreams[0];
        record(layout, `${tag}: the one track's field reads its language, marks and flags`, !!one && trackDifferences(audio.drawn, one, audio.title).length === 0,
            one ? trackDifferences(audio.drawn, one, audio.title).join('; ') : 'no stream');
    }

    // Subtitles: Off first; an entry, then Off again.
    const subtitles = await trackField(page, 'Subtitles');
    if (subtitles && subtitleStreams.length > 0) {
        record(layout, `${tag}: Subtitles lists Off first`, subtitles.options[0]?.value === '-1', JSON.stringify(subtitles.options[0]));
        const target = subtitles.options.find(option => option.value !== subtitles.value && option.value !== '-1')?.value;
        const chosen = await checkTrackList(page, layout, 'Subtitles', subtitleStreams, target);
        if (chosen) {
            page.jfmodChosenSubtitle = target;
            const off = await checkTrackList(page, layout, 'Subtitles', subtitleStreams, '-1');
            record(layout, `${tag}: Off can be chosen again`, off?.after.value === '-1');
            if (off) await checkTrackList(page, layout, 'Subtitles', subtitleStreams, target);
        }
    } else {
        notVerified(layout, `${tag}: Subtitles dropdown`, 'this file has no subtitle streams');
    }

    // The light theme: the fields and the list on the theme's paper.
    await page.evaluate(() => { window.jfmodTheme = document.documentElement.getAttribute('data-theme'); document.documentElement.setAttribute('data-theme', 'light'); });
    await page.waitForTimeout(400);
    let light = null;
    let lightPaper = null;
    try {
        light = await trackField(page, 'Subtitles') ?? await trackField(page, 'Audio');
        if (light?.tag === 'BUTTON') {
            await page.locator(`${PAGE} [data-jfmod-track-field="${light.options[0]?.value === '-1' ? 'Subtitles' : 'Audio'}"]`).click({ timeout: 5000 });
            await page.locator(LISTBOX).first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
            lightPaper = (await trackList(page))?.paper ?? null;
            await page.keyboard.press('Escape');
            await page.waitForTimeout(400);
        }
    } finally {
        await page.evaluate(() => document.documentElement.setAttribute('data-theme', window.jfmodTheme ?? 'dark'));
    }
    record(layout, `${tag}: light theme: the field and its list are light`, !!light && relativeLuminance(light.background) > 0.6
        && (!lightPaper || relativeLuminance(lightPaper) > 0.6), `${light?.background} / ${lightPaper}`);

    // Play sends the chosen audio and subtitle stream, as upstream's selects do (desktop: the player is left at once).
    if (layoutOf(layout) === 'desktop' && (page.jfmodChosenAudio || page.jfmodChosenSubtitle)) {
        const values = await page.evaluate(sel => ({ audio: document.querySelector(`${sel} .selectAudio`)?.value, subtitles: document.querySelector(`${sel} .selectSubtitles`)?.value }), PAGE);
        const request = page.waitForRequest(req => /PlaybackInfo/.test(req.url()) && req.method() === 'POST', { timeout: 15000 }).catch(() => null);
        await page.locator(`${PAGE} .btnPlay:not(.hide)`).first().click({ timeout: 5000 }).catch(() => {});
        const sent = await request;
        const text = sent ? `${sent.url()} ${sent.postData() ?? ''}` : '';
        const has = (key, value) => new RegExp(`${key}"?[=:]\\s*"?${value}\\b`, 'i').test(text);
        record(layout, `${tag}: Play asks for the chosen audio and subtitle stream indexes`, !!sent && (!values.audio || has('AudioStreamIndex', values.audio))
            && (!values.subtitles || has('SubtitleStreamIndex', values.subtitles)), `${JSON.stringify(values)} :: ${text.slice(0, 300)}`);
        await page.evaluate(() => document.querySelector('video')?.pause());
        await page.goto(base() + '#/home', { waitUntil: 'domcontentloaded' });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } }, undefined, { timeout: 30000 });
        await page.waitForTimeout(2500);
    }
    page.jfmodChosenAudio = null;
    page.jfmodChosenSubtitle = null;
}

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
    record(layout, 'file-less movie: raised blue "Get a Release" where the track block would be',
        !!raised && /\braised\b/.test(raised.classes) && /\bbutton-submit\b/.test(raised.classes) && raised.icon && raised.text === 'Get a Release',
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
            items.length === 2 && /^(Monitor:false|Stop Monitoring:true)$/.test(items[0]) && items[1] === 'Remove Entry', items.join(' | '));
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

const PACK_CHECKS = [
    'packs: the scope switch reads Episode / Season / All Seasons, on one line with the profile beyond a phone',
    'packs: Season scope rows carry a "Season N · M episodes" chip',
    'packs: All Seasons rows carry a "Complete · S01–S05" or "Seasons A–B" chip',
    'packs: rows where the scope holds files end with Add and Replace',
    'packs: rows where nothing is held have no Add or Replace',
    'packs: Add and Replace are D-pad stops after their row',
    'packs: with every indexer unavailable the status says so, never "No releases found"',
    // The user's answer of 2026-10-09: with episode upgrades off the picker offers Add alone; with them on, Add and Replace.
    // Read from the search's `modes`, which only plugins with the answer send.
    'packs: with episode upgrades off, rows holding files offer Add alone, no Replace',
    'packs: with episode upgrades on, rows holding files offer Add and Replace',
    'packs: the search offers replace in its modes exactly while episode upgrades are on'
];

/** The answer of the search a step starts, read from the network: the runner never searches twice for one step. */
const searchAnswer = page => page.waitForResponse(response => /\/JellyfinMod\/Releases\?/.test(response.url())
    && response.request().method() === 'GET', { timeout: 120000 }).then(response => response.json(), () => null);

/** The picker's settled state: no search block running, its status, the scope switch and every eligible row with its chips and actions. */
async function pickerState(page) {
    await page.waitForFunction(() => !document.querySelector('.jfmod-releaseDialog .jfmod-searchBlock--searching'), undefined, { timeout: 120000 })
        .catch(() => {});
    await page.waitForTimeout(600);
    return page.evaluate(() => {
        const dlg = document.querySelector('.jfmod-releaseDialog');
        const select = dlg?.querySelector('#jfmod-releaseEpisode');
        const root = parseFloat(getComputedStyle(document.documentElement).fontSize);
        const icon = button => {
            if (!button) return null;
            const box = button.getBoundingClientRect();
            return { title: button.title, label: button.getAttribute('aria-label') ?? '', icon: button.querySelector('.jfmod-releaseGlyph-plus') ? 'add' : button.querySelector('.jfmod-releaseGlyph-swap') ? 'swap_horiz' : '',
                size: [Math.round(box.width), Math.round(box.height)], color: getComputedStyle(button).color,
                classes: button.className };
        };
        return {
            root,
            status: dlg?.querySelector('.jfmod-releaseStatus')?.textContent.trim() ?? '',
            scopeLabel: select?.closest('.selectContainer')?.querySelector('label')?.textContent.trim() ?? '',
            options: select ? [...select.options].map(option => ({ value: option.value, text: option.textContent })) : [],
            value: select?.value ?? null,
            selects: dlg ? dlg.querySelectorAll('.jfmod-releaseControls select').length : 0,
            lines: dlg ? new Set([...dlg.querySelectorAll('.jfmod-releaseControls > .selectContainer')]
                .map(node => Math.round(node.getBoundingClientRect().top))).size : 0,
            rows: dlg ? [...dlg.querySelectorAll('.jfmod-releaseList .jfmod-releaseItem')].map(item => ({
                title: (item.querySelector('.jfmod-releaseTitle')?.textContent ?? '').replace(/ · score -?\d+$/, ''),
                coverage: item.querySelector('.jfmod-releaseChip--coverage')?.textContent ?? null,
                held: [...item.querySelectorAll('.jfmod-releaseChip--held')].map(chip => chip.textContent),
                add: icon(item.querySelector('[data-jfmod-release-add]')),
                replace: icon(item.querySelector('[data-jfmod-release-replace]'))
            })) : []
        };
    });
}

/** Changes the scope through the switch's own select, then reads the search it started and the settled picker. */
async function chooseScope(page, value) {
    const answer = searchAnswer(page);
    await page.locator('.jfmod-releaseDialog #jfmod-releaseEpisode').selectOption(value);
    return { body: await answer, state: await pickerState(page) };
}

const failedIndexer = outcome => outcome.status !== 'ok' && outcome.status !== 'no_results';

/** Add and Replace on one row: Title Case tooltips, names that say which release, icons add and swap_horiz, ≥2.5em, Replace red. */
const actionsShaped = (row, root) => !!row.add && !!row.replace && row.add.title === 'Add' && /^Replace (File|\d+ Files)$/.test(row.replace.title)
    && row.add.label.includes(row.title) && row.replace.label.includes(row.title)
    && /\badd\b/.test(row.add.icon) && /\bswap_horiz\b/.test(row.replace.icon)
    && [row.add, row.replace].every(button => button.size[0] >= 2.5 * root - 1 && button.size[1] >= 2.5 * root - 1
        && /paper-icon-button-light/.test(button.classes))
    && row.replace.color === 'rgb(198, 40, 40)';

/** Add alone on one row: the Add icon shaped as above, and no Replace (episode upgrades off, user 2026-10-09). */
const addAloneShaped = (row, root) => !!row.add && !row.replace && row.add.title === 'Add' && row.add.label.includes(row.title)
    && /\badd\b/.test(row.add.icon) && row.add.size[0] >= 2.5 * root - 1 && row.add.size[1] >= 2.5 * root - 1
    && /paper-icon-button-light/.test(row.add.classes);

/**
 * Records one held row against the episode upgrades switch as the plugin's settings read it when the search ran (user,
 * 2026-10-09): Add alone while it is off, Add and Replace while it is on. The search's `modes` are checked against the same
 * switch on their own, so a plugin that advertised the opposite fails both. A plugin that sends no modes keeps the earlier
 * check, which expects both actions.
 */
function recordHeldRow(layout, label, body, state, row, seen, upgrades) {
    const modes = body?.grab?.modes;
    if (!Array.isArray(modes)) {
        record(layout, `${PACK_CHECKS[3]} (${label})`, actionsShaped(row, state.root), JSON.stringify(row).slice(0, 300));
        return;
    }
    const detail = `episode upgrades ${upgrades}, modes ${modes.join(',')} · ${JSON.stringify(row).slice(0, 240)}`;
    if (typeof upgrades !== 'boolean') {
        notVerified(layout, `${PACK_CHECKS[7]} (${label})`, 'the automation settings could not be read');
        return;
    }
    const shaped = upgrades ? actionsShaped(row, state.root) : addAloneShaped(row, state.root);
    record(layout, `${PACK_CHECKS[3]} (${label})`, shaped, detail);
    if (upgrades) seen.replaceOn = true; else seen.replaceOff = true;
    record(layout, `${PACK_CHECKS[upgrades ? 8 : 7]} (${label})`, shaped, detail);
    record(layout, `${PACK_CHECKS[9]} (${label})`, modes.includes('replace') === upgrades && modes.includes('add'), detail);
}

/** The episode upgrades switch as the plugin's settings read it now; null when they cannot be read. */
const episodeUpgradesNow = async page => {
    const settings = await apiGet(page, 'JellyfinMod/Settings/Automation').catch(() => null);
    return typeof settings?.episodeUpgradesEnabled === 'boolean' ? settings.episodeUpgradesEnabled : null;
};

/** Records what one search shows about rows with and without held files; returns which it saw. */
function recordRows(layout, label, body, state, seen, upgrades = null) {
    const eligible = (body?.candidates ?? []).filter(candidate => candidate.eligible);
    const scope = body?.target?.scope ?? 'episode';
    const holds = candidate => (scope === 'episode' ? body.intent === 'addVersion' && !candidate.heldQuality : (candidate.coverage?.held ?? 0) > 0);
    if (Array.isArray(body?.grab?.modes)) seen.modes = true;
    eligible.forEach((candidate, index) => {
        const row = state.rows[index];
        if (!row) return;
        if (holds(candidate)) {
            seen.held = true;
            recordHeldRow(layout, label, body, state, row, seen, upgrades);
        } else if (scope !== 'episode' || body.intent !== 'addVersion') {
            seen.empty = true;
            record(layout, `${PACK_CHECKS[4]} (${label})`, !row.add && !row.replace, row.title);
        }
    });
    return eligible;
}

/** Item 11: when every indexer failed and none returned a row, the status names the wait, never "No releases found". */
function recordUnavailable(layout, body, state, seen) {
    if (!body || body.candidates?.length || !body.indexers?.length || !body.indexers.every(failedIndexer)) return;
    seen.unavailable = true;
    record(layout, PACK_CHECKS[6], /^No indexer answered · try (again at \d{2}:\d{2}|again later)$/.test(state.status)
        && !state.status.includes('No releases found'), state.status);
}

/**
 * Season and series packs in the picker (season-packs-design.md, acceptance 1–3, 6–7, 11, 12): opened from an episode page's
 * header Get a Release, the switch reads `Episode: S01E02 · …` / `Season 1` / `All Seasons` on one line with the profile; the
 * Season and All Seasons searches show coverage chips; rows where the scope holds files end with Add and Replace, others do not;
 * on a TV each is a D-pad stop. Three real searches; nothing is grabbed.
 */
async function checkPacks(page, layout) {
    const health = await apiGet(page, 'JellyfinMod/Health').catch(() => null);
    if (!(health?.Capabilities ?? []).includes('acquisition.packs')) {
        for (const check of PACK_CHECKS) notVerified(layout, check, 'the plugin does not advertise acquisition.packs');
        return;
    }
    await openDetail(page, `id=${ids.pack}`, `${PAGE} .mainDetailButtons .jfmod-getRelease`);
    const first = searchAnswer(page);
    if (!await activate(page, layout, '.mainDetailButtons .jfmod-getRelease', 'packs: header Get a release')) {
        record(layout, 'packs: the picker opens', false, 'not reached');
        return;
    }
    await page.locator('.jfmod-releaseDialog').first().waitFor({ state: 'visible', timeout: 10000 });
    const seen = { held: false, empty: false, unavailable: false, modes: false, replaceOn: false, replaceOff: false };
    const upgrades = await episodeUpgradesNow(page);
    const episode = { body: await first, state: await pickerState(page) };
    const options = episode.state.options.map(option => option.text);
    const seasonOption = episode.state.options.find(option => option.value.startsWith('season:'));
    record(layout, PACK_CHECKS[0], episode.state.scopeLabel === 'Search For' && /^Episode: S\d{2}E\d{2} · /.test(options[0] ?? '')
        && episode.state.value === episode.state.options[0]?.value && (!seasonOption || /^Season \d+$/.test(seasonOption.text))
        // A phone's width wraps the two choices onto two lines (each takes at least 20em); elsewhere they share one.
        && options[options.length - 1] === 'All Seasons' && options.length <= 3 && (isMobile(layout) || episode.state.lines <= 1),
    `${JSON.stringify(options)} · ${episode.state.lines} lines`);
    recordRows(layout, 'Episode', episode.body, episode.state, seen, upgrades);
    recordUnavailable(layout, episode.body, episode.state, seen);

    if (seasonOption) {
        const season = await chooseScope(page, seasonOption.value);
        const eligible = recordRows(layout, 'Season', season.body, season.state, seen, upgrades);
        recordUnavailable(layout, season.body, season.state, seen);
        const chips = season.state.rows.map(row => row.coverage);
        if (eligible.length === 0) {
            notVerified(layout, PACK_CHECKS[1], 'the Season search found no eligible pack');
        } else {
            record(layout, PACK_CHECKS[1], chips.length === eligible.length && chips.every(chip => /^Season \d+ · \d+ episodes?$/.test(chip ?? '')),
                JSON.stringify(chips));
        }
        await checkActionStops(page, layout, season.state);
    } else {
        notVerified(layout, PACK_CHECKS[1], 'the episode is a special: no Season scope');
    }
    const series = await chooseScope(page, 'series');
    const eligible = recordRows(layout, 'All Seasons', series.body, series.state, seen, upgrades);
    // With JELLYFINMOD_DD_UPGRADES=1 the Season search runs again with episode upgrades switched the other way, so one run
    // sees Add alone and Add with Replace; the switch is restored whatever happens.
    if (UPGRADES_FLIP && seen.modes && seasonOption) {
        await withUpgradesFlipped(page, layout, async () => {
            const again = await chooseScope(page, seasonOption.value);
            recordRows(layout, 'Season, episode upgrades switched', again.body, again.state, seen, await episodeUpgradesNow(page));
            await chooseScope(page, 'series');
        });
    }
    recordUnavailable(layout, series.body, series.state, seen);
    const chips = series.state.rows.map(row => row.coverage);
    if (eligible.length === 0) {
        notVerified(layout, PACK_CHECKS[2], 'the All Seasons search found no eligible pack');
    } else {
        record(layout, PACK_CHECKS[2], chips.length === eligible.length
            && chips.every(chip => /^(Complete( · S\d{2}(–S\d{2})?)?|Seasons \d+–\d+ · \d+ episodes)$/.test(chip ?? '')), JSON.stringify(chips));
    }
    if (!seen.held) notVerified(layout, PACK_CHECKS[3], 'no eligible row held files in any scope');
    // The two answers of 2026-10-09 need the plugin's `modes`, and each one a held row searched with that switch.
    const modesWhy = seen.modes ? 'no held row was searched with episode upgrades ' : 'the plugin sends no modes (built before 2026-10-09)';
    if (seen.modes && !UPGRADES_FLIP) notVerified(layout, 'packs: the episode upgrades switch is flipped and restored', 'JELLYFINMOD_DD_UPGRADES not set');
    if (!seen.replaceOff) notVerified(layout, PACK_CHECKS[7], seen.modes ? modesWhy + 'off' : modesWhy);
    if (!seen.replaceOn) notVerified(layout, PACK_CHECKS[8], seen.modes ? modesWhy + 'on' : modesWhy);
    if (!seen.replaceOn && !seen.replaceOff) notVerified(layout, PACK_CHECKS[9], modesWhy.trim());
    if (!seen.empty) notVerified(layout, PACK_CHECKS[4], 'no eligible row without held files');
    if (!seen.unavailable) notVerified(layout, PACK_CHECKS[6], 'some indexer answered every search');
    await back(page, layout);
    if (await page.locator('.jfmod-releaseDialog').count()) await page.locator('.jfmod-releaseDialog .jfmod-releaseDialogClose').first().click().catch(() => {});
    await page.locator('.jfmod-releaseDialog').first().waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
}

/** JELLYFINMOD_DD_UPGRADES=1: the pack checks also search with episode upgrades switched the other way, then restore it. */
const UPGRADES_FLIP = process.env.JELLYFINMOD_DD_UPGRADES === '1';

/** Writes the plugin's automation settings (episode upgrades) with the revision just read, as the settings page does. */
const setEpisodeUpgrades = async (page, on) => {
    const current = await apiGet(page, 'JellyfinMod/Settings/Automation');
    if (current.episodeUpgradesEnabled === on) return current;
    return page.evaluate(body => ApiClient.ajax({ type: 'PATCH', url: ApiClient.getUrl('JellyfinMod/Settings/Automation'),
        data: JSON.stringify(body), contentType: 'application/json', dataType: 'json' }), { ...current, episodeUpgradesEnabled: on });
};

/** Runs `step` with episode upgrades switched the other way and restores the switch; records the restore. */
async function withUpgradesFlipped(page, layout, step) {
    const before = (await apiGet(page, 'JellyfinMod/Settings/Automation')).episodeUpgradesEnabled;
    try {
        await setEpisodeUpgrades(page, !before);
        await step();
    } finally {
        await setEpisodeUpgrades(page, before).catch(() => {});
        const after = (await apiGet(page, 'JellyfinMod/Settings/Automation').catch(() => ({}))).episodeUpgradesEnabled;
        record(layout, 'packs: the episode upgrades switch is flipped and restored', after === before, `${before} → ${!before} → ${after}`);
    }
}

/** On a TV, Right from a Season row with Add and Replace reaches Add, then Replace; nothing is activated. */
async function checkActionStops(page, layout, state) {
    if (!isTv(layout)) return;
    const index = state.rows.findIndex(row => row.add && row.replace);
    if (index < 0) {
        const why = state.rows.some(row => row.add) ? 'Season rows offer Add alone (episode upgrades off)' : 'no Season row with Add and Replace';
        notVerified(layout, PACK_CHECKS[5], why);
        return;
    }
    await page.locator('.jfmod-releaseList .jfmod-releaseItem').nth(index).locator('.jfmod-releaseRow').focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    const add = await activeMatches(page, '[data-jfmod-release-add]');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    const replace = await activeMatches(page, '[data-jfmod-release-replace]');
    record(layout, PACK_CHECKS[5], add && replace, await activeName(page));
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
    await openDetail(page, `id=${ids.one}`, `${PAGE} .jfmod-videoTrigger`);
    if (!await openFileList(page, layout)) { record(layout, 'pin: the Video dropdown opens', false); return; }
    const pin = `${PAGE} [data-jfmod-file-pin]`;
    // User, 2026-10-08: keeping a file must not push the page down; the confirmation is upstream's toast.
    const layoutTop = () => page.evaluate(sel => Math.round(document.querySelector(`${sel} .itemDetailsGroup`)?.getBoundingClientRect().top ?? -1), PAGE);
    await settled(page, `${PAGE} .jfmod-fileList`);
    const topBefore = await layoutTop();
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
    const topAfter = await layoutTop();
    const toast = await page.locator('.toast').allTextContents().catch(() => []);
    record(layout, 'keeping does not move the page; the confirmation is a toast', topBefore === topAfter && toast.some(text => /kept/i.test(text)),
        `${topBefore} → ${topAfter}; toast ${JSON.stringify(toast)}`);
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
    await page.locator('.dialog button', { hasText: /Remove This Version/ }).first().click();
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
            if (layout === 'desktop') await run('default version', () => checkDefaultVersion(page, label, ids.two, false));
        } else { notVerified(label, 'two-file episode', 'JELLYFINMOD_DD_TWO not set'); }
        if (layout === 'desktop') {
            if (ids.added) await run('default version', () => checkDefaultVersion(page, label, ids.added, true));
            else if (!only) notVerified(label, 'default version: after Add the higher resolution stays the default copy', 'JELLYFINMOD_DD_ADDED not set');
        }
        if (ids.movie) {
            await run('movie page', async () => {
                await openDetail(page, `id=${ids.movie}`, `${PAGE} .jfmod-videoTrigger`);
                await checkHeaderIcon(page, label, 'movie', admin);
                await checkNoOldControls(page, label, 'movie');
                if (await openFileList(page, label)) await checkHistoryPopover(page, label, '.jfmod-fileList [data-jfmod-file-history]');
                else record(label, 'movie: the Video dropdown opens', false);
                // Movies have no per-title window, so their menu is upstream's for everyone (implementation choice 8).
                await checkMoreMenuItem(page, label, false, false, 'on a movie page');
            });
        } else { notVerified(label, 'movie page', 'JELLYFINMOD_DD_MOVIE not set'); }
        if (admin && ids.pack) {
            await run('packs', () => checkPacks(page, label));
        } else if (admin && !only) {
            for (const check of PACK_CHECKS) notVerified(label, check, 'JELLYFINMOD_DD_PACK not set');
        }
        for (const trackItem of (env('JELLYFINMOD_DD_TRACKS') ?? '').split(',').filter(Boolean)) await run('tracks', () => checkTracks(page, label, trackItem));
        if (!env('JELLYFINMOD_DD_TRACKS') && wanted('tracks')) notVerified(label, 'track dropdowns', 'JELLYFINMOD_DD_TRACKS not set');
        if (ids.fileless) await run('file-less movie', () => checkFileless(page, label, admin)); else if (!only) notVerified(label, 'file-less movie', 'JELLYFINMOD_DD_FILELESS not set');
        for (const badge of badges) await run(`badge ${badge.text}`, () => checkBadge(page, label, badge));
        if (badges.length === 0 && wanted('badge')) notVerified(label, 'Played badge', 'JELLYFINMOD_DD_BADGE not set');
        if (admin && layout === 'desktop') {
            if (process.env.JELLYFINMOD_DD_WINDOW === '1' && ids.one) {
                await run('window dialog', async () => {
                    await openDetail(page, `id=${ids.one}`, `${PAGE} .jfmod-videoTrigger`);
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
