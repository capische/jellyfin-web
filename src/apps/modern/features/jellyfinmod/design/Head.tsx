import React, { type FC, type ReactNode, useContext } from 'react';
import { DesignContext } from './Root';
import { Poster } from './Poster';

/** ds.js head/ground: phone puts the pill and copy outside the centred poster/name block. */
export const Head: FC<{ art?: string; poster?: string; title: ReactNode; lines: ReactNode; pill: ReactNode; children: ReactNode; wide?: boolean }> = ({ art, poster, title, lines, pill, children, wide }) => {
    const phone = useContext(DesignContext) === 'phone';
    const image = <div className={'poster' + (wide ? ' wide' : '')}><Poster src={poster} icon={wide ? 'tv' : 'movie'} /></div>;
    const name = <><h1 className='itemName'>{title}</h1>{lines}</>;
    return <div className='ground onart'>
        <div className='art' style={art ? { backgroundImage: `url("${art}")` } : undefined} /><div className='fade' />
        <div className='dhead'>{image}{phone ? name : <div className='col'>{name}{pill}{children}</div>}</div>
        {phone && <>{pill}<div className='pad primary' style={{ paddingLeft: '5%', paddingRight: '5%' }}>{children}</div></>}
    </div>;
};
