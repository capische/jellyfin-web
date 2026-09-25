# Phase 10 — per-media entries and retention

Design and task plan, 2026-09-24, for PLAN.md work-queue item 3. Written and implemented by Opus at
high effort (reassigned from Fable by the user on 2026-09-24). Read `PHASE2.md` (bindings), `PHASE3.md`
(retention T1–T19), `PHASE6.md` M5–M8 (versions) and `PHASE7.md` S6 alongside this document.

**Accepted decision, 2026-09-21, verbatim:** *"We need control per media file no matter it's a movie
or episode. Therefore, if I watched episode – remove it, and each media should have separate
retention."*

Nothing below changes an accepted decision. Where a choice changes what gets deleted, the
implementation uses the default that deletes less and the question is listed under
[Open questions](#open-questions-for-the-user) as **proposed, awaiting the user**.

**Automatic reclamation of real (non-fixture) media stays disabled on every instance.** A separate
Opus 5.5 verifier at high effort reviews this delete path before that changes (the user replaced Fable
with Opus 5.5 high for all design and verification work on 2026-09-24; the review of that date was
Fable's).

## 1. Current model, verified from code

Verified against plugin `origin/master` `cdb6e7b` and a `.backup` copy of the isolated test
instance's database (port 18096) and of its Jellyfin database, 2026-09-24. Nothing on the instance
was changed to gather this.

### How titles bind today

| Target | Durable row | Native binding | Retention target |
| --- | --- | --- | --- |
| Movie | `Entries` (one per library + TMDB id) | `EntryBindings`, one per native item; alternate versions share a `VersionGroupId`, further media sources carry `OwnerItemId` (P6.M6) | the entry (`TargetId = Entry.Id`) |
| Series | `Entries` | `EntryBindings` for each native series item (copies) | none — a container |
| Season | none | none | none |
| Episode | `Episodes` (per entry; unique `(EntryId, TmdbId)`) | `EpisodeBindings`, one per native episode item; several bindings on one row are that episode's versions | the episode (`TargetId = Episode.Id`) |

Per-user evidence (`CompletionObservations`), evaluations (`RetentionEvaluations`), operations
(`RetentionOperations`) and the preview/executor all already key on `TargetId`, which is an episode
for TV. The delete path itself is already per file: the preview lists one row per binding and the
executor unlinks one exact path. **Per-episode retention exists in the engine; what is missing is
episodes to run it on, and per-episode control.**

### Where retention decides, and at what granularity

- `RetentionEvaluator.EvaluateCoreAsync` — per target (movie or episode): Keep, access set, watched
  mode, evidence, resume, favourite, favourite series, completion basis, `priorDeadline`
  preservation, `BaselineAt` floor and `RequiresFreshCompletion` (T7).
- `RetentionPreviewService` — per binding (file): storage, native item, multi-part / multi-episode
  (T16), symlinks, identity, active session across the version group, favourite series,
  `media_not_writable` (T18 finding), plugin seed goal (P5.I6), Transmission seed goals (T17) and
  the shared-inode rule.
- `RetentionExecutor` — per physical action (one canonical path, possibly several bindings):
  recovery first (T9), second preview under library locks, durable prepare, policy re-check,
  `RetentionLiveCheck` (T8), binding-set recheck (T12), pinned unlink, non-cancellable completion,
  per-target reset (T7) and series `reclaimed` when the last episode goes (T14).
- **Keep and the per-entry window live only on `Entry`** (`RetentionPolicy`, `ReclaimAfterDays`).
  Every consumer reads the entry: evaluator, preview (upgrade replacement), live check, upgrade
  service and summaries. A series Keep protects every episode; there is no episode-level control.

### Why episodes are unbound

`ReconciliationService.ReconcileEpisodes` creates an `Episode` row only for a native episode that
carries a **TMDB episode id** (the provider-group loop). A native episode without one can only bind by
season and episode number to an `Episode` row that already exists, and such rows come only from the
TMDB episode list fetched when a user **adds** a series or an admin **refreshes** it. A series that
reconciliation discovered in the library (`backfilled`, most of them) has no TMDB episode list.

Measured on the isolated instance: the Shows library holds **514 native episodes; all 514 carry
TVDB/Sonarr ids and none carries a TMDB id**. The plugin database has 107 series entries, 50 of them
on disk, **17 `Episode` rows (all on two file-less entries added through TMDB) and 0
`EpisodeBindings`**. So no episode is ever evaluated, no episode page resolves to an entry
(`GET /Entries?jellyfinItemId=<episode>` finds nothing), and PHASE7 S6 saw "no mod section on a
native episode". This is a data condition of how the library was scraped, not a route bug, and it
is the normal condition of a Sonarr/TVDB library.

## 2. Target model

- **A retention target is one playable media item: a movie, or one episode.** Each carries its own
  deadline, its own Keep and its own versions (bindings). Series stay the container; seasons stay
  display only.
- **Every numbered native episode is tracked.** When reconciliation sees a native episode with a
  season and episode number but no TMDB episode id, and no tracked row claims it, it creates a
  **position-identity** episode row: `TmdbId = 0`, identity `(EntryId, SeasonNumber, EpisodeNumber)`.
  A row with a TMDB id keeps TMDB as identity exactly as today.
- **Versions** of an episode are the bindings on its row: every native episode item at that position
  in the series' native copies. Versions of a movie are unchanged (version groups, further media
  sources). Retention per version keeps the Phase 6 M7 rules (lowest quality first, each file with
  its own seed and storage checks, the target reclaimed only when its last binding goes).
- **Keep and window** attach to the target: `Episode.RetentionPolicy` (inherit / days / never) and
  `Episode.ReclaimAfterDays`, beside the entry's. Effective policy for an episode:
  - kept when the **series or the episode** is kept (Keep at either level wins; an episode window never
    overrides a series Keep — Q2, answered 2026-09-24);
  - otherwise the window is the episode's days, else the series' days, else the global window.
  Keep applies to every version of the target; in addition an administrator can **Keep one file**
  (Q3, answered 2026-09-24), which then stays while the other versions expire. A per-file Keep is
  stored by the file's path and physical identity (`VersionKeeps`), not by the binding, because
  Jellyfin re-identifies the remaining versions of a title when one goes.
- **Watched state** stays per target and per user from Jellyfin user data, aggregated across the
  target's versions (T8): resume or favourite on any version protects all; finishing any version
  completes the target. **Answered 2026-09-24 (RET-R1, Q7 below): any copy watched counts** — watching
  one version makes every version of that movie or episode eligible together, **unless a version is
  kept**, which then stays.

### Data model changes (one migration)

```
Episodes  + RetentionPolicy INTEGER NOT NULL DEFAULT 0   -- inherit
          + ReclaimAfterDays INTEGER NULL
          unique (EntryId, TmdbId)                        -> unique (EntryId, TmdbId) WHERE TmdbId <> 0
          + unique (EntryId, SeasonNumber, EpisodeNumber) WHERE TmdbId = 0
VersionKeeps (Id, EntryId, EpisodeId?, MediaPath unique, PhysicalIdentity, CreatedAt)   -- 2026-09-24
(EntryId, SeasonNumber, EpisodeNumber) recreated non-unique everywhere (RET-R6)          -- 2026-09-24
```

**Rollback (RET-R3, 2026-09-24).** Both Phase 10 migrations (`PhaseTenEpisodeRetention`,
`PhaseTenRetentionControls`) are **forward-only**; their `Down` throws. The rollback is: stop the
instance, put back the previous DLL and the database backup taken before the deploy
(`jellyfin-sync` and the E-series deploys keep one in the isolated build directory), start. Everything
recorded since the deploy (Keeps, history, evaluations, operations) is lost with it. The previous DLL
must never run on a migrated database: its Refresh and Add fail on the duplicate TMDB id 0 of position
rows. The restore has **not yet been exercised on 18096** (see Handover).

Only columns are added and two indexes swapped, so SQLite rebuilds no table and every foreign key
(bindings, conflicts, evaluations, operations, grabs, imports) is untouched. EF Core 10 on the host:
no `ExecuteUpdate`/`ExecuteDelete` anywhere in this work.

### Migration of existing data

Nothing is rewritten. Existing entries, episodes, bindings, observations, evaluations (with their
deadlines, `BaselineAt` and `RequiresFreshCompletion`), operations, history, Keep flags and
per-entry days keep their values; every existing episode becomes `RetentionPolicy = inherit`, which
is exactly today's behaviour. Position-identity rows appear only when reconciliation next observes a
series. Acceptance applies the migration to a copy of the isolated database and compares counts and
checksums of the preserved tables.

### Identity maintenance (so two rows never claim one episode)

- **Refresh adopts position rows only with evidence; Add never does (RET-R2, 2026-09-24).** A TMDB
  episode listed by an admin Refresh at a position a position row holds is adopted only when the air
  date (within a day) or the title agrees; the adoption is recorded as `episode_adopted`. Otherwise,
  and always on a user's Add, the position row is left as it is (not monitored) and no second row is
  created at its position.
- **Reconciliation adopts too.** A native episode that later gains a TMDB id (the library switched
  scraper) adopts the position row it is bound to instead of opening a conflict, provided no other
  row has that TMDB id.
- **Position rows never match by TMDB id** (`0` is not an identity) and match only TMDB-less native
  episodes at their position, as TMDB rows already do.
- **Position rows are not monitored.** They were discovered, not wanted; automation never searches
  them unless an admin turns monitoring on.

## 3. Retention semantics per episode

**The user's rule, in plain language (2026-09-25): "watched = added to retention; if it wasn't watched, not added."**
Every case below follows from it:

- A movie or episode enters retention only when the watched-user policy has finished it: Jellyfin's played flag, no
  resume position, and a last-played date. Nothing unwatched is ever added, and a played flag without a date (a
  propagated version flag) is not a watch.
- The watch must come after the title was first tracked and after retention was first switched on (decisions 1 and 12):
  a backlog watched before then is not added until it is watched again.
- A watch while retention is off is added at the next switch-on, with a full window from the switch-on and the warning;
  a window that ran out while off starts over the same way (decision 13). Nothing becomes due at a switch-on.
- A re-watch restarts the window from the re-watch date: playing it again passes through "in progress" (a resume
  position protects it), and finishing it is a new watch with a new date. Marking an already played title played again
  does not, because Jellyfin keeps its earlier last-played date; mark it unplayed first.
- Adding to retention always shows the date: History `retention_started` and the detail-page warning (Q8).

| Case | Behaviour |
| --- | --- |
| Watched-user policy | Unchanged: All users / Selected user / Any user per episode, evaluated over users with access to the series' library. |
| Partially watched | Not watched. Any resume position on any version by any accessible user protects (`active_resume`); watched means Jellyfin's played flag with no resume. No separate percentage rule (PHASE3, accepted). |
| Specials (season 0) | Episodes like any other; the user's decision covers every media item. Unnumbered specials stay skipped with a diagnostic (P2.R6) and are never targets. |
| Multi-episode files | **RET2-R7 (2026-09-24):** a position-tracked file holding several episodes gives each covered number a row of its own (pointing at the file, unbound, unmonitored), so the covered episode has a page entry, Keep and window, and an Add cannot create a monitored TMDB row there. **Answered 2026-09-24 (Q5): reclaimed when every episode in the file is due.** The file is due only when no episode it covers is kept, every covered episode that has files of its own is due on its own schedule, and the file itself was watched under the watched-user policy after the baseline (for an episode whose only copy is this file, the file is that episode); the longest covered window applies. Otherwise `multi_episode_not_all_due`. Covered episodes without files of their own become `reclaimed` with it. An upgrade never replaces a multi-episode file. |
| Newly tracked backlog | **Answered 2026-09-24 (Q1): only a new watch counts.** An episode becomes due only after a completion whose Jellyfin last-played date is at or after the **later of the episode's first-tracked time and the time retention was first ever enabled** (Q9, answered 2026-09-24: `RetentionPolicySnapshots.FirstEnabledAt`); nothing watched before per-episode retention existed, or between deploy and the first switch-on, becomes due by itself. The switch-on is recorded when the plugin reads the saved settings, a few seconds after the save; a watch in those seconds does not count (seen live). Consequences, from Jellyfin (`BaseItem.MarkPlayed`/`MarkUnplayed`, the same in 10.11 and the 12.0.0 host): *mark played* keeps an existing last-played date, so marking played an episode that was played or partly played before the floor does not count; *mark unplayed* clears the date, so unplayed-then-played counts; the modern web marks played without a date; *mark series played* dates every episode that had no last-played date "now", so those episodes become due one window later; a real playback always sets the date to its start. **Switching retention off and on again moves nothing (Q9):** the floor stays at the first switch-on and grace never starts before it, so a countdown that was announced and is still running continues with its date. **Decision 13 (answered 2026-09-25, RET4-R1):** a title finished while retention was off (its window was never announced), or whose announced window ran out while retention was off, gets a full window from the switch-on, announced with the warning and History `retention_started`: nothing is due at the switch-on or deleted without a warning, however long ago it was watched. The window start is stored as `GraceNotBefore` (the RET3-N1 mechanism), so a later off and on keeps the announced date. A countdown still running at the switch-on is recomputed with the current window as before; if that window was shortened while off so that it has run out, it too starts over from the switch-on. A title re-watched while off after an earlier window was announced and still running gets a window from the re-watch, announced at the switch-on. An administrator's restart (un-Keep, a changed window) is stored as `GraceNotBefore` and survives the switch too. Jellyfin 12 marks every version of an item played when one is finished, but copies the flag **without** a last-played date (analysis C9), so such a propagated flag never counts as a new watch: the safe direction, recorded rather than worked around. A played flag with no last-played date never counts. Movies follow the same rule since decision 12 (§7). |
| Several files of one movie or episode | The runtime host is **Jellyfin 12.0.0** (the plugin compiles against 10.11.11). Jellyfin 12 groups several files of a movie, and now of an episode, in one folder as versions of one main item; it also groups `S01E01-E02` with `S01E01`, because its episode key ignores the ending number, and hides extra versions from normal queries. The plugin binds only what reconciliation sees, so until task V1 enumerates versions and E7 tracks them, any movie or episode for which Jellyfin plays a file the plugin has not bound (compared by path: the main item, its local and linked versions), or whose bound item has itself become an extra version, is **blocked**: `versions_untracked` for movies, `episode_versions_untracked` for episodes. Seen live: a two-file movie tracked by its main file only stayed with both files; `S01E11` + `S01E11-E12` in one folder, E11 watched, both files stayed (E12's only copy). |
| Upgrade replacement | **Answered 2026-09-24 (Q10): replace immediately**, as Phase 6 designed: the older version goes once the better one is imported, without the watched rule or the window. A per-file Keep on the older version, Keep on the title or episode, seeding and read-only media still protect it. |
| Retention-start warning | **Answered 2026-09-24 (Q8, Q11).** When a movie's or episode's window starts, History records `retention_started` with the cause, the deadline and the files, and the detail page shows everyone who can see the title "Added to retention: this file will be deleted on <date> unless kept", the cause and the files; administrators get Keep inside it. The cause is the save reason Jellyfin reported for the completing user's data: `TogglePlayed` "marked played", playback "watched on this server", `UpdateUserData` (a sync client writing user data) "watched on another device (synced)", `Import` (the Trakt plugin's `SyncFromTraktTask`, verified in its source) "watched on another device (Trakt)". Ordinary users see the date too; this overrides the T15 date hiding for this warning only. The warning reflects the schedule: a file held by a protection (seeding, the versions guard, a multi-episode file not fully due) keeps the warning while it waits. |
| Re-acquired episodes (T7–T10 class) | Losing the last binding resets the evaluation (`RetentionTargetReset`) in the same transaction, so a returning file never inherits a deadline or an old completion. **RET2-R1 (2026-09-24): a file that arrives for a movie or episode retention already tracks resets it too** — beside a surviving copy (kept per file, seeding) or after its copies went — because Jellyfin 12 gives a file re-added at its old path its old item id and reattaches its old play state. Of the review's two options this is **2b** (baseline at the arrival, a completion after it required), T7-consistent and the one that deletes less: the new file needs a watch of its own, and the surviving siblings wait with it. The same file under a new native id (a path already bound) is not a new file. History records `retention_reset` "a new file arrived". Evidence read through a file that is reclaimed or unbound while siblings stay is forgotten, so an item id that comes back cannot revive it. Imports already reset the target (P3.T7), so an upgrade's new file needs a new watch as well. |
| Seed protection | Per file, unchanged: a version seeding below its goal (plugin-owned or Transmission) stays blocked while a lower version of the same episode may be reclaimed (M7). |
| Hardlinks between versions | Unchanged shared-inode rule: two bindings on one inode are one physical action and need every affected target due; hardlink count above one records zero physical bytes released. |
| Series container | When the last episode binding of a series is reclaimed the series entry becomes `reclaimed` (T14) and keeps metadata, Keep, history and bindings of its native series item. Reconciliation writes no `media_missing` for it. |
| Keep | Admin only, one action, no confirmation (accepted). **RET2-R2:** stopping a per-file Keep restarts the target's grace from that moment, exactly as un-keeping an episode does, so the file is never due at once with a past date. **RET2-R9:** a per-file Keep follows the file within one filesystem and is lost across filesystems (UX §8); one path can be kept once per entry. Series Keep protects every episode; episode Keep protects that episode's versions; a per-file Keep protects that file (Q3). **Answered 2026-09-24 (Q4):** an episode can be un-kept and given its own window (inherit, 1–3650 days, never); any change but a Keep restarts the episode's grace from the change, so a shorter window never makes it due at once. Settings live in the plugin database. Titles (movies, series) still have no un-Keep or days editor (PLAN question 13 for titles is not part of this decision). |

## 4. Safety analysis — every way this could delete something it should not

| # | Risk | Guard | Evidence |
| --- | --- | --- | --- |
| S1 | **Backlog wave:** binding hundreds of already-watched episodes makes them all due one window later. | First-evaluation fresh-completion rule for episode targets; old played state never counts (question 1). | Live: a fixture episode watched before deploy stays `waiting` after binding; watched after binding, it is scheduled. |
| S2 | Two different episodes grouped as versions of one row, so watching one deletes the other. | Position rows group only native episodes of the **same series entry** at the **same season and episode**; the unique position index forbids a second row; TMDB-less natives never match TMDB ids; observation conflicts (same position, different TMDB ids) are skipped per P2.R9. | Migration and live bind counts; conflict path unchanged. |
| S3 | A TMDB refresh creates a duplicate row beside a position row, splitting versions or evidence. | Reconciliation adopts on native evidence; Refresh adopts only with air-date or title evidence and otherwise, like Add, never creates a second row at a held position (RET-R2). Two position rows at one position are a unique-index failure; a TMDB row beside a position row is prevented in code, not by an index (RET-R6: the general position index is non-unique everywhere). | Live: refresh of the fixture series keeps one row per episode. |
| S4 | Episode Keep ignored by the last check before unlink (only the entry is read today). | Keep is read at every layer: evaluator, preview (including upgrade replacement), `RetentionLiveCheck` (last check inside the lease), upgrade service. | Live: a kept fixture episode survives an enabled run with its deadline passed. |
| S5 | Series Keep weakened by an episode setting. | Keep at either level wins; an episode's days never override a series Keep. | Live: series kept → every episode `kept`. |
| S6 | Regression of `priorDeadline` preservation (T11/M7) or the `BaselineAt` floor (T7). | The evaluator's schedule code is unchanged; only the Keep and window inputs gain the episode level. | Existing suites (PhaseThree*, PhaseSix) plus live fast run. |
| S7 | A sibling episode reclaimed because it shares a file. | Multi-episode files blocked (T16); hardlinked or same-path files need every affected target due (shared-inode rule). | Live: unwatched sibling byte-identical after the run. |
| S8 | A seeded version deleted with its watched sibling version. | Per-file seed checks (T17, P5.I6) unchanged; ordering M7. | Live: the seeded fixture version stays with `seed_goal_unmet`. |
| S9 | Read-only production media reached through a new binding. | `media_not_writable` in preview and executor (T9/T18); production mounts are read-only on 18096; retention enabled only with a Selected-user fixture scope, and the preview shows every read-only row blocked. | Live preview after the run: every `/data5` row `blocked/media_not_writable`, sizes unchanged. |
| S10 | Mass-binding a large library blocks Keep, Refresh or scans. | Binding happens inside the existing per-library reconciliation lease in the existing save; no new long lock. | Live timing of one backfill on 18096. |
| S11 | Automation re-acquires or searches discovered episodes. | Position rows are created unmonitored; reacquire of reclaimed media still follows `ReacquireReclaimed`. | Code path + live automation status unchanged. |
| S12 | Ordinary users gain removal power. | Episode Keep is `RequiresElevation`; no Remove or settings path added; ordinary users still see the public reason vocabulary (T15). | HTTP 401 anonymous, 403 ordinary, 200 admin. |
| S13 | Episode lookup by an alternate version's native id shows the wrong episode's controls. | The detail carries every version's item id; the web matches the page's item against versions, not only the selected binding. | Browser check on a two-version fixture episode. |
| S15 | An episode whose files Jellyfin merged into one item loses its primary file while the others stay untracked, then re-resolve as a new item. Found by the live run. | Preview and executor block it with `episode_versions_untracked` until E7. | Live: E01 (1080p + 720p) watched and past its deadline, both files byte-identical. |
| S16 | A first "mark played" arriving before the episode's first evaluation never counts, or an undated played flag counts as fresh. | The baseline is seeded at first binding; a fresh completion needs a last-played date at or after it. | Live: fixture episodes marked played after binding were scheduled; the backlog episode marked played with an old date stayed waiting. |
| S17 | Jellyfin 12 plays a version the plugin does not track (analysis C1, C7, C10): a movie's extra file bound by the 10.11 id, an episode's grouped files, `S01E01-E02` grouped as a version of `S01E01`, or a bound item that became an extra version. Watching the tracked file would delete it while the untracked one stays, or delete a multi-episode file that is another episode's only copy. | Preview blocks the whole title (`versions_untracked`, `episode_versions_untracked`) whenever a file Jellyfin plays is not bound, compared by path; the multi-episode rule reads each file's own range. E7 builds on V1, never on P6.M6's id lookup. | Live 2026-09-24: two-file movie watched and past its deadline: both files byte-identical; `S01E11` + `S01E11-E12` watched: both byte-identical. |
| S18 | Absence deletes the binding of a file Jellyfin stopped reporting and silently restarts its clock (analysis C5). | Not fixed (V1); every such reset is now recorded as `retention_reset` with the files, so it is never silent. RET2-R6 (2026-09-24): recorded, deletion-safe, stays for V1. | Code; not triggered live. |
| S19 | A TMDB row that a user's Add or a Refresh created for a position with no file yet binds a later TMDB-less file at that position (the P2 rule), monitored; with upgrades replacing at once (Q10), a wrong-identity upgrade could replace a correct file. | **RET2-R3 (2026-09-24):** such a binding is `IdentityUnverified` until the native episode carries the row's TMDB id or its title or air date agrees; the executor refuses to replace it (`identity_unverified`, before prepare and again before unlink) and History says why; the migration marks every existing binding on a TMDB row unverified until the next reconciliation. An Add does not monitor a row at a number a file covers without carrying the row's TMDB id (every number after the first of a multi-episode file counts). Position rows are the file's own identity and are not flagged. `EpisodeUpgradesEnabled` stays off by default. | Suite: Phase 2 flags and verifies by title; the protection suite's executor refuses and the file is byte-identical. Live: a file arriving at a number for which an admin Refresh had created a file-less TMDB row is flagged. |
| S14 | Migration loses Keep, deadlines or history. | Additive columns and index swap only; verified on a DB copy with preserved counts and integrity/foreign-key checks. | Migration check on the 18096 copy. |

The riskiest part is **S1 together with S2**: the moment tracking starts, a library's whole watched
history becomes retention targets. The fresh-completion rule means turning this on deletes nothing
that was watched before tracking; only new watching counts.

## 5. API and UI surface

Plugin (camelCase, under `/JellyfinMod`, `[Authorize]`):

| Route | Who | Change |
| --- | --- | --- |
| `GET /Entries?jellyfinItemId=` | any user with access | unchanged contract; now finds the series of every numbered native episode |
| `GET /Entries/{id}` | any user with access | `episodes[].retentionPolicy` added; episode `retention` honours episode Keep; `history[].episodeId` added (from the event data; null for title events) |
| `POST /Entries/{id}/Episodes/{episodeId}/Keep` | **admin** | new; idempotent; one `episode_kept` history event on change; runs under the retention execution gate and library lock like entry Keep |
| `POST /Entries/{id}/Keep` | admin | unchanged (series Keep covers every episode) |

Users may still add entries; only admins remove entries, Keep or change settings (enforced in the
API). No un-Keep and no per-episode days writer ship until question 4 is answered; the columns exist
so the evaluator and summaries already honour them.

Web (`src/apps/modern/features/jellyfinmod/`, feature-local only): the native **episode** page's mod
section (already mounted by `nativeEntryDetails.js`) finds its episode by any version's item id,
shows that episode's retention line, its versions, its own History, and an admin **Keep** that keeps
the episode. The series page keeps series Keep and its per-episode retention list. Buttons are plain
`emby-button` controls in the existing focus flow, so desktop, mobile and TV (D-pad, Enter, Back)
work without a pop-up; nothing new needs `dpadModals`.

## 6. Tasks

| ID | Task | Depends on | Acceptance |
| --- | --- | --- | --- |
| D1 | This design | — | Committed, linked from PLAN |
| E1 | Track every numbered native episode: position rows, index migration, adoption in Refresh/Add/reconciliation, unmonitored, first-evaluation fresh completion for episodes | D1 | Migration on a copy of the 18096 DB preserves every table's rows; after deploy and one reconciliation on 18096 the Shows library's numbered episodes are bound and `GET /Entries?jellyfinItemId=<episode>` returns the series; retention stays disabled and every evaluation `disabled`; Phase 2/3/6 suites pass |
| E2 | Per-episode Keep and window in the engine: evaluator, preview (replacement), live check, upgrade service, summaries; `POST …/Episodes/{episodeId}/Keep` | E1 | HTTP: anonymous 401, admin 200, repeated admin call writes one history event, ordinary user 403; live: kept fixture episode survives an enabled run past its deadline |
| E3 | Episode-scoped detail: `retentionPolicy`, `history[].episodeId` | E2 | HTTP detail for the fixture series shows per-episode policy and episode history |
| E4 | Web episode page: episode Keep, episode retention, versions and History | E3 | Built bundle on `/web-mod/`, real Chromium then real Google Chrome, desktop/mobile/TV 1920×1080 and 1280×720 by keyboard: Keep focus stays, Kept shown, no page errors |
| E5 | Live retention E2E on disposable fixtures (fast window, then real window) | E1–E3 | See below |
| E6 | The user's answers of 2026-09-24: backlog rule (Q1), per-file Keep (Q3), episode un-Keep and window editor (Q4), multi-episode files (Q5), and review fixes RET-R2–R7 | answers | per answer; code done, live acceptance open (Handover) |
| E8 | Warn when a retention window starts (Q8, added 2026-09-24): `retention_started` history with cause and files; detail-page warning for every viewer, Keep inside it for admins | E6 | Live: windows started by playback, mark played and Trakt-style `Import` user data each show the warning and one event, desktop/mobile/TV by keyboard |
| E7 | Track an episode's merged files as versions (alternate media sources, as P6.M6 does for movies), then lift `episode_versions_untracked` | E5 | Live: a two-file fixture episode, watched, loses its lowest unseeded file first; a seeded file stays; the episode is reclaimed only when its last file goes |

**E5 fixture and acceptance.** A disposable library on 18096 pointing at the writable test root
holds `JellyfinMod P10 Show` with episode files carrying **no TMDB episode ids** (the production
shape): E01 in two versions (one hardlinked into a fake seeding path covered by an HTTP Transmission
boundary server below its ratio goal), E02 unwatched, E03 watched and **kept at episode level**, E04
watched **before** the plugin tracked it. Selected user `oleksii`, retention enabled for the run only.

1. Fast window (`RetentionTestWindowMinutes`): after watching E01 (either version) and E03 through
   the Jellyfin API, the native task reclaims E01's unseeded version only; E01's seeded version,
   E02, E03 and E04 stay **byte-identical** (SHA-256 before and after); sidecars stay; one
   `reclaimed` history event; run counts match; E04 stays `waiting` (question 1).
2. Real settings (`RetentionTestWindowMinutes = 0`, a 1-day window): the same flow schedules the
   deadline one day out and an immediate run reclaims nothing. The positive half needs the day to
   pass and is reported separately.
3. Afterwards retention is disabled, the test window and Transmission URL restored, the fixture files,
   library, entries and native items removed, and no `JellyfinMod …` title remains.

## 7. Open questions for the user

Each lists the default the implementation uses. **Q1–Q5 change what gets deleted; their defaults are
the ones that delete less and are proposed, awaiting the user.**

**All seven questions were answered by the user on 2026-09-24**; the answers are recorded in §2–§4
and summarised here. The original wording follows each answer.

- **Q1 answered:** only a new watch counts; baseline = later of first tracked and retention enabled.
- **Q2 answered:** series Keep wins.
- **Q3 answered:** per-file Keep, added.
- **Q4 answered:** episode un-Keep and episode window editor, added now (settings in the plugin DB).
- **Q5 answered:** a multi-episode file is deleted when every episode in it is due; the separate E7
  block for Jellyfin-merged files stays until E7.
- **Q6 answered:** a disposable non-admin user may be created on 18096 with a generated password
  that is never printed or stored, for the 403 checks, then deleted and proven gone.
- **Q7 (RET-R1) answered:** any copy watched counts, unless a version is kept.
- **Q8 (added 2026-09-24):** whenever a file's retention window starts, for any cause (a watch on
  this server, a watch imported from Trakt, mark played), the title's detail page warns everyone who
  can see it: "Added to retention: this file will be deleted on <date> unless kept", naming the cause
  and the file(s); a History entry records the start and its cause; admins get Keep inside the
  warning, ordinary users see the date but cannot Keep. This shows ordinary users a date, which the
  T15 privacy rule withheld; the user confirmed it overrides T15 for this warning only (Q11).
  Implemented (plugin `29d2648`, `07f2af7`, `08c97af`; web `d57459b9a8`, `e02996a611`).
