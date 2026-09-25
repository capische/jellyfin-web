# Retention delete-path review, fourth pass — 2026-09-25

Adversarial re-verification of the fixes for the third retention delete-path review
([`REVIEW-2026-09-24-retention-3.md`](REVIEW-2026-09-24-retention-3.md), RET3-R1..R8, RET3-N1, decision 12 and the
`database is locked` work) on branch `p10-retention`, before it is merged into plugin `master` and web `jellyfin-mod`
with retention off. Reviewed plugin `p10-retention` at `15589f1` (rebased onto `master` `f443a62`, Jellyfin 12.0.0 and
.NET 10: `b93f605` decision 12, `7fe53c1` review-three fixes and the lock, `30421c2` RET3-N1, `2e90a54` diagnostics
names, `15589f1` merged-version guard) and web `p10-retention` at `3883570a16` (rebased onto `jellyfin-mod`
`a279641ebf`: `8204941858` fail-safe job, `34c079cb94` and `c22c90abb3` driver, `c61e89f56d` wording, docs
`477c6ea8e4`, `d7774d0178`, `3883570a16`). Verifier: Fable, high effort. Verification only: no product code, no
deployment, no instance setting, no fixture and no crontab entry was changed; the only writes were this file and its
commit.

What was checked, and how:

- Code, whole files as of `15589f1`: `RetentionEvaluator`, `RetentionPreviewService`, `RetentionLiveCheck`,
  `RetentionExecutor`, `RetentionEventListener`, `RetentionRunner`, `RetentionCompletionService`, `RetentionEvaluation`
  (`RetentionTargetReset`, `RetentionOverrides`), `RetentionPolicySnapshot`, `JellyfinNativeTitleSource`, `SqliteBusy`,
  `SqliteWriteDiagnostics`, `HistoryRecord`, both new migrations and the model snapshot; the full source diff of the
  five plugin commits and the retarget's diff of `JellyfinNativeTitleSource`; in `ReconciliationService` the absence
  pass, `DetachOrphanVersionKeepsAsync`, `RestartForNewFileAsync`, the movie representation loop and
  `ReconcileEpisodes`; `EntriesController` (`RestartGraceAsync`, `ChangeVersionKeepAsync`, the gated Keep paths),
  `MediaStorageIdentity.IsProvenAbsent`/`IsCurrent`, `CatalogBackfillRunner`'s error handling; the suites'
  decision-12 migration check and the C2 protection check; web `retention-phase-b-cron.sh`, all of
  `retention-live.py`, `RetentionWarning.tsx`.
- Jellyfin server source at tag `v12.0`, fetched from GitHub: `Video.GetAllItemsForMediaSources`,
  `Video.SetPrimaryVersionId`, `Video.RefreshMetadataForVersions`, `VideosController.MergeVersions`,
  `LibraryManager.GetLocalAlternateVersionIds` / `GetLinkedAlternateVersions`.
- Documents: the three `CLAUDE.md`, PLAN (retention and work-queue sections), PHASE10 (§2–§4, §7 decision 12, the
  merged-copy block, both review-fix sections and handovers), REVIEW-3 with its fix record, the user's decision brief,
  the Jellyfin 12 multi-version analysis, the round-3 verification checklist.
- Isolated instance 18096 (Jellyfin 12.0.0), signed in as `oleksii` with an empty password, GETs and one logout only:
  anonymous Health 401; Health `Web.WebCommit c22c90abb3` (clean), bundle `350e27ced474`; `Settings/Retention`
  **disabled**, All users, 14 days, test window 0, revision 37; `Runs/Latest` 00:33:32–00:33:52Z (the RET3 set: inspected
  599, reclaimed 1, failed 0); `Entries?query=JellyfinMod` 0; `Items?SearchTerm=JellyfinMod` 0; libraries Movies
  (`/data5/Movies`) and Shows (`/data5/TV Series`) only. No preview was requested. Retention stayed disabled.
- The 18096 plugin database, read from a private online `.backup` copy made and deleted in one SSH session: migration
  history (`PhaseTenMovieBacklog`, `PhaseTenReviewThreeFixes` applied), `integrity_check` ok, `foreign_key_check`
  empty, all 567 evaluations `disabled` (53 movies, every movie row `RequiresFreshCompletion = 1`), 0
  `retention_rule_changed` rows (the migration found nothing to move), policy revision 46 disabled with
  `FirstEnabledAt 2026-09-24 09:08:18`, 0 `VersionKeeps`, 21 operations all `completed`, fingerprints on all 514
  episode bindings and on the 53 movie bindings (the 105 series-folder bindings have none, as expected for
  directories), no `/test-media` binding and no `JellyfinMod` entry left. Deployed DLL SHA-256 prefix `0ad08f5b323fc784`.
