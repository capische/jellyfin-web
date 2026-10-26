import classNames from 'classnames';
import React, { type CSSProperties, type FC } from 'react';

import { indexerColour } from '../constants/indexerColours';

/**
 * The search block (release picker redesign, 2026-10-10; docs/jellyfinmod/design/release-picker-searching.md): the G2 torrent
 * ring, a caption and one line per indexer. The ring has a segment per indexer in the indexer's own colour (P4.FU25, user
 * 2026-10-25), its state shown by opacity (waiting faint, asking pulsing, answered full) and a failure in red; each line's dot
 * matches its segment. Nothing in it is focusable, and the glyph is hidden from screen readers: the status line above says
 * the start and the end once.
 */

export type SearchLineKind = 'asking' | 'waiting' | 'ok' | 'none' | 'failed';

export interface SearchLine {
    id: string;
    name: string;
    kind: SearchLineKind;
    text: string;
    /** A failure's full message from the plugin, when it sent one (the Sources line's (i) shows it). */
    message?: string | null;
    /** The indexer's colour index (P4.FU25); absent from older plugins, where the first colour stands in. */
    colorIndex?: number;
}

/** The indexer's colour, for its segment and its line's dot. */
const hue = (colorIndex: number | undefined): CSSProperties => ({ ['--jfmod-ix' as string]: indexerColour(colorIndex) });

export type SearchBlockMode = 'searching' | 'quiet' | 'error';

const CENTRE = 24;
const RADIUS = 19;
const MAX_SEGMENTS = 12;

const point = (degrees: number) => {
    const radians = degrees * Math.PI / 180;
    return (CENTRE + RADIUS * Math.sin(radians)).toFixed(1) + ' ' + (CENTRE - RADIUS * Math.cos(radians)).toFixed(1);
};

/** The arc of segment `index` of `count`, clockwise from the top, with a gap between neighbours (a full ring for one). */
const segmentPath = (index: number, count: number) => {
    if (count === 1) return 'M' + point(0) + 'A' + RADIUS + ' ' + RADIUS + ' 0 1 1 ' + point(359.9);
    const span = 360 / count;
    const gap = Math.min(14, span / 3);
    const start = index * span + gap / 2;
    const end = (index + 1) * span - gap / 2;
    return 'M' + point(start) + 'A' + RADIUS + ' ' + RADIUS + ' 0 ' + (end - start > 180 ? 1 : 0) + ' 1 ' + point(end);
};

// Until the first line is known the ring holds four segments, all asking.
const UNKNOWN: Array<{ id: string; kind: SearchLineKind; colorIndex?: number }> = ['a', 'b', 'c', 'd'].map(id => ({ id, kind: 'asking' }));

const SearchGlyph: FC<{ lines: SearchLine[] }> = ({ lines }) => {
    // Until any indexer has answered the whole ring is asking, so it reads as one search in progress (waiting shows once one has).
    const started = lines.some(line => line.kind !== 'asking' && line.kind !== 'waiting');
    const segments = (lines.length > 0 ? lines.map(line => started ? line : { ...line, kind: 'asking' as const }) : UNKNOWN).slice(0, MAX_SEGMENTS);
    return <svg className='jfmod-searchGlyph' viewBox='0 0 48 48' fill='none' stroke='currentColor' strokeWidth='3.2'
        strokeLinecap='round' aria-hidden='true' focusable='false'>
        <g className='jfmod-searchGlyph-segs'>
            {segments.map(({ id, kind, colorIndex }, index) => <path key={id}
                className={classNames('jfmod-searchGlyph-seg jfmod-searchGlyph-seg--' + kind, { 'jfmod-searchGlyph-seg--known': lines.length > 0 })}
                d={segmentPath(index, segments.length)} style={{ ...hue(colorIndex), animationDelay: (index * 0.2).toFixed(2) + 's' }} />)}
        </g>
        <g><path d='M24 15.5V32' /><path d='M18.3 26.3L24 32L29.7 26.3' /></g>
    </svg>;
};

interface SearchBlockProps {
    mode: SearchBlockMode;
    caption: string;
    lines: SearchLine[];
    /** A new search over rows of the last one: the block sits over them on a panel of the paper colour. */
    over?: boolean;
}

export const SearchBlock: FC<SearchBlockProps> = ({ mode, caption, lines, over }) =>
    <div className={classNames('jfmod-searchBlock', `jfmod-searchBlock--${mode}`, { 'jfmod-searchBlock--over': over })}>
        <SearchGlyph lines={lines} />
        <p className='jfmod-searchCaption' aria-hidden='true'>{caption}</p>
        {/* The lines change silently; the status line above says the end once. */}
        <ul className='jfmod-searchIndexers' aria-live='off'>
            {lines.map(line => <li key={line.id} className={'jfmod-searchIndexer jfmod-searchIndexer--' + line.kind}>
                <span className='jfmod-searchIndexer-dot' style={hue(line.colorIndex)} />
                <span className='jfmod-searchIndexer-name'>{line.name}</span>
                <span className='jfmod-searchIndexer-state'>{line.text}</span>
            </li>)}
        </ul>
    </div>;
