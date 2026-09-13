# Phase 1 API examples

Implementation contract as of 2026-09-13. These examples describe the current local server and
web code, not the deployed Phase 0 server. Live authentication, model binding and serializer
acceptance remain required before deployment. All IDs below are illustrative.

All routes require Jellyfin authentication. Identity comes from the authenticated user, never
a submitted user ID. Entry IDs and native Jellyfin item IDs belong to different namespaces.
Inaccessible entry lookups return 404. Monitoring and removal require administrator elevation.

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

Response shape is `{"entry": <Entry>, "history": [<History>], "episodes": [<Episode>]}`.
Movies return an empty episode array. A history object is:

```json
{"id":"33333333-3333-4333-8333-333333333333","entryId":"22222222-2222-4222-8222-222222222222","eventType":"added","summary":"Added to library","createdAt":"2026-09-08T00:00:00Z"}
```

An episode object contains `id`, `entryId`, `tmdbId`, `seasonNumber`, `episodeNumber`, `title`,
nullable `overview`, `stillPath`, `airDate`, `runtimeMinutes`, then `monitored`, `state` and
nullable `jellyfinItemId`. Dates are UTC ISO 8601. Season zero is specials; a future air date
distinguishes unaired episodes from missing aired media. A series binding does not make every
episode `onDisk`. Bound episodes must independently pass native visibility checks.

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
