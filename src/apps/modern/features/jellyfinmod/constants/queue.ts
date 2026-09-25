import type { QueueRow, QueueSeeding, QueueState, SeedWaitReason } from '../types/queue';

/**
 * The one place queue states and reason codes are worded, as `retentionMessage` is for retention (P5.I8). The
 * sentences match the plugin's own, so a row reads the same whether the server sent `message` or only `reason`.
 */

/** The Health capability a plugin build advertises when it serves the queue (P5.I7). */
export const QUEUE_CAPABILITY = 'queue';

export const QUEUE_ROUTE = '/catalog/queue';

/** The Health capability a plugin build advertises when it runs scheduled searches (P6.M3). */
export const AUTOMATION_CAPABILITY = 'automation';

/** Polling interval while the queue or an in-flight mark is on screen; no websocket (UX §10). */
export const QUEUE_POLL_MS = 3000;

export const QUEUE_STATE_LABEL: Record<QueueState, string> = {
    queued: 'Queued',
    downloading: 'Downloading',
    stalled: 'Stalled',
    identifying: 'Identifying the file',
    linking: 'Linking into the library',
    scanning: 'Waiting for the library scan',
    seeding: 'Seeding',
    blocked: 'Blocked',
    failed: 'Failed',
    unknown: 'Status unknown'
};

const IMPORT_REASONS = new Map([
    ['path_unmapped', 'The download\'s path is not mapped to a folder Jellyfin can open.'],
    ['source_missing', 'The downloaded file could not be found.'],
    ['source_size_mismatch', 'The downloaded file\'s size does not match the torrent.'],
    ['no_video_file', 'The torrent contains no video file.'],
    ['ambiguous_files', 'The torrent contains several files that could be the title.'],
    ['archive_unsupported', 'The release is packed in an archive, which is never extracted.'],
    ['episode_mismatch', 'The file is a different episode from the one grabbed.'],
    ['target_exists', 'This episode already has a file.'],
    ['cross_filesystem', 'The download and the library are on different mounts; nothing was copied.'],
    ['destination_not_writable', 'The library folder cannot be written.'],
    ['destination_collision', 'Another file already has the destination name.'],
    ['library_root_missing', 'The library has no usable folder.'],
    ['scan_timeout', 'Jellyfin did not scan the new file in time.'],
    ['binding_not_observed', 'Jellyfin did not add the new file to the library.'],
    ['client_unreachable', 'The download client cannot be reached.'],
    ['torrent_missing', 'The download client no longer has this torrent.'],
    ['import_disabled', 'Importing is turned off.'],
    ['cancelled', 'It was removed from the queue.'],
    ['target_missing', 'The title was removed from the catalog.'],
    ['client_missing', 'The download client is no longer configured.']
]);

const SEED_REASONS = new Map([
    ['seed_goal_unmet', 'Seeding until its goal is met.'],
    ['seeding_incomplete', 'Still downloading.'],
    ['seed_release_disabled', 'Kept seeding: automatic release is off.'],
    ['torrent_not_owned', 'JellyfinMod did not add this torrent.'],
    ['retention_operation_open', 'Waiting for a retention operation to finish.'],
    ['seeding_path_inside_library', 'The seeding copy is inside a library folder.'],
    ['library_link_unexpected', 'The library file disappeared outside JellyfinMod.'],
    ['seeding_path_unavailable', 'The seeding copy is not where it was imported from.'],
    ['seeding_copy_survived', 'The client removed the torrent but its file is still on disk.']
]);

/** Why automation is not grabbing, one short sentence per `pausedReasons` code (P6.M8). */
const AUTOMATION_PAUSED_REASONS = new Map([
    ['disabled', 'Automation is turned off.'],
    ['budget_grabs', 'Today\'s grab budget is used up.'],
    ['too_many_open_imports', 'Too many downloads are still being imported.'],
    ['free_space_floor', 'Free space in the library is below the configured floor.'],
    ['client_unreachable', 'The download client cannot be reached.'],
    ['acquisition_not_ready', 'Indexers or the download client are not ready.'],
    ['breaker_open', 'Every indexer is paused by its circuit breaker after repeated failures.']
]);

/**
 * The queue's automation line for administrators: null when automation runs, a quiet `off` when the master switch
 * is the only reason, and otherwise every reason in words, each once.
 */
export const automationPausedText = (pausedReasons: string[] | null | undefined): { quiet: boolean; text: string } | null => {
    if (!pausedReasons?.length) return null;
    if (pausedReasons.every(reason => reason === 'disabled')) return { quiet: true, text: 'Automation is off.' };
    const sentences = pausedReasons.map(reason => AUTOMATION_PAUSED_REASONS.get(reason) ?? 'Another safeguard is holding it.');
    return { quiet: false, text: 'Automation paused: ' + Array.from(new Set(sentences)).join(' ') };
};

/** Refusals of Remove and Retry, by ProblemDetails `type`. */
const ACTION_ERRORS = new Map([
    ['not_in_queue', 'It has already left the queue.'],
    ['seed_release_in_progress', 'The seeding copy is being released. Try again shortly.'],
    ['client_unreachable', 'The download client cannot be reached. Nothing was changed.'],
    ['torrent_not_owned', 'JellyfinMod did not add this torrent, so it was not removed from the client.'],
    ['seeding_path_inside_library', 'The seeding copy is inside a library folder, so it was not removed.'],
    ['client_missing', 'The download client is no longer configured.'],
    ['import_open', 'An import for this download is already running.'],
    ['import_not_retryable', 'Only a blocked or failed import can be retried.'],
    ['grab_missing', 'The original grab no longer exists.'],
    ['queue_admin_only', 'Only an administrator can change the queue.']
]);

