// Debug helper for the S11 image runners: signs in as the throwaway administrator and prints scrubbed API answers.
//   node s11-probe.mjs 'GET JellyfinMod/Setup/State' 'GET JellyfinMod/Settings/DownloadClients'
import { api, launch, newPage, scrub, signIn } from './s11-lib.mjs';

const browser = await launch();
try {
    const { page } = await newPage(browser);
    await signIn(page);
    for (const spec of process.argv.slice(2)) {
        const [method, path] = spec.split(' ', 2); const body = spec.split(' ').slice(2).join(' ');
        const answer = await api(page, method, path, body ? JSON.parse(body) : undefined);
        console.log(method, path, answer.status, JSON.stringify(scrub(answer.body)).slice(0, 4000));
    }
} finally {
    await browser.close();
}
