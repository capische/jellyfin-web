# Next-up first: download the first and the next unwatched episode first, import each as it finishes

Design, 2026-10-12, Opus 5.5 high. Status: **planned** (design only; nothing built). Plan entry: [`PLAN.md`](../PLAN.md),
*Planned new feature (user, 2026-10-12)*. Read with [`PHASE4.md`](../PHASE4.md) (A5 driver), [`PHASE5.md`](../PHASE5.md)
(I1–I7 import, seed release, queue) and [`season-packs-design.md`](season-packs-design.md) (claims, one import per
claimed episode).

The user: "remember to prioritize download of first episode and next unwatched always! so I can watch it earlier and
import straight after it's downloaded, without waiting for the whole season."

## Recommendation

1. **Phase 4 owns the order.** On every import-monitor tick the plugin picks, per series with open downloads, the earliest
   missing episode plus each viewer's next missing episode after their last watched one, and tells Transmission:
   `torrent-set priority-high` on those files inside a pack (`bandwidthPriority` and `queue-move-top` for single-episode
   torrents). Plain file priority, no sequential mode: the Pi runs Transmission 4.0.5, which has none.
2. **Phase 5 owns the early import.** A pack's episode import already exists per episode; it stops waiting for the whole
   torrent and starts as soon as *its own* file is complete and present in the download folder. Everything after that
   (hardlink, scan, binding, seed release, retention's seed check) is today's code, unchanged.
3. No migration, no new table, no new state, no setting, no queue action. The queue gains one optional field: each pack
   episode's own `progress`. The web shows an episode's own percent instead of the pack's.

What the simple design loses, in one line each: with Transmission's *incomplete folder* turned on, episodes still import at
the end of the torrent (question 2); priority makes the target files finish first but does not guarantee it (pieces
already in flight finish first, and a file no peer has cannot be sped up).

## 1. Today's flow (read 2026-10-12, plugin `next-release` at `7a17fda`)

**Grab hand-off (Phase 4).** `GrabService.CreateAsync` (`JellyfinMod/Services/Acquisition/GrabService.cs:117`) holds a
grab; for a pack, `PackClaimsAsync` (`:347`) claims the covered episodes (fill: those without a file; add/replace: all)
as `GrabClaim` rows, using `ParsedRelease.PackSeasons()` (`ReleaseParser.cs:61`, `SeasonNumber..SeasonLast`, or
`SeriesPack` for all seasons). After the hold, `DispatchAsync` submits once through `IDownloadClientDriver.SubmitAsync`
(`DownloadClientDriver.cs:107`; `TransmissionDriver.SubmitAsync`, `torrent-add` with `metainfo` or a magnet `filename`,
two labels: the configured one and the owner label `jfmod-<grabId>`). `VerifyAsync` (`GrabService.cs:649`) finds the
torrent by hash, forces unlimited client seed modes (`ApplySeedSettingsAsync`), marks the grab `accepted`, creates the
import operations in the same commit (`ImportService.CreateForGrabAsync`, `ImportService.cs:138`) and wakes the monitor
(`:712`). The driver has no priority call today; `TransmissionDriver` is the only registered driver
(`AcquisitionServices.cs:28`).

**Pack to episodes.** `CreateForGrabAsync` makes **one `ImportOperation` per claimed episode** (`OpenGrabKey =
grabId:episodeId`). The torrent's file list is mapped to episodes only at identification, by name:
`ImportFileSelector.MapPack` (`ImportPlanning.cs:171`) keeps wanted, allow-listed video files above a tenth of the largest,
parses `SxxEyy` (or a bare episode number under a season folder), skips specials, other seasons, unclaimed,
multi-episode, unnumbered and duplicate files. A single-episode torrent uses `ImportFileSelector.Choose`.

**Progress (Phase 5).** `ImportMonitor` (`Services/Import/ImportMonitor.cs:14`) ticks every `ImportPollSeconds` (default
15 s, `Data/Acquisition.cs:307`) while anything is open, and on `Wake()`. Each tick reads each client once
(`ClientSnapshotReader` → `TransmissionDriver.GetStatusAsync`, fields `files` and `fileStats` included, `:104`), then
`ImportService.AdvanceAsync` moves each open import. `WatchAsync` (`ImportService.cs:322`) stores the **whole torrent's**
`percentDone` on every child of a pack (`Observe`, `:368`) and **returns while `!torrent.Complete`** (`:347`);
`ClientTorrentStatus.Complete` (`DownloadClientDriver.cs:59`) means every wanted byte of the torrent. `IdentifyAsync`
(`:405`) re-checks the same whole-torrent completion (`:420`) on every attempt (review P2-o), maps the pack, inspects the
mapped local path with a 10-minute settle grace for a file Transmission is still moving (`SourceSettleGrace`), records the
source inode and links. The queue's pack row (`QueueController.cs:77`) shows the whole torrent and lists each claimed
episode's import state (`QueueReadModel.Pack`, `:93`); cards use `QueueReadModel.ProjectAsync`/`LiveProgress` (`:53`),
again whole-torrent for a pack.

**Import rules (Phase 5).** Hardlink only, download folder and library on one filesystem (P5 decision; `LinkAsync`);
targeted scan, binding by reconciliation, then `CompleteAsync` (`:887`) writes one `imported` history event keyed by the
operation, releases the episode's claim and creates one `SeedReleaseOperation` per import with
`SeedingPath = SourceLocalPath` (`:962–966`). Seeding: `SeedReleaseService.Evaluate` (`SeedReleaseService.cs:48`) requires
completion (`seeding_incomplete`), a pack's releases wait for every file of the pack (`pack_importing`/`pack_waiting`,
`:201`, `:213`) and then **detach** the torrent together; 0.1.0.0 never deletes a download (detach and keep).
**Retention** reads Transmission through `TransmissionSeedClient`, where a file counts complete only when its whole torrent
is (`TransmissionSeedClient.cs:110`), and `RetentionPreviewService` blocks such a library file as `seeding_incomplete`
(`RetentionPreviewService.cs:203`).

