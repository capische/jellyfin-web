/* eslint-disable compat/compat, no-restricted-globals, @stylistic/max-statements-per-line, no-empty-function, sonarjs/cognitive-complexity -- a Node acceptance runner, not shipped code */
/* global window, document, ApiClient, localStorage, location, getComputedStyle, coverOf */
// Every season and every episode on the native pages (P1.FU11, design approved 2026-10-12; UX §3.1 and §7.4).
// Signed in as oleksii with an empty password (and, when given, an ordinary user with an empty password), in a real browser
// against a running mod instance, it checks for one series entry:
//   - the native series page shows one mod card per plugin season (other than specials) with no Jellyfin season item, in season
//     order among upstream's cards, with the dashed placeholder, "Season N", "K episodes" and the right mark top right; the
//     cards come back in place when the list is redrawn;
//   - P1.FU17: upstream's own season cards carry the mark when none of the season's episodes is on disk (Not Downloaded, or the
//     Unaired clock), whatever the watched state, just left of upstream's tick or count with neither covering the other, and no
//     mark when one episode is on disk; the mark comes back when upstream redraws a card; an administrator's opens the picker
//     on that season (on the TV Up on the card reaches it); the Not Downloaded glyph is the arrow out of a small cloud;
//   - P1.FU17, downloads on upstream's season cards (administrator; INTERCEPTED QUEUE ANSWER, NOT A LIVE DOWNLOAD: the browser's
//     `GET /JellyfinMod/Queue` is answered with a season pack for an empty native season, preferably one listed under another
//     Jellyfin series item than the page's, as 1923's on 28096, and one episode of a native season with files): those two
//     season cards show the bar and the arrow (in the count pill, or the disc), the empty season's Not Downloaded hidden by it;
//     every other season card shows no download;
//   - P1.FU19 (user 2026-10-13): every Not Downloaded and Unaired mark is a plain indicator for everyone (not a button, no focus
//     stop, no pointer, a hover changes nothing on it, the tooltip kept), and so is the download disc on a card; a card with
//     nothing on disk shows no Play: on the desktop an administrator's hover shows Get a Release in the centre where Play was
//     (upstream's season cards with no episode on disk, the mod's missing season cards, a file-less movie's card), no second
//     cloud in the bottom row, the keyboard's Tab reaches it and never a Play; it opens the release picker on that season
//     (Season N and All Seasons only) without leaving the page; an ordinary user's hover shows neither; a season with files
//     keeps upstream's Play; on the TV the card holds no second stop; a missing episode's page shows the episode's download on
//     its still (since P1.FU20 its download block, below); a row's mark and disc are the
//     size of upstream's round row buttons (box and glyph, measured against the row's heart or More button);
//   - P1.FU21: every upstream season card carries the mod cards' "N episodes" line under "Season N": Jellyfin's own count of the
//     season's episodes (ChildCount; for a season Jellyfin keeps with no episode, the entry's list, as the mod's cards count),
//     once, in the mod cards' element and classes with the same computed look, right under the title, the cover unchanged; it
//     comes back once when upstream redraws the card; a native season page carries none;
//   - a missing season card opens the mod's season page (#/details?entryId=…&season=N), which lists that season's episodes as
//     mod rows in episode order with their marks; an administrator's Not Downloaded on an episode's row opens the picker for that episode (P1.FU22);
//   - a native season page with missing episodes shows mod rows in episode order among upstream's rows;
//   - TV: the D-pad stops on the mod rows and on no mark; phone: no overview on the rows;
//   - optionally a file-less movie's search card: the Not Downloaded indicator, and the centre Get a Release on hover;
//   - P1.FU14: a missing season's card shows TMDB's season poster (w342) in upstream's image box, the dashed placeholder only
//     without one; the mod's season page the season's overview and "Season N · K episodes · YYYY"; every mod episode row the
//     still (w300, w500 on the TV), "N. Title", the meta line (air date, upstream's runtime "42m", TMDB's rating) and the
//     overview. Images come from image.tmdb.org: the img's src and a request to it are checked; one that did not load
//     (offline, a blocked CDN) is NOT VERIFIED and must fall back to the placeholder.
//   - P1.FU15: a missing episode's row opens its page (#/details?entryId=…&season=N&episode=M; a click, Enter on the TV, where
//     the row is a focus stop and Right reaches its icon); the page reads "Series" / "Season N - M. Title", the meta line, TMDB's
//     still with the mark, the overview, the Director and Writer lines, Cast & Crew (the series' regulars, then the crew) and
//     Guest Stars as person cards (TMDB portrait w185 requested from image.tmdb.org, else the person icon; name and role; no
//     links), an administrator's Get a Release for the episode, and Back returns to the season page. The icon on a row still
//     opens the picker without opening the page.
//
//   - P1.FU22 (user 2026-10-13: "Replace yellow with white and add hover effect + click which open the picker for the episode"):
//     a missing episode row's Not Downloaded is the colour of upstream's round row icons (the row's own text colour, not the
//     amber) for everyone; for an administrator it is a button named "Get a Release for Episode N, Title" with the tooltip
//     "Not Downloaded", a focus stop, upstream's round-icon hover (the theme's primary glyph over its veil, a pointer) on the
//     desktop, and a click, Enter (desktop) or a tap (phone) opens the picker on that episode without leaving the page; on the TV
//     Right on the row reaches it, Enter opens the picker, Left returns to the row; an ordinary user's stays a plain indicator.
//     Screenshots of the row at rest and hovered (dark and light), the phone and the TV focus.
//
//   - P1.FU20 (user-approved design 2026-10-13): the missing episode's page has a plain still (no mark, no disc), the series'
//     certification on the misc line and its genres line, and the download block where the track selectors sit, in every state
//     (downloading as a season pack's file with the percent in the 4em ring, the figures, the release, its marks, the pack line
//     and its dots, the bar; stalled; queued; importing; failed with Search Again; not downloaded with Get a Release; unaired
//     with the date and countdown), who gets which action (administrator, ordinary user), Cancel Download's confirmation and
//     its DELETE, the picker from Search Again and Get a Release, the TV's D-pad path, reduced motion, and the imported
//     transition to Jellyfin's own page (INTERCEPTED QUEUE AND ENTRY ANSWERS, NOT A LIVE DOWNLOAD); screenshots of each state,
//     dark and (administrator) light.
//
//   JELLYFINMOD_TEST_URL=http://<host>:<port>/   a mod instance (18096, 28096, 48096) or a local environment on 127.0.0.1
//   JELLYFINMOD_MSE_ENTRY=<series entry id>       a series whose plugin list holds seasons or episodes Jellyfin does not have
//   [JELLYFINMOD_MSE_USER=<ordinary user name>]  also check as this ordinary user (empty password); absent: NOT VERIFIED
//   [JELLYFINMOD_MSE_MOVIE=<entry id>]           a file-less movie entry, checked on the search page
//   [JELLYFINMOD_LOCAL_DIST=<dist folder>]       serve this local build in place of the instance's (a look before a deploy,
//                                                never acceptance evidence)
//   [JELLYFINMOD_WEB_PATH=/web/]  [JELLYFINMOD_BROWSER=chromium|chrome]  [JELLYFINMOD_LAYOUTS=desktop,mobile,tv1080]
//   [JELLYFINMOD_SHOTS=<folder for screenshots>]
//
// Reads only, with two exceptions that are the page's own behaviour: opening a series page whose TMDB list was never loaded
// loads it (P1.FU9), and opening the picker runs a release search. Nothing is grabbed; every picker is closed.
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const origin = new URL(process.env.JELLYFINMOD_TEST_URL ?? (() => { throw new Error('JELLYFINMOD_TEST_URL is required'); })());
const loopback = ['127.0.0.1', 'localhost'].includes(origin.hostname);
// Never production on 8096: a remote address must be one of the mod instances; a local environment listens on loopback.
if (!loopback && !['18096', '28096', '48096'].includes(origin.port)) throw new Error('Runs on the mod instances or a local environment only');
const entryId = process.env.JELLYFINMOD_MSE_ENTRY ?? (() => { throw new Error('JELLYFINMOD_MSE_ENTRY is required'); })();
const ordinaryUser = process.env.JELLYFINMOD_MSE_USER ?? null;
const movieEntryId = process.env.JELLYFINMOD_MSE_MOVIE ?? null;
const localDist = process.env.JELLYFINMOD_LOCAL_DIST ?? null;
const SHOTS = process.env.JELLYFINMOD_SHOTS ?? '.';
const WEB_PATH = process.env.JELLYFINMOD_WEB_PATH ?? '/web/';
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
const layouts = (process.env.JELLYFINMOD_LAYOUTS ?? 'desktop').split(',').filter(Boolean);
const LAYOUTS = {
    desktop: { viewport: { width: 1440, height: 900 } },
    mobile: {
        viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
    },
    tv1080: { viewport: { width: 1920, height: 1080 }, tv: true }
};

const results = [];
const record = (label, check, pass, detail) => {
    let verdict = pass;
    if (typeof pass === 'boolean') verdict = pass ? 'PASS' : 'FAIL';
    results.push({ label, check, verdict, detail });
    console.log(`${verdict} [${label}] ${check}${detail === undefined ? '' : ' · ' + JSON.stringify(detail).slice(0, 500)}`);
};

/** A local build served in place of the instance's: its mod page (jellyfinmod.html) under the web path, its files under one asset root. */
async function serveLocal(page) {
    if (!localDist) return;
    const root = '/web-mod/jfmod-local/';
    const types = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.html': 'text/html', '.svg': 'image/svg+xml',
        '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain' };
    const index = (await readFile(join(localDist, 'jellyfinmod.html'), 'utf8'))
        .replace(/(src|href)="(?!https?:|\/|#|data:)([^"]+)"/g, `$1="${root}$2"`)
        .replace('<head>', `<head><script>window.__jfmodAssetRoot="${root}";</script>`);
    await page.route(url => url.pathname === WEB_PATH || url.pathname === WEB_PATH + 'index.html',
        route => route.fulfill({ status: 200, contentType: 'text/html', body: index }));
    await page.route(url => url.pathname.startsWith(root), async route => {
        const file = decodeURIComponent(new URL(route.request().url()).pathname.slice(root.length));
        try {
            route.fulfill({ status: 200, contentType: types[extname(file)] ?? 'application/octet-stream', body: await readFile(join(localDist, file)) });
        } catch { route.fulfill({ status: 404, body: '' }); }
    });
}

const signedIn = page => page.evaluate(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } });

async function signIn(page, user) {
    await page.goto(new URL(WEB_PATH, origin).href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.ApiClient, undefined, { timeout: 30000 });
    await page.waitForFunction(() => {
        try { return !!ApiClient.getCurrentUserId() || /login|selectuser|selectserver/.test(location.hash); } catch { return false; }
    }, undefined, { timeout: 30000 });
    if (await signedIn(page)) return;
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
}

const apiGet = (page, path) => page.evaluate(async url => {
    const response = await fetch(ApiClient.getUrl(url), { headers: { Authorization: `MediaBrowser Token="${ApiClient.accessToken()}"` } });
    return response.ok ? response.json() : null;
}, path);

const go = async (page, hash) => {
    await page.evaluate(target => { location.hash = target; }, hash);
    await page.waitForTimeout(500);
};

/** A mod image box's TMDB image: its src, whether it loaded, whether it fills the box; null when the placeholder shows. */
const COVER_OF = `box => {
    const img = box?.querySelector('img.jfmod-missingImage');
    if (!img) return null;
    const own = box.getBoundingClientRect();
    const drawn = img.getBoundingClientRect();
    return { src: img.getAttribute('src'), loaded: img.complete && img.naturalWidth > 0, fit: getComputedStyle(img).objectFit,
        fills: Math.abs(own.width - drawn.width) < 2 && Math.abs(own.height - drawn.height) < 2, lazy: img.getAttribute('loading') };
}`;
const withCover = page => page.evaluate(`window.coverOf = ${COVER_OF}`);

/** What the series page's Seasons row shows, in DOM order. Upstream's cards are numbered by their Jellyfin season. */
const seasonRow = async (page, numbers) => {
    await withCover(page);
    return page.evaluate(byId => {
        const view = document.querySelector('.page:not(.hide)');
        const list = view?.querySelector('#listChildrenCollapsible .itemsContainer');
        return [...(list?.children ?? [])].filter(child => child.classList.contains('card')).map(card => {
            const mod = card.classList.contains('jfmod-missingSlot');
            const mark = card.querySelector('.jfmod-mark');
            // Upstream's season cards hold their text lines straight in the card box; the mod's cards in a footer.
            const lines = [...card.querySelectorAll('.cardBox > .cardText, .cardFooter > .cardText')];
            const texts = lines.map(node => node.textContent.trim());
            const look = node => {
                if (!node) return null;
                const style = getComputedStyle(node);
                const rect = node.getBoundingClientRect();
                return { tag: node.tagName, classes: node.className.replace(/(^|\s)jfmod-\S+/g, ' ').trim().split(/\s+/).sort().join(' '),
                    child: node.firstElementChild?.tagName ?? null, fontSize: style.fontSize, lineHeight: style.lineHeight,
                    fontWeight: style.fontWeight, fontFamily: style.fontFamily, color: style.color, textAlign: style.textAlign,
                    padding: style.padding, top: Math.round(rect.top), bottom: Math.round(rect.bottom), height: Math.round(rect.height) };
            };
            const box = mark?.getBoundingClientRect();
            const cover = card.querySelector('.cardScalable')?.getBoundingClientRect();
            const indicators = card.querySelector('.cardIndicators');
            const cluster = indicators && indicators.offsetWidth > 0 ? indicators.getBoundingClientRect() : null;
            return {
                mod,
                season: mod ? Number(card.dataset.jfmodSeason) : byId[(card.getAttribute('data-id') ?? '').replace(/-/g, '').toLowerCase()] ?? null,
                title: texts[0] ?? null,
                line2: texts[1] ?? null,
                lineCount: texts.length,
                countLines: card.querySelectorAll('[data-jfmod-count]').length,
                titleLook: look(lines[0]),
                line2Look: look(lines[1]),
                coverHeight: cover ? Math.round(cover.height) : null,
                dashed: mod ? getComputedStyle(card.querySelector('.jfmod-missingPoster')).outlineStyle : null,
                cover: mod ? coverOf(card.querySelector('.jfmod-missingPoster')) : null,
                played: !!card.querySelector('.cardIndicators .playedIndicator'),
                cluster: cluster ? { left: Math.round(cluster.left), right: Math.round(cluster.right), top: Math.round(cluster.top), bottom: Math.round(cluster.bottom) } : null,
                mark: mark ? {
                    kind: ['unaired', 'none'].find(name => mark.classList.contains('jfmod-mark--' + name)) ?? 'other',
                    tag: mark.tagName, title: mark.getAttribute('title'), text: mark.textContent.trim(),
                    cursor: getComputedStyle(mark).cursor, tabIndex: mark.tabIndex,
                    glyph: !!mark.querySelector('svg.jfmod-markGlyph') && mark.querySelectorAll('svg.jfmod-markGlyph path').length === 3,
                    visible: !!box && box.width > 0 && getComputedStyle(mark).display !== 'none',
                    box: box ? { left: Math.round(box.left), right: Math.round(box.right), top: Math.round(box.top), bottom: Math.round(box.bottom) } : null,
                    topRight: !!box && !!cover && box.right > cover.left + cover.width * 0.6 && box.top < cover.top + cover.height * 0.25
                } : null
            };
        });
    }, numbers);
};

