import { DesignContext } from '../design/Root';
import { Cell } from '../design/Cell';
import React, { type FC, useContext } from 'react';

import Card from 'components/cardbuilder/Card/Card';
import { setCardData } from 'components/cardbuilder/cardBuilder';
import type { CardOptions } from 'types/cardOptions';

import type { BrowseRow } from '../types/browse';
import EntryCard from './EntryCard';

const EntryCards: FC<{ rows: BrowseRow[]; cardOptions: CardOptions; alwaysShowCountdown?: boolean }> = ({ rows, cardOptions, alwaysShowCountdown }) => {
    const design = useContext(DesignContext);
    setCardData(rows.flatMap(row => row.kind === 'native' ? [row.nativeItem] : []), cardOptions);
    if (design) return <>{rows.map(row => <Cell key={row.kind === 'native' ? row.nativeItem.Id : row.entry.id} row={row} options={cardOptions} alwaysShowCountdown={alwaysShowCountdown} />)}</>;
    return <>{rows.map(row => row.kind === 'native' && !row.entry ? (
        <Card key={'native:' + row.nativeItem.Id} item={row.nativeItem} cardOptions={cardOptions} />
    ) : (
        <EntryCard key={'entry:' + row.entry!.id} entry={row.entry!}
            nativeItem={row.kind === 'native' ? row.nativeItem : undefined} retention={row.retention}
            alwaysShowCountdown={alwaysShowCountdown} cardOptions={cardOptions} rating={row.rating} />
    ))}</>;
};

export default EntryCards;
