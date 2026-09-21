# Phase 7 — setup, admin UI and UI delivery

Planning draft, 2026-09-20. Read [PLAN.md](PLAN.md), [README.md](README.md) §1, §3, §7.1 and
§9.2, [UX.md](UX.md) §1, §2, §7.3, §12, §13 and §14, [PHASE1.md](PHASE1.md) §6–§7,
[PHASE4.md](PHASE4.md) (settings and secrets), [PHASE5.md](PHASE5.md) (path mappings and the
import probe), [PHASE6.md](PHASE6.md) (automation settings), [REVIEW.md](REVIEW.md) (the browser
acceptance runner) and [API.md](API.md) alongside this refinement. This document plans work; it
does not establish that Phases 4–6 have passed live acceptance, it writes no product code, and it
does not authorize any deployment. Every default below that is not quoted from an earlier accepted
decision or from the 2026-09-20 user decisions is **Proposed, not user-approved**.

The 2026-09-19 user decisions recorded in PHASE4, PHASE5 and PHASE6 apply unchanged: Transmission
is the only download client, secrets live in the plugin secret store and are write-only, every
import is a same-mount hardlink, automation and seed release are off until an administrator
enables them.

Phase 7 is where the product stops being "a fork you deploy by hand plus a plugin you configure
through a Dashboard page and raw API" and becomes "install the plugin and Jellyfin is the new
product; disable it and stock Jellyfin is still there, byte for byte". Nothing in it changes what
the catalog, acquisition, import, retention or automation do; it changes what the interface is,
how it is delivered, how it is configured and how it is switched on and off.

## Accepted user decisions — 2026-09-20 and 2026-09-21

These were decided by the user on 2026-09-20. They override any proposal below that disagrees.

1. **Full replacement, not a skin.** With the plugin enabled, the new interface replaces the
   original Jellyfin web experience completely at the normal `/web` address: its own shell,
   navigation, home, library browse, detail, search and settings. Every stock screen a user
   relies on is either reimplemented in the new interface or reachable through it, including the
   Jellyfin Dashboard and playback; nothing becomes unreachable. Disabling or uninstalling the
   plugin restores the original interface byte for byte. Already-reclaimed media stays reclaimed.
   The staged order is shell and navigation first, then home, browse, detail and search, then
   settings and admin, each stage accepted in a real browser on desktop, mobile and TV.
2. **Delivery route:** plugin-served UI combined with the plugin patching Jellyfin's
   `index.html` itself (options (b) + (c) in §4). Enabling the plugin makes the new interface the
   experience at `/web`; disabling or uninstalling restores stock exactly. The runtime capability
   switch inside the fork (option (a)) is the first staged step and the in-app "stock look when
   the plugin is off" behaviour. Swap in place is the preferred takeover mechanism; redirect is
   the fallback. The third-party File Transformation plugin is not an option.
3. **Distribution:** a custom Docker image, stock Jellyfin plus the plugin preinstalled, is the
   preferred shape; the versioned release archive with `JELLYFIN_WEB_DIR` or a volume is a
   secondary, documented shape.
4. **The `jellyfin-web` fork stays the source of the interface and keeps pulling upstream.**
   `master` tracks upstream Jellyfin Web, `jellyfin-mod` carries the mod, the fork builds the new
   interface, the plugin ships and serves that built bundle and patches `index.html`, and the
   image is stock Jellyfin plus that plugin. The plugin never contains a hand-maintained copy of
   the interface. Full replacement therefore means a separate build entry inside the fork, not
   rewriting upstream screens in place, with a minimal, enumerated patch surface, reuse of
   upstream modules, a documented upstream merge routine and a version/compatibility matrix.
5. **Retention keeps the media folder.** After a file is reclaimed, its folder and every
   sidecar (`.nfo`, subtitles, artwork, extras) stay on disk and empty folders are not tidied.
   This is current behaviour and is recorded as accepted; Phase 7 plans no change to it.
6. **Test hygiene.** Acceptance runs must not leave fixtures behind in the user's library or
   catalog: no leftover "JellyfinMod …" movies or shows. Every fixture is disposable, created
   only in the isolated writable test library, and removed at the end of the run, or explicitly
   listed for cleanup if a run aborts.

The four below answer open questions 1, 2, 4 and 7. They replace the proposed defaults where
they differ; the remaining open questions stay open and their proposed defaults stand.

7. **Takeover is on wherever the web root is writable** (open question 1; replaces default 1's
   "off until enabled"). Installing the plugin takes over `/web` automatically as soon as it
   can, in every shape, not only in the image. Three things follow and are requirements, not
   options: an explicit administrator setting still turns the takeover **off**, and the failsafe
   and restore paths of §4.4 and §4.6 are unchanged; the automatic takeover is **visible** —
   the plugin logs it at every patch and Health and the settings Interface section report that
   it happened and why, so an administrator who did not ask for it can see why `/web` changed;
   and a read-only web root still degrades to plugin-path serving with the blocker (default 4),
   never to a failure or a forced remount.
8. **The isolated compose keeps its bind mount and makes it read-write** (open question 2;
   replaces the §4.8 proposal of removing it). The mount stays so `jellyfin-sync --local --test`
   keeps working; only `ro` becomes `rw`. **This deliberately differs from the shipped Docker
   image**, where there is no bind mount and the container's own stock web directory is the
   takeover target. The two shapes are therefore not interchangeable evidence: S5 and S11 must
   verify the **image** path as well as the bind-mounted one, and a takeover result on the
   isolated instance alone never stands for the image.
9. **The look is server-wide only** (open question 4; confirms default 16). There is no per-user
   "classic Jellyfin" preference in Phase 7, and none is built speculatively.
10. **The stock-for-now list is accepted as planned** (open question 7; confirms default 9).
    Music, live TV, books, photos, playlists and collections stay upstream screens inside the
    mod shell for Phase 7. They are reachable and fully functional there; moving any of them to
    Reimplement is a later phase decision, and none of them blocks the takeover being on by
    default.

**Accepted 2026-09-21.**

11. **The Docker image preconfigures the self-hosted repository** (§S5.1; settles what was
    proposed there). A manual install still registers nothing, and the README documents the one
    step for that case. The preconfiguration has to be honest and reversible, which means all of
    the following, and they are requirements rather than preferences:
    - It appears in Manage Repositories like any other, clearly named, and removing it leaves
      the plugin working. Only the details panel and the update path depend on it; the catalog,
      acquisition, import, retention and the interface do not.
    - The image's documentation says it points at **the server's own address**, so no external
      service is contacted. That is the reason it is defensible to ship it already registered.
    - It is **image configuration, not plugin behaviour**: the plugin never writes the
      repository list at runtime, on any install, however convenient that would be.
    - If a JellyfinMod repository is already registered — the operator added it by hand first —
      the image does not add a second one.

## Outcome and boundaries

An operator runs the JellyfinMod image, or installs the plugin into a stock server. Every browser
and web-based TV client that opens `/web` gets the JellyfinMod interface: its own shell, home,
Movies and TV browse, search, detail pages and settings, with playback, other library types,
user preferences, Quick Connect and the Jellyfin Dashboard reached through it as the upstream
modules they are. On the first administrator sign-in a wizard walks through TMDB, the download
client, indexers (typed by hand or synced from Prowlarr), a quality profile and switching
acquisition on, each step gated by a real connection test. Every setting the product has lives in
one administrator-only settings area, with secrets that are written but never read back. Turning
the plugin off or removing it returns the byte-identical stock page and a plain Jellyfin keeps
working on the same data. The fork keeps merging upstream, and a Jellyfin release upgrade has a
checklist rather than a rewrite.

- Phase 7 owns: the mod bundle entry inside the fork and its shell, navigation and routing; the
  mod-owned home, browse, detail and search screens (built from the Phase 1–6 components);
  packaging and serving the built bundle from the plugin; the `index.html` takeover engine with
  its pristine copy, markers, checksums, reconcile-at-startup, failsafe and restore; the image
  and archive shapes; the upstream maintainability contract; the settings contract that unifies
  XML-held and SQLite-held settings behind typed endpoints; the settings area and wizard; native
  Prowlarr support.
- Phase 7 reuses and does not rewrite: the Phase 4 settings resources, secret store, readiness
  blockers and Test endpoints; the Phase 5 path-mapping probe and `TestImportPath`; the Phase 6
  automation settings and status; Health `capabilities` and the web's existing gating; every
  Phase 1–6 web component (`EntryCards`, `FileFilterGroup`, `CatalogSearchResults`,
  `HomeMergedRow`, `HomeHero`, `NativeEntryDetails`, `ReleasePickerDialog`, `QueuePage`,
  `VersionRows`, `RetentionStatus`); upstream playback, authentication, API client, routing,
  input and layout modules.
- Phase 7 does not change any catalog, acquisition, import, retention or automation behaviour.
  A value saved through the new settings area has exactly the effect it has today when saved
  through the Dashboard page. Retention's folder and sidecar behaviour is unchanged (decision 5).
- The takeover writes exactly two files into the web root (`index.html` and a stock copy beside
  it), never a bundle file; it never edits any other host file, never changes host configuration
  and never fails plugin startup. Every write is atomic and every restore is verified by checksum.
- Nothing upstream is removed from the fork's stock entry (UX Principle 0). The mod entry is a
  second application built from the same tree; upstream screens it does not own are imported,
  not copied.
- All development, deployment and E2E use `jellyfinmod-test` on `<isolated-test-port>` with state
  under `<isolated-state-dir>`, the disposable Transmission, the Torznab boundary server and a new
  Prowlarr boundary server. Production `jellyfin` on `<production-port>`, its web root, its media
  mounts and its Transmission are never contacted or changed. Nothing in this phase starts before
  the entry gates below.

## Accepted decisions carried into this phase

- Additive only; preserve upstream CSS; three layout modes; degrade when the plugin is absent;
  never blank a grid on refetch (PLAN non-negotiables). They now apply to the mod entry's own
  screens as design rules, and to the stock entry unchanged.
- Settings and destructive actions are admin-only, enforced by the server (Phase 1). Search,
  grab and profile changes are admin-only (Phase 4 A1). Queue visibility defaults to
  administrators (Phase 5 default 1).
- Secrets are references into the `0600` secret store; no DTO, log, history event or diagnostic
  returns a value (PHASE4 user decision 3).
- Retention reclaims the media file only: the folder, `.nfo`, subtitles, artwork and extras stay,
  empty folders are not removed, catalog entry and history stay (decision 5 above; PHASE3
  sidecar and T18 evidence).
- The web bundle uses only API surface present in the pinned 10.11 server (README §7.1).
- Never port GPL-3.0 Sonarr/Radarr/Prowlarr code; behaviour may inform tests, source may not.

## Acceptance conventions for this phase

- Real E2E through the running isolated server and a real browser; plugin suites through a real
  Kestrel host with authentication, serialization, migrations and SQLite; boundary servers over
  real HTTP for TMDB, Torznab, Transmission and Prowlarr. No unit tests, no mocked clients. Type
  checks, lint, stylelint and builds are supporting evidence only.
- Browser matrices cover desktop, mobile at 390 px, TV 1920×1080 and TV 1280×720 with
  `localStorage.setItem('layout','tv')`, driven by arrow keys, Enter and Back; physical webOS
  evidence is reported separately (PLAN definition of done 4 and 6).
- Sign in as `oleksii` with an empty password; an ordinary user and anonymous requests for
  every authorization check.
- **Hygiene (decision 6).** Every fixture the runner or a checklist creates carries the
  `JellyfinMod` prefix, is created only in the isolated writable test library and the isolated
  catalog, and is removed at the end of the run; the runner already removes what it confirmed it
  created, and Phase 7 extends that to entries, indexers, sources, profiles, clients and web-root
  state. An aborted run prints a cleanup list (entry ids, native item paths, torrent hashes,
  files written to the web root) and the checklist's last step is to work through it. A final
  check in every run asserts that no `JellyfinMod`-prefixed title remains in any library or in
  `GET /Entries`, and that `<web-root>` holds only the two files the engine owns or none.
- Evidence records plugin revision and bundle id from Health, image tag, host version, the merged
  master SHA and which host services the suites simulated; no LAN address or host path.

## What exists today

Recorded from the source on plugin `master` (`7299b07`) and web `jellyfin-mod` (`2d380e424c`)
on 2026-09-20, so the tasks below say accurately what is new.

