import Button from '@mui/material/Button';
import { useQuery } from '@tanstack/react-query';
import React, { type FC } from 'react';

import { useApi } from 'hooks/useApi';

import { usePluginHealth } from '../hooks/useEntries';
import { request } from '../settings/settingsApi';
import type { TraktExport } from '../settings/settingsSections';
import { TRAKT_PLUGIN_PAGE, TRAKT_POLL_MS, traktExportKey } from '../settings/TraktSection';

// The notice is drawn with the settings vocabulary (notice, buttons), like the setup banner.
import '../settings/settings.scss';
import './traktNotice.scss';

/**
 * The Home notice for administrators while a Trakt account needs reconnecting (Phase 13, Q5): the Trakt plugin's sign-in
 * could not be renewed, so it sends nothing for that user until it is authorized again. Under the hero, in the setup
 * banner's look. Nothing shows for a transient outage, which recovers by itself, nor for anyone but an administrator.
 */
const TraktReconnectNotice: FC = () => {
    const { api, user } = useApi();
    const health = usePluginHealth();
    const enabled = !!api && !!user?.Policy?.IsAdministrator && health.data?.ok === true && health.data.capabilities.includes('trakt.export');
    // Read again every minute while Home is shown (Codex review P2-5): a sign-in can fail while a TV sits on Home.
    const status = useQuery({
        queryKey: api ? traktExportKey(api) : ['JellyfinMod', 'TraktExport'],
        queryFn: () => request<TraktExport>(api!, 'GET', 'Trakt/Export'),
        enabled,
        retry: false,
        staleTime: 0,
        refetchOnMount: 'always',
        refetchInterval: TRAKT_POLL_MS
    });
    const names = status.data?.installed ? status.data.users.filter(entry => entry.state === 'reconnect').map(entry => entry.name) : [];
    if (!enabled || !names.length) return null;
    return (
        <div className='jfmod-settings padded-left padded-right jfmod-traktNotice'>
            <div className='jfmod-notice jfmod-notice-warn jfmod-setupBanner' role='status'>
                <i aria-hidden='true' />
                <span className='jfmod-notice-text'>
                    Trakt stopped receiving watches from {names.join(', ')}: its sign-in expired and could not be renewed. Watches are kept and
                    sent after you reconnect.
                </span>
                <span className='jfmod-notice-action'>
                    <Button variant='contained' href={TRAKT_PLUGIN_PAGE}>Reconnect Trakt</Button>
                    <Button variant='contained' color='inherit' href='#/catalog/settings?section=trakt'>Details</Button>
                </span>
            </div>
        </div>
    );
};

export default TraktReconnectNotice;
