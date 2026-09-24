/** Scroll distance, in px, past which Home's transparent bar becomes solid; the same as `useModToolbarClass`. */
const SOLID_AFTER = 40;

const updateHeader = () => {
    const header = document.querySelector<HTMLElement>('.skinHeader');
    if (!header) return;

    header.classList.add('jfmod-topbar');
    header.classList.toggle('jfmod-topbarSolid', window.scrollY > SOLID_AFTER);
};

let detachCurrent: (() => void) | null = null;

/**
 * Home's transparent top bar for the TV layout (UX §7.3, P7 TV shell).
 *
 * The TV layout keeps upstream's legacy `.skinHeader` as its navigation, because that header is what the D-pad
 * already knows how to reach (§2.2, "Top bar"). The desktop and mobile shell restyle their React toolbar through
 * `useModToolbarClass`; this is the same presentation applied to the legacy header, and it is only ever called by
 * the mod's own Home tab. It used to be pushed into upstream's `hometab.js` from outside, which is why that file
 * was patched; now the page that wants the look asks for it.
 *
 * Returns the detach function. Attaching twice is harmless: the second call replaces the first.
 */
export const attachLegacyTopbar = (): (() => void) => {
    detachCurrent?.();

    window.addEventListener('scroll', updateHeader, { passive: true });
    updateHeader();

    const detach = () => {
        window.removeEventListener('scroll', updateHeader);
        document.querySelector('.skinHeader')?.classList.remove('jfmod-topbar', 'jfmod-topbarSolid');
        if (detachCurrent === detach) detachCurrent = null;
    };
    detachCurrent = detach;
    return detach;
};
