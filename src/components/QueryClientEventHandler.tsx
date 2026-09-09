import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, type FC } from 'react';

import { EventType } from 'constants/eventType';
import { useApi } from 'hooks/useApi';
import Events from 'utils/events';

/** Component that handles mapping events to query client actions. */
const QueryClientEventHandler: FC = () => {
    const queryClient = useQueryClient();
    const { user } = useApi();

    const invalidateUserQueries = useCallback(() => (
        queryClient.invalidateQueries({
            queryKey: ['User', user?.Id]
        })
    ), [queryClient, user?.Id]);

    useEffect(() => {
        Events.on(document, EventType.REFRESH_NEEDED, invalidateUserQueries);

        return () => {
            Events.off(document, EventType.REFRESH_NEEDED, invalidateUserQueries);
        };
    }, [invalidateUserQueries]);

    return null;
};

export default QueryClientEventHandler;
