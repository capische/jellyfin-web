/* eslint-disable no-restricted-globals -- a Node acceptance runner, not shipped code */
/* global window, document, localStorage, location, ApiClient */
// The Queue page's State column as discs only, with a seeding disc and every detail in a tip (P4.FU28, user-approved 2026-10-26;
// reviews/queue-state-icons/ in the workspace), in a real browser against a local environment, signed in as oleksii with an empty
// password. NOTHING IS CHANGED: the environment's own rows are only read, every Remove or Retry is stopped before it leaves the
// browser (the run fails if one does), and window.open is replaced so a disc's click is recorded, never opened.
//
// Part 1, the environment's real rows (alpha: a seeding series; beta: a seeding pack and a downloading movie): each State cell is
// one disc and nothing else (desktop, phone), the seeding disc's arc is the slower goal, the tip's lines, an administrator's click
// opens the client (desktop), a tap opens the popover and never the client (phone), the TV keeps the details as lines under the
// disc and Enter on the row still opens its action sheet.
// Part 2, staged states: the real GET /JellyfinMod/Queue answer with staged rows added (held, blocked, failed, stalled, linking,
// unknown, a pack with an episode problem, seeding at 19 %, goal met, releasing, a blocked release), the same checks per row.
//
//   JELLYFINMOD_LIVE_URL=<local environment>  JELLYFINMOD_LIVE_FIXTURE_FILE=<any 0600 file; none of it is used here>
//   [JELLYFINMOD_LIVE_LAYOUT=desktop|mobile|tv1080|tv720]  [JELLYFINMOD_QD_THEME=dark|light]  [JELLYFINMOD_BROWSER=chromium|chrome]
//   [JELLYFINMOD_LIVE_SHOTS=<folder>]
import { mkdirSync } from 'node:fs';

import { api, launch, newPage, notVerified, origin, record, results, saveResults, setTvLayout, signIn } from './live-lib.mjs';

if (!['127.0.0.1', 'localhost'].includes(origin.hostname)) throw new Error('Runs on a local environment only');
const layout = process.env.JELLYFINMOD_LIVE_LAYOUT ?? 'desktop';
const theme = process.env.JELLYFINMOD_QD_THEME ?? 'dark';
const tv = layout.startsWith('tv');
const phone = layout === 'mobile';
const shots = process.env.JELLYFINMOD_LIVE_SHOTS ?? '.';
mkdirSync(shots, { recursive: true });
const label = `queue-discs ${layout} ${theme}`;
const shot = (page, name) => page.screenshot({ path: `${shots}/${name}.png` }).catch(() => undefined);

const browser = await launch();
const { context, page } = await newPage(browser, layout);
const writes = [];
page.on('request', request => {
    if (request.method() !== 'GET' && /\/JellyfinMod\/Queue/.test(request.url())) writes.push(request.method() + ' ' + request.url().replace(/^.*\/JellyfinMod/, ''));
});
await page.route(/\/JellyfinMod\/Queue\/.+/, route => (route.request().method() === 'GET' ? route.continue() : route.abort()));

const DAY = 86400;
const WAITING_BOTH = 'Waiting for the ratio goal and the seeding time goal';

