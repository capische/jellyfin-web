/* eslint-disable compat/compat, no-restricted-globals, sonarjs/cognitive-complexity, sonarjs/slow-regex, @stylistic/max-statements-per-line, no-empty-function -- a Node acceptance runner, not shipped code */
/* global window, document, ApiClient, localStorage, location, getComputedStyle */
// TM2 gate 2 (docs/jellyfinmod/TMDB-BROWSE.md, guide design/guides/search-card.md): the search grid and the four TMDb browse pages
// against a running Jellyfin and the live TMDb, in every layout and theme, signed in as oleksii with an empty password.
//
//   JELLYFINMOD_TEST_URL=http://127.0.0.1:<port>/ [JELLYFINMOD_BROWSER=chromium|chrome]
//   [JELLYFINMOD_LAYOUTS=computer,phone,tv1920,tv1280] [JELLYFINMOD_THEMES=dark,light]
//   [JELLYFINMOD_WEB_PATH=/web/]
//   [JELLYFINMOD_TM2_ADD=1]      add titles through the pages (computer, phone and TV in the dark theme), remove each afterwards
//   [JELLYFINMOD_TM2_TOKEN=1]    the environment has a saved TMDb token: a long search pages further and nothing shown moves
//   [JELLYFINMOD_TM2_SHOTS=DIR]  keep a screenshot of every page in every layout and theme there
//
// Every title it adds it removes again, and it proves the libraries it found are the libraries it leaves.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const origin = new URL(process.env.JELLYFINMOD_TEST_URL ?? (() => { throw new Error('JELLYFINMOD_TEST_URL is required'); })());
// The local pool without alpha and beta (the user's own environments, envs/pool.list); never production.
if (!['9096', '10096', '11096', '12096'].includes(origin.port) || origin.hostname !== '127.0.0.1') {
    throw new Error('Runs on the local pool environments bravo, charlie, delta and echo only');
}
const tier = process.env.JELLYFINMOD_BROWSER ?? 'chromium';
const WEB_PATH = process.env.JELLYFINMOD_WEB_PATH ?? '/web/';
const SHOTS = process.env.JELLYFINMOD_TM2_SHOTS ?? null;
const ADD = process.env.JELLYFINMOD_TM2_ADD === '1';
const TOKEN = process.env.JELLYFINMOD_TM2_TOKEN === '1';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const base = () => new URL(WEB_PATH, origin).href;
const PHONE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
const LAYOUTS = {
    computer: { viewport: { width: 1440, height: 900 } },
    phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: PHONE_UA },
    tv1920: { viewport: { width: 1920, height: 1080 }, tv: true },
    tv1280: { viewport: { width: 1280, height: 720 }, tv: true }
};
const PAGE = '.mainAnimatedPage:not(.hide)';
const QUERY = 'gentlemen';
// The Gentlemen, the movie and the show: the mockups' titles. The adds use titles of their own, none of them in the library.
const MOVIE = 522627;
const SERIES = 236235;
const LONG_SERIES = 456; // The Simpsons
const browsePath = (type, id, season, episode) => `#/details?tmdbType=${type}&tmdbId=${id}${season === undefined ? '' : '&season=' + season}${episode === undefined ? '' : '&episode=' + episode}`;
const ADDS = { movie: { type: 'movie', id: 550, title: 'Fight Club' }, series: { type: 'series', id: 87108, title: 'Chernobyl' },
    season: { type: 'series', id: 4613, title: 'Band of Brothers', season: 1 }, episode: { type: 'series', id: 66276, title: 'The Night Of', season: 1, episode: 1 } };
const SEARCH_ADD = { query: 'arrival', key: 'movie:329865', title: 'Arrival' };

const results = [];
const record = (label, check, verdict, detail = '') => {
    let word = verdict;
    if (verdict === true) word = 'PASS';
    else if (verdict === false) word = 'FAIL';
    results.push({ label, check, verdict: word, detail });
    console.log(`${word} [${tier}/${label}] ${check}${detail ? ' — ' + String(detail).slice(0, 400) : ''}`);
};
const notVerified = (label, check, why) => record(label, check, 'NOT VERIFIED', why);
const near = (a, b, within = 2) => Math.abs(a - b) <= within;
const luminance = colour => {
    const [r, g, b] = colour.match(/[\d.]+/g).map(Number);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};
/** Ink that belongs to the theme: light on the dark ground, dark on the light one. */
const inkFits = (colour, theme) => (theme === 'dark' ? luminance(colour) > 0.6 : luminance(colour) < 0.4);

async function signIn(page) {
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
    await field.fill('oleksii');
    await page.locator('#txtManualPassword').fill('');
    await page.locator('button:visible').filter({ hasText: 'Sign In' }).first().click();
    await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } }, undefined, { timeout: 30000 });
    await page.waitForTimeout(1500);
}

const apiJson = (page, path, query) => page.evaluate(([p, q]) => ApiClient.getJSON(ApiClient.getUrl(p, q)), [path, query]);
const apiDelete = (page, path) => page.evaluate(p => ApiClient.ajax({ type: 'DELETE', url: ApiClient.getUrl(p) }).then(() => true), path);

/** A leftover from an earlier failed run would turn an add into opening the existing entry. */
const entryOf = async (page, type, id) => {
    const entries = await apiJson(page, 'JellyfinMod/Entries');
    const list = Array.isArray(entries) ? entries : entries.items ?? entries.Items ?? [];
    return list.find(entry => entry.mediaType === type && entry.tmdbId === id) ?? null;
};

