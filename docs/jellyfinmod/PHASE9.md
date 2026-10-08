# Phase 9 — ratings and title enrichment

**Started 2026-10-07 on the user's explicit decision** (PLAN.md: Phases 8 and 9 are picked up only on an explicit later
decision; the user asked on 2026-10-07 to start Phase 9 now). Status: **built (not accepted)** until the Codex review
and the user's own checks pass; see *Status and handover* at the end. The outline below (2026-09-21) is kept as written;
the **task-level plan** that turns it into work follows it, written by the implementing agent (Opus 5.5, high) on
2026-10-07. Read [PLAN.md](PLAN.md), [README.md](README.md) §4–§5, [UX.md](UX.md) §3, §4, §7, §12 and §13,
[PHASE4.md](PHASE4.md) (secret store, user decision 3), [PHASE7.md](PHASE7.md) §3.2, §5, §7.1 and S8, and
[API.md](API.md#ratings-phase-9) alongside it. The two numbered decisions of 2026-09-21 and the answers to open
questions 2–4 of 2026-10-07 are the user's; open question 1 (the MDBList key) is still open. Nothing here authorizes a
third-party account, a key request or a production change.

The user asked for these ratings on a title: IMDb, TMDB, Trakt, Google, and Rotten Tomatoes with
**both** the critic and the audience score.

## Accepted user decisions — 2026-09-21

1. **MDBList is the ratings source.** One key, one provider. MDBList returns IMDb, TMDB, Trakt,
   Rotten Tomatoes critic **and** audience scores, and whatever else it carries (Metacritic,
   Metacritic user, Letterboxd, Roger Ebert) as a bonus the interface may show as optional
   sources. The design is one MDBList integration, not OMDb plus Trakt plus an aggregator stitched
   together. The host's existing OMDb plugin data remains a **fallback** for on-disk titles when
   MDBList is unconfigured or unreachable, because it is already installed and costs nothing to
   read.
2. **Google ratings are dropped entirely.** There is no public Google ratings API and the
   percentage in Google search results is not licensed for reuse; scraping it is not planned. The
   slot is removed from the design, with no substitute. If MDBList happens to supply another
   source, it is simply one more optional source the user can enable.

## Source by source — what can honestly be delivered

| Source | Where it comes from | What exists today | What this phase adds |
| --- | --- | --- | --- |
| **TMDB** | The plugin's own TMDB client already parses `vote_average` into `TmdbMetadata.communityRating` and stores the whole snapshot in `Entry.MetadataJson` for every entry, file-less included. The vote count is not parsed. | Stored, not shown; no vote count. | R1 confirms the snapshot value; R4 exposes it as the TMDB rating with `votes` added from the same TMDB response on the next refresh. MDBList also returns a TMDB score; the plugin's own value wins for TMDB because it is first-party. |
| **IMDb** | No free official API. MDBList returns the IMDb rating and vote count. The host runs Jellyfin's OMDb plugin (a `Jellyfin.Plugin.Omdb.xml` configuration exists on the acceptance instance); OMDb returns `imdbRating` and `imdbVotes` and the plugin writes what it writes onto the native item during metadata refresh. | Possibly on native items as `CommunityRating`; R1 checks through `GET /Items/{id}` whether the OMDb plugin populates it and whether votes survive at all on 10.11/12 items. File-less entries have no native item, so OMDb can never cover them. | Primary: MDBList `imdb`. Fallback (decision 1): the native item's `CommunityRating` when the host's metadata says OMDb supplied it, labelled as such. |
| **Rotten Tomatoes — critic** | No open public API. MDBList returns it (`tomatoes`). OMDb returns it too and the OMDb plugin writes `CriticRating` on native items. | Possibly on native items as `CriticRating` (R1 checks). | Primary: MDBList. Fallback: native `CriticRating`, on-disk titles only. |
| **Rotten Tomatoes — audience** | Not in OMDb. MDBList returns it (`audience`). Scraping the RT site is rejected: terms of service, layout fragility, rate limits. | Nothing. | MDBList only. **The audience score depends entirely on a third party**; when MDBList is unavailable it is absent, and the plan does not pretend otherwise. |
| **Trakt** | The Trakt API exposes a rating and vote count per title, but under decision 1 the value comes from MDBList's `trakt` source, so **no Trakt application key and no Trakt account credential are needed** for ratings. The stock Trakt plugin (PHASE7 §7.1) scrobbles watches; it has nothing to do with ratings and is not touched. | Nothing. | MDBList `trakt`. A direct Trakt integration is explicitly not planned; if the user later wants Trakt-specific data (their own rating, lists), that is a separate phase. |
| **Metacritic, Metacritic user, Letterboxd, Roger Ebert** | Returned by MDBList when it has them. | Nothing. | Optional sources, off by default, enabled per user (see UX). |
| **Google** | Dropped (decision 2). | — | Nothing. |

MDBList facts recorded on 2026-09-21 from its published limits page: a key is free with an
account; the free tier allows **1,000 requests per day**, paid tiers 10,000 to 250,000. The
endpoint shape (lookup by TMDB id or IMDb id for a movie or show, a `ratings[]` array with
`source`, `value`, `score`, `votes` per source, and whether a batch lookup exists) is what the
interactive documentation describes and is **recorded in R1 from a real call against a test
key**, not assumed here. MDBList is itself a cache of the providers' sites: its numbers can lag or
differ from what IMDb or Rotten Tomatoes show today, and the interface says so wherever a value is
displayed ("via MDBList, as of <date>").

## One rating model

```json
{ "source": "tomatoes_audience", "value": 92, "scale": "percent", "votes": 25000,
  "fetchedAt": "2026-09-21T10:00:00Z", "provider": "mdblist", "stale": false }
```

- `source` is a closed set: `tmdb`, `imdb`, `trakt`, `tomatoes_critic`, `tomatoes_audience`,
  `metacritic`, `metacritic_user`, `letterboxd`, `rogerebert`. Unknown MDBList sources are
  stored under their raw name with `provider: "mdblist"` and hidden until a release adds them.
- `scale` is `ten` (0–10, one decimal), `percent` (0–100, integer) or `five` (0–5, one decimal).
  Values are stored and shown **in their own scale**; nothing is converted, averaged or combined
  into a single number, because a 7.8/10 and a 92 % are not the same kind of fact.
- `votes` is null when the provider does not give it; `provider` is `tmdb` (first-party),
  `mdblist` or `host_omdb` (fallback read from the native item).
- A source that is missing is **absent** from the array, never `0`, never `null` in a slot: the
  interface renders only what exists.
- `fetchedAt` is always present and is shown with the value when it is older than the refresh
  window, so a stale score is never presented as current.

## Storage, refresh and degradation

- **Storage:** plugin SQLite (`TitleRating`: `EntryId`, `Source`, `Provider`, `Value`, `Scale`,
  `Votes?`, `FetchedAt`; `RatingsFetch`, one per title identity: `MediaType`, `TmdbId`, `AttemptedAt`, `Outcome`,
  `Error?` bounded and admin-only, `Manual`). No provider link is kept (review round 2, below). No synthetic `BaseItem`, no write to the host's
  items or metadata; the OMDb fallback is read-only.
- **When ratings are fetched:** never inline in a browse, search or detail request — reads are
  SQLite only. A native scheduled task `JellyfinModRatingsRefresh` (daily) fetches for entries
  without ratings (newest first) and re-fetches entries whose `FetchedAt` is older than
  `RatingsRefreshDays`, within a `RatingsDailyBudget` set below the key's tier (proposed default
  500 of the free 1,000, leaving headroom for a manual refresh) and a minimum interval between
  calls. A manual per-title refresh (administrator, open question 2) uses the same budget.
- **Provider failure:** 401 disables fetching with a visible blocker until the key is replaced;
  429 honours `Retry-After` and opens a breaker for the day; 5xx and timeouts open a one-hour
  breaker after five consecutive failures (the Phase 6 pattern); malformed bodies count as
  failures and change nothing. Existing rows are kept and shown with their `fetchedAt`.
- **Unconfigured, rate-limited or down:** ratings are simply absent — no spinner, no error toast,
  no placeholder zero — and browsing, search, detail and playback are unaffected. The TMDB value
  from the entry's own snapshot and the OMDb fallback still show where they exist, labelled by
  provider. A partial answer (for example no audience score) stores what arrived and nothing
  else.
- **Secrets:** the MDBList key lives in the existing plugin secret store (`0600`, write-only
  through `SecretChangeRequest`, presence reported as `apiKeyConfigured`), never in the XML
  configuration, a DTO, a log, history or a URL that is echoed back. Test secrets live only in
  the ignored `plugin/.env`.

## UX

- **Detail page.** One additive *Ratings* line in the metadata block of the entry and native
  detail pages, beside the stock star rating, which stays (UX Principle 0). Each enabled source
  is a short text chip: source name, value in its own scale, and the vote count when present;
  hovering or focusing shows "via <provider>, as of <date>". Sources the user disabled or that
  are absent are not rendered, so the line shrinks rather than showing dashes. On TV the line is
  read-only text, not a focus stop.
- **Cards.** Nothing new by default: the corners are allocated (UX §3.1) and card text is
  fixed. A per-user display preference *Show one rating on cards* (default off) may put a single
  chosen source in the card's secondary text (the 86 % line), and nothing else.
- **Choosing sources and order.** A per-user display preference in the fork's display settings
  (UX §12 places catalog view preferences there): an ordered list of enabled sources, initialised
  from an administrator default in the settings area. Proposed default: IMDb, Rotten Tomatoes
  critic, Rotten Tomatoes audience, TMDB, Trakt (open question 3).
- **Disagreement.** The settings text and the tooltip state that aggregator values can differ
  from a provider's own site, and the value never claims to be the provider's live number.
- **Degradation.** With the capability missing (old plugin) or ratings disabled, the line is
  absent; the page is otherwise identical.

## API contract (sketch)

All under `/JellyfinMod`; settings and refresh are administrator-only; reads follow the existing
access rules and the concealed 404.

| Endpoint | Contract |
| --- | --- |
| `GET/PATCH /Settings/Ratings`, `POST /Settings/Ratings/Test` | `{ enabled, apiKeyConfigured, refreshDays, dailyBudget, defaultSources[], revision }`; PATCH takes `apiKey: <SecretChangeRequest>`; Test makes one real call for a fixed well-known title and answers a code and a sentence (`unauthorized`, `rate_limited`, `unreachable`, `timeout`, `malformed`, `ok` with the sources returned). |
| `GET /Ratings/Status` (admin) | Budget used today, breaker state, last run counts, entries without ratings. |
| `POST /Entries/{id}/Ratings/Refresh` (admin) | Queues one fetch inside the budget (202); 409 when the breaker is open or the budget is spent. |
| `GET /Entries/{id}` (existing) | Gains `ratings[]` per the model, for every signed-in user with access; no provider errors are exposed to ordinary users. |
| `POST /Browse`, `GET /Entries` (existing) | Rows gain `ratings` only for the single source a card may show, when the server default or the request asks for it; otherwise nothing, so list payloads do not grow. |
| `GET /Health` | `capabilities` gains `ratings`. |

## Outline of the work

| ID | Task (all proposed) | Depends on | What acceptance must show |
| --- | --- | --- | --- |
| R1 | Decisions and spikes: real MDBList call shape with a test key, the TMDB snapshot value, what the host's OMDb plugin writes on native items, DTOs | — | A dated *R1 evidence* heading with the MDBList response fields, the `/Items/{id}` fields OMDb populated on a disposable title, and API.md entries |
| R2 | Data model, settings, secret handling, Test endpoint, Dashboard/settings-area section | R1 | Migration on a copy of the isolated database; save/read/restart; key never returned; ordinary user 403 |
| R3 | Fetcher, budgets, breaker, daily task, manual refresh | R2 | Boundary MDBList server counts one call per entry per window; 401, 429 (`Retry-After`), 5xx, timeout and malformed cases behave as documented; a killed run leaves no duplicate fetch |
| R4 | First-party TMDB value and votes; OMDb fallback read from native items, labelled | R1, R2 | A file-less entry shows TMDB only; an on-disk title with OMDb data shows IMDb and RT critic as `host_omdb` when MDBList is unconfigured, and MDBList values replace them when configured |
| R5 | API projection on detail, browse and list; access rules | R3, R4 | Real HTTP as admin, ordinary user, no-access user and anonymous |
| R6 | Web: detail ratings line, per-user source selection and order, tooltips, degradation | R5, X4 | Built browser, desktop, mobile, TV 1920×1080 and 1280×720 by D-pad; old plugin hides the line |
| R7 | Web: optional single-source card text behind the per-user preference (off by default) | R6 | Cards unchanged with the preference off; one source in the secondary line with it on; no new corner badge |
| R8 | Isolated acceptance: boundary provider, disposable titles with and without native items, restarts, budgets, leak check; production never contacted | R1–R7 | The full chain with every safeguard shown to stop it and no third-party call made by a test |

