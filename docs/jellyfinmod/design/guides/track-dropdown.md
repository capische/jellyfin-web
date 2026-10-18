# Track dropdown (the custom dropdown)

**Status:** the Video value as a dropdown approved 2026-10-10; Audio and Subtitles drawn the same way 2026-10-17 ("Logos,
A for size"); the same list for the profile dialog's Predefined picker 2026-10-16 ("use custom dropdown, we already got
one on details page"). Built on `next-release` (P7.FU6, P4.FU9). Records: [Video row note](../video-row-file-size.md),
[UX.md §11.2](../../UX.md), [quality profiles note](../quality-profiles-redesign.md). Code: `components/FileChooser.tsx`,
`components/fileChooser.scss` (`.jfmod-videoTrigger`, `.jfmod-trackTrigger`, `.jfmod-trackStatic`, `.jfmod-trackMenuPaper`,
`.jfmod-trackItem`, `--on`), `settings/qualityProfiles.tsx` + `.scss` (`.jfmod-qp-pick*`).

## What it is

A field-like trigger with a chevron that opens a paper list as wide as the field; the current entry has a blue left bar;
each entry can carry weight and marks (a name in 600 beside muted details), which a native `<select>` cannot. It replaces a
stock select only where the entries need that richness, and the stock select stays in the DOM as the source of truth.

## Trigger

| | Detail page (Video / Audio / Subtitles) | Settings (Predefined) |
| --- | --- | --- |
| matches | upstream's selects beside it | the settings area's inputs beside it |
| box | height 1.75em, `padding 0 0 0 .4em`, `border .135em solid var(--jf-palette-FilledInput-borderColor)`, radius .2em, `background: var(--jf-palette-background-paper)` | `padding .5em .6em`, `background rgba(255,255,255,.06)`, `border-bottom .07em solid var(--jf-palette-divider)`, radius `.2em .2em 0 0` |
| text | the entry's first word in **600** (resolution, language), then marks ([media-marks.md](media-marks.md)) and muted flags (`· Default`, `· Forced`, `· SDH`, `· Commentary`); the Video value ends with the **file size, muted, at the right end before the chevron**, cut last | the entry's **name in 600** over its one-line **description** in the smaller secondary colour |
| chevron | `.jfmod-videoChevron`: 1.4em, opacity .7, `margin-left: auto` | `.jfmod-qp-pickChevron`, the same |
| hover / focus | border in the primary `#00a4dc`, no outline | underline in the primary |
| one entry only | `.jfmod-trackStatic`: the same field without the chevron, `cursor: default`, not a focus stop, hover does nothing | — |

## List

- `.jfmod-trackMenuPaper` (MUI Menu paper) / `.jfmod-qp-pickMenu`: the theme paper, `1px solid var(--jf-palette-divider)`,
  radius .2em, `margin-top .25em`, as wide as the field, **max-height 20em** so it opens under the field, no list padding.
- Entries: `padding .45em .8em .45em calc(.535em − 1px − .2em)` so the text starts where the field's text does;
  `border-left .2em solid transparent`; the current entry `--on` turns the bar the primary. Entries are drawn exactly as the
  closed trigger draws them (same weight, marks, flags), so closed and open read the same left to right.
- One entry per option of the hidden stock select, in its order; Subtitles start with *Off*. The entry's tooltip is
  upstream's option text.
- Keys: opens on the current entry; arrows move, Enter picks, Escape closes; focus returns to the field. On the TV
  `shell/dpadModals` drives it and Back closes it.

## Behaviour

- Choosing an entry sets the hidden stock select's value and dispatches the `change` it would dispatch, so Play, audio and
  subtitles follow upstream's own code; upstream's select hides while the dropdown is mounted and reappears if it does not.
- The dropdowns mount only once their data is read (media sources, language names, the presets); until then upstream shows.
- Phone: the trigger keeps one line and cuts the marks first; a list entry may take two lines. TV: the trigger and the
  entries are focus stops at 125 %.

## Do not

- Use it where a stock select reads as well (plain words, no marks): the stock select is the default.
- Give the two skins a third look; a new host picks the skin of its neighbours' fields and keeps the list as it is.
- Open it anywhere but under its field, or wider or narrower than the field.
