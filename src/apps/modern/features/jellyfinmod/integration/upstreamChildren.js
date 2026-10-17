import cardBuilder from 'components/cardbuilder/cardBuilder';
import imageLoader from 'components/images/imageLoader';
import layoutManager from 'components/layoutManager';
import listView from 'components/listview/listview';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import browser from 'scripts/browser';

/**
 * Draws upstream's own children list of a series or season page again (P1.FU27), so a placeholder Jellyfin added or removed
 * while the page is open (the backfill writing a batch, a placeholder swapped for its file, Remove Placeholders) shows as
 * upstream's own card or row without reloading the page, and the mod's fallback card or row for it goes.
 *
 * It mirrors the Series and Season branches of upstream's `renderChildren` (`apps/legacy/controllers/itemDetails/index.js`):
 * the same request, fields and card or list options, then the same `innerHTML` and lazy images. Upstream's file stays
 * unpatched (P7.S6); if upstream changes those options, the redrawn list differs from a fresh page until the page is opened
 * again, and nothing else.
 */
const FIELDS = 'ItemCounts,PrimaryImageAspectRatio,CanDelete,MediaSourceCount';

/**
 * @param {Element} container upstream's `#listChildrenCollapsible .itemsContainer`
 * @param {{ type: 'Series' | 'Season', itemId: string, seriesId?: string, serverId?: string }} page the page's item
 * @returns {Promise<void>}
 */
export async function redrawUpstreamChildren(container, { type, itemId, seriesId, serverId }) {
    const apiClient = serverId ? ServerConnections.getApiClient(serverId) : ServerConnections.currentApiClient();
    if (!apiClient || !container?.isConnected) return;
    const userId = apiClient.getCurrentUserId();
    let html;
    if (type === 'Series') {
        const result = await apiClient.getSeasons(itemId, { userId, Fields: FIELDS });
        const scrollX = browser.mobile && window.screen.availWidth <= 1000;
        html = cardBuilder.getCardsHtml({
            items: result.Items,
            shape: 'overflowPortrait',
            showTitle: true,
            centerText: true,
            lazy: true,
            overlayPlayButton: true,
            allowBottomPadding: !scrollX
        });
    } else if (type === 'Season' && seriesId) {
        const result = await apiClient.getEpisodes(seriesId, { seasonId: itemId, userId, Fields: FIELDS + ',Overview' });
        html = listView.getListViewHtml({
            items: result.Items,
            showIndexNumber: false,
            enableOverview: true,
            enablePlayedButton: !layoutManager.mobile,
            infoButton: !layoutManager.mobile,
            imageSize: 'large',
            enableSideMediaInfo: false,
            highlight: false,
            action: !layoutManager.desktop ? 'link' : 'none',
            imagePlayButton: true,
            includeParentInfoInTitle: false
        });
    } else {
        return;
    }
    if (!container.isConnected) return;
    container.innerHTML = html;
    imageLoader.lazyChildren(container);
}
