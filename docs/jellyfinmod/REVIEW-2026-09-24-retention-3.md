# Retention delete-path review, third pass — 2026-09-24

Adversarial re-verification of the fixes for the second retention delete-path review
([`REVIEW-2026-09-24-retention-2.md`](REVIEW-2026-09-24-retention-2.md), RET2-R1..R10) on branch `p10-retention`.
Reviewed plugin `p10-retention` at `84b6937` (`bb6c7c5` engine fixes and migration `PhaseTenRetentionFixes`, `c970aab`
and `84b6937` suites, on top of `ab4d464`) and web `p10-retention` at `e3b70a3cc8` (`02f7294d99` UI, `5d9d347a40` driver,
browser probe and cron job, `e3b70a3cc8` docs, on top of `6c9e52d378`). Verifier: Fable, high effort. Verification only:
no product code, no deployment, no instance setting, no fixture and no crontab entry was changed; the only writes were
this file and its commit.

What was checked, and how:

- Code, whole files as of `84b6937`: `RetentionEvaluator`, `RetentionExecutor`, `RetentionLiveCheck`,
  `RetentionCompletionService`, `RetentionEventListener`, `RetentionRunner`, `RetentionPolicyService`,
  `RetentionEvaluation` (`RetentionTargetReset`, `RetentionOverrides`), `RetentionReclamationTask`,
  `DatabaseInitializer`, migration `20260924110006_PhaseTenRetentionFixes`; the `bb6c7c5` diff and its surroundings in
  `ReconciliationService` (absence pass, `RestartForNewFileAsync`, `ForgetRepresentationEvidenceAsync`, movie
  representations, `ReconcileEpisodes`), `RetentionPreviewService` (`PreviewAsync`, `Inspect`, the multi-episode rule,
  `VersionsUntracked`), `EntriesController` (episode retention, version Keep, `RestartGraceAsync`,
  `CompleteConcurrentAdd`, warnings), `LibraryAccess.CoveredPositions`, `EpisodeIdentityEvidence`, `UpgradeService`,
  `SeriesMetadataRefresher`, `VersionKeep`, `EpisodeBinding`, `ModDbContext`, the model snapshot; the suite diffs in
  `PhaseTwoIntegration` and `PhaseThreeProtectionIntegration`; web `NativeEntryDetails.tsx`, `RetentionWarning.tsx`,
  `entry.ts`; the driver `retention-live.py` (`phase-b`, `configure`, `restore`, `cleanup`, `reacquire`,
  `unkeep-survivor`, `late`, `db_rows`) and `retention-phase-b-cron.sh`.
- Documents: the three `CLAUDE.md`, PHASE10 (§2–§4, S1–S19, both evidence sections and handovers), REVIEW-2 with its fix
  record, UX §8, PHASE3 T7–T10/T18, the user's decision brief.
- Plugin `master` `f443a62` (the Jellyfin 12 retarget) against the branch: merge-base `cdb6e7b`, files both sides touch,
  migrations added on `master` (none), the retarget's rewrite of `JellyfinNativeTitleSource`.
- Isolated instance 18096 (Jellyfin 12.0.0, plugin `bb6c7c5`, web bundle `2c491b82fa5c` = `02f7294d99-dirty`), signed in as
  `oleksii` with an empty password, GETs only: Health, `Settings/Retention` (**disabled**, All users, 14 days, revision
  31), `Retention/Runs/Latest` (12:00:52–12:01:11Z, 19 s, inspected 580, eligible 0, blocked 37), both fixture entries with
  detail and History, `Library/VirtualFolders`, an anonymous Health (401). No preview was requested (a preview writes
  evaluation rows and re-evaluates every target). Retention stayed disabled.
- The 18096 plugin database, read from a private online `.backup` copy (`sqlite3 .backup`, then deleted) and the
  pre-deploy backup `p10r2-backup-20260924T111423Z/jellyfinmod.db` opened read-only: migration history, index shapes
  before and after, per-table counts, `integrity_check`/`foreign_key_check`, `journal_mode` (WAL), the
  `IdentityUnverified` and `AnnouncedDeadline` back-fills, the fixture series' evaluations, observations and bindings,
  `VersionKeeps`, the policy row, open operations (none).
- Pi, read-only over SSH: the user crontab, `env.sh`, the state directory, `docker inspect` of the test container's
  mounts, SHA-256 of the deployed cron script and driver against the committed files (identical).
- Locally from the plugin worktree at `84b6937`: `PhaseTwoIntegration` (the RET2-R1/R3/R7 checks included) and
  `PhaseThreeIntegration` pass against temporary SQLite databases created by the full migration chain.
  `PhaseThreeProtectionIntegration` and `PhaseSixIntegration` are Linux-only and were not re-run; the fixer's Pi run at
  `84b6937` is taken as recorded.

Counts: P1 0 · P2 2 · P3 6 (plus one dismissed-checks entry). The verdict is at the end.

## RET2 findings, re-verified against the code (not the status lines)

