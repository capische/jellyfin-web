# Release picker: the whole dialog (design, 2026-10-10)

**The user's decisions, in this session (2026-10-10):**
1. The picker's results look is approved "style for style": the row design of the mockup is the design to build.
2. The searching state is **G2 Torrent ring with live progress** (v2; see `release-picker-searching.md` for v1/v2 and the
   plugin change).
3. The row's actions are option A with the circular "old one faint" Replace (see `release-picker-action-states.md`).
4. What a row shows: **quality, indexer (torrent site), size, seeds.** The torrent file name is **hidden by default**: it
   appears small and dim only on the hovered or focused row and in the grab status block.

Design only, nothing implemented. Mockup: https://claude.ai/artifact/UhaoaWjf5cbnb6xNAFtpVa (animated; also
`release-picker-design.html` / `.png` in this folder; generator
`/private/tmp/claude-501/-Users-kxalex-Projects-jellyfin-mod/0162f905-eb32-4c41-93bb-1753a3265e4c/scratchpad/picker/gen.py`).

Code: `ReleasePickerDialog.tsx` (`ReleaseLines`, `ReleaseRow`, `RejectedRow`, `GrabStatus`, `statusText`,
`noticeText`), `releasePicker.scss`. Get Another Quality and Get Release are the same dialog; everything here applies to
both.

## Build plan (branch `feat/release-picker-design`, 2026-10-10)

Status: **built (not accepted)** once the gates in the last list pass; this section is the plan, updated when the work lands.
The three records here (this page, `release-picker-searching.md`, `release-picker-action-states.md`) are the design and are
not reopened. Owner of the picker's look and behaviour: this slice; the soft rejection (Add/Replace on rejected rows behind a
confirmation naming the reasons) already on `next-release` is kept as it is.

**Plugin** (`plugin`, branch `feat/release-picker-design`, no migration, version stays 0.1.0.0):
- `Services/Acquisition/ReleaseProgress.cs` (new): an in-memory `ConcurrentDictionary` of per-key snapshots. A snapshot holds
  one line per enabled indexer (`queued`, `asking` with `startedAt`, then the final outcome status, `resultCount`,
  `retryAfterSeconds`) and `finished`. Entries are dropped 60 s after the search ends and the table is capped.
- `ReleaseSearchService.SearchAsync` takes an optional progress key (inside `ReleaseSearchOptions`) and writes the snapshot as
  each indexer is seeded, starts its query and ends. Without a key nothing is written; other callers are unchanged.
- `ReleasesController`: `GET /JellyfinMod/Releases?progressKey=...` passes the key on; `GET /JellyfinMod/Releases/Progress/{key}`
  answers `{ indexers[], finished }` or 404 for an unknown key. Same authorization as `/Releases`; a key belongs to the user who
  started the search.
- `Services/Acquisition/ReleaseParser.cs`, `TorznabClient.cs` (`language`, `subs` attributes on `TorznabItem`),
  `ReleaseSearchService.Evaluate` (merge) and `ReleaseParser` title tokens: `ParsedRelease.Languages` and `.Subtitles`
  (additive, optional, upper-case ISO 639-1 codes; `MULTI`/`DUAL` kept as words), and the channel count at the end of `Audio`.
- Test: `tests/PhaseFourIntegration` (Program.cs, Boundaries.cs): the Torznab boundary sends `language`/`subs` attributes and a
  per-indexer delay, the suite polls the progress route over real HTTP while a search runs.

**Web** (`jellyfin-web`, branch `feat/release-picker-design`):
- `src/apps/modern/features/jellyfinmod/components/ReleasePickerDialog.tsx`: the row (`ReleaseLines`), grab block, rejected group,
  action states, labels (Search For, Quality Profile), empty and error states, the progress poll.
- `.../components/ReleaseRowParts.tsx` (new): quality, marks (codec, HDR, Dolby/DTS marks), flags, language lines, glyphs.
- `.../components/ReleaseSearchBlock.tsx` (new): the G2 glyph, caption and indexer lines.
- `.../components/releasePicker.scss`: the style deltas of this page and of the two linked specs.
- `.../api/modApi.ts`, `.../types/acquisition.ts`: `progressKey`, `getReleaseProgress`, `parsed.languages/subtitles`.
- Runners: `scripts/jellyfinmod-e2e/live-picker.mjs`, `live-picker-extra.mjs`, `detail-design.mjs` (and `s11-fresh.mjs` where it reads
  the removed spinner or "No releases found.").
