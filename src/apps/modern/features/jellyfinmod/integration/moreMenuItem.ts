import actionsheet from 'components/actionSheet/actionSheet';
import itemContextMenu from 'components/itemContextMenu';

/**
 * One mod item in upstream's More (`⋯`) menu on a detail page (user, 2026-10-07; UX §7 "More-menu coupling").
 *
 * P7.S6 took the old hook out of upstream's detail controller. This brings an item back without touching an upstream file,
 * by two runtime wraps installed once from the mod's own code:
 *
 * - `itemContextMenu.show`: for a call the registered page claims (its own header More button, for its own item), the wrap
 *   reads the stock commands for that call and records a pending invocation of its own, then runs the stock `show`
 *   unchanged.
 * - `actionsheet.show`: a sheet whose items are exactly the commands of a pending invocation gets the mod item appended,
 *   and that invocation is consumed. Any other sheet — another menu, an overlapping call, a stock sheet — passes through
 *   untouched. The wrap stays in place; nothing is swapped back and forth, so overlapping calls cannot leave it wrong.
 *
 * Choosing the item makes upstream's command switch reject an id it does not know; the wrap answers that call with an empty
 * result (nothing deleted, nothing updated, so the stock page does nothing) and runs the item. Every other choice is exactly
 * upstream's.
 *
 * Several items may be registered at once (a series page's Keep Series and Shuffle, P1.FU12); each call gets every item that
 * claims it, in registration order.
 *
 * A card's item menu (P1.FU12: Get a Release on touch and TV, where cards have no hover overlay) does not pass through the
 * default export's `show`: upstream's `shortcuts.js` imports the module itself and calls its named `show`, which cannot be
 * wrapped. So card items are matched at the sheet: a sheet opened from inside a movie, series, season or episode card
 * (`positionTo` is the card or its More button) that no detail-page invocation claims asks the registered card items, by the
 * card's `data-id` and `data-type`. Choosing one runs it once the sheet closes; upstream's command switch then rejects the
 * unknown id, which `shortcuts.js` ignores.
 *
 * Parity check on every upstream merge: `itemContextMenu`'s default export still has `show` and `getCommands`, and `show`
 * still opens its sheet through `actionSheet`'s default export with the commands `getCommands` returns; a card's menu still
 * opens that sheet with `positionTo` inside the card. If either export is missing the wraps install nothing and the items are
 * absent.
 */

interface MenuOptions {
    item?: { Id?: string } | null;
    positionTo?: Element | null;
}

export interface MoreMenuItem {
    /** True when this call of the menu is the registered page's own header More menu for its own item. */
    matches: (options: MenuOptions) => boolean;
    name: string;
    icon?: string;
    /** The sheet item's `data-id`; `jfmod-more-item` when absent. Unique among the items one menu can show. */
    id?: string;
    run: () => void;
}

/** What a card item adds to one card's menu; null adds nothing. */
export interface CardMenuEntry {
    name: string;
    icon?: string;
    id: string;
    run: () => void;
}

/** Asked for each card menu: the card's Jellyfin item id and type (`Movie`, `Series`, `Season`, `Episode`). */
export type CardMenuItem = (card: { itemId: string; type: string; element: HTMLElement }) => Promise<CardMenuEntry | null>;

const ITEM_ID = 'jfmod-more-item';
const CARD_TYPES = new Set(['Movie', 'Series', 'Season', 'Episode']);

interface SheetItem {
    id?: string;
    name?: string;
    icon?: string;
}

type Show = (options: MenuOptions) => Promise<unknown>;
type GetCommands = (options: MenuOptions) => Promise<SheetItem[]>;
type SheetShow = (options: { items: SheetItem[]; positionTo?: Element | null }) => Promise<string>;

const menu = itemContextMenu as unknown as { show?: Show; getCommands?: GetCommands };
const sheet = actionsheet as unknown as { show?: SheetShow };

interface Invocation {
    ids: string;
    /** The element the menu opens from, which upstream forwards to the sheet. */
    positionTo: Element | null | undefined;
    items: MoreMenuItem[];
    added: boolean;
    chosen: MoreMenuItem | null;
}

const registered: MoreMenuItem[] = [];
const cardItems: CardMenuItem[] = [];
let originalShow: Show | null = null;
let originalSheet: SheetShow | null = null;
const pending: Invocation[] = [];

const idsOf = (items: SheetItem[]) => items.map(item => item.id ?? '').join('\n');

const sheetIdOf = (item: { id?: string }) => item.id ?? ITEM_ID;

