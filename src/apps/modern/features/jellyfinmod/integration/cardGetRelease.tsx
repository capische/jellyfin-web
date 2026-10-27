import type { Api } from '@jellyfin/sdk/lib/api';
import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind';
import { ItemFields } from '@jellyfin/sdk/lib/generated-client/models/item-fields';
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api';
import { queryOptions, useQuery } from '@tanstack/react-query';
import React, { type FC, useEffect, useLayoutEffect, useRef } from 'react';

import layoutManager from 'components/layoutManager';

import { useApi } from 'hooks/useApi';

import { getEntries, getEntry } from '../api/modApi';
import { isEpisodeItem, sameItemId } from '../constants/versions';
import { PACKS_CAPABILITY, RELEASES_CAPABILITY, usePluginCapabilities } from '../hooks/useAcquisition';
import { FileState } from '../types/entry';
import { lastKnown } from '../utils/lastKnown';
import { announce } from './announce';
import { registerCardMenuItem } from './moreMenuItem';
import { openReleasePickerForEntry } from './releasePicker';
import { restoreFocusTo } from './stockHeaderButton';

import '../components/fileStateMark.scss';
import './cardGetRelease.scss';

/**
 * Get a Release on a card (P1.FU12, user-approved design 2026-10-12; UX §5.7). Administrators only, where the plugin serves
 * release search, for movie, series, season and episode cards whose title the plugin has an entry for:
 *
 * - **Desktop:** an icon in upstream's hover overlay, after Favorite and before More, in the overlay's own round button
 *   classes, with the detail header's `cloud_download` glyph. Upstream's overlay is not edited: a `MutationObserver` inserts
 *   the button into each `.cardOverlayContainer .cardOverlayButton-br` (legacy cards carry the overlay in their markup, React
 *   cards mount `CardHoverMenu`), in the same task that drew the card, so it is there in the card's first frame and after
 *   every redraw (P1.FU23, user 2026-10-13: it "appeared after about 1 second"). It is drawn from what is known when the card
 *   is: an administrator, a plugin that searches releases (and packs, for a series or season), the card's type. Whether the
 *   title has an entry is asked once the card is first hovered or focused, so a grid of a hundred cards costs no request
 *   until one is pointed at; the rare card whose answer is no (no entry, a special) loses the icon then (on 28096, 1 title of
 *   164 and no season or episode, 2026-10-13). The answer belongs to the card's item, not to its element: a title's card keeps
 *   its element when its movie is deleted and its placeholder takes its place (user 2026-10-27, The Matrix on beta), so the
 *   icon is drawn and asked again for the new item.
 * - **Touch and TV** (no hover overlay): the card's item menu (its More button, a long press, the Menu key) carries the same
 *   item, through `moreMenuItem`'s card items.
 *
 * Choosing it opens the release picker in the card's scope once the answer is in, as the item's own page does: a movie as the movie page, a series
 * as the series page, a season on that season, an episode on that episode; "Get Another Quality" when the movie or episode is
 * on disk. Series and seasons are searched as packs, so they need the plugin's pack search.
 *
 * **A card with nothing on disk** (P1.FU19, user 2026-10-13: "We don't need Play. Instead of Play there should be the Cloud to
 * download the season"): whoever knows the card has no file marks it `data-jfmod-nofile` (the series page's season cards with
 * no episode on disk, P1.FU17's rule, a download in progress included; a library entry's native card with nothing on disk).
 * Upstream's centre Play is hidden on it for everyone, and an administrator's icon takes the centre in Play's own round
 * classes instead of the bottom row. The mod's own file-less and missing-season cards have no upstream overlay: `CardHoverGet`
 * draws the same centre icon on them.
 *
 * **Any series or season Jellyfin holds no episode file of** (P1.FU23, user 2026-10-13 on Kleo's library card: "Supposed to be
 * Cloud download instead of Play button as nothing available to play") is marked `data-jfmod-empty` wherever its card is
 * drawn (library grids, search, Home rows), with the same effect. One read per user lists them (a series' recursive episode
 * count, a season's child count), kept in this browser and refreshed with the catalog, so the mark is on the card from its
 * first frame. A title with any episode file keeps Play. Since P1.FU24 a placeholder episode (a media stub Jellyfin calls
 * `IsPlaceHolder`) counts as no file: a season or series holding only placeholders is marked, and so is each placeholder's own
 * card (a third read lists them).
 */

