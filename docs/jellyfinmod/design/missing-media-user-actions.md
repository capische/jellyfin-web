# Missing media behaves like available media (P1.FU24–29, planned)

**Status:** P1.FU24, P1.FU25, P1.FU26 and P1.FU28 built (not accepted), 2026-10-15; P1.FU27 and P1.FU29 built (not accepted), 2026-10-17. Missed Phase 1 requirement (user, 2026-10-13).
Approved by the user on 2026-10-15 ("Go and implement isPlaceHolder"; on the questions of section 9: "go with your
recommendations"). The answers are in section 10, the FU28 design in section 11, and what FU24, FU25, FU26 and FU28 built in
sections 12 to 16; what FU29 fixed in section 17.
**Owner:** Phase 1 (the TMDb catalog: entries, episode records, what Jellyfin shows for them). It touches Phase 5 (the import
replaces a placeholder with the real file), Phase 3/10 (retention never reclaims a placeholder and writes one back after a
reclaim), Phase 4 (Get a Release and the download states on placeholder items) and Phase 6/7 (Play hidden, the marks, the
TV layout).

**The requirement, in the user's words (2026-10-13).** "I expect those buttons to be available similarly to 'available
media'. Media availability should not affect watched, fav, info and other actions. EVERYWHERE." "That should be expected in
TMDb phase." On a first plan that kept the state in a plugin table: "Why do I need a table if Jellyfin should have it?
Research Jellyfin API." "I'd expect everything will behave EXACTLY as when the file exists, but in our case no media file is
available. So it should be visible everywhere where with media it appears." "I believe Jellyfin works fine without media
files as if I keep season folders it shows all buttons and they work." On native apps: Next Up "matters as iOS clients may
use jellyfin server". Already answered: marking a season or series watched marks its missing episodes ("If Jellyfin has it
as watched, it means it's watched!"); a missing episode marked watched arrives watched with its date when the file comes.

So the bar is: **a missing movie, series, season or episode is a real Jellyfin item, with Jellyfin's own cards, pages,
buttons, Favourites, filters, counts, search and per-user data, for the mod's web and for stock apps alike; only Play is
absent, and nothing offers it as playable.** "Missing" means anything the plugin knows from TMDB without a file: a missing
episode or season of a series Jellyfin holds, a whole file-less series or movie, and a reclaimed episode or movie.

The first version of this plan (a plugin table `UserEntryStates` with its own API) is **withdrawn**: it would only ever
reach the mod's own surfaces.

---

## 1. Research

Sources: the Jellyfin 12.0.0 server source (tag `v12.0`, commit `6c073e1`), upstream jellyfin-web in this fork, read-only
config of 28096, and experiments on local environment **delta** (Jellyfin 12.0.0 with the plugin, the baseline clone of
28096's configuration). Two leases, both reset to the baseline afterwards and released: 21:17–21:29 Sydney (virtual items,
empty folders, `.strm`) and 22:14–22:27 (`.disc` media stubs and a throwaway response-filter plugin). The libraries were
pointed at writable copies (Peep Show (2003): S01E01–E02 on disk; TMDB lists 9 seasons, 54 episodes). Users: oleksii
(administrator, *Display missing episodes* **on**, as on production) and nata (ordinary user, off), queried with `userId`.
Every request below is plain HTTP with a user token, as a native app sends it.

### 1.1 Experiment results

| # | What was done | What Jellyfin did |
| --- | --- | --- |
| E1 | Jellyfin's built-in TMDB "import missing/unaired episodes" turned on for Shows, series refreshed | 8 virtual seasons and 52 virtual episodes (`LocationType Virtual`, TMDB id on each), name, overview, date, still only |
| E1 | oleksii marks virtual S1E3 played (2026-01-05) and favourite, S2E1 played, virtual Season 3 favourite | Stored (user-data key `71656001003` = series TVDB id + `001003`) |
| E1 | Feeds, oleksii | Played filter, `/Items` favourites and `/Items?searchTerm` include them; **web Favourites tab query (`ExcludeLocationTypes=Virtual`) 0; `/Search/Hints` 0; Latest 0; Next Up 0; every virtual season Played, unplayed 0**; series counts ignore all 52 |
| E1 | Feeds, nata | **Nothing** (only `/Items?searchTerm`) |
| E3 | A file arrives for marked virtual S1E3 | Virtual episode deleted, new episode re-attaches the parked user data by key: **new item id, played, favourite and date kept** |
| E2 | Built-in import turned off again (its default), series refreshed | **Every virtual episode and season deleted**; Season 3's favourite parked |
| T1 | Empty `Season NN` folders, empty series folders (Ted Lasso, Kleo S2) | Real items; ♥ works, Favourites tab and search list them; **always Played** (no children = played; *mark unplayed* does nothing); empty movie folder makes **no movie** |
| T5 | `.strm` (a dead URL), 0-byte `.mkv`, lone `.nfo` in `Season 03` | `.strm` and 0-byte `.mkv` become episodes with full TMDB metadata (overview, still, 14 and 9 people), no runtime; 0-byte `.mkv` logs an ffprobe error on each refresh; `.nfo` alone makes nothing |
| T6 | Feeds with placeholders, both users | **As with media**: Favourites tab query, Played filter, `/Search/Hints`, season and series counts; **Next Up offers the placeholder; Latest lists placeholders** |
| T7, T8 | Placeholders replaced: `.strm`→`.mkv`, 0-byte `.mkv` overwritten, movie `.strm`→`.mkv` | New id (or same id at the same path); **played, favourite and date kept** every time |
| T9 | Placeholder `DateCreated` set to 2008 through `POST /Items/{id}`, then a full replace-all refresh | Kept; the placeholder leaves the head of Latest |
| X1 | **Media stubs**: `… S01E03 - On The Pull.disc`, `… S02E01 - Dance Class.disc`, `Nosferatu (2024)/Nosferatu (2024).disc` (0 bytes) | Real Episode and Movie items, full TMDB metadata (13 people), **`IsPlaceHolder: true` in the API**, not probed (no error), no runtime |
| X1 | Native-client calls on S1E3 `.disc`, S1E1–E2 played, S1E4 a real file | `GET /Shows/NextUp` → **`[S1E3 (IsPlaceHolder true)]`**; `POST /Items/{id}/PlaybackInfo` → a `disc` media source with **`SupportsTranscoding: true` and a transcoding URL**; `GET /Items/{id}/Download` → the stub file; `CanDownload: true` |
| X2 | A throwaway plugin (`JfmodProbe`, 90 lines) registers an MVC filter through `IPluginServiceRegistrator`; container restarted; same calls | Plugin `Active`; `GET /Shows/NextUp` → **`[]`, Total 0** (log: "removed 1 placeholder(s) from Next Up"); `PlaybackInfo` → **`ErrorCode: NotAllowed`, no media sources**; `Download` → **404** |
| X3 | `.disc` episode and movie marked played (2025-09-09) and favourite, replaced by `.mkv` | **Played, favourite and date kept** on the new items |
| — | The plugin's view of the series with placeholders | Every placeholder episode reported **onDisk** (reconciliation does not know placeholders yet) |

### 1.2 What the code says (links to `v12.0`)

- **Virtual items** are hidden unless the user turns on *Display missing episodes*
  ([`TvShowsController.cs` L231](https://github.com/jellyfin/jellyfin/blob/v12.0/Jellyfin.Api/Controllers/TvShowsController.cs#L231),
  [`Series.cs` L250](https://github.com/jellyfin/jellyfin/blob/v12.0/MediaBrowser.Controller/Entities/TV/Series.cs#L250),
  [`ItemCountService.cs` L484](https://github.com/jellyfin/jellyfin/blob/v12.0/Jellyfin.Server.Implementations/Item/ItemCountService.cs#L484)),
  and always excluded from Latest ([`UserViewManager.cs` L364](https://github.com/jellyfin/jellyfin/blob/v12.0/Emby.Server.Implementations/Library/UserViewManager.cs#L364)),
  search hints ([`SqlSearchProvider.cs` L110](https://github.com/jellyfin/jellyfin/blob/v12.0/Emby.Server.Implementations/Library/Search/SqlSearchProvider.cs#L110)),
  resume ([`ItemsController.cs` L988](https://github.com/jellyfin/jellyfin/blob/v12.0/Jellyfin.Api/Controllers/ItemsController.cs#L988))
  and, in upstream web, the Favourites tab (`favorites.js` L198, `favoriteitems.js` L104). The built-in TMDB provider deletes
  every TMDB-tagged virtual episode while its feature is off
  ([`TmdbMissingEpisodeProvider.cs` L80, L450](https://github.com/jellyfin/jellyfin/blob/v12.0/MediaBrowser.Providers/Plugins/Tmdb/TV/TmdbMissingEpisodeProvider.cs#L450-L463)).
- **User data needs an item** (`UserData` rows reference `BaseItems`; the played/favourite endpoints 404 for an unknown id).
  A deleted item's data is parked 90 days and re-attached by key
  ([`ItemPersistenceService.cs` L50–L123](https://github.com/jellyfin/jellyfin/blob/v12.0/Jellyfin.Server.Implementations/Item/ItemPersistenceService.cs#L50-L123),
  [`MetadataService.cs` L261](https://github.com/jellyfin/jellyfin/blob/v12.0/MediaBrowser.Providers/Manager/MetadataService.cs#L261),
  [`Folder.cs` L687](https://github.com/jellyfin/jellyfin/blob/v12.0/MediaBrowser.Controller/Entities/Folder.cs#L687-L697)).
- **Media stubs are a stock Jellyfin feature** (the Kodi "media stub" convention): a `.disc` file
  ([`NamingOptions.cs` L92–L137](https://github.com/jellyfin/jellyfin/blob/v12.0/Emby.Naming/Common/NamingOptions.cs#L92-L137))
  resolves to a video with `IsPlaceHolder = true`
  ([`BaseVideoResolver.cs` L148](https://github.com/jellyfin/jellyfin/blob/v12.0/Emby.Server.Implementations/Library/Resolvers/BaseVideoResolver.cs#L148)),
  sent to every client as `BaseItemDto.IsPlaceHolder`
  ([`DtoService.cs` L1215](https://github.com/jellyfin/jellyfin/blob/v12.0/Emby.Server.Implementations/Dto/DtoService.cs#L1215)),
  never probed ([`ProbeProvider.cs` L282](https://github.com/jellyfin/jellyfin/blob/v12.0/MediaBrowser.Providers/MediaInfo/ProbeProvider.cs#L282)),
  no image extraction, trickplay or chapters. Upstream web refuses to play it with its own message (`playbackmanager.js`
  L2397, `PlaybackErrorPlaceHolder`) and hides its Play buttons (`cardBuilder.js` L841, `CardOverlayButtons.tsx` L22,
  `itemHelper.js` L307). Kodi shows a stub's own message instead of playing (Kodi's documented media-stub behaviour; not
  tested here).
- **Next Up** ([`NextUpService.cs` L195–L240](https://github.com/jellyfin/jellyfin/blob/v12.0/Jellyfin.Server.Implementations/Item/NextUpService.cs#L195-L240))
  takes, per series, the first episode after the last played one among episodes that are **not virtual** and not played,
  filtered only by library, parental rating, tags and alternate versions
  ([`BaseItemRepository.QueryBuilding.cs` L459–L476](https://github.com/jellyfin/jellyfin/blob/v12.0/Jellyfin.Server.Implementations/Item/BaseItemRepository.QueryBuilding.cs#L459-L476)).
  `IsPlaceHolder` is not consulted.
- **Played on stop:** a playback stop with no position, or on an item without a runtime, marks it **played**
  ([`SessionManager.cs` L1165–L1186](https://github.com/jellyfin/jellyfin/blob/v12.0/Emby.Server.Implementations/Session/SessionManager.cs#L1165-L1186),
  [`UserDataManager.cs` L439–L500](https://github.com/jellyfin/jellyfin/blob/v12.0/Emby.Server.Implementations/Library/UserDataManager.cs#L439-L500)).
- **Plugins can shape stock responses.** `IPluginServiceRegistrator.RegisterServices` runs on the host's own
  `IServiceCollection` in `appHost.Init`, inside `Host.ConfigureServices`, before the provider is built
  ([`ApplicationHost.cs` L490–L492](https://github.com/jellyfin/jellyfin/blob/v12.0/Emby.Server.Implementations/ApplicationHost.cs#L490-L492),
  [`Program.cs` L172](https://github.com/jellyfin/jellyfin/blob/v12.0/Jellyfin.Server/Program.cs#L172)); MVC is configured
  later with `AddMvc(opts => …)` ([`ApiServiceCollectionExtensions.cs` L111–L163](https://github.com/jellyfin/jellyfin/blob/v12.0/Jellyfin.Server/Extensions/ApiServiceCollectionExtensions.cs#L111-L163)),
  so a plugin's `Configure<MvcOptions>(o => o.Filters.Add…)` applies to every stock controller. Precedent: the **File
  Transformation** plugin, installed on the instances, registers an `IStartupFilter` with middleware to rewrite responses
  (found in its DLL); X2 proves the MVC-filter route live.

### 1.3 The options against "exactly like available media"

| | A. Virtual items (plugin-made, or Jellyfin's built-in import = D) | B. Media-stub placeholders (`.disc`) where the import puts the file | C. A separate library of placeholders | D. User data without an item |
| --- | --- | --- | --- | --- |
| Item and user data | yes | yes | yes | **impossible** |
| Seen without *Display missing episodes* | **no** | yes | yes | — |
| Favourites tab, filters, counts, season ✓, search | **no / wrong** in five places (E1) | **as media** (T6) | as media, but under a second copy of the series | — |
| Metadata | thin (built-in) or the plugin's | full, Jellyfin's own providers | full | — |
| File-less movie | no supported path | yes | yes | — |
| Carry-over when the file arrives | yes | yes (X3) | **no** | — |
| Pruned by Jellyfin | yes (E2) | never | never | — |
| Marked as unplayable to every client | `LocationType Virtual` | **`IsPlaceHolder: true`** (stock field) | same | — |
| Writes into the media folders | no | **yes** (0-byte `.disc` files, `Season NN` folders) | a plugin folder | no |
| Next Up, PlaybackInfo, Download for stock apps | excluded / n.a. | **offered** unless a plugin filter shapes them (X1, X2) | same | — |
| Plugin off | stays (built-in) | stubs stay as unplayable items until removed | stays | — |

**Verdicts.** A is rejected (fails the bar in five measured places, needs every user's setting changed, is deleted by
Jellyfin's own provider). C is rejected (series never group across libraries; no carry-over). D is impossible. Empty
folders alone give the right shell but are always ✓ and make no movie. **B meets the bar**, and with `.disc` (instead of the
earlier `.strm`) it uses Jellyfin's own placeholder concept: every client is told `IsPlaceHolder`, nothing is probed, upstream
web refuses to play it natively. What B leaves open for stock apps is section 3.

---

## 2. Recommendation: media stubs laid out as the import lays out files, plus a response filter

### 2.1 Placeholders

For every missing item it knows from TMDB, the plugin keeps the folder and file **the import would create**, as a
**`.disc` media stub** (0 bytes in the experiments; the built writer puts a marker line and Kodi's stub message in it, section 10):

| Missing | What the plugin writes | What Jellyfin makes of it |
| --- | --- | --- |
| Episode of a series Jellyfin holds | `…/Season NN/<import file name>.disc` | an Episode, `IsPlaceHolder`, full TMDB metadata |
| Season | `…/Season NN/` + one stub per episode | a Season with correct ✓ and counts |
| File-less series | `<Series> (<Year>) [tmdbid-N]/Season NN/…disc` | Series, seasons, episodes |
| File-less movie | `<Title> (<Year>) [tmdbid-N]/<Title> (<Year>) [tmdbid-N].disc` | a Movie |
| Reclaimed episode or movie | the same stub written back when retention removes the file | the item returns; its user data re-attached by key |

- **Where:** the import's destination rule (PHASE5 *Destination naming*): the bound native folder when the entry has one,
  else a new folder in the library's writable root. Read-only series folders (28096's `/data5`) get their stubs in the
  writable root as a second folder of the series, merged by Jellyfin only with **automatic series grouping** on (on in
  28096's Shows); without it the plugin writes nothing for that series (fallback, 2.4).
- **Recognised as ours** by the `.disc` extension in a plugin-written path plus the item's `IsPlaceHolder`; an optional
  one-line stub body (Kodi's `<discstub><message>Not downloaded yet</message></discstub>`) is left to question 4. No
  migration: reconciliation reads the files.
- **After Jellyfin creates the item** the plugin sets its `DateCreated` to the air or release date (T9; Latest then shows
  real arrivals) and its runtime from TMDB (upstream's runtime line, and a stop report can no longer mark it played by
  "unknown runtime").
- **Unaired episodes** get stubs like aired ones; question 3. **When TMDB drops an episode** its stub goes.
- **Import:** deletes the stub and links the file in one step before the scan (carry-over, X3); `target_exists` ignores stubs.
- **Retention:** never reclaims, counts or protects a stub; a reclaim writes the stub back in the same step. The carried
  watched date is the user's original one, not a fresh completion for Phase 10 (suite check).
- **Reconciliation:** binds a stub item as not on disk (none, unaired, reclaimed), never `onDisk`.
- **Mod web:** Play hidden on `IsPlaceHolder` items (upstream web already hides most of it; P1.FU19's centre Get a Release
  for administrators), the marks and the download block. Everything else is upstream's own.

### 2.2 The response filter (for stock apps)

One plugin MVC filter (`IAsyncActionFilter` + `IAsyncResultFilter`, registered through `IPluginServiceRegistrator`, proven by
X2), touching only items that are the plugin's stubs:

| Endpoint | Shaping |
| --- | --- |
| `GET /Shows/NextUp` | Remove stub episodes (X2). What replaces them is question 2: drop the series (as X2 did) or re-ask Jellyfin for the next real episode after the stub |
| `POST/GET /Items/{id}/PlaybackInfo` | `ErrorCode: NotAllowed`, no media sources (X2): no client can start a transcode of a stub |
| `GET /Items/{id}/Download`, `/Videos/{id}/stream*`, `/Audio…` not applicable | 404 (X2 for Download; the stream routes by the same action filter, not run) |
| `POST /Sessions/Playing`, `/Playing/Progress`, `/Playing/Stopped` | Ignored for stubs, so no client report can mark one watched (belt and braces with the runtime) |
| Item DTOs (`BaseItemDto.CanDownload`) | `false` for stubs, so apps hide their download button (not run) |

Paging: Next Up loses the removed series' slot (a page of 20 can come back with 19). Dropping is exact otherwise; filling
the slot needs a second internal Next Up call, which the slice does only if question 2 asks for "next real episode".

---

## 3. Native clients: every surface where a stub could misbehave

"Item property" means something the plugin sets on the stub item; "filter" means 2.2; "core" means a Jellyfin server change.

| Surface (stock app) | Without the filter | Fix | Verified |
| --- | --- | --- | --- |
| Next Up | offers the stub (X1) | **filter** (X2). No item property excludes an item from Next Up alone: only virtual (breaks counts, Favourites, visibility), parental rating or blocked tags (hide it everywhere for that user), or alternate version (hides it everywhere) | yes |
| Continue Watching / Resume | only items with a resume position; a stub never gets one when playback is blocked | acceptable | code |
| Latest | lists stubs (T6) | **item property** `DateCreated` = air date (T9); arrivals are new items | yes |
| Auto-play of the next episode after a real one | the app queues the stub; upstream web refuses it (`IsPlaceHolder`); other apps call PlaybackInfo and get `NotAllowed`, playback stops with an error | **FU28:** the mod's web drops stubs from every queue it builds; the filter drops them from `/Shows/{id}/Episodes` queues asked with `startItemId` (upstream web, Android TV); other native queues stop at the stub (section 15) | yes (web, HTTP) |
| Play All / Shuffle / Instant Mix / queue a season | same as auto-play: stops at the stub with an error | **FU28:** fixed in the mod's web; Instant Mix is audio only in Jellyfin 12 (no stub can be in it); native apps' season and library queues not reachable (section 15) | yes (web) |
| Series **Play** button (web asks `/Shows/NextUp?seriesId=` for where to start) | starts at the stub (refused) | **FU28:** Next Up answers the next real episode, so the web (and Findroid, Android TV, which ask Next Up too) start there | yes |
| Offline download / sync (iOS, Findroid) | downloads the 0-byte stub | **filter** (404, `CanDownload` false) | Download yes, DTO no |
| Played by playing to the end | a stop with no position or on an item with no runtime marks it played (code) | **item property** runtime + **filter** on playback reports + PlaybackInfo blocked | code |
| Media info, file size, versions | a `disc` source with no streams, size 0 | acceptable (shows as a placeholder) | yes |
| Transcoding a stub | offered (X1) | **filter** (PlaybackInfo, stream routes) | PlaybackInfo yes |
| Trakt plugin (installed) collecting or scrobbling stubs; InfuseSync | not checked | to verify before enabling (question 1); a scrobble cannot happen with playback blocked | no |
| Library statistics (`/Items/Counts`) | counts stubs as episodes and movies | acceptable (they are listed items) or filter | no |
| "Recently added" notifications, webhooks | fire on stub creation | acceptable; Jellyfin 12 has no built-in ones; the Webhook plugin is not installed | code |
| NFO and image savers | write sidecars next to stubs where the library saves NFO | acceptable; reused by the real file (same base name); stub removal removes its own sidecars | no |
| Scan cost of thousands of stubs | no probe; one TMDB metadata refresh and still per stub | batched backfill, measured on 28096 | no |
| Kodi (jellyfin-kodi) | stubs synced as items; native-path mode plays the `.disc` path, which Kodi treats as a media stub and shows its message | acceptable | no |

**Nothing in this list needs a core change.** The one behaviour a plugin filter cannot reach is server-internal: a
server-driven "play next" for remote control and casting builds its episode list inside `SessionManager`
([L1399](https://github.com/jellyfin/jellyfin/blob/v12.0/Emby.Server.Implementations/Session/SessionManager.cs#L1385-L1405)),
not through HTTP; it still hits the blocked PlaybackInfo, so it stops instead of skipping.

### 3.1 Plugin with filters, a carried server patch, or a fork

| | Plugin + stubs + filter | Minimal server patch set in the image | Server fork with a "missing" item kind |
| --- | --- | --- | --- |
| Core files changed | none | `NextUpService.cs` (skip `IsPlaceHolder` episodes: about 3 lines, giving "next real episode" natively), `MediaInfoHelper.cs` (refuse placeholders, about 5), `LibraryController.cs` download (about 3), `SessionManager.cs` reports (about 5): about 20 lines in 4 files | many: a new kind through the database, DTO, queries, every controller, migrations |
| Upstream churn on those files since 2025-01-01 | — | NextUpService 7 commits, MediaInfoHelper 9, LibraryController 16, SessionManager 44 (GitHub API) | the whole core |
| Build and ship | the plugin as today | the image would build Jellyfin from source for arm64 and amd64 instead of layering on the official image; every Jellyfin release is a rebase | a full server build and release line |
| Bad rebase | — | a silent conflict in Next Up or playback logic, caught only by tests | the same at a much larger surface |
| Database migration exposure | none (the plugin's own database is untouched) | none (logic only) | yes: Jellyfin's database schema diverges, every upstream migration must be merged |
| What stock apps gain | `IsPlaceHolder`, `NotAllowed`, 404 — fields they already have | the same, plus exact Next Up paging | **nothing more**: stock apps only read stock fields (`LocationType`, `IsPlaceHolder`, `IsMissing`); a new kind would be unknown to them |
| Plugin off | stubs stay as unplayable placeholders until removed; Next Up offers them again | the patch keeps working without the plugin | — |

**No requirement truly needs a core change.** The patch set would buy only Next Up's exact paging and "next real episode"
without a second query, and server-internal play-next; it would cost the official-image build model the project relies on.

---

## 4. What the user must approve

This reverses three recorded decisions: README 2026-09-04 ("Catalog entries are plugin-owned rows, not Jellyfin
`BaseItem`s"), PHASE1 §4 ("never insert synthetic `BaseItem`s"; here the items come from files) and PHASE3's "plugin-only
file-less representation, without STRM placeholders" (README §9.2.1 had first recommended file placeholders). Approve the
plugin writing 0-byte `.disc` stubs and `Season NN` folders into the library roots the import writes to, and shaping stock
API responses for stub items with a plugin filter.

**Fallback** where the plugin may not write (no writable root, or a read-only series folder without automatic series
grouping): nothing is written, the current mod surfaces stay (P1.FU11 cards and rows, the mod's pages) without ✓ or ♥. If
the user wants ✓ and ♥ there too, the first version of this plan (a per-user `UserEntryStates` table, one additive
migration) can be revived for that case only.

---

## 5. Slices (P1.FU24–28)

| Slice | What | Repos | Effort | First look |
| --- | --- | --- | --- | --- |
| **P1.FU24** Stubs for missing episodes and seasons of held series, and the native-client filter | Writer (layout, writable-root and grouping checks, a dry-run list), `DateCreated` and runtime after creation, removal when TMDB drops one; reconciliation binds stubs as not on disk; the response filter of 2.2 (Next Up, PlaybackInfo, stream and Download, playback reports, `CanDownload`); a settings switch (off by default until accepted) and an administrator's *Remove placeholders*; web: Play hidden and Get a Release on stub items, the marks on Jellyfin's own cards and rows, the mod's route sends a missing season or episode with a stub to Jellyfin's page | plugin L, web M | L | Ted Lasso S1 and Kleo S2 on one instance in the mod web (✓ ♥ ⓘ ⋯ working, no Play, the cloud) **and** the same items in a stock client (the Jellyfin iOS app or stock `/web`): Next Up, Play refused, no download |
| **P1.FU25** Import and retention | Import swaps stub → file in one step; retention ignores stubs and writes one back after a reclaim; suites prove carry-over and that the carried date is not a fresh completion | plugin M | M | none (behaviour); live: a missing episode marked watched, then downloaded |
| **P1.FU26** File-less titles | Series folders and movie stubs in the writable root; Browse stops merging those entries as file-less rows; the mod's file-less title page sends to Jellyfin's page | plugin M, web S | M | a file-less movie and series in the Movies and Shows grids, mod web and a stock client |
| **P1.FU27** Backfill and the fallback surfaces | One batched run that writes stubs for every existing entry (measured on 28096's 105 shows); P1.FU11/14/15 surfaces become fallback-only | plugin S, web S | M | the whole catalogue on 28096 |
| **P1.FU28** Next Up's next real episode; play queues skip stubs | Next Up replaces a stub with the series' next real episode; Resume and `startItemId` episode queues leave stubs out; the mod's web leaves them out of every queue it builds (section 15) | plugin S, web S | S | none (the user verifies in bulk): Next Up and the series Play across a missing episode, Play All on a season and a movie library |

Order: FU24 → FU25 → FU26 → FU27 (→ FU28). FU25 ships with FU24 so nothing marked is lost once stubs exist. The filter
belongs to FU24 because stock apps see stubs from the first one written. **Migration:** none planned.

---

## 6. E2E tests (no unit tests)

- **Plugin suites** (Phase 5 runs a real Jellyfin host in the Linux container): writer layout per case; read-only folder
  without grouping writes nothing; `DateCreated` and runtime set; reconciliation reports stubs as not on disk; the filter
  through the real HTTP host as a native app calls it (`/Shows/NextUp`, `PlaybackInfo`, `Download`, stream, playback
  reports, `CanDownload`), with a non-stub item untouched on every endpoint; import swap with two users' played, favourite
  and date carried over (Jellyfin's `GET /UserItems/{id}/UserData`); retention never selects a stub, writes one back after a
  reclaim, and does not count the carried date as fresh; *Remove placeholders* removes only plugin-written `.disc` stubs
  (a delete path: adversarial review of its design before build).
- **Web runner** `missing-as-media.mjs` (real browser, real plugin and Jellyfin, nothing intercepted) on stub episode,
  season, series and movie pages, as oleksii and nata, desktop, phone and TV 1080: ✓ ♥ ⓘ ⋯ work and persist, Play absent
  (card centre, overlay, header, Enter on the TV), Get a Release for administrators, Favourites tab and filters list them,
  counts update, Next Up per the user's answer. A second pass against stock `/web` (upstream's bundle) checks what a stock
  client sees. It unmarks everything and removes its stubs at the end.
- **A real native app** (the user's iPhone with the Jellyfin app, or Swiftfin) at the first look, since the API checks do
  not prove what each app does with `IsPlaceHolder` and `NotAllowed`.

---

## 7. Risks

| Risk | Mitigation |
| --- | --- |
| *Remove placeholders* is a delete path | Only 0-byte `.disc` files the plugin wrote, in plugin-known paths; destructive-path rules |
| A stock app handles `IsPlaceHolder` or `NotAllowed` badly (unverified for Swiftfin, Infuse, Findroid, Android TV) | First look on a real app; the filter can add more shaping per endpoint |
| The Trakt plugin reports stubs as collected | Verify on an isolated instance before enabling |
| Scan and TMDB load for thousands of stubs | Batched backfill, measured on 28096 |
| Read-only series folders without automatic series grouping would show a second series | Writer checks the library option and writes nothing |
| Plugin removed or disabled: stubs stay and Next Up offers them again | *Remove placeholders* named in the uninstall notes |
| Upstream renames or reshapes the filtered endpoints | The filter matches by controller action and result type; a parity check per Jellyfin release (as for the web patch surface) |

---

## 8. Commit layout for the Phase 1 history reorganisation

| Slice | Plugin | Web |
| --- | --- | --- |
| FU24 | `feat(placeholders,p1.fu24)`: new `Services/Placeholders/` (writer, layout), new `Api/Filters/PlaceholderFilter.cs`, `PluginServiceRegistrator.cs` (filter registration), `Services/ReconciliationService.cs`, `Configuration/PluginConfiguration.cs` + `configPage.html`, `Api/HealthController.cs`; `test(placeholders,p1.fu24)`: `tests/PhaseOneSmoke`, `tests/PhaseFiveIntegration` | `feat(details,p1.fu24)`: `integration/cardGetRelease.tsx`, `integration/downloadMarks.tsx`, `routes/DetailsPage.tsx`, `constants/fileState.ts`; `test(details,p1.fu24)`: `missing-as-media.mjs`; `docs(plan,p1.fu24)` |
| FU25 | `feat(import,p1.fu25)`: `Services/Import/ImportService.cs`, `ImportPlanning.cs`; `feat(retention,p1.fu25)`: `Services/RetentionExecutor.cs`; tests in Phase 5 and Phase 10 suites | `docs(plan,p1.fu25)` |
| FU26 | `feat(placeholders,p1.fu26)`: the writer for titles, `Api/BrowseController.cs` | `feat(browse,p1.fu26)`: `components/EntryDetails.tsx`, `routes/LibraryGridPage.tsx`; test; docs |
| FU27 | `feat(placeholders,p1.fu27)`: backfill task | `refactor(details,p1.fu27)`: `components/MissingChildren.tsx`; docs |
| FU28 | `feat(queue,p1.fu28)`: Next Up, Resume and episode-queue shaping in `Api/Filters/PlaceholderFilter.cs` | `feat(queue,p1.fu28)`: `integration/playQueue.ts`, `components/playback/playbackmanager.js`; `test(queue,p1.fu28)`: `placeholder-queues.mjs`; `docs(plan,p1.fu28)` |

Phase-crossing hooks: `ReconciliationService.cs` (Phase 2/10), `ImportService.cs`/`ImportPlanning.cs` (Phase 5),
`RetentionExecutor.cs` (Phase 3/10), `cardGetRelease.tsx`/`downloadMarks.tsx` (Phase 4 web). No migration to order.

---

## 9. Questions for the user

1. **Placeholders and the filter:** approve 0-byte `.disc` media stubs and `Season NN` folders in the library roots the
   import writes to, and a plugin filter that shapes Next Up, playback and download answers for stub items (no server
   change)?
2. **Next Up** for a series whose next episode is missing: leave the series out of Next Up until it arrives (what X2 did), or
   show the next **real** episode after the gap (Jellyfin's own behaviour for missing episodes)? And should auto-play and
   Play All skip missing episodes (FU28) or stop at them?
3. **Unaired episodes:** stubs for them too (they then appear in their season and in Upcoming), or aired only?
4. **Stub message:** leave stubs empty, or write Kodi's stub message ("Not downloaded yet") into them, which Kodi shows?
5. **Series grouping and rollout:** is automatic series grouping on in your production TV libraries (needed for read-only
   series folders), and should the feature start off with a dry-run list of what it would write, then be turned on per
   library?

---

## 10. Answers (user, 2026-10-15: "go with your recommendations")

1. **Placeholders and the filter:** approved.
2. **Next Up:** the recommendation is **show the next real episode after the gap**, and **play queues skip missing episodes**.
   FU24 ships the filter that removes stubs from Next Up (a series whose next episode is missing drops out); the "next real
   episode" and the play-queue skipping are FU28 (section 11), built after FU24's first look, with the slice order approved
   again at that gate.
3. **Unaired episodes:** stubs for **aired episodes only**; an unaired one keeps the mod's own card or row with its date.
4. **Stub message:** **a short message**, not an empty file. Every stub the plugin writes is
   ```
   <!-- JellyfinMod placeholder v1 -->
   <discstub>
     <title>Peep Show S02E01 - Dance Class</title>
     <message>Not downloaded yet. Open JellyfinMod to get it.</message>
   </discstub>
   ```
   The first line is the plugin's **marker**: a file is the plugin's stub only when its extension is `.disc`, it is a regular
   file (not a link) under 4 KB, and its first line is the marker. Everything that removes or treats a file as the plugin's
   stub (the sync, *Remove placeholders*, the import's swap, the response filter, reconciliation's lookup by id) checks it, so a
   user's own `.disc` file (a disc-collection stub, a Blu-ray marker) is never touched. Verified on local environment alpha
   (Jellyfin 12.0.0): a `.disc` with this body still resolves to an episode with `IsPlaceHolder: true`, is not probed (no
   ffprobe error), and gets full TMDB metadata (overview, 9 to 16 people).
5. **Rollout and series grouping:** ~~off by default, per TV library, turned on after a dry run~~ **on by default for every TV
   library** (user, after the first look on alpha, 2026-10-15: "Show missing episodes - should be enabled by default. That's
   the point."). An administrator can turn it off per library (`PluginConfiguration.PlaceholderDisabledLibraryIds`, an opt-out
   list; a new library is on); turning it off offers to remove the placeholders already written. The dry run (Preview) and
   Remove Placeholders stay. A sync writes at most 10 series per library and run with a 3-second pause between series, and the
   sync task runs every 15 minutes, its first run one interval after the plugin starts: a large library is filled in batches
   over a few hours instead of writing thousands of files, and setting off as many scans, at start. Where the series folder is
   read-only the plugin writes nothing and the dry run and Settings say why (the mod's own cards and rows stay the surface); the
   second-folder-with-automatic-grouping variant of section 2.1 is not built.

## 11. P1.FU28 design: Next Up shows the next real episode, play queues skip stubs

**Next Up.** `PlaceholderFilter.ShapeNextUp` (plugin `Api/Filters/PlaceholderFilter.cs`) is the one place to change. Today it
drops every stub `BaseItemDto` from `TvShows.GetNextUp`'s `QueryResult<BaseItemDto>` and lowers the total. FU28 replaces the
drop: for each stub in the page (pre-filtered by the DTO's own `IsPlaceHolder`, so pages without stubs cost nothing), it asks
the library **in process**, with no second HTTP call:

```csharp
var user = userManager.GetUserById(userId);           // the request's userId, else the authenticated user (claims)
var next = library.GetItemList(new InternalItemsQuery(user)   // user-scoped: library access, parental rating, blocked tags
{
    AncestorIds = [stub.SeriesId],
    IncludeItemTypes = [BaseItemKind.Episode],
    IsPlaceHolder = false, IsVirtualItem = false, IsPlayed = false,
    MinParentAndIndexNumber = (stub.ParentIndexNumber, stub.IndexNumber + 1),
    OrderBy = [(ItemSortBy.ParentIndexNumber, Ascending), (ItemSortBy.IndexNumber, Ascending)],
    Limit = 1
}).FirstOrDefault();
```

and, when there is one, puts `dtoService.GetBaseItemDto(next, dtoOptions, user)` in the stub's slot (the DTO options rebuilt
from the request's `fields`, `enableImages`, `imageTypeLimit`, `enableImageTypes` and `enableUserData`, as `TvShowsController`
does), else drops the slot as today. Specials (season 0) are skipped as upstream's Next Up skips them. Paging: the slot is
replaced one for one, so `TotalRecordCount` and the page size stay right; a series whose next real episode is already in the
page (two copies of one series) is not added twice. Access: `InternalItemsQuery(user)` applies the same library, parental
rating and tag rules as Next Up itself, so a user never gets an episode they could not open. The series **Play** button of
upstream web (`/Shows/NextUp?seriesId=`) then starts at the next real episode.

**Play queues.** Upstream web and most apps build a season's or series' queue (Play All, Shuffle, auto-play of the next
episode) from `GET /Shows/{seriesId}/Episodes` (upstream web passes `IsMissing=false`) or `GET /Items?parentId=...`. FU28
adds `TvShows.GetEpisodes` to the filter's result phase: when the request asks for playable items (`isMissing=false`, or a
`startItemId`, the queue builders' shape) stub episodes are left out of the answer, so the queue jumps the gap; a plain listing
(the season page) keeps them, because they must show there. Server-driven play-next (`SessionManager`, remote control and
casting) is not reachable from a filter and keeps stopping at the stub with PlaybackInfo's `NotAllowed`. Checks: auto-play
across a stub in stock `/web` and the iOS app; Next Up and the series Play button for a series whose next episode is a stub,
as two users with different parental ratings.

## 12. What P1.FU24 built (2026-10-15, built, not accepted)

Plugin (`feat/placeholder-stubs` from `next-release` `b52a64a`): `Services/Placeholders/` (the writer and remover
`PlaceholderService`, the marker `PlaceholderStub`, the per-library switch `PlaceholderSettings` in
`PluginConfiguration.PlaceholderDisabledLibraryIds`, on by default, the item stamp listener and the 15-minute batched sync
task), `Api/Filters/PlaceholderFilter.cs`
registered from `PluginServiceRegistrator`, `Api/PlaceholdersController.cs` (`/JellyfinMod/Placeholders`, administrators
only; [API.md](../API.md) *Placeholders*), `Services/Import/SeriesFolders.cs` (the import's own folder rules, shared),
reconciliation reading placeholder episodes as not on disk (`JellyfinNativeTitleSource`), the entry detail naming each missing
episode's `placeholderItemId`, an entry lookup by a placeholder's id finding its series, and the import removing the
episode's stub before its scan. No migration. Web: see [PLAN.md](../PLAN.md) P1.FU24.

Differences from sections 2 and 3: stubs carry the marker body (section 10); the filter also drops stubs from **Latest**
(`UserLibrary.GetLatestMedia`) besides stamping `DateCreated`, because a currently airing show's newest stub has a recent air
date; stamping happens when Jellyfin creates **or saves** the item (its first metadata refresh saves the item it loaded before
the stamp, which undid a stamp made only on creation) and on every sync; specials get no stubs (as the mod's own surfaces
offer none); the filter acts on the plugin's marked stubs only, whatever the switch says, and leaves a user's own `.disc` as
Jellyfin answers it.

## 13. What P1.FU25 built (2026-10-15, built, not accepted)

Plugin (`feat/placeholder-swap` from `feat/placeholder-stubs`): `PlaceholderService.SwapForImport` (the import's half: the
episode's marked stubs leave its series folder and every season folder, after the link is verified and recorded and before the
scan, under the library lock; called from `ImportService` for a new link, a recovered one and a `linked` operation found at
start), `PlaceholderService.LeaveAfterReclaim` and `ReclaimStubPath` (the retention half, called by `RetentionExecutor` after a
plain reclaim of an episode's last file is committed), the sync's `importing` guard and series-wide stub and file lookups, a
reclaimed episode counted as aired, the reclaimed series' folder kept by its series item (`SeriesFolders`), and the preview's
`placeholder` block and `leavesPlaceholder`/`placeholders`. Web: the placeholder page follows the swap to the file's page.

Differences from sections 2 and 5: the import removes the stub just **after** the link (not before it), so the episode is never
left with neither; the reclaim's stub goes in the reclaimed file's own folder (not a recomputed import path), so the sync and the
removal look in the series folder as well as its season folders; movies get no stub after a reclaim until P1.FU26. Jellyfin 12
re-attaches played, favourite and dates by key in both directions (checked live on local environment charlie), with one caveat
recorded in [PLAN.md](../PLAN.md) P1.FU25: a list endpoint can show a just-swapped item unplayed until a restart if a client read
it before its first metadata refresh. *Fixed 2026-10-15 (PLAN.md P1.FU25 follow-up): Jellyfin's per-user data cache is refreshed by
re-saving the re-attached data once after the new item's first refresh.*

*P4.FU11 (2026-10-17, built, not accepted; [PLAN.md](../PLAN.md) P4.FU11): the swap no longer waits for Jellyfin's library
monitor. Reporting the changed folders left the stub in place for the monitor's quiet delay (60 s), and a pack's reports refreshed
nothing until the escalated library scan. After the swap the import now refreshes the destination's nearest Jellyfin folder itself
(`ChangedExternally()`, as the monitor's refresher would: the season, a new season's series, or a movie's library root), so
Jellyfin replaces the stub with the probed file within about a second; the reports and the scan escalation stay as the fallback.
A reconciliation that binds the file wakes the import monitor, and the web reads its items again when the queue shows the import
finished, so the page shows Play about 2–4 s after Jellyfin has the file.*

## 14. What P1.FU26 built (2026-10-15, built, not accepted)

Plugin (`feat/placeholder-titles` from `feat/placeholder-swap`): `PlaceholderService` plans movie libraries
(`ComputeMoviesAsync`: one stub per released movie with no file, `Title (Year) [tmdbid-N]/Title (Year) [tmdbid-N].disc`) and
file-less series (their own `[tmdbid-N]` folder in the first writable library folder); `SyncEntryAsync` with
`PlaceholderSyncQueue` (Add, episode-list load, Refresh); `SwapMovieForImport`, `LeaveAfterMovieReclaim` and
`MovieReclaimStubPath`, `RemoveForEntryAsync`, `TitleItemIdAsync`; `SeriesFolders.TitleFolderByTmdbId` and the series binding
fallback; reconciliation ignoring placeholder movies and never backfilling from placeholders alone; `EntryDto.PlaceholderItemId`;
Browse attaching the entry to the placeholder item; `EntriesController` lookup, detail and removal. Web: see [PLAN.md](../PLAN.md)
P1.FU26.

Differences from sections 2 and 5: the title folder is the import's own (`[tmdbid-N]` kept, so Jellyfin matches the TMDB title
without ambiguity: live, *The Matrix* and *The Matrix Reloaded* matched with full metadata, cast and artwork); the series' item is
bound to the entry by reconciliation as for an empty series folder, while a placeholder movie is never bound and is found by TMDB
id; the mod's file-less page is kept for titles with no placeholder yet (the minute until Jellyfin scans it, unreleased movies, a
read-only library) and otherwise opens the Jellyfin page; Settings *Missing Episodes* keeps its name and lists movie libraries.

## 15. What P1.FU28 built (2026-10-15, built, not accepted)

Plugin (`feat/placeholder-queues` from `feat/placeholder-titles` `1ee91ea`): `Api/Filters/PlaceholderFilter.cs` only. Web
(`feat/placeholder-queues` from `9a9e876b08`): `integration/playQueue.ts` and a two-line hook in upstream's
`playbackmanager.js` (the patch-surface table in [PHASE7.md](../PHASE7.md)).

**Next Up** (`ShapeNextUp`, as section 11, in process, no second HTTP call): each stub in the page is replaced in its own slot by
the first episode of the same series (by series presentation key, as Next Up itself) after it that is neither a placeholder nor
virtual and has the stub's played state (unplayed; played for a rewatching slot), season 0 left out; the DTO is the stock one
(`IDtoService.GetBaseItemDto`) with the request's own fields, image and user-data options. Dropped instead (total lowered by one)
when no such episode follows, when it is already in the page, or when it has a position and the request said
`enableResumable=false`. The series filter, parent library and date cutoff chose the series; the replacement comes from it.
**Difference from section 11:** a user-scoped `InternalItemsQuery(user)` by series key applies parental rating and tags but
**not library access**, so the replacement is also kept only when `IsVisibleStandalone(user)` (library access included). Found
live: Jellyfin 12's own `/Shows/NextUp?seriesId=` answers the next episode of a series in a library the user cannot open (a
stock behaviour for real episodes, not the filter's; left as it is, out of this slice's scope). Specials interleaved by
*Display specials within seasons* are not considered for the replacement (rare; the slot then shows the next numbered episode).

**Play queues.** Studied how clients build queues (sources on GitHub, 2026-10-15):

| Client | Season / series list (browse) | Play queue |
| --- | --- | --- |
| upstream web (this fork) | `/Shows/{id}/Episodes?seasonId=…` | `/Shows/{id}/Episodes?isMissing=false&startItemId=…` (episode, series), `…&seasonId=…` (season), `/Items?ParentId=…&Filters=IsNotFolder&MediaTypes=Audio,Video` (library), `/Items?Ids=…` (Play from here), Next Up for the series start |
| Swiftfin | `/Shows/{id}/Episodes?isMissing=false` when *show missing episodes* is off (`EpisodeLibrary.swift`) | next episode by `/Shows/{id}/Episodes?adjacentTo=…&limit=3` (`EpisodeMediaPlayerQueue.swift`) |
| Findroid | `/Shows/{id}/Episodes?seasonId=…` | the same request, then its own `!missing` filter (`PlaylistManager.kt`); Next Up for the series start |
| Jellyfin for Android TV | — | `/Shows/{id}/Episodes?isMissing=false&startItemId=…` (episode), `isMissing=false` (series, season, folder) (`SdkPlaybackHelper.kt`); Next Up for the series start |
| Jellyfin for Kodi | synced library | Kodi's own playlist from its database; a stub plays as Kodi's media-stub message |

So `isMissing=false` and plain season requests are browse requests too (Swiftfin, Findroid), and filtering them would hide
placeholders from season lists; `adjacentTo` also drives Android TV's Previous button. Only **`startItemId`** is sent by queue
builders alone. What is fixed where:

| Surface | Fixed | How |
| --- | --- | --- |
| Next Up (Home row, the Next Up page, apps' Next Up) and the series **Play** start in upstream web, Findroid and Android TV | **server** | Next Up's next real episode |
| Continue Watching / Resume | **server** | a stub with a position (carried over from its file) left out |
| Episode Play and "play next" after it in upstream web and Android TV | **server** and web | `/Shows/{id}/Episodes?startItemId=` leaves out the stubs after the start item (the start item stays: a client that asks to start on a stub still gets `NotAllowed`) |
| The mod's web: Play All, Shuffle, Play from here (a real or a placeholder row), a season's or series' Play and Shuffle, a library's Play All and Shuffle (placeholder movies, FU26), Instant Mix, Add to queue and Play next | **web** | `skipPlaceholders` in upstream's one queue step; the start moves to the first playable item at or after the one asked for; a queue with nothing playable is handed back unchanged so upstream shows its placeholder message. The Jellyfin iOS and Android apps show this same web |
| Instant Mix | nothing to fix | audio only in Jellyfin 12 (`MusicManager`): no stub can be in one |
| Native apps' season, series and library queues and their auto-play (Swiftfin, Findroid, Android TV's season and series play, Infuse, Kodi's own playlists), and server-driven play-next for remote control and casting | **not fixed** | the request cannot be told from a browse request (or is not HTTP); the app reaches the stub, PlaybackInfo answers `NotAllowed` and playback stops there with the app's error; nothing is downloaded, streamed or marked played |

Checks: plugin build; Phase 1 smoke and Phase 2 on macOS pass (the registrator builds the filter with its new services). Web
typecheck, eslint on the changed files, the patch-surface check and the production build. Live on local environment charlie
(Jellyfin 12.0.0, lease held by the implementing session, reset to the baseline afterwards; Shows pointed at a writable copy of
Peep Show with small `.webm` files for S01E01, S01E02, S01E05 and S02E02 and the plugin's placeholders for the rest, Fawlty
Towers added from TMDb as a file-less series with S01E04 swapped for a `.webm`, The Matrix Reloaded as a placeholder movie and a
`.webm` Big Buck Bunny in a writable Movies folder): new runner `placeholder-queues.mjs` (plain HTTP as a native app, then the
browser observing the web's own `PlaybackInfo` requests and the start report's `NowPlayingQueue`; nothing intercepted); results
in [PLAN.md](../PLAN.md) P1.FU28.


## 16. What P1.FU27 built (2026-10-17, built, not accepted)

Plugin (`feat/placeholder-backfill` from `feat/placeholder-queues` `c3a9f94`): `Services/Placeholders/PlaceholderTasks.cs` (the
backfill `PlaceholderBackfill`, the adaptive sync task, the first-run starter), `PlaceholderService.cs` (title counters, the batch
that gives way to scans, one report per run, the library-scan fallback, `StubEpisodesOf`), `PlaceholderWatchedRestore.cs` (new),
`PlaceholderUserData.SaveQuietly`, `Api/PlaceholdersController.cs` (`Progress`, `SyncNow`, `RestoreWatched`). Web
(`feat/placeholder-backfill` from `0707607aef`): `components/NativeEntryDetails.tsx` and `DownloadBlock.tsx` (the block on a
placeholder's page), `components/MissingChildren.tsx` and `integration/upstreamChildren.js` (fallback-only surfaces and the
mid-visit swap), `EntryEpisodeDetails.tsx`, `EntrySeasonDetails.tsx`, `EntryDetails.tsx` and `hooks/useEntries.ts` (the mod's
pages follow a placeholder that appears), `settings/PlaceholdersSection.tsx`. No migration, version 0.1.0.0.

**Backfill, automatic.** The sync task's trigger fires every 5 minutes. A run writes a batch while the last one left placeholders
pending (or gave way to a scan, or none ran since start), else only once 15 minutes have passed since the last; the per-run bound
is unchanged (10 titles per library, 3 seconds apart). Jellyfin re-arms an interval trigger at `max(last end, last start, now + 1
min) + interval`, so the busy pace is about every 6 minutes. A batch never runs beside another (one gate; *Sync Now* answers 409
`sync_running`), skips writing while `ILibraryManager.IsScanRunning` (the next trigger tries again), and stops after the title in
hand when a scan starts during it. Every folder a run changed is reported to Jellyfin's file monitor once, at its end (the
outermost folder only). **Found live (Jellyfin 12.0.0):** an interval task that never completed starts one hour after Jellyfin
starts (`IntervalTrigger`: `lastResult is null` gives `now + 1 h`), and a queued run does not re-arm triggers. So a starter queues
the task 5 minutes after start where it has never completed and then calls `IScheduledTaskWorker.ReloadTriggerEvents()`.
**Also found:** a library folder that was empty at Jellyfin's last scan has no folder item, and a report of it refreshes nothing
(neither did validating the library's own folder). A run that wrote into such a folder asks for one library scan
(`QueueLibraryScan`); after it the folder has its item.

**Needs the administrator only for:** turning a library off, *Sync Now* (optional), Remove Placeholders, and the watched restore.
Settings *Missing Episodes* reads `Placeholders: N of M titles done · P placeholders pending` and the next step (a batch now,
waiting for a scan, the next batch in about N minutes, or all done), re-read every 30 s while some are pending.

**Reclaimed titles.** A reclaimed episode counts as aired and a reclaimed movie as released, so the backfill writes their
placeholders like any other. Jellyfin then re-attaches the parked user data by key (played, favourite, dates). *Restore Watched
State From Retention History* is for a title whose Jellyfin data is gone. It is built, not left out: the plugin's own completion
record is the only source, the mark goes only where Jellyfin holds no row of that user for the placeholder, never before
Jellyfin's first refresh of it, quietly, with a dry run first; a second run finds its own rows. See [API.md](../API.md) and
[PHASE10.md](../PHASE10.md) S21.

**Fallback-only mod surfaces.** The mod's missing season cards and episode rows were already drawn only where Jellyfin has no item
for that season or episode, so a placeholder takes their place. What changed is the moment of the swap: a Jellyfin item counts as
held only when the first read knew it or upstream's list draws it, so an item that appears mid-visit keeps the mod's row until
upstream shows its own, never a gap. Upstream's list is drawn again (a mirror of `renderChildren`'s Series and Season branches,
upstream's file unpatched) when Jellyfin's items and the drawn ones differ (added, or removed by Remove Placeholders). The season
card's "N episodes" line adds the mod's own rows (unaired, no placeholder yet) to Jellyfin's count. The mod's own episode, season
and title pages open Jellyfin's page once the catalog's refresh after a library change reads a placeholder. The surfaces stay for
a library turned off, a read-only folder, unaired episodes, specials and titles whose batch has not been written; no code was
removed (none is unreachable).

**Download state on the placeholder's own page.** A placeholder episode's or movie's Jellyfin page shows P1.FU20's download block
(ring, figure, release, pack line and dots, Get a Release, View Queue, Cancel Download for administrators, Search Again) where a
file's page has its track selectors. The block reads the queue by entry and episode, as the mod's own page does. A placeholder
season or series page gets nothing new: its cards and rows carry the rings (P4.FU6) and the series section lists the episodes on
their way. Cards and rows of placeholders map to the queue by the series' entry and the episode numbers (a pack's episodes
included), and placeholder movies through the plugin's lookup by item id.

## 17. What P1.FU29 fixed (2026-10-17, built, not accepted)

**The bug** (user, 2026-10-17, on 28096): Jellyfin's *Delete media* on Adolescence's only season left the series with no seasons
and an empty folder; the user expects "the season with no files on disk". **Why:** Jellyfin 12 deletes a season or series with
its children but raises `ItemRemoved` only for the season or series itself, and the plugin's listener reconciled movies, series
and episodes only; even then, a per-title reconciliation never drops a binding (only the absence check that ends a library scan
does, P2.R6), and that check refused an empty nearest folder as possibly an unmounted mount point, which is exactly what a
series' only season leaves behind. So the catalog kept the four episodes on disk, bound to deleted items, and the placeholder
sync, which writes only for episodes not on disk, wrote nothing (28096's progress read 8 of 8 done).

**The fix** (plugin `fix/recreate-after-delete`; web the same branch):

- `PlaceholderDeleteListener` (`PlaceholderTasks.cs`): Jellyfin's removal of a movie, series, season or episode with a path
  (not a virtual item, not one the plugin removed itself) starts one placeholder batch 5 s after the last removal, once no library
  scan runs (a scan ends with its own absence check; the batch follows it). Never two batches at once (the P1.FU27 gate).
- The batch's first step, `PlaceholderBackfill.RepairVanishedAsync`: every bound file that is gone from disk, proved as the
  absence check proves it (on the very mount it was seen on). When Jellyfin no longer holds its item, the catalog's own absence
  check runs at once (`CatalogBackfillRunner` with `confirmAbsence`, the post-scan run; 6 to 10 s for 28096's 164 titles); when
  Jellyfin still holds it (a delete made while the server was down, or by a file manager it has not noticed), the nearest folder
  still there is reported to Jellyfin, whose removal of the items then starts a batch through the listener. An item the check
  could not clear asks for it only once. This is also the safety net after a restart and for the state 28096 is in now.
- Absence check: with the mount identity proved (`IsCurrent`), an empty nearest folder is proof too
  (`MediaStorageIdentity.IsProvablyAbsent(…, mountVerified: true)`): an unmounted mount point would have changed the path's mount.
  Bindings without a recorded identity keep the old rule.
- The plugin's own removals (the import's swap, a stale stub, Remove Placeholders, Remove Entry) note each stub and each folder
  they empty for 10 minutes (`PlaceholderStub.NoteRemoved`), and Jellyfin's removal of those items starts nothing: no
  delete-recreate loop, and Remove Placeholders and Remove Entry bring nothing back. Retention's reclaim already leaves its stub
  (P1.FU25), so a batch after it finds nothing to write.
- The batch writes the stubs where and as the import names files, so Jellyfin makes the same items (ids follow paths) and
  re-attaches the parked user data by key: a played and favourite episode came back played and favourite.
- Web (`MissingChildren.tsx`, `useHeldNatives`): an item Jellyfin no longer lists is forgotten, so when it comes back under the
  same id it counts as added and upstream's list is drawn again. Before, the mod's stand-in card went away when the placeholder
  season returned and upstream's list was never redrawn, leaving the series page without the season until a reload.

**What the user saw before P4.FU12 (superseded by §18):** after *Delete media* on a season, the series page keeps upstream's card for a few seconds, then the mod's
stand-in card for the season (about 20 s after the delete, once the catalog check and the page's 10 s library refresh have run),
then Jellyfin's own season card with its placeholder episodes (about 70 to 115 s, Jellyfin's 60 s library monitor delay
included), without a reload and never without the season.

**Unchanged:** a library turned off, a read-only folder, a title no longer in the catalog, unaired episodes and specials get
nothing; the stub rules (marker first line, under 4 KB, only marked files removed). No migration, version 0.1.0.0.

## 18. What P4.FU12 changed (2026-10-18, built, not accepted)

User decision 2026-10-18: "Go with what Codex proposed" ([no-delay-codex-design.md](no-delay-codex-design.md)), plus the import-flows
audit's additions B1 and B3 to B8 ([no-delay-import-audit.md](no-delay-import-audit.md)); B2 (reclaim and last-version removal order)
is left out. This replaces §17's listener, its 5 s quiet period and the 60 s Jellyfin waits.

- **A delete made in Jellyfin** (season, episode, series, movie) is repaired per title from Jellyfin's own removal announcements
  (`DeleteRepair`): about 250 ms after the first one the bindings the removals name are cleared under the library lease when their
  files are provably gone (`ReconciliationService.ConfirmAbsenceInScopeUnderLeaseAsync`, mount identity kept; no library-wide pass),
  the title's placeholders are written where the title was, and Jellyfin is made to hold them (`FolderRefresh`, below). Both
  announcement patterns (descendants then the root, or the root alone) are handled. The plugin's own removals are marked by
  Jellyfin item id (B1): the plugin deletes those items itself, so there is nothing to wait for and nothing to mistake for a user
  delete. The 10-minute path suppression and `_repairedGone` are gone.
- **Making Jellyfin hold what was written** (`FolderRefresh`, `IMediaDiscovery`): `Folder.ValidateChildren` on the nearest folder
  Jellyfin holds an item for (a season for its files, a series for a new season, the library folder, shallow, for a new title
  folder, `ValidateTopLibraryFolders` when the library folder has no item yet), awaited, one batch per library, only the changed paths
  refreshed (`RefreshPaths`); a new series in full. Never `ChangedExternally` on a library folder, never a hand-built item. Used by
  the placeholder writer, the delete repair and the import. Jellyfin's own library monitor is still told as the fallback.
- **An import** completes when Jellyfin can play the file (`NativeReadiness`: bound, not a placeholder, refreshed, video stream),
  not when it lists it; a download is found within 2 s while an import awaits it (`ImportMonitor.ActivePoll`), bindings are looked at
  every second between wakes (`LocalPoll`, no client read), and a replacement or upgrade whose new version waits to play is looked at
  the same way (B8).
- **Push first.** The plugin sends Jellyfin's own `LibraryChanged` message at once (`LibraryNotifications`, 250 ms window) to each
  user's sessions, with only the item ids that user may see, after: an import completes, a delete is repaired, placeholders are
  written or removed (Sync Now, Add, Remove Placeholders, Remove Entry), a native item is removed after a reclaim or a version
  removal (B5). The web reads the catalog again on it, and after the person's own Remove Entry, Sync Now and Remove Placeholders
  (B6). **The one fallback** is `hooks/useEntryFallbackPoll.ts`: an open title's detail once a second (every 5 s after 30 s) only
  while it waits for a download or for the item that plays its file and the SDK socket is down, or the file shows on disk without
  that item and no push came within 5 s; never while the tab is hidden or nothing waits; when it sees the title playable it reads the
  catalog as the push would have. The download client has no push, so the plugin reads it every 2 s while an import awaits its
  download. Nothing else on the web polls for these updates.
- **`playableItemId`** (response only, no migration) names the Jellyfin item that plays an entry's or episode's file; the web keeps
  the importing ring until the page has drawn it (UX §3.3).
- **A real file beside a placeholder** (copied in, or another tool's import; B3): a reconcile that binds it, or that finds Jellyfin
  took it for a further source of the placeholder item, syncs the title's placeholders at once, so the stub goes about a second after
  Jellyfin has the file instead of at the next sync; user-owned `.disc` files and read-only folders are left as before.
- **B4** needed no extra code: the placeholder writer no longer asks Jellyfin for a library scan (step 6), so one library's run no
  longer makes another's give way; a scan the person started still does.

**Finished 2026-10-18 (the finisher, after the queued-state runner and the audits):** a pack row's state comes from an import
still waiting for its download before one importing, so it no longer steps back once pack episodes import in seconds; on the push
the web reads the queue before its catalog, so a list redrawn with the file never meets the last answer's `queued`; a card or row
that is the file's own item ends the importing ring at once; Remove Placeholders and Remove Entry wait, under the library lock, for
the library's discoveries asked for before them (`IMediaDiscovery.IdleAsync`, at most 60 s), so a discovery still running can no
longer make items after the removal looked; the native season and episode lists are read again whenever a page draws them unless
read within 2 s, so a copy restored from the persisted cache after a reload no longer shows a placeholder's row beside the mod's
missing row; the Transmission transport sends the last session id per endpoint, so a read every 2 s costs one request, not two.

**Not changed:** the 60 s Jellyfin waits for files written by something other than the plugin (a copy, a file removed with a file
manager); the retention delete path (only a notification was added after its native removal); version 0.1.0.0, no migration.
