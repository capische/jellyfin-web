# Release picker: the searching state (design, 2026-10-10)

Design only, nothing implemented. Session "Row Icon State Designs". Mockup: https://claude.ai/artifact/VzhFUf56JQp6dKj36u13uf
(animated); `release-picker-searching.html` / `.png` in this folder; generator
`/private/tmp/claude-501/-Users-kxalex-Projects-jellyfin-mod/0162f905-eb32-4c41-93bb-1753a3265e4c/scratchpad/search/gen.py`.

Code it maps onto: web `ReleasePickerDialog.tsx` (`statusText`, `unavailableText`, `failed`, the `jfmod-releaseStatus`
line with `CircularProgress`, the `jfmod-releaseList` block, `placeholderData: previous => previous`), `releasePicker.scss`;
plugin `ReleasesController.Search` (`GET /JellyfinMod/Releases`), `ReleaseSearchService.SearchAsync`,
`AcquisitionSettingsController.Indexers` (`GET /JellyfinMod/Indexers`), `ReleaseContracts.IndexerOutcomeDto`.

## What the plugin can report today (read from the code)

- `GET /JellyfinMod/Releases` is **one blocking request**. `SearchAsync` verifies capabilities, then fans out with
  `Task.WhenAll` under a `SemaphoreSlim(MaxParallel)` gate and a per-indexer `TorznabOptions.Timeout`; nothing is written
  anywhere the page could read until every indexer is done. The answer carries `indexers[]` =
  `{indexerId, name, status, message, resultCount, truncated, retryAfterSeconds}` with status in
  `ok | no_results | timeout | rate_limited | budget_exhausted | breaker_open | secret_unavailable | unsupported_search`
  plus Torznab error codes, and `partial`, `truncated`.
- `GET /JellyfinMod/Indexers` lists every indexer with `enabled`, `priority`, `name` and `breakerOpenUntil` (UTC, only when
  the breaker is open). So the page can know **up front** which indexers will be asked and which are paused.
- So: **live per-indexer progress is not possible without a plugin change.** What is possible now: list the enabled
  indexers from `/Indexers` when the picker opens, show them all as "asking…", count the elapsed seconds, and settle every
  line at once from `indexers[]` when the result lands.

## v1 (no plugin change)

1. On open, `useQuery(['JellyfinMod', basePath, 'Indexers'])` (one fetch, reused for every search in this dialog).
   Enabled indexers ordered by priority, name; a `breakerOpenUntil` in the future → line "paused until HH:MM" (viewer's
   locale, 24 h as `unavailableText` does) from the start.
