# Trakt direction mark

**Status:** approved 2026-10-30 (the user: "Trakt glyph accepted too"; the Glyph in Trakt's brand violet at 1.05em, D182,
mockups `reviews/phase13/mockups-v8`); built (not accepted). Code: `settings/TraktSection.tsx` (`DirectionMark`),
`settings/settings.scss` (`.jfmod-traktMark`, `.jfmod-traktGlyph`). Used by: Settings › Trakt's Activity rows.

## What it is

One mark per Activity row that says it is Trakt and which way the title went: Trakt's disc with the check turned into the
direction. **Up**: sent to Trakt (a watch here, a collection add, a live play the Trakt plugin reported). **Down**: brought
from Trakt (a watch or a playback position the Trakt plugin's import set here). It sits in its own column between the time
and the title, so the directions read down the list, and the row's words leave "on Trakt" and "from Trakt" out.

## Anatomy and sizes

- Inline SVG, `viewBox 0 0 24 24`, **1.05em square** (computer 15.6 px, TV 21 px, phone 15.1 px), in a flex box 1.45em high
  centred on the row's first line; the row's grid is `4.6em 1.05em 1fr` with a 0.6em column gap.
- Done and failed: a disc (`r 12`), a white ring (`r 8.2`, stroke 1.7) and a white glyph (stroke 2.4, round caps and joins):
  the up arrow `M12 16.6V7.6M8.1 11.4 12 7.5l3.9 3.9`, the down arrow `M12 7.4v9M8.1 12.6 12 16.5l3.9-3.9`, or the cross
  `M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6`.
- Pending (waiting for the export, or playing now): no disc; a dashed ring (`r 10.6`, stroke 2.6, dashes `5.2 3.1`) and the
  arrow (stroke 2.6), both in `currentColor`.
- No flex gap, `:has()`, `min()` or `max()` (webOS 6).

## Colour

| State | Disc / stroke | Source |
| --- | --- | --- |
| done (up or down) | `#6438d0`, white arrow and ring (white on it 7.0:1) | Trakt brand violet, `--color-brand-violet: oklch(49% .217 289)` on [app.trakt.tv/branding](https://app.trakt.tv/branding) |
| pending | dark `#8a70f5` (4.4:1 on the section), light `#6438d0` (5.7:1) | Trakt's own `--purple-400` and brand violet, the same page's CSS |
| failed | `#ed1c24`, white cross; the row's words `#ff5a4f` (light `#c62828`) | Trakt's classic red (the earlier logo, as the ratings group draws it) |

Trakt has one brand colour, so up and down differ by the arrow, not by colour; failed is the only red mark in the list. The
violet disc against the dark section is 2.3:1; the white arrow inside carries the shape.

## Words

The mark's accessible name and tooltip: "Sent to Trakt", "Brought from Trakt", either with ", not yet done" while pending,
and "Not sent to Trakt" when failed (only sending can fail, so the failed mark has no direction). The row's action:
"marked watched", "marked watched here", "playback position: 14 min", "added to the collection", "watching now (reported
live)", "stopped at 30 % (reported live)", "waiting: …", "failed: Trakt does not know this episode".

## Trakt's branding rules

Trakt's branding page asks not to alter, modify or recolour the logo, not to use it as part of your own logo, and to use
only the approved versions. This mark is a redrawn Trakt mark (the check turned into an arrow), as the ratings group's red
ring is a redrawn earlier logo. The user accepted that trade-off on 2026-10-30. The compliant alternative, if it is ever
needed, is Trakt's official Circle Mark unaltered with a separate arrow beside it (`reviews/phase13/mockups-v6`, side).
