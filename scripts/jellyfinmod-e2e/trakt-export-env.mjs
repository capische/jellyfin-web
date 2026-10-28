/* eslint-disable compat/compat -- a Node test boundary, not shipped code */
// Phase 13 runners: the one environment they may touch, proven before anything signs in (Codex review P2-4, 2026-10-28).
// From the environment's name only (P13_ENV, default echo) it derives the address, the stand-in's control port and the
// restart target, and refuses unless all of these hold:
//   - the name is in envs/pool.list and its port is none of 8096, 18096, 28096, 48096;
//   - the container jellyfinmod-<name> runs and publishes 8096 on 127.0.0.1:<that port> only;
//   - the server at that address calls itself jellyfinmod-<name>;
//   - the environment was started with JFMOD_TRAKT=1, its forwarder jellyfinmod-<name>-trakt-tls runs on the same network
//     under the alias api.trakt.tv and points at the stand-in's port, and inside the Jellyfin container api.trakt.tv
//     resolves to that forwarder and SSL_CERT_FILE is the stand-in bundle, so no request can reach the real Trakt;
//   - the stand-in's control port answers;
//   - the environment's lease is held by P13_OWNER (default "Phase 13 Trakt").
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const workspace = new URL('../../../', import.meta.url).pathname;
const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const refuse = why => {
    throw new Error(`refusing to run: ${why}`);
};

export async function verifiedEnv() {
    const name = process.env.P13_ENV ?? 'echo';
    const owner = process.env.P13_OWNER ?? 'Phase 13 Trakt';
    const pool = readFileSync(join(workspace, 'envs/pool.list'), 'utf8').split('\n').map(line => line.trim())
        .filter(line => line && !line.startsWith('#')).map(line => line.split(/\s+/));
    const entry = pool.find(([candidate]) => candidate === name);
    if (!entry) refuse(`${name} is not in envs/pool.list`);
    const port = Number(entry[1]);
    if ([8096, 18096, 28096, 48096].includes(port)) refuse(`${name} uses port ${port}, which these runners never touch`);
    const container = `jellyfinmod-${name}`;

    const inspect = JSON.parse(run('docker', ['inspect', container]))[0];
    if (!inspect?.State?.Running) refuse(`${container} is not running`);
    const bindings = inspect.HostConfig?.PortBindings?.['8096/tcp'] ?? [];
    if (bindings.length !== 1 || bindings[0].HostIp !== '127.0.0.1' || Number(bindings[0].HostPort) !== port) {
        refuse(`${container} does not publish 8096 on 127.0.0.1:${port} only`);
    }
    const origin = `http://127.0.0.1:${port}`;
    const info = await (await fetch(`${origin}/System/Info/Public`)).json();
    if (info.ServerName !== container) refuse(`the server at ${origin} is ${info.ServerName}, not ${container}`);

    if (readFileSync(join(workspace, 'envs/pool', name, '.trakt'), 'utf8').trim() !== '1') refuse(`${name} was not started with JFMOD_TRAKT=1`);
    const forwarder = JSON.parse(run('docker', ['inspect', `${container}-trakt-tls`]))[0];
    if (!forwarder?.State?.Running) refuse(`${container}-trakt-tls is not running`);
    const standinPort = port + 30000;
    const command = (forwarder.Config?.Cmd ?? []).join(' ');
    if (!command.endsWith(`host.docker.internal ${standinPort}`)) refuse(`the forwarder does not point at the stand-in on ${standinPort}`);
    const networks = Object.entries(forwarder.NetworkSettings?.Networks ?? {})
        .filter(([network, settings]) => inspect.NetworkSettings?.Networks?.[network] && (settings.Aliases ?? []).includes('api.trakt.tv'));
    if (networks.length !== 1) refuse('the forwarder is not api.trakt.tv on the Jellyfin container\'s network');
    const forwarderIp = networks[0][1].IPAddress;
    const resolved = run('docker', ['exec', container, 'getent', 'hosts', 'api.trakt.tv']).split(/\s+/)[0];
    if (!forwarderIp || resolved !== forwarderIp) refuse(`api.trakt.tv resolves to ${resolved} inside ${container}, not to the forwarder ${forwarderIp}`);
    const bundle = run('docker', ['exec', container, 'printenv', 'SSL_CERT_FILE']);
    if (bundle !== '/trakt-standin/ca-bundle.crt') refuse(`${container} does not trust the stand-in bundle`);

    const controlUrl = `http://127.0.0.1:${standinPort + 1}`;
    try {
        await (await fetch(`${controlUrl}/state`)).json();
    } catch {
        refuse(`the stand-in's control port ${standinPort + 1} does not answer; start standins/trakt-export.mjs first`);
    }

    const lease = run(join(workspace, '.claude/scripts/lease.sh'), ['status', name]);
    if (!new RegExp(`^${name} .*: held`, 'm').test(lease) || !lease.includes(`owner ${owner} `)) refuse(`${name}'s lease is not held by "${owner}"`);
    console.log(`environment ${name}: ${origin}, Jellyfin ${info.Version}, api.trakt.tv -> stand-in ${standinPort}, lease ${owner}`);
    return { name, origin, controlUrl, envsBin: join(workspace, 'envs/bin') };
}
