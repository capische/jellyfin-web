import React, { type FC, useContext, useRef } from 'react';
import { appRouter } from 'components/router/appRouter';
import browser from 'scripts/browser';
import globalize from 'lib/globalize';
import { useSearchSuggestions } from 'apps/legacy/features/search/api/useSearchSuggestions';
import type { Section as SearchSection } from 'apps/legacy/features/search/types';
import { setCardData } from 'components/cardbuilder/cardBuilder';
import { CardShape } from 'components/cardbuilder/utils/shape';
import { useApi } from 'hooks/useApi';
import type { ItemDto } from 'types/base/models/item-dto';
import { Cell, CellSkeleton } from './Cell';
import { Section } from './Section';
import { DesignContext } from './Root';
import { Icon } from './Icon';
import { useTvGridFocus } from '../hooks/useTvGridFocus';

/** The mockup has movie/show results; other enabled search kinds keep their existing queries and routes. */
export const SearchRows: FC<{ sections: SearchSection[]; loading?: boolean; empty?: boolean; query: string }> = ({ sections, loading, empty, query }) => {
    const { serverId } = useApi();
    if (loading && !sections.length) {
        return <div className='libgrid' style={{ paddingRight: '3.3%' }}><div className='grid searchgrid' aria-busy='true'>
            {Array.from({ length: 10 }, (_, index) => <CellSkeleton key={index} library />)}
        </div></div>;
    }
    return <>{sections.map(section => {
        const options = { shape: CardShape.Portrait, ...section.cardOptions, serverId };
        setCardData(section.items, options);
        return <Section key={section.title} title={globalize.translate(section.title)}>
            {section.items.map(item => <Cell key={item.Id} row={{ kind: 'native', nativeItem: item as ItemDto }} options={options} />)}
        </Section>;
    })}{empty && !loading && !sections.length && <div className='empty'><h3>No results for “{query}”</h3><p>Check the spelling, or try fewer words.</p></div>}</>;
};

export const Suggestions: FC<{ parentId?: string }> = ({ parentId }) => {
    const { data, isPending } = useSearchSuggestions(parentId);
    return <div className='sugg' aria-busy={isPending}><span className='capt0'>{globalize.translate('Suggestions')}</span>
        {data?.map(item => <a key={item.Id} className='focusable' tabIndex={0} href={appRouter.getRouteUrl(item)}>{item.Name}</a>)}
    </div>;
};

/** ds.js P.search: page field on the phone, alphabet on an emulated TV, results below. */
export const SearchBody: FC<React.PropsWithChildren<{ query: string; onSearch: (value: string) => void }>> = ({ query, onSearch, children }) => {
    const device = useContext(DesignContext);
    const label = (letter: string) => {
        if (letter === '⌫') return 'Backspace';
        if (letter === '⎵') return 'Space';
        return letter;
    };
    const pick = (letter: string) => {
        if (letter === '⌫') onSearch(query.slice(0, -1));
        else onSearch(query + (letter === '⎵' ? ' ' : letter));
    };
    const ref = useRef<HTMLDivElement>(null);
    useTvGridFocus(ref);
    return <div ref={ref} className='plain'>
        {device === 'phone' && <div className='sfield plain'><label className='in glassy'>
            <Icon name='search' /><input id='searchTextInput' type='search' autoComplete='off' aria-label='Search movies and shows'
                placeholder='Search movies and shows' value={query} onChange={event => onSearch(event.target.value)}
                onFocus={event => event.currentTarget.parentElement?.classList.add('on')}
                onBlur={event => event.currentTarget.parentElement?.classList.remove('on')} />
        </label></div>}
        {device === 'tv' && !browser.tv && <div className='alpha focuscontainer-x'>{['⎵ABCDEFGHIJKLMNOPQRSTUVWXYZ⌫', '0123456789'].map(line => <div key={line}>
            {Array.from(line).map(letter => <button key={letter} type='button' className='focusable' aria-label={label(letter)}
                onClick={() => pick(letter)}>{letter}</button>)}
        </div>)}</div>}
        {children}
    </div>;
};
