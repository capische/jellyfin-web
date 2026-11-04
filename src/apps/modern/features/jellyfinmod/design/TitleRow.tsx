import React, { type FC, type PropsWithChildren, type ReactNode } from 'react';

export const TitleRow: FC<PropsWithChildren<{ title: ReactNode; name?: string }>> = ({ title, name, children }) =>
    <div className='sect plain' data-ds-section={name}><h2 className='rowt'>{title}</h2><div className='rowx focuscontainer-x'>{children}</div></div>;
