# Phase 3 — automatic retention

Planning draft, 2026-09-11. Implement after Phase 2 acceptance. Read `PHASE1.md`,
`PHASE2.md` and UX §8 alongside this document. This refinement supersedes the older
Phase 3 sketch where it assumed STRM placeholders or a single global watched timestamp.

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

### T2 — preview before deletion

One evaluator supplies both admin preview and execution. Return eligibility, deadline,
status and stable reason codes; hide other users' identities and activity from ordinary
users. Detailed physical-path diagnostics are admin-only and credentials never appear.

Resolve current native bindings, all representations, canonical paths and library ownership.
Handle symlinks, shared paths across libraries and physical identity/hardlinks explicitly.
Check active playback, resume, Keep, favorite exemption, completion policy, storage access
and torrent seed goals. Unknown/unreachable client state blocks affected candidates.
Classify verified non-torrent media explicitly; missing client configuration is not proof.

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

### T5 — integrate the existing UI

Show the precise schedule or exemption/blocked state on details; use ordinary-language
messages without other users' private activity. Keep is admin-only and remains focused
after success. Reuse feature-local `jfmod-` styling, stock indicators and established routes.

Hide countdowns when disabled, kept or blocked, and update them when policy changes.
The Due within 7 days filter uses the same server eligibility data. Reclaimed entries retain
metadata/history and bookmarks; no playable action may target a removed native item or plugin
ID. Preserve valid Continue Watching items, and remove dead resume actions only after confirmed
loss. Reacquisition is Phase 4+: do not expose a working Get again action in Phase 3.

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

Use boundary fixtures where external conditions must be controlled, plus the actual isolated
host and browser for acceptance. No unit tests. Production files are never deletion fixtures.

Phase 3 is complete when eligible disposable media expires automatically with recoverable,
accurate outcomes and every protection case survives, while catalog history, access isolation
and the existing playback experience remain correct.
