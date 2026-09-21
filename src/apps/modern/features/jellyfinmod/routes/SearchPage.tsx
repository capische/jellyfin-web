import type { CollectionType } from '@jellyfin/sdk/lib/generated-client/models/collection-type';
import React, { type FC } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDebounceValue } from 'usehooks-ts';

import SearchFields from 'apps/legacy/features/search/components/SearchFields';
import SearchSuggestions from 'apps/legacy/features/search/components/SearchSuggestions';
import Page from 'components/Page';
import useSearchParam from 'hooks/useSearchParam';
import globalize from 'lib/globalize';

import CatalogSearchResults from '../components/CatalogSearchResults';

const COLLECTION_TYPE_PARAM = 'collectionType';
const PARENT_ID_PARAM = 'parentId';
const QUERY_PARAM = 'query';

/**
 * The JellyfinMod Search page (P7.S6).
 *
 * Upstream's search page, field for field: the same `Page`, the same `SearchFields`, the same debounce and the
 * same suggestions when the field is empty. The single difference is the results component — `CatalogSearchResults`,
 * which renders upstream's own `SearchResults` sections and adds the Add-from-TMDB zone beneath them (W4, W13).
 *
 * This used to be an edit to `apps/legacy/routes/search.tsx`, swapping that one import. Owning the route here
 * instead is what lets that upstream file go back to its upstream text (§3.2), so "plugin off" is stock by
 * construction rather than by gating.
 *
 * Registered for both layouts, because both route tables resolve `search` to the same React component; nothing
 * about this page is layout-specific beyond what upstream's own components already handle.
 */
const SearchPage: FC = () => {
    const [searchParams] = useSearchParams();
    const parentIdQuery = searchParams.get(PARENT_ID_PARAM) || undefined;
    const collectionTypeQuery = (searchParams.get(COLLECTION_TYPE_PARAM) || undefined) as CollectionType | undefined;
    const [query, setQuery] = useSearchParam(QUERY_PARAM);
    const [debouncedQuery] = useDebounceValue(query, 500);

    return (
        <Page
            id='searchPage'
            title={globalize.translate('Search')}
            className='mainAnimatedPage libraryPage allLibraryPage noSecondaryNavPage'
        >
            <SearchFields query={query} onSearch={setQuery} />
            {!debouncedQuery ? (
                <SearchSuggestions
                    parentId={parentIdQuery}
                />
            ) : (
                <CatalogSearchResults
                    parentId={parentIdQuery}
                    collectionType={collectionTypeQuery}
                    query={debouncedQuery}
                />
            )}
        </Page>
    );
};

export default SearchPage;
