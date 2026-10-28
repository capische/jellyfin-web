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

**Full episode list of a discovered series (Phase 1 follow-up, 2026-10-12;
[`design/p1-full-episode-list.md`](design/p1-full-episode-list.md)).** Entry detail and the Refresh answer carry
`episodeListLoaded` (boolean). It is `true` for a movie, and for a series that holds a TMDB episode (`tmdbId > 0`) or
whose History has an `episodes_listed` event. A series that reconciliation discovered in a TVDB-scraped library starts
with `false`: it lists only the episodes of its files, as position rows with `tmdbId: 0`. An administrator's Refresh
loads the whole TMDB season and episode list, and the first such load adds one History event:

```json
{"eventType":"episodes_listed","summary":"Loaded 3 seasons and 5 episodes from TMDB"}
```

The Refresh adopts a position row only with evidence (the same title, or the same air date within a day; RET-R2), never
adds a second row at a position a file holds, and adds every other TMDB episode as a row of its own with
`availability` `missing` or `unaired`. A new row is monitored only when its series is, so a discovered (unmonitored)
series' list is never searched for by automation.
The plugin reads a series' seasons appended to one TMDB request (`append_to_response=season/N`, up to 20 a request),
so a load takes two TMDB calls: the details, then every season. Through Jellyfin's TMDb connection (no token saved,
P1.FU13) each season is one request.

**Loading the list on open, for any user (P1.FU9, user 2026-10-12).** `POST /JellyfinMod/Entries/{id}/EpisodeList`, no
body, answers the same `EntryDetail` as `GET /JellyfinMod/Entries/{id}`, to anyone the GET answers (signed in, and the
same library, parental-rating and tag rules; others get 404). For a series with `episodeListLoaded: false` it first runs
the Refresh's own load (same merge, unmonitored new rows, one `episodes_listed` event that names no user). A loaded list,
a movie or an entry without a library is answered unchanged without asking TMDB; keeping a loaded list current stays the
administrator's Refresh, which is unchanged. Concurrent calls for one entry share one load. Failures answer as the
Refresh does and leave `episodeListLoaded: false`: 404 when TMDB no longer lists the series, 502, 503 when TMDB is not
configured or the library is busy (`type: library_busy`, `Retry-After`), 504 on a timeout; the endpoint never retries by
itself. The web calls it once per entry per page visit when anyone opens a series or season page (native or file-less)
of an entry with `episodeListLoaded: false`, quietly, then refetches the entry; the release picker uses the same call and
shares the page's request. An older plugin (no field, or 404 for the route) changes nothing.

**Season overviews and episode ratings (P1.FU14, user 2026-10-12).** A series' `metadata` also carries each season's
TMDB `overview` (`seasons[].overview`, null when TMDB has none) and `episodeRatings`, TMDB's rating of each listed episode
by TMDB episode id, one decimal, unrated episodes left out (`{"8841": 7.5}`; `{}` when none is rated). Both are written by
the add, the Refresh and the EpisodeList load, from the same TMDB requests; no episode column holds them. Metadata stored
before P1.FU14 has `episodeRatings: null`: for such a series with a loaded list, `EpisodeList` runs the load once more (the
web calls it when `episodeRatings` is null), after which it is answered unchanged as above. A movie's `episodeRatings` is
null. Episode rows already carried `stillPath`, `overview`, `runtimeMinutes` and `airDate`.

**Cast, guest stars and crew (P1.FU15, user 2026-10-12).** So that an episode Jellyfin has no item for shows the people a
downloaded one shows, every episode in `episodes[]` (entry detail, EpisodeList and Refresh answers) carries `credits`:

```json
{
  "guestStars": [{ "id": 500, "name": "Olivia Colman", "character": "Sophie Chapman", "profilePath": "/a.jpg", "order": 4 }],
  "crew": [{ "id": 71, "name": "Tristram Shapeero", "type": "Director", "job": "Director", "profilePath": "/d.jpg" }]
}
```

They are kept as Jellyfin 12.0's own TMDB episode provider keeps them with its default settings: at most 15 guest stars by
TMDB's `order`, and at most 15 of the crew Jellyfin maps to a person kind (`type`: `Director` for Directing/Director, `Writer`
for Writing/Writer, Screenplay or Novel, `Producer` for Production/Producer; every other job, Executive Producer and Story
included, is dropped), in TMDB's order; unnamed people are left out and names trimmed. `credits` is `null` until the series'
list is loaded with credits (every episode row after the `EpisodeCredits` migration, a row added from a library file) and has
empty lists when TMDB names nobody. The series' `metadata` also carries `cast`: its regular cast as TMDB's series `credits`
list it (the latest season's regulars), at most 15 named people by `order` (`id`, `name`, `character`, `profilePath`,
`order`), `[]` when TMDB names none. All of it comes from the requests the add, the Refresh and the EpisodeList load already
make: `credits` is appended to the series' details request (`append_to_response=external_ids,content_ratings,credits`), each
episode's `guest_stars` and `crew` come with its season; through Jellyfin's TMDb connection the manager's series and season
reads carry the same lists. Metadata stored before P1.FU15 has no `cast`: for such a series with a loaded list, `EpisodeList`
runs the load once more (the web calls it when `cast` is absent or null), as for `episodeRatings`. Episode credits are stored
in the nullable `Episodes.CreditsJson` column (migration `20261012095715_EpisodeCredits`, forward-only).

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
ordinary-user detail responses. P1.FU25: each item has `leavesPlaceholder` (true for a due or scheduled episode file whose
reclaim leaves a placeholder: the episode's only file, in a TV library that shows missing episodes, in a folder the plugin can
write) and the summary `placeholders` counts them. A file that is one of the plugin's placeholders is never due: it is blocked
with reason `placeholder`, and the executor refuses it with the same reason (reconciliation never binds one). A reclaim that
leaves placeholders appends `; a placeholder keeps the episode in Jellyfin` to its `reclaimed` history summary.

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

**Where TMDB calls go (P1.FU13, user 2026-10-12).** The TMDB token is optional. With a token (or the legacy v3 key)
saved, every call uses it, as before. With none saved, discovery, Add, Refresh and the episode-list load go through
Jellyfin's built-in TMDb connection (the server's `TmdbClientManager`, with the key Jellyfin's own metadata provider
uses); only when that is unavailable too do they answer 503 as not configured. Through Jellyfin's connection:

- a search has one page only (`nextPage` is null), and the adult filter is the Jellyfin TMDb plugin's *Include adult*;
- a failure carries no TMDB status, since the manager reports every failure as nothing: details answer 404 "Title not
  found on TMDB." (the log says the manager returned nothing), a search or season 502, a dropped connection 502, 15 s 504;
- each season is its own request (four at a time), and the manager caches answers for an hour;
- the plugin's TMDB stand-in cannot redirect it, so only a live instance tests it.

`GET /JellyfinMod/Settings/Discovery` adds `source`: `token`, `jellyfin` or `none`. The setup's Discovery step is done
when the source is `jellyfin` (no test needed); `discovery_token_missing` now means no token and no Jellyfin connection.
`POST /JellyfinMod/Settings/Discovery/Test` with no token saved checks Jellyfin's connection with one read of a well-known
series and records a pass as before; its answer adds `source`. `POST /JellyfinMod/Settings/Discovery/Test?source=jellyfin`
(administrators) is a read-only diagnostic: it reads Breaking Bad and its first season through Jellyfin's connection
whatever token is saved, records nothing, and answers
`{"ok":true,"code":"ok","message":"Jellyfin's TMDb connection answered: 5 seasons, 7 episodes in season 1.","source":"jellyfin",…}`,
or `not_available` when the server has no usable connection. Any other `source` is 400 `invalid_source`. Each call through
Jellyfin's connection logs `TMDB request <path> through Jellyfin's TMDb connection`.

## Acquisition (Phase 4)

Every route below is administrator-only (`Policies.RequiresElevation`, P4.A1). Ordinary users get 403;
an administrator without access to the target library gets the concealed 404. Acquisition DTOs serialize
unknown values as explicit JSON `null`. The host's serializer writes GUIDs in compact form without dashes.

### Settings

`GET/POST /JellyfinMod/Settings/Indexers`, `PATCH/DELETE /JellyfinMod/Settings/Indexers/{id}`,
`POST /JellyfinMod/Settings/Indexers/{id}/Test`, and the same set for `DownloadClients` and
`QualityProfiles` (profiles have no Test). A PATCH must echo the current `revision` or it gets 409
`revision_conflict`. `GET .../QualityProfiles` lists profiles best first (user, 2026-10-19): by the resolution of each profile's best (first) quality, 4K, 2K, 1080p, 720p, SD, then by name, and a profile that spans every resolution (2160p down to SD, Any Quality) last (user, 2026-10-30, D181); the presets list the same way; the web lists show it as given. Unknown fields are rejected. Secrets are write-only (user decision 3):

```json
{"name":"Tracker","baseUrl":"<torznab-api-url>","enabled":true,"categories":[2000,5000],"priority":1,
 "downloadHosts":[],"minimumSeedRatio":1.0,"minimumSeedMinutes":2880,
 "apiKey":{"action":"replace","value":"<secret>"},"revision":1}
