import type { ItemDto } from 'types/base/models/item-dto';

import type { Entry, RetentionSummary } from './entry';
import type { Rating } from './ratings';

/** Native IDs and plugin IDs remain separate throughout browse rendering and navigation. */
export type BrowseRow = {
    kind: 'native';
    nativeItem: ItemDto;
    entry?: Entry | null;
    retention?: RetentionSummary | null;
    /** The requested card source's value, only when the request asked for one (P9.R7). */
    rating?: Rating | null;
} | {
    kind: 'entry';
    entry: Entry;
    retention?: RetentionSummary | null;
    rating?: Rating | null;
};
