# Track strip and dropdown (the custom dropdown)

**Status:** the Video value as a dropdown approved 2026-10-10; Audio and Subtitles drawn the same way 2026-10-17 ("Logos,
A for size"); the same list for the profile dialog's Predefined picker 2026-10-16 ("use custom dropdown, we already got
one on details page"). **Video, Audio and Subtitles as one strip** (option B, the user's pick 2026-10-28, with the tightened
lists of approach 1; overnight decisions D4–D9 in workspace `reviews/overnight-2026-10-28/DECISIONS.md`; mockups
`reviews/upgrade-status-options/all-in-one/` and `…/lists/`): **built overnight 2026-10-28, awaiting the user's approval**.
**Audio and Subtitles rows redesigned** (the user's picks 2026-10-29: extra words option A, the FORCED / SIGNS badge, all five
voice-over marks, no detail line, each list exactly its fixed cell; decisions D59–D63, D75–D83; mockup workspace
`reviews/track-row-icons/`): **built 2026-10-29, gate 1 (computer, dark), awaiting the user's approval**.
**The Video list as a dropdown like Audio's, every list flush with its cell** (the user's look 2026-10-29; D99–D101, replacing
D6 and D28): **built 2026-10-29, gate 1 (computer, dark), awaiting the user's approval**. **No Get Another Quality row**
(the user, 2026-10-29: "I have already the cloud icon over there"; D102): the header's cloud icon opens the same picker in the
same mode; built 2026-10-29, gate 1. **The Video cell, rows and pending entry show the video only** (the user, 2026-10-29:
"I don't think we need audio quality in video dropdown or subtitles"; D105): no audio or subtitle marks, no hairline; built
2026-10-29, gate 1. **The current file marked as Audio's current track, and full-size row icons** (the user, 2026-10-29;
D106, D107): built 2026-10-29, gate 1. **Fixed cells whatever the file (None when it has no such tracks) and the size in the
marks' type** (the user, 2026-10-29; D131, D132): built 2026-10-29, gate 1. **Grey hover and focus on the other Video
rows** (the user, 2026-10-30; D145): built 2026-10-30, gate 1. **The chosen track's extra words on the closed cell's caption
line** (the user, 2026-10-30: "Love it. Accepted."; D137, D147): built 2026-10-30, gate 1.
**The phone mark** (Phase 12, user-approved 2026-10-29: "Design for mobile icon looks good for me. Go ahead"; D51, D52; mockup
`reviews/phase12/mockups/4-video-dropdown.html`): built 2026-10-29, not accepted. The mockup's *Get 1080p for Phones* row is
dropped too (user, 2026-10-29: "I have already the cloud icon over there", D103, as D102 above): the page's cloud icon opens the picker.
Records: [Video row note](../video-row-file-size.md), [UX.md §11.2](../../UX.md), [quality profiles note](../quality-profiles-redesign.md).
Code: `components/FileChooser.tsx` (`useTrackStrip`, the Video segment and list), `components/PhoneMark.tsx` + `phoneMark.scss`
(`.jfmod-phoneMark`), `components/TrackDropdown.tsx` (Audio,
Subtitles), `components/fileChooser.scss` (`.jfmod-strip`, `.jfmod-stripSegment`, `.jfmod-stripCaption`, `.jfmod-stripValue`,
`.jfmod-videoTrigger`, `.jfmod-trackTrigger`, `.jfmod-trackStatic`, `.jfmod-stripBelow`, `.jfmod-fileList*`,
`.jfmod-trackMenuPaper`, `.jfmod-trackItem`, `--on`, `--two`, `.jfmod-trackRun`, `.jfmod-trackExtra`, `.jfmod-trackLang`,
`.jfmod-trackMod`, `.jfmod-trackRoles`, `.jfmod-trackRole`), `constants/tracks.ts` (`trackRole`, `trackModifier`,
`trackExtraWords`), `settings/qualityProfiles.tsx` + `.scss` (`.jfmod-qp-pick*`).

## What it is

