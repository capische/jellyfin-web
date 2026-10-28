import type { Api } from '@jellyfin/sdk/lib/api';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import DeleteIcon from '@mui/icons-material/Delete';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import React, { type FC, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { qualityName } from '../constants/quality';
import { CONFLICT_MESSAGE, problemText, request } from './settingsApi';
import { type Draft, FieldForm, IconAction, Notice, type NoticeState, pick } from './settingsWidgets';

import './qualityProfiles.scss';

/* eslint-disable @typescript-eslint/no-explicit-any -- the profile DTOs are the plugin's own and are read field by field */

// ---- The model behind the simple form (P4.FU9, the approved Quality Profiles redesign, 2026-10-15) ----

export const RESOLUTIONS = ['2160p', '1440p', '1080p', '720p', '576p', '480p'];
const SOURCES: [string, string][] = [['remux', 'Remux'], ['bluray', 'Blu-ray'], ['webdl', 'WEB-DL'], ['webrip', 'WEBRip'], ['hdtv', 'HDTV'], ['dvd', 'DVD']];
const TIER_NAMES = new Map([['2160p', '4K'], ['1440p', '2K'], ['1080p', '1080p'], ['720p', '720p'], ['576p', 'SD'], ['480p', 'SD']]);
const tierName = (resolution: string) => TIER_NAMES.get(resolution) ?? resolution;
/** The tiers the "Best quality I want" buttons offer; SD starts at 576p. */
const BEST = ['2160p', '1440p', '1080p', '720p', '576p'];
/** GB per hour of runtime for each best tier: the top of Small and of Balanced; Large has no limit. */
const SIZE_TABLE = new Map<string, [number, number]>([['2160p', [8, 20]], ['1440p', [4, 10]], ['1080p', [2, 6]], ['720p', [1, 3]], ['576p', [0.5, 1.5]], ['480p', [0.5, 1.5]]]);
const sizesOf = (resolution: string): [number, number] => SIZE_TABLE.get(resolution) ?? [8, 20];
const GB = 1_000_000_000;
const PROFILE_KEYS = ['name', 'minimumBytesPerHour', 'maximumBytesPerHour', 'cutoff', 'upgradeAllowed', 'upgradeMode', 'minimumAutoScore', 'minimumSeeders'];

type Size = 'small' | 'balanced' | 'large';

interface Choice {
    best: string;
    fallback: boolean;
    floor: string;
    size: Size;
}

const resolutionOf = (quality: string | undefined) => quality?.split('-')[1] ?? '';
const gbText = (value: number) => String(Number(value.toFixed(2)));

/** Every allowed quality from the best tier down to the floor, each tier's sources in the fixed order Remux › Blu-ray › WEB-DL › WEBRip › HDTV › DVD. */
const orderFor = (choice: Choice, known: Set<string>) => {
    const first = RESOLUTIONS.indexOf(choice.best);
    const last = choice.fallback ? RESOLUTIONS.indexOf(choice.floor) : first;
    const order: string[] = [];
    for (let index = first; index <= last && index >= 0; index++) {
        for (const [source] of SOURCES) {
            const id = `${source}-${RESOLUTIONS[index]}`;
            if (known.has(id)) order.push(id);
        }
    }
    return order;
};

/**
 * What the simple choices write. The size sets only a maximum: a minimum from the best tier would refuse every smaller,
 * lower-resolution file the profile falls back to (a 1080p WEB-DL is 2-4 GB per hour), so the simple form never sets one.
 */
const recordFor = (choice: Choice, known: Set<string>) => {
    const qualities = orderFor(choice, known);
    const [small, balanced] = sizesOf(choice.best);
    let maximum: number | null = null;
    if (choice.size === 'small') maximum = small * GB;
    else if (choice.size === 'balanced') maximum = balanced * GB;
    return { qualities, cutoff: qualities[0] ?? null, minimumBytesPerHour: null, maximumBytesPerHour: maximum };
};

/** The simple choices a record matches, and whether it holds anything they cannot say (then it is Custom). */
const choiceOf = (record: Draft, known: Set<string>): { choice: Choice; custom: boolean } => {
    const qualities = (record.qualities as string[] | undefined) ?? [];
    const top = resolutionOf(qualities[0]);
    let best = '2160p';
    if (BEST.includes(top)) best = top;
    else if (top === '480p') best = '576p';
    const lowest = resolutionOf(qualities[qualities.length - 1]);
    const fallback = !!lowest && RESOLUTIONS.indexOf(lowest) > RESOLUTIONS.indexOf(best) && !(best === '576p' && lowest === '576p');
    const floor = fallback ? lowest : RESOLUTIONS[Math.min(RESOLUTIONS.length - 1, RESOLUTIONS.indexOf(best) + 1)];
    const [small, balanced] = sizesOf(best);
    const maximum = record.maximumBytesPerHour as number | null | undefined;
    let size: Size | null = null;
    if (maximum == null) size = 'large';
    else if (maximum === small * GB) size = 'small';
    else if (maximum === balanced * GB) size = 'balanced';
    const choice = { best, fallback, floor, size: size ?? 'balanced' };
    const mapped = recordFor(choice, known);
    const custom = size === null || record.minimumBytesPerHour != null || mapped.qualities.join() !== qualities.join()
        || (record.cutoff ?? null) !== mapped.cutoff;
    return { choice, custom };
};

const sizeWords = (record: Draft, short: boolean) => {
    const minimum = record.minimumBytesPerHour as number | null | undefined;
    const maximum = record.maximumBytesPerHour as number | null | undefined;
    if (minimum == null && maximum == null) return short ? 'any size' : 'any file size';
    const prefix = short ? '' : 'files ';
    if (minimum != null && maximum != null) return `${prefix}${short ? '' : 'of '}${gbText(minimum / GB)}–${gbText(maximum / GB)} GB per hour`;
    if (maximum != null) return `${prefix}up to ${gbText(maximum / GB)} GB per hour`;
    return `${prefix}of at least ${gbText((minimum ?? 0) / GB)} GB per hour`;
};

/** The Prefer field's values (Phase 12 M33): Best on My TVs, Plays Everywhere, or No Preference (null). */
export type Prefer = 'tvs' | 'everywhere' | null;

/** The row's clause for a profile's preference; none for No Preference (Phase 12, mockup 1 A). */
const PREFER_CLAUSE = new Map<unknown, string>([['tvs', 'best on my TVs'], ['everywhere', 'plays everywhere']]);

/** A profile's row in the section, in one line: "4K first, then down to 720p · any size · best on my TVs · no upgrades". */
export const profileSummary = (profile: Draft) => {
    const qualities = (profile.qualities as string[] | undefined) ?? [];
    if (!qualities.length) return 'Allows no quality';
    const best = resolutionOf(qualities[0]);
    const lowest = resolutionOf(qualities[qualities.length - 1]);
    const reach = best === lowest ? `${tierName(best)} only` : `${tierName(best)} first, then down to ${lowest}`;
    const upgrades = profile.upgradeAllowed ? 'upgrades until ' + qualityName(profile.cutoff as string) : 'no upgrades';
    const prefer = PREFER_CLAUSE.get(profile.prefer);
    return [reach, sizeWords(profile, true), prefer, upgrades].filter(Boolean).join(' · ');
};

/** What a preference does among releases of the same quality, in the summary sentence (Phase 12, mockup 2). */
const PREFER_SENTENCE = new Map<unknown, string>([
    ['tvs', 'among releases of the same quality takes the one that plays best on your TVs'],
    ['everywhere', 'among releases of the same quality takes the one most devices play without the server converting it']
]);

/** The dialog's live sentence: what this profile will do. */
const Sentence: FC<{ record: Draft }> = ({ record }) => {
    const name = String(record.name ?? '').trim() || 'This profile';
    const qualities = (record.qualities as string[] | undefined) ?? [];
    const best = resolutionOf(qualities[0]);
    const lowest = resolutionOf(qualities[qualities.length - 1]);
    const reach = best === lowest ? `only ${tierName(best)} (${best})` : `${tierName(best)} (${best}) first, then down to ${lowest}`;
    const upgrade = record.upgradeAllowed ?
        <><b>upgrades</b> later until it holds {qualityName(record.cutoff as string)} ({record.upgradeMode === 'add' ? 'keeping both' : 'replacing the file'})</> :
        <>does not upgrade later</>;
    const prefer = PREFER_SENTENCE.get(record.prefer);
    return qualities.length ?
        <><b>{name}</b> picks {reach}, {sizeWords(record, false)}, {prefer ? <>{prefer}, </> : null}and {upgrade}.</> :
        <><b>{name}</b> allows no quality, so it will never pick anything.</>;
};

/** The server's rules, checked as the form changes; Save waits until there is none. */
const problemsOf = (record: Draft) => {
    const qualities = (record.qualities as string[] | undefined) ?? [];
    const problems: string[] = [];
    if (!String(record.name ?? '').trim()) problems.push('Give the profile a name.');
    if (!qualities.length) problems.push('Allow at least one quality.');
    if (record.upgradeAllowed && !record.cutoff) problems.push('Upgrades need a cutoff: the quality at which upgrading stops.');
    if (record.cutoff && !qualities.includes(record.cutoff as string)) problems.push('The cutoff must be one of the profile\'s allowed qualities, and upgrades need a cutoff.');
    const minimum = record.minimumBytesPerHour as number | null | undefined;
    const maximum = record.maximumBytesPerHour as number | null | undefined;
    if (minimum != null && maximum != null && minimum > maximum) problems.push('The smallest file size is above the largest.');
    return problems;
};

// ---- The quality order, one row per quality ----

/**
 * One allowed quality in a profile's ranked list, with Move Up, Move Down and Remove as icons (user, 2026-10-08). A move
 * that has nowhere to go is refused, not disabled, and the moved quality's button keeps the focus, so a remote can press it
 * again: the row is re-rendered in its new place and the browser would otherwise drop the focus with the moved element.
 */
const QualityRow: FC<{ id: string; index: number; chosen: string[]; cutoff: unknown; set: (key: string, value: unknown) => void; toggle: (id: string) => void }> = ({
    id, index, chosen, cutoff, set, toggle
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
    const name = qualityName(id);
    return (
        <li className='jfmod-qrow' title={id}>
            <span className='jfmod-qrank'>{index + 1}</span><span className='jfmod-qname'>{name}</span>
            {cutoff === id && <span className='jfmod-qp-cut'>cutoff</span>}
            <span className='jfmod-rowactions'>
                <IconAction label={`Move ${name} Up`} refused={index === 0} onClick={moveUp} data={{ 'row-action': 'up', quality: id }}><ArrowUpwardIcon /></IconAction>
                <IconAction label={`Move ${name} Down`} refused={index === chosen.length - 1} onClick={moveDown} data={{ 'row-action': 'down', quality: id }}>
                    <ArrowDownwardIcon />
                </IconAction>
                <IconAction label={`Remove ${name}`} red onClick={remove} data={{ 'row-action': 'remove', quality: id }}><DeleteIcon /></IconAction>
            </span>
        </li>
    );
};

/** One button of a segmented choice. */
const Segment: FC<{ pressed: boolean; onClick: () => void; data: string; children: ReactNode }> = ({ pressed, onClick, data, children }) => (
    <button type='button' className='jfmod-qp-segbtn focusable' aria-pressed={pressed} data-qp={data} onClick={onClick}>{children}</button>
);

// ---- The dialog ----

export interface QualityPreset {
    id: string;
    name: string;
    description: string;
    isDefaultPreset: boolean;
    qualities: string[];
    minimumBytesPerHour: number | null;
    maximumBytesPerHour: number | null;
    cutoff: string | null;
    upgradeAllowed: boolean;
    upgradeMode: string;
    minimumSeeders: number | null;
    added: boolean;
    /** Absent before `copies` (Phase 12). */
    prefer?: Prefer;
}

const fromPreset = (preset: QualityPreset): Draft => ({
    qualities: preset.qualities, minimumBytesPerHour: preset.minimumBytesPerHour, maximumBytesPerHour: preset.maximumBytesPerHour, cutoff: preset.cutoff,
    upgradeAllowed: preset.upgradeAllowed, upgradeMode: preset.upgradeMode, minimumSeeders: preset.minimumSeeders, minimumAutoScore: null,
    ...('prefer' in preset ? { prefer: preset.prefer ?? null } : {})
});

/** What each preference prefers, under the buttons (Phase 12, mockup 2); Best on My TVs names what the ticked TVs play. */
const preferHint = (prefer: unknown, tvs: string[]) => {
    if (prefer === 'tvs') {
        return tvs.length ?
            'Among releases of the same quality: Dolby Vision first, then HDR10; Dolby Digital Plus and Dolby Digital sound first; DTS last.' :
            'Among releases of the same quality: Dolby Vision first, then HDR10+, HDR10 and HDR; Atmos and lossless sound first. Tick your TVs in TVs.';
    }
    if (prefer === 'everywhere') {
        return 'Among releases of the same quality: no HDR and H.264 first; AAC, Dolby Digital and Dolby Digital Plus sound first; TrueHD and DTS last.';
    }
    return 'Releases of the same quality keep the order they had before: by seeders.';
};

interface DialogProps {
    api: Api;
    profile: any | null;
    qualities: { id: string }[];
    presets: QualityPreset[];
    /** The ticked TVs' names (Phase 12): Best on My TVs's small line. */
    tvNames?: string[];
    onClose: (saved: boolean, close?: boolean) => void;
}

/**
 * Add or edit a quality profile (P4.FU9, the approved redesign): simple by default (start from a preset, name, best quality,
 * fall back, file size, upgrades, a live sentence), with the whole model under Advanced. The simple choices write the record;
 * an Advanced edit makes it Custom until a simple choice is made again.
 */
export const QualityProfileDialog: FC<DialogProps> = ({ api, profile: initial, qualities, presets, tvNames = [], onClose }) => {
    const known = useMemo(() => new Set(qualities.map(quality => quality.id)), [qualities]);
    // The Prefer field shows only with a plugin that stores it (Phase 12, `copies`): its profiles and presets carry the key.
    const prefers = initial ? 'prefer' in initial : presets.some(preset => 'prefer' in preset);
    const [profile, setProfile] = useState(initial);
    const firstPreset = presets.find(preset => preset.isDefaultPreset) ?? presets[0];
    // The predefined profile the values were filled from; it stays chosen while the values are changed (user, 2026-10-15:
    // "considering you are going to change 4K values the whole section is custom").
    const [templateId, setTemplateId] = useState<string | null>(() => (initial ? initial.presetId ?? null : firstPreset?.id ?? null));
    const [draft, setDraft] = useState<Draft>(() => {
        if (initial) return { ...initial };
        if (firstPreset) return { name: firstPreset.name, ...fromPreset(firstPreset) };
        const choice: Choice = { best: '2160p', fallback: true, floor: '720p', size: 'balanced' };
        return { name: '', upgradeAllowed: false, upgradeMode: 'replace', minimumSeeders: 2, minimumAutoScore: null, ...recordFor(choice, known) };
    });
    const [{ choice, custom }, setShape] = useState(() => choiceOf(draft, known));
    const [notice, setNotice] = useState<NoticeState | null>(null);
    // Whether this editor is still open: a save that completes after it was dismissed only refreshes the list, and never
    // closes an editor opened since, with that editor's typing (Pi review 5, P2 2).
    const open = useRef(true);
    useEffect(() => {
        open.current = true;
        return () => {
            open.current = false;
        };
    }, []);
    const draftNow = useRef(draft);
    draftNow.current = draft;

    /** A simple choice: the record follows it, and the profile is no longer Custom. */
    const choose = useCallback((next: Choice) => {
        setShape({ choice: next, custom: false });
        setDraft(current => ({ ...current, ...recordFor(next, known) }));
    }, [known]);
    /** An Advanced edit: the record changes as asked and the profile is Custom. */
    const edit = useCallback((key: string, value: unknown) => {
        setShape(current => ({ ...current, custom: true }));
        setDraft(current => ({ ...current, [key]: value }));
    }, []);
    const startFrom = useCallback((preset: QualityPreset) => {
        const next = { ...draftNow.current, ...fromPreset(preset), name: initial ? draftNow.current.name : preset.name };
        setTemplateId(preset.id);
        setDraft(next);
        setShape(choiceOf(next, known));
    }, [initial, known]);
    const template = presets.find(preset => preset.id === templateId) ?? null;

    const chosen = useMemo(() => (draft.qualities as string[] | undefined) ?? [], [draft.qualities]);
    const toggle = useCallback((id: string) => {
        if (chosen.includes(id)) {
            edit('qualities', chosen.filter(value => value !== id));
            return;
        }
        // A ticked quality joins the order where its resolution and source put it.
        const rank = (quality: string) => RESOLUTIONS.indexOf(resolutionOf(quality)) * 10 + SOURCES.findIndex(([source]) => quality.startsWith(source + '-'));
        const at = chosen.findIndex(value => rank(value) > rank(id));
        const next = chosen.slice();
        next.splice(at < 0 ? next.length : at, 0, id);
        edit('qualities', next);
    }, [chosen, edit]);
    const setName = useCallback((event: React.ChangeEvent<HTMLInputElement>) => setDraft(current => ({ ...current, name: event.target.value })), []);
    const setUpgrade = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const on = event.target.checked;
        setDraft(current => ({ ...current, upgradeAllowed: on, cutoff: current.cutoff ?? (current.qualities as string[] | undefined)?.[0] ?? null }));
    }, []);
    const setFallback = useCallback((event: React.ChangeEvent<HTMLInputElement>) => choose({ ...choice, fallback: event.target.checked }), [choose, choice]);
    const setFloor = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => choose({ ...choice, floor: event.target.value }), [choose, choice]);
    const pickBest = useCallback((best: string) => {
        const floorBelow = RESOLUTIONS.indexOf(choice.floor) > RESOLUTIONS.indexOf(best);
        choose({ ...choice, best, floor: floorBelow ? choice.floor : RESOLUTIONS[Math.min(RESOLUTIONS.length - 1, RESOLUTIONS.indexOf(best) + 1)] });
    }, [choose, choice]);
    const pickSize = useCallback((size: Size) => choose({ ...choice, size }), [choose, choice]);

    const reloadRecord = useCallback(() => {
        request<any[]>(api, 'GET', 'Settings/QualityProfiles').then(list => {
            const fresh = list.find(item => item.id === profile?.id);
            if (!fresh) return;
            setProfile(fresh);
            setDraft({ ...fresh });
            setShape(choiceOf(fresh, known));
            setNotice(null);
        }).catch(error => setNotice({ kind: 'err', text: problemText(error) }));
    }, [api, profile, known]);

    const problems = problemsOf(draft);
    // One save at a time: a second press while one is under way does nothing (final web review).
    const saving = useRef(false);
    const [busy, setBusy] = useState(false);
    const save = useCallback(async () => {
        if (saving.current || problemsOf(draftNow.current).length) return;
        saving.current = true;
        setBusy(true);
        const sent = draftNow.current;
        try {
            const body = { ...pick(sent, PROFILE_KEYS), name: String(sent.name ?? '').trim(), qualities: sent.qualities,
                ...(prefers ? { prefer: sent.prefer ?? null } : {}) };
            const saved = profile ?
                await request<any>(api, 'PATCH', `Settings/QualityProfiles/${profile.id}`, { ...body, revision: sent.revision ?? profile.revision }) :
                await request<any>(api, 'POST', 'Settings/QualityProfiles', body);
            if (!open.current) {
                onClose(true, false);
                return;
            }
            // Edited while it was saving: the editor stays open on the saved record with those edits (final web review 2, P2 7).
            if (draftNow.current !== sent) {
                setProfile(saved);
                setDraft(current => ({ ...current, revision: saved?.revision }));
                setNotice({ kind: 'warn', text: 'Saved. What you changed while it was saving is not saved yet: save again to keep it.' });
                return;
            }
            onClose(true);
        } catch (error) {
            const text = problemText(error);
            setNotice({ kind: 'err', text, action: text === CONFLICT_MESSAGE ? { label: 'Reload', run: reloadRecord } : undefined });
        } finally {
            saving.current = false;
            setBusy(false);
        }
    }, [api, profile, onClose, reloadRecord, prefers]);
    const cancel = useCallback(() => onClose(false), [onClose]);
    const pickPrefer = useCallback((prefer: Prefer) => setDraft(current => ({ ...current, prefer })), []);

    const [small, balanced] = sizesOf(choice.best);
    const tier = tierName(choice.best);
    const floors = RESOLUTIONS.slice(RESOLUTIONS.indexOf(choice.best) + 1);
    const gbDraft = useMemo<Draft>(() => ({
        ...draft,
        minimumGb: draft.minimumBytesPerHour == null ? null : Number(draft.minimumBytesPerHour) / GB,
        maximumGb: draft.maximumBytesPerHour == null ? null : Number(draft.maximumBytesPerHour) / GB
    }), [draft]);
    const editAdvanced = useCallback((key: string, value: unknown) => {
        if (key === 'minimumGb' || key === 'maximumGb') {
            const bytes = value == null || Number.isNaN(value) ? null : Math.round(Number(value) * GB);
            edit(key === 'minimumGb' ? 'minimumBytesPerHour' : 'maximumBytesPerHour', bytes && bytes > 0 ? bytes : null);
            return;
        }
        edit(key, value);
    }, [edit]);

    return (
        <Dialog open onClose={cancel} fullWidth maxWidth='sm' className='jfmod-settingsDialog jfmod-qp'>
            <DialogTitle>{profile ? `Edit ${profile.name}` : 'Add Quality Profile'}</DialogTitle>
            <DialogContent>
                <Notice notice={notice} />
                {!!presets.length && (
                    <div className='jfmod-qp-field'>
                        <h3 className='jfmod-grouptitle' id='jfmod-qp-predefined' data-qp='group-predefined'>Predefined</h3>
                        <PresetPicker presets={presets} chosen={template} onPick={startFrom} />
                    </div>
                )}
                <label className='jfmod-qp-field'>
                    <span className='jfmod-qp-label'>Name</span>
                    <input className='jfmod-qp-input' value={String(draft.name ?? '')} onChange={setName} data-qp='name' />
                </label>
                <div className='jfmod-qp-field'>
                    <span className='jfmod-qp-label'>Best quality I want</span>
                    <div className='jfmod-qp-seg' role='group' aria-label='Best quality I want'>
                        {BEST.map(resolution => (
                            <BestSegment key={resolution} resolution={resolution} pressed={!custom && choice.best === resolution} onPick={pickBest} />
                        ))}
                    </div>
                </div>
                <div className='jfmod-qp-field'>
                    <label className='jfmod-qp-check'>
                        <input type='checkbox' checked={choice.fallback && !!floors.length} disabled={!floors.length} onChange={setFallback} data-qp='fallback' />
                        <span>Fall back to lower quality if it is not available, down to{' '}
                            <select className='jfmod-qp-floor' value={choice.floor} disabled={!choice.fallback || !floors.length} onChange={setFloor} data-qp='floor'>
                                {floors.map(resolution => <option key={resolution} value={resolution}>{resolution}</option>)}
                            </select>
                        </span>
                    </label>
                </div>
                <div className='jfmod-qp-field'>
                    <span className='jfmod-qp-label'>File size</span>
                    <div className='jfmod-qp-seg jfmod-qp-size' role='group' aria-label='File size'>
                        <SizeSegment size='small' pressed={!custom && choice.size === 'small'} onPick={pickSize} title='Small' hint={`up to ${gbText(small)} GB/h`} />
                        <SizeSegment size='balanced' pressed={!custom && choice.size === 'balanced'} onPick={pickSize} title='Balanced' hint={`up to ${gbText(balanced)} GB/h`} />
                        <SizeSegment size='large' pressed={!custom && choice.size === 'large'} onPick={pickSize} title='Large' hint='no limit' />
                    </div>
                    <div className='fieldDescription'>
                        Approximate size per hour of runtime at {tier}. A 2-hour film at Balanced is about {gbText(small * 2)}–{gbText(balanced * 2)} GB.
                    </div>
                </div>
                {prefers && (
                    <div className='jfmod-qp-field'>
                        <span className='jfmod-qp-label'>Prefer</span>
                        <div className='jfmod-qp-seg jfmod-qp-size' role='group' aria-label='Prefer'>
                            <PreferSegment prefer='tvs' pressed={draft.prefer === 'tvs'} onPick={pickPrefer} title='Best on My TVs'
                                hint={tvNames.length ? tvNames.join(', ') : 'best picture and sound'} />
                            <PreferSegment prefer='everywhere' pressed={draft.prefer === 'everywhere'} onPick={pickPrefer} title='Plays Everywhere'
                                hint='phones, browsers' />
                            <PreferSegment prefer={null} pressed={!draft.prefer} onPick={pickPrefer} title='No Preference' hint='as before' />
                        </div>
                        <div className='fieldDescription' data-qp='prefer-hint'>{preferHint(draft.prefer, tvNames)}</div>
                    </div>
                )}
                <div className='jfmod-qp-field'>
                    <label className='jfmod-qp-check'>
                        <input type='checkbox' checked={!!draft.upgradeAllowed} onChange={setUpgrade} data-qp='upgrade' />
                        <span>Upgrade later when something better appears
                            <span className='fieldDescription jfmod-qp-hint'>
                                Needs Automation on. {draft.upgradeMode === 'add' ? 'Adds a version' : 'Replaces the file'} until it reaches {qualityName((draft.cutoff ?? chosen[0]) as string | undefined) || 'the best allowed quality'}.
                            </span>
                        </span>
                    </label>
                </div>
                <div className='jfmod-qp-sum' data-qp='summary'><Sentence record={draft} /></div>
                {problems.map(problem => <div key={problem} className='jfmod-qp-problem' role='alert'>{problem}</div>)}
                <details className='jfmod-qp-adv' data-qp='advanced'>
                    <summary>Advanced<span className='jfmod-qp-advstate' data-qp='custom'>{custom ? 'custom values' : 'set by the simple choices above'}</span></summary>
                    <div className='jfmod-qp-field'>
                        <span className='jfmod-qp-label'>Allowed qualities — source × resolution</span>
                        <table className='jfmod-qp-matrix'>
                            <thead><tr><th />{RESOLUTIONS.map(resolution => <th key={resolution} scope='col'>{resolution}</th>)}</tr></thead>
                            <tbody>
                                {SOURCES.map(([source, label]) => (
                                    <tr key={source}>
                                        <th scope='row'>{label}</th>
                                        {RESOLUTIONS.map(resolution => (
                                            <MatrixCell key={resolution} id={`${source}-${resolution}`} known={known.has(`${source}-${resolution}`)}
                                                checked={chosen.includes(`${source}-${resolution}`)} label={qualityName(`${source}-${resolution}`)} toggle={toggle} />
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div className='fieldDescription'>
                            Tick what the profile may take. It tries the higher resolution first and, within one, Remux, Blu-ray, WEB-DL, WEBRip, HDTV, DVD.
                        </div>
                    </div>
                    <FieldForm fields={[
                        { key: 'cutoff', label: 'Upgrade until (cutoff)', type: 'select', options: chosen.map(id => ({ value: id, label: qualityName(id) })), optional: true,
                            help: 'Upgrading stops once this quality is held.' },
                        { key: 'upgradeMode', label: 'An upgrade', type: 'select', options: [{ value: 'replace', label: 'replaces the held copy' }, { value: 'add', label: 'is added as another version' }] },
                        { key: 'minimumAutoScore', label: 'Minimum score for automatic grabs', type: 'int', optional: true },
                        { key: 'minimumSeeders', label: 'Minimum seeders', type: 'int', optional: true },
                        { key: 'minimumGb', label: 'Smallest file, GB per hour of runtime', type: 'number', optional: true },
                        { key: 'maximumGb', label: 'Largest file, GB per hour of runtime', type: 'number', optional: true,
                            help: 'Stored as bytes per hour; 1 GB/h is about 2.4 GB for a 2 h 25 min film.' }
                    ]} draft={gbDraft} onChange={editAdvanced} />
                    {/* The order editor is for exceptions only (user, 2026-10-15: "I would assume order, and it's too advanced"); the matrix sets the
                        usual order and the record keeps whatever order this list has. */}
                    <details className='jfmod-qp-ordertried' data-qp='order-toggle'>
                        <summary>Change the order tried</summary>
                        <div className='fieldDescription'>
                            The matrix already sets the usual order: higher resolution first, then Remux, Blu-ray, WEB-DL, WEBRip, HDTV. Change it here only for an
                            exception, such as WEB-DL before Blu-ray.
                        </div>
                        <ol className='jfmod-qlist'>
                            {chosen.map((id, index) => (
                                <QualityRow key={id} id={id} index={index} chosen={chosen} cutoff={draft.cutoff} set={edit} toggle={toggle} />
                            ))}
                        </ol>
                        <div className='fieldDescription' data-qp='order'>
                            Order tried: {chosen.length ? chosen.map((id, index) => `${index + 1} ${qualityName(id)}`).join(', ') : 'nothing'}
                        </div>
                    </details>
                </details>
            </DialogContent>
            <DialogActions>
                <Button variant='contained' color='inherit' onClick={cancel}>Cancel</Button>
                <Button variant='contained' disabled={busy || problems.length > 0} onClick={save} data-qp='save'>Save</Button>
            </DialogActions>
        </Dialog>
    );
};

/** A predefined profile as the picker draws it: its name, then its one-line description in the smaller muted size. */
const PresetText: FC<{ preset: QualityPreset | null }> = ({ preset }) => (
    <span className='jfmod-qp-pickText'>
        <span className='jfmod-qp-pickName'>{preset?.name ?? 'None'}</span>
        <span className='jfmod-qp-pickDesc'>{preset?.description ?? 'Not made from a predefined profile.'}</span>
    </span>
);

const PresetPickItem: FC<{ preset: QualityPreset; selected: boolean; onPick: (preset: QualityPreset) => void }> = ({ preset, selected, onPick }) => {
    const pickIt = useCallback(() => onPick(preset), [onPick, preset]);
    return (
        // The chosen entry takes the focus as the list opens, so the arrows and Enter work at once (inside a dialog the menu
        // otherwise leaves the focus on its paper).
        // eslint-disable-next-line jsx-a11y/no-autofocus -- a listbox opened by the user focuses its current option
        <MenuItem role='option' aria-selected={selected} selected={selected} autoFocus={selected} onClick={pickIt}
            className={'jfmod-qp-pickItem' + (selected ? ' jfmod-qp-pickItem--on' : '')} data-qp-preset={preset.name}
        >
            <PresetText preset={preset} />
        </MenuItem>
    );
};

/**
 * The predefined profiles as a custom dropdown (user, 2026-10-15: "use custom dropdown (we already got one on details page) so
 * you can keep the font weight size difference inside dropdown"): a field-like trigger with the chosen one's name and
 * description and a chevron, opening a paper list of the six drawn the same way, the chosen one marked by a blue left bar.
 * MUI's menu gives it the listbox keys (arrows, Enter, Escape back to the trigger) and the TV's modal handling.
 */
const PresetPicker: FC<{ presets: QualityPreset[]; chosen: QualityPreset | null; onPick: (preset: QualityPreset) => void }> = ({ presets, chosen, onPick }) => {
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const openList = useCallback((event: React.MouseEvent<HTMLElement>) => setAnchor(event.currentTarget), []);
    const close = useCallback(() => setAnchor(null), []);
    const pickIt = useCallback((preset: QualityPreset) => {
        setAnchor(null);
        onPick(preset);
    }, [onPick]);
    return (
        <>
            <button type='button' className='jfmod-qp-pick focusable' aria-haspopup='listbox' aria-expanded={!!anchor}
                aria-labelledby='jfmod-qp-predefined jfmod-qp-pickValue' onClick={openList} data-qp='predefined'
            >
                <span id='jfmod-qp-pickValue'><PresetText preset={chosen} /></span>
                <span className={'material-icons jfmod-qp-pickChevron ' + (anchor ? 'expand_less' : 'expand_more')} aria-hidden='true' />
            </button>
            <Menu anchorEl={anchor} open={!!anchor} onClose={close} className='jfmod-qp-pickMenu'
                slotProps={{ list: { role: 'listbox', 'aria-labelledby': 'jfmod-qp-predefined' }, paper: { style: { width: anchor?.offsetWidth } } }}
            >
                {presets.map(preset => <PresetPickItem key={preset.id} preset={preset} selected={preset.id === chosen?.id} onPick={pickIt} />)}
            </Menu>
        </>
    );
};

const BestSegment: FC<{ resolution: string; pressed: boolean; onPick: (resolution: string) => void }> = ({ resolution, pressed, onPick }) => {
    const pickIt = useCallback(() => onPick(resolution), [onPick, resolution]);
    return (
        <Segment pressed={pressed} onClick={pickIt} data={'best-' + resolution}>
            {tierName(resolution)}{resolution === '576p' ? null : <small> {resolution}</small>}
        </Segment>
    );
};

const SizeSegment: FC<{ size: Size; pressed: boolean; onPick: (size: Size) => void; title: string; hint: string }> = ({ size, pressed, onPick, title, hint }) => {
    const pickIt = useCallback(() => onPick(size), [onPick, size]);
    return <Segment pressed={pressed} onClick={pickIt} data={'size-' + size}>{title}<small>{hint}</small></Segment>;
};

const PreferSegment: FC<{ prefer: Prefer; pressed: boolean; onPick: (prefer: Prefer) => void; title: string; hint: string }> = ({
    prefer, pressed, onPick, title, hint
}) => {
    const pickIt = useCallback(() => onPick(prefer), [onPick, prefer]);
    return <Segment pressed={pressed} onClick={pickIt} data={'prefer-' + (prefer ?? 'none')}>{title}<small>{hint}</small></Segment>;
};

const MatrixCell: FC<{ id: string; known: boolean; checked: boolean; label: string; toggle: (id: string) => void }> = ({ id, known, checked, label, toggle }) => {
    const flip = useCallback(() => toggle(id), [toggle, id]);
    if (!known) return <td className='jfmod-qp-na' aria-hidden='true'>·</td>;
    return <td><input type='checkbox' checked={checked} onChange={flip} aria-label={label} data-qp-quality={id} /></td>;
};

/** The shipped presets and whether each is a profile yet; empty when the plugin has none (an older build). */
export const usePresets = (api: Api, profiles: { id: string }[]) => {
    const [presets, setPresets] = useState<QualityPreset[]>([]);
    const key = profiles.map(profile => profile.id).sort((a, b) => a.localeCompare(b)).join();
    useEffect(() => {
        let current = true;
        request<QualityPreset[]>(api, 'GET', 'Settings/QualityProfiles/Presets')
            .then(list => { if (current) setPresets(Array.isArray(list) ? list : []); })
            .catch(() => { if (current) setPresets([]); });
        return () => {
            current = false;
        };
    }, [api, key]);
    return presets;
};

/* eslint-enable @typescript-eslint/no-explicit-any */
