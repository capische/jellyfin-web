import type { Api } from '@jellyfin/sdk/lib/api';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import BuildIcon from '@mui/icons-material/Build';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import NetworkCheckIcon from '@mui/icons-material/NetworkCheck';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import React, { type Dispatch, type FC, type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
    blockerSentence, BLOCKER_SECTIONS, CONFLICT_MESSAGE, type ConnectionTest, type Overview, partialSave, PAUSE_SENTENCES, pathSentence, problemText, request,
    type SecretChange, when
} from './settingsApi';
import {
    type Draft, FieldForm, type FieldSpec, FOCUSABLE_SELECT, IconAction, Notice, type NoticeState, pick, SecretField, SectionFrame, type StateKind, StatePill,
    useConfirm
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
    /** Ratings settings and the fetcher's status; undefined when the plugin build has no ratings (Phase 9). */
    ratings?: any;
    ratingsStatus?: any;
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
    if (!discovery.tokenConfigured) return { kind: 'warn', words: discovery.apiKeyConfigured ? 'Only the v3 API key is configured' : 'No TMDB token' };
    return discovery.verified ? { kind: 'ok', words: `Token tested ${when(discovery.verifiedAt)}` } : { kind: 'warn', words: 'Token not tested since it changed' };
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
    return ratings.verified ? { kind: 'ok', words: `Key tested ${when(ratings.verifiedAt)}` } : { kind: 'warn', words: 'Key not tested since it changed' };
};

