import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import { useQuery } from '@tanstack/react-query';
import React, { type FC, useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

import focusManager from 'components/focusManager';
import layoutManager from 'components/layoutManager';
import Page from 'components/Page';
import { useApi } from 'hooks/useApi';

import { usePluginHealth } from '../hooks/useEntries';
import { isSettingsProblem, type Overview, request } from './settingsApi';
import { FOCUSABLE_SELECT, Notice } from './settingsWidgets';
import {
    AutomationSection, ClientSection, DiagnosticsSection, DiscoverySection, GrabbingSection, ImportSection, IndexersSection, InterfaceSection,
    OverviewSection, ProfilesSection, RetentionSection, type SectionProps, type SettingsData, summarise
} from './settingsSections';

import './settings.scss';

/** The capability that says this plugin build carries the typed settings contract (P7.S7). */
export const SETTINGS_CAPABILITY = 'settings.overview';
export const SETTINGS_ROUTE = '/catalog/settings';

/** The checklist, in the order things have to work (Option B, PHASE7 §5.1). */
const SECTIONS: { id: string; title: string; Component: FC<SectionProps> }[] = [
    { id: 'overview', title: 'Overview', Component: OverviewSection },
    { id: 'discovery', title: 'Discovery', Component: DiscoverySection },
    { id: 'client', title: 'Download Client', Component: ClientSection },
    { id: 'indexers', title: 'Indexers', Component: IndexersSection },
    { id: 'profiles', title: 'Quality Profiles', Component: ProfilesSection },
    { id: 'grabbing', title: 'Grabbing', Component: GrabbingSection },
    { id: 'import', title: 'Import and Seeding', Component: ImportSection },
    { id: 'retention', title: 'Retention', Component: RetentionSection },
    { id: 'automation', title: 'Automation', Component: AutomationSection },
    { id: 'interface', title: 'Interface', Component: InterfaceSection },
    { id: 'diagnostics', title: 'Diagnostics', Component: DiagnosticsSection }
];

/**
 * Loads every area at once, as the Dashboard page does. A read that fails leaves its area empty and says so in
 * the section rather than breaking the page (UX §14).
 */
export const useSettingsData = (enabled: boolean) => {
    const { api } = useApi();
    return useQuery({
        queryKey: ['JellyfinMod', api?.basePath, 'SettingsArea'],
        enabled: !!api && enabled,
        retry: false,
        // Settings are edited against revisions: a copy restored from the persisted cache would only earn a 409.
        staleTime: 0,
        refetchOnMount: 'always',
        queryFn: async (): Promise<SettingsData> => {
            // A 404 is a plugin build without that area: it stays empty. Any other failure is recorded, so the page says what
            // could not be read and offers a retry, instead of showing an empty area as if it had loaded (whole-review
            // chunk 4b, P2 5). The overview is what setup is made of: without it the whole load fails.
            const failures: string[] = [];
            // The reads answered 404: not failures for the page, but nothing was read, so a section's Reload does not take
            // their empty stand-ins as the server's copy (final Pi review, P2 2).
            const unsupported: string[] = [];
            const get = <T, >(path: string, fallback: T) => request<T>(api!, 'GET', path).catch(error => {
                (isSettingsProblem(error) && error.status === 404 ? unsupported : failures).push(path.split('?')[0]);
                return fallback;
            });
            const users = api!.axiosInstance.get(api!.basePath + '/Users', { headers: { Authorization: api!.authorizationHeader } })
                .then(response => response.data as SettingsData['users']).catch(() => {
                    failures.push('Users');
                    return [];
                });
            const [overview, discovery, seed, retention, acquisition, indexers, clients, profiles, importSettings, automation, automationStatus,
                decisions, iface, reconciliation, conflicts, orphans, preview, lastRun, userList, prowlarr] = await Promise.all([
                get<Overview | undefined>('Settings/Overview', undefined), get('Settings/Discovery', undefined), get('Settings/SeedProtection', undefined),
                get('Settings/Retention', undefined), get('Settings/Acquisition', undefined), get<unknown[]>('Settings/Indexers', []),
                get<unknown[]>('Settings/DownloadClients', []), get<unknown[]>('Settings/QualityProfiles', []), get('Settings/Import', undefined),
                get('Settings/Automation', undefined), get('Automation/Status', undefined), get<{ items: unknown[] }>('Automation/Decisions?limit=20', { items: [] }),
                get('Settings/Interface', undefined), get('Reconciliation/Latest', undefined), get<unknown[]>('Reconciliation/Conflicts', []),
                get<unknown[]>('Reconciliation/Orphans', []), get('Retention/Preview', undefined), get('Retention/Runs/Latest', undefined), users,
                get<unknown[] | undefined>('Settings/Prowlarr', undefined)
            ]);
            if (failures.includes('Settings/Overview')) throw new Error('The settings overview could not be read.');
            return {
                overview, discovery, seed, retention, acquisition, indexers, clients, profiles, importSettings, automation, automationStatus,
                decisions: decisions.items, iface, reconciliation, conflicts, orphans, preview, lastRun, users: userList, prowlarr, failures,
                unsupported
            } as SettingsData;
        }
    });
};

/**
 * `/catalog/settings` — every JellyfinMod setting in one administrator-only area inside the interface (P7.S8).
 *
 * The Dashboard page's Option B shape carried over: a readiness rail in pipeline order is the navigation and one
 * section shows at a time; the chosen section is in the URL (`?section=`), which the Dashboard page could not do.
 * Forms are the modern Dashboard's MUI controls, whose pop-ups `shell/dpadModals` drives on a TV.
 */
const SettingsPage: FC = () => {
    const { api, user } = useApi();
    const isAdmin = !!user?.Policy?.IsAdministrator;
    const health = usePluginHealth();
    const available = health.data?.ok === true && health.data.capabilities.includes(SETTINGS_CAPABILITY);
    const settings = useSettingsData(isAdmin && available);
    const [params, setParams] = useSearchParams();
    const current = SECTIONS.some(section => section.id === params.get('section')) ? params.get('section')! : 'overview';
    const railRef = useRef<HTMLOListElement>(null);

    const go = useCallback((id: string) => {
        // Replace, not push: Back leaves the settings area for wherever it was opened from, as on every other page.
        setParams({ section: id }, { replace: true });
        // Put focus on the section heading, so a keyboard or screen-reader user lands where the content changed.
        window.setTimeout(() => document.getElementById(`jfmod-h-${id}`)?.focus(), 0);
    }, [setParams]);
    const { refetch } = settings;
    const retry = useCallback(() => {
        refetch().catch(() => undefined);
    }, [refetch]);
    const pickSection = useCallback((event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => go(event.target.value), [go]);
    // Each rail step carries its section id in `data-section`, so one handler serves the whole rail.
    const openStep = useCallback((event: React.MouseEvent<HTMLButtonElement>) => go(event.currentTarget.dataset.section!), [go]);

    useEffect(() => {
        // TV: start on the current rail step, so the remote has somewhere to be (UX §13 rule 2). Only when the remote has
        // nowhere to be: every refetch brings new data (a test, a save), and moving the focus then took the remote off the
        // row it was working on (fix/settings-rows-case, 2026-10-08).
        if (!layoutManager.tv || !settings.data) return;
        const active = document.activeElement;
        if (active && active !== document.body && active.isConnected) return;
        const step = railRef.current?.querySelector<HTMLElement>('.jfmod-step[aria-current="true"]');
        if (step) focusManager.focus(step);
    }, [settings.data]);

    let content: React.ReactNode;
    if (!user || (health.isLoading && !health.isError)) {
        content = <p className='jfmod-lead'>Loading…</p>;
    } else if (!isAdmin) {
        content = <p className='jfmod-lead'>JellyfinMod settings are for administrators. Ask an administrator to change them.</p>;
    } else if (!available) {
        content = <p className='jfmod-lead'>The JellyfinMod plugin on this server does not offer this settings area. Use the JellyfinMod page in the Dashboard.</p>;
    } else if (!settings.data || !api) {
        content = settings.isError ?
            <Notice notice={{ kind: 'err', text: 'The settings could not be loaded.', action: { label: 'Retry', run: retry } }} /> :
            <p className='jfmod-lead'>Loading…</p>;
    } else {
        const data = settings.data;
        const index = SECTIONS.findIndex(section => section.id === current);
        const section = SECTIONS[index];
        const next = SECTIONS[index + 1];
        content = (
            // focuscontainer-x: on the TV, Left and Right cross between the rail and the section and never jump up into
            // the header; at 1280×720 the header's SyncPlay button was nearer than the section's first control (P7.S11
            // sweep). Up still reaches the header.
            <div className='jfmod-settings jfmod-check focuscontainer-x'>
                <nav className='jfmod-check-rail' aria-label='JellyfinMod Settings'>
                    <div className='jfmod-check-head'>
                        <h2>JellyfinMod Settings</h2>
                        <p>In the order things have to work.</p>
                    </div>
                    <div className='jfmod-check-picker'>
                        <TextField select fullWidth size='small' label='Section' value={current} onChange={pickSection} slotProps={FOCUSABLE_SELECT}>
                            {SECTIONS.map(item => <MenuItem key={item.id} value={item.id}>{item.title}</MenuItem>)}
                        </TextField>
                    </div>
                    <ol className='jfmod-check-steps' ref={railRef}>
                        {SECTIONS.map((item, at) => {
                            const summary = summarise(item.id, data);
                            return (
                                <li key={item.id}>
                                    <button type='button' className={`jfmod-step k-${summary.kind}`} data-section={item.id}
                                        aria-current={item.id === current ? 'true' : 'false'} onClick={openStep}
                                    >
                                        <span className='jfmod-step-n' aria-hidden='true'>{at + 1}</span>
                                        <span className='jfmod-step-text'>
                                            <span className='jfmod-t'>{item.title}</span>
                                            <span className='jfmod-s'>{summary.words}</span>
                                        </span>
                                    </button>
                                </li>
                            );
                        })}
                    </ol>
                    <div className='jfmod-check-links'>
                        <a href='#/mypreferencesmenu'>Jellyfin Preferences</a>
                        <a href='#/dashboard'>Dashboard</a>
                        <a href='#/catalog/settings/setup'>Setup Wizard</a>
                    </div>
                </nav>
                {/* focuscontainer-y: on the TV, Up and Down stay in the section instead of falling back into the rail
                    beside it (REVIEW-2026-09-24 S8-R2); Left and Right still cross between the two. */}
                <div className='jfmod-check-main focuscontainer-y'>
                    {!!data.failures?.length && <div data-jfmod-settings-failures=''><Notice notice={{
                        kind: 'err', text: `Some settings could not be read (${data.failures.join(', ')}); what they show may be incomplete.`,
                        action: { label: 'Retry', run: retry }
                    }} /></div>}
                    <section.Component api={api} data={data} reload={settings.refetch} onGo={go}
                        eyebrow={`Step ${index + 1} of ${SECTIONS.length}`} next={next && { id: next.id, title: next.title }} />
                </div>
            </div>
        );
    }

    return (
        <Page id='jfmodSettingsPage' title='JellyfinMod Settings' className='mainAnimatedPage libraryPage noSecondaryNavPage'>
            <div className='padded-left padded-right padded-top padded-bottom-page'>
                {content}
            </div>
        </Page>
    );
};

export default SettingsPage;
