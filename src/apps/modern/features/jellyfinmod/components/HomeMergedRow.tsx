import { ImageType } from '@jellyfin/sdk/lib/generated-client/models/image-type';
import { ItemFields } from '@jellyfin/sdk/lib/generated-client/models/item-fields';
import { useQueries } from '@tanstack/react-query';
import React, { type FC, useMemo } from 'react';

import { getLatestMediaQuery } from 'apps/legacy/features/libraries/api/useLatestMedia';
import { setCardData } from 'components/cardbuilder/cardBuilder';
import { CardShape } from 'components/cardbuilder/utils/shape';
import { useApi } from 'hooks/useApi';
import type { ItemDto } from 'types/base/models/item-dto';

import { browseEntries } from '../api/modApi';
import { useContinueWatching } from '../hooks/useContinueWatching';
import { usePluginHealth } from '../hooks/useEntries';
import type { BrowseRow } from '../types/browse';
import { FileState } from '../types/entry';
import { Cell, CellSkeleton } from '../design/Cell';
import { Root } from '../design/Root';
import { Section } from '../design/Section';
import LibraryCast from './LibraryCast';

interface ContinueProps {
    mode: 'continue';
    includeResume: boolean;
    includeNextUp: boolean;
}

interface RecentProps {
    mode: 'recent';
    movieLibraryIds: string[];
    seriesLibraryIds: string[];
}

type Props = ContinueProps | RecentProps;

const rowOptions = {
    shape: CardShape.Backdrop,
    preferThumb: true,
    overlayText: false,
    showTitle: true,
    showParentTitle: true,
    showDetailsMenu: true,
    overlayPlayButton: true,
    context: 'home',
    centerText: true,
    allowBottomPadding: false,
    showYear: true,
    lines: 2
};

const portraitOptions = {
    ...rowOptions,
    shape: CardShape.Portrait,
    preferThumb: false,
    preferParentPoster: true,
    showParentTitle: true
};

const RowShell: FC<{ title: string; rows: BrowseRow[]; wide?: boolean; loading?: boolean; motionReady?: boolean }> = ({ title, rows, wide, loading, motionReady }) => {
    const { api, user, __legacyApiClient__ } = useApi();
    const options = { ...(wide ? rowOptions : portraitOptions), serverId: __legacyApiClient__?.serverId(),
        queryKey: ['JellyfinMod', api?.basePath, user?.Id] };
    setCardData(rows.flatMap(row => row.kind === 'native' ? [row.nativeItem] : []), options);
    if (!rows.length && !loading && motionReady === undefined) return null;
    return <Root><Section title={title} queryKey={options.queryKey}
        motionIds={motionReady === undefined || loading ? undefined : rows.map(row => row.kind === 'native' ? row.nativeItem.Id! : row.entry.id)} motionReady={motionReady}>
        {rows.map(row => <Cell key={row.kind === 'native' ? row.nativeItem.Id : row.entry.id} row={row} options={options} />)}
        {loading && !rows.length && Array.from({ length: 6 }, (_, index) => <CellSkeleton key={index} wide={wide} library />)}
        <LibraryCast rows={rows} />
    </Section></Root>;
};

const ContinueRow: FC<ContinueProps> = ({ includeResume, includeNextUp }) => {
    const { items, answered, settled } = useContinueWatching({ includeResume, includeNextUp });
    return <RowShell title='Continue Watching' rows={items.map(nativeItem => ({ kind: 'native', nativeItem }))} wide loading={!answered} motionReady={settled} />;
};

/** A Browse row that is a title's placeholder item standing for its entry (P1.FU26). */
const isPlaceholderRow = (row: BrowseRow) => row.kind === 'native' && !!row.entry?.placeholderItemId
    && row.entry.placeholderItemId.replace(/-/g, '').toLowerCase() === row.nativeItem.Id?.replace(/-/g, '').toLowerCase();

