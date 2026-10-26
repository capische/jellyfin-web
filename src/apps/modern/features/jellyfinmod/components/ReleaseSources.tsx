import InfoOutlined from '@mui/icons-material/InfoOutlined';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import classNames from 'classnames';
import React, { type CSSProperties, type FC, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import layoutManager from 'components/layoutManager';

import { indexerColour, indexerTick } from '../constants/indexerColours';
import InfoPopover from './InfoPopover';
import { SlowSetupLink } from './SlowSetup';

import './releaseSources.scss';

/**
 * The release picker's Sources (P4.FU25, approved 2026-10-25; docs/jellyfinmod/design/guides/release-picker-sources.md): a round
 * icon first in the title row whose corner dot carries the search (the train), and the checklist of indexers it opens. Untick
 * hides an indexer's rows, tick shows them (and asks it when this search did not); the picker owns that behaviour, this file only
 * draws.
 */

/** One indexer of the checklist, in the plugin's order. */
export interface SourceLine {
    id: string;
    name: string;
    colorIndex?: number;
    ticked: boolean;
    /** What it is doing or found, at the right: `8 releases · 2 rejected`, `asking…`, `hidden · 3 releases`. */
    state: string;
    /** A failure: the state `failed` in red. */
    bad: boolean;
    /** A failure's explanation behind the line's (i): the plugin's message, or the short reason (`timed out`) when it sent none. */
    failure?: string;
    /** The how-to's address when the indexer runs on Prowlarr's slow default 1337x definition (P4.FU27). */
    slowSetupHowTo?: string | null;
}

/** One indexer of the running search, for the train. */
export interface TrainLine {
    id: string;
    colorIndex?: number;
    /** Answered, found nothing, or failed. */
    finished: boolean;
    failed: boolean;
    /** When its first query went out, to order the followers by asking. */
    startedAt?: string | null;
}

/** How long a follower takes to close the gap and merge into the lead. */
const MERGE_MS = 450;
/** The gap between two cars of the train, in degrees. */
const GAP = 40;

const hue = (colour: string | null): CSSProperties => (colour ? { ['--jfmod-src' as string]: colour } : {});

interface TrainView {
    /** The lead's colour while searching (null: grey): the last indexer whose follower has merged. */
    lead: string | null;
    /** The colour the dot rests in once the search is over: the last indexer that finished. */
    rest: string | null;
    /** The followers still asked, behind the lead in asking order; a merging one sits on the lead, fading. */
    cars: Array<{ id: string; colour: string; angle: number; merging: boolean }>;
    /** Whether any indexer of the search failed: the dot rests red. */
    failed: boolean;
    /** Whether any indexer finished (a search has an end to show). */
    finished: boolean;
}

/**
 * The train (user, 2026-10-25): each indexer still asked follows the grey lead round the icon, 40° apart in asking order; when
 * one finishes its follower closes the gap and merges, and the lead takes its colour. `generation` names the search: a new one
 * starts with a grey lead again.
 */
export const useTrain = (lines: TrainLine[], generation: string): TrainView => {
    const [order, setOrder] = useState<string[]>([]);
    const [merged, setMerged] = useState<string[]>([]);
    const seen = useRef(generation);
    const timers = useRef<number[]>([]);
    useEffect(() => () => {
        for (const timer of timers.current) window.clearTimeout(timer);
    }, []);
    const fresh = seen.current !== generation;
    useEffect(() => {
        if (seen.current === generation) return;
        seen.current = generation;
        setOrder([]);
        setMerged([]);
    }, [generation]);
    const finishedIds = lines.filter(line => line.finished).map(line => line.id).join(',');
    useEffect(() => {
        const done = finishedIds ? finishedIds.split(',') : [];
        const added = done.filter(id => !order.includes(id));
        if (added.length === 0) return;
        setOrder(current => current.concat(added.filter(id => !current.includes(id))));
        added.forEach((id, index) => {
            // Several that finish between two reads merge one after the other, so each colour shows in turn.
            timers.current.push(window.setTimeout(() => setMerged(current => (current.includes(id) ? current : current.concat(id))),
                MERGE_MS * (index + 1)));
        });
    }, [finishedIds, order]);
    const byId = new Map(lines.map(line => [line.id, line]));
    const colourOf = (id: string) => indexerColour(byId.get(id)?.colorIndex);
    const currentOrder = fresh ? [] : order;
    const currentMerged = fresh ? [] : merged;
    const lastMerged = currentMerged.length ? currentMerged[currentMerged.length - 1] : null;
    const asked = lines.filter(line => !line.finished)
        .sort((a, b) => (a.startedAt ? Date.parse(a.startedAt) : Infinity) - (b.startedAt ? Date.parse(b.startedAt) : Infinity));
    const merging = currentOrder.filter(id => !currentMerged.includes(id) && byId.has(id));
    const cars = [
        ...merging.map(id => ({ id, colour: colourOf(id), angle: 0, merging: true })),
        ...asked.map((line, index) => ({ id: line.id, colour: colourOf(line.id), angle: -GAP * (index + 1), merging: false }))
    ];
    // The dot rests in the last finished indexer's colour; a search over before any read saw it finish rests in the last line's.
    const lastFinished = currentOrder.length ? currentOrder[currentOrder.length - 1] : null;
    const last = lastFinished ?? (asked.length === 0 && lines.length > 0 ? lines[lines.length - 1].id : null);
    return {
        lead: lastMerged && byId.has(lastMerged) ? colourOf(lastMerged) : null,
        rest: last && byId.has(last) ? colourOf(last) : null,
        cars,
        failed: lines.some(line => line.failed),
        finished: lines.length > 0 && asked.length === 0
    };
};

interface SourcesProps {
    /** The title row's place for the icon, first of the four (releasePicker.ts). */
    slot: HTMLElement;
    lines: SourceLine[];
    onToggle: (id: string) => void;
    /** A search (or an indexer asked alone) is running. */
    searching: boolean;
    train: TrainView;
    /** Results are on screen: the finished dot rests in the corner. */
    showing: boolean;
}

/** The funnel: three lines, each shorter, as the design draws it. */
const FunnelGlyph = () => <svg className='jfmod-releaseGlyph' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.3'
    strokeLinecap='round' aria-hidden='true' focusable='false'><path d='M4 6h16M7 12h10M10 18h4' /></svg>;

/**
 * The corner dot's state once nothing runs: grey while some sources are unticked; with all ticked, the search's result while it
 * is on screen, the last indexer's colour or red when one failed (user, 2026-10-26: unticking and ticking back brings it back).
 */
const restingDot = (props: SourcesProps, narrowed: boolean): { colour: string | null; kind: string } | null => {
    const { train, showing } = props;
    if (narrowed) return { colour: null, kind: 'narrowed' };
    if (showing && train.finished) return train.failed ? { colour: null, kind: 'failed' } : { colour: train.rest, kind: 'done' };
    return null;
};

/** What the open popover explains: the (i) that opened it and its line. */
interface InfoOpen {
    anchor: HTMLElement;
    title: string;
    message: string;
}

interface SourceItemProps {
    line: SourceLine;
    last: boolean;
    onToggle: (id: string) => void;
    /** Opens the (i)'s popover; null while it is open, so the tooltip gives way to it. */
    onInfo: ((info: InfoOpen) => void) | null;
    /** Set by MUI's MenuList on its children (the first line's focus on opening, the roving tab stop); passed on to the item. */
    autoFocus?: boolean;
    tabIndex?: number;
}

/**
 * The computer's keyboard on the (i) (Codex final review, 2026-10-26): Left goes back to its line, Up and Down move as its line
 * does (the line takes focus first, so MUI's list moves from it), and its own keys never reach the list's type-ahead. The TV's
 * `shell/dpadModals` moves the remote's focus itself.
 */
const infoKeys = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (layoutManager.tv) return;
    const line = event.currentTarget.closest<HTMLElement>('.jfmod-sourceItem');
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        line?.focus();
        if (event.key === 'ArrowLeft') event.preventDefault();
        return;
    }
    if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
};

