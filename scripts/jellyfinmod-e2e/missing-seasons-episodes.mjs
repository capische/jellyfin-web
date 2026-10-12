/* eslint-disable compat/compat, no-restricted-globals, @stylistic/max-statements-per-line, no-empty-function, sonarjs/cognitive-complexity -- a Node acceptance runner, not shipped code */
/* global window, document, ApiClient, localStorage, location, getComputedStyle, coverOf */
// Every season and every episode on the native pages (P1.FU11, design approved 2026-10-12; UX §3.1 and §7.4).
// Signed in as oleksii with an empty password (and, when given, an ordinary user with an empty password), in a real browser
// against a running mod instance, it checks for one series entry:
//   - the native series page shows one mod card per plugin season (other than specials) with no Jellyfin season item, in season
//     order among upstream's cards, with the dashed placeholder, "Season N", "K episodes" and the right mark top right; the
//     cards come back in place when the list is redrawn; upstream's own season cards carry no mod mark;
//   - an administrator's Not Downloaded on a season card is a button "Download This Season" that opens the release picker on
//     that season (Season N and All Seasons only) without leaving the page; an ordinary user's is a plain indicator;
//   - a missing season card opens the mod's season page (#/details?entryId=…&season=N), which lists that season's episodes as
//     mod rows in episode order with their marks; an episode's Download This Episode opens the picker for that episode;
//   - a native season page with missing episodes shows mod rows in episode order among upstream's rows;
//   - TV: the D-pad reaches the administrator's icons and never stops on a mod row itself; phone: no overview on the rows;
//   - optionally a file-less movie's search card: the amber Not Downloaded "Download This Movie" opens the picker;
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
//   JELLYFINMOD_TEST_URL=http://<host>:<port>/   a mod instance (18096, 28096, 48096) or a local environment on 127.0.0.1
//   JELLYFINMOD_MSE_ENTRY=<series entry id>       a series whose plugin list holds seasons or episodes Jellyfin does not have
//   [JELLYFINMOD_MSE_USER=<ordinary user name>]  also check as this ordinary user (empty password); absent: NOT VERIFIED
//   [JELLYFINMOD_MSE_MOVIE=<entry id>]           a file-less movie entry, checked on the search page
//   [JELLYFINMOD_WEB_PATH=/web/]  [JELLYFINMOD_BROWSER=chromium|chrome]  [JELLYFINMOD_LAYOUTS=desktop,mobile,tv1080]
//
// Reads only, with two exceptions that are the page's own behaviour: opening a series page whose TMDB list was never loaded
// loads it (P1.FU9), and opening the picker runs a release search. Nothing is grabbed; every picker is closed.
import { chromium } from 'playwright';

