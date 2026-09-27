# Live acceptance of Phases 4, 5 and 6 — evidence and handover

Brief: `live-acceptance-p4-p6` (workspace `.claude/briefs/`). Agent: Opus 5.5, high effort. Times are UTC in the tables;
Sydney is UTC+10. Services are named by role only. No address, host path or credential appears here.

**Status (2026-09-27, 15:25 Sydney): every row is run.** The scan-wait live E2E and the focus re-checks pass on plugin
`bfb1df6` (rebased onto master `5b2c969`) and web `a5bf3e6f62` (rebased onto `jellyfin-mod` `43d9b9cf79`). By the user's
decision of 2026-09-27 the release ships as **0.1.0.0**, republished once over the build of 2026-09-25. Plugin `7751a24`
reverts the 0.1.0.1 bump. `ea519c2` (with fixup `35c3ab6`, review P2-v and P2-w) lets the image replace an installed 0.1.0.0 with the later build, and the in-place
upgrade is proven below. Every fixture is removed. Nothing is merged or pushed.

Plugin `88d5f6d..0caf039` passed the Codex re-review. Still waiting for Codex:
- the live-scan script fixes (P2-s, P2-t, P3-u, and the tick witness);
- `bfb1df6` (finding 12), the Trakt suite change inside `fce0663`, `7751a24` and `ea519c2`;
- the cleanup fixup and the focus runner.

## Instance

| | |
| --- | --- |
| Instance | Dedicated live acceptance instance on `<live-port>` (compose project `jellyfinmod-live`). This is not the isolated test instance (T18 real window), not the acceptance instance (Trakt, then V1), not the Q16 candidate, and not production. |
| Host | Jellyfin 12.0.0 image pinned by digest, plus the JellyfinMod release package built from the tips below. |
| Configuration | Clone of the acceptance instance's `/config`, metadata included (17 referenced images are missing there too), without JellyfinMod's database, secret file, plugin folder or XML. The plugin started on a fresh database: every migration ran. |
| Libraries | Movies, Movies B (a second movie library on the same mount) and Shows on one writable shared mount. Movies Alt sits on a second bind mount of the same host filesystem, for the cross-filesystem case. No production media is mounted. |
| TMDB | Stand-in over real HTTPS, answering as `api.themoviedb.org` with a test CA. No real TMDB token is on this instance (workspace rule). Catalog titles are stand-in identities, including the public-domain films below. |
| Indexers | The household's real Prowlarr, read-only: its API key is only in the plugin secret store, and only GET requests are made (`ProwlarrSync`). It exposes 7 indexers; only the public tracker 1337x was enabled. A private Torznab feed (stand-in) serves the legal fixtures, plus two fault feeds. |
| Download client | The separate real Transmission 4.0.5 (RPC 17) on its own VPN, shared with the acceptance instance and reached through this instance's own relay container. Stopping the relay simulates "client down" for this instance only. The Transmission container was never stopped or reconfigured. |
| Fixtures | Real 60 s videos (x264 plus AAC) in real v1 torrents. The real Transmission downloads them from a web seed on the same Docker network: no peer, no tracker. |
| Downloads | Public-domain only (user answer, 2026-09-25): *His Girl Friday* (1940), YTS 720p, infohash `7b7fd6f6fc54874cafeafc7aebb94c0d43ab522a`. Everything else is a legal fixture. |
| Revisions | Plugin `348168b`, then `ca8a54b` (scan fix), then `034f039` for the long run. Web `c554c3e312`, then `d17a6e2c43` (UI fixes). The bundle was `6f112530f0aa`, then `b12550036cae`; its `-dirty` marker comes only from the uncommitted runner scripts. Scan-wait and focus runs: plugin `bfb1df6` as 0.1.0.1 (DLL SHA-256 prefix `d1d972818c55`), bundle `30e16f3d5f05` from web `a5bf3e6f62`. Final: plugin `ea519c2` as 0.1.0.0 with the same bundle. |
| Pi memory | MemAvailable 3.7 GB (2026-09-25), 3.3–3.6 GB (2026-09-26 morning), 2.2–2.4 GB after the redeploy. Swap is full throughout. `mem_limit` has no effect on this kernel (there is no memory cgroup); the guard is the 1 GB MemAvailable floor. |

## Checklist results

Tables below are Chromium unless marked. **Real-Chrome re-run, 2026-09-26 (Chrome 153.0.8010.53, bundle `cccb8786e043`, plugin `034f039`):**

| Row (Chrome) | Result | Evidence |
| --- | --- | --- |
| Picker grab by keys, desktop | PASS | Hold, then handoff; one POST despite a second Enter; Back closes. |
| Cancel during the hold | PASS | TV 1080 (focus lands on Search releases on open) and mobile, on an episode. |
| Queue matrix during a throttled download | PASS | Desktop, mobile, TV 1080, TV 720: ring and row agree, the grid never blanks, TV focus holds over 10 polls, and TV row actions work. |
| Stale row, relay stopped | PASS | Desktop and mobile show "Updated 45 s ago" / "Updated 1 min ago" at the last progress (20 %). |
| Finding 2 | PASS | No light buttons in any layout; TV opens on Search releases. Chromium and Chrome. |
| Picker extras | PASS | Late feed gives one partial result with the focused row held 15 s; a profile change re-searches in place and leaves the entry's profile unchanged; with only rejected rows, focus sits on the rejected group. All four layouts, Chromium and Chrome. |
| Playback of the imported public-domain film | PASS | Desktop, mobile, TV 1080 and TV 720 (TV by Enter on the focused Play): media time advances past 3 s, direct play of `stream.mp4`. Real Chrome only: Playwright's Chromium has no H.264 decoder. |
| Security sweep | PASS 14/14 | Real Chrome. |

