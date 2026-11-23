import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client';
import { useQuery } from '@tanstack/react-query';
import { useApi } from 'hooks/useApi';
import React, { type FC, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { appHost } from 'components/apphost';
import globalize from 'lib/globalize';
import layoutManager from 'components/layoutManager';
import { AppFeature } from 'constants/appFeature';
import ResizeObserver from 'resize-observer-polyfill';
import { hasRatedLink } from '../utils/ratingLinks';
import focusManager from 'components/focusManager';
import inputManager from 'scripts/inputManager';
import { useTogglePlayedMutation } from 'apps/modern/features/libraries/hooks/api/useTogglePlayed';
import { EventType } from 'constants/eventType';
import Events from 'utils/events';
import { Head } from './Head';
import { watchedLabel, watchedDate } from '../utils/watched';
import RatingIcon from '../components/RatingIcon';
import { Root, DesignContext, quietLook } from './Root';
import { Icon, Cloud, Clock } from './Icon';
import { Poster } from './Poster';
import { DownloadMark } from './StateMark';
import { TitleRow as Section } from './TitleRow';
import { TrackField, ChooseRow } from './TrackField';
import { readTitle, runTitleCommand, type TitleCard, type TitleCommand, type InlinePart, type TitleTrack } from './titleModel';
import { DesignMediaMarks, QuietTrack, videoQuiet } from './MediaMarks';
import { findSource, linesOfSize, streamMarks } from '../constants/versions';
import { getLanguageNames, getMediaSources } from '../api/modApi';
import { TrackLanguage, TrackText } from '../components/TrackDropdown';
import { formatBytes } from '../constants/queue';
import { rememberCommandOpener } from '../integration/commandOpener';
import { deviceMediaSource } from '../integration/deviceSource';
import { usePlayedAction, type PlayedItem } from '../hooks/usePlayedAction';
import { useSeriesEpisodes, SeriesMainButton, EpisodeStrip, GuestStars, PlayFill, playLine, type SeriesModel } from './SeriesEpisodes';
import { About, Credits, FactsLine, useFlowWindow, useNarrowComputer, useFitLines, type AboutFile } from './TitleAbout';

const slots = new WeakMap<HTMLElement, Map<string, HTMLDivElement>>();
/** Keep controller portals and their focus/state alive when head changes structure on a layout switch. */
const Slot: FC<{ view: HTMLElement; name: string; className?: string }> = ({ view, name, className }) => {
    let own = slots.get(view);
    if (!own) {
        own = new Map();
        slots.set(view, own);
    }
    let node = own.get(name);
    if (!node) {
        node = document.createElement('div');
        node.dataset.dsSlot = name;
        own.set(name, node);
    }
    const target = node;
    return <div className={className} ref={host => {
        if (!host || target.parentElement === host) return;
        const old = target.closest('.meta');
        const next = host.closest('.meta');
        if (old && next) for (const cls of ['jfmod-ratings-hideStar', 'jfmod-ratings-hideCritic']) next.classList.toggle(cls, old.classList.contains(cls));
        host.appendChild(target);
    }} />;
};

const Inline: FC<{ parts: InlinePart[]; underline?: boolean }> = ({ parts, underline }) => <>{parts.map(part => part.href || part.command ?
    <a key={part.key} className='focusable' href={part.href || '#'} target={part.target} rel={part.target === '_blank' ? 'noreferrer' : undefined}
        onClick={event => {
            if (part.command) {
                event.preventDefault();
                part.command.click();
            }
        }}>{underline ? <u>{part.text}</u> : part.text}</a> : <React.Fragment key={part.key}>{part.text}</React.Fragment>)}</>;

/** ds.js's `Genres: <b>Comedy</b>`: the label is the source's first part when it ends in a colon. */
const Labelled: FC<{ parts: InlinePart[]; label?: string }> = ({ parts, label }) => {
    const labelled = parts[0]?.text.endsWith(': ');
    return <>{(labelled || label) && <span className='jfmod-titleFactLabel'>{labelled ? parts[0].text.replace(/: $/, '') : label}</span>}<b><Inline parts={labelled ? parts.slice(1) : parts} /></b></>;
};

/**
 * Phone and tablet cut a long text at `lines` lines with "more" at the end of the last one, and "less" after it in full (the user,
 * 2026-11-10: the description at 3 lines, Tags at 1). A text that fits gets neither. With `computer` a computer cuts it too (ds.t20:
 * Tags on every title page, a series' description); the TV shows it whole.
 */
const Clamp: FC<{ lines: number; className?: string; computer?: boolean; children: React.ReactElement }> = ({ lines, className, computer, children }) => {
    const device = useContext(DesignContext);
    const clamps = device === 'phone' || device === 'tablet' || (!!computer && (device === 'computer' || device === 'tv'));
    const text = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [cut, setCut] = useState(false);
    useLayoutEffect(() => {
        const node = text.current;
        if (!clamps || open || !node) return;
        const measure = () => setCut(node.scrollHeight > node.clientHeight + 1);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(node);
        return () => observer.disconnect();
    }, [clamps, open, children]);
    // An open text folds again when the window's width or its words change (a rotated tablet, new metadata), so it is measured
    // afresh and a text that now fits loses "less" too (Codex review of ds.t14, P3). The window's width, not the text's, so the
    // page scrollbar that opening may bring does not fold it straight back.
    useLayoutEffect(() => {
        const node = text.current;
        if (!open || !node) return;
        const width = window.innerWidth;
        const fold = () => setOpen(false);
        const resize = () => {
            if (window.innerWidth !== width) fold();
        };
        const words = new MutationObserver(fold);
        window.addEventListener('resize', resize);
        words.observe(node, { childList: true, subtree: true, characterData: true });
        return () => {
            window.removeEventListener('resize', resize);
            words.disconnect();
        };
    }, [open]);
    if (!clamps) return children;
    // On the TV "more" marks the cut but is no D-pad stop (round 6c; the user, 2026-11-17).
    const toggle = <button type='button' className={'jfmod-more' + (device === 'tv' ? '' : ' focusable')} tabIndex={device === 'tv' ? -1 : 0} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'less' : 'more'}</button>;
    return <div className={'jfmod-clamp' + (open ? ' open' : '') + (className ? ' ' + className : '')} style={{ '--jfmod-lines': lines } as React.CSSProperties}>
        <div ref={text} className='jfmod-clampText'>{!open && cut && toggle}{children}{open && toggle}</div></div>;
};

const commandClass = (command: TitleCommand) => command.play ? 'play' : 'dbtn';

