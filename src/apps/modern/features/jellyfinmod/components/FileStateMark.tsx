import ScheduleOutlined from '@mui/icons-material/ScheduleOutlined';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
import SyncProblemOutlined from '@mui/icons-material/SyncProblemOutlined';
import classNames from 'classnames';
import React, { type FC, type ReactNode, useCallback, useEffect, useRef } from 'react';

import focusManager from 'components/focusManager';
import layoutManager from 'components/layoutManager';
import { useApi } from 'hooks/useApi';

import { airDateLong, airDateShort, daysUntilReclaim, FILE_STATE_LABEL, type MarkState, retentionDeadline } from '../constants/fileState';
import { RELEASES_CAPABILITY, usePluginCapabilities } from '../hooks/useAcquisition';
import { openReleasePickerForEntry } from '../integration/releasePicker';
import { restoreFocusTo } from '../integration/stockHeaderButton';
import { type Entry, FileState, type RetentionSummary } from '../types/entry';

import './fileStateMark.scss';

/** What the Not Downloaded mark opens for an administrator: its tooltip (Title Case) and the picker in that scope. */
export interface MarkDownload {
    label: string;
    open: (button: HTMLElement) => void;
}

interface FileStateMarkProps {
    /** A title's card, list row or poster: the mark follows its file state. */
    entry?: Entry;
    retention?: RetentionSummary | null;
    /** Show the retention countdown regardless of how far off it is (used by the filtered view). */
    alwaysShowCountdown?: boolean;
    /** A season or an episode without a Jellyfin item (P1.FU11): the mark is given, not read from an entry. */
    state?: MarkState | null;
    airDate?: string | null;
    /** The Not Downloaded mark as an administrator's button; absent, it is a plain indicator. */
    download?: MarkDownload | null;
    /** An entry's own mark offers its picker to administrators; false keeps it an indicator (the detail page's poster). */
    interactive?: boolean;
    /** `row`: the action slot at a list row's end; otherwise a card's top-right corner. */
    variant?: 'card' | 'row';
}

/** An entry with no file to play: nothing on disk and nothing in flight, or reclaimed. */
const entryMark = (entry: Entry): MarkState | null =>
    (entry.state === FileState.None || entry.state === FileState.Reclaimed ? 'missing' : null);

/**
 * An administrator's Not Downloaded on an entry's card opens the picker as the title's own page does: a movie's, or a
 * series' seasons. Only where the plugin serves release search; never for a card still being added.
 */
const useEntryDownload = (entry: Entry | undefined, wanted: boolean): MarkDownload | null => {
    const { api, user } = useApi();
    const isAdmin = !!user?.Policy?.IsAdministrator;
    const canAcquire = usePluginCapabilities(api, wanted && isAdmin).includes(RELEASES_CAPABILITY);
    const entryId = entry?.id;
    const open = useCallback((button: HTMLElement) => {
        if (!api || !entryId) return;
        openReleasePickerForEntry(api, entryId).then(() => restoreFocusTo(button), () => restoreFocusTo(button));
    }, [api, entryId]);
    if (!entry || !wanted || !canAcquire || entry.id.startsWith('pending:')) return null;
    return { label: entry.mediaType === 'movie' ? 'Download This Movie' : 'Download This Series', open };
};

/**
 * The administrator's round button. Its click is taken natively on the button and goes no further, so neither the card's
 * link, the card's own click, nor upstream's item container (which acts on the card around it) sees it.
 */