The Chrome results file keeps two harness false starts, later re-run to PASS:
- **Size rejection:** an 84 MB fixture under a stand-in title with a 1-minute runtime is rejected on size per hour, which is correct. The fixture moved to a 6-minute title.
- **Progress gap:** a web seed without a connection limit downloaded so fast that the card and the row, read seconds apart, differed by 4 points. The web seed is now limited to one connection at 200 kB/s.


### Phase 4 A8

| Row | Result | Evidence |
| --- | --- | --- |
| Settings through real HTTP | PASS | Prowlarr Test ok (7 indexers), sync created 7 (4 verified). Client Test ok. Stale revision gets 409 `revision_conflict`. |
| Picker, real public tracker, desktop | PASS | 7 eligible rows ordered by score (630 down to 210), with the raw title always visible. 9 rejected rows with reasons: size, quality not allowed, title mismatch, unreadable resolution. Focus starts on the first row. One Enter starts the 5 s hold, then "accepted". A second Enter sends no second POST. |
| Real client state | PASS | Exactly one torrent, in the download folder, labelled with the client category and `jfmod-<grab>`. Seed modes are unlimited. The grab is `accepted` with one `grabbed` history event. |
| Cancel during the hold, TV 1080, keys only | PASS | Enter on Cancel gives "Cancelled before anything was sent"; the client is unchanged. Back returns focus to Search releases. |
| Episode grab, mobile | PASS | Fixture S01E01 via the private feed. |
| Idempotency | PASS | Same key and same payload: 200 with the same operation. Same key, other payload: 409 `idempotency_conflict`. |
| Forged or foreign ids | PASS | Forged searchId gives 404 `search_not_found`. Forged releaseId gives 404 `release_not_found`. Another title's episode on a movie gives 400 `episode_not_applicable`. |
| Concurrent grabs of one target | PASS | One 202 hold; the other request gets 409 `grab_active`. |
| Same infohash from two indexers, two libraries | PASS | The first copy is accepted. The second (other feed, other library) gets 409 `duplicate_hash`. The client holds one torrent. |
| Unrelated torrent already in the client | PASS | The grab fails with `client_torrent_exists`; the existing torrent keeps its labels and folder. |
| Restart during the hold | PASS | Result: `failed/interrupted_before_submit`, and nothing reached the client. |
| Interrupt after remote accept, before local commit | NOT VERIFIED live | Needs a kill inside a millisecond window; covered by `PhaseFourIntegration` over real HTTP. |
| Security | PASS 14/14 | `security-sweep.mjs`: anonymous 401 on every route; a disposable passwordless ordinary user gets 403 on admin routes and 200 on Health. No secret-store value or reference appears in any body. Traversal gives 404. |
| Hosted-API faults | PASS | 500 gives `unavailable`. 429 gives `rate_limited` (Retry-After honoured). Repeated failures open the breaker (`breaker_open`, 1 h). Also: `malformed_response`; `auth_failed` for a credential error inside HTTP 200; `redirect_rejected`; `timeout`. The result is partial and the other feeds still answer. |
| Profile change, late result under focus, rejected-only list | PASS | `live-picker-extra.mjs`, four layouts, Chromium and Chrome. |
| Old-plugin fallback | NOT VERIFIED live | No older plugin build can run against this database: the X4 guard refuses newer migrations, so the server reports not ready. The capability-gated path would need a purpose-built build with capabilities removed. A mocked Health response does not count as evidence (workspace rule). |

### Phase 5 I3–I9

| Row | Result | Evidence |
| --- | --- | --- |
| I2 same-mount probe | PASS | `TestImportPath`: Movies, Movies B and Shows `linked`; Movies Alt `not_same_mount`. |
| I3 progress agreement | PASS | The Movies card ring and the queue row agree within one poll in desktop, mobile, TV 1080 and TV 720. The grid never blanks. On TV, the focused row keeps focus over 10 polls and the list node is never replaced. Enter opens the row actions and Back returns focus to the row. |
| I3 client down | PASS | Relay stopped: the row goes `unknown/client_unreachable` and keeps its last progress (58 %) and its observedAt; the UI shows "Updated 1 min ago". When the client returns, the same operation resumes. |
| I3 torrent removed by hand | PASS | `blocked/torrent_missing` with one `import_blocked` event. Re-adding the same torrent resumes the same operation to completion. |
| I4 hardlink | PASS | Link count 2 and the same inode as the download; no second copy. Sidecar images are not imported. |
| I4 cross-filesystem | PASS (stronger) | A grab for the library on the second bind mount is refused before anything is sent: 409 `destination_not_same_filesystem`. The import-time `cross_filesystem` state cannot be reached through the product. |
| I4 failure fixtures | PASS | Two equal videos give `ambiguous_files`. A `.rar` gives `archive_unsupported`. S01E02 carrying an S01E03 file gives `episode_mismatch`. No file is written to the library. |
| I4 kill in `linking` / `scanning` | `linking`: NOT VERIFIED live; `scanning`: PASS after fix | `linking` is too short a window with real files; `PhaseFiveIntegration` covers it. `scanning`: container restarted while scanning. First run: it completed, but only through a full library scan (finding 12). On `bfb1df6` it completed with one import and no library scan. |
| I4 destination collision | NOT VERIFIED live | The importer appends `vN`, so only a race reaches it; covered by the suite. |
| I5 binding | PASS | One native item; entry `onDisk`; one `imported` event; no `media_missing`. |
| I5 targeted scan | FAIL, fixed | Every import ran a full library scan (see finding 1). On `ca8a54b` there is no library scan: the folder refresh bound the import in about 76 s. The scan-wait live E2E below passes on `bfb1df6`. |
| I5 retention baseline | PASS | Any and All users modes give `waiting_for_completion`, with BaselineAt equal to the import time. Get again on a reclaimed title (old played observations present) leads to `retention_reset`, then `waiting`; the next run reclaims nothing. |
| I5 episode | PASS | Only S01E01 is `onDisk`; E02 is missing, E03 and E04 unaired, the special missing. |
| I6 seed goal blocks retention | PASS | Due and watched files show `blocked/seed_goal_unmet` until the indexer's 4-minute goal is met. |
| I6 seed first | PASS | The release removes the torrent and its data. The library file stays with link count 1. One `seeding_released` event: "0 B freed". |
| I6 retention first | PASS | Retention reclaims the library link: `physicalBytesReleased 0`, and the seeding copy stays. With seed release on, the release then frees the file: "Freed 14 MB previously reported as 0 B". |
| I6 unowned torrent | PASS | A torrent re-added by hand without the plugin's labels is never removed (`torrent_not_owned`). |
| I6 release disabled | PASS | The queue shows `seed_release_disabled` with the goal already met; nothing is removed. |
| I7 Remove | PASS | Without `removeFromClient` the row goes and the torrent stays. With it, the torrent and its data go and the library is untouched. With `blocklist`, a fresh search rejects that release as `blocklisted`. |
| I7 access | PASS | Ordinary user: 403 `queue_admin_only` on the queue, 403 on Remove, Retry and Seeding. With queue visibility on, that user sees rows without the admin block; a user without library access sees none and gets a 404 on `GET /Imports/{id}` identical to an unknown id. |
| I7 polling cost | PASS | Two sessions polling every 3 s made 12 queue requests in 30 s and caused 9 client reads (including monitor ticks): at most one per 3 s freshness window, not one per request. |
| I8 browser matrix | PASS | See the Chrome table: queue, stale row, TV focus and actions; the ordinary user sees no queue (security sweep). The old-plugin case is NOT VERIFIED (see A8). |
| I5/I9 playback | PASS (Chrome) | Imported file plays in desktop, mobile, TV 1080 and TV 720. |
| I9 regressions (Phase 2 suites, T18 cycle) | partly | `PhaseFiveIntegration` and `PhaseSixIntegration` exit 0 on `ca8a54b` and again on the rebased `034f039` (2026-09-26). The other suites and the T18 cycle belong to the retention agent's instance. |

