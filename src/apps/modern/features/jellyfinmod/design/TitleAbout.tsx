import type { BaseItemDto, MediaSourceInfo, MediaStream } from '@jellyfin/sdk/lib/generated-client';
import React, { type FC, type ReactNode, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DesignContext } from './Root';
import datetime from 'scripts/datetime';
import ResizeObserver from 'resize-observer-polyfill';
import { linesOfSize, sameItemId } from '../constants/versions';
import { formatBytes } from '../constants/queue';

/**
 * ds.t20, the computer's series and movie title pages (the user, 2026-11-15/16; workspace reviews/fable-design-review/REVIEW.md,
 * the approved section and rounds 6 to 6c): the facts line under the title, the credits after the description and About at
 * the foot. Phone, tablet and TV keep their pages.
 */

/** The window is narrower than 1440 px: no tagline, the description cut at 2 lines (ds.t20; the breakpoint is the build's). */
const useMedia = (query: string) => {
    const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
    useEffect(() => {
        const list = window.matchMedia(query);
        const change = () => setMatches(list.matches);
        list.addEventListener('change', change);
        return () => list.removeEventListener('change', change);
    }, [query]);
    return matches;
};

export const useNarrowComputer = () => useMedia('(max-width: 1439.98px)');

/** A window narrower than 4:3 (portrait, near-square, 5:4): the computer's title page flows instead of fitting the screen
 * (the user, 2026-11-18). The same query as titleTop.scss's flow block. */
export const useFlowWindow = () => useMedia('(max-aspect-ratio: 3999/3000)');

/**
 * Round 7d's fit (the user, 2026-11-17; was the touch-only cut of 2026-11-17): on a series page the hero and the episode row fill
 * the first screen, so the description gives up whole lines, down to one, until the row's foot (the selected card's ring) sits
 * Bφ² above the screen's foot, and takes them back (up to `base`) while the hero has a line's room above its head. Computer and
 * TV alike; a window too short even for one line scrolls.
 */
export const useFitLines = (base: number, text: React.RefObject<HTMLElement>, enabled: boolean) => {
    const [lines, setLines] = useState(base);
    useEffect(() => {
        const node = text.current;
        const top = node?.closest<HTMLElement>('.jfmod-titleTop');
        if (!enabled || !node || !top) return;
        const fit = () => {
            const rail = top.querySelector<HTMLElement>('.jfmod-epRow .erail');
            const head = top.querySelector<HTMLElement>('.jfmod-hero .jfmod-titleHead');
            if (!rail || !head) return;
            const base0 = parseFloat(getComputedStyle(rail).fontSize);
            const foot = rail.getBoundingClientRect().bottom + 0.236 * base0 + window.scrollY;
            const over = foot - (window.innerHeight - 2.6180339887 * base0);
            // The room the hero leaves under the head (Align Top: between the credits and the season pill).
            const hero = head.parentElement;
            const room = hero ? Math.max(0, hero.getBoundingClientRect().bottom - head.getBoundingClientRect().bottom) : 0;
            const pitch = parseFloat(getComputedStyle(node).lineHeight) || 1;
            // Cut from the lines shown (a text shorter than its allowance shows fewer), give back from the allowance.
            const shown = Math.max(1, Math.round(node.getBoundingClientRect().height / pitch));
            setLines(current => {
                const next = over > 0.5 ? Math.min(current, shown) - Math.ceil(over / pitch) : current + Math.floor(room / pitch);
                return Math.min(base, Math.max(1, next));
            });
        };
        fit();
        const observer = new ResizeObserver(fit);
        observer.observe(top);
        window.addEventListener('resize', fit);
        return () => {
            observer.disconnect();
            window.removeEventListener('resize', fit);
        };
    }, [base, text, enabled]);
    return enabled ? lines : base;
};

const lengthOf = (item: BaseItemDto) => {
    if (item.Type !== 'Series') return item.RunTimeTicks ? datetime.getDisplayDuration(item.RunTimeTicks) : '';
    if (!item.ChildCount) return '';
    return `${item.ChildCount} ${item.ChildCount === 1 ? 'season' : 'seasons'}`;
};
const shortGenre = (genre: string) => (genre === 'Science Fiction' ? 'Sci-Fi' : genre);

/**
 * The facts line: year • Genres (three at most) • seasons or runtime • age rating • Ended or Continuing (a series). If it would
 * wrap, Science Fiction becomes Sci-Fi, then genres drop from the end, keeping one (About lists them all). `children` is the
 * ratings slot, drawn on its own line under the facts.
 */
