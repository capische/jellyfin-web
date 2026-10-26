# Download state mark

**Status:** approved 2026-10-13 (ring family, artifact v3: "ring only, arrow, time left: meta line + tooltip"), glass disc
2026-10-13 (v11: "use top bar's exact recipe"), icon colour 2026-10-15 (v12: "replace yellow … to the color of icons"), importing until
the file is drawn 2026-10-18 (P4.FU12, "Go with what Codex proposed"; [no-delay design](../no-delay-codex-design.md) section 4), state text
treatment B 2026-10-19 (P4.FU15, "I'd go with B, 600, Inter, but no need for Downloading ... just put % and time"; design
session's playground, artifact <https://claude.ai/artifact/G2NS7itUD3zTFSeoBdW2i4>), an administrator's ring opens the download client
2026-10-19 (P4.FU16, the user's answers: "The buttons only (I believe you meant a ring)", "Administrators only"; built, not accepted),
the season's total in its header 2026-10-22 and the series' 2026-10-24 (P4.FU21, "Season total is good too but apply new download
state text", "keep B", "yes add series page total"; [design note](../season-total-download.md), artifact
<https://claude.ai/artifact/B6Ro1yXbYBfvpGWNiYgck4>; built, not accepted), the seeding disc and the Queue page's discs-only State
column with every detail in a tip 2026-10-26 (P4.FU28, "approve both"; workspace `reviews/queue-state-icons/`; built, not accepted).
Built on `next-release` (P4.FU6–FU8, FU15 not accepted). Records: [UX.md §3.3](../../UX.md), [design note](../download-state-ring-family.md),
[interactive page](../download-state-ring-family.html), artifact <https://claude.ai/artifact/VLaNuUTV2m5CogxmpTJ4pC>.
Code: `components/DownloadStateMark.tsx` (`paintDownloadMark`), `components/downloadStateMark.scss` (`jfmod-dlmark-*`),
`components/_cardGlass.scss`, `constants/queue.ts` (`describeDownload`, `batchProgress`, `seedProgress`, `seedingFacts`), `integration/downloadMarks.tsx`,
`components/SeasonTotal.tsx` and `seasonTotal.scss` (the season header).

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
| seeding | `--seeding` | the arrow turned up (`M12 20V7`, head at 7: sending, not receiving) | **how far to release**: the slower of its goals (ratio 0.19 of 1.00 and 4 d of 7 d → 19 %); full once the goals are met; empty with no seeding figures | none (seeding lasts days) |
| releasing | `--releasing` | the up arrow | importing's turning 28 % segment | the arc turns as importing's |
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
- **Queue page:** the State column holds **only the disc**, every state's words in its tip (P4.FU28): a download's family, the
  seeding disc for a seeding copy, the red bang for a blocked or failed import. The row keeps its bar (the one place the bar is
  the content). **Computer:** the product's MUI tooltip **above** the disc (`placement="top"`, as the picker's (i)), one fact
  per line (`.jfmod-queueTipLine`): `Seeding · ratio 0.19 of 1.00 · seeded 4 d of 7 d`, `Waiting for the ratio goal and the
  seeding time goal`, and for an administrator's linked disc `Open Shared Transmission (VPN)`; the disc drops its native
  tooltip (`hostTip`). Every disc is one Tab stop with its tooltip on focus as on hover (Codex final review, 2026-10-26): a
  linked disc is the stop itself (Enter opens the client), any other one (failed, blocked, an ordinary user's, a client with no
  saved link) through its wrapper (`.jfmod-queueStateFocus`, `tabindex 0`, the same cyan ring for the keyboard only, Enter does
  nothing). **Phone:** the disc is a button (`.jfmod-queueStateButton`, the cyan ring for the keyboard only) whose tap
  opens the [info tip's popover](info-tip.md): the state word as title, the facts (the first capitalised), and for an
  administrator the `Open <client>` link; the tap never opens the client itself. **TV:** the row is one button whose Enter opens
  the action sheet, so the disc is no stop; the facts stay as lines under it (`.jfmod-queueDetail`), all but a download's
  figures, which the row already shows. What each state's tip says:

  | State | Tip (first line, then one per line) |
  | --- | --- |
  | queued, downloading, stalled, importing, unknown | the disc's own tooltip as before (`Downloading · 42% · 12 min left · 3 MB/s`, `Stalled at 42%`, `Linking into the library`, `… · last known`) |
  | held, submitting | `Queued · waiting to be sent to the download client` (`being sent …`) |
  | blocked, failed | `Blocked · <the reason sentence>`; Retry stays in the row menu |
  | seeding | `Seeding · ratio … of … · seeded … of …`; then what the release waits for (`Waiting for …`), `Releasing the seeding copy` or `Goal met`; then why it is kept (a blocked release's reason, or `Kept seeding: automatic release is off.` once the goals are met). "Seeding until its goal is met." is never shown: the waiting line says it |
  | a pack with episode problems | the torrent's tip, then one line per episode (`S01E03: The pack holds no file for this episode.`) |
- **Release picker, added row:** the disc takes the Add slot while the torrent downloads; the X stays; no bar.
- **Episode page:** inside the download block ([download-block.md](download-block.md)); the still carries no mark.
- **Season and series headers** (the native and the mod's season page, the native series page): the row-size mark (2.5em) as an
  indicator in upstream's action row, after the Get a Release cloud and before Favourite (`span.jfmod-seasonTotal`), then 0.45em
  on the figure at 86 %: `2 of 8 episodes · 38% · 2 h 10 min left`. On the phone (`.layout-mobile`) the ring stays in the centred
  row and the figure is one centred line under it (`.jfmod-seasonTotalLine`); the TV is the desktop row at 125 %. The total over
  the batch (`batchProgress`): M is every episode of the season (of every season on the series page) a queue row names (on its
  way, importing, or in the library by a row still listed; a pack once per episode), N those in the library; the percent
  bytes-weighted over M when every size is known, else the plain mean; the longest time left; the liveliest glyph; failed and
  blocked episodes left out. Shown while one episode is queued, downloading, importing or stalled; gone when nothing is. Never a
  control, a link or a D-pad stop, for anyone.

## After the download: importing until the file is drawn

When a download ends with its file (the queue says `seeding`, a pack episode's import `completed`), a card or row that stands
for it keeps the **importing** disc (spinner, `importing…`, tooltip `Importing…`) instead of going to the Not Downloaded cloud
(P4.FU12). It is kept per target (entry, season, episode number or episode), not per element, so a card or row that upstream
draws again keeps it. A card or row of one episode or a movie ends it at once when the plugin's fresh entry detail (read on the
plugin's push; fallback in [UX §3.3](../../UX.md)) names the item that plays the file (`playableItemId`) and the card or row
**is** that item (`data-id`). A season or series card ends it when the detail names every episode the download named as
playable and the card shows no missing-file mark for two passes running. On a page that does not read the title's detail
(Home, a library grid, search), a waiting card reads it itself, once per queue read (the push reads the queue first), so the
ring ends there as fast as on the title's own page. A cancelled or failed download ends it at once; from 30 s after the import
the tooltip adds "(taking longer than usual)"; a safety stop at 10 minutes. The cloud never appears between the two.

## Text

**Treatment B (P4.FU15, user 2026-10-19).** The state text on a row's meta line and the picker's added-row figure is lifted as a
whole: the text colour (`--jf-palette-text-primary`) at weight **600**, in Inter (the mod font reaches it through the `jfmod-`
class), tabular figures, one rule for every state (`.jfmod-dlMeta` in `downloadProgress.scss`). A waiting state (queued, stalled)
is that at 75 % opacity so the active ones lead; a failure is the failed red at the same weight; a client that could not be read
is 55 % (it wins over the 75 %). Nothing animates: no breathing anywhere (user 2026-10-19: "remove the whole breathing animations
completely"). The ring's own bob and turn stay.

| State | Meta line, picker figure | Disc tooltip (keeps the full words) |
| --- | --- | --- |
| downloading | `42% · 12 min left` (`1 h 05 min left` from an hour; `42%` alone when the time is unknown); **no "Downloading" word** | `Downloading · 42% · 12 min left · 3 MB/s` |
| queued | `Queued` | `Queued` |
| importing | `Importing…` | `Importing…` |
| stalled | `Stalled · 42%` | `Stalled at 42%` |
| failed | `Failed · reason` (red, cut with an ellipsis) | `Failed · reason` |

The season and series headers put `N of M episodes · ` before the state text, the whole figure in the same treatment B, and the
tooltip adds the breakdown: on a season by state, `Downloading · 38% · 2 h 10 min left · 3 MB/s · 2 done, 4 downloading, 2 queued`
(one kind alone: `Queued · 8 episodes`); on a series by season, `… · Season 1: 3 of 8 · Season 2: 2 of 8`. One mapping words both (`describeDownload`). Queued never says how many are ahead (the client has no position). The picker's
row label for assistive technology reads the tooltip, so "Downloading" is not lost. The Queue page draws the disc instead of
words and is unchanged; the download block follows the same rule ([download-block.md](download-block.md)).
A ring that opens the client adds a second tooltip line, `Open <client name>` (`Open Transmission`), and is named
`Open Transmission (Downloading · 42% · …)`.

## Interaction

**For an administrator, a queued, downloading, importing, stalled, seeding or releasing ring opens the download client's web page** in a new tab
(`window.open(url, '_blank', 'noopener')`; P4.FU16, user 2026-10-19), wherever it is drawn: cards, rows, the detail line, the Queue
page, the picker's added row and the download block. The link is the client's saved *Web interface link*, which the queue gives
only to administrators (`client.openUrl` on `GET /JellyfinMod/Queue`; `ringLink`); with no saved link the ring stays as below. A
linked ring is `role="link"` (`.jfmod-dlmark--link`): a pointer and its tooltip, and nothing drawn under the mouse or after a
click (user 2026-10-19: "Selection of buttons are awful, probably remove selection at all"); only the keyboard gets the cyan
ring (`0 0 0 0.15em #00a4dc`, `:focus-visible`). A Tab stop on the desktop and phone
layouts (not inside the picker's added slot, which is hidden from assistive technology; the title row has the same link), Enter
opens it. Its click opens only the client, never the card or row's title. No colour of its own.

Everyone else, every failed ring, every Not Downloaded and Unaired mark, and every ring on the TV (nothing there can open a tab):
never a control, `cursor: default`, no hover growth, not a D-pad stop; the tooltip is the only affordance; a click on a card's
disc is a click on the card. (On the Queue page the computer's keyboard still reaches such a disc's tooltip through its wrapper, above.) A failure on a row disables the administrator's row button while it holds.

## Do not

- Put the percent inside a card or row ring, or a bar under a row.
- Give the mark a colour of its own on rows or pages; it inherits.
- Add a glyph, a state or a size without the user's approval; keep the percent-inside and caption placements in the
  interactive page, unbuilt.
