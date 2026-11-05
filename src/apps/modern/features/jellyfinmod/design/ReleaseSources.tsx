import React, { type FC, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { indexerColour, indexerTick } from '../constants/indexerColours';
import InfoPopover from './InfoPopover';
import { Menu } from './Menu';
import { ReleaseGlyph } from './Release';

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

const SourceItem: FC<{ line: SourceLine; last: boolean; onToggle: (id: string) => void; onInfo: (info: InfoOpen) => void }> = ({ line, last, onToggle, onInfo }) => {
    const colour = indexerColour(line.colorIndex);
    return <div className={'srow focusable' + (line.ticked ? '' : ' un')} role='menuitemcheckbox' tabIndex={0} aria-checked={line.ticked}
        aria-disabled={last} data-jfmod-source={line.id} title={last ? 'At least one source stays on' : undefined}
        onClick={() => { if (!last) onToggle(line.id); }} onKeyDown={event => {
            if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault();
                if (!last) onToggle(line.id);
            }
        }}>
        <span className='box' aria-hidden='true' style={{ borderColor: colour, background: line.ticked ? colour : undefined, color: indexerTick(line.colorIndex) }}>{line.ticked && <ReleaseGlyph name='tick' />}</span>
        <b>{line.name}</b>
        {line.bad && line.failure && <button type='button' className='inf focusable' title={line.failure} aria-label={'Why ' + line.name + ' failed'}
            onMouseDown={event => {
                event.preventDefault();
                event.currentTarget.closest<HTMLElement>('.srow')?.focus();
            }}
            onClick={event => {
                event.stopPropagation();
                onInfo({ anchor: event.currentTarget, title: line.name, message: line.failure ?? '' });
            }}><ReleaseGlyph name='info' /></button>}
        {line.slowSetupHowTo && <a className='slow focusable' title='How to speed it up' aria-label='Slow setup · How to speed it up' href={line.slowSetupHowTo}
            target='_blank' rel='noopener noreferrer' onClick={event => event.stopPropagation()}>⚠ slow setup</a>}
        <span className={'st' + (line.bad ? ' fail' : '')}>{line.state}</span>
    </div>;
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
    if (lines.length === 0) return null;
    return createPortal(<>
        <button type='button' className={'rb focusable' + (anchor ? ' foc' : '')} data-tip={label} aria-label={label} aria-haspopup='true' aria-expanded={!!anchor}
            onClick={open}><ReleaseGlyph name='funnel' />
            {searching && train.cars.map(car => <i key={car.id} className='sat' aria-hidden='true'
                style={{ background: car.colour, transform: 'rotate(' + car.angle + 'deg) translateY(-1em)' }} />)}
            {rest && <i className='srcdot' aria-hidden='true' style={{ background: rest.kind === 'failed' ? '#e53935' : rest.colour ?? 'var(--text-70)' }} />}
        </button>
        {anchor && <Menu label='Sources' anchor={anchor} close={close} className='srcmenu' anchored>
            {lines.map(line => <SourceItem key={line.id} line={line} last={line.ticked && ticked === 1} onToggle={onToggle} onInfo={setInfo} />)}
        </Menu>}
        {/* Outside the menu in React's tree too, so the popover's keys and clicks never reach the menu's list or a line. */}
        <InfoPopover anchor={info?.anchor ?? null} title={info?.title ?? ''} message={info?.message ?? ''} onClose={closeInfo}
            row={info?.anchor.closest<HTMLElement>('.srow')} />
    </>, slot);
};