/** The season page's episode list, in DOM order: mod rows by their episode, upstream's by their Jellyfin episode. */
const episodeList = async (page, numbers) => {
    await withCover(page);
    return page.evaluate(byId => {
        const view = document.querySelector('.page:not(.hide)');
        const list = view?.querySelector('#listChildrenCollapsible .itemsContainer');
        return [...(list?.children ?? [])].filter(child => child.classList.contains('listItem')).map(row => {
            const mod = row.classList.contains('jfmod-missingRow');
            const mark = row.querySelector('.jfmod-mark');
            const overview = row.querySelector('.listItem-overview');
            const title = row.querySelector('.listItemBodyText')?.textContent.trim() ?? '';
            return {
                mod,
                tag: row.tagName,
                link: mod ? row.querySelector('a.jfmod-missingRowLink')?.getAttribute('href') ?? null : null,
                id: mod ? row.dataset.jfmodEpisodeId : null,
                number: mod ? Number(title.split('.')[0]) : byId[(row.getAttribute('data-id') ?? '').replace(/-/g, '').toLowerCase()] ?? null,
                title,
                meta: mod ? [...row.querySelectorAll('.jfmod-missingMeta .mediaInfoItem')].map(item => item.textContent.trim()) : null,
                cover: mod ? coverOf(row.querySelector('.jfmod-missingStill')) : null,
                dashed: mod ? getComputedStyle(row.querySelector('.jfmod-missingStill')).outlineStyle : null,
                overview: mod ? row.querySelector('.listItem-overview')?.textContent.trim() ?? null : null,
                overviewShown: !!overview && getComputedStyle(overview).display !== 'none',
                focusables: mod ? [...row.querySelectorAll('button, a, input, select, [tabindex]')].map(node => node.className) : [],
                mark: mark ? {
                    kind: ['unaired', 'none'].find(name => mark.classList.contains('jfmod-mark--' + name)) ?? 'other',
                    tag: mark.tagName, title: mark.getAttribute('title'), text: mark.textContent.trim(),
                    cursor: getComputedStyle(mark).cursor, tabIndex: mark.tabIndex, name: mark.getAttribute('aria-label'),
                    // P1.FU22: the colour of upstream's round row icons, which take the row's own (`color: inherit`).
                    colour: getComputedStyle(mark).color, rowColour: getComputedStyle(row).color,
                    glyph: !!mark.querySelector('svg.jfmod-markGlyph') && mark.querySelectorAll('svg.jfmod-markGlyph path').length === 3
                } : null
            };
        });
    }, numbers);
};

const ascending = values => values.every((value, index) => index === 0 || values[index - 1] <= value);

const UTC = { timeZone: 'UTC' };
/** The short air date the mark shows ("10 Aug" this year, "Aug ’27" otherwise), in the browser's locale. */
const shortDate = (page, airDate) => page.evaluate(([value, utc]) => {
    const date = new Date(value);
    if (date.getUTCFullYear() === new Date().getFullYear()) return date.toLocaleDateString(undefined, { ...utc, day: 'numeric', month: 'short' });
    return date.toLocaleDateString(undefined, { ...utc, month: 'short' }) + ' ’' + ('0' + (date.getUTCFullYear() % 100)).slice(-2);
}, [airDate, UTC]);
const longDate = (page, airDate) => page.evaluate(([value, utc]) =>
    new Date(value).toLocaleDateString(undefined, { ...utc, day: 'numeric', month: 'short', year: 'numeric' }), [airDate, UTC]);

/** The mark a season or episode should carry, as the plugin's availability says. */
const expectedMark = episodes => {
    const unaired = episodes.length > 0 && episodes.every(episode => episode.availability === 'unaired' && episode.airDate);
    return unaired ? { kind: 'unaired', airDate: episodes.map(episode => episode.airDate).sort()[0] } : { kind: 'none' };
};

/** P1.FU17: an upstream season card's mark: none when an episode is on disk or the entry lists none of the season, else the season's. */
const expectedNativeMark = (season, episodes) => {
    const own = episodes.filter(episode => episode.seasonNumber === season);
    if (season <= 0 || !own.length || own.some(episode => episode.availability === 'onDisk')) return null;
    return expectedMark(own);
};

/** P1.FU19: every mark is a plain indicator for everyone (MARK_CLICKABLE off): not a button, no focus stop, no pointer. */
async function checkMark(page, label, what, shown) {
    if (!shown) { record(label, `${what}: has a mark`, false, null); return; }
    const plain = shown.tag !== 'BUTTON' && shown.tabIndex < 0 && shown.cursor === 'default';
    if (shown.glyph !== undefined) record(label, `${what}: the Not Downloaded glyph is the arrow out of a small cloud`, shown.glyph, shown);
    record(label, `${what}: the Not Downloaded mark is a plain indicator "Not Downloaded" (no button, no focus stop, no pointer)`,
        shown.kind === 'none' && plain && shown.title === 'Not Downloaded', shown);
}

/** The Unaired clock: the short air date, its tooltip, a plain indicator. */
async function checkUnaired(page, label, what, shown, expected) {
    const text = await shortDate(page, expected.airDate);
    const title = 'Airs ' + await longDate(page, expected.airDate);
    record(label, `${what}: the Unaired clock with the short air date, a plain indicator`, shown.kind === 'unaired' && shown.text === text
        && shown.title === title && shown.tag !== 'BUTTON' && shown.tabIndex < 0 && shown.cursor === 'default', { shown, text, title });
}

async function checkAnyMark(page, label, what, shown, expected) {
    if (shown && expected.kind === 'unaired') await checkUnaired(page, label, what, shown, expected);
    else await checkMark(page, label, what, shown);
}

const INERT_PROPS = ['backgroundColor', 'boxShadow', 'outlineStyle', 'transform', 'opacity', 'color', 'filter'];

/**
 * A mark that is no control (P1.FU19, user 2026-10-13: "I don't think we need highlight / hover over non clickable icon"): its
 * computed look (background, shadow, outline, transform, opacity, colour, its ::before veil) is the same under the mouse as
 * without it, the pointer is the default arrow, and its tooltip stays. Desktop only: the phone and the TV have no hover.
 */
async function checkInert(page, label, what, locator) {
    if (!await locator.count()) { record(label, `${what}: present`, false); return; }
    const read = () => locator.first().evaluate((node, props) => {
        const own = getComputedStyle(node);
        const veil = getComputedStyle(node, '::before');
        return { styles: props.map(prop => own[prop]).join(' | '), veil: `${veil.content} ${veil.opacity} ${veil.backgroundColor}`,
            cursor: own.cursor, title: node.getAttribute('title') };
    }, INERT_PROPS);
    await locator.first().scrollIntoViewIfNeeded().catch(() => {});
    await page.mouse.move(1, 1);
    await page.waitForTimeout(400);
    const before = await read();
    const box = await locator.first().boundingBox();
    if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(450);
    const after = await read();
    record(label, `${what}: no hover look (nothing changes under the mouse), no pointer, the tooltip kept`, !!box && after.styles === before.styles
        && after.veil === before.veil && before.cursor === 'default' && after.cursor === 'default' && !!before.title, { before, after });
}

/**
 * A row's mark or disc against upstream's round row buttons beside it (user 2026-10-13: "make the episode [state icon] the same
 * size as info and fav and heart icons"): the same box and glyph size, centred on the same line. On the TV upstream's rows draw
 * no round buttons, so the box is checked against upstream's formula (the glyph 1.6695652173913em plus 0.556em each side).
 */
async function checkRowSize(page, label, what, rowSelector, markSelector) {
    const facts = await page.evaluate(([rowSel, markSel]) => {
        const box = node => { const rect = node.getBoundingClientRect(); return { w: rect.width, h: rect.height, cy: rect.top + rect.height / 2 }; };
        const marked = [...document.querySelectorAll(rowSel)].find(row => row.querySelector(markSel));
        const mark = marked?.querySelector(markSel);
        const glyph = mark?.querySelector('svg.jfmod-markGlyph, svg.jfmod-dlmark-glyph, svg');
        const failedBang = mark && getComputedStyle(mark, '::before').content !== 'none' && getComputedStyle(mark, '::before').width !== 'auto';
        const glyphBox = failedBang ? { w: parseFloat(getComputedStyle(mark, '::before').width), h: parseFloat(getComputedStyle(mark, '::before').height) } : glyph && box(glyph);
        const upstream = [...document.querySelectorAll('.page:not(.hide) #listChildrenCollapsible .listItem button.listItemButton')]
            .find(button => button.getBoundingClientRect().width > 0);
        const upstreamGlyph = upstream?.querySelector('.material-icons, svg');
        const font = mark ? parseFloat(getComputedStyle(mark).fontSize) : 0;
        return mark ? { mark: box(mark), glyph: glyphBox, row: box(marked), font,
            upstream: upstream ? { box: box(upstream), glyph: box(upstreamGlyph), font: parseFloat(getComputedStyle(upstream).fontSize) } : null } : null;
    }, [rowSelector, markSelector]);
    if (!facts) { record(label, `${what}: present`, 'NOT VERIFIED', 'no such row on this page'); return; }
    const near = (a, b) => Math.abs(a - b) <= 0.6;
    const expectedBox = facts.upstream ? facts.upstream.box.w : facts.font * (1.6695652173913 + 1.112);
    const expectedGlyph = facts.upstream ? facts.upstream.glyph.w : facts.font * 1.6695652173913;
    record(label, `${what}: the box and glyph of upstream's round row buttons${facts.upstream ? ' (measured on the row\'s own)' : ' (upstream\'s formula; no round buttons on these rows)'}, centred on the row`,
        near(facts.mark.w, expectedBox) && near(facts.mark.h, expectedBox) && !!facts.glyph && near(facts.glyph.w, expectedGlyph)
        && near(facts.glyph.h, expectedGlyph) && Math.abs(facts.mark.cy - facts.row.cy) <= 1.5, { ...facts, expectedBox, expectedGlyph });
}

/** Upstream's runtime format (scripts/datetime getDisplayDuration): "42m", "1h 2m". */
const duration = minutes => (Math.floor(minutes / 60) > 0 ? `${Math.floor(minutes / 60)}h ` : '') + `${minutes % 60}m`;

/** Requests the page made to TMDB's image CDN (P1.FU14). */
const imageRequests = new Set();

/**
 * A TMDB poster or still in a mod image box: the img with the expected src, a request made for it, filling the box; when it did
 * not load (offline, a blocked CDN) the placeholder must show and the load is NOT VERIFIED. Without a path, the placeholder.
 */
function checkCover(label, what, shown, path, size) {
    if (!path) {
        record(label, `${what}: no TMDB image, the dashed placeholder`, !shown.cover && shown.dashed === 'dashed', shown.cover);
        return;
    }
    const src = `https://image.tmdb.org/t/p/${size}${path}`;
    if (shown.cover) {
        record(label, `${what}: TMDB's image ${size}${path}, lazy, cover, filling the box`, shown.cover.src === src
            && shown.cover.lazy === 'lazy' && shown.cover.fit === 'cover' && shown.cover.fills && shown.dashed !== 'dashed', shown.cover);
        // A lazy image below the fold is not asked for yet (real Chrome waits until it nears the viewport): not a failure.
        const requested = imageRequests.has(src) ? 'PASS' : 'NOT VERIFIED';
        record(label, `${what}: the image was requested from image.tmdb.org`, shown.cover.loaded ? imageRequests.has(src) : requested, src);
        record(label, `${what}: the image loaded`, shown.cover.loaded ? 'PASS' : 'NOT VERIFIED', shown.cover.loaded ? undefined : 'not loaded yet (lazy below the fold, or slow)');
    } else {
        // An image that failed to load leaves the placeholder, without an error on the page.
        record(label, `${what}: the image did not load; the placeholder shows instead`, shown.dashed === 'dashed', { src, requested: imageRequests.has(src) });
        record(label, `${what}: TMDB's image ${size}${path}`, 'NOT VERIFIED', 'image.tmdb.org unreachable from the browser');
    }
}

const scopeOptions = page => page.evaluate(() => [...document.querySelectorAll('.jfmod-releaseDialog #jfmod-releaseEpisode option')]
    .map(option => ({ text: option.textContent, selected: option.selected })));

/** Presses a mark the way the layout does: a click, or focus and Enter on the TV. */
async function press(page, locator, tv) {
    if (tv) {
        await locator.focus();
        await page.keyboard.press('Enter');
    } else {
        await locator.click();
    }
}

async function closePicker(page, tv) {
    if (tv) await page.keyboard.press('Escape');
    else await page.goBack();
    return page.waitForSelector('.jfmod-releaseDialog', { state: 'detached', timeout: 10000 }).then(() => true, () => false);
}

/** Opens the picker from a mark and returns its scope options; the page must not move. */
async function pickerFrom(page, label, what, locator, tv, expected) {
    const before = await page.evaluate(() => location.hash);
    await press(page, locator, tv);
    const opened = await page.waitForSelector('.jfmod-releaseDialog #jfmod-releaseEpisode', { timeout: 15000 }).then(() => true, () => false);
    await page.waitForTimeout(1000);
    const options = opened ? await scopeOptions(page) : [];
    const after = await page.evaluate(() => location.hash);
    const texts = options.map(option => option.text);
    record(label, `${what}: opens the picker on the page, scope ${JSON.stringify(expected)}, the first selected`, opened
        && after.split('&')[0] === before.split('&')[0] && after.includes('episode=') === before.includes('episode=')
        && JSON.stringify(texts) === JSON.stringify(expected) && options[0]?.selected === true,
    { texts, before, after });
    if (opened) record(label, `${what}: Back closes the picker`, await closePicker(page, tv));
    await page.waitForTimeout(800);
}

/** Walks the page with Down on the TV and lists what took focus. */
async function dpadTrail(page, steps) {
    const trail = [];
    for (let index = 0; index < steps; index++) {
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(250);
        trail.push(await page.evaluate(() => {
            const active = document.activeElement;
            if (!active || active === document.body) return 'BODY';
            if (active.closest('.jfmod-missingRow')) return active.classList.contains('jfmod-markButton') ? 'modIcon' : 'modRow';
            if (active.closest('.jfmod-missingCard')) return active.classList.contains('jfmod-markButton') ? 'modIcon' : 'modCard';
            return active.closest('.listItem, .card') ? 'upstream' : 'other';
        }));
    }
    return trail;
}

