# Download state mark

**Status:** approved 2026-10-13 (ring family, artifact v3: "ring only, arrow, time left: meta line + tooltip"), glass disc
2026-10-13 (v11: "use top bar's exact recipe"), icon colour 2026-10-15 (v12: "replace yellow … to the color of icons"), importing until
the file is drawn 2026-10-18 (P4.FU12, "Go with what Codex proposed"; [no-delay design](../no-delay-codex-design.md) section 4).
Built on `next-release` (P4.FU6–FU8). Records: [UX.md §3.3](../../UX.md), [design note](../download-state-ring-family.md),
[interactive page](../download-state-ring-family.html), artifact <https://claude.ai/artifact/VLaNuUTV2m5CogxmpTJ4pC>.
Code: `components/DownloadStateMark.tsx` (`paintDownloadMark`), `components/downloadStateMark.scss` (`jfmod-dlmark-*`),
`components/_cardGlass.scss`, `constants/queue.ts` (`describeDownload`), `integration/downloadMarks.tsx`.

## What it is

One disc, one arc, one glyph per state. The glyph says *what* (arrow, clock, spinner, pause, bang), the arc says *how far*,
and the figure ("42% · 12 min left") lives on the meta line and in the tooltip, never inside the ring — except at the page
size, where there is room. The same component at three sizes, so the user learns it once.

## Sizes

| Size | Class | Box | Glyph | Arc stroke | Background |
| --- | --- | --- | --- | --- | --- |
| card | `.jfmod-dlmark--card` | 1.6em | 1em | 2.6 | glass ([card-glass.md](card-glass.md)); solid black 66 % on TV and without `backdrop-filter` |
| row | `.jfmod-dlmark--row` | 2.5em; **2.7816em on `.listItem` rows** (glyph 1.6696em, upstream's round row button) | 1.4em | 2.2 | transparent, like upstream's round icons |
| page | `.jfmod-dlmark--page` | 4em | 2em; while downloading or stalled the **percent inside** instead (`.jfmod-dlmark-num`: 1.15em, 700, tabular; the `%` 0.6em at 85 %) | 2.4 | transparent |

Arc SVG: `viewBox 0 0 36 36`, circle `r 15.9`, `pathLength 100`, `stroke-dashoffset = 100 − percent`, round caps, the
SVG rotated −90° so the arc starts at the top. Everything in `em` (TV 125 %, phone 90 %); no flex gap, `min()` or `max()`.

## Colour

- **Card:** glyph and arc in the glass ink `--jfmod-card-ink` (white; the light schemes' `text-primary`), track
  `--jfmod-card-track` (white 30 %; light black 25 %), failed `--jfmod-card-fail` (`#ff5a4f`; light `#c62828`).
- **Row and page:** `currentColor` — the colour of upstream's round row icons beside it, the page's text on the episode
  page. Track white 12 % (dark); light black 18 % on rows, 14 % on the page. Failed `#ff5a4f`, light `#c62828`.
- **Stalled:** arc and number at 55 % opacity. **Stale** (the client cannot be read): the whole mark at 55 %, last value kept.
- No amber anywhere in the download design; shape, arc and text carry the state, colour only marks failure.

## States

| State | Class | Glyph | Arc | Motion |
| --- | --- | --- | --- | --- |
| downloading | `--downloading` | arrow | the percent | glyph bobs (`jfmod-dlmarkBob`, 1.4 s ease-in-out: −0.08em → +0.12em) |
| queued | `--queued` | clock | none | — |
| importing | `--importing` | spinner arrow | **a 28 % segment** (`stroke-dasharray: 28 72`) turning | the arc turns once per 1.2 s, linear (`jfmod-dlmarkSpin`, −90° → 270°); glyph still. A full arc turning is invisible: the segment is the motion |
| stalled | `--stalled` | pause | the percent at 55 % | — |
| failed | `--failed` | bang | none | — ; replaces Not Downloaded's cloud on a row (never both) |
| not downloaded, unaired | file-state marks (`fileStateMark.scss`), same disc and ink | cloud + arrow; clock + short date | none | — |

Arc value changes ease 0.35 s (`stroke-dashoffset`). `prefers-reduced-motion: reduce` stops the bob, the turn and the
easing. Motion is transform and opacity only.

## Where it sits

- **Cards:** first in upstream's `.cardIndicators`, 0.25em before the played tick or the count pill (two icons; the pill
  is upstream's, no arrow in it); with no cluster, alone top right (`--corner`, `0.225em`). The disc wins over the
  Not Downloaded and Unaired marks in the corner. The card's bottom bar stays: 0.28em over a dark track, the download layer
  in the ink at 85 % beneath the watched layer in the primary. Failed and finished are not drawn on a card.
- **Rows:** the first round icon of the end slot, upstream's padding, nothing textual left of the icons. The figure goes on
  the meta line after the date (or, where the layout hides that line, as the row's last text line).
- **Detail line** (`QueueStatusLine`): the 2.5em disc, then "In the download queue · 42% · 12 min left", then View queue.
- **Queue page:** the disc in place of the state word; the row keeps its bar (the one place the bar is the content).
- **Release picker, added row:** the disc takes the Add slot while the torrent downloads; the X stays; no bar.
- **Episode page:** inside the download block ([download-block.md](download-block.md)); the still carries no mark.

## After the download: importing until the file is drawn

When a download ends with its file (the queue says `seeding`, a pack episode's import `completed`), a card or row that stands
for it keeps the **importing** disc (spinner, `importing…`, tooltip `Importing…`) instead of going to the Not Downloaded cloud
(P4.FU12). It is kept per target (entry, season, episode number or episode), not per element, so a card or row that upstream
draws again keeps it. It ends when the plugin's fresh entry detail (read on the plugin's push; fallback in [UX §3.3](../../UX.md)) names the item that plays the file (`playableItemId`) and the
card or row **is** that item (`data-id`) and shows no missing-file mark for two passes running; a season or series card ends
when every episode the download named is playable. A cancelled or failed download ends it at once; from 30 s after the import
the tooltip adds "(taking longer than usual)"; a safety stop at 10 minutes. The cloud never appears between the two.

## Text

The `importing…` meta word steps up from the muted meta colour to the full text colour at 600 and breathes (`opacity 1 → .45`, 1.2 s ease-in-out, `jfmod-dlBreathe`, the same keyframe as the bar; `.jfmod-dlMeta--importing`; none under reduced motion, where colour and weight alone set it apart) (user 2026-10-18).

Meta line: `42% · 12 min left` (`1 h 05 min left` from an hour), `42% · stalled`, `queued`, `importing…`,
`Failed · reason` (cut with an ellipsis). Tooltip, on every disc: `Downloading · 42% · 12 min left · 3 MB/s`, `Queued`,
`Importing…`, `Stalled at 42%`, `Failed · reason`. One mapping words both (`describeDownload`). Queued never says how
many are ahead (the client has no position).

## Interaction

Never a control: `cursor: default`, no hover growth, not a D-pad stop; the tooltip is the only affordance. A failure on a
row disables the administrator's row button while it holds.

## Do not

- Put the percent inside a card or row ring, or a bar under a row.
- Give the mark a colour of its own on rows or pages; it inherits.
- Add a glyph, a state or a size without the user's approval; keep the percent-inside and caption placements in the
  interactive page, unbuilt.
