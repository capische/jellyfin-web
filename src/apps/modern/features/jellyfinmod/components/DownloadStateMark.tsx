import React, { type FC, useLayoutEffect, useRef } from 'react';

import layoutManager from 'components/layoutManager';

import type { MarkKind, MarkProgress } from '../constants/queue';
import type { QueueRow } from '../types/queue';

/**
 * The download state ring family (P4.FU6, user-approved design 2026-10-13, `design/download-state-ring-family.html`): one disc,
 * one arc, a glyph per state. Downloading is the arrow with the icon-colour arc at its percent, stalled the pause glyph with the arc
 * dimmed, queued a clock, importing a spinning arc, failed a red bang. The figure is never inside the ring: it is the meta
 * line's (`DownloadProgress.text`) and every disc's tooltip (`DownloadProgress.tooltip`). Three sizes: `card`, a 1.6em dark disc
 * in a card's top-right corner, `row`, the 2.5em first round icon of a row's end slot, transparent like upstream's, and `page`,
 * the 4em ring of a missing episode's download block, the one place the percent is inside the ring (P1.FU20, user-approved
 * 2026-10-13) while it downloads or stalls. A seeding copy (P4.FU28) is the arrow turned up, its arc how far it is from release.
 *
 * One painter for every place: `paintDownloadMark` draws into an element, so the cards and rows that `downloadMarks` finds on
 * upstream's pages and the mod's own React views (`DownloadStateMark`) share the same markup. The arc is a 36-unit circle of
 * radius 15.9 (a circumference of 100), drawn from the top by `stroke-dashoffset = 100 − percent`.
 */

export type DownloadMarkSize = 'card' | 'row' | 'page';

const SEEDING = '<path d="M12 20V7"/><path d="M6.5 12.5L12 7L17.5 12.5"/>';

const GLYPHS: Record<MarkKind, string> = {
    downloading: '<path d="M12 4V20M6 14L12 20L18 14"/>',
    // Sending, not receiving: the download arrow turned over, still while it seeds and while it is released.
    seeding: SEEDING,
    releasing: SEEDING,
    queued: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12L15 14"/>',
    stalled: '<path d="M9 6V18M15 6V18"/>',
    importing: '<path d="M12 4V20M6 14L12 20L18 14"/>',
    failed: '<path d="M12 4.6V12.6" stroke-width="4.4"/><circle cx="12" cy="19" r="2.2" fill="currentColor" stroke="none"/>'
};

/** Another version of a title that already plays (D12): the picker's +, drawn while it downloads in place of the arrow. */
const PLUS = '<path d="M12 5.5V18.5M5.5 12H18.5"/>';

const ARCS = new Set<MarkKind>(['downloading', 'stalled', 'importing', 'seeding', 'releasing']);
const turning = (kind: MarkKind) => kind === 'importing' || kind === 'releasing';

/** The exact dm structure and geometry from ds2.js, also used by imperative source-card controllers. */
const inner = (progress: MarkProgress, size: DownloadMarkSize) => {
    const { kind } = progress;
    const sw = { card: 2.6, row: 2.2, page: 2.4 }[size];
    const track = size === 'card' ? 'var(--card-track)' : 'var(--ring-track)';
    let arc = '';
    if (ARCS.has(kind)) {
        const segment = turning(kind) ? '28 72' : (progress.percent ?? 0) + ' 100';
        const arcClass = turning(kind) ? 'turn' : 'val';
        arc = `<svg class="arc" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15.9" fill="none" stroke="${track}" stroke-width="${sw}"/>`
            + `<circle class="${arcClass}" cx="18" cy="18" r="15.9" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" pathLength="100" stroke-dasharray="${segment}"/></svg>`;
    }
    const drawing = progress.plus && kind === 'downloading' ? PLUS : GLYPHS[kind];
    const bob = kind === 'downloading' && !progress?.plus ? ' bob' : '';
    const glyph = numbered(kind, size) ? `<span class="pct">${progress.percent ?? 0}<small>%</small></span>` :
        `<svg class="glyph${bob}" viewBox="0 0 24 24" style="fill:none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${drawing}</svg>`;
    return arc + glyph;
};

/** Whether the ring holds its percent instead of the glyph: the page size while a figure moves. */
const numbered = (kind: MarkKind, size: DownloadMarkSize) =>
    size === 'page' && (kind === 'downloading' || kind === 'stalled');

const setAttribute = (element: Element, name: string, value: string) => {
    if (element.getAttribute(name) !== value) element.setAttribute(name, value);
};

const removeAttribute = (element: Element, name: string) => {
    if (element.hasAttribute(name)) element.removeAttribute(name);
};

/** The download client's web page a ring opens (user, 2026-10-19): its name ("Open Transmission") and credential-free link. */
export interface DownloadMarkLink {
    name: string;
    url: string;
}

/** The states whose ring opens the client: the torrent is in it, seeding too (P4.FU28). Failed and the file-state marks never do. */
const LINKED = new Set<MarkKind>(['queued', 'downloading', 'importing', 'stalled', 'seeding', 'releasing']);