const AMBER_MARK = 'rgb(255, 183, 77)';
const PRIMARY = 'rgb(0, 164, 220)';
const VEIL = 'rgba(0, 164, 220, 0.2)';

/** The release picker's scope for one episode, as the episode's own page offers it. */
const episodeScope = episode => [`Episode: S${String(episode.seasonNumber).padStart(2, '0')}E${String(episode.episodeNumber).padStart(2, '0')} · ${episode.title}`,
    `Season ${episode.seasonNumber}`, 'All Seasons'];

/** A row mark's look for the hover check: its colour, background, cursor, transform. */
const markLook = locator => locator.evaluate(node => {
    const style = getComputedStyle(node);
    return { colour: style.color, background: style.backgroundColor, cursor: style.cursor, transform: style.transform };
});

/**
 * P1.FU22: an administrator's Not Downloaded on a missing episode row is a button for that episode: upstream's round-icon hover on
 * the desktop (the primary glyph over its veil, a pointer), a click (a tap on the phone) and, on the desktop, Enter open the picker
 * on the episode without leaving the page; on the TV Right on the row reaches it, Enter opens the picker, Left returns to the row.
 * Screenshots of the row at rest and hovered, dark and light, and of the TV's focus.
 */
async function checkRowButton(page, label, what, episode, layout) {
    const tv = !!LAYOUTS[layout].tv;
    const row = page.locator(`.page:not(.hide) .jfmod-missingRow[data-jfmod-episode-id="${episode.id}"]`);
    const mark = row.locator('.jfmod-markButton');
    const where = `${what} E${episode.episodeNumber}'s Not Downloaded`;
    if (!await mark.count()) { record(label, `${where}: an administrator's button`, false); return; }
    await row.scrollIntoViewIfNeeded().catch(() => {});
    await page.mouse.move(1, 1);
    await page.waitForTimeout(400);
    if (layout === 'desktop') {
        const rest = await markLook(mark);
        await row.screenshot({ path: `${SHOTS}/mse-${tier}-desktop-row-mark-rest-dark.png` }).catch(() => {});
        await mark.hover();
        await page.waitForTimeout(450);
        const hover = await markLook(mark);
        await row.screenshot({ path: `${SHOTS}/mse-${tier}-desktop-row-mark-hover-dark.png` }).catch(() => {});
        record(label, `${where}: upstream's round-icon hover (the primary glyph over its veil, a pointer), nothing at rest`,
            rest.background === 'rgba(0, 0, 0, 0)' && rest.colour !== PRIMARY && rest.cursor === 'pointer'
            && hover.colour === PRIMARY && hover.background === VEIL && hover.cursor === 'pointer' && hover.transform === 'none', { rest, hover });
        // The light scheme (the theme attribute set in this page only): the dark text at rest, the same hover.
        await page.evaluate(() => { window.jfmodTheme = document.documentElement.getAttribute('data-theme'); document.documentElement.setAttribute('data-theme', 'light'); });
        await page.mouse.move(1, 1);
        await page.waitForTimeout(450);
        const lightRest = await markLook(mark);
        const rowColour = await row.evaluate(node => getComputedStyle(node).color);
        await row.screenshot({ path: `${SHOTS}/mse-${tier}-desktop-row-mark-rest-light.png` }).catch(() => {});
        await mark.hover();
        await page.waitForTimeout(450);
        const lightHover = await markLook(mark);
        await row.screenshot({ path: `${SHOTS}/mse-${tier}-desktop-row-mark-hover-light.png` }).catch(() => {});
        record(label, `${where} (light scheme): the row's dark text colour at rest, the primary glyph over its veil on hover`,
            lightRest.colour === rowColour && lightRest.colour !== AMBER_MARK && lightHover.colour === PRIMARY && lightHover.background === VEIL,
            { lightRest, rowColour, lightHover });
        await page.evaluate(() => document.documentElement.setAttribute('data-theme', window.jfmodTheme ?? 'dark'));
        await page.mouse.move(1, 1);
        await page.waitForTimeout(300);
    }
    if (layout === 'mobile') await row.screenshot({ path: `${SHOTS}/mse-${tier}-mobile-row-mark.png` }).catch(() => {});
    if (tv) {
        await row.focus();
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(300);
        const onMark = await page.evaluate(() => document.activeElement?.classList.contains('jfmod-markButton') ?? false);
        const look = onMark ? await markLook(mark) : null;
        const ring = onMark ? await mark.evaluate(node => getComputedStyle(node).boxShadow) : null;
        if (onMark) await row.screenshot({ path: `${SHOTS}/mse-${tier}-tv-row-mark-focus.png` }).catch(() => {});
        record(label, `${where}: Right on the row reaches it, focused with the primary glyph over its veil and the white ring`,
            onMark && look?.colour === PRIMARY && look.background === VEIL && /255, 255, 255/.test(ring ?? ''), { onMark, look, ring });
        if (onMark) {
            const before = await page.evaluate(() => location.hash);
            await page.keyboard.press('Enter');
            const opened = await page.waitForSelector('.jfmod-releaseDialog #jfmod-releaseEpisode', { timeout: 15000 }).then(() => true, () => false);
            await page.waitForTimeout(1000);
            const texts = opened ? (await scopeOptions(page)).map(option => option.text) : [];
            record(label, `${where}: Enter on it opens the picker on the episode, the page kept`, opened
                && JSON.stringify(texts) === JSON.stringify(episodeScope(episode)) && await page.evaluate(() => location.hash) === before, texts);
            if (opened) record(label, `${where}: Back closes the picker`, await closePicker(page, true));
            await page.waitForTimeout(800);
            await mark.focus();
            await page.keyboard.press('ArrowLeft');
            await page.waitForTimeout(300);
            const back = await page.evaluate(id => document.activeElement?.getAttribute('data-jfmod-episode-id') === id, episode.id);
            record(label, `${where}: Left on it returns to the row`, back);
        }
        return;
    }
    await pickerFrom(page, label, `${where} (${layout === 'mobile' ? 'a tap' : 'a click'})`, mark, false, episodeScope(episode));
    if (layout === 'desktop') {
        // The keyboard: a focus stop, Enter opens the picker.
        const before = await page.evaluate(() => location.hash);
        await mark.focus();
        const focused = await page.evaluate(() => document.activeElement?.classList.contains('jfmod-markButton') ?? false);
        await page.keyboard.press('Enter');
        const opened = await page.waitForSelector('.jfmod-releaseDialog #jfmod-releaseEpisode', { timeout: 15000 }).then(() => true, () => false);
        await page.waitForTimeout(1000);
        const texts = opened ? (await scopeOptions(page)).map(option => option.text) : [];
        record(label, `${where}: a focus stop, Enter opens the picker on the episode, the page kept`, focused && opened
            && JSON.stringify(texts) === JSON.stringify(episodeScope(episode)) && await page.evaluate(() => location.hash) === before, { focused, texts });
        if (opened) await closePicker(page, false);
        await page.waitForTimeout(800);
    }
}

async function checkSeasonRows(page, label, detail, episodes, numbers, { admin, canDownload, layout, what }) {
    const tv = !!LAYOUTS[layout].tv;
    // P1.FU22: an administrator's Not Downloaded on a row is a button; everyone else's an indicator.
    const button = admin && canDownload;
    const expected = episodes.filter(episode => episode.availability !== 'onDisk').sort((a, b) => a.episodeNumber - b.episodeNumber);
    await page.waitForFunction(count => document.querySelectorAll('.page:not(.hide) .jfmod-missingRow').length >= count,
        expected.length, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1000);
    const rows = await episodeList(page, numbers);
    const mod = rows.filter(row => row.mod);
    record(label, `${what}: one mod row per missing episode`, mod.length === expected.length,
        { shown: mod.map(row => row.title), expected: expected.map(episode => `${episode.episodeNumber}. ${episode.title}`) });
    record(label, `${what}: every row in episode order, mod rows among upstream's`, ascending(rows.map(row => row.number)),
        rows.map(row => `${row.mod ? 'mod' : 'up'}:${row.number}`));
    for (const [index, row] of mod.entries()) {
        const episode = expected.find(candidate => candidate.id === row.id);
        if (!episode) { record(label, `${what}: row ${index} is a plugin episode`, false, row); continue; }
        const rating = detail.entry.metadata?.episodeRatings?.[episode.tmdbId];
        const meta = [episode.airDate ? await longDate(page, episode.airDate) : null, episode.runtimeMinutes ? duration(episode.runtimeMinutes) : null,
            rating ? rating.toFixed(1) : null].filter(Boolean);
        record(label, `${what} E${episode.episodeNumber}: "N. Title"; the meta line ${JSON.stringify(meta)} (air date, runtime, rating)`,
            row.title === `${episode.episodeNumber}. ${episode.title}` && JSON.stringify(row.meta) === JSON.stringify(meta), row);
        checkCover(label, `${what} E${episode.episodeNumber} still`, row, episode.stillPath, tv ? 'w500' : 'w300');
        if (layout !== 'mobile') {
            const overviewShown = episode.overview ? row.overview === episode.overview.trim() && row.overviewShown : row.overview === null;
            record(label, `${what} E${episode.episodeNumber}: TMDB's overview`, overviewShown, { shown: row.overview, expected: episode.overview });
        }
        const expectedRowMark = expectedMark([episode]);
        const rowButton = button && expectedRowMark.kind === 'none';
        if (rowButton) {
            const shown = row.mark;
            record(label, `${what} E${episode.episodeNumber}: an administrator's Not Downloaded is a button "Get a Release for Episode ${episode.episodeNumber}, ${episode.title}", tooltip "Not Downloaded", the cloud glyph`,
                // The TV layout hides the pointer everywhere (`cursor: none`).
                shown?.kind === 'none' && shown.tag === 'BUTTON' && shown.tabIndex === 0 && shown.cursor === (tv ? 'none' : 'pointer') && shown.glyph
                && shown.title === 'Not Downloaded' && shown.name === `Get a Release for Episode ${episode.episodeNumber}, ${episode.title}`, shown);
        } else {
            await checkAnyMark(page, label, `${what} E${episode.episodeNumber}`, row.mark, expectedRowMark);
        }
        // P1.FU22: the Not Downloaded glyph takes the colour of upstream's round row icons (the row's own), not the amber.
        if (expectedRowMark.kind === 'none') {
            record(label, `${what} E${episode.episodeNumber}: the Not Downloaded glyph in the row icons' colour, not amber`,
                !!row.mark && row.mark.colour === row.mark.rowColour && row.mark.colour !== AMBER_MARK, row.mark && { colour: row.mark.colour, row: row.mark.rowColour });
        }
        // P1.FU15: the row opens the episode's page. On the TV the row itself is the stop (a button); elsewhere the title is the
        // row's link. The mark is no second stop (P1.FU19) except an administrator's Not Downloaded button (P1.FU22).
        const href = `#/details?entryId=${encodeURIComponent(detail.entry.id)}`;
        const stops = rowButton ? 1 : 0;
        record(label, `${what} E${episode.episodeNumber}: ${tv ? 'the row is a button stop' : 'the title links to the episode\'s page'}, ${rowButton ? 'the mark a second stop' : 'the mark no second stop'}`,
            tv ? row.tag === 'BUTTON' && row.focusables.length === stops : row.link?.startsWith(href) && row.link.endsWith(`&season=${episode.seasonNumber}&episode=${episode.episodeNumber}`)
                && row.focusables.length === 1 + stops, { tag: row.tag, link: row.link, focusables: row.focusables });
        if (layout === 'mobile') record(label, `${what} E${episode.episodeNumber}: no overview on the phone`, !row.overviewShown);
    }
    if (tv) {
        await page.evaluate(() => document.activeElement?.blur());
        await page.locator('.page:not(.hide) .detailPagePrimaryContainer button:visible').first().focus().catch(() => {});
        const trail = await dpadTrail(page, rows.length + 6);
        record(label, `${what}: Down stops on the mod rows (P1.FU15), never on a mark`, trail.includes('modRow') && !trail.includes('modIcon'), trail);
        // An ordinary user's mark (and an unaired one) is no stop: Right on its row stays off it (P1.FU19).
        const plain = mod.find(row => row.mark && !(button && row.mark.kind === 'none'));
        const first = plain && page.locator(`.page:not(.hide) .jfmod-missingRow[data-jfmod-episode-id="${plain.id}"]`);
        if (first) {
            await first.focus();
            await page.keyboard.press('ArrowRight');
            await page.waitForTimeout(300);
            const right = await page.evaluate(() => (document.activeElement?.closest('.jfmod-mark') ? 'mark' : 'elsewhere'));
            record(label, `${what}: Right on a row with ${button ? 'the Unaired clock' : 'an indicator'} reaches no mark`, right !== 'mark', right);
        }
    } else if (!button) {
        const inert = mod.find(row => row.mark?.kind === 'none');
        if (inert && layout === 'desktop') {
            await checkInert(page, label, `${what} E${inert.number}'s Not Downloaded`,
                page.locator(`.page:not(.hide) .jfmod-missingRow[data-jfmod-episode-id="${inert.id}"] .jfmod-mark--none`));
        }
    }
    await checkRowSize(page, label, `${what}: a missing episode row's Not Downloaded`, '.page:not(.hide) .jfmod-missingRow', '.jfmod-mark--none');
    const pressable = button && mod.find(row => row.mark?.kind === 'none');
    const target = pressable && expected.find(candidate => candidate.id === pressable.id);
    if (target) await checkRowButton(page, label, what, target, layout);
    else if (button) record(label, `${what}: an administrator's Not Downloaded button`, 'NOT VERIFIED', 'no missing episode with Not Downloaded on this page');
    return mod;
}

