import Button from '@mui/material/Button';
import React, { type FC, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

import Page from 'components/Page';
import { useApi } from 'hooks/useApi';

import { usePluginHealth } from '../hooks/useEntries';
import { blockerSentence, request, type SetupState, type SetupStep } from './settingsApi';
import {
    AutomationSection, ClientSection, DiscoverySection, GrabbingSection, IndexersSection, InterfaceSection, ProfilesSection, RetentionSection,
    type SectionProps
} from './settingsSections';
import { useSettingsData } from './SettingsPage';
import { StatePill } from './settingsWidgets';

import './settings.scss';

/** The capability that says this plugin build derives setup state from readiness (P7.S7). */
export const SETUP_CAPABILITY = 'setup';

/** Each step shows settings-area sections; `id` names the section and keys it in the step. */
const STEPS: { id: string; title: string; sections: { id: string; Section: FC<SectionProps> }[] }[] = [
    { id: 'discovery', title: 'Discovery', sections: [{ id: 'discovery', Section: DiscoverySection }] },
    { id: 'downloadClient', title: 'Download client', sections: [{ id: 'client', Section: ClientSection }] },
    { id: 'indexers', title: 'Indexers', sections: [{ id: 'indexers', Section: IndexersSection }] },
    { id: 'qualityProfile', title: 'Quality profile', sections: [{ id: 'profiles', Section: ProfilesSection }] },
    { id: 'enable', title: 'Turn grabbing on', sections: [{ id: 'grabbing', Section: GrabbingSection }] },
    { id: 'optional', title: 'Optional', sections: [
        { id: 'retention', Section: RetentionSection }, { id: 'automation', Section: AutomationSection }, { id: 'interface', Section: InterfaceSection }
    ] }
];

/** A rail step's state as a pill kind: done is ok, blocked is off, anything else still wants attention. */
const stepKind = (state: string): 'ok' | 'warn' | 'off' => {
    if (state === 'done') return 'ok';
    if (state === 'blocked') return 'off';
    return 'warn';
};

/** The sections' own "Next" and Fix links do nothing here: the wizard moves with Continue. */
const stayOnStep = () => { /* the wizard moves with Continue */ };

/** The wizard's rail: every step with its state, the way back to all settings, and the banner's Hide link. */
const WizardRail: FC<{
    setup: SetupState;
    current: string;
    onStep: (event: React.MouseEvent<HTMLButtonElement>) => void;
    onDismiss: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}> = ({ setup, current, onStep, onDismiss }) => (
    <nav className='jfmod-check-rail' aria-label='Setup steps'>
        <div className='jfmod-check-head'>
            <h2>Set up JellyfinMod</h2>
            <p>{setup.complete ? 'Everything required is done.' : 'Each step unlocks when the one before it passes its test.'}</p>
        </div>
        <ol className='jfmod-check-steps'>
            {STEPS.map((item, at) => {
                const itemState = setup.steps.find(step => step.id === item.id)?.status ?? 'pending';
                return (
                    <li key={item.id}>
                        <button type='button' className={`jfmod-step k-${stepKind(itemState)}`} data-step={item.id} aria-current={item.id === current ? 'true' : 'false'}
                            onClick={onStep}
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
                <a href='#/catalog/settings/setup' onClick={onDismiss}>Hide the Home banner</a>
            )}
        </div>
    </nav>
);

/** Whether the current step is done, what still blocks it, and Continue while a later step exists. */
const StepNotice: FC<{ state?: SetupStep; hasNext: boolean; onContinue: () => void }> = ({ state, hasNext, onContinue }) => {
    const done = state?.status === 'done';
    return (
        <div className='jfmod-notice jfmod-notice-ok' role='status' data-wizard-state={state?.status}>
            <i aria-hidden='true' />
            <span className='jfmod-notice-text'>
                <StatePill kind={done ? 'ok' : 'warn'}>{done ? 'This step is done.' : 'This step is not done yet.'}</StatePill>
                {!done && state?.reasons.length ? ' ' + state.reasons.map(blockerSentence).join(' ') : ''}
            </span>
            {hasNext && (
                <span className='jfmod-notice-action'>
                    <Button variant='contained' size='small' disabled={!done} data-wizard='continue'
                        onClick={onContinue}
                    >
                        Continue
                    </Button>
                </span>
            )}
        </div>
    );
};

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
    const next = STEPS[index + 1];
    const go = useCallback((id: string) => setParams({ step: id }, { replace: true }), [setParams]);
    // Each rail step carries its id in `data-step`, so one handler serves the whole rail.
    const openStep = useCallback((event: React.MouseEvent<HTMLButtonElement>) => go(event.currentTarget.dataset.step!), [go]);
    // Continue is only rendered while there is a next step.
    const continueToNext = useCallback(() => go(next.id), [go, next]);
    const dismiss = useCallback((event: React.MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault();
        void request(api!, 'POST', 'Setup/Dismiss').then(() => settings.refetch());
    }, [api, settings]);
    // Resume at the first incomplete step, then stay there: finishing it must not move the page by itself.
    useEffect(() => {
        if (setup && !params.get('step')) setParams({ step: firstOpen }, { replace: true });
    }, [setup, params, firstOpen, setParams]);

    let content: React.ReactNode;
    if (!user || health.isLoading) {
        content = <p className='jfmod-lead'>Loading…</p>;
    } else if (!isAdmin) {
        content = <p className='jfmod-lead'>Setting up JellyfinMod is for administrators.</p>;
    } else if (!available) {
        content = <p className='jfmod-lead'>The JellyfinMod plugin on this server has no setup wizard. Use the JellyfinMod page in the Dashboard.</p>;
    } else if (!settings.data || !api || !setup) {
        content = <p className='jfmod-lead'>{settings.isError ? 'Setup could not be loaded.' : 'Loading…'}</p>;
    } else {
        content = (
            <div className='jfmod-settings jfmod-check'>
                <WizardRail setup={setup} current={current} onStep={openStep} onDismiss={dismiss} />
                {/* focuscontainer-y: on the TV, Up and Down stay in the section instead of falling back into the rail
                    beside it (REVIEW-2026-09-24 S8-R2); Left and Right still cross between the two. */}
                <div className='jfmod-check-main focuscontainer-y'>
                    <StepNotice state={status(current)} hasNext={!!next} onContinue={continueToNext} />
                    {step.sections.map(({ id, Section }) => (
                        <div key={id} className='jfmod-wizardSection'>
                            <Section api={api} data={settings.data!} reload={settings.refetch} onGo={stayOnStep}
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