/** Right on a failed line steps into its (i) on the computer, as it does on the TV (Codex final review, 2026-10-26). */
const lineKeys = (event: React.KeyboardEvent<HTMLLIElement>) => {
    if (layoutManager.tv || event.key !== 'ArrowRight' || event.target !== event.currentTarget) return;
    const info = event.currentTarget.querySelector<HTMLElement>('.jfmod-infoButton');
    if (!info) return;
    event.preventDefault();
    info.focus();
};

/**
 * A failed line's (i), right after the name (approved 2026-10-26; guides/info-tip.md): the message in a tooltip above it on hover
 * or keyboard focus (the computer), and a popover on a click, a tap or Enter. A click never toggles the line, and a pointer press
 * leaves focus on the line, so the keyboard's Enter still toggles it; Right reaches it from its line and Left goes back.
 */
const FailureInfo: FC<{ line: SourceLine; onInfo: SourceItemProps['onInfo'] }> = ({ line, onInfo }) => {
    const message = line.failure ?? '';
    const open = (event: React.MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        onInfo?.({ anchor: event.currentTarget, title: line.name, message });
    };
    // A pointer press leaves focus on the line (as the slow-setup label does), so the popover hands it back there.
    const keepLineFocus = (event: React.MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.closest<HTMLElement>('.jfmod-sourceItem')?.focus();
    };
    const button = <IconButton className='jfmod-infoButton' aria-label={'Why ' + line.name + ' failed'} onClick={open}
        onMouseDown={keepLineFocus} onKeyDown={infoKeys} onTouchStart={event => event.stopPropagation()} disableRipple>
        <InfoOutlined className='jfmod-infoGlyph' aria-hidden='true' focusable='false' />
    </IconButton>;
    if (layoutManager.tv || layoutManager.mobile) return button;
    return <Tooltip title={onInfo ? message : ''} placement='top' describeChild
        slotProps={{ popper: { className: 'jfmod-infoTipPopper' } }}>{button}</Tooltip>;
};

