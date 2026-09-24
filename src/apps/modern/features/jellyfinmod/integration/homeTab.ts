import { clearBackdrop } from 'components/backdrop/backdrop';
import * as homeSections from 'components/homesections/homesections';
import focusManager from 'components/focusManager';
import layoutManager from 'components/layoutManager';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import * as userSettings from 'scripts/settings/userSettings';
import { renderComponent } from 'utils/reactUtils';

import HomeHero from '../components/HomeHero';
import { attachLegacyTopbar } from './homeChrome';
import { composeHomeSections, unmountHomeRows } from './homeSections';

/** How long the TV's first focus waits for the hero before falling back to the first row. */
const HERO_FOCUS_WAIT_MS = 3000;
const HERO_FOCUS_POLL_MS = 100;

/** Where the D-pad was when the user left Home: the section slot, the card's identity, and its position. */
interface FocusMemory {
    section: string;
    selector: string | null;
    index: number;
}

/**
 * The TV's place on Home, kept across the page being unmounted.
 *
 * Upstream's legacy Home is a cached view, so Back restores it with the focused card still focused. The mod's Home
 * is a React route that renders afresh, so it has to remember the place itself — "focus is state" (UX Principle 3).
 * Only a Back navigation consumes it; arriving at Home any other way starts at the top, as upstream does.
 */
let rememberedFocus: FocusMemory | null = null;

const IDENTITY = /^[\w-]+$/;

const rememberFocus = (view: HTMLElement, active: HTMLElement | null) => {
    rememberedFocus = null;
    if (!active || !view.contains(active)) return;
    // The slot itself, not a section a merged row draws inside it.
    const section = active.closest<HTMLElement>('.homeSectionsContainer > .verticalSection');
    const slot = section ? [...section.classList].find(name => /^section\d+$/.test(name)) : undefined;
    if (!section || !slot) return;
    const id = active.getAttribute('data-id') ?? '';
    const tmdbId = active.getAttribute('data-jfmod-tmdb-id') ?? '';
    let selector: string | null = null;
    if (IDENTITY.test(id)) selector = `[data-id="${id}"]`;
    else if (IDENTITY.test(tmdbId)) selector = `[data-jfmod-tmdb-id="${tmdbId}"]`;
    const focusables: HTMLElement[] = focusManager.getFocusableElements(section);
    rememberedFocus = { section: slot, selector, index: focusables.indexOf(active) };
};

/** The remembered element, once its row has rendered; the same position in that row if the card itself is gone. */
const findRemembered = (view: HTMLElement, memory: FocusMemory): HTMLElement | null => {
    const section = view.querySelector<HTMLElement>('.homeSectionsContainer > .verticalSection.' + memory.section);
    if (!section) return null;
    const focusables: HTMLElement[] = focusManager.getFocusableElements(section);
    if (!focusables.length) return null;
    const exact = memory.selector ? section.querySelector<HTMLElement>(memory.selector) : null;
    if (exact && focusables.includes(exact)) return exact;
    return memory.index >= 0 ? focusables[Math.min(memory.index, focusables.length - 1)] : null;
};

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
    private detachTopbar: (() => void) | null = null;
    /**
     * The last element focused inside Home. Read at pause rather than `document.activeElement`, because by the time
     * the route unmounts the page the next screen may already have taken focus.
     */
    private lastFocused: HTMLElement | null = null;
    private readonly onFocusIn = (event: FocusEvent) => {
        this.lastFocused = event.target instanceof HTMLElement ? event.target : null;
    };

    constructor(view: HTMLElement) {
        this.view = view;
        this.sections = view.querySelector<HTMLElement>('.sections');
        if (layoutManager.tv) view.addEventListener('focusin', this.onFocusIn);
    }

    onResume(options: { autoFocus?: boolean; refresh?: boolean; restoreFocus?: boolean } = {}) {
        this.mountHero();
        // The TV layout's navigation is upstream's legacy header, not the shell's React toolbar, so Home's
        // transparent bar is applied to that header here. Desktop and mobile get it from the shell's toolbar.
        if (!layoutManager.modern && !this.detachTopbar) this.detachTopbar = attachLegacyTopbar();
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
                if (!options.autoFocus) return;
                const memory = options.restoreFocus ? rememberedFocus : null;
                rememberedFocus = null;
                this.autoFocusWhenReady(current, memory);
            })
            .catch((error: unknown) => {
                console.error('[JellyfinMod] Home sections failed to load', error);
            });
    }

    onPause() {
        if (layoutManager.tv) rememberFocus(this.view, this.lastFocused);
        this.detachTopbar?.();
        this.detachTopbar = null;
        if (this.sections) homeSections.pause(this.sections);
    }

    destroy() {
        this.generation++;
        this.view.removeEventListener('focusin', this.onFocusIn);
        this.lastFocused = null;
        this.detachTopbar?.();
        this.detachTopbar = null;
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

    /**
     * The first focus on the TV, once there is something at the top to take it (UX §13 rules 1–2).
     *
     * The hero and the merged rows are React and fetch their own data, so they arrive after the sections have been
     * composed. Focusing straight away put the ring on the first upstream row (My Media) and then drew the hero and
     * Continue Watching *above* it, which is exactly the "nothing arrives above the focus ring" rule broken. So the
     * focus waits, briefly, for the hero's Play; with no hero it falls back to upstream's first-focusable rule, and
     * a user who has already moved is never pulled back.
     *
     * Coming back to Home, the target is instead the card the user left from, once its row has rendered.
     */
    private autoFocusWhenReady(generation: number, memory: FocusMemory | null, waited = 0) {
        if (generation !== this.generation) return;
        const active = document.activeElement;
        if (active && active !== document.body && this.view.contains(active)) return;
        const target = memory ?
            findRemembered(this.view, memory) :
            this.heroMount?.querySelector<HTMLElement>('.jfmod-homeHeroActions .emby-button');
        if (target) {
            focusManager.focus(target);
            return;
        }
        if (waited < HERO_FOCUS_WAIT_MS) {
            setTimeout(() => this.autoFocusWhenReady(generation, memory, waited + HERO_FOCUS_POLL_MS), HERO_FOCUS_POLL_MS);
            return;
        }
        focusManager.autoFocus(this.view);
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
