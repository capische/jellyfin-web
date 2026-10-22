/* eslint-disable compat/compat -- a Node helper for the acceptance runners, not shipped code */
// The local pool environment a runner's URL names, proven before a runner deletes, restarts or reads files there: the server
// answers as jellyfinmod-<name>, its container is jellyfinmod-<name> and publishes that very port, and the host folder the runner
// touches is the one Docker mounts at /test-media in that container. So an API delete and a docker exec, rm or file listing can
// never go to two different environments. alpha and beta are the user's comparison environments and are refused.
import { execFileSync } from 'node:child_process';

const DOCKER = process.env.JELLYFINMOD_DOCKER ?? '/usr/local/bin/docker';
const USER_ENVIRONMENTS = new Set(['alpha', 'beta']);

/**
 * Returns `{ name, container, hostMedia, version }` for the environment at `origin`, or throws. `expected` may name the container
 * and host folder the runner was given; each must then be the one proven here.
 */
export async function provenLocalEnvironment(origin, expected = {}) {
    if (!['127.0.0.1', 'localhost'].includes(origin.hostname)) throw new Error(`${origin.host} is not a local environment (loopback only)`);
    const info = await fetch(new URL('/System/Info/Public', origin)).then(response => response.json());
    const name = /^jellyfinmod-([a-z]+)$/.exec(info.ServerName ?? '')?.[1];
    if (!name) throw new Error(`${origin.host} answers as "${info.ServerName}", not as a local pool environment`);
    if (USER_ENVIRONMENTS.has(name)) throw new Error(`${name} is the user's comparison environment; this runner never runs there`);
    const container = `jellyfinmod-${name}`;
    if (expected.container && expected.container !== container) throw new Error(`${origin.host} is ${container}, not ${expected.container}`);
    const [inspect] = JSON.parse(execFileSync(DOCKER, ['inspect', container], { encoding: 'utf8' }));
    const ports = inspect?.NetworkSettings?.Ports?.['8096/tcp'] ?? [];
    if (!ports.some(port => port.HostPort === origin.port)) throw new Error(`${container} does not publish port ${origin.port}`);
    const hostMedia = inspect.Mounts?.find(mount => mount.Destination === '/test-media')?.Source;
    if (!hostMedia) throw new Error(`${container} mounts nothing at /test-media`);
    if (expected.hostMedia && expected.hostMedia.replace(/\/+$/, '') !== hostMedia) {
        throw new Error(`${container} mounts ${hostMedia} at /test-media, not ${expected.hostMedia}`);
    }
    return { name, container, hostMedia, version: info.Version };
}
