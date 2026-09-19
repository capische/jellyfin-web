# Phase 6 — automation and multi-quality

Planning draft, 2026-09-19. Read [PLAN.md](PLAN.md), [README.md](README.md) §6–§7,
[UX.md](UX.md) §9, §11, §12 and §13, [PHASE3.md](PHASE3.md), [PHASE4.md](PHASE4.md),
[PHASE5.md](PHASE5.md) and [API.md](API.md) alongside this refinement. This document plans
work; it does not establish that Phase 5 has passed acceptance, and it does not authorize a
production deployment. Every default below that is not quoted from an earlier accepted decision
is **Proposed, not user-approved**.

The 2026-09-19 user decisions recorded in PHASE4 and PHASE5 apply unchanged: Transmission is the
only download client, grabs keep the 5-second cancellable hold (automatic grabs included),
secrets stay in the secret store, and every import is a same-mount hardlink.

Phase 6 is where "monitored" starts to mean something. Until now monitoring has been a stored
flag (Phase 1: "Monitoring does not trigger downloads"; Phase 4: "Monitoring alone starts nothing
here"). Everything that turns it into automatic acquisition is new behaviour and is proposed.

## Outcome and boundaries

Monitored entries and episodes are searched on a schedule, within budgets, and grabbed
automatically when a release passes their profile; new episodes of monitored series are acquired
after they air; a title below its profile's cutoff is upgraded, either by replacing the old file
or by adding a second version, without Phase 2 mistaking the change for an external removal; an
administrator can ask for another quality explicitly from the version selector; the version
selector shows resolution, codec, audio and size per version and is fully D-pad operable; and
retention treats each version as its own physical representation while protecting the title as a
whole. A kill switch, budgets, per-indexer limits and an admin decision log keep the automation
from running away.

- Phase 6 owns: the search scheduler, backoff and budgets; new-episode acquisition; the
  upgrade-to-cutoff decision and its replacement provenance; the explicit *Get another quality*
  path; per-version retention ordering; the version-selector enrichment; automation settings and
  visibility.
- Phase 6 reuses, and does not rewrite: Phase 4 search, parsing, scoring, profiles and grab
  (`GET /Releases`, `POST /Releases/Grab`); Phase 5 import, queue and seed release; Phase 3's
  retention executor and operations for every deletion; Phase 2 reconciliation for every binding.
- Automation never deletes anything directly. A replaced version is reclaimed through a Phase 3
  `RetentionOperation` carrying provenance `upgrade_replaced`, so reconciliation attributes the
  disappearance to a plugin operation exactly as it does for a retention reclaim.
- Automation is admin-configured and off by default (proposed). It never widens Phase 4's
  authorization: ordinary users still cannot search, grab or change profiles.
- Multi-version grouping is native (README §7.1); Phase 6 lands files that Jellyfin merges and
  polishes the web selector. It does not build its own version model or call
  `POST /Videos/MergeVersions` in the first slice.
- Scope stays movies and single episodes. Season packs remain rejected (Phase 4 A1); pack import
  is out of scope for this phase.
- All development, deployment and E2E use `jellyfinmod-test` (port 18096), the disposable
  client, the Torznab boundary server and the isolated writable library. Production is never
  contacted.

## Accepted decisions carried into this phase

- The version selector stays and keeps working exactly as it does; enrichment is a richer row
  renderer beside the existing selector, not a replacement (UX §11, Principle 0 and 4).
- *Get another quality* opens the Phase 4 release picker from inside the selector (UX §9, §11).
- Quality profiles, cutoff and `upgrade_allowed` are Phase 4 data whose automation was deferred
  to this phase (PHASE4 data model; README §4).
- Retention evaluates each physical representation and marks the title reclaimed only when no
  playable representation remains (PHASE3 "Multiple qualities/copies"); observations aggregate
  across versions so resume or favourite on any version protects every version (T8).
- Search and grab are admin-only (Phase 4 A1, `jellyfinmod-phase4`). Monitoring is admin-only
  (Phase 1). Settings live on the plugin Dashboard page (UX §12).
- Never port GPL-3.0 Sonarr/Radarr code. Their behaviour may inform test cases; their source may
  not be used (README §7.1, `plugin/CLAUDE.md`).

## Proposed defaults

**Proposed, not user-approved.** Resolve in M1 before M3 is enabled on the isolated instance.

| Decision | Proposed first slice |
| --- | --- |
| Master switch | `AutomationEnabled` default **off**. When off, no scheduled search runs, no automatic grab is submitted and no upgrade is decided; manual Phase 4 grabs and Phase 5 imports continue. |
| Which targets | Monitored movie entries in `none`/`reclaimed` state and monitored episodes of monitored series that are aired, `missing` or `reclaimed`, plus monitored on-disk targets whose best held version is below their profile cutoff when the profile allows upgrades. Unmonitored means never searched. Reclaimed titles are searched only if the entry is still monitored, which Phase 3 leaves unchanged; an admin who wants a title to stay gone unmonitors it. |
| Schedule | One `IScheduledTask`, `JellyfinModAutomationSearch`, default every 6 hours, processing targets in a bounded batch (default 40 per run) ordered by next-due time. Manual runs obey the same budgets. |
| Backoff | Per target: after an empty or rejected-only search the next search is due in 12 h, then 24 h, 48 h, 96 h, capped at 7 days; reset by a metadata change (new air date, profile change, re-monitor) or an explicit manual search. |
| New episodes | An aired monitored episode is first searched no earlier than `NewEpisodeDelayMinutes` (default 120) after its air time, then follows backoff. Air dates come from the existing Phase 1 metadata and the metadata-only Refresh (P7/T10); the scheduler triggers a Refresh for monitored series with unaired episodes at most once per day. Specials (season 0) are not auto-acquired unless the episode is monitored explicitly. |
| Automatic pick | The highest-scoring eligible candidate of the Phase 4 evaluation; rejected rows are never grabbed; `identity_unverified` (title-only) rows are never grabbed. A candidate below a configurable minimum score or seeders count is skipped, not grabbed. |
| Budgets | Per indexer: the caps-advertised limit, a minimum interval (default 10 s) and a daily query budget (default 200). Global: daily automatic grab budget (default 6), per-entry automatic grabs (1 per 24 h), maximum concurrent open imports (default 3), and a free-space floor on the library mount (default 10 % or 25 GB, whichever is larger) below which no automatic grab is submitted. |
| Circuit breaker | Five consecutive indexer failures (timeouts, 429, 5xx, malformed XML) open the breaker for that indexer for one hour; searches continue on the others. Client unreachable pauses automatic grabs until the next run. |
| Upgrade policy | Only when the profile's `upgradeAllowed` is true and the held versions' best quality is below `cutoff`. The new release must score higher than the held best. Default mode per profile: **replace** for movies; **add** is the explicit *Get another quality* path. Episodes follow the I1 spike (see gates): replace only if the host groups episode versions, otherwise upgrade is blocked with `episode_versions_unsupported`. |
| Replacement sequence | Import the new version through Phase 5 as an additional version; only after it is bound, playable and its seed release is registered, create a Phase 3 `RetentionOperation` for the superseded binding with `Provenance = upgrade_replaced`, executed by the existing executor under the same locks and safety checks, skipping the watched-completion requirement but keeping every protection check (active session, resume, favourite, Keep, seed state, storage identity). |
| Keep and upgrades | Keep protects the whole entry from every deletion, including replacement: a kept entry can only gain versions. Open question 2. |
| Proper/repack | Not auto-replaced within the same quality in the first slice; visible in the picker as today. Open question 7. |
| Reclaim order | When a due target has several versions, the executor processes versions in ascending quality order within one run, each with its own seed and protection checks. Nothing changes in what is due; only ordering does. |
| Get another quality | Admin-only; opens the picker with `intent=addVersion`, which relaxes only the one-active-grab rule for that search and marks held qualities in the candidate list. The import lands as an additional version. |
| Visibility | Every automatic decision (searched, skipped with reason, grabbed, upgrade planned, breaker opened) is recorded in a bounded decision log (default 2 000 rows, pruned) readable by admins; history receives only `auto_grabbed`, `upgrade_replaced` and `upgrade_added` events. The queue shows a *Automation paused* banner when the master switch is off or a budget is exhausted. |

## Entry gates and dependencies

**Proposed, not user-approved.**

1. Phase 5 I9 is accepted on the isolated test instance, including seed release and the
   retention credit; automation multiplies whatever import does, so import must be right first.
2. Phase 4 A8 and the Phase 3 blockers T7, T8, T9, T10 and T18 remain green on the revision
   Phase 6 builds on; T11's access/user-event fidelity is recommended because automation runs
   unattended.
3. The Phase 5 I1 spike on episode versions is recorded. Its result decides the episode rows of
   the upgrade policy and the selector.
4. Phase 4 profiles carry `cutoff` and `upgradeAllowed` with a migration or an activation of the
   deferred fields; deleting a profile in use remains refused.
5. X4 Health `capabilities` gains `automation` and `versions`; the web gates the selector
   enrichment and the automation surfaces on them.
6. The isolated Torznab boundary server can simulate a feed that changes between polls (new
   episode appears, higher quality appears, 429 and 5xx responses), and the disposable client
   can hold several fixtures at once. Extend A9 rather than adding a second harness.
7. The free-space floor can be read for the library mount from inside the container
   (`statvfs` through the existing `UnixFileInspector` or an equivalent); record the value the
   isolated mount reports.

## Data model and ownership

| Record | Minimum contents and invariants |
| --- | --- |
| `AutomationTargetState` | `TargetId` (entry or episode), `EntryId`, `EpisodeId?`, `NextSearchAt`, `LastSearchedAt?`, `ConsecutiveEmpty`, `LastOutcome`, `LastGrabId?`, `LastAutoGrabAt?`, `ProfileRevisionSeen`. One row per target; created lazily when a target first qualifies. |
| `AutomationDecision` | `Id`, `RunId`, `TargetId`, `EntryId`, `EpisodeId?`, `Kind` (`searched`, `skipped`, `grabbed`, `upgrade_planned`, `upgrade_completed`, `breaker_opened`, `budget_exhausted`), `Reason`, `Detail` (bounded, admin-only), `IndexerId?`, `GrabId?`, `CreatedAt`. Pruned to the configured cap. |
| `AutomationRun` | `Id`, `StartedAt`, `CompletedAt?`, `Status`, counts `targetsConsidered`, `searched`, `skipped`, `grabbed`, `upgradesPlanned`, `queriesByIndexer` (JSON), `Detail`. Same shape family as `RetentionRun` and `ReconciliationRun`. |
| `IndexerBudgetState` | `IndexerId`, `Day`, `QueriesUsed`, `BreakerOpenUntil?`, `ConsecutiveFailures`. |
| `UpgradeOperation` | `Id`, `EntryId`, `EpisodeId?`, `SupersededBindingId`, `SupersededQuality`, `NewGrabId`, `NewImportOperationId?`, `ReplacementRetentionOperationId?`, `Mode` (`replace`/`add`), `State` (`planned`, `importing`, `imported`, `replacing`, `completed`, `blocked`, `failed`), `Reason?`, timestamps. The bridge that ties a Phase 5 import to a Phase 3 operation. |
| `RetentionOperation` (Phase 3) | Gains `Provenance` (`retention` default, `upgrade_replaced`) and `UpgradeOperationId?`. The executor's completion path writes `upgrade_replaced` history instead of `reclaimed` for that provenance and does not set the target `reclaimed` when another playable binding remains (which it already checks). |
| Quality profile (Phase 4) | `Cutoff` and `UpgradeAllowed` activated; `UpgradeMode` (`replace`/`add`) per profile; `MinimumAutoScore`, `MinimumSeeders` optional. |
| Settings | `AutomationEnabled` (off), `AutomationIntervalHours` (6), `AutomationBatchSize` (40), `NewEpisodeDelayMinutes` (120), `DailyAutoGrabBudget` (6), `MaxConcurrentImports` (3), `FreeSpaceFloorPercent` (10), `FreeSpaceFloorBytes` (25 GB), `DecisionLogCap` (2000). Per-indexer `MinIntervalSeconds` and `DailyQueryBudget` on the Phase 4 indexer record. |
| History | `auto_grabbed`, `upgrade_added`, `upgrade_replaced`, `automation_paused` (once per pause cause change). |

Ownership: the scheduler decides and calls Phase 4's grab; Phase 5 imports; Phase 3 deletes the
superseded version; Phase 2 binds and attributes. No Phase 6 service writes `Entry.State`, a
binding row or a file.

## API contract

All routes under `/JellyfinMod`, `[Authorize]`, camelCase, UTC ISO 8601; the automation and
settings routes require `Policies.RequiresElevation`.

| Endpoint | Contract |
| --- | --- |
| `GET /Automation/Status` (admin) | `{ enabled, pausedReasons[], nextRunAt, lastRun: <AutomationRun>, budgets: { autoGrabsUsedToday, autoGrabBudget, openImports, maxConcurrentImports, freeBytes, freeFloorBytes }, indexers: [{ id, name, queriesUsedToday, dailyQueryBudget, breakerOpenUntil }] }`. |
| `POST /Automation/Run` (admin) | Queues the native task (202), obeying budgets; 409 while a run is active. |
| `GET /Automation/Decisions?entryId=&episodeId=&kind=&startIndex=&limit=` (admin) | Paged decision log, newest first, `{ items, totalRecordCount }`. |
| `GET /Automation/Targets?entryId=` (admin) | Per-target state: `nextSearchAt`, `consecutiveEmpty`, `lastOutcome`, held best quality, cutoff, `upgradeEligible`, `blockedReason`. |
| `PATCH /Entries/{id}` and `PATCH /Entries/{id}/Episodes/{episodeId}` (existing, admin) | `monitored` already exists; gains optional `searchNow: true`, which resets backoff and queues one search for that target on the next run. Strict unknown-field rejection is preserved. |
| `GET /Releases?entryId=&episodeId=&profileId=&intent=addVersion` (Phase 4 route) | `intent` defaults to `acquire`. `addVersion` is accepted only for a target with a playable binding; the snapshot records it, candidates gain `heldQuality: true/false`, and the one-active-grab rule is relaxed for this snapshot only. |
| `POST /Releases/Grab` (Phase 4 route) | Unchanged shape; the grab inherits the snapshot's intent. Import lands an additional version for `addVersion`. |
| `GET /Entries/{id}` (existing) | Detail gains `versions: [{ jellyfinItemId, bindingId, label, resolution, videoCodec, audioCodec, audioChannels, sizeBytes, isDefault, retention }]` for movies and per episode, built from the bound native items' `MediaSources`, plus `upgrade: { eligible, cutoff, heldBest, mode, blockedReason }`. |
| `GET /Settings/QualityProfiles` etc. (Phase 4 routes) | DTOs expose `cutoff`, `upgradeAllowed`, `upgradeMode`, `minimumAutoScore`, `minimumSeeders`; validation requires the cutoff to be one of the allowed qualities. |
| `GET /Health` | `capabilities` gains `automation` and `versions`. |

Automation status (illustrative):

```json
{
  "enabled": true,
  "pausedReasons": [],
  "nextRunAt": "2026-09-19T18:00:00Z",
  "lastRun": {
    "id": "8888…", "startedAt": "2026-09-19T12:00:00Z", "completedAt": "2026-09-19T12:03:41Z",
    "status": "completed", "targetsConsidered": 37, "searched": 12, "skipped": 25,
    "grabbed": 2, "upgradesPlanned": 1,
    "queriesByIndexer": { "9999…": 12 }, "detail": null
  },
  "budgets": { "autoGrabsUsedToday": 2, "autoGrabBudget": 6, "openImports": 1,
               "maxConcurrentImports": 3, "freeBytes": 412000000000,
               "freeFloorBytes": 25000000000 },
  "indexers": [ { "id": "9999…", "name": "Boundary", "queriesUsedToday": 12,
                  "dailyQueryBudget": 200, "breakerOpenUntil": null } ]
}
```

Decision `reason` codes (stable): `not_due`, `unmonitored`, `unaired`, `already_held_at_cutoff`,
`upgrade_not_allowed`, `budget_grabs`, `budget_indexer`, `breaker_open`, `free_space_floor`,
`too_many_open_imports`, `client_unreachable`, `no_eligible_candidate`, `below_minimum_score`,
`below_minimum_seeders`, `active_grab_exists`, `blocklisted`, `kept_entry`,
`episode_versions_unsupported`, `grabbed`, `upgrade_planned`.

## Tasks and acceptance

| ID | Task and owner | Depends on | Required evidence |
| --- | --- | --- | --- |
| M1 | Decisions, spikes and contract | Gates 1–7 | Episode-version result, `MediaSources` field inventory on the pinned host, free-space read, DTOs |
| M2 | Data model, profile activation, settings and Dashboard | M1 | Migration on a copy of the isolated database, admin save/read/restart, ordinary-user 403 |
| M3 | Scheduler, backoff, budgets, breaker and decision log | M2 | Boundary-server-driven runs with counted queries, budgets and breaker behaviour |
| M4 | New-episode acquisition on air | M3 | An episode appearing in the boundary feed after its air time is grabbed once, within the delay and budgets |
| M5 | Upgrade-to-cutoff with replacement provenance | M3, Phase 5 | Old version reclaimed only after the new one plays; no `media_missing`; Keep blocks replacement |
| M6 | Explicit *Get another quality* | M2, Phase 4/5 | Second version lands beside the first; the stock selector lists both |
| M7 | Retention per version | M5, Phase 3 | Lowest quality reclaimed first; protections aggregate across versions; seed checks per version |
| M8 | Version selector enrichment and automation surfaces; web | M1 contract, M5–M7, X4 | Built app, desktop/mobile/TV by D-pad, degradation on old plugin |
| M9 | Isolated end-to-end acceptance and release gate | M1–M8 | Unattended multi-run scenario with budgets, upgrades, retention and restarts |

Commit scopes: `feat(automation,p6.m1)` … `feat(automation,p6.m5)`, `feat(versions,p6.m6)`,
`feat(retention,p6.m7)`, `feat(versions,p6.m8)`, `test(automation,p6.m9)`.

### M1 — settle what the host supports before automating

- **Episode versions.** Take the Phase 5 I1 result. If the pinned host groups
  `Series S01E01 - 1080p.mkv` and `Series S01E01 - 2160p.mkv` as one episode with a version
  selector, episodes follow the movie rules; if not, episode upgrades are `replace`-only through
  a sequence that imports to a temporary label, verifies playback, then reclaims the old file, or
  they are blocked. Record which, with the disposable series evidence.
- **Selector data.** Inventory what the pinned host's `MediaSources` and `MediaStreams` expose
  for a merged movie: `Name`, `Size`, video `Width`/`Height`/`Codec`/`BitDepth`/`VideoRange`,
  audio `Codec`/`Channels`/`ChannelLayout`, and whether the default version is the primary item.
  The selector rows use only fields the 10.11 server returns.
- **Free space.** Record how the container reports free space for the library mount and that it
  matches `df` on the host for the same filesystem.
- **Budgets.** Fix the default numbers in the table above against the isolated indexer's caps
  and the Pi's observed search cost from Phase 4 A8 timings.
- **Contract.** Publish the DTOs and codes above with one example each.

**Acceptance** — a dated *M1 evidence* heading in this document records each answer with the
isolated command or API used, without host paths.

### M2 — persist schedules, budgets and profile cutoffs

Add the records and settings with migrations; activate `cutoff`, `upgradeAllowed`, `upgradeMode`
and the optional minimums on quality profiles; extend the Dashboard with an Automation section
(master switch, interval, batch, budgets, floor, new-episode delay) and per-indexer limits. The
master switch is off after migration regardless of any earlier state.

**Acceptance** — real host on the isolated test instance: the migration applies to a copy of the
isolated database with clean integrity and foreign-key checks; the built Dashboard saves and
re-reads every field across a restart; an ordinary user gets 403; a profile whose cutoff is not
one of its allowed qualities is rejected with a message naming the rule.

### M3 — search on a schedule without running away

Implement `JellyfinModAutomationSearch` as an `IScheduledTask` with a default trigger from
`AutomationIntervalHours`. Each run: check the master switch and the client; load due targets in
`NextSearchAt` order up to the batch size; for each, check budgets, breaker and free space; call
the Phase 4 search service with the target's effective profile; evaluate; grab the top eligible
candidate through the Phase 4 grab path with an idempotency key derived from run and target;
record one decision per target; update backoff. Per-indexer minimum interval and daily budget are
enforced inside the Phase 4 fan-out so manual searches count too. Five consecutive failures open
the breaker. The run summary is persisted; a killed run is marked `interrupted` at the next start
(the T9 pattern). Manual `POST /Automation/Run` queues the native task and returns 202.

**Acceptance** — isolated test instance with the Torznab boundary server counting queries:

- With 50 monitored disposable targets and a batch of 40, one run searches 40, the next the
  remaining 10 plus the earliest due; the boundary server records exactly the query count the
  run summary reports.
- Empty results move `NextSearchAt` through 12 h, 24 h, 48 h (clock advanced in the fixture or
  by a test-only override, documented) and a manual `searchNow` resets it.
- A daily query budget of 5 stops the run at 5 queries with `budget_indexer` decisions; a grab
  budget of 1 grabs once and records `budget_grabs` for the next eligible target.
- Five boundary 500s open the breaker; the status endpoint shows `breakerOpenUntil`; a second
  indexer keeps being queried.
- A free-space floor set above the mount's free space records `free_space_floor` and grabs
  nothing.
- Master switch off: the native task runs, records a `disabled` run and touches no indexer.
- Killing the container mid-run leaves an `interrupted` run and no duplicate grab after restart
  (idempotency key).

### M4 — acquire new episodes when they air

Monitored series with unaired episodes get a metadata-only Refresh at most daily; episodes whose
air time passed more than `NewEpisodeDelayMinutes` ago and that are `missing` become due targets.
Season 0 is excluded unless the episode is monitored explicitly. A series that airs weekly
therefore produces one search shortly after each episode, then backoff. Reclaimed episodes are
not re-acquired by this path unless still monitored (see the defaults table).

**Acceptance** — boundary feed that gains the episode's release after a simulated air time:

- The episode is grabbed once, no earlier than the delay, and imported by Phase 5; the series
  page shows it `onDisk` and the others unchanged.
- A special in season 0 is not searched; monitoring it explicitly makes it due.
- The daily Refresh does not delete episodes or change availability (P7/T10 hold), shown by
  unchanged episode IDs and states across the run.

### M5 — upgrade to cutoff, replacing without lying to Phase 2

For a monitored on-disk target whose profile allows upgrades and whose held best quality is below
the cutoff, an eligible candidate scoring above the held best creates an `UpgradeOperation`
(`planned`) and a grab with `intent=addVersion`. Phase 5 imports it as an additional version. When
the import completes and the new binding is playable, the operation moves to `replacing` and
creates a Phase 3 `RetentionOperation` for the superseded binding with `Provenance =
upgrade_replaced`. The executor runs its normal checks — same-path group, storage identity,
active session, resume, favourite, Keep, seed state — but does not require the watched-completion
evaluation. On success it writes `upgrade_replaced` history, leaves the entry `onDisk` on the new
binding, and reconciliation, seeing the completed operation, writes no `media_missing`. The old
version's seeding copy follows the Phase 5 seed release. In `add` mode nothing is reclaimed.

**Acceptance** — isolated test instance, disposable movie held at 720p with a profile cutoff of
1080p and `replace`:

- The 1080p fixture is grabbed, imported as a second version, and only after it plays in the
  built browser is the 720p file reclaimed; the entry stays `onDisk`, history shows
  `upgrade_added` then `upgrade_replaced`, and a full scan afterwards adds no `media_missing`.
- With Keep set, the 1080p version is added and the 720p file is not removed; the decision log
  shows `kept_entry` for the replacement step.
- With the 720p version playing in a second browser session, replacement blocks with
  `active_session` and retries on the next run.
- With `add` mode, both versions remain and the stock selector lists both.
- The retention operation's `Provenance` is `upgrade_replaced` in SQLite and its summary shows
  logical and physical bytes with the same honesty as a reclaim (0 while the seeding copy exists).

### M6 — get another quality on purpose

Extend the Phase 4 search snapshot with `intent`. For `addVersion`, require a playable binding,
mark held qualities on candidates, relax the one-active-grab rule for that snapshot and let Phase
5 land the result as an additional version with a non-colliding label. Admin-only, like every
grab. The opener is the version selector's last row (M8) and the existing detail More menu.

**Acceptance** — real HTTP and the built browser: an admin opens the picker from the selector of
a disposable movie, sees the held 1080p marked, grabs a 2160p fixture, and after import the stock
selector lists both versions with the new label; the ordinary user has no such control and gets
403 on the route; a second `addVersion` grab of the same quality is rejected with
`already_held_at_cutoff`-style reason `heldQuality`.

### M7 — retention per version, consistent with Phase 3

Phase 3 already evaluates each representation and T8 aggregates protections across versions.
Phase 6 adds ordering and clarity, not new eligibility:

- When a target is due and has several versions, the executor orders the same-target
  representations by ascending quality (parsed from the binding's file name, falling back to
  native `Width`) and processes them in that order within the batch, each with its own seed and
  storage checks. A higher version blocked by seeding does not stop a lower one.
- The privacy-safe retention summary and the version rows in detail show per-version state so an
  admin can see "2160p waiting for seeding, 1080p scheduled".
- The title becomes `reclaimed` only when its last playable binding is gone (unchanged).
- A remaining version keeps the completion and deadline that scheduled its title: when a sibling
  version is reclaimed or removed and completion is re-read from the remaining one, a later
  re-read instant does not restart the window (fixed 2026-09-19). A new completion (after an
  unwatched or resume state) and policy or access changes recompute as before, and a prior longer
  deadline is still kept.

**Acceptance** — disposable movie with two versions, both due, the 2160p seeding copy below its
goal: the run reclaims the 1080p file only, the 2160p stays with a seed reason, the entry stays
`onDisk`, and the selector shows one version; after the seed release the next run reclaims the
2160p and the entry becomes `reclaimed` with the T7 reset applied.

### M8 — the version selector and automation surfaces

Selector: keep the stock `.selectSource` select untouched. Beside its container, mounted through
the existing `nativeEntryDetails` integration, render a feature-local `jfmod-versions` list with
one row per `MediaSource`: resolution, video codec (with 10-bit/HDR when exposed), audio codec
and channels, size, and a DEFAULT marker on the primary. Selecting a row sets the stock select's
value and dispatches its `change` event, so upstream's audio/subtitle/playback logic keeps
running. Every row is a D-pad stop; the last row is **Get another quality** for admins, hidden
otherwise, and opens the Phase 4 picker with `intent=addVersion`. Retention per version (M7)
shows as a short suffix on the row when scheduled. Styles are feature-local, `em`-sized, without
`display: contents` or flex `gap`; no upstream selector or stylesheet changes. Gate on Health
`capabilities` containing `versions`.

Automation surfaces: an *Automation* section on the Dashboard page (status, budgets, last run,
recent decisions) and, in the queue, a banner when automation is paused. The entry detail's
History remains the user-facing trail; decision-log detail stays on the Dashboard.

**Acceptance** — built browser on the isolated test instance at desktop, mobile, TV 1920×1080 and
TV 1280×720 with `localStorage.setItem('layout','tv')`, arrow keys, Enter and Back:

- A merged disposable movie shows two rows with correct resolution, codec, audio and size taken
  from `MediaSources`; choosing a row by Enter changes the stock select and the subsequent Play
  uses that `mediaSourceId` (network log).
- **Get another quality** is reachable by D-pad, opens the picker, Back returns focus to the row.
- The ordinary user sees the rows without the last row; an old plugin build hides the list and
  the stock select works as before.
- The Dashboard section shows the last run and a decision with its reason; the queue banner
  appears when the master switch is off.
- `npx tsc --noEmit`, feature eslint and stylelint pass. Physical webOS evidence is reported
  separately from emulation.

### M9 — isolated acceptance and release gate

On `jellyfinmod-test` (port 18096), with the plugin revision from Health, deployed with the X3
tooling, signed in as `oleksii` with an empty password, production never contacted:

1. Enable automation with a 1-run-per-hour interval and small budgets. Over at least three
   scheduled runs driven by the boundary server: a wanted movie is auto-grabbed and imported, a
   new episode appears and is acquired after its delay, a below-cutoff movie is upgraded and its
   old file reclaimed only after the new one played, and a budget exhaustion is recorded.
2. Restart the container between runs; no duplicate grab, import or replacement occurs.
3. Retention: the T18 cycle still passes; per-version ordering (M7) holds; every deletion in the
   run is a `RetentionOperation` with the right provenance; no `media_missing` is written.
4. Safeguards: breaker, free-space floor, client outage and master switch each stop automatic
   grabs with visible decisions; disabling automation mid-run halts new grabs by the next target.
5. Security: automation and settings routes return 401/403 for anonymous and ordinary users;
   `intent=addVersion` is refused for a file-less target.
6. Browser: M8's matrix, plus the Movies grid never blanking while automation changes states.
7. Record revisions, boundary query counts against run summaries, timings, Pi memory and the
   merged master SHA; restore automation to off and remove disposable media.

Phase 6 is complete only when monitored titles are acquired and upgraded unattended within the
configured budgets, every replacement is attributed to a plugin operation, retention treats
versions correctly, the selector is usable by D-pad, and every safeguard has been shown to stop
the automation.

## M1 evidence — 2026-09-19

The isolated instance was not touched on this date, so these answers come from the pinned host API
and the integration suites; the live parts are in the checklist below.

- **Episode versions.** Phase 5 I1 did not measure this live. Episodes therefore follow the
  conservative branch: no second episode version and no episode upgrade while
  `episodeUpgradesEnabled` is off (default). Episode `addVersion` searches answer 409
  `episode_versions_unsupported`; automation records the same reason.
- **Selector data.** Versions are read from the plugin's own bindings (one per native item of a
  version group) plus `IMediaSourceManager.GetMediaStreams(itemId)` of the pinned 10.11 host:
  video `Width`, `Height`, `Codec`, `BitDepth`, `VideoRange`; the default audio stream's `Codec`
  and `Channels`; size from the file inspector. The default version is the binding whose native
  item is the version group's primary item. Unknown fields stay `null`; nothing is guessed.