#### Scan wait, live E2E (`standins/live-scan.py`, 2026-09-27 13:36–14:36 Sydney, plugin `bfb1df6`)

Each case grabs legal 12 s fixtures (2.8 MB, above the profile's 150 MB/h floor) through the real API. The real Transmission
downloads them from the web seed. Each import is followed by id. "No full scan" means no "Validating media library"
line in the host log since the case began.

| Case | Result | Evidence |
| --- | --- | --- |
| ordinary | PASS | Completed and bound to the target's native item; one `imported` event; no full scan. |
| overlapping | PASS | B linked while A was still scanning, in the same season folder; both completed; no full scan. |
| delay (monitor delay 120 s) | PASS | Bound 135 s after the scan request; no full scan. |
| restart in `scanning` | PASS on `bfb1df6` | Before the fix it completed through a full library scan (finding 12). |
| cancel in `scanning` | PASS | Remove answers 200 `cancelled`; no `imported` event; no full scan. |
| cancel-later | PASS | Delay 60 s and poll 2 s, both restored. B reported 53 s after A and was cancelled (response and fresh read both `cancelled`) while A was still unbound. The plugin's own line for A, "defers its library scan N s after its request", appears at N = 91, 93, 95 … s: A's evaluation found it unbound past its 90 s first wait and held the scan back. No full scan. (Re-run 2026-09-27 17:55 on plugin `2d068f9`.) |
| series-siblings | PASS | Shows' real-time monitoring switched on for this case only (restart before and after; restored off). Two new series folders under one root; B reported 54 s after A. A's deferral line appears at N = 90, 92, 94 … s; no full scan. (Re-run 17:58 on `2d068f9`.) |
| related-stream | PASS | Sibling imports every 30 s in A's season folder; report gaps 24–33 s (< 60 s). A escalated 272 s after its request (cap 270 s), the last report 27 s before; one library scan; A and 8 stream imports completed, 1 was still pending at the escalation. |
| unrelated reports | suite only | Live, A cannot stay unbound past its first wait while unrelated reports continue, because the host's own refresh binds it. `PhaseFiveIntegration` proves it with the host's scan held back. |

Earlier runs used weaker witnesses:
- A probe import's `updatedAt` failed as a witness, a harness fault: it does not change on progress.
- The monitor's tick lines passed, but review P2-x showed that a tick could evaluate A before the deadline and log
  after it.

Review P2-x added a debug line to the plugin (`2d068f9`). It is written only by A's own evaluation, after the binding was
looked for and not found. `PhaseFiveIntegration` asserts the line for a sibling deferral and its absence for an unrelated
escalation.

The timing setup rolls back when it fails part-way (review P2-y). Live, `Timing(45, 0)` changed the delay, got 400 on the
poll, and restored the delay to 60 before the error propagated.

#### Focus re-checks (`live-focus.mjs`, bundle `30e16f3d5f05`)

Chromium 153.0.8010.12 and Chrome 153.0.8010.53 each give **20/20 PASS** across desktop, mobile, TV 1080 and TV 720
(`chromium-2026-09-27-focus-results.json`, `chrome-2026-09-27-focus-results.json`):
- no light mod buttons;
- flat buttons carry `show-focus` on TV only;
- TV opens on Search releases;
- a key pressed while the entry loads (request held back 4 s) keeps the page from moving focus afterwards;
- a header control focused when the page opens keeps focus;
- on desktop, the focus ring shows under keyboard focus and not after a mouse click;
- no page errors.

#### In-place upgrade from the first 0.1.0.0 (2026-09-27, disposable container)

The container ran on its own loopback port, with a copy of this instance's configuration: users and libraries only. The
copy left out metadata, the plugin database, its secrets, its XML and its folder. It was removed afterwards. Each phase is
one start with the named image:

| Phase | Entrypoint log | Plugin | Migrations (last) | Health | Bundle |
| --- | --- | --- | --- | --- | --- |
| A. Friday's image (`capische/jellyfin-mod:0.1.0.0`), fresh | installed 0.1.0.0 | build 2026-09-25 | `PhaseSevenProwlarr` | 0.1.0.0, Ok, no `trakt.history` | `21c0905b4568` |
| B. New image, entrypoint before `ea519c2` | "is installed; … does not replace it" | still 2026-09-25 | unchanged | unchanged | unchanged |
| C. New image, `ea519c2` | "replaced JellyfinMod 0.1.0.0 build 2026-09-25T06:09:17 with build 2026-09-27T05:11:47" | 2026-09-27 | `PhaseSevenTraktObservations`, `PhaseFiveScanAnchor` (table and column present) | 0.1.0.0, Ok, `trakt.history`, Trakt `{Installed: false}` | `30e16f3d5f05` (also served at `/web/`) |
| D. New image again | "same build … does not replace it" | 2026-09-27 | unchanged | unchanged | unchanged |
| E. Friday's image again | "does not replace it" | 2026-09-27 kept | unchanged | unchanged | unchanged |

Re-run 18:02 on the final entrypoint (`35c3ab6`, image built from plugin `2d068f9`):
- A as above.
- C: "replaced JellyfinMod 0.1.0.0 build 2026-09-25T06:09:17Z with build 2026-09-27T07:51:58Z". Both migrations
  applied; Health 0.1.0.0, Ok, `trakt.history`; bundle `30e16f3d5f05`, served at `/web/`.
- D: "does not replace it: JellyfinMod_0.1.0.0 holds the same build or a later one".

No `ERR` or `FTL` line in any phase. Phase B is the defect `ea519c2` fixes: without it, a volume that ran the first
0.1.0.0 would never load the republished build. `tests/image/entrypoint-install.sh` passes 12 cases, including an offset timestamp, an unreadable one
and several same-version folders (review P2-v, P2-w). It fails on the old entrypoint. `entrypoint-rewrite.sh` still passes.

Not covered: a server that installed the plugin from a repository, not from the image. Jellyfin offers no update for the
same version, so such a server keeps the first build until the plugin is reinstalled by hand.

Second versions of a title (PHASE5 checklist 6, I9 case 3) are deferred to V1: the second-version import defect of
2026-09-20.

### Phase 6 M2–M9 (long run, 2026-09-26 14:26 to 2026-09-27 13:00 Sydney)

**Builds.** Plugin `034f039` (DLL SHA-256 prefix `73f2696df218`) for the whole run. The web bundle was `cccb8786e043`
until the restart at 15:40 Saturday, then `f0de1bd98fcf`. That swap carried the web review fixes only; the automation rows
are server-side.

**Setup.**
- 1-hour interval, batch 10, 3 automatic grabs a day, 5 open imports, floor 1 % or 25 GB.
- Real 1337x through Prowlarr for searches, with title-match automation off, so it can never auto-grab.
- Stand-in feed B with title matches flagged, feed C unflagged.

**Times.** All times in these tables are Sydney.

| Row | Result | Evidence |
| --- | --- | --- |
| M1 free space | PASS | Automation reported 266,491,887,616 bytes free, identical to `df` for the same filesystem. |
| M2 settings | PASS | Every automation field was saved and re-read identically across a container restart. Routes: anonymous 401, ordinary user 403 (security sweep 14/14). |
| M3 scheduled runs | PASS | 23 scheduled hourly runs completed between Saturday 15:27 and Sunday 12:54, with no failure and no duplicates. The native task drove them. |
| Auto-grab and import | PASS | Run 1 grabbed three fixtures (budget 3) and all imported. |
| Title-match rule | PASS | Feed B (flagged): the title-only release was auto-grabbed. Feed C (unflagged): the identical case was not (`no_eligible_candidate`). On real 1337x, title-only rows for a public-domain title were never grabbed. |
| Budget | PASS | `budget_grabs` was recorded for the fourth eligible target, and for every due target in each run until the UTC day turned. |
| Back-off | PASS | An aired episode with no release was searched, found `no_eligible_candidate`, and deferred 12 hours. |
| Specials and unaired | PASS | The special was never searched (`special_excluded`); an unaired episode was reported `unaired`. |
| Query counts | PASS | Per-indexer query counts in the run summary (20, 25, 25) equal the stand-in feeds' own counters. |
| M4 new episode | PASS | Aired Sunday 10:00 with its release already published; delay 120 minutes. The 10:52 and 11:53 runs did not search it; the 12:54 run grabbed it. The run's daily metadata refresh had picked up its new air date. |
| Restart | PASS | Restart between runs 1 and 2: no duplicate grab or import; the client holds each automatic grab once. |
| Safeguard: free-space floor | PASS | Floor set above free space: status and queue report `free_space_floor`, no grab, and the decision states the bytes. Chrome banner on desktop and TV 1080: "Automation paused: Free space in the library is below the configured floor." |
| Safeguard: client unreachable | PASS | Relay stopped: the run ends `paused` with detail `client_unreachable` and grabs nothing. The Chrome queue banner reads "The download client cannot be reached." |
| Safeguard: breaker | PASS | Feed C answering 500: a `breaker_opened` decision ("failed five times in a row and is paused for an hour"), `breakerOpenUntil` is set, and the other feeds keep answering. |
| Safeguard: automation off mid-run | PASS | 6 due targets; switched off 3 s into the run. The run searched one target and ended "Automation was turned off during the run."; the queue shows `disabled`. |
| M9.5 | PASS | `intent=addVersion` for a file-less title gives 409 `no_playable_version`. |
| Cleanup | PASS | Automation off, the budget restored, then `live-cleanup.py`. Result: 0 catalog entries, 0 native items and 0 files in the instance's libraries, and 0 torrents of this instance in the client. Only the acceptance instance's two torrents remain. |
| Deferred to V1 | — | Upgrade by added version, Get another quality, per-version reclaim order, the M8 version rows, question 7. |
| M8 browser rows | partly | Queue banners (above). Picker, queue and Movies grid behaviour are in the P4/P5 tables. Version rows are deferred to V1. |

**Missed or late.** A server-side outage stopped this agent's tool calls from Saturday 17:00 to 22:30, and the agent stayed idle
until Sunday 12:40.
- The timed safeguard check-ins (17:35, 18:35, 19:40) and the overnight and 09:00 check-ins did not happen.
- The four safeguards ran instead as manual runs on Sunday between 12:56 and 12:59 (a manual run obeys every budget).
- The unattended hourly runs are fully recorded in the run table.
- The breaker case needed the grab budget raised to 10 for its run: a first attempt spent the day's last grab on a due target.

**Findings from the run.**

| # | Class | Finding | State |
| --- | --- | --- | --- |
| 8 | mod | Blocked as `source_missing` in the second Transmission reported completion, before it had moved the file out of its incomplete folder. | Recovered live by Retry. Fixed in plugin `134f60c` (a 10-minute settling grace), which is under review. |
| 9 | mod, low | Episode releases on a feed without id search match by title only. On an unflagged feed, automation skips them, but the decision gave another row's reason (`blocklisted`). | The known M15 reason gap; not fixed. |
| 10 | mod, low | After the client came back, the queue's automation `pausedReasons` kept `client_unreachable` until the next run, although `clientStatus.reachable` was true. | Not fixed; proposal. |
| 11 | environment | Free space on the shared disk fell by about 37 GB overnight. This instance's fixtures total a few MB. | Recorded. |

## Findings

| # | Class | Finding | State |
| --- | --- | --- | --- |
| 1 | mod, medium | `ImportService` escalated to a full library scan 60 s after the reported change — exactly when the host's own `LibraryMonitorDelay` (60 s) runs the targeted refresh. Every import therefore ran a full scan. | Fixed in plugin `034f039` (rebased onto master `11f0a67`): the wait is now the monitor delay plus 30 s. `PhaseFiveIntegration` asserts it; confirmed live. Awaits Fable review. |
| 2 | mod, low | Mod buttons carrying only `emby-button` rendered the browser's light background with white text, in every layout (Remove entry, History, episode actions, the picker's rejected toggle and Close, More results from TMDB). Stock always pairs `emby-button` with `button-flat` or `raised`. Also, on TV the file-less detail page opened with focus on `<body>`, where the stock detail page focuses Play. | Fixed in web `fedc1f466d`. Live re-check 2026-09-26: no light-background button on desktop or TV (PASS), and TV focus lands on an action. It landed on Keep, because Search releases appears only once the capabilities load. The commit now moves the focus it placed itself to the new first action; that refinement is type-checked and linted, but **not yet deployed or re-checked live**. Awaits Fable review. |
| 3 | upstream data, not a mod bug | A Freeleech chip shows on every public-tracker row: Prowlarr reports `downloadvolumefactor=0` for public trackers, and the chip also adds 10 score points. A fix needs indexer privacy from the Prowlarr sync, which means a migration. | Left as a proposal, not cheap. |
| 4 | harness | On mobile, Back closes the picker but focus is not restored. That is stock behaviour: `dialogHelper` restores focus on TV only. | The runner now asserts the TV-only rule. |
| 5 | docs | API.md gave the path-mapping routes without `/Settings/`. | Fixed in web `e52e3adb44`. |
| 6 | harness (no defect) | The re-grabbed Extra 8 looked released early: about 3 minutes after import, against a 4-minute goal. The goal counts seeding time, which starts when the download completes; import completes about 76 s later, after the scan wait. The second release row shows Transmission's own seeding time at 251 s ≥ the 240 s goal. `goalMetAt` 22:59:56 is 4 min 31 s after the grab was accepted. Each release row is its own (two rows, two grabs); no goal carried over. The settings write at 23:00:04 came after the removal had started at 22:59:56. | Closed: the goal was met; the earlier reading was wrong. |
| 7 | harness | The web build refuses when the local `master` is stale (patch-surface check); build with `JELLYFINMOD_PATCH_BASE=origin/master`. The image entrypoint does not replace a plugin of the same version, so redeploys copy the DLL and bundle into the plugin folder while the container is stopped. | Noted. |

