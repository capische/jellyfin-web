# Buttons and row actions

**Status:** user rules 2026-10-07/08 (three button kinds, Title Case, round icon-only row actions), applied across the
settings area, the Dashboard page, the detail page and the dialogs. Record: [UX.md §12.1](../../UX.md) (the authoritative
wording) and PHASE7 *Settings buttons: three kinds*. Code: `settings/settingsWidgets.tsx` (`IconAction`), `settings.scss`,
the detail page's `fileChooser.scss`, the picker's `releasePicker.scss` (`.jfmod-releaseAction`).

## Three kinds of button, all the size of Save

| Kind | Colour | Use |
| --- | --- | --- |
| main | blue, the primary `#00a4dc` | the one main action of a view: Save, Add Profile, Continue, Get a Release |
| other | grey | everything else: Cancel, Add Predefined Profiles, Cancel Download, View Queue as a button |
| destroy | red, the error `#c62828` | Remove, Search Again after a failure, Replace in the picker |

Labels in **Title Case** (a short article, conjunction or preposition stays lower case unless first or last: *Add from
TMDB*, *Turn Grabbing On*); product names keep their spelling. Help, status lines, field labels and notices are sentence case.

## Row actions are round icons

- Every action of a list row (indexers, quality profiles, path mappings, a profile's quality order, the file chooser's
  rows, the picker's rows) is a round icon-only button of at least 40 px: **2.5em** in the mod's own rows, **2.7816em with a
  1.6696em glyph on upstream's `.listItem` rows** so it matches Played / Favourite / More beside it. Transparent, like
  upstream's round icons; grey by default, red for a destructive one (bin, cross), the primary for a kept pin.
- Each has an `aria-label` and a Title Case tooltip that name the row it acts on: *Remove Prowlarr 1337x*, *Keep the 1080p
  file*. Icons: Test `network_check`, Edit pencil, Remove red bin, Make Default `star_border`, Move Up / Move Down arrows,
  Fix `build`, Rebind `link`, Keep `push_pin`, History, Add +, Replace the circular swap. An (i) that explains a short state
  (`InfoOutlined`, in the state's colour) is [info-tip.md](info-tip.md).
- A refused action (nowhere to move, busy, blocked) uses `aria-disabled`, never `disabled`, so the D-pad keeps its place;
  it dims to 45 % and its tooltip says why.
- State lives in the glyph, not in a badge: a working icon animates its own glyph (transform or opacity only), a passed one
  turns green, a failed one turns red and changes shape. Reduced motion stops the animation and dims the glyph instead.
- The hover tint and the focus ring are drawn on the whole round button, never on a smaller circle inside a bigger hit area
  (user, 2026-10-29: the file chooser's 1.75em icons with an invisible 2.5em circle let the tilted pin fill its tint; D107).
- On the TV each icon is a focus stop with the white double focus ring; the arrows walk a row's icons left to right.
  Indicators (the download mark, the file-state marks) are **not** buttons and take none of this.

## A warning on a row's title line

**Status:** approved 2026-10-25 (user, Prowlarr slow-setup label, revision 3 of `reviews/prowlarr-slow-hint/` in the workspace; the
title line, and sentence case in the picker). Built in P4.FU27 (built, not accepted). Code: web `components/SlowSetup.tsx`
(`SlowSetupGroup`), `components/slowSetup.scss`; the Dashboard page's `slowSetupLabel()` in `configPage.html`.

- A row that needs a warning which is not a failure (today only an indexer on Prowlarr's slow default `1337x` definition) gets it
  **on the name's line**, never a third line: the group `⚠ Slow setup · How to speed it up` sits **0.5em** after the name at
  **0.85em**, weight 400, the separator ` · ` in the secondary text colour (`.jfmod-indexerSlow`).
- **The warning** (`.jfmod-slow`): Material `Warning` (the filled triangle; an inline SVG with the same path on the Dashboard page),
  **1.15em**, `margin-right .25em`, `vertical-align -.2em`, `aria-hidden`; then the words in sentence case, weight **600**, in the
  warning amber: **`#f2b01e`** on the dark themes (the theme's starIcon, 8.5:1 on the row), **`#7a5000`** on light and Apple TV
  (5.8:1 on `#e8e8e8`). Amber, not red: red means failed, and this row works. The row's pill and icons do not change.
- **The link** is its own words, *How to speed it up*, in the links' look (primary `#00a4dc`, 600, underline on hover and keyboard
  focus), new tab, `noopener`; a focus stop like any link. Not the label as a link: a tooltip would have to say what it does, and
  touch and the TV show none.
- **Wrapping:** the group never breaks inside (`inline-block`, `nowrap`); when it does not fit beside the name it moves under it as
  one piece, and the name wraps as before, never cut.
- The link's address is the plugin's (`slowSetupHowTo` in `GET /Settings/Indexers`, one constant `ProwlarrSync.SlowSetupHowTo`).
  The picker's checklist shows the same warning as a link of its own: [release-picker-sources.md](release-picker-sources.md).

## Removing a download: one dialog, its buttons the outcomes

**Status:** approved 2026-10-29 (user: "looks amazing", the proposal of workspace `reviews/queue-remove-dialog/`; D118–D124 of
`reviews/overnight-2026-10-28/DECISIONS.md`). Built on `feat/queue-remove-items` (gate 1, not accepted). The close X, Escape on a
computer and the grey safe choice on open: user, 2026-10-30 ("Add to dialog X … it should be grey button as it has cancel action",
"Also add ESC to close the dialog"), `fix/queue-dialog-x-items` (gate 1). Replaces the 2026-10-26
Remove from Queue and Remove the Torrent. Code: `integration/queueActions.ts` (`removeWithDialog`, `queueRowActions`),
`components/removeDialog.scss` (`.jfmod-remove*`).

- **Where:** the Queue page's row menu, the picker's added-row X, a missing episode's *Cancel Download* and the pending entry's X
  all open the same dialog for the row's state. A held grab is cancelled without it.
- **The row action names the outcome:** *Cancel Download* (`close`) while anything downloads (queued, downloading, stalled,
  unknown, a pack too); *Remove* (`delete`, with *Retry*) for failed and blocked; *Stop Seeding* (`stop`) for a title in the
  library; none while it identifies, links or scans.
- **Anatomy** (the stock dialog's look in the mod's Inter, as every mod surface; the release name monospace; left-aligned): the action as the title (1.75em, 400) with the close X level with it on the right (the stock
  `paper-icon-button-light` with the material `close` glyph, 41 px, `.jfmod-removeClose`, its glyph on the buttons' right edge, a
  D-pad stop on the TV); the question about the title
  (1.1em: "Stop downloading The Matrix (1999)?", "Remove … from the queue?", "Stop seeding … now?"); the facts in the secondary
  text colour (`42% · 3.1 of 7.4 GB downloaded · nothing of it is in your library yet`; a failure `Failed: <reason>` in
  `#ff7b72`, light `#c62828`; *In your library* and a pack's imported episodes in `#81c784`, light `#2e7d32`); notes at .95em;
  the release name in monospace (.8em, 50 %, one line); *Blocklist this release* ("Later searches skip it."), a stock
  `emby-checkbox`, off; then one full-width raised button per outcome (`.jfmod-removeChoice`, `margin-top .9em`), each with
  its result under it as a `fieldDescription` (`.4em` above). Computer: 36em wide, `1.6em 2em 1.2em` padding; TV: the full
  screen, the column 50 %; phone and low resolutions: full screen.
- **Choices:** the destructive one red (`button-delete`, red under the pointer too), the safe one grey with `autofocus`. On a
  computer and a phone it stays grey when the dialog opens and turns blue only when the keyboard moves focus (`:focus-visible`);
  on the TV it carries the stock focus (blue, grown 1.2×). The X, Back on the TV, Escape on a computer and a click outside are
  the same as the safe one. It closes once: a second key, click, right-click or choice during the close animation is dropped. Focus returns to the opener (the row on the TV, its ⋮ or the opening button
  elsewhere), also after a refused delete asks again.

  | Row | Red | Others |
  | --- | --- | --- |
  | under way, `canDeleteFiles` | *Delete the Download*: "Transmission removes the torrent and deletes the 3.1 GB downloaded so far." | *Keep Downloading* |
  | failed or blocked, `canDeleteFiles` | *Delete the Download*: "… deletes its 7.4 GB." | *Keep the Files*: "… the 7.4 GB stays in the download folder." · *Cancel* |
  | seeding | *Stop Seeding*: "… removes the torrent. The film stays in your library." | *Keep Seeding* |
  | anything else (part of it in the library) | *Stop the Download* / *Remove from Queue*: "… removes the torrent (and stops seeding the 2 imported episodes). No file is deleted." | *Keep Downloading* / *Cancel* |

  Seeding has no blocklist; its notes say when JellyfinMod stops it by itself (or "Automatic stop is off, so it seeds until
  you stop it."), that leaving earlier "can count as a hit-and-run" on a private tracker, and that there is nothing to delete
  (the seeding file is the library file's hardlink). A row that cannot delete says why: "Its files cannot be deleted from here,
  because part of it is already in your library." (a pack adds what stays in the download folder). A pack's "2 of 4 episodes
  are in your library and stay there" counts only linked, scanned or bound episodes (and those blocked after their link, `binding_not_observed`), and shows
  only where nothing is deleted. A Replace adds "Your 1080p
  file stays.". A delete the plugin still refuses (`delete_not_allowed`) opens the dialog again without the delete, with the
  plugin's sentence as the note.

## Do not

- Put a text button inside a list row, or a labelled button where a row icon is the pattern.
- Invent a fourth colour or a smaller size; a secondary action is grey at Save's size.
