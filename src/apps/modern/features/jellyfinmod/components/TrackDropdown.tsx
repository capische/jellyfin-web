import type { Api } from '@jellyfin/sdk/lib/api';
import type { MediaSourceInfo } from '@jellyfin/sdk/lib/generated-client/models/media-source-info';
import type { MediaStream } from '@jellyfin/sdk/lib/generated-client/models/media-stream';
import { useQuery } from '@tanstack/react-query';
import React, { type FC, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { getLanguageNames } from '../api/modApi';
import { TRACK_ROLE_NAME, trackExtraWords, trackModifier, trackRole, type TrackRole } from '../constants/tracks';
import { findSource, streamMarks, subtitleFormat } from '../constants/versions';
import { type StripHosts } from './FileChooser';
import { AudioTrackMarks, audioQuiet, QuietTrack } from '../design/MediaMarks';
import { DesignContext, quietTracks } from '../design/Root';
import { TrackField, ChooseRow } from '../design/TrackField';

// The media marks' own styles.

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
    /** The closed value on a computer, which has no caption to name the field: `Subtitles Off`, `No Audio`. */
    quiet?: ReactNode;
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
const RoleMark: FC<{ role: TrackRole }> = ({ role }) => <span className={role === 'comm' ? 'rflag glyph' : 'rflag'} title={TRACK_ROLE_NAME[role]}>
    {role === 'comm' ? <CommentaryGlyph /> : role}
</span>;

/**
 * The language in 600 and its short modifier (D60), which wraps out of sight first when the cell is narrow (D78); a language
 * still too long is cut with an ellipsis.
 */
export const TrackLanguage: FC<{ language: string; modifier?: string | null }> = ({ language, modifier }) => <span className='r'>
    <span className='language'>{language}</span>
    {modifier && <span className='modifier'>({modifier})</span>}
</span>;

/**
 * One track as its cell and its row draw it (D59, D76): language and modifier, the format marks, at most one role mark. The
 * track's own title is never drawn as it is; its extra words are the list's second line (`trackExtraWords`, D81 option A).
 */
export const TrackText: FC<{ stream: MediaStream; names: Record<string, string> | undefined }> = ({ stream, names }) => {
    const code = stream.Language?.toLowerCase() ?? '';
    const language = names?.[code] ?? (stream.Language || 'Unknown');
    const format = stream.Type === 'Subtitle' ? subtitleFormat(stream) : null;
    const role = trackRole(stream);
    const quiet = quietTracks(useContext(DesignContext));
    if (quiet) {
        // The quiet controls: the language, the Dolby lockup and the channels; the format chip, the role's mark and the extra words are the details.
        const parsed = streamMarks(stream);
        const audio = stream.Type === 'Audio' ? audioQuiet(parsed) : { lockup: null, format: null };
        return <QuietTrack name={<TrackLanguage language={language} modifier={trackModifier(stream)} />} lockup={audio.lockup}
            channels={stream.Type === 'Audio' ? parsed.audioChannels : null} chip={format} mark={role && <RoleMark role={role} />}
            details={[audio.format, trackExtraWords(stream)]} />;
    }
    return <>
        <TrackLanguage language={language} modifier={trackModifier(stream)} />
        {stream.Type === 'Audio' ? <AudioTrackMarks parsed={streamMarks(stream)} /> : <span className='marks'>
            {format && <span className='mk tag'><span>{format}</span></span>}
        </span>}
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

/** The list mutates the same upstream select; only the source seg/vlist/vrow draw it. */
const TrackDropdown: FC<TrackDropdownProps & { stacked: boolean }> = ({ name, entries, value, enabled, onChoose, stacked }) => {
    const current = entries.find(entry => entry.value === value) ?? entries[0];
    // The quiet controls' rows carry the extra words in their details (`TrackText`).
    const quiet = quietTracks(useContext(DesignContext));
    if (!current) return null;
    return <TrackField kind={name === 'Audio' ? 'a' : 's'} name={name} value={current.content} quietValue={current.quiet} title={current.title} extra={current.extra} enabled={enabled && entries.length > 1} stacked={stacked}>
        {entries.map(entry => <ChooseRow key={entry.value} trackValue={entry.value} selected={entry === current} title={entry.title} onChoose={() => onChoose(entry.value)}>
            {entry.content}{entry.extra && !quiet && <span className='trackextra'>{entry.extra}</span>}
        </ChooseRow>)}
    </TrackField>;
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
    stacked: boolean;
}

/** One of upstream's track rows with its dropdown, its entries built from the select's options and the selected file's streams. */
const TrackRow: FC<TrackRowProps> = ({ view, host, selector, name, type, sources, names, stacked }) => {
    const { state, choose } = useTrackHost(view, selector);
    if (!state) return null;
    // A file without such tracks keeps its cell, at its fixed width, reading None, so switching the file never resizes the
    // strip or its lists (user, 2026-10-29; D131, replacing D30's hidden segment).
    if (state.hidden) {
        const none = [{ value: '', title: `No ${name.toLowerCase()}`, content: <TrackLanguage language='None' />, extra: undefined,
            quiet: <TrackLanguage language={'No ' + name} /> }];
        return createPortal(<TrackDropdown stacked={stacked} name={name} entries={none} value='' enabled={false} onChoose={choose} />, host);
    }
    const streams = (findSource(sources, state.sourceId) ?? sources[0])?.MediaStreams ?? [];
    const entries = state.options.map(option => {
        const stream = streams.find(candidate => candidate.Type === type && String(candidate.Index) === option.value);
        let content: ReactNode = <TrackLanguage language={option.text} />;
        let quiet: ReactNode;
        if (stream) {
            content = <TrackText stream={stream} names={names} />;
        } else if (type === 'Subtitle' && option.value === '-1') {
            content = <TrackLanguage language='Off' />;
            quiet = <TrackLanguage language='Subtitles Off' />;
        }
        return { value: option.value, title: option.text, content, quiet, extra: stream ? trackExtraWords(stream) || undefined : undefined };
    });
    return createPortal(<TrackDropdown stacked={stacked} name={name} entries={entries} value={state.value} enabled={!state.disabled} onChoose={choose} />,
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
    // Native option text remains usable while stream facts/names load, and after a failed names read.
    return <>
        <TrackRow view={view} host={strip.audio} selector='.selectAudioContainer' name='Audio' type='Audio' sources={sources ?? []}
            names={languages.data} stacked={strip.stacked} />
        <TrackRow view={view} host={strip.subtitles} selector='.selectSubtitlesContainer' name='Subtitles' type='Subtitle'
            sources={sources ?? []} names={languages.data} stacked={strip.stacked} />
    </>;
};

export default TrackDropdowns;
