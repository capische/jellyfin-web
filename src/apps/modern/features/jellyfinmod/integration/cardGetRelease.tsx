import type { Api } from '@jellyfin/sdk/lib/api';
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api';
import { type FC, useEffect } from 'react';

import { useApi } from 'hooks/useApi';

import { getEntries, getEntry } from '../api/modApi';
import { sameItemId } from '../constants/versions';
import { PACKS_CAPABILITY, RELEASES_CAPABILITY, usePluginCapabilities } from '../hooks/useAcquisition';
import { FileState } from '../types/entry';
import { registerCardMenuItem } from './moreMenuItem';
import { openReleasePickerForEntry } from './releasePicker';
import { restoreFocusTo } from './stockHeaderButton';

import './cardGetRelease.scss';

/**
 * Get a Release on a card (P1.FU12, user-approved design 2026-10-12; UX §5.7). Administrators only, where the plugin serves
 * release search, for movie, series, season and episode cards whose title the plugin has an entry for:
 *
 * - **Desktop:** an icon in upstream's hover overlay, after Favorite and before More, in the overlay's own round button
 *   classes, with the detail header's `cloud_download` glyph. Upstream's overlay is not edited: a `MutationObserver` inserts
 *   the button into each `.cardOverlayContainer .cardOverlayButton-br` (legacy cards carry the overlay in their markup, React
 *   cards mount `CardHoverMenu`). The button is inserted hidden and asked about once the card is first hovered or focused, so
 *   a grid of a hundred cards costs no request until one is pointed at.
 * - **Touch and TV** (no hover overlay): the card's item menu (its More button, a long press, the Menu key) carries the same
 *   item, through `moreMenuItem`'s card items.
 *
 * Choosing it opens the release picker in the card's scope, as the item's own page does: a movie as the movie page, a series
 * as the series page, a season on that season, an episode on that episode; "Get Another Quality" when the movie or episode is
 * on disk. Series and seasons are searched as packs, so they need the plugin's pack search. The mod's own file-less cards
 * have no hover overlay; their Not Downloaded mark is already this button (P1.FU11).
 */

const CARD_TYPES = new Set(['Movie', 'Series', 'Season', 'Episode']);
const BUTTON_CLASS = 'jfmod-cardGet';
/** A card's answer is asked again after this long, so a title that gained a file reads "Get Another Quality". */
const KEEP_MS = 60_000;

interface CardTarget {
    label: string;
    open: () => Promise<void>;
}

const cache = new Map<string, { at: number; value: Promise<CardTarget | null> }>();

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
    const episode = detail.episodes.find(candidate => sameItemId(candidate.jellyfinItemId, itemId)
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
    const key = type + ':' + itemId.replace(/-/g, '').toLowerCase();
    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < KEEP_MS) return cached.value;
    const value = findTarget(api, userId, itemId, type, packs).catch(() => null);
    cache.set(key, { at: Date.now(), value });
    return value;
};

const cardOf = (element: Element | null) => {
    const card = element?.closest<HTMLElement>('.card[data-id]') ?? null;
    const itemId = card?.getAttribute('data-id');
    const type = card?.getAttribute('data-type') ?? '';
    return card && itemId && CARD_TYPES.has(type) ? { card, itemId, type } : null;
};

/** The icon, in the overlay's own button classes; hidden until the card's answer says it belongs. */
const makeButton = () => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `paper-icon-button-light cardOverlayButton cardOverlayButton-hover ${BUTTON_CLASS}`;
    button.hidden = true;
    button.innerHTML = '<span class="material-icons cardOverlayButtonIcon cardOverlayButtonIcon-hover cloud_download" aria-hidden="true"></span>';
    return button;
};

/** After Favorite, before More: upstream's More is the group's `data-action="menu"` button. */
const insertInto = (overlay: Element) => {
    const group = overlay.querySelector(':scope > .cardOverlayButton-br');
    if (!group || group.querySelector(':scope > .' + BUTTON_CLASS) || !cardOf(overlay)) return;
    const more = group.querySelector(':scope > [data-action="menu"]');
    group.insertBefore(makeButton(), more);
};

const insertAll = (root: ParentNode) => {
    if (root instanceof Element && root.matches('.cardOverlayContainer')) insertInto(root);
    root.querySelectorAll('.cardOverlayContainer').forEach(insertInto);
};

const CardGetRelease: FC = () => {
    const { api, user } = useApi();
    const isAdmin = !!user?.Policy?.IsAdministrator;
    const capabilities = usePluginCapabilities(api, isAdmin);
    const enabled = isAdmin && capabilities.includes(RELEASES_CAPABILITY);
    const packs = capabilities.includes(PACKS_CAPABILITY);
    const userId = user?.Id;

    useEffect(() => {
        if (!enabled || !api || !userId) return;
        const lookup = (itemId: string, type: string) => targetFor(api, userId, itemId, type, packs);

        // The card's item menu on every layout: what touch and the TV have instead of the hover overlay.
        const unregister = registerCardMenuItem(async ({ itemId, type, element }) => {
            const target = await lookup(itemId, type);
            if (!target) return null;
            return {
                id: 'jfmod-more-getRelease',
                name: target.label,
                icon: 'cloud_download',
                run: () => openFrom(target, element)
            };
        });

        // A hidden button is asked about when its card is first hovered or focused.
        const reveal = (event: Event) => {
            const found = cardOf(event.target as Element | null);
            const button = found?.card.querySelector<HTMLButtonElement>(`.${BUTTON_CLASS}[hidden]:not([data-jfmod-asked])`);
            if (!found || !button) return;
            button.setAttribute('data-jfmod-asked', '');
            lookup(found.itemId, found.type).then(target => {
                if (!target) return;
                button.title = target.label;
                button.setAttribute('aria-label', target.label);
                button.hidden = false;
            }).catch(() => undefined);
        };
        // Taken on the button itself and no further, so neither the overlay's link nor upstream's item container acts on it.
        const onClick = (event: MouseEvent) => {
            const button = (event.target as Element | null)?.closest<HTMLButtonElement>('.' + BUTTON_CLASS);
            const found = button ? cardOf(button) : null;
            if (!button || !found) return;
            event.preventDefault();
            event.stopPropagation();
            lookup(found.itemId, found.type).then(target => {
                if (target) openFrom(target, button);
            }).catch(() => undefined);
        };

        insertAll(document.body);
        const observer = new MutationObserver(records => {
            for (const record of records) {
                record.addedNodes.forEach(node => {
                    if (node instanceof Element) insertAll(node);
                });
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
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
        };
    }, [api, enabled, packs, userId]);

    return null;
};

export default CardGetRelease;