/** What the episode's page shows (P1.FU15): header, meta, still, overview, details lines and the two people sections. */
const episodePageView = async page => {
    await withCover(page);
    return page.evaluate(() => {
        const view = document.querySelector('.page:not(.hide)');
        const people = selector => {
            const section = view.querySelector(selector);
            return {
                shown: !!section && !section.classList.contains('hide'),
                cards: [...(section?.querySelectorAll('.itemsContainer .card') ?? [])].map(card => ({
                    tag: card.tagName,
                    name: card.querySelector('.cardText-first')?.textContent.trim() ?? null,
                    role: card.querySelector('.cardText-secondary')?.textContent.trim() ?? null,
                    portrait: card.querySelector('img.jfmod-missingImage')?.getAttribute('src') ?? null,
                    icon: !!card.querySelector('.cardImageIcon.person'),
                    links: card.querySelectorAll('a').length
                }))
            };
        };
        const still = view.querySelector('.detailImageContainer .jfmod-episodeStill .cardImageContainer');
        return {
            series: view.querySelector('.nameContainer .parentName')?.textContent.trim() ?? null,
            subtitle: view.querySelector('.nameContainer .itemName')?.textContent.replace(/\s+/g, ' ').trim() ?? null,
            meta: [...view.querySelectorAll('.itemMiscInfo-primary .mediaInfoItem:not(.mediaInfoOfficialRating)')].map(item => item.textContent.trim()),
            certification: view.querySelector('.itemMiscInfo-primary .mediaInfoOfficialRating')?.textContent.trim() ?? null,
            genres: view.querySelector('.detailSectionContent .itemGenres')?.textContent.trim() || null,
            cover: coverOf(still),
            dashed: still ? getComputedStyle(still).outlineStyle : null,
            mark: view.querySelectorAll('.detailImageContainer .jfmod-mark, .detailImageContainer .jfmod-dlmark').length,
            overview: view.querySelector('.detailSectionContent .overview')?.textContent.trim() || null,
            details: [...view.querySelectorAll('.itemDetailsGroup .detailsGroupItem')].map(item =>
                [...item.children].map(child => child.textContent.trim()).join(': ')),
            cast: people('#castCollapsible'),
            guests: people('#guestCastCollapsible'),
            getRelease: !!view.querySelector('.mainDetailButtons .jfmod-getRelease')
        };
    });
};

/**
 * Opens a missing episode's page from its row (a click on the row's still, or Enter on the TV), checks it against the plugin's
 * data as a downloaded episode's page lays it out, and goes Back to the season page (P1.FU15).
 */
async function checkEpisodePage(page, label, detail, episode, { admin, canDownload, tv, what, full }) {
    const before = await page.evaluate(() => location.hash);
    const row = page.locator(`.page:not(.hide) .jfmod-missingRow[data-jfmod-episode-id="${episode.id}"]`);
    if (tv) await press(page, row, true);
    else await row.locator('.jfmod-missingStill').click();
    const opened = await page.waitForFunction(([season, number]) => location.hash.includes(`&season=${season}&episode=${number}`),
        [episode.seasonNumber, episode.episodeNumber], { timeout: 15000 }).then(() => true, () => false);
    record(label, `${what}: E${episode.episodeNumber}'s row opens its page`, opened, await page.evaluate(() => location.hash));
    if (!opened) return;
    await page.waitForFunction(() => !!document.querySelector('.page:not(.hide) .nameContainer .parentName'), undefined, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2500);
    if (full) {
        const shown = await episodePageView(page);
        record(label, `episode page: "${detail.entry.title}" / "Season ${episode.seasonNumber} - ${episode.episodeNumber}. ${episode.title}"`,
            shown.series === detail.entry.title && shown.subtitle === `Season ${episode.seasonNumber} - ${episode.episodeNumber}. ${episode.title}`, shown);
        const rating = detail.entry.metadata?.episodeRatings?.[episode.tmdbId];
        const tail = [episode.runtimeMinutes ? duration(episode.runtimeMinutes) : null, rating ? rating.toFixed(1) : null].filter(Boolean);
        record(label, `episode page: the meta line (air date, then ${JSON.stringify(tail)})`,
            shown.meta.length === tail.length + (episode.airDate ? 1 : 0) && JSON.stringify(shown.meta.slice(shown.meta.length - tail.length)) === JSON.stringify(tail), shown.meta);
        checkCover(label, 'episode page still', shown, episode.stillPath, tv ? 'w500' : 'w300');
        // P1.FU20 (user 2026-10-13: "I see no sense in download cloud over the episode card in episode page"): a plain still.
        record(label, 'episode page: no mark and no disc on the still', shown.mark === 0, shown.mark);
        // P1.FU20: the series' certification on the misc line (the US one, else the first) and its genres line.
        const certs = detail.entry.metadata?.certifications ?? [];
        const cert = (certs.find(item => item.country === 'US') ?? certs[0])?.rating ?? null;
        record(label, `episode page: the certification ${JSON.stringify(cert)} on the misc line`, shown.certification === cert, shown.certification);
        const genres = (detail.entry.metadata?.genres ?? []).join(', ') || null;
        record(label, `episode page: the genres line ${JSON.stringify(genres)}`, shown.genres === genres, shown.genres);
        record(label, 'episode page: TMDB\'s overview', episode.overview ? shown.overview === episode.overview.trim() : !shown.overview, shown.overview?.slice(0, 80));
        const credits = episode.credits;
        if (!credits) {
            record(label, 'episode page: cast and crew', 'NOT VERIFIED', 'the plugin has no credits for this episode (list not reloaded yet)');
        } else {
            const names = type => [...new Set(credits.crew.filter(person => person.type === type).map(person => person.name))];
            const line = (one, many, list) => (list.length ? [`${list.length > 1 ? many : one}: ${list.join(', ')}`] : []);
            const details = [...line('Director', 'Directors', names('Director')), ...line('Writer', 'Writers', names('Writer'))];
            record(label, `episode page: the details lines ${JSON.stringify(details)}`, JSON.stringify(shown.details) === JSON.stringify(details), shown.details);
            const regulars = detail.entry.metadata?.cast ?? [];
            const crewPeople = new Set(credits.crew.map(person => person.id || person.name)).size;
            record(label, `episode page: Cast & Crew has ${regulars.length} regulars then ${crewPeople} crew cards`, shown.cast.shown === (regulars.length + crewPeople > 0)
                && shown.cast.cards.length === regulars.length + crewPeople
                && regulars.every((person, index) => shown.cast.cards[index]?.name === person.name
                    && (!person.character || shown.cast.cards[index]?.role === `as ${person.character}`)), shown.cast.cards.slice(0, 4));
            record(label, `episode page: Guest Stars has ${credits.guestStars.length} cards in TMDB's order`, shown.guests.shown === credits.guestStars.length > 0
                && JSON.stringify(shown.guests.cards.map(card => card.name)) === JSON.stringify(credits.guestStars.map(person => person.name)), shown.guests.cards.slice(0, 4));
            const cards = [...shown.cast.cards, ...shown.guests.cards];
            const people = [...regulars, ...credits.guestStars];
            record(label, 'episode page: person cards link nowhere' + (tv ? ' and are focus stops (buttons)' : ''),
                cards.every(card => card.links === 0 && (tv ? card.tag === 'BUTTON' : card.tag === 'DIV')), cards.filter(card => card.links || (tv !== (card.tag === 'BUTTON'))).slice(0, 3));
            const withPortrait = people.find(person => person.profilePath);
            const withoutPortrait = cards.find(card => !card.portrait);
            if (withPortrait) {
                const src = `https://image.tmdb.org/t/p/w185${withPortrait.profilePath}`;
                const card = cards.find(candidate => candidate.portrait === src);
                record(label, `episode page: ${withPortrait.name}'s TMDB portrait (w185) on the card`, !!card, src);
                record(label, 'episode page: the portrait was requested from image.tmdb.org', imageRequests.has(src) ? 'PASS' : 'NOT VERIFIED',
                    imageRequests.has(src) ? undefined : 'lazy and not scrolled into view, or image.tmdb.org unreachable');
            }
            if (withoutPortrait) record(label, 'episode page: a person without a portrait shows the person icon', withoutPortrait.icon, withoutPortrait);
        }
        if (admin && canDownload) {
            record(label, 'episode page: the administrator\'s Get a Release in the header', shown.getRelease);
            const code = 'S' + String(episode.seasonNumber).padStart(2, '0') + 'E' + String(episode.episodeNumber).padStart(2, '0');
            if (shown.getRelease) {
                await pickerFrom(page, label, 'episode page Get a Release', page.locator('.page:not(.hide) .mainDetailButtons .jfmod-getRelease'), tv,
                    [`Episode: ${code} · ${episode.title}`, `Season ${episode.seasonNumber}`, 'All Seasons']);
            }
        } else {
            record(label, 'episode page: no Get a Release for this user', !shown.getRelease);
        }
        if (tv && shown.cast.cards.length) {
            // A person card is a stop that only scrolls its row: Enter on it leaves the page where it is.
            const card = page.locator('.page:not(.hide) #castContent .card').first();
            await card.focus();
            await page.keyboard.press('Enter');
            await page.waitForTimeout(800);
            record(label, 'episode page on the TV: Enter on a person card stays on the page',
                (await page.evaluate(() => location.hash)).includes(`&episode=${episode.episodeNumber}`));
        }
    }
    const pageHash = await page.evaluate(() => location.hash);
    if (tv) await page.keyboard.press('Escape');
    else await page.goBack();
    const back = await page.waitForFunction(target => location.hash === target, before, { timeout: 15000 }).then(() => true, () => false);
    record(label, `${what}: Back returns to the season page`, back, { before, now: await page.evaluate(() => location.hash) });
    await page.waitForSelector('.page:not(.hide) .jfmod-missingRow', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(800);
    return pageHash;
}

let serial = 0;
const now = () => new Date().toISOString();
/** A queue row as the plugin answers it (types/queue.ts), built from the instance's own entry and episodes. */
const queueRow = (entry, { episode = null, pack = null, progress }) => ({
    id: `00000000-0000-4000-8000-${String(++serial).padStart(12, '0')}`,
    grabId: `00000000-0000-4000-9000-${String(serial).padStart(12, '0')}`,
    entry: { id: entry.id, mediaType: entry.mediaType, title: entry.title, year: entry.year ?? null, posterPath: null,
        jellyfinItemId: entry.jellyfinItemId ?? null, targetLibraryId: null },
    episode, releaseTitle: 'JellyfinMod FU17 fixture', state: 'downloading', importState: 'waiting', reason: null, message: null,
    progress, sizeBytes: null, downloadedBytes: null, downloadRateBytes: 1000000, etaSeconds: 600, stalledSince: null, observedAt: now(),
    versionLabel: null, intent: 'acquire', createdAt: now(), updatedAt: now(), client: null, seeding: null, pack
});

/**
 * What an upstream season card shows of a download: the bar, the download disc (P4.FU6: the arrow and the arc, left of upstream's
 * plain count pill, which carries no arrow) and whether a mark is visible.
 */
const seasonDownloadView = (page, itemId) => page.evaluate(id => {
    const card = [...document.querySelectorAll('.page:not(.hide) #listChildrenCollapsible .itemsContainer > .card')]
        .find(node => (node.getAttribute('data-id') ?? '').replace(/-/g, '').toLowerCase() === id);
    if (!card) return null;
    const frame = card.querySelector('.cardScalable');
    const bar = frame?.querySelector('.jfmod-dlCardBar');
    const disc = frame?.querySelector('.jfmod-dlmark');
    const pill = frame?.querySelector('.countIndicator');
    const none = frame?.querySelector('.jfmod-mark--none');
    const pillBox = pill?.getBoundingClientRect();
    const discBox = disc?.getBoundingClientRect();
    return {
        bar: !!bar && bar.getBoundingClientRect().height > 0,
        percent: bar ? parseFloat(bar.querySelector('.jfmod-dlBar-fill')?.style.width ?? '') : null,
        arrow: disc && discBox.width > 0 && disc.classList.contains('jfmod-dlmark--downloading') ? 'disc' : null,
        // Two icons: the disc left of the count pill, never inside it.
        twoIcons: !pill || (!!discBox && discBox.right <= pillBox.left + 1 && !pill.querySelector('.jfmod-dlmark')),
        noneVisible: !!none && getComputedStyle(none).display !== 'none'
    };
}, itemId);

/**
 * P1.FU17: upstream's season cards take their season's download from the queue, like the series' card and the season page's
 * rows. The queue answer is intercepted (see the header); the page is left again with the route removed.
 */
async function checkSeasonDownloads(page, label, detail, seriesId, seasons, layout) {
    const own = number => detail.episodes.filter(episode => episode.seasonNumber === number);
    const empty = seasons.filter(season => season.number > 0 && own(season.number).length && own(season.number).every(episode => episode.availability !== 'onDisk'))
        .sort((a, b) => Number(a.seriesId === seriesId) - Number(b.seriesId === seriesId))[0];
    const partial = seasons.find(season => season.number > 0 && own(season.number).some(episode => episode.availability === 'onDisk')
        && own(season.number).some(episode => episode.availability === 'missing'));
    if (!empty && !partial) {
        record(label, 'season cards show their download', 'NOT VERIFIED', 'no native season without files and none with a missing episode');
        return;
    }
    const items = [];
    if (empty) {
        items.push(queueRow(detail.entry, { progress: 0.4, pack: { scope: 'season', label: `Season ${empty.number} pack`, mode: 'fill',
            episodes: own(empty.number).map(episode => ({ episodeId: episode.id, seasonNumber: episode.seasonNumber, episodeNumber: episode.episodeNumber,
                importId: null, importState: 'waiting', reason: null, progress: 0.4, sizeBytes: null })) } }));
    }
    const partialEpisode = partial && own(partial.number).find(episode => episode.availability === 'missing');
    if (partialEpisode) {
        items.push(queueRow(detail.entry, { progress: 0.6, episode: { id: partialEpisode.id, seasonNumber: partialEpisode.seasonNumber,
            episodeNumber: partialEpisode.episodeNumber, title: partialEpisode.title } }));
    }
    const answer = { items, totalRecordCount: items.length, clientStatus: { reachable: true, checkedAt: now(), reason: null },
        importEnabled: true, seedReleaseEnabled: true };
    const handler = route => (route.request().method() === 'GET' ?
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...answer, generatedAt: now() }) }) : route.continue());
    const matcher = url => /\/JellyfinMod\/Queue$/i.test(url.pathname);
    await page.route(matcher, handler);
    try {
        await go(page, '#/home');
        await go(page, `#/details?id=${seriesId}`);
        await page.waitForSelector('.page:not(.hide) #listChildrenCollapsible .itemsContainer .card', { timeout: 30000 });
        await page.waitForFunction(() => !!document.querySelector('.page:not(.hide) .jfmod-dlCard'), undefined, { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(1500);
        for (const season of seasons.filter(candidate => candidate.number > 0)) {
            const view = await seasonDownloadView(page, season.id.replace(/-/g, '').toLowerCase());
            if (season === empty) {
                record(label, `upstream Season ${season.number} card (no file${season.seriesId === seriesId ? '' : ', under another Jellyfin series item'}) with a season pack: the bar at 40% and the disc, Not Downloaded hidden`,
                    !!view?.bar && view.percent === 40 && !!view.arrow && view.twoIcons && !view.noneVisible, view);
            } else if (season === partial && partialEpisode) {
                record(label, `upstream Season ${season.number} card (files, E${partialEpisode.episodeNumber} downloading): the bar at 60% and the disc left of the plain count pill`,
                    !!view?.bar && view.percent === 60 && !!view.arrow && view.twoIcons, view);
            } else {
                record(label, `upstream Season ${season.number} card: no download`, !!view && !view.bar && !view.arrow, view);
            }
        }
        if (layout === 'desktop') await checkInert(page, label, 'a season card\'s download disc', page.locator('.page:not(.hide) .jfmod-dlCard .jfmod-dlmark'));
        const modCards = await page.evaluate(() => [...document.querySelectorAll('.page:not(.hide) .jfmod-missingCard')]
            .filter(card => card.querySelector('.jfmod-dlCardBar')).map(card => card.dataset.jfmodSeason));
        record(label, 'the missing season cards show no download (none of theirs is on its way)', modCards.length === 0, modCards);
        if (!empty) record(label, 'an empty native season with a season pack', 'NOT VERIFIED', 'no native season without files');
        else if (empty.seriesId === seriesId) record(label, 'a season under another Jellyfin series item (the 1923 case)', 'NOT VERIFIED', 'every season is under the page\'s series item');
        await page.screenshot({ path: `${process.env.JELLYFINMOD_SHOTS ?? '.'}/mse-${tier}-${label.split(',')[0]}-season-downloads.png` }).catch(() => {});
    } finally {
        await page.unroute(matcher, handler);
        await go(page, '#/home');
        await go(page, `#/details?id=${seriesId}`);
        await page.waitForSelector('.page:not(.hide) #listChildrenCollapsible .itemsContainer .card', { timeout: 30000 });
        await page.waitForTimeout(1500);
    }
}

/**
 * Hovers a card on the desktop and reads its overlay (P1.FU19): whether upstream's Play shows, whether Get a Release sits in
 * the centre (on upstream's overlay the icon in Play's round classes, on the mod's own cards `.jfmod-cardGetCentre`), and
 * whether a cloud shows in the bottom row. `waitForCentre` waits for an administrator's icon, which is asked for once.
 */
async function hoverCard(page, selector, waitForCentre) {
    const card = page.locator(selector).first();
    if (!await card.count()) return null;
    await card.scrollIntoViewIfNeeded().catch(() => {});
    await page.mouse.move(1, 1);
    await page.waitForTimeout(300);
    const box = await card.locator('.cardScalable').first().boundingBox();
    if (!box) return null;
    // Inside the cover, away from the centre's icon and the corner's mark.
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3);
    if (waitForCentre) {
        await page.waitForSelector(`${selector} .cardOverlayContainer > .cardOverlayFab-primary.jfmod-cardGet:not([hidden]), ${selector} .jfmod-cardGetCentre`,
            { timeout: 10000 }).catch(() => {});
    }
    await page.waitForTimeout(waitForCentre ? 600 : 2500);
    return page.evaluate(sel => {
        const node = document.querySelector(sel);
        const shown = el => !!el && !el.hidden && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0
            && Number(getComputedStyle(el.closest('.cardOverlayContainer') ?? el).opacity) > 0.5;
        const play = [...node.querySelectorAll('.cardOverlayButton[data-action="play"], .cardOverlayButton[data-action="resume"]')].some(shown);
        const centre = [...node.querySelectorAll('.cardOverlayContainer > .cardOverlayFab-primary.jfmod-cardGet, .jfmod-cardGetCentre')].find(shown);
        const frame = node.querySelector('.cardScalable').getBoundingClientRect();
        const at = centre?.getBoundingClientRect();
        return {
            play, centre: !!centre, title: centre?.getAttribute('title') ?? null, icon: !!centre?.querySelector('.cloud_download'),
            centred: !!at && Math.abs(at.left + at.width / 2 - (frame.left + frame.width / 2)) <= 3
                && Math.abs(at.top + at.height / 2 - (frame.top + frame.height / 2)) <= 3,
            bottom: [...node.querySelectorAll('.cardOverlayButton-br .jfmod-cardGet')].some(shown)
        };
    }, selector);
}

