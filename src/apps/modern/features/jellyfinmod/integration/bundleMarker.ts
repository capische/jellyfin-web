/**
 * Proof that this bundle executed (P7.S2).
 *
 * The takeover engine's failsafe reads this global on `DOMContentLoaded`: absent means the patched `index.html`
 * pointed at a bundle that never ran — the plugin was removed, disabled or is serving a bundle that no longer
 * exists — and the stock page is loaded in its place. Setting it is the first thing the entry does, so it costs
 * nothing and cannot itself fail.
 */
declare global {
    interface Window {
        __jfmodBundle?: true;
    }
}

window.__jfmodBundle = true;

export {};
