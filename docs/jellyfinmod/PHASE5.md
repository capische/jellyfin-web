# Phase 5 — import pipeline

Planning draft, 2026-09-19; see *Implementation status* for what is built. Read [PLAN.md](PLAN.md), [README.md](README.md) §6–§7,
[UX.md](UX.md) §8, §10, §13 and §14, [PHASE2.md](PHASE2.md), [PHASE3.md](PHASE3.md),
[PHASE4.md](PHASE4.md) and [API.md](API.md) alongside this refinement. This document plans
work; it does not establish that Phase 4 has passed acceptance, and it does not authorize a
production deployment. Every default below that is not quoted from an earlier accepted decision
is **Proposed, not user-approved**.

The newest Phase 4 contract lives on the `jellyfinmod-phase4` branches (A1 decisions and protocol
evidence, 2026-09-18), amended by the user decisions of 2026-09-19 recorded in PHASE4. Those
decisions settle the download client, the grab hold, credential storage and the shared mount; the
section below restates what they mean for this phase.

## Accepted user decisions — 2026-09-19

These decisions were made by the user on 2026-09-19 (PHASE4, *Accepted user decisions*). They
override any proposal in this document that disagrees.

1. **Transmission is the download client.** There is no qBittorrent driver. Phase 5 extends the
   Phase 4 Transmission driver and reads completion, files, ratio and seeding time from
   Transmission RPC `torrent-get`; the seeding-copy release uses `torrent-remove` with
   `delete-local-data`. The Phase 3 `TransmissionSeedClient` stays the retention read adapter.
2. **Grabs keep the short server-side cancellable hold** from Phase 4; Phase 5 starts at an
   `accepted` grab and never changes the hold.
3. **Secrets.** Test secrets live only in the ignored plugin `.env`; live secrets are references
   into the plugin secret store and never appear in DTOs, logs, history or XML. Queue rows and
   import operations carry no credential and no credential-bearing URL.
4. **One shared mount, hardlink-only import.** Downloads and the library share one filesystem
   reachable through one mount inside the Jellyfin container. Import creates hardlinks only: no
   copy fallback, and a cross-device source is refused as `blocked/cross_filesystem`. This
   answers open question 1 and gate 3.
5. **Entry gates** include Phase 3 T7–T10 and T18, P7, X1 and X3 (PHASE4 gates 6–8).

## Outcome and boundaries

A grab that Phase 4 handed to the download client finishes downloading. The plugin notices, finds
the file that belongs to that grab, hardlinks it into the target library under Jellyfin's
multi-version naming convention, asks Jellyfin to scan only that folder, and lets the Phase 2
reconciliation service bind the resulting native item. The entry becomes `onDisk` with a fresh
retention baseline, one `imported` history event, and a queue row that shows what happened. When
the effective seed goals are met, the plugin — and nothing else — removes the torrent and its
seeding copy, so that a later Phase 3 reclaim, or an earlier one, actually frees disk. The
`/catalog/queue` route shows downloads, imports and seeding copies in every layout.

- Phase 5 owns: download completion detection, release/file identification, hardlink import,
  the targeted scan request, attribution of the resulting binding, the retention baseline for the
  imported representation, removal of the seeding copy after seed goals, container path mapping,
  the Queue API and `/catalog/queue`.
- Phase 5 does not own: searching or grabbing (Phase 4), scheduled searches, upgrades or a second
  quality for a title that already has one (Phase 6), matching native items to entries (Phase 2,
  reused), and deciding when watched media expires (Phase 3, reused).
