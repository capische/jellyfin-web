import React, { type FC, type MouseEvent, useCallback, useEffect, useRef, useState } from 'react';

import toast from 'components/toast/toast';
import { useApi } from 'hooks/useApi';
import { queryClient } from 'utils/query/queryClient';

import { removeQueueRow } from '../api/modApi';
import { actionErrorMessage, asNewVersion, downloadProgress, isNewVersion, isReplace, replacedWords, versionFlag } from '../constants/queue';
import { describeVersion } from '../constants/versions';
import { packEpisodeView, useQueueRowFor } from '../hooks/useQueue';
import { cancelDownload, confirmQueueRemoval, confirmTorrentRemoval, isHeldRow, keepsDownloadedFiles } from '../integration/queueActions';
import type { QueueRow, QueueState } from '../types/queue';
import type { VersionDto } from '../types/versions';
import DownloadStateMark, { ringLink } from './DownloadStateMark';
import { formatSize, MediaMarks, qualityText } from './ReleaseRowParts';

import './downloadProgress.scss';
import './pendingVersion.scss';

/** A row the entry shows: on its way, importing, or failed (until it is removed from the queue). Seeding is done. */
const SHOWN = new Set<QueueState>(['queued', 'downloading', 'stalled', 'identifying', 'linking', 'scanning', 'unknown', 'failed', 'blocked']);
const IMPORTING = new Set<QueueState>(['identifying', 'linking', 'scanning']);

interface PendingVersionProps {
    entryId: string;
    /** The page's episode; omitted for a movie. */
    episodeId?: string | null;
    /** The page's files, which name what a Replace removes by their own labels (`1080p`). */
    versions: VersionDto[];
    isAdmin: boolean;
    /** The download left the queue's way, whatever its last state (imported, removed, or no longer readable). */
    onFinished: () => void;
}

/** The release in a few words: `2160p Remux` from the grab's parsed name, else the queue's label. */
const qualityOf = (row: QueueRow) => (row.parsed && (row.parsed.resolution || row.parsed.source) ? qualityText(row.parsed) :
    row.versionLabel ?? row.releaseTitle);

/** What a failure leaves: a Replace's `1080p stays`; an Add's failure keeps everything and needs no flag. */
const failedFlag = (row: QueueRow, labelOf: (bindingId: string) => string | null) => {
    if (!isReplace(row)) return null;
    const replaced = replacedWords(row, labelOf);
    return replaced.words + (replaced.many ? ' stay' : ' stays');
};

/**
 * Another version on its way for a title that already plays (option 3 of `reviews/upgrade-status-options`, user-approved
 * 2026-10-28, D9–D11): the picker's added row moved to where the file will land, under the track strip (inside the Video list
 * while it is open). The row ring with the + (D12), the quality in 600 with its media marks and the size at the right end, and
 * under them the state in treatment B with a muted flag saying what happens to what the title holds: `· replaces 1080p`,
 * `· another version`; a failure is red with `· 1080p stays`. For administrators the red round X (D10): the existing
 * "Remove the Torrent" question (none for a grab still held, none while importing), Remove from Queue for a failure.
 */
const PendingVersion: FC<PendingVersionProps> = ({ entryId, episodeId, versions, isAdmin, onFinished }) => {
    const { api } = useApi();
    const [live, setLive] = useState(false);
    const row = useQueueRowFor(entryId, episodeId ?? null, true, live ? true : 'slow');
    const view = row?.pack ? packEpisodeView(row, episodeId) : row;
    const shown = !!view && isNewVersion(view) && SHOWN.has(view.state);
    const [removing, setRemoving] = useState(false);
    useEffect(() => setLive(shown), [shown]);
    const finished = useRef(onFinished);
    finished.current = onFinished;
    const was = useRef(false);
    useEffect(() => {
        if (shown) {
            was.current = true;
        } else if (was.current) {
            was.current = false;
            finished.current();
        }
    }, [shown]);

    const remove = useCallback((event: MouseEvent<HTMLButtonElement>) => {
        const button = event.currentTarget;
        if (!api || !row || removing) return;
        const removed = () => {
            toast('Removed from the queue.');
            void queryClient.invalidateQueries({ predicate: query => query.queryKey[0] === 'JellyfinMod' && query.queryKey[3] === 'Queue' });
        };
        const failed = (error: unknown) => toast(actionErrorMessage(error, 'It could not be removed. Please try again.'));
        const restore = () => {
            if (button.isConnected) button.focus();
        };
        if (row.state === 'failed' || row.state === 'blocked') {
            // A failure leaves the queue through Remove from Queue and its options, as on the Queue page.
            void confirmQueueRemoval(row).then(request => {
                if (!request) return;
                setRemoving(true);
                return removeQueueRow(api, row.id, request).then(removed, failed).finally(() => setRemoving(false));
            }).finally(restore);
            return;
        }
        // A held grab has no torrent yet: it is cancelled without the torrent's question (P4.FU10).
        (isHeldRow(row) ? Promise.resolve() : confirmTorrentRemoval(row.releaseTitle, keepsDownloadedFiles(row))).then(() => {
            setRemoving(true);
            return cancelDownload(api, row).then(removed, failed).finally(() => setRemoving(false));
        }, () => undefined).finally(restore);
    }, [api, removing, row]);

    if (!shown || !view || !row) return null;
    const progress = asNewVersion(downloadProgress(view), [view]);
    const labelOf = (bindingId: string) => {
        const version = versions.find(candidate => candidate.bindingId === bindingId);
        return version ? describeVersion(version).resolution : null;
    };
    const failure = progress.kind === 'failed';
    // A failure says what stays (`1080p stays`); an Add's failure keeps everything and needs no flag.
    const flag = failure ? failedFlag(view, labelOf) : versionFlag(view, labelOf);
    const quality = qualityOf(row);
    // No X while it imports (D10), nor while the grab is being sent (it can be neither cancelled nor removed then).
    const cancellable = isAdmin && !IMPORTING.has(view.state) && row.importState !== 'submitting';
    const actionName = failure ? 'Remove from Queue' : 'Cancel Download';
    return <div className={'jfmod-pending jfmod-pending--' + progress.kind} data-jfmod-pending={row.id}>
        <DownloadStateMark progress={progress} size='row' link={ringLink([view], progress)} />
        <div className='jfmod-pendingBody'>
            <div className='jfmod-pendingLine'>
                <span className='jfmod-fileResolution'>{quality}</span>
                {row.parsed && <span className='jfmod-fileMarks'><MediaMarks parsed={row.parsed} /></span>}
                {row.sizeBytes !== null && <span className='jfmod-fileSize'>{formatSize(row.sizeBytes)}</span>}
            </div>
            <div className='jfmod-pendingMeta'>
                <span className={'jfmod-dlMeta jfmod-dlMeta--' + progress.kind + (progress.stale ? ' jfmod-dlMeta--stale' : '')}
                    title={progress.tooltip}>{flag ? progress.text.replace(/\.$/, '') : progress.text}</span>
                {flag && <span className='jfmod-fileExtra jfmod-fileExtra--dot'>{flag}</span>}
            </div>
        </div>
        {cancellable && <span className='jfmod-fileIcons'>
            <button type='button' className='paper-icon-button-light jfmod-fileIcon jfmod-fileIcon--danger' title={actionName}
                aria-label={actionName + ': ' + quality} aria-disabled={removing} data-jfmod-pending-remove={row.id} onClick={remove}>
                <span className='material-icons close' aria-hidden='true' />
            </button>
        </span>}
    </div>;
};

export default PendingVersion;
