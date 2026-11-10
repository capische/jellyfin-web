import { useEffect, useState } from 'react';

type Kind = 'played' | 'favorite';

interface Shown {
    /** The item the values were set for. */
    id: string | null | undefined;
    values: Partial<Record<Kind, boolean>>;
}

/**
 * Played and Favourite as the user has just set them, until the server's copy of the item catches up or the save fails, so a
 * card or the hero answers a click at once, as the title page's controls do, rather than after every Home row has refetched. It
 * belongs to one item: when another item takes the place (the hero's next episode), the new one shows its own state, and a
 * click made for the old one (a confirmation still open) never changes what the new one shows.
 */
export const useShownUserData = (id: string | null | undefined, played?: boolean, favorite?: boolean) => {
    const [shown, setShown] = useState<Shown>({ id, values: {} });
    useEffect(() => setShown({ id, values: {} }), [id, played, favorite]);
    const own = shown.id === id ? shown.values : {};
    return {
        played: own.played ?? !!played,
        favorite: own.favorite ?? !!favorite,
        show: (kind: Kind, value: boolean) => setShown(current => ({
            id, values: current.id === id ? { ...current.values, [kind]: value } : { [kind]: value }
        })),
        reset: () => setShown(current => (current.id === id ? { id, values: {} } : current))
    };
};
