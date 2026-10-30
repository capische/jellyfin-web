/* eslint-disable compat/compat, no-restricted-globals, sonarjs/cognitive-complexity, @stylistic/max-statements-per-line -- a Node acceptance runner, not shipped code */
/* global document, location, localStorage, ApiClient, getComputedStyle */
// The removal dialog (D118–D124, gate 2) on a local environment with real queue rows (stand-in Torznab and Transmission, real
// imports), real browsers signed in as oleksii with an empty password. Nothing is intercepted.
//
//   step dialog  (any layout and theme): each row's action from the Queue page (the desktop popover, the phone's and the TV's
//                action sheet, chosen by data-id), the dialog's title, facts and buttons for its state, the safe choice focused
//                and blue, the destructive one red; on the TV Up and Down walk the buttons, OK on the safe choice closes it and
//                Back closes it, and focus returns to the row (the TV) or its ⋮ (computer, phone); nothing is removed.
//                The close X sits level with the title (at least 40 px); the safe choice is grey on open on a computer and a
//                phone and blue on the TV; each dialog closes by turns with the safe choice, the X and Escape (the TV: OK, Back,
//                the X by the D-pad), and its row stays. Without the stand-ins' titles (a real environment) it takes one row
//                per state from the live queue.
//   step openers (desktop): the pending entry's X on a Replace (and its "… file stays."), the episode page's Cancel
//                Download on a pack, the picker's added-row X; each opens the dialog for its row's state, Keep returns focus to
//                the opener; the picker's X then deletes its download for real: its files on disk before, the stand-in's
//                delete-local-data request in its log, the files gone after. The picker part runs with the stand-ins only
//                (JELLYFINMOD_QR_DOWNLOADS and JELLYFINMOD_QR_STANDIN_LOG set). A failed pack (`Peep.Show.S02…`) joins step dialog.
//   step double (any layout): Escape (the TV: Back) pressed twice within the close animation, and on a computer and a phone
//                the X and (on a computer) the page beside it clicked or right-clicked twice, or Escape then a right-click
//                there, close the dialog once: it is gone, the page is still the Queue page (a second close used
//                to send a second history Back) and the next dialog opens and closes as usual; no removal request is sent.
//   step postlink (desktop): a pack episode blocked after its link counts as in the library (a rewritten Queue read; see the step).
//   step refused (desktop): JELLYFINMOD_QR_ADD=<grab id> names a blocked Add whose file has a second name: its pending entry's X,
//                Delete is refused, the dialog asks again without it, and Cancel returns focus to the X, enabled.
//
//   JELLYFINMOD_LIVE_URL=http://127.0.0.1:<port>/   JELLYFINMOD_LIVE_FIXTURE_FILE=<stand-ins' 0600 secrets file>
//   JELLYFINMOD_LIVE_LAYOUT=desktop|mobile|tv1080|tv720   JELLYFINMOD_QR_THEME=dark|light   JELLYFINMOD_QR_STEPS=dialog,openers,refused,postlink,double
//   JELLYFINMOD_LIVE_SHOTS=<folder>   JELLYFINMOD_BROWSER=chromium|chrome   [JELLYFINMOD_QR_CONTROL=http://127.0.0.1:38419]
//   JELLYFINMOD_QR_DOWNLOADS=<the stand-in client's /downloads on this Mac>   JELLYFINMOD_QR_STANDIN_LOG=<the stand-ins' log> (openers)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { api, launch, newPage, origin, record, results, saveResults, setTvLayout, signIn } from './live-lib.mjs';

if (!['127.0.0.1', 'localhost'].includes(origin.hostname)) throw new Error('Runs on a local environment only');
const layout = process.env.JELLYFINMOD_LIVE_LAYOUT ?? 'desktop';
const theme = process.env.JELLYFINMOD_QR_THEME ?? 'dark';
const steps = (process.env.JELLYFINMOD_QR_STEPS ?? 'dialog').split(',');
const CONTROL = process.env.JELLYFINMOD_QR_CONTROL ?? 'http://127.0.0.1:38419';
// The stand-in client's download folder on this Mac and its log (step openers).
const DOWNLOADS = process.env.JELLYFINMOD_QR_DOWNLOADS ?? '';
const STANDIN_LOG = process.env.JELLYFINMOD_QR_STANDIN_LOG ?? '';
const tv = layout.startsWith('tv');
const phone = layout === 'mobile';
const shots = process.env.JELLYFINMOD_LIVE_SHOTS ?? '.';
mkdirSync(shots, { recursive: true });
const tag = `${layout} ${theme}`;
const shot = (page, name) => page.screenshot({ path: `${shots}/${name}-${layout}-${theme}.png` }).catch(() => undefined);

