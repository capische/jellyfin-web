import WarningIcon from '@mui/icons-material/Warning';
import React, { type FC } from 'react';

import './slowSetup.scss';

/**
 * Prowlarr's slow default 1337x definition (P4.FU27, approved 2026-10-25; docs/jellyfinmod/design/guides/buttons-and-row-actions.md
 * and release-picker-sources.md). The plugin sends `slowSetupHowTo`, the how-to's address, only for a synced indexer on that
 * definition; nothing shows for the one-page `1337x-fast`, other definitions or manual indexers.
 */

/** The warning glyph and its words in the warning amber; the words carry the meaning, the glyph is hidden from screen readers. */
const SlowMark: FC<{ text: string }> = ({ text }) => <><WarningIcon className='jfmod-slowGlyph' aria-hidden='true' focusable='false' />{text}</>;

/**
 * A settings row's title line: "⚠ Slow setup · How to speed it up" after the name. The group never breaks inside and moves under
 * the name as one piece when it does not fit; the link opens the how-to in a new tab.
 */
export const SlowSetupGroup: FC<{ href: string }> = ({ href }) => <span className='jfmod-indexerSlow'>
    <span className='jfmod-slow'><SlowMark text='Slow setup' /></span>
    {' · '}
    <a href={href} target='_blank' rel='noopener noreferrer'>How to speed it up</a>
</span>;

/**
 * The release picker's checklist label "⚠ slow setup" after the indexer's name: a link to the how-to that does not toggle the
 * line, and no focus stop, so on the keyboard and the TV Enter always toggles the line (the link for them is in Settings).
 */
export const SlowSetupLink: FC<{ href: string }> = ({ href }) => {
    // The line's toggle never sees the click; the link opens as links do (plain, modified and middle clicks alike).
    const stop = (event: React.SyntheticEvent) => event.stopPropagation();
    // A pointer press leaves focus on the line, not on the link, so the next Enter still toggles the line.
    const keepLineFocus = (event: React.MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault();
        event.currentTarget.closest<HTMLElement>('.jfmod-sourceItem')?.focus();
    };
    return <a className='jfmod-slow jfmod-sourceSlow' href={href} target='_blank' rel='noopener noreferrer' tabIndex={-1}
        data-jfmod-dpad-skip='' title='How to speed it up' aria-label='How to speed it up' onClick={stop} onMouseDown={keepLineFocus}>
        <SlowMark text='slow setup' /></a>;
};
