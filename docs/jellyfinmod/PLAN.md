# JellyfinMod — implementation plan

Task list for agents. Each task is self-contained: an agent that has read the **Briefing** below
and its own task entry should be able to finish without asking a question.

**Phase 1 refinement, 2026-09-06:** read [`PHASE1.md`](PHASE1.md) before P5/P6 or web tasks.
It records the accepted permissions and Home redesign, corrects the integration assumptions,
and adds technical gates. The Phase 1 tasks below are not independently implementation-ready
until those gates are resolved. Phase 0 is complete; its verification is recorded below.

Two repos, siblings:

```
<workspace>/
  jellyfin-web/   the web fork      — tasks prefixed W
  plugin/         the server plugin — tasks prefixed P
```

---

## Briefing — read before any task

Read in this order. Do not skip; several questions in these are settled and reopening one wastes
the task.

1. The repo's own `CLAUDE.md` (`jellyfin-web/CLAUDE.md` or `plugin/CLAUDE.md`).
2. `jellyfin-web/docs/jellyfinmod/README.md` — architecture, plugin target, data model, risks.
3. `jellyfin-web/docs/jellyfinmod/UX.md` — the interface, and why it is that shape.
4. This file.
5. For Phase 1, `jellyfin-web/docs/jellyfinmod/PHASE1.md` — current decisions and technical gates.

`jellyfin-web/docs/jellyfinmod/prototype/movies-prototype.html` is a working click-through of the
target design. Open it in a browser when a task says "match the prototype".

### The one idea

**A title is one entry that may or may not have a media file behind it.** Entries live in the
plugin's own SQLite database and are never Jellyfin `BaseItem`s. There is no separate "catalog"
section, no new browse route, and no redirect — `/movies` and `/tv` already *are* the list.

### Non-negotiables

- **Additive only.** Nothing upstream is removed, replaced or reordered — not a route, tab, menu
  item, sort field, filter group, view mode or track selector. If a change reads as "replace X with
  Y", it is the wrong change.
- **Preserve upstream CSS.** Never edit an existing selector or an existing `.scss` file. New styles
  go in new files; new classes are prefixed `jfmod-`; values are read from `themes/_base/theme.ts`,
  `card.scss` and `librarybrowser.scss`, not invented. Everything sizes in `em` — `.layout-tv` is
  125% and `.layout-mobile` is 90%, so a `px` value silently breaks both.
  **User-approved exception (2026-09-06):** implement UX §7.3's top-bar redesign and new Home
  hero in Phase 1. Keep its styles in new feature-local files and retain existing navigation
  actions. This exception does not authorize restyling other upstream surfaces.
- **Three layout modes.** `layoutManager` gives TV a `<button>` card, mobile `CardOverlayButtons`,
  desktop `CardHoverMenu`. Additions slot into all three; never assume a mouse.
- **Corners are allocated.** `.cardIndicators` owns top-right; mobile overlay buttons own
  bottom-right; JellyfinMod uses **top-left**.
- **Degrade when the plugin is absent.** Every plugin query is `retry: false`; a missing or older
  plugin must leave the app fully usable, never a spinner or a crash.
- **Never blank a grid on refetch.** Use `placeholderData: previous => previous`. Unmounting a
  container throws D-pad focus to the top of the page — a TV bug, not a nicety.

### Phase 1 permissions — decided 2026-09-06

The catalog is shared. Users may see and add titles only in libraries they can access.
Removal and settings changes are admin-only. Enforce these rules in the plugin API, including
direct requests by entry ID; hiding a web control is not authorization. Discovery exclusions
must not reveal entries from libraries the requesting user cannot access.

P5 and P6 must test anonymous, ordinary-user and admin requests, including a user without access
to the target library. Derive the user from authentication rather than trusting a request user ID.

W4's **Undo** is admin-only because it removes a saved entry. Ordinary users receive the add
confirmation without Undo. Failed optimistic adds still roll back locally for all users.

