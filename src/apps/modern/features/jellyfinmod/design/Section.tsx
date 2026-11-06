import React, { type FC, type PropsWithChildren, type ReactNode } from 'react';
import ItemsContainer from 'elements/emby-itemscontainer/ItemsContainer';
import Scroller from 'elements/emby-scroller/Scroller';
import type { QueryKey } from '@tanstack/react-query';
import { RowRefreshContext, useRowMotion } from './useRowMotion';

/** ds.js sect/rowt; the scroller and command container supply behavior only. */
export const Section: FC<PropsWithChildren<{ title: ReactNode; name?: string; queryKey?: QueryKey; reload?: () => void; motionIds?: string[]; motionReady?: boolean }>> = ({ title, name, children, queryKey, reload, motionIds, motionReady }) => {
    const motion = useRowMotion(children, motionIds, motionReady);
    return <RowRefreshContext.Provider value={motion.refresh}><div ref={motion.root} className='sect plain' data-ds-section={name}
        hidden={motionReady && motionIds?.length === 0 && !motion.active}>
        <h2 className='rowt'>{title}</h2>
        <Scroller className='ds-rowframe' isCenterFocusEnabled isAllowNativeSmoothScrollEnabled>
            <ItemsContainer isPlain className='rowx scrollSlider focuscontainer-x' queryKey={queryKey} reloadItems={reload}>{motion.content}</ItemsContainer>
        </Scroller>
    </div></RowRefreshContext.Provider>;
};