- Type (user, 2026-10-11): the mock drew the system font (its "Noto Sans" never matched), and the user chose a bundled font so the
  dialog is the same on every device: **Inter** (SIL OFL 1.1, Copyright 2016 The Inter Project Authors), static woff2 for weights
  400, 500 and 600 in Latin and Cyrillic from `@fontsource/inter` 5.3.0, family `jfmod-inter`, first in the stack with the system
  font and Noto Sans as fallbacks; the mock's 700 draws as 600. Licence text beside the files in `assets/fonts/inter/`.
- Decisions recorded at the first look (2026-10-10): the indexer stays plain right-aligned text in its column (the final rows
  mockup), not a primary-outline chip; a cancelled grab removes its status block and returns every action to idle; the channel
  count is `parsed.audioChannels`; a plugin without the progress route keeps a four-segment ring and no per-indexer lines.
- Media marks (user decision, 2026-10-10): **no official Dolby or DTS logos.** The two family marks are this fork's own
  drawings, stored as `src/apps/modern/features/jellyfinmod/assets/media-marks/dolby-family.svg` (two staggered arcs) and
  `dts-family.svg` (a wave between two end bars): one 24 x 16 viewBox, stroke in `currentColor`, `aria-hidden`, imported as
  source text through a `?raw` rule in `webpack.common.js` (listed in PHASE7 §3.5) so they draw inline with no request. They
  are original, not traced from or proportioned like the vendors' marks; the word beside each (VISION, ATMOS, TRUEHD, DIGITAL+,
  DTS, DTS-HD MA, DTS:X) names the format. A format with no family mark stays text-only. The channel count is the plugin's new
  `parsed.audioChannels`, not part of `parsed.audio`.

## Layout (unchanged structure, restyled)

Title row: title in 600 weight, a round grey Close icon (2.5em, cross glyph) at the right, the same icon language as the
row actions; it is the dialog's last D-pad stop. Then the two selects on one line (wrap below 20em each), then the
notice line, the status line, the rows, the rejected group. Nothing moves when a state changes: the status line keeps
its `min-height: 1.6em`, the searching block takes the list area.

## A row (user's order, 2026-10-10 second revision)

```
line 1:  2160p WEB-DL  [FL] [PROPER]  🔈 EN   ⧈ EN · ES · FR · DE                       9.8 GB   ↑21   TorrentGalaxy   (+) (⟳)
line 2:  HEVC  ◖◗VISION  HDR10+  ◖◗ATMOS  ◖◗TRUEHD 7.1
line 3 (focused or hovered row only):  The.Series.S02E04.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR10Plus.H.265-FLUX · score 870
```
**The release group is not shown on the row (user, 2026-10-10).** `parsed.group` leaves the summary and has no place
on line 1 or 2; it remains readable in the file name on the focused/hovered row and in the Replace confirmation.
(Where the text below still mentions "the release group at the right", read: removed.)
(User, 2026-10-10, final swap: languages and subtitles are short and stable, the media marks are the part that grows,
so the marks take line 2 and line 1 stays one line with its columns in place.)

**Line 1**, two parts. **Left**: quality · flags (FL, PROPER/REPACK) · coverage/held chips (pack rows) · speaker glyph +
audio languages · CC glyph + subtitle languages (74%, 0.75 opacity). **Right**, pinned to the first line and never
wrapping, three fixed columns right-aligned with tabular figures so they line up down the list: **size** (min 4.6em),
**↑seeds** (min 3.4em), **indexer** (min 7.4em; the green check-circle just before the name when the quality is already
in the library). **Line 2**: the media marks (wrapping freely) and the release group at the right under the indexer
(74%, dim; drop the group if the user prefers).

**Phone (user, 2026-10-10): three lines, not two.** Under `layoutManager.mobile` the row is rendered as three
left/right lines so nothing wraps unpredictably at 360px: **1** quality + flags + pack chips | size ↑seeds;
**2** languages + subtitles | indexer (with the in-library check); **3** media marks (may wrap) | group.
(User, 2026-10-10: size and seeds on the first line.) The columns
have no min-width on the phone; each right part is `margin-left: auto`, `white-space: nowrap`, `padding-left: 0.5em`.
The component picks the markup by `layoutManager.mobile` (the two layouts differ in structure, so this is not a
CSS-only switch); desktop and TV keep the two-line form above.

