/**
 * Whether a page may still place TV focus itself. Stock detail pages focus their first action once; this page's actions
 * arrive in stages (the entry, then the plugin's capabilities), so it may move its own automatic focus forward, but only
 * until the user acts. Ownership starts at `viewshow`, before anything loads, so any key, click or touch during loading
 * ends it, and a focus target that is already valid when the page opens (a header control the user selected, or the
 * target Back restored) is kept.
 */
export interface FocusOwnership {
    /** True while no user input has happened since the visit began. */
    readonly owned: () => boolean;
    /** Whether the page may focus `target` now: owned, and nothing valid has focus except what the page itself placed. */
    readonly mayFocus: (target: HTMLElement) => boolean;
    /** Records that the page placed focus on `target`. */
    readonly placed: (target: HTMLElement) => void;
    /** Ends ownership and removes the listeners (the visit ended). */
    readonly release: () => void;
}

const EVENTS = ['keydown', 'pointerdown', 'mousedown', 'touchstart', 'click'] as const;

const isValidTarget = (element: Element | null): element is HTMLElement =>
    !!element && element !== document.body && element.isConnected && element.getClientRects().length > 0;

export const createFocusOwnership = (): FocusOwnership => {
    let owned = !isValidTarget(document.activeElement);
    let last: HTMLElement | null = null;
    const end = () => {
        owned = false;
    };
    for (const name of EVENTS) document.addEventListener(name, end, true);
    return {
        owned: () => owned,
        mayFocus: target => {
            if (!owned || target === document.activeElement) return false;
            const active = document.activeElement;
            return !isValidTarget(active) || active === last;
        },
        placed: target => {
            last = target;
        },
        release: () => {
            owned = false;
            for (const name of EVENTS) document.removeEventListener(name, end, true);
        }
    };
};
