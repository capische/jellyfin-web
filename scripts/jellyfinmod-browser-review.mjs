// Runs against the built app and real isolated server; no synthetic API responses.
// Node 22+ and a dedicated Chrome profile with remote debugging enabled are required.
const testUrl = new URL(process.env.JELLYFINMOD_TEST_URL);
if (testUrl.port !== '18096') throw new Error('Only the isolated test instance on port 18096 is allowed');
const base = process.env.JELLYFINMOD_CDP_URL ?? 'http://127.0.0.1:9223';
const server = new URL('/web/', testUrl).href;
const entryId = process.env.JELLYFINMOD_NATIVE_ENTRY_ID;
if (!entryId) throw new Error('Set JELLYFINMOD_NATIVE_ENTRY_ID to a bound series entry with native seasons');
const libraryId = process.env.JELLYFINMOD_LIBRARY_ID;
if (!libraryId) throw new Error('Set JELLYFINMOD_LIBRARY_ID to the isolated browser-test library');
const retentionEntryTitle = process.env.JELLYFINMOD_RETENTION_ENTRY_TITLE ?? 'JellyfinMod R4 Movie';
const expectedNormalCountdown = process.env.JELLYFINMOD_EXPECT_NORMAL_COUNTDOWN;
const expectedFilteredCountdown = process.env.JELLYFINMOD_EXPECT_FILTER_COUNTDOWN;
const expectedDueCards = Number(process.env.JELLYFINMOD_EXPECT_DUE_CARDS ?? 0);
const testUser = process.env.JELLYFINMOD_TEST_USER ?? 'oleksii';
const expectAdmin = process.env.JELLYFINMOD_EXPECT_ADMIN !== 'false';
const reclaimedEntryId = process.env.JELLYFINMOD_RECLAIMED_ENTRY_ID;
const nativePlaybackItemId = process.env.JELLYFINMOD_NATIVE_PLAYBACK_ITEM_ID;

const page = await (await fetch(`${base}/json/new?${encodeURIComponent(server)}`, { method: 'PUT' })).json();

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
});

let sequence = 0;
const pending = new Map();
const browserErrors = [];
const entryPostRequests = [];
const pausedEntryRequests = [];
const browseRequests = [];
const allRequestUrls = [];
const skippedGates = [];
ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Network.requestWillBeSent') allRequestUrls.push(message.params.request.url);
    if (message.id && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') browserErrors.push(
        message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text
    );
    if (message.method === 'Network.requestWillBeSent' && message.params.request.method === 'POST'
        && new URL(message.params.request.url).pathname === '/JellyfinMod/Entries') entryPostRequests.push(message.params.requestId);
    if (message.method === 'Network.requestWillBeSent' && message.params.request.method === 'POST'
        && new URL(message.params.request.url).pathname === '/JellyfinMod/Browse') browseRequests.push(message.params.request.postData);
    if (message.method === 'Fetch.requestPaused' && message.params.request.method === 'POST'
        && new URL(message.params.request.url).pathname === '/JellyfinMod/Entries') pausedEntryRequests.push(message.params);
});