/** Download, then More, at the pill's end; every other command keeps its order (Array.prototype.sort is stable). */
const rankLast = (command: TitleCommand) => ({ cloud: 1, more: 2 } as Record<string, number>)[command.icon] ?? 0;
/** Cast, then Guest Stars, then the rest, More Like This last (the user, 2026-11-07, ds.t14). */
const sectionRank = (key: string) => {
    if (/guestCast/i.test(key)) return 1;
    if (/cast/i.test(key)) return 0;
    if (/similar/i.test(key)) return 3;
    return 2;
};
const isSeasonCard = (card: TitleCard) => card.attributes['data-type'] === 'Season' || 'data-jfmod-season' in card.attributes;
/** The cast row lists actors only (the user, 2026-11-07); a row with no typed actors keeps every card. */
const castCards = (cards: TitleCard[]) => {
    const actors = cards.filter(card => card.attributes['data-type'] === 'Actor');
    return actors.length ? actors : cards;
};
type Sections = ReturnType<typeof readTitle>['sections'];
const footSections = (sections: Sections, seriesMain: boolean, type: string) => sections.filter(section => !(seriesMain && section.cards.some(isSeasonCard)))
    .map(section => (sectionRank(section.key) === 0 && type !== 'Person' ? { ...section, cards: castCards(section.cards) } : section))
    .sort((a, b) => sectionRank(a.key) - sectionRank(b.key));
const pillCommands = (commands: TitleCommand[], seriesMain: boolean, seriesPlay: boolean, downloadKind?: string) => commands.filter(command => (seriesMain ?
    !command.play && (command.icon !== 'cloud' || seriesPlay) : command.icon !== 'cloud' || downloadKind !== 'unaired'));
const factClass = (fact: { badge: boolean; star: boolean; critic: boolean }) => {
    if (fact.badge) return 'badge';
    if (fact.star) return 'star';
    if (fact.critic) return 'critic';
    return undefined;
};

const useTitleCommand = (view: HTMLElement, item?: PlayedItem) => {
    const runPlayed = usePlayedAction();
    const played = useTogglePlayedMutation();
    return (command: TitleCommand, opener: HTMLElement) => {
        if (command.disabled) return;
        const host = command.node.closest<HTMLElement>('[data-id][data-type]');
        const target = item || { Id: host?.dataset.id, Type: host?.dataset.type };
        const run = () => {
            if (command.node.isConnected && opener.isConnected) runTitleCommand(view, command, opener);
        };
        if (command.icon === 'check') {
            const itemId = target.Id;
            const isPlayed = !!command.pressed;
            void runPlayed({ ...target, UserData: { Played: isPlayed } }, async () => {
                if (!itemId || !command.node.isConnected || !opener.isConnected) return;
                const state = await played.mutateAsync({ itemId, isPlayed });
                // Native header controls own their state; card controls refresh through their query keys.
                const button = command.node as HTMLElement & { setItem?: (value: PlayedItem & { ServerId?: string }) => void };
                button.setItem?.({ Id: itemId, ServerId: button.dataset.serverid,
                    Type: target.Type, UserData: { Played: state } });
                Events.trigger(document, EventType.REFRESH_NEEDED);
            }).catch(console.error);
        } else {
            run();
        }
    };
};

// Play never says Resume (the user, 2026-11-17/18); the controller's command still resumes a started item.
const commandLabel = (command: TitleCommand, item?: BaseItemDto) => {
    if (command.icon === 'check') return watchedLabel({ ...item?.UserData, Played: command.pressed });
    return command.play ? 'Play' : command.label;
};

/**
 * A movie's Play on a computer (ds.t20, option E): Play over `Ends 11:00 PM` (part-way `52m left · Ends 9:36 PM`), the
 * button filled to the position while part-way. The item's own position and runtime, as the controller's Play resumes it.
 */
const MoviePlayLabel: FC<{ item: BaseItemDto }> = ({ item }) => {
    const position = !item.UserData?.Played ? item.UserData?.PlaybackPositionTicks ?? 0 : 0;
    const percent = position && item.RunTimeTicks ? 100 * position / item.RunTimeTicks : undefined;
    const line = playLine(item.RunTimeTicks, position, false);
    // "Play" in both states (the user, 2026-11-17): the small line says the time left; playback still resumes.
    const label = <><Icon name='play' /><span className='epc'><b>Play</b>{line && <span className='sm f'>{line}</span>}</span></>;
    return <>{label}<PlayFill percent={percent}>{label}</PlayFill></>;
};

const MoviePlay: FC<{ view: HTMLElement; command: TitleCommand; item: BaseItemDto }> = ({ view, command, item }) => {
    const run = useTitleCommand(view, item);
    return <button type='button' className='play epb jfmod-playE focusable' aria-label='Play' data-ds-command={command.node.className}
        onClick={event => run(command, event.currentTarget)}
        onFocus={event => event.currentTarget.classList.add('focus')} onBlur={event => event.currentTarget.classList.remove('focus')}><MoviePlayLabel item={item} /></button>;
};

const Command: FC<{ view: HTMLElement; command: TitleCommand; row?: boolean; item?: BaseItemDto; download?: boolean }> = ({ view, command, row, item, download }) => {
    const run = useTitleCommand(view, item);
    const label = commandLabel(command, item);
    let kind = row ? 'ib' : commandClass(command);
    if (download) kind = 'play mainb';
    let tip = command.badge?.title ?? label;
    if (command.icon === 'check') tip = label;
    return <button type='button'
        className={kind + ' focusable' + (command.pressed ? ' on' : '') + (command.disabled ? ' off' : '')}
        data-tip={command.play || download ? undefined : tip} aria-label={label}
        data-ds-watched={command.icon === 'check' && !item ? '' : undefined} data-id={item?.Id} data-type={item?.Type} aria-pressed={['check', 'heart'].includes(command.icon) ? command.pressed : undefined}
        data-ds-state-kind={row && command.icon === 'cloud' ? 'not-downloaded' : undefined} aria-disabled={command.disabled} data-ds-command={command.node.className} onClick={event => run(command, event.currentTarget)}
        onFocus={event => event.currentTarget.classList.add('focus')} onBlur={event => event.currentTarget.classList.remove('focus')}>
        {(row || download) && command.icon === 'cloud' ? <Cloud /> : <Icon name={command.icon} />}{(command.play || download) && label}
        {command.badge && <span className={'tickb' + (command.badge.kept ? ' kept' : '')}>{command.badge.text}</span>}
    </button>;
};

