import { type RefObject, useEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

import autoFocuser from 'components/autoFocuser';
import focusManager from 'components/focusManager';
import layoutManager from 'components/layoutManager';

/**
 * Where the remote is on a React library grid, kept the way upstream's legacy grid kept it (P7 TV shell).
 *
 * Upstream's legacy grids were cached views: Back from a detail page showed the same DOM again, focus and all, and
 * their controllers re-ran `autoFocuser` after every page change. A React page is rendered afresh, so the same three
 * guarantees are made here explicitly (UX Principle 3, "focus is state"):
 *
 * 1. **First focus** lands on the first card once the grid has cards, unless the user has already moved.
 * 2. **Back returns to the card the user left from**, on the same page of results.
 * 3. **Focus is never dropped to the document.** A focused control that disappears or becomes disabled — the Next
 *    button on the last page, a card replaced by the next page's — hands focus to its nearest equivalent: the same
 *    paging button once it is enabled again, the other paging button, or the first card. With focus on `<body>`
 *    the next key press would start again from the top of the page.
 */

/** Last focused card per library view (path and query), for the lifetime of the page load. */
const lastFocusedCard = new Map<string, string>();

const cardIdentity = (card: Element) => {
    const id = card.getAttribute('data-id');
    if (id) return 'id:' + id;
    const tmdbId = card.getAttribute('data-jfmod-tmdb-id');
    return tmdbId ? 'tmdb:' + tmdbId : null;
};

const findCard = (container: Element, identity: string) => (
    Array.from(container.querySelectorAll<HTMLElement>('.card')).find(card => cardIdentity(card) === identity) ?? null
);

const isUsable = (element: HTMLElement | null) => (
    !!element && element.isConnected && focusManager.isCurrentlyFocusable(element)
    && element.getAttribute('aria-disabled') !== 'true'
);

/** Upstream's paging buttons, by title: when one cannot take focus back, the other can. */
const OTHER_PAGING_BUTTON: Record<string, string | undefined> = { Next: 'Previous', Previous: 'Next' };

/** How long a paging button may stay disabled while its page loads before focus settles on the grid instead. */
const RESCUE_WAIT_MS = 4000;

export const useTvGridFocus = (pageRef: RefObject<HTMLElement>) => {
    const location = useLocation();
    const navigationType = useNavigationType();
    const viewKey = location.pathname + location.search;

    useEffect(() => {
        const page = pageRef.current;
        if (!layoutManager.tv || !page) return;

        const restoreIdentity = navigationType === 'POP' ? lastFocusedCard.get(viewKey) : undefined;
        let placed = false;
        /** A control that lost focus and should get it back, and when it was lost. */
        let rescue: { title: string | null, since: number } | null = null;
        let rescueTimer: ReturnType<typeof setTimeout> | undefined;

        const container = () => page.querySelector('.itemsContainer');
        const focusIsOnPage = () => {
            const active = document.activeElement;
            return !!active && active !== document.body && page.contains(active);
        };
        const focusIsLost = () => {
            const active = document.activeElement;
            return !active || active === document.body;
        };

        const placeInitialFocus = () => {
            const grid = container();
            if (placed || !grid?.querySelector('.card')) return;
            placed = true;
            const restore = restoreIdentity ? findCard(grid, restoreIdentity) : null;
            if (restore) {
                focusManager.focus(restore);
                restore.scrollIntoView?.({ block: 'center' });
            } else if (!focusIsOnPage()) {
                autoFocuser.autoFocus(page);
            }
        };

        const toolbarButton = (title: string) => page.querySelector<HTMLElement>(`.MuiToolbar-root button[title="${title}"]`);

        const tryRescue = () => {
            if (!rescue || !focusIsLost()) {
                rescue = null;
                return;
            }
            const same = rescue.title ? toolbarButton(rescue.title) : null;
            if (isUsable(same)) {
                focusManager.focus(same);
                rescue = null;
                return;
            }
            // Upstream disables both paging buttons while a page loads, so the other one being usable means the
            // load is over and this one stays disabled: Next on the last page hands over to Previous, as legacy did.
            const otherTitle = rescue.title ? OTHER_PAGING_BUTTON[rescue.title] : undefined;
            const other = otherTitle ? toolbarButton(otherTitle) : null;
            if (isUsable(other)) {
                focusManager.focus(other);
                rescue = null;
                return;
            }
            const waited = Date.now() - rescue.since;
            if (waited < RESCUE_WAIT_MS && same?.isConnected) return;
            const grid = container();
            const target = grid ? focusManager.getFocusableElements(grid, 1)[0] as HTMLElement | undefined : undefined;
            rescue = null;
            if (target) focusManager.focus(target);
            else autoFocuser.autoFocus(page);
        };

        /** The last element on this page that had focus, so a loss can be traced back to what was lost. */
        let lastFocused: HTMLElement | null = null;

        const startRescue = () => {
            if (rescue || !placed || !focusIsLost() || !page.isConnected) return;
            rescue = { title: lastFocused?.getAttribute('title') ?? null, since: Date.now() };
            tryRescue();
            clearTimeout(rescueTimer);
            rescueTimer = setTimeout(tryRescue, RESCUE_WAIT_MS + 50);
        };

        const onFocusIn = (e: FocusEvent) => {
            lastFocused = e.target as HTMLElement;
            const card = lastFocused.closest?.('.card');
            const identity = card && page.contains(card) ? cardIdentity(card) : null;
            if (identity) lastFocusedCard.set(viewKey, identity);
        };

        // Browsers differ on whether removing or disabling the focused element fires `focusout`, so a loss is
        // looked for both here and after every change to the page.
        const onFocusOut = (e: FocusEvent) => {
            if (!e.relatedTarget) requestAnimationFrame(startRescue);
        };

        const observer = new MutationObserver(() => {
            placeInitialFocus();
            if (rescue) tryRescue();
            else startRescue();
        });
        observer.observe(page, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
        page.addEventListener('focusin', onFocusIn);
        page.addEventListener('focusout', onFocusOut);
        placeInitialFocus();

        return () => {
            observer.disconnect();
            clearTimeout(rescueTimer);
            page.removeEventListener('focusin', onFocusIn);
            page.removeEventListener('focusout', onFocusOut);
        };
    }, [viewKey, navigationType, pageRef]);
};
