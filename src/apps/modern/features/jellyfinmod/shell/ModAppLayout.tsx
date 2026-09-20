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

import 'apps/modern/AppOverrides.scss';

/**
 * The layout every screen renders inside in the JellyfinMod interface (P7.S2, §2.1).
 *
 * `ModAppRouter` substitutes this for upstream's app layout and keeps upstream's children, so the shell arrives
 * around every stock screen without a single upstream route or view being edited.
 *
 * The body is upstream's: the same drawer, the same library toolbar, the same `AppBody` that legacy views mount
 * into, the same theme and custom CSS. Only the top bar is the shell's own.
 *
 * The TV layout still falls through to upstream's legacy layout, which uses `.skinHeader` and `libraryMenu` for
 * navigation rather than a React toolbar. Bringing the shell to the TV is its own slice, because a shell that has
 * not been driven with a D-pad on a real device is not a shell that can be trusted there.
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
