# JellyfinMod API examples

Implementation contract as of 2026-09-16. These examples describe the Phase 3 source and the
accepted isolated test deployment. Production is outside this deployment. All IDs below are
illustrative.

All routes require Jellyfin authentication. Identity comes from the authenticated user, never
a submitted user ID. Entry IDs and native Jellyfin item IDs belong to different namespaces.
Inaccessible entry lookups return 404. Monitoring, removal, Keep, retention diagnostics and
manual retention runs require administrator elevation.

## Health

`GET /JellyfinMod/Health` retains the host's existing response:

```json
{"Name":"JellyfinMod","Version":"0.1.0.0","Ok":true}
```

The web adapter converts this to camelCase. All new plugin-owned DTOs below explicitly serialize
camelCase. Configuration XML and Jellyfin's global serialization settings remain host-owned.

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

## Monitoring and removal

`PATCH /JellyfinMod/Entries/{id}` and
`PATCH /JellyfinMod/Entries/{id}/Episodes/{episodeId}` accept `{"monitored":false}` and return
the updated Entry or Episode. They reject missing/null monitoring and unknown fields. Monitoring
does not trigger downloads in Phase 1. Ordinary users cannot invoke either operation.

`DELETE /JellyfinMod/Entries/{id}` returns 204 and removes the entry with its dependent catalog
records. It does not delete media. `deleteFiles=true` is rejected. There is no ordinary-user
Undo endpoint bypassing administrator-only removal.

## Discovery

`GET /JellyfinMod/Discover/Search?q=Example&type=movie&page=1`

`type` is `movie` or `series`; query length is 1–200 and page is 1–500. Optional
`targetLibraryId` chooses library scope. Without it, accessible libraries form the global scope.
Held native and plugin provider identities are excluded within that scope; content restrictions
also apply. Items use the Entry's `metadata` shape above.

An entirely excluded remote page can return `{"items":[],"nextPage":2}`. Follow `nextPage`
until it is null; an empty page alone is not the end. No unfiltered TMDB count is exposed as a
remaining-result total. Provider failures must leave no partially created catalog entry.

## Acquisition (Phase 4)

Every route below is administrator-only (`Policies.RequiresElevation`, P4.A1). Ordinary users get 403;
an administrator without access to the target library gets the concealed 404. Acquisition DTOs serialize
unknown values as explicit JSON `null`. The host's serializer writes GUIDs in compact form without dashes.

### Settings

`GET/POST /JellyfinMod/Settings/Indexers`, `PATCH/DELETE /JellyfinMod/Settings/Indexers/{id}`,
`POST /JellyfinMod/Settings/Indexers/{id}/Test`, and the same set for `DownloadClients` and
`QualityProfiles` (profiles have no Test). A PATCH must echo the current `revision` or it gets 409
`revision_conflict`. Unknown fields are rejected. Secrets are write-only (user decision 3):

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

`PATCH /JellyfinMod/Entries/{id}` also accepts `{"qualityProfileId": "<id>"}`. An explicit `null`
restores inheritance. Episodes inherit their series profile and reject the field.

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
    "eligible": true, "rejections": [], "seedRatio": 1.0, "seedMinutes": 2880
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

`GET/PUT /JellyfinMod/DownloadClients/{id}/PathMappings` replaces the ordered list
`{"pathMappings":[{"clientPathPrefix":"<client-download-dir>","localPathPrefix":"<test-root>/downloads"}],
"revision":3}`; the client's `revision` is bumped. The first matching prefix wins; a path that no
mapping and no `downloadDirectory`/`localDirectory` pair covers is `path_unmapped`.
`POST /JellyfinMod/DownloadClients/{id}/TestImportPath` with `{"clientPath":"…"}` maps the path, checks
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

`GET /JellyfinMod/Imports/{id}` returns one import operation (concealed 404 without library access).
`POST /JellyfinMod/Imports/{id}/Retry` (admin) re-inspects a `blocked` or `failed` import from the
start and answers 409 `import_not_retryable`, `import_open` or `grab_missing`.

`DELETE /JellyfinMod/Queue/{id}` (admin) with an optional body
`{"removeFromClient":false,"blocklist":false}` cancels an open import. With `removeFromClient`
the torrent and its data are removed from Transmission only if JellyfinMod added it (409
`torrent_not_owned`) and the seeding path is outside every library (409
`seeding_path_inside_library`); an unreachable client answers 503 `client_unreachable` and nothing
changes. `blocklist` stores the infohash so later searches reject it as `blocklisted`. Library
files are never deleted by this route. Other refusals: 409 `not_in_queue`,
`seed_release_in_progress`, `client_missing`.

`GET /JellyfinMod/Seeding` (admin) lists seed releases with their goal, the source of each goal
(`indexer`, `client`, `floor`), observed ratio and seeding time, `goalMetAt`, `logicalBytes` and
whether the library link is still present. Seed release states are `waiting`, `removing`,
`completed`, `blocked` and `cancelled`; reasons include `seed_goal_unmet`, `seeding_incomplete`,
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
library, and grabbing one answers 409 `held_quality`. An unknown `intent` is 400 `invalid_intent`.

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
