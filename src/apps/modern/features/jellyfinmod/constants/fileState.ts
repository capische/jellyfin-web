import { type EntryEpisode, FileState, type RetentionSummary } from '../types/entry';

/**
 * The one place FileState is interpreted. A state added server-side fails loudly here rather
 * than rendering as a blank mark in six components.
 */

/** True when the entry has a playable file. */
export const hasFile = (state: FileState): boolean => state === FileState.OnDisk;

/** True when something is happening but there is nothing to play yet. */
export const isInFlight = (state: FileState): boolean =>
    state === FileState.Searching
    || state === FileState.Grabbed
    || state === FileState.Downloading;

/** Short label for the mark's tooltip and for the filter menu. */
export const FILE_STATE_LABEL: Record<FileState, string> = {
    [FileState.None]: 'Not downloaded',
    [FileState.Searching]: 'Searching indexers',
    [FileState.Grabbed]: 'Grabbed — queued',
    [FileState.Downloading]: 'Downloading',
    [FileState.OnDisk]: 'On disk',
    [FileState.Reclaimed]: 'Reclaimed — placeholder only'
};

/**
 * Whether the Not Downloaded mark is an administrator's button (P1.FU11) or, for everyone, a plain indicator. Off since P1.FU19
 * (user 2026-10-13: "As for the clickable state icon, let's remove it for now"): the mark only tells, with its tooltip; the
 * picker opens from a card's hover cloud, the card's menu, the row's menu and the page header's Get a Release. Set it back to
 * true to restore the button (the click, the focus stop, the TV hop and the failed row's "search again" all follow it).
 */
export const MARK_CLICKABLE: boolean = false;

/**
 * What a card or row mark says about a title, season or episode without a file (P1.FU11, UX §3.1): `missing` is the amber
 * Not Downloaded icon (also for a reclaimed one and for an unaired one with no air date), `unaired` the clock with its air
 * date; on disk shows nothing.
 */
export type MarkState = 'missing' | 'unaired';

/** The mark for one episode's availability; null for on disk. */
export const episodeMark = (episode: Pick<EntryEpisode, 'availability' | 'airDate'>): MarkState | null => {
    if (episode.availability === 'onDisk') return null;
    return episode.availability === 'unaired' && episode.airDate ? 'unaired' : 'missing';
};

/** A whole season's mark: unaired only while every episode is unaired with a date, then the first air date; else missing. */
export const seasonMark = (episodes: EntryEpisode[]): { state: MarkState; airDate: string | null } => {
    const unaired = episodes.length > 0 && episodes.every(episode => episodeMark(episode) === 'unaired');
    const first = unaired ? episodes.map(episode => episode.airDate!).sort((a, b) => a.localeCompare(b))[0] : null;
    return { state: unaired ? 'unaired' : 'missing', airDate: first };
};

// Air dates are calendar dates (`2027-03-12`): read and written in UTC, so no time zone moves them a day.
const UTC = { timeZone: 'UTC' } as const;

/** `10 Aug` in the air date's own year, `Aug ’27` in another (user, 2026-10-12); month names in the viewer's locale. */
export const airDateShort = (airDate: string, now = new Date()): string => {
    const date = new Date(airDate);
    if (date.getUTCFullYear() === now.getFullYear()) return date.toLocaleDateString(undefined, { ...UTC, day: 'numeric', month: 'short' });
    return date.toLocaleDateString(undefined, { ...UTC, month: 'short' }) + ' \u2019' + ('0' + (date.getUTCFullYear() % 100)).slice(-2);
};

/** `19 May 2027`: the row's meta line and the Unaired tooltip. */
export const airDateLong = (airDate: string): string =>
    new Date(airDate).toLocaleDateString(undefined, { ...UTC, day: 'numeric', month: 'short', year: 'numeric' });

/** Days remaining before reclaim, or null when retention does not apply. */
export const daysUntilReclaim = (reclaimAt?: string | null): number | null => {
    if (!reclaimAt) return null;
    const ms = new Date(reclaimAt).getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / 86400000));
};

/** A deadline only exists when automatic retention is enabled and scheduled. */
export const retentionDeadline = (retention?: RetentionSummary | null): string | null =>
    retention?.enabled && retention.state === 'scheduled' ? retention.deadline : null;

/** Episodes are tracked one by one and carry their own Keep (P10.E1-E2). */
export const EPISODE_RETENTION_CAPABILITY = 'retention.episodes';

/** Episode un-Keep and window editor, per-file Keep and multi-episode files (PHASE10 Q3-Q5). */
export const EPISODE_CONTROLS_CAPABILITY = 'retention.episodeControls';
export const VERSION_KEEP_CAPABILITY = 'retention.versionKeep';

export const keepButtonLabel = (busy: boolean, kept: boolean): string => {
    if (busy) return 'Keeping…';
    return kept ? 'Kept' : 'Keep';
};

const PROTECTION_MESSAGES = new Map([
    ['favorite', 'Protected while marked as a favourite.'],
    ['favorite_series', 'Protected while marked as a favourite.'],
    ['active_session', 'Protected while it is playing.'],
    ['active_resume', 'Protected while playback is in progress.'],
    ['waiting_for_completion', 'Waiting for the configured watched rule.'],
    // The public vocabulary shown to non-administrators (P3.T15).
    ['protected', 'Protected from automatic removal.'],
    ['series_unavailable', 'Protected while its series cannot be read.'],
    ['episode_versions_untracked', 'Kept while this episode has more than one file.'],
    ['version_kept', 'This file is kept.'],
    ['multi_episode_not_all_due', 'Kept until every episode in this file is due.']
]);

/** Privacy-safe wording shared by native, file-less and episode details. */
export const retentionMessage = (retention?: RetentionSummary | null): string => {
    if (retention?.reason === 'kept') return 'Kept indefinitely.';
    if (!retention || !retention.enabled || retention.state === 'disabled') return 'Automatic removal is off.';
    if (retention.state === 'scheduled' && retention.deadline) {
        const deadline = new Date(retention.deadline);
        const days = daysUntilReclaim(retention.deadline);
        if (days === 0) return 'Eligible for automatic removal today.';
        return `Scheduled for ${deadline.toLocaleDateString()} · ${days} day${days === 1 ? '' : 's'} remaining.`;
    }
    // Non-administrators are not given the deadline, which could reveal other users' activity (P3.T15).
    if (retention.state === 'scheduled') return 'Scheduled for automatic removal after watching.';
    if (retention.state === 'mixed') return 'Episodes have different retention schedules.';
    const protectionMessage = PROTECTION_MESSAGES.get(retention.reason);
    if (protectionMessage) return protectionMessage;
    if (retention.reason.startsWith('seed_') || retention.reason.startsWith('seeding_')) return 'Waiting for seeding requirements.';
    if (retention.reason.includes('storage') || retention.reason.includes('path') || retention.reason.includes('identity')) {
        return 'Protected by a storage safety check.';
    }
    return retention.state === 'blocked' ? 'Automatic removal is blocked.' : 'Waiting for retention eligibility.';
};
