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
  "fetchedAt": "2026-09-21T10:00:00Z", "provider": "mdblist", "url": null }
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
  `Votes?`, `FetchedAt`, `Url?`; `RatingsFetch`: `EntryId`, `AttemptedAt`, `Outcome`,
  `RetryAfter?`, `Error?` bounded and admin-only). No synthetic `BaseItem`, no write to the host's
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
   each user's own choice).
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
  cascade unique, `AttemptedAt`, `Outcome`, `RetryAfter?`, `Error?` bounded to 200 characters, `Manual`).
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
- Due rule: never attempted (newest `AddedAt` first), then stored ratings older than `RefreshDays` (oldest first), then a
  failed attempt older than one day. A claim row (`Outcome = pending`) and the budget increment commit **before** the
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
  ten or a hundred scale (both are accepted, decision 2). The Test button reports which code the real service gave.

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

**DTOs.** One rating: `{source, value, scale, votes, provider, fetchedAt, url, stale}` with `scale` in `ten`,
`percent`, `five`, `four`; `provider` in `tmdb`, `mdblist`, `host_omdb`, `host_tmdb`; `stale` true when `fetchedAt` is
older than `refreshDays`. API.md *Ratings (Phase 9)* records every endpoint as built.

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

## Status and handover — 2026-10-07

**Built (not accepted).** R1–R8 are implemented on both `jellyfinmod-phase9` branches; the suites pass and the live run on the
isolated instance passed in Chromium and Chrome. Acceptance waits for the Codex GPT-6.1 Sol high review of
`abeffb7..jellyfinmod-phase9` (plugin) and `95709dc6ca..jellyfinmod-phase9` (web), and for the user. Nothing is merged; the
plugin version stays 0.1.0.0 and nothing was published.

For the next agent or reviewer:

- Re-run the live chain with `scripts/jellyfinmod-e2e/p9-live.py` (`setup`, `unconfigured`, `configure`, `fetch`,
  `restart`, the browser runner `p9-ratings.mjs`, `failures`, `kill`, `leak`, `cleanup`); settings come from the environment
  and its docstring, and the stand-in from `standins/mdblist.mjs` started on the isolated instance's Docker network.
- The isolated instance runs this branch's plugin (0.1.0.0 from `0060c32`) and bundle `619599d6e666`; ratings are on with no
  key, so the 04:00 task does nothing. A backup of the plugin folder, its XML, secret store and database from before the
  deployment is on the test host under the instance's `backups/p9-before-20261007` (migrations are forward-only).
- For the user: supply the MDBList key in Settings → Ratings and press **Test** once; if it answers anything but `ok`, the
  code and sentence say what the real service did differently from the stand-in.
