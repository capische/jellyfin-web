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
//   [JELLYFINMOD_TM2_ROWS=1]     only the browse pages and their rows: no search grid
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
const ROWS = process.env.JELLYFINMOD_TM2_ROWS === '1';
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
const ARTICLE_QUERY = 'the gentlemen';
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

async function signIn(page, user = 'oleksii') {
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
        const cells = [...document.querySelectorAll('.cell[data-jfmod-key]')];
        const rect = node => node.getBoundingClientRect();
        const first = cells[0];
        const firstTop = first ? Math.round(rect(first).top) : 0;
        const poster = first?.querySelector('.post');
        const title = first?.querySelector('.capt .t');
        const lines = first ? [...first.querySelectorAll('.capt .ln')] : [];
        const kind = document.querySelector('.capt .k');
        const cast = first?.querySelector('.capt .ln.d');
        const style = node => getComputedStyle(node);
        const root = parseFloat(style(first).fontSize);
        return {
            count: cells.length,
            perRow: cells.filter(cell => Math.round(rect(cell).top) === firstTop).length,
            gridRight: Math.round(rect(document.querySelector('.grid.searchgrid')).right),
            viewport: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth,
            padding: first && [style(first.querySelector('.tile')).paddingTop, style(first.querySelector('.tile')).paddingRight, style(first.querySelector('.tile')).paddingBottom, style(first.querySelector('.tile')).paddingLeft].map(value => parseFloat(value) / root),
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
            cards: cells.map(cell => ({ key: cell.dataset.jfmodKey, title: cell.querySelector('.capt .t')?.textContent ?? '',
                year: Number(cell.querySelectorAll('.capt .ln')[1]?.querySelector('span')?.textContent) || 0,
                series: !!cell.querySelector('.capt .k'), href: cell?.getAttribute('href') ?? '',
                cast: cell.querySelector('.capt .ln.d')?.textContent ?? '', mark: !!cell.querySelector('.post .mark') })),
            heading: [...document.querySelectorAll('.searchbody .rowt')].map(node => node.textContent),
            adds: document.querySelectorAll('[data-jfmod-add]').length
        };
    });
}

const waitForSearch = async (page, query = QUERY) => {
    await open(page, `#/search?query=${encodeURIComponent(query)}`, '.grid.searchgrid');
    await page.waitForFunction(() => document.querySelector('.grid.searchgrid')?.getAttribute('aria-busy') === 'false'
        && document.querySelectorAll('.cell[data-jfmod-key]').length > 0, undefined, { timeout: 45000 });
    await page.waitForTimeout(600);
};

/** A title as the grid compares it (CatalogSearchResults, `normalTitle`). */
const normalTitle = title => title.replace(/^(the|a|an)\s+/i, '').toLowerCase().replace(/[^0-9a-z\u00c0-\uffff]+/g, ' ').trim();

/**
 * D253 against what the plugin answers: full matches with 100 or more votes first, newest first; then the rest by votes. The cards of
 * TMDB's first pages only: a later page follows them. A library title takes its entry's votes; with none it keeps its old place.
 */
async function checkOrder(page, label, query, cards) {
    const votes = new Map();
    for (const type of ['movie', 'series']) {
        const answer = await apiJson(page, 'JellyfinMod/Discover/Search', { q: query, type });
        for (const item of answer.items) votes.set(`${type}:${item.tmdbId}`, item.voteCount ?? 0);
    }
    const counted = [...votes.values()].filter(count => count > 0).length;
    record(label, `search "${query}": TMDB's votes reach the page`, counted > votes.size / 2, `${counted} of ${votes.size} titles have votes`);
    const entries = await apiJson(page, 'JellyfinMod/Entries');
    const stored = new Map((entries.items ?? []).filter(entry => entry.metadata?.voteCount != null).map(entry => [`${entry.mediaType}:${entry.tmdbId}`, entry.metadata.voteCount]));
    const wanted = normalTitle(query);
    const firstBatch = cards.filter(card => !card.href.includes('tmdbType=') || votes.has(card.key));
    const rows = firstBatch.map(card => {
        const library = !card.href.includes('tmdbType=');
        const count = votes.get(card.key) ?? stored.get(card.key) ?? null;
        const unknown = library && count === null;
        const full = normalTitle(card.title) === wanted;
        return { ...card, count, unknown, leads: full && (unknown || (count ?? 0) >= 100) };
    });
    const leaders = rows.filter(row => row.leads);
    const rest = rows.filter(row => !row.leads);
    const order = [...leaders, ...rest];
    record(label, `search "${query}": the leaders come first`, order.every((row, index) => row.key === rows[index].key), rows.slice(0, 6).map(row => `${row.title} ${row.year} (${row.count ?? 'unknown'})`).join(', '));
    record(label, `search "${query}": the leaders newest first`, leaders.every((row, index) => index === 0 || leaders[index - 1].year >= row.year), leaders.map(row => `${row.title} ${row.year}`).join(', '));
    const unknowns = rest.findLastIndex(row => row.unknown);
    const ranked = rest.slice(unknowns + 1);
    record(label, `search "${query}": the rest by votes, most first`, rest.slice(0, unknowns + 1).every(row => row.unknown)
        && ranked.every((row, index) => index === 0 || (ranked[index - 1].count ?? 0) >= (row.count ?? 0)), ranked.slice(0, 8).map(row => `${row.title} (${row.count})`).join(', '));
}

