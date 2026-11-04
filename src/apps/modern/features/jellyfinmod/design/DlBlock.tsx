import React, { type FC, type ReactNode } from 'react';

/** ds2.js P.dlblock: state/queue projection and every action stay in the existing DownloadBlock controller. */
export const DlBlock: FC<{ kind: string; mark: ReactNode; state: ReactNode; release: ReactNode; bar: ReactNode; actions: ReactNode }> = ({ kind, mark, state, release, bar, actions }) =>
    <div className='dlb' data-jfmod-state={kind}>{mark}<div className='b'><div className='ln1'>{state}</div>{release}{bar}{actions}</div></div>;
