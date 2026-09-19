import type { Api } from '@jellyfin/sdk/lib/api';
import { useQuery } from '@tanstack/react-query';
import React, { type ChangeEvent, type FC, Fragment, useCallback, useEffect, useRef, useState } from 'react';

import focusManager from 'components/focusManager';

import { cancelGrab, getGrab, getQualityProfiles, grabRelease, searchReleases } from '../api/modApi';
import { ADD_VERSION_UNAVAILABLE } from '../constants/versions';
import type { GrabOperation, ReleaseCandidate, ReleaseIntent, ReleaseSearch } from '../types/acquisition';

import './releasePicker.scss';

export interface ReleasePickerEpisode {
    id: string;
    label: string;
}

export interface ReleasePickerProps {
    api: Api;
    entryId: string;
    mediaType: 'movie' | 'series';
    episodes: ReleasePickerEpisode[];
    initialEpisodeId?: string;
    /** `addVersion` searches for another version beside the held file (P6.M6, opened by Get another quality). */
    intent?: ReleaseIntent;
    onClose: () => void;
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
    const known = typeof data?.type === 'string' ? ADD_VERSION_UNAVAILABLE.get(data.type) : undefined;
    return {
        title: known ?? (typeof data?.title === 'string' ? data.title : fallback),
        operationId: typeof data?.operationId === 'string' ? data.operationId : null
    };
};

// An idempotency key only has to be unique per grab attempt; it is not a secret.
// eslint-disable-next-line sonarjs/pseudo-random
const newKey = () => 'grab-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);

const statusText = (search: ReleaseSearch | undefined, waitingForEpisode: boolean, loading: boolean, error: string) => {
    if (waitingForEpisode) return 'Choose an episode to search for.';
    if (loading) return 'Searching indexers…';
    if (error) return error;
    if (!search) return '';
    let text = `${search.eligibleCount} ${search.eligibleCount === 1 ? 'release' : 'releases'}`;
    if (search.eligibleCount === 0) text = search.rejectedCount === 0 ? 'No releases found.' : 'No release passes the profile.';
    if (search.truncated) text += ' · more results exist than were read';
    if (!search.grab.available && search.grab.reason) text += ' · ' + (GRAB_REASONS.get(search.grab.reason) ?? 'Grabbing is unavailable.');
    return text;
};

const profileLabel = (search: ReleaseSearch | undefined, overridden: boolean) => {
    if (!search || overridden) return 'Title default';
    return (search.profile.inherited ? 'Default' : 'Title profile') + ' (' + search.profile.name + ')';
};

const ReleaseLines: FC<{ candidate: ReleaseCandidate }> = ({ candidate }) => <>
    <span className='jfmod-releaseSummary'>
        <span className='jfmod-releaseQuality'>{summary(candidate)}</span>
        {candidate.freeleech && <span className='jfmod-releaseChip'>Freeleech</span>}
        {candidate.proper && <span className='jfmod-releaseChip'>Proper</span>}
        {candidate.repack && <span className='jfmod-releaseChip'>Repack</span>}
        {candidate.heldQuality && <span className='jfmod-releaseChip jfmod-releaseChip--held'>In library</span>}
        <span className='jfmod-releaseMeta'>
            {formatSize(candidate.size)} · {candidate.seeders === null ? 'seeders unknown' : candidate.seeders + '↑'}
            {' · '}{candidate.indexerName} · score {candidate.score}
        </span>
    </span>
    {/* The raw title is always visible: it is the only diagnostic when a grab goes wrong (UX §9). */}
    <span className='jfmod-releaseTitle'>{candidate.rawTitle}</span>
</>;

/**
 * A quality already in the library stays focusable for reading, but cannot be grabbed: the server would answer
 * 409 `held_quality` (P6.M6).
 */
const ReleaseRow: FC<{ candidate: ReleaseCandidate; disabled: boolean; onGrab: (candidate: ReleaseCandidate) => void }> =
    ({ candidate, disabled, onGrab }) => {
        const activate = useCallback(() => onGrab(candidate), [candidate, onGrab]);
        return <button type='button' className='jfmod-releaseRow' aria-disabled={disabled || !!candidate.heldQuality} onClick={activate}>
            <ReleaseLines candidate={candidate} />
            {candidate.heldQuality && <span className='jfmod-releaseHeld'>This quality is already in the library.</span>}
        </button>;
    };

