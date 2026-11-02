# TM2 — TMDB search grid and browse pages

**Status: built (not accepted).** Requested by the user 2026-11-01 ("Implement new browse cards and design, so I can test
it", decision D204 in workspace `reviews/overnight-2026-10-28/DECISIONS.md`). Approved designs: the search mockup
`reviews/tmdb-search-design/mockup/` (D195, D200–D203) and the browse mockup `reviews/tmdb-browse-design/mockup/` (D196,
D203). Built on `main-items` (branches `feat/tmdb-browse-items` in both repositories); `main-stubs` gets the port at gate 2.
Gates as in the workspace rules: gate 1 is computer, dark theme, on one local environment.

## What changes for the user

- **Search** (`#/search`): one vertical grid, movies and shows together, library titles and TMDB results mixed. The order
  (user, 2026-11-01, after the first look: "full match", "the latest release" and then "fuzzy match"): titles equal to the
  query first, newest release first; then the rest, library titles by name, then TMDB's results with each page's movies and
  shows ranked together by popularity. Cards already shown never move. Five cells per row on computer and TV, two on
  the phone. More results load by themselves near the end (a row of skeleton cells while they load; "No more results for
  “…”" at the end). No "Add from TMDB" heading, no horizontal rows. The search ignores the library it was opened from
  (D201): Movies or Shows, it returns both. Stock's other sections (people, episodes, …) stay under the grid.
- **The card** (guide [search-card.md](design/guides/search-card.md)): a 2:3 poster; on a TMDB result the + in the poster's
  centre, drawn and shown on hover as a library poster's Play or cloud (desktop; elsewhere Add is on the browse page); a library title without a file shows the Not Downloaded cloud top
  right, one with a file shows nothing. Caption of three lines: title 700, year (and "TV Series" at 85.4 % for shows), the
  two lead actors at 85.4 %. Cells touch, each padded 1em; under the pointer (and the TV focus) the whole cell is lit paper
  with square corners. The administrator's Undo line above the grid after an add, as before.
- **Opening a card**: a library title opens its library page as before; a TMDB result opens its **browse page**.
- **Browse pages** (`#/details?tmdbType=movie|series&tmdbId=N[&season=S[&episode=E]]`): upstream's detail page drawn from
  TMDB — backdrop, poster, title, meta line, overview, genres, director/writers or creators, Cast & Crew; a series adds its
  Seasons, a season its episode rows, an episode its Guest Stars and More from the season. The meta line carries the rating
  as the other pages do: TMDB's ★ (a season shows the show's, with its certification; an episode its own), and no external
  links line (user, 2026-11-01: "instead of TMDB link use ratings"). One action, **Add to Library**, on every page, the
  season's and the episode's included (user, 2026-11-01), the same button, in the same place; it always adds the whole movie
  or show (never a season or an episode alone). After Add, the title's own library page opens. Card rows use the search
  card's lit cell with left-aligned captions (D203).

## Tasks

| Task | Repo | What |
| --- | --- | --- |
| tm2.p1 | plugin | `GET /JellyfinMod/Discover/Title?type=&tmdbId=[&season=]`: the title with cast, crew and creators, and a season's episodes with guest stars and crew; read-only, the search's access rules; Health capability `discover.title`. TMDB's `popularity` on metadata; a movie's cast read with its details (token and Jellyfin's own TMDb connection alike, D189). |
| tm2.s1 | web | The search grid and card (this page's *Search*), D201 scope, auto-load, Undo. |
| tm2.b1 | web | The browse pages on upstream's detail template (`tmdbDetails.js`, `TmdbDetails.tsx`), Add to Library. |
| tm2.p2 | plugin | Read the TMDB source once for a search's parallel detail calls; one title's failure skips only that title. |
| tm2.d1 | web | This plan, the PLAN.md line, the search card guide. |

- **TMDB detail reads** (tm2.p2): the TMDB source (saved token or Jellyfin's connection) is read once per few seconds instead of
  per call, and one title's failed details skip that title only. Before, a search's parallel detail calls each read the
  settings row and the secret store, SQLite answered "database is locked", and the whole kind's page failed ("TMDB movie
  results are unavailable right now"); old code from P1.FU13, not new in TM2.

## Not built (simple on purpose)

- No new setting. A library choice is asked only when a title has more than one library of its kind and the search was not
  opened from one (stock action sheet).
- Through Jellyfin's own TMDb connection TMDB returns one page per kind (about 40 results); a saved token pages further.
- The browse page does not look the title up in the library: search links library titles to their library page, and Add
  is idempotent (a second Add opens the existing entry).

## Checks

Gate 1: typecheck, lint, the plugin build, a smoke run and screenshots in Playwright Chromium on one environment. The
matrix (phone, TV 1280/1920, light theme, real Chrome), a plugin integration case for `Discover/Title` and the Codex review
belong to the later gates.
