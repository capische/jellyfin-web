# JellyfinMod API examples

Reviewed against plugin 81c1aae on 2026-09-18; see
[Review corrections](#review-corrections--2026-09-18).

Implementation contract as of 2026-09-16. These examples describe the Phase 3 source and the
accepted isolated test deployment. Production is outside this deployment. All IDs below are
illustrative.

All routes require Jellyfin authentication. Identity comes from the authenticated user, never
a submitted user ID. Entry IDs and native Jellyfin item IDs belong to different namespaces.
Inaccessible entry lookups return 404. Monitoring, removal, Keep, retention diagnostics and
manual retention runs require administrator elevation.

**Correction (review 2026-09-18):** the administrator-only list above is incomplete. Metadata
Refresh (`POST /JellyfinMod/Entries/{id}/Refresh`) and reconciliation diagnostics
(`GET /JellyfinMod/Reconciliation/Latest`) also require elevation (prior-L2, low, verified; see
[`REVIEW-2026-09-18.md`](REVIEW-2026-09-18.md)).

**Correction (review 2026-09-18):** API keys behave as follows today. Entries, Browse and
Discover routes answer an API key with 400 and the plain body `Error processing request.`,
because the key's empty user ID makes the user lookup throw; each call logs an error. The
Retention and Reconciliation admin endpoints never resolve a user, so they accept API keys and
run normally (plugin-authz-entries#6, low, verified).

**Proposed (review 2026-09-18, not user-approved):** user-scoped endpoints return 401 for API
keys instead of 400 (task P11 in [PHASE1.md](PHASE1.md)). Whether admin automation should
instead get a defined API-key contract is an open question for the user in [PLAN.md](PLAN.md).

## Health

`GET /JellyfinMod/Health` retains the host's existing response:

```json
{"Name":"JellyfinMod","Version":"0.1.0.0","Ok":true}
```

The web adapter converts this to camelCase. All new plugin-owned DTOs below explicitly serialize
camelCase. Configuration XML and Jellyfin's global serialization settings remain host-owned.

**Correction (review 2026-09-18):** `Version` has stayed `0.1.0.0` through Phases 1–3, so Health
cannot identify which build is deployed, and the web client gates features only on `Ok`
(plan-ops#5, medium, single-source; web-library-search-details#6, medium, single-source).

**Proposed (review 2026-09-18, not user-approved):** Health adds `revision` (source commit),
`lastMigration` and `capabilities` (for example `retention`, `dueFilter`), and the web gates
newer request fields and UI on `capabilities` (tasks X4 in [PLAN.md](PLAN.md) and W14 in
[PHASE1.md](PHASE1.md)). None of these fields exist yet.

## Add and retry

`POST /JellyfinMod/Entries` accepts only these fields:

```json
{"mediaType":"movie","tmdbId":123,"targetLibraryId":"11111111-1111-4111-8111-111111111111"}
```

The destination must be an accessible library of the matching type. Successful responses have
the shape `{"entry": <Entry>, "created": true}`. A repeat add returns the canonical unchanged
entry with `created: false`. It does not reset monitoring or move the entry. Adds to a different
authorized library produce that library's own entry. Metadata and episode retrieval finish
before the entry, episodes and one `added` history event are committed together.

An illustrative Entry with minimal metadata:

```json
{
  "id": "22222222-2222-4222-8222-222222222222",
  "mediaType": "movie",
  "tmdbId": 123,
  "imdbId": null,
  "title": "Example Movie",
  "year": null,
  "overview": null,
  "posterPath": null,
  "state": "none",
  "monitored": true,
  "jellyfinItemId": null,
  "targetLibraryId": "11111111-1111-4111-8111-111111111111",
  "progress": null,
  "addedAt": "2026-09-08T00:00:00Z",
  "watchedAt": null,
  "reclaimAt": null,
  "reclaimAfterDays": null,
  "retentionPolicy": "inherit",
  "metadata": {
    "mediaType": "movie", "tmdbId": 123, "title": "Example Movie",
    "premiereDate": null, "overview": null, "posterPath": null, "backdropPath": null,
    "imdbId": null, "tvdbId": null, "adult": false,
    "communityRating": null, "runtimeMinutes": null,
    "genres": [], "certifications": [], "seasons": []
  }
}
```

Nullable values are JSON null. State is one of `none`, `searching`, `grabbed`, `downloading`,
`onDisk`, `reclaimed`; only the relevant Phase 1 states are produced now. Native user watched
and resume state does not come from the shared `watchedAt` field.

**Correction (review 2026-09-18):** see [`REVIEW-2026-09-18.md`](REVIEW-2026-09-18.md)
(tests-contract#8, low, verified; plugin-reconciliation-data#7, medium, verified).

- "Only the relevant Phase 1 states are produced now" is stale: the Phase 3 retention executor
  produces `reclaimed`.
- No service writes `watchedAt` or `reclaimAt`; they are always null. Retention countdowns use
  `retention.deadline` from detail and browse responses.
- `progress` is reserved for the `downloading` state. It is not written today but is read by
  the web file-state mark and is expected to be filled from Phase 4 onward.
- Create returns ProblemDetails with 502 or 504 when TMDB fails or times out. A wait for the
  target library's reconciliation lock shares the 60 s budget, so a busy library is currently
  misreported as the 504 "TMDB metadata timed out. Please try again."

**Proposed (review 2026-09-18, not user-approved):** mark `watchedAt` and `reclaimAt`
deprecated in the DTO and web type (task P11 in [PHASE1.md](PHASE1.md)). Give Create a separate
lock-wait budget and report a busy library as 409 or 503 "library busy" rather than a TMDB
timeout (task R8 in [PHASE2.md](PHASE2.md)).

## List

`GET /JellyfinMod/Entries?mediaType=movie&state=none&state=reclaimed&startIndex=0&limit=20&sortBy=SortName&sortOrder=Ascending`

Optional `targetLibraryId` scopes the destination and `query` matches titles. Optional
`jellyfinItemId` selects entries currently bound to that native item; it composes with the other
filters and never bypasses entry/library access checks. Native Details uses it to load catalog
history without replacing the native item page. Repeated `state`
parameters combine with OR; other filters combine with AND. Offset is nonnegative; limit is
1–200 (default 100). Supported CRUD sorts are `SortName`, `DateCreated`, `ProductionYear`, with
`Ascending` or `Descending` direction. Unsupported values are rejected. Ties use entry ID.

Response shape is `{"items": [<Entry>], "totalRecordCount": 1}`; the count is after access and
filter checks and before pagination. This endpoint lists plugin records. It does not yet supply
the combined native/plugin browse contract.

**Correction (review 2026-09-18):** `jellyfinItemId` matches only the entry's primary bound item
(`Entry.JellyfinItemId`), in List and in Browse. It does not match the other `EntryBindings`
that Phase 2 records for separate copies, and the web details page filters on the primary ID
too. A non-primary copy's native page therefore shows no History, Keep or countdown
(tests-contract#8, low, verified).

**Proposed (review 2026-09-18, not user-approved):** resolve `jellyfinItemId` through
`EntryBindings` on the server and in the web client (task P11 in [PHASE1.md](PHASE1.md)).

## Combined browse

`POST /JellyfinMod/Browse` accepts one library query and applies access checks, filters, sorting,
deduplication and pagination before hydrating the page:

```json
{
  "mediaType": "movie",
  "targetLibraryId": "11111111-1111-4111-8111-111111111111",
  "state": ["none", "onDisk"],
  "sortBy": ["ProductionYear", "PremiereDate", "SortName"],
  "sortOrder": "Descending",
  "randomSeed": null,
  "startIndex": 0,
  "limit": 20,
  "alphabet": null,
  "filters": {
    "genres": ["Drama"], "years": [2026], "officialRatings": [], "tags": [],
    "studioIds": [], "status": [], "seriesStatus": [], "features": [],
    "videoBasicFilter": [], "videoTypes": [], "audioLanguages": [],
    "subtitleLanguages": []
  }
}
```

Supported sorts are `SortName`, `Random`, `CommunityRating`, `CriticRating`, `DateCreated`,
`DatePlayed`, `OfficialRating`, `PlayCount`, `ProductionYear`, `PremiereDate`, `Runtime`,
`DateLastContentAdded` and `SeriesDatePlayed`. A Random request requires a caller-retained seed.
The server uses the requested sequence before one stable provider-identity tie break. Missing
values follow SQLite ordering: first ascending and last descending.

File states and values within genre, year, rating, tag, studio, series-status and video-type
lists use OR. Separate groups use AND. Played, Unplayed, Favorite and Resumable status flags are
also conjunctive, as are selected media features and the HD/4K/3D predicates produced by the web
filter. A file-less entry cannot satisfy a filter whose metadata or per-user state it does not
have. Native movie stream-language filters inspect the movie's media streams. Native Series
filters inspect media streams on episodes visible to the requesting user; each selected language
group matches when any visible episode carries one of its values, and separate audio/subtitle
groups remain conjunctive. File-less entries cannot match either language group. Movie and Series
parity with the pinned live server remains an acceptance gate.

Each response row is either `{"kind":"native","nativeItem":<BaseItemDto>,"entry":<Entry|null>}`
or `{"kind":"entry","nativeItem":null,"entry":<Entry>}`. A bound native row carries its Entry
alongside the real `nativeItem` so the client can render file state without inventing a native
identity. `totalRecordCount` is exact after filters and before pagination. `hasCatalogEntries`
tells the web client whether it must use the combined page; when false and no File filter is
active, the stock native query remains the reference path.

**Correction (review 2026-09-18):** the Browse contract has fields and behaviour the text above
omits or misstates (prior-L2, low, verified; tests-contract#8, low, verified;
plugin-browse-discover#9, low, single-source; plugin-browse-discover#3, medium, single-source;
plugin-browse-discover#8, low, verified):

- `query` (string, at most 200 characters, optional) matches titles; Search depends on it.
- `dueWithinDays` (1–3650, optional) restricts results to `onDisk` entries whose retention
  evaluation is scheduled with a deadline within N days. The web client sends 7.
- `limit` is optional. Null means unpaged and has no upper bound, matching upstream's "show all"
  library setting and native `/Items`. This is documentation only; the finding that called it a
  defect (prior-L6) was refuted.
- Each `BrowseRow` also carries a nullable `retention` summary (the shape under
  [Automatic retention](#automatic-retention)).
- The HD/4K predicates are not conjunctive. SD, HD and 4K form one OR group, matching native
  Jellyfin; the web mapping collapses IsHD plus IsSD to SD. Only 3D and the selected media
  features are ANDed.
- For native Series rows, Played and Unplayed currently read the series row's own user data,
  not episode play state as native Jellyfin does. This is a known parity deviation (task P10 in
  [PHASE1.md](PHASE1.md)).
- Native rows are always reported as `onDisk` for File filters, regardless of the bound Entry.

## Detail and episodes

`GET /JellyfinMod/Entries/22222222-2222-4222-8222-222222222222`

Response shape is
`{"entry": <Entry>, "history": [<History>], "episodes": [<Episode>], "retention": <Retention>}`.
Movies return an empty episode array. A history object is:

```json
{"id":"33333333-3333-4333-8333-333333333333","entryId":"22222222-2222-4222-8222-222222222222","eventType":"added","summary":"Added to library","createdAt":"2026-09-08T00:00:00Z"}
```

An episode object contains `id`, `entryId`, `tmdbId`, `seasonNumber`, `episodeNumber`, `title`,
nullable `overview`, `stillPath`, `airDate`, `runtimeMinutes`, then `monitored`, `state` and
nullable `jellyfinItemId`, and a nullable `retention` summary. Dates are UTC ISO 8601. Season zero is specials; a future air date
distinguishes unaired episodes from missing aired media. A series binding does not make every
episode `onDisk`. Bound episodes must independently pass native visibility checks.

**Correction (review 2026-09-18):** episodes also carry `availability`: `onDisk`, `unaired` or
`missing`. It is derived only from the on-disk state and the air date, so reclaimed episodes
currently report `missing` and the web shows them as "Missing" (tests-contract#7, medium,
single-source).

**Correction (review 2026-09-18):** `POST /JellyfinMod/Entries/{id}/Refresh` is
administrator-only and series-only. It returns 400 for movies or entries without a target
library, has a 60 s timeout, returns ProblemDetails with 502 or 504 on TMDB failure, and on
success returns the same EntryDetail shape as detail (prior-L2, low, verified). On the phase3
and phase4 lines, Refresh still deletes local episodes that are missing from the new TMDB
snapshot, which cascades away their bindings, evaluations and retention operations
(plugin-authz-entries#1, medium, verified). The fix exists only on the phase1 line (fba11e3)
until task P7 in [PHASE1.md](PHASE1.md) carries it forward.

**Proposed (review 2026-09-18, not user-approved):** add `reclaimed` to `availability` on the
server and in the web type and label (task T14 in [PHASE3.md](PHASE3.md)).

## Automatic retention

Entry and episode detail uses a privacy-safe retention summary:

```json
{
  "enabled": true,
  "policy": "inherit",
  "state": "scheduled",
  "reason": "completion_policy_satisfied",
  "deadline": "2026-09-30T00:00:00Z"
}
```

`POST /JellyfinMod/Entries/{id}/Keep` is administrator-only. It changes the entry policy to
`never`; on a series this protects every child episode. A repeated request returns success
without adding another `retention_kept` history event.

`GET /JellyfinMod/Retention/Preview` is administrator-only and returns `generatedAt`, summary
counts (`inspected`, `due`, `blocked`, `scheduled`, `waiting`, `disabled`) and per-representation
diagnostics under `items`. Physical paths, hardlink counts and torrent evidence never appear in
ordinary-user detail responses.

`POST /JellyfinMod/Retention/Run` invokes the same 25-physical-action batch as the native daily
task. A concurrent invocation returns 409. `GET /JellyfinMod/Retention/Runs/Latest` returns the
newest durable summary. Both run endpoints use this contract:

```json
{
  "id": "44444444-4444-4444-8444-444444444444",
  "startedAt": "2026-09-16T11:37:00Z",
  "completedAt": "2026-09-16T11:37:00Z",
  "status": "disabled",
  "inspected": 0,
  "eligible": 0,
  "blocked": 0,
  "reclaimed": 0,
  "failed": 0,
  "interrupted": 0,
  "logicalBytesUnlinked": 0,
  "physicalBytesReleased": 0,
  "physicalBytesUnknown": 0,
  "detail": "Retention is disabled; no media was changed."
}
```

The native task key is `JellyfinModRetentionReclamation`; its default trigger is daily at 03:00
server local time. The global enabled setting is checked at run entry, before every action and
again inside the executor immediately before unlink. Configuration or policy-version changes at
that final boundary block the operation.

**Correction (review 2026-09-18):** the summary vocabulary as implemented in 81c1aae
(tests-contract#8, low, verified; prior-L2, low, verified):

- `state`: `disabled`, `blocked`, `waiting`, `scheduled`, `mixed` (series episodes differ).
- `reason`: `retention_disabled`, `kept`, `access_unavailable`, `no_accessible_users`,
  `selected_user_missing`, `selected_user_inaccessible`, `completion_evidence_missing`,
  `active_resume`, `favorite`, `waiting_for_completion`, `completion_policy_satisfied`,
  `episode_states_vary`, `evaluation_missing`.
- Keep is reported as `state: "blocked"` with `reason: "kept"`, and `enabled` mirrors the global
  retention switch rather than the entry's own policy.

**Correction (review 2026-09-18):** the summary is not privacy-safe for ordinary users. Its
reasons and deadlines are computed from every accessible user's completion evidence, so
`favorite`, `active_resume`, `waiting_for_completion` and a `scheduled` deadline reveal other
users' favourite, resume and completion activity. A series aggregate also includes episodes the
requester cannot see (plugin-authz-entries#3, medium, single-source).

**Correction (review 2026-09-18):** status codes not listed above. Keep returns 400 when the
entry has no target library. `Retention/Runs/Latest` returns 404 before any run.
`GET /JellyfinMod/Reconciliation/Latest` (administrator-only) returns 404 when no run exists.
Preview, both run endpoints and Reconciliation/Latest return 503 before the plugin database is
ready (prior-L2, low, verified; tests-contract#8, low, verified).

**Correction (review 2026-09-18):** `POST /JellyfinMod/Retention/Run` runs synchronously inside
the request and is cancelled when the client aborts, for example on a script or proxy timeout.
The native Scheduled Tasks "Run" button is not affected (prior-M10, low, verified).

**Proposed (review 2026-09-18, not user-approved):**

- Ordinary users receive a public vocabulary with no favourite, resume or completion detail and
  no deadline derived from other users; series aggregates use only visible episodes; detailed
  reasons stay on administrator responses (task T15 in [PHASE3.md](PHASE3.md)).
- `Retention/Run` returns 202 and queues the native task instead of running inside the request
  (task T9 in [PHASE3.md](PHASE3.md)).
- An administrator Keep reversal and a per-entry days editor (prior-M9, low, verified; task T13
  in [PHASE3.md](PHASE3.md)). Whether to add them is an open question for the user in
  [PLAN.md](PLAN.md); Keep itself stays one action with no confirmation.

## Monitoring and removal

`PATCH /JellyfinMod/Entries/{id}` and
`PATCH /JellyfinMod/Entries/{id}/Episodes/{episodeId}` accept `{"monitored":false}` and return
the updated Entry or Episode. They reject missing/null monitoring and unknown fields. Monitoring
does not trigger downloads in Phase 1. Ordinary users cannot invoke either operation.

`DELETE /JellyfinMod/Entries/{id}` returns 204 and removes the entry with its dependent catalog
records. It does not delete media. `deleteFiles=true` is rejected. There is no ordinary-user
Undo endpoint bypassing administrator-only removal.

**Correction (review 2026-09-18):** removal takes neither the retention gate nor the library
lock, and the delete cascades away the entry's retention operations, including open intent a
crash-recovery pass would need. Removing an entry that still has native bindings also lets
reconciliation recreate it later with the default policy, so an earlier Keep is lost
(prior-M1, medium, verified; plugin-reconciliation-data#1, medium, verified).

**Proposed (review 2026-09-18, not user-approved):** Remove returns 409 while any retention
operation for the entry is open, and while native bindings exist unless a tombstone that keeps
Keep and policy is chosen (task T10 in [PHASE3.md](PHASE3.md)). Whether to refuse, keep a
tombstone or keep the current hard delete is an open question for the user in
[PLAN.md](PLAN.md).

## Discovery

`GET /JellyfinMod/Discover/Search?q=Example&type=movie&page=1`

`type` is `movie` or `series`; query length is 1–200 and page is 1–500. Optional
`targetLibraryId` chooses library scope. Without it, accessible libraries form the global scope.
Held native and plugin provider identities are excluded within that scope; content restrictions
also apply. Items use the Entry's `metadata` shape above.

An entirely excluded remote page can return `{"items":[],"nextPage":2}`. Follow `nextPage`
until it is null; an empty page alone is not the end. No unfiltered TMDB count is exposed as a
remaining-result total. Provider failures must leave no partially created catalog entry.

**Correction (review 2026-09-18):** the continuation is unbounded today. A user with AllowedTags
can never read file-less metadata, so every page is empty and the web client auto-follows up to
500 remote pages, each costing up to 21 TMDB calls. A single failed TMDB detail call other than
404 fails the whole page (plugin-browse-discover#2, medium, verified;
plugin-browse-discover#6, low, verified).

**Proposed (review 2026-09-18, not user-approved):** "follow `nextPage`" stays the rule, but the
continuation becomes bounded. A user who can never read file-less metadata (AllowedTags) gets
`{"items":[],"nextPage":null}` before any TMDB call, and each request has a TMDB-call budget. A
single failed detail call is skipped and counted in the response instead of failing the page
(task P8 in [PHASE1.md](PHASE1.md); the web auto-follow cap is task W13).

## Review corrections — 2026-09-18

Index of the notes above, from the review of plugin 81c1aae in
[`REVIEW-2026-09-18.md`](REVIEW-2026-09-18.md). Every proposed contract is **not yet
implemented** and not user-approved.

| Section | Current behaviour | Proposed contract (not yet implemented) | Findings | Task |
| --- | --- | --- | --- | --- |
| Intro | Refresh and Reconciliation/Latest are admin-only but unlisted | Documentation only | prior-L2 | — |
| Intro | API keys get 400 on Entries, Browse and Discover; Retention and Reconciliation accept them | 401 on user-scoped endpoints | plugin-authz-entries#6 | P11 |
| Health | `Version` is always `0.1.0.0` | Add `revision`, `lastMigration`, `capabilities` | plan-ops#5, web-library-search-details#6 | X4, W14 |
| Add and retry | `reclaimed` is produced; `watchedAt`/`reclaimAt` never written; `progress` reserved | Deprecate `watchedAt` and `reclaimAt` | tests-contract#8 | P11 |
| Add and retry | Library-lock wait reported as 504 TMDB timeout | 409 or 503 "library busy" | plugin-reconciliation-data#7 | R8 |
| List | `jellyfinItemId` matches the primary binding only | Resolve through `EntryBindings`, server and web | tests-contract#8 | P11 |
| Combined browse | `query`, `dueWithinDays`, optional `limit`, row `retention` undocumented | Documentation only | prior-L2, tests-contract#8 | — |
| Combined browse | SD/HD/4K are one OR group, not conjunctive | Documentation only | plugin-browse-discover#9 | — |
| Combined browse | Series Played/Unplayed reads the series row's user data | Native episode-based semantics | plugin-browse-discover#3 | P10 |
| Combined browse | Native rows always report `onDisk` | See Phase 4 File filter membership | plugin-browse-discover#8 | — |
| Detail and episodes | Reclaimed episodes report `availability: missing` | Add `reclaimed` | tests-contract#7 | T14 |
| Detail and episodes | Refresh deletes episodes missing from TMDB (phase3/phase4 lines) | Never delete on Refresh (carry forward fba11e3) | plugin-authz-entries#1 | P7, T10 |
| Automatic retention | Reason vocabulary and status codes undocumented | Documentation only | tests-contract#8, prior-L2 | — |
| Automatic retention | Summaries reveal other users' activity | Public vocabulary for non-admins | plugin-authz-entries#3 | T15 |
| Automatic retention | Run is synchronous and cancelled on client abort | 202 plus queued native task | prior-M10 | T9 |
| Automatic retention | Keep cannot be reversed | Admin un-Keep and per-entry days (open question) | prior-M9 | T13 |
| Monitoring and removal | Remove is ungated and cascades retention operations | 409 while operations open or bindings exist (open question) | prior-M1, plugin-reconciliation-data#1 | T10 |
| Discovery | Unbounded continuation; one failed detail fails the page | Bounded continuation, TMDB budget, skipped count | plugin-browse-discover#2, plugin-browse-discover#6 | P8, W13 |