const RecentRow: FC<RecentProps> = ({ movieLibraryIds, seriesLibraryIds }) => {
    const { api, user } = useApi();
    const health = usePluginHealth();
    const libraryIds = [...movieLibraryIds, ...seriesLibraryIds];
    const latest = useQueries({ queries: libraryIds.map(parentId => ({ ...getLatestMediaQuery(api, {
        userId: user?.Id, parentId, limit: 16, fields: [ItemFields.PrimaryImageAspectRatio, ItemFields.DateCreated, ItemFields.ProviderIds], imageTypeLimit: 1,
        enableImageTypes: [ImageType.Primary, ImageType.Backdrop, ImageType.Thumb]
    }), enabled: !!api && !!user?.Id })) });
    const scopes = [...movieLibraryIds.map(targetLibraryId => ({ mediaType: 'movie' as const, targetLibraryId })),
        ...seriesLibraryIds.map(targetLibraryId => ({ mediaType: 'series' as const, targetLibraryId }))];
    const catalog = useQueries({ queries: scopes.map(({ mediaType, targetLibraryId }) => ({
        queryKey: ['JellyfinMod', api?.basePath, user?.Id, 'HomeRecent', mediaType, targetLibraryId],
        queryFn: ({ signal }: { signal: AbortSignal }) => browseEntries(api!, {
            mediaType, targetLibraryId, sortBy: ['DateCreated'], sortOrder: 'Descending', startIndex: 0, limit: 24,
            state: [],
            filters: {
                genres: [], years: [], officialRatings: [], tags: [], studioIds: [], status: [], seriesStatus: [],
                features: [], videoBasicFilter: [], videoTypes: [], audioLanguages: [], subtitleLanguages: []
            }
        }, { signal }),
        enabled: !!api && !!user?.Id && health.data?.ok === true,
        retry: false
    })) });
    const rows = useMemo<BrowseRow[]>(() => {
        const nativeItems = latest.flatMap(result => result.data ?? [])
            .filter(item => item.Id)
            .sort((a, b) => String(b.DateCreated ?? '').localeCompare(String(a.DateCreated ?? '')) || String(a.Id).localeCompare(String(b.Id)));
        const nativeRows: BrowseRow[] = nativeItems.map(nativeItem => ({ kind: 'native', nativeItem: nativeItem as ItemDto }));
        // Native rows already come from each allowed Latest feed. Only append file-less
        // catalog rows here or the same native item appears twice in Recently Added.
        // A reclaimed title was watched and removed; it is not something recently added (P3.T14).
        // A title with no file that Jellyfin shows through its placeholder (P1.FU26) comes as that item, carrying its entry; it
        // was added when the entry was, and Latest leaves placeholders out.
        const entryRows = catalog.flatMap(result => result.data?.items ?? [])
            .filter(row => row.kind === 'entry' || isPlaceholderRow(row))
            .filter(row => row.entry?.state !== FileState.Reclaimed);
        const seen = new Set<string>();
        const uniqueRows = [...nativeRows, ...entryRows].filter(row => {
            const item = row.kind === 'native' ? row.nativeItem : undefined;
            const keys = item ? Object.entries(item.ProviderIds ?? {})
                .filter(([provider, id]) => id && ['tmdb', 'tvdb', 'imdb'].includes(provider.toLowerCase()))
                .map(([provider, id]) => `${item.Type}:${provider.toLowerCase()}:${id}`) :
                [`${row.entry!.mediaType === 'movie' ? 'Movie' : 'Series'}:tmdb:${row.entry!.tmdbId}`];
            if (!keys.length) keys.push(`native:${item?.Id}`);
            const duplicate = keys.some(key => seen.has(key));
            keys.forEach(key => {
                seen.add(key);
            });
            return !duplicate;
        });
        uniqueRows.sort((left, right) => {
            const leftDate = left.kind === 'native' && !isPlaceholderRow(left) ? left.nativeItem.DateCreated : left.entry?.addedAt;
            const rightDate = right.kind === 'native' && !isPlaceholderRow(right) ? right.nativeItem.DateCreated : right.entry?.addedAt;
            return String(rightDate ?? '').localeCompare(String(leftDate ?? ''));
        });
        return uniqueRows.slice(0, 24);
    }, [catalog, latest]);
    return <RowShell title='Recently Added' rows={rows} loading={latest.some(result => result.isPending)} />;
};

const HomeMergedRow: FC<Props> = props => props.mode === 'continue' ? <ContinueRow {...props} /> : <RecentRow {...props} />;

export default HomeMergedRow;
