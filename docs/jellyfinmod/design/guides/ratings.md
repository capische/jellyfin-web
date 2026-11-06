# Ratings: the group, its popup and the card rating

**Status: approved 2026-11-06, D288–D295, built, not accepted.** Computer first look only; phone/TV specifics and full acceptance follow the user's first look. These values supersede the older presentation notes below.

## Title top metadata (D288–D295)

Ratings retain their group, source preference and popup. The title's metadata has no extra top margin; each item is
0.382em below Directed by and 1em from its neighbour. A played title's Watched date follows the group and Ends at,
with its own blue check (1.236em, 0.236em before the words) and 85.4% text. Count from 2 plays follows the date as
requested in the build brief. This adds no focus stop. Status/reading measure is 46.98em; the metadata is not capped.
External links still omit every source already represented by a rating (D276); TV has no links line.


**Dropdown geometry fix (2026-11-05, user brief), built, not accepted:** `design/Ratings.tsx` uses
`.jfmod-ratingsAnchor` (`design/cardRatings.scss`), an inline flex box enclosing the full mark/value stack. The existing
centred popup's `top: 100%` now starts below that full box, with its `0.382em` gap (1em base, φ⁻²) and existing caret,
for one or several marks and all layouts. Neither the group, its marks nor its popup rows carry a native `title` tooltip;
each row retains the full source/value/votes/provenance/staleness text in `aria-label` and hidden provenance text.

**dsD (2026-11-04), built, not accepted:** native and entry title pages now use `design/Ratings.tsx` source
`rgwrap/rgroup/ritem/rmenu/rrow`, with the existing RatingIcon marks and all RatingsGroup source/scale/reserve/late-answer/focus/
Back logic. Hidden stand-ins reserve their real maximum values; a fallback reserves the widest enabled rating, never their sum,
and is excluded from TV focus. Stale values retain .55 opacity and provenance remains in accessible labels and hidden text.
`RatingsPreferencesPage.tsx` uses source settings cards/switches/fields with its existing save/reorder/reset/service-state hooks.
The deleted `ratingsPreferences.scss` and title restyling do not style these surfaces. [Current CSS inventory and limits](../dsD.md).

**dsB (2026-11-04), built, not accepted:** Home reads the existing NativeRatingsLine data/preferences and RatingsGroup state/reserve/focus/Back logic. In native design context only, `design/Ratings.tsx` renders `rgwrap/rgroup/ritem/rmenu/rrow` and the existing RatingIcon marks with the copied CSS. Existing detail-page presentation is unchanged. [Validation and CSS adapters](../dsB.md).

**rd3 presentation (approved D243 and rulebook §5, built, not accepted):** `shell/titlePages.scss` draws the
popup as an intrinsic-width table of mark/value/count columns, centered on its group and clamped to the viewport.
It is glass with .618em corners, .382em/.618em padding, a .382em caret gap and .236em/1em shadow. Dark: #202020
at .382 with blur(1.618em) saturate(180%) contrast(.7) brightness(.85); light reads the shared light-glass tokens
with its own 1.618em blur. Recipes are behind @supports; TV and unsupported engines use solid paper and its ink.
Rows are **1.382em**, marks **1em**, numbers and counts **.764em**, counts right aligned/tabular at 70% (light 85.4%).
The source name and “votes” are in title/accessible text only. No row is interactive. An open group is lit.
Entrance .382s, exit .236s; TV .146s entrance/instant exit; reduced motion .146s fade. Existing hover/tap/OK,
Back/Escape/outside dismissal and focus reservation remain. The old fixed group-width/11em minimum below is superseded.
File-less movie ratings now share the **first** metadata row with year/runtime. Native season/episode heads may
show returned sources too. Missing values are never fabricated: Discover/Title currently supplies only TMDB metadata,
and file-less season/episode responses have no per-source ratings; those retain available stock scores pending backend support.

