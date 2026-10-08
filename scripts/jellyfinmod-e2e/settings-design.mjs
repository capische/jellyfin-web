/* eslint-disable compat/compat, no-restricted-globals, sonarjs/cognitive-complexity -- a Node acceptance runner, not shipped code */
/* global window, document, ApiClient, location, localStorage, getComputedStyle */
// Settings-area design acceptance (fix/settings-design, 2026-10-07): every section of /catalog/settings and every step of
// the setup wizard, in every layout, screenshotted and checked through computed styles and geometry, beside the
// Dashboard page (Dashboard → Plugins → JellyfinMod) that is the visual reference.
//
//   JELLYFINMOD_TEST_URL=http://<host>:<isolated-port>/ JELLYFINMOD_BROWSER=chromium|chrome \
//   JELLYFINMOD_SHOTS=<dir> node settings-design.mjs
//
// JELLYFINMOD_DESIGN_LAYOUTS=desktop,mobile,tv1080,tv720   JELLYFINMOD_DESIGN_REPORT_ONLY=1 (record, never fail)
// Signs in as oleksii with an empty password. Read-only apart from one Discovery save with nothing changed (the
// revision round-trips) and the read-only TMDB Test; it changes no setting.
// Expects the default Dark theme: the role colours and MUI's disabled colours it checks are that theme's values.
// Since 2026-10-08 it also checks that every list row's actions are round icons named after their row (both pages), that
// the arrows walk a row's icons in order on the TV, and that titles, buttons and rail items are in Title Case (UX §12.1).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const testUrl = new URL(process.env.JELLYFINMOD_TEST_URL ?? (() => { throw new Error('JELLYFINMOD_TEST_URL is required'); })());
// The leased mod instances only (test, acceptance, live Phase 5/6); never production on 8096.
if (!['18096', '28096', '48096', '58096'].includes(testUrl.port)) throw new Error('Runs on the isolated instances only');
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
const shots = process.env.JELLYFINMOD_SHOTS ?? (() => { throw new Error('JELLYFINMOD_SHOTS is required'); })();
mkdirSync(shots, { recursive: true });
const base = new URL('/web/', testUrl).href;
const only = (process.env.JELLYFINMOD_DESIGN_LAYOUTS ?? 'desktop,mobile,tv1080,tv720').split(',');
const LAYOUTS = {
    desktop: { viewport: { width: 1440, height: 900 } },
    mobile: {
        viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
    },
    tv1080: { viewport: { width: 1920, height: 1080 }, tv: true },
    tv720: { viewport: { width: 1280, height: 720 }, tv: true }
};
const SECTION_IDS = ['overview', 'discovery', 'client', 'indexers', 'profiles', 'grabbing', 'import', 'retention', 'automation', 'interface', 'diagnostics'];
const WIZARD_STEPS = ['discovery', 'downloadClient', 'indexers', 'qualityProfile', 'enable', 'optional'];

const results = [];
const record = (layout, check, ok, detail) => {
    results.push({ layout, check, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'} [${tier}/${layout}] ${check}${detail === undefined ? '' : ' :: ' + JSON.stringify(detail).slice(0, 900)}`);
};

const browser = await chromium.launch(tier === 'chrome' ? { headless: true, channel: 'chrome' } : { headless: true });
console.log('browser', tier, browser.version());

async function signIn(page) {
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.ApiClient, undefined, { timeout: 30000 });
    await page.waitForFunction(() => {
        try { return !!ApiClient.getCurrentUserId() || /login|selectuser|selectserver/.test(location.hash); } catch { return false; }
    }, undefined, { timeout: 30000 });
    if (await page.evaluate(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } })) return;
    const field = page.locator('#txtManualName');
    if (!await field.isVisible().catch(() => false)) {
        const chooser = page.locator('.btnManual').first();
        if (await chooser.count()) await chooser.evaluate(node => node.click());
        await field.waitFor({ state: 'visible', timeout: 15000 });
    }
    await field.fill('oleksii');
    await page.waitForTimeout(1500);
    await field.fill('oleksii');
    await page.locator('button:visible').filter({ hasText: 'Sign In' }).first().click();
    await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } }, undefined, { timeout: 30000 });
    await page.waitForFunction(() => location.hash.startsWith('#/home'), undefined, { timeout: 30000 });
    await page.waitForTimeout(1500);
}

/**
 * The geometry and styling audit of whatever `.jfmod-check-main` shows: every MUI button's variant and colours, every
 * pair of controls that overlap, every pair of neighbours in one row closer than `minGap` px, and every block that
 * starts inside the one above it.
 */