- Import never copies and never moves. A hardlink that cannot be created is a blocked import with
  a stable reason, not a copy. This is the accepted rule from `plugin/CLAUDE.md` ("Import with
  hardlinks; require download and library paths on the same filesystem").
- Import never deletes a library file, never renames an existing native folder and never touches
  a torrent the plugin did not add. The seeding-copy release in I6 is the only deletion in this
  phase; it removes the torrent and the files inside the client's download directory that belong
  to that torrent, and it verifies that the library hardlink survives.
- One accepted grab produces at most one import for one movie or one episode. Season packs,
  multi-episode releases and archives were rejected in Phase 4 A1/A4 and are not imported here.
- The queue is a monitor, not a torrent client (UX §10): Remove and Open in client are the only
  actions. No pause, resume, priority or per-file selection.
- All development, deployment and E2E use `jellyfinmod-test` (port 18096) with state under the
  isolated state directory, the disposable client from Phase 4 A1/A9 and the isolated writable
  library. Production `jellyfin` (port 8096), its media mounts and its Transmission are never
  contacted or changed.

## Accepted decisions carried into this phase

These are quoted or restated from accepted decisions; Phase 5 does not reopen them.

- Hardlink import with a same-filesystem precondition and no copy fallback (`plugin/CLAUDE.md`).
- Preserve seed ratio/time goals; check hardlink counts before claiming reclaimed disk space
  (`plugin/CLAUDE.md`, README §6 Phase 3, PHASE3 T3).
- Automatic expiry is accepted; retention reclaims eligible media automatically unless an admin
  disables it (PLAN, decided 2026-09-06). Settings and destructive actions are admin-only.
- Watched-user modes All users / Selected user / Any user (accepted 2026-09-11).
- `/catalog/queue` is the only new route in the design; nothing else in navigation changes
  (UX §2.1, §2.2). Progress polls `GET /JellyfinMod/Queue` every 3 s while the queue is mounted
  or a `downloading` card is on screen; no websocket (UX §10).
- Phase 4 A1 decisions on the `jellyfinmod-phase4` line: search and grab are admin-only; a grab
  targets one library-scoped movie entry or one durable episode ID; only a 40-character lower-case
  BitTorrent v1 infohash is accepted; acceptance is verified from the client's torrent list, not
  from an HTTP 200; the legal fixture is a self-created payload and v1 `.torrent` served by the
  Torznab boundary server and seeded by a disposable local peer.
- Phase 2 reconciliation is the only matcher. Phase 5 never binds a native item itself.

## Proposed defaults

**Proposed, not user-approved.** Resolve these in I1 before I3 lands; documentation, spikes and
the migrations that do not depend on them can proceed.

| Decision | Proposed first slice |
| --- | --- |
| Completion signal | The client reports the grab's infohash complete (all wanted bytes downloaded, seeding or paused-after-completion) **and** the plugin can open every wanted file through the mapped path with the size the client reports. Either alone is insufficient. |
| Polling | An `IHostedService` monitor polls the client every 15 s while any accepted grab is unresolved and not at all otherwise. A native scheduled task `JellyfinModImportRepair` (hourly) re-runs recovery and catches missed ticks. Progress shown to users comes from a cached client snapshot no older than 3 s while the queue is polled. |
| File identification | From the client's file list for the recorded infohash: exactly one file with an allow-listed video extension whose size is at least 90 % of the largest file; `sample`, `trailer` and `extras` names are excluded. Two or more candidates is `ambiguous_files`; zero is `no_video_file`; an archive is `archive_unsupported`. For an episode the parsed season/episode of the chosen file must equal the grab target, using the Phase 4 A4 parser. |
| Destination naming | Movie: `<Title> (<Year>) [tmdbid-<id>]/<Title> (<Year>) [tmdbid-<id>] - <Label>.<ext>`. If the entry already has a bound native movie folder, that folder and its exact name are the prefix (Jellyfin requires the file to begin with the folder name character for character). Episode: `<Series Title> (<Year>) [tmdbid-<id>]/Season NN/<Series Title> (<Year>) S NNENN.<ext>` with no version label; the existing bound series folder is reused when one exists. Titles are sanitized for path separators, control characters, trailing dots and length; nothing existing is renamed. |
| Version label | `<resolution> <source>` from the parsed release, for example `1080p BluRay`; falls back to `<resolution>`, then to the release group, then to `v<n>`. The label must not collide with an existing sibling. |
| Existing copy at the destination | A movie lands as an additional version beside the existing file. An episode whose target already has a playable binding is `blocked/target_exists` until Phase 6 settles episode versions (see I1 spike and open question 4). |
| Same filesystem | Source and destination must share one mount as seen by the plugin process (device and mount point equal per `MediaStorageIdentity`), and `link(2)` must succeed. `EXDEV` or any other failure is `blocked/cross_filesystem`. Never copy. |
| Path mapping | An ordered list of `(clientPathPrefix → localPathPrefix)` pairs on the Phase 4 download-client record. Mapping failures are `blocked/path_unmapped`. The mapped download root must not be inside any library root and no library root inside it. |
| Seeding-copy owner | Phase 5. After the effective seed goals are met the plugin removes the torrent **with its data** through the client API as a durable operation, having verified that the library hardlink exists and shares the inode. Client auto-removal stays disabled (Phase 4 gate 4). A global `SeedReleaseEnabled` switch exists; whether it is on by default is open question 3. |
| Effective seed goals | The strictest of: the indexer requirements snapshot on the grab, the client's observed per-torrent limits, and a global floor (proposed floor: ratio 1.0 or 7 days seeding, whichever comes first, per torrent). ANDed with client state (`complete` and not currently importing); never ORed. |
| Progress projection | Acquisition state is projected into DTOs from the import operation and the client snapshot; `Entry.State` and `Entry.Progress` are not written on every tick. `Entry.State` changes only when reconciliation binds the imported file (`onDisk`). |
| Queue visibility | Rows are visible to any signed-in user for entries in libraries they can access; Remove, Retry and Open in client are admin-only and enforced server-side. Open question 2. |
| Stalled downloads | No progress for 24 h is shown as `stalled`. Phase 5 takes no automatic action; removal is manual through the queue. Phase 6 may add automation. |
| Blocklist | Remove with *blocklist this release* stores the infohash and the indexer-namespaced GUID. Phase 4 scoring rejects blocklisted candidates with `blocklisted`. |

## Entry gates and dependencies

**Proposed, not user-approved.** Numbered so later documents can cite them.

1. Phase 4 A8 is accepted on the isolated test instance, including the A6 amendments (a)–(e):
   Get again never inherits a prior deadline, the Phase 3 read adapter recognises the chosen
   client's paths, File-filter membership for grabbed rows, and reclaimed episodes are not
   "missing".
2. The Phase 3 review blockers T7, T8, T9, T10 and T18 pass on the isolated test instance. T7 is
   load-bearing here: without the representation baseline (`RetentionEvaluation.BaselineAt`,
   `RequiresFreshCompletion`), a re-imported title is due immediately at the next daily run.
   T9 is load-bearing because I4's recovery follows T9's runner-wired recovery shape.
3. PLAN open question 3 is answered by deployment: the download directory and the library root
   are reachable from the Jellyfin container through **one mount** on one filesystem. Linux
   refuses `link(2)` across two mounts even when they are bind mounts of the same filesystem, so
   two separate bind mounts of sibling directories do not satisfy this gate. The answer is
   recorded without publishing host paths.
4. The Phase 4 download-client decision (PLAN open question 6) is recorded, and the retention
   seed read adapter for that client exists (PHASE4 A6 amendment (b)). The retention preview
   classifies media whose client is unknown as `seed_state_unknown`; an import into a library
   whose seed adapter cannot see the client would either be blocked from reclaim forever or, if
   the Transmission index is complete, be treated as non-torrent and reclaimed while seeding. If
   the client is Transmission, T17 also applies.
5. X3 deploy tooling and X4 Health `revision`/`capabilities` are in place; the web gates the
   queue on `capabilities` containing `queue` and `import`.
6. A9 infrastructure exists: the disposable client on the isolated compose, the Torznab boundary
   server, the legal fixture, credentials only in the ignored `plugin/.env` (`0600`).
7. Recommended, not blocking: R6 and R7, so a stale `onDisk` episode or an orphaned entry cannot
   make the importer refuse a valid destination or bind into a dead library.

## Data model and ownership

Use the existing plugin SQLite database at `Plugin.Instance.DataPath` with new migrations. The
plugin configuration stays XML-serializable; structured records go to SQLite.

| Record | Minimum contents and invariants |
| --- | --- |
| `ImportOperation` | `Id`, `GrabId` (unique), `EntryId`, `EpisodeId?`, `TargetLibraryId`, `DownloadClientId`, `InfoHash`, `State`, `Reason?`, `Error?` (bounded, admin-only), `ClientState` snapshot (progress 0–1, downloaded/size bytes, rate, ETA, observed at), `SourceClientPath?`, `SourceLocalPath?`, `SourcePhysicalIdentity?`, `SourceLogicalBytes?`, `DestinationPath?`, `DestinationPhysicalIdentity?`, `HardlinkCountAfter?`, `NativeItemId?`, `BindingId?`, `VersionLabel?`, timestamps `CreatedAt`, `CompletedDownloadAt?`, `LinkedAt?`, `ScanRequestedAt?`, `BoundAt?`, `CompletedAt?`, `StalledSince?`. Exactly one open operation per grab; one per target while open (mirrors the Phase 4 one-active-grab rule). |
| `SeedReleaseOperation` | `Id`, `ImportOperationId`, `InfoHash`, `DownloadClientId`, `State`, `Reason?`, `EffectiveGoal` snapshot (ratio, seconds, source of each), `ObservedRatio`, `ObservedSeedingSeconds`, `SeedingPath`, `SeedingPhysicalIdentity`, `HardlinkCountBefore`, `PhysicalBytesReleased?` (0 while the library link remains, null unknown), `CreditedRetentionOperationId?`, `PreparedAt`, `RemovedAt?`, `CompletedAt?`. Created when an import completes; one per import. |
| `DownloadClientPathMapping` | `Id`, `DownloadClientId`, `Order`, `ClientPathPrefix`, `LocalPathPrefix`, `VerifiedAt?`, `VerificationReason?`. Ordered longest-prefix match. |
| `ReleaseBlocklistEntry` | `Id`, `InfoHash`, `IndexerId?`, `SourceGuid?`, `RawTitle`, `EntryId`, `EpisodeId?`, `Reason`, `CreatedAt`, `CreatedByUserId`. Consulted by Phase 4 scoring. |
| Grab record (Phase 4) | Gains nothing new; the import references it. The grab's seed-policy snapshot is one input to the effective goal. |
| History | New event types: `downloading` is **not** an event (too noisy); `imported` (one per completed import, `Id` = the operation ID so retries cannot duplicate it, as the retention executor does), `import_blocked`, `import_failed`, `seeding_released`, `seeding_copy_missing`, `queue_removed`, `blocklisted`. |
| Settings | `ImportEnabled` (default true), `SeedReleaseEnabled` (open question 3), `SeedFloorRatio`, `SeedFloorHours`, `ImportPollSeconds` (15), `VideoExtensions` (allow-list string), `StalledAfterHours` (24). Stored as plain XML fields. |

Proposed `ImportOperation.State` values, in the same style as `RetentionOperationStates`:
`waiting` (grab accepted, download incomplete), `identifying`, `linking`, `linked`, `scanning`,
`completed`, `blocked`, `failed`, `cancelled`. `linked` means the hardlink exists and has been
verified but no native binding is known yet; it is the state recovery inspects first, because the
filesystem action is done and only the scan/bind remains. `blocked` is retryable by an admin
after the cause is fixed; `failed` is terminal for that operation, and a Retry creates a new one
referencing the same grab.

Ownership of the physical states:

- Phase 4 owns the grab until the client reports it complete. Phase 5 owns the import from the
  first `identifying` tick. Phase 2 owns the binding once the scan produces a native item. Phase
  3 owns the library file's lifetime after binding. Phase 5 owns the seeding copy for its whole
  lifetime, from `accepted` grab to `seeding_released`.
- A retention reclaim of a hardlinked import unlinks only the library path and records
  `PhysicalBytesReleased = 0` (link count above one), as T3 already does. A seed release that
  removes the last link records the logical size as released and credits the earlier retention
  operation (`CreditedRetentionOperationId`), so run summaries and history can show "freed later".
- Locks: I4 and I5 take the target library's `ReconciliationLibraryLock` for the link step and
  hold no database write transaction across the link or the HTTP calls. Seed release and retention
  operations on the same physical identity are serialized through `RetentionExecutionGate`; a seed
  release never runs while a retention operation for the same inode is `prepared` or `unlinked`.

## API contract

All routes are under `/JellyfinMod`, `[Authorize]`, camelCase, UTC ISO 8601, JSON nulls, the
existing concealed 404 for inaccessible entries, and `Policies.RequiresElevation` where marked.
Physical paths, client credentials and raw client errors appear only in admin responses.

| Endpoint | Contract |
| --- | --- |
| `GET /Queue` | Rows for every open import operation, plus completed imports whose seed release is still open, filtered to the caller's accessible libraries. Optional `state[]`, `entryId`. Returns `{ items, totalRecordCount, generatedAt, clientStatus }`. |
| `GET /Imports/{id}` | One import operation with its history-relevant fields; admin responses add paths, physical identities and bounded `error`. |
| `POST /Imports/{id}/Retry` (admin) | Allowed from `blocked` or `failed`; creates a new operation for the same grab and returns it (202). Refused with 409 while another operation for the grab is open. |
| `DELETE /Queue/{id}` (admin) | Body `{ "removeFromClient": true, "blocklist": false }`. Cancels the import operation, optionally removes the torrent and its data through the client (only torrents this plugin added), optionally blocklists the release. Never touches a library file. Returns the terminal operation. |
| `GET /Seeding` (admin) | Open seed-release operations with effective goals, observed ratio/time and `waitingFor` reasons; the disk-honesty view. |
| `POST /Seeding/{id}/ReleaseNow` (admin) | Overrides the goal wait for one torrent. Proposed as an admin escape hatch only; whether it should exist is open question 6. |
| `PATCH /Settings/DownloadClients/{id}` (admin, Phase 4 route) | Gains `pathMappings: [{ clientPathPrefix, localPathPrefix }]`. Validation rejects a local prefix inside a library root or containing one. |
| `POST /Settings/DownloadClients/{id}/TestImportPath` (admin) | Given `{ clientPath }`, returns the mapped local path, whether it exists, its mount identity, the library roots that share that mount, and the result of a `link(2)` probe into each library root using a dot-prefixed temporary file that is removed immediately. No torrent is added. |
| `GET /Health` | `capabilities` gains `queue`, `import` and `seedRelease`. |
| Existing `POST /Browse`, `GET /Entries`, `GET /Entries/{id}` | Rows and Entry DTOs project `state: "downloading"` with `progress` (0–100 integer, as the web type already expects) from the import snapshot while an operation is `waiting`, and `grabbed` before the client has reported any progress. The File filter's Downloading membership follows the same projection (PHASE4 A6 (d)). |

Queue row shape (illustrative):

```json
{
  "id": "55555555-5555-4555-8555-555555555555",
  "grabId": "66666666-6666-4666-8666-666666666666",
  "entry": { "id": "2222…", "mediaType": "movie", "title": "Example Movie", "year": 2021,
             "posterPath": "/abc.jpg", "jellyfinItemId": null, "targetLibraryId": "1111…" },
  "episode": null,
  "releaseTitle": "Example.Movie.2021.1080p.BluRay.x265-GROUP",
  "state": "downloading",
  "reason": null,
  "progress": 0.42,
  "sizeBytes": 8400000000,
  "downloadedBytes": 3528000000,
  "downloadRateBytes": 6200000,
  "etaSeconds": 786,
  "stalledSince": null,
  "observedAt": "2026-09-19T10:00:03Z",
  "client": { "id": "7777…", "name": "Transmission (isolated)", "openUrl": "https://…" },
  "seeding": null
}
```

After import the same row continues with `"state": "seeding"` and
`"seeding": { "ratio": 0.6, "goalRatio": 1.0, "seedingSeconds": 3600, "goalSeconds": 604800,
"waitingFor": ["ratio", "time"], "libraryLinkPresent": true }` until release, then leaves the
queue. `state` values: `queued`, `downloading`, `stalled`, `identifying`, `linking`, `scanning`,
`seeding`, `blocked`, `failed`, `unknown`. `unknown` is used when the client is unreachable; the
row keeps its last progress and `observedAt` so the UI can show "stale since" rather than 0 %
(UX §14). `progress` is null, never 0, when it has never been observed.

`clientStatus` on the list is `{ "reachable": true, "checkedAt": "…" }` or
`{ "reachable": false, "checkedAt": "…", "reason": "client_unreachable" }`.

Stable `reason` codes for `blocked`/`failed`: `path_unmapped`, `source_missing`,
`source_size_mismatch`, `no_video_file`, `ambiguous_files`, `archive_unsupported`,
`episode_mismatch`, `target_exists`, `cross_filesystem`, `destination_not_writable`,
`destination_collision`, `library_root_missing`, `scan_timeout`, `binding_not_observed`,
`client_unreachable`, `torrent_missing`, `import_disabled`, `cancelled`. Every code has a
user-facing sentence in the web `constants/` module, as `retentionMessage` does today.

## Tasks and acceptance

| ID | Task and owner | Depends on | Required evidence |
| --- | --- | --- | --- |
| I1 | Decisions and spikes; plugin/web contract | Gates 1–6 | Same-mount evidence, targeted-scan mechanism, episode-version behaviour, client file/delete semantics, concrete DTOs |
| I2 | Data model, settings, Dashboard forms and migrations | I1 | Real admin save/read/restart, path-mapping validation and probe, migration on a copy of the isolated database |
| I3 | Download monitor, identification and progress projection | I2 | Real client polling on the isolated instance, projected `downloading` rows, stalled/unknown handling |
| I4 | Hardlink importer with durable, recoverable operations | I2, I3 | Real hardlink into the isolated writable library, no copy on `EXDEV`, crash recovery from every state |
| I5 | Targeted scan, binding attribution and retention baseline | I4, Phase 2/3 | Native item bound by reconciliation, one `imported` event, fresh baseline, no `media_missing` |
| I6 | Seed-goal honouring and seeding-copy release | I5, gate 4 | Real client removal after goals, library link survives, physical accounting and credit |
| I7 | Queue and import API; removal and blocklist | I3–I6 | Real HTTP as admin/user/anonymous, 3 s polling cost, removal with and without client mutation |
| I8 | `/catalog/queue` and downloading cards; web | I7, X4 | Built app on desktop, mobile, TV 1920×1080 and 1280×720 by D-pad; degradation on old plugin |
| I9 | Isolated end-to-end acceptance and release gate | I1–I8 | Grab → download → import → play → watch → reclaim → release, with restarts and failure cases |

Commit scopes: `feat(import,p5.i1)` … `feat(import,p5.i6)`, `feat(queue,p5.i7)`,
`feat(queue,p5.i8)`, `test(import,p5.i9)`; fixes use `fix(import,p5.iN)`.

### I1 — settle the mechanisms before writing the importer

Record, with evidence from the isolated test instance and no published host paths:

- **Same mount.** Which single mount inside the Jellyfin container contains both the mapped
  download directory and the isolated writable library, shown by the plugin's own
  `MediaStorageIdentity` output and a successful `link(2)` probe. If the current compose layout
  uses two bind mounts, record that as the deployment change required by gate 3, and do not work
  around it in code.
- **Targeted scan.** Which in-process call the pinned host offers to refresh one folder without a
  full library scan: the `ILibraryMonitor` file-system-changed report that backs
  `POST /Library/Media/Updated`, or validating the children of the resolved parent folder
  through `ILibraryManager`. Measure on the Pi how long each takes for one new file in a
  library of the isolated instance's size, and whether it raises the `ItemAdded` event the
  `LibraryEventListener` already consumes. Prefer the one that triggers the existing listener.
- **Episode versions.** Jellyfin documents multi-version grouping for movie folders only. Land
  two files for one episode with a ` - Label` suffix in a disposable series and record whether
  the pinned host merges them into one item with a version selector, shows two episodes, or
  ignores one. The answer decides the episode rows of the naming default and Phase 6 M1.
- **Client semantics.** From the chosen client's actual API: the file-list fields (name, size,
  progress, priority/wanted), the completion signal fields, whether "delete with data" removes
  only that torrent's files, how the client reports ratio and seeding time, and whether a torrent
  paused by the client's own share limit is distinguishable from one paused by hand. The client
  is Transmission (user decision 1): extend the Phase 4 Transmission driver and the shared
  `TransmissionRpc` transport rather than adding a second RPC client.
