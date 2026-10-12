import type { Api } from '@jellyfin/sdk/lib/api';
import React, { type FC, useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import focusManager from 'components/focusManager';
import layoutManager from 'components/layoutManager';

import { type EntryDetail, getEntry } from '../api/modApi';
import { PACKS_CAPABILITY, RELEASES_CAPABILITY, usePluginCapabilities } from '../hooks/useAcquisition';
import { openReleasePicker, useEpisodeListLoad } from '../integration/releasePicker';
import { restoreFocusTo, useStockHeaderButton } from '../integration/stockHeaderButton';
import { getTmdbImage } from '../utils/entryLinks';
import type { FocusOwnership } from '../utils/focusOwnership';
import { episodesWord, MissingEpisodeRows } from './MissingChildren';

import './entryDetails.scss';

interface EntrySeasonDetailsProps {
    api: Api;
    userId: string;
    detail: EntryDetail;
    season: number;
    view: HTMLElement;
    isAdmin: boolean;
    signal: AbortSignal;
    focusOwnership?: FocusOwnership;
}

/**
 * The mod's page for a season Jellyfin has no item for (`#/details?entryId=…&season=N`, P1.FU11): the series' name and the
 * season in upstream's header, and the season's episodes as the same mod rows the native season page shows, in upstream's
 * own episode list. Administrators also get Get a Release for the season in the header, as on a native season page.
 */
const EntrySeasonDetails: FC<EntrySeasonDetailsProps> = ({ api, userId, detail: initial, season, view, isAdmin, signal, focusOwnership }) => {
    const [detail, setDetail] = useState(initial);
    const capabilities = usePluginCapabilities(api, isAdmin);
    const canAcquire = isAdmin && capabilities.includes(RELEASES_CAPABILITY);
    const reload = useCallback(() => {
        getEntry(api, detail.entry.id, { signal }).then(updated => {
            if (!signal.aborted) setDetail(updated);
        }, () => undefined);
    }, [api, detail.entry.id, signal]);
    // A series whose TMDB list was never loaded loads it on opening, as its native pages do (P1.FU9).
    useEpisodeListLoad(api, detail, reload);
    const openPicker = useCallback((opener: HTMLElement) => {
        openReleasePicker({
            api, entryId: detail.entry.id, title: detail.entry.title, mediaType: detail.entry.mediaType, episodes: detail.episodes,
            seasonNumber: season, episodeListLoaded: detail.episodeListLoaded, onChanged: reload
        }).then(() => restoreFocusTo(opener), () => restoreFocusTo(opener));
    }, [api, detail, reload, season]);
    useStockHeaderButton(view, { enabled: canAcquire && capabilities.includes(PACKS_CAPABILITY), icon: 'cloud_download',
        title: 'Get a Release', className: 'jfmod-getRelease', onClick: openPicker });
    // Upstream's episode list is hidden until a page fills it; this page fills it with its own rows.
    useLayoutEffect(() => {
        const section = view.querySelector('#listChildrenCollapsible');
        const list = section?.querySelector('.itemsContainer');
        if (!section || !list) return;
        section.classList.remove('hide');
        section.querySelector('.sectionTitle')?.classList.add('hide');
        list.classList.add('vertical-list');
        return () => {
            section.classList.add('hide');
            list.classList.remove('vertical-list');
        };
    }, [view]);
    // On the TV the page places focus on its first action while it owns focus, as the file-less page does.
    useEffect(() => {
        if (!layoutManager.tv || !focusOwnership) return;
        const first = view.querySelector<HTMLElement>('.mainDetailButtons .jfmod-getRelease, .jfmod-missingRow .jfmod-markButton');
        if (first && focusOwnership.mayFocus(first)) {
            focusManager.focus(first);
            focusOwnership.placed(first);
        }
    });
    const mount = (selector: string, content: React.ReactNode) => {
        const node = view.querySelector(selector);
        return node ? createPortal(content, node) : null;
    };
    const tmdbSeason = detail.entry.metadata?.seasons.find(candidate => candidate.number === season);
    const poster = getTmdbImage(tmdbSeason?.posterPath ?? detail.entry.posterPath);
    const count = detail.episodes.filter(episode => episode.seasonNumber === season).length;
    return <>
        {mount('.nameContainer', <h1>{detail.entry.title}</h1>)}
        {mount('.itemMiscInfo-primary', 'Season ' + season + (count ? ' · ' + episodesWord(count) : ''))}
        {Array.from(view.querySelectorAll('.detailImageContainer')).map((node, index) => createPortal(
            <div className='jfmod-entryPoster'>{poster && <img src={poster} alt={detail.entry.title + ', Season ' + season} />}</div>,
            node, String(index)))}
        <MissingEpisodeRows api={api} userId={userId} view={view} detail={detail} season={season} canAcquire={canAcquire}
            onChanged={reload} />
    </>;
};

export default EntrySeasonDetails;
