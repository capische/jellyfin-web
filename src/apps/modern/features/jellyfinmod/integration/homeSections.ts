import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import { CollectionType } from '@jellyfin/sdk/lib/generated-client/models/collection-type';
import type { ComponentProps } from 'react';

import HomeMergedRow from '../components/HomeMergedRow';
import { renderComponent } from 'utils/reactUtils';

const unmounts = new WeakMap<HTMLElement, () => void>();

const mount = (elem: HTMLElement, props: ComponentProps<typeof HomeMergedRow>) => {
    unmounts.get(elem)?.();
    elem.textContent = '';
    const root = document.createElement('div');
    root.className = 'jfmod-homeRowRoot';
    elem.appendChild(root);
    unmounts.set(elem, renderComponent(HomeMergedRow, props, root));
};

export const mountContinueRow = (elem: HTMLElement, includeResume: boolean, includeNextUp: boolean) => {
    mount(elem, { mode: 'continue', includeResume, includeNextUp });
};

export const mountRecentRow = (elem: HTMLElement, views: BaseItemDto[]) => {
    mount(elem, {
        mode: 'recent',
        movieLibraryIds: views.filter(view => view.CollectionType === CollectionType.Movies && view.Id).map(view => view.Id!),
        seriesLibraryIds: views.filter(view => view.CollectionType === CollectionType.Tvshows && view.Id).map(view => view.Id!)
    });
};

export const unmountHomeRows = (container: HTMLElement) => {
    for (const elem of container.querySelectorAll<HTMLElement>('.jfmod-homeSectionMount')) {
        unmounts.get(elem)?.();
        unmounts.delete(elem);
    }
};
