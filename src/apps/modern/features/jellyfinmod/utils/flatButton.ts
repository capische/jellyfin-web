import layoutManager from 'components/layoutManager';

import './flatButton.scss';

/**
 * The class list of a mod flat button. Stock pairs `emby-button` with `button-flat` or `raised`, and on the TV layout adds
 * `show-focus` so the theme paints the focused button; React buttons are not upgraded by the custom element, so this adds it.
 * `jfmod-flatButton` gives keyboard focus a visible ring outside TV, where `.emby-button` removes the outline.
 */
export const flatButtonClass = (): string => 'emby-button button-flat jfmod-flatButton' + (layoutManager.tv ? ' show-focus' : '');

/**
 * The class list of a mod raised (or submit) button, with `show-focus` on the TV layout so the focused button is painted the
 * way stock paints its own (whole-review chunk 4a, P2 2): without it the theme removes the outline and nothing shows
 * which action Enter will take.
 */
export const raisedButtonClass = (extra?: string, kind: 'raised' | 'button-submit' = 'raised'): string =>
    ['emby-button', kind, extra, layoutManager.tv ? 'show-focus' : undefined].filter(Boolean).join(' ');