/** Tab from the card's first focusable through it: what took focus inside the card, in order (play, get, other). */
async function tabTrail(page, selector) {
    const first = page.locator(`${selector} a, ${selector} button`).first();
    if (!await first.count()) return [];
    await first.focus();
    const trail = [];
    for (let index = 0; index < 6; index++) {
        await page.keyboard.press('Tab');
        await page.waitForTimeout(150);
        const kind = await page.evaluate(sel => {
            const active = document.activeElement;
            if (!active?.closest(sel)) return null;
            if (active.matches('.jfmod-cardGet, .jfmod-cardGetCentre')) return active.matches('.cardOverlayFab-primary') ? 'centreGet' : 'get';
            if (active.matches('[data-action="play"], [data-action="resume"]')) return 'play';
            return 'other';
        }, selector);
        if (!kind) break;
        trail.push(kind);
    }
    return trail;
}

/** Opens the picker from `locator` (a movie has no scope list) and checks the page did not move; closes it. */
async function pickerOpens(page, label, what, locator) {
    const before = await page.evaluate(() => location.hash);
    await locator.click();
    const opened = await page.waitForSelector('.jfmod-releaseDialog', { timeout: 15000 }).then(() => true, () => false);
    await page.waitForTimeout(800);
    record(label, `${what}: opens the picker on the page`, opened && (await page.evaluate(() => location.hash)) === before);
    if (opened) record(label, `${what}: Back closes the picker`, await closePicker(page, false));
    await page.waitForTimeout(600);
}

/**
 * P1.FU19 on the series page's Seasons row: no Play on a card with nothing on disk, Get a Release in its centre for an
 * administrator (desktop hover, keyboard Tab), nothing for an ordinary user; upstream's Play kept on a season with files; the
 * marks plain indicators with no hover look; on the TV no second stop inside a card.
 */
async function checkCardHovers(page, label, { layout, tv, admin, canDownload, upstreamCards, target, seasonNumbers }) {
    const idOf = season => Object.keys(seasonNumbers).find(id => seasonNumbers[id] === season);
    const empty = upstreamCards.find(card => card.mark?.kind === 'none');
    const withFiles = upstreamCards.find(card => card.season > 0 && !card.mark);
    const modSelector = target && `.page:not(.hide) .jfmod-missingCard[data-jfmod-season="${target.season}"]`;
    if (layout === 'desktop') {
        if (empty) {
            // Upstream writes the id dashed or plain: the card is found by its normalised id and tagged for the selectors below.
            await page.evaluate(([id, mark]) => {
                const card = [...document.querySelectorAll('.page:not(.hide) #listChildrenCollapsible .itemsContainer > .card')]
                    .find(node => (node.getAttribute('data-id') ?? '').replace(/-/g, '').toLowerCase() === id);
                card?.setAttribute('data-jfmod-test', mark);
            }, [idOf(empty.season), 'empty']);
            const sel = '.page:not(.hide) .card[data-jfmod-test="empty"]';
            const hover = await hoverCard(page, sel, canDownload);
            record(label, `upstream Season ${empty.season} card (no episode on disk): ${canDownload ? 'hovering shows Get a Release in the centre where Play was (cloud_download), no second cloud in the bottom row' : 'hovering shows neither Play nor Get a Release'}, no Play`,
                !!hover && !hover.play && hover.centre === canDownload && !hover.bottom && (!canDownload || (hover.centred && hover.icon && hover.title === 'Get a Release')), hover);
            await page.screenshot({ path: `${process.env.JELLYFINMOD_SHOTS ?? '.'}/mse-${tier}-${label.split(',')[0]}-${admin ? 'admin' : 'user'}-empty-season-hover.png` }).catch(() => {});
            if (canDownload && hover?.centre) {
                const trail = await tabTrail(page, sel);
                record(label, `upstream Season ${empty.season} card: Tab reaches the centre Get a Release and never a Play`, trail.includes('centreGet') && !trail.includes('play'), trail);
                await hoverCard(page, sel, true);
                await pickerFrom(page, label, `upstream Season ${empty.season} card's centre Get a Release`,
                    page.locator(`${sel} .cardOverlayContainer > .jfmod-cardGet`), false, [`Season ${empty.season}`, 'All Seasons']);
            }
            await checkInert(page, label, `upstream Season ${empty.season} card's Not Downloaded`, page.locator(`${sel} .jfmod-mark--none`));
            await page.evaluate(() => document.querySelector('.card[data-jfmod-test]')?.removeAttribute('data-jfmod-test'));
        } else {
            record(label, 'an upstream season card with nothing on disk', 'NOT VERIFIED', 'no native season without a file on this entry');
        }
        if (withFiles) {
            await page.evaluate(id => {
                const card = [...document.querySelectorAll('.page:not(.hide) #listChildrenCollapsible .itemsContainer > .card')]
                    .find(node => (node.getAttribute('data-id') ?? '').replace(/-/g, '').toLowerCase() === id);
                card?.setAttribute('data-jfmod-test', 'files');
            }, idOf(withFiles.season));
            const sel = '.page:not(.hide) .card[data-jfmod-test="files"]';
            const hover = await hoverCard(page, sel, false);
            // An administrator's bottom-row icon shows once its card's answer arrives (asked on the first hover).
            record(label, `upstream Season ${withFiles.season} card (files): upstream's Play kept in the centre${canDownload ? ', Get a Release in the bottom row, not the centre' : ''}`,
                !!hover && hover.play && !hover.centre && hover.bottom === canDownload, hover);
            await page.screenshot({ path: `${process.env.JELLYFINMOD_SHOTS ?? '.'}/mse-${tier}-${label.split(',')[0]}-${admin ? 'admin' : 'user'}-files-season-hover.png` }).catch(() => {});
            await page.evaluate(() => document.querySelector('.card[data-jfmod-test]')?.removeAttribute('data-jfmod-test'));
        } else {
            record(label, 'an upstream season card with files keeps Play', 'NOT VERIFIED', 'no native season with a file on disk');
        }
        if (modSelector) {
            const hover = await hoverCard(page, modSelector, canDownload);
            record(label, `missing Season ${target.season} card: ${canDownload ? 'hovering shows Get a Release in the centre' : 'hovering shows no Get a Release'}, no Play`,
                !!hover && !hover.play && hover.centre === canDownload && (!canDownload || (hover.centred && hover.icon && hover.title === 'Get a Release')), hover);
            if (canDownload && hover?.centre) {
                await pickerFrom(page, label, `missing Season ${target.season} card's centre Get a Release`, page.locator(`${modSelector} .jfmod-cardGetCentre`), false,
                    [`Season ${target.season}`, 'All Seasons']);
            }
            if (target.mark?.kind === 'none') await checkInert(page, label, `missing Season ${target.season} card's Not Downloaded`, page.locator(`${modSelector} .jfmod-mark--none`));
        }
    } else {
        // The phone and the TV have no hover overlay: no centre icon, and no Play on a card with nothing on disk.
        const facts = await page.evaluate(() => [...document.querySelectorAll('.page:not(.hide) #listChildrenCollapsible .itemsContainer > .card')].map(card => ({
            nofile: card.hasAttribute('data-jfmod-nofile'),
            play: [...card.querySelectorAll('.cardOverlayButton[data-action="play"], .cardOverlayButton[data-action="resume"]')]
                .some(el => getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0),
            centre: !!card.querySelector('.jfmod-cardGetCentre, .cardOverlayContainer > .jfmod-cardGet'),
            stops: [...card.querySelectorAll('button, a, [tabindex]')].filter(el => el.tabIndex >= 0 && el.getBoundingClientRect().width > 0).length
        })));
        const flagged = facts.filter(fact => fact.nofile);
        record(label, `${tv ? 'TV' : 'phone'}: the season cards with nothing on disk show no Play and no centre icon`,
            flagged.length > 0 ? flagged.every(fact => !fact.play && !fact.centre) : 'NOT VERIFIED', facts);
        if (tv) {
            record(label, 'TV: no season card holds a second stop (the marks are no stops)', facts.every(fact => fact.stops === 0), facts);
            if (empty) {
                await page.evaluate(id => {
                    const card = [...document.querySelectorAll('.page:not(.hide) #listChildrenCollapsible .itemsContainer > .card')]
                        .find(node => (node.getAttribute('data-id') ?? '').replace(/-/g, '').toLowerCase() === id);
                    card?.focus();
                }, idOf(empty.season));
                await page.keyboard.press('ArrowUp');
                await page.waitForTimeout(300);
                const where = await page.evaluate(() => (document.activeElement?.closest('.jfmod-mark') ? 'mark' : document.activeElement?.className?.slice(0, 60) ?? 'none'));
                record(label, `TV: Up on upstream Season ${empty.season}'s card reaches no mark`, where !== 'mark', where);
                await page.screenshot({ path: `${process.env.JELLYFINMOD_SHOTS ?? '.'}/mse-${tier}-tv-${admin ? 'admin' : 'user'}-season-focus.png` }).catch(() => {});
            }
        }
    }
}

