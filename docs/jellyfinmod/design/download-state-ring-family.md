# Download state ring family — APPROVED 2026-10-13 (artifact v3)

**User's decisions (2026-10-13, verbatim intent):** ring only on rows (no bar); **arrow** inside the ring (not the percent); time left on the **meta line + tooltip** (the tooltip matters most on cards, which have no meta line); keep the percent designs on the page for later; **no arrow in the count pill** — the pill is upstream's; when a download is in progress the card shows **two icons**, the disc (arrow + arc) left of the plain count pill. Redo all cards, detail lines and rows with this design (cards: season, series, film, Next Up; rows: native episode, missing episode, library list, queue, picker added row; the episode detail line).

Undecided items from the earlier list default to what is drawn: rows transparent like upstream's round icons; failed red `#ff5a4f` on dark; stalled arc dimmed to 55 %.

Session: Row Icon State Designs (local_0162f905…). 2026-10-12.
Artifact (interactive): https://claude.ai/artifact/VLaNuUTV2m5CogxmpTJ4pC
File: `download-state-ring-family.html` (self-contained, no libraries; open in any browser), screenshot `download-state-ring-family.png`.

## Rationale

One disc, one arc, seven glyphs. The disc is the approved amber-arrow-in-dark-disc from the series sheet (v9); the only addition is a thin amber arc round it, drawn only when there is a number to draw (downloading, stalled). The glyph says *what* (arrow, clock, spinner, pause, !, cloud+arrow, clock+date), the arc says *how far*, and the figure ("42% · 12 min left") lives on the meta line and in the tooltip, never inside the ring, so it is readable at 1.6em on a card, 2.5em on a row and 125 % on TV. Every surface uses the same component with two sizes, so the user learns it once.

## The family

| state | glyph | arc | colour | clickable |
|---|---|---|---|---|
| downloading | arrow (bobs) | progress | amber `#ffb300` | no |
| queued | clock | none | amber | no |
| importing | spinner arc | indeterminate (rotating 28 % segment) | amber | no |
| stalled | pause | progress at 55 % opacity | amber | no |
| failed | ! | none | red `#ff5a4f` on dark / `#c62828` on light meta | yes (admin): search again; **replaces** the cloud, never both |
| not downloaded | cloud + arrow (approved "A") | none, no disc on rows | amber | yes (admin): opens the picker |
| unaired | clock + short date ("10 Aug" / "Aug ’27") | none | white 85 % on dark disc (cards) / muted (rows) | no |

