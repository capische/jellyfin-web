# Search card

**Library titles take Home's disc and foot pill (ds.t16), the user 2026-11-07 ("Search - if in library. Play if file exists.
Download should be … if in Library but not on the disk"), built, not accepted.** A library title's card (`CatalogSearchResults`
→ `SearchCell` with its browse row) draws the poster card's centre disc from `design/Cell.tsx` (`CellDisc`, `useCellModel`):
**Play** when the title has a file, **Download** when it is in the library without one, the **progress ring** while something of
it is on its way ([download-state-mark.md](download-state-mark.md)); and the poster card's foot pill (Watched, Favourite, More;
`CellMenu`). Their commands run through upstream's `ItemsContainer`, now around the results, as on Home. A TMDB result keeps its
**+** (Add to Library); the caption and the corner marks are unchanged.

**Search on B (ds.t13), approved by the user 2026-11-07 (workspace `reviews/golden-pages/search.html`), built, not accepted.** The
results' cells take their own font at B (`_golden.scss`), so the poster's corners, the + disc, the ring and the three-line
caption follow the scale and `--jfmod-scale`. The grid sits on the page gutter, its first row Bφ¹ under the bar; cells are Bφ¹
apart across and Bφ² down (vertical = horizontal × φ; each cell padded half of that). Five a row on a computer and the TV,
**three on a tablet** (the user: "tablet 3 across"; was 4), two on a phone with B across and Bφ¹ down and the field a Bφ² pill
Bφ⁻² under the bar. The cast line cuts sooner at B (accepted by the user). The inline 3.3 % padding on the results is gone. This
supersedes the 1em cell padding and the 3.236em side padding below.

**dsB (2026-11-04), built, not accepted:** `design/SearchCell.tsx`, `Search.tsx`, `BrowsePage.tsx`, `Head.tsx` and `Poster.tsx` draw the approved mockup elements/classes directly. Search has the source 5/4/2 grid, 1em tile padding (phone 0/.618em/1em/0), three fixed caption slots, a computer-only hover/focus + and lazy ratio/fallback images. Page size 0 leaves cast blank. Browse cells/heads/episode rows are native too; ranking, Add, Undo, routes and data remain unchanged. Older restyling below now applies only where explicitly retained. [Full delta and validation](../dsB.md).

**rd3 browse heads (built, not accepted):** the browse title uses the shared art-ground head and blue
Add to Library pill; original data, routes and Add handler remain. A newly created entry, for an administrator
only, offers Undo beside the destination head; duplicate/racing adds never arm Undo. It uses the existing
Remove Entry API and invalidation, returns to the original browse address on success, and keeps the title on
failure. The notice is visit-local and scoped to server/user/entry. Person cells in these title rows are 8.854em
including their existing 1em padding (6.854em portrait); image failures keep the ratio/fallback. See [title pages](title-pages.md).

**Status:** approved by the user 2026-11-01 (D200–D203 in workspace `reviews/overnight-2026-10-28/DECISIONS.md`: "C with 5
per row", the three-line caption with the year not bold, "The hover should be border to border to other cell … Seemless",
"hover should not [have] circled corners", "approved, apply it to the browse page too"). After the first look (user,
2026-11-01): the + "similar design and hover effect as cloud
or play on the poster". Mockups `reviews/tmdb-search-design/mockup/`
(states default, hover, adding, added, focus, loading, end) and `reviews/tmdb-browse-design/mockup/`. Built on both
lines (TM2, [TMDB-BROWSE.md](../../TMDB-BROWSE.md)); first look approved (D232), the Seasons arrows D252, the order D253; **built (not accepted)**. Rounded corners and the ring in place of the paper panel (departure 1, D214, D225–D226; the disc D248): redesign slice 1, built, not accepted. Code: `components/SearchCard.tsx`,
`components/searchGrid.scss` (`jfmod-search*`); the browse rows' cell `BrowseCell` in `components/TmdbDetails.tsx`,
`components/tmdbDetails.scss` (`jfmod-browse*`).

## What it is

The card of the search grid: one title, a library title or a TMDB result, as a cell of a seamless grid. The same cell, with a
two-line caption, draws the card rows of the browse pages (Seasons, Cast & Crew, Guest Stars, More from the season).

## Anatomy and values