```

`action` is `unchanged` (value null), `replace` or `clear`. Reads return only `apiKeyConfigured` /
`passwordConfigured`; SQLite keeps an opaque reference, and the value lives in the plugin-owned
secret file. A download client (`kind: "transmission"`, user decision 1) carries `label`,
`downloadDirectory` (the client's view), `localDirectory` (Jellyfin's view of the same folder) and
an optional credential-free `openUrl`. The folder must be outside every library folder and share the
statx device and mount of at least one movie/TV library root (user decision 6). Otherwise the save
answers 400 `destination_missing`, `destination_inside_library` or `destination_not_same_filesystem`.
The client Test reads `session-get` only and never adds a torrent.

`GET /JellyfinMod/Settings/Acquisition` returns `enabled`, `downloadClientId`,
`defaultQualityProfileId`, `revision`, `ready`, `blockers`, `holdSeconds`,
`seedProtectionMatchesClient` and the quality vocabulary (`source-resolution` ids such as
`webdl-1080p`). `PATCH` with `enabled: true` answers 409 `acquisition_not_ready` with the blockers
until a verified indexer, a verified enabled client and a default profile exist.

`POST` and `PATCH /JellyfinMod/Settings/Prowlarr` take `name` as optional (user, 2026-10-19; the settings form has no Name
field, and there is one source): a new source without a name is called `Prowlarr`, an edit without one keeps the stored name,
and a name that is sent is still stored (unique, at most 64 characters). The old `invalid_name` answer is gone.

`GET /JellyfinMod/Settings/Prowlarr/{id}/DownloadClients` (P6.FU1, administrator-only like every Prowlarr route)
reads Prowlarr's `api/v1/downloadclient` with the source's saved key, on the server: the key never reaches the browser.
It uses the acquisition HTTP client (no redirects, 20 s timeout) and refuses a body over 256 KiB (`response_too_large`).
Only `host`, `port`, `useSsl`, `urlBase` and `username` are read from each client's `fields`; the password (Prowlarr
masks it as `********`) and every other field are never read or returned. It changes nothing:

```json
{"code":"ok","gateway":"192.168.147.1","clients":[
 {"implementation":"Transmission","name":"Seedbox","enabled":true,"host":"localhost","port":9091,"useSsl":false,
  "urlBase":"/transmission/","username":"jfmod","kind":"transmission","baseUrl":"http://localhost:9091/transmission/rpc"},
 {"implementation":"QBittorrent","name":"Q","enabled":true,"host":"qbit","port":8080,"useSsl":false,"urlBase":null,
  "username":null,"kind":null,"baseUrl":null}]}
```

`kind` and `baseUrl` are set only for a client the plugin can drive (Transmission): the RPC address as Prowlarr builds
it, scheme, host and port, then the URL base (default `/transmission/`) and `rpc`; a host that would not make a
credential-free http(s) address gives none. `gateway` is the server's IPv4 default gateway from `/proc/net/route` when it
is in 10/8, 172.16/12 or 192.168/16, else `null`. A Prowlarr that fails answers 200 with its code (`unauthorized`,
`unreachable`, `timeout`, `prowlarr_schema`, `response_too_large`, …) and no client; an unknown source is 404.
`GET /JellyfinMod/Setup/State` lists `indexers` before `downloadClient` (P6.FU1).

`PATCH /JellyfinMod/Entries/{id}` also accepts `{"qualityProfileId": "<id>"}`. An explicit `null`
restores inheritance. Episodes inherit their series profile and reject the field.

#### Quality vocabulary and presets (P4.FU9, 2026-10-15)

A quality id is `<source>-<resolution>`. Sources, best first: `remux` (an untouched disc copy), `bluray` (a Blu-ray
encode), `webdl` (a streaming service's file), `webrip` (a capture of a stream), `hdtv` (broadcast), `dvd`. The
vocabulary (`GET /JellyfinMod/Settings/Acquisition`, `qualities`) is every combination below; `cam` and screener copies
are never acquired.

| Resolution | remux | bluray | webdl | webrip | hdtv | dvd |
| --- | --- | --- | --- | --- | --- | --- |
| `2160p` (4K) | yes | yes | yes | yes | yes | |
| `1440p` (2K, new in P4.FU9) | | yes | yes | yes | | |
| `1080p` | yes | yes | yes | yes | yes | |
| `720p` | | yes | yes | yes | yes | |
| `576p` (SD) | | yes | yes | yes | yes | yes |
| `480p` (SD) | | yes | yes | yes | yes | yes |

The parser reads `1440p` from a release title (before P4.FU9 such a release had no resolution and was rejected as
`quality_unknown`). A held 1440p file ranks with the 1080p tier in retention and import, as Jellyfin's own size
classes put a 2560x1440 picture.

A profile lists its qualities best first and scores each allowed one `(count - index) * 100`; proper or repack,
freeleech and seeders add at most 45 points, so they never lift a release above a better allowed quality. The picker
lists eligible releases by score and automation takes the first eligible one, so a profile that lists 4K, then 2K, then
1080p, then 720p takes 4K when an acceptable 4K copy is offered and **falls back** down its list when none is (none
offered, or each one rejected, for example `size_above_maximum`). No other mechanism is involved.

Profiles add `presetId`: the preset a profile was created from (its id is the preset's), else null.

`GET /JellyfinMod/Settings/QualityProfiles/Presets` lists the presets shipped with the plugin (data in the plugin's
`Assets/quality-presets.json`), in the order the dialog's *Start from* list shows them:

```json
[{"id":"8fc450faec3d4d42962ea7835ed239e7","name":"4K",
  "description":"Best picture, big files. Falls back to lower quality if 4K is not available.",
  "isDefaultPreset":true,"qualities":["remux-2160p","bluray-2160p","webdl-2160p","webrip-2160p","hdtv-2160p","bluray-1440p",
  "webdl-1440p","webrip-1440p","remux-1080p","bluray-1080p","webdl-1080p","webrip-1080p","hdtv-1080p","bluray-720p","webdl-720p",
  "webrip-720p","hdtv-720p"],"minimumBytesPerHour":null,"maximumBytesPerHour":null,"cutoff":"remux-2160p",
  "upgradeAllowed":false,"upgradeMode":"replace","minimumSeeders":2,"added":true}]
```

`added` is true when a profile with the preset's id exists (it may have been renamed or edited since). A preset becomes
an ordinary profile whose id is the preset's id: it can be edited and deleted like any other, and the default one can be
deleted only after another profile is made the default (`409 profile_is_default`). Every preset tries its resolutions
best first, each in the source order remux, Blu-ray, WEB-DL, WEBRip, HDTV, DVD; sets minimum seeders 2 (automation
only), no minimum size and no minimum score; and leaves upgrades off with the first quality as the cutoff, so turning
upgrades on needs nothing else:

| Preset | Description | Qualities | Size cap per runtime hour |
| --- | --- | --- | --- |
| **4K** (default) | Best picture, big files. Falls back to lower quality if 4K is not available. | 2160p, 1440p, 1080p, 720p (17) | none (Large; user, 2026-10-19) |
| 2K | 1440p, a step below 4K at about half the size. Falls back to lower quality. | 1440p, 1080p, 720p (12) | 10 GB (Balanced) |
| 1080p | Full HD, the sensible middle. Falls back to 720p. | 1080p, 720p (9) | 6 GB (Balanced) |
| 720p | Small files for small screens or slow links. | 720p (4) | 1 GB (Small) |
| Any Quality | Best available of anything. Good for hard-to-find titles. | the whole vocabulary (27) | none (Large) |
| SD | 480p / 576p only. DVD rips and old TV. | 576p, 480p (10) | 0.5 GB (Small) |

The size figures are the redesign's tiers for the best resolution (GB per hour: Small 4K 8, 2K 4, 1080p 2, 720p 1,
SD 0.5; Balanced 20, 10, 6, 3, 1.5; Large no limit). The 4K cap lets a 4K WEB-DL or encode through (a two-hour film up
to 40 GB) and refuses a typical 4K remux (50-90 GB); a cap is one limit for the whole profile, so it never refuses a
smaller lower-resolution copy.

`POST /JellyfinMod/Settings/QualityProfiles/Presets` (administrators, no body) adds every preset that is not a profile
yet and never changes, renames or deletes an existing profile. A preset whose name another profile already has is left
out. With no default profile set, the default preset becomes the default. It answers 200:

```json
{"added":[{"id":"…","name":"2K","added":true,"…":"…"}],
 "skipped":[{"id":"698e6ea90b644c1f824a2dad08e315e8","name":"720p","reason":"name_in_use"}],
 "defaultQualityProfileId":null,"message":"Added 5 preset profiles. 1 left out because another profile has the same name."}
