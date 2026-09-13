import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind';
import { ImageType } from '@jellyfin/sdk/lib/generated-client/models/image-type';
import { ItemFields } from '@jellyfin/sdk/lib/generated-client/models/item-fields';
import { ItemSortBy } from '@jellyfin/sdk/lib/generated-client/models/item-sort-by';
import { SortOrder } from '@jellyfin/sdk/lib/generated-client/models/sort-order';
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api';
import { useQuery } from '@tanstack/react-query';
import React, { type FC, useCallback } from 'react';

import { playbackManager } from 'components/playback/playbackmanager';
import { appRouter } from 'components/router/appRouter';
import { useApi } from 'hooks/useApi';

import './homeChrome.scss';

const HomeHero: FC = () => {
    const { api, user, __legacyApiClient__ } = useApi();
    const hero = useQuery({
        queryKey: ['JellyfinMod', api?.basePath, user?.Id, 'HomeHero'],
        queryFn: async ({ signal }) => {
            const response = await getLibraryApi(api!).getItems({
                userId: user?.Id,
                recursive: true,
                includeItemTypes: [BaseItemKind.Movie, BaseItemKind.Series],
                fields: [ItemFields.Overview],
                enableImageTypes: [ImageType.Backdrop],
                imageTypeLimit: 1,
                sortBy: [ItemSortBy.DateCreated],
                sortOrder: [SortOrder.Descending],
                limit: 40
            }, { signal });
            return response.data.Items?.find(item => item.Id && item.BackdropImageTags?.length);
        },
        enabled: !!api && !!user?.Id,
        staleTime: 5 * 60 * 1000
    });
    const item = hero.data;
    const onPlay = useCallback(() => {
        if (item?.Id) playbackManager.play({ ids: [item.Id], serverId: __legacyApiClient__?.serverId() }).catch(console.error);
    }, [__legacyApiClient__, item?.Id]);

    if (!item?.Id || !item.BackdropImageTags?.[0] || !api) return null;
    const backdrop = `${api.basePath}/Items/${encodeURIComponent(item.Id)}/Images/Backdrop/0?tag=${encodeURIComponent(item.BackdropImageTags[0])}&quality=90`;
    const details = appRouter.getRouteUrl(item).substring(1);
    return <section className='jfmod-homeHero' style={{ backgroundImage: `url("${backdrop}")` }} aria-labelledby='jfmod-homeHero-title'>
        <div className='jfmod-homeHeroContent padded-left padded-right'>
            <h1 id='jfmod-homeHero-title'>{item.Name}</h1>
            {item.Overview && <p>{item.Overview}</p>}
            <div className='jfmod-homeHeroActions focuscontainer-x'>
                {item.Type === BaseItemKind.Movie && <button type='button' className='emby-button button-submit' onClick={onPlay}><span className='material-icons play_arrow' aria-hidden='true' /> Play</button>}
                <a className='emby-button button-flat' href={'#' + details}>More info</a>
            </div>
        </div>
    </section>;
};

export default HomeHero;
