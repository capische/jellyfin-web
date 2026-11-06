import type { Api } from '@jellyfin/sdk/lib/api';
import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind';
import { LocationType } from '@jellyfin/sdk/lib/generated-client/models/location-type';
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import type { UserDto } from '@jellyfin/sdk/lib/generated-client/models/user-dto';
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api';
import escapeHtml from 'escape-html';
import { useRef } from 'react';
import confirm from 'components/confirm/confirm';
import { useApi } from 'hooks/useApi';

export interface PlayedItem {
    Id?: string | null;
    Type?: string;
    Name?: string | null;
    SeriesName?: string | null;
    UserData?: { Played?: boolean } | null;
}

const readEpisodes = async (api: Api, user: UserDto, itemId: string, unplayed: boolean) => {
    const library = getLibraryApi(api);
    const query = { userId: user.Id, parentId: itemId, recursive: true,
        includeItemTypes: [BaseItemKind.Episode], enableImages: false, enableUserData: false };
    // Folder.MarkUnplayed visits every recursive non-folder. MarkPlayed skips virtual items when missing episodes are
    // hidden, and always skips virtual unaired episodes. The server applies the unaired date in its own timezone.
    if (unplayed) return (await library.getItems(query)).data.Items;
    const real = (await library.getItems({ ...query, excludeLocationTypes: [LocationType.Virtual] })).data.Items;
    if (!user.Configuration?.DisplayMissingEpisodes) return real;
    const virtual = (await library.getItems({ ...query, locationTypes: [LocationType.Virtual], isUnaired: false })).data.Items;
    return real && virtual ? [...real, ...virtual] : undefined;
};

const confirmationFor = (item: PlayedItem, episodes: BaseItemDto[] | null | undefined, unplayed: boolean) => {
    const action = unplayed ? 'Unplayed' : 'Played';
    const name = item.Name || item.Type;
    // No episode items yet (a series known only by its seasons) reads like a failed count: no number rather than "0 episodes".
    const count = episodes?.length && `${episodes.length} episode${episodes.length === 1 ? '' : 's'}`;
    let subject = `${count || 'episodes'} of ${item.SeriesName || 'the series'} ${name}`;
    if (item.Type === 'Series') {
        const seasons = episodes?.every(episode => episode.SeasonId) ? new Set(episodes.map(episode => episode.SeasonId)).size : undefined;
        subject = `episodes of ${name}`;
        if (count && seasons !== undefined) subject = `${count} in ${seasons} season${seasons === 1 ? '' : 's'}`;
    }
    return { title: `Mark ${name} ${action}?`,
        text: escapeHtml(`All ${subject} are marked ${action.toLowerCase()}${unplayed ? ', including the ones you have watched' : ''}.`),
        cancelText: 'Cancel', confirmText: `Mark ${action}` };
};

/** D281: only design-owned Series/Season actions ask; the existing toggle still owns the write and refresh. */
export const usePlayedAction = () => {
    const { api, user } = useApi();
    const pending = useRef(false);
    return async (source: PlayedItem, toggle: () => unknown | Promise<unknown>) => {
        if (pending.current) return;
        pending.current = true;
        try {
            if (source.Type === 'Series' || source.Type === 'Season') {
                const unplayed = !!source.UserData?.Played;
                let item = source;
                let episodes: BaseItemDto[] | undefined;
                try {
                    if (!api || !user?.Id || !source.Id) throw new Error('Played count needs a signed-in item');
                    const library = getLibraryApi(api);
                    // Title-page card command hosts carry only id/type; read their names from the same server.
                    const { data } = await library.getItem({ itemId: source.Id, userId: user.Id });
                    item = { ...source, ...data };
                    episodes = await readEpisodes(api, user, source.Id, unplayed) ?? undefined;
                } catch {
                    // A failed read never bypasses confirmation or invents a count.
                    episodes = undefined;
                }
                try {
                    await confirm(confirmationFor(item, episodes, unplayed));
                } catch {
                    return;
                }
            }
            await toggle();
        } finally {
            pending.current = false;
        }
    };
};
