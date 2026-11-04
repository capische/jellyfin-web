import { useQuery } from '@tanstack/react-query';
import React, { type FC } from 'react';

import { useApi } from 'hooks/useApi';

import { usePluginHealth } from '../hooks/useEntries';
import { request } from '../settings/settingsApi';
import type { TraktExport } from '../settings/settingsSections';
import { TRAKT_PLUGIN_PAGE, TRAKT_POLL_MS, traktExportKey } from '../settings/TraktSection';

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
    return <div className='noticex' data-ds-notice='trakt' role='status'>
        <span className='tx'>Trakt stopped receiving watches from {names.join(', ')}: its sign-in expired and could not be renewed. Watches are kept and sent after you reconnect.</span>
        <a className='btn main focusable' href={TRAKT_PLUGIN_PAGE}>Reconnect Trakt</a>
        <a className='btn focusable' href='#/catalog/settings?section=trakt'>Trakt Settings</a>
    </div>;
};

export default TraktReconnectNotice;
