import React, { type FC, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { batchProgress, type BatchProgress } from '../constants/queue';
import { batchEpisodes, useQueue, useQueueCapability } from '../hooks/useQueue';
import { DownloadMark } from '../design/StateMark';
import { episodesWord } from './MissingChildren';

/**
 * `2 of 8 episodes · 38% · …`; an episode that already plays counts apart as a new version (D12): `1 new version · 60% · …`,
 * `2 of 5 episodes · 1 new version · 38% · …`.
 */
const totalText = (total: BatchProgress) => {
    const versions = total.versions + (total.versions === 1 ? ' new version' : ' new versions');
    return [total.total > 0 ? total.done + ' of ' + episodesWord(total.total) : null, total.versions > 0 ? versions : null, total.text]
        .filter(Boolean).join(' · ');
};

interface SeasonTotalProps {
    view: HTMLElement;
    entryId: string;
    /** The season, or null for the whole series. */
    season: number | null;
}

/** Existing shared-queue batch calculation, painted in the native head's notice slot. */
const SeasonTotal: FC<SeasonTotalProps> = ({ view, entryId, season }) => {
    const capability = useQueueCapability();
    const [moving, setMoving] = useState(false);
    const queue = useQueue({ enabled: capability.available, poll: moving ? 'cards' : 'slow' });
    const items = queue.data?.items;
    const total = useMemo(() => (items ? batchProgress(batchEpisodes(items, entryId, season), season === null) : null), [items, entryId, season]);
    const shown = !!total;
    useEffect(() => setMoving(shown), [shown]);
    const [host, setHost] = useState<HTMLElement | null>(null);
    useLayoutEffect(() => {
        const row = view.querySelector('[data-ds-slot="notice"]');
        if (!shown || !row) return;
        const inline = document.createElement('span');
        inline.className = 'dline';
        inline.dataset.dsSeasonTotal = '';
        row.appendChild(inline);
        setHost(inline);
        return () => {
            inline.remove();
            setHost(null);
        };
    }, [view, shown]);
    if (!total || !host) return null;
    const figure = <span title={total.tooltip} className='dlf'>
        {totalText(total)}
    </span>;
    return createPortal(<><DownloadMark progress={total} size='row' /><span className='figs'>{figure}</span></>, host);
};

export default SeasonTotal;
