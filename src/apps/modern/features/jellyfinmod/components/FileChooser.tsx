import type { MediaSourceInfo } from '@jellyfin/sdk/lib/generated-client/models/media-source-info';
import React, { type FC, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TrackField, ChooseRow } from '../design/TrackField';
import { DesignMediaMarks } from '../design/MediaMarks';
import { Icon } from '../design/Icon';
import { DesignContext } from '../design/Root';

import { bestFirst, describeVersion, fileMarks, findSource, sameItemId } from '../constants/versions';
import type { VersionDto } from '../types/versions';
import { PHONE_COPY_LABEL } from './PhoneMark';

const SOURCE_SELECTOR = '.selectSource';
const FORM_SELECTOR = '.trackSelections';
/** Audio's and Subtitles' fixed cells (17.8em and 13.2em, `ds.css`) on the phone, tablet and TV, which Video's width is left after. */
const TRACK_CELLS_EMS = 31;
/**
 * Under this Video cell width the strip stacks as on the phone (D199). 11.7em is a named exception to the golden ratio (φ⁵, 11.09em,
 * until D238): it is where the pending entry's quality stays on its line: a 996 px window keeps 11.74em
 * and stays a row, 995 px stacks; the TV at 1280 has 9.9em and stacks.
 */
const STACK_EMS = 11.7;

/** The selected file's Keep (in the title's More menu): per-file Keep, or the episode's or title's Keep where that is what the plugin offers. */
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
    /** `12 Oct` when the file has a scheduled removal. */
    removeDate: (version: VersionDto) => string | null;
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

/** The file the stock select has selected (its default, else the first, before it is read): what the More menu's version group acts on. */
export const selectedVersion = (versions: VersionDto[], current: string) => versions.find(version => sameItemId(version.mediaSourceId, current))
    ?? versions.find(version => version.isDefault) ?? versions[0];

/** The selected file as the stock select holds it now, read when the More menu opens. */
export const currentVersion = (view: HTMLElement, versions: VersionDto[]) => selectedVersion(versions, findSelect(view)?.value ?? '');

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
    /** The segments stack as rows of the card (`.gpk.stacked`): always on the phone, elsewhere on a narrow strip (D199). */
    stacked: boolean;
}

/**
 * Whether the strip stacks: always on the phone (D4) and the tablet (a window under 900 px, a tablet held upright); never on a
 * computer, whose three fields shrink alike instead (the user, 2026-11-07); on the TV where the Video cell would be narrower than
 * `STACK_EMS` (D199). It reads the strip's own width, which does not depend on the stacking, so the strip never flips back and
 * forth at the switch.
 */
const stacks = (strip: HTMLElement) => {
    const root = strip.closest('.jfds');
    if (document.documentElement.classList.contains('layout-mobile') || root?.matches('.dev-phone, .dev-tablet')) return true;
    if (root?.matches('.dev-computer:not(.layout-tv)')) return false;
    return strip.clientWidth < (TRACK_CELLS_EMS + STACK_EMS + 2 * 0.382) * parseFloat(getComputedStyle(strip).fontSize);
};

/**
 * The track strip (D4–D9, user-approved 2026-10-28, `reviews/upgrade-status-options/all-in-one`): Video, Audio and Subtitles as
 * one field of three segments, right after upstream's track form, with a place under it. Upstream's form stays in the DOM as the
 * source of truth (its selects keep their values and events); each of its rows steps aside only while its segment is drawn, so a
 * row whose dropdown cannot mount (its streams unread) still shows as upstream draws it. The strip goes with the form when
 * upstream hides it (nothing to play).
 */