/** Expected words, computed here from the row's data, not by the page's code. */
const fixed = value => value.toFixed(2);
function duration(seconds) {
    if (seconds < 60) return Math.ceil(seconds) + ' s';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return minutes + ' min';
    const hours = Math.floor(minutes / 60);
    return hours < 48 ? hours + ' h' + (minutes % 60 ? ' ' + (minutes % 60) + ' min' : '') : Math.round(hours / 24) + ' d';
}
const WAIT = { complete: 'the download to finish', ratio: 'the ratio goal', time: 'the seeding time goal' };
/** A real seeding row's tooltip lines (without Open) and the TV's lines. */
function seedingLines(s) {
    const figures = ['ratio ' + fixed(s.ratio) + ' of ' + fixed(s.goalRatio), 'seeded ' + duration(s.seedingSeconds) + ' of ' + duration(s.goalSeconds)].join(' · ');
    const words = s.waitingFor.map(reason => WAIT[reason]);
    const facts = [];
    if (s.state === 'removing') facts.push('Releasing the seeding copy');
    else if (words.length) facts.push('Waiting for ' + (words.length < 2 ? words[0] : words.slice(0, -1).join(', ') + ' and ' + words[words.length - 1]));
    else if (s.goalMetAt) facts.push('Goal met');
    if (s.state !== 'blocked' && !s.releaseEnabled && s.state !== 'removing' && !words.length) facts.push('Kept seeding: automatic release is off.');
    return { lines: ['Seeding · ' + figures, ...facts], tv: ['R' + figures.slice(1), ...facts] };
}
function seedingExpectation(seeding) {
    const shares = [[seeding.ratio, seeding.goalRatio], [seeding.seedingSeconds, seeding.goalSeconds]].filter(([, goal]) => goal > 0)
        .map(([value, goal]) => (value ?? 0) / goal);
    const met = !!seeding.goalMetAt || seeding.waitingFor.length === 0;
    return { kind: seeding.state === 'removing' ? 'releasing' : 'seeding', percent: met ? 100 : Math.floor(Math.min(1, ...shares) * 100) };
}

async function useTheme() {
    await page.evaluate(name => localStorage.setItem(ApiClient.getCurrentUserId() + '-appTheme', name), theme);
    if (tv) {
        await setTvLayout(page);
        return;
    }
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
        try {
            return !!ApiClient.getCurrentUserId();
        } catch {
            return false;
        }
    }, undefined, { timeout: 30000 });
    await page.waitForTimeout(2000);
}

async function openQueue() {
    await page.evaluate(() => {
        location.hash = '#/catalog/queue';
    });
    await page.locator('.jfmod-queue').waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(1500);
    // A disc's click is recorded, never opened.
    await page.evaluate(() => {
        window.jfmodOpened = [];
        window.open = url => {
            window.jfmodOpened.push(String(url));
            return null;
        };
    });
}

const rowSelector = tv ? '.jfmod-queueRow--tv' : phone ? '.jfmod-queueRow--stacked' : '.jfmod-queueTableRow';
const rowOf = release => page.locator(rowSelector).filter({ hasText: release }).first();

/** The row's disc: its kind, arc and the State cell's other content. */
const discOf = release => rowOf(release).evaluate(row => {
    const mark = row.querySelector('.jfmod-dlmark');
    const fill = mark?.querySelector('.jfmod-dlmark-fill');
    const cell = row.querySelector('.jfmod-queueCellState');
    const button = row.querySelector('.jfmod-queueStateButton');
    return {
        marks: row.querySelectorAll('.jfmod-dlmark').length,
        kind: mark?.getAttribute('data-jfmod-kind') ?? null,
        offset: fill ? Number(fill.style.strokeDashoffset) : null,
        dash: fill?.getAttribute('stroke-dasharray') ?? null,
        nativeTitle: mark?.getAttribute('title') ?? null,
        link: mark?.getAttribute('role') === 'link',
        cellText: cell ? cell.innerText.trim() : null,
        wrapHeight: row.querySelector('.jfmod-queueState--disc')?.getBoundingClientRect().height ?? null,
        markHeight: mark ? mark.getBoundingClientRect().height : null,
        button: !!button && button.contains(mark),
        buttonText: button ? button.innerText.trim() : null,
        details: [...row.querySelectorAll('.jfmod-queueDetail')].map(node => node.textContent)
    };
});

function checkDisc(name, disc, want) {
    const arc = want.kind === 'releasing' || want.kind === 'importing' ? disc.dash === '28 72'
        : want.percent === null || disc.offset === 100 - want.percent;
    record(label, `${name}: the ${want.kind} disc${want.percent === null ? '' : ' with its arc at ' + want.percent + ' %'}`,
        disc.marks === 1 && disc.kind === want.kind && arc, { kind: disc.kind, offset: disc.offset, dash: disc.dash });
    if (tv) {
        record(label, `${name}: the TV keeps the details as lines under the disc`, JSON.stringify(disc.details) === JSON.stringify(want.tv), disc.details);
    } else if (phone) {
        record(label, `${name}: the phone row's state is the disc alone, inside its button, no detail line`,
            disc.button && disc.buttonText === '' && disc.details.length === 0, { button: disc.button, text: disc.buttonText, details: disc.details });
    } else {
        record(label, `${name}: the State cell is the disc alone (no text, one disc high), no native tooltip`,
            disc.cellText === '' && disc.wrapHeight < disc.markHeight + 12 && disc.nativeTitle === null,
            { text: disc.cellText, wrap: disc.wrapHeight, mark: disc.markHeight, title: disc.nativeTitle });
    }
}

