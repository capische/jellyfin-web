import { FileState, type RetentionSummary } from '../types/entry';

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

/** Days remaining before reclaim, or null when retention does not apply. */
export const daysUntilReclaim = (reclaimAt?: string | null): number | null => {
    if (!reclaimAt) return null;
    const ms = new Date(reclaimAt).getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / 86400000));
};

/** A deadline only exists when automatic retention is enabled and scheduled. */
export const retentionDeadline = (retention?: RetentionSummary | null): string | null =>
    retention?.enabled && retention.state === 'scheduled' ? retention.deadline : null;

const PROTECTION_MESSAGES = new Map([
    ['favorite', 'Protected while marked as a favourite.'],
    ['favorite_series', 'Protected while marked as a favourite.'],
    ['active_session', 'Protected while it is playing.'],
    ['active_resume', 'Protected while playback is in progress.'],
    ['waiting_for_completion', 'Waiting for the configured watched rule.']
]);

/** Privacy-safe wording shared by native, file-less and episode details. */
export const retentionMessage = (retention?: RetentionSummary | null): string => {
    if (!retention || !retention.enabled || retention.state === 'disabled') return 'Automatic removal is off.';
    if (retention.reason === 'kept') return 'Kept indefinitely.';
    if (retention.state === 'scheduled' && retention.deadline) {
        const deadline = new Date(retention.deadline);
        const days = daysUntilReclaim(retention.deadline);
        if (days === 0) return 'Eligible for automatic removal today.';
        return `Scheduled for ${deadline.toLocaleDateString()} · ${days} day${days === 1 ? '' : 's'} remaining.`;
    }
    if (retention.state === 'mixed') return 'Episodes have different retention schedules.';
    const protectionMessage = PROTECTION_MESSAGES.get(retention.reason);
    if (protectionMessage) return protectionMessage;
    if (retention.reason.startsWith('seed_') || retention.reason.startsWith('seeding_')) return 'Waiting for seeding requirements.';
    if (retention.reason.includes('storage') || retention.reason.includes('path') || retention.reason.includes('identity')) {
        return 'Protected by a storage safety check.';
    }
    return retention.state === 'blocked' ? 'Automatic removal is blocked.' : 'Waiting for retention eligibility.';
};
