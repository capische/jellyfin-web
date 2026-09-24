# Retention delete-path review — 2026-09-24

Adversarial verification of the per-media (per-episode) retention delete path before it is allowed
near real media. Reviewed plugin branch `p10-retention` at `9d6d261` (`5637362` + `9d6d261` on top of
`cdb6e7b`; `master` is two commits ahead with unrelated P7.S5 image work) and web `p10-retention` at
`5bf66d02a4` (`83c75e3783` + `5bf66d02a4` on `14694a355d`). Verifier: Fable, high effort. Verification
only: no product code, no deployment and no instance was changed.

What was checked, and how:

- Code: `ReconciliationService`, `RetentionEvaluator`, `RetentionCompletionService`,
  `RetentionEventListener`, `RetentionPreviewService`, `RetentionLiveCheck`, `RetentionExecutor`,
  `RetentionRunner`, `SeriesMetadataRefresher`, `UpgradeService`, `EntriesController`
  (`KeepEpisode`, `CompleteConcurrentAdd`, `Remove`), `RetentionController`, the migration
  `20260924053825_PhaseTenEpisodeRetention` and its predecessors, `NativeEntryDetails.tsx`.
- Jellyfin 10.11.11 source (GitHub tag): `BaseItem.MarkPlayed`/`MarkUnplayed`,
  `PlaystateController.MarkPlayedItem`, `LegacyDateTimeModelBinder`, `SessionManager.OnPlaybackStart`
  and `OnPlaybackStopped`, `UserDataManager.UpdatePlayState`; jellyfin-web's `markPlayed` callers and the
  bundled apiclient's `getDateParamValue` (`toISOString()`).
- Isolated instance 18096, read-only, signed in as `oleksii`: Health (capability `retention.episodes`
  present, web bundle `5ad7f9a1af3d`), `Retention/Runs/Latest`, one `Retention/Preview` (567 rows, all
  `disabled/retention_disabled`: 514 episode rows, 53 movie rows, nothing due). Retention stayed
  disabled.
- Database: the pre-deploy backup and a read-only `.dump` of the current plugin database, rebuilt in a
  scratch directory. Current: 531 episodes, 514 position rows (`TmdbId = 0`), 514 bindings, 514 episode
  evaluations, every one `RequiresFreshCompletion = 1`, baselines 06:10:18–06:10:35Z on 2026-09-24;
  97 played episode observations exist and **0** carry a `LastPlayedAt` at or after the baseline; no
  fixture title remains; the recorded run row (06:22:09Z, inspected 573, eligible 1, blocked 47,
  reclaimed 1, 71 670 bytes, physical unknown 1) and its completed operation for the fixture's S01E05
  exist, entry detached as T10 designs. The P10 migration was applied by hand (the same statements
  `dotnet ef migrations script` emits) to copies of the backup in both index shapes; the `Down` step was
  applied to a copy of the current database.
- Suites, locally on macOS from the p10 worktree: `PhaseTwoIntegration` and `PhaseThreeIntegration`
  pass. `PhaseThreeProtectionIntegration` and `PhaseSixIntegration` require Linux file inspection and a
  download folder and cannot run here; they were not re-run.

Counts: P1 0 · P2 3 · P3 5. The verdict is at the end.

## RET-R1 — An unplayed file is unlinked because a sibling copy at the same position was played

- **Status:** **resolved by user decision, 2026-09-24** (PHASE10 Q7): any copy watched counts, unless a version is kept. The rule is unchanged in code and now explicit in PHASE10 §2; per-file Keep (plugin `b5a46fc`) is the exception. Live evidence with a two-binding episode and a kept copy: **not yet run**. Originally: open, verified in code. **Priority:** P2.
- **Location:** plugin, `JellyfinMod/Services/ReconciliationService.cs` (position rows:
  `ReconcileEpisodes`, the `positionGroup` loop binds every native episode of the entry at one season and
  episode to one row); `RetentionCompletionService.cs:88–107` (`finished = current.Any(...)`,
  `LastPlayedAt = Max`); `RetentionEvaluator.cs:282–292`; `RetentionLiveCheck.cs:85–107`
  (`current.Any(state => state.Played)`); `RetentionRunner.cs:100–112` (lowest quality first).
- **Trigger:** a library holds the same series in two roots (two native series items with one TMDB
  series id), or any two separately resolved native episodes that parse to the same season and episode
  number. Retention is enabled; a policy user finishes one of the two files.
