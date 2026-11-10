import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client';
import { useQuery } from '@tanstack/react-query';
import { useApi } from 'hooks/useApi';
import React, { type FC, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { appHost } from 'components/apphost';
import layoutManager from 'components/layoutManager';
import { AppFeature } from 'constants/appFeature';
import { hasRatedLink } from '../utils/ratingLinks';
import focusManager from 'components/focusManager';
import inputManager from 'scripts/inputManager';
import { useTogglePlayedMutation } from 'hooks/useFetchItems';
import { EventType } from 'constants/eventType';
import Events from 'utils/events';
import { Head } from './Head';
import { watchedLabel, watchedDate } from '../utils/watched';
import RatingIcon from '../components/RatingIcon';
import { Root, DesignContext } from './Root';
import { Icon, Cloud, Clock } from './Icon';
import { Poster } from './Poster';
import { DownloadMark } from './StateMark';
import { TitleRow as Section } from './TitleRow';
import { TrackField, ChooseRow } from './TrackField';
import { useStacked } from './useStacked';
import { readTitle, runTitleCommand, type TitleCard, type TitleCommand, type InlinePart, type TitleTrack } from './titleModel';
import { DesignMediaMarks } from './MediaMarks';
import { findSource, linesOfSize, streamMarks } from '../constants/versions';
import { getLanguageNames, getMediaSources } from '../api/modApi';
import { TrackLanguage, TrackText } from '../components/TrackDropdown';
import { formatBytes } from '../constants/queue';
import { rememberCommandOpener } from '../integration/commandOpener';
import { usePlayedAction, type PlayedItem } from '../hooks/usePlayedAction';
import { useSeriesEpisodes, SeriesMainButton, EpisodeStrip, GuestStars, type SeriesModel } from './SeriesEpisodes';

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

const commandLabel = (command: TitleCommand, item?: BaseItemDto) => command.icon === 'check' ?
    watchedLabel({ ...item?.UserData, Played: command.pressed }) : command.label;

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

const TrackValue: FC<{ option?: TitleTrack['options'][number]; closed?: boolean }> = ({ option, closed }) => <>
    <span className='r'>{option?.text}</span>
    {option?.video && <span className='marks'><DesignMediaMarks parsed={streamMarks(option.video)} /></span>}
    {!!option?.size && <span className={closed ? 'size2' : 'sz2'}>{formatBytes(option.size)}</span>}
</>;

/**
 * The selected episode's Video, Audio and Subtitles on a computer's series page (ds.t19): the title page's quiet controls and
 * chooser over the episode's own media sources; Play sends the choices (`useSeriesEpisodes`). Phone, tablet and TV show none.
 */
const EpisodeTrackFields: FC<{ series: SeriesModel }> = ({ series }) => {
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
    const names = useQuery({
        queryKey: ['JellyfinMod', api?.basePath, 'LanguageNames'],
        queryFn: ({ signal }) => getLanguageNames(api!, { signal }),
        enabled: !!api, staleTime: Infinity, retry: false
    }).data;
    if (!episode || !itemId || !sources?.length) return null;
    const chosen = series.tracks?.key === episode.key ? series.tracks : { key: episode.key };
    const set = (next: Omit<typeof chosen, 'key'>) => {
        if (!isPlaceholderData) series.setTracks({ ...chosen, ...next, key: episode.key });
    };
    const source = findSource(sources, chosen.source) ?? sources[0];
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
    return <div key={itemId} className='gpk' aria-busy={isPlaceholderData}
        ref={node => node?.toggleAttribute('inert', isPlaceholderData)}>
        <TrackField kind='v' name='Video' value={<TrackValue closed option={option(source, sources.indexOf(source))} />} enabled={sources.length > 1}
            stacked={false}>
            {sources.map((candidate, index) => <ChooseRow key={candidate.Id} sourceId={candidate.Id ?? undefined} selected={candidate === source}
                onChoose={() => set({ source: candidate.Id ?? undefined, audio: undefined, subtitle: undefined })}><TrackValue option={option(candidate, index)} /></ChooseRow>)}
        </TrackField>
        <TrackField kind='a' name='Audio' enabled={audios.length > 1} stacked={false} title={current?.DisplayTitle ?? undefined}
            value={current ? <TrackText stream={current} names={names} /> : <TrackLanguage language='None' />}
            quietValue={current ? undefined : <TrackLanguage language='No Audio' />}>
            {audios.map(stream => <ChooseRow key={stream.Index} trackValue={String(stream.Index)} selected={stream === current} title={stream.DisplayTitle ?? undefined}
                onChoose={() => set({ audio: stream.Index })}><TrackText stream={stream} names={names} /></ChooseRow>)}
        </TrackField>
        <TrackField kind='s' name='Subtitles' enabled={subtitles.length > 0} stacked={false} title={subtitleNow?.DisplayTitle ?? undefined}
            value={subtitleNow ? <TrackText stream={subtitleNow} names={names} /> : <TrackLanguage language='Off' />}
            quietValue={subtitleNow ? undefined : <TrackLanguage language={subtitles.length ? 'Subtitles Off' : 'No Subtitles'} />}>
            <ChooseRow trackValue='-1' selected={!subtitleNow} onChoose={() => set({ subtitle: -1 })}><TrackLanguage language='Off' /></ChooseRow>
            {subtitles.map(stream => <ChooseRow key={stream.Index} trackValue={String(stream.Index)} selected={stream === subtitleNow} title={stream.DisplayTitle ?? undefined}
                onChoose={() => set({ subtitle: stream.Index })}><TrackText stream={stream} names={names} /></ChooseRow>)}
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

/** The rows under the head: the series' episodes first, then Cast, Guest Stars (a series' selected episode's), the rest, More Like This. */
const FootRows: FC<{ view: HTMLElement; sections: Sections; series: SeriesModel; serverId?: string | null }> = ({ view, sections, series, serverId }) => {
    const guestsAfter = sections.filter(section => sectionRank(section.key) < 2).pop();
    const guests = series.active && <GuestStars series={series} serverId={serverId} />;
    return <>{series.active && <EpisodeStrip series={series} />}{!guestsAfter && guests}
        {sections.map(section => <React.Fragment key={section.key}>{section.cards.some(card => card.row) ?
            <div className='eps plain' data-ds-section={section.key}>{section.cards.map(card => <Card key={card.key} card={card} view={view} />)}</div> :
            <Section title={sectionRank(section.key) === 0 ? 'Cast' : section.title} name={section.key}>{section.cards.map(card => <Card key={card.key} card={card} view={view} />)}</Section>}
        {section === guestsAfter && guests}</React.Fragment>)}</>;
};

/** ds.js head/actbar/sect/season and ds2.js title pages. No controller-owned element is painted here. */
const Content: FC<{ view: HTMLElement; type: string; art: string; item?: BaseItemDto }> = ({ view, type: initialType, art: initialArt, item: initialItem }) => {
    const [environment, setEnvironment] = useState<{ type: string; art: string; item?: BaseItemDto }>({ type: initialType, art: initialArt, item: initialItem });
    const [model, setModel] = useState(() => readTitle(view));
    const ref = useRef<HTMLDivElement>(null);
    const focused = useRef(false);
    const device = useContext(DesignContext);
    const stackRef = useRef<HTMLDivElement>(null);
    const stacked = useStacked(stackRef, device, model.tracks.length > 0);
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
    let here = '';
    if (environment.type === 'Season') here = model.title;
    else if (environment.type === 'Episode' && item?.IndexNumber != null) here = 'Episode ' + item.IndexNumber;
    const watched = item?.UserData?.Played && watchedDate(item.UserData) ? watchedLabel(item.UserData) : null;
    const lines = <>{model.parents.length > 0 && <div className='by'>{model.parents.map((parent, index) => <React.Fragment key={parent.href}>
        {index > 0 && ' › '}<a className='focusable' href={parent.href} onClick={event => {
            if (parent.command) {
                event.preventDefault();
                parent.command.click();
            }
        }}><u>{parent.label}</u></a></React.Fragment>)}{here && ' › ' + here}</div>}
    {!model.parents.length && model.by.length > 0 && <div className='by'><span className='jfmod-byLabel'>{model.byWords}</span> <Inline parts={model.by} underline /></div>}
    <div className='meta'>{environment.type === 'Season' && item?.ProductionYear && <span>{item.ProductionYear}</span>}{environment.type === 'Season' && !!item?.ChildCount && <span>{item.ChildCount} episodes</span>}
        {model.meta.filter(fact => !fact.endsAt).map(fact => <span key={fact.text} className={factClass(fact)}>
            {fact.star && <Icon name='star' />}{fact.critic && <RatingIcon className='rm rt' rating={{ source: 'tomatoes_critic', value: parseFloat(fact.text), scale: 'percent' }} />}{fact.parts.length ? <Inline parts={fact.parts} /> : fact.text}</span>)}
        {model.facts.map(fact => <span key={fact.text}>{fact.href ? <a href={fact.href} target='_blank' rel='noreferrer'>{fact.text}</a> : fact.text}</span>)}
        <Slot view={view} name='ratings' className='jfmod-metaRatings' />
        {environment.type === 'Series' && !!item?.RecursiveItemCount && <span>{item.RecursiveItemCount} episodes · {item.ChildCount} seasons</span>}
        {model.meta.filter(fact => fact.endsAt).map(fact => <span key={fact.text} data-ds-endsat=''><Inline parts={fact.parts} /></span>)}
        {watched && <span className='jfmod-watchedMeta'><Icon name='check' />{watched}</span>}
    </div></>;
    const download = !seriesMain && !model.commands.some(command => command.play) && model.downloadKind === 'none';
    // A series page's main button follows the selected episode; Get Another Quality only beside Play (the user, 2026-11-07).
    const commands = pillCommands(model.commands, seriesMain, series.showsPlay, model.downloadKind);
    if (download) commands.sort((a, b) => Number(b.icon === 'cloud') - Number(a.icon === 'cloud'));
    // With something to play, Download gets another quality: the rarer action goes last, before More (the user, 2026-11-07).
    else commands.sort((a, b) => rankLast(a) - rankLast(b));
    const pill = commands.length > 0 && <div className={'actbar glassy focuscontainer-x' + (download || seriesMain || commands.some(command => command.play) ? '' : ' short')}>
        {seriesMain && <SeriesMainButton series={series} />}{commands.map(command => <Command key={command.key} view={view} command={command} item={item} download={download && command.icon === 'cloud'} />)}</div>;
    // A series' seasons are the slider's now: no season row (ds.t14).
    const sections = footSections(model.sections, seriesMain, environment.type);
    // A person's page takes the golden title head and rows on a computer (ds.t15); phone, tablet and TV keep its old head.
    const titleTop = environment.type !== 'Person' || device === 'computer';
    return <div ref={ref} className={titleTop ? 'jfmod-titleTop' : undefined}>
        <Head titleTop={titleTop} title={model.title} poster={model.image} art={environment.art || (environment.type === 'Person' ? model.image : undefined)} lines={lines} pill={pill} wide={environment.type === 'Episode'} icon={environment.type === 'Person' ? 'person' : undefined}>
            <Slot view={view} name='notice' /><Slot view={view} name='tracks' />
            {seriesMain && device === 'computer' && <EpisodeTrackFields series={series} />}
            {model.tracks.length > 0 && <div ref={stackRef} className={'gpk' + (stacked ? ' stacked' : '')}>
                {model.tracks.map(track => <TrackField key={track.name} kind={track.kind} name={track.name}
                    value={<TrackValue closed option={track.options.find(option => option.value === track.value) ?? track.options[0]} />}
                    enabled={track.enabled && track.options.length > 1} stacked={stacked}>
                    {track.options.map(option => <ChooseRow key={option.value} selected={option.value === track.value} onChoose={() => {
                        track.select.value = option.value;
                        track.select.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
                    }}><TrackValue option={option} /></ChooseRow>)}
                </TrackField>)}
            </div>}
            <Slot view={view} name='download' />
            <div className='jfmod-titleReading'>
                {model.originalTitle && <div className='tags'>{model.originalTitle}</div>}
                <div className='jfmod-titleText'>{model.tagline && <p className='jfmod-tagline'>{model.tagline}</p>}{model.overview.length > 0 && <div className='overview'><p data-ds-overview=''><Inline parts={model.overview} /></p></div>}</div>
                <div className='jfmod-titleFacts'>
                    {model.details.filter(parts => parts.length).map(parts => <div className='tags' data-ds-detail='' key={parts.map(part => part.text).join('')}><Labelled parts={parts} /></div>)}
                    {model.genres.length > 0 && <div className='tags'><Labelled parts={model.genres} label='Genres' /></div>}
                    {model.tags.length > 0 && <div className='tags jfmod-titleTags'><Labelled parts={model.tags} label='Tags' /></div>}
                    <TitleLinks view={view} type={environment.type} links={model.links} />
                </div></div>
            <Slot view={view} name='augment' />
        </Head>
        <div className='plain titlefoot'><Slot view={view} name='sections' /><FootRows view={view} sections={sections} series={series} serverId={item?.ServerId} /></div>
    </div>;
};
export const TitlePage: FC<{ view: HTMLElement; type: string; art: string; item?: BaseItemDto }> = props => <Root><Content {...props} /></Root>;

export const clearTitleSlots = (view: HTMLElement) => slots.delete(view);
