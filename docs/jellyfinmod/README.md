# JellyfinMod

**Phase 3 planning:** [`PHASE3.md`](PHASE3.md) refines retention scope, proposed defaults,
deletion safeguards and T1–T6 acceptance; it supersedes older placeholder assumptions below.

**Current implementation:** use [`PLAN.md`](PLAN.md) for task order and
[`PHASE1.md`](PHASE1.md) for Phase 1 decisions and unresolved technical gates. Older `/catalog`
browse routes, redirects, `/Catalog` API names and tiny-diff estimates below are historical;
the current design uses existing browse routes and `/JellyfinMod/Entries`.

A catalog-first layer over Jellyfin: track what you want to watch whether or not the file
exists, acquire it yourself, and reclaim the disk once you are done with it.

The web-side design — catalog browsing, unified search, detail pages, release picker,
queue, retention affordances and the D-pad rules — lives in [`UX.md`](UX.md) beside this
file. A clickable prototype of it lives in
[`prototype/movies-prototype.html`](prototype/movies-prototype.html). This document decides what is built and why; that one decides what it looks like.

Target features:

1. A **catalog** of movies and shows that does not require a media file — Trakt-like.
2. **Acquisition** from the catalog: indexer search, quality profiles, grabbing to a
   download client, importing into the library — a replacement for Sonarr and Radarr.
3. **Retention**: N days after you finish something, delete the file but keep the catalog
   entry, marked watched.
4. **Discovery**: search TMDB / Trakt and add straight to the catalog.
5. **Multiple qualities** of the same title, selectable at play time, as a first-class thing.

## 1. Verdict on architecture

**A Jellyfin server plugin plus this web fork. Not a server fork.**

The instinct that this needs a server fork is based on one true fact: a Jellyfin `BaseItem`
is anchored to a file path. There is no supported way for a plugin to add a library item
with no media behind it. `LocationType.Virtual` and `BaseItem.IsVirtualItem` exist, but
they are the library scanner's own machinery for missing episodes, and an item parented
under a scanned folder with nothing on disk is at real risk of being reaped on the next
scan. Designing the catalog as file-less library items *would* push you into forking the
server.

The escape is to not do that.

**A catalog entry is not a library item. It is pre-library state.** It is a row that says
"this title, this state, this quality profile", with a *nullable* pointer to a Jellyfin
item id. The states are:

```
wanted -> searching -> grabbed -> downloading -> imported -> watched -> reclaimed
                                                                 |
                                                                 +-> (file gone, row stays)
```

Only `imported`..`watched` have a Jellyfin item id. Before that there is no file and
Jellyfin knows nothing about the title. After reclaim the file is deleted, Jellyfin's item
disappears on the next scan, and the catalog row persists with `watched_at` and history —
which is exactly the behaviour asked for. The catalog is the durable record; the Jellyfin
library becomes a cache of what is currently on disk.

Once you accept that, nothing left in the feature list needs a core change:

| Feature | Needs core change? | Where it lives |
| --- | --- | --- |
| File-less catalog | No — separate store | Plugin DB + web `/catalog` section |
| TMDB / Trakt search | No | Plugin proxies the API (keeps keys server-side) |
| Indexer search, grab, import | No | Plugin: Torznab client, download client, importer |
| Delete N days after watched | No | Plugin scheduled task + `ILibraryManager.DeleteItem` |
| Multiple qualities, selectable | **Already native** | Ride it; improve the web UI |
| Catalog items inside native library grids/search | **Yes** | See §9 |

That last row is the one real limitation, and §9 is about how far it actually reaches.

### Why not the other two options

**Server fork.** Buys one thing: catalog entries as real `BaseItem`s, visible to native
search, collections and Up Next. Costs: a C# core rebase every release; you ship your own
server build for every architecture you run; the 12.0 database rewrite means core internals
are moving under you right now. Not worth it for one feature you can approximate.

**Sidecar service.** Works, and it is what Jellyseerr, Ombi and Reiverr all are. But it
gives you a second thing to deploy, a second auth surface, and a second URL, and none of
those buy capability — a plugin can do everything a sidecar can. Its one genuine advantage
is licensing (see §7). The plugin wins on: Jellyfin's own auth for free, one deploy, one
process on the Pi, `ILibraryManager` in-process for imports and deletes, and playback
events without polling.