const browser = await launch();
const { page } = await newPage(browser, layout);
await signIn(page);
await page.evaluate(name => localStorage.setItem(ApiClient.getCurrentUserId() + '-appTheme', name), theme);
if (tv) {
    await setTvLayout(page);
} else {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => { try { return !!ApiClient.getCurrentUserId(); } catch { return false; } }, undefined, { timeout: 30000 });
    await page.waitForTimeout(2000);
}
const serverId = await page.evaluate(() => ApiClient.serverId());
// Every removal the page asks for: a queue row's DELETE or a held grab's Cancel. Steps dialog and double must send none.
const removals = [];
page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if ((request.method() === 'DELETE' && /\/JellyfinMod\/Queue\//.test(path)) || /\/JellyfinMod\/Grabs\/[^/]+\/Cancel$/.test(path)) removals.push(request.method() + ' ' + path);
});

/** What the open dialog shows, and where focus is. */
const dialogState = () => page.evaluate(() => {
    const dialog = document.querySelector('.jfmod-removeDialog');
    if (!dialog) return null;
    const text = selector => [...dialog.querySelectorAll(selector)].map(node => node.textContent);
    return {
        title: dialog.querySelector('.jfmod-removeTitle')?.textContent,
        question: dialog.querySelector('.jfmod-removeQuestion')?.textContent,
        facts: text('.jfmod-removeFacts'),
        notes: text('.jfmod-removeNote'),
        blocklist: !!dialog.querySelector('.jfmod-removeBlocklistBox'),
        choices: [...dialog.querySelectorAll('.jfmod-removeChoice')].map(button => ({ id: button.getAttribute('data-choice'), name: button.textContent,
            red: button.classList.contains('button-delete'), background: getComputedStyle(button).backgroundColor })),
        focused: document.activeElement?.getAttribute?.('data-choice') ?? null,
        font: getComputedStyle(dialog.querySelector('.jfmod-removeTitle')).fontFamily.split(',')[0],
        paper: getComputedStyle(dialog).backgroundColor,
        focusVisible: document.activeElement?.matches?.(':focus-visible') ?? null,
        close: (() => {
            const x = dialog.querySelector('.jfmod-removeClose')?.getBoundingClientRect();
            const title = dialog.querySelector('.jfmod-removeTitle').getBoundingClientRect();
            return x ? { size: Math.round(Math.min(x.width, x.height)), dy: Math.round(Math.abs(x.top + x.height / 2 - title.top - title.height / 2)),
                right: x.right > title.right, label: dialog.querySelector('.jfmod-removeClose').getAttribute('aria-label') } : null;
        })(),
        // The theme's own greys and focus blue, read through the same variables the stock button rules use.
        colours: (() => {
            const probe = value => {
                const node = document.createElement('div');
                node.style.background = value;
                dialog.appendChild(node);
                const colour = getComputedStyle(node).backgroundColor;
                node.remove();
                return colour;
            };
            return { grey: probe('var(--jf-palette-Button-inheritContainedBg, #424242)'), hover: probe('var(--jf-palette-Button-inheritContainedHoverBg, #616161)'),
                blue: probe('var(--jf-palette-secondary-main, #00a4dc)') };
        })()
    };
});
const waitDialog = () => page.waitForSelector('.jfmod-removeDialog .jfmod-removeChoice', { timeout: 15000 }).then(() => page.waitForTimeout(500));
const waitClosed = () => page.waitForSelector('.jfmod-removeDialog', { state: 'detached', timeout: 15000 }).then(() => page.waitForTimeout(600));
const active = () => page.evaluate(() => {
    const element = document.activeElement;
    return { cls: element?.className ?? '', text: (element?.textContent ?? '').slice(0, 80), label: element?.getAttribute?.('aria-label') ?? '',
        pending: element?.getAttribute?.('data-jfmod-pending-remove') ?? null };
});
const queueRows = async () => (await api(page, 'GET', '/JellyfinMod/Queue')).body.items;
/** A row whose menu offers the removal dialog: not mid-import, and not a grab the client has yet to accept (held, submitting). */
const opensDialog = row => !['importing', 'linking', 'scanning', 'identifying'].includes(row.state) && !['held', 'submitting'].includes(row.importState);

