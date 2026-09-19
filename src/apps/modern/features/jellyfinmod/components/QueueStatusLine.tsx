import React, { type FC } from 'react';

import { progressPercent, QUEUE_ROUTE, QUEUE_STATE_LABEL, reasonMessage } from '../constants/queue';
import { useQueueRowFor, useQueueVisible } from '../hooks/useQueue';
import { FileState } from '../types/entry';

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

/**
 * One line on a detail page for a `grabbed` or `downloading` movie or episode: the live queue state and progress
 * when the queue can be read, the projected values otherwise, and **View queue** where the caller may open it
 * (P5.I8). Renders nothing for any other state or on a plugin without the queue.
 */
const QueueStatusLine: FC<QueueStatusLineProps> = ({ entryId, episodeId, state, progress }) => {
    const inFlight = state === FileState.Grabbed || state === FileState.Downloading;
    const row = useQueueRowFor(entryId, episodeId ?? null, inFlight);
    const visible = useQueueVisible(inFlight);
    if (!inFlight) return null;
    let text: string;
    if (row) {
        text = withPercent(QUEUE_STATE_LABEL[row.state] ?? row.state, progressPercent(row.progress));
        // Unknown keeps the last value; it is labelled as such rather than shown as live (UX §14).
        if (row.state === 'unknown' && row.progress !== null) text += ' (last known)';
        const reason = row.state === 'blocked' || row.state === 'failed' ? reasonMessage(row.reason, row.message) : null;
        if (reason) text += ' · ' + reason;
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
