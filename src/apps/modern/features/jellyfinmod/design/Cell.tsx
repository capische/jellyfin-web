import React, { type FC, type KeyboardEvent, type FocusEvent, useContext } from 'react';
import { watchedLabel } from '../utils/watched';
import itemHelper from 'components/itemHelper';
import { playbackManager } from 'components/playback/playbackmanager';
import { ItemAction } from 'constants/itemAction';
import type { CardOptions } from 'types/cardOptions';
import type { BrowseRow } from '../types/browse';
import { cardRatingValue } from '../constants/ratings';
import RatingIcon from '../components/RatingIcon';
import { Cloud, Icon } from './Icon';
import { useCellModel } from './useCellModel';
import { DesignContext } from './Root';

const activate = (event: KeyboardEvent<HTMLElement>) => {
    // Only the focused control itself: Enter on a link inside the card (an episode's series name) keeps the link's own action
    // (Codex review of ds.t14, P2).
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.click();
    }
};

const focusCell = (event: FocusEvent<HTMLElement>, prepare: () => void) => {
    prepare();
    const root = event.currentTarget.closest('.jfds');
    if (root?.classList.contains('dev-phone')) return;
    event.currentTarget.classList.add('focus');
    if (!root?.classList.contains('layout-tv')) event.currentTarget.classList.add('lit');
};
const blurCell = (event: FocusEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.classList.remove('focus', 'lit');
};

export const CellSkeleton: FC<{ library?: boolean; wide?: boolean }> = ({ library, wide }) => <div className={'cell ' + (wide ? 'w' : 'p')} aria-hidden='true'><div className='tile'>
    <span className='post sk' /><div className='sk1' /><div className='sk1' />{library && <div className='sk1' />}
</div></div>;

export type CellModel = ReturnType<typeof useCellModel>;

const FileMark: FC<{ model: CellModel }> = ({ model }) => {
    if (model.countdown !== null) return <span className='mark glassy' title={`File will be removed in ${model.countdown} day${model.countdown === 1 ? '' : 's'}`}><span className='num' data-ds-countdown>{model.countdown}d</span></span>;
    if (model.searching) return <span className='mark glassy' title='Searching'><Icon name='search' /></span>;
    if (model.noFile) return <span className='mark glassy' title='Not Downloaded'><Cloud /></span>;
    return null;
};

const CellMarks: FC<{ model: CellModel }> = ({ model }) => {
    const { count, item, progress } = model;
    return <>
        <span className='corner'>
            {!!count && <span className='pill2'><span>{count}</span></span>}
            {item?.UserData?.Played && <span className='pill2 tick'><Icon name='check' /></span>}
            <FileMark model={model} />
        </span>
        {!!progress && progress < 100 && <span className='prog'><i style={{ width: `${progress}%` }} /></span>}
    </>;
};

/** Watched, Favourite, More: Download lives on the disc of a card with no file and in More (the user, 2026-11-07). */
export const CellMenu: FC<{ model: CellModel }> = ({ model }) => {
    const tv = useContext(DesignContext) === 'tv';
    const controlClass = 'pi' + (tv ? '' : ' focusable');
    const { item, entry, pending, toggle, menu, isPlayed, isFavorite } = model;
    return <span className='hmenu glassy jfmod-cardActions'>
        {item && itemHelper.canMarkPlayed(item) && <span className={controlClass + ' itemAction'} data-action={ItemAction.None} role='button' tabIndex={tv ? -1 : 0} onKeyDown={activate}
            data-tip={watchedLabel({ ...item.UserData, Played: isPlayed })} aria-label={watchedLabel({ ...item.UserData, Played: isPlayed })} data-ds-action='played' aria-pressed={isPlayed} onClick={event => { void toggle(event, 'played'); }}><Icon name='check' /></span>}
        {item && itemHelper.canRate(item) && <span className={controlClass + ' itemAction'} data-action={ItemAction.None} role='button' tabIndex={tv ? -1 : 0} onKeyDown={activate}
            data-tip={isFavorite ? 'Favorite' : 'Add to Favorites'} aria-label={isFavorite ? 'Favorite' : 'Add to Favorites'} data-ds-action='favorite' aria-pressed={isFavorite} onClick={event => { void toggle(event, 'favorite'); }}><Icon name='heart' /></span>}
        {(item || entry && !pending) && <span className={`${controlClass}${item ? ' itemAction' : ''}`} role='button' tabIndex={tv ? -1 : 0}
            onKeyDown={activate} data-tip='More' aria-label='More' data-action={item ? ItemAction.Menu : undefined} onClick={menu}><Icon name='more' /></span>}
    </span>;
};