Commit scopes would be `docs(ratings,p9.r1)`, `feat(ratings,p9.r2-5)`, `feat(ratings,p9.r6-7)`,
`test(ratings,p9.r8)`.

## Acceptance conventions

- Tests never call MDBList, OMDb, TMDB or Trakt live: a real HTTP **boundary server per provider**
  scripts full, partial (no audience score), unauthorized, rate-limited with `Retry-After`,
  failing, slow and malformed responses. The single live call allowed in acceptance is the
  administrator's Test button, run once by hand and recorded by outcome, not by payload.
- Real host on the isolated instance for migrations, authentication, authorization, serialization
  and SQLite; built browser for the detail line, preferences and cards in every layout; physical
  webOS reported separately. No unit tests.
- Disposable titles only: one file-less entry, one on-disk title whose native item carries OMDb
  data (produced by the host's own metadata refresh against the OMDb boundary, or, if the host
  cannot be pointed at a boundary, by a disposable NFO with the same fields, documented). Every
  fixture removed at the end (PHASE7 decision 6).
- The leak check covers every ratings response and the log for the MDBList key.

## Entry gates (state on 2026-10-07)

Gate 1 is met (S8 accepted through S11); gate 2 is **not** met (no key) and the work proceeds against boundary servers by
the user's instruction of 2026-10-07; gate 3 is met by the R1 spike below.


1. Phase 7 S8 is accepted, so the ratings settings section and the per-user source preference
   have a home; until then R2 may land on the Dashboard plugin page without a second contract.
2. The user has supplied, or agreed to create, a free MDBList account whose key goes into the
   isolated instance's secret store (open question 1); no key is shared between instances.
3. R1's spike on the OMDb plugin's item fields is recorded, so the fallback promises only what the
   host actually stores.

## Risks

| Risk | Required response |
| --- | --- |
| MDBList changes its response or limits | Closed source set with raw-name storage for new sources; R1 records the real shape; budgets below the tier; every failure degrades to absent |
| Ratings shown as fresher or more precise than they are | `fetchedAt` stored and shown when stale; own scale per source; no aggregate number; "via MDBList" on every value |
| The daily task burns the whole quota on a large catalog | Budget below the tier, newest-first ordering, refresh window, breaker on 429 |
| Ratings start steering acquisition without a decision | Display only; scoring has no rating input unless open question 4 is answered yes, and then only as a bounded preferred contribution |
| Key leaks through settings, logs or URLs | Existing secret store, write-only DTOs, leak check in R8 |
| Cards gain clutter the TV rules forbid | No corner badge; one optional line behind a per-user preference, off by default |

## Open questions for the user

**2026-10-07:** questions 2–4 are answered — the user accepted the proposed defaults (see *Accepted user decisions —
2026-10-07* in the plan below). Question 1 (the key) is still open.

1. **The key.** Who creates the free MDBList account and supplies the key, and is the free tier
   (1,000 requests per day) enough for the catalog's size and refresh cadence, or is a paid tier
   wanted? The key goes into the plugin's `0600` secret store, write-only. Consumed by gate 2, R2
   and R3.
2. **Refresh.** How often should ratings refresh (proposed: every 14 days per title, newest
   titles first, within the daily budget), and should an administrator be able to refresh one
   title by hand from the detail page (proposed: yes)? Consumed by R3.
3. **Default sources and order.** Proposed default: IMDb, Rotten Tomatoes critic, Rotten Tomatoes
   audience, TMDB, Trakt; Metacritic, Metacritic user, Letterboxd and Roger Ebert available but
   off. Consumed by R2 and R6.
4. **Acquisition.** May ratings ever influence release scoring or automation (proposed default:
   **no**, display only)? Consumed by R5 and, if yes, Phase 12's rule model.

---

# Task-level plan (2026-10-07)

Written by the implementing agent (Opus 5.5, high) before implementation. Branches: plugin `jellyfinmod-phase9` from
`master` `abeffb7`, web `jellyfinmod-phase9` from `jellyfin-mod` `95709dc6ca`. The plugin version stays **0.1.0.0**.

## Accepted user decisions — 2026-10-07 (open questions 2–4)

The user confirmed the proposed defaults on 2026-10-07: *"Proposed defaults for questions 2–4 are fine"*.

5. **Refresh** (open question 2): every **14 days** per title, **newest titles first**, within the daily budget. An
   administrator can **refresh one title by hand** from its detail page, inside the same budget
   (`refreshDays`; `POST /Entries/{id}/Ratings/Refresh`).