2. While `search.isFetching`: the list area shows the **centred block**: glyph (4em, primary colour, animated), caption
   "Searching N indexers · S s" (S from a 1 s interval, same pattern as `useGrab`'s `now`), then one line per indexer:
   `● name  asking…` (paused ones as above).
3. On data: the block fades out (opacity 0.2 s), rows render as today; the status line becomes
   "N releases · A of B indexers answered" (A = status ok or no_results); the failed ones keep today's partial notice.
4. No results: the block stays, still, dimmed to the secondary colour, caption "No releases found", every line settled
   from `indexers[]` ("nothing" for `no_results`, the reason for a failure, "paused until" for `breaker_open`).
5. Every indexer failed or paused (`unavailableText` not null): the block stays, glyph and caption in the error colour,
   caption "No indexer answered · try again at HH:MM" (the latest `retryAfterSeconds`; "try again later" when none),
   each line with its reason: `timeout` → "timed out", `rate_limited` → "rate limited · retry HH:MM", `breaker_open` →
   "paused until HH:MM", `budget_exhausted` → "daily budget used up", `secret_unavailable` → "no API key",
   `unsupported_search` → "cannot search this", other → the `message`. Never "No releases found." here.
6. New search over old rows (scope or profile changed; `placeholderData` keeps the old rows): the old rows dim to 0.3 and
   stay in place (no layout jump, nothing can grab them: `grabDisabled` is already true while fetching); the centred block
   sits over them on a paper-coloured panel (`background: #202020` at opacity 0.94 in dark, `#fff` in light; plain colour,
   no blur). Rows are never unmounted under a focused element (UX §13.1): focus is on a select or Close at that moment.

Timings: block appears at once (no 300 ms delay: the user asked for a visible search), minimum display 400 ms so a
cached answer does not flash it.

## v2 (plugin change: progress while the search runs)

Smallest change: a **progress side channel**, no new operation model.
- Web sends `GET /JellyfinMod/Releases?…&progressKey=<client id>` (a fresh key per search, like `idempotencyKey`).
- `ReleaseSearchService.SearchAsync` takes an optional `IProgress<IndexerProgress>` / key; it writes each indexer's state
  into an in-memory `ConcurrentDictionary<string, IndexerProgressSnapshot>` (keyed by progressKey, entries expire 60 s
  after the search ends): `queued` (seeded for every enabled indexer at the start, so the count is known at once),
  `verifying` (capability check), `asking` (set just before the Torznab request goes out, with `startedAt`), then the
  final `IndexerOutcome` (`ok`/`no_results`/failure code, `resultCount`, `retryAfterSeconds`). Blocked ones
  (`breaker_open`, `budget_exhausted`) are final at the start.
- `GET /JellyfinMod/Releases/Progress/{progressKey}` returns `{ indexers: [...], finished: bool }`; 404 for an unknown key
  (the page treats 404 as "not started yet, keep the v1 look"). Same authorization as `/Releases`.
- Web polls it every 1 s while `isFetching` (one read in flight at a time, as `useGrab` does) and renders each line from
  it: `queued` → "waiting", `verifying`/`asking` → "asking… S s" (S from `startedAt`), `ok` → "N releases",
  `no_results` → "nothing", failures as in v1. The glyph's parts take their indexer's colour (below). When the main
  request returns, the poll stops and the final `indexers[]` wins.
- Alternative with more change: make the search an operation (`POST /Releases/Search` → id, `GET /Releases/Search/{id}`
  polled until `finished`, also returning the snapshot). Cleaner, but it changes every caller of `/Releases` (runners,
  automation) and the cache keyed by searchId; the side channel changes nothing for them.

## The glyph (three options, pick one)

All: inline SVG, 48×48 viewBox, drawn at `4em` (64 px desktop, 80 px TV, 58 px phone), `color: #00a4dc` (primary),
centred, `aria-hidden`; nothing inside is focusable. Animation is `transform: rotate` on one group and `opacity` on the
parts, nothing else. Under `prefers-reduced-motion: reduce` every animation is off and the caption carries the progress
("Searching 4 indexers · 6 s · 1 of 4 answered").

- **G1 Swarm**: a seed (filled circle r 5) with N peers (r 3) on a ring of radius 16, spokes at 0.35 opacity. Searching:
  the peer group turns once per 14 s, peers breathe (opacity 0.35→1) staggered 0.18 s. Progress (v2): peer i = indexer i
  (by priority): green `#81c784` answered, red `#ff7b72` failed/paused, 0.3 opacity nothing/waiting.
- **G2 Torrent ring** (my recommendation): a down arrow (stroke 3.2) inside a ring of N segments (radius 19, 14° gaps).
  Searching: the segment group turns once per 2.4 s, segments breathe staggered 0.2 s. Progress: segment i = indexer i,
  same colours. Reads as "torrent" at a glance, and N segments = N indexers is the most legible progress of the three.
- **G3 Sonar**: three rings at 0.35 opacity, a 40° sweep wedge (fill, 0.5 opacity) turning once per 2 s, N blips that
  appear as indexers answer (green) or fail (red).

Why G2: the arrow is the torrent mark everyone knows, the ring's segments are a natural per-indexer progress without
any legend, and it stays readable at 58 px on a phone where G1's six dots and G3's blips get small.

## Per-indexer lines

`<ul class="jfmod-searchIndexers">` under the caption, centred, `font-size: 86%`, secondary text colour; one `<li>` per
indexer: a 0.55em dot, the name (600 weight), the state. Dot colours: asking = primary, blinking (opacity 1↔0.25, 1 s;
still under reduced motion); waiting = 0.3; answered = `#81c784` (light scheme `#2e7d32`) and the count in the same
green; nothing = 0.35; failed/paused = `#ff7b72` (light `#c62828`) and the reason in the same red. Up to ~8 lines fit
under the glyph on a phone; with more indexers the list scrolls inside the list area (it already scrolls).

## Screen readers and TV

- The caption is the one live region (`role=status aria-live=polite`, today's `jfmod-releaseStatus`): it says
  "Searching 4 indexers" once when the search starts and the summary once when it ends ("3 releases, 3 of 4 indexers
  answered" / "No releases found" / "No indexer answered, try again at 16:05"). The elapsed seconds and the per-indexer
  lines are **not** live (`aria-live="off"` on the list), so nothing is announced every tick; in v2 the lines change
  silently and the end summary covers them.
- The glyph is `aria-hidden`; the old `CircularProgress aria-label="Searching indexers"` goes.
- TV: nothing in the block is focusable; focus stays on the scope/profile selects and Close, as now. The block is in
  the list area, so it never appears above the focus ring (UX §13.2). D-pad down from the selects goes to Close while no
  rows exist.
- Words: Sentence case for the caption and lines (status text); Title Case only if a "Try Again" button is added later
  (not in this design: the selects re-run the search, and `unavailableText` already names the retry time).

## Styles (sketch, em units, jfmod- classes only)

```scss
.jfmod-searchBlock { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 13em; text-align: center; }
.jfmod-searchBlock--over { position: absolute; left: 0; right: 0; top: 0; bottom: 0; min-height: 0; }           // new search over old rows
.jfmod-searchBlock--over::before { content: ""; position: absolute; left: 2em; right: 2em; top: 0.4em; bottom: 0.4em; border-radius: 0.2em; background: #202020; opacity: 0.94; }
.jfmod-releaseList--stale > .jfmod-releaseItem { opacity: 0.3; }
.jfmod-searchGlyph { width: 4em; height: 4em; color: #00a4dc; }
.jfmod-searchGlyph-segs { animation: jfmod-searchTurn 2.4s linear infinite; transform-origin: 24px 24px; }
.jfmod-searchGlyph-seg { animation: jfmod-searchBreathe 1.6s ease-in-out infinite; }      // nth-child delays 0, .2s, .4s …
@keyframes jfmod-searchTurn { to { transform: rotate(360deg); } }
@keyframes jfmod-searchBreathe { 0%, 100% { opacity: 0.35; } 30% { opacity: 1; } }
// FINAL (user, 2026-10-10): fixed segment colours, identical on dark and light, no opacity tricks (opacity on the
// dark paper turned the blues to dark teal; the user's pick was the light-scheme look of the ring)
.jfmod-searchGlyph-seg--ok      { stroke: #43a047; opacity: 1; animation: none; }   // answered
.jfmod-searchGlyph-seg--failed  { stroke: #e53935; opacity: 1; animation: none; }   // failed, paused
.jfmod-searchGlyph-seg--asking  { stroke: #74c9ec; animation: jfmod-searchAsk 1.2s ease-in-out infinite; }   // light blue, pulsing
.jfmod-searchGlyph-seg--waiting { stroke: #a9ddf3; opacity: 1; animation: none; }   // paler light blue, steady
// (user, 2026-10-10: both unanswered segments are light blues, not the primary; the arrow alone is primary #00a4dc)
// The segments and the arrow are STROKES ONLY: `fill: none` on every path. A fill on an arc paints the area between the
// arc and its chord and deforms the ring into four "D" shapes (the mockup's first page had this bug on 2026-10-10).
// Arrow geometry, centred on the ring: <path d="M24 15.5V32"/><path d="M18.3 26.3L24 32L29.7 26.3"/> (stroke 3.2, round caps).
.jfmod-searchGlyph-seg--none    { opacity: 0.3; animation: none; }                  // "nothing" after a finished search
@keyframes jfmod-searchAsk { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }
// before any indexer has answered (0 s) every segment is "asking": the whole ring is primary blue and pulsing.
// The arrow stays in the primary colour. The per-indexer line dots use the same four colours.
.jfmod-searchBlock--quiet .jfmod-searchGlyph { color: var(--jf-palette-text-secondary); opacity: 0.6; }   // no results
.jfmod-searchBlock--error .jfmod-searchGlyph, .jfmod-searchBlock--error .jfmod-searchCaption { color: #ff7b72; }
@media (prefers-reduced-motion: reduce) { .jfmod-searchGlyph * , .jfmod-searchIndexer-dot { animation: none !important; } }
```
(The `!important` is only inside the reduced-motion override; CLAUDE.md forbids it for cascade fights, not for this. If
preferred, raise specificity instead.)
