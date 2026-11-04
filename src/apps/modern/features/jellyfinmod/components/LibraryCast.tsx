import type { Api } from '@jellyfin/sdk/lib/api';
import { ItemFields } from '@jellyfin/sdk/lib/generated-client/models/item-fields';
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api';
import { useQuery } from '@tanstack/react-query';
import React, { type FC, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useApi } from 'hooks/useApi';
import { useUserSettings } from 'hooks/useUserSettings';
import type { ItemDto } from 'types/base/models/item-dto';

import type { BrowseRow } from '../types/browse';

/** Ids in one request: 100 keep the query string well under the server's 8 KB request line. */
const CHUNK = 100;

const leads = (people: ItemDto['People']) => (people ?? []).filter(person => person.Type === 'Actor').slice(0, 2)
    .map(person => person.Name).join(', ');

/** One request per page of the grid, never per title; a page bigger than a chunk takes a request per chunk. */
const fetchCast = async (api: Api, userId: string, ids: string[], signal: AbortSignal) => {
    const chunks: string[][] = [];
    for (let start = 0; start < ids.length; start += CHUNK) chunks.push(ids.slice(start, start + CHUNK));
    const answers = await Promise.all(chunks.map(chunk => getLibraryApi(api).getItems({
        userId, ids: chunk, fields: [ItemFields.People], enableImages: false, enableUserData: false
    }, { signal })));
    const cast: Record<string, string> = {};
    for (const { data } of answers) for (const item of data.Items ?? []) if (item.Id) cast[item.Id] = leads(item.People);
    return cast;
};

interface LibraryCastProps {
    /** The grid's plain rows, or the catalog's combined rows. */
    items?: ItemDto[];
    rows?: BrowseRow[];
}

/**
 * The third caption line of the Movies and Shows grids (D260): the two lead actors under each poster, blank until known and blank
 * when there is no cast, so every card holds the same height. A portal into each card's text, so upstream's card is unchanged.
 *
 * The plugin's combined browse answers with fixed fields and no People, so the page's cast is asked for in one read of its ids,
 * for the plain grid too. A page size of 0 means no paging: a 5000-title library would add about 20 MB, so no cast is asked for
 * and the line stays blank. A title with no cast of its own, or no native item, shows the cast the plugin's entry carries, a series' regulars.
 */
const LibraryCast: FC<LibraryCastProps> = ({ items, rows }) => {
    const { api, user } = useApi();
    const { libraryPageSize } = useUserSettings();
    const anchor = useRef<HTMLSpanElement>(null);
    const [targets, setTargets] = useState<{ key: string; node: Element }[]>([]);

    const nativeIds = (rows ? rows.flatMap(row => row.kind === 'native' ? [row.nativeItem.Id] : []) : items?.map(item => item.Id) ?? [])
        .filter((id): id is string => !!id);
    const idsKey = nativeIds.join();
    const { data: cast } = useQuery({
        queryKey: ['JellyfinMod', api?.basePath, user?.Id, 'LibraryCast', idsKey],
        queryFn: ({ signal }) => fetchCast(api!, user!.Id!, nativeIds, signal),
        enabled: !!api && !!user?.Id && !!libraryPageSize && nativeIds.length > 0,
        staleTime: 5 * 60 * 1000
    });

    const entryCast: Record<string, string> = {};
    for (const row of rows ?? []) {
        const key = row.kind === 'native' ? row.nativeItem.Id : row.entry.id;
        const credits = row.entry?.metadata?.cast;
        if (key && credits?.length) entryCast[key] = credits.slice(0, 2).map(person => person.name).join(', ');
    }

    const rowsKey = idsKey + '|' + (rows ?? []).map(row => row.entry?.id ?? '').join();
    useLayoutEffect(() => {
        const cards = anchor.current?.parentElement?.querySelectorAll('.card, .cell') ?? [];
        setTargets(Array.from(cards).flatMap((card, index) => {
            const node = card.querySelector('[data-jfmod-cast]') ?? card.querySelector('.cardText')?.parentElement;
            const key = card.getAttribute('data-id') ?? card.getAttribute('data-jfmod-entry-id') ?? 'card' + index;
            return node ? [{ key, node }] : [];
        }));
    }, [rowsKey]);

    return <>
        <span ref={anchor} hidden />
        {targets.map(({ key, node }) => {
            const names = libraryPageSize ? cast?.[key] || entryCast[key] || '' : '';
            const content = node.hasAttribute('data-jfmod-cast') ? names : <div className='cardText jfmod-cardCast'>{names}</div>;
            return createPortal(content, node, key);
        })}
    </>;
};

export default LibraryCast;
