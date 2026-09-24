import focusManager from 'components/focusManager';
import layoutManager from 'components/layoutManager';
import browser from 'scripts/browser';
import inputManager from 'scripts/inputManager';
import { getKeyName, isInteractiveElement } from 'scripts/keyboardNavigation';

import './dpadModals.scss';

/**
 * D-pad and Back for MUI pop-ups — menus, popovers and dialogs — in front of a remote (P7 TV shell).
 *
 * Upstream's TV model is built for its own `dialogHelper` dialogs: they sit in history, so the remote's Back pops
 * them, and `focusManager` moves focus spatially across whatever is on screen. MUI's pop-ups know neither. MUI
 * closes on the Escape key only, and webOS and Tizen remotes do not send Escape — they send key codes 461 and 10009,
 * which upstream's keyboard handler turns into a `back` command that leaves the page with the pop-up still open.
 * Arrow keys have the opposite problem: `focusManager` treats the whole document as one surface, so Down from the
 * last row of a pop-up walks into the page behind it, and MUI's focus trap snatches focus straight back to the top.
 *
 * So, while an MUI modal is open:
 *
 * - **Back closes the top pop-up and nothing else**, whichever key or command it arrives as; focus returns to the
 *   control that opened it (MUI's focus trap restores it). With nothing open, Back is untouched and navigates as
 *   before.
 * - **On the TV layout, arrows move within the top pop-up only**, spatially and with the same `focusManager` the
 *   rest of the TV uses, over the controls a remote can operate — menu items, accordion headers, buttons,
 *   checkboxes and switches. Right steps into a control nested in a row (the settings button inside a menu item),
 *   Left steps back out. Text fields keep Left and Right for the caret.
 * - **Enter works on everything a remote can reach.** MUI's own buttons and menu items already take Enter; a
 *   checkbox or switch does not (browsers toggle those on Space, and a remote has none), so Enter toggles it, and
 *   Enter on a menu row whose only control is a switch toggles that switch.
 * - **Opening a pop-up focuses its first control**, not the pop-up's paper, so the remote always has a target
 *   (UX §13 rule 5).
 *
 * One mechanism for every MUI pop-up the mod shows on a TV — the library grid's sort, view, filter and view menus
 * today, the settings area and the wizard next — installed once, with no change to upstream components.
 */

const OPEN_MODAL_SELECTOR = '.MuiModal-root:not(.MuiModal-hidden):not([aria-hidden="true"])';

/** What a remote can land on inside a pop-up. Tab-order-only attributes do not matter: MUI's roving lists use -1. */
const NAVIGABLE_SELECTOR = [
    'button',
    'a[href]',
    'input:not([type="hidden"])',
    'select',
    'textarea',
    '[role="menuitem"]',
    '[role="menuitemcheckbox"]',
    '[role="menuitemradio"]',
    '[role="option"]',
    '[role="button"]',
    '[role="tab"]',
    '[role="combobox"]',
    '[tabindex="0"]'
].join(',');

const TOGGLE_SELECTOR = 'input[type="checkbox"], input[type="radio"]';

type Direction = 'up' | 'down' | 'left' | 'right';

const DIRECTIONS: Record<string, Direction | undefined> = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right'
};

let installed = false;
/** Set while this module dispatches its own Escape, so the event is not handled a second time on its way back. */
let closing = false;

/** The pop-up in front: MUI renders each modal as a body child, the most recent last. */
export const getTopModal = (): HTMLElement | null => {
    const modals = document.querySelectorAll<HTMLElement>(OPEN_MODAL_SELECTOR);
    return modals.length ? modals[modals.length - 1] : null;
};

const isBackKey = (key: string) => (
    key === 'Back'
    || key === 'Escape'
    || key === 'BrowserBack'
    || key === 'GoBack'
    // Upstream's own exception: Hisense's VIDAA sends Backspace for Back.
    || (key === 'Backspace' && !!browser.tv && !!browser.hisense && !!browser.vidaa)
);

const isVisible = (element: HTMLElement) => (
    element.offsetParent !== null || element.getClientRects().length > 0
);

const isEnabled = (element: HTMLElement) => (
    !(element as HTMLButtonElement).disabled
    && element.getAttribute('aria-disabled') !== 'true'
    && !element.classList.contains('Mui-disabled')
);

const navigableIn = (root: HTMLElement) => Array.prototype.filter.call(
    root.querySelectorAll<HTMLElement>(NAVIGABLE_SELECTOR),
    (element: HTMLElement) => isVisible(element) && isEnabled(element)
) as HTMLElement[];

/** Candidates for moving between rows: a control nested inside another candidate is reached with Right instead. */
const outermost = (candidates: HTMLElement[]) => candidates.filter(
    candidate => !candidates.some(other => other !== candidate && other.contains(candidate))
);

const scrollIntoModalView = (element: HTMLElement, modal: HTMLElement) => {
    // The pop-up's paper scrolls, the page behind it does not: bring the element into the paper's view only.
    let parent = element.parentElement;
    while (parent && parent !== modal) {
        if (parent.scrollHeight > parent.clientHeight + 1) {
            const box = element.getBoundingClientRect();
            const view = parent.getBoundingClientRect();
            if (box.top < view.top) parent.scrollTop -= view.top - box.top;
            else if (box.bottom > view.bottom) parent.scrollTop += box.bottom - view.bottom;
            return;
        }
        parent = parent.parentElement;
    }
};

