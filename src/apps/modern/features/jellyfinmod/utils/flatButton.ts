import layoutManager from 'components/layoutManager';

import './flatButton.scss';

/**
 * The class list of a mod flat button. Stock pairs `emby-button` with `button-flat` or `raised`, and on the TV layout adds
 * `show-focus` so the theme paints the focused button; React buttons are not upgraded by the custom element, so this adds it.
 * `jfmod-flatButton` gives keyboard focus a visible ring outside TV, where `.emby-button` removes the outline.
 */
export const flatButtonClass = (): string => 'emby-button button-flat jfmod-flatButton' + (layoutManager.tv ? ' show-focus' : '');
