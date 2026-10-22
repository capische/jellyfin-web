import React, { type FC, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { batchProgress, type BatchEpisode } from '../constants/queue';
import { currentRowFor, packEpisodeView, useQueue, useQueueCapability } from '../hooks/useQueue';
import type { QueueRow } from '../types/queue';
import DownloadStateMark from './DownloadStateMark';
import { episodesWord } from './MissingChildren';

import './downloadProgress.scss';
import './seasonTotal.scss';

/**
 * Every episode of the season (or, `season` null, of the series) a queue row names (a pack's once each), as its season, its own
 * view and the row it comes from.
 */
const batchEpisodes = (items: QueueRow[], entryId: string, season: number | null): BatchEpisode[] => {
    const seasons = new Map<string, number>();
    for (const row of items) {
        if (row.entry?.id !== entryId) continue;
        const named = [...(row.episode ? [{ id: row.episode.id, season: row.episode.seasonNumber }] : []),
            ...(row.pack?.episodes ?? []).map(episode => ({ id: episode.episodeId, season: episode.seasonNumber }))];
        for (const episode of named) {
            if (season === null || episode.season === season) seasons.set(episode.id, episode.season);
        }
    }
    return Array.from(seasons).flatMap(([id, number]) => {
        const row = currentRowFor(items, entryId, id);
        return row ? [{ season: number, row, view: row.pack ? packEpisodeView(row, id) : row }] : [];
    });
};

interface SeasonTotalProps {
    view: HTMLElement;
    entryId: string;
    /** The season, or null for the whole series. */
    season: number | null;
}

/**
 * A season's or a series' total download in its header (P4.FU21, user-approved design 2026-10-22, the series page 2026-10-24,
 * `design/season-total-download.html`): in upstream's action row after Get a Release and before Favourite, the row-size download
 * ring (the total arc, the liveliest glyph) and `2 of 8 episodes · 38% · 2 h 10 min left` beside it, the whole figure in the state
 * text's treatment B; on the phone the figure is one centred line under the row. An indicator, never a control or a focus stop;
 * the tooltip carries the breakdown (by state for a season, by season for a series). Absent while nothing of it is on its way.
 * Read from the shared queue query, like the rows.
 */
const SeasonTotal: FC<SeasonTotalProps> = ({ view, entryId, season }) => {
    const capability = useQueueCapability();
    const [moving, setMoving] = useState(false);
    const queue = useQueue({ enabled: capability.available, poll: moving ? 'cards' : 'slow' });
    const items = queue.data?.items;
    const total = useMemo(() => (items ? batchProgress(batchEpisodes(items, entryId, season), season === null) : null), [items, entryId, season]);
    const shown = !!total;
    useEffect(() => setMoving(shown), [shown]);
    const [hosts, setHosts] = useState<{ inline: HTMLElement; line: HTMLElement } | null>(null);
    // Placed as the header buttons are (`stockHeaderButton`): before Favorite, so Get a Release (told to come first) leads it.
    useLayoutEffect(() => {
        const row = view.querySelector('.mainDetailButtons');
        const favorite = row?.querySelector(':scope > .btnUserRating');
        if (!shown || !row || !favorite) return;
        const inline = document.createElement('span');
        inline.className = 'jfmod-seasonTotal';
        const line = document.createElement('div');
        line.className = 'jfmod-seasonTotalLine';
        row.insertBefore(inline, favorite);
        row.after(line);
        setHosts({ inline, line });
        return () => {
            inline.remove();
            line.remove();
            setHosts(null);
        };
    }, [view, shown]);
    if (!total || !hosts) return null;
    const figure = <span title={total.tooltip} className={'jfmod-dlMeta jfmod-dlMeta--' + total.kind + (total.stale ? ' jfmod-dlMeta--stale' : '')}>
        {total.done + ' of ' + episodesWord(total.total) + ' · ' + total.text}
    </span>;
    return <>
        {createPortal(<><DownloadStateMark progress={total} size='row' /><span className='jfmod-seasonTotal-figure'>{figure}</span></>,
            hosts.inline)}
        {createPortal(figure, hosts.line)}
    </>;
};

export default SeasonTotal;
