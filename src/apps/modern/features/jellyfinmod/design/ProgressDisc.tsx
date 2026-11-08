import React, { type FC, useLayoutEffect, useRef, useState } from 'react';
import type { BatchProgress, DownloadProgress } from '../constants/queue';

/**
 * The card's centre disc while anything of its title is on its way (ds.t16, the user 2026-11-07; workspace
 * reviews/progress-ratings/download.html): the card glass disc (3.236em) becomes a progress ring with the percent inside. A
 * series' ring is cut into one segment per episode on its way (a wider gap between seasons) with "3 of 12" under the percent;
 * above 24 episodes one ring. Queued turns a segment on the track with the clock, importing the corner mark's turning segment with
 * the arrow, stalled dims to 55 %, failed is the bang. When the download ends with its file the ring closes, a check draws in and
 * holds φ s, then the card's own disc (Play, or Download) comes back. It is an indicator: a click on it is a click on the card.
 *
 * One painter for both of its homes: the cards the download integration paints (`paintCellDownload`) and the series page's
 * episode card (`ProgressDisc`). It keeps its DOM between reads, so the arc and the figure move to each new value.
 */

export type DiscMode = 'queued' | 'downloading' | 'stalled' | 'importing' | 'failed' | 'done';

export interface DiscState {
    mode: DiscMode;
    /** 0..100. */
    percent: number;
    /** One per episode on its way, in order, each 0..1; a series' ring is cut into them (2 to 24 of them). */
    segments?: { season: number; fill: number }[];
    /** Episodes in the library of those on their way: "3 of 12". */
    done?: number;
    total?: number;
}

/** A download as the disc draws it: a batch (a series or a season card) carries its segments and its "n of m". */
export const discState = (progress: DownloadProgress & Partial<Pick<BatchProgress, 'done' | 'total' | 'segments'>>): DiscState => ({
    mode: progress.kind,
    percent: progress.kind === 'importing' ? 100 : progress.percent ?? 0,
    segments: progress.segments,
    done: progress.total ? progress.done : undefined,
    total: progress.total || undefined
});

const SVG = 'http://www.w3.org/2000/svg';
/** viewBox 100: the ring's stroke is s-3 of the disc (7.3), inset s-4 (4.5). */
const R = 50 - 4.5 - 3.65;
/** Between episodes, in pathLength units of 100; between seasons φ² of it. */
const GAP = 2.2;
const SEASON_GAP = GAP * 2.618;
const MAX_SEGMENTS = 24;
/** The ring closes (φ⁻¹ s) and the check draws in, then holds φ¹ s. */
const DONE_MS = 618 + 1618;

const GLYPHS: Record<string, string> = {
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12L15 14"/>',
    arrow: '<path d="M12 4V20M6 14L12 20L18 14"/>',
    check: '<path class="ck" pathLength="1" d="M5 12.5l4.5 4.5L19 7.5"/>',
    bang: '<path d="M12 4.6V12.6" stroke-width="4.4"/><circle cx="12" cy="19" r="2.2" fill="currentColor" stroke="none"/>'
};

const reduced = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const onTv = () => document.documentElement.classList.contains('layout-tv');

const circle = (className: string, dash: string, rotate = 0) => {
    const turn = rotate ? ' transform="rotate(' + rotate.toFixed(2) + ' 50 50)"' : '';
    return `<circle class="${className}" cx="50" cy="50" r="${R}" pathLength="100" stroke-dasharray="${dash}"${turn}/>`;
};

const layout = (segments: { season: number }[]) => {
    const gapAfter = (index: number) => (segments[(index + 1) % segments.length].season !== segments[index].season ? SEASON_GAP : GAP);
    const gaps = segments.reduce((sum, _segment, index) => sum + gapAfter(index), 0);
    const length = (100 - gaps) / segments.length;
    let at = 0;
    return segments.map((_segment, index) => {
        const start = at;
        at += length + gapAfter(index);
        return { start, length };
    });
};

const split = (state: DiscState) => !!state.segments && state.segments.length > 1 && state.segments.length <= MAX_SEGMENTS;

const ringHtml = (state: DiscState) => {
    if (!split(state)) return `<svg viewBox="0 0 100 100" class="cont">${circle('tr', 'none')}${circle('va', '0 100')}</svg>`;
    return '<svg viewBox="0 0 100 100" class="seg">' + layout(state.segments!).map(({ start, length }) =>
        '<g>' + circle('tr', length.toFixed(3) + ' 100', start * 3.6) + circle('va', '0 100', start * 3.6) + '</g>').join('') + '</svg>';
};

const build = (host: HTMLElement) => {
    const glyph = (name: string) => `<span class="ly gl" data-g="${name}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[name]}</svg></span>`;
    host.innerHTML = '<span class="ly ring"></span>'
        + `<span class="ly spin spinq"><svg viewBox="0 0 100 100">${circle('tr', 'none')}${circle('sg', '23.6 100')}</svg></span>`
        + `<span class="ly spin spini"><svg viewBox="0 0 100 100">${circle('tr', 'none')}${circle('sg', '28 72')}</svg></span>`
        + ['clock', 'arrow', 'check', 'bang'].map(glyph).join('')
        + '<span class="ly num"><span class="pc"><span class="v">0</span><small>%</small></span><span class="sub"><span></span></span></span>';
    for (const svg of Array.from(host.querySelectorAll('svg'))) svg.setAttribute('xmlns', SVG);
};

interface Painted {
    state: DiscState;
    ringKey: string;
    tween?: number;
    finish?: number;
}

