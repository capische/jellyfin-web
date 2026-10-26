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

## Removing a download: the two confirmations

**Status:** approved 2026-10-26 (user: the three texts of `reviews/queue-remove-delete/` in the workspace, and "the
confirmation's Remove button red"). Built on `feat/remove-delete-files` (P5.I7/I8, built, not accepted). Code:
`integration/queueActions.ts` (`confirmQueueRemoval`, `confirmTorrentRemoval`), `queue.scss`, `releasePicker.scss`.

- **Remove from Queue** (the Queue page's row menu): the stock form dialog, Remove red and full width in its footer; stock
  `emby-checkbox` options with sentence-case labels and a description each.
  - Not imported yet (`queued`, `downloading`, `stalled`, `failed`): *Also remove it from the download client* — "The client
    forgets the torrent." Under it, indented **2.2em** (its label lines up with the client option's label) and shown only
    while the client option is ticked: *Delete the downloaded files*, ticked by default — "What this torrent downloaded so
    far. Library files are never touched." Hidden, its tick is not sent. Then *Blocklist this release* — "Later release
    searches reject it."
  - Imported or seeding (every other state): no delete option. The client option reads "The client forgets the torrent and
    stops seeding. The seeding copy stays on disk; library files are never touched."
- **Remove the Torrent** (the picker's added-row X and a missing episode's *Cancel Download*): the stock confirm, Cancel and
  a red Remove — "Remove this torrent from the download queue? The download stops, the torrent leaves the client and the
  files it downloaded are deleted. Files already in your library are not touched." and the release name under it
  (`.jfmod-confirmName`). It always deletes the files; the plugin refuses (`delete_not_allowed`, its sentence shown) when
  part of the download is already in the library.
- **Both Removes stay red under the pointer** (`background: var(--jf-palette-error-main)` on hover; the stock `.raised:hover`
  would turn them grey). Keyboard and TV focus keep the stock focus colour, as every button does.

## Do not

- Put a text button inside a list row, or a labelled button where a row icon is the pattern.
- Invent a fourth colour or a smaller size; a secondary action is grey at Save's size.