- **Free space.** `statvfs` on the target library root (available blocks × fragment size), the
  same figure `df` reports for that filesystem. The floor is the larger of
  `freeSpaceFloorPercent` of the filesystem and `freeSpaceFloorBytes`. *Live:* compare with `df`
  on the host.
- **Budgets.** Defaults are 10 s between queries and 200 queries a day per indexer, 6 automatic
  grabs a day, one automatic grab per title per 24 hours, 3 open imports, 40 targets per run and a
  6-hour interval. They were not tuned against live Phase 4 A8 timings, which do not exist yet.
- **Contract.** Published in [API.md](API.md) *Automation and versions (Phase 6)*.

## Implementation status — 2026-09-19

Source is on the Phase 5 build branches (Phase 6 commits follow Phase 5); nothing is deployed.

| Task | Status | Notes |
| --- | --- | --- |
| M1 | Partial | Answers above; live measurements in the checklist |
| M2 | Done | One migration after Phase 5: per-target schedule, runs, bounded decision log, per-indexer daily budget and breaker, upgrade operations, retention provenance; profile cutoff/upgrade fields, indexer limits, automation settings (master switch off after migration); Dashboard Automation section with status, Run now and recent decisions |
| M3 | Done | Hourly native task `JellyfinModAutomationSearch` runs a batch once `automationIntervalHours` has passed; all budgets are checked before any search; empty searches back off 12 h doubling to 7 days; per-indexer minimum interval, daily budget and a breaker (5 failures, 1 hour) inside the Phase 4 fan-out, so manual searches count too; idempotency key per run and target |
| M4 | Done | Monitored aired episodes become due `newEpisodeDelayMinutes` after air; specials never; airing series get a metadata-only refresh at most daily (10 per run), shared with the Refresh action |
| M5 | Done | Below-cutoff movies are upgraded as an additional version; after the new version is bound, playable and its seeding copy owned, the superseded version is removed through the Phase 3 executor as `upgrade_replaced`, skipping only the watched rule; Keep blocks replacement; `add` mode keeps both |
| M6 | Done | `intent=addVersion` search and grab, held qualities marked and refused, labelled additional version on import |
| M7 | Done | Due versions of one target are reclaimed lowest resolution first; each version reports its own retention state |
| M8 | Done, not browser-verified | Version rows driving the stock select, Play with the selected `mediaSourceId`, Get another quality, More-menu entry, paused-automation banner in the queue, Search now; type-check, lint, stylelint and production build pass |
| M9 | Partial | `PhaseSixIntegration` passes; the isolated live run is below |