- **Q9 answered:** switching retention off and on moves neither the episode floor nor a running
  countdown; the floor is the first-ever switch-on.
- **Q10 answered:** upgrades replace the older version immediately (Phase 6 design); per-file Keep,
  seeding and read-only media still protect it.
- **Q11 answered:** the warning's date is shown to ordinary users too.
- **Decision 13 (answered 2026-09-25, RET4-R1):** a title finished while retention is off gets a full new window from
  the next switch-on, announced with a visible warning, and is never due at once; the same for a window that ran out
  while off. See §3, "Newly tracked backlog" (plugin commit in the fourth review's fix record).
- **Decision 12 (answered 2026-09-24):** movies follow the episode backlog rule. Only a watch after the movie's
  floor counts: the later of when the plugin first tracked it and retention's first-ever switch-on. A movie watched
  before that needs a new watch. Migration `PhaseTenMovieBacklog` sends existing movie countdowns resting on an older
  watch back to waiting, each with a History entry (`retention_rule_changed`), so none becomes due on deployment
  (plugin `b93f605`).

1. **Backlog of already-watched episodes.** When tracking starts, should episodes watched before it
   (a) need a new completion — watched or marked played again — before they can be reclaimed
   (**default**), or (b) start their window at tracking time like movies did when retention was first
   enabled, reclaiming the whole watched backlog one window later? (b) is the more literal reading of
   "if I watched episode – remove it", and deletes far more at once.
2. **Keep precedence.** Keep at series or episode level protects the episode (**default**). Should an
   episode's own window be able to override a series Keep instead?
3. **Per-version Keep.** Keep covers every version of the movie or episode (**default**). Should an
   admin be able to keep one version (for example the 2160p) while the others are reclaimed?
4. **Episode un-Keep and window editor.** This is PLAN question 13 extended to episodes. Until it is
   answered, Keep is one-way and there is no per-episode days editor (**default**); the schema is
   ready for both.
5. **Multi-episode files.** Stay blocked (**default**, T16), or be reclaimed once every covered
   episode is due?
6. **Ordinary-user live check.** Every ordinary account on 18096 has a password the agents do not
   know, and they must not create accounts. The ordinary-user 403 is covered only by the supporting
   real-Kestrel suite (test authentication scheme); a live check needs a disposable non-admin account
   created by the user. **Not verified live.**

## Evidence — 2026-09-24

All on the isolated test instance (port 18096) with disposable fixtures only; production (8096) and
the Phase 7 acceptance instance (28096) untouched. Signed in as `oleksii` with an empty password.

**Deployed on 18096:** plugin commits `5637362` + `9d6d261` (DLL SHA-256
`67fa1ee3ca9537d65e3dfc4f5681ac2dec6ff0c31e8693400ef2fd28ceb200f6`; Health has no revision field),
web `83c75e3783` as plugin-served bundle `5ad7f9a1af3d` at `/web-mod/` (the instance's `/web`
root is read-only). Pre-deploy backup of the DLL, web zip, XML and database in the isolated build
directory `p10-backup-20260924T060010Z`. **Retention is disabled on 18096**, with every setting
restored to its saved value (All users, 14 days, test window 0, seed endpoint unchanged).

**E1.** The migration applied to a `.backup` copy of the 18096 database kept every row: entries
160, episodes 17, entry bindings 158, history 161, evaluations 53, observations 212, operations 4,
Keep 1, with identical per-table checksums, clean `integrity_check` and `foreign_key_check`. Live,
one catalog reconciliation (15 s) tracked **514 of 514** native episodes as position rows, all
unmonitored, 514 bindings, entries and Keep unchanged, no conflicts;
`GET /Entries?jellyfinItemId=<native episode>` now returns its series. Finding: the 18096 database
carries a **unique** `(EntryId, SeasonNumber, EpisodeNumber)` index although the EF model says
non-unique (pre-existing drift); reconciliation therefore never creates a TMDB row at a position a
position row holds.

**E2/E3.** Supporting real-Kestrel suite (`PhaseThreeProtectionIntegration`, test authentication
scheme and stubbed host services, so not acceptance): episode Keep anonymous 401, ordinary user 403,
admin 200, idempotent with one `episode_kept` event naming the episode, only that episode kept, its
preview row blocked. Suites Zero, One, Two, Three, ThreeProtection, Four (as root, as the existing
runner does), Five and Six pass; `PhaseSevenSettingsIntegration` fails on macOS on a download-folder
check that is unrelated. Live over HTTP as admin: episode Keep returned `policy never / kept`.

**E5 fast window** (`RetentionTestWindowMinutes = 3`, Selected user `oleksii`, seed protection on an
HTTP Transmission boundary server whose torrent is below its ratio goal). Fixture `JellyfinMod P10
Show` with episode files carrying no TMDB ids: E01 in two files (1080p, and 720p hardlinked to a
seeding copy), E02 unwatched, E03 watched and kept at episode level, E04 marked played with a date
before tracking, E05 watched, E06 watched and hardlinked to a seeding copy. Before the deadline:
E01, E05, E06 scheduled; E02 and E04 waiting; E03 kept. After it: E05 `due`, E06
`seed_goal_unmet`, E01 `episode_versions_untracked`, E03 kept, E02/E04 waiting; the 7 read-only
production rows `media_not_writable`, none due. The native task run: inspected 573, eligible 1,
reclaimed 1, blocked 47, failed 0, 71 670 logical bytes, physical bytes unknown (last link). **Only
E05's file was unlinked; every other fixture file, both seeding copies and the sidecar were
SHA-256-identical before and after.** E05 became `reclaimed` with its evaluation reset, one
`reclaimed` history event naming the episode, and no `media_missing` after a reconciliation.

**T7 regression, live:** E05's file came back at the same path (same native id, Jellyfin reattached
its old played state, last played 06:17); with retention enabled it stayed `waiting_for_completion`
because its baseline is the reclaim time (06:23).