| Finding | Verified how | Result |
| --- | --- | --- |
| RET2-R1 (re-acquired copy) | `ReconciliationService.cs:884–886,952–955` (an episode binding whose path was not bound before, for a target that was bound or evaluated, is an arrival), `:458,484,562–565` (movies, only when an evaluation exists), `:277–292` (`RestartForNewFileAsync` = `RetentionTargetReset` + `retention_reset`/`new_file` history), `:160–167` (absence pass forgets evidence keyed to the absent item when siblings stay), `RetentionExecutor.cs:394–397,430–432` (the same at reclaim); `RetentionTargetReset` sets `BaselineAt = now`, `RequiresFreshCompletion`, clears `GraceNotBefore` and `AnnouncedDeadline`; `RetentionEvaluator.cs:322–330,482–493` apply the floor to Jellyfin's own last-played instant. Same file, new id: the path is already in `pathsBefore`/`boundMoviePaths`, so no arrival. Live on 18096 (DB copy): E01 `BaselineAt` 11:43:36, its only played observation has last-played 11:32:44 (copy A's reattached state), so the evaluator cannot count it; one `retention_reset` "a new file arrived" in History. Phase 2 suite passes locally. | **fixed** for the case reported (re-acquired after a reclaim or an unbind). The check can be fooled in one direction, RET3-R3 below: a file replaced at the same path between two scans is the same binding and the same item id, so it is not an arrival. It cannot be fooled the other way: a path change is always treated as new, which only ever resets (deletes less). |
| RET2-R2 (un-Keep restarts the window) | `EntriesController.cs:442–454` (removal, `version_unkept`, `RestartGraceAsync(episode?.Id ?? id)`, save, then `EvaluateEpisodeAsync`/`EvaluateMovieAsync`), `:462–474` (`GraceNotBefore = now`; a `scheduled` row goes back to waiting); `RetentionEvaluator.cs:358` applies `GraceNotBefore` after the Q9 floor and `:365` never shortens a prior deadline. In the `disabled` state the deadline is not touched and the restart is honoured on the next switch-on (E01 on 18096 carries `GraceNotBefore` 12:03:27 from the probe's last un-Keep). Suite `c970aab` asserts `GraceNotBefore == now`; live E14-B evidence in the fix record. | **fixed and verified** |
| RET2-R3 (`identity_unverified`) | `ReconciliationService.cs:918–919,922,947` (flag computed for every binding on every reconciliation: TMDB row, native without the row's TMDB id, no title or air-date agreement), `Episode.cs:57–62`, `RetentionExecutor.cs:140–141,164–165,292–296` (refused before the first preview, before prepare, and again inside the lease before the live check; `IdentityUnverifiedAsync` reads `EpisodeBindings` only, so a movie binding never matches), `UpgradeService.cs:182–198` (one `upgrade_replacement_refused` under a stable id, then blocked), migration `:39–42` (every binding on a TMDB row flagged until the next reconciliation), `LibraryAccess.cs:206–224` and `EntriesController.cs:570–589` (Add leaves rows at covered numbers unmonitored unless the covering file carries the row's TMDB id; a native TMDB id is real evidence, so the deviation is sound). Live: E17 `unverified=1`, E01's root-A copy (NFO title "Pilot") `0`, root-B copy `1`, position rows `0`. Suites `bb6c7c5`/`c970aab` cover flagging, clearing by title, and the executor's refusal with the file byte-identical. | **fixed** as designed; the air-date tolerance weakens it for daily shows (RET3-R5, gated by `EpisodeUpgradesEnabled`). |
| RET2-R4 (preview Keep, serialisation) | `RetentionPreviewService.cs:254–259` (`version_kept` then `kept` before anything else, replacement or not); `RetentionEvaluator.cs:111–131` (per-target `SemaphoreSlim`, waited with the cancellation token before `try`, released in `finally`; the retry on SQLite 19 stays inside the gate). Lock order everywhere: execution gate → library lock → target gate (`EntriesController.cs:328–330,404–406` then `EvaluateEpisodeAsync`; `RetentionExecutor` → `PreviewAsync` → `EvaluateAllAsync`); the evaluator never takes the outer two and never re-enters itself (`EvaluateCoreAsync` calls `RetentionCompletionService.RefreshAsync` and `RecordWindowStartAsync` only). No cycle, so no deadlock; a waiter holds up one target's evaluation for one evaluation (milliseconds), so no starvation. The gate is static and grows by one semaphore per target, never removed: 583 today, small. | **fixed**; residual hardening in RET3-R4 (resets and `RestartGraceAsync` write evaluation rows outside the gate and there is no concurrency token, which is harmless today because every run re-evaluates all targets under the library lease before it unlinks). |
| RET2-R5 (one announcement) | `RetentionEvaluator.cs:369–375`, reset clears `AnnouncedDeadline`; migration `:44–50` back-fills from the last `retention_started` event (JSON `2026-09-25T12:03:14.9518944Z` → `2026-09-25 12:03:14.9518944`, the text form EF Core's SQLite provider parses). Live: 14 of 583 rows back-filled; every history `deadline` on 18096 has the `T…Z` form the SQL expects. Web `RetentionWarning.tsx` says overdue. | **fixed and verified** |
| RET2-R7 (covered rows) | `ReconciliationService.cs:1120–1141` (unbound, unmonitored, `JellyfinItemId` = the covering item, only where no row holds the number); web `pageEpisode` prefers the row that holds the file. Live: S01E08 and S01E19 rows, `tmdb=0`, unmonitored, no files. Phase 2 suite. | **fixed and verified** |
| RET2-R9 (Keep identity) | `ModDbContext.cs:138` and the migration (`(EntryId, MediaPath)` unique; the pre-deploy backup had `IX_VersionKeeps_EntryId` and `IX_VersionKeeps_MediaPath`, both dropped by name, and the live copy has `IX_VersionKeeps_EntryId_MediaPath` unique). Is the cross-filesystem loss safe? Yes: the moved file has a new path and, on Jellyfin 12 (id = type + path), a new item id, so it is a new binding at an unbound path and RET2-R1 resets its target (`waiting`, baseline at the move, a watch after it required); the old path's binding goes through the absence pass (forget when siblings stay, reset when last). A moved file is therefore never deletable without a new watch after the move, and the un-Keep-style restart is not even needed. The orphaned `VersionKeep` row is RET3-R7. Suite `84b6937` reads kept/not kept through the HTTP detail (it moves the binding's path directly, so it proves the lookup, not the reset; the reset is proven by the Phase 2 arrival check). | **fixed**; loss safe |
| RET2-R10 (ordinary users) | `EntriesController.cs:632–664` (`isAdmin ? files : []`, `overdue`), web `describe()`; suite `c970aab`. | **fixed and verified** |
| RET2-R6, RET2-R8 | Recorded for V1; evidence gaps as listed in the fix record. The real-window positive half is still pending (cron, 2026-09-25 12:30Z). | unchanged |

## RET3-R1 — The real-window job's safety path is one-shot: a failed restore or cleanup still marks the job done and removes it

- **Priority:** P2 (process safety on the isolated instance; blast radius bounded, see impact). **Verified** from the
  script and driver; not reproduced live (nothing on the Pi was run).
- **Location:** web, `scripts/jellyfinmod-e2e/retention-phase-b-cron.sh:36–48` (on `rc != 0` it runs
  `login && restore && cleanup; logout` once, then writes `phase-b.DONE` and calls `remove_job` whatever that safety
  chain returned); `scripts/jellyfinmod-e2e/retention-live.py:515–536` (`cmd_phase_b`'s `finally` runs `cmd_restore()`,
  `cmd_cleanup()`, `cmd_logout()` in sequence, so an exception from `cmd_restore` skips the cleanup), `:361–379`
  (`cmd_configure` sleeps 20 s and then `cmd_phase_b` calls `cmd_preview` while the listener's full re-evaluation of every
  target is still running; that is the moment the fixer saw `GET /Retention/Preview` return 500 `database is locked`),
  `:138–142` (`must` exits the process on any non-2xx), `:131` (a 180 s socket timeout per call).
- **Trigger:** any of: the instance restarting or busy at 12:30Z tomorrow (load average 9.7 on the Pi at 12:48Z today);
  a 500 or a 180 s timeout on `PATCH /Settings/Retention`, `POST /Plugins/…/Configuration` or `PATCH
  /Settings/SeedProtection` inside `cmd_restore`; a 409 on an entry removal or a check failure inside `cmd_cleanup`.
  Each one exits the driver; the wrapper's single retry then hits the same condition and gives up.
- **Impact:** 18096 is left with retention **enabled** (Selected user `oleksii`, one-day window, test window 0), the seed
  endpoint pointed at a fake RPC that is no longer running, and fixtures in place, with the crontab entry gone and no
  marker saying so beyond `exit=` lines in `phase-b.log`. Nothing real can be deleted from that state: the production
  clone's roots `/data` and `/data5` are mounted `rw=false` (verified with `docker inspect`) and the only writable library
  root is `/test-media`, so `media_not_writable` blocks every real row before prepare. It still breaks the standing rule
  that reclamation is disabled on every instance when work stops, and it does so silently. Separately, a preview 500 at
  the switch-on aborts `phase-b` before the run, so the real-window positive half produces no evidence although the
  cleanup then succeeds.
- **Fix direction:** write `phase-b.STARTED` before `phase-b` so it never runs twice; write `phase-b.DONE` and remove the
  job only when the driver reported `retention is disabled` and `no JellyfinMod fixture left` (grep the log or have the
  driver write `restore.OK`/`cleanup.OK`); otherwise leave a `phase-b.FAILED` marker and let the next tick retry
  `restore` then `cleanup` (bounded, say six ticks, then leave the job in place and stop). In `cmd_phase_b`, nest the
  `finally` so `cmd_cleanup` runs even when `cmd_restore` raises, and retry `cmd_preview` a few times with a pause before
  giving up. Do not edit the live job before 12:30Z tomorrow without the user's say; the fix can land in the repository
  now and the recovery can be run by hand if tomorrow's log shows a non-zero `safety restore and cleanup exit`.
- **Acceptance:** on a copy of the state directory with `JFMOD_BASE` pointing at a closed port, the wrapper leaves the
  crontab line in place after a failed safety path and retries at the next tick; with the instance answering, it ends
  with `Settings/Retention.enabled == false`, `GET /Entries?query=JellyfinMod` → 0, both fixture entry ids → 404 and no
  `tv-p10a`, `tv-p10b`, `movies-p10`, `p10-seed` directory under the test media root. Tomorrow: read `phase-b.log` to the
  end and check those four things by hand whatever the log says.

## RET3-R2 — Rebasing onto `master` `f443a62` changes what the Jellyfin 12 guards see and needs a live movie re-check

- **Priority:** P2 (gates the merge; nothing on the branch as it stands). **Plausible**, from the diff of `master` since
  the merge-base `cdb6e7b` (30 files, no migrations) against the branch.
- **Location:** plugin `master`, `JellyfinMod/Services/JellyfinNativeTitleSource.cs` (the retarget removed the reflection
  helper `PrimaryVersionId` and its reader cache, and `AlternateMediaSources` now enumerates extra versions through
  `ILibraryManager.GetLocalAlternateVersionIds`, the ids Jellyfin 12 itself uses); branch,
  `JellyfinMod/Services/RetentionPreviewService.cs:455,457` (`VersionsUntracked` calls
  `JellyfinNativeTitleSource.PrimaryVersionId`), `JellyfinNativeTitleSource.cs:130,314,319` and
  `JellyfinMod/Services/Automation/VersionReader.cs` (both sides touched). `Directory.Build.props`/`JellyfinMod.csproj`:
  `net10.0`, Jellyfin 12.0.0, EF Core 10.0.11 on `master`; `net9.0`, 10.11.11, EF Core 9.0.0 on the branch.
- **Trigger:** the rebase itself. (a) `VersionsUntracked` will not compile until it reads `Video.PrimaryVersionId`
  directly; the resolution must keep its semantics (an episode with any local or linked version, or with a primary, is
  untracked; a movie is untracked when any played path is unbound). (b) On the retargeted host P6.M6 will bind a movie's
  extra versions by Jellyfin 12's own ids, so `trackedItems` will contain every version path and `versions_untracked` will
  stop blocking two-file movies. Phase 6 M7 per-version reclaim (lowest quality first, each file with its own seed and
  Keep checks, the target reclaimed when the last goes) then runs on the 12 host for the first time. Every live movie
  data point in Phase 10 was `versions_untracked`; the fixture's `M-1080p`/`M-720p` pair has never been reclaimed on 12.
- **Impact:** if (b) is not re-verified, the first enabled run on real media would be the first exercise of per-version
  movie reclaim on Jellyfin 12, where version ids and the played-flag propagation (C9) differ from 10.11. Not a defect
  found in the branch; a gap the retarget opens under it. The Phase 10 migration chain is unaffected: `master` adds no
  migration, so the chain stays linear; the Designer files' EF Core 9 `ProductVersion` is cosmetic.
- **Fix direction:** after the rebase, rebuild against 12.0.0, run Zero, One, Two, Three, ThreeProtection, Five and Six,
  then on 18096 (12.0.0) repeat the two-file movie case with real settings: both files bound, watched by the selected
  user, the 720p reclaimed first at its deadline and the 1080p byte-identical until its own turn, a per-file Keep on the
  1080p holding it, the entry `reclaimed` only when the last file goes; also confirm C9 live (finish the 1080p, read the
  720p's user data: played, no last-played date, and the evaluator's `CompletionInstant` still rejects it for a fresh
  completion of a reset target).
- **Acceptance:** the suites pass on the rebased branch; the movie case above passes on 18096 with hashes; PHASE10 S17
  updated to say which movie configurations are now tracked and which still block.

## RET3-R3 — A file replaced in place at the same path is not an arrival

- **Priority:** P3. **Plausible** (code reading; the fixture never overwrote a file in place).
- **Location:** plugin, `JellyfinMod/Services/ReconciliationService.cs:884–886,920–937,952–955` (an existing binding is
  matched by item id and its path compared with `pathsBefore`; the storage identity on the binding is the mount identity,
  not the file's) and `:463–481` for movies. Jellyfin 12 derives the item id from the path, so a file deleted and
  rewritten under the same name between two scans keeps its item id, its binding and, through Jellyfin, its played state.
- **Trigger:** a same-name repack imported by Sonarr/Radarr with a naming format without a revision token, or a manual
  overwrite, for an episode or movie already completed by the policy users and scheduled.
- **Impact:** the new bytes inherit the old completion and deadline and are deleted at it, without a watch of their own.
  This is within the letter of the accepted rule (the episode was watched) but outside the guarantee RET2-R1 now
  documents ("a new file needs a new watch"), and it is the one way the identity check is fooled. The executor's own
  `SameFile` (`RetentionExecutor.cs:623–627`) only protects within one run.
- **Fix direction:** record the file's physical identity (`UnixFileSnapshot.PhysicalIdentity`, device and inode, as
  `VersionKeeps` and operations already do) on `EntryBinding`/`EpisodeBinding` when reconciliation binds or re-observes
  a path, and treat a changed identity at an unchanged path as an arrival (`RestartForNewFileAsync`, reason
  `replaced_in_place`). Birth time, if the inspector exposes it, tells an overwrite from a hardlink swap.
- **Acceptance:** on 18096, overwrite a scheduled fixture file with different bytes at the same path, rescan and
  reconcile: the target reads `waiting/representation_reset`, History says a file was replaced, the preview does not list
  it, and after a new watch it is scheduled one window out.

## RET3-R4 — The live check accepts any played flag; resets bypass the per-target gate

- **Priority:** P3. **Verified** in the code; unreachable today, reasoned below.
- **Location:** plugin, `JellyfinMod/Services/RetentionLiveCheck.cs:120,133` (`current.Any(state => state.Played)`
  completes a user, with no last-played date and no `BaselineAt`/`GraceStartAt` floor); `RetentionEvaluation` has no
  concurrency token, and `RetentionTargetReset.ResetAsync`, `ForgetRepresentationEvidenceAsync` and
  `EntriesController.RestartGraceAsync` write evaluation rows outside the RET2-R4 target gate.
- **Trigger:** an evaluation row left `scheduled` with a past deadline after a reset. A listener batch that loaded the row
  before a reset and then saved a state or deadline change would overwrite `State`/`Deadline` while `BaselineAt` and
  `RequiresFreshCompletion` from the reset survive; the live check would then accept a reattached old played state on
  the re-acquired file. Why it does not happen: every `PreviewAsync` first runs `EvaluateAllAsync`
  (`RetentionPreviewService.cs:35`), the executor previews again inside the library lease and a third time in
  `ExecutePreparedUnderLeaseAsync`, and reconciliation's resets run under the same library lease, so the row is
  re-evaluated with the floor before any unlink. A batch that recomputes the same state writes nothing (`SaveAsync`).
- **Impact:** none today; the last guard is weaker than the evaluator and depends on that ordering staying as it is.
- **Fix direction:** in `BlockReasonAsync` with `requireCompletion`, read the target's evaluation and count a user only
  when a state is played with `LastPlayedDate` at or after `max(BaselineAt, GraceStartAt)` (the multi-episode file check
  at `:121` already reads the date-less form; give it the same floor). Optionally mark `BaselineAt` and `GraceNotBefore`
  as concurrency tokens so a save over a reset throws and the existing retry re-reads.
- **Acceptance:** protection suite: a prepared operation whose evaluation says `scheduled` and whose only played state
  predates `BaselineAt` ends `blocked/live_not_completed` with the file byte-identical.

## RET3-R5 — Identity evidence: one-day air-date tolerance, and monitored rows at hidden covered numbers

- **Priority:** P3 (gated: `EpisodeUpgradesEnabled` is off by default). **Plausible.**
- **Location:** plugin, `JellyfinMod/Data/Episode.cs:59` (`Math.Abs(days) <= 1` counts as agreement);
  `JellyfinMod/Services/SeriesMetadataRefresher.cs:37–38` (the same rule adopts position rows on Refresh);
  `EntriesController.cs:572–577` (an Add computes covered numbers from the adding user's visible episodes);
  `SeriesMetadataRefresher` (a Refresh creates monitored file-less rows without the covered check).
- **Trigger:** daily shows (talk shows, soaps, some anime) air consecutive episodes a day apart, so a TVDB/TMDB numbering
  offset of one passes the air-date test and the binding is verified (or the position row adopted) although the file is
  the neighbouring episode. Live on 18096: S01E12 is a monitored TMDB row with no file because Jellyfin 12 hides
  `S01E11-E12.mkv` as a version of E11, so the Refresh never saw the number as covered; E17 stays monitored with an
  unverified file bound.
- **Impact:** with upgrades enabled, a "better" S01Enn imports and the replacement of a correct, possibly unwatched
  neighbour is no longer refused; with automation on, present episodes (E12, E17) can be searched for again. No effect
  on reclaim, which needs the file's own completion.
- **Fix direction:** treat a one-day gap as agreement only when the series' listed episodes are not themselves a day
  apart (or require the title to agree as well when the gap is nonzero); apply `CoveredUnverified` in the Refresh path
  too, and read covered numbers from the plugin's own bindings and `IndexNumberEnd` rather than the caller's visibility.
- **Acceptance:** Phase 2 suite with a daily fixture (air dates one day apart, numbering off by one): the binding stays
  unverified; after a Refresh of the 18096 fixture no monitored file-less row exists at a number a bound file covers.

## RET3-R6 — Post-unlink persistence is not retried, and each reclaim re-evaluates every target three times

- **Priority:** P3. **Verified** in the code; the run duration measured live (19 s for a run with nothing eligible).
- **Location:** plugin, `JellyfinMod/Services/RetentionExecutor.cs:318–335` (unlink, then `SaveChangesAsync` marking
  `unlinked`, then completion in its own transaction), `:234–242` (recovery of a `prepared` operation whose file is gone
  ends `vanished`, "nothing proves this plugin removed the file"); `RetentionPreviewService.cs:35`
  (`EvaluateAllAsync` in every `PreviewAsync`; `ReclaimAsync` previews three times per action); `RetentionEventListener.cs:158–169`
  (a policy change runs another full batch concurrently); `RetentionRunner.cs:144–149` (any exception ends the run
  `failed`; no per-action retry). The database is in WAL mode, so the observed `database is locked` is write-write
  contention past the busy timeout.
- **Trigger:** SQLite busy at the write right after `UnlinkPinned` (the same condition that gave the preview a 500 on
  the loaded Pi while the listener re-evaluated 580 targets), or the host stopping in that instant.
- **Impact:** the file is gone while the operation stays `prepared`; the next run records `vanished`: no `reclaimed`
  history, no binding removal, no T7 reset and no forget of the reclaimed item's evidence until the absence pass runs,
  no T14 series state. No wrong deletion follows: the binding's file is absent so its row blocks, and a sibling is
  protected by the live check exactly as under the any-copy rule. Before the unlink a busy database only aborts the run,
  which deletes nothing, and a `prepared` operation is fully re-validated by recovery. With per-episode targets (583 on
  18096, more in production) a 25-action run costs about 75 full evaluations, holds the execution gate, and makes an
  administrator's Keep wait for the gate between actions.
- **Fix direction:** retry the two post-unlink writes on SQLite busy (bounded, with a short pause) and log at error if
  they still fail; evaluate all targets once per run (or per action, not per preview) and let the in-lease previews
  re-evaluate only the action's targets; consider a `RetentionEvaluation`-level "last evaluated by run" so recovery can
  tell a plugin unlink from an external removal (`PhysicalIdentity` of the prepared operation against the absence).
- **Acceptance:** `Retention/Runs/Latest` for a 6-reclaim run on 18096 completes in well under the scheduled task's
  limits with `failed 0`; a suite run with a busy handler injected after the unlink still ends `completed/reclaimed`.

## RET3-R7 — A per-file Keep that stops applying is silent, and it re-applies to whatever lands at its path

- **Priority:** P3. **Verified** in the code.
- **Location:** plugin, `JellyfinMod/Data/VersionKeep.cs` (keyed by path and physical identity, never by binding),
  `RetentionPreviewService.cs:44–46,254,335` and `RetentionLiveCheck.cs:51–54` (matched by path or identity, across
  entries in the live check); nothing removes or reports a `VersionKeep` whose path and identity no longer match a bound
  file.
- **Trigger:** the cross-filesystem move of RET2-R9, a rename with a copy-and-delete, or a library root moved; later a
  different download at the old path.
- **Impact:** the moved file reads not kept with no History saying the Keep detached (safe: RET2-R1 resets it, see the
  table above); the orphan row keeps protecting the old path forever, so a future file there is kept without anyone
  having kept it, and the detail says "kept" with no event behind it. Over-protection only.
- **Fix direction:** when reconciliation removes or re-paths a binding, write `version_keep_detached` for any
  `VersionKeep` of that entry that now matches no bound file, and either delete it or show it in the detail as
  detached; on 18096 today `VersionKeeps` is empty, so no data migration is needed.
- **Acceptance:** protection suite: after the RET2-R9 move the entry's History has one `version_keep_detached` and the
  keep count is zero (or the detail lists it as detached); a new file at the old path is not kept.

## RET3-R8 — The deployed web bundle was built from an uncommitted tree

- **Priority:** P3 (provenance). **Verified** from Health on 18096: `WebCommit` `02f7294d99-dirty`, bundle
  `2c491b82fa5c`, built 11:12:51Z, served since 12:18:29Z; the fix record names the bundle as `02f7294d99`.
- **Impact:** the browser evidence for RET2-R5/R7/R10 was gathered on a bundle whose exact source is not a committed
  revision (the driver and probe were committed later in `5d9d347a40`, which changed no `src/` file, so the difference
  is most likely only those scripts, but the record cannot show it).
- **Fix direction:** rebuild and redeploy from `e3b70a3cc8` (or the rebased tip) before the final acceptance pass, and
  record a clean `WebCommit`.
- **Acceptance:** Health `WebCommit` without `-dirty` and equal to a commit on the branch.

## RET3-R9 — Checked and dismissed (recorded so the next reviewer need not repeat them)

- Deadlock and starvation of the RET2-R4 gate: analysed above (lock order execution → library → target, no re-entrancy,
  the gate waited before `try`).
- The batch-overwrites-a-reset race: a batch that recomputes the same state writes nothing; when it does write, the
  reset's `BaselineAt`/`RequiresFreshCompletion` survive and the run's own evaluate-all under the library lease corrects
  the row before any unlink (RET3-R4 keeps it as hardening).
- Migration `PhaseTenRetentionFixes` on the drifted 18096 schema: the pre-deploy backup carries exactly the two index
  names the migration drops; the live copy has the new unique index, both new columns, the history row, clean
  `integrity_check` and `foreign_key_check`; counts only grew (entries 160→162, episodes 531→815 from the Refresh's
  file-less rows and the covered rows, bindings 514→526, history 265→367, evaluations 567→583, observations 2244→2830,
  operations 10→17 all `completed/reclaimed`, keeps 0→0). Both UPDATEs touch only the new columns; `Down` throws as
  decided (RET-R3). A fresh database is built by the full chain in the Phase 2 and Phase 3 suites, which pass.
- `AnnouncedDeadline` back-fill: the 14 back-filled rows are the 09:11:18.202 deadline of the first 3-minute window;
  parseable; only suppresses a duplicate event.
- The cron job's reach: `env.sh` sets `JFMOD_BASE=http://localhost:18096`, a state directory and media root under the
  test tree, the container name defaults to `jellyfinmod-test`; `cleanup` removes only `tv-p10a`, `tv-p10b`,
  `movies-p10`, `p10-seed` under that root, the two fixture libraries by name on 18096, the remembered entry ids and
  `query=JellyfinMod` matches on 18096, and `/dev/shm/tv-p10c` inside the test container; the full library scan and the
  reconciliation it runs never unlink. The production clone's roots are read-only in the container; 28096 and 8096 are
  not named anywhere. The deployed script and driver are byte-identical to the committed ones; the job ticked at 12:50Z
  and exited before its target time as designed; the anonymous Health gate returns 401 as the script expects.
- Phase-b expectations against the current 18096 state: E04 (`GraceNotBefore` 12:03:11 → due 25th 12:03Z), E10-B (12:03:14)
  and `S01E09-E10` (own completion 11:32:46, covered E10 due, file finished by the selected user) reclaim; E01 waits
  (last-played 11:32:44 before `BaselineAt` 11:43:36; note E01-B is **no longer kept per file** on 18096, the browser
  probe's toggles ended with an un-Keep at 12:03:27, so tomorrow tests RET2-R1 alone, which is the stronger case); E03
  has a two-day window and is then series-kept; E05 backlog, E06 seeding, E11 grouped, E16/E17/E18-E19 unwatched, the
  movie `versions_untracked`; E02/E07/E13/E14 already reclaimed and reset. Their stale observations (`bound=0`) are
  filtered by bound item and floored by `BaselineAt`, so a returning file cannot revive them.
- RET2-R2 while retention is disabled: `RestartGraceAsync` sets `GraceNotBefore` and leaves the `disabled` row; the
  Disabled→Scheduled transition applies it (`RetentionEvaluator.cs:357–358`).
- `EpisodeIdentityEvidence.Agrees` with empty titles: guarded (`key.Length > 0`); null air dates never agree.
- The Add deviation (a row stays monitored when the covering file carries its TMDB id): a native TMDB id is real
  evidence and reconciliation then binds by TMDB id, verified.
- `IdentityUnverifiedAsync` reads by binding id in `EpisodeBindings` only, so the replacement guard cannot misfire on a
  movie binding, and replacement of a multi-episode file stays refused in `Inspect`.
- Observations are one row per target and user (`RetentionCompletionService.cs:54–56`), so `ForgetRepresentationEvidenceAsync`
  removes a user's evidence only when it was read through the reclaimed item, and the next evaluation re-reads through
  a remaining binding (`RetentionEvaluator.cs:262–273`).
- Authorization of the five write endpoints unchanged (`RequiresElevation`); the version Keep checks the binding's
  episode belongs to the entry.

## Verdict

No P1. I found no path by which the fixed engine unlinks a file that was not completed by a play recorded after its
floor, and no new path to a Jellyfin 12 version the plugin does not track. RET2-R1 and RET2-R2, the two "deletion with
no window" cases of the second review, are closed in the code and on 18096; RET2-R3's guard stands at every executor
boundary; the migration is forward-only, applied cleanly on the drifted 18096 database and on fresh databases, and loses
nothing.

**Rebase and merge:** `p10-retention` is safe to rebase onto plugin `master` `f443a62` and to merge with retention
disabled, on the condition in RET3-R2: resolve `JellyfinNativeTitleSource`/`VersionsUntracked` against the retarget
without weakening the guards, run the suites on the rebased branch, and treat the two-file movie on Jellyfin 12 as
untested until it is re-run live, because the retarget lifts `versions_untracked` for movies. Nothing on the branch
deletes while retention is disabled (reclaim and replacement both refuse).

**Enable on real media:** yes, once (1) the 2026-09-25 12:30Z real-window run passes as expected (E04, `S01E09-E10`,
E10-B reclaimed; everything else byte-identical, E01's two files included; fixtures gone; crontab line gone; retention
off) and its log is read to the end, (2) RET3-R2's live movie case passes on the rebased build, and (3) the operator
accepts the designed behaviour for movies, which is unchanged by this work but easy to forget: movies keep the Phase 3
rule (grace from the first switch-on, no fresh-watch requirement), so every movie the policy users have ever finished
becomes due one window after the first enable, and under Q9 a later off/on neither restarts those countdowns nor gives
anything watched while off a fresh window (such titles read "overdue" and go at the next run). RET3-R1 should be fixed
in the repository now and its recovery run by hand if tomorrow's log shows a failed safety path; RET3-R3 to RET3-R8 are
hardening and evidence work for the next slice and do not block enabling.

## Fix record — 2026-09-25 (Opus 5.5, high)

Plugin `p10-retention`, rebased onto `master` `f443a62` (Jellyfin 12.0.0, .NET 10): `b93f605` (decision 12), `7fe53c1`
(RET3-R3–R7 and the database lock), `30421c2` (RET3-N1), `2e90a54` (writer names in the lock diagnostics), `15589f1`
(merged-version guard). Web `p10-retention`, rebased onto `jellyfin-mod` `a279641ebf`: `8204941858` (RET3-R1),
`34c079cb94` and `c22c90abb3` (driver), `c61e89f56d` (overdue wording). Neither branch is pushed. Deployed on 18096:
plugin DLL SHA-256 prefix `0ad08f5b323fc784` (`15589f1`), web bundle `350e27ced474` from the clean tree at `c22c90abb3`;
backup `p10r3/backup-20260925T004520Z`. All live checks ran on 18096 with a tagged fixture set (`RET3`) of their own,
signed in as `oleksii` with an empty password. The set has been removed. **Retention is off on 18096.**

| Finding | Fix | Evidence |
| --- | --- | --- |
| RET3-R1 | The wrapper writes `phase-b.STARTED` before phase B, then on every tick runs `safe-finish`. That step restores (6 tries), cleans up (3 tries) and verifies (3 tries) from the instance. `phase-b.DONE` and the line removal happen only after `safe.OK`. Otherwise `phase-b.FAILED` counts the attempts, the log and syslog say so, and the job stays armed. `cmd_phase_b` nests restore and cleanup and retries the preview. | Rehearsed live on the `RET3` set with a fake crontab (`JFMOD_CRONTAB_FILE`). **Tick 1**, with restore failure injected: 6 restore failures. Cleanup met a 409 on four entry deletes during the library scan, retried and removed everything. Verify failed 3×. `FAILED=1`, no `DONE`, crontab file byte-identical, **retention still on**, syslog line `SAFETY PATH FAILED (attempt 1)`. **Instance down** (base URL on a closed port): `instance not answering (Health 000)`, still no `DONE`. **Tick 2**, normal: restored, then verified (retention off, test window 0, seed source back, every entry 404, no `JellyfinMod RET3` item, library or directory). Result: `safe.OK`, `DONE`, `FAILED` cleared, only its own line removed; the sentinel line and the inject line kept. |
| RET3-R2 | `VersionsUntracked` is the union of `LocalAlternateVersions`, `LinkedAlternateVersions` (resolved through `ItemId`; an unresolvable link counts as untracked), `GetLocalAlternateVersionIds` and `GetLinkedAlternateVersions`. An exception counts as untracked. A two-file movie is blocked unless every file is tracked. | Live, two-file movie: both files tracked. Finishing the 1080p marked the 720p played with no last-played date (C9), which does not count. 720p reclaimed at its deadline; 1080p kept by itself and byte-identical. After un-Keep, the 1080p went at the end of its own window and the entry read reclaimed. Suites on the rebased branch pass (below). |
| RET3-R2 follow-up (C2, new) | Live, a copy in a second library merged into the tracked movie (Jellyfin 12 records the merge on the main item only) was **reclaimed** at the end of its window. The preview now blocks any file another tracked title lists as its linked version (`15589f1`). | Re-run live after the fix: merged copy blocked `versions_untracked`, byte-identical after its deadline. The protection suite covers it. |
| RET3-R3 | Bindings store `FileFingerprint` (physical identity plus size and mtime, from `statx`). A known path whose fingerprint changed is an arrival and resets the target (History "Retention restarted: a file was replaced in place", reason `replaced_in_place`). | Live: a scheduled fixture overwritten at the same path was reset with that History entry; a new watch scheduled it one window out. Protection suite `VerifyFileIdentityAsync`. |
| RET3-R4 | The live check requires Played, position 0 and a last-played date at or after the fresh floor (`RetentionEvaluator.FreshFloor`); a missing evaluation fails `live_not_completed`. Resets and `RestartGraceAsync` run under the per-target gate. `BaselineAt` and `GraceNotBefore` are concurrency tokens. | Protection suite: a stale or undated played state is refused `live_not_completed` inside the lease. |
| RET3-R5 | The air-date fallback counts only when exactly one listed episode is within a day of the file's date. Refresh leaves rows at covered numbers unmonitored, unmonitors an existing monitored unbound row there, and records `episode_unmonitored`. Add unions the covered numbers. | Phase 2 suite: daily and weekly fixtures. Live `covered-refresh`: every covered row without a file of its own unmonitored, with History entries. |
| RET3-R6 | The two writes after an unlink retry on a busy database (8×10 s, then log at error). A run evaluates each action's targets only, including every title bound to the same file; full evaluations are serialized and coalesced. | Live run: 3 reclaimed, 0 failed, 21.5 s. Protection suite `VerifyUnlinkSurvivesBusyDatabaseAsync` holds `BEGIN IMMEDIATE` for 40 s across the unlink and ends `completed/reclaimed`. |
| RET3-R7 | Reconciliation removes a `VersionKeep` that matches no binding by path or physical identity and records `version_keep_detached`. | Protection suite, after the RET2-R9 move: one `version_keep_detached`, and the Keep does not re-apply at the old path. |
| RET3-R8 | The bundle is built from a committed tree. | Health `Web.WebCommit` `c22c90abb3` (a branch commit, no `-dirty`), bundle `350e27ced474`. |
| RET3-N1 (new) | Found live: the RET2 probe user's access change pushed the P10 deadlines back a day. An off/on after that would have used the pre-change date instead of the announced one. When a prior deadline is kept, grace now also stays at or after it (`30421c2`); an access or policy change with no prior deadline restarts grace from now. | PhaseTen suite: off/on after an access change keeps the announced date. P10 set on 18096: grace start, announced deadline and baseline identical to the pre-deploy backup across three switch-ons (test window 3, then 0) and a switch-off. |
| Decision 12 | See PHASE10 §7. | Migration `PhaseTenMovieBacklog` applied at startup on 18096. Live: a movie watched before tracking stays `waiting` with History `retention_rule_changed`. PhaseTen suite: migration check on a pre-migration database. |
| `database is locked` | Evidence: on the Pi before the fix, one evaluation commit held the write lock 2–17.4 s under disk load. The listener committed once per target, and a preview ran its own full evaluation behind it for over 300 s. On 18096 a library scan held it 19.7 s. Fix: full evaluations serialized and coalesced, busy retries (1, 3, 8 s) on whole evaluations and on `SaveChanges` outside a transaction, targeted evaluation in the executor, `SqliteWriteDiagnostics` naming every holder. | PhaseTen suite (600 episodes, 20 movies, concurrent previews, Keep and a second switch-on, disk load): every request 200. Live `lockcheck`: switch-on, then two previews 200 in 23.1 s and 37.7 s, and the seed PATCH 200 in 0.1 s. This ran on the RET3 build before `2e90a54` and `15589f1`, which do not touch the write path. |
| Overdue wording | "these 2 files was due" → "were due" (`c61e89f56d`). | Browser. |

**Browser**, `retention-controls.mjs` on the deployed bundle, in Chromium 153.0.8010.12 then Google Chrome 153.0.8010.53.
Pass 1 (test window 3 minutes, overdue and covering row) and pass 2 (real window: warning, Keep inside it, Stop keeping,
window select, synced cause, per-file Keep by keyboard, Back key): all pass on desktop, mobile, TV 1080 and TV 720, with
no page errors. Physical webOS not tested.

**Suites:** the full Pi run on `15589f1` is handed to a verifier (checklist `.claude/briefs/verify-retention-r3.md` in
the workspace). Before `15589f1`: all twelve passed on the rebased tree, and ThreeProtection and PhaseTen passed again
after the later changes. **Suites verified on `15589f1`** (Sonnet-high verifier, 2026-09-25: all twelve `exit=0`), and
again after the fourth review and the rebase onto the S11 release: **suites verified on `348168b`**.

**The real window's positive half is still unproven.** The P10 set's deadlines had moved to 2026-09-26 (RET3-N1), so
the 2026-09-25 12:30Z job could not test it. The P10 set was removed by the deployed `safe-finish` on 2026-09-25 at
03:49Z (verified: retention off, settings restored, both entries 404, nothing left). Replacing the job was refused twice
by the permission system, so its crontab line still stands. At 12:30Z it runs phase B against no fixtures. The phase
stops before switching retention on, because the fixture series is missing. `safe-finish` then verifies the instance
safe, writes `DONE` and removes the line. A new real-window run on this build needs the crontab change, which the user
must allow or make.