**Consequence:** a pack already has everything per episode except two whole-torrent gates (`WatchAsync:347`,
`IdentifyAsync:420`) and a client that downloads files in its own order.

## 2. What Transmission offers (verified)

- **The Pi** (read-only `session-get` inside the containers, 2026-10-12): `transmission-vpn` (production's) and
  `transmission-acceptance` (used by 28096 and, through its relay, 48096) both run **4.0.5, `rpc-version` 17,
  `rpc-version-semver` 5.3.0**. `transmission-acceptance` has **`incomplete-dir-enabled: true`**
  (`/accept/downloads/incomplete`, inside the same `/accept` bind mount) and `rename-partial-files: true`, download queue 5;
  production's has the incomplete folder off. 18096 has no download client configured (its database also predates the
  pack columns), so this feature is tested on 48096 or 28096.
- **Legacy RPC (what the plugin speaks), 4.0.x spec:** `torrent-set` takes `priority-high`, `priority-normal`,
  `priority-low`, `files-wanted`, `files-unwanted` (arrays of file indices, in `files` order) and `bandwidthPriority`
  (-1/0/1) per torrent; `queue-move-top` takes `ids`; `torrent-get` `fileStats[i].priority` and `bandwidthPriority` read
  them back. **An empty array means "all files"**, so the driver never sends one.
- **Sequential download** exists only from **Transmission 4.1.0** (`rpc_version` 18, semver 6.0.0, `sequential_download`
  on `torrent_set`, together with the switch to JSON-RPC 2.0 and snake_case). Not on the Pi; not used. It also answers a
  different need (playing while downloading) than "this file finishes first".
- **Is priority enough?** 4.0.5's piece picker (`libtransmission/peer-mgr-wishlist.cc`, `Candidate::compare`) orders
  wanted pieces by blocks missing (pieces already started finish first), then **priority**, then a random salt. Every
  untouched high-priority piece is requested before any untouched normal one, from peers and web seeds alike (web seeds
  ask the same wishlist, `webseed.cc`). So a high file finishes ahead of the rest, behind only the pieces in flight, as
  long as some peer has it. Good enough for "watch E01 in minutes, not after the season".
