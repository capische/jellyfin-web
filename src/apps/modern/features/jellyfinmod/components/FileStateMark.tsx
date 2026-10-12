import DownloadOutlined from '@mui/icons-material/DownloadOutlined';
import ScheduleOutlined from '@mui/icons-material/ScheduleOutlined';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
import SyncProblemOutlined from '@mui/icons-material/SyncProblemOutlined';
import CircularProgress from '@mui/material/CircularProgress';
import classNames from 'classnames';
import React, { type FC, type ReactNode, useCallback, useEffect, useRef } from 'react';

import { useApi } from 'hooks/useApi';

import { airDateLong, airDateShort, daysUntilReclaim, FILE_STATE_LABEL, type MarkState, retentionDeadline } from '../constants/fileState';
import { progressPercent } from '../constants/queue';
import { RELEASES_CAPABILITY, usePluginCapabilities } from '../hooks/useAcquisition';
import { useQueueRowFor } from '../hooks/useQueue';
import { openReleasePickerForEntry } from '../integration/releasePicker';
import { restoreFocusTo } from '../integration/stockHeaderButton';
import { type Entry, FileState, type RetentionSummary } from '../types/entry';

import './fileStateMark.scss';

/** What the Not Downloaded mark opens for an administrator: its tooltip (Title Case) and the picker in that scope. */
export interface MarkDownload {
    label: string;
    open: (button: HTMLElement) => void;
}

interface FileStateMarkProps {
    /** A title's card, list row or poster: the mark follows its file state. */
    entry?: Entry;
    retention?: RetentionSummary | null;
    /** Show the retention countdown regardless of how far off it is (used by the filtered view). */
    alwaysShowCountdown?: boolean;
    /** A season or an episode without a Jellyfin item (P1.FU11): the mark is given, not read from an entry. */
    state?: MarkState | null;
    airDate?: string | null;
    /** The Not Downloaded mark as an administrator's button; absent, it is a plain indicator. */
    download?: MarkDownload | null;
    /** An entry's own mark offers its picker to administrators; false keeps it an indicator (the detail page's poster). */
    interactive?: boolean;
    /** `row`: the action slot at a list row's end; otherwise a card's top-right corner. */
    variant?: 'card' | 'row';
}

/** Queue states in which the transfer is (or was last seen) under way, so a ring is truthful. */
const TRANSFERRING = new Set(['downloading', 'stalled', 'unknown']);

/**
 * The ring's value: the live queue row when the plugin serves one (read once per 3 s poll for every mark on screen),
 * otherwise the projected `progress` from the browse or entry read. Null means never observed: the ring is drawn
 * without a percentage rather than claiming 0 % (UX §14).
 */
const useDownloadProgress = (entry: Entry | undefined) => {
    const inFlight = entry?.state === FileState.Grabbed || entry?.state === FileState.Downloading;
    const row = useQueueRowFor(entry?.id, null, inFlight);
    const live = row ? progressPercent(row.progress) : null;
    const projected = typeof entry?.progress === 'number' ? Math.floor(entry.progress) : null;
    const percent = live ?? projected;
    const downloading = entry?.state === FileState.Downloading
        || (entry?.state === FileState.Grabbed && live !== null && !!row && TRANSFERRING.has(row.state));
    return { downloading, percent };
};

/** An entry with no file to play: nothing on disk and nothing in flight, or reclaimed. */
const entryMark = (entry: Entry): MarkState | null =>
    (entry.state === FileState.None || entry.state === FileState.Reclaimed ? 'missing' : null);

/**
 * An administrator's Not Downloaded on an entry's card opens the picker as the title's own page does: a movie's, or a
 * series' seasons. Only where the plugin serves release search; never for a card still being added.
 */
const useEntryDownload = (entry: Entry | undefined, wanted: boolean): MarkDownload | null => {
    const { api, user } = useApi();
    const isAdmin = !!user?.Policy?.IsAdministrator;
    const canAcquire = usePluginCapabilities(api, wanted && isAdmin).includes(RELEASES_CAPABILITY);
    const entryId = entry?.id;
    const open = useCallback((button: HTMLElement) => {
        if (!api || !entryId) return;
        openReleasePickerForEntry(api, entryId).then(() => restoreFocusTo(button), () => restoreFocusTo(button));
    }, [api, entryId]);
    if (!entry || !wanted || !canAcquire || entry.id.startsWith('pending:')) return null;
    return { label: entry.mediaType === 'movie' ? 'Download This Movie' : 'Download This Series', open };
};

