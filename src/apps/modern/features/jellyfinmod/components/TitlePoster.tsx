import React, { type FC, useState } from 'react';

/** A head image always owns its ratio, including while loading or after an image error. */
const TitlePoster: FC<{ src?: string; title: string; children?: React.ReactNode }> = ({ src, title, children }) => {
    const [failed, setFailed] = useState<string>();
    return <div className='card portraitCard jfmod-entryPoster'>
        <span className='material-icons cardImageIcon movie' aria-hidden='true' />
        {src && failed !== src && <img src={src} alt={title} loading='lazy' onError={() => setFailed(src)} />}
        {children}
    </div>;
};

export default TitlePoster;
