import { CollectionType } from '@jellyfin/sdk/lib/generated-client/models/collection-type';
import { ItemFields } from '@jellyfin/sdk/lib/generated-client/models/item-fields';
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api';
import { useQueries, useQuery } from '@tanstack/react-query';
import React, { type FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import actionsheet from 'components/actionSheet/actionSheet';
import { useSearchItems } from 'apps/legacy/features/search/api/useSearchItems';
import layoutManager from 'components/layoutManager';
import toast from 'components/toast/toast';
import { useUserViews } from 'hooks/api/useUserViews';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import { useApi } from 'hooks/useApi';
import type { ItemDto } from 'types/base/models/item-dto';
import { queryClient } from 'utils/query/queryClient';

import { browseEntries, createEntry, DISCOVER_TITLE_CAPABILITY, removeEntry } from '../api/modApi';
import { usePluginCapabilities } from '../hooks/useAcquisition';
import { isDiscoveryExhausted, useDiscovery } from '../hooks/useDiscovery';
import { usePluginHealth } from '../hooks/useEntries';
import type { BrowseRow } from '../types/browse';
import type { Entry, TmdbMetadata } from '../types/entry';
import { getEntryPath, getTmdbImage, getTmdbPath } from '../utils/entryLinks';
import { openReleasePickerForEntry } from '../integration/releasePicker';
import { SearchCell, type SearchCardItem } from '../design/SearchCell';
import { SearchRows } from '../design/Search';
import { CellSkeleton } from '../design/Cell';
import ItemsContainer from 'elements/emby-itemscontainer/ItemsContainer';
import { ItemAction } from 'constants/itemAction';
import type { CardOptions } from 'types/cardOptions';
import { useUserSettings } from 'hooks/useUserSettings';

interface Props {
    parentId?: string;
    collectionType?: CollectionType;
    query: string;
}

type MediaType = 'movie' | 'series';

/** The search grid shows both kinds wherever it was opened from (D201: "Library limit on search - A"). */
const TYPES: MediaType[] = ['movie', 'series'];

const identityOf = (mediaType: MediaType, tmdbId: number) => `${mediaType}:${tmdbId}`;

/** Library titles by name, as Jellyfin sorts them: a leading article does not count. */
const sortKey = (title: string) => title.replace(/^(the|a|an)\s+/i, '').toLocaleLowerCase();

/** A title as the full-match test compares it: a leading article, case, spaces and punctuation do not count (D253). */
const normalTitle = (title: string) => sortKey(title).replace(/[^0-9a-z\u00c0-\uffff]+/g, ' ').trim();

/** Fewer votes than this and a full match is not famous enough to lead (D253). */
const FAMOUS_VOTES = 100;

interface RankedCard {
    card: SearchCardItem;
    /** The title equals the query. */
    full: boolean;
    /** The order among equals: library titles by name, then TMDB's order. */
    rank: number;
}

/** Newest first: by year, then by the full date where both have one. */
const byDate = (left?: string | null, right?: string | null) => {
    const years = (Number(right?.slice(0, 4)) || 0) - (Number(left?.slice(0, 4)) || 0);
    if (years || !left || !right || left.length < 10 || right.length < 10) return years;
    return right.slice(0, 10).localeCompare(left.slice(0, 10));
};

/** A library title whose votes nobody knows: its entry has none and the search holds no TMDB card of it. */
const votesUnknown = ({ card }: RankedCard) => !card.add && card.votes == null;

/** Leads the grid: a full match with enough votes, or a library title that is a full match and whose votes are unknown. */
const leadsGrid = (item: RankedCard) => item.full && (votesUnknown(item) || (item.card.votes ?? 0) >= FAMOUS_VOTES);

/**
 * Full matches with 100 or more votes, newest first; then everything else by votes, most first (user, 2026-11-03, D253). A library
 * title of unknown votes keeps its old place: a full match among the leaders by date, any other title first of the rest, by name.
 */
const byMatchThenVotes = (left: RankedCard, right: RankedCard) => {
    const leftLeads = leadsGrid(left);
    if (leftLeads !== leadsGrid(right)) return leftLeads ? -1 : 1;
    if (leftLeads) return byDate(left.card.date, right.card.date) || left.rank - right.rank;
    const leftUnknown = votesUnknown(left);
    if (leftUnknown !== votesUnknown(right)) return leftUnknown ? -1 : 1;
    return (right.card.votes ?? 0) - (left.card.votes ?? 0) || left.rank - right.rank;
};

/**
 * The candidates by key: TMDB's results, and library titles (a library title replaces TMDB's card of the same title, except a
 * title added from this search, which keeps its TMDB card in place), its votes from that card where its entry has none.
 */
const rankCandidates = (library: SearchCardItem[], tmdb: SearchCardItem[], added: Map<string, Entry>, query: string) => {
    const wanted = normalTitle(query);
    const sorted = library.slice().sort((left, right) => sortKey(left.title).localeCompare(sortKey(right.title)));
    const candidates = new Map<string, RankedCard>();
    tmdb.forEach((card, index) => {
        candidates.set(card.key, { card, full: normalTitle(card.title) === wanted, rank: sorted.length + index });
    });
    sorted.forEach((card, index) => {
        const tmdbCard = candidates.get(card.key)?.card;
        if (!added.has(card.key) || !tmdbCard) candidates.set(card.key, { card: { ...card, votes: card.votes ?? tmdbCard?.votes }, full: normalTitle(card.title) === wanted, rank: index });
    });
    return candidates;
};

/**
 * The order: full matches with enough votes by release date, then the rest by votes (D253). Cards already shown keep their places;
 * newly loaded ones follow them, sorted by the same rule.
 */
const orderedKeys = (shown: string[], candidates: Map<string, RankedCard>) => {
    const kept = shown.filter(key => candidates.has(key));
    const keptKeys = new Set(kept);
    return [...kept, ...Array.from(candidates.values()).filter(item => !keptKeys.has(item.card.key)).sort(byMatchThenVotes)
        .map(item => item.card.key)];
};

/** A library title's card: its Jellyfin item's page, image and actors where it has one, else its entry's. */
const libraryCard = (row: BrowseRow, context: { serverId?: string; nativeLeads: Map<string | undefined, string[]>;
    imageOf: (item: ItemDto) => string | undefined }): SearchCardItem | null => {
    const { serverId, nativeLeads, imageOf } = context;
    const entry = row.entry ?? undefined;
    if (row.kind === 'native') {
        const item = row.nativeItem;
        const mediaType: MediaType = item.Type === 'Series' ? 'series' : 'movie';
        const title = item.Name ?? entry?.title ?? '';
        return {
            key: entry ? identityOf(entry.mediaType, entry.tmdbId) : 'native:' + item.Id,
            mediaType, tmdbId: entry?.tmdbId, title, year: item.ProductionYear ?? entry?.year,
            date: item.PremiereDate ?? entry?.metadata?.premiereDate, votes: entry?.metadata?.voteCount,
            cast: nativeLeads.get(item.Id ?? undefined) ?? leads(entry?.metadata?.cast),
            poster: imageOf(item) ?? getTmdbImage(entry?.posterPath, 'w342'),
            href: '#/details?id=' + encodeURIComponent(item.Id ?? '') + (serverId ? '&serverId=' + encodeURIComponent(serverId) : ''),
            entry, retention: row.retention, row
        };
    }
    if (!entry) return null;
    return {
        key: identityOf(entry.mediaType, entry.tmdbId), mediaType: entry.mediaType, tmdbId: entry.tmdbId, title: entry.title,
        year: entry.year, date: entry.metadata?.premiereDate, votes: entry.metadata?.voteCount, cast: leads(entry.metadata?.cast), poster: getTmdbImage(entry.posterPath, 'w342'),
        href: '#' + getEntryPath(entry.id, serverId), entry, retention: row.retention, row
    };
};

const yearOf = (date?: string | null) => (date && /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null);

const leads = (cast?: { name: string }[] | null) => (cast ?? []).slice(0, 2).map(person => person.name);

/** The session's library choice per media type survives query edits (P1.W13). */
const librariesKey = (userId?: string | null) => 'jfmod-searchLibraries:' + (userId ?? '');

const loadLibraryChoice = (userId?: string | null): Partial<Record<MediaType, string>> => {
    try {
        return JSON.parse(sessionStorage.getItem(librariesKey(userId)) ?? '{}') as Partial<Record<MediaType, string>>;
    } catch {
        return {};
    }
};

/** Everything of the catalog to refresh after an add or an undo, except this search's TMDB pages, so no card moves. */
const refreshCatalog = (basePath: string, userId?: string) => queryClient.invalidateQueries({
    queryKey: ['JellyfinMod', basePath, userId],
    predicate: query => query.queryKey[3] !== 'DiscoverPages'
});

/** Whether the first library and TMDB answers are in. */
const isAnswered = (browse: { isPending: boolean }[], discovery: { isPending: boolean }[], query: string) =>
    !browse.some(result => result.isPending) && (query.length < 2 || discovery.every(result => !result.isPending));

/** The cards in their shown order, once the first answers are in; none before. */
const shownCards = (shown: { current: string[] }, candidates: Map<string, RankedCard>, ready: boolean) => {
    if (!ready) return [];
    shown.current = orderedKeys(shown.current, candidates);
    return shown.current.map(key => candidates.get(key)!.card);
};

/** What TMDB could not answer: nothing, one kind, or both. */
const DiscoveryNotice: FC<{ failedTypes: MediaType[] }> = ({ failedTypes }) => {
    if (!failedTypes.length) return null;
    if (failedTypes.length === TYPES.length) return <p className='noticex' data-ds-notice='discovery'>TMDB is unavailable. Your library results are still shown.</p>;
    return <p className='noticex' data-ds-notice='discovery'>
        TMDB {failedTypes.map(type => (type === 'movie' ? 'movie' : 'series')).join(' and ')} results are unavailable right now.
    </p>;
};

const SearchSession: FC<Props> = ({ parentId, collectionType, query }) => {
    const { libraryPageSize } = useUserSettings();
    const resultsRef = useRef<HTMLDivElement>(null);
    const endRef = useRef<HTMLDivElement>(null);
    const { api, user, serverId } = useApi();
    const health = usePluginHealth();
    const canBrowse = usePluginCapabilities(api, true).includes(DISCOVER_TITLE_CAPABILITY);
    const stock = useSearchItems(parentId, collectionType, query.trim());
    const views = useUserViews({ userId: user?.Id });
    const queryInput = query.trim();
    const cardOptions = useMemo<CardOptions>(() => ({ serverId, action: ItemAction.Link,
        queryKey: ['JellyfinMod', api?.basePath, user?.Id, 'SearchBrowse'] }), [serverId, api?.basePath, user?.Id]);
    const [selectedLibraries, setSelectedLibraries] = useState<Partial<Record<MediaType, string>>>(() => loadLibraryChoice(user?.Id));
    useEffect(() => {
        try {
            sessionStorage.setItem(librariesKey(user?.Id), JSON.stringify(selectedLibraries));
        } catch {
            // The choice is a convenience; without storage it lasts for this search only.
        }
    }, [selectedLibraries, user?.Id]);
    // Titles added from this search, by TMDB identity: their card stays where it was and shows the cloud (state=added).
    const [added, setAdded] = useState<Map<string, Entry>>(() => new Map());
    const [adding, setAdding] = useState<Set<string>>(() => new Set());
    const shownResults = useRef<TmdbMetadata[]>([]);
    const shownOrder = useRef<string[]>([]);
    // Undo stays in the page, is focused on TV and waits for the viewer instead of a 4-second toast (P1.W13).
    const [undoEntry, setUndoEntry] = useState<Entry | null>(null);
    const undoButton = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (undoEntry && layoutManager.tv) undoButton.current?.focus();
    }, [undoEntry]);
    const active = useRef(true);
    useEffect(() => {
        active.current = true;
        return () => {
            active.current = false;
        };
    }, []);

    const libraries = useMemo(() => ({
        movie: (views.data?.Items ?? []).filter(view => view.CollectionType === CollectionType.Movies && view.Id),
        series: (views.data?.Items ?? []).filter(view => view.CollectionType === CollectionType.Tvshows && view.Id)
    }), [views.data?.Items]);

    const browse = useQueries({
        queries: TYPES.map(mediaType => ({
            queryKey: ['JellyfinMod', api?.basePath, user?.Id, 'SearchBrowse', mediaType, queryInput],
            queryFn: ({ signal }: { signal: AbortSignal }) => browseEntries(api!, {
                mediaType,
                query: queryInput,
                sortBy: ['SortName'],
                sortOrder: 'Ascending',
                startIndex: 0,
                limit: 200
            }, { signal }),
            enabled: !!api && !!user?.Id && health.data?.ok === true,
            retry: false
        }))
    });

    const movieDiscovery = useDiscovery('movie', undefined, queryInput, true);
    const seriesDiscovery = useDiscovery('series', undefined, queryInput, true);
    const discovery = [movieDiscovery, seriesDiscovery];

    // The two lead actors of a library title Jellyfin holds: its people, read for the titles on this page only.
    const libraryRows = browse.flatMap(result => result.data?.items ?? []);
    const nativeIds = libraryRows.flatMap(row => (row.kind === 'native' && row.nativeItem.Id ? [row.nativeItem.Id] : []));
    const people = useQuery({
        queryKey: ['JellyfinMod', api?.basePath, user?.Id, 'SearchPeople', nativeIds.join(',')],
        queryFn: async ({ signal }) => (await getLibraryApi(api!).getItems({ userId: user!.Id, ids: nativeIds,
            fields: [ItemFields.People] }, { signal })).data.Items ?? [],
        enabled: !!api && !!user?.Id && !!libraryPageSize && nativeIds.length > 0,
        retry: false
    });
    const nativeLeads = useMemo(() => new Map((people.data ?? []).map(item => [item.Id,
        (item.People ?? []).filter(person => person.Type === 'Actor' && person.Name).slice(0, 2).map(person => person.Name!)])),
    [people.data]);

    const targetFor = useCallback((mediaType: MediaType) => {
        const compatible = libraries[mediaType];
        // Opened from a library of this kind: that library, as before D201; else the only one, else the session's choice.
        if (parentId && compatible.some(library => library.Id === parentId)) return parentId;
        if (compatible.length === 1) return compatible[0].Id ?? undefined;
        return selectedLibraries[mediaType];
    }, [libraries, parentId, selectedLibraries]);

    const chooseLibrary = useCallback(async (mediaType: MediaType, button: HTMLElement) => {
        const id = await actionsheet.show({
            title: mediaType === 'movie' ? 'Movie Library' : 'TV Library',
            items: libraries[mediaType].map(library => ({ id: library.Id ?? '', name: library.Name ?? '' })),
            positionTo: button
        }) as string;
        setSelectedLibraries(current => ({ ...current, [mediaType]: id }));
        return id;
    }, [libraries]);

    const focusCard = (key: string) => {
        window.requestAnimationFrame(() => {
            resultsRef.current?.querySelector<HTMLElement>(`[data-jfmod-key="${key}"]`)?.focus();
        });
    };

    /** Adds a TMDB result to its library; answers the entry, or nothing when the add was cancelled or failed. */
    const add = useCallback(async (metadata: TmdbMetadata, button: HTMLElement): Promise<Entry | undefined> => {
        if (!api) return;
        const identity = identityOf(metadata.mediaType, metadata.tmdbId);
        let targetLibraryId = targetFor(metadata.mediaType);
        if (!targetLibraryId) {
            try {
                targetLibraryId = await chooseLibrary(metadata.mediaType, button);
            } catch {
                return;
            }
        }
        if (!targetLibraryId) return;
        setAdding(current => new Set(current).add(identity));
        try {
            const result = await createEntry(api, { mediaType: metadata.mediaType, tmdbId: metadata.tmdbId, targetLibraryId });
            await refreshCatalog(api.basePath, user?.Id);
            if (!active.current) return;
            setAdded(current => new Map(current).set(identity, result.entry));
            if (button === document.activeElement) focusCard(identity);
            // A duplicate/racing add returns created=false. Never let Undo delete an entry
            // that existed before this action, even for an administrator.
            if (user?.Policy?.IsAdministrator && result.created) setUndoEntry(result.entry);
            else toast('Added to catalog');
            return result.entry;
        } catch (error) {
            if (!active.current) return;
            toast('Could not add this title');
            console.error('[JellyfinMod] add from search failed', error);
        } finally {
            if (active.current) {
                setAdding(current => {
                    const next = new Set(current);
                    next.delete(identity);
                    return next;
                });
            }
        }
    }, [api, chooseLibrary, targetFor, user?.Id, user?.Policy?.IsAdministrator]);

    /**
     * The Download disc (ds.t17): the same add, then the release picker for the whole title. Closed without a grab, the title
     * stays in the library with no file, as after a plain add.
     */
    const download = useCallback(async (metadata: TmdbMetadata, button: HTMLElement) => {
        const entry = await add(metadata, button);
        if (entry && api && active.current) await openReleasePickerForEntry(api, entry.id);
    }, [add, api]);

    const undo = () => {
        const entry = undoEntry;
        if (!entry || !api) return;
        removeEntry(api, entry.id).then(async () => {
            const identity = identityOf(entry.mediaType, entry.tmdbId);
            setAdded(current => {
                const next = new Map(current);
                next.delete(identity);
                return next;
            });
            setUndoEntry(null);
            await refreshCatalog(api.basePath, user?.Id);
        }, (error: unknown) => {
            console.error('[JellyfinMod] undo failed', error);
            toast('Could not undo. The title is still in the catalog.');
        });
    };

    // TMDB's pages: page N of movies and page N of shows ranked together by TMDB's votes, pages in order. A title that a
    // refetch leaves out keeps its place during the search: the plugin's push refreshes every catalog query after an add, and
    // the card just added must stay where it was.
    const pageCount = Math.max(...discovery.map(result => result.data?.pages.length ?? 0));
    const fresh: TmdbMetadata[] = [];
    const seen = new Set<string>();
    for (let page = 0; page < pageCount; page++) {
        const items = discovery.flatMap((result, index) => (result.data?.pages[page]?.items ?? [])
            .map(metadata => ({ ...metadata, mediaType: TYPES[index] })));
        items.sort((left, right) => (right.voteCount ?? 0) - (left.voteCount ?? 0));
        for (const metadata of items) {
            const identity = identityOf(metadata.mediaType, metadata.tmdbId);
            if (seen.has(identity)) continue;
            seen.add(identity);
            fresh.push(metadata);
        }
    }
    const tmdbResults = fresh.slice();
    shownResults.current.forEach((metadata, index) => {
        if (!seen.has(identityOf(metadata.mediaType, metadata.tmdbId))) tmdbResults.splice(Math.min(index, tmdbResults.length), 0, metadata);
    });
    shownResults.current = tmdbResults;

    const hasMore = discovery.some(result => result.hasNextPage);
    const fetching = queryInput.length >= 2 && discovery.some(result => result.isFetching || result.isPending);
    const loadMore = useRef<() => void>();
    loadMore.current = () => {
        for (const result of discovery) {
            if (result.hasNextPage && !result.isFetching && !result.isError && !isDiscoveryExhausted(result.data?.pages)) result.fetchNextPage().catch(console.error);
        }
    };
    // More results load by themselves when the grid's end comes within a screen of the bottom.
    useEffect(() => {
        const end = endRef.current;
        if (!end || typeof IntersectionObserver === 'undefined') return;
        const observer = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) loadMore.current?.();
        }, { rootMargin: '0px 0px 100% 0px' });
        observer.observe(end);
        return () => observer.disconnect();
    }, [hasMore, fetching]);

    // A plugin outage keeps the exact upstream page working.
    if (health.isError || (health.isSuccess && !health.data.ok)) {
        return <SearchRows sections={stock.data ?? []} loading={stock.isPending} query={query} empty />;
    }

    const browseFailed = browse.some(result => result.isError);

    const tmdbCard = (metadata: TmdbMetadata): SearchCardItem => {
        const identity = identityOf(metadata.mediaType, metadata.tmdbId);
        const entry = added.get(identity);
        const base = { key: identity, mediaType: metadata.mediaType, tmdbId: metadata.tmdbId, title: metadata.title,
            year: yearOf(metadata.premiereDate), date: metadata.premiereDate, votes: metadata.voteCount, cast: leads(metadata.cast),
            poster: getTmdbImage(metadata.posterPath, 'w342') };
        if (entry) return { ...base, entry, href: '#' + getEntryPath(entry.id, serverId) };
        return { ...base,
            href: canBrowse ? '#' + getTmdbPath(metadata.mediaType, metadata.tmdbId, serverId) : undefined,
            add: { adding: adding.has(identity),
                onAdd: button => { add(metadata, button).catch(console.error); },
                onDownload: button => { download(metadata, button).catch(console.error); } } };
    };
    const apiClient = serverId ? ServerConnections.getApiClient(serverId) : undefined;
    const imageOf = (item: ItemDto) => (item.Id && item.ImageTags?.Primary ? apiClient?.getScaledImageUrl(item.Id,
        { type: 'Primary', maxWidth: 400, tag: item.ImageTags.Primary }) : undefined);
    const library = libraryRows.map(row => libraryCard(row, { serverId, nativeLeads, imageOf })).filter((item): item is SearchCardItem => !!item);
    const candidates = rankCandidates(library, browseFailed ? [] : tmdbResults.map(tmdbCard), added, queryInput);
    // Until the first answers are in, the grid shows only skeletons, so nothing moves once shown.
    const ready = isAnswered(browse, discovery, queryInput);
    const cards = shownCards(shownOrder, candidates, ready);
    const loading = fetching || !ready;

    const failedTypes = TYPES.filter((_, index) => discovery[index].isError);
    const discoveryFailed = failedTypes.length === TYPES.length;
    const stockSection = (title: 'Movies' | 'Shows') => stock.data?.find(section => section.title === title);
    const remainingSections = stock.data?.filter(section => section.title !== 'Movies' && section.title !== 'Shows') ?? [];
    const allEmpty = !loading && !cards.length && !remainingSections.length;
    const ended = queryInput.length >= 2 && !fetching && !hasMore && cards.length > 0;

    return <div ref={resultsRef} className='searchbody'>
        {browseFailed && <SearchRows sections={TYPES.flatMap(mediaType => {
            const section = stockSection(mediaType === 'movie' ? 'Movies' : 'Shows');
            return section ? [section] : [];
        })} loading={stock.isPending} query={query} />}
        {undoEntry && <div className='noticex' data-ds-notice='undo' role='status'>
            <span className='tx'>Added <b>{undoEntry.title}</b> to the catalog</span>
            <button ref={undoButton} type='button' className='btn focusable' onClick={undo}>Undo</button>
        </div>}
        {!browseFailed && !fetching && <DiscoveryNotice failedTypes={failedTypes} />}
        {/* Upstream's command container, so a library card's Play, Watched, Favourite and More run as on Home (ds.t16). */}
        <ItemsContainer isPlain className='libgrid searchresults' queryKey={cardOptions.queryKey}><div className='grid searchgrid itemsContainer' aria-busy={loading}>
            {cards.map(item => <SearchCell key={item.key} item={item} options={cardOptions} />)}
            {loading && !browseFailed && Array.from({ length: 10 }, (_, index) => <CellSkeleton key={index} library />)}
        </div></ItemsContainer>
        <div ref={endRef} />
        {ended && <div className='empty searchend'>No more results for “{queryInput}”</div>}
        <SearchRows sections={remainingSections} query={query} />
        {allEmpty && !discoveryFailed && <div className='plain empty'><h3>No results for “{query}”</h3><p>Check the spelling, or try fewer words.</p></div>}
    </div>;
};

/** A new search scope owns its own added titles and pending focus callbacks. */
const CatalogSearchResults: FC<Props> = props => {
    const { api, user } = useApi();
    const scope = JSON.stringify([api?.basePath, user?.Id, props.parentId, props.collectionType, props.query.trim()]);
    return <SearchSession key={scope} {...props} />;
};

export default CatalogSearchResults;
