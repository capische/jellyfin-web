import ArchiveOutlined from '@mui/icons-material/ArchiveOutlined';
import DownloadOutlined from '@mui/icons-material/DownloadOutlined';
import SdStorageOutlined from '@mui/icons-material/SdStorageOutlined';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
import SyncProblemOutlined from '@mui/icons-material/SyncProblemOutlined';
import CircularProgress from '@mui/material/CircularProgress';
import classNames from 'classnames';
import React, { type FC } from 'react';

import { daysUntilReclaim, FILE_STATE_LABEL } from '../constants/fileState';
import { type Entry, FileState } from '../types/entry';

import './fileStateMark.scss';

interface FileStateMarkProps {
    entry: Entry;
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
const FileStateMark: FC<FileStateMarkProps> = ({ entry, alwaysShowCountdown = false }) => {
    const days = daysUntilReclaim(entry.reclaimAt);
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

    if (entry.state === FileState.Downloading) {
        return (
            <div className='jfmod-mark jfmod-mark--inFlight' title={FILE_STATE_LABEL[entry.state]}>
                <CircularProgress
                    variant='determinate'
                    value={entry.progress ?? 0}
                    size='1.1em'
                    thickness={7}
                    color='inherit'
                />
                <span>{entry.progress ?? 0}%</span>
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
