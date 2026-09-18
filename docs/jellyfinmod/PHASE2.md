# Phase 2 — library reconciliation

Implementation plan, refined 2026-09-08. Implement after Phase 1 is running on the Pi. This is the
remaining reconciliation work after Phase 1's minimum owned-title lookup; it does not duplicate
that lookup or introduce acquisition, retention deletion, or STRM placeholders.

## Outcome

The catalog records existing movies and series and keeps their Jellyfin bindings accurate.
Adding a file outside JellyfinMod, replacing a file, or removing it must not create a duplicate
title or erase its catalog history. Existing native playback and per-user state remain intact.

## Entry gate

Phase 1 must first pass its create/search/detail/browse and permissions checks on the Pi, including
individual episodes. Reuse its database, library-scoped unique identity, DTOs and matching service.
Do not develop a second matcher inside a scheduled task. Record the installed version and back up
the plugin database before deploying a Phase 2 migration; test restoring that backup locally.

Planning can proceed now. Phase 2 deployment waits for Phase 1 acceptance, and a successful local
build alone does not satisfy that gate.

## Proposed implementation contracts

These are implementation defaults for review, not additional user-approved product decisions.

| Case | Planned behavior |
| --- | --- |
| Matching identity | `(mediaType, tmdbId, targetLibraryId)` for entries; provider episode ID inside the parent series for episodes. Never match titles by spelling. |
| Same-library copies | Retain a still-valid binding; if it disappears, choose a verified surviving native representation deterministically. Inspect native version grouping before deciding whether additional persistent binding records are necessary. |
| Copy in another library | Reconcile that library's own entry. It does not make this library's entry available or expose the other library to its users. |
| Conflicting provider IDs | Report the conflict and preserve existing catalog identity/history. Do not silently rewrite identity or merge two durable entries. Episode-number fallback must not override an explicit conflicting provider ID. |
| Native item without TMDB ID | Keep it working in native views and count it as unmatched. Revisit after native metadata is corrected; no speculative TMDB title search. |
| External removal | Set the confirmed file-less representation to `none` and append a distinct `media_missing` history event. Reserve `reclaimed` for deliberate retention. No new file-state enum is needed. |
| Storage/scan uncertainty | Preserve the last binding and availability; report reconciliation as incomplete. Do not emit a missing-media event from a timeout, failed enumeration or inaccessible storage. |
| First backfill | Create entries from existing native identity/metadata, preserving existing entries' settings. Proposed default for newly backfilled rows: monitoring off, since owning a title is not a request for future acquisition. Explicit user adds retain Phase 1 behavior. |
| Repeated observation | No history write when binding and availability have not changed. A newly backfilled row receives one `backfilled` event; genuine binding/availability transitions receive their own event. |

Series availability must be derived from playable children, not merely the existence of a series
folder. Episode rows keep stable local IDs and monitoring when metadata changes. A partial metadata
refresh must not remove episodes; unavailable TMDB must not prevent binding already-known native
identities. Catalog reconciliation never writes native watched, favorite or resume data.