A field-like trigger with a chevron that opens a paper list; the current entry has a blue left bar; each entry can carry
weight and marks (a name in 600 beside muted details), which a native `<select>` cannot. It replaces a stock select only
where the entries need that richness, and the stock select stays in the DOM as the source of truth. On the detail page the
three fields are **one strip** of three segments; the Predefined picker keeps its own field.

## The strip (detail page)

- **Box:** one field after upstream's track form (`.jfmod-strip`, as wide as the page's text column): `border .135em solid
  var(--jf-palette-FilledInput-borderColor)`, radius .2em, `background: var(--jf-palette-background-paper)`; three segments
  (`.jfmod-stripSegment--video|audio|subtitles`): Audio **17.8em** and Subtitles **13.2em** wide, the divider on their left
  included (D75, D77, D80), Video takes the rest; dividers between
  segments in the border's colour and width. Every cell is always drawn at its fixed width, so switching the file never resizes the cells or their lists:
  a file with no subtitles (or no audio) reads **None** in that cell, static, no chevron (D131, replacing the hidden segment
  of D30); the strip goes with the
  form when upstream hides it.
- **Segment:** a caption (`.jfmod-stripCaption`: .72em, 600, uppercase, letter-spacing .06em, 62 %) over the value line
  (`.jfmod-stripValue`): Video's resolution in **600**, its marks ([media-marks.md](media-marks.md), 130 %) and the **file size,
  muted, at the right end before the chevron**, in the media marks' type (78 %, 700, `.05em` tracking, 70 %; D132; also in
  the list's rows and the pending entry); an Audio or Subtitles value is its track's run (below), the chevron at the
  cell's right end. Padding `.3em .5em .35em .6em`. Captions VIDEO · AUDIO · SUBTITLES stay (D8): there is no label column.
- **A track's run** (D59, D76): the language in 600 with its short modifier `(BR)` in 400 at 70 % (a fixed table only, D60),
  .6em, the format marks (audio: the media marks; subtitles: the format chip `SRT`, `PGS`), then **at most one role mark**
  ([media-marks.md](media-marks.md), *Role marks*). A track's own title is never drawn in the run; Default, Original, External
  and Full are not shown (the blue bar marks the current entry). When the run is too long for its cell the modifier goes first
  (it wraps onto a hidden second line of the 1.5em box), then the language is cut with an ellipsis; the marks, the role mark
  and the chevron never shrink (D78).
- **Hover / focus:** the segment is ringed in the primary over the strip's border (`box-shadow 0 0 0 .135em #00a4dc`), no outline.
- **One entry only** (`.jfmod-trackStatic`): the same segment without the chevron, `cursor: default`, not a focus stop.
- **Phone:** the segments stack as rows of the same card, the dividers on top; every cell is the card's width.
- Upstream's Video, Audio and Subtitles rows step aside (display none) only while their segment is drawn; a row whose
  dropdown cannot mount (its streams unread) stays as upstream draws it, under the strip.

## Lists

- **Every list hangs from its cell** (D100): its top is the strip's outer bottom edge, **no gap**, and it has **no top border**
  (the strip's border is the line between them), square top corners, radius `0 0 .2em .2em`; it floats over the page, which
  does not move. Placed by position with `listPlace` (in `FileChooser.tsx`): from the cell's left edge (the first cell's from
  the strip's outer left edge) to its right edge (the last cell's to the outer right edge); on the phone under the stacked
  row, the card's width. A click outside the list and its cell, Escape or Back closes it.