- **Per-file completion in 4.0.5** (`torrent.cc`, `onFileCompleted`): when a file's last piece passes its hash check the
  file is closed (reopened read-only to seed), its mtime is watched for reverification, and a `.part` suffix is renamed
  away **in the same folder**. The incomplete folder is moved to the download folder only when the whole torrent
  completes. `fileStats[i].bytesCompleted == length` is the per-file signal; the file under its final name in the download
  folder is the second.
- **Magnets:** until metadata arrives `files` is empty. The design needs nothing special: every tick re-reads, and the
  first tick with files sets the order.

## 3. Choosing the targets (Phase 4)

Per series entry, per client, on each tick, over the **open downloads in `waiting`** for that entry (pack children and
single-episode imports alike):

- **Candidates:** episodes (season > 0) of those imports whose file is still incomplete. A pack child counts once its file
  is known (section 5); a single-episode import is its torrent.
- **First:** the earliest candidate by (season, episode). It rolls forward: once S01E01 is imported, S01E02 is first.
- **Next for a viewer:** for every Jellyfin user who may read the entry (`LibraryAccess.CanRead`) and has watched any
  episode of its native series, the earliest candidate **after their last watched episode** (highest season and episode
  among their played episodes, specials excluded). Read with one query per user, the same shape as
  `LibraryAccess.GetSeriesDatePlayed` (`LibraryAccess.cs:211`: `InternalItemsQuery(user)` with
  `SeriesPresentationUniqueKey` and `IsPlayed = true`), which goes to the database and so sees imports and Trakt marks.
  A viewer whose next unwatched episode is already held can watch it now; their target is the first one still downloading
  after it.
- **Targets** = First ∪ every viewer's Next. Fewer than two candidates: nothing to order (a lone single-episode torrent, a
  pack's last file); any high priority the plugin set is put back to normal.
- **Re-evaluated every tick**, so a watch-state change, an import or late metadata takes effect within one poll (15 s).
  No event listener. Cost: one played query per viewer per series with two or more candidates per tick.
- Whole-series pack: the same rule across seasons, so S01E01 plus each viewer's next across seasons.
- A viewer who has watched everything held: their next is the first missing episode, which is First anyway.
- An entry not yet in the library (no native series): no watch history, First only.

## 4. Applying the order (Phase 4, run from Phase 5's tick)

- **Driver:** one new method on `IDownloadClientDriver`, `SetDownloadOrderAsync(connection, infoHash, highFiles,
  normalFiles, bandwidthHigh?, moveTop)`. `TransmissionDriver` sends one `torrent-set` with `priority-high`/
  `priority-normal` (each only when non-empty) and `bandwidthPriority` when given, and `queue-move-top` when asked.
  `ClientTorrentFile` gains `Priority` (from `fileStats`), `ClientTorrentStatus` gains `BandwidthPriority` (one more
  `torrent-get` field). The file index is the position in `files`, as Transmission defines it.
- **Service:** `DownloadOrderService` (Phase 4, `Services/Acquisition/DownloadOrder.cs`), called by
  `ImportMonitor.TickOnceAsync` after `ImportService.TickAsync`, the way `PackReplaceService` is, with the tick's cached
  snapshot (`ImportService.SnapshotAsync`). For each owned torrent (labels carry `jfmod-<grabId>`, the same proof
  `ApplySeedSettingsAsync` uses): desired high = target files; desired normal = files the client now reports high that are
  not targets. **Only a difference is written**; the read-back from the next snapshot makes it idempotent. Single-episode
  torrents of a series with two or more open downloads: `bandwidthPriority` 1 for a target, 0 for the others, and
  `queue-move-top` for a target the client reports `download_wait`.
- The plugin owns the priority of the torrents it added: a priority an administrator set by hand in Transmission on such a
  torrent is overwritten. Torrents it did not add are never touched.
- A client error is logged and retried next tick; it never blocks, fails or delays an import.
- The hold and Cancel are unaffected: nothing is ordered before the grab is `accepted` (the torrent exists only then), and
  acceptance already wakes the monitor, so a metainfo grab is ordered within seconds.
- PHASE5's rule "no pause, resume, priority or per-file selection" is about queue actions; this adds none.

## 5. Early import (Phase 5)

