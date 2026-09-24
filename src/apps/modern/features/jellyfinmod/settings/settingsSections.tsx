import type { Api } from '@jellyfin/sdk/lib/api';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import React, { type FC, useCallback, useEffect, useMemo, useState } from 'react';

import {
    blockerSentence, BLOCKER_SECTIONS, type ConnectionTest, type Overview, PAUSE_SENTENCES, pathSentence, problemText, request,
    type SecretChange, when
} from './settingsApi';
import { type Draft, FieldForm, type FieldSpec, Notice, type NoticeState, pick, SecretField, SectionFrame, type StateKind, StatePill, useConfirm } from './settingsWidgets';

/* eslint-disable @typescript-eslint/no-explicit-any -- the settings DTOs are the plugin's own and are read field by field */

export interface SettingsData {
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

/** Save/test plumbing every section shares: one notice, one busy flag, 409s rendered with a Reload. */
const useSectionState = (reload: () => Promise<unknown>) => {
    const [notice, setNotice] = useState<NoticeState | null>(null);
    const [busy, setBusy] = useState(false);
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
            const reloadNow = () => {
                void reload();
                setNotice(null);
            };
            setNotice({
                kind: 'err', text,
                action: /changed somewhere else/.test(text) ? { label: 'Reload', run: reloadNow } : undefined
            });
        } finally {
            setBusy(false);
        }
    }, [reload]);
    const test = useCallback(async (path: string, api: Api) => {
        setBusy(true);
        try {
            const result = await request<ConnectionTest>(api, 'POST', path);
            const version = result.version ? ` · ${result.version}` : '';
            setNotice({ kind: result.ok ? 'ok' : 'err', text: `${result.message} (${result.code})${version}` });
            await reload();
        } catch (error) {
            setNotice({ kind: 'err', text: problemText(error) });
        } finally {
            setBusy(false);
        }
    }, [reload]);
    return { notice, setNotice, busy, run, test };
};

/** Keeps a local draft of a DTO and resets it whenever the server's copy (by revision) changes. */
const useDraft = (source: any, fallback: Draft = {}) => {
    const [draft, setDraft] = useState<Draft>(source ?? fallback);
    // Keyed on the server's copy only: a fallback literal is a new object on every render and must not reset the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => setDraft(source ?? fallback), [source]);
    const set = useCallback((key: string, value: unknown) => setDraft(current => ({ ...current, [key]: value })), []);
    return [draft, set, setDraft] as const;
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
        default:
            return data.overview?.areas.find(candidate => candidate.id === id)?.ready ? { kind: 'ok', words: 'Ready' } : { kind: 'off', words: '' };
    }
};

const selectedClient = (data: SettingsData) =>
    data.clients.find(client => client.id === data.acquisition?.downloadClientId) ?? data.clients[0];

