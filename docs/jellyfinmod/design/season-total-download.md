# Season page: the season's total download in the header — APPROVED 2026-10-24 as drawn (user: "Yes, as drawn"; total over the batch the queue knows)

Session: Row Icon State Designs (local_0162f905…). Artifact (static, theme + reduced-motion toggles):
https://claude.ai/artifact/B6Ro1yXbYBfvpGWNiYgck4 — file `season-total-download.html`, screenshots
`season-total-download-{dark,light}.png` in this folder (copy both into `docs/jellyfinmod/design/` when recording).

User: "Can you add to a season icons TOTAL progress download icon and progress text?"

Guides read: download-state-mark, download-block, card-glass, buttons-and-row-actions, media-marks (`design/guides/`).

## The proposal (one)

In the season header's action row, **right after the download cloud (Get a Release)** and before Favourite:
`Play · Played · cloud · [season total] · Favourite · More`. The season total is

- the **download state mark at row size** (2.5em, the glyph 1.4em, arc 2.2) in the header icons' colour, with the
  season's total arc and the **liveliest glyph** (downloading › importing › stalled › queued), exactly the component
  the rows use; and
- **the figure beside it** in meta style (86 %, secondary): `N of M episodes · <word>`, where the word is the meta word
  that already breathes on rows (`38% · 2 h 10 min left`, `queued`, `importing…`, `38% · stalled` without breathe):
  text colour, 600, opacity 1 → .45 over 1.2 s; "N of M episodes ·" stays muted.

Shown while any episode of the season is queued, downloading, importing or stalled; **absent** when nothing is on its
way or everything is done (the rows say what each file is). An indicator, not a button: no hover, no focus stop
(TV focus walks Play → Played → cloud → Favourite → More), the tooltip carries the breakdown
(`Downloading · 38% · 2 h 10 min left · 3.1 MB/s · 2 done, 4 downloading, 2 queued`). The cloud keeps its job.

**Phone (90 %):** the header row is centred and icon-only, so the ring joins the row and the figure becomes one centred
line under the row. **TV 125 %:** as the laptop. Dark and light: the header icons' colour, the theme's track.

## States drawn

| season | ring | figure |
|---|---|---|
| queued only | clock, no arc | 0 of 8 episodes · queued |
| downloading | arrow (bobs), arc at the total | 2 of 8 episodes · 38% · 2 h 10 min left |
| importing | spinner, 28 % segment turning | 7 of 8 episodes · importing… |
| mixed | the liveliest (arrow + arc) | 3 of 8 episodes · 52% · 1 h 05 min left |
| stalled only (table) | pause, arc 55 % | 2 of 8 episodes · 38% · stalled |
| complete / nothing | — | — |

## What "total" means (recommended; the alternative in the last line)

- **M** = every episode of this season the queue has a row for: on its way, importing, or finished in this batch (seeding
  or imported and still listed). A pack counts once per episode it holds (`pack.episodes`). Episodes nobody asked for are
  not in M.
- **N** = episodes of M whose file is in the library (imported; seeding counts as done).
- **percent** = bytes downloaded over bytes expected across M where sizes are known (a done episode is all of its bytes),
  else the plain mean of percentages — the series and season cards' fallback.
- **time left** = the longest time left among the torrents downloading (the cards' aggregate rule).
- **word and glyph** = the liveliest state present; failed episodes stay out of the total and keep the red bang on their rows.
- Alternative "of all missing episodes in the season" (unasked ones in M at 0 %): the page's own episode list gives that
  count; the figure then reads lower while part of a season is unasked. The batch is the default.

## Data

No plugin field: the page's shared queue read already has `state`, `progress`, `downloadedBytes`, `sizeBytes`,
`etaSeconds`, `downloadRateBytes` per row and `pack.episodes[]` (`progress`, `sizeBytes`, `importState`).
`aggregateProgress` in `constants/queue.ts` gains the count (N, M) and the bytes-weighted percent; `downloadMarks.tsx`
already gathers a season's rows for its card.

## Build

One hook in `EntrySeasonDetails` / the native season page mount: insert a `span.jfmod-seasonTotal` into
`.mainDetailButtons` after `.jfmod-getRelease` (the `stockHeaderButton` insert pattern, as a non-button), holding
`paintDownloadMark` at `--row` and a `.jfmod-dlMeta` figure; on `.layout-mobile` the figure is a `div` after the row
(`.jfmod-seasonTotalLine`, centred). Re-rendered from the queue read like the rows. ~60 lines TSX, ~25 SCSS.

## Not proposed

- A ring on the cloud button (an action and an indicator merged; the header already badges Played).
- The figure in the misc line under the title (far from the ring).
- Percent digits inside the header ring (row size keeps the glyph; the number is in the text).
- (Series page: was listed here; **added by the user 2026-10-24**, see below.)

## Guide text once approved

- **download-state-mark.md, Where it sits:** add "**Season header:** the row-size mark as an indicator after the Get a
  Release cloud, with `N of M episodes · <meta word>` beside it (under the row on the phone); the season's total
  (bytes-weighted mean over the batch's episodes, liveliest glyph, longest time left); gone when nothing is on its way."
- **download-state-mark.md, Text:** add the `N of M episodes ·` prefix and the breakdown tooltip.

## Series page — ADDED 2026-10-24 (user: "Also add the season total to the series page")

The same indicator on the series page header, drawn in the artifact (v3): same component, same place (after the cloud
where the page has one, otherwise before Favourite), same figure `N of M episodes · <state text>`, where M and N count
every season's episodes the queue has rows for (a pack once per episode) and the tooltip breaks the total down by season:
`Downloading · 44% · 3 h 20 min left · 3.1 MB/s · Season 1: 3 of 8 · Season 2: 2 of 8`. Percent, time left and glyph by
the same rules; absent when nothing is on its way. The series card already shows this aggregate (`aggregateProgress` over
the series' rows), so the page and the card agree; `downloadMarks.tsx` gathers a series' rows already. Guide line: the
"Season header" bullet becomes "Season and series headers".

Update 2026-10-24: the figure follows text treatment B as built (the whole "N of M episodes · 38% · 2 h 10 min left" lifted to the text colour at 600), not A.
