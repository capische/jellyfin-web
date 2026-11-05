import { renderComponent } from 'utils/reactUtils';
import { PrefsPage } from '../design/PrefsPage';

/** The user's own Preferences pages. Admin pages that share their components have other roots and are left alone. */
const PAGES = '#displayPreferencesPage, #homeScreenPreferencesPage, #languagePreferencesPage, #controlsPreferencesPage, #userProfilePage, #quickConnectPreferencesPage';

/**
 * Upstream's controllers keep reading and saving every field in their hidden form; PrefsPage paints the mockup over it.
 * A page announces itself with `viewshow`, as both the legacy view manager and the React Page do.
 */
export const paintPreferencesPages = () => {
    const pages = new Map<HTMLElement, () => void>();
    const removed = new MutationObserver(() => {
        pages.forEach((dispose, view) => {
            if (!view.isConnected) dispose();
        });
    });
    removed.observe(document.body, { childList: true, subtree: true });
    const onShow = (event: Event) => {
        const view = event.target;
        if (!(view instanceof HTMLElement) || !view.matches(PAGES) || view.querySelector(':scope > .jfmod-dsPrefsHost')) return;
        const host = document.createElement('div');
        host.className = 'jfmod-dsPrefsHost';
        view.appendChild(host);
        view.classList.add('jfmod-dsPrefs', 'jfmod-dsPage');
        const unmount = renderComponent(PrefsPage, { view }, host);
        const hide = () => {
            pages.delete(view);
            view.removeEventListener('viewdestroy', hide);
            unmount();
            host.remove();
            view.classList.remove('jfmod-dsPrefs', 'jfmod-dsPage');
        };
        pages.set(view, hide);
        view.addEventListener('viewdestroy', hide);
    };
    document.addEventListener('viewshow', onShow);
    return () => {
        document.removeEventListener('viewshow', onShow);
        removed.disconnect();
        pages.forEach(dispose => {
            dispose();
        });
    };
};
