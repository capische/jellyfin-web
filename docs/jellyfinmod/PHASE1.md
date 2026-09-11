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

Default placement: use the current compatible library when adding from its search. In global
search, use the sole accessible compatible library. If there are several, require selection
before creating the entry and remember it for subsequent adds in that session. Do not guess a
library from array order. No quality-profile dialog is needed to resolve a destination library.

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
