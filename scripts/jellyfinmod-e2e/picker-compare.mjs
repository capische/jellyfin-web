/* eslint-disable compat/compat, no-restricted-globals, sonarjs/cognitive-complexity -- a Node acceptance runner, not shipped code */
/* global document, getComputedStyle */
// Release picker: the built dialog against the approved mock (docs/jellyfinmod/design/release-picker-design.html), landmark by
// landmark. Renders the mock's cell and the real dialog (routes answer the search, progress and grab with the mock's own data)
// at the same width and base size, forces one font on both so glyph widths do not hide layout, and lists every landmark whose
// box moves by more than 1 px or whose font size, weight, colour, spacing, opacity, border or radius differ.
//   JELLYFINMOD_LIVE_URL=<local environment>  LAYOUT=desktop|tv|mobile  VIEW=1440x900
//   STATE=results|searching|hold|accepted|refused|noresults|allfailed|over  [LIGHT=1]  [REALFONT=1]  [NAMES=1: Show Names on]
import { launch, newPage, signIn, setTvLayout, api } from './live-lib.mjs';
import { search, progress } from './picker-compare-fixture.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The release picker's Quality Profile is an MUI select (P4.FU19): opens its menu and picks the option named `name` (its first
 * line, "4K (Default)" for the default), or the `index`th; returns the names the menu listed.
 */
async function pickProfile(page, { name, index }) {
    await page.locator('#jfmod-releaseProfile').click();
    const options = page.locator('.jfmod-releaseProfileMenu [role="option"]');
    await options.first().waitFor({ state: 'visible', timeout: 10000 });
    const names = await options.evaluateAll(nodes => nodes.map(node => (node.querySelector('strong') ?? node).textContent));
    await options.nth(name === undefined ? index : names.indexOf(name)).click();
    await page.locator('.jfmod-releaseProfileMenu').waitFor({ state: 'detached', timeout: 10000 }).catch(() => undefined);
    return names;
}
const MOCK = fileURLToPath(new URL('../../docs/jellyfinmod/design/release-picker-design.html', import.meta.url));
const OUT = process.env.JELLYFINMOD_COMPARE_OUT ?? 'picker-compare-out';
mkdirSync(OUT, { recursive: true });
const layout = process.env.LAYOUT ?? 'desktop';
const [vw, vh] = (process.env.VIEW ?? '1440x900').split('x').map(Number);
const state = process.env.STATE ?? 'results';
const light = process.env.LIGHT === '1';
const names = process.env.NAMES === '1';
const tag = `${layout}-${vw}x${vh}-${state}${light ? '-light' : ''}`;
const browser = await launch();
const ctxOptions = { viewport: { width: vw, height: vh } };
// ---- the real dialog
const { context, page } = await newPage(browser, layout === 'mobile' ? 'mobile' : 'desktop', ctxOptions);
await signIn(page);
if (layout === 'tv') await setTvLayout(page);
const detail = await api(page, 'GET', 'JellyfinMod/Entries/c01abd2729544572a95cafed3744429b');
const ep = detail.body.episodes[0];
let release;
const gate = new Promise(r => { release = r; });
const GRAB = { hold: ['pending', 0], accepted: ['accepted', 0], refused: ['failed', 2] }[state];
const op = () => ({ id: '22222222-2222-2222-2222-222222222222', state: GRAB[0], active: GRAB[0] === 'pending', cancellable: GRAB[0] === 'pending', entryId: 'c01abd2729544572a95cafed3744429b', episodeId: ep.id,
    releaseTitle: ['The.Series.S02E04.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR10Plus.H.265-FLUX', '', 'The.Series.S02E04.PROPER.1080p.BluRay.x264.DTS-HD.MA.7.1-FraMeSToR'][GRAB[1]], indexerName: 'x', quality: 'x', size: 1, infoHash: null, score: 1, seedRatio: null, seedMinutes: null,
    holdUntil: new Date(opEnd).toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), submittedAt: null, acceptedAt: null, cancelledAt: null, failureCode: null,
    message: GRAB[0] === 'failed' ? 'The download client refused the torrent: duplicate info hash.' : '', openUrl: GRAB[0] === 'accepted' ? 'http://client.invalid/' : null });
