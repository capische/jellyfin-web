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
 * Parity check on every upstream merge: `itemContextMenu`'s default export still has `show` and `getCommands`, and `show`
 * still opens its sheet through `actionSheet`'s default export with the commands `getCommands` returns. If either export is
 * missing the wraps install nothing and the item is absent.
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
    run: () => void;
}

const ITEM_ID = 'jfmod-more-item';

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
    item: MoreMenuItem;
    added: boolean;
    chosen: boolean;
}

let registered: MoreMenuItem | null = null;
let originalShow: Show | null = null;
let originalSheet: SheetShow | null = null;
const pending: Invocation[] = [];

const idsOf = (items: SheetItem[]) => items.map(item => item.id ?? '').join('\n');

const wrappedSheet: SheetShow = function (this: unknown, options) {
    const stock = originalSheet as SheetShow;
    const ids = idsOf(options?.items ?? []);
    // The sheet belongs to an invocation only when its commands and its anchor both match, and only one invocation does:
    // an overlapping menu with the same commands from another anchor, or an ambiguous pair, gets nothing added.
    const matches = pending.filter(candidate => !candidate.added && candidate.ids === ids && candidate.positionTo === options?.positionTo);
    const invocation = matches.length === 1 ? matches[0] : undefined;
    if (!invocation) return stock.call(this, options);
    invocation.added = true;
    return stock.call(this, { ...options, items: [...options.items, { id: ITEM_ID, name: invocation.item.name, icon: invocation.item.icon }] })
        .then(id => {
            if (id === ITEM_ID) invocation.chosen = true;
            return id;
        });
};

const wrappedShow: Show = async function (this: unknown, options) {
    const stock = originalShow as Show;
    const item = registered;
    if (!item || !item.matches(options) || typeof menu.getCommands !== 'function') return stock.call(this, options);
    let commands: SheetItem[];
    try {
        commands = await menu.getCommands(options);
    } catch {
        return stock.call(this, options);
    }
    const invocation: Invocation = { ids: idsOf(commands), positionTo: options.positionTo, item, added: false, chosen: false };
    pending.push(invocation);
    try {
        return await stock.call(this, options);
    } catch (error) {
        if (!invocation.chosen) throw error;
        // Only the invocation whose own sheet showed the item can have it chosen; the item runs for that call alone.
        item.run();
        return {};
    } finally {
        pending.splice(pending.indexOf(invocation), 1);
    }
};

/**
 * Registers the page's item; the returned function removes it. One page registers at a time (a detail page replaces its
 * predecessor's item when it shows). Returns null when upstream's shape has changed and nothing could be wrapped.
 */
export const registerMoreMenuItem = (item: MoreMenuItem): (() => void) | null => {
    if (typeof menu.show !== 'function' || typeof menu.getCommands !== 'function' || typeof sheet.show !== 'function') return null;
    if (menu.show !== wrappedShow) {
        originalShow = menu.show;
        menu.show = wrappedShow;
    }
    if (sheet.show !== wrappedSheet) {
        originalSheet = sheet.show;
        sheet.show = wrappedSheet;
    }
    registered = item;
    return () => {
        if (registered === item) registered = null;
    };
};