| 12 | mod, low | A container restart while an import was scanning lost the host's pending folder refresh (kept in memory only). The import waited out its first wait and then escalated to a full library scan. | Fixed in plugin `bfb1df6`: a scan request older than this process is repeated once, without counting an attempt. `PhaseFiveIntegration` covers it; confirmed live. |
| 13 | harness | `PhaseSevenTraktIntegration` asserted that the Q16 migration is the newest applied. Phase 5's new migration `PhaseFiveScanAnchor` (sorted after it) broke that assumption. | The suite now finds the Q16 migration by name (in `fce0663`). |
| 14 | harness | The cleanup's `placeholder.txt` did not stop an emptied root from reading as "inaccessible or empty". The rescan kept 35 orphaned items, and an ordinary placeholder folder became a series. | `live-cleanup.py` now uses an ignored `#recycle` folder; the re-run left 0 entries, items, torrents and files. |
| 15 | environment | This instance's cloned configuration has real-time monitoring off on every library. It also has the OMDb provider on: it named the placeholder folder from OMDb. Review P2-n only matters with real-time monitoring on, so the series-siblings case switches it on for itself. | Recorded. |

## Where it stopped (handover)

- **Instance state (2026-09-27 15:10 Sydney):**
  - 48096 runs plugin 0.1.0.0 from `ea519c2` in `JellyfinMod_0.1.0.0`: Health 0.1.0.0, Ok, bundle `30e16f3d5f05`.
    The earlier plugin folders (the old 0.1.0.0 and 0.1.0.1) are kept outside the config for rollback.
  - Automation, retention, seed release and queue visibility are off.
  - `LibraryMonitorDelay` is 60, the import poll 15 s, and real-time monitoring is off on every library.
  - No catalog entries, native items, library files or torrents of this instance remain; staged scan fixtures and their
    feed releases are withdrawn.
  - The relay, the web seed, the TMDB stand-in and the stand-in process are up.