**E5 real settings** (test window 0, 1-day window): E02 marked played was scheduled for the next
day (2026-09-25 06:24Z); two immediate runs reclaimed nothing and every hash was unchanged. **The
positive half (reclaim after the day) is NOT VERIFIED:** it needs the day to pass.

**E4 browser** (`scripts/jellyfinmod-e2e/episode-retention.mjs`): Playwright's Chromium, then real
Google Chrome 153 for the final pass, at desktop 1440×900, mobile 390×844, and TV 1920×1080 and
1280×720 by keyboard only. Every layout: the episode page resolves its own episode, admin Keep keeps
that episode only (server: episode `never`, series `inherit`), says so, keeps focus on TV, History
lists exactly the episode's own events, the remote Back key (461) leaves the page, no page errors.
The series page keeps series Keep; an API-kept episode shows Kept. Note: at 1920×1080, ArrowDown
from Keep passes the History toggle and ArrowUp returns to it. The probe was lint-autofixed
(formatting only) after the passing run. Physical webOS was not tested.

**Hygiene:** fixture files, seeding copies, the disposable library, the plugin entry and every
Jellyfin item were removed; no `JellyfinMod …` title remains in Jellyfin, the catalog or on disk.
The boundary server was stopped. Completed retention operations stay as the audit trail with their
entry detached (T10 design).