export const useTrackStrip = (view: HTMLElement, enabled: boolean): StripHosts | null => {
    const [hosts, setHosts] = useState<Omit<StripHosts, 'stacked'> | null>(null);
    const [stacked, setStacked] = useState(false);
    useEffect(() => {
        const form = view.querySelector<HTMLElement>(FORM_SELECTOR);
        const parent = view.querySelector('[data-ds-slot="tracks"]') ?? form?.parentNode;
        if (!enabled || !form || !parent) return;
        const strip = document.createElement('div');
        strip.className = 'gpk';
        const below = document.createElement('div');
        below.dataset.dsTrackBelow = '';
        const next = { video: strip, audio: strip, subtitles: strip, below };
        parent.appendChild(strip);
        parent.appendChild(below);
        form.classList.add('jfmod-stripMounted');
        view.setAttribute('data-ds-tracks-mounted', '');
        // Stacked or not before the first paint, and again on a resize (a window, a rotated phone).
        const restack = () => {
            strip.classList.toggle('hide', form.classList.contains('hide'));
            below.classList.toggle('hide', form.classList.contains('hide'));
            const now = stacks(strip);
            strip.classList.toggle('stacked', now);
            setStacked(now);
        };
        restack();
        // eslint-disable-next-line compat/compat -- Chromium 79 supports ResizeObserver; older engines keep the resize fallback.
        const size = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(restack);
        size?.observe(strip);
        window.addEventListener('resize', restack);
        const layout = new MutationObserver(restack);
        layout.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        layout.observe(form, { attributes: true, attributeFilter: ['class'] });
        setHosts(next);
        return () => {
            window.removeEventListener('resize', restack);
            layout.disconnect();
            size?.disconnect();
            strip.remove();
            below.remove();
            form.classList.remove('jfmod-stripMounted');
            if (!view.querySelector('[data-ds-slot="tracks"] .gpk')) view.removeAttribute('data-ds-tracks-mounted');
            setHosts(null);
        };
    }, [view, enabled]);
    // Null in the very render that disables it (the page lists no file any more), not one effect later: the segments must never
    // draw without a file (Codex review of the upgrade status, P2 2).
    const result = useMemo(() => (hosts ? { ...hosts, stacked } : null), [hosts, stacked]);
    return enabled ? result : null;
};

/**
 * The native Video picker uses the same select mutation and device preference as the former chooser. Its rows only choose a
 * file (ds.t12, the user 2026-11-07): History, Keep and Remove act on the selected file from the title's More menu.
 */
const FileChooser: FC<FileChooserProps> = ({ view, versions, preferred, removeDate, sources, strip, pending }) => {
    const current = useSelectedSource(view);
    const chosen = useRef(false);
    useViewerChoice(view, chosen);
    useDevicePreference(view, versions.length > 1 ? preferred : null, chosen);
    const [open, setOpen] = useState(false);
    // A computer shows one file plainly, with nothing to open (ds.t19); phone, tablet and TV keep its list (pending entry).
    const plain = useContext(DesignContext) === 'computer' && versions.length < 2;
    const selected = selectedVersion(versions, current);
    // The size moved to the caption (`VIDEO · 13.2 GB`, the user 2026-11-07); each row keeps its own.
    const summary = (version: VersionDto, closed = false) => <>
        <span className='r'>{describeVersion(version).resolution}{version.phoneCopy && <span className='pm' title={PHONE_COPY_LABEL}><Icon name='phone' /></span>}</span>
        <span className='marks'><DesignMediaMarks parsed={fileMarks(version, findSource(sources, version.mediaSourceId)).video} /></span>
        {!closed && <span className='sz2'>{describeVersion(version).size}</span>}
    </>;
    const choose = (version: VersionDto) => {
        chosen.current = true;
        selectVersion(view, version);
    };

    const opening = useCallback(() => setOpen(true), []);
    const closing = useCallback(() => setOpen(false), []);
    return <>
        {createPortal(<TrackField kind='v' name='Video' extra={describeVersion(selected).size ?? undefined} value={summary(selected, true)} enabled={!plain} stacked={strip.stacked} onOpen={opening} onClose={closing}>
            {bestFirst(versions).map(version => <ChooseRow key={version.mediaSourceId} sourceId={version.mediaSourceId} selected={version === selected}
                onChoose={() => choose(version)} title={[version.episodeRange, removeDate(version)].filter(Boolean).join(' · ')}>
                {summary(version)}
                {(version.episodeRange || removeDate(version)) && <span className='trackextra'>{[version.episodeRange, removeDate(version) && 'removes ' + removeDate(version)].filter(Boolean).join(' · ')}</span>}
            </ChooseRow>)}
            {pending}
        </TrackField>, strip.video)}
        {!open && createPortal(pending, strip.below)}
    </>;
};

export default FileChooser;