/** The row's expected plan, from its data (not from the page's code). */
const expected = row => {
    if (row.state === 'seeding') return { title: 'Stop Seeding', red: 'Stop Seeding', choices: ['keep', 'cancel'], blocklist: false };
    const underWay = ['queued', 'downloading', 'stalled', 'unknown'].includes(row.state);
    if (row.canDeleteFiles) {
        return { title: underWay ? 'Cancel Download' : 'Remove Download', red: 'Delete the Download',
            choices: underWay ? ['delete', 'cancel'] : ['delete', 'keep', 'cancel'], blocklist: true };
    }
    return { title: underWay ? 'Cancel Download' : 'Remove Download', red: underWay ? 'Stop the Download' : 'Remove from Queue', choices: ['keep', 'cancel'], blocklist: true };
};
const checkPlan = (step, name, state, want) => {
    record(step, `${name}: titled ${want.title}, its choices ${want.choices.join(', ')}, the red one ${want.red}, the safe one focused`,
        !!state && state.title === want.title && state.choices.map(choice => choice.id).join() === want.choices.join()
        && state.choices.filter(choice => choice.red).map(choice => choice.name).join() === want.red && state.focused === 'cancel'
        && state.blocklist === want.blocklist, JSON.stringify(state));
};

async function dialogStep() {
    const step = `dialog ${tag}`;
    await page.evaluate(() => { location.hash = '#/catalog/queue'; });
    await page.locator('.jfmod-queue').waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(2000);
    const before = (await queueRows()).map(row => row.id).sort().join();
    let rowSelector = '.jfmod-queueTableRow';
    if (tv) rowSelector = '.jfmod-queueRow--tv';
    else if (phone) rowSelector = '.jfmod-queueRow--stacked';
    const titles = [['seeding', 'Inception.2010.1080p'], ['blocked', 'The.Matrix.Reloaded'], ['downloading', 'The.Matrix.1999'], ['pack', 'Adolescence.S01']];
    // A pack whose episodes all failed (Codex review P2 1): its files may be deleted, so it must not promise they stay.
    if ((await queueRows()).some(row => row.releaseTitle.startsWith('Peep.Show.S02'))) titles.push(['packfailed', 'Peep.Show.S02']);
    // The stand-ins' titles that are present, then one row of each other state from the live queue (a real environment), a
    // pack apart.
    const live = await queueRows();
    const stateKey = row => row.state + (row.pack ? '-pack' : '');
    const picks = titles.filter(([, title]) => live.some(row => row.releaseTitle.startsWith(title)));
    const covered = new Set(picks.map(([, title]) => stateKey(live.find(row => row.releaseTitle.startsWith(title)))));
    for (const row of live) {
        if (!covered.has(stateKey(row)) && opensDialog(row)) {
            covered.add(stateKey(row));
            picks.push([stateKey(row), row.releaseTitle]);
        }
    }
    record(step, 'the queue has rows to open', picks.length > 0, picks.map(([key]) => key).join(', '));
    // Every way to close it runs at least once: the safe choice, the X, Escape (the TV: OK, Back, the X by the D-pad).
    const closers = tv ? ['ok', 'back', 'x'] : ['keep', 'x', 'escape'];
    const opens = picks.length ? Math.max(picks.length, closers.length) : 0;
    for (let index = 0; index < opens; index++) {
        const [key, title] = picks[index % picks.length];
        const closer = closers[index % closers.length];
        const data = (await queueRows()).find(row => row.releaseTitle.startsWith(title));
        const row = page.locator(rowSelector).filter({ hasText: title }).first();
        if (tv) {
            await row.focus();
            await page.keyboard.press('Enter');
        } else {
            await row.locator('.jfmod-queueMenu').click();
        }
        if (phone || tv) {
            await page.waitForSelector('.actionSheet [data-id="remove"]', { timeout: 10000 });
            if (tv) {
                // The D-pad to the item by its data-id, never by position, once the sheet has taken focus.
                await page.waitForFunction(() => !!document.activeElement?.closest('.actionSheet'), undefined, { timeout: 10000 });
                await page.waitForTimeout(400);
                for (let i = 0; i < 4 && await page.evaluate(() => document.activeElement?.closest('[data-id]')?.getAttribute('data-id')) !== 'remove'; i++) {
                    await page.keyboard.press('ArrowDown');
                    await page.waitForTimeout(250);
                }
                record(step, `${key}: the action sheet's Remove item has the D-pad's focus`,
                    await page.evaluate(() => document.activeElement?.closest('[data-id]')?.getAttribute('data-id')) === 'remove',
                    await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 160)));
                await page.keyboard.press('Enter');
            } else {
                await page.locator('.actionSheet [data-id="remove"]').click();
            }
        } else {
            await page.locator('.jfmod-queueMenuItem[data-id="remove"]').click();
        }
        await waitDialog();
        const state = await dialogState();
        checkPlan(step, key, state, expected(data));
        record(step, `${key}: a dialog that can delete the files promises no episode stays in the library`,
            !state.choices.some(choice => choice.id === 'delete') || !state.facts.some(fact => fact.includes('stay there')), JSON.stringify(state.facts));
        record(step, `${key}: the close X is level with the title on its right, at least 40 px, labelled Close`,
            !!state.close && state.close.size >= 40 && state.close.dy <= 4 && state.close.right && state.close.label === 'Close', JSON.stringify(state.close));
        const safe = state.choices.find(choice => choice.id === 'cancel');
        record(step, `${key}: the safe choice is ${tv ? 'blue (the TV\'s focus fill)' : 'grey'} as the dialog opens`,
            safe?.background === (tv ? state.colours.blue : state.colours.grey), JSON.stringify({ safe: safe?.background, ...state.colours, focusVisible: state.focusVisible }));
        if (index === 0 && !tv && !phone) {
            await page.locator('.jfmod-removeChoice[data-choice="cancel"]').hover();
            await page.waitForTimeout(400);
            const hover = await page.locator('.jfmod-removeChoice[data-choice="cancel"]').evaluate(button => getComputedStyle(button).backgroundColor);
            record(step, `${key}: the safe choice takes the stock hover grey under the pointer`, hover === state.colours.hover, hover);
            await page.mouse.move(5, 5);
            await page.waitForTimeout(300);
        }
        await shot(page, `dialog-${key}-${closer}`);
        if (tv) {
            const walk = [];
            await page.keyboard.press('ArrowUp');
            walk.push(await page.evaluate(() => document.activeElement?.getAttribute('data-choice')));
            await page.keyboard.press('ArrowDown');
            walk.push(await page.evaluate(() => document.activeElement?.getAttribute('data-choice')));
            const ids = state.choices.map(choice => choice.id);
            record(step, `${key}: Up moves to the choice above the safe one, Down back to it`, walk[0] === ids[ids.length - 2] && walk[1] === 'cancel', walk.join(' → '));
            if (closer === 'x') {
                // The X by the D-pad: Up from the safe choice until it has focus, then OK.
                for (let i = 0; i < 8 && !await page.evaluate(() => document.activeElement?.classList.contains('jfmod-removeClose')); i++) {
                    await page.keyboard.press('ArrowUp');
                    await page.waitForTimeout(250);
                }
                const onX = await page.evaluate(() => document.activeElement?.classList.contains('jfmod-removeClose'));
                record(step, `${key}: the D-pad reaches the close X`, onX, await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 120)));
                if (onX) await shot(page, `dialog-${key}-x-focused`);
                await page.keyboard.press(onX ? 'Enter' : 'Escape');
            } else {
                await page.keyboard.press(closer === 'ok' ? 'Enter' : 'Escape');
            }
        } else if (closer === 'x') {
            await page.locator('.jfmod-removeClose').click();
        } else if (closer === 'escape') {
            await page.keyboard.press('Escape');
        } else {
            await page.locator('.jfmod-removeChoice[data-choice="cancel"]').click();
        }
        await waitClosed();
        const focus = await active();
        const name = data.entry.title;
        const back = tv ? focus.cls.includes('jfmod-queueRow--tv') && focus.text.includes(name) : focus.cls.includes('jfmod-queueMenu') && focus.label.includes(name);
        const how = { keep: 'the safe choice', ok: 'OK on the safe choice', back: 'Back', x: 'the close X', escape: 'Escape' }[closer];
        record(step, `${key}: ${how} closes it and focus returns to ${tv ? 'the row' : 'its ⋮'}`, back, JSON.stringify(focus));
        // The row and its grab are still there and nothing asked to remove it; its state may move on by itself (downloading to
        // seeding, say) while the dialog is open.
        const now = (await queueRows()).find(candidate => candidate.id === data.id);
        record(step, `${key}: after ${how} the row and its grab are still there and no removal was sent`,
            !!now && now.grabId === data.grabId && removals.length === 0, JSON.stringify({ state: now?.state ?? null, removals }));
    }
    const after = (await queueRows()).map(row => row.id).sort().join();
    record(step, 'nothing was removed', before === after, `${before.split(',').length} rows before, ${after.split(',').length} after`);
}

