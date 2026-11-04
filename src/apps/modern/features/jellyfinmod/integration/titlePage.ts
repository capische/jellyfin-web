import { renderComponent } from 'utils/reactUtils';
import { TitlePage, clearTitleSlots } from '../design/TitlePage';
import { setTitleSources } from '../design/titleModel';
import type { BaseItemDto, MediaSourceInfo } from '@jellyfin/sdk/lib/generated-client';

const visits = new WeakMap<HTMLElement, { type: string; art: string; item?: BaseItemDto; host: HTMLElement; unmount: () => void; cleanup?: () => void }>();

/** Keep the legacy template as the controller's private state; React owns the painted page. */
export const titlePage = (view: HTMLElement, type: string, image?: string, sources?: MediaSourceInfo[], item?: BaseItemDto) => {
    if (!['Movie', 'Series', 'Season', 'Episode', 'Person'].includes(type)) return;
    if (sources) setTitleSources(view, sources);
    view.classList.add('jfmod-titlePage', 'jfmod-dsTitle', 'jfmod-dsPage');
    // The bar lights the library this title belongs to.
    let library = '';
    if (type === 'Movie') library = '/movies';
    else if (type !== 'Person') library = '/tv';
    window.dispatchEvent(new CustomEvent('ds-bar-library', { detail: library }));
    const previous = visits.get(view);
    if (previous) {
        if (image !== undefined) previous.art = image;
        if (item) previous.item = item;
        previous.type = type;
        view.dispatchEvent(new CustomEvent('ds-title-update', { detail: { type, art: previous.art, item: previous.item } }));
        return;
    }
    const host = document.createElement('div');
    host.className = 'jfmod-dsTitleHost';
    view.appendChild(host);
    const unmount = renderComponent(TitlePage, { view, type, art: image ?? '', item }, host);
    visits.set(view, { type, art: image ?? '', item, host, unmount });
    const hide = () => {
        clearTitleSlots(view);
        unmount();
        host.remove();
        visits.delete(view);
        view.classList.remove('jfmod-dsTitle', 'jfmod-dsPage');
        view.removeEventListener('viewbeforehide', hide);
        view.removeEventListener('viewdestroy', hide);
    };
    visits.get(view)!.cleanup = hide;
    view.addEventListener('viewbeforehide', hide);
    view.addEventListener('viewdestroy', hide);
};

export const clearTitlePage = (view: HTMLElement) => visits.get(view)?.cleanup?.();
