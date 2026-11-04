import { Action } from 'history';
import { useEffect, type FC } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

import viewManager from 'components/viewManager/viewManager';
import globalize from 'lib/globalize';
import type { RestoreViewFailResponse } from 'types/viewManager';

/**
 * Mod detail dispatcher. Movie, series, season, episode and person pages paint the approved design's React markup.
 * The original template remains a hidden controller host: upstream owns native data, commands and track/playback state;
 * entry and discovery controllers retain their existing data/action paths. Other native types keep upstream presentation.
 *
 * ViewManagerPage's load/restore lifecycle is mirrored because its hard-coded controller import cannot compose controllers.
 * The build guard checks that lifecycle on upstream updates. Controllers stay lazy: their libraryMenu dependency needs the
 * shell header to exist before initialization.
 */

/** viewManager calls this with `new`; it is a plain function, and so is upstream's own controller. */
type ControllerFactory = (view: HTMLElement, params: Record<string, string>) => void;

/*
 * Everything this route runs is imported on demand, never at module scope.
 *
 * `ModAppRouter` imports this file while the app is still booting, and the modules below reach `libraryMenu`,
 * which reads `.skinHeader` out of the document as it initialises. Pulling them in eagerly ran that before the
 * shell had rendered a header, and the whole bundle died on `null.querySelector` before the first screen —
 * which is exactly what upstream's own route table avoids by loading every legacy controller lazily.
 */
const loadController = async (): Promise<ControllerFactory> => {
    const [{ default: initializeEntryDetails }, { default: initializeNativeEntryDetails }, { default: upstreamItemDetails },
        { default: initializeTmdbDetails }] = await Promise.all([
        import('../integration/entryDetails'),
        import('../integration/nativeEntryDetails'),
        import(/* webpackChunkName: "itemDetails" */ 'apps/legacy/controllers/itemDetails/index'),
        import('../integration/tmdbDetails')
    ]);

    return function DetailController(view, params) {
        if (params.entryId) {
            initializeEntryDetails(view, params);
            return;
        }

        // A TMDB title that is not in the library (TM2): the mod's own controller on the same template, like a file-less entry.
        if (params.tmdbId) {
            initializeTmdbDetails(view, params);
            return;
        }

        // The mod first, so its `viewshow` listeners are registered before upstream's, exactly as the old
        // in-file patch arranged by sitting at the top of upstream's function.
        initializeNativeEntryDetails(view, params);
        // Upstream's controller is a side-effect constructor, and the view manager itself calls it with
        // `new`; calling it the same way here is what keeps its behaviour identical.
        // eslint-disable-next-line sonarjs/constructor-for-side-effects
        new (upstreamItemDetails as unknown as new (v: HTMLElement, p: unknown) => void)(view, params);
    };
};

const loadTemplate = () => import(/* webpackChunkName: "itemDetails" */ 'apps/legacy/controllers/itemDetails/index.html')
    .then(html => globalize.translateHtml(html));

const DetailsPage: FC = () => {
    const location = useLocation();
    const navigationType = useNavigationType();

    useEffect(() => {
        const viewOptions = {
            url: location.pathname + location.search,
            state: location.state,
            autoFocus: false,
            fullscreen: false,
            options: {
                supportsThemeMedia: false,
                enableMediaControl: true
            }
        };

        const load = async () => {
            // Both resolved before the view is loaded, because the view manager calls the factory synchronously
            // on `viewinit` and the listeners it registers have to exist before `viewshow` fires.
            const [controllerFactory, view] = await Promise.all([loadController(), loadTemplate()]);
            viewManager.loadView({ ...viewOptions, controllerFactory, view });
        };

        if (navigationType !== Action.Pop) {
            void load();
            return;
        }

        viewManager.tryRestoreView(viewOptions)
            .catch(async (result?: RestoreViewFailResponse) => {
                if (!result?.cancelled) await load();
            });
    // location.state and navigationType are excluded for the reason upstream excludes them: a dialog updates
    // state while the view stays the same.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.pathname, location.search]);

    return null;
};

export default DetailsPage;
