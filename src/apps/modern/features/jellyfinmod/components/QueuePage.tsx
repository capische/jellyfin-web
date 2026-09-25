import type { Api } from '@jellyfin/sdk/lib/api';
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import { CollectionType } from '@jellyfin/sdk/lib/generated-client/models/collection-type';
import type { Theme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import classNames from 'classnames';
import React, { type FC, type FocusEvent, type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import focusManager from 'components/focusManager';
import layoutManager from 'components/layoutManager';
import Page from 'components/Page';
import { appRouter } from 'components/router/appRouter';
import { useUserViews } from 'hooks/api/useUserViews';
import { useApi } from 'hooks/useApi';

import {
    automationPausedText, formatBytes, formatDuration, formatRate, progressPercent, QUEUE_STATE_LABEL, queueRowTitle, reasonMessage,
    seedingSummary, sortQueueRows, updatedAgo
} from '../constants/queue';
import { useQueue, useQueueCapability } from '../hooks/useQueue';
import { openQueueRowMenu, queueRowActions } from '../integration/queueActions';
import type { QueueList, QueueRow } from '../types/queue';
import { getEntryPath, getTmdbImage } from '../utils/entryLinks';

import './queue.scss';

type QueueLayout = 'desktop' | 'mobile' | 'tv';

const FOCUS_SELECTOR = '.jfmod-queueFocus';

/** The client could not be read: keep the last value and say how old it is, never 0 % (UX §14). */
const freshnessOf = (row: QueueRow, generatedAt: string) => {
    if (row.state === 'unknown') return updatedAgo(row.observedAt, generatedAt) ?? 'Not observed yet';
    if (row.state === 'stalled' && row.stalledSince) {
        const seconds = (Date.parse(generatedAt) - Date.parse(row.stalledSince)) / 1000;
        return 'No progress for ' + (formatDuration(seconds) ?? 'a while');
    }
    return null;
};

/** The reason sentence for a blocked or failed import, or the seeding goals in words. */
const detailOf = (row: QueueRow) => {
    if (row.state === 'blocked' || row.state === 'failed') return reasonMessage(row.reason, row.message);
    if (row.state !== 'seeding' || !row.seeding) return null;
    const summary = seedingSummary(row.seeding);
    let reason = row.seeding.reason;
    if (!reason && !row.seeding.releaseEnabled) reason = 'seed_release_disabled';
    const why = row.seeding.state === 'blocked' || !row.seeding.releaseEnabled ? reasonMessage(reason) : null;
    return why ? summary + '. ' + why : summary;
};

const versionOf = (row: QueueRow) => {
    if (row.intent !== 'addVersion') return row.versionLabel;
    return 'Another version' + (row.versionLabel ? ': ' + row.versionLabel : '');
};

/** Everything a row shows, worded once for all three layouts. */
const describeRow = (row: QueueRow, generatedAt: string) => {
    const downloaded = formatBytes(row.downloadedBytes);
    const size = formatBytes(row.sizeBytes);
    const transferring = row.state === 'downloading';
    return {
        title: queueRowTitle(row),
        version: versionOf(row),
        percent: progressPercent(row.progress),
        freshness: freshnessOf(row, generatedAt),
        detail: detailOf(row),
        state: QUEUE_STATE_LABEL[row.state] ?? row.state,
        size: downloaded && size && row.state !== 'seeding' ? downloaded + ' of ' + size : size,
        speed: transferring ? formatRate(row.downloadRateBytes) : null,
        eta: transferring ? formatDuration(row.etaSeconds) : null,
        problem: row.state === 'blocked' || row.state === 'failed'
    };
};

type RowText = ReturnType<typeof describeRow>;

const thumbUrl = (api: Api, row: QueueRow) => {
    if (row.entry?.jellyfinItemId) {
        return api.basePath + '/Items/' + encodeURIComponent(row.entry.jellyfinItemId) + '/Images/Primary?fillHeight=180&quality=90';
    }
    return getTmdbImage(row.entry?.posterPath, 'w154');
};

const Thumb: FC<{ api: Api; row: QueueRow }> = ({ api, row }) => {
    const url = thumbUrl(api, row);
    return <span className='jfmod-queueThumb' aria-hidden='true' style={url ? { backgroundImage: `url("${url}")` } : undefined} />;
};

/** A plain bar: no animation, so a 3 s poll moves it once and an old TV engine draws it cheaply. */
const ProgressBar: FC<{ text: RowText; stale: boolean }> = ({ text, stale }) => {
    if (text.percent === null) return <span className='jfmod-queueMuted'>{text.freshness ?? '—'}</span>;
    return <span className='jfmod-queueProgress'>
        <span className={classNames('jfmod-queueBar', { 'jfmod-queueBar--stale': stale })} role='progressbar'
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={text.percent} aria-label={text.title}>
            <span className='jfmod-queueBarFill' style={{ width: text.percent + '%' }} />
        </span>
        <span className='jfmod-queuePercent'>{text.percent} %</span>
        {text.freshness && <span className='jfmod-queueMuted jfmod-queueFreshness'>{text.freshness}</span>}
    </span>;
};

/** Parsed title first, the raw release title dimmed beneath and never hidden (UX §9 style). */
const TitleLines: FC<{ row: QueueRow; text: RowText; href?: string }> = ({ row, text, href }) => <>
    {href ? <a className='jfmod-queueTitle' href={href}>{text.title}</a> : <span className='jfmod-queueTitle'>{text.title}</span>}
    {text.version && <span className='jfmod-queueMuted'>{text.version}</span>}
    <span className='jfmod-queueRelease'>{row.releaseTitle}</span>
</>;

const StateLines: FC<{ text: RowText }> = ({ text }) => <>
    <span className={classNames('jfmod-queueState', { 'jfmod-queueState--problem': text.problem })}>{text.state}</span>
    {text.detail && <span className='jfmod-queueDetail'>{text.detail}</span>}
</>;

const metaLine = (text: RowText) => [text.size, text.speed, text.eta ? text.eta + ' left' : null].filter(Boolean).join(' · ');

interface RowProps {
    api: Api;
    row: QueueRow;
    text: RowText;
    isAdmin: boolean;
    showClient: boolean;
    href?: string;
    stale: boolean;
    onMenu: (row: QueueRow, target: HTMLElement) => void;
}

/*
 * A plain button wearing upstream's class, not `is='paper-icon-button-light'`: React creates an `is` element with an
 * options object, which the v0 custom-elements polyfill rejects (`toLowerCase is not a function`), and the error
 * boundary then replaced the whole Queue for an administrator as soon as one row had actions (P7.S11 sweep; the same
 * trap `EmbySelect` documents). The class carries the look; a native button is already focusable on every layout.
 */
const MenuButton: FC<{ row: QueueRow; title: string; onMenu: RowProps['onMenu'] }> = ({ row, title, onMenu }) => {
    const open = useCallback((event: MouseEvent<HTMLButtonElement>) => onMenu(row, event.currentTarget), [onMenu, row]);
    return <button type='button' className='paper-icon-button-light jfmod-queueMenu jfmod-queueFocus'
        title='Actions' aria-label={'Actions for ' + title} aria-haspopup='menu' onClick={open}>
        <span className='material-icons more_vert' aria-hidden='true' />
    </button>;
};

const TableRow: FC<RowProps> = ({ api, row, text, isAdmin, showClient, href, stale, onMenu }) => <tr className='jfmod-queueTableRow'>
    <td className='jfmod-queueCellThumb'><Thumb api={api} row={row} /></td>
    <td className='jfmod-queueCellTitle'><TitleLines row={row} text={text} href={href} /></td>
    <td className='jfmod-queueCellProgress'><ProgressBar text={text} stale={stale} /></td>
    <td className='jfmod-queueCellNumber'>{text.size ?? '—'}</td>
    <td className='jfmod-queueCellNumber'>{text.speed ?? '—'}</td>
    <td className='jfmod-queueCellNumber'>{text.eta ?? '—'}</td>
    <td className='jfmod-queueCellState'><StateLines text={text} /></td>
    {showClient && <td>{row.client?.name ?? '—'}</td>}
    {isAdmin && <td className='jfmod-queueCellMenu'>
        {queueRowActions(row, isAdmin).length > 0 && <MenuButton row={row} title={text.title} onMenu={onMenu} />}
    </td>}
</tr>;

const RowBody: FC<Omit<RowProps, 'isAdmin' | 'onMenu'>> = ({ api, row, text, showClient, href, stale }) => <>
    <Thumb api={api} row={row} />
    <span className='jfmod-queueRowBody'>
        <TitleLines row={row} text={text} href={href} />
        <ProgressBar text={text} stale={stale} />
        {metaLine(text) && <span className='jfmod-queueMuted'>{metaLine(text)}</span>}
        <StateLines text={text} />
        {showClient && row.client && <span className='jfmod-queueMuted'>{row.client.name}</span>}
    </span>
</>;

/** Mobile: one column, the menu behind the row's overflow button. */
const StackRow: FC<RowProps> = props => <div className='jfmod-queueRow jfmod-queueRow--stacked'>
    <RowBody {...props} />
    {queueRowActions(props.row, props.isAdmin).length > 0
        && <MenuButton row={props.row} title={props.text.title} onMenu={props.onMenu} />}
</div>;

/** TV: the whole row is the one focusable button; Enter opens the action sheet (UX §13). */
const TvRow: FC<RowProps> = props => {
    const { row, onMenu } = props;
    const open = useCallback((event: MouseEvent<HTMLButtonElement>) => onMenu(row, event.currentTarget), [onMenu, row]);
    return <button type='button' className='jfmod-queueRow jfmod-queueRow--tv jfmod-queueFocus' data-jfmod-queue-id={row.id} onClick={open}>
        <RowBody {...props} href={undefined} />
    </button>;
};

/** Keeps the order the user was reading while focus is inside the list; new rows join at the end. */
const applyOrder = (order: string[], sorted: QueueRow[]) => {
    const byId = new Map(sorted.map(row => [row.id, row]));
    const kept = order.flatMap(id => {
        const row = byId.get(id);
        return row ? [row] : [];
    });
    const known = new Set(order);
    return [...kept, ...sorted.filter(row => !known.has(row.id))];
};

const LibraryLinks: FC<{ views: BaseItemDto[]; types: CollectionType[]; className?: string }> = ({ views, types, className }) => {
    const matching = views.filter(view => view.CollectionType && types.includes(view.CollectionType));
    if (!matching.length) return <a className={classNames('emby-button raised', className)} href='#/home'>Open Home</a>;
    return <>{matching.map(view => <a key={view.Id} className={classNames('emby-button raised', className)}
        href={appRouter.getRouteUrl(view, { context: view.CollectionType })}>{'Browse ' + (view.Name ?? 'library')}</a>)}</>;
};

interface ContentProps {
    api: Api;
    list: QueueList;
    layout: QueueLayout;
    isAdmin: boolean;
    serverId?: string;
    views: BaseItemDto[];
    /** The library links are final, so first focus cannot land on a link that is about to be replaced. */
    viewsReady: boolean;
    refetch: () => void;
}

const QueueContent: FC<ContentProps> = ({ api, list, layout, isAdmin, serverId, views, viewsReady, refetch }) => {
    const container = useRef<HTMLDivElement>(null);
    const removal = useRef<{ id: string; index: number } | null>(null);
    const sorted = useMemo(() => sortQueueRows(list.items), [list.items]);
    const [frozenOrder, setFrozenOrder] = useState<string[] | null>(null);
    const rows = useMemo(() => frozenOrder ? applyOrder(frozenOrder, sorted) : sorted, [frozenOrder, sorted]);
    const showClient = rows.some(row => row.client);
    const staleAll = !list.clientStatus.reachable;

    // Polls re-render rows in place; the order is frozen while focus is inside and re-sorted when it leaves (P5.I8).
    const onFocus = useCallback(() => {
        setFrozenOrder(previous => previous ?? rows.map(row => row.id));
    }, [rows]);
    const onBlur = useCallback((event: FocusEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFrozenOrder(null);
    }, []);

    const onChanged = useCallback((row: QueueRow, action: 'remove' | 'retry') => {
        if (action === 'remove') removal.current = { id: row.id, index: Math.max(0, rows.findIndex(candidate => candidate.id === row.id)) };
        refetch();
    }, [refetch, rows]);
    const onMenu = useCallback((row: QueueRow, target: HTMLElement) => {
        void openQueueRowMenu({ api, row, isAdmin, positionTo: target, onChanged });
    }, [api, isAdmin, onChanged]);

    // Once a removed row has left the list, focus its neighbour (or the empty-state link) if focus fell out with it,
    // so a D-pad user is never thrown to the top of the page.
    useEffect(() => {
        const pending = removal.current;
        const root = container.current;
        if (!pending || !root || rows.some(row => row.id === pending.id)) return;
        removal.current = null;
        const active = document.activeElement;
        if (active && active !== document.body && document.body.contains(active)) return;
        const targets = root.querySelectorAll<HTMLElement>(FOCUS_SELECTOR + ', .jfmod-queueEmpty a');
        const target = targets[Math.min(pending.index, targets.length - 1)];
        if (target) focusManager.focus(target);
    }, [rows]);

    // TV: the first row (or the empty-state link) takes focus when the page opens (UX §13).
    const focusedOnce = useRef(false);
    useEffect(() => {
        if (layout !== 'tv' || focusedOnce.current || (!rows.length && !viewsReady)) return;
        focusedOnce.current = true;
        const target = container.current?.querySelector<HTMLElement>(FOCUS_SELECTOR + ', .jfmod-queueEmpty a');
        if (target) focusManager.focus(target);
    }, [layout, rows.length, viewsReady]);

    const href = (row: QueueRow) => row.entry ? '#' + getEntryPath(row.entry.id, serverId) : undefined;
    const rowProps = (row: QueueRow): RowProps => ({
        api, row, text: describeRow(row, list.generatedAt), isAdmin, showClient, href: href(row),
        stale: staleAll || row.state === 'unknown', onMenu
    });
    const seeding = rows.some(row => row.state === 'seeding');
    // Administrators only; an older plugin sends no automation block and the line stays away (P6.M8).
    const automation = isAdmin ? automationPausedText(list.automation?.pausedReasons) : null;

    let body: React.ReactNode;
    if (!rows.length) {
        // No clean deep link applies the File filter, so this opens Movies itself (P5.I8 report).
        body = <div className='jfmod-queueEmpty'>
            <p>Nothing downloading.</p>
            <LibraryLinks views={views} types={[CollectionType.Movies]} className='jfmod-queueLink' />
        </div>;
    } else if (layout === 'desktop') {
        body = <table className='jfmod-queueTable'>
            <thead><tr>
                <th><span className='jfmod-queueHidden'>Poster</span></th>
                <th>Title</th><th>Progress</th><th>Size</th><th>Speed</th><th>ETA</th><th>State</th>
                {showClient && <th>Client</th>}
                {isAdmin && <th><span className='jfmod-queueHidden'>Actions</span></th>}
            </tr></thead>
            <tbody>{rows.map(row => <TableRow key={row.id} {...rowProps(row)} />)}</tbody>
        </table>;
    } else if (layout === 'tv') {
        body = <div className='jfmod-queueList'>{rows.map(row => <TvRow key={row.id} {...rowProps(row)} />)}</div>;
    } else {
        body = <div className='jfmod-queueList'>{rows.map(row => <StackRow key={row.id} {...rowProps(row)} />)}</div>;
    }

    return <div className={'jfmod-queue jfmod-queue--' + layout} ref={container} onFocus={onFocus} onBlur={onBlur}>
        {!list.clientStatus.reachable && <p className='jfmod-queueBanner' role='status'>
            The download client cannot be reached. Showing the last known state.
        </p>}
        {automation && <p className={automation.quiet ? 'jfmod-queueNotice' : 'jfmod-queueBanner'} role='status'>
            {automation.text}
        </p>}
        {isAdmin && !list.importEnabled && <p className='jfmod-queueNotice'>
            Importing is turned off. Finished downloads wait here until it is turned on.
        </p>}
        {isAdmin && seeding && !list.seedReleaseEnabled && <p className='jfmod-queueNotice'>
            Automatic release of seeding copies is off.
        </p>}
        {body}
    </div>;
};

/** The UX §14 message: a clear sentence and a way back to the libraries, never a spinner. */
const QueueMessage: FC<{ text: string; views: BaseItemDto[]; viewsReady: boolean; layout: QueueLayout }> = ({ text, views, viewsReady, layout }) => {
    const root = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const target = layout === 'tv' && viewsReady ? root.current?.querySelector<HTMLElement>('a') : null;
        if (target) focusManager.focus(target);
    }, [layout, viewsReady]);
    return <div className='jfmod-queueEmpty' ref={root}>
        <p role='status'>{text}</p>
        <LibraryLinks views={views} types={[CollectionType.Movies, CollectionType.Tvshows]} className='jfmod-queueLink' />
    </div>;
};

