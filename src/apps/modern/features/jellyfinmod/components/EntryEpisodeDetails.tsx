import type { Api } from '@jellyfin/sdk/lib/api';
import { getShowApi } from '@jellyfin/sdk/lib/utils/api/show-api';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useQuery } from '@tanstack/react-query';
import React, { type FC, type ReactNode, useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { getDefaultBackgroundClass, resolveCardCssClasses } from 'components/cardbuilder/utils/builder';
import focusManager from 'components/focusManager';
import layoutManager from 'components/layoutManager';
import LinkButton from 'elements/emby-button/LinkButton';
import globalize from 'lib/globalize';
import browser from 'scripts/browser';
import datetime from 'scripts/datetime';
import * as userSettings from 'scripts/settings/userSettings';

import { type EntryDetail, getEntry } from '../api/modApi';
import { openNativePage, useLiveEntryDetail } from '../hooks/useEntries';
import { RELEASES_CAPABILITY, usePluginCapabilities } from '../hooks/useAcquisition';
import { openReleasePicker, useEpisodeListLoad } from '../integration/releasePicker';
import { restoreFocusTo, useStockHeaderButton } from '../integration/stockHeaderButton';
import type { TmdbCrewCredit } from '../types/entry';
import { getEntryPath, getTmdbImage } from '../utils/entryLinks';
import type { FocusOwnership } from '../utils/focusOwnership';
import DownloadBlock from './DownloadBlock';
import { episodeMetaItems, seasonPath, useTmdbCover } from './MissingChildren';

import './downloadBlock.scss';
import './entryDetails.scss';
import './missingChildren.scss';

interface EntryEpisodeDetailsProps {
    api: Api;
    userId: string;
    serverId: string;
    detail: EntryDetail;
    season: number;
    episodeNumber: number;
    view: HTMLElement;
    isAdmin: boolean;
    signal: AbortSignal;
    focusOwnership?: FocusOwnership;
    /** The fresh read of the entry, when the page was drawn from what was known of it (P1.FU16). */
    update?: Promise<EntryDetail>;
}

/** One person card's data: upstream's card shows the name and, below it, the role or the person's kind. */
interface Person {
    key: string;
    name: string;
    role: string;
    profilePath?: string | null;
}

/** Upstream's role line (cardBuilder's `getPeopleRoleOrTypeLabel`): "as Character" for cast, else the kind or the job. */
const roleLabel = (type: string, role?: string | null) => {
    if ((type === 'Actor' || type === 'GuestStar') && role) return globalize.translate('PersonRole', role);
    return !role || role.toLowerCase() === type.toLowerCase() ? globalize.translate(type) : globalize.translate(role);
};

/**
 * The crew as upstream's Cast & Crew lists it: by kind (directors, writers, producers, as Jellyfin orders people), one card per
 * person with every role they hold joined by " / " (upstream merges a person's crew roles the same way).
 */
const crewCards = (crew: TmdbCrewCredit[]): Person[] => {
    const kinds = ['Director', 'Writer', 'Producer'];
    const byPerson = new Map<string, Person & { roles: string[] }>();
    for (const person of [...crew].sort((a, b) => kinds.indexOf(a.type) - kinds.indexOf(b.type))) {
        const key = 'crew:' + (person.id || person.name);
        const label = roleLabel(person.type, person.job);
        const known = byPerson.get(key);
        if (known) {
            if (!known.roles.includes(label)) known.roles.push(label);
        } else {
            byPerson.set(key, { key, name: person.name, role: '', roles: [label], profilePath: person.profilePath });
        }
    }
    return Array.from(byPerson.values()).map(({ roles, ...person }) => ({ ...person, role: roles.join(' / ') }));
};

/**
 * A person card as upstream's people list draws one (overflow portrait, centred name and role, the person icon on the default
 * background without a portrait), with TMDB's portrait (w185). Jellyfin has no person item for these people, so the card links
 * nowhere: on the TV it is a focus stop that only scrolls the row, as upstream's cards are.
 * The card shows the person icon at once and TMDB's portrait fades in over it when it arrives, with upstream's own image fade
 * and its Faster Animations setting (P1.FU18); a portrait that fails leaves the icon.
 */
const PersonCard: FC<{ person: Person }> = ({ person }) => {
    const src = getTmdbImage(person.profilePath, 'w185');
    const [loaded, setLoaded] = useState<string>();
    const [failed, setFailed] = useState<string>();
    const onLoad = useCallback(() => setLoaded(src), [src]);
    const onError = useCallback(() => setFailed(src), [src]);
    const fade = userSettings.enableFastFadein() ? 'lazy-image-fadein-fast' : 'lazy-image-fadein';
    const tv = layoutManager.tv;
    const className = resolveCardCssClasses({ shape: 'overflowPortrait', cardCssClass: 'personCard', isTV: tv, isDesktop: false,
        enableFocusTransform: !browser.slow && !browser.edge, showChildCountIndicator: false, itemType: 'Person', tagName: 'div' }) + ' jfmod-personCard';
    const body = <div className='cardBox cardBox-bottompadded'>
        <div className='cardScalable'>
            <div className='cardPadder cardPadder-overflowPortrait' />
            <div className={'cardImageContainer coveredImage cardContent ' + getDefaultBackgroundClass(person.name)}>
                <span className='cardImageIcon material-icons person' aria-hidden='true' />
                {src && failed !== src && <img className={'jfmod-missingImage ' + (loaded === src ? fade : 'lazy-hidden')} src={src} alt=''
                    loading='lazy' decoding='async' onLoad={onLoad} onError={onError} />}
            </div>
        </div>
        <div className='cardFooter'>
            <div className='cardText cardTextCentered cardText-first'><bdi>{person.name}</bdi></div>
            {person.role && <div className='cardText cardTextCentered cardText-secondary'><bdi>{person.role}</bdi></div>}
        </div>
    </div>;
    return tv ?
        <button type='button' className={className} aria-label={person.role ? `${person.name}, ${person.role}` : person.name}>{body}</button> :
        <div className={className}>{body}</div>;
};

/** One of upstream's people sections (`#castCollapsible`, `#guestCastCollapsible`), shown while it has people. */
const PeopleSection: FC<{ view: HTMLElement; section: string; content: string; people: Person[] }> = ({ view, section, content, people }) => {
    const [node, setNode] = useState<Element | null>(null);
    const shown = people.length > 0;
    useLayoutEffect(() => {
        const element = view.querySelector(section);
        if (!element || !shown) return;
        element.classList.remove('hide');
        setNode(element.querySelector(content));
        return () => {
            element.classList.add('hide');
            setNode(null);
        };
    }, [content, section, shown, view]);
    return node && createPortal(<>{people.map(person => <PersonCard key={person.key} person={person} />)}</>, node);
};

/** Upstream's details line for one kind (ItemDetailsMetadataList): "Director" or "Directors", then the names, plain text. */
const DetailsLine: FC<{ label: string; names: string[] }> = ({ label, names }) => (names.length ? <Box className='detailsGroupItem'>
    <Typography className='label'>{label}</Typography>
    <Box className='focuscontainer-x'>{names.join(', ')}</Box>
</Box> : null);

/**
 * The mod's page for an episode Jellyfin has no item for (`#/details?entryId=…&season=N&episode=M`, P1.FU15), laid out as
 * upstream's page for a downloaded episode: the series and "Season N - M. Title" as the header, the meta line with the series'
 * certification, TMDB's still as the image (plain, as a downloaded episode's), the download block where the track selectors sit
 * (P1.FU20), the series' genres, the overview, the director and writer lines, Cast & Crew (the series' regulars, then the crew)
 * and Guest Stars. Administrators get Get a Release for the episode in the header. Once the episode is in the library the page
 * becomes Jellyfin's own.
 */
const EntryEpisodeDetails: FC<EntryEpisodeDetailsProps> = ({ api, userId, serverId, detail: initial, season, episodeNumber, view,
    isAdmin, signal, focusOwnership, update }) => {
    const [detail, setDetail] = useState(initial);
    useEffect(() => {
        update?.then(fresh => {
            if (!signal.aborted) setDetail(fresh);
        }, () => undefined);
    }, [signal, update]);
    const capabilities = usePluginCapabilities(api, isAdmin);
    const canAcquire = isAdmin && capabilities.includes(RELEASES_CAPABILITY);
    const entry = detail.entry;
    const episode = detail.episodes.find(candidate => candidate.seasonNumber === season && candidate.episodeNumber === episodeNumber);
    const reload = useCallback(() => {
        getEntry(api, entry.id, { signal }).then(updated => {
            if (!signal.aborted) setDetail(updated);
        }, () => undefined);
    }, [api, entry.id, signal]);
    // A series whose list predates the credits loads it once more on opening, as its other pages do (P1.FU9, P1.FU15).
    useEpisodeListLoad(api, detail, reload);
    const openPicker = useCallback((opener: HTMLElement) => {
        openReleasePicker({
            api, entryId: entry.id, title: entry.title, mediaType: entry.mediaType, episodes: detail.episodes,
            // The episode's scope list, as its row's icon and a downloaded episode's page offer it.
            episodeId: episode?.id, episodePage: true, episodeListLoaded: detail.episodeListLoaded, onChanged: reload
        }).then(() => restoreFocusTo(opener), () => restoreFocusTo(opener));
    }, [api, detail.episodeListLoaded, detail.episodes, entry.id, entry.mediaType, entry.title, episode?.id, reload]);
    useStockHeaderButton(view, { enabled: canAcquire && !!episode, icon: 'cloud_download', title: 'Get a Release',
        className: 'jfmod-getRelease', onClick: openPicker });
    // The header links go to Jellyfin's own series and season pages where it has them, else to the mod's.
    const seasons = useQuery({
        queryKey: ['JellyfinMod', api.basePath, userId, 'NativeSeasons', entry.jellyfinItemId],
        queryFn: async ({ signal: abort }) => (await getShowApi(api).getSeasons({ seriesId: entry.jellyfinItemId!, userId },
            { signal: abort })).data.Items ?? [],
        enabled: !!entry.jellyfinItemId,
        retry: false
    });
    const nativeSeason = seasons.data?.find(item => item.IndexNumber === season && item.Id);
    const nativeLink = (id: string) => '#/details?id=' + encodeURIComponent(id) + '&serverId=' + encodeURIComponent(serverId);
    const seriesHref = entry.jellyfinItemId ? nativeLink(entry.jellyfinItemId) : '#' + getEntryPath(entry.id, serverId);
    const seasonHref = nativeSeason?.Id ? nativeLink(nativeSeason.Id) : '#' + seasonPath(entry.id, season, serverId);
    // On the TV the page places focus on its first action while it owns focus, as the season page does.
    useEffect(() => {
        if (!layoutManager.tv || !focusOwnership) return;
        const first = view.querySelector<HTMLElement>('.mainDetailButtons .jfmod-getRelease')
            ?? view.querySelector<HTMLElement>('.nameContainer a');
        if (first && focusOwnership.mayFocus(first)) {
            focusManager.focus(first);
            focusOwnership.placed(first);
        }
    });
    const cover = useTmdbCover(episode?.stillPath, layoutManager.tv ? 'w500' : 'w300');
    const mount = (selector: string, content: ReactNode) => {
        const node = view.querySelector(selector);
        return node ? createPortal(content, node) : null;
    };
    const credits = episode?.credits;
    const crew = credits?.crew ?? [];
    const namesOf = (type: TmdbCrewCredit['type']) => Array.from(new Set(crew.filter(person => person.type === type).map(person => person.name)));
    const directors = namesOf('Director');
    const writers = namesOf('Writer');
    // Cast & Crew as upstream lists a downloaded episode's: its cast (the series' regulars here, as TMDB credits each episode's
    // cast from them) by billing, then the crew; the guest stars in their own section.
    const cast: Person[] = [
        ...(entry.metadata?.cast ?? []).map(person => ({ key: 'cast:' + person.id + ':' + person.order, name: person.name,
            role: roleLabel('Actor', person.character), profilePath: person.profilePath })),
        ...crewCards(crew)
    ];
    const guests: Person[] = (credits?.guestStars ?? []).map(person => ({ key: 'guest:' + person.id + ':' + person.order,
        name: person.name, role: roleLabel('GuestStar', person.character), profilePath: person.profilePath }));
    // Once the episode's file is in the library (its import ended and the entry was read again), Jellyfin's own page takes over:
    // its Video / Audio / Subtitle selectors and Play replace the download block (P1.FU20).
    // So does the placeholder Jellyfin adds for it while the page is open (the backfill, P1.FU27), read by the catalog's refresh.
    const live = useLiveEntryDetail(api, initial);
    const liveEpisode = live.episodes.find(candidate => candidate.seasonNumber === season && candidate.episodeNumber === episodeNumber);
    const heldItem = (episode?.availability === 'onDisk' ? episode.jellyfinItemId : null)
        ?? (liveEpisode?.availability === 'onDisk' ? liveEpisode.jellyfinItemId : liveEpisode?.placeholderItemId) ?? null;
    useEffect(() => {
        if (heldItem && !signal.aborted) openNativePage(heldItem, serverId);
    }, [heldItem, serverId, signal]);
    const metadata = entry.metadata;
    // The series' certification as upstream's misc line shows an official rating: the US one, else the first TMDB lists.
    const certifications = metadata?.certifications ?? [];
    const certification = (certifications.find(item => item.country === 'US') ?? certifications[0])?.rating;
    const genres = metadata?.genres ?? [];
    // Upstream's episode date: the date alone, in the locale's short form (mediainfo's `toLocaleDateString`).
    const shortDate = (date: string) => datetime.toLocaleDateString(datetime.parseISO8601Date(date, false));
    return <>
        {mount('.nameContainer', <>
            <h1 className='parentName focuscontainer-x'><bdi>
                <LinkButton className='button-link' href={seriesHref} style={{ color: 'inherit' }}>{entry.title}</LinkButton>
            </bdi></h1>
            <h3 className='itemName infoText subtitle focuscontainer-x'><bdi>
                <LinkButton className='button-link' href={seasonHref} style={{ color: 'inherit' }}>{'Season ' + season}</LinkButton>
                {' - '}{episodeNumber}. {episode?.title ?? ''}
            </bdi></h3>
        </>)}
        {episode && mount('.itemMiscInfo-primary', <>
            {episodeMetaItems(episode, entry.metadata?.episodeRatings?.[episode.tmdbId], shortDate)}
            {certification && <div className='mediaInfoItem mediaInfoText mediaInfoOfficialRating'>{certification}</div>}
        </>)}
        {episode && Array.from(view.querySelectorAll('.detailImageContainer')).map((node, index) => createPortal(
            // A plain still, as a downloaded episode's: the download block below says the state (user, 2026-10-13).
            <div className='card backdropCard jfmod-episodeStill'>
                <div className='cardBox'>
                    <div className='cardScalable'>
                        <div className='cardPadder cardPadder-backdrop' />
                        <div className={'cardImageContainer coveredImage cardContent' + (cover ? '' : ' jfmod-missingPoster jfmod-missingEmpty')}>
                            {cover ?? <span className='jfmod-missingNumber' aria-hidden='true'>{episodeNumber}</span>}
                        </div>
                    </div>
                </div>
            </div>, node, String(index)))}
        {episode && <DownloadBlock anchor={view.querySelector('.trackSelections')} entryId={entry.id} episode={episode} isAdmin={isAdmin}
            canAcquire={canAcquire} onGetRelease={openPicker} onChanged={reload} />}
        {genres.length > 0 && mount('.itemGenres', <span className='jfmod-episodeGenres'>{genres.join(', ')}</span>)}
        {episode?.overview && mount('.overview', episode.overview)}
        {mount('.itemDetailsGroup', <>
            <DetailsLine label={globalize.translate(directors.length > 1 ? 'Directors' : 'Director')} names={directors} />
            <DetailsLine label={globalize.translate(writers.length > 1 ? 'Writers' : 'Writer')} names={writers} />
        </>)}
        <PeopleSection view={view} section='#castCollapsible' content='#castContent' people={cast} />
        <PeopleSection view={view} section='#guestCastCollapsible' content='#guestCastContent' people={guests} />
    </>;
};

export default EntryEpisodeDetails;
