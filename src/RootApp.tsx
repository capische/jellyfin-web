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

import RootAppRouter from 'RootAppRouter';

const supportsReactQueryDevtools = window.Proxy // '@tanstack/query-devtools' requires 'Proxy', which cannot be polyfilled for legacy browsers
    && !browser.tv; // Don't use devtools on the TV as the navigation is weird

const RootApp = () => (
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
                    <RootAppRouter />
                </WebConfigProvider>
            </UserSettingsProvider>
        </ApiProvider>
        {/* The devtools button takes d-pad focus, so it goes wherever the TV layout is in use */}
        {supportsReactQueryDevtools && !layoutManager.tv && (
            <ReactQueryDevtools initialIsOpen={false} />
        )}
    </PersistQueryClientProvider>
);

export default RootApp;