/** The movie, series, season or episode card a sheet opens from (its More button, or the card itself), if any. */
const cardOf = (positionTo: Element | null | undefined) => {
    const card = positionTo instanceof Element ? positionTo.closest<HTMLElement>('.card[data-id]') : null;
    const type = card?.getAttribute('data-type') ?? '';
    const itemId = card?.getAttribute('data-id');
    return card && itemId && CARD_TYPES.has(type) ? { itemId, type, element: card } : null;
};

/** Shows the stock sheet with the given items appended and returns what was chosen (the mod item, if it was one). */
const showWith = <T extends { id?: string; name: string; icon?: string }>(stock: SheetShow, self: unknown,
    options: Parameters<SheetShow>[0], added: T[]) => stock.call(self, {
    ...options,
    items: [...options.items, ...added.map(item => ({ id: sheetIdOf(item), name: item.name, icon: item.icon }))]
}).then(id => ({ id, chosen: added.find(item => sheetIdOf(item) === id) ?? null }));

/** A card's menu: the registered card items that claim this card, appended; the chosen one runs once the sheet closes. */
const cardSheet = (stock: SheetShow, self: unknown, options: Parameters<SheetShow>[0]) => {
    const card = cardOf(options?.positionTo);
    if (!card || !cardItems.length) return stock.call(self, options);
    return Promise.all(cardItems.map(item => item(card).catch(() => null))).then(found => {
        const entries = found.filter((entry): entry is CardMenuEntry => !!entry);
        if (!entries.length) return stock.call(self, options);
        return showWith(stock, self, options, entries).then(({ id, chosen }) => {
            chosen?.run();
            return id;
        });
    });
};

const wrappedSheet: SheetShow = function (this: unknown, options) {
    const stock = originalSheet as SheetShow;
    const ids = idsOf(options?.items ?? []);
    // The sheet belongs to an invocation only when its commands and its anchor both match, and only one invocation does:
    // an overlapping menu with the same commands from another anchor, or an ambiguous pair, gets nothing added.
    const matches = pending.filter(candidate => !candidate.added && candidate.ids === ids && candidate.positionTo === options?.positionTo);
    const invocation = matches.length === 1 ? matches[0] : undefined;
    if (!invocation) return cardSheet(stock, this, options);
    invocation.added = true;
    return showWith(stock, this, options, invocation.items).then(({ id, chosen }) => {
        invocation.chosen = chosen;
        return id;
    });
};

const wrappedShow: Show = async function (this: unknown, options) {
    const stock = originalShow as Show;
    const items = registered.filter(item => item.matches(options));
    if (!items.length || typeof menu.getCommands !== 'function') return stock.call(this, options);
    let commands: SheetItem[];
    try {
        commands = await menu.getCommands(options);
    } catch {
        return stock.call(this, options);
    }
    const invocation: Invocation = { ids: idsOf(commands), positionTo: options.positionTo, items, added: false, chosen: null };
    pending.push(invocation);
    try {
        return await stock.call(this, options);
    } catch (error) {
        if (!invocation.chosen) throw error;
        // Only the invocation whose own sheet showed the item can have it chosen; the item runs for that call alone.
        invocation.chosen.run();
        return {};
    } finally {
        pending.splice(pending.indexOf(invocation), 1);
    }
};

/** Installs both wraps once; false when upstream's shape has changed and nothing could be wrapped. */
const install = () => {
    if (typeof menu.show !== 'function' || typeof menu.getCommands !== 'function' || typeof sheet.show !== 'function') return false;
    if (menu.show !== wrappedShow) {
        originalShow = menu.show;
        menu.show = wrappedShow;
    }
    if (sheet.show !== wrappedSheet) {
        originalSheet = sheet.show;
        sheet.show = wrappedSheet;
    }
    return true;
};

const removeFrom = <T>(list: T[], value: T) => () => {
    const index = list.indexOf(value);
    if (index !== -1) list.splice(index, 1);
};

/**
 * Registers a page's item; the returned function removes it. Returns null when upstream's shape has changed and nothing could
 * be wrapped.
 */
export const registerMoreMenuItem = (item: MoreMenuItem): (() => void) | null => {
    if (!install()) return null;
    registered.push(item);
    return removeFrom(registered, item);
};

/** Registers an item for cards' menus (P1.FU12); the returned function removes it. Null as for `registerMoreMenuItem`. */
export const registerCardMenuItem = (item: CardMenuItem): (() => void) | null => {
    if (!install()) return null;
    cardItems.push(item);
    return removeFrom(cardItems, item);
};
