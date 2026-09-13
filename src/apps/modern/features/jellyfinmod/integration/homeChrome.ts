import { renderComponent } from 'utils/reactUtils';

import HomeHero from '../components/HomeHero';

interface ChromeMount {
    root: HTMLElement;
    unmount: () => void;
    onScroll: () => void;
}

const mounts = new WeakMap<HTMLElement, ChromeMount>();

const updateHeader = () => {
    const header = document.querySelector<HTMLElement>('.skinHeader');
    if (!header) return;

    header.classList.add('jfmod-topbar');
    header.classList.toggle('jfmod-topbarSolid', window.scrollY > 40);
};

export const mountHomeChrome = (homeTab: HTMLElement) => {
    let mount = mounts.get(homeTab);
    if (!mount) {
        const page = homeTab.closest<HTMLElement>('.homePage');
        const sections = homeTab.querySelector<HTMLElement>('.sections');
        if (!page || !sections) return;

        const root = document.createElement('div');
        root.className = 'jfmod-homeHeroMount';
        sections.before(root);

        const onScroll = () => updateHeader();
        window.addEventListener('scroll', onScroll, { passive: true });
        mount = {
            root,
            unmount: renderComponent(HomeHero, {}, root),
            onScroll
        };
        mounts.set(homeTab, mount);
    }

    updateHeader();
};

export const pauseHomeChrome = (homeTab: HTMLElement) => {
    if (!mounts.has(homeTab)) return;
    document.querySelector('.skinHeader')?.classList.remove('jfmod-topbar', 'jfmod-topbarSolid');
};

export const unmountHomeChrome = (homeTab: HTMLElement) => {
    const mount = mounts.get(homeTab);
    if (!mount) return;

    window.removeEventListener('scroll', mount.onScroll);
    mount.unmount();
    mount.root.remove();
    mounts.delete(homeTab);
    document.querySelector('.skinHeader')?.classList.remove('jfmod-topbar', 'jfmod-topbarSolid');
};
