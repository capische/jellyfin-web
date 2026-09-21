# Phase 8 — release attribute enrichment and playback evidence

**Future phase. Not scheduled. No entry gate is met.** Outline written 2026-09-20, completed
2026-09-21, so the work is not lost; it will be refined into a full refinement (in the style of
PHASE5–7) when it actually starts. Read [PLAN.md](PLAN.md), [PHASE6.md](PHASE6.md) *Phase 6
follow-up — multiple held qualities (M10–M21)* (the ladder, copy, rule and grammar model this
phase extends), [PHASE7.md](PHASE7.md) §5–§6 (the settings area and Prowlarr-synced indexers) and
[API.md](API.md) alongside it. Everything here is **Proposed, not user-approved**; nothing
authorizes a deployment, an external service or a change to the isolated instance. Title ratings
(IMDb, Rotten Tomatoes and the rest) are a different concern and live in [PHASE9.md](PHASE9.md).

The user's words: "those should be available from html page description, if possible it's okay
to use AI to analyze it and return those attributes, it can be fully custom feature on phase 8 and
9 or even 10, add it, we will work when we have time"; and "the list of tvs with supported
profiles so files can be picked based on tv or general that will play everywhere".

## What this phase is for

The Phase 6 follow-up decides from what a release title says, with a stated confidence, and it
says `unknown` whenever the title does not say. This phase supplies the evidence the title lacks:

1. **Before download**, for trackers whose titles carry no structured grammar: the indexer's own
   detail page (the Torznab `comments` / `details` URL) read by a deterministic extractor or,
   behind the same interface, a model-assisted one, to recover audio languages, subtitle
   languages, exact dynamic-range and audio details, source and edition notes and file listings.
2. **After import**, the truth: the host's media streams (video range and Dolby Vision profile,
   audio codecs, profiles, channels and languages, embedded and sidecar subtitles), reconciled
   with the pre-download hints and shown beside them.
3. **Playback evidence**: which of the user's real clients direct-play which held version, a
   device capability catalogue that lets a ladder rank for a designated device or for maximum
   compatibility, and diagnostics that report and suggest — never re-grab on their own.

It reuses the follow-up's rule engine (`Fields[]`), attribute vocabulary, confidence levels
(`parsed` / `inferred` / `unknown`, plus `enriched` and `verified` added here), copy states and
`UpgradeOperation` kinds; it adds no second model of quality.

## Boundaries and honest limits

- A tracker's detail page is not an API. Layouts differ per tracker and drift without notice;
  fetching pages costs the tracker bandwidth and may be limited by its terms of service; every
  fetch goes through the Phase 6 per-indexer minimum interval, daily budget and breaker, and a
  per-indexer *enrichment allowed* switch defaults to **off**.
- A model's output is **untrusted input**: it is validated against the closed vocabulary,
  bounded (lists capped, unknown values dropped), stored with confidence `enriched` and never
  above `parsed`, and it may influence a grab only where a rung or rule explicitly accepts
  `enriched` evidence. When the model is unavailable, slow or returns nonsense, the release is
  evaluated as if unenriched — exactly as today.
- No credential, cookie, passkey, private URL, user name or catalog content leaves the server to
  an external model; only the fetched page text (stripped of links and scripts) and the release
  title are sent, and only when the administrator has chosen a hosted model. Local versus hosted
  is open question 1.
- Fetching subtitles is the host's job (the OpenSubtitles plugin already installed on the host,
  and any other Jellyfin subtitle provider); this phase reads what a release ships and what the
  library holds, and never downloads a subtitle file or duplicates a provider.
- A general database of every television is not something this plugin can own reliably. The
  design favours **the user's registered devices** over a catalogue of all models, with optional
  importable definitions, and treats every capability entry as editable and fallible.
- Playback diagnostics report and suggest. Nothing here re-grabs, replaces or deletes a version
  because a client transcoded it; a suggestion becomes an action only through the existing
  picker or a ladder edit the administrator makes.
- Enrichment is slow and may cost money, and the plan says so rather than hiding it: a detail
  page fetch is a network round trip per release on a Raspberry Pi, a model call adds seconds and
  a per-call price on a hosted service, so enrichment never runs inline in a search response. It
  runs after the snapshot is built, for the top-ranked candidates only (bounded count), and the
  picker shows "enriching…" per row and re-ranks in place when results arrive. A per-day call
  budget, a per-call timeout and a running cost figure are visible in the settings area; when any
  of them is exhausted the release is evaluated unenriched.
