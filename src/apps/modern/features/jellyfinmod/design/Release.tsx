import React, { type FC, type ReactNode, useContext } from 'react';
import { DesignContext } from './Root';
import { DesignMediaMarks } from './MediaMarks';
import { type ReleaseCandidate } from '../types/acquisition';
import { formatSize, qualityText } from '../components/ReleaseRowParts';

/** The stroke set G in ds2.js, shared by relRow, Sources and the picker header. */
export const ReleaseGlyph: FC<{ style?: React.CSSProperties; name: 'plus' | 'swap' | 'tick' | 'incheck' | 'seed' | 'lang' | 'sub' | 'funnel' | 'info' | 'bang' | 'names' | 'client' | 'close' }> = ({ name, style }) => {
    const paths = {
        names: <path d='M5 7H19M5 12H19M5 17H13' />,
        client: <><path d='M12 4V16M7 11L12 16L17 11' /><path d='M5 20H19' /></>,
        close: <path d='M6 6L18 18M18 6L6 18' />,
        plus: <path d='M12 5.5V18.5M5.5 12H18.5' />,
        swap: <><g><path d='M15.38 4.75A8 8 0 0 1 14.07 19.73' /><path d='M15.84 16.67L14.07 19.73L17.13 21.50' /></g><g opacity='.5'><path d='M8.62 19.25A8 8 0 0 1 9.93 4.27' /><path d='M8.16 7.33L9.93 4.27L6.87 2.50' /></g></>,
        tick: <path d='M5 12.5L9.8 17.3L19 8' />,
        incheck: <><circle cx='12' cy='12' r='8.5' /><path d='M8 12.5L10.8 15.3L16 9.5' /></>,
        seed: <path d='M12 19V5M6 11L12 5L18 11' />,
        lang: <><path d='M4 9.5V14.5H8L13 18.5V5.5L8 9.5Z' /><path d='M16.5 9A4.2 4.2 0 0 1 16.5 15' /></>,
        sub: <><rect x='3' y='5' width='18' height='14' rx='2' /><path d='M10.6 10A2.6 2.6 0 1 0 10.6 14M17 10A2.6 2.6 0 1 0 17 14' /></>,
        funnel: <path d='M4 6h16M7 12h10M10 18h4' />,
        info: <><circle cx='12' cy='12' r='8.5' /><path d='M12 11V16.5' /><circle cx='12' cy='7.8' r='1.1' fill='currentColor' stroke='none' /></>,
        bang: <><path d='M12 4.6V12.6' strokeWidth='4.4' /><circle cx='12' cy='19' r='2.2' fill='currentColor' stroke='none' /></>
    };
    return <svg data-ds-glyph={name} viewBox='0 0 24 24' style={{ fill: 'none', ...style }} stroke='currentColor' strokeWidth='2.3' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>{paths[name]}</svg>;
};

/** ds2.js relRow, including its separate three-line phone structure. */
export const Release: FC<{ candidate: ReleaseCandidate; actions: ReactNode; coverage: string | null; progress?: ReactNode;
    names?: boolean; children?: ReactNode }> = ({ candidate: r, actions, coverage, progress, names, children }) => {
    const phone = useContext(DesignContext) === 'phone';
    const device = useContext(DesignContext);
    const left = <><span className='rq'>{qualityText(r.parsed)}</span>
        {r.heldQuality && <span className='incheck' title={r.inLibrary ? 'In library' : 'Quality in library'}><ReleaseGlyph name='incheck' /></span>}
        {r.freeleech && <span className='rflag fl' title='Freeleech'>FL</span>}
        {(r.proper || r.repack) && <span className='rflag pr'>{r.proper ? 'PROPER' : 'REPACK'}</span>}
        {coverage && <span className='rflag'>{coverage}</span>}</>;
    const languages = <>{r.parsed.languages?.length ? <span className='rlang' title='Audio'><ReleaseGlyph name='lang' />{r.parsed.languages.join(' · ')}</span> : null}
        {r.parsed.subtitles?.length ? <span className='rlang' title='Subtitles'><ReleaseGlyph name='sub' />{r.parsed.subtitles.join(' · ')}</span> : null}</>;
    const size = <span className='sz'>{formatSize(r.size)}</span>;
    const seeds = <span className='sd' aria-label={r.seeders === null ? 'Seeders unknown' : r.seeders + ' seeders'}><ReleaseGlyph name='seed' /> {r.seeders ?? '?'}</span>;
    const indexer = r.detailsUrl && device !== 'tv' ? <a data-ds-indexer='' className={phone ? 'focusable' : 'ix focusable'} href={r.detailsUrl} target='_blank' rel='noopener noreferrer'
        onClick={event => event.stopPropagation()} title={'Open on ' + r.indexerName}>{r.indexerName}</a> : <span data-ds-indexer='' className={phone ? undefined : 'ix'}>{r.indexerName}</span>;
    const marks = <span className='marks'><DesignMediaMarks parsed={r.parsed} /></span>;
    return <>{phone ? <>
        <div className='rl'>{left}<span className='rcols'><span>{formatSize(r.size)}</span><span style={{ marginLeft: '.618em' }}><ReleaseGlyph name='seed' style={{ display: 'inline-block', width: '1em', height: '1em', verticalAlign: '-.12em' }} />{r.seeders ?? '?'}</span></span></div>
        <div className='rl'>{languages}<span className='rcols'>{indexer}</span></div>
        <div className='rl'>{marks}{actions}</div>
    </> : <><div className='rl'>{left}{languages}<span className='rcols'>{size}{seeds}{indexer}</span>{actions}</div>
        <div className='rl' style={{ marginTop: '.236em' }}>{marks}</div></>}
    {progress}{children}{names && <div className='rname'>{r.rawTitle} · score {r.score}</div>}
    </>;
};
