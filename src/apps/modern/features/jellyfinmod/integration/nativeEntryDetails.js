import loading from 'components/loading/loading';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import { queryClient } from 'utils/query/queryClient';
import { renderComponent } from 'utils/reactUtils';

import { getEntries } from '../api/modApi';
import { nativeItemFacts, nativeItemKey, prefetchNativeChildren, prefetchNativeEntry } from '../hooks/useEntries';
import NativeEntryDetails from '../components/NativeEntryDetails';
import NativeRatingsLine, { prefetchItemRatings } from '../components/NativeRatingsLine';
import TraktIndicator from '../components/TraktIndicator';
import { TRAKT_ITEM_TYPES } from '../constants/trakt';
import { moveShuffle } from './shuffleMenu';

import './placeholderPage.scss';

/** On a placeholder's page (a media stub, P1.FU24) upstream's Play, Replay and "Ends at" are hidden: nothing can play. */
const PLACEHOLDER_ATTRIBUTE = 'data-jfmod-placeholder';

/**
 * A native item that no longer exists (for example after reclaim) opens its catalog entry instead of an
 * endless spinner, or says plainly that it is unavailable (P3.T14). `isCurrent` says whether this page visit is still
 * the one on screen; after the lookup it is asked again, so a lookup that lands after the user moved on neither
 * redirects nor touches the loading indicator (whole-review chunk 4c, P2 5).
 */
async function handleMissingNativeItem(view, params, error, isCurrent) {
    if (error?.status !== 404 || !params.id) return;
    const client = params.serverId ? ServerConnections.getApiClient(params.serverId) : ServerConnections.currentApiClient();
    const api = client && ServerConnections.getApi(client.serverId());
    try {
        const entries = api ? await getEntries(api, { jellyfinItemId: params.id, limit: 1 }) : null;
        if (!isCurrent()) return;
        const entry = entries?.items[0];
        if (entry) {
            window.location.replace('#/details?entryId=' + encodeURIComponent(entry.id)
                + '&serverId=' + encodeURIComponent(client.serverId()));
            return;
        }
    } catch (lookupError) {
        console.error('[JellyfinMod] Could not look up the entry for a missing item', lookupError);
    }

    if (!isCurrent()) return;
    loading.hide();
    const content = view.querySelector('.detailPageContent') ?? view;
    const message = document.createElement('p');
    message.className = 'jfmod-nativeUnavailable padded-left padded-right';
    message.textContent = 'This item is no longer in the library. ';
    const link = document.createElement('a');
    link.href = '#/home';
    link.textContent = 'Open Home';
    message.appendChild(link);
    content.prepend(message);
}