There is one honest sidecar-shaped hedge, and it is worth taking: **keep the acquisition
engine behind an interface inside the plugin**, so if the plugin ABI ever becomes
intolerable the engine can be lifted into its own process without rewriting it.

## 2. What the plugin can actually do

Verified against `jellyfin/jellyfin` master @ `6e4d98e6` (2026-09-02), `AssemblyVersion 12.0.0`.

- **HTTP API.** A plugin class deriving from `ControllerBase` is picked up by assembly
  scanning (`ApplicationHost.GetApiPluginAssemblies`, wired in
  `ApiServiceCollectionExtensions`) and added as an MVC application part with
  `AddControllersAsServices()`, so constructor injection works. Routing is entirely yours.
- **Auth.** `MediaBrowser.Common.Api.Policies` lives in `MediaBrowser.Common` precisely so
  plugins can use it. `[Authorize]` = any signed-in user; `[Authorize(Policy =
  Policies.RequiresElevation)]` = admin. The constant list is byte-identical between
  10.10.7 and 12.0. There is no `Policies.DefaultAuthorization`.
- **Storage.** Plugin config is **XML**, not JSON (`BasePlugin<T>.ConfigurationFilePath`,
  `XmlSerializer` — so no `Dictionary<,>` in the config class). For real data the plugin
  opens its own SQLite/EF Core database. Note `BasePlugin.DataFolderPath` can gain a
  `_<Version>` suffix across upgrades, so pin an explicit path off `IApplicationPaths`
  rather than trusting `DataFolderPath` for the DB file.
- **Background work.** `IScheduledTask` for periodic work (RSS sync, retention sweep) —
  discovered by assembly scan, shows up in Dashboard → Scheduled Tasks. `IHostedService`
  for long-lived loops (download monitor). `IServerEntryPoint` was **removed in 10.9**;
  ignore any guide that mentions it.
- **DI.** `IPluginServiceRegistrator.RegisterServices` runs against the host's own
  `IServiceCollection`. `ILibraryManager`, `IUserDataManager`, `ISessionManager`,
  `IProviderManager`, `IMediaSourceManager`, `IFileSystem`, `IApplicationPaths`,
  `ITaskManager` are all resolvable. Use `IHttpClientFactory.CreateClient(NamedClient.Default)`.
  Beware: some services are scoped, not singleton — do not capture them in a singleton.
- **Deleting media.** `ILibraryManager.DeleteItem(BaseItem, DeleteOptions)`.
- **Events.** The core's own `UserDataChangeNotifier` / `LibraryChangedNotifier` hosted
  services are the worked examples of the subscribe pattern. Exact signatures on
  `ISessionManager` / `IUserDataManager` / `ILibraryManager` still need confirming against
  master — treat as a Phase 3 task, not an assumption.

## 3. System shape

Three pieces, three repos:

```
jellyfin-web  (this fork)      -> /catalog section, discover, release picker,
                                  version selector UX. Additive files only.
JellyfinMod.Catalog  (new)     -> C# plugin. Own SQLite DB. REST API under
                                  /JellyfinMod/*. Scheduled tasks. Importer.
jellyfin  (upstream, unmodified)
```

**The rebase contract.** The web fork stays rebasable because every catalog change is a
*new file* plus a handful of one-line registrations:

- `src/apps/modern/routes/catalog/**` — new
- `src/apps/modern/features/catalog/**` — new
- `src/hooks/api/catalogHooks/**` — new
- `src/apps/modern/routes/asyncRoutes/user.ts` — one line added to the array
- `src/apps/modern/components/drawers/MainDrawerContent.tsx` — one nav entry

Five existing lines touched. That is a diff that rebases cleanly for years. **Keep it that
way**: every time a catalog feature wants to modify a shared component, ask whether it can
live in a new component instead.

Follow the fork's existing conventions: Conventional Commits, and `./jellyfin-sync --local`
to deploy. Catalog work adds a second deploy target — the plugin DLL — which the sync
script will need to learn about (Phase 1).

## 4. Data model (plugin SQLite)