## Handover

Kept current as work lands. Model: Opus, effort high.

- **Worktrees:** plugin `.claude/worktrees/p10-plugin` (branch `p10-retention`); web
  `.claude/worktrees/p10-web` (branch `p10-retention`, fast-forwarded to `jellyfin-mod`).
- **Instances:** 18096 only. 28096 belongs to the Phase 7 agent; production 8096 is never touched.
- **State (2026-09-24, end of session):** D1, E1–E6 and E8 done and verified live, except the real
  window's positive half (scheduled for 2026-09-25 10:30Z, see below). E7 waits for V1 (Jellyfin 12
  version enumeration), a separate task.
- **Push:** the plugin commits could not be pushed from this session because the SSH agent lost its
  identities mid-session; they sit on local branch `p10-retention` in the plugin worktree, rebased
  onto nothing newer than `cdb6e7b`. Rebase onto `origin/master` and fast-forward push once the
  agent is available; stop if the Phase 7 agent's work conflicts.
- **Before enabling retention on real media:** a separate Opus 5.5 high verifier reviews this delete
  path (changed from Fable by the user, 2026-09-24). Questions 1–7 are answered.

## Evidence — 2026-09-24, decisions Q1–Q11 and the review fixes (Opus 5.5, high)

All on the isolated instance with disposable fixtures; production and 28096 untouched; signed in as
`oleksii` with an empty password. Host: Jellyfin 12.0.0.