/** One checklist line: the checkbox in the indexer's colour, the name, the state at the right. */
const SourceItem: FC<SourceItemProps> = ({ line, last, onToggle, onInfo, autoFocus, tabIndex }) => {
    const toggle = useCallback(() => {
        if (!last) onToggle(line.id);
    }, [last, line.id, onToggle]);
    const failure = line.bad ? line.failure : undefined;
    const style = { ['--jfmod-src' as string]: indexerColour(line.colorIndex), ['--jfmod-tick' as string]: indexerTick(line.colorIndex) };
    // ARIA 1.3's aria-description, which the rule does not know yet: a screen reader reads the failure with the line.
    // eslint-disable-next-line jsx-a11y/role-supports-aria-props
    return <MenuItem role='menuitemcheckbox' aria-checked={line.ticked} aria-disabled={last || undefined}
        className={classNames('jfmod-sourceItem', { 'jfmod-sourceItem--off': !line.ticked })} data-jfmod-source={line.id}
        title={last ? 'At least one source stays on' : undefined} onClick={toggle} onKeyDown={failure ? lineKeys : undefined} tabIndex={tabIndex}
        aria-description={failure}
        // eslint-disable-next-line jsx-a11y/no-autofocus -- MUI's MenuList focuses its first item on opening through this prop
        autoFocus={autoFocus}>
        <span className='jfmod-sourceCheck' style={style} aria-hidden='true' />
        <span className='jfmod-sourceName'>{line.name}{failure && <FailureInfo line={line} onInfo={onInfo} />}
            {line.slowSetupHowTo && <SlowSetupLink href={line.slowSetupHowTo} />}</span>
        <span className={classNames('jfmod-sourceState', { 'jfmod-sourceState--bad': line.bad })}>{line.state}</span>
    </MenuItem>;
};