```
catalog_item      id, media_type(movie|series), tmdb_id, imdb_id, tvdb_id, title, year,
                  overview, poster_path, added_at, state, monitored,
                  quality_profile_id, jellyfin_item_id (nullable),
                  watched_at (nullable), reclaim_after_days (nullable, overrides global)

catalog_episode   id, catalog_item_id, season, episode, air_date, state,
                  jellyfin_item_id (nullable), watched_at (nullable)

quality_profile   id, name, cutoff, items(json: allowed qualities in preference order),
                  min_size_mb_per_hour, max_size_mb_per_hour, upgrade_allowed

indexer           id, name, implementation(torznab), base_url, api_key, categories,
                  enabled, priority, seed_ratio_goal, seed_time_goal_minutes

download_client   id, name, implementation(qbittorrent|transmission|deluge), host, port,
                  use_ssl, username, password, category, enabled

grab              id, catalog_item_id, catalog_episode_id (nullable), indexer_id,
                  release_title, info_hash, size, seeders, quality, release_group,
                  download_client_id, download_id, status, grabbed_at, imported_at,
                  reject_reason (nullable)

history           id, catalog_item_id, event_type, data(json), created_at
```

`history` is what makes the catalog a durable record: a reclaimed title still shows when it
was grabbed, at what quality, when it was watched and when the file went away.

## 5. API surface (plugin)

All under `/JellyfinMod`, all `[Authorize]`, admin-only where marked.

```
GET    /JellyfinMod/Catalog                    list + filter by state/type
POST   /JellyfinMod/Catalog                    add {mediaType, tmdbId, qualityProfileId, monitored}
GET    /JellyfinMod/Catalog/{id}
PATCH  /JellyfinMod/Catalog/{id}               monitored, profile, reclaim override
DELETE /JellyfinMod/Catalog/{id}               optionally deleteFiles

GET    /JellyfinMod/Discover/Search?q=&type=   TMDB/Trakt proxy (keys stay server-side)
GET    /JellyfinMod/Discover/Trending
GET    /JellyfinMod/Discover/{source}/{id}     detail incl. seasons

GET    /JellyfinMod/Releases?catalogItemId=    fan-out Torznab search, parsed + scored
POST   /JellyfinMod/Releases/Grab              {catalogItemId, releaseGuid} -> download client

GET    /JellyfinMod/Queue                      active downloads
DELETE /JellyfinMod/Queue/{id}                 {removeFromClient, blocklist}

GET    /JellyfinMod/Settings/*                 indexers, clients, profiles, retention (admin)
POST   /JellyfinMod/Settings/Indexers/{id}/Test
```

## 6. Roadmap

Each phase is independently useful and independently deployable. Do not start the next one
until the previous is running on the Pi.

**Phase 0 — Foundations.** Scaffold `JellyfinMod.Catalog` from the plugin template against
the **confirmed target** (§7.1): `net9.0`, `Jellyfin.Controller` / `Jellyfin.Model`
`10.11.11`, `targetAbi` `10.11.0.0`. One health endpoint, one config page, EF Core context with
an empty migration. Teach `jellyfin-sync` to ship the DLL. Success: the plugin loads on the
Pi, `/JellyfinMod/Health` answers, and it survives a container restart.

**Phase 1 — Catalog + discovery (your chosen first slice).** TMDB client and proxy
endpoints. `catalog_item` CRUD. Web: `/catalog` route, grid, detail page, "Add to catalog"
from a discover search. No torrents. Success: search a film you do not own, add it, it
persists across restarts, and the section is usable on the TV with a D-pad.

**Phase 2 — Library reconciliation.** Match catalog rows to existing Jellyfin items by
provider id, so an entry you already own shows as `imported` with its item id. Backfill the
whole existing library into the catalog once. Web: catalog cards deep-link to the Jellyfin
item; item detail pages get a small catalog badge. Success: the catalog is a true superset
of what is on disk.

**Phase 3 — Retention.** Subscribe to playback/user-data events, stamp `watched_at`. Daily
scheduled task deletes files whose `watched_at + N days` has passed, moves the row to
`reclaimed`, writes history. Configurable N globally and per item; favourites exempt. This
phase is useful *before* acquisition exists and immediately reclaims disk. Two things the
existing media-cleaner plugins get wrong and this must not: **never delete a file the
torrent client is still seeding under its ratio/time goal**, and **never count a hardlinked
file as reclaimed space without checking the link count**.

**Phase 4 — Indexers and manual grab.** Torznab client (`t=caps` first, then `t=movie` /
`t=tvsearch`), release parsing, quality profiles, scoring. Web: a "Search releases" dialog
listing parsed releases with size/seeders/quality/freeleech, and a manual grab. Download
client abstraction — qBittorrent first, it is the best-behaved API of the three. Success:
grab a release from the catalog UI and watch it appear in qBittorrent with the right
category.