async function checkSearch(page, label, layoutName, theme) {
    const layout = LAYOUTS[layoutName];
    const phone = layoutName === 'phone';
    await waitForSearch(page);
    await shot(page, label, 'search');
    const facts = await searchFacts(page);
    record(label, 'search: results in one grid', facts.count >= 5 && facts.heading.every(text => !/add from tmdb/i.test(text)), `${facts.count} cells; headings ${facts.heading.join(', ') || 'none'}`);
    record(label, 'search: cells per row', facts.perRow === (phone ? 2 : 5), `${facts.perRow}`);
    record(label, 'search: the grid fits the page', facts.gridRight <= facts.viewport + 1 && facts.scrollWidth <= facts.viewport, `grid right ${facts.gridRight}, page ${facts.scrollWidth}, viewport ${facts.viewport}`);
    const wantPadding = phone ? [0, 0.618, 1, 0] : [1, 1, 1, 1];
    record(label, 'search: cell padding per the guide', facts.padding.every((value, index) => near(value, wantPadding[index], 0.02)), facts.padding.map(value => value.toFixed(3)).join(' '));
    record(label, 'search: 2:3 poster with the card radius', near(facts.posterRatio, 1.5, 0.01) && near(facts.posterRadius, 0.618, 0.02), `${facts.posterRatio.toFixed(3)}, ${facts.posterRadius.toFixed(2)}em`);
    record(label, 'search: three-line caption at pitch φ', facts.lineCount === 3 && near(facts.linePitch, 1.618, 0.02), `${facts.lineCount} lines at ${facts.linePitch.toFixed(3)}em`);
    record(label, 'search: title 700 in the theme\'s ink', facts.titleWeight === '700' && inkFits(facts.titleColour, theme), `${facts.titleWeight} ${facts.titleColour}`);
    record(label, 'search: lead actors and TV Series at 85.4 %', facts.castOpacity === '0.854' && facts.kindOpacity === '0.854' && facts.kindText === 'TV Series', `${facts.castOpacity}, ${facts.kindOpacity}, ${facts.kindText}`);
    await checkOrder(page, label, QUERY, facts.cards);
    const lead = facts.cards.slice(0, 2).map(card => card.title).join(', ');
    record(label, 'search: the two The Gentlemen lead (D253)', lead === 'The Gentlemen, The Gentlemen', lead);
    record(label, 'search: the first ten as they appear', true, facts.cards.slice(0, 10).map(card => `${card.title} ${card.year}${card.series ? ' series' : ''}`).join('; '));
    await waitForSearch(page, ARTICLE_QUERY);
    const withArticle = await searchFacts(page);
    await checkOrder(page, label, ARTICLE_QUERY, withArticle.cards);
    record(label, 'search: a query with an article matches the same way', withArticle.cards.slice(0, 2).every(card => card.title === 'The Gentlemen'), withArticle.cards.slice(0, 3).map(card => `${card.title} ${card.year}`).join(', '));
    await waitForSearch(page);
    record(label, 'search: movies and shows together', facts.cards.some(card => card.series) && facts.cards.some(card => !card.series), `${facts.cards.filter(card => card.series).length} shows of ${facts.cards.length}`);
    const browseCard = facts.cards.find(card => card.href.includes('tmdbType='));
    record(label, 'search: a TMDb result links its browse page', !!browseCard, browseCard?.href ?? 'none');
    // The + is a library card's hover overlay: the computer's, never the phone's or the TV's (guide, Marks and the add disc).
    record(label, 'search: the + only where cards hover', layoutName === 'computer' ? facts.adds > 0 : facts.adds === 0, `${facts.adds} buttons`);

    // Hover: the computer lights the whole cell in paper, the phone does not.
    if (!layout.tv) {
        const key = browseCard?.key;
        const cell = page.locator(`.cell[data-jfmod-key="${key}"]`);
        await cell.scrollIntoViewIfNeeded();
        await cell.hover();
        await page.waitForTimeout(450);
        const lit = await cell.evaluate(node => {
            const overlay = node.querySelector('[data-jfmod-add]');
            const button = node.querySelector('[data-jfmod-add]');
            return { background: getComputedStyle(node).backgroundColor, ring: getComputedStyle(node.querySelector('.post')).boxShadow,
                overlay: overlay && getComputedStyle(overlay).opacity,
                button: button && (({ width, height }) => [Math.round(width), Math.round(height)])(button.getBoundingClientRect()) };
        });
        if (phone) {
            record(label, 'search: no hover panel on the phone', lit.background === 'rgba(0, 0, 0, 0)', lit.background);
        } else {
            record(label, 'search: hover rings the poster, no panel on the cell', lit.background === 'rgba(0, 0, 0, 0)' && /0px 0px 0px [\d.]+px/.test(lit.ring), `${lit.background}; ${lit.ring}`);
            record(label, 'search: hover shows the + as a poster button', lit.overlay === '1' && lit.button && lit.button[0] >= 40 && lit.button[1] >= 40, `overlay ${lit.overlay}, button ${lit.button}`);
            await shot(page, label, 'search-hover');
        }
        await page.mouse.move(0, 0);
    }

    // The end of the results (one page per kind through Jellyfin's own connection; a token pages further).
    if (!TOKEN) {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForSelector('.searchend', { timeout: 20000 }).catch(() => {});
        const end = await page.locator('.searchend').textContent().catch(() => null);
        record(label, 'search: the end says so', end === `No more results for “${QUERY}”`, end ?? 'no end line');
        await page.evaluate(() => window.scrollTo(0, 0));
    }

    if (layout.tv) {
        await page.locator(`${PAGE} #searchTextInput`).focus().catch(() => {});
        let reached = false;
        for (let press = 0; press < 10 && !reached; press++) {
            await page.keyboard.press('ArrowDown');
            await page.waitForTimeout(250);
            reached = await page.evaluate(() => !!document.activeElement?.closest('.cell[data-jfmod-key]'));
        }
        record(label, 'search: arrows reach the first card', reached, await page.evaluate(() => document.activeElement?.className ?? 'none'));
        if (reached) {
            const ring = await page.evaluate(() => {
                const cell = document.activeElement.closest('.cell[data-jfmod-key]');
                const style = getComputedStyle(cell);
                return { key: cell.dataset.jfmodKey, shadow: getComputedStyle(cell.querySelector('.post')).boxShadow, background: style.backgroundColor, root: parseFloat(style.fontSize) };
            });
            record(label, 'search: TV focus rings the poster, no panel on the cell', /0px 0px 0px [\d.]+px/.test(ring.shadow) && ring.background === 'rgba(0, 0, 0, 0)', `${ring.shadow}; ${ring.background}`);
            await shot(page, label, 'search-focus');
            await page.keyboard.press('ArrowRight');
            await page.waitForTimeout(350);
            const next = await page.evaluate(() => document.activeElement?.closest('.cell[data-jfmod-key]')?.dataset.jfmodKey);
            record(label, 'search: right moves to the next card', !!next && next !== ring.key, `${ring.key} → ${next}`);
            await page.keyboard.press('ArrowDown');
            await page.waitForTimeout(350);
            const below = await page.evaluate(() => {
                const cell = document.activeElement?.closest('.cell[data-jfmod-key]');
                const box = cell?.getBoundingClientRect();
                return cell && { key: cell.dataset.jfmodKey, top: box.top, bottom: box.bottom, height: window.innerHeight, href: document.activeElement.getAttribute('href') };
            });
            record(label, 'search: down moves a row, the focus in view', !!below && below.key !== next && below.top >= 0 && below.top < below.height, JSON.stringify(below));
            // A TMDb card opens its browse page with Enter; Back returns to the grid.
            const tmdbCard = facts.cards.find(card => card.key === below?.key && card.href.includes('tmdbType='));
            if (tmdbCard) {
                await page.keyboard.press('Enter');
                await page.waitForSelector(`${PAGE} .jfds .actbar .play`, { timeout: 30000 }).catch(() => {});
                record(label, 'search: Enter opens the browse page', await page.evaluate(() => location.hash.includes('tmdbType=')), await page.evaluate(() => location.hash));
                await page.waitForTimeout(800);
                await page.keyboard.press('Escape');
                await page.waitForSelector('.grid.searchgrid', { timeout: 20000 }).catch(() => {});
                await page.waitForTimeout(800);
                record(label, 'search: Back returns to the grid', await page.evaluate(() => location.hash.startsWith('#/search') && document.querySelectorAll('.cell[data-jfmod-key]').length > 0), await page.evaluate(() => location.hash));
            } else {
                notVerified(label, 'search: Enter opens the browse page', 'the focused card is a library title');
            }
        }
    } else {
        await page.locator(`.cell[data-jfmod-key="${browseCard?.key}"]`).click();
        await page.waitForSelector(`${PAGE} .jfds .actbar .play`, { timeout: 30000 }).catch(() => {});
        record(label, 'search: clicking a TMDb card opens its browse page', await page.evaluate(() => location.hash.includes('tmdbType=')), await page.evaluate(() => location.hash));
        await page.goBack();
        await page.waitForSelector('.grid.searchgrid', { timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(600);
        record(label, 'search: Back returns to the grid', await page.evaluate(() => location.hash.startsWith('#/search') && document.querySelectorAll('.cell[data-jfmod-key]').length > 0), await page.evaluate(() => location.hash));
    }

    // A library title with a file: its own page, no mark.
    const items = await apiJson(page, `Users/${await page.evaluate(() => ApiClient.getCurrentUserId())}/Items`, { IncludeItemTypes: 'Movie,Series', Recursive: true, Limit: 50, IsPlaceHolder: false, Filters: 'IsNotFolder' });
    const owned = items.Items.find(item => item.Type === 'Movie' && item.LocationType === 'FileSystem' && (item.Name ?? '').length > 1);
    if (owned) {
        await waitForSearch(page, owned.Name);
        const row = await page.evaluate(id => {
            const link = [...document.querySelectorAll('a.cell[data-jfmod-key]')].find(node => node.getAttribute('href').includes(id));
            const cell = link?.closest('.cell[data-jfmod-key]');
            return cell && { mark: !!cell.querySelector('.post .mark'), index: [...document.querySelectorAll('.cell[data-jfmod-key]')].indexOf(cell) };
        }, owned.Id);
        record(label, 'search: a library title with a file links its own page, no mark', !!row && !row.mark, `${owned.Name}: ${JSON.stringify(row)}`);
    } else {
        notVerified(label, 'search: a library title with a file links its own page, no mark', 'no movie with a file in this environment');
    }

    // D201: opened from a library it still returns both kinds.
    const views = await apiJson(page, `Users/${await page.evaluate(() => ApiClient.getCurrentUserId())}/Views`);
    const movies = views.Items.find(view => view.CollectionType === 'movies');
    if (movies) {
        await open(page, `#/search?parentId=${movies.Id}&query=${QUERY}`, '.grid.searchgrid');
        await page.waitForFunction(() => document.querySelector('.grid.searchgrid')?.getAttribute('aria-busy') === 'false' && document.querySelectorAll('.cell[data-jfmod-key]').length > 0, undefined, { timeout: 45000 });
        const scoped = await searchFacts(page);
        record(label, 'search: opened from Movies it still finds shows (D201)', scoped.cards.some(card => card.series), `${scoped.cards.filter(card => card.series).length} shows`);
    }
}

// ---- the browse pages -----------------------------------------------------------------------------------------------------

const browseFacts = page => page.evaluate(selector => {
    const scope = document.querySelector(selector);
    const shown = node => !!node && !node.closest('.hide') && node.getBoundingClientRect().width > 0;
    const text = sel => scope.querySelector(sel)?.textContent?.trim() ?? '';
    const buttons = [...scope.querySelectorAll('.jfds .dhead .actbar button, .jfds .ground > .actbar button')].filter(shown);
    const add = scope.querySelector('.jfds .actbar .play');
    const star = scope.querySelector('.jfds .meta .star svg');
    const links = scope.querySelector('.itemExternalLinks');
    const overview = scope.querySelector('.jfds .overview');
    return {
        hash: location.hash,
        name: [scope.querySelector('.jfds .by')?.textContent, scope.querySelector('.jfds .itemName')?.textContent].filter(Boolean).join(' '),
        misc: scope.querySelector('.jfds .meta')?.innerText?.replace(/\s+/g, ' ').trim() ?? '',
        star: shown(star),
        starColour: star && getComputedStyle(star).color,
        linksShown: shown(links) && links.textContent.trim().length > 0,
        tmdbWord: /\b(TMDB|TheMovieDb|IMDb)\b/.test(scope.querySelector('.jfds .dhead')?.innerText ?? '') || /\b(TMDB|IMDb)\b/.test(text('.jfds .overview')),
        buttons: buttons.map(button => button.textContent.trim()),
        addHeight: add ? Math.round(add.getBoundingClientRect().height) : 0,
        addBackground: add && getComputedStyle(add).backgroundColor,
        overview: shown(overview) ? overview.textContent.trim().length : 0,
        overviewColour: overview && getComputedStyle(overview).color,
        cast: shown(scope.querySelector('[data-ds-section=cast]')) ? scope.querySelectorAll('[data-ds-section=cast] .rowx .cell').length : -1,
        guests: shown(scope.querySelector('[data-ds-section=guests]')) ? scope.querySelectorAll('[data-ds-section=guests] .rowx .cell').length : -1,
        more: shown(scope.querySelector('[data-ds-section=more]')) ? scope.querySelectorAll('[data-ds-section=more] .cell').length : -1,
        moreHeading: text('[data-ds-section=more] .rowt'),
        seasonsHeading: text('[data-ds-section=children] .rowt'),
        seasons: shown(scope.querySelector('[data-ds-section=children]')) ? scope.querySelectorAll('[data-ds-section=children] .cell').length : -1,
        episodes: scope.querySelectorAll('[data-ds-section=children] a.ep').length,
        episodeStars: scope.querySelectorAll('[data-ds-section=children] a.ep .star svg').length,
        // The template has one image container per layout; one of them shows.
        still: [...scope.querySelectorAll('.poster.wide img')].some(shown),
        poster: [...scope.querySelectorAll('.poster img')].some(shown),
        by: text('.jfds .by'),
        details: text('.jfds .overview'),
        scrollWidth: document.documentElement.scrollWidth,
        viewport: document.documentElement.clientWidth,
        backdrop: (() => {
            const node = scope.querySelector('.jfds .ground');
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
    const cell = document.querySelector(`${selector} ${rowSelector} .cell`);
    if (!cell) return null;
    const style = getComputedStyle(cell.querySelector('.tile'));
    const image = cell.querySelector('.post');
    const line1 = cell.querySelector('.capt .t');
    const line2 = cell.querySelector('.capt .ln.d');
    const section = cell.closest('.sect');
    const heading = section?.querySelector('.rowt');
    const root = parseFloat(style.fontSize);
    return {
        padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map(value => parseFloat(value) / root),
        ratio: image.getBoundingClientRect().height / image.getBoundingClientRect().width,
        imageLeft: image.getBoundingClientRect().left,
        headingLeft: heading?.getBoundingClientRect().left,
        line1: line1 && { weight: getComputedStyle(line1).fontWeight, colour: getComputedStyle(line1).color, align: getComputedStyle(line1).textAlign },
        line2: line2 && { opacity: getComputedStyle(line2).opacity },
        direct: cell.parentElement.classList.contains('rowx'),
        widths: [...new Set([...cell.parentElement.querySelectorAll(':scope > .cell')].map(node => Math.round(node.getBoundingClientRect().width)))]
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
    const wantPadding = phone ? [0, 0.618, 1, 0] : [1, 1, 1, 1];
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
        const next = page.locator(`${section} .emby-scrollbuttons .dbtn`).last();
        const prev = page.locator(`${section} .emby-scrollbuttons .dbtn`).first();
        if (!await next.count() || !await next.isVisible()) { notVerified(label, `${name}: › walks the row`, 'the row fits, no buttons'); return; }
        const firstX = () => page.locator(`${section} .cell`).first().evaluate(node => node.getBoundingClientRect().left);
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
        const last = await page.locator(`${section} .cell`).last().evaluate(node => Math.round(node.getBoundingClientRect().right));
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

/** Computer: the Seasons row's › reaches the last season and ‹ returns; the row stays beside the poster, never over it (D252). */
async function checkLongSeriesArrows(page, label, section, lastSeason) {
    const next = page.locator(`${section} .emby-scrollbuttons .dbtn[data-tip="Next"]`);
    const prev = page.locator(`${section} .emby-scrollbuttons .dbtn[data-tip="Previous"]`);
    record(label, 'long series: the arrows are on the Seasons row', await next.isVisible() && await prev.isVisible());
    await next.scrollIntoViewIfNeeded();
    const place = await page.evaluate(selector => {
        const arrows = document.querySelector(selector + ' .emby-scrollbuttons').getBoundingClientRect();
        const title = document.querySelector(selector + ' .rowt').getBoundingClientRect();
        const castArrows = document.querySelector('.mainAnimatedPage:not(.hide) [data-ds-section=cast] .emby-scrollbuttons');
        return { sameLine: arrows.top < title.bottom && arrows.bottom > title.top, arrowsClass: document.querySelector(selector + ' .emby-scrollbuttons').className, castClass: castArrows?.className,
            buttonWidth: document.querySelector(selector + ' .emby-scrollbuttons .dbtn').getBoundingClientRect().width,
            castWidth: castArrows?.querySelector('.emby-scrollbuttons .dbtn').getBoundingClientRect().width };
    }, section);
    record(label, 'long series: the arrows sit on the heading\'s line, as the other rows\'', place.sameLine && (place.castClass === undefined || (place.arrowsClass === place.castClass && place.buttonWidth === place.castWidth)), JSON.stringify(place));
    const firstLeft = () => page.locator(`${section} .cell`).first().evaluate(node => node.getBoundingClientRect().left);
    const start = await firstLeft();
    await next.click();
    await page.waitForTimeout(700);
    record(label, 'long series: › scrolls the row', await firstLeft() < start - 50, `${Math.round(start)} → ${Math.round(await firstLeft())}`);
    await shot(page, label, 'long-series-scrolled');
    const beside = await page.evaluate(selector => {
        const frame = document.querySelector(selector + ' .emby-scroller');
        const poster = [...document.querySelectorAll('.mainAnimatedPage:not(.hide) .poster')].find(node => node.getBoundingClientRect().width > 0)?.getBoundingClientRect();
        return { overflow: getComputedStyle(frame).overflowX, frameLeft: frame.getBoundingClientRect().left, posterRight: poster?.right, posterBottom: poster?.bottom, frameTop: frame.getBoundingClientRect().top };
    }, section);
    record(label, 'long series: a scrolled row never covers the poster', beside.frameTop >= beside.posterBottom || (['hidden', 'auto'].includes(beside.overflow) && beside.frameLeft >= beside.posterRight), JSON.stringify(beside));
    let presses = 0;
    for (; presses < 40 && !await next.isDisabled(); presses++) {
        await next.click();
        await page.waitForTimeout(450);
    }
    const end = await page.evaluate(selector => {
        const frame = document.querySelector(selector + ' .emby-scroller').getBoundingClientRect();
        const cells = [...document.querySelectorAll(selector + ' .cell')];
        const last = cells.at(-1).getBoundingClientRect();
        return { name: cells.at(-1).querySelector('.capt .t').textContent, right: last.right, left: last.left, frameRight: frame.right, viewport: document.documentElement.clientWidth };
    }, section);
    record(label, '› reaches the last season', await next.isDisabled() && end.name === lastSeason && end.left >= 0 && end.right <= end.frameRight + 1 && end.right <= end.viewport + 1, `${presses} presses; ${JSON.stringify(end)}; expected ${lastSeason}`);
    await shot(page, label, 'long-series-end');
    for (let press = 0; press < 40 && !await prev.isDisabled(); press++) {
        await prev.click();
        await page.waitForTimeout(350);
    }
    record(label, 'long series: ‹ returns to the first season', near(await firstLeft(), start, 4), `${Math.round(start)} and ${Math.round(await firstLeft())}`);
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
    const reached = await reachCell(page, `${sectionSelector} .cell`);
    record(label, `${name}: arrows reach ${sectionSelector}`, reached, await page.evaluate(() => `${document.activeElement?.tagName}.${document.activeElement?.className}`));
    if (!reached) return;
    await page.waitForTimeout(400);
    const ring = await page.evaluate(() => {
        const cell = document.activeElement;
        const style = getComputedStyle(cell);
        const box = cell.getBoundingClientRect();
        const frame = cell.closest('.emby-scroller');
        const clip = frame && getComputedStyle(frame).overflowX === 'hidden' ? frame.getBoundingClientRect() : null;
        return { shadow: getComputedStyle(cell.querySelector('.post') ?? cell).boxShadow, background: style.backgroundColor, left: box.left, right: box.right, top: box.top, bottom: box.bottom,
            clipLeft: clip?.left ?? null, clipTop: clip?.top ?? null, clipBottom: clip?.bottom ?? null, clipRight: clip?.right ?? null, innerHeight: window.innerHeight, innerWidth: window.innerWidth };
    });
    record(label, `${name}: ${sectionSelector} TV ring on the image, no panel`, /0px 0px 0px [\d.]+px/.test(ring.shadow) && ring.background === 'rgba(0, 0, 0, 0)', `${ring.shadow}; ${ring.background}`);
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
    const ready = `${PAGE} .jfds .actbar .play`;

    // Movie.
    await open(page, browsePath('movie', MOVIE), ready, 1500);
    await shot(page, label, 'movie', phone);
    let facts = await browseFacts(page);
    record(label, 'movie: title', facts.name.includes('The Gentlemen'), facts.name);
    record(label, 'movie: poster', facts.poster);
    checkHeader(label, 'movie', facts, theme, '2020');
    record(label, 'movie: certification and runtime in the meta line', /\d+h|\d+m/.test(facts.misc) && /\bR\b/.test(facts.misc), facts.misc);
    record(label, 'movie: director, writers, genres', /Directed by/.test(facts.by) && /Writer/.test(facts.details) && /Genre/.test(facts.details), `${facts.by}; ${facts.details.slice(-120)}`);
    record(label, 'movie: Cast & Crew, no seasons', facts.cast > 2 && facts.seasons === -1 && facts.episodes === 0, `cast ${facts.cast}, seasons ${facts.seasons}`);
    record(label, 'movie: the backdrop starts at the top', facts.backdrop.top === 0, JSON.stringify(facts.backdrop));
    if (!layout.tv) record(label, 'movie: no sideways page on the phone', !phone || facts.scrollWidth <= facts.viewport, `${facts.scrollWidth}/${facts.viewport}`);
    else record(label, 'movie: no sideways page on the TV', facts.scrollWidth <= facts.viewport, `${facts.scrollWidth}/${facts.viewport}`);
    if (tv) record(label, 'movie: TV focus starts on Add', await page.evaluate(() => !!document.activeElement?.matches('.jfds .actbar .play')), await page.evaluate(() => document.activeElement?.className));
    await checkCells(page, label, 'movie', '[data-ds-section=cast]', layoutName, theme, 1.5);
    if (tv) {
        await checkTvRow(page, label, 'movie', '[data-ds-section=cast]');
    } else {
        await checkRowScroll(page, label, 'movie', '[data-ds-section=cast]', layoutName);
        const cell = page.locator(`${PAGE} [data-ds-section=cast] .cell`).first();
        await cell.scrollIntoViewIfNeeded();
        await cell.hover();
        await page.waitForTimeout(350);
        const lit = await cell.evaluate(node => [getComputedStyle(node).backgroundColor, getComputedStyle(node.querySelector('.post')).boxShadow]);
        if (phone) {
            record(label, 'movie: no hover panel on the phone', lit[0] === 'rgba(0, 0, 0, 0)', lit[0]);
        } else {
            record(label, 'movie: hover rings the image, no panel', lit[0] === 'rgba(0, 0, 0, 0)' && /0px 0px 0px [\d.]+px/.test(lit[1]), `${lit[0]}; ${lit[1]}`);
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
    record(label, 'series: created by', /Created by/.test(facts.by), facts.by);
    record(label, 'series: Seasons and Cast & Crew', facts.seasons >= 1 && facts.seasonsHeading === 'Seasons' && facts.cast > 2, `seasons ${facts.seasons} "${facts.seasonsHeading}", cast ${facts.cast}`);
    record(label, 'series: the backdrop starts at the top', facts.backdrop.top === 0, JSON.stringify(facts.backdrop));
    if (phone || tv) record(label, 'series: no sideways page', facts.scrollWidth <= facts.viewport, `${facts.scrollWidth}/${facts.viewport}`);
    await checkCells(page, label, 'series', '[data-ds-section=children]', layoutName, theme, 1.5);
    record(label, 'series: no arrows where the Seasons row fits, as the other rows', await page.locator(`${PAGE} [data-ds-section=children] .emby-scrollbuttons .dbtn:visible`).count() === 0);
    if (phone || tv) record(label, 'series: no arrows on any row here', await page.locator(`${PAGE} .emby-scrollbuttons .dbtn:visible`).count() === 0);
    if (tv) {
        await checkTvRow(page, label, 'series', '[data-ds-section=children]');
        await page.keyboard.press('ArrowLeft');
    }

    // Season, from the series' first cell, so one page's parts must leave with it.
    if (tv) {
        await open(page, browsePath('series', SERIES), ready, 1200);
        await reachCell(page, '[data-ds-section=children] .cell');
        // Down lands on the cell under Add; Left walks to the series' first cell.
        for (let press = 0; press < 6; press++) {
            if (await page.evaluate(selector => document.activeElement === document.querySelector(selector), `${PAGE} [data-ds-section=children] .cell`)) break;
            await page.keyboard.press('ArrowLeft');
            await page.waitForTimeout(300);
        }
        await page.keyboard.press('Enter');
    } else {
        await page.locator(`${PAGE} [data-ds-section=children] a.cell`).first().click();
    }
    await page.waitForFunction(() => /[?&]season=1/.test(location.hash), undefined, { timeout: 20000 }).catch(() => {});
    await page.waitForSelector(`${PAGE} a.ep`, { timeout: 30000 }).catch(() => {});
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
        const reached = await reachCell(page, 'a.ep');
        record(label, 'season: arrows reach the episode rows', reached, await page.evaluate(() => document.activeElement?.className));
        await shot(page, label, 'season-focus');
        await page.keyboard.press('Enter');
    } else {
        await page.locator(`${PAGE} a.ep`).first().click();
    }
    await page.waitForFunction(() => /[?&]episode=1/.test(location.hash), undefined, { timeout: 20000 }).catch(() => {});
    await page.waitForSelector(`${PAGE} [data-ds-section=more]:not(.hide) .cell`, { timeout: 30000 }).catch(() => {});
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
    await checkCells(page, label, 'episode', '[data-ds-section=more]', layoutName, theme, 0.5625);
    await checkCells(page, label, 'episode', '[data-ds-section=guests]', layoutName, theme, 1.5);
    if (tv) {
        await checkTvRow(page, label, 'episode', '[data-ds-section=more]');
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !/episode=/.test(location.hash), undefined, { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(1000);
        record(label, 'episode: Back returns to the season', await page.evaluate(() => /season=1/.test(location.hash) && !/episode=/.test(location.hash)), await page.evaluate(() => location.hash));
    } else {
        await checkRowScroll(page, label, 'episode', '[data-ds-section=guests]', layoutName);
        await checkRowScroll(page, label, 'episode-more', '[data-ds-section=more]', layoutName);
        await page.locator(`${PAGE} .jfds .by a`).first().click();
        await page.waitForFunction(() => !/season=/.test(location.hash), undefined, { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(1200);
        record(label, 'episode: the series name links the series', await page.evaluate(selector => !/season=/.test(location.hash) && document.querySelector(selector + ' [data-ds-section=children] .cell') !== null, PAGE), await page.evaluate(() => location.hash));
    }

    // A long series: every season can be reached. The arrows on a computer, as the other rows (D252); focus on the TV; touch on the phone.
    await open(page, browsePath('series', LONG_SERIES), ready, 1500);
    const seasonsSection = `${PAGE} [data-ds-section=children]`;
    const seasonNames = (await apiJson(page, 'JellyfinMod/Discover/Title', { type: 'series', tmdbId: LONG_SERIES })).metadata.seasons.filter(item => item.number > 0);
    const lastSeason = seasonNames.at(-1).name;
    record(label, 'long series: every season has a cell', await page.locator(`${seasonsSection} .cell`).count() === seasonNames.length, `${seasonNames.length} seasons`);
    const shownArrows = () => page.locator(`${seasonsSection} .emby-scrollbuttons .dbtn:visible`).count();
    if (tv) {
        record(label, 'long series: no arrows on the TV', await shownArrows() === 0);
        await reachCell(page, '[data-ds-section=children] .cell');
        const firstLeft = () => page.locator(`${seasonsSection} .cell`).first().evaluate(node => node.getBoundingClientRect().left);
        const start = await firstLeft();
        let inView = true;
        for (let press = 0; press < 10; press++) {
            await page.keyboard.press('ArrowRight');
            await page.waitForTimeout(250);
            inView = inView && await page.evaluate(() => {
                const box = document.activeElement.getBoundingClientRect();
                return box.left >= -1 && box.right <= window.innerWidth + 1;
            });
        }
        await page.waitForTimeout(400);
        record(label, 'long series: right walks the seasons in view', inView && await firstLeft() < start - 50, await page.evaluate(() => document.activeElement.getAttribute('aria-label')));
    } else if (phone) {
        record(label, 'long series: no arrows on the phone', await shownArrows() === 0);
        record(label, 'long series: the row scrolls sideways', await page.evaluate(selector => {
            const frame = document.querySelector(selector + ' .emby-scroller');
            frame.scrollLeft = 300;
            return frame.scrollLeft > 0;
        }, seasonsSection));
    } else {
        await checkLongSeriesArrows(page, label, seasonsSection, lastSeason);
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
    await open(page, browsePath(title.type, title.id, title.season, title.episode), `${PAGE} .jfds .actbar .play`);
    const before = await page.evaluate(() => location.hash);
    if (LAYOUTS[layoutName].tv) {
        record(label, `add from the ${kind} page: focus on Add`, await page.evaluate(() => !!document.activeElement?.matches('.jfds .actbar .play')));
        await page.keyboard.press('Enter');
    } else {
        await page.locator(`${PAGE} .jfds .actbar .play`).click();
    }
    await page.waitForFunction(from => location.hash !== from && /details\?(entryId|id)=/.test(location.hash), before, { timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const entry = await entryOf(page, title.type, title.id);
    if (entry) added.add(entry.id);
    const facts = await page.evaluate(selector => ({ hash: location.hash, name: document.querySelector(selector + ' .nameContainer')?.innerText ?? '',
        add: !!document.querySelector(selector + ' .jfds .actbar .play') }), PAGE);
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
    const cell = page.locator(`.cell[data-jfmod-key="${SEARCH_ADD.key}"]`);
    if (!await cell.count()) { record(label, 'the + on a card: the result is there', false); return; }
    const order = () => page.evaluate(() => [...document.querySelectorAll('.cell[data-jfmod-key]')].map(node => node.dataset.jfmodKey).join());
    const before = await order();
    await cell.scrollIntoViewIfNeeded();
    await cell.hover();
    await page.waitForTimeout(300);
    await cell.locator('[data-jfmod-add]').click();
    const hash = await page.evaluate(() => location.hash);
    await page.waitForSelector('[data-ds-notice=undo]', { timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const entry = await entryOf(page, 'movie', 329865);
    if (entry) added.add(entry.id);
    const undoLine = await page.locator('[data-ds-notice=undo]').textContent().catch(() => '');
    record(label, 'the + on a card: the entry is added without leaving the search', !!entry && await page.evaluate(from => location.hash === from, hash), entry?.id ?? 'no entry');
    record(label, 'the + on a card: the Undo line', /Added\s*Arrival/.test(undoLine ?? ''), undoLine);
    record(label, 'the + on a card: nothing moves', before === await order());
    await page.mouse.move(0, 0);
    await page.waitForTimeout(400);
    await shot(page, label, 'search-added');
    record(label, 'the + on a card: the card turns into the library card, cloud top right', await cell.evaluate(node => !!node.querySelector('.post .mark') && !node.querySelector('[data-jfmod-add]')));
    const undo = page.locator('[data-ds-notice=undo] button');
    await undo.click();
    await page.waitForFunction(() => !document.querySelector('[data-ds-notice=undo]'), undefined, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const gone = !await entryOf(page, 'movie', 329865);
    if (gone && entry) added.delete(entry.id);
    record(label, 'the + on a card: Undo removes it again', gone);
    record(label, 'the + on a card: the + is back after Undo', await cell.evaluate(node => !!node.querySelector('[data-jfmod-add]')));
}

/**
 * Back while an Add runs, with its answer landing where a guard cleared on unmount would miss it: after the page's viewbeforehide and
 * before the unmount that hide defers with setTimeout (renderComponent). The answer is held and that timer widened to land there every
 * time. The catalog still gets the title, and the page stays where the viewer went (tm2.r1).
 */
async function checkBackDuringAdd(page, label) {
    if (await entryOf(page, 'series', LONG_SERIES)) { notVerified(label, 'Back during an Add', 'The Simpsons is already in the library'); return; }
    await page.goto(base() + '#/home', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.goto(base() + browsePath('series', LONG_SERIES), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(`${PAGE} .jfds .actbar .play`, { timeout: 30000 });
    await page.waitForTimeout(800);
    await page.evaluate(() => {
        const realTimeout = window.setTimeout;
        const window_ = { hiding: false, hidden: false, unmountsWaiting: 0, hashChangedAt: 0, hiddenAt: 0 };
        window.__backDuringAdd = window_;
        window.addEventListener('hashchange', () => { window_.hashChangedAt ||= performance.now(); }, { once: true });
        document.addEventListener('viewbeforehide', () => {
            window_.hiding = true;
            window_.hidden = true;
            window_.hiddenAt ||= performance.now();
            realTimeout(() => { window_.hiding = false; }, 0);
        }, { capture: true });
        window.setTimeout = (callback, delay, ...args) => {
            if (!window_.hiding || delay) return realTimeout(callback, delay, ...args);
            window_.unmountsWaiting += 1;
            return realTimeout(() => { window_.unmountsWaiting -= 1; callback(...args); }, 8000);
        };
    });
    let reached;
    const atServer = new Promise(resolve => { reached = resolve; });
    let release;
    const released = new Promise(resolve => { release = resolve; });
    const entriesPost = '**/JellyfinMod/Entries';
    const hold = async route => {
        if (route.request().method() !== 'POST') { await route.fallback(); return; }
        const answer = await route.fetch();
        reached();
        await released;
        await route.fulfill({ response: answer });
    };
    await page.route(entriesPost, hold);
    await page.locator(`${PAGE} .jfds .actbar .play`).click();
    await Promise.race([atServer, page.waitForTimeout(90000)]);
    const entry = await entryOf(page, 'series', LONG_SERIES);
    if (entry) added.add(entry.id);
    await page.goBack();
    await page.waitForFunction(() => location.hash.startsWith('#/home') && window.__backDuringAdd.hidden, undefined, { timeout: 15000 });
    const before = await page.evaluate(() => ({ ...window.__backDuringAdd }));
    const answered = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/JellyfinMod/Entries'), { timeout: 15000 });
    release();
    await answered;
    await page.waitForTimeout(1500);
    const after = await page.evaluate(() => ({ ...window.__backDuringAdd }));
    await page.unroute(entriesPost, hold);
    console.log(`note: viewbeforehide came ${Math.round(before.hiddenAt - before.hashChangedAt)} ms after Back changed the address`);
    record(label, 'Back during an Add: the answer landed after hide and before the unmount', before.unmountsWaiting > 0 && after.unmountsWaiting > 0, `${before.unmountsWaiting} then ${after.unmountsWaiting} unmounts waiting`);
    await page.waitForTimeout(8000);
    const hash = await page.evaluate(() => location.hash);
    record(label, 'Back during an Add: the title still joins the library', !!entry, entry?.id ?? 'no entry');
    record(label, 'Back during an Add: the page stays where the viewer went', hash.startsWith('#/home'), hash);
    // The title's placeholders may still be being written: its removal is refused or times out until they are done.
    for (let wait = 0; entry && wait < 40; wait++) {
        await apiDelete(page, `JellyfinMod/Entries/${entry.id}`).catch(() => {});
        if (!await entryOf(page, 'series', LONG_SERIES)) break;
        await page.waitForTimeout(3000);
    }
    if (entry) record(label, 'Back during an Add: removed again', !await entryOf(page, 'series', LONG_SERIES));
    added.delete(entry?.id);
}

/**
 * A user who may read no title makes every page of a search empty after filtering, with TMDB always offering another: three empty pages
 * per kind and it stops, however long the end of the grid stays in view (tm2.r1). Needs a saved token, as only a token pages.
 */
async function checkEmptyPagesStop(browser, page, label) {
    const name = 'tm2-empty-pages';
    if ((await apiJson(page, 'Users')).some(user => user.Name === name)) { notVerified(label, 'empty pages stop', `user ${name} is already here`); return; }
    const user = await page.evaluate(n => ApiClient.ajax({ type: 'POST', url: ApiClient.getUrl('Users/New'), data: JSON.stringify({ Name: n, Password: '' }), contentType: 'application/json', dataType: 'json' }), name);
    const context = await browser.newContext({ viewport: LAYOUTS.computer.viewport, serviceWorkers: 'block' });
    try {
        await page.evaluate(([id, policy]) => ApiClient.ajax({ type: 'POST', url: ApiClient.getUrl(`Users/${id}/Policy`), data: JSON.stringify(policy), contentType: 'application/json' }),
            [user.Id, { ...user.Policy, MaxParentalRating: -1, BlockUnratedItems: [] }]);
        const viewer = await context.newPage();
        const asked = [];
        const pages = [];
        // Counted when sent: a fourth page fails even if it never gets an answer.
        viewer.on('request', request => {
            if (!request.url().includes('JellyfinMod/Discover/Search')) return;
            const params = new URL(request.url()).searchParams;
            asked.push({ type: params.get('type'), page: Number(params.get('page') ?? 1) });
        });
        viewer.on('response', response => {
            if (!response.url().includes('JellyfinMod/Discover/Search')) return;
            const params = new URL(response.url()).searchParams;
            pages.push(response.json().catch(() => null).then(body => ({ type: params.get('type'), page: Number(params.get('page') ?? 1), status: response.status(), body })));
        });
        await signIn(viewer, name);
        await viewer.goto(base() + '#/search?query=love', { waitUntil: 'domcontentloaded' });
        await viewer.waitForTimeout(25000);
        await viewer.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await viewer.waitForTimeout(5000);
        const settled = asked.length;
        await viewer.waitForTimeout(10000);
        // Three successful pages per kind, each empty after filtering with TMDB offering another, and no fourth: a failed search stops too.
        const answers = await Promise.all(pages);
        for (const type of ['movie', 'series']) {
            const kind = answers.filter(answer => answer.type === type);
            // A library change while the grid is open refetches it: the three pages again from the first, never a fourth.
            const order = kind.map(answer => answer.page).join();
            record(label, `empty pages stop: ${type}: three pages, then none`, /^1,2,3(,1,2,3)*$/.test(order), `pages ${order}`);
            const sent = asked.filter(request => request.type === type).map(request => request.page);
            record(label, `empty pages stop: ${type}: no fourth page asked for`, sent.length > 0 && sent.every(number => number <= 3), `sent ${sent.join()}`);
            record(label, `empty pages stop: ${type}: each one answered, empty, with another on offer`,
                kind.length > 0 && kind.every(answer => answer.status === 200 && answer.body?.items?.length === 0 && answer.body?.nextPage === answer.page + 1 && answer.body?.skipped === 0),
                kind.map(answer => `${answer.status}, ${answer.body?.items?.length} items, next ${answer.body?.nextPage}, skipped ${answer.body?.skipped}`).join('; '));
        }
        record(label, 'empty pages stop: it does not walk on', asked.length === settled, `${settled} then ${asked.length}`);
        const shown = await viewer.evaluate(() => document.querySelectorAll('.cell[data-jfmod-key]').length);
        record(label, 'empty pages stop: the user is offered nothing', shown === 0, `${shown} cards`);
    } finally {
        await context.close();
        await page.evaluate(id => ApiClient.ajax({ type: 'DELETE', url: ApiClient.getUrl(`Users/${id}`) }), user.Id).catch(error => console.log(`note: removing the user: ${error}`));
    }
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
    record(label, 'search paging: the new cards follow those shown', after.cards.slice(shown.length).every(card => !shown.includes(card.key)), after.cards.slice(shown.length, shown.length + 5).map(card => card.title).join(', '));
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
        if (!ROWS) await checkSearch(page, label, layoutName, theme).catch(error => record(label, 'search: ran to the end', false, error.message.split('\n')[0]));
        await checkBrowsePages(page, label, layoutName, theme).catch(error => record(label, 'browse pages: ran to the end', false, error.message.split('\n')[0]));
        if (ADD && theme === 'dark') {
            const kinds = { computer: ['movie', 'series', 'season', 'episode'], phone: ['movie'], tv1920: ['series'], tv1280: [] }[layoutName];
            for (const kind of kinds) await checkAdd(page, label, kind, layoutName).catch(error => record(label, `add from the ${kind} page: ran to the end`, false, error.message.split('\n')[0]));
            if (layoutName === 'computer') await checkAddFromCard(page, label).catch(error => record(label, 'the + on a card: ran to the end', false, error.message.split('\n')[0]));
        }
        if (TOKEN && layoutName === 'computer' && theme === 'dark') await checkPaging(page, label).catch(error => record(label, 'search paging: ran to the end', false, error.message.split('\n')[0]));
        if (TOKEN && layoutName === 'computer' && theme === 'dark') await checkEmptyPagesStop(browser, page, label).catch(error => record(label, 'empty pages stop: ran to the end', false, error.message.split('\n')[0]));
        if (ADD && layoutName === 'computer' && theme === 'dark') await checkBackDuringAdd(page, label).catch(error => record(label, 'Back during an Add: ran to the end', false, error.message.split('\n')[0]));
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