const openCard = (card: TitleCard) => {
    const action = card.node.matches('button, .itemAction') ? card.node : card.node.querySelector<HTMLElement>('.cardImageContainer.itemAction, .listItemBody .itemAction, .jfmod-missingRowLink');
    if (action) action.click();
    else if (card.href) window.location.hash = card.href;
    else card.node.click();
};
const primaryAction = (command?: TitleCommand) => {
    if (command?.icon === 'cloud') return 'get';
    if (command?.icon === 'play') return 'play';
    return 'open';
};

const posterActionIcon = (primary: TitleCommand | undefined, mark: TitleCard['mark']) => primary?.icon === 'cloud' || mark?.kind === 'not-downloaded' ? <Cloud /> : <Icon name={primary?.icon ?? 'play'} />;

const TrackValue: FC<{ option?: TitleTrack['options'][number]; closed?: boolean }> = ({ option, closed }) => {
    const device = useContext(DesignContext);
    if (quietLook(device)) {
        const video = option?.video ? videoQuiet(streamMarks(option.video)) : { lockup: null, details: [] };
        const size = option?.size ? formatBytes(option.size) : null;
        // A chooser row's size stands at its right edge (design A, the user 2026-11-23).
        return <QuietTrack name={<span className='r'>{option?.text}</span>} lockup={video.lockup} row={!closed}
            details={closed ? [...video.details, size] : video.details} size={closed ? null : size} />;
    }
    return <>
        <span className='r'>{option?.text}</span>
        {option?.video && <span className='marks'><DesignMediaMarks parsed={streamMarks(option.video)} /></span>}
        {!!option?.size && <span className={closed ? 'size2' : 'sz2'}>{formatBytes(option.size)}</span>}
    </>;
};

/** The selected episode's files, the one shown (chosen, else the one Play would start) and how to choose another. */
const useEpisodeSource = (series: SeriesModel) => {
    const { api, user } = useApi();
    const episode = series.selected;
    const itemId = episode?.hasFile ? episode.item?.Id ?? '' : '';
    const userId = user?.Id ?? '';
    const { data: sources, isPlaceholderData } = useQuery({
        queryKey: ['JellyfinMod', api?.basePath, userId, 'MediaSources', itemId],
        queryFn: ({ signal }) => getMediaSources(api!, userId, itemId, { signal }),
        // Keep the strip in place while another episode's sources load, within the same server and user only.
        placeholderData: (previous, previousQuery) => previousQuery?.queryKey[1] === api?.basePath
            && previousQuery?.queryKey[2] === userId ? previous : undefined,
        enabled: !!api && !!userId && !!itemId, staleTime: 2000, retry: false
    });
    const names = useLanguageNames();
    if (!episode || !itemId || !sources?.length) return { episode, itemId, names };
    const chosen = series.tracks?.key === episode.key ? series.tracks : { key: episode.key };
    // A track choice names its file too, so Play starts the file whose streams were shown.
    const set = (next: Omit<typeof chosen, 'key'>) => {
        if (!isPlaceholderData) series.setTracks({ ...chosen, ...next, key: episode.key });
    };
    // The file Play would start unless one is chosen (Codex review of ds.t19, P2): the device's copy, as `useSeriesEpisodes` plays it.
    const resume = episode.progress ? episode.item?.UserData?.PlaybackPositionTicks ?? 0 : 0;
    const source = findSource(sources, chosen.source) ?? deviceMediaSource(sources, null, { startPosition: resume }) ?? sources[0];
    return { episode, itemId, names, sources, source, chosen, set, isPlaceholderData };
};

const useLanguageNames = () => {
    const { api } = useApi();
    return useQuery({
        queryKey: ['JellyfinMod', api?.basePath, 'LanguageNames'],
        queryFn: ({ signal }) => getLanguageNames(api!, { signal }),
        enabled: !!api, staleTime: Infinity, retry: false
    }).data;
};

/**
 * The selected episode's Video, Audio and Subtitles on a series page (ds.t19; phone, tablet and TV too, the user, 2026-11-10): the
 * title page's controls and chooser over the episode's own media sources; Play sends the choices (`useSeriesEpisodes`).
 */
const EpisodeTrackFields: FC<{ series: SeriesModel }> = ({ series }) => {
    const device = useContext(DesignContext);
    const { itemId, names, sources, source, chosen, set, isPlaceholderData } = useEpisodeSource(series);
    // The quiet controls never stack, on any layout (2026-11-18).
    const stacked = false;
    // An episode with no file keeps the controls' room on a series with files, so a selection never moves the row or Cast (7d).
    if (!sources || !source || !chosen || !set) {
        // Only the computer's and the TV's fitted first screen need it; a phone or tablet leaves no gap (the user, 2026-11-23).
        const keep = (device === 'computer' || device === 'tv') && series.episodes.some(candidate => candidate.hasFile);
        return keep ? <div className='gpk jfmod-gpkEmpty' aria-hidden='true'><span className='seg'>&nbsp;</span></div> : null;
    }
    const streams = source.MediaStreams ?? [];
    const audios = streams.filter(stream => stream.Type === 'Audio');
    const subtitles = streams.filter(stream => stream.Type === 'Subtitle');
    const audio = chosen.audio ?? source.DefaultAudioStreamIndex ?? audios[0]?.Index;
    const subtitle = chosen.subtitle ?? source.DefaultSubtitleStreamIndex ?? -1;
    const option = (candidate: typeof source, index: number) => {
        const video = candidate.MediaStreams?.find(stream => stream.Type === 'Video');
        const lines = video && linesOfSize(video.Width, video.Height);
        return { value: candidate.Id ?? '', text: lines ? lines + 'p' : 'Video ' + (index + 1), video, size: candidate.Size };
    };
    const current = audios.find(stream => stream.Index === audio);
    const subtitleNow = subtitles.find(stream => stream.Index === subtitle);
    // A new episode closes the old chooser; its retained controls cannot change the new episode while loading.
    return <div key={itemId} className='gpk' aria-busy={isPlaceholderData} ref={node => node?.toggleAttribute('inert', isPlaceholderData)}>
        <TrackField kind='v' name='Video' value={<TrackValue closed option={option(source, sources.indexOf(source))} />}
            enabled={sources.length > 1}
            stacked={stacked}>
            {sources.map((candidate, index) => <ChooseRow key={candidate.Id} sourceId={candidate.Id ?? undefined} selected={candidate === source}
                onChoose={() => set({ source: candidate.Id ?? undefined, audio: undefined, subtitle: undefined })}><TrackValue option={option(candidate, index)} /></ChooseRow>)}
        </TrackField>
        <TrackField kind='a' name='Audio' enabled={audios.length > 1} stacked={stacked} title={current?.DisplayTitle ?? undefined}
            value={current ? <TrackText stream={current} names={names} closed /> : <TrackLanguage language='None' />}
            quietValue={current ? undefined : <TrackLanguage language='No Audio' />}>
            {audios.map(stream => <ChooseRow key={stream.Index} trackValue={String(stream.Index)} selected={stream === current} title={stream.DisplayTitle ?? undefined}
                onChoose={() => set({ source: source.Id ?? undefined, audio: stream.Index })}><TrackText stream={stream} names={names} /></ChooseRow>)}
        </TrackField>
        <TrackField kind='s' name='Subtitles' enabled={subtitles.length > 0} stacked={stacked} title={subtitleNow?.DisplayTitle ?? undefined}
            value={subtitleNow ? <TrackText stream={subtitleNow} names={names} closed /> : <TrackLanguage language={subtitles.length ? 'Off' : 'None'} />}
            quietValue={subtitleNow ? undefined : <TrackLanguage language={subtitles.length ? 'Subtitles Off' : 'No Subtitles'} />}>
            <ChooseRow trackValue='-1' selected={!subtitleNow} onChoose={() => set({ source: source.Id ?? undefined, subtitle: -1 })}><TrackLanguage language='Off' /></ChooseRow>
            {subtitles.map(stream => <ChooseRow key={stream.Index} trackValue={String(stream.Index)} selected={stream === subtitleNow} title={stream.DisplayTitle ?? undefined}
                onChoose={() => set({ source: source.Id ?? undefined, subtitle: stream.Index })}><TrackText stream={stream} names={names} /></ChooseRow>)}
        </TrackField>
    </div>;
};

