/**
 * Where this bundle's own files live (P7.S2).
 *
 * After the takeover the document is `/web/index.html` but the scripts, stylesheets, `config.json` and everything
 * else come from the plugin's immutable bundle path. Webpack's own `publicPath: 'auto'` already roots chunks and
 * dictionaries at the runtime script's URL; this is the same value for the handful of files that are fetched by
 * application code rather than by the webpack runtime.
 *
 * In every other shape — the stock entry, the archive shape, `npm run serve` — the document and the assets share a
 * directory and this resolves to the document's own directory, so the value is correct without anyone configuring
 * it.
 */

// `Window.__jfmodAssetRoot` is declared beside the shared `assetUrl` helper in utils, which is where the rest of
// the app reads it from.
declare global {
    /** Webpack's own public path, rewritten at build time; `'auto'` resolves it to the runtime script's URL. */
    // eslint-disable-next-line @typescript-eslint/naming-convention -- webpack defines this name; we only read it
    const __webpack_public_path__: string;
}

const trailingSlash = (value: string) => value.endsWith('/') ? value : `${value}/`;

/** The absolute URL this bundle's files are served from, always with a trailing slash. */
export const modAssetRoot = (): string => {
    const declared = window.__jfmodAssetRoot;
    if (declared) return trailingSlash(new URL(declared, document.baseURI).href);

    // `publicPath: 'auto'` gives the webpack runtime the directory of the script that loaded it, which is the
    // bundle root in every shape. `__webpack_public_path__` is rewritten by webpack at build time.
    const runtimePath = __webpack_public_path__;
    if (runtimePath) return trailingSlash(new URL(runtimePath, document.baseURI).href);

    return trailingSlash(new URL('.', document.baseURI).href);
};

/** Resolves one of this bundle's own files against the asset root. */
export const modAssetUrl = (path: string): string => new URL(path, modAssetRoot()).href;