Plugin evidence: all eight suites exit 0 in the offline SDK container on the test host (see
PHASE5). `PhaseSixIntegration` drives the production scheduler task, budgets, breaker,
new-episode delay, upgrade replacement, added versions and per-version retention against two
counting Torznab boundaries and a Transmission boundary that writes real files, over the real host,
authentication, serializer, migrations and SQLite. It checks boundary query counts against run
summaries, that a restart between runs creates no duplicate grab, import or replacement, and that
automation and settings routes refuse anonymous and ordinary users.

### Defaults chosen here — accepted by the user on 2026-09-19

The user accepted every default below as chosen on 2026-09-19.

1. **Automation default and budgets (open question 1):** off after migration and after
   acceptance until an admin enables it; budgets as listed under M1.
2. **Keep and upgrades (open question 2):** Keep blocks replacement; a kept title only gains
   versions.
3. **Replace or add (open question 3):** `replace` is the default profile upgrade mode; the
   explicit action always adds. Replacement also waits while retention is disabled, because it
   runs through the Phase 3 executor.
4. **Reclaimed titles (open question 4):** not re-acquired automatically; `reacquireReclaimed`
   (default off) turns it on. This is stricter than the proposal.
5. **Episode versions (open question 5):** blocked entirely until live evidence; switch
   `episodeUpgradesEnabled`.