**Media marks are brand-style, not boxed (user, 2026-10-10).** All at 60% / 700 weight / uppercase, 0.6em apart, on
the same 1.2em track: codec as plain text (HEVC, AVC, XVID; 0.7 opacity); HDR10+/HDR10/HDR as plain text (0.9);
Dolby formats as the **Dolby double-D mark + word** (VISION, ATMOS, TRUEHD, DIGITAL / DIGITAL+); DTS as the **dts
wordmark** + variant (HD MA, X); AAC/MP3 as plain text; the channel count (7.1, 5.1, 2.0) as a dimmer 600-weight
suffix. The mockup draws monochrome approximations of the Dolby and DTS marks. **Superseded (user, 2026-10-10): the build draws
its own marks, see the build plan above; the official logos are not used.** Mapping from the parser: `parsed.codec` → codec mark;
`parsed.hdr` split on " " → DV → Dolby VISION, HDR10+/HDR10/HDR → text; `parsed.audio` split → Atmos → Dolby ATMOS,
TrueHD → Dolby TRUEHD, DD+/DD → Dolby DIGITAL+/DIGITAL, DTS-HD MA / DTS:X / DTS → dts + variant, AAC/MP3/FLAC → text,
a trailing N.N → channel suffix.

**Labels (user, 2026-10-10):** the two selects are labelled **Search For** and **Quality Profile** (Title Case, the
user's call over UX §12.1's Sentence-case field labels; record it there).

**Alignment (user, 2026-10-10: "text and icons aligned, not random"):** line 1 is one flex row, `align-items: center`,
`line-height: 1.3`; every mark after the quality is itself `display: inline-flex; align-items: center` on a **1.2em
track** (row em): badges and FL are 60% text in a 1.2em-tall bordered box; size and ↑seeds are 74% text; the
check-circle is a 1.05em glyph; the indexer is 74% text. No `vertical-align` tricks, no baseline mixing. A row without
actions (held quality) keeps an empty action slot of the same width (`5.4em`) so the indexer column does not drift.

### Hiding the file name — TV first (user's question, 2026-10-10) — **the user chose A**

What the TV has: no hover; Enter on a row grabs, so a click or Enter cannot be a reveal; **focus** is what every row
gets before Enter. Two proposals, both in §4 of the mockup:

- **A (recommended): the focused row expands.** The row that has focus (TV: the ring; desktop: hover or keyboard focus)
  grows a third line with the file name at 80% / 0.55 opacity, wrapped. Only that row changes; rows below it move down,
  nothing above the focus ring moves (UX §13.2 holds), and the ring stays on the same element. The D-pad user reads the
  name on the row they are about to press. Implementation: a `jfmod-releaseItem--focus` class set from the row button's
  and both actions' focus/blur (no `:focus-within`, which old webOS lacks), plus `:hover` for the mouse; no animation
  (`display` toggles), so reduced motion needs nothing.
- **B: one fixed line under the status.** "File  The.Series…" shows the focused/hovered row's name in a line reserved
  under the status (min-height 1.5em so nothing shifts; "—" when no row is focused). No row ever changes height, but
  the eye jumps from the row to the top, and on a list that scrolls the line scrolls out of view with the status.
- Not proposed: a "Show file names" switch (a new D-pad stop above the list, against UX §13.4), a long-press (not on a
  remote), or Enter as a toggle (it grabs).
- **Phone** (no hover, no focus): the name shows where it matters: in the grab block under the row during the hold,
  with Cancel beside it, and in the Replace confirmation text, which already names the release.
- **Quality** = `parsed.resolution + source` only ("2160p WEB-DL"), 600 weight. Codec, HDR, audio and group leave the
  summary and become badges / the second line.
- **Indexer** right after it as the one primary-outline chip (`.jfmod-releaseChip--indexer`).
- **Size and seeds** right after the indexer, in one non-wrapping span: `9.8 GB` then an **up-arrow glyph** (1em
  stroke SVG, `arrow_upward` shape) + the number; "?" after the arrow when seeders are null. No word "seeds".
- **Badges**, Jellyfin's own media-info style (uppercase, 68%, 700 weight, 1px `currentColor` border, 0.2em radius,
  0.75 opacity, video ones 0.85): video first (`parsed.codec` → HEVC / AVC / XVID…, then `parsed.hdr` split on " "
  → DV, HDR10+, HDR10, HDR), then audio (`parsed.audio` split → ATMOS, TRUEHD 7.1, DTS-HD MA, DTS:X, DD+ 5.1, AAC
  2.0 …). They are typographic marks, not the Dolby/DTS logos (trademarks; and the parser gives words, not formats
  with a glyph each). PROPER / REPACK are a badge in the primary colour.
