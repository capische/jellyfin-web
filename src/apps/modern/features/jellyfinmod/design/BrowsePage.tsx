import React, { type FC, type ReactNode, useContext, useState } from 'react';
import datetime from 'scripts/datetime';
import globalize from 'lib/globalize';
import type { TmdbDetailsProps } from '../components/TmdbDetails';
import { crewCards, roleLabel } from '../components/EntryEpisodeDetails';
import { getTmdbImage, getTmdbPath } from '../utils/entryLinks';
import type { EntryEpisode } from '../types/entry';
import { Root, DesignContext } from './Root';
import { Head } from './Head';
import { Icon } from './Icon';
import { Section } from './Section';
import { Poster } from './Poster';

const yearOf = (date?: string | null) => date?.slice(0, 4);
const shortDate = (date: string) => datetime.toLocaleDateString(datetime.parseISO8601Date(date, false));

const BrowseCell: FC<{ image?: string; wide?: boolean; person?: boolean; title: string; second?: string; href?: string }> = ({ image, wide, person, title, second, href }) => {
    const device = useContext(DesignContext);
    const [focused, setFocused] = useState(false);
    const shape = wide ? 'w' : 'p';
    return <a href={href} tabIndex={0} aria-label={second ? `${title}, ${second}` : title} className={'cell focusable ' + (person ? 'c' : shape) + (focused && device !== 'phone' ? ' focus' : '')}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}>
        <div className='tile'><Poster src={image} icon={person ? 'person' : 'tv'} />
            <div className='capt'><div className='ln t'>{title}</div><div className='ln d'>{second}</div><div className='ln d' /></div>
        </div>
    </a>;
};

const EpisodeRow: FC<{ episode: EntryEpisode; rating?: number; href: string }> = ({ episode, rating, href }) => {
    const phone = useContext(DesignContext) === 'phone';
    const [focused, setFocused] = useState(false);
    const still = <Poster className='still' src={getTmdbImage(episode.stillPath, 'w500')} icon='tv' />;
    const name = <><div className='nm'>{episode.episodeNumber}. {episode.title}</div><div className='ln2'>
        {episode.airDate && <span>{shortDate(episode.airDate)}</span>}
        {!!episode.runtimeMinutes && <span>{datetime.getDisplayDuration(episode.runtimeMinutes * 600000000)}</span>}
        {!!rating && <span className='star'><Icon name='star' />{rating.toFixed(1)}</span>}
    </div></>;
    const overview = episode.overview && <p className='ov'>{episode.overview}</p>;
    return <a className={'ep focusable' + (focused ? ' focus' : '')} tabIndex={0} href={href}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}>
        {phone ? <><div className='top'>{still}<div className='body'>{name}</div></div>{overview}</> :
            <>{still}<div className='body'>{name}{overview}</div></>}
    </a>;
};