**Automatic expiry, accepted:** in Phase 3, retention reclaims eligible media automatically
unless an admin disables it. No confirmation is needed for each expiry. Preserve catalog entries
and history, and retain the existing deletion safeguards. Phase 1 adds no automatic deletion.

### Development conventions

Conventional Commits, lower case, imperative, no trailing full stop. One task per commit where
practical. Web: 4-space indent, TypeScript, `npx tsc --noEmit` and `npx eslint` must both pass.
Plugin: `TreatWarningsAsErrors` is on; XML doc comments are required on public members.

### Definition of done, every task

1. The acceptance check in the task passes.
2. The task's own diff contains no changes outside its stated scope. Preserve unrelated existing
   changes and work by other agents; the entire shared checkout need not be clean.
3. For web tasks: `npx tsc --noEmit -p tsconfig.json` exits 0 and
   `npx eslint src/apps/modern/features/jellyfinmod --ext .ts,.tsx` is silent.
4. For UI tasks: verified at **desktop**, **mobile**, and at **1920×1080 with `localStorage.setItem('layout','tv')`**
   driven by arrow keys only.

---

## Already done — do not redo

| | |
| --- | --- |
| Plugin scaffold | `Plugin.cs`, `PluginServiceRegistrator.cs`, `PluginConfiguration.cs`, `configPage.html`, `Data/{Entry,HistoryRecord,ModDbContext}.cs`, `Api/HealthController.cs`, `build.yaml`, `Directory.Build.props` |
| Web scaffold | `features/jellyfinmod/{types/entry.ts, constants/fileState.ts, api/modApi.ts, hooks/useEntries.ts, components/FileStateMark.tsx, components/fileStateMark.scss}` |

**Phase 0 complete, 2026-09-06:** plugin Release build passes with zero warnings; migrations,
local persistence and deployment-script checks pass. Version 0.1.0.0 is deployed on the Pi and
shown Active in Dashboard. Authenticated Health succeeds with `Ok: true`; anonymous Health
returns 401. The configuration page saves, and its saved XML plus the database schema and single
migration record survive another container restart. Live tables are empty at this phase; local
smoke tests verified persistence with rows. The original deployed DLL SHA256 matched the built artifact:
`9dba934e888d9d47abd50919fc5b8cdcf6dc1f46c0099ce4cdeba86f657aa571`.

