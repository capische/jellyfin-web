import classNames from 'classnames';
import React, { type FC, type MouseEvent, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import focusManager from 'components/focusManager';
import layoutManager from 'components/layoutManager';

import { describeVersion, sameItemId } from '../constants/versions';
import type { VersionDto } from '../types/versions';

import './fileChooser.scss';

const SOURCE_SELECTOR = '.selectSource';
const VIDEO_SELECTOR = '.trackSelections .selectVideoContainer';
/** How long the list takes to slide back before its rows leave the page; matches the stylesheet. */
const SLIDE_MS = 200;

/** The pin on a file's row: per-file Keep, or the episode's or title's Keep where that is what the plugin offers. */
export interface PinState {
    kept: boolean;
    /** Read-only (`aria-disabled`) with this reason, for a Keep the page cannot undo. */
    locked?: string;
    title: string;
}

export interface FileChooserProps {
    /** The native detail view that owns upstream's `.trackSelections`. */
    view: HTMLElement;
    versions: VersionDto[];
    /** The copy this device starts with (V1 decision 4); null leaves Jellyfin's default. */
    preferred?: VersionDto | null;
    busy: boolean;
    /** Administrators with release search and `versions`: the last row is Get another quality. */
    onAddVersion?: (opener: HTMLElement) => void;
    /** Opens one file's history; absent when the plugin does not stamp files on history events (`history.files`). */
    onHistory?: (version: VersionDto, opener: HTMLElement) => void;
    /** The pin for one file, or null where this viewer has none. */
    pin: (version: VersionDto) => PinState | null;
    onPin: (version: VersionDto, opener: HTMLElement) => void;
    /** Whether this viewer may remove exactly this file. */
    canRemove: (version: VersionDto) => boolean;
    onRemove: (version: VersionDto, opener: HTMLElement) => void;
    /** `12 Oct` when the file has a scheduled removal. */
    removeDate: (version: VersionDto) => string | null;
    /** A line under the rows for administrators, such as what stock Delete removes (V1). */
    note?: string | null;
}

const findSelect = (view: HTMLElement) => view.querySelector<HTMLSelectElement>(SOURCE_SELECTOR);

/**
 * The stock select's current value. Upstream rewrites its options on every render of the page without a `change`
 * event, so this is read on change and whenever its options are replaced.
 */
const useSelectedSource = (view: HTMLElement) => {
    const [value, setValue] = useState(() => findSelect(view)?.value ?? '');
    useEffect(() => {
        const select = findSelect(view);
        if (!select) return;
        const read = () => setValue(select.value);
        read();
        select.addEventListener('change', read);
        const observer = new MutationObserver(read);
        observer.observe(select, { childList: true });
        return () => {
            select.removeEventListener('change', read);
            observer.disconnect();
        };
    }, [view]);
    return value;
};

/**
 * True only while this component dispatches its own `change`. Every other `change` on the select is the viewer's: a
 * mouse or touch pick is a trusted event, but the stock `emby-select` on a TV (webOS) picks through an action sheet and
 * dispatches a synthetic one, which must count as the viewer's choice too.
 */
let dispatchingOwnChange = false;

/** Sets the stock select to a version and lets upstream react through its own `change` event. */
const selectVersion = (view: HTMLElement, version: VersionDto) => {
    const select = findSelect(view);
    const option = select && Array.from(select.options).find(candidate => sameItemId(candidate.value, version.mediaSourceId));
    if (!select || !option || select.value === option.value) return;
    select.value = option.value;
    dispatchingOwnChange = true;
    try {
        select.dispatchEvent(new Event('change', { bubbles: true }));
    } finally {
        dispatchingOwnChange = false;
    }
};

/**
 * Records the viewer's own choice on the stock select from the moment the chooser mounts, whether or not the preferred copy
 * is known yet (the TV waits for Jellyfin's range types): a pick made while that request runs is never replaced.
 */
const useViewerChoice = (view: HTMLElement, chosen: { current: boolean }) => {
    useEffect(() => {
        const select = findSelect(view);
        if (!select) return;
        const viewerChange = () => {
            if (!dispatchingOwnChange) chosen.current = true;
        };
        select.addEventListener('change', viewerChange);
        return () => select.removeEventListener('change', viewerChange);
    }, [view, chosen]);
};

/**
 * Starts this device on the copy that suits it (V1 decision 4): once the stock select lists the versions, and again when
 * upstream rewrites its options, until the viewer chooses a copy themselves on the select or a row.
 */
const useDevicePreference = (view: HTMLElement, preferred: VersionDto | null | undefined, chosen: { current: boolean }) => {
    useEffect(() => {
        const select = findSelect(view);
        if (!preferred || !select) return;
        const apply = () => {
            if (!chosen.current) selectVersion(view, preferred);
        };
        apply();
        const observer = new MutationObserver(apply);
        observer.observe(select, { childList: true });
        return () => observer.disconnect();
    }, [view, preferred, chosen]);
};

interface VideoHost {
    host: HTMLElement | null;
    /** True when the chooser sits inside upstream's Video row; false when that row lists several video streams. */
    inline: boolean;
    /** Upstream's text for the selected video stream, as its disabled select shows it. */
    videoText: string;
}

/**
 * Where the chooser lives (design step 2): inside upstream's Video row, after its select. With two or more files and one
 * video stream, the row's disabled select is hidden by a mod class on the row while the chooser's trigger shows the same
 * text, so the row reads as one value with a chevron. A file with several video streams keeps upstream's select visible
 * and the chooser takes a row of its own directly above it. Upstream's Version select is hidden only while the chooser is
 * mounted (UX §1.1 exception 2). Nothing here edits upstream's markup beyond these mod classes and the mount.
 */
const useVideoHost = (view: HTMLElement, multi: boolean): VideoHost => {
    const [state, setState] = useState<VideoHost>({ host: null, inline: true, videoText: '' });
    useEffect(() => {
        const container = view.querySelector<HTMLElement>(VIDEO_SELECTOR);
        const select = container?.querySelector<HTMLSelectElement>('select');
        const form = container?.parentNode as HTMLElement | null | undefined;
        if (!container || !select || !form) return;
        const host = document.createElement('div');
        host.className = 'jfmod-videoChooser';
        const place = () => {
            const inline = select.options.length <= 1;
            if (inline && host.parentNode !== container) container.appendChild(host);
            if (!inline && host.nextSibling !== container) form.insertBefore(host, container);
            if (inline) host.classList.remove('jfmod-videoChooser--row');
            else host.classList.add('jfmod-videoChooser--row');
            if (inline && multi) container.classList.add('jfmod-videoHost');
            else container.classList.remove('jfmod-videoHost');
            // One file: the icons follow the Video text rather than the row's far end, where no header button's Down reaches
            // them on the TV (each must be a D-pad stop, design step 2).
            if (inline && !multi) container.classList.add('jfmod-videoIconsHost');
            else container.classList.remove('jfmod-videoIconsHost');
            const videoText = select.options[select.selectedIndex]?.text ?? '';
            setState(current => (current.host === host && current.inline === inline && current.videoText === videoText ?
                current : { host, inline, videoText }));
        };
        place();
        if (multi) form.classList.add('jfmod-chooserMounted');
        const observer = new MutationObserver(place);
        observer.observe(select, { childList: true });
        return () => {
            observer.disconnect();
            host.remove();
            container.classList.remove('jfmod-videoHost');
            container.classList.remove('jfmod-videoIconsHost');
            form.classList.remove('jfmod-chooserMounted');
            setState({ host: null, inline: true, videoText: '' });
        };
    }, [view, multi]);
    return state;
};

const iconClass = (extra?: string) => classNames('paper-icon-button-light jfmod-fileIcon', extra,
    { 'show-focus jfmod-fileIcon--tv': layoutManager.tv });

interface FileIconsProps {
    version: VersionDto;
    busy: boolean;
    onHistory?: (version: VersionDto, opener: HTMLElement) => void;
    pin: PinState | null;
    onPin: (version: VersionDto, opener: HTMLElement) => void;
    removable: boolean;
    onRemove: (version: VersionDto, opener: HTMLElement) => void;
}

/**
 * History, pin and cross at the end of a file's row (design step 2): stock icon buttons, each its own D-pad stop, dimmed until
 * hovered or focused on desktop and always full on the TV.
 */
const FileIcons: FC<FileIconsProps> = ({ version, busy, onHistory, pin, onPin, removable, onRemove }) => {
    const history = useCallback((event: MouseEvent<HTMLButtonElement>) => onHistory?.(version, event.currentTarget), [onHistory, version]);
    const keep = useCallback((event: MouseEvent<HTMLButtonElement>) => {
        if (busy || pin?.locked) return;
        onPin(version, event.currentTarget);
    }, [busy, onPin, pin?.locked, version]);
    const remove = useCallback((event: MouseEvent<HTMLButtonElement>) => {
        if (!busy) onRemove(version, event.currentTarget);
    }, [busy, onRemove, version]);
    // A file the plugin has not bound yet (its binding id empty or all zeros) has no events of its own.
    const hasHistory = !!onHistory && version.tracked !== false && /[1-9a-f]/i.test(version.bindingId ?? '');
    if (!hasHistory && !pin && !removable) return null;
    return <span className='jfmod-fileIcons'>
        {hasHistory && <button type='button' className={iconClass()} title='History' aria-label='History of this file'
            data-jfmod-file-history={version.bindingId} onClick={history}>
            <span className='material-icons history' aria-hidden='true' />
        </button>}
        {pin && <button type='button' className={iconClass(pin.kept ? 'jfmod-fileIcon--on' : undefined)}
            title={pin.locked ?? pin.title} aria-label={pin.locked ?? pin.title} aria-pressed={pin.kept}
            aria-disabled={busy || !!pin.locked} data-jfmod-file-pin={version.bindingId} onClick={keep}>
            <span className='material-icons push_pin' aria-hidden='true' />
        </button>}
        {removable && <button type='button' className={iconClass()} title='Remove this version' aria-label='Remove this version'
            aria-disabled={busy} data-jfmod-file-remove={version.bindingId} onClick={remove}>
            <span className='material-icons close' aria-hidden='true' />
        </button>}
    </span>;
};

interface FileRowProps extends Omit<FileIconsProps, 'pin' | 'removable'> {
    selected: boolean;
    onChoose: (version: VersionDto) => void;
    pin: PinState | null;
    removable: boolean;
    removeDate: string | null;
}

const FileRow: FC<FileRowProps> = ({ version, selected, onChoose, removeDate, ...icons }) => {
    const choose = useCallback(() => onChoose(version), [onChoose, version]);
    const text = describeVersion(version);
    const details = [text.video, text.audio, text.size].filter(Boolean).join(' · ');
    return <div className={classNames('jfmod-fileRow', { 'jfmod-fileRow--selected': selected })}>
        <button type='button' className='jfmod-fileChoose' aria-pressed={selected}
            data-jfmod-media-source-id={version.mediaSourceId} onClick={choose}>
            <span className='jfmod-fileMark' aria-hidden='true'>{selected ? '●' : '○'}</span>
            <span className='jfmod-fileBody'>
                <span className='jfmod-fileResolution'>{text.resolution}</span>
                {details && <span className='jfmod-fileDetails'>{details}</span>}
                {text.label && <span className='jfmod-fileExtra'>{text.label}</span>}
                {version.episodeRange && <span className='jfmod-fileExtra'>{version.episodeRange}</span>}
                {version.tracked === false && <span className='jfmod-fileExtra jfmod-fileExtra--dot'>not tracked yet</span>}
                {removeDate && <span className='jfmod-fileExtra jfmod-fileExtra--dot'>removes {removeDate}</span>}
                {!removeDate && text.retention && <span className='jfmod-fileExtra jfmod-fileExtra--dot'>{text.retention}</span>}
                {version.isDefault && <span className='jfmod-fileDefault'>Default</span>}
            </span>
        </button>
        <FileIcons version={version} {...icons} />
    </div>;
};

/** Slides open and closed; the rows exist only while open or closing, so a closed list is never a D-pad stop. */
const useSlide = () => {
    const [open, setOpen] = useState(false);
    const [rendered, setRendered] = useState(false);
    const timer = useRef<number>();
    useEffect(() => () => window.clearTimeout(timer.current), []);
    const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const show = useCallback(() => {
        window.clearTimeout(timer.current);
        setRendered(true);
        // One frame with the rows present and the list closed, so the height transition has a start.
        window.requestAnimationFrame(() => setOpen(true));
    }, []);
    const hide = useCallback(() => {
        setOpen(false);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setRendered(false), reduced() ? 0 : SLIDE_MS);
    }, []);
    return { open, rendered, show, hide };
};

