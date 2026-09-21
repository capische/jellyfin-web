import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import { CollectionType } from '@jellyfin/sdk/lib/generated-client/models/collection-type';
import type { UserDto } from '@jellyfin/sdk/lib/generated-client/models/user-dto';
import type { ComponentProps } from 'react';

import { HomeSectionType } from 'constants/homeSectionType';
import { getAllSectionsToShow } from 'components/homesections/homesections';
import { loadRecordings } from 'components/homesections/sections/activeRecordings';
import { loadLibraryButtons } from 'components/homesections/sections/libraryButtons';
import { loadLibraryTiles } from 'components/homesections/sections/libraryTiles';
import { loadLiveTV } from 'components/homesections/sections/liveTv';
import { loadRecentlyAdded } from 'components/homesections/sections/recentlyAdded';
import { loadResume } from 'components/homesections/sections/resume';
import { renderComponent } from 'utils/reactUtils';

import HomeMergedRow from '../components/HomeMergedRow';

/**
 * Composes the JellyfinMod Home page's sections (P7.S6).
 *
 * Home is two merges over upstream's own sections (UX §7.3): Continue Watching and Next Up become one row, and
 * Latest Movies and Latest Shows become one. Everything else — library tiles, live TV, recordings, continue
 * listening, continue reading, and Latest for every other library — is rendered by upstream's own section
 * loaders, called directly.
 *
 * Composing here rather than inside `homesections.js` is what lets that upstream file go back to being upstream's:
 * it now differs from it by a single exported keyword, so the section *selection* rule stays in one place and
 * this module decides only what to do with each slot.
 */

interface ComposeOptions {
    /** The legacy ApiClient and the user settings store; neither publishes a type this fork can import. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    apiClient: any;
    user: UserDto;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    userSettings: any;
    userViews: BaseItemDto[];
}

/** Upstream renders every section inside one container with a numbered div per slot; so does this. */
const SECTION_CLASS = 'verticalSection';
const MOUNT_CLASS = 'jfmod-homeSectionMount';

const unmounts = new WeakMap<HTMLElement, () => void>();

const mountRow = (elem: HTMLElement, props: ComponentProps<typeof HomeMergedRow>) => {
    unmounts.get(elem)?.();
    elem.textContent = '';
    elem.classList.add(MOUNT_CLASS);
    const root = document.createElement('div');
    root.className = 'jfmod-homeRowRoot';
    elem.appendChild(root);
    unmounts.set(elem, renderComponent(HomeMergedRow, props, root));
};

const isContinueSection = (value: HomeSectionType) =>
    value === HomeSectionType.Resume || value === HomeSectionType.NextUp;

/**
 * Fills the container with the user's chosen Home sections, in their chosen order.
 *
 * The user's Home settings are honoured exactly as upstream honours them; the merges only change what is drawn
 * in a slot the user already asked for, never whether it appears.
 */
export const composeHomeSections = async (
    container: HTMLElement,
    { apiClient, user, userSettings, userViews }: ComposeOptions
): Promise<void> => {
    const selected: HomeSectionType[] = getAllSectionsToShow(userSettings);
    container.innerHTML = selected.map((_, index) => `<div class="${SECTION_CLASS} section${index}"></div>`).join('');
    container.classList.add('homeSectionsContainer');

    const options = { enableOverflow: true };
    const visibleViews = userViews.filter(view =>
        !(user.Configuration?.LatestItemsExcludes ?? []).includes(view.Id ?? ''));
    // Both halves of a merged row are drawn in whichever of the two slots the user put first; the other is left
    // empty rather than removed, so the section count and ordering still match what they configured.
    const firstContinueSlot = selected.findIndex(isContinueSection);

    await Promise.all(selected.map(async (section, index) => {
        const elem = container.querySelector<HTMLElement>(`.section${index}`);
        if (!elem) return;

        switch (section) {
            case HomeSectionType.Resume:
            case HomeSectionType.NextUp:
                if (index === firstContinueSlot) {
                    mountRow(elem, {
                        mode: 'continue',
                        includeResume: selected.includes(HomeSectionType.Resume),
                        includeNextUp: selected.includes(HomeSectionType.NextUp)
                    });
                }
                break;
            case HomeSectionType.LatestMedia: {
                mountRow(elem, {
                    mode: 'recent',
                    movieLibraryIds: visibleViews
                        .filter(view => view.CollectionType === CollectionType.Movies && view.Id)
                        .map(view => view.Id!),
                    seriesLibraryIds: visibleViews
                        .filter(view => view.CollectionType === CollectionType.Tvshows && view.Id)
                        .map(view => view.Id!)
                });
                // Every other library keeps its own Latest row, unmerged, underneath.
                const otherViews = visibleViews.filter(view =>
                    view.CollectionType !== CollectionType.Movies && view.CollectionType !== CollectionType.Tvshows);
                if (otherViews.length) {
                    const other = document.createElement('div');
                    elem.appendChild(other);
                    loadRecentlyAdded(other, apiClient, user, otherViews, options);
                }

                break;
            }
            case HomeSectionType.ResumeAudio:
                loadResume(elem, apiClient, 'HeaderContinueListening', 'Audio', userSettings, options);
                break;
            case HomeSectionType.ResumeBook:
                loadResume(elem, apiClient, 'HeaderContinueReading', 'Book', userSettings, options);
                break;
            case HomeSectionType.ActiveRecordings:
                loadRecordings(elem, true, apiClient, options);
                break;
            case HomeSectionType.LibraryButtons:
                loadLibraryButtons(elem, userViews);
                break;
            case HomeSectionType.SmallLibraryTiles:
                loadLibraryTiles(elem, userViews, options);
                break;
            case HomeSectionType.LiveTv:
                await loadLiveTV(elem, apiClient, user, options);
                break;
            default:
                elem.innerHTML = '';
        }
    }));
};

/** Unmounts the React rows this module owns. Upstream's own `destroySections` clears the rest. */
export const unmountHomeRows = (container: HTMLElement) => {
    for (const elem of container.querySelectorAll<HTMLElement>(`.${MOUNT_CLASS}`)) {
        unmounts.get(elem)?.();
        unmounts.delete(elem);
    }
};