const audit = (page, rootSelector = '.jfmod-check-main') => page.evaluate(selector => {
    const root = [...document.querySelectorAll(selector)].pop();
    if (!root) return null;
    const visible = el => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const label = el => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').filter(c => /^jfmod-|^Mui(Button|FormControl)-root$|^fieldDescription$/.test(c)).join('.') : ''} "${(el.textContent || '').trim().slice(0, 28)}"`;
    const variant = el => (/MuiButton-contained/.test(el.className) ? 'contained' : /MuiButton-outlined/.test(el.className) ? 'outlined' : /MuiButton-text/.test(el.className) ? 'text' : 'other');
    // Colours as painted: every translucent layer composited over the ones behind it, down to an opaque one.
    const rgba = colour => {
        const [r, g, b, a = 1] = colour.match(/[\d.]+/g).map(Number);
        return [r, g, b, a];
    };
    const over = (top, under) => top.slice(0, 3).map((value, i) => value * top[3] + under[i] * (1 - top[3]));
    // A background image is understood only as MUI's elevation overlay, a gradient of one colour over the element's own
    // background; anything else is reported, so contrast is never computed against paint that was not read.
    let unsupported = null;
    const surface = el => {
        const layers = [];
        for (let up = el; up; up = up.parentElement) {
            const style = getComputedStyle(up);
            if (style.backgroundImage && style.backgroundImage !== 'none') {
                const stops = style.backgroundImage.match(/^linear-gradient\((rgba?\([^)]*\)),\s*(rgba?\([^)]*\))\)$/);
                if (stops && stops[1] === stops[2]) layers.push(rgba(stops[1]));
                else unsupported = `${up.className}: ${style.backgroundImage}`.slice(0, 160);
            }
            const layer = rgba(style.backgroundColor);
            layers.push(layer);
            if (layer[3] >= 1) break;
        }
        return layers.reverse().reduce((under, layer) => over(layer, under), [0, 0, 0]);
    };
    // MUI's colour of a contained button: primary is blue, inherit is grey, error is red.
    const tint = el => (/MuiButton-containedPrimary/.test(el.className) ? 'blue' : /MuiButton-containedInherit/.test(el.className) ? 'grey' :
        /MuiButton-containedError/.test(el.className) ? 'red' : 'other');
    const buttons = [...root.querySelectorAll('button.MuiButton-root, a.MuiButton-root, button.jfmod-iconbtn')].filter(visible).map(el => {
        const s = getComputedStyle(el);
        unsupported = null;
        let paintedBg = surface(el);
        const paintUnsupported = unsupported;
        const behind = el.parentElement ? surface(el.parentElement) : [0, 0, 0];
        // A button drawn at reduced opacity (a refused or busy one) fades its fill and its glyph into what is behind it.
        let opacity = 1;
        for (let up = el; up; up = up.parentElement) opacity *= Number(getComputedStyle(up).opacity);
        let paintedFgOwn = over(rgba(s.color), paintedBg);
        if (opacity < 1) {
            paintedFgOwn = over([...paintedFgOwn, opacity], behind);
            paintedBg = over([...paintedBg, opacity], behind);
        }
        const icon = el.classList.contains('jfmod-iconbtn');
        const box = el.closest('.jfmod-secret-row');
        const rect = el.getBoundingClientRect();
        const boxRect = box?.getBoundingClientRect();
        // The view a button belongs to: a dialog, a notice (the wizard's step notice, the Home banner), or a section card.
        const dialog = el.closest('.MuiDialog-paper');
        const notice = el.closest('.jfmod-notice');
        const section = el.closest('.jfmod-check-section');
        const view = dialog ? 'dialog' : notice ? 'notice' : section ? 'section ' + section.dataset.section : 'page';
        // The row a button acts on: a list row's name, a quality's id or "Mapping N"; its icon's name must say it.
        const row = el.closest('.jfmod-brow, .jfmod-qrow, .jfmod-maprow');
        let rowName = null;
        if (row?.matches('.jfmod-qrow')) rowName = row.querySelector('.jfmod-qname')?.textContent.trim() ?? null;
        else if (row?.matches('.jfmod-maprow')) rowName = 'Mapping ' + ([...row.parentElement.querySelectorAll(':scope > .jfmod-maprow')].indexOf(row) + 1);
        else if (row) rowName = (row.querySelector('.jfmod-brow-main strong')?.firstChild?.textContent ?? '').trim().replace(/\.$/, '');
        return { text: icon ? '' : el.textContent.trim(), label: el.getAttribute('aria-label'), action: el.dataset.secretAction ?? el.dataset.rowAction ?? null, icon,
            inListRow: !!row, rowName, refused: el.getAttribute('aria-disabled') === 'true',
            variant: icon ? 'icon' : variant(el), tint: icon ? (el.classList.contains('jfmod-iconbtn-red') ? 'red' : 'grey') : tint(el),
            bg: s.backgroundColor, color: s.color, borderWidth: s.borderTopWidth, borderColor: s.borderTopColor,
            height: Math.round(rect.height * 10) / 10, width: Math.round(rect.width * 10) / 10,
            centred: boxRect ? Math.abs((rect.top + rect.bottom) / 2 - (boxRect.top + boxRect.bottom) / 2) <= 2 : null,
            inRow: !!el.closest('.jfmod-rowactions'), inSecret: !!box, inProwlarr: !!el.closest('[data-prowlarr="card"]'),
            sectionHasSync: !!section?.querySelector('button[data-prowlarr="sync"]'), view,
            disabled: !!el.disabled, focused: el === document.activeElement, marked: el.dataset.jfmodMark === '1',
            hasIcon: !icon && !!el.querySelector('.MuiButton-startIcon, .MuiButton-endIcon, svg'),
            outline: el === document.activeElement ? { style: s.outlineStyle, width: parseFloat(s.outlineWidth) } : null,
            paintedFg: paintedFgOwn, paintedBg, paintedBorder: over(rgba(s.borderTopColor), behind), paintUnsupported };
    });
    const parts = [...root.querySelectorAll('button, .MuiFormControl-root, .jfmod-secret-row, .fieldDescription, .jfmod-savemeta, .jfmod-state, .jfmod-notice, .jfmod-kv, .jfmod-brow, .jfmod-maprow, .jfmod-lead, .jfmod-grouptitle, .MuiFormControlLabel-root, a')]
        .filter(visible).filter(el => !el.parentElement.closest('.MuiFormControl-root, button, .MuiFormControlLabel-root'));
    const overlaps = [];
    const tight = [];
    // What is drawn, not what is laid out: a dialog's scrolled content passes under its fixed actions, so each rectangle is
    // clipped by every scrolling ancestor inside the root, and one scrolled out of sight is left out.
    const clipped = el => {
        const box = el.getBoundingClientRect();
        let r = { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
        for (let up = el.parentElement; up && root.contains(up); up = up.parentElement) {
            if (getComputedStyle(up).overflowY === 'visible' && getComputedStyle(up).overflowX === 'visible') continue;
            const c = up.getBoundingClientRect();
            r = { left: Math.max(r.left, c.left), top: Math.max(r.top, c.top), right: Math.min(r.right, c.right), bottom: Math.min(r.bottom, c.bottom) };
        }
        return { ...r, width: r.right - r.left, height: r.bottom - r.top };
    };
    const rects = parts.map(el => ({ el, r: clipped(el) })).filter(({ r }) => r.width > 1 && r.height > 1);
    for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
            const a = rects[i];
            const b = rects[j];
            if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
            const ix = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
            const iy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
            if (ix > 1 && iy > 1) overlaps.push(`${label(a.el)} × ${label(b.el)} (${Math.round(ix)}×${Math.round(iy)})`);
            // Neighbours on one row: vertical overlap of most of the shorter one, horizontal distance under 6 px.
            const shorter = Math.min(a.r.height, b.r.height);
            if (iy > shorter * 0.5 && ix <= 1) {
                const gapX = Math.max(a.r.left, b.r.left) - Math.min(a.r.right, b.r.right);
                // Two buttons side by side keep at least the 8 px upstream's dialog actions keep (its Stacks keep 12).
                const minGap = a.el.matches('button') && b.el.matches('button') ? 7.5 : 6;
                if (gapX < minGap && (a.el.matches('button, .jfmod-savemeta, .fieldDescription') && b.el.matches('button, .jfmod-savemeta, .fieldDescription'))) {
                    tight.push(`${label(a.el)} | ${label(b.el)} (${Math.round(gapX)} px)`);
                }
            }
            // Stacked neighbours: one directly above the other, closer than 4 px.
            if (ix > 1 && iy <= 1) {
                const gapY = Math.max(a.r.top, b.r.top) - Math.min(a.r.bottom, b.r.bottom);
                if (gapY < 4 && a.el.matches('button, .jfmod-secret-row, .MuiFormControl-root, .fieldDescription') &&
                    b.el.matches('button, .jfmod-secret-row, .MuiFormControl-root, .fieldDescription')) {
                    tight.push(`${label(a.el)} / ${label(b.el)} (${Math.round(gapY)} px vertical)`);
                }
            }
        }
    }
    const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    const scrolled = root.querySelector('.MuiDialogContent-root')?.scrollTop ?? null;
    return { buttons, overlaps, tight, overflow, unsupported, scrolled };
}, rootSelector);

/** The audit with the pointer parked in a corner, so no button is measured in its hover state. */
const auditIdle = async (page, layout, rootSelector, { blur = true } = {}) => {
    await page.mouse.move(1, layout.viewport.height - 1);
    // Resting styles: a button that kept focus after a click (Clear becomes Undo in the same element) shows MUI's focus tint.
    // Inside a dialog a blur hands focus back to the dialog, which scrolls to its first field, so the sweep does not blur.
    if (blur) await page.evaluate(() => document.activeElement?.blur?.());
    await page.waitForTimeout(400);
    return audit(page, rootSelector);
};

/**
 * Three kinds of button (user, 2026-10-07): red destroys, blue is the main action of its view, grey is everything else.
 * The kind each button of the settings area must have, by its words and where it sits. Blue: Save (but Save mappings and
 * the Prowlarr card's own Save are grey: the section's Save, or Sync Now, is that view's main action), Continue, Set Up,
 * Add Profile, Sync Now, and Add Indexer only when there is no Prowlarr source (then Sync Now is the main action). Red:
 * Clear, Remove, Delete and Restore Stock Now, and the Clear and Remove icons. A button these rules do not name is grey.
 */
const RED = ['Clear', 'Remove', 'Delete', 'Restore Stock Now'];
const BLUE = ['Save', 'Saving…', 'Continue', 'Set Up', 'Add Profile', 'Sync Now'];
/** The icon actions that destroy: a secret's Clear and a row's Remove. */
const RED_ICONS = ['clear', 'remove'];
const expectedTint = button => {
    if (button.icon) return RED_ICONS.includes(button.action) ? 'red' : 'grey';
    if (RED.includes(button.text)) return 'red';
    if (button.text === 'Add Indexer') return button.sectionHasSync ? 'grey' : 'blue';
    if ((button.text === 'Save' || button.text === 'Saving…') && button.inProwlarr) return 'grey';
    return BLUE.includes(button.text) ? 'blue' : 'grey';
};
const PRIMARY = 'rgb(0, 164, 220)';
const ERROR = 'rgb(198, 40, 40)';
const GREY = 'rgb(66, 66, 66)';
const WHITE = 'rgb(255, 255, 255)';
const ON_PRIMARY = 'rgba(0, 0, 0, 0.87)';
/** MUI's dark-mode disabled text and disabled fill. */
const DISABLED = 'rgba(255, 255, 255, 0.3)';
const DISABLED_FILL = 'rgba(255, 255, 255, 0.12)';
/** What each kind computes to in the Dark theme, idle and enabled. */
const PAINT = { blue: [PRIMARY, ON_PRIMARY], grey: [GREY, WHITE], red: [ERROR, WHITE] };
/** The height of Save in each layout, read from the first section that has one; every labelled button must match it. */
const saveHeight = {};
/**
 * Each button: filled (never text or outlined), the kind its words call for, the Dark theme's colours for that kind, text
 * at 4.5:1 or more on its fill, and the height of Save (an icon button in a secret's box: at least 40 px, centred in the
 * box). A focused button on the TV takes the focus fill; it is checked for contrast and a visible ring instead.
 */
