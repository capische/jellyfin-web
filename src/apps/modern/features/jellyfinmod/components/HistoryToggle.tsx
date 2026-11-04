import React, { type FC, type ReactNode, useCallback, useState } from 'react';
import { Icon } from '../design/Icon';

/**
 * A disclosure that spatial navigation can reach: a real button with aria-expanded instead of a
 * `<summary>`, which the TV focus manager skips (P3.T19).
 */
const HistoryToggle: FC<{ label: ReactNode; children: ReactNode; summary?: ReactNode }> = ({ label, children, summary }) => {
    const [open, setOpen] = useState(false);
    const toggle = useCallback(() => setOpen(value => !value), []);
    return <div className='disclosure'>
        <button type='button' className='dsc focusable' aria-expanded={open} onClick={toggle}>
            <Icon name={open ? 'down' : 'right'} />
            <b>{label}</b>{summary && <i>{summary}</i>}
        </button>
        {open && <div className='opn'>{children}</div>}
    </div>;
};

export default HistoryToggle;
