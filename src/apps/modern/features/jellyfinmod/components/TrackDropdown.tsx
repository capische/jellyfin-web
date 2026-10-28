import type { Api } from '@jellyfin/sdk/lib/api';
import type { MediaSourceInfo } from '@jellyfin/sdk/lib/generated-client/models/media-source-info';
import type { MediaStream } from '@jellyfin/sdk/lib/generated-client/models/media-stream';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { useQuery } from '@tanstack/react-query';
import React, { type FC, type MouseEvent, type ReactNode, useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import layoutManager from 'components/layoutManager';

import { getLanguageNames } from '../api/modApi';
import { findSource, streamMarks, subtitleFormat } from '../constants/versions';
import type { StripHosts } from './FileChooser';
import { MediaMarks } from './ReleaseRowParts';

import './fileChooser.scss';
// The media marks' own styles.
import './releasePicker.scss';

/**
 * The Audio and Subtitles rows as dropdowns drawn like the Video one (P7.FU6, user-approved design 2026-10-17, UX §11.2): the
 * same field, chevron and paper list, the current entry marked by a blue left bar. Each entry is the track's language, the
 * release picker's media marks read from its stream, and its flags. Upstream's select stays in the DOM, hidden, and stays the
 * source of truth: the entries are its options, and choosing one sets its value and dispatches the `change` its own picker
 * dispatches, so Play sends exactly the stream index upstream would. A select upstream disables (one audio track) is drawn as
 * the same field without a chevron, not a focus stop.
 */

interface Entry {
    value: string;
    /** Upstream's option text, as the entry's tooltip. */
    title: string;
    content: ReactNode;
}

interface NativeSelect {
    options: { value: string; text: string }[];
    value: string;
    disabled: boolean;
    hidden: boolean;
    /** The stock `.selectSource` value the options belong to. */
    sourceId: string;
}

/**
 * Reads upstream's track row and its select: its options, value, whether it is enabled and whether upstream shows the row, again
 * whenever upstream rewrites it (a version change) or it changes. The row steps aside by a mod class while its segment is drawn
 * in the strip (`useTrackStrip`).
 */
const useTrackHost = (view: HTMLElement, selector: string) => {
    const [state, setState] = useState<NativeSelect | null>(null);
    const [select, setSelect] = useState<HTMLSelectElement | null>(null);
    useEffect(() => {
        const container = view.querySelector<HTMLElement>(selector);
        const native = container?.querySelector<HTMLSelectElement>('select');
        if (!container || !native) return;
        container.classList.add('jfmod-trackHost');
        const read = () => setState({
            options: Array.from(native.options).map(option => ({ value: option.value, text: option.textContent ?? '' })),
            value: native.value,
            disabled: native.disabled,
            // Upstream hides the row when the file has no such track (no subtitles); the segment goes with it.
            hidden: container.classList.contains('hide'),
            sourceId: view.querySelector<HTMLSelectElement>('.selectSource')?.value ?? ''
        });
        read();
        setSelect(native);
        native.addEventListener('change', read);
        const observer = new MutationObserver(read);
        observer.observe(native, { childList: true, attributes: true, attributeFilter: ['disabled'] });
        observer.observe(container, { attributes: true, attributeFilter: ['class'] });
        return () => {
            observer.disconnect();
            native.removeEventListener('change', read);
            container.classList.remove('jfmod-trackHost');
            setSelect(null);
            setState(null);
        };
    }, [view, selector]);
    const choose = useCallback((value: string) => {
        if (!select || select.value === value) return;
        select.value = value;
        // What emby-select's own picker dispatches after a choice.
        select.dispatchEvent(new Event('change', { bubbles: false, cancelable: true }));
    }, [select]);
    return { state, choose };
};

/** Words a track's title may repeat without saying anything the language and the marks do not (D5). */
const QUIET_WORDS = new Set(['original', 'default', 'forced', 'sdh', 'cc', 'full', 'audio', 'track', 'subtitles', 'subs', 'stereo',
    'mono', 'surround', 'aac', 'ac3', 'eac3', 'dd', 'ddp', 'dd+', 'dolby', 'digital', 'plus', 'dts', 'hd', 'ma', 'x', 'truehd', 'atmos',
    'flac', 'opus', 'mp3', 'pcm', 'lpcm', '1.0', '2.0', '5.1', '6.1', '7.1', 'ch', 'srt', 'ass', 'ssa', 'pgs', 'vobsub']);

/**
 * Whether a title only repeats the language or the marks (D5, `reviews/upgrade-status-options/all-in-one/lists`): "Original
 * [ENG]" on an English track says nothing, "Дубляж [UKR]" does.
 */
const repeatsOnly = (title: string, language: string, code: string) => {
    const known = new Set([...QUIET_WORDS, code, ...language.toLowerCase().split(/\s+/)]);
    const words = title.toLowerCase().split(/[\s[\](){}\-_,;:/|]+/).filter(Boolean);
    return words.length > 0 && words.every(word => known.has(word));
};

/**
 * Default, Forced and SDH from the stream's flags, and its own title (`Commentary`, `Latin American`) when it adds a word (D5); the
 * title last, cut with an ellipsis when long, so the flags stay.
 */
const streamFlags = (stream: MediaStream, language: string) => {
    const flags: string[] = [];
    if (stream.IsDefault) flags.push('Default');
    if (stream.IsForced) flags.push('Forced');
    if (stream.IsHearingImpaired) flags.push('SDH');
    const title = stream.Title?.trim();
    const kept = title && !repeatsOnly(title, language, stream.Language?.toLowerCase() ?? '') ? title : null;
    return { flags, title: kept };
};

/** One track: its language (600), its marks, its flags muted. */
const TrackText: FC<{ stream: MediaStream; names: Record<string, string> | undefined }> = ({ stream, names }) => {
    const code = stream.Language?.toLowerCase() ?? '';
    const language = names?.[code] ?? (stream.Language || 'Unknown');
    const format = stream.Type === 'Subtitle' ? subtitleFormat(stream) : null;
    const { flags, title } = streamFlags(stream, language);
    return <>
        <span className='jfmod-trackLanguage'>{language}</span>
        <span className='jfmod-fileMarks'>
            {stream.Type === 'Audio' && <MediaMarks parsed={streamMarks(stream)} />}
            {format && <span className='jfmod-releaseMark'>{format}</span>}
        </span>
        {flags.map(flag => <span key={flag} className='jfmod-fileExtra jfmod-fileExtra--dot'>{flag}</span>)}
        {title && <span className='jfmod-fileExtra jfmod-fileExtra--dot jfmod-trackTitle'>{title}</span>}
    </>;
};

interface TrackDropdownProps {
    name: string;
    entries: Entry[];
    value: string;
    enabled: boolean;
    onChoose: (value: string) => void;
}

/**
 * The field and its list. MUI's menu gives the list its keys (arrows, Enter, Escape back to the field) and `shell/dpadModals`
 * the TV's remote; it opens on the current entry.
 */
const TrackDropdown: FC<TrackDropdownProps> = ({ name, entries, value, enabled, onChoose }) => {
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const open = useCallback((event: MouseEvent<HTMLElement>) => setAnchor(event.currentTarget), []);
    const close = useCallback(() => setAnchor(null), []);
    const pick = useCallback((event: MouseEvent<HTMLElement>) => {
        setAnchor(null);
        onChoose(event.currentTarget.getAttribute('data-jfmod-track') ?? '');
    }, [onChoose]);
    const current = entries.find(entry => entry.value === value) ?? entries[0];
    if (!current) return null;
    // The segment's caption over its value (D8: VIDEO · AUDIO · SUBTITLES are kept, the labels column goes).
    const caption = <span className='jfmod-stripCaption' aria-hidden='true'>{name}</span>;
    const text = <span className='jfmod-videoTriggerText'>{current.content}</span>;
    if (!enabled || entries.length < 2) {
        return <div className='jfmod-trackTrigger jfmod-trackStatic' title={current.title} data-jfmod-track-field={name}>
            {caption}<span className='jfmod-stripValue'>{text}</span>
        </div>;
    }
    // The list hangs under its segment, right-aligned with it, at least as wide and at most 34em (D6); on a phone the stacked
    // segment is the card's width and so is the list.
    const width = layoutManager.mobile ? { width: anchor?.offsetWidth } : { minWidth: anchor?.offsetWidth };
    return <>
        <button type='button' className='jfmod-trackTrigger' aria-haspopup='listbox' aria-expanded={!!anchor}
            aria-label={`${name}: ${current.title}`} title={current.title} onClick={open} data-jfmod-track-field={name}>
            {caption}
            <span className='jfmod-stripValue'>
                {text}
                <span className={'material-icons jfmod-videoChevron ' + (anchor ? 'expand_less' : 'expand_more')} aria-hidden='true' />
            </span>
        </button>
        <Menu anchorEl={anchor} open={!!anchor} onClose={close} className='jfmod-trackMenu'
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            slotProps={{ list: { role: 'listbox', 'aria-label': name }, paper: { className: 'jfmod-trackMenuPaper', style: width } }}>
            {/* Menu items as the menu's own children, so it opens on the current one (it focuses the child marked selected). */}
            {entries.map(entry => <MenuItem key={entry.value} role='option' aria-selected={entry === current} selected={entry === current}
                title={entry.title} onClick={pick} className={'jfmod-trackItem' + (entry === current ? ' jfmod-trackItem--on' : '')}
                data-jfmod-track={entry.value}>
                {entry.content}
            </MenuItem>)}
        </Menu>
    </>;
};

interface TrackRowProps {
    view: HTMLElement;
    /** The strip's segment it draws into. */
    host: HTMLElement;
    selector: string;
    name: string;
    type: 'Audio' | 'Subtitle';
    sources: MediaSourceInfo[];
    names: Record<string, string> | undefined;
}

/** One of upstream's track rows with its dropdown, its entries built from the select's options and the selected file's streams. */
const TrackRow: FC<TrackRowProps> = ({ view, host, selector, name, type, sources, names }) => {
    const { state, choose } = useTrackHost(view, selector);
    if (!state || state.hidden) return null;
    const streams = (findSource(sources, state.sourceId) ?? sources[0])?.MediaStreams ?? [];
    const entries = state.options.map(option => {
        const stream = streams.find(candidate => candidate.Type === type && String(candidate.Index) === option.value);
        let content: ReactNode = <span className='jfmod-trackLanguage'>{option.text}</span>;
        if (stream) content = <TrackText stream={stream} names={names} />;
        else if (type === 'Subtitle' && option.value === '-1') content = <span className='jfmod-trackLanguage'>Off</span>;
        return { value: option.value, title: option.text, content };
    });
    return createPortal(<TrackDropdown name={name} entries={entries} value={state.value} enabled={!state.disabled} onChoose={choose} />,
        host);
};

/** The Audio and Subtitles dropdowns, once the page item's streams and the language names are read; until then upstream's selects show. */
interface TrackDropdownsProps {
    api: Api;
    view: HTMLElement;
    sources: MediaSourceInfo[] | undefined;
    strip: StripHosts;
}

const TrackDropdowns: FC<TrackDropdownsProps> = ({ api, view, sources, strip }) => {
    const languages = useQuery({
        queryKey: ['JellyfinMod', api.basePath, 'LanguageNames'],
        queryFn: ({ signal }) => getLanguageNames(api, { signal }),
        staleTime: Infinity,
        retry: false
    });
    // Without the server's names (a failed read) a language reads as its code.
    if (!sources || languages.isPending) return null;
    return <>
        <TrackRow view={view} host={strip.audio} selector='.selectAudioContainer' name='Audio' type='Audio' sources={sources}
            names={languages.data} />
        <TrackRow view={view} host={strip.subtitles} selector='.selectSubtitlesContainer' name='Subtitles' type='Subtitle'
            sources={sources} names={languages.data} />
    </>;
};

export default TrackDropdowns;