```

`reason` is `already_added` or `name_in_use`; `defaultQualityProfileId` is the default it set, else null.

**Fresh install.** At start, a database with no quality profile whose acquisition settings were never saved (no
settings row, or revision 1 with no default) gets every preset, and the 4K preset becomes the default profile (settings
revision + 1); grabbing and automation stay off. Any other database is left exactly as it is, so an install that
already has profiles keeps them, names, order, limits and default included; its administrator adds the presets with
`POST …/Presets` (*Add Predefined Profiles* in the Quality Profiles section). No migration: presets are ordinary profile rows.

### Search

`GET /JellyfinMod/Releases?entryId=&episodeId=&profileId=` never submits anything:

```json
{
  "searchId": "…", "createdAt": "2026-09-19T10:00:00Z", "expiresAt": "2026-09-19T10:10:00Z",
  "target": {"entryId": "…", "episodeId": null, "mediaType": "movie", "title": "Example Movie",
             "year": 2024, "seasonNumber": null, "episodeNumber": null},
  "profile": {"id": "…", "name": "HD", "revision": 3, "inherited": true},
  "grab": {"available": true, "reason": null, "holdSeconds": 5, "activeOperationId": null},
  "candidates": [{
    "releaseId": "opaque", "indexerId": "…", "indexerName": "Tracker",
    "rawTitle": "Example.Movie.2024.1080p.WEB-DL.DDP5.1.H.264-GRP",
    "parsed": {"title": "Example Movie", "year": 2024, "seasonNumber": null, "episodeNumbers": [],
               "seasonPack": false, "absoluteNumbering": false, "dailyNumbering": false,
               "resolution": "1080p", "source": "webdl", "codec": "h264", "audio": "DD+", "hdr": null,
               "group": "GRP", "proper": false, "repack": false, "quality": "webdl-1080p"},
    "match": {"identity": "verified", "method": "imdbid"},
    "size": 4000000000, "seeders": 50, "peers": null, "publishedAt": "2026-09-18T10:00:00Z",
    "freeleech": null, "proper": false, "repack": false, "infoHash": null, "sameHashReleaseIds": [],
    "score": 522, "contributions": [{"code": "quality_rank", "points": 500}, {"code": "seeders", "points": 22}],
    "eligible": true, "rejections": [], "seedRatio": 1.0, "seedMinutes": 2880,
    "detailsUrl": "https://tracker.example/torrent/100"
  }],
  "eligibleCount": 1, "rejectedCount": 0,
  "indexers": [{"indexerId": "…", "name": "Tracker", "status": "ok", "message": null,
                "resultCount": 1, "truncated": false, "retryAfterSeconds": null}],
  "partial": false, "truncated": false
}
```

Indexer `status` is `ok`, `no_results`, `auth_failed`, `rate_limited`, `timeout`, `unavailable`,
`malformed_response`, `capabilities_unavailable`, `unsupported_search`, `secret_unavailable` or another
stable failure code. Rejection codes include `identity_unverified`, `identity_mismatch`,
`title_mismatch`, `year_missing`, `year_mismatch`, `media_type_mismatch`, `season_pack`,
`multi_episode`, `absolute_numbering`, `ambiguous_numbering`, `ambiguous_special`, `episode_mismatch`,
`quality_unknown`, `quality_forbidden`, `quality_not_allowed`, `size_unknown`, `runtime_unknown`,
`size_below_minimum`, `size_above_maximum`, `no_download_locator`, `download_host_not_allowed` and
`unsupported_hash`. Series searches need `episodeId` (400 `episode_required`).

`detailsUrl` (2026-10-12) is the release's page on the tracker, for the picker's indexer link: the Torznab item's
`comments`, else its `guid` when that is an http(s) address; null when neither qualifies. A URL with user information, a
credential-like query parameter (`key`, `pass`, `token`, `auth`, `secret`, `sid` or `session` in its name), the indexer's
own API key anywhere in it, or the download link itself is never returned.

### Grab, hold and Cancel

`POST /JellyfinMod/Releases/Grab` accepts only
`{"searchId":"…","releaseId":"…","idempotencyKey":"grab-…"}`. A new operation answers 202 in state
`pending` with `holdUntil`; the same key and payload answer 200 with the same operation. A reused key
with another payload answers 409 `idempotency_conflict`. Other refusals are 404 `search_not_found` /
`release_not_found`, 410 `search_expired`, 409 `release_rejected`, `grab_active` (with
`operationId`), `duplicate_hash`, `acquisition_disabled`, `acquisition_not_ready`,
`destination_not_same_filesystem` or `hash_mismatch`, and 502 `download_host_not_allowed`,
`redirect_rejected`, `invalid_torrent` or `unsupported_hash`.

```json
{"id":"…","state":"pending","active":true,"cancellable":true,"entryId":"…","episodeId":null,
 "releaseTitle":"Example.Movie.2024.1080p.WEB-DL.DDP5.1.H.264-GRP","indexerName":"Tracker",
 "quality":"webdl-1080p","size":4000000000,"infoHash":"<40 hex>","score":522,"seedRatio":1.0,
 "seedMinutes":2880,"holdUntil":"2026-09-19T10:00:05Z","createdAt":"…","updatedAt":"…",
 "submittedAt":null,"acceptedAt":null,"cancelledAt":null,"failureCode":null,
 "message":"Held before sending; it can still be cancelled.","openUrl":null}
```

States: `pending` (held and cancellable, nothing sent), `submitting`, `accepted`, `failed`, `unknown`
and `cancelled`. `GET /JellyfinMod/Grabs/{id}` reads one operation. `GET /JellyfinMod/Grabs` lists active
and unknown ones. `POST /JellyfinMod/Grabs/{id}/Cancel` cancels a pending grab; repeating it returns
the same cancelled operation, and after submission starts it answers 409 `grab_not_cancellable`
(user decision 2). `POST /JellyfinMod/Grabs/{id}/Recheck` resolves an uncertain or accepted operation
by infohash lookup and never resubmits. Entry detail adds `acquisition` for movies, and each episode
adds `acquisition`. Ordinary users see only `state` and `updatedAt`. `DELETE /JellyfinMod/Entries/{id}`
answers 409 `grab_active` while a grab owns the title.

## Import, queue and seeding (Phase 5)

Health `Capabilities` adds `queue`, `import` and `seedRelease`. Clients hide the queue route, the
downloading card state and the Remove dialog when a capability is missing (old plugin).

### Import settings and path mappings

`GET/PATCH /JellyfinMod/Settings/Import` (administrator-only). A PATCH must echo `revision`:

```json
{"importEnabled":true,"seedReleaseEnabled":false,"seedFloorRatio":1.0,"seedFloorHours":168,
 "importPollSeconds":15,"videoExtensions":["mkv","mp4","m4v","avi","mov","ts","m2ts","webm","wmv","mpg","mpeg"],
 "stalledAfterHours":24,"scanTimeoutMinutes":10,"queueVisibleToUsers":false,"revision":1}
```

`GET/PUT /JellyfinMod/Settings/DownloadClients/{id}/PathMappings` replaces the ordered list
`{"pathMappings":[{"clientPathPrefix":"<client-download-dir>","localPathPrefix":"<test-root>/downloads"}],
"revision":3}`; the client's `revision` is bumped. The first matching prefix wins; a path that no
mapping and no `downloadDirectory`/`localDirectory` pair covers is `path_unmapped`.
`POST /JellyfinMod/Settings/DownloadClients/{id}/TestImportPath` with `{"clientPath":"…"}` maps the path, checks
that it exists, and reports for each movie/TV library root whether it shares the mount and whether a
`link(2)` probe succeeded (`linkProbe`: `linked`, `not_same_mount`, `source_not_writable`,
`cross_device` or `failed_<errno>`). It creates one empty probe file in the download folder, links it
into each same-mount root, and removes both links immediately.

### Queue

`GET /JellyfinMod/Queue?entryId=&state=` (`state` repeatable) returns open imports and seeding copies, newest
first. Ordinary users get 403 `queue_admin_only` unless `queueVisibleToUsers` is on; then they see
only rows of libraries they can read, without the `admin` block.

```json
{"items":[{"id":"…","grabId":"…",
  "entry":{"id":"…","mediaType":"movie","title":"Example Movie","year":2024,"posterPath":null,
           "jellyfinItemId":null,"targetLibraryId":"…"},
  "episode":null,"releaseTitle":"Example.Movie.2024.1080p.WEB-DL.DDP5.1.H.264-GRP",
  "state":"downloading","importState":"waiting","reason":null,"message":null,
  "progress":0.42,"sizeBytes":4000000000,"downloadedBytes":1680000000,"downloadRateBytes":2500000,
  "etaSeconds":928,"stalledSince":null,"observedAt":"…","versionLabel":null,"intent":"acquire",
  "createdAt":"…","updatedAt":"…","client":{"id":"…","name":"Transmission","openUrl":null},
  "seeding":null,
  "admin":{"sourcePath":null,"sourceClientPath":null,"destinationPath":null,
           "sourcePhysicalIdentity":null,"destinationPhysicalIdentity":null,
           "hardlinkCountAfter":null,"error":null,"infoHash":"<40 hex>"}}],
 "totalRecordCount":1,"generatedAt":"…",
 "clientStatus":{"reachable":true,"checkedAt":"…","reason":null},
 "importEnabled":true,"seedReleaseEnabled":false,
 "automation":{"enabled":false,"pausedReasons":["disabled"]}}