/** Opens the first row's dialog from the Queue page (the row menu, or the action sheet by its data-id on the phone and the TV). */
async function openFromQueue(title) {
    let rowSelector = '.jfmod-queueTableRow';
    if (tv) rowSelector = '.jfmod-queueRow--tv';
    else if (phone) rowSelector = '.jfmod-queueRow--stacked';
    const row = page.locator(rowSelector).filter({ hasText: title }).first();
    if (tv) {
        await row.focus();
        await page.keyboard.press('Enter');
        await page.waitForSelector('.actionSheet [data-id="remove"]', { timeout: 10000 });
        await page.waitForFunction(() => !!document.activeElement?.closest('.actionSheet'), undefined, { timeout: 10000 });
        await page.waitForTimeout(400);
        for (let i = 0; i < 4 && await page.evaluate(() => document.activeElement?.closest('[data-id]')?.getAttribute('data-id')) !== 'remove'; i++) {
            await page.keyboard.press('ArrowDown');
            await page.waitForTimeout(250);
        }
        await page.keyboard.press('Enter');
    } else {
        await row.locator('.jfmod-queueMenu').click();
        if (phone) await page.locator('.actionSheet [data-id="remove"]').click();
        else await page.locator('.jfmod-queueMenuItem[data-id="remove"]').click();
    }
    await waitDialog();
}

