import type { Api } from '@jellyfin/sdk/lib/api';
import { useQuery } from '@tanstack/react-query';
import classNames from 'classnames';
import escapeHtml from 'escape-html';
import React, { type FC, Fragment, type MouseEvent, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import confirm from 'components/confirm/confirm';
import focusManager from 'components/focusManager';
import layoutManager from 'components/layoutManager';
import { useApi } from 'hooks/useApi';

import { cancelGrab, getGrab, getQualityProfiles, getQueue, getReleaseProgress, grabRelease, removeQueueRow, searchReleases } from '../api/modApi';
import { ADD_VERSION_UNAVAILABLE } from '../constants/versions';
import { PACKS_CAPABILITY, usePluginCapabilities } from '../hooks/useAcquisition';
import type { GrabMode, GrabOperation, IndexerOutcome, IndexerProgress, ReleaseCandidate, ReleaseIntent, ReleaseProgress, ReleaseSearch } from '../types/acquisition';
import type { QueueRow } from '../types/queue';

import EmbySelect, { type EmbySelectOption } from './EmbySelect';
import { AddGlyph, IndexerLink, qualityText, ReleaseLines, RemoveGlyph, ReplaceGlyph } from './ReleaseRowParts';
import { SearchBlock, type SearchLine } from './ReleaseSearchBlock';
import { flatButtonClass } from '../utils/flatButton';

import './interFont.scss';
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
    ['episode_replace_disabled', 'Replacing a file needs episode upgrades turned on in the plugin settings. Add keeps both files.'],
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
const failureText = (status: string, message: string | null, retry: number | null, base: number) => {
    switch (status) {
        case 'timeout': return 'timed out';
        case 'rate_limited': return retry ? 'rate limited · retry ' + clockTime(base, retry) : 'rate limited';
        case 'breaker_open': return retry ? 'paused until ' + clockTime(base, retry) : 'paused';
        case 'budget_exhausted': return 'daily budget used up';
        case 'secret_unavailable': return 'no API key';
        case 'unsupported_search': return 'cannot search this';
        default: return message ?? status.replace(/_/g, ' ');
    }
};

const releaseCount = (count: number) => count + (count === 1 ? ' release' : ' releases');

/** One indexer's line while its search runs, from the plugin's progress. */
const progressLine = (line: IndexerProgress, now: number, base: number): SearchLine => {
    const id = line.indexerId;
    const { name } = line;
    if (line.state === 'queued') return { id, name, kind: 'waiting', text: 'waiting' };
    if (line.state === 'verifying' || line.state === 'asking') {
        const seconds = line.startedAt ? Math.max(0, Math.floor((now - Date.parse(line.startedAt)) / 1000)) : null;
        return { id, name, kind: 'asking', text: 'asking…' + (seconds === null ? '' : ' ' + seconds + ' s') };
    }
    if (line.state === 'ok') return { id, name, kind: 'ok', text: releaseCount(line.resultCount) };
    if (line.state === 'no_results') return { id, name, kind: 'none', text: 'nothing' };
    return { id, name, kind: 'failed', text: failureText(line.state, null, line.retryAfterSeconds, base) };
};

/** One indexer's line once the search is over, from its outcome. */
const outcomeLine = (outcome: IndexerOutcome, base: number): SearchLine => {
    const id = outcome.indexerId;
    const { name } = outcome;
    if (outcome.status === 'ok') return { id, name, kind: 'ok', text: releaseCount(outcome.resultCount) };
    if (outcome.status === 'no_results') return { id, name, kind: 'none', text: 'nothing' };
    return { id, name, kind: 'failed', text: failureText(outcome.status, outcome.message, outcome.retryAfterSeconds, base) };
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
    api: Api;
    progressKey: string | null;
    fetching: boolean;
    waiting: string;
    error: string;
    data: ReleaseSearch | undefined;
    unavailable: string | null;
    receivedAt: number;
    status: string;
    grabError: string;
}

/**
 * The search block while a search runs (over the old rows when it replaces a list) and where a finished one has no rows. The
 * block draws its own caption, so the status line then only tells screen readers: once at the start, once at the end.
 */
const useSearchView = (input: SearchViewInput) => {
    const { progress, now, startedAt } = useSearchProgress(input.api, input.progressKey, input.fetching);
    const hasRows = (input.data?.candidates.length ?? 0) > 0;
    const searching = input.fetching && !input.waiting;
    const nothingFound = !searching && !input.waiting && !input.error && !!input.data && !hasRows;
    const block = searchBlockOf({ searching, nothingFound, data: input.data, progress, now, startedAt, unavailable: input.unavailable,
        receivedAt: input.receivedAt });
    // With no rows the block is the whole list area: it draws the caption itself, and the notice and status lines give way to it
    // (the mock shows none of them), so the status line only tells screen readers, once at the start and once at the end.
    const bare = !!block && !hasRows && !input.grabError;
    let spoken = '';
    if (searching) spoken = 'Searching indexers';
    else if (bare) spoken = input.status;
    return { block, hasRows, bare, spoken, shown: bare ? '' : input.status, searching };
};

const statusText = (search: ReleaseSearch | undefined, waiting: string, loading: boolean, error: string, unavailable: string | null) => {
    if (waiting) return waiting;
    // A search in progress shows its block; the status line only says it started, for screen readers.
    if (loading) return '';
    if (error) return error;
    if (!search) return '';
    let text = `${search.eligibleCount} ${search.eligibleCount === 1 ? 'release' : 'releases'}`;
    if (search.eligibleCount === 0) text = search.rejectedCount === 0 ? unavailable ?? 'No releases found' : 'No release passes the profile';
    else if (search.indexers.length > 0) text += ` · ${answeredCount(search)} of ${search.indexers.length} indexers answered`;
    if (search.truncated) text += ' · more results exist than were read';
    if (!search.grab.available && search.grab.reason) text += ' · ' + (GRAB_REASONS.get(search.grab.reason) ?? 'Grabbing is unavailable.');
    return text;
};

const profileLabel = (search: ReleaseSearch | undefined, overridden: boolean) => {
    if (!search || overridden) return 'Title default';
    return (search.profile.inherited ? 'Default' : 'Title profile') + ' (' + search.profile.name + ')';
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

/** What the added row's download looks like (2026-10-12, §1b): a bar along the row's bottom and a figure on its marks line. */
interface AddedProgress {
    kind: 'queued' | 'downloading' | 'stalled' | 'importing' | 'failed';
    /** 0..100; null draws the track only. */
    percent: number | null;
    text: string;
    /** The client could not be read: the last value, dimmed. */
    stale: boolean;
}

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
    progress: AddedProgress | null;
}

const ProgressFigure: FC<{ progress: AddedProgress }> = ({ progress }) =>
    <span className={classNames('jfmod-addedFigure', 'jfmod-addedFigure--' + progress.kind, { 'jfmod-addedFigure--stale': progress.stale })}
        aria-live='off'>{progress.text}</span>;

const ProgressBar: FC<{ progress: AddedProgress }> = ({ progress }) =>
    <span className={classNames('jfmod-addedBar', 'jfmod-addedBar--' + progress.kind)} aria-hidden='true'>
        <span className='jfmod-addedBar-fill' style={{ width: (progress.percent ?? 0) + '%' }} />
    </span>;

const RowLines: FC<{ candidate: ReleaseCandidate; search: ReleaseSearch | undefined; added?: AddedRow | null }> = ({ candidate, search, added }) =>
    <>
        <ReleaseLines candidate={candidate} coverage={coverageText(candidate, search)}
            progress={added?.progress ? <ProgressFigure progress={added.progress} /> : undefined} />
        {added?.progress && <ProgressBar progress={added.progress} />}
    </>;

/**
 * How a row grabs (user decision 2, 2026-10-08). `first` is what Enter or a click on the row does: fill where the scope holds
 * nothing, add where it holds files; undefined sends no mode, as before packs. `choices` is true where the scope holds files:
 * the row then ends with Add, and with Replace where the search offers it (only while episode upgrades are on, user
 * 2026-10-09). `held` counts the episodes whose files Replace would remove.
 */
interface RowPlan {
    first: GrabMode | undefined;
    choices: boolean;
    /** Replace follows Add; false while episode upgrades are off. */
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
}

/** The added row's two slots: the decorative arrow or tick (no stop), then the X where there is one. */
const AddedActions: FC<{ candidate: ReleaseCandidate; added: AddedRow }> = ({ candidate, added }) => {
    const { x, onX } = added;
    const press = useCallback((event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        onX();
    }, [onX]);
    // The Add slot stays the same button element, so the D-pad does not lose its place; it is no stop now (the X takes focus).
    return <span className='jfmod-releaseActions jfmod-releaseActions--pressed'>
        <button type='button' className={actionClass('jfmod-releaseAction--add', added.accepted ? 'done' : 'working')}
            title={added.accepted ? 'In the Download Queue' : 'Adding…'} aria-hidden='true' tabIndex={-1}
            data-jfmod-release-add={candidate.releaseId}>
            <AddGlyph />
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
        onGrab(candidate, rejected && !plan.choices ? plan.first : 'add', plan);
    }, [candidate, onGrab, plan, rejected]);
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
    if (!rejected && !plan.choices) return <span className='jfmod-releaseActions jfmod-releaseActions--empty' />;
    return <span className={classNames('jfmod-releaseActions', { 'jfmod-releaseActions--pressed': addState !== 'idle' || replaceState !== 'idle' })}>
        <button type='button' className={actionClass('jfmod-releaseAction--add', addState)} title={actionTitle('Add', addState)}
            aria-label={(rejected ? 'Add the rejected release ' + candidate.rawTitle : 'Add ' + candidate.rawTitle + ' beside the files held')}
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
    return ', added' + (added.progress ? ', ' + added.progress.text : '');
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
    const { candidate, search, disabled, plan, onGrab, added } = props;
    // The added row is never dimmed: it is the one the grab is about.
    const off = !added && (disabled || !!candidate.heldQuality);
    const activate = useCallback(() => onGrab(candidate, plan.first, plan), [candidate, onGrab, plan]);
    return <div className={classNames('jfmod-releaseItem', { 'jfmod-releaseItem--added': !!added })}>
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
    const { candidate, search, added } = props;
    return <div className={classNames('jfmod-releaseItem jfmod-releaseItem--rejected', { 'jfmod-releaseItem--added': !!added })}>
        <button type='button' className='jfmod-releaseRow jfmod-releaseRow--rejected' aria-disabled='true'
            aria-label={rowLabel(candidate, added)} data-jfmod-release-row={candidate.releaseId}>
            <RowLines candidate={candidate} search={search} added={added} />
            <span className='jfmod-releaseReasons'>{candidate.rejections.map(rejection => rejection.message).join(' ')}</span>
        </button>
        <RowActions {...props} rejected />
        <IndexerLink candidate={candidate} />
    </div>;
};