6. **Default sources and order** (open question 3): **IMDb, Rotten Tomatoes critics, Rotten Tomatoes audience, TMDB,
   Trakt**; Metacritic, Metacritic users, Letterboxd and Roger Ebert available but off (`defaultSources`, initialising
   each user's own choice). **The list is superseded by decision 9 (user, 2026-10-08): IMDb, RT critics, RT
   audience and Trakt; TMDB off too** (see *design options 2*, below).
7. **Display only** (open question 4): ratings never influence release scoring, automation or retention; no code path
   outside the ratings projection reads `TitleRatings`.

**Still open — question 1, the key.** No MDBList key has been supplied. Everything is built and accepted against a real
HTTP boundary MDBList server; the single live call — the administrator's **Test** button with the user's own key — is
left for the user. The budget default is **500** of the free tier's 1,000 a day (`dailyBudget`), a setting.

## Decisions taken in this plan (agent, from the R1 spike; reviewable)

1. **MDBList call shape.** `GET {base}/tmdb/{movie|show}/{tmdbId}?apikey=<key>` with `Accept: application/json`; the
   key is a query parameter, as MDBList's published clients send it. Response fields read: `ratings[]` with
   `source`, `value`, `score`, `votes`, `url`; `ids.tmdb` checked against the requested id when present. Rate-limit
   headers `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` (Unix seconds) and `Retry-After` are read
   on 429. The shape comes from MDBList's public clients and documentation (R1 evidence) and is **still to be confirmed
   with the user's key** through the Test button; the boundary server serves exactly this shape.
2. **Source map.** MDBList `imdb`→`imdb` (ten), `tmdb`→`tmdb` (percent above 10, else ten), `trakt`→`trakt`
   (percent), `tomatoes`→`tomatoes_critic` (percent), `popcorn` (and `audience`)→`tomatoes_audience` (percent),
   `metacritic`→`metacritic` (percent), `metacriticuser`→`metacritic_user` (ten), `letterboxd`→`letterboxd` (five),
   `rogerebert`→`rogerebert` (**four**: Roger Ebert's stars are out of four). Any other name is stored raw
   (lower-case, `[a-z0-9_]`, at most 32) with scale `unknown` and is never exposed. A value outside its scale, a null
   value, and a zero with no votes are treated as absent. **Deviation:** the outline's scale set gains `four`.
3. **Host fallback is what the host actually stores (gate 3).** Jellyfin 12's OMDb provider writes `CriticRating`
   (Rotten Tomatoes critics) and `CommunityRating` (IMDb) and **no vote count** (`VoteCount` is commented out in
   `OmdbProvider.cs` at `v12.0`); its address is hard-coded (`https://www.omdbapi.com`), so the host cannot be pointed
   at a boundary. The first remote provider in a library's fetcher order wins `CommunityRating`
   (`MetadataService.MergeBaseItemData`, `replaceData` false). On the isolated instance both libraries run
   **TheMovieDb before The Open Movie Database**, so the native `CommunityRating` is **TMDb's** value (three decimals,
   for example 8.082), not IMDb's. The fallback therefore reads, for a title's bound native item:
   `CriticRating` → `tomatoes_critic` / `host_omdb` when OMDb is an enabled fetcher for that item type;
   `CommunityRating` → `imdb` / `host_omdb` when OMDb is enabled and ordered before TheMovieDb, else `tmdb` /
   **`host_tmdb`** when TheMovieDb is enabled. **Deviation:** the provider set gains `host_tmdb`. A local NFO can also
   set these fields and is indistinguishable; that limit is stated in the tooltip ("from this server's metadata").
4. **TMDB first-party value.** The entry's own TMDB snapshot (`MetadataJson.communityRating`) wins for `tmdb`; the
   snapshot now also stores `voteCount` (parsed from the same TMDB response from now on; older snapshots have none).
   Entries created by native backfill have no TMDB score in their snapshot, so for them `tmdb` comes from MDBList, then
   from the host. No new TMDB call is made for ratings.
5. **Precedence per source.** `tmdb`: snapshot (`tmdb`) > `mdblist` > `host_tmdb`; `imdb`, `tomatoes_critic`:
   `mdblist` > `host_omdb`; all others: `mdblist` only. One value per source in every response.
6. **Where the boundary is set on an instance.** A hidden XML field `RatingsProviderBaseUrl` (not on any page, like
   `RetentionTestWindowMinutes`), honoured only for an absolute `http(s)` URL without credentials, query or fragment;
   empty means `https://api.mdblist.com`. Integration hosts use a DI `RatingsEndpoint`. Administrators can already
   install code on a Jellyfin server, so this adds no new trust; the settings DTO reports `providerOverride: true`
   whenever it is set so it is never silently left on.
7. **The key in the URL.** MDBList takes the key as a query parameter, so the plugin never logs a request URL, and
   relies on .NET 10's `IHttpClientFactory` logging, which redacts URI query strings; the integration suite captures
   every log line at Debug (the factory's own request logs included) and leak-checks it, and R8 checks the host log.
8. **Per-user preferences live in Jellyfin's per-user display preferences** (upstream `userSettings`, server-side
   `CustomPrefs`, keys `jfmodRatingsSources` and `jfmodRatingsCardSource`), edited on a new **mod route
   `catalog/preferences`** ("Ratings display"). **Deviation from UX §12's "the fork's display preferences":** that page is
   upstream's legacy `mypreferencesdisplay`; editing it would add an upstream patch row. The route is reached from the user
   menu (one more item in the already-patched `AppUserMenu.tsx`, the existing permanent §3.2 row) and, on the TV, from a
   link under Home beside the administrator's settings link (mod-owned `TvSettingsLink`).
9. **Placement on the detail page.** Entry (file-less) page: the line renders beside the TMDB star in
   `.itemMiscInfo-secondary`, which the mod already fills, in the same paint as the rest of the entry. Native page: the
   answer arrives after the page is focused, so the line leads `.detailSectionContent` (above the Trakt line), below the
   button row a TV's focus starts on — UX §13 rule 2, nothing arrives above the focus ring. **Deviation** from "beside the
   stock star rating" on native pages only; the stock star stays where it is.
10. **Cards (R7) apply to the combined browse grid** (`POST /Browse` rows with an entry), which every Movies/TV grid
    with file-less entries or a File filter uses. Upstream's native-only grid (a library with no file-less entries),
    Home rows and search results are unchanged. `GET /Entries` does not gain the card value (no surface reads it).
11. **Settings home.** The ratings section is added to the S8 settings area (React); the Dashboard `configPage.html` is
    not extended (S8 superseded it; entry gate 1 is met by S8/S11's acceptance).

## Tasks

### R1 — spikes, DTOs and API.md (docs)

- MDBList call shape from public documentation and clients; OMDb and merge behaviour from Jellyfin `v12.0` source; the
  isolated instance's fetcher order and native rating fields read through `GET /Library/VirtualFolders` and
  `GET /Users/{id}/Items` (read-only); the TMDB snapshot's `communityRating` across the instance's entries.
- Record a dated *R1 evidence* section here and an API.md *Ratings (Phase 9)* section.
- Done when: both are written and the decisions above cite them.

### R2 — data model, settings, secret, Test

- Migration `PhaseNineRatings`: `RatingsSettings` (singleton: `Enabled` default true, `ApiKeyRef`, `RefreshDays` 14,
  `DailyBudget` 500, `DefaultSources` JSON, `Revision`, `VerifiedRevision`, `VerifiedAt`), `RatingsProviderStates`
  (singleton runtime: `Blocker`, `BreakerUntil`, `BreakerReason`, `ConsecutiveFailures`, `BudgetDay`, `BudgetUsed`,
  last-run counters), `TitleRatings` (`EntryId` FK cascade, `Source`, `Provider`, `Value`, `Scale`, `Votes?`,
  `FetchedAt`, `Url?`; unique on `EntryId, Source, Provider`), `RatingsFetches` (one row per entry: `EntryId` FK
  cascade unique, `AttemptedAt`, `Outcome`, `RetryAfter?`, `Error?` bounded to 200 characters, `Manual`). Superseded by
  migration `PhaseNineRatingsIdentity` (review round 2, below): `TitleRatings.Url` is dropped, and `RatingsFetches` is one
  row per title identity (`MediaType`, `TmdbId` unique, no entry foreign key, no `RetryAfter`), keeping each title's
  latest attempt.
- `GET/PATCH /JellyfinMod/Settings/Ratings` (administrator; revisioned under `SettingsMutationGate`; `apiKey` is a
  `SecretChangeRequest`; unknown fields 400; history `settings_changed` with area `ratings`), `POST
  /Settings/Ratings/Test` (one call for TMDB movie 278; codes `ok`, `not_configured`, `unauthorized`, `rate_limited`,
  `unreachable`, `timeout`, `malformed`, `not_found`; `ok` lists the sources returned). Replacing the key clears an
  `unauthorized` blocker. `GET /JellyfinMod/Ratings/Defaults` (any signed-in user): `{enabled, defaultSources,
  refreshDays}` so the web can initialise a user's preference.
- Health capabilities `ratings`, `ratings.cards`, `settings.ratings`.
- Acceptance: migration on a copy of the isolated database (rows kept, integrity ok); save → read → restart → read;
  the key never in a response, a log line or history; ordinary user 403, anonymous 401.

### R3 — fetcher, budget, breaker, daily task, manual refresh

- `MdbListClient` (named client `NamedClient.Default`, 15 s timeout, never logs a URL), `RatingsRefreshRunner` under a
  process-wide gate, `RatingsRefreshTask` (`JellyfinModRatingsRefresh`, daily at 04:00), `RatingsRefreshQueue` (hosted
  reader for manual refreshes).
- Due rule, per title identity (every entry of the same TMDB title; its latest attempt decides): never attempted, then
  stored ratings older than `RefreshDays` or a failed attempt older than one day — each group **newest `AddedAt` first**
  (decision 5; corrected 2026-10-07 from "oldest first", which the code never followed). The attempt is the identity's
  own row (review round 2), so a new entry of a title already fetched shares it and adopts its siblings' values instead of
  counting as never attempted, and removing the entry being fetched does not lose it. A claim row (`Outcome = pending`) and the budget increment commit **before** the
  call; a pending claim older than ten minutes counts as a failed attempt (a killed run never fetches the same entry
  again that day). Minimum interval between calls 1 s (integration hosts shorten it).
- Failures: 401/403 → blocker `unauthorized`, all fetching stops until the key is replaced or Test passes; 429 →
  breaker until the later of `Retry-After`/`X-RateLimit-Reset` and the next UTC day; 5xx, timeout, unreachable and
  malformed → after five in a row a one-hour breaker; 404 → `not_found`, retried after `RefreshDays`. Malformed bodies
  change no rating. A successful fetch replaces that entry's `mdblist` rows with what arrived (a partial answer stores
  only what arrived; an earlier source missing now is removed).
- `POST /Entries/{id}/Ratings/Refresh` (administrator): 202 queued; 409 `ratings_disabled`, `not_configured`,
  `unauthorized`, `breaker_open`, `budget_spent`; 404 for an entry the administrator cannot see. `GET /Ratings/Status`
  (administrator).
- Acceptance: the boundary server counts one call per entry per window; 401, 429 with `Retry-After`, 5xx, timeout and
  malformed behave as above; a killed run leaves no duplicate fetch.

### R4 — first-party TMDB and host fallback

- `TmdbClient` parses `vote_count` into the snapshot (`voteCount`). `HostRatingsReader` reads the bound native item and
  its library's type options per decision 3; read-only, no write to the host.
- Acceptance: a file-less entry shows TMDB only; an on-disk title with host data shows `tomatoes_critic` as `host_omdb`
  (and `tmdb` as `host_tmdb` on this instance's fetcher order) while MDBList is unconfigured, and MDBList values replace
  them once configured.

### R5 — API projection and access

- `GET /Entries/{id}` gains `ratings[]`; `GET /JellyfinMod/Ratings/Items/{itemId}` (any signed-in user; 404 for an item
  the user cannot see, the host's own check; movie and series only) for native detail pages, with or without an entry;
  `POST /Browse` takes `ratingSource` (a known source) and each row gains `rating` (one value or null) only then.
  `ratings` is empty while ratings are disabled. Ordinary users never see provider errors, budgets or breakers.
- Acceptance: real HTTP as administrator, ordinary user, a user without access to the library, and anonymous.

### R6 — web: detail line, per-user sources, tooltips, degradation

- `RatingsLine` (chips: short source name, value in its own scale, votes when present; `title`/`aria-label` "via
  MDBList, as of …" / "via TMDB" / "from this server's metadata"; the date shown in the chip when stale; not focusable
  on TV, focusable for its tooltip elsewhere), `NativeRatingsLine` (own mount, gated on `ratings`), admin **Refresh
  ratings** button on both pages, `catalog/preferences` page (sources on/off and order, card source; D-pad operable).
- Acceptance: built browser, desktop, mobile, TV 1920×1080 and 1280×720 by D-pad; a plugin without `ratings` hides the
  line and the menu item.

### R7 — web: one rating on cards

- The Browse request carries `ratingSource` only when the user chose a card source and the plugin lists
  `ratings.cards`; `EntryCard` appends the value to the secondary text line (or adds one secondary line when the card
  shows none). No corner badge, no new focus stop.
- Acceptance: cards unchanged with the preference off (no `ratingSource` sent, no rating rendered); one source with it on.

### R8 — isolated acceptance

- Plugin suite `tests/PhaseNineRatingsIntegration` (real Kestrel, auth, MVC serialization, EF migrations, SQLite and a
  real HTTP MDBList boundary server) plus every existing suite.
- Live on `jellyfinmod-test` (18096): a Node MDBList boundary on the Docker network gateway, set through
  `RatingsProviderBaseUrl`; one disposable file-less entry and one disposable on-disk title with an NFO carrying
  `<rating>`/`<criticrating>` in a disposable library; budgets, breaker, restart, leak check of every ratings response
  and the container log; browser runner `scripts/jellyfinmod-e2e/p9-ratings.mjs` on Playwright Chromium and real
  Google Chrome in every layout. Every fixture removed (library through `DELETE /Library/VirtualFolders`, entries,
  ratings rows, the override and the key) and proven with `GET /UserViews`.

---

## R1 evidence — 2026-10-07

Opus 5.5, high. Read-only on the isolated instance (18096, plugin `11f0a67`-era build at the time); no third-party call.

**MDBList (from public sources; still to be confirmed with the user's key).** `api.mdblist.com/docs` and the Apiary
documentation did not render for the fetch tool (an empty page and a 502), so the shape was taken from two maintained
public clients and is recorded as such: the Go client `luckylittle/mdblist-cli` (`internal/client/mdblist.go`,
`types.go`) and the Jellyfin plugin `Druidblack/Jellyfin.Plugin.MDBList_Ratings` (`Ratings/MdbListClient.cs`,
`Models/MdbListModels.cs`, `RatingsUpdater.cs`). Both agree:

- Base `https://api.mdblist.com`; the key is the query parameter `apikey` on every call.
- Title lookup `GET /{provider}/{mediatype}/{id}` with provider `tmdb`, `imdb`, `trakt` or `tvdb` and media type `movie`
  or `show`; a batch form `POST /{provider}/{mediatype}` with `{"ids":[…]}` exists (not used: one call per title keeps
  claims and budgets per entry exact). `GET /user` reports `api_requests` and `api_requests_count`.
- Response: `title`, `year`, `type`, `ids` (`imdb`, `tmdb`, `trakt`, `tvdb`, `mal`), `score`, `score_average` and
  `ratings[]`, each `{source, value, score, votes, url}`; `value` is the provider's own number (a number, sometimes a
  string, sometimes null), `score` MDBList's 0–100 normalisation, `votes` an integer or null.
- Source names: `imdb`, `tmdb`, `trakt`, `tomatoes` (Rotten Tomatoes critics), `popcorn` (Rotten Tomatoes audience;
  the outline's "`audience`" is accepted as an alias), `metacritic`, `metacriticuser`, `letterboxd`, `rogerebert`,
  `myanimelist`.
- Rate limiting: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` (Unix seconds) on responses and 429
  when the quota is spent. The second client removes `IHttpClientFactory`'s request loggers because the key travels in
  the URL; this plan relies on .NET 10's query redaction instead and proves it in the suite (decision 7).
- **Unconfirmed until a real call:** the exact status and body MDBList returns for a bad key (401/403, or a 200 with an
  `error` field — both are handled as `unauthorized` when the body names the key) and for an unknown title (404, or a
  200 without `ratings` — handled as `not_found` and `malformed` respectively), and whether `tmdb`'s `value` is on a
  ten or a hundred scale (both are accepted, decision 2: a value above 10 is read as `percent`, so there is no separate
  hundred scale). The Test button reports which code the real service gave.

**OMDb and the host's merge (Jellyfin `v12.0` source, `MediaBrowser.Providers`).** `Plugins/Omdb/OmdbProvider.cs`:
`item.CriticRating = GetRottenTomatoScore()`, `item.CommunityRating = imdbRating`, and `// item.VoteCount = voteCount;`
— no vote count survives; the URL is the constant `https://www.omdbapi.com?apikey=…`, so the host cannot be pointed at
a boundary (the outline's NFO alternative applies in R8). `Plugins/Tmdb/Movies/TmdbMovieProvider.cs` and
`TV/TmdbSeriesProvider.cs` set `CommunityRating = VoteAverage` and never `CriticRating`. `Manager/MetadataService.cs`
merges remote results with `replaceData = false`, so the first provider in the fetcher order that has a value wins
(`if (replaceData || !target.CommunityRating.HasValue)`, likewise `CriticRating`); a local NFO is merged before them.

**The isolated instance** (`evidence/p9/r1-spike-instance.txt`): both libraries order **TheMovieDb before The Open
Movie Database** for movies and series; 157 of 159 titles carry `CommunityRating`, 37 of them with more than one
decimal (TMDb's `vote_average`, for example *20 Days in Mariupol* 8.082) — so on this host `CommunityRating` is TMDb's,
not IMDb's; 35 carry `CriticRating` (Rotten Tomatoes critics, only OMDb writes it, for example 100). `BaseItemDto` has
no vote count. Of 160 catalog entries only the 2 added through TMDB discovery carry a TMDB score in their snapshot; the
158 created by native backfill carry none (decision 4).

**DTOs.** One rating: `{source, value, scale, votes, provider, fetchedAt, stale}` (the `url` field was removed in review
round 2) with `scale` in `ten`,
`percent`, `five`, `four` (there is no `hundred`: a 0–100 value is `percent`; the web skips any other scale); `provider`
in `tmdb`, `mdblist`, `host_omdb`, `host_tmdb`; `stale` true when `fetchedAt` is older than `refreshDays` (a host value's
`fetchedAt` is the item's last metadata refresh). API.md *Ratings (Phase 9)* records every endpoint as built.

## R2–R8 evidence — 2026-10-07

Opus 5.5, high. Plugin `jellyfinmod-phase9` (`abeffb7..612d557`; the code as deployed and tested is `0060c32`, the last
commit is the README), web `jellyfinmod-phase9` (`95709dc6ca..` this branch's tip). Deployed to the isolated instance only (`jellyfinmod-test`, 18096): plugin 0.1.0.0 built from `0060c32`, serving web
bundle `619599d6e666` at `/web-mod/` (the web root there is read-only, so `/web` keeps the host's own build). Production
was never deployed to, restarted or contacted. Nothing called MDBList, OMDb, TMDB or Trakt: every ratings call went to the
MDBList stand-in (`scripts/jellyfinmod-e2e/standins/mdblist.mjs`) on the isolated instance's Docker network, set through the
hidden XML field `RatingsProviderBaseUrl`, with a generated fixture key that was never printed and was deleted afterwards.

**Suites.** `tests/PhaseNineRatingsIntegration` (new; real Kestrel, authentication, authorization, MVC serialization, EF
migrations and SQLite; a real HTTP boundary answering as MDBList and TMDB; simulated host services: Jellyfin's users,
library roots and item store, as in every plugin suite) — **120 checks pass** on the workstation, including the migration
of a copy of the isolated instance's database taken before the deployment (six pending migrations, every row kept, integrity
and foreign keys clean): `evidence/p9/suite-phase-nine-mac.txt`. **Suites on the test host** (offline .NET 10 SDK container, plugin
source at `0060c32`, `evidence/p9/suites-pi/`): all **14** pass — Phase 0 and 1 smoke, Phase 2, 3, 3-protection, 4 (as root),
5, 6, the S7 settings, S9 Prowlarr, takeover (with this branch's `jellyfinmod-web.zip`), Q16 Trakt, Phase 10 retention and
Phase 9 ratings. Phase 5 failed its first run only because that runner did not pass the bind-mount aliases the earlier Pi
runners give it (`JFMOD_ALIAS_A/B`); with them it passed.

| Row | What acceptance had to show | Result | Evidence |
| --- | --- | --- | --- |
| R1 | MDBList fields, OMDb fields on native items, API.md | Recorded above; API.md *Ratings (Phase 9)* | R1 evidence, `r1-spike-instance.txt` |
| R2 | Migration on a copy of the isolated DB; save/read/restart; key never returned; ordinary user 403 | **Passed.** Suite: migration on the released schema and on the instance copy; revision 409, unknown field 400, Google refused; key in the `0600` store only, never in a response, a log line or history. Live: defaults, key saved write-only, stale revision 409, Test against the stand-in `ok`, a restart keeps settings, key and ratings, ordinary user 403 on settings, status, Test and refresh, anonymous 401 | `suite-phase-nine-mac.txt`, `live-results.json` (`unconfigured`, `configure`, `restart`) |
| R3 | One call per entry per window; 401, 429, 5xx, timeout, malformed; a killed run leaves no duplicate fetch | **Passed, with one refinement:** one call per **title identity** per window (the instance holds 172 entries for 166 titles; entries in two libraries share one answer). Live: the daily task through Jellyfin's task manager made 166 calls for 166 titles, all with the key, newest first; a second run made none; a spent budget stopped the task and refused a manual refresh; a manual refresh fetched once; 401 and a key-error body blocked fetching and kept values, a new key or a passing Test lifted it; 429 opened the breaker to the next UTC day and a new key closed it; malformed and timeout counted as failures, not-found did not; five 503s opened the one-hour breaker; a container killed (SIGKILL) mid-call left its committed claim, which the next start counted as interrupted, and the title was not fetched again | `live-results.json` (`fetch`, `failures`, `kill`), suite |
| R4 | File-less entry TMDB only; on-disk title shows host data as `host_omdb` unconfigured, replaced by MDBList when configured | **Passed.** A file-less entry showed TMDB 8.7 from its own snapshot only; a disposable on-disk title (NFO `<rating>7.4</rating>`, `<criticrating>87</criticrating>`, `<lockdata>true</lockdata>`, so the host ran only local providers: `fixture-providers.txt`) showed RT critics 87 as `host_omdb` and 7.4 as TMDB (`host_tmdb`, TheMovieDb first); with OMDb ordered first the same value read as IMDb (`host_omdb`, no votes); after the first run every value came from MDBList, with TMDB staying first-party where the snapshot has one | `live-results.json` (`unconfigured`, `fetch`) |
| R5 | Real HTTP as admin, ordinary user, no-access user, anonymous | **Passed.** A temporary viewer (Movies and Shows only, created and deleted by the run) read ratings of a title it can see without any provider state, got 404 for the disposable library's item and entry, and 403 on every administrator endpoint; anonymous 401; Browse rows carry `rating` only with `ratingSource` | `live-results.json` |
| R6 | Built browser on desktop, mobile, TV 1920×1080 and 1280×720 by D-pad; old plugin hides the line | **Passed in Playwright Chromium 153.0.8010.12 (39/39) and real Google Chrome 153.0.8010.54 (39/39).** Native and file-less pages, chips in the user's order with votes and "via MDBList, as of …"; the line leads the detail section and is never a focus stop; Refresh ratings; Ratings display from the user menu and, on the TV, from the Home link by Down alone, Enter toggles, the remote's Back (461) leaves; the choice is stored in the user's Jellyfin display preferences; settings section with Test; a Health without the ratings capabilities hides the line, the menu item and the card field; ratings turned off hide the line; no page errors; no browser-received response carries the key | `browser-results.json`, `browser-chromium.txt`, `browser-chrome.txt`, `shots/` |
| R7 | Cards unchanged with the preference off; one source in the secondary line with it on; no corner badge | **Passed** in both browsers: off sends no `ratingSource` and renders nothing; IMDb chosen puts "· IMDb 8.1" in each card's secondary text line, no badge, no focus stop | same |
| R8 | The full chain with every safeguard shown to stop it; no third-party call by a test | **Passed** on the isolated instance as above; fixtures removed (below) | all of `evidence/p9/` |

`live-results.json` keeps every attempt, failures included: an early cleanup could not remove the fixture entries through
`DELETE /JellyfinMod/Entries` (see *Findings*), one leak check was reworded once it was clear the host writes no HTTP client
log lines at its level, and the `failures` step was re-run in full after a runner typo stopped the first run at its last check.
The browser and live runs found three defects that are fixed in this branch: cards never asked for a rating on a grid mounted
right after sign-in, the card rating looked for the wrong footer element, and a turned-off line stayed for up to five minutes.

**Cleanup, proven.** The disposable library was removed through `DELETE /Library/VirtualFolders`, its media and NFOs deleted,
the temporary viewer deleted, the fixture key cleared from the secret store, the stand-in address removed from the XML, every
stored rating, attempt and ratings setting removed with the service stopped (no API deletes ratings), the three fixture
entries removed the same way (foreign keys on), oleksii's two display-preference keys removed, and the stand-in stopped.
`GET /Users/{oleksii}/Views` then listed only Movies and Shows; no *JellyfinMod P9* title is left; ratings settings are fresh
defaults (on, no key, no override). The daily task stays registered and, with no key, calls nothing.

### Deviations from the outline, and why

- `four` joins the scales (Roger Ebert is out of four) and `host_tmdb` joins the providers (on this host the native
  `CommunityRating` is TMDb's, R1).
- One call per title identity rather than per entry (R3 above).
- Per-user preferences live on a mod route, not upstream's legacy display page (plan decision 8).
- On native pages the line sits below the button row, not beside the stock star (UX §13 rule 2; plan decision 9).
- `GET /Entries` does not gain the card value; cards are the combined Browse grid only (plan decision 10).
- The Dashboard `configPage.html` is not extended; the settings area carries the section (plan decision 11).
- Replacing the key also closes a breaker that a 429 opened (the quota belongs to the key).

### Findings outside this phase

- `DELETE /JellyfinMod/Entries/{id}` answers 409 ("still has media in the library") for a title whose native binding
  outlived its library: once a library is removed, no scan clears the binding, so the entry can never be removed through the
  API. The isolated instance still carries ten such entries from earlier runs (*JellyfinMod D13 …* and *JellyfinMod P22 …*,
  in libraries that no longer exist; they do not show in any view). Not touched here; worth its own task.
- The isolated instance logs at Debug but writes no `System.Net.Http` lines, so outbound hosts cannot be read from its log.

### Not verified

- **The real MDBList call** (shape, refused-key status, unknown-title status, TMDB's scale) — waits for the user's key and
  one press of **Test** in Settings → Ratings (open question 1).
- **OMDb writing the fields live** — the host cannot be pointed at a stand-in (hard-coded address), so the on-disk fixture
  carried the same fields in a locked NFO, as the acceptance conventions allow.
- **Physical webOS** — TV layout emulation only.
- **An ordinary user's browser session** — the ordinary user was exercised through the API; the browser runs signed in as
  oleksii.

## Review fixes — 2026-10-07

Opus 5.5, high. The Codex GPT-6.1 Sol high reviews (plugin: rejected, eight findings; web: approve with fixes, seven) were
fixed on both `jellyfinmod-phase9` branches: plugin `612d557..7bef3f6`, web `8f7809a2af..` this branch's tip. Every fix is
proved through a real boundary — the plugin suite over real Kestrel and the HTTP stand-in, the browser runs on the isolated
instance — never a unit test.

**Plugin.**

| # | Finding | Fix | Proof |
|---|---|---|---|
| 1 (P1) | A provider `url` was stored and returned unfiltered and could carry the key | Only an `https`/`http` link on the source's own site, no credentials, default port, no query, no `apikey` in the path, rebuilt as `https://host/path`; checked on store and again on the way out | Suite: a stand-in answer with the key in the link, a foreign host and userinfo stores and returns none of them |
| 2 | Settings saves and a running fetch used separate gates | Before every call the run re-reads settings, state and key; off, a spent budget or a new key stops it; a 401 or 429 answered to the old key never blocks the new one | Suite: a held call, the key replaced meanwhile, the stale 401 leaves the new key unblocked; ratings off and budget lowered mid-run stop it |
| 3 | Test bypassed budget and breaker | Test is refused (`budget_spent`, `breaker_open`, no call) like any call; a refused key can still be tested; a pass marks verified only if the settings did not change | Suite: Test with the budget spent and with the breaker open answers the code and makes no call |
| 4 | A new sibling entry looked never-fetched and bypassed the interrupted-claim delay | Due state is the title identity's latest attempt; a new sibling adopts the latest attempt and values | Suite: a sibling added while a claim is interrupted waits like the original, then fetches once |
| 5 | Structurally malformed ratings came back `ok` and wiped rows | Strict reading: a non-object item, a non-string source or a value of the wrong kind makes the answer malformed and changes nothing | Suite: a structurally wrong item and a value of the wrong kind are `malformed`, count as failures and keep the stored rows; `null`, `""` and `N/A` are absent values, not malformed |
| 6 | `Retry-After` hid `X-RateLimit-Reset` | The breaker runs to the latest of both and the next UTC day | Suite: both headers, the later one wins |
| 7 | Overdue titles went oldest attempt first | Each group newest `AddedAt` first (decision 5); the R3 due rule and API.md now say so | Suite: the overdue order is newest first |
| 8 (P3) | Host fallback was always `stale:false` | Stale by the item's last metadata refresh | Suite: host values refreshed a day ago are current inside the window and stale once it has passed |

**Web.**

| # | Finding | Fix | Proof (Chromium 153.0.8010.12 and Chrome 153.0.8010.54, 48/48 each) |
|---|---|---|---|
| 1 | Defaults never refetched; a settings save did not invalidate them | Defaults and title ratings refetch every minute; a save invalidates the defaults, title ratings and the grids | Ratings turned off and on in the settings area change the title page in the same visit |
| 2 | Late defaults or ratings could insert content above a focused row (TV) | The detail pages wait (at most 3 s) for the defaults and ratings before they render; a line whose data comes after focus has moved past it stays out for that visit | TV 1920×1080 and 1280×720: the focused control is the same and in the same place once the line is there |
| 3 | One re-read 4 s after the 202 | The button waits until `Ratings/Status` `queued` is 0 (at most a minute), reads the title again, then refreshes the page and the grids | "Ratings refreshed." with the line still shown |
| 4 | "Use the server's default" unmounted the focused button | Focus moves to the first source switch | TV: Enter on it lands on the IMDb switch |
| 5 | Cards did not show a stale value | A stale card value adds its month, "IMDb 8.1 (Aug 2026)", dimmed | One title aged 40 days (`p9-live.py age`): its card says so, the other does not (`shots/chrome-desktop-cards.png`) |
| 6 (P3) | Provenance only on hover | Outside TV each chip is a button; Enter or a tap shows "IMDb: via MDBList, as of …" in a status line below the chips; on TV the chips stay read-only | Enter shows and hides it |
| 7 (P3) | The runners wiped the user's preferences | Both snapshot oleksii's two keys, including which exist, and put them back exactly | Both runs and cleanup: keys before = keys after |

Also: the two new runners are lint-clean (31 errors fixed); there is no `hundred` scale (a 0–100 value is `percent`, and the
web skips any scale it does not know), now stated in API.md and above.

**Live re-run** on the isolated instance with the new plugin (0.1.0.0 built from `d5cdd8e`; the tip `7bef3f6` changes only a comment in the suite) and bundle `7df7b451dc4c`: `setup`,
`unconfigured`, `configure`, `fetch`, `age`, both browsers, `unage`, `restart`, `failures`, `kill`, `leak`, `cleanup` — all
pass (`evidence/p9/review-fix/`). Two harness corrections on the way, neither a mod fault: `restart` must run before the browser
runs, because their settings saves change the revision and `verified` is per revision (Test was pressed again, then `restart`
passed); and the leak step counted a stack frame of another plugin's failed call as an HTTP client log line — it now counts
only the host's request-logger categories. Fixtures removed; `GET /UserViews` for oleksii lists Movies and Shows only;
oleksii's display preferences are as before; the stand-in is stopped and its key deleted.

## Review fixes, round 2 — 2026-10-07

Opus 5.5, high. The Codex GPT-6.1 Sol high re-reviews of the first fix round (plugin `612d557..7bef3f6`: rejected, four of
eight fixed; web `8f7809a2af..fbdc355360`: approve with fixes) were fixed as below: plugin `7bef3f6..` its branch tip, web
`fbdc355360..` this branch's tip. Proof is the plugin suite over real Kestrel and the HTTP stand-in, and the browser and
live runs on the isolated instance; no unit tests.

**Plugin.**

| # | Finding | Fix | Proof (suite unless stated) |
|---|---|---|---|
| 1 (P1) | The link filter still let the key through in a path, a host name or double-encoded | No provider link is read, stored or returned at all (coordinator's decision; nothing uses one). Migration `PhaseNineRatingsIdentity` drops `TitleRatings.Url`; `url` leaves the API | A stand-in answer with the key in a query, a path, a host name and double-encoded: the ratings carry no `url`, the key is in no answer; the migration from the first Phase 9 shape removes stored links |
| 2 | Settings were checked before the pause between calls, so a call could start after a save with what it replaced | One gate, `RatingsCredentialGate`, is taken by the settings save and by the fetcher from its last look (after the pause) through the call to recording the answer; the claim and budget commit only after that look, so a refused call leaves nothing to reconcile. Test works the same way | The save waits while a call is out; with ratings turned off or the budget lowered no call starts after the save; with the key replaced mid-run the call out used the old key and every later call the new one |
| 3 | The post-answer key comparison raced the save | Gone: the save cannot run between the look and the recording, so an answer is always about the key still saved; the save then clears what an old key's answer set | The old key's 401 and 429, answered during a save, are recorded first and lifted by it: no block, breaker closed |
| 4 | An old key's quota deadline stayed on the title | No per-title deadline: the quota's deadline lives only on the breaker, which a new key closes; a refused or rate-limited title is due as soon as fetching may resume | The next run after a replacement fetches that title at once |
| 5 | Removing the entry being fetched lost the attempt, so a new sibling was fetched twice | Attempts are one row per title identity, with no entry foreign key; a run forgets the attempt of a title no library holds once its refresh window and failure wait have passed | A run killed mid-call while a sibling is added and the claimed entry removed: after the restart the title still waits out the interrupted attempt, then is fetched once; past the window the orphan attempt is pruned |
| 6 | A malformed `score` was still `ok` and cleared rows | `score` is validated like `value` and `votes` | A wrong-kind `score` is `malformed`, counts as a failure and keeps the rows |
| 7 (P3) | A Retry-After of a year or more was dropped | Kept as given; a delay past the last representable moment ends there | A 429 asking 40,000,000 seconds holds the breaker that long |

**Web.**

| # | Finding | Fix | Proof (Chromium 153.0.8010.12 and Chrome 153.0.8010.54, 50/50 each) |
|---|---|---|---|
| 1 | A failed minute's refetch hid the line; later updates could grow it above focus | The line keeps its last answer through errors, stays mounted when ratings are turned off, and applies any later change at once only while focus is above or inside it; with focus below it a change is kept only if the line's height does not change (measured before paint) | TV 1920×1080, focus on a control below the line: a forced 500 on the minute's refetch, then a refetch with wider dated values — the focused control stays exactly where it was |
| 2 | A status error counted as completion | Only an empty queue is completion; a failed look is asked again within the minute; a 403 or an answer without `queued` says the server will not tell | Desktop: "Ratings refreshed." after the queue empties |
| 3 | Polling was not bounded or cancelled | One cancellable operation per press, cancelled when the page goes; every request has a 10 s limit and every wait is cancellable | Same run; lint and types |
| 4 | `age`/`unage` could leave 18096 stopped | Every stopped-service step runs through one helper that always starts the service again and keeps the SQL's exit status | `age`, `unage`, `kill`, `cleanup` |
| 5 (P3) | Preference snapshots were unsafe across repeats and failures | Both runners refuse to start without a valid read; `p9-live.py` restores first in cleanup and retires the snapshot once confirmed; `p9-ratings.mjs` reads and restores over plain HTTP, independent of the interface | Both runs: keys before = keys after; cleanup: snapshot retired |
| 6 (P3) | Mobile chips were ~22 px | Outside TV on a phone or touch screen each chip is at least 3.5em (45 CSS px) with room beside it | Mobile: five chips 45 px high, 8 px apart; a tap shows the provenance, a second hides it |
| 7 (P3) | Stale dates used the browser locale and an English "old" | Jellyfin's date locale (`scripts/datetime`); no fallback word | — |

Also: cards skip a scale they do not know, as detail chips do; the native page's two 3 s waits are one shared deadline.

**Live** on the isolated instance with plugin 0.1.0.0 from the plugin tip (migration `PhaseNineRatingsIdentity` applied to
the instance's own database, integrity `ok`) and bundle `ef4d88793f5e`: `setup`, `unconfigured`, `configure`, `fetch`,
`restart`, `age`, both browsers, `unage`, `failures`, `kill`, `leak`, `cleanup` — all pass (`evidence/p9/review-fix-2/`).
The suite also migrated a copy of the instance's pre-Phase-9 database (the backup taken before the first deployment)
through both Phase 9 migrations, keeping every row (170 entries) with integrity and foreign keys clean
(`suite-phase-nine-mac.txt`). Fixtures removed; `GET /UserViews` for oleksii lists Movies and Shows only; oleksii's display
preferences are as before and the snapshot retired; the stand-in is stopped and its key deleted. Plugin suites on the Mac: the same set passes as before
this round (Zero, One, Two, Three, Seven Trakt, Nine, Ten); the Linux-only suites fail on macOS as they did before and were
not re-run on the test host this round.

## Review fixes, round 3 — 2026-10-07

Opus 5.5, high. The Codex GPT-6.1 Sol high review of the round-2 ranges (plugin `7bef3f6..24e7004`, web
`fbdc355360..fee6fb4edd`) approved both with fixes; fixed as below: plugin `24e7004..` its branch tip, web `fee6fb4edd..`
this branch's tip. Proof through the plugin suite over real Kestrel, SQLite and the HTTP stand-in, and the browser and live
runs on the isolated instance; no unit tests.

| # | Finding | Fix | Proof |
|---|---|---|---|
| 1 (P2, plugin) | The recording under the credential gate was unbounded, and a waiting ratings save held the settings gate every settings write shares | The ratings save takes the credential gate first, then the shared settings gate (the fetcher never takes the latter, so no cycle). Under the credential gate each SQLite command waits at most 4 s and each save step (the claim; the recording) at most about 8 s in all; the recording stays one save. A database still busy leaves the answer unrecorded (the claim pending for the next run to count as interrupted), stops the run with `database_busy`, and Test answers `database_busy` | Suite: while a ratings save waits for a held Test call, another settings save (Discovery) goes through in under 3 s; with another connection holding SQLite's write lock as the call answers, Test gives up within the bound and says `database_busy`, and the waiting save completes once the database is free |
| 2 (P2, plugin) | A rated sibling deleted between the adoption reads aborted the run | Adoption reads every entry and every stored value once, and saves each title on its own: a title that cannot be written is skipped and adopted next run | Suite: a SQLite trigger refuses one new entry's values (as if it vanished mid-write); the run finishes, the other title adopts, and the next run adopts the first |
| 6 (P3, plugin) | `Retry-After: 1000000000000` was dropped by .NET's parser | The header's digits are read directly and saturate to the last representable moment | Suite: the breaker runs to year 9999 |
| 3 (P2, web) | On the file-less page the line shares a wrapping row with the TMDB star; a wider line could keep its own height and still push focus down | A trial is judged by whether the focused control moved (or the line's height changed), measured before paint | Chromium and Chrome, TV layout: the runner finds, from the page's own CSS, a window width (1849 px) and two source counts where the line stays 24 px high but the shared row goes 27 → 51 px, confirms it in real visits, then a minute's defaults refetch with focus below leaves focus exactly in place; the next visit shows the wider line |
| 4 (P2, web) | Refresh awaited a namespace-wide invalidation that could stall | Background invalidation of the reads that show ratings only, never awaited; waits and request limits are cut to what is left of the minute | Desktop: with every other ratings read stalled at the boundary, the page says "Ratings refreshed." and the button is free |
| 5 (P2, runner) | A signal during a stopped-service step skipped the restart | A trap installed before the stop ends the SQL step's process tree, starts the service and exits with the signal's status; here a failed or timed-out remote call is followed by a second start, and TERM/HUP end the runner through its `finally` | Live `interrupt` step: TERM mid-step → exit 143, service running 1 s later; a local time-out → the service is started from here and answers. Its first two tries failed on timing only (an orphaned `sleep` from the test's own SQL step kept the SSH session open until the tree kill) |

Also: the committed round-2 suite transcript has no trailing whitespace.

**Runs.** Plugin suite with the instance-copy migration (all 170 entries kept); the Mac suites pass as before (Zero, One, Two,
Three, Seven Trakt, Nine, Ten). Chromium 153.0.8010.12 and Chrome 153.0.8010.54: 52/52 each. Live on 18096 with plugin
0.1.0.0 from the round-3 tip and bundle `67902e05db2b`: every step from `setup` to `cleanup`, plus `interrupt`, passes
(`evidence/p9/review-fix-3/`). Fixtures removed; `GET /UserViews` for oleksii lists Movies and Shows only; oleksii's
display preferences are as before; the stand-in is stopped and its key deleted.

## Review fixes, round 4 — 2026-10-07

Opus 5.5, high. The Codex GPT-6.1 Sol high review of the round-3 ranges (plugin `24e7004..8cdbbf1`, web
`fee6fb4edd..ea82d0e57f`) approved both with fixes, no lock-order cycle and no path to production; fixed as below: plugin
`8cdbbf1..` its branch tip, web `ea82d0e57f..` this branch's tip.

| # | Finding | Fix | Proof |
|---|---|---|---|
| 1 (P2, plugin) | `SetCommandTimeout(4)` left the connection's own default timeout at 30 s; a save's BEGIN IMMEDIATE and COMMIT run on the connection and a token does not interrupt them, so a held writer kept the gate 30 s | Under the credential gate the connection's `DefaultTimeout` is bounded too (4 s), and both values are restored as they were afterwards | Suite, ordinary manual refresh against a second connection holding SQLite's write lock: at the claim, the refresh gives up within the bound and no call is made, nothing written; at the recording (the answer arriving while the lock is held), it gives up within the bound, the claim stays pending and the stored values are kept. With the connection bound removed the claim check fails at 30.14 s |
| 2 (P2, runner) | After a local time-out the service was started while the remote operation could still run its SQL or finish a stop | Each stopped-service operation carries a unique marker; on a time-out, a dropped connection or a local interrupt, recovery sends it TERM (its trap waits for a stop under way, ends the SQL's process tree and starts the service), waits until it is gone (KILL and a 15 s grace as a last resort), and only then makes sure the service runs | Live `interrupt`: TERM mid-step restarts within seconds; a time-out while the SQL waits — the operation is gone before the start and its SQL (a marker file written after the wait) never runs; a time-out during the stop itself — the service is up afterwards and stays up |
| 3 (P3, web) | A focused chip was taken for focus below the line (the hidden anchor does not contain the chips), so widening updates were refused | Focus is judged against the line itself when it is shown; a trial compares the same focused element's place | Desktop: with focus on the TMDB chip, a minute's refetch with IMDb votes 1 → 123,456,789 shows "IMDb 8.1 (123M)" and focus stays on TMDB |

**A real key on 18096.** From this round the user may enter their real MDBList key on 18096 at any time. `p9-live.py` now
refuses to start when any key is configured, checks before every step that the configured key's secret-store reference (read
only, never the key) is the one this run saved, saves its own key only against the revision read before that check, and
`p9-live.py guard` runs the check alone before the browser runner. Cleanup clears only this run's key; with a key it did not
set it removes the fixtures and leaves the ratings settings, the key and stored ratings alone; the reset's SQL deletes ratings
state only when no key is configured, decided inside the stopped-service step. Before this round's run 18096 had no key
(`apiKeyConfigured: false`, revision 1). During the run the coordinator saw a configured, verified key and the stand-in address
on 18096 and asked whether the user's key had been replaced: it had not. The only key saved was this run's fixture key
(10:28:50Z, revision 2), its secret-store reference stayed the one this run recorded, every later ratings save was this run's
own on/off switching, and all 171 stand-in calls after `fetch` carried the fixture key; the address pointed at the stand-in
before the key was saved, so no call could reach MDBList. The Chrome run was stopped while that was checked and run again in
full afterwards.

**Runs.** Plugin suite on the Mac (with the connection bound removed the claim check fails at 30.14 s). Chromium
153.0.8010.12 and Chrome 153.0.8010.54: 53/53 each. Live on 18096 with plugin 0.1.0.0 from the round-4 tip and bundle
`f4c3035c1649`: `setup`, `unconfigured`, `configure`, `fetch`, `restart`, `age`, `guard`, both browsers, `unage`,
`failures`, `kill`, `leak`, `interrupt`, `cleanup` — all pass (`evidence/p9/review-fix-4/`; a first `setup` attempt hit the
server still starting after the deploy and was re-run). Cleanup left the ratings settings at their defaults with no key and no
provider address (`GET /JellyfinMod/Settings/Ratings` at 10:57:46Z: `apiKeyConfigured: false`, `providerOverride: false`,
revision 1); fixtures removed; `GET /UserViews` for oleksii lists Movies and Shows only; oleksii's display preferences are as
before; the stand-in is stopped and its key deleted. 18096 is ready for the user's real key.

## Review fixes, round 5 — 2026-10-07

Opus 5.5, high. The Codex GPT-6.1 Sol high review of the round-4 ranges approved the plugin (`8cdbbf1..e242a9d`, every finding
fixed) and approved the web with fixes: four P2s, all in the live runner `p9-live.py`. Fixed on the web branch only
(`31f8079440..` this branch's tip); the plugin is unchanged. 18096 was handed to another session meanwhile, so this round was
proved by a local simulation (`scripts/jellyfinmod-e2e/p9-live-sim.py`: no SSH, no test host; the runner's own functions against
a fake `docker` whose stop is carried out by a "daemon" that outlives its client, a fake `setsid`, the real `sqlite3`, and a
local ratings API with the plugin's revision rule; port 18096 is refused in that mode). The live steps listed below are to be
run again on 18096 once it is free.

| # | Finding | Fix | Proof (simulation, 13/13) |
|---|---|---|---|
| 1 | Ownership was read after the save, so a key saved in between could be recorded as the run's | Every ratings save goes through `write`: it is sent against the revision this run last wrote (from setup on, kept in the state file), so any save by someone else in between is refused (409) and stops the run; ownership is then read against the revision this save produced — the revision and the key reference in one SQL statement — and nothing is recorded unless the revision is still that one | A key saved right after the run's own save is not taken for the run's (nothing recorded, the run stops); cleanup's clear is then refused and the key stays; another setting saved by someone else is not overwritten |
| 2 | The guard ran once per step; `patch` took a fresh revision | No save takes a fresh revision any more; before every Test, refresh, daily-task run and configuration change the revision and the key reference are checked together against the run's; the browser runner holds its own saves (API and the settings area's Save, whose request is rewritten to the run's revision) to the same chain and checks the revision before Test and Refresh. **Not atomic:** the plugin has no conditional Test or refresh, so a save between the check and the call is not excluded — and a running task or queued refresh reads the settings again for each title, so the exposure lasts as long as that work (corrected in round 6; see the exclusive-use rule there) | Test, a refresh, the daily task and a configuration change are refused before any request reaches the API; while the settings are the run's they go through |
| 3 | A failed recovery call still let the service start | Recovery must succeed and confirm the operation is gone; otherwise the step raises `RecoveryFailed`, the service is left as it is, and the step reports it | With the recovery call failing (255), the service is not started and the step reports a recovery failure |
| 4 | Only direct children were killed, nothing was confirmed, and the trap started the service at once | The step runs under a monitor shell that leads its own session; the work (the stop, then the SQL) runs in a second session and process group. On a signal the monitor ends the work's whole group (TERM, a wait, KILL, then a check that it is empty) and exits; it never starts the service. Recovery finds both groups by a marker, ends them the same way and confirms they are empty. Only then `restart_clean` waits for any stop still under way (`docker compose stop`), requires the container to be `exited`, starts it and requires `running` | Normal and failing SQL steps; TERM to the step mid-SQL (no sleeper left, start after the stop has finished); a local time-out mid-SQL (its late SQL never runs); a time-out during the stop itself (the start waits for the daemon's stop); a member that ignores TERM (killed after the wait, group empty before the start) |

**To run again on 18096 once it is free**, in this order: `setup`, `unconfigured`, `configure`, `fetch`, `restart`, `age`,
`guard`, the browser runner in Chromium and in Chrome, `unage`, `failures`, `kill`, `leak`, `interrupt`, `cleanup`. The
ownership chain is new in every step that saves ratings settings or calls the provider, and the stopped-service helper is new
in `age`, `unage`, `kill`, `interrupt` and `cleanup` (and the reset inside it), so none of the steps is unaffected; the plugin
and the bundle are unchanged since round 4 and need no redeployment unless 18096 no longer runs them.

## Review fixes, round 6 — 2026-10-08

Opus 5.5, high. The Codex GPT-6.1 Sol high review of web `31f8079440..ab9626857e` approved with fixes (round-5 findings 1 and 3
fixed, 2 and 4 partly). Fixed on the web branch only (`ab9626857e..` this branch's tip), still without the test host: the
simulation (`p9-live-sim.py`, 18/18) and a new local check of the browser runner's Save handling (`p9-saves-check.mjs`, real
Chromium against a local page and endpoint, 4/4).

| # | Finding | Fix | Proof |
|---|---|---|---|
| 1 | Recovery found only surviving marked group leaders, so unmarked members left behind went unseen and an empty search allowed a restart | When the work starts, the monitor reports both process-group ids (and its parent's); the runner keeps them, refuses any that is 0, 1, its own group or the parent's (or the two being the same), and before any start confirms with `kill -0` that both recorded groups — and any group a marked process still leads — are empty, ending them first if not. No valid report means nothing can be confirmed, so nothing is started | Simulation: an orphaned member whose group leader has gone is found by the recorded group, ended and the group confirmed empty; a member a finished step left in its group is ended before the start; without a valid report the service is not started |
| 2 | The browser runner rewrote the settings-area Save's revision, which would hide broken revision handling in the page | The page's own request must carry the run's revision; it is then forwarded unchanged and the answer's revision is noted; anything else fails the check before reaching the server (the runner's chain helpers now live in `p9-saves.mjs`) | Local check: the run's revision is forwarded byte for byte and the next one noted; an older or missing revision is refused before the server; a forwarded Save the plugin refuses is not noted and stops the run. The real page's Save is checked in the live re-run (a new browser check records both Saves) |
| 3 | The exposure was not one round trip: a running task and queued refreshes read the settings again for each title | Not more code, the rule: **the run needs 18096 to itself from `setup` to `cleanup`, including the daily task and queued refreshes draining, and no one may enter a real key while it runs**. `p9-live.py` prints this at `setup` and `cleanup` and in its help; `cleanup` first waits until no refresh is queued and the ratings task is idle, and clears nothing otherwise | Simulation: the drain waits for both and reports a task that does not finish |
| 4 (P3) | Paths went into remote commands inside raw single quotes | Every path and value interpolated into a remote command is quoted with `shlex.quote` | Simulation (all its stopped-service steps run through the quoted commands) |

**To run again on 18096 once it is free** — unchanged from round 5: `setup`, `unconfigured`, `configure`, `fetch`, `restart`,
`age`, `guard`, the browser runner in Chromium and in Chrome, `unage`, `failures`, `kill`, `leak`, `interrupt`, `cleanup`,
under the exclusive-use rule above. The plugin and bundle are unchanged since round 4.

## Review fixes, round 7 — 2026-10-08

Opus 5.5, high. The Codex GPT-6.1 Sol high review of web `ab9626857e..29d70867b0` approved with fixes; round 6 fixed except the
quoting. Fixed on the web branch only (`29d70867b0..` this branch's tip), Mac only; simulation 20/20.

| # | Finding | Fix | Proof (simulation) |
|---|---|---|---|
| 1 (P2) | Recovery also signalled any group a marked process led, without the exclusions — the surviving `setsid --wait` wrapper leads the SSH session's group | Recovery touches only the step's two recorded, validated groups; no marker-based discovery of other groups. Without a valid recorded pair nothing is started, as before | A process carrying the step's marker and leading a group of its own is left alone; the orphaned-member, finished-step and missing-report cases still pass |
| 2 (P3) | The late-SQL sentinel went through SQLite's `.shell`, which drops shell quoting (an apostrophe broke the path, `$(...)` expanded) | The sentinel is plain SQL: after the wait, `ATTACH DATABASE '<path>'` creates the file, the path quoted for SQL only; nothing re-reads it as shell | With a path containing an apostrophe and `$(...)`, a step allowed to finish creates exactly that file (nothing expanded); with the time-out it is never created |

The live re-run list is unchanged (round 5/6, under the exclusive-use rule).

## Live re-run — 2026-10-08

Opus 5.5, high. On 18096 under the lease "Next phases in mod version" (10:52–14:52 Sydney; this run 10:53–11:22 Sydney), with
exclusive use from `setup` to `cleanup`.

**Before.** 18096 ran the detail-fix build (plugin from `tmp/detailfix-on-phase9` 4bc468d, DLL `1193bd07a99c…`, bundle
`8c17355c3aba`, migrations through DetailFileHistory). Nothing from the Home hero session was found: no fixture title or
library beyond the ten long-standing *JellyfinMod D13/P22* entries noted above, and the only watch-state rows changed in the last
day were eight detached placeholders (items no longer present) from 21:48–21:56Z on Oct 7, before the detail fix's second pass.
That state was backed up on the test host (`build/p9-before-rerun-20261007T235341Z`; an earlier copy from the first, stopped
attempt is `build/p9-before-rerun-20261007T224704Z`), then `build/dd-plugdeploy.sh restore` put back the Phase 9 state taken
before the detail fix: migrations end at PhaseNineRatingsIdentity, no DetailFileHistory. Neither `tmp/detailfix-on-phase9` nor
`build/dd-plug-backup*` was changed.

**Deploy.** Plugin 0.1.0.0 from e242a9d (DLL `194f00614fa3…`, the same build as round 4) and web `5030d4c3ae` (bundle
`5c8664fc5e8b`); startup logs show the plugin loaded and migrations applied, no errors; Health 200 with `ratings`,
`ratings.cards`, `settings.ratings`.

**Run** (`evidence/p9/live-rerun-20261008/`): `setup` 5/5, `unconfigured` 12/12, `configure` 5/5, `fetch` 9/9, `restart` 3/3,
`age` 2/2, `guard` 1/1; Chromium 153.0.8010.12 54/54 and Chrome 153.0.8010.54 54/54 (including the real settings page's Save:
each sent the revision it loaded, unchanged, and got the next one back); `unage` 2/2, `failures` 13/13, `kill` 5/5, `leak` 4/4,
`interrupt` 4/4 (TERM mid-SQL: the work group ended, exit 143, service started after; a time-out mid-SQL: its late SQL never
ran; a time-out during the stop: the service up and staying up), `cleanup` 14/14 (it first waited for nothing queued and the
task idle). No step failed.

**After.** `GET /JellyfinMod/Settings/Ratings` at 00:22:14Z: `enabled: true`, `apiKeyConfigured: false`, `refreshDays: 14`,
`dailyBudget: 500`, the default sources, `verified: false`, `providerOverride: false`, `revision: 1`. No fixtures; `GET
/UserViews` for oleksii lists Movies and Shows; oleksii's display preferences as before; the stand-in stopped and its key
deleted. 18096 runs Phase 9 (plugin e242a9d, bundle `5c8664fc5e8b`), migrations through PhaseNineRatingsIdentity, ready for the
user's real MDBList key; the lease stays with "Next phases in mod version" for that test.

## Automatic fetching, inline ratings and source marks — 2026-10-08

Opus 5.5, high. Three requests from the user on 2026-10-08, built on the same branches before acceptance. Plugin
`e242a9d..` and web `d32c265427..` this branch's tips; no instance was used (the user's real MDBList key is saved on 18096
since 14:24 Sydney, so the live runner, which refuses to run with a key it did not set, was not run, and nothing was deployed).

### User decision 8 — ratings do not wait for 04:00

The user's words: ratings should "run after movie import and when first installed run over all media". Decided with the
coordinator's brief:

8. **Automatic fetching.** A title that arrives is fetched within seconds: an entry created (`POST /Entries`, reconciliation —
   a scan or the backfill), a file newly bound to an entry, a Phase 5 import completed. A key verified by **Test**, ratings
   switched on with a key saved, and the first start with a key saved and no run ever completed start a full run at once,
   newest titles first, within the daily budget; a library larger than the budget continues at the daily run. The 14-day
   refresh and the 04:00 task are unchanged; ratings stay display only (decision 7).

**How it works.** `RatingsAutoFetch` (`Services/Ratings/RatingsAutoFetch.cs`) is one hosted worker. A trigger only records what
it asks for — an arrived entry id, or a full run — and wakes the worker through a one-slot channel; it never waits, so no
request, reconciliation or import waits for MDBList, and the hooks run after their own transaction has committed
(`EntriesController.Create` after its save, `ReconciliationService` after its save, `ImportService.CompleteAsync` after its
commit). Bursts are coalesced by the worker: arrivals start a pass once they have been quiet for 2 s, or 30 s after the first
of a steady stream; a library scan or a bulk add of 50 titles is one pass. Exactly one pass runs at a time — the worker is a
single loop, and every pass also takes the runner's process gate, which the daily task, manual refreshes and Test share — so a
trigger during a pass is folded into the next one. A pass is `RatingsRefreshRunner.RunAutomaticAsync`: the same claim before
the call, budget, breaker, blocker and credential gate as the daily run. An *arrivals* pass fetches every title never
attempted plus the arrived titles that are due by the usual rule (an import of a title fetched inside its window makes no
call); a *setup* or *startup* run fetches exactly what the daily task would. A pass that may not fetch now (ratings off, no
key, a refused key, an open breaker, a spent budget) does nothing at all — no adoption, no recovery, no run recorded — and its
titles wait for the daily task; a pass with nothing due records no run. Settings PATCH only wakes the worker after its own
save, so it never waits for the run; during a run it waits on the credential gate for at most the one call out, exactly as it
does during the daily task (the runner holds that gate per call, never across the pause between calls). Saving a key does not
start a run by itself (Test does); raising the budget does not either. `Ratings/Status` gains `running` (`kind`, `startedAt`,
`remaining`), and the settings area's Ratings section shows "Fetching, N title(s) left" while a pass runs, re-reading the
status every 5 s until it ends.

### Inline ratings with source marks (design, 2026-10-08)

The user asked for "website icons next to star rating" that "look nice", vote counts out of the row into a tooltip shown on
hover on a computer and on OK on a TV (no links to the sources: withdrawn by the user).

- **Placement.** Native movie and series pages: a mod mount at the end of upstream's first metadata row
  (`.itemMiscInfo-primary`: year, parental rating, stock star), put back by a `MutationObserver` whenever upstream refills that
  row. File-less entry pages: in the row with the page's own TMDB star (`.itemMiscInfo-secondary`), as before. No upstream file
  changed: the mount is placed by the mod's own detail integration (`integration/nativeEntryDetails.js`), so PHASE7 §3.2 gains
  no row. The old line at the head of `.detailSectionContent` is gone.
- **Each rating** is its source's mark (inline SVG, 1.15em, on the text's line) and its value in its own scale, in the user's
  order; no chip, no border, no votes. A value older than the refresh window is dimmed; the tooltip says how old.
- **Marks.** IMDb (yellow badge), Rotten Tomatoes critics (fresh tomato at 60 % or more, green splat below), Rotten Tomatoes
  audience (full popcorn bucket at 60 % or more, a spilled one below), TMDB (teal-to-blue bar), Trakt (red ring and tick),
  Metacritic (black disc, critics) and Metacritic users (rounded square), Letterboxd (three dots), Roger Ebert ("RE" badge).
- **Jellyfin's own values always stay** (user, 2026-10-08, on approving the design): the stock ★ community rating and
  upstream's own tomato keep their place in the row even when they show the same number as IMDb, TMDB or RT critics in the
  ratings beside them, and the file-less page keeps its own "★ x on TMDB". The first build hid such duplicates; that was
  removed before review.
- **Tooltip** (`role="tooltip"`, the rating's `aria-describedby`; fixed position, so the row's overflow never clips it and
  nothing below moves): source and value with the vote count, where the value came from and when, and for a stale value that
  it is older than the refresh window. Computer: shows on hover and on keyboard focus; Escape and leaving hide it; a click adds
  nothing. Touch: a tap shows it, a tap elsewhere (or on the same rating) hides it. TV: each rating is a focus stop with the
  app's focus ring; the page's first focus stays on Play (the ratings carry `noautofocus`, and the TV's autofocus prefers
  Play); Up from the buttons reaches the ratings, Left and Right move between them, OK shows the tooltip, the remote's Back
  closes only the tooltip (the `back` command is cancelled while one is open) and leaves focus where it was, and moving focus
  closes it.
- **Never moving a focused control.** The row is above the buttons, and on a TV the answer arrives after Play has focus. The
  line's before-paint guard (round 4) now also covers the first answer: it is tried, and kept only if the focused control did
  not move. When the whole list would wrap the row, the user's first ratings are tried one fewer at a time, so the row shows
  as many as fit on its line rather than none; a later visit where the answer arrives with the page shows them all (approved
  as built by the user, 2026-10-08). On a 1280×720 TV the design fixture's series row (years, rating, star) shows all five;
  its movie row, which also carries runtime, the stock tomato and "Ends at", shows two of five.
- **Cards** show the chosen source's mark before the value in the secondary line, no tooltip and no focus stop of their own.

**Source marks: origin and licence.** All marks are inline SVG in `components/RatingIcon.tsx`; none is fetched. The Rotten
Tomatoes fresh tomato and rotten splat paths are Jellyfin Web's own `src/assets/img/fresh.svg` and `rotten.svg` (upstream
commit `a9833ba398`, part of this GPL-2.0 project). Every other mark (IMDb, TMDB, Trakt, the two popcorn buckets, Metacritic,
Letterboxd, Roger Ebert) is a simplified mark drawn for JellyfinMod in this file (GPL-2.0 with the rest of the fork); words in
marks use the system's bold sans-serif. No third-party icon set was copied. **Known consideration for the user:** these
names, logos and their likenesses are the sources' trademarks; the marks only identify where a value came from and imply no
endorsement. A public release may want to check each site's brand guidelines (TMDB, for one, publishes logo rules for apps
that use its data).

### Evidence (development machine only)

- Plugin suites on the Mac (CLAUDE.md, suites on the Mac first), all in parallel, on plugin `571de03` and again on `1a8628a`
  (plugin `master` merged in, with the Codex-approved Phase 3 test fix `9a7f05c` and master's dashboard-page commits): Phase 0
  and 1 smoke, Phase 2, Phase 3, Q16 Trakt, Phase 9 and Phase 10 pass. `PhaseNineRatingsIntegration` gains a second host on a fresh
  database with automatic fetching on and the documented 2 s / 30 s windows (the first host, which proves the daily task's own
  rules, runs with it off): no key — arrivals make no call and record no run; a key saved but not tested — no call; a start
  with a key and no completed run — every title at once, newest first; a second start — nothing; a new entry — its ratings
  stored 2.1 s after the add began (the add answered in 0.01 s); the same title in another library — adopted, no call; ratings off —
  nothing; switched on — a setup run at once (the save answered in well under 2 s); breaker open — nothing, and nothing when it
  closes until a trigger; a file bound to the entry (the reconciliation step an import completes through) — fetched within
  seconds; a title the scan created — fetched; a file of a title inside its window — no call; 50 titles added back to back —
  one pass, one call at a time, newest first, stopped by a budget of 20 with the other 30 counted in `entriesWithoutRatings`;
  raising the budget — nothing; a replaced key — nothing until Test, then the 30 at once with the new key; a settings save
  during a full run with 150 ms calls — answered in about a tenth of a second while Status showed the pass (`kind`,
  `remaining`); a title added during the run — fetched by the next pass, no title twice. `PhaseThreeProtectionIntegration`
  needs Linux (hardlink counts) and Phase 5 (bind-mount aliases) too; neither was run (no Pi), so `ImportService`'s hook is
  proven only through the reconciliation step it completes through.
- Design preview (`scripts/jellyfinmod-e2e/p9-design.mjs`): the built bundle in Playwright against a small local server that
  answers the detail, browse and plugin reads from fixtures — **not acceptance evidence** (no Jellyfin), but the pages, CSS,
  upstream's controller, focus handling and the ratings code are the real build. 57/57 checks in Playwright Chromium
  153.0.8010.12 and the same 57/57 in real Google Chrome 153.0.8010.54 (`checks-*.txt`, `results-*.json`): order, marks, no
  votes in the row, the stock star and tomato kept, stale dimmed, hover and keyboard tooltip with votes, Escape, no links, mobile tap and
  tap-elsewhere, 44 px targets, TV first focus on Play, Up, Right, OK, Back closing only the tooltip with the page kept, Play
  not moved, Down back to the buttons, the 720 row fitted on one line, rotten marks below 60 %, the file-less page's own star kept,
  the user's own order with every source, cards with the mark and no tooltip or focus stop, no icon requested as a file and no
  request leaving the machine (upstream's Chromecast sender script is the only outside request attempted, and it is blocked).
  Before and after screenshots in `evidence/p9/design-20261008/` (desktop, mobile, TV 1080 and 720; the Light theme too,
  which the mod interface draws on the same dark ground as before).
- `p9-ratings.mjs` (the live browser runner) is updated for the design — ratings in the star's row, marks, tooltips, TV
  focus path, fitted TV 720 row, card marks — and has not been run: it needs the isolated instance.

### Not verified

- The live chain and the browser runner on 18096 (Chromium and real Chrome), and the plugin suites that need Linux, wait for
  the coordinator and the user; so does a physical TV.
- The startup run on 18096: it starts only if no run has ever completed there. If the earlier live runs left a completed
  run in its provider state, the user's verified key starts a full run with one more press of **Test** once this build is
  deployed (otherwise the first start does it).

## Ratings in the metadata row, the popup and the shown-source checkboxes — design options 2, 2026-10-08

Opus 5.5, high (taking over mid-task from an Opus and then a Fable agent; their work in progress was reviewed and kept, with
the changes listed below). Mac only: no instance, no Pi, no Codex. The two-line design of the first options was rejected by the
user; its work in progress is kept outside the repository as reference only.

### User decisions — 2026-10-08

The user's answers to the two-line options, recorded as decided:

9. **Default sources** (replaces decision 6's list): **IMDb, Rotten Tomatoes critics, Rotten Tomatoes audience and Trakt** are
   shown by default; **TMDB**, Metacritic, Metacritic users, Letterboxd and Roger Ebert are off. A source that is not ticked
   shows nowhere (not in the row, not in the popup); Rotten Tomatoes with only critics ticked shows one number. Fetching is
   unchanged (every source MDBList returns is still stored). Untouched servers take the new default; an administrator's own
   choice is kept (below). Each user may still choose their own in *Ratings display* (plan decision 8's per-user preference,
   unchanged).
10. **Placement and the popup.** The ratings go back into the first metadata row, where Jellyfin's ★ and tomato are; there is no
    second line. The row shows IMDb (in place of the stock ★, which stays when there is no IMDb value), Rotten Tomatoes critics
    and audience (in place of the stock tomato, which stays when there is no Rotten Tomatoes value) and Trakt, in the plain
    style of the first options' Option 1: mark and value, no pills, no lead number. Every ticked rating, with its mark, value,
    vote count and "via MDBList, as of …", is in a popup that replaces the per-rating tooltips: hover on a computer, a tap on a
    phone, OK on a TV, where the group is one focus stop reached by Up from the buttons and Back closes only the popup. No links
    to the sources. First focus stays on Play; a late answer never moves a focused control (the space is reserved before the
    data arrives); the group fits on one line on a 1280×720 TV.
11. **Settings checkboxes.** One checkbox per source in the settings area's Ratings section, as the server's default.
12. **Testing.** Every check and every design picture runs with all nine sources ticked, plus a check that a fresh default
    shows only IMDb, RT critics, RT audience and Trakt, and one that unticking a source hides it in the row and in the popup.

Decision 6 (2026-10-07) is superseded by decision 9 for the list; its order rule (the ticked sources in the administrator's,
or the user's, order) stands.

### Telling an untouched server from an administrator's choice

Migration `PhaseNineRatingsDisplayDefaults` (plugin) replaces the stored default list only when it is **exactly** decision 6's
list — the same five sources in the same order, as the plugin itself wrote it
(`["imdb","tomatoes_critic","tomatoes_audience","tmdb","trakt"]`). Any other list — a source added or removed, or the same five
reordered — is an administrator's choice and is kept. The revision cannot tell them apart: the settings area's Save sends the
list as shown with every save, so a server whose administrator saved only the key (18096 since 14:24 today) has a higher
revision but an unchanged list, and should get the new default; nothing records which fields a save changed. The one case
the rule cannot see is an administrator who deliberately re-ticked exactly decision 6's five in its order: that server takes
the new default too, which is what an untouched server does. A fresh installation has no settings row and starts from the new
default in code. Users who chose their own list in *Ratings display* keep it (it lives in their display preferences, which
no migration touches); users who follow the server's default see the new one. Proof
(`PhaseNineRatingsIntegration`, a database migrated to `PhaseNineRatingsIdentity`, a settings row written as each case, then
the remaining migrations): untouched with revision 3 → the new list; an own list, decision 6's five reordered, and a trimmed
reordered list → kept; and a fresh host's `GET /Settings/Ratings` and `GET /Ratings/Defaults` answer the four.

### What was kept and changed from the work in progress

- **Plugin** — kept as found: the new default in `RatingsSettings`/`RatingSources`, the migration and its suite cases. Added two
  more kept-list cases (reordered, trimmed) and named each case in its check.
- **Web** — kept: `RatingsGroup` (one control in the row, the reserve measured from a hidden stand-in at the widest values,
  the popup's three looks, the hover/tap/OK/Back handling), the mount before the stock ★ in `nativeEntryDetails.js` with the
  `MutationObserver` that puts it back on a refill, `NativeRatingsLine` waiting for the item type, `EntryDetails` giving the
  file-less page's own star way to IMDb, and the settings area's checkboxes. Changed:
  - the stock ★ and tomato are now hidden from the group's first paint for the IMDb and Rotten Tomatoes values it has room for
    (before, they were hidden only when the answer came, which on a 1280×720 TV made the movie row wrap and then kept both
    under the focused Play); an answer without those values gives them back together with the reserve, in one before-paint
    trial (`useRowLayout`), and the place is given back the same way when there is nothing to show;
  - the refill's focus record was cleared by Chromium's `focusout` on removal, so a refill lost the group's focus; it now waits
    for the refill's microtask before deciding;
  - the item's type is passed when already known, so a non-movie page never reserves or hides anything;
  - the fallback reserve (none of IMDb, RT, Trakt ticked) is the widest of the other ticked sources, laid on top of each other,
    instead of one assumed widest;
  - a phone's row (about 228 px at 390) is narrower than the group: there the group wraps inside its own box and reserves no
    width (a phone has no remote focus to move); the popup never leaves the screen (width and height bounded, placed wholly on
    screen, scrolling inside if taller);
  - the popup shows each rating's "via MDBList, as of …" without the caveat, and the caveat once at its foot; B's tiles carry
    the line too; C's table uses the short names;
  - the group's items sit 0.8em apart (the row's own are 1em), which gives the 720 movie row its margin;
  - the design harness's variant run was rewritten for the group (the two-line checks were still in it).

### How the earlier focus findings hold by construction (web review 2026-10-08, P2 2–5)

- **(2) A refill re-checks fit and keeps focus.** Upstream's `fillPrimaryMediaInfo` replaces the row's content, not the row.
  The group's mount is one node that the row's `MutationObserver` puts back at the same place in the same microtask, before
  paint, with its React tree, its reserved width and the row's classes (which hide the stock ★ and tomato) intact; so the row
  lays out exactly as before the refill — there is no fit to compute again. If the refill took focus from the group, it is
  given back. Checked on TV 1080 and 720 in all three looks: the group back at the same index, focused, the same width, one
  line, Play not moved, the stock ★ and tomato still hidden.
- **(3) Fit does not depend on autofocus timing.** Nothing is fitted. The group is rendered synchronously (`flushSync`) inside
  the observer's callback when upstream first fills the row, before upstream focuses Play; its width is measured then from a
  hidden stand-in at the widest values ("10.0", "100%") and becomes its least width, and the stock marks it stands in for are
  hidden in the same paint. The row's line count is decided at that first paint; the answer only fills the space.
- **(4) An update never moves or removes a focused control.** The answer fills the reserved width; every other change (stock
  marks back, reserve released, place given back) is tried before paint and kept only if the row keeps its height while focus
  is past it, and the group is never taken away while it has focus. Checked: a 5 s late answer with Play focused (Play's
  place, the row's height and the group's box unchanged; the stand-in before, the values after), Up/OK/Back/Down and the
  refill with Play's place compared each time.
- **(5) Back is never swallowed when no popup is open.** The group listens for the app's `back` command only while its popup
  is open (the listener is added when it opens and removed when it closes). Checked: Back with the popup open closes it and
  keeps the page and focus; Back with the group focused and no popup open leaves the page to Home.

### The three looks

Every look shares the row placement, the reserve, the focus behaviour and the checkbox rule; only Rotten Tomatoes' two
numbers and the popup differ. Contact sheets (`evidence/p9/design-options-2-20261008/contact-option-{a,b,c}.png`): desktop
with the hover popup (series with "1923"'s values and the movie), the stock ★ and tomato kept for a movie without IMDb or RT
values, TV 1920×1080 and 1280×720 with Play focused and with the OK popup, the file-less entry page on desktop, TV and a 390 px
phone, the phone's tap popup, the fresh default and the unticked sources. The settings checkboxes (a fresh server: IMDb, RT
critics, RT audience and Trakt ticked) are in `settings-checkboxes.png`.

- **A — two Rotten Tomatoes marks; the popup is a compact list under the row.** The clearest row: each number has its own
  mark (tomato for critics, popcorn for audience, as Rotten Tomatoes itself shows them), so nobody has to know which number is
  which. It is also the widest: on the 1280×720 TV the fixture movie's row (year, runtime, rating, group, "Ends at") uses
  801 of 822 px, so a longer rating badge or a longer "Ends at" in another language can push "Ends at" to a second line (it
  would do so from the first paint, never under focus). The list popup reads like a sentence per source (name, value, votes,
  then "via MDBList, as of …" under it) and is the easiest to scan for one source, but it is the tallest: nine sources fill
  most of a 720 screen.
- **B — one Rotten Tomatoes mark, "94% | 55%"; the popup is a small card of logos.** One mark saves width (773 of 822 px on
  the 720 movie row) while keeping both percentages; the cost is that the audience number has no mark of its own and is known
  only by its place after the bar. The card of tiles is the most visual and the most compact popup (three by three, the mark
  large, the value, the votes and "via MDBList, as of …" small under it) and suits a TV glance; sources are known by their logos
  only (Metacritic critics and users differ by disc and square), and the provenance line is the smallest text on the page.
- **C — Rotten Tomatoes as "94 · 55", smaller; the popup is a source / score / votes table.** The narrowest row (731 of 822 px),
  so it fits the most generous margin on a TV, but dropping the "%" and shrinking the pair make RT read as secondary and
  slightly harder at TV distance. The table is the densest and most exact popup (aligned columns, full vote counts, short
  names, the date in its own column) — the best for comparing sources, the least like the rest of the TV interface; on a phone
  its last column wraps.

**Recommendation (agent):** A if the 720 movie row's narrow margin is acceptable — it reads best and matches Rotten Tomatoes'
own marks; B if a safer TV margin matters more than a mark per number. The user picks.

### Evidence (development machine only; not acceptance)

- Plugin suites on the Mac, in parallel (CLAUDE.md, suites on the Mac first): Phase 0 and 1 smoke, Phase 2, Phase 3, Q16
  Trakt, Phase 9 (298 checks, with the migration cases above) and Phase 10 pass (`suites-mac/`). The instance-copy migration
  check was not run (the copy is on the test host).
- Design harness `scripts/jellyfinmod-e2e/p9-design.mjs` with `JFMOD_DESIGN_VARIANT=a|b|c` (and `JFMOD_DESIGN_SHEET` for the
  contact sheet): the built bundle against a local fixture server — the real pages, CSS, upstream's detail controller, focus
  handling and ratings code, not Jellyfin's answers. Chromium 153.0.8010.12: A 90/90, B 89/89, C 89/89; Google Chrome
  153.0.8010.54: 89/89 each (`checks-*.txt`, `results-*.json` per option; A's settings-picture check runs only in the run that
  takes the pictures). Every source ticked except in the two default checks; no request left the
  machine except upstream's blocked cast sender; no mark requested as a file.
- The inline/popup product code is **not committed** until the user picks (a backup patch is kept outside the repository);
  the committed branch still carries the earlier inline design, which the harness's run without a variant checks.

### Not done yet

- The user's pick; then the chosen look is committed alone (the other two removed, with `ratingsGroupDesign()` and its
  `localStorage` switch), the harness's group checks become its main run, `p9-ratings.mjs` (the live runner) is updated for
  the group, and the Codex review and the live run on an instance follow.

## Status and handover — 2026-10-07

**Built (not accepted).** R1–R8 are implemented on both `jellyfinmod-phase9` branches; the suites pass and the live run on the
isolated instance passed in Chromium and Chrome. On 2026-10-08 automatic fetching (user decision 8) and the inline ratings with
source marks were added (above); they wait for their Codex review and a live run on the isolated instance. Both reviews' findings and both re-reviews' are fixed (above); acceptance
waits for the Codex review of web `29d70867b0..` this branch's tip and for the user (the MDBList key test on 18096); the live
re-run passed on 2026-10-08 (above). Nothing is merged; the
plugin version stays 0.1.0.0 and nothing was published.

For the next agent or reviewer:

- Re-run the live chain with `scripts/jellyfinmod-e2e/p9-live.py` (`setup`, `unconfigured`, `configure`, `fetch`,
  `restart`, `age`, `guard`, the browser runner `p9-ratings.mjs`, `unage`, `failures`, `kill`, `leak`, `interrupt`, `cleanup`;
  the run stops, touching nothing, if a ratings key it did not set is configured); settings come from the environment
  and its docstring, and the stand-in from `standins/mdblist.mjs` started on the isolated instance's Docker network.
- The isolated instance runs this branch's plugin (0.1.0.0 from e242a9d) and bundle `5c8664fc5e8b` (web `5030d4c3ae`), migrations through PhaseNineRatingsIdentity (live re-run, 2026-10-08); ratings are on with no
  key, so the 04:00 task does nothing. A backup of the plugin folder, its XML, secret store and database from before the
  deployment is on the test host in the JellyfinMod data folder's `backups/p9-before-20261007`, beside the instance's own `test` folder (migrations are forward-only).
- For the user: supply the MDBList key in Settings → Ratings and press **Test** once; if it answers anything but `ok`, the
  code and sentence say what the real service did differently from the stand-in.
