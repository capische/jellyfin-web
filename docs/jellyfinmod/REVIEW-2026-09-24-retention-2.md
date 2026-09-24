# Retention delete-path review, second pass — 2026-09-24

Adversarial re-verification of the per-media (per-episode) retention delete path on branch `p10-retention`
before it may be merged and before automatic reclamation may ever be enabled on real media. Reviewed plugin
`p10-retention` at `ab4d464` (eleven commits on top of its merge-base with `master`) and web `p10-retention`
at `39393536ae` (sixteen commits on top of its merge-base with `jellyfin-mod`, product code through
`e02996a611`). Verifier: Fable, high effort. Verification only: no product code, no deployment and no
instance setting was changed; the only writes were this file and its commit.

What was checked, and how:

- Code, whole files: `RetentionEvaluator`, `RetentionPreviewService`, `RetentionLiveCheck`,
  `RetentionExecutor`, `RetentionRunner`, `RetentionCompletionService`, `RetentionEventListener`,
  `UnixFileInspector`, `MediaStorageIdentity.IsCurrent`; branch diffs of `ReconciliationService`,
  `SeriesMetadataRefresher`, `UpgradeService`, `VersionReader`, `RetentionPolicyService`,
  `EntriesController`, the contracts, `ModDbContext`, `Episode`, `RetentionEvaluation`
  (`RetentionTargetReset`, `RetentionOverrides`), `VersionKeep`, `RetentionPolicySnapshot`, the four Phase 10
  migrations; web `NativeEntryDetails.tsx`, `RetentionControls.tsx`, `RetentionWarning.tsx`, `modApi.ts`,
  `fileState.ts`; the live driver `scripts/jellyfinmod-e2e/retention-live.py`; the M5 replacement test in
  `PhaseSixIntegration` and the Keep checks in `PhaseThreeProtectionIntegration`.
- Documents: the three `CLAUDE.md`, PHASE10 (decisions 1–11, safety table S1–S19, evidence, handover),
  REVIEW-2026-09-24-retention (RET-R1..R8), PHASE3 T7–T18, the Jellyfin 12 multi-version analysis (C1, C2, C5,
  C7, C9, C10) and the user's decision brief.
- Isolated instance 18096 (host Jellyfin 12.0.0, plugin web bundle `934ad614dfd7` = web `e02996a611`),
  signed in as `oleksii`, GETs only: Health, `Settings/Retention` (**disabled**, All users, 14 days, test
  window 0, revision 15), `Retention/Runs/Latest` (09:20Z, inspected 576, reclaimed 0), the fixture series
  and movie entries with detail and History, and Jellyfin's own item and media-source view of the fixture
  files. No preview was requested (a preview writes evaluation rows). Retention stayed disabled.
