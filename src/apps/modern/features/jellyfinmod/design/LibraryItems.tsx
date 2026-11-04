import React, { type FC, useCallback, useLayoutEffect, useState } from 'react';
import { ImageType } from '@jellyfin/sdk/lib/generated-client/models/image-type';
import { ItemSortBy } from '@jellyfin/sdk/lib/generated-client/models/item-sort-by';
import { useLibrary } from 'apps/modern/features/libraries/hooks/useLibrary';
import ItemsView from 'apps/modern/features/libraries/components/ItemsView';
import { useApi } from 'hooks/useApi';
import { CardShape } from 'components/cardbuilder/utils/shape';
import { setCardData } from 'components/cardbuilder/cardBuilder';
import ItemsContainer from 'elements/emby-itemscontainer/ItemsContainer';
import type { BrowseRow } from '../types/browse';
import { ViewMode } from 'types/library';
import { Cell, CellSkeleton } from './Cell';
import LibraryCast from '../components/LibraryCast';

export const LibraryItems: FC = () => {
    const { id, content, viewSettings, setViewSettings, browseResult, itemsResult } = useLibrary();
    const { api, user, __legacyApiClient__ } = useApi();
    const [width, setWidth] = useState(window.innerWidth);
    useLayoutEffect(() => {
        const resize = () => setWidth(window.innerWidth);
        window.addEventListener('resize', resize);
        return () => window.removeEventListener('resize', resize);
    }, []);
    const reset = useCallback(() => setViewSettings?.(previous => ({ ...previous, StartIndex: 0, Filters: undefined, Alphabet: undefined })), [setViewSettings]);
    if (viewSettings?.ViewMode === ViewMode.ListView) return <ItemsView />;
    const combined = browseResult?.data && (browseResult.data.hasCatalogEntries || viewSettings?.Filters?.FileStates?.length || viewSettings?.Filters?.RetentionDueWithinDays) ?
        browseResult.data : undefined;
    const rows: BrowseRow[] = combined?.items ?? (itemsResult?.data?.Items ?? []).map(nativeItem => ({ kind: 'native', nativeItem }));
    const loading = browseResult?.isSelectingSource || (!combined && (!itemsResult || itemsResult.isPending));
    const error = combined ? browseResult?.error : itemsResult?.error;
    const imageType = viewSettings?.ImageType ?? ImageType.Primary;
    const preferThumb = imageType === ImageType.Thumb;
    const preferLogo = imageType === ImageType.Logo;
    const options = { shape: preferThumb || preferLogo ? CardShape.Backdrop : CardShape.Portrait,
        preferThumb, preferLogo, preferBanner: imageType === ImageType.Banner, preferDisc: imageType === ImageType.Disc, imageType,
        showTitle: true, showYear: true,
        context: content?.collectionType ?? undefined, serverId: __legacyApiClient__?.serverId(),
        queryKey: combined ? ['JellyfinMod', api?.basePath, user?.Id, 'Browse'] : ['User', user?.Id, 'Items'] };
    setCardData(rows.flatMap(row => row.kind === 'native' ? [row.nativeItem] : []), options);
    const count = Math.round((width - width * 0.033 - 5.236 * 14.88 + 2 * 14.88) / (16.18 * 14.88));
    const emptyKind = content?.collectionType === 'tvshows' ? 'shows' : 'movies';
    let body;
    if (loading) {
        body = <div className='grid libposters' aria-busy='true' aria-label='Loading' style={{ '--n': count } as React.CSSProperties}>
            {Array.from({ length: 14 }, (_, index) => <CellSkeleton key={index} library />)}
        </div>;
    } else if (error && !rows.length) {
        body = <div className='empty' role='alert'><h3>Unable to load this view</h3>
            <p>{error.message}</p><button className='btn' onClick={() => { void (combined ? browseResult?.refetch() : itemsResult?.refetch()); }}>Retry</button></div>;
    } else if (!rows.length) {
        body = <div className='empty'><h3>Nothing here</h3><p>This view has no {emptyKind} yet. Add one from Search, or clear the filter.</p>
            <button className='btn' onClick={reset}>Clear Filter</button></div>;
    } else {
        body = <ItemsContainer isPlain className='grid libposters' parentId={id} queryKey={options.queryKey}
            reloadItems={combined ? browseResult?.refetch : itemsResult?.refetch}>
            {rows.map(row => <Cell key={row.kind === 'native' ? row.nativeItem.Id : row.entry.id} row={row} options={options} alwaysShowCountdown={!!viewSettings?.Filters?.RetentionDueWithinDays} />)}
            <LibraryCast rows={rows} />
        </ItemsContainer>;
    }
    return <div className='libgrid' style={{ '--n': count } as React.CSSProperties}>
        {body}
        {content?.isAlphabetPickerEnabled && !viewSettings?.SortBy.includes(ItemSortBy.Random) && <div className='rail' aria-label='Alphabet'>
            {'#ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(letter => <button key={letter} className='focusable'
                aria-label={letter} aria-pressed={viewSettings?.Alphabet === letter}
                onClick={() => setViewSettings?.(previous => ({ ...previous, StartIndex: 0, Alphabet: previous.Alphabet === letter ? undefined : letter }))}><span className={viewSettings?.Alphabet === letter ? 'on' : undefined}>{letter}</span></button>)}
        </div>}
    </div>;
};