let opEnd = Date.now() + 8300;
if (GRAB) {
    await page.route(/\/JellyfinMod\/Releases\/Grab$/, route => { opEnd = Date.now() + 8300; route.fulfill({ status: 202, json: op() }); });
    await page.route(/\/JellyfinMod\/Grabs\//, route => route.fulfill({ json: op() }));
}
await page.route(/\/JellyfinMod\/Releases\/Progress\//, route => route.fulfill({ json: progress() }));
let gateOn = state === 'searching';
const answer = () => {
    const a = search(ep.id);
    if (state === 'noresults' || state === 'allfailed') {
        a.candidates = []; a.eligibleCount = 0; a.rejectedCount = 0; a.partial = false;
        a.indexers = a.indexers.map(i => state === 'noresults' ? (i.name === 'RARBG' ? i : { ...i, status: 'no_results', resultCount: 0 }) : { ...i, status: i.name === 'TorrentGalaxy' ? 'timeout' : i.name === '1337x' ? 'rate_limited' : 'breaker_open', message: null, resultCount: 0, retryAfterSeconds: 600 });
    }
    return a;
};
await page.route(/\/JellyfinMod\/Releases\?/, async route => { if (gateOn) await gate; await route.fulfill({ json: answer() }); });
const FONT = 'html body *:not(.material-icons), .formDialog *:not(.material-icons) { font-family: Arial, Helvetica, sans-serif !important; }';
if (!process.env.REALFONT) await page.addStyleTag({ content: FONT });
if (light) await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
await page.evaluate(id => { location.hash = '#/details?id=' + id; }, ep.jellyfinItemId);
await page.locator('.mainDetailButtons .jfmod-getRelease').first().click();
await page.waitForSelector('.jfmod-releaseDialog .jfmod-releasePicker');
if (state === 'searching') await page.waitForTimeout(6300);
else if (state === 'over') {
    await page.waitForSelector('.jfmod-releaseList .jfmod-releaseItem'); await page.waitForTimeout(700);
    gateOn = true; await pickProfile(page, { index: 1 }); await page.waitForTimeout(6300);
}
else if (state === 'noresults' || state === 'allfailed') { await page.waitForSelector('.jfmod-searchBlock--quiet, .jfmod-searchBlock--error'); await page.waitForTimeout(700); }
else {
    await page.waitForSelector('.jfmod-releaseList .jfmod-releaseItem'); await page.waitForTimeout(700);
    if (GRAB) { await page.locator('.jfmod-releaseList .jfmod-releaseItem').nth(GRAB[1]).locator('[data-jfmod-release-add]').click(); await page.mouse.move(5, 5); await page.evaluate(() => document.activeElement?.blur()); await page.waitForTimeout(700); }
    else { await page.locator('.jfmod-rejectedToggle').click(); await page.waitForTimeout(300); }
    // Show Names is off by default (user, 2026-10-11); NAMES=1 turns it on through the toggle, as a person would.
    if (names) await page.locator('.jfmod-namesToggle').click();
    await page.waitForTimeout(400);
}
const real = await collect(page, 'real');

const dlgBox = await page.locator('.jfmod-releaseDialog').boundingBox();
const rootFs = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
await page.screenshot({ path: `${OUT}/real-${tag}.png`, clip: dlgBox });
// ---- the mock, at the real dialog's width and base size
const mp = await (await browser.newContext({ viewport: { width: vw, height: vh } })).newPage();
await mp.goto('file://' + MOCK);
if (!process.env.REALFONT) await mp.addStyleTag({ content: FONT });
const mockCell = { desktop: { results: [0, 1], searching: [0, 0], hold: [0, 3], accepted: [0, 4], refused: [0, 6], noresults: [1, 0], allfailed: [1, 1], over: [1, 2] }, tv: { results: [2, 0], searching: [0, 0] }, mobile: { results: [2, 1], searching: [2, 2] } }[layout][state];
await mp.evaluate(({ mockCell, width, rootFs, state, light, names }) => {
    const all = [...document.querySelectorAll('.dlg')];
    let d;
    if (Array.isArray(mockCell)) d = document.querySelectorAll('section')[mockCell[0]].querySelectorAll('.dlg')[mockCell[1]];
    else d = all.filter(x => x.classList.contains(mockCell))[state === 'searching' ? 0 : 0];
    document.querySelectorAll('body > *').forEach(n => { n.style.display = 'none'; });
    const clone = d.cloneNode(true);
    clone.id = 'mockdlg';
    if (light) clone.classList.add('light');
    const fontPx = clone.classList.contains('tv') ? 20 : clone.classList.contains('mob') ? 14.4 : 16;

    clone.style.width = width + 'px'; clone.style.fontSize = fontPx + 'px';
    document.body.style.padding = '0'; document.body.appendChild(clone);
    const q4 = clone.querySelectorAll('.item')[4]?.querySelector('.q'); if (q4 && q4.textContent === '720p WEB') q4.textContent = '720p WEB-DL';
    // the DTS wordmark is replaced by this fork's own family mark + text, so the mock's dts/variant pair becomes one text mark
    for (const d of clone.querySelectorAll('.mk.dts')) { const sub = d.nextElementSibling; d.className = 'mk txt'; d.textContent = 'DTS-HD MA'; sub?.remove(); }
    // The mock's hover/focus reveal was rejected; its `.hov` class is only the way to draw the names-on third line.
    for (const item of clone.querySelectorAll('.item')) { item.classList.remove('hov', 'foc'); if (names) item.classList.add('hov'); }
    clone.style.position = 'absolute'; clone.style.left = '0'; clone.style.top = '0';
}, { mockCell, width: dlgBox.width, rootFs, state, light, names });
const mock = await collect(mp, 'mock');
await mp.screenshot({ path: `${OUT}/mock-${tag}.png`, clip: { x: 0, y: 0, width: dlgBox.width, height: Math.min(Math.ceil(mock.dialog.h), vh) } });
// ---- compare
const keys = ['x', 'y', 'w', 'h', 'fs', 'fw', 'color', 'ls', 'lh', 'ff', 'bg', 'op', 'bb', 'br'];
const rows = [];
for (const name of Object.keys(mock)) {
    const a = mock[name], b = real[name];
    if (!a) continue;
    if (!b) { rows.push({ name, missing: 'real' }); continue; }
    if (a.w === 0 && a.h === 0 && b.w === 0 && b.h === 0) continue;
    if ((a.w === 0 && a.h === 0) !== (b.w === 0 && b.h === 0)) { rows.push({ name, diff: { hidden: [a.w === 0, b.w === 0] } }); continue; }
    const diff = {};
    for (const k of keys) {
        if (typeof a[k] === 'number' ? Math.abs(a[k] - b[k]) > 1 : a[k] !== b[k]) diff[k] = [a[k], b[k]];
    }
    if (Object.keys(diff).length) rows.push({ name, diff });
}
for (const name of Object.keys(real)) if (!mock[name]) rows.push({ name, missing: 'mock' });
writeFileSync(`${OUT}/diff-${tag}.json`, JSON.stringify({ mock, real, rows }, null, 1));
console.log(tag, 'landmarks', Object.keys(mock).length, 'differences', rows.length);
for (const r of rows) console.log(' ', r.name, r.missing ? 'MISSING in ' + r.missing : JSON.stringify(r.diff));
release();
await browser.close();

async function collect(pg, side) {
    return pg.evaluate(side => {
        const root = side === 'mock' ? document.querySelector('#mockdlg') : document.querySelector('.jfmod-releaseDialog');
        const o = root.getBoundingClientRect();
        const rgb = c => c;
        const metrics = el => {
            if (!el) return null;
            const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
            return { x: Math.round((r.left - o.left) * 10) / 10, y: Math.round((r.top - o.top) * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10,
                fs: cs.fontSize, fw: cs.fontWeight, color: rgb(cs.color), ls: cs.letterSpacing, lh: cs.lineHeight, ff: cs.fontFamily.split(',')[0].replace(/"/g, ''),
                bg: cs.backgroundColor, op: cs.opacity, bb: cs.borderBottomWidth + ' ' + cs.borderBottomColor, br: cs.borderTopLeftRadius };
        };
        const q = (sel, i = 0, within = root) => within.querySelectorAll(sel)[i] ?? null;
        const M = side === 'mock';
        const out = {};
        const add = (name, mockSel, realSel, i = 0, within) => { out[name] = metrics(q(M ? mockSel : realSel, i, within ?? root)); };
        out.dialog = metrics(root);
        add('title', '.ttl', '.formDialogHeaderTitle');
        add('close', '.act.close', '.btnCancel');
        add('closeIcon', '.act.close svg', '.btnCancel svg');
        add('selLabel1', '.sel > span', '.jfmod-releaseControls .selectContainer label');
        add('selValue1', '.sel b', '.jfmod-releaseControls .selectContainer select');
        add('selLabel2', '.sel > span', '.jfmod-releaseControls .selectContainer label', 1);
        add('selValue2', '.sel b', '.jfmod-releaseControls .selectContainer select', 1);
        add('notice', '.notice', '.jfmod-releaseNotice--info');
        add('status', '.stat', '.jfmod-releaseStatus');
        add('partial', '.partial', '.jfmod-releaseNotice:not(.jfmod-releaseNotice--info)');
        add('ring', '.big', '.jfmod-searchGlyph');
        add('ringCaption', '.cap', '.jfmod-searchCaption');
        add('indexerLines', '.ixs', '.jfmod-searchIndexers');
        for (let i = 0; i < 4; i++) { add('ixLine' + i, '.ix', '.jfmod-searchIndexer', i); add('ixDot' + i, '.ix .dot', '.jfmod-searchIndexer-dot', i, q(M ? '.ix' : '.jfmod-searchIndexer', i)); add('ixName' + i, '.ix .nm', '.jfmod-searchIndexer-name', i); add('ixState' + i, '.ix .st', '.jfmod-searchIndexer-state', i); }
        const items = M ? [...root.querySelectorAll('.item')] : [...root.querySelectorAll('.jfmod-releaseItem')];
        items.slice(0, 7).forEach((it, i) => {
            const n = 'row' + i;
            out[n] = metrics(it);
            const s = (a, b, idx = 0) => metrics(it.querySelectorAll(M ? a : b)[idx] ?? null);
            out[n + '.rowbtn'] = s('.rowbtn', '.jfmod-releaseRow');
            out[n + '.l1'] = s('.l1', '.jfmod-releaseLine');
            out[n + '.q'] = s('.q', '.jfmod-releaseQuality');
            out[n + '.fl'] = s('.flag.fl', '.jfmod-releaseFlag--freeleech');
            out[n + '.proper'] = s('.bd.note', '.jfmod-releaseBadge--note');
            out[n + '.held'] = s('.flag.lib', '.jfmod-releaseFlag--held');
            out[n + '.lg0'] = s('.lg', '.jfmod-releaseLang', 0);
            out[n + '.lg1'] = s('.lg', '.jfmod-releaseLang', 1);
            out[n + '.right'] = s('.ixr', '.jfmod-releaseRight');
            out[n + '.size'] = s('.col.sz', '.jfmod-releaseCol--size');
            out[n + '.seeds'] = s('.col.seeds', '.jfmod-releaseCol--seeds');
            out[n + '.indexer'] = s('.col.ixn', '.jfmod-releaseCol--indexer');
            out[n + '.l2'] = s('.l2', '.jfmod-releaseLine2');
            out[n + '.mk0'] = s('.mk', '.jfmod-releaseMark', 0);
            out[n + '.mk1'] = s('.mk', '.jfmod-releaseMark', 1);
            out[n + '.raw'] = s('.raw', '.jfmod-releaseTitle');
            out[n + '.reasons'] = s('.reasons', '.jfmod-releaseReasons');
            out[n + '.acts'] = s('.acts', '.jfmod-releaseActions');
            out[n + '.add'] = s('.act', '.jfmod-releaseAction', 0);
            out[n + '.replace'] = s('.act', '.jfmod-releaseAction', 1);
        });
        add('rejectedToggle', '.rejt .btn', '.jfmod-rejectedToggle');
        add('grab', '.gs', '.jfmod-grabStatus'); add('grabSentence', '.gs > span', '.jfmod-grabStatus > span'); add('grabButton', '.gs .btn', '.jfmod-grabOpen'); // the hold's Cancel moved to the row's X (2026-10-12); this mock still draws it add('grabFile', '.gs .gsraw', '.jfmod-grabStatus-title');
        for (const k of Object.keys(out)) if (out[k] === null) delete out[k];
        return out;
    }, side);
}