Disc: black 66 % background, glyph 1em in a 1.6em disc on cards; 1.4em glyph in the 2.5em round-icon slot on rows (transparent background like upstream's round icons; the track ring stands in for the disc). Arc: `stroke-width` 2.6 (cards) / 2.2 (rows) in a 36-unit viewBox, `pathLength=100`, `stroke-dashoffset = 100 − pct`, 0.35 s transition; track white 18 % on cards, theme track on rows. Animations are transform/opacity only (bob ±0.1em 1.4 s, spin 1.2 s); `prefers-reduced-motion` and the page toggle stop them.

## Where it sits

- **Cards** (season, series, film, Next Up landscape): top-right, left of upstream's Played tick; the two-layer bottom bar stays (amber download under primary watched, 0.28em). A card with a **count pill** never shows the lone disc: the pill carries the white arrow before the number while something downloads (approved), the bar carries the aggregate. So the pill and the disc never sit side by side — that was the inconsistency risk, and the rule removes it.
- **Rows** (native episode, missing episode, library list, queue, picker added row): first round icon of the end slot, upstream's Played / Favourite / More follow; upstream list padding, nothing added. Percent and time after the date on the meta line: "28 Apr 2026 · 42% · 12 min left"; queued "· Queued"; failed "· Failed · <reason>" truncated with an ellipsis, full text in the tooltip. Nothing textual left of the icon cluster.
- **Picker added row**: the disc takes the Add slot while the torrent downloads, the X stays; green tick when the file is in the library.
- **Queue page row**: disc replaces the text state; the row keeps its bottom bar (it is the one place the bar is the main content).
- **Episode detail line**: disc + "In the download queue · 42% · 12 min left".
- **Pack**: each episode row shows its own arc and figure from the client's per-file progress; the season card shows the aggregate.

## Ring vs ring + bar on rows

Both are in the page (toggle). **Recommendation: ring only on rows.** The bar under a 2.5em row duplicates the arc, collides with the hover background, and at 0.28em across a full-width row it reads as a divider. Cards keep the bar because the disc is small there and the bar is what you see from across the room; rows have the figure in text.

## Combined states shown

downloading + watched + favourite (native row 2); pack season card with files + download (Season 2); season card nothing on disk downloading (Season 3); queued beside downloading (rows 3–4); importing, stalled, failed with long reason, unaired (selectable on row 3 and the film card); TV focus ring on the disc (TV device, row 3); pack episodes with their own progress (last section).

## Controls on the page

theme dark/light · device phone 360 / desktop / TV 125 % (TV draws the white double focus ring) · rows ring only / ring + bar · progress slider (animates every arc, bar and figure) · state select for native row 3 and the film card · simulate reduced motion · Tab / arrow keys move focus between the clickable discs.

## Build cost

One shared component: `DownloadStateMark { state, progress?, etaSeconds?, size: 'card'|'row', date?, onAction? }` rendering disc + arc + glyph, with the meta text as a small helper (`downloadMetaText(row)`), both fed by the existing `useQueueRowFor` / `FileStateMark` data. `FileStateMark` becomes this component (it already owns the cloud and the unaired clock). The card bar and the count-pill arrow are already approved and built; they do not change. Rough size: one TSX component, one SCSS file (`jfmod-dlmark-*`), ~250 lines, plus the mount in the five places that today show text states.

## Revision 2 (2026-10-12, artifact v2): percent inside the ring, time placements

User asked: "Can you move % inside ring? And propose how to put time?"

- **Rows (2.5em):** downloading and stalled show `42%` inside the ring (digits 0.8em of the row = 12.8 px desktop, 11.5 px phone 360, 16 px TV 125 %; the `%` is 0.62em of the digits). The arrow is not drawn: the arc plus the number already say downloading. Stalled dims the number and arc to 60 %, and the meta line says "stalled". Queued, importing, failed, not-downloaded and unaired keep their glyph. 100 % is never shown (it becomes importing). Toggle "Rows: Percent / Arrow" on the page.
- **Cards (1.6em):** the number would be 8 px, so cards keep arrow + arc + bar (the user removed percentages from cards earlier). The "Percent (2em disc)" toggle shows the alternative: a 2em disc with 11.5 px digits. Not recommended: bigger than upstream's indicators and the bar already shows progress.
- **Time left, three placements (toggle "Time left: where"):**
  - (a) **Meta line after the date** — "28 Apr 2026 · 12 min left" (the percent is no longer repeated there). **Recommended:** one line, no new element, reads with the date.
  - (b) **Caption under the ring** — "12 min" in 0.62em under the 2.5em ring, inside the end slot; the row keeps its height (still is 4em tall). Queued shows "queued", stalled "stalled". Tighter on the phone, where the end slot is already narrow.
  - (c) **Tooltip only + context on the meta line** — "Season 2 pack · 12 min left"; the tooltip carries "Downloading · 42% · 12 min left · 3.1 MB/s".
- **Times by state:** downloading "12 min left" / "1 h 05 min left"; stalled no time, the word "stalled"; importing "importing…"; queued "queued · 2 ahead" (position in the client's queue); pack episode: that file's remaining bytes ÷ the pack's rate ("55 min left" beside a sibling's "12 min left").
- The "Rows at three sizes" section shows the same four rows at 16 / 14.4 / 20 px roots regardless of the device toggle. On the phone frame only More is drawn beside the ring, as upstream does.

## What the user must decide

0. Time placement a / b / c (recommended a); cards stay arrow (recommended) or take the 2em percent disc; stalled as dimmed number (as drawn) or pause glyph with the number only on the meta line.
1. Ring only on rows (recommended) or ring + bar.
2. Rows: transparent background like upstream's round icons (as drawn) or the dark disc from the cards.
3. Failed red: `#ff5a4f` on dark as drawn, or the theme error `#c62828` / `#ff7b72` pair used elsewhere in the mod.
4. Whether stalled dims the arc (as drawn) or keeps it full amber with only the pause glyph.
