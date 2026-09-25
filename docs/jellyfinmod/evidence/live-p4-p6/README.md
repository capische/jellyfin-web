# Live acceptance of Phases 4, 5 and 6 — evidence and handover

Brief: `live-acceptance-p4-p6` (workspace `.claude/briefs/`). Agent: Opus 5.5, high effort. Times are UTC in the tables;
Sydney is UTC+10. Services are named by role only. No address, host path or credential appears here.

**Status: paused at the coordinator's request (2026-09-26, about 09:00 Sydney).** Nothing is merged or pushed. The fixes
below wait for one Fable high review. The rows marked *not yet run* and the real-Chrome re-run are still to do, and so is
the Phase 6 long run.

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
| Revisions | Plugin `348168b`, then `ca8a54b` (scan fix). Web `c554c3e312`, then `d17a6e2c43` (UI fixes). The bundle was `6f112530f0aa`, then `b12550036cae`; its `-dirty` marker comes only from the uncommitted runner scripts. |
| Pi memory | MemAvailable 3.7 GB (2026-09-25), 3.3–3.6 GB (2026-09-26 morning), 2.2–2.4 GB after the redeploy. Swap is full throughout. `mem_limit` has no effect on this kernel (there is no memory cgroup); the guard is the 1 GB MemAvailable floor. |

## Checklist results (Chromium; the real-Chrome re-run has not been done)

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
| Old-plugin fallback, profile change, late result under focus | not yet run | |

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
| I4 kill in `linking` / `scanning` | NOT VERIFIED live | The window is too short with real files; covered by `PhaseFiveIntegration`. |
| I4 destination collision | NOT VERIFIED live | The importer appends `vN`, so only a race reaches it; covered by the suite. |
| I5 binding | PASS | One native item; entry `onDisk`; one `imported` event; no `media_missing`. |
| I5 targeted scan | FAIL, fixed | Every import ran a full library scan (see finding 1). On `ca8a54b` there is no library scan: the folder refresh bound the import in about 76 s. |
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
| I8 browser matrix beyond the above; playback in three layouts; old-plugin degradation | not yet run | |
| I9 regressions (Phase 2 suites, T18 cycle) | partly | `PhaseFiveIntegration` and `PhaseSixIntegration` exit 0 on `ca8a54b`. The other suites and the T18 cycle belong to the retention agent's instance. |

Second versions of a title (PHASE5 checklist 6, I9 case 3) are deferred to V1: the second-version import defect of
2026-09-20.

### Phase 6 M2–M9

Not started. The 24-hour run waits for the rows above and the Chrome re-run.

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

## Where it stopped (handover)

- **Instance state:**
  - Automation, retention, seed release and queue visibility are off, and the retention test window is 0.
  - Seed floors are back at ratio 1.0 / 168 h.
  - The private feed indexer keeps `minimumSeedMinutes 4`; 1337x is disabled.
  - No grab is in its hold.
  - The relay, the web seed, the TMDB stand-in and the stand-in process are up.
- **Client:** these legal-fixture torrents remain: the ambiguous fixture (removed from the queue without `removeFromClient`), Live Series S01E01 (re-added by hand) and the fixture movie. They are removed at cleanup.
- **Paused again:** 2026-09-26 at about 11:45 Sydney, at the stop rule (5-hour window at 90–95%). 48096 is up, idle and safe (as above). Plugin branch `live-accept` is rebased onto master `11f0a67` as `034f039`. The deployed plugin is still the pre-rebase build, which has the same fix.
- **Next, in order:**
  1. Rebuild the bundle from `fedc1f466d`, deploy it to 48096, and re-check TV focus on Search releases.
  2. Suites `PhaseFiveIntegration` and `PhaseSixIntegration` on the rebased plugin `034f039`.
  3. The remaining A8 and I8 rows: old-plugin fallback, profile change, late result under focus, playback in three layouts.
  4. The Chrome re-run of every browser row.
  5. One Fable high review of `ca8a54b`, `50fa26f6cb`, `d17a6e2c43` and finding 6's fix, if any.
  6. The M2–M9 long run.
- **Cleanup at the end:**
  - Remove every `JellyfinMod` fixture entry, library file and torrent.
  - Remove the His Girl Friday media and torrent (its torrent is already released).
  - Leave automation off.
  - Report each public-domain hash.
- **Runner:** `scripts/jellyfinmod-e2e/live-*.mjs` (browser) and `standins/live-*.{sh,py}` (host). Host paths come from an ignored local env file (`JFMOD_LIVE_*`); the helpers on the host resolve their state directory from their own location.
