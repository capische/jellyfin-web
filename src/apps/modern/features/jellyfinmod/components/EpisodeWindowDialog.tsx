import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import React, { type ChangeEvent, type FC, useCallback } from 'react';

/** MUI's select trigger takes the class the TV's spatial navigation looks for (as settingsWidgets' FOCUSABLE_SELECT). */
const FOCUSABLE_SELECT = { select: { SelectDisplayProps: { className: 'focusable' } } };

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
    // A request in flight keeps the select focusable (UX §13): the choice is ignored rather than the control disabled.
    const choose = useCallback((event: ChangeEvent<HTMLInputElement>) => {
        if (!busy) onChange(event.target.value);
    }, [busy, onChange]);
    return <Dialog open={open} onClose={onClose} maxWidth='xs' fullWidth className='jfmod-windowDialog'>
        <DialogTitle>Remove After Watching</DialogTitle>
        <DialogContent>
            <TextField select fullWidth margin='dense' label='Remove this episode' value={value} onChange={choose}
                aria-busy={busy} slotProps={FOCUSABLE_SELECT} id='jfmod-episode-window'>
                {WINDOW_OPTIONS.map(option => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
            </TextField>
        </DialogContent>
        <DialogActions>
            <Button onClick={onClose} data-jfmod-window-done=''>Done</Button>
        </DialogActions>
    </Dialog>;
};

export default EpisodeWindowDialog;
