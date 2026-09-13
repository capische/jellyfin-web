import type { ItemDto } from 'types/base/models/item-dto';

import type { Entry } from './entry';

/** Native IDs and plugin IDs remain separate throughout browse rendering and navigation. */
export type BrowseRow = {
    kind: 'native';
    nativeItem: ItemDto;
    entry?: Entry | null;
} | {
    kind: 'entry';
    entry: Entry;
};
