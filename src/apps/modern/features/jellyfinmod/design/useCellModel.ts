import type { Rating } from '../types/ratings';
import { useInFlightMenu } from '../components/EntryCard';
import { daysUntilReclaim, retentionDeadline } from '../constants/fileState';
import { type MouseEvent, useContext, useState } from 'react';
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
import { useQueueVisible } from '../hooks/useQueue';
import { isKnownScale } from '../constants/ratings';
import actionsheet from 'components/actionSheet/actionSheet';
import { QUEUE_ROUTE } from '../constants/queue';
import { useShownUserData } from './useShownUserData';
import { usePlayedAction } from '../hooks/usePlayedAction';
import { RowRefreshContext } from './useRowMotion';

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

const savedFlag = (saved: { item: ItemDto; value: boolean } | undefined, item: ItemDto | undefined, fallback: boolean) =>
    saved && saved.item === item ? saved.value : fallback;

export const useCellModel = (row: BrowseRow, options: CardOptions, alwaysShowCountdown = false) => {
    const item: ItemDto | undefined = row.kind === 'native' ? row.nativeItem : undefined;
    const entry = row.entry;
    const { api, user } = useApi();
    const queryClient = useQueryClient();
    const refreshRow = useContext(RowRefreshContext);
    const played = useTogglePlayedMutation();
    const runPlayed = usePlayedAction();
    const favorite = useToggleFavoriteMutation();
    const [savedPlayed, setSavedPlayed] = useState<{ item: ItemDto; value: boolean }>();
    const [savedFavorite, setSavedFavorite] = useState<{ item: ItemDto; value: boolean }>();
    // A held outgoing card acknowledges the save; a new server DTO takes ownership again. Before the save answers, the click's
    // own state shows (useShownUserData), as on the title page.
    const shown = useShownUserData(savedFlag(savedPlayed, item, !!item?.UserData?.Played),
        savedFlag(savedFavorite, item, !!item?.UserData?.IsFavorite));
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
    const progress = noFile ? undefined : item?.UserData?.PlayedPercentage;
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
        const itemId = item.Id;
        const isPlayed = shown.played;
        const isFavorite = shown.favorite;
        const reload = () => Promise.all([options.queryKey, ['User', user?.Id]].map(queryKey => queryClient.invalidateQueries({ queryKey, type: 'all', refetchType: 'active' }, { throwOnError: true })));
        const change = async () => {
            shown.show(kind, kind === 'played' ? !isPlayed : !isFavorite);
            if (kind === 'played') {
                await played.mutateAsync({ itemId, isPlayed });
                setSavedPlayed({ item, value: !isPlayed });
            } else {
                await favorite.mutateAsync({ itemId, isFavorite });
                setSavedFavorite({ item, value: !isFavorite });
            }
            // The caller's key and the user's own feeds the rows are drawn from (Resume, Next Up, Latest): a played episode's
            // card gives way to its series' next one, and the icons change, at once rather than when the server's push comes.
            await refreshRow(reload, kind === 'played' && !isPlayed ? itemId : undefined);
        };
        try {
            if (kind === 'played') await runPlayed({ ...item, UserData: { ...item.UserData, Played: isPlayed } }, change);
            else await change();
        } catch (error) {
            shown.reset();
            console.error(error);
        }
    };
    const menu = (event: MouseEvent<HTMLElement>) => {
        if (!item && entry && !pending) {
            event.preventDefault();
            event.stopPropagation();
            // Native item menus need an item id. Entries can open their own page (including its management actions),
            // and an in-flight entry can open the queue, without pretending Played/Favourite can be saved on it.
            // Download is here rather than in the pill, as a native card's menu carries it (the user, 2026-11-07).
            const opener = event.currentTarget;
            void actionsheet.show({ positionTo: opener, items: [
                ...(entryGet ? [{ id: 'get', name: 'Download', icon: 'cloud_download' }] : []),
                { id: 'info', name: 'More Info', icon: 'info' },
                ...(queue ? [{ id: 'queue', name: 'View Queue', icon: 'download' }] : [])
            ] }).then(id => {
                if (id === 'get') entryGet?.open(opener);
                if (id === 'info') open();
                if (id === 'queue') window.location.hash = '#' + QUEUE_ROUTE;
            }, () => undefined);
        }
    };
    const rating = visibleRating(row.rating);
    return { action, prepareRelease: release.prepare, countdown, searching, flightMenu, empty, item, entry, get, pending, noFile, queue, shape, source, failedSource, setFailedSource, title, name, second, progress, count, data, open, download, toggle, menu, rating, isPlayed: shown.played, isFavorite: shown.favorite };
};