- **Video list** (`.jfmod-fileList`, absolute in `.jfmod-stripBelow`, `z-index 5`): **exactly the Video cell** (D99), the
  strip's outer left edge to the Audio divider, **at least 24em** (D101: a narrower cell, TV at 1280 where it is about 10em,
  lets the list grow right over the Audio cell, so a file row keeps two lines; not on the phone, where the list is its stacked
  cell's width, the card's, D166); on the paper with a 1px divider border and
  the popover's shadow (the border in the theme's divider `var(--jf-palette-divider)`, visible in light, unchanged in dark;
  D164), sliding open (a grid row from 0fr to 1fr, 0.18 s); one row per file: quality 600, the **video marks
  only** (codec, 10-BIT, HDR, Vision; no audio or subtitle marks and no hairline, D105), the extras (episode range,
  `removes <date>`), the size and the three row icons (the full 2.5em round buttons of
  [buttons-and-row-actions.md](buttons-and-row-actions.md), so the rows are as tall as them, D107). **The current file has
  the Audio list's current look** (D106): a `.2em` `#00a4dc` bar on the left (an inset shadow, so the text stays under the
  cell's) and MUI's selected fill `rgba(primary / selectedOpacity)`, square corners. **Another row hovered or focused is
  grey**, as in the Audio and Subtitles lists (D145): hover `var(--jf-palette-action-hover)` (8 % white) over the whole row,
  keyboard and TV focus `var(--jf-palette-action-focus)` (12 %); the current file keeps its blue under the pointer; then the
  [pending download](pending-version.md) while one is on its way (its place under the strip is kept while it sits in the
  list), then the folder note. There is no *Get Another Quality* row (D102): the header's cloud icon opens the picker for
  another quality. The rows' text starts where the segment's does (.735em in). Sorted best first, as Jellyfin lists the versions: the top file is
  the one TVs and computers play, and nothing names it (no "Best copy" or "Mobile copy" flag, D51).
- **The phone mark** (D52): on a title with two or more files, the one file phones play (the plugin's `phoneCopy`: the best file at
  1080p or below, SDR first) carries Material `smartphone` right after its resolution, inside the 600 word (`.jfmod-phoneMark`:
  an inline SVG 1.05em square, `currentColor`, opacity .86, `margin-left .28em`, `vertical-align -.15em`), in its row and in the
  closed Video value when it is the selected file; `role="img"`, `aria-label` and tooltip **"Phones play this copy"** (no tooltip
  on the TV). No mark on a single file.
- **Audio and Subtitles lists** (`.jfmod-trackMenuPaper`, MUI Menu paper): **exactly the cell** (D75). The theme paper,
  `1px solid var(--jf-palette-divider)` inside that width (`border-box`), **max-height 20em, scrolling** (D83), opened on the
  current entry (D7). MUI rounds the popover's top to a whole pixel, so it may sit up to half a pixel over the strip's border.
  The list never moves up over the strip (D149): with less than 10em under the strip the page scrolls first, and the list is
  no taller than the room left above the window's 16px margin (the TV at 1280x720 gave a 20em list 346px). A resize while it
  is open places it again the same way, without scrolling (D166); one that leaves less than a row (2.4em) under the strip
  closes it instead (D168).
- **Rows** (`.jfmod-trackItem`, D76): drawn as the cell's value, the same run packed left to right, the text starting where the
  cell's does: `padding .45em .5em .45em calc(.735em − 1px − .2em)`, `border-left .2em solid transparent`, the current entry
  `--on` the primary; no columns, no detail line (D82).
- **Extra words (D81 option A):** a title's words the run does not say (a dub's studio, a commentary's speakers, `Blu-ray CEE`),
  trimmed of known words at its start and end only (languages, codes, format and role words, "Original", "Full"), go on a tiny
  second line under the run (`.jfmod-trackItem--two`, `.jfmod-trackExtra`: .72em, 62 %, cut with an ellipsis); only those rows
  grow. "Дубляж Мосфильм" → *Мосфильм*; "Дубляж [UKR]", "Original [ENG]", "Commentary", "日本語吹替" add nothing. **The
  closed cell shows the chosen track's extra words on its caption's line** (D137, D147; mockup workspace
  `reviews/track-row-icons/closed-extra/`): `AUDIO · Мосфильм`, `SUBTITLES · Кураж-Бамбей`, the words in
  `.jfmod-stripCaptionExtra` (400, no tracking, not uppercase; the caption's .72em and 62 %), the caption one line
  (`display block`) cut with an ellipsis at the cell's edge; no extra words, the caption alone. No line is added, so the cell
  keeps its height. The caption stays `aria-hidden`; every row and the cell keep upstream's option text as their tooltip and
  the button's label.
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
