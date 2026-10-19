import React, { type FC, useLayoutEffect, useRef } from 'react';

import layoutManager from 'components/layoutManager';

import type { DownloadProgress } from '../constants/queue';
import type { QueueRow } from '../types/queue';

import './downloadStateMark.scss';

/**
 * The download state ring family (P4.FU6, user-approved design 2026-10-13, `design/download-state-ring-family.html`): one disc,
 * one arc, a glyph per state. Downloading is the arrow with the icon-colour arc at its percent, stalled the pause glyph with the arc
 * dimmed, queued a clock, importing a spinning arc, failed a red bang. The figure is never inside the ring: it is the meta
 * line's (`DownloadProgress.text`) and every disc's tooltip (`DownloadProgress.tooltip`). Three sizes: `card`, a 1.6em dark disc
 * in a card's top-right corner, `row`, the 2.5em first round icon of a row's end slot, transparent like upstream's, and `page`,
 * the 4em ring of a missing episode's download block, the one place the percent is inside the ring (P1.FU20, user-approved
 * 2026-10-13) while it downloads or stalls.
 *
 * One painter for every place: `paintDownloadMark` draws into an element, so the cards and rows that `downloadMarks` finds on
 * upstream's pages and the mod's own React views (`DownloadStateMark`) share the same markup. The arc is a 36-unit circle of
 * radius 15.9 (a circumference of 100), drawn from the top by `stroke-dashoffset = 100 − percent`.
 */

export type DownloadMarkSize = 'card' | 'row' | 'page';

const GLYPHS: Record<DownloadProgress['kind'], string> = {
    downloading: '<path d="M12 4V17"/><path d="M6.5 11.5L12 17L17.5 11.5"/>',
    queued: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12L15 14"/>',
    stalled: '<path d="M9 6V18M15 6V18" stroke-width="2.8"/>',
    importing: '<path d="M4 12A8 8 0 0 1 17.5 6.3"/><path d="M17.5 2.5V6.5H13.5"/>',
    failed: '<path d="M12 5V14"/><circle cx="12" cy="18.6" r="1.4" fill="currentColor" stroke="none"/>'
};

/** The arc: a track and the fill; only downloading, stalled and importing (a turning 28 % segment) draw one. */
const ARC = '<svg class="jfmod-dlmark-arc" viewBox="0 0 36 36" aria-hidden="true" focusable="false">'
    + '<circle class="jfmod-dlmark-track" cx="18" cy="18" r="15.9"/>'
    + '<circle class="jfmod-dlmark-fill" cx="18" cy="18" r="15.9" pathLength="100"/></svg>';

const hasArc = (kind: DownloadProgress['kind']) => kind === 'downloading' || kind === 'stalled' || kind === 'importing';

const inner = (kind: DownloadProgress['kind']) => (hasArc(kind) ? ARC : '')
    + '<svg class="jfmod-dlmark-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="'
    + (kind === 'failed' ? '2.8' : '2.4') + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'
    + GLYPHS[kind] + '</svg>';

/** The page ring's figure in place of the glyph: `42` and a small `%`. */
const NUMBER = '<b class="jfmod-dlmark-num" aria-hidden="true"><span class="jfmod-dlmark-numValue"></span><i>%</i></b>';

/** Whether the ring holds its percent instead of the glyph: the page size while a figure moves. */
const numbered = (kind: DownloadProgress['kind'], size: DownloadMarkSize) =>
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

/** The states whose ring opens the client: the torrent is in it. Failed, finished and the file-state marks never do. */
const LINKED = new Set<DownloadProgress['kind']>(['queued', 'downloading', 'importing', 'stalled']);

/**
 * The client link a ring opens (user, 2026-10-19: "The buttons only", "Administrators only"): the first of the rows' clients with
 * a web link. The queue names a row's client for administrators only (`client`, null for everyone else), and its `openUrl` is the
 * client's saved Web interface link, so an ordinary user's ring, or one whose client has no saved link, stays an indicator. Never
 * on the TV, where nothing can open a tab.
 */
