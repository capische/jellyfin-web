import React, { type FC, useEffect, useState } from 'react';

import { describeDownload, downloadProgress, type DownloadProgress, packProblem, QUEUE_ROUTE, QUEUE_STATE_LABEL, reasonMessage } from '../constants/queue';
import { packEpisodeView, packHolds, useQueueRowFor, useQueueVisible } from '../hooks/useQueue';
import { FileState } from '../types/entry';
import type { QueueRow } from '../types/queue';
import DownloadStateMark, { ringLink } from './DownloadStateMark';

import './queue.scss';

interface QueueStatusLineProps {
    entryId: string;
    /** For an episode target; omitted for a movie. */
    episodeId?: string | null;
    /** Projected `grabbed`/`downloading` state of the movie or episode. */
    state: FileState;
    /** Projected 0-100 progress. */
    progress?: number | null;
}

/**
 * The live row as a download: its disc and `In the download queue · 42% · 12 min left` (P4.FU6). An episode of a pack shows its
 * own file, and its own import's problem while the pack's torrent reads otherwise; a finished import is only named.
 */
const lineOf = (packRow: QueueRow, episodeId: string | null | undefined): { progress: DownloadProgress | null; text: string } => {
    const row = episodeId ? packEpisodeView(packRow, episodeId) : packRow;
    if (row.state === 'seeding') return { progress: null, text: QUEUE_STATE_LABEL.seeding };
    let progress = downloadProgress(row);
    // A pack's row is the whole torrent; this episode's own import may still need attention (season packs, 2026-10-08).
    const own = row.pack?.episodes.find(item => item.episodeId === episodeId);
    if (progress.kind !== 'failed' && own && packProblem(own.importState, own.reason)) {
        progress = describeDownload('failed', progress.percent, progress.stale, { reason: reasonMessage(own.reason) ?? undefined });
    }
    // Unknown keeps the last value; it is labelled as such rather than shown as live (UX §14).
    return { progress, text: 'In the download queue · ' + progress.text + (progress.stale ? ' (last known)' : '') };
};

/**
 * One line on a detail page for a `grabbed` or `downloading` movie or episode, or an episode a pack is adding a file to: the
 * download disc and the live queue state when the queue can be read, the projected values otherwise, and **View queue** where
 * the caller may open it (P5.I8). Renders nothing for any other state or on a plugin without the queue.
 */
const QueueStatusLine: FC<QueueStatusLineProps> = ({ entryId, episodeId, state, progress }) => {
    const inFlight = state === FileState.Grabbed || state === FileState.Downloading;
    // An episode that holds a file stays `onDisk` while a pack adds or replaces its file; the queue says whether one does
    // (season packs, 2026-10-08). The page watches the queue once a minute for one, and every 3 s while one holds it.
    const [packPoll, setPackPoll] = useState(false);
    const row = useQueueRowFor(entryId, episodeId ?? null, inFlight || !!episodeId, inFlight || packPoll || 'slow');
    const packClaim = !inFlight && !!row && packHolds(row, episodeId);
    useEffect(() => setPackPoll(packClaim), [packClaim]);
    const visible = useQueueVisible(inFlight || packClaim);
    if (!inFlight && !packClaim) return null;
    let line: { progress: DownloadProgress | null; text: string };
    if (row) {
        line = lineOf(row, episodeId);
    } else if (state === FileState.Downloading) {
        const shown = typeof progress === 'number' ? describeDownload('downloading', Math.floor(progress), false) :
            describeDownload('queued', null, false);
        line = { progress: shown, text: 'In the download queue · ' + shown.text };
    } else {
        line = { progress: describeDownload('queued', null, false), text: 'Grabbed · waiting for the download client' };
    }
    return <p className='jfmod-queueStatusLine'>
        {line.progress && <DownloadStateMark progress={line.progress} size='row' link={ringLink([row], line.progress)} />}
        <span>
            {line.text}
            {visible && <>{' · '}<a href={'#' + QUEUE_ROUTE}>View queue</a></>}
        </span>
    </p>;
};

export default QueueStatusLine;