6. **New-episode delay and specials (open question 6):** 120 minutes; specials are never
   acquired automatically (no per-episode opt-in yet).
7. **Proper/repack (open question 7):** only offered in the picker, never auto-replaced.
8. **Get another quality (open question 8):** administrator-only.
9. **Reclaim order (open question 9):** lowest quality first within a due target.
10. **Unknown held quality:** a title whose held version quality cannot be parsed is never
    upgraded (`held_quality_unknown`).
11. **Manual run:** `POST /Automation/Run` bypasses only the interval, never a budget.

### Live acceptance checklist (M2–M9)

Run after Phase 5's checklist passes, on `jellyfinmod-test` only, with the disposable Transmission
and a disposable Torznab indexer:

1. Deploy the Phase 6 build and bundle; confirm Health lists `automation` and `versions`, the
   migration applied and automation is off.
2. Dashboard: set a profile cutoff and upgrades, indexer limits and small budgets; enable
   automation with a 1-hour interval.
3. Over at least three scheduled runs: a wanted movie is auto-grabbed and imported; a new
   episode is acquired only after its delay; a below-cutoff movie is upgraded and the old file is
   reclaimed only after the new one plays, as a `RetentionOperation` with `upgrade_replaced`; a
   budget exhaustion and an empty-search back-off are visible in the decision log.
