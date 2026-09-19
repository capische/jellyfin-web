import ArchiveOutlined from '@mui/icons-material/ArchiveOutlined';
import DownloadOutlined from '@mui/icons-material/DownloadOutlined';
import SdStorageOutlined from '@mui/icons-material/SdStorageOutlined';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
import SyncProblemOutlined from '@mui/icons-material/SyncProblemOutlined';
import CircularProgress from '@mui/material/CircularProgress';
import classNames from 'classnames';
import React, { type FC } from 'react';

import { daysUntilReclaim, FILE_STATE_LABEL, retentionDeadline } from '../constants/fileState';
import { progressPercent } from '../constants/queue';
import { useQueueRowFor } from '../hooks/useQueue';
import { type Entry, FileState, type RetentionSummary } from '../types/entry';

import './fileStateMark.scss';

interface FileStateMarkProps {
    entry: Entry;
    retention?: RetentionSummary | null;
    /** Show the retention countdown regardless of how far off it is (used by the filtered view). */
    alwaysShowCountdown?: boolean;
}

const ICONS: Record<FileState, typeof SdStorageOutlined> = {
    [FileState.OnDisk]: SdStorageOutlined,
    [FileState.None]: SyncProblemOutlined,
    [FileState.Searching]: SearchOutlined,
    [FileState.Grabbed]: DownloadOutlined,
    [FileState.Downloading]: SdStorageOutlined, // unused: a ring is drawn instead
    [FileState.Reclaimed]: ArchiveOutlined
};

const variantFor = (state: FileState) => {
    if (state === FileState.OnDisk) return 'onDisk';
    if (state === FileState.None) return 'none';
    if (state === FileState.Reclaimed) return 'reclaimed';
    return 'inFlight';
};

/**
 * One icon over the cover — the whole of JellyfinMod's presence on a card.
 *
 * Rendered top-left as a sibling of the stock indicators rather than as an edit to
 * `CardImageContainer`; see docs/jellyfinmod/UX.md §3.
 *
 * When retention is close, the countdown takes this slot instead of the state icon. One mark per
 * cover: two would start a badge collection.
 */
/** Queue states in which the transfer is (or was last seen) under way, so a ring is truthful. */
const TRANSFERRING = new Set(['downloading', 'stalled', 'unknown']);

/**
 * The ring's value: the live queue row when the plugin serves one (read once per 3 s poll for every mark on screen),
 * otherwise the projected `progress` from the browse or entry read. Null means never observed: the ring is drawn
 * without a percentage rather than claiming 0 % (UX §14).
 */
const useDownloadProgress = (entry: Entry) => {
    const inFlight = entry.state === FileState.Grabbed || entry.state === FileState.Downloading;
    const row = useQueueRowFor(entry.id, null, inFlight);
    const live = row ? progressPercent(row.progress) : null;
    const projected = typeof entry.progress === 'number' ? Math.floor(entry.progress) : null;
    const percent = live ?? projected;
    const downloading = entry.state === FileState.Downloading
        || (entry.state === FileState.Grabbed && live !== null && !!row && TRANSFERRING.has(row.state));
    return { downloading, percent };
};

const FileStateMark: FC<FileStateMarkProps> = ({ entry, retention, alwaysShowCountdown = false }) => {
    const progress = useDownloadProgress(entry);
    const days = daysUntilReclaim(retentionDeadline(retention));
    const showCountdown = days !== null && (alwaysShowCountdown || days <= 3);

    if (showCountdown) {
        return (
            <div
                className={classNames('jfmod-mark', {
                    'jfmod-countdown--urgent': days <= 2
                })}
                title={`File will be removed in ${days} day${days === 1 ? '' : 's'}`}
            >
                <span className='jfmod-countdown'>{days}d</span>
            </div>
        );
    }

    if (progress.downloading) {
        return (
            <div className='jfmod-mark jfmod-mark--inFlight' title={FILE_STATE_LABEL[FileState.Downloading]}>
                <CircularProgress
                    variant='determinate'
                    value={progress.percent ?? 0}
                    size='1.1em'
                    thickness={7}
                    color='inherit'
                />
                {progress.percent !== null && <span>{progress.percent}%</span>}
            </div>
        );
    }

    const Icon = ICONS[entry.state];

    return (
        <div
            className={`jfmod-mark jfmod-mark--${variantFor(entry.state)}`}
            title={FILE_STATE_LABEL[entry.state]}
        >
            <Icon fontSize='inherit' />
        </div>
    );
};

export default FileStateMark;