/** Replace's confirmation (user decision 2): what goes, and that nothing goes before the new files are in the library. */
const replaceText = (plan: RowPlan, mediaType: 'movie' | 'series') => {
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
        return <div className={classNames('jfmod-grabStatus', { 'jfmod-grabStatus--ok': accepted, 'jfmod-grabStatus--error': refused })}
            role='status' aria-live='polite'>
            {operation.state === 'pending' && <span>Sending to the download client in {seconds} s.</span>}
            {operation.state === 'submitting' && <span>Sending to the download client…</span>}
            {accepted && <span>The download client accepted the torrent.</span>}
            {accepted && operation.openUrl && <a className={flatButtonClass() + ' jfmod-grabOpen'} href={operation.openUrl}
                target='_blank' rel='noopener noreferrer'>Open in Client</a>}
            {!accepted && isFinal(operation) && <span>{operation.message}</span>}
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
    return { label: 'Search For', options: [
        { value: '', label: 'Choose what to search for' },
        ...loadingOption,
        ...(seasons.length > 0 ? [{ value: SERIES_VALUE, label: 'All Seasons' }] : []),
        ...seasons.map(season => ({ value: SEASON_PREFIX + season, label: 'Season ' + season }))
    ] };
};

/** Whether a search's rows may offer Replace: the plugin's `modes`, else, from an older plugin, as before (user, 2026-10-09). */
const replaceOffered = (search: ReleaseSearch) => !search.grab.modes || search.grab.modes.includes('replace');

