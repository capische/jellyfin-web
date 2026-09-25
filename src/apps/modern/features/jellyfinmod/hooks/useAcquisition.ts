import type { Api } from '@jellyfin/sdk/lib/api';
import { useQuery } from '@tanstack/react-query';

import { getPluginHealth } from '../api/modApi';

/** The capability a plugin build advertises when it serves release search and held grabs (P4.A7). */
export const RELEASES_CAPABILITY = 'acquisition.releases';

const NO_CAPABILITIES: string[] = [];

/**
 * The capabilities this server's plugin advertises. An older plugin, a missing plugin or a failed health read
 * all answer an empty list, so every gated surface hides instead of breaking the page.
 */
export const usePluginCapabilities = (api: Api | undefined, enabled = true): string[] => {
    const health = usePluginHealthSummary(api, enabled);
    return enabled && health.data ? health.data.capabilities : NO_CAPABILITIES;
};

/** The whole Health answer behind {@link usePluginCapabilities}, one shared read per server (P7.Q16 reads `traktInstalled`). */
export const usePluginHealthSummary = (api: Api | undefined, enabled = true) => useQuery({
    queryKey: ['JellyfinMod', api?.basePath, 'HealthCapabilities'],
    queryFn: ({ signal }) => getPluginHealth(api!, { signal }),
    enabled: !!api && enabled,
    retry: false,
    staleTime: 5 * 60 * 1000
});

/** Whether this server's plugin can search releases (administrators only). */
export const useAcquisitionAvailable = (api: Api | undefined, enabled: boolean) =>
    usePluginCapabilities(api, enabled).includes(RELEASES_CAPABILITY);
