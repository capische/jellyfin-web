import type { Api } from '@jellyfin/sdk/lib/api';
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import { CollectionType } from '@jellyfin/sdk/lib/generated-client/models/collection-type';
import React, { type FC, type FocusEvent, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import focusManager from 'components/focusManager';
import Page from 'components/Page';
import { appRouter } from 'components/router/appRouter';
import { useUserViews } from 'hooks/api/useUserViews';
import { useApi } from 'hooks/useApi';

import {
    asNewVersion, automationPausedText, downloadProgress, episodeCode, formatBytes, formatDuration, formatRate, isReplace, type MarkProgress,
    packEpisodeProblems, progressPercent, QUEUE_STATE_LABEL, queueRowTitle, reasonMessage, replacedWords, seedingFacts, seedProgress,
    sortQueueRows, updatedAgo
} from '../constants/queue';
import { useQueue, useQueueCapability } from '../hooks/useQueue';
import { type DownloadMarkLink, ringLink } from './DownloadStateMark';
import { DownloadMark as DownloadStateMark } from '../design/StateMark';
import InfoPopover from '../design/InfoPopover';
import { episodePath, seasonPath } from './MissingChildren';
import { openQueueRowMenu, queueRowActions } from '../integration/queueActions';
import type { QueueList, QueueRow } from '../types/queue';
import { getEntryPath, getTmdbImage } from '../utils/entryLinks';

import { DesignContext, Root } from '../design/Root';
import { Icon } from '../design/Icon';
import { QueueHead, QueueRowView } from '../design/Queue';

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
    // A Replace names what it removes (D13, worded as D11): `Replaces 1080p: 2160p Remux`.
    const lead = isReplace(row) ? 'Replaces ' + replacedWords(row).words : 'Another version';
    return lead + (row.versionLabel ? ': ' + row.versionLabel : '');
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

/** ds2.js P.queue: `12.4 of 29.6 GB`, or the state's own word while nothing is moving. */
const figuresOf = (row: QueueRow, text: RowText) => {
    const kind = downloadProgress(row).kind;
    if (kind === 'queued') return 'Queued';
    if (kind === 'importing') return 'Importing…';
    return text.size?.replace(/^(\S+) (\S+) of (\S+) \2$/, '$1 of $3 $2');
};

const thumbUrl = (api: Api, row: QueueRow) => {
    if (row.entry?.jellyfinItemId) {
        return api.basePath + '/Items/' + encodeURIComponent(row.entry.jellyfinItemId) + '/Images/Primary?fillHeight=180&quality=90';
    }
    return getTmdbImage(row.entry?.posterPath, 'w154');
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
    const series: TitlePart = { text: entry.title, href: '#' + getEntryPath(entry.id, serverId) };
    const season = (number: number): TitlePart => ({ text: 'Season ' + number, href: '#' + seasonPath(entry.id, number, server) });
    if (row.pack) {
        const number = row.pack.scope === 'season' ? row.pack.episodes[0]?.seasonNumber : undefined;
        const named = number === undefined ? '' : 'Season ' + number;
        if (!named || !row.pack.label.startsWith(named + ' ')) return [series, SEPARATOR, { text: row.pack.label }];
        return [series, SEPARATOR, season(number!), { text: row.pack.label.slice(named.length) }];
    }
    if (!row.episode) return [series];
    const { seasonNumber, episodeNumber } = row.episode;
    return [series, SEPARATOR, {
        text: episodeCode(seasonNumber, episodeNumber),
        href: '#' + episodePath(entry.id, seasonNumber, episodeNumber, server)
    }];
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
        // A new version's Replace adds its own line (`Replaces 1080p`, D12).
        const [first, ...more] = progress.tooltip.split('\n');
        const split = first.indexOf(' · ');
        tip = split < 0 ? { title: first, summary: null, lines: more, figures: true } :
            { title: first.slice(0, split), summary: first.slice(split + 3), lines: more, figures: true };
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
    const progress = row.state === 'seeding' ? seedProgress(row.seeding) : asNewVersion(downloadProgress(row), [row]);
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
    const name = tooltipLines(tip, link).join('\n');
    if (layout === 'mobile') {
        return <button type='button' className='rb focusable' aria-label={name} aria-haspopup='dialog'
            onClick={event => onInfo({ id: row.id, anchor: event.currentTarget })}>
            <DownloadStateMark progress={progress} size='row' title={name} hostTip />
        </button>;
    }
    return <span className='qdisc' tabIndex={layout === 'desktop' && !link ? 0 : undefined}>
        <DownloadStateMark progress={progress} size='row' title={name} link={link} hostTip />
        {layout === 'desktop' && <span className='qtip' role='tooltip'>{tooltipLines(tip, link).map(line => <React.Fragment key={line}>{line}<br /></React.Fragment>)}</span>}
    </span>;
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
    if (!matching.length) return <a className={'btn focusable ' + (className ?? '')} href='#/home'>Open Home</a>;
    return <>{matching.map(view => <a key={view.Id} className={'btn focusable ' + (className ?? '')}
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
        const targets = root.querySelectorAll<HTMLElement>(FOCUS_SELECTOR + ', .empty a');
        const target = targets[Math.min(pending.index, targets.length - 1)];
        if (target) focusManager.focus(target);
    }, [rows]);

    // TV: the first row (or the empty-state link) takes focus when the page opens (UX §13).
    const focusedOnce = useRef(false);
    useEffect(() => {
        if (layout !== 'tv' || focusedOnce.current || (!rows.length && !viewsReady)) return;
        focusedOnce.current = true;
        const target = container.current?.querySelector<HTMLElement>(FOCUS_SELECTOR + ', .empty a');
        if (target) focusManager.focus(target);
    }, [layout, rows.length, viewsReady]);

    const seeding = rows.some(row => row.state === 'seeding');
    // Administrators only; an older plugin sends no automation block and the line stays away (P6.M8).
    const automation = isAdmin ? automationPausedText(list.automation?.pausedReasons) : null;

    let body: React.ReactNode;
    if (!rows.length) {
        // No clean deep link applies the File filter, so this opens Movies itself (P5.I8 report).
        body = <div className='empty'>
            <h3>Nothing downloading</h3><p>Pick a release from a title’s page and it shows here while it downloads.</p>
            <LibraryLinks views={views} types={[CollectionType.Movies]} className='jfmod-queueLink' />
        </div>;
    } else {
        body = <><QueueHead />{rows.map(row => {
            const text = describeRow(row, list.generatedAt);
            const disc = rowDisc(row, text);
            const details = [...(disc.tip.summary && !disc.tip.figures ? [capitalise(disc.tip.summary)] : []), ...disc.tip.lines];
            return <QueueRowView key={row.id} id={row.id} image={thumbUrl(api, row)} tv={layout === 'tv'}
                open={target => onMenu(row, target)} title={layout === 'tv' ? titleParts(row, serverId).map(part => part.text).join('') : titleParts(row, serverId).map(part => part.href ?
                    <a key={part.key} className='focusable' href={part.href}>{part.text}</a> : <React.Fragment key={part.key}>{part.text}</React.Fragment>)}
                release={row.releaseTitle} version={text.version} progress={text.percent} stale={staleAll || row.state === 'unknown'}
                figures={<>{row.state === 'failed' || row.state === 'blocked' ? <span style={{ color: 'var(--err)' }}>{disc.tip.title}: {disc.tip.summary}</span> :
                    figuresOf(row, text)}
                {text.freshness && <> · {text.freshness}</>}</>} speed={text.speed} eta={text.eta}
                details={layout === 'tv' && details.length > 0 && <div className='qdetail'>{details.map(line => <React.Fragment key={line}>{line}<br /></React.Fragment>)}</div>}
                mark={<StateCell row={row} text={text} layout={layout} onInfo={setInfo} />}
                more={layout !== 'tv' && queueRowActions(row, isAdmin).length > 0 ? <button type='button' className='ib focusable jfmod-queueFocus'
                    title='More' aria-label={'Actions for ' + text.title} aria-haspopup='menu' onClick={event => onMenu(row, event.currentTarget)}><Icon name='more' /></button> :
                    <span className='ib' aria-hidden='true'><Icon name='more' /></span>} />;
        })}</>;
    }

    return <div className='queue' ref={container} onFocus={onFocus} onBlur={onBlur}>
        {refreshFailed && <p className='banner' role='status' data-jfmod-queue-refresh-failed=''>
            The queue could not be refreshed. Showing the state from {new Date(updatedAt).toLocaleTimeString()}; trying again.
        </p>}
        {!refreshFailed && !list.clientStatus.reachable && <p className='banner' role='status'>
            The download client cannot be reached. Showing the last known state.
        </p>}
        {automation && <p className={automation.quiet ? 'tags' : 'banner'} role='status'>
            {automation.text}
        </p>}
        {isAdmin && !list.importEnabled && <p className='tags'>
            Importing is turned off. Finished downloads wait here until it is turned on.
        </p>}
        {isAdmin && seeding && !list.seedReleaseEnabled && <p className='tags'>
            Automatic release of seeding copies is off.
        </p>}
        {body}
        {layout === 'mobile' && <InfoPopover anchor={infoDisc ? info?.anchor ?? null : null} title={infoDisc?.tip.title ?? ''}
            message={infoDisc ? popoverLines(infoDisc.tip) : []} link={infoDisc?.link} onClose={closeInfo}
            row={info?.anchor.closest<HTMLElement>('.qrow')} />}
    </div>;
};

/** The UX §14 message: a clear sentence and a way back to the libraries, never a spinner. */
const QueueMessage: FC<{ text: string; views: BaseItemDto[]; viewsReady: boolean; layout: QueueLayout }> = ({ text, views, viewsReady, layout }) => {
    const root = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const target = layout === 'tv' && viewsReady ? root.current?.querySelector<HTMLElement>('a') : null;
        if (target) focusManager.focus(target);
    }, [layout, viewsReady]);
    return <div className='empty' ref={root}>
        <p role='status'>{text}</p>
        <LibraryLinks views={views} types={[CollectionType.Movies, CollectionType.Tvshows]} className='jfmod-queueLink' />
    </div>;
};

const useQueueLayout = (): QueueLayout => {
    const device = useContext(DesignContext);
    if (device === 'tv') return 'tv';
    return device === 'phone' || device === 'tablet' ? 'mobile' : 'desktop';
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
        <div className='qwrap plain'>
            <h1 className='ptitle'>Queue</h1>
            {content}
        </div>
    </Page>;
};

const DesignQueuePage: FC = () => <Root><QueuePage /></Root>;
export default DesignQueuePage;