async function checkTooltip(name, release, want, link) {
    const wrapper = rowOf(release).locator('.jfmod-queueState--disc');
    await wrapper.hover();
    const tip = page.locator('.MuiTooltip-tooltip').last();
    const shown = await tip.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false);
    const state = shown ? await page.evaluate(() => {
        const tips = [...document.querySelectorAll('.MuiTooltip-tooltip')];
        const node = tips[tips.length - 1];
        return { lines: [...node.querySelectorAll('.jfmod-queueTipLine')].map(line => line.textContent), bottom: node.getBoundingClientRect().bottom,
            placement: node.closest('.MuiTooltip-popper')?.getAttribute('data-popper-placement') ?? null };
    }) : null;
    const top = await wrapper.evaluate(node => node.querySelector('.jfmod-dlmark').getBoundingClientRect().top);
    const expected = [...want.lines, ...(link ? ['Open ' + link] : [])];
    record(label, `${name}: hover shows the MUI tooltip above the disc with its lines`,
        !!state && state.placement === 'top' && state.bottom <= top + 1 && JSON.stringify(state.lines) === JSON.stringify(expected),
        { lines: state?.lines, expected, placement: state?.placement, bottom: state?.bottom, top });
    return async () => {
        await page.mouse.move(2, 2);
        await tip.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined);
    };
}

async function checkPopover(name, release, want, link) {
    const before = await page.evaluate(() => location.hash);
    await rowOf(release).locator('.jfmod-queueStateButton').tap();
    const popover = page.locator('.jfmod-infoPopover');
    const shown = await popover.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false);
    await page.waitForTimeout(400);
    const state = shown ? await page.evaluate(() => {
        const node = document.querySelector('.jfmod-infoPopover');
        const anchor = node.querySelector('.jfmod-infoPopoverLink');
        return { title: node.querySelector('.jfmod-infoPopoverTitle')?.textContent, width: node.getBoundingClientRect().width,
            lines: [...node.querySelectorAll('.jfmod-infoPopoverText:not(.jfmod-infoPopoverLinkLine)')].map(line => line.textContent),
            link: anchor?.textContent ?? null, linkMatches: anchor ? anchor.getAttribute('href') === window.jfmodLink : null };
    }) : null;
    const after = await page.evaluate(() => ({ hash: location.hash, opened: window.jfmodOpened.length, viewport: window.innerWidth }));
    const lines = want.lines.slice(1);
    const head = want.lines[0].slice(want.title.length + 3);
    const expected = [...(want.lines[0] === want.title ? [] : [head.charAt(0).toUpperCase() + head.slice(1)]), ...lines];
    record(label, `${name}: a tap opens the popover (state as title, the facts${link ? ', the Open link' : ''}), full width, and opens nothing`,
        !!state && state.title === want.title && JSON.stringify(state.lines) === JSON.stringify(expected)
            && (link ? state.link === 'Open ' + link && state.linkMatches === true : state.link === null)
            && state.width >= after.viewport - 20 && after.hash === before && after.opened === 0,
        { title: state?.title, lines: state?.lines, expected, link: state?.link, linkMatches: state?.linkMatches, width: state?.width, opened: after.opened,
            moved: after.hash !== before });
    return async () => {
        await page.locator('.jfmod-infoPopover [aria-label="Close"]').click();
        await popover.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined);
        await page.waitForTimeout(300);
    };
}

