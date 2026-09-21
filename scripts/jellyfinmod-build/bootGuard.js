const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * Keeps the JellyfinMod entry from silently drifting away from the stock one (P7.S2).
 *
 * `src/jellyfinmod.jsx` mirrors `src/index.jsx`'s start-up sequence and `ModApp.tsx` mirrors `RootApp.tsx`'s
 * provider stack, rather than both entries importing a shared module. That choice keeps those two upstream files
 * unedited, which is what keeps an upstream merge small (PHASE7 §3.1, boot option 1) — but it means an upstream
 * change to either one has to be mirrored by hand, and a mirroring that nobody remembers is a bug that only shows
 * up as a subtly broken interface much later.
 *
 * So the build refuses to be the place that stays quiet. The sources are hashed; if a hash no longer matches the
 * recorded one, the build fails and names the file, what to do, and the value to record once it is done.
 *
 * Updating a hash here without actually mirroring the change defeats the entire mechanism. The commit that
 * updates a hash is the commit that mirrors the change.
 */

const PLUGIN_NAME = 'JellyfinModBootGuard';

/** Upstream files the mod entry mirrors, and the hash of the version it was last mirrored against. */
const MIRRORED = [
    {
        file: 'src/index.jsx',
        mirroredBy: 'src/jellyfinmod.jsx',
        what: 'the start-up sequence',
        sha256: '95f779ea28f311c71fea6e18ac14b598eb2d41cb164a32ee143cc1af4bbcdb86'
    },
    {
        file: 'src/RootApp.tsx',
        mirroredBy: 'src/apps/modern/features/jellyfinmod/shell/ModApp.tsx',
        what: 'the provider stack',
        sha256: 'd143be1b1119c95d1984e856f78bdfeeb394dd76d7a31e2e966fd35ba74efc51'
    },
    {
        file: 'src/components/viewManager/ViewManagerPage.tsx',
        mirroredBy: 'src/apps/modern/features/jellyfinmod/routes/DetailsPage.tsx',
        what: 'the legacy view load/restore sequence',
        sha256: '9d6855d56f8ef66ecdd4f39680514c921522e405effc2067448130d5805ee98b'
    }
];

const hash = contents => crypto.createHash('sha256').update(contents).digest('hex');

// Line endings differ between checkouts; the content does not.
const read = file => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

class JellyfinModBootGuardPlugin {
    constructor({ root = process.cwd() } = {}) {
        this.root = root;
    }

    check() {
        const drifted = MIRRORED
            .map(entry => ({ ...entry, actual: hash(read(path.resolve(this.root, entry.file))) }))
            .filter(entry => entry.actual !== entry.sha256);

        if (drifted.length === 0) return null;

        return [
            'JellyfinMod: an upstream file the mod entry mirrors has changed.',
            '',
            ...drifted.flatMap(entry => [
                `  ${entry.file} (${entry.what})`,
                `    mirrored by: ${entry.mirroredBy}`,
                `    recorded:    ${entry.sha256}`,
                `    now:         ${entry.actual}`
            ]),
            '',
            'Mirror the change into the file listed above, then record the new hash in',
            'scripts/jellyfinmod-build/bootGuard.js in the same commit. Do not update the hash on its own:',
            'that turns this check off without fixing anything. See PHASE7 §3.1 and §3.4 step 3.'
        ].join('\n');
    }

    apply(compiler) {
        compiler.hooks.beforeCompile.tap(PLUGIN_NAME, () => {
            const problem = this.check();
            if (problem) throw new Error(problem);
        });
    }
}

module.exports = JellyfinModBootGuardPlugin;
module.exports.MIRRORED = MIRRORED;
