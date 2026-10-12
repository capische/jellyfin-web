import { registerMoreMenuItem } from './moreMenuItem';
import { sameItemId } from '../constants/versions';

import './shuffleMenu.scss';

/**
 * Shuffle only where it makes sense (P1.FU12, user 2026-10-12): upstream's header Shuffle stays on a series or season page
 * whose show is one that is watched in any order — Jellyfin genres naming comedy (sitcoms), animation, reality, talk or game
 * shows, documentaries, kids or news, matched case-insensitively within the genre's name. Any other show (a drama, a
 * fantasy) has the header button hidden by a page class, and a Shuffle item in the stock More menu clicks that hidden button,
 * so playback stays exactly upstream's. Movies and every other page are untouched. A season page reads its show's genres.
 *
 * Parity check on every upstream merge: the detail page still has one `.btnShuffle` in `.mainDetailButtons`, still shown
 * with upstream's `hide` class removed, and its click still shuffles the page's item.
 */

const ANY_ORDER = ['comedy', 'sitcom', 'animation', 'reality', 'talk', 'game', 'documentary', 'kids', 'news'];

export const shufflesInHeader = (genres: string[]) =>
    genres.some(genre => ANY_ORDER.some(word => genre.toLowerCase().includes(word)));

interface PageItem {
    Id?: string | null;
    Type?: string | null;
    SeriesId?: string | null;
    Genres?: string[] | null;
}

interface Client {
    getItem: (userId: string, itemId: string) => Promise<PageItem>;
    getCurrentUserId: () => string;
}

/** Applies the rule to a native detail page; the returned function undoes it (the page hides or shows another item). */
export const moveShuffle = (view: HTMLElement, item: PageItem | undefined, client: Client): (() => void) => {
    const isSeason = item?.Type === 'Season';
    if (!item?.Id || (item.Type !== 'Series' && !isSeason) || (isSeason && !item.SeriesId)) return () => undefined;
    let done = false;
    let unregister: (() => void) | null = null;
    const genres = isSeason ? client.getItem(client.getCurrentUserId(), item.SeriesId ?? '').then(series => series.Genres ?? []) :
        Promise.resolve(item.Genres ?? []);
    genres.then(list => {
        if (done || shufflesInHeader(list)) return;
        view.classList.add('jfmod-shuffleInMore');
        unregister = registerMoreMenuItem({
            id: 'jfmod-more-shuffle',
            name: 'Shuffle',
            icon: 'shuffle',
            // This page's own header More, for its own item, while upstream offers Shuffle for it.
            matches: options => {
                const button = options.positionTo;
                const header = view.querySelector('.mainDetailButtons');
                const shuffle = header?.querySelector('.btnShuffle');
                return !!button && !!header && !!shuffle && !shuffle.classList.contains('hide') && document.body.contains(view)
                    && button.classList.contains('btnMoreCommands') && header.contains(button) && sameItemId(options.item?.Id, item.Id);
            },
            run: () => view.querySelector<HTMLButtonElement>('.mainDetailButtons .btnShuffle')?.click()
        });
    }).catch(() => undefined);
    return () => {
        done = true;
        unregister?.();
        view.classList.remove('jfmod-shuffleInMore');
    };
};
