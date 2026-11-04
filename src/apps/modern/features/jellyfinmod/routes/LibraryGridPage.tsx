import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind';
import { CollectionType } from '@jellyfin/sdk/lib/generated-client/models/collection-type';
import React, { type FC, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

import { LibraryToolbar } from '../design/LibraryToolbar';
import { LibraryItems } from '../design/LibraryItems';
import { Root } from '../design/Root';
import { LibraryTab } from 'types/libraryTab';
import PageTabContent from 'apps/modern/features/libraries/components/PageTabContent';
import viewsByKind from 'apps/modern/features/libraries/constants/views';
import { LibraryProvider } from 'apps/modern/features/libraries/hooks/useLibrary';
import Page from 'components/Page';
import useCurrentTab from 'hooks/useCurrentTab';
import { useItem } from 'hooks/useItem';
import globalize from 'lib/globalize';

import { useTvGridFocus } from '../hooks/useTvGridFocus';

import './libraryGridPage.scss';

/** Movies/Shows own the mockup grid and toolbar; the existing provider still owns data, settings and commands. */

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
            <Root><div ref={pageRef}>
                {/* A horizontal focus container: the toolbar's two ends sit a screen apart, and without it Right from
                    the view menu would pick the nearer card below over the buttons at the far end of the row. */}
                <div className='focuscontainer-x'>
                    <LibraryToolbar />
                </div>
                {[LibraryTab.Suggestions, LibraryTab.Upcoming, LibraryTab.Genres].includes(currentTab.viewType) ? <PageTabContent
                    key={`${currentTab.viewType}-${libraryId}`}
                    currentTab={currentTab}
                    parentId={libraryId}
                /> : <LibraryItems />}
            </div></Root>
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