- **Flag icons** at the end of line 1: **Freeleech** = a small `FL` badge in the green (`#81c784` / light `#2e7d32`),
  the mark every tracker uses; **In library** = a check-circle glyph (circle + tick, 1.1em, green) with
  `title="In library"`; the chip text "In library" goes.
- **Coverage / held** chips (`Season 2 · 8 episodes`, `3 held`) stay as today (currentColor border), after the seeds.
- **Line 2** (82%, 0.7 opacity): a speaker glyph + audio languages (`EN · DE`), a CC-box glyph + subtitle languages
  (`EN · DE · FR`), and the release **group** at the right end (`margin-left: auto`). Codes are upper-case ISO 639-1.
  **Needs a plugin change:** `ReleaseParser` has no language or subtitle output today. Add `languages: string[]` and
  `subtitles: string[]` to `parsed` from (a) Torznab attributes `language` / `subs` where the indexer sends them and
  (b) title tokens (MULTi, DUAL, GERMAN, FRENCH, ITA, JAP, VOSTFR, "SUBBED", "ENG SUBS", "MULTi-SUBS"…). Until then the
  line shows only what exists: the group, and the line is omitted when there is nothing to say.
- A held quality (user, 2026-10-10): **no sentence**. The green check-circle glyph (1.1em, `#81c784` / light
  `#2e7d32`) sits right after the quality on line 1, before FL/PROPER, with `title`/`aria-label` "In library"; the row has
  no actions (empty 5.4em slot keeps the columns) and the row button's name adds ", in library" for screen readers. The
  words "this quality is already in the library" and the "In library" chip are gone. Nothing is drawn before the indexer.
- **File name** (`rawTitle`) and score: hidden by default, see below.
- On a phone line 1 wraps (quality + indexer, then size/seeds and the badges as one wrapping run, then the flags), the
  actions stay at the right, line 2 follows.

Glyphs (24-unit viewBox, stroke 2.2, round caps, `currentColor`):
```html
<!-- seeds -->      <path d="M12 19V5M6 11L12 5L18 11"/>
<!-- in library --> <circle cx="12" cy="12" r="8.5"/><path d="M8 12.5L10.8 15.3L16 9.5"/>
<!-- languages -->  <path d="M4 9.5V14.5H8L13 18.5V5.5L8 9.5Z"/><path d="M16.5 9A4.2 4.2 0 0 1 16.5 15"/><path d="M19.2 6.3A8.2 8.2 0 0 1 19.2 17.7"/>
<!-- subtitles -->  <rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10.6 10A2.6 2.6 0 1 0 10.6 14M17 10A2.6 2.6 0 1 0 17 14"/>
```
Screen readers: the glyphs are `aria-hidden`; the row button's accessible name stays the quality line, and the seeds
span gets `aria-label="48 seeders"`, FL `aria-label="Freeleech"`, the languages spans "Audio: English, German" /
"Subtitles: English, German, French" (`title` for the tooltip, Sentence case).
- **File name** (`rawTitle`): `.jfmod-releaseTitle` becomes `display: none` by default and `display: block` on
  `.jfmod-releaseItem:hover` and when the row button or either action has focus (`:focus-within` is not safe on old
  webOS; set a class from the focus/blur handlers, or use `.jfmod-releaseRow:focus + …` sibling selectors). It renders
  at 80%, 0.55 opacity, wrapped, never truncated (UX §9 still holds: it is the diagnostic), with ` · score 820` at
  its end. On a phone there is no hover and a tap grabs, so the name shows where it matters: in the grab status block
  under the row (below), and in the Replace confirmation text, which already names it.
- Actions at the right: Add (+) and Replace (circle, old arc faint) as the approved action design; a held quality has no
  actions; a rejected row has them behind the confirmation as today.
- Row hover/focus background stays `rgba(0,164,220,.2)`; TV focus adds the white 0.16em ring (`show-focus`).

## The grab, under its row

The status block keeps its left primary border and moves under the grabbed row (it already does when the row is
listed). It carries the sentence, the button, and the **file name** on its own line (80%, 0.55 opacity, wraps):
- held: "Sending to the download client in 8 s." + raised **Cancel** + file name; the row's pressed action works
  (the + pulses, the circle turns), every other action in the dialog is `aria-disabled` at 0.5.
