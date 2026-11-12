import React, { type FC, type ReactNode, useContext } from 'react';
import { DesignContext } from './Root';
import type { IconName } from './Icon';
import { Poster } from './Poster';

/**
 * ds.t20, round 7d (the user, 2026-11-17; workspace reviews/fable-design-review/mockup/series7-bg.html?fit=screen&scrim=after2):
 * the hero of a computer's and the TV's series and movie pages. No poster beside the head: the Backdrop, top-anchored, covers a
 * box from 23.6 % of the width to the right edge, its left edge melting into the blurred copy (the art ground). With no Backdrop
 * the poster is the blurred ground and stands whole on the right, as tall as the column. The column's upper block and its
 * reading block each carry a plate (`jfmod-up`, `jfmod-rd`, titleTop.scss).
 */
const Hero: FC<{ art?: string; poster?: string; name: ReactNode; pill: ReactNode; children: ReactNode; reading?: ReactNode }> = ({ art, poster, name, pill, children, reading }) => {
    const ground = art || poster;
    return <div className={'ground onart jfmod-hero' + (art ? '' : ' jfmod-heroPlain')}>
        <div className='jfmod-heroArt'>
            <div className='art' style={ground ? { backgroundImage: `url("${ground}")` } : undefined} />
            {art && <div className='jfmod-heroBox'><div className='jfmod-heroPic' style={{ backgroundImage: `url("${art}")` }} /></div>}
            <div className='jfmod-heroScrim' />
        </div>
        <div className='dhead jfmod-titleHead'>
            <div className='col'>
                {!art && poster && <img className='jfmod-heroPoster' src={poster} alt='' />}
                <div className='jfmod-up'>{name}{pill}{children}</div>
                {reading && <div className='jfmod-rd'>{reading}</div>}
            </div>
        </div>
    </div>;
};

/** ds.js head/ground: phone puts the pill and copy outside the centred poster/name block. */
export const Head: FC<{ art?: string; poster?: string; title: ReactNode; lines: ReactNode; pill: ReactNode; children: ReactNode; wide?: boolean; icon?: IconName; titleTop?: boolean; hero?: boolean; reading?: ReactNode }> = ({ art, poster, title, lines, pill, children, wide, icon, titleTop, hero, reading }) => {
    const phone = useContext(DesignContext) === 'phone';
    const name = <><h1 className='itemName'>{title}</h1>{lines}</>;
    if (hero) return <Hero art={art} poster={poster} name={name} pill={pill} reading={reading}>{children}</Hero>;
    const image = <div className={'poster' + (wide ? ' wide' : '')}><Poster src={poster} icon={icon ?? (wide ? 'tv' : 'movie')} /></div>;
    return <div className='ground onart'>
        <div className='art' style={art ? { backgroundImage: `url("${art}")` } : undefined} /><div className='fade' />
        <div className={'dhead' + (titleTop ? ' jfmod-titleHead' : '')}>{image}{phone ? name : <div className='col'>{name}{pill}{children}</div>}</div>
        {phone && <>{pill}<div className='pad primary' style={{ paddingLeft: '5%', paddingRight: '5%' }}>{children}</div></>}
    </div>;
};