- **Public-domain downloads:** only *His Girl Friday* (hash above), removed at the M9 cleanup.
- **Paused 2026-09-27 at about 18:35 Sydney (user pause for all agents).** 48096 is safe: automation off, delay 60,
  poll 15, real-time monitoring off everywhere, 0 entries and native items, no scan fixtures, and the catalog is
  restored.
- **Where it stopped:**
  - **Done:**
    - Codex re-review 5 passed the plugin.
    - The web P2-z fix is in and was checked live: a PATCH that applied but whose response was lost, simulated with
      `TimeoutError`, still restored the poll to 15.
    - Both branches are autosquashed, their messages reworded to the final content. The plugin sits on master `5b2c969`
      and the web branch on `jellyfin-mod` `58e1a17486`.
    - Every plugin commit builds, and the web build, type-check and lint pass on the squashed tip.
    - The pre-squash tips are kept as `live-accept-presquash-0927` in both repositories.
  - **Running when paused:** PhaseFive, PhaseSix and PhaseSevenTrakt plus `entrypoint-install.sh` on the squashed plugin
    tip, in the Pi's offline suite container. The container does not touch 48096. Its result lands in the suite build
    directory's `live-logs/squash-summary.txt`.
- **Resumed 2026-09-28 07:40 Sydney (Opus, medium effort, budget fallback):**
  - `squash-summary.txt`: `PhaseFiveIntegration exit=0`, `PhaseSixIntegration exit=0`, `PhaseSevenTraktIntegration exit=0`,
    `PASS: entrypoint plugin install rule (12 cases)`.
  - **Scan scripts, one run on 48096 (07:50–08:30).** `live-scan-setup.py`: 22 fixtures staged, 4 movies and 4 series added.
    The first `live-scan-all.sh` run failed every case at once: `run` passed its log name to `live-scan.py` as the
    case (harness; fixed, `run` now shifts it). No case had grabbed anything. The re-run passed every case in 30 minutes:
    ordinary, overlapping, delay, restart, cancel, cancel-later, related-stream, series-siblings (Shows' real-time
    monitoring switched on and off, 204 each), and `unrelated-stream` refused with exit 2. `live-scan-teardown.sh` then
    printed all zeros, 0 scan releases, the catalog restored and delay 60, poll 15, real-time off everywhere; exit 0.
  - **Release image from the squashed tips.** Web `7bf3356f42` built on the workstation, bundle `76d08b85c7eb`. Plugin
    `8d3c6c0` built in the Pi's offline SDK container and packaged by `build-release.sh --no-build`. The result is
    `jellyfinmod-upgrade:candidate` (id `e58aad6d04f3`, plugin build `2026-09-27T22:30:18Z`).
  - **`live-upgrade.sh` (new), one run: `PASS: in-place upgrade (21 checks)`, exit 0.** Start 1 (Friday's
    `606ca92eb2dd`): installed, build `2026-09-25T06:09:17Z`, bundle `21c0905b4568`, neither new migration. Start 2:
    "replaced JellyfinMod 0.1.0.0 build 2026-09-25T06:09:17Z with build 2026-09-27T22:30:18Z", both migrations, Health
    0.1.0.0 Ok, bundle `76d08b85c7eb` served at `/web/`. Start 3: "does not replace it", build kept. No `[ERR]`/`[FTL]`
    line; the container, the config copy and the port are gone afterwards. The script's first run failed 4 of its own
    checks, all harness: Jellyfin rewrites `meta.json` timestamps with seven fractional digits, and `/web/` names its
    bundle in `<meta name="jellyfinmod-web">`, not in a served `jellyfinmod-web.json`.
  - `live-state.sh` (new) prints the instance's state read-only, for rows C2, C5 and C12 below.
  - **Not done:** deploying the candidate to 48096. This agent's permission to change the running instance was refused,
    so 48096 still runs image `6beb926ae2a8` with the plugin build `2026-09-27T07:51:58Z` and bundle `30e16f3d5f05`. Row
    C5 does the deploy once the coordinator allows it.