- **Legal fixture.** Reuse the A1 fixture. Add a second payload large enough (for example 64 MB
  of generated bytes) that download progress is observable across several 3 s polls on the Pi,
  and a third that is an archive, for the `archive_unsupported` case.
- **Contract.** Publish the DTOs above with one example each, the state machine and reason
  codes, and the `capabilities` names, so I7 and I8 can start from the same text.

**Acceptance** — the recorded answers exist in this document under a dated *I1 evidence*
heading, each with the isolated command or API used (redacted of paths), and the open questions
below that depend on them are marked answered or re-asked.

### I2 — persist intent, mappings and settings

Add the four records and the settings fields with migrations; extend the Dashboard download-client
form with an ordered path-mapping editor, the import switches and the seed floor. Validation
rejects a local prefix inside any library root or containing one, an empty prefix and a duplicate
order. Saving a mapping runs the probe from `TestImportPath` and stores `VerifiedAt` or the
reason; an unverified mapping does not stop saving but blocks imports with `path_unmapped`.
Secrets follow the Phase 4 rules: presence indicators only.

**Acceptance** — real host on the isolated test instance:

- The migration applies to a copy of the isolated database and passes integrity and foreign-key
  checks; entries, bindings, evaluations, operations and grabs are preserved.
- An admin saves two mappings and a seed floor in the built Dashboard, restarts the container,
  and reads them back unchanged; an ordinary user receives 403 on the same PATCH.