- Pi, read-only over SSH: the phase-B state directory and `phase-b.sh` (a detached bash process started
  09:54Z that sleeps until 2026-09-25T10:30Z, starts the fake Transmission RPC, runs `retention-live.py
  phase-b`, and always restores settings and removes the fixtures through the driver's `finally`).
- Locally from the plugin worktree: Release build clean; `PhaseTwoIntegration` and `PhaseThreeIntegration`
  pass against temporary SQLite databases (`PhaseThreeProtectionIntegration` and `PhaseSixIntegration` are
  Linux-only and were not re-run).

Counts: P1 0 · P2 3 · P3 7 (plus one dismissed-checks entry). The verdict is at the end.

## Previous findings, re-verified against the code (not the status lines)

| Finding | Verified how | Result |
| --- | --- | --- |
| RET-R1 (any copy watched) | `RetentionCompletionService.cs:91–107`, `RetentionEvaluator.cs:304–315`, `RetentionLiveCheck.cs:120,133`; per-file Keep as the exception at `RetentionPreviewService.cs:254,337` and `RetentionLiveCheck.cs:51–54` | as decided (decision 6); live E01/E02 evidence recorded in PHASE10 |
| RET-R2 (adoption, monitoring) | `EntriesController.cs:558–568` (Add skips held positions, never adopts), `SeriesMetadataRefresher.cs:101–124` (Refresh adopts only on air date within a day or matching title, records `episode_adopted`), `ReconciliationService.cs:822–833` (native evidence only), position rows `Monitored = false` (`:1016`) | fixed; live on 18096: on-disk rows S01E02–E07, E09–E11, E13 still `tmdb=0`, unmonitored; S01E01 adopted by Refresh (title "Pilot"). Residual is RET2-R3 below |
| RET-R3 (rollback) | all four Phase 10 migrations throw in `Down`; PHASE10 §2 states the database-restore rollback and records one live restore | fixed in code; the live restore was not repeated (it stops the instance) |
| RET-R4 / decisions 1 and 9 (baseline) | `RetentionEvaluator.cs:300–302` floor = later of `BaselineAt` and `GraceStartAt`; `RetentionPolicySnapshot.GraceStartAt = FirstEnabledAt ?? EnabledAt`; `RetentionPolicyService.cs:60–66` sets `FirstEnabledAt` once; `PhaseTenFirstEnabled` back-fills it | fixed; the Disabled→Scheduled transition keeps the old countdown (`:335`) and honours `GraceNotBefore` (`:336`) |
| RET-R5 (evidence) | driver committed; the fixture has two two-binding episodes (E01, E02) and a two-binding TMDB row (S01E14) live | fixed for the fast window; see RET2-R8 for what is still missing |
| RET-R6 (index) | `PhaseTenRetentionControls` drops and recreates the position index non-unique; `ModDbContext.cs:114` matches | fixed |
| RET-R7 (Keep label) | `NativeEntryDetails.tsx:65–68,168–169` | fixed |
| `36f9d01` (grace restart across off/on) | `GraceNotBefore` stored by `EntriesController.cs:371`, applied after the Q9 floor at `RetentionEvaluator.cs:336`, cleared only by a target reset | fixed |
| `ab4d464` (stale settings in a batch) | `RetentionEvaluator.cs:116–129` re-reads entry and episode settings per target | narrowed, not closed; see RET2-R4 |

## RET2-R1 — A re-acquired copy inherits its target's completion and deadline while a sibling copy survives

- **Status:** open, verified in code; live on 18096 the trigger state exists now and tomorrow's phase-B
  run is expected to show it. **Priority:** P2.
- **Location:** plugin, `JellyfinMod/Services/RetentionExecutor.cs:382–385` and `:414–416` (the evaluation is
  reset only when `remaining.Length == 0`); `JellyfinMod/Services/ReconciliationService.cs:160–170` (the
  absence pass resets only when every binding of the episode is absent) and `:1043–1046` (a fresh baseline is
  seeded only for an episode that was neither bound nor evaluated before); `JellyfinMod/Services/
  RetentionEvaluator.cs:446` (an observation counts again as soon as its item id is bound again).
- **Trigger:** a target with two bindings; one copy is reclaimed (or removed) while the other survives because
  it is kept per file, seeding, or otherwise blocked; the reclaimed copy is re-acquired at the same path.
  Jellyfin 12 gives the re-added file the same item id (id = type + path), so the plugin's stored observation
  for that id is current again and Jellyfin reattaches the old play state as well. On 18096 today: E01 copy
  A was reclaimed in the fast-window run, copy B stayed `version_kept`, and A was recreated at its path; E01's
  evaluation was never reset (B remained), its baseline is the first binding at about 09:07Z and A's
  last-played instant (about 09:1xZ) is after it.
- **Cause:** T7 keys the reset and the baseline on the target's *last* representation. Per-file retention
  made a surviving sibling common (per-file Keep, seeding), and nothing floors a *new* binding's arrival: the
  target keeps `Scheduled` (or, after the Q9 re-enable, recomputes the same deadline from the old completion)
  and the new file is due the moment that deadline passes.
- **Impact:** a newly arrived file is deleted at the next run with no window of its own and no watch of its own
  — the bug class T7 fixed (plugin-retention-policy#1), reopened for targets with several copies. Not a wrong
  title, but a deletion the user cannot see coming: the warning shows the old date. Tomorrow's phase-B
  compares against `hashes-phaseb-before.json`, in which E01-A is present and expected unchanged; with a
  one-day window from about 09:1xZ, E01-A is due at 10:30Z and `compare-real` will fail on "E01-A is
  unchanged". (The driver's `finally` still disables retention and removes the fixtures.)
- **Fix direction:** two small, complementary changes. (1) When a binding is reclaimed or unbound, mark or
  delete the completion observations whose `JellyfinItemId` is that binding's item, so a returning item with
  the same id cannot revive them (T7's "mark observations stale" per representation). (2) When a binding is
  added to a target that already has an evaluation and other bindings, set `GraceNotBefore = now` (window
  restarts from the arrival, completion kept) — or, T7-consistent, set `BaselineAt = now` with
  `RequiresFreshCompletion` so the new file needs a watch after it arrived. Say which in PHASE10 §3.
- **Acceptance:** on 18096 with disposable fixtures: E01 in two roots, copy B kept per file, copy A watched
  and reclaimed in a fast window; recreate A at its path and reconcile. The episode reads `waiting` (option 2b)
  or `scheduled` with a deadline at least one window after the recreation (option 2a); an immediate run
  reclaims nothing; History shows why. Read tomorrow's `phase-b.log` for E01-A as the first live data point.

## RET2-R2 — Stopping a per-file Keep gives the file no window

- **Status:** open, verified in code. **Priority:** P2.
- **Location:** plugin, `JellyfinMod/Api/EntriesController.cs:406–465` (`ChangeVersionKeepAsync` removes the
  `VersionKeep` and writes History; it neither touches the evaluation nor re-evaluates), against
  `:317–392` (`ChangeEpisodeRetentionAsync` sets `GraceNotBefore`, clears the schedule and re-evaluates for
  every change but a Keep); `JellyfinMod/Services/RetentionPreviewService.cs:254,266–272` (once the Keep is
  gone the row falls straight through to the target's evaluation).
- **Trigger:** an administrator un-keeps a file whose title or episode deadline has already passed — the
  normal state after the other copies went (RET2-R1's E01-B is exactly this on 18096: A reclaimed at the
  deadline, B kept). The web offers this as "Stop keeping <file>".
- **Cause:** decision 4 ("any change but a Keep restarts the episode's grace, so a shorter window never makes it
  due at once") was implemented for episode settings only; the per-file control has no grace of its own and
  no restart.
- **Impact:** the file becomes `due` immediately and the next native run unlinks it; the warning, if it
  reappears at all, shows a date in the past. An administrator who wanted the file to "follow its title's
  retention again" gets a deletion within the run interval instead of a countdown.
- **Fix direction:** in `ChangeVersionKeepAsync`, when a Keep is removed, set the target evaluation's
  `GraceNotBefore = now`, clear a `Scheduled` state to `Waiting` as the episode path does, and re-evaluate the
  target; then the warning shows a future date. (Restarting the target's grace also delays sibling files,
  which is the safe direction.)
- **Acceptance:** disposable two-copy episode, one copy kept per file, the other reclaimed at a fast-window
  deadline; un-keep the survivor. Detail shows `scheduled` with a deadline one window out and the warning with
  that date; an immediate run reclaims nothing; after the window it is reclaimed.

## RET2-R3 — A TMDB row created by Add binds a later file by position, monitored, and Q10 replaces without the watched rule (S19)

- **Status:** open, plausible; the precondition is verified live. **Priority:** P2 (gated).
- **Location:** plugin, `JellyfinMod/Api/EntriesController.cs:558–577` (`CompleteConcurrentAdd` creates TMDB
  rows at every position not held by a position row, and sets the entry monitored at `:577`);
  `JellyfinMod/Services/ReconciliationService.cs:837–841` (a TMDB row with no TMDB-id match binds TMDB-less
  native episodes at its season and episode number); `JellyfinMod/Services/Automation/UpgradeService.cs:140–166`
  and `JellyfinMod/Services/RetentionExecutor.cs:116–175` (replacement skips the watched rule and the window,
  decision 10); the gate is `AutomationSettings.EpisodeUpgradesEnabled` (default off).
- **Trigger:** any user with library access posts an existing TVDB-scraped series (or a series before its files
  arrive). Live on 18096 after the ordinary user's Add: about 270 file-less TMDB rows, all monitored;
  `S01E14` is a TMDB row (64773), **monitored**, holding two position-bound copies; `S01E08` and `S01E12` are
  monitored TMDB rows created at positions a multi-episode file covers (E12 reads `state=none` although
  `S01E11-E12.mkv` exists, because Jellyfin 12 hides it as a version of E11). Later: episode upgrades enabled,
  a quality profile on the entry, a release found for the TMDB numbering.
- **Cause:** the row's identity is TMDB's episode at that number; the file's identity was inferred from its
  file name; nothing records that the binding was made by position. RET-R2 closed adoption on Add and Refresh
  but not creation-then-bind, and decision 10 removed the watched rule that RET-R2's fix had put in front of
  replacement.
- **Impact:** where TMDB and scene/TVDB numbering differ (specials, split pilots, anime), an upgrade imports a
  different episode as "the better version" and the replacement unlinks a correct, possibly unwatched file.
  Where the numbering agrees the replacement removes the right file. Outside retention, the same rows make
  automation search for episodes that exist (E12) or are covered (E08).
- **Fix direction:** record identity provenance on the binding or row (`BoundByPosition`); make
  `ReplaceAsync` refuse such a superseded binding with a stable reason (`identity_unverified`) until Refresh
  adoption evidence (title or air date) or a native TMDB id confirms it; have Add leave rows monitored only for
  positions no file covers (`IndexNumberEnd` included). Keep `EpisodeUpgradesEnabled` off until this lands.
- **Acceptance:** fixture series where TMDB's season lists an episode at a number the files use for a different
  episode; Add by an ordinary user; a file arrives at that number and binds; an upgrade for that row imports
  a release; the replacement is refused with `identity_unverified`, both files stay byte-identical, History
  says why. Also: after Add, no monitored row exists for a number a multi-episode file covers.

## RET2-R4 — Keep is not read by the preview for normal reclaim rows; the live check is the only pre-unlink guard after a stale evaluation

- **Status:** open, verified in code; safe today because of the live check. **Priority:** P3.
- **Location:** plugin, `JellyfinMod/Services/RetentionPreviewService.cs:256–273` (`target.Kept` is consulted
  only for replacement rows; a normal row trusts the evaluation state); `JellyfinMod/Services/
  RetentionEvaluator.cs:116–134` (settings are read, then the evaluation row, with no gate or lock);
  `JellyfinMod/Services/RetentionLiveCheck.cs:39–44` (re-reads series and episode Keep inside the execution
  gate, which `ChangeEpisodeRetentionAsync` also takes).
- **Trigger:** a Keep lands between a batch's read of the episode's settings and its save of the evaluation
  (the window `ab4d464` narrowed but did not close); the batch stores `scheduled` for a kept episode.
- **Cause:** Keep is enforced through the evaluation state, and the evaluation is written without the gate.
- **Impact:** the preview, the run's "eligible" count and the detail warning can show a kept episode as due
  until the next evaluation; the run then blocks it with `kept` from the live check. No deletion; misleading
  admin output and a wasted prepare.
- **Fix direction:** return `blocked/kept` from `Inspect` whenever `target.Kept` (already loaded), for every
  row; optionally serialise `EvaluateCoreAsync` per target with the episode change path.
- **Acceptance:** with the batch paused under a debugger or a slow clock, Keep an episode mid-batch; the
  preview never lists it as due and the run's blocked reasons do not contain `kept` for it.

## RET2-R5 — `retention_started` repeats and the re-enable warning can carry a past date

- **Status:** open, verified live. **Priority:** P3.
- **Location:** plugin, `JellyfinMod/Services/RetentionEvaluator.cs:345–347` (event on every transition into
  `Scheduled`); `JellyfinMod/Api/EntriesController.cs:614–647` (warning from the evaluation's deadline).
- **Trigger:** retention switched off and on (each re-enable transitions Disabled→Scheduled with the kept
  deadline), or the Keep/un-Keep cycle. Live: the fixture movie has three `retention_started` events (the
  first with the 3-minute test-window date), and E03/E04/E06/E09/E10 have four kept/unkept/started cycles
  from the browser probe.
- **Impact:** History noise, and after a re-enable past the deadline the warning says "will be deleted on
  <yesterday>" while the file is due at the next run (decision 9 as intended, but it gives no lead time).
- **Fix direction:** write the event only when the deadline changes or no event exists for the current window;
  say "overdue" in the warning when the date has passed.
- **Acceptance:** toggle retention off and on twice: one event per window; a passed deadline reads as overdue.

## RET2-R6 — Absence still trusts the mount, not the file (analysis C5), now recorded

- **Status:** open by design until V1; verified in code. **Priority:** P3.
- **Location:** plugin, `JellyfinMod/Services/ReconciliationService.cs:119,129,261–268` and
  `JellyfinMod/Services/MediaStorageIdentity.cs:30–80` (`IsCurrent` proves the library mount identity and
  readability, not that the file is gone); the reset is now recorded (`:249–259`).
- **Trigger:** Jellyfin 12 stops reporting a bound item (an extra version hidden from queries, a main-version
  change, a merge across libraries) while the file exists.
- **Impact:** the binding is deleted and, if it was the last, the clock and evidence reset with a
  `retention_reset` event. Deletion-safe: an unbound file cannot be unlinked, and the sibling main is then
  blocked by `versions_untracked` because its version's path is no longer tracked. Side effect seen live:
  `S01E12` reads `state=none` while `S01E11-E12.mkv` exists.
- **Fix direction:** V1 as the analysis proposes: absent only when the file is provably gone or its identity
  changed; present-but-unseen keeps the binding and blocks retention (`versions_unverified`).
- **Acceptance:** the analysis's C5 fixture; History shows no `retention_reset` for a present file.

## RET2-R7 — A position-tracked multi-episode file has no row for the episodes it covers

- **Status:** open, verified live. **Priority:** P3.
- **Location:** plugin, `JellyfinMod/Services/ReconciliationService.cs:998–1041` (position rows are created for
  the observation's first number only) and `:917–940` (covered rows are only ever *existing* rows); web
  `NativeEntryDetails.tsx:97–98` (an episode page resolves to the first row sharing the item id).
- **Trigger:** `S01E07-E08.mkv` in a TVDB-scraped series. Live: no S01E08 row existed until the ordinary Add
  created a TMDB one (monitored).
- **Impact:** the covered episode has no page, no Keep and no window of its own; the Q5 rule's "every covered
  episode is due" is vacuous for it (the file is one unit, which is defensible); after an Add the covered
  number becomes a monitored TMDB row and automation may fetch it again; E08's page shows E07's controls.
- **Fix direction:** create position rows for the covered numbers too, with `JellyfinItemId` = the covering
  item and no binding, as TMDB rows already get; resolve an episode page by its own row when the item id is
  shared.
- **Acceptance:** after reconciliation, `S01E07` and `S01E08` both exist for the fixture; E08's page keeps E08.

## RET2-R8 — Evidence: what the recorded runs prove and what they do not

- **Status:** informational, verified against the driver, the live state and the Pi. **Priority:** P3.
- The fast-window run is now scripted and its per-file claims match the driver's `FIXTURE` table and the
  live History; Jellyfin 12 grouping was confirmed live during this review (`S01E11.mkv` has two media
  sources, the movie's 1080p has two; the plugin lists one version of the movie), so the `versions_untracked`
  and `episode_versions_untracked` blocks rest on real Jellyfin behaviour.
- Not proven: (a) the real-window positive half — scheduled as a detached bash process on the Pi (no cron or
  timer; a reboot before 10:30Z means it never runs, which leaves retention disabled); expect the E01-A
  failure of RET2-R1 and read E04, `S01E09-E10`, E10-B and every other hash regardless; (b) decision 10's
  replacement with a per-file Keep on the superseded file (the `PhaseSixIntegration` M5 test covers title
  Keep only; no live replacement was run in Phase 10); (c) un-Keep, the window editor and per-file Keep have
  no real-Kestrel suite coverage — their 401/403/200 rest on the live disposable-user run only; (d) the Trakt
  `Import` cause is from source reading; (e) All-users and Any-user modes were not exercised in Phase 10 (only
  Selected user); (f) Jellyfin 12's played propagation without a date (C9) was reasoned from source, not
  observed with a tracked and an untracked version.
- Hygiene note for tomorrow: the fixture series entry is now titled "The Big Bang Theory" (TMDB 1418, the
  Refresh took TMDB's title) with about 270 monitored file-less rows; the driver's `query=JellyfinMod` check
  no longer finds it and cleanup relies on the remembered id `0f6e7dd8…`. Confirm after phase-B that this entry
  and the movie entry `d5314656…` are gone (404).

## RET2-R9 — Per-file Keep identity: overstated guarantee, cross-filesystem move, unique path

- **Status:** open, verified in code. **Priority:** P3.
- **Location:** plugin, `JellyfinMod/Data/VersionKeep.cs` (doc comment "never less"), `JellyfinMod/Api/
  EntriesController.cs:442–463`, `ModDbContext.cs:138` (`MediaPath` unique across entries).
- A rename or move within one filesystem keeps the Keep (device, inode and birth time match); a move to
  another filesystem loses it (both keys change) — the Keep must be re-made; a file replaced at the same path
  is over-protected (path key). A Keep on a path already kept under another entry (one folder in two
  libraries) fails the unique index with a 500 rather than a message.
- **Fix direction:** state the cross-filesystem limit in UX.md; make the unique index `(EntryId, MediaPath)`.
- **Acceptance:** move a kept fixture file across filesystems and confirm the detail says it is no longer kept.

## RET2-R10 — What the warning shows ordinary users beyond the date

- **Status:** informational; the user's decision 11 covers the date. **Priority:** P3.
- **Location:** plugin, `JellyfinMod/Api/EntriesController.cs:614–647`, `RetentionFileNames.Distinct`
  (`RetentionEvaluation.cs:125–146`); the endpoints themselves are correctly `RequiresElevation`
  (`EntriesController.cs:279,287,295,397,402`) and the detail is readable only with library access.
- Ordinary users also see the cause ("marked played", "watched on another device (synced)") and the file
  names — lengthened by parent folders when two files share a name, which exposes library root names such as
  `tv-p10a/…`. Confirm this is within the decision or shorten to the file name for non-administrators.

## RET2-R11 — Checked and dismissed (recorded so the next reviewer need not repeat them)

- A native series without a TMDB id never becomes a `TmdbId = 0` entry: `ReconcileAsync` returns `Unmatched`
  (`ReconciliationService.cs:279–280`), so two TMDB-less shows cannot be merged into one entry whose episodes
  would be "versions" of each other.
- C2 (versions merged from different titles): `VersionsUntracked` compares every path Jellyfin plays for the
  main item and its linked versions with the entry's bound paths; a foreign title's file is never bound to
  this entry, so the whole group blocks. C1/C7/C10: an episode with any local or linked version, or with
  `PrimaryVersionId`, blocks; a movie blocks when any version path is unbound or the bound item is an extra
  whose main cannot be read; both confirmed live. A stale binding whose item id no longer resolves keeps the
  title blocked through `completion_evidence_missing` (`RetentionCompletionService.cs:75–85`).
- Decision 5: the multi-episode rule runs after the own row's evaluation is past its deadline, needs every
  covered row with files past its own deadline, no covered Keep, and the file itself finished after the floor
  by the policy users; the recomputed deadline uses the longest covered window and can only be later than the
  own one; the live check repeats the Keep-over-range and file-completion tests; replacement never touches a
  multi-episode file. C9: a propagated played flag has no last-played date and `CompletionInstant` rejects it.
- Decision 9 arithmetic: `eligibleAt = max(completion, GraceStartAt, BaselineAt, GraceNotBefore)`, a prior
  deadline is never shortened, `policyChanged` is suppressed for Disabled→Scheduled, access changes only
  lengthen. `ReplaceAsync` refuses while retention is disabled. Movies keep grace from the first switch-on:
  on 18096 that is now 2026-09-24, so a later enable there gives movies no fresh grace (production has never
  been enabled).
- Executor invariants (T8–T12, T16–T18) unchanged: recovery first, three previews, policy version, live
  check last inside the gate, binding-set recheck, pinned unlink by device, inode and birth time, non-cancellable
  completion, `media_not_writable` before prepare, shared-inode rule, seed goals per physical identity.
- Authorization: all five new endpoints `RequiresElevation` on an `[Authorize]` controller; series-scoped
  checks (`MediaType == "series"`, episode belongs to the entry, binding belongs to the entry) present.
- Migrations: additive columns, one table, index swaps; `Down` forward-only in all four; the runtime model
  matches the chain.

## Verdict

No P1. I found no path by which the engine unlinks a file of a title that was not completed by a play recorded
after the floor, and no path by which a Jellyfin 12 version the plugin does not track is reached: C1, C2, C7
and C10 block, C5 is recorded and deletion-safe. Every earlier fix (RET-R2–R7, `36f9d01`, `ab4d464`) is
present in the code as described.

**Merge:** `p10-retention` may be merged into plugin `master` and web `jellyfin-mod` with retention
disabled, as it is on every instance; nothing on the branch deletes while disabled (reclaim and replacement
both refuse). Fix RET2-R1 and RET2-R2 before or immediately after the merge — both are small and contained.

**Enable on real media:** **not yet, even if tomorrow's real-window run passes.** Two deletions with no
window remain: a re-acquired copy beside a surviving one (RET2-R1) and a file whose Keep was stopped after
its title's deadline (RET2-R2). Before enabling: fix both, re-run the two acceptance checks above on 18096,
read tomorrow's `phase-b.log` (expect the E01-A discrepancy and verify E04, `S01E09-E10`, E10-B and the rest),
and confirm the fixtures are gone. RET2-R3 must be fixed before `EpisodeUpgradesEnabled` is ever switched on;
it does not block retention itself. The P3 items are quality and evidence work for the next slice.