**Deployed on 18096:** plugin `ab4d464` (DLL SHA-256 prefix of the final build recorded in the report),
web bundle `934ad614dfd7` (web `e02996a611`) at `/web-mod/`. Pre-deploy backup of the DLL, web zip,
XML and database: isolated build directory `p10e6-backup-20260924T085957Z`. Migrations
`PhaseTenRetentionControls`, `PhaseTenFirstEnabled`, `PhaseTenGraceFloor` applied at startup.

**Migrations (RET-R6, S14).** On a `.backup` copy of the 18096 database, `dotnet ef database update`
applied the new migrations; every table except the policy row (new column) is checksum-identical
before and after, `integrity_check` ok; the position index became non-unique. A database created from
an empty file by the full chain has the same three episode indexes. Live after deploy: same shape.

**Driver.** `scripts/jellyfinmod-e2e/retention-live.py` (RET-R5): every step below is a subcommand,
host values come from the environment, the token is kept 0600 and the disposable user's password
exists only in memory. `retention-controls.mjs` is the browser probe.

**Fast window** (3 minutes, Selected user `oleksii`, seed protection on the driver's fake
Transmission RPC with one torrent below its ratio goal). Fixture series in **two library roots**, so
E01 and E02 are each **one tracked episode with two bindings**; E01's second copy **kept per file**;
E02 watched on the second copy only; E03 unwatched; E04 kept at episode level; E05 marked played with
a date before tracking (backlog); E06 hardlinked to a seeding copy; `S01E07-E08` watched; `S01E09-E10`
watched while E10's own copy is unwatched; `S01E11` and `S01E11-E12` in one folder (Jellyfin 12
groups them) with E11 watched; E13 watched through synced user data; a two-file movie watched. Preview
after the deadline: E01 copy A, both E02 copies, `S01E07-E08` and E13 `due`; E01 copy B
`version_kept`; E04 `kept`; E03 and E05 `waiting`; E06 `seed_goal_unmet`; `S01E09-E10`
`multi_episode_not_all_due`; E11 `episode_versions_untracked`; the movie `versions_untracked`; the 7
read-only production rows `media_not_writable`. Native task run: inspected 581, eligible 5, reclaimed
5, blocked 50, failed 0, 358 394 logical bytes. **SHA-256: the five due files absent; E01's kept copy,
E03–E06, both multi-episode files that were not fully due, E10's copy, E11, `S01E11-E12`, both movie
files, the seeding copy and the sidecar byte-identical.** Reconciliation afterwards: no missing-media
event. First attempt note: watches made in the seconds before the plugin recorded the switch-on did
not count (Q1/Q9 working as designed); the driver now waits and marks unplayed first.

