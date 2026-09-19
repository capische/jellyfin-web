import React, { type FC } from 'react';

import QueuePage from 'apps/modern/features/jellyfinmod/components/QueuePage';

/** `/catalog/queue`, the only route JellyfinMod adds (UX §2.1). The page lives in the feature folder. */
const Queue: FC = () => <QueuePage />;

export default Queue;