/** The source cell's disc and foot pill, forwarding the original card commands. */
const PosterActions: FC<{ card: TitleCard; view: HTMLElement }> = ({ card, view }) => {
    const device = useContext(DesignContext);
    const run = useTitleCommand(view, { Id: card.node.dataset.id, Type: card.node.dataset.type, Name: card.title });
    const primary = card.commands.find(command => ['play', 'cloud'].includes(command.icon));
    const playCommand = !card.node.matches('[data-jfmod-placeholder], [data-jfmod-nofile], [data-jfmod-empty]') && !!card.node.dataset.id
        && ['Movie', 'Series', 'Season', 'Episode'].includes(card.node.dataset.type ?? '');
    // Watched, Favourite, More (the user, 2026-11-07): Play and Download stay on the disc, and Download is in More's menu.
    const pillOrder = ['check', 'heart'];
    const pillRank = (command: TitleCommand) => {
        const rank = pillOrder.indexOf(command.icon);
        return rank < 0 ? pillOrder.length : rank;
    };
    const menuCommands = card.commands.filter(command => command !== primary && command.icon !== 'cloud').sort((a, b) => pillRank(a) - pillRank(b));
    return <>
        {(primary || playCommand) && <button type='button' className={'disc hov glassy' + (device === 'tv' ? '' : ' focusable')} tabIndex={device === 'tv' ? -1 : 0} data-ds-primary-action={primary ? primaryAction(primary) : 'play'} aria-label={primary?.label || 'Play ' + card.title} onClick={event => {
            event.stopPropagation();
            if (primary) run(primary, event.currentTarget);
            // The same existing shortcut command as a remote's Play key, on the original command host.
            else card.node.dispatchEvent(new CustomEvent('command', { bubbles: true, cancelable: true, detail: { command: 'play' } }));
        }}>{posterActionIcon(primary, card.mark)}</button>}
        {menuCommands.length > 0 && <span className='hmenu glassy jfmod-cardActions'>{menuCommands.map(command => <button type='button' key={command.key} className={'pi' + (device === 'tv' ? '' : ' focusable')} tabIndex={device === 'tv' ? -1 : 0} data-tip={commandLabel(command)} aria-label={commandLabel(command)} data-ds-watched={command.icon === 'check' ? '' : undefined}
            data-ds-action={{ check: 'played', heart: 'favorite', cloud: 'get' }[command.icon as string]}
            aria-pressed={['check', 'heart'].includes(command.icon) ? command.pressed : undefined}
            onClick={event => {
                event.stopPropagation();
                run(command, event.currentTarget);
            }}><Icon name={command.icon} /></button>)}</span>}
    </>;
};

const cardState = (card: TitleCard) => {
    const mark = card.mark;
    if (!mark) return null;
    if (mark.kind === 'countdown') return <span className='num'>{mark.date}</span>;
    if (mark.kind === 'searching') return <Icon name='search' />;
    return <DownloadMark kind={mark.kind} progress={mark.progress} size={card.row ? 'row' : 'card'} link={mark.link} />;
};

const CardStill: FC<{ card: TitleCard }> = ({ card }) => <div className='still'><Poster src={card.image} icon='tv' className='stillimage' />
    {card.played && <span className='pill2 tick'><Icon name='check' /></span>}
    {card.downloadProgress && <span className='prog' data-ds-progress=''><i className='dl' style={{ width: card.downloadProgress }} /></span>}
    {card.progress && <span className='prog'><i style={{ width: card.progress }} /></span>}</div>;

const CardCorner: FC<{ card: TitleCard; state: React.ReactNode }> = ({ card, state }) => <span className='corner'>
    {card.played && <span className='pill2 tick'><Icon name='check' /></span>}
    {card.count && <span className='pill2'>{card.count}</span>}
    {state && <span className={'cmark glassy' + (['countdown', 'searching'].includes(card.mark?.kind ?? '') ? ' mark' : '') + (card.mark?.kind === 'unaired' ? ' pillm' : '')} data-ds-state-kind={card.mark?.kind} title={card.mark?.label}>{card.mark?.kind === 'unaired' ? <><Clock /><span>{card.mark.date}</span></> : state}</span>}
</span>;

/** ds.js season: a phone's row has no Played, and the state mark takes the heart's place. */
const phoneRowCommands = (card: TitleCard, marked: boolean) => {
    const hasState = marked || card.commands.some(command => command.icon === 'cloud');
    return card.commands.filter(command => command.icon !== 'check' && (command.icon !== 'heart' || !hasState));
};

