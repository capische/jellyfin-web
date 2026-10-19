import type { UserDataChangeInfo } from '@jellyfin/sdk/lib/generated-client/models/user-data-change-info';
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api';
import { OutboundWebSocketMessageType } from '@jellyfin/sdk/lib/websocket';
import { type FC, useEffect } from 'react';

import layoutManager from 'components/layoutManager';
import { useApi } from 'hooks/useApi';
import globalize from 'lib/globalize';
import datetime from 'scripts/datetime';

/**
 * When an item was watched, in the tooltip of upstream's played check (P1.FU32, user 2026-10-19): hovering the tick on a
 * card (`.playedIndicator`), a list row's or the detail page's Played button (`emby-playstatebutton`, React's `PlayedButton`)
 * shows `Watched 12 Oct 2026, 9:41 pm`, from the user's `UserData.LastPlayedDate`, in the user's date locale. A played item
 * with no date (marked by hand without one) says `Watched` only. Series, seasons and collections are left alone: their own
 * date is empty and their episodes' latest would cost a request per card.
 *
 * Nothing is drawn: the title is set when the pointer reaches the tick, so upstream's own title changes (the Played button
 * resets it on every toggle) never fight it; the card hover menu's own Watched button is dated the same way. The dates come from one `GET /Items?Ids=` for the played ticks a page shows
 * (at most 100 ids a request), read once per item and kept current by the server's `UserDataChanged` push, which carries
 * the new date. Only the desktop layout reads them: the TV and phone layouts have no hover.
 */

const normalId = (id: string | null | undefined) => (id ?? '').replace(/-/g, '').toLowerCase();

/** Types whose tick means "every episode watched": their own `LastPlayedDate` is empty. */
const SKIPPED = new Set(['Series', 'Season', 'BoxSet']);
const BATCH = 100;

const watchedWord = () => globalize.translate('Watched');
/** Upstream's played ticks: the card indicator, the stock Played button, and React's (titled "Watched" while played). */
const ticks = (word: string) => `.playedIndicator, .playstatebutton-played, button[title="${word}"], button[title^="${word} "]`;

/** The item a tick stands for, or null when it is not one this hint dates. */
const itemOf = (tick: Element) => {
    const host = tick.hasAttribute('data-id') ? tick : tick.closest('[data-id]');
    const id = normalId(host?.getAttribute('data-id'));
    const type = tick.getAttribute('data-type') ?? tick.getAttribute('data-itemtype') ?? host?.getAttribute('data-type') ?? '';
    return id && !SKIPPED.has(type) ? id : null;
};

const hintFor = (date: string | null) => {
    const word = watchedWord();
    if (!date) return word;
    try {
        return word + ' ' + datetime.toLocaleString(datetime.parseISO8601Date(date, true),
            { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    } catch {
        return word;
    }
};

const WatchedHint: FC = () => {
    const { api, user } = useApi();
    const userId = user?.Id;

    useEffect(() => {
        if (!api || !userId) return;
        /** An item's last played date (null: none); absent while not read. */
        const dates = new Map<string, string | null>();
        const asking = new Set<string>();
        let timer: number | undefined;

        const done = (ids: string[]) => {
            for (const id of ids) asking.delete(id);
        };
        const read = (ids: string[]) => {
            for (const id of ids) asking.add(id);
            getLibraryApi(api).getItems({ userId, ids, enableImages: false, enableUserData: true, enableTotalRecordCount: false })
                .then(({ data }) => {
                    for (const id of ids) dates.set(id, null);
                    for (const item of data.Items ?? []) dates.set(normalId(item.Id), item.UserData?.LastPlayedDate ?? null);
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
            const hint = hintFor(dates.get(id) ?? null);
            if (holder.getAttribute('title') !== hint) holder.setAttribute('title', hint);
            if (holder !== tick) lent = holder;
        };

        const onUserData = ({ Data }: { Data?: UserDataChangeInfo }) => {
            if (Data?.UserId && normalId(Data.UserId) !== normalId(userId)) return;
            for (const entry of Data?.UserDataList ?? []) {
                if (entry.ItemId) dates.set(normalId(entry.ItemId), entry.LastPlayedDate ?? null);
            }
        };

        const observer = new MutationObserver(schedule);
        observer.observe(document.body, { childList: true, subtree: true });
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