**Proposed (review 2026-09-18, not user-approved):** the table rows above stay as written; these
additions refine them after [`REVIEW-2026-09-18.md`](REVIEW-2026-09-18.md). Absence is judged per
title, not per library: a failed, conflicted, or unmatched-but-previously-bound title excludes only
its own bindings from absence confirmation (plugin-reconciliation-data#2, high, verified). An
unmatched series that already has bindings keeps them and its state, with a diagnostic
(plugin-reconciliation-data#5, medium, single-source). Episode conflicts are isolated per episode,
and a native position is never identity when a TMDB episode ID exists
(plugin-reconciliation-data#6, medium, single-source). A native `IndexNumberEnd` range binds every
covered episode, and an unnumbered episode is a per-episode diagnostic rather than a series failure
(critic-gaps#2, medium, single-source). Overlapping libraries that share a path and library
re-homing after a re-create or rename get one defined rule (plugin-reconciliation-data#3, high,
verified), and admins get an explicit conflict-resolution path. See R6, R7 and R9 below.

## Execution and ownership

| Order | Work | Depends on | Main owner | Verification |
| --- | --- | --- | --- | --- |
| 1 | R1 deterministic reconciliation service and fixtures | Phase 1 identity/episode contracts | Plugin data/services | Repeat observations, conflicts, multiple copies and library isolation |
| 2 | R2 bounded backfill task with cancellation and progress | R1 | Plugin background task and existing admin settings page | Restart/cancel/rerun, concurrent add, exact outcome counts |
| 3 | R3 library-event integration and repair runs | R1, R2 | Plugin host integration | Added/replaced/moved media and missed events |
| 4 | R4 confirmed-absence handling | R3 and scan/storage evidence spike | Plugin reconciliation service | Surviving copy, offline storage, confirmed removal and reappearance |
| 5 | R5 refresh integration and live acceptance | R1–R4 | Web feature integration and deployment | Two users, all layouts, bookmarks, playback and persistence |

R1 fixtures can be developed while the native event/scan evidence spike is researched. Keep database
writes through the same reconciliation service, serialize overlapping work for a library, and use
database uniqueness/transactions to handle ordinary-user adds occurring at the same time. Do not
hold a write transaction while waiting for network metadata or scanning the whole library.

## Tasks

### R1 — reconcile one existing title

Reuse Phase 1's identity and library-access contract, including its episode records. Match by media type and provider identity,
bind native item IDs and library membership, and reflect actual playable availability. Preserve
entry IDs, original add dates, monitoring/retention settings and history. Do not write an `added`
event again simply because the title was discovered during a scan.

Multiple native copies/versions must follow the multi-library decision made in Phase 1. Do not
overwrite a valid binding with whichever native item was enumerated last. Items without a usable
provider ID remain visible natively and are reported as unmatched; do not guess by title/year.
Specify handling of conflicting provider IDs before implementing automatic resolution.

**Acceptance:** repeat reconciliation without duplicate entries, history events or changed user
preferences; cover two media types sharing a numeric TMDB ID, multiple copies and unmatched items.

### R2 — backfill the existing movie and series libraries

Add an admin-run background task that walks the existing library in bounded batches and uses R1.
Expose progress and a summary of matched, created, unmatched and failed items. Re-running after
interruption must be safe; one bad item must not silently skip the rest of the library. Prevent
overlapping full runs from racing each other. Coordinate with ordinary-user adds already supported
in Phase 1 rather than relying only on an in-memory duplicate check.

Use Jellyfin's existing task execution/cancellation surface where possible; put any additional
status summary in the existing plugin settings page. Report scanned items, created entries,
updated bindings, unchanged items, unmatched/conflicted items and failures separately. Restrict
detailed item diagnostics to admins. Process bounded batches, observe cancellation between items,
and resume safely by rerunning idempotent work; a persistent cursor is not required initially.
Fetch extra TMDB metadata only when needed, with bounded requests and retryable failures.

**Acceptance:** run over the live library, rerun and obtain no duplicate entries/events; verify a
cancelled or interrupted run can be completed; preserve access restrictions in all user-facing views.

### R3 — keep bindings current

Respond to relevant library changes and provide an admin reconciliation task to repair missed
events after downtime. Verify event/API signatures against the pinned server before implementation.
Handle added media, path moves, replacement files, item-ID changes and provider metadata corrections.
Use the same R1 reconciliation logic for both event processing and full runs.

Coalesce repeated notifications for the same library/item and keep slow work out of the host's
event callback. Re-read current native state when processing the work, so an old notification
does not overwrite a newer binding. Start with the scheduled repair run as the recovery mechanism
for an interrupted event queue; do not introduce a separate message broker.

**Acceptance:** a wanted title becomes playable after a native library scan; replacing or moving
its media preserves the entry ID and history; a missed event is repaired by the reconciliation task.

### R4 — preserve entries when media disappears

Confirm absence from a successfully scanned, available library before clearing a binding. A failed
scan or offline disk is not proof that the user removed a file. Check all known copies before
reporting the title unavailable. Keep the catalog row/history and record the observed loss of media.
Do not label external removal as `reclaimed`: that state represents deliberate retention work.

**Acceptance:** external removal leaves a discoverable file-less entry; another surviving copy
keeps the title playable; temporary storage unavailability neither erases history nor records a
false reclamation event. Define the missing-media representation before changing the state schema.

**Evidence spike required:** establish what the pinned server exposes for scan completion and
failure, and how to confirm the affected library paths are available. A removal notification alone
is insufficient. Only a complete successful observation of that library plus available storage
may establish absence. If these signals cannot be proved on the Pi, ship positive reconciliation
first and leave disappearance handling incomplete rather than clearing bindings speculatively.

### R5 — validate browse, detail and user state after reconciliation

Verify the existing Phase 1 surfaces refresh their bindings without duplicate cards or loss of
focus. Old entry bookmarks resolve after a new native binding is created. Read played, favorite
and resume state from the correct Jellyfin user; do not collapse it into global `watchedAt` or
reset native user data during backfill.

**Acceptance:** owned and wanted entries remain one result per title in global search, library
views respect their scope, playable actions target real native items, and user A's played state
does not become user B's. Cover desktop, mobile and TV keyboard navigation.

## Boundaries and decisions

- Phase 2 tracks availability; it does not download, delete files, or create placeholders.
- Automatic expiry remains Phase 3. The accepted watched-user setting is All users (default),
  Selected user, or Any user; see `PHASE3.md`. Phase 2 preserves per-user state for that policy.
- Resolve the proposed contracts above before their R1/R4 implementations, including the default
  monitoring value for newly backfilled entries. Do not solve conflicts with silent title matching.
- Individual episode records and monitoring settings are Phase 1 work, explicitly accepted by
  the user. Phase 2 backfills and maintains their native bindings alongside series bindings.
  Per-episode acquisition is later work. Preserve native season/episode navigation and never
  infer that a series-level binding means every episode is downloaded.

## Acceptance run on the Pi

1. Run the local reconciliation/migration fixtures, then deploy after the Phase 1 gate. Confirm
   plugin health and database persistence before starting the first admin backfill.
2. Backfill the live library and save outcome counts plus duration and peak memory. Run again:
   unchanged media must produce zero new entries and zero duplicate transition events.
3. Cancel and rerun a backfill. Add the same title through Phase 1 during reconciliation and prove
   one entry per library and coherent history, with no partially committed episode set.
4. Use isolated test media to exercise added files, replacement native IDs, multiple copies,
   metadata conflicts and mixed downloaded/missing/unaired episodes, including specials.
5. Verify confirmed removal and return separately from unavailable storage or failed scanning.
   Simulate failures in fixtures or an isolated test library; do not disconnect production media.
6. Compare admin and restricted-user views, entry bookmarks, native playback and user-specific
   watched/resume state. Check desktop, mobile and TV D-pad focus after updates.

Report unverified live scenarios explicitly. Phase 2 does not become complete merely because
backfill succeeds; absence detection and user-state/access acceptance are separate gates.

Phase 2 is complete when backfill is repeatable and subsequent library changes converge to the
correct catalog state without duplicates, lost history, broken playback or access leaks.

## R5 acceptance evidence — 2026-09-15

R5 was exercised against the isolated `jellyfinmod-test` container at
the isolated test instance (port 18096). The deployed web bundle was built from
`4c465f8f37` and the plugin was `8969eebc90`. Production Jellyfin was not changed.

- Moving the test movie out of its isolated library and running `RefreshLibrary` changed the same
  visible card from **On disk** to **Not downloaded** without reloading the page. Restoring the file
  and scanning changed it back to **On disk**. Both transitions retained focus on the title.
- Entry `efe27ec9dffe405d8c97a6c23e324cab` retained its identity and rebound to native item
  `ba9815a6b64dfb9820639f36f8271a1a`. Its `entryId` detail bookmark redirected to the new native
  details page, whose Play action targeted that native item.
- Global search returned one result for the owned test title after reconciliation and opened the
  native details page.
- A temporary non-admin user restricted to the test movie library saw its one permitted row and
  received 404 for the test TV library. Marking the movie played for that user changed its own
  combined browse DTO from false to true while `oleksii` remained false. The temporary user was
  deleted after the check.
- Responsive checks passed in the automatic desktop layout at 1280x720, mobile at 390x844, and TV
  at 1920x1080 and 1280x720. TV D-pad focus moved between navigation, toolbar and the combined
  catalog card. Poster and List views rendered the entry, and the List row opened native details.
- `tsc --noEmit`, targeted ESLint, `git diff --check`, and `npm run build:production` passed. The
  production build emitted only the existing Webpack asset-size warnings.

## Final native-host acceptance — 2026-09-15

The remaining Phase 2 contracts were exercised through Jellyfin's running native scan and task
pipeline on the isolated `jellyfinmod-test` container:

- Two physical copies with TMDB 550 produced one catalog entry with two bindings. Removing one
  copy kept the entry playable through the surviving copy and emitted no false missing-media event.
- A native scan overlapping the repair task converged to one restored binding. The completed repair
  scanned 161 observations: 160 unchanged, one unmatched, and zero created, updated, conflicted,
  failed, missing or incomplete.
- Cancellation after three committed observations left a valid partial run. The immediate rerun
  completed all 161 observations with 160 unchanged, one unmatched and no failures or duplicates.
- A temporary ordinary user added TMDB 552 while scan and reconciliation were active. Backfill won
  the insert race; the add returned that same entry, enabled monitoring and left coherent backfill
  and monitoring history.
- A native movie first scanned without a provider ID remained unmatched. After its native metadata
  was corrected to TMDB 553, the next scan produced exactly one bound entry without title matching.

The disposable media, catalog entries and temporary user were removed after the run. Final database
counts were 163 entries, 160 bindings and 22 episodes; TMDB 550 retained one binding to native item
`ba9815a6b64dfb9820639f36f8271a1a`. The server contained only the expected `nata`, `oleksii`,
`papa` and `vika` users. Together with the R5 browser run above, this satisfies the Phase 2
completion gate on the isolated test instance. Production Jellyfin was not changed.

**Correction (review 2026-09-18):** the recorded acceptance stands, but
[`REVIEW-2026-09-18.md`](REVIEW-2026-09-18.md) narrows what it proves. The run used a test library
with 22 episodes, so listener event-storm cost and library-lock hold during absence confirmation
were not observable (plugin-reconciliation-data#7, medium, verified; see R8). Absence confirmation
is all-or-nothing per library: one unverifiable absent binding, or one failed or conflicted title,
keeps it from completing until an admin intervenes, and the only recovery is a lossy entry removal
(plugin-reconciliation-data#2, high, verified; see R6). Re-creating a library under another name,
and probably renaming it, orphans its entries (plugin-reconciliation-data#3, high, verified; see
R7). The automated Phase 2 suites stub Jellyfin host services and authentication, so they are
supporting evidence only (tests-contract#2, medium, verified).

## Review remediation — 2026-09-18

Status: Phase 2 remains accepted on the isolated test instance (port 18096) as recorded above.
[`REVIEW-2026-09-18.md`](REVIEW-2026-09-18.md) found that absence confirmation, library identity,
episode matching and event cost break down on real-world library shapes the 22-episode acceptance
library did not contain. The tasks below are proposals, not user-approved work; none of the fixes
exist on this branch. Each needs real-host integration on the isolated test instance (port 18096)
through real HTTP, Jellyfin authentication and authorization, serialization, migrations and
SQLite, using disposable fixtures in the isolated writable library. Browser items use built-browser
E2E on the same instance: desktop, mobile, and TV layout (`localStorage.setItem('layout','tv')`)
at 1920×1080 and 1280×720, driven by arrow keys, Enter and Back, signed in as `oleksii` with an
empty password. Stubbed host services, builds, lint and type checks are supporting evidence only,
and hand-seeded database state does not count as acceptance for behaviour the product must produce.

**Proposed (review 2026-09-18, not user-approved):** complete R6 and R7 before Phase 4 A6 relies on
catalog availability, because a stale `onDisk` episode or an orphaned entry would be treated as
held media rather than wanted media.

### R6 — scope absence confirmation per title, skip unnumbered episodes and re-baseline volatile storage identity

**Priority** high · **Depends on** X1 · **Findings** plugin-reconciliation-data#2 (high, verified),
plugin-reconciliation-data#5 (medium, single-source), critic-gaps#2 (medium, single-source),
prior-M7 (medium, verified)

**Proposed (review 2026-09-18, not user-approved):** make incompleteness a per-title property.
A failed, conflicted, or unmatched-but-previously-bound title excludes only its own bindings and
episodes from absence decisions; the rest of the library is still confirmed. An unmatched series
that already has bindings keeps them and its state, with a diagnostic, instead of losing every
episode binding and writing false `media_missing` and `episode_media_missing` events. A native
episode without `ParentIndexNumber` or `IndexNumber` (date-named daily shows, unparsed files,
"Season Unknown") becomes a per-episode diagnostic instead of throwing for the whole series. An
absent binding with no recorded storage identity, or with a path outside the library's current
locations, is resolved by a direct existence check: readable parent directory and missing file
means absent. Storage identity uses device numbers that can change across a reboot or USB
re-enumeration, and no reconcile runs at startup today, so stale identity blocks absence and
retention until an admin runs the reconcile task by hand. Add a re-baseline: when mount point,
fstype and root still match and the library root enumerates, refresh `StorageIdentity` for all
bindings in that library, including absent ones, before absence confirmation or retention preview.
Show per-library incompleteness reasons in the Dashboard, not only a count. Commit scope:
`fix(catalog,p2.r6)`.

**Acceptance** — real scans on the isolated writable TV library:

1. Add an unnumbered episode file and a date-named episode to disposable series A. A records a
   per-episode diagnostic and its numbered episodes still bind.
2. Delete one episode of disposable series B by hand. The post-scan run writes
   `episode_media_missing` for it; the library is not marked incomplete.
3. Clear the TMDB id of a bound disposable series. It keeps its bindings and state, with a
   diagnostic and no missing events.
4. A binding with null storage identity, or a path outside current locations, is resolved by a
   direct existence check.
5. After a container restart, the storage-identity re-baseline runs when mount point, fstype and
   root match.

Per-library incompleteness reasons are visible in the Dashboard.

### R7 — re-home entries when a library is re-created or renamed, define overlapping libraries, and keep stale-bound entries manageable

**Priority** high · **Depends on** R6 · **Findings** plugin-reconciliation-data#3 (high, verified),
prior-M2 (medium, verified)

**Proposed (review 2026-09-18, not user-approved):** the host check comes first. On the isolated
test instance, record whether renaming a disposable library, or re-adding its path under a new
name, changes the `/Library/VirtualFolders` `ItemId`; the finding infers the change from the
path-derived collection-folder ID but did not observe it. Re-adding under the same name keeps the
same ID and is unaffected. Then, when a bound native item appears in a live library and the owning
entry's `TargetLibraryId` is no longer a live library, move the entry, its bindings and its
episodes to the new library under both library locks, merge with any existing entry there, and
write one `library_moved` history event. Today every title in the new library reports a conflict
on every run, and the old entries (including file-less wishlist entries, Keep and history) are
hidden from everyone because access requires a live library; even admin Remove returns 404. Admin
diagnostics list entries whose `TargetLibraryId` is not a live library. Access checks fall back
to the unbound rule when the only bound native item no longer exists (deleted in the Jellyfin UI,
moved to another library, or dropped by a monitor), so admins can open, Refresh and Remove the
entry. Define overlapping libraries that share a path with one documented rule. Commit scope:
`fix(catalog,p2.r7)`.

**Open question for the user (review 2026-09-18):** when two libraries share a path, should each
library get its own entry and binding for the same native item, or should one library own it with
the overlap documented? The current code lets the library whose name sorts first own the binding,
and the other library reports a permanent conflict.

**Acceptance** — first, on the isolated test instance, record whether renaming a disposable
library, or re-adding its path under a new name, changes the `/Library/VirtualFolders` `ItemId`.
Then:

- Re-adding the same disposable path under a new name re-homes its entries, with a
  `library_moved` history event and Keep/monitoring preserved. They appear in Browse, Search and
  Details as the admin and as the signed-in test user.
- Overlapping libraries follow the documented rule.
- An admin can open, Refresh and Remove an entry whose only bound native item was deleted in the
  Jellyfin UI (no 404).
- Admin diagnostics list entries whose `TargetLibraryId` is not a live library.

### R8 — coalesce series events and shorten library-lock hold during absence confirmation

**Priority** medium · **Depends on** R6 · **Findings** plugin-reconciliation-data#7 (medium,
verified)

**Proposed (review 2026-09-18, not user-approved):** an episode event is reconciled as a full
series observation, so a metadata refresh or season import costs O(episodes²) CPU and I/O on the
Pi; the mount table is also re-parsed for every episode path. Coalesce by title work key (library
plus series or movie) with a short debounce, drop `ItemUpdated` events whose native identity, path
and playability are unchanged, and read the mount table once per observation. The verifier
narrowed the impact: the per-library lock is FIFO and released between listener items, so an event
storm does not starve Add for minutes. The real Add failure comes from post-scan absence
confirmation, which walks the library twice under one lease; an Add to that library can exceed its
shared 60 s budget and is then mislabelled as a TMDB timeout. Keep the lease-held re-enumeration
invariant, but shorten the hold (for example by batching titles or re-checking only candidates
under the lock), and give Add its own lock-wait budget that returns a documented 409/503 "library
busy". Commit scope: `perf(catalog,p2.r8)`.

**Acceptance** — build a disposable series of 200 or more generated episodes in the isolated
writable library. Refresh its metadata. Listener work time, taken from the logs, is recorded
before and after and scales with changed titles, not episodes squared. While post-scan absence
confirmation walks the TV library, an Add to that library succeeds or returns a documented 409/503
"library busy". It never returns "TMDB metadata timed out". The mount table is read once per
observation.

### R9 — isolate episode conflicts, bind multi-episode files and add an admin conflict-resolution path

**Priority** medium · **Depends on** R6 · **Findings** plugin-reconciliation-data#6 (medium,
single-source), critic-gaps#2 (medium, single-source)

**Proposed (review 2026-09-18, not user-approved):** one episode whose TMDB ID or position
disagrees with its tracked row currently returns Conflict for the whole series, so no other
episode gets new bindings or availability; this is common with DVD or episode-group display order
on a partly downloaded series. Skip only the conflicting episode, reconcile the rest, and record a
per-episode diagnostic. Match episodes by TMDB ID and never treat position as identity when a TMDB
ID exists; use native display order for display and TMDB for identity, so reconciliation and admin
Refresh stop overwriting each other's season/episode numbers. Carry `IndexNumberEnd` so an
`S01E01-E02` file reports both episodes on disk instead of leaving E02 missing (and, in Phase 4,
grab-able). Add an admin-only conflict view with explicit actions — rebind to the new identity or
keep — each writing one history event. Retention of multi-episode files is blocked separately by
Phase 3 T16. Commit scope: `fix(catalog,p2.r9)`.

**Acceptance** — real scans on the isolated writable TV library:

- A disposable series whose one episode's TMDB id disagrees with its tracked position still binds
  its other episodes, with a per-episode diagnostic.
- An `S01E01-E02` file reports both episodes on disk; `IndexNumberEnd` is honoured.
- The admin-only conflict view (proposed) can rebind or keep, writing one history event, verified
  through real HTTP and the built Dashboard.

### R10 — phase 2 hygiene: database readiness, interrupted run rows, summary-write isolation and hidden legacy view refreshes

**Priority** low · **Depends on** none · **Findings** plugin-reconciliation-data#9 (low,
single-source), web-library-search-details#10 (low, verified)

**Proposed (review 2026-09-18, not user-approved):** gate the event listener, the backfill and
post-scan tasks on database readiness, as the controllers already are. At startup, after
migration, mark leftover `running` reconciliation runs `interrupted`. Move the per-item summary
checkpoint inside the per-item error handling so one busy-database failure does not fail the run.
When the post-scan task is skipped because a manual run holds the gate, queue its absence pass to
run afterwards. Keep only the last N run rows. In the web client, the legacy TV Shows and Movies
controllers refresh while hidden but still attached, running the full Browse, the global spinner,
`window.scrollTo(0, 0)` and autofocus against the visible page; pause them on `viewbeforehide`,
resume on `viewshow`, and drop stale responses. Commit scopes: `fix(catalog,p2.r10)` and
`fix(web,p2.r10)`.

**Acceptance** — on the isolated test instance:

- Stopping the container mid-backfill leaves the ReconciliationRun marked `interrupted`, not
  `running`, after restart.
- While Health reports not ready, the listener and tasks perform no writes, as shown in the logs.
- A skipped post-scan absence pass runs after the active run.
- Run rows are pruned to the configured N.
- In the built browser, the hidden TV Shows and Movies views issue no `/JellyfinMod/Browse` on a
  mark-played event while a details page is visible, and there is no spinner flash or scroll jump.
