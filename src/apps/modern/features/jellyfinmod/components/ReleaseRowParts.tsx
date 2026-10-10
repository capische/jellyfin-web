import React, { type FC, Fragment, type ReactNode } from 'react';

import layoutManager from 'components/layoutManager';

// webpack's `?raw` rule (webpack.common.js) hands these over as text; the eslint resolver does not know the query.
// eslint-disable-next-line import/no-unresolved
import dolbyDd from '../assets/media-marks/dolby-dd.svg?raw';
// eslint-disable-next-line import/no-unresolved
import dolbyDdPlus from '../assets/media-marks/dolby-ddplus.svg?raw';
// eslint-disable-next-line import/no-unresolved
import dolbyHalf from '../assets/media-marks/dolby-half.svg?raw';
// eslint-disable-next-line import/no-unresolved
import dtsFamily from '../assets/media-marks/dts-family.svg?raw';
import type { ParsedRelease, ReleaseCandidate } from '../types/acquisition';

/**
 * The parts of a release row (release picker redesign, 2026-10-10; docs/jellyfinmod/design/release-picker-design.md): the
 * quality, flags, language lines, media marks and the right-hand columns. Glyphs are inline strokes in `currentColor`, so
 * they follow the text colour in both schemes and need no icon font.
 */

const SOURCES = new Map([
    ['remux', 'Remux'], ['bluray', 'BluRay'], ['webdl', 'WEB-DL'], ['webrip', 'WEBRip'], ['hdtv', 'HDTV'], ['dvd', 'DVD'], ['cam', 'CAM']
]);
const CODECS = new Map([['h264', 'AVC'], ['h265', 'HEVC'], ['av1', 'AV1'], ['xvid', 'XVID'], ['vc1', 'VC-1'], ['mpeg2', 'MPEG-2']]);
const LANGUAGE_NAMES = new Map([
    ['EN', 'English'], ['FR', 'French'], ['DE', 'German'], ['ES', 'Spanish'], ['IT', 'Italian'], ['PT', 'Portuguese'],
    ['RU', 'Russian'], ['JA', 'Japanese'], ['KO', 'Korean'], ['ZH', 'Chinese'], ['NL', 'Dutch'], ['PL', 'Polish'],
    ['SV', 'Swedish'], ['TR', 'Turkish'], ['HI', 'Hindi'], ['AR', 'Arabic'], ['MULTI', 'Multiple languages'], ['DUAL', 'Dual audio'],
    ['SUB', 'Subtitled']
]);

export const formatSize = (bytes: number | null) => {
    if (bytes === null) return '—';
    // The mock writes every size in GB with one decimal (0.4 GB, 9.8 GB); only the very small stay in MB.
    if (bytes >= 1e8) return (bytes / 1e9).toFixed(1) + ' GB';
    return Math.max(1, Math.round(bytes / 1e6)) + ' MB';
};

/** `2160p WEB-DL`: the resolution and source only; everything else becomes a mark or a line of its own. */
export const qualityText = (parsed: ParsedRelease) => {
    const source = parsed.source ? SOURCES.get(parsed.source) ?? parsed.source : null;
    return [parsed.resolution, source].filter(Boolean).join(' ') || 'Unknown quality';
};

const names = (codes: string[]) => codes.map(code => LANGUAGE_NAMES.get(code) ?? code).join(', ');

/** The 24-unit stroke glyphs of the row, as the design lists them. */
const Glyph: FC<{ className: string; children: ReactNode }> = ({ className, children }) =>
    <svg className={className} viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.2' strokeLinecap='round'
        strokeLinejoin='round' aria-hidden='true'>{children}</svg>;

const SeedsGlyph: FC = () => <Glyph className='jfmod-releaseGlyph-small'><path d='M12 19V5M6 11L12 5L18 11' /></Glyph>;
const HeldGlyph: FC = () => <Glyph className='jfmod-releaseGlyph-small'>
    <circle cx='12' cy='12' r='8.5' /><path d='M8 12.5L10.8 15.3L16 9.5' />
