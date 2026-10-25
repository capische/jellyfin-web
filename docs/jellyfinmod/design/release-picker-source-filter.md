# Release picker: Sources — APPROVED 2026-10-25 (user: "Looks great, tell parent to implement"): Revision 5/5b, the coloured-dot icon with the train, finished state F1; artifact https://claude.ai/artifact/H6g3EqHRFpwCVpbbQpoy3M v2

**Revision 2 supersedes the field below.** User (2026-10-25, design session): "adding to this row [the dialog's title row with Show Names · Open Transmission · Close] a button with the list of indexers and I can check / uncheck the ones I want. If the search is going and I change the list, the search should finish unless I've added; if added, new should be added; if I removed, the results should only be ignored." The artifact (v2, same link) now draws this; the field design is kept below for the record.

## Revision 2 — Sources, a checklist behind a title-row icon

- A fourth round icon in the title row, first of the four (Sources → Show Names → Open Transmission → Close), the same `paper-icon-button-light jfmod-releaseAction` as its neighbours, a three-line funnel glyph; plain while every indexer is ticked, the primary blue while some are unticked (as Show Names is blue while on); tooltip "Sources" / "Sources · 5 of 7".
- The menu: an MUI Menu of checkbox lines, one per indexer in the plugin's order: checkbox, name in 600, under it the live state in the secondary colour: "8 releases · 2 rejected", "asking…" with the small turning segment, "failed · timed out after 30 s" (red), "no results", "hidden · 3 releases" for an unticked one that answered. Click or Enter toggles a line; the menu stays open until Back / Escape / outside click. The last ticked line cannot be unticked.
- Behaviour: untick → that indexer's rows (eligible and rejected) hide at once, its search is not cancelled, results kept, re-tick is instant. Tick an indexer that was unticked when the search began → it is asked now, alone, its rows join as they arrive ("asking…"). A new search asks only the ticked indexers. Failed indexers stay tickable. Remembered per browser like Show Names (localStorage; a new indexer starts ticked; shared with Get Another Quality).
- Status line: "18 releases · 5 of 7 sources · 6 of 7 indexers answered" (shown · filter on · search health); the Rejected group's count follows the filter. "Partial results" line unchanged.
- Phone: the menu full width under the title row. TV: the icon is a header focus stop; in the menu arrows move, Enter toggles the checkbox (dpadModals), Back closes, focus returns to the icon.
- Plugin: one optional `indexerIds` on the search request so unticked indexers are not asked and a ticked-in indexer can be asked alone; the web merges the second search's rows by `releaseId`. Without it the checklist works as a pure view (all asked, unticked hidden).
- Build: the icon in `integration/releasePicker.ts` beside Show Names; the menu and the ticked set (`sources` state + localStorage) in `ReleasePickerDialog.tsx`; filters on `eligible` / `rejected`; the status text; `releasePicker.scss` for the on-state (~10 lines). ~120 lines TSX; plugin small.

### Revision 2b (2026-10-25): making the icon noticeable — two ideas, A recommended; location = the title row (user asked "button bar or next to quality profile?"; answer: the bar — a remembered multi-select is a setting like Show Names, a field shows one value, the phone pays a line for a field and nothing for an icon)

