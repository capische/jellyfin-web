import type { Api } from '@jellyfin/sdk/lib/api';
import Select, { type SelectChangeEvent } from '@mui/material/Select';
import { useQuery } from '@tanstack/react-query';
import classNames from 'classnames';
import escapeHtml from 'escape-html';
import React, { type FC, Fragment, type MouseEvent, type ReactNode, type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef,
    useState } from 'react';

import confirm from 'components/confirm/confirm';
import focusManager from 'components/focusManager';
import layoutManager from 'components/layoutManager';
import { useApi } from 'hooks/useApi';

import { cancelGrab, getGrab, getQualityProfiles, getQueue, getReleaseProgress, getSourceIndexers, grabRelease, type ReleaseQuery,
    searchReleases } from '../api/modApi';
import { downloadProgress, type DownloadProgress } from '../constants/queue';
import { ADD_VERSION_UNAVAILABLE } from '../constants/versions';
import { PACKS_CAPABILITY, usePluginCapabilities } from '../hooks/useAcquisition';
import { removeWithDialog } from '../integration/queueActions';
import { profileSummary } from '../settings/qualityProfiles';
import type { GrabMode, GrabOperation, IndexerOutcome, IndexerProgress, ReleaseCandidate, ReleaseIntent, ReleaseProgress, ReleaseSearch } from '../types/acquisition';
import type { QueueRow } from '../types/queue';

import { type DetailOption, detailLabelOf, detailMenuItems } from './detailOptions';
import EmbySelect, { type EmbySelectOption } from './EmbySelect';
import DownloadStateMark, { type DownloadMarkLink, ringLink } from './DownloadStateMark';
import { AddGlyph, IndexerLink, qualityText, ReleaseLines, RemoveGlyph, ReplaceGlyph } from './ReleaseRowParts';
import { SearchBlock, type SearchLine } from './ReleaseSearchBlock';
import { ReleaseSources, type SourceLine, type TrainLine, useTrain } from './ReleaseSources';
import { flatButtonClass } from '../utils/flatButton';

import './interFont.scss';
import './downloadProgress.scss';
import './releasePicker.scss';

export interface ReleasePickerEpisode {
    id: string;
    /** `S01E02 · Name`, with `(on disk)` or `(unaired)` where it applies. */
    label: string;
    seasonNumber: number;
    episodeNumber: number;
    title: string;
    unaired: boolean;
}

export interface ReleasePickerProps {
    api: Api;
    entryId: string;
    mediaType: 'movie' | 'series';
    episodes: ReleasePickerEpisode[];
    initialEpisodeId?: string;
    /**
     * Opened from an episode's own page: the scope switch offers that episode, its season and All Seasons. Otherwise a series
     * page's switch offers All Seasons and each season, no episodes (user, 2026-10-12).
     */
    episodePage?: boolean;
    /** Opened from this season's own page: the scope switch offers the season, preselected, and All Seasons; no episodes. */
    seasonPage?: number;
    /** `addVersion` searches for another version beside the held file (P6.M6, opened by Get another quality). */
    intent?: ReleaseIntent;
    /**
     * Loads the series' full season and episode list when its entry has only the episodes in the library (P1.FU); the scope
     * switch says so while it loads, searches wait for it, and a failure keeps the episodes given.
     */
    loadEpisodes?: () => Promise<ReleasePickerEpisode[]>;
    /** Called after a grab reaches a final state, so the opener can refresh history and summaries. */
    onChanged?: () => void;
    /** The title row's place for the Sources icon (P4.FU25); without it the picker has no Sources. */
    sourcesSlot?: HTMLElement;
}

const GRAB_REASONS = new Map([
    ['acquisition_disabled', 'Grabbing is turned off in the plugin settings.'],
    ['grab_active', 'This title already has an active grab.'],
    ['no_verified_indexer', 'No verified indexer is enabled.'],
    ['no_download_client', 'No download client is selected.'],
    ['download_client_disabled', 'The download client is turned off.'],
    ['download_client_unverified', 'The download client has not been tested since it changed.'],
    ['download_client_driver_missing', 'This download client is not supported.'],
    ['no_default_profile', 'No default quality profile is selected.']
]);
/** Grab refusals of a pack, by ProblemDetails `type`; others keep the server's title (season packs, 2026-10-08). */
const PACK_GRAB_REFUSALS = new Map([
    ['nothing_to_fill', 'Every episode this pack covers already has a file. Use Add or Replace.'],
    ['episode_replace_disabled', 'Replace needs “Upgrade episodes and allow Replace” turned on in Settings › Automation. Add keeps both files.'],
    ['no_covered_episodes', 'This season has no aired episodes to search for.']
]);
const FINAL_STATES = new Set(['accepted', 'failed', 'unknown', 'cancelled']);

const isFinal = (operation: GrabOperation | null) => !!operation && FINAL_STATES.has(operation.state);

/** Reads the plugin's problem details, which are written for people and never carry a credential. */
const problemOf = (error: unknown, fallback: string) => {
    const data = (error as { response?: { data?: { type?: unknown; title?: unknown; operationId?: unknown } } })?.response?.data;
    // Another-version refusals (409) get the fork's own sentence; the rest keep the server's title.
    const type = typeof data?.type === 'string' ? data.type : '';
    const known = ADD_VERSION_UNAVAILABLE.get(type) ?? PACK_GRAB_REFUSALS.get(type);
    return {
        title: known ?? (typeof data?.title === 'string' ? data.title : fallback),
        operationId: typeof data?.operationId === 'string' ? data.operationId : null
    };
};

// An idempotency key only has to be unique per grab attempt, and a progress key per search; neither is a secret.
// eslint-disable-next-line sonarjs/pseudo-random
const newKey = (prefix = 'grab') => prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);

const failed = (outcome: IndexerOutcome) => outcome.status !== 'ok' && outcome.status !== 'no_results';