- submitting: "Sending to the download client…" + file name.
- accepted: border and sentence in green (`#81c784` / light `#2e7d32`), "The download client accepted the torrent.",
  flat **Open in Client**, file name; the row's action shows the green tick and stays so while the picker is open; every
  other action stays off (`grabDisabled` already does this).
- failed / refused: border and sentence in the error colour, the server's message, file name; the action shows the red
  `!` for 3 s then returns to idle; the other rows come back.
- cancelled: the block goes, everything returns to idle.

## Searching

**The user's pick is G2 with live progress (v2)**: the ring whose segments take each indexer's colour as it answers
(green answered, red failed/paused, blue asking, dim waiting), the one in `release-picker-glyph-compare.png`; at 0 s
every segment is blue and breathing until the first indexer answers. The glyph in this page and in
`release-picker-searching.md` is the same drawing (verified side by side, same paths and colours).

The G2 Torrent ring, 4em, primary, centred in the list area with the caption "Searching N indexers · S s" and the
per-indexer lines (name + state). Live progress colours the ring's segments and settles the lines one by one (v2); v1
shows every line as "asking…" until the one answer lands. A scope or profile change dims the old rows to 0.3 and
places the block over them on a paper-coloured panel (plain colour, 0.94 opacity, no blur). Full spec, including the
plugin side channel, screen-reader rules and reduced motion, in `release-picker-searching.md`.

## Empty and error states

- No results: the ring still and dimmed (secondary colour, 0.6), caption "No releases found", every indexer line settled
  ("nothing" / "paused until HH:MM").
- Every indexer failed or paused: ring and caption in the error colour, "No indexer answered · try again at HH:MM"
  (latest `retryAfterSeconds`; "try again later" if none), each line with its reason. Never "No releases found." here.
- Partial results: the status line reads "N releases · A of B indexers answered" and the red partial line names the
  failed ones with their reason, as today.

## Rejected group

Flat toggle "▸ N Rejected" / "▾ N Rejected" in the secondary colour; open rows at 0.75 opacity with the reason in the
error colour on a third line, same row layout and actions (behind the confirmation). Their file name follows the same
hover/focus rule.

## TV, phone, light

- TV (125%, fullscreen): same layout; the row button and each action are their own D-pad stops; the focused row shows
  its file name (so the TV user can read it before pressing); nothing inside the searching block is focusable; Close is
  the last stop.
- Phone (90%): one column; the row's summary wraps (quality, chips, meta on two lines when needed); actions stay at the
  right; the file name shows only in the grab block and the confirmation.
- Light scheme: paper `#fff`, text `#222`, secondary `rgba(0,0,0,.6)`, row hover the same primary tint, green
  `#2e7d32`, red `#c62828`, Replace `#c62828`.

## Styles (deltas to releasePicker.scss, em units, jfmod- classes only)

