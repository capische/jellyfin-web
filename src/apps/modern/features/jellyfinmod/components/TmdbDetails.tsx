import type { Api } from '@jellyfin/sdk/lib/api';
import { CollectionType } from '@jellyfin/sdk/lib/generated-client/models/collection-type';
import React, { type FC, type MouseEvent, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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

/**
 * A section of upstream's template, shown while it has content, with its row of cells and, when given, its title. The cells are
 * direct children of the row's container, as upstream's cards are, because its scroll buttons walk the slider's children. Without
 * `content` the section has no scroller of its own (Seasons sits where the template has a plain list), so it gets the markup of
 * the template's other rows, and with it their arrows, their fit rule and their TV and phone behaviour (D252).
 */
const TemplateSection: FC<{ view: HTMLElement; section: string; content?: string; title?: ReactNode; children: ReactNode;
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
        if (!content) element.insertAdjacentHTML('beforeend', SCROLLER_ROW);
        const added = content ? null : element.lastElementChild;
        const row = content ? element.querySelector(content) : added?.firstElementChild ?? null;
        const frame = row?.parentElement;
        row?.classList.add('jfmod-browseRow');
        frame?.classList.add('jfmod-browseFrame');
        setNode(row);
        return () => {
            element.classList.add('hide');
            row?.classList.remove('jfmod-browseRow');
            frame?.classList.remove('jfmod-browseFrame');
            if (added?.previousElementSibling?.classList.contains('emby-scrollbuttons')) added.previousElementSibling.remove();
            added?.remove();
            setNode(null);
            setHeading(null);
        };
    // The title's text changes only with the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [content, section, shown, view]);
    return <>
        {heading && createPortal(<span className='jfmod-browseHeading'>{title}</span>, heading)}
        {node && createPortal(children, node)}
    </>;
};

/** The row of upstream's detail template (itemDetails/index.html, e.g. `#castCollapsible`), for a section the template gives none. */
const SCROLLER_ROW = '<div is="emby-scroller" class="padded-top-focusscale padded-bottom-focusscale no-padding" data-centerfocus="true">'
    + '<div is="emby-itemscontainer" class="scrollSlider focuscontainer-x itemsContainer"></div></div>';

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

/**
 * Upstream's first meta line: year, runtime, certification and TMDB's star; a season's year, episode count, certification and
 * the show's star (TMDB rates the show, not each season; user, 2026-11-01: the rating in the meta line, as on the other pages);
 * an episode's date, runtime, its own star and the certification.
 */
const HeaderMeta: FC<HeaderProps> = ({ metadata, season, episode, episodeNumber, episodeCount }) => {
    const certification = certificationOf(metadata);
    const certificationItem = certification ? <div className='mediaInfoItem mediaInfoText mediaInfoOfficialRating'>{certification}</div> : null;
    const starItem = metadata.communityRating ? <div className='starRatingContainer mediaInfoItem'>
        <span className='material-icons starIcon star' aria-hidden='true' />{metadata.communityRating.toFixed(1)}
    </div> : null;
    if (episodeNumber !== undefined) {
        return episode ? <>{episodeMetaItems(episode, metadata.episodeRatings?.[episode.tmdbId], shortDate)}{certificationItem}</> : null;
    }
    if (season !== undefined) {
        const tmdbSeason = metadata.seasons.find(candidate => candidate.number === season);
        const year = yearOf(tmdbSeason?.airDate);
        return <>{year && <div className='mediaInfoItem'>{year}</div>}
            <div className='mediaInfoItem'>{episodesWord(episodeCount || tmdbSeason?.episodeCount || 0)}</div>
            {certificationItem}
            {starItem}</>;
    }
    const year = yearOf(metadata.premiereDate);
    return <>
        {year && <div className='mediaInfoItem'>{year}</div>}
        {metadata.mediaType === 'movie' && !!metadata.runtimeMinutes
            && <div className='mediaInfoItem'>{datetime.getDisplayDuration(metadata.runtimeMinutes * 600000000)}</div>}
        {certificationItem}
        {starItem}
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
            invalidateCatalog(api);
            // The title's own library page from here on; Back returns to where the browse page was opened from. A viewer who has left
            // stays where they went, read from the address: it changes at once, and the page's unmount is deferred past its hide (tm2.r1).
            if (window.location.hash === openedAt) window.location.replace('#' + getEntryPath(result.entry.id, serverId));
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

/**
 * The page of a TMDB title that is not in the library (TM2; D196, D203), drawn into upstream's detail template as the
 * file-less entry pages are, each page with its one action, **Add to Library**, which adds the whole movie or show (a season's
 * and an episode's page too; user, 2026-11-01). The rating sits in the meta line; no external links (user, 2026-11-01). Seasons,
 * episodes, Cast & Crew, Guest Stars and More from the season are rows of the search card's lit cell.
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
        {mount('.mainDetailButtons', <AddToLibraryButton api={api} metadata={metadata} serverId={serverId} userId={userId} />)}
        {overview && mount('.overview', overview)}
        {mount('.itemDetailsGroup', <>
            <DetailsLine label={globalize.translate(directors.length > 1 ? 'Directors' : 'Director')} names={directors} />
            <DetailsLine label={globalize.translate(writers.length > 1 ? 'Writers' : 'Writer')} names={writers} />
            {!isEpisode && !isSeason && <DetailsLine label='Created By' names={creators} />}
            {!isSeason && <DetailsLine label={globalize.translate(metadata.genres.length > 1 ? 'Genres' : 'Genre')} names={metadata.genres} />}
        </>)}
        {mediaType === 'series' && !isSeason && !isEpisode && <TemplateSection view={view} section='#listChildrenCollapsible'
            title='Seasons' shown={seasons.length > 0}>
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
