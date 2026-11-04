import React, { type FC } from 'react';

import layoutManager from 'components/layoutManager';

import { Root } from '../design/Root';

import { useRatingsPreferencesVisible, useSettingsVisible } from '../hooks/useSettingsVisible';

/**
 * The TV's way into the settings area once the setup banner is gone (REVIEW-2026-09-24 S8-R2, PHASE7 default 15).
 *
 * Keep the existing stops below the Home rows, where Down from the last row lands, with their original visibility
 * and routes. Native source buttons now supply their appearance; the same focus manager walks them.
 */
const TvSettingsLink: FC = () => {
    const visible = useSettingsVisible();
    // Ratings display is every user's (Phase 9), and the TV's header has no mod user menu either.
    const ratings = useRatingsPreferencesVisible();
    if (!(visible || ratings) || !layoutManager.tv) return null;
    return (
        <Root><div className='sect plain'><div className='btncol'><div className='btnstack'>
            {ratings && <a className='btn focusable' href='#/catalog/preferences' data-jfmod-tv-ratings=''>
                <span>Ratings Display</span>
            </a>}
            {visible && <a className='btn focusable' href='#/catalog/settings' data-jfmod-tv-settings=''>
                <span>JellyfinMod Settings</span>
            </a>}
        </div></div></div></Root>
    );
};

export default TvSettingsLink;
