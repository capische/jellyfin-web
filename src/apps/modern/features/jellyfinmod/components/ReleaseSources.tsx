import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import classNames from 'classnames';
import React, { type CSSProperties, type FC, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import layoutManager from 'components/layoutManager';

import { indexerColour, indexerTick } from '../constants/indexerColours';

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
    /** A failure: the state in red. */
    bad: boolean;
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
    /** Names the search on screen; a change of the ticked sources after it ends puts the dot back to grey or none. */
    generation: string;
}

/** The funnel: three lines, each shorter, as the design draws it. */
const FunnelGlyph = () => <svg className='jfmod-releaseGlyph' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.3'
    strokeLinecap='round' aria-hidden='true' focusable='false'><path d='M4 6h16M7 12h10M10 18h4' /></svg>;

/**
 * The corner dot's state once nothing runs: the last indexer's colour (red when one failed) while the search's results are on
 * screen as it ended; once the ticked sources change, grey while some are unticked and none while all are.
 */
const restingDot = (props: SourcesProps, narrowed: boolean, touched: boolean): { colour: string | null; kind: string } | null => {
    const { train, showing } = props;
    if (showing && train.finished && !touched) return train.failed ? { colour: null, kind: 'failed' } : { colour: train.rest, kind: 'done' };
    return narrowed ? { colour: null, kind: 'narrowed' } : null;
};

interface SourceItemProps {
    line: SourceLine;
    last: boolean;
    onToggle: (id: string) => void;
    /** Set by MUI's MenuList on its children (the first line's focus on opening, the roving tab stop); passed on to the item. */
    autoFocus?: boolean;
    tabIndex?: number;
}

/** One checklist line: the checkbox in the indexer's colour, the name, the state at the right. */
const SourceItem: FC<SourceItemProps> = ({ line, last, onToggle, autoFocus, tabIndex }) => {
    const toggle = useCallback(() => {
        if (!last) onToggle(line.id);
    }, [last, line.id, onToggle]);
    const style = { ['--jfmod-src' as string]: indexerColour(line.colorIndex), ['--jfmod-tick' as string]: indexerTick(line.colorIndex) };
    return <MenuItem role='menuitemcheckbox' aria-checked={line.ticked} aria-disabled={last || undefined}
        className={classNames('jfmod-sourceItem', { 'jfmod-sourceItem--off': !line.ticked })} data-jfmod-source={line.id}
        title={last ? 'At least one source stays on' : undefined} onClick={toggle} tabIndex={tabIndex}
        // eslint-disable-next-line jsx-a11y/no-autofocus -- MUI's MenuList focuses its first item on opening through this prop
        autoFocus={autoFocus}>
        <span className='jfmod-sourceCheck' style={style} aria-hidden='true' />
        <span className='jfmod-sourceName'>{line.name}</span>
        <span className={classNames('jfmod-sourceState', { 'jfmod-sourceState--bad': line.bad })}>{line.state}</span>
    </MenuItem>;
};

/**
 * The Sources icon and its checklist. The menu stays open while lines are toggled and closes on Back, Escape or a click outside;
 * MUI returns focus to the icon, and `shell/dpadModals` gives it arrows, Enter and Back on the TV. On the phone it spans the width
 * under the title row.
 */
export const ReleaseSources: FC<SourcesProps> = props => {
    const { slot, lines, onToggle, searching, train, generation } = props;
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    // The search whose finished dot a change of the ticked sources has put away.
    const [touched, setTouched] = useState<string | null>(null);
    const toggle = useCallback((id: string) => {
        setTouched(generation);
        onToggle(id);
    }, [generation, onToggle]);
    const open = useCallback((event: React.MouseEvent<HTMLButtonElement>) => setAnchor(event.currentTarget), []);
    const close = useCallback(() => setAnchor(null), []);
    const ticked = lines.filter(line => line.ticked).length;
    const narrowed = lines.length > 0 && ticked < lines.length;
    const label = narrowed ? `Sources · ${ticked} of ${lines.length}` : 'Sources';
    const rest = searching ? null : restingDot(props, narrowed, touched === generation);
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
            {lines.map(line => <SourceItem key={line.id} line={line} last={line.ticked && ticked === 1} onToggle={toggle} />)}
        </Menu>
    </>, slot);
};
