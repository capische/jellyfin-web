import { useLayoutEffect } from 'react';

/** The root marker reaches body portals, and is removed before an excluded route paints. */
export const useChromeScope = (enabled: boolean, art: boolean, player: boolean) => {
    useLayoutEffect(() => {
        if (!enabled) return;
        const root = document.documentElement;
        root.classList.add('jfmod-chrome');
        root.classList.toggle('jfmod-chromeArt', art);
        root.classList.toggle('jfmod-chromePlayer', player);

        // Some upstream menus express selection only with an icon, rather than aria-selected.
        // Keep that source of truth; add the presentation hook without changing their controls.
        const markCurrent = () => {
            document.querySelectorAll<HTMLElement>('.MuiMenuItem-root').forEach(row => {
                row.classList.toggle('jfmod-currentChoice', !!row.querySelector(
                    '[data-testid="CheckIcon"], [data-testid="ArrowUpwardIcon"], [data-testid="ArrowDownwardIcon"]'
                ));
            });
        };
        markCurrent();
        const observer = new MutationObserver(markCurrent);
        observer.observe(document.body, { childList: true, subtree: true });
        return () => {
            observer.disconnect();
            root.classList.remove('jfmod-chrome', 'jfmod-chromeArt', 'jfmod-chromePlayer');
            document.querySelectorAll('.jfmod-currentChoice').forEach(row => {
                row.classList.remove('jfmod-currentChoice');
            });
        };
    }, [enabled, art, player]);
};
