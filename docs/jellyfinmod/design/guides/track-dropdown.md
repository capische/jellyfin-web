# Track strip and dropdown (the custom dropdown)

**Status:** the Video value as a dropdown approved 2026-10-10; Audio and Subtitles drawn the same way 2026-10-17 ("Logos,
A for size"); the same list for the profile dialog's Predefined picker 2026-10-16 ("use custom dropdown, we already got
one on details page"). **Video, Audio and Subtitles as one strip** (option B, the user's pick 2026-10-28, with the tightened
lists of approach 1; overnight decisions D4–D9 in workspace `reviews/overnight-2026-10-28/DECISIONS.md`; mockups
`reviews/upgrade-status-options/all-in-one/` and `…/lists/`): **built overnight 2026-10-28, awaiting the user's approval**.
Records: [Video row note](../video-row-file-size.md), [UX.md §11.2](../../UX.md), [quality profiles note](../quality-profiles-redesign.md).
Code: `components/FileChooser.tsx` (`useTrackStrip`, the Video segment and list), `components/TrackDropdown.tsx` (Audio,
Subtitles), `components/fileChooser.scss` (`.jfmod-strip`, `.jfmod-stripSegment`, `.jfmod-stripCaption`, `.jfmod-stripValue`,
`.jfmod-videoTrigger`, `.jfmod-trackTrigger`, `.jfmod-trackStatic`, `.jfmod-stripBelow`, `.jfmod-fileList*`,
`.jfmod-trackMenuPaper`, `.jfmod-trackItem`, `--on`, `.jfmod-trackTitle`), `settings/qualityProfiles.tsx` + `.scss` (`.jfmod-qp-pick*`).

## What it is

A field-like trigger with a chevron that opens a paper list; the current entry has a blue left bar; each entry can carry
weight and marks (a name in 600 beside muted details), which a native `<select>` cannot. It replaces a stock select only
where the entries need that richness, and the stock select stays in the DOM as the source of truth. On the detail page the
three fields are **one strip** of three segments; the Predefined picker keeps its own field.

## The strip (detail page)

- **Box:** one field after upstream's track form (`.jfmod-strip`, as wide as the page's text column): `border .135em solid
  var(--jf-palette-FilledInput-borderColor)`, radius .2em, `background: var(--jf-palette-background-paper)`; three segments
  (`.jfmod-stripSegment--video|audio|subtitles`), Video grows, Audio and Subtitles size to their value; dividers between
  segments in the border's colour and width. A segment upstream hides (no subtitles) is not drawn; the strip goes with the
  form when upstream hides it.
- **Segment:** a caption (`.jfmod-stripCaption`: .72em, 600, uppercase, letter-spacing .06em, 62 %) over the value line
  (`.jfmod-stripValue`): the entry's first word in **600** (resolution, language), then marks ([media-marks.md](media-marks.md),
  130 %) and muted flags (`· Default`, `· Forced`, `· SDH`, a title); the Video value ends with the **file size, muted, at the
  right end before the chevron**; Audio's and Subtitles' chevron follows the value. Padding `.3em .5em .35em .6em`. Captions
  VIDEO · AUDIO · SUBTITLES stay (D8): there is no label column.
- **Hover / focus:** the segment is ringed in the primary over the strip's border (`box-shadow 0 0 0 .135em #00a4dc`), no outline.
- **One entry only** (`.jfmod-trackStatic`): the same segment without the chevron, `cursor: default`, not a focus stop.
- **Phone:** the segments stack as rows of the same card, the dividers on top.
- Upstream's Video, Audio and Subtitles rows step aside (display none) only while their segment is drawn; a row whose
  dropdown cannot mount (its streams unread) stays as upstream draws it, under the strip.

## Lists

- **Video list** (`.jfmod-fileList`, in `.jfmod-stripBelow`): **as wide as the whole strip** (D6), on the paper with a 1px
  divider border, sliding open in place (a grid row from 0fr to 1fr, 0.18 s); one row per file (quality 600, all marks, size,
  the three row icons), then the [pending download](pending-version.md) while one is on its way, then *Get Another Quality*.
  The rows' text starts where the segment's does (.735em in).
- **Audio and Subtitles lists** (`.jfmod-trackMenuPaper`, MUI Menu paper): under their segment, **right-aligned with it**, at
  least as wide as the segment and **at most 34em** (D6); on the phone exactly the card's width. The theme paper,
  `1px solid var(--jf-palette-divider)`, radius .2em, `margin-top .25em`, **max-height 20em, scrolling**, opened on the
  current entry (D7). Entries: `padding .45em .8em .45em calc(.6em − 1px − .2em)`; `border-left .2em solid transparent`, the
  current entry `--on` the primary. Entries are drawn as the closed segment draws them.
- **Titles (D5):** a track's title is shown only when it adds a word: one that only repeats the language, its code or the
  marks ("Original [ENG]" on an English track) is dropped; a long title comes last and is cut with an ellipsis, so the
  language, marks and flags stay.
- One entry per option of the hidden stock select, in its order; Subtitles start with *Off*. The entry's tooltip is
  upstream's option text.
- Keys: opens on the current entry; arrows move, Enter picks, Escape closes; focus returns to the segment. On the TV
  `shell/dpadModals` drives the menus and Back closes them.

## Behaviour

- Choosing an entry sets the hidden stock select's value and dispatches the `change` it would dispatch, so Play, audio and
  subtitles follow upstream's own code.
- The Audio and Subtitles segments mount only once their data is read (media sources, language names); until then upstream's
  rows show under the strip.
- **TV:** Down from the action row lands on Video, Right walks Audio and Subtitles, Down from the strip reaches the pending
  entry's X; Enter opens a list, Up/Down walk it, Right from a file walks its icons, Back closes.

## Settings (Predefined)

The profile dialog keeps its own skin: `padding .5em .6em`, `background rgba(255,255,255,.06)`, `border-bottom .07em solid
var(--jf-palette-divider)`, radius `.2em .2em 0 0`; the entry's **name in 600** over its one-line **description**; chevron
`.jfmod-qp-pickChevron`; hover underline in the primary; the list `.jfmod-qp-pickMenu`, as wide as the field, max-height 20em.

## Do not

- Use it where a stock select reads as well (plain words, no marks): the stock select is the default.
- Give the dropdown a third look; a new host picks the skin of its neighbours' fields and keeps the list as it is.
- Put the pending download inside a segment, or draw the strip's label column back.
