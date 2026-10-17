import type { Api } from '@jellyfin/sdk/lib/api';
import type { MediaSourceInfo } from '@jellyfin/sdk/lib/generated-client/models/media-source-info';
import type { MediaStream } from '@jellyfin/sdk/lib/generated-client/models/media-stream';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { useQuery } from '@tanstack/react-query';
import React, { type FC, type MouseEvent, type ReactNode, useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { getLanguageNames } from '../api/modApi';
import { findSource, streamMarks, subtitleFormat } from '../constants/versions';
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
    /** The stock `.selectSource` value the options belong to. */
    sourceId: string;
}

/**
 * Mounts a host inside upstream's track row and reads its select: its options, value and whether it is enabled, again whenever
 * upstream rewrites it (a version change) or it changes. The row's select and arrow step aside by a mod class while mounted.
 */
const useTrackHost = (view: HTMLElement, selector: string) => {
    const [host, setHost] = useState<HTMLElement | null>(null);
    const [state, setState] = useState<NativeSelect | null>(null);
    const [select, setSelect] = useState<HTMLSelectElement | null>(null);
    useEffect(() => {
        const container = view.querySelector<HTMLElement>(selector);
        const native = container?.querySelector<HTMLSelectElement>('select');
        if (!container || !native) return;
        const element = document.createElement('div');
        element.className = 'jfmod-trackChooser';
        container.appendChild(element);
        container.classList.add('jfmod-trackHost');
        const read = () => setState({
            options: Array.from(native.options).map(option => ({ value: option.value, text: option.textContent ?? '' })),
            value: native.value,
            disabled: native.disabled,
            sourceId: view.querySelector<HTMLSelectElement>('.selectSource')?.value ?? ''
        });
        read();
        setHost(element);
        setSelect(native);
        native.addEventListener('change', read);
        const observer = new MutationObserver(read);
        observer.observe(native, { childList: true, attributes: true, attributeFilter: ['disabled'] });
        return () => {
            observer.disconnect();
            native.removeEventListener('change', read);
            element.remove();
            container.classList.remove('jfmod-trackHost');
            setHost(null);
            setSelect(null);
        };
    }, [view, selector]);
    const choose = useCallback((value: string) => {
        if (!select || select.value === value) return;
        select.value = value;
        // What emby-select's own picker dispatches after a choice.
        select.dispatchEvent(new Event('change', { bubbles: false, cancelable: true }));
    }, [select]);
    return { host, state, choose };
};

/** Default, Forced and SDH from the stream's flags, then its own title (`Commentary`, `Latin American`) when it adds a word. */
const streamFlags = (stream: MediaStream, language: string) => {
    const flags: string[] = [];
    if (stream.IsDefault) flags.push('Default');
    if (stream.IsForced) flags.push('Forced');
    if (stream.IsHearingImpaired) flags.push('SDH');
    const title = stream.Title?.trim();
    if (title && ![...flags, language].some(flag => flag.toLowerCase() === title.toLowerCase())) flags.push(title);
    return flags;
};

/** One track: its language (600), its marks, its flags muted. */
const TrackText: FC<{ stream: MediaStream; names: Record<string, string> | undefined }> = ({ stream, names }) => {
    const code = stream.Language?.toLowerCase() ?? '';
    const language = names?.[code] ?? (stream.Language || 'Unknown');
    const format = stream.Type === 'Subtitle' ? subtitleFormat(stream) : null;
    return <>
        <span className='jfmod-trackLanguage'>{language}</span>
        <span className='jfmod-fileMarks'>
            {stream.Type === 'Audio' && <MediaMarks parsed={streamMarks(stream)} />}
            {format && <span className='jfmod-releaseMark'>{format}</span>}
        </span>
        {streamFlags(stream, language).map(flag => <span key={flag} className='jfmod-fileExtra jfmod-fileExtra--dot'>{flag}</span>)}
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
    const text = <span className='jfmod-videoTriggerText'>{current.content}</span>;
    if (!enabled || entries.length < 2) {
        return <div className='jfmod-trackTrigger jfmod-trackStatic' title={current.title} data-jfmod-track-field={name}>{text}</div>;
    }
    return <>
        <button type='button' className='jfmod-trackTrigger' aria-haspopup='listbox' aria-expanded={!!anchor}
            aria-label={`${name}: ${current.title}`} title={current.title} onClick={open} data-jfmod-track-field={name}>
            {text}
            <span className={'material-icons jfmod-videoChevron ' + (anchor ? 'expand_less' : 'expand_more')} aria-hidden='true' />
        </button>
        <Menu anchorEl={anchor} open={!!anchor} onClose={close} className='jfmod-trackMenu'
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }} transformOrigin={{ vertical: 'top', horizontal: 'left' }}
            slotProps={{ list: { role: 'listbox', 'aria-label': name }, paper: { className: 'jfmod-trackMenuPaper', style: { width: anchor?.offsetWidth } } }}>
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
    selector: string;
    name: string;
    type: 'Audio' | 'Subtitle';
    sources: MediaSourceInfo[];
    names: Record<string, string> | undefined;
}

/** One of upstream's track rows with its dropdown, its entries built from the select's options and the selected file's streams. */
const TrackRow: FC<TrackRowProps> = ({ view, selector, name, type, sources, names }) => {
    const { host, state, choose } = useTrackHost(view, selector);
    if (!host || !state) return null;
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
const TrackDropdowns: FC<{ api: Api; view: HTMLElement; sources: MediaSourceInfo[] | undefined }> = ({ api, view, sources }) => {
    const languages = useQuery({
        queryKey: ['JellyfinMod', api.basePath, 'LanguageNames'],
        queryFn: ({ signal }) => getLanguageNames(api, { signal }),
        staleTime: Infinity,
        retry: false
    });
    // Without the server's names (a failed read) a language reads as its code.
    if (!sources || languages.isPending) return null;
    return <>
        <TrackRow view={view} selector='.selectAudioContainer' name='Audio' type='Audio' sources={sources} names={languages.data} />
        <TrackRow view={view} selector='.selectSubtitlesContainer' name='Subtitles' type='Subtitle' sources={sources}
            names={languages.data} />
    </>;
};

export default TrackDropdowns;
