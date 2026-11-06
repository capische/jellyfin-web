import React, { type FC, type MouseEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import layoutManager from 'components/layoutManager';
import toast from 'components/toast/toast';
import { useApi } from 'hooks/useApi';
import { queryClient } from 'utils/query/queryClient';

import { airDateLong, episodeMark } from '../constants/fileState';
import { actionErrorMessage, describeDownload, downloadProgress, type DownloadProgress, etaText, formatDuration, QUEUE_ROUTE,
    QUEUE_STATE_LABEL, reasonMessage } from '../constants/queue';
import { packEpisodeView, useQueueRowFor, useQueueVisible } from '../hooks/useQueue';
import { removeWithDialog } from '../integration/queueActions';
import { type EntryEpisode, FileState } from '../types/entry';
import type { QueueRow } from '../types/queue';
import { ringLink } from './DownloadStateMark';
import { formatSize, qualityText } from './ReleaseRowParts';

import { DownloadMark } from '../design/StateMark';
import { DesignMediaMarks } from '../design/MediaMarks';
import { Cloud, Clock, Icon } from '../design/Icon';
import { DlBlock } from '../design/DlBlock';

/**
 * The download block of a missing episode's page (P1.FU20, user-approved design 2026-10-13, `design/missing-episode-page-
 * download-block.html`): one panel where a downloaded episode's page has its Video / Audio / Subtitle selectors. The 4.236em ring
 * (the percent inside while it downloads or stalls), the state and its figures, the release name, its marks, size and indexer,
 * Open in the client for administrators, a pack's line with one dot per episode, a bar, and the actions. The still above carries
 * no mark: this block says it (user, 2026-10-13: "too much information"). Once the file is imported the page becomes Jellyfin's.
 */

type BlockKind = DownloadProgress['kind'] | 'none' | 'unaired';

/**
 * What the block is about: an episode, or a placeholder movie's entry (P1.FU27), whose `id` is null (the queue's movie rows
 * carry no episode).
 */
export type DownloadTarget = Pick<EntryEpisode, 'state' | 'progress' | 'availability' | 'airDate'> & { id: string | null };

interface DownloadBlockProps {
    entryId: string;
    episode: DownloadTarget;
    isAdmin: boolean;
    /** An administrator on a plugin that searches releases: Download and Search Again open the picker. */
    canAcquire: boolean;
    onGetRelease: (opener: HTMLElement) => void;
    /** The queue says the episode's import is over, or a download was removed: the page reads its entry again. */
    onChanged: () => void;
}

/** `3.1 MB/s`: one decimal, as the design writes it (the queue page keeps whole megabytes). */
const rateText = (bytes: number | null | undefined) => {
    if (!bytes) return null;
    if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB/s';
    return Math.max(1, Math.round(bytes / 1e3)) + ' kB/s';
};

/** `1.9 of 4.6 GB`, or each with its own unit when they differ. */
const sizePair = (done: number | null, total: number | null) => {
    if (total === null || done === null) return null;
    if (done >= 1e8 && total >= 1e8) return (done / 1e9).toFixed(1) + ' of ' + (total / 1e9).toFixed(1) + ' GB';
    return formatSize(done) + ' of ' + formatSize(total);
};

/** `in 12 days` under 30 days, else `in 7 months`; nothing once the date has come. */
const countdown = (airDate: string) => {
    const days = Math.ceil((Date.parse(airDate) - Date.now()) / 86400000);
    if (days <= 0 || !Number.isFinite(days)) return null;
    if (days < 30) return 'in ' + days + (days === 1 ? ' day' : ' days');
    const months = Math.max(1, Math.round(days / 30.44));
    return 'in ' + months + (months === 1 ? ' month' : ' months');
};

type Figure = { text: string; tone: 'plain' | 'muted' | 'error' } | null;

const IMPORT_STEPS = new Set(['identifying', 'linking', 'scanning']);

/** `42% · 12 min left · 3.1 MB/s · 1.9 of 4.6 GB`: the episode's own file for a pack's episode. */
const downloadingText = (view: QueueRow | undefined, progress: DownloadProgress) => [progress.percent + '%',
    view?.etaSeconds ? etaText(view.etaSeconds) : null, progress.stale ? null : rateText(view?.downloadRateBytes),
    sizePair(view?.downloadedBytes ?? null, view?.sizeBytes ?? null)].filter(Boolean).join(' · ');

/** `identifying the file…`, `linking into the library…`, `waiting for the library scan…`. */
const importingText = (view: QueueRow | undefined) => {
    const words = view && IMPORT_STEPS.has(view.state) ? QUEUE_STATE_LABEL[view.state] : QUEUE_STATE_LABEL.linking;
    return words.charAt(0).toLowerCase() + words.slice(1) + '…';
};

/** `no progress for 20 min`: how long the client has reported nothing new. */
const stalledText = (view: QueueRow | undefined) => {
    const since = view?.stalledSince ? formatDuration((Date.now() - Date.parse(view.stalledSince)) / 1000) : null;
    return since ? 'no progress for ' + since : 'no progress';
};

/** The figures after a download's state word, and their tone. */
const downloadFigure = (view: QueueRow | undefined, progress: DownloadProgress): Figure => {
    const stale = progress.stale ? ' · last known' : '';
    switch (progress.kind) {
        case 'downloading': return { tone: 'plain', text: downloadingText(view, progress) + stale };
        case 'stalled': return { tone: 'plain', text: progress.percent + '% · ' + stalledText(view) + stale };
        case 'importing': return { tone: 'plain', text: importingText(view) };
        case 'failed': return { tone: 'error', text: (view ? reasonMessage(view.reason, view.message) : null) ?? 'see the download queue' };
        default: return { tone: 'plain', text: 'waiting to start' + stale };
    }
};

/** The figures of an episode with nothing on its way: unaired with its date and countdown, or not downloaded. */
const restingFigure = (kind: BlockKind, episode: DownloadTarget): Figure => {
    if (kind === 'unaired' && episode.airDate) {
        return { tone: 'muted', text: ['airs ' + airDateLong(episode.airDate), countdown(episode.airDate)].filter(Boolean).join(' · ') };
    }
    return { tone: 'muted', text: 'no release chosen yet' };
};

const WORD: Record<BlockKind, string> = {
    downloading: 'Downloading', stalled: 'Stalled', queued: 'Queued', importing: 'Importing', failed: 'Failed',
    none: 'Not Downloaded', unaired: 'Unaired'
};

/** One dot of a pack's strip: imported, its file finished, downloading (filled to its percent), waiting or failed. */
const PackStrip: FC<{ row: QueueRow; episodeId: string | null }> = ({ row, episodeId }) => {
    const episodes = row.pack?.episodes ?? [];
    return <span className='packdots' aria-hidden='true'>
        {episodes.map(item => {
            const view = packEpisodeView(row, item.episodeId);
            const percent = Math.floor((view.progress ?? 0) * 100);
            let kind = 'waiting';
            let words = 'waiting';
            if (view.state === 'seeding') {
                kind = 'done';
                words = 'imported';
            } else if (view.state === 'failed' || view.state === 'blocked') {
                kind = 'failed';
                words = 'failed';
            } else if (view.state === 'identifying' || view.state === 'linking' || view.state === 'scanning') {
                kind = 'finished';
                words = 'importing';
            } else if (view.state === 'downloading' || view.state === 'stalled') {
                kind = 'part';
                words = 'downloading · ' + percent + '%';
            }
            let dotClass = kind;
            if (kind === 'done') dotClass = 'ok';
            if (kind === 'part') dotClass = 'dl';
            const style = kind === 'part' ? { background: `linear-gradient(90deg, currentcolor ${percent}%, var(--ring-track) ${percent}%)` } : undefined;
            return <i key={item.episodeId} className={dotClass} style={style}
                title={'Episode ' + item.episodeNumber + ' · ' + words} data-jfmod-dot={kind} data-jfmod-current={item.episodeId === episodeId || undefined} />;
        })}
    </span>;
};

/** The release's marks: quality and source, the codec and audio marks the picker draws, the languages, the size and the indexer. */
const Marks: FC<{ row: QueueRow; isAdmin: boolean }> = ({ row, isAdmin }) => {
    const parsed = row.parsed;
    const client = isAdmin && !layoutManager.tv && row.client?.openUrl ? row.client : null;
    const label = client ? 'Open ' + client.name : '';
    return <div className='mline'>
        {parsed && (parsed.resolution || parsed.source) && <span className='qual'>{qualityText(parsed)}</span>}
        {parsed && <span className='marks'><DesignMediaMarks parsed={parsed} /></span>}
        {!!parsed?.languages?.length && <span className='s' style={{ fontSize: '0.82em', fontWeight: 700, letterSpacing: '0.05em' }}>{parsed.languages.join(' · ')}</span>}
        {row.sizeBytes !== null && <span className='s'>{formatSize(row.sizeBytes)}</span>}
        {row.indexerName && <span className='s lnk' style={{ fontSize: '0.92em', fontWeight: 400 }}>{row.indexerName}</span>}
        {client && <a className='rb focusable' href={client.openUrl!} target='_blank' rel='noopener noreferrer' title={label} aria-label={label}><Icon name='client' /></a>}
    </div>;
};

/** The pack's line: `Season 1 pack · this episode is file 6 of 10` and the strip. */
const PackLine: FC<{ row: QueueRow; episodeId: string | null }> = ({ row, episodeId }) => {
    const episodes = row.pack?.episodes ?? [];
    const index = episodes.findIndex(item => item.episodeId === episodeId);
    if (!row.pack || index < 0) return null;
    const name = row.pack.label.split(' · ')[0];
    return <div className='pack'>
        <span>{name + ' · this episode is file ' + (index + 1) + ' of ' + episodes.length}</span>
        <PackStrip row={row} episodeId={episodeId} />
    </div>;
};

/** Where the block goes: its own node in upstream's detail section, before the (hidden) track selectors. */
const useSlot = (anchor: Element | null) => {
    const [node, setNode] = useState<HTMLElement | null>(null);
    useLayoutEffect(() => {
        const section = anchor?.closest('.page')?.querySelector('[data-ds-slot="download"]') ?? anchor?.closest('.detailSection');
        if (!anchor || !section) return;
        const slot = document.createElement('div');
        slot.className = 'jfmod-dlblockSlot';
        section.insertBefore(slot, section.hasAttribute('data-ds-slot') ? null : section.querySelector('.trackSelections') ?? section.firstChild);
        setNode(slot);
        return () => {
            slot.remove();
            setNode(null);
        };
    }, [anchor]);
    return node;
};

interface BlockState {
    kind: BlockKind;
    progress: DownloadProgress | null;
    /** The queue row whose release the block names; none for a projected state or a finished import. */
    row: QueueRow | null;
}

/**
 * What the block shows: the queue's row (a pack's episode's own file) while there is one, the projected state while the queue
 * cannot be read, else unaired or not downloaded. A finished import shows as importing only after its download was seen on this
 * visit (the page then becomes Jellyfin's); an old finished row for an episode with no file now is history.
 */
const blockState = (row: QueueRow | undefined, view: QueueRow | undefined, last: QueueRow | null, live: boolean,
    episode: DownloadTarget): BlockState => {
    const finished = view?.state === 'seeding';
    if (row && view && !finished) {
        const progress = downloadProgress(view, last);
        return { kind: progress.kind, progress, row };
    }
    if (finished && live) return { kind: 'importing', progress: describeDownload('importing', 100, false), row: null };
    if (episode.state === FileState.Grabbed || episode.state === FileState.Downloading) {
        const progress = typeof episode.progress === 'number' && episode.state === FileState.Downloading ?
            describeDownload('downloading', Math.floor(episode.progress), false) : describeDownload('queued', null, false);
        return { kind: progress.kind, progress, row: null };
    }
    return { kind: episodeMark(episode) === 'unaired' ? 'unaired' : 'none', progress: null, row: null };
};

const isWorking = (kind: BlockKind) => kind === 'queued' || kind === 'downloading' || kind === 'stalled' || kind === 'importing';
const isCancellable = (kind: BlockKind) => kind === 'queued' || kind === 'downloading' || kind === 'stalled';

const BlockIcon: FC<{ state: BlockState }> = ({ state }) => <DownloadMark progress={state.progress}
    kind={state.kind === 'none' ? 'not-downloaded' : state.kind} size='page' link={state.progress ? ringLink([state.row], state.progress) : null} />;

interface ActionsProps {
    state: BlockState;
    isAdmin: boolean;
    canAcquire: boolean;
    removing: boolean;
    onCancel: (event: MouseEvent<HTMLButtonElement>) => void;
    onGetRelease: (event: MouseEvent<HTMLButtonElement>) => void;
}

/** View Queue for everyone who may read the queue; Cancel Download and Search Again for administrators. */
const Actions: FC<ActionsProps> = ({ state, isAdmin, canAcquire, removing, onCancel, onGetRelease }) => {
    const { kind } = state;
    const queueVisible = useQueueVisible();
    const queue = queueVisible && (isWorking(kind) || kind === 'failed');
    const search = kind === 'failed' && canAcquire;
    // A grab being sent to the client can be neither cancelled nor removed until it answers (P4.FU10).
    const cancel = isAdmin && !!state.row && isCancellable(kind) && state.row.importState !== 'submitting';
    if (!queue && !search && !cancel) return null;
    return <div className='act'>
        {queue && <a className='lnk focusable' href={'#' + QUEUE_ROUTE}>View Queue</a>}
        {search && <button type='button' className='btn destroy focusable' onClick={onGetRelease}>
            Search Again
        </button>}
        {cancel && <button type='button' className='btn focusable' disabled={removing} onClick={onCancel}>
            <span>Cancel Download</span>
        </button>}
    </div>;
};

/** The release's lines under the state: its name, its marks and, for a pack still downloading, the pack's line. */
const ReleaseLines: FC<{ state: BlockState; episodeId: string | null; isAdmin: boolean }> = ({ state, episodeId, isAdmin }) => {
    const { row, kind } = state;
    if (!row) return null;
    return <>
        <div className='rls' title={row.releaseTitle}>{row.releaseTitle}</div>
        <Marks row={row} isAdmin={isAdmin} />
        {isCancellable(kind) && <PackLine row={row} episodeId={episodeId} />}
    </>;
};

const StateLine: FC<{ kind: BlockState['kind']; figure: ReturnType<typeof downloadFigure> }> = ({ kind, figure }) => <>
    {kind !== 'downloading' && <b style={kind === 'failed' ? { color: 'var(--err)' } : undefined}>{WORD[kind]}</b>}
    {figure && (kind === 'downloading' ? <b aria-label={'Downloading ' + figure.text}>{figure.text}</b> : <span className={kind === 'failed' ? 'figs fail' : 'q'}>{figure.text}</span>)}
</>;

const DownloadBlock: FC<DownloadBlockProps & { anchor: Element | null }> = ({ anchor, entryId, episode, isAdmin, canAcquire,
    onGetRelease, onChanged }) => {
    const { api } = useApi();
    const slot = useSlot(anchor);
    const inFlight = episode.state === FileState.Grabbed || episode.state === FileState.Downloading;
    // A download seen during this visit: the queue is read every 3 s, and its end opens Jellyfin's page.
    const [live, setLive] = useState(false);
    const row = useQueueRowFor(entryId, episode.id, true, inFlight || live ? true : 'slow');
    const view = row?.pack ? packEpisodeView(row, episode.id) : row;
    const last = useRef<QueueRow | null>(null);
    if (view && view.state !== 'unknown') last.current = view;
    const [removing, setRemoving] = useState(false);
    const state = blockState(row, view, last.current, live, episode);
    const page = anchor?.closest<HTMLElement>('.page');
    useLayoutEffect(() => {
        if (!page) return;
        page.dataset.jfmodDownloadState = state.kind;
        return () => {
            delete page.dataset.jfmodDownloadState;
        };
    }, [page, state.kind]);
    const working = isWorking(state.kind) && !!state.row;
    useEffect(() => {
        if (working) setLive(true);
    }, [working]);
    const finishedId = view?.state === 'seeding' ? view.id : null;
    const changed = useRef(onChanged);
    changed.current = onChanged;
    useEffect(() => {
        if (finishedId) changed.current();
    }, [finishedId]);

    const cancel = useCallback((event: MouseEvent<HTMLButtonElement>) => {
        const button = event.currentTarget;
        if (!api || !row || removing) return;
        const removed = () => {
            toast('Removed from the queue.');
            setLive(false);
            void queryClient.invalidateQueries({ predicate: query => query.queryKey[0] === 'JellyfinMod' && query.queryKey[3] === 'Queue' });
            changed.current();
        };
        // The removal dialog for the row's state (D120); a held grab is cancelled without it (P4.FU10).
        removeWithDialog(api, row, setRemoving).then(done => {
            if (done) removed();
        }, (error: unknown) => toast(actionErrorMessage(error, 'It could not be removed. Please try again.'))).finally(() => {
            setRemoving(false);
            if (button.isConnected) button.focus();
        });
    }, [api, removing, row]);
    const getRelease = useCallback((event: MouseEvent<HTMLButtonElement>) => onGetRelease(event.currentTarget), [onGetRelease]);

    if (!slot || state.kind === 'none' && canAcquire) return null;
    const { kind, progress } = state;
    const shownView = state.row ? view : undefined;
    const figure = progress ? downloadFigure(shownView, progress) : restingFigure(kind, episode);
    const bar = kind === 'downloading' || kind === 'stalled' || kind === 'importing';
    const filled = kind === 'importing' ? 100 : progress?.percent ?? 0;
    if (kind === 'none' || kind === 'unaired') {
        return createPortal(<div className='jfmod-titleStatusLine' data-jfmod-state={kind}>
            <span className='jfmod-statusGlyph'>{kind === 'unaired' ? <Clock /> : <Cloud />}</span>
            <b>{WORD[kind]}</b>{figure && <span className='jfmod-statusRest'>· {figure.text}</span>}
        </div>, slot);
    }
    return createPortal(<DlBlock kind={kind} mark={<BlockIcon state={state} />}
        state={<StateLine kind={kind} figure={figure} />}
        release={<ReleaseLines state={state} episodeId={episode.id} isAdmin={isAdmin} />}
        bar={bar && <div className={'br' + (kind === 'stalled' ? ' st' : '')}><i style={{ width: filled + '%' }} /></div>}
        actions={<Actions state={state} isAdmin={isAdmin} canAcquire={canAcquire} removing={removing} onCancel={cancel} onGetRelease={getRelease} />} />, slot);
};

export default DownloadBlock;
