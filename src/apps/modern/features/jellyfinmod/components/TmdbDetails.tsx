import type { Api } from '@jellyfin/sdk/lib/api';
import { CollectionType } from '@jellyfin/sdk/lib/generated-client/models/collection-type';
import React, { type FC, type MouseEvent, type ReactNode, useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import actionsheet from 'components/actionSheet/actionSheet';
import focusManager from 'components/focusManager';
import layoutManager from 'components/layoutManager';
import toast from 'components/toast/toast';
import { getDefaultBackgroundClass } from 'components/cardbuilder/utils/builder';
import { useUserViews } from 'hooks/api/useUserViews';
import globalize from 'lib/globalize';
import datetime from 'scripts/datetime';

import { createEntry, type DiscoverTitle } from '../api/modApi';
import { invalidateCatalog } from '../integration/invalidateCatalog';
import type { EntryEpisode, TmdbMetadata } from '../types/entry';
import { getEntryPath, getTmdbImage, getTmdbPath } from '../utils/entryLinks';
import { raisedButtonClass } from '../utils/flatButton';
import type { FocusOwnership } from '../utils/focusOwnership';
import { crewCards, DetailsLine, type Person, roleLabel } from './EntryEpisodeDetails';
import { episodeMetaItems, episodesWord } from './MissingChildren';

import './entryDetails.scss';
import './missingChildren.scss';
import './tmdbDetails.scss';

interface TmdbDetailsProps {
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

/**
 * One cell of a card row on these pages (D203): the search card's lit cell, padded 1em, with a left-aligned two-line caption
 * (line 1 700 at full ink, line 2 at 85.4 %). A portrait image, or a 16:9 still for an episode; the kind's icon on the default
 * background without one. A link where it opens a page; a focus stop on the TV either way, as upstream's cards are.
 */
const BrowseCell: FC<{ image?: string; wide?: boolean; icon: 'person' | 'tv'; line1: string; line2?: string; href?: string;
    label?: string }> = ({ image, wide, icon, line1, line2, href, label }) => {
    const [failed, setFailed] = useState<string>();
    const onError = useCallback(() => setFailed(image), [image]);
    const shown = image && failed !== image ? image : undefined;
    const body = <>
        <div className={'jfmod-browseImage' + (wide ? ' jfmod-browseImage-wide' : '') + (shown ? '' : ' ' + getDefaultBackgroundClass(line1))}>
            {shown ? <img src={shown} alt='' loading='lazy' decoding='async' onError={onError} /> :
                <span className={'material-icons jfmod-browseIcon ' + icon} aria-hidden='true' />}
        </div>
        <div className='jfmod-browseLine jfmod-browseLine1'><bdi>{line1}</bdi></div>
        {line2 && <div className='jfmod-browseLine jfmod-browseLine2'><bdi>{line2}</bdi></div>}
    </>;
    const className = 'jfmod-browseCell' + (wide ? ' jfmod-browseCell-wide' : '');
    if (href) return <a className={className} href={href} aria-label={label ?? line1}>{body}</a>;
    return layoutManager.tv ? <button type='button' className={className} aria-label={label ?? line1}>{body}</button> :
        <div className={className}>{body}</div>;
};

/** A section of upstream's template, shown while it has content, with its row of cells and, when given, its title. */
const TemplateSection: FC<{ view: HTMLElement; section: string; content: string; title?: ReactNode; children: ReactNode;
    shown: boolean }> = ({ view, section, content, title, children, shown }) => {
    const [node, setNode] = useState<Element | null>(null);
    const [heading, setHeading] = useState<Element | null>(null);
    useLayoutEffect(() => {
        const element = view.querySelector(section);
        if (!element || !shown) return;
        element.classList.remove('hide');
        const h2 = element.querySelector('.sectionTitle');
        if (title !== undefined && h2) {
            h2.classList.remove('hide');
            setHeading(h2);
        }
        setNode(element.querySelector(content));
        return () => {
            element.classList.add('hide');
            setNode(null);
            setHeading(null);
        };
    // The title's text changes only with the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [content, section, shown, view]);
    return <>
        {heading && createPortal(<span className='jfmod-browseHeading'>{title}</span>, heading)}
        {node && createPortal(<div className='jfmod-browseRow'>{children}</div>, node)}
    </>;
};

/** The line that says a season or an episode is not in the library: first in the overview's column, above the overview. */
const NoteSlot: FC<{ view: HTMLElement; children: ReactNode }> = ({ view, children }) => {
    const [node, setNode] = useState<HTMLElement | null>(null);
    useLayoutEffect(() => {
        const column = view.querySelector('.detailSectionContent');
        if (!column) return;
        const element = document.createElement('p');
        element.className = 'jfmod-browseNote';
        column.insertBefore(element, column.firstChild);
        setNode(element);
        return () => {
            element.remove();
            setNode(null);
        };
    }, [view]);
    return node && createPortal(children, node);
};

/** Upstream draws its header links in the text's colour inline (renderName). */
const INHERIT = { color: 'inherit', textDecoration: 'none' };

const yearOf = (date?: string | null) => (date && /^\d{4}/.test(date) ? date.slice(0, 4) : undefined);

/** The certification as upstream's misc line shows an official rating: the US one, else the first TMDB lists. */
const certificationOf = (metadata: TmdbMetadata) => (metadata.certifications.find(item => item.country === 'US') ?? metadata.certifications[0])?.rating;

/** Upstream's episode date: the date alone, in the locale's short form. */
const shortDate = (date: string) => datetime.toLocaleDateString(datetime.parseISO8601Date(date, false));

interface HeaderProps {
    metadata: TmdbMetadata;
    season?: number;
    episode?: EntryEpisode;
    episodeNumber?: number;
    serverId?: string;
    episodeCount?: number;
}

/** Upstream's name block (renderName): a title; a season's or an episode's series link above its own name. */
const HeaderName: FC<HeaderProps> = ({ metadata, season, episode, episodeNumber, serverId }) => {
    if (season === undefined) return <h1 className='itemName infoText parentNameLast'><bdi>{metadata.title}</bdi></h1>;
    const seasonName = metadata.seasons.find(candidate => candidate.number === season)?.name || 'Season ' + season;
    const seasonLink = <a className='button-link jfmod-browseParent' style={INHERIT} href={'#' + getTmdbPath('series', metadata.tmdbId, serverId, season)}>{seasonName}</a>;
    return <>
        <h1 className='parentName focuscontainer-x'><bdi>
            <a className='button-link jfmod-browseParent' style={INHERIT} href={'#' + getTmdbPath('series', metadata.tmdbId, serverId)}>{metadata.title}</a>
        </bdi></h1>
        <h3 className='itemName infoText subtitle focuscontainer-x'><bdi>
            {episodeNumber === undefined ? seasonName : <>{seasonLink}{' - '}{episodeNumber}. {episode?.title ?? ''}</>}
        </bdi></h3>
    </>;
};

/** Upstream's first meta line: year, runtime, certification and TMDB's star; a season's year and episode count. */
const HeaderMeta: FC<HeaderProps> = ({ metadata, season, episode, episodeNumber, episodeCount }) => {
    const certification = certificationOf(metadata);
    const certificationItem = certification ? <div className='mediaInfoItem mediaInfoText mediaInfoOfficialRating'>{certification}</div> : null;
    if (episodeNumber !== undefined) {
        return episode ? <>{episodeMetaItems(episode, metadata.episodeRatings?.[episode.tmdbId], shortDate)}{certificationItem}</> : null;
    }
    if (season !== undefined) {
        const tmdbSeason = metadata.seasons.find(candidate => candidate.number === season);
        const year = yearOf(tmdbSeason?.airDate);
        return <>{year && <div className='mediaInfoItem'>{year}</div>}
            <div className='mediaInfoItem'>{episodesWord(episodeCount || tmdbSeason?.episodeCount || 0)}</div></>;
    }
    const year = yearOf(metadata.premiereDate);
    return <>
        {year && <div className='mediaInfoItem'>{year}</div>}
        {metadata.mediaType === 'movie' && !!metadata.runtimeMinutes
            && <div className='mediaInfoItem'>{datetime.getDisplayDuration(metadata.runtimeMinutes * 600000000)}</div>}
        {certificationItem}
        {!!metadata.communityRating && <div className='starRatingContainer mediaInfoItem'>
            <span className='material-icons starIcon star' aria-hidden='true' />{metadata.communityRating.toFixed(1)}
        </div>}
    </>;
};

const castPeople = (metadata: TmdbMetadata): Person[] => (metadata.cast ?? []).map(person => ({ key: 'cast:' + person.id + ':' + person.order,
    name: person.name, role: roleLabel('Actor', person.character), profilePath: person.profilePath }));

/** Add to Library: the whole movie or show (D196), into its only library of that kind, else the one chosen in a sheet. */
const AddToLibraryButton: FC<{ api: Api; metadata: TmdbMetadata; serverId: string; userId: string }> = ({ api, metadata, serverId, userId }) => {
    const views = useUserViews({ userId });
    const [adding, setAdding] = useState(false);
    const mediaType = metadata.mediaType;
    const addToLibrary = useCallback(async (event: MouseEvent<HTMLButtonElement>) => {
        if (adding) return;
        const button = event.currentTarget;
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
            invalidateCatalog(api);
            // The title's own library page from here on; Back returns to where the browse page was opened from.
            window.location.replace('#' + getEntryPath(result.entry.id, serverId));
        } catch (error) {
            console.error('[JellyfinMod] add from the browse page failed', error);
            toast('Could not add this title');
            setAdding(false);
        }
    }, [adding, api, mediaType, metadata.tmdbId, serverId, views.data?.Items]);

    const onClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
        addToLibrary(event).catch(console.error);
    }, [addToLibrary]);
    return <button type='button' className={raisedButtonClass('jfmod-browseAdd', 'button-submit')} aria-busy={adding || undefined}
        aria-disabled={adding || undefined} onClick={onClick}>
        <span className='material-icons add' aria-hidden='true' />
        <span>Add to Library</span>
    </button>;
};

/** TMDB's page of the title, season or episode, and IMDb's of a movie or series. */
const externalLinks = (metadata: TmdbMetadata, season?: number, episodeNumber?: number) => {
    let path = (metadata.mediaType === 'movie' ? 'movie/' : 'tv/') + metadata.tmdbId;
    if (season !== undefined) path += '/season/' + season;
    if (episodeNumber !== undefined) path += '/episode/' + episodeNumber;
    const imdb = season === undefined && metadata.imdbId && /^tt\d+$/.test(metadata.imdbId) ? 'https://www.imdb.com/title/' + metadata.imdbId : undefined;
    return { tmdb: 'https://www.themoviedb.org/' + path, imdb };
};

/**
 * The page of a TMDB title that is not in the library (TM2; D196, D203), drawn into upstream's detail template as the
 * file-less entry pages are: a movie's or a series' page with its one action, **Add to Library**, and a season's or an
 * episode's page that says the title is not in the library and links to the series. Seasons, episodes, Cast & Crew, Guest Stars
 * and More from the season are rows of the search card's lit cell.
 */
const TmdbDetails: FC<TmdbDetailsProps> = ({ api, data, view, serverId, userId, season, episode: episodeNumber, focusOwnership }) => {
    const { metadata, crew, creators } = data;
    const mediaType = metadata.mediaType;
    const isSeason = season !== undefined && episodeNumber === undefined;
    const isEpisode = season !== undefined && episodeNumber !== undefined;
    const episodes = (data.episodes ?? []).slice().sort((a, b) => a.episodeNumber - b.episodeNumber);
    const episode = isEpisode ? episodes.find(candidate => candidate.episodeNumber === episodeNumber) : undefined;
    const tmdbSeason = season !== undefined ? metadata.seasons.find(candidate => candidate.number === season) : undefined;

    const mount = (selector: string, content: ReactNode) => {
        const node = view.querySelector(selector);
        return node ? createPortal(content, node) : null;
    };
    const seriesHref = '#' + getTmdbPath('series', metadata.tmdbId, serverId);
    const seasonHref = (number: number) => '#' + getTmdbPath('series', metadata.tmdbId, serverId, number);
    const episodeHref = (number: number) => '#' + getTmdbPath('series', metadata.tmdbId, serverId, season, number);

    // On the TV the page places focus on its first action while it owns focus, as the file-less pages do.
    useEffect(() => {
        if (!layoutManager.tv || !focusOwnership) return;
        const first = view.querySelector<HTMLElement>('.jfmod-browseAdd') ?? view.querySelector<HTMLElement>('.nameContainer a')
            ?? view.querySelector<HTMLElement>('.jfmod-browseCell');
        if (first && focusOwnership.mayFocus(first)) {
            focusManager.focus(first);
            focusOwnership.placed(first);
        }
    });

    // External links, as upstream's line under the overview: IMDb, then TMDB.
    useLayoutEffect(() => {
        const links = view.querySelector('.itemExternalLinks');
        if (!links || layoutManager.tv) return;
        links.classList.remove('hide');
        return () => links.classList.add('hide');
    }, [view]);
    const links = externalLinks(metadata, season, episodeNumber);

    const namesOf = (people: typeof crew, type: string) => Array.from(new Set(people.filter(person => person.type === type).map(person => person.name)));
    const episodeCrew = episode?.credits?.crew ?? [];
    const detailCrew = isEpisode ? episodeCrew : crew;
    const directors = namesOf(detailCrew, 'Director');
    const writers = namesOf(detailCrew, 'Writer');
    const cast: Person[] = [...castPeople(metadata), ...crewCards(detailCrew)];
    const guests: Person[] = (episode?.credits?.guestStars ?? []).map(person => ({ key: 'guest:' + person.id + ':' + person.order,
        name: person.name, role: roleLabel('GuestStar', person.character), profilePath: person.profilePath }));

    const posterPath = isEpisode ? undefined : (tmdbSeason?.posterPath ?? metadata.posterPath);
    const poster = getTmdbImage(posterPath, 'w500');
    const still = getTmdbImage(episode?.stillPath, 'w500');

    let overview = metadata.overview;
    if (isEpisode) overview = episode?.overview ?? null;
    else if (isSeason) overview = tmdbSeason?.overview || metadata.overview;
    const seasons = metadata.seasons.filter(candidate => candidate.number > 0);
    const moreFromSeason = isEpisode ? episodes.filter(candidate => candidate.episodeNumber !== episodeNumber) : [];
    const seasonName = tmdbSeason?.name || 'Season ' + season;

    return <>
        {mount('.nameContainer', <HeaderName metadata={metadata} season={season} episode={episode} episodeNumber={episodeNumber} serverId={serverId} />)}
        {mount('.itemMiscInfo-primary', <HeaderMeta metadata={metadata} season={season} episode={episode} episodeNumber={episodeNumber} episodeCount={episodes.length} />)}
        {Array.from(view.querySelectorAll('.detailImageContainer')).map((node, index) => createPortal(isEpisode ?
            <div className='card backdropCard jfmod-episodeStill'>
                <div className='cardBox'>
                    <div className='cardScalable'>
                        <div className='cardPadder cardPadder-backdrop' />
                        <div className={'cardImageContainer coveredImage cardContent' + (still ? '' : ' jfmod-missingPoster jfmod-missingEmpty')}>
                            {still ? <img className='jfmod-missingImage' src={still} alt='' /> :
                                <span className='jfmod-missingNumber' aria-hidden='true'>{episodeNumber}</span>}
                        </div>
                    </div>
                </div>
            </div> :
            <div className='card portraitCard jfmod-entryPoster'>{poster && <img src={poster} alt={metadata.title} />}</div>, node, String(index)))}
        {!isSeason && !isEpisode && mount('.mainDetailButtons', <AddToLibraryButton api={api} metadata={metadata} serverId={serverId} userId={userId} />)}
        {(isSeason || isEpisode) && <NoteSlot view={view}>
            Not in your library. <a className='button-link' href={seriesHref}>Add {metadata.title}</a>{' '}
            {isEpisode ? 'to download it.' : 'to download its episodes.'}
        </NoteSlot>}
        {overview && mount('.overview', overview)}
        {mount('.itemExternalLinks', <>
            {links.imdb && <><a className='button-link' href={links.imdb} target='_blank' rel='noopener noreferrer'>IMDb</a>, </>}
            <a className='button-link' href={links.tmdb} target='_blank' rel='noopener noreferrer'>TMDB</a>
        </>)}
        {mount('.itemDetailsGroup', <>
            <DetailsLine label={globalize.translate(directors.length > 1 ? 'Directors' : 'Director')} names={directors} />
            <DetailsLine label={globalize.translate(writers.length > 1 ? 'Writers' : 'Writer')} names={writers} />
            {!isEpisode && !isSeason && <DetailsLine label='Created By' names={creators} />}
            {!isSeason && <DetailsLine label={globalize.translate(metadata.genres.length > 1 ? 'Genres' : 'Genre')} names={metadata.genres} />}
        </>)}
        {mediaType === 'series' && !isSeason && !isEpisode && <TemplateSection view={view} section='#listChildrenCollapsible'
            content='.itemsContainer' title='Seasons' shown={seasons.length > 0}>
            {seasons.map(item => <BrowseCell key={item.number} image={getTmdbImage(item.posterPath, 'w342')} icon='tv'
                line1={item.name || 'Season ' + item.number}
                line2={item.episodeCount ? episodesWord(item.episodeCount) : 'Not yet aired'} href={seasonHref(item.number)} />)}
        </TemplateSection>}
        {isSeason && <EpisodeRows view={view} episodes={episodes} rating={id => metadata.episodeRatings?.[id]} href={episodeHref} />}
        {!isSeason && <TemplateSection view={view} section='#castCollapsible' content='#castContent' shown={cast.length > 0}>
            {cast.map(person => <BrowseCell key={person.key} image={getTmdbImage(person.profilePath, 'w185')} icon='person'
                line1={person.name} line2={person.role} label={person.role ? `${person.name}, ${person.role}` : person.name} />)}
        </TemplateSection>}
        {isEpisode && <TemplateSection view={view} section='#guestCastCollapsible' content='#guestCastContent' shown={guests.length > 0}>
            {guests.map(person => <BrowseCell key={person.key} image={getTmdbImage(person.profilePath, 'w185')} icon='person'
                line1={person.name} line2={person.role} label={person.role ? `${person.name}, ${person.role}` : person.name} />)}
        </TemplateSection>}
        {isEpisode && <TemplateSection view={view} section='.moreFromSeasonSection' content='.itemsContainer'
            title={<>More from <a className='button-link jfmod-browseParent' style={INHERIT} href={seasonHref(season)}>{seasonName}</a></>}
            shown={moreFromSeason.length > 0}>
            {moreFromSeason.map(item => <BrowseCell key={item.episodeNumber} wide image={getTmdbImage(item.stillPath, 'w300')} icon='tv'
                line1={item.episodeNumber + '. ' + item.title} line2={item.airDate ? shortDate(item.airDate) : undefined}
                href={episodeHref(item.episodeNumber)} />)}
        </TemplateSection>}
    </>;
};

/**
 * A season's episodes as upstream draws its episode rows (the file-less season page's rows, MissingChildren): TMDB's still,
 * "N. Title", the meta line, the overview. The whole row opens the episode's page; no mark and no action, nothing is held.
 */
const EpisodeRows: FC<{ view: HTMLElement; episodes: EntryEpisode[]; rating: (id: number) => number | undefined;
    href: (number: number) => string }> = ({ view, episodes, rating, href }) => {
    const [node, setNode] = useState<Element | null>(null);
    useLayoutEffect(() => {
        const section = view.querySelector('#listChildrenCollapsible');
        const list = section?.querySelector('.itemsContainer');
        if (!section || !list) return;
        section.classList.remove('hide');
        section.querySelector('.sectionTitle')?.classList.add('hide');
        list.classList.add('vertical-list');
        setNode(list);
        return () => {
            section.classList.add('hide');
            list.classList.remove('vertical-list');
            setNode(null);
        };
    }, [view]);
    const tv = layoutManager.tv;
    return node && createPortal(<>{episodes.map(item => {
        const still = getTmdbImage(item.stillPath, tv ? 'w500' : 'w300');
        const meta = episodeMetaItems(item, rating(item.tmdbId));
        const content = <>
            <div className={'listItemImage listItemImage-large jfmod-missingStill' + (still ? '' : ' jfmod-missingEmpty')
                + (tv ? ' listItemImage-large-tv' : '')}>
                {still ? <img className='jfmod-missingImage' src={still} alt='' loading='lazy' decoding='async' /> :
                    <span className='jfmod-missingNumber' aria-hidden='true'>{item.episodeNumber}</span>}
            </div>
            <div className='listItemBody'>
                <div className='listItemBodyText'><bdi>{item.episodeNumber}. {item.title}</bdi></div>
                {meta.length > 0 && <div className='secondary listItemBodyText jfmod-missingMeta'>{meta}</div>}
                {item.overview && <div className='secondary listItem-overview listItemBodyText'><bdi>{item.overview}</bdi></div>}
            </div>
        </>;
        return <a key={item.episodeNumber} className={'listItem listItem-largeImage jfmod-browseEpisode' + (tv ? ' listItem-button listItem-focusscale' : '')}
            href={href(item.episodeNumber)} aria-label={`${item.episodeNumber}. ${item.title}`}>{content}</a>;
    })}</>, node);
};

export default TmdbDetails;
