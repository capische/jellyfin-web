/** The Health capability of a plugin that answers `GET /JellyfinMod/Trakt/Items/{itemId}` (P7.Q16). */
export const TRAKT_CAPABILITY = 'trakt.history';

/** The item types a Trakt indicator can belong to: history is per movie or episode, and a season or series shows its episodes'. */
export const TRAKT_ITEM_TYPES = ['Movie', 'Episode', 'Season', 'Series'];

/** How long one answer is reused; a Trakt sync runs on the server's schedule, not while the page is open. */
export const TRAKT_STALE_MS = 60 * 1000;

/** The indicator's sentence, for its tooltip and for assistive technology. */
export const traktLabel = (syncedOn: string | null) =>
    'Watch history synced from Trakt' + (syncedOn ? ' · ' + syncedOn : '');