- A mapping whose local prefix lies inside the isolated library root is rejected with a message
  that names the rule; a valid mapping records `VerifiedAt` after a successful probe, and the
  probe's dot-prefixed file no longer exists afterwards.

### I3 — watch the client and project progress honestly

Implement the monitor as an `IHostedService` that starts after `DatabaseInitializer` reports
ready, wakes every `ImportPollSeconds` while an operation is open, reads one client snapshot per
tick, and updates the `ClientState` column of each `waiting` operation only when progress, rate
or state changed. Unreachable clients mark the snapshot stale without touching operations; the
queue shows `unknown` with the last `observedAt`. A grab whose infohash is no longer in the
client becomes `blocked/torrent_missing` (an admin may have removed it), never `failed`, so a
re-add can resume it. Register `JellyfinModImportRepair` as an `IScheduledTask` that runs the
same tick and I4's recovery.

When the client reports completion, identify the file per the defaults table, map its path, open
it, compare its size with the client's, record source path and physical identity and move the
operation to `identifying` → `linking` in the same tick. Any check that fails produces a
`blocked` operation with the stable reason and one `import_blocked` history event, written once
per reason change rather than per tick.

Projection: `POST /Browse`, `GET /Entries` and detail reads join open import operations for the
returned entries and episodes and project `grabbed`/`downloading` plus `progress` without writing
`Entry`. The projection uses the same cached snapshot as the queue so a card ring and the queue
row agree.

