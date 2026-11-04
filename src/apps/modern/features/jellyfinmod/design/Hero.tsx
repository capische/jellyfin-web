import React, { type FC, useContext, useLayoutEffect, useState } from 'react';
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import itemHelper from 'components/itemHelper';
import ItemsContainer from 'elements/emby-itemscontainer/ItemsContainer';
import { setCardData } from 'components/cardbuilder/cardBuilder';
import { ItemAction } from 'constants/itemAction';
import { useApi } from 'hooks/useApi';
import { useToggleFavoriteMutation, useTogglePlayedMutation } from 'hooks/useFetchItems';
import { getDataAttributes } from 'utils/items';
import type { ItemDto } from 'types/base/models/item-dto';
import datetime from 'scripts/datetime';
import { useQueryClient } from '@tanstack/react-query';
import NativeRatingsLine from '../components/NativeRatingsLine';
import { Root, DesignContext } from './Root';
import { Action } from './Action';

interface Props {
    item: BaseItemDto | ItemDto;
    backdrop: string;
    overview?: string | null | false;
    details: string;
    onPlay: () => void;
    error: string | null;
}

/** ds.js Home hero and actbar, supplied by HomeHero's existing choice/play logic. */
const HeroBody: FC<Props> = ({ item, backdrop, overview, details, onPlay, error }) => {
    const device = useContext(DesignContext);
    const { api, user, __legacyApiClient__ } = useApi();
    const queryClient = useQueryClient();
    const played = useTogglePlayedMutation();
    const favorite = useToggleFavoriteMutation();
    const [height, setHeight] = useState(window.innerHeight);
    useLayoutEffect(() => {
        const resize = () => setHeight(window.innerHeight);
        window.addEventListener('resize', resize);
        return () => window.removeEventListener('resize', resize);
    }, []);
    const serverId = __legacyApiClient__?.serverId();
    setCardData([item as ItemDto], { serverId });
    const toggle = async (kind: 'played' | 'favorite') => {
        if (!item.Id) return;
        try {
            if (kind === 'played') await played.mutateAsync({ itemId: item.Id, isPlayed: !!item.UserData?.Played });
            else await favorite.mutateAsync({ itemId: item.Id, isFavorite: !!item.UserData?.IsFavorite });
            await queryClient.invalidateQueries({ queryKey: ['JellyfinMod', api?.basePath, user?.Id] });
            await queryClient.invalidateQueries({ queryKey: ['User', user?.Id] });
        } catch (failure) { console.error(failure); }
    };
    const data = getDataAttributes({ action: ItemAction.Menu, itemId: item.Id, itemServerId: serverId, itemType: item.Type,
        itemMediaType: item.MediaType, itemIsFolder: item.IsFolder, itemUserData: item.UserData });
    const title = item.Type === 'Episode' ? item.SeriesName || item.Name : item.Name;
    // The TV's focus scrolling would centre Play and take the bar off the top of the page: the hero stays at the page's top.
    const holdTop = device === 'tv' ? { 'data-scroll-mode-y': 'custom', onFocusCapture: () => window.scrollTo(0, 0) } : {};
    return <div className='hero2 onart' data-jfmod-hero-id={item.Id} data-jfmod-detail-href={details} {...holdTop} style={{ height: Math.round(height * (height <= 720 ? 0.764 : 0.618)) }}>
        <div className='pic' style={{ backgroundImage: `url("${backdrop}")` }} /><div className='scrim' /><div className='foot' />
        <div className='herotext'>
            <h1 id='jfmod-homeHero-title'>{device === 'phone' ? <a href={details}>{title}</a> : title}</h1>
            <div className='meta'>
                {item.Type === 'Episode' && <span data-jfmod-hero-episode>{itemHelper.getDisplayName(item)}</span>}
                {item.ProductionYear && <span>{item.ProductionYear}</span>}
                {!!item.RunTimeTicks && <span>{datetime.getDisplayDuration(item.RunTimeTicks)}</span>}
                {item.OfficialRating && <span className='badge'>{item.OfficialRating}</span>}
                {api && user?.Id && item.Id && <NativeRatingsLine key={item.Id} api={api} userId={user.Id} itemId={item.Id}
                    knownType={item.Type} itemType={Promise.resolve(item.Type ?? undefined)} />}
            </div>
            {overview && <p>{overview}</p>}
            <ItemsContainer isPlain className='actbar glassy focuscontainer-x'>
                <Action icon='play' label='Play' title='Play' onClick={onPlay} />
                {device !== 'phone' && <a className='txt focusable' href={details}>More Info</a>}
                {itemHelper.canMarkPlayed(item) && <Action icon='check' title={item.UserData?.Played ? 'Watched' : 'Mark Played'}
                    onClick={() => { void toggle('played'); }} />}
                {itemHelper.canRate(item) && <Action icon='heart' title={item.UserData?.IsFavorite ? 'Favorite' : 'Add to Favorites'}
                    onClick={() => { void toggle('favorite'); }} />}
                <span {...data} className='itemAction' data-action={ItemAction.Menu}><Action icon='more' title='More' onClick={() => undefined} /></span>
            </ItemsContainer>
            {error && <p role='status'>{error} <a href={details}>More Info</a></p>}
        </div>
    </div>;
};

export const Hero: FC<Props> = props => <Root><HeroBody {...props} /></Root>;
