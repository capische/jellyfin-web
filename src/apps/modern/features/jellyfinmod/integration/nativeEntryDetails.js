import loading from 'components/loading/loading';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import { renderComponent } from 'utils/reactUtils';

import { getEntries } from '../api/modApi';
import NativeEntryDetails from '../components/NativeEntryDetails';
import NativeRatingsLine, { prefetchItemRatings } from '../components/NativeRatingsLine';
import TraktIndicator from '../components/TraktIndicator';
import { TRAKT_ITEM_TYPES } from '../constants/trakt';

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
    let versionsMount;
    let traktMount;
    let ratingsMount;
    let unmount;
    let unmountTrakt;
    let unmountRatings;
    let ratingsRowWatch;
    let generation = 0;
    const hide = () => {
        generation++;
        unmount?.();
        unmount = undefined;
        unmountTrakt?.();
        unmountTrakt = undefined;
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
        versionsMount?.remove();
        versionsMount = undefined;
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
        const itemRequest = client.getItem(client.getCurrentUserId(), params.id);
        watchRatingsRow(itemRequest, api, client.getCurrentUserId());
        // Asked for here rather than read out of upstream's failure. Upstream's controller does its own
        // getItem and, when the item is gone (a reclaim, a library removal), logs and leaves the page empty;
        // reading that used to mean a patch inside its catch. Owning the route means asking the same question
        // ourselves. It costs one extra request per native detail page, which is the price of the patch
        // coming out (P7.S6, P3.T14).
        let item;
        let user;
        try {
            [item, user] = await Promise.all([
                itemRequest,
                client.getCurrentUser(),
                // The Ratings line's data loads with the page, so it is in place before anything below it can take focus;
                // bounded, so a slow plugin never holds the page (Phase 9, web review 2026-10-07 P2 2).
                prefetchItemRatings(api, client.getCurrentUserId(), params.id)
            ]);
        } catch (error) {
            if (currentGeneration !== generation) return;
            await handleMissingNativeItem(view, params, error, () => currentGeneration === generation);
            return;
        }
        if (currentGeneration !== generation) return;
        mount = document.createElement('div');
        mount.className = 'jfmod-nativeEntryDetails';
        target.appendChild(mount);
        // Version rows sit beside the stock track selections, outside their horizontal focus container (P6.M8).
        const trackSelections = view.querySelector('.trackSelections');
        if (trackSelections) {
            versionsMount = document.createElement('div');
            versionsMount.className = 'jfmod-versionsMount';
            // insertBefore rather than after(): older TV engines lack ChildNode.after.
            trackSelections.parentNode.insertBefore(versionsMount, trackSelections.nextSibling);
        }
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
            isAdmin: !!user?.Policy?.IsAdministrator,
            view,
            versionsMount
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
