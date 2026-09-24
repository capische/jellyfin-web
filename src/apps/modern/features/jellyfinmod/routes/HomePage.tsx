import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind';
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Action } from 'history';
import { useNavigationType, useSearchParams } from 'react-router-dom';

import globalize from 'lib/globalize';
import { clearBackdrop } from 'components/backdrop/backdrop';
import layoutManager from 'components/layoutManager';
import Page from 'components/Page';
import { EventType } from 'constants/eventType';
import Events from 'utils/events';

import 'elements/emby-tabs/emby-tabs';
import 'elements/emby-button/emby-button';
import 'elements/emby-scroller/emby-scroller';
import SetupBanner from '../components/SetupBanner';

type OnResumeOptions = {
    autoFocus?: boolean;
    refresh?: boolean;
    restoreFocus?: boolean;
};

type ControllerProps = {
    onResume: (
        options: OnResumeOptions
    ) => void;
    refreshed: boolean;
    onPause: () => void;
    destroy: () => void;
};

/**
 * The JellyfinMod Home page (P7.S6).
 *
 * Upstream's Home shell, tab for tab: the same page chrome, the same Home and Favorites tabs, the same tab
 * manager. Only the first tab's controller differs — it is the mod's, which draws the hero and the merged rows —
 * and Favorites still mounts upstream's own controller, because there is nothing the mod wants to change about it.
 *
 * Staying this close to upstream is the point. Home is the screen most likely to drift, and a page that shares
 * upstream's structure is one an upstream change can still be read against.
 */
const Home = () => {
    const [ searchParams ] = useSearchParams();
    // A Back navigation returns the TV's focus to the card it left from (the mod Home tab remembers it).
    const isReturning = useNavigationType() === Action.Pop;
    const initialTabIndex = parseInt(searchParams.get('tab') ?? '0', 10);

    const libraryMenu = useMemo(async () => ((await import('scripts/libraryMenu')).default), []);
    const mainTabsManager = useMemo(() => import('components/maintabsmanager'), []);
    const tabController = useRef<ControllerProps | null>();
    const tabControllers = useMemo<ControllerProps[]>(() => [], []);

    const documentRef = useRef<Document>(document);
    const element = useRef<HTMLDivElement>(null);

    const setTitle = async () => {
        (await libraryMenu).setTitle(null);
    };

    const getTabs = () => {
        return [{
            name: globalize.translate('Home')
        }, {
            name: globalize.translate('Favorites')
        }];
    };

    const getTabContainers = () => {
        return element.current?.querySelectorAll('.tabContent');
    };

    const getTabController = useCallback((index: number) => {
        if (index == null) {
            throw new Error('index cannot be null');
        }

        const existing = tabControllers[index];
        if (existing) return Promise.resolve(existing);

        const tabContent = element.current?.querySelector(".tabContent[data-index='" + index + "']") as HTMLElement;

        // Slot 0 is the mod's own tab; slot 1 is upstream's Favorites, imported unchanged. They are built
        // separately because their constructors differ — upstream's shell hid that behind a dynamic import.
        const built: Promise<ControllerProps> = index === 0 ?
            import('../integration/homeTab')
                .then(({ default: ModHomeTab }) => new ModHomeTab(tabContent) as unknown as ControllerProps) :
            import(/* webpackChunkName: "[request]" */ 'apps/legacy/controllers/favorites')
                .then(({ default: FavoritesTab }) => new FavoritesTab(tabContent, null) as unknown as ControllerProps);

        return built.then(controller => {
            tabControllers[index] = controller;
            return controller;
        });
    }, [ tabControllers ]);

    const loadTab = useCallback((index: number, previousIndex: number | null) => {
        getTabController(index).then((controller) => {
            const refresh = !controller.refreshed;

            controller.onResume({
                autoFocus: previousIndex == null && layoutManager.tv,
                refresh: refresh,
                restoreFocus: isReturning
            });

            controller.refreshed = true;
            tabController.current = controller;
        }).catch(err => {
            console.error('[Home] failed to get tab controller', err);
        });
    }, [ getTabController, isReturning ]);

    const onTabChange = useCallback((e: { detail: { selectedTabIndex: string; previousIndex: number | null }; }) => {
        const newIndex = parseInt(e.detail.selectedTabIndex, 10);
        const previousIndex = e.detail.previousIndex;

        const previousTabController = previousIndex == null ? null : tabControllers[previousIndex];
        if (previousTabController?.onPause) {
            previousTabController.onPause();
        }

        loadTab(newIndex, previousIndex);
    }, [ loadTab, tabControllers ]);

    const onSetTabs = useCallback(async () => {
        (await mainTabsManager).setTabs(element.current, initialTabIndex, getTabs, getTabContainers, null, onTabChange, false);
    }, [ initialTabIndex, mainTabsManager, onTabChange ]);

    const onResume = useCallback(async () => {
        void setTitle();
        clearBackdrop();

        const currentTabController = tabController.current;

        if (!currentTabController) {
            (await mainTabsManager).selectedTabIndex(initialTabIndex);
        } else if (currentTabController?.onResume) {
            currentTabController.onResume({});
        }
        (documentRef.current.querySelector('.skinHeader') as HTMLDivElement).classList.add('noHomeButtonHeader');
    }, [ initialTabIndex, mainTabsManager ]);

    const onPause = useCallback(() => {
        const currentTabController = tabController.current;
        if (currentTabController?.onPause) {
            currentTabController.onPause();
        }
        (documentRef.current.querySelector('.skinHeader') as HTMLDivElement).classList.remove('noHomeButtonHeader');
    }, []);

    const renderHome = useCallback(() => {
        void onSetTabs();
        void onResume();
    }, [ onResume, onSetTabs ]);

    useEffect(() => {
        if (documentRef.current?.querySelector('.headerTabs')) {
            renderHome();
        }

        return () => {
            onPause();
        };
    }, [onPause, renderHome]);

    useEffect(() => {
        const doc = documentRef.current;
        if (doc) Events.on(doc, EventType.HEADER_RENDERED, renderHome);

        return () => {
            if (doc) Events.off(doc, EventType.HEADER_RENDERED, renderHome);
        };
    }, [ renderHome ]);

    return (
        <div ref={element}>
            <Page
                id='indexPage'
                className='mainAnimatedPage homePage libraryPage allLibraryPage pageWithAbsoluteTabs withTabs'
                isBackButtonEnabled={false}
                backDropType={[
                    BaseItemKind.Movie,
                    BaseItemKind.Series,
                    BaseItemKind.Book
                ]}
            >
                <div className='tabContent pageTabContent' id='homeTab' data-index='0'>
                    <SetupBanner />
                    <div className='sections'></div>
                </div>
                <div className='tabContent pageTabContent' id='favoritesTab' data-index='1'>
                    <div className='sections'></div>
                </div>
            </Page>
        </div>
    );
};

export default Home;