async function doubleStep() {
    const step = `double ${tag}`;
    await page.evaluate(() => { location.hash = '#/catalog/queue'; });
    await page.locator('.jfmod-queue').waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(2000);
    const rows = await queueRows();
    const data = rows.find(opensDialog);
    record(step, 'the queue has a row to open', !!data, data?.state ?? 'none');
    if (!data) return;
    const before = rows.map(row => row.id).sort().join();
    // The phone's dialog fills the screen, so it has no outside to click.
    let closers = ['Escape twice', 'the X twice', 'a click outside twice', 'a right-click outside twice', 'Escape and a right-click outside'];
    if (tv) closers = ['Back twice'];
    else if (phone) closers = ['Escape twice', 'the X twice'];
    for (const closer of closers) {
        await openFromQueue(data.releaseTitle);
        if (closer === 'the X twice') {
            // Two clicks 30 ms apart: the second lands while the close animation (120 ms) runs.
            await page.locator('.jfmod-removeClose').click();
            await page.locator('.jfmod-removeClose').click({ force: true, timeout: 1000 }).catch(() => undefined);
        } else if (closer === 'a click outside twice') {
            // Beside the dialog, on its container (the dimmed page).
            await page.mouse.click(4, 300);
            await page.mouse.click(4, 300);
        } else if (closer === 'a right-click outside twice') {
            // The helper closes on a context menu over its container too.
            await page.mouse.click(4, 300, { button: 'right' });
            await page.mouse.click(4, 300, { button: 'right' });
        } else if (closer === 'Escape and a right-click outside') {
            await page.keyboard.press('Escape');
            await page.mouse.click(4, 300, { button: 'right' });
        } else {
            await page.keyboard.press('Escape');
            await page.keyboard.press('Escape');
        }
        await page.waitForTimeout(1500);
        const where = await page.evaluate(() => ({ hash: location.hash, open: !!document.querySelector('.jfmod-removeDialog') }));
        record(step, `${closer}: closes the dialog once and the page stays the Queue page`, !where.open && where.hash.startsWith('#/catalog/queue'), JSON.stringify(where));
        await shot(page, `double-${closer.replace(/\W+/g, '-')}`);
        if (!where.hash.startsWith('#/catalog/queue')) {
            await page.evaluate(() => { location.hash = '#/catalog/queue'; });
            await page.locator('.jfmod-queue').waitFor({ state: 'visible', timeout: 30000 });
            await page.waitForTimeout(2000);
        }
    }
    // The next dialog still opens, takes focus, and closes with its safe choice.
    await openFromQueue(data.releaseTitle);
    const state = await dialogState();
    record(step, 'the next dialog opens with the safe choice focused', state?.focused === 'cancel', JSON.stringify({ focused: state?.focused }));
    if (tv) await page.keyboard.press('Enter');
    else await page.locator('.jfmod-removeChoice[data-choice="cancel"]').click();
    await waitClosed();
    const where = await page.evaluate(() => location.hash);
    const after = (await queueRows()).map(row => row.id).sort().join();
    record(step, 'it closes on the Queue page; nothing was removed and no removal was sent', where.startsWith('#/catalog/queue') && before === after && removals.length === 0,
        JSON.stringify({ hash: where, removals }));
}

