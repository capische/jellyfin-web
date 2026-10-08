# Season and series packs — design (2026-10-08)

Part of the 0.1.0.0 detail page design fix (`fix/detail-page-design`), not a phase: the user chose on 2026-10-08, during
their own test on 28096, to build pack acquisition inside this fix ("Build Season / All Seasons now"). The fix is not
accepted until this part passes its live acceptance too. Status: **built (not accepted)** for the plugin (`4074ca7`, `f440381`, Codex review 1 CHANGES REQUESTED, fixes in progress); web built (the commits *search season and series packs from the release picker* and its runner checks; rendering checked with route fixtures only, not yet reviewed).

Design by Opus 5.5 high. Code map: an exploration of the plugin at `a0ccd77` (summarised in "Where one episode is assumed
today" below).

## User decisions (2026-10-08, in this session)

1. **Scope switch in the release picker.** Episode searches that episode; Season searches packs of that season; All
   Seasons searches complete-series packs. On an episode page the episode dropdown goes; the switch reads
   `Episode: <S01E01 · name>`, `Season <n>`, `All Seasons`, on one line with the quality profile.
2. **Episodes already held.** A release row offers two actions: **+ Add** (the pack's file goes beside what is held, as
   another version) and a **Replace** icon (the pack's file replaces what is held). Episodes without a file are filled by
   either action.
3. **Automation prefers packs.** When several episodes of a season are missing, the automatic search looks for a season
   pack first.
4. **Live test on 48096 with a legal fixture**: a small public-domain season pack served by the instance's own web seed.

Earlier in the same round (already built, commit `75281f1849`): spinner while searching, choices on one line, the picker
wide and scrolling, a cross to close it.

## User decisions (2026-10-09, user, after the first live run on 48096)

5. **The default version stays the higher resolution.** After + Add put a 720p file beside the 1080p one already held, the
   720p became the episode's default. Cause: Jellyfin 12 (its own `VideoListResolver`, checked against the host's
   `Jellyfin.Naming` 12.0.0) makes a file whose name carries a resolution (`[0-9]{3,}[ip]`, e.g. `- 720p WEB-DL`) the main
   version ahead of every file without one, whatever either really is, and among files without one takes the first by name.
   The plugin's own first import of an episode carries no label, so any added version won. The fix is at that layer, in the
   plugin's naming of the new file, and never renames or moves a held file: a new version names its resolution only when it
   is known to be higher than every version held (held resolutions read from the file name, the release it was imported
   from, else the width Jellyfin probed; an unknown one is never assumed lower). A lower or equal one is named after the main
   file it goes beside with a label without a resolution (`<main file> - WEB-DL`), so it sorts right after it; a resolution
   the main file names (`720p`, `4K`, `UHD`) is never copied into it, and no name is ever cut short. Every name is checked
   with Jellyfin's own grouping of the folder before anything is linked; when no name would keep the higher file first, the
   import blocks as `versions_not_grouped` and nothing is linked (Codex review, 2026-10-09). Its version
   label still says `720p WEB-DL` in the plugin's rows and history. The web keeps Jellyfin's default on a desktop and the
   device preference on TV and phone (V1 decision 4) unchanged; a viewer's own choice is never replaced. Files grouped before
   this fix keep the order Jellyfin gave them.
6. **With episode upgrades off the picker offers only + Add, and Add works.** Decision applied (the user may veto it): a
   manual Add of a version never requires episode upgrades, for packs and for a single episode's Get Another Quality alike;
   Replace does; automatic upgrades and automatic extra versions stay gated by the setting exactly as before. Every search
   answers `grab.modes` (`fill`, `add`, and `replace` only while episode upgrades are on); the web shows the Replace icon only
   where `replace` is offered, and an older plugin without `modes` keeps both. A replace grab with the switch off answers
   409 `episode_replace_disabled`. An Add over held episodes with upgrades off leaves two files per episode, which retention
   already handles (V1 S3, E7): nothing in retention assumes one file per episode when upgrades are off.
7. **Seed history: one line for a pack.** A pack whose N files are imported writes one `seeding_released` line naming the
   pack ("Stopped seeding the Season 1 pack after its goal. Nothing was deleted; its downloaded files stay on disk."), keyed
   by the pack's first release, not N identical lines; a single episode's or a movie's release keeps its own line as before.

## Where one episode is assumed today (plugin `a0ccd77`)

- **API**: `ReleasesController.Search` requires `episodeId` for a series (`episode_required`); target DTOs carry one
  episode.
- **Search**: `ReleaseTargets.For(entry, episode)`; Torznab `tvsearch` only with `season` *and* `ep`; text suffix always
  `SxxEyy`. The parser already sets `SeasonPack` for `S01` / `Season 1` and for `Complete Series` / `Seasons 1-3`, but
  loses the end of a season range and has no end marker for "complete" (the title then fails `title_mismatch`). The
  evaluator rejects every pack (`season_pack`, "until their import mapping exists") and checks size per hour against one
  episode's runtime.
- **Grab**: one `GrabOperation.EpisodeId`; unique `ActiveTarget` (`episodeId ?? entryId`, `+add` for another version) and
  `ActiveHash` per client and info hash; history describes one episode.
- **Import**: one `ImportOperation` per grab (unique `OpenGrabKey = grab.Id`), one chosen file (exactly one video file
  near the largest, else `ambiguous_files`; `episode_mismatch` unless the file is that one episode); the first completion
  frees the grab; grab history is stamped onto the first binding only.
- **Seeding**: one `SeedReleaseOperation` per import (unique on the import); releasing removes the whole torrent by hash,
  so a sibling would lose it early.
- **Queue**: one row per grab, projected onto `grab.EpisodeId`; Remove and blocklist act on the hash.
- **Automation**: one target per missing episode; skips an episode whose `ActiveTarget` is taken.
- **Retention**: per file already (seed protection by physical identity; multi-file torrents handled by
  `TorrentDataRemoval`). No change needed beyond the seed release.

## Design

### Scope

`ReleaseScope` = `episode` (with `episodeId`) | `season` (with `seasonNumber`) | `series`. Movies have only the implicit
title scope. The API keeps `episodeId` for the episode scope, so every existing caller reads as before:

`GET /JellyfinMod/Releases?entryId=…&scope=season&seasonNumber=2[&profileId][&intent]`

The covered episodes of a scope are the entry's **aired, tracked** episodes in that season (season) or in every season
except specials (series). The requester must be able to read every one (`CanReadEpisode`), else `403`.

### Search

- **Torznab**: season scope sends `tvsearch` with `season=N` and no `ep` when the caps list `season` (with `tvdbid` when
  listed); otherwise a text query. Series scope sends `tvsearch` with only the id, or a text query.
- **Text queries**: season `"<title> S02"` and `"<title> Season 2"`; series `"<title> Complete"` and `"<title>"` (filtered
  by the evaluator). Each extra query counts against the existing per-search request budget and rate-limit breaker.
- **Parser** (`ReleaseParser`): keep `S01` / `Season 1`; add season ranges (`S01-S03`, `S01-03`, `Seasons 1-3`,
  `Season 1-3`) as `SeasonFirst..SeasonLast`; add a marker index for `Complete` / `Complete Series` / `Complete Seasons`
  so the parsed title stops before it; a range or complete pack sets `SeriesPack`.
- **Evaluator**:
  - Episode scope: unchanged. Packs stay rejected (`season_pack`), so nothing an episode search could grab changes.
  - Season scope: eligible only for a pack of exactly that season (`SeasonPack`, `SeasonNumber == N`, no range).
    A single-episode or multi-episode release is rejected `not_a_pack`. A range covering N is rejected `pack_range`
    (it belongs to All Seasons).
  - Series scope: eligible for `Complete …` or a range covering every season that has covered episodes. A narrower range
    is rejected `pack_incomplete` with the seasons it covers. A single-season pack is rejected `not_complete`.
  - Size per hour is checked against the **summed runtime** of the covered episodes (a missing runtime falls back to the
    series' typical runtime, else `runtime_unknown` as today).
  - Identity (title, year, indexer season attribute) is checked as today; an indexer `episode` attribute on a pack row is
    ignored.
- **Result rows** carry the coverage for the picker: `coverage: { seasons: [2], complete: false }` and the counts
  `missing` / `held` among the covered episodes.

### Grab

- `GrabOperation` gains `Scope` (`episode` / `season` / `series` / `title`), `SeasonNumber`, and `Mode`
  (`fill` / `add` / `replace`). `EpisodeId` stays for the episode scope.
- **Claims**: a new table `GrabClaims (GrabId, EpisodeId, ActiveKey unique)` claims each episode a grab will write: every
  covered episode for `add` and `replace`, the missing ones for `fill`. The active key is the episode's existing target
  key (`episodeId`, `+add` for add and replace), so a single-episode grab and a pack can no longer take the same episode
  twice. A single-episode grab writes its one claim as well. `grab_active` names the episodes already claimed.
  `ActiveTarget` on the grab becomes `pack:<entry>:<season|all>` for a pack (one pack per scope at a time).
- **Modes**: an acquire grab with nothing held is `fill`. Where the scope holds files, the row offers **+ Add** (`add`)
  and **Replace** (`replace`); an episode-scope Get Another Quality grab is `add` (as `+add` is today), and its Replace is
  the same row's icon.
- **History**: one `grabbed` event per claimed episode (data carries the grab id and the pack's coverage), stamped with that
  episode's binding at its import.

### Import

- On completion the pack's video files are **mapped to covered episodes** by parsing each file name (and its folder for a
  season number). Samples, extras and files under a size floor are ignored; specials, other seasons and multi-episode
  files are skipped and named in the history (`pack_file_skipped`, with the reason).
- One `ImportOperation` per mapped claimed episode; `OpenGrabKey` becomes `grab.Id:episodeId` (unique), so one grab owns
  N open imports.
- `fill`: an episode that gained a file meanwhile is skipped (`target_exists`, not an error).
  `add`: imported as another version, named like today's `+add` import.
  `replace`: imported as another version first; once Jellyfin has bound the new file, the episode's other files are removed
  through the existing version removal (`RetentionExecutor.RemoveVersionAsync`, as `UpgradeService` does with
  `upgrade_replaced`), with its guards (playing, kept, seed protection). A refused removal keeps both files and records
  why; nothing is removed before the new file is in the library.
- The grab finishes, and its claims and `ActiveTarget` are released, only when every child import is final. A pack where
  no file mapped finishes as `failed` with `pack_no_files`.

### Seeding

- One seed release **per grab** for a pack: `SeedReleaseOperation` gains `GrabId` and a child list of the seeding paths
  of every imported file. The torrent is detached and its hash freed only once the goal is met and every path is
  releasable; one blocked path keeps the whole torrent. Single-episode and movie grabs keep their release per import.

### Queue

- One row per pack grab: "Season 2 pack · 8 episodes" / "Complete pack · S01–S05", whole-torrent progress. Remove, retry
  and blocklist act on the grab (they already act on the hash). Each claimed episode shows Grabbed / Downloading through
  its claim.

### Automation (prefers packs)

- For each monitored series, missing monitored aired episodes are grouped by season. A season **qualifies for a pack**
  when every episode of it has aired and at least two monitored episodes are missing (proposed default; see choices).
- A qualifying season is searched with the season scope first. An eligible pack is grabbed in `fill` mode under the same
  budget, profile and size rules; one pack counts as one grab against the daily budget and as its mapped imports against
  `MaxConcurrentImports`.
- With no eligible pack, the season's episodes are searched one at a time as today. Claims stop a later single-episode
  search taking an episode a pack is downloading.
- Automation never uses `replace`.

### Web

- **Picker scope switch** (`ReleasePickerDialog`): on an episode page one dropdown `Episode: S01E01 · Name` /
  `Season 1` / `All Seasons`, default Episode; on a series page `All Seasons`, `Season 1…n`, then the episodes, default the
  first missing episode as today. Same line as the quality profile.
- **Rows**: coverage chips (`Season 2 · 8 episodes`, `Complete · S01–S05`), and where the scope holds files two actions at
  the row's end: **+ Add** and a **Replace** icon (`swap_horiz`, red confirm through upstream's `confirm`: "Replace the
  files of N episodes? Their current files are removed once the new ones are in the library."). Enter on a row is the
  first action (fill or add). Rows where nothing is held keep one action.
- **Queue and pages**: a pack shows on each covered episode's page as Grabbed / Downloading (queue line) and once on the
  queue.

## Implementation choices — proposed, not user-approved

1. A season qualifies for an automatic pack when all its episodes have aired and at least two monitored episodes are
   missing.
2. Season scope accepts only packs of exactly that season; multi-season ranges belong to All Seasons.
3. All Seasons accepts a complete pack or a range covering every season with tracked episodes; specials (season 0) are
   never covered.
4. Samples, extras and files under the size floor are ignored without a history line; specials, other seasons and
   multi-episode files are skipped and named in history (as the Import section says; corrected 2026-10-09 after the
   live run found the checklist contradicting it).
5. Replace removes the old files only after the new file is bound, through the existing version removal and its guards.
6. One pack per scope at a time (`ActiveTarget pack:<entry>:<season|all>`).

## Owning code paths and the upstream surface (added 2026-10-08, after the plugin build)

The coordinator asked for these before coding; the plugin's first build (`4074ca7`, `f440381`) went in before this
section was written, so it is recorded here after the fact.

- **Owner**: this fix (`fix/detail-page-design`) owns pack acquisition end to end. Changes and acceptance for packs route
  through it, not through Phases 4, 5, 6 or 10, whose single-episode behaviour must stay as accepted.
- **Plugin code paths** (one owner each, all in this fix): search (`ReleasesController`, `ReleaseTargets`,
  `ReleaseSearchService`, `ReleaseParser`, `ReleaseEvaluator`); grab and claims (`GrabService`, `GrabClaims`, trigger
  `GrabClaimRelease`); import (`ImportService`, `ImportPlanning`, `PackReplaceService`); seed protection
  (`SeedReleaseService`: per-file releases coordinated per pack); queue (`QueueReadModel`, `QueueController`); retention
  (unchanged code, reached through `RetentionExecutor.RemoveVersionAsync` for Replace); automation (`AutomationRunner`).
- **Principle 0 surface (web)**: none new. The picker is the mod's own dialog (opened through upstream's `dialogHelper`,
  as before); the scope switch, coverage chips and Add / Replace live inside it; Replace confirms through upstream's
  `confirm`; queue and detail pages reuse the existing queue line. No upstream file, selector or scss changes.

**Merge order with Phase 9 (coordinator, 2026-10-08).** This fix's migrations (`20261007110102_DetailFileHistory`,
`20261008043448_SeasonPacks`) sit on plugin `master` without Phase 9. Phase 9 (ratings) lands after this fix: its
migrations (`20261007043632_PhaseNineRatings`, `20261007073736_PhaseNineRatingsIdentity`,
`20261008062122_PhaseNineRatingsDisplayDefaults`) then have to be re-dated after this fix's and its model snapshot
regenerated, by its owner, so a database that already holds this fix's migrations applies Phase 9's cleanly.

