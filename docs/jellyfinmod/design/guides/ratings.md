# Ratings: the group, its popup and the card rating

**Status: approved 2026-11-06, D288–D295, built, not accepted.** Computer first look only; phone/TV specifics and full acceptance follow the user's first look. These values supersede the older presentation notes below.

## Clickable ratings (D274/D276/D277)

**Status: approved 2026-11-06, D276/D277 with D274 defaults, built, not accepted.** Computer first look;
touch row sizing is included. TV remains display only. This section supersedes the older display-only presentation.
Code: `design/Ratings.tsx`, `design/ratingLinks.scss`, `components/RatingsGroup.tsx`, `utils/ratingLinks.ts`.

Every title-head rating opens its source. The group remains one `<button>`: on a hover-capable computer,
a mouse click on a mark calls `window.open(url, '_blank', 'noopener,noreferrer')`. There is no nested link.
Marks never take keyboard focus; middle-click is available on the popup row. Each mark takes 0.3em on either
side of the existing 0.6em gap, with 0.382em corners; the group's reservation and Trakt-gives-way rule stay.
The pointer lights only its mark or row with the 12% `--tint`, never the group too. Keyboard, touch and TV
keep the group's lit state. Touch anywhere on the group opens the popup; TV OK does the same.

The popup is at least as wide as the ratings line above it and its words are one φ step larger (1.236em), counts right-aligned
(option B, the user, 2026-11-07: it read small under the line).
Popup rows are whole-row `<a target="_blank" rel="noreferrer">` links, with the same mark/value/count columns
and no arrow. The popup is a labelled group, never a tooltip. Each accessible row label retains source,
value, votes, provenance and staleness and adds "Open on <Source>". Neither marks nor rows use native tooltips.
Computer rows are 1.618em high; touch rows 2.7816em; TV rows remain 1.382em with no links or row focus stops.
Side padding is 0.236em and row inset 0.382em (total text inset remains 0.618em). Hover tint has 0.382em
corners; keyboard rows have a 0.135em inner primary ring. Count ink is colour, never opacity: white 70%,
light ink 74.3%, so the tint stays even under all columns. Existing stale-value dimming remains.

Focus order on a computer: group, each row in source preference order, then Play. Focus keeps the popup
open while moving to rows. The existing 150ms close delay spans the 0.382em gap; following a link closes
it. Escape, outside tap and TV Back retain their dismissal behavior. TV has exactly one group stop.

### Source URLs

All supplied URLs must use HTTPS and the exact source host (optionally `www.`); Trakt also allows
`app.trakt.tv`. Credentials, non-default ports, query strings, fragments and other paths are rejected.
Only the validated host and path are rebuilt. Trusted fallbacks below encode the title with `encodeURIComponent`,
without a year. A season/episode uses its series title and identifiers.

| Source | Title page | Fallback |
| --- | --- | --- |
| IMDb | valid `ExternalUrls` IMDb `/title/tt<7–10 digits>/` | entry IMDb id in that path |
| TMDB | valid `ExternalUrls` TMDB `/movie/<id>` or `/tv/<id>` (optional slug) | entry TMDB id with its media type |
| Trakt | valid `ExternalUrls` Trakt `/movies/<slug>` or `/shows/<slug>` | entry IMDb id in that path, else `/search/tmdb/<id>?id_type=movie` or `show` |
| RT critics/audience | rating's optional `url`, `rottentomatoes.com/m/<slug>` or `/tv/<slug>` (optional `/s<number>`) | `https://www.rottentomatoes.com/search?search=<title>` |
| Metacritic critics/users | rating's optional `url`, `metacritic.com/movie/<slug>` or `/tv/<slug>` (optional `/season-<number>`) | `https://www.metacritic.com/search/<title>/` |
| Letterboxd | rating's optional `url`, `letterboxd.com/film/<slug>/` or `/tmdb/<id>/` | `https://letterboxd.com/tmdb/<id>/`, films only |
| Roger Ebert | rating's optional `url`, `rogerebert.com/reviews/<slug>` | `https://www.rogerebert.com/?s=<title>` |

The plugin owns lookup and storage of per-source title-page URLs (D277); older plugin answers omit `url`
and immediately use the fallback. Never expose a provider API key. The web's fallback defaults are IMDb,
RT critics, RT audience, **TMDB**, Trakt (D274). TMDB remains popup-only except the existing single-value
fallback. Saved user choices and the plugin's returned administrator defaults still win; the migration
that updates untouched administrator defaults belongs to the plugin change.

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
TV rows are **1.382em**, marks **1em**, numbers and counts **.764em**, counts right aligned/tabular at 70% (light 85.4%).
The source name and “votes” are in title/accessible text only. D276/D277 above replaces the original non-interactive rows and pointer highlight.
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

The title's ratings from MDBList and TMDB, each linked to its source, in the detail page's first metadata row (year, runtime, rating badge,
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

The clickable rows, sizing, inset, count ink and focus behavior are defined above in D276/D277. Existing
glass remains: dark #202020 at 38.2%, blur(1.618em) saturate(180%) contrast(.7) brightness(.85), light
shared glass tokens, .618em corners, .382em caret gap, .236em/1em shadow. Intrinsic column width,
centred under the full mark/value stack. TV and unsupported engines use solid paper. Entrance .382s,
exit .236s; TV .146s/instant; reduced motion .146s fade. Source/value/votes/provenance/staleness stay in
accessible labels and hidden text, with no native tooltip.

## The card rating

- Off by default; a user picks one source in **Ratings Display** (`#/catalog/preferences`, from the user menu and the TV's
  link under Home).
- Appended to the card's secondary text line as `· <mark> <value>` (`.jfmod-cardRating`, mark `1em` high, `0.25em` before the
  value); a card with no secondary line gets one. No corner badge, no focus stop of its own. Stale: 70 % opacity.

## Settings and actions

- Settings area → **Ratings** (`settingsSections.tsx`; layout and copy user 2026-11-07, ds.t9, built, not accepted): on/off, the
  write-only **MDBList API Key** with Get a Key ↗, Test and Save in the field ([secret-field.md](secret-field.md)),
  **Ratings Shown** ("For everyone who has not picked their own. The first two show beside the title, all of them in the
  popup.") with one checkbox per source and round Move Up / Move Down icons (default ticked: IMDb, RT critics, RT audience,
  TMDB, Trakt), then a closed **Advanced** with *Fetch again after (days)* (14) and *MDBList calls per day* (500) side by side
  and "MDBList's free tier allows 1,000 calls a day." ([settings-field.md](settings-field.md)), then **Fetching** as one wrapped
  line: "Today 5 of 500 calls · Without ratings 7 of 7 titles · Last run …" (the provider's state is the section's status).
- **Refresh Ratings** (administrators, where the plugin offers it): an item in the More menu of a movie's and a series' native
  page (its own sheet id, `jfmod-more-refresh-ratings`) and of a file-less movie's page; a button beside Refresh Metadata on the
  file-less series page. Its result is the app's toast.

## Copy

- Source names: IMDb, Rotten Tomatoes critics, Rotten Tomatoes audience, TMDB, Trakt, Metacritic critics, Metacritic users,
  Letterboxd, Roger Ebert; short forms on Ratings Display's card choices (RT critics, RT audience).

## Do not

- Add a second ratings line, pills, a lead or averaged number.
- Fit or move the group after its first paint while focus is past it.
- Show a source the user (or the server default) has not ticked, in the row or in the popup.
