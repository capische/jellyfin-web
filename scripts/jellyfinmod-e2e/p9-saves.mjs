// Phase 9 (R8): the browser runner's share of the ratings settings chain p9-live.py keeps (web review rounds 5-6). The state
// file holds the revision the run last wrote; each save the run makes is held to it and hands back the revision it produced.
import { readFileSync, writeFileSync } from 'node:fs';

export const savesChain = stateFile => {
    const lastRevision = () => JSON.parse(readFileSync(stateFile, 'utf8')).lastRevision;
    const noteRevision = revision => {
        const state = JSON.parse(readFileSync(stateFile, 'utf8'));
        state.lastRevision = revision;
        writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600 });
    };
    /**
     * The settings area's own Save, checked rather than repaired (review round 6, finding 2): the revision the page itself
     * sends must be the run's — the page loaded the settings the run last wrote, so anything else is the page's revision
     * handling going wrong (or someone else's save) and fails the check without reaching the server. A matching request is
     * sent on exactly as the page made it, and the revision the plugin answers with is handed back to the chain.
     */
    const holdSettingsSaves = async page => {
        page.jfmodSaves = [];
        await page.route('**/JellyfinMod/Settings/Ratings', async route => {
            if (route.request().method() !== 'PATCH') return route.continue();
            const sent = route.request().postDataJSON()?.revision;
            const expected = lastRevision();
            if (sent !== expected) {
                page.jfmodNotOurs = `the settings area sent revision ${sent}, the run's is ${expected}`;
                page.jfmodSaves.push({ sent, expected, forwarded: false });
                return route.abort();
            }
            const response = await route.fetch();
            const answer = await response.json();
            page.jfmodSaves.push({ sent, expected, forwarded: true, status: response.status(), answered: answer?.revision });
            if (response.status() === 200) noteRevision(answer.revision);
            else page.jfmodNotOurs = `a ratings save from the settings area was refused (${response.status()})`;
            return route.fulfill({ response, json: answer });
        });
    };
    return { lastRevision, noteRevision, holdSettingsSaves };
};