**Packaging follow-up, 2026-09-08:** the approved logo and clean Phase 0 package are deployed.
The installed plugin image endpoint returns the approved PNG, the manifest reports Active, and
the container is healthy with only the initial migration applied. The replacement DLL SHA256 is
`d39ece42b435e339bf41cab39e59ee1965f054eb1383429b0954bc9700d70a62`.
The plugin source and packaging are public at
[`capische/jellyfin-mod`](https://github.com/capische/jellyfin-mod), commit
`19226340d9719bb66276dedc248939fab1f2b4dc`. This published baseline excludes Phase 1 work.

**Known packaging limitation:** Dashboard displays `PluginLoadRepoError` because this manually
installed plugin has no package in a configured repository. Installed status and Settings work;
this is repository metadata lookup, not a plugin-load failure. Publishing/repository registration
is separate work; publishing source on GitHub does not register a Jellyfin package repository.
Health uses the host's PascalCase JSON; the Phase 1 client now normalizes the response explicitly.
Verify that conversion through the deployed web application and real plugin Health endpoint during
Phase 1 E2E acceptance; a mocked wire-contract unit test is not sufficient.

---

# Phase 0 — it loads

## P1 · Build the plugin and prove it loads
**Repo** plugin · **Depends on** nothing · **Blocks** everything

Install the .NET 9 SDK, then `dotnet build -c Release JellyfinMod/JellyfinMod.csproj`. Fix whatever
the compiler says; the scaffold has never been compiled, so expect real errors — likely candidates
are `IPluginServiceRegistrator`'s exact signature and analyzer complaints under
`TreatWarningsAsErrors`.

Do not change the plugin GUID, the target framework, or the package versions to make it build. If
`Jellyfin.Controller 10.11.11` genuinely does not expose something, record that in the task output
rather than bumping the version — the pin matches the running server on purpose.

**Acceptance** `dotnet build -c Release` succeeds with zero warnings.

## P2 · Install it on the Pi and answer Health
**Repo** plugin · **Depends on** P1

Copy `JellyfinMod.dll` into a new folder under the server's `plugins/` directory, restart Jellyfin.

**Acceptance** the plugin appears in Dashboard → Plugins as **JellyfinMod**; its configuration page
opens and saves; `GET /JellyfinMod/Health` returns 200 for a signed-in user and 401 for an
anonymous one; all of this survives a container restart.

## P3 · Create the database on first run
**Repo** plugin · **Depends on** P2

Add an EF Core migration and apply it at startup (an `IHostedService`, or on first context use).
The database file goes at `Plugin.Instance.DataPath/jellyfinmod.db` — **not** under
`BasePlugin.DataFolderPath`, which can gain a `_<Version>` suffix on upgrade and orphan the data.

**Acceptance** the file exists after a restart, has the `Entries` and `History` tables, and a
second restart does not recreate or wipe it.

## P4 · Teach `jellyfin-sync` about the plugin
**Repo** jellyfin-web · **Depends on** P1 · **Files** `jellyfin-sync`, `jellyfin-sync.env.example`

The script currently ships `dist/` only. Add a second target that builds the plugin and rsyncs the
DLL, behind a flag so a web-only deploy stays fast. Host-specific paths belong in the untracked
`jellyfin-sync.env`, never in a tracked file — this repo is a public fork.

**Acceptance** `./jellyfin-sync --local` behaves exactly as before; the new flag deploys the plugin
and restarts the container.

---

# Phase 1 — entries appear

Before these tasks, implement `PHASE1.md`'s accepted multi-library identity contract and prove the
combined-query and file-less-details integration. Implement shared TMDB metadata fetching before
P5's create acceptance. The minimum owned-identity lookup is a Phase 1 dependency of P6/W4;
full backfill can stay in Phase 2. W6 also depends on the entry APIs and combined-query work.

## P5 · Entries API
**Repo** plugin · **Depends on** P3 · **Files** new `Api/EntriesController.cs`, `Services/`

```
GET    /JellyfinMod/Entries          list + filter
POST   /JellyfinMod/Entries          create from a TMDB id
GET    /JellyfinMod/Entries/{id}     one entry, including its history
PATCH  /JellyfinMod/Entries/{id}     monitored, quality profile, reclaim override
DELETE /JellyfinMod/Entries/{id}     optionally deleting files
```

`GET` takes `mediaType`, `state[]`, `query`, `targetLibraryId`, `startIndex`, `limit`, `sortBy`, and
returns `{ items, totalRecordCount }`. Match `api/modApi.ts` in the web repo exactly — if the shapes
disagree, the API is wrong, since the web client is already written.

All `[Authorize]`. Admin-only endpoints use `[Authorize(Policy = Policies.RequiresElevation)]`.
There is no `Policies.DefaultAuthorization`.

**Acceptance** each verb round-trips against the real server; `GET` filters and pages correctly;
creating an entry writes an `added` row to `History`.

## P6 · TMDB discovery proxy
**Repo** plugin · **Depends on** P5 · **Files** new `Services/TmdbClient.cs`, `Api/DiscoverController.cs`

`GET /JellyfinMod/Discover/Search?q=&type=` returns TMDB results **minus every id already held as an
entry** — the exclusion happens server-side, from the plugin's own table. This is what makes the
web's "Add from TMDB" section correct by construction: it is defined as the leftovers, so a title
can never appear twice.

Use `IHttpClientFactory.CreateClient(NamedClient.Default)`. The API key comes from plugin config and
never reaches the client.

**Acceptance** searching a title you already hold does not return it; searching one you do not does.

## W1 · Render the file mark on cards
**Repo** jellyfin-web · **Depends on** nothing (works against fixtures) · **Blocks** W2, W3

`Cards` and `Card` take no children and no render prop, so there is **no per-card extension point** —
verify this before designing around it. Do not add `children` to upstream's `Card`.

Add `features/jellyfinmod/components/EntryCard.tsx`: a thin component over the **unmodified**
`useCard`, `CardWrapper` and `CardBox`, rendering `FileStateMark` as a sibling of the stock
indicators. It replaces `Cards` + `Card` for catalog surfaces only — roughly fifteen lines of
mapping — and reuses everything below them untouched. Call `setCardData` first, as `Cards` does.

**Acceptance** a grid of entries renders with marks top-left; the stock played tick and unplayed
count still render top-right; hover menu on desktop, overlay buttons on mobile, and focus scale on
TV all behave exactly as on an unmodified card. Zero upstream files changed.

## W2 · File-less entries in the Movies and TV grids
**Repo** jellyfin-web · **Depends on** W1, P5

Merge plugin entries that have no `jellyfinItemId` into the existing library grid, sorted together
with real items rather than appended. Entries with a `jellyfinItemId` are already in the grid as
Jellyfin items — do not double them; dedupe on the provider id.

**Acceptance** `/movies` shows wanted titles alongside owned ones with correct sorting and paging;
with the plugin stopped, `/movies` is exactly upstream's page.

## W3 · The File filter group
**Repo** jellyfin-web · **Depends on** W2 · **Files** new `components/FileFilterGroup.tsx`, one mount in `filter/FilterButton.tsx`

Add a **File** group to the existing `Filter ▾` menu: On disk · Not downloaded · Downloading ·
Reclaimed, as checkboxes that compose with the Played and Genre groups already there. No chip row —
that was considered and rejected in UX.md §5.2; do not reintroduce it.

**Acceptance** ticking two boxes across two groups produces one combined query; state is reflected in
`LibraryViewSettings` so a filtered library survives a reload; the grid never blanks between
refetches; the menu is reachable and operable by D-pad.

## W4 · Two-zone search
**Repo** jellyfin-web · **Depends on** P6, W1

Upstream's search page keeps its own `Movies` / `Shows` / `Episodes` / `People` sections, now
including file-less entries. Append one new section, **Add from TMDB**, rendered from
`/Discover/Search`. Reserve its space with skeletons from the first keystroke: content arriving
*above* the focus ring moves the D-pad cursor out from under the user.

Do not modify `useSearchItems` or `SearchResults`; compose them.

`+` on a TMDB card creates the entry optimistically, moves the card up into the section above, keeps
focus in the search field, and offers Undo to admins only. Ordinary users see the confirmation
without Undo. No quality-profile dialog on add.

**Acceptance** typing "blade" returns what you have under upstream's headings and only leftovers
under Add from TMDB; adding three titles in a row requires no navigation; TMDB being down leaves the
rest of the page working.

## W5 · Entry page additions
**Repo** jellyfin-web · **Depends on** P5

Two additions to upstream's existing item page, nothing else: **Search releases** in the button row
(primary where Play would be for a file-less entry, in the More menu otherwise), and a **History**
row in the metadata block — collapsed to one line, expanding on click.

**Scope expanded by the user, 2026-09-06:** wanted shows include individual episode tracking,
not only season summaries. P5 must supply persistent episode records, metadata, availability,
native bindings and admin-only monitoring. Include episodes in the detail adapter and preserve
native navigation for downloaded episodes. Monitoring does not trigger downloads in Phase 1.
See `PHASE1.md` §5 for identity, refresh and acceptance requirements.

An entry with no file has no Video / Audio / Subtitle rows because there is nothing to describe.
That absence is the design; do not add a "File: not downloaded" row to fill it.

**Acceptance** an owned movie retains upstream behavior plus the action and History additions;
series also expose the accepted episode tracking without breaking native episode playback.

## W6 · Home merges
**Repo** jellyfin-web · **Depends on** W1, W2, P5

Merge Continue Watching with Next Up into one row, and Latest Movies with Latest TV Shows into one
Recently Added row. Every other Home row is untouched.

**Acceptance** both merged rows sort correctly across their two sources; file-less entries appear in
Recently Added with their mark.

## W7 · Redesigned top bar and Home hero
**Repo** jellyfin-web · **Depends on** W2, W5, W6

**Explicitly included by the user, 2026-09-06.** Implement UX §7.3's gradient-to-solid top bar
and Home hero. Use feature-local components/styles and narrowly scoped toolbar/navigation mounts.
Keep all existing navigation destinations and account actions accessible in every layout mode.
Use an accessible native title for the hero; expose Play only for playable media. Omit the hero
when no suitable title exists. Respect the user's Home section visibility choices in W6.

**Acceptance** desktop, mobile and TV checks cover scrolling, text contrast, focus visibility,
navigation, Back, restricted-library accounts and the empty-library fallback. Check the deployed
build on webOS before calling device verification complete. See `PHASE1.md` §7.

---

# Later phases

Planning may proceed while Phase 1 is in progress. Do not deploy these until Phase 1 passes
acceptance on the Pi. Phases 2 and 3 have task breakdowns; Phase 4 onward remain sketches.

- **Phase 2 — reconciliation.** Match entries to existing Jellyfin items by provider id; backfill
  the existing library, then maintain bindings as media changes. Phase 1 already supplies the
  minimum lookup needed to avoid duplicate discovery results. See [`PHASE2.md`](PHASE2.md) for
  the remaining R1–R5 tasks: repeatable backfill, ongoing sync, missing-media handling and
  per-user state checks. No downloads or file deletion in this phase.
- **Phase 3 — retention.** See [`PHASE3.md`](PHASE3.md) for T1–T6: watched-user policy,
  eligibility/protection checks, recoverable reclamation, daily task, admin-only Keep and
  countdown UI. Expiry is automatic unless disabled, including manual task runs. Preserve seed
  goals and distinguish unlinked size from freed disk space. The refinement recommends no STRM
  placeholders. The accepted watched-user setting is All users (default), Selected user, or
  Any user; other proposed defaults are identified in the refinement.
- **Phase 4 — indexers and manual grab.** Torznab (`t=caps` first), release parsing, quality
  profiles, scoring; qBittorrent first. **Do not port Sonarr's or Radarr's parsers — they are GPL-3.0
  and Jellyfin is GPL-2.0-only.** MIT references, or regexes written against their test cases.
  Web: release picker dialog, rejected releases listed with reasons, raw release title always visible.
- **Phase 5 — import pipeline.** Watch the client, hardlink into the library under the version
  naming convention, targeted scan, bind the item id. Honour seed goals. Web: `/catalog/queue`, the
  only new route in the design.
- **Phase 6 — automation and multi-quality.** Scheduled search for monitored entries; upgrade to
  cutoff; enrich the existing version selector with resolution, codec, audio and size.

---

## Open questions — decide before the phase that needs them

1. **STRM placeholders for file-less entries?** UX.md §6.2 recommends no — merge them client-side so
   the wishlist stays out of Kodi and Swiftfin. Needed before W2.
2. **Watched-state policy decided 2026-09-11:** with retention enabled, admins choose All users
   (default), Selected user (account picker), or Any user. See `PHASE3.md` for timer semantics.
3. **Do downloads land on the same filesystem as the library?** Determines whether hardlinks work at
   all. Needed before Phase 5 — and it is a deployment question, not a code one.
4. **Publication name decided by the user, 2026-09-08:** publish as `capische/jellyfin-mod`,
   matching the web fork's account and public visibility. This supersedes the earlier requirement
   to rename before publishing.
