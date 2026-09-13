// Runs against the built app and real isolated server; no synthetic API responses.
// Node 22+ and a dedicated Chrome profile with remote debugging enabled are required.
const testUrl = new URL(process.env.JELLYFINMOD_TEST_URL);
if (testUrl.port !== '18096') throw new Error('Only the isolated test instance on port 18096 is allowed');
const base = process.env.JELLYFINMOD_CDP_URL ?? 'http://127.0.0.1:9223';
const server = new URL('/web/', testUrl).href;
const entryId = process.env.JELLYFINMOD_NATIVE_ENTRY_ID;
if (!entryId) throw new Error('Set JELLYFINMOD_NATIVE_ENTRY_ID to a bound series entry with native seasons');

const page = await (await fetch(`${base}/json/new?${encodeURIComponent(server)}`, { method: 'PUT' })).json();

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
});

let sequence = 0;
const pending = new Map();
const browserErrors = [];
ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') browserErrors.push(message.params.exceptionDetails.text);
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
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const navigate = async url => {
    await send('Page.navigate', { url });
    await wait(5000);
};
const setSearch = async query => {
    await evaluate(`(() => {
        const input = document.querySelector('#searchPage input[type="search"], #searchPage .searchField');
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
let originalLayout;
const checks = [];
try {
    await navigate(server);
    if (await evaluate(`!!document.querySelector('#txtManualName')`)) {
        await evaluate(`(() => {
            const input = document.querySelector('#txtManualName');
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            setter.call(input, 'oleksii');
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            Array.from(document.querySelectorAll('button')).find(button => button.textContent.includes('Sign In'))?.click();
        })()`);
        await wait(5000);
    }
    if (await evaluate(`location.hash.includes('/login') || location.hash.includes('/selectuser')`)) {
        throw new Error('Sign into the dedicated test browser as oleksii with an empty password, then rerun');
    }
    originalLayout = await evaluate(`localStorage.getItem('layout')`);
    for (const [layout, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844], ['tv', 1920, 1080], ['tv', 1280, 720]]) {
        await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: layout === 'mobile' });
        await evaluate(`localStorage.setItem('layout', ${JSON.stringify(layout)})`);
        await navigate(server + '#/details?entryId=' + encodeURIComponent(entryId));
        const native = await evaluate(`({
            nativeRoute: location.hash.includes('id=') && !location.hash.includes('entryId='),
            seasons: !!document.querySelector('#itemDetailPage:not(.hide) #childrenCollapsible:not(.hide) .card, #itemDetailPage:not(.hide) #childrenCollapsible:not(.hide) .listItem'),
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
    }
    await evaluate(`localStorage.setItem('layout', 'tv')`);
    await navigate(server + '#/search?query=' + encodeURIComponent(process.env.JELLYFINMOD_SEARCH_QUERY ?? 'blade'));
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
    await send('Network.setBlockedURLs', { urls: ['*/JellyfinMod/Entries'] });
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await wait(3000);
    const focused = await evaluate(`document.activeElement?.getAttribute('data-jfmod-add')`);
    if (focused !== identity) throw new Error('Failed add did not return focus to its Add button');
    checks.push({ failedAddFocus: 'passed' });
    await send('Network.setBlockedURLs', { urls: [] });
    await setSearch('jfmod-no-results-' + Date.now());
    const empty = await snapshot();
    if (empty.cards.length) throw new Error('Prior search cards leaked into the new query');
    checks.push({ searchScope: 'passed' });
    if (browserErrors.length) throw new Error('Browser threw ' + browserErrors.length + ' uncaught exceptions');
    console.log(JSON.stringify({ checks, physicalTv: 'not tested',
        remaining: ['successful in-flight add across scopes', 'empty first discovery page continuation', 'Home library exclusion and provider deduplication'] }, null, 2));
} finally {
    await send('Network.setBlockedURLs', { urls: [] });
    if (originalLayout !== undefined) {
        await evaluate(originalLayout === null ? `localStorage.removeItem('layout')` : `localStorage.setItem('layout', ${JSON.stringify(originalLayout)})`);
    }
    await send('Emulation.clearDeviceMetricsOverride');
    ws.close();
    await fetch(`${base}/json/close/${page.id}`);
}
