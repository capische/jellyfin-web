# Release picker: Sources (the icon, the train, the checklist) and the searching ring's colours

**Search For and Quality Profile lists over the dialog (ds.t17, the user 2026-11-07: "Dropdown does not fit"), built, not
accepted.** The picker scrolls (`overflow: hidden auto`), and the two fields' lists were drawn inside it, so while the dialog was
short (no releases yet) it cut the Quality Profile list's last rows off. A field's list (`Select`, `design/Controls.tsx`) opened
inside any dialog now hangs from its pill **over the dialog**, as the Sources checklist does (`.menuportal.overdialog`,
`menuPosition`): s-2 below the pill, or above it when the window has no room below, kept inside the window; it keeps the field's
width and the field's own font, so its rows, paper, corners and captions keep the open-list values they had in the dialog. Outside
a dialog a field's list stays in the field. The picker's own row rules (rows at least 2.7816em, the detail wrapping, the phone mark) follow the list (`pickermenu`). Code:
`design/Controls.tsx`, `design/Menu.tsx` (`fldmenu`), `design/_runtime.scss`.

**ds.t15 (the user, 2026-11-07: the Sources list opened behind the picker; "apply new golden ratio rules to it and see how it
goes (do not make it massive or too big)"), built, not accepted, gate 1 on beta (computer, dark).** The checklist now opens
**above the dialog** (`.menuportal.overdialog`, z-index 1000000 over dialogHelper's 999999; any anchored menu opened from a
dialog, or from a menu over one, does the same, so the failure (i)'s popover does too) and **hangs from the Sources button's right
edge**, s-2 below it (`menuPosition(…, end)`), kept inside the window. On a computer the picker is on B (`design/_golden.scss`,
ds.t15): the dialog s8 + s6 wide (about the old 76.01em of the root), s1 corners, its own font B; head padding s0 / s0 / 0 / s1,
title s1 at line 1, the title's name s0 s-2 below it; the head's and rows' round actions stay 40 px (the floor, kept compact) with s0
glyphs, s-3 apart; Search For and Quality Profile s2 pills (s-5 outline, s0 / s-1 insets, s0 chevron), s-1 apart, captions s-1 on
the value's inset; status s-1; rows s-2 above and below, s1 at the sides, the quality word at B / 600, flags, languages, size, seeds,
indexer, media marks, names and reasons at s-1 (columns s3, s2, s4); Rejected's title s-1 in its s-2 / s-1 pill. The checklist
takes the open lists' language (ds.t12): s7 wide, paper s0 corners, s-2 padding, lines at least s2 with s-1 corners and s0 / s-1
insets, the box s0 (s-4 border, s-3 corners) s-1 before the name at B, the state s-1. Phone, tablet and TV keep the values below.

**Status: approved 2026-11-06, D288–D295, built, not accepted.** Release-start buttons and tips now say Download (D294); the picker's own Get a Release title and Get Another Quality remain unchanged. Sources behavior and geometry are unchanged.

**Review fixes (2026-11-04), built, not accepted:** the native picker's full-width release row keeps its markup. On TV, Right explicitly moves row → Add → Replace (or row → Cancel while pending); Left reverses that path. Refused actions remain reachable for reading/confirmation. Up/Down still use upstream `focusManager` and arrive on the row. Arrow keys and directional `command` events share this path; acquisition, cancellation and replacement semantics stay unchanged.

**Status:** approved 2026-10-25 (user: "Looks great, tell parent to implement", finished state F1; "yes, recolour the torrent ring
too" the same day). Record: [release-picker-source-filter.md](../release-picker-source-filter.md) Revisions 2, 5 and 5b, the mockup
[release-picker-sources-dot.html](../release-picker-sources-dot.html) (PNGs beside it), [UX.md §9](../../UX.md). Built in P4.FU25
(built, not accepted). The failure (i), the state `failed` and the status line without the sources part: approved 2026-10-26
(user, revision 2 of `reviews/picker-failure-info/` in the workspace; "drop the sources part"), built on `feat/failure-info`.
Code: `components/ReleaseSources.tsx` (`ReleaseSources`, `useTrain`), `components/releaseSources.scss`,
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
  - the **state** at the right in the secondary colour, 90 %, right-aligned in a column at least 11.5em wide so the menu keeps its
    width while states change: `8 releases · 2 rejected`, `asking…`, `waiting`, `no results`,
    `failed` (red), `hidden · 3 releases` (unticked, answered), `hidden · asking…`, `not asked` (unticked, not asked by this
    search). A failure reads just `failed`; its reason is behind the line's (i).
- **The failure (i)** (2026-10-26; [info-tip.md](info-tip.md)): a failed line reads `EN. 0Magnet ⓘ` … `failed`, the (i) right after
  the name and always before a slow-setup label (`EN. 1337x ⓘ ⚠ slow setup`), never after it. On a computer hover shows the
  plugin's full message (`None of the configured categories is advertised by the indexer.`) in the MUI tooltip above the (i), or,
  when the plugin sent none (a timeout, or while the search still runs), the short reason (`timed out`, `unavailable`, `rate
  limited`, `login refused`, `cannot search this`, `bad answer`, …); a click, a tap or the TV's Enter opens the same text in the
  info popover, titled with the indexer's name. A click on the (i) never toggles the line. On the TV and the computer's keyboard
  alike, Enter on the line still only toggles it, Right steps into the (i), Left back (the computer: Codex final review,
  2026-10-26; the focused (i) shows its tooltip, Enter opens the popover, Escape returns to the (i)); on the TV's focused line the
  (i) takes the line's ink. The line's `aria-description`
  is the same text.
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
  by Download and Get Another Quality. The saved choice is read against the indexers enabled now: if it leaves none ticked
  (the ticked ones were turned off or removed), the first is ticked again, so a search never asks a source shown unticked.
- **Status line:** `18 releases · 6 of 7 indexers answered` (rows shown · the search's health); while rows arrive
  `12 releases so far · waiting for …` (an unticked indexer is not waited for). It names no sources count (user, 2026-10-26: "drop
  the sources part"): the grey dot says a filter is on. The Rejected group's count follows the ticked sources. There is **no red
  "Partial results" line** (removed 2026-10-26): a failure shows in the status line's count, the red dot, the line's `failed` and
  (i), and the searching ring's red segment.

## The searching ring and its lines

- The torrent ring (`.jfmod-searchGlyph`, one segment per asked indexer) draws each segment in its **indexer's colour**
  (`--jfmod-ix`, `.jfmod-searchGlyph-seg--known`); state is opacity: **waiting .3**, **asking pulsing** (1 ↔ .45 over 1.2 s),
  **answered full** (rows or none), **failed** red `#e53935`. Until the first progress names the indexers, its four stand-in
  segments stay the asking blue `#74c9ec`.
- Each indexer line under it leads with a 0.55em dot in the same colour: faint while waiting, blinking while asked, full once
  answered, red when failed. The state words keep their colours (answered green, failed red).

## Do not

- Colour the funnel glyph, add a count badge, or move the state into text in the title row.
- Bring back a failure banner or the reason at the right of a line; it lives behind the (i).
- Cancel an indexer's search when it is unticked, or forget its rows.

## Head and Search For (the user, 2026-11-07)

- The head is one line: **Get a Release · <title>** (or Get Another Quality · <title>), the title after a middle dot at 70 % ink
  (`.ttl`), the whole line ending in an ellipsis when it does not fit. No second line under it.
- A **movie** draws no Search For (it had one fixed option, the movie's own name, which the head now says). Quality Profile then stands
  alone at the half it has beside Search For on a series (`.pmchoices .fld:only-child`). A series keeps Search For.