/** One blocker with its sentence and a Fix that opens the section owning it; `detail` is the Overview's area name. */
const BlockerRow: FC<{ code: string; fallback: string; detail?: string; onGo: (id: string) => void }> = ({ code, fallback, detail, onGo }) => {
    const fix = useCallback(() => onGo(BLOCKER_SECTIONS.get(code) ?? fallback), [code, fallback, onGo]);
    return (
        <div className='jfmod-brow'>
            <div className='jfmod-brow-main'><strong>{blockerSentence(code)}</strong>{detail !== undefined && <span className='jfmod-sub'>{detail}</span>}</div>
            <span />
            <Button size='small' onClick={fix}>Fix</Button>
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
                <h3 className='jfmod-grouptitle'>This installation</h3>
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

export const DiscoverySection: FC<SectionProps> = props => {
    const { api, data, reload } = props;
    const discovery = data.discovery ?? {};
    const [token, setToken] = useState<SecretChange>(UNCHANGED);
    const section = useSectionState(reload);
    const { run, test } = section;
    const save = useCallback(() => run(async () => {
        if (token.action !== 'unchanged') await request(api, 'PATCH', 'Settings/Discovery', { token, revision: discovery.revision });
        setToken(UNCHANGED);
    }, 'Saved.'), [run, api, token, discovery.revision]);
    const testToken = useCallback(() => test('Settings/Discovery/Test', api), [test, api]);
    return (
        <SectionFrame id='discovery' eyebrow={props.eyebrow} title='Discovery' state={summarise('discovery', data)} notice={section.notice}
            onSave={save} saving={section.busy} saveMeta={`Revision ${discovery.revision ?? '—'}.`} next={props.next} onGo={props.onGo}
        >
            <div className='jfmod-group'>
                <SecretField key={discovery.revision} id='jfmodTmdbToken' label='TMDB API Read Access Token' configured={!!discovery.tokenConfigured} change={token} onChange={setToken} />
                <div className='jfmod-testline'>
                    <Button variant='outlined' size='small' disabled={section.busy} onClick={testToken} data-test='discovery'>Test</Button>
                    <span className='fieldDescription'>Asks TMDB whether it accepts the saved token. Save a new token first.</span>
                </div>
                <div className='fieldDescription jfmod-lead'>
                    Used for JellyfinMod discovery only. Jellyfin&apos;s own TMDb metadata plugin keeps its separate key, so a discovery result and the item
                    Jellyfin later creates can disagree about title, poster and language.
                </div>
            </div>
        </SectionFrame>
    );
};

// ---- Download client and its path mappings ----

type PathMapping = { clientPathPrefix: string; localPathPrefix: string; verifiedAt?: string; verificationReason?: string };

/** One editable path mapping; `index` is its identity, as the list is edited in place. */
const MappingRow: FC<{ index: number; mapping: PathMapping; setMappings: React.Dispatch<React.SetStateAction<PathMapping[]>> }> = ({ index, mapping, setMappings }) => {
    const editClient = useCallback((event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setMappings(rows => rows.map((row, at) => (at === index ? { ...row, clientPathPrefix: event.target.value } : row))), [index, setMappings]);
    const editLocal = useCallback((event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setMappings(rows => rows.map((row, at) => (at === index ? { ...row, localPathPrefix: event.target.value } : row))), [index, setMappings]);
    const remove = useCallback(() => setMappings(rows => rows.filter((_, at) => at !== index)), [index, setMappings]);
    return (
        <div className='jfmod-maprow'>
            <TextField size='small' label='Transmission path' value={mapping.clientPathPrefix}
                onChange={editClient} />
            <span className='jfmod-maparrow' aria-hidden='true'>→</span>
            <TextField size='small' label='Local path' value={mapping.localPathPrefix}
                onChange={editLocal} />
            <div className='jfmod-mapfoot'>
                <StatePill kind={mapping.verifiedAt ? 'ok' : 'warn'}>{mapping.verifiedAt ? 'verified' : pathSentence(mapping.verificationReason ?? 'path_unmapped')}</StatePill>
                <Button size='small' onClick={remove}>Remove</Button>
            </div>
        </div>
    );
};

const CLIENT_KEYS = ['name', 'kind', 'baseUrl', 'username', 'enabled', 'label', 'downloadDirectory', 'localDirectory', 'openUrl'];

export const ClientSection: FC<SectionProps> = props => {
    const { api, data, reload } = props;
    const client = selectedClient(data);
    const [draft, set] = useDraft(client, { kind: 'transmission', enabled: true, label: 'jellyfinmod' });
    const [password, setPassword] = useState<SecretChange>(UNCHANGED);
    const [mappings, setMappings] = useState<PathMapping[]>([]);
    const [probePath, setProbePath] = useState('');
    const section = useSectionState(reload);
    const { run, test } = section;
    useEffect(() => setMappings(client?.pathMappings ?? []), [client]);
    // `client` is undefined until one is saved; the handlers that read its id are only reachable once it exists.
    const save = useCallback(() => run(async () => {
        const body = { ...pick(draft, CLIENT_KEYS), password, revision: client?.revision };
        if (client) await request(api, 'PATCH', `Settings/DownloadClients/${client.id}`, body);
        else await request(api, 'POST', 'Settings/DownloadClients', { ...body, revision: undefined });
        setPassword(UNCHANGED);
    }, 'Saved. Test the client before grabbing.'), [run, api, client, draft, password]);
    const saveMappings = useCallback(() => run(() => request(api, 'PUT', `Settings/DownloadClients/${client.id}/PathMappings`, {
        pathMappings: mappings.map(mapping => ({ clientPathPrefix: mapping.clientPathPrefix, localPathPrefix: mapping.localPathPrefix })),
        revision: client.revision
    }), 'Mappings saved and probed.'), [run, api, client, mappings]);
    const probe = useCallback(() => run(async () => {
        const result = await request<any>(api, 'POST', `Settings/DownloadClients/${client.id}/TestImportPath`, { clientPath: probePath });
        return { jfmodNotice: { kind: result.ok ? 'ok' : 'err', text: `${pathSentence(result.code)} (${result.code})` } };
    }), [run, api, client, probePath]);
    const testClient = useCallback(() => test(`Settings/DownloadClients/${client.id}/Test`, api), [test, api, client]);
    const addMapping = useCallback(() => setMappings(rows => [...rows, { clientPathPrefix: '', localPathPrefix: '' }]), []);
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
        <SectionFrame id='client' eyebrow={props.eyebrow} title='Download client' state={summarise('client', data)} notice={section.notice}
            onSave={save} saving={section.busy} saveMeta={client ? `Revision ${client.revision}.` : 'Not saved yet.'} next={props.next} onGo={props.onGo}
            actions={client && <Button variant='outlined' size='small' disabled={section.busy} onClick={testClient} data-test='client'>Test</Button>}
        >
            <FieldForm fields={fields} draft={draft} onChange={set} />
            <SecretField key={client?.revision ?? 'new'} id='jfmodClientPassword' label='Password' configured={!!client?.passwordConfigured} change={password} onChange={setPassword} />
            {client && (
                <div className='jfmod-group'>
                    <h3 className='jfmod-grouptitle'>Path mappings</h3>
                    {mappings.map((mapping, index) => (
                        // eslint-disable-next-line react/no-array-index-key -- an ordered list edited in place; order is the identity
                        <MappingRow key={index} index={index} mapping={mapping} setMappings={setMappings} />
                    ))}
                    <div className='jfmod-inlineactions'>
                        <Button size='small' onClick={addMapping}>Add mapping</Button>
                        <Button size='small' variant='outlined' disabled={section.busy} onClick={saveMappings}>Save mappings</Button>
                    </div>
                    <div className='jfmod-testline'>
                        <TextField size='small' label='A path as Transmission reports it' value={probePath} onChange={editProbePath} />
                        <Button size='small' variant='outlined' disabled={section.busy || !probePath} onClick={probe}>Test import path</Button>
                    </div>
                </div>
            )}
        </SectionFrame>
    );
};

// ---- Indexers, edited in a dialog ----

const INDEXER_KEYS = ['name', 'baseUrl', 'enabled', 'automateTitleMatches', 'categories', 'priority', 'downloadHosts', 'minimumSeedRatio',
    'minimumSeedMinutes', 'minIntervalSeconds', 'dailyQueryBudget'];

const IndexerDialog: FC<{ api: Api; indexer: any | null; onClose: (saved: boolean) => void }> = ({ api, indexer, onClose }) => {
    const [draft, set] = useDraft(indexer, { enabled: true, automateTitleMatches: false, categories: [2000, 5000], priority: 25, downloadHosts: [] });
    const [key, setKey] = useState<SecretChange>(UNCHANGED);
    const [notice, setNotice] = useState<NoticeState | null>(null);
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
    const save = useCallback(async () => {
        try {
            const body = { ...pick(draft, INDEXER_KEYS), categories: (draft.categories as unknown[] ?? []).map(Number), apiKey: key };
            if (indexer) await request(api, 'PATCH', `Settings/Indexers/${indexer.id}`, { ...body, revision: indexer.revision });
            else await request(api, 'POST', 'Settings/Indexers', body);
            onClose(true);
        } catch (error) {
            setNotice({ kind: 'err', text: problemText(error) });
        }
    }, [api, indexer, draft, key, onClose]);
    const cancel = useCallback(() => onClose(false), [onClose]);
    return (
        <Dialog open onClose={cancel} fullWidth maxWidth='sm' className='jfmod-settingsDialog'>
            <DialogTitle>{indexer ? `Edit ${indexer.name}` : 'Add an indexer'}</DialogTitle>
            <DialogContent>
                <Notice notice={notice} />
                <FieldForm fields={fields} draft={draft} onChange={set} />
                <SecretField id='jfmodIndexerKey' label='API key' configured={!!indexer?.apiKeyConfigured} change={key} onChange={setKey} />
            </DialogContent>
            <DialogActions>
                <Button onClick={cancel}>Cancel</Button>
                <Button variant='contained' onClick={save}>Save</Button>
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
    const [draft, set] = useDraft(source, { name: 'Prowlarr', baseUrl: '', enabled: true, syncIntervalMinutes: 360 });
    const [key, setKey] = useState<SecretChange>(UNCHANGED);
    const section = useSectionState(reload);
    const [confirmDialog, ask] = useConfirm();
    const { run, test } = section;
    // `source` is undefined until one is added; the handlers that read its id are only reachable once it exists.
    const save = useCallback(() => run(async () => {
        const body = { ...pick(draft, ['name', 'baseUrl', 'enabled', 'syncIntervalMinutes']), apiKey: key };
        if (source) await request(api, 'PATCH', `Settings/Prowlarr/${source.id}`, { ...body, revision: source.revision });
        else await request(api, 'POST', 'Settings/Prowlarr', body);
        setKey(UNCHANGED);
    }, 'Saved. Sync to import its indexers.'), [run, api, source, draft, key]);
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
                <Button variant='outlined' size='small' disabled={section.busy} onClick={save}>{source ? 'Save' : 'Add Prowlarr'}</Button>
                {source && <Button size='small' disabled={section.busy} onClick={testSource}>Test</Button>}
                {source && <Button size='small' disabled={section.busy} onClick={syncNow} data-prowlarr='sync'>Sync now</Button>}
                {source && (
                    <Button size='small' className='jfmod-danger-text' disabled={section.busy} data-prowlarr='remove' onClick={remove}>Remove</Button>
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
                <Button size='small' disabled={busy} onClick={testIndexer}>Test</Button>
                <Button size='small' onClick={edit}>Edit</Button>
                {indexer.managedBy !== 'prowlarr' && <Button size='small' className='jfmod-danger-text' data-indexer-remove={indexer.id} onClick={remove}>Remove</Button>}
            </span>
        </div>
    );
};

export const IndexersSection: FC<SectionProps> = props => {
    const { api, data, reload } = props;
    const section = useSectionState(reload);
    const [confirmDialog, ask] = useConfirm();
    const [editing, setEditing] = useState<any | null | undefined>(undefined);
    const add = useCallback(() => setEditing(null), []);
    const closeDialog = useCallback((saved: boolean) => {
        setEditing(undefined);
        if (saved) void reload();
    }, [reload]);
    return (
        <SectionFrame id='indexers' eyebrow={props.eyebrow} title='Indexers' state={summarise('indexers', data)} notice={section.notice}
            next={props.next} onGo={props.onGo}
            actions={<Button variant='outlined' size='small' onClick={add}>Add indexer</Button>}
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

/** One allowed quality in a profile's ranked list, with Up and Remove. */
const QualityRow: FC<{ id: string; index: number; chosen: string[]; set: (key: string, value: unknown) => void; toggle: (id: string) => void }> = ({
    id, index, chosen, set, toggle
}) => {
    const moveUp = useCallback(() => set('qualities', chosen.map((value, at) => {
        if (at === index - 1) return id;
        return at === index ? chosen[index - 1] : value;
    })), [set, chosen, index, id]);
    const remove = useCallback(() => toggle(id), [toggle, id]);
    return (
        <li className='jfmod-qrow'>
            <span className='jfmod-qrank'>{index + 1}</span><span className='jfmod-qname'>{id}</span>
            <span className='jfmod-rowactions'>
                <Button size='small' disabled={index === 0} onClick={moveUp}>Up</Button>
                <Button size='small' onClick={remove}>Remove</Button>
            </span>
        </li>
    );
};

const ProfileDialog: FC<{ api: Api; profile: any | null; qualities: { id: string }[]; onClose: (saved: boolean) => void }> = ({ api, profile, qualities, onClose }) => {
    const [draft, set] = useDraft(profile, { qualities: [], upgradeMode: 'replace', upgradeAllowed: false });
    const [notice, setNotice] = useState<NoticeState | null>(null);
    const chosen = useMemo(() => (draft.qualities as string[] | undefined) ?? [], [draft.qualities]);
    const toggle = useCallback((id: string) => set('qualities', chosen.includes(id) ? chosen.filter(value => value !== id) : [...chosen, id]), [set, chosen]);
    const save = useCallback(async () => {
        try {
            const body = { ...pick(draft, PROFILE_KEYS), qualities: chosen };
            if (profile) await request(api, 'PATCH', `Settings/QualityProfiles/${profile.id}`, { ...body, revision: profile.revision });
            else await request(api, 'POST', 'Settings/QualityProfiles', body);
            onClose(true);
        } catch (error) {
            setNotice({ kind: 'err', text: problemText(error) });
        }
    }, [api, profile, draft, chosen, onClose]);
    const cancel = useCallback(() => onClose(false), [onClose]);
    const addQuality = useCallback((event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => toggle(event.target.value), [toggle]);
    return (
        <Dialog open onClose={cancel} fullWidth maxWidth='sm' className='jfmod-settingsDialog'>
            <DialogTitle>{profile ? `Edit ${profile.name}` : 'Add a quality profile'}</DialogTitle>
            <DialogContent>
                <Notice notice={notice} />
                <FieldForm fields={[{ key: 'name', label: 'Name', type: 'text' }]} draft={draft} onChange={set} />
                <h3 className='jfmod-grouptitle'>Allowed qualities, best first</h3>
                <ol className='jfmod-qlist'>
                    {chosen.map((id, index) => (
                        <QualityRow key={id} id={id} index={index} chosen={chosen} set={set} toggle={toggle} />
                    ))}
                </ol>
                <TextField select fullWidth margin='dense' label='Add a quality' value='' onChange={addQuality}>
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
                <Button onClick={cancel}>Cancel</Button>
                <Button variant='contained' onClick={save}>Save</Button>
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
    return (
        <div className='jfmod-brow'>
            <div className='jfmod-brow-main'>
                <strong>{profile.name}</strong>
                <span className='jfmod-sub'>{(profile.qualities as string[]).join(', ')}</span>
            </div>
            {profile.isDefault ? <span className='jfmod-chip jfmod-chip-primary'>Default</span> :
                <Button size='small' disabled={busy || !canMakeDefault} onClick={makeDefault}>Make default</Button>}
            <span className='jfmod-rowactions'>
                <Button size='small' onClick={edit}>Edit</Button>
                <Button size='small' className='jfmod-danger-text' onClick={remove}>Remove</Button>
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
    const closeDialog = useCallback((saved: boolean) => {
        setEditing(undefined);
        if (saved) void reload();
    }, [reload]);
    return (
        <SectionFrame id='profiles' eyebrow={props.eyebrow} title='Quality profiles' state={summarise('profiles', data)} notice={section.notice}
            next={props.next} onGo={props.onGo}
            actions={<Button variant='outlined' size='small' onClick={add}>Add profile</Button>}
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
    const [draft, set] = useDraft(data.acquisition);
    const section = useSectionState(reload);
    const { run } = section;
    const save = useCallback(() => run(() => request(api, 'PATCH', 'Settings/Acquisition', {
        enabled: !!draft.enabled, downloadClientId: draft.downloadClientId ?? null, defaultQualityProfileId: draft.defaultQualityProfileId ?? null,
        revision: acquisition.revision
    }), 'Saved.'), [run, api, draft, acquisition.revision]);
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
    { key: 'seedReleaseEnabled', label: 'Remove the seeding copy once its goals are met', type: 'bool' },
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
    const [draft, set] = useDraft(source);
    const section = useSectionState(reload);
    const { run } = section;
    const save = useCallback(() => run(() => request(api, 'PATCH', path, { ...pick(draft, fields.map(field => field.key)), revision: source?.revision }), 'Saved.'),
        [run, api, path, draft, fields, source]);
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
    <FlatSection {...props} id='import' title='Import and seeding' path='Settings/Import' source={props.data.importSettings} fields={IMPORT_FIELDS} />
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
            actions={<Button variant='outlined' size='small' disabled={section.busy} onClick={runNow}>Run now</Button>}
            extra={<div className='jfmod-group'>
                <Notice notice={section.notice} />
                <h3 className='jfmod-grouptitle'>Recent decisions</h3>
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
    const [draft, set] = useDraft(data.retention);
    const [seedDraft, setSeed] = useDraft(data.seed);
    const [password, setPassword] = useState<SecretChange>(UNCHANGED);
    const section = useSectionState(reload);
    const users = useMemo(() => data.users.filter(user => !user.Policy?.IsDisabled).map(user => ({ value: user.Id, label: user.Name })), [data.users]);
    const { run, test } = section;
    // Both DTOs are present whenever Save is reachable: the section renders its "Unavailable" frame without them.
    const save = useCallback(() => run(async () => {
        await request(api, 'PATCH', 'Settings/Retention', {
            ...pick(draft, ['enabled', 'reclaimAfterDays', 'watchedUserMode', 'exemptFavourites']),
            selectedUserId: draft.watchedUserMode === 'selectedUser' ? draft.selectedUserId ?? null : null,
            revision: data.retention.revision
        });
        const separate = seedDraft.source === 'separate';
        await request(api, 'PATCH', 'Settings/SeedProtection', {
            source: seedDraft.source, rpcUrl: separate ? seedDraft.rpcUrl ?? '' : null, username: separate ? seedDraft.username ?? '' : null,
            password: separate ? password : UNCHANGED, revision: data.seed.revision
        });
        setPassword(UNCHANGED);
    }, 'Saved.'), [run, api, draft, seedDraft, password, data.retention, data.seed]);
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
                <h3 className='jfmod-grouptitle'>Seed protection</h3>
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
                    <Button variant='outlined' size='small' disabled={section.busy} onClick={testSeed} data-test='seed'>Test</Button>
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
                <Button variant='outlined' size='small' disabled={section.busy} onClick={restoreStock}>
                    Restore stock now
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
