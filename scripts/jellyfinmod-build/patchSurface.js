const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Keeps PHASE7 §3.2, the enumerated patch surface, equal to what `jellyfin-mod` actually changes (REVIEW-2026-09-24
 * P7-R1).
 *
 * The upstream merge routine (§3.4 step 4) allows conflicts only in the files §3.2 lists, and "plugin off is stock by
 * construction" rests on that list being complete. It drifted once in both directions — three edited files unlisted,
 * two listed files long since restored — so the build now compares the two and fails, by name, when they differ:
 *
 * - every file changed since the fork point with `master` (outside the mod's own tree and the fork-only files below)
 *   must be a non-struck row of the table;
 * - every non-struck row must actually be changed;
 * - every struck row (handed back) must have no change left.
 *
 * Runs as a webpack plugin before compilation, and standalone: `node scripts/jellyfinmod-build/patchSurface.js`
 * (exit 1 on a mismatch). The comparison base is `master`, or `JELLYFINMOD_PATCH_BASE` when set. Where there is no git
 * checkout or no such ref — a source archive, a shallow CI clone — it says so and does not fail, because there is
 * nothing to compare against.
 */

const PLUGIN_NAME = 'JellyfinModPatchSurface';
const ROOT = path.resolve(__dirname, '..', '..');
const TABLE_DOC = 'docs/jellyfinmod/PHASE7.md';

/** Files the fork owns outright: never an upstream edit, so never a §3.2 row. */
const FORK_OWNED = [
    /^src\/apps\/modern\/features\/jellyfinmod\//,
    /^docs\//,
    /^scripts\/jellyfinmod-/,
    /^src\/jellyfinmod\.jsx$/,
    /^CLAUDE(\.local)?\.md$/,
    /^jellyfin-sync(\.env\.example)?$/
];

// eslint-disable-next-line sonarjs/no-os-command-from-path -- a build-time developer tool; git from PATH is the point
const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

/** The table's rows: `{ files, struck }`, read from the §3.2 section of PHASE7.md. */
function readTable() {
    const text = fs.readFileSync(path.join(ROOT, TABLE_DOC), 'utf8');
    const start = text.indexOf('### 3.2 ');
    const end = text.indexOf('### 3.3 ', start);
    if (start < 0 || end < 0) throw new Error(`${TABLE_DOC} has no §3.2 section`);
    const rows = [];
    for (const line of text.slice(start, end).split('\n')) {
        if (!line.startsWith('| ') || line.startsWith('| Upstream file') || line.startsWith('| ---')) continue;
        const cell = line.split('|')[1].trim();
        const files = [...cell.matchAll(/`([^`\s]+)`/g)].map(match => match[1]).filter(file => /^[\w.-]+(\/[\w.-]+)*\.\w+$/.test(file));
        if (files.length) rows.push({ files, struck: cell.startsWith('~~') });
    }
    return rows;
}

/** Changed files since the fork point, excluding the fork's own, or null when there is nothing to compare against. */
function changedFiles(base) {
    try {
        git(['rev-parse', '--is-inside-work-tree']);
        git(['rev-parse', '--verify', `${base}^{commit}`]);
    } catch {
        return null;
    }
    const forkPoint = git(['merge-base', base, 'HEAD']);
    // The committed tree and the working tree both count: a build of uncommitted edits is checked too.
    const names = git(['diff', '--name-only', forkPoint, '--']).split('\n').filter(Boolean);
    return names.filter(file => !FORK_OWNED.some(pattern => pattern.test(file))).sort();
}

/** Returns the problems as sentences; empty when §3.2 matches the diff. */
function check(base = process.env.JELLYFINMOD_PATCH_BASE || 'master') {
    const changed = changedFiles(base);
    if (changed === null) return { skipped: `no git checkout with a '${base}' ref to compare against` };
    const rows = readTable();
    const listed = new Set(rows.filter(row => !row.struck).flatMap(row => row.files));
    const struck = new Set(rows.filter(row => row.struck).flatMap(row => row.files));
    const problems = [];
    for (const file of changed) {
        if (struck.has(file)) problems.push(`${file} is struck through in §3.2 (handed back) but still differs from ${base}`);
        else if (!listed.has(file)) problems.push(`${file} differs from ${base} and is not a row of §3.2`);
    }
    for (const file of listed) {
        if (!changed.includes(file)) problems.push(`${file} is a §3.2 row but no longer differs from ${base}; strike the row through`);
    }
    return { problems, changed: changed.length };
}

function report(result) {
    if (result.skipped) return `JellyfinMod patch surface: not checked (${result.skipped}).`;
    if (!result.problems.length) return null;
    return [
        `JellyfinMod patch surface: ${TABLE_DOC} §3.2 does not match the upstream files this branch changes.`,
        ...result.problems.map(problem => `  - ${problem}`),
        'Add, strike or remove the rows in the same commit that changes the file (PHASE7 §3.2, §3.4 step 5).'
    ].join('\n');
}

class JellyfinModPatchSurfacePlugin {
    apply(compiler) {
        compiler.hooks.beforeCompile.tap(PLUGIN_NAME, () => {
            const result = check();
            const message = report(result);
            if (result.skipped) {
                console.warn(message);
                return;
            }
            if (!message) return;
            // A production build fails; a development server warns, so editing an upstream file and its row can
            // happen in either order without the server stopping.
            if (compiler.options.mode === 'production') throw new Error(message);
            console.warn(message);
        });
    }
}

module.exports = JellyfinModPatchSurfacePlugin;
module.exports.check = check;

if (require.main === module) {
    const result = check(process.argv[2]);
    const message = report(result);
    if (message) console.error(message);
    else console.log(`JellyfinMod patch surface: §3.2 matches the ${result.changed} upstream file(s) this branch changes.`);
    process.exit(result.problems?.length ? 1 : 0);
}