</Glyph>;
const AudioGlyph: FC = () => <Glyph className='jfmod-releaseGlyph-small'>
    <path d='M4 9.5V14.5H8L13 18.5V5.5L8 9.5Z' /><path d='M16.5 9A4.2 4.2 0 0 1 16.5 15' /><path d='M19.2 6.3A8.2 8.2 0 0 1 19.2 17.7' />
</Glyph>;
const SubtitleGlyph: FC = () => <Glyph className='jfmod-releaseGlyph-small'>
    <rect x='3' y='5' width='18' height='14' rx='2' /><path d='M10.6 10A2.6 2.6 0 1 0 10.6 14M17 10A2.6 2.6 0 1 0 17 14' />
</Glyph>;

/**
 * Format marks (user, 2026-10-11): each Dolby format is a filled chip, kept together on the marks line. DD and DD+ are one
 * icon-only chip (two solid half-discs, with a plus for DD+); Vision, Atmos and TrueHD are a half-disc and the word knocked
 * out of the chip, and each DTS format is this fork's wave and the word. The channel count (5.1, 7.1) is the second piece of
 * audio: an outlined tag after the filled chip. The drawings are this fork's own SVG files (assets/media-marks), original and
 * not the vendors' logos; a chip names its format for screen readers, since the icon-only ones carry no word.
 */
type Chip = { icon: string; modifier: string; label: string; tier?: string };
/** `audio` marks the audio marks: a divider separates them from the video ones, and the channel count joins the last. */
type Mark = { key: string; className: string; text: string; chip?: Chip; audio?: boolean };

const chipMark = (key: string, label: string, icon: string, modifier: string, text = '', audio = false, tier?: string): Mark =>
    ({ key, className: '', text, chip: { icon, modifier, label, tier }, audio });

const VISION_MARK = chipMark('dv', 'Dolby Vision', dolbyHalf, 'half', 'Vision');
const ATMOS_MARK = chipMark('atmos', 'Dolby Atmos', dolbyHalf, 'half', 'Atmos', true);
/** The first audio format that matches wins; Atmos is a mark of its own beside it. */
const AUDIO_MARKS: Array<[RegExp, Mark]> = [
    [/\bTrueHD\b/, chipMark('truehd', 'Dolby TrueHD', dolbyHalf, 'half', 'TrueHD', true)],
    [/\bDD\+/, chipMark('ddp', 'Dolby Digital Plus', dolbyDdPlus, 'ddplus', '', true)],
    [/\bDD\b/, chipMark('dd', 'Dolby Digital', dolbyDd, 'dd', '', true)],
    [/\bDTS-HD MA\b/, chipMark('dtshd', 'DTS-HD Master Audio', dtsFamily, 'wave', 'DTS-HD', true, 'MA')],
    [/\bDTS:X\b/, chipMark('dtsx', 'DTS:X', dtsFamily, 'wave', 'DTS:X', true)],
    [/\bDTS\b/, chipMark('dts', 'DTS', dtsFamily, 'wave', 'DTS', true)]
];

/**
 * Codec, then the HDR marks, then the Dolby group together (Vision, Atmos, the audio format), as the design draws them;
 * `parsed.audio` is the plugin's `TrueHD Atmos` style string.
 */
const marksOf = (parsed: ParsedRelease): Mark[] => {
    const marks: Mark[] = [];
    if (parsed.codec) marks.push({ key: 'codec', className: 'jfmod-releaseMark--codec', text: CODECS.get(parsed.codec) ?? parsed.codec });
    const hdr = (parsed.hdr ?? '').split(' ').filter(Boolean);
    for (const part of hdr) if (part !== 'DV') marks.push({ key: part, className: 'jfmod-releaseMark--hdr', text: part });
    if (hdr.includes('DV')) marks.push(VISION_MARK);
    const audio = parsed.audio ?? '';
    if (/\bAtmos\b/.test(audio)) marks.push(ATMOS_MARK);
    const format = AUDIO_MARKS.find(([test]) => test.test(audio));
    if (format) {
        marks.push(format[1]);
    } else {
        const plain = audio.split(' ').find(part => part && part !== 'Atmos');
        if (plain) marks.push(chipMark('audio', plain.toUpperCase(), '', 'text', plain.toUpperCase(), true));
    }
    return marks;
};