const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
};
const apiRequest = async (path, method = 'GET', body) => evaluate(`(async () => {
    const options = { url: ApiClient.getUrl(${JSON.stringify(path)}), type: ${JSON.stringify(method)} };
    if (${JSON.stringify(body)} !== undefined) {
        options.data = JSON.stringify(${JSON.stringify(body)});
        options.contentType = 'application/json';
    }
    const response = await ApiClient.ajax(options, true);
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
})()`);
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const keyCodes = { ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, Enter: 13, Tab: 9, Escape: 27 };
/** A trusted key press, as a remote or keyboard produces it; synthetic DOM events miss native activation. */
const pressKey = async key => {
    const code = keyCodes[key];
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
    if (key === 'Enter') await send('Input.dispatchKeyEvent', { type: 'char', key, code: key, text: '\r', windowsVirtualKeyCode: code });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
    await wait(250);
};
/** Controls that a screen reader could not name through text, aria-label or title. */
const unnamedControls = scope => evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(scope)}))
    .filter(node => node.offsetParent !== null)
    .filter(node => !node.textContent.trim() && !node.getAttribute('aria-label') && !node.getAttribute('title'))
    .map(node => node.outerHTML.slice(0, 120))`);
const clickFocused = async () => {
    const activated = await evaluate(`(() => {
        const control = document.activeElement;
        if (!(control instanceof HTMLElement)) return false;
        control.click();
        return true;
    })()`);
    if (!activated) throw new Error('No focused control was available for activation');
};
const navigate = async url => {
    await send('Page.navigate', { url });
    await wait(5000);
};
const setSearch = async query => {
    await evaluate(`(() => {
        const input = document.querySelector('#searchTextInput');
        if (!(input instanceof HTMLInputElement)) throw new Error('Search input is unavailable');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, ${JSON.stringify(query)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await wait(5000);
};
const snapshot = () => evaluate(`(() => ({
    headings: Array.from(document.querySelectorAll('#searchPage .sectionTitle')).map(node => node.textContent.trim()),
    cards: Array.from(document.querySelectorAll('#searchPage .card')).map(node => node.getAttribute('aria-label') || node.textContent.trim()).filter(Boolean).slice(0, 30),
    notice: document.querySelector('.jfmod-searchNotice')?.textContent.trim() ?? null,
    discovery: !!document.querySelector('.jfmod-discovery'),
    addButtons: document.querySelectorAll('.jfmod-discoveryCard button:not(:disabled)').length,
    librarySelectors: document.querySelectorAll('.jfmod-discovery select').length,
    active: document.activeElement ? {
        tag: document.activeElement.tagName,
        aria: document.activeElement.getAttribute('aria-label'),
        id: document.activeElement.id,
        classes: document.activeElement.className
    } : null
}))()`);

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
// A headless or background page gets no focus events otherwise, and TV center-focus depends on them.
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
let originalLayout;
const checks = [];
const createdEntryIds = [];
let originalUserConfiguration;
let originalUserId;
try {
    await navigate(server);
    if (await evaluate(`!!document.querySelector('#txtManualName')`)) {
        await evaluate(`(() => {
            const input = document.querySelector('#txtManualName');
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            setter.call(input, ${JSON.stringify(testUser)});
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            Array.from(document.querySelectorAll('button')).find(button => button.textContent.includes('Sign In'))?.click();
        })()`);
        await wait(5000);
    }
    if (await evaluate(`location.hash.includes('/login') || location.hash.includes('/selectuser')`)) {
        throw new Error('Sign into the dedicated test browser as ' + testUser + ' with an empty password, then rerun');
    }
    await evaluate(`Promise.all([
        navigator.serviceWorker?.getRegistrations().then(registrations => Promise.all(registrations.map(registration => registration.unregister()))) ?? Promise.resolve(),
        window.caches?.keys().then(keys => Promise.all(keys.map(key => window.caches.delete(key)))) ?? Promise.resolve(),
        new Promise((resolve, reject) => {
            const request = indexedDB.open('keyval-store');
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                const database = request.result;
                if (!database.objectStoreNames.contains('keyval')) {
                    database.close();
                    resolve();
                    return;
                }
                const transaction = database.transaction('keyval', 'readwrite');
                transaction.objectStore('keyval').delete('jellyfin-query-cache');
                transaction.oncomplete = () => { database.close(); resolve(); };
                transaction.onerror = () => reject(transaction.error);
            };
        })
    ])`);
    await send('Page.reload', { ignoreCache: true });
    await wait(5000);
    originalLayout = await evaluate(`localStorage.getItem('layout')`);
    await evaluate(`localStorage.setItem('layout', 'desktop')`);
    await navigate(server + '#/movies?topParentId=' + encodeURIComponent(libraryId) + '&collectionType=movies');
    if (expectedNormalCountdown) {
        const normalCountdown = await evaluate(`(() => {
            const card = Array.from(document.querySelectorAll('.jfmod-entryCard')).find(candidate =>
                candidate.offsetParent !== null && candidate.getAttribute('aria-label') === ${JSON.stringify(retentionEntryTitle)});
            return card?.querySelector('.jfmod-countdown')?.textContent.trim() ?? null;
        })()`);
        const expected = expectedNormalCountdown === 'none' ? null : expectedNormalCountdown;
        if (normalCountdown !== expected) {
            throw new Error('Normal library countdown mismatch: ' + JSON.stringify({ expected, actual: normalCountdown }));
        }
    }
    const filterOpened = await evaluate(`(() => {
        const button = Array.from(document.querySelectorAll('button')).find(candidate =>
            candidate.offsetParent !== null
            && (candidate.getAttribute('aria-label') === 'Filter' || candidate.getAttribute('title') === 'Filter'));
        button?.click();
        return !!button;
    })()`);
    if (!filterOpened) throw new Error('Library filter button is unavailable');
    await wait(500);
    const fileFilterState = await evaluate(`(() => {
        const button = Array.from(document.querySelectorAll('button')).find(candidate =>
            candidate.offsetParent !== null && candidate.textContent.trim() === 'File');
        button?.click();
        return {
            opened: !!button,
            cards: document.querySelectorAll('.jfmod-entryCard').length,
            filterHeadings: Array.from(document.querySelectorAll('[role="presentation"] h3')).map(candidate => candidate.textContent.trim())
        };
    })()`);
    if (!fileFilterState.opened) {
        throw new Error('File filter group is unavailable after the combined browse response: ' + JSON.stringify(fileFilterState));
    }
    await wait(500);
    const dueSelected = await evaluate(`(() => {
        const label = Array.from(document.querySelectorAll('label')).find(candidate => candidate.textContent.includes('Due within 7 days'));
        const input = label?.querySelector('input[type="checkbox"]');
        // Set, not toggle: an interrupted earlier run can leave the filter persisted as checked.
        if (input && !input.checked) input.click();
        return !!input;
    })()`);
    if (!dueSelected) throw new Error('Due within 7 days filter is unavailable');
    await wait(3000);
    const dueResult = await evaluate(`({
        dueChecked: Array.from(document.querySelectorAll('label')).find(candidate => candidate.textContent.includes('Due within 7 days'))?.querySelector('input[type="checkbox"]')?.checked ?? false,
        cards: Array.from(document.querySelectorAll('.jfmod-entryCard')).filter(candidate => candidate.offsetParent !== null).length,
        countdowns: Array.from(document.querySelectorAll('.jfmod-entryCard')).filter(candidate => candidate.offsetParent !== null)
            .map(candidate => candidate.querySelector('.jfmod-countdown')?.textContent.trim()).filter(Boolean)
    })`);
    if (!dueResult.dueChecked || dueResult.cards !== expectedDueCards
        || expectedFilteredCountdown && !dueResult.countdowns.includes(expectedFilteredCountdown)) {
        throw new Error('Due filter did not render the expected eligible set: ' + JSON.stringify(dueResult));
    }
    await evaluate(`Array.from(document.querySelectorAll('label')).find(candidate => candidate.textContent.includes('Due within 7 days'))?.querySelector('input[type="checkbox"]')?.click()`);
    await wait(3000);
    if (!await evaluate(`Array.from(document.querySelectorAll('.jfmod-entryCard')).some(candidate => candidate.offsetParent !== null)`)) {
        throw new Error('Clearing the Due filter did not restore the isolated library');
    }
    checks.push({ dueFilter: 'passed', eligibleSet: 'passed' });
    if (!expectedNormalCountdown) skippedGates.push('normal-library countdown (JELLYFINMOD_EXPECT_NORMAL_COUNTDOWN)');
    if (!expectedFilteredCountdown) skippedGates.push('filtered countdown (JELLYFINMOD_EXPECT_FILTER_COUNTDOWN)');
    if (!reclaimedEntryId) skippedGates.push('reclaimed details without playback (JELLYFINMOD_RECLAIMED_ENTRY_ID)');
    if (!nativePlaybackItemId) skippedGates.push('native playback action (JELLYFINMOD_NATIVE_PLAYBACK_ITEM_ID)');
    if (reclaimedEntryId) {
        await navigate(server + '#/details?entryId=' + encodeURIComponent(reclaimedEntryId));
        const reclaimed = await evaluate(`(() => {
            const root = document.querySelector('.jfmod-entryDetailsRoot');
            const playback = Array.from(root?.querySelectorAll('button, a') ?? []).some(candidate =>
                candidate.offsetParent !== null && /^(play|resume|continue)/i.test(candidate.textContent.trim()));
            return { filelessRoot: !!root, playback };
        })()`);
        if (!reclaimed.filelessRoot || reclaimed.playback) {
            throw new Error('Reclaimed details exposed a dead playback action: ' + JSON.stringify(reclaimed));
        }
        checks.push({ reclaimedPlayback: 'absent' });
    }
    if (nativePlaybackItemId) {
        await navigate(server + '#/details?id=' + encodeURIComponent(nativePlaybackItemId));
        const nativePlayback = await evaluate(`(() => {
            const controls = Array.from(document.querySelectorAll('#itemDetailPage:not(.hide) button, #itemDetailPage:not(.hide) a'))
                .filter(candidate => candidate.offsetParent !== null)
                .map(candidate => ({ text: candidate.textContent.trim(), title: candidate.getAttribute('title'), aria: candidate.getAttribute('aria-label'), classes: candidate.className }));
            return {
                present: controls.some(candidate => /^(play|resume|continue)/i.test(candidate.text)
                    || /^(play|resume|continue)/i.test(candidate.title ?? '') || /^(play|resume|continue)/i.test(candidate.aria ?? '')),
                controls
            };
        })()`);
        if (!nativePlayback.present) throw new Error('Native movie lost its playback action: ' + JSON.stringify(nativePlayback.controls));
        checks.push({ nativePlayback: 'present' });
    }
    for (const [layout, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844], ['tv', 1920, 1080], ['tv', 1280, 720]]) {
        await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: layout === 'mobile' });
        await evaluate(`localStorage.setItem('layout', ${JSON.stringify(layout)})`);
        await navigate(server + '#/details?entryId=' + encodeURIComponent(entryId));
        const native = await evaluate(`({
            nativeRoute: location.hash.includes('id=') && !location.hash.includes('entryId='),
            seasons: Array.from(document.querySelectorAll('#itemDetailPage:not(.hide) .sectionTitle')).some(title =>
                title.textContent.trim() === 'Seasons' && !!title.parentElement?.querySelector('.card, .listItem')),
            history: !!document.querySelector('#itemDetailPage:not(.hide) .jfmod-nativeEntryDetails .jfmod-entryHistory'),
            filelessRoot: !!document.querySelector('#itemDetailPage:not(.hide) .jfmod-entryDetailsRoot')
        })`);
        if (!native.nativeRoute || !native.seasons || !native.history || native.filelessRoot) {
            throw new Error('Bound series lost native details in ' + layout + ': ' + JSON.stringify(native));
        }
        await evaluate(`document.querySelector('#itemDetailPage:not(.hide) .btnMoreCommands:not(.hide)')?.click()`);
        await wait(1000);
        const menuHasSearch = await evaluate(`Array.from(document.querySelectorAll('[data-id="jfmod-search-releases"]')).some(node => node.textContent.includes('Search releases'))`);
        if (!menuHasSearch) throw new Error('Search releases missing from native More menu in ' + layout);
        checks.push({ layout, width, height, nativeDetails: 'passed' });
        await pressKey('Escape');
        await send('Page.reload', { ignoreCache: false });
        await wait(5000);
        const unnamed = await unnamedControls('#itemDetailPage:not(.hide) .jfmod-nativeEntryDetails button, '
            + '#itemDetailPage:not(.hide) .mainDetailButtons button:not(.hide)');
        if (unnamed.length) throw new Error('Controls without text, aria-label or title in ' + layout + ': ' + JSON.stringify(unnamed));
        const keepSelector = '#itemDetailPage:not(.hide) .jfmod-nativeEntryDetails button[aria-pressed]';
        const hasKeep = await evaluate(`!!document.querySelector(${JSON.stringify(keepSelector)})`);
        if (expectAdmin) {
            if (!hasKeep) throw new Error('Admin Keep action is missing from native details in ' + layout);
            // Reach Keep the way this layout is driven: the D-pad on TV, Tab elsewhere, from the first detail action.
            await evaluate(`document.querySelector('#itemDetailPage:not(.hide) .mainDetailButtons button:not(.hide)')?.focus()`);
            const step = layout === 'tv' ? 'ArrowDown' : 'Tab';
            let reached = false;
            for (let press = 0; press < 40 && !reached; press++) {
                await pressKey(step);
                reached = await evaluate(`document.activeElement?.matches(${JSON.stringify(keepSelector)}) ?? false`);
            }
            if (!reached) throw new Error('Keep is not reachable by ' + step + ' in ' + layout);
            await pressKey('Enter');
            await wait(3000);
            const kept = await evaluate(`({
                focused: document.activeElement?.matches(${JSON.stringify(keepSelector)}) ?? false,
                label: document.activeElement?.textContent.trim() ?? null,
                pressed: document.activeElement?.getAttribute('aria-pressed') ?? null,
                status: document.querySelector('#itemDetailPage:not(.hide) .jfmod-nativeEntryDetails .jfmod-retentionStatus')?.textContent.trim() ?? null
            })`);
            if (!kept.focused || kept.label !== 'Kept' || kept.pressed !== 'true' || kept.status !== 'Kept indefinitely.') {
                throw new Error('Keep by ' + step + ' and Enter did not keep focus and state in ' + layout + ': ' + JSON.stringify(kept));
            }
            checks.push({ layout, width, keepByKeyboard: step + '+Enter', keepFocus: 'passed', retentionStatus: 'passed' });
        } else {
            if (hasKeep) throw new Error('Restricted user can see the admin-only Keep action in ' + layout);
            checks.push({ layout, width, restrictedKeep: 'absent' });
        }
        console.log(`passed native details: ${layout} ${width}x${height}`);
    }
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await evaluate(`localStorage.setItem('layout', 'desktop')`);
    await send('Page.reload', { ignoreCache: true });
    await wait(5000);
    await navigate(server + '#/search?query=' + encodeURIComponent(process.env.JELLYFINMOD_SEARCH_QUERY ?? 'blade'));
    const searchActivated = await evaluate(`(() => {
        if (document.querySelector('#searchPage:not(.hide)')) return true;
        const button = Array.from(document.querySelectorAll('button')).find(candidate => candidate.getAttribute('aria-label') === 'Search');
        button?.click();
        return !!button;
    })()`);
    if (!searchActivated) throw new Error('Search route could not be activated');
    await wait(3000);
    await evaluate(`(() => {
        for (const select of document.querySelectorAll('.jfmod-discovery select')) {
            if (!select.value && select.options.length > 1) {
                select.value = select.options[1].value;
                select.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
    })()`);
    await wait(250);
    const identity = await evaluate(`(() => {
        const button = document.querySelector('[data-jfmod-add]:not(:disabled)');
        button?.focus();
        return button?.dataset.jfmodAdd;
    })()`);
    if (!identity) throw new Error('Fixture query needs an unheld TMDB result and a writable library');
    // Fail the actual HTTP transport. No fake API success or client response is injected.
    const failedRequestStart = entryPostRequests.length;
    const failedPauseStart = pausedEntryRequests.length;
    await send('Fetch.enable', { patterns: [{ urlPattern: '*JellyfinMod/Entries*', requestStage: 'Request' }] });
    await evaluate(`document.querySelector('[data-jfmod-add="${identity}"]')?.focus()`);
    await wait(100);
    if (await evaluate(`document.activeElement?.getAttribute('data-jfmod-add')`) !== identity) {
        throw new Error('TV focus manager moved the failed-add fixture before Enter');
    }
    await clickFocused();
    for (let attempt = 0; attempt < 50 && pausedEntryRequests.length === failedPauseStart; attempt++) await wait(100);
    if (pausedEntryRequests.length !== failedPauseStart + 1) throw new Error('Failed-add fixture did not reach the real HTTP boundary');
    await send('Fetch.failRequest', { requestId: pausedEntryRequests[failedPauseStart].requestId, errorReason: 'Failed' });
    await wait(3000);
    await send('Fetch.disable');
    const focused = await evaluate(`document.activeElement?.getAttribute('data-jfmod-add')`);
    if (entryPostRequests.length !== failedRequestStart + 1 || focused !== identity) throw new Error('Failed add did not send one request and return focus to its Add button: requests='
        + (entryPostRequests.length - failedRequestStart) + ', paused=' + (pausedEntryRequests.length - failedPauseStart)
        + ', focused=' + focused + ', expected=' + identity);
    checks.push({ failedAddFocus: 'passed' });
    console.log('passed failed add focus');

    const successfulAdd = await evaluate(`(() => {
        const button = document.querySelector('[data-jfmod-add]:not(:disabled)');
        if (!button) return null;
        const mediaType = button.dataset.jfmodAdd.split(':')[0];
        const label = mediaType === 'movie' ? 'Movie library' : 'TV library';
        const select = Array.from(document.querySelectorAll('.jfmod-discovery label')).find(node => node.textContent.includes(label))?.querySelector('select');
        return {
            identity: button.dataset.jfmodAdd,
            tmdbId: Number(button.dataset.jfmodAdd.split(':')[1]),
            mediaType,
            title: button.getAttribute('aria-label').replace(/^Add | to catalog$/g, ''),
            targetLibraryId: select?.value
        };
    })()`);
    if (!successfulAdd?.targetLibraryId) throw new Error('Successful-add fixture needs a selected writable library');
    const requestStart = entryPostRequests.length;
    const pausedStart = pausedEntryRequests.length;
    await send('Fetch.enable', { patterns: [{ urlPattern: '*JellyfinMod/Entries*', requestStage: 'Request' }] });
    await evaluate(`document.querySelector('[data-jfmod-add="${successfulAdd.identity}"]')?.focus()`);
    for (let activation = 0; activation < 2; activation++) await clickFocused();
    for (let attempt = 0; attempt < 50 && pausedEntryRequests.length === pausedStart; attempt++) await wait(100);
    if (pausedEntryRequests.length !== pausedStart + 1) throw new Error('Repeated Enter did not produce exactly one paused Add request: paused='
        + (pausedEntryRequests.length - pausedStart) + ', sent=' + (entryPostRequests.length - requestStart));
    const changedQuery = 'jfmod-inflight-' + Date.now();
    await evaluate(`document.querySelector('#searchTextInput')?.focus()`);
    await setSearch(changedQuery);
    const changedBeforeRelease = await snapshot();
    if (changedBeforeRelease.active?.id !== 'searchTextInput') throw new Error('Changing scope lost search input focus before Add completed');
    await send('Fetch.continueRequest', { requestId: pausedEntryRequests[pausedStart].requestId });
    await wait(5000);
    await send('Fetch.disable');
    if (entryPostRequests.length !== requestStart + 1) throw new Error('Repeated Enter sent more than one Add request');
    const changedAfterRelease = await evaluate(`({
        query: document.querySelector('#searchTextInput')?.value,
        active: document.activeElement?.id,
        oldTitle: !!document.querySelector('[data-jfmod-tmdb-id="${successfulAdd.tmdbId}"]')
    })`);
    if (changedAfterRelease.query !== changedQuery || changedAfterRelease.active !== 'searchTextInput' || changedAfterRelease.oldTitle) {
        throw new Error('Completed Add changed the new search scope: ' + JSON.stringify(changedAfterRelease));
    }
    await setSearch(process.env.JELLYFINMOD_SEARCH_QUERY ?? 'blade');
    const canonicalCount = await evaluate(`document.querySelectorAll('[data-jfmod-tmdb-id="${successfulAdd.tmdbId}"]').length`);
    if (canonicalCount !== 1) throw new Error('Returning to the original search did not show one canonical added title');
    const createdLookup = await apiRequest('JellyfinMod/Entries?mediaType=' + successfulAdd.mediaType
        + '&targetLibraryId=' + encodeURIComponent(successfulAdd.targetLibraryId) + '&limit=200');
    const createdEntry = createdLookup.body.items.find(entry => entry.tmdbId === successfulAdd.tmdbId);
    if (!createdEntry) throw new Error('Successful Add did not persist its canonical entry');
    createdEntryIds.push(createdEntry.id);
    await apiRequest('JellyfinMod/Entries/' + encodeURIComponent(createdEntry.id), 'DELETE');
    createdEntryIds.pop();
    checks.push({ successfulAddScope: 'passed', repeatedActivations: 2, requests: 1 });
    console.log('passed successful in-flight add scope and duplicate activation guard');

    const pagingQuery = process.env.JELLYFINMOD_PAGING_QUERY ?? (process.env.JELLYFINMOD_SEARCH_QUERY ?? 'matrix');
    await setSearch(pagingQuery);
    await evaluate(`(() => {
        for (const select of document.querySelectorAll('.jfmod-discovery select')) {
            if (!select.value && select.options.length > 1) {
                select.value = select.options[1].value;
                select.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
    })()`);
    await wait(500);
    const firstPage = await evaluate(`(() => {
        const buttons = Array.from(document.querySelectorAll('[data-jfmod-add^="movie:"]'));
        const select = Array.from(document.querySelectorAll('.jfmod-discovery label')).find(node => node.textContent.includes('Movie library'))?.querySelector('select');
        return { ids: buttons.map(button => Number(button.dataset.jfmodAdd.split(':')[1])), targetLibraryId: select?.value };
    })()`);
    if (!firstPage.targetLibraryId || firstPage.ids.length < 10) throw new Error('Paging fixture needs a writable movie library and a full discovery page');
    const beforeMore = firstPage.ids.length;
    let moreFocused = false;
    for (let attempt = 0; attempt < 50 && !moreFocused; attempt++) {
        moreFocused = await evaluate(`(() => {
            const button = Array.from(document.querySelectorAll('.jfmod-discovery > button')).find(candidate => candidate.textContent.includes('More movie results'));
            button?.focus();
            return !!button;
        })()`);
        if (!moreFocused) await wait(100);
    }
    if (!moreFocused) throw new Error('The first discovery page did not expose movie continuation');
    await clickFocused();
    for (let attempt = 0; attempt < 30; attempt++) {
        const count = await evaluate(`document.querySelectorAll('[data-jfmod-add^="movie:"]').length`);
        if (count > beforeMore) break;
        await wait(1000);
    }
    const explicitContinuation = await evaluate(`(() => ({
        ids: Array.from(document.querySelectorAll('[data-jfmod-add^="movie:"]')).map(button => Number(button.dataset.jfmodAdd.split(':')[1])),
        active: document.activeElement?.textContent?.trim()
    }))()`);
    if (explicitContinuation.ids.length <= beforeMore || new Set(explicitContinuation.ids).size !== explicitContinuation.ids.length
        || !explicitContinuation.active?.includes('More movie results')) {
        throw new Error('Explicit discovery continuation repeated titles or lost focus: ' + JSON.stringify(explicitContinuation));
    }

    const seedQuery = pagingQuery === pagingQuery.toUpperCase() ? pagingQuery.toLowerCase() : pagingQuery.toUpperCase();
    await navigate(server);
    await navigate(server + '#/search?query=' + encodeURIComponent(seedQuery));
    let seedPage;
    for (let attempt = 0; attempt < 30; attempt++) {
        seedPage = await evaluate(`({
            query: document.querySelector('#searchTextInput')?.value,
            busy: document.querySelector('.jfmod-discovery')?.getAttribute('aria-busy'),
            ids: Array.from(document.querySelectorAll('[data-jfmod-add^="movie:"]')).map(button => Number(button.dataset.jfmodAdd.split(':')[1]))
        })`);
        if (seedPage.query === seedQuery && seedPage.busy === 'false' && seedPage.ids.length >= 10 && seedPage.ids.length <= 20) break;
        await wait(1000);
    }
    const seedIds = seedPage?.ids ?? [];
    if (seedPage?.query !== seedQuery || seedPage.busy !== 'false' || seedIds.length < 10 || seedIds.length > 20) {
        throw new Error('Automatic-page fixture did not settle on one full first page: ' + JSON.stringify(seedPage));
    }
    for (const tmdbId of seedIds) {
        const created = await apiRequest('JellyfinMod/Entries', 'POST', { mediaType: 'movie', tmdbId, targetLibraryId: firstPage.targetLibraryId });
        if (created.body.created) createdEntryIds.push(created.body.entry.id);
    }
    console.log(`seeded ${createdEntryIds.length} reversible held titles for empty-page acceptance`);
    const verificationQuery = seedQuery.slice(0, 1).toLowerCase() + seedQuery.slice(1, 2).toUpperCase() + seedQuery.slice(2).toLowerCase();
    await navigate(server);
    await navigate(server + '#/search?query=' + encodeURIComponent(verificationQuery));
    let continuation;
    for (let attempt = 0; attempt < 30; attempt++) {
        continuation = await evaluate(`(() => ({
            ids: Array.from(document.querySelectorAll('[data-jfmod-add^="movie:"]')).map(button => Number(button.dataset.jfmodAdd.split(':')[1])),
            more: Array.from(document.querySelectorAll('.jfmod-discovery > button')).some(button => button.textContent.includes('More movie results')),
            busy: document.querySelector('.jfmod-discovery')?.getAttribute('aria-busy'),
            notice: document.querySelector('.jfmod-searchNotice')?.textContent?.trim(),
            query: document.querySelector('#searchTextInput')?.value,
            hash: location.hash
        }))()`);
        if (continuation.query === verificationQuery && continuation.ids.length && !continuation.ids.some(id => seedIds.includes(id))) break;
        await wait(1000);
    }
    if (!continuation?.ids.length || continuation.ids.some(id => seedIds.includes(id))) {
        throw new Error('An entirely held first page did not advance automatically to distinct page-two results: ' + JSON.stringify(continuation));
    }
    const continued = { ids: continuation.ids };
    for (const id of createdEntryIds.splice(0)) await apiRequest('JellyfinMod/Entries/' + encodeURIComponent(id), 'DELETE');
    checks.push({ emptyDiscoveryPage: 'passed', automaticPage: 2, explicitContinuation: 'passed' });
    console.log('passed empty first discovery page and focused continuation');

    const homeFixture = await evaluate(`(() => {
        const options = Array.from(document.querySelectorAll('.jfmod-discovery label')).find(node => node.textContent.includes('Movie library'))
            ?.querySelector('select')?.options;
        return { libraries: Array.from(options ?? []).map(option => option.value).filter(Boolean) };
    })()`);
    const userState = await evaluate(`(async () => {
        const user = await ApiClient.getCurrentUser(false);
        return { id: user.Id, configuration: user.Configuration };
    })()`);
    const userViews = await apiRequest('Users/' + encodeURIComponent(userState.id) + '/Views');
    const homeMovieLibraryIds = new Set((userViews.body.Items ?? [])
        .filter(view => view.CollectionType === 'movies').map(view => view.Id));
    const homeLibraries = homeFixture.libraries.filter(id => homeMovieLibraryIds.has(id));
    if (homeLibraries.length < 2 || continued.ids.length < 2) throw new Error('Home acceptance needs two writable movie Home views and two unheld provider titles');
    const [excludedLibraryId, includedLibraryId] = homeLibraries;
    const [duplicateTmdbId, excludedTmdbId] = continued.ids;
    await evaluate(`(() => {
        const select = Array.from(document.querySelectorAll('.jfmod-discovery label')).find(node => node.textContent.includes('Movie library'))?.querySelector('select');
        select.value = ${JSON.stringify(excludedLibraryId)};
        select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    const addFromUi = async tmdbId => {
        const focused = await evaluate(`(() => {
            const button = document.querySelector('[data-jfmod-add="movie:${tmdbId}"]');
            button?.focus();
            return !!button;
        })()`);
        if (!focused) throw new Error('Home UI fixture lost discovery title ' + tmdbId);
        await clickFocused();
        for (let attempt = 0; attempt < 60; attempt++) {
            if (!await evaluate(`!!document.querySelector('[data-jfmod-add="movie:${tmdbId}"]')`)) return;
            await wait(500);
        }
        throw new Error('Home UI fixture add did not complete for ' + tmdbId);
    };
    await addFromUi(duplicateTmdbId);
    await addFromUi(excludedTmdbId);
    let primaryEntries;
    for (let attempt = 0; attempt < 60; attempt++) {
        primaryEntries = await apiRequest('JellyfinMod/Entries?mediaType=movie&targetLibraryId='
            + encodeURIComponent(excludedLibraryId) + '&limit=200');
        if ([duplicateTmdbId, excludedTmdbId].every(tmdbId => primaryEntries.body.items.some(entry => entry.tmdbId === tmdbId))) break;
        await wait(500);
    }
    for (const tmdbId of [duplicateTmdbId, excludedTmdbId]) {
        const entry = primaryEntries?.body.items.find(candidate => candidate.tmdbId === tmdbId);
        if (!entry) throw new Error('UI add did not persist Home fixture ' + tmdbId);
        createdEntryIds.push(entry.id);
    }
    const duplicateTitle = primaryEntries.body.items.find(entry => entry.tmdbId === duplicateTmdbId).title;
    const excludedTitle = primaryEntries.body.items.find(entry => entry.tmdbId === excludedTmdbId).title;
    const duplicateCopy = await apiRequest('JellyfinMod/Entries', 'POST', {
        mediaType: 'movie', tmdbId: duplicateTmdbId, targetLibraryId: includedLibraryId
    });
    if (!duplicateCopy.body.created) throw new Error('Home fixture duplicate copy already existed unexpectedly');
    createdEntryIds.push(duplicateCopy.body.entry.id);
    originalUserId = userState.id;
    originalUserConfiguration = userState.configuration;
    const includedConfiguration = { ...originalUserConfiguration,
        LatestItemsExcludes: (originalUserConfiguration.LatestItemsExcludes ?? [])
            .filter(id => id !== excludedLibraryId && id !== includedLibraryId) };
    const applyHomeConfiguration = async configuration => {
        await evaluate(`ApiClient.updateUserConfiguration(${JSON.stringify(originalUserId)}, ${JSON.stringify(configuration)})`);
        await evaluate(`new Promise((resolve, reject) => {
            const request = indexedDB.open('keyval-store');
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                const database = request.result;
                if (!database.objectStoreNames.contains('keyval')) {
                    database.close();
                    resolve();
                    return;
                }
                const transaction = database.transaction('keyval', 'readwrite');
                transaction.objectStore('keyval').delete('jellyfin-query-cache');
                transaction.oncomplete = () => { database.close(); resolve(); };
                transaction.onerror = () => reject(transaction.error);
            };
        })`);
        await send('Page.reload', { ignoreCache: true });
        await wait(5000);
        await evaluate(`(async () => {
            const user = await ApiClient.getCurrentUser(false);
            user.Configuration = ${JSON.stringify(configuration)};
        })()`);
        await navigate(server + '#/home.html');
    };
    const homeCounts = () => evaluate(`(() => {
        const root = Array.from(document.querySelectorAll('.jfmod-homeRowRoot')).find(node => node.querySelector('.sectionTitle')?.textContent.trim() === 'Recently Added');
        const labels = Array.from(root?.querySelectorAll('[aria-label]') ?? []).map(node => node.getAttribute('aria-label'));
        return {
            duplicate: labels.filter(label => label === ${JSON.stringify(duplicateTitle)}).length,
            excluded: labels.filter(label => label === ${JSON.stringify(excludedTitle)}).length
        };
    })()`);
    const waitForHomeCounts = async (duplicate, excluded) => {
        let result;
        for (let attempt = 0; attempt < 30; attempt++) {
            result = await homeCounts();
            if (result.duplicate === duplicate && result.excluded === excluded) return result;
            await wait(1000);
        }
        return result;
    };
    await applyHomeConfiguration(includedConfiguration);
    let counts = await waitForHomeCounts(1, 1);
    if (counts.duplicate !== 1 || counts.excluded !== 1) {
        const browseRequest = targetLibraryId => ({
            mediaType: 'movie', targetLibraryId, sortBy: ['DateCreated'], sortOrder: 'Descending', startIndex: 0, limit: 24,
            state: [],
            filters: {
                genres: [], years: [], officialRatings: [], tags: [], studioIds: [], status: [], seriesStatus: [],
                features: [], videoBasicFilter: [], videoTypes: [], audioLanguages: [], subtitleLanguages: []
            }
        });
        const browse = await Promise.all([excludedLibraryId, includedLibraryId].map(id => apiRequest('JellyfinMod/Browse', 'POST', browseRequest(id))));
        const home = await evaluate(`Array.from(document.querySelectorAll('.jfmod-homeRowRoot')).map(root => ({
            title: root.querySelector('.sectionTitle')?.textContent.trim(),
            ids: Array.from(root.querySelectorAll('[data-jfmod-tmdb-id]')).map(node => node.getAttribute('data-jfmod-tmdb-id'))
        }))`);
        throw new Error('Recently Added did not deduplicate accessible provider copies: '
            + JSON.stringify({ counts, excludedLibraryId, includedLibraryId,
                browse: browse.map(result => ({ status: result.status, ids: result.body?.items?.map(row => row.entry?.tmdbId) })),
                homeBrowseRequests: browseRequests.slice(-12), home }));
    }
    const excludedConfiguration = { ...includedConfiguration,
        LatestItemsExcludes: [...new Set([...(includedConfiguration.LatestItemsExcludes ?? []), excludedLibraryId])] };
    await applyHomeConfiguration(excludedConfiguration);
    counts = await waitForHomeCounts(1, 0);
    if (counts.duplicate !== 1 || counts.excluded !== 0) {
        const includedBrowse = await apiRequest('JellyfinMod/Browse', 'POST', {
            mediaType: 'movie', targetLibraryId: includedLibraryId, sortBy: ['DateCreated'], sortOrder: 'Descending', startIndex: 0, limit: 24,
            state: [], filters: { genres: [], years: [], officialRatings: [], tags: [], studioIds: [], status: [], seriesStatus: [],
                features: [], videoBasicFilter: [], videoTypes: [], audioLanguages: [], subtitleLanguages: [] }
        });
        const home = await evaluate(`Array.from(document.querySelectorAll('.jfmod-homeRowRoot')).map(root => ({
            title: root.querySelector('.sectionTitle')?.textContent.trim(),
            ids: Array.from(root.querySelectorAll('[data-jfmod-tmdb-id]')).map(node => node.getAttribute('data-jfmod-tmdb-id'))
        }))`);
        throw new Error('Recently Added exposed a title from an excluded library: '
            + JSON.stringify({ counts, duplicateTmdbId, includedLibraryId,
                includedIds: includedBrowse.body.items.map(row => row.entry?.tmdbId),
                homeBrowseRequests: browseRequests.slice(-12), home }));
    }
    await applyHomeConfiguration(includedConfiguration);
    counts = await waitForHomeCounts(1, 1);
    if (counts.duplicate !== 1 || counts.excluded !== 1) throw new Error('Restoring Latest libraries did not restore the excluded catalog title: ' + JSON.stringify(counts));
    await evaluate(`(async () => {
        await ApiClient.updateUserConfiguration(${JSON.stringify(originalUserId)}, ${JSON.stringify(originalUserConfiguration)});
        const user = await ApiClient.getCurrentUser(false);
        user.Configuration = ${JSON.stringify(originalUserConfiguration)};
    })()`);
    originalUserConfiguration = undefined;
    for (const id of createdEntryIds.splice(0)) await apiRequest('JellyfinMod/Entries/' + encodeURIComponent(id), 'DELETE');
    checks.push({ homeLibraryExclusion: 'passed', providerDeduplication: 'passed', accessibleCopies: 2 });
    console.log('passed Home library exclusion and provider deduplication');

    const nativeDetail = await apiRequest('JellyfinMod/Entries/' + encodeURIComponent(entryId));
    const nativeItemId = nativeDetail.body.entry.jellyfinItemId;
    if (!nativeItemId) throw new Error('Plugin outage fixture needs a native binding');
    await evaluate(`new Promise((resolve, reject) => {
        const request = indexedDB.open('keyval-store');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains('keyval')) {
                database.close();
                resolve();
                return;
            }
            const transaction = database.transaction('keyval', 'readwrite');
            transaction.objectStore('keyval').delete('jellyfin-query-cache');
            transaction.oncomplete = () => { database.close(); resolve(); };
            transaction.onerror = () => reject(transaction.error);
        };
    })`);
    await send('Network.setBlockedURLs', { urls: ['*/JellyfinMod/*'] });
    await send('Page.reload', { ignoreCache: true });
    await wait(5000);
    await navigate(server + '#/details?id=' + encodeURIComponent(nativeItemId));
    const nativeWithoutPlugin = await evaluate(`({
        title: document.querySelector('#itemDetailPage:not(.hide) .itemName')?.textContent?.trim(),
        actions: document.querySelectorAll('#itemDetailPage:not(.hide) .mainDetailButtons button:not(.hide)').length,
        pluginDetails: !!document.querySelector('#itemDetailPage:not(.hide) .jfmod-nativeEntryDetails')
    })`);
    if (!nativeWithoutPlugin.title || !nativeWithoutPlugin.actions) {
        throw new Error('Native details did not degrade cleanly while plugin transport was absent: ' + JSON.stringify(nativeWithoutPlugin));
    }
    await navigate(server + '#/search?query=' + encodeURIComponent(nativeDetail.body.entry.title));
    const nativeSearchWithoutPlugin = await evaluate(`({
        sections: Array.from(document.querySelectorAll('#searchPage .sectionTitle')).map(node => node.textContent.trim()),
        cards: document.querySelectorAll('#searchPage .card').length,
        discovery: !!document.querySelector('#searchPage .jfmod-discovery')
    })`);
    if (!nativeSearchWithoutPlugin.cards) {
        throw new Error('Native search did not degrade cleanly while plugin transport was absent: ' + JSON.stringify(nativeSearchWithoutPlugin));
    }
    await send('Network.setBlockedURLs', { urls: [] });
    checks.push({ pluginTransportAbsent: 'passed', nativeDetails: 'usable', nativeSearch: 'usable',
        cachedPluginDetails: nativeWithoutPlugin.pluginDetails, cachedDiscovery: nativeSearchWithoutPlugin.discovery });
    console.log('passed native detail and search degradation without plugin transport');

    // The Home Continue watching row must show when Jellyfin has resumable items for this user.
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await navigate(server + '#/home');
    const resume = await apiRequest('UserItems/Resume?limit=12&mediaTypes=Video');
    const resumeIds = (resume.body?.Items ?? []).map(item => item.Id.replace(/-/g, '').toLowerCase());
    if (!resumeIds.length) {
        skippedGates.push('Home resume row (the test user has no resumable item)');
    } else {
        const row = await evaluate(`(() => {
            const title = Array.from(document.querySelectorAll('.sectionTitle')).find(node => /^continue watching$/i.test(node.textContent.trim()));
            const section = title?.closest('.verticalSection') ?? title?.parentElement?.parentElement;
            return { present: !!title, ids: Array.from(section?.querySelectorAll('.card[data-id]') ?? []).map(card => card.dataset.id.replace(/-/g, '').toLowerCase()) };
        })()`);
        if (!row.present || !row.ids.some(id => resumeIds.includes(id))) {
            throw new Error('Home Continue watching row is missing resumable items: ' + JSON.stringify({ row, resumeIds }));
        }
        checks.push({ homeResumeRow: 'passed', resumable: resumeIds.length, shown: row.ids.length });
    }

    // Catalog entry IDs belong to /JellyfinMod only; a native request carrying one would 404 or leak.
    const entries = await apiRequest('JellyfinMod/Entries?limit=200');
    const entryIds = new Set([...(entries.body?.items ?? []).map(entry => entry.id), ...createdEntryIds]
        .map(id => String(id).replace(/-/g, '').toLowerCase()));
    const leaked = allRequestUrls.filter(url => {
        const parsed = new URL(url, server);
        if (parsed.pathname.includes('/JellyfinMod/') || parsed.host !== new URL(server).host) return false;
        const text = decodeURIComponent(parsed.pathname + parsed.search).replace(/-/g, '').toLowerCase();
        return [...entryIds].some(id => text.includes(id)) || text.includes('pending:');
    });
    if (leaked.length) throw new Error('Native requests carried plugin entry IDs: ' + JSON.stringify(leaked.slice(0, 10)));
    checks.push({ nativeRequestsWithPluginIds: 0, requestsChecked: allRequestUrls.length });
    await navigate(server + '#/search');

    await setSearch('jfmod-no-results-' + Date.now());
    const empty = await snapshot();
    if (empty.cards.length) throw new Error('Prior search cards leaked into the new query');
    checks.push({ searchScope: 'passed' });
    console.log('passed search scope isolation');
    if (browserErrors.length) throw new Error('Browser threw uncaught exceptions: ' + JSON.stringify(browserErrors));
    console.log(JSON.stringify({ checks, skippedGates, physicalTv: 'not tested',
        remaining: ['physical webOS acceptance'] }, null, 2));
    if (skippedGates.length && process.env.JELLYFINMOD_ALLOW_SKIPS !== 'true') {
        console.error('Skipped gates make this run incomplete; set JELLYFINMOD_ALLOW_SKIPS=true only for a partial run.');
        process.exitCode = 2;
    }
} finally {
    await send('Network.setBlockedURLs', { urls: [] });
    await send('Fetch.disable').catch(() => {});
    if (originalUserConfiguration && originalUserId) {
        await evaluate(`ApiClient.updateUserConfiguration(${JSON.stringify(originalUserId)}, ${JSON.stringify(originalUserConfiguration)})`).catch(() => {});
    }
    for (const id of createdEntryIds) await apiRequest('JellyfinMod/Entries/' + encodeURIComponent(id), 'DELETE').catch(() => {});
    if (originalLayout !== undefined) {
        await evaluate(originalLayout === null ? `localStorage.removeItem('layout')` : `localStorage.setItem('layout', ${JSON.stringify(originalLayout)})`);
    }
    await send('Emulation.clearDeviceMetricsOverride');
    ws.close();
    await fetch(`${base}/json/close/${page.id}`);
}