4. Restart the container between runs; no duplicate grab, import or replacement.
5. Safeguards: open the breaker with a failing indexer, raise the free-space floor above free
   space, stop Transmission, and switch automation off mid-run; each stops automatic grabs with a
   visible decision and a queue banner.
6. Compare the free space automation reports with `df` for the same filesystem (M1).
7. If the Phase 5 checklist showed merged episode versions, re-decide open question 5 before
   enabling `episodeUpgradesEnabled`.
8. Retention: the T18 cycle still passes; per-version ordering holds; no `media_missing`.
9. Security: automation and settings routes answer 401/403 for anonymous and ordinary users;
   `intent=addVersion` is refused for a file-less target.
10. Browser (M8), signed in as `oleksii` with an empty password: desktop and mobile — version rows
    show resolution, codecs, channels, size and default marker, selecting a row drives the stock
    version select, Play starts the selected `mediaSourceId`, Get another quality opens the picker
    with held qualities marked, the More-menu entry, Search now, and the queue banner for each
    paused reason; TV — rows reachable and selectable by D-pad; old plugin (capability missing)
    hides rows, action and banner; check webOS separately. The Movies grid never blanks while
    automation changes states.
11. Record revisions, boundary query counts against run summaries, timings and Pi memory; switch
    automation off and remove disposable media.

