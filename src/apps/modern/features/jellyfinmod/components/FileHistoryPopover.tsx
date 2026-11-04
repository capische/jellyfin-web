import React, { type FC, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import focusManager from 'components/focusManager';
import inputManager from 'scripts/inputManager';
import { getKeyName } from 'scripts/keyboardNavigation';
import { fileHistory, fileTitle } from '../constants/detailPage';
import { Icon } from '../design/Icon';
import { Root } from '../design/Root';
import { menuPosition } from '../design/menuPosition';
import { isBackKey } from '../shell/dpadModals';
import type { HistoryRecord } from '../types/entry';
import type { VersionDto } from '../types/versions';

interface FileHistoryPopoverProps {
    anchor: HTMLElement | null;
    version: VersionDto | null;
    history: HistoryRecord[];
    onClose: () => void;
}

/** ds2.js hpop; the existing binding-specific history calculation stays authoritative. */
const FileHistoryPopover: FC<FileHistoryPopoverProps> = ({ anchor, version, history, onClose }) => {
    const ref = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        if (!anchor || !version || !ref.current) return;
        const place = () => {
            if (!ref.current) return;
            const at = menuPosition(anchor, ref.current, 0.236);
            ref.current.style.top = at.top + 'px';
            ref.current.style.left = at.left + 'px';
        };
        const outside = (event: Event) => {
            if (!ref.current?.contains(event.target as Node) && !anchor.contains(event.target as Node)) onClose();
        };

        const key = (event: KeyboardEvent) => {
            if (!isBackKey(getKeyName(event)) || event.defaultPrevented) return;
            event.preventDefault();
            event.stopPropagation();
            onClose();
        };
        const command = (event: Event) => {
            if ((event as CustomEvent<{ command?: string }>).detail?.command !== 'back' || event.defaultPrevented) return;
            event.preventDefault();
            event.stopPropagation();
            onClose();
        };
        place();
        focusManager.autoFocus(ref.current);

        window.addEventListener('resize', place);
        document.addEventListener('pointerdown', outside);
        window.addEventListener('keydown', key, true);
        inputManager.on(window, command);

        return () => {
            window.removeEventListener('resize', place);
            document.removeEventListener('pointerdown', outside);
            window.removeEventListener('keydown', key, true);
            inputManager.off(window, command);

            if (anchor.isConnected) focusManager.focus(anchor);
        };
    }, [anchor, version, onClose]);
    if (!anchor || !version) return null;
    const lines = fileHistory(history, version.bindingId);
    return createPortal(<Root className='menuportal'><div ref={ref} className='hpop historyportal' role='dialog' aria-label='History of this file'>
        <div className='hh'>{fileTitle(version)}<button type='button' className='rb focusable' aria-label='Close' onClick={onClose}><Icon name='x' /></button></div>
        {lines.length ? <ol>{lines.map(line => <li key={line.id}><b><time dateTime={line.dateTime}>{line.date}</time></b>{' · '}<span data-ds-history-action=''>{line.action}</span>{line.detail && <> · {line.detail}</>}</li>)}</ol> :
            <p>No events recorded for this file.</p>}
    </div></Root>, document.body);
};
export default FileHistoryPopover;
