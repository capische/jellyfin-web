# Phase 1 follow-up: the full episode list for a discovered series

Design, 2026-10-12, Opus 5.5 high. Owner: Phase 1 (episode records, TMDB season and episode metadata, Refresh). The release
picker only reads the result. Plan entry: [`PLAN.md`](../PLAN.md), *Phase 1 follow-up*. Read with
[`PHASE10.md`](../PHASE10.md) §2 (position identity, RET-R2) and [`PHASE6.md`](../PHASE6.md) M3–M4 (automation).

## Recommendation

The plugin already has everything it needs except a trigger. **Every catalog entry has a TMDB series id**:
reconciliation creates no entry for a native series without a `Tmdb` provider id. And the administrator's **Refresh**
(`SeriesMetadataRefresher.RefreshAsync`) already loads the whole TMDB season and episode list for any series entry and
merges it with Phase 10's position rows under RET-R2. Nothing ever runs it for a discovered series, so the list is
never loaded. The fix has three parts:

1. **The web loads the list on demand.** When an administrator opens the release picker (or a file-less entry page) of
   a series whose list was never loaded, the web calls the existing `POST /JellyfinMod/Entries/{id}/Refresh` once,
   then shows its result.
2. **The plugin says whether the list is loaded** with a new `episodeListLoaded` flag on `EntryDetail`, and records the
   first load as an `episodes_listed` History event. The History event is the durable marker, so no migration is needed.
3. **Rows created by a Refresh follow the series' monitoring.** A discovered series is unmonitored, so its new rows are
   too, and automation never searches them.

Nothing else changes: no new table or column, no migration, no new TMDB call path, no new background work. What this
loses is that a series nobody opens keeps today's short list. A one-time bulk fill would avoid that, at the cost of
about 420 TMDB calls and a library-wide change to episode binding at once.

## Change, 2026-10-12: any user loads the list by opening the series (P1.FU9)

The user: "Why admin? I'd let any user to pull the show if it exists." Opening a native Peaky Blinders series page loaded
nothing, because only the picker and the file-less page asked, and only for administrators. Now:

- **Plugin:** `POST /JellyfinMod/Entries/{id}/EpisodeList` for anyone who may read the entry (the GET's own rule). It runs
  §3's load only while `episodeListLoaded` is false, answers the entry detail, shares one load between concurrent callers
  and answers failures as the Refresh does, leaving the list unloaded. The administrator's Refresh is unchanged and stays
  the way to refresh a loaded list. See [`API.md`](../API.md).
- **Web:** one hook, `useEpisodeListLoad`, on the native series and season pages and the file-less series page calls it
  once per entry per page visit, quietly (no loading or error line on the page), then refetches the entry. The picker keeps
  its *Loading Seasons…* step and shares the page's request.
- **Picker scope (user, 2026-10-12):** opened from a series page it offers only *All Seasons* and each season, after the
  non-selectable *Choose what to search for*; an episode is searched from its own page or its row.
- **Unchanged here:** the native pages show no new missing-seasons list; that is a separate design, built as P1.FU11
  (UX §7.2.1).

Where this document says "an administrator opens", read "anyone opens".

## 1. How a discovered series is identified at TMDB

- **The entry row always stores the TMDB series id.** `Entry.TmdbId` (`Data/Entry.cs`) is part of the unique key
  `(MediaType, TmdbId, TargetLibraryId)` (`Data/ModDbContext.cs`, `OnModelCreating`).
- **Reconciliation never creates an entry without a TMDB id.** `ReconciliationService.ReconcileAsync(snapshot, …)`
  returns `Unmatched` ("The native item has no usable TMDB identity") when `snapshot.TmdbId is not > 0`.
  `JellyfinNativeTitleSource` reads that id from the series item's provider ids (`ProviderTmdbId(item)` →
  `ProviderIds["Tmdb"]`). Jellyfin's TMDB series provider sets it even when the episodes were scraped from
  TVDB/Sonarr. This is why PHASE10 found 514 episodes with TVDB ids and none with TMDB ids, while their series still
  have TMDB ids.
- **Measured on a copy of 28096's database (2026-10-12):** 212 series entries, all with `TmdbId > 0`; 541 `Episodes`
  rows, all position rows (`TmdbId = 0`); no entry has a single TMDB episode row. The series in the user's report is
  Jellyfin item `fdfcea78…` / entry `8f9dcb37…`. On 28096 that is **1923** (TMDB 157744: provider ids
  Imdb/Tmdb/TvMaze/Tvdb), not The Wheel of Time. Its two season folders hold only a `do-not-remove.txt`, so it has no
  native episodes and no rows. The Wheel of Time entry `011eb75e…` has 8 position rows for its 8 native episodes.
