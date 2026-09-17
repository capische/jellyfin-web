import type { ItemDto } from 'types/base/models/item-dto';

import type { Entry, RetentionSummary } from './entry';

/** Native IDs and plugin IDs remain separate throughout browse rendering and navigation. */
export type BrowseRow = {
    kind: 'native';
    nativeItem: ItemDto;
    entry?: Entry | null;
    retention?: RetentionSummary | null;
} | {
    kind: 'entry';
    entry: Entry;
    retention?: RetentionSummary | null;
};