**Status:** built, awaiting the user's approval. The design follows user decisions 9, 10 and 13 (2026-10-08, `PHASE9.md`
*Final design*), ported onto both lines on 2026-10-28 (`PHASE9.md` *Port onto the main lines*); each item stacked, mark over
number (design A2, approved by the user 2026-10-30, with a percent number's mark centred on the number as a unit and the popup's
marks centred in their column); Phase 9 is accepted (user, 2026-10-30). Code: web `components/RatingsGroup.tsx`, `components/RatingIcon.tsx`, `components/ratings.scss`,
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
  sources' order says. Each item is a small stack, **its mark over its number**, centred on the row like the row's other
  items; the stacks are `0.6em` apart (`.jfmod-groupItem`, a flex column). The row grows from one text line to the stack's
  height (computer 26 → 33 px, TV 35 → 44 px; a phone's ratings already have their own touch-high line, so it does not grow).
- **Marks** (`RatingIcon`, inline SVG, never a file): `1em` high, `0.1em` above the number (both tomato marks `1.04em` wide).
  IMDb yellow `#f5c518` badge with black "IMDb"; RT fresh/rotten tomato; RT popcorn upright/spilled; Trakt red ring with a check.
- **Number** (`.jfmod-groupValue`): `0.78em`, weight 600, line height 1.15, the row's text colour, about as wide as its mark.
  A percent value (`.jfmod-groupValue-percent`) leads with `0.45em` of space, about half its "%" sign, so the mark sits over
  the number as a unit: centred on the whole number the digits looked left of the mark, centred on the digits alone the "%"
  looked right (user, 2026-10-30). The mark's centre is then about 2–3.5 px left of the whole number's and 1.5–4 px right of
  the digits'; the gaps between stacks stay even (computer and phone 14–15 px, TV 19–21 px).
- **Stock marks:** the ★ is Jellyfin's own community rating, from its metadata providers (on delta 2026-10-30: Hack Your
  Health's ★ 6.7 matches TMDB's 67 %, Peep Show's ★ 8.7 matches IMDb's 8.7, not TMDB's 8.0), so it gives way whenever the group shows
  (`.jfmod-ratings-hideStar`; user, 2026-10-30), and the file-less page's own TMDB star likewise, from the same decision (the
  group tells the page, `onHidesStar`). An answer that leaves the group nothing to show (empty, failed, ratings turned off) gives the
  stock marks back at once; while focus sits below, the group goes (nothing left to focus) and the row keeps the height it
  had (an inline `min-height`, a wrapped row included) until the next layout or until focus is no longer below the row
  (Up to the header), so nothing below it moves. The tomato gives way while the
  group shows Rotten Tomatoes (`.jfmod-ratings-hideCritic`). With the group not shown (ratings off, no value) the stock marks
  stay.
- **Trakt gives way** when the row does not fit on one line with it; IMDb and both RT values never do. Decided once at the
  first paint from a hidden stand-in at the widest values ("10.0", "100%"); the space is reserved then, so a late answer never
  moves a focused control. Once the answer is in, the group gives back what it does not use and takes its own width (user,
  2026-10-30): the next item ("Ends at") moves left once and sits the row's usual gap after the last value (computer 18 px,
  TV 24 px), the fallback's single value included. Phone (390 px): all four fit on the ratings' own line with the stacked items (Peep Show, 2026-10-30).
- **Stale** values (older than the refresh window) are dimmed (`.jfmod-groupItem-stale`).
- **TV:** one focus stop reached by Up from the buttons; first focus stays on Play. Focused: `rgba(255,255,255,.18)` fill and a
  `0.12em` `#00a4dc` outline, `0.1em` offset. Touch: `3em` minimum height.
- **Computer focus (D282, user, 2026-11-06):** pointer clicks leave no outline, even after a key press; keyboard focus and TV keep the ring, and hover/open tint remains.

## The popup

- One row per ticked rating, in three aligned columns: **mark** (each centred in the column, so the marks line up under the
  IMDb badge, and on its row's text within 1 px), **value** (600), **votes** (compact: `250K votes`, `5.7K`,
  70 % opacity, clipped with an ellipsis). No heading, no footer, no "via …" line, no links.
- As wide as the group with all its ticked sources (Trakt included even when it gave way), and at least `11em` (one row of
  mark, value and votes, so a single source's popup never clips its value); a row never widens it.
- Paper `#202020`, ink `rgba(255,255,255,.87)`, `0.2em` radius, padding `0.45em 0.6em`, shadow `0 .2em .9em rgba(0,0,0,.6)`,
  `86 %` text, fixed above the page (z-index 1100), never wider or taller than the screen (scrolls inside).
- Where a value came from and when ("via MDBList, as of …") is in the row's accessible label and hidden text for a screen reader,
  without a native `title` tooltip over the dropdown.
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
