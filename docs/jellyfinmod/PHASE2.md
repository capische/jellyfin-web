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
