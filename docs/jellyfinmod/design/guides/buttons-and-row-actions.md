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
  Fix `build`, Rebind `link`, Keep `push_pin`, History, Add +, Replace the circular swap.
- A refused action (nowhere to move, busy, blocked) uses `aria-disabled`, never `disabled`, so the D-pad keeps its place;
  it dims to 45 % and its tooltip says why.
- State lives in the glyph, not in a badge: a working icon animates its own glyph (transform or opacity only), a passed one
  turns green, a failed one turns red and changes shape. Reduced motion stops the animation and dims the glyph instead.
- On the TV each icon is a focus stop with the white double focus ring; the arrows walk a row's icons left to right.
  Indicators (the download mark, the file-state marks) are **not** buttons and take none of this.

## Do not

- Put a text button inside a list row, or a labelled button where a row icon is the pattern.
- Invent a fourth colour or a smaller size; a secondary action is grey at Save's size.