- Model output may be unavailable, late or nonsense. The interface has exactly three outcomes:
  valid (schema-conformant, closed vocabulary, bounded lists), invalid (dropped, counted, the
  release stays unenriched) and unavailable (timeout, error, quota; same result). No outcome
  blocks a grab the title alone would have allowed, and none allows a grab the title alone
  would have refused unless the rung or rule opted into `enriched` evidence.
- Local versus hosted model is genuinely open (open question 1): a local model keeps every byte
  on the household network but needs hardware the Pi does not have; a hosted one is cheap per
  call but sends stripped page text off-site. The plan supports both behind one interface and
  ships neither turned on.

## Outline of the work

| ID | Task (all proposed) | Depends on | What acceptance must show |
| --- | --- | --- | --- |
| E1 | Decisions and contract: extractor interface, evidence levels `enriched` and `verified`, per-indexer enrichment switch, terms-of-service and rate rules, cache policy, DTOs | Phase 6 follow-up M21 accepted | A dated evidence heading with the pinned host's stream fields for DV profile, audio profile and subtitle streams, and the boundary server serving detail pages |
| E2 | Detail-page fetch: Torznab `comments`/`details` URL only, same host rules as torrent downloads, budgets and breaker shared with search, HTML stripped to text, bounded size, cached per release id and indexer revision | E1 | Boundary indexer counts one fetch per release per cache window; a 429 trips the shared breaker; pages over the cap are truncated and marked |
| E3 | Deterministic extractors: per-tracker templates for labelled fields (audio and subtitle tables, MediaInfo blocks) producing `enriched` fields with the closed vocabulary | E2 | Corpus of saved pages parsed with stated precision; a template that stops matching flags itself instead of guessing |
| E4 | Model-assisted extractor behind the same interface: local or hosted per open question 1, schema-constrained output, validation and bounding, per-day call budget and cost display, disabled by default, no secrets or private data in the prompt | E2, E3 | A boundary model endpoint returns valid, invalid and garbage outputs; only valid ones reach fields; unavailability degrades to E3 or to unenriched; the leak check proves no credential or catalog data in requests |
| E5 | Post-import truth: read `VideoRangeType`, DV profile and layer fields the host exposes, audio codec, profile, channels and language, embedded and external subtitle streams; store `verified` fields on the binding; reconcile with title and enriched fields; a `verified` mismatch against a copy's must criterion or a forbid makes the version a substitute of its copy, blocklists the release and writes `attribute_mismatch` — nothing is deleted or refused | E1 | Disposable files with real DV profile 5 / 7 / 8, HDR10, SDR, TrueHD Atmos, AC3 and sidecar subtitles; each row shows verified values; a mislabelled title is caught and superseded only after a compliant version plays |
| E6 | Language and subtitle gating once evidence is trustworthy: the follow-up's language lists accept `enriched` or `verified` evidence where the administrator allows it; the subtitle-provider boundary is documented in the UI ("Jellyfin fetches subtitles; this shows what the release ships") | E3–E5 | A generic-tracker title becomes matchable through enrichment; the block `requirement_unparseable` lifts only for indexers with enrichment on |
| E7 | Device capability catalogue: registered devices first (the user's LG television, phones, browsers), optionally seeded from Jellyfin's reported client device profiles, hand-maintained entries, importable shared definitions; per device: DV profiles (5 / 7 FEL / 8 / MEL), HDR10, HDR10+, HLG, codecs (HEVC Main10, AV1, VVC), container and bitrate limits, audio passthrough (TrueHD, Atmos, DTS-HD, DTS:X), known quirks; every field editable, every entry showing its source | E1 | The catalogue saves and re-reads; an imported definition is marked as such; a device's entry can be overridden field by field |
| E8 | Selection modes: **device-targeted** (a designated primary device, or per-user device, lets the ladder prefer rungs that device direct-plays — an LG that plays DV profile 8 and hybrid but not profile 7 FEL ranks a hybrid 2160p above a UHD BDRemux); **maximum compatibility** (a ladder preset preferring what most clients direct-play — 1080p H.264 or 8-bit HEVC SDR, AC3 or AAC stereo or 5.1, no DV profile 7, no lossless audio, moderate bitrates, no huge remuxes — editable, with the trade-off against picture and sound quality stated); and **both**, one top-quality copy for the main device and one compatibility copy for everything else, which the Phase 6 follow-up's must-tier model already expresses, so this task adds only the capability awareness that decides what "compatible" means for the user's actual clients | E5, E7 | The same snapshot ranks differently under each mode with the reason shown per row; the two-copy ladder fills both copies |
| E9 | Direct-play diagnostics: per held version and per registered device, whether the host would direct-play, remux or transcode and why (from the host's playback info for that device profile); wrong catalogue entries detected by repeated transcoding of a version that was supposed to direct-play; suggestions shown on the detail page and in a settings report; never an automatic re-grab | E7, E8 | A version the catalogue says direct-plays but the host transcodes is flagged with the stream and the device field that disagree |
| E10 | Caching, staleness and correction: enriched fields cached per release and indexer revision with an age; re-enrichment on demand and on template change; verified fields replace enriched ones; an administrator can correct any field by hand and the correction wins and is kept | E2–E5 | A corrected field survives re-enrichment; a stale cache is refreshed only within budgets |
| E11 | UI: evidence level per field everywhere the follow-up shows attributes (title, enriched, verified, corrected); the detail page and version rows show real audio and subtitle tracks and direct-play status per device; the picker's "why" expander shows enrichment; a devices section and the mode selector in the settings area; desktop, mobile and TV by D-pad | E5–E10 | The built browser matrix; an ordinary user sees tracks and languages, never enrichment controls |
| E12 | Isolated acceptance: boundary indexers with detail pages, a boundary model endpoint, disposable media with real stream variety, registered disposable devices, restarts, budgets, leak checks; production never contacted | E1–E11 | The full chain with every safeguard shown to stop it |

Commit scopes would follow the convention: `docs(enrichment,p8.e1)`, `feat(enrichment,p8.e2-4)`,
`feat(verification,p8.e5)`, `feat(languages,p8.e6)`, `feat(devices,p8.e7-9)`,
`feat(enrichment,p8.e10)`, `feat(enrichment,p8.e11)`, `test(enrichment,p8.e12)`.

## Data and contract sketch

Outline only; E1 publishes the real DTOs. Everything stays in the plugin's SQLite database with
migrations; no synthetic `BaseItem`, no host configuration change.

| Record | Minimum contents and invariants |
| --- | --- |
| `ReleaseEnrichment` | `IndexerId`, `SourceGuid`, `IndexerRevision`, `FetchedAt`, `PageSha256`, `PageBytes` (capped), `ExtractorKind` (`template` / `model`), `ExtractorVersion`, `FieldsJson` (closed vocabulary, each with confidence `enriched`), `Outcome` (`valid` / `invalid` / `unavailable`), `CorrectionsJson?`. Cached per release and indexer revision; re-enriched only on demand or template change (E10). |
| `ExtractorTemplate` | `Id`, `IndexerId`, `Name`, `SelectorsJson` (labelled-field rules for the tracker's layout), `Revision`, `LastMatchedAt`, `ConsecutiveMisses`. A template that stops matching flags `drift` instead of guessing (E3). |
| `ModelExtractorConfig` | `Kind` (`none` / `local` / `hosted`), endpoint reference, `ApiKeySecretRef?` (secret store, write-only), `DailyCallBudget`, `TimeoutSeconds`, `CostPerCallHint?`, `Enabled` (**false**), `PromptVersion`. The prompt template is code, not configuration, so what leaves the server is auditable (E4). |
| `VerifiedMediaFacts` | On the binding: `VideoRangeType`, `DvProfile?`, `DvLayers?` (`mel` / `fel` / `none`), `HdrFormats[]`, `VideoCodec`, `BitDepth`, `AudioStreams[]` (codec, profile, channels, language, default), `SubtitleStreams[]` (language, forced, external), `ReadAt`, `HostVersion`. Confidence `verified`; replaces `enriched` and `parsed` for the same field on the version rows (E5). |
| `Device` | `Id`, `Name`, `Kind` (`tv` / `phone` / `browser` / `other`), `JellyfinDeviceIds[]` (matched from the host's sessions and device list), `IsPrimary`, `OwnerUserId?`, `Source` (`manual` / `imported` / `seeded`), `Revision` (E7). |
| `DeviceCapability` | `DeviceId`, `Field` (`dv_profile_5`, `dv_profile_7_fel`, `dv_profile_8`, `hdr10`, `hdr10_plus`, `hlg`, `hevc_main10`, `av1`, `vvc`, `max_bitrate`, `truehd_passthrough`, `atmos`, `dts_hd`, `dts_x`, `container_*`, `quirk:<name>`), `Value`, `Source`, `Note`. Every row editable and showing where it came from. |
| `PlaybackDiagnostic` | `BindingId`, `DeviceId`, `ObservedAt`, `PlayMethod` (`directPlay` / `directStream` / `transcode`), `TranscodeReasons[]` (as the host reports them), `CatalogueExpectation`, `Disagrees` (E9). |

Endpoints, all administrator-only unless noted, under `/JellyfinMod`: `GET/PATCH
/Settings/Enrichment` (per-indexer switch, budgets, model config with write-only key,
`POST /Settings/Enrichment/Test`); `POST /Releases/{searchId}/Enrich` (bounded, top N,
202 and per-row updates through `GET /Releases/{searchId}`); `GET/POST/PATCH/DELETE
/Settings/Devices` and `/Settings/Devices/{id}/Capabilities`, `POST /Settings/Devices/Import`
(file upload, never a fetch); `GET /Settings/Devices/Seed` (the host's known devices for
matching); `GET /Entries/{id}` gains `versions[].verified`, `versions[].playback[]` per registered
device and `evidence` levels per attribute; `GET /Diagnostics/Playback` (report). Health
`capabilities` gains `enrichment`, `verification`, `devices`. Ordinary users see verified tracks
and languages on the detail page and nothing else from this phase.

## How it fits the other phases

- **Phase 6 follow-up** owns the model (attributes, confidence, ladders, copies, rules,
  grammars); this phase adds two confidence levels and three evidence sources and changes no
  rule semantics. A rung or rule that never opted into `enriched` evidence behaves exactly as
  before this phase.
- **Phase 7** owns the settings area and Prowlarr-synced indexers; the enrichment switch, the
  model section and the devices section are new sections there (S8 layout), and a synced
  indexer's enrichment switch is one more administrator override a sync preserves.
- **Phase 5** owns import; E5 runs after binding, reads streams through the host, and writes
  only onto the plugin's binding record. **Phase 3** owns deletion; E5's mismatch handling
  supersedes a version through the Phase 6 replacement path and never deletes directly.
- **PHASE9** (ratings) is unrelated data with the same rules: plugin SQLite, secret store, degrade
  to absent, never block browsing.

## Entry gates (none met)

1. The Phase 6 follow-up (M10–M21) is accepted on the isolated instance, so the ladder, copy,
   rule and grammar model this phase extends is real.
2. Phase 7 S8 and S9 are accepted, so the settings area and Prowlarr-synced indexers exist for
   the enrichment switch, the devices section and the mode selector.
3. The user has answered open question 1 (local or hosted model, or no model at all) and open
   question 5 (which devices matter).
4. The boundary server can serve detail pages per release and a model endpoint with scripted
   good, bad and unavailable responses; disposable media with real DV, HDR10, SDR, lossless and
   lossy audio and sidecar subtitles exist in the isolated writable library.
5. The terms of service of the user's tracker allow automated detail-page reads at the planned
   rate, recorded without naming credentials or private URLs.

## Risks

| Risk | Required response |
| --- | --- |
| Detail-page scraping breaks or gets the account limited | Off by default per indexer; shared budgets and breaker; cache; templates flag their own drift |
| A model invents attributes | Closed vocabulary, schema-constrained output, validation and bounding, `enriched` never above `parsed`, explicit opt-in per rung or rule |
| Private data reaches an external service | Only stripped page text and the title; no credentials, no catalog; leak check in acceptance; local model as an option |
| The device catalogue is wrong | Registered devices over a world catalogue; every field editable with its source shown; transcoding evidence flags disagreements |
| Diagnostics turn into silent re-grabbing | Report and suggest only; actions go through the picker or a ladder edit |
| Duplicating Jellyfin's subtitle providers | Read-only; the boundary is stated in the UI |

## Open questions for the user

1. **Model.** No model (deterministic extractors only), a local model on the household network,
   or a hosted model with the data limits above? Consumed by E1 and E4.
2. **Which trackers may be read.** Enrichment per indexer off by default (proposed); which of the
   user's indexers allow it and at what rate? Consumed by E2.
3. **Mismatch after import.** Substitute, blocklist and report without deleting (proposed), or
   also refuse the import and leave the download to the seed release? Consumed by E5.
4. **Enriched evidence and grabs.** May `enriched` fields satisfy a must criterion at all
   (proposed: only where a rung or rule opts in), or should they only rank? Consumed by E6.
5. **Devices.** Which devices matter — the LG television's model, phones, browsers, other TVs —
   and is there one primary device for the server or one per user? Consumed by E7 and E8.
6. **Shared definitions.** Should device capability definitions be importable and shareable
   (proposed: importable from a file, never fetched automatically), or hand-maintained only?
   Consumed by E7.
7. **Compatibility copy by default.** Should new installations get the two-copy ladder (main
   device plus compatibility) or a single-copy one? Consumed by E8.
8. **Correction authority.** May an administrator's hand correction of a verified field override
   what the host's streams say (proposed: no; corrections apply to enriched and title fields
   only)? Consumed by E10.
