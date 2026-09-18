# Phase 4 — indexers and manual grab

Planning draft, 2026-09-14. Read [PLAN.md](PLAN.md), [PHASE1.md](PHASE1.md),
[PHASE2.md](PHASE2.md), [PHASE3.md](PHASE3.md), [README.md](README.md) and
[UX.md](UX.md) alongside this refinement. This document plans work; it does not establish
that earlier phases have passed acceptance or authorize a production deployment.

## Outcome and boundaries

An administrator opens Search releases for an accessible catalog movie or episode, compares
parsed and rejected results, selects one, and sees the matching torrent accepted by qBittorrent
with the configured category, destination and seeding requirements. The durable entry, episode
identity and acquisition history survive retries and a plugin restart.

- Torznab is the indexer protocol; direct indexers and compatible aggregators work without a
  required Prowlarr or Jackett installation. qBittorrent is the first and only write driver.

  **Open question for the user (review 2026-09-18):** Phase 3 seed protection reads only
  Transmission, the client actually deployed, so the client choice is unresolved: (a) a
  Transmission write driver that matches the existing reader; (b) qBittorrent plus a
  qBittorrent read adapter (files, save path, ratio, seeding time) inside A5/A6; or (c) both.
  A1 must record the user's answer before A2 starts. See
  [`REVIEW-2026-09-18.md`](REVIEW-2026-09-18.md) (prior-H4c, medium, verified; lowered from high).
- Phase 1 supplies library-scoped entries and stable episodes; Phase 2 owns native bindings.
  Keep existing Movies/TV, Search and Details routes, with a release dialog rather than a page.
- Phase 3 retention stays configurable: All users by default, Selected user, or Any user.
  Manual acquisition does not change watched state, Keep, eligibility deadlines or exemptions.
  Settings and destructive actions remain admin-only, enforced by the server.
- Phase 4 stops at verified handoff. Import, hardlinks, targeted scans, queue/progress UI and
  `/catalog/queue` remain Phase 5. Scheduled searches, cutoff upgrades, replacement of existing
  media and multi-quality selection remain Phase 6. Monitoring alone starts nothing here.
- No acquisition operation deletes a library file, removes a torrent, clears a catalog entry,
  rewrites native user data or creates a STRM placeholder.
- All development, deployment and E2E use `jellyfinmod-test` on port `18096`, with its state
  under the isolated state directory. Production `jellyfin` on `8096` stays running and
  untouched; production-media mounts remain read-only. Use a separate disposable qBittorrent
  instance and writable fixture storage, not production download-client credentials or data.

## Current implementation and decisions to settle

The inspected implementation has `Entry`, `Episode`, `HistoryRecord`, library access checks,
explicit camelCase entry DTOs and admin-only PATCH operations. It has no indexer, profile,
download-client or grab entities. `Entry` does not yet contain a quality-profile reference.
`EntryDetails.tsx` and `integration/nativeEntryDetails.js` provide explanatory Search releases
stubs. Replace those stubs through the existing feature integration; do not build a second
catalog, matching service or settings page. Phase 2/3 documents describe dependencies, not proof
that their services exist in the current checkout.

**Correction (review 2026-09-18):** This inventory is stale. Phase 3 ships
`TransmissionSeedClient`, the seed endpoint and credentials configuration, the
`RetentionOperation` and `RetentionRun` records and the retention summary DTOs. A1, A5 and A6
must extend these rather than build a parallel client or seed store (plan-ops#8, low,
single-source; [`REVIEW-2026-09-18.md`](REVIEW-2026-09-18.md)).

The following are proposed Phase 4 defaults, not previously accepted user decisions. Resolve
them in A1 before enabling acquisition; documentation and protocol evidence can proceed now.

