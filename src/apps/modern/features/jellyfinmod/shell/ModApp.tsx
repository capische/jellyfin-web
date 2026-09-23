import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import React from 'react';

import QueryClientEventHandler from 'components/QueryClientEventHandler';
import layoutManager from 'components/layoutManager';
import { ApiProvider } from 'hooks/useApi';
import { UserSettingsProvider } from 'hooks/useUserSettings';
import { WebConfigProvider } from 'hooks/useWebConfig';
import browser from 'scripts/browser';
import { persister, queryClient } from 'utils/query/queryClient';

import ModAppRouter from './ModAppRouter';
import JellyfinModQueryClientEventHandler from '../integration/queryClientEventHandler';

/**
 * The JellyfinMod interface's application root (P7.S2).
 *
 * Deliberately the same provider stack as upstream's `RootApp`, in the same order, so every upstream screen the
 * shell embeds finds the context it expects. Only the router differs. Upstream's `RootApp` is left untouched and
 * still roots the stock entry; when an upstream merge changes the stack here, the build's boot guard is what
 * makes the divergence loud (PHASE7 §3.1, S1 evidence).
 */

// '@tanstack/query-devtools' requires 'Proxy', which cannot be polyfilled for legacy browsers, and the devtools
// button takes d-pad focus on the TV.
const supportsReactQueryDevtools = window.Proxy && !browser.tv;

const ModApp = () => (
    <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
            buster: __JF_BUILD_VERSION__,
            persister
        }}
    >
        <ApiProvider>
            <UserSettingsProvider>
                <WebConfigProvider>
                    <QueryClientEventHandler />
                    <JellyfinModQueryClientEventHandler />
                    <ModAppRouter />
                </WebConfigProvider>
            </UserSettingsProvider>
        </ApiProvider>
        {supportsReactQueryDevtools && !layoutManager.tv && (
            <ReactQueryDevtools initialIsOpen={false} />
        )}
    </PersistQueryClientProvider>
);

export default ModApp;
