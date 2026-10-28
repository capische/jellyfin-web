# Ratings: the group, its popup and the card rating

**Status:** built, awaiting the user's approval. The design follows user decisions 9, 10 and 13 (2026-10-08, `PHASE9.md`
*Final design*), ported onto both lines on 2026-10-28 (`PHASE9.md` *Port onto the main lines*); Phase 9 is built (not
accepted). Code: web `components/RatingsGroup.tsx`, `components/RatingIcon.tsx`, `components/ratings.scss`,
`components/NativeRatingsLine.tsx`, `constants/ratings.ts`, `hooks/useRatingsPreferences.ts`; the card rating in
`components/EntryCard.tsx`; the native mount in `integration/nativeEntryDetails.js`. Used by: the native and file-less detail
pages of movies and series, and the cards of Movies and TV when the user picks a card source.

## What it is

The title's ratings from MDBList and TMDB, display only, in the detail page's first metadata row (year, runtime, rating badge,
"Ends at"), where Jellyfin's own ★ and tomato are. No second line, no pills, no aggregate number: each value stays in its own
scale (`8.1`, `91%`, `4.1`).

## The group (row)

- One control (`.jfmod-ratingsGroup`, its button `[data-jfmod-ratings-group]`), mounted before upstream's `.starRatingContainer`.
- Order: **IMDb**, **Rotten Tomatoes critics** (tomato), **Rotten Tomatoes audience** (popcorn), **Trakt**, as the ticked
  sources' order says. Each item is `<mark> <value>`, `0.8em` apart (the row's own items are `1em` apart).
- **Marks** (`RatingIcon`, inline SVG, never a file): `1.15em` high, `0.35em` before the value, on the text's line
  (`vertical-align -0.2em`). IMDb yellow `#f5c518` badge with black "IMDb"; RT fresh/rotten tomato; RT popcorn upright/spilled;
  Trakt red ring with a check.
- **Stock marks:** the ★ gives way while the group shows IMDb (`.jfmod-ratings-hideStar`), the tomato while it shows Rotten
  Tomatoes (`.jfmod-ratings-hideCritic`); a title without those values keeps the stock marks.
- **Trakt gives way** when the row does not fit on one line with it; IMDb and both RT values never do. Decided once at the
  first paint from a hidden stand-in at the widest values ("10.0", "100%"); the space is reserved then, so a late answer never
  moves a focused control. Phone (390 px): Trakt gives way, IMDb and both RT marks stay.
- **Stale** values (older than the refresh window) are dimmed (`.jfmod-groupItem-stale`).
- **TV:** one focus stop reached by Up from the buttons; first focus stays on Play. Focused: `rgba(255,255,255,.18)` fill and a
  `0.12em` `#00a4dc` outline, `0.1em` offset. Touch: `3em` minimum height.

## The popup

- One row per ticked rating, in three aligned columns: **mark**, **value** (600), **votes** (compact: `250K votes`, `5.7K`,
  70 % opacity, clipped with an ellipsis). No heading, no footer, no "via …" line, no links.
- Exactly as wide as the group with all its ticked sources (Trakt included even when it gave way); a row never widens it.
- Paper `#202020`, ink `rgba(255,255,255,.87)`, `0.2em` radius, padding `0.45em 0.6em`, shadow `0 .2em .9em rgba(0,0,0,.6)`,
  `86 %` text, fixed above the page (z-index 1100), never wider or taller than the screen (scrolls inside).
- Where a value came from and when ("via MDBList, as of …") is the row's `title` and hidden text for a screen reader.
- **Opens** on hover on a computer, a tap on a phone, OK on a TV. **Closes** on leaving, Escape, a tap elsewhere, or Back on the
  TV (Back closes only the popup; Back with no popup leaves the page).

## The card rating

- Off by default; a user picks one source in **Ratings Display** (`#/catalog/preferences`, from the user menu and the TV's
  link under Home).
- Appended to the card's secondary text line as `· <mark> <value>` (`.jfmod-cardRating`, mark `1em` high, `0.25em` before the
  value); a card with no secondary line gets one. No corner badge, no focus stop of its own. Stale: 70 % opacity.

## Settings and actions

- Settings area → **Ratings** (`settingsSections.tsx`): on/off, refresh days (14), MDBList calls per day (500), the write-only
  **MDBList API Key** field with its Test icon ([settings-field.md](settings-field.md), [buttons-and-row-actions.md](buttons-and-row-actions.md)),
  and **Ratings Shown**: one checkbox per source with round Move Up / Move Down icons. Default ticked: IMDb, RT critics,
  RT audience, Trakt.
- **Refresh Ratings** (administrators, where the plugin offers it): an item in the More menu of a movie's and a series' native
  page (its own sheet id, `jfmod-more-refresh-ratings`) and of a file-less movie's page; a button beside Refresh Metadata on the
  file-less series page. Its result is the app's toast.

## Copy

- Source names: IMDb, Rotten Tomatoes critics, Rotten Tomatoes audience, TMDB, Trakt, Metacritic critics, Metacritic users,
  Letterboxd, Roger Ebert; short forms on Ratings Display's card choices (RT critics, RT audience).

## Do not

- Add a second ratings line, pills, a lead or averaged number, or links to the sources.
- Fit or move the group after its first paint while focus is past it.
- Show a source the user (or the server default) has not ticked, in the row or in the popup.
