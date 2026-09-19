import classNames from 'classnames';
import React, { type FC, type MouseEvent, useCallback, useEffect, useState } from 'react';

import { describeVersion, sameItemId } from '../constants/versions';
import type { VersionDto } from '../types/versions';

import './versions.scss';

const SOURCE_SELECTOR = '.selectSource';

interface VersionRowsProps {
    /** The native detail view that owns the stock `.selectSource` select. */
    view: HTMLElement;
    versions: VersionDto[];
    /** Administrators with release search and `versions`: the last row is Get another quality. */
    onAddVersion?: (opener: HTMLElement) => void;
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
const VersionRows: FC<VersionRowsProps> = ({ view, versions, onAddVersion }) => {
    const current = useSelectedSource(view);
    const choose = useCallback((version: VersionDto) => {
        const select = findSelect(view);
        const option = select && Array.from(select.options).find(candidate => sameItemId(candidate.value, version.mediaSourceId));
        if (!select || !option || select.value === option.value) return;
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
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
    </section>;
};

export default VersionRows;