/** What the download block of a missing episode's page shows (P1.FU20), and what is on the still and the old detail line. */
const blockView = page => page.evaluate(() => {
    const view = document.querySelector('.page:not(.hide)');
    const block = view?.querySelector('.jfmod-dlblockSlot .jfmod-dlblock');
    const stills = [...(view?.querySelectorAll('.jfmod-episodeStill') ?? [])];
    const common = {
        stillMarks: stills.reduce((count, still) => count + still.querySelectorAll('.jfmod-mark, .jfmod-dlmark').length, 0),
        statusLine: !!view?.querySelector('.jfmod-queueStatusLine')
    };
    if (!block) return { ...common, block: false };
    const ring = block.querySelector('.jfmod-dlblock-ring > *');
    const figure = block.querySelector('.jfmod-dlblock-figure');
    const fill = block.querySelector('.jfmod-dlblock-barFill');
    const shown = node => !!node && node.getBoundingClientRect().width > 0;
    let ringKind = ring?.getAttribute('data-jfmod-kind') ?? null;
    if (!ringKind && ring?.classList.contains('jfmod-dlblock-none')) ringKind = 'none';
    if (!ringKind && ring?.classList.contains('jfmod-dlblock-unaired')) ringKind = 'unaired';
    const font = ring ? parseFloat(getComputedStyle(ring).fontSize) : 0;
    return {
        ...common,
        block: true,
        state: block.getAttribute('data-jfmod-state'),
        ringKind,
        number: ring?.querySelector('.jfmod-dlmark-numValue')?.textContent ?? null,
        glyph: !!ring?.querySelector('.jfmod-dlmark-glyph, .jfmod-markGlyph'),
        ringEm: ring && font ? Math.round(ring.getBoundingClientRect().width / font * 100) / 100 : null,
        word: block.querySelector('.jfmod-dlblock-word')?.textContent ?? null,
        figure: figure?.textContent ?? null,
        // P4.FU15 (treatment B): the whole state line at 600 in Inter, waiting states at 75 %; downloading's word is visually hidden.
        stateLine: (node => node ? { weight: getComputedStyle(node).fontWeight, opacity: getComputedStyle(node).opacity, colour: getComputedStyle(node).color,
            family: getComputedStyle(node).fontFamily, wordVisible: shown(block.querySelector('.jfmod-dlblock-word')) && block.querySelector('.jfmod-dlblock-word').getBoundingClientRect().width > 2 } : null)(block.querySelector('.jfmod-dlblock-state')),
        // P4.FU8: the ring (its glyph, number and arc), the figure, the bar and the not-finished dots are the block's own text colour.
        colours: { block: getComputedStyle(block).color, ring: ring ? getComputedStyle(ring).color : null,
            arc: ring?.querySelector('.jfmod-dlmark-fill') ? getComputedStyle(ring.querySelector('.jfmod-dlmark-fill')).stroke : null,
            figure: figure ? getComputedStyle(figure).color : null, bar: fill ? getComputedStyle(fill).backgroundColor : null },
        tone: [...(figure?.classList ?? [])].find(name => name.startsWith('jfmod-dlblock-figure--'))?.slice(22) ?? null,
        release: block.querySelector('.jfmod-dlblock-release')?.textContent ?? null,
        marks: [...(block.querySelector('.jfmod-dlblock-marks')?.children ?? [])].map(node => node.textContent.trim()).filter(Boolean).join(' ') || null,
        mediaMarks: [...block.querySelectorAll('.jfmod-dlblock-marks .jfmod-releaseMark')].map(mark => mark.getAttribute('aria-label') || mark.textContent.trim()),
        client: block.querySelector('.jfmod-dlblock-client')?.getAttribute('href') ?? null,
        clientLabel: block.querySelector('.jfmod-dlblock-client')?.getAttribute('aria-label') ?? null,
        pack: block.querySelector('.jfmod-dlblock-pack > span')?.textContent ?? null,
        dots: [...block.querySelectorAll('.jfmod-dlblock-dot')].map(dot => dot.getAttribute('data-jfmod-dot')
            + (dot.classList.contains('jfmod-dlblock-dot--current') ? '*' : '')),
        bar: fill ? { width: fill.style.width, kind: [...fill.classList].find(name => name.startsWith('jfmod-dlblock-barFill--'))?.slice(23) ?? null,
            animation: getComputedStyle(fill).animationName, height: Math.round(fill.parentElement.getBoundingClientRect().height / font * 100) / 100 } : null,
        arcAnimation: ring?.querySelector('.jfmod-dlmark-arc') ? getComputedStyle(ring.querySelector('.jfmod-dlmark-arc')).animationName : null,
        actions: [...block.querySelectorAll('.jfmod-dlblock-actions > *')].filter(shown).map(node => node.textContent.trim()),
        // Everything in the block a keyboard or the D-pad can stop on.
        stops: [...block.querySelectorAll('a[href], button, [tabindex]')].filter(shown).map(node => node.textContent.trim() || node.getAttribute('aria-label')),
        beforeTracks: block.parentElement.nextElementSibling?.classList.contains('trackSelections') ?? false,
        panel: getComputedStyle(block).backgroundColor
    };
});

const PARSED = { title: 'Fixture', year: null, seasonNumber: 1, episodeNumbers: [1], seasonPack: false, absoluteNumbering: false,
    dailyNumbering: false, resolution: '1080p', source: 'webdl', codec: 'h264', audio: 'DD+', hdr: null, group: 'GRP', proper: false,
    repack: false, quality: 'webdl-1080p', languages: ['EN'], subtitles: [], audioChannels: '5.1' };
const CLIENT = { id: '00000000-0000-4000-8000-00000000c11e', name: 'Transmission', openUrl: 'http://127.0.0.1:9/transmission/web/' };

/**
 * The download block of a missing episode's page, every state (P1.FU20, user-approved design 2026-10-13). INTERCEPTED QUEUE
 * ANSWERS (and, for Unaired and the imported transition, an intercepted entry answer), NOT A LIVE DOWNLOAD. Checks the ring (the
 * percent inside while it downloads or stalls), the state line, the release name, its marks, the pack line and its strip, the
 * bar, the actions and who gets them, Cancel Download's confirmation and request, Search Again and Get a Release opening the
 * picker, the still without a mark, reduced motion, and the imported transition to Jellyfin's own page.
 */
async function checkDownloadBlock(page, label, detail, episode, hash, { admin, canDownload, tv, layout }) {
    const shots = process.env.JELLYFINMOD_SHOTS ?? '.';
    const who = admin ? 'admin' : 'user';
    const season = detail.episodes.filter(item => item.seasonNumber === episode.seasonNumber).sort((a, b) => a.episodeNumber - b.episodeNumber);
    const index = season.findIndex(item => item.id === episode.id);
    const native = detail.episodes.find(item => item.availability === 'onDisk' && item.jellyfinItemId);
    const ref = { id: episode.id, seasonNumber: episode.seasonNumber, episodeNumber: episode.episodeNumber, title: episode.title };
    const release = `Fixture.S${String(episode.seasonNumber).padStart(2, '0')}E${String(episode.episodeNumber).padStart(2, '0')}.1080p.WEB-DL.DDP5.1.H.264-GRP`;
    const single = over => ({ ...queueRow(detail.entry, { episode: ref, progress: 0.42 }), releaseTitle: release, sizeBytes: 4.6e9,
        downloadedBytes: 1.932e9, downloadRateBytes: 3.1e6, etaSeconds: 720, parsed: PARSED, indexerName: 'Fixture Indexer',
        client: admin ? CLIENT : null, ...over });
    // A season pack: the episodes before this one imported and finished, this one at 42 % of its own 4.6 GB file, the rest waiting.
    // The other episodes: the first imported, the second's file finished and importing, the rest waiting.
    const others = season.filter(item => item.id !== episode.id).map(item => item.id);
    const dotOf = item => {
        if (item.id === episode.id) return 'part';
        if (item.id === others[0]) return 'done';
        return item.id === others[1] ? 'finished' : 'waiting';
    };
    const OWN = { part: { importState: 'waiting', progress: 0.42 }, done: { importState: 'completed', progress: 1 },
        finished: { importState: 'identifying', progress: 1 }, waiting: { importState: 'waiting', progress: 0 } };
    const packEpisodes = season.map(item => ({ episodeId: item.id, seasonNumber: item.seasonNumber, episodeNumber: item.episodeNumber,
        importId: null, reason: null, sizeBytes: 4.6e9, ...OWN[dotOf(item)] }));
    const packRow = { ...queueRow(detail.entry, { progress: 0.5, pack: { scope: 'season', label: `Season ${episode.seasonNumber} pack · ${season.length} episodes`,
        mode: 'fill', episodes: packEpisodes } }), releaseTitle: release.replace(/E\d+\./, '.'), sizeBytes: 38.2e9, downloadedBytes: 19e9,
    downloadRateBytes: 3.1e6, etaSeconds: 6000, parsed: { ...PARSED, seasonPack: true, episodeNumbers: [] }, indexerName: 'Fixture Indexer',
    client: admin ? CLIENT : null };
    const eta = Math.max(1, Math.round(Math.ceil(4.6e9 * 0.58 / 3.1e6) / 60));
    const queue = { items: [] };
    const removals = [];
    let entryPatch = null;
    const queueHandler = route => {
        const request = route.request();
        if (request.method() === 'GET') {
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: queue.items, totalRecordCount: queue.items.length,
                generatedAt: now(), clientStatus: { reachable: true, checkedAt: now(), reason: null }, importEnabled: true, seedReleaseEnabled: true }) });
        }
        if (request.method() === 'DELETE') {
            removals.push({ url: request.url(), body: request.postDataJSON() });
            return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        }
        return route.continue();
    };
    const queueMatcher = url => /\/JellyfinMod\/Queue(\/[^/]+)?$/i.test(url.pathname);
    const entryHandler = async route => {
        if (route.request().method() !== 'GET' || !entryPatch) return route.continue();
        const response = await route.fetch();
        const body = await response.json();
        body.episodes = body.episodes.map(item => (item.id === episode.id ? { ...item, ...entryPatch } : item));
        return route.fulfill({ response, body: JSON.stringify(body) });
    };
    const entryMatcher = url => url.pathname.toLowerCase().endsWith('/jellyfinmod/entries/' + detail.entry.id.toLowerCase());
    await page.route(queueMatcher, queueHandler);
    await page.route(entryMatcher, entryHandler);
    const open = async (items, state, patch = null) => {
        queue.items = items;
        entryPatch = patch;
        await go(page, '#/home');
        await go(page, hash);
        const ok = await page.waitForSelector(`.page:not(.hide) .jfmod-dlblock[data-jfmod-state="${state}"]`, { timeout: 20000 }).then(() => true, () => false);
        await page.waitForTimeout(700);
        return ok;
    };
    const shoot = async name => {
        const slot = page.locator('.page:not(.hide) .jfmod-dlblockSlot').first();
        await slot.scrollIntoViewIfNeeded().catch(() => {});
        await page.waitForTimeout(200);
        await page.screenshot({ path: `${shots}/dlblock-${tier}-${layout}-${who}-${name}-dark.png` }).catch(() => {});
        if (admin) {
            await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
            await page.waitForTimeout(300);
            await page.screenshot({ path: `${shots}/dlblock-${tier}-${layout}-${who}-${name}-light.png` }).catch(() => {});
            await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
        }
    };
    const actions = (...names) => JSON.stringify(names);
    try {
        // ---- Downloading, a season pack: the ring with 42 inside, the figures, the release, its marks, the pack line, the bar.
        let ok = await open([packRow], 'downloading');
        let shown = await blockView(page);
        const strip = season.map(item => dotOf(item) + (item.id === episode.id ? '*' : ''));
        record(label, 'download block, downloading: in the track selectors\' place, the 4em ring (3.2em on the phone) with "42" inside and no glyph',
            ok && shown.beforeTracks && shown.ringKind === 'downloading' && shown.number === '42' && !shown.glyph && Math.abs(shown.ringEm - (layout === 'mobile' ? 3.2 : 4)) < 0.05, shown);
        record(label, `download block, downloading: "42% · ${eta} min left · 3.1 MB/s · 1.9 of 4.6 GB" alone (no "Downloading" word on screen, kept hidden for assistive technology) in the page's text colour at 600, no amber`,
            shown.word === 'Downloading' && shown.stateLine?.wordVisible === false && shown.stateLine.weight === '600' && /inter/i.test(shown.stateLine.family)
            && shown.stateLine.opacity === '1' && shown.figure === `42% · ${eta} min left · 3.1 MB/s · 1.9 of 4.6 GB` && shown.tone === 'plain'
            && shown.colours.figure === shown.colours.block && shown.colours.ring === shown.colours.block && shown.colours.arc === shown.colours.block
            && shown.colours.bar === shown.colours.block, { figure: shown.figure, colours: shown.colours });
        record(label, 'download block: the release name and its marks (1080p WEB-DL, the codec and audio marks, EN, the pack\'s 38.2 GB, the indexer)',
            shown.release === packRow.releaseTitle && /^1080p WEB-DL\b/.test(shown.marks ?? '') && shown.mediaMarks.includes('AVC')
            && shown.mediaMarks.includes('Dolby Digital Plus') && /\bEN\b/.test(shown.marks) && shown.marks.includes('38.2 GB')
            && shown.marks.includes('Fixture Indexer'), { marks: shown.marks, mediaMarks: shown.mediaMarks });
        const clientShown = admin && !tv;
        const noClient = tv ? 'no Open Transmission (TV)' : 'no Open Transmission (ordinary user)';
        record(label, `download block: ${clientShown ? 'Open Transmission for the administrator' : noClient}`,
            clientShown ? shown.client === CLIENT.openUrl && shown.clientLabel === 'Open Transmission' : shown.client === null, shown.client);
        record(label, `download block: "Season ${episode.seasonNumber} pack · this episode is file ${index + 1} of ${season.length}" and one dot per episode (imported, importing, this one downloading, waiting)`,
            shown.pack === `Season ${episode.seasonNumber} pack · this episode is file ${index + 1} of ${season.length}` && JSON.stringify(shown.dots) === JSON.stringify(strip),
            { pack: shown.pack, dots: shown.dots });
        record(label, 'download block: the 0.28em bar at 42 %', shown.bar?.width === '42%' && shown.bar.kind === 'downloading' && Math.abs(shown.bar.height - 0.28) < 0.02, shown.bar);
        record(label, `download block, downloading: ${admin ? 'View Queue and Cancel Download' : 'View Queue only'}`,
            JSON.stringify(shown.actions) === (admin ? actions('View Queue', 'Cancel Download') : actions('View Queue')), shown.actions);
        record(label, 'download block: the ring, the marks and the strip are no stops; the links and buttons are',
            JSON.stringify(shown.stops) === JSON.stringify([...(clientShown ? ['Open Transmission'] : []), ...shown.actions]), shown.stops);
        record(label, 'the still carries no mark or disc while the episode downloads, and the old detail line is gone', shown.stillMarks === 0 && !shown.statusLine,
            { stillMarks: shown.stillMarks, statusLine: shown.statusLine });
        await shoot('downloading');
        if (tv && admin) {
            // The D-pad: from the header's Get a Release down into the block's links and buttons, then on to Cast & Crew.
            const get = page.locator('.page:not(.hide) .mainDetailButtons .jfmod-getRelease');
            if (await get.count()) {
                await get.focus();
                const trail = [];
                for (const key of ['ArrowDown', 'ArrowRight', 'ArrowDown']) {
                    await page.keyboard.press(key);
                    await page.waitForTimeout(300);
                    trail.push(await page.evaluate(() => {
                        const active = document.activeElement;
                        if (active?.closest('.jfmod-dlblock')) return active.textContent.trim();
                        if (active?.closest('#castContent, #guestCastContent')) return 'person card';
                        return active?.className?.toString().slice(0, 40) ?? 'none';
                    }));
                }
                record(label, 'TV: Down from Get a Release reaches View Queue, Right Cancel Download, Down a person card',
                    JSON.stringify(trail) === JSON.stringify(['View Queue', 'Cancel Download', 'person card']), trail);
            }
        }

        // ---- Stalled, one episode's own torrent.
        ok = await open([single({ state: 'stalled', stalledSince: new Date(Date.now() - 20 * 60000).toISOString() })], 'stalled');
        shown = await blockView(page);
        record(label, 'download block, stalled: "42" in the dimmed ring, "Stalled 42% · no progress for 20 min" at 600 and 75 %, the bar dimmed, no pack line',
            ok && shown.stateLine?.weight === '600' && shown.stateLine.opacity === '0.75' && shown.ringKind === 'stalled' && shown.number === '42' && shown.word === 'Stalled' && shown.figure === '42% · no progress for 20 min'
            && shown.bar?.kind === 'stalled' && shown.pack === null && shown.marks.includes('4.6 GB'), shown);
        await shoot('stalled');

        // ---- Queued.
        ok = await open([single({ state: 'queued', progress: null, downloadedBytes: null, etaSeconds: null })], 'queued');
        shown = await blockView(page);
        record(label, `download block, queued: the clock, "Queued waiting to start", no bar, ${admin ? 'View Queue and Cancel Download' : 'View Queue'}`,
            ok && shown.ringKind === 'queued' && shown.glyph && shown.number === null && shown.word === 'Queued' && shown.figure === 'waiting to start'
            && shown.tone === 'plain' && shown.stateLine?.weight === '600' && shown.stateLine.opacity === '0.75' && !shown.bar && JSON.stringify(shown.actions) === (admin ? actions('View Queue', 'Cancel Download') : actions('View Queue')), shown);
        await shoot('queued');

        // ---- Importing: the spinner, the step, a full bar breathing, no Cancel.
        ok = await open([single({ state: 'linking', importState: 'linking', progress: 1 })], 'importing');
        shown = await blockView(page);
        record(label, 'download block, importing: the spinner, "Importing linking into the library…", the full bar breathing, View Queue only',
            ok && shown.ringKind === 'importing' && shown.word === 'Importing' && shown.figure === 'linking into the library…'
            && shown.bar?.width === '100%' && shown.bar.animation !== 'none' && JSON.stringify(shown.actions) === actions('View Queue'), shown);
        await shoot('importing');
        if (layout === 'desktop' && admin) {
            await page.emulateMedia({ reducedMotion: 'reduce' });
            await page.waitForTimeout(300);
            const still = await blockView(page);
            record(label, 'download block under reduced motion: the bar does not breathe and the ring does not turn',
                shown.arcAnimation !== 'none' && still.bar?.animation === 'none' && still.arcAnimation === 'none',
                { before: shown.arcAnimation, bar: still.bar?.animation, arc: still.arcAnimation });
            await page.emulateMedia({ reducedMotion: 'no-preference' });
        }

        // ---- Failed: the red bang, the reason in red, Search Again (administrators) and View Queue.
        ok = await open([single({ state: 'failed', importState: 'failed', reason: 'destination_not_writable', message: null })], 'failed');
        shown = await blockView(page);
        const searchAgain = admin && canDownload;
        record(label, `download block, failed: the red bang, "Failed The library folder cannot be written." in red, ${searchAgain ? 'Search Again and View Queue' : 'View Queue only'}`,
            ok && shown.ringKind === 'failed' && shown.word === 'Failed' && shown.figure === 'The library folder cannot be written.' && shown.tone === 'error'
            && !shown.bar && JSON.stringify(shown.actions) === (searchAgain ? actions('Search Again', 'View Queue') : actions('View Queue')), shown);
        await shoot('failed');
        if (searchAgain) {
            await pickerFrom(page, label, 'download block Search Again', page.locator('.page:not(.hide) .jfmod-dlblock-search'), tv,
                [`Episode: ${'S' + String(episode.seasonNumber).padStart(2, '0') + 'E' + String(episode.episodeNumber).padStart(2, '0')} · ${episode.title}`,
                    `Season ${episode.seasonNumber}`, 'All Seasons']);
        }

        // ---- Not downloaded: the cloud, Get a Release for administrators, "no release chosen yet" for everyone else.
        ok = await open([], 'none');
        shown = await blockView(page);
        record(label, `download block, not downloaded: the cloud, "Not Downloaded"${admin && canDownload ? ' and Get a Release' : ', "no release chosen yet" and no button'}`,
            ok && shown.ringKind === 'none' && shown.word === 'Not Downloaded' && !shown.release && !shown.bar
            && (admin && canDownload ? shown.figure === null && JSON.stringify(shown.actions) === actions('Get a Release') :
                shown.figure === 'no release chosen yet' && shown.actions.length === 0), shown);
        await shoot('not-downloaded');
        if (admin && canDownload) {
            await pickerFrom(page, label, 'download block Get a Release', page.locator('.page:not(.hide) .jfmod-dlblock-get'), tv,
                [`Episode: ${'S' + String(episode.seasonNumber).padStart(2, '0') + 'E' + String(episode.episodeNumber).padStart(2, '0')} · ${episode.title}`,
                    `Season ${episode.seasonNumber}`, 'All Seasons']);
        }

        // ---- Unaired (an intercepted entry answer): the clock, the date and the countdown, nothing to press.
        // The plugin's own form of an air date: midnight UTC.
        const airs = new Date(Date.now() + 200 * 86400000).toISOString().slice(0, 10) + 'T00:00:00.0000000Z';
        ok = await open([], 'unaired', { availability: 'unaired', airDate: airs });
        shown = await blockView(page);
        const long = await longDate(page, airs);
        record(label, `download block, unaired: the clock, "Unaired airs ${long} · in 7 months", no actions`,
            ok && shown.ringKind === 'unaired' && shown.word === 'Unaired' && shown.figure === `airs ${long} · in 7 months` && shown.actions.length === 0, shown);
        await shoot('unaired');

        // ---- Cancel Download (administrators): the confirmation names the release; Remove sends the torrent-only removal.
        if (admin) {
            const cancelled = single({});
            ok = await open([cancelled], 'downloading');
            await press(page, page.locator('.page:not(.hide) .jfmod-dlblock-cancel'), tv);
            const dialog = await page.waitForSelector('.dialog:not(.hide) .confirmationDialog, .dialogContainer .dialog', { timeout: 10000 }).then(() => true, () => false);
            const text = await page.evaluate(() => document.querySelector('.dialogContainer .dialog')?.textContent.replace(/\s+/g, ' ').trim() ?? null);
            record(label, 'Cancel Download asks "Remove the Torrent" and names the release', ok && dialog && text?.includes('Remove the Torrent') && text.includes(release), text);
            queue.items = [];
            await page.locator('.dialogContainer .dialog button').filter({ hasText: 'Remove' }).last().click();
            await page.waitForTimeout(1500);
            const sent = removals.at(-1);
            record(label, 'Remove sends DELETE /JellyfinMod/Queue/{id} with removeFromClient and no blocklist, and the block reads Not Downloaded',
                !!sent && sent.url.endsWith('/JellyfinMod/Queue/' + cancelled.id) && sent.body?.removeFromClient === true && sent.body?.blocklist === false
                && await page.waitForSelector('.page:not(.hide) .jfmod-dlblock[data-jfmod-state="none"]', { timeout: 10000 }).then(() => true, () => false), sent);
        } else {
            ok = await open([single({})], 'downloading');
            shown = await blockView(page);
            record(label, 'an ordinary user gets no Cancel Download and no Open Transmission', ok && !shown.actions.includes('Cancel Download') && !shown.client, shown.actions);
        }

        // ---- Imported: the queue's row finishes and the entry holds the file; the page becomes Jellyfin's own episode page.
        if (native) {
            ok = await open([single({ progress: 0.97, downloadedBytes: 4.46e9, etaSeconds: 30 })], 'downloading');
            queue.items = [single({ state: 'seeding', importState: 'completed', progress: 1, downloadedBytes: 4.6e9, etaSeconds: null,
                seeding: { id: '00000000-0000-4000-8000-0000000005ee', state: 'waiting', reason: null, ratio: 0.1, goalRatio: 1, seedingSeconds: 60,
                    goalSeconds: null, waitingFor: ['ratio'], goalMetAt: null, libraryLinkPresent: true, releaseEnabled: true } })];
            entryPatch = { availability: 'onDisk', state: 'onDisk', jellyfinItemId: native.jellyfinItemId };
            const moved = await page.waitForFunction(id => location.hash.includes('id=' + id), native.jellyfinItemId, { timeout: 20000 }).then(() => true, () => false);
            const upstream = moved && await page.waitForSelector('.page:not(.hide) .trackSelections:not(.hide)', { timeout: 20000 }).then(() => true, () => false);
            await page.waitForTimeout(800);
            const after = await page.evaluate(() => {
                const view = document.querySelector('.page:not(.hide)');
                const play = view?.querySelector('.mainDetailButtons .btnPlay');
                return { hash: location.hash, block: !!view?.querySelector('.jfmod-dlblock'), play: !!play && !play.classList.contains('hide'),
                    selects: [...(view?.querySelectorAll('.trackSelections .selectContainer:not(.hide)') ?? [])].length };
            });
            record(label, 'imported: the page becomes Jellyfin\'s own episode page, its Video / Audio / Subtitle selectors and Play in place of the block',
                ok && moved && upstream && !after.block && after.play && after.selects > 0, after);
            await page.screenshot({ path: `${shots}/dlblock-${tier}-${layout}-${who}-imported.png` }).catch(() => {});
        } else {
            record(label, 'imported transition', 'NOT VERIFIED', 'the entry has no episode on disk with a Jellyfin item');
        }
    } finally {
        await page.unroute(queueMatcher, queueHandler);
        await page.unroute(entryMatcher, entryHandler);
        await go(page, '#/home');
    }
}

