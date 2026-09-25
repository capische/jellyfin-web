# Phase 12 — multiple held qualities

Planned, not scheduled. Moved from PHASE6.md's follow-up on 2026-09-25 (user decision); task ids
M10–M21 and question numbers 11–22 are kept unchanged so existing references stay valid.

Planning draft, 2026-09-21. **Proposed, not user-approved**, except where a numbered user decision
is quoted. It plans work only; it establishes nothing about M2–M9's live acceptance, writes no
product code and authorizes no deployment. Read the Phase 6 sections above, [PHASE4.md](PHASE4.md)
(candidate DTO, `match`, rejection codes), [PHASE5.md](PHASE5.md) (version labels),
[PHASE7.md](PHASE7.md) §5–§6 (settings area, Prowlarr-synced indexers), [UX.md](UX.md) §9, §11
and §13, and [API.md](API.md) *Acquisition* and *Automation and versions* alongside it.
[PHASE8.md](PHASE8.md) extends the model defined here with evidence the release title lacks; this
section deliberately decides only from the title, with a stated confidence, and says `unknown`
whenever the title does not say.

## Why a follow-up

The 2026-09-19 defaults treat quality as one ordered list per profile with one cutoff: a title
holds one version, an upgrade replaces it, and *Get another quality* is a manual exception. The
user's actual wish is different in kind: hold **more than one** quality on purpose (a
best-possible version for the living-room television and a compatible one for everything else),
choose between releases on attributes the flat list cannot see (Dolby Vision versus HDR10+,
Atmos versus lossy audio, which dub and subtitle languages a release ships, edition tags), and
express all of that in the user's own words for the user's own tracker, whose titles follow a
grammar the generic parser does not know. The user's driver is *"what my LG TV plays best"*.

## Accepted decisions Phase 12 builds on

- Automation is off by default, budgeted and logged; Keep blocks replacement; `replace` is the
  default upgrade mode and the explicit action adds; reclaimed titles are not re-acquired unless
  `reacquireReclaimed`; episode versions and upgrades stay blocked while `episodeUpgradesEnabled`
  is off (defaults accepted 2026-09-19). Nothing here changes those; a ladder is how the
  administrator asks for more than one version, and the switches still gate what automation may do.
- Retention reclaims the lowest quality first within a due target and marks the title reclaimed
  only when no playable version remains (M7, accepted). Phase 12 is **acquisition-side
  only**: it never protects a version from retention, never changes what is due and never
  changes the reclaim order.
- Title-and-year matches: manual grab allowed, automation only from `automateTitleMatches`
  indexers (PHASE4 decision 7, PHASE6 decision 1 above).
- Search, grab, profiles and every setting are administrator-only (Phase 4 A1); ordinary users
  gain no acquisition control from anything below.
- Never port GPL-3.0 Sonarr/Radarr code; custom-format behaviour may inform test cases only.
- Retention keeps folders and sidecars (accepted 2026-09-20); a second version lands beside the
  first under Jellyfin's multi-version naming (Phase 5), and nothing is renamed.

## The model

**Attributes and confidence.** Every candidate and every held version is described by a closed
attribute vocabulary; every attribute value carries a confidence:

| Attribute | Values (closed vocabulary) |
| --- | --- |
| `resolution`, `source`, `videoCodec`, `bitDepth` | as Phase 4 today (`2160p`, `bluray`, `remux`, `webdl`, `hevc`, `10`…) |
| `dynamicRange` | `dolby_vision`, `hdr10_plus`, `hdr10`, `hlg`, `sdr`; plus `dvProfile` (`5`, `7`, `8`, `unknown`) and `dvHybrid` (DV with an HDR10 base layer) when the title says so |
| `audioCodec[]` | `truehd`, `dts_x`, `dts_hd_ma`, `dts_hd_hra`, `dts`, `eac3`, `ac3`, `aac`, `pcm`, `flac`, `opus`; `atmos` is a flag on `truehd` or `eac3`, never a codec of its own |
| `audioChannels` | `2.0`, `5.1`, `7.1`, `unknown` |
| `audioTracks[]` | `{ language, kind }` with `kind` in `original`, `dub`, `mvo`, `dvo`, `avo`, `vo` (multi-, dual-, single-voice and voice-over dubs, as the user's tracker labels them) |
| `subtitleLanguages[]`, `forcedSubtitles` | ISO 639 codes; `forcedSubtitles` `true`/`false`/`unknown` |
| `edition` | `theatrical`, `directors_cut`, `extended`, `unrated`, `imax`, `remastered`, `open_matte`, `hybrid`, `criterion`, `other(<text>)` |
| `releaseGroup`, `proper`, `repack` | as today |

Confidence is one of `parsed` (a grammar or the generic parser read the value from the title),
`inferred` (an indexer default supplied it, for example "every release on this tracker carries a
Russian dub unless the title says otherwise") or `unknown`. The rules for `unknown` are fixed and
the same everywhere: a **required** attribute that is `unknown` is not satisfied; a **forbidden**
attribute that is `unknown` does not reject (unknown is not the forbidden value) unless the tick or
rule is marked *strict*; a **preferred** attribute that is `unknown` adds nothing. Nothing is ever
guessed to fill a gap; PHASE8 is where missing evidence would come from.

**Ladder, rungs and copies.** A *ladder* is an ordered list of *rungs*, best first. A rung is a
named set of attribute criteria — at least a resolution, usually a dynamic range, optionally codec,
source, audio and edition constraints — for example `2160p Dolby Vision` → `2160p HDR10+` →
`2160p HDR10` → `2160p SDR` → `1080p` → `720p`. A candidate or held version *fits* the highest rung
whose criteria it satisfies; one that fits no rung fits the ladder not at all (`rung_none`). Some
rungs are marked **must have**; each must-have rung defines a **copy** the title should hold — a
version that fits that rung or a higher rung inside the same *tier* (the run of rungs down to the
next must-have rung). The user's two cases are two must-have rungs: `2160p Dolby Vision` (copy A,
with `2160p HDR10+` and `2160p HDR10` acceptable substitutes above the next must rung) and `1080p
SDR` (copy B, "plays everywhere"). A ladder with a single must-have rung at the top behaves
exactly like today's profile: one version, upgraded to the cutoff. PHASE8 calls this the
*must-tier model*.

**Copy states.** Per target and per copy: `empty` (nothing held fits the tier), `substitute` (a
version from a lower rung stands in until a fitting one is found; allowed only where the copy says
`substituteAllowed`, default on for the top copy and off for the others — open question 11),
`filled` (a held version fits the copy's rung or better within its tier), `upgrading` (an
`UpgradeOperation` is open for it), `reclaimed` (retention removed the version that filled it;
frozen, see *Retention*) and `dormant` (automation gave up; see *Budgets*).

**How the existing profile fields map.** A scope that has a ladder derives the Phase 4/6 fields
instead of storing them: `qualities` = the rungs' `source-resolution` ids in order, `cutoff` = the
top must-have rung, `upgradeAllowed` = true while any copy is `substitute`, `upgradeMode` =
`replace` inside a copy (the substitute is replaced by the version that fits) and `add` between
copies (a second copy is always an additional version). Scopes without a ladder keep the existing
flat profile unchanged; nothing is migrated automatically.

**Scope.** A ladder is assigned at server (the default), library or title level; episodes inherit
their series. The most specific assignment applies whole — a title ladder replaces the library
ladder rather than extending it (open question 12) — and the UI always shows where the effective
ladder comes from. `PATCH /Entries/{id}` keeps `qualityProfileId` for the flat case and gains
`ladderId` for the ladder case; setting one clears the other.

**Ticks.** A ladder carries two tick grids that apply to every rung unless a rung overrides them:
dynamic range (`dolby_vision`, `hdr10_plus`, `hdr10`, `hlg`, `sdr`) and audio (`truehd`, `atmos`,
`dts_x`, `dts_hd_ma`, `dts_hd_hra`, `dts`, `eac3`, `ac3`, `aac`, `pcm`, `flac`, `opus`), each
tick one of *neutral*, *required*, *preferred* (with a weight) or *forbidden* (optionally
*strict*). These are what the user called quality-profile ticks; they live on the ladder so the
editor shows them beside the rungs.

**Rules.** User-defined string-match rules complete what ticks cannot express:
`{ name, terms[], mode: plain | regex, wordBoundary: true, target: title | group | indexer,
effect: required | forbidden | preferred, weight, strict, scope }`. Plain terms match
case-insensitively at token boundaries, where a boundary is the start or end of the title or any
of `.`, `_`, `-`, space, `[`, `]`, `(`, `)`: `DV` therefore matches `.DV.` and `[DV]` and never
`DVD` or `DVDRip`. Regex rules use .NET's non-backtracking engine with a match timeout and a
length cap, are administrator-only, and are refused at save time when they do not compile.
Every rejection names its rule (`rule_forbidden` / `rule_required` with `rule: "<name>"`) and
every preference shows as a contribution `rule:<name>` with its points, so the picker's "why"
answers "which rule did this".

**Preferred indexers.** An indexer gains `preferred` (tie-break and a bounded score contribution
`indexer_preferred`) beside the existing `priority`, `automateTitleMatches`, budgets and seed
minimums. Prowlarr-synced indexers carry the same fields as administrator overrides that a sync
never overwrites (PHASE7 §6's override list grows by `preferred`, `automateTitleMatches` and
`grammarId`).

**Grammar.** A `ReleaseTitleGrammar` is assigned per indexer. It is an ordered list of segments
split by a delimiter, each segment a labelled field with a word map from the tracker's own
vocabulary to the closed vocabulary above — for the user's tracker: title and original title,
year, source, resolution, dynamic range, the audio-track list with its `MVO`/`DVO`/`AVO`/`VO`
and *original* markers and languages, the subtitle-language list, and edition tags. A segment
that matches yields `parsed` values; an indexer default yields `inferred`; anything else is
`unknown`, and the generic Phase 4 parser remains the fallback for every field the grammar does
not cover. A grammar has a **Test** that takes pasted sample titles and shows the parse field by
field with its confidence, because a grammar nobody can check is a guess.

**Languages and subtitles.** The ladder carries `audioLanguages` (required / preferred /
forbidden lists), `dubKinds` in preference order (for example `original` > `mvo` > `dvo` > `avo`
> `vo`), `originalAudioRequired` and `subtitleLanguages` (required / preferred). They are
evaluated only from what the title carries: when a required language cannot be decided because
the attribute is `unknown`, automation blocks the candidate with `requirement_unparseable` and a
manual grab shows a warning instead ("language not stated in the title"). Fetching subtitles is
the host's job (its subtitle providers); Phase 12 only reads what a release says it ships.

**Presets.** A preset bundles a ladder, its tick grids, rules and language preferences under a
name and is **copied** into a scope when applied — later edits to the preset never change scopes
that already applied it, and the copy is fully editable. Shipped presets are starting points, not
device knowledge: *Original quality* (remux-first, lossless audio preferred), *Living-room
television* (the user's LG: 2160p Dolby Vision profile 8 or hybrid, then HDR10+, then HDR10; DV
profile 7 FEL forbidden strictly because the title usually says `P7`/`FEL` when it applies;
TrueHD/Atmos preferred, never required), *Plays everywhere* (1080p, H.264 or 8-bit HEVC SDR,
AC3/E-AC3/AAC, no remux, size cap), *Phone and tablet* (720p/1080p, AAC/E-AC3 stereo or 5.1,
small). Which of these is honest for the user's actual television model is open question 17;
real capability knowledge is PHASE8 E7–E8.

**Quick-filter chips.** Inside the release picker, chips filter the candidate list over the parsed
attributes and compose by AND: resolution, dynamic range, audio codec, `Atmos`, `Original audio`,
a dub language and kind, a subtitle language, `Remux`, edition, a size cap, `Preferred indexers`,
`Verified identity`. A chip set can be saved as a named picker preset and, from the same menu,
turned into rules on the current title's ladder. Chips never change what is *eligible*; rejected
rows stay in their group with their reasons.

## Data model and ownership

| Record | Minimum contents and invariants |
| --- | --- |
| `QualityLadder` | `Id`, `Name`, `Revision`, `TicksJson` (dynamic range and audio grids), `LanguagesJson`, `GiveUpAfterDays` (90), `PresetOrigin?`. Deleting a ladder in use is refused (409), as for profiles. |
| `LadderRung` | `LadderId`, `Order`, `Name`, `CriteriaJson`, `MustHave`, `SubstituteAllowed`, `TickOverridesJson?`. Criteria reference only closed-vocabulary values and existing `source-resolution` ids. |
| `LadderAssignment` | `Scope` (`server` / `library` / `entry`), `ScopeId`, `LadderId`. At most one per scope id. |
| `AttributeRule` | `Id`, `Name`, `Terms`, `Mode`, `WordBoundary`, `Target`, `Effect`, `Weight`, `Strict`, `Scope` (server / ladder / entry), `Revision`. Regex validated and length-capped at save. |
| `ReleaseTitleGrammar` | `Id`, `Name`, `SegmentsJson` (delimiter, ordered fields, word maps), `DefaultsJson` (inferred attributes), `Revision`, `SampleTitles` (bounded, for Test). Assigned through `AcquisitionIndexer.GrammarId?`. |
| `AcquisitionIndexer` (existing) | Gains `Preferred`, `GrammarId?`; `AutomateTitleMatches` exists (decision 7). Synced indexers keep these as overrides. |
| `Preset` | `Id`, `Name`, `Kind` (`device` / `picker`), `Shipped`, `PayloadJson` (ladder + rungs + ticks + rules + languages, or a chip set), `OwnerUserId?` for picker presets. |
| `HeldCopyState` | `TargetId`, `CopyRungId`, `State`, `FilledByBindingId?`, `NextSearchAt`, `ConsecutiveEmpty`, `DormantSince?`, `ReclaimedAt?`, `Reason?`. One row per target and copy; created lazily. Replaces the single `AutomationTargetState` schedule for ladder scopes; flat scopes keep one implicit copy. |
| `UpgradeOperation` (existing) | Gains `Kind` (`cutoff` = today's behaviour, `rung_upgrade`, `copy_fill`, `substitute_replace`) and `CopyRungId?`. Replacement provenance stays `upgrade_replaced`; a `copy_fill` is `upgrade_added`. |
| Candidate snapshot (Phase 4) | Gains `attributes` with per-field confidence, `rung` (fit per ladder), `copyFit[]` (which copies it would fill or substitute), `ruleHits[]`, `heldCopyState`. |
| History | `copy_filled`, `copy_substituted`, `copy_gave_up` (once per state change); existing `upgrade_added` / `upgrade_replaced` / `auto_grabbed` unchanged. |
| Settings | `LadderSearchIntervalHours` for substitute-upgrade hunting (168, weekly), `MaxCopiesPerTitle` (3), `GrammarTestSampleCap` (50). |

Ownership is unchanged: the scheduler decides and calls Phase 4's grab; Phase 5 imports; Phase 3
deletes; Phase 2 binds. No follow-up service writes `Entry.State`, a binding or a file.

## Scoring, cutoff, retention and automation together

- **Evaluation order**, fixed: Phase 4 hard constraints (identity, packs, size, blocklist) →
  rung fit (`rung_none` rejects) → required ticks, rules and languages (`attribute_required`,
  `rule_required`, `requirement_unparseable`) → forbidden ticks and rules (`attribute_forbidden`,
  `rule_forbidden`) → score: `rung_rank` (dominant, by rung order), then `attribute_preferred`,
  `rule:<name>`, `indexer_preferred`, then today's seeders, size and freeleech contributions.
  Every contribution is visible; rejected rows list every failed check, not the first.
- **Upgrade to a higher rung.** A copy in `substitute` searches for a version fitting a higher
  rung inside its tier and replaces the substitute through the existing M5 sequence
  (`substitute_replace`, provenance `upgrade_replaced`). A copy in `filled` is never touched by
  automation: there is no upgrade past the copy's own rung, which is what makes the top must rung
  the cutoff. A held version that fits a *higher* rung than the copy asked for fills it; the
  ladder never downgrades.
- **Cutoff in flat scopes** is untouched; profiles without a ladder behave exactly as M5 today.
- **Retention (acquisition-side only).** Copies never protect anything. When a due target is
  reclaimed lowest-first (M7) and a copy loses its version to a `retention` operation, that copy
  becomes `reclaimed` and stays frozen: it is not re-filled while the title is still on disk, and
  once the last version goes the entry is `reclaimed` and `reacquireReclaimed` decides as today
  (open question 13). A copy emptied by an administrator's Remove-from-queue or by an external
  deletion (Phase 2 `media_missing`) returns to `empty`. Keep blocks every replacement, including
  `substitute_replace`; a kept title only gains versions (2026-09-19 default 2).
- **Budgets, give-up and backoff.** Each copy has its own schedule and backoff (12 h doubling to
  7 days, as M3); the daily grab budget, per-entry budget (now per entry and copy), open-import
  cap, free-space floor, breaker and per-indexer budgets apply unchanged. Substitute-upgrade
  hunting runs on the slower `LadderSearchIntervalHours` cadence so it cannot starve first
  acquisitions. After `GiveUpAfterDays` of only empty or rejected searches a copy becomes
  `dormant` with `copy_gave_up`; a manual search, a ladder or grammar change, a new indexer or
  re-monitoring wakes it. Automation takes `"title"`-identity candidates only from
  `automateTitleMatches` indexers and records `title_match_untrusted` when that is the only reason
  nothing was eligible (the dedicated reason promised in decision 1).
- **Episodes.** While `episodeUpgradesEnabled` is off (accepted 2026-09-19), a series ladder acts
  as a single-copy ladder for episodes: only the top copy is filled, no substitute is replaced, no
  second copy is added, and `addVersion` keeps answering `episode_versions_unsupported`. When the
  switch is on after the I1 live evidence, copies apply per episode with the per-entry budget
  counted per series so a long series cannot exhaust the day. Season packs stay rejected.
- **Preferred indexers** never override a rung or a required tick; they only order otherwise
  equal candidates and add a bounded contribution.

## API contract (additions)

All under `/JellyfinMod`, administrator-only unless stated, camelCase, revisioned, unknown fields
rejected. S1 of Phase 7 publishes DTOs in API.md; M10 publishes these.

| Endpoint | Contract |
| --- | --- |
| `GET/POST/PATCH/DELETE /Settings/Ladders`, `/Settings/Ladders/{id}` | Ladder with rungs, ticks and languages; validation: at least one rung, at least one must-have rung, criteria in the closed vocabulary, ticks consistent (a value cannot be both required and forbidden), `MaxCopiesPerTitle` respected. Delete in use → 409 `ladder_in_use`. |
| `PUT /Settings/Ladders/Assignments` | `{ scope, scopeId, ladderId | null }`; `GET` lists effective assignments with origin. |
| `GET/POST/PATCH/DELETE /Settings/Rules` | Rules; regex compile failure → 400 `rule_invalid_regex` naming the position. |
| `GET/POST/PATCH/DELETE /Settings/Grammars`, `POST /Settings/Grammars/{id}/Test` | Test takes `{ titles[] }` (capped) and returns per-title attributes with confidence and the segment each came from; never touches an indexer. |
| `GET/POST/PATCH/DELETE /Settings/Presets`, `POST /Settings/Presets/{id}/Apply` | Apply takes `{ scope, scopeId }`, copies the payload into a new ladder (and rules) and assigns it; returns the created ids. Picker presets are per administrator (`ownerUserId`; open question 20). |
| `PATCH /Settings/Indexers/{id}` (existing) | Gains `preferred`, `grammarId`; `automateTitleMatches` exists. Synced indexers accept these as overrides. |
| `GET /Releases?…` (existing) | Candidates gain `attributes`, `rung`, `copyFit`, `ruleHits`; the response gains `ladder: { id, name, origin, copies: [{ rungId, name, state, filledBy }] }` and `chips` (the vocabulary present in this snapshot, so the UI offers only chips that can match). Rejection codes add `rung_none`, `attribute_required`, `attribute_forbidden`, `rule_required`, `rule_forbidden`, `requirement_unparseable`; contributions add `rung_rank`, `attribute_preferred`, `rule:<name>`, `indexer_preferred`. `intent=addVersion&copyRungId=` targets a specific copy. |
| `GET /Entries/{id}` (existing) | `versions[]` rows gain `attributes` (from the file name grammar and the host's streams where Phase 6 already reads them) and `copy` (which copy the version fills); detail gains `copies[]` mirroring the search response, for administrators. |
| `GET /Automation/Targets` (existing) | Per-copy rows: `copyRungId`, `state`, `nextSearchAt`, `consecutiveEmpty`, `dormantSince`, `blockedReason`. Decision `reason` adds `copy_filled`, `copy_dormant`, `title_match_untrusted`, `requirement_unparseable`. |
| `GET /Health` | `capabilities` gains `ladders`, `grammars`, `presets`. |

## Entry gates

**Proposed, not user-approved.**

1. The M2–M9 live checklist is recorded as passed on the isolated instance; automation that
   multiplies per copy must first be right for one.
2. Phase 7 S8 is accepted, or the editors land on the Dashboard plugin page first and move to the
   settings area in S8 without a second contract (M20 states which).
3. PHASE4 decision 7 is verified live in A8 (`"title"` candidates, flag on and off).
4. A corpus of the user's tracker's release titles exists as a committed fixture (titles only:
   no private URLs, passkeys or tracker name in the file name) with the expected parse recorded
   beside each — the grammar's acceptance oracle. Whether the tracker's own naming may be described
   in a committed file is open question 19.
5. The Torznab boundary server can emit titles in that grammar and in generic scene form, and the
   disposable library can hold three versions of one movie.
6. `MediaSources`/`MediaStreams` on the pinned host expose `VideoRangeType` and the audio codec
   profile fields the version rows need; recorded in M10 (real DV profile detection is PHASE8 E5).

## Tasks and acceptance

| ID | Task and owner | Depends on | Required evidence |
| --- | --- | --- | --- |
| M10 | Decisions, vocabulary, grammar corpus, spikes and contract | Gates 1–6 | Dated *M10 evidence*: host stream fields, corpus parse table, DTOs in API.md |
| M11 | Data model, migrations, settings; Dashboard forms as the first editor | M10 | Migration on a copy of the isolated database; admin save/read/restart; ordinary user 403 |
| M12 | Attribute parsing: vocabulary, generic-parser extension, grammar engine and Test | M10 | Corpus parsed with stated precision; `unknown` where the title is silent; Test endpoint |
| M13 | Rule engine and tick grids | M11, M12 | Word-boundary, regex-safety and named-rejection cases through `GET /Releases` |
| M14 | Ladder evaluation, rung fit, copies and scoring; flat-profile derivation | M12, M13 | Same snapshot ranked under three ladders with visible contributions; flat scopes unchanged |
| M15 | Automation per copy: schedules, budgets, give-up, substitutes, rung upgrades, title-match gate, preferred indexers | M14 | Boundary-driven multi-run scenario; every decision reason present; no double grab across restart |
| M16 | Retention interplay and copy freezing | M15, Phase 3 | Lowest-first unchanged; reclaimed copy not re-filled; Keep blocks substitute replacement |
| M17 | Language, dub and subtitle preferences; `requirement_unparseable` | M12, M14 | Grammar titles matched and generic titles blocked with the code; manual warning shown |
| M18 | Presets: shipped set, apply-by-copy, picker presets | M11, M14 | Apply creates an editable copy; preset edits do not touch applied scopes |
| M19 | Web: picker chips, attribute line, "why" expander, copy summary on detail and version rows | M14–M18 contract, X4 | Built browser, desktop/mobile/TV by D-pad; old plugin hides everything |
| M20 | Web: ladder, rule, grammar and preset editors; Prowlarr-synced overrides | M11, PHASE7 S8 or Dashboard | Every editor saves and re-reads across a restart; synced indexer overrides survive a sync |
| M21 | Isolated acceptance and release gate | M10–M20 | Two-copy title acquired, substituted, upgraded, watched and reclaimed unattended within budgets |

Commit scopes: `docs(ladders,p6.m10)`, `feat(ladders,p6.m11)`, `feat(parsing,p6.m12)`,
`feat(rules,p6.m13)`, `feat(ladders,p6.m14)`, `feat(automation,p6.m15-16)`,
`feat(languages,p6.m17)`, `feat(presets,p6.m18)`, `feat(picker,p6.m19)`,
`feat(settings,p6.m20)`, `test(ladders,p6.m21)`; fixes use `fix(<component>,p6.mN)`.

### M10 — settle vocabulary and evidence before modelling

Record, under a dated *M10 evidence* heading in this document, without host paths: the closed
vocabulary and its confidence rules as implemented; the corpus of the user's tracker's titles with
the expected parse per title (gate 4) and the generic scene titles used for comparison; which
`MediaStreams` fields the pinned host exposes for `VideoRangeType`, `VideoRange`, audio `Profile`
and `Codec` on a disposable file with HDR10 and one with lossy audio; whether a version's file
name (Phase 5 label) or the streams is the source of each held-version attribute; the substitute
and merge answers to open questions 11–13 as decided; the DTOs above published in API.md with one
example each.

**Acceptance** — the evidence heading exists, every open question this task consumes is marked
answered or re-asked, and the corpus fixture is committed with no private data.

### M11 — persist ladders, rules, grammars, presets and copies

Add the records with migrations; extend the Dashboard plugin page (or the Phase 7 settings area,
per gate 2) with editors for ladders (rungs, must-have, substitute, ticks, languages), rules,
grammars (with Test) and presets, and the indexer fields `preferred` and `grammarId`. Validation
per the API table. The migration creates nothing automatically: existing profiles and entries
keep their flat behaviour until an administrator assigns a ladder.

**Acceptance** — real host on the isolated instance: the migration applies to a copy of the
isolated database with clean integrity and foreign-key checks and every existing profile,
target state and operation preserved; an administrator saves a two-copy ladder, three rules, one
grammar and one preset in the built page, restarts, and reads them back unchanged; a ladder
without a must-have rung, a rung outside the vocabulary and a rule with an invalid regex are each
refused with a message naming the rule; an ordinary user gets 403 on every route.

### M12 — parse attributes with a stated confidence

Extend the generic parser to the vocabulary (Dolby Vision and profile markers, HDR10+, HLG, Atmos,
DTS family, TrueHD, PCM/FLAC, channel layouts, edition tags, language markers where scene names
carry them) without guessing; implement the grammar engine and its Test; apply the assigned
grammar first and the generic parser second; attach confidence to every field. Independent
implementation, GPL-3.0 sources excluded.

**Acceptance** — through `POST /Settings/Grammars/{id}/Test` and `GET /Releases` against the
boundary indexer emitting the corpus: every corpus title parses to its expected table with
`parsed` confidence for grammar fields; generic titles yield `unknown` for languages and
`parsed` for what they state; `DV` in `DVDRip` is never Dolby Vision; an indexer default yields
`inferred`, visibly distinct in the DTO; a grammar whose delimiter does not match falls back to
the generic parser for the whole title and says so.

### M13 — rules and ticks that name themselves

Implement tick grids and rules in the evaluation order above with the `unknown` semantics and the
word-boundary and regex rules stated in *The model*.

**Acceptance** — `GET /Releases` on the isolated instance: a required `hdr10_plus` tick rejects an
HDR10 title with `attribute_required` and passes an HDR10+ one; a strict forbidden `sdr` tick
rejects an `unknown` dynamic range while a non-strict one does not; the rule `DV` (plain) matches
`.DV.` and not `DVDRip`; a regex rule with catastrophic backtracking potential is refused at save;
every rejection lists the rule or tick by name; the picker shows it verbatim.

### M14 — rank on the ladder

Compute rung fit, copy fit and the score; derive the flat fields for ladder scopes; keep flat
scopes byte-identical in behaviour (same snapshot, same order, same contributions as before).

**Acceptance** — the same boundary snapshot evaluated under (a) no ladder, (b) the *Living-room
television* preset, (c) *Plays everywhere*: (a) matches the pre-follow-up ordering exactly; (b)
ranks a hybrid 2160p DV release above a 2160p HDR10 release above a 1080p one with `rung_rank`
dominant and shows `copyFit` for both copies; (c) ranks the 1080p H.264 release first and rejects
the remux with `rung_none`; `heldCopyState` reflects a disposable movie holding one version.

### M15 — automate per copy without running away

Per-copy schedules, backoff, give-up, substitute acquisition, rung upgrades through
`UpgradeOperation` kinds, `title_match_untrusted`, preferred-indexer ordering, the slower
substitute-hunting cadence, and the episode gating.

**Acceptance** — isolated instance, boundary server counting queries, budgets small, clock
advanced by the documented override:

- A wanted movie under the two-copy ladder: run 1 grabs the best available (a 2160p HDR10 as
  substitute for copy A and a 1080p for copy B, two grabs, two imports, both versions in the
  stock selector); run 2 finds a 2160p DV in the feed and replaces the substitute only after the
  new version played (`substitute_replace`, `upgrade_replaced` history, no `media_missing`); the
  1080p copy is untouched throughout.
- With the DV never appearing, after `GiveUpAfterDays` the copy is `dormant` with `copy_gave_up`;
  a manual `searchNow` wakes it once.
- A `"title"` candidate from an unflagged indexer yields `title_match_untrusted`; flagging the
  indexer makes the next run grab it.
- Two indexers with identical rows: the `preferred` one is chosen and the contribution is shown.
- Budgets: the per-entry-and-copy budget allows the two first grabs on day one and refuses a third
  with `budget_grabs`; the daily budget, floor and breaker behave as M3.
- Killing the container mid-run leaves no duplicate grab, import or replacement.
- A series under the same ladder with `episodeUpgradesEnabled` off acquires one version per
  episode and never a second; `addVersion` answers `episode_versions_unsupported`.

### M16 — keep retention exactly as accepted

Freeze copies emptied by retention; leave order, eligibility and protections untouched.

**Acceptance** — disposable two-copy movie, both versions due: the run reclaims the 1080p first
(M7 unchanged); the next automation run does **not** re-grab a 1080p (copy B `reclaimed`,
decision `copy_dormant`-style reason `copy_reclaimed`); once the 2160p is reclaimed the entry is
`reclaimed` and stays so with `reacquireReclaimed` off; with Keep set, a substitute is never
replaced (`kept_entry`) though a missing copy may still be filled; a version removed by hand
outside the plugin returns its copy to `empty` after the next scan.

### M17 — languages the title states, and nothing more

Language, dub-kind and subtitle preferences on the ladder; `requirement_unparseable`; the manual
warning.

**Acceptance** — required audio language plus preferred `mvo`: corpus titles with a matching dub
are eligible and ordered by dub kind; generic titles are blocked with `requirement_unparseable`
in automation and listed as eligible-with-warning in the picker; a required subtitle language
behaves the same; `originalAudioRequired` rejects a dub-only title whose grammar says no
original track.

### M18 — presets that start, not own

Shipped presets, Apply as copy, picker presets, and the "turn chips into rules" action.

**Acceptance** — Apply of *Living-room television* to a library creates a ladder and rules with
`presetOrigin` set and assigns them; editing the shipped preset afterwards changes nothing in the
library; a picker preset saved by one administrator is not listed for another (per open question
20); converting a chip set into rules yields rules whose names cite the chips.

### M19 — the picker and the detail page

Chips row (composed, saveable; on TV collapsed behind one *Filter* stop so the first focus stays
on the top release, per UX §13 rule 5), an attribute line under the parsed summary with
confidence styling (`unknown` shown as "not stated", never blank), a "why" expander per row
listing every contribution and rejection with rule names, `copyFit` markers, and on the detail
page a copies summary and per-version attributes on the M8 rows. Styles feature-local, `em`, no
`display: contents` or flex `gap`; gate on `capabilities` containing `ladders`.

**Acceptance** — built browser on the isolated instance at desktop, mobile, TV 1920×1080 and TV
1280×720 with `layout=tv`, arrow keys, Enter and Back: chips compose and the list updates in
place without unmounting the focused row; saving a chip preset and re-opening the picker offers
it; the "why" expander shows a named rule rejection; `Get another quality` for copy B opens the
picker with `copyRungId` set and held qualities marked; an ordinary user sees attributes and never
a chip-save or rule action; an old plugin hides chips, expander and copy summary while the M8
rows keep working. `tsc`, eslint and stylelint pass; physical webOS separately.

### M20 — editors in the settings area

Ladder, rung, tick, rule, grammar (with Test) and preset editors, and the indexer fields, in the
Phase 7 settings area (or on the Dashboard page until S8, per gate 2, with no second contract).

**Acceptance** — built browser as `oleksii` and as an ordinary user: every editor saves, echoes
the revision and re-reads across a restart; the grammar Test shows a pasted title's parse; a
Prowlarr-synced indexer's `preferred`, `automateTitleMatches` and `grammarId` survive three syncs;
mobile at 390 px has no horizontal scroll; TV reaches every section and Back returns; the
ordinary user gets the UX §14 message.

### M21 — isolated acceptance and release gate

On `jellyfinmod-test` (port 18096), plugin revision from Health, deployed with X3, signed in as
`oleksii` with an empty password, real services per the 2026-09-20/21 decision plus the boundary
server for controlled cases, production never contacted:

1. A disposable movie under the two-copy ladder goes, unattended over at least four runs, from
   wanted to two versions (one substitute) to the substitute replaced after playback, within
   budgets and with every decision in the log; restarts between runs create no duplicate.
2. Rules, ticks, languages and a grammar each change the ranking visibly in the picker with named
   reasons; the corpus parses as recorded in M10.
3. Retention: the T18 cycle still passes; lowest-first holds; frozen copies are not re-filled;
   no `media_missing`.
4. Presets apply by copy; picker presets round-trip; Prowlarr overrides survive a sync.
5. Security: every new route answers 401/403 for anonymous and ordinary users; regex rules cannot
   stall the server (timeout observed).
6. Browser: M19 and M20 matrices; the Movies grid never blanks while copies change.
7. Record revisions, query counts against run summaries, timings and Pi memory; set automation
   off, remove disposable media and every fixture ladder, rule, grammar and preset.

The follow-up is complete only when a title holds the copies its ladder asks for, chosen for the
reasons the picker shows, upgraded only within a copy, and left alone by acquisition once
retention has spoken.

## Risks

| Risk | Required response |
| --- | --- |
| Two copies double every budget and every disk cost | Per-copy budgets under the unchanged daily and floor limits; `MaxCopiesPerTitle`; substitutes only where allowed |
| A ladder silently changes what an existing profile does | Flat scopes are untouched; ladders are opt-in per scope; M14 proves byte-identical flat behaviour |
| Guessed attributes drive grabs | Closed vocabulary, confidence on every field, `unknown` never satisfies a requirement, no inference beyond declared indexer defaults |
| The grammar drifts when the tracker changes its naming | Grammar Test with a committed corpus; a non-matching delimiter falls back visibly to the generic parser |
| A user regex hangs the evaluator | Non-backtracking engine, timeout, length cap, compile-time refusal |
| Retention and copies fight (reclaim, re-grab, reclaim) | Copies emptied by retention freeze; `reacquireReclaimed` stays the only re-acquisition switch |
| Presets claim device knowledge they do not have | Presets are named starting points and say so; capability truth is PHASE8 E7–E9 |
| Chips or editors break TV rules | Chips collapsed behind one stop on TV; editors are administrator surfaces verified for reachability and Back |
| GPL-3.0 custom-format code creeps in | Independent implementation; behaviour may inform tests only |

## Open questions for the user (follow-up)

11. **Substitutes.** May a lower rung stand in for the top copy only (proposed), for every
    must-have copy, or never (wait for the exact rung)? Consumed by M10 and M15.
12. **Scope merge.** Does a title ladder replace the library ladder whole (proposed) or extend
    it rung by rung? Consumed by M10 and M14.
13. **Copies after retention.** Stay frozen until the title is re-acquired or an administrator
    asks (proposed), or re-fill while the title is still on disk and monitored? Consumed by M16.
14. **Give-up window.** 90 days of empty searches per copy, then dormant until woken (proposed)?
    Consumed by M15.
15. **Unknown versus forbidden.** Does an `unknown` dynamic range pass a non-strict "forbid SDR"
    tick (proposed: yes, unknown is not SDR) with *strict* available per tick and rule? Consumed
    by M13.
16. **Regex rules.** Allowed for administrators under the safety limits (proposed), or plain
    terms only? Consumed by M13.
17. **Shipped presets and the television.** Which LG model and webOS version is the target, and
    should a *Living-room television* preset ship before PHASE8 E7 knows real capabilities
    (proposed: ship it, named as a starting point)? Consumed by M18 (and PLAN open question 17).
18. **Language defaults.** Which audio languages and dub kinds are required or preferred by
    default for this household, is original audio required, and which subtitle languages matter?
    Consumed by M17.
19. **Grammar corpus.** May the user's tracker's naming be described in a committed grammar
    fixture (titles only, no tracker name or URL), or must the corpus stay in the ignored test
    data? Consumed by gate 4 and M10.
20. **Picker presets.** Per administrator (proposed) or shared server-wide? Consumed by M18.
21. **Chips on TV.** Collapsed behind one *Filter* stop (proposed) or always visible in the
    dialog? Consumed by M19.
22. **Editors before S8.** Land the editors on the Dashboard plugin page now (proposed) or wait
    for the Phase 7 settings area? Consumed by gate 2 and M20.
