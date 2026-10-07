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
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const testUrl = new URL(process.env.JELLYFINMOD_TEST_URL ?? (() => { throw new Error('JELLYFINMOD_TEST_URL is required'); })());
if (!['28096', '18096'].includes(testUrl.port)) throw new Error('Runs on the isolated instances only');
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
    const buttons = [...root.querySelectorAll('button.MuiButton-root')].filter(visible).map(el => {
        const s = getComputedStyle(el);
        unsupported = null;
        const paintedBg = surface(el);
        const paintUnsupported = unsupported;
        const behind = el.parentElement ? surface(el.parentElement) : [0, 0, 0];
        return { text: el.textContent.trim(), variant: variant(el), bg: s.backgroundColor, color: s.color, borderWidth: s.borderTopWidth,
            borderColor: s.borderTopColor, danger: el.classList.contains('jfmod-danger-text'), inRow: !!el.closest('.jfmod-rowactions'), inSecret: !!el.closest('.jfmod-secret-row'), boxText: el.closest('.jfmod-secret-row') ? getComputedStyle(el.closest('.jfmod-secret-row')).color : null,
            disabled: el.disabled, focused: el === document.activeElement,
            paintedFg: over(rgba(s.color), paintedBg), paintedBg, paintedBorder: over(rgba(s.borderTopColor), behind), paintUnsupported };
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
                if (gapX < 6 && (a.el.matches('button, .jfmod-savemeta, .fieldDescription') && b.el.matches('button, .jfmod-savemeta, .fieldDescription'))) {
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
 * The role each button of the settings area has, by its words (and, for Test, whether it sits in a list row): commits
 * fill, section actions are outlined, inline actions are text, Clear / Remove / Delete are red text. A button this map
 * does not know fails, so a new one has to be classified on purpose.
 */
const ROLES = {
    contained: ['Save', 'Saving…', 'Continue', 'Add Prowlarr'],
    outlined: ['Test', 'Add mapping', 'Save mappings', 'Test import path', 'Run now', 'Restore stock now', 'Add indexer', 'Add profile', 'Sync now', 'Edit'],
    text: ['Replace', 'Undo', 'Keep the saved one', 'Fix', 'Up', 'Make default', 'Cancel', 'Retry', 'Reload', 'Dismiss'],
    danger: ['Clear', 'Remove', 'Delete']
};
const expectedFor = button => {
    if (button.text === 'Test' && button.inRow) return 'text';
    return Object.keys(ROLES).find(role => ROLES[role].includes(button.text)) ?? null;
};
const PRIMARY = 'rgb(0, 164, 220)';
const ERROR = 'rgb(198, 40, 40)';
const ON_PRIMARY = 'rgba(0, 0, 0, 0.87)';
/** MUI's dark-mode disabled text and disabled fill. */
const DISABLED = 'rgba(255, 255, 255, 0.3)';
const DISABLED_FILL = 'rgba(255, 255, 255, 0.12)';
/** No fill: any colour at alpha 0 (a tint still fading out after a state change is the same). */
const isClear = bg => /^rgba\(.*,\s*0\)$/.test(bg);
/** A border in the primary hue, at least faintly visible (MUI draws outlined borders at half the primary's alpha). */
const primaryBorder = colour => {
    const [r, g, b, a = 1] = colour.match(/[\d.]+/g).map(Number);
    return r === 0 && g === 164 && b === 220 && a >= 0.3;
};
/**
 * The variant class and what it computes to, idle and enabled: commits fill primary with dark text readable on it;
 * outlined and text actions are primary text on no fill, outlined with a visible primary border; danger is red text on no
 * fill. Disabled buttons show MUI's disabled grey. Every enabled non-danger button's painted text keeps a contrast of 3.
 */
const looksWrong = button => {
    const want = expectedFor(button);
    // A focused control on the TV takes the focus fill; it is checked for contrast instead.
    const idle = !button.focused;
    const readable = contrast(button.paintedFg, button.paintedBg) >= 3;
    const shape = {
        contained: button.variant === 'contained' && button.borderWidth === '0px',
        outlined: button.variant === 'outlined' && button.borderWidth === '1px',
        text: button.variant === 'text' && button.borderWidth === '0px',
        danger: button.variant === 'text' && button.borderWidth === '0px' && button.danger
    }[want];
    if (!shape || button.paintUnsupported) return true;
    // Focused (the TV's fill in a dialog): whatever the fill, the text on it must stay readable.
    if (!idle) return !button.disabled && !readable;
    if (button.disabled) {
        return button.color !== DISABLED || (want === 'contained' ? button.bg !== DISABLED_FILL : !isClear(button.bg)) ||
            (want === 'outlined' && button.borderColor !== DISABLED_FILL);
    }
    switch (want) {
        case 'contained': return button.bg !== PRIMARY || button.color !== ON_PRIMARY || !readable;
        case 'outlined': return !isClear(button.bg) || button.color !== PRIMARY || !primaryBorder(button.borderColor) || !readable;
        // On the secret's filled box, Replace and Undo take the box's own text colour (white in the dark theme), as on the
        // Dashboard page.
        case 'text': return !isClear(button.bg) || button.color !== (button.inSecret ? button.boxText : PRIMARY) || !readable;
        // The theme's error red on the dark paper is about 2:1, as on the Dashboard page; it is red by design, not gated on contrast.
        default: return !isClear(button.bg) || button.color !== ERROR;
    }
};
const checkButtons = (layout, where, buttons) => {
    const wrong = buttons.filter(looksWrong).map(button => ({ ...button, expected: expectedFor(button) }));
    record(layout, `${where}: every button carries its deliberate variant and look (${buttons.length} buttons)`, wrong.length === 0,
        wrong.length ? wrong : undefined);
};

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
        for (const id of SECTION_IDS) {
            await page.evaluate(section => { location.hash = '#/catalog/settings?section=' + section; }, id);
            await page.locator(`.jfmod-check-section[data-section="${id}"]`).waitFor({ state: 'visible', timeout: 30000 });
            await page.waitForTimeout(700);
            const file = await shot(page, `${name}-settings-${id}`);
            const result = await auditIdle(page, layout);
            checkButtons(name, `settings ${id}`, result.buttons);
            record(name, `settings ${id}: no controls overlap`, result.overlaps.length === 0, result.overlaps.length ? result.overlaps : undefined);
            record(name, `settings ${id}: no buttons or texts touch`, result.tight.length === 0, result.tight.length ? result.tight : undefined);
            record(name, `settings ${id}: no horizontal scroll`, result.overflow <= 0, result.overflow > 0 ? result.overflow : undefined);
            console.log('  shot', file);
        }
        // The secret's Replace state and its Clear-pending state, put back with Keep / Undo; nothing is saved.
        await page.evaluate(() => { location.hash = '#/catalog/settings?section=discovery'; });
        await page.locator('.jfmod-check-section[data-section="discovery"]').waitFor({ state: 'visible', timeout: 30000 });
        await page.waitForTimeout(500);
        if (await page.locator('.jfmod-secret-row button', { hasText: 'Replace' }).count()) {
            await page.locator('.jfmod-secret-row button', { hasText: 'Replace' }).click();
            await page.waitForTimeout(300);
            console.log('  shot', await shot(page, `${name}-settings-discovery-replacing`));
            const replacing = await auditIdle(page, layout);
            checkButtons(name, 'discovery while replacing', replacing.buttons);
            record(name, 'discovery while replacing: no overlaps or touching', !replacing.overlaps.length && !replacing.tight.length,
                [...replacing.overlaps, ...replacing.tight]);
            await page.locator('.jfmod-secret button', { hasText: 'Keep the saved one' }).click();
            await page.locator('.jfmod-secret-row button', { hasText: 'Clear' }).click();
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
            await page.locator('button[data-test="discovery"]').click();
            const notice = page.locator('.jfmod-check-section[data-section="discovery"] .jfmod-notice');
            await notice.waitFor({ state: 'visible', timeout: 30000 });
            const said = await notice.innerText();
            record(name, 'discovery Test reports a sentence and a code', /\(\w+\)/.test(said), said);
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
            const edit = page.locator('.jfmod-rowactions button', { hasText: 'Edit' }).first();
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
            record(name, `${section} dialog: no controls overlap`, result.overlaps.length === 0, result.overlaps.length ? result.overlaps : undefined);
            record(name, `${section} dialog: no buttons or texts touch`, result.tight.length === 0, result.tight.length ? result.tight : undefined);
            if (layout.tv) {
                let reached = false;
                for (let press = 0; press < 60 && !reached; press++) {
                    // Down through the editor; Right along a row that holds a red action (the secret's Replace | Clear).
                    const inDangerRow = await page.evaluate(() => !!document.activeElement?.closest('.jfmod-secret-row, .jfmod-qrow')?.querySelector('.jfmod-danger-text'));
                    await page.keyboard.press(inDangerRow ? 'ArrowRight' : 'ArrowDown');
                    await page.waitForTimeout(150);
                    reached = await page.evaluate(() => !!document.activeElement?.matches('.MuiDialog-paper .jfmod-danger-text'));
                }
                record(name, `${section} dialog: a red action is reachable by the arrows`, reached);
                if (reached) {
                    // The focus fill may still be fading in: wait for the transition, then read the painted colours.
                    await page.waitForTimeout(600);
                    const focusedResult = await audit(page, '.MuiDialog-paper');
                    const focused = focusedResult.buttons.find(button => button.focused);
                    const ratio = focused && !focused.paintUnsupported ? contrast(focused.paintedFg, focused.paintedBg) : 0;
                    console.log('  shot', await shot(page, `${name}-settings-${section}-dialog-focus`));
                    record(name, `${section} dialog: the focused red action is readable (contrast ${ratio.toFixed(2)} >= 3)`, ratio >= 3 && !!focused?.danger,
                        focused);
                }
            }
            await dialog.locator('button', { hasText: 'Cancel' }).evaluate(el => el.click());
            await dialog.waitFor({ state: 'detached', timeout: 10000 }).catch(() => undefined);
            await page.waitForTimeout(400);
        }
        for (const step of WIZARD_STEPS) {
            await page.evaluate(id => { location.hash = '#/catalog/settings/setup?step=' + id; }, step);
            await page.locator('.jfmod-check-main .jfmod-check-section').first().waitFor({ state: 'visible', timeout: 30000 });
            await page.waitForTimeout(700);
            console.log('  shot', await shot(page, `${name}-wizard-${step}`));
            const result = await auditIdle(page, layout);
            checkButtons(name, `wizard ${step}`, result.buttons);
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
            }
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