async function openersStep() {
    const step = `openers ${tag}`;
    const rows = await queueRows();
    // The pending entry's X on a Replace.
    const replace = rows.find(row => row.mode === 'replace' && row.state === 'downloading');
    if (replace) {
        await page.evaluate(([id, server]) => { location.hash = `#/details?id=${id}&serverId=${server}`; }, [replace.entry.jellyfinItemId, serverId]);
        const x = page.locator(`[data-jfmod-pending-remove="${replace.id}"]`);
        await x.waitFor({ state: 'visible', timeout: 30000 });
        await x.click();
        await waitDialog();
        const state = await dialogState();
        checkPlan(step, 'pending Replace', state, expected(replace));
        record(step, 'pending Replace: says what stays', state.notes.some(note => / file stays\.$/.test(note)), JSON.stringify(state.notes));
        const safe = state.choices.find(choice => choice.id === 'cancel');
        record(step, 'pending Replace: the safe choice is grey as the dialog opens', safe?.background === state.colours.grey, safe?.background);
        await shot(page, 'opener-pending-replace');
        await page.locator('.jfmod-removeChoice[data-choice="cancel"]').click();
        await waitClosed();
        const focus = await active();
        record(step, 'pending Replace: Keep Downloading returns focus to the X', focus.pending === replace.id, JSON.stringify(focus));
    } else {
        record(step, 'pending Replace: a downloading Replace exists', false, 'none in the queue');
    }
    // The episode page's Cancel Download on the pack.
    const pack = rows.find(row => row.pack && row.state === 'downloading');
    if (pack) {
        const waiting = pack.pack.episodes.find(episode => episode.importState === 'waiting');
        await page.evaluate(([entry, server, season, episode]) => {
            location.hash = `#/details?entryId=${entry}&serverId=${server}&season=${season}&episode=${episode}`;
        }, [pack.entry.id, serverId, waiting.seasonNumber, waiting.episodeNumber]);
        const cancel = page.locator('.jfmod-dlblock-cancel');
        await cancel.waitFor({ state: 'visible', timeout: 30000 });
        await cancel.click();
        await waitDialog();
        const state = await dialogState();
        checkPlan(step, 'episode page Cancel Download (pack)', state, expected(pack));
        await shot(page, 'opener-episode-cancel');
        await page.locator('.jfmod-removeChoice[data-choice="cancel"]').click();
        await waitClosed();
        const focus = await active();
        record(step, 'episode page: Keep Downloading returns focus to Cancel Download', focus.cls.includes('jfmod-dlblock-cancel'), JSON.stringify(focus));
    }
    // The picker's added-row X on a missing movie.
    const entries = (await api(page, 'GET', '/JellyfinMod/Entries?limit=200')).body.items;
    const res = entries.find(entry => entry.tmdbId === 624860);
    const item = (await api(page, 'GET', '/Items?recursive=true&searchTerm=Resurrections&includeItemTypes=Movie')).body.Items[0];
    if (res && item && DOWNLOADS && STANDIN_LOG) {
        await page.evaluate(([id, server]) => { location.hash = `#/details?id=${id}&serverId=${server}`; }, [item.Id, serverId]);
        const get = page.locator('.jfmod-getRelease:visible').first();
        await get.waitFor({ state: 'visible', timeout: 30000 });
        await get.click();
        const add = page.locator('.jfmod-releaseRow').filter({ hasText: 'QRS' }).first().locator('xpath=..').locator('.jfmod-releaseAction--add');
        const row = page.locator('.jfmod-releaseRow').filter({ hasText: 'QRS' }).first();
        await row.waitFor({ state: 'visible', timeout: 60000 });
        await (await add.count() ? add : row).click();
        const x = page.locator('.jfmod-releaseAction--x[aria-label^="Remove "]');
        await x.waitFor({ state: 'visible', timeout: 60000 });
        await page.waitForFunction(() => {
            const button = document.querySelector('.jfmod-releaseAction--x[aria-label^="Remove "]');
            return button && button.getAttribute('aria-disabled') !== 'true' && !button.disabled;
        }, undefined, { timeout: 60000 });
        await x.click();
        await waitDialog();
        const state = await dialogState();
        const data = (await queueRows()).find(entryRow => entryRow.entry?.id === res.id);
        checkPlan(step, 'picker X', state, expected(data));
        await shot(page, 'opener-picker-x');
        await page.locator('.jfmod-removeChoice[data-choice="cancel"]').click();
        await waitClosed();
        const focus = await active();
        record(step, 'picker X: Keep Downloading returns focus to the X', focus.label.startsWith('Remove ') && focus.cls.includes('jfmod-releaseAction--x'), JSON.stringify(focus));
        // The X once more, and Delete the Download: the row, the torrent and its files go (Codex review P2 2). The stand-in
        // writes a file only when it completes, so the half-downloaded file is written here where the client keeps it.
        const torrent = (await (await fetch(CONTROL + '/state')).json()).torrents.find(candidate => candidate.name.includes('QRS'));
        const files = (torrent?.files ?? []).map(file => join(DOWNLOADS, torrent.downloadDir.replace(/^\/downloads/, ''), file.name));
        for (const file of files) {
            mkdirSync(dirname(file), { recursive: true });
            writeFileSync(file, Buffer.alloc(1048576, 7));
        }
        const before = files.map(file => existsSync(file));
        const logBefore = readFileSync(STANDIN_LOG, 'utf8').length;
        record(step, 'picker X: the download\'s files are on disk before the delete', files.length > 0 && before.every(Boolean), JSON.stringify(files));
        await x.click();
        await waitDialog();
        await page.locator('.jfmod-removeChoice[data-choice="delete"]').click();
        await waitClosed();
        await page.waitForTimeout(2000);
        const left = (await queueRows()).some(entryRow => entryRow.entry?.id === res.id);
        const torrents = (await (await fetch(CONTROL + '/state')).json()).torrents.filter(candidate => candidate.name.includes('QRS'));
        const removedLine = readFileSync(STANDIN_LOG, 'utf8').slice(logBefore).split('\n').find(line => line.includes(`transmission removed ${torrent?.hashString}`)) ?? '';
        record(step, 'picker X: Delete the Download removes the row, the torrent with delete-local-data, and its files',
            !left && torrents.length === 0 && removedLine.endsWith('with data') && files.every(file => !existsSync(file)),
            JSON.stringify({ left, torrents: torrents.map(candidate => candidate.name), removedLine, filesLeft: files.filter(file => existsSync(file)) }));
    }
}

