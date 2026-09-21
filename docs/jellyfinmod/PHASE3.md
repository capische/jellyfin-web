# Phase 3 — automatic retention

Planning draft, 2026-09-11. Implement after Phase 2 acceptance. Read `PHASE1.md`,
`PHASE2.md` and UX §8 alongside this document. This refinement supersedes the older
Phase 3 sketch where it assumed STRM placeholders or a single global watched timestamp.

**Status (review 2026-09-18):** implemented; T1–T6 checkpoints recorded, T6 release gates checked
2026-09-17; see the proposed safety gate below.

> **Proposed safety gate (review 2026-09-18, not user-approved):** Phase 3 is implemented.
> Automatic retention stays disabled on non-disposable media until the review blockers T7, T8, T9,
> T10 and T18 pass on the isolated test instance; Selected user mode on real media also waits for
> T13. This defers enabling retention; it does not change the accepted automatic-expiry decision.
> See [Review remediation — 2026-09-18](#review-remediation--2026-09-18) and
> [`REVIEW-2026-09-18.md`](REVIEW-2026-09-18.md).

## Outcome and accepted decisions

Eligible watched media expires automatically, while its catalog identity, metadata,
episode records and history survive. Expiry never removes the catalog entry.

- Admins configure retention and use Keep; ordinary users have no removal/settings controls.
- **Watched-user setting, accepted 2026-09-11:** the retention checkbox enables automatic
  expiry. When enabled, show a watched-user mode: **All users** (default), **Selected user**
  (an account picker, for example the admin/oleksii), or **Any user**. This is configurable,
  not a hard-coded selected household group.
- The scheduled task checks the global enabled setting, including on manual invocation.
- There is no confirmation per automatic expiry. An admin can disable the feature.
- Keep exempts an entry indefinitely and requires one action with no confirmation.
- Preserve favorite, watched/resume, seeding and hardlink safeguards.
- Card countdowns appear within the last 72 hours, or under the Due within 7 days filter.
- **Reclaim removes the media file only, accepted 2026-09-20:** the title's folder and every
  sidecar (`.nfo`, subtitles, artwork, extras) stay on disk, and empty folders are never tidied.
  This is the T3 behaviour ("NFO, subtitle and other neighboring files are not recursively
  removed") recorded as accepted; no phase plans to change it, and T18 verifies it live
  (step 4, "sidecars kept"). Also recorded in PLAN *Automatic expiry* and PHASE7 decision 5.
- All development and destructive acceptance use disposable media in the isolated test
  instance. Production and its media paths are outside the Phase 3 deployment/test scope.

## Product decisions and proposed defaults

The defaults below are proposals, not new user-approved decisions. Finalize these before
enabling deletion; policy-independent implementation and evidence gathering can proceed.

| Question | Proposed behavior |
| --- | --- |
| Whose watched state? | Accepted modes: All users / Selected user / Any user, default All users. Evaluate only users with access to the library; an empty eligible set never qualifies. Selected user uses one explicit account ID. |
| Default retention window | Keep the current 14-day setting, with a positive per-entry override. Store UTC eligibility time and display locally. |
| Existing watched library | Do not infer completion dates from metadata or delete a backlog immediately. Start eligible existing items' grace period when retention is explicitly configured/enabled. |
| TV granularity | Reclaim finished episodes individually; series Keep protects every episode. Never delete a series/season directory as one retention action. |
| Partial playback | Any accessible user's active playback or unfinished resume protects the physical media, even when Selected user or Any user starts the timer. Do not invent a separate 90% completion rule. |
| Favorites | With favorite exemption enabled, a favorite by any accessible user protects the movie/episode; a favorite series protects its episodes. |
| Mark unwatched / replay | Re-evaluate from authoritative native user data; an unwatched state or unfinished resume cancels eligibility. A new completion starts a fresh window. Duplicate notifications do not move deadlines. |
| Policy/user/access changes | Recompute eligibility without shortening an existing grace period silently. An invalid/deleted/inaccessible Selected user blocks expiry until the admin resolves it. All users responds to changes in library access/user membership. |
| Disable then re-enable | Disabled means no deletion and no active countdown. On re-enable, eligible items receive a fresh full grace period; preview the resulting schedule. |
| File-less representation | Recommend keeping the existing plugin-only representation, without STRM placeholders. Old documents assumed placeholders; that assumption is not an implementation requirement. |
| Multiple qualities/copies | Evaluate each physical representation; only mark the title/episode reclaimed when no playable representation remains. Shared paths require all affected entries to qualify. |

All users starts its deadline when the last eligible user finishes; Selected user uses that
account's completion; Any user starts when the first eligible user finishes. Repeated played
notifications do not restart the window. Recompute from current authoritative state after an
unwatched change; if no user satisfies the chosen mode, remove eligibility. These timer semantics
and the protection defaults above must be covered together, including access membership changes.

Watched-user mode and exemptions are retention policy, not a replacement for Jellyfin's
per-user played/favorite/resume state. Do not copy one user's completion into another user's UI.
Persist only the minimum completion/policy evidence needed for deadlines and recovery. Before
native deletion, verify how required per-user state remains available for file-less cards;
if a plugin snapshot is required, scope it by user and never expose another user's state.

**Proposed (review 2026-09-18, not user-approved):** These clarify the table above without
changing its rows or the accepted watched-user modes. See
[`REVIEW-2026-09-18.md`](REVIEW-2026-09-18.md).

- Grace starts no earlier than the time the current representation was first bound, so
  re-acquired or re-bound media never inherits an old deadline or old observations (T7;
  plugin-retention-policy#1, critical, verified; plugin-retention-policy#2, high, verified).
- Observations aggregate across all versions of a target: resume or favourite on any version
  protects every version (T8; plugin-retention-policy#4, medium, verified).
- Stacked multi-part movies and multi-episode files are blocked from retention (T16;
  critic-journeys#4, medium, verified; critic-gaps#2, medium, single-source).
- A favourite series is persisted as a protection in evaluations, not only applied in the preview
  (T11; plugin-retention-policy#6, medium, single-source).
- State explicitly that an offline or sync report of a later `datePlayed` on an already-played
  item is a repeated played notification and does not start a fresh window. This documents current
  behaviour, which the review confirmed is intended (plugin-retention-policy#8, refuted).

**Open question for the user (review 2026-09-18):** The accepted All users default and its
library-access rule stay as written. Should All users count only users who can actually see the
item under parental-rating or tag restrictions, and should it remain the default
(plugin-retention-policy#5, medium, single-source)? Should a transient block (another user's brief
playback, a favourite toggle, a new user, access errors) preserve the existing grace start instead
of restarting the full window (plugin-retention-policy#9, low, single-source)? Should favourite
seasons protect their episodes, as favourite series already do? T11 consumes all three answers.

## Entry gates

1. Phase 2 passes binding, multiple-copy, storage-uncertainty and user-access acceptance.
2. Implement the accepted three-mode watched-user setting; confirm proposed episode/placeholder
   behavior before enabling deletion.
3. Inspect the pinned server's user-data/playback events and deletion API behavior. Prove
   exact file, sidecar, version-group and user-data effects before choosing the delete path.
4. Identify torrent-managed paths and verify how seed goals can be checked. Phase 4's
   acquisition driver does not exist yet: Phase 3 needs a small read-only seeding adapter
   for the actual configured client, or must skip media whose seeding status is unknown.
   Do not require the full acquisition stack and do not guess the installed client.
5. Isolated writable fixture storage must be separate from production mounts. Existing
   production media stays read-only in the test container. Back up the plugin DB and prove
   restore; database restore cannot restore deleted files.

## Execution plan

| Order | Task | Ownership | Acceptance |
| --- | --- | --- | --- |
| T1 | Policy and completion evidence | Plugin data/services, migrations | Two users, duplicate/out-of-order events, unwatched/replay, restart, baseline grace and access changes |
| T2 | Retention preview and protection checks | Plugin services/admin settings | Deterministic due/blocked candidates, per-file reasons, favorites, sessions/resume, seeds, versions and storage uncertainty |
| T3 | Recoverable reclamation executor | Plugin filesystem/native-library integration | Real disposable-file deletion, failures, restart recovery, correct bindings/history and physical-space accounting |
| T4 | Daily task and admin controls | Plugin host integration/settings/API | Enabled/disabled/manual invocation, cancellation, overlap, Keep race and permission enforcement |
| T5 | Countdown, Keep and reclaimed presentation | Web feature files and narrow existing mounts | Desktop/mobile/TV, detail/history, due filter, no dead Play/Continue Watching actions or focus loss |
| T6 | Isolated acceptance and release gate | Plugin/web integration | Full policy-to-filesystem-to-browser flow, migrations/restore and regression evidence |

T1 and the deletion/seeding evidence spikes can run independently. T3 depends on T2 and
the evidence gates; T5 can develop against preview DTOs while the executor is validated.
Use separate `jellyfinmod-phase3` branches/worktrees based on accepted Phase 2 revisions.

### T1 — model policy and completion

Reuse library-scoped entries and stable episodes. Add explicit policy values such as
inherit / days / never: current nullable `ReclaimAfterDays` means inherit and cannot also
mean Keep. Migrate existing null values as inherit without silently enabling retention.

Persist per-user completion observations and the policy version/evidence behind a deadline.
Subscribe through the supported pinned host lifecycle, covering both playback completion
and manual watched/unwatched changes. Callbacks enqueue work; processing re-reads current
native state. A repair pass catches missed notifications after downtime. Missing metadata,
user data or access information produces a blocked candidate, never an assumed completion.

#### T1 acceptance checkpoint — 2026-09-16

T1 is complete on `jellyfinmod-phase3`. The plugin now persists the disabled-by-default
All/Selected/Any policy, explicit inherit/days/never entry policy, authoritative per-user movie and
episode observations, and access-aware evaluations with policy revision, anonymous access-set
fingerprint, completion basis, grace start and deadline. User-data, configuration and user-policy
events are queued and re-read outside Jellyfin callbacks; the repair task recovers missed events and
recomputes evaluations. T1 has no deletion path.

The real SQLite/event integration covers two users, duplicate completion, replay/resume, unwatched,
missing evidence, favorite protection, Keep, per-entry days, selected-user validity, access changes,
deadline non-shortening, re-enable baseline grace and restart. All Phase 0–3 suites pass. Applying
the eighth migration to a copy of the isolated database preserved 163 entries, 160 bindings, 22
episodes and 224 completion observations with clean integrity and foreign-key checks.

On the isolated native host, real watched/unwatched/favorite events updated only the affected row.
The repair task produced 224 observations across 56 targets and four users. Browser configuration
persisted all modes and the selected-user picker across reloads. Selected and Any scheduled the
disposable R4 movie after `oleksii` completed it; All waited for the remaining accessible users.
The fixture finished unwatched and unfavorited. Retention was restored to disabled/All users, all 56
evaluations returned to `retention_disabled`, and production remained untouched.

**Correction (review 2026-09-18):** The "real SQLite/event integration" above used stubbed
`IUserManager`, `IUserDataManager` and `ILibraryManager`; only SQLite was real. Native user-data
events were covered only by the manual live run (tests-contract#2, medium, verified). On Jellyfin
10.11.11 `OnUserUpdated` fires only on rename, so policy, access, user creation and deletion
changes are picked up only at the next full evaluation; the access-change test raised the event
from a stub (plugin-retention-policy#3, medium, single-source; T11). Missing observations block Any
and Selected modes until a manual repair, and the repair task has no trigger (prior-H1, high,
verified; T8).

### T2 — preview before deletion

One evaluator supplies both admin preview and execution. Return eligibility, deadline,
status and stable reason codes; hide other users' identities and activity from ordinary
users. Detailed physical-path diagnostics are admin-only and credentials never appear.

Resolve current native bindings, all representations, canonical paths and library ownership.
Handle symlinks, shared paths across libraries and physical identity/hardlinks explicitly.
Check active playback, resume, Keep, favorite exemption, completion policy, storage access
and torrent seed goals. Unknown/unreachable client state blocks affected candidates.
Classify verified non-torrent media explicitly; missing client configuration is not proof.

#### T2 acceptance checkpoint — 2026-09-16

T2 is complete on `jellyfinmod-phase3` through plugin commit `de971f7`. The admin-only
`GET /JellyfinMod/Retention/Preview` route runs the T1 evaluator and returns every physical
movie version and episode representation with stable state/reason codes, deadlines, logical
bytes, hardlink count and sanitized seed evidence. It has no deletion path. Ordinary users
receive 403 and anonymous requests receive 401.

The shared preview/execution evaluator now blocks missing or changed storage, missing native
bindings, final and parent symlinks, path-identity replacement, active sessions, resume/favorite/
Keep policy, favorite parent series, incomplete torrents, unmet or unbounded seed goals,
unreachable/unconfigured Transmission state, and shared physical files unless every affected
catalog target qualifies. A complete Transmission file index is required before a path is
classified as a non-torrent. The read-only Transmission 4.x adapter follows its 409 session
handshake and the configured global/per-torrent ratio or idle goal semantics.

The ARM64 Linux integration uses real Kestrel auth, HTTP Transmission responses, SQLite,
hardlinks and canonical paths. It covers multiple movie versions, cross-library shared files,
storage replacement, final/parent symlinks, series favorites, active playback, ratio and idle
goals, paused/incomplete/unbounded torrents and an unreachable client. All prior Phase 0–3
integration suites remain green.

The first isolated deployment exposed a Pi ARM64 native-interop crash during file inspection.
`de971f7` replaced marshalled `statx` structs with the kernel's fixed 256-byte buffer and skips
physical scans when no representation is due. A disposable Pi hardlink then returned link count
2 and 4096 logical bytes. The isolated server remained healthy with zero restarts, its container
reached the configured Transmission endpoint, and the real admin preview accounted for all 56
representations as retention-disabled. Browser save/reload preserved the seed endpoint with
blank optional credentials and retention disabled. Production was untouched.

**Correction (review 2026-09-18):** The "real Kestrel auth" integration used a custom test
authentication scheme mapped to an admin role (tests-contract#2, medium, verified). The Transmission
index is marked incomplete by normal `.part` files, an enabled incomplete-dir or unwanted files,
which blocks every non-torrent candidate with `seed_state_unknown` (plugin-retention-safety#4,
medium, verified; T17). Active-playback protection compares `NowPlayingItem.Id` only, so playback
of an alternate version is missed (prior-M6, medium, verified; T8). Favourite-series protection
exists only in the preview, not in persisted evaluations (plugin-retention-policy#6, medium,
single-source; T11).

### T3 — reclaim safely and recover after interruption

Create a durable operation record before the irreversible filesystem action. Serialize
conflicting retention/reconciliation operations and revalidate the policy version, path
identity, active sessions and protection checks immediately before each deletion. A Keep
or disable change received before deletion begins wins; never promise rollback after unlink.

Delete only the verified representation using a pinned-host deletion path whose effects were
proved in the spike. Never recursively delete a library, series, season or download directory.
Define required sidecars and alternate-version effects explicitly. Do not issue torrent
removal/data deletion as an implicit part of reclaiming a library representation.

Filesystem and SQLite changes are not one transaction. Persist intent/outcome and recover
interrupted operations by inspecting reality. A successful retention operation produces one
`reclaimed` history event; failed/blocked attempts are not successes. Attribute subsequent
scan notifications to that operation so Phase 2 does not also emit `media_missing` for it.
Partial failures preserve surviving bindings and record what actually happened.

Measure logical bytes unlinked separately from physical bytes released. A remaining hardlink
means no claimed reclaimed space for that inode; open handles and filesystem accounting may
delay or prevent reliable measurement. Report unknown rather than claiming nominal size.

#### T3 acceptance checkpoint — 2026-09-16

T3 is complete on `jellyfinmod-phase3` through plugin commit `698f1d9`. Every physical unlink
now has durable prepared, unlinked and terminal operation states containing the policy revision,
library and binding identities, canonical path, device/inode identity, logical size and hardlink
count. Recovery inspects the current mount and inode before deciding whether to resume an unlink
or finish catalog reconciliation. It never treats unavailable storage as a successful deletion.

Execution uses the T2 preview evaluator again immediately before unlink while holding the same
per-library locks as reconciliation. Keep, disable, active playback, changed seed state, changed
policy, changed storage, replaced files and newly observed cross-library bindings therefore stop
the operation. Exact-path bindings that are all eligible share one physical action and retain
per-entry binding/history outcomes. Surviving versions remain selected and playable; a title or
episode becomes `reclaimed` only after its final playable binding is gone. Reconciliation sees
that provenance and does not add a duplicate `media_missing` event.

The executor calls `File.Delete` only for the verified canonical media file. It then removes the
native Jellyfin item with both file-location and external-provider deletion disabled. NFO,
subtitle and other neighboring files are not recursively removed, and Transmission receives no
mutation. Logical bytes are recorded per operation action; a pre-unlink hardlink count above one
records zero physical bytes released, while a final link remains unknown rather than claiming its
nominal length.

The ARM64 Linux integration uses real files, hardlinks, SQLite transactions and restart recovery.
It covers interruption before and after unlink, retry idempotency, inode replacement, Keep and
disable races, alternate versions, cross-library same-path bindings, exactly-once reclaimed
history, preserved sidecars and physical-space accounting. All Phase 0–3 integration suites pass,
and EF reports no pending model changes.

The isolated Pi deployment created a pre-T3 backup at
the isolated state directory's `backups/p3-t3-pre-698f1d9`, applied migration
`20260916120000_PhaseThreeRetentionOperations`, passed SQLite integrity/foreign-key checks and
remained healthy with zero restarts. A disposable movie file was unlinked while its NFO and
subtitle remained; after a real isolated library scan, a playable-only Movie/Episode/Video query
returned zero items. The disposable folder was then removed. The reusable ARM64 build cache lives
under the isolated state directory's `build/{p3-t3-src,nuget,dotnet-tools}`. Production was
untouched.

**Correction (review 2026-09-18):** Recovery after unlink was proven only by calling
`RecoverAsync` directly from the suite; the production runner never calls it, so the post-unlink
and missing-file recovery branches are unreachable from the task and `POST /Retention/Run`
(plugin-retention-safety#1, high, verified; T9). Cancellation after the unlink still applies to
persistence, which can leave the file unlinked but the operation, binding and history unrecorded
(plugin-retention-safety#2, medium, single-source; T9). The reconciliation claim holds for movies,
but when a series' last episode is reclaimed the next scan writes `media_missing` and sets the
series to `none` (plugin-reconciliation-data#4, medium, single-source; T14). Stacked multi-part
movies lose only part one (critic-journeys#4, medium, verified; T16). The unlink is path-based
after verification, not pinned to the verified directory chain (plugin-retention-safety#6, low,
verified; T12). Host paths in this checkpoint were redacted (critic-invariants#5, low,
single-source).

### T4 — automatic task and API contract

Use the existing plugin settings and native scheduled-task surface. Run daily in bounded
batches, serialize overlapping runs, and honor cancellation between physical operations.
Check enabled state at task entry and before every destructive operation. Report inspected,
eligible, blocked, reclaimed, failed and interrupted counts with separate space metrics.

Finalize DTOs before web work. Proposed additions under `/JellyfinMod/Entries`:
retention summary on entry/episode detail, admin-only Keep, and admin preview/task status.
Use existing configuration surfaces for global settings; avoid a second settings system.
Keep must be idempotent, write history only on change, and protect all child episodes for a
series. Reject ordinary-user writes at the API even if controls are hidden in the UI.

T4 is complete on `jellyfinmod-phase3` through plugin commits `ccd05dc` and `fb4a66b`. The
native `JellyfinModRetentionReclamation` task runs daily at 03:00 in batches of at most 25 exact
physical paths. Automatic and manual runs share a non-waiting run gate, persist terminal counts
and separate logical/physical space metrics, and honor cancellation between physical actions.
The live XML setting is synchronized at task entry, before each action and inside the executor
immediately before unlink; disable or policy-version changes block the operation.

The finalized camelCase API adds administrator-only manual run/latest status and idempotent Keep,
plus privacy-safe entry/episode retention summaries. The real HTTP suite rejects ordinary-user
Keep, proves one history record across repeated admin requests, series-wide child protection,
409 overlap, cancellation/restart recovery, a disabled no-op run, and a disposable hardlink run
with separate logical and physical accounting. All five integration executables pass on the
ARM64 .NET 9 container, and EF reports no pending model changes.

The isolated deployment created backup
the isolated state directory's `backups/p3-t4-pre-ccd05dc`, uses build source
the isolated state directory's `build/p3-t4-src`, and applied migration
`20260916130000_PhaseThreeRetentionRuns`. Live acceptance on port `18096` found the task idle with
its daily trigger, Health ready, SQLite integrity clean, and a disabled manual run with zero media
changes. The installed DLL matched the validated build checksum, the container remained healthy
with zero restarts, and production was untouched.

**Correction (review 2026-09-18):** "Honor cancellation between physical actions" does not hold
after the unlink: persistence steps still take the caller's token (plugin-retention-safety#2,
medium, single-source). `POST /Retention/Run` is bound to HTTP request cancellation (prior-M10,
low, verified). A crashed run stays `running`, and Runs/Latest reports it as active
(plugin-retention-safety#8, low, single-source). An undeletable due file stays due, is retried
first every run, and 25 such files can starve the batch (critic-invariants#2, medium,
single-source). The suite's cancellation/restart recovery called recovery directly
(plugin-retention-safety#1, high, verified). T9 covers all of these. Host paths above were
redacted (critic-invariants#5, low, single-source).

### T5 — integrate the existing UI

Show the precise schedule or exemption/blocked state on details; use ordinary-language
messages without other users' private activity. Keep is admin-only and remains focused
after success. Reuse feature-local `jfmod-` styling, stock indicators and established routes.

Hide countdowns when disabled, kept or blocked, and update them when policy changes.
The Due within 7 days filter uses the same server eligibility data. Reclaimed entries retain
metadata/history and bookmarks; no playable action may target a removed native item or plugin
ID. Preserve valid Continue Watching items, and remove dead resume actions only after confirmed
loss. Reacquisition is Phase 4+: do not expose a working Get again action in Phase 3.

#### T5 acceptance checkpoint — 2026-09-17

T5 is implemented on `jellyfinmod-phase3` and `jellyfinmod-phase3-web` through plugin commit
`81c1aae` and web commits `8d3d692b96`, `eee632795a` and `f31d0b8653`. Combined browse and
entry/episode detail return the privacy-safe retention summary used by the executor. The built UI
shows scheduled, blocked, disabled and kept states, hides countdowns unless an authoritative
scheduled deadline applies, and adds the persisted **Due within 7 days** filter. Keep is
administrator-only and remains the same focused control while its request completes.

The isolated browser passed native routing, seasons, History, Keep focus/state refresh,
failed-add focus and search-scope isolation at desktop, mobile, 1920×1080 TV and 1280×720 TV
layouts. This is layout emulation, not physical-TV evidence. The live gate found one remaining
issue: the built File filter section did not appear even though combined browse data was
available. Its fix and final verification belong to T6 and must pass before Phase 3 closes.

**Correction (review 2026-09-18):** The TV-layout passes above did not cover library filters. The
legacy/TV filter dialog has no File or **Due within 7 days** options, and its string-encoded
filters break combined browse (web-library-search-details#1, high, verified; PHASE1 W8).
Per-episode retention is not visible on on-disk series (web-library-search-details#5, medium,
single-source). Native-ID bookmarks spin forever after a reclaim, and only `entryId` bookmarks were
tested (critic-journeys#2, medium, single-source). Reclaimed episodes render as "Missing"
(tests-contract#7, medium, single-source); T14 covers these three. History and the entry-detail
controls are not D-pad operable (critic-journeys#6, low, single-source;
web-library-search-details#9, low, verified; T19). The reasons shown to ordinary users leak other
users' favourite and resume state (plugin-authz-entries#3, medium, single-source; T15).

### T6 — isolated acceptance and release gate

T6 is the final task of **Phase 3**. It adds no product feature. It combines the completed plugin
and web work on `jellyfinmod-test`, then decides whether Phase 3 is safe to close. Production is
not a T6 deployment or test target.

Release gates:

- [x] Run all five Phase 0–3 integration executables on ARM64 Linux with package networking
  disabled, including real SQLite, HTTP auth, files, hardlinks and Transmission boundaries.
- [x] Prove the EF model matches the committed migrations.
- [x] Create a readable isolated database backup; verify integrity, foreign keys, preserved IDs,
  history, operations and migration records from a restore copy.
- [x] Verify the live daily task is installed and a disabled manual run changes zero media.
- [x] Verify native details, seasons, History and Keep across desktop/mobile/TV layouts, including
  focus remaining on Keep after success.
- [x] Verify the live File filter exposes **Due within 7 days**, uses server eligibility and keeps
  the grid stable for an empty result.
- [x] Verify scheduled countdown boundaries and that disabled, blocked and kept entries show no
  countdown.
- [x] Verify an ordinary user has no Keep control, old bookmarks still resolve, reclaimed entries
  have no dead Play/Continue Watching action, and valid native playback remains unchanged.
- [x] Record final plugin/web checksums, test paths and URLs, push the evidence commits, then remove
  the Phase 3 worktrees while preserving their branches.

**Correction (review 2026-09-18):** The gates above stay checked as recorded. The push gate
stands: local tracking refs suggested the branches were ahead of origin, but a read-only
`git ls-remote` during the review showed `jellyfinmod-phase3` at `81c1aae` and
`jellyfinmod-phase3-web` at `c45b7fc588` on origin; the local tracking refs were stale. X2 records
the formal confirmation (tests-contract#9, medium, verified). The integration gate's "real … HTTP auth" overstates what ran: host services and authorization were
simulated with stubs and a test scheme (tests-contract#2, medium, verified). The countdown and
reclaimed-UI gates used reversible hand-seeded database state, not state produced by the evaluator
and executor (plan-ops#1, high, verified). T18 re-runs these gates.

## T6 acceptance evidence — 2026-09-17

T6 ran only on `jellyfinmod-test` at the isolated test instance (port 18096); production was not
changed.
The isolated container finished healthy with restart count zero, retention disabled and the database
restored after every browser fixture.

- The five Phase 0–3 integration executables passed on ARM64 Linux in a `.NET 9` SDK container with
  package networking disabled. They covered real SQLite and HTTP authorization, Jellyfin user-data
  events, disposable files, hardlinks, Transmission boundaries, restart recovery and reconciliation.
- EF reported no model changes after the last migration. Database backup
  the isolated state directory's `backups/p3-t6-final-81c1aae.db` passed integrity and foreign-key
  checks with 163 entries, 160 bindings, 178 history records, three retention runs and ten
  migrations. The reversible browser-fixture backup is
  the isolated state directory's `backups/p3-t6-browser-original-81c1aae.db`.
- The live daily task was present. A disabled manual run inspected, reclaimed and changed zero media.
- The built browser passed native details, seasons, History and admin Keep on desktop, mobile,
  1920x1080 TV layout and 1280x720 TV layout. Keep retained focus and refreshed to **Kept
  indefinitely**. Physical-TV hardware was not tested in T6.
- The File filter exposed **Due within 7 days**. An empty server-eligible result stayed stable and
  clearing the filter restored the library. Reversible persisted evaluations verified `0d`, `3d`
  and the normal-view `3d`/`4d` boundary; the filtered view showed `4d`. Disabled, blocked and kept
  fixtures showed no countdown.
- Existing ordinary user `nata` saw no Keep control. An old `entryId` bookmark still resolved to
  native details. A reversible reclaimed entry exposed no Play, Resume or Continue action, while
  native item `ba9815a6b64dfb9820639f36f8271a1a` retained its playback action. The original database
  was restored and passed `PRAGMA integrity_check` afterward.
- Installed plugin DLL SHA-256:
  `8e8370fc8ca130004bfe2875a5c7b03f1fc78e3fa176fdc8cfa2381f5890b002`.
  Deployed web `index.html` SHA-256:
  `4531fe62a2716695bb848f4f509f6a268432d3a0481da70b4f45bc6c6b1ac3e1`.
- The release branches are `jellyfinmod-phase3` in `capische/jellyfin-mod` and
  `jellyfinmod-phase3-web` in `capische/jellyfin-web`. The deployed feature commits are plugin
  `81c1aae` and web `ec9f6bedeb`; later web commits add the T6 browser runner and this evidence.

**Correction (review 2026-09-18):** No enabled retention run was ever executed on the live host;
the only live unlink was the disposable T3 movie, before the task existed (plan-ops#1, high,
verified). The first bullet's "real … HTTP authorization, Jellyfin user-data events" describes
suites that simulated host services and authorization (tests-contract#2, medium, verified). The
browser runner takes expected states from environment variables, checks Keep on desktop only, and
skips checks silently with a zero exit code (tests-contract#6, medium, single-source). The review
examined web `c45b7fc588`, the evidence commit that follows the deployed feature commit
`ec9f6bedeb`. The host URL and backup paths above were redacted (critic-invariants#5, low, single-source). T18
supplies the missing live evidence.

## Required integration and E2E matrix

- Real HTTP/auth/SQLite and native user-data events for two users: default All users waits for
  both, Selected user uses only the configured account's completion, and Any user starts on the
  first completion. Cover manual completion, replay, missing evidence, mode/account/access
  changes, per-episode completion, favorites and Keep.
- Real disposable files for one copy, multiple versions, cross-library shared paths,
  hardlinks, symlink escape rejection, unreadable roots and replaced files before deletion.
- Seeding below/above ratio and time goals, paused/incomplete torrents and unreachable client;
  prove the exact configured goal semantics before permitting deletion.
- Disabled daily/manual runs delete nothing; concurrent task invocation, Keep and disabling
  during a batch; interruption before/after unlink and restart recovery without duplicate history.
- Reconciliation preserves `reclaimed` provenance, surviving copies and correct episode/series
  availability. Database migration and restore preserve IDs, policy and history.
- Built browser on the isolated instance: countdown boundaries, detail, due filter, admin and
  restricted user, Keep, history, old bookmarks and native playback on desktop/mobile/TV.
- Report physical-TV evidence separately from desktop TV-layout emulation.

**Correction (review 2026-09-18):** Mid-batch disable and Keep, unreadable roots, reconciliation
after reclaim, the scheduled-task entry point and seed time goals have no automated coverage
(tests-contract#4, medium, single-source). For Transmission the "time goal" is the idle limit
(ratio/idle), because Transmission has no seed-time limit. The first item's native user-data
events were satisfied only by the manual live T1 run (tests-contract#2, medium, verified). T18
adds these cases.

Use boundary fixtures where external conditions must be controlled, plus the actual isolated
host and browser for acceptance. No unit tests. Production files are never deletion fixtures.

Phase 3 is complete when eligible disposable media expires automatically with recoverable,
accurate outcomes and every protection case survives, while catalog history, access isolation
and the existing playback experience remain correct.

**Correction (review 2026-09-18):** This criterion ("eligible disposable media expires
automatically") has no live evidence yet: no enabled retention cycle ran on the isolated host
(plan-ops#1, high, verified). T18 provides it.

## Review remediation — 2026-09-18

**Proposed (review 2026-09-18, not user-approved):** Phase 3 is implemented. Its checkpoints and
checked gates above stay as recorded, with correction notes where
[`REVIEW-2026-09-18.md`](REVIEW-2026-09-18.md) contradicts them. The review examined plugin
`81c1aae` and web `c45b7fc588`; none of the fixes below exists on this branch yet. Automatic
retention stays disabled on non-disposable media until the blockers pass.

**Correction (review 2026-09-18):** Correction notes now sit under the T1–T5 checkpoints, the T6
release gates, the T6 evidence, the integration matrix and the completion paragraph. The host URL
and state-directory paths in T3, T4 and T6 were redacted (critic-invariants#5, low, single-source;
PLAN X6).

**Proposed (review 2026-09-18, not user-approved):** The blockers are T7, T8, T9, T10 and T18.
Selected user mode on real media also waits for T13. Verify T16 before enabling retention on a
library that contains multi-episode files or stacked multi-part movies. The related Phase 4
entry-gate proposal requires the same blockers before acquisition work is deployed
([`PHASE4.md`](PHASE4.md#entry-gates-and-dependencies)).

**Proposed (review 2026-09-18, not user-approved):** Land T7 before T8. T8 completes evidence from
live user data without a manual repair; without T7's grace floor, that would make immediate
deletion of newly bound or re-acquired media the normal path (plugin-retention-policy#2). T7 and
T10 depend on PHASE1 P7, the carry-forward of phase1 commit `fba11e3`, which is not on the phase3
or phase4 lines. T7 and T9 depend on PLAN X1. T18 is the Phase 3 re-acceptance and runs last.
Commit each task under its ID, for example `fix(retention,p3.t7)`.

**Proposed (review 2026-09-18, not user-approved):** Acceptance uses only two boundaries.
Real-host integration runs on the isolated test instance (port 18096) with real HTTP, Jellyfin
authentication and authorization, serialization, migrations and SQLite, using disposable fixtures
in the isolated writable library. Built-browser E2E runs on the same instance in desktop, mobile
and TV layout (`localStorage.setItem('layout','tv')`) at 1920×1080 and 1280×720, driven by arrow
keys, Enter and Back. Sign in as `oleksii` with an empty password. TMDB and Transmission are
controlled through real HTTP boundary servers. Physical webOS evidence is reported separately
from emulation. Stubbed or DispatchProxy host services, builds, lint and type checks are
supporting evidence only, and hand-seeded database state is not acceptance evidence. No unit
tests. Retention is enabled only for disposable targets and restored to disabled afterwards.

**Open question for the user (review 2026-09-18):** Besides the three questions under Product
decisions, this work depends on the PLAN.md open questions on the safety gate itself, quarantine
or soft delete before unlink (T9, T12), entry Remove when native bindings exist (T10), Keep
reversal (T13) and the Phase 4 download client (T17). None is decided.

### T7 — reset retention state on reclaim or unbind and floor grace at the current representation's binding time

**Priority** blocker · **Depends on** X1, P7 · **Findings** plugin-retention-policy#1 (critical,
verified), plugin-retention-policy#2 (high, verified), plugin-reconciliation-data#1 (medium,
verified)

A reclaimed or unbound target keeps its scheduled evaluation and completed observations, so
re-acquired or re-bound media is due immediately. A target's first evaluation can also take grace
from `EnabledAt` and a years-old native `LastPlayedDate`. When the last representation of a target
is reclaimed or unbound, reset its evaluation and mark its observations stale in the same
transaction, and record when the current representation was bound. Count completion only after
that baseline, because Jellyfin 10.11.11 can reattach old user data to a re-added item, and ignore
observations whose native item is not a current binding. A never-scheduled target starts grace no
earlier than its binding time and the evaluation time. An entry recreated by reconciliation after
Remove gets the same floor. Exclude unbound targets from **Due within 7 days** and from series
summaries.

**Acceptance** — real host on the isolated test instance with disposable media and retention
enabled for the disposable targets only:

1. Use Any user mode and then All users mode, with a 1-day window. Reclaim a disposable movie
   through the native task, copy the file back and scan. Preview after reconciliation reports the
   title not due, with deadline ≥ rebind time + window, including after running the evidence
   repair task.
2. A newly bound disposable item whose native `LastPlayedDate` predates `EnabledAt`, followed by an
   immediate repair run, gets a deadline ≥ now + window.
3. After its episodes are reclaimed, a series no longer appears under **Due within 7 days** and its
   summary ignores reclaimed rows. Check through HTTP and the built browser.

This must land before T8's live-read change.

### T8 — revalidate live Jellyfin user state immediately before unlink and complete evidence without a manual repair run

**Priority** blocker · **Depends on** T7 · **Findings** critic-invariants#1 (high, verified),
prior-H1 (high, verified), plugin-retention-policy#4 (medium, verified), prior-M6 (medium,
verified)

The executor's last check reads stored observations only, so a dropped favourite or unwatched
event can let a protected file be deleted. Conversely, a missing observation blocks Any and
Selected mode until a manual repair, and the repair task has no trigger. Inside the executor lease,
after the policy re-check and before the unlink, read live user data for every eligible user across
every version of the target and block with a stable live-state reason on favourite, resume or
unplayed. Fill missing observations from live user data instead of blocking, and give the repair
task a default trigger. Aggregate observations per target so resume or favourite on any version
protects. Treat an active session on any member of a binding's version group, including
`PlayState.MediaSourceId`, as protecting the whole group.

**Acceptance** — isolated test instance, disposable media, no database edits:

1. In Any and Selected modes, a second user never touches the movie, and it is scheduled without a
   manual repair.
2. Disable JellyfinMod in the Dashboard and restart. Mark a due disposable movie as favourite, and
   separately as unwatched, through the Jellyfin API. Re-enable the plugin, restart and trigger the
   native task. The executor blocks with a stable live-state reason and the file survives.
3. A second user playing alternate version B of a grouped disposable movie in the built browser
   blocks reclaim of every version.
4. Two versions carrying conflicting per-version user data aggregate to protected.

### T9 — wire crash recovery into the runner, make post-unlink persistence non-cancellable and record terminal outcomes honestly

**Priority** blocker · **Depends on** X1 · **Findings** plugin-retention-safety#1 (high,
verified), plugin-retention-safety#2 (medium, single-source), plugin-retention-safety#3 (medium,
single-source), critic-invariants#2 (medium, single-source), plugin-retention-safety#8 (low,
single-source), prior-M10 (low, verified)

The runner never calls recovery, so a prepared or unlinked operation stays open forever and the
entry later receives `media_missing`. Run recovery at the start of each run under the run gate,
before the Due check, locking the operation's own libraries, and persist a terminal state when a
prepared operation no longer revalidates. Move the last cancellation check to just before the
unlink and make every later persistence and native-removal step non-cancellable. A prepared file
that vanished without evidence of the plugin's unlink ends in a terminal `vanished` state; only
`ENOENT` counts as absent. Whether to add a quarantine step is an open question. Block unwritable
media with `media_not_writable` before preparing, and deprioritise recently failed bindings. Mark
dead `running` rows `interrupted`. `POST /Retention/Run` queues the native task instead of binding
to the request.

**Acceptance** — isolated test instance; runs are triggered through `/ScheduledTasks/Running/{id}`
and `POST /JellyfinMod/Retention/Run`:

1. Cancel the task or stop the container during a run over a large disposable file. The next run
   finishes the operation with exactly one `reclaimed` history event, no `media_missing`, and the
   entry reclaimed.
2. A prepared operation whose file was removed externally ends in a terminal `vanished` state, with
   no reclaimed history and no bytes counted.
3. Unlinked operations whose native item or binding is already gone complete.
4. A non-writable disposable directory yields a blocked `media_not_writable` without preparing. 26
   such files do not starve writable due items.
5. A killed run shows `interrupted` in Runs/Latest after restart.
6. `POST /Retention/Run` queues the native task (202), and a client disconnect does not cancel it.
7. `Interrupted` counts only resolved actions.

### T10 — make catalog Refresh and Remove unable to erase retention intent, operations or Keep

**Priority** blocker · **Depends on** P7 · **Findings** prior-H2 (medium, verified),
plugin-authz-entries#1 (medium, verified), prior-M1 (medium, verified),
plugin-reconciliation-data#1 (medium, verified)

Refresh resets series availability, ignores bindings, holds no lock and, on this line, still
deletes episodes missing from the TMDB snapshot, cascading their bindings, evaluations and
retention operations. Remove races retention and cascades away operations; reconciliation then
recreates the entry without its Keep. Make Refresh metadata-only (the episode-deletion part is
carried forward by P7), leave availability to reconciliation, and run it under
`RetentionExecutionGate` and the library lock. Change the `RetentionOperation` foreign keys to
`Restrict`/`SetNull` with a migration. Remove takes the same gate and lock, returns 409 while
operations are open, and handles native bindings according to the user's answer on entry Remove.

**Acceptance** — real host on the isolated test instance:

- Refresh is metadata-only and runs under `RetentionExecutionGate` and the library lock. A
  disposable series with reclaimed episodes keeps its episode states and does not flip to
  `onDisk`.
- The migration changing `RetentionOperation` foreign keys to `Restrict`/`SetNull` is applied to a
  copy of the isolated database and passes integrity and foreign-key checks.
- Remove returns 409 while operations are open, and while native bindings exist unless the
  tombstone option is chosen (open question). The built browser shows the 409 message.
- Keep a disposable movie, attempt Remove, scan, run repair, then run an enabled task. Nothing is
  deleted and Keep persists.
- A Remove racing an active run can never be followed by an unlink.

### T11 — improve evaluation fidelity: access and user events, item-level eligibility, persisted series favourites, serialized writers and quiet progress events

**Priority** medium · **Depends on** T7, T8 · **Findings** plugin-retention-policy#3 (medium,
single-source), plugin-retention-policy#5 (medium, single-source), plugin-retention-policy#6
(medium, single-source), plugin-retention-policy#7 (low, verified), prior-M8 (low, verified),
plugin-retention-policy#9 (low, single-source)

Consume user created, deleted and updated events, and periodically fingerprint active users and
their accessible libraries, because policy edits raise no event on 10.11.11. Move the
favourite-series check into the evaluator, persist `blocked/favorite_series`, react to series
user-data saves, and block when the series item cannot be resolved. Serialize observation and
evaluation writers behind one gate, or use upserts. Skip playback-progress refreshes that change
nothing except the position, while keeping the first one that creates resume protection, and save
evaluations only on change. Item-level eligibility for All users, grace-start preservation and
favourite seasons follow the user's answers to the open questions under Product decisions.

**Acceptance** — real host on the isolated test instance:

- Changing a user's library access through `POST /Users/{id}/Policy`, and creating or deleting a
  disposable user, re-evaluates affected targets within a bounded interval without a preview
  call.
- A favourite series persists `blocked/favorite_series` in the evaluation, the built-browser detail
  shows it, and it is excluded from **Due within 7 days**.
- A repair run concurrent with listener activity and a Keep click produce no UNIQUE failure and no
  500.
- Sustained playback progress leaves observation and evaluation rows unchanged after the first
  update.
- Item-level eligibility and grace-start semantics follow the user's answers to the related open
  questions, with a restricted-user fixture.

### T12 — pin the unlink to the verified directory chain, recheck the binding set at execution, and revalidate each action with targeted checks

**Priority** medium · **Depends on** T9 · **Findings** plugin-retention-safety#6 (low, verified),
plugin-retention-safety#7 (low, single-source), prior-H6 (medium, verified),
plugin-retention-safety#3 (medium, single-source)

The unlink re-resolves the verified path, so a parent-directory swap or same-name replacement in
the short window after the check could redirect it. Walk from the canonical library root with
directory file descriptors opened without following symlinks, compare device and inode before
`unlinkat`, and treat an inode mismatch as a replacement. A quarantine rename is added only if the
user approves it. In the prepared-execution path, recompute the same-path and physical-identity
groups, block with `binding_set_changed` when they differ from the operation's bindings, and lock
every library whose roots contain the path. Replace the repeated full previews per action with
targeted revalidation and change-only evaluation writes, so Keep and reconciliation wait less.

**Acceptance** — ARM64 real-file fixtures plus the isolated test instance:

- A parent-directory symlink swap between the check and the unlink cannot redirect the unlink
  (`openat`/`unlinkat` on pinned directory file descriptors).
- A same-name replacement is detected by inode mismatch; quarantine only if the user approves it.
- A binding added after prepare, from an overlapping disposable library, blocks with
  `binding_set_changed`.
- One batch on the Pi uses at most one full preview per action, with timing recorded.
- A Keep issued between two actions of a live batch wins.

### T13 — make retention settings safe for an unavailable Selected user and make Keep and per-entry days editable

**Priority** high · **Depends on** — · **Findings** critic-gaps#4 (medium, single-source),
prior-M9 (low, verified)

When the stored Selected user is disabled or deleted, the Dashboard select falls back to the first
enabled user, and any later save silently switches the retention trigger to that user's history.
Show a disabled, selected "Unavailable user" option and keep the stored ID unless the admin
explicitly picks a new user. Add an admin-only un-Keep and per-entry days writer through the API
and the detail UI, under the same gate and lock as Keep, writing history only on change and
restarting grace. Keep itself stays one action with no confirmation, as accepted; the un-Keep and
days editor follow the user's answer on Keep reversal.

**Acceptance** — built-browser Dashboard and detail pages on the isolated test instance:

- In Selected user mode, disable the selected disposable test user. Saving an unrelated field (the
  Transmission URL) leaves `RetentionSelectedUserId` unchanged; an "Unavailable user" placeholder
  is shown and cannot be saved as a new choice.
- Admin un-Keep and a per-entry days change (API, then detail UI via TV D-pad) each write one
  history event per change. The signed-in non-admin receives 403. Grace restarts rather than
  reusing a past deadline.

### T14 — keep reclaimed provenance and presentation truthful across series, episodes, bookmarks and Home

**Priority** high · **Depends on** T7, T9 · **Findings** plugin-reconciliation-data#4 (medium,
single-source), tests-contract#7 (medium, single-source), critic-journeys#2 (medium,
single-source), web-library-search-details#5 (medium, single-source), plugin-browse-discover#8
(low, verified), critic-journeys#5 (low, single-source)

Mark a series entry reclaimed when its last episode binding is reclaimed, and skip `media_missing`
when every lost episode is `reclaimed`. Add `reclaimed` to episode `availability` on the server
and in the web, labelled "Removed after watching". Resolve historical native IDs to their entry,
and on a native 404 redirect to the `entryId` view or show an explicit unavailable state. Render
per-episode retention on native series and episode pages. Retry native cleanup after
`reclaimed_native_cleanup_failed`. Date backfilled entries from native `DateCreated`, and keep
reclaimed titles out of Recently Added.

**Acceptance** — isolated test instance with disposable media:

- An enabled run reclaims every episode of a disposable series, followed by a real scan. The series
  is `reclaimed` with no `media_missing`.
- Episode `availability` is `reclaimed` over HTTP and renders "Removed after watching" in the built
  browser.
- Opening the old native-ID details URL after reclaim, on desktop, mobile and TV, redirects to the
  `entryId` view or shows an explicit unavailable state with the spinner stopped.
- An on-disk series page lists per-episode retention rows, and a native episode page shows its own
  status.
- A forced native-cleanup failure is retried on the next run.
- Reclaimed titles are absent from Recently Added, and Date added sorts by the original native
  date.

### T15 — stop retention summaries leaking other users' activity and keep reclaimed titles hidden from restricted users

**Priority** high · **Depends on** — · **Findings** plugin-authz-entries#3 (medium,
single-source), plugin-authz-entries#2 (medium, single-source)

Ordinary-user detail responses expose reasons and deadlines derived from other users' favourites,
resume positions and completions, and the series aggregate includes hidden episodes. Map reasons to
a public vocabulary for non-admins, omit deadlines they could use to infer another user's activity,
build the aggregate only from readable episodes, and keep configuration reasons admin-only. After
reclaim, visibility falls back to TMDB metadata without tags or native ratings: persist the native
effective rating and tags when binding or reclaiming, and apply `BlockedTags`, `AllowedTags` and the
native rating to file-less entries.

**Acceptance** — real host plus the built browser on the isolated test instance, compared as an
admin and as an existing non-admin user:

- Ordinary-user detail responses map reasons to a public vocabulary. They reveal no favourite,
  resume or completion-derived deadline belonging to another user.
- The series aggregate uses only episodes readable by the requester.
- A disposable title tagged with a `BlockedTags` value, and a custom-rated disposable title, stay
  hidden from the restricted user in Browse, Search and Details after an enabled run reclaims them.

### T16 — block unsupported multi-file representations (stacked multi-part movies, multi-episode files) from retention

**Priority** high · **Depends on** — · **Findings** critic-journeys#4 (medium, verified),
critic-gaps#2 (medium, single-source)

The executor unlinks only a stacked movie's first part, and a multi-episode file binds only its
first episode, so watching that episode could remove content of a later unwatched one. Block a
native video with additional parts as `multi_part_unsupported`. Block multi-episode files, or
reclaim them only when every covered episode is due; binding the covered range belongs to PHASE2
R9.

**Acceptance** — real scans on the isolated writable library:

- Disposable `X-cd1.mkv` and `X-cd2.mkv` with an NFO produce one native item with
  `AdditionalParts`. Preview blocks it with `multi_part_unsupported`, and an enabled run leaves
  both parts.
- A disposable `S01E01-E02` file is blocked, or reclaimed only when every covered episode is due,
  per the documented rule. The later episode's content is never unlinked while that episode is
  unwatched.

### T17 — keep the Transmission file index complete during normal downloads and combine torrent- and file-level completeness

**Priority** high · **Depends on** — · **Findings** plugin-retention-safety#4 (medium, verified)

Normal `.part` files, an enabled incomplete-dir and unwanted files mark the index incomplete, which
blocks every non-torrent candidate with `seed_state_unknown`. Request per-file `wanted` and the
session's incomplete-dir and partial-file settings, probe `name` and `name.part` in both locations,
skip unwanted files that do not exist, and fail closed only for wanted, partly downloaded files
that cannot be found. A file counts as complete only when its torrent is also complete. Report an
incomplete index with its own reason code and count. The Phase 4 download-client question may
change this adapter.

**Acceptance** — HTTP Transmission boundary fixture plus the isolated test instance's own
Transmission (test-only):

- A multi-file torrent with a `.part` file, an unwanted missing file and incomplete-dir enabled
  leaves the index complete, so non-torrent candidates are not blocked with `seed_state_unknown`.
- A finished file inside an unfinished torrent whose ratio meets the goal is not due.
- An incomplete index reports a distinct reason code with a count.
- `GET /JellyfinMod/Retention/Preview` on the isolated test instance while a disposable torrent
  downloads shows no blanket block.

### T18 — run the enabled retention cycle live on disposable media and close the automated-matrix and browser-runner gaps (Phase 3 re-acceptance)

**Priority** blocker · **Depends on** T7, T8, T9, T10, T13, X3, X4 · **Findings** plan-ops#1
(high, verified), tests-contract#4 (medium, single-source), tests-contract#6 (medium,
single-source), tests-contract#2 (medium, verified)

No enabled retention cycle has run on the live host, and the T6 browser evidence used hand-seeded
state. Run the full cycle on the isolated test instance with the plugin revision recorded from
Health (PLAN X4) and deployed with the safe tooling (PLAN X3). Retention must reach only disposable
fixtures, through per-entry days (T13); production mounts stay read-only and no production file is
a fixture. Fix the browser runner and add the missing automated cases to the plugin suites; those
suites are supporting evidence and the live run is the acceptance. Record a new dated checkpoint
below T6; the existing T6 evidence stays as written.

**Acceptance** — on the isolated test instance, with the plugin revision recorded from Health (X4)
and deployed with the safe tooling (X3):

1. Add a disposable movie and a two-episode series to the isolated writable library. Retention
   reaches only them, through per-entry days (T13); production mounts stay read-only.
2. Enable Any user mode, then separately Selected user mode, with a 1-day window.
3. Complete playback as `oleksii` through the built browser or the Jellyfin API, with no database
   edits. Preview schedules both without a repair run.
4. After the window, trigger the native task via `/ScheduledTasks/Running/{id}`. Files are
   unlinked, sidecars kept, one `reclaimed` event is written and run counts are correct.
5. A seeded Transmission fixture below its goal stays blocked.
6. Run the browser runner against this real state. It must check Keep in every layout by keyboard,
   probe `aria-label` and `title`, check the Home resume row, fail on any native request carrying a
   plugin ID, and exit non-zero on skipped gates.
7. Automated cases exist for mid-batch disable/Keep, an unreadable root, reconcile-after-reclaim,
   the task entry point and the seed time goal (the idle limit for Transmission).
8. Retention is restored to disabled afterwards. Physical webOS evidence is reported separately.

### T19 — make entry-detail controls operable by D-pad: History toggle, Monitor via Enter, focus retention and Remove confirmation

**Priority** medium · **Depends on** — · **Findings** web-library-search-details#9 (low,
verified), critic-journeys#6 (low, single-source)

The History `<summary>` is not reachable by spatial navigation, the plain Monitor checkboxes
probably do not toggle on Enter, Monitor and Refresh become disabled while focused, and Remove entry
has no confirmation. Use a focusable History toggle button with `aria-expanded`, an Enter-capable
Monitor control, the Keep `aria-disabled` pattern for Monitor and Refresh, and the stock confirm
dialog for Remove entry.

**Acceptance** — built browser in TV layout at 1920×1080 and 1280×720 on the isolated test
instance, keyboard only:

- History expands through a focusable toggle.
- Monitor toggles with Enter.
- Focus stays on Monitor and Refresh during their requests (`aria-disabled` pattern).
- Remove entry opens the stock confirm dialog, and cancelling keeps the entry.
- Desktop and mobile are unchanged.
