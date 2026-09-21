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

## Accepted user decisions — 2026-09-20/21

1. **Title-and-year matches in automation.** PHASE4 user decision 7 makes a release matched on
   parsed title and exact year a manual-grab candidate with `match.identity == "title"`.
   Automation grabs such a release **only** from an indexer whose `automateTitleMatches` flag is
   on (default off); from every other indexer it is skipped, not grabbed. This supersedes the
   "`identity_unverified` (title-only) rows are never grabbed" wording in the *Automatic pick*
   row below. Implemented on plugin `master` (`474bd91`): the runner filters `"title"` candidates
   by the flag before choosing the best. A target whose only eligible candidates are `"title"`
   rows from unflagged indexers is recorded as `no_eligible_candidate` today; the follow-up's M15
   gives that its own reason so the decision log says why. M3/M9 must show both sides: the
   flagged indexer's row is auto-grabbed, the unflagged indexer's identical row is not.
2. **Live acceptance services.** The M2–M9 checklist runs against the separate real Transmission
   (same VPN as production, never the production client), real Prowlarr read-only for indexers,
   one shared mount and read-only production media, as recorded under PHASE5 *Accepted user
   decisions — 2026-09-20/21: live acceptance services*. Boundary servers remain for the
   controlled failure and clock cases the checklist names.

## Proposed defaults

**Proposed, not user-approved.** Resolve in M1 before M3 is enabled on the isolated instance.

| Decision | Proposed first slice |
| --- | --- |
| Master switch | `AutomationEnabled` default **off**. When off, no scheduled search runs, no automatic grab is submitted and no upgrade is decided; manual Phase 4 grabs and Phase 5 imports continue. |
| Which targets | Monitored movie entries in `none`/`reclaimed` state and monitored episodes of monitored series that are aired, `missing` or `reclaimed`, plus monitored on-disk targets whose best held version is below their profile cutoff when the profile allows upgrades. Unmonitored means never searched. Reclaimed titles are searched only if the entry is still monitored, which Phase 3 leaves unchanged; an admin who wants a title to stay gone unmonitors it. |
| Schedule | One `IScheduledTask`, `JellyfinModAutomationSearch`, default every 6 hours, processing targets in a bounded batch (default 40 per run) ordered by next-due time. Manual runs obey the same budgets. |
| Backoff | Per target: after an empty or rejected-only search the next search is due in 12 h, then 24 h, 48 h, 96 h, capped at 7 days; reset by a metadata change (new air date, profile change, re-monitor) or an explicit manual search. |
| New episodes | An aired monitored episode is first searched no earlier than `NewEpisodeDelayMinutes` (default 120) after its air time, then follows backoff. Air dates come from the existing Phase 1 metadata and the metadata-only Refresh (P7/T10); the scheduler triggers a Refresh for monitored series with unaired episodes at most once per day. Specials (season 0) are not auto-acquired unless the episode is monitored explicitly. |
| Automatic pick | The highest-scoring eligible candidate of the Phase 4 evaluation; rejected rows are never grabbed; ~~`identity_unverified` (title-only) rows are never grabbed~~ **superseded 2026-09-20/21:** `identity_unverified` rows are rejected and never grabbed, and a `match.identity == "title"` row is auto-grabbed only from an indexer with `automateTitleMatches` on (see *Accepted user decisions — 2026-09-20/21*). A candidate below a configurable minimum score or seeders count is skipped, not grabbed. |
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

Run after Phase 5's checklist passes, on `jellyfinmod-test` only, with the separate real
Transmission and real Prowlarr indexers (read-only) of the 2026-09-20/21 live-services decision,
plus the boundary Torznab indexer for the controlled cases:

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

Questions 11–22 belong to the *Phase 6 follow-up* below and are listed at its end.

---

## Phase 6 follow-up — multiple held qualities (M10–M21)

Planning draft, 2026-09-21. **Proposed, not user-approved**, except where a numbered user decision
is quoted. It plans work only; it establishes nothing about M2–M9's live acceptance, writes no
product code and authorizes no deployment. Read the Phase 6 sections above, [PHASE4.md](PHASE4.md)
(candidate DTO, `match`, rejection codes), [PHASE5.md](PHASE5.md) (version labels),
[PHASE7.md](PHASE7.md) §5–§6 (settings area, Prowlarr-synced indexers), [UX.md](UX.md) §9, §11
and §13, and [API.md](API.md) *Acquisition* and *Automation and versions* alongside it.
[PHASE8.md](PHASE8.md) extends the model defined here with evidence the release title lacks; this
section deliberately decides only from the title, with a stated confidence, and says `unknown`
whenever the title does not say.

### Why a follow-up

The 2026-09-19 defaults treat quality as one ordered list per profile with one cutoff: a title
holds one version, an upgrade replaces it, and *Get another quality* is a manual exception. The
user's actual wish is different in kind: hold **more than one** quality on purpose (a
best-possible version for the living-room television and a compatible one for everything else),
choose between releases on attributes the flat list cannot see (Dolby Vision versus HDR10+,
Atmos versus lossy audio, which dub and subtitle languages a release ships, edition tags), and
express all of that in the user's own words for the user's own tracker, whose titles follow a
grammar the generic parser does not know. The user's driver is *"what my LG TV plays best"*.