/**
 * The Sources icon and its checklist. The menu stays open while lines are toggled and closes on Back, Escape or a click outside;
 * MUI returns focus to the icon, and `shell/dpadModals` gives it arrows, Enter and Back on the TV. On the phone it spans the width
 * under the title row.
 */
export const ReleaseSources: FC<SourcesProps> = props => {
    const { slot, lines, onToggle, searching, train } = props;
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const open = useCallback((event: React.MouseEvent<HTMLButtonElement>) => setAnchor(event.currentTarget), []);
    const close = useCallback(() => setAnchor(null), []);
    const [info, setInfo] = useState<InfoOpen | null>(null);
    const closeInfo = useCallback(() => setInfo(null), []);
    const ticked = lines.filter(line => line.ticked).length;
    const narrowed = lines.length > 0 && ticked < lines.length;
    const label = narrowed ? `Sources · ${ticked} of ${lines.length}` : 'Sources';
    const rest = searching ? null : restingDot(props, narrowed);
    const phone = layoutManager.mobile;
    const header = slot.closest('.formDialogHeader');
    const below = phone && header ? header.getBoundingClientRect().bottom : 0;
    if (lines.length === 0) return null;
    return createPortal(<>
        <button type='button' className={classNames('paper-icon-button-light autoSize jfmod-releaseAction jfmod-sourcesButton',
            { 'show-focus': layoutManager.tv })} title={label} aria-label={label} aria-haspopup='true' aria-expanded={!!anchor}
        onClick={open}>
            <FunnelGlyph />
            {searching && <span className='jfmod-srcTrain' aria-hidden='true'>
                <span className='jfmod-srcCar jfmod-srcCar--lead' style={hue(train.lead)}><i /></span>
                {train.cars.map(car => <span key={car.id}
                    className={classNames('jfmod-srcCar', { 'jfmod-srcCar--merging': car.merging })}
                    style={{ ...hue(car.colour), transform: 'rotate(' + car.angle + 'deg)' }}><i /></span>)}
            </span>}
            {searching && <span className='jfmod-srcDot jfmod-srcDot--searching' aria-hidden='true' />}
            {rest && <span className={'jfmod-srcDot jfmod-srcDot--' + rest.kind} style={hue(rest.colour)} aria-hidden='true' />}
        </button>
        {/* `menu`, not the default `selectedMenu`: with no selected line the first line takes focus on opening, so the D-pad has a
            target (UX §13 rule 5). */}
        <Menu open={!!anchor} anchorEl={anchor} onClose={close} className='jfmod-sourcesMenu' variant='menu'
            slotProps={{ list: { 'aria-label': 'Sources' }, paper: { className: phone ? 'jfmod-sourcesMenu-phone' : undefined } }}
            {...(phone ? {
                anchorReference: 'anchorPosition' as const, anchorPosition: { top: below, left: 0 }, marginThreshold: 0
            } : { anchorOrigin: { vertical: 'bottom', horizontal: 'right' } as const,
                transformOrigin: { vertical: 'top', horizontal: 'right' } as const })}>
            {lines.map(line => <SourceItem key={line.id} line={line} last={line.ticked && ticked === 1} onToggle={onToggle}
                onInfo={info ? null : setInfo} />)}
        </Menu>
        {/* Outside the menu in React's tree too, so the popover's keys and clicks never reach the menu's list or a line. */}
        <InfoPopover anchor={info?.anchor ?? null} title={info?.title ?? ''} message={info?.message ?? ''} onClose={closeInfo}
            row={info?.anchor.closest<HTMLElement>('.jfmod-sourceItem')} />
    </>, slot);
};
