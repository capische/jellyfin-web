/* eslint-disable compat/compat -- a Node check of the runner, not shipped code */
// Phase 9 (R8): the browser runner's settings-area Save check (web review round 6, finding 2), run in a real Chromium against a
// local page and a local stand-in for the ratings settings endpoint: no instance, no test host. The page's own request must
// carry the run's revision and is then forwarded unchanged; anything else is refused before it reaches the server.
//
//   node p9-saves-check.mjs [results.json]
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { savesChain } from './p9-saves.mjs';

const folder = mkdtempSync(join(tmpdir(), 'p9-saves-'));
const stateFile = join(folder, 'state.json');
writeFileSync(stateFile, JSON.stringify({ lastRevision: 4 }), { mode: 0o600 });
const received = [];
let conflict = false;
const server = createServer((request, response) => {
    if (request.method === 'GET') {
        response.writeHead(200, { 'Content-Type': 'text/html' });
        return response.end('<!doctype html><title>save</title>');
    }
    let body = '';
    request.on('data', chunk => {
        body += chunk;
    });
    request.on('end', () => {
        received.push(body);
        const sent = JSON.parse(body);
        response.writeHead(conflict ? 409 : 200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(conflict ? { type: 'revision_conflict' } : { revision: sent.revision + 1, enabled: sent.enabled }));
    });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;

const results = [];
const record = (check, verdict, detail) => {
    results.push({ check, verdict: verdict ? 'PASS' : 'FAIL', detail });
    console.log(`${verdict ? 'PASS' : 'FAIL'} ${check} :: ${JSON.stringify(detail)}`);
};

const { lastRevision, holdSettingsSaves } = savesChain(stateFile);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(base);
await holdSettingsSaves(page);
// What the settings area does on Save: one PATCH with the revision it loaded.
const save = revision => page.evaluate(async payload => {
    try {
        const answer = await fetch('/JellyfinMod/Settings/Ratings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload) });
        return answer.status;
    } catch {
        return 'refused';
    }
}, revision === undefined ? { enabled: true } : { revision, enabled: true });
const sentBody = revision => JSON.stringify(revision === undefined ? { enabled: true } : { revision, enabled: true });

let status = await save(4);
record('A Save carrying the run\'s revision is forwarded exactly as the page made it, and the answer\'s revision is noted',
    status === 200 && received.length === 1 && received[0] === sentBody(4) && lastRevision() === 5 && !page.jfmodNotOurs,
    { status, received, lastRevision: lastRevision() });

status = await save(4);
record('A Save carrying an older revision fails the check and never reaches the server', status === 'refused' && received.length === 1
    && lastRevision() === 5 && /sent revision 4, the run's is 5/.test(page.jfmodNotOurs ?? ''), { status, notOurs: page.jfmodNotOurs });

page.jfmodNotOurs = undefined;
status = await save(undefined);
record('A Save carrying no revision fails the check and never reaches the server', status === 'refused' && received.length === 1
    && /sent revision undefined/.test(page.jfmodNotOurs ?? ''), { status, notOurs: page.jfmodNotOurs });

page.jfmodNotOurs = undefined;
conflict = true;
status = await save(5);
record('A forwarded Save the plugin refuses (409) is not noted and stops the run', status === 409 && received.length === 2
    && received[1] === sentBody(5) && lastRevision() === 5 && /refused \(409\)/.test(page.jfmodNotOurs ?? ''), { status, notOurs: page.jfmodNotOurs });

await browser.close();
server.close();
rmSync(folder, { recursive: true, force: true });
const failed = results.filter(result => result.verdict !== 'PASS');
console.log(`saves check: ${results.length - failed.length} passed, ${failed.length} failed`);
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify({ at: new Date().toISOString(), browser: browser.version(), results }, null, 1) + '\n');
process.exit(failed.length ? 1 : 0);
/* eslint-enable compat/compat */