const CARD_TYPES = new Set(['Movie', 'Series', 'Season', 'Episode']);
const BUTTON_CLASS = 'jfmod-cardGet';
/** On a card with nothing on disk: Play is hidden and the icon takes the centre (P1.FU19). */
export const NO_FILE_ATTRIBUTE = 'data-jfmod-nofile';
/** The same, set from Jellyfin's own counts on any series or season card with no episode (P1.FU23). */
const EMPTY_ATTRIBUTE = 'data-jfmod-empty';
const PACK_TYPES = new Set(['Series', 'Season']);
const NOT_AVAILABLE = 'Get a Release is not available for this title.';
const CENTRE_CLASS = 'cardOverlayFab-primary';
/** The item a card's icon (and a card's asked lookup) is for: a card element can be drawn again for another item. */
const ITEM_ATTRIBUTE = 'data-jfmod-item';
const ASKED_ATTRIBUTE = 'data-jfmod-asked';
/** A card's answer is asked again after this long, so a title that gained a file reads "Get Another Quality". */
const KEEP_MS = 60_000;

interface CardTarget {
    label: string;
    open: () => Promise<void>;
}

interface CachedTarget {
    at: number;
    value: Promise<CardTarget | null>;
    /** Set once the answer is in. */
    settled?: { target: CardTarget | null };
}

const cache = new Map<string, CachedTarget>();

const keyOf = (itemId: string, type: string) => type + ':' + itemId.replace(/-/g, '').toLowerCase();

/** A season card's series and number; null for specials, which have no season search. */
const seasonOf = async (api: Api, userId: string, itemId: string) => {
    const { data } = await getLibraryApi(api).getItems({ userId, ids: [itemId], enableImages: false, enableUserData: false });
    const season = data.Items?.[0];
    return season?.SeriesId && season.IndexNumber ? { seriesId: season.SeriesId, seasonNumber: season.IndexNumber } : null;
};

const labelFor = (intent: 'addVersion' | undefined) => (intent ? 'Get Another Quality' : 'Get a Release');

/** An episode card: only an episode the plugin tracks, so the picker can preselect it. */
const episodeTarget = async (api: Api, entryId: string, itemId: string): Promise<CardTarget | null> => {
    const detail = await getEntry(api, entryId);
    const episode = detail.episodes.find(candidate => isEpisodeItem(candidate, itemId)
        || (candidate.versions ?? []).some(version => sameItemId(version.jellyfinItemId, itemId)));
    if (!episode) return null;
    const intent = episode.state === FileState.OnDisk ? 'addVersion' : undefined;
    return { label: labelFor(intent), open: () => openReleasePickerForEntry(api, entryId, { nativeItemId: itemId, intent }) };
};

const findTarget = async (api: Api, userId: string, itemId: string, type: string, packs: boolean): Promise<CardTarget | null> => {
    const pack = type === 'Series' || type === 'Season';
    if (pack && !packs) return null;
    // A season has no entry of its own: its series' entry, searched by its own season.
    const season = type === 'Season' ? await seasonOf(api, userId, itemId) : undefined;
    if (season === null) return null;
    // The plugin matches a movie or series to its entry, and a native episode to its series (P1.P11, P3.T14).
    const entry = (await getEntries(api, { jellyfinItemId: season?.seriesId ?? itemId, limit: 1 })).items[0];
    if (!entry || entry.id.startsWith('pending:')) return null;
    if (pack) {
        if (entry.mediaType !== 'series') return null;
        const seasonNumber = season?.seasonNumber;
        return { label: labelFor(undefined), open: () => openReleasePickerForEntry(api, entry.id, { seasonNumber }) };
    }
    if (type === 'Episode') return entry.mediaType === 'series' ? episodeTarget(api, entry.id, itemId) : null;
    if (entry.mediaType !== 'movie') return null;
    const intent = entry.state === FileState.OnDisk ? 'addVersion' : undefined;
    return { label: labelFor(intent), open: () => openReleasePickerForEntry(api, entry.id, { intent }) };
};

/** Opens the picker and gives focus back to what opened it. */
const openFrom = (target: CardTarget, opener: HTMLElement) => {
    const focusBack = () => restoreFocusTo(opener);
    target.open().then(focusBack, focusBack);
};

