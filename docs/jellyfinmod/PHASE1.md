# Phase 1 — implementation refinement

Current Phase 1 decisions and integration gates, refined on 2026-09-06. Read alongside
`PLAN.md`. This file supersedes older Phase 1 route, API-name and integration estimates in
`README.md` and `UX.md`; their visual specifications still apply except where clarified here.
Proposed mechanisms below are explicitly identified and must pass their gates before the
dependent implementation starts. Phase 0 is complete; `PLAN.md` records its local and live checks
and the known repository-metadata warning for manual installation.

## Accepted product scope

- Existing Movies, TV, Search, Home and Details routes. No separate catalog browser and no
  redirects. Wanted entries remain plugin-owned data, not fake server library items.
- One shared catalog. Users can read and add entries only in libraries they can access.
  Removal and settings changes are admin-only. Retention's watched-user policy is separate.
- **Include the redesigned top bar and Home hero in Phase 1**, explicitly accepted by the user.
  This is a narrow exception to the prohibition on restyling upstream. Retain navigation
  destinations, access to existing actions, and desktop/mobile/TV behavior. New styling belongs
  under `features/jellyfinmod`, with `jfmod-` classes; the exception is not permission to restyle
  cards, filters, or the rest of the application.
- Include the two Home row merges already specified in UX §7.3.
- **Include individual episode tracking in Phase 1**, explicitly accepted by the user. Wanted
  shows expose seasons and individual episodes, including availability and monitoring settings.
  Acquisition remains later work; a monitored flag does not start a download in this phase.
- No acquisition or automatic deletion in Phase 1. Search releases is an explicitly unavailable
  Phase 4 action with explanatory feedback, not a button that silently does nothing.

## 1. Authorization, placement and identity

Enforce library access in every plugin read and write, not just the web. Derive the requesting
user from authentication. Validate that a supplied target library exists, matches media type,
and is accessible. An entry lookup outside that scope returns 404 without revealing its title.
Discovery and its exclusion set obey the same visibility rules. Also account for the user's
content restrictions; library membership alone must not bypass parental restrictions.

