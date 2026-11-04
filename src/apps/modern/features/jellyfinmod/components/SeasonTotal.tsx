import React, { type FC, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { batchProgress, type BatchEpisode, type BatchProgress } from '../constants/queue';
import { currentRowFor, packEpisodeView, useQueue, useQueueCapability } from '../hooks/useQueue';
import type { QueueRow } from '../types/queue';
import { DownloadMark } from '../design/StateMark';
import { episodesWord } from './MissingChildren';

/**
 * Every episode of the season (or, `season` null, of the series) a queue row names (a pack's once each), as its season, its own
 * view and the row it comes from.
 */
const batchEpisodes = (items: QueueRow[], entryId: string, season: number | null): BatchEpisode[] => {
    const places = new Map<string, { season: number; number: number }>();
    for (const row of items) {
        if (row.entry?.id !== entryId) continue;
        const named = [...(row.episode ? [{ id: row.episode.id, season: row.episode.seasonNumber, number: row.episode.episodeNumber }] : []),
            ...(row.pack?.episodes ?? []).map(episode => ({ id: episode.episodeId, season: episode.seasonNumber, number: episode.episodeNumber }))];
        for (const episode of named) {
            if (season === null || episode.season === season) places.set(episode.id, { season: episode.season, number: episode.number });
        }
    }
    return Array.from(places).flatMap(([id, place]) => {
        const row = currentRowFor(items, entryId, id);
        return row ? [{ ...place, row, view: row.pack ? packEpisodeView(row, id) : row }] : [];
    });
};

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