async function run(browser, layout, user, admin) {
    const label = `${layout}, ${admin ? 'administrator' : 'ordinary user'}`;
    const tv = !!LAYOUTS[layout].tv;
    const options = { ...LAYOUTS[layout] };
    delete options.tv;
    const context = await browser.newContext(options);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error.message).slice(0, 200)));
    page.on('request', request => { if (request.url().startsWith('https://image.tmdb.org/')) imageRequests.add(request.url()); });
    try {
        await serveLocal(page);
        await signIn(page, user);
        if (tv) {
            await page.evaluate(() => localStorage.setItem('layout', 'tv'));
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } }, undefined, { timeout: 30000 });
        }
        const isAdmin = await page.evaluate(async () => !!(await ApiClient.getCurrentUser()).Policy?.IsAdministrator);
        record(label, admin ? 'signed in as an administrator' : 'signed in as an ordinary user', isAdmin === admin);
        const health = await apiGet(page, 'JellyfinMod/Health');
        // The Health answer is PascalCase (`Capabilities`), as modApi's getPluginHealth reads it.
        const capabilities = health?.Capabilities ?? health?.capabilities ?? [];
        const canDownload = admin && capabilities.includes('acquisition.releases');
        const packs = capabilities.includes('acquisition.packs');

        // The series page: let it load the list if it never was, then read what the plugin lists.
        const first = await apiGet(page, 'JellyfinMod/Entries/' + entryId);
        if (first?.entry.mediaType !== 'series') throw new Error('the entry is not a series');
        // A series with no file has no `jellyfinItemId` on its entry, yet Jellyfin may hold its series item (and season folders):
        // that item is found by title and must look up this very entry.
        const seriesId = first.entry.jellyfinItemId ?? await page.evaluate(async ([title, id]) => {
            const found = await ApiClient.getItems(ApiClient.getCurrentUserId(), { searchTerm: title, IncludeItemTypes: 'Series', Recursive: true });
            for (const item of found.Items) {
                const response = await fetch(ApiClient.getUrl('JellyfinMod/Entries', { jellyfinItemId: item.Id, limit: 1 }),
                    { headers: { Authorization: `MediaBrowser Token="${ApiClient.accessToken()}"` } });
                const entries = response.ok ? await response.json() : null;
                if (entries?.items?.[0]?.id === id) return item.Id;
            }
            return null;
        }, [first.entry.title, entryId]);
        if (!seriesId) throw new Error('no Jellyfin series item looks up this entry');
        await go(page, `#/details?id=${seriesId}`);
        await page.waitForSelector('.page:not(.hide) #listChildrenCollapsible .itemsContainer .card', { timeout: 30000 });
        await page.waitForTimeout(3000);
        const detail = await apiGet(page, 'JellyfinMod/Entries/' + entryId);
        const seasons = await page.evaluate(async id => (await ApiClient.getSeasons(id, { userId: ApiClient.getCurrentUserId(), Fields: 'ChildCount' })).Items
            .map(item => ({ id: item.Id, number: item.IndexNumber, seriesId: item.SeriesId, childCount: item.ChildCount ?? 0 })), seriesId);
        const seasonNumbers = Object.fromEntries(seasons.map(season => [season.id.replace(/-/g, '').toLowerCase(), season.number]));
        const held = new Set(seasons.map(season => season.number));
        const missing = [...new Set(detail.episodes.map(episode => episode.seasonNumber))]
            .filter(season => season > 0 && !held.has(season)).sort((a, b) => a - b);
        await page.waitForFunction(count => document.querySelectorAll('.page:not(.hide) .jfmod-missingCard').length >= count,
            missing.length, { timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(1000);
        const row = await seasonRow(page, seasonNumbers);
        const modCards = row.filter(card => card.mod);
        record(label, 'series page: one mod card per plugin season without a Jellyfin season (no specials)',
            JSON.stringify(modCards.map(card => card.season)) === JSON.stringify(missing), { shown: modCards.map(card => card.season), missing });
        record(label, 'series page: every card in season order, mod cards among upstream\'s', ascending(row.map(card => card.season ?? -1)),
            row.map(card => `${card.mod ? 'mod' : 'up'}:${card.season}`));
        // P1.FU17: upstream's own season cards carry the mark when none of their episodes is on disk, whatever the watched state.
        const upstreamCards = row.filter(card => !card.mod);
        for (const card of upstreamCards) {
            const expected = expectedNativeMark(card.season, detail.episodes);
            const what = `upstream Season ${card.season} card (${card.played ? 'watched' : 'not watched'})`;
            if (!expected) {
                record(label, `${what}: an episode on disk (or none listed), so no mark`, !card.mark, card.mark);
                continue;
            }
            await checkAnyMark(page, label, what, card.mark, expected);
            if (!card.mark) continue;
            record(label, `${what}: the mark is visible, top right`, card.mark.visible && card.mark.topRight, card.mark);
            if (card.cluster) {
                // Option 1: just left of upstream's tick or count, on the same line, neither covering the other.
                const rtl = await page.evaluate(() => document.documentElement.getAttribute('dir') === 'rtl');
                const beside = rtl ? card.mark.box.left >= card.cluster.right - 1 : card.mark.box.right <= card.cluster.left + 1;
                const sameLine = Math.abs((card.mark.box.top + card.mark.box.bottom) / 2 - (card.cluster.top + card.cluster.bottom) / 2) <= 4;
                const gap = rtl ? card.mark.box.left - card.cluster.right : card.cluster.left - card.mark.box.right;
                record(label, `${what}: the mark sits just left of upstream's ${card.played ? 'tick' : 'indicator'}, both visible`,
                    beside && sameLine && gap <= 12, { mark: card.mark.box, cluster: card.cluster, gap });
            }
        }
        // P1.FU21: every upstream season card carries the mod cards' "N episodes" line: Jellyfin's own count (ChildCount), or, for a
        // season Jellyfin keeps with no episode, the entry's list; in the mod cards' element and classes, with the same look.
        const modLook = row.find(card => card.mod)?.line2Look ?? null;
        for (const card of upstreamCards) {
            const childCount = seasons.find(season => season.number === card.season)?.childCount ?? 0;
            const count = childCount || detail.episodes.filter(episode => episode.seasonNumber === card.season).length;
            const unit = count === 1 ? ' episode' : ' episodes';
            const words = count ? count + unit : null;
            const listed = detail.episodes.filter(episode => episode.seasonNumber === card.season).length;
            const what = `upstream Season ${card.season} card (Jellyfin ${childCount}, list ${listed})`;
            const expectation = words ? '"' + words + '" under "Season ' + card.season + '", once' : 'no count line';
            record(label, `${what}: ${expectation}`,
                words ? card.line2 === words && card.countLines === 1 && card.lineCount === 2 : card.countLines === 0,
                { title: card.title, line2: card.line2, lines: card.lineCount, countLines: card.countLines });
            if (!words || !card.line2Look) continue;
            const line = card.line2Look;
            record(label, `${what}: the line is a DIV.cardText.cardText-secondary.cardTextCentered holding a BDI, right under the title`,
                line.tag === 'DIV' && line.classes === 'cardText cardText-secondary cardTextCentered' && line.child === 'BDI'
                    && Math.abs(line.top - card.titleLook.bottom) <= 2, { line, title: card.titleLook });
            if (modLook) {
                const keys = ['tag', 'classes', 'child', 'fontSize', 'lineHeight', 'fontWeight', 'fontFamily', 'color', 'textAlign', 'padding', 'height'];
                const differs = keys.filter(key => line[key] !== modLook[key]);
                record(label, `${what}: the line looks exactly like the mod cards' "N episodes" line`, differs.length === 0,
                    differs.length ? Object.fromEntries(differs.map(key => [key, [line[key], modLook[key]]])) : line.fontSize);
                const modCover = row.find(other => other.mod)?.coverHeight;
                record(label, `${what}: the cover keeps its size (the line adds only itself)`, Math.abs(card.coverHeight - modCover) <= 1,
                    { cover: card.coverHeight, modCover });
            } else {
                record(label, `${what}: the line looks exactly like the mod cards' line`, 'NOT VERIFIED', 'no mod card on this page to compare with');
            }
        }
        const withCount = upstreamCards.find(card => card.countLines === 1);
        if (withCount) {
            // Upstream redraws a card by replacing it with fresh HTML: the line comes back, once.
            await page.evaluate(id => {
                const card = [...document.querySelectorAll('.page:not(.hide) #listChildrenCollapsible .itemsContainer > .card')]
                    .find(node => (node.getAttribute('data-id') ?? '').replace(/-/g, '').toLowerCase() === id);
                const fresh = card?.cloneNode(true);
                fresh?.querySelectorAll('.jfmod-markSlot, [data-jfmod-count]').forEach(node => { node.remove(); });
                if (fresh) card.replaceWith(fresh);
            }, Object.keys(seasonNumbers).find(id => seasonNumbers[id] === withCount.season));
            await page.waitForTimeout(800);
            const again = (await seasonRow(page, seasonNumbers)).find(card => !card.mod && card.season === withCount.season);
            record(label, `upstream Season ${withCount.season} card: the count line comes back once when upstream redraws the card`,
                again?.line2 === withCount.line2 && again.countLines === 1, again && { line2: again.line2, countLines: again.countLines });
        }
        const withFiles = upstreamCards.find(card => card.season > 0 && detail.episodes.some(episode => episode.seasonNumber === card.season && episode.availability === 'onDisk'));
        record(label, 'series page: a native season with files carries no mark', withFiles ? !withFiles.mark : 'NOT VERIFIED',
            withFiles ? withFiles.mark : 'no native season with a file on disk');
        const watchedEmpty = upstreamCards.find(card => card.played && expectedNativeMark(card.season, detail.episodes)?.kind === 'none');
        record(label, 'series page: a watched native season with no file carries the tick and the Not Downloaded mark',
            watchedEmpty ? watchedEmpty.mark?.kind === 'none' && watchedEmpty.mark.visible : 'NOT VERIFIED',
            watchedEmpty ? { season: watchedEmpty.season, mark: watchedEmpty.mark } : 'no watched native season without a file on this entry');
        // Upstream redraws a card by replacing it: the mark comes back on the new card.
        const marked = upstreamCards.find(card => card.mark);
        if (marked) {
            await page.evaluate(id => {
                const card = [...document.querySelectorAll('.page:not(.hide) #listChildrenCollapsible .itemsContainer > .card')]
                    .find(node => (node.getAttribute('data-id') ?? '').replace(/-/g, '').toLowerCase() === id);
                // Upstream draws a fresh card from its HTML: a copy without the mod's slot.
                const fresh = card?.cloneNode(true);
                fresh?.querySelectorAll('.jfmod-markSlot, [data-jfmod-count]').forEach(node => { node.remove(); });
                if (fresh) card.replaceWith(fresh);
            }, Object.keys(seasonNumbers).find(id => seasonNumbers[id] === marked.season));
            await page.waitForTimeout(800);
            const again = (await seasonRow(page, seasonNumbers)).find(card => !card.mod && card.season === marked.season);
            record(label, `upstream Season ${marked.season} card: the mark comes back when upstream redraws the card`,
                again?.mark?.kind === marked.mark.kind && again.mark.visible, again?.mark);
        }
        for (const card of modCards) {
            const episodes = detail.episodes.filter(episode => episode.seasonNumber === card.season);
            const words = episodes.length + (episodes.length === 1 ? ' episode' : ' episodes');
            record(label, `Season ${card.season} card: "Season ${card.season}", "${words}", a poster or the dashed placeholder, the mark top right`,
                card.title === `Season ${card.season}` && card.line2 === words && (card.cover ? true : card.dashed === 'dashed') && !!card.mark?.topRight, card);
            await checkAnyMark(page, label, `Season ${card.season} card`, card.mark, expectedMark(episodes));
            const tmdbSeason = detail.entry.metadata?.seasons.find(candidate => candidate.number === card.season);
            checkCover(label, `Season ${card.season} card poster`, card, tmdbSeason?.posterPath, 'w342');
        }
        // Upstream redraws its list by replacing its children: the mod's cards come back, in place.
        if (modCards.length) {
            await page.evaluate(() => { for (const card of document.querySelectorAll('.page:not(.hide) .jfmod-missingCard')) card.remove(); });
            await page.waitForTimeout(800);
            const again = await seasonRow(page, seasonNumbers);
            record(label, 'series page: the mod cards return in order when the list is redrawn',
                JSON.stringify(again.map(card => card.season)) === JSON.stringify(row.map(card => card.season)), again.map(card => card.season));
        }
        const target = modCards.find(card => card.mark?.kind === 'none') ?? modCards[0];
        await checkCardHovers(page, label, { layout, tv, admin, canDownload: canDownload && packs, upstreamCards, target, seasonNumbers });
        if (admin) await checkSeasonDownloads(page, label, detail, seriesId, seasons, layout);
        if (target) {
            const card = page.locator(`.page:not(.hide) .jfmod-missingCard[data-jfmod-season="${target.season}"]`);
            if (tv) await press(page, card, true);
            // Off centre: on the desktop the centre holds an administrator's Get a Release while the card is hovered (P1.FU19).
            else await card.locator('.jfmod-missingPoster').click({ position: { x: 12, y: 12 } });
            const opened = await page.waitForFunction(season => location.hash.includes('entryId=') && location.hash.includes('season=' + season),
                target.season, { timeout: 15000 }).then(() => true, () => false);
            record(label, `Season ${target.season} card opens the mod's season page`, opened, await page.evaluate(() => location.hash));
            if (opened) {
                await page.waitForSelector('.page:not(.hide) .jfmod-missingRow', { timeout: 20000 }).catch(() => {});
                const heading = await page.evaluate(() => document.querySelector('.page:not(.hide) .itemMiscInfo-primary')?.textContent.trim());
                const tmdbSeason = detail.entry.metadata?.seasons.find(candidate => candidate.number === target.season);
                const count = detail.episodes.filter(episode => episode.seasonNumber === target.season).length;
                const expectedHeading = [`Season ${target.season}`, `${count} episode${count === 1 ? '' : 's'}`, /^\d{4}/.exec(tmdbSeason?.airDate ?? '')?.[0]]
                    .filter(Boolean).join(' · ');
                record(label, `the mod's season page reads "${expectedHeading}"`, heading === expectedHeading, heading);
                const overview = await page.evaluate(() => {
                    const node = document.querySelector('.page:not(.hide) .detailSectionContent .overview');
                    return node && node.offsetParent !== null ? node.textContent.trim() : null;
                });
                if (tmdbSeason?.overview) {
                    record(label, 'the mod\'s season page shows TMDB\'s season overview', overview === tmdbSeason.overview.trim(), overview?.slice(0, 80));
                } else {
                    record(label, 'the mod\'s season page shows TMDB\'s season overview', 'NOT VERIFIED', 'the season has no overview in the entry (refresh pending, or TMDB has none)');
                }
                const pagePoster = await page.evaluate(() => document.querySelector('.page:not(.hide) .detailImageContainer .jfmod-entryPoster img')?.getAttribute('src') ?? null);
                record(label, 'the mod\'s season page shows the season\'s poster', pagePoster === `https://image.tmdb.org/t/p/w500${tmdbSeason?.posterPath ?? detail.entry.posterPath}`, pagePoster);
                const shown = await checkSeasonRows(page, label, detail, detail.episodes.filter(episode => episode.seasonNumber === target.season), {},
                    { admin, canDownload, layout, what: `mod Season ${target.season} page` });
                // P1.FU15: the episode with the most people opens its page, checked in full.
                const people = candidate => (candidate.credits?.guestStars.length ?? 0) + (candidate.credits?.crew.length ?? 0);
                const opening = shown.map(entry => detail.episodes.find(candidate => candidate.id === entry.id)).filter(Boolean)
                    .sort((a, b) => people(b) - people(a))[0];
                const pageHash = opening && await checkEpisodePage(page, label, detail, opening, { admin, canDownload, tv, what: `mod Season ${target.season} page`, full: true });
                if (pageHash) await checkDownloadBlock(page, label, detail, opening, pageHash, { admin, canDownload, tv, layout });
            }
        }
        // A native season page with episodes Jellyfin does not have.
        for (const season of seasons.filter(candidate => candidate.number > 0)) {
            const native = await page.evaluate(async ([series, id]) => (await ApiClient.getEpisodes(series, { seasonId: id, userId: ApiClient.getCurrentUserId() }))
                .Items.map(item => ({ id: item.Id, number: item.IndexNumber, end: item.IndexNumberEnd })), [seriesId, season.id]);
            const heldNumbers = new Set(native.flatMap(item => Array.from({ length: (item.end ?? item.number) - item.number + 1 }, (_, i) => item.number + i)));
            const plugin = detail.episodes.filter(episode => episode.seasonNumber === season.number && !heldNumbers.has(episode.episodeNumber));
            if (!plugin.some(episode => episode.availability !== 'onDisk')) continue;
            await go(page, `#/details?id=${season.id}`);
            await page.waitForSelector('.page:not(.hide) #listChildrenCollapsible:not(.hide)', { timeout: 20000 }).catch(() => {});
            const numbers = Object.fromEntries(native.map(item => [item.id.replace(/-/g, '').toLowerCase(), item.number]));
            const shownRows = await checkSeasonRows(page, label, detail, plugin, numbers, { admin, canDownload, layout, what: `native Season ${season.number} page` });
            const stray = await page.evaluate(() => document.querySelectorAll('.page:not(.hide) [data-jfmod-count]').length);
            record(label, `native Season ${season.number} page: no season count line (P1.FU21 is the series page's only)`, stray === 0, stray);
            const opening = shownRows[0] && detail.episodes.find(candidate => candidate.id === shownRows[0].id);
            if (opening) await checkEpisodePage(page, label, detail, opening, { admin, canDownload, tv, what: `native Season ${season.number} page`, full: false });
            break;
        }
        if (!admin) {
            const buttons = await page.evaluate(() => document.querySelectorAll('.page:not(.hide) .jfmod-markButton').length);
            record(label, 'an ordinary user sees no Download button on this page', buttons === 0, buttons);
        }
        // A file-less movie on the search page.
        if (movieEntryId) {
            const movie = await apiGet(page, 'JellyfinMod/Entries/' + movieEntryId);
            await go(page, '#/search?query=' + encodeURIComponent(movie.entry.title));
            const card = page.locator(`.page:not(.hide) [data-jfmod-tmdb-id="${movie.entry.tmdbId}"]`).first();
            await card.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
            const mark = await card.evaluate(node => {
                const found = node.querySelector('.jfmod-mark');
                return found ? { kind: found.classList.contains('jfmod-mark--none') ? 'none' : 'other', tag: found.tagName, title: found.getAttribute('title'),
                    cursor: getComputedStyle(found).cursor, tabIndex: found.tabIndex } : null;
            }).catch(() => null);
            await checkMark(page, label, `${movie.entry.title} search card`, mark);
            if (layout === 'desktop') {
                const selector = `.page:not(.hide) [data-jfmod-tmdb-id="${movie.entry.tmdbId}"]`;
                const hover = await hoverCard(page, selector, canDownload);
                record(label, `${movie.entry.title} search card (no file): ${canDownload ? 'hovering shows Get a Release in the centre' : 'hovering shows no Get a Release'}, no Play`,
                    !!hover && !hover.play && hover.centre === canDownload && !hover.bottom, hover);
                if (canDownload && hover?.centre) {
                    await pickerOpens(page, label, `${movie.entry.title} search card's centre Get a Release`, page.locator(`${selector} .jfmod-cardGetCentre`));
                }
            }
        }
        record(label, 'no page errors', errors.length === 0, errors);
    } catch (error) {
        record(label, 'the run completed', false, String(error?.message ?? error).split('\n')[0]);
    } finally {
        await context.close();
    }
}

const args = localDist ? ['--disable-features=PrivateNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,LocalNetworkAccessChecks'] : [];
const browser = await chromium.launch(tier === 'chrome' ? { headless: true, channel: 'chrome', args } : { headless: true, args });
try {
    for (const layout of layouts) {
        await run(browser, layout, 'oleksii', true);
        if (ordinaryUser) await run(browser, layout, ordinaryUser, false);
        else record(`${layout}, ordinary user`, 'ordinary user checks', 'NOT VERIFIED', 'JELLYFINMOD_MSE_USER not given');
    }
} finally {
    await browser.close();
}
const failed = results.filter(result => result.verdict === 'FAIL').length;
console.log(`${results.length} checks, ${failed} failed (${tier}${localDist ? ', LOCAL BUILD, not acceptance' : ''})`);
process.exitCode = failed ? 1 : 0;
/* eslint-enable compat/compat, no-restricted-globals, @stylistic/max-statements-per-line, no-empty-function, sonarjs/cognitive-complexity */