| Area | Exists | Gap Phase 7 closes |
| --- | --- | --- |
| Web app shape | One webpack entry `main.jellyfin` (`src/index.jsx`) plus theme entries; `RootAppRouter` composes modern-or-legacy user routes (chosen by `layoutManager.modern`; TV uses legacy), dashboard routes and wizard routes under a hash router; `details`, `video`, `list`, `lyrics`, `queue`, login and server selection are legacy views in every layout. | No second entry; the mod is a set of additive mounts inside stock screens (nine upstream files). |
| Mod web features | `features/jellyfinmod/**`: entry cards and marks, File filter group, two-zone search, native detail augmentation, merged Home rows, hero and top-bar restyle, release picker, queue page, version rows, retention status; capability gating with `retry: false`. | No mod-owned shell, navigation, home, browse, detail or search pages; the hero and top bar mount whenever the fork runs, plugin or not. |
| Settings API | `GET/POST/PATCH/DELETE /JellyfinMod/Settings/{Indexers,DownloadClients,QualityProfiles}`, `POST …/Indexers/{id}/Test`, `POST …/DownloadClients/{id}/Test`, `GET/PATCH /Settings/Acquisition` (with `ready`, `blockers`, `holdSeconds`, `seedProtectionMatchesClient`), `GET/PATCH /Settings/Import`, `GET/PUT …/DownloadClients/{id}/PathMappings`, `POST …/TestImportPath`, `GET/PATCH /Settings/Automation`, `GET /Automation/{Status,Decisions,Targets}`, `POST /Automation/Run`. All `RequiresElevation`, revisioned, unknown fields rejected. | No overview endpoint; no typed endpoint for discovery (TMDB) or retention; no Prowlarr; no setup state. |
| Secrets | `AcquisitionSecretStore`: one plugin-owned JSON file, mode `0600`, atomic replace; rows hold `sec_…` references; DTOs report `apiKeyConfigured` / `passwordConfigured`; `SecretChangeRequest` actions `unchanged` / `replace` / `clear`. `Plugin.UpdateConfiguration` moves the TMDB token, TMDB key and the seed-protection Transmission password out of XML into the same store. | Nothing; Phase 7 adds one secret (the Prowlarr API key). |
| Where settings live | Acquisition, import and automation settings in the SQLite `AcquisitionSettings` row with per-area revisions. Discovery (TMDB), retention (mode, days, selected user, favourites) and the **seed-protection** Transmission RPC URL/username/password in XML `PluginConfiguration`, edited through the host's plugin-configuration API by `configPage.html`. | Two Transmission connections (seed protection in XML, acquisition client in SQLite) that can disagree; `seedProtectionMatchesClient` only reports it. |
| Admin UI | `configPage.html` (Dashboard → Plugins → JellyfinMod): Discovery, Retention (+ Seed protection), Library reconciliation, Manual acquisition (defaults, Torznab indexers, download client, path mappings, quality profiles), Import and seeding, Automation (+ recent decisions). Not browser-verified for Phases 4–6. | No settings inside the JellyfinMod interface; no wizard; no readiness overview. |
| Health | `GET /JellyfinMod/Health` returns `Name`, `Version`, `Ok` and `Capabilities` (`browse.dueWithinDays` … `automation`, `versions`). | No `revision`, no bundle or takeover state (X4's `revision`/`lastMigration` still open). |
| Bundle | `dist/` ≈ 60 MB with source maps, ≈ 2 300 top-level files; `output.publicPath: ''`; entry files are `[name].bundle.js` with a query-string hash, chunks `[name].[contenthash].chunk.js`; `runtimeChunk: 'single'`; `HashRouter`; `serviceworker.js` registered by relative URL; `fetchLocal('config.json')` resolves against the document URL. | Served only by bind-mounting `dist/` over the container's web directory (`jellyfin-sync`); nothing in the plugin package. |
| Deploy tooling | `jellyfin-sync` with `--test` / `--plugin` targeting (X3 partially landed); the isolated compose bind-mounts the fork's `dist/` over the web directory read-only and has exactly one writable bind mount (PHASE5 I1 evidence). | The web directory must become writable, or unnecessary, for the takeover. |
| Browser acceptance | `scripts/jellyfinmod-e2e/browser-review.mjs` (Playwright over CDP, 19 checks in ≈ 75 s, quick mode in ≈ 35 s, per-step timings, fixture cleanup) against the isolated instance. | New steps for the shell, mod screens, takeover, failsafe, restore, settings, wizard and Prowlarr; the hygiene assertion. |

## 1. Architecture

```
jellyfin-web fork                      plugin (JellyfinMod)                 host
  master  = upstream + prod fixes        jellyfinmod-web.zip  ───extract──▶  <plugin-data>/web/<bundleId>/
  jellyfin-mod = master + mod            JellyfinMod.dll                      │ served at
     │ npm run build                     ├ /web-mod/<bundleId>/ ◀─────┘
     ├ dist/index.html      (stock entry, unchanged screens)      ├ takeover engine ──▶ <web-root>/index.html (patched)
     ├ dist/jellyfinmod.html (mod entry: shell + mod screens      │                      <web-root>/index.jellyfinmod-stock.html
     │                        + upstream screens imported)        └ pristine copy ──▶ <plugin-data>/web-root/
     └ dist/jellyfinmod-web.json (bundleId, webCommit, ranges)
docker image = jellyfin/jellyfin:<pinned> + plugin folder + entrypoint that installs it
```

The fork is the only place interface code lives. One build produces both entries and their
shared chunks; the plugin zip is `dist/` without source maps; the plugin serves it and renders
`/web/index.html` from `jellyfinmod.html`. Stock is whatever the host ships; the plugin only ever
rewrites one file of it and keeps its original.

## 2. Full replacement: screens, stages and what "stock" means

### 2.1 The mod entry shadows what it owns and imports the rest

`src/jellyfinmod.jsx` is a second webpack entry. It runs the same boot as `src/index.jsx` (server
connections, `playbackManager`, plugins, themes, `layoutManager`, `inputManager`, `autoFocuser`,
`globalize`, the service worker; see §3.1 for how the boot is shared) and mounts
`ModAppRouter` instead of `RootAppRouter`. `ModAppRouter` is a hash router whose route table is:

1. the mod routes, listed first so they shadow upstream paths of the same name: `home`, `movies`,
   `tv`, `search`, `details`, `catalog/queue`, `catalog/settings`, `catalog/settings/setup`;
2. upstream's route tables imported unchanged, `MODERN_APP_ROUTES` or `LEGACY_APP_ROUTES` by
   `layoutManager.modern`, then `DASHBOARD_APP_ROUTES` and `WIZARD_APP_ROUTES`, so every other
   stock path (music, live TV, books, photos, playlists, collections, user preferences, Quick
   Connect, login, the video player, the Dashboard, the server wizard) resolves to the upstream
   screen rendered inside the mod shell.

`details` is shadowed by a dispatcher: it reads the item type first and renders the mod detail
page for movies, series, seasons and episodes (and for file-less entries), and mounts the upstream
`itemDetails` view unchanged for everything else (albums, artists, people, books, photos, live TV).
The mod shell provides the top bar, navigation, user menu and page chrome for every route,
including the imported ones; the imported legacy views keep their own `.skinHeader` hidden by the
same mechanism the modern layout uses today, and the Dashboard keeps its own left navigation.

### 2.2 Screen inventory

Per stock screen: **Reimplement** (mod-owned page in `features/jellyfinmod/`), **Embed** (the
upstream module imported and rendered inside the mod shell, reachable from mod navigation),
**Stock for now** (the upstream screen, reached through the shell, with no mod work in Phase 7).
Nothing is unreachable at any stage.

| Stock screen | Route(s) | Phase 7 | Stage | Notes |
| --- | --- | --- | --- | --- |
| Select server, add server, login, forgot password, Quick Connect sign-in | `selectserver`, `addserver`, `login`, `forgotpassword*`, `quickconnect` | Embed | A | Upstream session views under the mod shell's minimal (logo-only) chrome; authentication code untouched |
| Home | `home` | Reimplement | B | Hero, merged Continue Watching, merged Recently Added, the user's remaining Home sections rendered with upstream `homesections` builders (Embed inside the page), Home settings honoured |
| Movies library (grid, suggestions, trailers, favourites, collections, genres) | `movies` | Reimplement grid; Embed the other tabs | B | The grid is `EntryCards` + upstream filter dialog with the File group; Suggestions, Trailers, Favorites, Collections, Genres tabs render the upstream tab controllers inside the mod page shell |
| TV library (shows, suggestions, upcoming, genres, episodes) | `tv` | Reimplement shows grid; Embed the other tabs | B | As Movies |
| Search | `search` | Reimplement | B | Two zones: upstream `SearchResults` sections imported, plus Add from TMDB (existing `CatalogSearchResults`) |
| Movie / series / season / episode detail | `details` | Reimplement | B | Mod detail page with native playback actions from upstream `itemContextMenu` and `playbackManager`; file-less entries; History, retention, versions, Search releases, Keep, Remove |
| Album, artist, person, book, photo, live TV item detail | `details` | Embed | A | Dispatcher falls through to the upstream `itemDetails` view |
| Video player, OSD, subtitles, chapters, SyncPlay | `video` | Embed | A | Upstream `videoosd` and `htmlVideoPlayer`; full-screen, shell hidden as today |
| Music (albums, artists, playlists, songs, genres), music player bar, queue, lyrics | `music`, `musicvideos`, `queue`, `lyrics` | Stock for now | A | Upstream views under the mod shell; out of scope for the catalog |
| Live TV (guide, channels, recordings, schedule, series timers) | `livetv` | Stock for now | A | Upstream views under the mod shell |
| Books, photos and home videos, playlists, collections, mixed folders, generic list | `books`, `homevideos`, `playlists`, `boxsets`, `mixed`, `list` | Stock for now | A | Upstream views under the mod shell; `list` also serves genre and person drill-downs |
| Download queue | `catalog/queue` | Reimplement (exists) | A | Existing `QueuePage`, mounted in the mod shell |
| User: profile, display, home screen, playback, subtitles, controls, Quick Connect | `userprofile`, `mypreferences*`, `quickconnect` | Embed | C | Upstream user settings pages, reached from the mod user menu under a *Jellyfin preferences* heading |
| Metadata manager | `edititemmetadata` (legacy) | Embed | A | Upstream view, reached from the user menu as today |
| Jellyfin Dashboard (general, users, libraries, playback, networking, keys, logs, plugins, tasks, devices, activity, live TV, branding, backups) | `dashboard/**` | Embed | A | Upstream `DASHBOARD_APP_ROUTES` inside the mod shell, with its own left navigation; the JellyfinMod plugin page stays reachable there |
| Server first-run wizard | `wizard*` | Embed | A | Upstream `WIZARD_APP_ROUTES`; a fresh server still sets itself up |
| JellyfinMod settings and setup | `catalog/settings`, `catalog/settings/setup` | Reimplement (new) | C | §5 and §7 |
| Top bar, drawer / library navigation, user menu, theme, back handling | (shell) | Reimplement | A | Own shell; library links from `useUserViews` and `appRouter.getRouteUrl(view)` as upstream does, so every library type keeps a destination |

"Stock for now" screens keep every upstream behaviour because they are the upstream code; they
only gain the mod shell around them. Moving one of them to Reimplement is a later phase decision,
not a Phase 7 task.

### 2.3 Stages and their acceptance

Each stage is accepted in the built browser against the isolated instance on desktop, mobile,
TV 1920×1080 and TV 1280×720 by D-pad, signed in as `oleksii`, with an ordinary user for
authorization, and with physical webOS evidence reported separately.

**Stage A — shell and navigation (S2).** The mod entry builds and runs; the shell, library
navigation, user menu, theme and Back work; every route in the inventory resolves and every
Embed and Stock-for-now screen is reachable and functional inside the shell; the mod-owned
screens are, for this stage, the existing `catalog/queue` and a placeholder-free pass-through for
`home`, `movies`, `tv`, `search` and `details` to the upstream screens (so Stage A alone is a
complete, usable interface). Acceptance: sign in, browse each library type, play a movie and an
episode to the end and back, open the Dashboard and save a setting there, run the server wizard on
a scratch config, use Quick Connect, change a user preference, sign out, from every layout; with
the plugin transport blocked the shell still renders and every stock screen still works.

**Stage B — home, browse, detail, search (S6).** The mod-owned pages replace the pass-throughs.
Acceptance per page mirrors the Phase 1–6 acceptances they absorb (W2–W7, A7, I8, M8, T14, T19):
file-less entries sorted among owned ones with correct paging, the File and Due filters composed
with stock groups, two-zone search with optimistic add and Undo rules, the detail page with native
Play, resume, mark played, favourite, versions, History, retention, Search releases, Keep and
Remove, the hero and merged rows honouring Home settings, grids never blanking, focus never
leaving the focused container on TV. The stock entry's additive mounts for a screen are removed
only after its mod page passes (§3.2).

**Stage C — settings and admin (S7–S10).** The settings area, the wizard, Prowlarr and the
embedded upstream user preferences and Dashboard under the mod user menu. Acceptance per §5–§7.

**What disabled must look like, at every stage.** The host's byte-identical stock `index.html`
at `/web`; stock Jellyfin on the same data. Entries, history, evaluations, grabs, imports, secrets
and the pristine copy stay in `<plugin-data>`. No scheduled task runs, so retention, import, seed
release and automation stop. Already-reclaimed files stay reclaimed: their folders and sidecars
remain on disk (decision 5) and the stock library no longer lists the titles, which is stock
behaviour. Torrents the plugin added stay in Transmission untouched; downloads that complete
while the plugin is off are imported when it comes back through the Phase 5 recovery path.
Re-enabling never re-runs setup.

## 3. Upstream maintainability

### 3.1 A separate entry, one build, one bundle for the plugin

- `webpack.common.js` gains one entry, `'main.jellyfinmod': './jellyfinmod.jsx'`, and one more
  `HtmlWebpackPlugin` instance producing `jellyfinmod.html` from the same template with
  `chunks: ['main.jellyfinmod', 'serviceworker']`. Shared vendor chunks are emitted once; the
  stock entry's output is byte-for-byte what it is today apart from the shared chunk names the
  split-chunks plugin already assigns.
- `output.publicPath` becomes `'auto'` so chunk and `strings/` loading is relative to the
  runtime script's own URL, which is what lets the same files be served from `/web/` (archive
  shape, stock entry) and from the plugin path (swap in place). The stock entry is unaffected in
  behaviour because its scripts and document share a directory in every shape.
- The build writes `dist/jellyfinmod-web.json`: `bundleId` (12 hex characters of a hash over the
  file list and contents without source maps), `webCommit`, `upstreamMergeBase` (the upstream
  commit `master` last merged), `builtAt`, `expectsCapabilities` (Health capability names the
  bundle uses) and `supportedServer` (`min`, `maxExclusive`, from §3.5). `jellyfinmod.html`
  carries `<meta name="jellyfinmod-web" content="<bundleId>">` at build time.
- **Boot sharing.** `src/index.jsx` performs upstream's start-up sequence. Two options; the
  proposed one is the first. (1) `src/jellyfinmod.jsx` imports the same upstream modules and
  repeats the sequence, so no upstream file is edited and the merge routine diffs `index.jsx`
  against the mod entry's boot section on every upstream merge (a listed checklist item).
  (2) Factor `index.jsx` into `boot.ts` + `index.jsx` and import `boot.ts` from both entries,
  one upstream edit that conflicts on every upstream touch of the boot. S1 decides after
  measuring how much of `index.jsx` is boot versus render.
- **How the plugin consumes it.** `npm run build:production` builds both entries;
  `jellyfin-sync --test --plugin-web` (and the release pipeline) zips `dist/` without `.map`
  files into `jellyfinmod-web.zip` beside `JellyfinMod.dll` in the plugin package; the plugin
  extracts and serves it (§4.3) and renders `/web/index.html` from `jellyfinmod.html`. The
  stock `index.html` in `dist/` is used only by the archive shape and by development.

### 3.2 The patch surface, enumerated

Every edit to an upstream file is listed here; a Jellyfin release upgrade walks this table. The
target state after Stage B parity is the first four rows only.

| Upstream file | Why | What breaks if upstream changes it | Lifetime |
| --- | --- | --- | --- |
| `webpack.common.js` | second entry, second `HtmlWebpackPlugin`, `publicPath: 'auto'`, the `jellyfinmod-web.json` emit | build fails loudly; re-apply the three additions | permanent |
| `package.json` | `build:mod`-related scripts and the e2e runner reference | scripts missing; re-add | permanent |
| `src/index.jsx` | only under boot option (2) | mod entry boots differently from stock; re-factor | permanent if (2) is chosen, otherwise none |
| `src/config.json` | none planned; listed because the mod entry reads it | the mod entry fetches it by rooted URL; a schema change surfaces in `useWebConfig` | none |
| `src/apps/legacy/controllers/hometab.js` | mounts hero and top bar (W7) | Home chrome disappears in the stock entry | **still patched.** Stage B's Home covers desktop and mobile; the TV layout routes through upstream's legacy Home, which is what this mounts. It comes out with the TV shell slice, not before |
| `src/components/homesections/homesections.js` | ~~merged rows (W6)~~ **one exported keyword**: `getAllSectionsToShow` (P7.S6) | the mod Home cannot read the user's section choices and would have to copy the selection rule, which would then drift | permanent, and deliberately small |
| `src/apps/legacy/controllers/movies/movies.js`, `shows/tvshows.js` | combined browse and File filter (W2, W3, W8) | file-less entries vanish from stock grids | until Stage B browse passes, then removed |
| `src/apps/legacy/routes/search.tsx` | Add from TMDB section (W4) | leftovers section vanishes | until Stage B search passes, then removed |
| `src/apps/legacy/controllers/itemDetails/index.js` | detail augmentation (W5, T14) | History, retention, Search releases vanish on stock details | until Stage B details pass, then removed |
| `src/apps/modern/components/AppToolbar/index.tsx` | imports `homeChrome.scss` (W7/W12) | top-bar restyle gone in the stock entry | until Stage B Home passes, then removed |
| `src/components/router/routerHistory.ts` | `RouterHistory.adopt(router)`, so the shared history drives the router that is actually rendered (P7.S2 login fix) | the mod bundle navigates upstream's router instead of its own: the address bar moves and the screen does not | permanent |
| `src/utils/assetUrl.ts` | **new file**, the one helper the four rows below call | nothing; a new file never conflicts | permanent |
| `src/utils/fetchLocal.ts` | roots `config.json` at the bundle (S3) | `config.json` is fetched from beside the document instead of from the bundle | permanent |
| `src/components/ThemeCss.tsx` | roots the theme stylesheet at the bundle (S3) | the theme stylesheet 404s from the plugin path | permanent |
| `src/utils/image.ts` | roots the device images at the bundle (S3) | device icons 404 from the plugin path | permanent |
| `src/apps/legacy/routes/user/userprofile.tsx` | roots the default avatar at the bundle (S3) | the default avatar 404s from the plugin path | permanent |
| `src/plugins/syncPlay/ui/playbackPermissionManager.js` | roots the silent sound at the bundle (S3) | the SyncPlay permission probe 404s from the plugin path | permanent |
| `src/components/toolbar/AppUserMenu.tsx` | Queue item (I8) | Queue unreachable from the stock user menu | until Stage A, then removed (the mod shell has its own menu) |
| `src/apps/modern/routes/asyncRoutes/user.ts`, `routes/catalog/queue.tsx` | the `catalog/queue` route in the stock entry | queue route missing in the stock entry | until Stage A, then removed; the mod router owns `catalog/*` |

Removing a row means restoring the upstream text of that file on `jellyfin-mod`, verified by
`git diff master -- <file>` being empty. The stock entry then differs from upstream only in build
configuration, and "plugin off" is stock by construction rather than by gating.

### 3.3 Upstream modules the new interface depends on

Imported, never copied: `lib/jellyfin-apiclient` and `ServerConnections` (servers, sessions,
authentication, Quick Connect), `components/apphost`, `components/playback/playbackmanager`,
`plugins/htmlVideoPlayer`, `plugins/htmlAudioPlayer`, the `video` OSD route, `components/router/
appRouter` and `routerHistory`, `apps/legacy/routes` and `apps/modern/routes` tables,
`apps/dashboard/routes`, `apps/wizard/routes`, `components/cardbuilder` (`useCard`, `CardWrapper`,
`CardBox`), `components/layoutManager`, `scripts/inputManager`, `components/autoFocuser`,
`scripts/scrollManager`, `components/viewManager` (for embedded legacy views), `lib/globalize`,
`themes/*` and `ThemeStorageManager`, `elements/emby-*`, `hooks/useUserViews`, `hooks/useApi`,
`apps/modern/features/libraries` (filter dialog and view settings), `components/itemContextMenu`,
`components/homesections`, `utils/fetchLocal`, `serviceworker`. A new dependency is added to this
list in the same commit that introduces it.

### 3.4 The upstream merge routine

Run for every upstream merge; the result is recorded in the phase evidence with both SHAs.

1. `git fetch upstream`; on `master`, `git merge upstream/master`; production fixes stay on
   `master` as today. Build the stock entry and deploy it to production only through the existing
   production procedure, never through the mod instance.
2. On `jellyfin-mod`, `git merge master`. Conflicts are allowed only in the files of §3.2; a
   conflict anywhere else means an upstream module the mod imports changed and is handled in
   `features/jellyfinmod/`, never by editing the upstream file.
3. Under boot option (1), diff `src/index.jsx` against the mod entry's boot section and mirror
   changes; re-check the §3.3 list against upstream renames.
4. `npm ci`, `npm run build:production` (both entries), `npx tsc --noEmit`, feature eslint and
   stylelint; run the offline patch check (`scripts/jellyfinmod-e2e/patch-check.mjs`, S4) that
   renders the patched `index.html` from the stored stock fixture of the pinned host and from
   the new `jellyfinmod.html` and asserts marker, meta, failsafe, rewritten URLs and no stock
   script tags.
5. Rebuild and run the plugin suites on the test host (`run-suites.sh`, all suites exit 0).
6. Deploy to the isolated instance with `jellyfin-sync --test --plugin-web`; confirm Health shows
   the new bundle id and `takeover.state = patched`; the engine re-renders because the bundle
   id changed.
7. Run the Playwright acceptance in full (≈ 75 s) and the quick mode after any fix; TV layouts
   included; physical webOS after a UI-visible upstream change.
8. If the merge coincides with a host or image upgrade, also verify the pristine hash changed and
   was re-recorded (§4.4), update the stock fixture used by the patch check, and re-run step 4.

### 3.5 Version and compatibility matrix

**Corrected 2026-09-20 (S1 evidence, confirmed by the coordinator).** The rows below originally
described a pinned `10.11.x` line with a `supportedServer` range of `min` and `maxExclusive`.
That line is stale. The isolated instances genuinely run the `jellyfin/jellyfin` image that
reports **`Version: 12.0.0`**, and the plugin loads and works against it: `targetAbi` is a
*minimum*, `10.11.0.0`, which 12.0.0 satisfies. README §7.1 still describes the 10.11.11 pair;
that discrepancy is noted here and left for the README's own revision rather than rewritten from
this document.

Support is therefore expressed as **a minimum plus a tested-on list**, never as a guessed upper
bound. `jellyfinmod-web.json` carries `supportedServer: { minimum: "<targetAbi>", testedOn: [
"12.0.0" ] }`. A host at or above the minimum is supported; a host outside it degrades to stock
with a named blocker rather than being guessed about. An untested host above the minimum runs,
and says so, rather than being refused — refusing every version nobody has tried yet would make
each host release an outage.

