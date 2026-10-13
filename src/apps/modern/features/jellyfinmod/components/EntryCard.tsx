import React, { type FC, type MouseEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import CardBox from 'components/cardbuilder/Card/CardBox';
import useCard from 'components/cardbuilder/Card/useCard';
import { CardShape } from 'components/cardbuilder/utils/shape';
import layoutManager from 'components/layoutManager';
import type { ItemDto } from 'types/base/models/item-dto';
import type { CardOptions } from 'types/cardOptions';
import inputManager from 'scripts/inputManager';

import { useQueueVisible } from '../hooks/useQueue';
import { CardHoverGet } from '../integration/cardGetRelease';
import { openInFlightCardMenu } from '../integration/queueActions';
import { type Entry, FileState, type RetentionSummary } from '../types/entry';
import { getEntryPath, getTmdbImage } from '../utils/entryLinks';
import FileStateMark, { CardMarkSlot, useEntryDownload } from './FileStateMark';

import 'components/cardbuilder/card.scss';
import './entryCard.scss';

interface EntryCardProps {
    entry: Entry;
    nativeItem?: ItemDto;
    cardOptions: CardOptions;
    retention?: RetentionSummary | null;
    alwaysShowCountdown?: boolean;
}

/** Anchored in the actual cover, so footer lengths and image shapes cannot shift the mark; placed by `CardMarkSlot` (UX §3.1). */
const NativeCardMark: FC<{ entry: Entry; retention?: RetentionSummary | null; alwaysShowCountdown?: boolean }> = ({ entry, retention, alwaysShowCountdown }) => {
    const anchor = useRef<HTMLSpanElement>(null);
    const [cover, setCover] = useState<Element | null>(null);
    useLayoutEffect(() => {
        setCover(anchor.current?.parentElement?.querySelector('.cardScalable') ?? null);
    }, []);
    return <><span ref={anchor} hidden />{cover && <CardMarkSlot cover={cover}>
        <FileStateMark entry={entry} retention={retention} alwaysShowCountdown={alwaysShowCountdown} />
    </CardMarkSlot>}</>;
};

const NativeEntryCard: FC<EntryCardProps & { nativeItem: ItemDto }> = ({ entry, nativeItem, cardOptions, retention, alwaysShowCountdown }) => {
    const { getCardWrapperProps, getCardBoxProps } = useCard({ item: nativeItem, cardOptions });
    const { className, dataAttributes } = getCardWrapperProps();
    const entryClassName = className + ' jfmod-entryCard';
    // Nothing on disk (a reclaimed title's kept item): no Play on its hover, Get a Release in the centre (P1.FU19).
    const noFile = entry.state === FileState.None || entry.state === FileState.Reclaimed ? { 'data-jfmod-nofile': '' } : undefined;
    const content = <>
        <CardBox {...getCardBoxProps()} />
        <NativeCardMark entry={entry} retention={retention} alwaysShowCountdown={alwaysShowCountdown} />
    </>;
    return layoutManager.tv ?
        <button className={entryClassName} type='button' aria-label={entry.title} data-jfmod-tmdb-id={entry.tmdbId} {...dataAttributes} {...noFile}>{content}</button> :
        <div className={entryClassName} aria-label={entry.title} data-jfmod-tmdb-id={entry.tmdbId} {...dataAttributes} {...noFile}>{content}</div>;
};

/**
 * A `grabbed` or `downloading` file-less card gains a context menu with **View queue** (P5.I8). File-less cards had
 * no menu, and the stock item menu needs a native item, so this is mod-owned: right-click, long-press and the
 * Menu key raise `contextmenu`; a `menu` command from the input manager is honoured too. The card stays the one
 * focusable element (UX §5.7).
 */
const useInFlightMenu = (entry: Entry, pending: boolean) => {
    const inFlight = !pending && (entry.state === FileState.Grabbed || entry.state === FileState.Downloading);
    const offered = useQueueVisible(inFlight);
    const [node, setNode] = useState<HTMLElement | null>(null);
    const onContextMenu = useCallback((event: MouseEvent<HTMLElement>) => {
        if (!offered) return;
        event.preventDefault();
        event.stopPropagation();
        void openInFlightCardMenu(event.currentTarget);
    }, [offered]);
    useEffect(() => {
        if (!offered || !node) return;
        const onCommand = (event: Event) => {
            if ((event as CustomEvent<{ command?: string }>).detail?.command !== 'menu') return;
            event.preventDefault();
            event.stopPropagation();
            void openInFlightCardMenu(node);
        };
        inputManager.on(node, onCommand);
        return () => inputManager.off(node, onCommand);
    }, [node, offered]);
    return { ref: setNode, onContextMenu: offered ? onContextMenu : undefined };
};

/** File-less cards expose only an entry link; native actions require a real item. */
const FilelessEntryCard: FC<EntryCardProps> = ({ entry, cardOptions, retention, alwaysShowCountdown }) => {
    const requestedShape = cardOptions.shape;
    const shape = requestedShape && ![CardShape.Auto, CardShape.AutoHome, CardShape.AutoOverflow, CardShape.AutoVertical, CardShape.Mixed].includes(requestedShape) ?
        requestedShape : CardShape.Portrait;
    const artwork = getTmdbImage((shape === CardShape.Backdrop || shape === CardShape.Banner) ? entry.metadata?.backdropPath ?? entry.posterPath : entry.posterPath);
    const path = getEntryPath(entry.id, cardOptions.serverId ?? undefined);
    // An optimistic card has no entry yet; opening it during a slow add would show an error page (P1.W13).
    const pending = entry.id.startsWith('pending:');
    const openEntry = useCallback(() => {
        if (!pending) window.location.hash = '#' + path;
    }, [path, pending]);
    const menu = useInFlightMenu(entry, pending);
    // Nothing on disk: an administrator's Get a Release in the centre on hover, as on upstream's cards (P1.FU19).
    const get = useEntryDownload(entry, !pending);
    const content = (
        <div className={'cardBox ' + (cardOptions.cardLayout ? 'visualCardBox' : 'cardBox-bottompadded')}>
            <div className='cardScalable'>
                <div className={'cardPadder cardPadder-' + shape} />
                <div className='cardContent'>
                    <div className='cardImageContainer coveredImage jfmod-entryArtwork' style={artwork ? { backgroundImage: `url("${artwork}")` } : undefined}>
                        {!artwork && <span className='cardDefaultText'>{entry.title}</span>}
                    </div>
                </div>
                {cardOptions.overlayText && <div className='jfmod-entryOverlayTitle'>{entry.title}</div>}
                {get && <CardHoverGet open={get.open} />}
                <FileStateMark entry={entry} retention={retention} alwaysShowCountdown={alwaysShowCountdown} />
            </div>
            {!cardOptions.overlayText && <div className='cardFooter'>
                {cardOptions.showTitle !== false && <div className='cardText cardTextCentered'>{entry.title}</div>}
                {cardOptions.showYear && entry.year && <div className='cardText cardTextCentered cardText-secondary'>{entry.year}</div>}
            </div>}
        </div>
    );
    const className = 'card ' + shape + 'Card jfmod-entryCard' + (layoutManager.desktop ? ' card-hoverable' : '');
    // The title's download, drawn for every card of the page at once (integration/downloadMarks, P4.FU1).
    const download = pending ? undefined : entry.id;
    if (layoutManager.tv) {
        return <button className={className} type='button' aria-label={entry.title} aria-disabled={pending || undefined}
            data-jfmod-tmdb-id={entry.tmdbId} data-jfmod-entry-id={download} onClick={openEntry} {...menu}>{content}</button>;
    }
    return pending ?
        <div className={className} aria-label={entry.title} aria-busy='true' data-jfmod-tmdb-id={entry.tmdbId}>{content}</div> :
        <a className={className} href={'#' + path} aria-label={entry.title} data-jfmod-tmdb-id={entry.tmdbId} data-jfmod-entry-id={download}
            {...menu}>{content}</a>;
};

const EntryCard: FC<EntryCardProps> = props => props.nativeItem ?
    <NativeEntryCard {...props} nativeItem={props.nativeItem} /> :
    <FilelessEntryCard {...props} />;

export default EntryCard;