## Acceptance checklist (live on 48096, then the detail page acceptance and real Chrome)

**Legal pack fixture**: "JellyfinMod Pack Fixture" — a series of two seasons with three short episodes each (public-domain
clips, re-encoded H.264, a few MB each), built on the Pi under `/mnt/4tb/jellyfinmod-live48096/webseed`, published by
48096's web seed and a fake Torznab feed as: a Season 1 pack (three episodes, a `sample` file, an extra), a Season 2 pack,
a complete pack (both seasons), and single-episode releases of S01E01. TMDB is 48096's own fixture server. Every title,
file and library is removed afterwards and 48096 is restored byte for byte.

1. Episode page, scope switch reads `Episode: S01E02 · …` / `Season 1` / `All Seasons`, on one line with the profile.
2. Season scope lists only the Season 1 pack as eligible; ranges and single episodes are in the rejected group with reasons.
3. All Seasons lists the complete pack; a single-season pack is rejected.
4. With no files held: grabbing the Season 1 pack fills all three episodes; one queue row "Season 1 pack · 3 episodes";
   each episode page shows the queue line while it downloads; the sample and the extra are not imported (no history line).
5. The torrent is detached once, after every file is imported and the seed goal is met; library files remain.
6. With S01E01 held: + Add adds the pack's file as another version of S01E01 and fills the others.
7. Replace on S01E01: the old file is removed only after the new one is bound and playable; with S01E01 kept, Replace
   keeps both and history says why.
