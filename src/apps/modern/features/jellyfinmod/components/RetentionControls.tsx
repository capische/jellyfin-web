import type { Api } from '@jellyfin/sdk/lib/api';
import React, { type FC, type MouseEvent, useCallback } from 'react';

import { setEpisodeRetention, setVersionKept, unkeepEpisode } from '../api/modApi';
import { EPISODE_CONTROLS_CAPABILITY, VERSION_KEEP_CAPABILITY } from '../constants/fileState';
import { describeVersion } from '../constants/versions';
import type { EntryEpisode } from '../types/entry';
import type { VersionDto } from '../types/versions';
import EmbySelect from './EmbySelect';

/** The episode window choices an administrator can pick (PHASE10 Q4); `inherit` follows the series. */
const EPISODE_WINDOWS = [1, 3, 7, 14, 30, 60, 90, 180, 365];
const days = (count: number) => `${count} day${count === 1 ? '' : 's'}`;
const WINDOW_OPTIONS = [{ value: 'inherit', label: 'Series default' },
    ...EPISODE_WINDOWS.map(count => ({ value: String(count), label: `${days(count)} after watching` }))];

/** A version's name for its Keep button: its label or resolution, numbered where two versions would read alike. */
const versionName = (versions: VersionDto[], version: VersionDto, index: number) => {
    const name = (candidate: VersionDto) => describeVersion(candidate).label ?? describeVersion(candidate).resolution ?? 'version';
    const own = name(version);
    return versions.filter(candidate => name(candidate) === own).length > 1 ? `${own} (${index + 1})` : own;
};

interface RetentionControlsProps {
    api: Api;
    entryId: string;
    busy: boolean;
    /** Runs one administrator change, refreshes the page and announces `done`. */
    change: (action: () => Promise<unknown>, done: string) => Promise<void>;
    /** The tracked episode of an episode page with its own Keep; undefined on a series or movie page. */
    episode?: EntryEpisode;
    versions: VersionDto[];
    capabilities: string[];
}

/**
 * Administrator retention controls beside Keep (PHASE10 Q3-Q4): stop keeping an episode kept by itself, the episode's
 * own window, and Keep for one file where the title has several. Plain buttons and upstream's select, so a remote
 * reaches every one with the arrow keys and Enter; nothing opens a dialog of its own.
 */
const RetentionControls: FC<RetentionControlsProps> = ({ api, entryId, busy, change, episode, versions, capabilities }) => {
    const canEditEpisode = !!episode && capabilities.includes(EPISODE_CONTROLS_CAPABILITY);
    const keptItself = episode?.retentionPolicy === 'never';
    const keepable = capabilities.includes(VERSION_KEEP_CAPABILITY) && versions.length > 1 ? versions : [];
    const windowValue = episode?.retentionPolicy === 'days' && episode.reclaimAfterDays ? String(episode.reclaimAfterDays) : 'inherit';

    const unkeep = useCallback(() => {
        if (!episode) return;
        change(() => unkeepEpisode(api, entryId, episode.id), 'This episode is no longer kept.').catch(() => undefined);
    }, [api, change, entryId, episode]);
    const changeWindow = useCallback((value: string) => {
        if (!episode) return;
        const count = value === 'inherit' ? null : Number(value);
        const done = count ? `This episode is removed ${days(count)} after watching.` : 'This episode follows its series.';
        change(() => setEpisodeRetention(api, entryId, episode.id, count ? 'days' : 'inherit', count), done).catch(() => undefined);
    }, [api, change, entryId, episode]);
    const toggleVersion = useCallback((event: MouseEvent<HTMLButtonElement>) => {
        const bindingId = event.currentTarget.dataset.jfmodBindingId;
        const kept = event.currentTarget.getAttribute('aria-pressed') === 'true';
        if (!bindingId) return;
        change(() => setVersionKept(api, entryId, bindingId, !kept), kept ? 'This file is no longer kept.' : 'This file will be kept.')
            .catch(() => undefined);
    }, [api, change, entryId]);

    return <>
        {canEditEpisode && keptItself && <button className='emby-button raised' type='button' aria-disabled={busy}
            onClick={unkeep}>Stop keeping</button>}
        {keepable.map((version, index) => <button key={'keep:' + version.bindingId} className='emby-button raised' type='button'
            aria-disabled={busy} aria-pressed={!!version.kept} data-jfmod-binding-id={version.bindingId} onClick={toggleVersion}>
            {version.kept ? 'Stop keeping ' : 'Keep '}{versionName(keepable, version, index)}
        </button>)}
        {canEditEpisode && !keptItself && <EmbySelect id={'jfmod-episode-window-' + episode.id} label='Remove this episode'
            value={windowValue} options={WINDOW_OPTIONS} onChange={changeWindow} />}
    </>;
};

export default RetentionControls;