| Host server | Plugin load | Bundle at `/web` | Behaviour |
| --- | --- | --- | --- |
| Below `targetAbi` (`10.11.0.0`) | Not loaded (`NotSupported`) | Stock | Nothing runs; if a patched file was left behind, the failsafe shows stock and the log names it |
| At or above the minimum, in `testedOn` (today `12.0.0`) | Loaded | JellyfinMod | Supported |
| At or above the minimum, not in `testedOn` | Loaded | JellyfinMod | Runs; Health and the Interface section report `server_version_untested` with the observed version, and the merge routine adds it to `testedOn` once a real run passes. Not a blocker: an untried version is unknown, not known-bad |
| Loaded but a real incompatibility is found | Loaded | Stock | The engine applies no takeover, restores any previous one, reports blocker `server_version_unsupported`, and keeps serving the bundle at its own path so an administrator can evaluate it. Reaching this state is reported, never worked around silently |
| Bundle newer than plugin (archive shape or a retained bundle after rollback) | Loaded | JellyfinMod | Capability gating hides surfaces the plugin lacks; the Overview shows the id mismatch |
| Plugin newer than bundle (a retained older bundle in a resident client) | Loaded | JellyfinMod (old) | Works while the API stays additive within the grace period; `expectsCapabilities` is a subset |

Moving the plugin itself to .NET 10 and a 12.x `targetAbi` is still separate work
(`plugin/CLAUDE.md`); what changed here is only how support is *expressed*, not the build target.

## 4. UI delivery

### 4.1 The requirement as behaviour

| Plugin | Web root | What `/web` serves | Who sees it |
| --- | --- | --- | --- |
| Enabled, takeover on | writable, patched | JellyfinMod interface (plugin-served bundle) | every browser and web-based TV client (`jellyfin-webos`, Tizen) |
| Enabled, takeover on | read-only | stock; JellyfinMod at `<baseUrl>/web-mod/` only; Health and settings show the blocker | as above; the mod address is opened by hand |
| Enabled, takeover off | any | stock; JellyfinMod at its own path | as above |
| Enabled, host already serves the fork (archive shape) | fork bind-mounted | the fork, unpatched (recognised by the bundle meta tag) | as above |
| Disabled or uninstalled cleanly | restored | byte-identical stock `index.html` | as above |
| Removed by hand while patched | patched file left behind | the failsafe loads the stock copy from the same directory; the address stays `/web/` | as above |
| Any | any | native iOS/Android apps, Kodi, Infuse, Findroid, Streamyfin | unaffected: they never load `/web` (README §9.2) |

### 4.2 Why File Transformation is not needed

The fork is the new interface, built and tested as a whole; there is no stock bundle to inject
scripts into at request time, so an in-process HTML transformer buys nothing that serving our own
bundle and rewriting one file on disk does not, and it would put a third-party dependency between
the user and the login page.

### 4.3 Routes compared, and the chosen staging

| Route | What it is | Cost | Risk | "Enable → new product, disable → stock"? |
| --- | --- | --- | --- | --- |
| (a) runtime capability switch in the fork | The deployed fork shows the stock look when Health is unreachable or lacks `ui`. With the separate entry this becomes two things: the stock entry sheds its mod mounts (§3.2) and the mod entry degrades to native browsing and playback with mod surfaces hidden. | Small: gates and the mount removals. | Low; it is the existing degradation contract (UX §14, W14). | Only where the fork is deployed by hand; still needs a web deploy. |
| (b) plugin-served UI | The plugin package carries the built bundle and serves it anonymously under `<baseUrl>/web-mod/<bundleId>/`. | Medium: packaging (well under 60 MB per release once maps are excluded), extraction, static serving with cache headers, bundle identity in Health. | Low–medium: the app must run from a non-`/web` document (rooted fetches, service worker). No host file touched. | Enable → available at a second address; disable → gone; not at `/web`. |
| (c) plugin patches `index.html` | The plugin rewrites the host's `/web/index.html` to load (b)'s bundle, keeps a pristine copy, re-applies after upgrades, restores on disable. | Medium–high: a small but safety-critical file engine and a writable web root. | Medium: a wrong write blanks the login page and the Dashboard needed to fix it; hence failsafe and manual recovery. | Yes, at `/web`, for browsers and web TV clients. |
| (d) distribution shapes | Image `FROM jellyfin/jellyfin` with the plugin preinstalled; or an archive plus `JELLYFIN_WEB_DIR` / a volume. | Image: build pipeline, entrypoint, writable web directory. Archive: documentation and `jellyfin-sync`. | Image: low once built; the web root is inside the container and stock again on recreate, which (c) handles. Archive: the operator owns the swap back. | Image with (b)+(c): yes, no operator steps. Archive: enable yes; disable is an operator action. |

Order, per decision 2: (a) with Stage A, then (b)+(c) as one engine with two modes, then (d)
with the image as the shipped shape. Native mobile and TV clients are unaffected by every route;
web-based TV clients follow whatever `/web` serves, which is the point of (c).

### 4.4 Takeover mechanisms

Both mechanisms start from the same pieces: the plugin serves the bundle at
`<baseUrl>/web-mod/<bundleId>/` (S3), and the engine (S4) owns `<web-root>/index.html`
with a pristine copy. They differ only in what the patched file contains.

**Mechanism 1 — swap in place (recommended).** The patched `index.html` is rendered from the
bundle's `jellyfinmod.html`: every `<script src>`, stylesheet `<link>`, icon and manifest
reference is rewritten to the absolute plugin path (`<baseUrl>/web-mod/<bundleId>/…`,
`<baseUrl>` read from the host's network configuration), a marker comment and the
`jellyfinmod-web` meta tag are present, and a small inline failsafe script comes first in
`<head>`. The document URL stays `/web/index.html`; `HashRouter` routes (`#/home`,
`#/details?id=…`) are untouched, so every link and bookmark keeps working. Two build facts make
it work: `publicPath: 'auto'` (chunks and `strings/` load relative to the runtime script's URL)
and one `modAssetRoot()` helper that roots the few document-relative fetches (`config.json`, the
manifest, the service-worker registration). Costs: the asset audit and the service-worker scope
question (S1). Benefits: one file rewritten in the web root, byte-exact restore, no address
change, and the same served bundle is what the read-only fallback serves.

*Rejected variant — copy the bundle into the web root.* It would avoid asset rooting, but the
bundle's entry files are not content-hashed (`main.jellyfin.bundle.js`, `runtime.bundle.js`,
`config.json`, `serviceworker.js`, `themes/…`) and would overwrite their stock namesakes, so a
byte-exact restore would need a manifest of hundreds of files and disk for two copies. One file is
the right blast radius.

*Spike-only variant — route takeover with `hostwebclient=false`.* If the host is told not to
serve the web client, a plugin controller could claim `/web/**` with no file writes. It fails the
requirement on its own: uninstalling the plugin then leaves nothing at `/web` until the operator
flips the setting back. S1 records whether the host routes `/web` to a plugin controller in that
mode, as evidence only.

**Mechanism 2 — redirect (fallback).** The patched `index.html` is the stock file with one
injected head script: unless `?jfmod=stock` is present, probe the bundle manifest with a short
`XMLHttpRequest` and, on success, `location.replace('<baseUrl>/web-mod/<bundleId>/' +
location.hash)`. The app then runs from its own directory, so relative fetches need no rooting and
the service-worker scope is natural. Costs: the address changes, deep links map only because both
sides use hash routes, the host's `/` → `/web/index.html` redirect gets a second hop, the probe
adds latency to every cold start, and a resident TV client that stored the mod address keeps it
after the plugin is gone. Kept as the fallback if S1's spike shows the app cannot run correctly as
a `/web/` document with rooted assets.

**Failsafe (both mechanisms).** The inline head script defines `__jfmodStock()`: fetch
`index.jellyfinmod-stock.html` from the same directory by `XMLHttpRequest`, then
`document.open(); document.write(html); document.close()`, so stock renders at the unchanged
`/web/` address with its own relative asset URLs; if that fetch fails,
`location.replace('index.jellyfinmod-stock.html' + location.search + location.hash)`; a
`sessionStorage` counter prevents a loop. Every rewritten `<script>` and stylesheet `<link>`
carries `onerror="__jfmodStock()"`, and on `DOMContentLoaded` (which deferred scripts precede)
the script checks `window.__jfmodBundle`, a global the mod entry sets in its first statement;
absent means the bundle never executed, and stock loads. This covers the plugin removed by hand,
the plugin disabled in the Dashboard (its assembly is not loaded, so nothing serves the bundle),
the bundle directory deleted, and a bundle served at a wrong path. `document.write` and
`XMLHttpRequest` are used deliberately: they work on the oldest webOS engines the fork supports.

**Manual recovery.** Documented in the plugin README and printed in the plugin log at every
patch: copy `<web-root>/index.jellyfinmod-stock.html` over `<web-root>/index.html`, or copy
`<plugin-data>/web-root/index.html.pristine`, or, in the image shape, recreate the container. No
step needs the Dashboard, because the Dashboard is inside the page that may be broken.

### 4.5 Bundle packaging, serving and identity (S3)

- Plugin package (JPRM `build.yaml` `artifacts`) gains `jellyfinmod-web.zip`: `dist/` without
  `.map` files. Source maps are published separately with the release.
- On startup the plugin extracts the zip, if `<plugin-data>/web/<bundleId>/` is absent, into a
  temporary sibling and renames it into place; it verifies the file list and sizes against the
  manifest and refuses to serve a bundle that fails (`web.bundle = "corrupt"` blocker; stock
  stays). Previous bundles are kept for `WebBundleGraceDays` (default 14, at most three bundles)
  so a resident TV client that loaded an older page keeps working after an upgrade (the reason
  `jellyfin-sync` retains old assets, `ff89608a6c`), then pruned.
- Serving: an `[AllowAnonymous]` controller at `web-mod/{bundleId}/{**path}` returns
  `PhysicalFile` with the right content type, range support and `Cache-Control: public,
  max-age=31536000, immutable`; `web-mod/` (no id) answers the current bundle's
  `jellyfinmod.html` with `Cache-Control: no-store` and rewritten asset URLs, so the read-only
  fallback and the redirect mechanism have one address. `..` and encoded separators are rejected;
  only files inside the extracted bundle are served; the secret store and database are outside.
  `serviceworker.js` is served with `Service-Worker-Allowed: <baseUrl>/web/` (S1 decides whether
  the swapped page registers it).
- Health gains `revision`, `lastMigration` (X4) and `web: { bundleId, webCommit,
  upstreamMergeBase, servedAt, supportedServer, takeover: { mode, state, webRoot: "writable" |
  "readOnly" | "unknown", stockSha256, patchedSha256, blocker } }`; `capabilities` gains `ui`,
  `ui.web` and `ui.takeover`.

### 4.6 The takeover engine (S4)

State lives in `<plugin-data>/web-root/state.json` (`webRoot`, `stockSha256`, `patchedSha256`,
`bundleId`, `patchedAt`, `hostVersion`) beside `index.html.pristine` and, when it exists,
`index.html.pristine.prev`. The web root is `IApplicationPaths.WebPath`. The engine runs at
startup after the database is ready, when `UiTakeoverEnabled` changes, and when a new bundle is
installed; never concurrently with itself; never when the host version is outside the bundle's
`supportedServer` (§3.5). Every write is temporary file + `fsync` + rename inside the web root;
nothing is truncated in place.

`UiTakeoverEnabled` **defaults to true** (decision 7), so the first startup after an install
patches on its own, with no administrator step and no wizard step. Because that is a change an
administrator did not ask for, it must never be silent: every patch and every restore writes an
`interface_patched` / `interface_restored` history row and a log line at information level
naming the bundle id, both hashes and the manual recovery, and `state.json` records
`patchedBy` (`automatic` on the default path, `setting` when an administrator changed the switch,
`bundle` on a re-render after an upgrade). Health and the Interface section surface the same
value, so "why did `/web` change?" is answerable from the Dashboard without reading the log.

| Observed `<web-root>/index.html` | Action | State |
| --- | --- | --- |
| Web root missing, not a directory, or a write probe (`.jellyfinmod-write-probe`, removed at once) fails | Nothing written | `readOnly`; blocker `web_root_read_only`; own path only |
| Carries the fork's build meta tag and no takeover marker | Nothing written | `forkServedByHost`; no blocker |
| No marker, and either no record or `sha256 == stockSha256` | Copy to `index.html.pristine` and to `index.jellyfinmod-stock.html`; render the patched file from the pristine copy | `patched` |
| No marker and `sha256 != stockSha256` | Host upgrade replaced the file: move the old pristine to `.prev`, record the new stock, re-patch from it, log both hashes and the host version | `patched` |
| Marker present, `sha256 == patchedSha256`, `bundleId` current | Nothing | `patched` |
| Marker present, `bundleId` differs | Re-render **from the pristine copy** | `patched` |
| Marker present, `sha256 != patchedSha256` | Edited or cut short: re-render from the pristine copy if it verifies against `stockSha256`; otherwise leave untouched | `patched`, or `inconsistent` with blocker `patched_file_modified` |
| Marker present, no pristine copy | Leave untouched; name `index.jellyfinmod-stock.html` as the restore source if present | `inconsistent`, blocker `pristine_missing` |
| `UiTakeoverEnabled` false or host outside `supportedServer`, marker present | Restore the pristine copy, verify `sha256 == stockSha256`, remove the stock copy | `stock` (with `server_version_unsupported` when that was the cause) |
| `UiTakeoverEnabled` false, no marker | Nothing | `stock` |

Never double-patch: the only renderer input is the pristine copy, and a marked file is never
treated as stock. Never patch blind: if the stock file cannot be read completely or the pristine
copy cannot be written and verified first, nothing else is written.

Disable and uninstall: `UiTakeoverEnabled = false` restores at once. `BasePlugin.OnUninstalling`
(S1 confirms the hook and when the host calls it) restores and removes the stock copy; if the host
removes the assembly without calling it, the failsafe covers the next page load and the manual
recovery the rest. Dashboard uninstall removes the plugin folder and its XML configuration;
`<plugin-data>` (database, secret store, extracted bundles, pristine copy) is kept unless the
operator deletes it (S1 confirms on the pinned host).

Per-user versus server-wide: the takeover is server-wide by construction. A per-user "classic
look" can exist only inside the mod entry (a display preference that routes that user to the
embedded upstream screens instead of the mod-owned ones) and is an open question; the first
slice is server-wide.

### 4.7 Upgrades, rollback, skew and caches

- **Plugin upgrade** installs a new bundle id, re-renders from the pristine copy, keeps the
  previous bundle for the grace period and reports both ids. A browser or TV client holding the
  old page keeps loading the old bundle from its immutable path and talks to the new plugin API
  through capability gating, which is why the API stays additive within a release line and why
  route or field removals wait for the grace period.
- **Plugin rollback** is the same operation with the older id.
- **Host upgrade** replaces the stock file; the engine notices the changed hash at the next
  startup and re-patches, provided the new host is inside `supportedServer`; otherwise it
  restores stock and reports the blocker (§3.5). The image pins the host version, so a host
  upgrade is a deliberate image release that runs §3.4.
- **Cache busting.** `index.html` is the only unhashed document and the host serves it; S1
  records the `Cache-Control` the pinned host emits for it, and the plan states the consequence:
  a browser that cached the stock page shows stock until that cache expires or the page reloads.
  Everything under a bundle id is immutable and the id changes with every build.
- **Resident TV clients** cache the page and its assets until the app is fully closed; the
  existing guidance stands (PHASE1 §7, `jellyfin-web/CLAUDE.md` Deployment): fully close and
  reopen `jellyfin-webos` after an upgrade; a server restart does not reload their bundle; the
  retained previous bundle keeps them working until then.
- **Skew visibility:** the settings Overview shows `bundleId`, `webCommit`,
  `upstreamMergeBase`, plugin version and revision, and warns when the running page's meta tag
  differs from Health's current id.

### 4.8 Distribution shapes (S5)

**Docker image (preferred).** `FROM jellyfin/jellyfin:<pinned host version>`; the plugin release
folder (`JellyfinMod.dll`, `meta.json`, `jellyfinmod-web.zip`) is copied into the image at
`/opt/jellyfinmod/plugin/`; an entrypoint wrapper installs or updates it into
`$JELLYFIN_CONFIG_DIR/plugins/JellyfinMod_<version>/` when missing or older (never downgrading,
never touching other plugins), then `exec`s the stock entrypoint. The image's web directory
(beside the server executable; S1 records the exact path and owner) stays inside the container
filesystem, so it is writable for the runtime user once the Dockerfile grants it, it is stock
again on every container recreate, and the engine re-patches at startup. No web bind mount exists
in this shape. `JELLYFINMOD_UI_TAKEOVER=true|false` is read at first start only, when the plugin
configuration does not exist yet; since the takeover is now on by default everywhere (decision 7)
its only remaining use is `false`, for an operator who wants the image's plugin without the
interface. Rollback is `docker compose` to the previous image tag.

**Release archive (secondary).** `jellyfinmod-<version>.zip` containing `plugin/` and `web/`
(the same `dist/`). Operators install `plugin/` into a stock server (the engine works as in the
image if the web directory is writable), or also point `JELLYFIN_WEB_DIR` / a volume at `web/`,
in which case the engine detects the meta tag and stays out (`forkServedByHost`) and "disable →
stock" is their swap back; in that shape `web/index.html` is the fork's stock entry and
`web/jellyfinmod.html` the mod entry, and the operator chooses which the host's default file is.

**Isolated test instance.** **Accepted 2026-09-20 (decision 8):** the bind mount of `dist/` over
the web directory **stays** and becomes read-write; it is not removed. That keeps
`jellyfin-sync --local --test` working unchanged, and the takeover target on the isolated
instance is the bind-mounted directory. Recorded without paths. `jellyfin-sync --test` gains
`--plugin-web` and keeps `--local --test`; X3's production refusals apply unchanged.

This is **not** the image's shape. The image has no web bind mount: its target is the container's
own stock web directory, which is writable only if the Dockerfile made it so and which returns to
stock on every recreate. The two differ in ownership, in what "stock" is, and in what a recreate
does, so S5 and S11 verify the image path separately (decision 8) and an isolated-instance pass
never stands in for it.

**Consequence of keeping the mount — "stock" differs between the two shapes, and S4 must say so.**
With the mount kept, the isolated instance's web root holds *the fork's own* `dist/`, so the file
the engine takes as pristine is the fork's stock-entry `index.html`, not the host image's. On the
isolated instance, therefore, "restore to stock" means "restore the fork's stock entry", which
renders the upstream app and passes the runner's stock checks, but is not byte-identical to the
file the host image ships. Only the image shape proves the byte-identical-to-the-host claim.
S4 records which file its hashes are of; S5 and S11 carry the host-stock claim.