## Risks

| Risk | Required response |
| --- | --- |
| Runaway searching burns indexer goodwill or gets the household banned | Per-indexer minimum interval, daily budget, breaker, caps-first; manual searches count against the same budget |
| Runaway grabbing fills the disk | Daily grab budget, per-entry budget, open-import cap, free-space floor checked against the library mount |
| Upgrade replacement looks like external removal | `Provenance = upgrade_replaced` on a Phase 3 operation; reconciliation attribution already exists for completed operations |
| Old version deleted before the new one works | Replacement only after the new binding is playable; protections re-checked by the executor; Keep blocks replacement |
| Episode versions unsupported by the host | M1/I1 spike; episode upgrades blocked or replace-only per evidence; never two unmerged episodes left behind |
| Selector enrichment breaks the stock select | The select is untouched; rows drive it through its own `change` event; old-plugin path hides the list |
| Decision log grows without bound | Pruned to a cap; history receives only three event types |
| Automatic pick quality is worse than Radarr's | Accepted by README §6 ("expect the first version to be worse"); rejected rows and decisions are always inspectable |
| GPL-3.0 code creeps in through "just the upgrade logic" | Independent implementation; test cases may mirror behaviour, source may not |

## Open questions for the user

Questions 1–9 are answered by the user's acceptance of the defaults on 2026-09-19 (see
*Defaults chosen here*); the answer is the default recorded there, where it differs from the
proposal below.

