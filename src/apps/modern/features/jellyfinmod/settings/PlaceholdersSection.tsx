import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import React, { type FC, useCallback, useEffect, useState } from 'react';

import { invalidateCatalog } from '../integration/invalidateCatalog';
import { type PlaceholderLibrary, type SectionProps, summarisePlaceholders } from './settingsSections';
import { problemText, request } from './settingsApi';
import { Notice, type NoticeState, ScrollList, SectionFrame, useConfirm } from './settingsWidgets';

/** A dry run or a run (`/Placeholders/{id}/Plan`, `/Sync`, `/Removal`, `/Remove`). */
interface PlaceholderPlan {
    libraryId: string;
    libraryName: string;
    enabled: boolean;
    dryRun: boolean;
    existing: number;
    writes: { title: string; seasonNumber: number; episodeNumber: number; path: string }[];
    removals: { path: string; reason: string }[];
    skipped: { title: string; seasonNumber: number | null; episodes: number; reason: string; detail: string }[];
    failures?: { path: string; reason: string }[];
    /** Placeholders a run left for the next one (a run writes a few series at a time). */
    pending?: number;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** The backfill's progress (`GET /Placeholders/Progress`, P1.FU27). */
interface PlaceholderProgress {
    titles: number;
    titlesDone: number;
    pending: number;
    running: boolean;
    scanRunning: boolean;
    lastRunAt: string | null;
    deferred: string | null;
    nextRunMinutes: number;
}

/** One watched mark the restore puts back (`/Placeholders/RestoreWatched`, P1.FU27). */
interface WatchedRestoreItem {
    entryId: string;
    title: string;
    seasonNumber: number | null;
    episodeNumber: number | null;
    userName: string;
    playedAt: string;
}

interface WatchedRestorePlan {
    dryRun: boolean;
    items: WatchedRestoreItem[];
    /** Marks Jellyfin holds already (re-attached, or set by the user since): left alone. */
    kept: number;
    /** Reclaimed titles whose placeholder Jellyfin does not hold yet: the next try after the backfill. */
    waiting: number;
    failures: string[];
}

const two = (value: number) => String(value).padStart(2, '0');
const restoreLabel = (item: WatchedRestoreItem) => (item.seasonNumber !== null && item.episodeNumber !== null ?
    `${item.title} S${two(item.seasonNumber)}E${two(item.episodeNumber)}` : item.title);

/** `12 of 40 titles done · 85 placeholders pending`: the line Settings shows for the backfill. */
export const progressLine = (progress: PlaceholderProgress) =>
    `${progress.titlesDone} of ${plural(progress.titles, 'title')} done · ${plural(progress.pending, 'placeholder')} pending`;

/** What the scheduled sync does next, in words. */
const paceLine = (progress: PlaceholderProgress) => {
    if (progress.running) return 'A batch is being written now.';
    if (progress.scanRunning || progress.deferred === 'library_scan') return 'Waiting for Jellyfin\'s library scan to finish; the next batch follows it.';
    if (progress.pending > 0) return `The next batch of up to 10 titles per library comes in about ${progress.nextRunMinutes} min.`;
    return 'Every title has its placeholders; checked again every 15 minutes.';
};

const isConflict = (error: unknown) => (error as { status?: number } | null)?.status === 409;

/** The restore's dry run as a list: each title and episode, whose mark, and its date. */
const RestoreList: FC<{ plan: WatchedRestorePlan }> = ({ plan }) => (
    <ScrollList label='Watched marks to restore'>
        {plan.items.length === 0 && <div className='jfmod-empty'>Nothing to restore.</div>}
        {plan.items.map(item => (
            <div className='jfmod-brow' key={`${item.entryId}${item.seasonNumber}${item.episodeNumber}${item.userName}`}>
                <div className='jfmod-brow-main'>
                    <strong>{restoreLabel(item)}</strong>
                    <span className='jfmod-sub'>Watched by {item.userName} on {new Date(item.playedAt).toLocaleDateString()}</span>
                </div>
            </div>
        ))}
    </ScrollList>
);

interface BackfillProps {
    api: SectionProps['api'];
    busy: boolean;
    setBusy: (busy: boolean) => void;
    setNotice: (notice: NoticeState | null) => void;
    ask: ReturnType<typeof useConfirm>[1];
    /** Bumped by the section after its own runs, so the progress reads again. */
    version: number;
    onSynced: () => Promise<void>;
}

/**
 * The backfill (P1.FU27): how far the placeholders of the existing catalogue are, Sync Now (the scheduled sync's next batch at
 * once) and Restore Watched State From Retention History (a dry run first, then a confirmation). The line reads again every
 * 30 seconds while placeholders are pending.
 */
const Backfill: FC<BackfillProps> = ({ api, busy, setBusy, setNotice, ask, version, onSynced }) => {
    const [progress, setProgress] = useState<PlaceholderProgress | null>(null);
    const [restorePlan, setRestorePlan] = useState<WatchedRestorePlan | null>(null);
    const read = useCallback(async () => {
        try {
            setProgress(await request<PlaceholderProgress>(api, 'GET', 'Placeholders/Progress'));
        } catch {
            setProgress(null);
        }
    }, [api]);
    useEffect(() => {
        void read();
    }, [read, version]);
    const active = !!progress && (progress.pending > 0 || progress.running);
    useEffect(() => {
        if (!active) return;
        const timer = window.setInterval(() => {
            read().catch(() => undefined);
        }, 30000);
        return () => window.clearInterval(timer);
    }, [active, read]);

    const syncNow = useCallback(async () => {
        setBusy(true);
        try {
            const after = await request<PlaceholderProgress>(api, 'POST', 'Placeholders/SyncNow');
            setProgress(after);
            invalidateCatalog(api);
            setNotice({ kind: 'ok', text: `Synced: ${progressLine(after)}. Jellyfin adds the new placeholders within seconds.` });
            await onSynced();
        } catch (error) {
            setNotice(isConflict(error) ? { kind: 'warn', text: 'A sync is running already; the line updates when it ends.' } :
                { kind: 'err', text: problemText(error) });
            await read();
        } finally {
            setBusy(false);
        }
    }, [api, onSynced, read, setBusy, setNotice]);

    const restore = useCallback(async () => {
        let plan: WatchedRestorePlan;
        setBusy(true);
        try {
            plan = await request<WatchedRestorePlan>(api, 'GET', 'Placeholders/RestoreWatched');
        } catch (error) {
            setNotice({ kind: 'err', text: problemText(error) });
            return;
        } finally {
            setBusy(false);
        }
        setRestorePlan(plan);
        const left = [plan.kept ? `${plural(plan.kept, 'mark')} Jellyfin kept` : '',
            plan.waiting ? `${plural(plan.waiting, 'mark')} waiting for a placeholder` : ''].filter(Boolean).join(', ');
        if (!plan.items.length) {
            setNotice({ kind: 'ok', text: 'Nothing to restore from retention history' + (left ? ` (${left}).` : '.') });
            return;
        }
        ask({
            title: `Restore ${plural(plan.items.length, 'watched mark')}?`,
            text: 'Retention history records these titles as watched before their files were reclaimed, and Jellyfin no longer has the '
                + 'marks. Each is put back on its placeholder with its original date (listed below). A title a user has marked or '
                + 'unmarked since is left alone.' + (left ? ` Left as they are: ${left}.` : ''),
            action: 'Restore',
            onConfirm: () => {
                void (async () => {
                    setBusy(true);
                    try {
                        const done = await request<WatchedRestorePlan>(api, 'POST', 'Placeholders/RestoreWatched');
                        setRestorePlan(done);
                        const failed = done.failures.length ? ` ${plural(done.failures.length, 'mark')} could not be restored.` : '';
                        setNotice({ kind: done.failures.length ? 'warn' : 'ok', text: `Restored ${plural(done.items.length, 'watched mark')}.${failed}` });
                    } catch (error) {
                        setNotice({ kind: 'err', text: problemText(error) });
                    } finally {
                        setBusy(false);
                    }
                })();
            }
        });
    }, [api, ask, setBusy, setNotice]);

    return (
        <div className='jfmod-brow' data-jfmod-placeholder-progress=''>
            <div className='jfmod-brow-main'>
                <strong>Placeholders: {progress ? progressLine(progress) : 'reading…'}</strong>
                {progress && <span className='jfmod-sub' data-jfmod-placeholder-pace=''>{paceLine(progress)}</span>}
                <div className='jfmod-inlineactions'>
                    <Button variant='contained' color='inherit' disabled={busy || !!progress?.running} onClick={syncNow}>Sync Now</Button>
                    <Button variant='contained' color='inherit' disabled={busy} onClick={restore}>Restore Watched State</Button>
                </div>
                {restorePlan && <RestoreList plan={restorePlan} />}
            </div>
        </div>
    );
};

/** One line per file a run would write or remove and per episode it leaves without one, in the order the plugin gives them. */
const PlanList: FC<{ plan: PlaceholderPlan }> = ({ plan }) => (
    <ScrollList label={`What a sync of ${plan.libraryName} does`}>
        {plan.writes.length + plan.removals.length + plan.skipped.length === 0
            && <div className='jfmod-empty'>Nothing to write or remove.</div>}
        {plan.writes.map(write => (
            <div className='jfmod-brow' key={'w' + write.path}>
                <div className='jfmod-brow-main'>
                    <strong>Write</strong>
                    <span className='jfmod-sub jfmod-mono'>{write.path}</span>
                </div>
            </div>
        ))}
        {plan.removals.map(removal => (
            <div className='jfmod-brow' key={'r' + removal.path}>
                <div className='jfmod-brow-main'>
                    <strong>Remove</strong>
                    <span className='jfmod-sub jfmod-mono'>{removal.path} ({removal.reason})</span>
                </div>
            </div>
        ))}
        {plan.skipped.map(skip => (
            <div className='jfmod-brow' key={`s${skip.title}${skip.seasonNumber}${skip.reason}${skip.detail}`}>
                <div className='jfmod-brow-main'>
                    <strong>{skip.title}{skip.seasonNumber ? ` · Season ${skip.seasonNumber}` : ''}</strong>
                    <span className='jfmod-sub'>No placeholder for {plural(skip.episodes, 'episode')}: {skip.detail}</span>
                </div>
            </div>
        ))}
    </ScrollList>
);

interface LibraryRowProps {
    library: PlaceholderLibrary;
    busy: boolean;
    plan?: PlaceholderPlan;
    onToggle: (library: PlaceholderLibrary, enabled: boolean) => Promise<void>;
    onPreview: (library: PlaceholderLibrary) => Promise<void>;
    onRemove: (library: PlaceholderLibrary) => Promise<void>;
}

/** The library's state in words: on, off because an administrator turned it off, or on but nothing can be written. */
const statusOf = (library: PlaceholderLibrary) => {
    if (!library.enabled) return 'Off (turned off by you)';
    return library.writable === false ? 'Read-only: its folders cannot be written, so nothing is written' : 'On';
};

/** One TV or movie library: its switch, Preview (the dry run) and Remove Placeholders, and the last plan read for it. */
const LibraryRow: FC<LibraryRowProps> = ({ library, busy, plan, onToggle, onPreview, onRemove }) => {
    const toggle = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        void onToggle(library, event.target.checked);
    }, [library, onToggle]);
    const preview = useCallback(() => {
        void onPreview(library);
    }, [library, onPreview]);
    const remove = useCallback(() => {
        void onRemove(library);
    }, [library, onRemove]);
    return (
        <div className='jfmod-brow' data-jfmod-placeholders={library.libraryId}>
            <div className='jfmod-brow-main'>
                <strong>{library.name}</strong>
                <span className='jfmod-sub' data-jfmod-placeholder-status=''>{statusOf(library)} · {plural(library.stubs, 'placeholder')} in Jellyfin</span>
                <FormControlLabel control={<Switch checked={library.enabled} disabled={busy} onChange={toggle} />}
                    label={library.mediaType === 'movie' ? 'Show missing movies as Jellyfin items' : 'Show missing episodes as Jellyfin items'} />
                <div className='jfmod-inlineactions'>
                    <Button variant='contained' color='inherit' disabled={busy} onClick={preview}>Preview</Button>
                    <Button variant='contained' color='error' disabled={busy} onClick={remove}>
                        Remove Placeholders
                    </Button>
                </div>
                {plan && <PlanList plan={plan} />}
            </div>
        </div>
    );
};