- **Lookup order: the stored `Entry.TmdbId`, and nothing else.** TMDB `find` by tvdb/imdb id and a title-and-year search
  are not needed: an entry without a TMDB id cannot exist. If TMDB answers 404 for the stored id (a deleted or merged
  TMDB record), `RefreshAsync` throws `TmdbException(NotFound)` and the endpoint returns 404. The web then keeps
  today's list (see §5). Nothing is guessed.

## 2. When the list is fetched

**Recommended: on demand, the first time an administrator opens the release picker for the series (or the file-less
entry page), through the existing Refresh endpoint.**

| Option | Cost | Verdict |
| --- | --- | --- |
| On demand, admin opens the picker | 2 TMDB calls (series details, then every season appended; one more per further 20 seasons), once per series an admin actually opens. A 5-season show is 2 calls. | **Chosen.** Covers the path the user uses (picking a release), costs nothing for series nobody opens, and changes binding only for those series. |
| At reconciliation (backfill) | Every discovered series at once: about 212 series × 2 ≈ 420 calls on 28096, each followed by a write under the library lease and a series re-reconcile on the Pi. | Not chosen. It slows the first backfill and changes binding behaviour (see §4) for the whole library at once. |
| In the daily metadata refresh (`AutomationRunner.RefreshAiringSeriesAsync`) | Runs only when automation is on and acquisition is ready, and only for monitored series. | Not chosen. A discovered series is unmonitored and automation is often off. |
| GET entry detail fetches inline | Adds TMDB latency to a page load. | Not chosen. It would slow page loads. |

- **What the web shows while the list loads:** the picker opens at once with the list it has. Its scope switch shows
  one disabled row, *Loading seasons…*, until the Refresh answers. It then replaces the episodes and keeps the current
  selection if that episode is still in the list.
- **When the load fails** (TMDB not configured, 404, timeout, a busy library): the picker keeps today's list and adds
  one muted line, *Could not load every season from TMDB.* Nothing is retried automatically in that session. The next
  opening tries once more, because `episodeListLoaded` is still false.
- **Later seasons.** A loaded discovered series is refreshed like any unmonitored added series: by the administrator's
  Refresh Metadata. The daily refresh covers monitored series only (P6.M4, unchanged).

## 3. Persistence: rows, not a read-only list

**Recommended: (a) materialise `Episode` rows.** That is exactly what Refresh already does.