**Phase 5 — Import pipeline.** Watch the download client, detect completion, parse the
release, **hardlink** into the library under the version-suffix naming convention, trigger
a targeted library scan, bind the resulting Jellyfin item id to the catalog row. Honour
seed goals before removing the torrent. Success: add to catalog → grab → the film appears
in Jellyfin, playable, without touching qBittorrent's UI.

**Phase 6 — Automation and multi-quality.** Monitored items search automatically on a
schedule; new episodes of monitored series are grabbed on air. Explicit "get another
quality" that lands a second file under the same parent folder so Jellyfin merges it
natively; upgrade-to-cutoff replaces the old file. Web: promote the version selector on the
detail page — show resolution, size and codec per version instead of a bare label, and make
it reachable by D-pad on the TV.

Rough sequencing note: Phases 0–3 are the ones with a clear end. Phases 4–6 are where
Sonarr and Radarr spent years; expect them to keep absorbing effort, and expect the first
version to be worse than Radarr at picking releases. That is fine — it only has to be good
enough for the trackers you actually use.

## 7. Risks

### 7.1 Confirmed target: server 10.11.11, web 12.0

The Pi reports **server 10.11.11** (latest stable) serving a **web 12.0** bundle — this
fork, which tracks jellyfin-web master. That is a deliberately mismatched pair, and it
settles the plugin toolchain in the good direction:

| | Value |
| --- | --- |
| Target framework | `net9.0` (10.11.x `Jellyfin.Server.csproj`) |
| Package refs | `Jellyfin.Controller` / `Jellyfin.Model` `10.11.11` (published, stable) |
| `meta.json` targetAbi | `10.11.0.0` |

So the 12.0 RC churn does not touch this project at all until you *choose* to move the
server. Build against stable, and retarget to net10 / 12.0 as a deliberate later step.

**The mismatch is the real risk here, not the plugin ABI.** A web bundle from the 12.0 dev
line is talking to a 10.11 server. Jellyfin's API is mostly additive so most of it works,
but any endpoint upstream added for 12.0 will 404 against this server, and the pinned
`@jellyfin/sdk` unstable build is generated from the 12.0 OpenAPI spec. Consequences for
this project:

- Catalog UI must stick to API surface that exists in **10.11**, and anything odd in the
  existing app should be suspected of being mismatch fallout before it is debugged as a
  fork bug.
- The plugin's own endpoints are unaffected — they are ours, and we hand-write the client.
- There is an unmade decision here: rebase the web fork onto jellyfin-web's 10.11 release
  branch to match the server, or move the server to 12.0 to match the web, or keep the
  mismatch. Keeping it is fine for now, but note 12.0's database changes **cannot be rolled
  back without a full restore**, so the server upgrade is a one-way door to plan for
  deliberately rather than drift into.

**What "plugins may fail to load" actually means.** Two mechanisms, both recompiles:

1. `meta.json` carries `targetAbi`, which `PluginManager` treats as a *minimum server
   version* (`_appVersion >= targetAbi`, else the plugin is marked `NotSupported` and never
   loaded). Set it to the oldest server you intend to support; it is a one-line change.
2. The plugin references `Jellyfin.Controller` / `Jellyfin.Model` NuGet packages. If an
   interface you use is renamed or changes signature, you get a compile error when you bump
   the package — or, if you skip the bump, a `TypeLoadException` at runtime. 12.0 also moves
   the target framework to .NET 10.

So the cost of a breaking release is: bump two package versions, bump `targetAbi`, fix the
compile errors, rebuild, redeploy. Hours, not weeks, and the surface is small — this plugin
touches perhaps eight core interfaces. Note as evidence of how stable that surface actually
is: `MediaBrowser.Common/Api/Policies.cs` is byte-identical between 10.10.7 and 12.0, across
a full database rewrite.

Two properties worth valuing here. A plugin that fails to load is a **soft failure** —
Jellyfin still starts, the library still plays, you fix it when convenient. And fixing it is
*compile errors in your own code*, not a three-way merge into someone else's. A fork
inherits the same breaking changes with neither property: a bad rebase gives you a server
that does not boot, and you resolve conflicts in C# you did not write, in a codebase that is
mid-rewrite. The breakage does not go away by forking — it gets larger and more dangerous.

