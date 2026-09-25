# P7.S11 — final browser acceptance on the acceptance instance (runner worker)

Opus 5.5, high effort. 2026-09-25. Acceptance instance (28096), plugin 0.1.0.0 (branch `p7-s11` `d6fdc88`), bundle
`aa4774e84dbf` (web `caad4989bc`), takeover `patched`, host 12.0.0. Signed in as `oleksii` with an empty password.
Playwright's bundled Chromium 153.0.8010.12 and Google Chrome 153.0.8010.53, headless. Real server, real HTTP; no
mocks. Stopped at the 80% usage rule: what did not run is listed at the end, not claimed.

## 1. Existing runners, both browsers

Counts are the runner's own PASS/FAIL lines (tv-shell also prints NOTE timing lines, not counted). Per-line results in
`runners.json`. Chromium figures are from the run after the harness fixes below (retarget-smoke, tv-shell and
settings-prowlarr re-run; browser-review re-run twice).

| Runner | Layouts | Chromium 153.0.8010.12 | Chrome 153.0.8010.53 |
| --- | --- | --- | --- |
| `retarget-smoke.mjs` | desktop | 8 pass / 0 fail · 17s | 8 pass / 0 fail · 23s |
| `browser-review.mjs` | desktop, mobile, TV 1080, TV 720 | 9 pass / 1 fail (exit 1) · 22s | 9 pass / 1 fail (exit 1) · 25s |
| `tv-shell.mjs` | TV 1080, TV 720, desktop, mobile | 135 pass / 0 fail · 413s | 134 pass / 1 fail (exit 1) · 440s |
| `review-fixes.mjs` | desktop, TV 1080, TV 720 | 27 pass / 0 fail · 46s | 27 pass / 0 fail · 47s |
| `settings-area.mjs` | desktop, mobile, TV 1080, TV 720 | 32 pass / 0 fail · 66s | 32 pass / 0 fail · 69s |
| `settings-dashboard.mjs` | desktop | 9 pass / 0 fail · 7s | 8 pass / 1 fail (exit 1) · 9s |
| `settings-prowlarr.mjs` | desktop | 9 pass / 0 fail · 4s | 9 pass / 0 fail · 6s |
| `takeover-review.mjs` | desktop | 10 pass / 0 fail · 11s | 10 pass / 0 fail · 10s |
| `security-sweep.mjs` | HTTP + desktop, mobile | 14 pass / 0 fail · 31s | 14 pass / 0 fail · 31s |

- **browser-review** stops at its first failure: *Keep is not reachable by ArrowDown in tv* (1920×1080, both
  browsers), after native details passed on desktop, mobile and TV 1080 and Keep was reached by keyboard on desktop
  and mobile. Every later step (TV 720, discovery, failed and in-flight Add, seeded empty page, Home exclusion,
  plugin outage, Home resume, ID leak, search scope) **did not run**. Not classified: it needs a look at the TV focus
  order around the mod action row (Search releases beside Keep since P7.S6); the runner now walks the row with Right
  and still does not reach Keep. Gates skipped for want of data on 28096: normal and filtered countdown (retention is
  off), reclaimed details (no reclaimed entry), Keep activation (irreversible, see harness fixes).
- **tv-shell** on Chrome: one FAIL, TV 720 *Enter on a Home card opens details; Back returns with focus restored*
  (focus ended on BODY). Passed on Chromium in the same build; flaky, not classified.
- **settings-dashboard** on Chrome: first run NOT VERIFIED (a 30 s wait), re-run FAIL *A retention save re-reads when
  the page is opened again* (saved 15, re-read 14). That run left **retention days at 15 (was 14)**; restoring it was
  refused by this session's permission rules and is left to the coordinator (retention is off; nothing is deleted).
- **takeover-review** ran a live *Restore stock now* and re-applied the takeover in both browsers; the patched hash
  afterwards equals the one before (`7ca5d2dd6c0b…`).
- **security-sweep** created and deleted its disposable ordinary user in both browsers; no user is left.

## 2. Full-replacement sweep (`scripts/jellyfinmod-e2e/replacement-sweep.mjs`)

Every PHASE7 §2.2 row opened from the shell; TV by keys only (arrows, Enter, Escape, the remote's 461 to leave the
player). *(typed)* marks the one row the TV shell has no link to. Chrome ran all four layouts (1215 s: desktop 218,
mobile 283, TV 1080 315, TV 720 399): **175 PASS, 10 FAIL, 15 NOT VERIFIED, 32 NOT PRESENT**. The Chromium sweep was
stopped at the usage limit after a few desktop rows and is **not reported**; per-row detail in `sweep-chrome.json`.

