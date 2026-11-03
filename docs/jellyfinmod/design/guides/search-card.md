# Search card

**Status:** approved by the user 2026-11-01 (D200–D203 in workspace `reviews/overnight-2026-10-28/DECISIONS.md`: "C with 5
per row", the three-line caption with the year not bold, "The hover should be border to border to other cell … Seemless",
"hover should not [have] circled corners", "approved, apply it to the browse page too"). After the first look (user,
2026-11-01): the order "full match", "the latest release", then "fuzzy match"; the + "similar design and hover effect as cloud
or play on the poster". Mockups `reviews/tmdb-search-design/mockup/`
(states default, hover, adding, added, focus, loading, end) and `reviews/tmdb-browse-design/mockup/`. Built on both
lines (TM2, [TMDB-BROWSE.md](../../TMDB-BROWSE.md)); first look approved (D232), the Seasons arrows D252; **built (not accepted)**. Code: `components/SearchCard.tsx`,
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
| Cell | padded **1em** on every side (even padding is the named exception to vertical = horizontal × φ, as Jellyfin's card); square corners |
| Poster | 2:3, radius 0.2em (the card's), paper behind it; the kind's icon at 35 % without artwork |
| Caption | 0.382em (φ⁻²) under the poster; three 1em lines at line-height 1.618 (φ), each one line with an ellipsis, kept when empty |
| Line 1 | the title, weight 700, full ink (`text-primary`) |
| Line 2 | the year, weight 400, full ink; for a show "TV Series" 0.618em (φ⁻¹) after it at 85.4 % (1 − φ⁻⁴); nothing for a movie |
| Line 3 | the two lead actors, comma separated, at 85.4 % |
| Hover | the whole cell paper (`--jf-palette-background-paper`, #202020), 0.15 s; not on the phone |
| TV focus | the same paper plus the primary ring **inside** the cell, `inset 0 0 0 0.382em` (φ⁻²) |
| Phone | cells flush (padding 0 1em 1.618em 0), no hover panel |

## Marks and the add disc

- **TMDB result:** the + as a library poster's centre button, drawn with upstream's own hover overlay (`cardOverlayContainer`,
  `cardOverlayFab-primary`, the Material `add` glyph), as Play and the mod's cloud are on a library card: hidden at rest; on the
  cell's hover or focus the poster dims to black 50 % and the round button appears (black 70 %, 3em at 130 % of the cell's
  font, 0.2 s), growing to 1.4 under the pointer; keyboard ring `0 0 0 0.15em` primary. While adding, the overlay stays shown
  and the importing arc's 28 % segment turns white round the button (1.2 s, linear; stopped by reduced motion). Desktop only,
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
one row the template gives none, so it gets the markup of the template's other rows): on a computer ‹ and › sit on the heading's line and
are hidden while the row fits; the phone scrolls by touch and the TV by focus, with no arrows. The computer's Seasons row sits beside the
poster, so its frame takes the 1em pull-out and clips, and a scrolled row never slides over the poster. A person without a portrait shows the person icon on upstream's default card background.

## Order

Full matches first (the title equals the query, ignoring case, spaces and punctuation), library titles and TMDB results
together, newest release first (by year, then by the full date where both have one). Then the rest: library titles by name,
then TMDB's results, each page's movies and shows ranked together by popularity. The grid shows skeletons until the first
library and TMDB answers are in; after that nothing shown moves: newly loaded results follow, sorted by the same rule, and a
card added from the search keeps its place.

## Rules

- The whole cell opens the title: a library title its library page, a TMDB result its browse page. The + adds without opening.
- No flex gap, `min()`, `max()` or `:has` (older webOS).
- Departing from these values is a design decision for the user.
