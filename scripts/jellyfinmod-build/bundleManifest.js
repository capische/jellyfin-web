const crypto = require('crypto');

/**
 * Stamps a built JellyfinMod bundle with its own identity (P7.S2).
 *
 * Two artefacts come out of every build:
 *
 * - `jellyfinmod-web.json`, which the plugin reads when it packages and serves the bundle, and
 * - `<meta name="jellyfinmod-web" content="<bundleId>">` in `jellyfinmod.html`, which is how a running page says
 *   which bundle it is, and what the takeover engine renders `/web/index.html` from.
 *
 * The stock entry's `index.html` is deliberately **not** stamped. It has to stay byte-for-byte what upstream's
 * build produces, because "disable the plugin and stock Jellyfin is still there" is a claim about that file.
 *
 * `bundleId` is 12 hex characters of a hash over every emitted file's name and contents, excluding source maps
 * (which are published separately) and the HTML documents (one carries the id, so it cannot be an input; the
 * other is not ours to change). The same sources always produce the same id, and any change to any served file
 * produces a new one.
 */

const PLUGIN_NAME = 'JellyfinModBundleManifest';
const MANIFEST_NAME = 'jellyfinmod-web.json';
const MOD_INDEX_NAME = 'jellyfinmod.html';
const STOCK_INDEX_NAME = 'index.html';
const META_NAME = 'jellyfinmod-web';
const ID_LENGTH = 12;

const isHashInput = name => name !== MANIFEST_NAME
    && name !== MOD_INDEX_NAME
    && name !== STOCK_INDEX_NAME
    && !name.endsWith('.map');

/**
 * Health capability names this bundle needs the plugin to advertise.
 *
 * The plugin compares these with what it actually serves and reports the difference, which is how a bundle newer
 * than its plugin — a retained bundle after a rollback, or an archive-shape deployment — surfaces as a warning
 * rather than as surfaces that silently do nothing. Grow this list in the commit that adds the gate that needs it.
 */
const EXPECTS_CAPABILITIES = ['ui', 'ui.web'];

class JellyfinModBundleManifestPlugin {
    /**
     * @param {object} [options]
     * @param {string} [options.webCommit] The fork revision this bundle was built from.
     * @param {string} [options.upstreamMergeBase] The upstream commit `master` last merged.
     * @param {string} [options.minimumServer] The lowest server version this bundle supports.
     * @param {string[]} [options.testedOnServers] Server versions this bundle has actually been run against.
     */
    constructor({ webCommit = '', upstreamMergeBase = '', minimumServer = '', testedOnServers = [] } = {}) {
        this.webCommit = webCommit;
        this.upstreamMergeBase = upstreamMergeBase;
        this.minimumServer = minimumServer;
        this.testedOnServers = testedOnServers;
    }

    apply(compiler) {
        const { RawSource } = compiler.webpack.sources;
        const { Compilation } = compiler.webpack;

        compiler.hooks.thisCompilation.tap(PLUGIN_NAME, compilation => {
            compilation.hooks.processAssets.tap(
                // REPORT runs after every other asset stage, so nothing is added or rewritten after the hash.
                { name: PLUGIN_NAME, stage: Compilation.PROCESS_ASSETS_STAGE_REPORT },
                assets => {
                    const files = Object.keys(assets).filter(isHashInput).sort();
                    const digest = crypto.createHash('sha256');
                    for (const name of files) {
                        digest.update(name);
                        digest.update('\0');
                        digest.update(crypto.createHash('sha256').update(assets[name].buffer()).digest());
                    }
                    const bundleId = digest.digest('hex').slice(0, ID_LENGTH);

                    compilation.emitAsset(MANIFEST_NAME, new RawSource(`${JSON.stringify({
                        bundleId,
                        webCommit: this.webCommit,
                        upstreamMergeBase: this.upstreamMergeBase,
                        builtAt: new Date().toISOString(),
                        fileCount: files.length,
                        expectsCapabilities: EXPECTS_CAPABILITIES,
                        // A minimum and versions someone actually ran, never a guessed upper bound (PHASE7 3.5).
                        supportedServer: {
                            minimum: this.minimumServer,
                            testedOn: this.testedOnServers
                        }
                    }, null, 2)}\n`));

                    const index = assets[MOD_INDEX_NAME];
                    if (!index) return;
                    const html = index.source().toString();
                    const meta = `<meta name="${META_NAME}" content="${bundleId}">`;
                    const head = /<head(?:\s[^>]*)?>/i.exec(html);
                    compilation.updateAsset(MOD_INDEX_NAME, new RawSource(head ?
                        html.slice(0, head.index + head[0].length) + meta + html.slice(head.index + head[0].length) :
                        meta + html));
                }
            );
        });
    }
}

module.exports = JellyfinModBundleManifestPlugin;
