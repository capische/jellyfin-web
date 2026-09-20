import { ThemeProvider } from '@mui/material/styles';
import React from 'react';
import { Outlet, RouterProvider, createHashRouter, useLocation, type RouteObject } from 'react-router-dom';

import { DASHBOARD_APP_PATHS, DASHBOARD_APP_ROUTES } from 'apps/dashboard/routes/routes';
import { APP_ROUTES as LEGACY_APP_ROUTES } from 'apps/legacy/routes/routes';
import { APP_ROUTES as MODERN_APP_ROUTES } from 'apps/modern/routes/routes';
import { WIZARD_APP_ROUTES } from 'apps/wizard/routes/routes';
import AppHeader from 'components/AppHeader';
import Backdrop from 'components/Backdrop';
import layoutManager from 'components/layoutManager';
import BangRedirect from 'components/router/BangRedirect';
import { createRouterHistory } from 'components/router/routerHistory';
import appTheme from 'themes';
import { ThemeStorageManager } from 'themes/themeStorageManager';

import ModAppLayout from './ModAppLayout';

/**
 * The JellyfinMod interface's router (P7.S2, §2.1).
 *
 * It is upstream's `RootAppRouter` with two differences, and no upstream file is edited to get them:
 *
 * 1. The app route table's **layout** is replaced with the JellyfinMod shell. Upstream's table is a single route
 *    object at `/*` whose children hold every screen; taking those children and giving them a different layout
 *    reuses the whole tree — `ConnectionRequired` groups, async and legacy routes, the video page, the fallback —
 *    so every stock screen keeps working and gains the shell around it.
 * 2. Mod-owned routes are added as siblings, so they replace the upstream screen of the same path.
 *
 * The Dashboard and the server wizard keep their own layouts and are imported untouched: both already carry their
 * own full navigation, and wrapping them would give the page two sets of chrome.
 */

/** Paths the JellyfinMod interface owns. Anything not listed falls through to the upstream screen. */
const MOD_ROUTES: RouteObject[] = [];

/**
 * Upstream's app table is `[{ path: '/*', children: [...] }]`. We depend on that shape, so say so loudly rather
 * than rendering a blank page if an upstream release changes it.
 */
const embedUpstreamApp = (routes: RouteObject[]): RouteObject => {
    const [table, ...rest] = routes;
    if (!table || rest.length > 0 || table.path !== '/*' || !table.children?.length) {
        throw new Error(
            '[JellyfinMod] The upstream app route table is not the single "/*" route this build expects. '
            + 'Re-check apps/{modern,legacy}/routes/routes.tsx after the upstream merge (PHASE7 §3.4).'
        );
    }

    // Upstream reaches its layout through `lazy` (modern) or `Component` (legacy); both are replaced here, and
    // the children are reused exactly as upstream declares them.
    return {
        path: table.path,
        Component: ModAppLayout,
        children: table.children
    };
};

const router = createHashRouter([
    {
        element: <ModRootLayout />,
        children: [
            // Listed first as a statement of intent. React Router matches by path specificity rather than by
            // order, so a static mod path outranks the upstream table's "/*" wherever both could match.
            ...MOD_ROUTES,
            embedUpstreamApp(layoutManager.modern ? MODERN_APP_ROUTES : LEGACY_APP_ROUTES),
            ...DASHBOARD_APP_ROUTES,
            ...WIZARD_APP_ROUTES,
            {
                path: '!/*',
                Component: BangRedirect
            }
        ]
    }
]);

export const history = createRouterHistory(router);

export default function ModAppRouter() {
    return <RouterProvider router={router} />;
}

/**
 * The outermost layout, mirroring upstream's `RootAppLayout`.
 *
 * `AppHeader` renders the legacy `.skinHeader`, `.mainDrawer` and `.mainDrawerHandle` elements, which must exist
 * in the DOM in every layout because legacy views address them directly; `isHidden` only sets `display: none`.
 * The hiding rule is upstream's for now — the legacy layout has no toolbar of its own, so hiding its header before
 * the shell carries navigation would leave the TV layout with no way to move. The shell takes that over in the
 * next slice, and then this is `isHidden` unconditionally.
 */
function ModRootLayout() {
    const location = useLocation();
    const isNewLayoutPath = Object.values(DASHBOARD_APP_PATHS)
        .some(path => location.pathname.startsWith(`/${path}`));

    return (
        <ThemeProvider
            theme={appTheme}
            defaultMode='dark'
            storageManager={ThemeStorageManager}
        >
            <Backdrop />
            <AppHeader isHidden={layoutManager.modern || isNewLayoutPath} />

            <Outlet />
        </ThemeProvider>
    );
}