```

Row `state` is one of `queued` (nothing downloaded yet), `downloading`, `stalled`, `unknown`
(client unreachable), `identifying`, `linking`, `scanning`, `seeding`, `blocked` and `failed`.
`importState` is the stored state: `waiting`, `identifying`, `linking`, `linked`, `scanning`,
`completed`, `blocked`, `failed`, `cancelled`. Import reasons: `path_unmapped`, `source_missing`,
`source_size_mismatch`, `no_video_file`, `ambiguous_files`, `archive_unsupported`,
`episode_mismatch`, `target_exists`, `cross_filesystem`, `destination_not_writable`,
`destination_collision`, `library_root_missing`, `scan_timeout`, `binding_not_observed`,
`client_unreachable`, `torrent_missing`, `import_disabled`, `cancelled`, `target_missing` and
`client_missing`. `seeding.waitingFor` lists the unmet goals (`complete`, `ratio`, `time`). One client snapshot, at most 3 s old, serves every queue read and projection.

A season or series pack is one row (`episode` null) whose `pack` block has `scope`, `label`, `mode` and `episodes`: each
claimed episode with `episodeId`, `seasonNumber`, `episodeNumber`, its newest `importId`, `importState` and `reason`, and
(next-up priority, P5.FU3 and P4.FU5) `progress`, the episode's own file 0–1 while it downloads (1 once its import left
`waiting`, null when the file is not known yet), and `sizeBytes`, that file's length while the client lists it (null
otherwise). The row's own `progress`, `sizeBytes`, `downloadRateBytes` and `etaSeconds` stay the whole torrent's. The web
estimates an episode's time left as its remaining bytes at the row's `downloadRateBytes`. The row's `state` is the pack's as a
whole (P4.FU12): `queued`, `downloading` or `stalled` while any claimed episode still waits for its file, the import states
once none does, then a failed episode's, then `seeding`; so it never goes from an import state back to `downloading`, even
though each episode imports as soon as its own file is in.

Every row also carries (P1.FU20, additive; absent from older plugins) `parsed`, the release name as the picker parsed it when
it was grabbed (the grab's stored copy, the same shape as a release candidate's `parsed`: `resolution`, `source`, `codec`,
`audio`, `audioChannels`, `hdr`, `languages` and the rest; null when the grab kept none), and `indexerName`, the indexer the
release came from (null when the grab is gone). Both are shown to everyone who may read the row; a missing episode's
download block draws its marks from them. The release's page on the tracker (`detailsUrl`) is not kept after a grab, so the
queue has no link to it.

**Mode and what a Replace removes (the upgrade status, 2026-10-28, additive; absent from older plugins).** Every row carries
`mode`, its grab's `fill` (a first download), `add` (another version beside what the title holds) or `replace` (one that then
replaces it); null when the grab is gone. A movie's or an episode's Replace also carries `replaces`, the files its grab fixed as
its targets, each `{ "bindingId": "…", "label": "1080p" }` with the resolution its file name gives (`label` null when the name
gives none); `[]` for a Replace decided before targets were recorded, null for every other row (a pack fixes its targets per
episode as each import completes). A pack's `pack.episodes[]` carry `held`, true when the episode held a file when the pack
claimed it, so an `add` / `replace` pack brings it a new version. The web draws the detail page's pending entry, the card's +,
the header totals and the Queue page's `Replaces 1080p: …` from these.

**Held grabs are queued rows (P4.FU10, 2026-10-17, additive).** A grab the client has not accepted yet (held for its 5 s
cancel window, being sent, or sent and not confirmed) is a row too, from the moment `POST /Releases/Grab` answers: `id` and
`grabId` are the grab's, `state` is `queued`, `importState` is `held` while `POST /Grabs/{id}/Cancel` can still stop it and
`submitting` after, `progress` and the transfer figures are null, `sizeBytes` is the release's size, and a pack's `pack.episodes`
list every claimed episode with a null `importId`, `importState` and `progress`. The visibility is the row it becomes (the title,
the episode, and for a pack every claimed episode). When the client accepts the grab, its import row (created in the same
commit) takes its place; held grabs are read before the imports, so a read never misses both. A cancelled or failed grab
leaves the queue. `DELETE /Queue/{id}` does not take a held row's id (404); the web cancels it through the grab.

`GET /JellyfinMod/Imports/{id}` returns one import operation (concealed 404 without library access).
`POST /JellyfinMod/Imports/{id}/Retry` (admin) re-inspects a `blocked` or `failed` import from the
start and answers 409 `import_not_retryable`, `import_open` or `grab_missing`.

`DELETE /JellyfinMod/Queue/{id}` (admin) with an optional body
`{"removeFromClient":false,"blocklist":false}` cancels an open import. With `removeFromClient`
Transmission is asked to forget the torrent, with its data kept (`delete-local-data: false`), only if
JellyfinMod added it (409 `torrent_not_owned`) and the seeding path is outside every library (409
`seeding_path_inside_library`); the checked files are recorded on the import operation and stay on
disk (user decisions 2026-10-02: 0.1.0.0 never deletes downloaded files; a cleanup tool is planned
for a later version). An unreachable client answers 503 `client_unreachable` and nothing changes. `blocklist` stores the infohash so later searches reject it as `blocklisted`. Library
files are never deleted by this route. Other refusals: 409 `not_in_queue`,
`seed_release_in_progress`, `client_missing`.
With `deleteFiles` as well (user, 2026-10-26) the client deletes what the torrent downloaded instead, only while nothing of it may
be in a library: no import of its grab or infohash linked, bound or reached a linking state, no seed release of either, and no
file at a destination an import recorded (the destination is recorded before the link is made, so a link that failed leaves
nothing there; any file there, or a path that cannot be read, counts; 2026-10-29). Otherwise, and for a file linked elsewhere,
data outside the mapped folder or a torrent JellyfinMod did not add, 409 `delete_not_allowed` with nothing changed.
Administrators' queue rows carry `canDeleteFiles` (2026-10-29, additive), the first of those tests, read for every row at once,
so a page offers the delete only where it is accepted; null for a held grab and absent for other users.

`GET /JellyfinMod/Seeding` (admin) lists seed releases with their goal, the source of each goal
(`indexer`, `client`, `floor`), observed ratio and seeding time, `goalMetAt`, `logicalBytes` and
whether the library link is still present; it lists open releases only. Seed release states are
`waiting`, `removing`, `completed`, `blocked`, `cancelled` and `detached`. A release whose goals are met
has the client forget the torrent with its data kept: it becomes `detached` with reason
`cleanup_pending` and its checked files recorded, or `manual_cleanup` when an earlier build left no
list or its torrent left the client while the data is still on disk; nothing deletes those files. A
release completes only when its data is confirmed gone. Reasons include `seed_goal_unmet`, `seeding_incomplete`,
`seed_release_disabled`, `torrent_not_owned`, `retention_operation_open`,
`seeding_path_inside_library`, `library_link_unexpected`, `seeding_path_unavailable`,
`client_unreachable`, `seeding_copy_survived`, `released` and `seeding_copy_missing`.

Entry list, browse and detail projections report `acquisition.state` values `grabbed`,
`downloading`, `importing` and `blocked` from the open import, while the stored entry state stays
unchanged until Phase 2 binds the imported file. `DELETE /JellyfinMod/Entries/{id}` answers 409
`import_active` while an import is open.

## Automation and versions (Phase 6)

Health `Capabilities` adds `automation` and `versions`. Every automation route is administrator-only.

`GET /JellyfinMod/Settings/Automation` and `PATCH` (echo `revision`):

```json
{"automationEnabled":false,"automationIntervalHours":6,"automationBatchSize":40,
 "newEpisodeDelayMinutes":120,"dailyAutoGrabBudget":6,"maxConcurrentImports":3,
 "freeSpaceFloorPercent":10,"freeSpaceFloorBytes":25000000000,"decisionLogCap":2000,
 "episodeUpgradesEnabled":false,"reacquireReclaimed":false,"revision":1}
```

Indexers gain `minIntervalSeconds` (default 10) and `dailyQueryBudget` (default 200). Quality
profiles gain `cutoff`, `upgradeAllowed`, `upgradeMode` (`replace` or `add`), `minimumAutoScore`
and `minimumSeeders`; a cutoff outside the allowed qualities, or upgrades without a cutoff, answer
400 `invalid_cutoff`.

`GET /JellyfinMod/Automation/Status` returns `enabled`, `pausedReasons` (`disabled`,
`budget_grabs`, `too_many_open_imports`, `free_space_floor`, `client_unreachable`,
`acquisition_not_ready`), `running`, `nextRunAt`, `lastRun` (counts and `queriesByIndexer`),
`budgets` (grabs used today, open imports, free and floor bytes) and per-indexer queries used today,
limits and `breakerOpenUntil`. `POST /JellyfinMod/Automation/Run` queues the native
`JellyfinModAutomationSearch` task and answers 202 `{"status":"queued"}`, or 409
`automation_run_active`; a manual run obeys every budget.

`GET /JellyfinMod/Automation/Decisions?entryId=&episodeId=&kind=&startIndex=&limit=` pages the
bounded decision log. `kind` is `searched`, `skipped`, `grabbed`, `upgrade_planned`,
`upgrade_completed`, `breaker_opened` or `budget_exhausted`; `reason` includes `not_due`,
`unmonitored`, `unaired`, `special_excluded`, `already_held_at_cutoff`, `upgrade_not_allowed`,
`budget_grabs`, `budget_indexer`, `breaker_open`, `free_space_floor`, `too_many_open_imports`,
`client_unreachable`, `no_eligible_candidate`, `below_minimum_score`, `below_minimum_seeders`,
`active_grab_exists`, `blocklisted`, `kept_entry`, `episode_versions_unsupported`,
`held_quality_unknown`, `reclaimed`, `search_failed`, `grab_refused` and `replacement_blocked`.
`GET /JellyfinMod/Automation/Targets?entryId=` lists each target's `nextSearchAt`,
`consecutiveEmpty`, `lastOutcome`, `heldBestQuality`, `cutoff`, `upgradeEligible` and
`blockedReason`. `PATCH /JellyfinMod/Entries/{id}` accepts `{"searchNow":true}` (admin) to make
the target due at the next run and reset its back-off.

`GET /JellyfinMod/Releases?…&intent=addVersion` searches for another quality of a title that has
a playable file (409 `no_playable_version`; episodes answer 409 `episode_versions_unsupported`
while episode upgrades are off). Candidates carry `heldQuality: true` for qualities already in the
library. Add takes one (another file of that quality, user 2026-10-29, D108); only `mode: "replace"` with one answers 409
`held_quality`. An unknown `intent` is 400 `invalid_intent`.
`grab.modes` is `["add","replace"]` for an episode's or a movie's another version while `episodeUpgradesEnabled`
(Settings › Automation, "Upgrade episodes and allow Replace") is on, `["add"]` while it is off; a grab with
`"mode":"replace"` then answers 409 `episode_replace_disabled`. For a movie, `grab.heldFiles` counts the files it holds: once
the new file is bound and playable, Replace removes every file the movie held when the import completed (user, 2026-10-28).

Entry detail adds `versions` and, for administrators, `upgrade`; episodes add `versions`:

```json
"versions":[{"jellyfinItemId":"…","mediaSourceId":"…","bindingId":"…","label":"1080p WEB-DL",
  "quality":"webdl-1080p","resolution":"1080p","width":1920,"height":1080,"videoCodec":"h264",
  "videoRange":"SDR","bitDepth":8,"audioCodec":"eac3","audioChannels":6,"sizeBytes":4000000000,
  "isDefault":true,"retention":{"state":"protected","reason":"seed_goal_unmet"}}],
