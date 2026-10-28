import React, { type FC } from 'react';

import layoutManager from 'components/layoutManager';

import './phoneMark.scss';

/** Material `smartphone`, the glyph Jellyfin's own Play On menu draws for a phone (`PlayTargetIcon.tsx`). */
const SMARTPHONE = 'M17 1.01 7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99zM17 19H7V5h10v14z';

/**
 * The phone mark (Phase 12, D52 and D54, user-approved 2026-10-29): a small phone after a name, on the one file phones play
 * ("Phones play this copy") and on the quality profile for phones ("Quality profile for phones"). 1.05em, the name's colour at
 * 86 %, `.28em` after it; the label is its tooltip and its accessible name, and the TV, which has no pointer, gets no tooltip.
 */
const PhoneMark: FC<{ label: string }> = ({ label }) => (
    <span className='jfmod-phoneMark' role='img' aria-label={label} title={layoutManager.tv ? undefined : label} data-jfmod-phone-mark=''>
        <svg viewBox='0 0 24 24' aria-hidden='true' focusable='false'><path d={SMARTPHONE} /></svg>
    </span>
);

/** The phone mark's words on a file. */
export const PHONE_COPY_LABEL = 'Phones play this copy';

/** The phone mark's words on a quality profile. */
export const PHONE_PROFILE_LABEL = 'Quality profile for phones';

export default PhoneMark;
