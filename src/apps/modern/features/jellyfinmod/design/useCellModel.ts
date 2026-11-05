import type { Rating } from '../types/ratings';
import { useInFlightMenu } from '../components/EntryCard';
import { daysUntilReclaim, retentionDeadline } from '../constants/fileState';
import { type MouseEvent, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getCardImageUrl } from 'components/cardbuilder/utils/url';
import { CardShape } from 'components/cardbuilder/utils/shape';
import { resolveAction } from 'components/cardbuilder/utils/builder';
import { ItemAction } from 'constants/itemAction';
import { useApi } from 'hooks/useApi';
import { useToggleFavoriteMutation, useTogglePlayedMutation } from 'hooks/useFetchItems';
import { getDataAttributes } from 'utils/items';
import type { ItemDto } from 'types/base/models/item-dto';
import type { CardOptions } from 'types/cardOptions';
import type { BrowseRow } from '../types/browse';
import { FileState } from '../types/entry';
import { getEntryPath, getTmdbImage } from '../utils/entryLinks';
import { useCardHasNoFile, useCardRelease } from '../integration/cardGetRelease';
import { useEntryDownload } from '../components/FileStateMark';
import { openInFlightCardMenu } from '../integration/queueActions';
import { useQueueVisible } from '../hooks/useQueue';
import { isKnownScale } from '../constants/ratings';

const cellShape = (item: ItemDto | undefined, options: CardOptions) => {
    if (item?.Type === 'Person') return 'c';
    if ([CardShape.Backdrop, CardShape.BackdropOverflow, CardShape.Banner].includes(options.shape as CardShape)
        || options.preferThumb || options.preferBanner || options.preferLogo) return 'w';
    // An episode is its still, except in a row of posters that asks for the parent's: Home's Recently Added.
    return item?.Type === 'Episode' && !options.preferParentPoster ? 'w' : 'p';
};

/** A poster row's episode draws its series' poster: the still would be cropped, and a season's poster is not what the caption names. */
const posterItem = (item: ItemDto, shape: string) => item.Type === 'Episode' && shape === 'p' ?
    { ...item, ImageTags: undefined, ParentPrimaryImageTag: undefined, ParentPrimaryImageItemId: undefined } : item;

/** The caption's first two lines. A cell is never on its own series' page (the Seasons row there is the title page's), so a season says whose it is. */
const captionOf = (item: ItemDto | undefined, title: string, year: string | number) => {
    if (item?.Type === 'Episode') return { name: item.SeriesName || title, second: `S${item.ParentIndexNumber}:E${item.IndexNumber} · ${title}` };
    if (item?.Type === 'Season' && item.SeriesName) return { name: item.SeriesName, second: [title, year].filter(Boolean).join(' · ') };
    return { name: title, second: year };
};

const visibleRating = (rating: Rating | null | undefined) => rating && isKnownScale(rating.scale) ? rating : null;

export const useCellModel = (row: BrowseRow, options: CardOptions, alwaysShowCountdown = false) => {
    const item: ItemDto | undefined = row.kind === 'native' ? row.nativeItem : undefined;
    const entry = row.entry;
    const { api } = useApi();
    const queryClient = useQueryClient();
    const played = useTogglePlayedMutation();
    const favorite = useToggleFavoriteMutation();
    const empty = useCardHasNoFile(item?.Id);
    const release = useCardRelease(item?.Id, item?.Type);
    const entryGet = useEntryDownload(entry ?? undefined, !!entry);
    const get = item ? release.open : entryGet?.open;
    const pending = entry?.id.startsWith('pending:');
    const placeholder = !!entry?.placeholderItemId && entry.placeholderItemId.replace(/-/g, '').toLowerCase() === item?.Id?.replace(/-/g, '').toLowerCase();
    const noFile = empty || !item || !!item.IsPlaceHolder || placeholder || !!entry && [FileState.None, FileState.Reclaimed].includes(entry.state);
    const inFlight = !!entry && [FileState.Grabbed, FileState.Downloading].includes(entry.state);
    const queue = useQueueVisible(inFlight);
    const flightMenu = useInFlightMenu(item ? undefined : entry, !!pending);
    const days = daysUntilReclaim(retentionDeadline(row.retention));
    const countdown = days !== null && (alwaysShowCountdown || days <= 3) ? days : null;
    const searching = entry?.state === FileState.Searching;
    const shape = cellShape(item, options);
    let source = getTmdbImage(entry?.posterPath);
    if (shape === 'w') source = getTmdbImage(entry?.metadata?.backdropPath ?? entry?.posterPath);
    if (item) source = getCardImageUrl({ api, item: posterItem(item, shape), options, shape: shape === 'w' ? CardShape.Backdrop : CardShape.Portrait }).imgUrl;
    const [failedSource, setFailedSource] = useState<string>();
    const title = item?.Name ?? entry?.title ?? '';
    const { name, second } = captionOf(item, title, item?.ProductionYear ?? entry?.year ?? '');
    const progress = item?.UserData?.PlayedPercentage;
    const count = item?.UserData?.UnplayedItemCount;
    const action = resolveAction({ defaultAction: options.action ?? ItemAction.Link, isFolder: item?.IsFolder ?? false, isPhoto: item?.MediaType === 'Photo' });
    const data = item ? getDataAttributes({ action, itemServerId: item.ServerId ?? options.serverId,
        itemId: item.Id, itemType: item.Type, itemMediaType: item.MediaType, itemIsFolder: item.IsFolder,
        collectionId: options.collectionId, playlistId: options.playlistId, itemPlaylistItemId: item.PlaylistItemId,
        itemTimerId: item.TimerId, itemSeriesTimerId: item.SeriesTimerId, itemChannelId: item.ChannelId,
        itemCollectionType: item.CollectionType, itemPath: item.Path, itemStartDate: item.StartDate, itemEndDate: item.EndDate,
        context: options.context, parentId: options.parentId, itemUserData: item.UserData }) : {};
    const open = () => {
        if (!item && entry && !pending) window.location.hash = '#' + getEntryPath(entry.id, options.serverId ?? undefined);
    };
    const download = (event: MouseEvent<HTMLElement>) => {
        event.preventDefault();
        event.stopPropagation();
        get?.(event.currentTarget);
    };
    const toggle = async (event: MouseEvent<HTMLElement>, kind: 'played' | 'favorite') => {
        event.preventDefault();
        event.stopPropagation();
        if (!item?.Id) return;
        try {
            if (kind === 'played') await played.mutateAsync({ itemId: item.Id, isPlayed: !!item.UserData?.Played });
            else await favorite.mutateAsync({ itemId: item.Id, isFavorite: !!item.UserData?.IsFavorite });
            await queryClient.invalidateQueries({ queryKey: options.queryKey, type: 'all', refetchType: 'active' });
        } catch (error) { console.error(error); }
    };
    const menu = (event: MouseEvent<HTMLElement>) => {
        if (!item && queue) {
            event.preventDefault();
            event.stopPropagation();
            void openInFlightCardMenu(event.currentTarget);
        }
    };
    const rating = visibleRating(row.rating);
    return { action, releaseLabel: release.label, prepareRelease: release.prepare, countdown, searching, flightMenu, empty, item, entry, get, pending, noFile, queue, shape, source, failedSource, setFailedSource, title, name, second, progress, count, data, open, download, toggle, menu, rating };
};