/** One answer per card item for a minute, shared by its overlay button and its menu; a failed lookup shows nothing. */
const targetFor = (api: Api, userId: string, itemId: string, type: string, packs: boolean) => {
    const key = keyOf(itemId, type);
    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < KEEP_MS) return cached.value;
    const fresh: CachedTarget = { at: Date.now(), value: findTarget(api, userId, itemId, type, packs).catch(() => null) };
    fresh.value.then(target => {
        fresh.settled = { target };
    }).catch(() => undefined);
    cache.set(key, fresh);
    return fresh.value;
};

/** The card's answer if it is in and fresh; undefined while it is not known. */
const settledTarget = (itemId: string, type: string) => {
    const cached = cache.get(keyOf(itemId, type));
    return cached && Date.now() - cached.at < KEEP_MS ? cached.settled : undefined;
};

/** Series and seasons are searched as packs: their icon needs the plugin's pack search. */
const eligible = (type: string, packs: boolean) => CARD_TYPES.has(type) && (packs || !PACK_TYPES.has(type));

/** Nothing on disk: marked by whoever knows it (P1.FU19), or by Jellyfin's own counts (P1.FU23). */
const hasNoFile = (card: Element) => card.hasAttribute(NO_FILE_ATTRIBUTE) || card.hasAttribute(EMPTY_ATTRIBUTE);

const cardOf = (element: Element | null) => {
    const card = element?.closest<HTMLElement>('.card[data-id]') ?? null;
    const itemId = card?.getAttribute('data-id');
    const type = card?.getAttribute('data-type') ?? '';
    return card && itemId && CARD_TYPES.has(type) ? { card, itemId, type } : null;
};

/** Shows the card's answer on its icon: its label, no icon when the title has no release search, Get a Release until known. */
const applyTarget = (button: HTMLButtonElement, target: CardTarget | null | undefined) => {
    button.hidden = target === null;
    const label = target?.label ?? 'Get a Release';
    button.title = label;
    button.setAttribute('aria-label', label);
};

/** The icon, in the overlay's own button classes, shown at once; a card already answered for is drawn as answered. */
const makeButton = (itemId: string, type: string) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `paper-icon-button-light cardOverlayButton cardOverlayButton-hover ${BUTTON_CLASS}`;
    button.innerHTML = '<span class="material-icons cardOverlayButtonIcon cardOverlayButtonIcon-hover cloud_download" aria-hidden="true"></span>';
    button.setAttribute(ITEM_ATTRIBUTE, itemId);
    applyTarget(button, settledTarget(itemId, type)?.target);
    return button;
};

/**
 * Puts the card's icon in its place: after Favorite, before More (upstream's More is the group's `data-action="menu"` button);
 * or, on a card with nothing on disk, in the centre where upstream's Play was.
 */
const placeIn = (overlay: Element, packs: boolean) => {
    const found = cardOf(overlay);
    const group = overlay.querySelector(':scope > .cardOverlayButton-br');
    if (!found || !group || !eligible(found.type, packs)) return;
    const button = overlay.querySelector<HTMLButtonElement>('.' + BUTTON_CLASS) ?? makeButton(found.itemId, found.type);
    // The same card drawn for another item (a title's card keeps its element when its movie is deleted and its placeholder
    // takes its place): the icon is drawn for that item, not from the answer the old one had.
    if (button.getAttribute(ITEM_ATTRIBUTE) !== found.itemId) {
        button.setAttribute(ITEM_ATTRIBUTE, found.itemId);
        applyTarget(button, settledTarget(found.itemId, found.type)?.target);
    }
    const centre = hasNoFile(found.card);
    button.classList.toggle(CENTRE_CLASS, centre);
    if (centre) {
        if (button.parentNode !== overlay) overlay.insertBefore(button, group);
    } else if (button.parentNode !== group) {
        group.insertBefore(button, group.querySelector(':scope > [data-action="menu"]'));
    }
};

/** The overlays in `root` (or `root` itself), each with its icon placed. */
const placeAll = (root: ParentNode, packs: boolean) => {
    const overlays = Array.from(root.querySelectorAll('.cardOverlayContainer'));
    if (root instanceof Element && root.matches('.cardOverlayContainer')) overlays.push(root);
    overlays.forEach(overlay => {
        placeIn(overlay, packs);
    });
};

/**
 * The series and seasons Jellyfin holds no episode of, by normalised id (P1.FU23). A series' recursive count is only
 * filled with user data, and a season's series id can name another series item of the same show (automatic series
 * grouping), so series and seasons are read apart, each by its own count. Kept in this browser between starts; the
 * catalog's refresh on library changes (`queryClientEventHandler`) reads it again.
 */
