import React, { type FC, useId } from 'react';

import { SOURCE_LONG } from '../constants/ratings';
import type { Rating } from '../types/ratings';

/**
 * Small marks for each ratings source (Phase 9, user request 2026-10-08), drawn inline: no image file, no font and no request
 * to any site. Each is a simplified mark drawn for JellyfinMod, except the Rotten Tomatoes critic tomato and splat, whose
 * paths are Jellyfin Web's own `src/assets/img/fresh.svg` and `rotten.svg` (GPL-2.0, the licence of this fork). The names and
 * marks are the sources' trademarks; they identify where a value came from and imply no endorsement (PHASE9, *Source icons*).
 */

/** Which mark a value gets: Rotten Tomatoes' are fresh or rotten, full or spilled, at 60 % as on their site. */
export type RatingIconKind = 'imdb' | 'tmdb' | 'trakt' | 'tomatoesCritic' | 'tomatoesCriticRotten' | 'tomatoesAudience' | 'tomatoesAudienceSpilled'
    | 'metacritic' | 'metacriticUser' | 'letterboxd' | 'rogerebert';

export const iconKind = (rating: Pick<Rating, 'source' | 'value' | 'scale'>): RatingIconKind => {
    switch (rating.source) {
        case 'tomatoes_critic': return rating.value < 60 ? 'tomatoesCriticRotten' : 'tomatoesCritic';
        case 'tomatoes_audience': return rating.value < 60 ? 'tomatoesAudienceSpilled' : 'tomatoesAudience';
        case 'metacritic_user': return 'metacriticUser';
        default: return rating.source;
    }
};

/** A word set in the mark itself (IMDb, TMDB): the system's bold sans-serif, so nothing is fetched. */
const Word: FC<{ x: number; y: number; size: number; fill: string; children: string }> = ({ x, y, size, fill, children }) =>
    <text x={x} y={y} fontSize={size} fill={fill} textAnchor='middle' fontFamily='Arial, Helvetica, sans-serif' fontWeight='bold'>{children}</text>;

const BUCKET = 'M3.6 10.4h16.8l-2.3 12.6H5.9z';
const STRIPES = 'M8.6 10.4h2l-.4 12.6H9.1zM13.4 10.4h2l-.9 12.6h-1.5z';