/**
 * The client link a ring opens (user, 2026-10-19: "The buttons only", "Administrators only"): the first of the rows' clients with
 * a web link. The queue names a row's client for administrators only (`client`, null for everyone else), and its `openUrl` is the
 * client's saved Web interface link, so an ordinary user's ring, or one whose client has no saved link, stays an indicator. Never
 * on the TV, where nothing can open a tab.
 */
export const ringLink = (rows: Array<QueueRow | null | undefined>, progress: MarkProgress | null | undefined): DownloadMarkLink | null => {
    if (!progress || !LINKED.has(progress.kind) || layoutManager.tv) return null;
    const client = rows.find(row => row?.client?.openUrl)?.client;
    return client?.openUrl ? { name: client.name, url: client.openUrl } : null;
};

/** A linked ring opens its client and nothing else: not the card or row it sits on (a click there opens the title). */
const openLinked = (event: Event) => {
    const element = event.currentTarget as HTMLElement;
    const url = element.getAttribute('data-jfmod-open');
    if (!url || (event instanceof KeyboardEvent && event.key !== 'Enter')) return;
    event.preventDefault();
    event.stopPropagation();
    window.open(url, '_blank', 'noopener');
};

const listening = new WeakSet<HTMLElement>();

/**
 * Makes the ring a link to its client, or an indicator again. A link is a `role="link"` stop on the desktop and phone layouts
 * (not where its host is hidden from assistive technology, the picker's added slot, whose title row has the same link), its
 * tooltip the state and then "Open Transmission". `hostTip`: the host draws the tooltip (the Queue page's MUI tooltip and popover,
 * P4.FU28), so the element keeps its name but no native tooltip.
 */
export const paintLink = (element: HTMLElement, title: string, link: DownloadMarkLink | null | undefined, hostTip = false) => {
    const tip = (text: string) => {
        if (hostTip) removeAttribute(element, 'title');
        else if (element.title !== text) element.title = text;
    };
    element.classList.toggle('linked', !!link);
    element.classList.toggle('focusable', !!link);
    if (!link) {
        removeAttribute(element, 'data-jfmod-open');
        removeAttribute(element, 'tabindex');
        setAttribute(element, 'role', 'img');
        setAttribute(element, 'aria-label', title);
        tip(title);
        return;
    }
    const open = 'Open ' + link.name;
    setAttribute(element, 'data-jfmod-open', link.url);
    if (element.closest('[aria-hidden="true"]')) removeAttribute(element, 'tabindex');
    else setAttribute(element, 'tabindex', '0');
    setAttribute(element, 'role', 'link');
    setAttribute(element, 'aria-label', open + ' (' + title + ')');
    tip(title + '\n' + open);
    if (!listening.has(element)) {
        listening.add(element);
        element.addEventListener('click', openLinked);
        element.addEventListener('keydown', openLinked);
    }
};

export const paintDownloadMark = (element: HTMLElement, progress: MarkProgress, size: DownloadMarkSize, extra = '',
    title = progress.tooltip, link: DownloadMarkLink | null = null, hostTip = false) => {
    let state: string = progress.kind === 'releasing' ? 'importing' : progress.kind;
    if (progress.plus && progress.kind === 'downloading') state = 'new-version';
    element.className = ['dm', size, state, size === 'card' ? 'cmark glassy' : '', progress.stale ? 'stale' : '', extra].filter(Boolean).join(' ');
    const drawn = [progress.kind, size, !!progress.plus].join(':');
    if (element.dataset.jfmodDrawn !== drawn) {
        element.innerHTML = inner(progress, size);
        element.dataset.jfmodDrawn = drawn;
    }
    const value = element.querySelector('.arc .val');
    if (value) setAttribute(value, 'stroke-dasharray', (progress.percent ?? 0) + ' 100');
    const number = element.querySelector('.pct')?.firstChild;
    if (number && number.nodeValue !== String(progress.percent ?? 0)) number.nodeValue = String(progress.percent ?? 0);
    element.dataset.jfmodKind = progress.kind;
    paintLink(element, title, link, hostTip);
};

interface DownloadStateMarkProps {
    progress: MarkProgress;
    size: DownloadMarkSize;
    /** Replaces the tooltip. */
    title?: string;
    /** The download client the ring opens (`ringLink`). */
    link?: DownloadMarkLink | null;
    /** The host shows the tooltip itself (the Queue page); the disc keeps its name and drops its native one. */
    hostTip?: boolean;
}

/** The disc in the mod's own views: the episode detail line, the Queue page's rows, the release picker's added row and a missing
 * episode's download block. */
const DownloadStateMark: FC<DownloadStateMarkProps> = ({ progress, size, title, link = null, hostTip = false }) => {
    const ref = useRef<HTMLSpanElement>(null);
    useLayoutEffect(() => {
        if (ref.current) paintDownloadMark(ref.current, progress, size, '', title, link, hostTip);
    }, [progress, size, title, link, hostTip]);
    return <span ref={ref} />;
};

export default DownloadStateMark;
