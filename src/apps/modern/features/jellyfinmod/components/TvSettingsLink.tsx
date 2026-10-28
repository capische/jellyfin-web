import React, { type FC } from 'react';

import layoutManager from 'components/layoutManager';

import './tvSettingsLink.scss';

import { useRatingsPreferencesVisible, useSettingsVisible } from '../hooks/useSettingsVisible';
import { raisedButtonClass } from '../utils/flatButton';

/**
 * The TV's way into the settings area once the setup banner is gone (REVIEW-2026-09-24 S8-R2, PHASE7 default 15).
 *
 * On a TV the header is upstream's legacy one, whose user button opens upstream's preferences rather than the mod
 * user menu, so without this the area is reachable only by typing an address. It sits below the Home rows, where
 * Down from the last row lands, for administrators only, and only on the TV: every other layout has the user menu.
 * A plain anchor with upstream's button classes, so upstream's focus manager and TV focus ring apply unchanged.
 */
const TvSettingsLink: FC = () => {
    const visible = useSettingsVisible();
    // Ratings display is every user's (Phase 9), and the TV's header has no mod user menu either.
    const ratings = useRatingsPreferencesVisible();
    if (!(visible || ratings) || !layoutManager.tv) return null;
    return (
        <div className='padded-left padded-right jfmod-tvSettingsLink'>
            {ratings && <a className={raisedButtonClass()} href='#/catalog/preferences' data-jfmod-tv-ratings=''>
                <span>Ratings Display</span>
            </a>}
            {visible && <a className={raisedButtonClass()} href='#/catalog/settings' data-jfmod-tv-settings=''>
                <span>JellyfinMod Settings</span>
            </a>}
        </div>
    );
};

export default TvSettingsLink;
