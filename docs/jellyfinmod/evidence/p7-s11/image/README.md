# P7.S11 — fresh install and image shape, on disposable image containers

## Final image — 2026-09-25

Opus 5.5, high effort. **`capische/jellyfinmod:0.1.0.0` (`d804cc8ecfcc`)**: plugin `p7-s11` `d6fdc88`, bundle
`aa4774e84dbf` (web `caad4989bc`), Jellyfin 12.0.0. Same isolation, stand-ins and secret handling as below. Container 1
(fresh config) was driven on **Google Chrome 153.0.8010.53** ([`chrome-final-image.json`](chrome-final-image.json),
every run in order, including the harness iterations named below); container 2 (fresh config) on **Playwright's
Chromium 153.0.8010.12** ([`chromium-final-image.json`](chromium-final-image.json): 66 of 66 PASS).

### New defect, fixed

**The queue crashed for an administrator as soon as it had a row**: the page showed only
`TypeError: t.toLowerCase is not a function`. The row menu was a React `<button is='paper-icon-button-light'>`, and the
v0 custom-elements polyfill's `createElement` accepts only a string type extension (the same trap `EmbySelect`
documents). Present since P5.I8. Fixed in web **`96a1b360c5`** (the button drops `is`; the class keeps the look).
Verified by building the bundle (`da4830dfc066`, from the working tree before the commit) and swapping it into the
disposable container's plugin folder: the queue renders with two rows, the row menu opens, "Automation is off." and
"Automation paused: Free space in the library is below the configured floor." show. **The final image still carries
the defect**; a rebuilt image is needed to ship the fix (not built here: the brief was to leave `0.1.0.0` as it is).

### Step 1 — fresh install and wizard (Chrome, then Chromium)

| Check | Chrome | Chromium |
| --- | --- | --- |
| Fresh start: plugin installed, 22 migrations, patched automatically (`automatic`, stock `a1308635…`), repository once | PASS | PASS |
| First-run wizard in the browser, sign-in in the shell, Health, Plugins page without repository error, settings area | PASS | first-run PASS |
| Home banner; Dismiss hides it and the wizard stays reachable | banner PASS (Dismiss not on this container) | PASS |
| 409 `acquisition_not_ready` shown verbatim; Discovery wrong token `unauthorized`, Replace/Keep/Clear/Undo, right token `ok` | PASS | PASS |
| **New client with the username left blank: saved (201, `username: ''`)**, Test `ok` against a Transmission with authentication off | PASS | PASS |
| **D1**: saving the first client selects it; step 2 completes without a detour | PASS | PASS |
| Refusals: `destination_inside_library`, `/dev/shm` → `destination_not_same_filesystem`, unverified mapping, empty profile `invalid_qualities`, cutoff outside the allowed qualities `invalid_cutoff` | PASS | PASS |
| **D2**: Test import path and Prowlarr Sync outcomes shown and kept | PASS | PASS |
| Resume in a new browser session at Indexers; Prowlarr wrong key / right key / Sync | PASS | PASS |
| Grabbing on, setup complete, banner gone; import switched on in the area | PASS | PASS |
| **D3**: a new indexer saves with its defaults | PASS | PASS |
| **D4**: a saved secret returns to Configured | PASS | PASS |
| **Validation error names its field**: priority left empty → "priority: The JSON value could not be converted to System.Int32." (also a floor of 100 % → "FreeSpaceFloorPercent: … between 0 and 90") | PASS | PASS |
| Tests from the page: Transmission with auth on refused without credentials, `ok` with them; wrong password, unreachable, timeout (21 s); indexer wrong key / unreachable / timeout; failing synced feed; Prowlarr wrong key / unreachable / timeout; import-path refusals | PASS | PASS |
| No secret value, reference or `apikey=` in 17 responses | PASS | PASS |
| Mobile 390 px: every settings section opens without horizontal scroll; a secret replaced, saved, Test `ok`, back to Configured | PASS | — |
| Add from TMDB → grab from the picker → stand-in Transmission → **hardlink import (link count 2)** → Jellyfin indexes → plays to the end | PASS | — |
| TV 1920×1080 and 1280×720: shell, arrows on Home, wizard rail by arrows, Enter, Back | PASS | — |