- **Why rows.** A pick, a grab, an import and a season pack all name an `Episode` row (`ReleasesController.Search`
  needs `episodeId`, and `SearchPackAsync` → `ReleaseTargets.Covered(episodes, …)` reads the entry's rows). A
  read-only list would need a second "create on pick" path, its own identity rules and its own tests. Rows reuse the
  merge that is already reviewed.
- **The merge is already RET-R2** (`SeriesMetadataRefresher.RefreshAsync`):
  - A TMDB episode at a position a position row holds is **adopted** only with evidence:
    `EpisodeIdentityEvidence.Agrees`, the same title, or the same air date within a day when no neighbour airs that
    close. The row keeps its id, bindings, Keep and retention evidence, and History records `episode_adopted`.
  - Without evidence the TMDB episode is **skipped**: no second row is created at a held position.
  - Every other TMDB episode becomes a new row (`TmdbId > 0`, `State = None`, no binding).
  - Unmatched local rows are never deleted.
  - Add (`CompleteConcurrentAdd`) never adopts; that is unchanged.
- **No migration.** Indexes already in place (`ModDbContext.OnModelCreating`):
  - unique `(EntryId, TmdbId)` where `TmdbId <> 0`, one TMDB row per identity;
  - unique `IX_Episodes_EntryId_Position` `(EntryId, SeasonNumber, EpisodeNumber)` where `TmdbId = 0`, one
    position row per position;
  - non-unique `(EntryId, SeasonNumber, EpisodeNumber)`.

  The refresher guarantees in code that no TMDB row sits beside a position row (PHASE10 S3). The "was the list
  loaded" marker is a History row (`EventType = "episodes_listed"`), not a column.
- **Availability needs no change.** `EpisodeDto.Availability` is derived from the row (`Api/Contracts/EpisodeDto.cs`):
  - `onDisk` when `State == OnDisk`;
  - `reclaimed` when `State == Reclaimed`;
  - `unaired` when the air date is after today (UTC);
  - otherwise `missing`, which includes a row with no air date.

  New rows start with `State = None`, so they read `missing` or `unaired`. Reconciliation sets `onDisk` when a file
  binds.
- **Monitoring of new rows (the one behaviour change).** Today a Refresh adds new rows monitored unless a bound file
  already covers the number (RET3-R5). After this change, rows a Refresh creates are monitored only when **the series
  is monitored**: `remote.Monitored = entry.Monitored && !covered`. A discovered series has `Monitored = false`
  (reconciliation creates it so), so its whole list arrives unmonitored, like its position rows (PHASE10 S11). For a
  monitored series nothing changes. An administrator who refreshes a series they stopped monitoring now also gets its
  new episodes unmonitored, which is consistent and rare.

## 4. Interactions that must not break

- **Phase 6 automation** (`AutomationRunner.TargetsAsync`): it reads only `entry.Monitored` entries, then
  `episode.Monitored && SeasonNumber > 0 && AirDate != null` aired episodes.
  - A discovered series fails both gates, the entry and now every new row, so nothing is searched or upgraded.
  - `RefreshAiringSeriesAsync` also requires `entry.Monitored`, so the daily refresh never picks discovered series up
    (no TMDB cost).
  - `GrabService.AutomaticBlockAsync` refuses automatic grabs for unmonitored targets.
  - A **manual** grab from the picker needs no monitoring (only automatic grabs check it). That is what the user wants.
  - If the administrator later turns Monitor on for the series, nothing is searched until episodes are monitored
    one by one or the series is re-added. See open question 1.
- **Phase 10 retention.** Retention targets are bound rows only: `RetentionEvaluator` joins `EpisodeBindings`. New
  file-less rows are never evaluated, previewed or reclaimed. A series becomes `reclaimed` when its last episode
  binding goes (T14), which file-less rows do not affect. Existing position rows and their bindings, Keeps,
  `VersionKeeps` and evaluations are untouched. An adopted row keeps all of them, because it is the same row.
- **Binding of native episodes to the new rows** (`ReconciliationService.ReconcileEpisodes`):
  - A native episode without a TMDB id binds by season and number to an existing row. With the full list, a file that
    **arrives later** at a position no position row holds binds to the TMDB row there, instead of getting a new
    position row.
  - When neither the title nor the air date agrees, that binding is marked `IdentityUnverified`.
    `RetentionExecutor` then refuses to unlink it (`identity_unverified`), and `UpgradeService` will not replace it.
  - For the 514 (now 541) native episodes already bound to position rows **nothing changes**: they stay on their rows.
    A row adopted with evidence re-checks the same evidence on its binding. In the rare case where the adoption
    matched on air date but the binding check sees a neighbour within a day, that binding becomes
    `IdentityUnverified`.
  - Verdict: **desirable**. A later file is tracked against the right TMDB episode, and the doubtful case fails safe:
    a file is kept rather than reclaimed under the wrong identity. No switch is needed.
- **Phase 5 import of a grabbed episode.** The grab names the TMDB row and the import writes `SxxEyy` into the series'
  existing folder (`ImportService`, existing series folder). Jellyfin scans the file and reconciliation binds it to
  that row by number. The title or air date usually agrees with TVDB's, so the binding is verified. Unchanged code.
- **Specials (season 0).** TMDB lists season 0, and its rows are created like any other. Automation never searches
  season 0. Packs exclude it (`ReleaseTargets.Covered`). The picker lists specials as single episodes. TVDB and TMDB
  often number specials differently, so a special on disk can also appear as a missing TMDB special: a known,
  harmless duplicate in the list, never a duplicate binding.
- **Renumbered episodes, absolute or date numbering.** Where the library's TVDB numbering differs from TMDB's (split
  seasons, anime absolute order, daily shows), RET-R2 adopts nothing without evidence. The TMDB episodes at different
  numbers then appear as `missing` beside the files that hold them. They are unmonitored, so nothing downloads them;
  a person could pick one by hand. The common path (a western series where Sonarr's TVDB order equals TMDB's) adopts
  cleanly by title. Daily shows rely on the existing neighbour rule (RET3-R5).
- **Entry summaries.**
  - `retention`: the series aggregate is built from evaluations of readable targets, and file-less rows have none, so
    it is unchanged.
  - `history`: one new event, `episodes_listed`, "Loaded N seasons and M episodes from TMDB", written once, at the
    first load. Adoptions add `episode_adopted` as today.
  - `acquisition`: unchanged.

## 5. Web

What the web reads today:

- `EntryDetail.episodes`, with `availability` and `monitored` per row.
- The picker's episode list is `pickerEpisodes(episodes)` (`integration/releasePicker.ts`): missing and reclaimed
  rows first, labels `S01E03 · Title`, with ` (on disk)` or ` (unaired)` appended.
- Its scope switch is `scopeOptions` (`components/ReleasePickerDialog.tsx`): All Seasons, each season with aired
  non-special episodes, then every episode (since 2026-10-12 a series page lists no single episodes).
- The native series page (`NativeEntryDetails`) does not list plugin episodes for any series, discovered or added. It
  shows only in-flight episodes and Episode Retention. A file-less entry page (`EntryDetails`) lists `episodes`.

Changes, kept small:

1. **Type:** add `episodeListLoaded: boolean` to `EntryDetail` in `api/modApi.ts`.
2. **One helper** in `integration/releasePicker.ts`:
   `loadFullEpisodeList(api, entryId, detail)`.
   - When `mediaType === 'series' && !episodeListLoaded` and the user is an administrator, it calls `refreshEntry`.
   - It resolves to the refreshed episodes, or to `null` on any failure.
3. **The picker:** `openReleasePicker` and `openReleasePickerForEntry` pass `episodeListLoaded`. When it is false,
   `ReleasePickerDialog` starts the helper on mount.
   - While it runs, the scope list holds a disabled *Loading seasons…* option.
   - On success it swaps in `pickerEpisodes(refreshed)`.
   - On failure it shows the muted line from §2.

   `scopeOptions` and `pickerEpisodes` need no change: the extra seasons and episodes arrive as ordinary rows with
   `missing`/`unaired` availability. The labels already say *(unaired)* and *(on disk)*; a missing episode stays
   unlabelled, as today.
4. **The file-less entry page** (`EntryDetails`) runs the same helper once on mount for administrators, so a fully
   reclaimed discovered series lists its seasons too.
5. **The native series page** gets no new episode list (open question 2): a TMDB-added series does not have one either,
   so parity needs none. A missing-seasons list there would be a new UI and goes through the mockup gate.
6. **Docs:** [`API.md`](../API.md) gets the new field and the `episodes_listed` event.

## 6. Verification

Per CLAUDE.md: real HTTP boundary E2E, no unit tests, isolated instances only, never 8096.

- **Phase 1 smoke** (`tests/PhaseOneSmoke/ApiSmoke.cs`, real Kestrel with the plugin's controllers, auth and
  serializer, SQLite from the full migration chain, and the TMDB stand-in at `/3/{**path}`). Add a *discovered series*
  case:
  - **Setup:** an unmonitored series entry with a `backfilled` History row and two position rows (S01E01 "Pilot"
    on disk, S01E02 under a TVDB title that TMDB names differently, on disk).
  - **Before Refresh:** `GET /Entries/{id}` returns `episodeListLoaded: false`.
  - **TMDB stand-in lists:** S00E01 special; S01E01 "Pilot" (adopted by title); S01E02 with another title and a date
    two days off (not adopted, no second row); S01E03 aired (missing); S02E01 in 2099 (unaired).
  - **After admin Refresh:**
    - 5 rows;
    - the S01E01 row keeps its id and binding and has a TMDB id;
    - the S01E02 position row is untouched, and no TMDB row sits at S01E02;
    - S01E03 is `missing`, S02E01 is `unaired`, S00E01 is present;
    - every new row is `monitored: false`;
    - `episodeListLoaded: true`;
    - exactly one `episodes_listed` History event.
  - **A second Refresh** adds no second `episodes_listed`.
  - **An ordinary user's Refresh** answers 403.
  - **A TMDB 404** answers 404 and leaves the rows, and `episodeListLoaded` stays false.
  - **The existing added-series refresh case** additionally asserts that its new episode (9003) arrives `monitored:
    true`, so a monitored series is unchanged.
- **Re-run unchanged** on the Mac, per *Suites on the Mac first*: Phase 0 and Phase 1 smoke, Phase 2 (reconciliation
  binding), Phase 3 (retention, Refresh metadata-only T10), Phase 3 protection, Phase 6 (automation targets and the
  daily refresh), Phase 9 if present on the branch, Phase 10 (position rows, adoption), and Q16 Trakt. Phase 4 and
  Phase 5 run on the Pi only if the import path changes; it does not.
- **Live acceptance, plugin side**, on a free **local** environment (`lease.sh claim bravo…`; not 28096, which the
  user is testing; not 18096; never 8096):
  - deploy the plugin build;
  - pick a discovered series with position rows and missing seasons, and record its rows;
  - `POST /Entries/{id}/Refresh` as `oleksii`;
  - compare the rows with TMDB's season pages, confirm there is no duplicate at any held position and every new row
    is unmonitored;
  - run an automation pass, which must report no target for the series;
  - check that the retention preview is byte-identical before and after;
  - restore the database backup and release the lease.
- **Live acceptance, web side** (later, after the web worktree is free), in Playwright Chromium, then real Chrome.
  First look on one environment:
  - open the picker on a discovered series: *Loading seasons…*, then every season and episode, with unaired marked;
  - grab nothing;
  - confirm the failure line with the TMDB token removed on the local environment.

## 7. Risks, open questions, estimate

**Risks**

- **Numbering mismatches** (anime, split seasons, specials) show TMDB episodes as `missing` beside files that hold
  them. These rows are unmonitored, so the only exposure is a manual pick of a duplicate.
- **A Refresh waits for the retention gate.** A long retention run can make the first picker load time out (60 s) and
  fall back to today's list.
- **A shared database.** Rows created on 28096 or 18096 by a Refresh stay; they are ordinary Refresh results and need
  no cleanup. Live runs use a local environment and restore its backup.

**Open questions for the user** (implementation proceeds on the recommended answers)

1. **Monitoring of a discovered series' full list:** new rows unmonitored, so turning Monitor on for the series searches
   nothing until episodes are monitored one by one (recommended, matches PHASE10 S11 "discovered, not wanted"). The
   alternative is rows monitored like an Add, gated by the series: turning Monitor on would then search the whole
   back catalogue.
2. **The native series page:** no new missing-seasons list; parity with TMDB-added series is the picker
   (recommended). The alternative is a new missing/unaired episode list on the native series page, which needs a
   mockup first.
3. **When to load:** on demand when an administrator opens the picker (recommended). The alternative is a one-time
   background fill of every discovered series, about 420 TMDB calls on 28096 and a library-wide binding change at
   once.

**Estimate (agent time).** The plugin side (tasks 1–4) is about one hour of one 5-hour window, suites included. The web
side (tasks 5–8) is about 1.5 hours, plus the first-look gate. One Codex review at the end. In total, under one
5-hour window and about 3–5% of the weekly allowance.

## Tasks for the implementer

Plugin (`plugin-nextrelease`, branch `next-release`):

1. **p1.fu1** `fix(catalog,p1.fu1): add a refreshed series' new episodes only as monitored as the series`.
   `SeriesMetadataRefresher.RefreshAsync`: in the new-row branch, `remote.Monitored = false` when `!entry.Monitored` or
   the position is covered.
2. **p1.fu2** `feat(catalog,p1.fu2): record the first tmdb episode list and report it on entry detail`.
   - The refresher adds History `episodes_listed` ("Loaded N seasons and M episodes from TMDB") when the entry had no
     TMDB episode row before the Refresh and has no such event.
   - `EntryDetail.EpisodeListLoaded` (`episodeListLoaded`) is true for a movie, or for a series with a TMDB row or
     that event.
3. **p1.fu3** `test(catalog,p1.fu3): cover the full episode list of a discovered series`. Add the Phase 1 smoke cases in
   §6, then run the Mac suites.
4. **p1.fu4** `perf(catalog,p1.fu4): fetch a series' seasons in one TMDB request`: `TmdbClient.GetEpisodesAsync`
   appends up to 20 seasons per request (`append_to_response=season/N`) and reads any season TMDB leaves out on its
   own. A series takes 2 requests: its details, then every season appended.

Web (`jellyfin-web-nextrelease`, branch `next-release`, after the other agent's work lands):

5. **p1.fu5** `feat(release-picker,p1.fu5): load a discovered series' full episode list when the picker opens`: the
   type, the helper, the picker loading row and the failure line.
6. **p1.fu6** `feat(entry-page,p1.fu6): load the full episode list on a file-less series page`.
7. **p1.fu7** `docs(api,p1.fu7): document episodeListLoaded and episodes_listed`, in `API.md`. Update the PLAN.md entry
   to *built (not accepted)*.
8. **p1.fu8** Live: the first look on one local environment, then the matrix (Chromium, real Chrome; desktop, mobile,
   TV), then the Codex review of both diffs.