/** The sentence for an import or seed-release reason code; the server's own sentence wins when it sent one. */
export const reasonMessage = (reason: string | null | undefined, serverMessage?: string | null): string | null => {
    if (serverMessage) return serverMessage;
    if (!reason) return null;
    return IMPORT_REASONS.get(reason) ?? SEED_REASONS.get(reason) ?? 'Something needs attention.';
};

export const actionErrorMessage = (error: unknown, fallback: string): string => {
    const data = (error as { response?: { data?: { type?: unknown; title?: unknown } } })?.response?.data;
    const type = typeof data?.type === 'string' ? data.type : '';
    return ACTION_ERRORS.get(type) ?? (typeof data?.title === 'string' ? data.title : fallback);
};

/** Rows whose import has not finished; Retry is offered only for blocked and failed ones. */
export const isRetryable = (state: QueueState) => state === 'blocked' || state === 'failed';

/** Active transfers first, then imports needing attention, then seeding copies (stable within a group). */
const STATE_ORDER: Record<QueueState, number> = {
    downloading: 0, stalled: 0, unknown: 0, queued: 1, identifying: 2, linking: 2, scanning: 2,
    blocked: 3, failed: 3, seeding: 4
};

export const sortQueueRows = (rows: QueueRow[]): QueueRow[] => rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => (STATE_ORDER[a.row.state] ?? 5) - (STATE_ORDER[b.row.state] ?? 5)
        || Date.parse(a.row.createdAt) - Date.parse(b.row.createdAt) || a.index - b.index)
    .map(item => item.row);

/** Truncates rather than rounds, so 99.6 % never reads as finished. */
export const progressPercent = (progress: number | null | undefined): number | null => {
    if (progress === null || progress === undefined || !Number.isFinite(progress)) return null;
    return Math.floor(Math.min(1, Math.max(0, progress)) * 100);
};

export const formatBytes = (bytes: number | null | undefined): string | null => {
    if (bytes === null || bytes === undefined) return null;
    if (bytes >= 1e12) return (bytes / 1e12).toFixed(2) + ' TB';
    if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
    if (bytes >= 1e6) return Math.round(bytes / 1e6) + ' MB';
    if (bytes >= 1e3) return Math.round(bytes / 1e3) + ' kB';
    return bytes + ' B';
};

export const formatRate = (bytesPerSecond: number | null | undefined): string | null => {
    const size = formatBytes(bytesPerSecond);
    return size === null ? null : size + '/s';
};

export const formatDuration = (seconds: number | null | undefined): string | null => {
    if (seconds === null || seconds === undefined || seconds < 0) return null;
    if (seconds < 60) return Math.ceil(seconds) + ' s';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return minutes + ' min';
    const hours = Math.floor(minutes / 60);
    if (hours < 48) return hours + ' h' + (minutes % 60 ? ' ' + (minutes % 60) + ' min' : '');
    return Math.round(hours / 24) + ' d';
};

/**
 * Age of an observation, measured against the server's own `generatedAt` so a skewed client clock cannot make a
 * stale row look fresh (UX §14).
 */
export const updatedAgo = (observedAt: string | null, generatedAt: string): string | null => {
    if (!observedAt) return null;
    const seconds = Math.max(0, Math.round((Date.parse(generatedAt) - Date.parse(observedAt)) / 1000));
    if (!Number.isFinite(seconds)) return null;
    return 'Updated ' + (formatDuration(seconds) ?? '0 s') + ' ago';
};

export const episodeCode = (seasonNumber: number, episodeNumber: number) =>
    'S' + String(seasonNumber).padStart(2, '0') + 'E' + String(episodeNumber).padStart(2, '0');

/** The parsed primary line: the entry title, and for an episode its code and name. */
export const queueRowTitle = (row: QueueRow): string => {
    let title = row.releaseTitle;
    if (row.entry) title = row.entry.year ? row.entry.title + ' (' + row.entry.year + ')' : row.entry.title;
    if (!row.episode) return title;
    return title + ' · ' + episodeCode(row.episode.seasonNumber, row.episode.episodeNumber)
        + (row.episode.title ? ' · ' + row.episode.title : '');
};

const WAIT_WORDS: Record<SeedWaitReason, string> = {
    complete: 'the download to finish',
    ratio: 'the ratio goal',
    time: 'the seeding time goal'
};

const joinWords = (words: string[]) => {
    if (words.length < 2) return words.join('');
    return words.slice(0, -1).join(', ') + ' and ' + words[words.length - 1];
};

/** Ratio, time and what the release still waits for, in words (UX §13 rows are read from across the room). */
export const seedingSummary = (seeding: QueueSeeding): string => {
    const parts: string[] = [];
    if (seeding.ratio !== null) {
        parts.push('Ratio ' + seeding.ratio.toFixed(2) + (seeding.goalRatio !== null ? ' of ' + seeding.goalRatio.toFixed(2) : ''));
    }
    const seeded = formatDuration(seeding.seedingSeconds);
    if (seeded) {
        const goal = formatDuration(seeding.goalSeconds);
        parts.push('seeded ' + seeded + (goal ? ' of ' + goal : ''));
    }
    if (seeding.state === 'removing') {
        parts.push('releasing the seeding copy');
    } else if (seeding.waitingFor.length > 0) {
        parts.push('waiting for ' + joinWords(seeding.waitingFor.map(reason => WAIT_WORDS[reason] ?? reason)));
    } else if (seeding.goalMetAt) {
        parts.push('goal met');
    }
    const text = parts.join(' · ');
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : 'Seeding';
};