"upgrade":{"eligible":true,"cutoff":"bluray-2160p","heldBest":"webdl-1080p","mode":"replace",
  "blockedReason":null,"openUpgradeState":null}
```

A superseded version removed after an upgrade is a Phase 3 `RetentionOperation` with
`provenance: "upgrade_replaced"` and history event `upgrade_replaced`; automatic grabs write
`auto_grabbed`.

### A best copy and a 1080p copy for phones (Phase 12, built 2026-10-29, not accepted)

Health `Capabilities` adds `copies`. Every route below is administrator-only, like the rest of the settings.

- **Prefer:** a quality profile (DTO, `POST`, `PATCH`, presets) carries `prefer`: `"tvs"` (Best on My TVs), `"everywhere"` (Plays
  Everywhere) or `null` (No Preference, the value of every profile stored before Phase 12). A request that leaves `prefer` out
  keeps the stored value (the Dashboard page's editor does not send it); anything else answers 400 `invalid_prefer`. It reorders
  releases of the same quality only: score contributions `prefer_picture` (a picture tier × 8, at most 32) and `prefer_sound` (a
  sound tier, at most 7), together under the 45 points of proper, freeleech and seeders' headroom, so never above a better quality
  step. Scoring version `p12.m30.v1`. The 4K preset prefers `tvs`, the 1080p preset `everywhere`; presets add `isPhonesPreset`.
- **The quality profile for phones:** `GET/PATCH /JellyfinMod/Settings/Acquisition` add `phoneProfileId` (null when none); a
  `PATCH` that leaves it out keeps it; an unknown id is 400 `invalid_phone_profile`. A fresh install sets it to the 1080p preset;
  the migration sets it to an existing install's stored 1080p preset copy, else null, and Add Predefined Profiles sets it when it
  is null. Profiles add `isPhoneProfile`. Deleting the chosen profile answers 409 `profile_is_phone_profile`.
- **TVs:** `GET /JellyfinMod/Settings/TvModels` →
  `{"models":[{"id":"lg-c1","name":"LG C1","year":2021,"webOS":"6","dolbyVision":true,"hdr10Plus":false,"hlg":true,"ddPlusAtmos":true,"dts":false,"trueHd":false,"selected":true}, …],"selected":["lg-c1","lg-g2"],"revision":2}`;
  `PATCH` `{"selected":[…],"revision":n}` (409 `revision_conflict`, 400 `invalid_tv_model`). The catalogue is the plugin's
  `Assets/tv-models.json`; a capability counts when every ticked TV has it.
- **Copies on entry detail:** a `versions[]` row adds `phoneCopy` (true on the file phones play: on a title with two or more files,
  the best one at 1080p or below, never a 1440p (D114), SDR first); entry detail (movies) and each episode add `phoneCopyMissing` (files held and none at
  1080p or below).
- **Get Another Quality for phones:** `GET /JellyfinMod/Releases?intent=addVersion` without `profileId` on a title whose phone copy
  is missing searches with `phoneProfileId` (`profile.inherited` false), and a season or series pack search without `profileId`
  does so when every covered episode holds files and none at 1080p or below. Such a search answers `grab.forPhones: true` and
  `grab.modes: ["add"]`.
- **Automation:** `GET/PATCH /JellyfinMod/Settings/Automation` add `fetchPhoneCopies` (Also get a 1080p copy for phones, off; a
  `PATCH` that leaves it out keeps it). While it is on, a monitored movie or episode whose files are all above 1080p is searched with
  the profile for phones, only releases at 1080p or below are taken, and the grab is an Add (a season of such episodes, every one
  holding files, is tried as a pack first); decision detail `Copy for phones: <release>`. Reasons `phone_copy_removed` (a file at
  1080p or below was removed by retention or Remove This Version: never fetched again; weekly retry of the check) and
  `phone_copy_held`. While it is on, an upgrade from a file at 1080p or below to one above it adds instead of replacing.

### Versions on Jellyfin 12 (V1, 2026-09-28)

Health `Capabilities` adds `versions.v1` (rows from Jellyfin's media sources) and `versions.remove`.

Each `versions[]` row adds `tracked` (false for a file Jellyfin plays that the plugin has not bound yet; its
`bindingId` is the empty GUID and it has no `retention`), `removable` (administrators: a bound single file no per-file
Keep holds), `isLast` (removing it removes the title's last copy), `inProgress` (the viewer is part-way through it) and
`episodeRange` (`"S01E01-E02"` for a multi-episode file, else null). `isDefault` is Jellyfin's main item.

`POST /JellyfinMod/Entries/{id}/Versions/{bindingId}/Remove` — administrators only (anonymous 401, ordinary user 403,
unknown title or binding 404). Deletes exactly that file through the plugin's exact unlink and removes its native item
with file deletion off; the folder, sidecars and other versions stay. Removing the last copy leaves the movie (or the
episode) `none` and unmonitored.

```json
{"bindingId":"…","logicalBytesUnlinked":64000000,"physicalBytesReleased":0,"state":"onDisk","monitored":true}
```

`physicalBytesReleased` is 0 while another link (a seeding copy) holds the file and null when unknown. A refusal is 409
with a ProblemDetails body whose `reason` is one of `version_kept`, `active_session`, `active_session_unknown`,
`multi_part_unsupported`, `media_not_writable`, `shared_path_not_all_eligible`, `operation_open`,
`media_identity_changed` (another file now sits at the bound path) or `media_identity_unverified` (no recorded file
identity yet), `version_identity_conflict`, `versions_unverified`, `versions_untracked` (Jellyfin plays a copy that is
not bound yet, or another title plays this file as a merged version: reconcile first), or the storage and
identity reasons of the retention preview (`storage_unavailable`, `native_binding_missing`, `media_path_unavailable`,
`symlink_representation`, `symlink_escape`, `library_root_missing`). The operation is a `RetentionOperation` with
`provenance: "version_removed"`, and History records `version_removed`.

New reasons elsewhere: the retention preview blocks `version_identity_conflict` (the versions Jellyfin groups are not one
title or episode), `versions_unverified` (a bound file is no longer one of its main item's versions) and, for movies as
well as episodes, `versions_untracked` / `episode_versions_untracked` only while a played file is unbound. Imports
block `versions_not_grouped` when Jellyfin would not group the new file with the existing one. Automation records
`multi_episode_held` (an episode held as a multi-episode file is not upgraded) and `versions_untracked` (the best copy
is not bound yet). An upgrade's replacement stops with `successor_unavailable` when its new version is no longer bound,
on disk and playable just before the old file would go. Upgrades wait with `superseded_untracked` while the superseded file is on disk but unbound, and end
`superseded_missing` only when that file is gone. `episodeUpgradesEnabled` defaults to true since V1.
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

## Placeholders for missing episodes and titles (P1.FU24, P1.FU26)

Administrators only (`Policies.RequiresElevation`); capability `placeholders` in Health. Missing aired episodes of a series
Jellyfin already holds can be shown as Jellyfin items: the plugin writes a media stub where the import puts the episode's file
(`<series folder>/Season NN/<Series (Year)> SNNENN.disc`), Jellyfin makes it an episode with `IsPlaceHolder: true`, and the
response filter below keeps every client from offering or playing it. On by default for every TV library, a new one
included (user, 2026-10-15: "That's the point."); an administrator turns it off per library
(`PluginConfiguration.PlaceholderDisabledLibraryIds`). A sync writes at most 10 series per library and run, 3 seconds apart, and
answers `pending`, the placeholders left for the next run. The sync task's trigger fires every 5 minutes; it writes a batch while
placeholders are pending (a first backfill of an existing catalogue) and every 15 minutes once none are, never two batches at once,
and gives way to a running Jellyfin library scan; its first run comes 5 minutes after the plugin starts on a server where it has
never completed (P1.FU27). Plan: [design/missing-media-user-actions.md](design/missing-media-user-actions.md) §16.

| Request | Answer |
| --- | --- |
| `GET /JellyfinMod/Placeholders` | `[{ libraryId, name, enabled, stubs, writable, mediaType }]`, every movie library (`mediaType: "movie"`, P1.FU26) and TV library (`"series"`); `stubs` counts the plugin's placeholder items Jellyfin holds; `writable` is false when no folder of the library can be written (nothing is written there) |
| `GET /JellyfinMod/Placeholders/{libraryId}/Plan` | The dry run (below): what a sync would write and remove, and what it leaves without a placeholder. Changes nothing |
| `PUT /JellyfinMod/Placeholders/{libraryId}` `{ "enabled": false }` | Turns the library off (it is on by default) and answers the dry run; existing placeholders stay until Remove. `true` turns it back on and syncs at once (the run's plan) |
| `POST /JellyfinMod/Placeholders/{libraryId}/Sync` | Syncs now: writes (only with the switch on), removes stale placeholders, stamps placeholder items |
| `GET /JellyfinMod/Placeholders/Progress` | The backfill's progress (P1.FU27): `{ titles, titlesDone, pending, running, scanRunning, lastRunAt, deferred, nextRunMinutes, libraries: [{ libraryId, name, mediaType, enabled, writable, titles, titlesDone, pending }] }`. `titles` counts the series and movies that have placeholders or still need some; `titlesDone` those with all written; `pending` the placeholders still to write. A library that is off or cannot be written counts 0 (its titles keep the mod's own cards and rows). Read now, as a dry run of each library; changes nothing |
| `POST /JellyfinMod/Placeholders/SyncNow` | Sync Now (P1.FU27): runs the scheduled sync's next batch at once over every library (the same 10-titles-per-library bound, pause and library-scan guard) and answers the progress after it. `409 { "error": "sync_running" }` while a batch runs |
| `GET /JellyfinMod/Placeholders/RestoreWatched` | The dry run of Restore Watched State From Retention History (P1.FU27): `{ dryRun: true, items: [{ entryId, title, seasonNumber, episodeNumber, userId, userName, itemId, playedAt }], kept, waiting, failures: [] }` (below). Changes nothing |
| `POST /JellyfinMod/Placeholders/RestoreWatched` | Puts back the marks the dry run lists, each checked again just before; answers the same shape with `dryRun: false` and the marks restored. A second call restores nothing |
| `GET /JellyfinMod/Placeholders/{libraryId}/Removal` | The dry run of Remove Placeholders: every placeholder of the plugin's in the library |
| `POST /JellyfinMod/Placeholders/{libraryId}/Remove` | Deletes them (each re-checked for the marker just before, unlinked by inode) and the season folders that left empty; the switch is not changed |

An unknown library, or one that is neither a movie nor a TV library, is 404. A plan:

```json
{ "libraryId": "…", "libraryName": "Shows", "enabled": false, "dryRun": true, "existing": 0,
  "writes": [{ "entryId": "…", "title": "Peep Show", "seasonNumber": 2, "episodeNumber": 1,
               "path": "/tv/Peep Show (2003)/Season 02/Peep Show (2003) S02E01.disc", "newFolder": true }],
  "removals": [{ "path": "…/Season 01/Peep Show (2003) S01E03.disc", "reason": "file_present" }],
  "skipped": [{ "entryId": "…", "title": "Peep Show", "seasonNumber": 8, "episodes": 6, "reason": "outside_library",
                "detail": "Season 08 leads outside the series folder." }],
  "failures": [] }