/** The clock time (24 h, the viewer's locale) a wait of `seconds` from `receivedAt` ends. */
const clockTime = (receivedAt: number, seconds: number) =>
    new Date((receivedAt || Date.now()) + seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

/**
 * When every indexer failed and none returned a row, the search found nothing because nothing answered (rate limits, an
 * open breaker): `No indexer answered · try again at 16:05` from the longest wait, else `try again later`. Null when any
 * indexer answered. Never "No releases found" here (release picker design, 2026-10-10).
 */
const unavailableText = (search: ReleaseSearch | undefined, receivedAt: number): string | null => {
    if (!search || search.candidates.length > 0 || search.indexers.length === 0 || !search.indexers.every(failed)) return null;
    const wait = Math.max(0, ...search.indexers.map(outcome => outcome.retryAfterSeconds ?? 0));
    return 'No indexer answered · try ' + (wait > 0 ? 'again at ' + clockTime(receivedAt, wait) : 'again later');
};

const answeredCount = (search: ReleaseSearch) => search.indexers.filter(outcome => !failed(outcome)).length;

/** Why an indexer gave nothing, in the picker's words (Sentence case). `base` is when the wait began. */
const failureText = (status: string, retry: number | null, base: number) => {
    switch (status) {
        case 'timeout': return 'timed out';
        case 'rate_limited': return retry ? 'rate limited · retry ' + clockTime(base, retry) : 'rate limited';
        case 'breaker_open': return retry ? 'paused until ' + clockTime(base, retry) : 'paused';
        case 'budget_exhausted': return 'daily budget used up';
        case 'secret_unavailable': return 'no API key';
        case 'unsupported_search':
        case 'unsupported_request':
        case 'capabilities_unavailable': return 'cannot search this';
        // Not reached, an HTTP error or a cut-off answer: the plugin uses one code for all three.
        case 'unavailable': return 'unavailable';
        case 'auth_failed': return 'login refused';
        case 'indexer_error': return 'indexer error';
        case 'malformed_response':
        case 'response_too_large':
        case 'redirect_rejected': return 'bad answer';
        case 'source_changed': return 'try again';
        default: return 'error';
    }
};

const releaseCount = (count: number) => count + (count === 1 ? ' release' : ' releases');

/** One indexer's line while its search runs, from the plugin's progress. */
const progressLine = (line: IndexerProgress, now: number, base: number): SearchLine => {
    const id = line.indexerId;
    const { name, colorIndex } = line;
    if (line.state === 'queued') return { id, name, colorIndex, kind: 'waiting', text: 'waiting' };
    if (line.state === 'verifying' || line.state === 'asking') {
        const seconds = line.startedAt ? Math.max(0, Math.floor((now - Date.parse(line.startedAt)) / 1000)) : null;
        return { id, name, colorIndex, kind: 'asking', text: 'asking…' + (seconds === null ? '' : ' ' + seconds + ' s') };
    }
    if (line.state === 'ok') return { id, name, colorIndex, kind: 'ok', text: releaseCount(line.resultCount) };
    if (line.state === 'no_results') return { id, name, colorIndex, kind: 'none', text: 'nothing' };
    return { id, name, colorIndex, kind: 'failed', text: failureText(line.state, line.retryAfterSeconds, base) };
};

/** One indexer's line once the search is over, from its outcome. */
const outcomeLine = (outcome: IndexerOutcome, base: number): SearchLine => {
    const id = outcome.indexerId;
    const { name, colorIndex } = outcome;
    if (outcome.status === 'ok') return { id, name, colorIndex, kind: 'ok', text: releaseCount(outcome.resultCount) };
    if (outcome.status === 'no_results') return { id, name, colorIndex, kind: 'none', text: 'nothing' };
    return { id, name, colorIndex, kind: 'failed', text: failureText(outcome.status, outcome.retryAfterSeconds, base), message: outcome.message };
};

/**
 * Reads what each indexer is doing while a search runs: the page's fresh key per search, polled about once a second (one read
 * at a time; no AbortController, older webOS engines lack it). A plugin without progress answers 404 and the block keeps its
 * first look. Also counts the seconds the search has taken.
 */
const useSearchProgress = (api: Api, key: string | null, active: boolean) => {
    const [progress, setProgress] = useState<ReleaseProgress | null>(null);
    const [now, setNow] = useState(() => Date.now());
    const started = useRef(Date.now());
    useEffect(() => {
        setProgress(null);
        started.current = Date.now();
        setNow(started.current);
        if (!active || !key) return;
        let reading = false;
        let stopped = false;
        const read = () => {
            if (reading) return;
            reading = true;
            getReleaseProgress(api, key).then(next => {
                if (!stopped && next) setProgress(next);
            }).catch(() => { /* The next tick asks again. */ }).finally(() => {
                reading = false;
            });
        };
        const first = window.setTimeout(read, 250);
        const timer = window.setInterval(() => {
            setNow(Date.now());
            read();
        }, 1000);
        return () => {
            stopped = true;
            window.clearTimeout(first);
            window.clearInterval(timer);
        };
    }, [api, key, active]);
    return { progress, now, startedAt: started.current };
};

interface SearchBlockInput {
    searching: boolean;
    nothingFound: boolean;
    data: ReleaseSearch | undefined;
    progress: ReleaseProgress | null;
    now: number;
    startedAt: number;
    unavailable: string | null;
    receivedAt: number;
}

/** What the search block shows: a running search with its progress, or a finished one with no rows (quiet, or every indexer down). */
const searchBlockOf = (input: SearchBlockInput): { mode: 'searching' | 'quiet' | 'error'; caption: string; lines: SearchLine[] } | null => {
    if (input.searching) {
        const lines = (input.progress?.indexers ?? []).map(line => progressLine(line, input.now, input.startedAt));
        const seconds = Math.max(0, Math.floor((input.now - input.startedAt) / 1000));
        const noun = lines.length === 1 ? ' indexer' : ' indexers';
        const what = lines.length > 0 ? 'Searching ' + lines.length + noun : 'Searching';
        return { mode: 'searching', lines, caption: what + ' · ' + seconds + ' s' };
    }
    if (!input.nothingFound || !input.data) return null;
    const lines = input.data.indexers.map(outcome => outcomeLine(outcome, input.receivedAt));
    return input.unavailable ? { mode: 'error', caption: input.unavailable, lines } : { mode: 'quiet', caption: 'No releases found', lines };
};

interface SearchViewInput {
    progress: ReleaseProgress | null;
    now: number;
    startedAt: number;
    /**
     * While the rows so far of a running search are shown (P4.FU24), what the live region says about them (`32 releases so far`,
     * and a grab's error); they take the block's place. Null otherwise.
     */
    early: string | null;
    fetching: boolean;
    waiting: string;
    error: string;
    data: ReleaseSearch | undefined;
    unavailable: string | null;
    receivedAt: number;
    status: ReactNode;
    grabError: string;
}

/**
 * The search block while a search runs (over the old rows when it replaces a list) and where a finished one has no rows. The
 * block draws its own caption, so the status line then only tells screen readers: once at the start, once at the end. Once any
 * indexer has rows, they replace the block and the status line says how many so far and who is still asked (P4.FU24).
 */
const searchView = (input: SearchViewInput) => {
    const { progress, now, startedAt } = input;
    const hasRows = (input.data?.candidates.length ?? 0) > 0;
    const searching = input.fetching && !input.waiting;
    const nothingFound = !searching && !input.waiting && !input.error && !!input.data && !hasRows;
    const block = input.early !== null ? null : searchBlockOf({ searching, nothingFound, data: input.data, progress, now, startedAt,
        unavailable: input.unavailable, receivedAt: input.receivedAt });
    // With no rows the block is the whole list area: it draws the caption itself, and the notice and status lines give way to it
    // (the mock shows none of them), so the status line only tells screen readers, once at the start and once at the end.
    const bare = !!block && !hasRows && !input.grabError;
    // The visible line changes with every poll, so it stays hidden from screen readers while indexers are asked; the count so
    // far and an early grab's error are said instead (P4.FU24 review).
    let spoken: ReactNode = '';
    if (input.early !== null) spoken = input.early;
    else if (searching) spoken = 'Searching indexers';
    else if (bare) spoken = input.status;
    return { block, hasRows, bare, spoken, shown: bare ? '' : input.status, searching };
};

const STILL_ASKING = new Set(['queued', 'verifying', 'asking']);

/**
 * The status line while a running search shows the rows so far (P4.FU24): `32 releases so far · waiting for RU. RuTracker.org,
 * UA. utp.to` with the indexers still asked in the asking light blue. Text only; the Sources control carries the progress.
 */
const EarlyStatus: FC<{ count: number; progress: ReleaseProgress | null; notes: string; hidden: ReadonlySet<string> }> =
    ({ count, progress, notes, hidden }) => {
        // An unticked source's search goes on, but it is not waited for (P4.FU25).
        const asking = (progress?.indexers ?? []).filter(line => STILL_ASKING.has(line.state) && !hidden.has(line.indexerId))
            .map(line => line.name);
        return <>
            {releaseCount(count)} so far
            {asking.length > 0 && <> · waiting for <span className='jfmod-releaseStatus-asking'>{asking.join(', ')}</span></>}
            {notes && ' · ' + notes}
        </>;
    };

/**
 * The finished status line. `search` carries the counts of the rows shown (the ticked sources'); how many sources are ticked is the
 * Sources icon's grey dot, not a part of this line (user, 2026-10-26).
 */
const statusText = (search: ReleaseSearch | undefined, waiting: string, loading: boolean, error: string, unavailable: string | null) => {
    if (waiting) return waiting;
    // A search in progress shows its block; the status line only says it started, for screen readers.
    if (loading) return '';
    if (error) return error;
    if (!search) return '';
    let text = `${search.eligibleCount} ${search.eligibleCount === 1 ? 'release' : 'releases'}`;
    if (search.eligibleCount === 0) {
        text = search.rejectedCount === 0 ? unavailable ?? 'No releases found' : 'No release passes the profile';
    } else if (search.indexers.length > 0) {
        text += ` · ${answeredCount(search)} of ${search.indexers.length} indexers answered`;
    }
    if (search.truncated) text += ' · more results exist than were read';
    if (!search.grab.available && search.grab.reason) text += ' · ' + (GRAB_REASONS.get(search.grab.reason) ?? 'Grabbing is unavailable.');
    return text;
};

const seasonCode = (season: number) => 'S' + (season < 10 ? '0' : '') + season;

/**
 * What a pack row covers (season packs, 2026-10-08): `Season 2 · 8 episodes`, `Seasons 1–3 · 24 episodes`, or
 * `Complete · S01–S05` (the seasons of the searched episodes when the release names none). Null for a row that is no pack.
 */
const coverageText = (candidate: ReleaseCandidate, search: ReleaseSearch | undefined): string | null => {
    const coverage = candidate.coverage;
    if (!coverage) return null;
    const count = coverage.missing + coverage.held;
    const episodes = count + (count === 1 ? ' episode' : ' episodes');
    const seasons = [...coverage.seasons].sort((a, b) => a - b);
    if (coverage.complete || seasons.length === 0) {
        const searched = (search?.target.covered ?? []).map(episode => episode.seasonNumber);
        if (searched.length === 0) return 'Complete';
        const first = Math.min(...searched);
        const last = Math.max(...searched);
        return 'Complete · ' + seasonCode(first) + (last > first ? '–' + seasonCode(last) : '');
    }
    if (seasons.length === 1) return 'Season ' + seasons[0] + ' · ' + episodes;
    return 'Seasons ' + seasons[0] + '–' + seasons[seasons.length - 1] + ' · ' + episodes;
};

/**
 * The added row (user, 2026-10-12, §1): the tick takes the Add slot and the X the Replace slot. While the grab is held or being
 * sent, Add shows the falling arrow and the X cancels at once; once the client has the torrent, Add is a green tick and the X
 * removes it from the download queue after a question, for administrators only.
 */
interface AddedRow {
    accepted: boolean;
    x: 'cancel' | 'remove' | null;
    /** A cancel or removal is under way, or the queue row is not read yet. */
    xOff: boolean;
    onX: () => void;
    progress: DownloadProgress | null;
    /** The download client the ring opens (administrators only, `ringLink`). */
    link?: DownloadMarkLink | null;
}

// The figure shares its words and colours with the rows' meta lines (downloadProgress.scss, P4.FU1/P4.FU6); no bar (rows are
// ring only, the disc takes the Add slot).
const ProgressFigure: FC<{ progress: DownloadProgress }> = ({ progress }) =>
    <span className={classNames('jfmod-addedFigure jfmod-dlMeta', 'jfmod-dlMeta--' + progress.kind, { 'jfmod-dlMeta--stale': progress.stale })}
        title={progress.tooltip} aria-live='off'>{progress.text}</span>;

const RowLines: FC<{ candidate: ReleaseCandidate; search: ReleaseSearch | undefined; added?: AddedRow | null; reasons?: ReactNode }> =
    ({ candidate, search, added, reasons }) =>
        <ReleaseLines candidate={candidate} coverage={coverageText(candidate, search)} reasons={reasons}
            progress={added?.progress ? <ProgressFigure progress={added.progress} /> : undefined} />;

/**
 * How a row grabs (user decision 2, 2026-10-08). `first` is what Enter or a click on the row does: fill where the scope holds
 * nothing, add where it holds files; undefined sends no mode, as before packs. `choices` is true where the scope holds files:
 * the row then ends with Add, and with Replace where the search offers it (only while “Upgrade episodes and allow Replace” is on,
 * user 2026-10-09). `held` counts the episodes whose files Replace would remove, or a movie's files.
 */
interface RowPlan {
    first: GrabMode | undefined;
    choices: boolean;
    /** Replace follows Add; false while “Upgrade episodes and allow Replace” is off. */
    replace: boolean;
    held: number;
    /** A pack row: Replace names how many episodes, not "this episode". */
    pack: boolean;
}

const PLAIN_ROW: RowPlan = { first: undefined, choices: false, replace: false, held: 0, pack: false };

/** A row action: upstream's round icon button, grey, red when it destroys, with the TV's focus ring (user rules, 2026-10-08). */
const actionClass = (extra?: string, state: ActionState = 'idle') => classNames('paper-icon-button-light jfmod-releaseAction', extra,
    state !== 'idle' && 'jfmod-releaseAction--' + state, { 'show-focus': layoutManager.tv });

/** Where a row's Add or Replace is in a grab: the glyph works, ticks (stays) or shows a bang for three seconds. */
type ActionState = 'idle' | 'working' | 'done' | 'failed';

const ACTION_SUFFIXES = new Map<ActionState, string>([['done', ' — In the Download Queue'], ['failed', ' — Failed']]);

const actionTitle = (base: string, state: ActionState) => base + (ACTION_SUFFIXES.get(state) ?? '');

interface ReleaseRowProps {
    candidate: ReleaseCandidate;
    search: ReleaseSearch | undefined;
    disabled: boolean;
    plan: RowPlan;
    onGrab: (candidate: ReleaseCandidate, mode: GrabMode | undefined, plan: RowPlan) => void;
    actionState: (releaseId: string, mode: 'add' | 'replace') => ActionState;
    /** Set on the row whose grab is held, being sent or in the client. */
    added?: AddedRow | null;
    /** A late indexer's row, just slotted in: the arrival mark fades over two seconds (P4.FU24). */
    arrived?: boolean;
}

/** The added row's two slots: the decorative arrow or tick (no stop), then the X where there is one. */
const AddedActions: FC<{ candidate: ReleaseCandidate; added: AddedRow }> = ({ candidate, added }) => {
    const { x, onX } = added;
    const press = useCallback((event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        onX();
    }, [onX]);
    // The Add slot stays the same button element, so the D-pad does not lose its place; it is no stop now (the X takes focus).
    // While the torrent downloads it holds the download disc (P4.FU6); the green tick once the queue cannot be read.
    const progress = added.accepted ? added.progress : null;
    let state: ActionState = added.accepted ? 'done' : 'working';
    if (progress) state = 'idle';
    let title = added.accepted ? 'In the Download Queue' : 'Adding…';
    if (progress) title = progress.tooltip;
    return <span className='jfmod-releaseActions jfmod-releaseActions--pressed'>
        <button type='button' className={actionClass(classNames('jfmod-releaseAction--add', { 'jfmod-releaseAction--dl': !!progress }), state)}
            title={title} aria-hidden='true' tabIndex={-1} data-jfmod-release-add={candidate.releaseId}>
            {progress ? <DownloadStateMark progress={progress} size='row' link={added.link} /> : <AddGlyph />}
        </button>
        {x && <button type='button' className={actionClass('jfmod-releaseAction--danger jfmod-releaseAction--x')}
            title={x === 'cancel' ? 'Cancel' : 'Remove from Queue'}
            aria-label={x === 'cancel' ? 'Cancel adding ' + candidate.rawTitle : 'Remove ' + candidate.rawTitle + ' from the download queue'}
            aria-disabled={added.xOff} data-jfmod-release-x={candidate.releaseId} onClick={press}>
            <RemoveGlyph />
        </button>}
    </span>;
};

/** Add, and Replace where the row offers it: each its own D-pad stop. A rejected row's actions ask first, so they say so. */
const RowActions: FC<ReleaseRowProps & { rejected: boolean }> = ({ candidate, disabled, plan, onGrab, actionState, rejected, added }) => {
    const off = disabled || !!candidate.heldQuality;
    const add = useCallback((event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        onGrab(candidate, plan.choices ? 'add' : plan.first, plan);
    }, [candidate, onGrab, plan]);
    const replace = useCallback((event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        onGrab(candidate, 'replace', plan);
    }, [candidate, onGrab, plan]);
    if (added) return <AddedActions candidate={candidate} added={added} />;
    // A held quality has no actions, but keeps their room so the columns do not drift.
    if (candidate.heldQuality) return <span className='jfmod-releaseActions jfmod-releaseActions--empty' />;
    const addState = actionState(candidate.releaseId, 'add');
    const replaceState = actionState(candidate.releaseId, 'replace');
    const showReplace = plan.choices && plan.replace;
    let addLabel = 'Add ' + candidate.rawTitle;
    if (rejected) addLabel = 'Add the rejected release ' + candidate.rawTitle;
    else if (plan.choices) addLabel += ' beside the files held';
    return <span className={classNames('jfmod-releaseActions', { 'jfmod-releaseActions--pressed': addState !== 'idle' || replaceState !== 'idle' })}>
        <button type='button' className={actionClass('jfmod-releaseAction--add', addState)} title={actionTitle('Add', addState)}
            aria-label={addLabel}
            aria-disabled={off} data-jfmod-release-add={candidate.releaseId} onClick={add}>
            <AddGlyph />
        </button>
        {showReplace ? <button type='button' className={actionClass('jfmod-releaseAction--replace', replaceState)}
            title={actionTitle(plan.held > 1 ? `Replace ${plan.held} Files` : 'Replace File', replaceState)}
            aria-label={'Replace the files held with ' + (rejected ? 'the rejected release ' : '') + candidate.rawTitle} aria-disabled={off}
            data-jfmod-release-replace={candidate.releaseId} onClick={replace}>
            <ReplaceGlyph />
        </button> : null}
    </span>;
};

const addedLabel = (added: AddedRow | null | undefined) => {
    if (!added) return '';
    return ', added' + (added.progress ? ', ' + added.progress.tooltip : '');
};

const rowLabel = (candidate: ReleaseCandidate, added?: AddedRow | null) => qualityText(candidate.parsed)
    + (candidate.heldQuality ? ', in library' : '') + addedLabel(added)
    + (candidate.eligible ? '' : ', rejected: ' + candidate.rejections.map(rejection => rejection.message).join(' '));

/**
 * One eligible release: the row is a button that grabs with the first action; where the scope holds files, Add and Replace
 * follow it as sibling icon buttons, each its own D-pad stop (no nested buttons). A quality already in the library stays
 * focusable for reading, but cannot be grabbed: the server would answer 409 `held_quality` (P6.M6).
 */
const ReleaseRow: FC<ReleaseRowProps> = props => {
    const { candidate, search, disabled, plan, onGrab, added, arrived } = props;
    // The added row is never dimmed: it is the one the grab is about.
    const off = !added && (disabled || !!candidate.heldQuality);
    const activate = useCallback(() => onGrab(candidate, plan.first, plan), [candidate, onGrab, plan]);
    return <div className={classNames('jfmod-releaseItem', { 'jfmod-releaseItem--added': !!added, 'jfmod-releaseItem--arrived': arrived })}>
        <button type='button' className='jfmod-releaseRow' aria-disabled={off} aria-label={rowLabel(candidate, added)}
            data-jfmod-release-row={candidate.releaseId} onClick={activate}>
            <RowLines candidate={candidate} search={search} added={added} />
        </button>
        <RowActions {...props} rejected={false} />
        <IndexerLink candidate={candidate} />
    </div>;
};

/**
 * A rejected release (user, 2026-10-10: a rejection is soft, the choice is the person's). The row itself only reads, so a
 * stray Enter never grabs it; Add, and Replace where the row offers it, follow as their own D-pad stops and ask first, naming
 * what the profile rejected it for. Automation never grabs a rejected release.
 */
const RejectedRow: FC<ReleaseRowProps> = props => {
    const { candidate, search, added, arrived } = props;
    return <div className={classNames('jfmod-releaseItem jfmod-releaseItem--rejected', { 'jfmod-releaseItem--added': !!added,
        'jfmod-releaseItem--arrived': arrived })}>
        <button type='button' className='jfmod-releaseRow jfmod-releaseRow--rejected' aria-disabled='true'
            aria-label={rowLabel(candidate, added)} data-jfmod-release-row={candidate.releaseId}>
            <RowLines candidate={candidate} search={search} added={added}
                reasons={<span className='jfmod-releaseReasons'>{candidate.rejections.map(rejection => rejection.message).join(' ')}</span>} />
        </button>
        <RowActions {...props} rejected />
        <IndexerLink candidate={candidate} />
    </div>;
};

/** Replace's confirmation (user decision 2): what goes, and that nothing goes before the new files are in the library. */
const replaceText = (plan: RowPlan, mediaType: 'movie' | 'series') => {
    if (plan.held > 1 && mediaType === 'movie') {
        return `Replace the ${plan.held} files of this movie? They are removed once the new one is in the library.`;
    }
    if (plan.held > 1) {
        return `Replace the files of ${plan.held} episodes? Their current files are removed once the new ones are in the library.`;
    }
    let target = mediaType === 'movie' ? 'this movie' : 'this episode';
    if (plan.pack) target = 'one episode';
    return `Replace the file of ${target}? Its current file is removed once the new one is in the library.`;
};

/** The question before a grab that needs one: Replace, or any action on a rejected release, which names why it was rejected. */
const confirmationFor = (candidate: ReleaseCandidate, mode: GrabMode | undefined, plan: RowPlan, mediaType: 'movie' | 'series') => {
    const replacing = mode === 'replace';
    const why = candidate.eligible ? '' : 'The profile rejected this release: ' + escapeHtml(candidate.rejections.map(rejection => rejection.message).join(' ')) + ' ';
    if (!candidate.eligible) {
        return {
            title: replacing ? 'Replace With a Rejected Release' : 'Add a Rejected Release',
            text: why + (replacing ? replaceText(plan, mediaType) : 'Add it anyway?'),
            confirmText: replacing ? 'Replace' : 'Add Anyway',
            primary: replacing ? 'delete' as const : undefined
        };
    }
    const label = plan.held > 1 ? `Replace ${plan.held} Files` : 'Replace File';
    return { title: label, text: replaceText(plan, mediaType) + ' ' + escapeHtml(candidate.rawTitle), confirmText: label,
        primary: 'delete' as const };
};

/**
 * The block under the grabbed row: what is happening and the file name. It has no Cancel of its own; the row's X cancels
 * (2026-10-12). A grab found again on reopening shows none once the client has it: the tick carries that.
 */
const GrabStatus: FC<{ operation: GrabOperation; now: number; adopted: boolean }> =
    ({ operation, now, adopted }) => {
        // A cancelled grab leaves nothing behind: the block goes and every action is idle again.
        if (operation.state === 'cancelled' || (adopted && operation.state === 'accepted')) return null;
        const seconds = Math.max(0, Math.ceil((Date.parse(operation.holdUntil) - now) / 1000));
        const accepted = operation.state === 'accepted';
        const refused = !accepted && isFinal(operation);
        // What happens to the file the title holds (replace-upgrade design §3, 2026-10-28): a Replace says it at every moment,
        // an Add once the client has it; a first download keeps its words.
        const replacing = operation.mode === 'replace';
        const files = operation.scope === 'season' || operation.scope === 'series' ? 'the current files' : 'the current file';
        const fileWord = files.charAt(0).toUpperCase() + files.slice(1);
        let acceptedText = 'The download client accepted the torrent.';
        if (replacing) acceptedText = `In the download queue. ${fileWord} ${files.endsWith('s') ? 'are' : 'is'} removed once this one is in the library.`;
        else if (operation.mode === 'add') acceptedText = `In the download queue. ${fileWord} ${files.endsWith('s') ? 'stay' : 'stays'}.`;
        return <div className={classNames('jfmod-grabStatus', { 'jfmod-grabStatus--ok': accepted, 'jfmod-grabStatus--error': refused })}
            role='status' aria-live='polite'>
            {operation.state === 'pending' && <span>{replacing && `Replacing ${files}. `}Sending to the download client in {seconds} s.</span>}
            {operation.state === 'submitting' && <span>{replacing && `Replacing ${files}. `}Sending to the download client…</span>}
            {accepted && <span>{acceptedText}</span>}
            {accepted && operation.openUrl && <a className={flatButtonClass() + ' jfmod-grabOpen'} href={operation.openUrl}
                target='_blank' rel='noopener noreferrer'>Open in Client</a>}
            {!accepted && isFinal(operation) && <span>{operation.message}{replacing && ` ${fileWord} ${files.endsWith('s') ? 'stay' : 'stays'}.`}</span>}
            {/* The file name is the diagnostic when a grab goes wrong, so the block carries it (UX §9). */}
            <span className='jfmod-grabStatus-title'>{operation.releaseTitle}</span>
        </div>;
    };

/** Follows one grab through its hold and handoff, and exposes an idempotent Cancel (user decision 2). */
const useGrab = (api: Api, onChanged?: () => void) => {
    const [operation, setOperation] = useState<GrabOperation | null>(null);
    const [releaseId, setReleaseId] = useState<string | null>(null);
    // The button that was pressed, whether its request is still on the way, and a refusal's three seconds of "!" (release
    // picker design, action states).
    const [pressed, setPressed] = useState<GrabMode | undefined>(undefined);
    const [starting, setStarting] = useState(false);
    const [flash, setFlash] = useState(false);
    const [cancelling, setCancelling] = useState(false);
    const [error, setError] = useState('');
    const [now, setNow] = useState(() => Date.now());
    const activating = useRef(false);
    const mounted = useRef(true);
    // A grab found again from the search's active operation (reopened picker): not started here, so no block once accepted.
    const [adopted, setAdopted] = useState(false);
    const adoptedId = useRef<string | null>(null);
    // The operation this picker follows. A response about another operation, or one that would take a finished
    // operation back to an earlier state, is stale and dropped (whole-review chunk 4a, P2 5).
    const current = useRef<GrabOperation | null>(null);
    useEffect(() => () => {
        mounted.current = false;
    }, []);

    const flashFailed = useCallback(() => {
        setFlash(true);
        window.setTimeout(() => {
            if (mounted.current) setFlash(false);
        }, 3000);
    }, []);

    /** Starts following a new operation: a new generation, which no earlier response may overwrite. */
    const follow = useCallback((next: GrabOperation) => {
        if (!mounted.current) return;
        current.current = next;
        setOperation(next);
    }, []);

    /** Applies a later read of the operation being followed. */
    const update = useCallback((latest: GrabOperation) => {
        const known = current.current;
        if (!mounted.current || !known || latest.id !== known.id) return;
        if (isFinal(known) && !isFinal(latest)) return;
        current.current = latest;
        setOperation(latest);
    }, []);

    const finalKey = operation && isFinal(operation) ? operation.id + ':' + operation.state : null;
    useEffect(() => {
        if (!finalKey) return;
        activating.current = false;
        // Finding an accepted grab again on reopening changed nothing.
        if (finalKey === adoptedId.current + ':accepted') return;
        if (finalKey.endsWith(':failed') || finalKey.endsWith(':unknown')) flashFailed();
        onChanged?.();
    }, [finalKey, flashFailed, onChanged]);

    const followId = operation && !isFinal(operation) ? operation.id : null;
    useEffect(() => {
        if (!followId) return;
        // One read at a time; a read still under way when the operation followed changes or the picker closes is
        // ignored when it lands (no AbortController: older webOS engines lack it).
        let reading = false;
        let stopped = false;
        const timer = window.setInterval(() => {
            setNow(Date.now());
            if (reading) return;
            reading = true;
            getGrab(api, followId).then(latest => {
                if (!stopped) update(latest);
            }).catch(() => { /* Keep the last known state; the next tick asks again. */ })
                .finally(() => { reading = false; });
        }, 1000);
        return () => {
            stopped = true;
            window.clearInterval(timer);
        };
    }, [api, followId, update]);

    // Each grab attempt is a generation: an answer about an earlier attempt, its recovery lookup included, never replaces
    // the grab a later attempt follows (whole-review fixes review, P2 1).
    const attempt = useRef(0);
    const start = useCallback((searchId: string, candidate: ReleaseCandidate, mode?: GrabMode, acceptRejected?: boolean) => {
        // One activation grabs; another Enter or click while a grab is in flight does nothing.
        if (activating.current) return;
        activating.current = true;
        const mine = ++attempt.current;
        const isLatest = () => mounted.current && attempt.current === mine;
        adoptedId.current = null;
        setAdopted(false);
        setReleaseId(candidate.releaseId);
        setPressed(mode);
        setStarting(true);
        setFlash(false);
        setError('');
        // A mode is sent only by plugins with packs; an older plugin's grab reads exactly as before.
        grabRelease(api, { searchId, releaseId: candidate.releaseId, idempotencyKey: newKey(), ...(mode ? { mode } : {}),
            ...(acceptRejected ? { acceptRejected: true } : {}) }).then(result => {
            if (!isLatest()) return;
            setStarting(false);
            setNow(Date.now());
            follow(result);
        }).catch(failure => {
            if (!isLatest()) return;
            activating.current = false;
            setStarting(false);
            flashFailed();
            const problem = problemOf(failure, 'The release could not be grabbed.');
            setError(problem.title);
            if (problem.operationId) {
                setReleaseId(null);
                getGrab(api, problem.operationId).then(found => {
                    if (isLatest()) follow(found);
                }).catch(() => undefined);
            }
        });
    }, [api, flashFailed, follow]);

    const cancel = useCallback(() => {
        if (!operation || cancelling) return;
        setCancelling(true);
        cancelGrab(api, operation.id)
            .then(update)
            .catch(() => getGrab(api, operation.id).then(update).catch(() => undefined))
            .finally(() => {
                if (mounted.current) setCancelling(false);
            });
    }, [api, cancelling, operation, update]);

    /**
     * Follows the search's active operation when this picker follows none (2026-10-12): a grab started earlier, so the row it is
     * about shows as added after the picker is closed and opened again. A finished one changes nothing.
     */
    const adopt = useCallback((id: string) => {
        if (current.current || activating.current) return;
        getGrab(api, id).then(found => {
            if (!mounted.current || current.current || activating.current) return;
            if (found.state !== 'pending' && found.state !== 'submitting' && found.state !== 'accepted') return;
            adoptedId.current = found.id;
            setAdopted(true);
            setReleaseId(null);
            setNow(Date.now());
            follow(found);
        }).catch(() => undefined);
    }, [api, follow]);

    /** Lets go of the followed operation once it is removed from the queue or imported: every row is idle again. */
    const clear = useCallback(() => {
        current.current = null;
        activating.current = false;
        adoptedId.current = null;
        setOperation(null);
        setReleaseId(null);
        setPressed(undefined);
        setAdopted(false);
    }, []);

    return { operation, releaseId, pressed, starting, flash, cancelling, error, now, start, cancel, adopt, clear, adopted,
        busy: !!operation && !isFinal(operation) };
};

/** What the scope switch chose: an episode id, `season:<n>` or `series`; empty while nothing is chosen. */
const SEASON_PREFIX = 'season:';
const SERIES_VALUE = 'series';

interface ScopeChoice {
    scope: 'episode' | 'season' | 'series' | null;
    episodeId?: string;
    seasonNumber?: number;
}

const parseChoice = (value: string): ScopeChoice => {
    if (value === SERIES_VALUE) return { scope: 'series' };
    if (value.startsWith(SEASON_PREFIX)) return { scope: 'season', seasonNumber: Number(value.slice(SEASON_PREFIX.length)) };
    return value ? { scope: 'episode', episodeId: value } : { scope: null };
};

const episodeCode = (episode: ReleasePickerEpisode) =>
    'S' + (episode.seasonNumber < 10 ? '0' : '') + episode.seasonNumber + 'E' + (episode.episodeNumber < 10 ? '0' : '')
    + episode.episodeNumber;

interface ScopeOptions {
    episodes: ReleasePickerEpisode[];
    packs: boolean;
    pageEpisode: ReleasePickerEpisode | undefined;
    pageSeason: number | undefined;
    /** The full season and episode list is still loading (P1.FU). */
    loading: boolean;
}

/** The scope switch's line while a series' full season and episode list loads (P1.FU); never a choice. */
const LOADING_SEASONS = 'Loading Seasons…';
const LOADING_VALUE = 'loading';

/**
 * The scope switch (user decision 1, 2026-10-08). On an episode's page: that episode, its season and All Seasons. On a season's
 * page: that season and All Seasons (user, 2026-10-12). On a series page: All Seasons and each season with aired episodes
 * other than specials, and no single episodes (user, 2026-10-12). Without packs it is the episode list it always was.
 */
const scopeOptions = ({ episodes, packs, pageEpisode, pageSeason, loading }: ScopeOptions): { label: string; options: EmbySelectOption[] } => {
    const loadingOption = loading ? [{ value: LOADING_VALUE, label: LOADING_SEASONS, disabled: true }] : [];
    if (!packs) {
        return { label: 'Episode', options: [{ value: '', label: 'Choose an episode' }, ...loadingOption,
            ...episodes.map(episode => ({ value: episode.id, label: episode.label }))] };
    }
    if (pageSeason !== undefined) {
        return { label: 'Search For', options: [
            { value: SEASON_PREFIX + pageSeason, label: 'Season ' + pageSeason },
            { value: SERIES_VALUE, label: 'All Seasons' }
        ] };
    }
    if (pageEpisode) {
        return { label: 'Search For', options: [
            { value: pageEpisode.id, label: 'Episode: ' + episodeCode(pageEpisode) + ' · ' + pageEpisode.title },
            ...(pageEpisode.seasonNumber > 0 ?
                [{ value: SEASON_PREFIX + pageEpisode.seasonNumber, label: 'Season ' + pageEpisode.seasonNumber }] : []),
            { value: SERIES_VALUE, label: 'All Seasons' }
        ] };
    }
    const seasons = Array.from(new Set(episodes.filter(episode => episode.seasonNumber > 0 && !episode.unaired)
        .map(episode => episode.seasonNumber))).sort((a, b) => a - b);
    // A series page starts on All Seasons (user, 2026-10-24), so "Choose what to search for" is left only while there is none.
    return { label: 'Search For', options: [
        ...(seasons.length > 0 ? [{ value: SERIES_VALUE, label: 'All Seasons' }] : [{ value: '', label: 'Choose what to search for' }]),
        ...loadingOption,
        ...seasons.map(season => ({ value: SEASON_PREFIX + season, label: 'Season ' + season }))
    ] };
};

/**
 * The scope chosen, or where the switch starts with nothing chosen: opened from a series page (its header or its card), on All
 * Seasons once it offers it (user, 2026-10-24); a season page starts on its season and an episode page on its episode, as given.
 */
const choiceOrStart = (choice: string, options: EmbySelectOption[],
    opener: Pick<ReleasePickerProps, 'mediaType' | 'episodePage' | 'seasonPage' | 'initialEpisodeId'>) => {
    if (choice) return choice;
    const seriesPage = opener.mediaType === 'series' && !opener.episodePage && opener.seasonPage === undefined && !opener.initialEpisodeId;
    return seriesPage && options.some(option => option.value === SERIES_VALUE) ? SERIES_VALUE : '';
};

/**
 * The picker's Quality Profile choice (P4.FU19): an MUI select whose open menu names each profile over its summary, drawn as the
 * scope switch beside it is (a small label over the value on a hairline). Its trigger keeps the id the runners find it by and is a
 * TV focus stop; the menu sits above upstream's dialog layer.
 */
const ProfileSelect: FC<{ value: string; options: DetailOption[]; onChange: (value: string) => void }> = ({ value, options, onChange }) => {
    const change = useCallback((event: SelectChangeEvent) => onChange(event.target.value), [onChange]);
    return (
        <div className='jfmod-releaseProfileField'>
            <span className='jfmod-releaseProfileLabel' id='jfmod-releaseProfileLabel'>Quality Profile</span>
            <Select variant='standard' disableUnderline fullWidth value={value} onChange={change} labelId='jfmod-releaseProfileLabel'
                renderValue={detailLabelOf(options)} IconComponent={NoIcon}
                SelectDisplayProps={{ id: 'jfmod-releaseProfile', className: 'focusable' }}
                MenuProps={{ className: 'jfmod-releaseProfileMenu' }}>
                {detailMenuItems(options)}
            </Select>
        </div>
    );
};

/** The scope switch's own ▾ is drawn by the field's `::after`, so MUI's icon is left out. */
const NoIcon = () => null;

/** Whether a search's rows may offer Replace: the plugin's `modes`, else, from an older plugin, as before (user, 2026-10-09). */
const replaceOffered = (search: ReleaseSearch) => !search.grab.modes || search.grab.modes.includes('replace');

/**
 * How each row of a search grabs. A pack row holding files offers Add, and Replace while “Upgrade episodes and allow Replace” is
 * on, and adds on Enter; one holding nothing fills. An episode's Get Another Quality offers the same and adds, and so does a
 * movie's while the switch is on (user, 2026-10-28). Everything else, and every search of a plugin without packs, grabs as
 * before with no mode.
 */
const rowPlanFor = (candidate: ReleaseCandidate, search: ReleaseSearch, packs: boolean, addVersion: boolean,
    mediaType: 'movie' | 'series'): RowPlan => {
    if (!packs) return PLAIN_ROW;
    const scope = search.target.scope;
    const replace = replaceOffered(search);
    if (scope === 'season' || scope === 'series') {
        if (!candidate.coverage) return PLAIN_ROW;
        const held = candidate.coverage.held;
        if (held > 0) return { first: 'add', choices: true, replace, held, pack: true };
        return { first: 'fill', choices: false, replace: false, held: 0, pack: true };
    }
    // Another version of an episode or a movie is added on Enter and may replace what is held (plugin GrabService modes); a
    // movie's Replace removes every file it holds, which the plugin counts (user, 2026-10-28).
    if (addVersion && mediaType === 'series' && search.target.episodeId) {
        return { first: 'add', choices: true, replace, held: 1, pack: false };
    }
    // Only where the plugin offers it: with the switch off, or from an older plugin, a movie's rows add as before.
    if (addVersion && mediaType === 'movie' && search.grab.modes?.includes('replace')) {
        return { first: 'add', choices: true, replace: true, held: search.grab.heldFiles ?? 1, pack: false };
    }
    return PLAIN_ROW;
};

/**
 * The search a scope choice asks for; nothing while a series has no choice yet, or while its full season and episode list
 * still loads, since a season search covers the episodes the plugin lists (P1.FU).
 */
const searchScope = (choice: string, packs: boolean, mediaType: 'movie' | 'series', intent: ReleaseIntent | undefined,
    loading: boolean) => {
    const chosen = parseChoice(packs || !choice.includes(':') ? choice : '');
    const isPack = chosen.scope === 'season' || chosen.scope === 'series';
    let waiting = '';
    if (mediaType === 'series' && !chosen.scope) waiting = packs ? 'Choose what to search for.' : 'Choose an episode to search for.';
    if (mediaType === 'series' && loading) waiting = 'Loading every season from TMDB.';
    // A pack search is an acquire search; its rows choose to fill, add or replace.
    return { chosen, isPack, waiting, searchIntent: isPack ? undefined : intent };
};

/**
 * What the rows' actions do, above the list: Add, and Replace where a row offers it, another version where it is added. With
 * “Upgrade episodes and allow Replace” off only Add is offered, and the line says so without naming Replace (user, 2026-10-09).
 */
const noticeText = (choices: boolean, replace: boolean, scope: string | undefined, addVersion: boolean, heldFiles?: number | null,
    forPhones?: boolean): string | null => {
    // The copy phones play, on a title whose files are all 4K (Phase 12, D57): only Add, and the 4K stays.
    if (forPhones) return 'Adds a 1080p copy for phones. The 4K stays.';
    const pack = scope === 'season' || scope === 'series';
    if (choices && replace && !pack && (heldFiles ?? 1) > 1) {
        return 'Add puts the release beside the files you have; Replace removes all of them once the new one is in the library.';
    }
    if (choices && replace) {
        return pack ?
            'Where episodes already have files, Add puts the pack\'s files beside them and Replace removes them once the new ones '
                + 'are in the library. Episodes without a file are filled either way.' :
            'Add puts the release beside the file you have; Replace removes that file once the new one is in the library.';
    }
    if (choices) {
        return pack ?
            'Where episodes already have files, Add puts the pack\'s files beside them; the files you have stay. Episodes without a '
                + 'file are filled.' :
            'Add puts the release beside the file you have; the file you have stays.';
    }
    return addVersion ? 'The release you grab is added as another version; the ones you have stay.' : null;
};

/** Why the list could not be loaded, after the plugin's Refresh statuses; the picker keeps the episodes it has. */
const episodeListFailure = (error: unknown): string => {
    const status = (error as { response?: { status?: number } } | null)?.response?.status;
    let reason = 'TMDB could not be reached.';
    if (status === 404) reason = 'TMDB does not list this series.';
    else if (status === 503) reason = 'TMDB is not set up, or the library is busy.';
    else if (status === 504) reason = 'TMDB did not answer in time.';
    return 'Could not load every season from TMDB. ' + reason + ' Only the episodes in the library are listed.';
};

/**
 * The episodes the scope switch offers: those given, then the series' full list once `load` brings it (P1.FU). A failure
 * keeps the episodes given and says so quietly; the page that opened the picker is told when the list arrived.
 */
const useEpisodeList = (given: ReleasePickerEpisode[], load: (() => Promise<ReleasePickerEpisode[]>) | undefined,
    onChanged: (() => void) | undefined) => {
    const [loaded, setLoaded] = useState<ReleasePickerEpisode[] | null>(null);
    const [loading, setLoading] = useState(!!load);
    const [listError, setListError] = useState('');
    const loadRef = useRef(load);
    const onChangedRef = useRef(onChanged);
    onChangedRef.current = onChanged;
    useEffect(() => {
        const start = loadRef.current;
        if (!start) return;
        let live = true;
        start().then(list => {
            if (!live) return;
            setLoaded(list);
            onChangedRef.current?.();
        }, (error: unknown) => {
            if (live) setListError(episodeListFailure(error));
        }).finally(() => {
            if (live) setLoading(false);
        });
        return () => {
            live = false;
        };
    }, []);
    return { episodes: loaded ?? given, loading, listError };
};

interface QueueRead {
    grabId: string;
    row: QueueRow | null;
    /** The last row the client could be read for. */
    last: QueueRow | null;
    /** The queue is not open to this user (403): the tick alone, no figure. */
    denied: boolean;
}

const findRow = (items: QueueRow[], grabId: string) => items.find(item => item.grabId === grabId) ?? null;

/** A new read of the queue: a row the client could not be read for keeps the last one it could. */
const nextRead = (previous: QueueRead | null, grabId: string, row: QueueRow | null): QueueRead => {
    const before = previous?.grabId === grabId ? previous : null;
    const last = row && row.state !== 'unknown' ? row : null;
    return { grabId, row: row ?? before?.row ?? null, denied: false, last: last ?? before?.last ?? null };
};

/**
 * Reads the added row's download from the queue (§1b): the row whose grab is the one the picker follows, read right after the
 * client accepted it and every 5 s while the picker is open, until it is imported. One read at a time; no AbortController
 * (older webOS engines lack it).
 */
const useQueueRead = (api: Api, entryId: string, grabId: string | null): QueueRead | null => {
    const [read, setRead] = useState<QueueRead | null>(null);
    const current = read && read.grabId === grabId ? read : null;
    const done = !!current && (current.denied || current.row?.state === 'seeding');
    useEffect(() => {
        if (!grabId || done) return;
        let reading = false;
        let stopped = false;
        const apply = (row: QueueRow | null) => setRead(previous => nextRead(previous, grabId, row));
        const once = () => {
            if (reading) return;
            reading = true;
            getQueue(api, { entryId }).then(list => {
                if (!stopped) apply(findRow(list.items, grabId));
            }).catch((error: unknown) => {
                const status = (error as { response?: { status?: number } } | null)?.response?.status;
                if (!stopped && status === 403) setRead({ grabId, row: null, last: null, denied: true });
            }).finally(() => {
                reading = false;
            });
        };
        once();
        const timer = window.setInterval(once, 5000);
        return () => {
            stopped = true;
            window.clearInterval(timer);
        };
    }, [api, entryId, grabId, done]);
    return current;
};

type Grab = ReturnType<typeof useGrab>;

/**
 * A grab the added row shows: held, being sent, or in the client, while it still holds its title. A finished grab a refusal
 * names (the torrent another grab already owns, imported and seeding) is no added row: followed as one, its seeding queue row
 * marked this row as in the library and hid its Add until the picker was opened again (user report, 2026-10-28).
 */
const isLive = (operation: GrabOperation | null): operation is GrabOperation =>
    !!operation && operation.active !== false
    && (operation.state === 'pending' || operation.state === 'submitting' || operation.state === 'accepted');

/**
 * The row a followed grab is about: the one pressed here, else, found again on reopening, the one with the grab's infohash, or
 * for an indexer whose search gives none (RuTracker's torrent-file rows), the one with its title, indexer and size. Without
 * it every Add stayed off with no added row and no X (2026-10-26). The fallback holds only when exactly one row matches: with
 * two alike there is no telling which was grabbed, so none is marked and the grab stays an active grab with no row.
 */
const addedRowId = (operation: GrabOperation, pressedId: string | null, candidates: ReleaseCandidate[]) => {
    if (pressedId && candidates.some(candidate => candidate.releaseId === pressedId)) return pressedId;
    const hash = operation.infoHash;
    const byHash = hash ? candidates.find(candidate => candidate.infoHash === hash)?.releaseId : undefined;
    if (byHash) return byHash;
    const alike = candidates.filter(candidate => !candidate.infoHash && candidate.rawTitle === operation.releaseTitle
        && candidate.indexerName === operation.indexerName && candidate.size === operation.size);
    return alike.length === 1 ? alike[0].releaseId : null;
};

/** The row the grab block sits under: the added row, else the one pressed, else the row of the followed grab. */
const blockRowOf = (addedId: string | null, pressedId: string | null, operation: GrabOperation | null, candidates: ReleaseCandidate[]) =>
    addedId ?? pressedId ?? (operation ? addedRowId(operation, null, candidates) : null);

/**
 * Pressing Add hands focus to the X, since the Add slot is no stop while added; when the added row goes back to Add (or reads as
 * in the library) with nothing focused, its row takes focus, so the D-pad never falls to the top of the page.
 */
const useAddedFocus = (container: RefObject<HTMLDivElement | null>, addedId: string | null, added: AddedRow | null) => {
    let phase: string | null = null;
    if (added) phase = addedId + (added.accepted ? ':accepted' : ':held') + (added.x ?? '');
    const lastAdded = useRef<string | null>(null);
    useEffect(() => {
        const root = container.current;
        const previous = lastAdded.current;
        lastAdded.current = addedId;
        if (!root) return;
        const active = document.activeElement;
        const lost = !active || active === document.body;
        const rowOf = (id: string) => root.querySelector<HTMLElement>('[data-jfmod-release-row="' + id + '"]');
        if (addedId) {
            if (active?.getAttribute('data-jfmod-release-add') === addedId || (lost && previous === addedId)) {
                const target = root.querySelector<HTMLElement>('[data-jfmod-release-x="' + addedId + '"]') ?? rowOf(addedId);
                if (target) focusManager.focus(target);
            }
            return;
        }
        const row = previous && lost ? rowOf(previous) : null;
        if (row) focusManager.focus(row);
    }, [phase, addedId, container]);
};

interface AddedViewInput {
    accepted: boolean;
    isAdmin: boolean;
    queue: QueueRead | null;
    removing: boolean;
    cancelling: boolean;
    cancel: () => void;
    remove: () => void;
}

/** The added row's slots and download: X cancels during the hold, removes (administrators) once the client has it. */
const addedView = ({ accepted, isAdmin, queue, removing, cancelling, cancel, remove }: AddedViewInput): AddedRow => {
    if (!accepted) return { accepted, x: 'cancel', xOff: cancelling, onX: cancel, progress: null };
    const progress = queue?.denied ? null : downloadProgress(queue?.row ?? null, queue?.last ?? null);
    return {
        accepted,
        x: isAdmin ? 'remove' : null,
        xOff: !queue?.row || removing,
        onX: remove,
        progress,
        link: ringLink([queue?.row], progress)
    };
};

interface AddedRowInput {
    api: Api;
    entryId: string;
    data: ReleaseSearch | undefined;
    grab: Grab;
    onChanged?: () => void;
    container: RefObject<HTMLDivElement | null>;
    /** The one-at-a-time guard the dialog's confirmations share. */
    confirming: { current: boolean };
}

/**
 * The added row (2026-10-12, §1 and §1b): which row the followed grab is about, its tick and X, its download, and what follows
 * when it is cancelled, removed from the queue or imported (the other rows are free again; an imported row reads as in the
 * library). The search's active operation is followed again when the picker reopens.
 */
const useAddedRow = ({ api, entryId, data, grab, onChanged, container, confirming }: AddedRowInput) => {
    const { operation, adopt, clear, cancel, cancelling } = grab;
    const isAdmin = !!useApi().user?.Policy?.IsAdministrator;
    const activeId = data?.grab.activeOperationId ?? null;
    useEffect(() => {
        if (activeId) adopt(activeId);
    }, [activeId, adopt]);

    const live = isLive(operation) ? operation : null;
    const accepted = live?.state === 'accepted';
    const addedId = live ? addedRowId(live, grab.releaseId, data?.candidates ?? []) : null;
    const queue = useQueueRead(api, entryId, accepted && live ? live.id : null);
    const [released, setReleased] = useState<string[]>([]);
    const [imported, setImported] = useState<string[]>([]);
    const [removing, setRemoving] = useState(false);
    const [removeError, setRemoveError] = useState('');
    const release = useCallback((id: string) => setReleased(list => (list.includes(id) ? list : [...list, id])), []);

    const cancelledId = operation?.state === 'cancelled' ? operation.id : null;
    useEffect(() => {
        if (cancelledId) release(cancelledId);
    }, [cancelledId, release]);

    // Imported: the row becomes the in-library row, the other rows are free again and the polling stops.
    const importedNow = queue?.row?.state === 'seeding';
    useEffect(() => {
        if (!importedNow || !live) return;
        if (addedId) setImported(list => [...list, addedId]);
        release(live.id);
        clear();
        onChanged?.();
    }, [importedNow, live, addedId, release, clear, onChanged]);

    const queueRow = queue?.row ?? null;
    const removeFromQueue = useCallback(() => {
        if (!live || !queueRow || removing || confirming.current) return;
        confirming.current = true;
        const id = live.id;
        setRemoveError('');
        // The removal dialog for the row's state (D120): Delete the Download, or keep it downloading.
        removeWithDialog(api, queueRow, setRemoving).then(done => {
            if (!done) return;
            release(id);
            clear();
            onChanged?.();
        }, (failure: unknown) => setRemoveError(problemOf(failure, 'It could not be removed. Please try again.').title)).finally(() => {
            setRemoving(false);
            confirming.current = false;
        });
    }, [api, clear, confirming, live, onChanged, queueRow, release, removing]);

    const added = live && addedId ? addedView({ accepted, isAdmin, queue, removing, cancelling, cancel, remove: removeFromQueue }) : null;

    useAddedFocus(container, addedId, added);

    // The search answered "this title already has an active grab" for a grab that has since ended here, or for the one this picker
    // follows (grabbed from a running search's rows, P4.FU24; while it is live the rows are held by it anyway): free again. One it
    // follows with no row in this list (another profile, no longer listed) keeps the reason, so every Add being off is explained.
    const freed = !!data && !data.grab.available && data.grab.reason === 'grab_active' && !!activeId
        && (released.includes(activeId) || (activeId === operation?.id && !!addedId));
    const view = freed && data ? { ...data, grab: { ...data.grab, available: true, reason: null } } : data;
    return { added, addedId, imported, removeError, view };
};

/**
 * A running search's rows so far (P4.FU24), read with its progress: shown once any indexer has rows, until the final answer,
 * which wins. `refreshing` is a search under way with nothing to show yet. The rows so far and the final answer share their
 * search id, so `resultKey` changes once, when rows first show (the TV focuses the first row then, never under the user later).
 */
const useEarlyRows = (api: Api, progressKey: string | null, fetching: boolean, final: { data?: ReleaseSearch; error: unknown }) => {
    const { progress, now, startedAt } = useSearchProgress(api, progressKey, fetching);
    const early = fetching && progress?.search?.candidates.length ? progress.search : undefined;
    let resultKey: string | null = early?.searchId ?? null;
    if (!fetching) resultKey = final.data?.searchId ?? (final.error ? 'error' : null);
    return { progress, now, startedAt, early, refreshing: fetching && !early, resultKey };
};

const NO_ROWS: ReadonlySet<string> = new Set();

/**
 * The rows that arrived after the first ones of a search (P4.FU24): a late indexer's, and any the final answer adds. They carry
 * the arrival mark for the two seconds its fade takes. The first rows of a search, and a search shown only when it is done, have
 * none.
 */
const useArrivals = (search: ReleaseSearch | undefined): ReadonlySet<string> => {
    const [arrived, setArrived] = useState<ReadonlySet<string>>(NO_ROWS);
    const seen = useRef<{ id: string; rows: Set<string> } | null>(null);
    const mounted = useRef(true);
    useEffect(() => () => {
        mounted.current = false;
    }, []);
    const ids = search?.candidates.map(candidate => candidate.releaseId) ?? [];
    const key = search ? search.searchId + ':' + ids.length : '';
    useEffect(() => {
        if (!search) return;
        const before = seen.current?.id === search.searchId ? seen.current.rows : null;
        seen.current = { id: search.searchId, rows: new Set(ids) };
        const added = before && before.size > 0 ? ids.filter(id => !before.has(id)) : [];
        if (added.length === 0) return;
        setArrived(current => new Set(Array.from(current).concat(added)));
        const fade = (current: ReadonlySet<string>) => new Set(Array.from(current).filter(id => !added.includes(id)));
        window.setTimeout(() => {
            if (mounted.current) setArrived(fade);
        }, 2000);
        // Only a change of rows matters; `ids` and `search` are read for that change.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);
    return arrived;
};

/** The nearest ancestor that scrolls the list (the dialog's content). */
const scrollerOf = (element: Element): HTMLElement | null => {
    for (let node = element.parentElement; node; node = node.parentElement) {
        const overflow = window.getComputedStyle(node).overflowY;
        if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) return node;
    }
    return null;
};

/**
 * Keeps the row under the pointer, else the focused one (the TV's), where it is on screen when rows arrive above it (P4.FU24):
 * its place is read while the new list renders, before the page changes, and the list is scrolled by however far it moved. The
 * pointer counts once it has moved over the list since this search's rows showed, so a pointer left where the picker was opened
 * does not scroll the best rows away.
 */
const useKeepPlace = (container: RefObject<HTMLDivElement | null>, searchId: string, count: number) => {
    const key = searchId + ':' + count;
    const committed = useRef(key);
    const anchor = useRef<{ element: Element; top: number } | null>(null);
    const pointed = useRef(false);
    useEffect(() => {
        pointed.current = false;
        const root = container.current;
        if (!root) return;
        const moved = () => {
            pointed.current = true;
        };
        root.addEventListener('mousemove', moved);
        return () => root.removeEventListener('mousemove', moved);
    }, [container, searchId]);
    const root = container.current;
    if (key !== committed.current && root) {
        // The Rejected toggle too: with only rejected rows so far it holds the TV's focus, and eligible rows arrive above it.
        const focused = document.activeElement?.closest('.jfmod-releaseItem, .jfmod-rejectedToggle');
        const hovered = pointed.current ? root.querySelector('.jfmod-releaseItem:hover, .jfmod-rejectedToggle:hover') : null;
        const item = hovered ?? (focused && root.contains(focused) ? focused : null);
        anchor.current = item ? { element: item, top: item.getBoundingClientRect().top } : null;
    }
    useLayoutEffect(() => {
        if (committed.current === key) return;
        committed.current = key;
        const noted = anchor.current;
        anchor.current = null;
        if (!noted?.element.isConnected) return;
        const shift = noted.element.getBoundingClientRect().top - noted.top;
        const scroller = Math.abs(shift) >= 1 ? scrollerOf(noted.element) : null;
        if (scroller) scroller.scrollTop += shift;
    }, [key]);
};

/** The unticked sources, remembered per browser like Show Names and shared with Get Another Quality (P4.FU25). */
const HIDDEN_SOURCES_KEY = 'jfmod-releaseSourcesHidden';

const readHiddenSources = (): string[] => {
    try {
        const stored: unknown = JSON.parse(localStorage.getItem(HIDDEN_SOURCES_KEY) ?? '[]');
        return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : [];
    } catch {
        return [];
    }
};

const saveHiddenSources = (ids: string[]) => {
    try {
        localStorage.setItem(HIDDEN_SOURCES_KEY, JSON.stringify(ids));
    } catch {
        // A browser without storage just forgets the choice.
    }
};

/**
 * The Sources' indexers (the enabled ones, in the plugin's order) and which are unticked. A new indexer starts ticked, since only
 * the unticked are stored.
 */
const useSources = (api: Api) => {
    const indexers = useQuery({
        queryKey: ['JellyfinMod', api.basePath, 'SourceIndexers'],
        queryFn: ({ signal }) => getSourceIndexers(api, { signal }),
        retry: false,
        gcTime: 0,
        refetchOnWindowFocus: false
    });
    const [saved, setSaved] = useState<ReadonlySet<string>>(() => new Set(readHiddenSources()));
    const list = useMemo(() => (indexers.data ?? []).filter(indexer => indexer.enabled), [indexers.data]);
    // The saved choice read against the indexers enabled now (P4.FU25 review): when it leaves none ticked (the ticked ones were
    // turned off or removed), the first is ticked again, so a search never asks a source the list shows unticked.
    const hidden = useMemo(() => (list.length > 0 && list.every(indexer => saved.has(indexer.id)) ?
        new Set(Array.from(saved).filter(id => id !== list[0].id)) : saved), [list, saved]);
    const hiddenNow = useRef(hidden);
    hiddenNow.current = hidden;
    const toggle = useCallback((id: string) => {
        const next = new Set(hiddenNow.current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        saveHiddenSources(Array.from(next));
        setSaved(next);
    }, []);
    // With sources unticked, a search waits for the list so it can name the ticked ones.
    return { list, hidden, toggle, ready: saved.size === 0 || !indexers.isLoading };
};

/** An indexer ticked in while this search ran without it: asked alone, its rows joining the list as they arrive (P4.FU25). */
interface ExtraSearch {
    id: string;
    data?: ReleaseSearch;
    error?: string;
}

/**
 * Asks single indexers beside the search on screen. `generation` names that search: a new one forgets the indexers asked beside
 * the last, and an answer that comes after it is dropped.
 */
const useExtraSearches = (api: Api, generation: string | null) => {
    const [extras, setExtras] = useState<ExtraSearch[]>([]);
    const current = useRef(generation);
    useEffect(() => {
        current.current = generation;
        setExtras([]);
    }, [generation]);
    const ask = useCallback((id: string, query: ReleaseQuery) => {
        const mine = current.current;
        setExtras(list => (list.some(extra => extra.id === id) ? list : [...list, { id }]));
        const settle = (change: Partial<ExtraSearch>) => {
            if (current.current === mine) setExtras(list => list.map(extra => (extra.id === id ? { ...extra, ...change } : extra)));
        };
        searchReleases(api, { ...query, progressKey: undefined, indexerIds: [id] })
            .then(data => settle({ data }), (error: unknown) => settle({ error: problemOf(error, 'The search failed.').title }));
    }, [api]);
    return { extras: generation === current.current ? extras : [], ask };
};

/** The ids a new search names: the ticked sources while some are not, else none (every enabled indexer, as before). */
const tickedIndexers = ({ list, hidden }: { list: Array<{ id: string }>; hidden: ReadonlySet<string> }) => {
    const ticked = list.filter(indexer => !hidden.has(indexer.id)).map(indexer => indexer.id);
    return ticked.length > 0 && ticked.length < list.length ? ticked : undefined;
};

/** A row of an indexer asked beside the search grabs from that indexer's own search. */
const searchIdOf = (candidate: ReleaseCandidate, extras: ExtraSearch[], fallback: string) =>
    extras.find(extra => extra.data?.candidates.some(row => row.releaseId === candidate.releaseId))?.data?.searchId ?? fallback;

/** The rows' order, as the plugin ranks them: eligible first, then score, then seeders (none last). */
const byRank = (a: ReleaseCandidate, b: ReleaseCandidate) => Number(b.eligible) - Number(a.eligible) || b.score - a.score
    || Number(a.seeders === null) - Number(b.seeders === null) || (b.seeders ?? 0) - (a.seeders ?? 0);

/**
 * The search on screen with the rows of the indexers asked beside it slotted into their ranked places (P4.FU25). While the search
 * itself has nothing to show (still asking, or failed), the first indexer asked beside it that answered stands in for it, its
 * rows grabbable from its own search.
 */
const mergeSearches = (main: ReleaseSearch | undefined, extras: ExtraSearch[]): ReleaseSearch | undefined => {
    const answered = extras.flatMap(extra => (extra.data ? [extra.data] : []));
    const base = main ?? answered[0];
    const more = main ? answered : answered.slice(1);
    if (!base || more.length === 0) return base;
    const seen = new Set(base.candidates.map(candidate => candidate.releaseId));
    const candidates = base.candidates.concat(more.flatMap(search => search.candidates).filter(candidate => !seen.has(candidate.releaseId)))
        .sort(byRank);
    const asked = new Set(base.indexers.map(outcome => outcome.indexerId));
    return {
        ...base,
        candidates,
        indexers: base.indexers.concat(more.flatMap(search => search.indexers).filter(outcome => !asked.has(outcome.indexerId))),
        eligibleCount: candidates.filter(candidate => candidate.eligible).length,
        rejectedCount: candidates.filter(candidate => !candidate.eligible).length
    };
};

/** One indexer's state for the checklist and the train: the search on screen's line, or the one asked beside it. */
const sourceStates = (input: { fetching: boolean; progress: ReleaseProgress | null; final: ReleaseSearch | undefined; extras: ExtraSearch[];
    asked: string[] | null; list: Array<{ id: string; name: string; colorIndex?: number }>; now: number; startedAt: number; receivedAt: number }) => {
    const states = new Map<string, SearchLine>();
    if (input.fetching && input.progress) {
        for (const line of input.progress.indexers) states.set(line.indexerId, progressLine(line, input.now, input.startedAt));
    } else if (input.fetching) {
        // Before the first read every indexer this search asks is waiting.
        for (const indexer of input.list.filter(known => !input.asked || input.asked.includes(known.id))) {
            states.set(indexer.id, { id: indexer.id, name: indexer.name, colorIndex: indexer.colorIndex, kind: 'waiting', text: 'waiting' });
        }
    } else {
        for (const outcome of input.final?.indexers ?? []) states.set(outcome.indexerId, outcomeLine(outcome, input.receivedAt));
    }
    for (const extra of input.extras) {
        const known = input.list.find(indexer => indexer.id === extra.id);
        const base = { id: extra.id, name: known?.name ?? '', colorIndex: known?.colorIndex };
        const outcome = extra.data?.indexers.find(line => line.indexerId === extra.id);
        if (outcome) states.set(extra.id, outcomeLine(outcome, input.receivedAt));
        else if (extra.error) states.set(extra.id, { ...base, kind: 'failed', text: extra.error });
        else if (!extra.data) states.set(extra.id, { ...base, kind: 'asking', text: 'asking…' });
    }
    return states;
};

/** The checklist's state words at the right of a line (P4.FU25). */
const sourceStateText = (line: SearchLine | undefined, ticked: boolean, rows: { eligible: number; rejected: number }) => {
    if (!line) return { state: ticked ? '' : 'not asked', bad: false };
    const hidden = ticked ? '' : 'hidden · ';
    switch (line.kind) {
        case 'waiting': return { state: hidden + 'waiting', bad: false };
        case 'asking': return { state: hidden + 'asking…', bad: false };
        case 'none': return { state: 'no results', bad: false };
        // The reason is behind the line's (i): the plugin's message, or the short reason when it sent none (user, 2026-10-26).
        case 'failed': return { state: 'failed', bad: true, failure: line.message || line.text };
        default:
            if (!ticked) return { state: hidden + releaseCount(rows.eligible + rows.rejected), bad: false };
            return { state: releaseCount(rows.eligible) + (rows.rejected ? ' · ' + rows.rejected + ' rejected' : ''), bad: false };
    }
};

/**
 * Where the list stands (P4.FU25): `waitingForRows` while a search has nothing current to show (rows of an indexer asked beside it
 * are current, so they grab while it still asks); `soFar` while rows show and the search still asks; `held`, the row a grab is
 * being sent or held for.
 */
const listState = (input: { refreshing: boolean; fetching: boolean; extras: ExtraSearch[]; data: ReleaseSearch | undefined;
    addedId: string | null; grab: { starting: boolean; releaseId: string | null } }) => ({
    waitingForRows: input.refreshing && !input.extras.some(extra => extra.data?.candidates.length),
    soFar: input.fetching && !!input.data?.candidates.length,
    held: input.addedId ?? (input.grab.starting ? input.grab.releaseId : null)
});

interface SourcesViewInput {
    sources: ReturnType<typeof useSources>;
    data: ReleaseSearch | undefined;
    extras: ExtraSearch[];
    asked: string[] | null;
    ask: (id: string, query: ReleaseQuery) => void;
    lastQuery: RefObject<ReleaseQuery | null>;
    progressKey: string | null;
    /** The row a grab is being sent or held for: it stays in the list when its source is unticked, so its Cancel stays reachable. */
    held: string | null;
    fetching: boolean;
    progress: ReleaseProgress | null;
    final: ReleaseSearch | undefined;
    now: number;
    startedAt: number;
    receivedAt: number;
}

/**
 * What the Sources change on screen (P4.FU25): the rows of the ticked sources (an unticked one's, eligible and rejected, hide at
 * once; its search is not stopped), the counts the status line gives, the checklist's lines and the train.
 */
const useSourcesView = (input: SourcesViewInput) => {
    const { sources, data, extras, asked, ask, lastQuery, progressKey, progress } = input;
    const { hidden, toggle } = sources;
    const candidates = data?.candidates ?? [];
    const shown = (candidate: ReleaseCandidate) => !hidden.has(candidate.indexerId) || candidate.releaseId === input.held;
    const eligible = candidates.filter(candidate => candidate.eligible && shown(candidate));
    const rejected = candidates.filter(candidate => !candidate.eligible && shown(candidate));
    const list = sources.list.length > 0 ? sources.list :
        (data?.indexers ?? []).map(outcome => ({ id: outcome.indexerId, name: outcome.name, colorIndex: outcome.colorIndex }));
    const states = sourceStates({ fetching: input.fetching, progress, final: input.final, extras, asked, list, now: input.now,
        startedAt: input.startedAt, receivedAt: input.receivedAt });
    const sourceLines: SourceLine[] = list.map(indexer => {
        const on = !hidden.has(indexer.id);
        const rows = candidates.filter(candidate => candidate.indexerId === indexer.id);
        return { id: indexer.id, name: indexer.name, colorIndex: indexer.colorIndex, ticked: on,
            slowSetupHowTo: 'slowSetupHowTo' in indexer ? indexer.slowSetupHowTo : null,
            ...sourceStateText(states.get(indexer.id), on, { eligible: rows.filter(row => row.eligible).length,
                rejected: rows.filter(row => !row.eligible).length }) };
    });
    const trainLines: TrainLine[] = Array.from(states.values()).map(line => ({ id: line.id, colorIndex: line.colorIndex,
        finished: line.kind !== 'asking' && line.kind !== 'waiting', failed: line.kind === 'failed',
        startedAt: progress?.indexers.find(row => row.indexerId === line.id)?.startedAt }));
    const train = useTrain(trainLines, progressKey ?? '');
    const toggleSource = useCallback((id: string) => {
        // Ticking a source this search did not ask asks it now, alone; one it asked just shows again.
        const wasAsked = !asked || asked.includes(id) || extras.some(extra => extra.id === id);
        if (hidden.has(id) && !wasAsked && lastQuery.current && progressKey) ask(id, lastQuery.current);
        toggle(id);
    }, [ask, asked, extras, hidden, lastQuery, progressKey, toggle]);
    return {
        hidden, eligible, rejected, sourceLines, train, toggleSource,
        shownSearch: data && { ...data, eligibleCount: eligible.length, rejectedCount: rejected.length },
        sourcesSearching: input.fetching || extras.some(extra => !extra.data && !extra.error)
    };
};

/**
 * The release picker (UX §9, PHASE4 A7): parsed summary plus the raw title, descending scores, a collapsed
 * rejected group with reasons, and one Enter to grab. The server holds a grab before sending it, so a focusable
 * Cancel follows the grabbed row during the hold (user decision 2). Rows only change on a deliberate search:
 * a new scope or profile. Nothing refetches underneath a focused row.
 */
const ReleasePickerDialog: FC<ReleasePickerProps> = ({ api, entryId, mediaType, episodes: givenEpisodes, initialEpisodeId, episodePage,
    seasonPage, intent, loadEpisodes, onChanged, sourcesSlot }) => {
    const { episodes, loading, listError } = useEpisodeList(givenEpisodes, loadEpisodes, onChanged);
    const [choice, setChoice] = useState(initialEpisodeId ?? (seasonPage === undefined ? '' : SEASON_PREFIX + seasonPage));
    const [profileId, setProfileId] = useState('');
    const [rejectedOpen, setRejectedOpen] = useState(false);
    const [progressKey, setProgressKey] = useState<string | null>(null);
    // The indexers the search on screen asked (null: every enabled one), and the query it was, for asking one more beside it.
    const [asked, setAsked] = useState<string[] | null>(null);
    const lastQuery = useRef<ReleaseQuery | null>(null);
    const sources = useSources(api);
    const sourcesNow = useRef(sources);
    sourcesNow.current = sources;
    const container = useRef<HTMLDivElement>(null);
    const grab = useGrab(api, onChanged);
    // Pack scopes only where the plugin serves them; an older plugin keeps the episode list (season packs, 2026-10-08).
    const packs = usePluginCapabilities(api).includes(PACKS_CAPABILITY);
    const pageEpisode = episodePage && initialEpisodeId ? episodes.find(episode => episode.id === initialEpisodeId) : undefined;
    const scope = useMemo(() => scopeOptions({ episodes, packs, pageEpisode, pageSeason: seasonPage, loading }),
        [episodes, packs, pageEpisode, seasonPage, loading]);
    const choiceNow = choiceOrStart(choice, scope.options, { mediaType, episodePage, seasonPage, initialEpisodeId });
    const { chosen, isPack, waiting, searchIntent } = searchScope(choiceNow, packs, mediaType, intent, loading);

    const profiles = useQuery({
        queryKey: ['JellyfinMod', api.basePath, 'QualityProfiles'],
        queryFn: ({ signal }) => getQualityProfiles(api, { signal }),
        retry: false
    });
    const search = useQuery({
        queryKey: ['JellyfinMod', api.basePath, 'Releases', entryId, choiceNow, profileId, searchIntent ?? 'acquire'],
        // `intent` is sent only for another version, and `scope` only for a pack, so an acquire search of one episode or a
        // movie reads exactly as it did before.
        queryFn: ({ signal }) => {
            // A fresh key per search: the page reads what each indexer is doing from it while the search runs.
            const key = newKey('search');
            // A new search asks only the ticked sources (P4.FU25); with every one ticked it names none, as before.
            const indexerIds = tickedIndexers(sourcesNow.current);
            const query: ReleaseQuery = {
                entryId,
                episodeId: chosen.episodeId,
                profileId: profileId || undefined,
                intent: searchIntent === 'addVersion' ? searchIntent : undefined,
                ...(isPack ? { scope: chosen.scope as 'season' | 'series', seasonNumber: chosen.seasonNumber } : {})
            };
            lastQuery.current = query;
            setAsked(indexerIds ?? null);
            setProgressKey(key);
            return searchReleases(api, { ...query, progressKey: key, indexerIds }, { signal });
        },
        enabled: [!waiting, sources.ready].every(Boolean),
        retry: false,
        gcTime: 0,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false
    });

    // The rows of the indexers that have answered, while the others are still asked (P4.FU24); the final answer wins.
    const { progress, now: progressNow, startedAt, early, refreshing, resultKey } = useEarlyRows(api, progressKey, search.isFetching,
        search);
    // A new search starts with the Rejected group closed. Only a new search: rows of an indexer ticked in may already be on screen
    // when the search's own first rows arrive, and a held grab on one of their rejected rows must keep its Cancel (P4.FU25 review).
    useEffect(() => {
        setRejectedOpen(false);
    }, [progressKey]);
    useEffect(() => {
        if (!resultKey) return;
        window.requestAnimationFrame(() => {
            const root = container.current;
            // The D-pad already on a row or its action (rows of an indexer ticked in) stays where it is.
            if (root?.querySelector('.jfmod-releaseScroll')?.contains(document.activeElement)) return;
            const target = root?.querySelector<HTMLElement>('.jfmod-releaseRow:not([aria-disabled="true"])')
                ?? root?.querySelector<HTMLElement>('.jfmod-releaseRow, .jfmod-rejectedToggle')
                ?? root?.querySelector<HTMLElement>('.jfmod-releaseStatus');
            // Only the TV's D-pad needs a row focused for it: on a desktop the script focus left the first row highlighted as if
            // it were selected after a mouse click (user, 2026-10-11).
            if (target && layoutManager.tv) focusManager.focus(target);
        });
    }, [resultKey]);

    const { busy, operation, start } = grab;
    // A grab in the client holds the rows; a finished one a refusal named does not (user report, 2026-10-28).
    const holding = isLive(operation) && operation.state === 'accepted';
    // One confirmation at a time (Replace, a rejected release, Remove the Torrent); a second activation while one is open does
    // nothing.
    const confirming = useRef(false);
    // Indexers ticked in while unasked are asked beside this search; their rows join it (P4.FU25).
    const { extras, ask } = useExtraSearches(api, progressKey);
    const merged = useMemo(() => mergeSearches(early || search.data, extras), [early, search.data, extras]);
    const { added, addedId, imported, removeError, view: data } = useAddedRow({ api, entryId, data: merged, grab, onChanged,
        container, confirming });
    const { waitingForRows, soFar, held } = listState({ refreshing, fetching: search.isFetching, extras, data, addedId, grab });
    const arrived = useArrivals(data);
    useKeepPlace(container, data?.searchId ?? '', data?.candidates.length ?? 0);
    const onGrab = useCallback((candidate: ReleaseCandidate, mode: GrabMode | undefined, plan: RowPlan) => {
        if (!data?.grab.available || busy || holding || waitingForRows || candidate.heldQuality) return;
        const chosenRejection = !candidate.eligible;
        const searchId = searchIdOf(candidate, extras, data.searchId);
        if (mode !== 'replace' && !chosenRejection) {
            start(searchId, candidate, mode);
            return;
        }
        if (confirming.current) return;
        confirming.current = true;
        confirm(confirmationFor(candidate, mode, plan, mediaType))
            .then(() => start(searchId, candidate, mode, chosenRejection), () => undefined).finally(() => {
                confirming.current = false;
            });
    }, [busy, data, extras, holding, mediaType, waitingForRows, start]);
    const toggleRejected = useCallback(() => setRejectedOpen(value => !value), []);
    // The TV's action sheet may offer the disabled loading line too; choosing it changes nothing.
    const chooseScope = useCallback((value: string) => {
        if (value !== LOADING_VALUE) setChoice(value);
    }, []);
    // The list comes best-first from the plugin (user, 2026-10-19). The default profile reads "4K (Default)" and is what is
    // selected unless the title has its own profile; there is no separate "Title default" option. Picking the profile a search
    // uses without an override clears the override, so only a different profile is sent.
    const defaultProfileId = profiles.data?.find(profile => profile.isDefault)?.id ?? '';
    const noOverrideId = useRef('');
    useEffect(() => {
        if (!profileId && data) noOverrideId.current = data.profile.id;
    }, [profileId, data]);
    // Each profile says what it does under its name, as the Default quality profile select does (user, 2026-10-24, P4.FU19).
    const profileOptions = useMemo<DetailOption[]>(() => (profiles.data ?? []).map(profile => ({
        value: profile.id, label: profile.isDefault ? profile.name + ' (Default)' : profile.name, detail: profileSummary({ ...profile }),
        phone: !!profile.isPhoneProfile
    })), [profiles.data]);
    const shownProfileId = profileId || (data?.profile.id ?? defaultProfileId);
    const chooseProfile = useCallback((value: string) => {
        setProfileId(value === (noOverrideId.current || defaultProfileId) ? '' : value);
    }, [defaultProfileId]);

    const searchError = search.error ? problemOf(search.error, 'Release search failed. Please try again.').title : '';
    const { hidden, eligible, rejected, sourceLines, shownSearch, train, sourcesSearching, toggleSource } = useSourcesView({
        sources, data, extras, asked, ask, lastQuery, progressKey, held,
        fetching: search.isFetching, progress, final: search.data,
        now: progressNow, startedAt, receivedAt: search.dataUpdatedAt });
    // A new search (another season, another profile) clears the rows of the last one and starts from the searching state; only
    // current rows can grab.
    const grabDisabled = !data?.grab.available || busy || grab.starting || grab.flash || holding || waitingForRows;
    const unavailable = unavailableText(data, search.dataUpdatedAt);
    const notes = [grab.error, removeError].filter(Boolean).join(' · ');
    const status: ReactNode = soFar ? <EarlyStatus count={eligible.length} progress={progress} notes={notes} hidden={hidden} /> :
        [statusText(shownSearch, waiting, search.isFetching && !data?.candidates.length, searchError, unavailable), notes]
            .filter(Boolean).join(' · ');
    const plans = new Map(data ? data.candidates.map(candidate => [candidate.releaseId,
        rowPlanFor(candidate, data, packs, (data.intent ?? searchIntent) === 'addVersion', mediaType)]) : []);
    const choices = Array.from(plans.values()).some(plan => plan.choices);
    const replaceChoices = Array.from(plans.values()).some(plan => plan.choices && plan.replace);
    // A grab found again on reopening with no row here keeps its block (accepted, Open in Client, the file name): no tick carries it.
    const grabStatus = operation && <GrabStatus operation={operation} now={grab.now} adopted={grab.adopted && !!addedId} />;
    // The block sits under the row the grab is about: the added row, the one pressed when the grab failed, or the row of a
    // finished grab a refusal names (a duplicate of a release already imported, user 2026-10-28), a rejected row too (user,
    // 2026-10-27). Only when that row is not on screen does it go to the top of the list.
    const blockRowId = blockRowOf(addedId, grab.releaseId, operation, data?.candidates ?? []);
    const blockShown = !!blockRowId && (eligible.some(candidate => candidate.releaseId === blockRowId)
        || (rejectedOpen && rejected.some(candidate => candidate.releaseId === blockRowId)));
    // An imported row reads as the in-library row: a green check after the quality and no actions.
    const shownCandidate = (candidate: ReleaseCandidate) => (imported.includes(candidate.releaseId) ? { ...candidate, heldQuality: true } : candidate);

    const notice = noticeText(choices, replaceChoices, data?.target.scope, intent === 'addVersion' && !isPack, data?.grab.heldFiles,
        data?.grab.forPhones);

    const { block, hasRows, bare, spoken, shown, searching } = searchView({ progress, now: progressNow, startedAt,
        early: soFar ? [releaseCount(eligible.length) + ' so far', notes].filter(Boolean).join(' · ') : null,
        fetching: search.isFetching, waiting, error: searchError, data, unavailable, receivedAt: search.dataUpdatedAt, status,
        grabError: grab.error });
    const stale = waitingForRows;

    const { releaseId: grabbedId, pressed, flash, starting } = grab;
    const operationState = operation?.state;
    const actionState = useCallback((releaseId: string, mode: 'add' | 'replace'): ActionState => {
        if (releaseId !== grabbedId || mode !== (pressed === 'replace' ? 'replace' : 'add')) return 'idle';
        if (flash) return 'failed';
        if (starting || operationState === 'pending' || operationState === 'submitting') return 'working';
        return operationState === 'accepted' ? 'done' : 'idle';
    }, [flash, grabbedId, operationState, pressed, starting]);

    return <div className={classNames('jfmod-releasePicker', { 'jfmod-releasePicker--holding': !!added })} ref={container}>
        {sourcesSlot && <ReleaseSources slot={sourcesSlot} lines={sourceLines} onToggle={toggleSource}
            searching={sourcesSearching} train={train} showing={!!data} />}
        {/* The choices share one line where the screen allows (user, 2026-10-08). The scope switch keeps the episode
            select's id, so runners that pick an episode by id still work. */}
        <div className='jfmod-releaseControls'>
            {mediaType === 'series' && <EmbySelect key={scope.label} id='jfmod-releaseEpisode' label={scope.label} value={choiceNow}
                options={scope.options} onChange={chooseScope} />}
            {!!profiles.data?.length && <ProfileSelect value={shownProfileId} options={profileOptions} onChange={chooseProfile} />}
        </div>
        {listError && <p className='jfmod-releaseNotice jfmod-releaseNotice--info jfmod-episodeListFailure'>{listError}</p>}
        {notice && !bare && <p className='jfmod-releaseNotice jfmod-releaseNotice--info'>{notice}</p>}
        <p className={classNames('jfmod-releaseStatus', { 'jfmod-releaseStatus--bare': bare })} role='status' tabIndex={-1}>
            {spoken && <span className='jfmod-releaseStatus-spoken'>{spoken}</span>}
            {shown && <span aria-hidden={searching}>{shown}</span>}
        </p>
        {/* The grab's status stays in view for its whole hold, also when a changed search no longer lists the release it grabbed
            (whole-review chunk 4a, P2 4). */}
        {/* Only the list scrolls; everything above it stays put (P4.FU24). */}
        <div className='jfmod-releaseScroll scrollY'>
            {!blockShown && grabStatus}
            <div className={classNames('jfmod-releaseList', { 'jfmod-releaseList--stale': stale && hasRows })}>
                {eligible.map(candidate => <Fragment key={candidate.releaseId}>
                    <ReleaseRow candidate={shownCandidate(candidate)} search={data} disabled={grabDisabled}
                        plan={plans.get(candidate.releaseId) ?? PLAIN_ROW} onGrab={onGrab} actionState={actionState}
                        added={candidate.releaseId === addedId ? added : null} arrived={arrived.has(candidate.releaseId)} />
                    {blockRowId === candidate.releaseId && grabStatus}
                </Fragment>)}
                {block && <SearchBlock mode={block.mode} caption={block.caption} lines={block.lines} over={search.isFetching && hasRows} />}
            </div>
            {rejected.length > 0 && <div className='jfmod-rejectedGroup'>
                <button type='button' className={flatButtonClass() + ' jfmod-rejectedToggle'} aria-expanded={rejectedOpen} onClick={toggleRejected}>
                    {rejectedOpen ? '▾' : '▸'} {rejected.length} Rejected
                </button>
                {rejectedOpen && rejected.map(candidate => <Fragment key={candidate.releaseId}>
                    <RejectedRow candidate={shownCandidate(candidate)} search={data}
                        disabled={grabDisabled} plan={plans.get(candidate.releaseId) ?? PLAIN_ROW} onGrab={onGrab} actionState={actionState}
                        added={candidate.releaseId === addedId ? added : null} arrived={arrived.has(candidate.releaseId)} />
                    {blockRowId === candidate.releaseId && grabStatus}
                </Fragment>)}
            </div>}
        </div>
    </div>;
};

export default ReleasePickerDialog;