const looksWrong = (button, layoutName) => {
    const want = expectedTint(button);
    const reasons = [];
    const ratio = contrast(button.paintedFg, button.paintedBg);
    if (button.paintUnsupported) reasons.push('paint not read');
    if (!button.icon && button.variant !== 'contained') reasons.push(`variant ${button.variant}`);
    // Icons only where they help (user, 2026-10-07): the secret's icon buttons; a labelled button carries none.
    if (button.hasIcon) reasons.push('a labelled button with an icon');
    if (button.tint !== want) reasons.push(`kind ${button.tint}, want ${want}`);
    if (button.icon) {
        if (button.height < 40 || button.width < 40) reasons.push('icon under 40 px');
        if (button.centred === false) reasons.push('icon not centred in its box');
    } else if (saveHeight[layoutName] && Math.abs(button.height - saveHeight[layoutName]) > 0.6) {
        reasons.push(`height ${button.height}, Save is ${saveHeight[layoutName]}`);
    }
    if (button.focused) {
        if (!button.disabled && ratio < 4.5) reasons.push(`focused contrast ${ratio.toFixed(2)}`);
    } else if (button.refused && button.icon && button.inListRow) {
        // A refused row icon (Move Up on the first row) has no fill of its own: only its glyph's contrast is checked.
        if (ratio < 4.5) reasons.push(`refused contrast ${ratio.toFixed(2)}`);
    } else if (button.disabled) {
        if (button.color !== DISABLED || button.bg !== DISABLED_FILL) reasons.push('not MUI disabled grey');
    } else {
        const [bg, fg] = PAINT[want];
        if (button.bg !== bg || button.color !== fg) reasons.push(`colours ${button.bg} / ${button.color}`);
        if (ratio < 4.5) reasons.push(`contrast ${ratio.toFixed(2)}`);
    }
    return reasons.length ? reasons : null;
};
const checkButtons = (layout, where, buttons) => {
    if (!saveHeight[layout]) {
        const save = buttons.find(button => button.text === 'Save' && !button.inProwlarr);
        if (save) saveHeight[layout] = save.height;
    }
    const wrong = buttons.map(button => ({ button, reasons: looksWrong(button, layout) })).filter(entry => entry.reasons)
        .map(({ button, reasons }) => ({ text: button.text || button.label, reasons, view: button.view }));
    record(layout, `${where}: every button is filled, of its kind (red, blue or grey), readable and the size of Save (${buttons.length} buttons)`,
        wrong.length === 0, wrong.length ? wrong : undefined);
    const blues = {};
    for (const button of buttons) if (button.tint === 'blue') blues[button.view] = [...(blues[button.view] ?? []), button.text];
    const crowded = Object.entries(blues).filter(([, list]) => list.length > 1);
    record(layout, `${where}: at most one blue button per view`, crowded.length === 0, crowded.length ? Object.fromEntries(crowded) : blues);
    // Every action of a list row is a round icon (user, 2026-10-08), named after the row it acts on ("Remove Prowlarr 1337x").
    const inRows = buttons.filter(button => button.inListRow);
    const rowWrong = inRows.filter(button => !button.icon || !button.label || !button.rowName || !button.label.includes(button.rowName))
        .map(button => ({ text: button.text, label: button.label, row: button.rowName }));
    if (inRows.length) {
        record(layout, `${where}: every list-row action is an icon named after its row (${inRows.length})`, rowWrong.length === 0,
            rowWrong.length ? rowWrong : inRows.map(button => button.label).slice(0, 8));
    }
};

/**
 * Title Case (user, 2026-10-08; UX §12.1): every word capitalised except a short article, conjunction or preposition that
 * is neither the first nor the last word. Words that do not start with a letter (numbers, arrows) are not judged.
 */
const SMALL_WORDS = new Set(['a', 'an', 'the', 'and', 'but', 'or', 'nor', 'as', 'at', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'to', 'via', 'with']);
const isTitleCase = text => {
    const words = text.split(/\s+/).filter(Boolean);
    const lettered = words.map((word, index) => ({ index, letters: word.replace(/^[^\p{L}]+/u, '') })).filter(({ letters }) => /^\p{L}/u.test(letters));
    const last = lettered.length ? lettered[lettered.length - 1].index : -1;
    return lettered.every(({ index, letters }) => {
        const bare = letters.replace(/[^\p{L}]+$/u, '').toLowerCase();
        if (index > 0 && index !== last && SMALL_WORDS.has(bare)) return letters[0] === letters[0].toLowerCase();
        return letters[0] === letters[0].toUpperCase();
    });
};
/** The settings page's and wizard's titles: rail heading and items, its links, section and group titles, labelled buttons. */
const settingsTitles = (page, rootSelector = '.jfmod-check-main') => page.evaluate(selector => {
    const pick = (where, sel) => [...document.querySelectorAll(where === 'root' ? `${selector} ${sel}` : sel)].map(el => el.textContent.trim()).filter(Boolean);
    return [...new Set([...pick('page', '.jfmod-check-rail .jfmod-check-head h2'), ...pick('page', '.jfmod-check-rail .jfmod-t'), ...pick('page', '.jfmod-check-links a'),
        ...pick('root', 'h2:not(.MuiDialogTitle-root)'), ...pick('root', '.jfmod-grouptitle'), ...pick('root', 'button.MuiButton-root'), ...pick('root', 'a.MuiButton-root'),
        ...pick('root', '.jfmod-next')])];
}, rootSelector);
const checkTitleCase = (layout, where, titles) => {
    const wrong = titles.filter(text => !isTitleCase(text));
    record(layout, `${where}: titles, rail items and labelled buttons are in Title Case (${titles.length})`, wrong.length === 0, wrong.length ? wrong : undefined);
};

/**
 * Hover: each enabled button in turn, under the pointer once its colour transition has finished; its text must stay at
 * 4.5:1 on the hover fill. Desktop only, where hover exists.
 */
const ENABLED = 'button.MuiButton-root:not(:disabled), a.MuiButton-root, button.jfmod-iconbtn:not(:disabled)';
/**
 * Each enabled button in turn, hovered (`state: 'hover'`) or focused (`state: 'focus'`), measured as that exact element
 * (it is marked while it is read): its text keeps 4.5:1 on the fill it then has, and a focused one shows a ring.
 */
const checkStates = async (page, layout, name, where, state, rootSelector = '.jfmod-check-main') => {
    const count = await page.evaluate(([selector, enabled]) => [...document.querySelectorAll(selector)].pop()?.querySelectorAll(enabled).length ?? 0,
        [rootSelector, ENABLED]);
    const failures = [];
    let measured = 0;
    for (let i = 0; i < count; i++) {
        const target = page.locator(rootSelector).last().locator(ENABLED).nth(i);
        if (!await target.isVisible().catch(() => false)) continue;
        if (state === 'hover') await target.hover();
        else await target.focus();
        await page.waitForTimeout(state === 'hover' ? 350 : 600);
        const ok = await target.evaluate((el, which) => {
            el.dataset.jfmodMark = '1';
            return which === 'hover' ? el.matches(':hover') : el === document.activeElement;
        }, state);
        const result = await audit(page, rootSelector);
        await target.evaluate(el => { delete el.dataset.jfmodMark; });
        const entry = result.buttons.find(button => button.marked);
        // A button that would not take the state, or could not be read in it, fails rather than being skipped.
        if (!entry || !ok) {
            failures.push({ index: i, reason: !ok ? `did not take ${state}` : 'not read' });
            continue;
        }
        measured++;
        const ratio = contrast(entry.paintedFg, entry.paintedBg);
        const ring = state !== 'focus' || (entry.outline && entry.outline.style !== 'none' && entry.outline.width >= 1);
        if (ratio < 4.5 || entry.paintUnsupported || !ring) failures.push({ text: entry.text || entry.label, ratio: Number(ratio.toFixed(2)), bg: entry.bg, ring });
    }
    if (state === 'hover') await page.mouse.move(1, layout.viewport.height - 1);
    else await page.evaluate(() => document.activeElement?.blur?.());
    const what = state === 'hover' ? 'under the pointer' : 'focused, with a visible ring';
    record(name, `${where}: every enabled button keeps 4.5:1 ${what} (${measured} measured)`, failures.length === 0 && (measured > 0 || count === 0),
        failures.length ? failures : undefined);
};
const checkHover = (page, layout, name, where, rootSelector) => checkStates(page, layout, name, where, 'hover', rootSelector);
const THEMES = ['light', 'appletv', 'blueradiance', 'purplehaze', 'wmc', 'dark'];

