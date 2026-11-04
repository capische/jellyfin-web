import React, { type FC, useCallback, useContext, useMemo, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useLibrary } from 'apps/modern/features/libraries/hooks/useLibrary';
import { LibraryRoutes } from 'apps/modern/features/libraries/constants/libraryRoutes';
import NewCollectionButton from 'apps/modern/features/libraries/components/NewCollectionButton';
import NewPlaylistButton from 'apps/modern/features/libraries/components/NewPlaylistButton';
import PlayAllButton from 'apps/modern/features/libraries/components/PlayAllButton';
import QueueButton from 'apps/modern/features/libraries/components/QueueButton';
import { useApi } from 'hooks/useApi';
import ShuffleButton from 'apps/modern/features/libraries/components/ShuffleButton';
import SortButton from 'apps/modern/features/libraries/components/SortButton';
import ViewSettingsButton from 'apps/modern/features/libraries/components/ViewSettingsButton';
import FilterButton from 'apps/modern/features/libraries/components/filter/FilterButton';
import { useItem } from 'hooks/useItem';
import { useUserSettings } from 'hooks/useUserSettings';
import useCurrentTab from 'hooks/useCurrentTab';
import globalize from 'lib/globalize';
import { LibraryTab } from 'types/libraryTab';
import { Action, type ActionProps } from './Action';
import { Icon } from './Icon';
import { Menu } from './Menu';
import { DesignContext } from './Root';

const playButton = (props: ActionProps) => <Action {...props} icon='play' label='Play All' />;
const shuffleButton = (props: ActionProps) => <Action {...props} icon='shuffle' />;
const filterButton = (props: ActionProps) => <Action {...props} icon='filter' />;
const sortButton = (props: ActionProps) => <Action {...props} icon='sort' />;
const viewButton = (props: ActionProps) => <Action {...props} icon='grid' />;
const queueButton = (props: ActionProps) => <Action {...props} icon='add' />;
const newCollectionButton = (props: ActionProps) => <Action {...props} icon='plus' label={props.title} />;
const newPlaylistButton = (props: ActionProps) => <Action {...props} icon='plus' label={props.title} />;

export const LibraryToolbar: FC = () => {
    const { pathname } = useLocation();
    const [params, setParams] = useSearchParams();
    const { activeTab } = useCurrentTab();
    const { id, content, collectionType, viewSettings, setViewSettings, itemsResult, browseResult } = useLibrary();
    const { data: item } = useItem(id || undefined);
    const { user } = useApi();
    const allItemsKey = useMemo(() => ['User', user?.Id, 'Items'], [user?.Id]);
    const { libraryPageSize } = useUserSettings();
    const [open, setOpen] = useState(false);
    const phone = useContext(DesignContext) === 'phone';
    const close = useCallback(() => setOpen(false), []);
    const route = LibraryRoutes.find(candidate => candidate.path === pathname);
    const tab = route?.views.find(view => view.index === activeTab);
    if (!viewSettings || !setViewSettings || !content) return null;
    const combined = browseResult?.data && (browseResult.data.hasCatalogEntries || viewSettings.Filters?.FileStates?.length || viewSettings.Filters?.RetentionDueWithinDays) ?
        browseResult.data : undefined;
    const total = combined?.totalRecordCount ?? itemsResult?.data?.TotalRecordCount ?? 0;
    const pending = browseResult?.isSelectingSource || (combined ? browseResult?.isPending : itemsResult?.isPending);
    const items = combined ? combined.items.flatMap(row => row.kind === 'native' ? [row.nativeItem] : []) : itemsResult?.data?.Items ?? [];
    const filters = !!viewSettings.Alphabet || Object.values(viewSettings.Filters ?? {}).some(value => !!value);
    const fields = { item, items, viewType: content.viewType, collectionType, hasFilters: filters,
        isTextVisible: true, libraryViewSettings: viewSettings,
        disabled: !!pending || !!combined && !!viewSettings.Filters?.FileStates?.length && !viewSettings.Filters.FileStates.includes('onDisk') };
    const start = viewSettings.StartIndex ?? 0;
    const next = () => setViewSettings(previous => ({ ...previous, StartIndex: start + libraryPageSize }));
    const prev = () => setViewSettings(previous => ({ ...previous, StartIndex: Math.max(0, start - libraryPageSize) }));
    const fallbackTitle = content.viewType === LibraryTab.Series ? 'Shows' : 'Movies';
    const title = tab ? globalize.translate(tab.label) : fallbackTitle;
    return <div className='libhead plain focuscontainer-x'>
        <div className='viewpicker'>
            <button className={`gpill glassy focusable${open ? ' on' : ''}`} aria-controls='library-view-menu' aria-haspopup='menu' aria-expanded={open}
                onClick={() => setOpen(value => !value)}><b>{title}</b><Icon name={open ? 'up' : 'down'} /></button>
            {open && <Menu id='library-view-menu' label='Library views' close={close}>{route?.views.map(view => <button
                className={`mi focusable${view.index === activeTab ? ' sel' : ''}`} key={view.index} role='menuitem'
                onClick={() => {
                    const nextParams = new URLSearchParams(params);
                    nextParams.set('tab', String(view.index));
                    setParams(nextParams);
                    close();
                }}>{globalize.translate(view.label)}</button>)}
            {phone && !!libraryPageSize && content.isPaginationEnabled && <><div className='mhr' />
                <button className='mi' disabled={pending || start === 0} onClick={() => {
                    prev();
                    close();
                }}>Previous Page</button>
                <button className='mi' disabled={pending || start + libraryPageSize >= total} onClick={() => {
                    next();
                    close();
                }}>Next Page</button></>}
            </Menu>}
        </div>
        <span className='count'>{pending ? '∙' : total}</span><span className='spacer' />
        <div className='acts'><div className='actbar glassy'>
            {content.isBtnPlayAllEnabled && <PlayAllButton {...fields} renderButton={playButton} />}
            {content.isBtnShuffleEnabled && <ShuffleButton {...fields} renderButton={shuffleButton} />}
            {content.isBtnQueueEnabled && <QueueButton {...fields} renderButton={queueButton} />}
            {content.isBtnNewCollectionEnabled && <NewCollectionButton isTextVisible queryKey={allItemsKey} renderButton={newCollectionButton} />}
            {content.isBtnNewPlaylistEnabled && <NewPlaylistButton isTextVisible queryKey={allItemsKey} renderButton={newPlaylistButton} />}
            {!phone && <span className='sep' />}
            {content.isBtnFilterEnabled && <FilterButton parentId={id} itemType={content.itemType ?? []} viewType={content.viewType}
                hasFilters={filters} fileFiltersAvailable={!!browseResult?.data} libraryViewSettings={viewSettings} setLibraryViewSettings={setViewSettings} renderButton={filterButton} />}
            {content.isBtnSortEnabled && <SortButton viewType={content.viewType} libraryViewSettings={viewSettings} setLibraryViewSettings={setViewSettings} renderButton={sortButton} />}
            {content.isBtnGridListEnabled && <ViewSettingsButton viewType={content.viewType} libraryViewSettings={viewSettings} setLibraryViewSettings={setViewSettings} renderButton={viewButton} />}
            {!phone && !!libraryPageSize && content.isPaginationEnabled && <><span className='sep' />
                <Action icon='prev' title='Previous' onClick={prev} disabled={pending || start === 0} />
                <Action icon='nextp' title='Next' onClick={next} disabled={pending || start + libraryPageSize >= total} /></>}
        </div></div>
    </div>;
};
