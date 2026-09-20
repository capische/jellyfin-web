/**
 * Resolves an asset that ships with the bundle.
 *
 * Almost every asset reference in this app is resolved by the webpack runtime, which roots itself at the script's
 * own URL. A handful are built at runtime as plain relative strings — a theme stylesheet, a device image, the
 * default avatar, a silent sound — and those resolve against the *document* instead.
 *
 * That is the same thing everywhere the document and the bundle share a directory, which is every stock shape.
 * It stops being the same thing when JellyfinMod serves the bundle from its own path while the document stays at
 * `/web/`: a relative `themes/dark/theme.css` would then be fetched from the host's web root, and would either
 * 404 or quietly load a different file of the same name. Routing those few references through here keeps them
 * pointing at the bundle they belong to.
 *
 * `window.__jfmodAssetRoot` is set by the JellyfinMod document before any other script runs, and is absent
 * otherwise — in which case this returns the path unchanged and nothing about the stock app changes.
 */
declare global {
    interface Window {
        /** Set by the JellyfinMod document before any other script runs; absent in every stock shape. */
        __jfmodAssetRoot?: string;
    }
}

export const assetUrl = (path: string): string => {
    const root = window.__jfmodAssetRoot;
    if (!root) return path;
    try {
        return new URL(path, new URL(root, document.baseURI)).href;
    } catch {
        return path;
    }
};