const emptyFoldersQuery = (api: Api | undefined, userId: string | undefined) => {
    const kept = lastKnown<string[]>(`jfmod-emptyFolders:${api?.basePath}:${userId}`);
    return queryOptions({
        queryKey: ['JellyfinMod', api?.basePath, userId, 'EmptyFolders'],
        queryFn: async ({ signal }) => {
            const items = getLibraryApi(api!);
            const common = { userId, recursive: true, enableImages: false, enableTotalRecordCount: false };
            const [series, seasons, placeholders] = await Promise.all([
                items.getItems({ ...common, includeItemTypes: [BaseItemKind.Series], fields: [ItemFields.RecursiveItemCount] }, { signal }),
                items.getItems({ ...common, includeItemTypes: [BaseItemKind.Season], fields: [ItemFields.ChildCount], enableUserData: false },
                    { signal }),
                // Placeholder episodes and movies (media stubs, P1.FU24, P1.FU26) are items with no file: a season or series
                // holding only them has nothing to play either, and their own cards none.
                items.getItems({ ...common, includeItemTypes: [BaseItemKind.Episode, BaseItemKind.Movie], isPlaceHolder: true,
                    enableUserData: false }, { signal })
            ]);
            const normal = (id: string | null | undefined) => (id ?? '').replace(/-/g, '').toLowerCase();
            const stubs = placeholders.data.Items ?? [];
            const stubsIn = new Map<string, number>();
            for (const stub of stubs) {
                for (const parent of [stub.SeasonId, stub.SeriesId]) {
                    if (parent) stubsIn.set(normal(parent), (stubsIn.get(normal(parent)) ?? 0) + 1);
                }
            }
            const onlyStubs = (id: string | null | undefined, count: number | null | undefined) => (count ?? 0) === (stubsIn.get(normal(id)) ?? 0);
            const ids = [
                ...(series.data.Items ?? []).filter(item => onlyStubs(item.Id, item.RecursiveItemCount)),
                ...(seasons.data.Items ?? []).filter(item => onlyStubs(item.Id, item.ChildCount)),
                ...stubs
            ].map(item => normal(item.Id)).filter(Boolean);
            kept.save(ids);
            return ids;
        },
        initialData: () => (api && userId ? kept.read() : undefined),
        initialDataUpdatedAt: 0,
        enabled: !!api && !!userId,
        staleTime: 5 * 60 * 1000,
        retry: false
    });
};

/**
 * Marks every series or season card in `root` (or `root` itself) that Jellyfin holds no episode file of, and every placeholder
 * episode's (P1.FU24) and movie's (P1.FU26) card, and unmarks the rest. Placeholder movies and episodes, and series with nothing
 * but placeholders, carry the Not Downloaded mark too.
 */
const markEmpty = (root: ParentNode, empty: Set<string>) => {
    const cards = Array.from(root.querySelectorAll('.card[data-id]'));
    if (root instanceof Element && root.matches('.card[data-id]')) cards.push(root);
    for (const card of cards) {
        const type = card.getAttribute('data-type') ?? '';
        const isEmpty = (PACK_TYPES.has(type) || type === 'Episode' || type === 'Movie')
            && empty.has((card.getAttribute('data-id') ?? '').replace(/-/g, '').toLowerCase());
        if (isEmpty !== card.hasAttribute(EMPTY_ATTRIBUTE)) card.toggleAttribute(EMPTY_ATTRIBUTE, isEmpty);
        if (type === 'Episode' || type === 'Movie' || type === 'Series') placeholderMark(card, isEmpty);
    }
};

/** The Not Downloaded glyph's markup (`NotDownloadedGlyph`), for a mark drawn outside React. */
const GLYPH = '<svg class="jfmod-markGlyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" '
    + 'stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M8 13.5H6.6a3.6 3.6 0 0 1-.5-7.17A5 5 0 0 1 15.7 5.4a3.9 '
    + '3.9 0 0 1 2 7.6 3.9 3.9 0 0 1-.7.5"/><path d="M12 9v12"/><path d="M8.5 17.5 12 21l3.5-3.5"/></svg>';

/**
 * A placeholder episode's card (P1.FU24) carries the Not Downloaded indicator top right, as the mod's own cards do (UX §3.1),
 * left of upstream's played tick: a plain indicator for everyone (P1.FU19), drawn into the card, so it goes with the card when
 * upstream redraws it.
 */
