import Box from '@mui/material/Box';
import { type Theme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import React, { StrictMode, useCallback, useState, type FC } from 'react';
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

import ModToolbar from './ModToolbar';

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
 * detail and the catalog grid — render inside it. The React toolbar is a mouse-and-touch surface; putting MUI menus
 * in front of a remote would trade a proven Back and focus model for an unproven one.
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

    if (!layoutManager.modern) return <LegacyAppLayout />;

    return (
        <LibraryProvider>
            <Box
                sx={{
                    position: 'relative',
                    display: 'flex',
                    flexDirection: 'column',
                    height: '100%'
                }}
            >
                <StrictMode>
                    <OffsetAppBar dense>
                        <ModToolbar
                            isDrawerAvailable={!isMediumScreen && isDrawerAvailable}
                            isDrawerOpen={isDrawerOpen}
                            onDrawerButtonClick={onToggleDrawer}
                        />
                        {isLibraryPath(location.pathname) && <LibraryToolbar />}
                    </OffsetAppBar>

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
    );
};

export default ModAppLayout;