**Licensing — read before writing a parser.** Jellyfin is **GPL-2.0-only** (no "or later").
Sonarr and Radarr are **GPL-3.0**. Those are mutually incompatible, so porting Radarr's
`QualityParser.cs` or Sonarr's `Parser.cs` into a GPLv2-only-adjacent plugin is a real
problem, not a technicality. Use an MIT-licensed parser as reference instead
(`dreulavelle/PTT`, `clement-escolano/parse-torrent-title`) or write your own regexes
against Sonarr's *test cases* — behaviour is not copyrightable, source is.

**Multi-version is already solved; do not rebuild it.** Jellyfin natively groups
`Movie (2024) [imdbid-tt123] - 2160p.mkv` and `- 1080p.mkv` under one item with a version
selector, and `POST /Videos/MergeVersions` merges arbitrary items. The `mergeversions`
plugin only automates that API. Land files with the right names and this feature is mostly
web-side polish.

**Disk on a Pi.** Hardlink imports are not optional — a copy doubles every file while it
seeds. Download directory and library must sit on the same filesystem, which is a
deployment constraint to settle in Phase 0, not Phase 5.

**Scope.** "Full replacement of Sonarr and Radarr" is the largest item on the list by an
order of magnitude. The phasing above is deliberately arranged so that stopping after Phase
3 still leaves something you use every day.

### 7.2 Why not Rust

Asked and settled: no, and the reason is not taste.

**A Jellyfin plugin must be a .NET assembly.** It is loaded into the Jellyfin process by the
CLR. Choosing Rust is therefore not a language choice — it is a re-vote on the architecture,
back to the sidecar that §1 rejected: second deploy, second auth surface, no in-process
`ILibraryManager` for imports and deletes, and no playback events without polling.

**The footprint argument inverts on inspection.** The .NET runtime is already resident on
the Pi, because Jellyfin *is* .NET. A plugin's marginal cost is a few MB of managed heap in
a process that already exists. A Rust sidecar's marginal cost is a whole additional process.
The plugin is the smaller of the two options, not the larger.

**The workload is not CPU-bound.** Everything this project does is IO: HTTP to TMDB and
indexers, small XML/JSON payloads, SQLite reads and writes over thousands of rows, hardlinks
and unlinks. Rust would win microseconds on parsing while the Pi spends its actual CPU on
ffmpeg transcoding, which is native either way. The real Pi bottlenecks here are disk IO and
library-scan time over the placeholder files — both inside Jellyfin's own code, untouched by
what language this plugin is written in.

**When to revisit.** Two legitimate triggers, neither of them speculative performance: if
profiling on the Pi shows a genuine hotspot in plugin code, or if writing Rust is itself the
point. In the second case the honest move is to take the sidecar and its costs deliberately
rather than to half-do it through FFI — a C# shim P/Invoking a Rust `.so` means
cross-compiling for aarch64 and shipping a native blob in the plugin package, which is real
complexity bought for no measured gain.

If Rust does become desirable later, the **acquisition engine** is the piece that can move:
Torznab client, release parser, scoring, download-client drivers. It is pure IO and logic
with no Jellyfin API dependency, which is exactly why §1 already puts it behind an
interface. Catalog, retention, STRM management and import need in-process Jellyfin access
and stay C# regardless.

### 7.3 Why not rewrite the server in Rust either

Same answer, firmer, for a different reason.

Measured on master (2026-09-04): **313k lines of non-test C#**, 2,165 files, **419 HTTP
endpoints across 60 controllers**. But size is not the argument — the argument is that
*those 419 endpoints are the product*. Swiftfin, Findroid, Kodi, Infuse and the official
mobile apps work only because the server is bug-compatible with a decade of accreted
Emby/Jellyfin API behaviour. A rewrite has to reproduce that faithfully enough that a
closed-source client like Infuse keeps working, and you cannot read Infuse's source to find
out what it depends on. That is the job. Rust does not make it smaller.

Performance would not be the payoff either. The Pi's CPU goes to **ffmpeg**, which a Rust
server would shell out to identically. A rewrite wins idle RAM and startup time; it wins
nothing on transcoding, scanning, or disk IO — which are the things that are actually slow.

