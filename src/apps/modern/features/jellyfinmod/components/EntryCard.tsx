import React, { type FC, type MouseEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import CardBox from 'components/cardbuilder/Card/CardBox';
import useCard from 'components/cardbuilder/Card/useCard';
import { CardShape } from 'components/cardbuilder/utils/shape';
import layoutManager from 'components/layoutManager';
import type { ItemDto } from 'types/base/models/item-dto';
import type { CardOptions } from 'types/cardOptions';
import inputManager from 'scripts/inputManager';

import { useQueueVisible } from '../hooks/useQueue';
import { openInFlightCardMenu } from '../integration/queueActions';
import { chipLabel, formatValue, SOURCE_SHORT } from '../constants/ratings';
import { type Entry, FileState, type RetentionSummary } from '../types/entry';
import type { Rating } from '../types/ratings';
import { getEntryPath, getTmdbImage } from '../utils/entryLinks';
import FileStateMark from './FileStateMark';

import 'components/cardbuilder/card.scss';
import './entryCard.scss';
import './ratings.scss';

interface EntryCardProps {
    entry: Entry;
    nativeItem?: ItemDto;
    cardOptions: CardOptions;
    retention?: RetentionSummary | null;
    alwaysShowCountdown?: boolean;
    /** The one rating the user chose for cards (P9.R7); absent unless they chose one. */
    rating?: Rating | null;
}

/** "IMDb 8.1", in the card's own secondary text: no badge, no corner, no new focus stop (P9.R7). */
const cardRatingText = (rating: Rating) => SOURCE_SHORT[rating.source] + ' ' + formatValue(rating);

/**
 * Puts the card rating into a native card's secondary text line, which upstream's card builds; a card that shows no
 * secondary line gets one of its own in the footer. A portal, so upstream's card component is unchanged.
 */
const NativeCardRating: FC<{ rating: Rating }> = ({ rating }) => {
    const anchor = useRef<HTMLSpanElement>(null);
    const [target, setTarget] = useState<{ node: Element; own: boolean } | null>(null);
    useLayoutEffect(() => {
        const card = anchor.current?.parentElement;
        const secondary = card?.querySelector('.cardFooter .cardText-secondary');
        const footer = card?.querySelector('.cardFooter');
        if (secondary) setTarget({ node: secondary, own: false });
        else if (footer) setTarget({ node: footer, own: true });
    }, []);
    const text = cardRatingText(rating);
    return <><span ref={anchor} hidden />{target && createPortal(target.own ?
        <div className='cardText cardTextCentered cardText-secondary jfmod-cardRating' title={chipLabel(rating)}>{text}</div> :
        <span className='jfmod-cardRating' title={chipLabel(rating)}>{' · ' + text}</span>, target.node)}</>;
};

/** Anchor within the actual cover so footer lengths and image shapes cannot shift the mark. */
const NativeCardMark: FC<{ entry: Entry; retention?: RetentionSummary | null; alwaysShowCountdown?: boolean }> = ({ entry, retention, alwaysShowCountdown }) => {
    const anchor = useRef<HTMLSpanElement>(null);
    const [cover, setCover] = useState<Element | null>(null);
    useLayoutEffect(() => {
        const card = anchor.current?.parentElement;
        setCover(card?.querySelector('.cardScalable') ?? null);
    }, []);
    return <><span ref={anchor} hidden />{cover && createPortal(
        <FileStateMark entry={entry} retention={retention} alwaysShowCountdown={alwaysShowCountdown} />, cover
    )}</>;
};

const NativeEntryCard: FC<EntryCardProps & { nativeItem: ItemDto }> = ({ entry, nativeItem, cardOptions, retention, alwaysShowCountdown, rating }) => {
    const { getCardWrapperProps, getCardBoxProps } = useCard({ item: nativeItem, cardOptions });
    const { className, dataAttributes } = getCardWrapperProps();
    const entryClassName = className + ' jfmod-entryCard';
    const content = <>
        <CardBox {...getCardBoxProps()} />
        <NativeCardMark entry={entry} retention={retention} alwaysShowCountdown={alwaysShowCountdown} />
        {rating && <NativeCardRating rating={rating} />}
    </>;
    return layoutManager.tv ?
        <button className={entryClassName} type='button' aria-label={entry.title} data-jfmod-tmdb-id={entry.tmdbId} {...dataAttributes}>{content}</button> :
        <div className={entryClassName} aria-label={entry.title} data-jfmod-tmdb-id={entry.tmdbId} {...dataAttributes}>{content}</div>;
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
const FilelessEntryCard: FC<EntryCardProps> = ({ entry, cardOptions, retention, alwaysShowCountdown, rating }) => {
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
                <FileStateMark entry={entry} retention={retention} alwaysShowCountdown={alwaysShowCountdown} />
            </div>
            {!cardOptions.overlayText && <div className='cardFooter'>
                {cardOptions.showTitle !== false && <div className='cardText cardTextCentered'>{entry.title}</div>}
                {cardOptions.showYear && entry.year && <div className='cardText cardTextCentered cardText-secondary'>
                    {entry.year}
                    {rating && <span className='jfmod-cardRating' title={chipLabel(rating)}>{' · ' + cardRatingText(rating)}</span>}
                </div>}
                {rating && !(cardOptions.showYear && entry.year) && <div className='cardText cardTextCentered cardText-secondary jfmod-cardRating'
                    title={chipLabel(rating)}>{cardRatingText(rating)}</div>}
            </div>}
        </div>
    );
    const className = 'card ' + shape + 'Card jfmod-entryCard';
    if (layoutManager.tv) {
        return <button className={className} type='button' aria-label={entry.title} aria-disabled={pending || undefined}
            data-jfmod-tmdb-id={entry.tmdbId} onClick={openEntry} {...menu}>{content}</button>;
    }
    return pending ?
        <div className={className} aria-label={entry.title} aria-busy='true' data-jfmod-tmdb-id={entry.tmdbId}>{content}</div> :
        <a className={className} href={'#' + path} aria-label={entry.title} data-jfmod-tmdb-id={entry.tmdbId} {...menu}>{content}</a>;
};

const EntryCard: FC<EntryCardProps> = props => props.nativeItem ?
    <NativeEntryCard {...props} nativeItem={props.nativeItem} /> :
    <FilelessEntryCard {...props} />;

export default EntryCard;
