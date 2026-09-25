import React, { type FC } from 'react';

import type { RetentionWarning as Warning } from '../types/entry';

import './retentionWarning.scss';

interface RetentionWarningProps {
    warning: Warning;
    /** What the page shows, for viewers who are not told the file names: `episode` or `movie`. */
    subject?: 'episode' | 'movie';
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
const describe = (warning: Warning, subject: 'episode' | 'movie') => {
    if (warning.files.length === 0) return `this ${subject}`;
    return warning.files.length === 1 ? 'this file' : `these ${warning.files.length} files`;
};

const RetentionWarning: FC<RetentionWarningProps> = ({ warning, subject = 'episode', keepLabel, busy, onKeep }) => {
    const date = new Date(warning.deadline).toLocaleDateString();
    const what = describe(warning, subject);
    const verb = warning.files.length > 1 ? 'were' : 'was';
    // A date that has passed is not a countdown: the files go at the next retention run (RET2-R5).
    const when = warning.overdue ?
        <>{verb} due on <time dateTime={warning.deadline}>{date}</time> and will be deleted at the next retention run</> :
        <>will be deleted on <time dateTime={warning.deadline}>{date}</time></>;
    return <div className='jfmod-retentionWarning' role='note' aria-label='Added to retention'>
        <p className='jfmod-retentionWarningTitle'>
            Added to retention: {what} {when} unless kept.
        </p>
        <p className='jfmod-retentionWarningCause'>Why: {warning.cause}.</p>
        {warning.files.length > 0 && <ul className='jfmod-retentionWarningFiles'>
            {warning.files.map(file => <li key={file}>{file}</li>)}
        </ul>}
        {onKeep && <button className='emby-button raised' type='button' aria-busy={busy} aria-disabled={busy}
            onClick={onKeep}>{keepLabel ?? 'Keep'}</button>}
    </div>;
};

export default RetentionWarning;
