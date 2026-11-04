import React, { type FC, useRef } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { getSections, getFetchDataFn, getRouteUrl } from 'apps/legacy/controllers/favorites';
import Page from 'components/Page';
import ItemsContainer from 'elements/emby-itemscontainer/ItemsContainer';
import Scroller from 'elements/emby-scroller/Scroller';
import { useApi } from 'hooks/useApi';
import globalize from 'lib/globalize';
import { setCardData } from 'components/cardbuilder/cardBuilder';
import { ItemAction } from 'constants/itemAction';
import { CardShape } from 'components/cardbuilder/utils/shape';
import type { ItemDto } from 'types/base/models/item-dto';
import type { CardOptions } from 'types/cardOptions';
import { useTvGridFocus } from '../hooks/useTvGridFocus';
import { Cell, CellSkeleton } from './Cell';
import { Root } from './Root';
import LibraryCast from '../components/LibraryCast';

/** Favorites keeps the legacy section queries, including every extra media kind the mockup does not show. */
export const FavoritesPage: FC = () => {
    const { api, user, __legacyApiClient__ } = useApi();
    const [params] = useSearchParams();
    const ref = useRef<HTMLDivElement>(null);
    useTvGridFocus(ref);
    const sections = getSections();
    const results = useQueries({ queries: sections.map(section => ({
        queryKey: ['User', user?.Id, 'Items', 'Favorites', section.types, params.get('topParentId')],
        queryFn: () => getFetchDataFn(section).call({ apiClient: __legacyApiClient__ }) as Promise<{ Items: ItemDto[] }>,
        enabled: !!api && !!user?.Id,
        placeholderData: (previous: { Items: ItemDto[] } | undefined) => previous
    })) });
    const pending = results.some(result => result.isPending);
    const hasItems = results.some(result => result.data?.Items?.length);
    let body;
    if (pending && !hasItems) {
        body = <div className='sect' aria-busy='true'><div className='rowx'>{Array.from({ length: 6 }, (_, index) => <CellSkeleton key={index} />)}</div></div>;
    } else if (!hasItems) {
        body = <div className='empty'><h3>{results.some(result => result.isError) ? 'Unable to load favorites' : 'No favorites yet'}</h3>
            <p>Tap the heart on a movie, a show, an episode or a person and it appears here.</p>
            {results.some(result => result.isError) && <button className='btn' onClick={() => {
                results.forEach(result => {
                    void result.refetch();
                });
            }}>Retry</button>}</div>;
    } else {
        body = sections.map((section, index) => {
            const items = results[index].data?.Items ?? [];
            if (!items.length) return null;
            const options: CardOptions = { ...section, action: section.action as ItemAction | undefined, shape: section.types === 'Episode' ? CardShape.Backdrop : section.shape,
                serverId: __legacyApiClient__?.serverId(), queryKey: ['User', user?.Id, 'Items'] };
            setCardData(items, options);
            return <div className='sect plain' key={section.types}><h2 className='rowt'>
                <a href={getRouteUrl(section, __legacyApiClient__?.serverId())}>{globalize.translate(section.name)}</a></h2>
            <Scroller className='ds-rowframe' isCenterFocusEnabled isAllowNativeSmoothScrollEnabled>
                <ItemsContainer isPlain className='rowx scrollSlider focuscontainer-x' queryKey={options.queryKey} reloadItems={results[index].refetch}>
                    {items.map(item => <Cell key={item.Id} row={{ kind: 'native', nativeItem: item }} options={options} />)}
                    <LibraryCast items={items} />
                </ItemsContainer>
            </Scroller></div>;
        });
    }
    return <Page id='favoritesPage' title='Favorites' className='mainAnimatedPage libraryPage jfmod-libraryGridPage'>
        <Root><div ref={ref} className='plain' style={{ paddingBottom: '2.618em' }}>
            {body}
        </div></Root>
    </Page>;
};