- **Cause:** the two files are versions of one target. Completion, the evaluator's schedule and the last
  live check all accept "played on any bound item", and the runner deletes the lowest-quality binding
  first. Nothing before the unlink checks the played flag of the file actually being unlinked. Identity
  here rests on filename parsing alone: neither a provider id (as for TMDB rows and movies) nor
  Jellyfin's own version grouping (merged episodes are blocked by `episode_versions_untracked`).
- **Impact:** a file no user has played is deleted. When the two copies differ in content at that
  position (DVD versus aired order, a different cut, a mis-numbered rip) the wrong episode is lost.
  The rule itself predates P10 (PHASE3 T8, "finishing any version completes the target", accepted for
  version groups Jellyfin identifies); P10 extends it from 0 to every episode of a TVDB-scraped
  library, and the user's verbatim decision asks for control "per media file".
- **Fix direction:** before the unlink, require the binding's own native item to satisfy the watched
  rule for the same users (an additive check in `RetentionLiveCheck`, and the same rule in the evaluator
  or preview so the row is not reported due). Keep the any-version rule for resume and favourite
  protection, which only ever protects. Alternatively record this as an explicit user question beside
  PHASE10 Q1–Q5 and keep the rule; the default that deletes less is the per-file check.
- **Acceptance:** a disposable series present in two roots of the isolated test library, both files
  tracked as one position row with two bindings (confirm two `EpisodeBindings`), Selected user
  `oleksii` finishes copy A only, fast window. The run unlinks A; B stays byte-identical and its row
  reads `blocked/live_not_completed` (or an equivalent stable reason); after B is watched it goes on
  its own schedule.

## RET-R2 — Adoption by position assumes TVDB and TMDB number episodes alike, and Add turns the adopted rows on

- **Status:** **fixed in code, plugin `b5a46fc`, not yet verified live.** Add never adopts or monitors a position row and never creates a row at its position; Refresh adopts only on air-date or title evidence and records `episode_adopted`; an upgrade replacement needs the watched rule (preview requires a scheduled evaluation, the live check requires completion). Originally: open, plausible. **Priority:** P2.
- **Location:** plugin, `JellyfinMod/Api/EntriesController.cs:423–432` (`CompleteConcurrentAdd`:
  `positional.TmdbId = remote.TmdbId; … positional.Monitored = true`),
  `JellyfinMod/Services/SeriesMetadataRefresher.cs:91–100`, `JellyfinMod/Services/Automation/
  UpgradeService.cs:107–166` (`ReplaceAsync` → `RetentionExecutor.ReplaceAsync`, which skips the
  watched rule by design, P6.M5).
- **Trigger:** a TVDB-scraped series is tracked by position. Any user with library access posts the
  same series to `POST /JellyfinMod/Entries` (an existing entry completes through
  `CompleteConcurrentAdd`), or an admin presses Refresh. TMDB numbers the season differently from TVDB
  (split or merged pilots, specials, anime).
- **Cause:** a TMDB episode listed at season S episode E is written onto the position row at (S, E)
  with no evidence that the native file is that TMDB episode. The Add path also sets `Monitored`.
  From then on the row claims a TMDB identity the file does not have; monitoring searches for that
  TMDB episode; an upgrade of it imports a different episode as "the better version" and the
  replacement unlinks the original file without the watched rule (only Keep, seed, session, resume and
  favourite protect it). Reconciliation's own adoption (`IsAdoptable`) is sound, because there the
  native item itself reports the id.
- **Impact:** wrong-identity rows across a series, and one concrete deletion path outside retention
  that removes a correct file. Requires monitoring plus upgrades for the entry; not the default for
  discovered rows, but one ordinary-user Add flips every adopted row of a series.
