import { useEffect, useState } from 'react';

type Kind = 'played' | 'favorite';

/**
 * Played and Favourite as the user has just set them, until the server's copy of the item catches up or the save fails, so a
 * card or the hero answers a click at once, as the title page's controls do, rather than after every Home row has refetched.
 */
export const useShownUserData = (played?: boolean, favorite?: boolean) => {
    const [shown, setShown] = useState<Partial<Record<Kind, boolean>>>({});
    useEffect(() => setShown({}), [played, favorite]);
    return {
        played: shown.played ?? !!played,
        favorite: shown.favorite ?? !!favorite,
        show: (kind: Kind, value: boolean) => setShown(current => ({ ...current, [kind]: value })),
        reset: () => setShown({})
    };
};