1. **Automation default.** Should `AutomationEnabled` stay off after Phase 6 acceptance until the
   admin turns it on (proposed), and are the budget defaults (6 grabs/day, 200 queries/indexer
   /day, 3 open imports, 10 %/25 GB floor) acceptable starting values? Consumed by M2 and M3.
2. **Keep and upgrades.** Should Keep block replacement (proposed: a kept entry only gains
   versions), or should Keep protect only against retention and allow an upgrade to replace the
   kept file? Consumed by M5.
3. **Replace or add by default.** Is `replace` the right default upgrade mode for movies, with
   `add` reserved for the explicit action, or should upgrades always add and leave reclaiming the
   lower quality to retention (M7 ordering would then handle it after watching)? Consumed by M2
   and M5.
4. **Reclaimed titles and monitoring.** Should a reclaimed title that is still monitored be
   re-acquired automatically (proposed: yes, because monitoring is the admin's stated intent), or
   should reclaim also unmonitor? Consumed by M3 and Phase 3.
5. **Episode versions.** If the I1 spike shows the host does not group episode versions, should
   episode upgrades be replace-only through a temporary label, or blocked entirely in Phase 6?
   Consumed by M1 and M5.
6. **New-episode delay and specials.** Is a 120-minute delay after air time acceptable, and
   should specials stay opt-in per episode? Consumed by M4.
7. **Proper/repack.** Should a proper or repack of the held quality be auto-replaced (Radarr-like
   behaviour), or only be offered in the picker (proposed for the first slice)? Consumed by M3
   and M5.
8. **Who may use Get another quality.** Admin-only, consistent with Phase 4 A1 (proposed), or
   should it be the first acquisition action opened to ordinary users? Any widening needs its
   own authorization contract and tests. Consumed by M6 and M8.
9. **Reclaim order.** Lowest quality first within a due target (proposed), or all due versions in
   one run regardless of order? Consumed by M7.
10. **Newest Phase 4 contract vs. review amendments.** *Answered 2026-09-19* by the PHASE4 user
    decisions: Transmission is the client, secrets are secret-store references, grabs keep the
    5-second cancellable hold, downloads and library share one mount with hardlink-only import,
    and T7–T10, T18, P7, X1 and X3 are entry gates.
