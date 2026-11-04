# Poster card

**dsF sweep (2026-11-04), built, not accepted:** every user page now draws `cell`, so `cardDesign.scss` is deleted. A computer window under 600 px takes the phone's page (2 posters a row). `SectionContainer` draws `sect/rowt/rowx` on painted pages, so Suggestions, Genres and Upcoming rows match. Row and pill have no Info: the card or row itself opens the title.

**dsD (2026-11-04), built, not accepted:** title-page cards and person rows now draw source `cell > tile > post`,
`capt` with three fixed-height lines, and lazy images/fallback SVGs through `design/TitlePage.tsx`/`BrowsePage.tsx`. Original native
card nodes remain hidden data/command hosts. Hover/focus forwards the existing release lookup; body, Play and More keep existing
commands. TV has one card stop; its decorative disc/foot actions have tabindex -1. Native horizontal rows retain source cell
padding around the ring, visible poster overflow and no paint containment. LibraryCast's fetching and page-size-0 rule remain.
[CSS, source markup and runner inventory](../dsD.md).

**dsB (2026-11-04), built, not accepted:** HomeMergedRow now uses the same native `Section`/`Cell`, including three fixed caption slots, existing batched LibraryCast and its page-size-0 blank slot. Home uses its original merged feeds and actions. [Scope and CSS adapters](../dsB.md).

**dsA (2026-11-04), built, not accepted:** Movies, Shows and Favorites now draw the mockup's own `Cell` markup from `design/Cell.tsx`, scoped copied CSS, and `LibraryItems`/`LibraryToolbar`. The native structure is `.cell > .tile > .post` plus `.capt`; upstream card restyling remains only on surfaces outside this slice. Cast fetching and the page-size-0 blank third slot stay in `LibraryCast`. [CSS exceptions, retained behavior and validation](../dsA.md).

**Status:** approved by the user: rounded posters D214, D225–D226, the hover D216–D218, D227–D229, the disc D248, the grid and caption D260, the light glass
D258, D259, D262 (workspace `reviews/overnight-2026-10-28/DECISIONS.md`; rulebook [GUIDELINES.md](../GUIDELINES.md) section 5, Cards). Redesign slice 1: **built (not
accepted)**. Code: `components/cardDesign.scss`, `components/lightGlass.scss`, `components/LibraryCast.tsx`, one class and `LibraryCast` in `libraries/components/ItemsView.tsx`
(on the patch surface already). Upstream's `card.scss` and card components are not edited; these rules outrank theirs.

## Values

Base unit 1em (computer 14.88 px, phone 14.4 px, TV 20 px). φ steps named; exceptions are in rulebook section 9.

| Part | Value |
| --- | --- |
| Corners | 0.618em (φ⁻¹), poster and still |
| Hover ring | `0 0 0 0.135em` primary, follows the corners, no lift; in 0.382 s, out 0.236 s. Keyboard focus 0.236em (φ⁻³) |
| Dim | black 23.6 % (φ⁻³), on the overlay's fill, with the ring. The overlay's own opacity stays 1: a parent fading its opacity cuts a child's blur off from the poster |
| Disc | 3.236em (2φ, 48 px at a computer), card glass, glyph 2em; hidden at rest, so a grid pays for no blur until hovered |
| Disc under the pointer | scale 1.146 (55 px), fill white 85.4 % with a `#101010` glyph, light theme `rgba(16,16,16,.854)` with a white glyph; 0.236 s; press scale 1.09 on 0.146 s; no ring; pointer cursor |
| Foot pill | Watched, Favourite, Get a Release, More; card glass, hugs its buttons, centred 0.382em above the foot, radius 1.618em, padding 0.09em by 0.236em; buttons 2em round, glyph 1.236em, hover tint white 23.6 %, light black 14.6 % |
| Phone | no hover, no ring, no overlay buttons: a tap opens the title |
| TV | the ring at 0.236em, solid disc (black 66 %) from `::after`, both instant; press 0.96 at once; no pill, no dim, no blur |
| Missing art | keeps the ratio box and upstream's fallback icon |

## The Movies and Shows grid

Class `jfmod-libposters`, on the poster view of those two tabs only (`ImageType` Primary, not the list view); other views and Search keep their own. It overrides the view
settings for that view: 2:3 shape, title and year always on, no card layout.

- **Count**, by media query from a 16.18em target cell, stretched to fill: below 600 px 2; 600 3; 921 4; 1170 5; 1419 6; 1668 7; 1917 8; 2166 9; 2415 10; 2664 11; 2913 12. TV 6 at any size.
- **Cell:** padded 1em, with the gutter reduced by that 1em so a poster's edge sits on it. Phone: flush, 0.618em between cards.
- **Caption:** left-aligned, 0.382em under the poster, three lines at pitch 1.618, each cut with an ellipsis and holding its height when empty: title 700; year 400; the two lead
  actors at 0.854em and 85.4 % ink (1em on the TV).
- **Cast:** one read of the page's native ids (`fields=People`, 100 ids a request), never per title, because the plugin's combined browse has no People. Page size 0: not asked, the
  line stays blank (5000 titles would add about 20 MB). A title with no cast of its own, or no native item, shows its entry's cast if it has one (a series' regulars).

## Rules

- No `color-mix`, `inset`, `aspect-ratio`, flex `gap` or `min()`/`max()` in a rule the TV takes; the glass is behind `@supports`, solid black 66 % with white ink without it.
- `!important` only against upstream's own on `.cardOverlayButtonIcon`.

**The ring needs room:** the ring is drawn outside the poster, so a card must not contain paint. `cardDesign.scss` takes `paint` out of upstream's `.card:not(.show-animation)` containment; with it, a row's cards lose the ring's left side (the user's report, 2026-11-04).

**Icon sizes:** the foot pill's glyphs are 1.236em (18.4 px on a computer) in 2em buttons, the disc's 2em. Each rule also sets `font-size: 1em` on the svg, because MUI's SvgIcon sets 1.5rem and an em width would count from that (the user's report, 2026-11-04).