Note also that this does **not** make the isolated instance the `forkServedByHost` case of §4.6.
That row keys off `<web-root>/index.html` carrying the bundle meta tag, and per §3.1 the tag is
written to `jellyfinmod.html` only — the stock entry's `index.html` is byte-for-byte what upstream
produces and carries no tag. So a bind-mounted `dist/` is patched like any other web root.
`forkServedByHost` therefore only triggers if a future build also stamps the stock entry, which
S2 must not do; S1 flags the inconsistency between §3.1 and the §4.6 row for the plan to settle.

## 5. Unified settings area

Administrator-only, inside the JellyfinMod interface, reachable from the mod user menu beside
Queue and from a link on the Dashboard plugin page. **Proposed route:** `/catalog/settings`,
owned by the mod router (a second mod route beside `/catalog/queue`; UX §2.1's "only new route"
counted the stock entry, and the mod entry has its own table). The Dashboard `configPage.html`
stays until parity (S8), then shrinks to readiness, the Interface section and a link; it is a
plugin-owned page. Three design directions for that page, with static mockups and a recommendation
on what carries over to S8, are in
[`design/config-page/README.md`](design/config-page/README.md) (2026-09-21, proposal only).

| Section | Contents | Backing (existing → new) |
| --- | --- | --- |
| Overview | Readiness per area with blockers, plugin version and revision, bundle id and takeover state, upstream merge base, last runs, setup progress | new `GET /Settings/Overview` |
| Discovery | TMDB Read Access Token (write-only, `configured` indicator, Replace / Clear), **Test** | XML today → `GET/PATCH /Settings/Discovery`, `POST /Settings/Discovery/Test`; storage moves to the SQLite settings row with a one-time XML import |
| Download client | Transmission URL, username, password (write-only), label, client and local directories, Test, ordered path mappings with verification, **Test import path**; seed protection becomes "use the acquisition client" (default) or a separate endpoint | existing client resources, `PathMappings`, `TestImportPath`; XML seed-protection fields → `SeedProtectionSource` with `GET/PATCH /Settings/SeedProtection` and Test |
| Indexers | Manual Torznab indexers and the Prowlarr source (§6) with a synced list, capabilities, breaker state and budgets | existing `Indexers` + `Prowlarr` resources |
| Quality profiles | Existing editor; default selection | existing |
| Acquisition | Enable (refused with blockers until ready), default profile, hold seconds | existing |
| Import and seeding | Existing switches and values | existing `Settings/Import` |
| Retention | Enabled, days, mode with the Selected user picker (T13), favourites exemption, preview, latest run | XML today → `GET/PATCH /Settings/Retention` (storage stays XML in the first slice) |
| Automation | Existing settings, status, budgets, breakers, Run now, decisions | existing |
| Interface | Takeover on/off (on by default, decision 7), when it last applied and whether the plugin or an administrator did it, web root state, bundle ids, supported server range, "Restore stock now", manual recovery text | new `GET/PATCH /Settings/Interface`, `POST /Settings/Interface/RestoreStock` |
| Diagnostics | Reconciliation latest, orphans, conflicts | existing |
| Jellyfin preferences and Dashboard | Links into the embedded upstream user preferences and Dashboard (§2.2) | upstream |

Rules: secrets are write-only everywhere and the page never receives a value; every save echoes
the revision and shows the 409 message on conflict; every Test reports a code and a sentence,
never a raw exception or a URL with credentials; styles are `em`-sized, feature-local
`jfmod-settings*`, stock `emby-*` inputs, no `display: contents`, no flex `gap`. On TV the page is
single-column and D-pad reachable; it is an administrator surface "never used on a TV" (UX §12),
so TV acceptance is reachability, readability and Back, while data entry is desktop and mobile.

### 5.1 The Dashboard page is already Option B — what S8 takes verbatim

The user chose **Option B (Checklist)** on 2026-09-21 and
`plugin/JellyfinMod/Configuration/configPage.html` was rebuilt as it: a persistent readiness rail
in pipeline order is the navigation, one section shows at a time, and indexers and quality profiles
are edited in a sheet. It is one file — markup, one `jfmod-settings` stylesheet and the vanilla
wiring the page already had — and it covers the ten sections above **plus** the Interface section
and the retention preview and latest run, none of which the page had any UI for before.

This is the reason Option B was chosen, so S8 reimplements the section *bodies* in React against
the same DTOs and takes the rest as it stands:

| Piece | Where in the file | Note |
| --- | --- | --- |
| The `jfmod-settings` stylesheet | `<style id="jfmod-settings-style">` | Two blocks: the shared `jfmod-` vocabulary (state pill, chip, notice, secret, list row, ordered row, group, key/value list) and the Option B layer (rail, section, sheet). Move it to a `.scss` the fork imports and change nothing but the delivery. Every size is `em`; there is no flex/grid `gap` and no `display: contents` (UX §13 W11); the amber attention state is the theme's star token and every dot repeats itself in words, so nothing is said by colour alone. |
| `BLOCKER_SENTENCES` and `BLOCKER_SECTIONS` | the script's copy block | The six `Settings/Acquisition` blockers as one sentence each, plus which section owns the fix. The rail head, the Grabbing refusal and S10's step 5 all read this one map; a blocker must never be shown as a bare code again. |
| `PAUSE_SENTENCES`, `PATH_SENTENCES` | the same block | Automation `pausedReasons`, and the path-mapping and import-probe codes, as sentences. |
| `CONFLICT_MESSAGE` and `fail()` | the script | Every 409 renders as an inline notice **in the section that refused**, carrying the server's own title plus a Reload that re-reads and clears it. |
| The secret component | `renderSecret`, `secretChange`, `secretXmlValue` | `Configured` with Replace and Clear; Clear becomes a pending *Will be removed on save* with Undo; and the two write shapes the API actually wants — `{action, value}` for the typed endpoints, `''` / `__clear__` for the XML plugin configuration. The page never receives, holds or logs a value. |
| The section markup | each `<section class="jfmod-check-section">` | Eyebrow, `h2` with `tabindex="-1"` so navigation can put focus on it, state pill, header-action slot, notice slot, `jfmod-group`s with quiet subheadings, footer with Save, the revision line and **Next: … →**. |
| The sheet | `openSheet` / `closeSheet` | About sixty lines, owned rather than riding `dialogHelper`: first focus inside, Tab trapped, Escape and Back close it and return focus to the row's Edit button. It sits in the fork's own dialog z-index band (999998/999999) so it covers the app bar instead of sliding under it. |
| The rail and `summarise()` | `SECTIONS`, `summarise`, `renderRail` | One case per area turning the DTOs into a state kind and one line of text. When `GET /Settings/Overview` lands it should return exactly these, and `summarise()` becomes the client-side fallback rather than the source. |

What the mockup asked for and the page could not honour, so S8 knows what is still open:

- **No TMDB Test and no *Test all* indexers.** Neither endpoint exists; both are S7 work.
- **No "· since <date>" on a secret.** The DTOs carry `apiKeyConfigured` / `passwordConfigured` /
  `*Ref` and never when the secret was stored. The component omits the date; add `secretSetAt` in
  S7 if it is wanted back.
- **No `#section=` deep link.** The Dashboard owns the hash (`#/configurationpage?name=JellyfinMod`),
  so the page keeps the chosen section in `sessionStorage` instead. S8 owns its own route and can
  put the section in the URL as the mockup does.
- **Units live in labels, not overlaid on the field.** The mockup's `jfmod-unit` overlays a stock
  `emby-input` whose padding the page does not own.
- **"Make default" is a `PATCH /Settings/Acquisition`,** not a per-profile endpoint.
- **One implementation trap worth carrying forward:** `emby-input`'s legacy `createdCallback`
  returns early when the element already carries the `emby-input` class, which leaves it without
  its label element and makes `attachedCallback` throw. Build stock inputs without that class and
  let the element add it on upgrade.

Where Jellyfin's own TMDb settings are separate: the host's TMDb metadata provider
(Dashboard → Plugins → TMDb) has its own key handling, language and "include adult" options and
is what scans and refreshes use. JellyfinMod's discovery token is a different credential for a
different purpose, so titles, posters and languages can disagree between a discovery result and
the item Jellyfin later creates. The Discovery section says so and links to the host page; Phase 7
does not share the key.

## 6. Native Prowlarr support

One Prowlarr base URL and API key; the plugin imports and keeps in step Prowlarr's torrent
indexers as ordinary JellyfinMod indexers, each pointed at Prowlarr's per-indexer Torznab feed.
Prowlarr's API (consulted through Context7 on 2026-09-20: `GET /api/v1/indexer`,
`GET /api/v1/indexer/{id}/status`, `GET /api/v1/system/status`, `GET /api/v1/health`,
`X-Api-Key` header or `apikey` query, the per-indexer Newznab/Torznab endpoint) is the contract;
observed behaviour of the disposable Prowlarr in S1 wins over documentation.

| Aspect | Proposed first slice |
| --- | --- |
| Record | `ProwlarrSource`: `Id`, `Name`, `BaseUrl`, `ApiKeySecretRef`, `Enabled`, `SyncIntervalMinutes` (360), `LastSyncAt`, `LastSyncOutcome`, `LastError`, `ConsecutiveEmptySyncs`, `Revision`. One source in the first slice. `AcquisitionIndexer` gains `ManagedBy` (`manual` / `prowlarr`), `ProwlarrSourceId?`, `ProwlarrIndexerId?`, `ProwlarrRemovedAt?`, `AdminOverridesJson`. |
| Secret | Stored once in the `0600` store; synced indexers hold no key; the Torznab client resolves it through the source, so rotating it once rotates every feed; it is sent as the Torznab `apikey` parameter only to the source's own host. |
| Sync | `GET /api/v1/indexer`; keep `protocol == "torrent"` and `enable == true`; per indexer: name (suffixed with the source name on collision), `BaseUrl = <prowlarr>/<prowlarrIndexerId>/api`, categories = the movie and TV trees intersected with advertised `capabilities.categories`, priority from Prowlarr's `priority`, `DownloadHosts` = the Prowlarr host plus the hosts of `indexerUrls` when `supportsRedirect` (the Phase 4 no-redirect client host-checks every hop). Then the existing `t=caps` verification per synced indexer; a failure leaves it disabled with `LastError`. |
| Removal and disable | Missing from Prowlarr → disabled with `prowlarr_removed`, kept 30 days (grabs keep the source name), then deleted. Disabled in Prowlarr → disabled locally. `status.disabledTill` → the Phase 6 breaker opens until then. Re-appearing → re-enabled unless the administrator disabled it locally. |
| Overrides | Per synced indexer the administrator may change only enabled, minimum interval, daily budget and seed minimums; a sync never overwrites those. |
| Rate limits | Phase 6 per-indexer interval, budget and breaker apply unchanged; Prowlarr's own limits and 429 trip the same breaker; sync is one request per run plus one `t=caps` per changed indexer. |
| Fail-closed | A sync error changes nothing. An HTTP 200 with zero torrent indexers disables synced indexers only after two consecutive empty syncs at least one hour apart. A body missing `id`, `name`, `protocol` or `enable` aborts with `prowlarr_schema`. `http`/`https` only, no userinfo or query in the base URL; TLS errors are errors. A sync never enables what the administrator disabled. |
| Test | `POST /Settings/Prowlarr/Test`: `system/status`, `health`, count of enabled torrent indexers; codes `unauthorized`, `unreachable`, `timeout`, `prowlarr_schema`, `no_torrent_indexers`. |
| Scheduling | `IScheduledTask` `JellyfinModProwlarrSync`, default every 6 hours. |
| Capability | `acquisition.prowlarr`. |

Prowlarr's "applications" push is not used; JellyfinMod is not one of those applications and a
pull model keeps the API key on our side only.

## 7. First-run wizard

Administrator-only; ordered; each step blocked until its connection test passed for the current
revision; resumable because its state is derived from the readiness checks the product already
enforces, not from stored progress.

| Step | Passes when | Refuses |
| --- | --- | --- |
| 1 Discovery | TMDB token configured and `Discovery/Test` succeeded for the current revision | Continuing without a passing test |
| 2 Download client | Client saved, `Test` verified, destination checks passed, at least one path mapping verified, `TestImportPath` returned `linked` for the target library root | A download directory inside any library root (`destination_inside_library`), on another filesystem (`destination_not_same_filesystem`, `cross_filesystem`), an unverified mapping |
| 3 Indexers | At least one enabled indexer with verified capabilities, typed by hand or synced | Continuing with none verified |
| 4 Quality profile | At least one profile and a default selected | An empty profile, a cutoff outside the allowed qualities |
| 5 Enable | `PATCH /Settings/Acquisition` with `enabled: true` succeeded | The existing 409 `acquisition_not_ready` with blockers, shown verbatim |
| 6 Optional | Retention mode and days, automation (off by default), the interface takeover | Enabling automation while acquisition is disabled |

Server side: `GET /Setup/State` returns steps with `status` (`done` / `pending` / `blocked`),
reasons, `completedAt` / `dismissedAt`; `POST /Setup/Dismiss`. Web side: an administrator whose
state is neither complete nor dismissed sees a banner on the mod Home linking to
`/catalog/settings/setup`; the app never redirects by itself. The wizard reuses the settings
sections' forms and Tests. On TV it is reachable and navigable by D-pad with Back; data entry is
verified on desktop and mobile.

## 7.1 Trakt — verify and keep compatible

Requested by the user on 2026-09-20: *"if the Trakt plugin is installed, use it to report watched
state and current-view tracking."* **Plan only; nothing here is implemented yet.**

The honest answer is smaller than the request implies, so it is worth stating before the detail.

### 7.1.1 What the stock Trakt plugin already does

Established from `jellyfin/jellyfin-plugin-trakt` on 2026-09-20, not from memory:

- Its `ServerMediator` subscribes to the **server's own** events: `ISessionManager`'s
  `PlaybackStart`, `PlaybackProgress` and `PlaybackStopped`, `IUserDataManager`'s `UserDataSaved`,
  and the library's `ItemAdded` / `ItemUpdated` / `ItemRemoved`.
- It scrobbles a watch when `PlaybackStopped` reports `PlayedToCompletion`; short of that it sends
  a paused state at the current percentage. It acts only for users who have Trakt credentials and
  have scrobbling enabled, and only for movies and episodes.
- `SyncFromTraktTask` runs the other way: it writes watched state, play counts, last-played times
  and playback positions **from** Trakt **into** Jellyfin user data through
  `IUserDataManager.SaveUserData`. Items that are not in the local library are skipped.

**Therefore the JellyfinMod interface has nothing to report to Trakt, and must not try.** Trakt
never sees a browser. It sees Jellyfin's server-side events, which are raised because a client
used Jellyfin's ordinary playback session and user-data APIs. The mod interface already does
that, because it embeds upstream's `playbackManager` and the upstream `video` route unchanged
(§3.3) rather than reimplementing playback.

So Phase 7.1 is scoped to **verify and keep compatible**. Any task here that starts with "send"
or "report to Trakt" is the wrong task: a second scrobbler would double every play.

### 7.1.2 What the new interface must keep doing

Each of these is upstream behaviour the mod interface inherits; the work is proving it still
holds once the mod entry, shell and Stage B pages are in front of it, not building it.

| Behaviour | Why Trakt depends on it | Where it comes from |
| --- | --- | --- |
| Playback session reporting (`POST /Sessions/Playing`) | Raises `PlaybackStart`; without it a play never begins on Trakt | upstream `playbackManager` |
| Progress ticks (`POST /Sessions/Playing/Progress`) | Drives the paused/progress state and the resume point | upstream `playbackManager` |
| Stop reporting (`POST /Sessions/Playing/Stopped`) with an accurate position | `PlayedToCompletion` is what turns a play into a scrobble | upstream `playbackManager` |
| Mark played / unplayed | Raises `UserDataSaved`, which the mediator also listens to | upstream item context menu and detail actions |
| Resume points | Written as user data; read back by `SyncFromTraktTask` | upstream |

The risk is not that these are missing today — the S1 spike played a movie and an episode through
the mod router — but that a Stage B page reimplements a detail action with its own API call and
quietly drops one. The acceptance below is written against that risk.

### 7.1.3 Detecting the plugin, and what to show

- **Detection is server-side.** `GET /Plugins` requires elevation, so an ordinary user's browser
  cannot ask whether Trakt is installed. If any surface needs to know, the JellyfinMod plugin
  reports it: a `trakt` block in Health carrying `installed`, `version` and `configuredForUser`,
  derived from the host's own plugin list. The plugin's id must be read off an installed copy
  rather than hard-coded from documentation, which does not publish it.
- **Proposed surfaces: none in the first slice.** Trakt state is not JellyfinMod state, and the
  detail page already shows Jellyfin's watched state, which is what Trakt reads and writes. A
  Trakt badge would be a second source of truth for the same fact. The proposed first slice shows
  nothing and only guarantees that scrobbling keeps working.
- **Absent or unconfigured plugin: nothing happens, visibly.** No error, no console noise, no
  banner, and above all no effect on playback. The interface never waits on a Trakt answer before
  starting a video. This is the same degradation contract as UX §14.

### 7.1.4 Retention, which is where the two actually meet

Watched state lives in Jellyfin's user data, attached to the `BaseItem`. Retention deletes the
media file and the item, so that user data goes with it — but the Trakt history was written when
the title was watched and is unaffected. Nothing is lost on Trakt's side and nothing is
duplicated, because retention never replays anything.

Two consequences worth stating plainly:

- `SyncFromTraktTask` skips items that are not in the library, so a reclaimed title is simply not
  considered. It does not error and does not resurrect anything. The JellyfinMod entry stays as
  the placeholder it already is.
- If the title is re-acquired later, the same task will mark it watched again from Trakt. That is
  correct, and it is also the more interesting interaction: **Trakt can now be the thing that
  tells Jellyfin a title was watched**, including watched somewhere else entirely. JellyfinMod's
  retention reads Jellyfin's user data, so a watch that arrived from Trakt would start a retention
  window exactly as a local watch does. That is arguably right, and it is certainly a behaviour an
  administrator should be told about rather than discover. It is open question 14 below.

### 7.1.5 Acceptance

