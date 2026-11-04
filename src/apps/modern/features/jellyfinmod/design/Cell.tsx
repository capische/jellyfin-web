import React, { type FC, type KeyboardEvent, type FocusEvent, useContext } from 'react';
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

export const CellSkeleton: FC<{ library?: boolean }> = ({ library }) => <div className='cell p' aria-hidden='true'><div className='tile'>
    <span className='post sk' /><div className='sk1' /><div className='sk1' />{library && <div className='sk1' />}
</div></div>;

type CellModel = ReturnType<typeof useCellModel>;

const FileMark: FC<{ model: CellModel }> = ({ model }) => {
    if (model.countdown !== null) return <span className='mark glassy' title={`File will be removed in ${model.countdown} day${model.countdown === 1 ? '' : 's'}`}><span className='num' data-ds-countdown>{model.countdown}d</span></span>;
    if (model.searching) return <span className='mark glassy' title='Searching'><Icon name='search' /></span>;
    if (model.noFile) return <span className='mark glassy' title='Not Downloaded'><Cloud /></span>;
    return null;
};

const CellMarks: FC<{ model: CellModel }> = ({ model }) => {
    const { count, item, progress } = model;
    return <>
        {!!count && <span className='pill2'><span>{count}</span></span>}
        {item?.UserData?.Played && <span className='pill2 tick'><Icon name='check' /></span>}
        {!!progress && progress < 100 && <span className='prog'><i style={{ width: `${progress}%` }} /></span>}
        <FileMark model={model} />
    </>;
};

const CellMenu: FC<{ model: CellModel }> = ({ model }) => {
    const tv = useContext(DesignContext) === 'tv';
    const controlClass = 'pi' + (tv ? '' : ' focusable');
    const { item, get, download, toggle, menu, queue, releaseLabel } = model;
    return <span className='hmenu glassy'>
        {item && itemHelper.canMarkPlayed(item) && <span className={controlClass + ' itemAction'} data-action={ItemAction.None} role='button' tabIndex={tv ? -1 : 0} onKeyDown={activate}
            data-tip={item.UserData?.Played ? 'Watched' : 'Mark Played'} aria-label={item.UserData?.Played ? 'Watched' : 'Mark Played'} data-ds-action='played' aria-pressed={!!item.UserData?.Played} onClick={event => { void toggle(event, 'played'); }}><Icon name='check' /></span>}
        {item && itemHelper.canRate(item) && <span className={controlClass + ' itemAction'} data-action={ItemAction.None} role='button' tabIndex={tv ? -1 : 0} onKeyDown={activate}
            data-tip={item.UserData?.IsFavorite ? 'Favorite' : 'Add to Favorites'} aria-label={item.UserData?.IsFavorite ? 'Favorite' : 'Add to Favorites'} data-ds-action='favorite' aria-pressed={!!item.UserData?.IsFavorite} onClick={event => { void toggle(event, 'favorite'); }}><Icon name='heart' /></span>}
        {get && <span className={controlClass + ' itemAction'} data-action={ItemAction.None} role='button' tabIndex={tv ? -1 : 0} onKeyDown={activate} data-tip={releaseLabel} aria-label={releaseLabel} data-ds-action='get' onClick={download}><Icon name='cloud' /></span>}
        {(item || queue) && <span className={`${controlClass}${item ? ' itemAction' : ''}`} role='button' tabIndex={tv ? -1 : 0}
            onKeyDown={activate} data-tip='More' aria-label='More' data-action={item ? ItemAction.Menu : undefined} onClick={menu}><Icon name='more' /></span>}
    </span>;
};

const CellCaption: FC<{ model: CellModel }> = ({ model }) => {
    const { name, second, rating, item, entry } = model;
    return <div className='capt'>
        <div className='ln t'>{name}</div><div className='ln'>{second}{rating && <span className={'jfmod-cardRating' + (rating.stale ? ' jfmod-cardRating-stale' : '')}> · <RatingIcon rating={rating} />{cardRatingValue(rating)}</span>}</div>
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
    const { action, item, entry, get, empty, pending, noFile, shape, source, failedSource, setFailedSource, title, data, open, download, menu } = model;
    const fallback = fallbackIcon(item?.Type, shape);
    const discAvailable = noFile ? !!get : !!item && playbackManager.canPlay(item);
    const { flightMenu } = model;
    return <div className={`cell ${shape}${shape === 'c' ? '' : ' act'} focusable${item ? ' itemAction' : ''}`}
        {...data} data-action={item ? action : undefined} tabIndex={0} role='link' aria-label={title} aria-busy={pending || undefined}
        aria-disabled={pending || undefined} data-jfmod-entry-id={pending ? undefined : entry?.id}
        data-jfmod-empty={empty ? '' : undefined} data-jfmod-tmdb-id={entry?.tmdbId} data-jfmod-nofile={noFile ? '' : undefined}
        onClick={open} onKeyDown={activate} ref={flightMenu.ref} onMouseEnter={model.prepareRelease} onFocus={event => focusCell(event, model.prepareRelease)} onBlur={blurCell} onContextMenu={flightMenu.onContextMenu ?? menu}>
        <div className='tile'><span className='post'>
            {source && source !== failedSource ? <img src={source} loading='lazy' alt='' onError={() => setFailedSource(source)} /> :
                <Icon name={fallback} className='fallback' />}
            <CellMarks model={model} />
            {shape !== 'c' && discAvailable && <span
                className='disc hov glassy itemAction' role='button' tabIndex={-1}
                data-action={noFile ? ItemAction.None : ItemAction.Play} aria-label={noFile ? 'Get a Release' : 'Play'} data-ds-action={noFile ? 'get' : undefined}
                onKeyDown={activate} onClick={noFile ? download : undefined}>{noFile ? <Cloud /> : <Icon name='play' />}</span>}
            {shape !== 'c' && <CellMenu model={model} />}
        </span><CellCaption model={model} /></div>
    </div>;
};