const Card: FC<{ card: TitleCard; view: HTMLElement }> = ({ card, view }) => {
    const device = useContext(DesignContext);
    const [focus, setFocus] = useState(false);
    const host = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const painted = host.current;
        if (!painted) return;
        const forward = (event: Event) => {
            if (event.defaultPrevented) return;
            const source = event as CustomEvent;
            rememberCommandOpener(card.node, painted);
            const command = new CustomEvent('command', { bubbles: true, cancelable: true, detail: source.detail });
            if (!card.node.dispatchEvent(command)) event.preventDefault();
            // The hidden original has already offered the command to upstream's listeners.
            event.stopPropagation();
        };
        inputManager.on(painted, forward);
        return () => inputManager.off(painted, forward);
    }, [card.node]);
    const open = () => openCard(card);
    const still = <CardStill card={card} />;
    const name = <><div className='nm'>{card.title}</div><div className='ln2'>{card.facts.length ? card.facts.map(fact => <span key={fact.text} className={fact.figure?.className ?? (fact.star ? 'star' : undefined)} title={fact.figure?.title}>{fact.star && <Icon name='star' />}{fact.text}</span>) : <span>{card.second}</span>}</div></>;
    const overview = <p className='ov'>{card.overview}</p>;
    const state = cardState(card);
    // A failure takes Download's place on the row: the bang is an indicator, never both (download-state-mark.md).
    const failedRow = card.mark?.kind === 'failed';
    const commands = failedRow ? card.commands.filter(command => command.icon !== 'cloud') : card.commands;
    const rowCommands = device === 'phone' ? phoneRowCommands({ ...card, commands }, !!state) : commands;
    const actions = <div className='acts'>{state && (failedRow || !card.commands.some(command => command.icon === 'cloud')) && <span className='ib' data-ds-state-kind={card.mark?.kind} data-tip={card.mark?.label} aria-label={card.mark?.label}>{state}</span>}{rowCommands.map(command => <Command key={command.key} command={command} view={view} row />)}</div>;
    const prepare = () => card.node.dispatchEvent(new Event('pointerover', { bubbles: true }));
    const attributes = { ref: host, tabIndex: 0, onMouseEnter: prepare, onFocus: () => {
        setFocus(true);
        prepare();
    }, onBlur: () => setFocus(false),
    onKeyDown: (event: React.KeyboardEvent) => { if (event.key === 'Enter' && event.target === event.currentTarget) open(); },
    onContextMenu: (event: React.MouseEvent) => {
        event.preventDefault();
        rememberCommandOpener(card.node, event.currentTarget as HTMLElement);
        card.node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    }, onClick: (event: React.MouseEvent) => {
        if ((event.target as Element).closest('button')) return;
        const play = card.row && (event.target as Element).closest('.still') && !card.node.hasAttribute('data-jfmod-placeholder') ? card.node.querySelector<HTMLElement>('.listItemImageButton') : null;
        if (play) play.click();
        else open();
    } };
    if (card.row) {
        return <div className={'ep focusable' + (focus ? ' focus' : '')} data-ds-source-classes={card.node.className} data-ds-href={card.href} {...card.attributes} {...attributes}>
            {device === 'phone' ? <><div className='top'>{still}<div className='body'>{name}</div>{actions}</div>{overview}</> :
                <>{still}<div className='body'>{name}{overview}</div>{actions}</>}
        </div>;
    }
    return <div className={'cell jfmod-posterCell focusable ' + card.shape + (card.shape !== 'c' ? ' act' : '') + (card.downloadProgress ? ' ds-downloading' : '') + (focus && device !== 'phone' ? ' focus' : '')} data-ds-source-classes={card.node.className} data-ds-href={card.href} {...card.attributes} {...attributes}>
        <div className='tile'><Poster src={card.image} icon={({ c: 'person', p: 'movie', w: 'tv' } as const)[card.shape]}>
            <CardCorner card={card} state={state} />
            {card.downloadProgress && <span className='prog' data-ds-progress=''><i className='dl' style={{ width: card.downloadProgress }} /></span>}
            {card.progress && <span className='prog'><i style={{ width: card.progress }} /></span>}
            {card.shape !== 'c' && <PosterActions card={card} view={view} />}
        </Poster><div className='capt'><div className='ln t'>{card.title}</div><div className='ln d' data-jfmod-count={card.captionCount ? '' : undefined}>{card.second}</div><div className='ln d' /></div>
        </div>
    </div>;
};

