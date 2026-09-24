import React, { type FC } from 'react';

import type { RetentionWarning as Warning } from '../types/entry';

import './retentionWarning.scss';

interface RetentionWarningProps {
    warning: Warning;
    /** What a Keep here keeps, for its label; undefined for viewers who cannot Keep. */
    keepLabel?: string;
    busy?: boolean;
    onKeep?: () => void;
}

/**
 * The file is counting down to deletion (PHASE10 Q8): shown to everyone who can see the title, with the date for every
 * viewer (Q11), why the window started and which files it applies to. Administrators get Keep inside it; it is a plain
 * button in the page's focus flow, so a remote reaches it with the arrow keys and Enter.
 */
const RetentionWarning: FC<RetentionWarningProps> = ({ warning, keepLabel, busy, onKeep }) => {
    const date = new Date(warning.deadline).toLocaleDateString();
    const subject = warning.files.length === 1 ? 'this file' : `these ${warning.files.length} files`;
    return <div className='jfmod-retentionWarning' role='note' aria-label='Added to retention'>
        <p className='jfmod-retentionWarningTitle'>
            Added to retention: {subject} will be deleted on <time dateTime={warning.deadline}>{date}</time> unless kept.
        </p>
        <p className='jfmod-retentionWarningCause'>Why: {warning.cause}.</p>
        <ul className='jfmod-retentionWarningFiles'>
            {warning.files.map(file => <li key={file}>{file}</li>)}
        </ul>
        {onKeep && <button className='emby-button raised' type='button' aria-busy={busy} aria-disabled={busy}
            onClick={onKeep}>{keepLabel ?? 'Keep'}</button>}
    </div>;
};

export default RetentionWarning;