const MARKS: Record<RatingIconKind, { viewBox: string; body: React.ReactNode }> = {
    imdb: { viewBox: '0 0 44 22', body: <>
        <rect width='44' height='22' rx='3.5' fill='#f5c518' />
        <Word x={22} y={16} size={13.5} fill='#000'>IMDb</Word>
    </> },
    // TMDB's teal-to-blue bar with its navy letters; the gradient is the one per-instance id (see TmdbMark).
    tmdb: { viewBox: '0 0 46 22', body: null },
    trakt: { viewBox: '0 0 24 24', body: <>
        <circle cx='12' cy='12' r='12' fill='#ed1c24' />
        <circle cx='12' cy='12' r='8.2' fill='none' stroke='#fff' strokeWidth='1.6' />
        <path d='M7.6 11.6l3.2 3.2 5.8-6.4' fill='none' stroke='#fff' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' />
    </> },
    // Jellyfin Web's fresh tomato (src/assets/img/fresh.svg).
    tomatoesCritic: { viewBox: '0 0 138.75 141.25', body: <>
        <g fill='#f93208'>
            <path d='m20.154 40.829c-28.149 27.622-13.657 61.011-5.734 71.931 35.254 41.954 92.792 25.339 111.89-5.9071 4.7608-8.2027 22.554-53.467-23.976-78.009z' />
            <path d='m39.613 39.265 4.7778-8.8607 28.406-5.0384 11.119 9.2082z' />
        </g>
        <path fill='#02902e' d='m39.436 8.5696 8.9682-5.2826 6.7569 15.479c3.7925-6.3226 13.79-16.316 24.939-4.6684-4.7281 1.2636-7.5161 3.8553-7.7397 8.4768 15.145-4.1697 31.343 3.2127 33.539 9.0911-10.951-4.314-27.695 10.377-41.771 2.334 0.009 15.045-12.617 16.636-19.902 17.076 2.077-4.996 5.591-9.994 1.474-14.987-7.618 8.171-13.874 10.668-33.17 4.668 4.876-1.679 14.843-11.39 24.448-11.425-6.775-2.467-12.29-2.087-17.814-1.475 2.917-3.961 12.149-15.197 28.625-8.476z' />
    </> },
    // Jellyfin Web's rotten splat (src/assets/img/rotten.svg).
    tomatoesCriticRotten: { viewBox: '0 0 145 140', body:
        <path fill='#0fc755' d='M47.4 35.342c-13.607-7.935-12.32-25.203 2.097-31.88 26.124-6.531 29.117 13.78 22.652 30.412-6.542 24.11 18.095 23.662 19.925 10.067 3.605-18.412 19.394-26.695 31.67-16.359 12.598 12.135 7.074 36.581-17.827 34.187-16.03-1.545-19.552 19.585.839 21.183 32.228 1.915 42.49 22.167 31.04 35.865-15.993 15.15-37.691-4.439-45.512-19.505-6.8-9.307-17.321.11-13.423 6.502 12.983 19.465 2.923 31.229-10.906 30.62-13.37-.85-20.96-9.06-13.214-29.15 3.897-12.481-8.595-15.386-16.57-5.45-11.707 19.61-28.865 13.68-33.976 4.19-3.243-7.621-2.921-25.846 24.119-23.696 16.688 4.137 11.776-12.561-.63-13.633-9.245-.443-30.501-7.304-22.86-24.54 7.34-11.056 24.958-11.768 33.348 6.293 3.037 4.232 8.361 11.042 18.037 5.033 3.51-5.197 1.21-13.9-8.809-20.135z' />
    },
    // A striped bucket heaped with popcorn.
    tomatoesAudience: { viewBox: '0 0 24 24', body: <>
        <g fill='#ffe9a8' stroke='#e0b34c' strokeWidth='0.5'>
            <circle cx='6' cy='8.6' r='3' /><circle cx='18' cy='8.6' r='3' /><circle cx='12' cy='5' r='3.6' />
            <circle cx='8.8' cy='6.6' r='3' /><circle cx='15.2' cy='6.6' r='3' />
        </g>
        <path d={BUCKET} fill='#fa320a' />
        <path d={STRIPES} fill='#fff' />
    </> },
    // The same bucket on its side, its popcorn spilled out of the open end: green, like the rotten splat.
    tomatoesAudienceSpilled: { viewBox: '0 0 24 24', body: <>
        <path d='M7.4 5.2L23 8.4v7.2L7.4 18.8z' fill='#0fc755' />
        <path d='M7.4 9.3L23 10.9v1.2L7.4 11.6zM7.4 13.4L23 13.1v1.2L7.4 15.7z' fill='#fff' />
        <g fill='#f4f1d0' stroke='#8fbf6c' strokeWidth='0.5'>
            <circle cx='4.4' cy='9.6' r='2.4' /><circle cx='3.6' cy='14.6' r='2.2' /><circle cx='6.2' cy='20.4' r='1.9' /><circle cx='2.4' cy='19.6' r='1.6' />
        </g>
    </> },
    metacritic: { viewBox: '0 0 24 24', body: <>
        <circle cx='12' cy='12' r='11.2' fill='#000' stroke='#ffcc34' strokeWidth='1.6' />
        <Word x={12} y={16.4} size={13} fill='#fff'>m</Word>
    </> },
    // The users' score: the same letter in a rounded square, so the two Metacritic values never look alike.
    metacriticUser: { viewBox: '0 0 24 24', body: <>
        <rect x='0.8' y='0.8' width='22.4' height='22.4' rx='5' fill='#000' stroke='#ffcc34' strokeWidth='1.6' />
        <Word x={12} y={16.4} size={13} fill='#ffcc34'>m</Word>
    </> },
    letterboxd: { viewBox: '0 0 34 14', body: <>
        <circle cx='7' cy='7' r='6.2' fill='#ff8000' />
        <circle cx='27' cy='7' r='6.2' fill='#40bcf4' />
        <circle cx='17' cy='7' r='6.2' fill='#00e054' />
    </> },
    rogerebert: { viewBox: '0 0 30 22', body: <>
        <rect width='30' height='22' rx='4' fill='#3a3a3a' stroke='#bbb' strokeWidth='1' />
        <Word x={15} y={15.6} size={12} fill='#fff'>RE</Word>
    </> }
};

/**
 * One source's mark, about the height of a capital letter and sitting on the text's baseline. It names its source for a
 * screen reader (the value beside it is plain text), and carries no `<title>`, so it adds no tooltip of its own.
 */
const TmdbMark: FC = () => {
    // React's ids carry colons; a plain name keeps the url() reference simple on older TV engines.
    const id = 'jfmodTmdb' + useId().replace(/[^a-zA-Z0-9]/g, '');
    return <>
        <defs>
            <linearGradient id={id} x1='0' y1='0' x2='1' y2='0'>
                <stop offset='0' stopColor='#90cea1' /><stop offset='0.56' stopColor='#3cbec9' /><stop offset='1' stopColor='#00b3e5' />
            </linearGradient>
        </defs>
        <rect width='46' height='22' rx='11' fill={`url(#${id})`} />
        <Word x={23} y={15.6} size={12} fill='#0d253f'>TMDB</Word>
    </>;
};

const RatingIcon: FC<{ rating: Pick<Rating, 'source' | 'value' | 'scale'> }> = ({ rating }) => {
    const kind = iconKind(rating);
    const mark = kind === 'tmdb' ? { ...MARKS.tmdb, body: <TmdbMark /> } : MARKS[kind];
    return <svg className='jfmod-ratingIcon' viewBox={mark.viewBox} role='img' aria-label={SOURCE_LONG[rating.source]}
        data-jfmod-icon={kind} focusable='false'>{mark.body}</svg>;
};

export default RatingIcon;
