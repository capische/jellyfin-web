import classNames from 'classnames';
import React, { type FC, type MouseEvent, useCallback, useEffect, useRef, useState } from 'react';

import { type DevicePreference, describeVersion, preferredVersion, sameItemId } from '../constants/versions';
import type { VersionDto } from '../types/versions';

import './versions.scss';

const SOURCE_SELECTOR = '.selectSource';

interface VersionRowsProps {
    /** The native detail view that owns the stock `.selectSource` select. */
    view: HTMLElement;
    versions: VersionDto[];
    /** Administrators with release search and `versions`: the last row is Get another quality. */
    onAddVersion?: (opener: HTMLElement) => void;
    /** Which copy this device starts with (V1 decision 4); desktop leaves Jellyfin's default. */
    device?: DevicePreference;
    /** A line under the rows, such as what stock Delete removes (V1); shown to administrators only. */
    note?: string | null;
    admin?: boolean;
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

/** Sets the stock select to a version and lets upstream react through its own `change` event. */
const selectVersion = (view: HTMLElement, version: VersionDto) => {
    const select = findSelect(view);
    const option = select && Array.from(select.options).find(candidate => sameItemId(candidate.value, version.mediaSourceId));
    if (!select || !option || select.value === option.value) return;
    select.value = option.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
};

/**
 * Starts this device on the copy that suits it (V1 decision 4): once the stock select lists the versions, and again when
 * upstream rewrites its options, until the viewer chooses a copy themselves on the select or a row.
 */
const useDevicePreference = (view: HTMLElement, versions: VersionDto[], device: DevicePreference, chosen: { current: boolean }) => {
    useEffect(() => {
        const preferred = preferredVersion(versions, device);
        const select = findSelect(view);
        if (!preferred || !select) return;
        const apply = () => {
            if (!chosen.current) selectVersion(view, preferred);
        };
        const userChange = (event: Event) => {
            if (event.isTrusted) chosen.current = true;
        };
        apply();
        select.addEventListener('change', userChange);
        const observer = new MutationObserver(apply);
        observer.observe(select, { childList: true });
        return () => {
            select.removeEventListener('change', userChange);
            observer.disconnect();
        };
    }, [view, versions, device, chosen]);
};

const VersionRow: FC<{ version: VersionDto; selected: boolean; onChoose: (version: VersionDto) => void }> =
    ({ version, selected, onChoose }) => {
        const choose = useCallback(() => onChoose(version), [onChoose, version]);
        const text = describeVersion(version);
        const details = [text.video, text.audio, text.size].filter(Boolean).join(' · ');
        return <button type='button' className={classNames('jfmod-versionRow', { 'jfmod-versionRow--selected': selected })}
            aria-pressed={selected} data-jfmod-media-source-id={version.mediaSourceId} onClick={choose}>
            <span className='jfmod-versionMark' aria-hidden='true'>{selected ? '●' : '○'}</span>
            <span className='jfmod-versionBody'>
                <span className='jfmod-versionResolution'>{text.resolution}</span>
                {details && <span className='jfmod-versionDetails'>{details}</span>}
                {text.label && <span className='jfmod-versionLabel'>{text.label}</span>}
                {version.episodeRange && <span className='jfmod-versionLabel'>{version.episodeRange}</span>}
                {version.tracked === false && <span className='jfmod-versionRetention'>not tracked yet</span>}
                {text.retention && <span className='jfmod-versionRetention'>{text.retention}</span>}
            </span>
            {version.isDefault && <span className='jfmod-versionDefault'>Default</span>}
        </button>;
    };

/**
 * One row per version beside the stock version select (UX §11, P6.M8). The select stays exactly as upstream renders
 * it: a row only sets its value and dispatches its own bubbling `change`, so upstream's audio, subtitle, info and
 * playback logic runs as if the viewer had used the select. Every row is a D-pad stop; nothing here injects a
 * select where upstream has none.
 */
const VersionRows: FC<VersionRowsProps> = ({ view, versions, onAddVersion, device = 'desktop', note, admin = false }) => {
    const current = useSelectedSource(view);
    const chosen = useRef(false);
    useDevicePreference(view, versions, device, chosen);
    const choose = useCallback((version: VersionDto) => {
        chosen.current = true;
        selectVersion(view, version);
    }, [view]);
    const addVersion = useCallback((event: MouseEvent<HTMLButtonElement>) => onAddVersion?.(event.currentTarget), [onAddVersion]);

    // With no option to match (one version, or a page that cannot choose sources) the default is the one that plays.
    const selectedId = versions.find(version => sameItemId(version.mediaSourceId, current))?.mediaSourceId
        ?? versions.find(version => version.isDefault)?.mediaSourceId
        ?? versions[0]?.mediaSourceId;

    return <section className='jfmod-versions' aria-label='Versions'>
        <h2 className='jfmod-versionsHeading'>{versions.length === 1 ? 'Version' : 'Versions'}</h2>
        {versions.map(version => <VersionRow key={version.bindingId || version.mediaSourceId} version={version}
            selected={version.mediaSourceId === selectedId} onChoose={choose} />)}
        {onAddVersion && <button type='button' className='jfmod-versionRow jfmod-versionRow--add' onClick={addVersion}>
            <span className='jfmod-versionMark' aria-hidden='true'>+</span>
            <span className='jfmod-versionBody'>Get another quality</span>
        </button>}
        {admin && note && <p className='jfmod-versionsNote'>{note}</p>}
    </section>;
};

export default VersionRows;
