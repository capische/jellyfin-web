import React, { type FC, type ReactNode } from 'react';
import type { MarkSource } from '../components/ReleaseRowParts';

const HALF = <svg viewBox='0 0 10 14' fill='currentColor' aria-hidden='true'><path d='M0 .5H3.5A6.5 6.5 0 0 1 3.5 13.5H0Z' /></svg>;
const WAVE = <svg viewBox='0 0 24 16' style={{ fill: 'none' }} stroke='currentColor' strokeWidth='2.7' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
    <path d='M2.5 4V12M21.5 4V12' /><path d='M6 8C7.6 3.6 9.4 3.6 12 8S16.4 12.4 18 8' /></svg>;
const CODECS: Record<string, string> = { h264: 'AVC', h265: 'HEVC', av1: 'AV1', xvid: 'XVID', vc1: 'VC-1', mpeg2: 'MPEG-2' };
const Chip: FC<{ children: ReactNode }> = ({ children }) => <span className='mk tag' aria-label={typeof children === 'string' ? children : undefined}><span>{children}</span></span>;
const Format: FC<{ name: string; channels?: string | null; dts?: boolean }> = ({ name, channels, dts }) => <span className='mk' aria-label={dts ? name.replace('DTS-HD MA', 'DTS-HD Master Audio') : 'Dolby ' + name.replace('Digital+', 'Digital Plus')}>
    {dts ? WAVE : HALF}{name}{channels && <span className='chs'>{channels}</span>}</span>;

const SPOKEN: [RegExp, string][] = [[/^DD\+/, 'Dolby Digital Plus'], [/^DD\b/, 'Dolby Digital'], [/^TrueHD/, 'Dolby TrueHD'], [/^DTS-HD MA/, 'DTS-HD Master Audio']];

/**
 * The Audio field's and list's run (option B, the user's pick 2026-11-07): one Dolby or DTS glyph, the stream's short format
 * as `streamAudio` words it (`DD+ Atmos`, `TrueHD`, `DTS-HD MA`, `AAC`) and the channels, as small plain words with no box.
 */
export const AudioTrackMarks: FC<{ parsed: MarkSource }> = ({ parsed }) => {
    const audio = parsed.audio ?? '';
    const channels = parsed.audioChannels;
    if (!audio && !channels) return null;
    let glyph: ReactNode = null;
    if (/^(DD|TrueHD)/.test(audio)) glyph = HALF;
    else if (audio.startsWith('DTS')) glyph = WAVE;
    const spoken = SPOKEN.reduce((text, [match, name]) => text.replace(match, name), audio);
    return <span className='atm' role='img' aria-label={[spoken, channels].filter(Boolean).join(' ')}>
        {glyph}{audio && <span className='w'>{audio}</span>}{channels && <span className='n'>{channels}</span>}
    </span>;
};

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
        {hdr.filter(value => value !== 'DV').map(value => <span key={value} className={'mk hdr' + (value.endsWith('-bit') ? ' depth' : '')}>{value}</span>)}
        {hdr.includes('DV') && <Format name='Vision' />}{audio.includes('Atmos') && <Format name='Atmos' />}{audioMark}
    </>;
};

/** The Dolby two-row lockups of the computer's track controls and chooser (ds.t19, the user 2026-11-09): which one a track shows. */
export type DolbyKind = 'vision' | 'atmos' | 'audio' | 'digitalplus';
const DOLBY: Record<DolbyKind, { word: string; width: number; label: string }> = {
    vision: { word: 'VISION', width: 77, label: 'Dolby Vision' },
    atmos: { word: 'ATMOS', width: 78, label: 'Dolby Atmos' },
    audio: { word: 'AUDIO', width: 77, label: 'Dolby Audio' },
    digitalplus: { word: 'DIGITAL+', width: 90, label: 'Dolby Digital Plus' }
};

/** The double-D block, then DOLBY over the product word, in the text's own colour (workspace `reviews/netflix-tracks/scroll-and-lines.html`). */
export const DolbyLockup: FC<{ kind: DolbyKind }> = ({ kind }) => <svg className='dolby' viewBox={`0 0 ${DOLBY[kind].width} 20`} role='img' aria-label={DOLBY[kind].label}>
    <path fillRule='evenodd' d='M0 0H28V20H0ZM3 3V17H6C10 17 12.5 13.9 12.5 10S10 3 6 3ZM25 3H22C18 3 15.5 6.1 15.5 10S18 17 22 17H25Z' />
    <text className='b' x='32.72' y='8.8'>DOLBY</text><text className='p' x='32.72' y='20'>{DOLBY[kind].word}</text>
</svg>;

/** A video's lockup (Dolby Vision) and its details in reading order: codec, the other ranges and the bit depth. */
export const videoQuiet = (parsed: MarkSource): { lockup: DolbyKind | null; details: string[] } => {
    const hdr = (parsed.hdr ?? '').split(' ').filter(Boolean);
    const codec = parsed.codec ? CODECS[parsed.codec] ?? parsed.codec : null;
    return { lockup: hdr.includes('DV') ? 'vision' : null, details: [codec, ...hdr.filter(value => value !== 'DV')].filter((value): value is string => !!value) };
};

/** An audio stream's lockup (Atmos over DD+ or TrueHD; Digital+ for DD+; Audio for DD or TrueHD) and the format word the details still need. */
export const audioQuiet = (parsed: MarkSource): { lockup: DolbyKind | null; format: string | null } => {
    const audio = parsed.audio ?? '';
    let lockup: DolbyKind | null = null;
    if (/^(DD|TrueHD)/.test(audio)) {
        if (audio.includes('Atmos')) lockup = 'atmos';
        else lockup = audio.startsWith('DD+') ? 'digitalplus' : 'audio';
    }
    const format = audio.split(' ').filter(word => word && word !== 'Atmos').join(' ') || null;
    // The lockup already says plain DD (AUDIO) and DD+ (DIGITAL+), so the details do not repeat it (the user 2026-11-10); TrueHD
    // and the format under Atmos stay, since the lockup does not tell them apart.
    return { lockup, format: (lockup === 'audio' && format === 'DD') || lockup === 'digitalplus' ? null : format };
};

/**
 * A computer's track value (ds.t19, the user 2026-11-09: "one line, details on demand"): the name, the Dolby lockup and the
 * channels on one line; the details are small print that the closed control shows as a paper tip on hover and a chooser row at
 * its right edge.
 */
export const QuietTrack: FC<{ name: ReactNode; lockup?: DolbyKind | null; channels?: string | null; details: (string | null | undefined)[] }> = ({ name, lockup, channels, details }) => {
    const words = details.filter(Boolean).join(' · ');
    return <>{name}{lockup && <DolbyLockup kind={lockup} />}{channels && <span className='chn'>{channels}</span>}{words && <span className='qd'>{words}</span>}</>;
};