/**
 * The administrator's round button. Its click is taken natively on the button and goes no further, so neither the card's
 * link, the card's own click, nor upstream's item container (which acts on the card around it) sees it.
 */
const MarkButton: FC<{ className: string; download: MarkDownload; children: ReactNode }> = ({ className, download, children }) => {
    const ref = useRef<HTMLButtonElement>(null);
    const openRef = useRef(download.open);
    openRef.current = download.open;
    useEffect(() => {
        const button = ref.current;
        if (!button) return;
        const onClick = (event: Event) => {
            event.preventDefault();
            event.stopPropagation();
            openRef.current(button);
        };
        button.addEventListener('click', onClick);
        return () => button.removeEventListener('click', onClick);
    }, []);
    return <button ref={ref} type='button' className={className + ' jfmod-markButton'} title={download.label}
        aria-label={download.label}>{children}</button>;
};

/** The countdown, or the in-flight ring or icon, when one of them takes the slot; null otherwise. */
const busyMark = (entry: Entry | undefined, progress: ReturnType<typeof useDownloadProgress>, countdown: number | null,
    base: string) => {
    if (countdown !== null) {
        return (
            <div
                className={classNames(base, 'jfmod-mark--countdown', { 'jfmod-countdown--urgent': countdown <= 2 })}
                title={`File will be removed in ${countdown} day${countdown === 1 ? '' : 's'}`}
            >
                <span className='jfmod-countdown'>{countdown}d</span>
            </div>
        );
    }
    if (progress.downloading) {
        return (
            <div className={base + ' jfmod-mark--inFlight'} title={FILE_STATE_LABEL[FileState.Downloading]}>
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
    // Searching and grabbed keep their own icons until the downloading states are redrawn (the next slice).
    if (entry && (entry.state === FileState.Searching || entry.state === FileState.Grabbed)) {
        const Icon = entry.state === FileState.Searching ? SearchOutlined : DownloadOutlined;
        return <div className={base + ' jfmod-mark--inFlight'} title={FILE_STATE_LABEL[entry.state]}><Icon fontSize='inherit' /></div>;
    }
    return null;
};

/**
 * The one set of marks on cards and rows (UX §3.1, P1.FU11): nothing for on disk; the amber Not Downloaded icon, a button
 * for administrators that opens the release picker in its scope and a plain indicator for everyone else; the clock with the
 * short air date for something not aired yet. In flight, the ring with its percentage; a close retention deadline takes the
 * slot as a countdown. Cards put it top right, rows at their end.
 */
const FileStateMark: FC<FileStateMarkProps> = ({ entry, retention, alwaysShowCountdown = false, state, airDate, download,
    interactive = true, variant = 'card' }) => {
    const progress = useDownloadProgress(entry);
    const mark = entry ? entryMark(entry) : state ?? null;
    const entryDownload = useEntryDownload(entry, interactive && mark === 'missing');
    const days = entry ? daysUntilReclaim(retentionDeadline(retention)) : null;
    const base = classNames('jfmod-mark', { 'jfmod-mark--row': variant === 'row' });
    const busy = busyMark(entry, progress, days !== null && (alwaysShowCountdown || days <= 3) ? days : null, base);
    if (busy) return busy;

    if (mark === 'unaired' && airDate) {
        return (
            <div className={base + ' jfmod-mark--unaired'} title={'Airs ' + airDateLong(airDate)}>
                <ScheduleOutlined fontSize='inherit' />
                <span className='jfmod-markDate'>{airDateShort(airDate)}</span>
            </div>
        );
    }
    if (!mark) return null;

    const action = entry ? entryDownload : download;
    if (action) {
        return <MarkButton className={base + ' jfmod-mark--none'} download={action}><SyncProblemOutlined fontSize='inherit' /></MarkButton>;
    }
    return (
        <div className={base + ' jfmod-mark--none'} title='Not Downloaded'>
            <SyncProblemOutlined fontSize='inherit' />
        </div>
    );
};

export default FileStateMark;