export default function initializeNativeEntryDetails(view, params) {
    let mount;
    let traktMount;
    let ratingsMount;
    let unmount;
    let unmountTrakt;
    let undoShuffle;
    let unmountRatings;
    let ratingsRowWatch;
    let generation = 0;
    const hide = () => {
        generation++;
        unmount?.();
        unmount = undefined;
        unmountTrakt?.();
        unmountTrakt = undefined;
        undoShuffle?.();
        undoShuffle = undefined;
        traktMount?.remove();
        traktMount = undefined;
        ratingsRowWatch?.disconnect();
        ratingsRowWatch = undefined;
        unmountRatings?.();
        unmountRatings = undefined;
        ratingsMount?.remove();
        ratingsMount = undefined;
        mount?.remove();
        mount = undefined;
        view.removeAttribute(PLACEHOLDER_ATTRIBUTE);
    };
    /**
     * The ratings group (user decisions 10 and 13, 2026-10-08) lives in upstream's first metadata row, where the stock star and tomato
     * are. Upstream fills that row when it renders the item — before it focuses Play, which it does asynchronously — and
     * fills it again on later renders by replacing the row's content, which drops the group. A MutationObserver on the row
     * puts the same mount (and its React tree) back in place in the same microtask, before paint: the first time, before
     * Play has focus, so the reserved space is there from the first paint; on a refill, at the same place, giving focus back
     * to the group if the refill took it away (web review 2026-10-08, P2 2).
     */
    const watchRatingsRow = (itemRequest, api, userId) => {
        const row = view.querySelector('.detailRibbon .itemMiscInfo-primary');
        if (!row) return;
        ratingsMount = document.createElement('span');
        ratingsMount.className = 'jfmod-ratingsMount';
        const mountNode = ratingsMount;
        // The item's type, once this page's own request for it has answered: usually before upstream fills the row (it asks
        // the same question), so the group knows at its first paint whether it belongs here at all.
        let knownType;
        itemRequest.then(found => {
            knownType = found?.Type ?? null;
        }, () => {
            knownType = null;
        });
        // Whether the group had focus when upstream's refill took it out. Focus moving elsewhere names where it went; a removal
        // does not, and the refill's MutationObserver (a microtask) runs before the timer that settles an unexplained loss
        // (a click on nothing, the window losing focus) once the group is back in the page.
        let focused = false;
        mountNode.addEventListener('focusin', () => {
            focused = true;
        });
        mountNode.addEventListener('focusout', event => {
            if (event.relatedTarget) {
                focused = false;
                return;
            }
            setTimeout(() => {
                if (mountNode.isConnected && !mountNode.contains(document.activeElement)) focused = false;
            });
        });
        const place = () => {
            if (!row.firstChild) return;
            const before = row.querySelector('.starRatingContainer, .closedCaptionMediaInfoText, .mediaInfoCriticRating, .endsAt');
            if (mountNode.parentNode === row && (!before || mountNode.nextSibling === before)) return;
            row.insertBefore(mountNode, before);
            if (!unmountRatings) {
                unmountRatings = renderComponent(NativeRatingsLine, { api, userId, itemId: params.id, knownType,
                    itemType: itemRequest.then(found => found?.Type) }, mountNode);
            } else if (focused && (!document.activeElement || document.activeElement === document.body)) {
                mountNode.querySelector('[data-jfmod-ratings-group]')?.focus({ preventScroll: true });
            }
        };
        ratingsRowWatch = new MutationObserver(place);
        ratingsRowWatch.observe(row, { childList: true });
        place();
    };
    const show = async () => {
        hide();
        const currentGeneration = generation;
        const client = params.serverId ? ServerConnections.getApiClient(params.serverId) : ServerConnections.currentApiClient();
        const api = client && ServerConnections.getApi(client.serverId());
        const target = view.querySelector('.detailSectionContent');
        if (!api || !target || !params.id) return;
        const userId = client.getCurrentUserId();
        // The page's entry is read from the moment the route is known, beside upstream's own loading, not after the reads
        // below (P1.FU16). A season's own id finds no entry; its series' is read once its series is known.
        prefetchNativeEntry(api, userId, params.id);
        // Asked for here rather than read out of upstream's failure. Upstream's controller does its own
        // getItem and, when the item is gone (a reclaim, a library removal), logs and leaves the page empty;
        // reading that used to mean a patch inside its catch. Owning the route means asking the same question
        // ourselves. It costs one extra request per native detail page, which is the price of the patch
        // coming out (P7.S6, P3.T14). An item seen before (or a season listed on its series' page) is not waited for: the page
        // draws at once from what it knows, and a read that finds the item gone still takes the page over (P1.FU16).
        const itemKey = nativeItemKey(api, userId, params.id);
        const known = queryClient.getQueryData(itemKey);
        const missing = error => {
            if (error?.status !== 404 || currentGeneration !== generation) return;
            hide();
            const visit = generation;
            handleMissingNativeItem(view, params, error, () => visit === generation);
        };
        const read = client.getItem(userId, params.id).then(fresh => {
            const facts = nativeItemFacts(fresh);
            queryClient.setQueryData(itemKey, facts);
            return facts;
        });
        if (known) read.catch(missing);
        // The ratings group goes into upstream's first metadata row before upstream fills it, and its data is read beside the
        // page's own reads (Phase 9). Nothing waits for it: the group reserves its place at its first paint, and the page's own
        // state (a placeholder's hidden Play, review 2026-10-28 P2 2) is applied as soon as the item is known.
        watchRatingsRow(known ? Promise.resolve(known) : read, api, userId);
        prefetchItemRatings(api, userId, params.id).catch(() => undefined);
        let item;
        let user;
        try {
            [item, user] = await Promise.all([known ?? read, client.getCurrentUser()]);
        } catch (error) {
            if (currentGeneration !== generation) return;
            await handleMissingNativeItem(view, params, error, () => currentGeneration === generation);
            return;
        }
        if (currentGeneration !== generation) return;
        view.toggleAttribute(PLACEHOLDER_ATTRIBUTE, !!item?.IsPlaceHolder);
        if (item?.Type === 'Season' && item.SeriesId) prefetchNativeEntry(api, userId, item.SeriesId);
        prefetchNativeChildren(api, userId, params.id, item ?? {});
        // Shuffle stays in the header only for shows watched in any order; elsewhere it moves into More (P1.FU12).
        undoShuffle = moveShuffle(view, item, client);
        mount = document.createElement('div');
        mount.className = 'jfmod-nativeEntryDetails';
        target.appendChild(mount);
        // The file chooser, the header icon, the Played badge and the More-menu item are placed by the component itself, inside
        // upstream's Video row, header row and Played button (0.1.0.0 detail page design fix, 2026-10-07; UX §1.1).
        // The Trakt indicator has its own mount, so it shows on a title that has no catalog entry too (P7.Q16). It
        // leads the content section: below the button row a TV's focus starts on, so arriving never moves what is
        // focused, and an empty mount takes no space.
        // Only the four types Trakt history can belong to get the mount.
        if (TRAKT_ITEM_TYPES.includes(item?.Type)) {
            traktMount = document.createElement('div');
            traktMount.className = 'jfmod-traktMount';
            target.insertBefore(traktMount, target.firstChild);
            unmountTrakt = renderComponent(TraktIndicator, {
                api,
                userId: client.getCurrentUserId(),
                itemId: params.id
            }, traktMount);
        }
        unmount = renderComponent(NativeEntryDetails, {
            api,
            userId: client.getCurrentUserId(),
            serverId: client.serverId(),
            itemId: params.id,
            // A season page looks its series' entry up and opens the picker for its own season.
            itemType: item?.Type,
            seriesId: item?.SeriesId,
            seasonNumber: item?.IndexNumber,
            isAdmin: !!user?.Policy?.IsAdministrator,
            view
        }, mount);
    };
    const destroy = () => {
        hide();
        view.removeEventListener('viewshow', show);
        view.removeEventListener('viewbeforehide', hide);
        view.removeEventListener('viewdestroy', destroy);
    };
    view.addEventListener('viewshow', show);
    view.addEventListener('viewbeforehide', hide);
    view.addEventListener('viewdestroy', destroy);
}