const useQueueLayout = (): QueueLayout => {
    const narrow = useMediaQuery((theme: Theme) => theme.breakpoints.down('md'));
    if (layoutManager.tv) return 'tv';
    return layoutManager.mobile || narrow ? 'mobile' : 'desktop';
};

/** `/catalog/queue`: a monitor, not a torrent client (UX §10). */
const QueuePage: FC = () => {
    const { api, user, __legacyApiClient__ } = useApi();
    const isAdmin = !!user?.Policy?.IsAdministrator;
    const layout = useQueueLayout();
    const capability = useQueueCapability();
    const queue = useQueue({ enabled: capability.available, poll: true });
    const userViews = useUserViews({ userId: user?.Id });
    const views = userViews.data?.Items ?? [];
    const viewsReady = userViews.isSuccess || userViews.isError;
    const { refetch } = queue;
    const refresh = useCallback(() => {
        refetch().catch(() => undefined);
    }, [refetch]);

    let content: React.ReactNode;
    if (!capability.known) {
        content = <p className='jfmod-queueStatus' role='status'>Checking JellyfinMod…</p>;
    } else if (capability.pluginMissing) {
        content = <QueueMessage layout={layout} views={views} viewsReady={viewsReady}
            text='The download queue needs the JellyfinMod plugin, which is not available on this server.' />;
    } else if (!capability.available) {
        content = <QueueMessage layout={layout} views={views} viewsReady={viewsReady}
            text='This version of the JellyfinMod plugin has no download queue. Update the plugin to see downloads here.' />;
    } else if (queue.adminOnly) {
        content = <QueueMessage layout={layout} views={views} viewsReady={viewsReady}
            text='The download queue is not available to you. An administrator can make it visible to users.' />;
    } else if (queue.data && api) {
        content = <QueueContent api={api} list={queue.data} layout={layout} isAdmin={isAdmin}
            serverId={__legacyApiClient__?.serverId()} views={views} viewsReady={viewsReady} refetch={refresh} />;
    } else if (queue.isError) {
        content = <p className='jfmod-queueStatus' role='status'>The queue could not be loaded. Trying again every few seconds.</p>;
    } else {
        content = <p className='jfmod-queueStatus' role='status'>Loading the queue…</p>;
    }

    return <Page id='jfmodQueuePage' title='Queue' className='mainAnimatedPage libraryPage allLibraryPage noSecondaryNavPage'>
        <div className='padded-left padded-right padded-bottom-page jfmod-queuePage'>
            <h1 className='jfmod-queueHeading'>Queue</h1>
            {content}
        </div>
    </Page>;
};

export default QueuePage;
