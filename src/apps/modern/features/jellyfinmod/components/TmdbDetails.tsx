import type { Api } from '@jellyfin/sdk/lib/api';
import { CollectionType } from '@jellyfin/sdk/lib/generated-client/models/collection-type';
import React, { type FC, type MouseEvent, useCallback, useEffect, useRef, useState } from 'react';
import actionsheet from 'components/actionSheet/actionSheet';
import focusManager from 'components/focusManager';
import layoutManager from 'components/layoutManager';
import toast from 'components/toast/toast';
import { useUserViews } from 'hooks/api/useUserViews';
import { createEntry, type DiscoverTitle } from '../api/modApi';
import { invalidateCatalog } from '../integration/invalidateCatalog';
import type { TmdbMetadata } from '../types/entry';
import { getEntryPath } from '../utils/entryLinks';
import type { FocusOwnership } from '../utils/focusOwnership';
import { rememberLibraryAddition } from './LibraryUndo';
import { BrowsePage } from '../design/BrowsePage';
import { Icon } from '../design/Icon';

export interface TmdbDetailsProps {
    api: Api;
    data: DiscoverTitle;
    view: HTMLElement;
    serverId: string;
    userId: string;
    isAdmin: boolean;
    season?: number;
    episode?: number;
    focusOwnership?: FocusOwnership;
}

const AddToLibraryButton: FC<{ api: Api; metadata: TmdbMetadata; serverId: string; userId: string; isAdmin: boolean }> = ({ api, metadata, serverId, userId, isAdmin }) => {
    const views = useUserViews({ userId });
    const [adding, setAdding] = useState(false);
    const mediaType = metadata.mediaType;
    const addToLibrary = useCallback(async (event: MouseEvent<HTMLButtonElement>) => {
        if (adding) return;
        const button = event.currentTarget;
        const openedAt = window.location.hash;
        const kind = mediaType === 'movie' ? CollectionType.Movies : CollectionType.Tvshows;
        const libraries = (views.data?.Items ?? []).filter(item => item.CollectionType === kind && item.Id);
        let targetLibraryId = libraries.length === 1 ? libraries[0].Id ?? undefined : undefined;
        if (!targetLibraryId && libraries.length > 1) {
            try {
                targetLibraryId = await actionsheet.show({ title: mediaType === 'movie' ? 'Movie Library' : 'TV Library',
                    items: libraries.map(item => ({ id: item.Id ?? '', name: item.Name ?? '' })), positionTo: button }) as string;
            } catch {
                return;
            }
        }
        if (!targetLibraryId) {
            toast('There is no library to add this title to.');
            return;
        }
        setAdding(true);
        try {
            const result = await createEntry(api, { mediaType, tmdbId: metadata.tmdbId, targetLibraryId });
            if (isAdmin && result.created && window.location.hash === openedAt) {
                rememberLibraryAddition({ basePath: api.basePath, userId, entryId: result.entry.id, returnHash: openedAt });
            }
            invalidateCatalog(api);
            // The title's own library page from here on; Back returns to where the browse page was opened from. A viewer who has left
            // stays where they went, read from the address: it changes at once, and the page's unmount is deferred past its hide (tm2.r1).
            if (window.location.hash === openedAt) window.location.replace('#' + getEntryPath(result.entry.id, serverId));
        } catch (error) {
            console.error('[JellyfinMod] add from the browse page failed', error);
            toast('Could not add this title');
            setAdding(false);
        }
    }, [adding, api, isAdmin, mediaType, metadata.tmdbId, serverId, userId, views.data?.Items]);

    const onClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
        addToLibrary(event).catch(console.error);
    }, [addToLibrary]);
    return <button type='button' className='play mainb focusable' aria-busy={adding || undefined}
        aria-disabled={adding || undefined} onClick={onClick}
        onFocus={event => event.currentTarget.classList.add('focus')} onBlur={event => event.currentTarget.classList.remove('focus')}>
        <Icon name='plus' />Add to Library
    </button>;
};

/** The legacy view manager retains navigation/lifecycle; all visible browse HTML is mod-owned. */
const TmdbDetails: FC<TmdbDetailsProps> = props => {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!layoutManager.tv || !props.focusOwnership) return;
        const first = ref.current?.querySelector<HTMLElement>('.actbar .play');
        if (first && props.focusOwnership.mayFocus(first)) {
            focusManager.focus(first);
            props.focusOwnership.placed(first);
        }
    });
    return <div ref={ref}><BrowsePage {...props} add={<AddToLibraryButton api={props.api} metadata={props.data.metadata}
        serverId={props.serverId} userId={props.userId} isAdmin={props.isAdmin} />} /></div>;
};

export default TmdbDetails;
