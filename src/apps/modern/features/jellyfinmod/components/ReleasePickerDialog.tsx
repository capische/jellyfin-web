import type { Api } from '@jellyfin/sdk/lib/api';
import CircularProgress from '@mui/material/CircularProgress';
import { useQuery } from '@tanstack/react-query';
import classNames from 'classnames';
import React, { type FC, Fragment, type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import confirm from 'components/confirm/confirm';
import focusManager from 'components/focusManager';
import layoutManager from 'components/layoutManager';

import { cancelGrab, getGrab, getQualityProfiles, grabRelease, searchReleases } from '../api/modApi';
import { ADD_VERSION_UNAVAILABLE } from '../constants/versions';
import { PACKS_CAPABILITY, usePluginCapabilities } from '../hooks/useAcquisition';
import type { GrabMode, GrabOperation, IndexerOutcome, ReleaseCandidate, ReleaseIntent, ReleaseSearch } from '../types/acquisition';

import EmbySelect, { type EmbySelectOption } from './EmbySelect';
import { flatButtonClass, raisedButtonClass } from '../utils/flatButton';

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
     * page's switch offers All Seasons, each season and every episode (season packs, 2026-10-08, user decision 1).
     */
    episodePage?: boolean;
    /** `addVersion` searches for another version beside the held file (P6.M6, opened by Get another quality). */
    intent?: ReleaseIntent;
    /** Called after a grab reaches a final state, so the opener can refresh history and summaries. */
    onChanged?: () => void;
}

const SOURCES = new Map([
    ['remux', 'Remux'], ['bluray', 'BluRay'], ['webdl', 'WEB-DL'], ['webrip', 'WEBRip'], ['hdtv', 'HDTV'], ['dvd', 'DVD'], ['cam', 'CAM']
]);
const CODECS = new Map([['h264', 'H.264'], ['h265', 'HEVC'], ['av1', 'AV1'], ['xvid', 'XviD'], ['vc1', 'VC-1'], ['mpeg2', 'MPEG-2']]);
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

const formatSize = (bytes: number | null) => {
    if (bytes === null) return 'size unknown';
    if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
    return Math.max(1, Math.round(bytes / 1e6)) + ' MB';
};

const summary = (candidate: ReleaseCandidate) => {
    const parsed = candidate.parsed;
    const source = parsed.source ? SOURCES.get(parsed.source) ?? parsed.source : null;
    const quality = [parsed.resolution, source].filter(Boolean).join(' ') || 'Unknown quality';
    const codec = parsed.codec ? CODECS.get(parsed.codec) ?? parsed.codec : null;
    return [quality, codec, parsed.hdr, parsed.audio, parsed.group].filter(Boolean).join(' · ');
};

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

// An idempotency key only has to be unique per grab attempt; it is not a secret.
// eslint-disable-next-line sonarjs/pseudo-random
const newKey = () => 'grab-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);

const failed = (outcome: IndexerOutcome) => outcome.status !== 'ok' && outcome.status !== 'no_results';

/**
 * When every indexer failed and none returned a row, the search found nothing because nothing answered (rate limits, an
 * open breaker): `Indexers are unavailable until 16:05.` from the longest wait, else `right now` (coordinator, 2026-10-08).
 * Null when any indexer answered.
 */
const unavailableText = (search: ReleaseSearch | undefined, receivedAt: number): string | null => {
    if (!search || search.candidates.length > 0 || search.indexers.length === 0 || !search.indexers.every(failed)) return null;
    const wait = Math.max(0, ...search.indexers.map(outcome => outcome.retryAfterSeconds ?? 0));
    if (wait <= 0) return 'Indexers are unavailable right now.';
    const until = new Date((receivedAt || Date.now()) + wait * 1000);
    return 'Indexers are unavailable until ' + until.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) + '.';
};

