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

**Decision (user, 2026-10-07), owned by P7.S6:** the hero is what the user is in the middle of — the first item of the
merged Continue watching list, from the feeds the user's Home settings show, with the series backdrop and the episode
line for an episode, Play resuming that item — and only when nothing is in progress the newest title; its height
follows the window width. **Released** 2026-10-09 as 0.1.0.0, index
`sha256:73e5fb87ec5e56103795a3e070bfe7b30b2aa93309e229cdacef4b8c9e934d00` (web bundle `d3efe2e4444e`), and again on
2026-10-10, index `sha256:041c81fa3432b326d30491eb8d1da1476a98a6ef8d4a35d1be52842fe08dcfef` (web bundle `63b3d9261349`),
which puts the frosted bar on every page with a fade; rules and
evidence in [`PHASE7.md`](PHASE7.md) §S6, *The hero is what you are in the middle of*, *Home hero and frosted top bar,
republished* and *Top bar on every page with a fade, republished*.
**Decision (user, 2026-10-08), same owner:** Next Up is ordered by when the user last watched the show (the newest play
of any of its episodes, else when the episode was added), in the row and therefore in the hero; recorded in UX §7.3,
evidence in [`PHASE7.md`](PHASE7.md) §S6. Released with the hero.
**Decision (user, 2026-10-09), same owner:** the scrolled Home top bar is see-through frosted glass on computer and phone
(values in `homeChrome.scss`, design notes in `design/topbar-glass-readability.md`), transparent on TV. **Released** with the hero.

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
- Phase 3 — retention: accepted; the real-window run RW passed on 18096 on 2026-09-27, shared with
  Phase 10 (see [`PHASE3.md`](PHASE3.md) and [`PHASE10.md`](PHASE10.md)).
- Phase 4 — indexers and manual grab: accepted (live acceptance 2026-09-26/28, brief
  `live-acceptance-p4-p6`, evidence in [`evidence/live-p4-p6/`](evidence/live-p4-p6/README.md)),
  apart from the version rows, which are deferred to V1 (see [`PHASE4.md`](PHASE4.md)). Two rows
  stay NOT VERIFIED live and are covered by the suite instead: the old-plugin fallback (the X4
  guard refuses an older build against this database) and the kill after remote accept, before
  local commit (`PhaseFourIntegration`).
- Phase 5 — import: accepted (live acceptance 2026-09-26/28; a real-service pipeline was also
  proven 2026-09-20 on 28096); its version rows (second-version import, checklist 6 and I9 case 3)
  were accepted through V1 row 14 on 2026-09-28 (see [`PHASE5.md`](PHASE5.md) and [`V1.md`](V1.md)).
- Phase 6 — automation: accepted without exceptions on 2026-09-28 (live acceptance 2026-09-26/28;
  its version rows, M5–M8 version parts and questions 5 and 7, through V1 rows 14–21) (see
  [`PHASE6.md`](PHASE6.md) and [`V1.md`](V1.md)).
