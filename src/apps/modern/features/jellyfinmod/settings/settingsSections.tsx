import type { Api } from '@jellyfin/sdk/lib/api';
import BuildIcon from '@mui/icons-material/Build';
import DeleteIcon from '@mui/icons-material/Delete';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import EditIcon from '@mui/icons-material/Edit';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import React, { type Dispatch, type FC, type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { queryClient } from 'utils/query/queryClient';

import PhoneMark, { PHONE_PROFILE_LABEL } from '../components/PhoneMark';
import { SlowSetupGroup } from '../components/SlowSetup';
import { indexerColour } from '../constants/indexerColours';

import { FoundInProwlarr, type ProwlarrClient } from './FoundInProwlarr';
import {
    blockerSentence, BLOCKER_SECTIONS, CONFLICT_MESSAGE, type ConnectionTest, type Overview, partialSave, PAUSE_SENTENCES, pathSentence, problemText, request,
    type SecretChange, when
} from './settingsApi';
import { profileSummary, QualityProfileDialog, usePresets } from './qualityProfiles';
import {
    type Draft, FieldForm, FillExample, REQUIRED_SLOTS, type FieldSpec, IconAction, Notice, type NoticeState, pick, SecretField, SectionFrame, type StateKind, StatePill,
    ScrollList, type TestState, TestIcon, useConfirm, WhenLine
} from './settingsWidgets';

/* eslint-disable @typescript-eslint/no-explicit-any -- the settings DTOs are the plugin's own and are read field by field */

export interface SettingsData {
    /** The reads that failed other than as unsupported; their areas show what they have and the page offers a retry. */
    failures?: string[];
    /** The reads answered 404 (a plugin build without that area): nothing was read from them. */
    unsupported?: string[];
    overview?: Overview;
    discovery?: any;
    seed?: any;
    retention?: any;
    acquisition?: any;
    indexers: any[];
    clients: any[];
    profiles: any[];
    importSettings?: any;
    automation?: any;
    automationStatus?: any;
    decisions: any[];
    iface?: any;
    reconciliation?: any;
    conflicts: any[];
    orphans: any[];
    users: { Id: string; Name: string; Policy?: { IsDisabled?: boolean } }[];
    preview?: any;
    lastRun?: any;
    /** Prowlarr sources; undefined when the plugin build has no Prowlarr support (P7.S9). */
    prowlarr?: any[];
    /** Each TV and movie library's placeholder switch (`GET /JellyfinMod/Placeholders`, P1.FU24, P1.FU26). */
    placeholders?: PlaceholderLibrary[];
    /** Ratings settings and the fetcher's status; undefined when the plugin build has no ratings (Phase 9). */
    ratings?: any;
    ratingsStatus?: any;
    /** The TVs catalogue and the ticked models (`GET /JellyfinMod/Settings/TvModels`, Phase 12); undefined before `copies`. */
    tvModels?: TvModels;
    /** The Trakt plugin's missed-watch export (`GET /JellyfinMod/Trakt/Export`, Phase 13); undefined on an older plugin. */
    trakt?: TraktExport;
}

/** One model of the plugin's TVs catalogue (Phase 12 M30). */
export interface TvModel {
    id: string;
    name: string;
    year: number;
    webOS: string;
    dolbyVision: boolean;
    hdr10Plus: boolean;
    hlg: boolean;
    ddPlusAtmos: boolean;
    dts: boolean;
    trueHd: boolean;
    selected: boolean;
}

export interface TvModels {
    models: TvModel[];
    selected: string[];
    revision: number;
}

/** One Jellyfin user the stock Trakt plugin holds a sign-in for (Phase 13). */
export interface TraktExportUser {
    /** The Jellyfin user's id, for the Trakt plugin's own Deauthorize (Disconnect). */
    userId: string;
    name: string;
    /** `linked`, or `reconnect` when its sign-in could not be renewed and the plugin skips the user. */
    state: 'linked' | 'reconnect';
    since: string | null;
    collections: boolean;
    postWatched: boolean;
    /** The Trakt username and avatar the server read (D49); null until read, or when Trakt has none. */
    traktUsername?: string | null;
    avatarUrl?: string | null;
}

/** One export run of the Activity list (D50, D73), newest first; the server leaves null fields out. */
export interface TraktExportRun {
    startedAt: string;
    endedAt: string;
    status: string;
    clean: boolean;
    /** `watch`, `reconnect`, `daily`, `retry`, `sync_now`, `first`, or null for a run JellyfinMod did not start. */
    why?: string | null;
    episodesWatched?: number | null;
    moviesWatched?: number | null;
    episodesCollected?: number | null;
    moviesCollected?: number | null;
    error?: string | null;
    /** `import` for a run of the Trakt plugin's import (the watched counts are what it marked watched in Jellyfin). */
    kind?: string | null;
    progressUpdated?: number | null;
}

/** `GET /JellyfinMod/Trakt/Export` (Phase 13). */
export interface TraktExport {
    installed: boolean;
    version: string | null;
    minimumVersion: string;
    autoExport: boolean;
    running: boolean;
    /** `not_installed`, `old_plugin`, `unknown`, `no_users` or `unwatched_history`. */
    refusal: string | null;
    lastRun: { status: string; startedAt: string; endedAt: string } | null;
    /** False when the plugin completed its task but logged a Trakt error while it ran (a refused write): not delivered. */
    lastRunConfirmed?: boolean | null;
    nextAttemptAt: string | null;
    failures: number;
    quietMinutes: number;
    users: TraktExportUser[];
    activity?: TraktExportRun[];
    runningWhy?: string | null;
    /** The "Also import watches from Trakt" switch, why the import is refused (`unwatched_import`), and whether it runs. */
    importEnabled?: boolean;
    importRefusal?: string | null;
    importRunning?: boolean;
}

/** `today 14:05`, `yesterday 21:40` or `12 Oct 21:40`: a short local time for the Trakt lines. */
export const traktWhen = (iso: string | null | undefined) => {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const day = new Date(date);
    day.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Math.round((today.getTime() - day.getTime()) / 86400000);
    if (days === 0) return `today ${time}`;
    if (days === 1) return `yesterday ${time}`;
    return `${date.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time}`;
};

/** The Trakt section in a line, for the rail and the section's head (Phase 13). */
export const summariseTrakt = (trakt: TraktExport | undefined): Summary => {
    if (!trakt) return { kind: 'off', words: 'Not loaded' };
    if (!trakt.installed) return { kind: 'off', words: 'Trakt plugin not installed' };
    if (trakt.refusal === 'old_plugin') return { kind: 'warn', words: `Needs Trakt plugin ${trakt.minimumVersion.split('.')[0]}` };
    const reconnect = trakt.users.filter(user => user.state === 'reconnect');
    if (reconnect.length) return { kind: 'err', words: `Reconnect needed · ${reconnect.map(user => user.name).join(', ')}` };
    if (trakt.refusal === 'no_users') return { kind: 'off', words: 'No account linked' };
    if (trakt.refusal === 'unwatched_history') return { kind: 'warn', words: 'Export refused · post unwatched history is on' };
    if (trakt.refusal) return { kind: 'warn', words: 'Trakt plugin settings unreadable' };
    if (trakt.running) return { kind: 'busy', words: 'Exporting now' };
    if (!trakt.autoExport) return { kind: 'off', words: 'Off · Sync Now works either way' };
    if (trakt.lastRun && (trakt.lastRun.status !== 'Completed' || trakt.lastRunConfirmed === false)) {
        return { kind: 'warn', words: trakt.nextAttemptAt ? `Waiting for Trakt · next try ${traktWhen(trakt.nextAttemptAt).replace(/^today /, '')}` : 'Waiting for Trakt' };
    }
    return { kind: 'ok', words: trakt.lastRun ? `On · last export ${traktWhen(trakt.lastRun.startedAt)}` : 'On · no export yet' };
};

/** A TV or movie library and its placeholder switch (`GET /JellyfinMod/Placeholders`). */
export interface PlaceholderLibrary {
    libraryId: string;
    name: string;
    enabled: boolean;
    stubs: number;
    /** Whether any folder of the library can be written; a read-only library gets nothing. */
    writable?: boolean;
    /** `movie` or `series` (P1.FU26); a build before it lists TV libraries only. */
    mediaType?: string;
}

export interface SectionProps {
    api: Api;
    data: SettingsData;
    reload: () => Promise<unknown>;
    onGo: (id: string) => void;
    eyebrow: string;
    next?: { id: string; title: string };
}

const UNCHANGED: SecretChange = { action: 'unchanged', value: null };

/** The reads each drafted section's records come from, as `SettingsData.failures` names them. */
const CLIENT_READS = ['Settings/DownloadClients', 'Settings/Acquisition'];
const PROWLARR_READS = ['Settings/Prowlarr'];
const ACQUISITION_READS = ['Settings/Acquisition'];
const RETENTION_READS = ['Settings/Retention', 'Settings/SeedProtection'];
const DISCOVERY_READS = ['Settings/Discovery'];
const RATINGS_READS = ['Settings/Ratings'];

/** What a settings refetch resolves with: the query's own result, as `refetch` returns it. */
interface ReloadResult {
    isError?: boolean;
    data?: SettingsData;
}

/**
 * Save/test plumbing every section shares: one notice, one busy flag, 409s rendered with a Reload. `reads` names the
 * settings reads the section's drafts come from, as `SettingsData.failures` lists them; `present`, when given, says whether
 * a reload really brought the section's record back, since a read the loader takes as unsupported (404) is no failure but
 * reads nothing either.
 */
const useSectionState = (reload: () => Promise<unknown>, reads: readonly string[] = [], present?: (data: SettingsData) => boolean) => {
    const [notice, setNotice] = useState<NoticeState | null>(null);
    const [busy, setBusy] = useState(false);
    // Advanced by an explicit Reload after a conflict: every draft of the section then takes the server's copy, edits
    // and all, so one Reload is enough (whole-review fixes review, P3 5). A save acknowledges only its own draft.
    const [resets, setResets] = useState(0);
    const readsKey = reads.join('\n');
    // The drafts are reset only once the records they come from were read again: a Reload whose read fails keeps the
    // edits and says what could not be read, with another Reload (Codex delta review 4, P2 2).
    const reloadNow = useCallback(async () => {
        const result = await reload() as ReloadResult | undefined;
        const wanted = readsKey ? readsKey.split('\n') : [];
        // A read of the section's own records that failed, or answered 404, read nothing: its drafts are kept (final Pi review, P2 2).
        let failed = result?.isError ? ['Settings/Overview'] :
            [...(result?.data?.failures ?? []), ...(result?.data?.unsupported ?? [])].filter(path => wanted.includes(path));
        // A record that did not come back was not read, whatever the loader made of its answer (Pi review 1, P2 4).
        if (!failed.length && present && !(result?.data && present(result.data))) failed = wanted.length ? wanted : ['Settings/Overview'];
        if (failed.length) {
            setNotice({
                kind: 'err',
                text: `The current settings could not be read (${failed.join(', ')}). Your edits are kept; reload again to take the server's copy.`,
                action: {
                    label: 'Reload',
                    run: () => {
                        void reloadNow();
                    }
                }
            });
            return;
        }
        setResets(value => value + 1);
        setNotice(null);
    }, [reload, readsKey, present]);
    const runReload = useCallback(() => {
        void reloadNow();
    }, [reloadNow]);
    // A work that reports its own outcome (the import-path probe, a Prowlarr sync) returns it as a notice; setting it
    // before the reload would have it cleared by the line below once the reload lands (P7.S11).
    const run = useCallback(async (work: () => Promise<unknown>, success?: string) => {
        setBusy(true);
        try {
            const outcome = await work();
            await reload();
            setNotice(success ? { kind: 'ok', text: success } : (outcome as { jfmodNotice?: NoticeState } | undefined)?.jfmodNotice ?? null);
        } catch (error) {
            const text = problemText(error);
            setNotice({
                kind: 'err', text,
                action: /changed somewhere else/.test(text) ? { label: 'Reload', run: runReload } : undefined
            });
        } finally {
            setBusy(false);
        }
    }, [reload, runReload]);
    // `into` sends the result somewhere other than the section's notice, such as under the secret a test belongs to.
    const test = useCallback(async (path: string, api: Api, into?: (notice: NoticeState | null) => void) => {
        const say = into ?? setNotice;
        setBusy(true);
        into?.(null);
        try {
            const result = await request<ConnectionTest>(api, 'POST', path);
            const version = result.version ? ` · ${result.version}` : '';
            say({ kind: result.ok ? 'ok' : 'err', text: `${result.message} (${result.code})${version}` });
            await reload();
        } catch (error) {
            say({ kind: 'err', text: problemText(error) });
        } finally {
            setBusy(false);
        }
    }, [reload]);
    return { notice, setNotice, busy, run, test, resets, reloadNow: runReload };
};

interface DraftOwner {
    resets: number;
    setNotice: Dispatch<SetStateAction<NoticeState | null>>;
    /** The section's Reload, which resets every draft of the section only after a successful read. */
    reloadNow: () => void;
}

/**
 * Keeps a local draft of a DTO. The server's copy replaces it when it changes, unless the administrator has edited the
 * draft since: then the edits and the revision they started from are kept, and when the server's record really changed
 * the owner shows so, with a Reload (whole-review chunk 4b, P2 4). A refetch that brings the same record back (after a
 * probe, a sync or another section's save) keeps the edits without a word (fixes review, P2 2). Only the draft's own save
 * (`markSaved`) or the section's Reload lets the next copy replace it. The warning's Reload is the section's own, so it
 * reads the records again first and resets every draft of the section together (Codex delta review 6, P2 4). `isStale`
 * says whether the server's copy changed under unsaved edits.
 */
const useDraft = (source: any, fallback: Draft = {}, owner?: DraftOwner) => {
    const [draft, setDraft] = useState<Draft>(source ?? fallback);
    // Which generation each draft belongs to: a new one starts whenever the draft is replaced wholesale (by the server's copy
    // or a Reload); edits stay in theirs. A save's completion acts only on the generation it was sent from (Pi review 3, P2 1).
    const generation = useRef(0);
    const generations = useRef(new WeakMap<Draft, number>());
    const dirty = useRef(false);
    const baseline = useRef(JSON.stringify(source ?? null));
    const seenResets = useRef(owner?.resets ?? 0);
    const draftNow = useRef(draft);
    draftNow.current = draft;
    // Set when this draft's own save succeeded while it was edited further: how to recognise the record that save returned.
    // The next copy from the server that is that record gives the newer edits its version; any other copy means another
    // administrator saved in between, and is a change under the edits like any other (final web review, P2 2; delta 2, P2 1).
    const ownSave = useRef<((record: any) => boolean) | null>(null);
    // The server's copy now, for a save whose own record arrived (by a refetch of its own) before its answer did.
    const sourceNow = useRef(source);
    sourceNow.current = source;
    const resets = owner?.resets ?? 0;
    const resetsNow = useRef(resets);
    resetsNow.current = resets;
    const setNotice = owner?.setNotice;
    const reloadNow = owner?.reloadNow;
    const stale = useRef(false);
    /** An edited draft, in the generation of the draft it was edited from. */
    const derive = useCallback((from: Draft, next: Draft) => {
        generations.current.set(next, generations.current.get(from) ?? generation.current);
        return next;
    }, []);
    /**
     * A draft replaced wholesale: it starts a new generation, as an object of its own, so a source object the draft held
     * before (and an earlier save sent) never takes the new generation with it (Pi review 4, P3 3).
     */
    const renew = useCallback((next: Draft) => {
        const fresh = { ...next };
        generation.current += 1;
        generations.current.set(fresh, generation.current);
        return fresh;
    }, []);
    /** The save's own record: the edits made during the save take its identity and version and keep their values. */
    const acknowledge = useCallback((record: any) => {
        baseline.current = JSON.stringify(record ?? null);
        stale.current = false;
        setDraft(edited => derive(edited, { ...edited, ...versionsOf(record) }));
    }, [derive]);
    // Keyed on the server's copy and the owner's Reloads only: a fallback literal is a new object on every render and
    // must not reset the form.
    useEffect(() => {
        const copy = JSON.stringify(source ?? null);
        const ownRecord = ownSave.current;
        ownSave.current = null;
        if (ownRecord && dirty.current && seenResets.current === resets && source && ownRecord(source)) {
            acknowledge(source);
            return;
        }
        if (dirty.current && seenResets.current === resets) {
            if (copy === baseline.current) return;
            stale.current = true;
            // An error that already offers a Reload stays: it says more, such as which read failed (Codex delta review 6, P2 3).
            setNotice?.(current => (current?.kind === 'err' && current.action ? current : {
                kind: 'warn',
                text: 'These settings changed somewhere else while you were editing. Your edits are kept until you reload.',
                action: reloadNow ? { label: 'Reload', run: reloadNow } : undefined
            }));
            return;
        }
        // A Reload's reset also clears a warning this draft raised from a copy that landed just before it.
        if (seenResets.current !== resets) setNotice?.(null);
        seenResets.current = resets;
        dirty.current = false;
        stale.current = false;
        baseline.current = copy;
        setDraft(renew(source ?? fallback));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [source, resets]);
    const set = useCallback((key: string, value: unknown) => {
        dirty.current = true;
        setDraft(current => derive(current, { ...current, [key]: value }));
    }, [derive]);
    /** Takes a record as the new starting point, discarding the edits. */
    const replace = useCallback((next: Draft) => {
        dirty.current = false;
        setDraft(renew(next));
    }, [renew]);
    /**
     * Its own save succeeded. With the draft that was sent and a test that recognises the record the save returned, edits
     * made while the save was under way are kept: the next copy from the server, when it is that record, only gives them its
     * version; when it is not, another administrator saved meanwhile and the edits keep the version they started from, so
     * their save is refused. Otherwise the next copy replaces the draft. When the save's own record is already the server's
     * copy (a refetch brought it before the save's answer arrived), it is taken now: no later copy would bring it again
     * (Pi review 1, P2 2). `saved`, the record the save returned, gives those edits its identity and version at once, so a
     * record created by the save owns them even when another one is shown first (Pi review 3, P2 1). A draft replaced since
     * the save was sent (a Reload, or a newer copy taken in) is left alone.
     */
    const markSaved = useCallback((sent?: Draft, isSavedRecord?: (record: any) => boolean, saved?: any) => {
        if (sent && (generations.current.get(sent) ?? 0) !== generation.current) return;
        stale.current = false;
        // The draft, edited meanwhile or not, now belongs to the record this save returned: edits made before the next copy
        // arrives (or when it never comes, being already cached) are that record's, never the one shown (Pi review 4, P2 1).
        if (saved && typeof saved === 'object') setDraft(edited => derive(edited, { ...edited, ...versionsOf(saved) }));
        if (sent && isSavedRecord && draftNow.current !== sent) {
            const current = sourceNow.current;
            if (dirty.current && seenResets.current === resetsNow.current && current && isSavedRecord(current)) {
                ownSave.current = null;
                acknowledge(current);
                return;
            }
            ownSave.current = isSavedRecord;
            return;
        }
        // Unedited at completion: edits typed before the save's own copy arrives keep its version too (Pi review 5, P3 3). A
        // copy that already arrived, and may never come again, is taken now (Pi review 6, P3 1).
        const current = sourceNow.current;
        if (sent && isSavedRecord && current && isSavedRecord(current)) {
            ownSave.current = null;
            acknowledge(current);
        } else {
            ownSave.current = isSavedRecord ?? null;
        }
        dirty.current = false;
    }, [acknowledge, derive]);
    /** Whether the server's copy changed while this draft had unsaved edits. */
    const isStale = useCallback(() => dirty.current && stale.current, []);
    /** Edits one field from its current value. */
    const update = useCallback((key: string, change: (value: any) => unknown) => {
        dirty.current = true;
        setDraft(current => derive(current, { ...current, [key]: change(current[key]) }));
    }, [derive]);
    return [draft, set, replace, markSaved, update, isStale] as const;
};

/**
 * The fields that say which record and which version of it a draft was read at; a save's own copy hands them on to newer
 * edits. The id binds edits made while a new record was being created to the record that save created (Pi review 2, P2 1).
 */
const VERSION_KEYS = ['id', 'revision', 'mappingsVersion'];

/** A record's identity and version fields, as a save hands them on. */
const versionsOf = (record: any) => Object.fromEntries(VERSION_KEYS.filter(key => key in record).map(key => [key, record[key]]));

/**
 * Recognises the record a save returned by its id, when it has one, and its revision: another record at the same revision
 * (one another administrator created meanwhile) or a copy with another revision is someone else's save (Pi review 2, P2 1).
 */
const sameRevision = (saved: any) => (record: any) => saved?.revision !== undefined && record?.revision === saved.revision
    && (saved?.id === undefined || record?.id === saved.id);

/** Where a save started: the revision it was sent with and the section's Reloads at that moment. */
interface SaveOrigin {
    revision: number | undefined;
    resets: number;
}

/**
 * A secret typed for one record at one revision (final web review, P2 1). Its save carries the oldest revision any of the
 * section's edits started from, so a record another administrator changed meanwhile refuses it instead of taking it; the
 * section's validated Reload clears it, and its own save clears it only if it was not typed again meanwhile.
 */
const useSecretChange = (recordId: string | undefined, recordRevision: number | undefined, resets: number) => {
    const [change, setChange] = useState<SecretChange>(UNCHANGED);
    const baseline = useRef<{ id: string | null; revision?: number } | undefined>(undefined);
    const resetsNow = useRef(resets);
    resetsNow.current = resets;
    const set = useCallback((next: SecretChange) => {
        // A secret taken back (Undo, Keep the saved one, an emptied field) ends its ownership, so the next one typed starts
        // from the record and revision shown then (Pi review 4, P2 2).
        if (next.action === 'unchanged') baseline.current = undefined;
        else if (!baseline.current) baseline.current = { id: recordId ?? null, revision: recordRevision };
        setChange(next);
    }, [recordId, recordRevision]);
    useEffect(() => {
        baseline.current = undefined;
        setChange(UNCHANGED);
    }, [resets]);
    /**
     * Clears the secret after its save. One typed while the save was under way stays, and now stands on the record and
     * revision that save returned, so its own save is accepted unless someone else saves meanwhile (final web review 2, P2 6).
     * Only a secret this save moved forward from does: one typed for the same record at the revision the save was sent with,
     * or one typed into the new-record form, with no Reload since, when this save is the one that created a record
     * (`origin`, taken when Save was pressed; Pi review 1, P2 3; Pi reviews 2 and 3, P2 2).
     */
    const saved = useCallback((sent: SecretChange, record: { id?: string; revision?: number; created?: boolean } | undefined, origin: SaveOrigin) => {
        setChange(now => {
            if (now !== sent) {
                const typed = baseline.current;
                if (typed && record?.id && record.revision !== undefined && (
                    (typed.id === record.id && typed.revision === origin.revision)
                    || (typed.id === null && record.created === true && origin.resets === resetsNow.current))) {
                    baseline.current = { id: record.id, revision: record.revision };
                }
                return now;
            }
            baseline.current = undefined;
            return UNCHANGED;
        });
    }, []);
    const pending = change.action !== 'unchanged';
    /** Whether the secret was typed for this record (a new-record form's secret belongs to no existing record). */
    const typedFor = useCallback((id: string | undefined) => !pending || (baseline.current?.id ?? null) === (id ?? null), [pending]);
    /** The revision a save carries: the oldest of the form's and the secret's starting revisions. */
    const revisionFor = useCallback((formRevision: number | undefined) => {
        const secretRevision = pending ? baseline.current?.revision : undefined;
        return secretRevision !== undefined && formRevision !== undefined ? Math.min(secretRevision, formRevision) : secretRevision ?? formRevision;
    }, [pending]);
    /** Where a save starts from, taken when Save is pressed: the revision it sends and the section's Reloads so far. */
    const origin = useCallback((revision: number | undefined): SaveOrigin => ({ revision, resets: resetsNow.current }), []);
    return { change, set, saved, typedFor, revisionFor, origin };
};

// ---- The rail's one-line summary per area. `Settings/Overview` is the source; this turns it into words. ----

type Summary = { kind: StateKind; words: string };

const summariseOverview = (data: SettingsData): Summary => {
    const setup = data.overview?.setup;
    if (!setup) return { kind: 'off', words: 'Not loaded' };
    const open = setup.steps.filter(step => !step.optional && step.status !== 'done').length;
    return open ? { kind: 'warn', words: `${open} setup step(s) open` } : { kind: 'ok', words: 'Everything required is ready' };
};

const summariseDiscovery = (data: SettingsData): Summary => {
    const discovery = data.discovery;
    if (!discovery) return { kind: 'off', words: 'Not loaded' };
    // The token is optional: with none saved, discovery uses Jellyfin's built-in TMDb connection (P1.FU13).
    if (discovery.source === 'jellyfin') return { kind: 'ok', words: 'Using Jellyfin\'s TMDb connection' };
    if (!discovery.tokenConfigured) return { kind: 'warn', words: discovery.apiKeyConfigured ? 'Only the v3 API key is configured' : 'No TMDB token' };
    return discovery.verified ? { kind: 'ok', words: `Using your token · tested ${when(discovery.verifiedAt)}` } :
        { kind: 'warn', words: 'Using your token · not tested since it changed' };
};

const summariseClient = (data: SettingsData): Summary => {
    const client = selectedClient(data);
    if (!client) return { kind: 'err', words: 'No download client configured' };
    if (!client.enabled) return { kind: 'err', words: `${client.name} · turned off` };
    if (!client.verified) return { kind: 'err', words: `${client.name} · ${client.lastError ? 'last test failed' : 'not tested since it changed'}` };
    const unverified = (client.pathMappings ?? []).filter((mapping: any) => !mapping.verifiedAt).length;
    return unverified ? { kind: 'warn', words: `${client.name} · ${unverified} unverified mapping(s)` } : { kind: 'ok', words: `${client.name} · verified` };
};

const summariseIndexers = (data: SettingsData): Summary => {
    const total = data.indexers.length;
    if (!total) return { kind: 'err', words: 'No indexer configured' };
    const ready = data.indexers.filter(indexer => indexer.enabled && indexer.verified).length;
    return ready ? { kind: 'ok', words: `${ready} of ${total} enabled and verified` } : { kind: 'err', words: 'None enabled and verified' };
};

const summariseProfiles = (data: SettingsData): Summary => {
    if (!data.profiles.length) return { kind: 'err', words: 'No quality profile' };
    const fallback = data.profiles.find(profile => profile.isDefault);
    return fallback ? { kind: 'ok', words: `Default: ${fallback.name}` } : { kind: 'err', words: 'No default profile' };
};

const tvCount = (count: number) => `${count} TV${count === 1 ? '' : 's'}`;

const summariseTvs = (data: SettingsData): Summary => {
    if (!data.tvModels) return { kind: 'off', words: 'Not in this plugin build' };
    const ticked = data.tvModels.selected.length;
    return ticked ? { kind: 'ok', words: tvCount(ticked) } : { kind: 'off', words: 'None ticked' };
};

const summariseGrabbing = (data: SettingsData): Summary => {
    const acquisition = data.acquisition;
    if (!acquisition) return { kind: 'off', words: 'Not loaded' };
    if (acquisition.enabled) return { kind: 'ok', words: `On · ${acquisition.holdSeconds}s to cancel a grab` };
    return acquisition.ready ? { kind: 'off', words: 'Off · ready to turn on' } : { kind: 'err', words: `Off · ${acquisition.blockers.length} blocker(s)` };
};

const summariseImport = (data: SettingsData): Summary => {
    const settings = data.importSettings;
    if (!settings) return { kind: 'off', words: 'Not loaded' };
    return settings.importEnabled ? { kind: 'ok', words: `On · seeding copies ${settings.seedReleaseEnabled ? 'released at their goals' : 'kept'}` } :
        { kind: 'off', words: 'Off · downloads are left where they are' };
};

const summariseRetention = (data: SettingsData): Summary => {
    const retention = data.retention;
    if (!retention) return { kind: 'off', words: 'Not loaded' };
    if (!retention.enabled) return { kind: 'off', words: 'Off · nothing is deleted' };
    if (retention.selectedUserMissing) return { kind: 'err', words: 'The selected user is unavailable' };
    if (!data.seed?.effectiveRpcUrl) return { kind: 'warn', words: 'No seed check, so reclamation is blocked' };
    return { kind: 'ok', words: `On · ${retention.reclaimAfterDays} days after it is finished` };
};

const summariseAutomation = (data: SettingsData): Summary => {
    const status = data.automationStatus;
    if (!status) return { kind: 'off', words: 'Not loaded' };
    if (!status.enabled) return { kind: 'off', words: 'Off · manual grabs work either way' };
    const paused = (status.pausedReasons as string[]).map(reason => PAUSE_SENTENCES.get(reason) ?? reason);
    return paused.length ? { kind: 'warn', words: `On · paused: ${paused.join(', ')}` } : { kind: 'ok', words: 'On' };
};

const placeholderCount = (count: number) => `${count} placeholder${count === 1 ? '' : 's'}`;

/**
 * Missing Episodes in a line, for the rail and the section's own head (P1.FU24): on in every library, on in some, off, or on
 * where nothing can be written, with the placeholders Jellyfin holds.
 */
export const summarisePlaceholders = (libraries: PlaceholderLibrary[] | undefined): Summary => {
    if (!libraries) return { kind: 'off', words: 'Not loaded' };
    if (!libraries.length) return { kind: 'off', words: 'No TV or movie library' };
    const on = libraries.filter(library => library.enabled);
    const stubs = placeholderCount(libraries.reduce((sum, library) => sum + library.stubs, 0));
    if (!on.length) return { kind: 'off', words: 'Off · turned off by you' };
    if (on.every(library => library.writable === false)) return { kind: 'warn', words: 'Read-only · nothing is written' };
    return on.length === libraries.length ? { kind: 'ok', words: `On · ${stubs}` } :
        { kind: 'ok', words: `On for ${on.length} of ${libraries.length} libraries · ${stubs}` };
};

const summariseInterface = (data: SettingsData): Summary => {
    const face = data.iface;
    if (!face) return { kind: 'off', words: 'Not loaded' };
    if (face.Blocker) return { kind: 'warn', words: `${face.Status} · ${face.Blocker}` };
    return face.Status === 'patched' ? { kind: 'ok', words: 'Serving this interface at /web' } : { kind: 'off', words: `Stock Jellyfin at /web (${face.Status})` };
};

const summariseDiagnostics = (data: SettingsData): Summary => {
    const latest = data.reconciliation;
    const open = data.conflicts.length + data.orphans.length;
    if (!latest) return { kind: 'off', words: 'No reconciliation run yet' };
    return open ? { kind: 'warn', words: `${open} item(s) need a decision` } : { kind: 'ok', words: `Last run ${when(latest.completedAt ?? latest.startedAt)}` };
};

const summariseRatings = (data: SettingsData): Summary => {
    const ratings = data.ratings;
    if (!ratings) return { kind: 'off', words: 'Not in this plugin build' };
    if (!ratings.enabled) return { kind: 'off', words: 'Turned off' };
    if (!ratings.apiKeyConfigured) return { kind: 'warn', words: 'No MDBList key · TMDB and server metadata only' };
    const status = data.ratingsStatus;
    if (status?.blocker === 'unauthorized') return { kind: 'err', words: 'MDBList refused the key' };
    if (status?.breaker?.open) return { kind: 'warn', words: `Paused until ${when(status.breaker.until)}` };
    if (status?.running) return { kind: 'ok', words: `Fetching · ${status.running.remaining} title(s) left` };
    return ratings.verified ? { kind: 'ok', words: `Key tested ${when(ratings.verifiedAt)}` } : { kind: 'warn', words: 'Key not tested since it changed' };
};

export const summarise = (id: string, data: SettingsData): Summary => {
    switch (id) {
        case 'overview': return summariseOverview(data);
        case 'discovery': return summariseDiscovery(data);
        case 'client': return summariseClient(data);
        case 'indexers': return summariseIndexers(data);
        case 'profiles': return summariseProfiles(data);
        case 'tvs': return summariseTvs(data);
        case 'grabbing': return summariseGrabbing(data);
        case 'import': return summariseImport(data);
        case 'retention': return summariseRetention(data);
        case 'automation': return summariseAutomation(data);
        case 'placeholders': return summarisePlaceholders(data.placeholders);
        case 'trakt': return summariseTrakt(data.trakt);
        case 'interface': return summariseInterface(data);
        case 'diagnostics': return summariseDiagnostics(data);
        case 'ratings': return summariseRatings(data);
        default:
            return data.overview?.areas.find(candidate => candidate.id === id)?.ready ? { kind: 'ok', words: 'Ready' } : { kind: 'off', words: '' };
    }
};

const selectedClient = (data: SettingsData) =>
    data.clients.find(client => client.id === data.acquisition?.downloadClientId) ?? data.clients[0];

/**
 * One blocker with its sentence and a Fix that opens the section owning it; `detail` is the Overview's area name. Fix is a
 * row action, so it is an icon named after the blocker it fixes (user, 2026-10-08).
 */
const BlockerRow: FC<{ code: string; fallback: string; detail?: string; onGo: (id: string) => void }> = ({ code, fallback, detail, onGo }) => {
    const fix = useCallback(() => onGo(BLOCKER_SECTIONS.get(code) ?? fallback), [code, fallback, onGo]);
    const sentence = blockerSentence(code);
    return (
        <div className='jfmod-brow'>
            <div className='jfmod-brow-main'><strong>{sentence}</strong>{detail !== undefined && <span className='jfmod-sub'>{detail}</span>}</div>
            <span />
            <span className='jfmod-rowactions'>
                <IconAction label={`Fix: ${sentence.replace(/\.$/, '')}`} onClick={fix} data={{ 'row-action': 'fix' }}><BuildIcon /></IconAction>
            </span>
        </div>
    );
};

// ---- Overview ----

export const OverviewSection: FC<SectionProps> = props => {
    const { data, onGo } = props;
    const overview = data.overview;
    const pageBundle = document.querySelector('meta[name="jellyfinmod-web"]')?.getAttribute('content') ?? null;
    const serverBundle = overview?.web?.bundleId ?? null;
    const skew = !!pageBundle && !!serverBundle && pageBundle !== serverBundle;
    const blocked = (overview?.areas ?? []).filter(area => area.blockers.length);
    return (
        <SectionFrame id='overview' eyebrow={props.eyebrow} title='Overview' state={summarise('overview', data)} notice={skew ? {
            kind: 'warn',
            text: `This page runs bundle ${pageBundle}, but the server now serves ${serverBundle}. Reload the page to use the current interface.`
        } : null} next={props.next} onGo={onGo}
        >
            <div className='jfmod-group'>
                <h3 className='jfmod-grouptitle'>Readiness</h3>
                {blocked.length === 0 ? <p className='jfmod-lead'>Nothing is blocked.</p> : (
                    <div className='jfmod-blist'>
                        {blocked.flatMap(area => area.blockers.map(code => (
                            <BlockerRow key={area.id + code} code={code} fallback={area.id} detail={area.id} onGo={onGo} />
                        )))}
                    </div>
                )}
                {overview?.setup && !overview.setup.complete && (
                    <p className='jfmod-lead'>
                        Setup is not finished. <a href='#/catalog/settings/setup'>Open the setup wizard</a>
                    </p>
                )}
            </div>
            <div className='jfmod-group'>
                <h3 className='jfmod-grouptitle'>This Installation</h3>
                <dl className='jfmod-kv'>
                    <dt>Plugin</dt><dd>{overview?.plugin.version ?? 'unknown'}</dd>
                    <dt>Interface bundle (server)</dt><dd className='jfmod-mono'>{serverBundle ?? 'none'}</dd>
                    <dt>Interface bundle (this page)</dt><dd className='jfmod-mono'>{pageBundle ?? 'not a JellyfinMod document'}</dd>
                    <dt>Built from</dt><dd className='jfmod-mono'>{overview?.web?.webCommit ?? 'unknown'}</dd>
                    <dt>Interface at /web</dt><dd>{overview?.web?.takeover ?? 'unknown'}{overview?.web?.takeoverBlocker ? ` · ${overview.web.takeoverBlocker}` : ''}</dd>
                </dl>
            </div>
        </SectionFrame>
    );
};

// ---- Discovery ----

/** Whether a reload brought the Discovery record back: a 404 leaves it out without counting as a failed read. */
const discoveryRead = (data: SettingsData) => data.discovery !== undefined && data.discovery !== null;

export const DiscoverySection: FC<SectionProps> = props => {
    const { api, data, reload } = props;
    const discovery = data.discovery ?? {};
    // A Reload clears the token only once Discovery itself was read again (final web review 2, P2 8).
    const section = useSectionState(reload, DISCOVERY_READS, discoveryRead);
    const tokenSecret = useSecretChange('discovery', discovery.revision, section.resets);
    const token = tokenSecret.change;
    const setToken = tokenSecret.set;
    const { run, test } = section;
    const saveWork = useCallback(async () => {
        let savedRevision: number | undefined;
        const revision = tokenSecret.revisionFor(discovery.revision);
        const origin = tokenSecret.origin(revision);
        if (token.action !== 'unchanged') {
            savedRevision = (await request<any>(api, 'PATCH', 'Settings/Discovery', { token, revision }))?.revision;
        }
        tokenSecret.saved(token, { id: 'discovery', revision: savedRevision }, origin);
    }, [api, token, tokenSecret, discovery.revision]);
    const save = useCallback(() => run(saveWork, 'Saved.'), [run, saveWork]);
    // Test sits in the token's box as an icon, its words and its result under the box (user, 2026-10-07). A result belongs
    // to the revision it tested: a saved replacement or clear, or a change being typed, hides it (Codex review 1, P2 2).
    const [testResult, setTestResult] = useState<{ revision: unknown; notice: NoticeState; at: string } | null>(null);
    const [testing, setTesting] = useState(false);
    const testedRevision = discovery.revision;
    const sayTest = useCallback((notice: NoticeState | null) => setTestResult(notice && { revision: testedRevision, notice, at: new Date().toISOString() }), [testedRevision]);
    // Only the latest run ends the spinner: a test that a newer one has superseded must not stop it early.
    const testRun = useRef(0);
    const testToken = useCallback(async () => {
        testRun.current += 1;
        const mine = testRun.current;
        setTesting(true);
        try {
            await test('Settings/Discovery/Test', api, sayTest);
        } finally {
            if (mine === testRun.current) setTesting(false);
        }
    }, [test, api, sayTest]);
    // The Save at the end of the input saves just the token, then starts its Test (user, 2026-10-09). The test waits until the
    // save has landed and the record has been read again, so it is the new token that is tested, and its result is kept.
    const [testAfterSave, setTestAfterSave] = useState<{ from: unknown } | null>(null);
    const savingToken = useRef(false);
    const saveToken = useCallback(async () => {
        if (savingToken.current) return;
        savingToken.current = true;
        let saved = false;
        try {
            await run(async () => {
                await saveWork();
                saved = true;
            }, 'Saved.');
        } finally {
            savingToken.current = false;
        }
        if (saved) setTestAfterSave({ from: discovery.revision });
    }, [run, saveWork, discovery.revision]);
    useEffect(() => {
        if (!testAfterSave || section.busy || discovery.revision === testAfterSave.from || !discovery.tokenConfigured) return;
        setTestAfterSave(null);
        // The box was drawn again, so a focus that sat on the Save or the input is gone: it goes to the Test that follows.
        const active = document.activeElement;
        if (!active || active === document.body) document.querySelector<HTMLElement>('.jfmod-check-section[data-section="discovery"] [data-secret-action="test"]')?.focus();
        void testToken();
    }, [testAfterSave, section.busy, discovery.revision, discovery.tokenConfigured, testToken]);
    const shownResult = testResult && testResult.revision === discovery.revision && token.action === 'unchanged' && discovery.tokenConfigured ?
        testResult : null;
    const testState: TestState = useMemo(() => {
        if (testing) return { kind: 'testing' };
        if (shownResult) return { kind: shownResult.notice.kind === 'ok' ? 'ok' : 'fail', reason: shownResult.notice.kind === 'ok' ? null : shownResult.notice.text, checkedAt: shownResult.at };
        return discovery.verified ? { kind: 'ok', checkedAt: discovery.verifiedAt } : { kind: 'idle' };
    }, [testing, shownResult, discovery.verified, discovery.verifiedAt]);
    const tokenTest = useMemo(() => ({
        id: 'discovery', label: 'Test Token', run: testToken, disabled: section.busy, result: shownResult?.notice ?? null, state: testState
    }), [testToken, section.busy, shownResult, testState]);
    const tokenSave = useMemo(() => ({ label: 'Save TMDB Token', run: saveToken, busy: section.busy }), [saveToken, section.busy]);
    return (
        <SectionFrame id='discovery' eyebrow={props.eyebrow} title='Discovery' state={summarise('discovery', data)} notice={section.notice}
            onSave={save} saving={section.busy} next={props.next} onGo={props.onGo}
        >
            <div className='jfmod-group'>
                <SecretField key={discovery.revision} id='jfmodTmdbToken' label='TMDB API Read Access Token' configured={!!discovery.tokenConfigured} change={token} onChange={setToken}
                    test={tokenTest} save={tokenSave} />
                <div className='fieldDescription jfmod-lead'>
                    Leave empty to use Jellyfin&apos;s built-in TMDb connection. A saved token is used instead, for JellyfinMod discovery only.
                </div>
            </div>
        </SectionFrame>
    );
};

// ---- Download client and its path mappings ----

type PathMapping = { id?: string; clientPathPrefix: string; localPathPrefix: string; verifiedAt?: string; verificationReason?: string };

/** One editable path mapping; `index` is its identity, as the list is edited in place. */
const MappingRow: FC<{ index: number; mapping: PathMapping; setMappings: (change: (rows: PathMapping[]) => PathMapping[]) => void }> = ({ index, mapping, setMappings }) => {
    const editClient = useCallback((event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setMappings(rows => rows.map((row, at) => (at === index ? { ...row, clientPathPrefix: event.target.value } : row))), [index, setMappings]);
    const editLocal = useCallback((event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setMappings(rows => rows.map((row, at) => (at === index ? { ...row, localPathPrefix: event.target.value } : row))), [index, setMappings]);
    const remove = useCallback(() => setMappings(rows => rows.filter((_, at) => at !== index)), [index, setMappings]);
    const paths = mapping.clientPathPrefix || mapping.localPathPrefix ? ` (${mapping.clientPathPrefix || '…'} → ${mapping.localPathPrefix || '…'})` : '';
    return (
        <div className='jfmod-maprow'>
            <TextField size='small' label='Transmission path' value={mapping.clientPathPrefix}
                onChange={editClient} slotProps={REQUIRED_SLOTS} />
            <span className='jfmod-maparrow' aria-hidden='true'>→</span>
            <TextField size='small' label='Local path' value={mapping.localPathPrefix}
                onChange={editLocal} slotProps={REQUIRED_SLOTS} />
            <div className='jfmod-mapfoot'>
                <StatePill kind={mapping.verifiedAt ? 'ok' : 'warn'}>{mapping.verifiedAt ? 'verified' : pathSentence(mapping.verificationReason ?? 'path_unmapped')}</StatePill>
                <span className='jfmod-rowactions'>
                    <IconAction label={`Remove Mapping ${index + 1}${paths}`} red onClick={remove} data={{ 'row-action': 'remove' }}><DeleteIcon /></IconAction>
                </span>
            </div>
        </div>
    );
};

const CLIENT_KEYS = ['name', 'kind', 'baseUrl', 'username', 'enabled', 'label', 'downloadDirectory', 'localDirectory', 'openUrl'];
/** Stands for "the new-client form" where a client id is expected: it never matches an existing client. */
const NEW_CLIENT = 'new-client';

/** The identities of a list of path mappings, in order: a replacement creates rows with new ids, even for the same paths. */
const mappingIds = (rows: PathMapping[] | undefined) => JSON.stringify((rows ?? []).map(mapping => mapping.id ?? null));

export const ClientSection: FC<SectionProps> = props => {
    const { api, data, reload } = props;
    const client = selectedClient(data);
    // `username` is optional but not nullable on the server: a new client left without one sends '', as the Dashboard page does.
    const section = useSectionState(reload, CLIENT_READS);
    // The client form's draft leaves out the path mappings and their version, which have a draft of their own: a mappings
    // save must not read as the client changing under its form.
    const clientRecord = useMemo(() => client && Object.fromEntries(Object.entries(client)
        .filter(([key]) => key !== 'pathMappings' && key !== 'mappingsVersion')), [client]);
    const [draft, set, , clientSaved] = useDraft(clientRecord, { kind: 'transmission', enabled: true, label: 'jellyfinmod', username: '' }, section);
    const [password, setPasswordChange] = useState<SecretChange>(UNCHANGED);
    // A pending password belongs to the client and the revision it was typed against, as the form's draft does (Codex delta
    // reviews 6, P2 2 and 8, P2 1). That baseline stays until the save or a Reload: a refetch that brings a newer revision of
    // the client never lets the password ride on it, so its save is refused instead of overwriting the newer credentials.
    // A password typed into the new-client form belongs to no existing client (`id` null) and can only create one; a password
    // typed for an existing client needs that client's revision (Codex delta review 10, P2 2).
    const passwordOwner = useRef<{ id: string | null; revision?: number } | undefined>(undefined);
    const setPassword = useCallback((change: SecretChange) => {
        // A password taken back ends its ownership, as a secret's does (Pi review 4, P2 2).
        if (change.action === 'unchanged') {
            passwordOwner.current = undefined;
        } else if (!passwordOwner.current) {
            passwordOwner.current = { id: client?.id ?? null, revision: (draft.revision as number | undefined) ?? client?.revision };
        }
        setPasswordChange(change);
    }, [client?.id, client?.revision, draft.revision]);
    // The section's Reloads now, for a save that completes after one.
    const resetsNow = useRef(section.resets);
    resetsNow.current = section.resets;
    // A Reload resets every draft of the section, the pending password with them.
    useEffect(() => {
        setPasswordChange(UNCHANGED);
        passwordOwner.current = undefined;
    }, [section.resets]);
    // The client changing under a pending password is said, as for an edited form, with the section's Reload.
    const { setNotice: setSectionNotice, reloadNow: sectionReload } = section;
    useEffect(() => {
        const owner = passwordOwner.current;
        if (password.action === 'unchanged' || !owner || (owner.id === (client?.id ?? null) && owner.revision === client?.revision)) return;
        setSectionNotice(current => (current?.kind === 'err' && current.action ? current : {
            kind: 'warn',
            text: 'These settings changed somewhere else while you were editing. Your edits are kept until you reload.',
            action: { label: 'Reload', run: sectionReload }
        }));
    }, [password.action, client?.id, client?.revision, sectionReload, setSectionNotice]);
    // The mappings are a draft of their own, with the revision they were read at: a client test or another save never
    // replaces edited rows, and their save sends the revision the edits started from (fixes review, P2 3).
    // Both drafts carry the client they were read from: when another administrator selects another client while one is
    // being edited, a save never sends the edits to the client now shown (Codex delta review 4, P2 1).
    // The mappings' own version goes with their save: saving mappings does not advance the client's revision, so the server
    // refuses a stale copy by this version instead (Codex delta review 6, P2 1).
    const mappingSource = useMemo(() => client && {
        clientId: client.id, pathMappings: client.pathMappings ?? [], revision: client.revision, mappingsVersion: client.mappingsVersion
    }, [client]);
    const [mappingDraft, , , mappingsSaved, updateMappings, mappingsStale] = useDraft(mappingSource, { pathMappings: [] }, section);
    const mappings = useMemo<PathMapping[]>(() => (mappingDraft.pathMappings as PathMapping[] | undefined) ?? [], [mappingDraft.pathMappings]);
    const setMappings = useCallback((change: (rows: PathMapping[]) => PathMapping[]) =>
        updateMappings('pathMappings', (rows: PathMapping[] | undefined) => change(rows ?? [])), [updateMappings]);
    const [probePath, setProbePath] = useState('');
    const { run, test, setNotice, reloadNow } = section;
    /**
     * Refuses a save whose draft was read from another client than the one now selected, with a Reload. A draft of the
     * new-client form (no id) belongs to no existing client: once one is shown, the form's edits are not saved to it
     * (Pi review 5, P2 1).
     */
    const sameClient = useCallback((draftClientId: string | undefined) => {
        if ((draftClientId ?? null) === (client?.id ?? null)) return true;
        setNotice({
            kind: 'err',
            text: `The selected download client changed to ${client?.name ?? 'another client'} while you were editing. Your edits were made `
                + 'for the previous client and were not saved; reload to edit this one.',
            action: { label: 'Reload', run: reloadNow }
        });
        return false;
    }, [client, setNotice, reloadNow]);
    // `client` is undefined until one is saved; the handlers that read its id are only reachable once it exists.
    const save = useCallback(() => {
        if (!sameClient(draft.id as string | undefined)) return;
        const pendingPassword = password.action !== 'unchanged';
        const owner = passwordOwner.current;
        // A password typed into the new-client form is never saved to a client that appeared meanwhile; one typed for an
        // existing client is saved only to that client, and only with the revision it was typed against.
        if (pendingPassword && client && (!owner?.id || owner.revision === undefined)) {
            sameClient(NEW_CLIENT);
            return;
        }
        if (pendingPassword && owner?.id && !sameClient(owner.id)) return;
        // With a password pending, the save carries the oldest revision any of its edits started from.
        const formRevision = (draft.revision as number | undefined) ?? client?.revision;
        const passwordRevision = pendingPassword ? passwordOwner.current?.revision : undefined;
        const revision = passwordRevision !== undefined && formRevision !== undefined ? Math.min(passwordRevision, formRevision) :
            passwordRevision ?? formRevision;
        const creating = !client;
        const resetsAtSave = section.resets;
        void run(async () => {
            const body = { ...pick(draft, CLIENT_KEYS), password, revision };
            const saved = client ? await request<any>(api, 'PATCH', `Settings/DownloadClients/${client.id}`, body) :
                await request<any>(api, 'POST', 'Settings/DownloadClients', { ...body, revision: undefined });
            clientSaved(draft, sameRevision(saved), saved);
            // A password typed while this one was saving stays, and now stands on the client and revision the save
            // returned, so it can be saved next (final web review 2, P2 6).
            setPasswordChange(now => {
                if (now !== password) {
                    const typed = passwordOwner.current;
                    // Only a password this save moved forward from: typed for this client at the revision it was sent with,
                    // or typed into the new-client form, with no Reload since, when this save created the client (Pi review 3, P2 2).
                    if (typed && saved?.id && saved.revision !== undefined && ((typed.id === saved.id && typed.revision === revision)
                        || (typed.id === null && creating && resetsAtSave === resetsNow.current))) {
                        passwordOwner.current = { id: saved.id, revision: saved.revision };
                    }
                    return now;
                }
                passwordOwner.current = undefined;
                return UNCHANGED;
            });
        }, 'Saved. Test the client before grabbing.');
    }, [sameClient, run, api, client, draft, password, clientSaved, section.resets]);
    const saveMappings = useCallback(() => {
        if (!sameClient(mappingDraft.clientId as string | undefined)) return;
        // Edited mappings whose server copy changed meanwhile are not saved over it (Codex delta review 6, P2 1).
        if (mappingsStale()) {
            setNotice({
                kind: 'err',
                text: 'The mappings changed somewhere else while you were editing. Your edits were not saved; reload to see the current mappings.',
                action: { label: 'Reload', run: reloadNow }
            });
            return;
        }
        void run(async () => {
            const clientId = client.id;
            const revision = mappingDraft.revision ?? client.revision;
            const saved = await request<PathMapping[]>(api, 'PUT', `Settings/DownloadClients/${clientId}/PathMappings`, {
                pathMappings: mappings.map(mapping => ({ clientPathPrefix: mapping.clientPathPrefix, localPathPrefix: mapping.localPathPrefix })),
                revision,
                mappingsVersion: mappingDraft.mappingsVersion ?? client.mappingsVersion
            });
            // The mappings save returns the rows it created, not a version. The copy that is this save's own holds exactly
            // those rows, for the same client at the revision the save was sent with (a mappings save leaves the client's
            // revision alone): a client another administrator changed meanwhile, or rows saved again since, are someone
            // else's, and the edits keep the version they started from (Pi review 1, P2 1).
            const savedIds = mappingIds(saved);
            mappingsSaved(mappingDraft, record => record?.clientId === clientId && record?.revision === revision
                && mappingIds(record?.pathMappings) === savedIds);
        }, 'Mappings saved and probed.');
    }, [sameClient, mappingsStale, setNotice, reloadNow, run, api, client, mappings, mappingDraft, mappingsSaved]);
    const probe = useCallback(() => run(async () => {
        const result = await request<any>(api, 'POST', `Settings/DownloadClients/${client.id}/TestImportPath`, { clientPath: probePath });
        return { jfmodNotice: { kind: result.ok ? 'ok' : 'err', text: `${pathSentence(result.code)} (${result.code})` } };
    }), [run, api, client, probePath]);
    const testClient = useCallback(() => test(`Settings/DownloadClients/${client.id}/Test`, api), [test, api, client]);
    // A client found in Prowlarr fills the form and saves nothing; the password is typed, then Save and Test (P6.FU1).
    const fillFromProwlarr = useCallback((found: ProwlarrClient) => {
        set('name', found.name);
        set('baseUrl', found.baseUrl);
        set('username', found.username ?? '');
        setNotice({ kind: 'ok', text: `Filled from Prowlarr: ${found.baseUrl}. Type the password if it has one, then Save and Test.` });
    }, [set, setNotice]);
    const addMapping = useCallback(() => setMappings(rows => [...rows, { clientPathPrefix: '', localPathPrefix: '' }]), [setMappings]);
    const editProbePath = useCallback((event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setProbePath(event.target.value), []);
    const fields: FieldSpec[] = [
        { key: 'name', label: 'Name', type: 'text', required: true },
        { key: 'baseUrl', label: 'Transmission RPC address', type: 'text', required: true, help: 'For example http://host:9091/transmission/rpc, without credentials.' },
        { key: 'username', label: 'Username', type: 'text' },
        { key: 'label', label: 'Label added to every grab', type: 'text' },
        { key: 'downloadDirectory', label: 'Download folder in Transmission', type: 'text', required: true },
        { key: 'localDirectory', label: 'The same folder as this server sees it', type: 'text', required: true, help: 'Must be on the same filesystem as the libraries, so imports can hardlink.' },
        { key: 'openUrl', label: 'Web interface link', type: 'text', optional: true, help: 'Leave empty to build it from the RPC address (its rpc path becomes web). Set it when the web page is reached through another address or port.' },
        { key: 'enabled', label: 'Send grabs to this client', type: 'bool' }
    ];
    return (
        <SectionFrame id='client' eyebrow={props.eyebrow} title='Download Client' state={summarise('client', data)} notice={section.notice}
            onSave={save} saving={section.busy} saveMeta={client ? undefined : 'Not saved yet.'} next={props.next} onGo={props.onGo}
            actions={client && <Button variant='contained' color='inherit' disabled={section.busy} onClick={testClient} data-test='client'>Test</Button>}
        >
            <FoundInProwlarr api={api} source={data.prowlarr?.[0]} client={client} onFill={fillFromProwlarr} />
            <FieldForm fields={fields} draft={draft} onChange={set} />
            <SecretField key={client?.revision ?? 'new'} id='jfmodClientPassword' label='Password' configured={!!client?.passwordConfigured} change={password} onChange={setPassword} />
            {client && (
                <div className='jfmod-group'>
                    <h3 className='jfmod-grouptitle'>Path Mappings</h3>
                    {mappings.map((mapping, index) => (
                        // eslint-disable-next-line react/no-array-index-key -- an ordered list edited in place; order is the identity
                        <MappingRow key={index} index={index} mapping={mapping} setMappings={setMappings} />
                    ))}
                    <div className='jfmod-inlineactions'>
                        <Button variant='contained' color='inherit' onClick={addMapping}>Add Mapping</Button>
                        <Button variant='contained' color='inherit' disabled={section.busy} onClick={saveMappings}>Save Mappings</Button>
                    </div>
                    <div className='jfmod-testline'>
                        <TextField size='small' label='A path as Transmission reports it' value={probePath} onChange={editProbePath} />
                        <Button variant='contained' color='inherit' disabled={section.busy || !probePath} onClick={probe}>Test Import Path</Button>
                    </div>
                </div>
            )}
        </SectionFrame>
    );
};

// ---- Indexers, edited in a dialog ----

const INDEXER_KEYS = ['name', 'baseUrl', 'enabled', 'automateTitleMatches', 'categories', 'priority', 'downloadHosts', 'minimumSeedRatio',
    'minimumSeedMinutes', 'minIntervalSeconds', 'dailyQueryBudget'];

/**
 * A conflict notice whose Reload reads the record as it is now and makes it the dialog's starting point (whole-review
 * chunk 4b, P3 6): reopening the dialog would only show the same cached copy again.
 */
const conflictNotice = (error: unknown, reload: () => void): NoticeState => {
    const text = problemText(error);
    return { kind: 'err', text, action: text === CONFLICT_MESSAGE ? { label: 'Reload', run: reload } : undefined };
};

const IndexerDialog: FC<{ api: Api; indexer: any | null; onClose: (saved: boolean, close?: boolean) => void }> = ({ api, indexer: initial, onClose }) => {
    const [indexer, setIndexer] = useState(initial);
    // Whether this editor is still open: a save that completes after it was dismissed only refreshes the list, and never
    // closes an editor opened since, with that editor's typing (Pi review 5, P2 2).
    const open = useRef(true);
    useEffect(() => {
        open.current = true;
        return () => {
            open.current = false;
        };
    }, []);
    const [draft, set, replace] = useDraft(indexer, { enabled: true, automateTitleMatches: false, categories: [2000, 5000], priority: 25, downloadHosts: [] });
    const [key, setKey] = useState<SecretChange>(UNCHANGED);
    // What is on screen now, to tell after a save whether anything was edited while it was under way.
    const shown = useRef({ draft, key });
    shown.current = { draft, key };
    const [notice, setNotice] = useState<NoticeState | null>(null);
    const reloadRecord = useCallback(() => {
        request<any[]>(api, 'GET', 'Settings/Indexers').then(list => {
            const fresh = list.find(item => item.id === indexer?.id);
            if (!fresh) return;
            setIndexer(fresh);
            replace(fresh);
            // The record is read again: a key typed against the copy it replaces is cleared with the other edits.
            setKey(UNCHANGED);
            setNotice(null);
        }).catch(error => setNotice({ kind: 'err', text: problemText(error) }));
    }, [api, indexer, replace]);
    const fields: FieldSpec[] = [
        { key: 'name', label: 'Name', type: 'text', required: true },
        { key: 'baseUrl', label: 'Torznab address', type: 'text', required: true, help: 'The feed URL without the API key.' },
        { key: 'categories', label: 'Categories', type: 'list', help: 'Torznab category numbers, comma separated.' },
        { key: 'priority', label: 'Priority (lower first)', type: 'int' },
        { key: 'downloadHosts', label: 'Extra download hosts', type: 'list', optional: true },
        { key: 'minimumSeedRatio', label: 'Minimum seed ratio', type: 'number', optional: true },
        { key: 'minimumSeedMinutes', label: 'Minimum seeding minutes', type: 'int', optional: true },
        { key: 'minIntervalSeconds', label: 'Seconds between searches', type: 'int', optional: true },
        { key: 'dailyQueryBudget', label: 'Searches per day', type: 'int', optional: true },
        { key: 'enabled', label: 'Search this indexer', type: 'bool' },
        { key: 'automateTitleMatches', label: 'Let automation grab title-and-year matches from it', type: 'bool' }
    ];
    // One save at a time: a second press while one is under way does nothing (final web review).
    const saving = useRef(false);
    const [busy, setBusy] = useState(false);
    const save = useCallback(async () => {
        if (saving.current) return;
        saving.current = true;
        setBusy(true);
        try {
            const body = { ...pick(draft, INDEXER_KEYS), categories: (draft.categories as unknown[] ?? []).map(Number), apiKey: key };
            const saved = indexer ?
                await request<any>(api, 'PATCH', `Settings/Indexers/${indexer.id}`, { ...body, revision: draft.revision ?? indexer.revision }) :
                await request<any>(api, 'POST', 'Settings/Indexers', body);
            if (!open.current) {
                onClose(true, false);
                return;
            }
            // Edited while it was saving: the editor stays open on the saved record with those edits, for another Save
            // (final web review 2, P2 7). A key typed meanwhile stays too, now for the saved revision.
            if (shown.current.draft !== draft || shown.current.key !== key) {
                setIndexer(saved);
                set('revision', saved?.revision);
                setKey(now => (now === key ? UNCHANGED : now));
                setNotice({ kind: 'warn', text: 'Saved. What you changed while it was saving is not saved yet: save again to keep it.' });
                return;
            }
            onClose(true);
        } catch (error) {
            setNotice(conflictNotice(error, reloadRecord));
        } finally {
            saving.current = false;
            setBusy(false);
        }
    }, [api, indexer, draft, key, onClose, reloadRecord, set]);
    const cancel = useCallback(() => onClose(false), [onClose]);
    return (
        <Dialog open onClose={cancel} fullWidth maxWidth='sm' className='jfmod-settingsDialog'>
            <DialogTitle>{indexer ? `Edit ${indexer.name}` : 'Add Indexer'}</DialogTitle>
            <DialogContent>
                <Notice notice={notice} />
                <FieldForm fields={fields} draft={draft} onChange={set} />
                <SecretField id='jfmodIndexerKey' label='API key' configured={!!indexer?.apiKeyConfigured} change={key} onChange={setKey} />
            </DialogContent>
            <DialogActions>
                <Button variant='contained' color='inherit' onClick={cancel}>Cancel</Button>
                <Button variant='contained' disabled={busy} onClick={save}>Save</Button>
            </DialogActions>
        </Dialog>
    );
};

// ---- Prowlarr: one source whose torrent indexers are synced in (P7.S9) ----

/** The notice a Prowlarr sync reports: its counts, or the code that stopped it. */
const syncNotice = (outcome: any): NoticeState => {
    if (outcome.code !== 'ok') return { kind: 'err', text: `The sync changed nothing (${outcome.code}).` };
    const failed = outcome.failed.length ? `, failed: ${outcome.failed.join(', ')}` : '';
    return {
        kind: 'ok',
        text: `Synced: ${outcome.seen} seen, ${outcome.created} added, ${outcome.updated} changed, ${outcome.disabled} turned off, ${outcome.removed} removed, ${outcome.verified} verified${failed}.`
    };
};

/** The address the Prowlarr card's help offers to fill in (P7.FU9): Prowlarr's own name and port in a Docker network. */
// eslint-disable-next-line sonarjs/no-clear-text-protocols -- an example address on a Docker network, which Prowlarr serves over http
const PROWLARR_EXAMPLE = 'http://prowlarr:9696';

/** Prowlarr's General settings page, where its API key is, for a typed http(s) address; nothing for anything else (P7.FU9). */
const prowlarrKeyPage = (address: unknown) => {
    let url: URL;
    try {
        url = new URL(typeof address === 'string' ? address.trim() : '');
    } catch {
        return undefined;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    // Relative to the address with one trailing slash, so a Prowlarr under a path (http://host/prowlarr) keeps it.
    const href = new URL('settings/general', url.href.endsWith('/') ? url.href : url.href + '/').href;
    return { href, title: 'Open Prowlarr\'s General settings, where its API key is' };
};

const ProwlarrCard: FC<SectionProps> = ({ api, data, reload }) => {
    const source = data.prowlarr?.[0];
    const section = useSectionState(reload, PROWLARR_READS);
    const [draft, set, , sourceSaved] = useDraft(source, { baseUrl: '', enabled: true, syncIntervalMinutes: 360 }, section);
    const keySecret = useSecretChange(source?.id, source?.revision, section.resets);
    const key = keySecret.change;
    const setKey = keySecret.set;
    const [confirmDialog, ask] = useConfirm();
    const { run, test, setNotice: setSourceNotice, reloadNow: reloadSource } = section;
    const fillAddress = useCallback((address: string) => set('baseUrl', address), [set]);
    const keyPage = useMemo(() => prowlarrKeyPage(draft.baseUrl), [draft.baseUrl]);
    // `source` is undefined until one is added; the handlers that read its id are only reachable once it exists.
    const save = useCallback(() => {
        // A key typed for another source (or for a new one before this one appeared) is never sent to this one, and neither
        // are edits bound to another source, such as one this form created while another is now shown (Pi review 3, P2 1).
        const draftId = draft.id as string | undefined;
        if (!keySecret.typedFor(source?.id) || (draftId ?? null) !== (source?.id ?? null)) {
            setSourceNotice({
                kind: 'err', text: 'The Prowlarr source changed while you were editing. Your edits were not saved; reload to edit this one.',
                action: { label: 'Reload', run: reloadSource }
            });
            return;
        }
        const revision = source ? keySecret.revisionFor((draft.revision as number | undefined) ?? source.revision) : undefined;
        const origin = keySecret.origin(revision);
        void run(async () => {
            const body = { ...pick(draft, ['baseUrl', 'enabled', 'syncIntervalMinutes']), apiKey: key };
            const saved = source ?
                await request<any>(api, 'PATCH', `Settings/Prowlarr/${source.id}`, { ...body, revision }) :
                await request<any>(api, 'POST', 'Settings/Prowlarr', body);
            sourceSaved(draft, sameRevision(saved), saved);
            keySecret.saved(key, { id: saved?.id, revision: saved?.revision, created: !source }, origin);
        }, 'Saved. Sync to import its indexers.');
    }, [run, api, source, draft, key, keySecret, sourceSaved, setSourceNotice, reloadSource]);
    const syncNow = useCallback(() => run(async () => {
        const outcome = await request<any>(api, 'POST', `Settings/Prowlarr/${source.id}/Sync`);
        return { jfmodNotice: syncNotice(outcome) };
    }), [run, api, source]);
    const testSource = useCallback(() => test(`Settings/Prowlarr/${source.id}/Test`, api), [test, api, source]);
    const remove = useCallback(() => ask({
        title: 'Remove Prowlarr?', text: 'Every indexer it synced is removed with it. Grabs keep their recorded source name.',
        action: 'Remove',
        onConfirm: () => {
            void run(() => request(api, 'DELETE', `Settings/Prowlarr/${source.id}`), 'Removed.');
        }
    }), [ask, run, api, source]);
    if (!data.prowlarr) return null;
    return (
        <div className='jfmod-group' data-prowlarr='card'>
            <h3 className='jfmod-grouptitle'>Prowlarr</h3>
            <Notice notice={section.notice} />
            {source && (
                <p className='jfmod-lead fieldDescription'>
                    {source.indexerCount} synced indexer(s) · last sync {when(source.lastSyncAt)}{source.lastSyncOutcome ? ` (${source.lastSyncOutcome})` : ''}
                </p>
            )}
            <FieldForm fields={[
                { key: 'baseUrl', label: 'Prowlarr address', type: 'text', required: true,
                    help: <>For example <FillExample value={PROWLARR_EXAMPLE} onFill={fillAddress} />, without credentials.</> },
                { key: 'syncIntervalMinutes', label: 'Sync every (minutes)', type: 'int' },
                { key: 'enabled', label: 'Sync on a schedule', type: 'bool' }
            ]} draft={draft} onChange={set} />
            <SecretField key={source?.revision ?? 'new'} id='jfmodProwlarrKey' label='API key' required={!source?.apiKeyConfigured} configured={!!source?.apiKeyConfigured} change={key} onChange={setKey}
                keyPage={keyPage} />
            <div className='jfmod-inlineactions'>
                <Button variant='contained' color='inherit' disabled={section.busy} onClick={save}>{source ? 'Save' : 'Add Prowlarr'}</Button>
                {source && <Button variant='contained' color='inherit' disabled={section.busy} onClick={testSource}>Test</Button>}
                {source && <Button variant='contained' disabled={section.busy} onClick={syncNow} data-prowlarr='sync'>Sync Now</Button>}
                {source && (
                    <Button variant='contained' color='error' disabled={section.busy} data-prowlarr='remove' onClick={remove}>Remove</Button>
                )}
            </div>
            {confirmDialog}
        </div>
    );
};

const indexerKind = (indexer: any): StateKind => {
    if (!indexer.enabled) return 'off';
    if (indexer.lastError) return 'err';
    return indexer.verified ? 'ok' : 'warn';
};

const indexerWords = (indexer: any) => {
    if (!indexer.enabled) return 'off';
    if (indexer.lastError) return 'last test failed';
    return indexer.verified ? 'verified' : 'not verified';
};

/** What the server remembers of an indexer's last test: a failure first, then a pass, else it was never tested. */
const indexerTestState = (indexer: any): TestState => {
    if (indexer.lastError) return { kind: 'fail', reason: indexer.lastError };
    if (indexer.verified) return { kind: 'ok', checkedAt: indexer.capabilitiesFetchedAt };
    return { kind: 'idle' };
};

interface IndexerRowProps {
    api: Api;
    indexer: any;
    busy: boolean;
    test: (path: string, api: Api) => Promise<void>;
    run: (work: () => Promise<unknown>, success?: string) => Promise<void>;
    ask: (pending: { title: string; text: string; action: string; onConfirm: () => void }) => void;
    onEdit: (indexer: any) => void;
}

const IndexerRow: FC<IndexerRowProps> = ({ api, indexer, busy, test, run, ask, onEdit }) => {
    // The icon spins and the status says "Testing…" until the answer is in (user, 2026-10-09).
    const [testing, setTesting] = useState(false);
    const testIndexer = useCallback(async () => {
        setTesting(true);
        try {
            await test(`Settings/Indexers/${indexer.id}/Test`, api);
        } finally {
            setTesting(false);
        }
    }, [test, api, indexer.id]);
    const edit = useCallback(() => onEdit(indexer), [onEdit, indexer]);
    const remove = useCallback(() => ask({
        title: `Remove ${indexer.name}?`, text: 'Grabs keep their recorded source name.', action: 'Remove',
        onConfirm: () => {
            void run(() => request(api, 'DELETE', `Settings/Indexers/${indexer.id}`), 'Removed.');
        }
    }), [ask, run, api, indexer.id, indexer.name]);
    return (
        <div className='jfmod-brow' data-indexer={indexer.id}>
            <div className='jfmod-brow-main'>
                {/* The indexer's colour in the release picker, read-only (P4.FU25, guides/indexer-colour.md). */}
                <strong><span className='jfmod-indexerColour' title='Colour in the release picker'
                    style={{ background: indexerColour(indexer.colorIndex) }} />{indexer.name}
                {/* Prowlarr's slow default 1337x definition (P4.FU27, guides/buttons-and-row-actions.md). */}
                {indexer.slowSetupHowTo && <SlowSetupGroup href={indexer.slowSetupHowTo} />}</strong>
                <span className='jfmod-sub'>
                    {indexer.managedBy === 'prowlarr' ? 'Synced from Prowlarr · ' : ''}priority {indexer.priority}
                    {indexer.lastError ? ` · last error ${indexer.lastError}` : ''}
                    {indexer.breakerOpenUntil ? ` · paused until ${when(indexer.breakerOpenUntil)}` : ''}
                </span>
            </div>
            <span className='jfmod-teststate' aria-live='polite'>
                <StatePill kind={testing ? 'busy' : indexerKind(indexer)}>
                    {testing ? 'Testing…' : indexerWords(indexer)}
                </StatePill>
            </span>
            <span className='jfmod-rowactions'>
                <TestIcon label={`Test ${indexer.name}`} test={testing ? { kind: 'testing' } : indexerTestState(indexer)} busy={busy} onClick={testIndexer} data={{ 'row-action': 'test' }} />
                <IconAction label={`Edit ${indexer.name}`} onClick={edit} data={{ 'row-action': 'edit' }}><EditIcon /></IconAction>
                {indexer.managedBy !== 'prowlarr' && (
                    <IconAction label={`Remove ${indexer.name}`} red onClick={remove} data={{ 'row-action': 'remove', 'indexer-remove': indexer.id }}><DeleteIcon /></IconAction>
                )}
            </span>
        </div>
    );
};

export const IndexersSection: FC<SectionProps> = props => {
    const { api, data, reload } = props;
    // One blue button per view (user, 2026-10-07): with a Prowlarr source, Sync Now is the section's main action and Add
    // Indexer is grey; without one, Add Indexer is. Prowlarr's own Save / Add Prowlarr stays grey either way.
    const prowlarrSource = !!data.prowlarr?.[0];
    const section = useSectionState(reload);
    const [confirmDialog, ask] = useConfirm();
    const [editing, setEditing] = useState<any | null | undefined>(undefined);
    const add = useCallback(() => setEditing(null), []);
    const closeDialog = useCallback((saved: boolean, close = true) => {
        if (close) setEditing(undefined);
        if (saved) void reload();
    }, [reload]);
    return (
        <SectionFrame id='indexers' eyebrow={props.eyebrow} title='Indexers' state={summarise('indexers', data)} notice={section.notice}
            next={props.next} onGo={props.onGo}
        >
            {/* Prowlarr first: one address and a key is all most people give; the indexers it syncs, and the ones added by
                hand, are the advanced part and follow it (user, 2026-10-10). */}
            <ProwlarrCard {...props} />
            {/* Add Indexer sits with the list it adds to (user, 2026-10-17), not in the step header. */}
            <div className='jfmod-grouphead'>
                {data.prowlarr && <h3 className='jfmod-grouptitle' data-indexers='title'>Indexers</h3>}
                <Button variant='contained' color={prowlarrSource ? 'inherit' : 'primary'} onClick={add}>Add Indexer</Button>
            </div>
            <div className='jfmod-blist'>
                {data.indexers.length === 0 && <div className='jfmod-empty'>No indexer yet.</div>}
                {data.indexers.map(indexer => (
                    <IndexerRow key={indexer.id} api={api} indexer={indexer} busy={section.busy} test={section.test} run={section.run} ask={ask}
                        onEdit={setEditing} />
                ))}
            </div>
            {editing !== undefined && <IndexerDialog api={api} indexer={editing} onClose={closeDialog} />}
            {confirmDialog}
        </SectionFrame>
    );
};

// ---- Quality profiles, edited in a dialog (qualityProfiles.tsx, P4.FU9) ----

interface ProfileRowProps {
    api: Api;
    profile: any;
    busy: boolean;
    canMakeDefault: boolean;
    run: (work: () => Promise<unknown>, success?: string) => Promise<void>;
    ask: (pending: { title: string; text: string; action: string; onConfirm: () => void }) => void;
    onMakeDefault: (id: string) => void;
    onEdit: (profile: any) => void;
}

const ProfileRow: FC<ProfileRowProps> = ({ api, profile, busy, canMakeDefault, run, ask, onMakeDefault, onEdit }) => {
    const makeDefault = useCallback(() => onMakeDefault(profile.id), [onMakeDefault, profile.id]);
    const edit = useCallback(() => onEdit(profile), [onEdit, profile]);
    const remove = useCallback(() => ask({
        title: `Remove ${profile.name}?`, text: 'The profile is deleted. Titles already downloaded are not affected.', action: 'Remove',
        onConfirm: () => {
            void run(() => request(api, 'DELETE', `Settings/QualityProfiles/${profile.id}`), 'Removed.');
        }
    }), [ask, run, api, profile.id, profile.name]);
    // The Default chip is a status, not a button; Make Default is the first icon of every other row, so Edit and Remove
    // line up at the right edge of every row (user, 2026-10-08).
    return (
        <div className='jfmod-brow' data-profile={profile.id}>
            <div className='jfmod-brow-main'>
                <strong>{profile.name}{profile.prefer === 'everywhere' && <PhoneMark label={PHONE_PROFILE_LABEL} />}</strong>
                <span className='jfmod-sub' data-qp='row-summary'>{profileSummary(profile)}</span>
            </div>
            <span>
                {profile.isDefault && <span className='jfmod-chip jfmod-chip-primary'>Default</span>}
                {profile.presetId && <span className='jfmod-chip' data-qp='preset-chip'>Predefined</span>}
            </span>
            <span className='jfmod-rowactions'>
                {!profile.isDefault && (
                    <IconAction label={`Make ${profile.name} Default`} disabled={busy} refused={!canMakeDefault} onClick={makeDefault} data={{ 'row-action': 'default' }}>
                        <StarBorderIcon />
                    </IconAction>
                )}
                <IconAction label={`Edit ${profile.name}`} onClick={edit} data={{ 'row-action': 'edit' }}><EditIcon /></IconAction>
                <IconAction label={`Remove ${profile.name}`} red onClick={remove} data={{ 'row-action': 'remove' }}><DeleteIcon /></IconAction>
            </span>
        </div>
    );
};

export const ProfilesSection: FC<SectionProps> = props => {
    const { api, data, reload } = props;
    const section = useSectionState(reload);
    const [confirmDialog, ask] = useConfirm();
    const [editing, setEditing] = useState<any | null | undefined>(undefined);
    const presets = usePresets(api, data.profiles);
    const presetMissing = presets.some(preset => !preset.added);
    const { run } = section;
    const makeDefault = useCallback((id: string) => run(() => request(api, 'PATCH', 'Settings/Acquisition', {
        enabled: data.acquisition.enabled, downloadClientId: data.acquisition.downloadClientId ?? null, defaultQualityProfileId: id,
        revision: data.acquisition.revision
    }), 'Default changed.'), [run, api, data.acquisition]);
    const add = useCallback(() => setEditing(null), []);
    // The shipped presets (P4.FU9): adds only the ones that are not profiles yet and never changes an existing profile.
    // The notice is worded here, in the interface's words ("predefined"), from what the server says it added.
    const addPresets = useCallback(() => run(async () => {
        const result = await request<{ added: unknown[]; skipped: { reason: string }[] }>(api, 'POST', 'Settings/QualityProfiles/Presets');
        const added = result.added?.length ?? 0;
        const named = result.skipped?.filter(item => item.reason === 'name_in_use').length ?? 0;
        const noun = added === 1 ? 'profile' : 'profiles';
        let text = added ? `Added ${added} predefined ${noun}.` : 'Every predefined profile is already here; nothing was changed.';
        if (named) text += ` ${named} left out because another profile has the same name.`;
        return { jfmodNotice: { kind: 'ok', text } };
    }), [run, api]);
    const closeDialog = useCallback((saved: boolean, close = true) => {
        if (close) setEditing(undefined);
        if (saved) void reload();
    }, [reload]);
    return (
        <SectionFrame id='profiles' eyebrow={props.eyebrow} title='Quality Profiles' state={summarise('profiles', data)} notice={section.notice}
            next={props.next} onGo={props.onGo}
            actions={<>
                <Button variant='contained' onClick={add}>Add Profile</Button>
                {presetMissing && (
                    <Button variant='contained' color='inherit' disabled={section.busy} onClick={addPresets} data-test='add-presets'>Add Predefined Profiles</Button>
                )}
            </>}
        >
            <div className='jfmod-blist'>
                {data.profiles.length === 0 && (
                    <div className='jfmod-empty'>
                        No profile yet. <b>Add Predefined Profiles</b> gives you {presets.map(preset => preset.name).join(', ') || 'ready-made profiles'}, ready to use
                        and editable; <b>Add Profile</b> starts one from scratch. The first profile becomes the default.
                    </div>
                )}
                {data.profiles.map(profile => (
                    <ProfileRow key={profile.id} api={api} profile={profile} busy={section.busy} canMakeDefault={!!data.acquisition} run={run} ask={ask}
                        onMakeDefault={makeDefault} onEdit={setEditing} />
                ))}
            </div>
            <p className='jfmod-sub jfmod-qp-foot'>A title uses the default profile unless you pick another one in the release picker.</p>
            {editing !== undefined && (
                <QualityProfileDialog api={api} profile={editing} qualities={data.acquisition?.qualities ?? []} presets={presets}
                    tvNames={tvNames(data)} onClose={closeDialog} />
            )}
            {confirmDialog}
        </SectionFrame>
    );
};

/** The ticked TVs' names, in catalogue order (Phase 12): Best on My TVs's small line and its hint name them. */
const tvNames = (data: SettingsData) =>
    data.tvModels?.models.filter(model => data.tvModels?.selected.includes(model.id)).map(model => model.name) ?? [];

// ---- TVs (Phase 12 M32, mockup 1 B; D58) ----

/** A model's one line of what it plays, as the catalogue says it: `webOS 6 · Dolby Vision · HDR10 · HLG · no HDR10+ · …`. */
const tvLine = (model: TvModel) => [
    `webOS ${model.webOS}`, model.dolbyVision ? 'Dolby Vision' : 'no Dolby Vision', 'HDR10', model.hlg ? 'HLG' : 'no HLG',
    model.hdr10Plus ? 'HDR10+' : 'no HDR10+', model.ddPlusAtmos ? 'Dolby Digital Plus and Atmos' : 'Dolby Digital Plus',
    model.dts ? 'DTS' : 'no DTS'
].join(' · ');

/** What the ticks change, in words: what every ticked TV plays first and last, or the general order with none ticked. */
const tvsOutcome = (models: TvModel[]) => {
    if (!models.length) {
        return 'With no TV ticked, Best on My TVs means the best picture and sound in general: Dolby Vision, then HDR10+, HDR10 and HDR; '
            + 'Atmos and lossless sound first.';
    }
    const every = (has: (model: TvModel) => boolean) => models.every(has);
    const these = models.length === 1 ? 'this TV' : 'these TVs';
    const picture = every(model => model.dolbyVision) ? 'Dolby Vision first, then HDR10' : 'HDR10 first';
    const plus = every(model => model.hdr10Plus) ? ', then HDR10+' : ' (HDR10+ plays as HDR10)';
    const dts = every(model => model.dts) ? '' : `; DTS last, because ${these} cannot play it and the server would convert it`;
    return `Releases for ${these}: ${picture}${plus}. Dolby Digital Plus and Dolby Digital sound first${dts}.`;
};

const TvRow: FC<{ model: TvModel; ticked: boolean; onToggle: (id: string) => void }> = ({ model, ticked, onToggle }) => {
    const toggle = useCallback(() => onToggle(model.id), [onToggle, model.id]);
    return (
        <label className='jfmod-brow jfmod-tvrow' data-tv={model.id} htmlFor={'jfmod-tv-' + model.id} aria-label={`${model.name} (${model.year})`}>
            <input type='checkbox' id={'jfmod-tv-' + model.id} className='jfmod-tvcheck' checked={ticked} onChange={toggle}
                aria-label={`${model.name} (${model.year})`} aria-describedby={'jfmod-tvline-' + model.id} />
            <span className='jfmod-brow-main'>
                <strong>{model.name} ({model.year})</strong>
                <span className='jfmod-sub' id={'jfmod-tvline-' + model.id}>{tvLine(model)}</span>
            </span>
        </label>
    );
};

/**
 * The TVs the household watches on (Phase 12 M32, mockup 1 B): a checklist of the plugin's TVs catalogue, each model with what it
 * plays, and a sentence that says what the ticks change. A profile set to Best on My TVs prefers releases every ticked TV plays.
 */
export const TvsSection: FC<SectionProps> = props => {
    const { api, data, reload } = props;
    const section = useSectionState(reload, ['Settings/TvModels']);
    const source = data.tvModels;
    const [ticked, setTicked] = useState<string[]>(() => source?.selected ?? []);
    const sourceKey = source ? `${source.revision}:${source.selected.join()}` : '';
    useEffect(() => {
        if (source) setTicked(source.selected);
    // Read again only when the server's copy changes, not on every render of the same copy.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sourceKey]);
    const toggle = useCallback((id: string) => setTicked(current => (current.includes(id) ? current.filter(value => value !== id) : [...current, id])), []);
    const { run } = section;
    const save = useCallback(() => run(() => request(api, 'PATCH', 'Settings/TvModels', { selected: ticked, revision: source?.revision }), 'Saved.'),
        [run, api, ticked, source?.revision]);
    if (!source) {
        return <SectionFrame id='tvs' eyebrow={props.eyebrow} title='TVs' notice={{ kind: 'warn', text: 'Unavailable in this plugin build.' }} onGo={props.onGo}><span /></SectionFrame>;
    }
    const chosen = source.models.filter(model => ticked.includes(model.id));
    return (
        <SectionFrame id='tvs' eyebrow={props.eyebrow} title='TVs' state={summarise('tvs', data)} notice={section.notice}
            onSave={save} saving={section.busy} next={props.next} onGo={props.onGo}
        >
            <p className='jfmod-sub jfmod-tvs-lead'>Tick the TVs you watch on. A profile set to Best on My TVs picks releases that every ticked TV plays.</p>
            <div className='jfmod-blist jfmod-tvs'>
                {source.models.map(model => <TvRow key={model.id} model={model} ticked={ticked.includes(model.id)} onToggle={toggle} />)}
            </div>
            <p className='jfmod-sub jfmod-tvs-outcome' data-tvs='outcome'>{tvsOutcome(chosen)}</p>
        </SectionFrame>
    );
};

// ---- Grabbing ----

export const GrabbingSection: FC<SectionProps> = props => {
    const { api, data, reload } = props;
    const acquisition = data.acquisition ?? {};
    const section = useSectionState(reload, ACQUISITION_READS);
    const [draft, set, , acquisitionSaved] = useDraft(data.acquisition, {}, section);
    const phones = !!data.acquisition && 'phoneProfileId' in data.acquisition;
    const { run } = section;
    const save = useCallback(() => run(async () => {
        const saved = await request<any>(api, 'PATCH', 'Settings/Acquisition', {
            enabled: !!draft.enabled, downloadClientId: draft.downloadClientId ?? null, defaultQualityProfileId: draft.defaultQualityProfileId ?? null,
            // Only to a plugin that has it (Phase 12): an older one refuses a field it does not know.
            ...(phones ? { phoneProfileId: draft.phoneProfileId ?? null } : {}),
            revision: draft.revision ?? acquisition.revision
        });
        acquisitionSaved(draft, sameRevision(saved), saved);
    }, 'Saved.'), [run, api, draft, acquisition.revision, acquisitionSaved, phones]);
    // Both profile selects mark every profile that plays everywhere, by its own Prefer (D180), whichever is chosen for phones.
    const profileOptions = data.profiles.map(profile => ({ value: profile.id, label: profile.name, detail: profileSummary(profile),
        phone: profile.prefer === 'everywhere' }));
    return (
        <SectionFrame id='grabbing' eyebrow={props.eyebrow} title='Grabbing' state={summarise('grabbing', data)} notice={section.notice}
            onSave={save} saving={section.busy} next={props.next} onGo={props.onGo}
        >
            {(acquisition.blockers ?? []).length > 0 && (
                <div className='jfmod-blist'>
                    {(acquisition.blockers as string[]).map(code => (
                        <BlockerRow key={code} code={code} fallback='grabbing' onGo={props.onGo} />
                    ))}
                </div>
            )}
            <FieldForm fields={[
                { key: 'enabled', label: 'Allow grabs', type: 'bool', help: `A grab can be cancelled for ${acquisition.holdSeconds ?? 5} seconds before it is sent.` },
                { key: 'downloadClientId', label: 'Download client', type: 'select', options: data.clients.map(client => ({ value: client.id, label: client.name })) },
                { key: 'defaultQualityProfileId', label: 'Default quality profile', type: 'select', options: profileOptions },
                ...(phones ? [{ key: 'phoneProfileId', label: 'Quality profile for phones', type: 'select' as const, options: profileOptions,
                    help: 'Phones play a title\'s file at 1080p or below. Get Another Quality starts with this profile on a title that has none.' }] : [])
            ]} draft={draft} onChange={set} />
        </SectionFrame>
    );
};

// ---- Import and seeding ----

const IMPORT_FIELDS: FieldSpec[] = [
    { key: 'importEnabled', label: 'Import completed downloads', type: 'bool' },
    { key: 'seedReleaseEnabled', label: 'Release the torrent from the client once its seed goals are met', type: 'bool',
        help: 'The client forgets the torrent; its downloaded files stay on disk. JellyfinMod never deletes downloaded files.' },
    { key: 'seedFloorRatio', label: 'Seed at least to ratio', type: 'number', optional: true },
    { key: 'seedFloorHours', label: 'Or for hours', type: 'int', optional: true },
    { key: 'importPollSeconds', label: 'Check the client every (seconds)', type: 'int' },
    { key: 'videoExtensions', label: 'Video file extensions', type: 'list' },
    { key: 'stalledAfterHours', label: 'Show a download as stalled after (hours)', type: 'int' },
    { key: 'scanTimeoutMinutes', label: 'Ask for a library scan again after (minutes)', type: 'int' },
    { key: 'queueVisibleToUsers', label: 'Show the queue to every user with library access', type: 'bool' }
];

/** A flat section whose GET and PATCH share one DTO shape: Import and Automation. */
const FlatSection: FC<SectionProps & { id: string; title: string; path: string; source: any; fields: FieldSpec[]; extra?: React.ReactNode; actions?: React.ReactNode }> = props => {
    const { api, reload, source, fields, path } = props;
    const section = useSectionState(reload, [path]);
    const [draft, set, , flatSaved] = useDraft(source, {}, section);
    const { run } = section;
    const save = useCallback(() => run(async () => {
        const saved = await request<any>(api, 'PATCH', path, { ...pick(draft, fields.map(field => field.key)), revision: draft.revision ?? source?.revision });
        flatSaved(draft, sameRevision(saved), saved);
    }, 'Saved.'), [run, api, path, draft, fields, source, flatSaved]);
    if (!source) {
        return <SectionFrame id={props.id} eyebrow={props.eyebrow} title={props.title} notice={{ kind: 'warn', text: 'Unavailable in this plugin build.' }} onGo={props.onGo}><span /></SectionFrame>;
    }
    return (
        <SectionFrame id={props.id} eyebrow={props.eyebrow} title={props.title} state={summarise(props.id, props.data)} notice={section.notice}
            onSave={save} saving={section.busy} next={props.next} onGo={props.onGo} actions={props.actions}
        >
            <FieldForm fields={fields} draft={draft} onChange={set} />
            {props.extra}
        </SectionFrame>
    );
};

export const ImportSection: FC<SectionProps> = props => (
    <FlatSection {...props} id='import' title='Import and Seeding' path='Settings/Import' source={props.data.importSettings} fields={IMPORT_FIELDS} />
);

// ---- Automation ----

const AUTOMATION_FIELDS: FieldSpec[] = [
    { key: 'automationEnabled', label: 'Search and grab on a schedule', type: 'bool' },
    { key: 'automationIntervalHours', label: 'Run every (hours)', type: 'int' },
    { key: 'automationBatchSize', label: 'Titles per run', type: 'int' },
    { key: 'newEpisodeDelayMinutes', label: 'Wait after an episode airs (minutes)', type: 'int' },
    { key: 'dailyAutoGrabBudget', label: 'Automatic grabs per day', type: 'int' },
    { key: 'maxConcurrentImports', label: 'Stop grabbing while this many imports are open', type: 'int' },
    { key: 'freeSpaceFloorPercent', label: 'Keep this much of the library disk free (%)', type: 'int' },
    { key: 'freeSpaceFloorBytes', label: 'And at least (bytes)', type: 'int' },
    { key: 'decisionLogCap', label: 'Decisions kept', type: 'int' },
    { key: 'episodeUpgradesEnabled', label: 'Upgrade episodes and allow Replace', type: 'bool' },
    { key: 'reacquireReclaimed', label: 'Grab reclaimed titles again', type: 'bool' }
];

/** Also get a 1080p copy for phones (Phase 12 M36, D56), after the upgrades switch; only to a plugin that has it. */
const PHONE_COPIES_FIELD: FieldSpec = {
    key: 'fetchPhoneCopies', label: 'Also get a 1080p copy for phones', type: 'bool',
    help: 'For a title whose only files are above 1080p, look for one with the quality profile for phones (Grabbing). A copy that you or '
        + 'retention removed is never fetched again.'
};

const automationFields = (automation: any): FieldSpec[] => {
    if (!automation || !('fetchPhoneCopies' in automation)) return AUTOMATION_FIELDS;
    const at = AUTOMATION_FIELDS.findIndex(field => field.key === 'episodeUpgradesEnabled') + 1;
    return [...AUTOMATION_FIELDS.slice(0, at), PHONE_COPIES_FIELD, ...AUTOMATION_FIELDS.slice(at)];
};

export const AutomationSection: FC<SectionProps> = props => {
    const { api, data, reload } = props;
    const section = useSectionState(reload);
    const { run } = section;
    const runNow = useCallback(() => run(() => request(api, 'POST', 'Automation/Run'), 'Run started.'), [run, api]);
    const decisions = data.decisions.slice(0, 10);
    return (
        <FlatSection {...props} id='automation' title='Automation' path='Settings/Automation' source={data.automation} fields={automationFields(data.automation)}
            actions={<Button variant='contained' color='inherit' disabled={section.busy} onClick={runNow}>Run Now</Button>}
            extra={<div className='jfmod-group'>
                <Notice notice={section.notice} />
                <h3 className='jfmod-grouptitle'>Recent Decisions</h3>
                <div className='jfmod-loglist'>
                    {decisions.length === 0 && <div className='jfmod-empty'>No decision recorded yet.</div>}
                    {decisions.map(decision => (
                        <div className='jfmod-logrow' key={decision.id}>{when(decision.createdAt)} · {decision.title ?? decision.targetId} · {decision.kind} · {decision.reason}</div>
                    ))}
                </div>
            </div>}
        />
    );
};

// ---- Retention and seed protection ----

export const RetentionSection: FC<SectionProps> = props => {
    const { api, data, reload } = props;
    const section = useSectionState(reload, RETENTION_READS);
    const [draft, set, , retentionSaved] = useDraft(data.retention, {}, section);
    const [seedDraft, setSeed, , seedSaved] = useDraft(data.seed, {}, section);
    const passwordSecret = useSecretChange('seed-protection', data.seed?.revision, section.resets);
    const password = passwordSecret.change;
    const setPassword = passwordSecret.set;
    const users = useMemo(() => data.users.filter(user => !user.Policy?.IsDisabled).map(user => ({ value: user.Id, label: user.Name })), [data.users]);
    const { run, test } = section;
    // Both DTOs are present whenever Save is reachable: the section renders its "Unavailable" frame without them.
    // Seed protection first, then retention (whole-review chunk 4b, P2 1): a refused seed source changes nothing, so retention
    // is never switched on against the old one. If retention is then refused, the saved seed protection is reloaded and the
    // notice says which half was saved.
    const save = useCallback(() => run(async () => {
        const separate = seedDraft.source === 'separate';
        const seedRevision = separate ? passwordSecret.revisionFor((seedDraft.revision as number | undefined) ?? data.seed.revision) :
            seedDraft.revision ?? data.seed.revision;
        const origin = passwordSecret.origin(seedRevision);
        const savedSeed = await request<any>(api, 'PATCH', 'Settings/SeedProtection', {
            source: seedDraft.source, rpcUrl: separate ? seedDraft.rpcUrl ?? '' : null, username: separate ? seedDraft.username ?? '' : null,
            password: separate ? password : UNCHANGED,
            revision: seedRevision
        });
        passwordSecret.saved(password, { id: 'seed-protection', revision: savedSeed?.revision }, origin);
        seedSaved(seedDraft, sameRevision(savedSeed), savedSeed);
        let savedRetention: any;
        try {
            savedRetention = await request<any>(api, 'PATCH', 'Settings/Retention', {
                ...pick(draft, ['enabled', 'reclaimAfterDays', 'watchedUserMode', 'exemptFavourites']),
                selectedUserId: draft.watchedUserMode === 'selectedUser' ? draft.selectedUserId ?? null : null,
                revision: draft.revision ?? data.retention.revision
            });
        } catch (error) {
            await reload();
            throw partialSave('Seed protection was saved; retention was not. ' + problemText(error));
        }
        retentionSaved(draft, sameRevision(savedRetention), savedRetention);
    }, 'Saved.'), [run, api, draft, seedDraft, seedSaved, retentionSaved, password, passwordSecret, reload, data.retention, data.seed]);
    const testSeed = useCallback(() => test('Settings/SeedProtection/Test', api), [test, api]);
    if (!data.retention || !data.seed) {
        return <SectionFrame id='retention' eyebrow={props.eyebrow} title='Retention' notice={{ kind: 'warn', text: 'Unavailable in this plugin build.' }} onGo={props.onGo}><span /></SectionFrame>;
    }
    const preview = data.preview;
    return (
        <SectionFrame id='retention' eyebrow={props.eyebrow} title='Retention' state={summarise('retention', data)} notice={section.notice}
            onSave={save} saving={section.busy}
            next={props.next} onGo={props.onGo}
        >
            <FieldForm fields={[
                { key: 'enabled', label: 'Delete media files after they are watched', type: 'bool',
                    help: 'The entry, its artwork and its history stay; only the media file goes. In a library that shows missing episodes, a reclaimed episode stays in Jellyfin as a placeholder with its watched mark.' },
                { key: 'reclaimAfterDays', label: 'Days to keep a file after it is finished', type: 'int' },
                { key: 'watchedUserMode', label: 'Start the window when', type: 'select', options: [
                    { value: 'allUsers', label: 'All users with library access have watched it' },
                    { value: 'selectedUser', label: 'A selected user has watched it' },
                    { value: 'anyUser', label: 'Any user with library access has watched it' }
                ] },
                ...(draft.watchedUserMode === 'selectedUser' ? [{ key: 'selectedUserId', label: 'Selected user', type: 'select' as const, required: true, options: users,
                    help: 'If this account is removed, retention is blocked rather than falling back to another user.' }] : []),
                { key: 'exemptFavourites', label: 'Never reclaim favourites', type: 'bool' }
            ]} draft={draft} onChange={set} />
            <p className='jfmod-lead fieldDescription'>
                {preview ? `${preview.inspected} file(s) inspected · ${preview.due} due now · ${preview.scheduled} scheduled · ${preview.blocked} protected · ${preview.waiting} waiting` :
                    'The preview is unavailable.'}
                {preview?.placeholders ? ` · ${preview.placeholders} will leave a placeholder` : ''}
                {data.lastRun ? ` · last run ${when(data.lastRun.completedAt ?? data.lastRun.startedAt)} (${data.lastRun.status})` : ' · no run recorded yet'}
            </p>
            <div className='jfmod-group'>
                <h3 className='jfmod-grouptitle'>Seed Protection</h3>
                <FieldForm fields={[
                    { key: 'source', label: 'Read seeding state from', type: 'select', options: [
                        { value: 'acquisitionClient', label: 'The download client' }, { value: 'separate', label: 'A separate Transmission' }
                    ] },
                    ...(seedDraft.source === 'separate' ? [
                        { key: 'rpcUrl', label: 'Transmission RPC address', type: 'text' as const, required: true },
                        { key: 'username', label: 'Username', type: 'text' as const }
                    ] : [])
                ]} draft={seedDraft} onChange={setSeed} />
                {seedDraft.source === 'separate' && (
                    <SecretField key={data.seed.revision} id='jfmodSeedPassword' label='Password' configured={!!data.seed.passwordConfigured} change={password} onChange={setPassword} />
                )}
                <div className='jfmod-testline'>
                    <Button variant='contained' color='inherit' disabled={section.busy} onClick={testSeed} data-test='seed'>Test</Button>
                    <span className='fieldDescription'>
                        {data.seed.effectiveRpcUrl ? `Reads ${data.seed.effectiveRpcUrl}.` : 'Nothing to read yet, so reclamation is blocked.'}
                    </span>
                </div>
            </div>
        </SectionFrame>
    );
};

// ---- Interface ----

export const InterfaceSection: FC<SectionProps> = props => {
    const { api, data, reload } = props;
    const face = data.iface;
    const section = useSectionState(reload);
    const { run } = section;
    // While it saves, the switch stays focusable (aria-disabled, so a TV keeps its focus on it) and ignores presses.
    const toggleTakeover = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        if (section.busy) return;
        void run(() => request(api, 'PATCH', 'Settings/Interface', { takeoverEnabled: event.target.checked }), 'Saved.');
    }, [run, api, section.busy]);
    const restoreStock = useCallback(() => run(() => request(api, 'POST', 'Settings/Interface/RestoreStock'), 'Stock Jellyfin is back at /web until the next restart.'),
        [run, api]);
    if (!face) {
        return <SectionFrame id='interface' eyebrow={props.eyebrow} title='Interface' notice={{ kind: 'warn', text: 'Unavailable in this plugin build.' }} onGo={props.onGo}><span /></SectionFrame>;
    }
    const appliedBy = face.PatchedBy === 'setting' ? 'an administrator' : 'the plugin itself';
    return (
        <SectionFrame id='interface' eyebrow={props.eyebrow} title='Interface' state={summarise('interface', data)} notice={section.notice} next={props.next} onGo={props.onGo}>
            <FormControlLabel
                control={<Switch checked={!!face.TakeoverEnabled} onChange={toggleTakeover}
                    slotProps={{ input: { 'aria-disabled': section.busy || undefined } }} />}
                label='Serve this interface at /web'
            />
            <dl className='jfmod-kv'>
                <dt>State</dt><dd>{face.Status}{face.Blocker ? ` · ${face.Blocker}` : ''}</dd>
                <dt>Applied</dt><dd>{face.PatchedAt ? `${when(face.PatchedAt)} by ${appliedBy}` : 'not applied'}</dd>
                <dt>Web root</dt><dd>{face.WebRoot}</dd>
                <dt>Bundle</dt><dd className='jfmod-mono'>{face.BundleId ?? 'none'}</dd>
                <dt>Always reachable at</dt><dd className='jfmod-mono'>{face.ModAddress}</dd>
            </dl>
            <div className='jfmod-inlineactions'>
                <Button variant='contained' color='error' disabled={section.busy} onClick={restoreStock}>
                    Restore Stock Now
                </Button>
            </div>
            {face.Recovery && <p className='fieldDescription jfmod-lead'>{face.Recovery}</p>}
        </SectionFrame>
    );
};

// ---- Diagnostics ----

const pad = (value: number) => (value < 10 ? '0' : '') + value;
const newestFirst = (items: any[], field: string) => items.slice().sort((a, b) => String(b[field] ?? '').localeCompare(String(a[field] ?? '')));

export const DiagnosticsSection: FC<SectionProps> = props => {
    const { data } = props;
    const latest = data.reconciliation;
    const conflicts = useMemo(() => newestFirst(data.conflicts, 'detectedAt'), [data.conflicts]);
    const orphans = useMemo(() => newestFirst(data.orphans, 'addedAt'), [data.orphans]);
    return (
        <SectionFrame id='diagnostics' eyebrow={props.eyebrow} title='Diagnostics' state={summarise('diagnostics', data)} notice={null} onGo={props.onGo}>
            <dl className='jfmod-kv'>
                <dt>Last reconciliation</dt><dd>{latest ? `${when(latest.completedAt ?? latest.startedAt)} · ${latest.status}` : 'none yet'}</dd>
                <dt>Conflicts</dt><dd>{data.conflicts.length}</dd>
                <dt>Orphaned entries</dt><dd>{data.orphans.length}</dd>
            </dl>
            <div className='jfmod-group'>
                <h3 className='jfmod-grouptitle'>Episode Conflicts</h3>
                <ScrollList label='Episode conflicts, newest first'>
                    {conflicts.length === 0 && <div className='jfmod-empty'>No episode conflicts.</div>}
                    {conflicts.map((conflict: any) => (
                        <div className='jfmod-brow' key={conflict.id}>
                            <div className='jfmod-brow-main'>
                                <strong>{conflict.title}</strong>
                                <span className='jfmod-sub'>
                                    tracked S{pad(conflict.trackedSeasonNumber)}E{pad(conflict.trackedEpisodeNumber)}, Jellyfin now reports S{pad(conflict.observedSeasonNumber)}E{pad(conflict.observedEpisodeNumber)}
                                </span>
                                <WhenLine words='Detected' at={conflict.detectedAt} />
                            </div>
                        </div>
                    ))}
                </ScrollList>
            </div>
            <div className='jfmod-group'>
                <h3 className='jfmod-grouptitle'>Entries in Removed Libraries</h3>
                <ScrollList label='Entries in removed libraries, newest first'>
                    {orphans.length === 0 && <div className='jfmod-empty'>No entries are waiting for a removed library.</div>}
                    {orphans.map((orphan: any) => (
                        <div className='jfmod-brow' key={orphan.id}>
                            <div className='jfmod-brow-main'>
                                <strong>{orphan.title}</strong>
                                <span className='jfmod-sub'>({orphan.mediaType}) — its library was removed; hidden from users until its media reappears</span>
                                <WhenLine words='Added' at={orphan.addedAt} />
                            </div>
                        </div>
                    ))}
                </ScrollList>
            </div>
            <p className='fieldDescription jfmod-lead'>Conflicts and orphans are resolved on the JellyfinMod page in the Jellyfin Dashboard.</p>
        </SectionFrame>
    );
};

/* eslint-enable @typescript-eslint/no-explicit-any */

// ---- Ratings (Phase 9) ----

/** The cached reads a ratings save changes: the defaults, each title's ratings and the grids that show a card rating. */
const isRatingsQuery = (key: readonly unknown[], basePath: string) => key[0] === 'JellyfinMod' && key[1] === basePath
    && key.some(part => ['RatingsDefaults', 'Ratings', 'Browse', 'SearchBrowse', 'HomeRecent', 'NativeDetail'].includes(part as string));

const RATING_SOURCE_NAMES: Record<string, string> = Object.fromEntries([
    ['imdb', 'IMDb'], ['tomatoes_critic', 'Rotten Tomatoes critics'], ['tomatoes_audience', 'Rotten Tomatoes audience'], ['tmdb', 'TMDB'],
    ['trakt', 'Trakt'], ['metacritic', 'Metacritic critics'], ['metacritic_user', 'Metacritic users'], ['letterboxd', 'Letterboxd'],
    ['rogerebert', 'Roger Ebert']
]);

const STOP_SENTENCES: Record<string, string> = Object.fromEntries([
    ['budget_spent', 'the daily budget was spent'], ['breaker_open', 'the provider was paused'], ['ratings_disabled', 'ratings were off'],
    ['not_configured', 'no key was saved'], ['unauthorized', 'MDBList refused the key']
]);

interface RatingsRun {
    startedAt: string;
    fetched: number;
    failed: number;
    stopReason?: string | null;
}

/** The provider's state in words: stopped, paused and why, or ready. */
const providerState = (status: { blocker?: string | null; breaker: { open: boolean; until?: string | null; reason?: string | null } }) => {
    if (status.blocker === 'unauthorized') return 'Stopped: MDBList refused the key';
    if (!status.breaker.open) return 'Ready';
    const why = status.breaker.reason === 'rate_limited' ? 'daily limit reached' : 'repeated errors';
    return `Paused until ${when(status.breaker.until)} (${why})`;
};

/** The last run in one line. */
const lastRunText = (run: RatingsRun | null | undefined) => {
    if (!run) return 'No run yet';
    const stop = run.stopReason ? ` · stopped because ${STOP_SENTENCES[run.stopReason] ?? run.stopReason}` : '';
    return `${when(run.startedAt)} · ${run.fetched} fetched · ${run.failed} failed${stop}`;
};

const ratingsRead = (data: SettingsData) => data.ratings !== undefined && data.ratings !== null;

/** What started a pass in progress (user decision 8). */
const PASS_KINDS: Record<string, string> = { daily: 'the daily run', arrivals: 'new titles', setup: 'setup', startup: 'the first start' };

/**
 * The fetcher's state; while a pass is in progress it says so, with how many titles it has left, and reads the status again
 * every few seconds until the pass ends (user decision 8: titles are fetched on arrival and in full at setup).
 */
interface RatingsStatusView {
    blocker?: string | null;
    breaker: { open: boolean; until?: string | null; reason?: string | null };
    budget: { used: number; limit: number };
    entries: number;
    entriesWithoutRatings: number;
    lastRun?: RatingsRun | null;
    running?: { kind: string; startedAt: string; remaining: number } | null;
}

/** How often the open Ratings section reads the status again: often while a pass runs, slowly while idle. */
const STATUS_BUSY_MS = 3000;
const STATUS_IDLE_MS = 15000;

/**
 * Keeps `Ratings/Status` current while the Ratings section is open (review 2026-10-08, P3 6-7): a bounded read every few
 * seconds while a pass runs and every 15 s while idle (none while the page is hidden), written into the settings area's own
 * cached data, so the section's header and the rail's summary read the same live status as the panel — without reading the
 * whole settings area again, and without touching any form the administrator is editing.
 */
const useLiveRatingsStatus = (api: Api, status: RatingsStatusView | undefined, enabled: boolean) => {
    const running = !!status?.running;
    useEffect(() => {
        if (!enabled) return;
        let alive = true;
        let timer: number | undefined;
        const tick = async () => {
            if (!document.hidden) {
                const next = await request<RatingsStatusView>(api, 'GET', 'Ratings/Status').catch(() => undefined);
                if (!alive) return;
                if (next) {
                    queryClient.setQueryData<SettingsData>(['JellyfinMod', api.basePath, 'SettingsArea'],
                        current => current ? { ...current, ratingsStatus: next } : current);
                }
            }
            if (alive) timer = window.setTimeout(tick, running ? STATUS_BUSY_MS : STATUS_IDLE_MS);
        };
        // A save or a Test may just have started a pass in the background: the first look comes soon.
        timer = window.setTimeout(tick, running ? STATUS_BUSY_MS : 2500);
        return () => {
            alive = false;
            window.clearTimeout(timer);
        };
    }, [api, running, enabled]);
};

const RatingsFetching: FC<{ status: RatingsStatusView | undefined }> = ({ status }) => {
    if (!status) return null;
    return <div className='jfmod-group'>
        <h3 className='jfmod-grouptitle'>Fetching</h3>
        <dl className='jfmod-kv'>
            {status.running && <><dt>Now</dt><dd role='status' data-jfmod-ratings-running={status.running.kind}>
                Fetching, {status.running.remaining} title(s) left · started by {PASS_KINDS[status.running.kind] ?? status.running.kind} {when(status.running.startedAt)}
            </dd></>}
            <dt>Today</dt><dd>{status.budget.used} of {status.budget.limit} calls</dd>
            <dt>Titles without ratings</dt><dd>{status.entriesWithoutRatings} of {status.entries}</dd>
            <dt>Provider</dt><dd>{providerState(status)}</dd>
            <dt>Last run</dt><dd>{lastRunText(status.lastRun)}</dd>
        </dl>
    </div>;
};

/**
 * One default source: ticked or not, and its place in the order every user starts from (user decisions 6 and 9). Move Up and
 * Move Down are round icons (UX §12.1); a move with nowhere to go is refused, not disabled, and the moved source's button
 * keeps the focus, as a quality's does, so a remote can press it again.
 */
const SourceRow: FC<{ source: string; index: number; count: number; on: boolean; onToggle: (source: string) => void; onMove: (source: string, by: number) => void }> = ({
    source, index, count, on, onToggle, onMove
}) => {
    const name = RATING_SOURCE_NAMES[source] ?? source;
    const toggle = useCallback(() => onToggle(source), [onToggle, source]);
    const move = useCallback((by: number, action: string) => {
        onMove(source, by);
        window.setTimeout(() => {
            const button = [...document.querySelectorAll<HTMLElement>(`[data-jfmod-default-source] [data-row-action="${action}"]`)]
                .find(element => element.dataset.source === source);
            if (button && document.activeElement !== button) button.focus();
        }, 0);
    }, [onMove, source]);
    const up = useCallback(() => move(-1, 'up'), [move]);
    const down = useCallback(() => move(1, 'down'), [move]);
    return (
        <div className='jfmod-qrow' data-jfmod-default-source={source}>
            <FormControlLabel control={<Checkbox checked={on} onChange={toggle} />} label={name} />
            {on && <span className='jfmod-rowactions'>
                <IconAction label={`Move ${name} Up`} refused={index === 0} onClick={up} data={{ 'row-action': 'up', source }}><ArrowUpwardIcon /></IconAction>
                <IconAction label={`Move ${name} Down`} refused={index === count - 1} onClick={down} data={{ 'row-action': 'down', source }}>
                    <ArrowDownwardIcon />
                </IconAction>
            </span>}
        </div>
    );
};

export const RatingsSection: FC<SectionProps> = props => {
    const { api, data, reload } = props;
    const ratings = data.ratings;
    const status = data.ratingsStatus;
    const section = useSectionState(reload, RATINGS_READS, ratingsRead);
    useLiveRatingsStatus(api, status, !!ratings);
    const [draft, set, , ratingsSaved] = useDraft(ratings, {}, section);
    const keySecret = useSecretChange('ratings', ratings?.revision, section.resets);
    const apiKey = keySecret.change;
    const { run, test } = section;
    const chosen: string[] = useMemo(() => Array.isArray(draft.defaultSources) ? draft.defaultSources as string[] : ratings?.defaultSources ?? [],
        [draft.defaultSources, ratings?.defaultSources]);
    const available: string[] = ratings?.availableSources ?? [];
    const toggleSource = useCallback((source: string) => {
        set('defaultSources', chosen.includes(source) ? chosen.filter(value => value !== source) : [...chosen, source]);
    }, [chosen, set]);
    const moveSource = useCallback((source: string, by: number) => {
        const index = chosen.indexOf(source);
        const target = index + by;
        if (index < 0 || target < 0 || target >= chosen.length) return;
        const next = [...chosen];
        [next[index], next[target]] = [next[target], next[index]];
        set('defaultSources', next);
    }, [chosen, set]);
    const save = useCallback(() => run(async () => {
        const revision = keySecret.revisionFor((draft.revision as number | undefined) ?? ratings.revision);
        const origin = keySecret.origin(revision);
        const saved = await request<{ revision?: number }>(api, 'PATCH', 'Settings/Ratings', {
            ...pick(draft, ['enabled', 'refreshDays', 'dailyBudget']), defaultSources: chosen, apiKey, revision
        });
        keySecret.saved(apiKey, { id: 'ratings', revision: saved?.revision }, origin);
        ratingsSaved(draft, sameRevision(saved), saved);
        // Detail pages and grids read the defaults (order, on/off) and the ratings themselves from the shared cache; a save
        // marks them stale so this browser shows the change at once and others within RATINGS_STALE_MS (web review 2026-10-07, P2 1).
        queryClient.invalidateQueries({ predicate: query => isRatingsQuery(query.queryKey, api.basePath) }).catch(() => undefined);
    }, 'Saved.'), [run, api, draft, chosen, apiKey, keySecret, ratings, ratingsSaved]);
    // Test sits in the key's box as an icon, its words and its result under the box, as the TMDB token's does (UX §12.1). A
    // result belongs to the revision it tested: a saved replacement or clear, or a key being typed, hides it.
    const [testResult, setTestResult] = useState<{ revision: unknown; notice: NoticeState } | null>(null);
    const testedRevision = ratings?.revision;
    const sayTest = useCallback((notice: NoticeState | null) => setTestResult(notice && { revision: testedRevision, notice }), [testedRevision]);
    // The icon shows the test's state as the TMDB token's does: testing, the shown result, else the saved key's last pass.
    const [testing, setTesting] = useState(false);
    const testRun = useRef(0);
    const testKey = useCallback(async () => {
        testRun.current += 1;
        const mine = testRun.current;
        setTesting(true);
        try {
            await test('Settings/Ratings/Test', api, sayTest);
        } finally {
            if (mine === testRun.current) setTesting(false);
        }
    }, [test, api, sayTest]);
    const shownResult = testResult && testResult.revision === ratings?.revision && apiKey.action === 'unchanged' && ratings?.apiKeyConfigured ?
        testResult.notice : null;
    const testState: TestState = useMemo(() => {
        if (testing) return { kind: 'testing' };
        if (shownResult) return { kind: shownResult.kind === 'ok' ? 'ok' : 'fail', reason: shownResult.kind === 'ok' ? null : shownResult.text };
        return ratings?.verified && ratings.apiKeyConfigured ? { kind: 'ok', checkedAt: ratings.verifiedAt } : { kind: 'idle' };
    }, [testing, shownResult, ratings?.verified, ratings?.apiKeyConfigured, ratings?.verifiedAt]);
    const keyTest = useMemo(() => ({
        id: 'ratings', label: 'Test Key', run: testKey, disabled: section.busy, result: shownResult, state: testState,
        help: 'Makes one real MDBList call for a well-known title. Save a new key first. A key that passes starts fetching every title at once, within the daily budget.'
    }), [testKey, section.busy, shownResult, testState]);
    if (!ratings) {
        return <SectionFrame id='ratings' eyebrow={props.eyebrow} title='Ratings' notice={{ kind: 'warn', text: 'Unavailable in this plugin build.' }} onGo={props.onGo}><span /></SectionFrame>;
    }
    const rows = [...chosen, ...available.filter(source => !chosen.includes(source))];
    return (
        <SectionFrame id='ratings' eyebrow={props.eyebrow} title='Ratings' state={summarise('ratings', data)} notice={section.notice}
            onSave={save} saving={section.busy} saveMeta={`Revision ${ratings.revision}.`} next={props.next} onGo={props.onGo}
        >
            <FieldForm fields={[
                { key: 'enabled', label: 'Fetch and show title ratings', type: 'bool', help: 'Display only: ratings never steer searching, grabbing or retention.' },
                { key: 'refreshDays', label: 'Fetch a title again after (days)', type: 'int' },
                { key: 'dailyBudget', label: 'MDBList calls per day', type: 'int', help: 'Stay below your MDBList tier (the free tier allows 1,000 a day); manual refreshes and Test count too.' }
            ]} draft={draft} onChange={set} />
            <div className='jfmod-group'>
                <SecretField key={ratings.revision} id='jfmodMdbListKey' label='MDBList API Key' configured={!!ratings.apiKeyConfigured} change={apiKey} onChange={keySecret.set}
                    test={keyTest} />
                {ratings.providerOverride && <Notice notice={{ kind: 'warn', text: 'This server fetches ratings from a test address set in its configuration file, not from MDBList.' }} />}
                <div className='fieldDescription jfmod-lead'>
                    One MDBList key brings IMDb, Rotten Tomatoes critics and audience, TMDB, Trakt, Metacritic, Letterboxd and Roger Ebert. TMDB&apos;s own score comes
                    from the title&apos;s TMDB metadata, and on-disk titles fall back to what this server&apos;s own metadata stored. MDBList is a cache of those sites,
                    so its numbers can lag or differ from what each site shows today.
                </div>
            </div>
            <div className='jfmod-group'>
                <h3 className='jfmod-grouptitle'>Ratings Shown</h3>
                <div className='fieldDescription'>
                    Ticked ratings show for every user who has not chosen their own in Ratings Display. IMDb and Rotten Tomatoes show
                    beside the title, and Trakt when the line has room; every ticked rating shows with its votes, in this order, in the
                    popup that opens on hover, a tap or OK. Fetching is the same either way.
                </div>
                {rows.map(source => <SourceRow key={source} source={source} index={chosen.indexOf(source)} count={chosen.length}
                    on={chosen.includes(source)} onToggle={toggleSource} onMove={moveSource} />)}
            </div>
            <RatingsFetching status={status} />
        </SectionFrame>
    );
};
