import type { Api } from '@jellyfin/sdk/lib/api';
import { useQuery } from '@tanstack/react-query';

import { getPluginHealth } from '../api/modApi';

/** The capability a plugin build advertises when it serves release search and held grabs (P4.A7). */
export const RELEASES_CAPABILITY = 'acquisition.releases';

/**
 * Whether this server's plugin can search releases. An older plugin, a missing plugin or a failed
 * health read all answer false, so the release action hides instead of breaking the page.
 */
export const useAcquisitionAvailable = (api: Api | undefined, enabled: boolean) => {
    const health = useQuery({
        queryKey: ['JellyfinMod', api?.basePath, 'HealthCapabilities'],
        queryFn: ({ signal }) => getPluginHealth(api!, { signal }),
        enabled: !!api && enabled,
        retry: false,
        staleTime: 5 * 60 * 1000
    });
    return enabled && !!health.data?.capabilities.includes(RELEASES_CAPABILITY);
};