const focusWithin = (element: HTMLElement, modal: HTMLElement) => {
    focusManager.focus(element);
    scrollIntoModalView(element, modal);
};

const MOVES: Record<Direction, (source: Element, options: { container: Element, focusableElements: HTMLElement[] }) => void> = {
    up: focusManager.moveUp,
    down: focusManager.moveDown,
    left: focusManager.moveLeft,
    right: focusManager.moveRight
};

const move = (modal: HTMLElement, direction: Direction) => {
    const active = document.activeElement as HTMLElement | null;
    const candidates = navigableIn(modal);

    if (!active || !modal.contains(active) || active === modal) {
        const first = outermost(candidates)[0];
        if (first) focusWithin(first, modal);
        return;
    }

    if (direction === 'right') {
        const nested = candidates.find(candidate => candidate !== active && active.contains(candidate));
        if (nested) {
            focusWithin(nested, modal);
            return;
        }
    } else if (direction === 'left') {
        const row = candidates.find(candidate => candidate !== active && candidate.contains(active));
        if (row) {
            focusWithin(row, modal);
            return;
        }
    }

    // A control inside a row moves on as its row does, so Down from a row's settings button reaches the next row.
    const source = candidates.find(candidate => candidate !== active && candidate.contains(active)) ?? active;
    MOVES[direction](source, { container: modal, focusableElements: outermost(candidates) });

    const moved = document.activeElement as HTMLElement | null;
    if (moved && moved !== active && modal.contains(moved)) scrollIntoModalView(moved, modal);
};

/** The checkbox or switch Enter should toggle, if the focused element is one or is a row holding only one. */
const toggleFor = (element: HTMLElement): HTMLInputElement | null => {
    if (element.matches(TOGGLE_SELECTOR)) return element as HTMLInputElement;
    if (!element.matches('[role="menuitem"], li')) return null;
    const toggles = element.querySelectorAll<HTMLInputElement>(TOGGLE_SELECTOR);
    const others = element.querySelectorAll('button, a[href], select, textarea, [role="button"]');
    return toggles.length === 1 && others.length === 0 ? toggles[0] : null;
};

/** Close the top pop-up the way MUI expects to be closed from the keyboard: an Escape inside it. */
export const closeTopModal = (): boolean => {
    const modal = getTopModal();
    if (!modal) return false;

    const active = document.activeElement;
    const target = active && modal.contains(active) ? active : modal;
    closing = true;
    try {
        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
    } finally {
        closing = false;
    }
    return true;
};

const onKeyDown = (e: KeyboardEvent) => {
    if (closing || e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;

    const modal = getTopModal();
    if (!modal) return;

    const key = getKeyName(e) || e.key;

    if (isBackKey(key) || isBackKey(e.key)) {
        // Before upstream's handler turns it into a navigation, and before MUI sees it.
        e.preventDefault();
        e.stopPropagation();
        closeTopModal();
        return;
    }

    if (!layoutManager.tv) return;

    const direction = DIRECTIONS[key];
    if (direction) {
        const active = document.activeElement;
        if ((direction === 'left' || direction === 'right') && active && isInteractiveElement(active)) return;
        e.preventDefault();
        e.stopPropagation();
        move(modal, direction);
        return;
    }

    if (key === 'Enter') {
        const active = document.activeElement as HTMLElement | null;
        const toggle = active && modal.contains(active) ? toggleFor(active) : null;
        if (toggle) {
            e.preventDefault();
            e.stopPropagation();
            toggle.click();
        }
    }
};

/** A `back` command that did not come from a key (a host app's Back, a gamepad mapping) closes the pop-up too. */
const onCommand = (e: Event) => {
    const { detail } = e as CustomEvent<{ command?: string }>;
    if (closing || detail?.command !== 'back' || !getTopModal()) return;
    e.preventDefault();
    closeTopModal();
};

/** MUI focuses a popover's paper when it opens; on the TV that leaves the remote nothing to act on. */
const onFocusIn = (e: FocusEvent) => {
    if (!layoutManager.tv) return;
    const target = e.target as HTMLElement | null;
    const modal = getTopModal();
    if (!target || !modal?.contains(target) || target.matches(NAVIGABLE_SELECTOR)) return;

    // After MUI's own open-time focus handling has run.
    setTimeout(() => {
        if (document.activeElement !== target || getTopModal() !== modal) return;
        const first = outermost(navigableIn(modal))[0];
        if (first) focusWithin(first, modal);
    }, 0);
};

/** Installs the handlers once for the lifetime of the page. They do nothing while no MUI pop-up is open. */
export const installDpadModals = () => {
    if (installed) return;
    installed = true;

    // Capture phase on window: ahead of MUI's React handlers and of upstream's keyboard navigation.
    window.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn, true);
    inputManager.on(window, onCommand);
};