**Acceptance** — isolated test instance with the disposable client and the 64 MB fixture,
throttled at the seeder so the download spans at least a minute:

- A movie grabbed through the built picker shows `downloading` with a rising `progress` in
  `POST /Browse`, in the card ring in all three layouts and in `GET /Queue`, with the same
  value in each within one poll.
- Stopping the client container turns the queue row `unknown` with the last progress and
  `observedAt`, never 0 %; starting it again resumes without a new operation.
- Removing the torrent by hand in the client WebUI yields `blocked/torrent_missing` and one
  history event; re-adding the same fixture resumes the same operation.
- SQLite write volume during a download stays at one row update per changed tick, shown by
  comparing `ClientState.observedAt` changes against poll count in the log.

### I4 — hardlink into the library, durably

Under the target library's `ReconciliationLibraryLock`, and after re-reading the operation and
the grab:

1. Resolve the destination folder: the bound native folder when the entry (or the episode's
   series) has a current binding, otherwise a new folder under the library's first location that
   is on the same mount as the source; a library with several locations records which one was
   chosen. Compute the file name and version label; refuse a collision with
   `destination_collision` rather than overwriting.
2. Verify the same-mount precondition with `MediaStorageIdentity` and record both identities.
3. Persist the operation as `linking` with `DestinationPath`, then call `link(2)`. On `EXDEV`,
   permission or any other error, mark `blocked` with `cross_filesystem` or
   `destination_not_writable`; **never** fall back to a copy or a move.
4. Re-inspect: destination exists, same device and inode as the source, link count at least two,
   size equal. Persist `linked` with `HardlinkCountAfter` and `LinkedAt`.

Recovery, run at monitor start and by the repair task under the same gate order as the T9
runner: an operation found `linking` inspects the destination; if it exists and matches the
source inode it becomes `linked`, otherwise it returns to `identifying`. A `linked` operation
whose destination vanished before binding becomes `blocked/source_missing` if the source is also
gone, or returns to `linking` if the source survives. A `scanning` operation older than the scan
timeout is retried once, then `blocked/scan_timeout`. Nothing in recovery deletes a file.

**Acceptance** — real files on the isolated writable library:

- The imported movie appears at the documented path with link count 2, identical inode to the
  source, and no second copy anywhere (`du` of the mount unchanged apart from metadata).
- With a destination deliberately configured on a second bind mount of the same host filesystem,
  the import is `blocked/cross_filesystem` and no file is written to the library. Restoring the
  single-mount layout and pressing Retry succeeds.
- Killing the container between `linking` and `linked`, and again between `linked` and
  `scanning`, is followed after restart by one completed operation, one hardlink and no
  duplicate destination file.
- A colliding sibling name produces `destination_collision` and leaves the existing file
  untouched.

### I5 — scan only the new folder and let Phase 2 bind it

After `linked`, request the targeted refresh chosen in I1 for the destination folder (or the new
movie folder, or the season folder), persist `scanning` with `ScanRequestedAt`, and release the
library lock. The existing `LibraryEventListener` reconciles the resulting native item through
`ReconciliationService`, which binds it by provider identity exactly as it does for a file the
user added by hand. Phase 5 adds only attribution:

- Before requesting the scan, record the expected destination path on the operation. When
  reconciliation binds a native item whose media path equals an operation's destination, it
  attaches `BindingId` and `NativeItemId` to the operation and completes it: `completed`,
  `CompletedAt`, one `imported` history event with the release title, version label, logical
  bytes and operation ID, and a `SeedReleaseOperation` in `waiting`.
- Reconciliation must **not** write `media_missing`/`episode_media_missing` for anything Phase 5
  does, because Phase 5 never removes a library file; the assertion below guards the seeding
  path, which is outside the library.
- Retention baseline: binding an imported representation goes through the T7 path
  (`RetentionTargetReset`, `BaselineAt = BoundAt`, `RequiresFreshCompletion = true`). Old
  completion observations and any past deadline are ignored. This is what keeps Get again from
  being deleted the next morning.
- Series: binding one episode does not mark the series or other episodes `onDisk`; episode
  `availability` becomes `onDisk` for that episode only. Reclaimed episodes stay `reclaimed`
  (T14).
- If the scan does not produce a binding within the timeout (proposed 10 minutes on the Pi), the
  repair task re-requests once, then blocks with `binding_not_observed`, keeping the hardlink;
  a later full scan still binds it and completes the operation.

**Acceptance** — isolated test instance, real scan, no database edits:

- After import, exactly one native item exists for the fixture, `Entry.State` is `onDisk`,
  `jellyfinItemId` is set, and the folder scan took less than a full-library scan (timings
  recorded).
- History shows one `imported` event and no `media_missing`; a second full library scan adds no
  event.
- `GET /Retention/Preview` shows the new representation `waiting`/`not_due` with
  `BaselineAt` ≥ the import time, in Any user and All users modes, even when the same title was
  reclaimed earlier and its old observations still exist. Running the evidence repair task does
  not change that.
- Importing one episode of a disposable series marks only that episode `onDisk`; the series
  page shows the others `missing` or `unaired` and reclaimed ones `reclaimed`.
- The imported movie plays in the built browser on desktop, mobile and TV layouts.

### I6 — honour seed goals, then remove the seeding copy

Each completed import owns one `SeedReleaseOperation`. The monitor and the repair task evaluate
it on every tick:

- Effective goal = strictest of the grab's indexer snapshot, the client's observed per-torrent
  limits (never lowered; PHASE4 A6) and the global floor. Satisfied only when the client reports
  the torrent complete **and** ratio ≥ goal ratio **or** seeding time ≥ goal time, according to
  the goal's own semantics (Transmission: ratio or idle, user decision 1),
  **and** every finite component the indexer requires is met. `isFinished`-style client flags
  are evidence, not proof (PHASE4 A6 (c)).
- Preconditions to remove: `SeedReleaseEnabled`; the plugin added this torrent (grab record with
  matching infohash, client and category); no `prepared`/`unlinked` retention operation on the
  seeding inode; the seeding path is not inside a library root; and either the library hardlink
  exists with the same inode (normal case) or a completed retention operation already removed it
  (late case).
