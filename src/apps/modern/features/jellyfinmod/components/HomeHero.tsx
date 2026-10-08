import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind';
import { ImageType } from '@jellyfin/sdk/lib/generated-client/models/image-type';
import { ItemFields } from '@jellyfin/sdk/lib/generated-client/models/item-fields';
import { ItemSortBy } from '@jellyfin/sdk/lib/generated-client/models/item-sort-by';
import { SortOrder } from '@jellyfin/sdk/lib/generated-client/models/sort-order';
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api';
import { useQuery } from '@tanstack/react-query';
import React, { type FC, useCallback, useEffect, useMemo, useState } from 'react';

import { getAllSectionsToShow } from 'components/homesections/homesections';
import itemHelper from 'components/itemHelper';
import { playbackManager } from 'components/playback/playbackmanager';
import { appRouter } from 'components/router/appRouter';
import { HomeSectionType } from 'constants/homeSectionType';
import { useApi } from 'hooks/useApi';
import * as userSettings from 'scripts/settings/userSettings';
import type { ItemDto } from 'types/base/models/item-dto';

import { useContinueWatching } from '../hooks/useContinueWatching';
import './homeChrome.scss';

/**
 * How many recent titles to consider. Generous on purpose: a library import adds a hundred titles at once, most
 * without a backdrop or without files, and a short list would leave the hero empty or stuck on one media type.
 */
const HERO_CANDIDATES = 200;

/**
 * Whether this title has something to play behind it.
 *
 * A movie in the library has a file by definition. A series does not: a library can hold a series whose episodes
 * are not on disk, and several in a real library do. Showing one as the hero gives a Play button that can only
 * fail, which is the thing the user complained about in the first place, so such titles are not chosen.
 */
const isPlayable = (item: BaseItemDto): boolean =>
    item.Type === BaseItemKind.Movie || (item.RecursiveItemCount ?? 0) > 0;

interface Backdrop {
    id: string;
    tag: string;
}

/** What the hero shows: an item, the backdrop drawn for it, and whether it is in progress (Play resumes it). */
interface HeroChoice {
    item: BaseItemDto | ItemDto;
    backdrop: Backdrop;
    inProgress: boolean;
}

/** `pending` while a feed, the series lookup or the fallback has not answered; `choice` null means no hero at all. */
interface Decision {
    pending: boolean;
    choice: HeroChoice | null;
}

const PENDING: Decision = { pending: true, choice: null };

const isMovieOrEpisode = (item: ItemDto) =>
    !!item.Id && (item.Type === BaseItemKind.Movie || item.Type === BaseItemKind.Episode);

/**
 * The backdrop the hero shows for an item: an episode shows its series', anything else its own.
 *
 * An episode carries its series' backdrop as the inherited pair only when it has none of its own, so an episode with
 * its own artwork comes without one; its series is then looked up (`series`) rather than the episode passed over.
 */
const backdropOf = (item: BaseItemDto | ItemDto, series?: Map<string, BaseItemDto>): Backdrop | undefined => {
    if (item.Type !== BaseItemKind.Episode) {
        const tag = item.BackdropImageTags?.[0];
        return item.Id && tag ? { id: item.Id, tag } : undefined;
    }
    const inherited = item.ParentBackdropImageTags?.[0];
    const inheritedId = item.ParentBackdropItemId ?? item.SeriesId;
    if (inherited && inheritedId) return { id: inheritedId, tag: inherited };
    const seriesTag = item.SeriesId ? series?.get(item.SeriesId)?.BackdropImageTags?.[0] : undefined;
    return item.SeriesId && seriesTag ? { id: item.SeriesId, tag: seriesTag } : undefined;
};

/** Episodes whose series must be read: for a backdrop the episode does not carry, or for an overview it lacks. */
const seriesToLookUp = (items: ItemDto[]) => [...new Set(items
    .filter(item => isMovieOrEpisode(item) && item.Type === BaseItemKind.Episode && item.SeriesId
        && (!item.ParentBackdropImageTags?.length || !item.Overview))
    .map(item => item.SeriesId!))].sort((left, right) => left.localeCompare(right));

