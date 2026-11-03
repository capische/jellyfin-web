# TM2 — TMDB search grid and browse pages

**Status: built (not accepted).** Requested by the user 2026-11-01 ("Implement new browse cards and design, so I can test
it", decision D204 in workspace `reviews/overnight-2026-10-28/DECISIONS.md`). Approved designs: the search mockup
`reviews/tmdb-search-design/mockup/` (D195, D200–D203) and the browse mockup `reviews/tmdb-browse-design/mockup/` (D196,
D203). Built on both lines: branches `feat/tmdb-browse-items` (from `main-items`) and `feat/tmdb-browse` (from `main-stubs`) in
both repositories, the same source on each line. Gate 1 passed (D232: "go, finish Video list and TMDb first", its choices kept:
the font, stock's sections under the grid, a series' first year only, no IMDb, RT or Trakt ratings outside the library). Gate 2
ran 2026-11-02; the user's re-verify (gate 3) and the Codex review (gate 4) follow.

## What changes for the user

- **Search** (`#/search`): one vertical grid, movies and shows together, library titles and TMDB results mixed. The order
  (user, 2026-11-03, D253, revising D206): titles equal to the query, a leading The, A or An not counting, with 100 or more TMDB
  votes first, newest first; then everything else by votes, most first. No language filter. Cards already shown never move. Five cells per row on computer and TV, two on
  the phone. More results load by themselves near the end (a row of skeleton cells while they load; "No more results for
  “…”" at the end), stopping after three pages in a row with nothing to show, with no button to go on (D257). No "Add from TMDB" heading, no horizontal rows. The search ignores the library it was opened from
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
| tm2.b3 | web | Found at gate 2, not visible in the first look's screenshots: the browse rows' › did nothing on a computer (the cells sat in a wrapper, and upstream's scroll buttons walk the slider's children), and the TV cut the first cell's lit panel and ring (its scroller clips to the frame). The cells are now the row's own children, drawn as a plain line so each keeps its width, and on the TV the frame takes the 1em pull-out. Same look. |
| tm2.m1 | web | `scripts/jellyfinmod-e2e/tmdb-browse.mjs`, the gate 2 runner. |
| tm2.s2 | web, plugin | The order by votes (D253). Through Jellyfin's own TMDB connection the plugin did not map a title's votes (only a saved token did); it now does, so both sources order alike, and the same field feeds the rating's vote count. `popularity`, used only by the old order, is gone from the plugin and the web types. A library title usually has no votes, because the plugin removes titles it holds from TMDB's results and an entry stored before this has none: it keeps its old place (guide, *Order*). No migration. |
| tm2.u1 | plugin (`main-stubs`), web | Undo right after + no longer brings the title back (user, 2026-11-03: "Fix Undo bringing a title back"). On `main-stubs` a placeholder is a stub file; the plugin's own listener, stamping a new stub about two seconds after Jellyfin first saw it, saved back an item Undo had just removed, and with the file gone it no longer read as a stub, so reconciliation created an entry for it, bound to nothing. A stub whose file is gone, or a series whose folder is gone with no playable episode, now never creates an entry. A real file is unaffected. Check: `scripts/jellyfinmod-e2e/undo-race.mjs`. No migration, nothing visible changes. |
| tm2.u2 | plugin (both lines) | From the Codex review of `tm2.u1`, whose drop could delete real library items, because a disk that is away leaves its mount point there, and an item another library's entry owns. The race is now fixed at its source (D257): `PlaceholderItemListener` saves under the library lease a removal holds, on the item read again under it, so a save lands before the delete or finds the item gone. This path deletes nothing: no drop and no record remain. Absence from disk only stops a new entry being made; a real title is found when its disk returns. On `main-items` the listener's note save has the same shape and takes the same lease. No table or migration. |
| tm2.r1 | web | From the same review. The search grid's end of page no longer walks on past three empty pages (`useDiscovery`'s budget): one search could read hundreds. A finished Add no longer moves a viewer who has left the page. The check's cleanup deletes only what the run made, and it refuses a title already here. |
| tm2.b4 | web | Arrows on the Seasons row (user, 2026-11-03, D252: "Add arrows"): a series with many seasons could not be reached with a mouse. Seasons gets the markup of the template's other rows, so the same ‹ and ›, hidden while the row fits, none on the phone or the TV. It was the only one of TM2's rows without them: Cast & Crew, Guest Stars and More from the season already have them; a season's episode rows and the search grid are vertical. No new values or components. |
| tm2.p3 | plugin | `Discover/Title` over real HTTP in `tests/PhaseOneSmoke` (TMDB behind the suite's HTTP boundary): movie, series, season, refusals, access rules, nothing stored. |

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

Gate 1: typecheck, lint, the plugin build, a smoke run and screenshots in Playwright Chromium on one environment.

**Gate 2 (2026-11-02), both lines.** `main-items` on Jellyfin 12.2 (bravo), `main-stubs` on Jellyfin 12.0 (delta), the live TMDB
through Jellyfin's own connection. Runner `scripts/jellyfinmod-e2e/tmdb-browse.mjs` with `JELLYFINMOD_TM2_ADD=1`: search and the four
browse pages at computer 1440, phone 390, TV 1920 and TV 1280 (arrows, Enter and Back), dark and light. 939 of 939 per line and browser,
in Playwright Chromium 153 and Google Chrome 156 (computer 130 dark and 108 light, phone 110 and 106, TV 1920 125 and 120, TV 1280
120 and 120). With a saved token, a separate computer dark pass: 109 of 109, more results load and nothing shown moves.
Plugin: PhaseZeroSmoke, PhaseOneSmoke (the new `Discover/Title` cases), PhaseTwo, PhaseThree, Q16 Trakt, Phase 9 and Phase 10 on the
Mac and PhaseSevenSettings in the Linux container pass on both lines.

**The Seasons arrows and the new order (2026-11-03, D252, D253), both lines.** `tm2.b4` alone, the browse pages and their rows (`JELLYFINMOD_TM2_ROWS=1`): computer 96 of 96 dark and light in Chromium and Chrome, TV 1920 dark 103 of 103 and phone dark 92 of 92 in Chromium; › reaches Season 38 of The Simpsons, no arrows where a row fits, none on the phone or the TV. With `tm2.s2`, the whole runner with the adds, in Chromium and Chrome: computer 147 dark and 125 light, phone dark 124, TV 1920 dark 139, TV 1280 dark 134. One failure in that set: on `main-stubs` in Chromium, computer dark, "the + on a card: Undo removes it again", 147 of 147 when re-run: the race `tm2.u1` fixes. With a saved token, computer dark 127 of 127 in both browsers, a second page following with nothing shown moving. Plugin suites as above pass on both lines. Skipped as untouched: light on the phone and the TV, because the order is logic and the arrows are absent there.

**Undo and the review fixes (2026-11-03, `tm2.u1`, `tm2.u2`, `tm2.r1`), computer dark, Chromium and real Chrome.** The race's cause: `PlaceholderItemListener` stamped a new stub about two seconds after Jellyfin first saw it, outside the library lock, which saved back an item Undo had just removed. It is not Jellyfin's metadata refresh, which the removal already waits for: Undo aimed 1750 to 2100 ms after Jellyfin's "Process new item" line brought 7 items back in 32 undos, a very slow refresh none in 16. `scripts/jellyfinmod-e2e/undo-race.mjs` with `JELLYFINMOD_UNDO_DELAYS` aims there and `JELLYFINMOD_UNDO_REAL=1` adds the real media checks.

On `main-stubs`: 114 of 114 in each browser, 38 aimed undos each, none brought a title back or left an item. The same aim saved items back 9 and 8 times in 38 undos before the stamp took the library lease (D257), so the lease is what stops it, and this path now deletes nothing. A real series, a real movie and an unmatched series whose folder is moved away, with the library root still there, and each item then saved with changed metadata, stay as library items with their entries, their files untouched, and return with the file; the same with the items shared by two overlapping libraries. Before `tm2.u2` the same check failed three times, deleting the unmatched series alone and Severance and the unmatched series when overlapping. The built state in the check has no Undo that the listener could race, so it proves only that no entry comes from nothing: the item waits for Jellyfin's next scan. On `main-items`: 43 of 43 in each browser, 19 undos each, without the real media checks, as nothing there deletes on absence.

The add, Undo, search and paging section with a saved token: 159 of 159 in each browser on both lines. Plugin suites PhaseOneSmoke, PhaseTwo and PhaseFive pass on both lines. Without `tm2.r1` a user who may read nothing walked 24 movie and 23 series pages and went on, and Back during an Add ended on the title's page; with it three answered pages per kind, each empty with another on offer, nothing shown, and no fourth, and the viewer stays where they went: the check holds the Add's answer until after the page's hide and before its deferred unmount, and without the fix it moves the viewer there. The grid refetches on a library change, the three pages again from the first. After three empty pages nothing offers to continue: the user accepted this with no More Results button (D257).

Not run: a physical TV or phone (browser emulation only); the browser as an ordinary user (the API's access rules are in
PhaseOneSmoke); a server with several libraries of one kind, where Add asks through the action sheet (the environments have one).
Gate 4's Codex review has not run.
