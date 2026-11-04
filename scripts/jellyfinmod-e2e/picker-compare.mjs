/* eslint-disable compat/compat, no-restricted-globals, sonarjs/cognitive-complexity -- a Node acceptance runner, not shipped code */
/* global document, getComputedStyle */
// Release picker: the built dialog against the approved design-system source CSS and dialog/row skeleton, landmark by
// landmark. Renders the mock's cell and the real dialog (routes answer the search, progress and grab with the mock's own data)
// at the same width and base size, forces one font on both so glyph widths do not hide layout, and lists every landmark whose
// box moves by more than 1 px or whose font size, weight, colour, spacing, opacity, border or radius differ.
//   JELLYFINMOD_LIVE_URL=<local environment>  LAYOUT=desktop|tv|mobile  VIEW=1440x900
//   STATE=results|searching|hold|accepted|refused|noresults|allfailed|over  [LIGHT=1]  [REALFONT=1]  [NAMES=1: Show Names on]
import { launch, newPage, signIn, setTvLayout, api } from './live-lib.mjs';
import { search, progress } from './picker-compare-fixture.mjs';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The release picker's Quality Profile is an MUI select (P4.FU19): opens its menu and picks the option named `name` (its first
 * line, "4K (Default)" for the default), or the `index`th; returns the names the menu listed.
 */
async function pickProfile(page, { name, index }) {
    await page.locator('#jfmod-releaseProfile').click();
    const options = page.locator('[aria-label="Quality Profile"][role="menu"] [role="option"]');
    await options.first().waitFor({ state: 'visible', timeout: 10000 });
    const names = await options.evaluateAll(nodes => nodes.map(node => node.querySelector('.tx0')?.firstChild?.textContent ?? (node.querySelector('strong') ?? node).textContent));
    await options.nth(name === undefined ? index : names.indexOf(name)).click();
    await page.locator('[aria-label="Quality Profile"][role="menu"]').waitFor({ state: 'detached', timeout: 10000 }).catch(() => undefined);
    return names;
}
const MOCK = process.env.DS_MOCKUP || fileURLToPath(new URL('../../../../../../reviews/design-system/', import.meta.url));
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
await page.locator('.jfmod-dsTitleHost .actbar [data-ds-command~=jfmod-getRelease]').first().click();
await page.waitForSelector('.pickerDialog .picker');
if (state === 'searching') await page.waitForTimeout(6300);
else if (state === 'over') {
    await page.waitForSelector('.rels .rel'); await page.waitForTimeout(700);
    gateOn = true; await pickProfile(page, { index: 1 }); await page.waitForTimeout(6300);
}
else if (state === 'noresults' || state === 'allfailed') { await page.waitForSelector('.sblock.dimmed, .sblock.err'); await page.waitForTimeout(700); }
else {
    await page.waitForSelector('.rels .rel'); await page.waitForTimeout(700);
    if (GRAB) { await page.locator('.rels .rel').nth(GRAB[1]).locator('[data-jfmod-release-add]').click(); await page.mouse.move(5, 5); await page.evaluate(() => document.activeElement?.blur()); await page.waitForTimeout(700); }
    else { await page.locator('.rejt').click(); await page.waitForTimeout(300); }
    // Show Names is off by default (user, 2026-10-11); NAMES=1 turns it on through the toggle, as a person would.
    if (names) await page.locator('.pickerDialog .dlghead [aria-pressed]').click();
    await page.waitForTimeout(400);
}
const real = await collect(page, 'real');

const dlgBox = await page.locator('.pickerDialog').boundingBox();
const rootFs = await page.locator('.pickerDialog').evaluate(node => parseFloat(getComputedStyle(node).fontSize));
await page.screenshot({ path: `${OUT}/real-${tag}.png`, clip: dlgBox });
// ---- the approved source CSS, with identical content at the same width and root size.
// Native control tags are reduced to the mockup's inert spans/divs. The source renderers are loaded independently to check
// the shared dialog/row skeleton, so the CSS comparison does not accidentally bless an upstream row structure.
const mp = await (await browser.newContext({ viewport: { width: vw, height: vh } })).newPage();
await mp.route('**/*', route => route.abort());
await mp.setContent('<html><body></body></html>');
const sourceCss = [new URL('../tmdb-search-design/mockup/chrome.css', 'file://' + MOCK + '/').pathname, MOCK + '/spinner.css', MOCK + '/ds.css']
    .map(file => readFileSync(file, 'utf8')).join('\n');
