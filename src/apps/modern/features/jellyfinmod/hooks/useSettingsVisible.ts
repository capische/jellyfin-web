import { useApi } from 'hooks/useApi';

import { usePluginHealth } from './useEntries';

/**
 * Whether the JellyfinMod settings area belongs in the user menu: administrators of a plugin that offers it (P7.S8),
 * and only inside the mod entry. The user menu is upstream's `AppUserMenu`, shared by both entries, but
 * `/catalog/settings` is a mod route; in the stock entry the item would lead to upstream's not-found page
 * (REVIEW-2026-09-24 S8-R1). `window.__jfmodBundle` is set by the mod entry's first statement and never by the stock one.
 */
export const useSettingsVisible = () => {
    const { user } = useApi();
    const health = usePluginHealth();
    return window.__jfmodBundle === true && !!user?.Policy?.IsAdministrator && health.data?.ok === true
        && health.data.capabilities.includes('settings.overview');
};