const MarkView: FC<{ mark: Mark }> = ({ mark }) => {
    const { chip } = mark;
    if (chip) {
        return <span className={'jfmod-releaseMark jfmod-releaseTag jfmod-releaseTag--' + chip.modifier} role='img' aria-label={chip.label}
            title={chip.label}>
            {chip.icon !== '' && <span className='jfmod-releaseTag-icon' aria-hidden='true' dangerouslySetInnerHTML={{ __html: chip.icon }} />}
            {mark.text !== '' && <span aria-hidden='true'>{mark.text}</span>}
        </span>;
    }
    return <span className={'jfmod-releaseMark ' + mark.className}>{mark.text}</span>;
};

const MediaMarks: FC<{ parsed: ParsedRelease }> = ({ parsed }) => {
    const marks = marksOf(parsed);
    if (marks.length === 0) return null;
    const channels = parsed.audioChannels ? <span className='jfmod-releaseMark jfmod-releaseMark--channels'>{parsed.audioChannels}</span> : null;
    // The last audio chip, its tier (DTS-HD's MA) and the channel count are one unit (user, 2026-10-11): a filled piece, then
    // outlined pieces.
    const last = marks[marks.length - 1];
    const tier = last.chip?.tier;
    const joined = (!!channels || !!tier) && !!last.audio;
    const shown = joined ? marks.slice(0, -1) : marks;
    // A thin divider between the video marks and the audio ones (user, 2026-10-11), when a row has both.
    const firstAudio = marks.findIndex(mark => mark.audio);
    const divideAt = firstAudio > 0 ? marks[firstAudio].key : null;
    return <>
        {shown.map(mark => <Fragment key={mark.key}>
            {mark.key === divideAt && <span className='jfmod-releaseDivider' aria-hidden='true' />}
            <MarkView mark={mark} />
        </Fragment>)}
        {joined && last.key === divideAt && <span className='jfmod-releaseDivider' aria-hidden='true' />}
        {joined && <span className='jfmod-releaseJoin'>
            <MarkView mark={last} />
            {tier && <span className='jfmod-releaseMark jfmod-releaseMark--tier'>{tier}</span>}
            {channels}
        </span>}
        {!joined && channels}
    </>;
};

const Languages: FC<{ label: string; codes: string[] | null | undefined; subtitles?: boolean }> = ({ label, codes, subtitles }) => {
    if (!codes || codes.length === 0) return null;
    return <span className='jfmod-releaseLang' title={label + ': ' + names(codes)} aria-label={label + ': ' + names(codes)}>
        {subtitles ? <SubtitleGlyph /> : <AudioGlyph />}{codes.join(' · ')}
    </span>;
};

interface ReleaseLinesProps {
    candidate: ReleaseCandidate;
    /** `Season 2 · 8 episodes` and `3 held` chips of a pack row. */
    coverage: string | null;
}

/**
 * What a row's button holds: line 1, the marks line, and the file name (shown on every row while Show Names is on, and in the
 * grab block). A phone gets the three-line form, so nothing wraps unpredictably at 360 px.
 */