**T7 again, live:** fixture files recreated at the reclaimed paths (same item ids, Jellyfin reattached
played state) stayed `waiting/representation_reset`.

**Real window** (window 0, one day): E03 marked played → scheduled one day out with a warning; E03
window set to 2 days → deadline moved; E04 un-kept → scheduled, grace restarted; a synced watch on E10
→ warning "watched on another device (synced)"; an immediate run reclaimed nothing (all hashes equal).
Retention switched off and on (Q9): deadlines kept from the first switch-on, not restarted; an
administrator restart survived the switch after `PhaseTenGraceFloor` (it did not before: fixed in
`36f9d01`). A stale-evaluation race (an un-Keep overwritten by a batch that started earlier) was found
and fixed (`ab4d464`). **The positive half is scheduled, not yet verified:** a script on the Pi runs
at 2026-09-25 10:30Z: retention on (Q9: countdowns kept), native task, expected reclaims E04,
`S01E09-E10` and E10's copy with every other fixture file byte-identical, no missing-media event,
series Keep over E03's two-day window, then retention off, settings restored and every fixture
removed. Its log goes to the isolated build directory `p10e6/state/phase-b.log`.

**Q6 / decision 7, live:** a disposable non-admin user (random name, password generated in memory,
never printed or stored) got **403** on episode Keep, un-Keep, the window editor, version Keep and
un-Keep, series Keep, Remove and the retention settings; it saw every running warning **with its
date** (Q11); it was then deleted and `GET /Users/{id}` returned 404.

