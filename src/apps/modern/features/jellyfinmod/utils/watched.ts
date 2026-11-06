import type { UserItemDataDto } from '@jellyfin/sdk/lib/generated-client/models/user-item-data-dto';
import globalize from 'lib/globalize';
import datetime from 'scripts/datetime';

type WatchedData = Pick<UserItemDataDto, 'Played' | 'LastPlayedDate' | 'PlayCount'>;

/** D291/D293: one absolute, locale-aware date for the title metadata and computer tips. */
export const watchedDate = (data?: WatchedData | null) => {
    if (!data?.LastPlayedDate || !Number.isFinite(Date.parse(data.LastPlayedDate))) return null;
    return datetime.toLocaleString(datetime.parseISO8601Date(data.LastPlayedDate, true),
        { day: 'numeric', month: 'short', year: 'numeric' });
};

export const watchedLabel = (data?: WatchedData | null) => {
    if (!data?.Played) return globalize.translate('MarkPlayed').replace(/(^|\s)([a-z])/g, (all: string, space: string, letter: string) => space + letter.toUpperCase());
    const date = watchedDate(data);
    if (!date) return globalize.translate('Watched');
    const count = data.PlayCount ?? 0;
    return globalize.translate('Watched') + ' ' + date + (count >= 2 ? ' · ' + count + ' times' : '');
};