- **Next:** the coordinator reports the tips. The Sonnet verifier runs the checklist below, then the merge follows on the
  coordinator's go-ahead.

### Final re-run checklist (Sonnet, high effort, on 48096 only)

Pass means every row's output matches its **Expect** exactly, where `…` stands for any text. On the first mismatch,
stop, run C11 and C12 so nothing is left behind, and report the row id and its output verbatim. Do not diagnose, retry
with changes or relax a row.

**Rules.**
- Only 48096 (compose project `jellyfinmod-live`) and the disposable `jellyfinmod-upgrade` on port 58096.
- Never touch 8096, 18096 or 28096, never stop or restart `transmission-acceptance`, and never touch 28096's two torrents.
- Never print the env file, credentials or a process environment: no `pgrep -fl`, no `ps e`, no `env`.
- Wait by wall clock only: `T=$(( $(date +%s) + <seconds> )); until [ "$(date +%s)" -ge "$T" ]; do sleep 30; done`.

**Placeholders.**
- `<LIVE_ENV>`: the ignored 0600 env file the coordinator names, outside the repository. It exports `JFMOD_SSH`,
  `JFMOD_LIVE_ROOT`, `JFMOD_LIVE_SHARED`, `JFMOD_LIVE_BUILD`, `JELLYFINMOD_LIVE_URL`, `JELLYFINMOD_LIVE_FIXTURE_FILE` and
  `JELLYFINMOD_LIVE_SSH`.