/** Desktop: an administrator's click on a linked disc opens the client (recorded), on an unlinked one nothing. */
async function checkClick(name, release, linked) {
    await page.evaluate(() => {
        window.jfmodOpened = [];
    });
    const hash = await page.evaluate(() => location.hash);
    await rowOf(release).locator('.jfmod-dlmark').click();
    await page.waitForTimeout(300);
    const state = await page.evaluate(() => ({ opened: window.jfmodOpened.length, matches: window.jfmodOpened[0] === window.jfmodLink, hash: location.hash }));
    record(label, `${name}: a click ${linked ? 'opens the client\'s page (intercepted) and nothing else' : 'opens nothing'}`,
        linked ? state.opened === 1 && state.matches && state.hash === hash : state.opened === 0 && state.hash === hash, state);
    await page.mouse.move(2, 2);
    await page.locator('.MuiTooltip-tooltip').first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined);
}

async function checkTvSheet(name, release) {
    const row = rowOf(release);
    await row.focus();
    await page.keyboard.press('Enter');
    const sheet = page.locator('.actionSheet');
    const open = await sheet.first().waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false);
    const items = open ? await sheet.first().locator('[data-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-id'))) : [];
    record(label, `${name}: Enter on the TV row still opens its action sheet`, open && items.length > 0, items);
    await page.waitForTimeout(700);
    await shot(page, 'tv-action-sheet');
    await page.keyboard.press('Escape');
    await sheet.first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(400);
}

/** One row's checks on this layout. `want`: kind, percent, title, lines (the tooltip's, without Open), tv (the TV's lines). */
async function checkRow(name, release, want, link) {
    await rowOf(release).scrollIntoViewIfNeeded();
    checkDisc(name, await discOf(release), want);
    if (tv) return;
    const close = phone ? await checkPopover(name, release, want, link) : await checkTooltip(name, release, want, link);
    await close();
}

const linkedKinds = new Set(['queued', 'downloading', 'importing', 'stalled', 'seeding', 'releasing']);

async function realRows(queue) {
    await openQueue();
    const seeding = queue.items.filter(item => item.state === 'seeding');
    const downloading = queue.items.filter(item => item.state === 'downloading');
    const client = queue.items.find(item => item.client?.openUrl)?.client;
    if (client) await page.evaluate(url => { window.jfmodLink = url; }, client.openUrl);
    record(label, 'Real rows: the environment has a seeding row', seeding.length > 0, queue.items.map(item => item.state));
    const pageText = await page.locator('.jfmod-queue').innerText();
    record(label, 'Real rows: "Seeding until its goal is met." is nowhere on the page', !pageText.includes('Seeding until its goal is met.'));
    const cells = await page.evaluate(selector => [...document.querySelectorAll(selector)].map(row => row.querySelectorAll('.jfmod-dlmark').length), rowSelector);
    record(label, 'Real rows: every row has exactly one disc', cells.length === queue.items.length && cells.every(count => count === 1), cells);
    for (const item of seeding) {
        const expect = seedingExpectation(item.seeding);
        const name = 'Real seeding ' + (item.entry?.title ?? item.releaseTitle) + ' (arc ' + expect.percent + ' %)';
        await checkRow(name, item.releaseTitle, { ...expect, title: 'Seeding', ...seedingLines(item.seeding) }, item.client?.openUrl ? item.client.name : null);
        if (!tv && !phone) await checkClick(name, item.releaseTitle, !!item.client?.openUrl);
    }
    for (const item of downloading) {
        const name = 'Real downloading ' + (item.entry?.title ?? item.releaseTitle);
        const disc = await discOf(item.releaseTitle);
        const percent = Math.floor(item.progress * 100);
        record(label, `${name}: the downloading disc, its arc at the row's percent (±1 between polls)`, disc.kind === 'downloading'
            && Math.abs(disc.offset - (100 - percent)) <= 1, { offset: disc.offset, percent });
        if (!tv && !phone) {
            const wrapper = rowOf(item.releaseTitle).locator('.jfmod-queueState--disc');
            await wrapper.hover();
            const tip = page.locator('.MuiTooltip-tooltip').last();
            await tip.waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined);
            const lines = await tip.locator('.jfmod-queueTipLine').allTextContents().catch(() => []);
            record(label, `${name}: the tooltip reads Downloading with its figures${item.client?.openUrl ? ', then Open' : ''}`,
                lines[0]?.startsWith('Downloading · ') && (!item.client?.openUrl || lines[lines.length - 1] === 'Open ' + item.client.name), lines);
            await page.mouse.move(2, 2);
            await tip.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined);
            await checkClick(name, item.releaseTitle, !!item.client?.openUrl);
        }
    }
    // Screenshots: the page; the computer with the seeding tooltip open; the phone with its popover open.
    await page.mouse.move(2, 2);
    await shot(page, 'real-rows');
    if (seeding[0] && !tv) {
        if (phone) {
            await rowOf(seeding[0].releaseTitle).locator('.jfmod-queueStateButton').tap();
            await page.locator('.jfmod-infoPopover').waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined);
            await page.waitForTimeout(500);
            await shot(page, 'real-seeding-popover');
            await page.locator('.jfmod-infoPopover [aria-label="Close"]').click().catch(() => undefined);
            await page.waitForTimeout(400);
        } else {
            await rowOf(seeding[0].releaseTitle).locator('.jfmod-queueState--disc').hover();
            await page.locator('.MuiTooltip-tooltip').last().waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined);
            await page.waitForTimeout(400);
            await shot(page, 'real-seeding-tooltip');
            await page.mouse.move(2, 2);
        }
    }
    if (tv && seeding[0]) await checkTvSheet('Real seeding', seeding[0].releaseTitle);
}