const summaryOf = (plan: PlaceholderPlan) => {
    const parts = [`${plural(plan.writes.length, 'placeholder')} to write`, `${plan.removals.length} to remove`];
    if (plan.skipped.length) parts.push(`${plural(plan.skipped.reduce((sum, skip) => sum + skip.episodes, 0), 'episode')} left without one`);
    return parts.join(', ');
};

/**
 * Missing Episodes (P1.FU24, P1.FU26): per TV and movie library, the switch "Show missing episodes (movies) as Jellyfin items" (on
 * by default), with the section's state (`summarisePlaceholders`, as the rail shows it), a dry run
 * that lists the exact files a sync would write and remove, and Remove Placeholders. Turning a switch on asks first, naming how
 * many files it writes.
 */
export const PlaceholdersSection: FC<SectionProps> = props => {
    const { api, reload } = props;
    const [libraries, setLibraries] = useState<PlaceholderLibrary[] | null>(null);
    const [plans, setPlans] = useState<Record<string, PlaceholderPlan>>({});
    const [notice, setNotice] = useState<NoticeState | null>(null);
    const [busy, setBusy] = useState(false);
    const [confirmDialog, ask] = useConfirm();
    const [version, setVersion] = useState(0);

    const load = useCallback(async () => {
        try {
            setLibraries(await request<PlaceholderLibrary[]>(api, 'GET', 'Placeholders'));
        } catch (error) {
            setNotice({ kind: 'err', text: problemText(error) });
        }
    }, [api]);
    useEffect(() => {
        void load();
    }, [load]);

    const run = useCallback(async (work: () => Promise<PlaceholderPlan>, success: (plan: PlaceholderPlan) => string) => {
        setBusy(true);
        try {
            const plan = await work();
            setPlans(current => ({ ...current, [plan.libraryId]: plan }));
            if (!plan.dryRun) invalidateCatalog(api);
            const failed = plan.failures?.length ? ` ${plural(plan.failures.length, 'file')} could not be changed.` : '';
            setNotice({ kind: plan.failures?.length ? 'warn' : 'ok', text: success(plan) + failed });
            setVersion(value => value + 1);
            await load();
            // The rail's line for this section reads the same libraries.
            await reload().catch(() => undefined);
        } catch (error) {
            setNotice({ kind: 'err', text: problemText(error) });
        } finally {
            setBusy(false);
        }
    }, [api, load, reload]);

    const preview = useCallback((library: PlaceholderLibrary) => run(
        () => request<PlaceholderPlan>(api, 'GET', `Placeholders/${library.libraryId}/Plan`),
        plan => `Dry run for ${plan.libraryName}: ${summaryOf(plan)}. Nothing was changed.`), [api, run]);

    // After Sync Now: the libraries' counts and the rail's line.
    const synced = useCallback(async () => {
        await load();
        await reload().catch(() => undefined);
    }, [load, reload]);

    const remove = useCallback(async (library: PlaceholderLibrary, afterOff = false) => {
        let plan: PlaceholderPlan;
        try {
            plan = await request<PlaceholderPlan>(api, 'GET', `Placeholders/${library.libraryId}/Removal`);
        } catch (error) {
            setNotice({ kind: 'err', text: problemText(error) });
            return;
        }
        setPlans(current => ({ ...current, [plan.libraryId]: plan }));
        if (afterOff && plan.removals.length === 0) return;
        ask({
            title: afterOff ? 'Remove existing placeholders now?' : `Remove placeholders from ${library.name}?`,
            text: `This deletes ${plural(plan.removals.length, 'placeholder file')} (listed below) and the season folders that leaves empty. `
                + 'Nothing else is touched; watched and favourite marks are kept by Jellyfin for when the episode arrives.'
                + (afterOff ? ' Cancel keeps them; nothing more is written while the switch is off.' : '')
                + (!afterOff && library.enabled ? ' The switch is still on, so the next sync writes them again: turn it off first.' : ''),
            action: 'Remove',
            onConfirm: () => {
                void run(() => request<PlaceholderPlan>(api, 'POST', `Placeholders/${library.libraryId}/Remove`),
                    done => `Removed ${plural(done.removals.length, 'placeholder')} from ${done.libraryName}.`);
            }
        });
    }, [api, ask, run]);

    // On is the default (user, 2026-10-15: "That's the point"): turning it back on just syncs; turning it off offers to remove
    // the placeholders already written.
    const toggle = useCallback(async (library: PlaceholderLibrary, enabled: boolean) => {
        if (enabled) {
            await run(() => request<PlaceholderPlan>(api, 'PUT', `Placeholders/${library.libraryId}`, { enabled: true }),
                done => `On for ${done.libraryName}: wrote ${plural(done.writes.length, 'placeholder')}`
                    + (done.pending ? `, ${done.pending} more over the next runs` : '') + '. Jellyfin adds them within seconds.');
            return;
        }
        await run(() => request<PlaceholderPlan>(api, 'PUT', `Placeholders/${library.libraryId}`, { enabled: false }),
            plan => `Off for ${plan.libraryName}: nothing more is written.`);
        await remove(library, true);
    }, [api, remove, run]);

    return (
        <SectionFrame id='placeholders' eyebrow={props.eyebrow} title='Missing Episodes' state={summarisePlaceholders(libraries ?? undefined)}
            notice={null} next={props.next} onGo={props.onGo}>
            <p className='fieldDescription jfmod-lead'>
                Shows every aired episode you do not have yet, and every released movie or series in your catalog with no file, as a
                Jellyfin item: a small placeholder file where its download will go. Every app then lists it with watched, favourite and
                its details, and none can play it. On for every library unless you turn it off here. Titles already in your catalog
                get theirs in batches of up to 10 per library, every 5 minutes until all are done and every 15 minutes after that, and
                never while Jellyfin scans a library; Sync Now writes the next batch at once. Where a library is off or its folder
                cannot be written, and for unaired episodes, JellyfinMod shows its own cards and rows instead.
            </p>
            {notice && <Notice notice={notice} />}
            <Backfill api={api} busy={busy} setBusy={setBusy} setNotice={setNotice} ask={ask} version={version} onSynced={synced} />
            <div className='jfmod-blist'>
                {libraries?.length === 0 && <div className='jfmod-empty'>No TV or movie library.</div>}
                {libraries?.map(library => (
                    <LibraryRow key={library.libraryId} library={library} busy={busy} plan={plans[library.libraryId]}
                        onToggle={toggle} onPreview={preview} onRemove={remove} />
                ))}
            </div>
            {confirmDialog}
        </SectionFrame>
    );
};