- **Know the file early.** While a pack child waits and the torrent has files, `WatchAsync` maps the pack with the
  existing `MapPack` and stores the episode's file in the existing `SourceClientPath` (download folder + file name), once.
  A mapping that finds nothing for the episode, or no files yet, changes nothing: the child keeps waiting, and today's
  completion path decides `pack_episode_missing`, `no_video_file` and the rest. The early path never blocks or fails.
- **Start on the file, not the torrent.** For a pack child the gate in `WatchAsync` and `IdentifyAsync` becomes "the
  torrent is complete, **or** this child's file is wanted, `bytesCompleted == length`, and the file exists under its final
  name at the mapped path with that length". The second half is checked before leaving `waiting`, so a file Transmission
  keeps in its incomplete folder (or still as `.part`) simply waits for the whole torrent as today: no settle grace, no
  `source_missing`. `CompletedDownloadAt` then means "this operation's file completed". Single-episode and movie imports
  keep the whole-torrent gate (their torrent is the episode).
- From `identifying` on, nothing changes: the same mapping, size check, hardlink on the same filesystem, scan, binding,
  `imported` event, claim release, `ImportEnabled` honoured.
- **Seeding while downloading.** The early file is a hardlink to a file Transmission keeps seeding and keeps open read-only;
  later pieces of other files never write to it (pieces at a file boundary are complete when the file is). The seed release
  is created at completion as today, waits `seeding_incomplete` and then `pack_importing` until the last episode is in,
  and detaches the torrent with the pack. Its `SeedingPath` is the download-folder path, which is where the file stays,
  because early import only takes files that are already there.
- **Retention (Phase 10).** A watched early file stays protected: Transmission still holds its inode in an incomplete
  torrent, so the seed snapshot reports it not complete and the preview blocks it `seeding_incomplete` until the pack
  completes and its goal is met. No change.
- **No double import.** A child that completed early is no longer open and is never advanced again; `CreateForGrabAsync`
  and Retry already refuse a second import of the same grab and episode; the `imported` event is keyed by the operation.
  When the torrent completes, only children still waiting move on.
- **Recheck and failures.** If a client recheck reports the file incomplete before it is linked, `IdentifyAsync` sends the
  child back to `waiting` (the existing rule, now on the file). After linking, a recheck that rewrites a bad piece writes
  into the shared inode, which is today's risk for any seeding file, only for a longer window. Missing file, size
  mismatch, collision, cross-filesystem: today's reasons, today's admin Retry.
- **Remove and blocklist.** Removing a pack from the queue mid-download removes it whole, as today: early-imported
  episodes stay in the library (their hardlinks survive "remove from client" with data), their open seed releases leave
  the queue with the rest.

## 6. Data model and contract

- **No migration.** No new column or table: `SourceClientPath` and `CompletedDownloadAt` already exist on
  `ImportOperation`; priorities live in the client and are re-derived each tick.
- **No new state** in the import, the seed release or the queue row (`queued`, `downloading`, `stalled`, `identifying`,
  `linking`, `scanning`, `blocked`, `failed`, `seeding`, `unknown`). A pack row keeps the whole torrent's figures and an
  open episode as its representative; an early-imported episode shows `completed` in `pack.episodes`, which the web
  already reads as in the library.
- **One new optional field:** `QueuePackEpisodeDto.progress` (0–1, null when unknown), the episode's own file
  `bytesCompleted / length` read from the cached snapshot by `SourceClientPath`, 1 once its import left `waiting`.
  `QueueReadModel.LiveProgress` uses the same per-file value for a pack child, so `POST /Browse` cards for an episode show
  its own progress. No capability flag: an older plugin omits the field and the web falls back to the pack's figure.
- Phase 6: nothing. Automation's pack grabs and single-episode grabs get the same order and early import; no queue state
  is added, so Phase 6's queue banner and decision log are untouched.

## 7. Web (small; owner Phase 4 with Phase 5's queue as the source)

- `types/queue.ts`: `QueuePackEpisode.progress?: number | null`.
- `hooks/useQueue.ts`: an episode's view of a pack row, the row with the episode's own `progress` (and `Importing…` once
  its import is past `waiting`), used by `integration/downloadMarks.tsx` (`rowsOf`/`episodeRows`) and
  `components/QueueStatusLine.tsx` for an episode target. Season and series cards still average their episodes, now each
  with its own figure. The queue page and the release picker's grabbed row keep the pack's whole-torrent figure.
