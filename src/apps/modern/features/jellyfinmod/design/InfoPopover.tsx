import React, { type FC } from 'react';
import { Menu } from './Menu';
import { Icon } from './Icon';

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

/** ds2.js ipop: the existing state/failure facts and client link. */
const InfoPopover: FC<InfoPopoverProps> = ({ anchor, title, message, link, onClose }) => anchor ?
    <Menu anchor={anchor} label={title} close={onClose} surface='ipop' anchored>
        <b>{title}</b><button type='button' className='rb focusable' title='Close' aria-label='Close' onClick={onClose}><Icon name='close' /></button>
        {(Array.isArray(message) ? message : [message]).map(line => <span data-ds-info-line='' key={line}>{line}<br /></span>)}
        {link && <a className='flat focusable' href={link.url} target='_blank' rel='noopener noreferrer'>{'Open ' + link.name}</a>}
    </Menu> : null;
export default InfoPopover;
