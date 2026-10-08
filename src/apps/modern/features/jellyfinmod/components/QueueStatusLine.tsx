import React, { type FC, useEffect, useState } from 'react';

import { packProblem, progressPercent, QUEUE_ROUTE, QUEUE_STATE_LABEL, reasonMessage } from '../constants/queue';
import { packHolds, useQueueRowFor, useQueueVisible } from '../hooks/useQueue';
import { FileState } from '../types/entry';
import type { QueueRow } from '../types/queue';

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

const withPercent = (text: string, percent: number | null) => percent === null ? text : text + ' · ' + percent + ' %';

/** The live row in words: state, progress, a pack's label, and why it needs attention. */
const rowText = (row: QueueRow, episodeId: string | null | undefined) => {
    let text = withPercent(QUEUE_STATE_LABEL[row.state] ?? row.state, progressPercent(row.progress));
    // Unknown keeps the last value; it is labelled as such rather than shown as live (UX §14).
    if (row.state === 'unknown' && row.progress !== null) text += ' (last known)';
    let reason = row.state === 'blocked' || row.state === 'failed' ? reasonMessage(row.reason, row.message) : null;
    // A pack's row is the whole torrent; this episode's own import may still need attention (season packs, 2026-10-08).
    const own = row.pack?.episodes.find(item => item.episodeId === episodeId);
    if (!reason && own && packProblem(own.importState, own.reason)) reason = reasonMessage(own.reason);
    if (row.pack) text += ' · ' + row.pack.label;
    if (reason) text += ' · ' + reason;
    return text;
};

/**
 * One line on a detail page for a `grabbed` or `downloading` movie or episode, or an episode a pack is adding a file to: the live queue state and progress
 * when the queue can be read, the projected values otherwise, and **View queue** where the caller may open it
 * (P5.I8). Renders nothing for any other state or on a plugin without the queue.
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
    let text: string;
    if (row) {
        text = rowText(row, episodeId);
    } else if (state === FileState.Downloading) {
        text = withPercent('Downloading', typeof progress === 'number' ? Math.floor(progress) : null);
    } else {
        text = 'Grabbed · waiting for the download client';
    }
    return <p className='jfmod-queueStatusLine'>
        {text}
        {visible && <>{' · '}<a href={'#' + QUEUE_ROUTE}>View queue</a></>}
    </p>;
};

export default QueueStatusLine;