| Row | desktop Chrome | mobile Chrome | tv1080 Chrome | tv720 Chrome |
| --- | --- | --- | --- | --- |
| Home | PASS | PASS | PASS | PASS |
| Movies library | PASS | PASS | PASS | PASS |
| Movies tab: Suggestions | PASS | PASS | PASS | PASS |
| Movies tab: Favorites | PASS | PASS | PASS | PASS |
| Movies tab: Collections | PASS | PASS | PASS | PASS |
| Movies tab: Genres | PASS | PASS | PASS | PASS |
| Movies tab: Studios | PASS | PASS | PASS | PASS |
| Movies tab: Playlists | PASS | PASS | PASS | PASS |
| Movies tab: Movies | PASS | PASS | PASS | PASS |
| Movie detail | PASS | PASS | PASS | PASS |
| Person detail (Embed) | PASS | PASS | PASS | PASS |
| TV library | PASS | PASS | PASS | PASS |
| TV tab: Suggestions | PASS | PASS | PASS | PASS |
| TV tab: Upcoming | PASS | PASS | PASS | PASS |
| TV tab: Genres | PASS | PASS | PASS | PASS |
| TV tab: TV Networks | PASS | PASS | PASS | PASS |
| TV tab: Episodes | PASS | PASS | PASS | PASS |
| TV tab: Collections | PASS | PASS | PASS | PASS |
| TV tab: Playlists | PASS | PASS | PASS | PASS |
| TV tab: Shows | PASS | PASS | PASS | PASS |
| Series detail | PASS | PASS | PASS | PASS |
| Season detail | PASS | PASS | PASS | PASS |
| Episode detail | FAIL | PASS | PASS | PASS |
| Search | PASS | PASS | PASS | PASS |
| Movie detail from search | PASS | PASS | PASS | PASS |
| Video player (play a few seconds, then Back) | PASS | PASS | PASS | PASS |
| played title user data restored | PASS | PASS | PASS | PASS |
| Queue | FAIL | FAIL | PASS (typed) | PASS (typed) |
| JellyfinMod settings | PASS | NOT VERIFIED | PASS | PASS |
| JellyfinMod setup wizard | PASS | NOT VERIFIED | PASS | FAIL |
| Jellyfin preferences menu | PASS | PASS | PASS | PASS |
| User profile | PASS | PASS | PASS | PASS |
| Display preferences | PASS | PASS | PASS | PASS |
| Home screen preferences | PASS | PASS | PASS | PASS |
| Playback preferences | PASS | PASS | PASS | PASS |
| Subtitle preferences | PASS | PASS | PASS | PASS |
| Controls preferences | PASS | NOT VERIFIED | PASS | PASS |
| Quick Connect (user menu) | PASS | PASS | — | — |
| Metadata manager | PASS | PASS | NOT VERIFIED | NOT VERIFIED |
| Sign out | PASS | PASS | PASS | PASS |
| Sign back in | PASS | PASS | PASS | PASS |
| Dashboard | PASS | PASS | PASS | FAIL |
| Dashboard: General | PASS | NOT VERIFIED | FAIL | NOT VERIFIED |
| Dashboard: Users | PASS | PASS | FAIL | NOT VERIFIED |
| Dashboard: Libraries | PASS | PASS | FAIL | NOT VERIFIED |
| Dashboard: Plugins | PASS | PASS | FAIL | NOT VERIFIED |
| Dashboard: Plugins → JellyfinMod | PASS | PASS | FAIL | NOT VERIFIED |
| Dashboard: Scheduled tasks | PASS | PASS | NOT VERIFIED | NOT VERIFIED |
| Dashboard: Logs | PASS | PASS | NOT VERIFIED | NOT VERIFIED |
| Stock for now: Music | NOT PRESENT | NOT PRESENT | NOT PRESENT | NOT PRESENT |
| Stock for now: Live TV | NOT PRESENT | NOT PRESENT | NOT PRESENT | NOT PRESENT |
| Stock for now: Books | NOT PRESENT | NOT PRESENT | NOT PRESENT | NOT PRESENT |
| Stock for now: Photos and home videos | NOT PRESENT | NOT PRESENT | NOT PRESENT | NOT PRESENT |
| Stock for now: Playlists | NOT PRESENT | NOT PRESENT | NOT PRESENT | NOT PRESENT |
| Stock for now: Collections (boxsets library) | NOT PRESENT | NOT PRESENT | NOT PRESENT | NOT PRESENT |
| Stock for now: Music videos | NOT PRESENT | NOT PRESENT | NOT PRESENT | NOT PRESENT |
| Stock for now: Mixed folders | NOT PRESENT | NOT PRESENT | NOT PRESENT | NOT PRESENT |
| layout override removed | PASS | PASS | PASS | PASS |
| Quick Connect | — | — | PASS | PASS |