- No layout change, no new badge or wording, so no mockup; it still goes through the first-look gate on one instance
  (numbers change on visible cards and rows).

## 8. Verification (CLAUDE.md Testing rules)

**Integration, `PhaseFiveIntegration`** (real Kestrel plugin host, authentication, MVC serialization, EF migrations,
SQLite, real hardlinks; runs in the Linux container on the Pi like the rest of Phase 5). Extend its real-HTTP
`TransmissionBoundary` (`tests/PhaseFiveIntegration/Boundaries.cs:207`): keep each file's priority and the torrent's
`bandwidthPriority`, answer them in `torrent-get`, apply `priority-high`/`priority-normal`/`bandwidthPriority` and
`queue-move-top`, record every call, complete one file at a time (`ProgressFile(hash, index, fraction)`), return no
files until "metadata" arrives, and optionally keep incomplete files in an incomplete folder. Give the host's simulated
library (the one simulated boundary, `Host.cs:321`, `:433`) per-user played episodes. Scenarios:

1. Season pack, nothing held, no history: after acceptance one `torrent-set` makes only E01 high; nothing is sent again
   while nothing changes; completing E01 alone imports it (hardlink inode equals the torrent file, `imported` once,
   episode `onDisk`) while the torrent is incomplete; E02 becomes high; the pack row stays `downloading` and
   `pack.episodes` shows E01 `completed` and E02 with its own `progress`.
2. Viewer position: E01 and E04 held, user A has watched E04, pack claims E02, E03, E05: high = {E02, E05}. Mark E04
   unplayed: E05 goes back to normal within one tick. A second user with history adds their own next.
3. Magnet: no files for two ticks (no call, no block), then files: the order is set.
4. Several single-episode torrents of one series: the target torrent gets `bandwidthPriority` 1 and `queue-move-top`
   while queued; others 0; a lone single torrent gets no call.
5. Torrent completes later: the remaining children import, no second `imported` for E01, seed releases wait and detach
   the pack once.
6. A file complete in the client but kept in the incomplete folder: no early import, no `source_missing`; it imports at
   torrent completion.
7. Client recheck after the early file was seen complete but before linking: back to `waiting`, no link.
8. Queue Remove with "remove from client" mid-download: the early episode's library file survives; nothing in a library
   is deleted. An unowned torrent's priorities are never changed. The boundary never receives an empty priority array.

Re-run Phase 4 and Phase 6 suites in the same container (driver and automation untouched otherwise).

**Live acceptance** on **48096** (its own TMDB fixture server and web seed, the separate `transmission-acceptance`
through the relay), under a lease, after backing up what the run changes and restoring it byte for byte. Never 8096,
never `transmission-vpn`. Legal fixture "JellyfinMod Next-Up Fixture": one season of five short public-domain clips
re-encoded to about 40 MB each, a Season 1 pack and single-episode releases, the web seed throttled with nginx
`limit_rate` so the pack takes about three minutes. If question 2 is answered as recommended, the acceptance client's
incomplete folder is off for the run (and stays off only if the user says so).

1. Pack grab with nothing held: `torrent-get` (read-only) shows E01 `priority` 1 within one poll; E01 completes before the
   others reach 100 %; it is imported and **plays in Jellyfin** while the torrent is still downloading; E02 then high.
2. Viewer position (E01, E04 held by single grabs, `oleksii` marks E04 watched): high = {E02, E05}; marking E04
   unwatched returns E05 to normal within a poll. Watch state restored afterwards.
