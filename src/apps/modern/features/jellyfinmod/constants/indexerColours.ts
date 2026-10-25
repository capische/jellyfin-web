/**
 * Each indexer's colour (P4.FU25, approved 2026-10-25; docs/jellyfinmod/design/guides/indexer-colour.md): eight hues that stay
 * apart on the dark and the light theme and from the primary blue and the failure red. The plugin gives every indexer an index
 * into this list when it is first saved and keeps it; the picker's Sources dot and checklist, the searching ring and the settings
 * rows draw it. The plugin's Dashboard page repeats the list (configPage.html).
 */
export const INDEXER_COLOURS = ['#4fc3f7', '#81c784', '#ffb74d', '#ba68c8', '#f06292', '#4db6ac', '#fff176', '#ff8a65'];

/** The two light hues, which take a dark tick in a checked box. */
const LIGHT = new Set([2, 6]);

const slot = (index: number | null | undefined) => (((index ?? 0) % INDEXER_COLOURS.length) + INDEXER_COLOURS.length) % INDEXER_COLOURS.length;

/** The colour of the indexer with this `colorIndex`; an older plugin's missing index reads as the first. */
export const indexerColour = (index: number | null | undefined) => INDEXER_COLOURS[slot(index)];

/** The tick on a checked box of this colour: dark on the two light hues, white on the rest. */
export const indexerTick = (index: number | null | undefined) => (LIGHT.has(slot(index)) ? '#1d1f22' : '#fff');
