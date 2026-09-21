import { clearBackdrop } from 'components/backdrop/backdrop';
import * as homeSections from 'components/homesections/homesections';
import focusManager from 'components/focusManager';
import layoutManager from 'components/layoutManager';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import * as userSettings from 'scripts/settings/userSettings';
import { renderComponent } from 'utils/reactUtils';

import HomeHero from '../components/HomeHero';
import { composeHomeSections, unmountHomeRows } from './homeSections';

/**
 * The JellyfinMod Home tab (P7.S6).
 *
 * Deliberately the same shape as upstream's `hometab` controller — `onResume`, `onPause`, `destroy` and a
 * `refreshed` flag — because the Home page mounts it exactly where upstream mounts that one. What differs is the
 * content: a hero above the user's own sections, with Continue Watching and Latest merged (UX §7.3).
 *
 * Owning the tab here is what lets `apps/legacy/controllers/hometab.js` go back to being upstream's file. The
 * hero used to be pushed into it from outside; now the page that wants a hero draws one.
 */
export default class ModHomeTab {
    /** Set by the Home page once the tab has loaded once, mirroring upstream's controller contract. */
    refreshed = false;

    private readonly view: HTMLElement;
    private sections: HTMLElement | null;
    private heroMount: HTMLElement | null = null;
    private unmountHero: (() => void) | null = null;
    private generation = 0;

    constructor(view: HTMLElement) {
        this.view = view;
        this.sections = view.querySelector<HTMLElement>('.sections');
    }

    onResume(options: { autoFocus?: boolean; refresh?: boolean } = {}) {
        this.mountHero();
        const sections = this.sections;
        if (!sections) return;

        if (!options.refresh) {
            void homeSections.resume(sections, options);
            return;
        }

        const current = ++this.generation;
        const apiClient = ServerConnections.currentApiClient();
        if (!apiClient) return;

        void apiClient.getCurrentUser()
            .then(async (user: { Id?: string }) => {
                const views = await apiClient.getUserViews({}, apiClient.getCurrentUserId());
                // A resume that was superseded while the user was being fetched must not draw over the newer one.
                if (current !== this.generation) return;
                await composeHomeSections(sections, {
                    apiClient,
                    user,
                    userSettings,
                    userViews: views.Items ?? []
                });
                if (current !== this.generation) return;
                if (options.autoFocus) focusManager.autoFocus(this.view);
            })
            .catch((error: unknown) => {
                console.error('[JellyfinMod] Home sections failed to load', error);
            });
    }

    onPause() {
        if (this.sections) homeSections.pause(this.sections);
    }

    destroy() {
        this.generation++;
        if (this.sections) {
            unmountHomeRows(this.sections);
            homeSections.destroySections(this.sections);
        }
        this.unmountHero?.();
        this.unmountHero = null;
        this.heroMount?.remove();
        this.heroMount = null;
        this.sections = null;
        clearBackdrop();
    }

    /** The hero sits above the sections, and only where there is room for it. */
    private mountHero() {
        if (this.heroMount || !this.sections) return;
        // The TV layout gets the hero too, but the shell has to be able to focus past it; that is why it is a
        // sibling of the sections rather than wrapping them.
        const mount = document.createElement('div');
        mount.className = 'jfmod-homeHeroMount';
        this.sections.before(mount);
        this.heroMount = mount;
        this.unmountHero = renderComponent(HomeHero, {}, mount);
        if (layoutManager.tv) mount.classList.add('jfmod-homeHeroTv');
    }
}
