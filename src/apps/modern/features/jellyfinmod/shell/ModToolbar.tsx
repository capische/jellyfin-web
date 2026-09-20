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

import { useModToolbarClass } from './useModToolbarClass';

import '../components/homeChrome.scss';

interface ModToolbarProps {
    isDrawerAvailable: boolean;
    isDrawerOpen: boolean;
    onDrawerButtonClick: (event: React.MouseEvent<HTMLElement>) => void;
}

/**
 * The JellyfinMod shell's top bar (P7.S2).
 *
 * Composed from upstream's own toolbar parts rather than rewritten: the same base toolbar, the same server and
 * library navigation, the same SyncPlay, remote-play and search buttons, and the same user menu, which already
 * carries Profile, Settings, the Dashboard, Quick Connect, Select server and Sign out. What the shell adds is the
 * accepted UX §7.3 presentation — transparent over Home's hero, solid once the page scrolls.
 *
 * Because this composition lives here, the stock entry's copy no longer has to carry the restyle, and the upstream
 * `AppToolbar` patch row can be retired once Stage B's Home lands (PHASE7 §3.2).
 */
const ModToolbar: FC<ModToolbarProps> = ({
    isDrawerAvailable,
    isDrawerOpen,
    onDrawerButtonClick
}) => {
    const location = useLocation();
    const homeClass = useModToolbarClass();

    // The video OSD does not show the standard toolbar.
    if (location.pathname === '/video') return null;

    const isBackButtonAvailable = window.NativeShell && appRouter.canGoBack(location.pathname);
    const isPublicPath = PUBLIC_PATHS.includes(location.pathname);

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
            className={'padded-left padded-right' + homeClass}
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