- Phase 7 — setup, admin UI and UI delivery, with 7.1 (the Trakt indicator, Q16): released as
  0.1.0.0, republished on 2026-10-03 with the whole-review fixes (the user's decision to keep 0.1.0.0):
  `ghcr.io/capische/jellyfin-mod:0.1.0.0` and `:latest`, index
  `sha256:b9703e07c4521c21ee56d7957b6d35232552bc91887628d3821c0ef7b98f6a82`, from plugin `abeffb7`
  and web `1924001186` (bundle `a8d28bf5c349`); on 2026-09-28 with V1:
  `sha256:00f309cd687dd0afc751d40fafb4b607eaaab94ab36de2554588410395454fe4`, from plugin `a48f857`
  and web `f88ad4884b` (bundle `b2255a8438fc`); earlier the same day
  `sha256:dd0949337f166f9d52b14122ddbf3ca4ed95b5f335a0f343ff9ac94103394f89` (plugin `8d3c6c0`, web
  `d9718b3788`, bundle `76d08b85c7eb`); the first index was
  `sha256:beb3d41c5b00e945c70c5ef852eb3766cc61018e38adbe8ea589bde4371533bd`. S11 accepted (re-runs
  1–5, Chromium and Chrome); the physical LG C1 (webOS 6) check is the user's. Work on Phase 7
  started before the current product passed live acceptance (T18 real-window run, Phase 4 A8,
  Phase 5/6 live checklists), which was the original entry gate; that is now recorded as a process
  fault which the acceptance-is-a-gate rule above (2026-09-25) prevents going forward (see
  [`PHASE7.md`](PHASE7.md), *Release 0.1.0.0*). [`PARITY.md`](PARITY.md) plans the stock `/web`
  versus mod `/web-mod` parity acceptance (P7.S6); it is a plan, not evidence, and has not been run.
- Phase 8 — release attributes and playback evidence: planned, not scheduled (see
  [`PHASE8.md`](PHASE8.md)).
- Phase 9 — ratings: planned, not scheduled (see [`PHASE9.md`](PHASE9.md)).
- Phase 10 — per-media retention: accepted; the real-window run RW passed on 2026-09-27, merged
  with retention off at plugin `11f0a67` (web bundle `9d30aba7e9b3`); suites 12/12 on 2026-09-25.
  Retention stays off on real media until the user decides otherwise (see
  [`PHASE10.md`](PHASE10.md)).
- Phase 11 — notifications and the bell: planned, not scheduled (see [`PHASE11.md`](PHASE11.md)).
- Phase 12 — multiple held qualities: planned, not scheduled (moved from Phase 6 on 2026-09-25)
  (see [`PHASE12.md`](PHASE12.md)).
- Phase 13 — offline episode watches to Trakt: planned, not scheduled (requested 2026-10-07;
  see [`PHASE13.md`](PHASE13.md)). Owns outgoing episode recovery; Phase 7 Q16 keeps incoming
  history observations. Implementation requires connection and single-writer design refinement.
- **Planned new feature (user, 2026-10-12, to start after the current detail-page, picker and episode-list work): download the first episode and the next unwatched episode first, and import each episode as soon as it finishes.** For a season or series pack (or several torrents), the torrent client is told to download the files of the first episode and the person's next unwatched episode (per Jellyfin watch state, kept current as episodes are watched) with high priority, and the import (Phase 5) takes a finished file straight away instead of waiting for the whole torrent, so the person can start watching while the rest downloads. Owners to name when it is designed: Phase 4 (grab handoff, torrent file priority through the client) and Phase 5 (per-file import while a torrent is incomplete, its seed and hardlink rules), with Phase 6's queue states. Needs a design pass (client capabilities: Transmission file priority and sequential download; partial-pack import safety; what retention does with files still seeding); not started.
- Phase 1 follow-up, **built (not accepted) (user, 2026-10-12): the full season and episode list for a library-discovered series.**
  Phase 1 (accepted 2026-09-06) tracks every TMDB season and episode, aired or not, but only for a series added through TMDB;
  a series that reconciliation discovered in the library has no TMDB list (see [`PHASE10.md`](PHASE10.md), *Why episodes are
  unbound*), so the release picker's scope list and the series page show no seasons or episodes that are not on disk. This was
  not planned from the start. Phase 1 owns the behaviour (episode records, TMDB season and episode metadata, Refresh); the
  picker only reads it. Slice: the plugin reads the TMDB season and episode list for any series entry, kept per Phase 10's
  position-identity rules, and the picker shows every season and episode with downloaded, missing and unaired marked.
  Design: [`design/p1-full-episode-list.md`](design/p1-full-episode-list.md). Built 2026-10-12: plugin `next-release`
  `1016350..e355db3` (p1.fu1–4: new rows follow the series' monitoring, `episodes_listed` and `episodeListLoaded`, the
  smoke cases, one TMDB request for a series' seasons) and web p1.fu5–7 (the picker and the file-less series page load the
  list once per page visit). Plugin suites pass; not deployed, no live first look yet, no Codex review yet.
  **P1.FU9–10, built (not accepted) 2026-10-12** (user: any user loads the list; a series picker offers seasons only):
  plugin `feat/episode-list-on-open` `e355db3..bf2d471` (`POST /Entries/{id}/EpisodeList` for anyone who may read the
  entry, one shared load, Phase 1 smoke cases) and web `feat/episode-list-on-open` from `76400aac37` (opening a series or
  season page loads the list once per visit for every user; the series picker lists All Seasons and each season;
  full-episode-list.mjs). Mac suites pass; not deployed, no live first look yet, no Codex review yet.
- Release picker, the added row and the release page link (WR, design approved by the user 2026-10-12): **built (not
  accepted)**. The grabbed row keeps its two action slots (falling arrow, then a green tick; a red X that cancels during the
  hold and afterwards removes the torrent from the queue after a question, administrators only), shows its download from the
  queue (an amber bar and `42% · 12 min left`, stalled, Importing…, Failed; imported, it reads as in the library), and comes
  back when the picker reopens; the grab block has no Cancel. The indexer name links to the release's page on the tracker
  (plugin `detailsUrl` from Torznab `comments`, else an http `guid`, never one with a credential); Open Transmission sits
  in the title row. Owner: Phase 4 (picker, candidate contract) with Phase 5's queue as the progress source. Built on
  `next-release`: plugin `bf2d471..8d468e5` (Phase 4, 5, 6 and 7 Prowlarr suites pass in the Linux container) and web
  `8b0bafae08..9947e2337e`; described in [UX.md](UX.md) §9.1. Layout checked in Chromium and Chrome against local env
  bravo with intercepted picker answers (not E2E); not deployed, no live first look yet, no Codex review yet.
  **P1.FU11, built (not accepted) 2026-10-12: every season and episode on the native pages** (user-approved design,
  version 9 of the sheet; UX §3.1 and §7.2.1): web `feat/missing-seasons-episodes` from `8b0bafae08`. The series page shows
  a mod card for each plugin season with no Jellyfin season item, in season order among upstream's cards; the season page a
  mod row for each plugin episode with no Jellyfin episode, in episode order; a missing season opens the mod's season page
  (`#/details?entryId=…&season=N`). Every mark moves top-right, on disk shows nothing, the amber Not Downloaded is an
  administrator's button opening the picker in its scope (season, episode, movie, series) and an indicator for others, and
  Unaired is the clock with the short air date. Runner `missing-seasons-episodes.mjs`; `tv-shell.mjs` no longer requires a
  mark on a grid. Typecheck, lint and the production build pass; not deployed, no live first look yet, no Codex review yet.
  The downloading states (P4.FU1), the card hover Get a Release and the Shuffle change (P1.FU12) followed.
  **P4.FU1, built (not accepted) 2026-10-12: downloads on cards and rows** (the downloading part of the same approved sheet,
  version 9 with the card corrections; [UX.md](UX.md) §3.1 and §3.3): web `next-release` `fc404fdf44..4d018f3689` (code and
  runners; docs in the commit after). Every card (library grids, Home rows, search, Continue Watching and Next Up, season cards,
  the mod's file-less and missing-season cards) shows a title, season or episode on its way: a 0.24em amber bar at the poster's
  bottom with the watched part in the primary on top, the white arrow inside upstream's count pill or the amber arrow in the dark
  disc, the mean of a series' or season's episodes; every season-page and list row the bar along its bottom edge and the figure
  at its end (Queued, `42% · 12 min left`, stalled, Importing…, Failed; the arrows, the row bar and the row figure are superseded
  by P4.FU6's ring family, 2026-10-13). One queue read per page, every 5 s only while something
  on the page downloads; one component (`integration/downloadMarks.tsx`) draws them all, with the picker's added-row mapping
  and colours now shared. The in-flight ring and grabbed icon leave `FileStateMark`. Owner: Phase 4 follow-up, with Phase 5's
  queue as the source; no plugin change. Typecheck, lint and the production build pass; a static render of the built CSS was
  checked; not deployed, no live first look yet (runner `card-progress.mjs`, intercepted queue answers), no Codex review yet.
  The card hover Get a Release and the Shuffle change are P1.FU12 below. First look on 28096 (2026-10-12, Chromium,
  intercepted queue answers): `card-progress.mjs` 15/17 desktop and 32/34 mobile and TV against the deployed `f7c95ac4b5`;
  the failures were a file-less series' native card (fixed in `eb73bfdcae`) and the phone row figure (fixed in `67262ac880`),
  both waiting for a redeploy of the `af3b40f6ea`-or-later build.
  **P1.FU12, built (not accepted) 2026-10-12: Get a Release on cards and Shuffle only where it makes sense** (the last two
  parts of the same approved sheet, section 2 unchanged; [UX.md](UX.md) §5.7 and §1.1 exception 3): web `next-release` from
  `5558d99092`. Administrators get the cloud icon in a card's hover overlay after Favorite (movie, series, season, episode;
  series and seasons with pack search; only titles the plugin has an entry for), *Get Another Quality* on a movie or episode on
  disk, and the same item in the card's menu (overlay More, right-click, TV Menu key); it opens the picker in the card's scope.
  The header Shuffle stays only on shows whose genres are comedy, animation, reality, talk, game, documentary, kids or news;
  elsewhere it is hidden and offered in the More menu, which presses the hidden button. `moreMenuItem.ts` now holds several page
  items and card items. Runner `card-get-shuffle.mjs`. Typecheck, lint, stylelint and the production build pass; the runner
  passed 55/55 in Chromium on desktop, phone and TV against 28096 with the local build served in place of the instance's (not
  acceptance); not deployed, no live first look yet, no Codex review yet. Not verified: an ordinary user (no user with an empty
  password on 28096); the phone's card menu (upstream draws no More on the phone's grids and season cards).
  **P1.FU13, built (not accepted) 2026-10-12: the TMDB token is optional** (user 2026-10-12: "build it ... and update TMDb
  settings page with note - optional"). Owner: Phase 1 (discovery), with the settings copy from P7.S7. With no token saved,
  discovery, Add, Refresh and the episode-list load go through Jellyfin's own `TmdbClientManager` (bound by name to Jellyfin
  12.0.0's signatures; TMDbLib 3.0.0 compiled against, the host's copy used); a saved token still wins; 503 only with neither.
  Settings name the source ("Using Jellyfin's TMDb connection" / "Using your token"), the note reads "Leave empty to
  use Jellyfin's built-in TMDb connection." (the field label carries "(Optional)"), the setup's Discovery step is done without a token, and
  `Discovery/Test?source=jellyfin` is a read-only diagnostic ([API.md](API.md) *Discovery*). Limits: one search page, no TMDB
  status on failures (a missing title is 404), one request per season, the manager's hour cache. Plugin `next-release`
  `8d468e5..f5f5108`, web `521a391b1b..1079219ff0` (code and runner) and the docs commit after. Mac suites (Phase 0, 1, 2, 3,
  10, Q16) and Linux suites (Phase 3 protection, 4, 5, 6, 7 settings, Prowlarr, takeover) pass; typecheck, lint and the
  production build pass. Outside a host, the built plugin in a copy of Jellyfin 12's plugin load context against the host
  assemblies of local env alpha read Breaking Bad, Peaky Blinders (60 episodes), 1923, The Simpsons (39 seasons, 888 episodes)
  and The Matrix from real TMDB. Not deployed; live check `tmdb-via-jellyfin.mjs` on 28096 pending; no Codex review yet.
  **P1.FU14, built (not accepted) 2026-10-12: missing seasons and episodes look like ones that exist** (user 2026-10-12:
  "For TMDb import - I see no covers, those must be imported too with all descriptions and related information - exact like
  when episode exists"; [UX.md](UX.md) §7.2.1, [API.md](API.md) *Season overviews and episode ratings*). Owner: Phase 1
  (episode records and TMDB metadata), the P1.FU11 cards and rows only draw it. Finding: the plugin already stored and
  returned every episode's still, overview, runtime and air date and every season's poster (all 112 missing episodes of
  The Wheel of Time, 1923 and Peaky Blinders on 28096 had them, by either TMDB source); the web drew none of it. Built: the
  season card shows TMDB's season poster (w342), each missing episode row its still (w300, w500 on the TV), "N. Title",
  the meta line in upstream's items (air date, runtime as upstream formats it, TMDB's rating with upstream's star) and the
  overview; the mod's season page the season's overview and first air year. Lazy images that fall back to the dashed
  placeholder when absent or failing. The plugin now keeps each season's overview and TMDB's episode ratings in the series'
  metadata (no column, no migration); a series loaded before has none, and opening it loads its list once more (the P1.FU9
  load); the administrator's Refresh does the same. Not built: cast, guest stars and crew for a missing episode (needs a
  column or table and a page to show them). Plugin `next-release` `f5f5108..410b380`, web `next-release` `6a6d71562b` (code) and
  `7402853b1c` (runner), and the docs commit after. Mac suites (Phase 0, 1, 2, 3, 10) and Linux suites (Phase 1, 4, 5, 6) pass; typecheck,
  lint, stylelint and the production build pass. Not deployed; live check `missing-seasons-episodes.mjs` on 28096 pending;
  no Codex review yet.
  **P1.FU15, built (not accepted) 2026-10-12: cast, guest stars and crew for a missing episode, on its own page** (user
  2026-10-12: "yes, go ahead and implement this part too. it should be identical to what downloaded have."; [UX.md](UX.md)
  §7.2.1, [API.md](API.md) *Cast, guest stars and crew*). Owner: Phase 1 (episode records and TMDB metadata); the P1.FU11 rows
  open the page. Plugin: each episode keeps TMDB's guest stars and crew as Jellyfin 12.0's TMDB episode provider keeps them
  (15 guest stars by order; directors, writers by writer, screenplay or novel, producers, 15 at most) in the new nullable
  `Episodes.CreditsJson` column (migration `20261012095715_EpisodeCredits`, forward-only, one added column, no table rebuild;
  it applied cleanly to a copy of 28096's database at `SeasonPacks`), returned as `credits` on every episode (null: not loaded;
  empty lists: none); the series keeps its regular cast (TMDB's series `credits`, 15 at most) as `cast` in its metadata, read by
  appending `credits` to the details request it already makes, or through Jellyfin's TMDb connection. A series loaded before
  has no `cast` and loads its list once more on opening (the P1.FU14 pattern). Web: the missing episode's row (mod and native
  season pages) opens `#/details?entryId=…&season=N&episode=M` (on the TV the row is now a stop, Right reaches its icon); the
  page is upstream's episode layout with the plugin's data, person cards without links. Differences from a downloaded
  episode's page: no file actions or media info; the regulars are the series' current ones, not the episode's own cast; names
  link nowhere. Plugin `next-release` `410b380..4f92ecb` (code, migration and suites), web `next-release` `13c08e411a` (code) and
  `7e7f59fd9f` (runner), and the docs commit after. Mac suites (Phase 0, 1 with the old-schema upgrade and the credits checks)
  and all 14 suites (Mac and Linux, Phase 10 after writing its old-schema episode as that schema had it) pass; typecheck, lint, stylelint and the production build pass; the runner passed in
  Chromium (456 checks) and Chrome on desktop, phone and TV against local environment alpha with both builds; the Jellyfin
  TMDb path was read against real TMDB outside a host. Not deployed to a Pi instance; no ordinary-user run (no user with an
  empty password); no Codex review yet.
  **P4.FU5, built (not accepted) 2026-10-12: each pack episode shows its own download** (user 2026-10-12: "Is there way to
  show per episode progress if the whole season or all seasons are downloading?"; the web part of the next-up priority design,
  [design/next-up-priority-download.md](design/next-up-priority-download.md) §7; [UX.md](UX.md) §3.3, [API.md](API.md) *Queue*).
  Owner: Phase 4 follow-up, with Phase 5's queue (P5.FU3) as the source. An episode's row, card and detail line take its own
  file of a pack from `pack.episodes` (its percent and bar, *Queued* before it starts, *Importing…* once its file is finished or
  being imported, *Failed · reason* for its own import, its time left as its remaining bytes at the pack's rate); season and
  series cards keep one bar for the pack; the approved row format is unchanged, so no mockup. Plugin: `sizeBytes` on each pack
  episode (the file's length) and the fix that `DownloadOrderService` sends `queue-move-top` only when a queued single-episode
  torrent is not already first (it asked on every 15 s tick; `queuePosition` is now read). Plugin `feat/pack-episode-progress`
  from `1f716df` (`db24c49` the queue-move-top fix, `618efb7` `sizeBytes`), web `feat/pack-episode-progress` from `9d50a4a81c` (`4e4eece7cb` code, `2b260b64f9` runner,
  and the docs commit). All 13 plugin suites pass on the merged tree with both commits (Mac: Phase 0 and 1 smoke, 2, 3, 10, Q16 Trakt; Linux container: Phase 3 protection, 4, 5, 6, 7 settings, Prowlarr, takeover), the first run of `1f716df`'s two merged lines together. Typecheck, eslint, stylelint and the production build pass; `card-progress.mjs` (a pack
  with episodes at different progress, intercepted queue answers, not a live download) passed 66/66 with 3 not verified (no
  file-less entry) in Chromium and Chrome on desktop, phone and TV 1080 against local environment bravo with both builds. Not
  deployed to a Pi instance; no live first look yet; no Codex review yet. Open for the user: a pack episode's own long
  *Failed · reason* figure (P4.FU1's failed row, now reached by pack episodes) squeezes the row's text to a narrow column on
  the TV.
  **P1.FU16, built (not accepted) 2026-10-12: missing seasons, episodes and Get a Release without waiting** (user, testing
  28096: "the rest must be immediately"). Owner: Phase 1 (the P1.FU11 cards and rows, the header icon). Cause: the native
  page read its entry only after its own item read, in two sequential plugin requests (lookup, then detail), then Jellyfin's
  seasons or episodes, and kept it per page item, so a season page never reused its series' entry and every revisit waited
  for the item read; a first list load also refetched the entry after the POST that answers it. Fix (web only): the route
  starts the entry reads at once and the native children as soon as the item type is known; the entry is kept by entry id
  (shared by the series, its seasons and the mod's season and episode pages, refreshed in the background); a known item is not
  waited for (a 404 still takes the page over); the list load's answer is drawn directly. Web `fix/instant-missing-children`
  from `0f174f8f17`. Measured (Chromium, medians of three fresh contexts, ms after navigation, local build over 28096's data):
  season page after its series 252–290 → 149–151 (rows) and 208–258 → 34–37 (icon), series cards 349 → 260, the mod's season
  page 74 → 41, revisits 83–114 → 29–35; a first TMDB load draws its cards when the POST ends (alpha 2473 → 1177). Left: a
  series' first visit still waits for the plugin's own lookup and detail (on the Pi up to about 130 + 260 ms server time for a
  series with files, Peep Show). `missing-seasons-episodes.mjs` passed on alpha (456 checks, desktop, phone, TV; ordinary user
  nata 293). Not deployed to a Pi instance; no real-Chrome pass; no Codex review yet. Items 2 and 3 of the same report (the
  Not Downloaded mark on a watched season with no files, and its glyph) wait for the user's choice on
  [`design/not-downloaded-mark.html`](design/not-downloaded-mark.html).
  **P1.FU17, built (not accepted) 2026-10-12: the Not Downloaded mark's cloud glyph, on watched seasons with no file, and
  downloads on upstream's season cards** (user 2026-10-12: "A, option 1" on
  [`design/not-downloaded-mark.html`](design/not-downloaded-mark.html); then, testing 28096: "I expect if you see downloading
  and drill down you see what and where it downloads"; [UX.md](UX.md) §3.1, §3.3, §7.2.1). Owner: Phase 1 (the marks, P1.FU11);
  the download part is P4.FU1's `downloadMarks`. Web only, the plugin API is unchanged. (1) The glyph: a download arrow out of a
  small cloud, everywhere `FileStateMark` draws Not Downloaded (cards, rows, the mod's pages); colours, disc, sizes, focus ring
  and tooltips unchanged; the header's Get a Release keeps its icon. (2) The rule: a season or episode with no file shows Not
  Downloaded whatever its watched state. Upstream's own season cards (Jellyfin season items; Delhi Crime's Seasons 1 and 2 are
  empty folders that Jellyfin reports as played) now carry the mark: Not Downloaded when none of the season's episodes in the
  entry's list is on disk, Unaired when all are unaired with a date, nothing when one is on disk or the entry lists none of the
  season; administrators get the picker on that season, ordinary users an indicator; drawn from the cached entry (P1.FU16), no
  new waits. (3) Option 1: on a card the mark sits just left of the tick or count (`CardMarkSlot`, shared with the library
  grid's native cards); on a native list row it comes before upstream's played check. (4) Downloads: a native season or episode
  was placed by its own series item, which is not always the entry's: with the library's automatic series grouping one show in
  two folders has two series items (1923 on 28096: the read-only folder holds the seasons, the download folder is the entry's
  item), so its season cards showed no download while the series card did. Each placed series now finds its entry once through
  `GET /Entries?jellyfinItemId=`; the season cards draw the bar and the arrow (in the count pill for a season with files, else
  the disc, which hides Not Downloaded). Web `feat/cloud-mark` from `068ce9cca4`: `936d5e8f2f` (code), the runner commit and
  this docs commit. Checks: typecheck, eslint, stylelint and the production build (with `JELLYFINMOD_PATCH_BASE=843ccd8f52`)
  pass; `missing-seasons-episodes.mjs`, extended (upstream season cards by the new rule, the mark beside the tick, a redrawn card,
  the picker and the TV hop from an upstream card, the glyph, and season downloads from an intercepted queue answer: a season
  pack on an empty season under another series item and one episode of a season with files), passed in Chromium (desktop 336,
  phone and TV 1080 682 checks, 0 failed) and real Chrome (desktop, phone, TV 1080: 1018 checks, 0 failed) on local environment
  alpha, as oleksii and the ordinary user nata, with plugin `next-release` `618efb7` and a fixture (an empty `Season 02` folder
  for Peep Show in a second Shows folder, automatic series grouping on, the 1923 shape), all removed afterwards. Not run: a
  live download (the queue answer was intercepted), the TV at 1280×720, a physical TV, a Pi instance (not deployed), the
  library list view's mark-before-check order (no file-less native title in alpha's list), the Unaired clock on an upstream season card (no such season in the data), Codex review.
  **P1.FU18, built (not accepted) 2026-10-13: a missing episode's person cards show the person icon at once and fade
  their portraits in** (user, testing 28096 on 1923 S1 E1: "Cast / Crew / Guests have no pictures ... They showed up with a
  quiet delay. I did not expect that."). Owner: Phase 1 (the P1.FU15 page). Cause: not a late start. The portrait requests
  already leave with the entry data (about 15 ms after it); the wait is TMDB's image server, which answers Sydney from Los
  Angeles: a cold connection costs about 0.35 to 0.55 s before the first image can be asked for, and in a profile that does
  not yet know the server speaks HTTP/2 the browser holds the low-priority portraits back until the still has loaded. Until
  then each card showed an empty image box, and the portraits popped in. Fix (web only): each person card shows upstream's
  person icon on its default background until its portrait has loaded, then the portrait fades in over it with upstream's
  image fade and its Faster Animations setting (no fade under reduced motion; a failed portrait leaves the icon); the
  entry route opens the connection to `image.tmdb.org` while it reads the entry (a `preconnect` hint; Chrome honours it in a
  normal profile, not in an incognito one, and Playwright's own Chromium ignores it). Measured on 28096 with the build served
  in place of the deployed bundle (read-only), ms after navigation, Google Chrome with a fresh normal profile, from Home:
  cards 365–390 (one run 876, its entry read took 800 ms); the last portrait in view loaded at 1654–1738 before and
  1294–1389 after (that one run 1777); every portrait request was on the wire by 434–1105 after and 977–1454 before. From the season page (warm connection, the entry already known): cards 32–42, portraits requested
  at 42–52 and loaded by 325–541, the same before and after. The plugin's `GET Entries/{id}` is about 265–300 ms for 1923
  and Peep Show alike (not 870 ms; independent of the episodes' credits), so it was left alone. On local environment alpha
  the entry read takes about 35 ms, too short for the hint to help: the last portrait loads at 1295–1366 ms before and
  1306–1333 after. The fade is upstream's: 0.1 s with Faster Animations on (upstream's default), 0.5 s with it off. Web
  `fix/portraits-load` from `068ce9cca4` (`2c2807f3dc`). Typecheck, eslint, stylelint and the production build pass;
  `missing-seasons-episodes.mjs` passed 888/888 in Chromium on desktop, phone and TV 1080 (administrator and ordinary user
  nata) against alpha with plugin `next-release` `618efb7`; a read-only check on alpha found every loaded portrait at
  opacity 1 over the person icon on all three layouts, with upstream's `fadein` and none under reduced motion. Not deployed
  to a Pi instance; no real-Chrome runner pass; no Codex review yet.
  **P4.FU6, built (not accepted) 2026-10-13: the download state ring family on every card, row and line** (user-approved
  design, version 3 of the artifact and its defaults, [`design/download-state-ring-family.html`](design/download-state-ring-family.html)
  and [`.md`](design/download-state-ring-family.md); user 2026-10-13: "ring only, arrow, time left: meta line + tooltip ...
  Redo all cards and details and rows with new approved design ... remove arrow from the design but have two icons if the
  download in progress"; [UX.md](UX.md) §3.1, §3.3, §9.1). Owner: Phase 4 follow-up (P4.FU1's `downloadMarks`), with Phase 5's
  queue as the source; web only, no plugin change. One painter, `DownloadStateMark` (`paintDownloadMark`,
  `downloadStateMark.scss`): a disc, an amber arc at the percent, a glyph per state (arrow bobbing, clock, importing spinner
  with a turning arc, pause with the arc at 55 %, red bang). Cards: a 1.6em dark disc, the first of upstream's indicators, so
  left of the plain count pill or tick (two icons; P4.FU1's white arrow in the pill is gone), the two-layer bar kept, the
  figure in the tooltip (`Downloading · 42% · 12 min left · 3 MB/s`). Rows: ring only (the bar and the figure at a row's end
  are gone), the 2.5em transparent disc first in the end slot, the figure on the meta line after the date (`42% · 12 min
  left`, `1 h 05 min left`, `42% · stalled`, `queued`, `importing…`, `Failed · reason` cut with an ellipsis), or the row's last
  text line where upstream hides its meta line (the phone); a failure takes the Not Downloaded button as a red bang
  (`… — search again`, it opens the picker; never both), a row without one gets the red bang disc. The detail line reads
  `In the download queue · 42% · 12 min left · View queue` after the disc; the Queue page shows the disc in place of the state
  word (the progress bar kept); the release picker's added row puts the disc in the Add slot (the X and the marks line figure
  kept, the bar gone). Pack episodes keep their own figure (P4.FU5). Gaps against the artifact: no `queued · 2 ahead` (the queue
  answer has no position in the client's queue: the plugin reads Transmission's `queuePosition` only for its own torrents, and
  counting the waiting torrents ahead would need a read of every torrent in the client, so not added as a small change); the
  rate is the queue page's `formatRate` (`3 MB/s`, whole megabytes, not `3.1 MB/s`); the picker's added row keeps its figure on
  the marks line (its meta line) where the artifact's row shows none. Web `feat/download-state-ring` from `dd1a02c373`:
  `fb4b674fe2` (code), `439a4903a5` (runners) and the docs commit. Typecheck, eslint (feature folder), stylelint, the patch
  surface check (22 upstream files, against `master`) and the production build pass. `card-progress.mjs`, rewritten for the
  family (intercepted queue, release search and grab answers, not a live download), passed 115/115 in Chromium and 115/115 in
  real Chrome on desktop, phone and TV 1080; `missing-seasons-episodes.mjs` (season card downloads now read the disc beside
  the plain pill) passed 336 (desktop) and 681 (phone and TV 1080) in each of Chromium and Chrome, as oleksii and the ordinary
  user nata; both against local environment alpha (lease 10:39–11:09 Sydney) with plugin `next-release` `618efb7` and this
  build, alpha reset to its baseline afterwards. Not run: a live download, the TV at 1280×720, a physical TV, a Pi instance
  (not deployed), the Unaired clock beside a download, the light scheme on cards (dark discs on posters, unchanged), Codex
  review.
  **P1.FU19, built (not accepted) 2026-10-13: Get a Release in place of Play on a card with nothing on disk, every mark an
  indicator, row marks at upstream's button size, a missing episode's page shows its download** (user, testing Ted Lasso's
  Seasons row on 28096: "We don't need Play. Instead of Play there should be the Cloud to download the season. As for the
  clickable state icon, let's remove it for now."; then "I don't think we need highlight / hover over non clickable icon",
  "Why it has this icon when download is going in progress on episode page?" and "make the episode [state icon] the same size
  as info and fav and heart icons"; [UX.md](UX.md) §3.1, §3.3, §5.7, §7.2.1). Owner: Phase 1 (the P1.FU11/P1.FU17 marks and
  the P1.FU12 card Get a Release), with P4.FU6's discs for the hover and size parts; web only, no plugin change. (1) A card with
  nothing on disk (upstream's season cards with no episode on disk by P1.FU17's rule, a download in progress included, and a
  library entry's native card with nothing on disk) is marked `data-jfmod-nofile`: upstream's centre Play (and the phone's
  overlay Play) is hidden for everyone, and an administrator's Get a Release takes the centre in Play's own classes, with no
  second cloud in the bottom row; the mod's own file-less and missing-season cards get the same centre icon on the desktop
  hover (`CardHoverGet`); ordinary users get neither; a season with a file keeps Play. (2) Every mark is an indicator (no
  button, no focus stop or TV hop, no pointer, no "search again" on a failed row), behind `MARK_CLICKABLE = false` in
  `constants/fileState.ts`, the button code kept. (3) No hover look on anything that is not a control: the marks and discs get
  the default pointer, and the release picker's added-row Add slot (holding the disc) no longer grows or takes the veil; the X
  keeps its hover. (4) A row's Not Downloaded, Unaired clock, failed bang and (on list rows) download disc take the box and
  glyph of upstream's round row buttons: 2.7816em and 1.6696em (41.4/24.8px desktop, 40.1/24.0px phone, 55.6/33.4px TV;
  before 37.2/20.8, 36.0/20.2 and 50/28px); the detail line, the Queue page and the picker keep 2.5em; cards keep 1.6em. (5)
  The mod's page for a missing episode: the still carries the episode's ids, so `downloadMarks` draws its download (the disc
  takes the corner from Not Downloaded, a failure included) and the page shows `QueueStatusLine` at the end of upstream's
  content section, as a downloaded episode's page does (both superseded by P1.FU20's download block and plain still). Web `feat/hover-cloud` from `next-release` `d17d1457e9` (code, runners
  and docs commits). Checks: typecheck, eslint (feature folder: no errors), stylelint and the production build pass.
  `missing-seasons-episodes.mjs` (the hover centre, Tab order, the picker from the centre icon on upstream's and the mod's
  cards, the inert marks, the row size, the TV's absent stops, the episode page's download from an intercepted queue answer)
  passed 1049 checks in real Chrome (0 failed, 24 not verified: lazy posters below the fold) and in Chromium 1049 with one
  phone failure that was the runner reading upstream's hidden copy of the still (fixed, the phone re-run 339/0); as oleksii and
  the ordinary user nata, desktop, phone and TV 1080. `card-progress.mjs` (failed rows as indicators, the row disc's size
  against the row's heart, no hover look on card, row and failure discs and on the picker's Add slot, the X's veil kept)
  passed 119/119 in Chromium and in Chrome on the three layouts. Both against local environment alpha (lease 14:22–14:52
  Sydney) with plugin `next-release` `618efb7`, this build and a fixture (an empty `Peep Show (2003)/Season 02` folder in a
  second Shows folder, automatic series grouping on), alpha reset to its baseline afterwards. `card-get-shuffle.mjs` (Play
  kept on a card with a file) ran in Chromium against 18096 with this build served in place (read-only, lease 14:45–14:49):
  74 passed, 3 failed, 2 not verified; the three failures are the season and series card clouds, absent because 18096's
  plugin has no `acquisition.packs` (not a P1.FU19 behaviour). Not run: a live download (queue answers intercepted), the TV at
  1280×720, a physical TV, a Pi instance deployment, a file-less movie's search card (alpha has none), `card-get-shuffle.mjs`
  in Chrome, Codex review.
  **P1.FU20, built (not accepted) 2026-10-13: a missing episode's page shows its download in a block** (user-approved design,
  version 2 of the artifact, [`design/missing-episode-page-download-block.html`](design/missing-episode-page-download-block.html)
  and [`.md`](design/missing-episode-page-download-block.md); user 2026-10-13: "Looks good besides I see no sense in download
  cloud over the episode card in episode page, too much information"; [UX.md](UX.md) §7.2.1 and §3.3, [API.md](API.md)
  *Queue*). Owner: Phase 1 (the P1.FU15 page), with P4.FU6's ring family and Phase 5's queue as the source. Where a downloaded
  episode's page has its Video / Audio / Subtitle selectors, one panel (`DownloadBlock`): the ring at a new `page` size (4em,
  3.2em on the phone, the percent inside while it downloads or stalls), the state and its figures (`Downloading 42% · 14 min
  left · 3.1 MB/s · 1.9 of 4.6 GB`, a pack episode's own file), the release name, the picker's marks from the queue row's
  `parsed`, the size and the indexer's name, Open in the client for administrators (not on the TV), a pack's line (`Season 2
  pack · this episode is file 2 of 6`) with one dot per pack episode, a 0.28em bar, and View Queue, Cancel Download (the
  picker's torrent-only removal, administrators), Search Again (failed) and Get a Release (not downloaded) for administrators
  who may search; stalled, queued, importing, failed, not downloaded and unaired (`airs … · in 7 months`) as drawn. The still
  carries no mark or disc any more (P1.FU19's disc and the Not Downloaded and Unaired marks on it are gone; cards and rows keep
  theirs), and P1.FU19's detail line on this page is replaced by the block. When the queue's row finishes, the page reads its
  entry again and opens Jellyfin's own episode page (its selectors and Play). The misc line gains the series' certification (US,
  else the first) and the page its genres line, from the stored TMDB metadata (no plugin change). Plugin: each queue row carries
  the grab's stored `parsed` release and `indexerName` (additive). Not built (not cheap): the indexer's release page link (the
  grab keeps no `detailsUrl`; a column and migration), so the name is plain text. Gaps against the artifact: no `2 ahead in
  Transmission` (no client queue position, as P4.FU6), queued reads `waiting to start`; stalled reads `no progress for 20 min`
  (the queue does not know the seeders); Open Transmission is hidden on the TV, as in the picker; the page has no More button
  (P1.FU15); Cancel Download is upstream's grey raised button, not the drawn pill. Plugin `feat/queue-parsed-marks` from
  `618efb7` (`b52a64a`): Phase 4 and 5 (Linux container), Phase 0 and 1 smoke (Mac) pass, with new Phase 5 checks of `parsed`
  and `indexerName` on a movie row and a pack row. Web `feat/download-block` from `01b85914a7`: `36b64b840c` (code),
  `5be9df694b` (runner) and the docs commit. Typecheck, eslint (feature folder: no errors), stylelint and the production build
  pass. `missing-seasons-episodes.mjs`, extended with every state of the block from intercepted queue and entry answers (not a
  live download), passed 1170/1170 in Chromium on desktop, phone and TV 1080 as oleksii and the ordinary user nata;
  `card-progress.mjs` (the painter's new size touches every disc) 119/119 in Chromium; the same 1170/1170 and 119/119 in real Chrome. Both against local
  environment alpha (lease 15:16–16:10 Sydney) with plugin `b52a64a` and this build, alpha reset to its baseline afterwards.
  Not run: a live download and import, the TV at 1280×720, a physical TV, a Pi instance deployment, Codex review.
  **P4.FU7, built (not accepted) 2026-10-13: the card disc is the top bar's glass, with a white glyph** (user-approved design,
  version 11 of the artifact and [`design/download-state-ring-family.md`](design/download-state-ring-family.md) *Revision 3*;
  user 2026-10-13: "switch from yellow to white card glyph, and use top bar's exact recipe"; [UX.md](UX.md) §3.1, §3.3). Owner:
  Phase 4 follow-up (P4.FU6's ring family); web only, style only, no plugin change. The 1.6em card disc, and the card's Not
  Downloaded and Unaired marks (so every mark on a poster looks alike), take the scrolled top bar's recipe from `homeChrome.scss`
  value for value under the same `@supports` gate: the theme's bar colour (`--jf-palette-AppBar-defaultBg`; MUI's own
  `--AppBar-background` exists only on the bar) at 12 % over `blur(12px) saturate(180%) contrast(0.7) brightness(0.85)`, the
  light scheme 20 % with `saturate(170%)` and `brightness(1.1)`, Apple TV's lightened colour at 30 % with `brightness(1.15)`;
  the glyph and the arc take the bar's text colour (white, the light schemes' dark text, a failure red); the solid black 66 %
  disc with the white glyph stays on the TV layout and without `backdrop-filter` or `color-mix()`. Rows, bars, the picker, the
  Queue page, the detail line and the episode-page block stay amber and unchanged. Web `feat/glass-disc` from `303f6722d5`:
  `30a52fa29f` (style, new `_cardGlass.scss` shared by the two stylesheets), the runner commit and the docs commit.
  Typecheck, stylelint and the production build pass; the built CSS carries the `-webkit-` forms. `card-progress.mjs` (the card
  disc asserts: white glyph and arc, the glass on the computer and the phone, solid on the TV) passed 122/122 in Chromium and
  122/122 in real Chrome on desktop, phone and TV 1080, against local environment charlie (lease 17:03–17:42 Sydney) with plugin
  `b52a64a` and this build, charlie reset to its baseline afterwards. Computed on the page in both browsers: `backdrop-filter:
  blur(12px) saturate(1.8) contrast(0.7) brightness(0.85)` over `color-mix(#202020 12%)`, a white glyph, arc and 30 % track on
  the dark theme; the light theme 20 % `saturate(1.7) brightness(1.1)` with a black glyph, 25 % track, failed `#c62828`; Apple
  TV 30 % `brightness(1.15)` with `rgba(0, 0, 0, 0.87)`; the TV layout `backdrop-filter: none` over black 66 % with the white
  glyph in every theme.
  Not run: the GPU cost of a blur per disc on a real phone or a TV, a physical TV, a Pi instance deployment, Codex review.
  **P4.FU8, built (not accepted) 2026-10-15: the icon colour replaces amber in the whole download design** (user 2026-10-15:
  "replace yellow in this design to the color of icons, light for dark theme and dark for light. Keeping it simple."; design:
  ring family artifact v12 and the episode page v3, [`design/download-state-ring-family.md`](design/download-state-ring-family.md)
  *Revision 4*; [UX.md](UX.md) §3.3). Owner: Phase 4 follow-up (P4.FU6's ring family) with P1.FU20's block; web only, style
  only, no plugin change. **Supersedes every "amber" in P4.FU1, P4.FU5, P4.FU6, P4.FU7, P1.FU11, P1.FU17, P1.FU20, P1.FU22 and
  the picker's added row above and in UX.md.** A card's disc is white (the light schemes' dark text); the card's bar the same
  at 85 %; a row's disc and a not-downloaded row mark the colour of upstream's round row icons beside them; the meta line's
  figures, the picker's added-row figure and the detail line are the line's ordinary secondary text; the episode-page block's
  ring, `42 %`, bar and pack dots (not the green imported ones) the page's text colour; stalled is the same colour at 55 %
  opacity; the card disc's hover is scale 1.08 only (the clickable card mark, off since P1.FU19); failed red unchanged; the
  amber tokens (`--jfmod-dl-stalled`, `--jfmod-dl-text`, `--jfmod-dl-text-stalled`, `--jfmod-dlblock-amber`) are gone. A row's
  Not Downloaded keeps P1.FU22's upstream round-icon hover (primary glyph over its veil), which the design's "scale only"
  hover does not mention. Accepted trade, recorded by the design session: a downloading row no longer stands out by colour alone.
  Web `style/download-icon-colour` from `2173444a36`: `24678a4a97` (style), the runner commit and the docs commit. Typecheck, stylelint, eslint and the production build pass;
  `card-progress.mjs` (amber asserts replaced by the upstream neighbours' computed colours, a light-scheme card check added) passed
  104/104 with 6 not verified (a missing season with a pack: the local series has none) in Chromium and in real Chrome on desktop, phone and
  TV 1080, against local environment bravo (lease 18:00-18:27 Sydney; reset to its baseline and stopped afterwards) with this build served
  in place of its web. `missing-seasons-episodes.mjs` (the download block's ring, figure, arc and bar equal the block's text colour)
  passed 507/507 in Chromium and in real Chrome on desktop, phone and TV 1080 against 28096 READ-ONLY (Peep Show's entry, this build
  served by route interception, queue answers intercepted; no deploy, restart or setting). Upstream's round row icons read live on 28096:
  `rgba(255, 255, 255, 0.7)` dark, `rgba(0, 0, 0, 0.87)` light, equal to the row text and the meta line's text, as inherited. Not run:
  a live download, a physical TV, a deployment, Codex review (the user decides when).
  **P4.FU9, built (not accepted) 2026-10-15: quality profile presets, 4K with fallback as the default, and the simple
  profile dialog** (user 2026-10-15: "Can you predefine 4K, 2K, 1080p and other quality profiles? And set up by default 4K
  downloaded with fallback to lower quality profiles?"; then, on the redesign: "Love new design. Go ahead and implement it.";
  [API.md](API.md) *Quality vocabulary and presets*, [UX.md](UX.md) §12 *Quality Profiles in the settings area*). Owner:
  Phase 4 (profiles and scoring). **Default (user's words above): the 4K preset, falling back to 2K, 1080p and 720p.**
  Plugin: six presets as data (`Assets/quality-presets.json`: 4K, 2K, 1080p, 720p, Any Quality, SD, each with a one-line
  description; Balanced or Small size caps per the design's tiers, no minimum size, minimum seeders 2, upgrades off with the
  first quality as cutoff); a fresh install (no profile, acquisition settings never saved) gets them at start with 4K as
  its default, any other install is untouched; `GET/POST Settings/QualityProfiles/Presets` lists them and adds only the
  missing ones by stable id (a name another profile has is skipped); profiles gain `presetId`; 1440p joins the vocabulary
  (Blu-ray, WEB-DL, WEBRip) and the parser. Fallback needs no new mechanism: a profile is ordered best first and its rank
  (100 points a step) outweighs every other score part, so the picker and automation take the best allowed release on offer
  and the next one down when it is missing or rejected (proved through the hosted API with a Torznab stand-in: 4K chosen
  when present, 2K or 1080p when the 4K copies are absent or too large, 720p when only 720p is acceptable). No migration.
  Web: the Quality Profiles section and dialog of the approved redesign (simple form, Advanced matrix and order, live rules,
  row summaries, Predefined chip, Add Predefined Profiles while one is missing); one difference from the mock: a size choice
  sets only a maximum, since a profile-wide minimum would refuse the smaller copies it falls back to. Plugin
  `feat/quality-presets` from `next-release` `b52a64a`; web `feat/quality-presets` rebased onto `jellyfin-web-prowlarrfirst`
  (P7.FU1 and P6.FU1 below it). All 13 plugin suites pass (Phase 4 in the Linux container with the new preset scenarios);
  `quality-profiles.mjs` passes on local environment echo in Chromium (desktop, phone, a TV smoke) and real Chrome (desktop,
  phone). Not run: the Pi, the Dashboard page's own profile editor (unchanged), `s11-fresh.mjs` (Pi image rig; it still
  drives the old dialog and expects an empty profile step, so it needs updating), Codex review.
  **P4.FU10, built (not accepted) 2026-10-17: a grab is queued from the moment it is made, on every page and device** (user,
  testing 28096 after adding a season pack and opening the season: its rows showed Not Downloaded; "it is better to show queued
  state than a wrong one"; [UX.md](UX.md) §3.3 and §9.1, [API.md](API.md) *Queue*). Owner: Phase 4 follow-up (P4.FU6's
  `downloadMarks`), with Phase 5's queue as the source. Causes, measured live on local environment bravo against the
  unchanged `next-release` builds (web `8a2599fb4c`, plugin `2d7a79f`) with `queued-state.mjs`: a grab is held 5 s before it is
  sent and the queue listed it only once the client accepted it, so a page opened, reloaded or opened on another device during
  the hold read no row and drew Not Downloaded, and with nothing on its way nothing read the queue again (no poll at all) until
  the next navigation: E03–E06 stayed Not Downloaded for the whole hold and after it on a reloaded page and a second browser;
  even the tab that grabbed (with `8a2599fb4c`'s event) showed the cloud from Add until the first 5 s poll after the client
  had it (10.4 s, never queued); another version of an episode or the movie showed nothing. After the queue fix, three
  smaller gaps: native placeholder rows waited for a Jellyfin lookup (about 25 ms locally, longer on the Pi) with the cloud
  showing; a page's first draw used a cached queue answer from before the grab; a finished import showed Not Downloaded until
  the page drew the new item (38 s on bravo). Plugin (additive, no migration): `GET /Queue` lists a grab the client has not
  accepted yet (held, being sent, unconfirmed) as a `queued` row with the grab's id, `importState` `held` or `submitting` and a
  pack's claimed episodes; held grabs are read before the imports, so the accept never leaves a read with neither. Web: the
  marks read those rows; a page's Not Downloaded waits hidden until its own queue read is drawn (at most 1.5 s); new cards,
  rows and marks are drawn on before they are painted; placeholder rows and upstream season cards carry their entry and
  episode or season (`MissingChildren.tsx`); with nothing on its way the queue is read once a minute and when the tab is shown;
  a finished import keeps `importing…` on a card or row while the page still shows the title without its file (at most
  3 min, kept across upstream redraws); the Queue page's held row has *Cancel* and *Waiting to be sent to the download
  client.*; the download block cancels a held grab without the torrent question. The `jfmod-grab` event stays as the
  same-tab speed-up (an immediate read). Checked by reading the code: a pack never claims unaired episodes or specials
  (`ReleaseTargets.Covered`), so their marks are unchanged; a season card of season 0 is not stamped and keeps the lookup.
  *"The text is not popping"*: the row disc is the topmost element under the pointer, its tooltip (`Downloading · 50% · …`,
  `Importing…`) and the meta line (`50% · 1 min left`, `importing…`) are set and update with each read (checked in the runner,
  hover screenshots), so nothing is broken there; if the user means that `importing…` does not stand out (plain secondary
  text since P4.FU8), that is a design change for a mockup, not built. Plugin `fix/queued-state` from `next-release` `2d7a79f` (`ab55fb0`);
  web `fix/queued-state` from `next-release` `8a2599fb4c`: `64eceef0f2` (code), `868384a09f` (runner, stand-in per-file
  progress) and this docs commit. Typecheck, eslint (feature files), stylelint and the production build pass; plugin suites
  Phase 4 and 5 pass (Linux container, with the change). `queued-state.mjs` (live: real grabs through the stand-ins' Torznab and
  Transmission, a real import into a writable copy of Peep Show with placeholders, states sampled every animation frame and
  100 ms) passed 61/61 in Chromium and 61/61 in real Chrome on local environment bravo (desktop; the hold scenarios also on
  the phone and TV 1080; reset to its baseline before each run and after): one episode from its row (queued 0.2–0.3 s after
  Add), another version of E01 and of the movie, a pack inside its hold with a reload, a second browser and Cancel on the
  Queue page, a handoff that fails (client down: queued, then Not Downloaded), and a Season 2 pack from the picker to all six
  files (each row queued, its own download, importing and its file; the series page's season card, the E04 page and the
  Queue page the same; no Not Downloaded and no step back anywhere). Not run: a Pi instance, a series pack and a replace grab
  (the same held-grab path), an ordinary user with the queue open to users, the TV at 1280×720, Codex review. Measured, for
  the other session's import-to-Play work: a finished file to the entry on disk about 67 s, then 38 s more until the season
  page drew the file (covered by `importing…`).
  **P4.FU11, built (not accepted) 2026-10-17: a finished download is playable in seconds, with no cloud between** (user
  2026-10-17: shorten the delay between a download finishing and the file showing as playable, and keep the importing ring until
  it really is; 2026-10-18: "make the delays go away"). Owner: Phase 5's import (P5.I5) with P4.FU6's ring family; carried on and
  finished by P4.FU12 below, which owns the behaviour now. Cause, measured on local environment charlie (Chromium, the page sampled
  every 100 ms, seconds after the download finished): the import reported the new file to Jellyfin's library monitor, which acts only
  after its quiet delay (60 s), so Jellyfin had the playable file at 73 s; the import completed at the monitor's next poll (88 s); the
  marks dropped the ring at the queue's `seeding` while the page still held the placeholder, and the page read its items again only
  10 s after Jellyfin's batched `LibraryChanged` (113 s): 22 s of the Not Downloaded cloud between. A pack's reports refreshed nothing
  until the escalated library scan (Play at 105 s); a movie waited the same 60 s. This slice: the import makes Jellyfin look at the
  destination at once (first `ChangedExternally()` on the nearest folder, replaced in P4.FU12 by `FolderRefresh`), a changed binding
  wakes the import monitor, a queue read that finds a waiting download complete wakes it too, the web reads its items again when the
  queue shows an import finished, and the mod's `LibraryChanged` refresh waits 250 ms instead of 10 s (a 1.5 s queue read while a
  file finished was dropped again by P4.FU12's push). Codex's first draft's guard (complete only when the bound item is a
  non-placeholder video at the destination path) was dropped: a further media source's binding names its owner item, so it could
  block a version's import. On the queued-state base (2026-10-18, before P4.FU12): episode Play 4.5–4.9 s, pack of 4 4.5–4.8 s,
  movie 3.1 s, no cloud. Runner: `import-delay.mjs`, `import-delay-fixture.py`, `import-delay-report.mjs` (charlie only).
  **P4.FU12, built (not accepted) 2026-10-18: no delay between what happens and what the pages show** (user 2026-10-18: "Go with
  what Codex proposed", then "fine, finish no delay work"; design [`design/no-delay-codex-design.md`](design/no-delay-codex-design.md),
  research [`design/no-delay-jellyfin-research.md`](design/no-delay-jellyfin-research.md), audit
  [`design/no-delay-import-audit.md`](design/no-delay-import-audit.md) B1 and B3–B8, B2 left out; what changed:
  [`design/missing-media-user-actions.md`](design/missing-media-user-actions.md) §18; [UX.md](UX.md) §3.3, §9). Owner: Phase 5's
  import and Phase 1's placeholders (P1.FU24–29), with P4.FU6's marks and P4.FU10's queued state. No migration, version 0.1.0.0; the
  only API change is the response-only `playableItemId` on an entry and an episode. **Push, not poll:** the plugin sends Jellyfin's
  own `LibraryChanged` to each user's sessions at once (`LibraryNotifications`, only the ids that user may see) after an import
  completes, a delete is repaired, placeholders are written or removed, and a native item is removed after a reclaim or a version
  removal; the web reads its queue and then its catalog on it, and after the person's own Remove Entry, Sync Now and Remove
  Placeholders. **The one fallback poll** is `hooks/useEntryFallbackPoll.ts` (an open title's detail once a second, every 5 s after
  30 s, only while it waits and the socket is down or no push came within 5 s); the download client has no push, so the plugin reads
  it every 2 s while an import or a replacement awaits its download, once per freshness window whoever asks, and not at all when
  nothing waits. Plugin: deletes made in Jellyfin repaired per title from Jellyfin's removals (`DeleteRepair`, scoped absence proof,
  no library-wide pass); `FolderRefresh` makes Jellyfin hold written files by validating the nearest folder (never a library
  folder's refresh); an import completes when Jellyfin can play the file; the plugin deletes the Jellyfin items of its own removed
  placeholders at once, marked by item id (B1); a real file beside a placeholder syncs the title at once (B3); a removal after a
  reclaim or replacement is pushed (B5); replacements are looked at every second (B8). Web: the importing ring stays until the page
  has drawn the file's own item; the marks' queue is refreshed before the catalog on a push. Finisher's fixes (2026-10-18): a pack
  row's state comes from an import still waiting for its download before one importing (it stepped back from importing to
  downloading once pack episodes imported in seconds); the queue is read before the catalog on a push (a redraw drew a stale queued
  on the playable file); a card or row that is the file's own item ends the ring at once (none, then importing again, for a frame);
  Remove Placeholders and Remove Entry wait, under the library lock, for discoveries asked for before them (a discovery still
  running could make items after the removal looked, later read as a user's deletes); the native season and episode lists are read
  again when a page draws them unless read within 2 s (a copy restored from the persisted cache after a reload showed a
  placeholder's row and the mod's missing row for the same episode); the Transmission transport keeps the last session id per
  endpoint (each client read was a 409 and a retry).

  | Before → after (local bravo, 100 ms DOM samples; after = Sonnet's runs, then the finisher's final build in Chromium / Chrome) | Before | After |
  | --- | --- | --- |
  | Import, episode: download done to Play | 110–134 s | 2.9–3.0 s; final 2.3 s / 4.0 s, no cloud |
  | Import, pack of 4 | 111 s | 2.7 s; final 2.8–2.9 s / 2.4–2.5 s |
  | Import, movie | 91 s | 1.9 s; final 3.9 s / 3.9 s |
  | Import, ordinary user, socket up | 110 s | 2.9 s; final 2.5 s, one read (the push's), no poll |
  | Import, socket blocked (the fallback) | — | 2.0 s; final 3.2 s (four reads, one a second) |
  | Remove Placeholders | 60.3 s | 0.03–0.12 s; final 0.05–0.23 s |
  | Sync Now, both libraries | 62.2 s | 1.7 s; final 2.2 s |
  | Remove Entry | 60.1 s | 0.07 s; final 0.14 s |
  | A real file beside a placeholder: the stub gone after the binding | next sync | 0.2–1.1 s; final 0.15 s (Jellyfin itself takes 63 s to see a copied file) |
  | Jellyfin's Delete media: season / episode / movie | 60 s and more | 1.6 / 1.6 / 0.5 s; final 1.7 / 1.1 / 0.5 s |
  | Jellyfin's Delete media: whole series | 60 s and more | 4.8 s alone, 12–14.5 s right after other steps (Jellyfin's own TMDb refresh of the new series item) |

  Tests (final build, plugin `5f2199e`, web this commit's line, local bravo, no TMDB token): all 13 plugin suites pass (Phase 4, 5,
  6, 7 settings/Prowlarr/takeover and 3 protection in the Linux container); `queued-state.mjs` 61/61 in Chromium and in Chrome
  (54/61 before the finisher's fixes; 58/61 on next-release, its 3 failures real flicker of the same kind), its opt-in B8 step 6/6
  (15 client requests in 30 s while an import waits, the same with a page polling the queue, none when nothing waits; 30 before
  the session id was kept); `import-delay.mjs` with no cloud sample on any surface in either browser; `placeholder-redelete.mjs`
  34/34 (Chromium) and its browser and series steps 9/9 (Chrome); `placeholder-flows.mjs` with Remove Placeholders right after Sync
  Now leaving nothing behind after 75 s; `card-progress.mjs` 125/125 in both browsers (its disc and importing-colour checks brought
  up to the card frame disc of `8a2599fb4c` and the importing word of `e8b835537c`; next-release fails the same 6 checks with the
  old runner); `picker-added-row.mjs` desktop, phone and TV pass in both browsers; `missing-seasons-episodes.mjs` 1244/1254 in both
  browsers, the 10 failures identical on unchanged next-release (a Season 1 card says "6 episodes" where the runner expects 2, and
  the TV administrator's Not Downloaded button check), so not this slice's; a one-off browser check that Remove Placeholders and
  Remove Entry show on the next page without a reload, in both browsers. Not run: the Pi, 28096, a physical TV, the TV at
  1280×720, Codex review. Seen, not fixed: a page loaded in the second or two while Jellyfin has made placeholder items but not
  yet given them their numbers drew them nameless at the top beside the mod's missing rows (a page already open converges at
  once). Cover push, built (not accepted) 2026-10-19 (plugin `feat/cover-push` `9f9440e` on `main-stubs`, the same delta
  `b371f96` on `main-items`; landed 2026-10-22): an item the plugin told the clients about (a placeholder title made again after
  a delete, a new title, an import) and a removed one are watched for two minutes (`LibraryNotifications`, at most 1000), and a
  first cover is told as `ItemsUpdated` 3 s after it came, the rest of a burst in one more message once no cover came for 3 s,
  so an open page shows the poster without Jellyfin's 30 s batch; the 3 s let the placeholder listener put back the user data
  Jellyfin parked for a re-made id first. Not run: real Chrome, the Pi, Codex review. Review fixes 2026-10-22 (the Opus review of
  that day, workspace `reviews/fable-review-2026-10-22.md`): Remove Placeholders and Remove Entry now drop the Series and Season
  items of the folders they removed and report the surviving parents again (P2-4; on local delta with real-time monitoring off,
  Peep Show's eight emptied seasons left Jellyfin 0.6 s after Remove Placeholders); an import Blocked after its scans no longer
  keeps the one-second local pass running (P2-5; looked at on a binding change and the full ticks); a card on Home, a library grid
  or search reads the title's detail itself while its importing ring waits, once per queue read, so the ring ends there too (P2-6:
  on local echo the grid cards' rings ended 2.3 to 3.6 s after the download, where they had stayed until the 10-minute stop;
  `import-delay.mjs` now samples the library grid's card; first look on echo, waiting for the user). Runners: `settings-changes.mjs` sweeps no Prowlarr source without a
  snapshot, `prowlarr-first.mjs` cleans up only an environment it proved fresh, `placeholder-redelete.mjs` and
  `placeholder-flows.mjs` prove one pool environment first (`local-env.mjs`, never alpha or beta), `placeholder-flows.mjs` has a
  verdict, and `import-delay-report.mjs --verify` fails a ring that never clears.
  **P4.FU13, built (not accepted) 2026-10-19: quality profiles list best first everywhere, and the picker has no "Title default"**
  (user 2026-10-19: "Higher profiles first, i.e. 4k 2k. Make those changes in settings, not drop down"; then "No sense in Default
  if 4k is default. So it should be 4k (Default) selected, that's it."). Owner: P4.FU9's profiles. One order, decided in the data:
  `GET /Settings/QualityProfiles` returns profiles by the resolution of each one's best (first) quality, descending, then name, so a
  fresh six read 4K, Any Quality, 2K, 1080p, 720p, SD; the Settings list, the wizard step, the Default profile select and the picker
  all show it as given and none sorts. The brief's literal rule (position of the best quality in the global quality list) cannot give
  4K, 2K, 1080p because that list puts `remux-1080p` above `bluray-1440p`, so the key is the resolution number; the tie-break is name
  (not allowed-quality count) so 4K precedes Any Quality. The predefined dropdown in the dialog keeps its shipped order (4K, 2K, 1080p,
  720p, Any Quality, SD). The picker's Quality Profile dropdown lists the profiles, the default reads "4K (Default)", and the selected
  entry is the title's own profile or else the default; picking the profile the search already uses sends no override. Plugin
  `feat/profile-order`, web `feat/profile-order`. Not run: real Chrome, TV, Codex review, the Pi.
  **P4.FU14, built (not accepted) 2026-10-19: the 4K predefined profile has no file size limit** (user 2026-10-19, after a 35.1 GB 4K
  WEB-DL season pack sat under Rejected with "The profile limits size per hour, but the runtime is unknown.": "Remove file size limit
  for 4K defaults. Any size for highest limits."). Owner: Phase 4's presets (P4.FU9). The 4K preset's `maximumBytesPerHour` is `null`
  (the Large tier, like Any Quality) in `quality-presets.json`; 2K 10 GB per hour, 1080p 6, 720p 1 and SD 0.5 stay. Its row reads
  "4K first, then down to 720p · any size · no upgrades" and the dialog opens with Large pressed. No migration: presets are copied only
  when added, so an existing install keeps its stored 4K profile until its owner edits it (API.md, [UX.md](UX.md) §12, the
  [Quality Profiles guide](design/guides/quality-profiles.md)). Checks: plugin `PhaseFourIntegration` preset scenario on Linux (the
  4K profile has no maximum, the other caps are asserted, an 80 GB 4K remux is eligible); `quality-profiles.mjs` 63/63 in Chromium
  (desktop and phone) on local environment delta, with the picker check now showing the 15 GB 4K row accepted; typecheck clean. Not
  run: real Chrome, TV, Codex review.

  **P4.FU15, built (not accepted) 2026-10-19: the download state text, treatment B** (user 2026-10-19, after the design session's
  playground, artifact <https://claude.ai/artifact/G2NS7itUD3zTFSeoBdW2i4>: "I'd go with B, 600, Inter, but no need for
  Downloading... just put % and time"; [guide](design/guides/download-state-mark.md) *Text*, [download block](design/guides/download-block.md),
  [UX.md](UX.md) §3.3). Owner: P4.FU6's ring family (the text states); web only, style and strings only, no plugin change. One rule
  for every state replaces the importing-only one: the whole state text in the text colour at 600 in Inter with tabular figures,
  queued and stalled at 75 %, failed red, a client that could not be read at 55 %, no animation. Strings (`describeDownload`):
  `42% · 12 min left` (no "Downloading" word; `42%` alone when the time is unknown), `Queued`, `Importing…`, `Stalled · 42%`,
  `Failed · reason`; tooltips and the picker row's label keep the full words. The download block's line is the same B: downloading
  shows the figures only (the word stays visually hidden for assistive technology), the other states keep their word. The
  Queue page draws discs, not words, and is unchanged. Runners moved to the new strings: `card-progress.mjs`,
  `missing-seasons-episodes.mjs`, `queued-state.mjs`. Gate 1 (first look) on local
  delta; the rest, real Chrome and the Codex review are not run.
  **P4.FU16, built (not accepted) 2026-10-19: an administrator's download ring opens the download client, and the Queue page's
  titles and client are links** (user 2026-10-19: "Can you make download or queued clickable and open in download client?", then
  "The buttons only (I believe you meant a ring)" and "Administrators only"; on the Queue page: no empty room between State and
  Client, the title split into links, the client name a link and Open in Client out of the row menu; [UX.md](UX.md) §3.3, §10;
  guide [download-state-mark.md](design/guides/download-state-mark.md), which said "never a control" and now names this
  exception). Owner: Phase 4's ring family (P4.FU6) with Phase 5's queue page. Web only, no plugin change, no migration: the link
  is the queue row's `client.openUrl`, the client's saved Web interface link, which `GET /JellyfinMod/Queue` already sends to
  administrators only (null for everyone else), so the rings read it from the queue the page already holds, with no new request
  and nothing new exposed. `ringLink` (`components/DownloadStateMark.tsx`): a queued, downloading, importing or stalled ring on
  cards, rows, the detail line, the Queue page, the picker's added row and the download block becomes `role="link"`, a Tab stop on
  desktop and phone, a pointer, the cyan ring for the keyboard only, the tooltip's second line `Open <client name>` (a thin hover
  ring in the disc's ink was built and taken out after the user's look: "Selection of buttons are awful, probably remove selection
  at all");
  a click or Enter opens the link in a new tab (`noopener`) and stops there, so a card's or row's title does not open. Not on the
  TV, not for a failed disc or the cloud, not for an ordinary user, not without a saved Web interface link: those stay as they
  were (an ordinary user's card disc still forwards its click to the card). Queue page (`components/QueuePage.tsx`, `queue.scss`):
  the State column takes the width of what it holds and the title 50 % (was 30 % and 20 %); the title's parts link the series,
  `Season N` and the episode (the mod's season and episode routes) on desktop and phone (the TV row is a button, so text); the
  desktop table's cells share one centre line (`vertical-align: middle`, was top); the row menu has no title above its items
  (user: "No need for such header at all. Just show menu Remove"; on the TV's action sheet too), and on the desktop table it is
  a popover under the three dots that does not dim the page (user: "why menu mutes / darkens the whole page? it's menu"; MUI's
  Menu as the track dropdown's; phone and TV keep the action sheet, which still dims); the
  Client cell no longer wraps and its name is a link for administrators with a saved link; `Open in Client` is gone from the row
  menu (`integration/queueActions.ts`; it was administrators only, so no ordinary user loses anything; the TV's action sheet,
  which had it, now has no link out to the client). First look on local environment charlie (Chromium headless, web built from
  `main-stubs` `2ac29996ae` plus this slice, plugin `main-stubs` `5f2199e`, stand-ins at port base 38210 with a Season 2 pack at
  25 %, another version of S01E01 queued and of the movie at 42 %, Web interface link set to the shared Transmission's page):
  administrator desktop 1440 and 1280 25/25 each, phone 360 25/25, TV 1920×1080 16/16 (no links), ordinary user (nata) desktop
  and phone 19/19 each (no link, no client in any response), administrator with an empty Web interface link 20/20 (no links).
  Not run: real Chrome, the TV at 1280×720, a physical TV, the full runner matrix, the importing and stalled states live (same
  code path as queued and downloading), a failed ring live (excluded by `ringLink`), Codex review.
  **P1.FU21, built (not accepted) 2026-10-13: every season card says how many episodes it has** (user: "it should be 10
  episodes, screenshot showed nothing", Ted Lasso's Season 4 with 10 files; [UX.md](UX.md) §3.1). Owner: Phase 1 (the P1.FU11
  season cards). Upstream's own season cards on a series page get the mod's missing season cards' second line, `N episodes`
  (`1 episode`), in the same `div.cardText.cardTextCentered.cardText-secondary` with a `bdi`, drawn into upstream's card after
  its title by `MissingSeasonCards` (DOM augmentation like P1.FU17's marks, no upstream file touched, back with the card when
  upstream redraws it). N is the season item's `ChildCount` (the mod's own season read, `nativeSeasonsQuery`, now asks for
  that field: same request, no new wait); a season Jellyfin keeps with no episode counts the entry's list, as the mod's cards
  do; no line when neither has one. A partly downloaded season shows Jellyfin's count alone, since the mod's cards have no "on
  disk of total" form. The line is marked by a `data-jfmod-count` attribute, not a `jfmod-` class, because `modFont.scss` gives
  every `jfmod-` class the mod's Inter font (found by the typography check; the mod cards' line keeps Noto Sans). Web
  `feat/season-episode-count` from `next-release` `303f6722d5`: `e3b18c8fa0` (code), `465d85fa23` (runner) and this docs commit.
  Checks: typecheck, eslint, stylelint and the production build pass. `missing-seasons-episodes.mjs` extended (on every upstream
  season card the line equals Jellyfin's count, once, right under the title, with the mod line's computed look and an unchanged
  cover; it returns once after a redraw; a native season page has none; the mod cards' check unchanged). Live, read-only on 28096
  (nothing written: the build served in place of `/web/` by Playwright route interception, signed in as oleksii; the only
  non-GET requests were sign-in and the Home's own `POST /JellyfinMod/Browse` read): a probe with the runner's new checks on Ted
  Lasso (mod Seasons 1–3, native Season 4 with 10 files reads "10 episodes"), Delhi Crime (empty native Seasons 1 and 2 read the
  list's 7 and 5; mod Season 3) and 1923 (empty native Season 1 reads 8, Season 2 Jellyfin's 7) passed in Chromium (100 checks)
  and real Chrome (101 checks), 0 failed, on desktop, phone and TV 1080. Not verified: the look comparison on 1923 (no mod card
  in its row) and one Chrome TV screenshot (timed out; the Chromium one exists). **Not run:** the full runner (its picker and
  queue steps are not read-only on 28096; the local environments' plugins lack the TMDB list load and deploying `next-release`
  there was not permitted), the ordinary user (28096 has no non-administrator with an empty password), the TV at 1280×720, a
  physical TV, a deployment, Codex review. Noticed, older than this change and left alone: an upstream season card's title sits
  0.3em above the mod cards' titles (the mod cards wrap their lines in a `.cardFooter` with its padding; upstream's have none).
  **P1.FU22, built (not accepted) 2026-10-13: a row's Not Downloaded is white, and an administrator's button that opens the
  picker** (user, with a screenshot of 1923 S1E1's row on 28096: "Replace yellow with white and add hover effect + click which
  open the picker for the episode"; [UX.md](UX.md) §3.1, §3.3). Owner: Phase 1 (the P1.FU11/P1.FU17 marks, P1.FU19's switch);
  web only, no plugin change. Rows only (a missing episode's row on the native and the mod's season pages, a library list row):
  the glyph takes the colour of upstream's round row icons (`color: inherit`, the row's text colour: white 70 % dark, the dark
  text light) for everyone; for administrators it is a button again, `MARK_CLICKABLE` now per kind (`{ card: false, row: true }`):
  upstream's round-icon hover (the theme's primary glyph over its veil, 0.2 s, no scale) under the mouse and pressed, a pointer,
  the cyan keyboard ring, Enter and Space, named *Get a Release for Episode 1, 1923* (a library row: *Get a Release for* the
  title), the tooltip kept *Not Downloaded* (chosen: the tooltip says what the mark means, as before, and the name what the
  click does; no collision found). It opens the picker in the row's scope (an episode: Episode, its season, All Seasons, as the
  episode page's Get a Release; a title: the title's picker). TV: the row is the stop, Right reaches the mark (focused: the
  primary glyph over its veil and the white ring), Enter opens the picker, Left returns; Down never lands on it, and Right does
  not go into a hidden (downloading) or disabled mark. Ordinary users: a plain indicator, as before. Cards unchanged; the
  Unaired clock and every download disc unchanged; a failure on an administrator's row disables the button while it holds it
  (the red bang stays an indicator, its tooltip and name the failure's; both given back after). Web `feat/row-mark-click` from
  `next-release` `71ba91d893`: `c1d7a0a31f` (code), `f63940280b` (runners) and this docs commit. Checks: typecheck, eslint (the
  changed files: no errors), stylelint and the production build pass. Values found live on 28096 (candidate CSS injected on the
  deployed page, read-only): upstream's heart and info hover `rgb(0, 164, 220)` over `rgba(0, 164, 220, 0.2)`, the row icons
  `rgba(255, 255, 255, 0.7)` dark and `rgba(0, 0, 0, 0.87)` light. Runs, all read-only against 28096 with this build served in
  place of `/web/` by Playwright route interception (`JELLYFINMOD_LOCAL_DIST`, new in both runners; a look before a deploy, not
  acceptance), signed in as oleksii, 1923 (entry `8f9dcb37…`, native Season 1 with 8 missing episodes):
  `missing-seasons-episodes.mjs` passed in Chromium on desktop (102 pass, 0 failed), phone (93, 0) and TV 1080 (98, 0; a first
  TV run failed only on the runner expecting a pointer where the TV layout hides it, fixed) and in real Chrome 287 pass, 0
  failed on the three layouts; `card-progress.mjs` (intercepted queue, search and grab answers) passed in Chromium (desktop and
  phone 0 failed, TV 20/20 after the same runner fix) and in Chrome 63 pass, 0 failed, 21 not verified (no movie entry given,
  no series list row in its run). A probe (not committed) checked a library list row in Chromium and Chrome: Adolescence in
  the Shows list filtered to Not Downloaded carries the button, white at rest, the hover look, a click opens the picker, on
  the TV Right, Enter and Left as above. The picker steps ran real release searches on 28096 (`GET /JellyfinMod/Releases`,
  database reads and indexer queries; nothing grabbed). **Not run:** a local environment (deploying the plugin and the build to
  alpha was not permitted by the permission system, so nothing ran there), the ordinary user (28096 has no non-administrator
  with an empty password), the Right hop on a failed or downloading row on the TV, the button coming back after a failure
  clears, the TV at 1280×720, a physical TV, a Pi deployment, Codex review.
  **P1.FU23, built (not accepted) 2026-10-13: Get a Release without delay everywhere, and no Play where nothing can play**
  (user, testing Fleabag on 28096: the season card's hover cloud "was not there and appeared after about 1 second ... Fix it
  everywhere, on each page cloud button exists"; then, on Kleo's library card: "Supposed to be Cloud download instead of Play
  button as nothing available to play"; [UX.md](UX.md) §5.7 and §3.3). Owner: Phase 1 (the P1.FU12 card cloud, the P1.FU19
  centre, the header icon). Web only, no plugin change. Causes, measured read-only on 28096 (Chromium, web `71ba91d893`
  deployed): (1) the card cloud (series page season cards, library grids, Home, search) was inserted hidden and shown only after
  the card was hovered and two plugin reads answered (a season: Jellyfin's item, then the entry lookup): 446 ms after the card
  was drawn and 356 ms after the hover on Fleabag's season card, 464 ms after the hover on a Home episode card, 158 ms on a
  library series card; a card seen within the minute showed it from cache but still 4 to 72 frames after the card; (2) the TV's
  and phone's card menu waited for the same lookup before opening (404 ms to the sheet on a season card, 50 ms once known);
  (3) a native page's header icon waited for the entry lookup and detail (440 ms after the header on a first visit of a series
  page on the phone, 116 to 131 ms on a movie page) and was inserted in a passive effect; (4) every cloud waited for the Health
  read, kept only in the query cache that is restored from IndexedDB after the first cards and dropped on every deploy; (5)
  Kleo is a series item with no season and no episode (`RecursiveItemCount` 0, entry state `none`), but P1.FU19 marked only
  the cards whose owner knew they had no file (a series page's season cards, the mod's entry cards), so upstream's own cards
  in grids, search and Home kept Play. Fix: the icon is inserted visible by the observer in the task that draws (or redraws)
  the card, from the administrator flag, the capabilities and the card's type; the lookup on first hover or focus only sets
  its label or removes it on a title without release search (on 28096 one title of 164, no season or episode: shown
  optimistically, hidden on the answer); the card menu's item is in the sheet when it opens; the header icon follows the
  item's type until the entry is read, is inserted in a layout effect, and a press before the entry is in shows upstream's
  spinner and opens the picker when it is; the last Health answer is kept in local storage (`utils/lastKnown.ts`; a failed
  read forgets it). One read per user lists the series whose recursive episode count is 0 and the seasons whose child count
  is 0 (two Jellyfin item reads; a season's own count because with automatic series grouping a season's series id can name
  another series item), kept in local storage and refreshed with the catalog on library changes; their cards carry
  `data-jfmod-empty` from their first frame: no Play for anyone, the administrator's cloud in the centre. After (local build
  served in place of the deployed one, same runner): every card place 0 frames after the card is drawn (0 to 4 ms), already
  there when pointed at; the TV's season card menu 98 ms to the sheet on a first visit (upstream's own commands) and 49 ms
  after; headers 0 frames, except a page not seen before, where the mod's and upstream's parallel item reads land up to 3
  frames apart (10 to 45 ms); Kleo with no Play and the centre cloud in grid and search, also with a download on its way.
  Web `fix/cloud-no-delay` from `next-release` `71ba91d893`: `06c58688d3` (code), `77c52fd088` (runner) and this docs commit.
  Checks: typecheck, eslint (feature folder: no errors), stylelint and the production build pass. New runner
  `cloud-no-delay.mjs` (a MutationObserver installed before the app stamps cards, header rows and card sheets; first, warm and
  full-load passes): against the deployed `71ba91d893` 111 passed and 39 failed (the causes above); with this build 150 passed,
  0 failed in Chromium and 149 passed, 1 failed in real Chrome (a movie header 3 frames after the row on a first TV visit, the
  item-read race; the runner now allows 3 frames there and the Chrome TV re-run passed 24/24), on desktop, phone and TV 1080,
  as oleksii, read-only on 28096 (lease held by the next-release session for the user's testing; nothing deployed or changed,
  the queue answer for the download case intercepted in the browser). Not verified: an ordinary user (28096 has no
  non-administrator with an empty password), the phone's card menu (upstream draws no More on the phone's grids and season
  cards). Not run: `card-get-shuffle.mjs` and `missing-seasons-episodes.mjs` (their picker steps run release searches, not
  read-only on 28096), the TV at 1280×720, a physical TV, a deployment, Codex review. The row Not Downloaded mark is left to
  `feat/row-mark-click`.
  **P7.FU4, built (not accepted) 2026-10-15: what blocks a setup step is said beside Continue** (user 2026-10-15, option A of the design
  session's `wizard-step-blockers`: "A, tell parent to implement it"; [UX.md](UX.md) §12.2). The top notice ("This step is not done yet. …")
  is gone; the step card's footer shows one muted line with a lock, "To continue, <instruction>.", built from the step's blocker codes, and
  Continue is refused with `aria-disabled` (still focusable) at about 45 % with the tooltip "Not yet: …". Web `feat/wizard-blockers` from
  `next-release` `542d096889`: `SetupWizardPage.tsx`, `settingsWidgets.tsx`, `settings.scss`; runners `setup-wizard.mjs`, `s11-fresh.mjs`,
  `settings-design.mjs` read the new element. Not accepted: runs on the local environment bravo only, whose plugin predates next-release.
  **P7.FU6, built (not accepted) 2026-10-17: the track block as three dropdowns** (user-approved design v5 of
  `video-row-file-size`: "Logos, A for size"; [UX.md](UX.md) §11.2). Owner: Phase 7 follow-up on the Phase 6 file chooser;
  web only, no plugin or API change, no upstream file (the Audio and Subtitles selects are hidden like the Version select,
  §1.1 exception 2). The Video value shows the resolution and video marks with the file size muted at its right end before
  the chevron, and no audio; each row of the open list reads video, a hairline, its default audio track's marks and the
  extras, then the size right-aligned (on a phone the audio and extras take a second line). Audio and Subtitles are one
  shared `TrackDropdown` (an MUI listbox drawn like the Video field, the current entry with a blue left bar): language (the
  server's culture names), the release picker's `MediaMarks` from the stream (`streamMarks` in `constants/versions.ts`:
  codec, profile for HE-AAC, DTS-HD MA, DTS:X, TrueHD and Atmos, channels, `VideoRangeType`), and muted Default, Forced, SDH
  and the stream's title (Commentary); Subtitles start with Off and show the format. Entries are the hidden select's options;
  a choice sets it and dispatches emby-select's own `change`, so Play sends the same stream index. One audio track is a
  static field. The item's media sources are read once (`getMediaSources`, which also replaces the TV's range-type read).
  Web `feat/detail-track-dropdowns` from `next-release` `f1efa4fd1c`: `5186604f4b` (code), `3207dce599` (runner) and this
  docs commit. Checks: typecheck, eslint (changed files; the runner keeps one older nested-ternary error at its pack
  checks), stylelint, the patch-surface check and the production build pass. `detail-design.mjs` with
  `JELLYFINMOD_DD_TRACKS` (the movie with two E-AC3 5.1 tracks and 36 SRT subtitles, an episode with AAC 2.0 and a
  Commentary track, an episode with one track) plus the one-file and movie scenarios, on the local environment delta under
  its lease: 636 passed, 4 failed in Chromium and the same in real Chrome on desktop, phone, TV 1080 and TV 720; every
  track-dropdown check passed in both, and the 4 failures are the baseline plugin's missing `history.files` (no History icon
  on the one-file row), not this change. Not verified: a file with DTS-HD MA, TrueHD or Atmos (none in the local media), a
  file with two versions, Dolby Vision or HDR10 marks, an ordinary user, a physical TV, the next-release plugin, Codex review.

  **P7.FU7, built (not accepted) 2026-10-19: an asterisk at the end of the required settings fields' labels, and no "(Optional)" anywhere** (user
  2026-10-19: "Go with asterisks everywhere", after [design/required-fields-audit.md](design/required-fields-audit.md) and
  [design/optional-field-marker.html](design/optional-field-marker.html); [UX.md](UX.md) §12.1, guide
  [settings-field.md](design/guides/settings-field.md)). Owner: Phase 7 (the settings area and wizard); web only, no plugin or API
  change. The star is the label's CSS `::after` (`.jfmod-required`, outside the accessible name) with `aria-required` on the input;
  twelve fields carry it (Prowlarr address and key while none is saved, indexer Name and Torznab address, download client Name, RPC
  address and both folders, the two mapping paths, and while shown Selected user and a separate seed's RPC address). `FieldForm`
  no longer appends "(Optional)" and the TMDB label is "TMDB API Read Access Token". Runners `s11-fresh.mjs` (Seconds between
  searches, Searches per day) and `whole-review-web.mjs` (Minimum seeders) lose the suffix. Web `feat/required-asterisk` from
  `main-stubs` (the former `next-release`) `2ac29996ae`. Not run: the full matrix, real Chrome, Codex review. Stale and left alone: `s11-fresh.mjs` 378, 385
  and 953 (*Upgrade until (Optional)*, an "Add a quality" list), which no longer match the profile dialog since P4.FU9.

  **P7.FU8, built (not accepted) 2026-10-19: the Prowlarr card loses its Name field** (user 2026-10-19, with a screenshot of the
  card: "I don't need field. It's useless", choosing *Name*; [UX.md](UX.md) §12.1, [API.md](API.md) *Settings*). Owner: Phase 7 S9
  (the Prowlarr source) and its settings card. Only one Prowlarr source can exist (`Create` answers 409 `prowlarr_source_exists`
  for a second), so the name never told sources apart; it only appears in the sync log, the `prowlarr_synced` history line and
  as the suffix on a synced indexer whose name collides. Web: the card shows Prowlarr address, Sync every, Sync on a schedule
  and the API key, and sends no name. Plugin: `name` is optional on `POST`/`PATCH /Settings/Prowlarr` (a new source is "Prowlarr",
  an edit without one keeps the stored name, `invalid_name` is gone); a name that is sent is still stored, so older callers keep
  working, and an existing source keeps its name. Runners `prowlarr-first.mjs`, `s11-fresh.mjs`, `settings-changes.mjs` and
  `settings-prowlarr.mjs` no longer fill the field; the `settings-changes.mjs` hygiene pass removes a Prowlarr source the snapshot
  lacked instead of one named `JellyfinMod …`. Web `feat/prowlarr-no-name` on `feat/required-asterisk` `f7a089d091`; plugin
  `feat/prowlarr-no-name` on `main-stubs` `5f2199e`. Not run: the full matrix, real Chrome, TV, Codex review.

  **P6.FU1, built (not accepted) 2026-10-15: Indexers before the Download Client in setup, and the client filled from
  Prowlarr** (user 2026-10-15: "Then you should reorder and put Prowlarr before Download Client", approving option 1 of
  [design/service-discovery.md](design/service-discovery.md); [PHASE7.md](PHASE7.md) §7, [UX.md](UX.md) §12.2,
  [API.md](API.md) *Settings*). Owner: Phase 7 S10 (the wizard), with S9's Prowlarr source. (1) Order: Discovery, Indexers,
  Download Client, Quality Profile, Turn Grabbing On, Optional, in `Setup/State`, the wizard, the settings area and the
  Dashboard page (its step numbers and Next links); step ids and deep links unchanged. (2) Plugin: `GET
  /JellyfinMod/Settings/Prowlarr/{id}/DownloadClients` (administrators only) reads Prowlarr's `api/v1/downloadclient` with
  the saved key server-side (no redirects, 20 s, 256 KiB cap), returns implementation, name, enabled, host, port, useSsl,
  urlBase, username and, for Transmission, the RPC address; never a password; plus the private default gateway from
  `/proc/net/route`. (3) Web: *Found in Prowlarr* in the Download Client section, one button per Transmission client that
  fills name, address and username and saves nothing; other kinds named as not supported yet; after a failed
  (unreachable) Test of a client taken from Prowlarr, one *Try <gateway>:<port>* suggestion that only fills the address;
  nothing shown without Prowlarr, without clients in it, on a failing Prowlarr, or once the client is verified. Plugin
  `feat/prowlarr-clients` from `next-release` `b52a64a`: `ae68ce4` (order), `2cdaea5` (endpoint). Web
  `feat/wizard-prowlarr-first`, rebased on `style/wizard-continue` (`13d274bd96`, P7.FU1): the research note, `90be6089ae`
  (order), `9eb75a57a0` (Found in Prowlarr), `9060b20000` (runner `prowlarr-first.mjs` and the Prowlarr stand-in's
  `api/v1/downloadclient`), `1543b611ab` (runner orders) and this docs commit. Evidence, local environment delta (Mac, under
  its lease): `PhaseSevenProwlarrIntegration` (download-client read: fields mapped, RPC address built, no password masked or
  not, no other field, key sent once server-side, 403 for an ordinary user, 401 anonymous, size cap, refused key, 404) and
  `PhaseSevenSettingsIntegration` (step order) pass in the Linux SDK container; `prowlarr-first.mjs` 75/75 in Chromium and
  75/75 in real Chrome on desktop, phone, TV 1080 and TV 720 (fresh setup resumes at Indexers, Prowlarr added and synced in
  step 2, Found in Prowlarr, Use fills without saving, the Test of Prowlarr's `localhost` fails with its normal message, the
  gateway `192.168.147.1` offered once and its Test passes, no key or password in any response, fixtures removed);
  `settings-area.mjs` 39/39 Chromium and Chrome; `settings-design.mjs` 852/852 Chrome, 844/846 Chromium (the two TV failures
  were the fixture: a synced indexer has no key to Clear; 348/348 on TV after adding a manual indexer); the Dashboard page's
  order, eyebrows and Next links checked in Chromium and Chrome. Not run: `setup-wizard.mjs` (needs a completed setup),
  `s11-fresh.mjs` (the Pi's disposable image container; its order expectations were updated, not run), the other plugin
  suites, a real Prowlarr, a physical TV, Codex review.
- Phase 1 follow-up, **planned (missed requirement, user 2026-10-13): missing media behaves exactly like available media,
  only without Play, in the mod's web and in stock apps.** The user: "Media availability should not affect watched, fav,
  info and other actions. EVERYWHERE.", "That should be expected in TMDb phase.", on the first plan's plugin table: "Why do
  I need a table if Jellyfin should have it?", "I'd expect everything will behave EXACTLY as when the file exists ...
  visible everywhere where with media it appears", and on native apps: Next Up "matters as iOS clients may use jellyfin
  server". Requirement: every missing movie, series, season and episode the plugin knows from TMDB (and every reclaimed one)
  is a real Jellyfin item with Jellyfin's own cards, pages, ✓ ♥ ⓘ ⋯, Favourites, filters, counts and search, per user;
  marking a season or series watched marks its missing episodes; a missing item marked watched or favourite arrives that
  way when its file comes, keeping the date; nothing offers it as playable, in any client. Owner: Phase 1 (the TMDb
  catalog). Touches Phase 5 (the import replaces the placeholder), Phase 3/10 (retention ignores placeholders and writes one
  back after a reclaim), Phase 4 (Get a Release and download states on placeholder items) and Phase 6/7 (Play hidden,
  marks, TV). Research on Jellyfin 12.0.0 (source `v12.0`, experiments on local environment delta, 2026-10-13): virtual
  items fail the bar in five places; a separate library duplicates series; user data needs an item; empty folders are always
  ✓. **Jellyfin's own media stubs** (0-byte `.disc` files) meet it: real items with full TMDB metadata and `IsPlaceHolder:
  true` for every client, never probed, refused for play by upstream web, carry-over of played, favourite and date when the
  real file replaces them. For stock apps a plugin MVC filter (proven live with a throwaway plugin) removes stubs from
  `/Shows/NextUp`, answers `PlaybackInfo` with `NotAllowed` and refuses downloads; no server change is needed.
  Plan: [`design/missing-media-user-actions.md`](design/missing-media-user-actions.md). Slices: **P1.FU24** stubs for
  missing episodes and seasons of held series plus the native-client filter; **P1.FU25** import swap and retention;
  **P1.FU26** file-less series and movies; **P1.FU27** backfill, mod surfaces become fallback-only (built, not accepted
  2026-10-17); **P1.FU28** Next Up's
  next real episode and play queues that skip stubs; **P1.FU29** placeholders come back after a delete in Jellyfin (built,
  not accepted 2026-10-17). No migration planned. Approved 2026-10-15 ("Go and implement isPlaceHolder"; on the plan's
  questions: "go with your recommendations": aired episodes only, a marked stub with Kodi's message, ~~off by default per
  library after a dry run~~ on by default with a per-library opt-out (user, after the first look on alpha: "Show missing
  episodes - should be enabled by default. That's the point."), nothing in read-only folders, Next Up to show the next real episode and play queues to skip stubs in P1.FU28,
  whose design is the plan's section 11). It reverses the 2026-09-04 and PHASE3 "no placeholder files" decisions (recorded in
  README and PHASE1). Commits carry `p1.fu24`–`p1.fu28` ids so the Phase 1 history reorganisation stays mechanical (the plan's
  section 8).
  **P1.FU24, built (not accepted) 2026-10-15: missing episodes of held series as Jellyfin placeholder items, and the
  native-client filter.** Owner: Phase 1 (the TMDb catalog); first part of the user-visible gate (first look pending). Plugin
  `feat/placeholder-stubs` from `next-release` `b52a64a`: `ca872f0` (code), `693bdbf` (Phase 5 suite check); web
  `feat/placeholder-stubs` from `next-release` `2173444a36`: the plan commit, `8cf2ad1b88` (code), `6f3c23b234` (runner) and this
  docs commit. Plugin: per TV library switch, on by default (`PluginConfiguration.PlaceholderDisabledLibraryIds`, an opt-out
  list, since the follow-up below), a dry run listing every path,
  the sync writing `Season NN/<Series (Year)> SNNENN.disc` where the import puts the file (shared `SeriesFolders`), only inside a
  library root and the bound series folder, never over a file, never beside a file that already is the episode, never through a
  link out of the series folder, nothing in a read-only folder (said in the dry run); stubs marked (first line
  `<!-- JellyfinMod placeholder v1 -->`, Kodi's `<discstub>` message) and only marked files ever removed or treated as the
  plugin's; `DateCreated` = air date and TMDB's runtime when Jellyfin creates or saves the item; reconciliation reads placeholder
  episodes as not on disk; the entry detail's `placeholderItemId`; a sync and the import remove an episode's stub when its file
  arrives; *Remove placeholders* with its own dry run; a six-hourly sync task; the MVC filter (Next Up and Latest without stubs,
  PlaybackInfo `NotAllowed`, Download, stream and HLS 404, playback reports dropped, `CanDownload` false; plugin stubs only,
  whatever the switch, fail-safe). No migration, version 0.1.0.0. API: [API.md](API.md) *Placeholders for missing episodes*.
  Web: upstream's placeholder rows on a season page get the row Not Downloaded mark (an administrator's Get a Release button),
  no Play on the image and no "Ends at"; a placeholder's page has no Play, Replay or "Ends at"; a placeholder's card anywhere
  carries the Not Downloaded indicator and no Play; a season or series with only placeholders reads as having no file;
  Settings *Missing Episodes* (switch, Preview, Remove Placeholders, each asking first); [UX.md](UX.md) §3.1. The mod's own
  missing cards and rows stay as the fallback where there is no placeholder. Checks: plugin build; Phase 1 smoke and Phase 2 on
  macOS pass, Phase 5 in the Linux container passes (with the new import-swap check); web typecheck, eslint (changed files and
  the runner: no errors), stylelint and the production build pass. Live on local environment alpha (Jellyfin 12.0.0, lease
  held by this session, the Shows library pointed at a writable copy of Peep Show, reset to the baseline afterwards): the
  read-only library's dry run writes nothing and says why; the writable one's lists 52 then (with a user's `.disc`, a 0-byte
  `.disc` and a `Season 08` link out of the folder added) 44 stubs; turning it on wrote 44 (52 seconds until Jellyfin held them
  all); a real file arriving for a played and favourite stub replaced it with played, favourite and date kept. New runner
  `missing-as-media.mjs` (real HTTP as a native app, then the browser; nothing intercepted): 49 checks, 0 failed in Chromium on
  desktop, phone and TV 1080 as oleksii and nata, with Remove Placeholders (only marked `.disc` files went, the user's two
  `.disc` files stayed) and the switch put back; a second run after the stubs were written again (stamping by the save
  listener alone): 24 checks, 0 failed. Not run: real Chrome, the TV at 1280×720, a real native app (the user's first look),
  stock `/web` (upstream's own bundle; the native-client HTTP checks stand in for stock clients), the import swap live
  through Transmission (the Phase 5 suite covers it), 28096 and the Pi, Codex review. Open: FU28 (Next Up's next real
  episode, play queues) after the first look; where upstream's series and season header Play start when the next episode is a
  placeholder was not checked (FU28's play-queue part).
  **Follow-up, built 2026-10-15 after the first look** (user: "Show missing episodes - should be enabled by default. That's the
  point."): the switch is on for every TV library, a new one included, and off only where an administrator turns it off
  (`PlaceholderDisabledLibraryIds`; the earlier opt-in element in an old XML is skipped by the reader, checked live); a sync
  writes at most 10 series per library and run with a 3-second pause between series and answers `pending`, and the task runs
  every 15 minutes, first one interval after start, so a large library fills in batches; `GET /Placeholders` says whether a
  library can be written at all. Settings *Missing Episodes* shows each library's state (On, Off (turned off by you),
  Read-only: nothing written) and count, turns it back on without asking, and on turning it off asks *Remove existing
  placeholders now?*. All guards unchanged. Checks: Phase 1 smoke (new: every TV library on by default, administrators only, a
  library with no writable folder writes nothing, a movie library has no switch) and Phase 2 pass on macOS; web typecheck,
  eslint, the production build. Live on local environment charlie (lease held by this session, reset afterwards; alpha was the
  user's first look): with the old opt-in element in the XML the plugin loads and the library is on; the read-only library
  (the real `:ro` mount) writes nothing and its dry run says `read_only` for every season (runner, 3 checks, 0 failed); on the
  writable copy `missing-as-media.mjs` (no longer turning the switch on itself, with the opt-out check: turned off, a sync
  writes nothing; turned back on, 44 written, 0 pending) 51 checks, 0 failed in Chromium on desktop, phone and TV 1080 as
  oleksii and nata with Remove Placeholders, and 29, 0 failed on desktop on the final build. Not verified: batching across
  more than one series (the local media set has one series); Phase 5 not re-run (the import is unchanged by the follow-up).
  **P1.FU25, built (not accepted) 2026-10-15: the import swaps a placeholder for the file in one step, and retention ignores
  placeholders and writes one back after a reclaim.** Owner: Phase 1; touches Phase 5 (the import) and Phase 3/10 (retention,
  PHASE10 S20). Plugin `feat/placeholder-swap` from `feat/placeholder-stubs` `709349f`; web `feat/placeholder-swap` from
  `477fc88874`. Import: once the file is linked, verified and recorded, and before the scan, the episode's marked stubs leave its
  series folder and every season folder in it (another folder that held one is reported too), so Jellyfin swaps the items in one
  refresh; the recovery of a `linked` import repeats it; an import blocked before its link changes nothing; a stub it cannot
  remove leaves the import complete, logged once, for the sync (`file_present`, now across the series' folders). The sync writes
  no stub for an episode with an open import (`importing`), counts a stub anywhere in the series, and treats a reclaimed episode
  as aired. Retention: a placeholder is never a candidate (preview `placeholder`, executor refusal, besides reconciliation never
  binding one); after a plain reclaim of an episode's last file (a multi-episode file: every episode it held) the plugin writes the
  episode's stub in the same folder under the import's name (TV library with placeholders on, writable folder inside the library,
  never a library folder), only after the unlink is recorded and never deleting anything, reports the folder, and appends
  "; a placeholder keeps the episode in Jellyfin" to the `reclaimed` history; the preview marks such rows `leavesPlaceholder` and
  counts `placeholders` (Settings' Retention line says how many). A series whose every file was reclaimed keeps its folder for the
  import and the sync (the entry's series item). Web: a placeholder's page opens the file's page by itself once the swap lands
  (its entry is read by id, since the placeholder's item is gone); Retention help and preview line. Movies keep no stub after a
  reclaim (file-less movies are P1.FU26). API: [API.md](API.md) *Placeholders* (the swap) and *Retention* (preview fields).
  Checks: plugin build; Phase 5 (new `PlaceholderSwapScenarios`: a season pack swapping three stubs, one in the series folder;
  a dry run and a sync while an episode downloads write none for it; a blocked import leaves its stub byte for byte; a read-only
  folder: the import completes, one warning, the next sync removes the stub, only it) and Phase 3 protection (new: a bound stub
  blocked and refused; a reclaim and a multi-episode reclaim leave exactly their stubs; history; a movie gets none) pass in the
  Linux container, as do Phase 4, 6 and 7 settings (unchanged); Phase 1 smoke, 2, 3 and 10 on macOS pass; web typecheck and eslint on the changed files. Live on local
  environment charlie (Jellyfin 12.0.0, lease held by this session, Shows pointed at a writable copy of Peep Show, reset to the
  baseline afterwards; seed protection pointed at an empty Transmission stand-in): S01E02 watched and favourite by oleksii,
  retention (1-minute test window) reclaimed it, left `Peep Show (2003) S01E02.disc`, and Jellyfin's new item for it carried
  played, play count 1, favourite and the original date by key (new item id, the old one 404); the plugin recorded no new
  completion and the history says a placeholder was left; the stub never appeared in the preview. A file swapped in for a
  played and favourite stub carried the marks the same way (and its retention waits for a new watch). In Chromium the stub's
  page (no Play, Get a Release) turned into the file's page with Play 105 s after the swap, without a reload. **Found:** Jellyfin
  12's list endpoints (`/Shows/{id}/Episodes`, `/Items`) can show a just-swapped item as unplayed until a restart when a client
  read it in the second or two before its first metadata refresh (its user-data key is then its id); `/Items/{id}` and the
  played and favourite filters are right throughout, and an item not read in that window lists right. Not run: an import
  through Transmission on a live instance (the suite covers the plugin side; the physical swap was checked live), real Chrome,
  phone and TV layouts, 28096 and the Pi, Codex review.
  **Follow-up, fixed 2026-10-15 (plugin `abfcdec`):** the cause is Jellyfin 12's `UserDataManager`: list answers read user data
  through `GetUserDataBatch`, which caches each user's data per item id and caches "unplayed" for an item with no stored rows;
  the old item's rows are re-attached to the new id only at its first metadata refresh (`ReattachUserDataAsync`), which never
  touches that cache. After a new movie or episode's first refresh, when it then holds stored user data, the plugin saves each
  such user's data once more, unchanged, through `IUserDataManager` (`UpdateUserData`), which replaces the cache entry; the
  retention listener skips that save (no completion), the Trakt plugin acts only on `TogglePlayed`, the plugin's Trakt indicator
  only on `Import`. Live on local environment charlie (no restart): a list read caught a swapped-in episode as unplayed right
  after it appeared and it read played and favourite 1 to 2 s later, in every run; checked by `placeholder-titles.mjs`.
  **P1.FU26, built (not accepted) 2026-10-15: movies and series with no file as Jellyfin placeholder items.** Owner: Phase 1;
  touches Phase 5 (the movie import swap), Phase 3/10 (a movie reclaim leaves a placeholder) and Phase 7 (Settings). Plugin
  `feat/placeholder-titles` from `feat/placeholder-swap` `636293c`: `af75778` (code), `1ee91ea` (suites); web
  `feat/placeholder-titles` from `b65cf75ff5`: `b737557361` (cards and pages), `58d35e9f9c` (Settings status), `777ba50bd8`
  (runners) and this docs commit. A released movie with no file (added from TMDb, wanted, or reclaimed) gets a marked placeholder
  where its import puts the file (`Title (Year) [tmdbid-N]/Title (Year) [tmdbid-N].disc`, first writable library folder, or its
  `[tmdbid-N]` folder already there); an unreleased one gets none. A series with nothing on disk gets its own `Series (Year)
  [tmdbid-N]` folder with a placeholder per aired episode. Same guards as P1.FU24 (marker, only marked files removed, never over a
  file, path checks, nothing in a read-only folder, per-library switch, now listed for movie libraries too, batched sync, dry run
  and Remove Placeholders); Add, the first episode-list load and Refresh sync that entry at once. Jellyfin makes the items at its
  next look at the folder (its library monitor delay, about a minute). Reconciliation never binds a placeholder movie and
  backfills nothing from placeholders alone; the entry stays not on disk, finds its item (`placeholderItemId` on the entry
  detail and Browse rows; `Entries?jellyfinItemId=` with the placeholder movie's id) and Browse answers the placeholder item as
  the title's one row carrying the entry (its state for the state filter). The import puts the movie's file into the
  placeholder's folder and removes the placeholder in one step; a file-less series' first episode lands in its placeholder
  folder. A reclaim of a movie's last file in a folder of its own leaves the movie's placeholder (preview `leavesPlaceholder`,
  history note). Removing a never-imported title from the catalog removes its placeholders and the folders left empty (a series
  bound only to its placeholders' series item can now be removed). Stub episodes of a file-less series get TMDB's runtime and
  their air date (found by the series' binding or TMDB id). The response filter already covered placeholder movies (Video).
  Web: the mod's file-less card gives way to the placeholder's card (mark, no Play, administrator's centre cloud; the injected
  Not Downloaded mark on stock cards for placeholder movies and all-placeholder series, never two marks), the mod's
  `?entryId=` page opens the placeholder's page, an all-placeholder series page has no Play, a placeholder movie's page follows
  its import to the file, Recently Added keeps placeholder titles by their added date; Settings *Missing Episodes* has a status
  line and state in the rail and its head like every other section (coordinator, from the user: it "does not have on off and
  status similarly to for example Retention"). API: [API.md](API.md) *Placeholders for missing episodes and titles*; UX: [UX.md](UX.md)
  §3.1. Checks: plugin build; Phase 1 smoke, 2, 3 and 10 on macOS pass; Phase 3 protection (new: a movie reclaim leaves its
  stub, history note, preview) and Phase 5 (new: a placeholder movie written, never bound, found by its id, imported into its
  folder with the placeholder gone; a file-less series' folder for aired episodes only, removed with its entry) pass in the Linux
  container; web typecheck, eslint on the changed files, production build. Live on local environment charlie (Jellyfin 12.0.0,
  lease held by this session, the Movies and Shows libraries given an extra writable folder, no TMDB token: Jellyfin's TMDb
  connection; reset to the baseline afterwards): new runner `placeholder-titles.mjs` (TMDb search and Add of a movie, a series
  and an unreleased movie as the mod does, then real HTTP as a native app and the browser; nothing intercepted) 76 checks, 0
  failed in Chromium on desktop, phone and TV 1080 as oleksii and nata (before the series-stamp fix), and on the final code 77
  checks, 0 failed in real Chrome on the same layouts and users (with the stamp check).
  `settings-area.mjs` (now with Missing Episodes): every section opens and the status reads the same in the rail and the head on
  desktop and phone, TV reaches every section; its desktop run then stops at the Discovery test button (a click timeout in the
  Discovery section, which this slice does not touch; not diagnosed; Chromium and Chrome alike; one Chrome TV run also logged a
  `selectedIndex` page error that two reruns in both browsers did not repeat). `missing-as-media.mjs` (P1.FU24) on the swapped
  series: 28 of 29 before the stamp fix (the missing runtimes of a file-less series' stubs), 29 of 29 on the final code. Not run: an
  import through Transmission on a live instance (the Phase 5 suite covers it), the TV at 1280×720, a real native app, stock
  `/web`, 28096 and the Pi, Codex review. Known: an empty library folder Jellyfin has never scanned has no folder item, so the
  first placeholders written into it wait for the next library scan (the local test setup scans once after adding the folder).
  **P1.FU28, built (not accepted) 2026-10-15: Next Up shows the next real episode after a gap, and play queues skip
  placeholders.** Owner: Phase 1; touches Phase 6/7 (playback in the web). Plugin `feat/placeholder-queues` from
  `feat/placeholder-titles` `1ee91ea`: `c3a9f94`; web `feat/placeholder-queues` from `9a9e876b08`: `370716cab7` (code),
  `998b8b3c83` (runner) and this docs commit. Design and what is fixed where: [design §11 and §15](design/missing-media-user-actions.md).
  Plugin (the response filter only, in process, no second HTTP call): Next Up puts in a placeholder's slot the first episode of
  the series after it that is neither a placeholder nor virtual (the placeholder's played state, specials left out), as the
  stock answer with the request's own fields, image and user-data options, and only when the user may open it (a user-scoped
  query applies parental rating and tags; library access is checked on the item, because a query by series key does not apply
  it); the slot is dropped, total lowered, when no real episode follows, it is already in the page, or it is resumable and the
  request said `enableResumable=false`. Resume leaves placeholders out; `/Shows/{id}/Episodes` with `startItemId` (sent only by
  queue builders: upstream web, Android TV) leaves out the placeholders after the start item. Listings are unchanged
  (`isMissing=false` is also Swiftfin's season-list request). Web: upstream's one queue step (`translateItemsForPlayback`) hands
  every queue to `integration/playQueue.ts`, which leaves placeholders out and starts at the first playable item at or after the
  one asked for (patch surface: `playbackmanager.js`, one import and one call, [PHASE7.md](PHASE7.md) §3.2). **Server-side:** Next
  Up (Home row, apps, the series Play start of upstream web, Findroid and Android TV), Resume, episode queues from a start item.
  **Web only:** Play All, Shuffle, Play from here, season and series Play and Shuffle, a library's Play All and Shuffle with
  placeholder movies, Add to queue and Play next (the Jellyfin iOS and Android apps show this web). **Not fixable without a
  server change:** native apps' season, series and library queues (Swiftfin, Findroid, Infuse, Kodi playlists, Android TV's season
  play) and server-driven play-next: they reach the placeholder and stop with `NotAllowed`. Instant Mix is audio only in Jellyfin
  12. **Found:** Jellyfin 12's own `/Shows/NextUp?seriesId=` answers for a series in a library the user cannot open (stock
  behaviour, not the filter's; not changed). Checks: plugin build; Phase 1 smoke and Phase 2 on macOS pass; web typecheck, eslint
  on the changed files and the runner, patch-surface check, production build. Live on local environment charlie (Jellyfin
  12.0.0, lease held by this session 21:05 to the end of the run, reset to the baseline afterwards; Shows pointed at a writable
  copy of Peep Show with small `.webm` files for S01E01, S01E02, S01E05 and S02E02, the plugin's placeholders for the other 50;
  Fawlty Towers added from TMDb as a file-less series with S01E04 swapped for a `.webm`; The Matrix Reloaded as a placeholder
  movie and a `.webm` movie in Movies' writable folder): new runner `placeholder-queues.mjs` 49 checks, 0 failed in Chromium and
  49, 0 failed in real Chrome on desktop, phone and TV 1080 (22 HTTP checks as a native app: Next Up untouched, in a season,
  across a season, at the end, two series with limit/startIndex and totals, `enableTotalRecordCount=false`, rewatching,
  `parentId` and `nextUpDateCutoff`, resumable, a blocked tag on the real episode (nata gets the next one she may see), no library
  access (nothing), the replacement's DTO options; Resume and its legacy route; listings keep placeholders, `startItemId` queues
  do not; Instant Mix; PlaybackInfo; and per layout Home's continue row, the series' Play (starts at S01E05), the season's Play,
  Shuffle, an episode's Play (queue E02, E05, S02E02), Play All From Here on a real and on a placeholder row (TV rows have no ⋯:
  not verified there) and the movie library's Play All and Shuffle, read from the web's own start report). The P1.FU24 runner
  `missing-as-media.mjs` on the same instance: 29 checks, 0 failed (Next Up now answers S01E05). Not run: a real native app
  (Swiftfin, the Jellyfin iOS app, Infuse, Kodi, Android TV), Phase 5 in the Linux container (the filter is not in its host),
  the TV at 1280×720, 28096 and the Pi, Codex review.
  **P1.FU27, built (not accepted) 2026-10-17: the existing catalogue is backfilled with placeholders, with progress, Sync Now
  and a watched restore; the mod's own missing surfaces become the fallback.** Owner: Phase 1; touches Phase 3/10 (the restore,
  [PHASE10.md](PHASE10.md) S21) and Phase 4 (the download block). Plugin `feat/placeholder-backfill` from `feat/placeholder-queues`
  `c3a9f94`: `25ae18d` (code), `0549abb` (suites); web `feat/placeholder-backfill` from `0707607aef`: the code, runner and docs
  commits. Design and what is where: [design §16](design/missing-media-user-actions.md). **Automatic:** the sync task's trigger
  fires every 5 minutes; while placeholders are pending each run writes a batch (10 titles per library, 3 s apart; unchanged),
  else every 15 minutes; never two batches at once (Sync Now answers 409), never during a Jellyfin library scan (the batch waits,
  or ends after the title in hand), one report of the changed folders per run. **Found on Jellyfin 12.0.0 and fixed:** an interval
  task that has never completed first runs one hour after start and a queued run does not re-arm it (a starter queues the first
  batch 5 minutes after start and re-arms the triggers); Jellyfin re-arms at `max(last end, last start, now + 1 min) + interval`,
  so the busy pace is one batch every 6 minutes; a library folder that was empty at its last scan has no item and a report of it
  refreshes nothing (a run that wrote into one asks for a library scan once). **Needs the administrator only for:** turning a
  library off, Sync Now (optional), Remove Placeholders, Restore Watched State From Retention History (dry run, then a
  confirmation). Settings *Missing Episodes* shows `Placeholders: N of M titles done · P placeholders pending` and the pace. API:
  [API.md](API.md) `Placeholders/Progress`, `SyncNow`, `RestoreWatched`. **Web:** a placeholder episode's or movie's Jellyfin page
  shows the download block (P1.FU20) where a file's page has its track selectors; the mod's missing season cards and episode rows
  show only where Jellyfin has no item, and an item that appears mid-visit replaces them when upstream's own list (drawn again by
  the mod, upstream's file unpatched) shows it, without a reload and never two rows for one episode; the season card's count adds
  the mod's own rows; the mod's own episode, season and title pages open Jellyfin's page once a placeholder appears. No code
  removed (no fallback is unreachable).
  **Checks:** plugin build; Phase 1 smoke (new: Progress, Sync Now and the restore administrators only, their shapes), Phase 2 and
  Phase 10 on macOS pass; Phase 5 in the Linux container passes with the new `BackfillScenarios` (25 pre-placeholder series and a
  reclaimed one converge in three Sync Now batches of at most 10 with the counters following, a running scan defers a batch with
  nothing written, each batch reports once at the library folder, a second Sync Now during a batch is 409, one stub per episode;
  the restore waits before Jellyfin's first refresh, lists only the user with no data with the recorded date, ignores a revoked
  record and an unreclaimed episode, saves exactly that mark, a second run none, one history line) and Phase 3 protection passes;
  web typecheck, eslint on the changed files and the runner, production build. **Live on local environment charlie** (Jellyfin
  12.0.0, no TMDB token: Jellyfin's TMDb connection; lease held by this session; reset to the baseline afterwards): a synthetic
  catalogue seeded into the plugin database with the container stopped, of 191 real TMDB titles found through the plugin's
  discovery: 130 file-less series (3 aired episodes each), 10 held series with a file in the writable Shows folder (3 also an
  S01E02), 6 reclaimed series and 5 reclaimed movies with completion records, 40 file-less movies. **Convergence:** 480
  placeholders pending at start, 191 of 191 titles done in 15 batches (12 scheduled, 3 Sync Now from the runners): the first 5 min after start, then one
  every 6 min; 54 s per batch while both libraries had work, 27 s once only TV had; at the busy pace a catalogue this size takes
  about 5 + 14 × 6 = 89 minutes (the Mac slept through part of the run, so the wall clock is not the measure). 487 placeholders
  (TMDB list loads added some) all Jellyfin items, no duplicate file or item at any of 140 samples. **Scan load:** no full library
  scan except the one asked for the empty Movies folder; Jellyfin refreshes each new placeholder, its season and its series once
  through its own file monitor (470 refresh lines for 487 placeholders, peak 124 in a minute) plus one metadata-named pass later;
  container memory rose with the item count from 253 to a median of 630 MiB (max 745), CPU median 0.3 %. **Reclaimed titles:**
  every one got its placeholder. Three S01E02 files marked watched by oleksii (genuine `TogglePlayed` completion records), deleted
  and marked reclaimed: parked within 90 days (The Night Shift), the placeholder came back played, play count 1, original date, by
  key; parked rows aged past 90 days and Jellyfin's *Clean up user data* run (Sunday Night Theatre), or the rows deleted (The Night
  Of), it came back unplayed. Jellyfin's cleanup deletes detached rows older than 90 days only when run: it has no default trigger
  in 12.0. Restore dry run: 13 marks (those two and the 11 seeded reclaimed titles) with their recorded dates, 1 kept (The Night
  Shift), 0 waiting; applied: all 13 played with their dates; a second run restores nothing (14 kept). **Found and fixed:**
  Jellyfin's `SaveUserData` refreshes only the item instance it is given, so a save through a freshly loaded copy left two
  placeholders that had just been read answering unplayed until a restart; the restore now saves through the cached instance
  (rechecked: a cached placeholder read played at once on its page and in its season list). Runner `placeholder-backfill.mjs`
  (queue answers intercepted for the block, everything else real): 93 checks per browser on desktop, phone and TV 1080 as oleksii and nata (the block's Not Downloaded, Downloading, a season
  pack's own file with its line and dots, Importing, Failed, the actions per role, no Play; a placeholder movie's page; the ring on
  the placeholder's own season row; one row per episode and one card per season with the right count; search once; Peep Show's
  read-only fallback rows; Settings' progress line, Sync Now and Restore Watched State's dry run): Chromium 92 of 93 and Chrome 92
  of 93, the one failure in each the intermittent page error below. Mid-visit swap (desktop): a placeholder removed
  inside the container, the season page showed the mod's row, Sync Now wrote it again and Jellyfin's row replaced the mod's with no
  reload and never both at once (sampled every 500 ms), 4 checks, 0 failed. **Found, not fixed (outside this slice):** on TV an intermittent
  `selectedIndex` page error, `maintabsmanager.selectedIndex` called by the mod's Home page (`routes/HomePage.tsx`, unchanged here)
  resuming its tabs after the runner had already left Home; seen in Chrome and once in Chromium (P1.FU26 saw it too).
  **Not run:** the Pi and 28096 (a measurement of 28096's 105 shows), a real TV and real native apps, the TV at 1280×720, Codex
  review; the switch-off-then-Remove path in the browser (Remove Placeholders itself is P1.FU24's, unchanged). Fixture artifacts
  that are not product behaviour: the seed gave episodes made-up TMDB ids, so opening a series page (P1.FU9's list load) added a
  second plugin row per position; a file deleted from the macOS side stayed visible to `stat` inside OrbStack's VM.
- Phase 1 follow-up **P1.FU32, built (not accepted) 2026-10-19: when it was watched, in the played tick's tooltip** (user,
  2026-10-19: "hover over watched check should show a hint when it was watched"). Web only, on `feat/watched-hint` from
  `main-stubs`; no upstream file touched (mounted in the mod's `ModApp.tsx`), so the patch surface is unchanged. Hovering
  upstream's played tick on a card, a list row's or the detail page's Played button, or the Watched button of a card's hover
  menu shows `Watched 12 Oct 2026, 9:41 pm` (the user's `LastPlayedDate`, in the date locale); a played item with no date says
  `Watched`; series, season and collection ticks are left as they are (their own date is empty, and their episodes' latest would
  cost a request per card). One `GET /Items?Ids=` per page for the played ticks it shows (none on TV and phone, which have no
  hover), kept current by `UserDataChanged`. Rule in [UX.md](UX.md) §5.7; code `integration/watchedHint.ts`. First look on
  local environment bravo (Chromium, desktop): movie and episode cards, a React library grid's card, season-page rows, the
  episode and movie Played buttons; Home and the Shows grid 0 extra requests, the Movies grid and the season page 1. **Not
  run:** real Chrome, the phone and TV layouts, a placeholder (missing-media) item, a large library, Codex review.
- Small web follow-ups of 2026-10-24, **built (not accepted)**, web only, on `fix/row-cursor` from `main-stubs` (so both lines
  carry them); no upstream file touched. **P1.FU33** (user: "Episodes list view when hover over poster no hand icon, as everywhere
  else"): on a computer upstream draws a season's episode rows with no row action (`.listItem[data-action=none]`, the arrow), yet
  their image opens the episode; an additive rule in `integration/placeholderPage.scss` gives such an image the hand, an image with
  no action keeps the arrow; phone and TV rows were already links. **P4.FU18** ("Shows page - I click download and by default
  should be selected 'All Seasons'"): the release picker opened from a series page or a series card starts on All Seasons (it
  started on the non-selectable *Choose what to search for* and searched nothing); a season page keeps its season, an episode
  page its episode ([UX.md](UX.md) §9). **P4.FU17** ("update dropdown with profiles to contain more detailed information"): the
  Grabbing step's and section's Default quality profile options show the Quality Profiles row's summary under the name
  ([guides/quality-profiles.md](design/guides/quality-profiles.md)). **P4.FU19** ("As for quality profiles see more about it
  here", on the picker's native profile list): the release picker's Quality Profile becomes the same two-line MUI menu, drawn
  like the scope switch, choosing as before. **P7.FU9** ("replace http://host:9696 with clickable
  http://prowlarr:9696", "add inside API Key field … Key Page and link to prowlarr"): the Prowlarr address's example fills the
  field, and the empty API key field links to `<address>/settings/general` while the address is a URL
  ([guides/settings-field.md](design/guides/settings-field.md), UX §12.1). Checked on local beta (items line) in Chromium headless
  only; **not run:** real Chrome, the TV layout, any runner, Codex review.
  **P4.FU20, built (not accepted) 2026-10-24: library-found titles take releases that carry their ids, and come back after a
  delete** (user 2026-10-24: every UA. utp.to release for The Matrix (1999) on alpha refused with "The indexer reports a
  different title identity"; "keep the TVDB rule"). Owner: Phase 4. An entry made when Jellyfin first saw a file kept the
  folder name, no IMDb id and no release date, so the evaluator counted a release's IMDb id as a mismatch and the placeholder
  plan counted the movie as unreleased (a delete in Jellyfin never brought it back). Now a provider id is a mismatch only when
  both sides know it; a movie release carrying a TVDB id is a series (Teen Titans and The Matrix Reloaded share TMDB id 604).
  Reconciliation fills what an entry lacks from the Jellyfin item (the name while the title is still the folder name, IMDb id,
  year, release date, overview, runtime); existing entries get it on the next reconciliation pass, new ones on Jellyfin's
  first metadata update, which now counts as a change. A movie with no release date but an earlier year counts as released
  (stubs line; the items line had it), and a title already in folder form is not tagged twice. Plugin main-stubs `b0b59c5`
  `fdf6a9d`, main-items `0789cb0` `f1b94aa` (the items line carries its own copy). Phase 2/3/4/5 suites pass on both lines;
  live on bravo (Prowlarr utp.to, delete repair) on both. **Not run:** real Chrome, full matrix, Codex review.
  Then (user 2026-10-24: "for TMDb can you add to compare TV show or Movies so no confusion?") a release's TMDB id is
  compared only when the release is the same kind as the entry: the kind comes from a tvdbid, the Torznab categories
  (2000s movie, 5000s TV, every `<category>` now read) and season/episode/pack markers in the name; a release the indexer
  lists as the other kind is refused ("The indexer lists this release as a TV series, not a movie." and the reverse) even
  with an equal TMDB number; series now compare TMDB ids too; an undecided kind keeps the old comparison. Plugin main-stubs
  `ebebff3`, main-items `b451577`; Phase 4 and 6 pass on both lines.
  **P4.FU21, built (not accepted) 2026-10-24: a season's and a series' total download in its header** (user 2026-10-22: "Season
  total is good too but apply new download state text"; 2026-10-24: "keep B", "yes add series page total"; the design session's
  proposal, artifact <https://claude.ai/artifact/B6Ro1yXbYBfvpGWNiYgck4>, [design note](design/season-total-download.md) with its
  page and screenshots; [UX.md](UX.md) §3.3; guide [download-state-mark.md](design/guides/download-state-mark.md) *Where it sits*,
  *Text*). Owner: P4.FU6's ring family. Web only, no plugin change: the queue rows already carry the bytes, sizes, time left and
  each pack episode's progress. On the native and the mod's season page and on the native series page
  (`components/SeasonTotal.tsx`, mounted by `NativeEntryDetails` and `EntrySeasonDetails`; `seasonTotal.scss`): a non-button
  `span.jfmod-seasonTotal` in upstream's action row after Get a Release (its header button names `jfmod-seasonTotal` in `before`)
  and before Favourite, holding the row-size ring and `N of M episodes · <state text>`; on the phone the figure is a centred line
  under the row (`.jfmod-seasonTotalLine`). The whole figure is treatment B (P4.FU15): text colour, 600, Inter, tabular figures,
  queued and stalled at 75 %, no "Downloading" word, no animation. The total is `batchProgress` in `constants/queue.ts` (beside
  `aggregateProgress`, which the cards keep unchanged): M every episode of the season (or of every season) a queue row names (a
  pack once per episode, a finished one by a row still listed), N those in the library, failed and blocked left out, the percent
  bytes over the batch when every size is known else the plain mean, the longest time left of the torrents downloading, the
  liveliest kind; the tooltip adds the breakdown, by state on a season (`2 done, 4 downloading, 2 queued`) and by season on a
  series (`Season 1: 3 of 8 · Season 2: 2 of 8`). Never a control or a stop, an administrator's included (P4.FU16's client link
  is not on it). The mod's own page for a series with no Jellyfin item keeps its raised buttons and has no total. Gate 1 (first
  look) on local environment charlie (Jellyfin 12.0.0, web `main-stubs` `b22ddee0c8` plus this slice, plugin `main-stubs`
  `fdf6a9d`), Chromium headless, intercepted queue answers for Peep Show: the native Season 1 page, the mod's Season 2 page and the
  series page, queued, downloading, importing, mixed and none at desktop 1440, phone 360 and TV 1920×1080, dark and light. Row
  order Play, (Trailer,) Shuffle, Played, Get a Release, total, Favourite, More; the TV's focus skips the total; the series
  tooltip reads `Downloading · 53% · 3 h 20 min left · 4 MB/s · Season 1: 1 of 2 · Season 2: 2 of 6`. Not run: real Chrome, the
  TV at 1280×720, a live download, the full runner matrix, Codex review.
  **P2.R7 follow-up, built (not accepted) 2026-10-24: a binding outside every library root is dropped and never fallen back
  to** (user 2026-10-24: "start the Peep Show stale data fix"). Owner: Phase 2 (reconciliation), with the delete repair of
  P1.FU29/P4.FU12. A binding under a root the library no longer has (local beta: Peep Show under `/data5/TV Series`, removed
  as a library path while its files stay) could never be proven absent, so it was kept and, after Peep Show was deleted in
  Jellyfin, the delete repair fell back to it: the entry stayed on disk through a gone series, two episodes pointed at gone
  items and the series page hid them, no placeholders came back. Now a binding outside every current location of its
  library is dropped by the post-scan absence check and by the delete repair of its title even when its file still exists
  (only the row; no file is touched), and the delete repair never falls back to a copy whose Jellyfin item is gone. This
  replaces P2.R6 acceptance item 4's direct existence check for files outside the current locations; files under a current
  root keep the old proof rules. Plugin main-stubs `0c54488`, main-items `c237796`; Phase 2/3 (macOS) and Phase 5 (Linux)
  pass on both lines, new checks fail before the fix; live on local echo on both lines. An env's next library scan cleans
  existing stale bindings. **Not run:** browser check of the series page, the Pi, Codex review.
  **P4.FU22, built (not accepted) 2026-10-24: Russian and Ukrainian tracker names match by title words and year, full
  discs are refused, and a Blu-ray rip is labelled as a rip** (user 2026-10-24: every RuTracker release for Inception (2010)
  refused as a title mismatch). Owner: Phase 4. RuTracker, Kinozal and Mazepa put a local title first (`Начало / Inception
  [2010, США, …, UHD BDRemux 2160p]`), so the parsed title never matched. When it does not, the evaluator now looks for the
  entry's title or original title as whole words anywhere in the name (bounded by the start, a bracket, a slash or a leading
  article before it, and the end, a bracket, a slash, a year or a season or episode marker after it); a film's year is the
  first one after the title, and a run of years is a collection and refused. Provider-id rules are unchanged and still win.
  Season forms `S1E1-6 of 6`, `Сезон: N`, `Серии: A-B из C` are read. A pixel resolution wins over UHD/4K; a full Blu-ray
  disc (BD25/50/66/100, Full BD, BDMV, ISO, BR-DISK, COMPLETE BLURAY) is source `disc` and refused with "Full disc releases
  cannot be imported."; BDRip, BD-Rip and BRRip stay in the Blu-ray tier but carry their own word (`parsed.rip`), which the
  picker shows instead of "Blu-ray", and a full disc reads "Full Disc" (web `ReleaseRowParts.tsx`, `constants/quality.ts`,
  [guides/quality-profiles.md](design/guides/quality-profiles.md), [UX.md](UX.md)). Plugin main-stubs `731b1e1`, main-items
  `d8c6804`; web main-stubs `9cf758429c`, main-items `89b02c201c`. Phase 4 (with its new real-tracker-title scenario) passes
  on both lines in the Linux SDK container; web typecheck and eslint clean on both. Live on local alpha (stubs) and beta
  (items), Inception (2010): RuTracker 27 rows, the 19 named `Начало / Inception [2010` none refused for the title (7
  eligible, 10 without a readable resolution, 2 full discs), the 8 for other titles (The Cobol Job, Extras, HBO First Look)
  refused for the title; all 50 BDRip/BRRip rows across indexers labelled as rips. **Not run:** the picker in a browser, real
  Chrome, the Pi, Codex review.
  **P4.FU23, built (not accepted) 2026-10-24: an indexer gets 60 seconds for its queries** (was 20). Owner: Phase 4.
  `TorznabOptions.Default` covers all of one indexer's queries and pages; indexers behind Prowlarr (1337x through
  FlareSolverr, RuTracker) take 10 to 22 seconds a query, since Prowlarr reads paced pages and queues every client's query
  behind the one before, so a title that needs its fallback query ran out of time and came back partial. Plugin main-stubs
  `d8037cc`, main-items `89b16f1`; Phase 4's new slow-indexer scenario (two 12-second queries under the production bound)
  passes on both lines. **Not run:** the Pi, Codex review.
  **P4.FU24, built (not accepted) 2026-10-25: the release picker shows releases as indexers answer** (user-approved design,
  2026-10-25, without the small ring in the status line; workspace `reviews/progressive-results/` DECISION.md and mockup;
  [UX.md](UX.md) §9). Owner: Phase 4 (the picker and the progress side channel). Plugin: each indexer that answers stores the
  ranked rows so far (blocklist read before the fan-out) as a snapshot under the search id fixed at the start, and
  `GET /Releases/Progress/{key}` returns it as `search` with its grab availability; the final snapshot replaces it under the
  same id, so the existing grab path (`searchId` + `releaseId`) takes a row before the slowest indexer is done. Web
  (`ReleasePickerDialog.tsx`, `releasePicker.scss`): the rows replace the searching block once any indexer has rows; the status
  line reads `N releases so far · waiting for …` (names in `#74c9ec`, `#0277bd` on the light theme); rows grab while others ask; a late indexer's rows carry
  `.jfmod-releaseItem--arrived` (a primary left edge fading over 2 s, no tint; user 2026-10-25 first look), only the
  release list scrolls (`.jfmod-releaseScroll`; header, choices, notice and status line stay at the top); the hovered (after the pointer moved) or focused
  row keeps its screen place; the final answer wins and the finished state is unchanged. Phase 4 checks a fast indexer's rows
  are readable from the progress and grabbable (then cancelled) while a slow one still asks (passes in the Linux SDK
  container). Plugin `feat/progressive-results` `5a4b095`, web `feat/progressive-results` `4393c30ad9` `eca633e10c`, both from `main-stubs`;
  items line `feat/progressive-results-items` from `main-items`: plugin `c6e72ba`, web `77a0d021a3` `12fd0c9e81` (cherry-picks); Phase 4
  passes on both lines in the Linux SDK container. Gate 1 (first look) on local alpha, approved 2026-10-25 with two changes
  (edge-only mark, list-only scroll; follow-up commit). Gate 2: alpha (stubs, bundle `e14b1d27ffbd`) and beta (items, bundle
  `f1a839687682`), Inception (2010): Playwright Chromium laptop 1280×860, phone 390×844 and TV 1920×1080 in dark and light, and
  real Chrome laptop dark and light, 16 runs, all checks pass (first rows replace the block, status and asking colour, no
  partial line while asking, edge-only arrival, the hovered or D-pad-focused row moves under 0.5 px while the Quality Profile
  stays put, finished status, one search id); on each environment Add was pressed on the rows so far 1.7 s before the search
  ended, held (202) and cancelled during the hold, nothing sent, `/Grabs` empty. Progress was replayed to the page at stretched
  timing (the server's own answers) so each state could be checked. **Not run:** the TV at 1280×720, a real TV or phone, the Pi. Codex GPT-6.1 Sol high: approve with fixes, three
  P2s fixed in follow-up commits (Progress rechecks on every poll that the requester can still read the entry, episode and
  pack episodes, else the concealed 404, with a mid-search check in Phase 4; the rows so far reach screen readers through the
  live region; a focused Rejected toggle is kept in place), and the fix delta approved; Phase 4 and the affected browser runs
  re-passed. The waiting names use `#0277bd` on the light theme (4.8:1 on white; user 2026-10-25). Room is left for the Sources control
  in the title row (a later task).
  **P4.FU25, built (not accepted) 2026-10-25: the release picker's Sources and each indexer's colour** (user-approved design,
  2026-10-25, finished state F1, and the searching ring recoloured the same day; design note
  [release-picker-source-filter.md](design/release-picker-source-filter.md) Revisions 2, 5 and 5b, mockup
  [release-picker-sources-dot.html](design/release-picker-sources-dot.html); [UX.md](UX.md) §9;
  [guides/release-picker-sources.md](design/guides/release-picker-sources.md), [guides/indexer-colour.md](design/guides/indexer-colour.md)).
  Owner: Phase 4 (the picker and its search). Plugin: `AcquisitionIndexer.ColorIndex` (migration `IndexerColours`, forward-only:
  the indexers already there get the palette in priority-then-name order), given on first save as the least used of eight and
  kept; returned in `GET /Settings/Indexers`, every search's and progress line's `indexers[]` and each candidate
  (`indexerColorIndex`); `GET /Releases` takes optional repeated `indexerIds` and asks only those enabled indexers (409
  `no_chosen_indexers` when none is). Web: the funnel icon first in the title row with its corner dot and the train, the checklist
  (untick hides, tick-in asks alone and merges, new searches ask the ticked, remembered per browser), the status line's
  `N of M sources`, the ring's segments and lines in indexer colours, the colour before each indexer's name in both settings
  pages. Phase 4 checks the colours across adds, a removal, a wrap and a restart, and that `indexerIds` asks only those
  indexers. Plugin `feat/picker-sources` `11b74cb`, web `feat/picker-sources` `044e572b5e`, both from `main-stubs`; items line
  `feat/picker-sources-items` from `main-items`: plugin `9fa10a3`, web `a1a1f169e9` (cherry-picks). Phase 4 passes on both lines
  in the Linux SDK container. Gate 1 (first look) on local alpha, laptop dark, `reviews/picker-sources/first-look/` in the
  workspace; the user then asked for gate 2 without waiting (2026-10-25). Gate 2: alpha (stubs, bundle `9eb2724920c3`) and beta
  (items, bundle `0e3a20140e8d`), Inception (2010) Get Another Quality: Playwright Chromium laptop 1280×860, phone 390×844 and TV
  1920×1080 in dark and light, and real Chrome laptop dark and light, 16 runs, all checks pass (ring and line colours, the
  train, the F1 red dot, the icon's place, the checklist's order, colours, ticks and states, untick hides rows and counts
  `6 of 7 sources` with a grey dot and no request, re-tick restores, focus back on the icon, on the TV arrows and Enter in the
  menu, on the phone the menu full width; laptop: a narrowed new search sends six ids, a tick-in sends one and its rows join,
  the settings swatches); reduced motion shows the still blue dot on both. Progress was replayed at stretched timing (the
  server's own answers). Fixed during gate 2: the checklist now focuses its first line on opening (MUI's MenuList props reach
  the item), which the TV needed. `reviews/picker-sources/gate-2/` in the workspace. Codex GPT-6.1 Sol high: approve with fixes,
  six P2 and one P3, fixed in follow-up commits (the held grab's row stays when its source is unticked; a ticked-in indexer's
  rows show and grab without the search's own; a saved choice that leaves none ticked ticks the first; colours are given under
  the insert's write lock and ignore indexers removed in the same save; the promise that a re-added indexer gets its old colour
  back is dropped; the lead changes colour without a transition); the fix re-review found one more P2 (a held rejected row of a
  ticked-in indexer lost its Cancel when the search caught up: the Rejected group now closes only when a new search starts),
  fixed, and that delta approved. **Not run:** the TV at 1280×720, a real TV or phone, the Pi.
  **P4.FU26, built (not accepted) 2026-10-25: a script and how-to that let users make Prowlarr's 1337x searches fast**
  (user 2026-10-25: "a script or instructions how to change it, so users can go and fix it"). Owner: Phase 4. Prowlarr's
  official 1337x definition reads four keyword pages three seconds apart (10–12 s a search, more through FlareSolverr).
  Plugin `scripts/prowlarr-1337x-fast.sh` writes `Definitions/Custom/1337x-fast.yml` from the user's current official
  `1337x.yml` (id `1337x-fast`, name `1337x Fast`, keyword pages 2–4 render page 1, which Prowlarr skips; RSS unchanged;
  stops if the expected page pattern is missing), switches every `1337x` indexer through the API (sets `definitionName`
  and the hidden `definitionFile` field, keeps id, name, tags and settings), times one search before and after;
  `--restore` switches back and removes the file; idempotent; the API key comes from an env var, a file or `config.xml`,
  never the command line, and never shows in a trace or through a `.curlrc`. A new Custom file loads without a restart; a
  changed one needs a restart (the script says so at once). How-to `docs/prowlarr-1337x-fast.md` (why; costs: the first
  20 results under the indexer's sort, newest first by default, with seeders/desc and Disable sorting unchecked as an
  option, and no automatic definition updates for 1337x; script; manual UI steps; undo), linked from the README. Plugin
  `feat/prowlarr-1337x-fast` `3b8c359` from `main-stubs`, items line `532509e` (cherry-pick) from `main-items`. Tested on a
  throwaway local Prowlarr 2.6.5.5623 with FlareSolverr: "the matrix" 80 rows in 9.2 s → 20 rows in 2.9 s, RSS still 80
  items, restore leaves the indexer byte-identical, re-runs are no-ops. Codex GPT-6.1 Sol high: approve with fixes (three
  P2, two P3: key tracing, atomic replace, sort wording, restart note, quoted undo line), then one more P2 (the temporary
  file is reserved with `mktemp` and only this run's file is cleaned up) and P3 (Disable sorting), all fixed by amending;
  final delta approved. **Not run:** the Pi or any household Prowlarr, Radarr/Sonarr app sync after the switch, the manual
  UI path in a browser.
  **P4.FU27, built (not accepted) 2026-10-25: Settings and the picker mark an indexer on Prowlarr's slow default 1337x
  definition** (user-approved design 2026-10-25, revision 3 with the label on the title line and casing A; workspace
  `reviews/prowlarr-slow-hint/` index.html and DECISION-PENDING.md; [UX.md](UX.md) §9;
  [guides/buttons-and-row-actions.md](design/guides/buttons-and-row-actions.md) *A warning on a row's title line*,
  [guides/release-picker-sources.md](design/guides/release-picker-sources.md)). Owner: Phase 4 (the Prowlarr sync's indexers,
  the picker's Sources), with P4.FU26's how-to as the link. Plugin: the sync stores each synced indexer's Prowlarr
  `definitionName` (`AcquisitionIndexer.ProwlarrDefinitionName`, migration `IndexerDefinitionNames`, forward-only, one nullable
  column filled by the next sync) and reads it again on every sync without counting an update or re-verifying;
  `GET /Settings/Indexers` returns `slowSetupHowTo`, the how-to's address, for definition `1337x` and null for `1337x-fast`, any
  other definition and manual indexers. The address is one constant, `ProwlarrSync.SlowSetupHowTo`, which names
  `main-stubs` (`docs/prowlarr-1337x-fast.md` is not on `master` yet): **switch it to `master` when this line is released.**
  Web (`components/SlowSetup.tsx`, `slowSetup.scss`): Settings rows read `EN. 1337x ⚠ Slow setup · How to speed it up` on the
  name's line (0.85em, 0.5em after the name, never breaking inside, moving under a long name as one piece), the link opening the
  how-to in a new tab; the checklist line reads `EN. 1337x ⚠ slow setup`, a link with tooltip "How to speed it up" that opens the
  how-to without toggling the line and is no focus stop (Enter always toggles). Amber `#f2b01e` dark, `#7a5000` light and Apple
  TV; on the TV's focused checklist line (primary fill) the label takes the line's dark ink (about 1.5:1 in amber; not in the
  mockup). The Dashboard page draws the same group in the name's `strong` (inline SVG glyph). The Phase 7 Prowlarr suite (it
  holds the Prowlarr stand-in; Phase 4 has none) checks `1337x` is flagged, `1337x-fast` and a manual indexer are not, a sync
  after the definitions swap flips them with no update, no new revision and no re-verification, and the column in SQLite.
  Plugin `feat/slow-setup-hint` `b0141b7` from `main-stubs`, items line `feat/slow-setup-hint-items` `2babd05`; web
  `feat/slow-setup-hint` `eb88dd3313` from `main-stubs`, items line `a89e4923e5` (cherry-picks). Phase 7 Prowlarr and Phase 4
  pass on both lines in the Linux SDK container. Live: alpha (stubs, bundle `a6467a71567e`) and beta (items, bundle
  `fd283fcbba4f`) sync `definitionName` from the Pi's Prowlarr (EN. 1337x `1337x-fast`, so none is flagged live); the flag was
  staged in the browser (the Settings answer passed through with `slowSetupHowTo` set for EN. 1337x). Gate 1 (first look) on
  alpha laptop dark, then gate 2 without waiting (user away, coordinator's instruction): Playwright Chromium laptop 1280×860,
  phone 390×844 and TV 1920×1080 in dark and light, and real Chrome laptop dark and light, on both, 16 runs, all checks pass
  (label only on the flagged indexer in the React rows, the Dashboard page and the checklist; computed amber, sizes and glyph;
  link href, `_blank`, `noopener`; clicking the checklist label opens a new page and leaves the line's tick; clicking the line
  toggles; keyboard and D-pad Enter toggles and the label never takes focus; a long name on the phone moves the group under the
  name; no page errors). Codex GPT-6.1 Sol high: approve with fixes, one P2 (the checklist link was still a D-pad stop:
  `shell/dpadModals` counts every `a[href]`, so Right on the flagged line reached it and Enter opened the how-to; a pointer press
  could leave focus on it), fixed in a follow-up commit (`data-jfmod-dpad-skip` left out of the D-pad's candidates; a press keeps
  focus on the line; middle and Ctrl/Cmd clicks still open the link natively); TV dark and light on both and laptop dark on alpha
  re-pass with Right/Left, focus-after-press and native-click checks added. Seen, pre-existing (not P4.FU27): on the TV, Right
  or Left on any checklist line moves focus to the menu itself. **Not run:** a real TV or phone, the TV at 1280×720, the Pi.
  The fix delta's re-review: approve. Seen, not fixed:
  `.jfmod-refused .jfmod-checkdesc` and `.jfmod-secret-pending` draw `#f2b01e` text on the light theme (1.6:1).
- Whole-codebase review fixes (all 60 findings, 42 plugin and 18 web): **released** 2026-10-03 as 0.1.0.0 (see
  [`PHASE7.md`](PHASE7.md), *Release 0.1.0.0, republished with the whole-review fixes*). Codex GPT-6.1 Sol high approved
  both repositories (plugin `a48f857..abeffb7`, web `d49d215b4b..1924001186`, squashed from 77 and 37 fix commits);
  live acceptance on 28096 in Chromium, Chrome and the mobile viewport; all 13 suites and the image test on the Pi.
  0.1.0.0 ships detach and keep: nothing deletes downloaded files automatically. **Deferred to the next version
  (user, 2026-10-02):** a manual "remove unused downloads" tool; a first implementation was withdrawn after four
  Codex rounds kept finding serious defects in its delete code, and is kept locally at
  `refs/keep/cleanup-button-20261002` in both repositories for its own design and review.
- Settings area design fix and the Dashboard drawer entry (2026-10-07): **released** as 0.1.0.0, index
  `sha256:bae873702b5cef2f486512349adb75dafe8d3dc99904dad0b767ef5ca251d667`, from plugin `e44e05f` and web `67c91a5a59`
  (bundle `a21c898e2a4c`). Explicit button variants and working row spacing in `/catalog/settings`, the wizard and the
  Home banner; "JellyfinMod" under Plugins in the Dashboard drawer. Codex approve with nits; settings design runner
  354/354 on Chromium and Chrome on 28096 (see [`PHASE7.md`](PHASE7.md), *Settings area design fix*). That index is
  superseded by the 2026-10-08 republish below and stays the rollback target.
- Settings buttons as three kinds (red destroys, blue is the view's main action, grey the rest, all the size of Save) and
  icon actions in a secret's box (2026-10-08): **released** 2026-10-08 as 0.1.0.0, index
  `sha256:5c81e4839c152cc00fd47f30cd4eccb1b43a87d5fe50bff647c7f48d384a5927` (web `3364b4da43`, bundle `e5ea8cf933aa`;
  plugin `f7c274c`) — merged at plugin `master` `a11d585` and web
  `jellyfin-mod` (code `4d124d9f5c`); Codex approve after four re-reviews; settings design runner 688/688 on Chromium and
  Chrome on 28096 (see [`PHASE7.md`](PHASE7.md), *Settings buttons: three kinds*, and *Settings buttons, row icons,
  Title Case and the settings fixes, republished*).
- Settings list rows as named icons and Title Case in both settings pages (2026-10-08), with the TV focus fixes: **released** 2026-10-08 as 0.1.0.0, index
  `sha256:5c81e4839c152cc00fd47f30cd4eccb1b43a87d5fe50bff647c7f48d384a5927` (web `3364b4da43`, bundle `e5ea8cf933aa`;
  plugin `f7c274c`) —
  merged at plugin `master` (`f7c274c`) and web `jellyfin-mod` (code `d456ab5263`); Codex re-review 2 closed every product finding
  (its one remaining finding was in a runner, fixed without another round); settings design runner 810/810 on Chromium and Chrome on 28096. Rule in UX §12.1. Released in the 2026-10-08
  republish (see [`PHASE7.md`](PHASE7.md), *Settings rows as named icons*).
- Settings polish (2026-10-09/10: Test icon states as the gauge glyph, the TMDB token as one field with Save, hover, spin
  arrows, aligned Dashboard fields, timed scrolling diagnostics): **built (not accepted)** on `fix/settings-polish` of both
  repositories (not merged); Codex fix-delta re-review waits for the usage reset (see [`PHASE7.md`](PHASE7.md), *Settings
  polish*).
- Settings partial save message under the ES5 build and the Prowlarr row's wrap on a phone (2026-10-08): **released** 2026-10-08 as 0.1.0.0, index
  `sha256:5c81e4839c152cc00fd47f30cd4eccb1b43a87d5fe50bff647c7f48d384a5927` (web `3364b4da43`, bundle `e5ea8cf933aa`;
  plugin `f7c274c`) — a stale retention save
  said "The request failed." with no Reload; web fix `48c68b4803` on `jellyfin-mod`, Codex approve, `settings-area` 35/35
  on Chromium and Chrome on 48096; `settings-design` 836/840 on both there, the four failures outside the change (stopped
  TMDB stand-in; the Prowlarr row's mobile wrap), accepted by the user's decision to merge without waiting for 18096.
  The wrap is fixed by `807ef4bff5` (with the runner follow-ups, `643679b40a`): `settings-area` 39/39 and
  `settings-design` 828/828 on Chromium and Chrome on 48096 with its TMDB stand-in. Released in the 2026-10-08 republish (see
  [`PHASE7.md`](PHASE7.md), *Partial save message under the ES5 build*).
- Resolution tier by width and height (2026-10-08): **released** 2026-10-09 as 0.1.0.0, index
  `sha256:9c3525549ed611922384b4a22bb260578282ba7e14c5d26918e0baed651a3970` (plugin `cb5c6f9`, web bundle `e5ea8cf933aa`
  unchanged) — a version's resolution is the larger of its width and height tiers on Jellyfin 12's boundaries (a 3840×1600
  file read "1080p" by height alone); version rows and retention's ranking share the rule. `PhaseSixIntegration` covers it
  over HTTP; live on 18096, Fleabag S1E1 and Tokyo Vice S1E1 read 2160p and Foundation S3E1 and Pachinko S1E3 read 1080p,
  as stock does. Codex approve, no findings (see [`PHASE7.md`](PHASE7.md), *Resolution tier fix, republished*).
- 0.1.0.0 detail page design fix: **built (not accepted)**. The user rejected the released episode and movie
  page design and dictated a new one on 2026-10-07 (header *Get a release* icon, the Video row as the file chooser,
  per-file history, a countdown badge on the Played tick, the file-less page's raised button, the episode window in
  the stock More menu). A fix of the released page, framed like the settings design fix, on `fix/detail-page-design`
  in both repositories; design record, acceptance checklist and evidence in
  [design/episode-page-design-spec.md](design/episode-page-design-spec.md); the page is described in
  [UX.md](UX.md) §7, §7.2, §8 and §11. A candidate for republishing 0.1.0.0 once accepted; the user decides.
  Live checklist on 18096, 2026-10-08: passed in Chromium and real Chrome except the queue line during a grab (NOT
  VERIFIED, no download client on 18096); waiting for the user's acceptance and rulings on three flagged choices.
- V1 — versions on Jellyfin 12: **accepted** 2026-09-28 (rows 1–21 live on 28096 and 48096, Chromium and Chrome;
  Codex re-review of the final plugin delta `1e56db4..a48f857` with no findings, web passed re-review 3); merged at
  plugin `master` `a48f857` and web `jellyfin-mod` (V1 code `2580d5d67d`, plus these status notes), still 0.1.0.0.
  Owner of all version behaviour, including Phase 5/6's version rows (see [`V1.md`](V1.md)).
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
- **Phase 13 — offline episode watches to Trakt.** Future, **not scheduled**; outline in
  [PHASE13.md](PHASE13.md). Requested 2026-10-07 after recovering missing Peaky Blinders watches:
  preserve original watch times, retry after internet returns, prevent duplicate plays, offer
  explicit missing-watch catch-up and reconnect when authorization fails. Initial scope is watches
  received by Jellyfin while Trakt is unreachable; fully disconnected client playback needs a
  separate scope decision. The stock-plugin integration and export ownership are design gates.

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
