import globalize from 'lib/globalize';
import type { MediaSourceInfo, MediaStream } from '@jellyfin/sdk/lib/generated-client';
import type { IconName } from './Icon';
import { describeDownload, type DownloadProgress } from '../constants/queue';
import { findSource, linesOfSize } from '../constants/versions';
import { rememberCommandOpener } from '../integration/commandOpener';

/** The controller remains the source of localized facts, permissions, commands and ordered lists. */
export interface TitleCommand {
    key: string;
    node: HTMLElement;
    label: string;
    icon: IconName;
    play: boolean;
    pressed: boolean;
    disabled: boolean;
    badge?: { text: string; title: string; kept: boolean };
}
export interface TitleCard {
    node: HTMLElement;
    attributes: Record<string, string>;
    key: string;
    title: string;
    second: string;
    facts: { text: string; star: boolean }[];
    overview: string;
    image?: string;
    href?: string;
    shape: 'p' | 'w' | 'c';
    row: boolean;
    commands: TitleCommand[];
    played: boolean;
    count?: string;
    captionCount: boolean;
    progress?: string;
    downloadProgress?: string;
    mark?: { kind: string; progress?: DownloadProgress; date?: string; label?: string; link?: { name: string; url: string } };
}
const text = (node: Element | null | undefined) => node?.textContent?.trim() ?? '';
const shown = (node: Element) => !node.classList.contains('hide') && !node.hasAttribute('hidden') && getComputedStyle(node).display !== 'none';
const iconOf = (node: Element): IconName => {
    const cls = node.className + ' ' + (node.querySelector('.material-icons')?.className ?? '') + ' ' + (node.getAttribute('aria-label') ?? '') + ' ' + node.getAttribute('title');
    for (const [pattern, icon] of [
        ['PlayTrailer|theaters', 'theaters'], ['Playstate|played|check', 'check'], ['UserRating|favorite', 'heart'],
        ['getRelease|Get a Release|cloud|search|Download This', 'cloud'], ['More|more|menu', 'more'], ['Shuffle|shuffle', 'shuffle'],
        ['Replay|replay', 'rew'], ['Play|play', 'play'], ['remove|delete|close', 'close'], ['history', 'history'],
        ['keep|pin', 'pin'], ['bookmark', 'check'], ['Download|get_app', 'arrow']
    ] as const) if (new RegExp(pattern, 'i').test(cls)) return icon;
    return 'more';
};
const commandKeys = new WeakMap<HTMLElement, string>();
let commandSequence = 0;
const commandKey = (node: HTMLElement) => {
    let key = commandKeys.get(node);
    if (!key) {
        key = String(++commandSequence);
        commandKeys.set(node, key);
    }
    return key;
};
export const commandOf = (node: HTMLElement): TitleCommand => {
    const badge = node.querySelector<HTMLElement>('.jfmod-playedBadge');
    return { node, key: commandKey(node), label: node.title || node.getAttribute('aria-label') || text(node), icon: iconOf(node),
        play: node.classList.contains('btnPlay'),
        pressed: node.classList.contains('playstatebutton-played') || node.classList.contains('ratingbutton-withrating') || node.getAttribute('aria-pressed') === 'true',
        disabled: node.hasAttribute('disabled') || node.getAttribute('aria-disabled') === 'true',
        badge: badge ? { text: text(badge), title: badge.title, kept: badge.classList.contains('jfmod-playedBadge--kept') } : undefined };
};
const imageOf = (node: Element | null): string | undefined => {
    const img = node?.querySelector<HTMLImageElement>('img');
    if (img) return img.getAttribute('data-src') || img.getAttribute('src') || undefined;
    const image = node?.querySelector<HTMLElement>('[data-src], [data-imageurl], [style*="background-image"]');
    return image?.getAttribute('data-src') || image?.getAttribute('data-imageurl') || /url\(["']?(.*?)["']?\)/.exec(image?.style.backgroundImage ?? '')?.[1];
};
const markOf = (node: HTMLElement): TitleCard['mark'] => {
    const mark = node.querySelector<HTMLElement>('[data-jfmod-kind]') ?? node.querySelector<HTMLElement>('.jfmod-mark--none, .jfmod-mark--unaired, .jfmod-mark--countdown, .jfmod-mark--inFlight');
    if (!mark) return undefined;
    if (mark.classList.contains('jfmod-mark--countdown')) return { kind: 'countdown', date: text(mark.querySelector('.jfmod-countdown')), label: mark.title };
    if (mark.classList.contains('jfmod-mark--inFlight')) return { kind: 'searching', label: mark.title };
    let kind = mark.dataset.jfmodKind ?? 'not-downloaded';
    if (mark.classList.contains('jfmod-mark--unaired')) kind = 'unaired';
    const url = mark.getAttribute('data-jfmod-open');
    const link = url ? { name: mark.getAttribute('aria-label') || 'Download client', url } : undefined;
    if (kind === 'not-downloaded' || kind === 'unaired') return { kind, date: text(mark.querySelector('.jfmod-markDate')), label: mark.title, link };
    if (!['downloading', 'stalled', 'queued', 'importing', 'failed', 'seeding'].includes(kind)) return undefined;
    const fill = mark.querySelector<SVGElement>('.arc .val');
    const percent = fill ? Number(fill.getAttribute('stroke-dasharray')?.split(' ')[0] || 0) : null;
    const progress = describeDownload(kind as DownloadProgress['kind'], percent, mark.classList.contains('stale'));
    return { kind, progress: { ...progress, tooltip: mark.title || progress.tooltip }, link };
};

export const cardOf = (node: HTMLElement, index: number): TitleCard => {
    const lines = Array.from(node.querySelectorAll('.cardText, .listItemBodyText, .jfmod-missingTitle, .jfmod-missingMeta'));
    const link = node.querySelector<HTMLAnchorElement>('a[href]:not([href="#"])');
    const id = node.getAttribute('data-id');
    const server = node.getAttribute('data-serverid');
    const row = node.classList.contains('listItem') || node.classList.contains('jfmod-missingRow') || !!node.querySelector('.jfmod-missingRow');
    const type = node.getAttribute('data-type');
    const factNodes = Array.from(lines[1]?.querySelectorAll('.mediaInfoItem, .jfmod-dlMeta') ?? []);
    // Without a meta line (a phone's row) the download's figure is the row's last line.
    const figure = node.querySelector('.jfmod-dlMeta');
    if (figure && !factNodes.includes(figure)) factNodes.push(figure);
    const facts = factNodes.map(item => ({ text: text(item), star: item.classList.contains('starRatingContainer') }));
    let shape: TitleCard['shape'] = 'p';
    if (type === 'Episode' || /backdrop|Backdrop/.test(node.className)) shape = 'w';
    if (type === 'Person' || node.classList.contains('personCard')) shape = 'c';
    return { node, attributes: Object.fromEntries(Array.from(node.attributes).filter(attribute => attribute.name.startsWith('data-')).map(attribute => [attribute.name, attribute.value])), key: id || node.getAttribute('data-jfmod-episode-id') || node.getAttribute('data-jfmod-season') || String(index), title: text(lines[0]) || node.getAttribute('aria-label') || '',
        second: facts.length ? facts.map(fact => fact.text).join(' · ') : text(lines[1]), facts, overview: text(node.querySelector('.listItem-overview, .jfmod-episodeSynopsis, .jfmod-missingSynopsis, .jfmod-episodeSummary')),
        image: imageOf(node), captionCount: !!node.querySelector('[data-jfmod-count]'), mark: markOf(node), href: link?.getAttribute('href') || (id ? `#/details?id=${encodeURIComponent(id)}&serverId=${encodeURIComponent(server ?? '')}` : undefined),
        shape, row,
        // The mockup's row and pill have no Info: the row or card itself opens the title.
        commands: Array.from(node.querySelectorAll<HTMLElement>('button, .cardOverlayButton')).filter(item => shown(item) && !item.matches('[data-action="link"]')).map(commandOf),
        played: !!node.querySelector('.playedIndicator'), count: text(node.querySelector('.countIndicator')) || undefined,
        progress: node.querySelector<HTMLElement>('.itemProgressBarForeground')?.style.width,
        downloadProgress: node.querySelector<HTMLElement>('.jfmod-dlBar-fill, .jfmod-missingProgressFill')?.style.width };
};
export interface TitleTrack {
    name: string;
    kind: 'v' | 'a' | 's';
    select: HTMLSelectElement;
    options: { value: string; text: string; video?: MediaStream; size?: number | null }[];
    value: string;
    enabled: boolean;
}
const titleSources = new WeakMap<HTMLElement, MediaSourceInfo[]>();
/** Use the item's already-read streams, also when the plugin has no catalog entry for it. */
export const setTitleSources = (view: HTMLElement, sources: MediaSourceInfo[]) => titleSources.set(view, sources);
const readTracks = (view: HTMLElement, host: Element | null): TitleTrack[] => {
    const form = host?.querySelector('.trackSelections');
    if (!form || form.classList.contains('hide') || view.hasAttribute('data-ds-tracks-mounted') || view.hasAttribute('data-jfmod-placeholder')) return [];
    return ([['Video', 'v', '.selectSource'], ['Audio', 'a', '.selectAudio'], ['Subtitles', 's', '.selectSubtitles']] as const).flatMap(([name, kind, selector]) => {
        const select = form.querySelector<HTMLSelectElement>(selector);
        if (!select) return [];
        const options = Array.from(select.options).map((option, index) => {
            if (kind !== 'v') return { value: option.value, text: option.textContent ?? '' };
            const source = findSource(titleSources.get(view), option.value);
            const video = source?.MediaStreams?.find(stream => stream.Type === 'Video');
            const lines = video && linesOfSize(video.Width, video.Height);
            // A source's Name can include its audio. Only its video stream describes this list (D105).
            return { value: option.value, text: lines ? lines + 'p' : globalize.translate('Video') + ' ' + (index + 1), video, size: source?.Size };
        });
        return [{ name, kind, select, value: select.value, enabled: !select.disabled,
            options: options.length ? options : [{ value: '', text: globalize.translate('None') }] }];
    });
};

export interface InlinePart { key: string; text: string; href?: string; target?: string; command?: HTMLElement }
/** Keep upstream's metadata and synopsis links without copying any upstream elements. */
const inlineOf = (node: Element | null | undefined): InlinePart[] => {
    if (!node) return [];
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const parts: InlinePart[] = [];
    while (walker.nextNode()) {
        const textNode = walker.currentNode;
        let value = textNode.textContent ?? '';
        if (textNode.parentElement?.closest('.label')) value += ': ';
        const link = textNode.parentElement?.closest<HTMLAnchorElement>('a');
        const command = textNode.parentElement?.closest<HTMLElement>('.itemAction, button');
        parts.push({ key: String(parts.length), text: value, href: link?.getAttribute('href') ?? undefined,
            target: link?.getAttribute('target') ?? undefined, command: command ?? undefined });
    }
    return parts;
};

export const readTitle = (view: HTMLElement) => {
    const host = view.querySelector('.detailPageWrapperContainer');
    const name = host?.querySelector('.nameContainer');
    const primaryName = name?.querySelector('.itemName, h3') ?? name?.querySelector('h1');
    const title = inlineOf(primaryName).filter(part => !part.command && !part.href).map(part => part.text).join('').replace(/^\s*-\s*/, '').trim() || text(primaryName);
    const parents = Array.from(name?.querySelectorAll<HTMLAnchorElement>('a[href]') ?? []).map(node => ({ label: text(node), href: node.getAttribute('href')!, command: node.classList.contains('itemAction') ? node : undefined }));
    const meta = Array.from(host?.querySelectorAll('.itemMiscInfo-primary > :not(.jfmod-ratingsMount)') ?? [])
        .filter(shown)
        .map(node => ({ text: text(node), badge: node.classList.contains('mediaInfoOfficialRating'), star: node.matches('.jfmod-entryStar, .starRatingContainer'), critic: node.classList.contains('mediaInfoCriticRating'), endsAt: node.classList.contains('endsAt'), parts: inlineOf(node) })).filter(fact => fact.text);
    if (!meta.length && text(host?.querySelector('.itemMiscInfo-primary'))) meta.push({ text: text(host?.querySelector('.itemMiscInfo-primary')), badge: false, star: false, critic: false, endsAt: false, parts: [] });
    const facts = ['#itemBirthday', '#itemBirthLocation', '#itemDeathDate'].flatMap(selector => {
        const node = host?.querySelector(selector);
        return node && shown(node) && text(node) ? [{ text: text(node), href: node.querySelector('a')?.getAttribute('href') }] : [];
    });
    const sections = Array.from(host?.querySelectorAll<HTMLElement>('.detailVerticalSection, #childrenContent > .verticalSection') ?? []).filter(section => shown(section) && !section.querySelector('#childrenContent > .verticalSection')).flatMap(section => {
        const cards = Array.from(section.querySelectorAll<HTMLElement>('.card, .listItem, .jfmod-missingSlot')).filter(node => !node.parentElement?.closest('.card, .listItem, .jfmod-missingSlot')).map(cardOf);
        return cards.length ? [{ key: section.id || section.getAttribute('data-type') || section.className, title: text(section.querySelector('h2')), cards }] : [];
    });
    // The template has More from Season above the cast; the mockup's episode page has it below.
    const fromSeason = (key: string) => (key.includes('moreFromSeasonSection') ? 1 : 0);
    sections.sort((a, b) => fromSeason(a.key) - fromSeason(b.key));
    const detailNodes = Array.from(host?.querySelectorAll('.detailsGroupItem') ?? []);
    const byWords: Record<string, string> = Object.fromEntries([['Director', 'Directed by'], ['Directors', 'Directed by'], ['Creator', 'Created by'], ['Creators', 'Created by']].map(([key, words]) => [globalize.translate(key), words]));
    const by = detailNodes.find(node => byWords[text(node.querySelector('.label'))]);
    return { title, originalTitle: text(name?.querySelector('.originalTitle')), parents, meta, facts, by: inlineOf(by).slice(1), byWords: by ? byWords[text(by.querySelector('.label'))] : '', tracks: readTracks(view, host ?? null), image: imageOf(host?.querySelector('.detailImageContainer') ?? null),
        overview: inlineOf(host?.querySelector('.overview')), genres: inlineOf(host?.querySelector('.itemGenres')),
        tagline: text(host?.querySelector('.tagline')),
        tags: inlineOf(host?.querySelector('.itemTags')),
        details: [...detailNodes.filter(node => node !== by), ...Array.from(host?.querySelectorAll('#seriesAirTime:not(.hide), .itemMiscInfo-secondary:not(.hide)') ?? [])].map(node => inlineOf(node)).filter(parts => parts.length),
        links: Array.from(host?.querySelectorAll<HTMLAnchorElement>('.itemExternalLinks a') ?? []).map(node => ({ label: text(node), href: node.getAttribute('href')!, command: node.classList.contains('itemAction') ? node : undefined })),
        commands: Array.from(host?.querySelectorAll<HTMLElement>('.mainDetailButtons > button, .jfmod-entryActions > button, .jfmod-entryActions > a') ?? []).filter(shown).map(commandOf), sections };
};

/** Native handlers receive the real painted opener; custom-element toggles keep their original element/state. */
export const runTitleCommand = (view: HTMLElement, command: TitleCommand, opener: HTMLElement) => {
    if (command.disabled) return;
    rememberCommandOpener(command.node, opener);
    const event = new CustomEvent('ds-title-command', { cancelable: true, detail: { source: command.node, opener } });
    if (view.dispatchEvent(event)) command.node.click();
};