const painted = new WeakMap<HTMLElement, Painted>();

const countTo = (element: HTMLElement, record: Painted, to: number) => {
    if (record.tween) cancelAnimationFrame(record.tween);
    const from = Number.parseInt(element.textContent ?? '', 10) || 0;
    if (from === to || reduced() || onTv() || !element.isConnected) {
        element.textContent = String(to);
        return;
    }
    const began = performance.now();
    const step = (now: number) => {
        const x = Math.min(1, (now - began) / 618);
        element.textContent = String(Math.round(from + (to - from) * (1 - Math.pow(1 - x, 3))));
        if (x < 1) record.tween = requestAnimationFrame(step);
    };
    record.tween = requestAnimationFrame(step);
};

/** The arc: each segment's fill, or the one ring's percent; done closes them all into one ring. */
const paintRing = (host: HTMLElement, record: Painted, state: DiscState) => {
    const done = state.mode === 'done';
    const ringKey = split(state) ? state.segments!.map(segment => segment.season).join(',') : 'cont';
    const ring = host.querySelector<HTMLElement>('.ring')!;
    if (ringKey !== record.ringKey && !(done && record.ringKey)) {
        ring.innerHTML = ringHtml(state);
        record.ringKey = ringKey;
    }
    const values = Array.from(ring.querySelectorAll<SVGCircleElement>('.va'));
    if (done) {
        for (const value of values) value.setAttribute('stroke-dasharray', '100 0');
        for (const track of Array.from(ring.querySelectorAll('.tr'))) track.setAttribute('stroke-dasharray', 'none');
    } else if (split(state) && values.length === state.segments!.length) {
        const lengths = layout(state.segments!);
        values.forEach((value, index) => {
            value.setAttribute('stroke-dasharray', (lengths[index].length * Math.min(1, Math.max(0, state.segments![index].fill))).toFixed(3) + ' 100');
        });
    } else if (values[0]) {
        values[0].setAttribute('stroke-dasharray', Math.min(100, Math.max(0, state.percent)) + ' 100');
    }
};

/** The words under the percent: "3 of 12" for a split series, "Stalled"; new words roll up from below (φ⁻² s). */
const paintWords = (host: HTMLElement, record: Painted, state: DiscState) => {
    let words = '';
    if (state.mode === 'stalled') words = 'Stalled';
    else if (split(state) && state.total) words = `${state.done ?? 0} of ${state.total}`;
    const sub = host.querySelector<HTMLElement>('.sub')!;
    const line = sub.querySelector('span')!;
    if (line.textContent !== words) {
        line.textContent = words;
        line.classList.remove('roll');
        if (words && record.state.mode !== 'done') {
            line.getBoundingClientRect();
            line.classList.add('roll');
        }
    }
    sub.classList.toggle('none', !words);
};

/** Paints the disc for a state, in place: a new value moves the arc and counts the figure; a new mode swaps the layers. */
export const paintProgressDisc = (host: HTMLElement, state: DiscState) => {
    let record = painted.get(host);
    if (!record) {
        build(host);
        record = { state, ringKey: '' };
        painted.set(host, record);
    }
    window.clearTimeout(record.finish);
    record.finish = undefined;
    paintRing(host, record, state);
    const mode = state.mode;
    const on = (selector: string, yes: boolean) => host.querySelector(selector)?.classList.toggle('on', yes);
    on('.ring', ['downloading', 'stalled', 'done'].includes(mode));
    on('.spinq', mode === 'queued');
    on('.spini', mode === 'importing');
    on('[data-g="clock"]', mode === 'queued');
    on('[data-g="arrow"]', mode === 'importing');
    on('[data-g="check"]', mode === 'done');
    on('[data-g="bang"]', mode === 'failed');
    on('.num', mode === 'downloading' || mode === 'stalled');
    host.classList.toggle('stalled', mode === 'stalled');
    host.classList.toggle('failed', mode === 'failed');
    host.classList.toggle('done', mode === 'done');
    countTo(host.querySelector<HTMLElement>('.num .v')!, record, Math.floor(state.percent));
    paintWords(host, record, state);
    record.state = state;
};

/**
 * The download ended: a disc that showed the import (or a full arc) closes its ring and draws the check, holds it, then calls
 * `gone`; anything else (a cancelled download) goes at once. True while it is finishing.
 */
export const finishProgressDisc = (host: HTMLElement, gone: () => void): boolean => {
    const record = painted.get(host);
    if (record?.finish) return true;
    const last = record?.state;
    if (!record || !last || !(last.mode === 'importing' || (last.mode === 'downloading' && last.percent >= 100))) {
        gone();
        return false;
    }
    paintProgressDisc(host, { ...last, mode: 'done', percent: 100 });
    record.finish = window.setTimeout(() => {
        record.finish = undefined;
        gone();
    }, reduced() ? 1618 : DONE_MS);
    return true;
};

/** The disc as a React element, for a card React draws itself (the series page's episode card). */
export const ProgressDisc: FC<{ state: DiscState | null }> = ({ state }) => {
    const ref = useRef<HTMLSpanElement>(null);
    const [shown, setShown] = useState(!!state);
    useLayoutEffect(() => {
        const host = ref.current;
        if (state) {
            setShown(true);
            if (host) paintProgressDisc(host, state);
        } else if (host) {
            finishProgressDisc(host, () => setShown(false));
        }
    }, [state, shown]);
    if (!state && !shown) return null;
    return <span ref={ref} className='disc hov glassy jfmod-pdisc' aria-hidden='true' />;
};
