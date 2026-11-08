import React, { type FC, type KeyboardEvent, type MouseEvent, type ReactNode, useContext, useState } from 'react';
import actionsheet from 'components/actionSheet/actionSheet';
import { useUserSettings } from 'hooks/useUserSettings';
import type { CardOptions } from 'types/cardOptions';
import type { BrowseRow } from '../types/browse';
import { CellDisc, CellMenu } from './Cell';
import { useCellModel } from './useCellModel';
import { FileState, type Entry, type RetentionSummary } from '../types/entry';
import { daysUntilReclaim, retentionDeadline } from '../constants/fileState';
import { Cloud, Icon } from './Icon';
import { DesignContext } from './Root';

/** One cell of the search grid (TM2, guide `search-card.md`): a library title or a TMDB result. */
export interface SearchCardItem {
    /** `movie:123` for a TMDB identity, else the library row's own key. */
    key: string;
    mediaType: 'movie' | 'series';
    tmdbId?: number;
    title: string;
    year?: number | null;
    /** The release date (ISO) where known: full matches are ordered by it. */
    date?: string | null;
    /** TMDB's votes where known: the grid's order (D253). */
    votes?: number | null;
    /** The two lead actors, at most. */
    cast: string[];
    poster?: string;
    /** Where the card opens: the library page, or the browse page of a TMDB result; absent opens nothing. */
    href?: string;
    /** A library title's entry: its Not Downloaded cloud top right while it has no file; nothing once it has one. */
    entry?: Entry;
    retention?: RetentionSummary | null;
    /**
     * A TMDB result: the Download disc in the poster's centre adds it and opens the release picker (ds.t17); Add to Library,
     * the add alone, is in the card's More.
     */
    add?: { adding: boolean; onAdd: (button: HTMLElement) => void; onDownload: (button: HTMLElement) => void };
    /** A library title's row: its card draws Home's disc (Play, Download, or the progress ring) and foot pill (ds.t16). */
    row?: BrowseRow;
}

interface ViewProps {
    item: SearchCardItem;
    /** The library title's disc and foot pill, over the poster. */
    over?: ReactNode;
    /** The library title's item attributes, which the disc's and the pill's commands read (as a Home card's). */
    data?: Record<string, unknown>;
    onPrepare?: () => void;
}

/** ds.js cell for the mixed Search grid; the existing search session owns Add and navigation. */

const activate = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.click();
    }
};

/** A control inside the card's link: it acts, and the link does not open. */
const own = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    return event.currentTarget;
};

/** A TMDB result's foot pill: More alone (it has no item to mark watched or favourite), with Download and Add to Library. */
const AddMenu: FC<{ add: NonNullable<SearchCardItem['add']> }> = ({ add }) =>
    <span className='hmenu glassy jfmod-cardActions'>
        <span className='pi focusable' role='button' tabIndex={0} data-tip='More' aria-label='More' aria-disabled={add.adding || undefined}
            onKeyDown={activate} onClick={event => {
                const opener = own(event);
                if (add.adding) return;
                void actionsheet.show({ positionTo: opener, items: [
                    { id: 'get', name: 'Download', icon: 'cloud_download' },
                    { id: 'add', name: 'Add to Library', icon: 'add' }
                ] }).then(id => {
                    if (id === 'get') add.onDownload(opener);
                    if (id === 'add') add.onAdd(opener);
                }, () => undefined);
            }}><Icon name='more' /></span>
    </span>;

const noFile = (entry?: Entry) => !!entry && [FileState.None, FileState.Reclaimed].includes(entry.state);

/** The corner: Not Downloaded, Searching, or the days before the file is removed. */
const cornerMark = (item: SearchCardItem) => {
    const days = daysUntilReclaim(retentionDeadline(item.retention));
    let mark: ReactNode = null;
    let tip = 'Not Downloaded';
    if (noFile(item.entry)) mark = <Cloud />;
    if (item.entry?.state === FileState.Searching) {
        mark = <Icon name='search' />;
        tip = 'Searching';
    }
    if (days !== null && days <= 3) {
        mark = <span className='num'>{days}d</span>;
        tip = `File will be removed in ${days} days`;
    }
    return { mark, tip };
};

const SearchCellView: FC<ViewProps> = ({ item, over, data, onPrepare }) => {
    const device = useContext(DesignContext);
    const { libraryPageSize } = useUserSettings();
    const [failed, setFailed] = useState<string>();
    const [focused, setFocused] = useState(false);
    const add = device === 'computer' ? item.add : undefined;
    const { mark, tip } = cornerMark(item);
    const body = <div className='tile'><span className='post'>
        {item.poster && failed !== item.poster ? <img src={item.poster} alt='' loading='lazy' onError={() => setFailed(item.poster)} /> :
            <Icon name={item.mediaType === 'movie' ? 'movie' : 'tv'} className='fallback' />}
        {mark && <span className='mark glassy' title={tip}>{mark}</span>}
        {add && <span className={'disc hov glassy' + (add.adding ? ' on' : '')} role='button' tabIndex={0}
            aria-label={`Download ${item.title}`} data-tip='Download' aria-busy={add.adding || undefined}
            aria-disabled={add.adding || undefined} data-jfmod-add={item.key} onKeyDown={activate}
            onClick={event => {
                const button = own(event);
                if (!add.adding) add.onDownload(button);
            }}>
            <Cloud />
            {add.adding && <span className='dm importing' aria-hidden='true'><svg className='arc' viewBox='0 0 36 36'><circle className='turn' cx='18' cy='18' r='15.9' fill='none' stroke='currentColor' strokeWidth='2.2' strokeDasharray='28 72' /></svg></span>}
        </span>}
        {add && <AddMenu add={add} />}
        {over}
    </span><div className='capt'>
        <div className='ln t'>{item.title}</div>
        <div className='ln'>{item.year && <span>{item.year}</span>}{item.mediaType === 'series' && <span className='k'>TV Series</span>}</div>
        <div className='ln d'>{libraryPageSize ? item.cast.slice(0, 2).join(', ') : ''}</div>
    </div></div>;
    return <a href={item.href} aria-label={item.title} tabIndex={0} className={'cell p focusable' + (add || over ? ' act' : '') + (focused && device !== 'phone' ? ' focus' : '')}
        {...data} data-jfmod-key={item.key} data-jfmod-entry-id={item.entry?.id} data-jfmod-tmdb-id={item.tmdbId}
        data-jfmod-nofile={noFile(item.entry) ? '' : undefined}
        onMouseEnter={onPrepare} onFocus={() => {
            onPrepare?.();
            setFocused(true);
        }}
        onBlur={event => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
        }}>
        {body}
    </a>;
};

/** A library title: Home's card disc and foot pill on the search card (the user, 2026-11-07: "Play if file exists. Download … if in Library but not on the disk"). */
const LibrarySearchCell: FC<{ item: SearchCardItem; row: BrowseRow; options: CardOptions }> = ({ item, row, options }) => {
    const model = useCellModel(row, options);
    return <SearchCellView item={item} data={model.item ? model.data : undefined} onPrepare={model.prepareRelease}
        over={<><CellDisc model={model} /><CellMenu model={model} /></>} />;
};

export const SearchCell: FC<{ item: SearchCardItem; options?: CardOptions }> = ({ item, options }) =>
    (item.row && options ? <LibrarySearchCell item={item} row={item.row} options={options} /> : <SearchCellView item={item} />);