/**
 * A pack episode blocked after its link (binding_not_observed keeps the library hardlink) counts as in the library (Codex
 * re-review P3). The plugin's binding observer completes such an import within seconds once Jellyfin has the file, so the state
 * cannot be held on a live environment: this step rewrites only the Queue read the page receives, turning the Adolescence pack's
 * second imported episode into `blocked` / `binding_not_observed`, and reads the dialog's words. A rendering check, not
 * evidence of server behaviour.
 */
async function postLinkStep() {
    const step = `postlink ${tag}`;
    await page.route(/\/JellyfinMod\/Queue(\?.*)?$/, async route => {
        if (route.request().method() !== 'GET') return route.continue();
        const response = await route.fetch();
        const body = await response.json();
        for (const row of body.items) {
            const done = row.pack?.episodes.filter(episode => episode.importState === 'completed') ?? [];
            if (row.releaseTitle.startsWith('Adolescence.S01') && done.length >= 2) Object.assign(done[1], { importState: 'blocked', reason: 'binding_not_observed' });
        }
        return route.fulfill({ response, json: body });
    });
    await page.evaluate(() => { location.hash = '#/catalog/queue'; });
    await page.locator('.jfmod-queue').waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(2000);
    const row = page.locator('.jfmod-queueTableRow').filter({ hasText: 'Adolescence.S01' }).first();
    await row.locator('.jfmod-queueMenu').click();
    await page.locator('.jfmod-queueMenuItem[data-id="remove"]').click();
    await waitDialog();
    const state = await dialogState();
    record(step, 'a pack episode blocked after its link (binding_not_observed) counts as in the library: "2 of 4"',
        state.facts.some(fact => fact.startsWith('2 of 4 episodes are in your library')), JSON.stringify(state.facts));
    await shot(page, 'postlink-pack');
    await page.locator('.jfmod-removeChoice[data-choice="cancel"]').click();
    await waitClosed();
    await page.unroute(/\/JellyfinMod\/Queue(\?.*)?$/);
}

