import { useEffect, useRef } from 'react';

import type { PlayedBadge } from '../constants/detailPage';

import './playedBadge.scss';

/**
 * The countdown on upstream's Played tick (design step 4, user 2026-10-07; UX §1.1 exception 1): one `span` inserted as the
 * second child of the stock `btnPlaystate` button's `.detailButton-content`, absolutely placed over the tick's lower-right
 * arm. Upstream's playstate button only ever changes its icon's classes and its own title, so the span survives every
 * played toggle; the stock click is untouched. The content box takes a mod class only while the badge is there, for its
 * positioning. When the markup is not found the badge is simply absent.
 */
export const usePlayedBadge = (view: HTMLElement, badge: PlayedBadge | null) => {
    const text = badge?.text;
    const kept = badge?.kept;
    const title = badge?.title;
    useEffect(() => {
        if (!text) return;
        const content = view.querySelector('.mainDetailButtons .btnPlaystate .detailButton-content');
        if (!content) return;
        const span = document.createElement('span');
        span.className = 'jfmod-playedBadge' + (kept ? ' jfmod-playedBadge--kept' : '');
        span.textContent = text;
        if (title) span.title = title;
        span.setAttribute('aria-label', title ?? text);
        // insertBefore rather than after(): older TV engines lack ChildNode.after.
        content.insertBefore(span, content.children[1] ?? null);
        content.classList.add('jfmod-playedBadgeHost');
        return () => {
            span.remove();
            content.classList.remove('jfmod-playedBadgeHost');
        };
    }, [view, text, kept, title]);
};

/** How long the plugin takes to see a played change and start (or end) a retention window before the page asks again. */
const PLAYED_SETTLE_MS = 2500;

/**
 * Upstream's Played button toggles in place. When it does, the page asks the plugin again shortly after, so the badge follows
 * a window that the toggle started or ended without reloading the page. Read from the stock button's own played class.
 */
export const usePlayedRefresh = (view: HTMLElement, refresh: () => void) => {
    const refreshRef = useRef(refresh);
    refreshRef.current = refresh;
    useEffect(() => {
        const button = view.querySelector('.mainDetailButtons .btnPlaystate');
        if (!button) return;
        let played = button.classList.contains('playstatebutton-played');
        let timer: number | undefined;
        const observer = new MutationObserver(() => {
            const now = button.classList.contains('playstatebutton-played');
            if (now === played) return;
            played = now;
            window.clearTimeout(timer);
            timer = window.setTimeout(() => refreshRef.current(), PLAYED_SETTLE_MS);
        });
        observer.observe(button, { attributes: true, attributeFilter: ['class'] });
        return () => {
            observer.disconnect();
            window.clearTimeout(timer);
        };
    }, [view]);
};