Classification of every non-PASS:

| Row | Layouts | Class | Evidence |
| --- | --- | --- | --- |
| Queue | desktop, mobile | **Product defect, fixed in this branch (not deployed)** | Error boundary: `t.toLowerCase is not a function` in the v0 polyfill's `createElement`. The row-actions button was rendered with `is='paper-icon-button-light'`; the queue holds a seeding row, so an administrator's Queue always crashed. TV passes because its row has no such button. Fix `30681f9d6f` |
| Dashboard sub-pages | TV 1080, TV 720 | Upstream, identical on the stock entry | From the Dashboard drawer's first link (the server name) no arrow key moves focus on either `/web/` or `/web-mod/<id>/index.html` (checked side by side); the sweep's one-step detour does not escape it |
| Metadata manager | TV | Shell gap on the TV | No link in the TV header, preferences menu, settings area or reachable Dashboard; the typed fallback did not run because the Dashboard rows before it failed. Desktop and mobile reach it from the user menu |
| JellyfinMod setup wizard, Dashboard | TV 720 | Harness (not classified further) | Focus stuck on the header's SyncPlay button while seeking a settings-area link at 1280×720 |
| JellyfinMod settings, setup wizard, Controls, Dashboard: General | mobile | Harness | The narrow settings area hides the step rail the check looks for; upstream shows no Controls link on mobile; the Dashboard drawer link was not opened first |
| Episode detail | desktop | Harness | A click on the episode row's body did not navigate; Enter on TV and a tap on mobile did |
| Stock-for-now library types | all | NOT PRESENT | 28096 has only Movies and Shows libraries |

Known-benign failed requests, each listed per row in the JSON: requests aborted by navigation, 404 on missing
artwork, and a GET still in flight with the token Sign Out had just revoked (401 on `/System/Info` or `/Users`).
Playing *Night of the Living Dead* (H.264/AAC) for a few seconds wrote its user data; the sweep put it back exactly
through `POST /UserItems/{id}/UserData` in every layout and confirmed no session was still playing.

## 3. Harness fixes (commit `3f6065787f`)

- `browser-review.mjs`: Search releases moved from the stock More menu to the mod's action row in P7.S6
  (`854ffd77c3`); the check now looks there and confirms the stock menu carries no mod command. Keep has no undo
  through the API (open question 13), so Enter on Keep needs `JELLYFINMOD_ALLOW_KEEP=true`; otherwise reachability is
  checked and activation is a named skipped gate. On the TV the Keep search walks the action row with Right.
- `tv-shell.mjs`: waits for real search results before the D-pad walk (skeletons are not focusable), and polls for
  the Suggestions tab's cards instead of a fixed 3 s pause (TV 1080 read an empty tab once).
- `settings-prowlarr.mjs`: removal now confirms in the settings area's own dialog; the old run left its disposable
  *JellyfinMod Prowlarr* source behind (removed by this worker, then re-run clean).
- `takeover-review.mjs`: accepts 28096 as well as 18096.

## 4. Not run (usage limit)

- Brief step 2, the settings changes in the browser against a stand-in Transmission and Prowlarr.
- Brief step 4, takeover off through the Interface section with `index.html` hashes and the stock checks, then back
  on (takeover-review's live restore and re-apply above covers the switch, not the hashes of the restored file).
- The Chromium replacement sweep; browser-review past its TV Keep failure.

## 5. Hygiene (after the last run)

Compared with a snapshot taken before the first run: 159 entries with the same ids, none `JellyfinMod`-titled; no
`JellyfinMod` item in any library; indexers, download clients, quality profiles, Prowlarr sources (none) and the
acquisition settings unchanged; users `nata`, `oleksii`, `papa`, `vika` only; nothing playing; takeover `patched` on
`aa4774e84dbf` with the same patched hash; no stand-in started. `oleksii`: every UserData row identical at database
level (`userdata-diff.json`, 5143 rows), one plugin completion observation's `ObservedAt` refreshed; user
configuration, policy and display preferences unchanged. Retention days: 15, was 14 (above).