const MarkButton: FC<{ className: string; download: MarkDownload; children: ReactNode }> = ({ className, download, children }) => {
    const ref = useRef<HTMLButtonElement>(null);
    const openRef = useRef(download.open);
    openRef.current = download.open;
    useEffect(() => {
        const button = ref.current;
        if (!button) return;
        const onClick = (event: Event) => {
            event.preventDefault();
            event.stopPropagation();
            openRef.current(button);
        };
        button.addEventListener('click', onClick);
        // On the TV a card is itself a focus stop and the icon sits inside it, where spatial navigation never lands: Up on the
        // card goes to its icon and Down on the icon back to the card, before the page's own D-pad handling sees the key. A
        // missing episode's row (a stop since P1.FU15) holds its icon at its end: Right goes to it and Left back.
        const card = layoutManager.tv ? button.closest<HTMLElement>('button.card, button.jfmod-missingRow') : null;
        const [into, back] = card?.classList.contains('jfmod-missingRow') ? ['ArrowRight', 'ArrowLeft'] : ['ArrowUp', 'ArrowDown'];
        const hop = (event: KeyboardEvent, key: string, from: HTMLElement, to: HTMLElement) => {
            if (event.key !== key || event.target !== from) return;
            event.preventDefault();
            event.stopPropagation();
            focusManager.focus(to);
        };
        const up = (event: KeyboardEvent) => card && hop(event, into, card, button);
        const down = (event: KeyboardEvent) => card && hop(event, back, button, card);
        card?.addEventListener('keydown', up);
        if (card) button.addEventListener('keydown', down);
        return () => {
            button.removeEventListener('click', onClick);
            card?.removeEventListener('keydown', up);
            button.removeEventListener('keydown', down);
        };
    }, []);
    return <button ref={ref} type='button' className={className + ' jfmod-markButton'} title={download.label}
        aria-label={download.label}>{children}</button>;
};

/**
 * The countdown, or the searching icon, when one of them takes the slot; null otherwise. A download (grabbed, downloading,
 * importing) is not drawn here: the bar along the card's bottom and the arrow in its corner are drawn from the queue for
 * every card on the page at once (integration/downloadMarks, P4.FU1).
 */
const busyMark = (entry: Entry | undefined, countdown: number | null, base: string) => {
    if (countdown !== null) {
        return (
            <div
                className={classNames(base, 'jfmod-mark--countdown', { 'jfmod-countdown--urgent': countdown <= 2 })}
                title={`File will be removed in ${countdown} day${countdown === 1 ? '' : 's'}`}
            >
                <span className='jfmod-countdown'>{countdown}d</span>
            </div>
        );
    }
    if (entry?.state === FileState.Searching) {
        return <div className={base + ' jfmod-mark--inFlight'} title={FILE_STATE_LABEL[entry.state]}><SearchOutlined fontSize='inherit' /></div>;
    }
    return null;
};

/**
 * The one set of marks on cards and rows (UX §3.1, P1.FU11): nothing for on disk; the amber Not Downloaded icon, a button
 * for administrators that opens the release picker in its scope and a plain indicator for everyone else; the clock with the
 * short air date for something not aired yet; the magnifier while it is searched for; a close retention deadline takes the
 * slot as a countdown. Cards put it top right, rows at their end. A download takes the slot from Not Downloaded (P4.FU1).
 */
const FileStateMark: FC<FileStateMarkProps> = ({ entry, retention, alwaysShowCountdown = false, state, airDate, download,
    interactive = true, variant = 'card' }) => {
    const mark = entry ? entryMark(entry) : state ?? null;
    const entryDownload = useEntryDownload(entry, interactive && mark === 'missing');
    const days = entry ? daysUntilReclaim(retentionDeadline(retention)) : null;
    const base = classNames('jfmod-mark', { 'jfmod-mark--row': variant === 'row' });
    const busy = busyMark(entry, days !== null && (alwaysShowCountdown || days <= 3) ? days : null, base);
    if (busy) return busy;

    if (mark === 'unaired' && airDate) {
        return (
            <div className={base + ' jfmod-mark--unaired'} title={'Airs ' + airDateLong(airDate)}>
                <ScheduleOutlined fontSize='inherit' />
                <span className='jfmod-markDate'>{airDateShort(airDate)}</span>
            </div>
        );
    }
    if (!mark) return null;

    const action = entry ? entryDownload : download;
    if (action) {
        return <MarkButton className={base + ' jfmod-mark--none'} download={action}><SyncProblemOutlined fontSize='inherit' /></MarkButton>;
    }
    return (
        <div className={base + ' jfmod-mark--none'} title='Not Downloaded'>
            <SyncProblemOutlined fontSize='inherit' />
        </div>
    );
};

export default FileStateMark;