export const ReleaseLines: FC<ReleaseLinesProps> = ({ candidate, coverage }) => {
    const parsed = candidate.parsed;
    const held = candidate.coverage?.held ?? 0;
    const heldQuality = !!candidate.heldQuality;
    const seeds = candidate.seeders === null ? '?' : String(candidate.seeders);
    const flags = <>
        {heldQuality && <span className='jfmod-releaseFlag jfmod-releaseFlag--held' title='In library' aria-label='In library'><HeldGlyph /></span>}
        {candidate.freeleech === true && <span className='jfmod-releaseFlag jfmod-releaseFlag--freeleech' title='Freeleech' aria-label='Freeleech'>FL</span>}
        {(candidate.proper || candidate.repack) && <span className='jfmod-releaseBadge--note'>{candidate.proper ? 'Proper' : 'Repack'}</span>}
        {coverage && <span className='jfmod-releaseChip jfmod-releaseChip--coverage'>{coverage}</span>}
        {held > 0 && <span className='jfmod-releaseChip jfmod-releaseChip--held'>{held} held</span>}
    </>;
    const languages = <>
        <Languages label='Audio' codes={parsed.languages} />
        <Languages label='Subtitles' codes={parsed.subtitles} subtitles />
    </>;
    const size = <span className='jfmod-releaseCol jfmod-releaseCol--size'>{formatSize(candidate.size)}</span>;
    const seedsColumn = <span className='jfmod-releaseCol jfmod-releaseCol--seeds'
        aria-label={candidate.seeders === null ? 'Seeders unknown' : seeds + ' seeders'}><SeedsGlyph />{seeds}</span>;
    const indexer = <span className='jfmod-releaseCol jfmod-releaseCol--indexer'>{candidate.indexerName}</span>;
    const marks = <MediaMarks parsed={parsed} />;
    const hasMarks = marksOf(parsed).length > 0;
    const title = <span className='jfmod-releaseTitle'>{candidate.rawTitle} · score {candidate.score}</span>;

    if (layoutManager.mobile) {
        const hasLanguages = !!parsed.languages?.length || !!parsed.subtitles?.length;
        return <>
            <span className='jfmod-releaseLine'>
                <span className='jfmod-releaseLeft'>
                    <span className='jfmod-releaseQuality'>{qualityText(parsed)}</span>{flags}
                </span>
                <span className='jfmod-releaseRight'>{size}{seedsColumn}</span>
            </span>
            <span className='jfmod-releaseLine jfmod-releaseLine--sub'>
                <span className='jfmod-releaseLeft'>{hasLanguages && languages}</span>
                <span className='jfmod-releaseRight'>{indexer}</span>
            </span>
            {hasMarks && <span className='jfmod-releaseLine2'>{marks}</span>}
            {/* In the page for the runners and screen readers' text; a phone never shows it on the row (the grab block and the
                confirmation carry the name). */}
            {title}
        </>;
    }
    return <>
        <span className='jfmod-releaseLine'>
            <span className='jfmod-releaseLeft'>
                <span className='jfmod-releaseQuality'>{qualityText(parsed)}</span>{flags}{languages}
            </span>
            <span className='jfmod-releaseRight'>{size}{seedsColumn}{indexer}</span>
        </span>
        {hasMarks && <span className='jfmod-releaseLine2'>{marks}</span>}
        {title}
    </>;
};

const ActionSvg: FC<{ children: ReactNode }> = ({ children }) =>
    <svg className='jfmod-releaseGlyph' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.3' strokeLinecap='round'
        strokeLinejoin='round' aria-hidden='true' focusable='false'>
        {children}
        <path className='jfmod-releaseGlyph-tick' d='M5 12.5L9.8 17.3L19 8' />
        <g className='jfmod-releaseGlyph-bang'><path d='M12 5V14' /><circle cx='12' cy='18.6' r='1.4' fill='currentColor' stroke='none' /></g>
    </svg>;

/** The Add action's glyph: a plus that pulses while working, a tick when the client has the torrent, a bang when it failed. */
export const AddGlyph: FC = () => <ActionSvg><path className='jfmod-releaseGlyph-plus' d='M12 5.5V18.5M5.5 12H18.5' /></ActionSvg>;

/** The Replace action's glyph: two curved arrows in a circle, the outgoing one faint; the circle turns while working. */
export const ReplaceGlyph: FC = () => <ActionSvg>
    <g className='jfmod-releaseGlyph-swap'>
        <g className='jfmod-releaseGlyph-in'><path d='M15.38 4.75A8 8 0 0 1 14.07 19.73' /><path d='M15.84 16.67L14.07 19.73L17.13 21.50' /></g>
        <g className='jfmod-releaseGlyph-out'><path d='M8.62 19.25A8 8 0 0 1 9.93 4.27' /><path d='M8.16 7.33L9.93 4.27L6.87 2.50' /></g>
    </g>
</ActionSvg>;