```

`removals[].reason`: `file_present` (a file for the episode is beside the stub), `on_disk` (the episode has a file elsewhere),
`not_listed` (TMDB no longer lists it), `not_aired` (its air date moved into the future), `unnumbered`, and `remove_all` for
Remove Placeholders. `skipped[].reason`: `read_only` (the series or season folder cannot be written: nothing is written there,
the mod's own cards and rows stay), `no_series_folder` (Jellyfin holds no file of the series; file-less series are P1.FU26),
`outside_library` (a season folder that is a link out of the series folder), `file_present` (a file, a user's own `.disc`
included, already reads as that episode), `importing` (the episode is being grabbed, downloaded or imported: an open import;
its file takes the placeholder's place, P1.FU25), `name_taken`, `unreadable`, `library_root_missing`. Which episodes: aired (air
date today or earlier; a reclaimed episode counts as aired), not specials, not on disk; unaired episodes keep the mod's own card
with their date. A stub counts for its episode wherever it is in the series' folder or its season folders (a reclaim leaves
it where the file was), and a file anywhere there that reads as the episode makes its stub stale (`file_present`).

**Movies and series with no file (P1.FU26).** In a movie library a plan writes, for each released movie of the catalog with
no file (release date today or earlier, or reclaimed; an unreleased one gets none and keeps the mod's own card), one placeholder
where its import puts the file: `<Title (Year) [tmdbid-N]>/<Title (Year) [tmdbid-N]>.disc` in the first library folder that can
be written, or in the folder of its TMDB id already there (`writes[].kind: "movie"`, season and episode 0). Its removals:
`on_disk` (the movie has a file), `not_released`, `not_listed` (no entry of its TMDB id in the library any more). In a TV
library a series with nothing on disk (no bound episode) gets its own folder, `<Series (Year) [tmdbid-N]>/Season NN/…`, in the
first writable library folder, with a placeholder per aired episode (`no_series_folder` now only for a series with files the
plugin cannot place). Adding a title (`POST /JellyfinMod/Entries`), loading a series' episode list and Refresh sync that one
entry at once; Jellyfin makes the items at its next look at the folder (its library monitor delay, a minute by default). The
movie's placeholder item is never bound: the entry stays not on disk and finds it by TMDB id. A series' placeholders make a
series item that reconciliation binds as the entry's series (not on disk); no entry is backfilled from a series of
placeholders alone. The import swaps a movie's placeholder for the file as for an episode (PHASE5); a reclaim of a movie's last
file in a folder of its own leaves the movie's placeholder there, named after the folder (Retention preview
`leavesPlaceholder`). `DELETE /JellyfinMod/Entries/{id}` of a title never imported removes its placeholders and the folders
that left empty (a series bound only to its placeholders' series item can be removed; its binding goes too).

**What a placeholder is.** A regular `.disc` file under 4 KB whose first line is `<!-- JellyfinMod placeholder v1 -->`,
followed by Kodi's stub message (`<discstub><title>…</title><message>Not downloaded yet. Open JellyfinMod to get it.</message>
</discstub>`). Only such files are ever treated as, or removed as, the plugin's; any other `.disc` is a user's and is left
alone. Each is written whole (a hidden temporary file, then `link(2)`, which never replaces a file), only inside a library root
and the series folder the entry's files are in. When Jellyfin creates or saves a placeholder item the plugin sets its
`DateCreated` to the air date and its runtime to TMDB's.

**Elsewhere in the plugin's API.** An episode in `GET /JellyfinMod/Entries/{id}` gains `placeholderItemId` (omitted when null):
the Jellyfin placeholder that stands for it while it has no file; its `state`, `availability` and `jellyfinItemId` stay those
of an episode without a file (reconciliation reads placeholder episodes as not on disk). `GET /JellyfinMod/Entries?jellyfinItemId=`
with a placeholder's id finds the series' entry. Since P1.FU26 the entry itself gains `placeholderItemId` on `GET
/JellyfinMod/Entries/{id}` and on Browse rows: the placeholder movie, or the series item of a series with no file;
`Entries?jellyfinItemId=` with a placeholder movie's id finds the movie's entry. `POST /JellyfinMod/Browse` answers such a title
as one `native` row (the placeholder item) carrying the entry with its state and `placeholderItemId`; no separate `entry` row is
drawn for it, and the state filter reads the entry's state (not `onDisk`) for it.

**`playableItemId` (P4.FU12).** An episode in `GET /JellyfinMod/Entries/{id}`, and the movie entry itself, gain `playableItemId`
(omitted when null): the Jellyfin item that plays the file once Jellyfin can play it, read from Jellyfin when the answer is built
(not from the stored availability). It is set when the bound item is no placeholder, has been refreshed, shows a video stream (or
none a probe grace after its refresh) and its owner, for a further version, is a real item; a further version is named by its owner
(the item a user opens). A listed but not yet refreshed file, a stale binding or a placeholder names none. Response-only: no
column, no migration. The web keeps an import's ring until the page has drawn this item (UX §3.3).

**Early library notification (P4.FU12).** When the plugin changes what a library holds (a delete repaired, placeholders written, an
import completed) it sends Jellyfin's own `LibraryChanged` WebSocket message straight to the users who have a session, within
250 ms of the first change of a batch, instead of leaving it to Jellyfin's 30 s batch, which still follows and is harmless. Each
user is sent only ids they may see: the library must be one of theirs, an added item must be visible to them, and a removed item
must pass their rating and tag rules by the rating and tags it had. It carries item ids only: no path, no torrent, no user data.

**Jellyfin's cached user data (P1.FU25 follow-up).** Jellyfin 12 keeps each user's data per item in memory and fills it from
list reads; a new item read before its first metadata refresh is cached as unplayed, and Jellyfin re-attaches the old item's
marks only at that refresh without updating the cache, so list answers (`/Items`, `/Shows/{id}/Episodes`) showed a swapped item
unplayed until a restart. After a new movie or episode's first refresh, when it then holds stored user data (only re-attached
data can be there), the plugin saves each such user's data again unchanged through `IUserDataManager`
(`UserDataSaveReason.UpdateUserData`), which replaces the cache entry. The plugin's retention listener ignores that save (no
completion is recorded); the Trakt plugin acts only on `TogglePlayed`.

**Restore Watched State From Retention History (P1.FU27).** For a movie or episode retention reclaimed (state `reclaimed`) whose
placeholder Jellyfin holds, each user the plugin's own completion record shows as having finished it (played, a completion date,
not revoked by an unwatched state) gets the placeholder marked played with the record's date (Jellyfin's last played date, else
when the completion began), through `IUserDataManager` with reason `UpdateUserData` under the plugin's quiet-save flag (no
retention completion, nothing sent by the Trakt plugin). Never automatic. Only where Jellyfin holds **no** user data row of that
user for the placeholder: data Jellyfin re-attached by key, or a mark or unmark the user made since, is left alone (`kept`); a
placeholder Jellyfin has not refreshed yet, or a reclaimed title with no placeholder item yet, is `waiting`. The completion record
is the only source; nothing is inferred. Each title restored gets a `watched_restored` history line.

**The swap (P1.FU25).** The import removes the episode's placeholders only after its file is linked, verified and recorded, and
before it asks Jellyfin to scan: from the series folder and every season folder in it, so a stub in another folder than the
file's goes too (that folder is reported to Jellyfin as well). Jellyfin swaps the items in the refresh and keeps the users'
played, favourite and date marks (by the item's user-data key). An import that stops before its link leaves the stub as it was;
a stub the import cannot remove (a permission) leaves the import complete, is logged once, and goes with the next sync
(`file_present`). After retention reclaims an episode's last file (a multi-episode file: every episode it held), the plugin
writes the episode's placeholder in the same folder, under the import's name, when the library shows missing episodes and the
folder can be written, and asks Jellyfin to look at the folder: the episode stays a Jellyfin item, with its marks. Only ever
written after the unlink is recorded, and nothing is deleted. A series whose every file was reclaimed keeps its folder for the
import and the sync (the entry's own series item).

**Stock endpoints, for every client** (an MVC filter registered by the plugin; it acts on the plugin's placeholders only,
whatever the switch says, and lets an answer through unchanged if it fails):

| Stock endpoint | For a placeholder |
| --- | --- |
| `GET /Shows/NextUp` | its slot holds the series' next real episode after the gap (P1.FU28): the first episode after the placeholder that is neither a placeholder nor virtual, with the placeholder's played state, specials left out, built as the stock answer with the request's `fields`, `enableImages`, `imageTypeLimit`, `enableImageTypes` and `enableUserData`, and only when the user may open it (library access, parental rating, tags); `enableResumable=false` leaves out a replacement with a position. With no such episode, or one already in the page, the slot is left out and `TotalRecordCount` lowered by one |
| `GET /UserItems/Resume` (and `/Users/{userId}/Items/Resume`) | left out, `TotalRecordCount` lowered by as many (a placeholder can carry the position of the file it stands in for) |
| `GET /Shows/{id}/Episodes` with `startItemId` | the placeholders after the start item are left out and `TotalRecordCount` lowered (P1.FU28): `startItemId` is what play-queue builders send (upstream web, Jellyfin for Android TV); the start item itself stays. Without `startItemId` (every season and series listing, `isMissing=false` included, which Swiftfin's season list sends) nothing changes |
| `GET /Items/Latest` (`UserLibrary.GetLatestMedia`) | left out |
| `GET/POST /Items/{id}/PlaybackInfo` | `200` with `ErrorCode: NotAllowed` and no media source |
| `GET /Items/{id}/Download`, `/Videos/{id}/stream*`, the HLS master, variant and segment routes | `404` |
| `POST /Sessions/Playing`, `/Progress`, `/Stopped`; `POST/DELETE /PlayingItems/{id}` (and the legacy `Users/{userId}/…` forms) | `204`, dropped: no report marks it played |
| any item answer (`BaseItemDto`) | `CanDownload: false` |
| `POST/DELETE /UserPlayedItems/{id}`, `/UserFavoriteItems/{id}` | unchanged: marking it played or favourite by hand works |

## Trakt indicator (Phase 7 Q16)

Health `Capabilities` adds `trakt.history`, and Health gains a `Trakt` block read from the host's own plugin list
(`IPluginManager`, plugin id `4fe3201e-d6ae-4f2e-8917-e12bda571281`, the stock `jellyfin-plugin-trakt`). Only an
`Active` copy counts; a copy disabled from the Dashboard, uninstalled or waiting for a restart reports
`Installed: false`. `Version` is included for administrators only; an ordinary user gets `{"Installed":true}`. The web
asks the item endpoint below only when `Installed` is true:

```json
"Trakt":{"Installed":true,"Version":"31.0.0.0"}
```

`GET /JellyfinMod/Trakt/Items/{itemId}` (any signed-in user; 401 anonymous or for an API key, 404 for an item that does
not exist or that the user cannot see, by the host's own visibility check) answers for the signed-in user only — the
user is read from authentication, never from the request:

```json
{"installed":true,"hasHistory":true,"lastSyncedAt":"2026-09-25T10:38:51.6106546Z"}
```

`hasHistory` means *watch history for this title arrived from Trakt for you*: JellyfinMod saw Jellyfin save this
user's data for the movie or episode with `UserDataSaveReason.Import` (what the Trakt plugin's `SyncFromTraktTask`
uses) while the Trakt plugin was active and the host was running that task (Jellyfin's NFO parser also saves with
`Import`; such imports are ignored), and the saved data was played or had a resume point. Rows go when their item
leaves the library or their user is deleted. A season or series
answers for its episodes the user can still see; `lastSyncedAt` is when that history last arrived (the newest episode's
for a season or series). An import that clears the history (Trakt reporting the title unwatched) removes it. Without
the plugin every visible item answers `{"installed":false,"hasHistory":false}` (a `null` `lastSyncedAt` may be omitted).
JellyfinMod never reads the Trakt plugin's configuration or tokens and never calls Trakt. Titles synced before the
plugin started observing show history after Trakt's next sync touches them. Data: table `TraktObservations`
(`UserId`, `JellyfinItemId`, `SeriesId`, `SeasonId`, `FirstSyncedAt`, `LastSyncedAt`; unique per user and item),
migration `PhaseSevenTraktObservations`. Design and evidence: [PHASE7.md §7.1.3](PHASE7.md#713-detecting-the-plugin-and-what-to-show).

## Ratings (Phase 9)

Display only (PHASE9 user decision 7): nothing in acquisition, automation or retention reads a rating. Health `Capabilities`
adds `ratings` (the reads below and `ratings[]` on entry detail), `ratings.cards` (`POST /Browse` takes `ratingSource`) and
`settings.ratings` (the administrator endpoints). Design, decisions and evidence: [PHASE9.md](PHASE9.md).

**One rating.** A source that has no value is absent, never `0` or `null`. Values stay in their own scale; nothing is
converted or combined.

```json
{"source":"imdb","value":8.1,"scale":"ten","votes":250000,"provider":"mdblist","fetchedAt":"2026-10-07T05:11:19.54Z","stale":false}
```

`source` is one of `imdb`, `tomatoes_critic`, `tomatoes_audience`, `tmdb`, `trakt`, `metacritic`, `metacritic_user`,
`letterboxd`, `rogerebert`, always in that order; `scale` is `ten`, `percent`, `five` or `four`; `provider` is `tmdb` (the
entry's own TMDB snapshot), `mdblist`, `host_omdb` or `host_tmdb` (read from the host's native item: `CriticRating`, and
`CommunityRating` labelled by whichever of OMDb and TheMovieDb comes first in the library's fetcher order); `votes` and
`fetchedAt` may be `null`; `stale` is true once `fetchedAt` is older than `refreshDays` (for a host value,
`fetchedAt` is the item's last metadata refresh). There is no `hundred` scale: a 0–100 value (TMDB through MDBList, the
Rotten Tomatoes and Metacritic scores) is `percent`, and a client skips a scale it does not know. There is no provider
link: the plugin never reads, stores or returns the `url` MDBList sends (a provider-written link can carry the caller's key
in its path or host; review 2026-10-07, round 2), and a database from the first Phase 9 build loses its stored links in
migration `PhaseNineRatingsIdentity`. One value per source:
`tmdb` prefers the snapshot, then MDBList, then the host; `imdb` and `tomatoes_critic` prefer MDBList, then the host.

**Reads (any signed-in user; 401 anonymous).**

- `GET /JellyfinMod/Entries/{id}` gains `ratings[]` (empty while ratings are off).
- `GET /JellyfinMod/Ratings/Items/{itemId}` — a native movie or series page: `{"entryId": "…" | null, "ratings": [...]}`.
  404 for an item the user cannot see (the host's own check); an episode or season answers `ratings: []`.
- `GET /JellyfinMod/Ratings/Defaults` — `{"enabled":true,"defaultSources":["imdb","tomatoes_critic","tomatoes_audience","trakt"],
  "availableSources":[…],"refreshDays":14}`, nothing about the key. `defaultSources` is the sources shown, in order (user
  decision 9, 2026-10-08: TMDB and the four optional sources off by default); migration `PhaseNineRatingsDisplayDefaults`
  moves a server still holding decision 6's exact list (`…,"tmdb","trakt"`) to it and keeps any other list
  ([PHASE9.md](PHASE9.md), design options 2).
- `POST /JellyfinMod/Browse` with `"ratingSource":"imdb"` (a known source; anything else 400): each row gains `rating` (one
  value) when it has one; without the field no row carries `rating`.

**Administrator only (403 for an ordinary user).**

- `GET /JellyfinMod/Settings/Ratings` — `{enabled, apiKeyConfigured, refreshDays, dailyBudget, defaultSources[],
  availableSources[], verified, verifiedAt, providerOverride, revision}`.
- `PATCH /JellyfinMod/Settings/Ratings` — any of `enabled`, `refreshDays` (1–365), `dailyBudget` (1–250,000),
  `defaultSources` (known, each once), `apiKey` (`{"action":"replace","value":"…"}`, `{"action":"clear"}` or
  `{"action":"unchanged"}`) and the required `revision` (409 when stale, 400 for an unknown field). The key goes to the
  `0600` secret store and is never returned; replacing it lifts an `unauthorized` block and closes a breaker a 429 opened.
- `POST /JellyfinMod/Settings/Ratings/Test` — one MDBList call for TMDB movie 278, counted in the budget:
  `{"ok":true,"code":"ok","message":"MDBList accepted the key and returned ratings.","sources":["imdb",…]}`; other codes
  `not_configured`, `unauthorized`, `rate_limited`, `unreachable`, `timeout`, `malformed`, `not_found`, and — with no
  call made — `budget_spent` and `breaker_open`; `database_busy` when the database stayed busy past the fetcher's bound
  (nothing was recorded; try again). A refused key may be tested (that is how a new one is proven); a pass
  marks the key verified only if the settings did not change during the call.
- `GET /JellyfinMod/Ratings/Status` — `{enabled, apiKeyConfigured, blocker, breaker:{open,until,reason,consecutiveFailures},
  budget:{day,used,limit}, lastRun:{startedAt,finishedAt,fetched,failed,stopReason}, entries, entriesWithoutRatings, queued,
  running}`. `running` is `null`, or the pass in progress: `{"kind":"daily"|"arrivals"|"setup"|"startup","startedAt":"…",
  "remaining":42}` (`remaining` counts the titles it still has before it, the current one included). `lastRun` is the last pass
  of any kind that had titles to fetch. `queued` counts manual refreshes waiting or running; it drops when a refresh has finished, which is what the web's
  Refresh ratings button waits for (at most a minute, each request with its own time limit) before reading the title again;
  a failed read is asked again, and a 403 or an answer without `queued` means the server will not say, never "finished".
- `POST /JellyfinMod/Entries/{id}/Ratings/Refresh` — 202 `{"queued":true}`; 409 with `type` `ratings_disabled`,
  `not_configured`, `unauthorized`, `breaker_open`, `budget_spent` or `queue_full` and a sentence in `title`; 404 for an
  entry the administrator cannot see.

**Automatic fetching (user decision 8, 2026-10-08).** Ratings do not wait for 04:00. A title that arrives — an entry created by
`POST /Entries` or by reconciliation (a library scan, the backfill), a file newly bound to an entry, a Phase 5 import completed
— wakes a background fetcher that runs one *arrivals* pass once arrivals have been quiet for 2 s (at most 30 s after the
first, however steady): every title never attempted, plus the arrived titles that are due by the rule below; the 14-day
refresh of other titles stays with the daily task. A key verified by `Settings/Ratings/Test`, and ratings switched on in
`PATCH Settings/Ratings` while a key is saved, start a *setup* run at once; a start with a key saved and no run ever
completed starts a *startup* run. Both fetch exactly what the daily task would. Nothing is fetched, recorded or adopted while
ratings are off, there is no key, the key is refused, the breaker is open or the budget is spent: those titles wait for the
daily task. One pass at a time: a trigger during a pass is folded into the next one, and every pass goes through the same
gate, claim, budget, breaker and credential gate as the daily task, so a settings save during a pass waits at most for the
one call out, as it does during the daily task. Saving a key does not start a run by itself (Test does), and raising the
budget does not either.

**Fetching.** The native task `JellyfinModRatingsRefresh` (daily, 04:00) calls `GET {base}/tmdb/{movie|show}/{tmdbId}?apikey=…`
once per title identity (every entry of the same TMDB title shares the answer, and the identity's latest attempt decides
whether it is due; a new entry of a known title adopts its siblings' values): titles never fetched first, then titles past
`refreshDays` or with a failed attempt older than a day, each group newest first, within `dailyBudget`, one call a second.
A title's attempt belongs to its identity, not to an entry: removing the entry being fetched keeps it, so the same title in
another library still waits out an interrupted attempt; a run forgets the attempt of a title no library holds once its
refresh window and failure wait have passed. An answer about the key rather than the title (refused, or the quota spent)
leaves the title due as soon as fetching may resume. The settings save and the fetcher share one gate: the fetcher's last
look at the settings, the key and the provider state happens under it after the pause between calls, and it holds it
through the call and the recording of its answer. So a save waits for a call already out (at most the 15 s call limit plus
the recording, which is bounded to about 8 s: a database that stays busy longer leaves the answer unrecorded, the claim
pending for the next run to count as interrupted, and the run stopped with `database_busy`), that call's answer is recorded
first and about the key it used, and no call starts after the save with what it replaced. The ratings save takes that gate
before the gate every settings save shares, so while it waits no other settings save waits on it;
turning ratings off, lowering the budget or replacing the key stops a running fetch at its next call, and replacing the key
lifts the refused-key block and closes a 429 breaker even when the old key's answer arrived during the save. 401/403 (or a
body naming a refused key) blocks fetching; 429 opens a breaker to the latest of `Retry-After` (however long: a delay in
seconds is read from the header's own digits, and one past the last representable moment ends there), `X-RateLimit-Reset` and
the next UTC day; five server errors, timeouts or malformed
answers in a row open a one-hour breaker; a 404 is `not_found`. Failures keep the stored values. An answer is malformed,
and changes nothing, when `ratings` is not a list or an item is not an object, has no string `source`, or a `value`,
`score` or `votes` of the wrong kind; `null`, `""` and `"N/A"` mean no value. `base` is MDBList's own
address unless the hidden XML field `RatingsProviderBaseUrl` points an isolated instance at a stand-in. Data: tables
`RatingsSettings`, `RatingsProviderStates`, `TitleRatings`, `RatingsFetches` (one row per title identity), migrations
`PhaseNineRatings` and `PhaseNineRatingsIdentity`.

## Missed watches to Trakt (Phase 13)

Health `Capabilities` adds `trakt.export`. Administrators only (`Policies.RequiresElevation`; 401 anonymous, 403 for an
ordinary user). JellyfinMod never calls Trakt: these endpoints report and start the stock Trakt plugin's own export task,
"Export library to trakt.tv" (`TraktSyncLibraryTask`), which sends each episode played in Jellyfin that has no play on
Trakt, with Jellyfin's `LastPlayedDate`.

`GET /JellyfinMod/Trakt/Export`:

```json
{"installed":true,"version":"33.0.0.0","minimumVersion":"33.0.0.0","autoExport":true,"running":false,
 "lastRun":{"status":"Failed","startedAt":"2026-10-28T08:41:02Z","endedAt":"2026-10-28T08:42:33Z"},
 "nextAttemptAt":"2026-10-28T08:57:33Z","failures":1,"quietMinutes":10,
 "users":[{"name":"oleksii","state":"linked","collections":true,"postWatched":true}]}
