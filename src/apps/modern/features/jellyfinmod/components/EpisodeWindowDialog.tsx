import React, { type FC } from 'react';
import { Dialog as DesignDialog } from '../design/Dialog';
import { Button as DesignButton, Select } from '../design/Controls';

/** The episode window choices an administrator can pick (PHASE10 Q4); `inherit` follows the series. */
const EPISODE_WINDOWS = [1, 3, 7, 14, 30, 60, 90, 180, 365];
export const windowDays = (count: number) => `${count} day${count === 1 ? '' : 's'}`;
const WINDOW_OPTIONS = [{ value: 'inherit', label: 'Series default' },
    ...EPISODE_WINDOWS.map(count => ({ value: String(count), label: `${windowDays(count)} after watching` }))];

interface EpisodeWindowDialogProps {
    open: boolean;
    value: string;
    busy: boolean;
    onChange: (value: string) => void;
    onClose: () => void;
}

/**
 * "Remove after watching…" from the stock More menu (user, 2026-10-07): the episode's own retention window, the same choices
 * the page's select offered before. An MUI dialog with an MUI select, so `shell/dpadModals` gives both the remote: Back
 * closes the open one, arrows stay inside it, Enter picks. A choice is saved at once; Done closes.
 */
const EpisodeWindowDialog: FC<EpisodeWindowDialogProps> = ({ open, value, busy, onChange, onClose }) => {
    return open ? <DesignDialog title='Remove After Watching' narrow close={onClose} className='jfmod-windowDialog'>
        <Select label='Remove this episode' id='jfmod-episode-window' value={value} options={WINDOW_OPTIONS} busy={busy}
            onChange={next => { if (!busy) onChange(next); }} />
        <div className='dlgfoot'><DesignButton kind='main' onClick={onClose} data-jfmod-window-done=''>Done</DesignButton></div>
    </DesignDialog> : null;
};

export default EpisodeWindowDialog;