/** The staged rows, built from a real row so their entries are the environment's own. */
function stagedRows(template) {
    const at = new Date().toISOString();
    const ago = seconds => new Date(Date.now() - seconds * 1000).toISOString();
    let n = 0;
    const row = (release, extra) => {
        n += 1;
        const hex = String(n).padStart(2, '0');
        return { ...template, id: 'fd' + hex.repeat(15), grabId: 'fe' + hex.repeat(15), episode: null, pack: null, releaseTitle: release,
            state: 'downloading', importState: 'waiting', reason: null, message: null, progress: 0.42, sizeBytes: 4600000000, downloadedBytes: 1900000000,
            downloadRateBytes: 3000000, etaSeconds: 720, stalledSince: null, observedAt: at, createdAt: at, updatedAt: at, seeding: null, admin: undefined, ...extra };
    };
    const seed = (extra) => ({ id: 'fc'.repeat(16), state: 'waiting', reason: null, ratio: 0.19, goalRatio: 1, seedingSeconds: 4 * DAY, goalSeconds: 7 * DAY,
        waitingFor: ['ratio', 'time'], goalMetAt: null, libraryLinkPresent: true, releaseEnabled: true, ...extra });
    const seeding = { state: 'seeding', importState: 'completed', progress: 1, downloadedBytes: 4600000000, downloadRateBytes: 0, etaSeconds: null };
    const figures = (ratio, seeded) => 'ratio ' + ratio + ' of 1.00 · seeded ' + seeded + ' of 7 d';
    return [
        { name: 'Staged held', row: row('Staged.Held.2021.1080p-GRP', { state: 'queued', importState: 'held', progress: null, downloadedBytes: null, downloadRateBytes: null, etaSeconds: null }),
            want: { kind: 'queued', percent: null, title: 'Queued', lines: ['Queued · waiting to be sent to the download client'], tv: ['Waiting to be sent to the download client'] } },
        { name: 'Staged blocked', row: row('Staged.Blocked.2021.1080p-GRP', { state: 'blocked', importState: 'blocked', reason: 'path_unmapped', progress: 1, downloadRateBytes: 0, etaSeconds: null }),
            want: { kind: 'failed', percent: null, title: 'Blocked', lines: ['Blocked · The download\'s path is not mapped to a folder Jellyfin can open.'],
                tv: ['The download\'s path is not mapped to a folder Jellyfin can open.'] } },
        { name: 'Staged failed', row: row('Staged.Failed.2021.1080p-GRP', { state: 'failed', importState: 'failed', reason: 'source_missing',
            message: 'The downloaded file could not be found.', progress: 1, downloadRateBytes: 0, etaSeconds: null }),
        want: { kind: 'failed', percent: null, title: 'Failed', lines: ['Failed · The downloaded file could not be found.'], tv: ['The downloaded file could not be found.'] } },
        { name: 'Staged stalled', row: row('Staged.Stalled.2021.1080p-GRP', { state: 'stalled', stalledSince: ago(7200), downloadRateBytes: 0, etaSeconds: null }),
            want: { kind: 'stalled', percent: 42, title: 'Stalled at 42%', lines: ['Stalled at 42%'], tv: [] } },
        { name: 'Staged linking', row: row('Staged.Linking.2021.1080p-GRP', { state: 'linking', importState: 'linking', progress: 1, downloadRateBytes: 0, etaSeconds: null }),
            want: { kind: 'importing', percent: null, title: 'Linking into the library', lines: ['Linking into the library'], tv: [] } },
        { name: 'Staged unknown', row: row('Staged.Unknown.2021.1080p-GRP', { state: 'unknown', progress: 0.3, etaSeconds: null, observedAt: ago(600) }),
            want: { kind: 'downloading', percent: 30, title: 'Downloading', lines: ['Downloading · 30% · last known'], tv: [] } },
        { name: 'Staged pack problem', row: row('Staged.Pack.S01.1080p-GRP', { progress: 0.5, etaSeconds: 600, downloadRateBytes: 2000000, pack: { scope: 'season',
            label: 'Season 1 pack · 2 episodes', mode: 'fill', episodes: [
                { episodeId: 'fb'.repeat(16), seasonNumber: 1, episodeNumber: 2, importId: null, importState: null, reason: null, progress: 0.5, sizeBytes: 2300000000 },
                { episodeId: 'fa'.repeat(16), seasonNumber: 1, episodeNumber: 3, importId: 'f9'.repeat(16), importState: 'cancelled', reason: 'pack_episode_missing', progress: null, sizeBytes: null }
            ] } }),
        want: { kind: 'downloading', percent: 50, title: 'Downloading', lines: ['Downloading · 50% · 10 min left · 2 MB/s', 'S01E03: The pack holds no file for this episode.'],
            tv: ['S01E03: The pack holds no file for this episode.'] } },
        { name: 'Staged seeding 19 %', row: row('Staged.Seeding.2021.1080p-GRP', { ...seeding, seeding: seed({ reason: 'seed_goal_unmet' }) }),
            want: { kind: 'seeding', percent: 19, title: 'Seeding', lines: ['Seeding · ' + figures('0.19', '4 d'), WAITING_BOTH],
                tv: ['R' + figures('0.19', '4 d').slice(1), WAITING_BOTH] } },
        { name: 'Staged goal met, release off', row: row('Staged.GoalMet.2021.1080p-GRP', { ...seeding, seeding: seed({ ratio: 1.2, seedingSeconds: 8 * DAY, waitingFor: [],
            goalMetAt: ago(3600), releaseEnabled: false }) }),
        want: { kind: 'seeding', percent: 100, title: 'Seeding', lines: ['Seeding · ratio 1.20 of 1.00 · seeded 8 d of 7 d', 'Goal met', 'Kept seeding: automatic release is off.'],
            tv: ['Ratio 1.20 of 1.00 · seeded 8 d of 7 d', 'Goal met', 'Kept seeding: automatic release is off.'] } },
        { name: 'Staged releasing', row: row('Staged.Releasing.2021.1080p-GRP', { ...seeding, seeding: seed({ state: 'removing', ratio: 1.05, seedingSeconds: 7 * DAY,
            waitingFor: [], goalMetAt: ago(60) }) }),
        want: { kind: 'releasing', percent: null, title: 'Seeding', lines: ['Seeding · ratio 1.05 of 1.00 · seeded 7 d of 7 d', 'Releasing the seeding copy'],
            tv: ['Ratio 1.05 of 1.00 · seeded 7 d of 7 d', 'Releasing the seeding copy'] } },
        { name: 'Staged blocked release', row: row('Staged.ReleaseBlocked.2021.1080p-GRP', { ...seeding, seeding: seed({ state: 'blocked', reason: 'seeding_path_inside_library',
            ratio: 1.1, seedingSeconds: 7 * DAY, waitingFor: [], goalMetAt: ago(3600) }) }),
        want: { kind: 'seeding', percent: 100, title: 'Seeding', lines: ['Seeding · ratio 1.10 of 1.00 · seeded 7 d of 7 d', 'Goal met', 'The seeding copy is inside a library folder.'],
            tv: ['Ratio 1.10 of 1.00 · seeded 7 d of 7 d', 'Goal met', 'The seeding copy is inside a library folder.'] } }
    ];
}