await mp.addStyleTag({ content: sourceCss });
for (const file of ['data.js', 'ds.js', 'ds2.js']) await mp.addScriptTag({ content: readFileSync(MOCK + '/' + file, 'utf8') });
const specimen = await page.locator('.pickerDialog').evaluate(node => ({ html: node.outerHTML, classes: node.closest('.jfds').className,
    theme: node.closest('.jfds').dataset.theme, root: getComputedStyle(node.closest('.jfds')).fontSize, height: node.clientHeight }));
await mp.evaluate(({ specimen, width, layout }) => {
    document.documentElement.className = specimen.classes.replace(/jfds|dialogportal/g, '');
    document.documentElement.dataset.theme = specimen.theme;
    document.documentElement.style.fontSize = specimen.root;
    DS.ctx.kind = layout === 'mobile' ? 'phone' : layout === 'tv' ? 'tv' : 'computer';
    const source = document.createElement('div');
    source.innerHTML = DS.pages.picker('replace');
    const approved = source.querySelector('.dialog.wide');
    if (!approved?.querySelector('.dlghead + .dlgbody .rels .rel > .rl > .rq')) throw new Error('Approved picker skeleton not found');
    const template = document.createElement('div');
    template.innerHTML = specimen.html;
    const clone = template.firstElementChild;
    if (!clone.querySelector('.dlghead + .dlgbody .rels .rel > .rl > .rq') && clone.querySelector('.rel')) throw new Error('Built picker does not use the approved skeleton');
    clone.id = 'mockdlg';
    clone.style.width = width + 'px';
    clone.style.maxWidth = 'none';
    clone.style.maxHeight = specimen.height + 'px';
    clone.style.overflowY = 'auto';
    clone.querySelectorAll('button.rb, button.rejt').forEach(button => {
        const inert = document.createElement(button.classList.contains('rejt') ? 'div' : 'span');
        for (const attr of button.attributes) inert.setAttribute(attr.name, attr.value);
        inert.innerHTML = button.innerHTML;
        button.replaceWith(inert);
    });
    document.body.style.margin = '0';
    document.body.append(clone);
}, { specimen, width: dlgBox.width, layout });
if (!process.env.REALFONT) await mp.addStyleTag({ content: FONT });
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
        const root = side === 'mock' ? document.querySelector('#mockdlg') : document.querySelector('.pickerDialog');
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
        const selectors = {
            title: '.dlghead h3', close: '.dlghead [aria-label="Close"]', closeIcon: '.dlghead [aria-label="Close"] svg',
            selLabel1: '.pmchoices .fld:first-child .lb', selValue1: '.pmchoices .fld:first-child .v',
            selLabel2: '.pmchoices .fld:nth-child(2) .lb', selValue2: '.pmchoices .fld:nth-child(2) .v',
            notice: '.pnotice', status: '.pstatus', ring: '.gl', ringCaption: '.cap1', indexerLines: '.sblock',
            rejectedToggle: '.rejt', grab: '.grab', grabSentence: '.grab .s', grabButton: '.grab .flat', grabFile: '.grab .rname'
        };
        for (const [name, selector] of Object.entries(selectors)) add(name, selector, selector);
        for (let i = 0; i < 4; i++) {
            for (const [name, selector] of Object.entries({ ixLine: '.sl', ixDot: '.sl i', ixName: '.sl > span:first-child', ixState: '.sl > span:last-child' })) add(name+i, selector, selector, i);
        }
        [...root.querySelectorAll('.rel')].forEach((it, i) => {
            const n = 'row' + i;
            out[n] = metrics(it);
            out[n + '.rowbtn'] = metrics(it);
            const parts = { l1: '.rl', q: '.rq', fl: '.rflag.fl', proper: '.rflag.pr', held: '.incheck',
                right: '.rcols', size: '.sz', seeds: '.sd', indexer: '[data-ds-indexer]', l2: '.rl + .rl', raw: '.rname', reasons: '.rreason', acts: '.ract' };
            for (const [name, selector] of Object.entries(parts)) out[n+'.'+name] = metrics(it.querySelector(selector));
            for (const [name, selector] of [['lg','.rlang'],['mk','.mk'],['action','.ract .rb']]) for (let index=0;index<2;index++) out[n+'.'+name+index] = metrics(it.querySelectorAll(selector)[index]);
        });
        for (const k of Object.keys(out)) if (out[k] === null) delete out[k];
        return out;
    }, side);
}
