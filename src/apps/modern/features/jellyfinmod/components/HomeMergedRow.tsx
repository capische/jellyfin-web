import { ImageType } from '@jellyfin/sdk/lib/generated-client/models/image-type';
import { ItemFields } from '@jellyfin/sdk/lib/generated-client/models/item-fields';
import { useQueries } from '@tanstack/react-query';
import React, { type FC, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { getNextUpQuery } from 'apps/legacy/features/libraries/api/useNextUp';
import { getResumeItemsQuery } from 'apps/legacy/features/libraries/api/useResumeItems';
import { getLatestMediaQuery } from 'apps/legacy/features/libraries/api/useLatestMedia';
import Card from 'components/cardbuilder/Card/Card';
import { setCardData } from 'components/cardbuilder/cardBuilder';
import { CardShape } from 'components/cardbuilder/utils/shape';
import { useApi } from 'hooks/useApi';
import type { ItemDto } from 'types/base/models/item-dto';

import { browseEntries } from '../api/modApi';
import { usePluginHealth } from '../hooks/useEntries';
import type { BrowseRow } from '../types/browse';
import EntryCards from './EntryCards';

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
    showParentTitle: true
};

const RowShell: FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => {
    const element = useRef<HTMLElement>(null);
    const [ itemsContainer, setItemsContainer ] = useState<Element | null>(null);

    useEffect(() => {
        setItemsContainer(element.current?.querySelector('.itemsContainer') ?? null);
    }, []);

    return <section ref={element} className='verticalSection'>
        <h2 className='sectionTitle sectionTitle-cards padded-left'>{title}</h2>
        <div dangerouslySetInnerHTML={{
            __html: `<div is="emby-scroller" class="padded-top-focusscale padded-bottom-focusscale" data-centerfocus="true">
                <div is="emby-itemscontainer" class="itemsContainer scrollSlider focuscontainer-x"></div>
            </div>`
        }} />
        {itemsContainer && createPortal(children, itemsContainer)}
    </section>;
};

const ContinueRow: FC<ContinueProps> = ({ includeResume, includeNextUp }) => {
    const { api, user, __legacyApiClient__ } = useApi();
    const queries = useQueries({ queries: [
        { ...getResumeItemsQuery(api, {
            userId: user?.Id, limit: 12, fields: [ItemFields.PrimaryImageAspectRatio], imageTypeLimit: 1,
            enableImageTypes: [ImageType.Primary, ImageType.Backdrop, ImageType.Thumb], enableTotalRecordCount: false, mediaTypes: ['Video']
        }), enabled: !!api && !!user?.Id && includeResume },
        { ...getNextUpQuery(api, {
            userId: user?.Id, limit: 24, fields: [ItemFields.PrimaryImageAspectRatio, ItemFields.DateCreated], imageTypeLimit: 1,
            enableImageTypes: [ImageType.Primary, ImageType.Backdrop, ImageType.Thumb], enableTotalRecordCount: false, enableResumable: false
        }), enabled: !!api && !!user?.Id && includeNextUp }
    ] });
    const items = useMemo(() => {
        const byId = new Map<string, ItemDto>();
        const resume = (queries[0].data?.Items ?? []) as ItemDto[];
        const next = (queries[1].data?.Items ?? []) as ItemDto[];
        // Resume wins when the same episode occurs in both feeds.
        for (const item of [...resume, ...next]) if (item.Id && !byId.has(item.Id)) byId.set(item.Id, item);
        return [...byId.values()].sort((left, right) => {
            const leftDate = left.UserData?.LastPlayedDate ?? left.DateCreated;
            const rightDate = right.UserData?.LastPlayedDate ?? right.DateCreated;
            return String(rightDate ?? '').localeCompare(String(leftDate ?? ''));
        }).slice(0, 24);
    }, [queries]);
    setCardData(items, { ...rowOptions, serverId: __legacyApiClient__?.serverId() });
    if (!items.length) return null;
    return <RowShell title='Continue watching'>{items.map(item => <Card key={item.Id} item={item} cardOptions={{ ...rowOptions, serverId: __legacyApiClient__?.serverId() }} />)}</RowShell>;
};

const RecentRow: FC<RecentProps> = ({ movieLibraryIds, seriesLibraryIds }) => {
    const { api, user, __legacyApiClient__ } = useApi();
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
            mediaType, targetLibraryId, sortBy: ['DateCreated'], sortOrder: 'Descending', startIndex: 0, limit: 24
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
        const entryRows = catalog.flatMap(result => result.data?.items ?? [])
            .filter((row): row is Extract<BrowseRow, { kind: 'entry' }> => row.kind === 'entry');
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
            const leftDate = left.kind === 'native' ? left.nativeItem.DateCreated : left.entry.addedAt;
            const rightDate = right.kind === 'native' ? right.nativeItem.DateCreated : right.entry.addedAt;
            return String(rightDate ?? '').localeCompare(String(leftDate ?? ''));
        });
        return uniqueRows.slice(0, 24);
    }, [catalog, latest]);
    if (!rows.length) return null;
    return <RowShell title='Recently Added'><EntryCards rows={rows} cardOptions={{ ...portraitOptions, serverId: __legacyApiClient__?.serverId() }} /></RowShell>;
};

const HomeMergedRow: FC<Props> = props => props.mode === 'continue' ? <ContinueRow {...props} /> : <RecentRow {...props} />;

export default HomeMergedRow;