async function addStep() {
    const step = `refused ${tag}`;
    // A blocked Add whose file has a second name: the refused delete asks again, and focus lands back on the X.
    const add = (await queueRows()).find(row => row.grabId === process.env.JELLYFINMOD_QR_ADD);
    record(step, 'pending Add: the blocked Add is in the queue', !!add, process.env.JELLYFINMOD_QR_ADD ?? 'JELLYFINMOD_QR_ADD not set');
    if (add) {
        await page.evaluate(([id, server]) => { location.hash = `#/details?id=${id}&serverId=${server}`; }, [add.entry.jellyfinItemId, serverId]);
        await page.reload({ waitUntil: 'domcontentloaded' });
        const x = page.locator(`[data-jfmod-pending-remove="${add.id}"]`);
        await x.waitFor({ state: 'visible', timeout: 30000 });
        await x.click();
        await waitDialog();
        const first = await dialogState();
        checkPlan(step, 'pending Add (blocked)', first, expected(add));
        await shot(page, 'opener-pending-add');
        await page.locator('.jfmod-removeChoice[data-choice="delete"]').click();
        await page.waitForFunction(() => [...document.querySelectorAll('.jfmod-removeNote')].some(note => note.textContent.includes('linked elsewhere')), undefined, { timeout: 15000 });
        await page.waitForTimeout(500);
        const again = await dialogState();
        record(step, 'pending Add: the refused delete asks again without it, with the plugin\'s sentence, the safe choice focused',
            again.choices.every(choice => choice.id !== 'delete') && again.focused === 'cancel', JSON.stringify(again));
        await shot(page, 'opener-pending-add-refused');
        await page.locator('.jfmod-removeChoice[data-choice="cancel"]').click();
        await waitClosed();
        const focus = await active();
        const disabled = await x.getAttribute('aria-disabled');
        record(step, 'pending Add: after the refusal, Cancel returns focus to the X, enabled', focus.pending === add.id && disabled !== 'true', JSON.stringify({ focus, disabled }));
        record(step, 'pending Add: still in the queue', (await queueRows()).some(row => row.id === add.id), '');
    }
}

try {
    if (steps.includes('dialog')) await dialogStep();
    if (steps.includes('double')) await doubleStep();
    if (steps.includes('openers')) await openersStep();
    if (steps.includes('refused')) await addStep();
    if (steps.includes('postlink')) await postLinkStep();
} catch (error) {
    record(`run ${tag}`, 'completed', false, String(error?.message ?? error).split('\n')[0]);
    await shot(page, 'error');
}
record(`run ${tag}`, 'no page errors', page.jfmodErrors.length === 0, page.jfmodErrors.join(' | '));
const failed = results.some(result => result.verdict !== 'PASS');
saveResults(`queue-remove-dialog-${layout}-${theme}`, browser.version());
await browser.close();
process.exit(failed ? 1 : 0);
/* eslint-enable compat/compat, no-restricted-globals, sonarjs/cognitive-complexity, @stylistic/max-statements-per-line */
