import React, { type FC } from 'react';
import { useGetQueryFilters } from 'apps/modern/features/libraries/hooks/api/useQueryFilters';
import { useGetQueryFiltersLegacy } from 'apps/modern/features/libraries/hooks/api/useQueryFiltersLegacy';
import { useGetStudios } from 'apps/modern/features/libraries/hooks/api/useStudios';
import type { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind';
import type { LibraryViewSettings, ParentId } from 'types/library';
import { LibraryTab } from 'types/libraryTab';
import FiltersStatus from 'apps/modern/features/libraries/components/filter/FiltersStatus';
import FiltersFeatures from 'apps/modern/features/libraries/components/filter/FiltersFeatures';
import FiltersGenres from 'apps/modern/features/libraries/components/filter/FiltersGenres';
import FiltersOfficialRatings from 'apps/modern/features/libraries/components/filter/FiltersOfficialRatings';
import FiltersSeriesStatus from 'apps/modern/features/libraries/components/filter/FiltersSeriesStatus';
import FiltersEpisodesStatus from 'apps/modern/features/libraries/components/filter/FiltersEpisodesStatus';
import FiltersVideoTypes from 'apps/modern/features/libraries/components/filter/FiltersVideoTypes';
import FiltersStudios from 'apps/modern/features/libraries/components/filter/FiltersStudios';
import FiltersTags from 'apps/modern/features/libraries/components/filter/FiltersTags';
import FiltersYears from 'apps/modern/features/libraries/components/filter/FiltersYears';
import FiltersAudioLanguages from 'apps/modern/features/libraries/components/filter/FiltersAudioLanguages';
import FiltersSubtitleLanguages from 'apps/modern/features/libraries/components/filter/FiltersSubtitleLanguages';
import FileFilterGroup from '../components/FileFilterGroup';
import { NativeFields } from './FilterFields';
import { Menu } from './Menu';

export const FilterMenu: FC<{ close: () => void; parentId: ParentId; itemType: BaseItemKind[]; viewType: LibraryTab;
    fileFiltersAvailable: boolean; libraryViewSettings: LibraryViewSettings;
    setLibraryViewSettings: React.Dispatch<React.SetStateAction<LibraryViewSettings>> }> = props => {
    const { data: legacy } = useGetQueryFiltersLegacy(props.parentId, props.itemType);
    const { data: filters } = useGetQueryFilters(props.parentId, props.itemType);
    const { data: studios } = useGetStudios(props.parentId, props.itemType);
    const fields = { libraryViewSettings: props.libraryViewSettings, setLibraryViewSettings: props.setLibraryViewSettings };
    return <Menu id='filter-popover' label='Filter' close={props.close}><NativeFields.Provider value>
        <span id='filtersStatus-header' className='cap0'>Status</span><FiltersStatus {...fields} viewType={props.viewType} />
        {props.fileFiltersAvailable && <details id='jfmodFileFilters-content'><summary id='jfmodFileFilters-header' tabIndex={0} className='mi focusable'>File</summary><FileFilterGroup {...fields} /></details>}
        {props.viewType === LibraryTab.Series && <details id='filtersSeriesStatus-content'><summary id='filtersSeriesStatus-header' tabIndex={0} className='mi focusable'>Series Status</summary><FiltersSeriesStatus {...fields} /></details>}
        {props.viewType === LibraryTab.Episodes && <details id='filtersEpisodesStatus-content'><summary id='filtersEpisodesStatus-header' tabIndex={0} className='mi focusable'>Episode Status</summary><FiltersEpisodesStatus {...fields} /></details>}
        <div className='mhr' /><span id='filtersFeatures-header' className='cap0'>Features</span><FiltersFeatures {...fields} />
        <details id='filtersVideoTypes-content'><summary id='filtersVideoTypes-header' tabIndex={0} className='mi focusable'>Video Type</summary><FiltersVideoTypes {...fields} /></details>
        {!!legacy?.Genres?.length && <details id='filtersGenres-content'><summary id='filtersGenres-header' tabIndex={0} className='mi focusable'>Genres</summary><FiltersGenres {...fields} genresOptions={legacy.Genres} /></details>}
        {!!legacy?.OfficialRatings?.length && <details id='filtersOfficialRatings-content'><summary id='filtersOfficialRatings-header' tabIndex={0} className='mi focusable'>Official Ratings</summary><FiltersOfficialRatings {...fields} OfficialRatingsOptions={legacy.OfficialRatings} /></details>}
        {!!legacy?.Years?.length && <details id='filtersYears-content'><summary id='filtersYears-header' tabIndex={0} className='mi focusable'>Years</summary><FiltersYears {...fields} yearsOptions={legacy.Years} /></details>}
        {!!studios?.length && <details id='filtersStudios-content'><summary id='filtersStudios-header' tabIndex={0} className='mi focusable'>Studios</summary><FiltersStudios {...fields} studiosOptions={studios} /></details>}
        {!!legacy?.Tags?.length && <details id='filtersTags-content'><summary id='filtersTags-header' tabIndex={0} className='mi focusable'>Tags</summary><FiltersTags {...fields} tagsOptions={legacy.Tags} /></details>}
        {!!filters?.AudioLanguages?.length && <details id='filtersAudioLanguages-content'><summary id='filtersAudioLanguages-header' tabIndex={0} className='mi focusable'>Audio Languages</summary><FiltersAudioLanguages {...fields} options={filters.AudioLanguages} /></details>}
        {!!filters?.SubtitleLanguages?.length && <details id='filtersSubtitleLanguages-content'><summary id='filtersSubtitleLanguages-header' tabIndex={0} className='mi focusable'>Subtitle Languages</summary><FiltersSubtitleLanguages {...fields} options={filters.SubtitleLanguages} /></details>}
        <button className='mi' onClick={() => props.setLibraryViewSettings(previous => ({ ...previous, StartIndex: 0, Alphabet: undefined, Filters: undefined }))}>Clear Filter</button>
    </NativeFields.Provider></Menu>;
};
