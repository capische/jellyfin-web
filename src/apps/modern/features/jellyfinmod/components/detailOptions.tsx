import MenuItem from '@mui/material/MenuItem';
import React, { type FC } from 'react';

import PhoneMark, { PHONE_PROFILE_LABEL } from './PhoneMark';

import './detailOptions.scss';

/** A select's choice with an optional second line: a quality profile's one-line summary (P4.FU17, P4.FU19). */
export interface DetailOption {
    value: string;
    label: string;
    detail?: string;
    /** The quality profile for phones (Phase 12, D54): its name carries the phone mark, in the menu and in the closed select. */
    phone?: boolean;
}

const Name: FC<{ option: DetailOption }> = ({ option }) => <>{option.label}{option.phone && <PhoneMark label={PHONE_PROFILE_LABEL} />}</>;

/**
 * The open menu's entries for an MUI select: the label in 600 over its detail in the secondary colour, in a list row's sizes; a
 * long detail wraps in a narrow menu instead of widening it. An option without a detail is its label alone.
 */
export const detailMenuItems = (options: DetailOption[]) => options.map(option => (
    <MenuItem key={option.value} value={option.value} className={option.detail ? 'jfmod-optdetail' : undefined}>
        {option.detail ?
            <span className='jfmod-optdetail-text'><strong><Name option={option} /></strong><span>{option.detail}</span></span> :
            <Name option={option} />}
    </MenuItem>
));

/** The select's `renderValue`: the closed select shows the chosen option's label only. */
const DetailLabel: FC<{ options: DetailOption[]; value: unknown }> = ({ options, value }) => {
    const option = options.find(candidate => candidate.value === value) ?? { value: '', label: '' };
    return <Name option={option} />;
};

export const detailLabelOf = (options: DetailOption[]) => function renderDetailLabel(value: unknown): React.ReactElement {
    return <DetailLabel options={options} value={value} />;
};