export const FactsLine: FC<{ item: BaseItemDto; children: ReactNode }> = ({ item, children }) => {
    const genres = (item.Genres ?? []).slice(0, 3);
    const total = genres.length;
    const sciFi = genres.includes('Science Fiction');
    const [width, setWidth] = useState(window.innerWidth);
    const [fit, setFit] = useState({ key: '', short: false, count: total });
    const key = [item.Id, width, genres.join()].join('|');
    const shown = fit.key === key ? fit : { key, short: false, count: total };
    const line = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const resize = () => setWidth(window.innerWidth);
        window.addEventListener('resize', resize);
        return () => window.removeEventListener('resize', resize);
    }, []);
    useLayoutEffect(() => {
        const spans = Array.from(line.current?.children ?? []).filter(node => !node.classList.contains('jfmod-metaRatings')) as HTMLElement[];
        const wraps = spans.length > 1 && spans[spans.length - 1].offsetTop > spans[0].offsetTop + 1;
        setFit(current => {
            const base = current.key === key ? current : { key, short: false, count: total };
            if (wraps && !base.short && sciFi) return { ...base, short: true };
            if (wraps && base.count > 1) return { ...base, count: base.count - 1 };
            return base;
        });
    }, [key, total, sciFi, shown.short, shown.count]);
    const status = item.Type === 'Series' && ['Ended', 'Continuing'].includes(item.Status ?? '') ? item.Status : '';
    const words = [item.ProductionYear ? String(item.ProductionYear) : '', genres.slice(0, shown.count).map(genre => (shown.short ? shortGenre(genre) : genre)).join(', '),
        lengthOf(item), item.OfficialRating ?? '', status ?? ''].filter(Boolean);
    return <div ref={line} className='meta jfmod-factsLine'>{words.map(word => <span key={word}>{word}</span>)}{children}</div>;
};

/** Created by (a movie: Directed by) and Starring, the first three actors, after the description. */
export const Credits: FC<{ by: ReactNode; byWords: string; item: BaseItemDto }> = ({ by, byWords, item }) => {
    const tv = useContext(DesignContext) === 'tv';
    const actors = (item.People ?? []).filter(person => person.Type === 'Actor').slice(0, 3);
    if (!by && !actors.length) return null;
    return <div className='jfmod-credits'>
        {by && <div><span className='jfmod-creditLabel'>{byWords || (item.Type === 'Series' ? 'Created by' : 'Directed by')}</span>{by}</div>}
        {actors.length > 0 && <div><span className='jfmod-creditLabel'>Starring</span>{actors.map((person, index) => <React.Fragment key={person.Id ?? person.Name}>
            {index > 0 && ', '}{person.Id && !tv ? <a className='focusable' href={`#/details?id=${encodeURIComponent(person.Id)}&serverId=${encodeURIComponent(item.ServerId ?? '')}`}>{person.Name}</a> : person.Name}
        </React.Fragment>)}</div>}
    </div>;
};

const AUDIO: Record<string, string> = { ac3: 'Dolby Digital', eac3: 'Dolby Digital+', truehd: 'Dolby TrueHD', dts: 'DTS', aac: 'AAC', opus: 'Opus', flac: 'FLAC', mp3: 'MP3', vorbis: 'Vorbis' };
const audioFormat = (stream: MediaStream) => {
    const profile = stream.Profile ?? '';
    if (/DTS-HD MA/i.test(profile)) return 'DTS-HD MA';
    if (/Atmos/i.test(profile)) return (AUDIO[stream.Codec?.toLowerCase() ?? ''] ?? 'Dolby') + ' Atmos';
    return AUDIO[stream.Codec?.toLowerCase() ?? ''] ?? stream.Codec?.toUpperCase() ?? '';
};
const RANGE: Record<string, string> = { DOVI: 'Dolby Vision', DOVIWithHDR10: 'Dolby Vision', DOVIWithHLG: 'Dolby Vision', DOVIWithSDR: 'Dolby Vision', HDR10: 'HDR10', HDR10Plus: 'HDR10+', HLG: 'HLG', SDR: 'SDR' };
const rangeOf = (video?: MediaStream) => RANGE[video?.VideoRangeType ?? ''] ?? video?.VideoRange ?? '';
const codecOf = (video?: MediaStream) => ({ h264: 'H.264', hevc: 'HEVC', av1: 'AV1', vp9: 'VP9', vp8: 'VP8', vc1: 'VC-1', mpeg2video: 'MPEG-2' } as Record<string, string>)[video?.Codec?.toLowerCase() ?? ''] ?? video?.Codec?.toUpperCase() ?? '';
const bitrate = (bits?: number | null) => {
    if (!bits) return '';
    return bits >= 1e6 ? (bits / 1e6).toFixed(1) + ' Mbps' : Math.round(bits / 1e3) + ' kbps';
};
const resolution = (video?: MediaStream) => {
    const lines = linesOfSize(video?.Width, video?.Height);
    if (!lines) return '';
    return lines >= 2160 ? '4K' : lines + 'p';
};
const videoOf = (source: MediaSourceInfo) => source.MediaStreams?.find(stream => stream.Type === 'Video');
const join = (words: (string | number | null | undefined | false)[]) => words.filter(Boolean).join(' · ');
/** One version's line: resolution · range (not SDR) · codec · bit depth (over 8) · size. */
export const versionLine = (source: MediaSourceInfo) => {
    const video = videoOf(source);
    const lines = linesOfSize(video?.Width, video?.Height);
    const range = rangeOf(video);
    return join([lines ? lines + 'p' : source.Name, range !== 'SDR' && range, codecOf(video), (video?.BitDepth ?? 8) > 8 && video?.BitDepth + '-bit', formatBytes(source.Size)]);
};