**Proposed (review 2026-09-18, not user-approved):** two gaps in this contract are tracked by
P11 below. First, an owned title that is hidden from the requester by tags or ratings is still
offered by discovery, and Add answers it with an immediate, distinguishable 404 before any TMDB
call, which is an existence oracle (plugin-authz-entries#7, low, verified). Returning exactly the
same 404 as a metadata-restricted title, after the TMDB call, narrows it. Second, API-key requests
to the user-scoped endpoints (`/JellyfinMod/Entries`, `Browse`, `Discover`) fail with HTTP 400
and a logged `ArgumentException` instead of a defined 401/403 (plugin-authz-entries#6, low,
verified). See [`REVIEW-2026-09-18.md`](REVIEW-2026-09-18.md).

**Open question for the user (review 2026-09-18):** after the equal 404, a residual leak remains
because discovery offered the hidden title. Should it be documented as an accepted limitation?
Should user-scoped mod endpoints reject API keys with 401, or should admin automation get a
defined API-key contract?

Default placement: use the current compatible library when adding from its search. In global
search, use the sole accessible compatible library. If there are several, require selection
before creating the entry and remember it for subsequent adds in that session. Do not guess a
library from array order. No quality-profile dialog is needed to resolve a destination library.

**Correction (review 2026-09-18):** the "remember it for subsequent adds in that session" rule is
not implemented. The search session is keyed by the query text, so the library choice resets on
every query edit and the add buttons are disabled again (web-library-search-details#7, low,
single-source). W13 restores the rule.

Use `(mediaType, tmdbId)` as provider identity, never the numeric TMDB ID alone. An entry ID is
distinct from a Jellyfin item ID. Preserve existing native items that lack a provider identity.
Do not merge by title strings.

**Multi-library behavior accepted by the user, 2026-09-06:** the same title may belong to multiple
libraries, each with its own availability and access rules. Global search shows one result per
provider identity across the libraries accessible to the requester. Never move an existing entry
to another library as a side effect of adding it.

Implementation: make entries unique by `(mediaType, tmdbId, targetLibraryId)` and preserve their
per-library IDs, settings and history. Scope native matching on add to the chosen library. Global
search chooses a playable accessible representation when available and otherwise a stable
accessible entry, without exposing inaccessible copies. Discovery in a library excludes that
library's held identities; global discovery excludes identities held anywhere accessible. Migrate
the existing global unique index before accepting adds to multiple libraries.

**Legacy migration policy, 2026-09-08:** preserve records with no target library, but quarantine
them from normal reads and writes rather than guessing a destination. Log an actionable
administrator warning identifying the need for explicit placement recovery. No reassignment API
is included in Phase 1. These records and their history remain stored but unavailable through
the normal catalog until recovered; the verified Phase 0 deployment contained no catalog rows.
New creates require a validated target library and use its scoped unique index.

**Decided:** removal is admin-only, including Undo. Ordinary users get the add confirmation
without Undo; there is no separate cancellation endpoint that bypasses this policy. Rolling
back an optimistic card when creation fails is still required and does not delete a saved entry.

**Automatic expiry:** Phase 3's retention job reclaims eligible media automatically unless an
admin disables retention. No ordinary-user delete permission or per-expiry confirmation is
needed. Expiry removes media while preserving the entry/history; it does not delete the catalog
record. Disabling retention prevents automatic reclamation, including when a task is invoked
manually. The existing seed-goal, favorite, hardlink and watched-state safeguards still apply.
Phase 1 does not perform expiry, and this decision does not enable deletion in the deployed
Phase 0 scaffold. Resolve watched-user policy before Phase 3 ships.

## 2. One explicit API contract

Use `/JellyfinMod/Entries`, `Entry`, and the scaffold's file states:
`none`, `searching`, `grabbed`, `downloading`, `onDisk`, `reclaimed`.
Watched is user state, not another file state. Progress is 0–100. Timestamps are UTC ISO 8601;
nullable properties use JSON null. Use `entryId` in history DTOs on both sides. Define string
enum serialization explicitly instead of depending on the host's serializer defaults. New
plugin-owned DTOs explicitly use camelCase JSON properties; do not change Jellyfin's global
serializer or its PascalCase configuration contract. The deployed Phase 0 Health returns
`{Name, Version, Ok}`: map these to `{name, version, ok}` in the web client. Its current type
assertion does not perform that conversion. Test actual response JSON, not status codes alone.

Current request/response examples are recorded in [`API.md`](API.md). Validate them through the
live host before marking P5/P6 complete:

| Operation | Required contract |
| --- | --- |
| Create | media type, TMDB ID, target library; return canonical entry and whether created |
| List | file states, media type, query, target library, offset, limit, ordered sort fields and direction |
| Detail | entry plus history and the metadata required by the file-less detail renderer |
| Patch | explicit Phase 1 writable fields; reject unknown fields and unauthorized changes |
| Remove | admin-only, entry-only in Phase 1; reject file-deletion requests until implemented |
| Discover search | query, media type, scope, pagination and results excluding accessible held identities |

An add retry or concurrent double-click must yield one entry and one `added` history event.
Create and history insertion are transactional. Fetch required TMDB metadata before committing
the entry; a TMDB failure must not leave an empty row. Re-adding an existing entry must not reset
its state, monitoring settings, library placement or history.

Quality profiles do not exist yet. Do not show a working Change profile control or accept profile
IDs without a backing contract; add the real profile implementation in its acquisition phase.
Metadata fetching is shared by create and discovery, so implement that service before CRUD's
real-server create acceptance rather than making P5 depend implicitly on later P6 work.

**Gate:** round-trip the examples through the actual plugin serializer and TypeScript client.
Check authentication, access, duplicate creation, invalid types/IDs, cancellation and TMDB failure.

## 3. Resolve owned titles before discovery ships

Phase 1 must consult the existing accessible Jellyfin library by provider identity. P6 cannot
exclude only rows in an initially empty plugin database. On add, check for an accessible owned
match and return/bind it rather than making a second wanted card. Discovery subtracts both
accessible plugin entries and accessible native identities before returning suggestions.

This is the minimum reconciliation promoted into Phase 1. The later bulk backfill and event-driven
reconciliation can remain Phase 2, but correctness must not depend on them having run already.
Apply exclusion before calculating the returned page; define continuation when an entire TMDB
page is excluded. Do not report the unfiltered remote total as the exact leftover count.

## 4. Combined library queries — technical gate

The current `LibraryProvider` fetches one native page, and `ItemsView` chooses stock Cards or
Lists. Concatenating that page with a plugin page cannot produce correct combined pagination.

**Proposed implementation:** a plugin-owned browse endpoint that combines accessible native
movies/series and file-less entries, applies a common filter/sort contract, then paginates once.
Return native DTOs for native items plus plugin metadata; file-less entries remain a separate
discriminated representation. Never insert synthetic `BaseItem`s into the server database or
pass plugin IDs into stock library APIs. Keep CRUD list and unified browse semantics distinct.

For the first correctness spike, operate over complete candidate identities and required sort
metadata on the server, hydrating only the resulting page. Measure latency and memory on the Pi
before accepting this approach. Do not silently cap candidates or fetch the full library into
the browser. If this proves too expensive or cannot preserve native query semantics, revise the
mechanism before W2 rather than shipping approximate pages.

The contract must cover every current Movies/Series sort option in both directions, including
multi-field release-date sorts and Random. Give ties a stable identity ordering; Random needs
a seed retained across pages/refetches. Define missing-value behavior for native-only fields.
When there are no added entries or file filters, native sorting/filter behavior remains the
reference result, not an approximation based on a different string collation.

**Pinned 10.11.11 sort evidence, 2026-09-09:** Jellyfin's repository applies the fields in the
submitted order. An explicit `SortName` orders by the stored sort name and then display name in
the same direction. Its sort name is lowercased after the configured remove-word, remove-character
and replace-character rules; numeric chunks are padded, then diacritics are removed and remaining
non-ASCII text is transliterated. Use those server configuration values for plugin entries and
compare the resulting keys ordinally. `PremiereDate` falls back to the start of `ProductionYear`.
Parental rating maps to the inherited numeric rating, while played date/count and series played
date are user-specific. `SeriesDatePlayed` is the maximum `LastPlayedDate` among played items
whose `SeriesPresentationUniqueKey` matches the series, scoped to the current user; the series'
own user-data timestamp is not equivalent. SQLite nulls appear first ascending and last descending.

The current Movies options are `SortName`; `Random`; `CommunityRating,SortName`;
`CriticRating,SortName`; `DateCreated,SortName`; `DatePlayed,SortName`;
`OfficialRating,SortName`; `PlayCount,SortName`; `ProductionYear,PremiereDate,SortName`; and
`Runtime,SortName`. Series replaces critic/count/runtime with `DateLastContentAdded,SortName` and
`SeriesDatePlayed,SortName`. Source: Jellyfin 10.11.11
[`BaseItemRepository.ApplyOrder`](https://github.com/jellyfin/jellyfin/blob/v10.11.11/Jellyfin.Server.Implementations/Item/BaseItemRepository.cs#L1470-L1527),
[`OrderMapper`](https://github.com/jellyfin/jellyfin/blob/v10.11.11/Jellyfin.Server.Implementations/Item/OrderMapper.cs),
and the fork's `SortButton.tsx`.

Native `Random` uses SQLite `random()` and is unstable across page requests. The combined endpoint
must therefore use its retained deterministic seed whenever plugin results participate, because
otherwise exact pagination is impossible. When plugin participation and File filters are absent,
use the native query path unchanged. This is an explicit correctness difference for the combined
case, not a claim that Jellyfin's native random order is stable.

Filters: OR within the File group, AND between groups. Preserve the existing groups' own
semantics. Map On disk to `onDisk`, Not downloaded to `none`, Downloading to
`searching|grabbed|downloading`, and Reclaimed to `reclaimed`. No selected file states means all.
Define handling of genres, year, rating, played/favorite state, media features and missing values
before promising composition. A wanted item with no audio tracks cannot match an audio filter.
Read native user state for native items; never use global `watchedAt` as a per-user played flag.
For Phase 1, a file-less entry with no value for an active filter does not match that filter.
This includes Played, Unplayed and Favorite because file-less entries have no Jellyfin per-user
state; official rating, tags, studios, language, media-feature and series-status filters likewise
exclude entries until the corresponding deterministic metadata exists. Genre and year use the
entry's stored TMDB metadata, with OR semantics within each selected value list.

**Acceptance:** interleaved native/plugin fixtures across at least three pages; exact totals;
no omissions/duplicates with ties; each sort direction; file plus genre plus played filters;
restricted libraries; grid and list modes; alphabetical navigation; plugin removal fallback.
Play all and Shuffle operate on playable native items only, preserving their existing ordering.

**Correction (review 2026-09-18):** this gate is not covered as written. See
[`REVIEW-2026-09-18.md`](REVIEW-2026-09-18.md).

- The automated HTTP suite sends only `SortName` (both directions) and `Random`, never
  `alphabet`, and cannot exercise native filters or native-field sorts: its fixture ignores
  `InternalItemsQuery` (tests-contract#5, medium, single-source).
- The series Played/Unplayed filter reads the series row's own user data, whereas native 10.11.11
  counts a series as played from its episodes' play state (plugin-browse-discover#3, medium,
  single-source).
- The legacy/TV filter dialog sends string-encoded filters. Genre, year, rating and similar fields
  make Browse return 400, which silently falls back to native rows, and status and feature filters
  are dropped (web-library-search-details#1, high, verified).
- Natively, SD/HD/4K form one OR group; only 3D and features are ANDed. `API.md` calls them
  conjunctive (plugin-browse-discover#9, low, single-source).

P10 automates the parity gate and fixes the series filter, W8 fixes the legacy/TV request shape,
and `API.md` carries the filter correction.

## 5. File-less details — technical gate

The legacy detail controller loads `/Items/{id}` and issues further item-specific requests for
children, collections and similar titles. Substituting a plugin ID is not sufficient.

**Proposed implementation:** keep the Details route and existing page template, adding an
explicit `entryId` query parameter for plugin-owned entries. A feature-local adapter loads the
entry and its metadata; a small dispatch point in the controller chooses it. Native `id` links
retain the existing path. Bind a later native item without breaking a previously bookmarked
entry link. No global API monkey-patching and no fake successful native API responses.

Inventory the controller's downstream requests and action handlers before implementing the
adapter. Reuse display components for fields it can supply; run native requests only for a real
native ID. Native items keep all their working actions. File-less items expose only actions
supported by their capabilities, with no playable hover overlay or calls to Download/Media Info
using a plugin ID. Owned series keep their native season/episode navigation.

**Individual episode tracking accepted, 2026-09-06:** add persistent episode records under each
library-scoped series entry, TMDB season/episode metadata, and per-episode native bindings,
availability and monitoring. Episode records require stable local IDs and provider episode IDs
when available; season/episode numbers are display/order fields and must not be the sole identity
when metadata can be renumbered. Distinguish unaired episodes from aired episodes without media.
Include specials without conflating season zero with missing metadata.

Episode reads inherit the parent entry's access restrictions. Monitoring changes are admin-only,
as with other settings. Preserve existing native episode navigation and playback; file-less
episodes must not issue playback or native-item requests using plugin IDs. Per-user watched and
resume state for native episodes remains Jellyfin-owned. Refreshing TMDB metadata must preserve
local episode IDs, monitoring and history; missing results from a failed/partial refresh are not
deletions. Minimum episode matching belongs here; full ongoing episode reconciliation is Phase 2.

**Correction (review 2026-09-18):** on the phase3 and phase4 lines (plugin 81c1aae), Refresh
deletes local episodes that are missing from the TMDB snapshot. Since Phase 3, that delete
cascades to the episode's bindings, retention evaluations and retention operations, which violates
"missing results … are not deletions" (plugin-authz-entries#1, medium, verified). The strict
season `episode_count` check also rejects Add and Refresh of an airing series for TMDB's cache
window (prior-M4, medium, verified). The fix exists only on `jellyfinmod-phase1` (fba11e3). P7
carries it forward, and PHASE3 T10 adds foreign-key and lock hardening. See
[`REVIEW-2026-09-18.md`](REVIEW-2026-09-18.md).

**Gate:** prove one wanted movie and one wanted series render with artwork, metadata and history,
including the latter's individual episodes, with no native request carrying a plugin ID. Test
mixed downloaded/missing/unaired episodes, specials, metadata refresh, admin-only monitoring,
cross-library isolation, and persistence across restart. A series binding must never imply that
every episode is downloaded.

## 6. Upstream integration boundaries

Replace the unsupported twelve-line estimate with a reviewed list of integration points. Keep
feature logic in new files and existing stylesheets unchanged. Required candidate seams are:

- Library provider query selection, grid/list entry rendering, persisted File filters.
- Existing Search route composing the stock search hook and section renderers with merged
  Movies/Shows and the new TMDB section. Other section names and ordering stay intact.
- Existing Details controller's explicit entry dispatch, action and History mounts.
- Home row composition, new hero mount, and toolbar/navigation presentation hooks.

This is a proposal for narrowly scoped changes, not permission to rewrite shared components.
W1's card wrapper must prove overlay placement across shapes and footer modes; the stock
`CardBox` also has no overlay slot, so do not assume a sibling automatically sits on the cover.

**Correction (review 2026-09-18):** the implementation exceeds these seams.
`QueryClientEventHandler` is not a listed seam but now holds about 80 lines of mod logic:
query-key schema, plugin task keys, debounce state and three websocket subscriptions.
`homesections.js` inlines Latest and slot-selection logic and drops the upstream `loadNextUp`
call (web-home-rules-tv#10, low, single-source).

**Proposed (review 2026-09-18, not user-approved):** move that logic into a feature hook mounted
by one line, and keep the upstream section calls intact when the mod does not compose a section
(W10). See [`REVIEW-2026-09-18.md`](REVIEW-2026-09-18.md).

Search uses stable identity keys and rolls back optimistic additions on failure. Keep input
focus if the input was active; when an add is activated by D-pad, restore focus to a deliberate
neighbor or the moved card rather than unexpectedly opening the text keyboard. Reserve space
for asynchronous sections and test additions while focus is inside each zone.

Query keys include server and authenticated user identity, library and filters. Never retain a
previous user's results through `placeholderData`. Plugin failure restores native data and hides
plugin-only controls; stale plugin filters must not leave an empty native grid. Detail links to
plugin-only entries show an actionable unavailable message when the plugin is absent.

## 7. Home and chrome acceptance

Implement as a dedicated task after the browse/detail gates. The hero uses an accessible native
movie or series with usable artwork; render Play only when it resolves to playable media. If
there is no suitable item, omit the hero without an empty billboard. No autoplay background video.

Retain every navigation destination and account action. Verify solid/gradient toolbar states,
contrast, scrolling, focus visibility and Back behavior at desktop, mobile, and TV 1920×1080.
Check an older webOS engine before deployment; desktop TV layout alone is not device coverage.

For merged Continue Watching/Next Up, dedupe the same episode and prioritize its resume state.
Specify ordering and limits without discarding the user's existing section visibility choices.
Recently Added includes accessible wanted titles and uses the same browse identity rules.

**Correction (review 2026-09-18):** the accepted redesign decision stands; these are
implementation defects. See [`REVIEW-2026-09-18.md`](REVIEW-2026-09-18.md).

- The top-bar rules are scoped to `.skinHeader.jfmod-topbar`. The modern layout hides
  `.skinHeader` and puts `jfmod-topbar` on the MUI toolbar, so the rules never match there, and
  the recorded toolbar-state acceptance cannot have exercised them in modern desktop or mobile
  (web-home-rules-tv#4, medium, single-source). W12 addresses this.
- The older-webOS engine check was not performed. The legacy/TV grid relies on
  `display: contents` (Chromium 65+), and the mod styles rely on flex `gap` (Chromium 84+)
  (critic-gaps#3, high, verified; web-home-rules-tv#8, low, verified). W11 addresses this.
- The merged rows do not refresh after playback or import, because their native query keys are
  never invalidated (web-home-rules-tv#1, high, verified). Continue watching orders Next Up by
  episode add date and drops the user's Next Up settings (web-home-rules-tv#5, medium,
  single-source). Recently Added sorts grouped series by the series' own creation date
  (web-home-rules-tv#6, medium, verified). W10 addresses this.

## 8. Execution order and completion

1. Finish Phase 0 and verify it on the pinned server.
2. Implement the accepted identity/placement contract; define DTOs and permission tests.
3. Implement shared TMDB metadata, Entries CRUD and the minimum owned-identity lookup.
4. Prove unified browse and file-less detail adapters before broad UI integration.
5. Ship Movies/TV grid and list, filters, detail and two-zone search as one usable slice.
6. Implement and verify Home merges, hero and toolbar redesign.

Each UI task uses E2E tests against a running Jellyfin server in desktop, mobile and
keyboard-driven TV layouts. Plugin API acceptance runs through a real HTTP host, authentication,
authorization, serialization, migrations and SQLite; controlled external responses come from a
boundary-level HTTP server. Do not use unit tests or mocked client calls as acceptance. Lint and
TypeScript checks still run as supporting verification.
Assess each task's diff against its starting state, preserving other agents' and pre-existing
changes. No requirement that the entire shared checkout be clean.

Phase 1 is complete when an ordinary user can find and add an accessible title, browse and open
it after restart, and never see duplicates of accessible owned titles; forbidden operations
fail server-side; all native routes still work when the plugin or TMDB is unavailable; and the
accepted Home/chrome changes pass the three layout checks. Until the technical gates pass,
the phase is under refinement rather than a set of independently executable tasks.

## Acceptance evidence — 2026-09-18

The Phase 1 plugin and web bundle passed on the isolated Pi instance at
`<isolated-test-url>/web/`; production was not changed. Hosted plugin smoke tests passed
through real HTTP, authentication, authorization, serialization, migrations and SQLite. The
built browser flow passed native bound-series details, seasons, History and Search releases at
desktop 1440×900, mobile 390×844, TV 1920×1080 and TV 1280×720. It also passed failed-add focus
restoration, one-request duplicate activation, query-scope preservation, automatic excluded-page
continuation, explicit pagination, two-library Home deduplication and Latest exclusions, and
native detail/search usability while plugin transport was blocked.

Twenty Browse and Detail samples and ten live TMDB discovery samples were measured through the
authenticated built client. Browse was 29.6 ms p50 / 35.2 ms p95; Detail was 232.7 ms p50 /
241.4 ms p95; Discovery was 1063.5 ms p50 / 1768.2 ms p95. The isolated Jellyfin process reported
546224 kB RSS and 633936 kB high-water RSS after the run. TypeScript, scoped feature lint and the
production webpack build passed; webpack emitted its existing asset-size warnings.

Physical webOS acceptance remains a hardware check and is not represented by desktop TV
emulation. All automated fixtures and user configuration changes were reversed by the runner.

## Review remediation — 2026-09-18

A multi-agent review of plugin 81c1aae and web c45b7fc588 is recorded in
[`REVIEW-2026-09-18.md`](REVIEW-2026-09-18.md), which supersedes the single-pass
`REVIEW-2026-09-17.md`. Phase 1's accepted decisions and its recorded acceptance stand; nothing
below reopens them. The corrections above (§1, §4, §5, §6, §7) record where the implementation or
evidence differs from this file. Each finding is cited with its severity and whether adversarial
verifiers confirmed it (verified) or only one reviewer reported it (single-source).

**Correction (review 2026-09-18):** the Phase 1 HTTP suites (`PhaseOneSmoke`) run the plugin
against `DispatchProxy` stubs of Jellyfin host services and authenticate with custom `Smoke`
schemes driven by request headers. Their fixtures ignore `InternalItemsQuery`. They remain
supporting evidence only: they show real SQLite and serialization, not Jellyfin's native query,
authorization or user-data behaviour. Those were checked only in manual runs on the isolated test
instance (tests-contract#2, medium, verified). PLAN X5 proposes real-host coverage.

**Proposed (review 2026-09-18, not user-approved):** the tasks below are proposals from the
review. They use new IDs (P7–P11, W8–W15) and do not renumber P5–P6 or W1–W7. Commits use the
documented scope format, for example `fix(catalog,p1.p7)` or `fix(search,p1.w9)`. Real-host
integration runs on the isolated test instance (port 18096) with real HTTP, Jellyfin
authentication and authorization, serialization, migrations and SQLite, and uses disposable
fixtures in the isolated writable library. Built-browser E2E runs on the same instance in
desktop, mobile and TV layout (`localStorage.setItem('layout','tv')`) at 1920×1080 and 1280×720,
driven by arrow keys, Enter and Back, signed in as `oleksii` with an empty password. TMDB is
controlled through a real HTTP boundary server. Physical webOS evidence is reported separately
from emulation. Stubbed host services, builds, lint and type checks are supporting evidence only,
and hand-seeded database state does not prove behaviour the product is supposed to produce.

### P7 — carry forward the phase1 access-batching, search-folding and partial-metadata fix onto the phase4 line

**Priority** blocker · **Depends on** X1 · **Findings** prior-H5a (high, verified), prior-M4
(medium, verified), prior-M5 (medium, verified), plugin-authz-entries#1 (medium, verified)

**Proposed (review 2026-09-18, not user-approved):** commit fba11e3 exists only on
`jellyfinmod-phase1`; it is not on the phase3 or phase4 lines, which still have all four defects
at 81c1aae. It replaces per-entry library enumeration in `LibraryAccess.CanRead` and per-episode
series scans in `CanReadEpisode` with a per-request accessible-ID set. It folds diacritics and
matches original and sort titles in combined search. It relaxes the strict season
`episode_count` check and stops Refresh from deleting episodes missing from the snapshot. Port it
onto the phase4 integration line, adapting it to phase4's retention-aware `BuildDetail` and
`EntriesController` (the `BuildDetail` hunk conflicts). Also cover the remaining whole-library
`CanReadEpisode` call in `PatchEpisode`, and update the ApiSmoke regressions. This is proposed as
a Phase 4 entry gate (see [`PHASE4.md`](PHASE4.md)). PHASE3 T10 builds on it.

**Acceptance**

- In the plugin repo, `fba11e3` is named in a port commit on the phase4 line (a
  `(cherry picked from commit fba11e3)` or `Ported-from:` trailer), because the adapted port has a
  new patch-id that `git cherry jellyfinmod-phase4 jellyfinmod-phase1` still marks `+`. Every
  other `+` commit is either patch-identical on phase4 or named the same way, and the evidence
  records the mappings.
- On the isolated test instance, with a TMDB boundary server, an admin Refresh of a series whose
  TMDB snapshot omits a bound episode and a reclaimed episode keeps each episode's local ID and
  its `EpisodeBinding`, `RetentionEvaluation` and `RetentionOperation` rows. Verify the rows by
  query on a copy of the isolated database.
- Add and Refresh of an airing series whose season `episode_count` disagrees with the episode
  array both succeed without deleting episode rows.
- Browse `query` `amelie` and the built-browser Search both return `Amélie` and a native
  original-title match.
- Browse, Discover and series-detail p50/p95 latency on the Pi, with about 160 entries, is recorded
  before and after the port and shows no per-entry library enumeration.

### P8 — bound TMDB discovery cost and isolate per-candidate failures

**Priority** medium · **Depends on** P7 · **Findings** plugin-browse-discover#2 (medium,
verified), plugin-browse-discover#6 (low, verified)

**Proposed (review 2026-09-18, not user-approved):** Discover returns `nextPage` even when every
candidate was filtered out, and the web follows empty pages without a limit. A user with
`AllowedTags` can never read file-less metadata, so every page is empty and one search can walk up
to 500 TMDB pages per media type at 21 calls each. A very low parental-rating limit produces long,
but not unbounded, empty runs. Return `{items:[],nextPage:null}` before any TMDB call when the
user can never read file-less metadata, and enforce a documented per-request TMDB call budget.
Separately, one failed or timed-out detail call currently fails the whole page. Skip it, count it
in a `skipped` field, and still return `nextPage` when the search call itself succeeded. The web
side of the cap is W13.

**Acceptance**

Against the isolated test instance, with a TMDB boundary server that counts upstream calls:

- An `AllowedTags` user's search returns `{items:[],nextPage:null}` with zero TMDB calls.
- A user with a low parental-rating limit stays within the documented per-request call budget.
- When one detail call returns 500 or exceeds the 15 s timeout, the response still carries the
  other candidates, a `skipped` count and `nextPage`.
- In built-browser Search on desktop, mobile and TV, the surviving results remain usable.

### P9 — reduce per-request Browse cost for sorts, language filters, Home rows and entry-less libraries

**Priority** medium · **Depends on** P7 · **Findings** plugin-browse-discover#5 (medium,
single-source), plugin-browse-discover#7 (low, verified), prior-H5b (low, verified)

**Proposed (review 2026-09-18, not user-approved):** beyond the access fan-out fixed by P7,
Browse does work proportional to the whole library on every page request. `SeriesDatePlayed`
runs one query per series plus user-data lookups per played episode. Audio and subtitle language
filters run one episode query per series and a media-stream lookup per episode, twice when both
are active. All retention evaluations in scope are loaded, and entry metadata is deserialized
repeatedly. The Home Recently Added row hydrates native DTOs it discards, and Browse DTOs keep the
default unlimited image types. A library with no entries still waits for one unpaged native
enumeration. Compute these in one pass per request, add an entries-only mode for Home, set
`ImageTypeLimit = 1`, and return `hasCatalogEntries=false` early when a library has no entries
and no File filter is active.

**Acceptance**

Seed a realistically sized disposable TV fixture, for example 150 series of generated tiny files,
in the isolated writable library. On the Pi, record `POST /JellyfinMod/Browse` p50/p95 before and
after for:

- the `SeriesDatePlayed` sort;
- combined audio and subtitle language filters;
- a library with no entries.

Row IDs and totals are identical before and after. The Home entries-only request hydrates no
native DTOs; compare its response bytes with `/Items`. Browse `DtoOptions` use
`ImageTypeLimit=1`. A library with no entries returns `hasCatalogEntries=false` without native
hydration. The built-browser Movies and TV pages look unchanged on desktop, mobile and TV.

### P10 — match native series Played/Unplayed semantics and automate the §4 browse-parity gate

**Priority** medium · **Depends on** P7 · **Findings** plugin-browse-discover#3 (medium,
single-source), tests-contract#5 (medium, single-source), plugin-browse-discover#4 (low,
verified), plugin-browse-discover#9 (low, single-source)

**Proposed (review 2026-09-18, not user-approved):** apply series Played/Unplayed through the
native query so that Jellyfin's episode-based semantics apply, keeping Favorite and Resumable on
the row's user data. When several native copies share a TMDB ID, global Browse picks the lowest
GUID, which ignores the copy that carries the bound entry and its retention summary; prefer the
bound copy. Replace the manual §4 checks with a repeatable script, and document SD/HD/4K as one
OR group in `API.md`.

**Acceptance**

A repeatable script runs against the isolated test instance, signed in as the test user:

1. Use a scratch library with no entries as the native reference. For every Movies and Series
   sort option in both directions, and for combinations of genre, played and HD/SD/4K, the row
   IDs and totals of `POST /JellyfinMod/Browse` equal `GET /Items` with the same parameters. This
   includes series Played/Unplayed with partially and fully watched shows.
2. Add entries and verify interleaving across three or more pages with ties, alphabet `#`, and
   the legacy TV request shape.
3. A Browse call without `targetLibraryId`, over two native copies of one movie where one is
   bound, returns the bound copy with its retention summary.

### P11 — close Phase 1 contract hygiene: API-key requests, existence oracle, multi-binding `jellyfinItemId` lookup and dead DTO fields

**Priority** low · **Depends on** P7 · **Findings** plugin-authz-entries#6 (low, verified),
plugin-authz-entries#7 (low, verified), tests-contract#8 (low, verified)

**Proposed (review 2026-09-18, not user-approved):** API-key requests reach
`GetUserById(Guid.Empty)` on the Entries, Browse and Discover endpoints and return 400; the
Retention and Reconciliation endpoints do not resolve a user and behave normally. Return 401
from `GetUser` for API keys, or define an API-key contract (open question in §1). Make the
hidden-owned-title 404 identical to the metadata-restricted 404 and issue it after the TMDB call.
Resolve `jellyfinItemId` through `EntryBindings` on the server and in the web
`NativeEntryDetails` filter, so a non-primary native copy bound to an entry shows its History and
Keep. Mark `watchedAt` and `reclaimAt` deprecated; `progress` stays as a reserved
downloading-state field.

**Acceptance**

Real-host checks on the isolated test instance:

- An admin-created API key calling `GET /JellyfinMod/Entries`, Browse or Discover gets 401, or
  the documented contract, with no `ArgumentException` in the server log. Retention and
  Reconciliation endpoints behave as documented in `API.md`.
- A `BlockedTags` user adding a hidden owned title receives the same 404 body as for a
  metadata-restricted title, issued after the TMDB call.
- On the details page of a non-primary native copy bound to the same entry, the built browser
  shows History and Keep.
- `watchedAt` and `reclaimAt` are marked deprecated in the DTO documentation and `API.md`.

### W8 — normalize legacy/TV library filter queries for combined browse and expose File/Due filters on TV

**Priority** high · **Depends on** — · **Findings** web-library-search-details#1 (high, verified)

**Proposed (review 2026-09-18, not user-approved):** the TV layout runs the legacy
`movies.js`/`tvshows.js` controllers, whose filter dialog writes pipe- or comma-joined strings
and a `Filters` token list. `toRequest` passes the strings through, so any genre, year, rating,
video-type or series-status choice makes Browse return 400. The web then silently shows the native
grid, and every file-less and reclaimed card disappears. A reset persists empty strings, which
keeps the failure for that library on that device. Played, Unplayed, Resumable, Favorites and all
feature and resolution flags are dropped while the indicator reports an active filter. Normalize
the legacy query in `toRequest`, add File and Due within 7 days to the TV filter dialog, and log
non-404 failures instead of silently falling back.

**Acceptance**

Built browser in TV layout at 1920×1080 and 1280×720 against the isolated test instance, driven
by arrow keys, Enter and Back:

- In Movies and TV Shows, apply one genre, then Unplayed, then HD, then the dialog reset. Every
  `POST /JellyfinMod/Browse` returns 200 in the network log.
- File-less and reclaimed rows remain visible.
- Results match native `GET /Items` for the same filter, and the Favorites checkbox is honoured.
- Settings persisted before the fix (empty-string `Genres`/`Years`) no longer cause a 400.
- File and Due within 7 days are available in the TV layout. Non-404 failures are logged rather
  than silently falling back to native.

### W9 — make every 'Add from TMDB' result reachable with a scroller row

**Priority** high · **Depends on** — · **Findings** web-library-search-details#2 (high,
verified), web-home-rules-tv#8 (low, verified)

**Proposed (review 2026-09-18, not user-approved):** `.jfmod-discoveryCards` is a non-wrapping
`overflow: hidden` flex row. Mouse and touch users cannot reach cards past the first screen
width; with more than about 10 movie matches no series card is reachable. On TV, focus can land on
clipped cards on engines that support `preventScroll`. Render the row with the same
`emby-scroller`/`scrollSlider` markup as the entry sections (`data-horizontal`,
`data-centerfocus`), and give adjacent cards margins instead of flex `gap`. This follows the
Search layout in [`UX.md`](UX.md) §6 and the TV rules in §13.

**Acceptance**

Built browser on the isolated test instance, with a mixed query that has more than 10 movie
matches plus series:

- On a 375px mobile viewport by touch, on desktop by mouse, and on TV by D-pad at both
  resolutions, the last discovery card and at least one series card come fully into the viewport
  after scrolling or focus.
- Cards appended by 'More … results from TMDB' are reachable.
- Adjacent cards have visible spacing without flex `gap`.
- The browser runner asserts viewport visibility, not only the count of enabled buttons.

### W10 — refresh and order merged Home rows correctly; move mod websocket logic into a feature hook

**Priority** high · **Depends on** X1 · **Findings** web-home-rules-tv#1 (high, verified),
web-home-rules-tv#6 (medium, verified), web-home-rules-tv#5 (medium, single-source),
web-home-rules-tv#10 (low, single-source), web-home-rules-tv#9 (low, verified)

**Proposed (review 2026-09-18, not user-approved):** invalidate the native `ResumeItems` and
`NextUp` keys on playback stop and on played-state changes, and `LatestMedia` together with the
catalog Home rows on library changes, so both halves of Recently Added refresh together. Sort
grouped series by their last-media-added date. Order Next Up by comparable recency instead of
episode add date, and pass the user's Next Up settings (max days, rewatching, episode images) as
upstream does. Subscribe to `ScheduledTasksInfo` only where needed (for example admins or a
mounted catalog surface) instead of on every client. Move this logic out of
`QueryClientEventHandler` into a feature hook, and keep the upstream section calls in
`homesections.js` (see the §6 correction). It depends on X1 so that it lands on top of the
production master merge.

**Acceptance**

After the X1 merge of production b72ac53721, run the built browser on the isolated test instance
on desktop, mobile and TV:

- In TV layout, play an episode from Continue watching to completion and press Back. Row contents
  and order update, and the network log shows the Resume and NextUp refetch.
- A wanted title shown in Recently Added stays in the row after its file is imported and scanned.
- A disposable old series that gains two or more episodes appears in the first positions.
- Next Up honours Max days in Next Up, rewatching and the episode-image setting.
- Last night's episode sorts before older resumes.
- A non-admin TV websocket receives no per-second `ScheduledTasksInfo` stream during a library
  scan; count the frames.
- `QueryClientEventHandler` contains only a one-line mount of the feature hook.

### W11 — remove the `display: contents` and flex-gap dependencies from the legacy/TV grid and mod styles

**Priority** high · **Depends on** — · **Findings** critic-gaps#3 (high, verified),
web-home-rules-tv#8 (low, verified)

**Proposed (review 2026-09-18, not user-approved):** the legacy/TV Movies and Shows grids render
into a wrapper made transparent with `display: contents`, which engines older than Chromium 65
ignore. On such an engine the Poster, PosterCard, Thumb, ThumbCard and Banner views collapse into
one card per row; List view is largely unaffected. Mod styles also use flex `gap` (Chromium 84+),
most visibly on the discovery cards, and the hero focus ring uses `:focus-visible` only. Give the
wrapper the container's layout classes or mount into the container itself, replace `gap` with
em-sized margins, and add a `:focus` fallback. Severity stays high only if the household TV runs
webOS 3.x or 4.x.

**Open question for the user (review 2026-09-18):** the TV model and its webOS/Chromium version
are unknown, and they decide this task's severity. Should one physical webOS run be mandatory to
close any phase that touches TV UI?

**Acceptance**

- Record `navigator.userAgent` from the Jellyfin webOS app on the household TV and report it
  separately as physical evidence.
- Run the built bundle in TV layout on an old engine (Chromium 53 or 68 equivalent, or the webOS
  emulator) against the isolated test instance. The combined Movies and Shows grids render
  multi-column in Poster, PosterCard, Thumb, ThumbCard and Banner views.
- Spacing is present without flex `gap`.
- The hero focus ring is visible without `:focus-visible`.
- Current Chromium at 1920×1080 and 1280×720 is visually unchanged (screenshots).

### W12 — tie Home chrome to visibility, make the accepted top-bar redesign actually apply, and correct the hero

**Priority** medium · **Depends on** W10 · **Findings** web-home-rules-tv#2 (medium,
single-source), web-home-rules-tv#3 (medium, single-source), web-home-rules-tv#4 (medium,
single-source), web-home-rules-tv#7 (low, single-source)

**Proposed (review 2026-09-18, not user-approved):** this implements the accepted redesign; it
does not change it. The Home scroll listener survives pause, so the Home top-bar classes leak onto
Movies, details and other legacy/TV pages. In the modern layout, Home roots and listeners are
never destroyed, so every visit leaks them, and hidden Home queries keep refetching during
playback. The top-bar selectors never match in the modern layout (see the §7 correction). The hero
ignores the user's Latest exclusions, shows Play without a playability check, and uses hard-coded
English labels and dark colours. Tie mount, pause and unmount to visibility, target the elements
that exist in each layout, and fix the hero.

**Acceptance**

Built browser on the isolated test instance:

- In TV layout, go Home → Movies and scroll by D-pad. `.skinHeader` never carries `jfmod-topbar`.
- Five modern-desktop visits to `/home` leave one hero root and one scroll listener.
- 60 s of playback started from Home issues no `/JellyfinMod/Browse` or `/Items` requests.
- Computed toolbar backgrounds at `scrollY` 0 and above 40 show the gradient and solid states in
  modern desktop, modern mobile and TV (screenshots).
- The hero excludes a library listed in `LatestItemsExcludes`, hides Play when `canPlay` is false,
  and uses translated labels and theme colours; check it in a light theme.

### W13 — make search additions operable on TV and mobile and cap discovery auto-follow

**Priority** medium · **Depends on** P8 · **Findings** prior-L1 (low, verified),
web-library-search-details#7 (low, single-source), web-library-search-details#8 (low,
single-source), plugin-browse-discover#2 (medium, verified), plugin-browse-discover#6 (low,
verified)

**Proposed (review 2026-09-18, not user-approved):** after an add, the Undo toast is appended to
the document body, never receives focus and disappears after 4 seconds, so D-pad Undo is
effectively unusable; a failed Undo is silent. The library choice resets on each query edit
(§1 correction). The optimistic pending card links to an invalid `entryId=pending:…` route, so an
OK press during a slow add opens an error page. Discovery auto-follows empty pages with no cap,
and one failed media type hides the other type's cards. Keep Undo in the page and focus it on TV,
persist the library choice for the session, make pending cards non-navigable, stop auto-follow
after at most three consecutive empty pages with a 'Search more' control, and isolate discovery
errors per media type.

**Acceptance**

Built browser in TV layout on the isolated test instance:

- An admin add moves focus to an in-page Undo, and focus survives the toast timeout.
- A failed Undo shows an error.
- The chosen library persists across query edits in the session (§1 placement rule).
- An OK press on a pending card during an in-flight add does not navigate.
- As an `AllowedTags` user against the TMDB boundary server, auto-follow stops after at most three
  consecutive empty pages and offers a 'Search more' control; the upstream call count is asserted.
- One failed media-type discovery does not hide the other type's cards.

### W14 — gate newer plugin features on Health capabilities and keep data after a failed refetch

**Priority** medium · **Depends on** X4 · **Findings** web-library-search-details#6 (medium,
single-source)

**Proposed (review 2026-09-18, not user-approved):** the web gates mod features on `health.ok`
alone. A newer web bundle on an older plugin offers Due within 7 days; the older plugin rejects
the unknown field with 400, and the grid silently becomes native while the filter stays set but
disappears from the menu. Any failed background refetch also discards good cached catalog data.
Expose capabilities (or an API version) in `/JellyfinMod/Health` and gate newer request fields on
them, keep previous data after a refetch error, and fall back to native only on 404, a missing
plugin or an initial failure.

**Acceptance**

Built browser against the isolated test instance:

- With an older (Phase 2) plugin build deployed, and later restored, through the X3/X4 tooling,
  the Due within 7 days option is hidden and no 400 occurs.
- With the current plugin, when one Browse refetch is blocked at the transport, the grid keeps its
  previous catalog rows and the File accordion stays visible while its filters are set.
- Native fallback happens only on 404, a missing plugin or an initial failure.

### W15 — pass the repository stylelint gate for mod SCSS

**Priority** low · **Depends on** — · **Findings** static-checks#1 (low, single-source)

**Proposed (review 2026-09-18, not user-approved):** stylelint reports 12 errors in
`catalogSearch.scss` and `homeChrome.scss`: single-line multi-declaration blocks and one selector
list on one line. Split them without changing the rendered result, and add stylelint to the phase
validation checklist.

**Acceptance**

- `npm run stylelint`, or `npx stylelint` over
  `src/apps/modern/features/jellyfinmod/**/*.scss`, reports zero errors.
- Built-browser screenshots on desktop, mobile and TV on the isolated test instance are visually
  unchanged.
