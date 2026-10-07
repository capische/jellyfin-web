import IconButton from '@mui/material/IconButton';
import Popover from '@mui/material/Popover';
import React, { type FC } from 'react';

import { fileHistory, fileTitle } from '../constants/detailPage';
import type { HistoryRecord } from '../types/entry';
import type { VersionDto } from '../types/versions';

import './fileHistory.scss';

interface FileHistoryPopoverProps {
    /** The history icon that opened it; focus returns there when it closes (UX §13 rule 9). */
    anchor: HTMLElement | null;
    version: VersionDto | null;
    history: HistoryRecord[];
    onClose: () => void;
}

/**
 * One file's history (design step 3, user 2026-10-07): an MUI popover, so `shell/dpadModals` gives it the remote — Back closes
 * it and MUI returns focus to the icon. Titled with the file's short description; only that file's events, newest first,
 * short dates and action words without the file name. Episode-level events are not shown on this page.
 */
const FileHistoryPopover: FC<FileHistoryPopoverProps> = ({ anchor, version, history, onClose }) => {
    const lines = version ? fileHistory(history, version.bindingId) : [];
    return <Popover open={!!anchor && !!version} anchorEl={anchor} onClose={onClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }} transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { className: 'jfmod-fileHistory', 'aria-label': 'History of this file' } as object }}>
        {version && <>
            <div className='jfmod-fileHistoryHead'>
                <span className='jfmod-fileHistoryTitle'>{fileTitle(version)}</span>
                <IconButton size='small' aria-label='Close' onClick={onClose} className='jfmod-fileHistoryClose'>
                    <span className='material-icons close' aria-hidden='true' />
                </IconButton>
            </div>
            {lines.length === 0 ?
                <p className='jfmod-fileHistoryEmpty'>No events recorded for this file.</p> :
                <ol className='jfmod-fileHistoryList'>
                    {lines.map(line => <li key={line.id}>
                        <time dateTime={line.dateTime}>{line.date}</time>{' · '}
                        <span className='jfmod-fileHistoryAction'>{line.action}</span>
                        {line.detail && <>{' · '}{line.detail}</>}
                    </li>)}
                </ol>}
        </>}
    </Popover>;
};

export default FileHistoryPopover;
