import React, { type FC, useContext, useLayoutEffect, useState } from 'react';
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import { watchedLabel } from '../utils/watched';
import itemHelper from 'components/itemHelper';
import ItemsContainer from 'elements/emby-itemscontainer/ItemsContainer';
import { setCardData } from 'components/cardbuilder/cardBuilder';
import { ItemAction } from 'constants/itemAction';
import { useApi } from 'hooks/useApi';
import { useToggleFavoriteMutation } from 'apps/modern/features/libraries/hooks/api/useToggleFavorite';
import { useTogglePlayedMutation } from 'apps/modern/features/libraries/hooks/api/useTogglePlayed';
import { getDataAttributes } from 'utils/items';
import type { ItemDto } from 'types/base/models/item-dto';
import datetime from 'scripts/datetime';
import { useQueryClient } from '@tanstack/react-query';
import { nativeRatingTitle } from '../utils/ratingLinks';
import NativeRatingsLine from '../components/NativeRatingsLine';
import { Root, DesignContext, readEnvironment } from './Root';
import { Action } from './Action';
import { useShownUserData } from './useShownUserData';
import { usePlayedAction } from '../hooks/usePlayedAction';

interface Props {
    item: BaseItemDto | ItemDto;
    backdrop: string;
    overview?: string | null | false;
    details: string;
    onPlay: () => void;
    error: string | null;
}

/** ds.js P.home's H on page.html's frame: a computer's height comes from its window's width, whatever the window's own height. */
const heroHeight = () => {
    const width = window.innerWidth;
    let frame = window.innerHeight;
    if (readEnvironment().device === 'computer') {
        frame = 900;
        if (width <= 1280) frame = 720;
        else if (width >= 2560) frame = 1440;
        else if (width >= 1920) frame = 1080;
    }
    return Math.round(frame * (frame <= 720 ? 0.764 : 0.618));
};

/** ds.js Home hero and actbar, supplied by HomeHero's existing choice/play logic. */
const HeroBody: FC<Props> = ({ item, backdrop, overview, details, onPlay, error }) => {
    const device = useContext(DesignContext);
    const { api, user, serverId } = useApi();
    const queryClient = useQueryClient();
    const played = useTogglePlayedMutation();
    const runPlayed = usePlayedAction();
    const favorite = useToggleFavoriteMutation();
    const shown = useShownUserData(item.UserData?.Played, item.UserData?.IsFavorite);
    const [height, setHeight] = useState(heroHeight);
    useLayoutEffect(() => {
        const resize = () => setHeight(heroHeight());
        window.addEventListener('resize', resize);
        return () => window.removeEventListener('resize', resize);
    }, []);
    setCardData([item as ItemDto], { serverId });
    const toggle = async (kind: 'played' | 'favorite') => {
        if (!item.Id) return;
        const itemId = item.Id;
        const isPlayed = shown.played;
        const isFavorite = shown.favorite;
        const change = async () => {
            shown.show(kind, kind === 'played' ? !isPlayed : !isFavorite);
            if (kind === 'played') await played.mutateAsync({ itemId, isPlayed });
            else await favorite.mutateAsync({ itemId, isFavorite });
            await queryClient.invalidateQueries({ queryKey: ['JellyfinMod', api?.basePath, user?.Id] });
            await queryClient.invalidateQueries({ queryKey: ['User', user?.Id] });
        };
        try {
            if (kind === 'played') await runPlayed({ ...item, UserData: { ...item.UserData, Played: isPlayed } }, change);
            else await change();
        } catch (failure) {
            shown.reset();
            console.error(failure);
        }
    };
    const data = getDataAttributes({ action: ItemAction.Menu, itemId: item.Id, itemServerId: serverId, itemType: item.Type,
        itemMediaType: item.MediaType, itemIsFolder: item.IsFolder, itemUserData: item.UserData });
    const title = item.Type === 'Episode' ? item.SeriesName || item.Name : item.Name;
    // The TV's focus scrolling would centre Play and take the bar off the top of the page: the hero stays at the page's top.
    const holdTop = device === 'tv' ? { 'data-scroll-mode-y': 'custom', onFocusCapture: () => window.scrollTo(0, 0) } : {};
    return <div className='hero2 onart' data-jfmod-hero-id={item.Id} data-jfmod-detail-href={details} {...holdTop} style={{ height }}>
        <div className='pic' style={{ backgroundImage: `url("${backdrop}")` }} /><div className='scrim' /><div className='foot' />
        <div className='herotext'>
            <h1 id='jfmod-homeHero-title'>{device === 'phone' ? <a href={details}>{title}</a> : title}</h1>
            <div className='meta'>
                {item.Type === 'Episode' && <span data-jfmod-hero-episode>{itemHelper.getDisplayName(item)}</span>}
                {item.ProductionYear && <span>{item.ProductionYear}</span>}
                {!!item.RunTimeTicks && <span>{datetime.getDisplayDuration(item.RunTimeTicks)}</span>}
                {item.OfficialRating && <span className='badge'>{item.OfficialRating}</span>}
                {/* The ratings take their own line under the words, as on the title head (ds.t13). */}
                {api && user?.Id && item.Id && <span className='jfmod-metaRatings'><NativeRatingsLine key={item.Id} api={api} userId={user.Id} itemId={item.Id}
                    title={Promise.resolve(nativeRatingTitle(item))} knownType={item.Type} itemType={Promise.resolve(item.Type ?? undefined)} /></span>}
            </div>
            {overview && <p>{overview}</p>}
            <ItemsContainer isPlain className='actbar glassy focuscontainer-x'>
                <Action icon='play' label='Play' title='Play' onClick={onPlay} />
                {device !== 'phone' && <a className='txt focusable' href={details}>More Info</a>}
                {itemHelper.canMarkPlayed(item) && <Action icon='check' title={watchedLabel({ ...item.UserData, Played: shown.played })} pressed={shown.played}
                    onClick={() => { void toggle('played'); }} />}
                {itemHelper.canRate(item) && <Action icon='heart' title={shown.favorite ? 'Favorite' : 'Add to Favorites'} pressed={shown.favorite}
                    onClick={() => { void toggle('favorite'); }} />}
                <span {...data} className='itemAction' data-action={ItemAction.Menu}><Action icon='more' title='More' onClick={() => undefined} /></span>
            </ItemsContainer>
            {error && <p role='status'>{error} <a href={details}>More Info</a></p>}
        </div>
    </div>;
};

export const Hero: FC<Props> = props => <Root><HeroBody {...props} /></Root>;
