import type { Api } from '@jellyfin/sdk/lib/api';
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import { CollectionType } from '@jellyfin/sdk/lib/generated-client/models/collection-type';
import type { Theme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import ListItemIcon from '@mui/material/ListItemIcon';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import classNames from 'classnames';
import React, { type FC, type FocusEvent, type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import focusManager from 'components/focusManager';
import layoutManager from 'components/layoutManager';
import Page from 'components/Page';
import { appRouter } from 'components/router/appRouter';
import { useUserViews } from 'hooks/api/useUserViews';
import { useApi } from 'hooks/useApi';

import {
    automationPausedText, downloadProgress, episodeCode, formatBytes, formatDuration, formatRate, type MarkProgress, packEpisodeProblems,
    progressPercent, QUEUE_STATE_LABEL, queueRowTitle, reasonMessage, seedingFacts, seedProgress, sortQueueRows, updatedAgo
} from '../constants/queue';
import { useQueue, useQueueCapability } from '../hooks/useQueue';
import DownloadStateMark, { type DownloadMarkLink, ringLink } from './DownloadStateMark';
import InfoPopover from './InfoPopover';
import { episodePath, seasonPath } from './MissingChildren';
import { openQueueRowMenu, queueRowActions, runQueueRowAction } from '../integration/queueActions';
import type { QueueList, QueueRow } from '../types/queue';
import { getEntryPath, getTmdbImage } from '../utils/entryLinks';

import './queue.scss';
import { raisedButtonClass } from '../utils/flatButton';

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

const versionOf = (row: QueueRow) => {
    // A pack adding or replacing held files says so; one filling missing episodes needs no words.
    if (row.pack?.mode === 'add') return 'Added beside the files held';
    if (row.pack?.mode === 'replace') return 'Replaces the files held';
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
        state: QUEUE_STATE_LABEL[row.state] ?? row.state,
        size: downloaded && size && row.state !== 'seeding' ? downloaded + ' of ' + size : size,
        speed: transferring ? formatRate(row.downloadRateBytes) : null,
        eta: transferring ? formatDuration(row.etaSeconds) : null
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

interface TitlePart {
    text: string;
    href?: string;
    key?: string;
}

const SEPARATOR: TitlePart = { text: ' · ' };

/**
 * The title as its parts, each a link to its own page (user, 2026-10-19): the series (or the movie) to its entry, `Season N` to
 * the season page and the episode to its page (the mod's routes, which open Jellyfin's own page once it has the episode). A
 * season pack names its season, a series pack only its series; the separators and a pack's count stay plain text.
 */
const titleParts = (row: QueueRow, serverId: string | undefined): TitlePart[] => partsOf(row, serverId)
    .map((part, index) => ({ ...part, key: 'part' + index }));

const partsOf = (row: QueueRow, serverId: string | undefined): TitlePart[] => {
    const entry = row.entry;
    if (!entry) return [{ text: row.releaseTitle }];
    const server = serverId ?? '';
    const series: TitlePart = { text: entry.year ? entry.title + ' (' + entry.year + ')' : entry.title, href: '#' + getEntryPath(entry.id, serverId) };
    const season = (number: number): TitlePart => ({ text: 'Season ' + number, href: '#' + seasonPath(entry.id, number, server) });
    if (row.pack) {
        const number = row.pack.scope === 'season' ? row.pack.episodes[0]?.seasonNumber : undefined;
        const named = number === undefined ? '' : 'Season ' + number;
        if (!named || !row.pack.label.startsWith(named + ' ')) return [series, SEPARATOR, { text: row.pack.label }];
        return [series, SEPARATOR, season(number!), { text: row.pack.label.slice(named.length) }];
    }
    if (!row.episode) return [series];
    const { seasonNumber, episodeNumber, title } = row.episode;
    return [series, SEPARATOR, season(seasonNumber), SEPARATOR, {
        text: episodeCode(seasonNumber, episodeNumber) + (title ? ' ' + title : ''),
        href: '#' + episodePath(entry.id, seasonNumber, episodeNumber, server)
    }];
};

/** Parsed title first (its parts linked where `linked`), the raw release title dimmed beneath and never hidden (UX §9 style). */
const TitleLines: FC<{ row: QueueRow; text: RowText; serverId?: string; linked: boolean }> = ({ row, text, serverId, linked }) => <>
    <span className='jfmod-queueTitle'>{linked ? titleParts(row, serverId).map(part => (part.href ?
        <a key={part.key} className='jfmod-queueTitleLink' href={part.href}>{part.text}</a> :
        <React.Fragment key={part.key}>{part.text}</React.Fragment>)) : text.title}</span>
    {text.version && <span className='jfmod-queueMuted'>{text.version}</span>}
    <span className='jfmod-queueRelease'>{row.releaseTitle}</span>
</>;

/**
 * The row's client, a link to its web page where the ring is one (`ringLink`'s rule: administrators, a saved Web interface
 * link, not the TV), else its name; the row menu no longer has Open in Client (user, 2026-10-19).
 */
const ClientName: FC<{ row: QueueRow; linked: boolean; className?: string }> = ({ row, linked, className }) => {
    const client = row.client;
    if (!client) return null;
    if (!linked || layoutManager.tv || !client.openUrl) return <span className={className}>{client.name}</span>;
    return <span className={className}><a className='jfmod-queueTitleLink' href={client.openUrl} target='_blank' rel='noopener noreferrer'
        title={'Open ' + client.name}>{client.name}</a></span>;
};

/** What a state disc says (P4.FU28): the state word, the figures after it, then one fact per line. */
interface StateTip {
    title: string;
    /** After the title on the tooltip's first line (`Seeding · ratio 0.19 of 1.00`); the popover's first line, capitalised. */
    summary: string | null;
    lines: string[];
    /** The summary only repeats the row's own figures (a download's percent, time and rate), so the TV's line leaves it out. */
    figures: boolean;
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** The tip of a row's disc: every detail the State column used to write beside it, worded once for the tooltip, popover and TV. */
const stateTipOf = (row: QueueRow, progress: MarkProgress, text: RowText): StateTip => {
    let tip: StateTip;
    if (row.state === 'seeding') {
        const facts = row.seeding ? seedingFacts(row.seeding) : { figures: null, lines: [] };
        tip = { title: text.state, summary: facts.figures, lines: facts.lines, figures: false };
    } else if (row.importState === 'held' || row.importState === 'submitting') {
        // A grab before the client has it (P4.FU10).
        tip = { title: QUEUE_STATE_LABEL.queued, figures: false, lines: [],
            summary: row.importState === 'held' ? 'waiting to be sent to the download client' : 'being sent to the download client' };
    } else if (row.state === 'blocked' || row.state === 'failed') {
        tip = { title: text.state, summary: reasonMessage(row.reason, row.message), lines: [], figures: false };
    } else if (progress.kind === 'importing') {
        // The import's own step (Linking into the library) says more than the family's word.
        tip = { title: text.state, summary: progress.stale ? 'last known' : null, lines: [], figures: true };
    } else {
        const split = progress.tooltip.indexOf(' · ');
        tip = split < 0 ? { title: progress.tooltip, summary: null, lines: [], figures: true } :
            { title: progress.tooltip.slice(0, split), summary: progress.tooltip.slice(split + 3), lines: [], figures: true };
    }
    // A pack's own episodes that were skipped or need attention, while its torrent reads otherwise.
    return { ...tip, lines: [...tip.lines, ...packEpisodeProblems(row)] };
};

/** The tooltip's lines: `Seeding · ratio 0.19 of 1.00 · seeded 4 d of 7 d`, then the facts, then the client a click opens. */
const tooltipLines = (tip: StateTip, link: DownloadMarkLink | null) => [tip.summary ? tip.title + ' · ' + tip.summary : tip.title,
    ...tip.lines, ...(link ? ['Open ' + link.name] : [])];

/** The popover's lines (the title is its heading). */
const popoverLines = (tip: StateTip) => [...(tip.summary ? [capitalise(tip.summary)] : []), ...tip.lines];

/** A row's disc and its tip: a seeding copy's or a download's (a failure is the red bang). */
const rowDisc = (row: QueueRow, text: RowText) => {
    const progress = row.state === 'seeding' ? seedProgress(row.seeding) : downloadProgress(row);
    const tip = stateTipOf(row, progress, text);
    return { progress, tip, link: ringLink([row], progress) };
};

/** The phone's popover for one row's disc: the row it is for and the disc that opened it. */
interface StateInfo {
    id: string;
    anchor: HTMLElement;
}

/**
 * The State column: the disc alone, every detail in its tip (P4.FU28, user-approved 2026-10-26). The computer shows the tip in a
 * tooltip above the disc, and an administrator's click opens the client (now for a seeding copy too); the phone's tap opens the
 * popover (state, facts, "Open <client>"), never the client directly; the TV row is one button, so its details stay a line under
 * the disc.
 */
const StateCell: FC<{ row: QueueRow; text: RowText; layout: QueueLayout; onInfo: (info: StateInfo) => void }> = ({ row, text, layout, onInfo }) => {
    const { progress, tip, link } = rowDisc(row, text);
    const lines = tooltipLines(tip, null);
    const name = lines.join('. ');
    const openInfo = useCallback((event: MouseEvent<HTMLButtonElement>) => onInfo({ id: row.id, anchor: event.currentTarget }), [onInfo, row.id]);
    if (layout === 'tv') {
        const detail = [...(tip.summary && !tip.figures ? [capitalise(tip.summary)] : []), ...tip.lines];
        return <>
            <span className='jfmod-queueState jfmod-queueState--disc'><DownloadStateMark progress={progress} size='row' title={name} /></span>
            {detail.map(line => <span key={line} className='jfmod-queueDetail'>{line}</span>)}
        </>;
    }
    if (layout === 'mobile') {
        return <button type='button' className='jfmod-queueState jfmod-queueState--disc jfmod-queueStateButton' aria-haspopup='dialog'
            aria-label={name} onClick={openInfo}>
            <DownloadStateMark progress={progress} size='row' title={name} hostTip />
        </button>;
    }
    // Every disc is a keyboard stop on the computer, so its tip shows on focus as on hover (Codex final review, 2026-10-26): a linked
    // disc is one itself (Enter opens the client), any other one through its wrapper.
    return <Tooltip placement='top' title={<>{tooltipLines(tip, link).map(line => <span key={line} className='jfmod-queueTipLine'>{line}</span>)}</>}>
        <span className={classNames('jfmod-queueState jfmod-queueState--disc', { 'jfmod-queueStateFocus': !link })}
            tabIndex={link ? undefined : 0}>
            <DownloadStateMark progress={progress} size='row' title={name} link={link} hostTip />
        </span>
    </Tooltip>;
};

const metaLine = (text: RowText) => [text.size, text.speed, text.eta ? text.eta + ' left' : null].filter(Boolean).join(' · ');

interface RowProps {
    api: Api;
    row: QueueRow;
    text: RowText;
    isAdmin: boolean;
    showClient: boolean;
    serverId?: string;
    /** The title's parts and the client are links (not inside the TV's row button). */
    linked: boolean;
    stale: boolean;
    layout: QueueLayout;
    /** The phone's tap on a disc. */
    onInfo: (info: StateInfo) => void;
    onMenu: (row: QueueRow, target: HTMLElement) => void;
    /** An item chosen in the desktop popover. */
    onPick: (row: QueueRow, id: string, target: HTMLElement) => void;
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

const PopoverItem: FC<{ item: { id: string; name: string; icon: string }; onPick: (id: string) => void }> = ({ item, onPick }) => {
    const pick = useCallback(() => onPick(item.id), [item.id, onPick]);
    return <MenuItem className='jfmod-queueMenuItem' onClick={pick} data-id={item.id}>
        <ListItemIcon className='jfmod-queueMenuIcon'><span className={'material-icons ' + item.icon} aria-hidden='true' /></ListItemIcon>
        {item.name}
    </MenuItem>;
};

/**
 * The desktop row menu (user 2026-10-19: "why menu mutes / darkens the whole page? it's menu"): a popover under the three dots,
 * MUI's Menu as the track dropdown's, with no dimming (its click-away layer is invisible), its items only, closing on a click
 * outside, Escape or a choice. The items and what they do are the action sheet's (`runQueueRowAction`).
 */
const PopoverMenuButton: FC<{ row: QueueRow; title: string; isAdmin: boolean; onPick: RowProps['onPick'] }> = ({ row, title, isAdmin, onPick }) => {
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const open = useCallback((event: MouseEvent<HTMLButtonElement>) => setAnchor(event.currentTarget), []);
    const close = useCallback(() => setAnchor(null), []);
    const pick = useCallback((id: string) => {
        const target = anchor;
        setAnchor(null);
        if (target) onPick(row, id, target);
    }, [anchor, onPick, row]);
    return <>
        <button type='button' className='paper-icon-button-light jfmod-queueMenu jfmod-queueFocus' title='Actions'
            aria-label={'Actions for ' + title} aria-haspopup='menu' aria-expanded={!!anchor} onClick={open}>
            <span className='material-icons more_vert' aria-hidden='true' />
        </button>
        <Menu anchorEl={anchor} open={!!anchor} onClose={close} className='jfmod-queueMenuPopover'
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            slotProps={{ paper: { className: 'jfmod-queueMenuPaper' }, list: { 'aria-label': 'Actions for ' + title } }}>
            {queueRowActions(row, isAdmin).map(item => <PopoverItem key={item.id} item={item} onPick={pick} />)}
        </Menu>
    </>;
};

const TableRow: FC<RowProps> = ({ api, row, text, isAdmin, showClient, serverId, linked, stale, layout, onInfo, onPick }) => <tr className='jfmod-queueTableRow'>
    <td className='jfmod-queueCellThumb'><Thumb api={api} row={row} /></td>
    <td className='jfmod-queueCellTitle'><TitleLines row={row} text={text} serverId={serverId} linked={linked} /></td>
    <td className='jfmod-queueCellProgress'><ProgressBar text={text} stale={stale} /></td>
    <td className='jfmod-queueCellNumber'>{text.size ?? '—'}</td>
    <td className='jfmod-queueCellNumber'>{text.speed ?? '—'}</td>
    <td className='jfmod-queueCellNumber'>{text.eta ?? '—'}</td>
    <td className='jfmod-queueCellState'><StateCell row={row} text={text} layout={layout} onInfo={onInfo} /></td>
    {showClient && <td className='jfmod-queueCellClient'>{row.client ? <ClientName row={row} linked={linked} /> : '—'}</td>}
    {isAdmin && <td className='jfmod-queueCellMenu'>
        {queueRowActions(row, isAdmin).length > 0 && <PopoverMenuButton row={row} title={text.title} isAdmin={isAdmin} onPick={onPick} />}
    </td>}
</tr>;

const RowBody: FC<Omit<RowProps, 'isAdmin' | 'onMenu' | 'onPick'>> = ({ api, row, text, showClient, serverId, linked, stale, layout, onInfo }) => <>
    <Thumb api={api} row={row} />
    <span className='jfmod-queueRowBody'>
        <TitleLines row={row} text={text} serverId={serverId} linked={linked} />
        <ProgressBar text={text} stale={stale} />
        {metaLine(text) && <span className='jfmod-queueMuted'>{metaLine(text)}</span>}
        <StateCell row={row} text={text} layout={layout} onInfo={onInfo} />
        {showClient && <ClientName row={row} linked={linked} className='jfmod-queueMuted' />}
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
        <RowBody {...props} linked={false} />
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
    if (!matching.length) return <a className={raisedButtonClass(className)} href='#/home'>Open Home</a>;
    return <>{matching.map(view => <a key={view.Id} className={raisedButtonClass(className)}
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
    /** The last refresh failed: the rows are the last ones read, at `updatedAt` (whole-review chunk 4a, P3 6). */
    refreshFailed: boolean;
    updatedAt: number;
}

const QueueContent: FC<ContentProps> = ({ api, list, layout, isAdmin, serverId, views, viewsReady, refetch, refreshFailed, updatedAt }) => {
    const container = useRef<HTMLDivElement>(null);
    const removal = useRef<{ id: string; index: number } | null>(null);
    // The row that last had focus, so focus can move to its neighbour when a poll removes it (whole-review chunk 4a, P3 7).
    const focusedRow = useRef<{ id: string; index: number } | null>(null);
    const sorted = useMemo(() => sortQueueRows(list.items), [list.items]);
    const [frozenOrder, setFrozenOrder] = useState<string[] | null>(null);
    const rows = useMemo(() => frozenOrder ? applyOrder(frozenOrder, sorted) : sorted, [frozenOrder, sorted]);
    const showClient = rows.some(row => row.client);
    const staleAll = !list.clientStatus.reachable || refreshFailed;

    // Polls re-render rows in place; the order is frozen while focus is inside and re-sorted when it leaves (P5.I8).
    const onFocus = useCallback((event: FocusEvent<HTMLElement>) => {
        setFrozenOrder(previous => previous ?? rows.map(row => row.id));
        const id = (event.target as HTMLElement).closest<HTMLElement>('[data-jfmod-queue-id]')?.dataset.jfmodQueueId;
        focusedRow.current = id ? { id, index: Math.max(0, rows.findIndex(row => row.id === id)) } : null;
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
    const onPick = useCallback((row: QueueRow, id: string, target: HTMLElement) => {
        void runQueueRowAction({ api, row, isAdmin, positionTo: target, onChanged }, id);
    }, [api, isAdmin, onChanged]);
    // The phone's popover follows its row through polls and closes when the row leaves.
    const [info, setInfo] = useState<StateInfo | null>(null);
    const closeInfo = useCallback(() => setInfo(null), []);
    const infoRow = info ? rows.find(row => row.id === info.id) : undefined;
    const infoDisc = infoRow ? rowDisc(infoRow, describeRow(infoRow, list.generatedAt)) : null;

    // Once a removed row has left the list, focus its neighbour (or the empty-state link) if focus fell out with it,
    // so a D-pad user is never thrown to the top of the page.
    useEffect(() => {
        const pending = removal.current ?? focusedRow.current;
        const root = container.current;
        if (!pending || !root || rows.some(row => row.id === pending.id)) return;
        removal.current = null;
        focusedRow.current = null;
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

    const rowProps = (row: QueueRow): RowProps => ({
        api, row, text: describeRow(row, list.generatedAt), isAdmin, showClient, serverId, linked: layout !== 'tv',
        stale: staleAll || row.state === 'unknown', layout, onInfo: setInfo, onMenu, onPick
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
        {refreshFailed && <p className='jfmod-queueBanner' role='status' data-jfmod-queue-refresh-failed=''>
            The queue could not be refreshed. Showing the state from {new Date(updatedAt).toLocaleTimeString()}; trying again.
        </p>}
        {!refreshFailed && !list.clientStatus.reachable && <p className='jfmod-queueBanner' role='status'>
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
        {layout === 'mobile' && <InfoPopover anchor={infoDisc ? info?.anchor ?? null : null} title={infoDisc?.tip.title ?? ''}
            message={infoDisc ? popoverLines(infoDisc.tip) : []} link={infoDisc?.link} onClose={closeInfo}
            row={info?.anchor.closest<HTMLElement>('.jfmod-queueRow')} />}
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
            serverId={__legacyApiClient__?.serverId()} views={views} viewsReady={viewsReady} refetch={refresh}
            refreshFailed={queue.isError} updatedAt={queue.dataUpdatedAt} />;
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