Real browser against the acceptance instance with the Trakt plugin installed and authorised for
the test user, plus one run with it uninstalled. No fixture left behind.

- A movie played to the end in the mod interface produces a Trakt scrobble; the same movie played
  to roughly half and stopped produces a paused state and no scrobble. Verified by Trakt's own
  history for the test account, not by reading Jellyfin's logs.
- An episode does the same.
- Mark played and mark unplayed from the mod detail page each move Trakt's watched state.
- A resume point set in the mod interface survives a reload and is the one Jellyfin reports.
- The network log for a full play shows exactly one `Sessions/Playing`, progress ticks, and one
  `Sessions/Playing/Stopped` — no duplicate session reporting from any mod surface.
- With the Trakt plugin uninstalled: every one of the above still plays, marks and resumes
  correctly, with no error toast, no uncaught exception and no failed request.
- Retention: a watched title reclaimed by retention leaves its Trakt history intact, its
  JellyfinMod entry present as a placeholder, and `SyncFromTraktTask` completing without error.
- Desktop, mobile and both TV layouts, since playback reporting is the same code in each.

### 7.1.6 Open questions this section adds

14. **Trakt-sourced watches and retention.** Should a watch that arrived *from* Trakt — watched on
    another device, imported by `SyncFromTraktTask` — start a JellyfinMod retention window like a
    local watch (proposed: yes, because the user has watched it), or should retention count only
    watches observed on this server? Consumed by 7.1 and PHASE3's observation rules.
15. **Reclaimed titles on Trakt.** Should reclaiming a file be reported to Trakt at all — for
    example removed from a collection list (proposed: **no**; Trakt tracks what you watched, not
    what you store, and JellyfinMod deliberately keeps the entry as the durable record)?
16. **Trakt state on screen.** Show nothing (proposed), or show a small indicator on the detail
    page when the plugin is installed and the title has Trakt history?

## Entry gates and dependencies

**Proposed, not user-approved.** Phase 7 work starts only after the current product passes live
acceptance:

1. The T18 real-window retention run has completed on the isolated instance and its checkpoint
   is recorded in PHASE3.
2. Phase 4 A8 is accepted on the isolated instance with the disposable Transmission.
3. The Phase 5 (I3–I9) and Phase 6 (M2–M9) live checklists are recorded as passed, including
   the browser matrices, with the Dashboard forms browser-verified.
4. The Phase 3 blockers T7–T10 remain green on the revision Phase 7 builds on; X1 (merged master
   SHA recorded) and X3 are in place; X4's Health fields land in S3 if still open.
5. The isolated compose change (§4.8) is applied and recorded without paths: the web bind mount
   becomes read-write and stays (decision 8). The coordinator makes this change; no agent edits
   the isolated compose.
6. A disposable Prowlarr on the test host, or the decision to use only the boundary server, is
   recorded (open question 9).
7. The runner's fixture cleanup covers every fixture type this phase creates before any Phase 7
   run touches the isolated catalog (decision 6).

## Data model and ownership

Use the existing SQLite database with new migrations; plugin configuration stays XML-serializable.

| Record | Minimum contents and invariants |
| --- | --- |
| `AcquisitionSettings` (existing row) | Gains `TmdbReadAccessTokenRef`, `DiscoveryRevision`, `DiscoveryVerifiedRevision`, `SeedProtectionSource` (`acquisitionClient` / `separate`), `SeedProtectionRpcUrl?`, `SeedProtectionUsername?`, `SeedProtectionPasswordRef?`, `SeedProtectionRevision`, `UiTakeoverEnabled` (**default true**, decision 7),
`WebBundleGraceDays` (14), `InterfaceRevision`, `SetupCompletedAt?`, `SetupDismissedAt?`. A one-time migration step imports the XML values and existing secret references and leaves the XML fields empty. |
| `ProwlarrSource` | As in §6; unique name; deleting it deletes its synced indexers unless a grab is active on one (409, like clients). |
| `AcquisitionIndexer` (existing) | Gains `ManagedBy`, `ProwlarrSourceId?`, `ProwlarrIndexerId?`, `ProwlarrRemovedAt?`, `AdminOverridesJson`. |
| Takeover state | Not in SQLite: `<plugin-data>/web-root/state.json` and the pristine copies, so a lost database never loses the restore source. |
| Web bundles | `<plugin-data>/web/<bundleId>/` plus `current` and `retained.json`. |
| History | `settings_changed` (admin, area, revision; no values), `prowlarr_synced` (counts), `interface_patched`, `interface_restored` (hashes). |

Ownership: the engine owns two files in the web root and everything under `<plugin-data>/web*`.
Settings endpoints own their rows; the Dashboard page becomes a client of the same endpoints.
Prowlarr sync owns only indexers with `ManagedBy = prowlarr`. The mod entry owns
`features/jellyfinmod/**` and `src/jellyfinmod.jsx`; no other web file.

## API contract

All routes under `/JellyfinMod`, camelCase, UTC ISO 8601; everything here except `Web/**` and
`Health` requires `Policies.RequiresElevation`. S1 publishes the DTOs in API.md with one example
each.

| Endpoint | Contract |
| --- | --- |
| `GET /web-mod/` and `GET /web-mod/{bundleId}/{**path}` (anonymous, outside `/JellyfinMod`) | Static serving per §4.5; 404 for unknown ids and paths; no directory listing. |
| `GET /Health` | Adds `revision`, `lastMigration`, `web` (§4.5); `capabilities` adds `ui`, `ui.web`, `ui.takeover`, `acquisition.prowlarr`, `settings.overview`, `setup`. |
| `GET /Settings/Overview` | `{ plugin: { version, revision }, web: <Health.web>, areas: [{ id, ready, blockers[], revision, lastRun? }], setup: <summary> }`. |
| `GET/PATCH /Settings/Discovery`, `POST /Settings/Discovery/Test` | `{ tokenConfigured, revision }`; PATCH takes `{ token: <SecretChangeRequest>, revision }`; Test answers `ConnectionTestDto`. |
| `GET/PATCH /Settings/SeedProtection`, `POST /Settings/SeedProtection/Test` | `{ source, rpcUrl?, username?, passwordConfigured, matchesAcquisitionClient, revision }`. |
| `GET/PATCH /Settings/Retention` | The XML-backed fields with the Dashboard's validation; Selected user without a valid user is refused (T13). |
| `GET/PATCH /Settings/Interface`, `POST /Settings/Interface/RestoreStock` | `{ takeoverEnabled, state, webRoot, bundleId, retainedBundleIds[], supportedServer, hostVersion, stockSha256, patchedSha256, patchedAt, patchedBy (`automatic` / `setting` / `bundle`), blocker, recovery, revision }`; `patchedBy` and `patchedAt` are how an administrator sees that the takeover applied itself (decision 7). RestoreStock performs the restore row of §4.6 without changing the switch. |
| `GET/POST/PATCH/DELETE /Settings/Prowlarr`, `POST /Settings/Prowlarr/Test`, `POST /Settings/Prowlarr/Sync` | Source DTO with `apiKeyConfigured`; sync outcome `{ seen, created, updated, disabled, removed, verified, failed[] }` (202 scheduled, 200 synchronous test). |
| `GET /Settings/Indexers` (existing) | Rows gain `managedBy`, `prowlarrSourceId`, `prowlarrIndexerId`, `prowlarrRemovedAt`, `breakerOpenUntil`. |
| `GET /Setup/State`, `POST /Setup/Dismiss` | `{ complete, dismissedAt, steps: [{ id, status, reasons[] }] }`. |

## Tasks and acceptance

| ID | Task and owner | Depends on | Required evidence |
| --- | --- | --- | --- |
| S1 | Decisions, spikes and contract | Gates 1–7 | Host static-serving facts, image web-directory writability, uninstall hook, boot-sharing choice, asset audit, swap spike, Prowlarr observed behaviour, DTOs |
| S2 | Mod bundle entry and shell (Stage A); option (a) | S1 | Built browser: every stock screen reachable through the shell; plugin off → stock; stock entry unchanged |
| S3 | Plugin-served bundle (option b) | S1, S2 | Package with bundle, extraction, immutable serving, Health `web`, app runs at its own path in all layouts |
| S4 | `index.html` takeover engine (option c) | S3 | Every row of the state table on the isolated instance; failsafe; byte-identical restore; read-only; server-range refusal; patch-check tool |
| S5 | Distribution, merge routine and compatibility | S3, S4 | Image from the pinned host: install, recreate, rollback; archive detected; `--plugin-web`; one documented upstream merge executed end to end |
| S6 | Mod-owned home, browse, detail and search (Stage B); mount removals | S2 | Phase 1–6 browser acceptances re-passed on the mod pages; upstream files restored per §3.2 |
| S7 | Settings contract consolidation; plugin | S1 | Typed endpoints, XML import migration, seed-protection unification, real HTTP as admin / user / anonymous |
| S8 | Unified settings area (Stage C); web | S7, S2 | Built browser, every section saves and re-reads across a restart, secrets never returned, desktop / mobile / TV |
| S9 | Native Prowlarr support; plugin and web | S7, S8 | Prowlarr boundary (and disposable Prowlarr if approved): sync, removal, disable, breaker, fail-closed, one secret |
| S10 | First-run wizard; plugin and web | S7–S9 | Fresh isolated database to acquisition enabled through the wizard alone; every refusal shown |
| S11 | Isolated end-to-end acceptance and release gate | S1–S10 | Full chain, runner extended, upgrade / rollback / recreate / upstream merge, hygiene assertion, production never contacted |

Commit scopes: `docs(setup,p7.s1)`, `feat(shell,p7.s2)`, `feat(ui-delivery,p7.s3)`,
`feat(ui-delivery,p7.s4)`, `build(dist,p7.s5)`, `feat(shell,p7.s6)`, `feat(settings,p7.s7)`,
`feat(settings,p7.s8)`, `feat(prowlarr,p7.s9)`, `feat(setup,p7.s10)`, `test(setup,p7.s11)`;
fixes use `fix(<component>,p7.sN)`.

### S1 — settle the host and fork facts before touching either

Record, with evidence from the pinned host, the fork and the isolated instance, no published paths:

- **Static serving.** How the pinned server serves `IApplicationPaths.WebPath` under `/web`
  (default file, `Cache-Control` for `index.html`, `BaseUrl` prefixing), what `/` redirects to,
  and whether an `[AllowAnonymous]` plugin controller can serve files with custom headers and
  range requests.
- **Web directory in the image.** Exact path and ownership for the pinned version, and whether
  the isolated container's runtime user can write to it once the read-only bind mount is
  removed; if not, the `chown` the Dockerfile needs.
- **Uninstall hook.** Whether `BasePlugin.OnUninstalling` is called on Dashboard uninstall, when,
  and what the host deletes and keeps.
- **Boot sharing.** How much of `src/index.jsx` is start-up versus render; choose option (1) or
  (2) of §3.1 and record the diff routine.
- **Asset audit.** Every document-relative fetch in the fork and whether `publicPath: 'auto'`
  moves chunk and `strings/` loading to the runtime script's URL; the service-worker policy for
  swapped pages.
- **Swap spike.** Serve the current bundle from a temporary anonymous path on the isolated
  instance and load a hand-rendered swapped `index.html` from a scratch copy of the web directory
  (never the live one): sign in, browse, play, TV layout. Go/no-go between mechanisms 1 and 2.
- **Route takeover** with `hostwebclient=false` on a scratch container: evidence only.
- **Embedding spike.** A throwaway `ModAppRouter` that lists a mod `home` first and imports the
  upstream route tables: confirm route shadowing, that the Dashboard, video player, login and a
  legacy library view render under a different root layout, and how the legacy `.skinHeader` is
  hidden. This is the go/no-go for §2.1.
- **Package size.** `dist/` without maps zipped, extraction time on the Pi, disk for three
  bundles.
- **Prowlarr.** Against the disposable Prowlarr or its boundary: the fields of `GET /api/v1/
  indexer`, the per-indexer Torznab URL form, `t=caps` through it with `apikey`, and whether
  `.torrent` downloads redirect or proxy.
- **Contract.** Publish the DTOs, capability names and `jellyfinmod-web.json` fields in API.md.

**Acceptance** — a dated *S1 evidence* heading records each answer with the command or API used,
redacted, names the mechanism S4 builds and the boot option S2 uses, and confirms the screen
inventory of §2.2 against the fork's actual route tables.

#### S1 evidence — 2026-09-20, part 1: the fork

Recorded against web `jellyfin-mod` at `dcc8d33403` and plugin `master` at `7299b07`. Everything
here is answered from the fork's own sources and a local production build; no server was
contacted and nothing was deployed. The host-side items (static serving, the image's web
directory, the uninstall hook, the swap spike, route takeover, Prowlarr, extraction time) are
**still open** — they need the isolated instance, which is running the T18 retention acceptance.
They are listed again at the end of this heading.

**Route tables and shadowing (§2.1 mechanism, confirmed with one correction).**
`src/RootAppRouter.tsx` builds `createHashRouter` from one element whose children are
`layoutManager.modern ? MODERN_APP_ROUTES : LEGACY_APP_ROUTES`, then `DASHBOARD_APP_ROUTES`,
`WIZARD_APP_ROUTES`, then a `!/*` `BangRedirect`. Both app tables are a **single** `RouteObject`
with `path: '/*'` — modern uses `lazy: () => import('../AppLayout')`, legacy uses
`Component: AppLayout` (`src/apps/legacy/AppLayout`, a different file) — whose children are an
index redirect to `/home`, a `ConnectionRequired` group of user routes and a public group ending
in a `*` `FallbackRoute`. Correction to §2.1: **listing the mod routes first is not what makes
them shadow upstream.** React Router ranks matches by path specificity, not array order, so a
top-level static `home` outranks the imported `'/*'` regardless of position. Two consequences
S2 must handle, neither of them blocking:

- A mod route declared as a sibling of the imported table renders **outside** `AppLayout`, which
  is what the mod shell wants — but it also renders outside the table's `ConnectionRequired`
  wrapper and its `ErrorBoundary`. The mod shell must wrap its own routes in
  `ConnectionRequired` (`src/components/ConnectionRequired.tsx`, access levels
  `admin` / `public` / `user` / `wizard`) and an `ErrorBoundary` itself.
