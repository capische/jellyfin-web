import { titleEpisodeRows } from './titleEpisodeRows';

const arrangeTitle = (view: HTMLElement, primary: Element) => {
    if (!primary.querySelector('.jfmod-titleColumn')) {
        const column = document.createElement('div');
        column.className = 'jfmod-titleColumn';
        const notice = document.createElement('div');
        notice.className = 'jfmod-titleNotice';
        column.appendChild(notice);
        for (const selector of ['.detailRibbon', '.detailPagePrimaryContent']) {
            const slot = primary.querySelector(selector);
            if (slot) column.appendChild(slot);
        }
        primary.appendChild(column);
        const art = document.createElement('div');
        art.className = 'jfmod-titleArt';
        art.setAttribute('aria-hidden', 'true');
        primary.prepend(art);
        const secondary = view.querySelector('.detailPageSecondaryContainer');
        if (secondary) {
            for (const selector of ['#listChildrenCollapsible', '.nextUpSection']) {
                const section = primary.querySelector(selector);
                if (section) secondary.prepend(section);
            }
        }
        titleEpisodeRows(view);
    }
};

/** Presentation only: keep the stock slots, controls and controller on title/person pages. */
export const titlePage = (view: HTMLElement, type: string, image?: string) => {
    if (!['Movie', 'Series', 'Season', 'Episode', 'Person'].includes(type)) return;
    view.classList.add('jfmod-titlePage');
    view.classList.toggle('jfmod-titleEpisode', type === 'Episode');
    view.classList.toggle('jfmod-titlePerson', type === 'Person');
    const primary = view.querySelector('.detailPagePrimaryContainer');
    if (!primary) return;
    arrangeTitle(view, primary);
    if (type === 'Person') arrangePerson(view);
    const art = primary.querySelector<HTMLElement>('.jfmod-titleArt');
    if (art && image !== undefined) art.style.setProperty('--jfmod-title-image', image ? `url(${JSON.stringify(image)})` : 'none');
};

/** These keep their IDs: the stock controller still supplies the localized dates, age and birthplace link. */
const arrangePerson = (view: HTMLElement) => {
    if (view.querySelector('.jfmod-personFacts')) return;
    const info = view.querySelector('.infoWrapper');
    if (!info) return;
    const facts = document.createElement('div');
    facts.className = 'jfmod-personFacts';
    for (const selector of ['#itemBirthday', '#itemBirthLocation', '#itemDeathDate']) {
        const node = view.querySelector(selector);
        if (node) facts.appendChild(node);
    }
    info.appendChild(facts);
};
