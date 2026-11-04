import { renderComponent } from 'utils/reactUtils';
import { PrefsPage } from '../design/PrefsPage';

/** The user's own Preferences pages. Admin pages that share their components have other roots and are left alone. */
const PAGES = '#displayPreferencesPage, #homeScreenPreferencesPage, #languagePreferencesPage, #controlsPreferencesPage, #userProfilePage, #quickConnectPreferencesPage';

/**
 * Upstream's controllers keep reading and saving every field in their hidden form; PrefsPage paints the mockup over it.
 * A page announces itself with `viewshow`, as both the legacy view manager and the React Page do.
 */
export const paintPreferencesPages = () => {
    const onShow = (event: Event) => {
        const view = event.target;
        if (!(view instanceof HTMLElement) || !view.matches(PAGES) || view.querySelector(':scope > .jfmod-dsPrefsHost')) return;
        const host = document.createElement('div');
        host.className = 'jfmod-dsPrefsHost';
        view.appendChild(host);
        view.classList.add('jfmod-dsPrefs', 'jfmod-dsPage');
        const unmount = renderComponent(PrefsPage, { view }, host);
        const hide = () => {
            view.removeEventListener('viewdestroy', hide);
            unmount();
            host.remove();
        };
        view.addEventListener('viewdestroy', hide);
    };
    document.addEventListener('viewshow', onShow);
    return () => document.removeEventListener('viewshow', onShow);
};
