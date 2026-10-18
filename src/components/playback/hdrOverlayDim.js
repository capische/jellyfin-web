import appSettings from '../../scripts/settings/appSettings';

/**
 * Sets how bright the player overlays stay while HDR video plays (see the `hdrPlayback` rules in
 * htmlVideoPlayer/style.scss). The switch is the value itself, 100 % when off, rather than a class
 * that adds and removes the filter: a changed value is repainted on the TV where a removed filter
 * may not be.
 */
export function applyHdrOverlayDim() {
    const brightness = appSettings.hdrOverlayDim() ? appSettings.hdrOverlayBrightness() : 100;
    document.documentElement.style.setProperty('--hdr-overlay-brightness', `${brightness}%`);
}
