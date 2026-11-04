import Stack from '@mui/material/Stack';
import React, { type FC } from 'react';
import { useLocation } from 'react-router-dom';

import RemotePlayButton from 'apps/modern/components/AppToolbar/RemotePlayButton';
import SearchButton from 'apps/modern/components/AppToolbar/SearchButton';
import SyncPlayButton from 'apps/modern/components/AppToolbar/SyncPlayButton';
import UserViewNav from 'apps/modern/components/AppToolbar/userViews/UserViewNav';
import { appRouter, PUBLIC_PATHS } from 'components/router/appRouter';
import BaseToolbar from 'components/toolbar/AppToolbar';
import ServerButton from 'components/toolbar/ServerButton';

import { Bar } from '../design/Bar';

import '../components/homeChrome.scss';

interface ModToolbarProps {
    isDrawerAvailable: boolean;
    isDrawerOpen: boolean;
    onDrawerButtonClick: (event: React.MouseEvent<HTMLElement>) => void;
}

/** Signed-in mod routes own the mockup bar; excluded routes keep the original toolbar. */
const ModToolbar: FC<ModToolbarProps> = ({
    isDrawerAvailable,
    isDrawerOpen,
    onDrawerButtonClick
}) => {
    const location = useLocation();

    // The video OSD does not show the standard toolbar.
    if (location.pathname === '/video') return null;

    const isBackButtonAvailable = window.NativeShell && appRouter.canGoBack(location.pathname);
    const isPublicPath = PUBLIC_PATHS.includes(location.pathname);
    const chromeEnabled = !isPublicPath && !location.pathname.startsWith('/catalog/settings');

    if (chromeEnabled) return <Bar onDrawer={onDrawerButtonClick} />;

    return (
        <BaseToolbar
            buttons={!isPublicPath && (
                <>
                    <SyncPlayButton />
                    <RemotePlayButton />
                    <SearchButton />
                </>
            )}
            isDrawerAvailable={isDrawerAvailable}
            isDrawerOpen={isDrawerOpen}
            onDrawerButtonClick={onDrawerButtonClick}
            isBackButtonAvailable={isBackButtonAvailable}
            isUserMenuAvailable={!isPublicPath}
            className='padded-left padded-right'
        >
            {!isDrawerAvailable && (
                <Stack
                    direction='row'
                    spacing={0.5}
                >
                    <ServerButton />

                    {!isPublicPath && (
                        <UserViewNav />
                    )}
                </Stack>
            )}
        </BaseToolbar>
    );
};

export default ModToolbar;