const statusText = (search: ReleaseSearch | undefined, waiting: string, loading: boolean, error: string, unavailable: string | null) => {
    if (waiting) return waiting;
    // A search in progress shows the spinner instead of words (user, 2026-10-08).
    if (loading) return '';
    if (error) return error;
    if (!search) return '';
    let text = `${search.eligibleCount} ${search.eligibleCount === 1 ? 'release' : 'releases'}`;
    if (search.eligibleCount === 0) text = search.rejectedCount === 0 ? unavailable ?? 'No releases found.' : 'No release passes the profile.';
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

const ReleaseLines: FC<{ candidate: ReleaseCandidate; search: ReleaseSearch | undefined }> = ({ candidate, search }) => {
    const coverage = coverageText(candidate, search);
    const held = candidate.coverage?.held ?? 0;
    return <>
        <span className='jfmod-releaseSummary'>
            <span className='jfmod-releaseQuality'>{summary(candidate)}</span>
            {coverage && <span className='jfmod-releaseChip jfmod-releaseChip--coverage'>{coverage}</span>}
            {held > 0 && <span className='jfmod-releaseChip jfmod-releaseChip--held'>{held} held</span>}
            {candidate.freeleech && <span className='jfmod-releaseChip'>Freeleech</span>}
            {candidate.proper && <span className='jfmod-releaseChip'>Proper</span>}
            {candidate.repack && <span className='jfmod-releaseChip'>Repack</span>}
            {candidate.heldQuality && <span className='jfmod-releaseChip jfmod-releaseChip--held'>In library</span>}
            <span className='jfmod-releaseMeta'>
                {formatSize(candidate.size)} · {candidate.seeders === null ? 'seeders unknown' : candidate.seeders + '↑'}
                {' · '}{candidate.indexerName} · score {candidate.score}
                {candidate.heldQuality && <span className='jfmod-releaseHeld'> · this quality is already in the library</span>}
            </span>
        </span>
        {/* The raw title is always visible: it is the only diagnostic when a grab goes wrong (UX §9). */}
        <span className='jfmod-releaseTitle'>{candidate.rawTitle}</span>
    </>;
};

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
const actionClass = (extra?: string) => classNames('paper-icon-button-light jfmod-releaseAction', extra, { 'show-focus': layoutManager.tv });

interface ReleaseRowProps {
    candidate: ReleaseCandidate;
    search: ReleaseSearch | undefined;
    disabled: boolean;
    plan: RowPlan;
    onGrab: (candidate: ReleaseCandidate, mode: GrabMode | undefined, plan: RowPlan) => void;
}

/**
 * One eligible release: the row is a button that grabs with the first action; where the scope holds files, Add and Replace
 * follow it as sibling icon buttons, each its own D-pad stop (no nested buttons). A quality already in the library stays
 * focusable for reading, but cannot be grabbed: the server would answer 409 `held_quality` (P6.M6).
 */
const ReleaseRow: FC<ReleaseRowProps> = ({ candidate, search, disabled, plan, onGrab }) => {
    const off = disabled || !!candidate.heldQuality;
    const activate = useCallback(() => onGrab(candidate, plan.first, plan), [candidate, onGrab, plan]);
    const add = useCallback((event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        onGrab(candidate, 'add', plan);
    }, [candidate, onGrab, plan]);
    const replace = useCallback((event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        onGrab(candidate, 'replace', plan);
    }, [candidate, onGrab, plan]);
    return <div className='jfmod-releaseItem'>
        <button type='button' className='jfmod-releaseRow' aria-disabled={off} onClick={activate}>
            <ReleaseLines candidate={candidate} search={search} />
        </button>
        {plan.choices && <span className='jfmod-releaseActions'>
            <button type='button' className={actionClass()} title='Add' aria-label={'Add ' + candidate.rawTitle + ' beside the files held'}
                aria-disabled={off} data-jfmod-release-add={candidate.releaseId} onClick={add}>
                <span className='material-icons add' aria-hidden='true' />
            </button>
            {plan.replace && <button type='button' className={actionClass('jfmod-releaseAction--danger')} title='Replace'
                aria-label={'Replace the files held with ' + candidate.rawTitle} aria-disabled={off}
                data-jfmod-release-replace={candidate.releaseId} onClick={replace}>
                <span className='material-icons swap_horiz' aria-hidden='true' />
            </button>}
        </span>}
    </div>;
};

/** Rejected rows stay focusable for reading on a D-pad, but nothing can grab them (P4.A1). */
const RejectedRow: FC<{ candidate: ReleaseCandidate; search: ReleaseSearch | undefined }> = ({ candidate, search }) =>
    <button type='button' className='jfmod-releaseRow jfmod-releaseRow--rejected' aria-disabled='true'>
        <ReleaseLines candidate={candidate} search={search} />
        <span className='jfmod-releaseReasons'>{candidate.rejections.map(rejection => rejection.message).join(' ')}</span>
    </button>;

/** Replace's confirmation (user decision 2): what goes, and that nothing goes before the new files are in the library. */
const replaceText = (plan: RowPlan, mediaType: 'movie' | 'series') => {
    if (plan.held > 1) {
        return `Replace the files of ${plan.held} episodes? Their current files are removed once the new ones are in the library.`;
    }
    let target = mediaType === 'movie' ? 'this movie' : 'this episode';
    if (plan.pack) target = 'one episode';
    return `Replace the file of ${target}? Its current file is removed once the new one is in the library.`;
};

const GrabStatus: FC<{ operation: GrabOperation; now: number; cancelling: boolean; onCancel: () => void }> =
    ({ operation, now, cancelling, onCancel }) => {
        const seconds = Math.max(0, Math.ceil((Date.parse(operation.holdUntil) - now) / 1000));
        const accepted = operation.state === 'accepted';
        return <div className='jfmod-grabStatus' role='status' aria-live='polite'>
            {operation.state === 'pending' && <>
                <span>Sending to the download client in {seconds} s.</span>
                <button type='button' className={raisedButtonClass('jfmod-grabCancel')} aria-disabled={cancelling} onClick={onCancel}>
                    Cancel
                </button>
            </>}
            {operation.state === 'submitting' && <span>Sending to the download client…</span>}
            {accepted && <span>The download client accepted the torrent.</span>}
            {accepted && operation.openUrl && <a className={flatButtonClass() + ' jfmod-grabOpen'} href={operation.openUrl}
                target='_blank' rel='noopener noreferrer'>Open in Client</a>}
            {!accepted && isFinal(operation) && <span>{operation.message}</span>}
        </div>;
    };

/** Follows one grab through its hold and handoff, and exposes an idempotent Cancel (user decision 2). */
const useGrab = (api: Api, onChanged?: () => void) => {
    const [operation, setOperation] = useState<GrabOperation | null>(null);
    const [releaseId, setReleaseId] = useState<string | null>(null);
    const [cancelling, setCancelling] = useState(false);
    const [error, setError] = useState('');
    const [now, setNow] = useState(() => Date.now());
    const activating = useRef(false);
    const mounted = useRef(true);
    // The operation this picker follows. A response about another operation, or one that would take a finished
    // operation back to an earlier state, is stale and dropped (whole-review chunk 4a, P2 5).
    const current = useRef<GrabOperation | null>(null);
    useEffect(() => () => {
        mounted.current = false;
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
        onChanged?.();
    }, [finalKey, onChanged]);

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
    const start = useCallback((searchId: string, candidate: ReleaseCandidate, mode?: GrabMode) => {
        // One activation grabs; another Enter or click while a grab is in flight does nothing.
        if (activating.current) return;
        activating.current = true;
        const mine = ++attempt.current;
        const isLatest = () => mounted.current && attempt.current === mine;
        setReleaseId(candidate.releaseId);
        setError('');
        // A mode is sent only by plugins with packs; an older plugin's grab reads exactly as before.
        grabRelease(api, { searchId, releaseId: candidate.releaseId, idempotencyKey: newKey(), ...(mode ? { mode } : {}) }).then(result => {
            if (!isLatest()) return;
            setNow(Date.now());
            follow(result);
        }).catch(failure => {
            if (!isLatest()) return;
            activating.current = false;
            const problem = problemOf(failure, 'The release could not be grabbed.');
            setError(problem.title);
            if (problem.operationId) {
                setReleaseId(null);
                getGrab(api, problem.operationId).then(found => {
                    if (isLatest()) follow(found);
                }).catch(() => undefined);
            }
        });
    }, [api, follow]);

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

    return { operation, releaseId, cancelling, error, now, start, cancel, busy: !!operation && !isFinal(operation) };
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
}

/**
 * The scope switch (user decision 1, 2026-10-08). On an episode's page: that episode, its season and All Seasons. On a series
 * page: All Seasons, each season with aired episodes other than specials, then every episode. Without packs it is the episode
 * list it always was.
 */
const scopeOptions = ({ episodes, packs, pageEpisode }: ScopeOptions): { label: string; options: EmbySelectOption[] } => {
    const episodeOptions = episodes.map(episode => ({ value: episode.id, label: episode.label }));
    if (!packs) return { label: 'Episode', options: [{ value: '', label: 'Choose an episode' }, ...episodeOptions] };
    if (pageEpisode) {
        return { label: 'Search for', options: [
            { value: pageEpisode.id, label: 'Episode: ' + episodeCode(pageEpisode) + ' · ' + pageEpisode.title },
            ...(pageEpisode.seasonNumber > 0 ?
                [{ value: SEASON_PREFIX + pageEpisode.seasonNumber, label: 'Season ' + pageEpisode.seasonNumber }] : []),
            { value: SERIES_VALUE, label: 'All Seasons' }
        ] };
    }
    const seasons = Array.from(new Set(episodes.filter(episode => episode.seasonNumber > 0 && !episode.unaired)
        .map(episode => episode.seasonNumber))).sort((a, b) => a - b);
    return { label: 'Search for', options: [
        { value: '', label: 'Choose what to search for' },
        ...(seasons.length > 0 ? [{ value: SERIES_VALUE, label: 'All Seasons' }] : []),
        ...seasons.map(season => ({ value: SEASON_PREFIX + season, label: 'Season ' + season })),
        ...episodeOptions
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

/** The search a scope choice asks for; nothing while a series has no choice yet. */
const searchScope = (choice: string, packs: boolean, mediaType: 'movie' | 'series', intent: ReleaseIntent | undefined) => {
    const chosen = parseChoice(packs || !choice.includes(':') ? choice : '');
    const isPack = chosen.scope === 'season' || chosen.scope === 'series';
    let waiting = '';
    if (mediaType === 'series' && !chosen.scope) waiting = packs ? 'Choose what to search for.' : 'Choose an episode to search for.';
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

/**
 * The release picker (UX §9, PHASE4 A7): parsed summary plus the raw title, descending scores, a collapsed
 * rejected group with reasons, and one Enter to grab. The server holds a grab before sending it, so a focusable
 * Cancel follows the grabbed row during the hold (user decision 2). Rows only change on a deliberate search:
 * a new scope or profile. Nothing refetches underneath a focused row.
 */
const ReleasePickerDialog: FC<ReleasePickerProps> = ({ api, entryId, mediaType, episodes, initialEpisodeId, episodePage, intent,
    onChanged }) => {
    const [choice, setChoice] = useState(initialEpisodeId ?? '');
    const [profileId, setProfileId] = useState('');
    const [rejectedOpen, setRejectedOpen] = useState(false);
    const container = useRef<HTMLDivElement>(null);
    const grab = useGrab(api, onChanged);
    // Pack scopes only where the plugin serves them; an older plugin keeps the episode list (season packs, 2026-10-08).
    const packs = usePluginCapabilities(api).includes(PACKS_CAPABILITY);
    const { chosen, isPack, waiting, searchIntent } = searchScope(choice, packs, mediaType, intent);

    const profiles = useQuery({
        queryKey: ['JellyfinMod', api.basePath, 'QualityProfiles'],
        queryFn: ({ signal }) => getQualityProfiles(api, { signal }),
        retry: false
    });
    const search = useQuery({
        queryKey: ['JellyfinMod', api.basePath, 'Releases', entryId, choice, profileId, searchIntent ?? 'acquire'],
        // `intent` is sent only for another version, and `scope` only for a pack, so an acquire search of one episode or a
        // movie reads exactly as it did before.
        queryFn: ({ signal }) => searchReleases(api, {
            entryId,
            episodeId: chosen.episodeId,
            profileId: profileId || undefined,
            intent: searchIntent === 'addVersion' ? searchIntent : undefined,
            ...(isPack ? { scope: chosen.scope as 'season' | 'series', seasonNumber: chosen.seasonNumber } : {})
        }, { signal }),
        enabled: !waiting,
        retry: false,
        gcTime: 0,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        // The previous rows stay mounted while a deliberate new search loads, so focus is never thrown away.
        placeholderData: previous => previous
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
            if (target) focusManager.focus(target);
        });
    }, [resultKey]);

    const data = search.data;
    const { busy, operation, start } = grab;
    const stale = search.isFetching || search.isPlaceholderData;
    // One Replace confirmation at a time; a second activation while it is open does nothing.
    const confirming = useRef(false);
    const onGrab = useCallback((candidate: ReleaseCandidate, mode: GrabMode | undefined, plan: RowPlan) => {
        if (!data?.grab.available || busy || operation?.state === 'accepted' || stale || candidate.heldQuality) return;
        if (mode !== 'replace') {
            start(data.searchId, candidate, mode);
            return;
        }
        if (confirming.current) return;
        confirming.current = true;
        confirm({
            title: plan.held > 1 ? 'Replace the Files' : 'Replace the File',
            text: replaceText(plan, mediaType),
            confirmText: 'Replace',
            primary: 'delete'
        }).then(() => start(data.searchId, candidate, 'replace'), () => undefined).finally(() => {
            confirming.current = false;
        });
    }, [busy, data, mediaType, operation, stale, start]);
    const toggleRejected = useCallback(() => setRejectedOpen(value => !value), []);
    const pageEpisode = episodePage && initialEpisodeId ? episodes.find(episode => episode.id === initialEpisodeId) : undefined;
    const scope = useMemo(() => scopeOptions({ episodes, packs, pageEpisode }), [episodes, packs, pageEpisode]);
    const defaultProfileLabel = profileLabel(data, !!profileId);
    const profileOptions = useMemo<EmbySelectOption[]>(() => [
        { value: '', label: defaultProfileLabel },
        ...(profiles.data ?? []).map(profile => ({ value: profile.id, label: profile.name }))
    ], [defaultProfileLabel, profiles.data]);

    const searchError = search.error ? problemOf(search.error, 'Release search failed. Please try again.').title : '';
    const eligible = data?.candidates.filter(candidate => candidate.eligible) ?? [];
    const rejected = data?.candidates.filter(candidate => !candidate.eligible) ?? [];
    // Rows from a previous search stay visible while a new one loads, but only current rows can grab.
    const grabDisabled = !data?.grab.available || busy || operation?.state === 'accepted' || search.isFetching || search.isPlaceholderData;
    const failedIndexers = data?.indexers.filter(failed) ?? [];
    const unavailable = unavailableText(data, search.dataUpdatedAt);
    const status = [statusText(data, waiting, search.isFetching, searchError, unavailable), grab.error].filter(Boolean).join(' · ');
    const plans = new Map(data ? eligible.map(candidate => [candidate.releaseId,
        rowPlanFor(candidate, data, packs, (data.intent ?? searchIntent) === 'addVersion', mediaType)]) : []);
    const choices = Array.from(plans.values()).some(plan => plan.choices);
    const replaceChoices = Array.from(plans.values()).some(plan => plan.choices && plan.replace);
    const grabStatus = operation
        && <GrabStatus operation={operation} now={grab.now} cancelling={grab.cancelling} onCancel={grab.cancel} />;

    const notice = noticeText(choices, replaceChoices, data?.target.scope, intent === 'addVersion' && !isPack);

    return <div className='jfmod-releasePicker' ref={container}>
        {/* The choices share one line where the screen allows (user, 2026-10-08). The scope switch keeps the episode
            select's id, so runners that pick an episode by id still work. */}
        <div className='jfmod-releaseControls'>
            {mediaType === 'series' && <EmbySelect key={scope.label} id='jfmod-releaseEpisode' label={scope.label} value={choice}
                options={scope.options} onChange={setChoice} />}
            {!!profiles.data?.length && <EmbySelect id='jfmod-releaseProfile' label='Quality profile for this search'
                value={profileId} options={profileOptions} onChange={setProfileId} />}
        </div>
        {notice && <p className='jfmod-releaseNotice jfmod-releaseNotice--info'>{notice}</p>}
        <p className='jfmod-releaseStatus' role='status' tabIndex={-1}>
            {search.isFetching && <CircularProgress className='jfmod-releaseSpinner' size='1.4em' thickness={5} color='inherit'
                aria-label='Searching indexers' />}
            {status}
        </p>
        {failedIndexers.length > 0 && <p className='jfmod-releaseNotice'>
            {unavailable ? '' : 'Partial results: '}
            {failedIndexers.map(outcome => outcome.name + ' (' + (outcome.message ?? outcome.status) + ')').join('; ')}
        </p>}
        {/* The grab's status and Cancel stay in view for its whole hold, also when a changed search no longer lists the
            release it grabbed (whole-review chunk 4a, P2 4). */}
        {(!grab.releaseId || !eligible.some(candidate => candidate.releaseId === grab.releaseId)) && grabStatus}
        <div className='jfmod-releaseList'>
            {eligible.map(candidate => <Fragment key={candidate.releaseId}>
                <ReleaseRow candidate={candidate} search={data} disabled={grabDisabled} plan={plans.get(candidate.releaseId) ?? PLAIN_ROW}
                    onGrab={onGrab} />
                {grab.releaseId === candidate.releaseId && grabStatus}
            </Fragment>)}
        </div>
        {rejected.length > 0 && <div className='jfmod-rejectedGroup'>
            <button type='button' className={flatButtonClass() + ' jfmod-rejectedToggle'} aria-expanded={rejectedOpen} onClick={toggleRejected}>
                {rejectedOpen ? '▾' : '▸'} {rejected.length} Rejected
            </button>
            {rejectedOpen && rejected.map(candidate => <RejectedRow key={candidate.releaseId} candidate={candidate} search={data} />)}
        </div>}
    </div>;
};

export default ReleasePickerDialog;