- The imported tables' own `*` fallback lives inside `'/*'`, so it still catches unknown paths.
  Ordering the mod routes first is kept anyway, as documentation of intent.

**How the legacy `.skinHeader` is hidden (§2.1's open mechanism, answered).** No new mechanism is
needed. `src/components/AppHeader.tsx` already renders the legacy `.mainDrawer`, `.skinHeader`
and `.mainDrawerHandle` stubs and hides them with `display: none` when `isHidden` is set;
`RootAppRouter` passes `layoutManager.modern || isNewLayoutPath`. Its own comment records why the
elements must stay in the DOM: legacy views address them directly and the app crashes without
them. The mod shell renders `<AppHeader isHidden />` unconditionally and gets the same behaviour
in every layout, including the legacy views it embeds.

**Boot sharing (§3.1 — decision: option (1), with a mechanical guard).** `src/index.jsx` is 220
lines. Only 14 are render — `import RootApp` and `renderApp()`, which clears `#reactRoot`, shows
`loading` and mounts `<RootApp />`. The other ~206 are start-up: polyfills and auto-running
imports, site styles, `appHost.init()`, last-server resolution and `initApiClient`,
`initializeAutoCast`, `loadCoreDictionary` plus the two `localusersigned*` culture handlers,
`loadFonts`, `loadPlugins`, the `requestfail` handlers, `initializeServerConnections`,
`loadPlatformFeatures` and `registerServiceWorker`, then `keyboardNavigation.enable()` and
`autoFocuser.enable()`. So the split is roughly 94% boot / 6% render.

That ratio argues for option (2) on paper, but option (2) means deleting ~200 lines from an
upstream file that upstream edits regularly, which conflicts on every touch and is the largest
single item the merge routine would carry. The user's standing constraint is the opposite: keep
unavoidable edits to upstream files minimal and enumerated. **S2 therefore takes option (1)** —
`src/jellyfinmod.jsx` repeats the sequence, `src/index.jsx` is not edited, and the §3.2 row for
it stays empty.

Option (1)'s real risk is silent divergence: an upstream change to the boot that nobody mirrors.
S2 removes that risk mechanically instead of relying on the merge checklist. The build records a
hash of `src/index.jsx`'s boot region (everything except the `renderApp` function and the
`RootApp` import) in `scripts/jellyfinmod-build/`, and the build fails, loudly and by name, when
that hash changes without the recorded value being updated in the same commit that mirrors the
change into the mod entry. Merge-routine step 3 stays as the human half of the same check.

**Asset audit (§3.1, fork half).** Every document-relative fetch in the fork, and what each needs
when the document is `/web/index.html` but the assets are served from the plugin's path:

| What | Where | Resolves against | Needs |
| --- | --- | --- | --- |
| `config.json` | `hooks/useWebConfig.tsx` and `scripts/settings/webSettings.js`, both via `utils/fetchLocal` | the document URL — `fetchLocal` assigns the URL to a detached `<a>` and `XMLHttpRequest.open`s the result | `modAssetRoot()`; the only two call sites, both passing the bare string `'config.json'` |
| Chunks, `[name].[contenthash].chunk.js`, extracted CSS | webpack runtime | `output.publicPath`, today `''` (document-relative) | `publicPath: 'auto'`, which roots them at the runtime script's own URL |
| Translation dictionaries | `lib/globalize/index.js`, `import('../../strings/${url}')` | the webpack runtime, as a dynamic chunk | nothing beyond `publicPath: 'auto'` |
| `serviceworker.js` | `src/index.jsx` `registerServiceWorker()` | the document URL | a decision, not a rewrite: the mod entry either registers from the asset root with `Service-Worker-Allowed`, or does not register in swap mode. **Open — needs the host spike**, since the header must come from the plugin's own controller |
| `manifest.json`, favicons, touch icons | `src/index.html` `<link>` elements | the document URL | rewritten by the takeover renderer along with the script and stylesheet URLs (§4.4), not by application code |
| date-fns locales | `utils/dateFnsLocale.ts` | dynamic `import()`, webpack runtime | nothing |

So the application-code surface is **one helper at two call sites**. Everything else is either the
webpack runtime (one config line) or the takeover renderer's job. This supports mechanism 1 (swap
in place) as far as the fork can answer; the go/no-go still needs the host spike.

**Package size (§4.5).** The production build emits **no** source maps, so "`dist/` without
`.map`" is `dist/` as built: 2 346 files, 60 MB on disk, **34.2 MB zipped** (`zip -r -X`, ~1 s on
the workstation). Three retained bundles are therefore ~180 MB extracted on the Pi. Extraction
time on the Pi is not yet measured.

**Bundle identity, built and verified.** A prototype of the §3.1 emitter was built and run against
a full production build: a webpack plugin at `PROCESS_ASSETS_STAGE_REPORT` hashes every emitted
asset's name and contents, excluding `.map` files, the manifest itself and the HTML document that
carries the id, takes 12 hex characters of the sha-256, emits `jellyfinmod-web.json` and inserts
`<meta name="jellyfinmod-web" content="…">` after `<head>`. It produced a stable id over 2 347
assets and the matching meta tag. The prototype stamped the **stock** `index.html`, which S2 must
not do — it stamps `jellyfinmod.html` only, so the stock entry's output stays byte-for-byte what
upstream produces. The prototype was reverted rather than committed, because S2 owns this file
and S1 writes no product code; it is kept for S2 to adapt.

#### S1 evidence — 2026-09-20, part 2: the host and the embedding spike

Recorded on the dedicated **acceptance instance** (`jellyfinmod-acceptance`, its own compose,
its own Transmission, its own library, web root bind-mounted read-write). Production and the
retention instance were not contacted. Addresses and host paths are omitted.

**Static serving.** `GET /web/index.html` answers `200` with `Cache-Control: no-cache`, an
`ETag` and `Last-Modified`, and no `Expires`. This is better news than §4.7 assumed: `no-cache`
means a browser revalidates the document on every load rather than serving a cached copy, so a
patched `index.html` is picked up on the next page load and the "a browser that cached the stock
page shows stock until the cache expires" caveat does not apply to this host. Hashed assets are
served with `ETag` and `Last-Modified` but **no** `Cache-Control` at all, so they fall to
heuristic caching — which is why the plugin serving them itself with `immutable` (§4.5) is worth
doing. `GET /` answers `302` to the relative `web/`, and `GET /web/` serves `index.html` as the
default document. Range support is advertised (`Accept-Ranges: bytes`).

**Web directory in the image.** In the pinned image the web root is `root:root`, mode `0755`.
The containers here run as `1000:1000`, so **the image's own web directory is not writable by the
runtime user** and the Docker image shape (§4.8) needs an explicit `chown` or `chmod` in the
Dockerfile — S5 must not assume it inherits writability. On the acceptance instance the web root
is a bind mount owned by the host user the container runs as, and a write probe from inside the
container succeeds, so the takeover target there is writable today.

**Host version — a correction to §3.5.** The pinned image reports `Version: 12.0.0`, not the
`10.11.11` §3.5 and README §7.1 describe. The plugin's `targetAbi` of `10.11.0.0` is a *minimum*,
so it still loads, and it does: `GET /JellyfinMod/Health` answers `200` with `Ok: true` and the
sixteen Phase 1–6 capabilities. But `supportedServer` in `jellyfinmod-web.json` must be written
against what the host actually reports, and §3.5's "pinned line `10.11.x`" row does not describe
this deployment. Flagged for the plan; S3 should not encode `10.11.x` without settling it.

**Embedding spike — go.** The §2.1 mechanism was proven by building it rather than by a
throwaway: a second entry whose router imports upstream's route tables and replaces only the app
table's layout. Driven with Playwright over CDP against the acceptance instance, **13 of 13
checks passed**: the mod entry executes and sets `window.__jfmodBundle`; its `jellyfinmod.html`
meta tag equals `jellyfinmod-web.json`'s `bundleId`; the upstream login view signs in under the
mod router; Home, the Movies library, the TV library and search all render; a real item detail
page renders through the legacy `viewManager`; the Dashboard renders with its own layout, as does
the Dashboard plugins page (whose `/web/configurationpage` URL is absolute and unaffected); the
TV layout renders Home through the **legacy** route table; and the stock entry still renders and
carries neither the marker nor the meta tag. The only console noise was pre-existing: one missing
translation key and two missing artwork images in the acceptance library.

One correction to §2.2 follows from the spike. The **Dashboard and the server wizard keep their
own layouts** and are imported completely untouched, rather than being re-parented under the mod
shell. Both already carry their own full navigation, so wrapping them would give those pages two
sets of chrome, and leaving them alone is what makes "the Dashboard keeps working" true by
construction. They are reached from the mod shell's user menu.

**Service-worker policy (default 7) — decided conservatively, still flaggable.** The mod entry
registers the worker only when the bundle is served from the document's own directory; when the
document is `/web/index.html` and the bundle is not, it logs why and registers nothing. A worker
cannot claim a scope above its own directory without `Service-Worker-Allowed`, and that header
has to come from the plugin's controller, which does not exist until S3. Offline support is the
only thing lost in swap mode. S3 can revisit it once it owns the response headers.

**Still open.** `BasePlugin.OnUninstalling` behaviour (needs a plugin build to carry it, so it
lands with S4); the end-to-end swap spike with a real patched `index.html` (S4, once the plugin
serves the bundle); route takeover with `hostwebclient=false`; Prowlarr's observed API (S9);
bundle extraction time on the Pi (S3). None of these blocks S2, whose go/no-go is answered above.

### S2 — the mod entry, its shell, and stock by construction (Stage A)

Add `src/jellyfinmod.jsx`, the webpack entry, `jellyfinmod.html`, `jellyfinmod-web.json`,
`window.__jfmodBundle`, `modAssetRoot()`, `ModAppRouter` per §2.1 with pass-through routes for
the pages Stage B will own, and the shell: top bar (the accepted UX §7.3 look, now as the shell's
own component rather than a restyle of `.skinHeader`), library navigation from `useUserViews`,
user menu (Queue, JellyfinMod settings when admin, Jellyfin preferences, Metadata manager,
Dashboard when admin, Quick Connect, Select server, Sign out), theme provider, Back handling,
and the UX §14 degradation. Remove the stock entry's `AppUserMenu` and `catalog/queue` mounts
once the shell carries them (§3.2). Add `ui` to Health capabilities (S3 ships it; S2 tests
against a build that advertises it).

**Acceptance** — built browser on the isolated instance at desktop, mobile, TV 1920×1080 and
1280×720 by D-pad, as `oleksii` and as an ordinary user:

- `dist/` contains `index.html`, `jellyfinmod.html`, shared chunks and `jellyfinmod-web.json`;
  the stock entry's page renders and behaves exactly as before (the runner's existing 19 checks
  pass against it).
- Opening `jellyfinmod.html`: sign in (password form and Quick Connect), the shell shows every
  library the user has with the right destination, each Embed and Stock-for-now screen of §2.2
  opens inside the shell and works (browse a music library, open the live TV guide if configured,
  a playlist, a collection, a person page, the Dashboard general page with a save and revert, the
  server wizard on a scratch config, user display preferences with a change and revert), a movie
  and an episode play to the end and Back returns to the page that opened them.
- With the plugin transport blocked, the shell renders, every stock screen works, and no mod
  surface shows; with it restored, the mod surfaces return without a reload of the focused grid.
- TV: the shell's navigation is reachable by arrows, Enter opens, Back returns, no focus trap; the
  legacy views' own header is hidden under the shell in all layouts.
- `git diff master -- src/components/toolbar/AppUserMenu.tsx src/apps/modern/routes/asyncRoutes/
  user.ts` is empty and `routes/catalog/queue.tsx` is gone from the stock entry's tree.
- `npx tsc --noEmit`, feature eslint and stylelint pass (supporting evidence only).

### S3 — the plugin serves its own bundle

Package, extract, verify and serve per §4.5; extend Health; add `WebBundleGraceDays` and
retention of previous bundles; add `jellyfin-sync --test --plugin-web`.

**Acceptance** — isolated instance, deployed with the X3 tooling, the read-only web mount still in
place (this task proves (b) alone):

- After restart `<plugin-data>/web/<bundleId>/` exists and matches the manifest; Health reports
  `web.bundleId`, `servedAt`, `supportedServer` and `capabilities` including `ui.web`.
- `GET <baseUrl>/web-mod/` returns `jellyfinmod.html` with `no-store` and absolute asset
  URLs; assets under the id answer `immutable`; `../` and encoded separators are 404; anonymous
  access works for these routes only (`Settings/**` still 401/403).
- At that address, in every layout: Home, Movies, search, a file-less detail, a native playback,
  the queue, the release picker and the Dashboard work; the network log shows no request under
  `/web/` other than the host's own.
- Deploying a second build keeps the first bundle served at its old path and lists both; after
  the grace period (shortened in the isolated XML) the older one is pruned; a fourth build prunes
  the oldest at once.

#### S3 evidence — 2026-09-20, on the acceptance instance

**Address, accepted by the user on 2026-09-20: `/web-mod`.** The interface is a static site
someone types into a browser, so it mirrors the host's own `/web` instead of sitting under
`/JellyfinMod`. Every API this plugin exposes stays under `/JellyfinMod`; only the bundle moved.
The earlier `/JellyfinMod/Web` path is **dropped, not redirected** — nothing had been published
on it, and a redirect would be one more address to keep working for ever.

Collision and shadowing were checked rather than assumed: `/web/` and `/web/index.html` still
answer `200` from the host's own static root, unchanged; `/web-mod` answers with and without a
trailing slash; `/JellyfinMod/Web/` is now `404`. The app's own routing is a `HashRouter`, so
everything after `#` is resolved in the browser and cannot collide with a server route — deep
links were opened directly at `/web-mod/#/movies?topParentId=…&collectionType=movies` and
`/web-mod/#/details?id=…` and both rendered, as did `/web-mod/#/dashboard`.

| Check | Result |
| --- | --- |
| Bundle installed and verified | The plugin recomputes the bundle id from the extracted files and refuses a mismatch; it matched, and Health reports `bundleId`, `webCommit`, `servedAt`, `retainedBundleIds`, `hostVersion` and `supportedServer` |
| Capabilities | `ui` and `ui.web` advertised |
| Document | `Cache-Control: no-store`, the takeover marker, `window.__jfmodAssetRoot`, the meta tag equal to the manifest's `bundleId`, and no relative script or stylesheet left in it |
| Assets | `Cache-Control: public, max-age=31536000, immutable`, `Accept-Ranges: bytes` |
| Traversal | `../../../etc/passwd`, percent-encoded `..%2f`, backslash `..%5c` and `../jellyfinmod.db` all `404`; an unknown bundle id `404` |
| Authorization | `/JellyfinMod/Settings/Acquisition` and `/JellyfinMod/Health` answer `401` anonymously; only `web-mod/**` is anonymous |
| Retention of a superseded bundle | A second build left both ids in `retainedBundleIds`, and the older bundle still served both its document and its assets at its own path. Two bundles occupied ~121 MB |
| Running from the plugin path | Home, Movies, search, a detail page and the Dashboard all render, with **zero** requests under `/web/` and no failed requests |

**Service worker (default 7) — moot on an HTTP deployment, and measured rather than assumed.**
`navigator.serviceWorker` is `undefined` for **both** the mod and the stock entry on this server,
because a LAN HTTP origin is not a secure context. So no service worker is registered today in
either interface, and the conservative choice not to register one in swap mode costs nothing
here. The question only becomes real for an HTTPS deployment, where the header must come from
the plugin's own controller; it stays open until then.

**Two defects were found by deploying, not by reading.** The first build answered `500` on the
bundle document because the controller declared both a relative and an absolute route for the
same action, which makes every request to it an ambiguous match. The second was quieter: the
manifest's `testedOn` and `expectsCapabilities` arrived empty because `System.Text.Json` leaves
a get-only collection property alone, so the bundle silently claimed to support no server at all.
Both are fixed; both are the reason S3 acceptance is a live run and not a build.

**A correction to the S1 asset audit.** The audit found the document-relative fetches that go
through `fetchLocal` and the webpack runtime, and missed four that are built as plain relative
strings at runtime: the theme stylesheet (`ThemeCss.tsx`), the device images (`utils/image.ts`),
the default avatar (`userprofile.tsx`) and the silent sound (`playbackPermissionManager.js`). The
theme stylesheet `404`ed from the plugin path. All four now go through one `assetUrl` helper that
is a no-op unless a JellyfinMod document declared where its bundle lives. **This grew the patch
surface of §3.2 by four upstream files plus one new file**, which §3.2 must record.

### S4 — take over `/web/index.html` and give it back

Implement the engine per §4.6 with the mechanism S1 chose, the failsafe, the server-range check,
the Interface settings and `RestoreStock`, the log lines with the manual recovery, and
`scripts/jellyfinmod-e2e/patch-check.mjs` (renders and asserts the patched file offline from a
stock fixture and `jellyfinmod.html`). Apply the isolated compose change first (gate 5).

**Acceptance** — isolated instance, its web bind mount now read-write (decision 8), hashes checked
with `sha256sum` on the test host. Note that this proves the **bind-mounted** shape only; the
image's own web directory is S5's and S11's to prove:

- Fresh install, no administrator action: a first start with no plugin configuration patches
  `/web` on its own (decision 7), the log names the bundle id, both hashes and the manual
  recovery, a `interface_patched` history row exists, and Health and `Settings/Interface` report
  `patchedBy: "automatic"` with `patchedAt`. Setting `JELLYFINMOD_UI_TAKEOVER=false` before that
  first start leaves stock in place and nothing is written.
- Turning the takeover on writes exactly two files; `index.html.pristine` equals the original
  stock file by hash; `/web/` in a fresh session shows the JellyfinMod shell with the address
  `/web/index.html#/home`; bookmarks (`/web/index.html#/details?id=…`, `/web/#/search`,
  `/web/index.html#/dashboard`) open the right pages.
- Turning it off restores a file whose hash equals the recorded stock hash; the stock copy is
  gone; `/web/` shows stock Jellyfin and the runner's stock checks pass against it. Record
  explicitly which file that hash is of: on the isolated instance the web root is the fork's
  bind-mounted `dist/`, so it is the fork's stock entry, not the host image's stock file (§4.8).
- Host-upgrade simulation: replace `index.html` with a differently hashed stock file from another
  web release and restart; the engine re-patches from the new file, keeps `.prev`, and a later
  restore yields the new stock file. With the bundle's `supportedServer` narrowed in a test build
  to exclude the running host, startup restores stock and reports `server_version_unsupported`.
- Double-patch guard: restart twice, redeploy the same build, edit the patched file by hand; no
  restart renders from a marked file; the edited case reports `patched_file_modified` and
  re-renders from the pristine copy.
- Failsafe: with the takeover on, stop the container, remove the plugin folder, start; `/web/`
  renders stock at the same address (stock copy fetched, `document.write` applied; no blank page,
  no reload loop) on desktop, mobile and TV layout; the manual recovery copies the stock file back
  and the next load is plain stock. Repeat with the bundle directory deleted and with the plugin
  disabled in the Dashboard; re-enabling re-verifies without rewriting an unchanged file.
- Read-only: make the web directory read-only for the container and restart; startup succeeds,
  Health shows `webRoot: "readOnly"` and the blocker, the settings area explains it, nothing is
  written, the own-path address works.
- `patch-check.mjs` passes on the current fixture and fails on a fixture with a stock script tag
  left in place.
- Security: `RestoreStock` and `Settings/Interface` answer 401/403 for anonymous and ordinary
  users; the served path cannot read outside the bundle.

#### S4 evidence — 2026-09-20, on the acceptance instance

Every row of §4.6's state table was walked live. Hashes are `sha256` of the file on disk.

| Row | Result |
| --- | --- |
| First start, no administrator action | Patched by itself (decision 7). Exactly two files written: the patched `index.html` and `index.jellyfinmod-stock.html`. `patchedBy: "automatic"`, log naming both hashes and the manual recovery |
| Restart twice | Hash unchanged both times; no double-patch |
| Patched file edited by hand | Detected, warned, re-rendered back to the exact expected hash |
| Host upgrade simulated (different stock file) | New stock recorded, previous pristine archived to `.prev`, re-patched, stock copy updated; warning named both hashes |
| Takeover off via `PATCH /Settings/Interface` | Restored to **exactly** the recorded stock hash; `index.jellyfinmod-stock.html` removed; state `stock` |
| Takeover on again | Re-patched |
| Plugin folder removed, container restarted | **Failsafe fired**: the bundle never ran, 12 asset requests 404ed, the stock copy was fetched and written in at the unchanged `/web/` address, no reload loop |
| Web root made read-only | State `readOnly`, blocker logged, nothing written, `/web-mod/` still serving. Restored to writable and it re-patched on its own |

Hashes from the run: the host image's own stock `index.html` is
`a1308635f90142b14245f13c4f6307e0a4dbea34bb1cb398b6bc59f7379cfbe3`; the fork's stock entry, which that web root
held before the walk, is `5e21b9e4aaab3c5217e3dc28bfed9addacf8d9ee2c35f3d11bcd74daa5bfa542`.

**Two defects that only deploying found.** The patched document was being rendered from the *host's* `index.html`
with its URLs rewritten into the bundle directory — which contains the stock entry too, so the page loaded a
working Jellyfin that was not this interface, and the failsafe correctly replaced it with stock. The pristine
copy's job is to be the way back, not the input; the bundle's own document is the input, and it is never a
patched file, so patches still cannot stack. Separately, `onerror` had been hooked to every `<link>`, so a
missing touch icon would have torn the page down to stock — a far worse failure than the one it reacted to. Only
entry scripts and stylesheets report failure now.

**A gap those fixes exposed, and closed.** The engine re-rendered only when the bundle id changed, so a plugin
upgrade that changed the *rendering* would look at a correctly-recorded patched file and decide there was nothing
to do — silently, and surviving restarts. `WebDocumentRenderer.Version` is now recorded in the state and a change
in it triggers a re-render exactly like a change of bundle.

**`Cache-Control` is friendlier than §4.7 assumed.** The pinned host serves `/web/index.html` with `no-cache`, so
a browser revalidates the document on every load and picks up a patched file immediately. The "a browser that
cached the stock page shows stock until the cache expires" caveat does not apply to this host.

**A caching effect worth knowing.** The first failsafe test appeared to pass when it should not have: the bundle
loaded from the browser's disk cache, because everything under a bundle id is served `immutable`. That is the
cache doing its job — a client that already has the bundle keeps working even when the plugin is gone — but it
means a failsafe test is only meaningful with the cache disabled.

**Not built: `scripts/jellyfinmod-e2e/patch-check.mjs`** (agreed 2026-09-21). Writing it in JavaScript would mean
a second implementation of the renderer, and two sources of truth for a safety-critical transform is worse than
one plus live evidence. If an offline guard is wanted later, the right shape is a small .NET harness invoking the
real `WebDocumentRenderer`, which is integration-style rather than a unit test.

### S5 — image, archive, merge routine and compatibility

Dockerfile and entrypoint per §4.8; first-start variable; archive layout; README sections for both
shapes, upgrade, rollback, manual recovery and the §3.4 routine; the compatibility matrix
published with the release notes.

**Acceptance** — built on the test host for its architecture and run as a second isolated
service on `<isolated-image-port>` with its own config volume and disposable media (never the
production compose, never the shared `jellyfinmod-test` volumes):

- A fresh container from the image installs the plugin into its config volume, applies
  migrations, patches `/web` **with no administrator step** (decision 7), and a browser sign-in
  lands in the JellyfinMod shell. This is the image's own web directory, not a bind mount, so it
  is verified here separately from S4's evidence (decision 8): record the directory's ownership
  and mode, that the runtime user could write it, and the `patchedBy: "automatic"` report.
- `JELLYFINMOD_UI_TAKEOVER=false` on a fresh container leaves the image's web directory stock,
  reports the switch as the reason, and the interface is still reachable at the plugin path.
- Repository, preconfigured (decision 11), verified **on the image's own web directory, not the
  bind-mounted one**: a fresh container comes up with the JellyfinMod repository already in
  Manage Repositories, clearly named and pointing at the server's own address;
  `GET /Packages/JellyfinMod?assemblyGuid=<guid>` answers; and Dashboard → Plugins shows the
  plugin with its version and no error banner.
- Removing that repository entry in the Dashboard leaves the plugin fully working — catalog,
  acquisition, import, retention and the interface all unaffected — and only the details panel
  and the update path stop being available. Re-adding it restores them.
- A container started against a config volume that already has a JellyfinMod repository
  registered does not gain a second copy.
- `docker compose up -d --force-recreate` results in a re-patched page after startup;
  downgrading to the previous image tag serves the previous bundle and does not downgrade the
  plugin folder.
- Archive shape: pointing the isolated web mount at the unzipped `web/` makes the engine report
  `forkServedByHost` and write nothing.
- `jellyfin-sync --test --plugin-web` builds, packages and deploys; every X3 production refusal
  still exits non-zero before any remote action.
- One upstream merge is executed end to end per §3.4 on the isolated instance (the current
  upstream tip at the time), recorded with both SHAs, the patch-check result, suite results, the
  Playwright timings and the bundle id change.

### S5.1 — the plugin publishes its own repository

A plugin installed by copying files has no repository behind it. The Dashboard asks every configured repository
for the package, finds nothing, and shows *"An error occurred while getting the plugin details from the
repository"* above the entry. The banner is the cosmetic part; the real cost is no version history and no update
path, which S5 needs anyway.

So the plugin serves its own repository, in the same spirit as the bundle:

- `GET /JellyfinMod/Repository` (anonymous) returns the manifest, in the shape the server parses: an array of
  packages, each with `guid`, `name`, `description`, `overview`, `owner`, `category` and a `versions` array of
  `version`, `changelog`, `targetAbi`, `sourceUrl`, `checksum`, `timestamp`, `repositoryName`, `repositoryUrl`.
  Anonymous because the server fetches a repository as an ordinary outbound request, with no session and no
  token, exactly as it fetches anyone else's.
- `GET /JellyfinMod/Repository/{package}.zip` (anonymous) serves the installable package, built from the
  installed plugin directory, flat, which is the layout the server extracts.
- **Everything is derived from JPRM's `meta.json`**, never restated. `plugin/CLAUDE.md` forbids hand-writing
  that file, and a hand-maintained repository manifest would be the same mistake one step removed: a second
  description of the plugin, free to drift from the plugin.
- `checksum` is the hex MD5 of the very file `sourceUrl` serves, computed from that file. The server hashes the
  download and refuses it on a mismatch, so a manifest whose checksum disagrees with its package is worse than
  no manifest at all: it renders, and then the install fails.
- `sourceUrl` and `repositoryUrl` are built from the request that arrived, so they are right for however the
  administrator registered the repository — by address, by hostname, behind a proxy, under a base URL — without
  the plugin having to be told what the server is called.
- Failure is never fatal: no readable `meta.json` means the endpoints answer `503` and the plugin works exactly
  as before, with the Dashboard reporting what it reported already.

**Offline by design.** A self-hosted manifest needs no internet access, which is the point for a server that has
none, and for a Docker image that should work the moment it starts. A public manifest — GitHub-hosted, as most
Jellyfin plugins do — remains the right answer for *distributing releases to other people*, and is a separate
piece of work from this one. The two do not conflict: the same JPRM output feeds both.

**Registration is an administrator's decision, and stays one.** The plugin never edits the server's repository
list. Adding a repository changes where the server will fetch and execute code from, and doing that silently on
someone's behalf at startup would be indefensible however convenient. Two supported routes:

1. **Manual, one step:** Dashboard → Plugins → Manage Repositories → add
   `<your-server>/JellyfinMod/Repository`. Removing it is the same step in reverse and leaves the plugin working.
2. **The Docker image ships it preconfigured** (S5), because there the operator chose the image and the image is
   the product. Still visible and still removable in the same Dashboard list.

**Accepted 2026-09-21 (decision 11).** The image preconfigures it; a manual install never registers anything by
itself. No opt-in switch is built at all: a setting that rewrites the server's repository list would be plugin
behaviour, and this is deliberately image configuration. The image's entry must be visible, clearly named and
removable without breaking the plugin, must point at the server's own address so nothing external is contacted,
and must not be added twice if the operator already registered one by hand.

**Acceptance** — live on the acceptance instance, with the repository registered on that instance only:

- `GET /JellyfinMod/Repository` returns a manifest the server parses when the repository is added.
- `GET /Packages/JellyfinMod?assemblyGuid=<guid>` returns the package rather than `404`.
- The MD5 of the served package equals the manifest's `checksum`.
- Dashboard → Plugins shows JellyfinMod with its version and no error banner.
- The suites cover it, so a manifest missing a required field, or disagreeing with its package, fails a run.

### S6 — the mod owns home, browse, detail and search (Stage B)

Build the mod pages from the existing components: Home (hero, merged rows, remaining upstream
sections through `homesections` builders), Movies and TV grids (`EntryCards`, upstream filter
dialog with the File and Due groups, view settings, other tabs embedded), search (upstream
`SearchResults` sections plus `CatalogSearchResults`), the detail dispatcher and the movie /
series / season / episode page (native actions through `itemContextMenu` and `playbackManager`,
`NativeEntryDetails` content, `VersionRows`, `RetentionStatus`, `HistoryToggle`, release picker,
Keep, Remove with the stock confirm). As each page passes, restore the corresponding upstream
files of §3.2 on `jellyfin-mod` and delete the integration shims that only served them.

#### The Home hero always offers Play — accepted 2026-09-21

User feedback, verbatim: *"main home screen background should be recent tv show or movie with play button."*

What the code actually did, checked rather than assumed: the Play button was gated on
`item.Type === BaseItemKind.Movie`. It had nothing to do with `canPlay`, and a series hero therefore offered only
*More info*. That is the behaviour the user hit, and it is now removed — the hero offers Play for whatever it is
showing.

**What Play starts, and why it is not reimplemented here.** The hero calls
`playbackManager.play({ ids: [item.Id] })`, and for a series upstream already resolves that in
`getSeriesOrSeasonPlaybackPromise`: it asks for Next Up first — which is the in-progress episode when there is
one and otherwise the next unwatched — and then plays the episode list from there, so a fully watched series
starts again at its first episode. That is exactly the "resume, else next unwatched, else first" order, it is the
same resolution the detail page's Play uses, and reusing it is what stops the two disagreeing.

**When nothing is playable.** The button is not silently dropped. If playback cannot start — most likely a series
whose episodes are not on disk — the hero says so under the actions and points at *More info*, because a hero
button that does nothing is worse than one that explains itself.

**The hero only chooses a title that has something to play.** Real data made this necessary rather than
theoretical: the acceptance library holds 105 series but only 514 episodes, and the newest of them — *Tehran*,
*Disclaimer*, *Stranger Things* — have **no episodes at all**. The hero was picking one of those, so the user's
Play button could only ever fail. Candidates are now filtered by `RecursiveItemCount` for a series; a movie in
the library has a file by definition. The explanation above stays as a backstop for a title that stops being
playable between being chosen and being clicked.

**The candidate pool is 200, not 40.** A library import adds a hundred titles at once. With 40, every candidate
after the rescan was a series and the hero could not have shown a movie at all. With 200 the pool holds 54
movies alongside the series, so the rule can pick either type; it picks a series today because every series was
indexed more recently than every movie, which is what "most recent" honestly means here.

#### S6 evidence — the Home hero, 2026-09-21

Against the acceptance instance on bundle `50446611ceb6`, ids re-derived live after the rescan.

| Check | Result |
| --- | --- |
| Selection rule can pick either type | Pool of 160 candidates → 104 playable with a backdrop, of which **54 are movies**; the first movie ranks 50th. Chosen: `Series: Under the Bridge` |
| Series hero offers Play | Visible |
| What Play resolves to | Next Up → `S1:E1 Looking Glass`, unplayed, resume position 0 |
| Series hero Play actually starts it | Server session reported `NowPlayingItem` = that exact episode id, type `Episode`, video element present |
| Movie Play through the same call | `Night of the Living Dead` started, type `Movie`, video element present |
| Nothing-playable explanation | Proven on the previous bundle `1c749aead235`, before the filter existed: clicking Play on *Tehran* (0 episodes) showed "Nothing to play yet. Open More info to see what is available." instead of a dead button |
| Instance left quiet | Playback stopped; `NowPlayingItem` null |

**Not yet proven: a movie *as the hero*.** It could not be produced naturally, because every series was indexed
more recently than every movie, so the newest playable candidate is always a series today. The movie half is
evidenced by the same `playbackManager.play({ ids })` call the hero makes, driven on a movie, plus the absence of
any type gate in the component. Producing a genuine movie hero needs either a movie newer than all 105 series or
a deliberate fixture, and neither was worth doing inside a window the parity run was waiting on.

**Acceptance** — built browser on the isolated instance in every layout, with disposable
fixtures only, each removed at the end:

- Home hero: Play is present and starts playback for **both** a movie hero and a series hero; the series case
  starts the in-progress or next unwatched episode; a title with nothing playable shows the reason instead of a
  dead button.
- Home: hero honours Latest exclusions and `canPlay`; merged rows sort per W10; the user's Home
  section choices are honoured; a file-less wanted title appears in Recently Added with its mark
  and a reclaimed one does not.
- Browse: W2, W3 and W8 acceptance on the mod grids (sorting and paging with file-less entries,
  combined filters surviving a reload, no blanking, D-pad reachable filter menu; with the plugin
  transport blocked the grid is the native list); Suggestions, Favorites, Collections and Genres
  tabs work inside the page.
- Search: W4 and W13 acceptance (two zones, optimistic add, Undo for admins only, focus stays in
  the field, TMDB down leaves the rest working, TV and mobile operable).
- Details: W5, T14, T19, A7, M8 acceptance on the mod page (Play and resume for owned items,
  mark played, favourite, versions drive playback with the chosen `mediaSourceId`, History,
  retention line, Search releases with the hold and Cancel, Keep by keyboard, Remove with the
  stock confirm, native 404 for a reclaimed title handled); a person and an album still open the
  upstream view through the dispatcher.
- `git diff master -- <each restored upstream file>` is empty; the runner's stock checks pass
  against the stock entry.
- Hygiene: the run's final assertion finds no `JellyfinMod`-prefixed title in any library or in
  `GET /Entries`.

#### S6 evidence — cast images, the browse merge and search, 2026-09-21

On the isolated instance, plugin build from `master` + the fix below, web bundles `fa503504d766`
then `a9435092c681` (`webCommit 45cf9e98d3`), host `12.0.0`. Playwright's bundled Chromium,
headless, signed in as `oleksii`. The instance's web bind mount was removed for these runs so the
plugin serves its own bundle at `/web-mod/`, with the container's own stock web root at `/web/`
for side-by-side comparison; the takeover itself reports `readOnly` / `web_root_read_only` there,
because the image's web directory is root-owned and the service runs as uid 1000.

**Cast and guest-star portraits: not a mod defect.** Reported as "Guests and Cast are empty on new
mod". Driven on a series detail page (`Peaky Blinders`, 28 people, 28 with a primary image tag):

| Shape | Result |
| --- | --- |
| Stock entry at `/web/` | All 28 cards lose `lazy-hidden`; the horizontally visible ones take their `background-image` |
| Mod entry, bundle served from the web root | Identical |
| Mod entry, bundle served from the plugin path (`/web-mod/`) | Identical; portraits render at 1280×900, 390×844 and 1920×1080 with `layout=tv` |

The page's scroll container is `BODY.libraryDocument`, so the lazy loader's viewport-rooted
observer needs the window scrolled, not an inner container. An earlier probe that reported the
cards "never unveiling" had simply not scrolled far enough, on both sides. The `serverId=undefined`
in cast hrefs is present on the stock entry too, so it is a pre-existing fork quirk and not the
cause. **Untested shape:** the genuinely patched `/web/index.html`, which cannot be produced on
this instance for the reason above.

**The mod TV grid was showing each owned series twice, not losing 38 of them.** Measured against
the API rather than by counting cards: the Shows library holds 105 native series, and
`POST /JellyfinMod/Browse` returned 162 rows — 105 native plus 57 catalog entries, 55 of which
were unbound entries naming a title the library already owns (`state: none`,
`jellyfinItemId` unset). The first page of 100 therefore held 67 native series and 33 duplicates,
which is exactly the "67 of 105" that was read as truncation. There is no cap in that path: paging
worked throughout, and a browser walk reached rows 101–162 including all five titles thought to be
unreachable. The fix is in `BrowseController`: the dedup by title identity ran only when no target
library was given, and now always runs, so a title is one row whether or not its entry is bound
(PHASE1 "never see duplicates of accessible owned titles").

After the fix, browser walks with the Next control: Shows 100 + 8 = 108 rows (105 native + 3
entries not on disk) against stock's 105; Movies 54 against stock's 54.

**Stock does page this route.** The claim that stock caps at 100 cards with no paging control is
wrong: the stock grid walks 100 + 5 = 105 and reaches *The White Lotus*, *Will Trent*,
*Yellowstone (2018)*, *You* and *Young Sherlock (2026)*. Nothing is unreachable on either side.

**Search is mod-owned and its upstream row is out.** `apps/legacy/routes/search.tsx` is restored
(`git diff master` empty) and the mod router owns `search`, in both layouts. Typed `peaky` and
observed: mod shows *Shows* plus *Add from TMDB* with the file-state mark on the owned card, and
focus stays in `#searchTextInput`; the fork's own stock entry at `/web-mod/<id>/index.html` shows
only upstream's sections with no `jfmod-` element. Confirmed at 1440×900, 390×844 and, driven by
keyboard rather than a mouse, at 1920×1080 and 1280×720 with `layout=tv`. No page errors.

**Patch surface correction.** §3.2 does not list `apps/modern/features/libraries/`
(`ItemsView.tsx`, `LibraryToolbar.tsx`, `hooks/useLibrary.tsx`, `PlayAllButton.tsx`,
`ShuffleButton.tsx`, `filter/FilterButton.tsx`), which carry the combined-browse mounts for the
modern grids, nor `components/filterdialog/` (`filterdialog.js`, `filterdialog.template.html`,
`filterIndicator.js`) or `components/QueryClientEventHandler.tsx`. They belong in the table with
the `movies.js` / `tvshows.js` row's lifetime.

#### S6 evidence — the detail route, 2026-09-21

Bundle built from the branch and served by the plugin on the isolated instance; Playwright's
bundled Chromium, headless, signed in as `oleksii`.

The mod router owns `details`. It composes the page rather than editing upstream's file: upstream's
template and controller for a native item with the mod's augmentation registered first, the mod's
own controller for a `entryId` with no file, and no mod work at all for anything the catalog does
not know. What that bought back:

| Upstream file | State |
| --- | --- |
| `apps/legacy/controllers/itemDetails/index.js` | restored, `git diff master` empty |
| `apps/legacy/routes/search.tsx` | restored, `git diff master` empty |
| `components/itemContextMenu.js` | restored, `git diff master` empty — nothing wraps the stock More menu now |

The mod's own commands (Search releases, Get another quality, Search now) left the stock More menu
and are plain buttons in the mod's section, so the wrap that used to need `executeCommand`
exported is gone. A monkey-patch was considered and rejected: it would not appear in a diff.

| Page | Observed |
| --- | --- |
| Series (`Peaky Blinders`) | Upstream Play, Trailer, Shuffle, Mark played, Add to favorites, More; Next Up, Seasons, Cast & Crew, Guest Stars; mod Search releases, Keep, History ("Discovered in Jellyfin library"), retention line |
| Movie (`20 Days in Mariupol`) | Upstream Play, Trailer, Mark played, Add to favorites, More; mod Search releases, Get another quality, Keep, Version rows, History, retention |
| File-less entry (`1923`, `state: none`) | Mod page on upstream's template: Keep, Monitor, Remove entry, Refresh metadata, History |
| Person (`A.C. Lyles`) | Upstream view, no mod section — the dispatcher falling through |
| Missing native item | "This item is no longer in the library. Open Home", rendered from the mod's own 404 handling rather than from inside upstream's catch |
| Stock More menu | Opens with upstream's eleven commands and nothing else |

Layouts: movie page verified at 1440×900, 390×844, and 1920×1080 and 1280×720 with `layout=tv`,
no page errors in any. On TV, ArrowDown from the page reaches *Get another quality* and *Search
releases*, so the mod actions are d-pad reachable.

**Not verified.** The reclaim redirect (a native id whose item is gone but whose entry exists,
which should land on `?entryId=`) — no such item exists on the instance; the code path is the one
that already served it, only its caller changed. A native episode shows no mod section because the
server returns no entry for an episode item id on this instance (episodes are discovered at series
level and left unbound); that is a data condition, not the route, and it predates this change.

**Browse is still patched.** `movies.js`, `tvshows.js` and the modern `features/libraries` files
above still carry the combined-browse mounts. Unlike search and detail, the mod's browse changes
live inside upstream components rather than behind a route, so owning them means mirroring
`useLibrary`, `ItemsView` and `LibraryToolbar` into the mod — roughly 600 lines that then have to
be hand-merged forever, which is the cost §3.1 weighs against a patch. That trade needs a decision
before the slice is built.

### S7 — one settings contract behind every form

Add the migration and typed endpoints of the API contract; import the XML-held discovery and
seed-protection values once; make the Phase 3 seed reader take its connection from the
acquisition client when `SeedProtectionSource = acquisitionClient`; make `configPage.html` call
the typed endpoints so both UIs share one path; add `Settings/Overview`, `Setup/State` and the
history events.

**Acceptance** — real HTTP on the isolated instance:

- The migration applies to a copy of the isolated database with clean integrity and foreign-key
  checks; after restart discovery still works without re-entering the token, and `Discovery`
  reports `tokenConfigured: true` and never a value.
- `SeedProtection = acquisitionClient`: `Retention/Preview` shows plugin-added torrents protected
  through the acquisition client's endpoint with no XML URL configured; `separate` with a wrong
  URL blocks with `seed_state_unknown` and never reclaims.
- Every new endpoint answers 401 anonymous and 403 ordinary user; every PATCH without the current
  revision answers 409; unknown fields are 400.
- The Dashboard page still saves and re-reads every field across a restart.

### S8 — the settings area (Stage C)

Route, sections, forms, Tests, secrets handling and TV behaviour per §5; styles feature-local;
links to the embedded upstream preferences and Dashboard.

**Acceptance** — built browser on the isolated instance as `oleksii`, plus an ordinary user:

- Every section saves, shows the echoed revision and re-reads the value after a restart; a stale
  revision shows the 409 message and reloads on request.
- Secrets: replacing the TMDB token, the Transmission password and the Prowlarr key never puts a
  value in any response (the runner's leak check is extended to the settings routes); Clear
  removes it; the indicator flips.
- Tests: TMDB, Transmission, import path, indexer and Prowlarr each show a code and sentence for
  success, wrong credential, unreachable host and timeout, driven by the boundary servers.
- Overview shows readiness per area with the same blockers `Settings/Acquisition` returns, the
  bundle id equal to the page's meta tag, the upstream merge base, and a warning when the ids
  differ (loading the retained older bundle).
- Ordinary user: no menu item, direct navigation shows the UX §14 message, every endpoint 403.
- Mobile at 390 px: no horizontal scroll; TV: every section reachable by D-pad, Back returns to
  the opener, no focus trap; an older plugin without `settings.overview` hides the route.

### S9 — Prowlarr

Plugin: source resources, sync task, indexer extensions, fail-closed rules, Test. Web: the
Prowlarr card in Indexers with the synced list and per-indexer state. Test infrastructure: a real
HTTP Prowlarr boundary server (`/api/v1/system/status`, `/api/v1/health`, `/api/v1/indexer`,
`/api/v1/indexer/{id}/status`, `/{id}/api` forwarding to the Torznab boundary) with scenarios for
removal, disable, `disabledTill`, 401, 429, 5xx, schema drift and an empty list.

**Acceptance** — isolated instance:

- Saving a source and pressing Sync creates one local indexer per enabled torrent indexer with the
  documented name, feed URL, categories, priority and download hosts, verifies each by `t=caps`
  through the boundary, and `GET /Releases` for a disposable movie returns candidates from a
  synced indexer; a grab through it reaches the disposable Transmission (Phase 4 A8 path
  unchanged).
- The Prowlarr key exists once in the secret store; synced indexer rows have no key reference;
  rotating the key makes the next search use it everywhere.
- Removing an indexer in the boundary disables it locally with `prowlarr_removed` and keeps its
  grabs' source names; disabling it disables it; `disabledTill` opens the breaker; an
  administrator override of the daily budget survives three syncs.
- One empty list changes nothing; two, an hour apart (clock override documented), disable the
  synced indexers; a 401 or malformed body aborts with the code and changes nothing.
- Anonymous and ordinary-user calls to every Prowlarr route are refused; the source URL is never
  echoed with credentials; the log never prints the key.
- If gate 6 approved a disposable Prowlarr: the same flow against it, version recorded; all its
  indexers and the source are removed afterwards.

### S10 — the wizard

Server `Setup/State` and `Dismiss`; web wizard reusing S8's forms; Home banner for
administrators; refusals per §7.

**Acceptance** — isolated instance with a fresh copy of the database (entries kept, acquisition
settings cleared), built browser as `oleksii`:

- The banner appears for the administrator and not for an ordinary user; the wizard cannot
  advance past Discovery until the TMDB test passes; past Download client until Test, destination
  and import-path probe pass, with a directory inside the library root and one on a second bind
  mount each refused with the documented code; past Indexers until one is verified (once by hand,
  once by Prowlarr); past Quality profile until a default exists; Enable succeeds only then, and
  the 409 blocker list shows when tried earlier.
- Closing the browser mid-way and returning resumes at the first incomplete step; Dismiss hides
  the banner and the wizard stays reachable from Settings.
- After completion a grab from the picker reaches the disposable Transmission.
- TV: the wizard opens, each step is readable and Back returns; desktop and mobile carry the
  data-entry checks. Every fixture the run created is removed.

### S11 — isolated acceptance and release gate

On `jellyfinmod-test` with the compose change applied (the web bind mount read-write, decision 8),
the plugin revision and bundle id from Health, production never contacted, signed in as `oleksii`
with an empty password:

1. Fresh install path: deploy the package to a clean isolated config, sign in at `/web/`, run the
   wizard end to end, sync Prowlarr, grab, import, play, and confirm the T18 retention cycle and
   the Phase 6 automation checklist still pass with settings saved only through the new area;
   confirm the reclaimed fixture's folder and sidecars remain (decision 5).
2. Takeover matrix: S4's rows, plus a plugin upgrade with a browser and a TV-layout session left
   open (both keep working on the retained bundle; after a full reload they run the new one).
3. Stock parity: with the takeover off and with the plugin uninstalled, the runner's stock checks
   pass on the restored page and hashes are recorded — on the isolated instance against the
   fork's stock entry, and in step 4 against the image's host-stock file, which is the one that
   carries the byte-identical claim (§4.8).
4. Image shape (S5) on the second isolated service: install, recreate, rollback; one upstream
   merge per §3.4 if one is pending. The takeover matrix of step 2 is **re-run here against the
   image's own web directory** (decision 8): the isolated instance's read-write bind mount is a
   different shape — different ownership, different "stock", and a recreate that resets it — so
   its result never stands for the image's. Record both, and record that a fresh image container
   takes over with no administrator step (decision 7).
5. Full-replacement sweep: every row of §2.2 opened from the shell in every layout, including the
   Dashboard, user preferences, Quick Connect, the video player and one screen of each
   Stock-for-now library type present on the isolated instance.
6. Security: anonymous and ordinary-user sweeps of every new route; leak check over every
   response for the three secrets; served-bundle path traversal.
7. Browser: the runner extended with steps for the shell (S2), own-path bundle (S3), takeover,
   failsafe and restore (S4), mod pages (S6), settings and secrets (S8), Prowlarr (S9) and the
   wizard (S10), in all four layouts; physical webOS evidence reported separately, including the
   "fully close and reopen" step after an upgrade.
8. Hygiene: the final assertion finds no `JellyfinMod`-prefixed title in any library or entry
   list, no leftover indexer, source, profile or client from the run, and the web root in its
   expected state; an aborted run's cleanup list is worked through before the gate closes.
9. Record plugin and web revisions, bundle ids, upstream merge base, image tag, host version,
   timings, Pi memory and the merged master SHA; restore the isolated instance to its prior
   configuration.

Phase 7 is complete only when an operator can go from the image or a stock server plus the
plugin to the JellyfinMod interface at `/web` through the wizard alone; every screen a user needs
is reimplemented or reachable through the shell; every setting is in the settings area with
secrets never read back; Prowlarr indexers arrive by sync; the upstream merge routine has been
run once for real; and switching the plugin off or removing it provably returns a byte-identical
stock page with no manual step and no fixture left behind.

## Live acceptance checklist (S2–S11)

Run after the entry gates, on `jellyfinmod-test` only:

1. Apply the compose change (coordinator, not an agent): the fork bind mount **stays** and
   becomes read-write (decision 8); confirm the container can write it; record without paths.
2. Deploy the S2 + S3 build: Health lists `ui`, `ui.web`; the own-path address works in all
   layouts; every §2.2 screen opens through the shell.
3. Confirm the takeover applied by itself on first start (decision 7) and that Health and the
   Interface section say so; hash checks; bookmarks; TV layout at `/web/`; then exercise the off
   switch and turn it back on.
4. Host-upgrade simulation, server-range refusal, double-patch guard, edited-file case.
5. Failsafe: plugin folder removed; Dashboard disable; bundle directory removed; manual recovery.
6. Read-only web root: startup, blocker, own path.
7. Restore: hashes equal; stock runner checks pass.
8. Stage B pages: W2–W7, A7, I8, M8, T14, T19 matrices on the mod pages; restored upstream files
   diff clean.
9. Settings area: every section, secrets leak check, Tests against boundaries, ordinary user.
10. Prowlarr: sync, removal, disable, breaker, empty-list rule, key rotation.
11. Wizard from a fresh copy of the database; refusals; resume; dismiss.
12. Image shape on the second isolated service: install, recreate, rollback; one upstream merge.
13. Regressions: T18 cycle (folder and sidecars retained), A8 flow, Phase 5 and 6 checklists.
14. Hygiene assertion; record revisions, ids, timings, Pi memory; restore the instance's prior
    state.

## Risks

| Risk | Required response |
| --- | --- |
| A bad `index.html` write blanks the login page and the Dashboard needed to fix it | Pristine copy verified before any write; atomic rename; failsafe loads the stock copy from the same directory; manual recovery printed in the log and README; the image resets on recreate |
| Double-patching or patching a fork-served root | Marker detection; the renderer's input is always the pristine copy; the build meta tag is recognised as `forkServedByHost` |
| Host upgrade silently reverts to stock or moves the API under the bundle | Startup reconcile compares hashes and re-patches only inside `supportedServer`; outside it restores stock with a named blocker; the image pins the host |
| Web root not writable in the image for a non-root user | S1 measures; Dockerfile `chown`; read-only state degrades to own path with a visible blocker, never a startup failure |
| The app misbehaves as a `/web/` document with assets elsewhere | S1 swap spike is the go/no-go; `publicPath: 'auto'` and one asset-root helper; mechanism 2 is the fallback |
| Embedding upstream screens under a different root layout breaks them | S1 embedding spike; upstream route tables imported unchanged; the legacy header hidden by the mechanism the modern layout already uses; Stage A accepts every screen before Stage B starts |
| Full replacement drifts into rewriting upstream screens | Inventory fixes Reimplement to home, browse, detail and search; everything else is Embed or Stock for now; the patch surface shrinks as pages land |
| The stock entry silently diverges from upstream | §3.2 rows are removed as pages pass; `git diff master` per file is part of acceptance; the merge routine allows conflicts only in the listed files |
| Boot duplication drifts from `index.jsx` | Merge routine step 3; or option (2) if S1 finds the boot too large to mirror |
| Resident TV clients hold an old bundle after an upgrade | Previous bundles retained at immutable paths; additive API within a release line; existing close-and-reopen guidance |
| Cached stock `index.html` in browsers | S1 records the host's cache headers; the consequence is stated; no attempt to change host headers |
| Secrets leak through the new settings surface or Prowlarr URLs | Write-only DTOs, one store, leak check extended, no userinfo in URLs, key sent only to its own host |
| A Prowlarr outage or bad answer empties the indexer list | Fail-closed rules: errors change nothing, two empty syncs an hour apart, schema check, admin overrides preserved |
| The settings area becomes a second source of truth | Both UIs call the same typed endpoints from S7; the Dashboard page shrinks only after S8 parity |
| Fixtures left in the user's library or catalog | Prefix, isolated library only, cleanup at the end, cleanup list on abort, final assertion in every run |
| Package size and Pi disk | Maps excluded; at most three bundles retained; sizes recorded in S1 |
| Production touched by an image test | Second isolated service with its own volumes and port; X3 refusals; the production compose is never referenced |

## Defaults chosen here — needs user decision

Each is the conservative option behind a named setting or documented default. Items 1 and 16 were
**accepted by the user on 2026-09-20** and are recorded as such; the rest are not accepted yet.

1. ~~**Takeover default after install:** `UiTakeoverEnabled` off until enabled.~~
   **Superseded — accepted 2026-09-20 (decision 7):** `UiTakeoverEnabled` defaults **on**, in
   every shape, and the takeover applies as soon as the web root is writable. The setting
   remains, so an administrator can turn it off; `JELLYFINMOD_UI_TAKEOVER` remains as the
   image's first-start override, now able only to turn it *off*. Every automatic patch is logged
   and reported in Health and the Interface section.
2. **Mechanism:** swap in place, with redirect as the fallback decided by the S1 spike.
3. **Failsafe:** load the stock copy in place (`document.write`), falling back to navigation; the
   stock copy is written beside `index.html` (a second file in the web root) so recovery needs
   nothing from the plugin.
4. **Web root read-only:** degrade to own-path serving with a blocker; never fail startup; no
   remount or host-configuration change.
5. **Server outside `supportedServer`:** restore stock, blocker, own path still served.
6. **Bundle retention:** 14 days (`WebBundleGraceDays`), at most three bundles.
7. **Service worker in swap mode:** registered from the asset root with `Service-Worker-Allowed`
   if S1 shows it works on the pinned host and on TV; otherwise not registered in swap mode.
8. **Boot sharing:** option (1), mirror the boot in the mod entry and diff on every merge; S1 may
   recommend option (2).
9. **Screen inventory:** Reimplement = shell, home, Movies and TV grids, search, movie / series /
   season / episode detail, queue, settings, wizard; Embed = session views, other detail types,
   video player, user preferences, metadata manager, Dashboard, server wizard, the other library
   tabs; Stock for now = music, live TV, books, photos, playlists, collections, mixed, list.
10. **Settings route:** `/catalog/settings` in the mod router; the Dashboard page stays until S8
    parity, then shrinks.
11. **Storage moves:** discovery and seed protection to the SQLite settings row with a one-time
    import; retention stays XML behind a typed endpoint.
12. **Seed protection source:** `acquisitionClient` by default; `separate` available.
13. **Prowlarr rules:** torrent indexers only, one source, 6-hour sync, removed indexers disabled
    for 30 days then deleted, two empty syncs an hour apart before disabling, admin overrides
    limited to enabled, budgets and seed minimums.
14. **Wizard entry:** a Home banner for administrators, no automatic redirect; Dismiss available.
15. **TV scope of the settings area and wizard:** reachable and navigable by D-pad; data entry
    verified on desktop and mobile.
16. **Per-user look:** server-wide only. **Accepted 2026-09-20 (decision 9)**; no per-user
    preference is built in Phase 7.

## Open questions for the user

**Answered 2026-09-20:** 1, 2, 4 and 7 — see decisions 7–10 under *Accepted user decisions*. They
are struck through below rather than deleted, so a reader of an older evidence note can still
find them. Nine remain open; each task implements its proposed default, behind a setting where
reasonable, and flags it.

1. ~~**Takeover default.**~~ **Answered:** on wherever the web root is writable, with an explicit
   off switch, logging and Health/settings visibility (decision 7). Consumed by S4 and S5.
2. ~~**Writable web root in the isolated compose.**~~ **Answered:** keep the bind mount, make it
   read-write; the image's own web directory is a separate shape that S5 and S11 verify
   separately (decision 8). Consumed by gate 5, S4, S5 and S11.
3. **Behaviour across host upgrades.** Re-patch automatically at the next startup after a changed
   stock file inside `supportedServer` (proposed), or hold the takeover off after any host
   upgrade until an administrator confirms? Consumed by S4.
4. ~~**Per-user versus server-wide look.**~~ **Answered:** server-wide only; no per-user
   preference (decision 9). Consumed by S2 and S8.
5. **Web-based TV clients.** Accept that `jellyfin-webos` and Tizen follow `/web` and switch with
   the takeover, with a full app close after upgrades (proposed)? Which physical webOS model
   verifies S4 (PLAN open question 17)? Consumed by S4 and S11.
6. **Failsafe file in the web root.** Write the stock copy beside `index.html` (proposed, two
   files), or keep only the pristine copy in `<plugin-data>`? Consumed by S4.
7. ~~**Stock-for-now list.**~~ **Answered:** accepted as planned — music, live TV, books, photos,
   playlists and collections stay upstream screens inside the mod shell for Phase 7, and none of
   them blocks the takeover default (decision 10). Consumed by S2 and S6.
8. **Boot sharing.** Mirror the boot in the mod entry (proposed) or factor `index.jsx` (one
   permanent upstream edit)? Consumed by S1 and S2.
9. **Prowlarr test harness.** Boundary server only (proposed), or also a disposable Prowlarr
   container on the test host, and whose indexers may it hold (PLAN open question 18)? Consumed
   by gate 6 and S9.
10. **Prowlarr removal window.** Disable for 30 days then delete (proposed), disable forever, or
    delete immediately? Consumed by S9.
11. **Docker image name, registry and host pin.** Under `capische/` to match the repositories
    (proposed), published where, and is the host pinned to `10.11.11` for the first image?
    Consumed by S5.
12. **Wizard on TV.** Reachable and navigable only (proposed), or full data-entry acceptance on TV?
    Consumed by S10.
13. **Settings storage.** Move discovery and seed protection to SQLite with a one-time import
    (proposed), or keep every host-visible setting in XML? Consumed by S7.
