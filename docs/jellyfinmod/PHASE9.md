# Phase 9 — ratings and title enrichment

**Future phase. Not scheduled. No entry gate is met.** Outline written 2026-09-21 so the request
and its feasibility are recorded; it becomes a full refinement (in the style of PHASE5–7) when it
starts. Read [PLAN.md](PLAN.md), [README.md](README.md) §4–§5, [UX.md](UX.md) §3, §4, §7 and §12,
[PHASE4.md](PHASE4.md) (secret store, user decision 3), [PHASE7.md](PHASE7.md) §5 and §7.1 and
[API.md](API.md) alongside it. Everything here is **Proposed, not user-approved** except the two
numbered decisions below; nothing authorizes a deployment, a third-party account or a change to
the isolated instance.

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

## Entry gates (none met)

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