export const ringLink = (rows: Array<QueueRow | null | undefined>, progress: DownloadProgress | null | undefined): DownloadMarkLink | null => {
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
 * tooltip the state and then "Open Transmission".
 */
const paintLink = (element: HTMLElement, title: string, link: DownloadMarkLink | null | undefined) => {
    element.classList.toggle('jfmod-dlmark--link', !!link);
    if (!link) {
        removeAttribute(element, 'data-jfmod-open');
        removeAttribute(element, 'tabindex');
        setAttribute(element, 'role', 'img');
        setAttribute(element, 'aria-label', title);
        if (element.title !== title) element.title = title;
        return;
    }
    const open = 'Open ' + link.name;
    setAttribute(element, 'data-jfmod-open', link.url);
    if (element.closest('[aria-hidden="true"]')) removeAttribute(element, 'tabindex');
    else setAttribute(element, 'tabindex', '0');
    setAttribute(element, 'role', 'link');
    setAttribute(element, 'aria-label', open + ' (' + title + ')');
    if (element.title !== title + '\n' + open) element.title = title + '\n' + open;
    if (!listening.has(element)) {
        listening.add(element);
        element.addEventListener('click', openLinked);
        element.addEventListener('keydown', openLinked);
    }
};

/** The arc's length: the percent, or importing's turning 28 % segment. */
const paintArc = (element: HTMLElement, progress: DownloadProgress) => {
    const fill = element.querySelector<SVGElement>('.jfmod-dlmark-fill');
    if (!fill) return;
    const importing = progress.kind === 'importing';
    setAttribute(fill, 'stroke-dasharray', importing ? '28 72' : '100');
    const offset = importing ? '0' : String(100 - (progress.percent ?? 0));
    if (fill.style.strokeDashoffset !== offset) fill.style.strokeDashoffset = offset;
};

/**
 * Draws the disc into `element` (a `span`), changing only what differs, so the arc's 0.35 s move from one poll's percent to
 * the next is kept. `extra` adds placement classes (a card's lone corner disc). `title` replaces the tooltip. `link` makes it
 * open the download client (`ringLink`).
 */
export const paintDownloadMark = (element: HTMLElement, progress: DownloadProgress, size: DownloadMarkSize, extra = '',
    title = progress.tooltip, link: DownloadMarkLink | null = null) => {
    const className = ['jfmod-dlmark', 'jfmod-dlmark--' + size, 'jfmod-dlmark--' + progress.kind,
        progress.stale ? 'jfmod-dlmark--stale' : '', link ? 'jfmod-dlmark--link' : '', extra].filter(Boolean).join(' ');
    if (element.className !== className) element.className = className;
    const withNumber = numbered(progress.kind, size);
    const drawn = progress.kind + (withNumber ? ' number' : '');
    if (element.getAttribute('data-jfmod-kind') !== progress.kind || element.getAttribute('data-jfmod-drawn') !== drawn) {
        element.setAttribute('data-jfmod-kind', progress.kind);
        element.setAttribute('data-jfmod-drawn', drawn);
        element.innerHTML = withNumber ? ARC + NUMBER : inner(progress.kind);
    }
    const value = element.querySelector('.jfmod-dlmark-numValue');
    if (value && value.textContent !== String(progress.percent ?? 0)) value.textContent = String(progress.percent ?? 0);
    paintArc(element, progress);
    paintLink(element, title, link);
};

interface DownloadStateMarkProps {
    progress: DownloadProgress;
    size: DownloadMarkSize;
    /** Replaces the tooltip. */
    title?: string;
    /** The download client the ring opens (`ringLink`). */
    link?: DownloadMarkLink | null;
}

/** The disc in the mod's own views: the episode detail line, the Queue page's rows, the release picker's added row and a missing
 * episode's download block. */
const DownloadStateMark: FC<DownloadStateMarkProps> = ({ progress, size, title, link = null }) => {
    const ref = useRef<HTMLSpanElement>(null);
    useLayoutEffect(() => {
        if (ref.current) paintDownloadMark(ref.current, progress, size, '', title, link);
    }, [progress, size, title, link]);
    return <span ref={ref} />;
};

export default DownloadStateMark;
