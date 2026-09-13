import { CollectionType } from '@jellyfin/sdk/lib/generated-client/models/collection-type';
import { useQueries } from '@tanstack/react-query';
import React, { type FC, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import SearchResults from 'apps/legacy/features/search/components/SearchResults';
import SearchResultsRow from 'apps/legacy/features/search/components/SearchResultsRow';
import { useSearchItems } from 'apps/legacy/features/search/api/useSearchItems';
import { CardShape } from 'components/cardbuilder/utils/shape';
import toast from 'components/toast/toast';
import { useUserViews } from 'hooks/api/useUserViews';
import { useApi } from 'hooks/useApi';
import globalize from 'lib/globalize';
import { queryClient } from 'utils/query/queryClient';

import { browseEntries, createEntry, removeEntry } from '../api/modApi';
import { useDiscovery } from '../hooks/useDiscovery';
import { usePluginHealth } from '../hooks/useEntries';
import type { BrowseRow } from '../types/browse';
import { FileState, type Entry, type TmdbMetadata } from '../types/entry';
import { getTmdbImage } from '../utils/entryLinks';
import EntryCards from './EntryCards';

import './catalogSearch.scss';

interface Props {
    parentId?: string;
    collectionType?: CollectionType;
    query: string;
}

type MediaType = 'movie' | 'series';

const cardOptions = {
    shape: CardShape.AutoOverflow,
    scalable: true,
    showTitle: true,
    showYear: true,
    overlayText: false,
    centerText: true,
    allowBottomPadding: false
};

const EntrySection: FC<{ mediaType: MediaType; title: string; rows: BrowseRow[]; serverId?: string }> = ({ mediaType, title, rows, serverId }) => {
    const element = useRef<HTMLElement>(null);
    const [itemsContainer, setItemsContainer] = useState<Element | null>(null);

    useEffect(() => {
        setItemsContainer(element.current?.querySelector('.itemsContainer') ?? null);
    }, []);

    return <section ref={element} className='verticalSection' data-jfmod-media-type={mediaType}>
        <h2 className='sectionTitle sectionTitle-cards padded-left padded-right'>{title}</h2>
        <div dangerouslySetInnerHTML={{
            __html: `<div is="emby-scroller" data-horizontal="true" data-centerfocus="card" class="padded-top-focusscale padded-bottom-focusscale">
                <div is="emby-itemscontainer" class="focuscontainer-x itemsContainer scrollSlider"></div>
            </div>`
        }} />
        {itemsContainer && createPortal(<EntryCards rows={rows} cardOptions={{ ...cardOptions, serverId }} />, itemsContainer)}
    </section>;
};

const optimisticEntry = (metadata: TmdbMetadata, targetLibraryId: string): Entry => ({
    id: `pending:${metadata.mediaType}:${metadata.tmdbId}:${targetLibraryId}`,
    mediaType: metadata.mediaType,
    tmdbId: metadata.tmdbId,
    imdbId: metadata.imdbId,
    title: metadata.title,
    year: metadata.premiereDate ? Number(metadata.premiereDate.slice(0, 4)) : null,
    overview: metadata.overview,
    posterPath: metadata.posterPath,
    metadata,
    state: FileState.None,
    monitored: true,
    targetLibraryId,
    addedAt: new Date().toISOString()
});

const showAddedToast = (canUndo: boolean, onUndo: () => void) => {
    if (!canUndo) {
        toast('Added to catalog');
        return;
    }
    const container = document.createElement('div');
    container.className = 'toast jfmod-addToast toastVisible';
    container.textContent = 'Added to catalog ';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'jfmod-addToastUndo';
    button.textContent = 'Undo';
    button.addEventListener('click', () => {
        onUndo();
        container.remove();
    }, { once: true });
    container.appendChild(button);
    document.body.appendChild(container);
    window.setTimeout(() => container.remove(), 4000);
};

const SearchSession: FC<Props> = ({ parentId, collectionType, query }) => {
    const resultsRef = useRef<HTMLDivElement>(null);
    const { api, user, __legacyApiClient__ } = useApi();
    const health = usePluginHealth();
    const stock = useSearchItems(parentId, collectionType, query.trim());
    const views = useUserViews({ userId: user?.Id });
    const queryInput = query.trim();
    const types = useMemo<MediaType[]>(() => {
        if (collectionType === CollectionType.Movies) return ['movie'];
        if (collectionType === CollectionType.Tvshows) return ['series'];
        return ['movie', 'series'];
    }, [collectionType]);
    const [optimistic, setOptimistic] = useState<Entry[]>([]);
    const [selectedLibraries, setSelectedLibraries] = useState<Partial<Record<MediaType, string>>>({});
    const active = useRef(true);
    const inFlight = useRef(new Set<string>());
    useEffect(() => {
        active.current = true;
        return () => {
            active.current = false;
        };
    }, []);

    const focusMovedEntry = (metadata: TmdbMetadata) => {
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
                const section = resultsRef.current?.querySelector(`[data-jfmod-media-type="${metadata.mediaType}"]`);
                const card = section?.querySelector<HTMLElement>(`[data-jfmod-tmdb-id="${metadata.tmdbId}"]`);
                const target = card?.matches('a, button') ? card : card?.querySelector<HTMLElement>('a[href], button');
                target?.focus();
            });
        });
    };

    const libraries = useMemo(() => ({
        movie: (views.data?.Items ?? []).filter(view => view.CollectionType === CollectionType.Movies && view.Id),
        series: (views.data?.Items ?? []).filter(view => view.CollectionType === CollectionType.Tvshows && view.Id)
    }), [views.data?.Items]);

    const browse = useQueries({
        queries: types.map(mediaType => ({
            queryKey: ['JellyfinMod', api?.basePath, user?.Id, 'SearchBrowse', mediaType, parentId, queryInput],
            queryFn: ({ signal }: { signal: AbortSignal }) => browseEntries(api!, {
                mediaType,
                targetLibraryId: parentId,
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

    const movieDiscovery = useDiscovery('movie', parentId, queryInput, types.includes('movie'));
    const seriesDiscovery = useDiscovery('series', parentId, queryInput, types.includes('series'));
    const discovery = types.map(type => type === 'movie' ? movieDiscovery : seriesDiscovery);
    const authoritativeIds = browse.flatMap(result => result.data?.items ?? [])
        .flatMap(row => row.entry ? [row.entry.id] : []).sort((left, right) => left.localeCompare(right)).join(',');
    useEffect(() => {
        const ids = new Set(authoritativeIds.split(','));
        setOptimistic(current => current.some(entry => ids.has(entry.id)) ?
            current.filter(entry => !ids.has(entry.id)) : current);
    }, [authoritativeIds]);

    // A plugin outage keeps the exact upstream page working.
    if (health.isError || (health.isSuccess && !health.data.ok)) {
        return <SearchResults parentId={parentId} collectionType={collectionType} query={query} />;
    }

    const remainingSections = stock.data?.filter(section => section.title !== 'Movies' && section.title !== 'Shows') ?? [];
    const rowsByType = (mediaType: MediaType): BrowseRow[] => {
        const index = types.indexOf(mediaType);
        const serverRows = index >= 0 ? browse[index]?.data?.items ?? [] : [];
        const pendingRows: Extract<BrowseRow, { kind: 'entry' }>[] = optimistic.filter(entry => entry.mediaType === mediaType)
            .map(entry => ({ kind: 'entry', entry }));
        const pendingKeys = new Set(optimistic.filter(entry => entry.mediaType === mediaType)
            .map(entry => `${entry.mediaType}:${entry.tmdbId}`));
        return [...pendingRows, ...serverRows.filter(row => {
            const entry = row.entry;
            return !entry || !pendingKeys.has(`${entry.mediaType}:${entry.tmdbId}`);
        })];
    };
    const heldIdentities = new Set([...optimistic, ...browse.flatMap(result => result.data?.items ?? [])
        .flatMap(row => row.entry ? [row.entry] : [])].map(entry => `${entry.mediaType}:${entry.tmdbId}`));
    const discovered = types.flatMap((mediaType, index) => (discovery[index]?.data?.pages.flatMap(page => page.items) ?? [])
        .map(metadata => ({ ...metadata, mediaType })))
        .filter(metadata => !heldIdentities.has(`${metadata.mediaType}:${metadata.tmdbId}`))
        .filter((metadata, index, items) => items.findIndex(item => item.mediaType === metadata.mediaType && item.tmdbId === metadata.tmdbId) === index);
    const discoveryPending = queryInput.length >= 2 && discovery.some(result => result.isPending);
    const discoveryFailed = discovery.some(result => result.isError);

    const targetFor = (mediaType: MediaType) => {
        if (parentId) return parentId;
        const compatible = libraries[mediaType];
        if (compatible.length === 1) return compatible[0].Id;
        return selectedLibraries[mediaType];
    };

    const undoAdd = async (entry: Entry) => {
        if (!api) return;
        await removeEntry(api, entry.id);
        setOptimistic(current => current.filter(candidate => candidate.id !== entry.id));
        await queryClient.invalidateQueries({ queryKey: ['JellyfinMod', api.basePath, user?.Id] });
    };

    const add = async (metadata: TmdbMetadata) => {
        const targetLibraryId = targetFor(metadata.mediaType);
        if (!api || !targetLibraryId) return;
        const identity = `${metadata.mediaType}:${metadata.tmdbId}`;
        if (inFlight.current.has(identity)) return;
        inFlight.current.add(identity);
        const inputWasFocused = document.activeElement?.matches('input[type="search"], .searchField') === true;
        let succeeded = false;
        const pending = optimisticEntry(metadata, targetLibraryId);
        setOptimistic(current => [...current, pending]);
        if (!inputWasFocused) focusMovedEntry(metadata);
        try {
            const result = await createEntry(api, { mediaType: metadata.mediaType, tmdbId: metadata.tmdbId, targetLibraryId });
            succeeded = true;
            if (!active.current) {
                await queryClient.invalidateQueries({ queryKey: ['JellyfinMod', api.basePath, user?.Id] });
                return;
            }
            setOptimistic(current => current.map(entry => entry.id === pending.id ? result.entry : entry));
            if (!inputWasFocused) focusMovedEntry(metadata);
            await queryClient.invalidateQueries({ queryKey: ['JellyfinMod', api.basePath, user?.Id] });
            // A duplicate/racing add returns created=false. Never let Undo delete an entry
            // that existed before this action, even for an administrator.
            if (!active.current) return;
            showAddedToast(!!user?.Policy?.IsAdministrator && result.created, undoAdd.bind(null, result.entry));
        } catch (error) {
            if (!active.current) return;
            setOptimistic(current => current.filter(entry => entry.id !== pending.id));
            toast('Could not add this title');
            console.error('[JellyfinMod] add from search failed', error);
        } finally {
            inFlight.current.delete(identity);
            if (active.current && !succeeded && !inputWasFocused) {
                window.requestAnimationFrame(() => {
                    if (!active.current) return;
                    const button = resultsRef.current?.querySelector<HTMLElement>(`[data-jfmod-add="${identity}"]`);
                    const fallback = resultsRef.current?.querySelector<HTMLElement>('[data-jfmod-add]:not(:disabled)');
                    (button ?? fallback ?? document.querySelector<HTMLElement>('#searchPage input[type="search"], #searchPage .searchField'))?.focus();
                });
            } else if (active.current && inputWasFocused) {
                (document.querySelector('#searchPage input[type="search"], #searchPage .searchField') as HTMLElement | null)?.focus();
            } else if (active.current) {
                focusMovedEntry(metadata);
            }
        }
    };

    const renderEntrySection = (mediaType: MediaType, title: string) => {
        const rows = rowsByType(mediaType);
        return rows.length ? <EntrySection key={mediaType} mediaType={mediaType} title={globalize.translate(title)}
            rows={rows} serverId={__legacyApiClient__?.serverId()} /> : null;
    };

    const stockSection = (title: 'Movies' | 'Shows') => stock.data?.find(section => section.title === title);
    const renderMediaSection = (mediaType: MediaType, title: 'Movies' | 'Shows') => {
        const index = types.indexOf(mediaType);
        if (index >= 0 && browse[index]?.isError) {
            const section = stockSection(title);
            return section ? <SearchResultsRow
                key={mediaType}
                title={globalize.translate(section.title)}
                items={section.items}
                cardOptions={{ ...cardOptions, ...section.cardOptions }}
            /> : null;
        }
        return renderEntrySection(mediaType, title);
    };
    const browseFailed = browse.some(result => result.isError);
    const stockMediaItems = types.reduce((count, mediaType) => {
        const index = types.indexOf(mediaType);
        const title = mediaType === 'movie' ? 'Movies' : 'Shows';
        return count + (browse[index]?.isError ? stockSection(title)?.items.length ?? 0 : 0);
    }, 0);
    const allEmpty = !optimistic.length && !browse.some(result => result.data?.items.length) && !stockMediaItems && !remainingSections.length && !discovered.length;
    return <div ref={resultsRef} className='searchResults jfmod-searchResults padded-top padded-bottom-page'>
        {types.includes('movie') && renderMediaSection('movie', 'Movies')}
        {types.includes('series') && renderMediaSection('series', 'Shows')}
        {remainingSections.map(section => <SearchResultsRow
            key={section.title}
            title={globalize.translate(section.title)}
            items={section.items}
            cardOptions={{ ...cardOptions, ...section.cardOptions }}
        />)}
        {!browseFailed && <section className='verticalSection jfmod-discovery' aria-busy={discoveryPending}>
            <div className='jfmod-discoveryHeading padded-left padded-right'>
                <h2 className='sectionTitle sectionTitle-cards'>Add from TMDB</h2>
                {!discoveryFailed && !parentId && types.map(mediaType => libraries[mediaType].length > 1 && <label key={mediaType}>
                    <span>{mediaType === 'movie' ? 'Movie library' : 'TV library'}</span>
                    {/* This controlled select is scoped to its media type. */}
                    {/* eslint-disable-next-line react/jsx-no-bind */}
                    <select value={selectedLibraries[mediaType] ?? ''} onChange={event => setSelectedLibraries(current => ({ ...current, [mediaType]: event.target.value }))}>
                        <option value=''>Choose library</option>
                        {libraries[mediaType].map(library => <option key={library.Id} value={library.Id}>{library.Name}</option>)}
                    </select>
                </label>)}
            </div>
            {discoveryPending && <div className='jfmod-searchSkeletons padded-left padded-right' aria-label='Searching TMDB'>
                {[0, 1, 2, 3, 4, 5].map(index => <span key={index} />)}
            </div>}
            {!discoveryPending && discoveryFailed && <p className='jfmod-searchNotice padded-left padded-right'>TMDB is unavailable. Your library results are still shown above.</p>}
            {!discoveryPending && !discoveryFailed && <div className='jfmod-discoveryCards padded-left padded-right focuscontainer-x'>
                {discovered.map(metadata => <article className='jfmod-discoveryCard' key={`${metadata.mediaType}:${metadata.tmdbId}`}>
                    <div className='jfmod-discoveryArtwork' style={getTmdbImage(metadata.posterPath) ? { backgroundImage: `url("${getTmdbImage(metadata.posterPath)}")` } : undefined} />
                    <div className='jfmod-discoveryTitle'>{metadata.title}</div>
                    {/* eslint-disable-next-line react/jsx-no-bind */}
                    <button type='button' className='emby-button button-submit' disabled={!targetFor(metadata.mediaType)} onClick={() => { add(metadata).catch(console.error); }} data-jfmod-add={`${metadata.mediaType}:${metadata.tmdbId}`} aria-label={`Add ${metadata.title} to catalog`}>+</button>
                </article>)}
            </div>}
            {types.map((mediaType, index) => discovery[index]?.hasNextPage && <button
                key={mediaType} type='button' className='emby-button' disabled={discovery[index].isFetching}
                // eslint-disable-next-line react/jsx-no-bind
                onClick={() => { discovery[index].fetchNextPage().catch(console.error); }}>
                {discovery[index].isFetching ? 'Loading…' : `More ${mediaType} results from TMDB`}
            </button>)}
        </section>}
        {allEmpty && !discoveryPending && !discoveryFailed && <div className='noItemsMessage centerMessage'>{globalize.translate('SearchResultsEmpty', query)}</div>}
    </div>;
};

/** A new search scope owns its own optimistic state and pending focus callbacks. */
const CatalogSearchResults: FC<Props> = props => {
    const { api, user } = useApi();
    const scope = JSON.stringify([api?.basePath, user?.Id, props.parentId, props.collectionType, props.query.trim()]);
    return <SearchSession key={scope} {...props} />;
};

export default CatalogSearchResults;
