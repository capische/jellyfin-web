# Indexer colour

**Status:** approved 2026-10-25 (user: "assign indexer a color (so it's not random; in settings you can see it, no need to change but
it should be there)"; then "Looks great, tell parent to implement", finished state F1). Record:
[release-picker-source-filter.md](../release-picker-source-filter.md) Revisions 5 and 5b, the mockup
[release-picker-sources-dot.html](../release-picker-sources-dot.html) (PNGs beside it). Built in P4.FU25 (built, not accepted).
Code: web `constants/indexerColours.ts`; plugin `AcquisitionIndexer.ColorIndex`, `ModDbContext.AssignIndexerColoursAsync`,
migration `IndexerColours`, the palette repeated in `configPage.html`.

## What it is

Every indexer has one colour of its own, fixed and visible wherever the indexer is named in colour: the release picker's Sources dot
(the train) and checklist, the searching ring's segments and the dots of its indexer lines, and the settings rows. It is not a state
colour: state is said by opacity, motion and, for a failure, the red `#e53935` instead of the colour.

## The palette

Eight hues that stay apart on the dark and the light theme and from the two colours that already mean something (the primary
`#00a4dc`, the failure red):

| Index | Colour | Tick on a checked box |
| --- | --- | --- |
| 0 | `#4fc3f7` | white |
| 1 | `#81c784` | white |
| 2 | `#ffb74d` | dark `#1d1f22` |
| 3 | `#ba68c8` | white |
| 4 | `#f06292` | white |
| 5 | `#4db6ac` | white |
| 6 | `#fff176` | dark `#1d1f22` |
| 7 | `#ff8a65` | white |

## Assignment

- The plugin stores `colorIndex` (0–7) on the indexer when it is first saved (added by hand or by a Prowlarr sync): the colour the
  fewest indexers have, the lowest first. The first eight indexers get eight colours; a ninth wraps to the first; an indexer removed
  and added again gets its old colour back when nothing was added meanwhile.
- It never changes afterwards and cannot be edited. The migration gave the indexers already there the palette in the plugin's
  indexer order (priority, then name).
- The plugin returns it in `GET /Settings/Indexers` (`colorIndex`), in every search's and progress line's `indexers[]`
  (`colorIndex`) and on each candidate (`indexerColorIndex`). The web maps the index to the hue with `indexerColour()`; a plugin
  without the field reads as index 0.

## Where it shows

- **Settings** (the React Indexers rows and the Dashboard page's list): a 0.75em round swatch before the name, `margin-right
  .45em`, read-only, tooltip "Colour in the release picker" (`.jfmod-indexerColour`).
- **The picker:** see [release-picker-sources.md](release-picker-sources.md) (the dot, the train, the checklist, the ring).

## Do not

- Use an indexer colour for a state, or a state colour (green, blue) for an indexer.
- Add a colour picker or let the colour follow the indexer's position in a list: the colour stays with the indexer.