- Pi, read-only over SSH: the user crontab (one line, `p10r2 … 202609251230`), both `env.sh` files (base
  `http://localhost:18096`, state and media roots under the test tree), the `p10r2` state directory (no `STARTED`,
  `DONE`, `FAILED` or `phase-b.log`; `safe.OK` and `entries.json = []` from the manual safe-finish at 22:49Z; the
  `restore.json` it will re-apply says retention disabled, All users, 14 days, test window 0), SHA-256 of the deployed
  wrapper and drivers against the committed files (`p10r3` identical to `c22c90abb3`; `p10r2` is the `8204941858`
  driver as the fix record says).
- Locally from the plugin worktree at `15589f1` with the .NET 10 SDK: `PhaseTwoIntegration`, `PhaseThreeIntegration`
  and `PhaseTenRetentionIntegration` (decision-12 migration check, 600 targets, 3 switch-on rounds, RET3-N1 check) pass
  against temporary SQLite databases built by the full migration chain. The Linux-only suites are taken from the
  verifier's 12/12 Pi run at `15589f1`.

Counts: P1 0 · P2 1 · P3 5 (plus one dismissed-checks entry). The verdict is at the end.

## RET3 findings, re-verified against the code (not the status lines)

| Finding | Verified how | Result |
| --- | --- | --- |
| RET3-R1 (one-shot safety path) | `retention-phase-b-cron.sh`: `phase-b.STARTED` is written before phase B, so it runs at most once; every later tick runs `safe-finish`; `rm -f safe.OK` precedes it, so the manual run's marker in `p10r2/state` cannot fake a pass; `phase-b.DONE` and `remove_job` only on exit 0 with a non-empty `safe.OK`; otherwise `phase-b.FAILED` counts and syslog says so. `retention-live.py:1136–1159` (`cmd_safe_finish`: login 5×, restore 6×, cleanup 3×, verify 3×, `safe.OK` only when all three passed), `:1113–1133` (`verify_safe` reads `enabled is False`, the window, the seed source, every remembered entry 404, the `query`/`SearchTerm` counts, libraries and directories from the instance), `:872–901` (`cmd_phase_b`: preview retried 3× with a 60 s pause; restore and cleanup in nested `finally`). With no fixture series `started_events()` raises before `cmd_configure`, so the standing 12:30Z tick cannot switch retention on (confirmed: `library()` returns None → `entry()` returns `(None, None)` → `series['id']` throws). | **fixed and verified** from the scripts; the fixer's live rehearsal is taken as recorded. Residual: RET4-R4 (no target guard). |
| RET3-R2 (rebase, two-file movie) | `JellyfinNativeTitleSource.cs:296–312` binds a movie's extra files through `GetLocalAlternateVersionIds` (the list Jellyfin 12 builds media sources from, `LibraryManager.cs:2287`), `:319–320` reads `Video.PrimaryVersionId` directly. `RetentionPreviewService.cs:474–497` (`VersionsUntracked`): an episode with any local or linked version or a primary is untracked; a movie's played files are the union of the primary's path, `LocalAlternateVersions`, `LinkedAlternateVersions` (resolved by `ItemId`; unresolvable counts as untracked), `GetLocalAlternateVersionIds` and `GetLinkedAlternateVersions`, each compared by path with every path bound to the same movie or episode; an exception counts as untracked. Against Jellyfin `v12.0` `Video.cs:845–884` this is the same set Jellyfin plays for a main item and for a local alternate. | **fixed**; live evidence in the fix record. Merged (linked) copies: RET4-R2. |
| RET3-R2 follow-up C2 (merged copy) | `RetentionPreviewService.cs:504–527` indexes, by path, every file a tracked item lists as a linked version (`LinkedAlternateVersions` and `GetLinkedAlternateVersions`), and `:327–331` blocks a target whose own path another target lists. Verified for the case found live (a copy merged into a title in another library, the copy without `PrimaryVersionId`). Note: `VideosController.MergeVersions` (`v12.0:222`) does set `PrimaryVersionId` on the merged item, so the live state the fixer saw came from a later scan clearing it; the guard does not depend on which, because it reads the main item's lists. | **fixed** for the reported case; incomplete for what Jellyfin plays beyond the direct link, RET4-R2. |
| RET3-R3 (replaced in place) | `UnixFileInspector.cs` `ContentStamp` (size, mtime to the nanosecond) and `FileFingerprint` (identity + stamp); `ReconciliationService.cs:334–336` (`ReplacedInPlace`: same path, both fingerprints known, different), `:432–437` movies, `:1010–1018` episodes, `:472–478`/`:462–466` reset with `replaced_in_place`; a binding without a fingerprint is never a replacement, so the first reconciliation after deploy only records. 18096: every episode and movie binding carries one. | **fixed**. Residual (recorded, not a finding): an in-place rewrite that preserves size and mtime (`rsync --inplace -t` of an equal-sized file) keeps the fingerprint; the executor's own `SameFile` still requires the same bytes count. |
| RET3-R4 (live check floor, resets outside the gate) | `RetentionLiveCheck.cs:112–125,138–139` (a user counts only for Played, position 0 and `LastPlayedDate` at or after `RetentionEvaluator.FreshFloor`; no evaluation row → `live_not_completed`; the multi-episode file gets the same test); `RetentionEvaluation.cs` `[ConcurrencyCheck]` on `BaselineAt` and `GraceNotBefore`, present in the model snapshot; `RetentionEvaluator.cs:185–192` re-evaluates on `DbUpdateConcurrencyException`; `EntriesController.cs` holds `HoldTargetAsync` around `RestartGraceAsync` for the window editor, episode un-Keep and per-file un-Keep, under the execution gate and library lock taken before it (lock order unchanged: execution → library → target; the evaluator takes no outer lock). | **fixed and verified** |
| RET3-R5 (air-date evidence, covered rows) | `Episode.cs` `Agrees`: title first; a date within a day counts only when exactly one listed episode is within a day, and only the exact date when the list is unknown; `LibraryAccess.CoveredByBindingsAsync` reads the title's own bound items plus their local and linked versions; the Refresh leaves covered rows unmonitored and unmonitors existing ones with `episode_unmonitored`; the Add unions the covered numbers. Not on the delete path. | **fixed** |
| RET3-R6 (post-unlink persistence, triple full evaluation) | `RetentionExecutor.cs:505–527` (`SaveAfterUnlinkAsync`: 8 attempts 10 s apart on busy, each itself retried by the `SaveChangesAsync` override, then logged at error and rethrown; the operation then stays `prepared` with its file gone and recovery ends it `vanished`); `:373–374` `BEGIN IMMEDIATE` retried; `:50–51,63–66,269–274` targeted `EvaluateEntriesAsync` for the action's entries plus every entry with a binding at the file; the runner's one full preview per run unchanged. | **fixed**; note the per-action cost is now three evaluations of every episode of the touched series, not of the whole catalog. |
| RET3-R7 (orphan per-file Keep) | `ReconciliationService.cs:361–396` removes a `VersionKeep` that matches no binding of its entry by path or by physical-identity prefix of `FileFingerprint`, with `version_keep_detached`; called after a title's reconciliation and after the absence pass. Cannot detach a Keep whose file is still bound (the executor's reclaim of a sibling removes only that sibling's binding). | **fixed**; residual RET4-R6 (a false absence drops the Keep). |
| RET3-R8 (bundle provenance) | Health on 18096: `WebCommit c22c90abb3`, no `-dirty`, a commit on the branch. | **fixed and verified** |
| RET3-N1 (access change moved deadlines) | `RetentionEvaluator.cs:445–453`: a window pushed to now (access or policy change, or a completion only now observed) stores the push in `GraceNotBefore`, monotonic; `:458–468` back-fills it for schedules pushed before the fix. `EvaluateCoreAsync` returns before the access fingerprint while disabled (`:269–273`), so the change is seen at the switch-on, and the stored grace reproduces the announced deadline at every later switch-on. PhaseTen suite passes locally (the deadline survives an access change and an off/on). Sibling paths: the multi-episode rule computes its own, stricter deadline only for candidates already due; `RestartGraceAsync` stores `now`; the reset clears everything. The one sibling the fix leaves open by design is a watch made while retention was off: RET4-R1. | **fixed** |
| Decision 12 (movie backlog) | `RetentionEvaluator.cs:257,410–416,576–577` (`RequiresFreshCompletion` on every new row, `FreshFloor` for both target kinds, `CompletionInstant` needs a dated play at or after it); migration `20260924231510` selects `EpisodeId IS NULL AND State = 'scheduled' AND CompletionBasisAt < max(BaselineAt, coalesce(FirstEnabledAt, EnabledAt, BaselineAt))`, writes one `retention_rule_changed` row (all six `History` columns, a GUID-shaped id, `strftime` text EF Core parses), sets the rows to waiting with no deadline, and sets `RequiresFreshCompletion` on every movie row. Idempotent (a second run selects nothing). Loses no Keep, no history and no deadline of a fresh watch (`CompletionBasisAt` of a fresh completion is at or after the floor by construction, `:602–603`). On 18096 every row was `disabled`, so nothing moved; a fresh database is built by the chain in the suites. | **fixed**; predicate gap RET4-R3. |
| `database is locked` | `RetentionEvaluator.cs:45–67`: one full evaluation at a time; a waiter runs its own only when no full evaluation started after it asked (`completedFrom > asked` compares start numbers, so an evaluation that began before the caller's request never satisfies it, and a failed or cancelled one leaves `completedFrom` behind so the waiter runs). No deadlock: the full-evaluation gate is taken only from the listener, the admin preview and the runner's opening preview, none of which hold the execution gate, the library lock or a target gate at that point; the per-target gate is held for one evaluation and never while waiting for another lock. Starvation bounded by one full evaluation per waiter. `SqliteBusy.RetryAsync` (1, 3, 8 s) around each evaluation and, through the `ModDbContext.SaveChangesAsync` override, around every save outside an explicit transaction; inside a transaction the caller owns the outcome. `EvaluateEntriesAsync` for Keep and the executor. PhaseTen suite (600 targets, concurrent previews, Keep, second switch-on) passes locally with 0 slow holds. | **fixed and verified** (suite and the fixer's live `lockcheck`). |

## RET4-R1 — A watch made while retention is off is scheduled from its watch date at the next switch-on, so it can be due, and reclaimed, with no visible window

- **Priority:** P2 (gates enabling on real media, not the merge). **Verified** in the code; not reproduced live
  (retention stays off).
- **Location:** plugin, `JellyfinMod/Services/RetentionEvaluator.cs:269–273` (while disabled the evaluation returns
  before reading evidence, so the row stays `disabled` and no window starts), `:442–457` (at the next switch-on
  `priorState == Disabled` clears `policyChanged`, `priorDeadline` is null, and the push-to-now branch at `:445–446`
  requires `accessChanged || policyChanged || (hadPriorEvaluation && priorState != Disabled)`, none of which holds; the
  deadline is therefore `max(watch date, GraceStartAt, BaselineAt) + window`), `:472–478` (announced once, with that
  date); `RetentionCompletionService.cs:52–114` (the listener records the watch while retention is off, with
  `CompletedAt = LastPlayedAt`); `RetentionPolicyService.cs:65–66` (`FirstEnabledAt` never moves, so `FreshFloor` is
  the first-ever switch-on and the watch counts). Decision 12 (`b93f605`) makes this the movie path as well.
- **Trigger:** retention was enabled once, then switched off for longer than the window (a 14-day window, off for
  three weeks); a policy user finishes a movie or an episode during the off period; the administrator switches
  retention on. The row goes `disabled → scheduled` with a deadline already in the past, History gets one
  `retention_started` saying "will be deleted on <past date>", the detail page reads overdue, and the daily task
  (03:00 by default) or any run started by the administrator reclaims it. Nothing watched *before* the first-ever
  switch-on is affected (that is what decision 12 and Q1 close); this is the watched-while-off backlog.
- **Impact:** a deletion at switch-on with no window anyone could act on, which is what Q8 ("the user must be told …
  will be deleted on <date>") and decision 12 ("switching retention on must delete none of the already-watched
  backlog") say must not happen. REVIEW-3's verdict listed this behaviour under "the operator accepts the designed
  behaviour" and PHASE10 §3 documents it only for a countdown that was *running* before the switch-off (Q9). Whether
  a watch made while off is "backlog" or "a countdown that ran" is the user's call; the code today treats it as the
  latter. It cannot delete anything that was not finished by the policy users after the first-ever switch-on, and
  every other guard (Keep, resume, favourite, seeding, versions, live check) still applies.
- **Fix direction:** in `EvaluateCoreAsync`, when `priorState == Disabled` and the row was never announced
  (`AnnouncedDeadline is null`) or the recomputed deadline is already past, start grace at `now` and store it in
  `GraceNotBefore`, exactly as the RET3-N1 branch does for an access change; a countdown that was announced before
  the switch-off keeps its date through the stored grace (Q9 unchanged). If the user instead confirms the current
  reading, record it in PHASE10 §3 in so many words ("a title finished while retention is off is due at the next run
  after the switch-on if its window has elapsed") and in the settings page text.
- **Acceptance:** PhaseTen suite: enable, disable, mark a movie and an episode played (dated) during the off period,
  advance past the window, enable: both `scheduled` one window out with a future deadline and one `retention_started`
  each; a title scheduled before the switch-off keeps its date. Live on 18096 with a test window: the same in minutes,
  then an immediate run reclaims nothing.

## RET4-R2 — The merged-version guard covers the direct link only; Jellyfin plays more than that, and the guard needs the main item to be tracked

- **Priority:** P3. **Plausible** (code against the Jellyfin `v12.0` source; not reproduced live).
- **Location:** plugin, `JellyfinMod/Services/RetentionPreviewService.cs:504–527` (`FilesMergedIntoOtherTitles` indexes
  only the paths of each tracked item's `LinkedAlternateVersions` / `GetLinkedAlternateVersions`) and `:327–331`;
  Jellyfin `MediaBrowser.Controller/Entities/Video.cs` `v12.0:845–884` (`GetAllItemsForMediaSources`: the main item, its
  linked versions, and **the local alternates of every one of those**, deduplicated).
- **Trigger:** (a) movie P in library 1 is merged with movie L in library 2 whose folder holds two files (L and
  L-720p): P plays L-720p as one of its versions; the guard blocks P (L is not bound to P's entry) and L (P lists it),
  but L-720p is listed by nobody, has `PrimaryVersionId = L`, and `VersionsUntracked` sees only L's own tracked files,
  so once L's entry is completed L-720p is due and reclaimed first. (b) The main item lives where the plugin binds
  nothing (a mixed-content library, a title in conflict): its merged copy in a tracked library is listed by no
  tracked item and passes.
- **Impact:** the file that goes is a watched file of its own entry, so under the accepted rules it is not a wrong
  deletion; but the invariant `15589f1` states ("nothing of a title is reclaimed while Jellyfin plays a version the
  plugin does not track") does not hold for these shapes, and the guard is silent about why.
- **Fix direction:** build the index from what Jellyfin itself plays: for every bound `Video`, the paths of
  `GetAllVersions()` (or `GetMediaSources(false)`), each owned by that target; block any target whose path appears
  under another owner. That is the V1 enumeration and would also retire `VersionsUntracked`'s hand-built union.
  Until V1: add the local alternates of each linked version (`linked.LocalAlternateVersions`,
  `GetLocalAlternateVersionIds(linked)`) to the index.
- **Acceptance:** protection suite: a main item whose linked version has a local alternate; the alternate's target,
  completed and due, ends `blocked/versions_untracked` and byte-identical; the same with the main item unbound.

## RET4-R3 — The decision-12 migration's predicate misses a played flag without a date

- **Priority:** P3. **Verified** in the code; no effect on 18096 (every row was `disabled`).
- **Location:** plugin, `JellyfinMod/Data/Migrations/20260924231510_PhaseTenMovieBacklog.cs:18–21`
  (`CompletionBasisAt < floor`); `JellyfinMod/Services/RetentionCompletionService.cs:110–114,168–169` (the basis the
  Phase 3 rule stored is `CompletionTime(LastPlayedAt, observedAt)`: the last-played date when Jellyfin has one, else
  the time the plugin read the flag).
- **Trigger:** a movie whose played flag carries no `LastPlayedDate` (an imported or synced flag, or Jellyfin 12's
  propagated flag from another version) first observed after the first switch-on: its basis is the observation time,
  at or after the floor, so the migration leaves it `scheduled` with its old deadline and writes no History.
- **Impact:** none on the delete path: the listener's start-up evaluation (`RetentionEventListener.StartAsync` enqueues
  the policy work) and every run, preview and action re-evaluate first, and `CompletionInstant` (`:602`) rejects an
  undated flag, so the row goes to `waiting` within seconds and the live check would refuse it anyway. Only the
  promise in PHASE10 §7 ("each with a History entry") is not kept for those rows.
- **Fix direction:** extend the predicate to every `scheduled` movie row without a `CompletionObservations` row whose
  `LastPlayedAt >= floor` for a bound item, or record the gap in PHASE10 §7.
- **Acceptance:** the PhaseTen migration check with an undated observation whose basis is after the floor: the row is
  moved and recorded.

## RET4-R4 — The real-window scripts have no target guard

- **Priority:** P3 (process safety). **Verified** from the scripts; today's environment files are correct.
- **Location:** web, `scripts/jellyfinmod-e2e/retention-live.py:45–48,425–443,1055–1102` (`JFMOD_BASE`,
  `JFMOD_HOST_MEDIA` and `JFMOD_CONTAINER` are taken from the environment as they come; `configure` and `phase-b` enable
  retention and `cleanup` removes tag-named directories, libraries and entries on whatever instance the base names);
  `retention-phase-b-cron.sh:21–24` (`source "$ENV_FILE"`).
- **Trigger:** an environment file pointing at another port or a media root outside the test tree. Both `env.sh`
  files on the Pi say `http://localhost:18096` and `/home/pi/media/test/jellyfinmod/media`; the crontab line is the
  only consumer; the production roots are mounted read-only in the test container.
- **Impact:** none today; the docstring's rule ("nothing here may point at a production instance") is not enforced by
  the code that can enable retention. Also noted: the standing 12:30Z tick will PATCH 18096's retention and seed
  settings from `p10r2/state/restore.json` (saved 2026-09-24 06:17Z); the saved values equal the current ones
  (disabled, All users, 14 days, window 0, seed source `separate`), so it changes nothing, then writes `DONE` and
  removes its line.
- **Fix direction:** refuse at import when `JFMOD_BASE` ends in `:8096` or `:28096` or `JFMOD_HOST_MEDIA` is not
  under the test tree, and have the wrapper check the Health endpoint's host before `phase-b`.
- **Acceptance:** with `JFMOD_BASE=http://localhost:8096` every subcommand exits non-zero before any request.

## RET4-R5 — `EvaluateEntriesAsync` per action evaluates every episode of the touched series

- **Priority:** P3 (cost, not correctness). **Verified** in the code.
- **Location:** plugin, `JellyfinMod/Services/RetentionExecutor.cs:50,63–66,269–274` (`EntriesOfBindingsAsync` resolves
  an episode binding to its series entry) and `RetentionEvaluator.cs:74–94` (every bound episode of each entry).
- **Impact:** a 25-action run over a long series evaluates that series three times per action (75 evaluations of, say,
  200 episodes); far less than before, still the dominant cost on the Pi. No stale-evaluation risk follows from the
  narrowing: the same-path group's entries are always in the evaluated set (`CurrentBindingSetAsync`), and every
  operation is still checked by `LoadEvidenceAsync` and the live check.
- **Fix direction:** evaluate the action's targets (episode ids) rather than their entries.
- **Acceptance:** `Runs/Latest` duration for a multi-reclaim run on a 200-episode series stays flat as the series grows.

## RET4-R6 — A false absence now also drops the per-file Keep

- **Priority:** P3. **Plausible** (code reading; the absence class is recorded as S18/C5, V1).
- **Location:** plugin, `JellyfinMod/Services/ReconciliationService.cs:371–378` (`IsProvenAbsent` proves the mount,
  not the file, when an identity is recorded), `:157–159,264–266` (the binding is removed and `DetachOrphanVersionKeepsAsync`
  runs), `:361–396`.
- **Trigger:** Jellyfin stops listing an item whose file is still there on a current mount (the case seen live: a copy
  merged into another library's title gains `PrimaryVersionId` and is hidden from that library's queries until a scan
  clears it again). The binding goes, the target resets, and the administrator's per-file Keep is removed with
  `version_keep_detached`; when the item is listed again it is a new arrival, unkept.
- **Impact:** deletes less (the returning file needs a new watch and, in the merge case, stays blocked by the C2
  guard), but an explicit Keep is dropped by an event the administrator did not cause, and only History says so. Before
  `7fe53c1` the Keep re-applied by path when the file came back.
- **Fix direction:** detach only when the kept path is provably absent (`MediaStorageIdentity.IsProvablyAbsent`) or its
  identity is gone; keep the row while the file exists on a current mount.
- **Acceptance:** protection suite: a binding removed by the absence pass while its file exists; the Keep survives and
  applies when the binding returns.

## RET4-R7 — Checked and dismissed (recorded so the next reviewer need not repeat them)

- Two-file movies on Jellyfin 12: both files bound (`GetLocalAlternateVersionIds`), `VersionsUntracked` passes only when
  every played path is bound to the same entry, per-version order lowest first, per-file Keep and seed checks per file,
  the entry `reclaimed` only when the last binding goes (`RetentionExecutor.cs:429–451`); the fixer's live run matches.
  A stale item JSON (`LocalAlternateVersions` empty while the DB lists a version) leaves the extra file unbound and the
  title blocked. A second file with a different TMDB id in a grouped folder is bound as a version without an identity
  check (the group-conflict query in `GetObservation` cannot see hidden versions on 12): Jellyfin itself plays it as a
  version, so this is the accepted any-copy rule applied to Jellyfin's grouping; the per-version identity check is V1
  (analysis C2/C14).
- Double-episode files: the main item of `S01E01` + `S01E01-E02` carries `LocalAlternateVersions` and the extra carries
  `PrimaryVersionId`, so both are `episode_versions_untracked`; covered rows have no binding and cannot be reclaimed.
- Lock order and deadlock after the lock work: execution gate → library lock → target gate for Keep paths; full
  evaluation gate → target gate for the listener, preview and runner; reconciliation holds the library lock and writes
  evaluation rows without a gate. No path waits for an outer lock while holding an inner one.
- Concurrency tokens: a reconciliation that loses to an evaluator on `BaselineAt`/`GraceNotBefore` fails its whole
  save (`DbUpdateConcurrencyException` is not busy), is logged by the runner and repeated at the next pass; the
  executor's reset runs inside `BEGIN IMMEDIATE`, so it cannot lose.
- The RET3-N1 back-fill at `RetentionEvaluator.cs:458–468` can set `GraceNotBefore` to a future instant after a
  global window is shortened (`priorDeadline - newDays`); a later un-watch and re-watch is then scheduled from that
  instant rather than from the re-watch: later, never earlier.
- The targeted preview reports other entries from stored evaluations; the executor acts only on the requested binding
  and its same-path group, whose entries are in the evaluated set; a stale hardlinked sibling under another entry can
  only change the shared-inode rule's verdict about the requested file, whose own evaluation is fresh.
- `SaveAfterUnlinkAsync` budget: 8 outer attempts × the override's 4 inner, about three minutes; a final failure aborts
  the run loudly and leaves a `prepared` operation that recovery ends `vanished`.
- The 12:30Z tick on the Pi: `STARTED` written, phase B stops before `cmd_configure` (no fixture series), restore and
  cleanup run against an empty fixture set, `safe-finish` verifies, `DONE`, line removed. Retention cannot be enabled by
  it. The driver it names (`build/p10r2-retention-live.py`, `dc6d202b…`) is present.
- `cmd_cleanup` and `verify_safe` reach only tag-named directories under `JFMOD_HOST_MEDIA`, the three fixture libraries
  by name, remembered entry ids, `query`/`SearchTerm` matches on the tag prefix, and `/dev/shm/tv-<tag>c` in the named
  container; a full library scan on 18096 unlinks nothing.
- The migration's `History` insert names all six columns of the current table; `randomblob` and `json_object` are
  built into the bundled SQLite; the timestamp form is the one EF Core's provider parses.
- Web `c61e89f56d`: wording only.

## Verdict

No P1. I found no path by which the rebased engine unlinks a file that was not finished by the policy users after
its floor, no way to reach a two-file movie's kept or seeded file, a double-episode file, or a merged copy that a
tracked title lists, and no way the decision-12 migration can make a movie due or lose a Keep, a deadline of a fresh
watch or a history row. The lock work serialises full evaluations without a deadlock or a lost evaluation, and every
reclaim still re-evaluates its own targets and runs the live check with the fresh floor before the unlink.

**Merge:** `p10-retention` is safe to merge now into plugin `master` and web `jellyfin-mod` with retention off.
Nothing on the branch deletes while retention is disabled (reclaim and replacement both refuse, verified again at
`RetentionExecutor.cs:141–143,298–301` and `LoadEvidenceAsync`), the migrations are forward-only and were applied on
18096 and on fresh databases, and the standing 12:30Z job cannot switch retention on.

**Enable on real media:** besides the real-window run the user re-arms tonight, one thing must be settled first:
RET4-R1. Either the user confirms that a title finished while retention is off may be reclaimed at the first run
after the next switch-on when its window has elapsed (then write it into PHASE10 §3 and the settings text), or the
small fix lands (grace from the switch-on for a never-announced or already-elapsed window) and the PhaseTen check
covers it. RET4-R2 to RET4-R6 are hardening for the next slice and do not block enabling; RET4-R2 and RET4-R6 belong
with V1.

## Fix record — 2026-09-25 (Opus 5.5, high)

Plugin `p10-retention`: `4647af8` (decision 13), `c1ab0db` (R3), `eb99e55` (R2), `238cc81` (R5), `128ec3f` (R6). Web
`p10-retention`: `175fcac5ef` (R4), `7841b097ff` (live driver). Neither is pushed. Deployed on 18096: plugin DLL
SHA-256 prefix `665b82f60dd48fcc` (`128ec3f`); web bundle unchanged (`c22c90abb3`, `350e27ced474`); backup
`p10r3/backup-20260925T062004Z`. **Retention is off on 18096** and the live fixture set is removed.

| Finding | Fix | Evidence |
| --- | --- | --- |
| RET4-R1 → decision 13 | The user's answer (2026-09-25): a title finished while retention is off gets a full window from the next switch-on, announced, and is never due at once. At a switch-on, when the prior state is `disabled` and the window was never announced (`AnnouncedDeadline` null) or the recomputed deadline has passed, grace starts now and is stored in `GraceNotBefore` (the RET3-N1 mechanism). A countdown announced before the switch-off and still running keeps its date (Q9). PHASE10 §3 and §7 record it. | **PhaseTen suite:** the plugin's clock moves 20 days past a switch-off. A movie watched while off (window run out) and three announced windows that ran out while off (a movie, an episode, the RET3-N1 movie) are all `scheduled` a full window from the switch-on, each announced once more, preview `due` 0. A short off/on keeps an announced date. **This check fails on the code before the fix** (the movie came back `scheduled` with a deadline in the past). **Live on 18096** (`decision13`, fresh `D13` set, test window 3 min): E04, watched while on, keeps 06:31:37 and one announcement through a short switch-off. E13, finished while off, gets 06:32:11, a full window from that switch-on, with warning. After a 200 s switch-off: E03 and movie MB (finished while off) and E04 and E13 (windows ran out while off) are all due 06:35:44–06:36:00, i.e. switch-on plus 3 min, announced, each with the warning. A run at once: inspected 587, reclaimed 0, and every fixture byte-identical. After the window the run reclaimed exactly those four (0 failed); every other fixture was byte-identical. |
| RET4-R2 | The merged-version index adds each linked version's own local alternates (`LocalAlternateVersions`, `GetLocalAlternateVersionIds`), which Jellyfin plays with it (`Video.GetAllItemsForMediaSources`). Shape (b), a main item the plugin does not bind, is caught through the merged item's own `PrimaryVersionId`, which `MergeVersions` sets (`VersionsUntracked` reads the primary). When a later scan clears it, only enumerating every item that links the file can find the main item. That is V1's version enumeration, so this remainder is **recorded for V1**. | Protection suite on the Pi: (a) a local alternate of a copy merged into another tracked title, due and watched, `blocked/versions_untracked`, byte-identical. (b) A copy merged into an unbound title, with `PrimaryVersionId`, `blocked/versions_untracked`, byte-identical. |
| RET4-R3 | The decision-12 migration also moves every scheduled movie with no played observation dated at or after the floor, not only those whose basis is before it. The migration has not been released; on 18096 it ran with every row disabled and moved nothing, so no deployed database differs. | PhaseTen migration check: an undated movie whose basis lies after the floor goes to `waiting` with a History entry; a dated fresh movie keeps its schedule; two `retention_rule_changed` rows. |
| RET4-R4 | The driver refuses to start unless `JFMOD_BASE` uses port 18096, the container is `jellyfinmod-test` and publishes 18096, and `JFMOD_HOST_MEDIA` is that container's read-write mount at `JFMOD_CONTAINER_MEDIA`. The check comes before any request (module level). The wrapper refuses any other port before it runs anything, with a log and syslog line. | On the Pi: `JFMOD_BASE=http://localhost:8096`, `:28096`, a media root of the parent tree, and container `jellyfin` each exit 1 with `REFUSED …` before any request. The wrapper with `:8096` exits 1 with `!!! REFUSED` in its log. The correct environment passes the guard. |
| RET4-R5 | The executor passes the targets of an action's bindings and of every binding at the file (a movie's entry, an episode) to the preview. The evaluator adds the episodes a multi-episode file among them covers, whose evaluations the multi-episode rule reads. The run's opening full evaluation, `LoadEvidenceAsync` and the live check are unchanged. | Protection, Five and Six suites pass on the Pi. Live `decision13` run: 4 reclaimed, 0 failed, in 42.6 s (inspected 587). The per-action cost was not measured separately. |
| RET4-R6 | A per-file Keep that matches no binding is removed only when its file is provably absent (`IsProvablyAbsent`) or another file sits at its path (another physical identity). A Keep matched by identity after a rename follows its file to the new path. | Protection suite: the kept file stays on disk while Jellyfin lists another copy. The Keep survives, the other copy is not kept, and it is kept again when listed again. A rename moves the Keep's path. `version_keep_detached` stays at 1 (from the copy-and-delete case, which still detaches). |

**Suites** (on the Mac: Two, Three and Ten; on the Pi: ThreeProtection, Five and Six): all pass on `128ec3f`. Three of
the protection suite's fixtures modelled a due target as a `disabled` evaluation. Under decision 13 a never-announced
window starts at the switch-on, so they now record the scheduled, announced window that a prepared operation implies.
The full twelve-suite run went to the verifier after the rebase below: **suites verified on `348168b`** (Sonnet-high
verifier, 2026-09-25: all twelve `exit=0` in `p10r3-logs/verify-r5.out`, the decision 13 check in the PhaseTen log,
the RET4-R checks in the synced protection suite). The browser re-run (Section B) was not repeated; the bundle's
retention code is unchanged since the Chromium and Chrome pass on `c22c90abb3`.

**Rebased 2026-09-25 onto the S11 release** (plugin `master` `e5b3c95`, web `jellyfin-mod` `48e60121e7`), with no
conflicts. Each branch's delta over its new base is line for line the one it had before. The plugin commits above are
now `ecec20c` (decision 13), `582e713` (R3), `fc36b7f` (R2), `b1971ff` (R5) and `348168b` (R6); RET3's `15589f1` is
`e0c16a6`. Deployed on 18096: plugin `348168b` (DLL SHA-256 prefix `a3cae91c7b3e0545`, JPRM `meta.json` of the S11
package) and web bundle `9d30aba7e9b3` from the clean tree at `a30926e30c`; backup `p10r3/backup-20260925T100456Z`.
Health `Ok`, host 12.0.0.0; retention off; no `JellyfinMod` entry.
