import React, { type FC, useLayoutEffect, useRef } from 'react';
import type { MarkProgress } from '../constants/queue';
import { paintLink, type DownloadMarkLink } from '../components/DownloadStateMark';
import { Cloud } from './Icon';

const stateGlyph = (kind: string, state: string) => {
    let glyph = <path d='M12 4V20M6 14L12 20L18 14' />;
    if (state === 'new-version') glyph = <path d='M12 5.5V18.5M5.5 12H18.5' />;
    if (kind === 'failed') glyph = <><path d='M12 4.6V12.6' strokeWidth='4.4' /><circle cx='12' cy='19' r='2.2' fill='currentColor' stroke='none' /></>;
    if (kind === 'stalled') glyph = <path d='M9 6V18M15 6V18' />;
    if (['queued', 'unaired'].includes(kind)) glyph = <><circle cx='12' cy='12' r='8.5' /><path d='M12 7.5V12L15 14' /></>;
    if (kind === 'seeding' || kind === 'releasing') glyph = <path d='M12 20V7M6.5 12.5L12 7L17.5 12.5' />;
    return glyph;
};

/** ds2.js dm: same SVGs, ring geometry and page-only percent. Client links retain their existing permission logic. */
export const DownloadMark: FC<{ progress?: MarkProgress | null; kind?: string; size: 'page' | 'row' | 'card'; link?: DownloadMarkLink | null; title?: string; hostTip?: boolean }> = ({ progress, kind: resting, size, link, title, hostTip }) => {
    const ref = useRef<HTMLSpanElement>(null);
    const kind = progress?.kind ?? resting ?? 'not-downloaded';
    let state = kind === 'releasing' ? 'importing' : kind;
    if (progress?.plus && kind === 'downloading') state = 'new-version';
    const arc = ['downloading', 'stalled', 'seeding', 'importing', 'releasing'].includes(kind);
    const turning = kind === 'importing' || kind === 'releasing';
    const numbered = size === 'page' && ['downloading', 'stalled'].includes(kind);
    const sw = { card: 2.6, row: 2.2, page: 2.4 }[size];
    useLayoutEffect(() => {
        if (ref.current) paintLink(ref.current, title ?? progress?.tooltip ?? (kind === 'unaired' ? 'Unaired' : 'Not Downloaded'), link, hostTip);
    }, [progress, kind, link, title, hostTip]);
    const glyph = stateGlyph(kind, state);
    let inner = <svg className={'glyph' + (kind === 'downloading' && !progress?.plus ? ' bob' : '')} viewBox='0 0 24 24' style={{ fill: 'none' }} stroke='currentColor' strokeWidth='2.3' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>{glyph}</svg>;
    if (numbered) inner = <span className='pct'>{progress?.percent ?? 0}<small>%</small></span>;
    if (kind === 'not-downloaded') inner = <Cloud className='glyph' />;
    return <span ref={ref} className={'dm ' + size + ' ' + state + (progress?.stale ? ' stale' : '')} data-jfmod-kind={kind}>
        {arc && <svg className='arc' viewBox='0 0 36 36'><circle cx='18' cy='18' r='15.9' fill='none' stroke={size === 'card' ? 'var(--card-track)' : 'var(--ring-track)'} strokeWidth={sw} />
            <circle className={turning ? 'turn' : 'val'} cx='18' cy='18' r='15.9' fill='none' stroke='currentColor' strokeWidth={sw} strokeLinecap='round' pathLength='100'
                strokeDasharray={turning ? '28 72' : `${progress?.percent ?? 0} 100`} /></svg>}
        {inner}
    </span>;
};
