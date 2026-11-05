import { playbackManager } from 'components/playback/playbackmanager';
import { readEnvironment } from '../design/Root';
import { icons } from '../design/icons';

const svg = (name: keyof typeof icons) => `<svg data-ds-icon="${name}" viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[name]}"/></svg>`;

/** The player's template carries the mockup's markup; this adds its root classes (always dark), its icons and its title line. */
export const paintPlayer = (view: HTMLElement) => {
    view.querySelectorAll<HTMLElement>('[data-ds-i]').forEach(button => {
        button.insertAdjacentHTML('beforeend', button.dataset.dsI!.split(' ').map(name => svg(name as keyof typeof icons)).join(''));
    });
    const update = () => {
        const { device, layout, noBlur } = readEnvironment();
        view.className = view.className.replace(/\b(dev-\S+|layout-\S+|no-bf)\b/g, '').trim() + ` jfds jfmod-dsPlayer dev-${device} layout-${layout}${noBlur ? ' no-bf' : ''}`;
        view.dataset.theme = 'dark';
    };
    update();
    const environment = new MutationObserver(update);
    environment.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    window.addEventListener('resize', update);

    // Upstream puts the title in the header's page title, and the controller's own .osdTitle stays empty for video.
    const pageTitle = document.querySelector('.skinHeader .pageTitle');
    const name = view.querySelector('.jfmod-osdName');
    const facts = view.querySelector('.jfmod-osdFacts');
    // Upstream pads Ends At with spaces for its own layout; here it follows the facts after a dot.
    const endsAt = view.querySelector('.endsAtText');
    const originalTitle = view.querySelector('.osdTitle');
    const titleContainer = view.querySelector('.osdMainTextContainer');
    const title = () => {
        titleContainer?.classList.toggle('jfmod-empty', !originalTitle?.textContent?.trim());
        const ends = endsAt?.textContent ?? '';
        if (endsAt && ends !== ends.trim()) endsAt.textContent = ends.trim();
        if (name) name.textContent = (pageTitle?.textContent ?? '').replace(/ \(\d{4}\)$/, '');
        const player = playbackManager.getCurrentPlayer();
        if (!player) return;
        const item = playbackManager.currentItem(player);
        const height = playbackManager.currentMediaSource(player)?.MediaStreams?.find((stream: { Type?: string }) => stream.Type === 'Video')?.Height;
        if (facts) facts.textContent = [item?.ProductionYear, height && `${height}p`].filter(Boolean).join(' · ');
    };
    const titles = new MutationObserver(title);
    if (pageTitle) titles.observe(pageTitle, { childList: true, characterData: true, subtree: true });
    if (originalTitle) titles.observe(originalTitle, { childList: true, characterData: true, subtree: true });
    if (endsAt) titles.observe(endsAt, { childList: true });
    title();

    return () => {
        environment.disconnect();
        titles.disconnect();
        window.removeEventListener('resize', update);
    };
};
