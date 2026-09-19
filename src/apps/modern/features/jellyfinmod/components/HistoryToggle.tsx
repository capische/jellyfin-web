import React, { type FC, type ReactNode, useCallback, useState } from 'react';

/**
 * A disclosure that spatial navigation can reach: a real button with aria-expanded instead of a
 * `<summary>`, which the TV focus manager skips (P3.T19).
 */
const HistoryToggle: FC<{ label: ReactNode; children: ReactNode }> = ({ label, children }) => {
    const [open, setOpen] = useState(false);
    const toggle = useCallback(() => setOpen(value => !value), []);
    return <div className='jfmod-entryHistory'>
        <button type='button' className='emby-button jfmod-historyToggle' aria-expanded={open} onClick={toggle}>
            {open ? '▾' : '▸'} {label}
        </button>
        {open && children}
    </div>;
};

export default HistoryToggle;