The validation message also carries ASP.NET's generic "request: The request field is required." ahead of the named
field (observation, not fixed).

### Step 2 — T18 item 5 and the Phase 6 checklist (Chrome)

| Check | Result |
| --- | --- |
| **T18 item 5**: watched, window passed, seeding copy at ratio 0 → preview `blocked: seed_goal_unmet`; the native reclaim task leaves the file, run `reclaimed 0, blocked 1` | PASS |
| After the stand-in reports the goal met, the file becomes due once the import monitor has polled; the task reclaims it: media unlinked, folder, `.nfo`, `.srt`, poster kept, download back to link count 1, entry `reclaimed` with one `reclaimed` event, run `completed 1/1/0`; retention back to off / 14 days / All users through the area | PASS |
| P6-1 Health lists `automation` and `versions`; 22 migrations; automation off | PASS |
| P6-2 through the area: profile + 720p, cutoff 1080p, upgrades on (replace); synced indexer 2 s / 60 per day; automation on, 1 h, grab budget 1 | PASS |
| P6-3 run 1 (Run now): one wanted movie auto-grabbed, the second stopped by `budget_grabs`, six titles with no release `no_eligible_candidate`; the feed saw 25 queries and the run reports `queriesByIndexer` 25 | PASS (the first comparison against the title count was a harness mistake) |
| P6-3 the automatic grab is imported (history `auto_grabbed`, `imported`); empty searches back off 12 h | PASS |
| P6-3 new episode after its delay; below-cutoff upgrade replacing the old file only after the new one plays | NOT VERIFIED (no TV stand-in; upgrade not run for time) |
| P6-4 container restart between runs: no duplicate grab or import | PASS |
| P6-5 breaker: five failing searches open it, `breakerOpenUntil` in the status, decision `breaker_opened` | PASS |
| P6-5 breaker in the queue banner | **FAIL (gap)**: `pausedReasons` never includes `breaker_open` (one indexer's breaker is not a pause), so the queue shows nothing, though the checklist asks for a banner |
| P6-5 free-space floor, client down, master switch off (run `disabled`, no indexer query), each visible in the status; queue banners for off and floor (fixed bundle) | PASS |
| P6-6 free space reported = `df` for the same filesystem (byte-exact) | PASS |
| **Found on the way**: the test host's disk is over 90 % full, so the default floor (10 %, at least 25 GB) stopped every grab before anything else; floor set to 1 % through the area. Floor skips retry after 6 h, so the titles needed *Search now* | observation |
| P6-9 anonymous 401 on the automation routes; `intent=addVersion` for a file-less title → 409 `no_playable_version` | PASS; ordinary-user 403 NOT VERIFIED here |
| P6-10 version rows: "1080p H.264 · AAC mono · 19 MB 1080p WEB-DL waiting for seeding DEFAULT + Get another quality" | PASS (desktop only) |
| P6-11 automation off at the end through the area | PASS |

### Step 3 — image shape recheck (Chrome)

Fresh start patched automatically (above). Takeover off with the Interface switch: `index.html` **`cmp`-identical to
the host image's own `index.html`** (`jellyfin/jellyfin@sha256:baba6304…`, `a1308635…cfbe3`), no JellyfinMod file left,
stock in desktop and TV with sign-in to Home and the Dashboard; on again → patched, `patchedBy: setting`. PASS.

### Harness mistakes corrected (not product)

Playing before the import had recorded itself (a watch before binding rightly does not count); waiting for *due* when
the file was correctly *blocked by seeding*; running the reclaim before the import monitor had polled the met goal;
the free-space floor at 100 % (the maximum is 90); the query count compared with the title count; a restart that the
test host's shell did not run (redone); a queue regex looking for "paused" in "Automation is off.".

### Cleanup

Both containers, the TLS terminator, the network, the stand-in process, the state directory with its certificates and
secret files, the fixture credentials and admin password files, the tag `0.1.0.0-s11-candidate` and the local
candidate context were removed; `docker ps -a`, `docker network ls`, `docker volume ls` show nothing of this run and no
port 38096–38119 is listening. `0.1.0.0` (`d804cc8ecfcc`), `-pre-merge` and `-net9` are untouched.

---

## First pass — 2026-09-24 (shipping image before the fixes)

2026-09-24, Opus 5.5, high effort. Disposable containers on the test host, on their own port, with config, cache,
media and downloads under one new directory on one filesystem; never production, never 18096 or 28096, never the
`jellyfinmod-test` or `jellyfinmod-acceptance` volumes, no production media mounted. Everything was removed at the end.

- **Shipping image** `capische/jellyfinmod:0.1.0.0` (`1a2c84397c15`): plugin 0.1.0.0 (plugin `439f727`), bundle
  `9fe379afd867` (web `a279641ebf`), Jellyfin 12.0.0. Container A, driven on Playwright's Chromium 153.0.8010.12.
- **Candidate image** `capische/jellyfinmod:0.1.0.0-s11-candidate` (`0434fcf64b29`): the same plus the three fixes
  below — plugin `73f49de`, bundle `444a5cca7c94` (web `4ac638535c`). Container B, fresh config, driven on Google
  Chrome 153.0.8010.53. Container C: the shipping image, fresh config, `JELLYFINMOD_UI_TAKEOVER=false`.
- **Stand-ins** (`scripts/jellyfinmod-e2e/standins/`), real HTTP on a private Docker network: TMDB behind a TLS
  terminator that answers as `api.themoviedb.org` (the container got `--add-host` and a CA bundle through
  `SSL_CERT_FILE`; no product hook), Prowlarr with its per-indexer Torznab feed serving real `.torrent` files of
  generated videos, Transmission RPC (Basic auth, 409 session handshake) that "completes" by copying the real file,
  and a tarpit for timeouts. Fixture credentials were generated, kept in `0600` files and deleted.
- The throwaway administrator was created in the browser by the first-run wizard with a generated password kept only
  in a `0600` file, deleted with the containers.

Result files: [`chromium-shipping-image.json`](chromium-shipping-image.json) (container A, every run in order,
including the harness iterations described below) and [`chrome-candidate-image.json`](chrome-candidate-image.json)
(container B). Both are scrubbed: no address, path, token, password or key.

## Product defects found, and what was changed

| # | Defect (shipping image) | Evidence | Fix |
| --- | --- | --- | --- |
| D1 | **The wizard cannot leave step 2 on a fresh install.** `Setup/State` needs a *selected* download client; the only selector is the Grabbing step (step 5), which step 2 unlocks. Continue stays refused with "No download client is selected." | A: *Saving the first download client selects it* FAIL, reasons `no_download_client`; workaround through step 5 PASS | Plugin `73f49de`: creating a client selects it when none is selected (an existing selection is never changed). B: PASS in Chrome |
| D2 | **Test import path and Prowlarr Sync results vanish.** `run()` cleared the notice after the reload, so the result flashed (or never rendered). | A: page sampled every 20 ms — shown then `(cleared)`, or never shown; server answers were right | Web `82ae4cfba8`: the work returns its notice and `run()` shows it after the reload. B: shown and kept, PASS |
| D3 | **Add an indexer fails as the dialog opens** with a model-binding 400 ("One or more validation errors occurred"): the draft sends `automateTitleMatches: null`. | A: FAIL; reproduced by API (400 on `null`, 201 on `false`); workaround toggling the switch | Web `4ac638535c`: the fallback draft carries `false`. B: PASS |
| D4 | A secret field stays in its empty "New …" input after a successful save. | A: FAIL `stillEditing: true` | Web `4ac638535c`: sections key the field by revision. B: PASS |

TypeScript passes; the feature ESLint finding count in the two changed files is unchanged (80 before, 80 after).
The candidate bundle was built with `JELLYFINMOD_PATCH_BASE=origin/master` (the local `master` ref was stale).

## Step 1 — fresh install (container A unless marked)

| Check | Result |
| --- | --- |
| Fresh container: plugin installed, 22 migrations, repository registered once after the first-start pass | PASS |
| `/web` patched with no administrator step: stock `a1308635…cfbe3` → patched `44c81e8d…ec4e`, `patchedBy: automatic`, two files in the web root | PASS |
| Browser: first-run wizard (admin created), sign-in lands in the shell, Health ok / anonymous 401, Plugins page without repository error, repository listed once, settings area names the bundle | PASS (A Chromium, B Chrome) |
| Home banner; Dismiss hides it, server records `dismissedAt`, wizard still reachable from Settings | PASS (B) |
| 409 `acquisition_not_ready` shown verbatim: "Acquisition is not ready. No enabled indexer has verified its capabilities. No download client is selected. No default quality profile is selected." | PASS |
| Discovery: wrong token → `unauthorized`; Replace / Keep / Clear (pending) / Undo; right token → `ok` over HTTPS to the stand-in; DTO has no value | PASS |
| Refusals: `destination_inside_library`; `/dev/shm` → `destination_not_same_filesystem`; unverified mapping keeps the step open (`path_mapping_unverified`); empty profile (`invalid_qualities`); cutoff outside the allowed qualities (`invalid_cutoff`) | PASS |
| Resume in a new browser session at the first incomplete step (Indexers) | PASS |
| Prowlarr: wrong key `unauthorized`, right key `ok`, Sync adds and verifies one synced indexer with no key of its own | PASS |
| Grabbing on once every step passed; setup `complete`; banner gone | PASS |
| Search → *Add from TMDB* (stand-in) → `+` adds the entry; *Search releases* → picker → one click grabs after the 5 s hold; the stand-in Transmission holds the torrent with the `jellyfinmod` label | PASS |
| Stand-in reports completion with the real file; the plugin imports by **hardlink** (same inode, link count 2); Jellyfin indexes it; entry `onDisk` and bound; history `grabbed`, `media_available` | PASS |
| The file plays in the browser (640×360) to the end and Jellyfin marks it played | PASS |
| TV 1920×1080 and 1280×720: shell, arrows on Home, the wizard's rail walked by arrows, Enter opens a step, Back leaves (focus was placed on the rail's first step before the keys) | PASS |
| Secret actions and Tests from the page: client password Clear saved (not configured, Test refused), Replace; Transmission wrong password `client_auth_failed`, unreachable `client_unreachable`, tarpit `timeout` (21 s); mapping into a library `mapping_inside_library`; mapping on another filesystem saved unverified (`cross_filesystem` pill); synced indexer through a failing feed `unavailable`; manual indexer wrong key `auth_failed`, unreachable `unavailable`, tarpit `timeout`; Prowlarr wrong key `unauthorized`, unreachable `unreachable`, never-answering `timeout` | PASS (A, and all again on B) |
| No secret value, `sec_` reference or `apikey=` in 17 settings/Health/Queue/Entries responses; 0 hits in the container log, Jellyfin log files, stand-in log, `History` rows and plugin XML; secret store mode `600` | PASS (B; on A the check first flagged the Transmission *username*, which is not a secret — harness) |
| **T18, fast settings**: retention on through the area (Any user, 1 day; `RetentionTestWindowMinutes=1` set in the XML as the test-only knob, restart), seed goal met in the stand-in; preview `due 1` with no repair run; native task via `/ScheduledTasks/Running/{id}`: media file unlinked, **folder, `.nfo`, `.srt` and poster stay** (decision 5), download copy back to link count 1, run `completed` inspected 1 / reclaimed 1 / failed 0, entry `reclaimed` with one `reclaimed` history event; retention set back to off / 14 days / All users through the area | PASS (one check read the entry DTO's shape wrongly and recorded FAIL; its own output shows the entry and one `reclaimed` event — harness, corrected) |
| Real settings instead of the test window: a finished file becomes due `ReclaimAfterDays` (default 14) days after completion by the chosen watched-user mode, and the daily *Reclaim expired JellyfinMod media* trigger (03:00 host time) reclaims it | stated, not run |
| T18 item 5 (a seeding torrent below its goal stays blocked) | NOT VERIFIED |
| Phase 6 automation checklist (auto-grab, budgets, breaker, free-space floor, client outage, upgrade to cutoff, new episodes, version selector) | NOT VERIFIED — stopped at the usage rule |

## Step 2 — image shape and the takeover matrix on the image's own web directory (container A)

| Row | Result |
| --- | --- |
| Restart twice | Patched hash unchanged, no double patch | 
| Hand-edited patched file | Warned "modified since it was written", re-rendered from the pristine copy to the same hash |
| Host-upgrade simulation (differently hashed stock file) | New stock recorded, `.pristine.prev` kept, re-patched, stock copy updated |
| `docker compose up -d --force-recreate` | New container, web directory stock again, re-patched at startup (`automatic`); users, database and the single repository entry intact |
| Takeover off (Interface section switch, clicked) | `index.html` restored and **`cmp`-identical to the image's own `index.html` (`a1308635…cfbe3`)**, stock copy removed; stock in desktop, mobile, TV 1080 and 720 (no bundle, one document load, no loop), stock sign-in reaches Home and the Dashboard |
| Recreate with takeover off | Still `cmp`-identical; `/web-mod/` 200 |
| Takeover on again (switch) | Patched, `patchedBy: setting` |
| Failsafe, plugin folder removed | **Not reachable in the image shape**: the entrypoint reinstalls a missing plugin at every start ("installed JellyfinMod 0.1.0.0"), so the page stayed the mod. By design of the entrypoint; recorded, not a failsafe failure |
| Failsafe, bundle directory deleted (running) | Assets 404; stock rendered at `/web/` in all four layouts, no loop; manual recovery (`index.jellyfinmod-stock.html` over `index.html`) serves the `cmp`-identical stock file; the next restart re-extracted the bundle and re-patched |
| Failsafe, plugin disabled through the Dashboard's plugin API, restart | Bundle 404, stock in all four layouts, no loop; re-enabled and restarted: re-verified **without rewriting** (same hash, same mtime) |
| Read-only web root (`0555`) | Startup fine; Interface `readOnly`, blocker `web_root_read_only`, nothing written, `/web-mod/` 200; writable again → patched |
| Rollback to `0.1.0.0-pre-merge` (`9a07af179fad`) | Entrypoint "0.1.0.0 is installed … does not replace it": plugin DLL unchanged (not the pre-merge image's), bundle still `9fe379afd867`, page unchanged. Back on `0.1.0.0` the same |
| Repository | Removed as an administrator: stays removed across a restart (marker); interface, Health and Entries unaffected, only the details panel reports the missing source; re-added once; marker deleted with the entry present → "already registered; not adding another", still one entry |
| `JELLYFINMOD_UI_TAKEOVER=false`, fresh config (C) | XML `UiTakeoverEnabled false`, web root `cmp`-identical to stock, no JellyfinMod file in it, `/web-mod/` 200 |
| Stock parity: takeover off + uninstalled through the Dashboard's plugin API | `cmp`-identical before and after a restart; stock checks pass in desktop, mobile and TV. **Finding:** the uninstall does not survive a restart in the image — the entrypoint reinstalls the plugin (it stays off only because the switch in the kept configuration is off). Removing JellyfinMod from the image shape means switching to the stock image |
| Mobile 390 px and TV layouts on the image | Shell in all four layouts, no horizontal scroll, no page errors |

## Chromium versus Chrome

Chromium 153.0.8010.12 ran container A (shipping image) and Chrome 153.0.8010.53 container B (candidate). Every check
that ran on both — first-run wizard, sign-in, wizard steps 1–5 with every refusal, resume, Prowlarr, profiles,
grabbing, import switch, the whole Tests and secrets matrix, the leak check — gave the same result and the same
server codes and sentences, except the four rows that are the defects above (FAIL on the shipping image, PASS on the
candidate: a product difference between the builds, not a browser one). Acquisition, import, playback, retention and
the takeover matrix ran on Chromium only.

## Harness mistakes corrected on the way (not product defects)

Fixture release group `-S11` parsed as season 11 (renamed `-JFMOD`); reading a notice before its Test's reload
finished (now waits the Test button's busy cycle); probing a file path instead of the download folder; counting hash
navigations as reloads; the entry DTO's shape; the Transmission username counted as a secret.

## Not done

A real upgrade between two plugin versions is impossible — there is no second plugin version. The Phase 6 checklist,
T18 item 5 and a Chrome pass over acquisition, retention and the takeover matrix were not run (usage rule).
Stock parity used the Dashboard's plugin API from the signed-in page rather than clicking Uninstall.

## Cleanup

All containers (A, B, C, the TLS terminator), the Docker network, the stand-in process, the state directory with its
config, media, downloads, certificates and secret files, and the candidate build context on the host were removed;
`docker ps -a`, `docker network ls` and `docker volume ls` show nothing of this run. The images `0.1.0.0`,
`0.1.0.0-pre-merge` and `0.1.0.0-net9` are untouched; `0.1.0.0-s11-candidate` is kept for the coordinator.