- `<WEB>` and `<PLUGIN>`: the two worktrees.
- `<OUT>`: a scratch folder for results.

**Where commands run.** Every workstation command runs in one shell after C0. Host commands run through
`H <<'EOF' … EOF`: the test host's login shell is fish, and `H` hands the block to bash with `$1` = state root,
`$2` = suite build directory and `$3` = shared folder.

**Reference build.** Every row uses the image built on 2026-09-28:
- `jellyfinmod-upgrade:candidate`, id `e58aad6d04f3`;
- plugin `8d3c6c0`, build `2026-09-27T22:30:18Z`;
- web `7bf3356f42`, bundle `76d08b85c7eb`.

Web commits after `7bf3356f42` change only harness and docs. If the coordinator names a different plugin tip or a web
tip that changes `src/`, stop and report; the image must be rebuilt first.

**C0. Setup (workstation).**
```sh
set -a; . <LIVE_ENV>; set +a
H() { ssh "$JFMOD_SSH" bash -s -- "$JFMOD_LIVE_ROOT" "$JFMOD_LIVE_BUILD" "$JFMOD_LIVE_SHARED"; }
git -C <PLUGIN> rev-parse --short HEAD
git -C <WEB> diff --stat 7bf3356f42 HEAD -- src | wc -l
(cd <WEB>/scripts/jellyfinmod-e2e/standins && rsync -a live-scan-setup.py live-scan-all.sh live-scan-teardown.sh live-upgrade.sh live-state.sh "$JFMOD_SSH:$JFMOD_LIVE_ROOT/standins/bin/")
H <<'EOF'
awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo
EOF
```
Expect:
- `8d3c6c0`
- `0`
- the rsync prints nothing
- a number ≥ `1229`, the 1.2 GB floor. Repeat this memory line before C3, C4, C5 and C8.

**C1. Suites on the squashed plugin tip (already run).**
```sh
H <<'EOF'
cat "$2/live-logs/squash-summary.txt"
EOF
```
Expect these lines:
- `PhaseFiveIntegration exit=0`
- `PhaseSixIntegration exit=0`
- `PhaseSevenTraktIntegration exit=0`
- `PASS: entrypoint plugin install rule (12 cases)`
- `squash-done`

**C2. Baseline state.**
```sh
H <<'EOF'
"$1/standins/bin/live-state.sh"
EOF
```
Expect:
- `health 0.1.0.0 True bundle …`
- `automation enabled False`
- `JellyfinMod items 0 entries 0`
- `timing LibraryMonitorDelay 60 importPollSeconds 15 real-time on none`
- `migration 20260925104923_PhaseSevenTraktObservations`
- `migration 20260927031241_PhaseFiveScanAnchor`
- `plugin folder JellyfinMod_0.1.0.0`, as the only `plugin folder` line
- `leftovers upgrade container 0 upgrade copy 0 scan fixtures 0 catalog backup 0`
- `started transmission-acceptance …` and `started jellyfinmod-acceptance …`. Note both times; C12 compares them.

**C3. The candidate image and the entrypoint tests.**
```sh
H <<'EOF'
docker image inspect jellyfinmod-upgrade:candidate --format '{{.Id}}' | cut -c8-19
docker run --rm --entrypoint cat jellyfinmod-upgrade:candidate /opt/jellyfinmod/plugin/meta.json | grep -o '"timestamp": "[^"]*"'
cd "$2/upg-src" && bash tests/image/entrypoint-install.sh jellyfinmod-upgrade:candidate 2>&1 | tail -1
bash tests/image/entrypoint-rewrite.sh jellyfinmod-upgrade:candidate 2>&1 | tail -1
EOF
```
Expect:
- `e58aad6d04f3`
- `"timestamp": "2026-09-27T22:30:18Z"`
- `PASS: entrypoint plugin install rule (12 cases)`
- `PASS: entrypoint system.xml rewrite (normal, full volume, read-only, one-start backup)`

**C4. In-place upgrade from the first 0.1.0.0 (disposable, about 5 minutes).**
```sh
H <<'EOF'
ss -ltnH 'sport = :58096' | wc -l
cd "$1/standins/bin" && ./live-upgrade.sh jellyfinmod-upgrade:candidate; echo "exit=$?"
EOF
```
Expect:
- `0`, the port is free
- `old image build 2026-09-25T06:09:17Z; new image build 2026-09-27T22:30:18Z`
- 21 lines starting `PASS:`, no line starting `FAIL:`. Among them:
  - `PASS: start 1 logs: installed JellyfinMod 0.1.0.0`
  - `PASS: start 2 logs: replaced JellyfinMod 0.1.0.0 build … with build …`, followed by
    `replaced JellyfinMod 0.1.0.0 build 2026-09-25T06:09:17Z with build 2026-09-27T22:30:18Z`
  - `PASS: start 2 applied PhaseSevenTraktObservations`
  - `PASS: start 2 applied PhaseFiveScanAnchor`
  - `PASS: start 2 Health 0.1.0.0, Ok (got 0.1.0.0 True)`
  - `PASS: start 2 /web/ serves the Health bundle (served 76d08b85c7eb)`
  - `PASS: start 3 logs: does not replace it`
  - `PASS: start 3 plugin folder keeps the new build (2026-09-27T22:30:18Z)`
  - `PASS: no jellyfinmod-upgrade container remains`
  - `PASS: the config copy is removed`
  - `PASS: port 58096 is free again`
- `PASS: in-place upgrade (21 checks)`
- `exit=0`

