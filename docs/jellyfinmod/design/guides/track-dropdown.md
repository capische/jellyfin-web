# Track strip and dropdown (the custom dropdown)

**Quiet controls and one chooser on the computer (ds.t19): approved by the user 2026-11-08, built, not accepted, computer first
look.** The user, of workspace `reviews/netflix-tracks/codex.html`: "I love this one. Less chrome. Same control." Computer title
head only (`.jfds.dev-computer:not(.layout-tv)`, the ds.t19 block of `design/titleTop.scss`), tokens `sN` = `--jfmod-s<n>` (B = 18 px).
Phone, tablet and TV keep the strip below until their own gate.

- **Closed:** three quiet controls s0 under the action pill, s-2 apart, no captions and no glass: each the kind's s0 icon (Material
  `display`, `audio`, `subs`, muted ink), the value at B, an s-1 chevron at 61.8 %; s2 high, padding s-2 s-1, s-1 corners, the tint
  on hover and while open (the chevron turned), an s-5 primary outline s-3 out for the keyboard. Video's box starts on the pills'
  left edge, its icon s-1 in (the user 2026-11-09). Values: Video the resolution in 600 and its range mark outlined (s-3 padding, s-6 line, s-5 corners;
  the codec, bit depth and size are the chooser's); Audio the language and the audio run ([media-marks.md](media-marks.md)) in muted
  ink; Subtitles the language and its role mark, or **Subtitles Off**; a file without such tracks **No Audio** / **No Subtitles**.
- **One file:** Video is plain: the resolution, the range, codec and bit depth, then the size at s-1/600 muted; no chevron, no focus
  stop, no Video tab. Audio or Subtitles with a single entry are plain the same way. (The one-file list's pending entry stays under
  the controls.) No list shows the administrator's Delete note any more (the user 2026-11-09: it made no sense there); stock
  Delete's confirmation still carries it.
- **A 1280 px window or narrower** gives Video its own line (`.gpk::after`, the mockup's 1024 window); Audio then starts the second
  line on the column's edge.
- **The chooser** (`.vlist.chooser`, one at a time): paper, s-2 under the controls from the column's left, s7 wide (at most the column),
  s0 corners, s-2 padding, an s-6 hairline (`--hair`), shadow 0 s-1 s1 black 61.8 %, over the page. Head: a tab per choosable field
  (Video, Audio, Subtitles; s2 high, s-1 sides, s-2 corners, the open one on the tint, the others 61.8 %) and a round s2 **Close**.
  Rows at least s2, padding s-1 s0 with the text s0 + 2·s-1 in, s-1 corners: the name at B / 600 (blue when current, with the s-1
  check s0 from the left), an s-1 detail line in the head's muted ink (Video: the codec, bit depth and range marks and the episode
  range or removal date; Audio: the audio run, role mark and extra words; Subtitles: the role mark and extra words), the trailing size
  (Video) or format chip (Subtitles) s-1 at the right. The list scrolls past s5, with an s0 slot above and below it that
  shows an s0 chevron (61.8 %) while that edge has more rows (edge cues, approved by the user 2026-11-09; both slots go when every
  row fits; `EdgeCues`); a foot line s-1 at 61.8 % under an s-6 rule
  (*Select the file to play.* / *Select a language or the commentary track.* / *SDH includes sound cues. Forced translates selected
  dialogue.*). Only `.clist` scrolls: the outer chooser has no height cap or scroll, keeping the head and foot in place.
- **Behaviour:** a click opens the chooser on that control's tab with the focus on the current row; a tab (or Left / Right on a row)
  closes this field's list and opens that field's; picking a row sets the stock select as before (Play, audio and subtitles follow
  upstream's code), updates the control and closes the chooser; Escape, a click outside or Close leave without a change, Escape and Close
  returning the focus to the control. Opening and walking rows reveal them inside `.clist` only, without scrolling the page or
  the clipped title artwork; list scrolling leaves the navigation bar's page-scroll state alone. Each field keeps its own rows,
  data and selection logic (`FileChooser`, `TrackDropdown`).
- **The series page** (computer only) shows the selected episode's three controls the same way, read from the episode's media
  sources (`EpisodeTrackFields` in `TitlePage.tsx`); a choice there is passed to Play (`mediaSourceId`, `audioStreamIndex`,
  `subtitleStreamIndex`, `useSeriesEpisodes`) and forgotten when another episode is selected. While another episode's media
  sources load, the previous sources keep the controls and their space in place, inactive; changing episode closes the old
  chooser. The new episode's controls replace them when its sources arrive. No controls remain for an episode without a file
  or after an empty/failed sources response.
- Code: `design/TrackField.tsx` (`QuietField`, `ChooserFrame`, `walkList`), `components/FileChooser.tsx`, `components/TrackDropdown.tsx`,
  `design/TitlePage.tsx`, `design/SeriesEpisodes.tsx`, `design/titleTop.scss`; the strip mounts in `DesignEnvironment`
  (`components/NativeEntryDetails.tsx`) so it knows the device.

**History (the computer's strip before ds.t19).** The ds.t12, ds.t10 and earlier notes below describe the computer's glass fields
with captions, now replaced there by the controls above; their phone, tablet and TV values still hold. `TIGHT_EMS` and `.gpk.tight`
are gone.

**Golden track dropdowns and choice-only Video rows (ds.t12): approved by the user 2026-11-07 ("I like it. Let's keep what codex
suggested"; field height "Codex version"; "file size should be moved to Video similarly like 576 KBPS"), built, not accepted,
gate 1 on beta.** Reference: workspace `reviews/dropdown-golden/` and its `NOTES.md`; where they differ on height the user's later
60.88 px wins. Computer title head (`.jfds.dev-computer:not(.layout-tv)`, `design/titleTop.scss`), tokens `sN` = `--jfmod-s<n>`:
- **Strip:** s-1 under the action pill, fields s-2 apart. Each field the caption's s0 line over the value's s1 line with s-2 above
  and below: **60.88 px** (Bφ⁰ + Bφ¹ + 2·Bφ⁻²), padding s-2 / s0, **s1 corners**, open ring s-4. **Video, Audio and Subtitles s6 each, in
  one row** (323 px; at 1920 the rest of the row stays empty: the user's option A, 2026-11-07, over equal thirds). **The computer
  never stacks** (the user, 2026-11-07: "No stacking, stacking for mobile, and probably tablet portrait"): a column too narrow for
  three s6 fields shrinks all three alike (`flex: 0 1 s6`, 274 px each at 1280, 213 at 1024), **below the user's last size (245 px fields, a 1160 px window; `TIGHT_EMS`, `.gpk.tight`) the marks move up beside the
  caption's first word** (VIDEO / AUDIO / SUBTITLES; the file size, bitrate and subtitle extra step aside, the size staying in the
  Video list and the bitrate in the Audio tooltip), s-2 after the word, and the value line keeps the name and the chevron (the user,
  2026-11-07, approved from the live mockup). Marks that still do not fit drop whole (Video's as D242; Audio's 5.1, then DD+ Atmos).
  The phone and the tablet (a window under 900 px) always stack; the TV keeps D199's width test (`stacks` in `FileChooser.tsx`).
- **Captions** s-1 at an s0 pitch, s-7 tracking, 61.8 %, one line (`nowrap`, an ellipsis only as a fallback; the Philosopher's
  captions fit: 287 of 323 px, 257 of 293 px). **The Video caption carries the file size** (`VIDEO · 13.2 GB`, on every layout); the
  closed value is the resolution and its marks only, its chevron at the end like Audio's.
- **Open lists:** s-2 under their field, exactly its width, paper s0 corners, s-2 padding, shadow 0 s-2 s1 black 45 %. Rows at least
  s2 (47.12 px), padding s-2 s-1 s-2 s0, s-1 corners; a row with a second line 60.88 px. Name s0/600, s-1 after it; marks, the Atmos
  run (glyph still 0.82em of its words) and the size s-1/600 without tracking; the second line (bitrate, extra words, episode
  range, removal date) s-1 at an s0 pitch in the head's muted ink. Check s-1, s-3 from the left. Keyboard ring s-4 inside, none after
  a click. The subtitle chip s-1 type, s0 high, s-3 padding, s-4 corners (field and list); the commentary bubble an s0 glyph without
  a frame (`.rflag.glyph`). Each Video row keeps its own size, also the selected one under the caption that repeats it: the rows
  compare versions, and one rule for one or many files is simpler than dropping it for a single file.
- **The Video rows only choose, on every layout:** no History, Keep or Remove on a row. They act on the selected file from the
  title's More menu ([menus.md](menus.md), *Selected Version*). The TV's Right/Left along a row (D199) is gone: on a choice row they
  keep the focus, so the remote never leaves the open list sideways; the pending entry still walks to its X. The one-file Video
  field stays a dropdown (its list holds the pending entry).
Phone, tablet and TV keep their sizes below (only the size's move to the caption and the rows' actions apply there).

**Golden closed strip (ds.t10): approved by the user 2026-11-07, 18px base, built, not accepted.** Title head, computer layout only;
phone, tablet and TV keep the values below. Tokens `--jfmod-s<n>` from `design/_golden.scss` ([title-pages.md](title-pages.md)).
Superseded by ds.t12 above for the strip's gap, height, corners and widths. Strip s0 below the action pill, fields s-2 apart; each field at least s3 high, padding s-1 / s0, s2 corners, caption over value,
centred. Audio s6 wide, Subtitles s5 (their ratio is φ), Video the rest. Caption s-1 at pitch φ, tracking s-7, 61.8%; value s0 at
pitch φ; s-1 between the value's parts; Video's marks s-1, s-3 apart, no tracking; size s-1/600; chevron s0. The Atmos run s-1 with
s-7 tracking, glyph still 0.82em with s-3 after it, channels s-2 after the format. Open lists read the head's 18px base. The stack
test is unchanged (43.46 of the strip's em).


**A stacked strip's lists are dropdowns** (the user, 2026-11-07: "It supposed to be dropdown"; first look approved 2026-11-07): on the
computer and the TV every open list hangs under its own field over the page, stacked or not (the open field takes `z-index: 7`, since
each glass pill is its own stacking context). Only the phone opens it in the card (D197), now right under its own field: the list
carries `data-list="v|a|s"` and the stacked strip orders fields and lists with `order`, because a portal appends it after Subtitles.

**dsD (2026-11-04), built, not accepted:** title pages now draw the mockup's `gpk/seg/cap/val/vlist/vrow` through
`design/TrackField.tsx`, `components/FileChooser.tsx` and `TrackDropdown.tsx`. The source CSS replaces rd2/rd3 restyling and MUI
lists. Original selects/change events, device preference and viewer-choice protection remain authoritative. The original form's
hidden state hides the strip. Video contains video facts only; Audio/Subtitles retain roles, extra words, None/static states.
Lists cap at 20em and scroll; narrow strips stack. History consumes Back before the picker underneath. Source check/primary-name
selection, per-file actions and TV row/action navigation remain. [Full CSS and behavior inventory](../dsD.md).

**rd3 title-page integration (approved rulebook §§2/5, built, not accepted):** `shell/titlePages.scss` supplies
picker padding .382em 1em .382em 1.236em, full light-glass ink and .618 caption opacity on title heads. The
stack calculation includes the two .382em separations before testing Video's **11.7em** minimum; it still
measures the strip, not the window. The three cells, paper lists, native select source of truth and every
keyboard interaction remain as rd2 above. Video and pending rows remain **video facts only**, without Atmos/AAC.

**rd2 presentation supersedes the old strip/list skin below (approved D220, D225–D227, D251, built, not accepted):** under
`html.jfmod-chrome`, `shell/pickerChrome.scss` gives each closed cell its own borderless card-glass pill, 1.618em corners,
.382em separation, no dividers. Static cells remain static; measured widths/stacking, whole-mark dropping, rich runs and every
selection action stay. Open paper lists have 1em corners, .382em padding and a .382em gap (included in `listPlace` so available
room remains accurate), rows .618em corners. Current entry: blue name plus .618em check .236em from the left, no bar/tint;
marks, role, modifier, size and actions keep ink. Grey hover .236s, TV .236em inner ring and white double ring on row actions.
The stacked Video list still expands in flow between Video and Audio, with its existing .18s desktop slide (guide interaction);
TV switches its display instantly instead of using CSS grid. MUI track lists remain anchored on phones, not sheets. Lists
scroll vertically at 20em. Text starts at 1em to reserve the check's padding. Admin Predefined is excluded and stays as below.
The detailed content, widths, keyboard and source-of-truth rules below remain authoritative. See [menus](menus.md).

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
**The open Video list placed again on a resize**, as Audio's (the user's "Go", 2026-11-01; D166): built 2026-11-01, gate 1.
**The phone's Video list in the card, two-line rows, 40 px actions, the Video chevron in the others' column and marks dropped
whole** (the user, 2026-11-01: "Phone Video Dropdown - accepted, go implement it."; D197; mockup workspace
`reviews/video-dropdown-phone/mockup/`): built 2026-11-01, gate 1 (phone, dark and light). Computer and TV unchanged.
**The Video list always exactly the Video cell on the computer and the TV, two-line rows when the cell is narrow** (the user,
2026-11-01: "I've asked it to be exact size as Video dropdown and I thought design was approved for it"; D198, withdrawing D101's
24em minimum): built 2026-11-01, gate 1. **A narrow strip stacks, the narrow rows' size on line 1, and the TV walks a row by
itself** (the user, 2026-11-01: "move it, stack, check it"; D199): built 2026-11-01, gate 1.
**The pending entry stacks in a narrow Video list** (the user's pick, 2026-11-03; D236; [pending-version.md](pending-version.md)): approved
2026-11-03 (D238). **The strip stacks a little earlier, from a 995 px window** (the user, 2026-11-03; D238): built 2026-11-03, gate 2.
**The closed Video value drops a mark whole on a row too** (the user, 2026-11-03; D242; first look approved, D244): built 2026-11-03, gate 2.
**The phone mark** (Phase 12, user-approved 2026-10-29: "Design for mobile icon looks good for me. Go ahead"; D51, D52; mockup
`reviews/phase12/mockups/4-video-dropdown.html`): accepted 2026-10-30 (Phase 12, with the suffix D133). The mockup's *Get 1080p for Phones* row is
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
  the list's rows and the pending entry). **A mark shows whole or not at all, and comes back when there is room** (D197 on the phone, D242
  everywhere): one that does not fit before the size is dropped, never sliced, on a row and stacked; an Audio or Subtitles value is its track's run (below), the chevron at the
  cell's right end. Padding `.3em .5em .35em .6em`. Captions VIDEO · AUDIO · SUBTITLES stay (D8): there is no label column.
  **Phone** (D197): the Video chevron takes Audio's and Subtitles' `margin-right -.25em`, so the three chevrons share one column
  (measured equal at 360, 390 and 430 px).
- **A track's run** (D59, D76): the language in 600 with its short modifier `(BR)` in 400 at 70 % (a fixed table only, D60),
  .6em, the format marks (audio: the lighter audio run of [media-marks.md](media-marks.md), *Audio run*, one glyph, the short
  format and the channels at the Video marks' size, option B 2026-11-07; subtitles: the format chip `SRT`, `PGS`), then **at most one role mark**
  ([media-marks.md](media-marks.md), *Role marks*). A track's own title is never drawn in the run; Default, Original, External
  and Full are not shown (the blue bar marks the current entry). When the run is too long for its cell the modifier goes first
  (it wraps onto a hidden second line of the 1.5em box), then the language is cut with an ellipsis; the marks, the role mark
  and the chevron never shrink (D78).
- **Hover / focus:** the segment is ringed in the primary over the strip's border (`box-shadow 0 0 0 .135em #00a4dc`), no outline.
- **One entry only** (`.jfmod-trackStatic`): the same segment without the chevron, `cursor: default`, not a focus stop.
- **Phone:** the segments stack as rows of the same card, the dividers on top; every cell is the card's width. The open Video
  list is a row of the card too, between Video and Audio (D197, *Lists*).
- **A narrow strip stacks the same way** (D199, D238; `.jfmod-strip--stacked`, set by `useTrackStrip` on the strip and again on a
  resize): where the Video cell would be narrower than **11.7em** beside Audio's 17.8em and Subtitles' 13.2em, measured from the
  strip's own width, which the stacking does not change, so it never flips back and forth. **11.7em is a named exception** to the
  golden ratio (φ⁵ of the 1em base, 11.09em, until D238): it is where the pending entry's quality stays on its line. (D242 then made the closed value's marks whole or dropped at any width:
  `AVC` beside `55 MB` is dropped at 996 and 1000 px and shows from about 1008 px, beside `123 MB` from about 1024 px.) A computer window stacks at 995 px and under (measured: 996 px a row at 11.74em, 995 px stacked at 11.67em) and the
  TV at 1280 (its cell was 9.9em); the TV at 1920 stays a row. Stacked, the strip draws exactly as the phone's, the Video chevron in the
  others' column, and the Video list sits in the card (*Lists*), its rows one line or two by
  their width with the layout's own action size.
- Upstream's Video, Audio and Subtitles rows step aside (display none) only while their segment is drawn; a row whose
  dropdown cannot mount (its streams unread) stays as upstream draws it, under the strip.

## Lists

- **Every list hangs from its cell** (D100): its top is the strip's outer bottom edge, **no gap**, and it has **no top border**
  (the strip's border is the line between them), square top corners, radius `0 0 .2em .2em`; it floats over the page, which
  does not move. Placed by position with `listPlace` (in `FileChooser.tsx`): from the cell's left edge (the first cell's from
  the strip's outer left edge) to its right edge (the last cell's to the outer right edge); on the phone under the stacked
  row, the card's width. A click outside the list and its cell, Escape or Back closes it. A window resize or a rotated phone
  while a list is open places it again under its cell, without scrolling (D166; the Video list too, 2026-11-01). Only the
  Audio and Subtitles lists close when less than a row is left under the strip (D168): the Video list floats in the page,
  not in the window, so it is never pushed over the strip. **On a stacked strip the Video list is the exception** (the phone,
  D197; a narrow window or the TV at 1280, D199): it is part of the card, drawn in the Video segment under its value
  (`.jfmod-strip .jfmod-fileList`, `position: static`; the rows' text at the segment's `.6em`), so it pushes Audio,
  Subtitles and the page down with the same 0.18 s grid-row slide and covers nothing; no border, radius or shadow of its own, only
  the card's `.135em` line above it (the border's colour). A tap outside closes it at once, without the slide, so a tap on Audio or
  Subtitles opens that list under the cell where it now is; it has no spacer for the pending entry. A resize that stacks or unstacks the strip while the list is open moves the list into the card or back under the cell, open, with the focus on the same file's same control, or on that file's row when the control has gone.
- **Video list** (`.jfmod-fileList`, absolute in `.jfmod-stripBelow`, `z-index 5`): **exactly the Video cell** (D99), the
  strip's outer left edge to the Audio divider, **always, also after a resize, never wider** (D198: D101's 24em minimum is
  withdrawn; on the phone the list is the card's width inside its border, D197); on the paper with a 1px divider border and
  the popover's shadow (the border in the theme's divider `var(--jf-palette-divider)`, visible in light, unchanged in dark;
  D164), sliding open (a grid row from 0fr to 1fr, 0.18 s); one row per file: quality 600, the **video marks
  only** (codec, 10-BIT, HDR, Vision; no audio or subtitle marks and no hairline, D105), the extras (episode range,
  `removes <date>`), the size and the three row icons (the full 2.5em round buttons of
  [buttons-and-row-actions.md](buttons-and-row-actions.md), so the rows are as tall as them, D107). **The two-line row**
  (`.jfmod-fileList--two`): always on the phone (D197), and on the computer and the TV when the Video cell is narrower than
  **24em**, the one-line row's width (D198; set by the component when it places the list, again on a resize, so a window crossing
  24em switches the rows; about 16em at a 1100 px window, 12em at 1000, 10em on the TV at 1280). Line 1 the resolution (with the
  phone mark) and the marks across the whole row (one line, `padding-right 1.35em`, a mark that does not fit dropped whole); line
  2 the size in the marks' type, then the extras after a dot in 86 % at 70 % (`2.1 GB · removes 12 Nov`), the size and extras cut
  with an ellipsis when the row is short, `min-height` the action size, `margin-top -.45em`; History, Keep and Remove after the
  row's button at line 2's level, `.1em` from the bottom, and line 1 reaches over them by the row's action count
  (`--jfmod-icons`) to `.5em` from the row's edge. **On a narrow computer or TV cell the size is at line 1's right end** (D199,
  `.jfmod-fileLine--sized`: the size's own `.8em` before it, no padding after), so it is never cut beside the actions; the marks
  drop whole before it, and line 2 keeps the extras (the first without a dot) and the actions. The phone keeps the size on line
  2 (D197): at 360 px it is not cut. Padding `.4em .3em .1em`, the text at the rows'
  usual inset. **Phone:** the actions 40 px (2.7816em, glyph 1.39em), `.25em` from the row's edge, the text at the segment's
  `.6em` (the list is inside the card's border), and so the folder note (`.698em` of its 86 %): 4.33em, 62.4 px a row.
  **Computer and TV:** the buttons guide's 2.5em actions on the row's edge, the wide rows' column: 4.05em a row (60.2 px at a
  1000 px window; the TV at 1280 now stacks, D199). **The current file has
  the Audio list's current look** (D106): a `.2em` `#00a4dc` bar on the left (an inset shadow, so the text stays under the
  cell's) and MUI's selected fill `rgba(primary / selectedOpacity)`, square corners. **Another row hovered or focused is
  grey**, as in the Audio and Subtitles lists (D145): hover `var(--jf-palette-action-hover)` (8 % white) over the whole row,
  keyboard and TV focus `var(--jf-palette-action-focus)` (12 %); the current file keeps its blue under the pointer; then the
  [pending download](pending-version.md) while one is on its way (its place under the strip is kept while it sits in the
  list; in a list under 24em it stacks, D236, [pending-version.md](pending-version.md)), then the folder note. There is no *Get Another Quality* row (D102): the header's cloud icon opens the picker for
  another quality. The rows' text starts where the segment's does (.735em in). Sorted best first, whatever order the files came
  in (D114, a title can hold many files): the higher resolution (2160p, 1440p, 1080p, …), then Dolby Vision, HDR, SDR, then the
  larger file. The top file is the one TVs and computers play, and nothing names it (no "Best copy" or "Mobile copy" flag, D51).
- **The phone mark** (D52): on a title with two or more files, the one file phones play (the plugin's `phoneCopy`: the best file at
  1080p or below, never a 1440p, SDR first, D114) carries Material `smartphone` as a small suffix of its resolution, in its row
  and in the closed Video value when it is the selected file (user, 2026-10-29: "can it be suffix mobile icon? small, than we
  don't have to align it", D133): an inline SVG **0.62em** square, `currentColor`, opacity .86, placed absolutely at the
  resolution word's top right (`.jfmod-fileResolution` `position: relative`; the mark `left: 100%`, `top: .06em`,
  `margin-left: .03em`), inside the word's .8em gap, so it takes no width and the codec starts where it does on the rows
  without it (measured 482.4–483.4 px at 1280, 713.1–714.5 px TV 1920, 84.4–85.4 px phone; the 720p rows sit 7–10 px left by
  their shorter word, as before; 2–3 px between the mark and the codec; not clipped in the closed cell). A quality profile's
  name keeps the inline 1.05em mark, on every profile that plays everywhere, with its own label "Plays on phones" (D180,
  [quality-profiles.md](quality-profiles.md)); a file's mark has `role="img"`, `aria-label` and tooltip **"Phones play this copy"** (no tooltip
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
  `shell/dpadModals` drives the menus and Back closes them. **In the open Video list the TV's Right and Left walk a file's row
  themselves** (D199): the row, History, Keep, Remove and back, before the remote's own search, which tied the focused, grown
  History with the Video value above the first row and jumped there (it did so on `main-items` too); at a row's ends the keys go on
  as before.

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
- Put the pending download inside a segment (except on a stacked strip with Video open: it is the row of the Video list, in the Video segment), or draw the strip's label column back.
