import type { UserDataChangeInfo } from '@jellyfin/sdk/lib/generated-client/models/user-data-change-info';
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api';
import { OutboundWebSocketMessageType } from '@jellyfin/sdk/lib/websocket';
import { type FC, useEffect } from 'react';

import layoutManager from 'components/layoutManager';
import { useApi } from 'hooks/useApi';
import globalize from 'lib/globalize';
import type { UserItemDataDto } from '@jellyfin/sdk/lib/generated-client/models/user-item-data-dto';
import { watchedLabel } from '../utils/watched';

/**
 * When an item was watched, in the tooltip of upstream's played check (P1.FU32, user 2026-10-19): hovering the tick on a
 * card (`.playedIndicator`), a list row's or the detail page's Played button (`emby-playstatebutton`, React's `PlayedButton`)
 * shows `Watched 12 Oct 2026`, from the user's `UserData.LastPlayedDate`, in the user's date locale. A played item
 * with no date (marked by hand without one) says `Watched` only. Series and seasons use only their own date, never an episode's latest; collections are left alone.
 *
 * Nothing is drawn: the title is set when the pointer reaches the tick, so upstream's own title changes (the Played button
 * resets it on every toggle) never fight it; the card hover menu's own Watched button is dated the same way. The dates come from one `GET /Items?Ids=` for the played ticks a page shows
 * (at most 100 ids a request), read once per item and kept current by the server's `UserDataChanged` push, which carries
 * the new date. Only the desktop layout reads them: the TV and phone layouts have no hover. Design buttons use data-tip and aria-label, never a native title.
 */

const normalId = (id: string | null | undefined) => (id ?? '').replace(/-/g, '').toLowerCase();

/** Collections keep their original hint; Series/Season use only their own UserData. */
const SKIPPED = new Set(['BoxSet']);
const BATCH = 100;

const watchedWord = () => globalize.translate('Watched');
/** Upstream's played ticks: the card indicator, the stock Played button, and React's (titled "Watched" while played). */
const ticks = (word: string) => `[data-ds-watched][aria-pressed="true"], .playedIndicator, .playstatebutton-played, button[title="${word}"], button[title^="${word} "]`;

/** The item a tick stands for, or null when it is not one this hint dates. */
const itemOf = (tick: Element) => {
    const host = tick.hasAttribute('data-id') ? tick : tick.closest('[data-id]');
    const id = normalId(host?.getAttribute('data-id'));
    const type = tick.getAttribute('data-type') ?? tick.getAttribute('data-itemtype') ?? host?.getAttribute('data-type') ?? '';
    return id && !SKIPPED.has(type) ? id : null;
};

const WatchedHint: FC = () => {
    const { api, user } = useApi();
    const userId = user?.Id;

    useEffect(() => {
        if (!api || !userId) return;
        /** An item's last played date (null: none); absent while not read. */
        const dates = new Map<string, UserItemDataDto | null>();
        const asking = new Set<string>();
        let timer: number | undefined;

        const paintKnownTips = () => {
            document.querySelectorAll<HTMLElement>('[data-ds-watched][aria-pressed="true"]').forEach(tick => {
                const id = itemOf(tick);
                if (!id || !dates.has(id)) return;
                const hint = watchedLabel({ ...dates.get(id), Played: true });
                tick.setAttribute('data-tip', hint);
                tick.setAttribute('aria-label', hint);
                tick.removeAttribute('title');
            });
        };
        const done = (ids: string[]) => {
            for (const id of ids) asking.delete(id);
            // Update a stationary hover too: the first read can finish after the pointer arrives.
            paintKnownTips();
        };
        const read = (ids: string[]) => {
            for (const id of ids) asking.add(id);
            getLibraryApi(api).getItems({ userId, ids, enableImages: false, enableUserData: true, enableTotalRecordCount: false })
                .then(({ data }) => {
                    for (const id of ids) dates.set(id, null);
                    for (const item of data.Items ?? []) dates.set(normalId(item.Id), item.UserData ?? null);
                }, () => {
                    for (const id of ids) dates.set(id, null);
                })
                .finally(() => done(ids));
        };

        const scan = () => {
            timer = undefined;
            if (!layoutManager.desktop) return;
            const wanted = new Set<string>();
            document.querySelectorAll(ticks(watchedWord())).forEach(tick => {
                const id = itemOf(tick);
                if (id && !dates.has(id) && !asking.has(id)) wanted.add(id);
            });
            const ids = Array.from(wanted);
            for (let i = 0; i < ids.length; i += BATCH) read(ids.slice(i, i + BATCH));
            paintKnownTips();
        };
        const schedule = () => {
            if (timer === undefined) timer = window.setTimeout(scan, 300);
        };

        /**
         * React's cards (the library grids) lay their link over the tick, so there the pointer is on the link: the link
         * carries the hint only while the pointer is over the tick, and loses it when the pointer leaves the tick.
         */
        let lent: Element | null = null;
        const onHover = (event: MouseEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            let tick = target?.closest(ticks(watchedWord())) ?? null;
            let holder = tick;
            if (!tick && target?.closest('.cardOverlayContainer') && (target === lent || !target.hasAttribute('title'))) {
                const covered = target.closest('.card')?.querySelector('.playedIndicator');
                const box = covered?.getBoundingClientRect();
                if (covered && box && event.clientX >= box.left && event.clientX <= box.right
                    && event.clientY >= box.top && event.clientY <= box.bottom) {
                    tick = covered;
                    holder = target;
                }
            }
            if (lent && lent !== holder) {
                lent.removeAttribute('title');
                lent = null;
            }
            const id = tick && itemOf(tick);
            if (!tick || !holder || !id || !dates.has(id)) return;
            const hint = watchedLabel({ ...dates.get(id), Played: true });
            if (holder.hasAttribute('data-ds-watched')) {
                holder.setAttribute('data-tip', hint);
                holder.setAttribute('aria-label', hint);
                holder.removeAttribute('title');
            } else if (holder.getAttribute('title') !== hint) {
                holder.setAttribute('title', hint);
            }
            if (holder !== tick) lent = holder;
        };

        const onUserData = ({ Data }: { Data?: UserDataChangeInfo }) => {
            if (Data?.UserId && normalId(Data.UserId) !== normalId(userId)) return;
            for (const entry of Data?.UserDataList ?? []) {
                if (entry.ItemId) dates.set(normalId(entry.ItemId), entry);
            }
            paintKnownTips();
        };

        const observer = new MutationObserver(schedule);
        observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-pressed'] });
        document.addEventListener('mousemove', onHover, { capture: true, passive: true });
        const unsubscribe = api.subscribe([OutboundWebSocketMessageType.UserDataChanged], onUserData);
        schedule();
        return () => {
            observer.disconnect();
            document.removeEventListener('mousemove', onHover, { capture: true });
            lent?.removeAttribute('title');
            unsubscribe();
            window.clearTimeout(timer);
        };
    }, [api, userId]);

    return null;
};

export default WatchedHint;