const placeholderMark = (card: Element, on: boolean) => {
    const cover = card.querySelector('.cardScalable');
    const existing = cover?.querySelector(':scope > [data-jfmod-stubmark]');
    // A card the mod draws itself (a catalog title's) already carries its own state mark: one mark, never two.
    if (!cover || !on || cover.querySelector(':scope > .jfmod-markSlot:not([data-jfmod-stubmark])')) {
        existing?.remove();
        return;
    }
    if (existing) return;
    const slot = document.createElement('div');
    slot.className = 'jfmod-markSlot';
    slot.setAttribute('data-jfmod-stubmark', '');
    slot.innerHTML = `<div class="jfmod-mark jfmod-mark--none" title="Not Downloaded">${GLYPH}</div>`;
    const indicators = cover.querySelector<HTMLElement>('.cardIndicators');
    if (indicators?.offsetWidth) {
        slot.style.setProperty(document.documentElement.getAttribute('dir') === 'rtl' ? 'left' : 'right', `calc(0.475em + ${indicators.offsetWidth}px)`);
    }
    cover.appendChild(slot);
};

/** Keeps `data-jfmod-empty` on the cards of every user, from the first frame each card is drawn in. */
const useEmptyMarks = (api: Api | undefined, userId: string | undefined) => {
    const ids = useQuery(emptyFoldersQuery(api, userId)).data;
    useLayoutEffect(() => {
        if (!ids) return;
        const empty = new Set(ids);
        markEmpty(document.body, empty);
        const observer = new MutationObserver(records => {
            for (const record of records) {
                record.addedNodes.forEach(node => {
                    if (!(node instanceof Element)) return;
                    // The mod's own mark arrived on a card that got the injected one first: keep the mod's only.
                    if (node.matches('.jfmod-markSlot:not([data-jfmod-stubmark])')) {
                        node.parentElement?.querySelector(':scope > [data-jfmod-stubmark]')?.remove();
                        return;
                    }
                    markEmpty(node, empty);
                });
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        return () => {
            observer.disconnect();
            document.querySelectorAll(`[${EMPTY_ATTRIBUTE}]`).forEach(card => {
                card.removeAttribute(EMPTY_ATTRIBUTE);
            });
            document.querySelectorAll('[data-jfmod-stubmark]').forEach(mark => {
                mark.remove();
            });
        };
    }, [ids]);
};

/** Marks the upstream card around `cover` as having nothing on disk while this is drawn (P1.FU19). */
export const NoFileCard: FC<{ cover: Element }> = ({ cover }) => {
    useLayoutEffect(() => {
        const card = cover.closest('.card');
        card?.setAttribute(NO_FILE_ATTRIBUTE, '');
        return () => card?.removeAttribute(NO_FILE_ATTRIBUTE);
    }, [cover]);
    return null;
};

/**
 * The centre icon on the mod's own cards with nothing on disk (P1.FU19): a file-less title's card and a missing season's card,
 * which have no upstream overlay. Desktop only, as upstream's hover overlay; drawn in that overlay's own classes, so it shows on
 * the card's hover or focus like Play on upstream's cards. Given only where an administrator may get a release. Its click is
 * taken natively on the button and goes no further, so the card's link does not follow it.
 */
export const CardHoverGet: FC<{ open: (button: HTMLElement) => void }> = ({ open }) => {
    const ref = useRef<HTMLButtonElement>(null);
    const openRef = useRef(open);
    openRef.current = open;
    useEffect(() => {
        const button = ref.current;
        if (!button) return;
        const onClick = (event: Event) => {
            event.preventDefault();
            event.stopPropagation();
            openRef.current(button);
        };
        button.addEventListener('click', onClick);
        return () => button.removeEventListener('click', onClick);
    }, []);
    if (!layoutManager.desktop) return null;
    return <div className='cardOverlayContainer jfmod-hoverGet'>
        <button ref={ref} type='button' title='Get a Release' aria-label='Get a Release'
            className={`paper-icon-button-light cardOverlayButton cardOverlayButton-hover ${CENTRE_CLASS} jfmod-cardGetCentre`}>
            <span className='material-icons cardOverlayButtonIcon cardOverlayButtonIcon-hover cloud_download' aria-hidden='true' />
        </button>
    </div>;
};

const CardGetRelease: FC = () => {
    const { api, user } = useApi();
    const isAdmin = !!user?.Policy?.IsAdministrator;
    const capabilities = usePluginCapabilities(api, isAdmin);
    const enabled = isAdmin && capabilities.includes(RELEASES_CAPABILITY);
    const packs = capabilities.includes(PACKS_CAPABILITY);
    const userId = user?.Id;
    useEmptyMarks(api, userId);

    // A layout effect, so the icons already drawn are placed before the browser paints this commit.
    useLayoutEffect(() => {
        if (!enabled || !api || !userId) return;
        const lookup = (itemId: string, type: string) => targetFor(api, userId, itemId, type, packs);
        // Opens the picker once the card's answer is in; a title without release search loses its icon and says so.
        const openFor = (found: { itemId: string; type: string }, opener: HTMLElement, button?: HTMLButtonElement) => {
            lookup(found.itemId, found.type).then(target => {
                if (button) applyTarget(button, target);
                if (target) openFrom(target, opener);
                else announce(NOT_AVAILABLE);
            }).catch(() => undefined);
        };

        // The card's item menu on every layout: what touch and the TV have instead of the hover overlay. It is drawn with
        // the menu, not after the card's answer: an answer already in gives its label (or no item), else Get a Release.
        const unregister = registerCardMenuItem(({ itemId, type, element }) => {
            const known = settledTarget(itemId, type);
            if (!eligible(type, packs) || known?.target === null) return Promise.resolve(null);
            return Promise.resolve({
                id: 'jfmod-more-getRelease',
                name: known?.target?.label ?? 'Get a Release',
                icon: 'cloud_download',
                run: () => openFor({ itemId, type }, element)
            });
        });

        // A card's answer is asked once per item, when the card is first hovered or focused; the icon is shown meanwhile. A card
        // drawn again for another item (its title's movie deleted and its placeholder in its place) is asked again, and a late
        // answer for the item it showed before is not applied.
        const ask = (card: HTMLElement) => {
            const found = cardOf(card);
            if (!found || !eligible(found.type, packs) || card.getAttribute(ASKED_ATTRIBUTE) === found.itemId) return;
            card.setAttribute(ASKED_ATTRIBUTE, found.itemId);
            lookup(found.itemId, found.type).then(target => {
                for (const button of card.querySelectorAll<HTMLButtonElement>('.' + BUTTON_CLASS)) {
                    if (button.getAttribute(ITEM_ATTRIBUTE) === found.itemId) applyTarget(button, target);
                }
            }).catch(() => undefined);
        };
        const reveal = (event: Event) => {
            const found = cardOf(event.target as Element | null);
            if (found) ask(found.card);
        };
        const place = (root: ParentNode) => placeAll(root, packs);
        // Taken on the button itself and no further, so neither the overlay's link nor upstream's item container acts on it.
        const onClick = (event: MouseEvent) => {
            const button = (event.target as Element | null)?.closest<HTMLButtonElement>('.' + BUTTON_CLASS);
            const found = button ? cardOf(button) : null;
            if (!button || !found) return;
            event.preventDefault();
            event.stopPropagation();
            openFor(found, button, button);
        };

        place(document.body);
        // New overlays (a card drawn or redrawn), cards marked (or no longer marked) as having nothing on disk after their overlay
        // was drawn, and cards drawn again for another item. The callback runs before the browser paints what was added.
        const observer = new MutationObserver(records => {
            for (const record of records) {
                if (record.type === 'attributes') {
                    if (record.target instanceof Element) place(record.target);
                    continue;
                }
                record.addedNodes.forEach(node => {
                    if (node instanceof Element) place(node);
                });
            }
        });
        observer.observe(document.body, { childList: true, subtree: true, attributes: true,
            attributeFilter: [NO_FILE_ATTRIBUTE, EMPTY_ATTRIBUTE, 'data-id'] });
        document.addEventListener('pointerover', reveal, true);
        document.addEventListener('focusin', reveal, true);
        // Capture at the document, so the click is stopped before any card or container listener sees it.
        document.addEventListener('click', onClick, true);
        return () => {
            unregister?.();
            observer.disconnect();
            document.removeEventListener('pointerover', reveal, true);
            document.removeEventListener('focusin', reveal, true);
            document.removeEventListener('click', onClick, true);
            document.querySelectorAll('.' + BUTTON_CLASS).forEach(button => {
                button.remove();
            });
            document.querySelectorAll(`[${ASKED_ATTRIBUTE}]`).forEach(card => {
                card.removeAttribute(ASKED_ATTRIBUTE);
            });
        };
    }, [api, enabled, packs, userId]);

    return null;
};

export default CardGetRelease;
