import toast from 'components/toast/toast';

import './announce.scss';

let region: HTMLElement | null = null;

const liveRegion = () => {
    if (region?.isConnected) return region;
    region = document.createElement('div');
    region.className = 'jfmod-announce';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    document.body.appendChild(region);
    return region;
};

/**
 * Upstream's toast, also read out (user, 2026-10-08: confirmations moved from a line in the page to the toast, which
 * upstream does not announce). The words go to one visually hidden live region the mod owns, emptied first so the same
 * sentence twice is read twice.
 */
export const announce = (text: string) => {
    toast(text);
    const node = liveRegion();
    node.textContent = '';
    window.setTimeout(() => {
        node.textContent = text;
    }, 50);
};