| Decision | Proposed first slice |
| --- | --- |
| Who can search and grab? | Admin-only search and grab initially. Permission to add a wanted title does not implicitly grant download-client use. Ordinary users retain catalog add/browse. Any expansion must explicitly define and test acquisition authorization. |
| TV target | One explicitly selected stable episode ID. Series-level Search releases asks for an episode inside the same dialog. Reject season packs, multi-episode packs, absolute-number-only releases and ambiguous numbering with visible reasons until their import mapping is designed. |
| Quality defaults | Require an administrator to select a valid default profile before enabling grab. Existing entries inherit it without a bulk settings rewrite. No guessed resolution, language or size preference. |
| Profile selection | Selecting a profile in the picker changes that search only. Saving an entry profile is a separate admin setting; episode searches inherit their series profile. No profile dialog on catalog add. |
| Rejection override | Rejected rows are inspectable but cannot be grabbed. No force-grab escape hatch in this phase. Change the profile or correct metadata and search again. |
| Duplicate acquisition | One unresolved/active grab per entry or episode target; reject another until resolved. A verified existing playable copy stays available during an explicit manual grab. Multi-quality orchestration remains Phase 6. |
| Correcting a mistaken grab | Use the existing qBittorrent WebUI, linked after confirmed handoff. Phase 4 offers no queue Undo or removal API; do not promise the Phase 5 queue already exists. |

**Proposed amendment (review 2026-09-18, not user-approved):** For the 'Correcting a mistaken
grab' row and the A7 one-Enter rule, choose one of: (1) a short server-side cancellable hold,
for example 5 s showing 'Sending… Back to cancel', with `POST /Grabs/{id}/Cancel` valid only
before `submitting`; (2) a second Enter on the same row in the TV and mobile layouts; or (3) the
current rule. In every option, freeze row order while a row is focused (plan-ops#6, medium,
single-source; [`REVIEW-2026-09-18.md`](REVIEW-2026-09-18.md)).

**Open question for the user (review 2026-09-18):** UX §9 justifies grabbing with no
confirmation because "the queue is where a mistake gets undone", but that queue does not exist
until Phase 5. Keep one Enter with no confirmation, add the cancellable hold, or require a
second Enter on TV and mobile?

## Entry gates and dependencies

1. Record accepted Phase 1–3 source revisions and evidence before Phase 4 deployment. Verify
   library/content restrictions, stable episode IDs, reconciliation and retention protection.
   Build Phase 4 on separate `jellyfinmod-phase4` branches/worktrees based on those revisions.
2. A1 resolves the proposed permission, episode, profile and duplicate contracts above and
   records them with concrete request/response examples before API/UI implementation diverges.
3. Inspect the actual isolated indexer capabilities and qBittorrent application/WebAPI versions.
   Select supported API behavior from that evidence, not from the latest documentation alone.
   Verify authentication, category/save-path behavior and seeding semantics through real HTTP.
4. Confirm a writable isolated download destination outside watched library roots. Record how
   it can share a filesystem with a future Phase 5 library target; no import or copy fallback
   is introduced here. A category must never route downloads into production or trigger an
   external production importer. Disable auto-removal behavior in the isolated test client.
5. Back up the plugin database and prove migration plus restore with preserved entries,
   episodes, user-scoped evidence, policy and history. Restoring SQLite cannot undo client adds.

**Proposed amendment (review 2026-09-18, not user-approved):** Add entry gates 6–9; gates 1–5
are unchanged. See [`REVIEW-2026-09-18.md`](REVIEW-2026-09-18.md) and PLAN.md X1–X4.

6. The Phase 3 review blockers T7, T8, T9, T10 and T18 pass on the isolated test instance
   (port 18096). Otherwise 'Get again' re-acquisition of a reclaimed title is due immediately
   and would be deleted at the next retention run (plugin-retention-policy#1, critical,
   verified).
