// Moved: the JellyfinMod browser acceptance runner is scripts/jellyfinmod-e2e/browser-review.mjs, a self-contained
// Playwright package. Install it once with `npm ci --prefix scripts/jellyfinmod-e2e`; this path forwards to it.
import { existsSync } from 'node:fs';

if (!existsSync(new URL('./jellyfinmod-e2e/node_modules/playwright-core/package.json', import.meta.url))) {
    console.error('Run `npm ci --prefix scripts/jellyfinmod-e2e` first; see docs/jellyfinmod/REVIEW.md.');
    process.exit(1);
}
await import('./jellyfinmod-e2e/browser-review.mjs');