/** Rejected rows stay focusable for reading on a D-pad, but nothing can grab them (P4.A1). */
const RejectedRow: FC<{ candidate: ReleaseCandidate }> = ({ candidate }) =>
    <button type='button' className='jfmod-releaseRow jfmod-releaseRow--rejected' aria-disabled='true'>
        <ReleaseLines candidate={candidate} />
        <span className='jfmod-releaseReasons'>{candidate.rejections.map(rejection => rejection.message).join(' ')}</span>
    </button>;

const GrabStatus: FC<{ operation: GrabOperation; now: number; cancelling: boolean; onCancel: () => void }> =
    ({ operation, now, cancelling, onCancel }) => {
        const seconds = Math.max(0, Math.ceil((Date.parse(operation.holdUntil) - now) / 1000));
        const accepted = operation.state === 'accepted';
        return <div className='jfmod-grabStatus' role='status' aria-live='polite'>
            {operation.state === 'pending' && <>
                <span>Sending to the download client in {seconds} s.</span>
                <button type='button' className='emby-button raised jfmod-grabCancel' aria-disabled={cancelling} onClick={onCancel}>
                    Cancel
                </button>
            </>}
            {operation.state === 'submitting' && <span>Sending to the download client…</span>}
            {accepted && <span>The download client accepted the torrent.</span>}
            {accepted && operation.openUrl && <a className='emby-button jfmod-grabOpen' href={operation.openUrl}
                target='_blank' rel='noopener noreferrer'>Open in client</a>}
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
    useEffect(() => () => {
        mounted.current = false;
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
        const timer = window.setInterval(() => {
            setNow(Date.now());
            getGrab(api, followId).then(latest => {
                if (mounted.current) setOperation(latest);
            }).catch(() => { /* Keep the last known state; the next tick asks again. */ });
        }, 1000);
        return () => window.clearInterval(timer);
    }, [api, followId]);

    const start = useCallback((searchId: string, candidate: ReleaseCandidate) => {
        // One activation grabs; another Enter or click while a grab is in flight does nothing.
        if (activating.current) return;
        activating.current = true;
        setReleaseId(candidate.releaseId);
        setError('');
        grabRelease(api, { searchId, releaseId: candidate.releaseId, idempotencyKey: newKey() }).then(result => {
            if (!mounted.current) return;
            setNow(Date.now());
            setOperation(result);
        }).catch(failure => {
            if (!mounted.current) return;
            activating.current = false;
            const problem = problemOf(failure, 'The release could not be grabbed.');
            setError(problem.title);
            if (problem.operationId) {
                setReleaseId(null);
                getGrab(api, problem.operationId).then(setOperation).catch(() => undefined);
            }
        });
    }, [api]);

    const cancel = useCallback(() => {
        if (!operation || cancelling) return;
        setCancelling(true);
        cancelGrab(api, operation.id)
            .then(setOperation)
            .catch(() => getGrab(api, operation.id).then(setOperation).catch(() => undefined))
            .finally(() => {
                if (mounted.current) setCancelling(false);
            });
    }, [api, cancelling, operation]);

    return { operation, releaseId, cancelling, error, now, start, cancel, busy: !!operation && !isFinal(operation) };
};

/**
 * The release picker (UX §9, PHASE4 A7): parsed summary plus the raw title, descending scores, a collapsed
 * rejected group with reasons, and one Enter to grab. The server holds a grab before sending it, so a focusable
 * Cancel follows the grabbed row during the hold (user decision 2). Rows only change on a deliberate search:
 * a new episode or profile. Nothing refetches underneath a focused row.
 */
