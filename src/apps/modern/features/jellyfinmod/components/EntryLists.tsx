import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import List from 'components/listview/List/List';
import layoutManager from 'components/layoutManager';
import type { ListOptions } from 'types/listOptions';
import type { BrowseRow } from '../types/browse';
import { getEntryPath, getTmdbImage } from '../utils/entryLinks';
import FileStateMark from './FileStateMark';
import './entryList.scss';

interface Props {
    rows: BrowseRow[];
    listOptions: ListOptions;
    serverId?: string;
    alwaysShowCountdown?: boolean;
}

function NativeEntryList({ row, index, listOptions, alwaysShowCountdown }: Readonly<{ row: Extract<BrowseRow, { kind: 'native' }>; index: number; listOptions: ListOptions; alwaysShowCountdown?: boolean }>) {
    const anchor = useRef<HTMLDivElement>(null);
    const [cover, setCover] = useState<Element | null>(null);
    // The mark sits at the row's end (UX §3.1, P1.FU11): the last item of the row's flex line.
    useLayoutEffect(() => {
        setCover(anchor.current?.querySelector('.listItem-content') ?? anchor.current?.querySelector('.listItem') ?? null);
    }, [listOptions.image]);
    return <div ref={anchor}>
        <List index={index} item={row.nativeItem} listOptions={listOptions} />
        {row.entry && cover && createPortal(<FileStateMark entry={row.entry} retention={row.retention}
            alwaysShowCountdown={alwaysShowCountdown} variant='row' />, cover)}
    </div>;
}

export default function EntryLists({ rows, listOptions, serverId, alwaysShowCountdown }: Readonly<Props>) {
    const openEntry = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
        const path = event.currentTarget.dataset.entryPath;
        if (path) window.location.hash = '#' + path;
    }, []);
    return <>{rows.map((row, index) => {
        if (row.kind === 'native') {
            return <NativeEntryList key={'native:' + row.nativeItem.Id} row={row} index={index}
                listOptions={listOptions} alwaysShowCountdown={alwaysShowCountdown} />;
        }
        const path = getEntryPath(row.entry.id, serverId);
        const artwork = getTmdbImage(row.entry.posterPath);
        const content = <>
            <div className='listItemImage jfmod-entryListImage' style={artwork ? { backgroundImage: `url("${artwork}")` } : undefined} />
            <div className='listItemBody'>
                <div className='listItemBodyText'>{row.entry.title}</div>
                {row.entry.year && <div className='listItemBodyText secondary'>{row.entry.year}</div>}
            </div>
            <FileStateMark entry={row.entry} retention={row.retention} alwaysShowCountdown={alwaysShowCountdown} variant='row' />
        </>;
        return layoutManager.tv ? <button key={'entry:' + row.entry.id} type='button' data-index={index}
            className='listItem listItem-border listItem-button listItem-focusscale jfmod-entryList' aria-label={row.entry.title}
            data-entry-path={path} onClick={openEntry}>{content}</button> :
            <a key={'entry:' + row.entry.id} data-index={index} className='listItem listItem-border emby-button jfmod-entryList'
                href={'#' + path}>{content}</a>;
    })}</>;
}
