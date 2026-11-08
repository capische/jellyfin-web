import Box from '@mui/material/Box';
import { type Theme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import React, { StrictMode, useCallback, useEffect, useState, type FC } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

import LegacyAppLayout from 'apps/legacy/AppLayout';
import AppDrawer, { isDrawerPath } from 'apps/modern/components/drawers/AppDrawer';
import LibraryToolbar from 'apps/modern/features/libraries/components/LibraryToolbar';
import { LibraryProvider } from 'apps/modern/features/libraries/hooks/useLibrary';
import { isLibraryPath } from 'apps/modern/features/libraries/utils/path';
import AppBody from 'components/AppBody';
import CustomCss from 'components/CustomCss';
import OffsetAppBar from 'components/OffsetAppBar';
import ThemeCss from 'components/ThemeCss';
import layoutManager from 'components/layoutManager';
import { useApi } from 'hooks/useApi';
import { PUBLIC_PATHS } from 'components/router/appRouter';

import ModToolbar from './ModToolbar';
import ChromeTheme from './ChromeTheme';
import '../components/interFont.scss';
import '../components/modFont.scss';
import '../components/lightGlass.scss';
import './sharedChrome.scss';
import './motionChrome.scss';
import { useChromeScope } from './useChromeScope';
import { paintPreferencesPages } from '../integration/prefsPages';
import { Bar } from '../design/Bar';

/*
 * Upstream's modern overrides, for the modern layout only.
 *
 * Upstream only ever loads `AppOverrides.scss` with its modern layout, which the TV never runs. Among other things
 * it zeroes `.libraryPage`'s top padding, because the modern layout offsets pages with its own app bar. Imported
 * statically here it applied on the TV too, where the legacy `.skinHeader` is the bar and nothing else makes room
 * for it: every library page's toolbar — paging, view, sort and Filter — sat underneath the header, where the
 * D-pad could not reach it. Loading it the way upstream's own boot loads layout-specific styles keeps the TV
 * exactly on upstream's layout rules.
 */
if (layoutManager.modern) void import('apps/modern/AppOverrides.scss');

/**
 * The layout every screen renders inside in the JellyfinMod interface (P7.S2, §2.1).
 *
 * `ModAppRouter` substitutes this for upstream's app layout and keeps upstream's children, so the shell arrives
 * around every stock screen without a single upstream route or view being edited.
 *
 * The body is upstream's: the same drawer, the same library toolbar, the same `AppBody` that legacy views mount
 * into, the same theme and custom CSS. Only the top bar is the shell's own.
 *
 * The TV layout keeps upstream's legacy layout as its chrome (P7 TV shell): `.skinHeader`, `libraryMenu` and the
 * header tabs are what the D-pad already knows how to move through, and the mod's own screens — Home, search,
 * detail and the library grid — render inside it. The library grid brings its own toolbar into the page
 * (`LibraryGridPage`), and its MUI pop-ups get Back and D-pad handling from `dpadModals` (PHASE7 decision 13).
 */
const ModAppLayout: FC = () => {
    const [isDrawerActive, setIsDrawerActive] = useState(false);
    const { user } = useApi();
    const location = useLocation();

    const isMediumScreen = useMediaQuery((theme: Theme) => theme.breakpoints.up('md'));
    const isDrawerAvailable = isDrawerPath(location.pathname) && Boolean(user) && !isMediumScreen;
    const isDrawerOpen = isDrawerActive && isDrawerAvailable;

    const onToggleDrawer = useCallback(() => {
        setIsDrawerActive(current => !current);
    }, []);

    const chromeEnabled = Boolean(user) && !PUBLIC_PATHS.includes(location.pathname) && !location.pathname.startsWith('/catalog/settings');
    useChromeScope(chromeEnabled, ['/home', '/details'].includes(location.pathname), location.pathname === '/video');
    useEffect(() => paintPreferencesPages(), []);

    if (!layoutManager.modern) {
        return <ChromeTheme enabled={chromeEnabled}>
            <div className='jfmod-legacyDs'><LegacyAppLayout /></div>
            {chromeEnabled && location.pathname !== '/video' && <div className='jfmod-dsLegacyBar'><Bar onDrawer={() => { void import('scripts/libraryMenu').then(({ default: libraryMenu }) => libraryMenu.onHardwareMenuButtonClick()); }} /></div>}
        </ChromeTheme>;
    }

    return (
        <ChromeTheme enabled={chromeEnabled}>
            <LibraryProvider>
                <Box
                    className={location.pathname === '/home' && !location.search.includes('tab=1') ? 'jfmod-dsHomeShell' : undefined}
                    sx={{
                        position: 'relative',
                        display: 'flex',
                        flexDirection: 'column',
                        height: '100%'
                    }}
                >
                    <StrictMode>
                        {/* The native bar supplies the approved scrolled glass. */}
                        {location.pathname !== '/login' && <OffsetAppBar dense className={chromeEnabled ? 'jfmod-dsAppBar' : 'jfmod-homeAppBar'}>
                            <ModToolbar
                                isDrawerAvailable={!isMediumScreen && isDrawerAvailable}
                                isDrawerOpen={isDrawerOpen}
                                onDrawerButtonClick={onToggleDrawer}
                            />
                            {isLibraryPath(location.pathname) && !['/movies', '/tv'].includes(location.pathname) && <LibraryToolbar />}
                        </OffsetAppBar>}

                        {isDrawerAvailable && (
                            <AppDrawer
                                open={isDrawerOpen}
                                onClose={onToggleDrawer}
                                onOpen={onToggleDrawer}
                            />
                        )}
                    </StrictMode>

                    <Box
                        component='main'
                        sx={{
                            position: 'relative',
                            width: '100%',
                            flexGrow: 1
                        }}
                    >
                        <AppBody>
                            <Outlet />
                        </AppBody>
                    </Box>
                </Box>
                <ThemeCss />
                <CustomCss />
            </LibraryProvider>
        </ChromeTheme>
    );
};

export default ModAppLayout;
