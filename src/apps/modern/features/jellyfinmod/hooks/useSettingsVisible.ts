import { useApi } from 'hooks/useApi';

import { usePluginHealth } from './useEntries';

/** Whether the JellyfinMod settings area belongs in the user menu: administrators of a plugin that offers it (P7.S8). */
export const useSettingsVisible = () => {
    const { user } = useApi();
    const health = usePluginHealth();
    return !!user?.Policy?.IsAdministrator && health.data?.ok === true && health.data.capabilities.includes('settings.overview');
};