/**
 * How each row of a search grabs. A pack row holding files offers Add, and Replace while episode upgrades are on, and adds on
 * Enter; one holding nothing fills. An episode's Get Another Quality offers the same and adds. Everything else, and every
 * search of a plugin without packs, grabs as before with no mode.
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
    // A movie's another version is only ever added; an episode's may replace what is held (plugin GrabService modes).
    if (addVersion && mediaType === 'series' && search.target.episodeId) {
        return { first: 'add', choices: true, replace, held: 1, pack: false };
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
 * episode upgrades off only Add is offered, and the line says so without naming Replace (user, 2026-10-09).
 */
const noticeText = (choices: boolean, replace: boolean, scope: string | undefined, addVersion: boolean): string | null => {
    const pack = scope === 'season' || scope === 'series';
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

/** `12 min left`, `1 h 5 min left`. */
const etaText = (seconds: number) => {
    const minutes = Math.max(1, Math.round(seconds / 60));
    if (minutes < 60) return minutes + ' min left';
    const rest = minutes % 60;
    return Math.floor(minutes / 60) + ' h' + (rest ? ' ' + rest + ' min' : '') + ' left';
};

const IMPORTING = new Set(['identifying', 'linking', 'scanning']);

/**
 * The added row's bar and figure from its queue row (§1b): queued, downloading, stalled, importing, failed or blocked. A client
 * that cannot be read (`unknown`) keeps the last value, dimmed.
 */
const progressOf = (row: QueueRow | null, last: QueueRow | null): AddedProgress => {
    const stale = row?.state === 'unknown';
    const shown = stale ? last : row;
    const percent = shown?.progress === null || shown?.progress === undefined ? null : Math.floor(shown.progress * 100);
    if (!shown || shown.state === 'queued' || percent === null) {
        return { kind: 'queued', percent: null, text: 'Queued', stale };
    }
    if (IMPORTING.has(shown.state)) return { kind: 'importing', percent: 100, text: 'Importing…', stale };
    if (shown.state === 'stalled') return { kind: 'stalled', percent, text: percent + '% · stalled', stale };
    if (shown.state === 'failed' || shown.state === 'blocked') {
        return { kind: 'failed', percent, text: 'Failed · ' + (shown.message ?? shown.reason ?? 'see the download queue'), stale };
    }
    return { kind: 'downloading', percent, text: percent + '%' + (shown.etaSeconds ? ' · ' + etaText(shown.etaSeconds) : ''), stale };
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

const REMOVE_TEXT = 'Remove this torrent from the download queue? The download stops and the torrent leaves the client. Anything '
    + 'already downloaded is not deleted.';

/** A grab the added row shows: held, being sent, or in the client. */
const isLive = (operation: GrabOperation | null): operation is GrabOperation =>
    !!operation && (operation.state === 'pending' || operation.state === 'submitting' || operation.state === 'accepted');

/** The row a followed grab is about: the one pressed here, else the one with the grab's infohash (found again on reopening). */
const addedRowId = (operation: GrabOperation, pressedId: string | null, candidates: ReleaseCandidate[]) => {
    if (pressedId && candidates.some(candidate => candidate.releaseId === pressedId)) return pressedId;
    const hash = operation.infoHash;
    return (hash && candidates.find(candidate => candidate.infoHash === hash)?.releaseId) || null;
};

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
    return {
        accepted,
        x: isAdmin ? 'remove' : null,
        xOff: !queue?.row || removing,
        onX: remove,
        progress: queue?.denied ? null : progressOf(queue?.row ?? null, queue?.last ?? null)
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

    const queueRowId = queue?.row?.id ?? null;
    const removeFromQueue = useCallback(() => {
        if (!live || !queueRowId || removing || confirming.current) return;
        confirming.current = true;
        const id = live.id;
        confirm({ title: 'Remove the Torrent', text: REMOVE_TEXT + '<span class="jfmod-confirmName">' + escapeHtml(live.releaseTitle) + '</span>',
            confirmText: 'Remove', primary: 'delete' }).then(() => {
            setRemoving(true);
            setRemoveError('');
            // The queue page's torrent-only removal: the client forgets the torrent, its files stay on disk, nothing is blocklisted.
            return removeQueueRow(api, queueRowId, { removeFromClient: true, blocklist: false }).then(() => {
                release(id);
                clear();
                onChanged?.();
            }, (failure: unknown) => setRemoveError(problemOf(failure, 'It could not be removed. Please try again.').title))
                .finally(() => setRemoving(false));
        }, () => undefined).finally(() => {
            confirming.current = false;
        });
    }, [api, clear, confirming, live, onChanged, queueRowId, release, removing]);

    const added = live && addedId ? addedView({ accepted, isAdmin, queue, removing, cancelling, cancel, remove: removeFromQueue }) : null;

    useAddedFocus(container, addedId, added);

    // The search answered "this title already has an active grab" for a grab that has since ended here: rows are free again.
    const freed = !!data && !data.grab.available && data.grab.reason === 'grab_active' && !!activeId && released.includes(activeId);
    const view = freed && data ? { ...data, grab: { ...data.grab, available: true, reason: null } } : data;
    return { added, addedId, imported, removeError, view };
};

/**
 * The release picker (UX §9, PHASE4 A7): parsed summary plus the raw title, descending scores, a collapsed
 * rejected group with reasons, and one Enter to grab. The server holds a grab before sending it, so a focusable
 * Cancel follows the grabbed row during the hold (user decision 2). Rows only change on a deliberate search:
 * a new scope or profile. Nothing refetches underneath a focused row.
 */
const ReleasePickerDialog: FC<ReleasePickerProps> = ({ api, entryId, mediaType, episodes: givenEpisodes, initialEpisodeId, episodePage,
    seasonPage, intent, loadEpisodes, onChanged }) => {
    const { episodes, loading, listError } = useEpisodeList(givenEpisodes, loadEpisodes, onChanged);
    const [choice, setChoice] = useState(initialEpisodeId ?? (seasonPage === undefined ? '' : SEASON_PREFIX + seasonPage));
    const [profileId, setProfileId] = useState('');
    const [rejectedOpen, setRejectedOpen] = useState(false);
    const [progressKey, setProgressKey] = useState<string | null>(null);
    const container = useRef<HTMLDivElement>(null);
    const grab = useGrab(api, onChanged);
    // Pack scopes only where the plugin serves them; an older plugin keeps the episode list (season packs, 2026-10-08).
    const packs = usePluginCapabilities(api).includes(PACKS_CAPABILITY);
    const { chosen, isPack, waiting, searchIntent } = searchScope(choice, packs, mediaType, intent, loading);

    const profiles = useQuery({
        queryKey: ['JellyfinMod', api.basePath, 'QualityProfiles'],
        queryFn: ({ signal }) => getQualityProfiles(api, { signal }),
        retry: false
    });
    const search = useQuery({
        queryKey: ['JellyfinMod', api.basePath, 'Releases', entryId, choice, profileId, searchIntent ?? 'acquire'],
        // `intent` is sent only for another version, and `scope` only for a pack, so an acquire search of one episode or a
        // movie reads exactly as it did before.
        queryFn: ({ signal }) => {
            // A fresh key per search: the page reads what each indexer is doing from it while the search runs.
            const key = newKey('search');
            setProgressKey(key);
            return searchReleases(api, {
                entryId,
                episodeId: chosen.episodeId,
                profileId: profileId || undefined,
                intent: searchIntent === 'addVersion' ? searchIntent : undefined,
                progressKey: key,
                ...(isPack ? { scope: chosen.scope as 'season' | 'series', seasonNumber: chosen.seasonNumber } : {})
            }, { signal });
        },
        enabled: !waiting,
        retry: false,
        gcTime: 0,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false
    });

    let resultKey: string | null = null;
    if (!search.isFetching) resultKey = search.data?.searchId ?? (search.error ? 'error' : null);
    useEffect(() => {
        if (!resultKey) return;
        setRejectedOpen(false);
        window.requestAnimationFrame(() => {
            const root = container.current;
            const target = root?.querySelector<HTMLElement>('.jfmod-releaseRow:not([aria-disabled="true"])')
                ?? root?.querySelector<HTMLElement>('.jfmod-releaseRow, .jfmod-rejectedToggle')
                ?? root?.querySelector<HTMLElement>('.jfmod-releaseStatus');
            // Only the TV's D-pad needs a row focused for it: on a desktop the script focus left the first row highlighted as if
            // it were selected after a mouse click (user, 2026-10-11).
            if (target && layoutManager.tv) focusManager.focus(target);
        });
    }, [resultKey]);

    const { busy, operation, start } = grab;
    // One confirmation at a time (Replace, a rejected release, Remove the Torrent); a second activation while one is open does
    // nothing.
    const confirming = useRef(false);
    const { added, addedId, imported, removeError, view: data } = useAddedRow({ api, entryId, data: search.data, grab, onChanged,
        container, confirming });
    const onGrab = useCallback((candidate: ReleaseCandidate, mode: GrabMode | undefined, plan: RowPlan) => {
        if (!data?.grab.available || busy || operation?.state === 'accepted' || search.isFetching || candidate.heldQuality) return;
        const chosenRejection = !candidate.eligible;
        if (mode !== 'replace' && !chosenRejection) {
            start(data.searchId, candidate, mode);
            return;
        }
        if (confirming.current) return;
        confirming.current = true;
        confirm(confirmationFor(candidate, mode, plan, mediaType))
            .then(() => start(data.searchId, candidate, mode, chosenRejection), () => undefined).finally(() => {
                confirming.current = false;
            });
    }, [busy, data, mediaType, operation, search.isFetching, start]);
    const toggleRejected = useCallback(() => setRejectedOpen(value => !value), []);
    // The TV's action sheet may offer the disabled loading line too; choosing it changes nothing.
    const chooseScope = useCallback((value: string) => {
        if (value !== LOADING_VALUE) setChoice(value);
    }, []);
    const pageEpisode = episodePage && initialEpisodeId ? episodes.find(episode => episode.id === initialEpisodeId) : undefined;
    const scope = useMemo(() => scopeOptions({ episodes, packs, pageEpisode, pageSeason: seasonPage, loading }),
        [episodes, packs, pageEpisode, seasonPage, loading]);
    const defaultProfileLabel = profileLabel(data, !!profileId);
    const profileOptions = useMemo<EmbySelectOption[]>(() => [
        { value: '', label: defaultProfileLabel },
        ...(profiles.data ?? []).map(profile => ({ value: profile.id, label: profile.name }))
    ], [defaultProfileLabel, profiles.data]);

    const searchError = search.error ? problemOf(search.error, 'Release search failed. Please try again.').title : '';
    const eligible = data?.candidates.filter(candidate => candidate.eligible) ?? [];
    const rejected = data?.candidates.filter(candidate => !candidate.eligible) ?? [];
    // A new search (another season, another profile) clears the rows of the last one and starts from the searching state; only
    // current rows can grab.
    const grabDisabled = !data?.grab.available || busy || grab.starting || grab.flash || operation?.state === 'accepted' || search.isFetching;
    const failedIndexers = data?.indexers.filter(failed) ?? [];
    const unavailable = unavailableText(data, search.dataUpdatedAt);
    const status = [statusText(data, waiting, search.isFetching && !data?.candidates.length, searchError, unavailable), grab.error,
        removeError]
        .filter(Boolean).join(' · ');
    const plans = new Map(data ? data.candidates.map(candidate => [candidate.releaseId,
        rowPlanFor(candidate, data, packs, (data.intent ?? searchIntent) === 'addVersion', mediaType)]) : []);
    const choices = Array.from(plans.values()).some(plan => plan.choices);
    const replaceChoices = Array.from(plans.values()).some(plan => plan.choices && plan.replace);
    const grabStatus = operation && <GrabStatus operation={operation} now={grab.now} adopted={grab.adopted} />;
    // The block sits under the row the grab is about: the added row, or the one pressed when the grab failed.
    const blockRowId = addedId ?? grab.releaseId;
    // An imported row reads as the in-library row: a green check after the quality and no actions.
    const shownCandidate = (candidate: ReleaseCandidate) => (imported.includes(candidate.releaseId) ? { ...candidate, heldQuality: true } : candidate);

    const notice = noticeText(choices, replaceChoices, data?.target.scope, intent === 'addVersion' && !isPack);

    const { block, hasRows, bare, spoken, shown, searching } = useSearchView({ api, progressKey, fetching: search.isFetching, waiting,
        error: searchError, data, unavailable, receivedAt: search.dataUpdatedAt, status, grabError: grab.error });
    const stale = search.isFetching;

    const { releaseId: grabbedId, pressed, flash, starting } = grab;
    const operationState = operation?.state;
    const actionState = useCallback((releaseId: string, mode: 'add' | 'replace'): ActionState => {
        if (releaseId !== grabbedId || mode !== (pressed === 'replace' ? 'replace' : 'add')) return 'idle';
        if (flash) return 'failed';
        if (starting || operationState === 'pending' || operationState === 'submitting') return 'working';
        return operationState === 'accepted' ? 'done' : 'idle';
    }, [flash, grabbedId, operationState, pressed, starting]);

    return <div className={classNames('jfmod-releasePicker', { 'jfmod-releasePicker--holding': !!added })} ref={container}>
        {/* The choices share one line where the screen allows (user, 2026-10-08). The scope switch keeps the episode
            select's id, so runners that pick an episode by id still work. */}
        <div className='jfmod-releaseControls'>
            {mediaType === 'series' && <EmbySelect key={scope.label} id='jfmod-releaseEpisode' label={scope.label} value={choice}
                options={scope.options} onChange={chooseScope} />}
            {!!profiles.data?.length && <EmbySelect id='jfmod-releaseProfile' label='Quality Profile'
                value={profileId} options={profileOptions} onChange={setProfileId} />}
        </div>
        {listError && <p className='jfmod-releaseNotice jfmod-releaseNotice--info jfmod-episodeListFailure'>{listError}</p>}
        {notice && !bare && <p className='jfmod-releaseNotice jfmod-releaseNotice--info'>{notice}</p>}
        <p className={classNames('jfmod-releaseStatus', { 'jfmod-releaseStatus--bare': bare })} role='status' tabIndex={-1}>
            {spoken && <span className='jfmod-releaseStatus-spoken'>{spoken}</span>}
            {shown && <span aria-hidden={searching}>{shown}</span>}
        </p>
        {failedIndexers.length > 0 && !bare && <p className='jfmod-releaseNotice'>
            {unavailable ? '' : 'Partial results: '}
            {failedIndexers.map(outcome => outcome.name + ' (' + (outcome.message ?? outcome.status) + ')').join('; ')}
        </p>}
        {/* The grab's status stays in view for its whole hold, also when a changed search no longer lists the release it grabbed
            (whole-review chunk 4a, P2 4). */}
        {(!blockRowId || !eligible.some(candidate => candidate.releaseId === blockRowId)) && grabStatus}
        <div className={classNames('jfmod-releaseList', { 'jfmod-releaseList--stale': stale && hasRows })}>
            {eligible.map(candidate => <Fragment key={candidate.releaseId}>
                <ReleaseRow candidate={shownCandidate(candidate)} search={data} disabled={grabDisabled}
                    plan={plans.get(candidate.releaseId) ?? PLAIN_ROW} onGrab={onGrab} actionState={actionState}
                    added={candidate.releaseId === addedId ? added : null} />
                {blockRowId === candidate.releaseId && grabStatus}
            </Fragment>)}
            {block && <SearchBlock mode={block.mode} caption={block.caption} lines={block.lines} over={search.isFetching && hasRows} />}
        </div>
        {rejected.length > 0 && <div className='jfmod-rejectedGroup'>
            <button type='button' className={flatButtonClass() + ' jfmod-rejectedToggle'} aria-expanded={rejectedOpen} onClick={toggleRejected}>
                {rejectedOpen ? '▾' : '▸'} {rejected.length} Rejected
            </button>
            {rejectedOpen && rejected.map(candidate => <RejectedRow key={candidate.releaseId} candidate={shownCandidate(candidate)} search={data}
                disabled={grabDisabled} plan={plans.get(candidate.releaseId) ?? PLAIN_ROW} onGrab={onGrab} actionState={actionState}
                added={candidate.releaseId === addedId ? added : null} />)}
        </div>}
    </div>;
};

export default ReleasePickerDialog;
