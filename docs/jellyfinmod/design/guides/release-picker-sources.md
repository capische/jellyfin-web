# Release picker: Sources (the icon, the train, the checklist) and the searching ring's colours

**Status:** approved 2026-10-25 (user: "Looks great, tell parent to implement", finished state F1; "yes, recolour the torrent ring
too" the same day). Record: [release-picker-source-filter.md](../release-picker-source-filter.md) Revisions 2, 5 and 5b, the mockup
[release-picker-sources-dot.html](../release-picker-sources-dot.html) (PNGs beside it), [UX.md §9](../../UX.md). Built in P4.FU25
(built, not accepted). Code: `components/ReleaseSources.tsx` (`ReleaseSources`, `useTrain`), `components/releaseSources.scss`,
`components/ReleasePickerDialog.tsx` (`useSources`, `useExtraSearches`, `useSourcesView`), `components/ReleaseSearchBlock.tsx`,
`integration/releasePicker.ts` (`.jfmod-sourcesSlot`). Colours: [indexer-colour.md](indexer-colour.md).

## The icon

- First of the title row's four round icons: **Sources** → Show Names → Open Transmission → Close. The same
  `paper-icon-button-light jfmod-releaseAction` (2.5em, grey glyph, hover veil; [buttons-and-row-actions.md](buttons-and-row-actions.md)),
  a three-line funnel glyph (`M4 6h16M7 12h10M10 18h4`, stroke 2.3). The glyph stays plain grey in every state; the dot carries
  the state. Tooltip and name "Sources", or "Sources · 5 of 7" while some are unticked.
- **The corner dot** (`.jfmod-srcDot`, 0.5em, `top .4em; right .35em`):
  - none while every source is ticked and nothing runs;
  - **grey** (the secondary text colour) while some are unticked and nothing runs; grey wins over the finished state;
  - **finished (F1):** when a search ends the dot rests in the colour of the last indexer that finished (`--done`), **red**
    `#e53935` if any indexer of it failed (`--failed`), and stays while those results are on screen with every source ticked:
    unticking turns it grey and ticking all back brings the result back (user, 2026-10-26); the next search starts grey again.

## The train (while indexers are asked)

- The dot leaves the corner and becomes the **lead**, grey, circling the icon once per **1.2 s** (the button does not clip it:
  `overflow: visible`; `.jfmod-srcTrain`, linear,
  inset .15em; each car a 0.5em dot at the circle's top, `.jfmod-srcCar`).
- Every indexer being asked is a **follower** in its colour on the same circle, **40°** apart behind the lead, in asking order (the
  first asked nearest).
- When an indexer finishes (answered, no results or failed) its follower turns to the lead's place and fades into it over 0.45 s
  (`--merging`), and the **lead takes its colour** at once, with no colour transition; the followers behind close up one place. Several finishing between two reads
  merge one after another.
- An indexer ticked in during or after a search (asked alone) joins the train the same way.
- Transform and opacity only. **Reduced motion:** no train; a still blue `#00a4dc` dot in the corner while searching.

## The checklist

- An MUI Menu under the icon, right-aligned (`.jfmod-sourcesMenu`, min-width 19em, above upstream's dialog layer); on the phone it
  spans the full width under the title row. One line per enabled indexer in the plugin's order (priority, then name):
  - the **checkbox in the indexer's colour** (`.jfmod-sourceCheck`, 1.15em, border .14em, radius .25em): filled with a tick when
    ticked (a dark tick on the two light hues, centred in the box), outlined in the colour when not;
  - the **name** in the text colour at 600 (60 % when unticked);
  - the **state** at the right in the secondary colour, 90 %: `8 releases · 2 rejected`, `asking…`, `waiting`, `no results`,
    `failed · timed out` (red), `hidden · 3 releases` (unticked, answered), `hidden · asking…`, `not asked` (unticked, not asked
    by this search). A failure is a short lower-case reason after `failed · ` (`timed out`, `unavailable`, `rate limited`,
    `login refused`, `cannot search this`, `bad answer`, …; 2026-10-26: never the plugin's full sentence).
- **Slow setup** (approved 2026-10-25, P4.FU27; `reviews/prowlarr-slow-hint/` revision 3, casing A): an indexer on Prowlarr's slow
  default `1337x` definition reads `EN. 1337x ⚠ slow setup`, the label right after the name (`.jfmod-sourceSlow`, `margin-left
  .6em`, 85 %, weight 600, the warning amber and glyph of [buttons-and-row-actions.md](buttons-and-row-actions.md) *A warning on a
  row's title line*); the state at the right is unchanged. The label is a link to the how-to (new tab, `noopener`; tooltip and
  name "How to speed it up"; its hit area is the text padded .3em above and below): clicking it opens the how-to and **does not
  toggle** the line; a click elsewhere on the line toggles it. It is **not a focus stop** (`tabindex -1`, and `data-jfmod-dpad-skip` so
  `shell/dpadModals` never lands on it, not even with Right), and a pointer press leaves focus on the line, so on the keyboard and
  the TV Enter always toggles the line; the link for them is in Settings. On the TV's focused line (the primary fill with dark ink)
  the label takes the line's ink, as amber would read at about 1.5:1 there. Lower case like every state in this menu.
- Opening it puts focus on the first line. Click or Enter toggles a line (`role=menuitemcheckbox`, `aria-checked`); the menu stays
  open until Back, Escape or a click outside, and focus returns to the icon. The last ticked line cannot be unticked (`aria-disabled`, tooltip "At least one source
  stays on"). On the TV `shell/dpadModals` gives the menu arrows, Enter and Back.

## Behaviour

- **Untick:** that indexer's rows, eligible and rejected, hide at once; its search is not cancelled and its results are kept, so
  ticking it again shows them at once. The row a grab is being sent or held for stays, so its Cancel stays reachable.
- **Tick an indexer this search did not ask:** it is asked now, alone (`indexerIds=<id>`); its rows join the list in their ranked
  places as it answers and grab from its own search. They show and grab even while the search itself has no rows yet or failed;
  when the search's own rows then arrive, an open Rejected group stays open and the TV's focus stays where it is (only a new
  search closes the group), so a grab held on one of those rows keeps its Cancel.
- **A new search** (another scope or profile, the picker opened again) asks only the ticked indexers (`indexerIds`, repeated);
  with every one ticked it names none, as before.
- Remembered per browser (`localStorage` `jfmod-releaseSourcesHidden`, the unticked ids, so a new indexer starts ticked), shared
  by Get a Release and Get Another Quality. The saved choice is read against the indexers enabled now: if it leaves none ticked
  (the ticked ones were turned off or removed), the first is ticked again, so a search never asks a source shown unticked.
- **Status line:** `18 releases · 5 of 7 sources · 6 of 7 indexers answered` (rows shown · sources ticked, only while some are not
  · the search's health); while rows arrive `12 releases so far · 5 of 7 sources · waiting for …` (an unticked indexer is not
  waited for). The Rejected group's count follows the ticked sources; the red "Partial results" line is unchanged.

## The searching ring and its lines

- The torrent ring (`.jfmod-searchGlyph`, one segment per asked indexer) draws each segment in its **indexer's colour**
  (`--jfmod-ix`, `.jfmod-searchGlyph-seg--known`); state is opacity: **waiting .3**, **asking pulsing** (1 ↔ .45 over 1.2 s),
  **answered full** (rows or none), **failed** red `#e53935`. Until the first progress names the indexers, its four stand-in
  segments stay the asking blue `#74c9ec`.
- Each indexer line under it leads with a 0.55em dot in the same colour: faint while waiting, blinking while asked, full once
  answered, red when failed. The state words keep their colours (answered green, failed red).

## Do not

- Colour the funnel glyph, add a count badge, or move the state into text in the title row.
- Cancel an indexer's search when it is unticked, or forget its rows.