- **Fix direction:** adopt from a TMDB listing only when the position can be trusted (the native
  episode carries the id, or the series' TMDB and TVDB orders are known to agree); at minimum leave
  `Monitored` alone on adoption in `CompleteConcurrentAdd` (Add of an existing on-disk episode is not a
  wish to search for it) and record adoption as a history event so it can be audited.
- **Acceptance:** a fixture series whose TMDB season lists an episode at a position the TVDB files
  number differently; after Add by an ordinary user, no position row is monitored and no row carries a
  TMDB id its native item does not report; an admin Refresh records what it adopted.

## RET-R3 — The migration cannot be rolled back, and the old assembly breaks on the new data

- **Status:** **addressed in code and docs, plugin `b5a46fc`, restore not yet exercised.** Both Phase 10 migrations are forward-only (`Down` throws with the reason); PHASE10 §2 *Rollback* states the database-restore rollback. Originally: open, verified. **Priority:** P2.
- **Location:** plugin, `JellyfinMod/Data/Migrations/20260924053825_PhaseTenEpisodeRetention.cs`
  `Down` (drops the two columns and recreates `IX_Episodes_EntryId_TmdbId` unique and unfiltered);
  pre-P10 `SeriesMetadataRefresher` and `EntriesController` (`ToDictionary(episode => episode.TmdbId)`).
- **Trigger:** any attempt to downgrade after position rows exist, or to run the previous DLL on a
  database this build has migrated.
- **Cause:** `dotnet ef migrations script <P10> <previous>` fails ("SQLite does not support
  DropColumnOperation" under the pinned EF tooling), and the hand-applied `Down` fails on the current
  database with `UNIQUE constraint failed: Episodes.EntryId, Episodes.TmdbId` because every position row
  of a series shares `TmdbId = 0`. Running the previous DLL on the migrated database keeps the schema
  (EF ignores unknown applied migrations) and throws `ArgumentException` on duplicate key `0` in Refresh
  and Add for any series with two or more position rows.
- **Impact:** the only rollback is restoring the pre-deploy database backup, which loses every Keep,
  history event, evaluation and operation recorded since the deploy. PHASE10 §"Migration of existing
  data" describes the forward path only.
- **Fix direction:** either make `Down` viable (delete position rows and their bindings, observations
  and evaluations first, and say so) or state in PHASE10 and the release notes that this migration is
  forward-only and the rollback is a database restore; record the backup location and verify the
  restore once on 18096.
- **Acceptance:** the documented rollback executed once on the isolated instance: previous DLL plus
  restored database serve Health, Refresh and Add without errors; the forward-only statement is in
  PHASE10.

## RET-R4 — The backlog rule starts at tracking, not at enabling

- **Status:** **fixed, plugin `f4d427c`, per the user's answer to PHASE10 Q1 (2026-09-24), not yet verified live.** The fresh-completion floor for episodes is the later of first tracking and the last enable; the mark-played consequences are stated in PHASE10 §3. Originally: open, policy question. **Priority:** P3.
- **Location:** plugin, `JellyfinMod/Services/ReconciliationService.cs:1017–1034` (`BaselineAt = now`
  at first binding), `RetentionEvaluator.cs:309` (`eligibleAt = Latest(completion, EnabledAt, BaselineAt)`).
- **Trigger:** the plugin is deployed (episodes tracked) weeks before retention is enabled; users watch
  in between.
- **Cause:** a fresh completion is one with Jellyfin's last-played date at or after the **binding**
  time. Everything finished between deploy and enable is therefore fresh, and enabling schedules it all
  for `EnabledAt` plus one window. This matches the accepted movie rule (grace starts at enable) and
  the preview shows it, but PHASE10 S1 reads "turning this on deletes nothing that was watched before
  tracking", which is literally what the code does; "before enabling" would be a different rule.
- **Impact:** on 18096 today 0 of 97 played episode observations are fresh, so enabling now schedules
  nothing; on production the interval between deploy and enable decides the size of the first wave.
- **Fix direction:** put the choice to the user with Q1: keep the tracking baseline (current), or
  move episode baselines to `EnabledAt` when retention transitions from disabled to enabled so that only
  watching after enabling counts. Also record, from the Jellyfin source, that "Mark played" counts as
  fresh only when Jellyfin had no earlier last-played date for the item (`MarkPlayed` keeps an existing
  `LastPlayedDate`; `MarkUnplayed` clears it), that the modern web toggles without a date, and that
  "mark series played" from a series page dates every episode now and so makes the whole series due
  one window later.
- **Acceptance:** PHASE10 Q1 answered and the chosen rule stated in one sentence in PHASE10 §3, with
  the mark-played consequences beside it.

## RET-R5 — The live evidence never exercised an episode with two bindings

- **Status:** **open.** The two-root fixture, the committed driver and the real-window positive half are planned in the PHASE10 handover and not run yet. **Priority:** P3.
- **Location:** web, `docs/jellyfinmod/PHASE10.md` §Evidence, E5.
- **Trigger:** reading the E5 run as proof of per-version episode retention.
- **Cause:** the fixture's "E01 in two versions" was merged by Jellyfin into one item with alternate
  media sources, so it became one binding and was blocked (`episode_versions_untracked`). The current
  database has no episode with more than one binding. Hence lowest-quality-first ordering for
  episodes, the shared-inode rule across two episode bindings and RET-R1's scenario have no live
  evidence. Further gaps the document itself names: the real-window positive half, the ordinary-user
  403 (only the test-authentication suite), physical webOS. The fast-window run is prose only (no script
  or log in either repository), so it cannot be re-run as written. `PhaseThreeProtectionIntegration`
  is Linux-only and was not re-run in this review; `PhaseTwoIntegration` and `PhaseThreeIntegration`
  pass locally.
- **Impact:** the acceptance claim for per-version episode behaviour rests on code reading.
- **Fix direction:** add a two-root fixture to E5 (this doubles as RET-R1's acceptance) and commit the
  live-run driver or its log under `scripts/jellyfinmod-e2e/` so the run is reproducible; report the
  real-window positive half when the day has passed.
- **Acceptance:** E5 evidence names a two-binding episode with per-binding outcomes, and the run
  driver is in the repository.

## RET-R6 — Fresh installs get a different index shape from 18096

- **Status:** **fixed in code, plugin `b5a46fc` (migration `PhaseTenRetentionControls`), not yet checked on a fresh-chain database or 18096.** The index is recreated non-unique everywhere. **Priority:** P3.
- **Location:** plugin, `Data/Migrations/20260911042407_PhaseTwoBindings.cs:57–60` (recreates
  `IX_Episodes_EntryId_SeasonNumber_EpisodeNumber` **non-unique**); the 18096 database still carries the
  Phase 1 **unique** index; `ModDbContext.cs:111` declares it non-unique.
- **Trigger:** deploying to a database created by the full migration chain (production will be one).
- **Cause:** drift on 18096. On a fresh-chain database a TMDB row and a position row can coexist at
  one (entry, season, episode) (inserted on a copy: succeeds; on the 18096 shape: `UNIQUE constraint
  failed`). Reconciliation guards against creating that pair (`ReconcileEpisodes` skips a provider row
  where a position row holds the position, and a native item already bound to one row is never claimed
  by another), so no file is tracked twice and nothing extra becomes due; but PHASE10 S3's "unique
  indexes make a duplicate a hard failure rather than silent" holds only on 18096, and every migration
  check so far ran on the drifted shape.
- **Impact:** a silent duplicate on production would show as two episode rows for one position (one
  file-less), not as a deletion.
- **Fix direction:** decide the intended shape and align it with a migration (or drop the drift on
  18096 to match the chain), then repeat the E1 migration check on a fresh-chain copy.
- **Acceptance:** `ModDbContext`, the migration chain and 18096 agree on the position index; the E1
  check passes on a database created from an empty file.

## RET-R7 — Episode-page Keep falls back to the whole series without saying which control it is

- **Status:** **fixed in code, web `0d89e18537`, browser check not yet run.** The button reads Keep series and the message names the series wherever the page's episode is not tracked. **Priority:** P3.
- **Location:** web, `src/apps/modern/features/jellyfinmod/components/NativeEntryDetails.tsx:74–92`
  (`episode` lookup by page item id or version ids; `keepsEpisode` requires a match and the
  `retention.episodes` capability; otherwise `keepEntry`).
- **Trigger:** an episode page whose item the plugin did not track: an unnumbered special, an episode
  skipped as a conflict, or an alternate-version item id before E7 tracks merged files.
- **Cause:** the mod section still renders (the series resolves) and the button keeps the series; the
  message says "This title will be kept", which is accurate but not what the page suggests.
- **Impact:** over-protection only (no deletion risk); an admin may believe one episode was kept.
- **Fix direction:** on an episode page without a tracked episode, label the button "Keep series" or
  disable it with a short reason.
- **Acceptance:** browser check on an unnumbered special: the button reads "Keep series" and the
  message names the series.

## RET-R8 — Checked and dismissed (recorded so the next reviewer need not repeat them)

- **Status:** no finding. **Priority:** P3 (informational).
- Clock and time zones: the Pi runs NTP with a hardware clock; the container is `Australia/Sydney`
  and the host `America/Chicago`, but every value compared is UTC. Playback sets `LastPlayedDate =
  DateTime.UtcNow` at playback start (`SessionManager.OnPlaybackStart`); `OnPlaybackStopped` and
  `UpdatePlayState` do not touch it; the web's mark-played sends `toISOString()`, which the
  `LegacyDateTimeModelBinder` passes to the default binder as UTC. A legacy `yyyyMMddHHmmss` client would
  be parsed with `AssumeUniversal` (local kind, +10 h here), which only delays counting.
- A play that starts before the binding and finishes after it carries the start time and does not
  count; a future-dated `datePlayed` does not count until the clock passes it; `MarkUnplayed` then
  `MarkPlayed` counts (new date). All in the conservative direction.
- Watched-user modes: All requires every accessible active user to have a fresh completion, Selected
  the chosen user, Any at least one; missing users are read live; a disabled or removed user leaves the
  set; a deadline is never shortened by access or policy changes (`priorDeadline`).
- T7: reclaim and unbind both call `RetentionTargetReset`; a returning file at the same native id
  with reattached user data stayed `waiting` live (baseline = reclaim time). Verified in code and in
  the recorded run.
- T8/T9/T10/T18: live check is the last step inside the lease; recovery runs first; cancellation is
  honoured only before the unlink; `media_not_writable` uses `access(dir, W_OK|X_OK)` and blocks
  read-only mounts before prepare; Remove returns 409 while operations are open; Refresh is
  metadata-only and preserves unmatched rows, including position rows. Hardlinks: a pre-unlink link
  count above one records zero physical bytes; the last link records "unknown"; the shared-inode rule
  blocks unless every affected binding is due. Seed protection is per physical identity and unchanged.
- Keep: read by the evaluator, the preview replacement path, `RetentionLiveCheck`, `UpgradeService`
  and the summaries; the endpoint serialises on the retention gate and library lock; window chain
  episode days → series days → global; series Keep wins over an episode window. No path found where a
  kept episode becomes due or a deadline shortens.
- Merged files: the primary of a Jellyfin-merged episode is blocked by `episode_versions_untracked`
  at every preview the executor runs (initial, under lease, before unlink); confirmed live.
  Multi-episode files stay blocked (T16); covered episodes have no binding and are not targets.
- Authorization: `EntriesController` is `[Authorize]`; `KeepEpisode`, `PatchEpisode` and the
  retention controller carry `Policies.RequiresElevation`; the protection suite covers 401/403/200. An
  ordinary user influences retention only through their own Jellyfin play state (by design) and
  through RET-R2's Add path.
- Migration forward: applied to the backup copy on both index shapes with clean integrity and
  foreign-key checks and unchanged row counts (17 episodes, 53 evaluations, 161 history); the generated
  script matches the emulation. On the current database every position row is unmonitored and
  `RequiresFreshCompletion` is set on all 514 seeded evaluations.

## Verdict

No P1. I found no way, with default settings, to make the engine unlink a file whose target was not
completed by a genuine play recorded after tracking began, and every regression class from PHASE3
(T7–T10, T16–T18) still holds in code, with T7 also re-verified live. The migration preserves
existing data.

**Not yet safe to enable on real media as-is.** Before enabling:

1. Resolve **RET-R1** (per-file played check before unlink, or an explicit user decision to keep the
   any-version rule for position rows). This is the one change that stops a never-played file from
   being deleted, and it is what the user's verbatim decision asks for.
2. Answer **RET-R4 / PHASE10 Q1** (baseline at tracking or at enabling) with the mark-played
   consequences in view, and keep the E7 block in place until merged files are tracked.
3. Close **RET-R2** at least by not monitoring adopted rows on Add; it is a deletion path outside
   retention that P10 widens.
4. Before a production deployment (not before enabling on 18096): the rollback statement of
   **RET-R3** and the index alignment of **RET-R6**; the two-binding evidence of **RET-R5** should
   accompany the RET-R1 fix.

## Remediation — 2026-09-24 (Opus 5.5, high)

The user answered PHASE10 Q1–Q7 on 2026-09-24 and replaced Fable with a separate Opus 5.5 verifier at
high effort for all future verification. Status per finding is recorded under each finding above. The
fixes are committed on `p10-retention` (plugin `f4d427c`, `b5a46fc`; web `0d89e18537`) and are **not yet
deployed or verified live**; the PHASE10 handover lists the remaining acceptance. Automatic reclamation
stays disabled on every instance.
