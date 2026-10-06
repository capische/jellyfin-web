import layoutManager from '../layoutManager';

/**
 * Gives an in-player overlay a frosted-glass look on TVs that cannot blur the video behind it.
 *
 * webOS 6 (LG C1) and newer decode video onto a hardware plane below the page, so a
 * backdrop-filter has only the black hole where the video goes to work with and the overlay
 * comes out solid (layoutManager sets `noPlayerOverlayBlur` for them). Instead, a blurred copy
 * of the item's own backdrop, the image the player already fetched as its poster, sits under
 * the translucent fill. Not the live frame, but it reads as frosted glass and costs one blur of
 * a static image.
 *
 * The frost carries the fill itself and the overlay is marked `playerOverlayFrost-host` so its
 * own fill can step aside; one owner of the fill means an image that fails to load leaves the
 * plain translucent look rather than a doubled, nearly solid one.
 *
 * Does nothing outside the TV layout, on engines that blur correctly, or when no video with
 * artwork is playing, so the overlay keeps its plain fill there.
 * @param {HTMLElement} container The overlay element; receives the frost as its first child.
 */
export function appendPlayerOverlayFrost(container) {
    if (!layoutManager.tv || !document.documentElement.classList.contains('noPlayerOverlayBlur')) {
        return;
    }

    // The player sets this per item, unlike the poster, which keeps the previous item's artwork
    // when the next one has none.
    const imageUrl = document.querySelector('video.htmlvideoplayer')?.dataset.backdropUrl;
    if (!imageUrl) {
        return;
    }

    const frost = document.createElement('div');
    frost.className = 'playerOverlayFrost';
    frost.style.setProperty('--player-overlay-frost-image', `url("${imageUrl.replace(/["\\]/g, '\\$&')}")`);
    container.classList.add('playerOverlayFrost-host');
    container.insertBefore(frost, container.firstChild);
}