const origin = new URL(process.env.JELLYFINMOD_TEST_URL ?? (() => { throw new Error('JELLYFINMOD_TEST_URL is required'); })());
const loopback = ['127.0.0.1', 'localhost'].includes(origin.hostname);
// Never production on 8096: a remote address must be one of the mod instances; a local environment listens on loopback.
if (!loopback && !['18096', '28096', '48096'].includes(origin.port)) throw new Error('Runs on the mod instances or a local environment only');
const entryId = process.env.JELLYFINMOD_MSE_ENTRY ?? (() => { throw new Error('JELLYFINMOD_MSE_ENTRY is required'); })();
const ordinaryUser = process.env.JELLYFINMOD_MSE_USER ?? null;
const movieEntryId = process.env.JELLYFINMOD_MSE_MOVIE ?? null;
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
            const mark = card.querySelector('.jfmod-mark:not(.jfmod-dlDisc)');
            const texts = [...card.querySelectorAll('.cardFooter .cardText')].map(node => node.textContent.trim());
            const box = mark?.getBoundingClientRect();
            const cover = card.querySelector('.cardScalable')?.getBoundingClientRect();
            return {
                mod,
                season: mod ? Number(card.dataset.jfmodSeason) : byId[(card.getAttribute('data-id') ?? '').replace(/-/g, '').toLowerCase()] ?? null,
                title: texts[0] ?? null,
                line2: texts[1] ?? null,
                dashed: mod ? getComputedStyle(card.querySelector('.jfmod-missingPoster')).outlineStyle : null,
                cover: mod ? coverOf(card.querySelector('.jfmod-missingPoster')) : null,
                mark: mark ? {
                    kind: ['unaired', 'none'].find(name => mark.classList.contains('jfmod-mark--' + name)) ?? 'other',
                    tag: mark.tagName, title: mark.getAttribute('title'), text: mark.textContent.trim(),
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
            const mark = row.querySelector('.jfmod-mark:not(.jfmod-dlDisc)');
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
                    tag: mark.tagName, title: mark.getAttribute('title'), text: mark.textContent.trim()
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

async function checkMark(page, label, what, shown, expected, admin, downloadLabel) {
    if (!shown) { record(label, `${what}: has a mark`, false, null); return; }
    if (expected.kind === 'unaired') {
        const text = await shortDate(page, expected.airDate);
        const title = 'Airs ' + await longDate(page, expected.airDate);
        record(label, `${what}: the Unaired clock with the short air date, not clickable`,
            shown.kind === 'unaired' && shown.text === text && shown.title === title && shown.tag !== 'BUTTON', { shown, text, title });
        return;
    }
    if (admin && downloadLabel) {
        record(label, `${what}: the amber Not Downloaded is a button "${downloadLabel}"`, shown.kind === 'none' && shown.tag === 'BUTTON'
            && shown.title === downloadLabel, shown);
    } else {
        record(label, `${what}: the amber Not Downloaded is a plain indicator "Not Downloaded"`, shown.kind === 'none' && shown.tag !== 'BUTTON'
            && shown.title === 'Not Downloaded', shown);
    }
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

async function checkSeasonRows(page, label, detail, episodes, numbers, { admin, canDownload, layout, what }) {
    const tv = !!LAYOUTS[layout].tv;
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
        await checkMark(page, label, `${what} E${episode.episodeNumber}`, row.mark, expectedMark([episode]), admin && canDownload, 'Download This Episode');
        // P1.FU15: the row opens the episode's page. On the TV the row itself is the stop (a button) and an administrator's icon
        // a second; elsewhere the title is the row's link and the icon a second stop.
        const icon = admin && canDownload && expectedMark([episode]).kind === 'none';
        const href = `#/details?entryId=${encodeURIComponent(detail.entry.id)}`;
        const own = row.focusables.filter(name => !/jfmod-markButton/.test(name));
        record(label, `${what} E${episode.episodeNumber}: ${tv ? 'the row is a button stop' : 'the title links to the episode\'s page'}${icon ? ', the icon a second stop' : ''}`,
            (tv ? row.tag === 'BUTTON' && own.length === 0 : row.link?.startsWith(href) && row.link.endsWith(`&season=${episode.seasonNumber}&episode=${episode.episodeNumber}`)
                && own.length === 1) && row.focusables.length - own.length === (icon ? 1 : 0), { tag: row.tag, link: row.link, focusables: row.focusables });
        if (layout === 'mobile') record(label, `${what} E${episode.episodeNumber}: no overview on the phone`, !row.overviewShown);
    }
    if (tv) {
        await page.evaluate(() => document.activeElement?.blur());
        await page.locator('.page:not(.hide) .detailPagePrimaryContainer button:visible').first().focus().catch(() => {});
        const trail = await dpadTrail(page, rows.length + 6);
        record(label, `${what}: the D-pad stops on the mod rows (P1.FU15)`, trail.includes('modRow'), trail);
        const withIcon = mod.find(row => row.mark?.tag === 'BUTTON');
        if (withIcon) {
            const where = () => page.evaluate(() => {
                const active = document.activeElement;
                if (active?.classList.contains('jfmod-markButton')) return 'icon';
                return active?.classList.contains('jfmod-missingRow') ? 'row' : active?.className ?? 'none';
            });
            await page.locator(`.page:not(.hide) .jfmod-missingRow[data-jfmod-episode-id="${withIcon.id}"]`).focus();
            await page.keyboard.press('ArrowRight');
            await page.waitForTimeout(300);
            const right = await where();
            await page.keyboard.press('ArrowLeft');
            await page.waitForTimeout(300);
            const left = await where();
            record(label, `${what}: Right on a row reaches its icon, Left returns to the row`, right === 'icon' && left === 'row', { right, left });
        }
    }
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
            meta: [...view.querySelectorAll('.itemMiscInfo-primary .mediaInfoItem')].map(item => item.textContent.trim()),
            cover: coverOf(still),
            dashed: still ? getComputedStyle(still).outlineStyle : null,
            mark: !!view.querySelector('.detailImageContainer .jfmod-mark'),
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
        record(label, 'episode page: the mark on the still', shown.mark);
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
    if (tv) await page.keyboard.press('Escape');
    else await page.goBack();
    const back = await page.waitForFunction(target => location.hash === target, before, { timeout: 15000 }).then(() => true, () => false);
    record(label, `${what}: Back returns to the season page`, back, { before, now: await page.evaluate(() => location.hash) });
    await page.waitForSelector('.page:not(.hide) .jfmod-missingRow', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(800);
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
        const seasons = await page.evaluate(async id => (await ApiClient.getSeasons(id, { userId: ApiClient.getCurrentUserId() })).Items
            .map(item => ({ id: item.Id, number: item.IndexNumber })), seriesId);
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
        record(label, 'series page: upstream\'s own season cards carry no mod mark (on disk shows nothing)',
            row.filter(card => !card.mod).every(card => !card.mark), row.filter(card => !card.mod && card.mark));
        for (const card of modCards) {
            const episodes = detail.episodes.filter(episode => episode.seasonNumber === card.season);
            const words = episodes.length + (episodes.length === 1 ? ' episode' : ' episodes');
            record(label, `Season ${card.season} card: "Season ${card.season}", "${words}", a poster or the dashed placeholder, the mark top right`,
                card.title === `Season ${card.season}` && card.line2 === words && (card.cover ? true : card.dashed === 'dashed') && !!card.mark?.topRight, card);
            await checkMark(page, label, `Season ${card.season} card`, card.mark, expectedMark(episodes), canDownload && packs, 'Download This Season');
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
        // An administrator's Not Downloaded opens the picker on that season; the card opens the season's page.
        const target = modCards.find(card => card.mark?.kind === 'none') ?? modCards[0];
        if (target && canDownload && packs && target.mark?.tag === 'BUTTON') {
            await pickerFrom(page, label, `Season ${target.season}'s Download This Season`,
                page.locator(`.page:not(.hide) .jfmod-missingCard[data-jfmod-season="${target.season}"] .jfmod-markButton`), tv,
                [`Season ${target.season}`, 'All Seasons']);
        } else if (admin) {
            record(label, 'Download This Season opens the picker', 'NOT VERIFIED', target ? 'no button (no release search or packs, or the season is unaired)' : 'no missing season');
        }
        if (target && tv && target.mark?.tag === 'BUTTON') {
            // The card is one stop and its icon a second: Up on the card reaches the icon, Down returns.
            const where = () => page.evaluate(() => {
                const active = document.activeElement;
                if (active?.classList.contains('jfmod-markButton')) return 'icon';
                return active?.classList.contains('jfmod-missingCard') ? 'card' : active?.className ?? 'none';
            });
            await page.locator(`.page:not(.hide) .jfmod-missingCard[data-jfmod-season="${target.season}"]`).focus();
            await page.keyboard.press('ArrowUp');
            await page.waitForTimeout(300);
            const up = await where();
            await page.keyboard.press('ArrowDown');
            await page.waitForTimeout(300);
            const down = await where();
            record(label, `Season ${target.season} card on the TV: Up reaches its icon, Down returns to the card`, up === 'icon' && down === 'card', { up, down });
        }
        if (target) {
            const card = page.locator(`.page:not(.hide) .jfmod-missingCard[data-jfmod-season="${target.season}"]`);
            if (tv) await press(page, card, true);
            else await card.locator('.jfmod-missingPoster').click();
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
                const button = shown.find(entry => entry.mark?.tag === 'BUTTON');
                if (button) {
                    const episode = detail.episodes.find(candidate => candidate.id === button.id);
                    const code = 'S' + String(episode.seasonNumber).padStart(2, '0') + 'E' + String(episode.episodeNumber).padStart(2, '0');
                    await pickerFrom(page, label, `E${episode.episodeNumber}'s Download This Episode`,
                        page.locator(`.page:not(.hide) .jfmod-missingRow[data-jfmod-episode-id="${episode.id}"] .jfmod-markButton`), tv,
                        [`Episode: ${code} · ${episode.title}`, `Season ${episode.seasonNumber}`, 'All Seasons']);
                }
                // P1.FU15: the episode with the most people opens its page, checked in full.
                const people = candidate => (candidate.credits?.guestStars.length ?? 0) + (candidate.credits?.crew.length ?? 0);
                const opening = shown.map(entry => detail.episodes.find(candidate => candidate.id === entry.id)).filter(Boolean)
                    .sort((a, b) => people(b) - people(a))[0];
                if (opening) await checkEpisodePage(page, label, detail, opening, { admin, canDownload, tv, what: `mod Season ${target.season} page`, full: true });
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
                const found = node.querySelector('.jfmod-mark:not(.jfmod-dlDisc)');
                return found ? { kind: found.classList.contains('jfmod-mark--none') ? 'none' : 'other', tag: found.tagName, title: found.getAttribute('title') } : null;
            }).catch(() => null);
            await checkMark(page, label, `${movie.entry.title} search card`, mark, { kind: 'none' }, canDownload, 'Download This Movie');
            if (mark?.tag === 'BUTTON') {
                const before = await page.evaluate(() => location.hash);
                await press(page, card.locator('.jfmod-markButton'), tv);
                const opened = await page.waitForSelector('.jfmod-releaseDialog', { timeout: 15000 }).then(() => true, () => false);
                record(label, 'Download This Movie opens the picker without opening the card', opened
                    && (await page.evaluate(() => location.hash)).split('&')[0] === before.split('&')[0]);
                if (opened) await closePicker(page, tv);
            }
        }
        record(label, 'no page errors', errors.length === 0, errors);
    } catch (error) {
        record(label, 'the run completed', false, String(error?.message ?? error).split('\n')[0]);
    } finally {
        await context.close();
    }
}

const browser = await chromium.launch(tier === 'chrome' ? { headless: true, channel: 'chrome' } : { headless: true });
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
console.log(`${results.length} checks, ${failed} failed (${tier})`);
process.exitCode = failed ? 1 : 0;
/* eslint-enable compat/compat, no-restricted-globals, @stylistic/max-statements-per-line, no-empty-function, sonarjs/cognitive-complexity */