export const summarise = (id: string, data: SettingsData): Summary => {
    switch (id) {
        case 'overview': return summariseOverview(data);
        case 'discovery': return summariseDiscovery(data);
        case 'client': return summariseClient(data);
        case 'indexers': return summariseIndexers(data);
        case 'profiles': return summariseProfiles(data);
        case 'grabbing': return summariseGrabbing(data);
        case 'import': return summariseImport(data);
        case 'retention': return summariseRetention(data);
        case 'automation': return summariseAutomation(data);
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
    const save = useCallback(() => run(async () => {
        let savedRevision: number | undefined;
        const revision = tokenSecret.revisionFor(discovery.revision);
        const origin = tokenSecret.origin(revision);
        if (token.action !== 'unchanged') {
            savedRevision = (await request<any>(api, 'PATCH', 'Settings/Discovery', { token, revision }))?.revision;
        }
        tokenSecret.saved(token, { id: 'discovery', revision: savedRevision }, origin);
    }, 'Saved.'), [run, api, token, tokenSecret, discovery.revision]);
    // Test sits in the token's box as an icon, its words and its result under the box (user, 2026-10-07). A result belongs
    // to the revision it tested: a saved replacement or clear, or a change being typed, hides it (Codex review 1, P2 2).
    const [testResult, setTestResult] = useState<{ revision: unknown; notice: NoticeState } | null>(null);
    const testedRevision = discovery.revision;
    const sayTest = useCallback((notice: NoticeState | null) => setTestResult(notice && { revision: testedRevision, notice }), [testedRevision]);
    const testToken = useCallback(() => test('Settings/Discovery/Test', api, sayTest), [test, api, sayTest]);
    const shownResult = testResult && testResult.revision === discovery.revision && token.action === 'unchanged' && discovery.tokenConfigured ?
        testResult.notice : null;
    const tokenTest = useMemo(() => ({
        id: 'discovery', label: 'Test Token', run: testToken, disabled: section.busy, result: shownResult,
        help: 'Asks TMDB whether it accepts the saved token. Save a new token first.'
    }), [testToken, section.busy, shownResult]);
    return (
        <SectionFrame id='discovery' eyebrow={props.eyebrow} title='Discovery' state={summarise('discovery', data)} notice={section.notice}
            onSave={save} saving={section.busy} saveMeta={`Revision ${discovery.revision ?? '—'}.`} next={props.next} onGo={props.onGo}
        >
            <div className='jfmod-group'>
                <SecretField key={discovery.revision} id='jfmodTmdbToken' label='TMDB API Read Access Token' configured={!!discovery.tokenConfigured} change={token} onChange={setToken}
                    test={tokenTest} />
                <div className='fieldDescription jfmod-lead'>
                    Used for JellyfinMod discovery only. Jellyfin&apos;s own TMDb metadata plugin keeps its separate key, so a discovery result and the item
                    Jellyfin later creates can disagree about title, poster and language.
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
                onChange={editClient} />
            <span className='jfmod-maparrow' aria-hidden='true'>→</span>
            <TextField size='small' label='Local path' value={mapping.localPathPrefix}
                onChange={editLocal} />
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
    const addMapping = useCallback(() => setMappings(rows => [...rows, { clientPathPrefix: '', localPathPrefix: '' }]), [setMappings]);
    const editProbePath = useCallback((event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setProbePath(event.target.value), []);
    const fields: FieldSpec[] = [
        { key: 'name', label: 'Name', type: 'text' },
        { key: 'baseUrl', label: 'Transmission RPC address', type: 'text', help: 'For example http://host:9091/transmission/rpc, without credentials.' },
        { key: 'username', label: 'Username', type: 'text' },
        { key: 'label', label: 'Label added to every grab', type: 'text' },
        { key: 'downloadDirectory', label: 'Download folder as Transmission sees it', type: 'text' },
        { key: 'localDirectory', label: 'The same folder as this server sees it', type: 'text', help: 'Must be on the same filesystem as the libraries, so imports can hardlink.' },
        { key: 'enabled', label: 'Send grabs to this client', type: 'bool' }
    ];
    return (
        <SectionFrame id='client' eyebrow={props.eyebrow} title='Download Client' state={summarise('client', data)} notice={section.notice}
            onSave={save} saving={section.busy} saveMeta={client ? `Revision ${client.revision}.` : 'Not saved yet.'} next={props.next} onGo={props.onGo}
            actions={client && <Button variant='contained' color='inherit' disabled={section.busy} onClick={testClient} data-test='client'>Test</Button>}
        >
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
        { key: 'name', label: 'Name', type: 'text' },
        { key: 'baseUrl', label: 'Torznab address', type: 'text', help: 'The feed URL without the API key.' },
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

const ProwlarrCard: FC<SectionProps> = ({ api, data, reload }) => {
    const source = data.prowlarr?.[0];
    const section = useSectionState(reload, PROWLARR_READS);
    const [draft, set, , sourceSaved] = useDraft(source, { name: 'Prowlarr', baseUrl: '', enabled: true, syncIntervalMinutes: 360 }, section);
    const keySecret = useSecretChange(source?.id, source?.revision, section.resets);
    const key = keySecret.change;
    const setKey = keySecret.set;
    const [confirmDialog, ask] = useConfirm();
    const { run, test, setNotice: setSourceNotice, reloadNow: reloadSource } = section;
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
            const body = { ...pick(draft, ['name', 'baseUrl', 'enabled', 'syncIntervalMinutes']), apiKey: key };
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
                { key: 'name', label: 'Name', type: 'text' },
                { key: 'baseUrl', label: 'Prowlarr address', type: 'text', help: 'For example http://host:9696, without credentials.' },
                { key: 'syncIntervalMinutes', label: 'Sync every (minutes)', type: 'int' },
                { key: 'enabled', label: 'Sync on a schedule', type: 'bool' }
            ]} draft={draft} onChange={set} />
            <SecretField key={source?.revision ?? 'new'} id='jfmodProwlarrKey' label='API key' configured={!!source?.apiKeyConfigured} change={key} onChange={setKey} />
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
    return indexer.verified ? 'ok' : 'warn';
};

const indexerWords = (indexer: any) => {
    if (!indexer.enabled) return 'off';
    return indexer.verified ? 'verified' : 'not verified';
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
    const testIndexer = useCallback(() => test(`Settings/Indexers/${indexer.id}/Test`, api), [test, api, indexer.id]);
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
                <strong>{indexer.name}</strong>
                <span className='jfmod-sub'>
                    {indexer.managedBy === 'prowlarr' ? 'Synced from Prowlarr · ' : ''}priority {indexer.priority}
                    {indexer.lastError ? ` · last error ${indexer.lastError}` : ''}
                    {indexer.breakerOpenUntil ? ` · paused until ${when(indexer.breakerOpenUntil)}` : ''}
                </span>
            </div>
            <StatePill kind={indexerKind(indexer)}>
                {indexerWords(indexer)}
            </StatePill>
            <span className='jfmod-rowactions'>
                <IconAction label={`Test ${indexer.name}`} disabled={busy} onClick={testIndexer} data={{ 'row-action': 'test' }}><NetworkCheckIcon /></IconAction>
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
            actions={<Button variant='contained' color={prowlarrSource ? 'inherit' : 'primary'} onClick={add}>Add Indexer</Button>}
        >
            <div className='jfmod-blist'>
                {data.indexers.length === 0 && <div className='jfmod-empty'>No indexer yet.</div>}
                {data.indexers.map(indexer => (
                    <IndexerRow key={indexer.id} api={api} indexer={indexer} busy={section.busy} test={section.test} run={section.run} ask={ask}
                        onEdit={setEditing} />
                ))}
            </div>
            <ProwlarrCard {...props} />
            {editing !== undefined && <IndexerDialog api={api} indexer={editing} onClose={closeDialog} />}
            {confirmDialog}
        </SectionFrame>
    );
};

// ---- Quality profiles, edited in a dialog ----

const PROFILE_KEYS = ['name', 'minimumBytesPerHour', 'maximumBytesPerHour', 'cutoff', 'upgradeAllowed', 'upgradeMode', 'minimumAutoScore', 'minimumSeeders'];

/**
 * One allowed quality in a profile's ranked list, with Move Up, Move Down and Remove as icons (user, 2026-10-08). A move
 * that has nowhere to go is refused, not disabled, and the moved quality's button keeps the focus, so a remote can press it
 * again: the row is re-rendered in its new place and the browser would otherwise drop the focus with the moved element.
 */
const QualityRow: FC<{ id: string; index: number; chosen: string[]; set: (key: string, value: unknown) => void; toggle: (id: string) => void }> = ({
    id, index, chosen, set, toggle
}) => {
    const move = useCallback((offset: number, action: string) => {
        const target = index + offset;
        if (target < 0 || target >= chosen.length) return;
        const next = chosen.slice();
        next.splice(index, 1);
        next.splice(target, 0, id);
        set('qualities', next);
        window.setTimeout(() => {
            const button = [...document.querySelectorAll<HTMLElement>(`.jfmod-qrow [data-row-action="${action}"]`)].find(el => el.dataset.quality === id);
            if (button && document.activeElement !== button) button.focus();
        }, 0);
    }, [set, chosen, index, id]);
    const moveUp = useCallback(() => move(-1, 'up'), [move]);
    const moveDown = useCallback(() => move(1, 'down'), [move]);
    const remove = useCallback(() => toggle(id), [toggle, id]);
    return (
        <li className='jfmod-qrow'>
            <span className='jfmod-qrank'>{index + 1}</span><span className='jfmod-qname'>{id}</span>
            <span className='jfmod-rowactions'>
                <IconAction label={`Move ${id} Up`} refused={index === 0} onClick={moveUp} data={{ 'row-action': 'up', quality: id }}><ArrowUpwardIcon /></IconAction>
                <IconAction label={`Move ${id} Down`} refused={index === chosen.length - 1} onClick={moveDown} data={{ 'row-action': 'down', quality: id }}>
                    <ArrowDownwardIcon />
                </IconAction>
                <IconAction label={`Remove ${id}`} red onClick={remove} data={{ 'row-action': 'remove', quality: id }}><DeleteIcon /></IconAction>
            </span>
        </li>
    );
};

const ProfileDialog: FC<{ api: Api; profile: any | null; qualities: { id: string }[]; onClose: (saved: boolean, close?: boolean) => void }> = ({ api, profile: initial, qualities, onClose }) => {
    const [profile, setProfile] = useState(initial);
    // Whether this editor is still open: a save that completes after it was dismissed only refreshes the list, and never
    // closes an editor opened since, with that editor's typing (Pi review 5, P2 2).
    const open = useRef(true);
    useEffect(() => {
        open.current = true;
        return () => {
            open.current = false;
        };
    }, []);
    const [draft, set, replace] = useDraft(profile, { qualities: [], upgradeMode: 'replace', upgradeAllowed: false });
    const [notice, setNotice] = useState<NoticeState | null>(null);
    // What is on screen now, to tell after a save whether anything was edited while it was under way.
    const shown = useRef(draft);
    shown.current = draft;
    const reloadRecord = useCallback(() => {
        request<any[]>(api, 'GET', 'Settings/QualityProfiles').then(list => {
            const fresh = list.find(item => item.id === profile?.id);
            if (!fresh) return;
            setProfile(fresh);
            replace(fresh);
            setNotice(null);
        }).catch(error => setNotice({ kind: 'err', text: problemText(error) }));
    }, [api, profile, replace]);
    const chosen = useMemo(() => (draft.qualities as string[] | undefined) ?? [], [draft.qualities]);
    const toggle = useCallback((id: string) => set('qualities', chosen.includes(id) ? chosen.filter(value => value !== id) : [...chosen, id]), [set, chosen]);
    // One save at a time: a second press while one is under way does nothing (final web review).
    const saving = useRef(false);
    const [busy, setBusy] = useState(false);
    const save = useCallback(async () => {
        if (saving.current) return;
        saving.current = true;
        setBusy(true);
        try {
            const body = { ...pick(draft, PROFILE_KEYS), qualities: chosen };
            const saved = profile ?
                await request<any>(api, 'PATCH', `Settings/QualityProfiles/${profile.id}`, { ...body, revision: draft.revision ?? profile.revision }) :
                await request<any>(api, 'POST', 'Settings/QualityProfiles', body);
            if (!open.current) {
                onClose(true, false);
                return;
            }
            // Edited while it was saving: the editor stays open on the saved record with those edits (final web review 2, P2 7).
            if (shown.current !== draft) {
                setProfile(saved);
                set('revision', saved?.revision);
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
    }, [api, profile, draft, chosen, onClose, reloadRecord, set]);
    const cancel = useCallback(() => onClose(false), [onClose]);
    const addQuality = useCallback((event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => toggle(event.target.value), [toggle]);
    return (
        <Dialog open onClose={cancel} fullWidth maxWidth='sm' className='jfmod-settingsDialog'>
            <DialogTitle>{profile ? `Edit ${profile.name}` : 'Add Quality Profile'}</DialogTitle>
            <DialogContent>
                <Notice notice={notice} />
                <FieldForm fields={[{ key: 'name', label: 'Name', type: 'text' }]} draft={draft} onChange={set} />
                <h3 className='jfmod-grouptitle'>Allowed Qualities, Best First</h3>
                <ol className='jfmod-qlist'>
                    {chosen.map((id, index) => (
                        <QualityRow key={id} id={id} index={index} chosen={chosen} set={set} toggle={toggle} />
                    ))}
                </ol>
                <TextField select fullWidth margin='dense' label='Add a quality' value='' onChange={addQuality} slotProps={FOCUSABLE_SELECT}>
                    {qualities.filter(quality => !chosen.includes(quality.id)).map(quality => <MenuItem key={quality.id} value={quality.id}>{quality.id}</MenuItem>)}
                </TextField>
                <FieldForm fields={[
                    { key: 'minimumBytesPerHour', label: 'Minimum bytes per runtime hour', type: 'int', optional: true },
                    { key: 'maximumBytesPerHour', label: 'Maximum bytes per runtime hour', type: 'int', optional: true },
                    { key: 'cutoff', label: 'Upgrade until', type: 'select', options: chosen.map(id => ({ value: id, label: id })), optional: true },
                    { key: 'upgradeAllowed', label: 'Upgrade automatically until the cutoff', type: 'bool' },
                    { key: 'upgradeMode', label: 'An upgrade', type: 'select', options: [{ value: 'replace', label: 'replaces the held copy' }, { value: 'add', label: 'is added as another version' }] },
                    { key: 'minimumAutoScore', label: 'Minimum score for automatic grabs', type: 'int', optional: true },
                    { key: 'minimumSeeders', label: 'Minimum seeders', type: 'int', optional: true }
                ]} draft={draft} onChange={set} />
            </DialogContent>
            <DialogActions>
                <Button variant='contained' color='inherit' onClick={cancel}>Cancel</Button>
                <Button variant='contained' disabled={busy} onClick={save}>Save</Button>
            </DialogActions>
        </Dialog>
    );
};

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
                <strong>{profile.name}</strong>
                <span className='jfmod-sub'>{(profile.qualities as string[]).join(', ')}</span>
            </div>
            {profile.isDefault ? <span className='jfmod-chip jfmod-chip-primary'>Default</span> : <span />}
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
    const { run } = section;
    const makeDefault = useCallback((id: string) => run(() => request(api, 'PATCH', 'Settings/Acquisition', {
        enabled: data.acquisition.enabled, downloadClientId: data.acquisition.downloadClientId ?? null, defaultQualityProfileId: id,
        revision: data.acquisition.revision
    }), 'Default changed.'), [run, api, data.acquisition]);
    const add = useCallback(() => setEditing(null), []);
    const closeDialog = useCallback((saved: boolean, close = true) => {
        if (close) setEditing(undefined);
        if (saved) void reload();
    }, [reload]);
    return (
        <SectionFrame id='profiles' eyebrow={props.eyebrow} title='Quality Profiles' state={summarise('profiles', data)} notice={section.notice}
            next={props.next} onGo={props.onGo}
            actions={<Button variant='contained' onClick={add}>Add Profile</Button>}
        >
            <div className='jfmod-blist'>
                {data.profiles.length === 0 && <div className='jfmod-empty'>No profile yet.</div>}
                {data.profiles.map(profile => (
                    <ProfileRow key={profile.id} api={api} profile={profile} busy={section.busy} canMakeDefault={!!data.acquisition} run={run} ask={ask}
                        onMakeDefault={makeDefault} onEdit={setEditing} />
                ))}
            </div>
            {editing !== undefined && (
                <ProfileDialog api={api} profile={editing} qualities={data.acquisition?.qualities ?? []}
                    onClose={closeDialog} />
            )}
            {confirmDialog}
        </SectionFrame>
    );
};

// ---- Grabbing ----

export const GrabbingSection: FC<SectionProps> = props => {
    const { api, data, reload } = props;
    const acquisition = data.acquisition ?? {};
    const section = useSectionState(reload, ACQUISITION_READS);
    const [draft, set, , acquisitionSaved] = useDraft(data.acquisition, {}, section);
    const { run } = section;
    const save = useCallback(() => run(async () => {
        const saved = await request<any>(api, 'PATCH', 'Settings/Acquisition', {
            enabled: !!draft.enabled, downloadClientId: draft.downloadClientId ?? null, defaultQualityProfileId: draft.defaultQualityProfileId ?? null,
            revision: draft.revision ?? acquisition.revision
        });
        acquisitionSaved(draft, sameRevision(saved), saved);
    }, 'Saved.'), [run, api, draft, acquisition.revision, acquisitionSaved]);
    return (
        <SectionFrame id='grabbing' eyebrow={props.eyebrow} title='Grabbing' state={summarise('grabbing', data)} notice={section.notice}
            onSave={save} saving={section.busy} saveMeta={`Revision ${acquisition.revision ?? '—'}.`} next={props.next} onGo={props.onGo}
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
                { key: 'defaultQualityProfileId', label: 'Default quality profile', type: 'select', options: data.profiles.map(profile => ({ value: profile.id, label: profile.name })) }
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
            onSave={save} saving={section.busy} saveMeta={`Revision ${source.revision}.`} next={props.next} onGo={props.onGo} actions={props.actions}
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
    { key: 'episodeUpgradesEnabled', label: 'Upgrade episodes too', type: 'bool' },
    { key: 'reacquireReclaimed', label: 'Grab reclaimed titles again', type: 'bool' }
];

export const AutomationSection: FC<SectionProps> = props => {
    const { api, data, reload } = props;
    const section = useSectionState(reload);
    const { run } = section;
    const runNow = useCallback(() => run(() => request(api, 'POST', 'Automation/Run'), 'Run started.'), [run, api]);
    const decisions = data.decisions.slice(0, 10);
    return (
        <FlatSection {...props} id='automation' title='Automation' path='Settings/Automation' source={data.automation} fields={AUTOMATION_FIELDS}
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
            onSave={save} saving={section.busy} saveMeta={`Retention revision ${data.retention.revision} · seed protection revision ${data.seed.revision}.`}
            next={props.next} onGo={props.onGo}
        >
            <FieldForm fields={[
                { key: 'enabled', label: 'Delete media files after they are watched', type: 'bool', help: 'The entry, its artwork and its history stay; only the media file goes.' },
                { key: 'reclaimAfterDays', label: 'Days to keep a file after it is finished', type: 'int' },
                { key: 'watchedUserMode', label: 'Start the window when', type: 'select', options: [
                    { value: 'allUsers', label: 'All users with library access have watched it' },
                    { value: 'selectedUser', label: 'A selected user has watched it' },
                    { value: 'anyUser', label: 'Any user with library access has watched it' }
                ] },
                ...(draft.watchedUserMode === 'selectedUser' ? [{ key: 'selectedUserId', label: 'Selected user', type: 'select' as const, options: users,
                    help: 'If this account is removed, retention is blocked rather than falling back to another user.' }] : []),
                { key: 'exemptFavourites', label: 'Never reclaim favourites', type: 'bool' }
            ]} draft={draft} onChange={set} />
            <p className='jfmod-lead fieldDescription'>
                {preview ? `${preview.inspected} file(s) inspected · ${preview.due} due now · ${preview.scheduled} scheduled · ${preview.blocked} protected · ${preview.waiting} waiting` :
                    'The preview is unavailable.'}
                {data.lastRun ? ` · last run ${when(data.lastRun.completedAt ?? data.lastRun.startedAt)} (${data.lastRun.status})` : ' · no run recorded yet'}
            </p>
            <div className='jfmod-group'>
                <h3 className='jfmod-grouptitle'>Seed Protection</h3>
                <FieldForm fields={[
                    { key: 'source', label: 'Read seeding state from', type: 'select', options: [
                        { value: 'acquisitionClient', label: 'The download client' }, { value: 'separate', label: 'A separate Transmission' }
                    ] },
                    ...(seedDraft.source === 'separate' ? [
                        { key: 'rpcUrl', label: 'Transmission RPC address', type: 'text' as const },
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
    const toggleTakeover = useCallback((event: React.ChangeEvent<HTMLInputElement>) =>
        run(() => request(api, 'PATCH', 'Settings/Interface', { takeoverEnabled: event.target.checked }), 'Saved.'), [run, api]);
    const restoreStock = useCallback(() => run(() => request(api, 'POST', 'Settings/Interface/RestoreStock'), 'Stock Jellyfin is back at /web until the next restart.'),
        [run, api]);
    if (!face) {
        return <SectionFrame id='interface' eyebrow={props.eyebrow} title='Interface' notice={{ kind: 'warn', text: 'Unavailable in this plugin build.' }} onGo={props.onGo}><span /></SectionFrame>;
    }
    const appliedBy = face.PatchedBy === 'setting' ? 'an administrator' : 'the plugin itself';
    return (
        <SectionFrame id='interface' eyebrow={props.eyebrow} title='Interface' state={summarise('interface', data)} notice={section.notice} next={props.next} onGo={props.onGo}>
            <FormControlLabel
                control={<Switch checked={!!face.TakeoverEnabled} disabled={section.busy}
                    onChange={toggleTakeover} />}
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

export const DiagnosticsSection: FC<SectionProps> = props => {
    const { data } = props;
    const latest = data.reconciliation;
    return (
        <SectionFrame id='diagnostics' eyebrow={props.eyebrow} title='Diagnostics' state={summarise('diagnostics', data)} notice={null} onGo={props.onGo}>
            <dl className='jfmod-kv'>
                <dt>Last reconciliation</dt><dd>{latest ? `${when(latest.completedAt ?? latest.startedAt)} · ${latest.status}` : 'none yet'}</dd>
                <dt>Conflicts</dt><dd>{data.conflicts.length}</dd>
                <dt>Orphaned entries</dt><dd>{data.orphans.length}</dd>
            </dl>
            <p className='fieldDescription jfmod-lead'>Conflicts and orphans are resolved on the JellyfinMod page in the Jellyfin Dashboard.</p>
        </SectionFrame>
    );
};

/* eslint-enable @typescript-eslint/no-explicit-any */

// ---- Ratings (Phase 9) ----

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

/** One default source: on/off and its place in the order every user starts from (user decision 6). */
const SourceRow: FC<{ source: string; index: number; count: number; on: boolean; onToggle: (source: string) => void; onMove: (source: string, by: number) => void }> = ({
    source, index, count, on, onToggle, onMove
}) => {
    const toggle = useCallback(() => onToggle(source), [onToggle, source]);
    const up = useCallback(() => onMove(source, -1), [onMove, source]);
    const down = useCallback(() => onMove(source, 1), [onMove, source]);
    return (
        <div className='jfmod-qrow' data-jfmod-default-source={source}>
            <FormControlLabel control={<Switch checked={on} onChange={toggle} />} label={RATING_SOURCE_NAMES[source] ?? source} />
            {on && <span className='jfmod-rowactions'>
                <Button size='small' variant='outlined' disabled={index === 0} onClick={up} aria-label={`Move ${RATING_SOURCE_NAMES[source]} up`}>Up</Button>
                <Button size='small' variant='outlined' disabled={index === count - 1} onClick={down} aria-label={`Move ${RATING_SOURCE_NAMES[source]} down`}>Down</Button>
            </span>}
        </div>
    );
};

export const RatingsSection: FC<SectionProps> = props => {
    const { api, data, reload } = props;
    const ratings = data.ratings;
    const status = data.ratingsStatus;
    const section = useSectionState(reload, RATINGS_READS, ratingsRead);
    const [draft, set, , ratingsSaved] = useDraft(ratings, {}, section);
    const keySecret = useSecretChange('ratings', ratings?.revision, section.resets);
    const apiKey = keySecret.change;
    const { run } = section;
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
    }, 'Saved.'), [run, api, draft, chosen, apiKey, keySecret, ratings, ratingsSaved]);
    const testKey = useCallback(() => run(async () => {
        const result = await request<{ ok: boolean; code: string; message: string; sources: string[] }>(api, 'POST', 'Settings/Ratings/Test');
        const sources = result.sources?.length ? ' Sources: ' + result.sources.map(source => RATING_SOURCE_NAMES[source] ?? source).join(', ') + '.' : '';
        return { jfmodNotice: { kind: result.ok ? 'ok' : 'err', text: `${result.message} (${result.code})${sources}` } as NoticeState };
    }), [run, api]);
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
                <SecretField key={ratings.revision} id='jfmodMdbListKey' label='MDBList API key' configured={!!ratings.apiKeyConfigured} change={apiKey} onChange={keySecret.set} />
                <div className='jfmod-testline'>
                    <Button variant='outlined' size='small' disabled={section.busy} onClick={testKey} data-test='ratings'>Test</Button>
                    <span className='fieldDescription'>Makes one real MDBList call for a well-known title. Save a new key first.</span>
                </div>
                {ratings.providerOverride && <Notice notice={{ kind: 'warn', text: 'This server fetches ratings from a test address set in its configuration file, not from MDBList.' }} />}
                <div className='fieldDescription jfmod-lead'>
                    One MDBList key brings IMDb, Rotten Tomatoes critics and audience, TMDB, Trakt, Metacritic, Letterboxd and Roger Ebert. TMDB&apos;s own score comes
                    from the title&apos;s TMDB metadata, and on-disk titles fall back to what this server&apos;s own metadata stored. MDBList is a cache of those sites,
                    so its numbers can lag or differ from what each site shows today.
                </div>
            </div>
            <div className='jfmod-group'>
                <h3 className='jfmod-grouptitle'>Default sources and order</h3>
                <div className='fieldDescription'>What every user starts from; each user can change their own in Ratings display.</div>
                {rows.map(source => <SourceRow key={source} source={source} index={chosen.indexOf(source)} count={chosen.length}
                    on={chosen.includes(source)} onToggle={toggleSource} onMove={moveSource} />)}
            </div>
            {status && <div className='jfmod-group'>
                <h3 className='jfmod-grouptitle'>Fetching</h3>
                <dl className='jfmod-kv'>
                    <dt>Today</dt><dd>{status.budget.used} of {status.budget.limit} calls</dd>
                    <dt>Titles without ratings</dt><dd>{status.entriesWithoutRatings} of {status.entries}</dd>
                    <dt>Provider</dt><dd>{providerState(status)}</dd>
                    <dt>Last run</dt><dd>{lastRunText(status.lastRun)}</dd>
                </dl>
            </div>}
        </SectionFrame>
    );
};
