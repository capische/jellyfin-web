import React, { type FC, useState } from 'react';
import { Icon, type IconName } from './Icon';

/** A real lazy image in the mockup's stable ratio box. */
export const Poster: FC<{ src?: string; icon?: IconName; className?: string }> = ({ src, icon = 'movie', className = 'post' }) => {
    const [failed, setFailed] = useState<string>();
    return <span className={className}>{src && failed !== src ? <img src={src} loading='lazy' alt='' onError={() => setFailed(src)} /> :
        <Icon name={icon} className='fallback' />}</span>;
};