Prior art is the tell: [Dim](https://github.com/Dusk-Labs/dim) is the most serious Rust
media server and has effectively stalled. That is evidence about the size of the task, not
about Rust.

And it would end this project. JellyfinMod is a catalog, acquisition and retention product;
a server rewrite delivers none of those for a very long time while reimplementing things
that already work.

**If the Pi feels slow, diagnose it instead.** The usual culprits, in order: transcoding
where direct play would do (check the playback info and client codec support), the Jellyfin
database and image cache living on the SD card rather than an SSD, and library-scan cost.
All fixable without changing a language.

## 8. Open questions

1. ~~Which server build does the Pi run?~~ **Answered 2026-09-04: 10.11.11 stable, serving
   a 12.0 web bundle.** See §7.1. Remaining sub-question: resolve the web/server version
   mismatch, or accept it.
2. TMDB or Trakt as the catalog's primary identity? Recommendation: **TMDB ids as the
   primary key** (Jellyfin's own provider ids use them, so reconciliation is trivial), with
   Trakt as an optional sync/import source later.
3. Where do downloads land, and is that the same filesystem as the library? Determines
   whether hardlinks work.
4. Single-user or multi-user retention? "Watched" by whom — any user, or a nominated one?
5. Does the plugin repo go public alongside the web fork, and under which licence? **If it does,
   the name has to change.** Jellyfin's [branding guidelines](https://jellyfin.org/docs/general/contributing/branding/)
   say third-party developers "should **not** use the name Jellyfin directly", and additionally
   "discourage projects from using the combination of *Jelly[word]* or *[word]fin*" — so
   *JellyfinMod* is against both halves of that guidance. The recommended shape is a distinct name
   with "for Jellyfin" as a descriptor. **Accepted 2026-09-06: the name stays JellyfinMod while the
   project is private; renaming is a precondition of publishing, not of building.**
   **Superseded by the user's explicit publication request, 2026-09-08:** publish the plugin as
   `capische/jellyfin-mod` under its current name, matching the web fork's account and visibility.
   The plugin GUID
   is what Jellyfin actually keys on, so a later rename costs the assembly name, the root namespace,
   the config-page resource path and the docs — cheap now, tedious later.

## Decision log

- **2026-09-06** — **Removal, including Undo, is admin-only.** Ordinary users may add titles.
  Phase 3 expiry reclaims eligible media automatically unless an admin disables retention,
  preserving catalog entries/history and all existing deletion safeguards. Phase 1 does not
  perform automatic deletion.

- **2026-09-06** — **Home redesign included in Phase 1 by the user.** Implement the top bar
  and hero from UX §7.3 along with the two Home row merges. This is a narrow styling exception;
  preserve existing navigation actions and keep new styles feature-local.

- **2026-09-06** — **Phase 1 catalog permissions accepted:** one shared catalog, scoped to
  each user's accessible libraries. Ordinary users may add titles; admins remove titles and
  change settings. Enforce access in plugin endpoints, including discovery exclusions and
  direct entry lookups. Retention's choice of watched user remains undecided.

- **2026-09-04** — Catalog entries are plugin-owned rows, not Jellyfin `BaseItem`s. This is
  what makes a plugin sufficient and a server fork unnecessary.
- **2026-09-04** — Torznab + direct download-client APIs, not a hard dependency on
  Prowlarr/Jackett (which still work, since they speak Torznab).
- **2026-09-04** — ~~Catalog gets its own web section~~ ~~Superseded same day (§9): the catalog
  replaces the movie and show views by redirect~~ **Superseded again by `UX.md`: there is no
  separate catalog and no redirect. One entry per title, file or no file, and `/movies` is
  already that list. Nothing upstream is replaced, bypassed or deleted. Scope stays movies + TV.**
- **2026-09-04** — First milestone is catalog + TMDB search with no acquisition.
- **2026-09-04** — Web UX specified in [`UX.md`](UX.md): four presentation classes instead of
  seven state badges, a state chip row rather than a tab, one search box over three fixed-order
  tiers, and the stock detail page kept for anything with a Jellyfin item.
- **2026-09-04** — Plugin targets net9.0 / Jellyfin.Controller 10.11.11 / targetAbi
  10.11.0.0, matching the running server. Moving to 12.0 is a later, deliberate step.

## 9. Catalog as the primary surface

**Decided 2026-09-04: the catalog is not a section next to the library — it replaces the
movie and show views as the way you browse.**

The argument for it is stronger than "it would be nicer". Once retention starts deleting
files, **the library view actively lies to you**: it shows a shrinking subset of what you
have actually watched, and everything reclaimed simply vanishes. The catalog is the durable
record; the library is a cache of what happens to be on disk this week. Browsing the cache
instead of the record is backwards. Catalog-first is the correct default, not a preference.

Scope: **movies and TV only**. Music, books, photos and Live TV keep the existing views —
which is one of several reasons not to delete them (below).

> **Superseded 2026-09-04 by [`UX.md`](UX.md).** The redirect below assumed a catalog separate
> from the library. It is not: **a title is one entry that may or may not have a file behind it**,
> so `/movies` already *is* the catalog and there is nothing to redirect or replace. The decision
> that survives — never delete upstream's components — survives in a stronger form: nothing
> upstream is removed or bypassed at all. See UX.md §2.1 and its decision log.

### 9.1 How to replace: redirect, do not delete

"Fully replace" and "keep the fork rebasable" are reconcilable, but only one way.

Deleting or rewriting `src/apps/modern/routes/movies/` and `shows/` means a permanent
three-way merge against the components upstream touches most often. Instead:

- Build the catalog as **new files** (`routes/catalog/**`, `features/catalog/**`).
- Point the nav, the post-login landing and the `movies` / `tv` route paths **at the catalog
  routes** — a redirect in `asyncRoutes/user.ts` / `routes.tsx`.
- Leave upstream's movie and show components **on disk, unreferenced**.

The running app then has exactly one way to browse movies and TV, which is the goal. But
the replaced code is dead code rather than deleted code, and dead code rebases silently
forever. It also stays available as an escape hatch for anything the catalog has not covered
yet, which during Phases 1–3 is most things.

Estimated diff against upstream files: still under a dozen lines.

### 9.2 The limit of the idea: other clients

You use four client surfaces, and the catalog can only ever reach two of them:

| Client | Sees the catalog? | Why |
| --- | --- | --- |
| Desktop browser | Yes | Serves this fork |
| LG webOS TV app | Yes | `jellyfin-webos` wraps this same bundle |
| Jellyfin iOS / Android | **No** | Native; queries the server's `/Items` directly |
| Kodi / Infuse / Findroid / Streamyfin | **No** | Same — server API only |

This is not a limitation of the plugin approach. It is a consequence of the catalog being
plugin-owned data: a client that only speaks stock Jellyfin API sees stock Jellyfin data. On
those clients a reclaimed title is simply gone, and a wanted title never existed.

So **"the old Jellyfin UI becomes obsolete" is true on web and the TV, and false on the
phone apps and Kodi.** Since CLAUDE.md makes the LG TV the primary watching surface, that
may be an acceptable split — but it should be an accepted split, not a surprise.

### 9.2.1 Closing the gap: Channels are a dead end, STRM is not

Two ways exist to make plugin-owned entries visible server-side. Both were investigated
against `v10.11.11` and `master`.

**Channels (`IChannel`) — rejected.** The API is alive and unchanged between 10.11.11 and
12.0, channel items are real `BaseItem` rows with working `UserData`, remote poster URLs are
downloaded and cached server-side, and they are reachable through ordinary
`GET /Items?parentId=`. A path-less channel item resolves to `LocationType.Remote`, not
`Virtual`, so it dodges the virtual-item filters. Technically it works.

It fails on the only axis that matters here — client coverage:

| Client | Channels |
| --- | --- |
| jellyfin-web, jellyfin-android, Android TV | Supported |
| **Swiftfin (iOS/tvOS)** | Not routed — `CollectionType.supportedCases` has no channel case |
| **Findroid** | Not supported — channels absent from `CollectionType.kt` |
| **Streamyfin** | No channel code path found |
| **jellyfin-kodi** | Syncs only movies/tvshows/boxsets/musicvideos/music |

An entire competing plugin ([Jellyfin-Xtream-Library]) exists specifically to escape this,
citing channel support as *"particularly broken in Swiftfin"*. Add: no official
documentation (`IChannel` appears zero times in the docs repo), no search
(`ISearchableChannel` does not exist in Jellyfin), no library-change websocket events, and
roughly two years with no functional commits. There is also a live footgun — browsing reaps:
`GetChannelItemsInternal` deletes any previously-seen item your plugin stops returning for a
folder, taking its `UserData` with it.

**STRM placeholders — the pattern the ecosystem actually converged on.** A `.strm` file is a
text file containing a URL that Jellyfin treats as a media item. It is roughly 100 bytes and
it is a *real file*, so the item it produces is an ordinary library item: visible in every
client, indexed by search, eligible for collections, and carrying `UserData` that persists
because the item is never deleted.

That last property is the important one. It dissolves the problem §1 was built around: you
no longer need watched state to survive an item's deletion, because **the item stops being
deleted**. Reclaiming disk means deleting the multi-gigabyte media file and leaving the
100-byte placeholder behind. Jellyfin keeps the item, the artwork, the played flag and the
play count, on every client, with no plugin involvement at playback time.

**Recommended shape — hybrid, split by whether you have ever owned the title:**

| Catalog state | Representation | Visible where |
| --- | --- | --- |
| `wanted`, `searching`, `grabbed`, `downloading` | Plugin DB only | Web + TV (this fork) |
| `imported`, `watched` | Real media file (as today) | Everywhere |
| `reclaimed` | `.strm` placeholder left in place | Everywhere |

This matches the actual requirement. "See what I have watched even after the file is
removed" must reach every client — and does. A wishlist of things never downloaded does not
need to appear in Kodi, and putting it there would make every client show thousands of
unplayable rows.

Open mechanics to verify on the Pi before committing (none are load-bearing for Phase 1):

- Whether a `.strm` and a real media file in the same folder merge as *versions* of one item
  (which would make reclaim a version-deletion and keep the item id perfectly stable), or
  produce two items.
- What each client does when a `.strm` with a dead target is played — ideally point it at a
  plugin endpoint that returns a short "not downloaded" clip rather than an error.
- Scan cost of a few thousand placeholder files on a Pi, and TMDB metadata-refresh volume.

**Consequence for §9.1:** if catalog entries are real library items with real metadata, the
stock library views already render them. Replacing the movie and show views becomes a choice
about affordances — state badges, release search, retention countdowns, discovery — rather
than a requirement for the catalog to be visible at all. That lowers the risk of the
redirect approach considerably, and is another argument against deleting upstream's views.

[Jellyfin-Xtream-Library]: https://github.com/firestaerter3/Jellyfin-Xtream-Library

### 9.3 Consequences for the data model and phasing

- **Watch history: mirror it, but STRM makes it survivable.** The catalog still mirrors
  played state into `catalog_item.watched_at` / `history` (it needs it to drive retention,
  and it is the record for titles that were never library items). But with STRM placeholders
  the Jellyfin item is not deleted on reclaim, so native `UserData` survives too — the
  catalog is the record, not the only copy.
- **Phase 2 (reconciliation + full library backfill) is promoted to the foundation.** The
  catalog cannot become the default browsing surface until every existing title is in it.
- **Phase 1 grows.** Before the swap, the catalog grid has to match what the library grid
  already does: sort, filter, resume/Continue Watching, correct D-pad behaviour at
  1920x1080, and per-user played state. A catalog that is prettier but worse to browse is a
  downgrade.
- **Artwork has two sources.** Items on disk use Jellyfin's image endpoints; catalog-only
  and reclaimed items use TMDB URLs. The card component needs to handle both, and reclaimed
  items should look deliberately different from owned ones rather than broken.
- **2026-09-04** — Catalog owns watch history; Jellyfin `UserData` is treated as a mirror
  that disappears with the file.
- **2026-09-04** — `IChannel` rejected for surfacing catalog entries: no support in Swiftfin,
  Findroid, Streamyfin or Kodi, undocumented, feature-frozen, and it reaps items you stop
  returning. STRM placeholders adopted instead for the `reclaimed` state.
- **2026-09-04** — Rust rejected: a plugin must be a .NET assembly, so Rust means the
  rejected sidecar; and the .NET runtime is already resident for Jellyfin, making the
  plugin the smaller-footprint option. Revisit only on measured hotspots.
- **2026-09-04** — Rewriting the Jellyfin server itself in Rust rejected: 313k lines and 419
  endpoints whose value IS bug-compatibility with existing clients; the Pi's CPU is ffmpeg
  either way.
- **2026-09-06** — **One plugin, named `JellyfinMod`.** The `.Catalog` suffix is dropped: it
  undersold a plugin that also does acquisition and retention, and it collided with Jellyfin's own
  Dashboard vocabulary, where the plugin browser is itself the *Catalogue*. The domain type is
  `Entry` and the route is `/JellyfinMod/Entries`, matching the design's central claim that there
  is no catalog — only entries that may or may not have a file.
