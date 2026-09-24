import Button from '@mui/material/Button';
import { useQuery } from '@tanstack/react-query';
import React, { type FC } from 'react';

import { useApi } from 'hooks/useApi';

import { usePluginHealth } from '../hooks/useEntries';
import { request, type SetupState } from '../settings/settingsApi';

/**
 * The first-run banner on the mod Home (P7.S10, PHASE7 default 14): administrators only, while setup is neither
 * complete nor dismissed. It links to the wizard and never redirects by itself.
 */
const SetupBanner: FC = () => {
    const { api, user } = useApi();
    const health = usePluginHealth();
    const enabled = !!api && !!user?.Policy?.IsAdministrator && health.data?.ok === true && health.data.capabilities.includes('setup');
    const setup = useQuery({
        queryKey: ['JellyfinMod', api?.basePath, 'SetupState'],
        queryFn: () => request<SetupState>(api!, 'GET', 'Setup/State'),
        enabled,
        retry: false,
        // The app persists its query cache across reloads; setup state must be read fresh or the banner lies.
        staleTime: 0,
        refetchOnMount: 'always'
    });
    if (!enabled || !setup.data || setup.data.complete || setup.data.dismissedAt) return null;
    const open = setup.data.steps.filter(step => !step.optional && step.status !== 'done').length;
    return (
        <div className='jfmod-settings padded-left padded-right'>
            <div className='jfmod-notice jfmod-notice-warn jfmod-setupBanner' role='status'>
                <i aria-hidden='true' />
                <span className='jfmod-notice-text'>JellyfinMod is not set up yet: {open} step(s) left before titles can be grabbed.</span>
                <span className='jfmod-notice-action'>
                    <Button variant='contained' size='small' href='#/catalog/settings/setup'>Set up</Button>
                    <Button size='small' onClick={() => { void request(api!, 'POST', 'Setup/Dismiss').then(() => setup.refetch()); }}>Dismiss</Button>
                </span>
            </div>
        </div>
    );
};

export default SetupBanner;
