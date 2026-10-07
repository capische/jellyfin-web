import layoutManager from '../layoutManager';

/**
 * The frosted-glass look for in-player overlays on TVs that cannot blur the video behind them.
 *
 * webOS 6 (LG C1) and newer decode video onto a hardware plane below the page, so a
 * backdrop-filter has only the black hole where the video goes to work with and the overlay
 * comes out solid (layoutManager sets `noPlayerOverlayBlur` for them). Instead the item's own
 * backdrop sits under the translucent fill, blurred by the server: Jellyfin returns it at
 * 480 px with the blur already applied (a few KB), so the TV draws a plain image with no
 * filter and the full-size backdrop is never fetched. Not the live frame, but it reads as
 * frosted glass.
 *
 * Does nothing outside the TV layout, on engines that blur correctly, or when no video with
 * artwork is playing, so the overlay keeps its plain fill there.
 */

// Matches the CX's blur(1.2rem) across a 1920 px screen, about 1.5 % of the width.
const FROST_IMAGE_WIDTH = 480;
const FROST_IMAGE_BLUR = 8;

/**
 * @returns {string | null} A CSS url() of the server-blurred backdrop, or null when no frost applies.
 */
function getFrostImage() {
    if (!layoutManager.tv || !document.documentElement.classList.contains('noPlayerOverlayBlur')) {
        return null;
    }

    // The player sets this per item, unlike the poster, which keeps the previous item's artwork
    // when the next one has none.
    const backdropUrl = document.querySelector('video.htmlvideoplayer')?.dataset.backdropUrl;
    if (!backdropUrl) {
        return null;
    }

    const url = new URL(backdropUrl, window.location.href);
    // The player falls back to the cover when an item has no backdrop. Covers are portrait and
    // can come out narrower than the panel, so only real (landscape) backdrops are used.
    if (!/\/Images\/Backdrop(\/|$)/i.test(url.pathname)) {
        return null;
    }
    url.searchParams.set('maxWidth', String(FROST_IMAGE_WIDTH));
    url.searchParams.set('blur', String(FROST_IMAGE_BLUR));
    return `url("${url.href.replace(/["\\]/g, '\\$&')}")`;
}

/**
 * Frosts a dialog-style overlay. The frost carries the fill itself and the overlay is marked
 * `playerOverlayFrost-host` so its own fill can step aside; one owner of the fill means an image
 * that fails to load leaves the plain translucent look rather than a doubled, nearly solid one.
 * @param {HTMLElement} container The overlay element; receives the frost as its first child.
 */
export function appendPlayerOverlayFrost(container) {
    const image = getFrostImage();
    if (!image) {
        return;
    }

    const frost = document.createElement('div');
    frost.className = 'playerOverlayFrost';
    frost.style.setProperty('--player-overlay-frost-image', image);
    container.classList.add('playerOverlayFrost-host');
    container.insertBefore(frost, container.firstChild);
}

/**
 * Frosts a panel that scrolls its own content, where a child layer would scroll away with it:
 * the image becomes the panel's own background, which stays put. The panel's stylesheet puts
 * the fill and the image together under `playerOverlayFrost-surface`.
 * @param {HTMLElement} surface The panel element.
 */
export function applyPlayerOverlayFrost(surface) {
    const image = getFrostImage();
    if (!image) {
        return;
    }

    surface.style.setProperty('--player-overlay-frost-image', image);
    surface.classList.add('playerOverlayFrost-surface');
}
