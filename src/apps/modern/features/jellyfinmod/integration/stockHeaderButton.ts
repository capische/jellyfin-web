import { useEffect, useRef } from 'react';

import focusManager from 'components/focusManager';

/**
 * A button in upstream's detail header row (`.mainDetailButtons`), made exactly as upstream makes its own: a
 * `button-flat detailButton` holding a `detailButton-icon`, created from markup so the `emby-button` custom element
 * upgrades it (the v0 polyfill cannot create an `is` element any other way; see EmbySelect) and adds `show-focus` on the
 * TV. Nothing about it is mod-styled (design step 1, user 2026-10-07; UX §1.1 exception 1).
 *
 * It is a DOM insert, the same technique as the version mount: no upstream file changes. It goes immediately before
 * Favorite (`.btnUserRating`); when upstream's markup no longer has that row or that button, the button is simply absent.
 */

export interface StockHeaderButtonOptions {
    /** Absent while false. */
    enabled: boolean;
    /** A Material icon name with a class in the icon font, such as `cloud_download`. */
    icon: string;
    title: string;
    /** A `jfmod-` class naming the button, for tests and focus restore. */
    className: string;
    onClick: (button: HTMLButtonElement) => void;
    /**
     * Mod header buttons that must come after this one, so the order never depends on which arrives first (Get a release
     * waits for the plugin's capabilities and still leads the file-less page's More).
     */
    before?: string[];
}

const markup = (icon: string, className: string) =>
    `<button is="emby-button" type="button" class="button-flat detailButton ${className}">`
    + `<div class="detailButton-content"><span class="material-icons detailButton-icon ${icon}" aria-hidden="true"></span></div>`
    + '</button>';

/** The position the button keeps: before Favorite, and before any mod button named in `before` that is already there. */
const insert = (row: Element, button: HTMLButtonElement, before: string[]) => {
    const favorite = row.querySelector(':scope > .btnUserRating');
    if (!favorite) return false;
    const later = before.map(name => row.querySelector(`:scope > .${name}`)).find(Boolean);
    row.insertBefore(button, later ?? favorite);
    return true;
};

/** Focus goes back to the header button after something it opened closes, unless the viewer has moved on (UX §13). */
export const restoreFocusTo = (opener: HTMLElement) => {
    const active = document.activeElement;
    if (!opener.isConnected || (active && active !== document.body && document.body.contains(active))) return;
    focusManager.focus(opener);
};

export const useStockHeaderButton = (view: HTMLElement, { enabled, icon, title, className, onClick, before }: StockHeaderButtonOptions) => {
    const order = (before ?? []).join(' ');
    const onClickRef = useRef(onClick);
    onClickRef.current = onClick;
    useEffect(() => {
        if (!enabled) return;
        const row = view.querySelector('.mainDetailButtons');
        if (!row) return;
        const holder = document.createElement('div');
        holder.innerHTML = markup(icon, className);
        const button = holder.firstElementChild as HTMLButtonElement | null;
        if (!button) return;
        button.title = title;
        button.setAttribute('aria-label', title);
        const click = () => onClickRef.current(button);
        button.addEventListener('click', click);
        if (!insert(row, button, order ? order.split(' ') : [])) return;
        return () => {
            button.removeEventListener('click', click);
            button.remove();
        };
    }, [view, enabled, icon, title, className, order]);
};
