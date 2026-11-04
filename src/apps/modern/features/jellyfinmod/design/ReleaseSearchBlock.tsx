import classNames from 'classnames';
import React, { type FC } from 'react';

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
    colorIndex?: number;
}

export type SearchBlockMode = 'searching' | 'quiet' | 'error';

const stateOpacity = (kind: string) => ({ waiting: '.3', asking: '.7' }[kind] ?? '1');

const SearchGlyph: FC<{ lines: SearchLine[] }> = ({ lines }) => {
    const segments = lines.length ? lines : [{ id: 'waiting', kind: 'asking', colorIndex: undefined }];
    const circumference = 2 * Math.PI * 20;
    const segment = circumference / segments.length;
    return <svg className='gl' viewBox='0 0 48 48' style={{ fill: 'none' }} stroke='currentColor' strokeWidth='3.2'
        strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'><g transform='rotate(-90 24 24)'>
            {segments.map((line, index) => <circle key={line.id} cx='24' cy='24' r='20' stroke={line.kind === 'failed' ? '#e53935' : indexerColour(line.colorIndex)}
                opacity={stateOpacity(line.kind)}
                strokeDasharray={(segment - 2.6).toFixed(2) + ' ' + (circumference - segment + 2.6).toFixed(2)} strokeDashoffset={(-index * segment).toFixed(2)} />)}
        </g><g><path d='M24 15.5V32' /><path d='M18.3 26.3L24 32L29.7 26.3' /></g></svg>;
};

interface SearchBlockProps {
    mode: SearchBlockMode;
    caption: string;
    lines: SearchLine[];
    /** A new search over rows of the last one: the block sits over them on a panel of the paper colour. */
    over?: boolean;
}

export const SearchBlock: FC<SearchBlockProps> = ({ mode, caption, lines }) =>
    <div className={classNames('sblock', { dimmed: mode === 'quiet', err: mode === 'error' })}>
        <SearchGlyph lines={lines} /><p className='cap1' aria-hidden='true'>{caption}</p>
        {lines.map(line => <div className='sl' key={line.id} aria-live='off'><span><i style={{ background: line.kind === 'failed' ? '#e53935' : indexerColour(line.colorIndex),
            opacity: stateOpacity(line.kind) }} />{line.name}</span><span className={line.kind === 'failed' ? 'fail' : undefined}>{line.text}</span></div>)}
    </div>;