const TitleLinks: FC<{ view: HTMLElement; type: string; links: { label: string; href: string }[] }> = ({ view, type, links }) => {
    const device = useContext(DesignContext);
    const [ratedSources, setRatedSources] = useState<string[] | null>(null);
    useLayoutEffect(() => {
        const slot = view.querySelector('[data-ds-slot="ratings"]');
        const read = () => {
            const value = slot?.querySelector<HTMLElement>('[data-jfmod-rating-sources]')?.dataset.jfmodRatingSources;
            setRatedSources(value === undefined ? null : value.split(','));
        };
        const observer = new MutationObserver(read);
        if (slot) observer.observe(slot, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-jfmod-rating-sources'] });
        read();
        return () => observer.disconnect();
    }, [view]);
    if (device === 'tv' || layoutManager.tv || !appHost.supports(AppFeature.ExternalLinks)) return null;
    const waiting = !view.hasAttribute('data-jfmod-entry-no-ratings') && ratedSources === null && ['Movie', 'Series', 'Season', 'Episode'].includes(type);
    const shown = waiting ? [] : links.filter(link => !hasRatedLink(link.label, ratedSources ?? []));
    if (!waiting && !shown.length) return null;
    return <div className={'links' + (waiting ? ' jfmod-ratingLinksPending' : '')}>{shown.map((link, index) => <React.Fragment key={link.href}>
        {index > 0 && ', '}<a className='focusable' href={link.href} target='_blank' rel='noreferrer'><b>{link.label}</b></a></React.Fragment>)}</div>;
};

/** Studios, Writers and the other details, Genres, Tags (one line with "more" on a computer, phone and tablet) and the links. */
const TitleFacts: FC<{ view: HTMLElement; type: string; model: ReturnType<typeof readTitle> }> = ({ view, type, model }) => {
    // The TV shows every tag: its "more" is no remote stop (Codex review of 1cfb7e7fec, P2).
    const tv = useContext(DesignContext) === 'tv';
    return <div className='jfmod-titleFacts'>
        {model.details.filter(parts => parts.length).map(parts => <div className='tags' data-ds-detail='' key={parts.map(part => part.text).join('')}><Labelled parts={parts} /></div>)}
        {model.genres.length > 0 && <div className='tags'><Labelled parts={model.genres} label='Genres' /></div>}
        {model.tags.length > 0 && <div className='tags jfmod-titleTags'><Clamp lines={1} computer={!tv}><Labelled parts={model.tags} label='Tags' /></Clamp></div>}
        <TitleLinks view={view} type={type} links={model.links} />
    </div>;
};

type TitleModel = ReturnType<typeof readTitle>;

/**
 * The reading text. On a computer's series and movie pages (ds.t20) the description is cut at 3 lines with "more" (below 1440 px
 * wide at 2, with no tagline) and the credits follow it; the facts move to About at the foot.
 */
const TitleReading: FC<{ view: HTMLElement; type: string; model: TitleModel; item?: BaseItemDto; redesign: boolean }> = ({ view, type, model, item, redesign }) => {
    const tv = useContext(DesignContext) === 'tv';
    const narrow = useNarrowComputer() && !tv;
    const flow = useFlowWindow() && !tv;
    const tagline = model.tagline && !(redesign && narrow);
    const overview = useRef<HTMLDivElement>(null);
    // The TV cuts the description at 2 lines (round 6c) and keeps its tagline; round 7d's fit cuts further on a series page,
    // except in a window narrower than 4:3, where the page flows.
    const lines = useFitLines(redesign && (narrow || tv) ? 2 : 3, overview, redesign && !flow && type === 'Series' && model.overview.length > 0);
    return <div className='jfmod-titleReading'>
        {model.originalTitle && <div className='tags'>{model.originalTitle}</div>}
        <div className='jfmod-titleText'>{tagline && <p className='jfmod-tagline'>{model.tagline}</p>}{model.overview.length > 0 && <div ref={overview} className='overview'>
            <Clamp lines={lines} computer={redesign}><p data-ds-overview=''><Inline parts={model.overview} /></p></Clamp></div>}</div>
        {redesign && item ? <Credits item={item} byWords={model.byWords} by={model.by.length > 0 && (tv ? model.by.map(part => part.text).join('') : <Inline parts={model.by} />)} /> :
            <TitleFacts view={view} type={type} model={model} />}
    </div>;
};

/** About's title facts: Created by or Directed by, the details (Writers, Studios, …), every genre, the age rating and every tag. */
const aboutFacts = (model: TitleModel, item: BaseItemDto) => {
    const facts: { label: string; value: React.ReactNode }[] = [];
    if (model.by.length) facts.push({ label: model.byWords || (item.Type === 'Series' ? 'Created by' : 'Directed by'), value: <Inline parts={model.by} /> });
    for (const parts of model.details) {
        const labelled = parts[0]?.text.endsWith(': ');
        const label = parts[0]?.text.replace(/: $/, '');
        if (labelled && label !== globalize.translate('Genres')) facts.push({ label, value: <Inline parts={parts.slice(1)} /> });
    }
    if (item.Genres?.length) facts.push({ label: 'Genres', value: item.Genres.join(', ') });
    if (item.OfficialRating) facts.push({ label: 'Age rating', value: item.OfficialRating });
    if (model.tags.length) facts.push({ label: 'Tags', value: <Inline parts={model.tags[0]?.text.endsWith(': ') ? model.tags.slice(1) : model.tags} /> });
    return facts;
};

/** The selected file for About: a movie's Video control, or the series' selected episode and its chosen file. */
const MovieAbout: FC<{ view: HTMLElement; model: TitleModel; item: BaseItemDto }> = ({ view, model, item }) => {
    const names = useLanguageNames();
    // The controller's own file select, which the head's Video control drives (TrackDropdown): About reads and sets it the same way.
    const select = view.querySelector<HTMLSelectElement>('.selectSource');
    const file: AboutFile = { sources: item.MediaSources ?? [], selected: select?.value ?? model.tracks.find(track => track.kind === 'v')?.value, names, onSelect: source => {
        if (!select || !source.Id || select.value === source.Id) return;
        select.value = source.Id;
        select.dispatchEvent(new Event('change', { bubbles: false, cancelable: true }));
    } };
    return <About title={model.title} facts={aboutFacts(model, item)} links={<TitleLinks view={view} type={item.Type ?? ''} links={model.links} />} file={file} />;
};

const SeriesAbout: FC<{ view: HTMLElement; model: TitleModel; item: BaseItemDto; series: SeriesModel }> = ({ view, model, item, series }) => {
    const { episode, names, sources, source, set } = useEpisodeSource(series);
    const file: AboutFile = { sources: sources ?? [], selected: source?.Id ?? undefined, names,
        episode: episode && `S${episode.season}:E${episode.number ?? ''} · ${episode.title}`,
        onSelect: next => set?.({ source: next.Id ?? undefined, audio: undefined, subtitle: undefined }) };
    return <About title={model.title} facts={aboutFacts(model, item)} links={<TitleLinks view={view} type='Series' links={model.links} />} file={file} />;
};

/**
 * Round 7d (the user, 2026-11-17): the first screen is the hero and, on a series, the episode row; the hero grows to fill what the
 * row leaves, so the row's foot sits Bφ² above the screen's foot and Cast starts at the fold (titleTop.scss, `jfmod-screen1`).
 */
const Screen1: FC<{ redesign: boolean; series: SeriesModel; children: React.ReactElement }> = ({ redesign, series, children }) => (redesign ?
    <div className={'jfmod-screen1' + (series.active ? ' jfmod-screenRow' : '')}>{children}{series.active && <EpisodeStrip series={series} />}</div> : children);

/** The page root's classes: the golden title head, ds.t20's redesign, and a movie's (top-aligned) hero. */
const rootClass = (titleTop: boolean, redesign: boolean, seriesMain: boolean) => {
    const names = titleTop ? ['jfmod-titleTop'] : [];
    if (redesign) names.push('jfmod-titleE');
    if (redesign && !seriesMain) names.push('jfmod-titleMovie');
    return names.join(' ') || undefined;
};

const AboutFoot: FC<{ view: HTMLElement; model: TitleModel; item: BaseItemDto; series: SeriesModel }> = ({ view, model, item, series }) => (series.active ?
    <SeriesAbout view={view} model={model} item={item} series={series} /> : <MovieAbout view={view} model={model} item={item} />);

/** The rows under the head: the series' episodes first, then Cast, Guest Stars (a series' selected episode's), the rest, More Like This. */
const FootRows: FC<{ view: HTMLElement; sections: Sections; series: SeriesModel; serverId?: string | null; strip: boolean }> = ({ view, sections, series, serverId, strip }) => {
    const guestsAfter = sections.filter(section => sectionRank(section.key) < 2).pop();
    const guests = series.active && <GuestStars series={series} serverId={serverId} />;
    return <>{strip && series.active && <EpisodeStrip series={series} />}{!guestsAfter && guests}
        {sections.map(section => <React.Fragment key={section.key}>{section.cards.some(card => card.row) ?
            <div className='eps plain' data-ds-section={section.key}>{section.cards.map(card => <Card key={card.key} card={card} view={view} />)}</div> :
            <Section title={sectionRank(section.key) === 0 ? 'Cast' : section.title} name={section.key}>{section.cards.map(card => <Card key={card.key} card={card} view={view} />)}</Section>}
        {section === guestsAfter && guests}</React.Fragment>)}</>;
};

/** The parents or credit line and the metadata under the title (every page but a computer's series and movie, ds.t20). */
const TitleLines: FC<{ view: HTMLElement; model: TitleModel; type: string; item?: BaseItemDto }> = ({ view, model, type, item }) => {
    let here = '';
    if (type === 'Season') here = model.title;
    else if (type === 'Episode' && item?.IndexNumber != null) here = 'Episode ' + item.IndexNumber;
    const watched = item?.UserData?.Played && watchedDate(item.UserData) ? watchedLabel(item.UserData) : null;
    return <>{model.parents.length > 0 && <div className='by'>{model.parents.map((parent, index) => <React.Fragment key={parent.href}>
        {index > 0 && ' › '}<a className='focusable' href={parent.href} onClick={event => {
            if (parent.command) {
                event.preventDefault();
                parent.command.click();
            }
        }}><u>{parent.label}</u></a></React.Fragment>)}{here && ' › ' + here}</div>}
    {!model.parents.length && model.by.length > 0 && <div className='by'><span className='jfmod-byLabel'>{model.byWords}</span> <Inline parts={model.by} underline /></div>}
    <div className='meta'>{type === 'Season' && item?.ProductionYear && <span>{item.ProductionYear}</span>}{type === 'Season' && !!item?.ChildCount && <span>{item.ChildCount} episodes</span>}
        {model.meta.filter(fact => !fact.endsAt).map(fact => <span key={fact.text} className={factClass(fact)}>
            {fact.star && <Icon name='star' />}{fact.critic && <RatingIcon className='rm rt' rating={{ source: 'tomatoes_critic', value: parseFloat(fact.text), scale: 'percent' }} />}{fact.parts.length ? <Inline parts={fact.parts} /> : fact.text}</span>)}
        {model.facts.map(fact => <span key={fact.text}>{fact.href ? <a href={fact.href} target='_blank' rel='noreferrer'>{fact.text}</a> : fact.text}</span>)}
        <Slot view={view} name='ratings' className='jfmod-metaRatings' />
        {type === 'Series' && !!item?.RecursiveItemCount && <span>{item.RecursiveItemCount} episodes · {item.ChildCount} seasons</span>}
        {model.meta.filter(fact => fact.endsAt).map(fact => <span key={fact.text} data-ds-endsat=''><Inline parts={fact.parts} /></span>)}
        {watched && <span className='jfmod-watchedMeta'><Icon name='check' />{watched}</span>}
    </div></>;
};

/**
 * Round 7d's D-pad path (the user, 2026-11-17), the keyboard's arrows on a computer and the remote on the TV: the Play row (Play
 * and the buttons beside it, Left and Right between them) → the track controls (Video always among them; Left and Right between
 * them, OK opens one) → the season pill → the row (selected episode) → Cast, Up retracing it to the control last focused in each. The row's own keys are `useTvKeys`. On a computer the app has no arrow navigation, so the
 * other arrows move the focus here as the TV's does; the mouse is untouched.
 */
const useDpad = (root: React.RefObject<HTMLDivElement>, on: boolean, tv: boolean) => {
    useEffect(() => {
        const node = root.current;
        if (!on || !node) return;
        let track: HTMLElement | null = null;
        let action: HTMLElement | null = null;
        const first = (selector: string) => Array.from(node.querySelectorAll<HTMLElement>(selector)).find(element => element.offsetParent !== null) ?? null;
        const selected = () => first('.jfmod-epRow .cell.sel') ?? first('.jfmod-epRow .cell[data-key]');
        const tracks = () => (track?.isConnected ? track : first('.gpk .seg.focusable'));
        const play = () => (action?.isConnected ? action : first('.actbar .play') ?? first('.actbar button'));
        const routes: Record<string, (element: HTMLElement) => HTMLElement | null> = {
            ArrowDown: element => {
                if (element.closest('.actbar')) return tracks() ?? first('.jfmod-epRow .spill') ?? selected();
                if (element.closest('.gpk')) return first('.jfmod-epRow .spill') ?? selected();
                if (element.closest('.jfmod-epRow .spill')) return selected();
                return null;
            },
            ArrowUp: element => {
                if (element.closest('.jfmod-epRow .spill')) return tracks() ?? play();
                if (element.closest('.gpk')) return play();
                return null;
            }
        };
        // The last track control and the last button of the Play row focused, so Up and Down return to them.
        const remember = (event: FocusEvent) => {
            const element = event.target as HTMLElement;
            const seg = element.closest<HTMLElement>('.gpk .seg');
            if (seg) track = seg;
            const button = element.closest<HTMLElement>('.jfmod-hero .actbar button');
            if (button) action = button;
        };
        // Left and Right along the Play row and the track controls, in their drawn order; at either end the focus stays.
        // Only the enabled, visible controls of the row the focus is in (Codex review of 1cfb7e7fec, P2).
        const along = (element: HTMLElement, step: number) => {
            const row = element.closest<HTMLElement>('.actbar, .gpk');
            const items = Array.from(row?.querySelectorAll<HTMLElement>(row.matches('.actbar') ? 'button.focusable' : '.seg.focusable') ?? [])
                .filter(item => item.offsetParent !== null && !item.matches(':disabled, .off'))
                .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
            const at = items.findIndex(item => item === element || item.contains(element));
            return at < 0 ? null : items[Math.max(0, Math.min(items.length - 1, at + step))];
        };
        const key = (event: KeyboardEvent) => {
            const element = event.target as HTMLElement;
            // An open track list walks its own rows (TrackField `walkList`).
            if (!node.contains(element) || element.matches('input, textarea, select') || element.closest('.vlist') || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
            const sideways = (event.key === 'ArrowLeft' || event.key === 'ArrowRight') && element.closest('.actbar, .gpk');
            const step = event.key === 'ArrowRight' ? 1 : -1;
            const route = sideways ? along(element, step) : routes[event.key]?.(element);
            if (route) focusManager.focus(route);
            else if (tv || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) || element === document.body) return;
            else focusManager[({ ArrowLeft: 'moveLeft', ArrowRight: 'moveRight', ArrowUp: 'moveUp', ArrowDown: 'moveDown' } as const)[event.key as 'ArrowLeft']](element);
            event.preventDefault();
            event.stopPropagation();
        };
        node.addEventListener('focusin', remember);
        node.addEventListener('keydown', key);
        return () => {
            node.removeEventListener('focusin', remember);
            node.removeEventListener('keydown', key);
        };
    }, [root, on, tv]);
};

/** ds.js head/actbar/sect/season and ds2.js title pages. No controller-owned element is painted here. */
const Content: FC<{ view: HTMLElement; type: string; art: string; item?: BaseItemDto }> = ({ view, type: initialType, art: initialArt, item: initialItem }) => {
    const [environment, setEnvironment] = useState<{ type: string; art: string; item?: BaseItemDto }>({ type: initialType, art: initialArt, item: initialItem });
    const [model, setModel] = useState(() => readTitle(view));
    const ref = useRef<HTMLDivElement>(null);
    const focused = useRef(false);
    const device = useContext(DesignContext);
    useLayoutEffect(() => {
        const read = () => setModel(readTitle(view));
        const observer = new MutationObserver(read);
        const source = view.querySelector('.detailPageWrapperContainer');
        if (source) observer.observe(source, { childList: true, subtree: true, attributes: true, characterData: true });
        observer.observe(view, { attributes: true, attributeFilter: ['class', 'data-jfmod-placeholder', 'data-ds-tracks-mounted', 'data-jfmod-download-state'] });
        const update = (event: Event) => {
            setEnvironment((event as CustomEvent<{ type: string; art: string; item?: BaseItemDto }>).detail);
            read();
        };
        view.addEventListener('ds-title-update', update);
        view.addEventListener('change', read, true);
        read();
        return () => {
            observer.disconnect();
            view.removeEventListener('ds-title-update', update);
            view.removeEventListener('change', read, true);
        };
    }, [view]);
    useEffect(() => {
        // Download is mounted before the controller has revealed Play: wait for the controller's own buttons.
        if (device !== 'tv' || focused.current || !model.commands.some(command => ['check', 'heart'].includes(command.icon)) || !ref.current) return;
        if (document.activeElement && document.activeElement !== document.body && !view.contains(document.activeElement)) return;
        const first = ref.current.querySelector<HTMLElement>('.actbar .play, .actbar button');
        if (first) focusManager.focus(first);
        focused.current = true;
    }, [device, model.commands, view]);
    const item = environment.item;
    const series = useSeriesEpisodes(environment.type === 'Series' ? item : undefined);
    const seriesMain = series.active;
    // ds.t20: a computer's and the TV's series and movie pages take the redesigned head, episode row and About (REVIEW.md rounds 6 to 6c;
    // the TV's row below the head with the glide, the user 2026-11-17).
    const redesign = (device === 'computer' || device === 'tv') && !!item && (environment.type === 'Movie' || environment.type === 'Series');
    useDpad(ref, redesign, device === 'tv');
    // The hero's picture only from a real Backdrop, the item's own or inherited: upstream's helper falls back to the Primary image,
    // which the 16:9 box would crop; with none the whole poster stands in (Codex review of 1cfb7e7fec, P2).
    const heroArt = item?.BackdropImageTags?.length || item?.ParentBackdropImageTags?.length ? environment.art : undefined;
    const pageArt = environment.art || (environment.type === 'Person' ? model.image : undefined);
    const headArt = redesign ? heroArt : pageArt;
    const lines = redesign && item ? <FactsLine item={item}><Slot view={view} name='ratings' className='jfmod-metaRatings' /></FactsLine> :
        <TitleLines view={view} model={model} type={environment.type} item={item} />;
    const download = !seriesMain && !model.commands.some(command => command.play) && model.downloadKind === 'none';
    // A series page's main button follows the selected episode; Get Another Quality only beside Play (the user, 2026-11-07).
    const commands = pillCommands(model.commands, seriesMain, series.showsPlay, model.downloadKind);
    if (download) commands.sort((a, b) => Number(b.icon === 'cloud') - Number(a.icon === 'cloud'));
    // With something to play, Download gets another quality: the rarer action goes last, before More (the user, 2026-11-07).
    else commands.sort((a, b) => rankLast(a) - rankLast(b));
    const pill = commands.length > 0 && <div className={'actbar glassy focuscontainer-x' + (download || seriesMain || commands.some(command => command.play) ? '' : ' short')}>
        {seriesMain && <SeriesMainButton series={series} />}{commands.map(command => (redesign && item && command.play ? <MoviePlay key={command.key} view={view} command={command} item={item} /> :
            <Command key={command.key} view={view} command={command} item={item} download={download && command.icon === 'cloud'} />))}</div>;
    // A series' seasons are the slider's now: no season row (ds.t14).
    const sections = footSections(model.sections, seriesMain, environment.type);
    const reading = <TitleReading view={view} type={environment.type} model={model} item={item} redesign={redesign} />;
    // A person's page takes the golden title head and rows on a computer (ds.t15); phone, tablet and TV keep its old head.
    const titleTop = environment.type !== 'Person' || device === 'computer';
    return <div ref={ref} className={rootClass(titleTop, redesign, seriesMain)}>
        <Screen1 redesign={redesign} series={series}><Head titleTop={titleTop} title={model.title} poster={model.image} art={headArt} lines={lines} pill={pill} wide={environment.type === 'Episode'} icon={environment.type === 'Person' ? 'person' : undefined}
            hero={redesign} reading={redesign && reading}>
            <Slot view={view} name='notice' /><Slot view={view} name='tracks' />
            {seriesMain && <EpisodeTrackFields series={series} />}
            {model.tracks.length > 0 && <div className='gpk'>
                {model.tracks.map(track => <TrackField key={track.name} kind={track.kind} name={track.name}
                    value={<TrackValue closed option={track.options.find(option => option.value === track.value) ?? track.options[0]} />}
                    enabled={track.enabled && (track.options.length > 1 || (track.kind === 'v' && (device === 'computer' || device === 'tv')))} stacked={false}>
                    {track.options.map(option => <ChooseRow key={option.value} selected={option.value === track.value} onChoose={() => {
                        track.select.value = option.value;
                        track.select.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
                    }}><TrackValue option={option} /></ChooseRow>)}
                </TrackField>)}
            </div>}
            <Slot view={view} name='download' />
            {!redesign && reading}
            <Slot view={view} name='augment' />
        </Head></Screen1>
        <div className='plain titlefoot'><Slot view={view} name='sections' /><FootRows view={view} sections={sections} series={series} serverId={item?.ServerId} strip={!redesign} />
            {redesign && item && <AboutFoot view={view} model={model} item={item} series={series} />}</div>
    </div>;
};
export const TitlePage: FC<{ view: HTMLElement; type: string; art: string; item?: BaseItemDto }> = props => <Root tabletAsComputer><Content {...props} /></Root>;

export const clearTitleSlots = (view: HTMLElement) => slots.delete(view);