Base unit 1em (the surface's font size; TV 125 %, phone 90 %). φ steps named.

| Part | Value |
| --- | --- |
| Grid | cells touch, no gap; 5 per row on computer and TV (20 %), 2 on the phone (50 %); grid side padding 3.236em (2φ) |
| Cell | padded **1em** on every side (even padding is the named exception to vertical = horizontal × φ, as Jellyfin's card) |
| Poster | 2:3, radius 0.618em (φ⁻¹, the card's), paper behind it; the kind's icon at 35 % without artwork |
| Caption | 0.382em (φ⁻²) under the poster; three 1em lines at line-height 1.618 (φ), each one line with an ellipsis, kept when empty |
| Line 1 | the title, weight 700, full ink (`text-primary`) |
| Line 2 | the year, weight 400, full ink; for a show "TV Series" 0.618em (φ⁻¹) after it at 85.4 % (1 − φ⁻⁴); nothing for a movie |
| Line 3 | the two lead actors, comma separated, at 85.4 % |
| Hover | the card's ring on the poster, 0.135em primary, fading in 0.382 s and out 0.236 s; not on the phone |
| TV focus | the same ring at 0.236em (φ⁻³), instant |
| Phone | cells flush (padding 0 1em 1.618em 0), no hover panel |

## Marks and the add disc

- **TMDB result:** the + as a library poster's disc ([poster-card.md](poster-card.md)), on upstream's own hover overlay markup (`cardOverlayContainer`,
  `cardOverlayFab-primary`, the Material `add` glyph), as Play and the mod's cloud are on a library card: hidden at rest; on the
  cell's hover or focus the poster dims 23.6 % and the glass disc appears, growing 1.146 and filling under the pointer; keyboard ring
  `0 0 0 0.15em` primary. While adding, the disc stays shown
  and the importing arc's 28 % segment turns in the glass's ink round it (1.2 s, linear; stopped by reduced motion). Desktop only,
  as the library's overlay: on the phone and the TV a TMDB result is added from its browse page.
- **Library title without a file:** the Not Downloaded cloud top right ([download-state-mark.md](download-state-mark.md)'s
  file-state mark), an indicator, never a button on the card.
- **Library title with a file:** nothing.
- After an add the card stays where it is and turns into the library card (the cloud); the administrator's Undo line sits above
  the grid ("Added **Title** to the catalog [Undo]").

## Browse rows (D203)

The cell as above, with a two-line caption, left-aligned: line 1 700 at full ink, line 2 at 85.4 %. Portrait images 12.9em wide
(upstream's overflow card), an episode's 16:9 still 20em; the row is pulled out by 1em so the first image lines up with the
section heading (on the TV its scroller's frame is pulled instead, because that frame clips, so the first cell's panel and ring
stay whole). The cells are direct children of upstream's row, so its scroll buttons and the TV's focus walk them.

Every browse row is upstream's scroller with upstream's arrows, Seasons included (user, 2026-11-03, D252: "Add arrows"; Seasons is the
one row the template gives none, so it gets the markup of the template's other rows): on a computer ‹ and › sit on the heading's line in the small pill of [title-pages.md](title-pages.md), and
are hidden while the row fits; the phone scrolls by touch and the TV by focus, with no arrows. The computer's Seasons row sits beside the
poster, so its frame takes the 1em pull-out and clips, and a scrolled row never slides over the poster. A person without a portrait shows the person icon on upstream's default card background.

## Order

D253 (user, 2026-11-03), revising D206. A full match is a title equal to the query, ignoring a leading The, A or An on both, case,
spaces and punctuation. Full matches with 100 or more TMDB votes come first, newest first (by year, then by the full date where both
have one). Everything else follows by votes, most first, full matches under 100 votes included. No language filter (the user declined
one). A library title takes its votes from its entry, else from a TMDB card of it in this search; with none known it keeps its old place:
a full match among the leaders by date, any other title first of the rest, by name. The grid shows skeletons until the first library and
TMDB answers are in; after that nothing shown moves: newly loaded results follow, sorted by the same rule, and a card added from the search
keeps its place.

## Rules

- The whole cell opens the title: a library title its library page, a TMDB result its browse page. The + adds without opening.
- No flex gap, `min()`, `max()` or `:has` (older webOS).
- Departing from these values is a design decision for the user.
