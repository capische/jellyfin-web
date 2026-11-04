import React, { type FC, type PropsWithChildren, type ReactNode } from 'react';
import ItemsContainer from 'elements/emby-itemscontainer/ItemsContainer';
import Scroller from 'elements/emby-scroller/Scroller';
import type { QueryKey } from '@tanstack/react-query';

/** ds.js sect/rowt; the scroller and command container supply behavior only. */
export const Section: FC<PropsWithChildren<{ title: ReactNode; name?: string; queryKey?: QueryKey; reload?: () => void }>> = ({ title, name, children, queryKey, reload }) => <div className='sect plain' data-ds-section={name}>
    <h2 className='rowt'>{title}</h2>
    <Scroller className='ds-rowframe' isCenterFocusEnabled isAllowNativeSmoothScrollEnabled>
        <ItemsContainer isPlain className='rowx scrollSlider focuscontainer-x' queryKey={queryKey} reloadItems={reload}>{children}</ItemsContainer>
    </Scroller>
</div>;
