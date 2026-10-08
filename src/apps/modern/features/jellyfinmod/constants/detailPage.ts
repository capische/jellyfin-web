import type { HistoryRecord, RetentionSummary, RetentionWarning } from '../types/entry';
import type { VersionDto } from '../types/versions';
import { describeVersion } from './versions';

/**
 * The episode and movie detail page as the user designed it on 2026-10-07 (docs/jellyfinmod/design/
 * episode-page-design-spec.md): the wording and arithmetic of the Played badge, the file rows and the per-file history.
 */

/** History events about one file carry that file's binding (Health capability, plugin 0.1.0.0 design fix). */
export const HISTORY_FILES_CAPABILITY = 'history.files';

const DAY = 86400000;

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/** Whole calendar days from today to the deadline: `0` on the day itself, negative once the day has passed. */
export const calendarDaysUntil = (deadline: string, now = new Date()): number =>
    Math.round((startOfDay(new Date(deadline)) - startOfDay(now)) / DAY);

/** `12 Oct`, or `12 Oct 2025` when the date is not in this year. */
export const shortDate = (value: string, now = new Date()): string => {
    const date = new Date(value);
    const sameYear = date.getFullYear() === now.getFullYear();
    return date.toLocaleDateString(undefined, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
};

export interface PlayedBadge {
    /** `5`, `0`, `!` or `∞`. */
    text: string;
    kept: boolean;
    title: string;
}

/**
 * What the Played tick wears (design step 4): the whole days until the deadline, `0` on the day, `!` once the deadline has
 * passed (the file goes at the next retention run), `∞` while the file is kept. Computed from the absolute deadline on
 * every render, never cached as a count. Null when there is nothing to say.
 */
export const playedBadge = (warning: RetentionWarning | null | undefined, kept: boolean, now = new Date()): PlayedBadge | null => {
    if (warning) {
        const date = shortDate(warning.deadline, now);
        const days = calendarDaysUntil(warning.deadline, now);
        const overdue = warning.overdue || new Date(warning.deadline).getTime() <= now.getTime();
        let text = String(days);
        if (overdue) text = '!';
        else if (days < 0) text = '0';
        const title = overdue ?
            `Was due on ${date}; removed at the next retention run unless kept · ${warning.cause}` :
            `Removed on ${date} unless kept · ${warning.cause}`;
        return { text, kept: false, title };
    }
    return kept ? { text: '∞', kept: true, title: 'Kept indefinitely' } : null;
};

/** Why retention is holding a file back, which no badge says. Waiting to be watched is the ordinary case and says nothing. */
const PROTECTION_REASONS = new Set(['favorite', 'favorite_series', 'active_session', 'active_resume', 'protected',
    'series_unavailable', 'episode_versions_untracked', 'multi_episode_not_all_due']);

/**
 * The one-line retention status stays only for what the badge cannot show (user, 2026-10-07): a blocked or mixed state and
 * the protection reasons. "Automatic removal is off.", a scheduled window and a Keep are said by the badge and the rows.
 */
export const showsRetentionStatus = (retention: RetentionSummary | null | undefined): boolean => {
    if (!retention?.enabled || retention.state === 'disabled' || retention.reason === 'kept') return false;
    return retention.state === 'blocked' || retention.state === 'mixed' || PROTECTION_REASONS.has(retention.reason)
        || retention.reason.startsWith('seed_') || retention.reason.startsWith('seeding_');
};

/** `1080p · HEVC 10-bit · 783 MB`: the popover's title for one file. */
export const fileTitle = (version: VersionDto): string => {
    const text = describeVersion(version);
    return [text.resolution, text.video, text.size].filter(Boolean).join(' · ');
};

const ACTION_WORDS = new Map([
    ['grabbed', 'Grabbed'],
    ['auto_grabbed', 'Grabbed'],
    ['imported', 'Imported'],
    ['version_kept', 'Kept'],
    ['version_unkept', 'Stopped keeping'],
    ['version_removed', 'Removed'],
    ['upgrade_replaced', 'Removed'],
    ['reclaimed', 'Removed'],
    // Season and series packs (2026-10-08): a Replace that removed the older files, or kept them and says why; files and
    // episodes a pack skipped.
    ['pack_replaced', 'Replaced'],
    ['pack_replace_refused', 'Not replaced'],
    ['pack_file_skipped', 'Skipped'],
    ['pack_episode_skipped', 'Skipped']
]);

/** The release group at the end of a scene-style release title (`…x265-PSA` → `PSA`). */
const releaseGroup = (release: string): string | null => /-([A-Za-z0-9]{2,})(\.[a-z0-9]{2,4})?$/.exec(release.trim())?.[1] ?? null;

/**
 * The words after the action for one file's event, without the file's name: the quality, indexer and size of a grab; the
 * version label and release group of an import. Other events need no detail.
 */
const eventDetail = (event: HistoryRecord): string | null => {
    const summary = event.summary;
    if (event.eventType === 'grabbed' || event.eventType === 'auto_grabbed') {
        const rest = summary.replace(/^(Automatically grabbed|Grabbed)\s+/, '').replace(/^S\d+E\d+\s+/, '');
        return rest || null;
    }
    if (event.eventType === 'pack_replaced' || event.eventType === 'pack_replace_refused') {
        // `S01E01: replaced old.mkv.` → `old.mkv`; `S01E01: kept old.mkv (kept) beside the new file.` → that sentence.
        const rest = summary.replace(/^S\d+E\d+:\s*/, '').replace(/^replaced\s+/, '').replace(/\.$/, '');
        return rest || null;
    }
    if (event.eventType === 'imported') {
        const rest = summary.replace(/^Imported\s+(S\d+E\d+\s+)?/, '');
        const from = rest.lastIndexOf(' from ');
        if (from < 0) return null;
        const label = rest.slice(0, from).trim();
        const group = releaseGroup(rest.slice(from + ' from '.length));
        const parts = [label, group ? 'from ' + group : null].filter(Boolean);
        return parts.length > 0 ? parts.join(' ') : null;
    }
    return null;
};

export interface FileHistoryLine {
    id: string;
    date: string;
    dateTime: string;
    action: string;
    detail: string | null;
}

/** One file's events, newest first, as the popover lists them (design step 3). */
export const fileHistory = (history: HistoryRecord[], bindingId: string, now = new Date()): FileHistoryLine[] => history
    .filter(event => event.bindingId && event.bindingId.replace(/-/g, '').toLowerCase() === bindingId.replace(/-/g, '').toLowerCase())
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map(event => ({
        id: event.id,
        date: shortDate(event.createdAt, now),
        dateTime: event.createdAt,
        action: ACTION_WORDS.get(event.eventType) ?? event.summary.split(' ')[0] ?? event.eventType,
        detail: eventDetail(event)
    }));