/** WCAG contrast of two painted colours, each [r, g, b] already composited over what is behind it. */
const contrast = (fg, bg) => {
    const channels = colour => colour.slice(0, 3).map(value => {
        const c = value / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    const luminance = colour => {
        const [r, g, b] = channels(colour);
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
    return (a + 0.05) / (b + 0.05);
};

/**
 * The Dashboard page (plugin configPage.html) follows the same three kinds with upstream's legacy classes: blue
 * `raised button-submit` (Save; New Indexer and New Profile, the main action of sections without a Save), red
 * `raised button-delete` (Remove, Delete, Delete This Client, Restore Stock Page Now), grey `raised` for the rest; the
 * secret's actions and every list row's actions are round icons, red for Clear and Remove. Each visible section is read in turn: kinds, one blue at most, every labelled
 * button the height of Save, icons at least 40 px, text at 4.5:1.
 */
const DASH_RED = ['Remove', 'Delete', 'Delete This Client', 'Restore Stock Page Now'];
const DASH_BLUE = ['Save', 'New Indexer', 'New Profile'];
const dashboardSection = page => page.evaluate(() => {
    const section = [...document.querySelectorAll('#JellyfinModConfigPage .jfmod-check-section')].find(el => !el.hidden);
    if (!section) return null;
    const rgb = colour => colour.match(/[\d.]+/g).map(Number);
    const lum = ([r, g, b]) => [r, g, b].map(v => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
    const save = section.querySelector('[data-submit]');
    const saveHeight = save ? save.getBoundingClientRect().height : null;
    const buttons = [...section.querySelectorAll('button')].filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && !el.classList.contains('jfmod-next') && !el.classList.contains('jfmod-visually-hidden');
    }).map(el => {
        const s = getComputedStyle(el);
        // As painted: every translucent layer, and a one-colour gradient over a fill, composited down to an opaque one.
        const over = (top, under) => top.slice(0, 3).map((v, i) => v * (top[3] ?? 1) + under[i] * (1 - (top[3] ?? 1)));
        const layers = [];
        for (let up = el; up; up = up.parentElement) {
            const style = getComputedStyle(up);
            const stops = style.backgroundImage.match(/^linear-gradient\((rgba?\([^)]*\)),\s*(rgba?\([^)]*\))\)$/);
            if (stops && stops[1] === stops[2]) layers.push(rgb(stops[1]));
            const layer = rgb(style.backgroundColor);
            layers.push(layer);
            if ((layer[3] ?? 1) >= 1) break;
        }
        const bg = layers.reverse().reduce((under, layer) => over(layer, under), [0, 0, 0]);
        const fg = over(rgb(s.color), bg);
        const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
        const icon = el.classList.contains('jfmod-iconbtn');
        let kind = 'other';
        if (el.classList.contains('button-delete') || el.classList.contains('jfmod-iconbtn-red')) kind = 'red';
        else if (el.classList.contains('button-submit')) kind = 'blue';
        else if (el.classList.contains('raised') || el.classList.contains('jfmod-iconbtn-grey')) kind = 'grey';
        const row = el.closest('.jfmod-brow, .jfmod-qrow, .jfmod-maprow');
        return { text: icon ? el.getAttribute('aria-label') : el.textContent.trim(), icon, kind, height: el.getBoundingClientRect().height,
            action: el.dataset.secretAction ?? el.dataset.rowAction ?? null, inListRow: !!row,
            width: el.getBoundingClientRect().width, contrast: (a + 0.05) / (b + 0.05), refused: el.getAttribute('aria-disabled') === 'true',
            marked: el.dataset.jfmodMark === '1', focused: el === document.activeElement, bg: bg.map(Math.round),
            // A ring is an outline, or a solid shadow spread of at least 1 px (upstream's emby-button forbids outlines).
            ring: (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 1) || (!/inset/.test(s.boxShadow) && parseFloat((s.boxShadow.match(/(\d+(?:\.\d+)?)px\s*$/) ?? [])[1] ?? '0') >= 1) };
    });
    const titles = [...section.querySelectorAll('.jfmod-check-sechead h2, .jfmod-grouptitle, .jfmod-next')].map(el => el.textContent.trim())
        .concat(buttons.filter(button => !button.icon).map(button => button.text)).filter(Boolean);
    // A rail item's title, without the state words it carries for a screen reader (" — ready.").
    const shown = el => [...el.childNodes].filter(node => !(node.nodeType === 1 && node.classList.contains('jfmod-visually-hidden'))).map(node => node.textContent).join('').trim();
    const rail = [...document.querySelectorAll('#JellyfinModConfigPage .jfmod-check-rail .jfmod-check-head h2, #JellyfinModConfigPage .jfmod-step .jfmod-t, #JellyfinModConfigPage .jfmod-check-links a')]
        .map(shown).filter(Boolean);
    return { id: section.dataset.section, saveHeight, buttons, titles: [...new Set([...rail, ...titles])] };
});
const checkDashboardSection = (layout, view) => {
    const want = button => {
        if (button.icon) return RED_ICONS.includes(button.action) ? 'red' : 'grey';
        if (DASH_RED.includes(button.text)) return 'red';
        return DASH_BLUE.includes(button.text) ? 'blue' : 'grey';
    };
    const reference = view.saveHeight ?? view.buttons.find(button => !button.icon)?.height;
    const wrong = view.buttons.map(button => {
        const reasons = [];
        if (button.kind !== want(button)) reasons.push(`kind ${button.kind}, want ${want(button)}`);
        if (button.icon ? button.height < 40 || button.width < 40 : Math.abs(button.height - reference) > 0.6) reasons.push(`size ${button.width}×${button.height}`);
        if ((!button.refused || (button.icon && button.inListRow)) && button.contrast < 4.5) reasons.push(`contrast ${button.contrast.toFixed(2)}`);
        return reasons.length ? { text: button.text, reasons } : null;
    }).filter(Boolean);
    record(layout, `dashboard page ${view.id}: every button is red, blue or grey by its role, the size of Save and readable (${view.buttons.length})`,
        wrong.length === 0, wrong.length ? wrong : undefined);
    const blues = view.buttons.filter(button => button.kind === 'blue').map(button => button.text);
    record(layout, `dashboard page ${view.id}: at most one blue button`, blues.length <= 1, blues);
    const inRows = view.buttons.filter(button => button.inListRow);
    if (inRows.length) {
        const rowWrong = inRows.filter(button => !button.icon).map(button => button.text);
        record(layout, `dashboard page ${view.id}: every list-row action is an icon (${inRows.length})`, rowWrong.length === 0, rowWrong.length ? rowWrong : inRows.map(button => button.text).slice(0, 8));
    }
    checkTitleCase(layout, `dashboard page ${view.id}`, view.titles);
};

/** The Dashboard page's buttons in the visible section, each hovered or focused in turn and read as that element. */
const checkDashboardStates = async (page, layout, name, where, state) => {
    const buttons = page.locator('#JellyfinModConfigPage .jfmod-check-section:not([hidden]) button:not(.jfmod-next):not(.jfmod-visually-hidden)');
    const count = await buttons.count();
    const failures = [];
    let measured = 0;
    for (let i = 0; i < count; i++) {
        const target = buttons.nth(i);
        if (!await target.isVisible().catch(() => false)) continue;
        if (await target.getAttribute('aria-disabled') === 'true') continue;
        await target.evaluate(el => { el.dataset.jfmodMark = '1'; });
        const rest = (await dashboardSection(page))?.buttons.find(button => button.marked);
        if (state === 'hover') await target.hover();
        else await target.focus();
        await page.waitForTimeout(state === 'hover' ? 350 : 500);
        const entry = (await dashboardSection(page))?.buttons.find(button => button.marked);
        await target.evaluate(el => { delete el.dataset.jfmodMark; });
        if (!entry || (state === 'focus' && !entry.focused)) {
            failures.push({ index: i, reason: entry ? 'did not take focus' : 'not read' });
            continue;
        }
        measured++;
        if (entry.contrast < 4.5) failures.push({ text: entry.text, ratio: Number(entry.contrast.toFixed(2)) });
        // A focused control must show where it is: a ring, or a fill other than its resting one (upstream's .raised focus).
        if (state === 'focus' && !entry.ring && JSON.stringify(entry.bg) === JSON.stringify(rest?.bg)) failures.push({ text: entry.text, reason: 'no visible focus' });
    }
    if (state === 'hover') await page.mouse.move(1, layout.viewport.height - 1);
    else await page.evaluate(() => document.activeElement?.blur?.());
    record(name, `${where}: every enabled button keeps 4.5:1 ${state === 'hover' ? 'under the pointer' : 'focused'} (${measured} measured)`,
        failures.length === 0 && (measured > 0 || count === 0), failures.length ? failures : undefined);
};