```

- `refusal` (omitted when none): `not_installed`, `old_plugin` (Trakt plugin older than `minimumVersion`), `unknown`
  (the plugin's task or settings could not be read), `no_users` (no account has a working sign-in, including when every account needs reconnecting), `unwatched_history`
  (a linked user has *Post unwatched history* on, so the export would remove Trakt plays). `unknown` also covers a
  Trakt plugin whose per-user settings lack a field JellyfinMod relies on or carry it with another type. While refused nothing runs by itself and the POST answers 409.
- `users`: the Jellyfin users the Trakt plugin holds a sign-in for, read-only from its settings in memory: `state` is
  `linked`, or `reconnect` when it has a refresh token but no access token (a refresh failed and the plugin skips the
  user until it is authorized again), with `since` (the token's expiry, UTC). Never a token value.
  Each also carries `userId` (for the Trakt plugin's own `POST /Trakt/Users/{userId}/Deauthorize`, which Disconnect calls:
  it revokes the sign-in and removes the plugin's entry for the user, so a new link starts from the plugin's defaults),
  and `traktUsername` and `avatarUrl` when the server has read them: one read-only `GET https://api.trakt.tv/users/settings`
  per account, once a day or when its link changes, with the token the Trakt plugin holds, which is read on the server
  only and never logged, stored or returned (D49). The browser loads the avatar from its Trakt address.