- Execution: persist `removing` with `HardlinkCountBefore` from the seeding path, call the
  client's delete-with-data, then inspect: the seeding path is gone; if the library link exists
  its link count is now one and `PhysicalBytesReleased = 0`; if the library link was already
  reclaimed, `PhysicalBytesReleased = SourceLogicalBytes` and `CreditedRetentionOperationId`
  points at that reclaim. Write one `seeding_released` history event with both numbers and, when
  credited, a sentence such as "Freed 8.4 GB previously reported as 0 B".
- If the client no longer has the torrent (removed externally) the operation ends
  `completed/seeding_copy_missing`, bytes unknown, with one history event; nothing is deleted by
  the plugin in that case.
- Retention interplay: while the seed release is open, the Phase 3 preview must block the
  library file with `seed_goal_unmet`/`seeding_incomplete` through the client read adapter (gate
  4). Once released, the library file is plain media and the T3 accounting applies. Keep and
  favourites never delay a seed release: they protect the library file, and the seeding copy is
  not the library file.

**Acceptance** — isolated test instance, disposable client with auto-removal disabled, the
fixture seeded by the disposable peer so ratio can be driven:

1. With a goal of ratio 1.0 and no time goal, the release stays `waiting` at ratio 0.5 and the
   library file is blocked in `GET /Retention/Preview` with a seed reason. At ratio ≥ 1.0 the
   next tick removes the torrent and its data; the library file remains playable with link
   count 1; history has one `seeding_released` with `physicalBytesReleased: 0`.
2. Reverse order: retention reclaims the library link first (link count 2 → the T3 record shows
   0 bytes released). When the seed goal is later met, the release frees the file, records the
   logical size as released and credits the retention operation; `Retention/Runs/Latest` or the
   entry history shows the credit.
3. The indexer snapshot requires 14 days while the client limit is 7: the release waits for
   14 days (simulated by the boundary fixture's clock or by setting the floor to seconds and the
   snapshot to minutes; document which).
4. A torrent the plugin did not add, in the same category, is never removed.
5. Killing the container between `removing` and the inspection leaves, after restart, one
   terminal operation and no duplicate history.
6. `SeedReleaseEnabled = false` removes nothing and the queue row explains why.

### I7 — the Queue API and the two actions

Implement the endpoints from the contract. Removal deletes nothing in the library; with
`removeFromClient` it removes the torrent and its data only when the plugin owns the torrent, and
it cancels the import operation (`cancelled`), the grab's projection and any waiting seed
release. With `blocklist` it writes the blocklist entry and one `blocklisted` history event;
Phase 4's scoring rejects the same infohash or GUID afterwards with a visible reason. Access:
rows are filtered by the caller's library access; the three writes require elevation; API keys
follow whatever P11 decided.

**Acceptance** — real HTTP on the isolated test instance:

- Admin, existing ordinary user and anonymous requests to each endpoint return the documented
  codes; the ordinary user sees only rows in libraries they can access.
- `DELETE` without `removeFromClient` leaves the torrent in the client and the row gone;
  with it, the torrent and its data are gone and the library (if imported) is untouched.
- A blocklisted release is rejected by a fresh `GET /Releases` with reason `blocklisted`.
- Thirty seconds of 3 s polling from two browser sessions costs one client snapshot per tick,
  not one per request (log evidence).

### I8 — the queue route and downloading cards

Add `src/apps/modern/routes/catalog/queue.tsx` and one entry in `asyncRoutes/user.ts`; the page
component, hooks and styles live under `features/jellyfinmod/`. Add one menu item, **Queue**,
to the existing user menu (`AppUserMenu`) as the UX decision log places it; nothing is added to
the drawer or `UserViewNav`. Cards keep the existing progress ring from `FileStateMark`, fed by the
projected `progress`; the card context menu gains **View queue** for `grabbed`/`downloading`
rows. Gate all of it on Health `capabilities` containing `queue`; an older plugin shows the
UX §14 message and never a spinner.

Behaviour per layout, all with `useQueue` polling every 3 s only while mounted and
`placeholderData: previous => previous`:

- **Desktop**: one table, columns poster thumb · title · progress bar · size · speed · ETA ·
  state · client; a row menu with Remove (opens the stock confirm dialog with the two
  sub-options) and Open in client.
- **Mobile**: stacked rows, one column, the same menu behind the row's overflow button; no
  horizontal scroll at 390 px.
- **TV** (`layoutManager.tv`): a single-column list, one focusable `<button>` per row, first row
  focused on open (or the empty-state link), Enter opens the action sheet with the two actions,
  Back returns to the page the user came from. Poll updates re-render rows in place; row order
  is frozen while a row is focused and re-sorted only when focus leaves the list. Rows show
  parsed summary as the primary line and the raw release title dimmed beneath (UX §9 style).
  Stale rows show "Updated 45 s ago", never 0 %.
- Empty state: *Nothing downloading.* with a link to Movies filtered to Not downloaded.
- Styles: feature-local `jfmod-queue*` classes, `em` sizing, values from the theme files, no
  `display: contents`, no flex `gap` (W11), and no change to any upstream selector.

**Acceptance** — built browser against the isolated test instance while a throttled fixture
downloads, at desktop, mobile, TV 1920×1080 and TV 1280×720 with
`localStorage.setItem('layout','tv')`, arrow keys, Enter and Back:

- The route renders within the first poll, the ring on the Movies card and the queue row show
  the same progress, and focus stays on the focused row through at least ten poll updates.
- Remove on TV opens the confirm dialog by Enter, Back cancels it and returns focus to the row;
  confirming removes the row without unmounting the list.
- With a plugin build whose Health lacks `queue`, the route shows the degradation message and
  the user menu item is hidden.
- `npx tsc --noEmit`, the feature eslint and stylelint pass. Physical webOS evidence is reported
  separately from emulation.

### I9 — isolated acceptance and release gate

Run the whole chain on `jellyfinmod-test` (port 18096) with the plugin revision recorded from
Health and deployed through the X3 tooling, signed in as `oleksii` with an empty password, and
with production never contacted:

1. Grab the legal fixture for a wanted disposable movie through the built picker; watch it
   download in the queue; confirm import, playback, one `imported` event and a fresh retention
   baseline (I3–I5 acceptance in one run).
2. Complete playback as `oleksii` in Any user mode with a 1-day per-entry window (T13). After
   the window the native task reclaims the library link (0 bytes released, seeding copy
   present); when the seed goal is met the release frees the bytes and credits the reclaim
   (I6 case 2).
3. Repeat with the order reversed (seed goal first, then retention), with an episode of a
   disposable series, and with a movie that already has a native file (second version lands and
   the stock version selector lists both).
4. Failure cases: `EXDEV`, path unmapped, ambiguous files, archive, episode mismatch, torrent
   removed externally, client down during download, container killed in each import state, and
   Remove with each option. Each ends in the documented state with no file outside the
   documented paths and no library deletion.