const shot = async (page, name) => {
    const file = join(shots, `${tier}-${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    return file;
};

for (const name of only) {
    const layout = LAYOUTS[name];
    const context = await browser.newContext({ viewport: layout.viewport, isMobile: layout.isMobile, hasTouch: layout.hasTouch, userAgent: layout.userAgent });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error.message).split('\n')[0]));
    try {
        await signIn(page);
        if (layout.tv) {
            await page.evaluate(() => localStorage.setItem('layout', 'tv'));
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => document.documentElement.classList.contains('layout-tv'), undefined, { timeout: 30000 });
            await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } }, undefined, { timeout: 30000 });
        }
        // Save's height in this layout, the size every labelled button must have.
        await page.evaluate(() => { location.hash = '#/catalog/settings?section=discovery'; });
        await page.locator('button[data-submit="discovery"]').waitFor({ state: 'visible', timeout: 30000 });
        saveHeight[name] = await page.locator('button[data-submit="discovery"]').evaluate(el => Math.round(el.getBoundingClientRect().height * 10) / 10);
        record(name, `Save is a full-size button (${saveHeight[name]} px high)`, saveHeight[name] >= 34, saveHeight[name]);
        for (const id of SECTION_IDS) {
            await page.evaluate(section => { location.hash = '#/catalog/settings?section=' + section; }, id);
            await page.locator(`.jfmod-check-section[data-section="${id}"]`).waitFor({ state: 'visible', timeout: 30000 });
            await page.waitForTimeout(700);
            const file = await shot(page, `${name}-settings-${id}`);
            const result = await auditIdle(page, layout);
            checkButtons(name, `settings ${id}`, result.buttons);
            checkTitleCase(name, `settings ${id}`, await settingsTitles(page));
            if (name === 'desktop') await checkHover(page, layout, name, `settings ${id}`);
            record(name, `settings ${id}: no controls overlap`, result.overlaps.length === 0, result.overlaps.length ? result.overlaps : undefined);
            record(name, `settings ${id}: no buttons or texts touch`, result.tight.length === 0, result.tight.length ? result.tight : undefined);
            record(name, `settings ${id}: no horizontal scroll`, result.overflow <= 0, result.overflow > 0 ? result.overflow : undefined);
            // The section's own actions never crowd its heading: beside it, at least 12 px away; or on a line below it.
            const crowding = await page.evaluate(section => {
                const head = document.querySelector(`.jfmod-check-section[data-section="${section}"] .jfmod-check-sechead`);
                const title = head?.querySelector('h2')?.getBoundingClientRect();
                if (!title) return [];
                return [...head.querySelectorAll('.jfmod-sec-actions button')].map(el => el.getBoundingClientRect()).filter(r => {
                    const besides = r.top < title.bottom && r.bottom > title.top;
                    return besides && r.left - title.right < 12;
                }).map(r => Math.round(r.left - title.right));
            }, id);
            record(name, `settings ${id}: the section's actions keep clear of its heading`, crowding.length === 0, crowding.length ? crowding : undefined);
            console.log('  shot', file);
        }
        if (name === 'desktop') {
            // Every shipped colour scheme, switched as upstream's themeManager does (the data-theme attribute MUI's variables
            // follow): every enabled button's text keeps 4.5:1 on its fill at rest and under the pointer. Dark again after.
            for (const theme of THEMES) {
                await page.evaluate(id => document.documentElement.setAttribute('data-theme', id), theme);
                for (const id of ['discovery', 'indexers', 'interface']) {
                    await page.evaluate(section => { location.hash = '#/catalog/settings?section=' + section; }, id);
                    await page.locator(`.jfmod-check-section[data-section="${id}"]`).waitFor({ state: 'visible', timeout: 30000 });
                    await page.waitForTimeout(500);
                    const result = await auditIdle(page, layout);
                    const weak = result.buttons.filter(button => !button.disabled && (button.paintUnsupported || contrast(button.paintedFg, button.paintedBg) < 4.5))
                        .map(button => ({ text: button.text || button.label, ratio: Number(contrast(button.paintedFg, button.paintedBg).toFixed(2)), bg: button.bg, color: button.color }));
                    record(name, `theme ${theme}, ${id}: every enabled button keeps 4.5:1 at rest (${result.buttons.length})`, weak.length === 0, weak.length ? weak : undefined);
                    await checkHover(page, layout, name, `theme ${theme}, ${id}`);
                    if (id === 'indexers') console.log('  shot', await shot(page, `${name}-theme-${theme}-indexers`));
                }
            }
        }
        // The secret's Replace state and its Clear-pending state, put back with Keep / Undo; nothing is saved.
        await page.evaluate(() => { location.hash = '#/catalog/settings?section=discovery'; });
        await page.locator('.jfmod-check-section[data-section="discovery"]').waitFor({ state: 'visible', timeout: 30000 });
        await page.waitForTimeout(500);
        // The token's box (user, 2026-10-07): Test, Replace and Clear as icons in that order, named, at least 40 px, centred,
        // Clear red; no separate Test button; the test's words under the box.
        const box = await page.evaluate(() => {
            const section = document.querySelector('.jfmod-check-section[data-section="discovery"]');
            const row = section.querySelector('.jfmod-secret-row');
            return {
                actions: row ? [...row.querySelectorAll('button')].map(el => ({ action: el.dataset.secretAction ?? null, label: el.getAttribute('aria-label'), text: el.textContent.trim() })) : null,
                standaloneTest: [...section.querySelectorAll('button')].filter(el => !el.closest('.jfmod-secret-row') && /^Test$/.test(el.textContent.trim())).length,
                help: section.querySelector('.jfmod-secret-below .fieldDescription')?.textContent ?? null
            };
        });
        record(name, 'discovery: the token box holds Test Token, Replace and Clear as icons, in that order',
            JSON.stringify(box.actions?.map(a => [a.action, a.label])) === JSON.stringify([['test', 'Test Token'], ['replace', 'Replace'], ['clear', 'Clear']]), box.actions);
        record(name, 'discovery: no standalone Test button; the test is described under the box', box.standaloneTest === 0 &&
            /Asks TMDB whether it accepts the saved token/.test(box.help ?? ''), box);
        if (layout.tv) {
            // Arrow keys walk the box left to right: Test, Replace, Clear, each with a visible ring.
            await page.locator('[data-secret-action="test"]').focus();
            const walked = [];
            for (let step = 0; step < 3; step++) {
                walked.push(await page.evaluate(() => {
                    const el = document.activeElement;
                    const s = getComputedStyle(el);
                    return { action: el.dataset.secretAction ?? el.textContent.trim(), ring: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 1 };
                }));
                if (step < 2) {
                    await page.keyboard.press('ArrowRight');
                    await page.waitForTimeout(200);
                }
            }
            record(name, 'discovery: the arrows walk Test, Replace, Clear, each with a visible focus ring',
                JSON.stringify(walked) === JSON.stringify([{ action: 'test', ring: true }, { action: 'replace', ring: true }, { action: 'clear', ring: true }]), walked);
            console.log('  shot', await shot(page, `${name}-settings-discovery-clear-focus`));
            // Enter on Test runs it and the remote keeps its place on Test through the busy state and after it.
            await page.locator('[data-secret-action="test"]').focus();
            await page.keyboard.press('Enter');
            await page.locator('.jfmod-check-section[data-section="discovery"] [data-secret-test-result] .jfmod-notice').waitFor({ state: 'visible', timeout: 30000 });
            await page.waitForTimeout(800);
            const kept = await page.evaluate(() => document.activeElement?.dataset?.secretAction ?? document.activeElement?.tagName);
            record(name, 'discovery: Test by Enter keeps the focus on Test', kept === 'test', kept);
            await page.evaluate(() => document.activeElement?.blur?.());
        }
        if (layout.tv) {
            // A list row on the TV: Right walks its icons in order (Test, Edit, Remove), each with a ring; Left walks back; Down
            // from a row's Test lands on the next row's Test.
            await page.evaluate(() => { location.hash = '#/catalog/settings?section=indexers'; });
            await page.locator('.jfmod-rowactions [data-row-action="test"]').first().waitFor({ state: 'visible', timeout: 30000 });
            await page.waitForTimeout(500);
            await page.locator('.jfmod-rowactions [data-row-action="test"]').first().focus();
            const here = () => page.evaluate(() => {
                const el = document.activeElement;
                const s = getComputedStyle(el);
                return { action: el.dataset.rowAction ?? el.textContent.trim().slice(0, 20), row: el.closest('.jfmod-brow')?.dataset.indexer ?? null,
                    ring: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 1 };
            });
            const walk = [await here()];
            const icons = await page.locator('.jfmod-brow').first().locator('.jfmod-rowactions button').count();
            for (let step = 1; step < icons; step++) {
                await page.keyboard.press('ArrowRight');
                await page.waitForTimeout(200);
                walk.push(await here());
            }
            const want = icons === 3 ? ['test', 'edit', 'remove'] : ['test', 'edit'];
            record(name, 'indexers: Right walks a row\'s icons in order, each with a visible ring',
                JSON.stringify(walk.map(step => step.action)) === JSON.stringify(want) && walk.every(step => step.ring) && new Set(walk.map(step => step.row)).size === 1, walk);
            for (let step = 1; step < icons; step++) {
                await page.keyboard.press('ArrowLeft');
                await page.waitForTimeout(200);
            }
            const back = await here();
            record(name, 'indexers: Left walks back to the row\'s Test', back.action === 'test' && back.row === walk[0].row, back);
            if (await page.locator('.jfmod-brow[data-indexer]').count() > 1) {
                await page.keyboard.press('ArrowDown');
                await page.waitForTimeout(250);
                const below = await here();
                const second = await page.locator('.jfmod-brow[data-indexer]').nth(1).getAttribute('data-indexer');
                record(name, 'indexers: Down from a row\'s Test lands on the next row\'s Test', below.action === 'test' && below.row === second, below);
            }
            console.log('  shot', await shot(page, `${name}-settings-indexers-row-focus`));
            // Enter on a row's Test runs it; the refetch that follows keeps the remote on that Test (it once jumped to the rail).
            const firstRow = await page.locator('.jfmod-brow[data-indexer]').first().getAttribute('data-indexer');
            await page.locator(`.jfmod-brow[data-indexer="${firstRow}"] [data-row-action="test"]`).focus();
            // The test's own answer, then the settings read that follows it: the focus is checked only once both landed.
            const tested = page.waitForResponse(response => response.request().method() === 'POST' && response.url().includes(`/Settings/Indexers/${firstRow}/Test`), { timeout: 60000 });
            const reread = tested.then(() => page.waitForResponse(response => response.request().method() === 'GET' && /\/Settings\/Indexers(\?|$)/.test(response.url()), { timeout: 60000 }));
            const testIcon = await page.locator(`.jfmod-brow[data-indexer="${firstRow}"] [data-row-action="test"]`).elementHandle();
            await page.keyboard.press('Enter');
            const answered = await Promise.all([tested, reread]).then(([test, list]) => test.ok() && list.ok(), () => false);
            // The icon is busy until the whole settings read after the test has finished (Codex re-review rows-case 2): only
            // then can a focus jump on the new data have happened.
            await page.waitForFunction(el => el.classList.contains('jfmod-busy'), testIcon, { timeout: 5000 }).catch(() => undefined);
            const idle = await page.waitForFunction(el => el.isConnected && !el.classList.contains('jfmod-busy'), testIcon, { timeout: 90000 }).then(() => true, () => false);
            const landed = answered && idle;
            await page.waitForTimeout(1500);
            const afterTest = await here();
            record(name, 'indexers: Test by Enter keeps the focus on that row\'s Test after the list is read again',
                landed && afterTest.action === 'test' && afterTest.row === firstRow, { landed, ...afterTest });
            await page.evaluate(() => document.activeElement?.blur?.());
        }
        if (name === 'desktop') {
            // A row icon names itself in a tooltip, as the secret's do.
            await page.evaluate(() => { location.hash = '#/catalog/settings?section=indexers'; });
            const rowIcon = page.locator('.jfmod-rowactions [data-row-action="edit"]').first();
            await rowIcon.waitFor({ state: 'visible', timeout: 30000 });
            const rowLabel = await rowIcon.getAttribute('aria-label');
            await rowIcon.hover();
            const rowTip = page.locator('[role="tooltip"]', { hasText: rowLabel ?? 'Edit' });
            record(name, `indexers: a row icon shows its name as a tooltip ("${rowLabel}")`, await rowTip.waitFor({ state: 'visible', timeout: 3000 }).then(() => true, () => false));
            await page.mouse.move(1, layout.viewport.height - 1);
            // The user menu's entry is in Title Case.
            await page.locator('button[aria-label="User Menu"]').click();
            const menu = page.locator('.MuiPopover-root:not([aria-hidden="true"]) .MuiMenuItem-root');
            await menu.first().waitFor({ state: 'visible', timeout: 10000 });
            await page.waitForTimeout(300);
            const items = (await menu.allTextContents()).map(text => text.trim());
            record(name, 'the user menu offers "JellyfinMod Settings", and every item is in Title Case', items.includes('JellyfinMod Settings') && items.every(isTitleCase), items);
            await page.keyboard.press('Escape');
            await page.waitForTimeout(400);
            await page.evaluate(() => { location.hash = '#/catalog/settings?section=discovery'; });
            await page.locator('.jfmod-check-section[data-section="discovery"]').waitFor({ state: 'visible', timeout: 30000 });
            await page.waitForTimeout(500);
            await page.locator('[data-secret-action="clear"]').hover();
            const tip = page.locator('[role="tooltip"]', { hasText: 'Clear' });
            record(name, 'discovery: the icon buttons show their names as tooltips', await tip.waitFor({ state: 'visible', timeout: 3000 }).then(() => true, () => false));
            await page.mouse.move(1, layout.viewport.height - 1);
        }
        if (await page.locator('.jfmod-secret-row [data-secret-action="replace"]').count()) {
            await page.locator('.jfmod-secret-row [data-secret-action="replace"]').click();
            await page.waitForTimeout(300);
            console.log('  shot', await shot(page, `${name}-settings-discovery-replacing`));
            const replacing = await auditIdle(page, layout);
            checkButtons(name, 'discovery while replacing', replacing.buttons);
            record(name, 'discovery while replacing: no overlaps or touching', !replacing.overlaps.length && !replacing.tight.length,
                [...replacing.overlaps, ...replacing.tight]);
            await page.locator('.jfmod-secret button', { hasText: 'Keep the Saved One' }).click();
            await page.locator('.jfmod-secret-row [data-secret-action="clear"]').click();
            await page.waitForTimeout(300);
            console.log('  shot', await shot(page, `${name}-settings-discovery-clearing`));
            const clearing = await auditIdle(page, layout);
            checkButtons(name, 'discovery while clearing', clearing.buttons);
            record(name, 'discovery while clearing: no overlaps or touching', !clearing.overlaps.length && !clearing.tight.length,
                [...clearing.overlaps, ...clearing.tight]);
            await page.locator('.jfmod-secret-row button', { hasText: 'Undo' }).click();
            await page.waitForTimeout(300);
            record(name, 'discovery: Undo returns the secret to Configured', await page.locator('.jfmod-secret-row', { hasText: 'Configured' }).count() === 1);
        }
        if (name === 'desktop') {
            // The read-only TMDB test still answers, and a save with nothing changed round-trips the revision.
            const before = await page.locator('[data-savemeta="discovery"]').innerText();
            await page.locator('.jfmod-secret-row button[data-test="discovery"]').click();
            const notice = page.locator('.jfmod-check-section[data-section="discovery"] [data-secret-test-result] .jfmod-notice');
            await notice.waitFor({ state: 'visible', timeout: 30000 });
            const said = await notice.innerText();
            record(name, 'discovery Test, from the icon in the box, says "TMDB accepted the token. (ok)" under the box', /TMDB accepted the token\. \(ok\)/.test(said), said);
            // The result belongs to the saved token: a pending clear hides it (nothing is saved; Undo puts the token back).
            await page.locator('.jfmod-secret-row [data-secret-action="clear"]').click();
            await page.waitForTimeout(300);
            record(name, 'discovery: a pending clear hides the saved token\'s test result',
                await page.locator('.jfmod-check-section[data-section="discovery"] [data-secret-test-result]').count() === 0);
            await page.locator('.jfmod-secret-row button', { hasText: 'Undo' }).click();
            await page.waitForTimeout(300);
            await page.locator('button[data-submit="discovery"]').click();
            await page.waitForFunction(() => /Saved/.test(document.querySelector('.jfmod-check-section[data-section="discovery"] .jfmod-notice')?.textContent ?? ''),
                undefined, { timeout: 30000 });
            const after = await page.locator('[data-savemeta="discovery"]').innerText();
            record(name, 'discovery Save with nothing changed round-trips the revision', before === after, { before, after });
        }
        // The editors of an indexer and a quality profile, in every layout: opened, audited like a section, and on the TV a
        // red action reached by the arrows must stay readable under the focus fill. Cancelled; nothing is saved.
        for (const section of ['indexers', 'profiles']) {
            await page.evaluate(id => { location.hash = '#/catalog/settings?section=' + id; }, section);
            await page.locator(`.jfmod-check-section[data-section="${section}"]`).waitFor({ state: 'visible', timeout: 30000 });
            await page.waitForTimeout(500);
            const edit = page.locator('.jfmod-rowactions [data-row-action="edit"]').first();
            if (!await edit.count()) {
                record(name, `${section} dialog: an Edit button exists to open it`, false);
                continue;
            }
            await edit.click();
            const dialog = page.locator('.MuiDialog-paper').last();
            await dialog.waitFor({ state: 'visible', timeout: 10000 });
            await page.waitForTimeout(500);
            console.log('  shot', await shot(page, `${name}-settings-${section}-dialog`));
            // The editor scrolls: audit it at every scroll position, so content below the first screen is measured too.
            const result = { buttons: [], overlaps: [], tight: [] };
            const positions = await page.evaluate(() => {
                const content = [...document.querySelectorAll('.MuiDialog-paper .MuiDialogContent-root')].pop();
                const step = Math.max(1, Math.floor(content.clientHeight * 0.6));
                const list = [];
                for (let top = 0; top < content.scrollHeight - content.clientHeight + step; top += step) list.push(Math.min(top, content.scrollHeight - content.clientHeight));
                return [...new Set(list)];
            });
            const reached = [];
            for (const top of positions) {
                await page.evaluate(at => { [...document.querySelectorAll('.MuiDialog-paper .MuiDialogContent-root')].pop().scrollTop = at; }, top);
                const at = await auditIdle(page, layout, '.MuiDialog-paper', { blur: false });
                reached.push(at.scrolled);
                if (!result.buttons.length) result.buttons = at.buttons;
                for (const key of ['overlaps', 'tight']) for (const item of at[key]) if (!result[key].includes(item)) result[key].push(item);
            }
            record(name, `${section} dialog: every scroll position was measured where it was asked for`,
                positions.every((top, i) => Math.abs((reached[i] ?? -999) - top) <= 2), { positions, reached });
            await page.evaluate(() => { [...document.querySelectorAll('.MuiDialog-paper .MuiDialogContent-root')].pop().scrollTop = 0; });
            record(name, `${section} dialog: audited at ${positions.length} scroll position(s)`, positions.length >= 1, positions);
            checkButtons(name, `${section} dialog`, result.buttons);
            checkTitleCase(name, `${section} dialog`, await settingsTitles(page, '.MuiDialog-paper'));
            if (section === 'profiles') {
                // The quality order: Move Up, Move Down and Remove on every row, the first row's Move Up and the last row's
                // Move Down refused (aria-disabled, so the remote keeps its focus), never disabled.
                const order = await page.evaluate(() => [...document.querySelectorAll('.MuiDialog-paper .jfmod-qrow')].map(row => [...row.querySelectorAll('.jfmod-rowactions button')]
                    .map(el => `${el.dataset.rowAction}${el.getAttribute('aria-disabled') === 'true' ? ':refused' : ''}${el.disabled ? ':disabled' : ''}`)));
                const last = order.length - 1;
                const expected = order.map((_, index) => [`up${index === 0 ? ':refused' : ''}`, `down${index === last ? ':refused' : ''}`, 'remove']);
                record(name, 'profiles dialog: every quality has Move Up, Move Down and Remove; the ends are refused, not disabled',
                    order.length > 0 && JSON.stringify(order) === JSON.stringify(expected), order);
                if (layout.tv) {
                    // The remote walks onto a refused arrow too: Left from the first quality's Move Down reaches its Move Up,
                    // and Enter there moves nothing.
                    const firstDown = page.locator('.MuiDialog-paper .jfmod-qrow').first().locator('[data-row-action="down"]');
                    await firstDown.focus();
                    await page.keyboard.press('ArrowLeft');
                    await page.waitForTimeout(250);
                    const onUp = await page.evaluate(() => ({ action: document.activeElement?.dataset?.rowAction ?? null,
                        first: document.activeElement?.closest('.jfmod-qrow') === document.querySelector('.MuiDialog-paper .jfmod-qrow') }));
                    const before = await page.locator('.MuiDialog-paper .jfmod-qname').allTextContents();
                    await page.keyboard.press('Enter');
                    await page.waitForTimeout(300);
                    const after = await page.locator('.MuiDialog-paper .jfmod-qname').allTextContents();
                    record(name, 'profiles dialog: Left from the first quality\'s Move Down reaches its refused Move Up, and Enter there moves nothing',
                        onUp.action === 'up' && onUp.first && JSON.stringify(before) === JSON.stringify(after), onUp);
                }
            }
            record(name, `${section} dialog: no controls overlap`, result.overlaps.length === 0, result.overlaps.length ? result.overlaps : undefined);
            record(name, `${section} dialog: no buttons or texts touch`, result.tight.length === 0, result.tight.length ? result.tight : undefined);
            if (name === 'desktop') await checkHover(page, layout, name, `${section} dialog`, '.MuiDialog-paper');
            if (layout.tv) {
                let reached = false;
                for (let press = 0; press < 60 && !reached; press++) {
                    // Down through the editor; Right along a row that holds a red action (the secret's Replace | Clear).
                    const inDangerRow = await page.evaluate(() => !!document.activeElement?.closest('.jfmod-secret-row, .jfmod-qrow')?.querySelector('.MuiButton-containedError, .jfmod-iconbtn-red'));
                    await page.keyboard.press(inDangerRow ? 'ArrowRight' : 'ArrowDown');
                    await page.waitForTimeout(150);
                    reached = await page.evaluate(() => !!document.activeElement?.matches('.MuiDialog-paper .MuiButton-containedError, .MuiDialog-paper .jfmod-iconbtn-red'));
                }
                record(name, `${section} dialog: a red action is reachable by the arrows`, reached);
                if (reached) {
                    // The focus fill may still be fading in: wait for the transition, then read the painted colours.
                    await page.waitForTimeout(600);
                    const focusedResult = await audit(page, '.MuiDialog-paper');
                    const focused = focusedResult.buttons.find(button => button.focused);
                    const ratio = focused && !focused.paintUnsupported ? contrast(focused.paintedFg, focused.paintedBg) : 0;
                    console.log('  shot', await shot(page, `${name}-settings-${section}-dialog-focus`));
                    record(name, `${section} dialog: the focused red action is readable (contrast ${ratio.toFixed(2)} >= 4.5) with a visible ring`,
                        ratio >= 4.5 && focused?.tint === 'red' && focused.outline?.style !== 'none' && focused.outline?.width >= 1, focused);
                    // The dialog's blue Save, focused: its fill is the focus fill's own blue, so the ring is what shows it.
                    await page.locator('.MuiDialog-paper').last().locator('.MuiDialogActions-root .MuiButton-containedPrimary').focus();
                    await page.waitForTimeout(400);
                    const saveFocus = (await audit(page, '.MuiDialog-paper')).buttons.find(button => button.focused);
                    record(name, `${section} dialog: the focused Save shows a ring and stays readable`, !!saveFocus && saveFocus.outline?.style !== 'none' &&
                        saveFocus.outline?.width >= 1 && contrast(saveFocus.paintedFg, saveFocus.paintedBg) >= 4.5, saveFocus);
                }
            }
            await dialog.locator('button', { hasText: 'Cancel' }).evaluate(el => el.click());
            await dialog.waitFor({ state: 'detached', timeout: 10000 }).catch(() => undefined);
            await page.waitForTimeout(400);
        }
        if (name === 'tv1080') {
            // Every shipped scheme on the TV: each enabled button of a section and of an indexer's editor, focused, keeps
            // 4.5:1 on what it is then painted with and shows a ring (the focus fill in a dialog is the scheme's primary).
            for (const theme of THEMES) {
                await page.evaluate(id => document.documentElement.setAttribute('data-theme', id), theme);
                await page.evaluate(() => { location.hash = '#/catalog/settings?section=discovery'; });
                await page.locator('.jfmod-check-section[data-section="discovery"]').waitFor({ state: 'visible', timeout: 30000 });
                await page.waitForTimeout(500);
                await checkStates(page, layout, name, `theme ${theme}, discovery`, 'focus');
                await page.evaluate(() => { location.hash = '#/catalog/settings?section=indexers'; });
                await page.locator('.jfmod-rowactions [data-row-action="edit"]').first().waitFor({ state: 'visible', timeout: 30000 });
                await checkStates(page, layout, name, `theme ${theme}, indexers`, 'focus');
                await page.locator('.jfmod-rowactions [data-row-action="edit"]').first().click();
                const editor = page.locator('.MuiDialog-paper').last();
                await editor.waitFor({ state: 'visible', timeout: 10000 });
                await page.waitForTimeout(500);
                await page.evaluate(() => { const content = [...document.querySelectorAll('.MuiDialog-paper .MuiDialogContent-root')].pop(); content.scrollTop = content.scrollHeight; });
                await checkStates(page, layout, name, `theme ${theme}, indexer dialog`, 'focus', '.MuiDialog-paper');
                if (theme === 'appletv') console.log('  shot', await shot(page, `${name}-theme-appletv-indexer-dialog`));
                await editor.locator('button', { hasText: 'Cancel' }).evaluate(el => el.click());
                await editor.waitFor({ state: 'detached', timeout: 10000 }).catch(() => undefined);
                await page.waitForTimeout(400);
            }
        }
        for (const step of WIZARD_STEPS) {
            await page.evaluate(id => { location.hash = '#/catalog/settings/setup?step=' + id; }, step);
            await page.locator('.jfmod-check-main .jfmod-check-section').first().waitFor({ state: 'visible', timeout: 30000 });
            await page.waitForTimeout(700);
            console.log('  shot', await shot(page, `${name}-wizard-${step}`));
            const result = await auditIdle(page, layout);
            checkButtons(name, `wizard ${step}`, result.buttons);
            checkTitleCase(name, `wizard ${step}`, await settingsTitles(page));
            record(name, `wizard ${step}: no controls overlap`, result.overlaps.length === 0, result.overlaps.length ? result.overlaps : undefined);
            record(name, `wizard ${step}: no buttons or texts touch`, result.tight.length === 0, result.tight.length ? result.tight : undefined);
            const stacked = await page.evaluate(() => {
                const sections = [...document.querySelectorAll('.jfmod-check-main .jfmod-check-section')].map(el => el.getBoundingClientRect());
                const gaps = [];
                for (let i = 1; i < sections.length; i++) gaps.push(Math.round(sections[i].top - sections[i - 1].bottom));
                const notice = document.querySelector('.jfmod-check-main > .jfmod-notice')?.getBoundingClientRect();
                return { gaps, noticeGap: notice && sections[0] ? Math.round(sections[0].top - notice.bottom) : null };
            });
            record(name, `wizard ${step}: stacked sections and the step notice are spaced apart`,
                stacked.gaps.every(gap => gap >= 8) && (stacked.noticeGap === null || stacked.noticeGap >= 8), stacked);
        }
        if (name === 'desktop' || name === 'mobile') {
            // The Dashboard page, the visual reference, opened from the dashboard drawer's own JellyfinMod entry.
            await page.evaluate(() => { location.hash = '#/dashboard'; });
            await page.waitForTimeout(4000);
            if (name === 'mobile') {
                const toggle = page.locator('button[aria-label="Open Menu"]').first();
                if (await toggle.count()) await toggle.click().catch(() => undefined);
                await page.waitForTimeout(800);
            }
            const entry = page.locator('.MuiDrawer-root a.MuiListItemButton-root').filter({ has: page.locator('.MuiListItemText-root', { hasText: /^JellyfinMod$/ }) });
            const present = await entry.count() > 0 && await entry.first().isVisible();
            const iconText = present ? await entry.first().locator('.MuiIcon-root, .material-icons').first().evaluate(el => ({
                text: el.textContent, font: getComputedStyle(el).fontFamily, width: el.getBoundingClientRect().width
            })).catch(() => null) : null;
            record(name, 'dashboard drawer lists JellyfinMod under Plugins with an icon glyph', present && !!iconText && /Material Icons/.test(iconText.font) && iconText.width < 40,
                iconText);
            if (present) {
                await entry.first().click();
                await page.locator('.jfmod-check-section, #JellyfinModConfigPage, [data-role="page"].page:not(.hide) .jfmod-check').first()
                    .waitFor({ state: 'visible', timeout: 30000 }).catch(() => undefined);
                await page.waitForTimeout(2500);
                const where = await page.evaluate(() => location.hash);
                record(name, 'the drawer entry opens the JellyfinMod configuration page', /configurationpage\?name=JellyfinMod/.test(where), where);
                record(name, 'the configuration page renders its readiness rail', await page.locator('.jfmod-check-rail:visible, .jfmod-check-steps:visible').count() > 0);
                if (name === 'mobile') {
                    const toggle = page.locator('button[aria-label="Open Menu"]').first();
                    if (await toggle.count()) await toggle.click().catch(() => undefined);
                    await page.waitForTimeout(800);
                }
                const selected = await page.evaluate(() => [...document.querySelectorAll('.MuiDrawer-root a.MuiListItemButton-root.Mui-selected')]
                    .map(el => el.querySelector('.MuiListItemText-root')?.textContent.trim()));
                record(name, 'only the JellyfinMod entry is highlighted, not Plugins', selected.length === 1 && selected[0] === 'JellyfinMod', selected);
                if (name === 'mobile') await page.keyboard.press('Escape');
                await page.waitForTimeout(500);
                console.log('  shot', await shot(page, `${name}-dashboard-page`));
                const ids = await page.evaluate(() => [...document.querySelectorAll('#JellyfinModConfigPage .jfmod-check-section')].map(el => el.dataset.section));
                for (const id of ids) {
                    await page.evaluate(section => {
                        const picker = document.querySelector('#JfmodSectionPicker');
                        const step = document.querySelector(`#JellyfinModConfigPage .jfmod-step[data-section="${section}"]`);
                        if (step && step.getBoundingClientRect().width > 0) step.click();
                        else if (picker) {
                            picker.value = section;
                            picker.dispatchEvent(new Event('change'));
                        }
                    }, id);
                    await page.waitForTimeout(600);
                    const view = await dashboardSection(page);
                    if (view?.id !== id) {
                        record(name, `dashboard page ${id}: opened`, false, view?.id);
                        continue;
                    }
                    checkDashboardSection(name, view);
                    const crowding = await page.evaluate(() => {
                        const section = [...document.querySelectorAll('#JellyfinModConfigPage .jfmod-check-section')].find(el => !el.hidden);
                        const title = section?.querySelector('.jfmod-check-sechead h2')?.getBoundingClientRect();
                        if (!title) return [];
                        return [...section.querySelectorAll('.jfmod-sec-actions button')].map(el => el.getBoundingClientRect())
                            .filter(r => r.width > 0 && r.top < title.bottom && r.bottom > title.top && r.left - title.right < 12)
                            .map(r => Math.round(r.left - title.right));
                    });
                    record(name, `dashboard page ${id}: the section's actions keep clear of its heading`, crowding.length === 0, crowding.length ? crowding : undefined);
                    if (id === 'discovery') {
                        console.log('  shot', await shot(page, `${name}-dashboard-discovery`));
                        const actions = await page.evaluate(() => [...document.querySelectorAll('[data-secret-slot="TmdbReadAccessToken"] .jfmod-secret-row button')]
                            .map(el => [el.dataset.secretAction ?? null, el.getAttribute('aria-label')]));
                        record(name, 'dashboard page: the token box holds Test Token, Replace and Clear as icons, in that order',
                            JSON.stringify(actions) === JSON.stringify([['test', 'Test Token'], ['replace', 'Replace'], ['clear', 'Clear']]), actions);
                        if (name === 'desktop') {
                            await page.locator('#TestDiscovery').click();
                            const result = page.locator('[data-notice="discovery-test"] .jfmod-notice');
                            const said = await result.waitFor({ state: 'visible', timeout: 30000 }).then(() => result.innerText(), () => '');
                            record(name, 'dashboard page: Test Token says "TMDB accepted the token. (ok)" under the box', /TMDB accepted the token\. \(ok\)/.test(said), said);
                        }
                    }
                }
                if (name === 'desktop') {
                    // The Dashboard page in every shipped scheme: kinds, sizes and 4.5:1 at rest, under the pointer and focused.
                    for (const theme of THEMES) {
                        await page.evaluate(id => document.documentElement.setAttribute('data-theme', id), theme);
                        for (const id of ['discovery', 'indexers', 'interface']) {
                            await page.evaluate(section => document.querySelector(`#JellyfinModConfigPage .jfmod-step[data-section="${section}"]`)?.click(), id);
                            await page.waitForTimeout(600);
                            const view = await dashboardSection(page);
                            if (view?.id !== id) {
                                record(name, `theme ${theme}, dashboard page ${id}: opened`, false, view?.id);
                                continue;
                            }
                            const weak = view.buttons.filter(button => !button.refused && button.contrast < 4.5)
                                .map(button => ({ text: button.text, ratio: Number(button.contrast.toFixed(2)) }));
                            record(name, `theme ${theme}, dashboard page ${id}: every button keeps 4.5:1 at rest (${view.buttons.length})`, weak.length === 0,
                                weak.length ? weak : undefined);
                            await checkDashboardStates(page, layout, name, `theme ${theme}, dashboard page ${id}`, 'hover');
                            await checkDashboardStates(page, layout, name, `theme ${theme}, dashboard page ${id}`, 'focus');
                        }
                    }
                }
                await page.evaluate(() => { try { sessionStorage.removeItem('jfmod-settings-section'); } catch { /* none */ } });
            }
        }
        // The Home setup banner shows only while setup is unfinished; when it does, its buttons follow the same rules.
        await page.evaluate(() => { location.hash = '#/home'; });
        await page.waitForTimeout(3000);
        if (await page.locator('.jfmod-setupBanner').isVisible().catch(() => false)) {
            const banner = await auditIdle(page, layout, '.jfmod-setupBanner');
            checkButtons(name, 'home setup banner', banner.buttons);
            checkTitleCase(name, 'home setup banner', banner.buttons.map(button => button.text).filter(Boolean));
        } else {
            console.log(`  [${name}] home setup banner not shown (setup is complete on this instance); not audited`);
        }
        record(name, 'no page errors', errors.length === 0, errors.length ? errors : undefined);
    } catch (error) {
        record(name, 'run completed', false, String(error.message).split('\n')[0]);
        await shot(page, `${name}-error`).catch(() => undefined);
    } finally {
        if (layout.tv) await page.evaluate(() => localStorage.removeItem('layout')).catch(() => undefined);
        await context.close();
    }
}

await browser.close();
const failed = results.filter(result => !result.ok);
console.log(`\n${results.length - failed.length} of ${results.length} passed on ${tier}`);
process.exit(failed.length && !process.env.JELLYFINMOD_DESIGN_REPORT_ONLY ? 1 : 0);