**RET-R2, live:** that user's Add of the existing series left every on-disk episode at TMDB id 0 and
unmonitored and created no second row at a held position. An admin Refresh adopted E01 only after its
native title matched TMDB's ("Pilot"), recorded `episode_adopted`, left the row unmonitored, and left
E03 (no matching title or date) tracked by position.

**RET-R3, live:** `p10e6/rollback-check.sh` switched retention off, stopped 18096, put back the previous
DLL, web bundle and the pre-deploy database, and the previous build served Health, Refresh of a
tracked series and Add of an existing series (200 each; no plugin errors in the log); then the new
build and the current database went back and the fixture state was intact.

**Browser** (`retention-controls.mjs`): Playwright's Chromium, then **real Google Chrome 153**, 44
checks each, all pass: desktop 1440×900, mobile 390×844, TV 1920×1080 and 1280×720 by keyboard only.
The warning names date, cause and file; Keep inside it keeps the episode and the warning goes; Stop
keeping brings it back with a restarted date; the episode window select sets 3 days; each file of a
two-file episode has its own Keep, toggled by Enter; the series page says Keep series (RET-R7); the
remote Back key leaves the page; no page errors. Found and fixed: focus fell to the page body when
Keep inside the warning or Stop keeping removed itself (`e02996a611`). Physical webOS not tested.

### Handover — 2026-09-24, retention decisions and review fixes (Opus 5.5, high)

**State at the end of the session:** everything above is done and verified live except the real
window's positive half, which runs on the Pi at 2026-09-25 10:30Z and removes the fixtures afterwards;
until then the fixture series and movie stay on 18096 with **retention disabled**. Remaining: check
`p10e6/state/phase-b.log` and `phase-b.DONE`, record the result here, and confirm no `JellyfinMod …`
title remains. The verifier (a separate Opus 5.5 high) should look at S17–S19. V1 and E7 are separate
tasks. Titles still have no un-Keep or days editor (PLAN question 13 for titles).

**Resumed past the 80 % pause at the user's request (2026-09-24).** Since the first handover: Q9 (grace
and the episode floor count from the first-ever switch-on; plugin `1c47d8b`, migration
`PhaseTenFirstEnabled`), Q10 (upgrades replace at once again, same commit), the Jellyfin 12.0.0 guards
(`versions_untracked` for movies, the episode guard extended to extra versions, file comparison by path,
`retention_reset` history when a clock resets because a file was not observed; plugin `c7f509e`), and Q8/Q11
(the detail warning with date, cause and files for every viewer, Keep for admins; plugin `07f2af7`, web
`d57459b9a8`). Next: deploy to 18096 and the live run.

Commits on `p10-retention` (plugin local only, the plugin repository is master-only; neither is pushed
into `master` or `jellyfin-mod`):

- Plugin: `f4d427c` Q1, `b5a46fc` Q3–Q5 and RET-R2/R3/R6, `29d2648` Q8 event, `1c47d8b` Q9/Q10,
  `c7f509e` Jellyfin 12 guards and C5 record, `07f2af7` Q8/Q11 warning API, `08c97af` synced cause and
  file names, `36f9d01` grace restart kept across off/on, `ab4d464` fresh Keep per evaluated target.
- Web: `0d89e18537` controls and RET-R7, `d57459b9a8` warning, `095a4ddf6f` version Keep labels,
  `e02996a611` focus after a change, `bc82337f5f` / `32d9058b2e` driver and probe; docs `a3985b650b`,
  `57406d95db`, `62c4e1b805`, this commit.
- Supporting suites after the last change: Zero, One, Two, Three (Mac), ThreeProtection, Five, Six (Pi,
  unprivileged) pass; Four needs root as before and was not run.

## Second delete-path review fixed — 2026-09-24 (Opus 5.5, high)

The findings of [`REVIEW-2026-09-24-retention-2.md`](REVIEW-2026-09-24-retention-2.md) are fixed and recorded there,
each with its commit and evidence (fix record at its end): RET2-R1–R5, R7, R9 and R10 fixed, R8 addressed, R6 recorded
for V1. Plugin `bb6c7c5` (engine and migration `PhaseTenRetentionFixes`, forward-only; rollback is the database backup
as for the other Phase 10 migrations), `c970aab` and `84b6937` (suites); web `02f7294d99` and the driver, probe and
cron job that follow it. Semantics changed in §3 (re-acquired files, multi-episode rows, Keep) and §4 (S18, S19).

**Deployed on 18096:** plugin `bb6c7c5` (DLL SHA-256 prefix `ae2178da36278d1c`), web bundle `02f7294d99` at `/web-mod/`;
backup `p10r2-backup-20260924T111423Z`. **Retention is disabled on 18096.**

**The 2026-09-25 10:30Z phase-B run was cancelled** (it would have tested a replaced build) and its fixtures removed.
**A new real-window run fires at 2026-09-25 12:30Z** from a user crontab entry on the Pi (reboot-safe: it runs at the
first ten-minute tick at or after that time once the instance answers), then switches retention off, restores the
settings and removes every fixture, and deletes its own crontab line. Until then the RET2 fixtures stay on 18096 with
retention disabled.

### Handover — 2026-09-24, second review fixes

- Remaining: read `p10r2/state/phase-b.log` and `phase-b.DONE` in the isolated build directory after 2026-09-25 12:30Z,
  record the result here and in the review, and confirm no `JellyfinMod …` title, entry, library or file remains and the
  crontab line is gone.
- Not verified live: an upgrade import refused by `identity_unverified` (suite only), the RET2-R4 race, the RET2-R9
  cross-filesystem move (suite only). Physical webOS not tested.
- `EpisodeUpgradesEnabled` stays off by default; RET2-R3's guard is its precondition and is now in place.
- Rebase of plugin `p10-retention` onto the retargeted `master` happens after this work and the retarget agent's.

## Third delete-path review fixes — 2026-09-25 (Opus 5.5, high; paused at the 80 % limit)

Findings of [`REVIEW-2026-09-24-retention-3.md`](REVIEW-2026-09-24-retention-3.md). Plugin `p10-retention` is rebased
onto the Jellyfin 12 `master` `f443a62`; web `p10-retention` onto `jellyfin-mod` `a279641ebf`. Neither is pushed.

- **RET3-R1** (web `8204941858`): the real-window job is fail-safe: `phase-b.STARTED` before phase B; `safe-finish`
  (restore, clean up, verify, each retried) on every tick until it proves retention off and no fixture left; only then
  `phase-b.DONE` and the crontab line removed; otherwise `phase-b.FAILED` counts, the log and syslog say so and the job
  stays armed. Deployed on the Pi as `p10r2/retention-phase-b-cron.sh` (SHA-256 `96bc0cd2…`) and
  `p10r2-retention-live.py` (`dc6d202b…`, the driver of that commit); the crontab line is unchanged.
- **Decision 12** (plugin `b93f605`), **RET3-R2–R8, RET3-N1, the merged-version guard gap and the `database is
  locked` preview** (plugin `7fe53c1`, `30421c2`, `2e90a54`, `15589f1`; web `34c079cb94`, `c61e89f56d`, `c22c90abb3`).
  Live evidence goes into the review's fix record.
