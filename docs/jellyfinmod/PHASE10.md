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

**Automatic reclamation of real (non-fixture) media stays disabled on every instance.** A Fable
verifier reviews this delete path before that changes (PLAN work queue).

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
  - kept when the **series or the episode** is kept (Keep at either level wins);
  - otherwise the window is the episode's days, else the series' days, else the global window.
  Keep applies to every version of the target; there is no per-version Keep (question 3).
- **Watched state** stays per target and per user from Jellyfin user data, aggregated across the
  target's versions (T8): resume or favourite on any version protects all; finishing any version
  completes the target (existing, accepted rule).

### Data model changes (one migration)

```
Episodes  + RetentionPolicy INTEGER NOT NULL DEFAULT 0   -- inherit
          + ReclaimAfterDays INTEGER NULL
          unique (EntryId, TmdbId)                        -> unique (EntryId, TmdbId) WHERE TmdbId <> 0
          + unique (EntryId, SeasonNumber, EpisodeNumber) WHERE TmdbId = 0
```

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

- **Refresh and Add adopt position rows.** When a TMDB episode arrives (series Refresh, a user's Add
  on an existing entry) and no row has its TMDB id, a position row at the same season and episode is
  adopted: it takes the TMDB id and metadata, keeps its id, bindings, Keep, evaluations and history.
- **Reconciliation adopts too.** A native episode that later gains a TMDB id (the library switched
  scraper) adopts the position row it is bound to instead of opening a conflict, provided no other
  row has that TMDB id.
- **Position rows never match by TMDB id** (`0` is not an identity) and match only TMDB-less native
  episodes at their position, as TMDB rows already do.
- **Position rows are not monitored.** They were discovered, not wanted; automation never searches
  them unless an admin turns monitoring on.

## 3. Retention semantics per episode

| Case | Behaviour |
| --- | --- |
| Watched-user policy | Unchanged: All users / Selected user / Any user per episode, evaluated over users with access to the series' library. |
| Partially watched | Not watched. Any resume position on any version by any accessible user protects (`active_resume`); watched means Jellyfin's played flag with no resume. No separate percentage rule (PHASE3, accepted). |
| Specials (season 0) | Episodes like any other; the user's decision covers every media item. Unnumbered specials stay skipped with a diagnostic (P2.R6) and are never targets. |
| Multi-episode files | Blocked (`multi_episode_unsupported`, T16) — a file covering E01–E02 is never unlinked because E01 was watched (question 5). |
| Newly tracked backlog | An episode's retention baseline is the moment it gains its **first binding** (reconciliation seeds the evaluation then; an episode bound earlier gets it at its first evaluation), and it needs a completion **after** that baseline carrying Jellyfin's own last-played date (`RequiresFreshCompletion`). Episodes already watched before tracking are not reclaimed until watched (or marked played) again; a played flag with no last-played date never counts. **Proposed default awaiting the user (question 1).** Movies keep today's rule. |
| Several files of one episode | Jellyfin 10.11 merges them into one item with alternate media sources, and episode observations see only the item. Until E7 tracks them, such an episode is **blocked** (`episode_versions_untracked`) so no file of it is unlinked. |
| Re-acquired episodes (T7–T10 class) | Unchanged per target: losing the last binding resets the evaluation (`RetentionTargetReset`) in the same transaction, so a returning file never inherits a deadline or an old completion. |
| Seed protection | Per file, unchanged: a version seeding below its goal (plugin-owned or Transmission) stays blocked while a lower version of the same episode may be reclaimed (M7). |
| Hardlinks between versions | Unchanged shared-inode rule: two bindings on one inode are one physical action and need every affected target due; hardlink count above one records zero physical bytes released. |
| Series container | When the last episode binding of a series is reclaimed the series entry becomes `reclaimed` (T14) and keeps metadata, Keep, history and bindings of its native series item. Reconciliation writes no `media_missing` for it. |
| Keep | Admin only, one action, no confirmation (accepted). Series Keep protects every episode; episode Keep protects that episode's versions. No un-Keep and no days editor until PLAN question 13 is answered (question 4). |

## 4. Safety analysis — every way this could delete something it should not

| # | Risk | Guard | Evidence |
| --- | --- | --- | --- |
| S1 | **Backlog wave:** binding hundreds of already-watched episodes makes them all due one window later. | First-evaluation fresh-completion rule for episode targets; old played state never counts (question 1). | Live: a fixture episode watched before deploy stays `waiting` after binding; watched after binding, it is scheduled. |
| S2 | Two different episodes grouped as versions of one row, so watching one deletes the other. | Position rows group only native episodes of the **same series entry** at the **same season and episode**; the unique position index forbids a second row; TMDB-less natives never match TMDB ids; observation conflicts (same position, different TMDB ids) are skipped per P2.R9. | Migration and live bind counts; conflict path unchanged. |
| S3 | A TMDB refresh creates a duplicate row beside a position row, splitting versions or evidence. | Adoption in Refresh, Add and reconciliation; unique indexes make a duplicate a hard failure rather than silent. | Live: refresh of the fixture series keeps one row per episode. |
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
| E6 | Gated on the user's answers: episode un-Keep and days editor (Q4), backlog rule change (Q1), per-version Keep (Q3) | answers | per answer |
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
- **State:** D1, E1–E5 done as recorded above, except the real-window positive half. E6 waits for
  the user's answers; E7 (episode files merged by Jellyfin) is the next implementation task.
- **Push:** the plugin commits could not be pushed from this session because the SSH agent lost its
  identities mid-session; they sit on local branch `p10-retention` in the plugin worktree, rebased
  onto nothing newer than `cdb6e7b`. Rebase onto `origin/master` and fast-forward push once the
  agent is available; stop if the Phase 7 agent's work conflicts.
- **Before enabling retention on real media:** a Fable verifier reviews this delete path, and the
  user answers questions 1–5.