- `activity`: the last 20 export runs, newest first, kept in `trakt-activity.json` in the plugin's data folder: `startedAt`,
  `endedAt`, `status`, `clean`, `why` (`watch`, `reconnect`, `daily`, `retry`, `sync_now`, `first`; left out for a run
  JellyfinMod did not start), `episodesWatched`, `moviesWatched`, `episodesCollected`, `moviesCollected` (the stock plugin's
  own count lines in that run's log; left out when it logged none) and `error` (the Trakt error in a clause). `runningWhy`:
  while a run JellyfinMod started goes, why it started it. Each run's end is queued as the host reports it and judged by
  the background check, so two runs close together are both listed.
- `lastRun` is the host's last result of the task (omitted when it never ran). `lastRunConfirmed` is false when that run
  did not look clean, best effort: the host did not say Completed, or the Trakt plugin logged a Trakt error
  (`Trakt.ScheduledTasks.SyncLibraryTask`, `Trakt.Api.TraktApi`, ERR or FTL) in the host's file log while it ran (it
  completes its task even when Trakt refuses a write); null until JellyfinMod's background check has judged it
  (within a minute of its end; a status read never reads the log). Such a run is retried;
  `nextAttemptAt` and `failures` describe that retry (in memory: a restart judges the last run again from the log). The
  result only paces retries and tells the administrator: the stock export sends whatever Trakt lacks, so the next run
  repairs a missed one. With the switch on, the export also starts after episode plays, after a reconnect and daily.

`POST /JellyfinMod/Trakt/Export` starts the export now, or joins the run already going: 202 with the state above, or 409
`{"error":"<refusal>"}`. `PUT /JellyfinMod/Trakt/Export/Settings` `{"autoExport":bool}` turns the automatic export on or
off (plugin XML `TraktAutoExport`, default off) and answers the state. `TraktExportTestMinutes` (XML only, isolated test
instances) replaces the 10-minute quiet period and the first retry wait.

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
