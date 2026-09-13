import { FileState } from '../types/entry';

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