async function staged(queue) {
    const template = queue.items.find(item => item.client?.openUrl) ?? queue.items[0];
    if (!template) throw new Error('the environment has no queue row to stage from');
    const rows = stagedRows(template);
    await page.route(/\/JellyfinMod\/Queue(\?|$)/, async route => {
        if (route.request().method() !== 'GET') return route.continue();
        const response = await route.fetch();
        const json = await response.json();
        return route.fulfill({ response, json: { ...json, items: [...json.items, ...rows.map(item => item.row)], totalRecordCount: json.items.length + rows.length } });
    });
    await page.evaluate(() => {
        location.hash = '#/home';
    });
    await page.waitForTimeout(1000);
    await openQueue();
    if (template.client?.openUrl) await page.evaluate(url => { window.jfmodLink = url; }, template.client.openUrl);
    const link = template.client?.openUrl ? template.client.name : null;
    for (const { name, row, want } of rows) {
        await checkRow(name, row.releaseTitle, want, linkedKinds.has(want.kind) ? link : null);
    }
    if (!tv && !phone) {
        await checkClick('Staged seeding 19 %', 'Staged.Seeding.2021.1080p-GRP', !!link);
        await checkClick('Staged pack problem (downloading)', 'Staged.Pack.S01.1080p-GRP', !!link);
        await checkClick('Staged blocked', 'Staged.Blocked.2021.1080p-GRP', false);
    }
    await page.mouse.move(2, 2);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, 'staged-rows');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
    await shot(page, 'staged-rows-end');
    if (!tv) {
        const target = 'Staged.ReleaseBlocked.2021.1080p-GRP';
        if (phone) {
            await rowOf(target).locator('.jfmod-queueStateButton').tap();
            await page.locator('.jfmod-infoPopover').waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined);
            await page.waitForTimeout(500);
            await shot(page, 'staged-blocked-release-popover');
            await page.locator('.jfmod-infoPopover [aria-label="Close"]').click().catch(() => undefined);
        } else {
            await rowOf(target).locator('.jfmod-queueState--disc').hover();
            await page.waitForTimeout(600);
            await shot(page, 'staged-blocked-release-tooltip');
            await page.mouse.move(2, 2);
        }
    }
    await page.unroute(/\/JellyfinMod\/Queue(\?|$)/);
}

try {
    await signIn(page);
    await useTheme();
    const queue = (await api(page, 'GET', 'JellyfinMod/Queue')).body;
    await realRows(queue);
    await staged(queue);
    record(label, 'Nothing but reads reached the queue (no Remove, Retry or other write)', writes.length === 0, writes);
    record(label, 'No page errors', page.jfmodErrors.length === 0, page.jfmodErrors.slice(0, 3));
} catch (error) {
    notVerified(label, 'the queue state discs', error);
    await shot(page, 'error');
}
await page.evaluate(() => localStorage.removeItem(ApiClient.getCurrentUserId() + '-appTheme')).catch(() => undefined);
await page.evaluate(() => localStorage.removeItem('layout')).catch(() => undefined);
// Sign out, so the run leaves no device behind.
await page.evaluate(() => ApiClient.logout()).catch(() => undefined);
if (results.some(result => result.verdict !== 'PASS')) process.exitCode = 1;
saveResults(label, browser.version());
await context.close();
await browser.close();
/* eslint-enable no-restricted-globals */