- **A · Live icon (recommended):** the funnel icon carries a small count badge while narrowed ("5" in the primary, five of seven ticked); while a search runs a 28 % segment turns around the icon (the ring family's motion, 1.2 s, opacity/transform only, none under reduced motion); once a search ends with failures the badge turns red with the number failed ("1"). Idle with all ticked it is plain. Tooltip "Sources · 5 of 7 · 1 failed".
- **B · Labelled button:** the same states as a flat pill with the word ("Sources", "Sources · 5/7", the segment in place of the icon while searching, a red dot after a failure); on the phone it falls back to A's icon. More discoverable; costs ~7em of the title row and makes one control unlike its three neighbours.

### Revision 3 (2026-10-25): the user liked none of the icon/button ideas ("Search web for ideas") — two web-grounded directions, separate artifact

Artifact: https://claude.ai/artifact/7WKHMWfuktNc2Zo9Q12cVv — file `release-picker-sources-ideas.html`, PNGs `release-picker-sources-ideas-{dark,light}.png`. Patterns taken from the web: flight metasearch (a thin progress line and a result count that ticks up as providers answer — Kayak; a spinner kept on each item until it has answered — Skyscanner), the SAP Fiori filter feedback bar (one scrollable chip row, active first, a counter chip), NZBHydra2 (a line per indexer with state and count). Neither idea adds anything to the title row.

- **Idea 1 · the source strip (recommended):** one chip per indexer in a row under the controls, *All* first with the total. A chip is the indexer's live state and its switch: while asked, muted with a pulsing count placeholder and a breathing blue border; on answer the count lands ("EN. 1337x 4"); failed turns red; tap = untick (outlined, struck through, rows hide, total drops), tap again = tick; tapping an unticked one during a search asks it. A 2 px progress line under the strip fills as indexers answer and fades when all have. Replaces the "N of M indexers answered" words and the red "Partial results" line (no net height on a laptop). Names cut at ~14 chars, full in the tooltip. Remembered per browser. Laptop/TV: wraps to a second row when narrow; phone: one row scrolling sideways. TV: Search For → Quality Profile → chips (left/right, Enter toggles) → rows. Reduced motion: no pulse, the line still fills.
- **Idea 2 · the searching block keeps the checkboxes:** the existing searching block (torrent ring + one line per indexer) gets a checkbox per line; during the search it is the control (untick hides, tick asks); after the search it folds to one summary line "7 sources · 6 answered · 1 failed · 2 hidden ▸" with coloured dots, opening back to the lines. No net height; less discoverable once folded. TV: one stop folded, a stop per line opened.
- Add-on for either (not a control on its own): the indexer name at the right of each row as a toggle ("Only 1337x" / "Hide 1337x").
- Behaviour (untick = hide only, tick = ask if not asked, search never cancelled, remembered, plugin `indexerIds`) as in Revision 2.

### Revision 4 (2026-10-25): back to the button bar, minimal — two versions (user: the strip and the block "take too much space and attention. It should be simpler. Similarly to the button bar")

Artifact: https://claude.ai/artifact/GWnAcSwnQpGMvDd8YsVyUN — file `release-picker-sources-bar.html`, PNGs `release-picker-sources-bar-{dark,light}.png`. Both live in the title row beside Show Names, both open the Revision 2 checklist (untick hides, tick asks, never cancels, remembered); nothing below the title row changes.

- **A · the sources pile (recommended):** one small circle per indexer with two-letter initials, overlapping like a document's collaborator faces, as one button where the Sources icon would be (~6em laptop; phone three circles + "+4"). Each circle is the indexer's state: filled = ticked and answered; hollow = unticked; dimmed and pulsing = being asked; outlined = waiting; red ring = failed. One focus stop; opens the checklist, whose lines lead with the same circle. No text, no counts; moves only as answers land. Reduced motion: no pulse. Initials from the name after its "RU./EN." prefix (RT, KZ, MZ, 0M, 13, UI, UT); Prowlarr's indexer logos could replace them later.
- **B · the icon with a status dot (simplest):** the plain funnel icon with a 0.5em corner dot: none when all ticked and quiet, blue pulsing while searching, grey when narrowed, red when one failed. The floor; the checklist carries everything.

### Revision 5 (2026-10-25): DIRECTION CHOSEN — the icon with a dot (B of Revision 4), the dot in each indexer's colour; finished state open

User: "I like dot idea (B) … similarly to torrent circling, make the dot circling and changing colors depending on indexer … assign indexer a color (so it's not random; in settings you can see it, no need to change but it should be there) … colors are exactly the same as picked right now for torrent search animation … dropdown will show checkboxes and we can see colors"; then "thinking about finished state icon, after everything is found and done".

Artifact: https://claude.ai/artifact/H6g3EqHRFpwCVpbbQpoy3M — file `release-picker-sources-dot.html`, PNGs `release-picker-sources-dot-{dark,light}.png`.

**Fact to settle first:** the torrent ring's segments are one per indexer but coloured by **state** (ok `#43a047`, failed `#e53935`, asking `#74c9ec`, waiting `#a9ddf3`), not by indexer; there is no indexer colour today. So the proposal introduces one and, optionally, recolours the ring's segments by indexer so "the same colours as the torrent animation" becomes true.

- **Palette** (8, apart on dark and light, not the primary, not the failure red): `#4fc3f7 #81c784 #ffb74d #ba68c8 #f06292 #4db6ac #fff176 #ff8a65`; assigned in indexer order when an indexer is first seen, kept for its lifetime, the 9th wraps. Plugin: `colorIndex` 0–7 on the indexer record, in `GET /Settings/Indexers`, in every search's `indexers[]` and on each candidate's indexer; web maps index → hue. Fallback without the plugin field: hash of the indexer id.
- **The dot:** idle all ticked and quiet = no dot. **Searching:** the dot leaves the corner and circles the icon once per 1.2 s (transform only), each turn in the colour of one indexer still being asked, moving to the next at the top; one left = that colour. Reduced motion: still blue dot, no circling. **Narrowed and quiet:** still grey dot.
- **Finished — the user is deciding:** F1 (recommended) the dot returns to the corner and fades out; if any failed, a still red dot stays. F2 the corner shows a 0.9em mini ring of segments, one per ticked source in its colour, failed red, while the results are on screen.
- **Checklist:** Revision 2's menu; each line = checkbox, the indexer's colour dot, name, state; unticked lines keep their colour dimmed.
- **Torrent ring (optional, to match):** segment stroke = indexer colour; state by opacity (waiting .3, asking pulse, answered 1); failed red; the lines under it take the same dot.
- **Settings:** the colour dot before the indexer's name on its row (React settings and Dashboard page), read-only, tooltip "Colour in the release picker".
- Build: ~40 SCSS + ~30 TSX for the dot; menu as Revision 2; ring recolour small; settings dot small; plugin `colorIndex` + `indexerIds` (from Revision 2).

#### Revision 5b (2026-10-25, user): black text + coloured checkboxes; the "train" animation

- **Checklist:** the name in the text colour (not blue); no dots: the **checkbox itself is the indexer's colour** (filled when ticked, outlined in the colour when unticked, a dark tick on the two light hues); state at the right in the secondary colour.
- **Searching = the train:** the dot leaves the corner as the **lead, grey**, circling once per 1.2 s. Every indexer being asked is a **follower** in its colour on the same circle, 40° apart behind the lead in asking order. When an indexer finishes (answered / nothing / failed) its follower closes the gap, merges into the lead, and **the lead takes that colour**; the followers behind close up one place. The lead = the last indexer that finished; the tail length = how many are still out. Transform/opacity only; reduced motion = a still blue dot.
- **Finished F1 (recommended):** the lead comes to rest in the corner in the last indexer's colour and stays while the results are on screen; red instead if any failed; grey again on the next search. F2 (mini ring) unchanged as the alternative. Still awaiting the user's pick.

---

## Revision 1 (superseded): a Source field in the control row

Session: Row Icon State Designs (local_0162f905…). Artifact (static, theme toggle):
https://claude.ai/artifact/7kJpQbRNigf2qiRxtpQSQb — file `release-picker-source-filter.html`, screenshots
`release-picker-source-filter-{dark,light}.png` in this folder (copy into `docs/jellyfinmod/design/` when recording).

User: "Ask design session for a picker - to have source filter?" Guides read: track-dropdown (the two-line menu),
buttons-and-row-actions, media-marks, settings-field; UX §9, §9.1; the picker design notes.

## The proposal (one)

A third field in the picker's control row, **Source**, after Search For and Quality Profile, drawn as the Quality Profile
field is (small label over the value on a hairline, ▾ at the right; `ProfileSelect`'s MUI select with `detailMenuItems`).

- **Closed:** "All sources" (default) or the chosen indexer's name; while a filter is on the value is in the primary colour
  at 600, so a narrowed list is never mistaken for the whole answer.
- **Menu:** one two-line entry per indexer that took part, in the plugin's indexer order, *All sources* first: the name in
  600 over "N releases · M rejected" in the secondary colour. An indexer that **failed or is paused** is listed, not
  choosable (disabled), with its reason in red where the counts go ("failed · timed out after 30 s", "paused until 16:05");
  one with **no results** is listed disabled with "no results". The menu is the complete answer to "who answered".
- **Filtering:** client-side on the loaded search (`candidate.indexerName`; counts from `search.indexers[].resultCount`
  and the candidates), instant, no new request. It applies to the eligible rows **and the Rejected group** (its count
  follows). The status line says what is shown of what: "4 of 23 releases · EN. 1337x · 6 of 7 indexers answered". The
  indexer column of every shown row turns from the secondary to the text colour, so the column confirms the choice.
- **Not remembered:** each open of the picker and each new search (another season, another profile) starts at All
  sources. A remembered filter would silently hide releases next time; the profile is a preference, the source is a question
  about this search. What it loses: a user who always wants one tracker picks it each time.
- **Phone 360:** the three fields stack full width as the two do today; the menu is MUI's, full width under the field.
- **TV:** one more focus stop in the control row (Search For → Quality Profile → Source → rows); the open menu is driven
  by `shell/dpadModals` like the Quality Profile menu; Back closes it. At 125 % the third field wraps under the first two
  where the dialog is narrow, which the row already allows.
- The red "Partial results: …" line and "N of M indexers answered" stay as they are.

## What "source" means, and why not rip type

**The indexer.** Rip type (Remux, Blu-ray, BDRip, WEB-DL, WEBRip, HDTV) is already the first word of every row's headline
(the parser job makes it the release's own word) and is what the Quality Profile governs; a second rip-type filter would fight
the profile and double the controls. The indexer is the one fact the profile cannot express and the user acts on: trust,
language, speed. If a rip filter is wanted later, it is the same field pattern again, not a redesign.

## Not proposed

- Chips over the list ("All · RuTracker 8 · Kinozal 5 · …"): seven items wrap to three lines on the phone and are a new
  D-pad row on the TV; the counts would be in view all the time for a choice made once.
- A multi-select (several sources at once), a rip-type filter, remembering the choice, hiding failed indexers from the menu.

## Build

`ReleasePickerDialog.tsx`: a `SourceSelect` beside `ProfileSelect` (same component shape; options from `data.indexers`
with `detail` = counts or reason, `disabled` for failed/no-results), a `source` state reset on every new search key, and the
two `filter`s on `eligible` / `rejected` plus the status text. `releasePicker.scss`: the on-state colour of the value and
the highlighted indexer column (~10 lines). No plugin change. ~70 lines TSX.

## Decision for the user

Source = indexer, as a third field (as drawn) — yes / no; or say if "source" meant rip type.
