import React, { type FC, type ReactNode } from 'react';
import type { MarkSource } from '../components/ReleaseRowParts';

const HALF = <svg viewBox='0 0 10 14' fill='currentColor' aria-hidden='true'><path d='M0 .5H3.5A6.5 6.5 0 0 1 3.5 13.5H0Z' /></svg>;
const WAVE = <svg viewBox='0 0 24 16' style={{ fill: 'none' }} stroke='currentColor' strokeWidth='2.7' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
    <path d='M2.5 4V12M21.5 4V12' /><path d='M6 8C7.6 3.6 9.4 3.6 12 8S16.4 12.4 18 8' /></svg>;
const CODECS: Record<string, string> = { h264: 'AVC', h265: 'HEVC', av1: 'AV1', xvid: 'XVID', vc1: 'VC-1', mpeg2: 'MPEG-2' };
const Chip: FC<{ children: ReactNode }> = ({ children }) => <span className='mk tag' aria-label={typeof children === 'string' ? children : undefined}><span>{children}</span></span>;
const Format: FC<{ name: string; channels?: string | null; dts?: boolean }> = ({ name, channels, dts }) => <span className='mk' aria-label={dts ? name.replace('DTS-HD MA', 'DTS-HD Master Audio') : 'Dolby ' + name.replace('Digital+', 'Digital Plus')}>
    {dts ? WAVE : HALF}{name}{channels && <span className='chs'>{channels}</span>}</span>;

/** ds2.js mk/chip/join/dolby/dts; data stays the existing parsed stream/release facts. */
export const DesignMediaMarks: FC<{ parsed: MarkSource }> = ({ parsed }) => {
    const hdr = (parsed.hdr ?? '').split(' ').filter(Boolean);
    const audio = parsed.audio ?? '';
    const format = ['TrueHD', 'DD+', 'DD', 'DTS-HD MA', 'DTS:X', 'DTS'].find(value => new RegExp('\\b' + value.replace('+', '\\+')).test(audio));
    let audioMark: ReactNode;
    if (format) {
        let name = format;
        if (format === 'DD+') name = 'Digital+';
        if (format === 'DD') name = 'Digital';
        audioMark = <Format name={name}
            channels={parsed.audioChannels} dts={format.startsWith('DTS')} />;
    } else {
        const name = audio.split(' ').find(value => value && value !== 'Atmos');
        if (name) audioMark = parsed.audioChannels ? <span className='join'><Chip>{name.toUpperCase()}</Chip><span className='mk ch'>{parsed.audioChannels}</span></span> : <Chip>{name.toUpperCase()}</Chip>;
    }
    return <>
        {parsed.codec && <span className='mk codec'>{CODECS[parsed.codec] ?? parsed.codec}</span>}
        {hdr.filter(value => value !== 'DV').map(value => <span key={value} className='mk hdr'>{value}</span>)}
        {hdr.includes('DV') && <Format name='Vision' />}{audio.includes('Atmos') && <Format name='Atmos' />}{audioMark}
    </>;
};