/** The centre disc: Download for a title with no file, Play for one that plays (Search's library cards draw it too, ds.t16). */
export const CellDisc: FC<{ model: CellModel }> = ({ model }) => {
    const { item, noFile, get, shape, download } = model;
    const available = noFile ? !!get : !!item && playbackManager.canPlay(item);
    if (shape === 'c' || !available) return null;
    return <span className='disc hov glassy itemAction' role='button' tabIndex={-1}
        data-action={noFile ? ItemAction.None : ItemAction.Play} aria-label={noFile ? 'Download' : 'Play'} data-ds-action={noFile ? 'get' : undefined}
        onKeyDown={activate} onClick={noFile ? download : undefined}>{noFile ? <Cloud /> : <Icon name='play' />}</span>;
};

const CellCaption: FC<{ model: CellModel }> = ({ model }) => {
    const { name, second, rating, item, entry, seriesHref } = model;
    return <div className='capt'>
        {seriesHref ? <a className='ln t itemAction' data-action={ItemAction.None} href={seriesHref}>{name}</a> : <div className='ln t'>{name}</div>}<div className='ln'>{second}{rating && <span className={'jfmod-cardRating' + (rating.stale ? ' jfmod-cardRating-stale' : '')}> · <RatingIcon rating={rating} />{cardRatingValue(rating)}</span>}</div>
        <div className='ln d' data-jfmod-cast={item?.Id ?? entry?.id} />
    </div>;
};

const fallbackIcon = (type: string | null | undefined, shape: string) => {
    if (shape === 'c') return 'person';
    if (type === 'Series') return 'tv';
    return 'movie';
};

/** ds.js cell: native actions stay delegated to ItemsContainer's existing command logic. */
export const Cell: FC<{ row: BrowseRow; options: CardOptions; alwaysShowCountdown?: boolean }> = ({ row, options, alwaysShowCountdown }) => {
    const model = useCellModel(row, options, alwaysShowCountdown);
    const { action, item, entry, empty, pending, noFile, shape, source, failedSource, setFailedSource, title, data, open, menu } = model;
    const fallback = fallbackIcon(item?.Type, shape);
    const { flightMenu } = model;
    return <div className={`cell jfmod-posterCell ${shape}${shape === 'c' ? '' : ' act'} focusable${item ? ' itemAction' : ''}`}
        {...data} data-action={item ? action : undefined} tabIndex={0} role='link' aria-label={title} aria-busy={pending || undefined}
        aria-disabled={pending || undefined} data-jfmod-entry-id={pending ? undefined : entry?.id}
        data-jfmod-empty={empty ? '' : undefined} data-jfmod-tmdb-id={entry?.tmdbId} data-jfmod-nofile={noFile ? '' : undefined}
        onClick={open} onKeyDown={activate} ref={flightMenu.ref} onMouseEnter={model.prepareRelease} onFocus={event => focusCell(event, model.prepareRelease)} onBlur={blurCell} onContextMenu={flightMenu.onContextMenu ?? menu}>
        <div className='tile'><span className='post'>
            {source && source !== failedSource ? <img src={source} loading='lazy' alt='' onError={() => setFailedSource(source)} /> :
                <Icon name={fallback} className='fallback' />}
            <CellMarks model={model} />
            <CellDisc model={model} />
            {shape !== 'c' && <CellMenu model={model} />}
        </span><CellCaption model={model} /></div>
    </div>;
};
