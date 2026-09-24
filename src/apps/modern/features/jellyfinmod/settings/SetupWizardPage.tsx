import Button from '@mui/material/Button';
import React, { type FC, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

import Page from 'components/Page';
import { useApi } from 'hooks/useApi';

import { usePluginHealth } from '../hooks/useEntries';
import { blockerSentence, request } from './settingsApi';
import {
    AutomationSection, ClientSection, DiscoverySection, GrabbingSection, IndexersSection, InterfaceSection, ProfilesSection, RetentionSection,
    type SectionProps
} from './settingsSections';
import { useSettingsData } from './SettingsPage';
import { StatePill } from './settingsWidgets';

import './settings.scss';

/** The capability that says this plugin build derives setup state from readiness (P7.S7). */
export const SETUP_CAPABILITY = 'setup';

const STEPS: { id: string; title: string; sections: FC<SectionProps>[] }[] = [
    { id: 'discovery', title: 'Discovery', sections: [DiscoverySection] },
    { id: 'downloadClient', title: 'Download client', sections: [ClientSection] },
    { id: 'indexers', title: 'Indexers', sections: [IndexersSection] },
    { id: 'qualityProfile', title: 'Quality profile', sections: [ProfilesSection] },
    { id: 'enable', title: 'Turn grabbing on', sections: [GrabbingSection] },
    { id: 'optional', title: 'Optional', sections: [RetentionSection, AutomationSection, InterfaceSection] }
];

/**
 * `/catalog/settings/setup` — the first-run wizard (P7.S10, PHASE7 §7).
 *
 * Its progress is not stored: every step's status comes from `Setup/State`, which derives it from the readiness
 * checks the product already enforces, so closing the browser and coming back resumes at the first incomplete step.
 * Each step is the settings area's own section; Continue is refused until the server says the step is done.
 */
const SetupWizardPage: FC = () => {
    const { api, user } = useApi();
    const isAdmin = !!user?.Policy?.IsAdministrator;
    const health = usePluginHealth();
    const available = health.data?.ok === true && health.data.capabilities.includes(SETUP_CAPABILITY);
    const settings = useSettingsData(isAdmin && available);
    const [params, setParams] = useSearchParams();
    const setup = settings.data?.overview?.setup;
    const status = (id: string) => setup?.steps.find(step => step.id === id);
    const firstOpen = STEPS.find(step => status(step.id)?.status !== 'done')?.id ?? 'optional';
    const current = STEPS.some(step => step.id === params.get('step')) ? params.get('step')! : firstOpen;
    const index = STEPS.findIndex(step => step.id === current);
    const step = STEPS[index];
    const go = (id: string) => setParams({ step: id }, { replace: true });
    // Resume at the first incomplete step, then stay there: finishing it must not move the page by itself.
    useEffect(() => {
        if (setup && !params.get('step')) setParams({ step: firstOpen }, { replace: true });
    }, [setup, params, firstOpen, setParams]);

    let content: React.ReactNode;
    if (!user || health.isLoading) content = <p className='jfmod-lead'>Loading…</p>;
    else if (!isAdmin) content = <p className='jfmod-lead'>Setting up JellyfinMod is for administrators.</p>;
    else if (!available) content = <p className='jfmod-lead'>The JellyfinMod plugin on this server has no setup wizard. Use the JellyfinMod page in the Dashboard.</p>;
    else if (!settings.data || !api || !setup) content = <p className='jfmod-lead'>{settings.isError ? 'Setup could not be loaded.' : 'Loading…'}</p>;
    else {
        const state = status(current);
        const done = state?.status === 'done';
        const next = STEPS[index + 1];
        content = (
            <div className='jfmod-settings jfmod-check'>
                <nav className='jfmod-check-rail' aria-label='Setup steps'>
                    <div className='jfmod-check-head'>
                        <h2>Set up JellyfinMod</h2>
                        <p>{setup.complete ? 'Everything required is done.' : 'Each step unlocks when the one before it passes its test.'}</p>
                    </div>
                    <ol className='jfmod-check-steps'>
                        {STEPS.map((item, at) => {
                            const itemState = status(item.id)?.status ?? 'pending';
                            let kind: 'ok' | 'warn' | 'off' = 'warn';
                            if (itemState === 'done') kind = 'ok';
                            else if (itemState === 'blocked') kind = 'off';
                            return (
                                <li key={item.id}>
                                    <button type='button' className={`jfmod-step k-${kind}`} data-step={item.id} aria-current={item.id === current ? 'true' : 'false'}
                                        onClick={() => go(item.id)}
                                    >
                                        <span className='jfmod-step-n' aria-hidden='true'>{at + 1}</span>
                                        <span className='jfmod-step-text'>
                                            <span className='jfmod-t'>{item.title}</span>
                                            <span className='jfmod-s'>{itemState}</span>
                                        </span>
                                    </button>
                                </li>
                            );
                        })}
                    </ol>
                    <div className='jfmod-check-links'>
                        <a href='#/catalog/settings'>All settings</a>
                        {!setup.dismissedAt && (
                            <a href='#/catalog/settings/setup' onClick={event => {
                                event.preventDefault();
                                void request(api, 'POST', 'Setup/Dismiss').then(() => settings.refetch());
                            }}>Hide the Home banner</a>
                        )}
                    </div>
                </nav>
                {/* focuscontainer-y: on the TV, Up and Down stay in the section instead of falling back into the rail
                    beside it (REVIEW-2026-09-24 S8-R2); Left and Right still cross between the two. */}
                <div className='jfmod-check-main focuscontainer-y'>
                    <div className='jfmod-notice jfmod-notice-ok' role='status' data-wizard-state={state?.status}>
                        <i aria-hidden='true' />
                        <span className='jfmod-notice-text'>
                            <StatePill kind={done ? 'ok' : 'warn'}>{done ? 'This step is done.' : 'This step is not done yet.'}</StatePill>
                            {!done && state?.reasons.length ? ' ' + state.reasons.map(blockerSentence).join(' ') : ''}
                        </span>
                        {next && (
                            <span className='jfmod-notice-action'>
                                <Button variant='contained' size='small' disabled={!done} data-wizard='continue'
                                    onClick={() => go(next.id)}
                                >
                                    Continue
                                </Button>
                            </span>
                        )}
                    </div>
                    {step.sections.map((Section, at) => (
                        <div key={at} className='jfmod-wizardSection'>
                            <Section api={api} data={settings.data!} reload={settings.refetch} onGo={() => { /* the wizard moves with Continue */ }}
                                eyebrow={`Step ${index + 1} of ${STEPS.length}`} />
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <Page id='jfmodSetupPage' title='Set up JellyfinMod' className='mainAnimatedPage libraryPage noSecondaryNavPage'>
            <div className='padded-left padded-right padded-top padded-bottom-page'>{content}</div>
        </Page>
    );
};

export default SetupWizardPage;