5. Security: ordinary user and anonymous access to every new endpoint; a user without access to
   the target library sees no row and gets the concealed 404 on `GET /Imports/{id}`.
6. Regressions: Phase 2 suites and the T18 retention cycle still pass; native playback,
   bookmarks and per-user state unchanged; no `media_missing` written during the run.
7. Browser: I8's matrix, plus the Movies grid never blanking during polls.
8. Record plugin and web revisions, client version, fixture identity, timings, Pi memory and
   the merged master SHA; restore `SeedReleaseEnabled` and retention to their prior values;
   remove disposable media.

Phase 5 is complete only when a grab becomes a playable library file without a copy, survives
restarts in every state, starts retention from the import time, and the seeding copy is removed
by the plugin after its goals so that the retention cycle demonstrably frees disk.

## I1 evidence — 2026-09-19

Nothing was deployed to the isolated instance on this date (it is reserved until the T18 run
finishes), so the answers below come from a read-only inspection of the isolated container, the
pinned host API and the integration suites. Each item names what still has to be measured live in
the I9 checklist.

- **Same mount.** A read-only `docker inspect` of `jellyfinmod-test` shows exactly one writable bind
  mount, which holds the isolated library and has room for a download folder beside it; the
  production media mounts are read-only. Gate 3 is therefore satisfiable by putting the
  Transmission download directory inside that one mount, outside every library root. The plugin
  checks this itself: the download-client save compares statx device and mount identity (Phase 4),
  and `POST /DownloadClients/{id}/TestImportPath` performs a real `link(2)` probe into each
  same-mount library root. *Live:* run that probe on the isolated instance and record the
  `mountIdentity` (without paths).
- **Targeted scan.** The importer calls `ILibraryMonitor.ReportFileSystemChanged(<new folder or
  file>)`, the in-process call behind `POST /Library/Media/Updated`. It refreshes only the parent
  folder and raises `ItemAdded`, which the existing `LibraryEventListener` consumes; binding then
  happens only in `ReconciliationService`. A scan that has not bound after `scanTimeoutMinutes` is
  reported once more; after the second attempt the import blocks as `binding_not_observed` with
  the hardlink kept, so a later full scan still completes it. `ImportRepairTask` (hourly) retries
  those blocked imports. *Live:* time
  one new file on the Pi.
- **Episode versions.** Not measured. The conservative default is implemented: an episode that
  already has a file blocks as `target_exists`, and Phase 6 keeps episode versions behind
  `episodeUpgradesEnabled` (off). *Live:* land `Series S01E01 - 1080p.mkv` and
  `Series S01E01 - 2160p.mkv` in a disposable series and record whether 10.11.11 merges them.
- **Client semantics (Transmission RPC, legacy method names).** `torrent-get` with `hashString`,
  `name`, `downloadDir`, `labels`, `percentDone`, `sizeWhenDone`, `leftUntilDone`,
  `rateDownload`, `eta`, `status`, `isFinished`, `uploadRatio`, `secondsSeeding`,
  `seedRatioMode`, `seedRatioLimit`, `seedIdleMode`, `seedIdleLimit`, `error`, `files` and
  `fileStats`. Completion is `leftUntilDone == 0` with `percentDone == 1`; unwanted files are
  ignored. `torrent-remove` with `delete-local-data` removes only that torrent's files. Ratio and
  seeding time come from `uploadRatio` and `secondsSeeding`. Phase 4 sets each grabbed torrent to
  unlimited seed modes, so a pause by share limit cannot happen for plugin torrents; ownership is
  the per-grab label `jfmod-<grabId>`. *Live:* confirm against the disposable Transmission.
- **Legal fixture.** The integration boundary writes real payloads (single video, multi-file with
  extras and samples, archive, wrong episode). *Live:* the 64 MB and archive torrents of A1 still
  have to be created for the disposable tracker.
- **Contract.** Published in [API.md](API.md) *Import, queue and seeding (Phase 5)*.

## Implementation status — 2026-09-19

Source is on the Phase 5 build branches; nothing is deployed. Plugin tasks were built and
integration-tested before the Phase 6 work started.

| Task | Status | Notes |
| --- | --- | --- |
| I1 | Partial | Answers above from inspection and code; live measurements are in the checklist below |
| I2 | Done | One migration after Phase 4: import operations (one open per grab), seed releases, ordered path mappings, blocklist, import settings in the SQLite acquisition settings row with a revision; Dashboard sections for import settings and path mappings |
| I3 | Done | `ImportMonitor` hosted service polls every `importPollSeconds` through one shared client snapshot (single-flight, 3 s freshness); stalls after `stalledAfterHours`; client outages keep rows `unknown` instead of failing them |
| I4 | Done | 90 % largest-video rule, extras and samples skipped, episode parse must match, archives blocked; `link(2)` only (no bytes copied, so no free-space check), `EXDEV` blocks `cross_filesystem`, collision-safe names; restart-safe through recorded physical identities |
| I5 | Done | Targeted scan, binding observed only through Phase 2 reconciliation, retention baseline reset at bind, one `imported` history event, grab released |
| I6 | Done | Strictest goal of indexer, client and floor; release only when complete and the goal is met, the torrent is plugin-owned, the seeding path is outside every library and the library link is either the same inode or already reclaimed; bytes verified after removal |
| I7 | Done | Queue, import detail, Retry, Remove (cancel, remove from client, blocklist) and Seeding routes; projections in list, browse and detail |
| I8 | Done, not browser-verified | `/catalog/queue` route, downloading cards, detail and user-menu links, TV route entry; type-check, lint, stylelint and production build pass |
| I9 | Partial | `PhaseFiveIntegration` passes; the isolated live run is below |

Plugin evidence (offline SDK container on the test host, committed tree): `PhaseZeroSmoke`,
`PhaseOneSmoke`, `PhaseTwoIntegration`, `PhaseThreeIntegration`,
`PhaseThreeProtectionIntegration`, `PhaseFourIntegration`, `PhaseFiveIntegration` and
`PhaseSixIntegration` all exit 0. `PhaseFiveIntegration` runs a real Kestrel host with
authentication, MVC serialization, EF migrations and SQLite, a Torznab boundary and a Transmission
RPC boundary that writes real files, real `link(2)` into a real library folder, and the
production monitor, scan, reconciliation and retention code. It covers download progress, import,
binding, retention baseline, both seed-release orders, every documented block reason, restart in
each import state, Remove with each option, and anonymous, ordinary-user and no-library-access
calls.

### Defaults chosen here — needs user decision

Each is the conservative option behind a named setting or documented default:

1. **Queue visibility (open question 2):** `queueVisibleToUsers` defaults to off, so the queue is
   administrator-only like search and grab.
