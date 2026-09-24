import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind';
import { CollectionType } from '@jellyfin/sdk/lib/generated-client/models/collection-type';
import React, { type FC, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

import LibraryToolbar from 'apps/modern/features/libraries/components/LibraryToolbar';
import PageTabContent from 'apps/modern/features/libraries/components/PageTabContent';
import viewsByKind from 'apps/modern/features/libraries/constants/views';
import { LibraryProvider } from 'apps/modern/features/libraries/hooks/useLibrary';
import Page from 'components/Page';
import useCurrentTab from 'hooks/useCurrentTab';
import { useItem } from 'hooks/useItem';
import globalize from 'lib/globalize';

import { useTvGridFocus } from '../hooks/useTvGridFocus';

import './libraryGridPage.scss';

/**
 * Movies and TV browse in the legacy layouts — the TV above all — on the modern library grid (P7 TV shell,
 * PHASE7 decision 13).
 *
 * The modern layout reaches this grid through upstream's own `movies` and `tv` routes, whose `AppLayout` puts the
 * library toolbar in its app bar. The legacy layouts have no app bar: their chrome is upstream's `.skinHeader`, which
 * is what the remote already knows how to move through. So the mod router sends `movies` and `tv` here instead, and
 * this page is upstream's `LibraryPage` with the toolbar moved inside it, under the header:
 *
 * - the same `LibraryProvider` state, so view settings, filters (with the File and Due groups), sorting and paging
 *   are the same saved settings in every layout, and the catalog's combined browse comes with it;
 * - the same `LibraryToolbar` — view menu, count, Play All and Shuffle, Filter, Sort, view settings, paging;
 * - the same `PageTabContent`, so every tab upstream's modern grid has is here, which is a superset of the legacy
 *   tabs (Movies gains Studios and Playlists, Shows gains Collections and Playlists).
 *
 * What the remote needs on top of that is not in this file: MUI's pop-ups get D-pad and Back from `dpadModals`, and
 * focus placement, restore and rescue come from `useTvGridFocus`.
 */

const PAGE_IDS: Partial<Record<CollectionType, string>> = {
    [CollectionType.Movies]: 'moviesPage',
    [CollectionType.Tvshows]: 'tvshowsPage'
};

const PAGE_BACKDROPS: Partial<Record<CollectionType, BaseItemKind[]>> = {
    [CollectionType.Movies]: [BaseItemKind.Movie],
    [CollectionType.Tvshows]: [BaseItemKind.Series]
};

const FALLBACK_TITLES: Partial<Record<CollectionType, string>> = {
    [CollectionType.Movies]: 'Movies',
    [CollectionType.Tvshows]: 'Shows'
};

const collectionTypeFor = (pathname: string) => (pathname === '/tv' ? CollectionType.Tvshows : CollectionType.Movies);

const LibraryGrid: FC<{ type: CollectionType }> = ({ type }) => {
    const { libraryId, activeTab } = useCurrentTab();
    const views = viewsByKind[type];
    const currentTab = views[activeTab] ?? views[0];
    const { data: library } = useItem(libraryId || undefined);
    const pageRef = useRef<HTMLDivElement>(null);

    useTvGridFocus(pageRef);

    // The legacy header shows the page title; the library's own name says more than the view type does.
    const title = library?.Name ?? globalize.translate(FALLBACK_TITLES[type] ?? 'Movies');
    useEffect(() => {
        void import('scripts/libraryMenu').then(({ default: libraryMenu }) => libraryMenu.setTitle(title));
    }, [title]);

    return (
        <Page
            id={PAGE_IDS[type] ?? 'moviesPage'}
            title={title}
            className='mainAnimatedPage libraryPage jfmod-libraryGridPage'
            backDropType={PAGE_BACKDROPS[type]}
        >
            <div ref={pageRef} className='jfmod-libraryGrid'>
                {/* A horizontal focus container: the toolbar's two ends sit a screen apart, and without it Right from
                    the view menu would pick the nearer card below over the buttons at the far end of the row. */}
                <div className='jfmod-libraryGridToolbar focuscontainer-x'>
                    <LibraryToolbar />
                </div>
                <PageTabContent
                    key={`${currentTab.viewType}-${libraryId}`}
                    currentTab={currentTab}
                    parentId={libraryId}
                />
            </div>
        </Page>
    );
};

const LibraryGridPage: FC = () => {
    const { pathname } = useLocation();
    return (
        <LibraryProvider>
            <LibraryGrid type={collectionTypeFor(pathname)} />
        </LibraryProvider>
    );
};

export default LibraryGridPage;