```scss
.jfmod-releaseChip--indexer { margin-left: 0.5em; }                       // primary border, as .jfmod-releaseChip
.jfmod-releaseLine { display: flex; flex-wrap: wrap; align-items: center; }
// line 1 (2026-10-10): left part wraps, right columns pinned to the first line; every mark inline-flex centred on a 1.2em track
.jfmod-releaseLine { display: flex; align-items: flex-start; line-height: 1.3; }
.jfmod-releaseLeft { display: inline-flex; flex-wrap: wrap; align-items: center; flex: 1 1 0; min-width: 0; }
.jfmod-releaseLeft > * { display: inline-flex; align-items: center; }
.jfmod-releaseQuality { font-weight: 600; margin-right: 0.35em; }
.jfmod-releaseGlyph-small { width: 1em; height: 1em; display: block; flex: 0 0 auto; }
.jfmod-releaseMark { height: 1.2em; margin-right: 0.6em; font-size: 60%; font-weight: 700; letter-spacing: 0.05em; opacity: 0.82; text-transform: uppercase; white-space: nowrap; }
.jfmod-releaseMark--brand { letter-spacing: 0.08em; }                                     // Dolby glyph + word
.jfmod-releaseMark--brand .jfmod-releaseBrandGlyph { width: 1.55em; height: 1.05em; margin-right: 0.3em; display: block; fill: currentColor; }
.jfmod-releaseMark--dts { font-size: 80%; font-weight: 900; letter-spacing: -0.03em; text-transform: lowercase; margin-right: 0.3em; opacity: 0.9; }
.jfmod-releaseMark--variant { margin-left: -0.25em; }                                     // HD MA, X after dts
.jfmod-releaseMark--channels { opacity: 0.6; font-weight: 600; letter-spacing: 0.02em; margin-left: -0.3em; }
.jfmod-releaseMark--hdr { opacity: 0.9; }  .jfmod-releaseMark--codec { opacity: 0.7; }
.jfmod-releaseBadge--note { height: 1.2em; margin-right: 0.3em; padding: 0 0.3em; box-sizing: border-box; border: 1px solid #00a4dc; border-radius: 0.18em; color: #00a4dc; font-size: 60%; font-weight: 700; text-transform: uppercase; }   // PROPER, REPACK (a boxed flag, not a brand)
.jfmod-releaseFlag--freeleech { height: 1.2em; margin-right: 0.3em; padding: 0 0.3em; box-sizing: border-box; border: 1px solid #81c784; border-radius: 0.18em; color: #81c784; font-size: 60%; font-weight: 700; }
.jfmod-releaseChip { height: 1.2em; box-sizing: border-box; margin-right: 0.3em; padding: 0 0.4em; font-size: 70%; }   // coverage / held, as today otherwise
.jfmod-releaseRight { display: inline-flex; align-items: center; flex: 0 0 auto; height: 1.3em; margin-left: auto; padding-left: 0.6em; font-size: 74%; color: var(--jf-palette-text-secondary, rgba(255,255,255,.7)); opacity: 0.9; white-space: nowrap; font-variant-numeric: tabular-nums; }
.jfmod-releaseCol { display: inline-flex; align-items: center; justify-content: flex-end; }
.jfmod-releaseCol--size { min-width: 4.6em; }  .jfmod-releaseCol--seeds { min-width: 3.4em; }  .jfmod-releaseCol--indexer { min-width: 7.4em; }
.jfmod-releaseCol--seeds .jfmod-releaseGlyph-small { width: 0.95em; height: 0.95em; margin-right: 0.1em; }
.jfmod-releaseFlag--held { color: #81c784; margin-right: 0.3em; }                         // check-circle glyph 1.05em, inside the indexer column
.jfmod-releaseActions--empty { width: 5.4em; }                                            // a row without actions keeps the columns
.layout-mobile .jfmod-releaseLine { flex-wrap: wrap; }                                    // phone: the right group drops under the marks
.layout-mobile .jfmod-releaseLeft { flex: 1 1 100%; }
.layout-mobile .jfmod-releaseRight { height: auto; margin: 0.1em 0 0 auto; padding-left: 0; }
.layout-mobile .jfmod-releaseCol--size { min-width: 4em; }  .layout-mobile .jfmod-releaseCol--seeds { min-width: 2.8em; }  .layout-mobile .jfmod-releaseCol--indexer { min-width: 0; margin-left: 0.6em; }
.jfmod-releaseLine2 { display: flex; flex-wrap: wrap; align-items: center; margin-top: 0.1em; font-size: 74%; opacity: 0.7; line-height: 1.4; }
.jfmod-releaseLang { display: inline-flex; align-items: center; margin-right: 1em; }
.jfmod-releaseGroup { margin-left: auto; opacity: 0.8; }
.jfmod-releaseTitle { display: none; font-size: 80%; opacity: 0.55; }
.jfmod-releaseItem:hover .jfmod-releaseTitle,
.jfmod-releaseItem--focus .jfmod-releaseTitle { display: block; }          // class set on focus/blur of the row and its actions
.jfmod-grabStatus-title { flex-basis: 100%; font-size: 80%; opacity: 0.55; word-break: break-all; }
.jfmod-grabStatus--ok { border-left-color: #81c784; }
.jfmod-grabStatus--error { border-left-color: #c62828; color: #ff7b72; }
.jfmod-releaseList--stale > .jfmod-releaseItem { opacity: 0.3; }
```
Plus the action-state and searching-block styles from the two linked specs. No `!important` outside the reduced-motion
override; no filter, backdrop, min()/max() or flex gap.

## Words (UX §12.1)

Buttons Title Case: Cancel, Open in Client, Close, Add, Replace. Status and lines Sentence case: "Searching 4 indexers",
"3 releases · 3 of 4 indexers answered", "No releases found", "No indexer answered · try again at 16:05", "paused until
16:05", "timed out", "rate limited · retry 16:05", "nothing", "asking…", "waiting". Tooltips on the actions:
"Add", "Replace", and in the done/failed states "Add — In the Download Queue" / "Add — Failed".