7. P7 and X1 are complete: every commit that `git cherry jellyfinmod-phase4 <older phase
   branch>` marks `+`, including the phase1 commit `fba11e3`, is either patch-identical on the
   phase4 line or named in a port commit there (a `(cherry picked from commit …)` or
   `Ported-from:` trailer), with the mappings recorded in the evidence; and `origin/master` is merged with its SHA
   recorded (plan-ops#3, plan-ops#4, medium, single-source).
8. The X3 deploy tooling refuses production by default, and the X4 Health response reports
   the plugin revision and `capabilities`, which A7 gating uses (plan-ops#2, medium, verified;
   lowered from high; plan-ops#5, medium, single-source).
9. A9 (isolated acquisition infrastructure) is complete (plan-ops#7, low, single-source).

Also recommended before A6 relies on availability: R6 and R7, so one unverifiable binding or a
re-created library cannot disable absence detection or orphan entries (plugin-reconciliation-data#2,
high, verified).

## Data model and ownership

Use the existing plugin SQLite database at `Plugin.Instance.DataPath`. Add migrations rather
than creating another store. Keep structured acquisition records in SQLite and secret settings
server-side; the plugin configuration remains XML-serializable, with no dictionaries. The
Dashboard page is the single admin UI for this configuration.

| Record | Minimum contents and invariants |
| --- | --- |
| Indexer | Stable ID, name, Torznab base endpoint, enabled flag, category selection, priority, secret reference, capabilities snapshot/version/time and seed requirements. Capability failures are explicit, not empty search results. |
| Download client | Stable ID, qBittorrent endpoint, enabled flag, secret reference, category and isolated save-path configuration, last verified version/capabilities. Start with one selected client; no automatic failover after an uncertain submission. |
| Quality profile | Stable ID/name/revision, ordered allowed quality/source combinations and optional size-per-runtime limits. Store only implemented scoring settings. Cutoff and upgrade automation are deferred. |
| Entry extension | Nullable quality-profile ID: null means inherit the configured default. Validate references on write and prevent deleting an assigned/default profile until explicitly reassigned. Episode searches inherit their parent's resolved profile. |
| Search snapshot | Opaque search ID, requesting user, entry/episode target, profile/config revisions, creation/expiry, per-indexer outcomes and immutable candidate snapshots. Bounded server-side cache is sufficient; expiry or restart requires a new search. |
| Grab operation | Stable operation ID, requester, target entry and optional episode ID, idempotency key/request fingerprint, source indexer/GUID, raw title, parsed attributes, profile/scoring version, client ID, normalized hash/download identity, seed-policy snapshot, timestamps, status and sanitized failure code. Persist before contacting the client. |

After validation, retain the selected candidate in the grab record so recovery does not depend
on an expiring search cache. Keep authenticated enclosure URLs/passkeys in protected server-only
storage only as long as needed; they must never enter public DTOs or ordinary history. Secret
reads return presence indicators, never saved values. Distinguish unchanged secrets from an
explicit replacement/clear, and redact transport URLs, cookies and credentials from diagnostics.

Separate acquisition status from file availability. Proposed operation states are `pending`,
`submitting`, `accepted`, `failed` and `unknown`. `unknown` means a submission may have succeeded
and blocks blind resubmission. Search alone does not persist `Entry.State = searching` or
overwrite an on-disk/reclaimed representation. An accepted grab supplies acquisition summary;
file-less cards may project `grabbed`, while on-disk items retain native playback. Preserve the
underlying `none`/`reclaimed` provenance for failure and Phase 5 resolution. Do not report progress
or `onDisk` from client acceptance, and do not mark a whole series available after one episode grab.

## API contract

All routes are under `/JellyfinMod` with authenticated identity. Apply library and content
restrictions before returning an entry, episode, release or operation. Use the existing concealed
404 behavior for inaccessible targets; an episode must belong to the specified entry. Under the
proposed permission default, acquisition/settings routes also require `Policies.RequiresElevation`.
Recheck access and policy when committing a grab, even when its search was authorized earlier.

| Endpoint | Contract |
| --- | --- |
| `GET /Releases?entryId=&episodeId=&profileId=` | Return `searchId`, `expiresAt`, target, effective profile/revision, candidates and per-indexer status. Episode is required for series acquisition; omitted profile uses inheritance. Reads never submit a torrent. |
| `POST /Releases/Grab` | Accept only `{ searchId, releaseId, idempotencyKey }`; derive target, client, download locator and evaluated profile from server records. Return canonical grab operation, not a bare success boolean. |
| `GET /Grabs/{id}` | Return authorized operation state and sanitized result/recovery message. Supports bounded handoff confirmation only; it is not a Phase 5 transfer queue. |
| `GET /Settings/Indexers`, `/Settings/DownloadClients`, `/Settings/QualityProfiles` | Admin configuration DTOs without credentials; profile list and selected defaults support the picker. |
| `POST /Settings/{resource}`, `PATCH /Settings/{resource}/{id}`, `DELETE /Settings/{resource}/{id}` | Admin CRUD for the three named resource types; validate references/revisions and preserve records required by unresolved grabs. Deleting config never deletes client torrents or media. |
| `POST /Settings/Indexers/{id}/Test`, `/Settings/DownloadClients/{id}/Test` | Bounded admin connection/capability checks; download-client Test never adds a torrent. Return safe, actionable results. |
| Existing `PATCH /Entries/{id}` | Add validated quality-profile assignment alongside existing supported fields. Preserve strict unknown-field rejection and admin-only settings. |

Candidate DTO: opaque `releaseId`, source display name, raw title, parsed quality/source/codec/
audio/group, target match, bytes, seeders, publication time, nullable freeleech/proper/repack
attributes, score with contributions, `eligible` and stable rejection codes/messages. Unknown
size, runtime, seeders or flags remain null rather than invented zero/false values. Include a
partial/truncated indicator; never label a capped fan-out result count as an exact global total.
Use explicit camelCase/string enums, UTC ISO 8601 dates, JSON nulls and existing error conventions.

Expire stale candidates explicitly. Reject forged/foreign search IDs, modified targets, invalid
profiles and changed eligibility. A stale configuration/profile revision requires a new search,
not a silent submission under different rules. Same idempotency key and payload returns the same
operation; reused key with a different payload returns conflict. Unknown and pending outcomes
remain distinguishable from accepted/failed through the actual serializer and web client.

## Tasks and acceptance

| ID | Task and owner | Depends on | Required evidence |
| --- | --- | --- | --- |
| A1 | Resolve decisions and protocol spikes; plugin/web contract | Earlier-phase gates | Version/capability evidence, permission and TV scope, concrete DTOs and legal test media plan |
| A2 | Acquisition configuration and migrations; plugin data/Dashboard | A1 | Real admin save/read/restart, ordinary-user rejection, secret redaction and reference integrity |
| A3 | Torznab search and release identity; plugin services/API | A1, A2 | Real HTTP capability negotiation, pagination, partial failure and controlled malicious/error responses |
| A4 | Parsing, profiles and scoring; plugin services/API | A2, A3 | Representative release feeds exercised through hosted APIs, deterministic order and explicit rejection reasons |
| A5 | qBittorrent handoff and recovery; plugin driver/data | A2–A4 | Actual client acceptance/category/identity, concurrent retry and interrupted-submission recovery |
| A6 | Entry/history and retention integration; plugin contracts/services | A5, Phase 2/3 | Preserved bindings, played policy, seed requirements and correct accepted/failed/unknown summaries |
| A7 | Release picker and profile surfaces; web and narrow detail/menu mounts | A1 contract, A4–A6 | Built app, real server/client, desktop/mobile/TV focus and degradation |
| A8 | Isolated end-to-end acceptance; both repositories | A1–A7 | Complete search-to-client flow plus migration/restart, security, failure and playback regressions |
| A9 | Proposed (review 2026-09-18, not user-approved): provision isolated acquisition infrastructure and credentials; test compose, plugin test suite | Client decision | Disposable client service and Torznab boundary server reachable through real HTTP from `jellyfinmod-test`, with credentials only in the ignored `plugin/.env` |

**Proposed amendment (review 2026-09-18, not user-approved):** A1 also depends on A9, so no
protocol spike runs against household indexers or production client credentials (plan-ops#7,
low, single-source; [`REVIEW-2026-09-18.md`](REVIEW-2026-09-18.md)).

### A9 — provision isolated acquisition infrastructure first

**Proposed (review 2026-09-18, not user-approved):** **Priority** high · **Depends on** the
download-client open question · **Findings** plan-ops#7 (low, single-source)

The isolated test instance has Transmission from Phase 3 but no second download client, no
isolated indexer, no compose service for either and no sanctioned place for their credentials.
A9 provisions them before A1 needs protocol evidence. Run the chosen client as a disposable
service on the isolated test compose, with its config and download directories inside the
isolated state directory and auto-removal disabled. Record the container path mapping between
that client, Transmission and `jellyfinmod-test` without publishing paths. Run a Torznab HTTP
boundary server from the test suite. Keep credentials only in the ignored `plugin/.env` (mode
`0600`), add empty keys to `plugin/.env.sample`, and never print them. Use no household indexer
and no production client credential. A1 indexer evidence comes from the boundary server plus
read-only capability queries; whether any real indexer may be queried is an open question.

**Acceptance**

- The chosen client runs as a disposable service on the isolated test compose; its config and
  download directories are inside the isolated state directory and auto-removal is disabled.
- The container path mapping between the client, Transmission and `jellyfinmod-test` is
  recorded without publishing paths.
- The Torznab HTTP boundary server runs from the test suite and serves caps and feeds.
- Credentials live only in the ignored `plugin/.env` (`0600`), empty keys exist in
  `plugin/.env.sample`, and no command, log, test output or report prints them.
- Real HTTP connection tests from `jellyfinmod-test` (port 18096) to the client and the
  boundary server succeed.
- No household indexer or production client credential is used.

**Open question for the user (review 2026-09-18):** Is any real indexer allowed for read-only
capability queries in A1, and which one? Or should A1 rely only on the Torznab boundary server?
Its keys would live in the ignored `plugin/.env` under this proposal.

### A1 — make the first slice executable

Inventory current Phase 2/3 services and their synchronization rules; reuse the matcher, access
checks and read-only seeding adapter rather than inventing parallel ownership. Document the
actual qBittorrent version and supported hash formats. Prove how a chosen movie or stable episode
maps to each configured indexer's supported identifiers; generic title search is candidate
discovery, never sufficient evidence to rebind a catalog identity. Record ambiguous numbering
and unsupported packs as rejection cases. Confirm that phase branches preserve unrelated work.

**Proposed amendment (review 2026-09-18, not user-approved):** A1 also records the user's
download-client decision; inventories the Phase 3 retention services it must integrate with
(the Transmission read adapter, `RetentionOperation` and the evaluation baseline); and confirms
that the phase4 line contains the carried-forward phase1 fixes (P7) and merged master fixes
(X1). The existing adapter to reuse is Transmission-only (prior-H4c, medium, verified; plan-ops#8,
low, single-source; plan-ops#3, medium, single-source).

### A2 — configure without leaking credentials

Extend the plugin Dashboard with indexer, client and profile forms using ordinary admin controls.
Validate supported categories, ordered qualities, positive size limits and min/max relationships.
Require an enabled compatible indexer, verified client destination and valid default profile
before enabling grab. Connection errors identify the failing configuration without disclosing
credentials. Credential/config changes invalidate affected cached searches. Migration tests run
through the real hosted plugin and SQLite, including restart and backup restore.

### A3 — query capabilities before releases

Fetch `t=caps` before searching and use only advertised search modes, parameters, categories and
limits. Cache capabilities with explicit invalidation on configuration change. Fan out in bounded
parallel requests with timeout, cancellation and bounded pagination; respect rate-limit guidance.
Retain successful sources when another times out. Distinguish no matches, authentication errors,
unavailable capabilities, malformed XML and partial results, including XML error bodies in HTTP 200.

Parse XML with external entities/DTDs disabled and response-size limits. Treat titles and
attributes as untrusted text. Requests use admin-configured endpoints; enforce configured
download-host/redirect boundaries before retrieving torrent metadata so an indexer result cannot
turn the plugin into an arbitrary URL fetcher or forward credentials to another host. Account
for legitimate configured LAN services without globally permitting unrestricted redirects.

Keep source GUID namespaced by indexer; a GUID is not an infohash. Group verified identical hashes
without discarding source-specific tracker/passkey/seed-policy variants. Do not merge unrelated
releases because titles look alike. No browser-supplied torrent URL is accepted by Grab.

### A4 — explain each score and rejection

Write the parser independently or use license-compatible MIT references with attribution; never
port Sonarr/Radarr GPL-3.0 parser code. Record provenance for any dependency or reused fixtures.
Keep scope to the configured trackers' movie and single-episode release forms, including specials,
year ambiguity, source/resolution, codec/audio, proper/repack and malformed/missing attributes.

Evaluate hard constraints before scoring: media/episode mismatch, unknown required identity,
unsupported pack, forbidden quality and size outside profile limits cannot be rescued by seeders
or freeleech. Missing runtime cannot pass a required size-per-hour check by guessing a duration.
Score allowed candidates deterministically using profile order and documented tie-breakers; expose
contributions and all rejection reasons. Sort by score descending with stable source/release ties.
Unknown metadata remains explicit. Changing the profile produces a new evaluated snapshot while
the dialog retains its place; it must not silently mutate the entry's saved profile.

### A5 — hand off once, then verify

Keep the acquisition engine behind a small internal interface and implement only the qBittorrent
operations needed for authentication, version/capability checks, add and identity lookup. Use
`IHttpClientFactory.CreateClient(NamedClient.Default)` and correctly scoped services. Inspect
the installed client's supported API before choosing fields; do not change Jellyfin/.NET pins.

Before submission, persist intent and a normalized torrent identity derived from verified metadata
or supported magnet hash. Reject hash formats that cannot be correlated reliably in this slice.
Revalidate current access, target, configuration and eligibility. Serialize conflicting grabs for
the target and enforce durable uniqueness for the client/hash so parallel requests or multiple
indexer sources cannot double-submit. A matching torrent owned outside this operation is a
conflict; never silently recategorize, relocate or claim an unrelated existing download.

Submit with the configured category/destination and effective seed requirements; verify the
matching client torrent and its observed settings before marking accepted and writing one
`grabbed` event. A successful HTTP response alone is insufficient. The SQLite commit and remote
add are not atomic: timeouts or process death after sending produce an uncertain operation,
recovered by client identity lookup before any retry. Keep accepted, failed and unknown outcomes
honest; never automatically switch clients or blindly retry add after a lost response. Recovery
runs after restart and exposes unresolved cases for admin action without adding a removal API.

**Proposed amendment (review 2026-09-18, not user-approved):** If qBittorrent is chosen, the
operations list must also include the reads protection needs (files, save path, ratio and
seeding time); A5 currently excludes them (prior-H4c, medium, verified). If the cancellable
hold is chosen, A5 owns the `pending` hold and the Cancel transition before `submitting`
(plan-ops#6, medium, single-source).

### A6 — preserve catalog and retention truth

Add history and acquisition summary through existing entry/episode reads. One accepted grab gets
one history event, even after retries; failed attempts are not labeled grabbed. Do not cascade
away unresolved operations when an admin removes an entry: block removal until ownership is
resolved, using a documented conflict rather than erasing the client association.

Keep Phase 2 native bindings and all playable versions intact during searching/handoff. Coordinate
with existing reconciliation/retention operation locks without keeping a DB write transaction open
across HTTP. Acquisition neither exempts existing media forever nor shortens retention windows.
Preserve per-user state and All/Selected/Any watched-user settings across migration and handoff.

Persist the indexer's effective ratio/time requirements on the grab. The Phase 3 read adapter
must recognize new torrent-managed paths and treat unknown client state as protected. Verify the
client's actual goal-combination/inheritance semantics; a client stopping condition is not proof
that every retention seed requirement has been met. Never lower an existing goal or allow client
auto-removal to bypass it. No claimed disk-space reclamation occurs in this phase.

**Proposed amendment (review 2026-09-18, not user-approved):** Add A6 acceptance items:

- (a) 'Get again' or any re-acquisition never inherits a prior retention deadline or
  observations; depends on T7 (plugin-retention-policy#1, critical, verified).
- (b) The Phase 3 read adapter recognises the chosen client's paths. It is Transmission-only
  today (prior-H4c, medium, verified).
- (c) Optional hardening, not a defect fix: the retention gate uses the stricter of the client's
  goals and the grab's recorded seed-policy floor, ANDed with client state such as `isFinished`
  and never ORed. This is the residual of the refuted prior-H4a.
- (d) Define File-filter membership from the acquisition summary for file-less rows and for
  native rows with partial episode grabs. Otherwise the PHASE1 Downloading filter matches
  nothing once Phase 4 keeps `Entry.State` at `none` or `reclaimed` (plugin-browse-discover#8,
  low, verified).
- (e) Reclaimed episodes are not presented as missing gaps; see T14 (tests-contract#7, medium,
  single-source).

Each item is proved on the isolated test instance (port 18096) through real HTTP, Jellyfin
authentication, serialization and SQLite, with disposable fixtures and a real client boundary.

### A7 — finish the existing release action

Implement `ReleasePickerDialog` and hooks under `features/jellyfinmod`, mounted from the existing
file-less detail action, native Details More menu and scoped card context menu. Reclaimed titles
may use Get again to open this same dialog. Series select a stable episode; downloaded episodes
retain native navigation/Play. Gate controls by server capability and authorization.

Follow UX §9: parsed summary and always-visible raw title, descending visible scores, size and
seeders, meaningful freeleech/proper/repack chips, and a collapsed rejected group with reasons.
One Enter activation grabs an eligible row without a confirmation; prevent double activation.
Show confirmation only after verified acceptance, with a configured credential-free Open in client
link. Pending/unknown remains visible and cannot offer an unsafe retry or nonexistent queue Undo.

Use feature-local `jfmod-` styles, existing theme values and `em` sizing. Never modify upstream
stylesheets or introduce another route. Mobile/TV use one-column rows without horizontal scrolling.
Focus the first eligible result when available, otherwise a stable status/rejected-group control;
Back/Escape closes and restores the opener. Async results, rescoring and errors must not unmount
the focused container or reorder rows underneath an active selection without deliberate refresh.
Keep native browse/playback usable on plugin absence, older API versions or indexer/client outage.

**Proposed amendment (review 2026-09-18, not user-approved):** Gate the picker on the X4
Health `capabilities` rather than version guessing (plan-ops#5, medium, single-source;
web-library-search-details#6, medium, single-source). Apply the mistaken-grab option chosen
under the decision table in place of the one-Enter sentence above, which stays as written until
the user decides (plan-ops#6, medium, single-source). Keep rows frozen while one is focused.

## A8 — isolated acceptance and release gate

Use real HTTP/authentication/authorization/serialization/migrations/SQLite integration and a built
browser against running Jellyfin. Controlled external conditions come from a real HTTP boundary
server serving Torznab caps/feeds/torrent metadata; never mocked clients or helper-only tests.
Use a disposable qBittorrent instance and a small self-created or openly licensed torrent fixture
with a controlled seeder. Prove actual client state and fixture data, not only status codes.

- Admin search/grab succeeds; anonymous and ordinary-user calls fail under the agreed default.
  Exercise library/content restrictions, cross-library same-title copies, foreign episode IDs,
  revoked access, forged/expired search IDs and tampered profile/config revisions.
- Through hosted release APIs, exercise caps variations, pagination limits, malformed XML,
  credential errors in HTTP 200, rate limits, source outage, timeout, redirect rejection and secret
  redaction. Assert returned raw titles, parsed fields, stable scoring and every hard rejection.
- Through the built picker, grab a movie and one episode. Verify exactly one matching torrent,
  category, safe save path, recorded hash and effective seed requirements in the real client;
  verify the SQLite operation and one history event after restart.
- Double-click/Enter, two browser sessions, duplicate hash across indexers, unrelated existing
  torrent and concurrent target grabs produce no duplicate or unauthorized client mutation.
  Interrupt before send, after remote acceptance and before local commit; recovery reconciles
  uncertain outcomes without duplicate adds. Confirm unavailable clients stay unknown safely.
- Preserve native playback, stable entry/episode bookmarks and Phase 3 All/Selected/Any settings,
  Keep, favorites and seed safeguards. A grab does not create a playable binding or change another
  user's watched/resume state. Existing accepted phase tests remain passing.
- Verify desktop, mobile and keyboard-driven TV at 1920×1080 and 1280×720 using
  `localStorage.setItem('layout','tv')`, arrow keys, Enter and Back. Cover rejected-only/empty lists,
  profile changes, partial failure, pending handoff, focus restoration and old-plugin fallback.
  Restore automatic layout afterward. Report physical webOS evidence separately from emulation.
- Record plugin/web/client revisions, fixture identity, test results, timings and Pi memory usage
  without secrets. Plugin Release build with zero warnings, web TypeScript and lint are supporting
  checks; they cannot replace integration/E2E evidence. Report any unverified gate explicitly.

**Proposed amendment (review 2026-09-18, not user-approved):** Add these A8 cases on the
isolated test instance (port 18096), using the built browser in desktop, mobile and TV layouts
where a UI is involved:

- If the hold is chosen, Back during the hold cancels the grab and the real client shows no
  mutation (plan-ops#6, medium, single-source).
- A late indexer result arriving from the Torznab boundary server while a row is focused does
  not move or replace the focused row.
- Get again for a reclaimed title is not deleted at the next retention run
  (plugin-retention-policy#1, critical, verified).
- The File filter shows grabbed rows, including a native series with a partial episode grab
  (plugin-browse-discover#8, low, verified).
- Evidence records the Health revision and the merged master SHA (plan-ops#5, plan-ops#4,
  medium, single-source).

Phase 4 is complete only when the accepted manual flow reliably hands the intended release to
the isolated client once, with correct ownership/settings/history, and every protection and
failure case above is verified. Download completion, import and playback of that new media are
Phase 5 acceptance, not implied by this gate.

## Risks and references

| Risk | Required response |
| --- | --- |
| Indexer metadata and numbering differ | Capabilities first, limited parsing scope, explicit ambiguity/pack rejection and representative hosted feeds |
| Uncertain remote add | Durable intent, stable hash correlation and reconciliation before retry; never claim exactly-once remote transactions |
| Existing torrents or production paths accidentally reused | Isolated client/config/storage, explicit ownership checks and no relocation/category mutation of unrelated torrents |
| Seed requirements lost between phases | Snapshot requirements, verify actual client semantics and share the retention read adapter |
| Credentials embedded in torrent locators | Server-only locators, bounded endpoint/redirect policy and redacted config/history/logs |
| Parser licensing or scope expands | Independent implementation or compatible attributed references; no copied GPL-3.0 parser and no automation/import creep |
| UI promises more than handoff | Distinct pending/unknown/accepted status; no fake progress, queue Undo or playable native ID |

**Correction (review 2026-09-18):** In the 'Seed requirements lost between phases' row, the
shared retention read adapter is Transmission-only, so sharing it protects nothing if the chosen
client is qBittorrent; see the download-client open question and A6 (prior-H4c, medium,
verified). Phase 5 already owns removing the seeding copy after seed goals (README §6). The
earlier `REVIEW-2026-09-17.md` claims that no phase owns that removal (prior-H3) and that the
Transmission idle limit breaks seed goals (prior-H4a) were refuted and are not Phase 4 defects.

Protocol sources consulted through Context7 and official documentation on 2026-09-14:

- [Torznab specification](https://torznab.github.io/spec-1.3-draft/torznab/Specification-v1.3.html)
  and [source specification](https://github.com/torznab/torznab-docs/blob/develop/docs/source/torznab/Specification-v1.3.rst):
  caps, supported parameters/categories and response contracts. The linked specification is a
  draft; observed configured-indexer behavior remains an A1 gate.
- [qBittorrent WebUI API](https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-5.0)):
  versioned authentication, torrent add, category and identity-read contracts. This reference
  covers 5.0+ and is not evidence of the installed client's version or successful handoff.