/** ds2.js P.browse and ds.js season episode rows, with the existing TMDB response and Add command. */
// eslint-disable-next-line sonarjs/cognitive-complexity -- direct rendering of the source page variants.
export const BrowsePage: FC<TmdbDetailsProps & { add: ReactNode }> = ({ data, serverId, season, episode: number, add }) => {
    const { metadata, crew, creators } = data;
    const episodes = (data.episodes ?? []).slice().sort((a, b) => a.episodeNumber - b.episodeNumber);
    const episode = number === undefined ? undefined : episodes.find(item => item.episodeNumber === number);
    const tmdbSeason = metadata.seasons.find(item => item.number === season);
    const isSeason = season !== undefined && number === undefined;
    const isEpisode = number !== undefined;
    let title = metadata.title;
    if (isSeason) title = tmdbSeason?.name || `Season ${season}`;
    if (isEpisode) title = `${number}. ${episode?.title ?? ''}`;
    const seasonName = tmdbSeason?.name || `Season ${season}`;
    const episodeHref = (n: number) => '#' + getTmdbPath('series', metadata.tmdbId, serverId, season, n);
    const seriesHref = '#' + getTmdbPath('series', metadata.tmdbId, serverId);
    const seasonHref = (n: number) => '#' + getTmdbPath('series', metadata.tmdbId, serverId, n);
    const detailCrew = isEpisode ? episode?.credits?.crew ?? [] : crew;
    const namesOf = (type: string) => [...new Set(detailCrew.filter(person => person.type === type).map(person => person.name))];
    const directors = namesOf('Director');
    const writers = namesOf('Writer');
    const certification = (metadata.certifications.find(item => item.country === 'US') ?? metadata.certifications[0])?.rating;
    let byContent: ReactNode;
    if (season !== undefined) byContent = <><a href={seriesHref}>{metadata.title}</a>{isEpisode && <> › <a href={seasonHref(season)}>{seasonName}</a></>}</>;
    else if (directors.length) byContent = <>Directed by <u>{directors.join(', ')}</u></>;
    else if (creators.length) byContent = <>Created by <u>{creators.join(', ')}</u></>;
    const by = <div className='by'>{byContent}</div>;
    const rating = isEpisode && episode ? metadata.episodeRatings?.[episode.tmdbId] : metadata.communityRating;
    let runtime = metadata.mediaType === 'movie' ? metadata.runtimeMinutes : undefined;
    if (isEpisode) runtime = episode?.runtimeMinutes;
    let overview = metadata.overview;
    if (isSeason) overview = tmdbSeason?.overview || metadata.overview;
    if (isEpisode) overview = episode?.overview ?? null;
    const lines = <>{by}<div className='meta'>
        {isEpisode ? episode?.airDate && <span>{shortDate(episode.airDate)}</span> : <span>{yearOf(isSeason ? tmdbSeason?.airDate : metadata.premiereDate)}</span>}
        {!!runtime && <span>{datetime.getDisplayDuration(runtime * 600000000)}</span>}
        {isSeason && <span>{episodes.length || tmdbSeason?.episodeCount || 0} episodes</span>}
        {certification && <span className='badge'>{certification}</span>}
        {!!rating && <span className='star'><Icon name='star' />{rating.toFixed(1)}</span>}
    </div></>;
    const cast = [...(metadata.cast ?? []).map(person => ({ key: `cast:${person.id}:${person.order}`, name: person.name,
        role: roleLabel('Actor', person.character), profilePath: person.profilePath })), ...crewCards(detailCrew)];
    const guests = episode?.credits?.guestStars ?? [];
    return <Root><Head art={getTmdbImage(metadata.backdropPath, 'w1280')}
        poster={getTmdbImage(isEpisode ? episode?.stillPath : tmdbSeason?.posterPath || metadata.posterPath, 'w500')}
        title={title} lines={lines} wide={isEpisode} pill={<div className='actbar glassy focuscontainer-x'>{add}</div>}>
        <div className='overview'>{overview && <p>{overview}</p>}
            {writers.length > 0 && <p>{globalize.translate(writers.length > 1 ? 'Writers' : 'Writer')}: {writers.join(', ')}</p>}
            {isEpisode && directors.length > 0 && <p>{globalize.translate(directors.length > 1 ? 'Directors' : 'Director')}: {directors.join(', ')}</p>}
            {!isEpisode && !isSeason && directors.length > 0 && creators.length > 0 && <p>Created By: {creators.join(', ')}</p>}
            {!isSeason && metadata.genres.length > 0 && <p>{globalize.translate(metadata.genres.length > 1 ? 'Genres' : 'Genre')}: {metadata.genres.join(', ')}</p>}
        </div>
    </Head><div className='plain' style={{ paddingBottom: '2.618em' }}>
        {metadata.mediaType === 'series' && season === undefined && <Section title='Seasons' name='children'>
            {metadata.seasons.filter(item => item.number > 0).map(item => <BrowseCell key={item.number} image={getTmdbImage(item.posterPath, 'w342')}
                title={item.name || `Season ${item.number}`} second={item.episodeCount ? `${item.episodeCount} episodes` : 'Not yet aired'} href={seasonHref(item.number)} />)}
        </Section>}
        {isSeason && <div className='eps plain' data-ds-section='children'>{episodes.map(item => <EpisodeRow key={item.episodeNumber} episode={item}
            rating={metadata.episodeRatings?.[item.tmdbId]} href={episodeHref(item.episodeNumber)} />)}</div>}
        {!isSeason && cast.length > 0 && <Section title='Cast & Crew' name='cast'>{cast.map(person => <BrowseCell key={person.key} person
            image={getTmdbImage(person.profilePath, 'w185')} title={person.name} second={person.role} />)}</Section>}
        {isEpisode && guests.length > 0 && <Section title='Guest Stars' name='guests'>{guests.map(person => <BrowseCell key={person.id} person
            image={getTmdbImage(person.profilePath, 'w185')} title={person.name} second={roleLabel('GuestStar', person.character)} />)}</Section>}
        {isEpisode && episodes.length > 1 && <Section name='more' title={<>More from <a href={seasonHref(season!)}>{seasonName}</a></>}>
            {episodes.filter(item => item.episodeNumber !== number).map(item => <BrowseCell key={item.episodeNumber} wide
                image={getTmdbImage(item.stillPath, 'w300')} title={`${item.episodeNumber}. ${item.title}`}
                second={item.airDate ? shortDate(item.airDate) : undefined} href={episodeHref(item.episodeNumber)} />)}
        </Section>}
    </div></Root>;
};