3. Completion: one `imported` per episode, the pack detached once, library files remain.
4. Retention preview while the pack downloads lists the watched early episode as `seeding_incomplete`.
5. With the incomplete folder on (the client's own setting, restored): priorities set, no early import, normal import at
   the end, no blocked row.
6. Web, Chromium first: an episode card and row show their own percent while the pack row shows the pack's; desktop,
   mobile, TV 1080 and 720; then real Chrome at gate 2.
7. Cleanup: no fixture titles, files, torrents or libraries; `GET /UserViews` for `oleksii` shows only the instance's
   own libraries; lease released.

## 9. Risks

- Priority is a preference, not a guarantee: pieces already started finish first; a pack whose only peers lack E01 cannot
  deliver it earlier. The live step measures the real ordering on the web seed.
- The incomplete folder disables early import (question 2). Transmission 4.1 moves to snake_case JSON-RPC and will drop
  the legacy names one day; that is a driver-wide risk, not new here.
- Hand-set priorities on plugin torrents are overwritten.
- A recheck that rewrites a piece after linking changes the library file in place, as for any seeding file today, for a
  longer window.
- Each early episode triggers its own targeted scan as it lands instead of all at the end; the count is the same.
- One played query per viewer per series per tick while two or more of its episodes download.

## 10. Open questions (only the user can answer)

1. **Whose "next unwatched"?** Recommended: every user who may see the series and has watched part of it, plus the first
   missing episode for everyone. The grab's requester alone would leave automatic grabs (made by the automation
   identity, never a person) with no viewer at all.
2. **Transmission's incomplete folder.** Early import works only when unfinished files live in the download folder; the
   acceptance client (`transmission-acceptance`, used by 28096 and 48096) has the incomplete folder on, production's
   client has it off. Recommended: turn it off on the acceptance client (one client setting, user's call) and do not
   build incomplete-folder support, which would also have to move each seed release's recorded path when the torrent
   moves at completion. With it on, episodes import at the end of the torrent as today.
3. **Does "first" roll forward?** Recommended: yes, always the earliest episode still downloading, so a pack arrives
   roughly in episode order with each viewer's next one pulled ahead. The alternative is only the pack's very first
   episode, after which Transmission's own order resumes.

## 11. Estimate (agent time)

About **2.5 to 3 five-hour windows** of Opus high: plugin and its integration scenarios about 1 to 1.5 windows (the Phase 5
suite runs on the Pi), web about a third of a window, the legal fixture, live acceptance on
48096 and real Chrome about 1 window. Roughly **10–15 % of the weekly allowance**, plus one Codex gpt-6.1-sol high review at
the end and at most one fix-delta re-review. Not measured; a guess from the season-pack work of similar size.

## 12. Implementation tasks (small commits, plugin first, then web)

Plugin, branch from `next-release`:

1. **P4.FU2** `feat(acquisition,p4.fu2): set file and torrent download priority through the client`:
   `ClientTorrentFile.Priority`, `ClientTorrentStatus.BandwidthPriority`, the `bandwidthPriority` status field,
   `IDownloadClientDriver.SetDownloadOrderAsync` and its Transmission implementation (no empty arrays, owned torrents only).
2. **P4.FU3** `feat(acquisition,p4.fu3): download the first and each viewer's next episode first`: `DownloadOrderService`,
   the played-position read in `LibraryAccess`, registration, the call from `ImportMonitor.TickOnceAsync`.
3. **P5.FU1** `feat(import,p5.fu1): map a pack episode's file while it downloads`: `SourceClientPath` from `MapPack` in
   `WatchAsync`, never blocking.
4. **P5.FU2** `feat(import,p5.fu2): import a pack episode as soon as its own file is complete`: the per-file gate in
   `WatchAsync` and `IdentifyAsync`, the presence check before leaving `waiting`.
5. **P5.FU3** `feat(queue,p5.fu3): report each pack episode's own progress`: `QueuePackEpisodeDto.progress`,
   `LiveProgress` per file for pack children.
6. **P5.FU4** `test(import,p5.fu4): cover download order and early pack import`: the boundary extensions and scenarios
   1–8; Phase 4, 5 and 6 suites pass in the Linux container.

Web, branch from `next-release`:

7. **P4.FU5** `feat(queue,p4.fu5): show a pack episode's own download progress`: type, episode view, marks and status line,
   with the existing runner extended by one pack fixture route.
8. First look on 48096 (one layout), then the rest of the matrix and real Chrome, then the live checklist above, then
   `PLAN.md`, `PHASE4.md`, `PHASE5.md` and `API.md` updated with the owners and the field, then the one Codex review.