const HomeHero: FC = () => {
    const { api, user, __legacyApiClient__ } = useApi();
    // The hero is what the user is in the middle of — the first card of Continue watching (user, 2026-10-07) — from
    // the same feeds the row shows: a section the user hid from Home does not come back as the hero.
    const sections: HomeSectionType[] = getAllSectionsToShow(userSettings);
    const continueWatching = useContinueWatching({
        includeResume: sections.includes(HomeSectionType.Resume),
        includeNextUp: sections.includes(HomeSectionType.NextUp)
    });
    const lookUp = useMemo(() => seriesToLookUp(continueWatching.items), [continueWatching.items]);
    // The series of in-progress episodes, for a backdrop or overview the episode does not carry. Keyed under HomeHero,
    // so a user-data change refreshes it with everything else.
    const series = useQuery({
        queryKey: ['JellyfinMod', api?.basePath, user?.Id, 'HomeHero', 'Series', lookUp],
        queryFn: async ({ signal }) => {
            const response = await getLibraryApi(api!).getItems({
                userId: user?.Id, ids: lookUp, fields: [ItemFields.Overview], enableImageTypes: [ImageType.Backdrop], imageTypeLimit: 1
            }, { signal });
            return new Map((response.data.Items ?? []).filter(item => item.Id).map(item => [item.Id!, item]));
        },
        enabled: !!api && !!user?.Id && lookUp.length > 0,
        staleTime: 5 * 60 * 1000
    });
    // Only when nothing is in progress does the hero fall back to the newest title, so a finished series or a movie
    // watched to the end gives way to the freshest thing in the library. It is fetched alongside the feeds rather than
    // after them, so a cold Home with nothing in progress still has its hero, and its Play, inside the TV first-focus
    // window, and finishing the last in-progress title swaps the hero instead of blanking it.
    const newest = useQuery({
        queryKey: ['JellyfinMod', api?.basePath, user?.Id, 'HomeHero'],
        queryFn: async ({ signal }) => {
            const response = await getLibraryApi(api!).getItems({
                userId: user?.Id,
                recursive: true,
                includeItemTypes: [BaseItemKind.Movie, BaseItemKind.Series],
                // RecursiveItemCount is how a series says whether it has any episodes on disk.
                fields: [ItemFields.Overview, ItemFields.RecursiveItemCount],
                enableImageTypes: [ImageType.Backdrop],
                imageTypeLimit: 1,
                sortBy: [ItemSortBy.DateCreated],
                sortOrder: [SortOrder.Descending],
                limit: HERO_CANDIDATES
            }, { signal });
            return response.data.Items?.find(item =>
                item.Id && item.BackdropImageTags?.length && isPlayable(item)) ?? null;
        },
        enabled: !!api && !!user?.Id,
        staleTime: 5 * 60 * 1000
    });
    const lookUpPending = lookUp.length > 0 && series.isPending;
    // While the next choice is being worked out the hero keeps what it shows, so a focused Play is not unmounted. What
    // it keeps belongs to the server and user it was chosen for: another account never sees it, even for a moment.
    const owner = api && user?.Id ? `${api.basePath}|${user.Id}` : null;
    const [shown, setShown] = useState<{ owner: string; choice: HeroChoice | null } | null>(null);
    const hasShown = !!shown && shown.owner === owner;
    // The first choice is made from what is cached, refetching or not; later ones wait for the refetches to finish.
    const ready = hasShown ? continueWatching.settled : continueWatching.answered;
    const decision = useMemo<Decision>(() => {
        if (!ready) return PENDING;
        for (const item of continueWatching.items) {
            if (!isMovieOrEpisode(item)) continue;
            const backdrop = backdropOf(item, series.data);
            if (backdrop) return { pending: false, choice: { item, backdrop, inProgress: true } };
            // An episode whose series is still being read may yet have a backdrop: wait rather than pass it over.
            if (item.Type === BaseItemKind.Episode && !item.ParentBackdropImageTags?.length && lookUpPending) return PENDING;
        }
        if (newest.isPending) return PENDING;
        const fallback = newest.data;
        const backdrop = fallback && backdropOf(fallback);
        return { pending: false, choice: fallback && backdrop ? { item: fallback, backdrop, inProgress: false } : null };
    }, [continueWatching.items, ready, lookUpPending, newest.data, newest.isPending, series.data]);
    useEffect(() => {
        if (!owner) setShown(null);
        else if (!decision.pending) setShown({ owner, choice: decision.choice });
    }, [decision, owner]);
    const kept = hasShown ? shown.choice : null;
    const current = decision.pending ? kept : decision.choice;
    const item = current?.item;
    const isEpisode = item?.Type === BaseItemKind.Episode;
    const [playError, setPlayError] = useState<string | null>(null);

    /**
     * Plays whatever this hero means by "play".
     *
     * An in-progress movie or episode plays that exact item from its saved position, the same
     * `playbackManager.play` call upstream's Continue watching card makes for its Play and Resume actions. The newest
     * title falls back to upstream's own resolution: for a series `playbackManager` asks Next Up first, then plays the
     * episode list from there, so a finished series starts again at the first episode — the same thing the detail
     * page's Play does, so the two cannot disagree.
     */
    const onPlay = useCallback(() => {
        if (!item?.Id) return;
        setPlayError(null);
        playbackManager.play({
            ids: [item.Id],
            startPositionTicks: current?.inProgress ? item.UserData?.PlaybackPositionTicks ?? 0 : undefined,
            serverId: __legacyApiClient__?.serverId()
        }).catch((error: unknown) => {
            console.error('[JellyfinMod] Home hero could not start playback', error);
            // A hero button that does nothing is worse than one that explains itself. The usual cause is a
            // series whose episodes are not on disk.
            setPlayError('Nothing to play yet. Open More Info to see what is available.');
        });
    }, [__legacyApiClient__, current?.inProgress, item]);

    if (!item?.Id || !current || !api) return null;
    const image = current.backdrop;
    const backdrop = `${api.basePath}/Items/${encodeURIComponent(image.id)}/Images/Backdrop/0?tag=${encodeURIComponent(image.tag)}&quality=90`;
    // More info opens what the Continue watching card opens: the episode for an episode, the title otherwise.
    const details = appRouter.getRouteUrl(item).substring(1);
    const overview = item.Overview || (isEpisode && item.SeriesId ? series.data?.get(item.SeriesId)?.Overview : undefined);
    return <section className='jfmod-homeHero' style={{ backgroundImage: `url("${backdrop}")` }} aria-labelledby='jfmod-homeHero-title'>
        <div className='jfmod-homeHeroContent padded-left padded-right'>
            <h1 id='jfmod-homeHero-title'>{isEpisode ? item.SeriesName || item.Name : item.Name}</h1>
            {isEpisode && <div className='jfmod-homeHeroEpisode'>{itemHelper.getDisplayName(item)}</div>}
            {overview && <p>{overview}</p>}
            <div className='jfmod-homeHeroActions focuscontainer-x'>
                <button type='button' className='emby-button button-submit' onClick={onPlay}>
                    <span className='material-icons play_arrow' aria-hidden='true' /> Play
                </button>
                <a className='emby-button button-flat' href={'#' + details}>More Info</a>
            </div>
            {playError && <p className='jfmod-homeHeroError' role='status'>{playError}</p>}
        </div>
    </section>;
};

export default HomeHero;
