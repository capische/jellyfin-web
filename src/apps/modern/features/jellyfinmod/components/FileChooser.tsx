import type { MediaSourceInfo } from '@jellyfin/sdk/lib/generated-client/models/media-source-info';
import classNames from 'classnames';
import React, { type FC, type MouseEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import focusManager from 'components/focusManager';
import layoutManager from 'components/layoutManager';
import inputManager from 'scripts/inputManager';
import { getKeyName } from 'scripts/keyboardNavigation';

import { describeVersion, fileMarks, findSource, sameItemId } from '../constants/versions';
import { isBackKey } from '../shell/dpadModals';
import type { VersionDto } from '../types/versions';
import PhoneMark, { PHONE_COPY_LABEL } from './PhoneMark';
import { MediaMarks } from './ReleaseRowParts';

import './fileChooser.scss';
// The media marks' own styles.
import './releasePicker.scss';

const SOURCE_SELECTOR = '.selectSource';
const VIDEO_SELECTOR = '.trackSelections .selectVideoContainer';
const FORM_SELECTOR = '.trackSelections';
/** How long the list takes to slide back before its rows leave the page; matches the stylesheet. */
const SLIDE_MS = 180;

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
    /** The page item's media sources, once read: each file's marks come from its streams (P7.FU6). */
    sources?: MediaSourceInfo[];
    /** The strip's hosts (`useTrackStrip`): the Video segment and the place under the strip. */
    strip: StripHosts;
    /** Another version on its way (`PendingVersion`): under the strip while the list is closed, inside the list while it is open. */
    pending?: ReactNode;
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
 * The media source ids upstream's Version select lists for this page's item, or null when the page has no such select.
 * A file the plugin still lists but Jellyfin no longer has (an item Jellyfin re-created under a new id) is not among them,
 * and the page shows only these (user, 2026-10-08: a ghost second row on a one-file movie). Returned as one string so it
 * stays the same value between renders.
 */
export const useStockSourceIds = (view: HTMLElement): string | null => {
    const read = () => {
        const select = findSelect(view);
        return select ? Array.from(select.options).map(option => option.value).join(',') : null;
    };
    const [ids, setIds] = useState<string | null>(read);
    useEffect(() => {
        const select = findSelect(view);
        if (!select) return;
        const update = () => setIds(Array.from(select.options).map(option => option.value).join(','));
        update();
        const observer = new MutationObserver(update);
        observer.observe(select, { childList: true });
        return () => observer.disconnect();
    }, [view]);
    return ids;
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

/** Where the strip draws (`useTrackStrip`): a slot per segment and the place under the strip for the Video list and the pending entry. */
export interface StripHosts {
    video: HTMLElement;
    audio: HTMLElement;
    subtitles: HTMLElement;
    below: HTMLElement;
}

/**
 * The track strip (D4–D9, user-approved 2026-10-28, `reviews/upgrade-status-options/all-in-one`): Video, Audio and Subtitles as
 * one field of three segments, right after upstream's track form, with a place under it. Upstream's form stays in the DOM as the
 * source of truth (its selects keep their values and events); each of its rows steps aside only while its segment is drawn, so a
 * row whose dropdown cannot mount (its streams unread) still shows as upstream draws it. The strip goes with the form when
 * upstream hides it (nothing to play).
 */
export const useTrackStrip = (view: HTMLElement, enabled: boolean): StripHosts | null => {
    const [hosts, setHosts] = useState<StripHosts | null>(null);
    useEffect(() => {
        const form = view.querySelector<HTMLElement>(FORM_SELECTOR);
        const parent = form?.parentNode;
        if (!enabled || !form || !parent) return;
        const strip = document.createElement('div');
        strip.className = 'jfmod-strip';
        const slot = (name: string) => {
            const element = document.createElement('div');
            element.className = 'jfmod-stripSegment jfmod-stripSegment--' + name;
            strip.appendChild(element);
            return element;
        };
        const below = document.createElement('div');
        below.className = 'jfmod-stripBelow';
        const next = { video: slot('video'), audio: slot('audio'), subtitles: slot('subtitles'), below };
        parent.insertBefore(below, form.nextSibling);
        parent.insertBefore(strip, below);
        form.classList.add('jfmod-stripMounted');
        setHosts(next);
        return () => {
            strip.remove();
            below.remove();
            form.classList.remove('jfmod-stripMounted');
            setHosts(null);
        };
    }, [view, enabled]);
    // Null in the very render that disables it (the page lists no file any more), not one effect later: the segments must never
    // draw without a file (Codex review of the upgrade status, P2 2).
    return enabled ? hosts : null;
};

/**
 * Upstream's Video row steps aside while the Video segment is drawn (its select is disabled and only names the stream; the
 * segment names the file), and its Version select while the chooser is mounted (UX §1.1 exception 2).
 */
const useVideoRowHidden = (view: HTMLElement) => {
    useEffect(() => {
        const container = view.querySelector<HTMLElement>(VIDEO_SELECTOR);
        const form = view.querySelector<HTMLElement>(FORM_SELECTOR);
        container?.classList.add('jfmod-videoHost');
        form?.classList.add('jfmod-chooserMounted');
        return () => {
            container?.classList.remove('jfmod-videoHost');
            form?.classList.remove('jfmod-chooserMounted');
        };
    }, [view]);
};

/** A row action: upstream's round icon button, grey, red when it destroys, with the TV's focus ring (user, 2026-10-08). */
const iconClass = (extra?: string) => classNames('paper-icon-button-light jfmod-fileIcon', extra, { 'show-focus': layoutManager.tv });

/** How a row's actions name their file for a screen reader: `the 1080p file`. */
const fileName = (version: VersionDto) => `the ${describeVersion(version).resolution} file`;

/**
 * The pin's accessible name always names its row's file: the file-level Keep acts on it; an episode or title Keep, or a
 * read-only one, says what it keeps and which file's row it is on.
 */
const pinLabel = (pin: PinState, version: VersionDto) => {
    if (pin.title === 'Keep') return `Keep ${fileName(version)}`;
    if (pin.title === 'Stop Keeping') return `Stop keeping ${fileName(version)}`;
    return `${pin.locked ?? pin.title}, on ${fileName(version)}`;
};

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
 * History, pin and cross at the end of a file's row (design step 2): round, icon-only stock icon buttons with a 2.5em hit
 * area, each its own D-pad stop; grey, the cross red, the pin in primary while the file is kept (user rules, 2026-10-08).
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
        {hasHistory && <button type='button' className={iconClass()} title='History' aria-label={`History of ${fileName(version)}`}
            data-jfmod-file-history={version.bindingId} onClick={history}>
            <span className='material-icons history' aria-hidden='true' />
        </button>}
        {pin && <button type='button' className={iconClass(pin.kept ? 'jfmod-fileIcon--pin jfmod-fileIcon--on' : 'jfmod-fileIcon--pin')}
            title={pin.locked ?? pin.title} aria-label={pinLabel(pin, version)} aria-pressed={pin.kept}
            aria-disabled={busy || !!pin.locked} data-jfmod-file-pin={version.bindingId} onClick={keep}>
            <span className='material-icons push_pin' aria-hidden='true' />
        </button>}
        {removable && <button type='button' className={iconClass('jfmod-fileIcon--danger')} title='Remove This Version'
            aria-label={`Remove ${fileName(version)}`}
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
    source: MediaSourceInfo | null;
}

/**
 * What a file's video is, the same on its row and on the closed dropdown (user, 2026-10-12; P7.FU6): the mod's resolution word
 * and the release picker's media marks for its video stream. Its audio and subtitles are the Audio and Subtitles cells' only: a
 * file's audio matters when a whole release is chosen (the picker, the Queue), not here (user, 2026-10-29; D105).
 */
const VideoSummary: FC<{ version: VersionDto; source: MediaSourceInfo | null }> = ({ version, source }) => <>
    {/* The file phones play carries the phone mark inside its resolution word (Phase 12, D52); the plugin marks it only on a
        title with two or more files, and nothing names the best copy: the list is best first. */}
    <span className='jfmod-fileResolution'>{describeVersion(version).resolution}{version.phoneCopy && <PhoneMark label={PHONE_COPY_LABEL} />}</span>
    <span className='jfmod-fileMarks'><MediaMarks parsed={fileMarks(version, source).video} /></span>
</>;

/** The file's size, in the secondary colour at the right end of the value and of each row (P7.FU6). */
const FileSize: FC<{ version: VersionDto }> = ({ version }) => {
    const size = describeVersion(version).size;
    return size ? <span className='jfmod-fileSize'>{size}</span> : null;
};

/** The file in words, for screen readers: `2160p HEVC 10-bit HDR 10.3 GB`. */
const summaryLabel = (version: VersionDto) => {
    const text = describeVersion(version);
    return [text.resolution, text.video, text.size].filter(Boolean).join(' ');
};

/**
 * A file's row (P7.FU6): resolution and video marks only (D105) and the extras (episode range, removal date), then the size
 * right-aligned, then its icons. On a phone the extras take a second line.
 */
const FileRow: FC<FileRowProps> = ({ version, selected, onChoose, removeDate, source, ...icons }) => {
    const choose = useCallback(() => onChoose(version), [onChoose, version]);
    return <div className={classNames('jfmod-fileRow', { 'jfmod-fileRow--selected': selected })}>
        <button type='button' className='jfmod-fileChoose' aria-pressed={selected}
            data-jfmod-media-source-id={version.mediaSourceId} onClick={choose}>
            <span className='jfmod-fileBody'>
                <span className='jfmod-fileLine'><VideoSummary version={version} source={source} /></span>
                {(version.episodeRange || removeDate) && <span className='jfmod-fileLine jfmod-fileLine--extra'>
                    {version.episodeRange && <span className='jfmod-fileExtra'>{version.episodeRange}</span>}
                    {/* Only the removal date: torrent and bookkeeping states ("waiting for seeding", "not tracked yet") are not the
                        viewer's business (user, 2026-10-28). */}
                    {removeDate && <span className='jfmod-fileExtra jfmod-fileExtra--dot'>removes {removeDate}</span>}
                </span>}
            </span>
            <FileSize version={version} />
        </button>
        <FileIcons version={version} {...icons} />
    </div>;
};

/** Something drawn over the page (an MUI pop-up, a stock dialog) takes Back before the list does. */
const OVERLAY_SELECTOR = '.MuiModal-root:not(.MuiModal-hidden):not([aria-hidden="true"]), .dialogContainer .dialog';

/**
 * While the Video list is open, the remote's Back (and Escape) closes it and nothing else, as for the Audio and Subtitles
 * lists (D4: one component, one step per change); with it closed, Back navigates as before.
 */
const useBackCloses = (open: boolean, close: () => void) => {
    const latest = useRef(close);
    latest.current = close;
    useEffect(() => {
        if (!open) return;
        const covered = () => !!document.querySelector(OVERLAY_SELECTOR);
        const onKey = (event: KeyboardEvent) => {
            const key = getKeyName(event) || event.key;
            if (event.defaultPrevented || covered() || (!isBackKey(key) && !isBackKey(event.key))) return;
            event.preventDefault();
            event.stopPropagation();
            latest.current();
        };
        const onCommand = (event: Event) => {
            if ((event as CustomEvent<{ command?: string }>).detail?.command !== 'back' || event.defaultPrevented || covered()) return;
            event.preventDefault();
            latest.current();
        };
        window.addEventListener('keydown', onKey, true);
        inputManager.on(window, onCommand);
        return () => {
            window.removeEventListener('keydown', onKey, true);
            inputManager.off(window, onCommand);
        };
    }, [open]);
};

/**
 * Where a cell's list goes (D75, and the user's 2026-10-29 look): exactly under its cell, flush against the strip's bottom edge,
 * from the cell's left (its divider) to its right edge; the first cell's list starts at the strip's outer left edge and the last
 * one's ends at its outer right edge. On the phone, under the stacked row, the card's width. Viewport coordinates.
 */
export const listPlace = (trigger: HTMLElement) => {
    const cell = trigger.closest<HTMLElement>('.jfmod-stripSegment') ?? trigger;
    const strip = cell.closest<HTMLElement>('.jfmod-strip');
    const box = cell.getBoundingClientRect();
    if (!strip) return { top: box.bottom, left: box.left, width: box.width };
    const outer = strip.getBoundingClientRect();
    if (layoutManager.mobile) return { top: box.bottom, left: outer.left, width: outer.width };
    const drawn = (start: Element | null, step: (element: Element) => Element | null) => {
        let element = start;
        while (element && !element.childElementCount) element = step(element);
        return element;
    };
    const left = drawn(cell.previousElementSibling, element => element.previousElementSibling) ? box.left : outer.left;
    const right = drawn(cell.nextElementSibling, element => element.nextElementSibling) ? box.right : outer.right;
    return { top: outer.bottom, left, width: right - left };
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
 * The Video segment of the track strip as the file chooser (design step 2, user 2026-10-07; UX §11.2; the strip D4–D9,
 * 2026-10-28). Its value carries a chevron and opens a list of the files under the strip, as wide as it, also when there is
 * only one (user, 2026-10-08: one dropdown everywhere); choosing one sets upstream's
 * `.selectSource` and dispatches its bubbling `change`, exactly as the version rows did, so Play, audio and subtitles follow,
 * the viewer's own choice is never replaced and the device preference still applies. The pending download (`pending`) sits
 * under the strip, or in the list while it is open.
 */
const FileChooser: FC<FileChooserProps> = ({ view, versions, preferred, busy, onHistory, pin, onPin, canRemove,
    onRemove, removeDate, note, sources, strip, pending }) => {
    const multi = versions.length > 1;
    useVideoRowHidden(view);
    const current = useSelectedSource(view);
    const chosen = useRef(false);
    useViewerChoice(view, chosen);
    useDevicePreference(view, multi ? preferred : null, chosen);
    const slide = useSlide();
    // The Video list floats like Audio's (user, 2026-10-29): placed under its cell when it opens; the pending entry under the strip
    // leaves its height behind while it sits in the list, so the page does not move.
    const [place, setPlace] = useState<{ top: number; left: number; width: number; spacer: number } | null>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const toggle = useCallback(() => {
        if (slide.open) {
            slide.hide();
            return;
        }
        if (trigger.current) {
            const at = listPlace(trigger.current);
            const below = strip.below.getBoundingClientRect();
            const entry = strip.below.querySelector(':scope > .jfmod-pending');
            setPlace({ top: at.top - below.top, left: at.left - below.left, width: at.width, spacer: entry?.getBoundingClientRect().height ?? 0 });
        }
        slide.show();
    }, [slide, strip.below]);
    // A click outside the list and its cell closes it, as outside Audio's.
    useEffect(() => {
        if (!slide.open) return;
        const outside = (event: Event) => {
            const target = event.target as Node;
            if (!strip.below.querySelector('.jfmod-fileList')?.contains(target) && !trigger.current?.contains(target)) slide.hide();
        };
        document.addEventListener('mousedown', outside, true);
        return () => document.removeEventListener('mousedown', outside, true);
    }, [slide, strip.below]);
    const choose = useCallback((version: VersionDto) => {
        chosen.current = true;
        selectVersion(view, version);
        slide.hide();
        // The focused row is about to leave the page; the remote stays on the value it opened.
        if (trigger.current) focusManager.focus(trigger.current);
    }, [slide, view]);
    const backClose = useCallback(() => {
        slide.hide();
        if (trigger.current) focusManager.focus(trigger.current);
    }, [slide]);
    useBackCloses(slide.open, backClose);

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

    const listId = 'jfmod-fileList-' + (selected?.mediaSourceId ?? 'files');
    return <>
        {createPortal(<button ref={trigger} type='button' className='jfmod-videoTrigger' aria-expanded={slide.open} aria-controls={listId}
            aria-label={`Video: ${summaryLabel(selected)}. ${versions.length} ${versions.length === 1 ? 'file' : 'files'}`}
            onClick={toggle}>
            <span className='jfmod-stripCaption' aria-hidden='true'>Video</span>
            <span className='jfmod-stripValue'>
                <span className='jfmod-videoTriggerText'><VideoSummary version={selected} source={findSource(sources, selected.mediaSourceId)} /></span>
                <FileSize version={selected} />
                <span className={'material-icons jfmod-videoChevron ' + (slide.open ? 'expand_less' : 'expand_more')} aria-hidden='true' />
            </span>
        </button>, strip.video)}
        {createPortal(<>
            {/* A grid row that grows from 0fr to 1fr, so the list slides at its own height (user, 2026-10-12: the max-height slide
                was over in two frames opening and waited 140 ms closing). It is the Video cell's width (D99); another quality is
                got from the page's cloud icon, so the list has no row for it (D102). */}
            <div id={listId} className={classNames('jfmod-fileList', { 'jfmod-fileList--open': slide.open })}
                style={place ? { top: place.top, left: place.left, width: place.width } : undefined}>
                <div className='jfmod-fileListClip'>{slide.rendered && <div className='jfmod-fileListBox'>
                    {versions.map(version => <FileRow key={version.mediaSourceId} version={version}
                        selected={version.mediaSourceId === selectedId} onChoose={choose} removeDate={removeDate(version)}
                        source={findSource(sources, version.mediaSourceId)}
                        {...iconProps(version)} />)}
                    {pending}
                    {note && <p className='jfmod-fileNote'>{note}</p>}
                </div>}</div>
            </div>
            {/* The pending entry under the strip (D9); while the list is open it is the list's row instead. */}
            {slide.rendered ? <div style={{ height: place?.spacer ?? 0 }} aria-hidden='true' /> : pending}
        </>, strip.below)}
    </>;
};

export default FileChooser;