const ReleasePickerDialog: FC<ReleasePickerProps> = ({ api, entryId, mediaType, episodes, initialEpisodeId, intent, onClose, onChanged }) => {
    const [episodeId, setEpisodeId] = useState(initialEpisodeId ?? '');
    const [profileId, setProfileId] = useState('');
    const [rejectedOpen, setRejectedOpen] = useState(false);
    const container = useRef<HTMLDivElement>(null);
    const grab = useGrab(api, onChanged);
    const waitingForEpisode = mediaType === 'series' && !episodeId;

    const profiles = useQuery({
        queryKey: ['JellyfinMod', api.basePath, 'QualityProfiles'],
        queryFn: ({ signal }) => getQualityProfiles(api, { signal }),
        retry: false
    });
    const search = useQuery({
        queryKey: ['JellyfinMod', api.basePath, 'Releases', entryId, episodeId, profileId, intent ?? 'acquire'],
        // `intent` is sent only for another version, so an acquire search reads exactly as it did before Phase 6.
        queryFn: ({ signal }) => searchReleases(api, { entryId, episodeId: episodeId || undefined, profileId: profileId || undefined,
            intent: intent === 'addVersion' ? intent : undefined }, { signal }),
        enabled: !waitingForEpisode,
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
    const onGrab = useCallback((candidate: ReleaseCandidate) => {
        if (!data?.grab.available || busy || operation?.state === 'accepted' || stale || candidate.heldQuality) return;
        start(data.searchId, candidate);
    }, [busy, data, operation, stale, start]);
    const toggleRejected = useCallback(() => setRejectedOpen(value => !value), []);
    const chooseEpisode = useCallback((event: ChangeEvent<HTMLSelectElement>) => setEpisodeId(event.target.value), []);
    const chooseProfile = useCallback((event: ChangeEvent<HTMLSelectElement>) => setProfileId(event.target.value), []);

    const searchError = search.error ? problemOf(search.error, 'Release search failed. Please try again.').title : '';
    const eligible = data?.candidates.filter(candidate => candidate.eligible) ?? [];
    const rejected = data?.candidates.filter(candidate => !candidate.eligible) ?? [];
    // Rows from a previous search stay visible while a new one loads, but only current rows can grab.
    const grabDisabled = !data?.grab.available || busy || operation?.state === 'accepted' || search.isFetching || search.isPlaceholderData;
    const failedIndexers = data?.indexers.filter(outcome => outcome.status !== 'ok' && outcome.status !== 'no_results') ?? [];
    const status = [statusText(data, waitingForEpisode, search.isFetching, searchError), grab.error].filter(Boolean).join(' · ');
    const grabStatus = operation
        && <GrabStatus operation={operation} now={grab.now} cancelling={grab.cancelling} onCancel={grab.cancel} />;

    return <div className='jfmod-releasePicker' ref={container}>
        {mediaType === 'series' && <div className='selectContainer'>
            <label className='jfmod-releaseLabel' htmlFor='jfmod-releaseEpisode'>Episode</label>
            <select id='jfmod-releaseEpisode' is='emby-select' value={episodeId} onChange={chooseEpisode}>
                <option value=''>Choose an episode</option>
                {episodes.map(episode => <option key={episode.id} value={episode.id}>{episode.label}</option>)}
            </select>
        </div>}
        {!!profiles.data?.length && <div className='selectContainer'>
            <label className='jfmod-releaseLabel' htmlFor='jfmod-releaseProfile'>Quality profile for this search</label>
            <select id='jfmod-releaseProfile' is='emby-select' value={profileId} onChange={chooseProfile}>
                <option value=''>{profileLabel(data, !!profileId)}</option>
                {profiles.data.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
            </select>
        </div>}
        {intent === 'addVersion' && <p className='jfmod-releaseNotice jfmod-releaseNotice--info'>
            The release you grab is added as another version; the ones you have stay.
        </p>}
        <p className='jfmod-releaseStatus' role='status' tabIndex={-1}>{status}</p>
        {failedIndexers.length > 0 && <p className='jfmod-releaseNotice'>
            Partial results: {failedIndexers.map(outcome => outcome.name + ' (' + (outcome.message ?? outcome.status) + ')').join('; ')}
        </p>}
        {!grab.releaseId && grabStatus}
        <div className='jfmod-releaseList'>
            {eligible.map(candidate => <Fragment key={candidate.releaseId}>
                <ReleaseRow candidate={candidate} disabled={grabDisabled} onGrab={onGrab} />
                {grab.releaseId === candidate.releaseId && grabStatus}
            </Fragment>)}
        </div>
        {rejected.length > 0 && <div className='jfmod-rejectedGroup'>
            <button type='button' className='emby-button jfmod-rejectedToggle' aria-expanded={rejectedOpen} onClick={toggleRejected}>
                {rejectedOpen ? '▾' : '▸'} {rejected.length} rejected
            </button>
            {rejectedOpen && rejected.map(candidate => <RejectedRow key={candidate.releaseId} candidate={candidate} />)}
        </div>}
        <button type='button' className='emby-button jfmod-releaseClose' onClick={onClose}>Close</button>
    </div>;
};

export default ReleasePickerDialog;
