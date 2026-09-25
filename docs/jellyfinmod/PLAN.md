# JellyfinMod — implementation plan

Task list for agents. Each task is self-contained: an agent that has read the **Briefing** below
and its own task entry should be able to finish without asking a question.

**Jellyfin 12 retarget — decided by the user, 2026-09-24.** Asked what the point of supporting an
older Jellyfin was once 12 had shipped, the user chose to drop Jellyfin 10.11 and retarget the
plugin to **Jellyfin 12.0.0 on .NET 10**, as its own task, **before S11**, so that S11 accepts the
build that ships. Every instance (production, isolated test, acceptance) already runs 12.0.0 and the
image is built on 12.0.0 pinned by digest. The plugin now targets `net10.0`, `Jellyfin.Controller`/
`Jellyfin.Model` `12.0.0`, EF Core `10.0.11` and `targetAbi` `12.0.0.0`; 10.11 is no longer supported.
Rationale and what was removed: [README §7.1](README.md#71-confirmed-target-server-1200-on-net-10);
matrix and evidence: [PHASE7 §3.5](PHASE7.md#35-version-and-compatibility-matrix) and the S5 retarget
evidence. Version enumeration through `GetMediaSources` (V1) and episode versions (E7) stay separate
tasks. This supersedes the 10.11.11 pins in P1 below and in open question 15.

**Review issues, 2026-09-24:** see [REVIEW-2026-09-24.md](REVIEW-2026-09-24.md) for the Phase 7
review of the S4 fixes, S5, S7–S10 and the TV shell (no P1, four P2, twelve P3). Worked on
2026-09-24: thirteen are fixed and verified, two are documentation fixes, S4-R5 is disputed with
live evidence, and P7-R2 is partly closed (the Prowlarr grab ran live; the fresh-database wizard, the ordinary-user browser check
and the secret actions in the page are named S11 steps). Each finding carries its commit and
evidence there.

**Review issues, 2026-09-23:** see [REVIEW-2026-09-23.md](REVIEW-2026-09-23.md) for three
Phase 7 S4 takeover bugs (repeated fallback, base URL and interrupted recovery-state write). All
three are fixed and verified in plugin `ce49172`, as that document records.

**Phase 1 refinement, 2026-09-06:** read [`PHASE1.md`](PHASE1.md) before P5/P6 or web tasks.
It records the accepted permissions and Home redesign, corrects the integration assumptions,
and adds technical gates. The Phase 1 tasks below are not independently implementation-ready
until those gates are resolved. Phase 0 is complete; its verification is recorded below.

Two repos, siblings:

```
jellyfin-mod/
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

**Proposed (review 2026-09-18, not user-approved):** treat the docs on the newest phase branch as
authoritative — currently the `jellyfinmod-phase4` line, carried by the review branch until it is
merged — not the copy in an older phase checkout. Older phase branches receive a pointer to that
location (X2). Add a sixth reading item: 6. For review remediation, read
[`REVIEW-2026-09-18.md`](REVIEW-2026-09-18.md) and the Review remediation sections of PHASE1–3
and this file. Changing the workspace `CLAUDE.md` branch rule that sends agents to
`jellyfinmod-phase1` is a user decision (open question 14) (tests-contract#9, medium, verified;
plan-ops#3, medium, single-source).

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
**Accepted 2026-09-20:** reclaiming removes the media file only. The title's folder and every
sidecar (`.nfo`, subtitles, artwork, extras) stay on disk, and empty folders are not tidied.
This is current behaviour, recorded as accepted; no phase plans to change it.

**Proposed safety gate (review 2026-09-18, not user-approved):** Phase 3 is implemented.
Automatic retention stays disabled on non-disposable media until the review blockers T7, T8, T9,
T10 and T18 pass on the isolated test instance; Selected user mode on real media also waits for
T13. This defers enabling retention; it does not change the accepted automatic-expiry decision.
The trigger is re-acquired media being due immediately (plugin-retention-policy#1, critical,
verified) and the enabled cycle never having run on the live host (plan-ops#1, high, verified).
Whether to adopt the gate is open question 5.

### Development conventions

Conventional Commits, lower case, imperative, no trailing full stop. One task per commit where
practical. Web: 4-space indent, TypeScript, `npx tsc --noEmit` and `npx eslint` must both pass.
Plugin: `TreatWarningsAsErrors` is on; XML doc comments are required on public members.

**Proposed (review 2026-09-18, not user-approved):** at each phase start and before each isolated
acceptance, merge `origin/master` into the current phase branch and record the merged master SHA
in the phase evidence. Fixes land on the newest phase line, or on a short-lived branch merged into
it, the same day; older phase branches are frozen after acceptance. See X1 (plan-ops#4, medium,
single-source; plan-ops#3, medium, single-source).

### Definition of done, every task

1. The acceptance check in the task passes.
2. The task's own diff contains no changes outside its stated scope. Preserve unrelated existing
   changes and work by other agents; the entire shared checkout need not be clean.
3. For web tasks: `npx tsc --noEmit -p tsconfig.json` exits 0 and
   `npx eslint src/apps/modern/features/jellyfinmod --ext .ts,.tsx` is silent.
4. For UI tasks: verified at **desktop**, **mobile**, and at **1920×1080 with `localStorage.setItem('layout','tv')`**
   driven by arrow keys only.

**Proposed (review 2026-09-18, not user-approved):** add these items after item 4.

5. Mod SCSS passes the repository `stylelint` gate (static-checks#1, low, single-source).
6. TV checks also cover 1280×720 with Enter and Back, and physical webOS evidence is reported
   separately from TV-layout emulation. Whether one physical webOS run is mandatory to close a
   TV-touching phase is open question 17, not a rule.
7. Evidence records the plugin revision reported by Health (X4) and states which host services
   the automated suites simulate (plan-ops#5, medium, single-source; tests-contract#2, medium,
   verified).
8. Acceptance never relies on hand-seeded database state for behaviour the product is supposed
   to produce (plan-ops#1, high, verified).

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

**Correction (review 2026-09-18):** "deployment-script checks pass" overstates the committed
tooling. The committed `jellyfin-sync` can only restart the production service and defaults its
web directory to production. The `--plugin`/`--test` targeting existed only as uncommitted edits,
and `--plugin` without `--test` targets the production plugin folder. The plugin still reports
`0.1.0.0` through Phase 3, so builds cannot be told apart. See X3 and X4 (plan-ops#2, medium,
verified; plan-ops#5, medium, single-source).

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

**Proposed (review 2026-09-18, not user-approved):** extend this acceptance. `--plugin` implies
the isolated target unless `--production` is given; every production-refusal case exits non-zero
before any remote action; the script prints the plugin commit and dirty state and backs up
`jellyfinmod.db` before the restart. The work is tracked as X3 (plan-ops#2, medium, verified).

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

**Correction (review 2026-09-18):** "Phase 4 onward remain sketches" is stale: Phase 4 has a task
breakdown in [`PHASE4.md`](PHASE4.md) (plan-ops#8, low, single-source). Current status:

- **Acceptance is a gate (user, 2026-09-25):** a phase is done only when its live checklist
  passes; one owner per behaviour.
- Phase 0 — foundation: accepted.
- Phase 1 — catalog: accepted (see [`PHASE1.md`](PHASE1.md)).
- Phase 2 — reconciliation: accepted (18096, 2026-09-15).
- Phase 3 — retention: built (not accepted); the real-window run is shared with Phase 10 and is
  being re-armed on 18096 (see [`PHASE3.md`](PHASE3.md)).
- Phase 4 — indexers and manual grab: built (not accepted); A8 live acceptance runs 2026-09-25/26
  (brief `live-acceptance-p4-p6`) (see [`PHASE4.md`](PHASE4.md)).
- Phase 5 — import: built (not accepted); I3–I9 live acceptance runs 2026-09-25/26. A real-service
  pipeline was proven 2026-09-20 on 28096, except second-version import (owned by V1) (see
  [`PHASE5.md`](PHASE5.md)).
- Phase 6 — automation: built (not accepted); a ~24 h live run of the non-version rows is
  scheduled for 2026-09-26; version rows (M5–M8 version parts, question 5) are owned by V1 (see
  [`PHASE6.md`](PHASE6.md)).
- Phase 7 — setup, admin UI and UI delivery: released as 0.1.0.0 on 2026-09-25
  (`ghcr.io/capische/jellyfin-mod:0.1.0.0` and `:latest`, index
  `sha256:beb3d41c5b00e945c70c5ef852eb3766cc61018e38adbe8ea589bde4371533bd`); S11 accepted
  (re-runs 1–5, Chromium and Chrome); 7.1 Trakt indicator (Q16) in progress; the physical LG C1
  (webOS 6) check is the user's. Work on Phase 7 started before the current product passed live
  acceptance (T18 real-window run, Phase 4 A8, Phase 5/6 live checklists), which was the original
  entry gate; that is now recorded as a process fault which the acceptance-is-a-gate rule above
  (2026-09-25) prevents going forward (see [`PHASE7.md`](PHASE7.md)). [`PARITY.md`](PARITY.md)
  plans the stock `/web` versus mod `/web-mod` parity acceptance (P7.S6); it is a plan, not
  evidence, and has not been run.
- Phase 8 — release attributes and playback evidence: planned, not scheduled (see
  [`PHASE8.md`](PHASE8.md)).
- Phase 9 — ratings: planned, not scheduled (see [`PHASE9.md`](PHASE9.md)).
- Phase 10 — per-media retention: built and merged with retention off (plugin `348168b`, web
  `6b13699fd8`; suites 12/12 on 2026-09-25); the real-window run is pending, so not accepted (see
  [`PHASE10.md`](PHASE10.md)).
- Phase 11 — notifications and the bell: planned, not scheduled (see [`PHASE11.md`](PHASE11.md)).
- Phase 12 — multiple held qualities: planned, not scheduled (moved from Phase 6 on 2026-09-25)
  (see [`PHASE12.md`](PHASE12.md)).
- V1 — versions on Jellyfin 12: next, after 7.1 merges; owner of all version behaviour, and its
  acceptance includes Phase 5/6's version rows (brief `v1-versions.md`).
- webOS performance: postponed by the user until further notice (research in the workspace brief
  `research-webos-targets`).

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
  **Correction (review 2026-09-18):** the task breakdown is [`PHASE4.md`](PHASE4.md). "qBittorrent
  first" conflicts with Phase 3, whose seed protection reads Transmission only; the download
  client is open question 6 (prior-H4c, medium, verified).
  **Accepted 2026-09-20/21 (PHASE4 user decision 7):** on text-only indexers a release matched on
  parsed title and exact year is a manual-grab candidate with `match.identity == "title"`;
  automation takes it only from an indexer with `automateTitleMatches` on (default off). This
  replaces the A1 rule that `q`-only rows are always `identity_unverified`. Implemented on
  plugin `master` (`474bd91`).
- **Phase 5 — import pipeline.** Watch the client, hardlink into the library under the version
  naming convention, targeted scan, bind the item id. Honour seed goals. Web: `/catalog/queue`, the
  only new route in the design.
  **Proposed (review 2026-09-18, not user-approved):** make ownership of the seeding copy explicit.
  After the effective seed goals are met, remove the torrent and its data as a durable operation
  (or through a verified client share-limit action), leaving the library hardlink, and account
  for space freed later separately from a 0-byte reclaim. This is clarification only: the earlier
  claim that no phase owns the seeding copy (prior-H3) was refuted, because README §6 already
  assigns it to Phase 5.
  **Planned (2026-09-19):** [`PHASE5.md`](PHASE5.md) breaks this down into I1–I9, including a
  durable seeding-copy release operation, container path mapping and the queue route. Every default
  there is proposed; entry gates include Phase 4 A8, blockers T7–T10 and T18, open question 3
  (single mount) and open question 6 (download client).
  **Accepted 2026-09-20/21:** live acceptance (A8, I3–I9, M2–M9) runs against real services — a
  separate real Transmission on the same VPN as production's (never the production client), real
  Prowlarr read-only for indexers, one shared mount, production media read-only — recorded under
  PHASE5 *Accepted user decisions — 2026-09-20/21: live acceptance services*.
- **Phase 6 — automation and multi-quality.** Scheduled search for monitored entries; upgrade to
  cutoff; enrich the existing version selector with resolution, codec, audio and size.
  **Planned (2026-09-19):** [`PHASE6.md`](PHASE6.md) breaks this down into M1–M9: scheduled
  searches with backoff, budgets and a kill switch, new-episode acquisition, upgrade-to-cutoff as a
  Phase 3 operation with `upgrade_replaced` provenance, Get another quality, retention per version
  and the D-pad-operable version selector. Every default is proposed; depends on Phase 5 I9.
  Phase 5 and Phase 6 open questions are listed in those documents, not renumbered here.
  **Follow-up moved to Phase 12 (2026-09-25):** [`PHASE12.md`](PHASE12.md) *Phase 12 —
  multiple held qualities (M10–M21)*: an ordered preference ladder with must-have rungs that
  define the copies a title holds, per server/library/title scope, attribute vocabulary with
  confidence, dynamic-range and audio ticks, user-defined string-match rules, per-indexer release
  title grammars, language and subtitle preferences, editable device presets and picker chips.
  Acquisition-side only; retention is unchanged. Its open questions 11–22 are listed there.
- **Phase 7 — setup, admin UI and UI delivery.** Make the product installable and switchable:
  enable the plugin and Jellyfin becomes the new product at `/web`; disable or uninstall it and
  the byte-identical stock interface is back on the same data.
  **Planned (2026-09-20):** [`PHASE7.md`](PHASE7.md) breaks this down into S1–S11. User
  decisions of 2026-09-20 recorded there: full replacement (own shell, navigation, home, browse,
  detail, search and settings, with every other stock screen embedded or reachable), delivery as
  a plugin-served bundle plus the plugin patching the host's `index.html` (swap in place
  preferred, redirect as fallback, File Transformation excluded), a custom Docker image as the
  preferred shape, the `jellyfin-web` fork staying the source of the interface with a separate
  mod entry, an enumerated patch surface and an upstream merge routine, retention keeping media
  folders and sidecars, and fixture hygiene. It also plans the unified admin settings area,
  native Prowlarr support and the first-run wizard. Every other default there is proposed; its
  open questions are listed in that document, not renumbered here.
- **Work queue and model assignment — accepted 2026-09-21.** Run strictly in order, one agent at a
  time, no parallel agents. Stop all work when 10% of the weekly allowance remains and resume at the
  reset.
  1. Deploy the Browse dedup fix to the acceptance instance, re-run the A1 grid gate there, and run
     the full browser suite once on real Google Chrome. Opus, medium. These convert agent claims into
     acceptance evidence and block everything else.
  2. The TV and D-pad shell (Phase 7), which also carries the deferred legacy grid and `hometab.js`
     restores. **Reassigned by the user on 2026-09-24 from Fable to Opus at high effort.** Progress and handover
     in PHASE7 "TV and D-pad shell — handover" and its part 2. **Decided 2026-09-24 (PHASE7 decision 13):** the TV
     browses on the modern React grid; the legacy grid controllers are handed back.
  3. Per-media tracking and retention (below). **Reassigned by the user on 2026-09-24 from Fable to Opus at
     high effort** (design first, then implementation). Design, tasks, open questions and handover in
     [`PHASE10.md`](PHASE10.md).
- **Per-media entries and retention — accepted 2026-09-21.** Verbatim: *"We need control per media
  file no matter it's a movie or episode. Therefore, if I watched episode – remove it, and each media
  should have separate retention."* Entries bind to an individual media file, not only to a series,
  so an episode carries its own retention deadline, its own Keep, and its own versions; series-level
  entries stay as the container. A watched episode becomes eligible for removal on its own schedule
  without touching its siblings. This supersedes the series-level-only binding and answers the
  "unbound episodes" question left open by Phase 7 S6: episode pages get the mod section. Retention
  is the delete path, so design and critical verification run on Opus 5.5 at high effort (**changed
  by the user on 2026-09-24: Fable is no longer used anywhere**), and no reclaim ships without live
  E2E on the isolated instance.
- **Phases 8 and 9 are out of scope for the production release. Accepted 2026-09-21:** the user
  ruled both optional for a real production release and deferred them until after it. Neither
  blocks the release gate, and no release criterion may depend on them. They keep their outlines
  below and are picked up only on an explicit later decision.
- **Phase 8 — release attribute enrichment and playback evidence.** Future, **not scheduled**;
  outline only in [`PHASE8.md`](PHASE8.md) (E1–E12): tracker detail-page reads behind a
  deterministic or optional model-assisted extractor (output treated as untrusted input), post-import
  truth from real media streams including Dolby Vision profiles, a device capability catalogue
  favouring the user's registered devices with device-targeted and plays-everywhere selection,
  and direct-play diagnostics that report rather than re-grab. Depends on Phase 12
  and Phase 7 S8–S9; its open questions are listed there.
- **Phase 9 — ratings and title enrichment.** Future, **not scheduled**; outline only in
  [`PHASE9.md`](PHASE9.md) (R1–R8). **Accepted 2026-09-21:** MDBList is the single ratings
  source (IMDb, TMDB, Trakt, Rotten Tomatoes critic and audience, plus its extra sources as
  optional), the host's OMDb plugin data is a read-only fallback for on-disk titles, and Google
  ratings are dropped. Ratings live in plugin SQLite, the key in the secret store, and a missing
  or failing provider makes ratings absent without touching browsing or playback. Its four open
  questions are listed there.
- **Phase 11 — notifications and the bell.** Future, **not scheduled**; outline only in
  [`PHASE11.md`](PHASE11.md). **Requested 2026-09-24:** a bell in the top bar with an unread badge
  that opens a list of messages, per user, on desktop, mobile and TV. First events: retention windows
  starting (including Trakt-imported watches) and files about to be deleted, then downloads,
  upgrades, indexer failures and interface changes. The user asked for it to be planned, not
  implemented now. Its open questions are listed there.
- **Phase 12 — multiple held qualities.** Future, **not scheduled**; outline in
  [PHASE12.md](PHASE12.md). Moved out of PHASE6.md's follow-up on 2026-09-25. The user wants to
  hold more than one quality on purpose — for example a best-possible version for the living-room
  television and a compatible one for everything else — chosen on attributes a flat quality list
  cannot see. Its open questions 11–22 are listed there.

---

# Cross-cutting remediation — review 2026-09-18

**Proposed (review 2026-09-18, not user-approved):** these tasks come from the consolidated
review, [`REVIEW-2026-09-18.md`](REVIEW-2026-09-18.md), of plugin `81c1aae` and web `c45b7fc588`.
Every item here is a proposal. PHASE4 proposed entry gates 6–9 (Phase 3 blockers, P7, X1, X3,
X4, A9) block Phase 4 deployment. Phase-level tasks live in
the Review remediation sections of [`PHASE1.md`](PHASE1.md), [`PHASE2.md`](PHASE2.md) and
[`PHASE3.md`](PHASE3.md), and in the proposed amendments to [`PHASE4.md`](PHASE4.md). The
blocker set across the plan is P7, T7, T8, T9, T10, T18, X1 and X3. T13 and X4 are on the
blocker path through T18 (and X4 through PHASE4 gate 8). Acceptance uses the
repository boundaries only: real-host integration on the isolated test instance (port 18096),
with real HTTP, Jellyfin authentication and authorization, serialization, migrations and SQLite;
and built-browser E2E there on desktop, mobile and TV layout at 1920×1080 and 1280×720, driven by
arrow keys, Enter and Back, signed in as `oleksii` with an empty password. No unit tests.

## X1 · Integrate branches: carry fixes forward and merge production master
**Repo** plugin, jellyfin-web · **Depends on** nothing · **Priority** blocker ·
**Findings** plan-ops#3 (medium, single-source), plan-ops#4 (medium, single-source)

Fixes have landed on `jellyfinmod-phase1` without reaching the newer phase lines: plugin commit
`fba11e3` (access batching, search folding, partial metadata) is absent from phase2, phase3 and
`jellyfinmod-phase4`, and its port is P7. Production's `origin/master` carries two fixes no phase
branch has — `ff89608a6c` (asset retention for resident TV clients in `jellyfin-sync`) and
`b72ac53721` (Home progress refresh in `QueryClientEventHandler`) — and the mod rewrote the same
`QueryClientEventHandler` lines. Port every unported fix onto the phase4 line and merge
`origin/master` into the phase4 web line, resolving `QueryClientEventHandler` semantically: keep
production's `['User', id]` refresh together with the mod's debounced catalog invalidation. The
workspace `CLAUDE.md` rule "keep existing Phase 1 web work on `jellyfinmod-phase1`" can be changed
only by the user (open question 14); until then, record where each fix lands. Commit as, for
example, `chore(branches,x1): merge production master into phase4`.

**Acceptance** In both repos, every commit that `git cherry jellyfinmod-phase4 <older phase
branch>` marks `+` is either patch-identical on the phase4 line or named in a port commit there
(a `(cherry picked from commit …)` or `Ported-from:` trailer); adapted ports have new patch-ids,
so `git cherry` alone cannot show them as ported. The evidence records the list of mappings. `origin/master` is merged into the phase4 web line with
`QueryClientEventHandler` resolved as above, and the merged master SHA is recorded. On the
isolated test instance, production's `b72ac53721` behaviour survives the merge: after an episode
is marked played in the built browser (desktop, mobile and TV layouts), the native `['User', id]`
queries refetch (network log) and the mod's catalog invalidation still fires. The full Home and
Continue Watching row check belongs to W10, which depends on X1.
A resident webOS TV surviving a redeploy with `ff89608a6c` asset retention is physical evidence,
reported separately from emulation.

## X2 · Name one authoritative docs location and verify recorded push evidence
**Repo** jellyfin-web · **Depends on** X1 · **Priority** high ·
**Findings** tests-contract#9 (medium, verified)

The main `jellyfin-web` checkout, where the workspace rules send agents, is on
`jellyfinmod-phase1`, whose docs lack the Phase 2 final acceptance, the Phase 3 checkpoints and
the retention API contract. PHASE3 T6 records the evidence commits as pushed, and local tracking
refs suggested the branches were ahead of origin, but those refs were stale: a read-only
`git ls-remote` during the review showed `jellyfinmod-phase3` at `81c1aae` and
`jellyfinmod-phase3-web` at `c45b7fc588` on origin; X2 records the formal confirmation. Name the authoritative
docs branch in the Briefing, verify the push record, and leave pointers on older branches.
Commit as, for example, `docs(plan,x2): name authoritative docs branch`.

**Acceptance**
- The Briefing names the authoritative docs branch.
- `git ls-remote origin` in both repos confirms that plugin `81c1aae` and web `c45b7fc588` (and
  the T6 evidence commits) are on origin, or they are pushed.
- The PHASE3 T6 correction note records the result.
- Older phase branches' docs carry a pointer; this is a separate task on those branches.

## X3 · Make `jellyfin-sync` safe by default for mod work
**Repo** jellyfin-web · **Depends on** X1 · **Priority** blocker ·
**Findings** plan-ops#2 (medium, verified), plan-ops#4 (medium, single-source)

The committed script targets production by default and can restart only the production service;
plugin and test targeting existed only as uncommitted edits, where `--plugin` without `--test`
selects the production plugin folder. No database backup precedes the restart that applies
migrations, and the plugin path prints no commit. Make the isolated target the default for mod
work and fail closed. Host-specific values stay in the ignored `jellyfin-sync.env`. Commit as,
for example, `chore(deploy,x3): default mod deploys to the isolated target`.

**Acceptance** committed on the trunk line:
- `--plugin` implies the isolated target unless `--production` is given.
- `--local` on a `jellyfinmod-*` branch refuses without `--test`.
- The script prints the plugin commit and dirty state, and refuses a dirty tree without
  `--allow-dirty`.
- It copies `jellyfinmod.db` to a timestamped backup inside the isolated state directory before
  the restart.
- Host mode refuses when its compose file is absent.
- Every refusal path exits non-zero before any ssh, rsync or restart, shown by trace output.
- An isolated deploy to `jellyfinmod-test` (port 18096) passes the startup-log, Dashboard plugin
  page, authenticated Health and database-persistence checks. Production is never contacted.

## X4 · Identify and downgrade-guard deployed plugin builds
**Repo** plugin, jellyfin-web · **Depends on** nothing · **Priority** high ·
**Findings** plan-ops#5 (medium, single-source)

The plugin reports `0.1.0.0` through ten migrations and three phases, Health returns only name,
version and `Ok`, and an older build starts `Ok` on a newer schema because EF ignores unknown
applied migrations. Evidence ties builds to DLL SHA-256 values from staged copies with no commit.
Bump the version per phase, embed the commit, extend Health, and refuse to become ready on a
database that holds unknown migrations. PHASE4 A7's capability gating and W14 consume the Health
fields. Commit as, for example, `feat(health,x4): report revision and capabilities`.

**Acceptance**
- The plugin version is bumped per phase (0.3.x for Phase 3, 0.4.x for Phase 4) with
  `build.yaml` changelog entries.
- `GET /JellyfinMod/Health` returns `revision`, `lastMigration` and `capabilities`, asserted
  through the built web client on the isolated test instance.
- Starting an older build against a copy of the isolated database that holds newer migrations
  leaves `IsReady` false (Health 503, no task registration); the database is then restored.
- Builds come from a git worktree, and the commit is recorded in evidence.

## X5 · Provide one run script, real-host integration coverage and CI for the plugin suites
**Repo** plugin · **Depends on** nothing · **Priority** high ·
**Findings** prior-L5 (low, verified), tests-contract#2 (medium, verified)

The five integration executables have no single runner, the plugin README documents no Phase 3
commands, and no CI runs them. The suites replace Jellyfin host services and authentication with
`DispatchProxy` stubs, so they are supporting evidence only, and the T6 wording overstates them.
The live T1, T3 and T6 runs did exercise the real host, but not repeatably. Add a runner, CI for
the stub-based suites, and repeatable real-host suites for the retention and browse contracts.
An ephemeral disposable Jellyfin container would conflict with the rule that all E2E runs on
`jellyfinmod-test`, so it waits for a user decision (open question 15). Commit as, for example,
`test(integration,x5): add a single suite runner`.

**Acceptance**
- One script runs every plugin integration executable and fails on the first non-zero exit.
- The plugin README documents the Phase 3 commands.
- Retention and browse contracts have repeatable real-host suites against the isolated test
  instance: real Jellyfin authentication, users, and played and favourite state driven through
  the Jellyfin API. The ephemeral-container harness is added only if the user approves it.
- A CI job runs the stub-based suites on phase branches, on ARM64 where `statx` matters.
- Evidence text states which host services were simulated.

## X6 · Keep LAN addresses and local paths out of committed docs
**Repo** jellyfin-web · **Depends on** nothing · **Priority** medium ·
**Findings** critic-invariants#5 (low, single-source)

Acceptance write-ups committed and pushed the test host's LAN URL, the isolated state directory's
absolute paths and a local workspace path, which the workspace rules forbid. The review branch
redacts the current docs; keep them clean with a guard. Scrubbing already published history is a
separate user decision (open question 16). Commit as, for example,
`chore(docs,x6): guard docs against local addresses`.

**Acceptance**
- A grep of `docs/` on the trunk line finds no private IPv4 address and no absolute Linux or
  macOS home-directory path.
- A pre-commit or CI grep guard exists and rejects a test commit that contains one.
- Published-history scrubbing happens only after explicit user authorization, using
  force-with-lease with verified remote tips.

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

The following are **Open question for the user (review 2026-09-18):** items raised by
[`REVIEW-2026-09-18.md`](REVIEW-2026-09-18.md). None is decided; each names the task that
consumes the answer. Accepted decisions above and in the phase documents stay unchanged.

5. **Safety gate.** Should automatic retention stay disabled on non-disposable media until
   blockers T7, T8, T9, T10 and T18 pass (plus T13 for Selected user mode)? This is a proposal;
   the accepted automatic-expiry decision is unchanged (plan-ops#1, high, verified;
   plugin-retention-policy#1, critical, verified). Consumed by T18 and the PHASE3 safety gate.
6. **Download client for Phase 4.** A Transmission write driver (matches the deployed client and
   the existing read adapter), qBittorrent with a new qBittorrent read adapter, or both? The
   answer changes A1, A5, A6, A9 and T17 (prior-H4c, medium, verified).
7. **Mistaken grabs before the Phase 5 queue exists.** Keep one Enter with no confirmation, add a
   short server-side cancellable hold with `POST /Grabs/{id}/Cancel`, or require a second Enter
   on TV and mobile? Consumed by PHASE4 A7 and A8 (plan-ops#6, medium, single-source).
8. **All users eligible set.** All users is accepted as the default. Should it keep counting
   every user with library access, even though users blocked by parental rating or tags then
   prevent reclamation forever, or count only users who can actually see the item? Should All
   users remain the default? Consumed by T11 (plugin-retention-policy#5, medium, single-source).
9. **Quarantine or soft delete.** Add a quarantine step before the physical unlink
   (same-filesystem rename, delayed purge, exact attribution after a crash), or keep direct
   unlink, where a missing prepared file ends in a terminal "vanished" state? Consumed by T9 and
   T12 (plugin-retention-safety#3, medium, single-source).
10. **Entry Remove when native bindings exist.** Refuse with 409, keep a tombstone that preserves
    Keep and policy so reconciliation does not recreate a bare entry, or keep the current hard
    delete? Consumed by T10 (plugin-reconciliation-data#1, medium, verified).
11. **Grace semantics.** Should a transient block (another user's brief playback, a favourite
    toggle, a new user, access errors) preserve the existing grace start instead of restarting
    the full window? Consumed by T11 (plugin-retention-policy#9, low, single-source).
12. **Favourite seasons.** Should favourite seasons protect their episodes, as favourite series
    already do? Consumed by T11.
13. **Keep reversal.** Add an admin un-Keep and a per-entry days editor? Keep would still be one
    action with no confirmation. Consumed by T13 (prior-M9, low, verified).
14. **Branch rule.** Replace the workspace `CLAUDE.md` rule "keep existing Phase 1 web work on
    `jellyfinmod-phase1`" with "the newest phase branch is trunk; older phase branches are frozen
    after acceptance", and switch both main checkouts to it? Only the user can change
    `CLAUDE.md`. Consumed by X1 and X2 (plan-ops#3, medium, single-source).
15. **Test harness.** May an ephemeral disposable Jellyfin 10.11.11 container (CI or local,
    ephemeral port) serve as an additional integration boundary, or must all host-level tests
    stay on `jellyfinmod-test` (port 18096)? Consumed by X5 (tests-contract#2, medium, verified).
16. **Published history.** Scrub the LAN IP and local paths already pushed to origin? This needs
    an explicit force-push authorization under the history-rewrite rule. Consumed by X6
    (critic-invariants#5, low, single-source).
17. **Physical webOS.** Which TV model and webOS/Chromium version is the target? The answer
    decides W11's severity. Must one physical webOS run be mandatory to close any phase that
    touches TV UI? Consumed by W11 and Definition of done item 6 (critic-gaps#3, high, verified;
    web-home-rules-tv#8, low, verified).
18. **Phase 4 indexer evidence.** Is any real indexer allowed for read-only capability queries,
    and which one, or should A1 rely only on the Torznab boundary server? Where do its keys live
    (proposed: the ignored `plugin/.env`)? Consumed by A9 and A1 (plan-ops#7, low, single-source).
19. **Existence oracle.** After P11 equalises the 404, accept the residual leak (discovery offers
    titles that exist but are hidden from the user) as a documented limitation? Consumed by P11
    (plugin-authz-entries#7, low, verified).
20. **API keys.** Should user-scoped mod endpoints reject API keys with 401, or should admin
    automation get a defined API-key contract? Consumed by P11 (plugin-authz-entries#6, low,
    verified).
21. **Overlapping libraries.** When libraries share a path, should each library get its own
    entry and binding for the same native item, or should one library own it with the overlap
    documented? Consumed by R7 (plugin-reconciliation-data#3, high, verified).