/**
 * The Video row as the file chooser (design step 2, user 2026-10-07; UX §11.2). With two or more files its value carries a
 * chevron and opens a list of the files; choosing one sets upstream's `.selectSource` and dispatches its bubbling `change`,
 * exactly as the version rows did, so Play, audio and subtitles follow, the viewer's own choice is never replaced and the
 * device preference still applies. With one file there is no chooser: upstream's row stays and the file's icons sit at its
 * end. If upstream's Video row is not there, nothing is mounted and the stock Version select stays visible.
 */
const FileChooser: FC<FileChooserProps> = ({ view, versions, preferred, busy, onAddVersion, onHistory, pin, onPin, canRemove,
    onRemove, removeDate, note }) => {
    const multi = versions.length > 1;
    const { host, inline, videoText } = useVideoHost(view, multi);
    const current = useSelectedSource(view);
    const chosen = useRef(false);
    useViewerChoice(view, chosen);
    useDevicePreference(view, multi ? preferred : null, chosen);
    const slide = useSlide();
    const trigger = useRef<HTMLButtonElement>(null);
    const toggle = useCallback(() => (slide.open ? slide.hide() : slide.show()), [slide]);
    const choose = useCallback((version: VersionDto) => {
        chosen.current = true;
        selectVersion(view, version);
        slide.hide();
        // The focused row is about to leave the page; the remote stays on the value it opened.
        if (trigger.current) focusManager.focus(trigger.current);
    }, [slide, view]);
    const addVersion = useCallback((event: MouseEvent<HTMLButtonElement>) => onAddVersion?.(event.currentTarget), [onAddVersion]);

    if (!host) return null;
    // With no option to match (one version, or a page that cannot choose sources) the default is the one that plays.
    const selectedId = versions.find(version => sameItemId(version.mediaSourceId, current))?.mediaSourceId
        ?? versions.find(version => version.isDefault)?.mediaSourceId
        ?? versions[0]?.mediaSourceId;
    const selected = versions.find(version => version.mediaSourceId === selectedId) ?? versions[0];
    const iconProps = (version: VersionDto) => ({
        busy, onHistory, onPin, onRemove,
        pin: pin(version),
        removable: canRemove(version)
    });

    if (!multi) {
        return createPortal(<FileIcons version={versions[0]} {...iconProps(versions[0])} />, host);
    }

    const triggerText = (inline && videoText) || [describeVersion(selected).resolution, describeVersion(selected).video]
        .filter(Boolean).join(' ');
    const listId = 'jfmod-fileList-' + (selected?.mediaSourceId ?? 'files');
    return createPortal(<>
        {!inline && <span className='jfmod-chooserLabel'>Version</span>}
        <div className='jfmod-chooserValue'>
            <button ref={trigger} type='button' className='jfmod-videoTrigger' aria-expanded={slide.open} aria-controls={listId}
                aria-label={`Video: ${triggerText}. ${versions.length} files`} onClick={toggle}>
                <span className='jfmod-videoTriggerText'>{triggerText}</span>
                <span className={'material-icons jfmod-videoChevron ' + (slide.open ? 'expand_less' : 'expand_more')} aria-hidden='true' />
            </button>
            <div id={listId} className={classNames('jfmod-fileList', { 'jfmod-fileList--open': slide.open })}>
                {slide.rendered && <>
                    {versions.map(version => <FileRow key={version.mediaSourceId} version={version}
                        selected={version.mediaSourceId === selectedId} onChoose={choose} removeDate={removeDate(version)}
                        {...iconProps(version)} />)}
                    {onAddVersion && <div className='jfmod-fileRow jfmod-fileRow--add'>
                        <button type='button' className='jfmod-fileChoose' data-jfmod-add-version='' onClick={addVersion}>
                            <span className='jfmod-fileMark' aria-hidden='true'>+</span>
                            <span className='jfmod-fileBody'>Get another quality</span>
                        </button>
                    </div>}
                    {note && <p className='jfmod-fileNote'>{note}</p>}
                </>}
            </div>
        </div>
    </>, host);
};

export default FileChooser;
