import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import React, { type FC, useCallback, useEffect, useState } from 'react';

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
            const failed = plan.failures?.length ? ` ${plural(plan.failures.length, 'file')} could not be changed.` : '';
            setNotice({ kind: plan.failures?.length ? 'warn' : 'ok', text: success(plan) + failed });
            await load();
            // The rail's line for this section reads the same libraries.
            await reload().catch(() => undefined);
        } catch (error) {
            setNotice({ kind: 'err', text: problemText(error) });
        } finally {
            setBusy(false);
        }
    }, [load, reload]);

    const preview = useCallback((library: PlaceholderLibrary) => run(
        () => request<PlaceholderPlan>(api, 'GET', `Placeholders/${library.libraryId}/Plan`),
        plan => `Dry run for ${plan.libraryName}: ${summaryOf(plan)}. Nothing was changed.`), [api, run]);

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
                    + (done.pending ? `, ${done.pending} more over the next runs` : '') + '. Jellyfin adds them as it scans.');
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
                its details, and none can play it. On for every library unless you turn it off here; a folder that cannot be written
                gets nothing. Large libraries fill in a few titles at a time.
            </p>
            {notice && <Notice notice={notice} />}
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
