import { Action } from 'history';
import { useEffect, type FC } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

import viewManager from 'components/viewManager/viewManager';
import globalize from 'lib/globalize';
import type { RestoreViewFailResponse } from 'types/viewManager';

/**
 * The JellyfinMod detail route (P7.S6, §2.2 "detail dispatcher").
 *
 * The mod owns `details` outright. What it renders is still upstream's detail view — the same template, the same
 * controller, the same playback, seasons, track selections, cast and context menu — but it is *composed here*
 * instead of inside upstream's file:
 *
 * - a catalog entry with no file (`entryId`) gets the mod's own controller on upstream's template, and upstream's
 *   controller never runs, because there is no native item for it to load;
 * - anything else gets the mod's augmentation and then upstream's controller, in that order, so the mod's
 *   `viewshow` listeners are registered first, exactly as the old in-file patch arranged;
 * - a person, album, book, photo or live TV item is "anything else": the mod augmentation finds no catalog entry
 *   for it, renders nothing, and the page is upstream's, which is what §2.2 means by the dispatcher falling
 *   through.
 *
 * That composition is why `apps/legacy/controllers/itemDetails/index.js` is back to its upstream text (§3.2). The
 * mod's own actions live in `NativeEntryDetails` and call the release picker at their own call site, so nothing
 * wraps `itemContextMenu.show` any more either; a monkey-patch would have been worse than the patch, because it
 * would not show up in a diff at all.
 *
 * ## Mirrors `components/viewManager/ViewManagerPage.tsx`
 *
 * Upstream's component hard-codes its controller import to `apps/legacy/controllers/${controller}`, so it cannot
 * load a controller that is composed rather than named. The load/restore logic below is upstream's, and the build
 * guard (`scripts/jellyfinmod-build/bootGuard.js`) fails the build if upstream's version changes, so the mirroring
 * cannot go quiet.
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
    const [{ default: initializeEntryDetails }, { default: initializeNativeEntryDetails }, { default: upstreamItemDetails }] =
        await Promise.all([
            import('../integration/entryDetails'),
            import('../integration/nativeEntryDetails'),
            import(/* webpackChunkName: "itemDetails" */ 'apps/legacy/controllers/itemDetails/index')
        ]);

    return function DetailController(view, params) {
        if (params.entryId) {
            initializeEntryDetails(view, params);
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
