# Download block (missing episode page)

**Status:** approved 2026-10-13 (artifact v2: "no download cloud over the episode card"), colours to the icon colour
2026-10-15, state-line text treatment B 2026-10-19 (P4.FU15, user: "I'd go with B, 600, Inter, but no need for Downloading ... just put % and time"; design session's playground, artifact <https://claude.ai/artifact/G2NS7itUD3zTFSeoBdW2i4>). Built on `next-release` (P1.FU20, P4.FU8, P4.FU15 not accepted). Records: [design note](../missing-episode-page-download-block.md),
[interactive page](../missing-episode-page-download-block.html), artifact <https://claude.ai/artifact/1Fu8eWkkNgzobkRimgHfHS>,
[UX.md §7.2.1](../../UX.md). Code: `components/DownloadBlock.tsx`, `components/downloadBlock.scss` (`.jfmod-dlblock*`),
mounted by `EntryEpisodeDetails` into the track-selector slot.

## What it is

One paper panel where a downloaded episode's page has its Video / Audio / Subtitle rows: the download ring at 4em on the
left, and on the right the state word with its figures, the release name, its marks, the pack line, a thin bar and the
actions. It carries the whole download state of the page; the still above it is plain (no disc, cloud or mark). When the
import finishes the panel is replaced by upstream's track rows and Play appears.

## Anatomy and sizes

- Slot `.jfmod-dlblockSlot`: `max-width 60em`, `margin 0 0 1.2em`.
- Panel `.jfmod-dlblock`: flex, `padding 1em 1.1em`, radius .3em, `background: var(--jf-palette-background-paper)`,
  `box-shadow 0 1px 2px rgba(0,0,0,.2)`; sets `--jfmod-paper` to the paper so the marks' chips knock out correctly.
- Ring `.jfmod-dlblock-ring`: the download mark at page size ([download-state-mark.md](download-state-mark.md)), 4em, percent
  inside while downloading or stalled; `margin-right 1.1em`. Not Downloaded and Unaired show the glyph alone (2em, unaired
  at 70 %).
- State line `.jfmod-dlblock-state`: 1.05em. **Treatment B** for the five download states: the whole line, word and figures, in
  the text colour at 600 (Inter), a waiting state (queued, stalled) at 75 %, a failure whole in `--jfmod-dlblock-error`
  (`#ff7b72`; light `#c62828`). **Downloading has no word on screen**: the line is the figures only,
  `42% · 12 min left · 3.1 MB/s · 1.9 of 4.6 GB`; the word stays in the DOM, visually hidden
  (`.jfmod-dlblock-word--hidden`), for assistive technology. Other states keep the word, then the figures:
  `Stalled 42% · no progress for 20 min`. Not Downloaded and Unaired keep the quiet look (word 600, figures muted at 70 %).
- Release name `.jfmod-dlblock-release`: monospace, .8em, 70 %, one line with an ellipsis.
- Marks line `.jfmod-dlblock-marks`: .9em; quality word, [media marks](media-marks.md), language (.74em, 700, spaced,
  82 %), size, the indexer name (80 %; a link when the plugin keeps the release page), and for administrators the client's
  round 1.9em *Open Transmission* icon at 75 %.
- Pack line: "Season 1 pack · this episode is file 6 of 10" with one dot per episode: imported in `--jfmod-dlblock-ok`
  (`#81c784`; light `#2e7d32`), downloading as a small ring, waiting in the track colour.
- Bar: 0.28em over `--jfmod-dlblock-track` (white 12 %; light black 14 %), the fill in the page's text colour; stalled dims
  it to 55 %; importing shows a full bar, still (no breathing anywhere since 2026-10-19: the bar and the state words do not animate).
- Actions: *View Queue* (link, everyone), *Cancel Download* (grey, administrators), *Search Again* (red, administrators,
  failed), *Get a Release* (blue, administrators, not downloaded); Title Case, sized like Save
  ([buttons-and-row-actions.md](buttons-and-row-actions.md)). *Cancel Download* asks the *Remove the Torrent* confirmation
  (red Remove) and, since 2026-10-26, deletes what the torrent downloaded; a held grab is cancelled without asking
  ([buttons-and-row-actions.md, Removing a download](buttons-and-row-actions.md#removing-a-download-the-two-confirmations)).

## States

| State | Ring | State line | Below | Actions |
| --- | --- | --- | --- | --- |
| downloading | 42 % inside, arc | 42% · 12 min left · 3.1 MB/s · 1.9 of 4.6 GB (no word) | release, marks, pack, bar | View Queue · Cancel Download |
| stalled | 42 % dimmed | Stalled 42% · no progress for 20 min (75 %) | same, bar dimmed | same |
| queued | clock | Queued waiting to start (75 %) | release, marks, pack (muted) | same |
| importing | spinner | Importing linking into the library… | release, marks, full bar, still | View Queue |
| failed | red bang | Failed reason (all red) | release, marks | Search Again · View Queue |
| not downloaded | cloud | Not Downloaded | — | Get a Release; others see "no release chosen yet" |
| unaired | clock, 70 % | Unaired · airs 19 May 2027 · in 7 months | — | — |

Countdown: "in N days" under 30 days, else "in N months"; the full date is always shown.

## Layouts

- Desktop: the panel spans the primary column. Phone 360: the ring at 3.2em, the figures wrap under the word, everything
  else stacks. TV 125 %: focus order is the header buttons, then the indexer link, Open Transmission, View Queue, the
  state's button; the ring, marks and pack strip are not stops.
- Motion is transform and opacity only and stops under reduced motion. No flex gap, `min()` or `max()`.

## Do not

- Put a mark on the still while the block is on the page.
- Add fields (tags, networks, keywords, seeders): the block is built for downloading, not downloaded and unaired; rarer
  states change only the ring, the line and the button.