const Check = () => <svg className='jfmod-aboutCheck' viewBox='0 0 24 24' aria-hidden='true'><path d='M5 12.5l4.5 4.5L19 7.5' /></svg>;

const Row: FC<{ label: string; children: ReactNode; hang?: boolean }> = ({ label, children, hang }) => <><dt>{label}</dt><dd className={hang ? 'hang' : undefined}>{children}</dd></>;

/** The selected file's lines (right column): Episode, Versions or Version, File, Video, Audio (six, then N more), Subtitles. */
const FileFacts: FC<{ episode?: string; sources: MediaSourceInfo[]; source?: MediaSourceInfo; names?: Record<string, string>; onSelect: (source: MediaSourceInfo) => void }> = ({ episode, sources, source, names, onSelect }) => {
    const [more, setMore] = useState(false);
    useEffect(() => setMore(false), [source?.Id]);
    const video = source && videoOf(source);
    const streams = source?.MediaStreams ?? [];
    const audios = streams.filter(stream => stream.Type === 'Audio');
    const subtitles = streams.filter(stream => stream.Type === 'Subtitle');
    const language = (stream: MediaStream) => names?.[stream.Language?.toLowerCase() ?? ''] ?? (stream.Language || 'Unknown');
    const audioLines = audios.map(stream => ({ key: stream.Index, text: join([language(stream), audioFormat(stream), stream.ChannelLayout ?? (stream.Channels ? stream.Channels + ' ch' : ''), stream.Title, stream.IsDefault && 'default']) }));
    const formats = [...new Set(subtitles.map(stream => stream.Codec?.toUpperCase() ?? ''))];
    const subtitleName = (stream: MediaStream) => {
        const notes = [stream.IsForced && 'forced', stream.IsHearingImpaired && 'SDH', stream.Title].filter(Boolean);
        return language(stream) + (notes.length ? ` (${notes.join(', ')})` : '');
    };
    return <dl className='media'>
        {episode && <Row label='Episode'>{episode}</Row>}
        {sources.length > 1 ? <Row label='Versions'>{sources.map(candidate => <div key={candidate.Id}>
            <button type='button' className={'jfmod-aboutVersion focusable' + (candidate === source ? ' cur' : '')} aria-pressed={candidate === source}
                onClick={() => onSelect(candidate)}>{candidate === source && <Check />}{versionLine(candidate)}</button></div>)}</Row> :
            source?.Name && <Row label='Version'>{source.Name}</Row>}
        {source && <Row label='File'>{join([source.Container?.toUpperCase(), formatBytes(source.Size), bitrate(source.Bitrate)])}</Row>}
        {video && <Row label='Video' hang><div>{join([resolution(video), codecOf(video), rangeOf(video)])}</div>
            <div>{join([video.Width && video.Height && `${video.Width}×${video.Height}`, video.BitDepth && video.BitDepth + '-bit',
                video.RealFrameRate && `${Math.round(video.RealFrameRate * 1000) / 1000} fps`, bitrate(video.BitRate)])}</div></Row>}
        {audioLines.length > 0 && <Row label='Audio' hang>{(more ? audioLines : audioLines.slice(0, 6)).map(line => <div key={line.key}>{line.text}</div>)}
            {audioLines.length > 6 && <div><button type='button' className='jfmod-more focusable' onClick={() => setMore(!more)}>{more ? 'less' : `${audioLines.length - 6} more`}</button></div>}</Row>}
        {source && <Row label='Subtitles'>{subtitles.length ? formats.map(format => <div key={format}>
            {subtitles.filter(stream => (stream.Codec?.toUpperCase() ?? '') === format).map(subtitleName).join(', ')}{format && <span className='jfmod-aboutNote'> · {format}</span>}
        </div>) : 'None'}</Row>}
    </dl>;
};

export interface AboutFile {
    episode?: string;
    sources: MediaSourceInfo[];
    selected?: string;
    names?: Record<string, string>;
    onSelect: (source: MediaSourceInfo) => void;
}

/**
 * About ⟨title⟩ at the foot, after the rows: the title's facts (61.8 %) beside the selected file's (38.2 %), labels in the
 * facts' muted ink, values 400 at 76.4 %, all of them, no "more" (Audio excepted).
 */
export const About: FC<{ title: string; facts: { label: string; value: ReactNode }[]; links?: ReactNode; file: AboutFile }> = ({ title, facts, links, file }) => {
    const source = file.sources.find(candidate => sameItemId(candidate.Id, file.selected)) ?? file.sources[0];
    return <div className='jfmod-about' data-ds-section='about'>
        <h2 className='rowt'>About {title}</h2>
        <div className='jfmod-aboutGrid'>
            <div><dl>{facts.map(fact => <Row key={fact.label} label={fact.label}>{fact.value}</Row>)}</dl>{links}</div>
            <div>{(file.episode || source) && <FileFacts episode={file.episode} sources={file.sources} source={source} names={file.names} onSelect={file.onSelect} />}</div>
        </div>
    </div>;
};