- **Deployed on 18096:** plugin `15589f1` (DLL SHA-256 prefix `0ad08f5b323fc784`), web bundle `350e27ced474` from the
  clean tree at `c22c90abb3` (`/web-mod/`); backup `p10r3/backup-20260925T004520Z`. **Retention is disabled on 18096.**
- Browser probe on the deployed bundle: overdue, covered-number, warning, Keep and Stop keeping, window select, per-file
  Keep and TV keys pass on desktop, mobile, TV 1080 and TV 720 in Chromium 153.0.8010.12 and Google Chrome
  153.0.8010.53.

### Handover — 2026-09-25, third review

- Done: every finding fixed and verified live or in the suites (review fix record). The RET3-R1 failure path was
  rehearsed on 18096 (injected restore failure, instance down, then a normal tick). The RET3 fixture set was removed.
  **Retention is off on 18096.**
- The P10 set is gone. It was removed at 03:49Z by the deployed `safe-finish` (verified), because its moved deadlines
  (RET3-N1) meant the 12:30Z job could not test anything.
- **Blocked:** the permission system refused to replace the crontab line twice. The old line
  (`p10r2 … 202609251230`) therefore still stands. At 12:30Z it finds no fixture series and stops before switching
  retention on. `safe-finish` then verifies the instance safe, writes `DONE` and removes the line. Check afterwards
  that `p10r2/state/phase-b.DONE` exists and `crontab -l` no longer lists it.
- Remaining, once the user allows or makes the crontab change: build a fresh tagged set on this build (`save`, `media`,
  `library`, `reconcile`, `backlog`, `configure 3 1`, `act`, the fast run and its checks, then `configure 0 1`, `real`,
  `hashes phaseb-before`, `restore`). Then add one line
  `*/10 * * * * <build>/p10r3/retention-phase-b-cron.sh <env of that set> <build>/p10r3/retention-live.py <target>`,
  with the target at least 25 hours after `real`. Wait until the old job has written `DONE` first: its clean-up removes
  every `JellyfinMod` entry.
- Suites and the browser re-run on the final commits: checklist in the workspace, `.claude/briefs/verify-retention-r3.md`.

### Handover — 2026-09-25, fourth review

- Decision 13 and RET4-R2–R6 are fixed (fix record in [`REVIEW-2026-09-25-retention-4.md`](REVIEW-2026-09-25-retention-4.md));
  RET4-R2's unbound-main remainder is recorded for V1. Rebased onto the S11 release (plugin `master` `e5b3c95`, web
  `jellyfin-mod` `48e60121e7`) without conflicts; plugin `348168b` and web bundle `9d30aba7e9b3` (`a30926e30c`) are
  deployed on 18096. **Retention is off on 18096**, and no `JellyfinMod` entry, library or fixture directory is left.
- **Suites verified on `348168b`** (Sonnet-high verifier, all twelve `exit=0`). **Merged with retention off**
  (2026-09-25): plugin `master` and web `jellyfin-mod` fast-forwarded to the `p10-retention` tips; the branches are
  deleted, and `p10-retention-pre-rebase4-backup` is kept in both repositories until the real-window run passes.
- Open: the real-window re-arm,
  waiting on the user, after the old job has written `p10r2/state/phase-b.DONE`. The scripts now refuse any instance
  but 18096 (RET4-R4); the old job still runs its own older driver, which has no such guard but whose environment
  file names 18096.

## Stale played state after an import — 2026-09-26 (Q16 review P2-2; Opus 5.5, high)

**The old real-window job finished** overnight: `p10r2/state/phase-b.DONE` exists, its log ends "phase-b DONE: retention
verified off, settings restored, no fixture left; crontab line removed", and `crontab -l` no longer lists it (checked on
the Pi by the coordinator, 2026-09-26 08:21 Sydney). As expected, it ran against no fixtures and did not prove the real
window's positive half.

**Finding (Q16 review P2-2, verified in the Jellyfin v12.0 source):** `IUserDataManager.GetUserData(user, item)` reads
only the user data rows loaded into the item instance it is given, and `SaveUserData` reloads only the instance it saved
through. `ILibraryManager.GetItemById` returns the library manager's cached instance. A save made through another
instance of the same item therefore leaves the cached one serving the old state until it is evicted or the server
restarts. Three writers save that way:
- the Trakt plugin's history sync (`SyncFromTraktTask` loads items with `GetItemList`, reason `Import`);
- the NFO importer (`BaseNfoParser`, reason `Import`);
- **stock Jellyfin's "mark season/series played" and "unplayed"** (`Folder.MarkPlayed`/`MarkUnplayed` load the episodes
  with `GetItemList`).

Retention read played state through the cached instance in three places: the evidence the listener records, the last
check before an unlink, and a multi-episode file's completion. So an imported watch started no window. Worse, a title
marked unwatched that way could still read as played at the last check before its unlink.

**Fix** (plugin `ee385df`): those three reads use `ILibraryManager.RetrieveItem`, which loads the item and its user
data from the database without touching the cache. An item that cannot be read counts as unavailable, which never
deletes. The saved user data carried by the event is not used, because the listener coalesces events per user and item:
the stored state is the newest one.

**Evidence** (all on 18096 with a tagged fixture set, `P22`, removed afterwards; retention off except a one-minute test
window for the last step):
- *Before the fix, live:* the season holding E03 and E04 was marked played through stock Jellyfin. Jellyfin stored them
  played, but its cached items and the plugin's observations stayed unplayed. This is the gap, reproduced on the
  unmodified Jellyfin 12 host.
- *After the fix, live, import direction:* the same season mark was recorded as played with its date, with no restart,
  while Jellyfin's own cached items still said unplayed. With retention on, both windows started with the warning.
- *After the fix, live, unwatched direction:* both episodes were played through their cached items, then the season was
  marked unplayed through fresh instances, so the cached items still said played. The plugin recorded both as unplayed,
  and a run after the windows had passed reclaimed nothing (every fixture byte-identical; inspected 603, reclaimed 0,
  failed 0).
- *Protection suite on the Pi* (models the cache: `GetItemById` returns the cached instance, `RetrieveItem` a stored copy):
  - an unwatched import while the cached item says played is refused `live_not_completed`, with the file byte-identical;
  - an imported watch while the cached item says unwatched is recorded played with its date;
  - without the fix, the same suite reclaims the unwatched title.
- Not observed live: the last check itself refusing, because the fixed evidence path already moves the title to
  waiting before any run can pick it. That check is proven in the suite.

### Handover — 2026-09-26, P2-2

- Branch `p10-userdata-fresh` (plugin, off `348168b`; web, off `c554c3e312`), not pushed. Plugin `ee385df` is deployed on
  18096 (DLL SHA-256 prefix `5315461ef93c2a23`), with the web bundle unchanged (`9d30aba7e9b3`). The live checks ran on
  `1d3166f`, which has the same product code; the amend changed only the protection suite. **Retention is off**,
  and no `JellyfinMod` fixture is left.
- Next: the Fable review and the Sonnet verification (Section A of `.claude/briefs/verify-retention-r3.md`, refreshed for
  this commit). Then the merge, the fresh real-window fixture set, and `p10r3/arm-real-window.sh` (with `--disarm`)
  for the user.