2. **Seed release (open question 3):** `seedReleaseEnabled` defaults to off; floors are ratio 1.0
   **or** 168 hours. The client's idle limit is not part of the goal.
3. **Episodes with a file (open question 4):** blocked as `target_exists`.
4. **Archives (open question 5):** blocked at import as `archive_unsupported`; Phase 4 scoring is
   unchanged.
5. **Release-now (open question 6):** not implemented. `DELETE /Queue/{id}` with
   `removeFromClient` is the only escape hatch and never touches the library file.
6. **Folder naming (open question 7):** `Title (Year) [tmdbid-N]`; existing native folders are
   reused, never renamed.
7. **Version label (open question 8):** `<resolution> <Source>` (for example `1080p WEB-DL`), with
   ` vN` appended on a collision.
8. **Import settings live in SQLite,** not plugin XML, to keep the revision and Dashboard contract
   of Phase 4.
9. **Retry** of a blocked import re-inspects from the start rather than resuming.
10. **Retention baseline** is reset for every added version, not only the first file.

### Live acceptance checklist (I3–I9)

Run after the T18 window, on `jellyfinmod-test` only, with a disposable Transmission whose download
directory is inside the single writable mount and outside every library root, auto-removal off:

1. Deploy the Phase 5 plugin build and web bundle; confirm Health lists `queue`, `import` and
   `seedRelease` and the migration applied; record the revisions.
2. Dashboard: add the path mapping, run *Test import path*, and confirm `linked` for the movie and
   TV roots (I1 same-mount evidence).
3. Grab the 64 MB fixture for a disposable movie; watch `queued` → `downloading` with advancing
   progress over several polls → `identifying` → `linking` → `scanning` → `seeding`.
4. Confirm the library file shares the download's inode (`stat` link count 2), the item plays,
   one `imported` history event exists and the retention baseline is the import time.
5. Time the targeted scan; confirm no full library scan ran (I1 targeted-scan evidence).
6. Land two versions of one episode in a disposable series and record whether they merge (I1
   episode evidence); remove them.
7. Seed release on: with a short floor, confirm the seeding copy is removed only after the goal,
   the bytes are freed only when retention has also reclaimed the library link, and both orders
   work. Restore `seedReleaseEnabled` afterwards.
8. Failure cases: wrong path mapping, ambiguous files, archive, wrong episode, torrent removed in
   the client, Transmission stopped mid-download, container restart in `linking` and `scanning`,
   and Remove with each option. No file appears outside the documented paths and no library file
   is deleted.
9. Security: anonymous and ordinary-user calls to every new route; a user without library access
   gets the concealed 404 on `GET /Imports/{id}`.
10. Browser (I8), signed in as `oleksii` with an empty password, against the built bundle: desktop
    and mobile at 390 px — queue rows, progress, blocked reasons, Retry, the Remove dialog with
    both options, downloading cards in Movies and TV and the detail link; TV layout — D-pad focus
    stays on the focused row across ten polls and the list never unmounts; the Movies grid never
    blanks during polls; an ordinary user sees no queue link; with the capability missing (old
    plugin) the route, cards and menu entry are hidden.
11. Regressions: Phase 2 suites and the T18 retention cycle still pass; no `media_missing` written.
12. Record revisions, client version, fixture identity, timings and Pi memory; remove disposable
    media and torrents.

## Risks

| Risk | Required response |
| --- | --- |
| Two bind mounts make every import `EXDEV` on the real Pi | Gate 3 answers this before code; the probe endpoint makes the failure visible in the Dashboard; no copy fallback hides it |
| The importer or the queue becomes a second matcher | I5 binds only through `ReconciliationService`; the operation stores an expected path, never a native ID it invented |
| Imported media deleted at the next 03:00 run | Gate 2 (T7) plus I5's baseline assertion in Any and All users modes |
| Retention frees 0 bytes forever | I6 owns the seeding copy; the queue's `seeding` state and `GET /Seeding` make the wait visible; accounting credits the earlier reclaim |
| Seed release deletes the library file | Precondition: library link exists with the same inode or was already reclaimed; seeding path must be outside every library root; verified after deletion |
| Client auto-removal races the plugin | Auto-removal disabled in the isolated client (Phase 4 gate 4); external removal ends `seeding_copy_missing`, never a plugin delete |
| Progress polling floods SQLite or the client | One snapshot per tick shared by queue and projection; `ClientState` written on change only; no `Entry` writes per tick |
| Episode versions behave differently from movie versions | I1 spike; episodes with an existing copy are blocked until Phase 6 decides |
| Wrong file imported from a multi-file torrent | 90 % largest-video rule with explicit `ambiguous_files`; episode parse must equal the target |
| TV queue reorders under focus | Row order frozen while focused; list never unmounted; verified by ten-poll focus test |
| Paths or credentials leak into docs, DTOs or logs | Admin-only paths; X6 grep guard; credentials only in `plugin/.env` |

## Open questions for the user

1. **Single mount on the Pi.** *Answered 2026-09-19 (user decision 4):* downloads and the library
   share one filesystem through one mount; import is hardlink-only with no copy fallback.
2. **Queue visibility.** Should ordinary users see queue rows for accessible libraries (proposed),
   or is the queue admin-only like search and grab? Consumed by I7 and I8.
3. **Seed release default and floor.** Should `SeedReleaseEnabled` be on by default once I9
   passes, and are ratio 1.0 / 7 days acceptable global floors? Should the release stay off on
   the non-disposable instance until I9 passes, mirroring the Phase 3 safety gate? Consumed by
   I2 and I6.
4. **Episodes that already have a file.** Block the import until Phase 6 (proposed), or land a
   second episode version if the I1 spike shows the host groups them? Consumed by I4 and M1.
5. **Archives.** Reject `.rar` releases at Phase 4 scoring (preferred, so they never reach the
   client) or only block them at import? Consumed by I1 and Phase 4 A4.
6. **Release-now override.** Should `POST /Seeding/{id}/ReleaseNow` exist as an admin escape hatch
   that removes a torrent before its goals, or should goals be absolute? Consumed by I6 and I7.
7. **Folder naming.** `[tmdbid-…]` in new folder names (proposed, since TMDB is the catalog's
   identity), `[imdbid-…]`, or none? Existing native folders are never renamed either way.
   Consumed by I4.
8. **Version label vocabulary.** `1080p BluRay` (proposed) or resolution only? Consumed by I4 and
   the Phase 6 selector.
9. **Newest Phase 4 contract vs. review amendments.** *Answered 2026-09-19:* the client is
   Transmission, credentials follow user decision 3, mistaken grabs use the 5-second server-side
   hold, and X1 is an entry gate (PHASE4 user decisions 1–5).
