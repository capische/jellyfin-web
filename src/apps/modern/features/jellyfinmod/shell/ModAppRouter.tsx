import { ThemeProvider } from '@mui/material/styles';
import React from 'react';
import { Outlet, RouterProvider, createHashRouter, useLocation, type RouteObject } from 'react-router-dom';

import { DASHBOARD_APP_PATHS, DASHBOARD_APP_ROUTES } from 'apps/dashboard/routes/routes';
import { APP_ROUTES as LEGACY_APP_ROUTES } from 'apps/legacy/routes/routes';
import { APP_ROUTES as MODERN_APP_ROUTES } from 'apps/modern/routes/routes';
import { WIZARD_APP_ROUTES } from 'apps/wizard/routes/routes';
import AppHeader from 'components/AppHeader';
import ConnectionRequired from 'components/ConnectionRequired';
import Backdrop from 'components/Backdrop';
import layoutManager from 'components/layoutManager';
import BangRedirect from 'components/router/BangRedirect';
import ErrorBoundary from 'components/router/ErrorBoundary';
import { history as sharedHistory } from 'RootAppRouter';
import type { RouterHistory } from 'components/router/routerHistory';
import appTheme from 'themes';
import { ThemeStorageManager } from 'themes/themeStorageManager';

import HomePage from '../routes/HomePage';
import DetailsPage from '../routes/DetailsPage';
import SearchPage from '../routes/SearchPage';

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

/**
 * Paths the JellyfinMod interface owns. Anything not listed falls through to the upstream screen.
 *
 * These are nested inside upstream's app table rather than declared beside it, so they inherit the shell, the
 * sign-in requirement and the error boundary instead of restating them. React Router ranks by path specificity
 * and breaks ties by declaration order, and these are declared first, so a mod path wins over the upstream route
 * of the same name.
 */
const MOD_ROUTES: RouteObject[] = [
    // Desktop and mobile only for now. The TV layout routes through upstream's legacy table, whose Home has
    // different chrome and different focus rules, and a d-pad surface that has not been driven on a real device
    // is not one to switch anybody onto. It joins this list with the TV shell.
    ...(layoutManager.modern ? [{ path: 'home', Component: HomePage }] : []),
    // Every layout: both upstream route tables resolve `search` to the same React component, so there is no
    // legacy-view or focus difference to hold this one back (P7.S6).
    { path: 'search', Component: SearchPage },
    // Every layout: `details` is a legacy view in both tables, and the mod route loads the same view through the
    // same view manager, so nothing about the page changes with the layout (P7.S6).
    { path: 'details', Component: DetailsPage }
];

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
        children: [
            { Component: ConnectionRequired, children: MOD_ROUTES, ErrorBoundary },
            ...table.children
        ]
    };
};

const router = createHashRouter([
    {
        element: <ModRootLayout />,
        children: [
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

/**
 * The shared history is pointed at this router, which is the one actually on screen.
 *
 * `appRouter` and `dialogHelper` both navigate through a single `history` that upstream creates alongside its own
 * router. Left alone, every navigation in this bundle would drive that router instead of this one: the address
 * bar would move, because both read the same window hash, and the mounted router would never hear about it. The
 * visible symptom is a control that appears to do nothing — signing in, for instance, authenticating and then
 * leaving the login form on screen until the page is reloaded by hand.
 *
 * Adopting rather than replacing keeps upstream's module-initialisation order exactly as it is. `appRouter` is
 * constructed at module scope and reads `history.location` while doing so, so the history has to exist before it
 * is imported — which is precisely what importing it from upstream's router guarantees.
 */
(sharedHistory as RouterHistory).adopt(router);

export const history = sharedHistory;

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