async function open(page, hash, ready, settle = 1200) {
    const target = base() + hash;
    if (page.url() === target) {
        await page.goto(base() + '#/home', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1200);
    }
    await page.goto(target, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(ready, { timeout: 30000 });
    await page.waitForTimeout(settle);
}

const shot = async (page, label, name, fullPage = false) => {
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${label.replace('/', '-')}-${name}.png`, fullPage });
};

// ---- the search grid ------------------------------------------------------------------------------------------------------

async function searchFacts(page) {
    return page.evaluate(() => {
        const cells = [...document.querySelectorAll('.jfmod-searchCell')];
        const rect = node => node.getBoundingClientRect();
        const first = cells[0];
        const firstTop = first ? Math.round(rect(first).top) : 0;
        const poster = first?.querySelector('.jfmod-searchPoster');
        const title = first?.querySelector('.jfmod-searchTitle');
        const lines = first ? [...first.querySelectorAll('.jfmod-searchLine')] : [];
        const kind = document.querySelector('.jfmod-searchKind');
        const cast = first?.querySelector('.jfmod-searchCast');
        const style = node => getComputedStyle(node);
        const root = parseFloat(style(first).fontSize);
        return {
            count: cells.length,
            perRow: cells.filter(cell => Math.round(rect(cell).top) === firstTop).length,
            gridRight: Math.round(rect(document.querySelector('.jfmod-searchGrid')).right),
            viewport: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth,
            padding: first && [style(first).paddingTop, style(first).paddingRight, style(first).paddingBottom, style(first).paddingLeft].map(value => parseFloat(value) / root),
            posterRatio: poster && rect(poster).height / rect(poster).width,
            posterRadius: poster && parseFloat(style(poster).borderTopLeftRadius) / root,
            lineCount: lines.length,
            linePitch: lines[0] && rect(lines[0]).height / root,
            titleWeight: title && style(title).fontWeight,
            titleColour: title && style(title).color,
            castOpacity: cast && style(cast).opacity,
            castColour: cast && style(cast).color,
            kindText: kind?.textContent,
            kindOpacity: kind && style(kind).opacity,
            cards: cells.map(cell => ({ key: cell.dataset.jfmodKey, title: cell.querySelector('.jfmod-searchTitle')?.textContent ?? '',
                year: Number(cell.querySelectorAll('.jfmod-searchLine')[1]?.querySelector('span')?.textContent) || 0,
                series: !!cell.querySelector('.jfmod-searchKind'), href: cell.querySelector('a.jfmod-searchOpen')?.getAttribute('href') ?? '',
                cast: cell.querySelector('.jfmod-searchCast')?.textContent ?? '', mark: !!cell.querySelector('.jfmod-searchPoster [class*="jfmod-mark"]') })),
            heading: [...document.querySelectorAll('.jfmod-searchResults .sectionTitle')].map(node => node.textContent),
            adds: document.querySelectorAll('.jfmod-searchAdd').length
        };
    });
}

const waitForSearch = async (page, query = QUERY) => {
    await open(page, `#/search?query=${encodeURIComponent(query)}`, '.jfmod-searchGrid');
    await page.waitForFunction(() => document.querySelector('.jfmod-searchGrid')?.getAttribute('aria-busy') === 'false'
        && document.querySelectorAll('.jfmod-searchCell').length > 0, undefined, { timeout: 45000 });
    await page.waitForTimeout(600);
};

async function checkSearch(page, label, layoutName, theme) {
    const layout = LAYOUTS[layoutName];
    const phone = layoutName === 'phone';
    await waitForSearch(page);
    await shot(page, label, 'search');
    const facts = await searchFacts(page);
    record(label, 'search: results in one grid', facts.count >= 5 && facts.heading.every(text => !/add from tmdb/i.test(text)), `${facts.count} cells; headings ${facts.heading.join(', ') || 'none'}`);
    record(label, 'search: cells per row', facts.perRow === (phone ? 2 : 5), `${facts.perRow}`);
    record(label, 'search: the grid fits the page', facts.gridRight <= facts.viewport + 1 && facts.scrollWidth <= facts.viewport, `grid right ${facts.gridRight}, page ${facts.scrollWidth}, viewport ${facts.viewport}`);
    const wantPadding = phone ? [0, 1, 1.618, 0] : [1, 1, 1, 1];
    record(label, 'search: cell padding per the guide', facts.padding.every((value, index) => near(value, wantPadding[index], 0.02)), facts.padding.map(value => value.toFixed(3)).join(' '));
    record(label, 'search: 2:3 poster with the card radius', near(facts.posterRatio, 1.5, 0.01) && near(facts.posterRadius, 0.2, 0.02), `${facts.posterRatio.toFixed(3)}, ${facts.posterRadius.toFixed(2)}em`);
    record(label, 'search: three-line caption at pitch φ', facts.lineCount === 3 && near(facts.linePitch, 1.618, 0.02), `${facts.lineCount} lines at ${facts.linePitch.toFixed(3)}em`);
    record(label, 'search: title 700 in the theme\'s ink', facts.titleWeight === '700' && inkFits(facts.titleColour, theme), `${facts.titleWeight} ${facts.titleColour}`);
    record(label, 'search: lead actors and TV Series at 85.4 %', facts.castOpacity === '0.854' && facts.kindOpacity === '0.854' && facts.kindText === 'TV Series', `${facts.castOpacity}, ${facts.kindOpacity}, ${facts.kindText}`);
    const fullMatches = facts.cards.filter(card => card.title.toLowerCase() === QUERY);
    // With a saved token a later page may bring another full match; cards already shown keep their places, so it follows them.
    const firstOther = facts.cards.findIndex(card => card.title.toLowerCase() !== QUERY);
    const leading = facts.cards.slice(0, firstOther);
    record(label, 'search: full matches first, newest first (D206)', leading.length > 0 && (TOKEN || leading.length === fullMatches.length)
        && leading.every((card, index) => index === 0 || leading[index - 1].year >= card.year), leading.map(card => `${card.title} ${card.year}`).join(', '));
    record(label, 'search: movies and shows together', facts.cards.some(card => card.series) && facts.cards.some(card => !card.series), `${facts.cards.filter(card => card.series).length} shows of ${facts.cards.length}`);
    const browseCard = facts.cards.find(card => card.href.includes('tmdbType='));
    record(label, 'search: a TMDb result links its browse page', !!browseCard, browseCard?.href ?? 'none');
    // The + is a library card's hover overlay: the computer's, never the phone's or the TV's (guide, Marks and the add disc).
    record(label, 'search: the + only where cards hover', layoutName === 'computer' ? facts.adds > 0 : facts.adds === 0, `${facts.adds} buttons`);

    // Hover: the computer lights the whole cell in paper, the phone does not.
    if (!layout.tv) {
        const key = browseCard?.key;
        const cell = page.locator(`.jfmod-searchCell[data-jfmod-key="${key}"]`);
        await cell.scrollIntoViewIfNeeded();
        await cell.hover();
        await page.waitForTimeout(450);
        const lit = await cell.evaluate(node => {
            const overlay = node.querySelector('.cardOverlayContainer');
            const button = node.querySelector('.jfmod-searchAdd');
            return { background: getComputedStyle(node).backgroundColor, radius: getComputedStyle(node).borderTopLeftRadius,
                ground: getComputedStyle(document.body).backgroundColor, overlay: overlay && getComputedStyle(overlay).opacity,
                button: button && (({ width, height }) => [Math.round(width), Math.round(height)])(button.getBoundingClientRect()) };
        });
        if (phone) {
            record(label, 'search: no hover panel on the phone', lit.background === 'rgba(0, 0, 0, 0)', lit.background);
        } else {
            record(label, 'search: hover lights the cell in paper, square corners', lit.background !== 'rgba(0, 0, 0, 0)' && lit.background !== lit.ground && lit.radius === '0px', `${lit.background} on ${lit.ground}, radius ${lit.radius}`);
            record(label, 'search: hover shows the + as a poster button', lit.overlay === '1' && lit.button && lit.button[0] >= 40 && lit.button[1] >= 40, `overlay ${lit.overlay}, button ${lit.button}`);
            await shot(page, label, 'search-hover');
        }
        await page.mouse.move(0, 0);
    }

    // The end of the results (one page per kind through Jellyfin's own connection; a token pages further).
    if (!TOKEN) {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForSelector('.jfmod-searchEnd', { timeout: 20000 }).catch(() => {});
        const end = await page.locator('.jfmod-searchEnd').textContent().catch(() => null);
        record(label, 'search: the end says so', end === `No more results for “${QUERY}”`, end ?? 'no end line');
        await page.evaluate(() => window.scrollTo(0, 0));
    }

    if (layout.tv) {
        await page.locator(`${PAGE} .searchfields-txtSearch`).focus().catch(() => {});
        let reached = false;
        for (let press = 0; press < 10 && !reached; press++) {
            await page.keyboard.press('ArrowDown');
            await page.waitForTimeout(250);
            reached = await page.evaluate(() => !!document.activeElement?.closest('.jfmod-searchCell'));
        }
        record(label, 'search: arrows reach the first card', reached, await page.evaluate(() => document.activeElement?.className ?? 'none'));
        if (reached) {
            const ring = await page.evaluate(() => {
                const cell = document.activeElement.closest('.jfmod-searchCell');
                const style = getComputedStyle(cell);
                return { key: cell.dataset.jfmodKey, shadow: style.boxShadow, background: style.backgroundColor, root: parseFloat(style.fontSize) };
            });
            record(label, 'search: TV focus lights the cell with the ring inside', /inset/.test(ring.shadow) && ring.background !== 'rgba(0, 0, 0, 0)', `${ring.shadow}; ${ring.background}`);
            await shot(page, label, 'search-focus');
            await page.keyboard.press('ArrowRight');
            await page.waitForTimeout(350);
            const next = await page.evaluate(() => document.activeElement?.closest('.jfmod-searchCell')?.dataset.jfmodKey);
            record(label, 'search: right moves to the next card', !!next && next !== ring.key, `${ring.key} → ${next}`);
            await page.keyboard.press('ArrowDown');
            await page.waitForTimeout(350);
            const below = await page.evaluate(() => {
                const cell = document.activeElement?.closest('.jfmod-searchCell');
                const box = cell?.getBoundingClientRect();
                return cell && { key: cell.dataset.jfmodKey, top: box.top, bottom: box.bottom, height: window.innerHeight, href: document.activeElement.getAttribute('href') };
            });
            record(label, 'search: down moves a row, the focus in view', !!below && below.key !== next && below.top >= 0 && below.top < below.height, JSON.stringify(below));
            // A TMDb card opens its browse page with Enter; Back returns to the grid.
            const tmdbCard = facts.cards.find(card => card.key === below?.key && card.href.includes('tmdbType='));
            if (tmdbCard) {
                await page.keyboard.press('Enter');
                await page.waitForSelector(`${PAGE} .jfmod-browseAdd`, { timeout: 30000 }).catch(() => {});
                record(label, 'search: Enter opens the browse page', await page.evaluate(() => location.hash.includes('tmdbType=')), await page.evaluate(() => location.hash));
                await page.waitForTimeout(800);
                await page.keyboard.press('Escape');
                await page.waitForSelector('.jfmod-searchGrid', { timeout: 20000 }).catch(() => {});
                await page.waitForTimeout(800);
                record(label, 'search: Back returns to the grid', await page.evaluate(() => location.hash.startsWith('#/search') && document.querySelectorAll('.jfmod-searchCell').length > 0), await page.evaluate(() => location.hash));
            } else {
                notVerified(label, 'search: Enter opens the browse page', 'the focused card is a library title');
            }
        }
    } else {
        await page.locator(`.jfmod-searchCell[data-jfmod-key="${browseCard?.key}"] a.jfmod-searchOpen`).click();
        await page.waitForSelector(`${PAGE} .jfmod-browseAdd`, { timeout: 30000 }).catch(() => {});
        record(label, 'search: clicking a TMDb card opens its browse page', await page.evaluate(() => location.hash.includes('tmdbType=')), await page.evaluate(() => location.hash));
        await page.goBack();
        await page.waitForSelector('.jfmod-searchGrid', { timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(600);
        record(label, 'search: Back returns to the grid', await page.evaluate(() => location.hash.startsWith('#/search') && document.querySelectorAll('.jfmod-searchCell').length > 0), await page.evaluate(() => location.hash));
    }

    // A library title with a file: its own page, no mark.
    const items = await apiJson(page, `Users/${await page.evaluate(() => ApiClient.getCurrentUserId())}/Items`, { IncludeItemTypes: 'Movie,Series', Recursive: true, Limit: 50, IsPlaceHolder: false, Filters: 'IsNotFolder' });
    const owned = items.Items.find(item => item.Type === 'Movie' && item.LocationType === 'FileSystem' && (item.Name ?? '').length > 1);
    if (owned) {
        await waitForSearch(page, owned.Name);
        const row = await page.evaluate(id => {
            const link = [...document.querySelectorAll('.jfmod-searchCell a.jfmod-searchOpen')].find(node => node.getAttribute('href').includes(id));
            const cell = link?.closest('.jfmod-searchCell');
            return cell && { mark: !!cell.querySelector('.jfmod-searchPoster [class*="jfmod-mark"]'), index: [...document.querySelectorAll('.jfmod-searchCell')].indexOf(cell) };
        }, owned.Id);
        record(label, 'search: a library title with a file links its own page, no mark', !!row && !row.mark, `${owned.Name}: ${JSON.stringify(row)}`);
    } else {
        notVerified(label, 'search: a library title with a file links its own page, no mark', 'no movie with a file in this environment');
    }

    // D201: opened from a library it still returns both kinds.
    const views = await apiJson(page, `Users/${await page.evaluate(() => ApiClient.getCurrentUserId())}/Views`);
    const movies = views.Items.find(view => view.CollectionType === 'movies');
    if (movies) {
        await open(page, `#/search?parentId=${movies.Id}&query=${QUERY}`, '.jfmod-searchGrid');
        await page.waitForFunction(() => document.querySelector('.jfmod-searchGrid')?.getAttribute('aria-busy') === 'false' && document.querySelectorAll('.jfmod-searchCell').length > 0, undefined, { timeout: 45000 });
        const scoped = await searchFacts(page);
        record(label, 'search: opened from Movies it still finds shows (D201)', scoped.cards.some(card => card.series), `${scoped.cards.filter(card => card.series).length} shows`);
    }
}

// ---- the browse pages -----------------------------------------------------------------------------------------------------

const browseFacts = page => page.evaluate(selector => {
    const scope = document.querySelector(selector);
    const shown = node => !!node && !node.closest('.hide') && node.getBoundingClientRect().width > 0;
    const text = sel => scope.querySelector(sel)?.textContent?.trim() ?? '';
    const buttons = [...scope.querySelectorAll('.mainDetailButtons button')].filter(shown);
    const add = scope.querySelector('.jfmod-browseAdd');
    const star = scope.querySelector('.itemMiscInfo-primary .starIcon');
    const links = scope.querySelector('.itemExternalLinks');
    const overview = scope.querySelector('.overview');
    return {
        hash: location.hash,
        name: scope.querySelector('.nameContainer')?.innerText?.replace(/\s+/g, ' ').trim() ?? '',
        misc: scope.querySelector('.itemMiscInfo-primary')?.innerText?.replace(/\s+/g, ' ').trim() ?? '',
        star: shown(star),
        starColour: star && getComputedStyle(star).color,
        linksShown: shown(links) && links.textContent.trim().length > 0,
        tmdbWord: /\b(TMDB|TheMovieDb|IMDb)\b/.test(scope.querySelector('.detailPagePrimaryContainer')?.innerText ?? '') || /\b(TMDB|IMDb)\b/.test(text('.itemDetailsGroup')),
        buttons: buttons.map(button => button.textContent.trim()),
        addHeight: add ? Math.round(add.getBoundingClientRect().height) : 0,
        addBackground: add && getComputedStyle(add).backgroundColor,
        overview: shown(overview) ? overview.textContent.trim().length : 0,
        overviewColour: overview && getComputedStyle(overview).color,
        cast: shown(scope.querySelector('#castCollapsible')) ? scope.querySelectorAll('#castContent .jfmod-browseCell').length : -1,
        guests: shown(scope.querySelector('#guestCastCollapsible')) ? scope.querySelectorAll('#guestCastContent .jfmod-browseCell').length : -1,
        more: shown(scope.querySelector('.moreFromSeasonSection')) ? scope.querySelectorAll('.moreFromSeasonSection .jfmod-browseCell').length : -1,
        moreHeading: text('.moreFromSeasonSection .sectionTitle'),
        seasonsHeading: text('#listChildrenCollapsible .sectionTitle'),
        seasons: shown(scope.querySelector('#listChildrenCollapsible')) ? scope.querySelectorAll('#listChildrenCollapsible .jfmod-browseCell').length : -1,
        episodes: scope.querySelectorAll('#listChildrenCollapsible a.jfmod-browseEpisode').length,
        episodeStars: scope.querySelectorAll('#listChildrenCollapsible a.jfmod-browseEpisode .starIcon').length,
        // The template has one image container per layout; one of them shows.
        still: [...scope.querySelectorAll('.jfmod-episodeStill img')].some(shown),
        poster: [...scope.querySelectorAll('.jfmod-entryPoster img')].some(shown),
        details: text('.itemDetailsGroup'),
        scrollWidth: document.documentElement.scrollWidth,
        viewport: document.documentElement.clientWidth,
        backdrop: (() => {
            const node = scope.querySelector('#itemBackdrop');
            const style = getComputedStyle(node);
            const matching = [];
            for (const sheet of document.styleSheets) {
                let rules = [];
                try { rules = [...sheet.cssRules]; } catch { continue; }
                for (const rule of rules) if (rule.selectorText && /itemBackdrop/.test(rule.selectorText) && rule.style.marginTop && node.matches(rule.selectorText)) matching.push(`${rule.selectorText}{${rule.style.marginTop}}`);
            }
            return { top: Math.round(node.getBoundingClientRect().top + scrollY), margin: style.marginTop, scrollY: Math.round(scrollY), html: document.documentElement.className, body: document.body.className, matching: matching.join(' ') };
        })(),
        bodyText: scope.innerText
    };
}, PAGE);

const cellFacts = (page, row) => page.evaluate(([selector, rowSelector]) => {
    const cell = document.querySelector(`${selector} ${rowSelector} .jfmod-browseCell`);
    if (!cell) return null;
    const style = getComputedStyle(cell);
    const image = cell.querySelector('.jfmod-browseImage');
    const line1 = cell.querySelector('.jfmod-browseLine1');
    const line2 = cell.querySelector('.jfmod-browseLine2');
    const section = cell.closest('.verticalSection');
    const heading = section?.querySelector('.sectionTitle');
    const root = parseFloat(style.fontSize);
    return {
        padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map(value => parseFloat(value) / root),
        ratio: image.getBoundingClientRect().height / image.getBoundingClientRect().width,
        imageLeft: image.getBoundingClientRect().left,
        headingLeft: heading?.getBoundingClientRect().left,
        line1: line1 && { weight: getComputedStyle(line1).fontWeight, colour: getComputedStyle(line1).color, align: getComputedStyle(line1).textAlign },
        line2: line2 && { opacity: getComputedStyle(line2).opacity },
        direct: cell.parentElement.classList.contains('itemsContainer'),
        widths: [...new Set([...cell.parentElement.children].map(node => Math.round(node.getBoundingClientRect().width)))]
    };
}, [PAGE, row]);

/** The Add button, the rating and the absence of a links line are the same on all four pages (D210). */
function checkHeader(label, name, facts, theme, year) {
    record(label, `${name}: one action, Add to Library`, facts.buttons.length === 1 && facts.buttons[0] === 'Add to Library', facts.buttons.join(', ') || 'none');
    record(label, `${name}: the button is at least 40 px`, facts.addHeight >= 40, `${facts.addHeight}`);
    record(label, `${name}: the ★ in the meta line`, facts.star && /\d\.\d/.test(facts.misc), facts.misc);
    record(label, `${name}: the ★ in its colour`, facts.starColour === 'rgb(242, 176, 30)', facts.starColour);
    record(label, `${name}: the year in the meta line`, !year || facts.misc.includes(year), facts.misc);
    record(label, `${name}: no links line`, !facts.linksShown && !facts.tmdbWord, `links ${facts.linksShown}, word ${facts.tmdbWord}`);
    record(label, `${name}: the overview in the theme's ink`, facts.overview > 0 && inkFits(facts.overviewColour, theme), `${facts.overview} chars, ${facts.overviewColour}`);
}

/** A row of cells in the guide's values. */
async function checkCells(page, label, name, row, layoutName, theme, ratio) {
    const cell = await cellFacts(page, row);
    if (!cell) { record(label, `${name}: row ${row} has cells`, false); return; }
    const phone = layoutName === 'phone';
    const wantPadding = phone ? [0, 1, 1, 0] : [1, 1, 1, 1];
    record(label, `${name}: ${row} cell padding per the guide`, cell.padding.every((value, index) => near(value, wantPadding[index], 0.02)), cell.padding.map(value => value.toFixed(3)).join(' '));
    record(label, `${name}: ${row} image ratio`, near(cell.ratio, ratio, 0.02), cell.ratio.toFixed(3));
    record(label, `${name}: ${row} cells are direct children of the row, one width`, cell.direct && cell.widths.length === 1, `${cell.direct}; widths ${cell.widths.join(', ')}`);
    record(label, `${name}: ${row} first image under the heading`, cell.headingLeft === undefined || near(cell.imageLeft, cell.headingLeft, 3), `${Math.round(cell.imageLeft)} and ${Math.round(cell.headingLeft ?? 0)}`);
    record(label, `${name}: ${row} caption left-aligned, 700 in the theme's ink`, cell.line1.weight === '700' && inkFits(cell.line1.colour, theme) && /left|start/.test(cell.line1.align), JSON.stringify(cell.line1));
    record(label, `${name}: ${row} second line at 85.4 %`, !cell.line2 || cell.line2.opacity === '0.854', JSON.stringify(cell.line2));
}

/** Computer: › walks the row to its end. Phone: the row scrolls by touch's native scroll. TV: the arrows walk it with the ring. */
async function checkRowScroll(page, label, name, sectionSelector, layoutName) {
    const section = `${PAGE} ${sectionSelector}`;
    if (layoutName === 'computer') {
        const next = page.locator(`${section} .emby-scrollbuttons-button`).last();
        const prev = page.locator(`${section} .emby-scrollbuttons-button`).first();
        if (!await next.count() || !await next.isVisible()) { notVerified(label, `${name}: › walks the row`, 'the row fits, no buttons'); return; }
        const firstX = () => page.locator(`${section} .jfmod-browseCell`).first().evaluate(node => node.getBoundingClientRect().left);
        const start = await firstX();
        await next.scrollIntoViewIfNeeded();
        await next.click();
        await page.waitForTimeout(700);
        const moved = await firstX();
        record(label, `${name}: › scrolls the row`, moved < start - 50, `${Math.round(start)} → ${Math.round(moved)}`);
        for (let press = 0; press < 12 && !await next.isDisabled(); press++) {
            await next.click();
            await page.waitForTimeout(500);
        }
        const last = await page.locator(`${section} .jfmod-browseCell`).last().evaluate(node => Math.round(node.getBoundingClientRect().right));
        record(label, `${name}: › reaches the last cell`, last <= await page.evaluate(() => document.documentElement.clientWidth) + 40, `last cell right ${last}`);
        for (let press = 0; press < 12 && !await prev.isDisabled(); press++) {
            await prev.click();
            await page.waitForTimeout(400);
        }
        record(label, `${name}: ‹ returns to the first cell`, near(await firstX(), start, 4), `${Math.round(start)} and ${Math.round(await firstX())}`);
    } else if (layoutName === 'phone') {
        const scrolled = await page.evaluate(selector => {
            const frame = document.querySelector(selector + ' .emby-scroller') ?? document.querySelector(selector + ' .itemsContainer');
            frame.scrollLeft = 0;
            frame.scrollLeft = 240;
            const value = frame.scrollLeft;
            frame.scrollLeft = 0;
            return value;
        }, section);
        record(label, `${name}: the row scrolls sideways`, scrolled > 0, `${scrolled}`);
    }
}

async function reachCell(page, sectionSelector) {
    for (let press = 0; press < 14; press++) {
        if (await page.evaluate(selector => !!document.activeElement?.closest(selector), `${PAGE} ${sectionSelector}`)) return true;
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(300);
    }
    return false;
}

/** The TV: focus starts on Add; the arrows reach the row; the ring is inside the cell, not cut; right walks it in view. */
async function checkTvRow(page, label, name, sectionSelector) {
    const reached = await reachCell(page, `${sectionSelector} .jfmod-browseCell`);
    record(label, `${name}: arrows reach ${sectionSelector}`, reached, await page.evaluate(() => `${document.activeElement?.tagName}.${document.activeElement?.className}`));
    if (!reached) return;
    await page.waitForTimeout(400);
    const ring = await page.evaluate(() => {
        const cell = document.activeElement;
        const style = getComputedStyle(cell);
        const box = cell.getBoundingClientRect();
        const frame = cell.closest('.emby-scroller');
        const clip = frame && getComputedStyle(frame).overflowX === 'hidden' ? frame.getBoundingClientRect() : null;
        return { shadow: style.boxShadow, background: style.backgroundColor, left: box.left, right: box.right, top: box.top, bottom: box.bottom,
            clipLeft: clip?.left ?? null, clipTop: clip?.top ?? null, clipBottom: clip?.bottom ?? null, clipRight: clip?.right ?? null, innerHeight: window.innerHeight, innerWidth: window.innerWidth };
    });
    record(label, `${name}: ${sectionSelector} TV ring inside the lit cell`, /inset/.test(ring.shadow) && ring.background !== 'rgba(0, 0, 0, 0)', `${ring.shadow}; ${ring.background}`);
    record(label, `${name}: ${sectionSelector} ring not cut by the row`, ring.clipLeft === null || (ring.left >= ring.clipLeft - 0.5 && ring.top >= ring.clipTop - 0.5 && ring.bottom <= ring.clipBottom + 0.5), JSON.stringify(ring));
    record(label, `${name}: ${sectionSelector} focus in view`, ring.top >= 0 && ring.top < ring.innerHeight && ring.left >= 0 && ring.right <= ring.innerWidth + 1, JSON.stringify(ring));
    await shot(page, label, `${name}-focus`);
    const before = await page.evaluate(() => document.activeElement.getAttribute('aria-label'));
    let last = before;
    let inView = true;
    for (let press = 0; press < 7; press++) {
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(350);
        last = await page.evaluate(() => document.activeElement.getAttribute('aria-label'));
        inView = inView && await page.evaluate(() => {
            const box = document.activeElement.getBoundingClientRect();
            return box.left >= -1 && box.right <= window.innerWidth + 1;
        });
    }
    record(label, `${name}: ${sectionSelector} right walks the cells in view`, last !== before && inView, `${before} → ${last}`);
    await shot(page, label, `${name}-focus-walked`);
}

async function checkBrowsePages(page, label, layoutName, theme) {
    const layout = LAYOUTS[layoutName];
    const tv = !!layout.tv;
    const phone = layoutName === 'phone';
    const ready = `${PAGE} .jfmod-browseAdd`;

    // Movie.
    await open(page, browsePath('movie', MOVIE), ready, 1500);
    await shot(page, label, 'movie', phone);
    let facts = await browseFacts(page);
    record(label, 'movie: title', facts.name.includes('The Gentlemen'), facts.name);
    record(label, 'movie: poster', facts.poster);
    checkHeader(label, 'movie', facts, theme, '2020');
    record(label, 'movie: certification and runtime in the meta line', /\d+h|\d+m/.test(facts.misc) && /\bR\b/.test(facts.misc), facts.misc);
    record(label, 'movie: director, writers, genres', /Director/.test(facts.details) && /Writer/.test(facts.details) && /Genre/.test(facts.details), facts.details.slice(0, 120));
    record(label, 'movie: Cast & Crew, no seasons', facts.cast > 2 && facts.seasons === -1 && facts.episodes === 0, `cast ${facts.cast}, seasons ${facts.seasons}`);
    if (phone) record(label, 'movie: the backdrop starts at the top', facts.backdrop.top === 0, JSON.stringify(facts.backdrop));
    if (!layout.tv) record(label, 'movie: no sideways page on the phone', !phone || facts.scrollWidth <= facts.viewport, `${facts.scrollWidth}/${facts.viewport}`);
    else record(label, 'movie: no sideways page on the TV', facts.scrollWidth <= facts.viewport, `${facts.scrollWidth}/${facts.viewport}`);
    if (tv) record(label, 'movie: TV focus starts on Add', await page.evaluate(() => !!document.activeElement?.classList.contains('jfmod-browseAdd')), await page.evaluate(() => document.activeElement?.className));
    await checkCells(page, label, 'movie', '#castCollapsible', layoutName, theme, 1.5);
    if (tv) {
        await checkTvRow(page, label, 'movie', '#castCollapsible');
    } else {
        await checkRowScroll(page, label, 'movie', '#castCollapsible', layoutName);
        const cell = page.locator(`${PAGE} #castCollapsible .jfmod-browseCell`).first();
        await cell.scrollIntoViewIfNeeded();
        await cell.hover();
        await page.waitForTimeout(350);
        const lit = await cell.evaluate(node => [getComputedStyle(node).backgroundColor, getComputedStyle(document.body).backgroundColor]);
        if (phone) {
            record(label, 'movie: no hover panel on the phone', lit[0] === 'rgba(0, 0, 0, 0)', lit[0]);
        } else {
            record(label, 'movie: hover lights the cell in paper', lit[0] !== 'rgba(0, 0, 0, 0)' && lit[0] !== lit[1], `${lit[0]} on ${lit[1]}`);
            await shot(page, label, 'movie-hover');
        }
        await page.mouse.move(0, 0);
    }

    // Series.
    await open(page, browsePath('series', SERIES), ready, 1500);
    await shot(page, label, 'series', phone);
    facts = await browseFacts(page);
    record(label, 'series: title', facts.name.includes('The Gentlemen'), facts.name);
    checkHeader(label, 'series', facts, theme, '2024');
    record(label, 'series: first year only, no range', !/2024\s*[-–]/.test(facts.misc), facts.misc);
    record(label, 'series: created by', /Created By/.test(facts.details), facts.details.slice(0, 120));
    record(label, 'series: Seasons and Cast & Crew', facts.seasons >= 1 && facts.seasonsHeading === 'Seasons' && facts.cast > 2, `seasons ${facts.seasons} "${facts.seasonsHeading}", cast ${facts.cast}`);
    if (phone) record(label, 'series: the backdrop starts at the top', facts.backdrop.top === 0, JSON.stringify(facts.backdrop));
    if (phone || tv) record(label, 'series: no sideways page', facts.scrollWidth <= facts.viewport, `${facts.scrollWidth}/${facts.viewport}`);
    await checkCells(page, label, 'series', '#listChildrenCollapsible', layoutName, theme, 1.5);
    if (tv) {
        await checkTvRow(page, label, 'series', '#listChildrenCollapsible');
        await page.keyboard.press('ArrowLeft');
    }

    // Season, from the series' first cell, so one page's parts must leave with it.
    if (tv) {
        await open(page, browsePath('series', SERIES), ready, 1200);
        await reachCell(page, '#listChildrenCollapsible .jfmod-browseCell');
        await page.keyboard.press('Enter');
    } else {
        await page.locator(`${PAGE} #listChildrenCollapsible a.jfmod-browseCell`).first().click();
    }
    await page.waitForFunction(() => /[?&]season=1/.test(location.hash), undefined, { timeout: 20000 }).catch(() => {});
    await page.waitForSelector(`${PAGE} a.jfmod-browseEpisode`, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await shot(page, label, 'season', phone);
    facts = await browseFacts(page);
    record(label, 'season: opened from the series\' cell', /tmdbId=236235&season=1/.test(facts.hash), facts.hash);
    record(label, 'season: series name over the season\'s', /The Gentlemen.*Season 1/.test(facts.name), facts.name);
    checkHeader(label, 'season', facts, theme, '2024');
    record(label, 'season: episode count and certification', /8 episodes/.test(facts.misc) && /TV-MA/.test(facts.misc), facts.misc);
    record(label, 'season: the episode rows, each with its ★', facts.episodes === 8 && facts.episodeStars >= 7, `${facts.episodes} rows, ${facts.episodeStars} stars`);
    record(label, 'season: no explaining text (D210)', !/add the show|whole show|adds the|not in your library|add this/i.test(facts.bodyText), '');
    record(label, 'season: the series\' parts are gone', facts.cast === -1, `cast ${facts.cast}`);
    if (phone || tv) record(label, 'season: no sideways page', facts.scrollWidth <= facts.viewport, `${facts.scrollWidth}/${facts.viewport}`);

    // Episode, from the season's first row.
    if (tv) {
        const reached = await reachCell(page, 'a.jfmod-browseEpisode');
        record(label, 'season: arrows reach the episode rows', reached, await page.evaluate(() => document.activeElement?.className));
        await shot(page, label, 'season-focus');
        await page.keyboard.press('Enter');
    } else {
        await page.locator(`${PAGE} a.jfmod-browseEpisode`).first().click();
    }
    await page.waitForFunction(() => /[?&]episode=1/.test(location.hash), undefined, { timeout: 20000 }).catch(() => {});
    await page.waitForSelector(`${PAGE} .moreFromSeasonSection:not(.hide) .jfmod-browseCell`, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await shot(page, label, 'episode', phone);
    facts = await browseFacts(page);
    record(label, 'episode: opened from the season\'s row', /season=1&episode=1/.test(facts.hash), facts.hash);
    record(label, 'episode: series, season and episode in the name', /The Gentlemen.*Season 1.*1\. Refined Aggression/.test(facts.name), facts.name);
    record(label, 'episode: the 16:9 still', facts.still);
    checkHeader(label, 'episode', facts, theme, '2024');
    record(label, 'episode: runtime and certification', /\d+h|\d+m/.test(facts.misc) && /TV-MA/.test(facts.misc), facts.misc);
    record(label, 'episode: More from the season, Guest Stars, Cast & Crew', facts.more === 7 && /More from Season 1/.test(facts.moreHeading) && facts.guests > 0 && facts.cast > 0, `more ${facts.more} "${facts.moreHeading}", guests ${facts.guests}, cast ${facts.cast}`);
    if (phone || tv) record(label, 'episode: no sideways page', facts.scrollWidth <= facts.viewport, `${facts.scrollWidth}/${facts.viewport}`);
    await checkCells(page, label, 'episode', '.moreFromSeasonSection', layoutName, theme, 0.5625);
    await checkCells(page, label, 'episode', '#guestCastCollapsible', layoutName, theme, 1.5);
    if (tv) {
        await checkTvRow(page, label, 'episode', '.moreFromSeasonSection');
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !/episode=/.test(location.hash), undefined, { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(1000);
        record(label, 'episode: Back returns to the season', await page.evaluate(() => /season=1/.test(location.hash) && !/episode=/.test(location.hash)), await page.evaluate(() => location.hash));
    } else {
        await checkRowScroll(page, label, 'episode', '#guestCastCollapsible', layoutName);
        await checkRowScroll(page, label, 'episode-more', '.moreFromSeasonSection', layoutName);
        await page.locator(`${PAGE} .nameContainer h1 a`).click();
        await page.waitForFunction(() => !/season=/.test(location.hash), undefined, { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(1200);
        record(label, 'episode: the series name links the series', await page.evaluate(selector => !/season=/.test(location.hash) && document.querySelector(selector + ' #listChildrenCollapsible .jfmod-browseCell') !== null, PAGE), await page.evaluate(() => location.hash));
    }

    // A long series: every season cell can be reached (the row has no buttons; the wheel, touch and focus scroll it).
    await open(page, browsePath('series', LONG_SERIES), ready, 1500);
    const seasonsRow = `${PAGE} #listChildrenCollapsible .jfmod-browseRow`;
    if (tv) {
        await reachCell(page, '#listChildrenCollapsible .jfmod-browseCell');
        let inView = true;
        for (let press = 0; press < 10; press++) {
            await page.keyboard.press('ArrowRight');
            await page.waitForTimeout(250);
            inView = inView && await page.evaluate(() => {
                const box = document.activeElement.getBoundingClientRect();
                return box.left >= -1 && box.right <= window.innerWidth + 1;
            });
        }
        record(label, 'long series: right walks the seasons in view', inView && await page.evaluate(selector => document.querySelector(selector).scrollLeft > 0, seasonsRow), await page.evaluate(() => document.activeElement.getAttribute('aria-label')));
    } else if (phone) {
        record(label, 'long series: the row scrolls sideways', await page.evaluate(selector => { const row = document.querySelector(selector); row.scrollLeft = 300; return row.scrollLeft > 0; }, seasonsRow));
    } else {
        const row = page.locator(seasonsRow);
        await row.scrollIntoViewIfNeeded();
        await row.hover();
        await page.mouse.wheel(600, 0);
        await page.waitForTimeout(500);
        record(label, 'long series: the sideways wheel scrolls the row', await row.evaluate(node => node.scrollLeft > 0));
        await page.mouse.move(0, 0);
    }
    await shot(page, label, 'long-series');

    // TMDb cannot answer: a sentence, no endless spinner.
    await page.goto(base() + browsePath('movie', 999999999), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => /could not be read from TMDB/.test(document.querySelector('.mainAnimatedPage:not(.hide) .jfmod-entryDetailsRoot')?.textContent ?? ''), undefined, { timeout: 30000 }).then(() => record(label, 'an unknown title says so', true)).catch(() => record(label, 'an unknown title says so', false));
}

// ---- adding ---------------------------------------------------------------------------------------------------------------

const added = new Set();

async function checkAdd(page, label, kind, layoutName) {
    const title = ADDS[kind];
    const existing = await entryOf(page, title.type, title.id);
    if (existing) { notVerified(label, `add from the ${kind} page`, `${title.title} is already in the library`); return; }
    await open(page, browsePath(title.type, title.id, title.season, title.episode), `${PAGE} .jfmod-browseAdd`);
    const before = await page.evaluate(() => location.hash);
    if (LAYOUTS[layoutName].tv) {
        record(label, `add from the ${kind} page: focus on Add`, await page.evaluate(() => !!document.activeElement?.classList.contains('jfmod-browseAdd')));
        await page.keyboard.press('Enter');
    } else {
        await page.locator(`${PAGE} .jfmod-browseAdd`).click();
    }
    await page.waitForFunction(from => location.hash !== from && /details\?(entryId|id)=/.test(location.hash), before, { timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const entry = await entryOf(page, title.type, title.id);
    if (entry) added.add(entry.id);
    const facts = await page.evaluate(selector => ({ hash: location.hash, name: document.querySelector(selector + ' .nameContainer')?.innerText ?? '',
        add: !!document.querySelector(selector + ' .jfmod-browseAdd') }), PAGE);
    record(label, `add from the ${kind} page: the whole title joins the library`, !!entry && entry.mediaType === title.type && entry.tmdbId === title.id, entry ? `${entry.title} ${entry.id}` : 'no entry');
    record(label, `add from the ${kind} page: the title's own page opens`, /details\?(entryId|id)=/.test(facts.hash) && !facts.add && facts.name.includes(title.title), `${facts.hash} "${facts.name.replace(/\s+/g, ' ')}"`);
    if (LAYOUTS[layoutName].tv) {
        await page.keyboard.press('Escape');
    } else {
        await page.goBack();
    }
    await page.waitForTimeout(1500);
    record(label, `add from the ${kind} page: Back does not return to the Add`, await page.evaluate(from => location.hash !== from, before), await page.evaluate(() => location.hash));
    if (entry) {
        await apiDelete(page, `JellyfinMod/Entries/${entry.id}`);
        added.delete(entry.id);
        record(label, `add from the ${kind} page: removed again`, !await entryOf(page, title.type, title.id));
    }
}

async function checkAddFromCard(page, label) {
    const existing = await entryOf(page, 'movie', 329865);
    if (existing) { notVerified(label, 'the + on a card', `${SEARCH_ADD.title} is already in the library`); return; }
    await waitForSearch(page, SEARCH_ADD.query);
    const cell = page.locator(`.jfmod-searchCell[data-jfmod-key="${SEARCH_ADD.key}"]`);
    if (!await cell.count()) { record(label, 'the + on a card: the result is there', false); return; }
    const order = () => page.evaluate(() => [...document.querySelectorAll('.jfmod-searchCell')].map(node => node.dataset.jfmodKey).join());
    const before = await order();
    await cell.scrollIntoViewIfNeeded();
    await cell.hover();
    await page.waitForTimeout(300);
    await cell.locator('.jfmod-searchAdd').click();
    const hash = await page.evaluate(() => location.hash);
    await page.waitForSelector('.jfmod-searchUndo', { timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const entry = await entryOf(page, 'movie', 329865);
    if (entry) added.add(entry.id);
    const undoLine = await page.locator('.jfmod-searchUndo').textContent().catch(() => '');
    record(label, 'the + on a card: the entry is added without leaving the search', !!entry && await page.evaluate(from => location.hash === from, hash), entry?.id ?? 'no entry');
    record(label, 'the + on a card: the Undo line', /Added\s*Arrival/.test(undoLine ?? ''), undoLine);
    record(label, 'the + on a card: nothing moves', before === await order());
    await page.mouse.move(0, 0);
    await page.waitForTimeout(400);
    await shot(page, label, 'search-added');
    record(label, 'the + on a card: the card turns into the library card, cloud top right', await cell.evaluate(node => !!node.querySelector('.jfmod-searchPoster [class*="jfmod-mark"]') && !node.querySelector('.jfmod-searchAdd')));
    const undo = page.locator('.jfmod-searchUndo button');
    await undo.click();
    await page.waitForFunction(() => !document.querySelector('.jfmod-searchUndo'), undefined, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const gone = !await entryOf(page, 'movie', 329865);
    if (gone && entry) added.delete(entry.id);
    record(label, 'the + on a card: Undo removes it again', gone);
    record(label, 'the + on a card: the + is back after Undo', await cell.evaluate(node => !!node.querySelector('.jfmod-searchAdd')));
}

async function checkPaging(page, label) {
    await waitForSearch(page, 'love');
    const before = await searchFacts(page);
    const shown = before.cards.map(card => card.key);
    let scrolls = 0;
    let after = before;
    while (scrolls < 6 && after.count <= before.count) {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(3500);
        after = await searchFacts(page);
        scrolls += 1;
    }
    record(label, 'search paging: more results load by themselves', after.count > before.count, `${before.count} → ${after.count}`);
    record(label, 'search paging: nothing shown moves', shown.every((key, index) => after.cards[index]?.key === key));
    await page.evaluate(() => window.scrollTo(0, 0));
}

// ---- one layout and theme -------------------------------------------------------------------------------------------------

async function checkLayout(browser, layoutName, theme) {
    const layout = LAYOUTS[layoutName];
    const label = `${layoutName}/${theme}`;
    const context = await browser.newContext({ viewport: layout.viewport, isMobile: layout.isMobile, hasTouch: layout.hasTouch, userAgent: layout.userAgent, serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error.message).split('\n')[0]));
    try {
        await signIn(page);
        const userId = await page.evaluate(() => ApiClient.getCurrentUserId());
        await page.evaluate(([key, value, tv]) => {
            localStorage.setItem(key, value);
            if (tv) localStorage.setItem('layout', 'tv');
        }, [`${userId}-appTheme`, theme, !!layout.tv]);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } }, undefined, { timeout: 30000 });
        await page.waitForTimeout(2000);
        const set = await page.evaluate(() => [document.documentElement.getAttribute('data-theme'), document.documentElement.className]);
        const wantLayout = { computer: 'layout-desktop', phone: 'layout-mobile' }[layoutName] ?? 'layout-tv';
        record(label, 'the theme and the layout took', set[0] === theme && set[1].includes(wantLayout), set.join(' / '));
        const viewsBefore = (await apiJson(page, `Users/${userId}/Views`)).Items.map(view => view.Name).sort().join();
        await checkSearch(page, label, layoutName, theme).catch(error => record(label, 'search: ran to the end', false, error.message.split('\n')[0]));
        await checkBrowsePages(page, label, layoutName, theme).catch(error => record(label, 'browse pages: ran to the end', false, error.message.split('\n')[0]));
        if (ADD && theme === 'dark') {
            const kinds = { computer: ['movie', 'series', 'season', 'episode'], phone: ['movie'], tv1920: ['series'], tv1280: [] }[layoutName];
            for (const kind of kinds) await checkAdd(page, label, kind, layoutName).catch(error => record(label, `add from the ${kind} page: ran to the end`, false, error.message.split('\n')[0]));
            if (layoutName === 'computer') await checkAddFromCard(page, label).catch(error => record(label, 'the + on a card: ran to the end', false, error.message.split('\n')[0]));
        }
        if (TOKEN && layoutName === 'computer' && theme === 'dark') await checkPaging(page, label).catch(error => record(label, 'search paging: ran to the end', false, error.message.split('\n')[0]));
        for (const id of [...added]) {
            await apiDelete(page, `JellyfinMod/Entries/${id}`).catch(() => {});
            added.delete(id);
        }
        const viewsAfter = (await apiJson(page, `Users/${userId}/Views`)).Items.map(view => view.Name).sort().join();
        record(label, 'the libraries are as they were', viewsAfter === viewsBefore, viewsAfter);
        await page.evaluate(([key]) => { localStorage.removeItem(key); localStorage.removeItem('layout'); }, [`${userId}-appTheme`]);
    } catch (error) {
        record(label, 'the layout ran to the end', false, error.message.split('\n')[0]);
    } finally {
        record(label, 'no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
        await context.close();
    }
}

const browser = await chromium.launch(tier === 'chrome' ? { headless: true, channel: 'chrome' } : { headless: true });
console.log('browser', tier, browser.version());
try {
    for (const layoutName of (process.env.JELLYFINMOD_LAYOUTS ?? 'computer,phone,tv1920,tv1280').split(',').filter(Boolean)) {
        for (const theme of (process.env.JELLYFINMOD_THEMES ?? 'dark,light').split(',').filter(Boolean)) await checkLayout(browser, layoutName, theme);
    }
} finally {
    await browser.close();
}
const failed = results.filter(result => result.verdict === 'FAIL').length;
const open_ = results.filter(result => result.verdict === 'NOT VERIFIED').length;
const labels = [...new Set(results.map(result => result.label))];
for (const label of labels) {
    const own = results.filter(result => result.label === label);
    console.log(`${label}: ${own.filter(result => result.verdict === 'PASS').length}/${own.length} passed`);
}
console.log(`\n${results.length - failed - open_} passed, ${failed} failed, ${open_} not verified (${tier})`);
let exitCode = 0;
if (failed) exitCode = 1;
else if (open_) exitCode = 2;
process.exit(exitCode);
/* eslint-enable compat/compat, no-restricted-globals, sonarjs/cognitive-complexity, sonarjs/slow-regex, @stylistic/max-statements-per-line, no-empty-function */
