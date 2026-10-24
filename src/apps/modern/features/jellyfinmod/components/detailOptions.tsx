import MenuItem from '@mui/material/MenuItem';
import React from 'react';

import './detailOptions.scss';

/** A select's choice with an optional second line: a quality profile's one-line summary (P4.FU17, P4.FU19). */
export interface DetailOption {
    value: string;
    label: string;
    detail?: string;
}

/**
 * The open menu's entries for an MUI select: the label in 600 over its detail in the secondary colour, in a list row's sizes; a
 * long detail wraps in a narrow menu instead of widening it. An option without a detail is its label alone.
 */
export const detailMenuItems = (options: DetailOption[]) => options.map(option => (
    <MenuItem key={option.value} value={option.value} className={option.detail ? 'jfmod-optdetail' : undefined}>
        {option.detail ?
            <span className='jfmod-optdetail-text'><strong>{option.label}</strong><span>{option.detail}</span></span> :
            option.label}
    </MenuItem>
));

/** The select's `renderValue`: the closed select shows the chosen option's label only. */
export const detailLabelOf = (options: DetailOption[]) => (value: unknown) => options.find(option => option.value === value)?.label ?? '';
