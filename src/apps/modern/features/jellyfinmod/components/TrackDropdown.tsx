import type { Api } from '@jellyfin/sdk/lib/api';
import type { MediaSourceInfo } from '@jellyfin/sdk/lib/generated-client/models/media-source-info';
import type { MediaStream } from '@jellyfin/sdk/lib/generated-client/models/media-stream';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { useQuery } from '@tanstack/react-query';
import React, { type FC, type MouseEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { getLanguageNames } from '../api/modApi';
import { TRACK_ROLE_NAME, trackExtraWords, trackModifier, trackRole, type TrackRole } from '../constants/tracks';
import { findSource, streamMarks, subtitleFormat } from '../constants/versions';
import { listPlace, type StripHosts } from './FileChooser';
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
    /** The title's extra words (a dub's studio, a commentary's speakers): the row's second line in the list, never in the cell. */
    extra?: string;
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
            // Upstream hides the row when the file has no such track (no subtitles); the segment then reads None (D131).
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

/** The commentary glyph (D61): a speech bubble, someone talking over the film. */
const CommentaryGlyph: FC = () => <svg viewBox='0 0 16 14' aria-hidden='true' focusable='false'>
    <path fillRule='evenodd' d='M2.2 .6h11.6c.9 0 1.6.7 1.6 1.6v6.5c0 .9-.7 1.6-1.6 1.6H7.4L3.6 13.4V10.3H2.2c-.9 0-1.6-.7-1.6-1.6V2.2C.6 1.3 1.3.6 2.2.6ZM3.6 3.4v1.5h8.8V3.4Zm0 2.9v1.5h5.8V6.3Z' />
</svg>;

/** The row's one role mark (D61, D63, D79, D80): outlined like the channel tag, the commentary bubble as a glyph. */
const RoleMark: FC<{ role: TrackRole }> = ({ role }) => <span className='jfmod-trackRoles'>
    {role === 'comm' ?
        <span className='jfmod-trackRole jfmod-trackRole--glyph' title={TRACK_ROLE_NAME[role]}><CommentaryGlyph /></span> :
        <span className='jfmod-trackRole' title={TRACK_ROLE_NAME[role]}>{role}</span>}
</span>;

/**
 * The language in 600 and its short modifier (D60), which wraps out of sight first when the cell is narrow (D78); a language
 * still too long is cut with an ellipsis.
 */
const TrackLanguage: FC<{ language: string; modifier?: string | null }> = ({ language, modifier }) => <span className='jfmod-trackLang'>
    <span className='jfmod-trackLanguage'>{language}</span>
    {modifier && <span className='jfmod-trackMod'>({modifier})</span>}
</span>;

/**
 * One track as its cell and its row draw it (D59, D76): language and modifier, the format marks, at most one role mark. The
 * track's own title is never drawn as it is; its extra words are the list's second line (`trackExtraWords`, D81 option A).
 */
const TrackText: FC<{ stream: MediaStream; names: Record<string, string> | undefined }> = ({ stream, names }) => {
    const code = stream.Language?.toLowerCase() ?? '';
    const language = names?.[code] ?? (stream.Language || 'Unknown');
    const format = stream.Type === 'Subtitle' ? subtitleFormat(stream) : null;
    const role = trackRole(stream);
    return <>
        <TrackLanguage language={language} modifier={trackModifier(stream)} />
        <span className='jfmod-fileMarks'>
            {stream.Type === 'Audio' && <MediaMarks parsed={streamMarks(stream)} />}
            {format && <span className='jfmod-releaseMark'>{format}</span>}
        </span>
        {role && <RoleMark role={role} />}
    </>;
};

interface TrackDropdownProps {
    name: string;
    entries: Entry[];
    value: string;
    enabled: boolean;
    onChoose: (value: string) => void;
}

/** MUI's popover keeps this far from the window's edge (its `marginThreshold`). */
const LIST_MARGIN = 16;

/**
 * Where a cell's list opens and how tall it may be. The list hangs from the strip and never moves up over it (MUI shifts a
 * popover that does not fit below, D149): when opening with less than 10em under the strip the page scrolls first, and the list
 * is no taller than the room left (TV at 1280x720). In px: no min() for older TV engines; the paper's em is the strip's.
 */
const placeUnder = (trigger: HTMLElement, scroll: boolean) => {
    const em = parseFloat(getComputedStyle(trigger).fontSize);
    let at = listPlace(trigger);
    const short = 10 * em - (window.innerHeight - LIST_MARGIN - at.top);
    if (scroll && short > 0) {
        window.scrollBy(0, short);
        at = listPlace(trigger);
    }
    return { ...at, room: Math.min(20 * em, Math.max(0, window.innerHeight - LIST_MARGIN - at.top)) };
};

/**
 * The field and its list. MUI's menu gives the list its keys (arrows, Enter, Escape back to the field) and `shell/dpadModals`
 * the TV's remote; it opens on the current entry.
 */
const TrackDropdown: FC<TrackDropdownProps> = ({ name, entries, value, enabled, onChoose }) => {
    const [place, setPlace] = useState<{ top: number; left: number; width: number; room: number } | null>(null);
    const trigger = useRef<HTMLElement | null>(null);
    const open = useCallback((event: MouseEvent<HTMLElement>) => {
        trigger.current = event.currentTarget;
        setPlace(placeUnder(event.currentTarget, true));
    }, []);
    // A resize (a window, a rotated phone) places the open list again, so it stays under its cell (Codex review, P2 2).
    useEffect(() => {
        if (!place) return;
        const again = () => {
            if (trigger.current?.isConnected) setPlace(placeUnder(trigger.current, false));
        };
        window.addEventListener('resize', again);
        return () => window.removeEventListener('resize', again);
    }, [place]);
    const close = useCallback(() => setPlace(null), []);
    const pick = useCallback((event: MouseEvent<HTMLElement>) => {
        setPlace(null);
        onChoose(event.currentTarget.getAttribute('data-jfmod-track') ?? '');
    }, [onChoose]);
    const current = entries.find(entry => entry.value === value) ?? entries[0];
    if (!current) return null;
    // The segment's caption over its value (D8: VIDEO · AUDIO · SUBTITLES are kept, the labels column goes); the chosen track's
    // extra words share its line after a dot (D147), so the cell keeps its height. The label and tooltip carry the full text.
    const caption = <span className='jfmod-stripCaption' aria-hidden='true'>
        {name}{current.extra && <span className='jfmod-stripCaptionExtra'> · {current.extra}</span>}
    </span>;
    const text = <span className='jfmod-videoTriggerText'>{current.content}</span>;
    if (!enabled || entries.length < 2) {
        return <div className='jfmod-trackTrigger jfmod-trackStatic' title={current.title} data-jfmod-track-field={name}>
            {caption}<span className='jfmod-stripValue'>{text}</span>
        </div>;
    }
    return <>
        <button type='button' className='jfmod-trackTrigger' aria-haspopup='listbox' aria-expanded={!!place}
            aria-label={`${name}: ${current.title}`} title={current.title} onClick={open} data-jfmod-track-field={name}>
            {caption}
            <span className='jfmod-stripValue'>
                {text}
                <span className={'material-icons jfmod-videoChevron ' + (place ? 'expand_less' : 'expand_more')} aria-hidden='true' />
            </span>
        </button>
        {/* Each list is exactly its cell (D75), so it is placed by position, not by the button. */}
        <Menu open={!!place} onClose={close} className='jfmod-trackMenu' anchorReference='anchorPosition'
            anchorPosition={place ? { top: place.top, left: place.left } : undefined}
            transformOrigin={{ vertical: 'top', horizontal: 'left' }}
            slotProps={{ list: { role: 'listbox', 'aria-label': name },
                paper: { className: 'jfmod-trackMenuPaper', style: place ? { width: place.width, maxHeight: place.room } : undefined } }}>
            {/* Menu items as the menu's own children, so it opens on the current one (it focuses the child marked selected). */}
            {entries.map(entry => <MenuItem key={entry.value} role='option' aria-selected={entry === current} selected={entry === current}
                title={entry.title} onClick={pick} data-jfmod-track={entry.value}
                className={'jfmod-trackItem' + (entry === current ? ' jfmod-trackItem--on' : '') + (entry.extra ? ' jfmod-trackItem--two' : '')}>
                {entry.extra ? <>
                    <span className='jfmod-trackRun'>{entry.content}</span>
                    <span className='jfmod-trackExtra'>{entry.extra}</span>
                </> : entry.content}
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
    if (!state) return null;
    // A file without such tracks keeps its cell, at its fixed width, reading None, so switching the file never resizes the
    // strip or its lists (user, 2026-10-29; D131, replacing D30's hidden segment).
    if (state.hidden) {
        const none = [{ value: '', title: `No ${name.toLowerCase()}`, content: <TrackLanguage language='None' />, extra: undefined }];
        return createPortal(<TrackDropdown name={name} entries={none} value='' enabled={false} onChoose={choose} />, host);
    }
    const streams = (findSource(sources, state.sourceId) ?? sources[0])?.MediaStreams ?? [];
    const entries = state.options.map(option => {
        const stream = streams.find(candidate => candidate.Type === type && String(candidate.Index) === option.value);
        let content: ReactNode = <TrackLanguage language={option.text} />;
        if (stream) content = <TrackText stream={stream} names={names} />;
        else if (type === 'Subtitle' && option.value === '-1') content = <TrackLanguage language='Off' />;
        return { value: option.value, title: option.text, content, extra: stream ? trackExtraWords(stream) || undefined : undefined };
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
