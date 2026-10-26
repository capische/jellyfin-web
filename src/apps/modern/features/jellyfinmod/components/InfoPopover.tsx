import IconButton from '@mui/material/IconButton';
import Popover from '@mui/material/Popover';
import React, { type FC } from 'react';

import layoutManager from 'components/layoutManager';

import './infoPopover.scss';

interface InfoPopoverProps {
    /** The (i) that opened it; MUI returns focus there (or to the line a pointer press left focused) when it closes. */
    anchor: HTMLElement | null;
    title: string;
    /** One paragraph, or one line per fact (the Queue page's state, P4.FU28). */
    message: string | string[];
    /** A link after the text: the Queue page's "Open <client>" for administrators. */
    link?: { name: string; url: string } | null;
    onClose: () => void;
    /** On the phone the popover spans the width under this element (the anchor's row); the anchor when not given. */
    row?: HTMLElement | null;
}

/**
 * An (i)'s explanation (approved 2026-10-26; docs/jellyfinmod/design/guides/info-tip.md): the file-history popover's look, a title,
 * a round Close (focused on the TV), then the message, a line per fact, and an optional link. Under the (i), left-aligned; on the phone the full width under its row. An MUI
 * popover, so `shell/dpadModals` gives it the remote: Back closes it and focus returns to the (i).
 */
const InfoPopover: FC<InfoPopoverProps> = ({ anchor, title, message, link, onClose, row }) => {
    const phone = layoutManager.mobile;
    const below = phone && anchor ? (row ?? anchor).getBoundingClientRect().bottom : 0;
    return <Popover open={!!anchor} anchorEl={anchor} onClose={onClose} className='jfmod-infoPopoverRoot'
        slotProps={{ paper: { className: phone ? 'jfmod-infoPopover jfmod-infoPopover--phone' : 'jfmod-infoPopover',
            role: 'dialog', 'aria-label': title } as object }}
        {...(phone ? { anchorReference: 'anchorPosition' as const, anchorPosition: { top: below, left: 0 }, marginThreshold: 8 } : {
            anchorOrigin: { vertical: 'bottom', horizontal: 'left' } as const,
            transformOrigin: { vertical: 'top', horizontal: 'left' } as const })}>
        <div className='jfmod-infoPopoverHead'>
            <span className='jfmod-infoPopoverTitle'>{title}</span>
            {/* eslint-disable-next-line jsx-a11y/no-autofocus -- on the TV the remote's Enter on the (i) lands on Close (UX §13 rule 5) */}
            <IconButton size='small' aria-label='Close' onClick={onClose} className='jfmod-infoPopoverClose' autoFocus={layoutManager.tv}>
                <span className='material-icons close' aria-hidden='true' />
            </IconButton>
        </div>
        {(Array.isArray(message) ? message : [message]).map(line => <p key={line} className='jfmod-infoPopoverText'>{line}</p>)}
        {link && <p className='jfmod-infoPopoverText jfmod-infoPopoverLinkLine'>
            <a className='jfmod-infoPopoverLink' href={link.url} target='_blank' rel='noopener noreferrer'>{'Open ' + link.name}</a>
        </p>}
    </Popover>;
};

export default InfoPopover;