**C5. Deploy the candidate to 48096. Only when the coordinator's brief allows it; otherwise report C5 as "not run".**
```sh
H <<'EOF'
since=$(date -u +%Y-%m-%dT%H:%M:%SZ)
docker tag jellyfinmod-upgrade:candidate jellyfinmod-live:current
docker compose -p jellyfinmod-live -f "$1/compose.yml" up -d jellyfin 2>&1 | tail -1
T=$(( $(date +%s) + 300 )); until [ "$(curl -s -m 5 http://127.0.0.1:48096/health)" = Healthy ] || [ "$(date +%s)" -ge "$T" ]; do sleep 5; done
curl -s http://127.0.0.1:48096/health; echo
docker logs --since "$since" jellyfinmod-live 2>&1 | grep -oE 'replaced JellyfinMod .*|does not replace it.*' | head -1
docker logs --since "$since" jellyfinmod-live 2>&1 | grep -cE '\[(ERR|FTL)\]'
"$1/standins/bin/live-state.sh" | head -1
EOF
```
Expect:
- `… jellyfinmod-live …` (compose recreated the container)
- `Healthy`
- `replaced JellyfinMod 0.1.0.0 build 2026-09-27T07:51:58Z with build 2026-09-27T22:30:18Z`. On a second deploy of the
  same image, a line starting `does not replace it` instead.
- `0`
- `health 0.1.0.0 True bundle 76d08b85c7eb`

The host scripts and the browser runner sign in again by themselves after this restart.

**C6. Scan setup (about 2 minutes).**
```sh
H <<'EOF'
cd "$1/standins/bin" && ./live-scan-setup.py; echo "exit=$?"
EOF
```
Expect:
- `staged 22 fixtures`
- `added 4 movies and 4 series; ids in standins/state/scan-ids.json`
- `exit=0`

**C7. Focus re-checks, Chromium then real Chrome (workstation, about 4 minutes each).** The entry is the scan movie
700020, which is still file-less at this point.
```sh
export JELLYFINMOD_LIVE_ENTRY=$(ssh "$JFMOD_SSH" cat "$JFMOD_LIVE_ROOT/standins/state/scan-ids.json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["700020"])')
cd <WEB>
for b in chromium chrome; do
  rm -f <OUT>/focus-$b.json
  JELLYFINMOD_BROWSER=$b JELLYFINMOD_LIVE_OUT=<OUT>/focus-$b.json node scripts/jellyfinmod-e2e/live-focus.mjs > <OUT>/focus-$b.log 2>&1; echo "$b exit=$?"
  python3 -c 'import json,sys,collections; r=[x["verdict"] for run in json.load(open(sys.argv[1]))["runs"] for x in run["results"]]; print(sys.argv[2], len(r), dict(collections.Counter(r)))' <OUT>/focus-$b.json $b
done
```
Expect:
- `chromium exit=…`, then `chromium 20 {'PASS': 20}`
- `chrome exit=…`, then `chrome 20 {'PASS': 20}`

Chromium must pass before Chrome counts. The `exit=` values are informational; the counts decide.

**C8. Scan cases (about 30 minutes; allow 60).**
```sh
H <<'EOF'
cd "$1/standins/bin" && nohup ./live-scan-all.sh > ../state/scan-all.out 2>&1 < /dev/null & echo started
EOF
```
Then repeat a 10-minute wall-clock wait and
`H <<'EOF'` / `cat "$1/standins/state/scan-all.out"` / `EOF` until the last line is `ALL SCAN CASES PASSED` or
`SOME SCAN CASES FAILED`.

Expect exactly these lines:
```
ordinary exit=0
overlapping exit=0
delay exit=0
restart exit=0
cancel exit=0
cancel-later exit=0
related-stream exit=0
Shows real-time monitoring on -> 204
series-siblings exit=0
Shows real-time monitoring off -> 204
unknown-case exit=2 (unknown case 'unrelated-stream'; one of:)
ALL SCAN CASES PASSED
```
On a failure, copy the failing case's `$1/standins/state/scan-logs/<case>.log` tail (20 lines) into the report.

**C9. Scan teardown.** It runs even after a failure in C6–C8.
```sh
H <<'EOF'
cd "$1/standins/bin" && ./live-scan-teardown.sh "$3"; echo "exit=$?"
EOF
```
Expect:
- `After cleanup: catalog entries 0 native movies/series/episodes 0 torrents of this instance 0 files 0`
- `scan releases left on the feed: 0`
- `catalog restored: yes`
- `LibraryMonitorDelay 60 importPollSeconds 15 real-time [('Shows', False), ('Movies', False), ('Movies Alt', False), ('Movies B', False)]`
- `exit=0`

**C10. Workstation hygiene.**
```sh
git -C <WEB> status --short
git -C <PLUGIN> status --short
```
Expect: no line other than `?? scripts/jellyfinmod-e2e/standins/__pycache__/`. No results file, env file or log is
inside either repository.

**C11. Cleanup after a failure (only if a row failed).**
- Run C9.
- Then run
  `H <<'EOF'` / `docker rm -f jellyfinmod-upgrade 2>/dev/null; rm -rf "$1/upgrade-scratch"; echo done` / `EOF`.
- Expect `done`.

**C12. Final state, proven.**
```sh
H <<'EOF'
"$1/standins/bin/live-state.sh"
curl -s http://127.0.0.1:48096/health; echo
EOF
```
Expect:
- The C2 lines, except the bundle: `76d08b85c7eb` if C5 ran, otherwise C2's.
- `leftovers upgrade container 0 upgrade copy 0 scan fixtures 0 catalog backup 0`.
- Both `started` times identical to C2's, which proves the shared Transmission and 28096 were not restarted.
- `Healthy`.

**Runner.**
- Browser runners: `scripts/jellyfinmod-e2e/live-*.mjs`.
- Host helpers: `standins/live-*.{sh,py}`.
- Host paths come only from `<LIVE_ENV>`. The helpers on the host resolve their state directory from their own location.
