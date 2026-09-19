import React, { type FC, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import CardBox from 'components/cardbuilder/Card/CardBox';
import useCard from 'components/cardbuilder/Card/useCard';
import { CardShape } from 'components/cardbuilder/utils/shape';
import layoutManager from 'components/layoutManager';
import type { ItemDto } from 'types/base/models/item-dto';
import type { CardOptions } from 'types/cardOptions';

import type { Entry, RetentionSummary } from '../types/entry';
import { getEntryPath, getTmdbImage } from '../utils/entryLinks';
import FileStateMark from './FileStateMark';

import 'components/cardbuilder/card.scss';
import './entryCard.scss';

interface EntryCardProps {
    entry: Entry;
    nativeItem?: ItemDto;
    cardOptions: CardOptions;
    retention?: RetentionSummary | null;
    alwaysShowCountdown?: boolean;
}

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

const NativeEntryCard: FC<EntryCardProps & { nativeItem: ItemDto }> = ({ entry, nativeItem, cardOptions, retention, alwaysShowCountdown }) => {
    const { getCardWrapperProps, getCardBoxProps } = useCard({ item: nativeItem, cardOptions });
    const { className, dataAttributes } = getCardWrapperProps();
    const entryClassName = className + ' jfmod-entryCard';
    const content = <>
        <CardBox {...getCardBoxProps()} />
        <NativeCardMark entry={entry} retention={retention} alwaysShowCountdown={alwaysShowCountdown} />
    </>;
    return layoutManager.tv ?
        <button className={entryClassName} type='button' aria-label={entry.title} data-jfmod-tmdb-id={entry.tmdbId} {...dataAttributes}>{content}</button> :
        <div className={entryClassName} aria-label={entry.title} data-jfmod-tmdb-id={entry.tmdbId} {...dataAttributes}>{content}</div>;
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
                {cardOptions.showYear && entry.year && <div className='cardText cardTextCentered cardText-secondary'>{entry.year}</div>}
            </div>}
        </div>
    );
    const className = 'card ' + shape + 'Card jfmod-entryCard';
    if (layoutManager.tv) {
        return <button className={className} type='button' aria-label={entry.title} aria-disabled={pending || undefined}
            data-jfmod-tmdb-id={entry.tmdbId} onClick={openEntry}>{content}</button>;
    }
    return pending ?
        <div className={className} aria-label={entry.title} aria-busy='true' data-jfmod-tmdb-id={entry.tmdbId}>{content}</div> :
        <a className={className} href={'#' + path} aria-label={entry.title} data-jfmod-tmdb-id={entry.tmdbId}>{content}</a>;
};

const EntryCard: FC<EntryCardProps> = props => props.nativeItem ?
    <NativeEntryCard {...props} nativeItem={props.nativeItem} /> :
    <FilelessEntryCard {...props} />;

export default EntryCard;
