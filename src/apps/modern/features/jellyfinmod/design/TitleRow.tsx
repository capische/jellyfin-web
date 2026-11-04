import React, { type FC, type PropsWithChildren, type ReactNode } from 'react';
import Scroller from 'elements/emby-scroller/Scroller';

/** ds.js sect/rowt; the scroller supplies the arrows and focus walking of every other row (D252). */
export const TitleRow: FC<PropsWithChildren<{ title: ReactNode; name?: string }>> = ({ title, name, children }) =>
    <div className='sect plain' data-ds-section={name}><h2 className='rowt'>{title}</h2>
        <Scroller className='ds-rowframe' isCenterFocusEnabled isAllowNativeSmoothScrollEnabled>
            <div className='rowx scrollSlider focuscontainer-x'>{children}</div>
        </Scroller>
    </div>;