### Accepted decisions this follow-up builds on

- Automation is off by default, budgeted and logged; Keep blocks replacement; `replace` is the
  default upgrade mode and the explicit action adds; reclaimed titles are not re-acquired unless
  `reacquireReclaimed`; episode versions and upgrades stay blocked while `episodeUpgradesEnabled`
  is off (defaults accepted 2026-09-19). Nothing here changes those; a ladder is how the
  administrator asks for more than one version, and the switches still gate what automation may do.
- Retention reclaims the lowest quality first within a due target and marks the title reclaimed
  only when no playable version remains (M7, accepted). This follow-up is **acquisition-side
  only**: it never protects a version from retention, never changes what is due and never
  changes the reclaim order.
- Title-and-year matches: manual grab allowed, automation only from `automateTitleMatches`
  indexers (PHASE4 decision 7, PHASE6 decision 1 above).
- Search, grab, profiles and every setting are administrator-only (Phase 4 A1); ordinary users
  gain no acquisition control from anything below.
- Never port GPL-3.0 Sonarr/Radarr code; custom-format behaviour may inform test cases only.
- Retention keeps folders and sidecars (accepted 2026-09-20); a second version lands beside the
  first under Jellyfin's multi-version naming (Phase 5), and nothing is renamed.

### The model

**Attributes and confidence.** Every candidate and every held version is described by a closed
attribute vocabulary; every attribute value carries a confidence:

| Attribute | Values (closed vocabulary) |
| --- | --- |
| `resolution`, `source`, `videoCodec`, `bitDepth` | as Phase 4 today (`2160p`, `bluray`, `remux`, `webdl`, `hevc`, `10`…) |
| `dynamicRange` | `dolby_vision`, `hdr10_plus`, `hdr10`, `hlg`, `sdr`; plus `dvProfile` (`5`, `7`, `8`, `unknown`) and `dvHybrid` (DV with an HDR10 base layer) when the title says so |
| `audioCodec[]` | `truehd`, `dts_x`, `dts_hd_ma`, `dts_hd_hra`, `dts`, `eac3`, `ac3`, `aac`, `pcm`, `flac`, `opus`; `atmos` is a flag on `truehd` or `eac3`, never a codec of its own |
| `audioChannels` | `2.0`, `5.1`, `7.1`, `unknown` |
| `audioTracks[]` | `{ language, kind }` with `kind` in `original`, `dub`, `mvo`, `dvo`, `avo`, `vo` (multi-, dual-, single-voice and voice-over dubs, as the user's tracker labels them) |
| `subtitleLanguages[]`, `forcedSubtitles` | ISO 639 codes; `forcedSubtitles` `true`/`false`/`unknown` |
| `edition` | `theatrical`, `directors_cut`, `extended`, `unrated`, `imax`, `remastered`, `open_matte`, `hybrid`, `criterion`, `other(<text>)` |
| `releaseGroup`, `proper`, `repack` | as today |

Confidence is one of `parsed` (a grammar or the generic parser read the value from the title),
`inferred` (an indexer default supplied it, for example "every release on this tracker carries a
Russian dub unless the title says otherwise") or `unknown`. The rules for `unknown` are fixed and
the same everywhere: a **required** attribute that is `unknown` is not satisfied; a **forbidden**
attribute that is `unknown` does not reject (unknown is not the forbidden value) unless the tick or
rule is marked *strict*; a **preferred** attribute that is `unknown` adds nothing. Nothing is ever
guessed to fill a gap; PHASE8 is where missing evidence would come from.

**Ladder, rungs and copies.** A *ladder* is an ordered list of *rungs*, best first. A rung is a
named set of attribute criteria — at least a resolution, usually a dynamic range, optionally codec,
source, audio and edition constraints — for example `2160p Dolby Vision` → `2160p HDR10+` →
`2160p HDR10` → `2160p SDR` → `1080p` → `720p`. A candidate or held version *fits* the highest rung
whose criteria it satisfies; one that fits no rung fits the ladder not at all (`rung_none`). Some
rungs are marked **must have**; each must-have rung defines a **copy** the title should hold — a
version that fits that rung or a higher rung inside the same *tier* (the run of rungs down to the
next must-have rung). The user's two cases are two must-have rungs: `2160p Dolby Vision` (copy A,
with `2160p HDR10+` and `2160p HDR10` acceptable substitutes above the next must rung) and `1080p
SDR` (copy B, "plays everywhere"). A ladder with a single must-have rung at the top behaves
exactly like today's profile: one version, upgraded to the cutoff. PHASE8 calls this the
*must-tier model*.

**Copy states.** Per target and per copy: `empty` (nothing held fits the tier), `substitute` (a
version from a lower rung stands in until a fitting one is found; allowed only where the copy says
`substituteAllowed`, default on for the top copy and off for the others — open question 11),
`filled` (a held version fits the copy's rung or better within its tier), `upgrading` (an
`UpgradeOperation` is open for it), `reclaimed` (retention removed the version that filled it;
frozen, see *Retention*) and `dormant` (automation gave up; see *Budgets*).

**How the existing profile fields map.** A scope that has a ladder derives the Phase 4/6 fields
instead of storing them: `qualities` = the rungs' `source-resolution` ids in order, `cutoff` = the
top must-have rung, `upgradeAllowed` = true while any copy is `substitute`, `upgradeMode` =
`replace` inside a copy (the substitute is replaced by the version that fits) and `add` between
copies (a second copy is always an additional version). Scopes without a ladder keep the existing
flat profile unchanged; nothing is migrated automatically.

**Scope.** A ladder is assigned at server (the default), library or title level; episodes inherit
their series. The most specific assignment applies whole — a title ladder replaces the library
ladder rather than extending it (open question 12) — and the UI always shows where the effective
ladder comes from. `PATCH /Entries/{id}` keeps `qualityProfileId` for the flat case and gains
`ladderId` for the ladder case; setting one clears the other.

**Ticks.** A ladder carries two tick grids that apply to every rung unless a rung overrides them:
dynamic range (`dolby_vision`, `hdr10_plus`, `hdr10`, `hlg`, `sdr`) and audio (`truehd`, `atmos`,
`dts_x`, `dts_hd_ma`, `dts_hd_hra`, `dts`, `eac3`, `ac3`, `aac`, `pcm`, `flac`, `opus`), each
tick one of *neutral*, *required*, *preferred* (with a weight) or *forbidden* (optionally
*strict*). These are what the user called quality-profile ticks; they live on the ladder so the
editor shows them beside the rungs.

**Rules.** User-defined string-match rules complete what ticks cannot express:
`{ name, terms[], mode: plain | regex, wordBoundary: true, target: title | group | indexer,
effect: required | forbidden | preferred, weight, strict, scope }`. Plain terms match
case-insensitively at token boundaries, where a boundary is the start or end of the title or any
of `.`, `_`, `-`, space, `[`, `]`, `(`, `)`: `DV` therefore matches `.DV.` and `[DV]` and never
`DVD` or `DVDRip`. Regex rules use .NET's non-backtracking engine with a match timeout and a
length cap, are administrator-only, and are refused at save time when they do not compile.
Every rejection names its rule (`rule_forbidden` / `rule_required` with `rule: "<name>"`) and
every preference shows as a contribution `rule:<name>` with its points, so the picker's "why"
answers "which rule did this".

**Preferred indexers.** An indexer gains `preferred` (tie-break and a bounded score contribution
`indexer_preferred`) beside the existing `priority`, `automateTitleMatches`, budgets and seed
minimums. Prowlarr-synced indexers carry the same fields as administrator overrides that a sync
never overwrites (PHASE7 §6's override list grows by `preferred`, `automateTitleMatches` and
`grammarId`).

**Grammar.** A `ReleaseTitleGrammar` is assigned per indexer. It is an ordered list of segments
split by a delimiter, each segment a labelled field with a word map from the tracker's own
vocabulary to the closed vocabulary above — for the user's tracker: title and original title,
year, source, resolution, dynamic range, the audio-track list with its `MVO`/`DVO`/`AVO`/`VO`
and *original* markers and languages, the subtitle-language list, and edition tags. A segment
that matches yields `parsed` values; an indexer default yields `inferred`; anything else is
`unknown`, and the generic Phase 4 parser remains the fallback for every field the grammar does
not cover. A grammar has a **Test** that takes pasted sample titles and shows the parse field by
field with its confidence, because a grammar nobody can check is a guess.

**Languages and subtitles.** The ladder carries `audioLanguages` (required / preferred /
forbidden lists), `dubKinds` in preference order (for example `original` > `mvo` > `dvo` > `avo`
> `vo`), `originalAudioRequired` and `subtitleLanguages` (required / preferred). They are
evaluated only from what the title carries: when a required language cannot be decided because
the attribute is `unknown`, automation blocks the candidate with `requirement_unparseable` and a
manual grab shows a warning instead ("language not stated in the title"). Fetching subtitles is
the host's job (its subtitle providers); this follow-up only reads what a release says it ships.

**Presets.** A preset bundles a ladder, its tick grids, rules and language preferences under a
name and is **copied** into a scope when applied — later edits to the preset never change scopes
that already applied it, and the copy is fully editable. Shipped presets are starting points, not
device knowledge: *Original quality* (remux-first, lossless audio preferred), *Living-room
television* (the user's LG: 2160p Dolby Vision profile 8 or hybrid, then HDR10+, then HDR10; DV
profile 7 FEL forbidden strictly because the title usually says `P7`/`FEL` when it applies;
TrueHD/Atmos preferred, never required), *Plays everywhere* (1080p, H.264 or 8-bit HEVC SDR,
AC3/E-AC3/AAC, no remux, size cap), *Phone and tablet* (720p/1080p, AAC/E-AC3 stereo or 5.1,
small). Which of these is honest for the user's actual television model is open question 17;
real capability knowledge is PHASE8 E7–E8.

**Quick-filter chips.** Inside the release picker, chips filter the candidate list over the parsed
attributes and compose by AND: resolution, dynamic range, audio codec, `Atmos`, `Original audio`,
a dub language and kind, a subtitle language, `Remux`, edition, a size cap, `Preferred indexers`,
`Verified identity`. A chip set can be saved as a named picker preset and, from the same menu,
turned into rules on the current title's ladder. Chips never change what is *eligible*; rejected
rows stay in their group with their reasons.

### Data model and ownership

| Record | Minimum contents and invariants |
| --- | --- |
| `QualityLadder` | `Id`, `Name`, `Revision`, `TicksJson` (dynamic range and audio grids), `LanguagesJson`, `GiveUpAfterDays` (90), `PresetOrigin?`. Deleting a ladder in use is refused (409), as for profiles. |
| `LadderRung` | `LadderId`, `Order`, `Name`, `CriteriaJson`, `MustHave`, `SubstituteAllowed`, `TickOverridesJson?`. Criteria reference only closed-vocabulary values and existing `source-resolution` ids. |
| `LadderAssignment` | `Scope` (`server` / `library` / `entry`), `ScopeId`, `LadderId`. At most one per scope id. |
| `AttributeRule` | `Id`, `Name`, `Terms`, `Mode`, `WordBoundary`, `Target`, `Effect`, `Weight`, `Strict`, `Scope` (server / ladder / entry), `Revision`. Regex validated and length-capped at save. |
| `ReleaseTitleGrammar` | `Id`, `Name`, `SegmentsJson` (delimiter, ordered fields, word maps), `DefaultsJson` (inferred attributes), `Revision`, `SampleTitles` (bounded, for Test). Assigned through `AcquisitionIndexer.GrammarId?`. |
| `AcquisitionIndexer` (existing) | Gains `Preferred`, `GrammarId?`; `AutomateTitleMatches` exists (decision 7). Synced indexers keep these as overrides. |
| `Preset` | `Id`, `Name`, `Kind` (`device` / `picker`), `Shipped`, `PayloadJson` (ladder + rungs + ticks + rules + languages, or a chip set), `OwnerUserId?` for picker presets. |
| `HeldCopyState` | `TargetId`, `CopyRungId`, `State`, `FilledByBindingId?`, `NextSearchAt`, `ConsecutiveEmpty`, `DormantSince?`, `ReclaimedAt?`, `Reason?`. One row per target and copy; created lazily. Replaces the single `AutomationTargetState` schedule for ladder scopes; flat scopes keep one implicit copy. |
| `UpgradeOperation` (existing) | Gains `Kind` (`cutoff` = today's behaviour, `rung_upgrade`, `copy_fill`, `substitute_replace`) and `CopyRungId?`. Replacement provenance stays `upgrade_replaced`; a `copy_fill` is `upgrade_added`. |
| Candidate snapshot (Phase 4) | Gains `attributes` with per-field confidence, `rung` (fit per ladder), `copyFit[]` (which copies it would fill or substitute), `ruleHits[]`, `heldCopyState`. |
| History | `copy_filled`, `copy_substituted`, `copy_gave_up` (once per state change); existing `upgrade_added` / `upgrade_replaced` / `auto_grabbed` unchanged. |
| Settings | `LadderSearchIntervalHours` for substitute-upgrade hunting (168, weekly), `MaxCopiesPerTitle` (3), `GrammarTestSampleCap` (50). |

Ownership is unchanged: the scheduler decides and calls Phase 4's grab; Phase 5 imports; Phase 3
deletes; Phase 2 binds. No follow-up service writes `Entry.State`, a binding or a file.

### Scoring, cutoff, retention and automation together

- **Evaluation order**, fixed: Phase 4 hard constraints (identity, packs, size, blocklist) →
  rung fit (`rung_none` rejects) → required ticks, rules and languages (`attribute_required`,
  `rule_required`, `requirement_unparseable`) → forbidden ticks and rules (`attribute_forbidden`,
  `rule_forbidden`) → score: `rung_rank` (dominant, by rung order), then `attribute_preferred`,
  `rule:<name>`, `indexer_preferred`, then today's seeders, size and freeleech contributions.
  Every contribution is visible; rejected rows list every failed check, not the first.
- **Upgrade to a higher rung.** A copy in `substitute` searches for a version fitting a higher
  rung inside its tier and replaces the substitute through the existing M5 sequence
  (`substitute_replace`, provenance `upgrade_replaced`). A copy in `filled` is never touched by
  automation: there is no upgrade past the copy's own rung, which is what makes the top must rung
  the cutoff. A held version that fits a *higher* rung than the copy asked for fills it; the
  ladder never downgrades.
- **Cutoff in flat scopes** is untouched; profiles without a ladder behave exactly as M5 today.
- **Retention (acquisition-side only).** Copies never protect anything. When a due target is
  reclaimed lowest-first (M7) and a copy loses its version to a `retention` operation, that copy
  becomes `reclaimed` and stays frozen: it is not re-filled while the title is still on disk, and
  once the last version goes the entry is `reclaimed` and `reacquireReclaimed` decides as today
  (open question 13). A copy emptied by an administrator's Remove-from-queue or by an external
  deletion (Phase 2 `media_missing`) returns to `empty`. Keep blocks every replacement, including
  `substitute_replace`; a kept title only gains versions (2026-09-19 default 2).
- **Budgets, give-up and backoff.** Each copy has its own schedule and backoff (12 h doubling to
  7 days, as M3); the daily grab budget, per-entry budget (now per entry and copy), open-import
  cap, free-space floor, breaker and per-indexer budgets apply unchanged. Substitute-upgrade
  hunting runs on the slower `LadderSearchIntervalHours` cadence so it cannot starve first
  acquisitions. After `GiveUpAfterDays` of only empty or rejected searches a copy becomes
  `dormant` with `copy_gave_up`; a manual search, a ladder or grammar change, a new indexer or
  re-monitoring wakes it. Automation takes `"title"`-identity candidates only from
  `automateTitleMatches` indexers and records `title_match_untrusted` when that is the only reason
  nothing was eligible (the dedicated reason promised in decision 1).
- **Episodes.** While `episodeUpgradesEnabled` is off (accepted 2026-09-19), a series ladder acts
  as a single-copy ladder for episodes: only the top copy is filled, no substitute is replaced, no
  second copy is added, and `addVersion` keeps answering `episode_versions_unsupported`. When the
  switch is on after the I1 live evidence, copies apply per episode with the per-entry budget
  counted per series so a long series cannot exhaust the day. Season packs stay rejected.
- **Preferred indexers** never override a rung or a required tick; they only order otherwise
  equal candidates and add a bounded contribution.

### API contract (additions)

All under `/JellyfinMod`, administrator-only unless stated, camelCase, revisioned, unknown fields
rejected. S1 of Phase 7 publishes DTOs in API.md; M10 publishes these.

| Endpoint | Contract |
| --- | --- |
| `GET/POST/PATCH/DELETE /Settings/Ladders`, `/Settings/Ladders/{id}` | Ladder with rungs, ticks and languages; validation: at least one rung, at least one must-have rung, criteria in the closed vocabulary, ticks consistent (a value cannot be both required and forbidden), `MaxCopiesPerTitle` respected. Delete in use → 409 `ladder_in_use`. |
| `PUT /Settings/Ladders/Assignments` | `{ scope, scopeId, ladderId | null }`; `GET` lists effective assignments with origin. |
| `GET/POST/PATCH/DELETE /Settings/Rules` | Rules; regex compile failure → 400 `rule_invalid_regex` naming the position. |
| `GET/POST/PATCH/DELETE /Settings/Grammars`, `POST /Settings/Grammars/{id}/Test` | Test takes `{ titles[] }` (capped) and returns per-title attributes with confidence and the segment each came from; never touches an indexer. |
| `GET/POST/PATCH/DELETE /Settings/Presets`, `POST /Settings/Presets/{id}/Apply` | Apply takes `{ scope, scopeId }`, copies the payload into a new ladder (and rules) and assigns it; returns the created ids. Picker presets are per administrator (`ownerUserId`; open question 20). |
| `PATCH /Settings/Indexers/{id}` (existing) | Gains `preferred`, `grammarId`; `automateTitleMatches` exists. Synced indexers accept these as overrides. |
| `GET /Releases?…` (existing) | Candidates gain `attributes`, `rung`, `copyFit`, `ruleHits`; the response gains `ladder: { id, name, origin, copies: [{ rungId, name, state, filledBy }] }` and `chips` (the vocabulary present in this snapshot, so the UI offers only chips that can match). Rejection codes add `rung_none`, `attribute_required`, `attribute_forbidden`, `rule_required`, `rule_forbidden`, `requirement_unparseable`; contributions add `rung_rank`, `attribute_preferred`, `rule:<name>`, `indexer_preferred`. `intent=addVersion&copyRungId=` targets a specific copy. |
| `GET /Entries/{id}` (existing) | `versions[]` rows gain `attributes` (from the file name grammar and the host's streams where Phase 6 already reads them) and `copy` (which copy the version fills); detail gains `copies[]` mirroring the search response, for administrators. |
| `GET /Automation/Targets` (existing) | Per-copy rows: `copyRungId`, `state`, `nextSearchAt`, `consecutiveEmpty`, `dormantSince`, `blockedReason`. Decision `reason` adds `copy_filled`, `copy_dormant`, `title_match_untrusted`, `requirement_unparseable`. |
| `GET /Health` | `capabilities` gains `ladders`, `grammars`, `presets`. |

### Entry gates

**Proposed, not user-approved.**

1. The M2–M9 live checklist is recorded as passed on the isolated instance; automation that
   multiplies per copy must first be right for one.
2. Phase 7 S8 is accepted, or the editors land on the Dashboard plugin page first and move to the
   settings area in S8 without a second contract (M20 states which).
3. PHASE4 decision 7 is verified live in A8 (`"title"` candidates, flag on and off).
4. A corpus of the user's tracker's release titles exists as a committed fixture (titles only:
   no private URLs, passkeys or tracker name in the file name) with the expected parse recorded
   beside each — the grammar's acceptance oracle. Whether the tracker's own naming may be described
   in a committed file is open question 19.
5. The Torznab boundary server can emit titles in that grammar and in generic scene form, and the
   disposable library can hold three versions of one movie.
6. `MediaSources`/`MediaStreams` on the pinned host expose `VideoRangeType` and the audio codec
   profile fields the version rows need; recorded in M10 (real DV profile detection is PHASE8 E5).

### Tasks and acceptance

| ID | Task and owner | Depends on | Required evidence |
| --- | --- | --- | --- |
| M10 | Decisions, vocabulary, grammar corpus, spikes and contract | Gates 1–6 | Dated *M10 evidence*: host stream fields, corpus parse table, DTOs in API.md |
| M11 | Data model, migrations, settings; Dashboard forms as the first editor | M10 | Migration on a copy of the isolated database; admin save/read/restart; ordinary user 403 |
| M12 | Attribute parsing: vocabulary, generic-parser extension, grammar engine and Test | M10 | Corpus parsed with stated precision; `unknown` where the title is silent; Test endpoint |
| M13 | Rule engine and tick grids | M11, M12 | Word-boundary, regex-safety and named-rejection cases through `GET /Releases` |
| M14 | Ladder evaluation, rung fit, copies and scoring; flat-profile derivation | M12, M13 | Same snapshot ranked under three ladders with visible contributions; flat scopes unchanged |
| M15 | Automation per copy: schedules, budgets, give-up, substitutes, rung upgrades, title-match gate, preferred indexers | M14 | Boundary-driven multi-run scenario; every decision reason present; no double grab across restart |
| M16 | Retention interplay and copy freezing | M15, Phase 3 | Lowest-first unchanged; reclaimed copy not re-filled; Keep blocks substitute replacement |
| M17 | Language, dub and subtitle preferences; `requirement_unparseable` | M12, M14 | Grammar titles matched and generic titles blocked with the code; manual warning shown |
| M18 | Presets: shipped set, apply-by-copy, picker presets | M11, M14 | Apply creates an editable copy; preset edits do not touch applied scopes |
| M19 | Web: picker chips, attribute line, "why" expander, copy summary on detail and version rows | M14–M18 contract, X4 | Built browser, desktop/mobile/TV by D-pad; old plugin hides everything |
| M20 | Web: ladder, rule, grammar and preset editors; Prowlarr-synced overrides | M11, PHASE7 S8 or Dashboard | Every editor saves and re-reads across a restart; synced indexer overrides survive a sync |
| M21 | Isolated acceptance and release gate | M10–M20 | Two-copy title acquired, substituted, upgraded, watched and reclaimed unattended within budgets |

Commit scopes: `docs(ladders,p6.m10)`, `feat(ladders,p6.m11)`, `feat(parsing,p6.m12)`,
`feat(rules,p6.m13)`, `feat(ladders,p6.m14)`, `feat(automation,p6.m15-16)`,
`feat(languages,p6.m17)`, `feat(presets,p6.m18)`, `feat(picker,p6.m19)`,
`feat(settings,p6.m20)`, `test(ladders,p6.m21)`; fixes use `fix(<component>,p6.mN)`.

#### M10 — settle vocabulary and evidence before modelling

Record, under a dated *M10 evidence* heading in this document, without host paths: the closed
vocabulary and its confidence rules as implemented; the corpus of the user's tracker's titles with
the expected parse per title (gate 4) and the generic scene titles used for comparison; which
`MediaStreams` fields the pinned host exposes for `VideoRangeType`, `VideoRange`, audio `Profile`
and `Codec` on a disposable file with HDR10 and one with lossy audio; whether a version's file
name (Phase 5 label) or the streams is the source of each held-version attribute; the substitute
and merge answers to open questions 11–13 as decided; the DTOs above published in API.md with one
example each.

**Acceptance** — the evidence heading exists, every open question this task consumes is marked
answered or re-asked, and the corpus fixture is committed with no private data.

#### M11 — persist ladders, rules, grammars, presets and copies

Add the records with migrations; extend the Dashboard plugin page (or the Phase 7 settings area,
per gate 2) with editors for ladders (rungs, must-have, substitute, ticks, languages), rules,
grammars (with Test) and presets, and the indexer fields `preferred` and `grammarId`. Validation
per the API table. The migration creates nothing automatically: existing profiles and entries
keep their flat behaviour until an administrator assigns a ladder.

**Acceptance** — real host on the isolated instance: the migration applies to a copy of the
isolated database with clean integrity and foreign-key checks and every existing profile,
target state and operation preserved; an administrator saves a two-copy ladder, three rules, one
grammar and one preset in the built page, restarts, and reads them back unchanged; a ladder
without a must-have rung, a rung outside the vocabulary and a rule with an invalid regex are each
refused with a message naming the rule; an ordinary user gets 403 on every route.

#### M12 — parse attributes with a stated confidence

Extend the generic parser to the vocabulary (Dolby Vision and profile markers, HDR10+, HLG, Atmos,
DTS family, TrueHD, PCM/FLAC, channel layouts, edition tags, language markers where scene names
carry them) without guessing; implement the grammar engine and its Test; apply the assigned
grammar first and the generic parser second; attach confidence to every field. Independent
implementation, GPL-3.0 sources excluded.

**Acceptance** — through `POST /Settings/Grammars/{id}/Test` and `GET /Releases` against the
boundary indexer emitting the corpus: every corpus title parses to its expected table with
`parsed` confidence for grammar fields; generic titles yield `unknown` for languages and
`parsed` for what they state; `DV` in `DVDRip` is never Dolby Vision; an indexer default yields
`inferred`, visibly distinct in the DTO; a grammar whose delimiter does not match falls back to
the generic parser for the whole title and says so.

#### M13 — rules and ticks that name themselves

Implement tick grids and rules in the evaluation order above with the `unknown` semantics and the
word-boundary and regex rules stated in *The model*.

**Acceptance** — `GET /Releases` on the isolated instance: a required `hdr10_plus` tick rejects an
HDR10 title with `attribute_required` and passes an HDR10+ one; a strict forbidden `sdr` tick
rejects an `unknown` dynamic range while a non-strict one does not; the rule `DV` (plain) matches
`.DV.` and not `DVDRip`; a regex rule with catastrophic backtracking potential is refused at save;
every rejection lists the rule or tick by name; the picker shows it verbatim.

#### M14 — rank on the ladder

Compute rung fit, copy fit and the score; derive the flat fields for ladder scopes; keep flat
scopes byte-identical in behaviour (same snapshot, same order, same contributions as before).

**Acceptance** — the same boundary snapshot evaluated under (a) no ladder, (b) the *Living-room
television* preset, (c) *Plays everywhere*: (a) matches the pre-follow-up ordering exactly; (b)
ranks a hybrid 2160p DV release above a 2160p HDR10 release above a 1080p one with `rung_rank`
dominant and shows `copyFit` for both copies; (c) ranks the 1080p H.264 release first and rejects
the remux with `rung_none`; `heldCopyState` reflects a disposable movie holding one version.

#### M15 — automate per copy without running away

Per-copy schedules, backoff, give-up, substitute acquisition, rung upgrades through
`UpgradeOperation` kinds, `title_match_untrusted`, preferred-indexer ordering, the slower
substitute-hunting cadence, and the episode gating.

**Acceptance** — isolated instance, boundary server counting queries, budgets small, clock
advanced by the documented override:

- A wanted movie under the two-copy ladder: run 1 grabs the best available (a 2160p HDR10 as
  substitute for copy A and a 1080p for copy B, two grabs, two imports, both versions in the
  stock selector); run 2 finds a 2160p DV in the feed and replaces the substitute only after the
  new version played (`substitute_replace`, `upgrade_replaced` history, no `media_missing`); the
  1080p copy is untouched throughout.
- With the DV never appearing, after `GiveUpAfterDays` the copy is `dormant` with `copy_gave_up`;
  a manual `searchNow` wakes it once.
- A `"title"` candidate from an unflagged indexer yields `title_match_untrusted`; flagging the
  indexer makes the next run grab it.
- Two indexers with identical rows: the `preferred` one is chosen and the contribution is shown.
- Budgets: the per-entry-and-copy budget allows the two first grabs on day one and refuses a third
  with `budget_grabs`; the daily budget, floor and breaker behave as M3.
- Killing the container mid-run leaves no duplicate grab, import or replacement.
- A series under the same ladder with `episodeUpgradesEnabled` off acquires one version per
  episode and never a second; `addVersion` answers `episode_versions_unsupported`.

#### M16 — keep retention exactly as accepted

Freeze copies emptied by retention; leave order, eligibility and protections untouched.

**Acceptance** — disposable two-copy movie, both versions due: the run reclaims the 1080p first
(M7 unchanged); the next automation run does **not** re-grab a 1080p (copy B `reclaimed`,
decision `copy_dormant`-style reason `copy_reclaimed`); once the 2160p is reclaimed the entry is
`reclaimed` and stays so with `reacquireReclaimed` off; with Keep set, a substitute is never
replaced (`kept_entry`) though a missing copy may still be filled; a version removed by hand
outside the plugin returns its copy to `empty` after the next scan.

#### M17 — languages the title states, and nothing more

Language, dub-kind and subtitle preferences on the ladder; `requirement_unparseable`; the manual
warning.

**Acceptance** — required audio language plus preferred `mvo`: corpus titles with a matching dub
are eligible and ordered by dub kind; generic titles are blocked with `requirement_unparseable`
in automation and listed as eligible-with-warning in the picker; a required subtitle language
behaves the same; `originalAudioRequired` rejects a dub-only title whose grammar says no
original track.

#### M18 — presets that start, not own

Shipped presets, Apply as copy, picker presets, and the "turn chips into rules" action.

**Acceptance** — Apply of *Living-room television* to a library creates a ladder and rules with
`presetOrigin` set and assigns them; editing the shipped preset afterwards changes nothing in the
library; a picker preset saved by one administrator is not listed for another (per open question
20); converting a chip set into rules yields rules whose names cite the chips.

#### M19 — the picker and the detail page

Chips row (composed, saveable; on TV collapsed behind one *Filter* stop so the first focus stays
on the top release, per UX §13 rule 5), an attribute line under the parsed summary with
confidence styling (`unknown` shown as "not stated", never blank), a "why" expander per row
listing every contribution and rejection with rule names, `copyFit` markers, and on the detail
page a copies summary and per-version attributes on the M8 rows. Styles feature-local, `em`, no
`display: contents` or flex `gap`; gate on `capabilities` containing `ladders`.

**Acceptance** — built browser on the isolated instance at desktop, mobile, TV 1920×1080 and TV
1280×720 with `layout=tv`, arrow keys, Enter and Back: chips compose and the list updates in
place without unmounting the focused row; saving a chip preset and re-opening the picker offers
it; the "why" expander shows a named rule rejection; `Get another quality` for copy B opens the
picker with `copyRungId` set and held qualities marked; an ordinary user sees attributes and never
a chip-save or rule action; an old plugin hides chips, expander and copy summary while the M8
rows keep working. `tsc`, eslint and stylelint pass; physical webOS separately.

#### M20 — editors in the settings area

Ladder, rung, tick, rule, grammar (with Test) and preset editors, and the indexer fields, in the
Phase 7 settings area (or on the Dashboard page until S8, per gate 2, with no second contract).

**Acceptance** — built browser as `oleksii` and as an ordinary user: every editor saves, echoes
the revision and re-reads across a restart; the grammar Test shows a pasted title's parse; a
Prowlarr-synced indexer's `preferred`, `automateTitleMatches` and `grammarId` survive three syncs;
mobile at 390 px has no horizontal scroll; TV reaches every section and Back returns; the
ordinary user gets the UX §14 message.

#### M21 — isolated acceptance and release gate

On `jellyfinmod-test` (port 18096), plugin revision from Health, deployed with X3, signed in as
`oleksii` with an empty password, real services per the 2026-09-20/21 decision plus the boundary
server for controlled cases, production never contacted:

1. A disposable movie under the two-copy ladder goes, unattended over at least four runs, from
   wanted to two versions (one substitute) to the substitute replaced after playback, within
   budgets and with every decision in the log; restarts between runs create no duplicate.
2. Rules, ticks, languages and a grammar each change the ranking visibly in the picker with named
   reasons; the corpus parses as recorded in M10.
3. Retention: the T18 cycle still passes; lowest-first holds; frozen copies are not re-filled;
   no `media_missing`.
4. Presets apply by copy; picker presets round-trip; Prowlarr overrides survive a sync.
5. Security: every new route answers 401/403 for anonymous and ordinary users; regex rules cannot
   stall the server (timeout observed).
6. Browser: M19 and M20 matrices; the Movies grid never blanks while copies change.
7. Record revisions, query counts against run summaries, timings and Pi memory; set automation
   off, remove disposable media and every fixture ladder, rule, grammar and preset.

The follow-up is complete only when a title holds the copies its ladder asks for, chosen for the
reasons the picker shows, upgraded only within a copy, and left alone by acquisition once
retention has spoken.

### Risks

| Risk | Required response |
| --- | --- |
| Two copies double every budget and every disk cost | Per-copy budgets under the unchanged daily and floor limits; `MaxCopiesPerTitle`; substitutes only where allowed |
| A ladder silently changes what an existing profile does | Flat scopes are untouched; ladders are opt-in per scope; M14 proves byte-identical flat behaviour |
| Guessed attributes drive grabs | Closed vocabulary, confidence on every field, `unknown` never satisfies a requirement, no inference beyond declared indexer defaults |
| The grammar drifts when the tracker changes its naming | Grammar Test with a committed corpus; a non-matching delimiter falls back visibly to the generic parser |
| A user regex hangs the evaluator | Non-backtracking engine, timeout, length cap, compile-time refusal |
| Retention and copies fight (reclaim, re-grab, reclaim) | Copies emptied by retention freeze; `reacquireReclaimed` stays the only re-acquisition switch |
| Presets claim device knowledge they do not have | Presets are named starting points and say so; capability truth is PHASE8 E7–E9 |
| Chips or editors break TV rules | Chips collapsed behind one stop on TV; editors are administrator surfaces verified for reachability and Back |
| GPL-3.0 custom-format code creeps in | Independent implementation; behaviour may inform tests only |

### Open questions for the user (follow-up)

11. **Substitutes.** May a lower rung stand in for the top copy only (proposed), for every
    must-have copy, or never (wait for the exact rung)? Consumed by M10 and M15.
12. **Scope merge.** Does a title ladder replace the library ladder whole (proposed) or extend
    it rung by rung? Consumed by M10 and M14.
13. **Copies after retention.** Stay frozen until the title is re-acquired or an administrator
    asks (proposed), or re-fill while the title is still on disk and monitored? Consumed by M16.
14. **Give-up window.** 90 days of empty searches per copy, then dormant until woken (proposed)?
    Consumed by M15.
15. **Unknown versus forbidden.** Does an `unknown` dynamic range pass a non-strict "forbid SDR"
    tick (proposed: yes, unknown is not SDR) with *strict* available per tick and rule? Consumed
    by M13.
16. **Regex rules.** Allowed for administrators under the safety limits (proposed), or plain
    terms only? Consumed by M13.
17. **Shipped presets and the television.** Which LG model and webOS version is the target, and
    should a *Living-room television* preset ship before PHASE8 E7 knows real capabilities
    (proposed: ship it, named as a starting point)? Consumed by M18 (and PLAN open question 17).
18. **Language defaults.** Which audio languages and dub kinds are required or preferred by
    default for this household, is original audio required, and which subtitle languages matter?
    Consumed by M17.
19. **Grammar corpus.** May the user's tracker's naming be described in a committed grammar
    fixture (titles only, no tracker name or URL), or must the corpus stay in the ignored test
    data? Consumed by gate 4 and M10.
20. **Picker presets.** Per administrator (proposed) or shared server-wide? Consumed by M18.
21. **Chips on TV.** Collapsed behind one *Filter* stop (proposed) or always visible in the
    dialog? Consumed by M19.
22. **Editors before S8.** Land the editors on the Dashboard plugin page now (proposed) or wait
    for the Phase 7 settings area? Consumed by gate 2 and M20.
