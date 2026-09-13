import React, { type FC } from 'react';

import Card from 'components/cardbuilder/Card/Card';
import { setCardData } from 'components/cardbuilder/cardBuilder';
import type { CardOptions } from 'types/cardOptions';

import type { BrowseRow } from '../types/browse';
import EntryCard from './EntryCard';

const EntryCards: FC<{ rows: BrowseRow[]; cardOptions: CardOptions }> = ({ rows, cardOptions }) => {
    setCardData(rows.flatMap(row => row.kind === 'native' ? [row.nativeItem] : []), cardOptions);
    return <>{rows.map(row => row.kind === 'native' && !row.entry ? (
        <Card key={'native:' + row.nativeItem.Id} item={row.nativeItem} cardOptions={cardOptions} />
    ) : (
        <EntryCard key={'entry:' + row.entry!.id} entry={row.entry!}
            nativeItem={row.kind === 'native' ? row.nativeItem : undefined} cardOptions={cardOptions} />
    ))}</>;
};

export default EntryCards;