8. A single-episode grab of an episode a pack holds is refused (`grab_active`), and the other way round.
9. Queue Remove on the pack clears every episode; Retry on one failed episode re-imports only that one.
10. Automation, with S02 fully aired and missing: grabs the Season 2 pack, not three single episodes.
11. Indexers unavailable (breaker open): the picker says so with the retry time, not "No releases found."
12. Desktop, mobile, TV 1080 and 720 for the picker; then real Chrome; no fixtures left, `GET /UserViews` clean.

## Build order and tests

1. **Plugin**, worktree `plugin-detailfix`: migration (`GrabClaims`, grab scope/mode columns, seed release grab and paths,
   import key); parser; evaluator; search scopes; grab claims and modes; pack import mapping; replace; seed release per
   grab; queue projection; automation. Integration suites extended on the Mac where they run there (Phase 4 search and
   grab with fake Torznab, Phase 6 automation) and on the Pi for Phase 5 import (bind-mount aliases) and Phase 3 seed
   protection: pack fixtures in the fake Torznab and fake Transmission, real SQLite, real HTTP.
2. **Web**, worktree `jellyfin-web-detailfix`: scope switch, coverage chips, Add / Replace, queue labels.
3. **Codex** gpt-6.1-sol high review of plugin and web; fixes; re-review until approved (test runners one pass).
4. **Live on 48096**: rebuild the Phase 5/6 stack, build a legal public-domain season pack (short clips, 3–4 episodes)
   seeded by its web seed through the separate Transmission; run season pack fill, add and replace, a complete pack, the
   automation preference and the queue Remove, then restore 48096 byte for byte. Then the full detail page acceptance and
   real Chrome on 28096 or 18096 under a lease.

Estimate in agent time: plugin 2–3 five-hour windows of Opus high; web half a window; Codex 2–3 reviews; 48096 rebuild
and pack fixture about one window; live acceptance about one window.
