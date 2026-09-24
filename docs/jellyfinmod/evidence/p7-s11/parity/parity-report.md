# P7.S11 step 3 — stock parity on the acceptance instance, with triage

Run 2026-09-24 by Opus 5.5 at high effort, on `<test-host>:28096` (the acceptance instance), signed in as
`oleksii`. Plugin 0.1.0.0 for Jellyfin 12.0.0 / .NET 10, web bundle `9fe379afd867` (web `a279641ebf`),
takeover `patched`. Production (8096), 18096 and the other users' data were not touched.

**Status: partial.** The Playwright Chromium pass is complete. The real Google Chrome pass was **not run**:
the shared 5-hour usage limit reached 97% when the Chromium pass finished, past the 80% stop rule. Nothing
here is Chrome acceptance evidence. The Chrome pass is the next step: the same command with
`JELLYFINMOD_BROWSER=chrome` (see *How to re-run*).

## Shape of the run

| Side | Document | What it is |
| --- | --- | --- |
| Mod | `/web/` | the shipping path: the takeover's patched page, `meta jellyfinmod-web = 9fe379afd867`, `window.__jfmodBundle === true`, every asset under `/web-mod/9fe379afd867/` |
| Stock | `/web-mod/9fe379afd867/index.html` | the fork's stock entry of the same bundle, no `jellyfinmod-web` meta, no `__jfmodBundle`; assets under the same `/web-mod/9fe379afd867/` |

Same origin, so one sign-in, one device and one session; playback is strictly serial (stock, then mod). No
request from either side went to `/web/` other than the mod document itself. The runner is
`scripts/jellyfinmod-e2e/parity.mjs` (`JELLYFINMOD_PARITY_SHAPE=takeover`, the default now), launching its
own headless browser.

## Result — Chromium (Playwright's bundled Chromium 153.0.8010.12, headless)

`chromium/parity-summary.json`: **245 PASS, 1 FAIL, 2 SKIPPED, 10 RECORDED, 4 EXPECTED-FALLBACK**, 0
NOT-VERIFIED, cleanup verified. The one FAIL (C-TWOVER, a 30 s page-ready timeout) passed on an immediate
re-run of that row alone (`chromium/rerun-c-twover-summary.json`); it is recorded as a flake, not triaged
to a class, and must be watched on the Chrome pass.

| Area | Chromium | Chrome |
| --- | --- | --- |
| A1 inventory: Movies 55 / 55, TV 105 / 105 (API, grid total, both sides) | PASS | not run |
| A2 id sets, every movie and show, stock = mod = API | PASS (55, 105) | not run |
| A3 seasons and episodes, all 105 series | PASS | not run |
| A4 sorts, A5 filters, A7 non-Latin | PASS | not run |
| B1–B3 metadata, artwork, cast (12-movie sample incl. the four named titles) | PASS | not run |
| B4 media-info badges, Ends at, audio and subtitle stream lists | PASS | not run |
| B5–B7 seasons, Home rows, version selector | PASS | not run |
| C playback, four named titles (= all predicate fixtures) | PASS, all rows | not run |
| C-TVNEXT, C-TWOVER | PASS / flake (re-run PASS) | not run |
| D user data both directions, E mod-only surfaces, G reachability | PASS | not run |
| T TV layout: inventory at 1920×1080 and 1280×720; keys-only play, seek, Back, Resume at 1920×1080 | PASS | not run |

Layouts covered: desktop 1440×900; TV (`localStorage.layout = 'tv'`) at 1920×1080 and 1280×720 for
inventory, and at 1920×1080 for keys-only playback of *Lessons of Tolerance*. Mobile was not in this scope.

## The four named titles (the stale 2026-09-22 run's)

They are exactly the runner's predicate fixtures: *Mercy* = C-4KHDR, *Lessons of Tolerance* = C-1080,
*Highlander* = C-MULTIAUDIO and C-EMBEDSUB, *David Beckham Infamous* = C-EXTSUB and C-AVI.

| Title | File | What the Pi did (both sides identical) | Chromium |
| --- | --- | --- | --- |
| Highlander | mkv, HEVC 1920×1040, 4 × AC-3, 4 embedded SRT | Transcode to h264/aac (VideoCodecNotSupported, AudioCodecNotSupported), HLS | a–j PASS |
| David Beckham Infamous | avi, MPEG-4 720×400, AC-3, 1 external SRT | Transcode h264/aac (ContainerNotSupported + codecs), HLS | a–e, g–j PASS |
| Mercy | mp4, HEVC 3840×2160 HDR, 3 × AC-3, 4 external SRT | Transcode h264/aac (VideoCodecNotSupported, AudioCodecNotSupported), HLS; start 28–34 s | a–j PASS |
| Lessons of Tolerance | mkv, h264 1920×720, AAC | DirectPlay, static | a–e, i, j PASS (no second audio, no subtitle) |

## Classification of every failure

The 2026-09-22 artifacts are lost, so its 17 failures are classified by reproducing the old procedure's
mechanics and reading today's evidence; every failure this run's iterations produced is listed too. **No
failure was mod-only (class c). No failure was identical-on-stock upstream behaviour counted against the
mod (class b). Every failure was a harness mistake (class a), fixed in the runner and re-run to PASS on
both sides.** No product code changed; the bundle on 28096 is still `9fe379afd867`.

| # | Row | Title | Check | Class | Evidence | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | B4 (2026-09-22), B1/B4 (iteration 1) | Nightbitch, The Wonderful Story of Henry Sugar, After Porn Ends | media-info badge | a | stock `Ends at 11:21 PM` vs mod `Ends at 11:22 PM`, every other badge equal; `.mediaInfoItem.endsAt` is clock time + runtime, read seconds apart across a minute boundary | badges compared without `.endsAt`; Ends at checked per side against its own read time (±1 min); audio/subtitle selects compared with the API's stream indexes. PASS (`chromium/evidence/B4-*.json`) |
| 2 | C-*-e (2026-09-22) | all four | seek | a | ten instant ArrowRight presses moved 5.8 s on **both** sides; upstream `seekRelative` adds `skipForwardLength` (this user: 5 s) to the last reported position, so back-to-back presses coalesce; the old read after 1.5 s also caught HLS seeks mid-flight | presses paced, each waiting for its seek to land; expected 10 × the user's own skip length. PASS 49.8–50.1 s on both (`*-e.json`) |
| 3 | C-*-i (2026-09-22) | all four | stop then resume | a | the old stop point was minutes into a feature, under the server's `MinResumePct` 5 %, so neither entry writes a resume point; the start wait (30 s) was also shorter than Mercy's 4K start (28–34 s) | stop at 20 % via the Digit2 key (upstream `seekPercent`), waits use the 90 s start limit. PASS, stored = stopped = resumed position on both (`*-i.json`) |
| 4 | C-*-f (2026-09-22, iteration run 3) | Highlander, Mercy | audio switch | a | `RememberAudioSelections` is on for this user: every progress report stores the track in use, so the side that plays second started from the first side's last choice (stock started audio 1 / subtitle 5, mod audio 2 / subtitle off) and switched to a different target; the harness also judged before the `changeStream` reload arrived | the remembered selection is snapshotted (database map, else PlaybackInfo defaults) and restored between sides and at the end; the switch waits for the new stream request carrying the target `AudioStreamIndex`. PASS, same target, server and stream index agree (`*-f.json`) |
| 5 | C-*-g (2026-09-22, iteration runs 3, 5) | Highlander, Mercy | subtitle switch | a | same remembered-selection skew; in one iteration the mod side's subtitle step started while the previous audio reload was still in flight (new `master.m3u8` 1.9 s into the subtitle step), so its text track was rebuilt and the cue check ran against a 6-cue track | as row 4, plus the step waits for the chosen track's own request; the cue is found from the server's `Stream.js` and sought with the OSD slider. PASS, native text track, same index on both (`*-g.json`) |
| 6 | C-Beckham-g/h (2026-09-22, iteration run 5) | David Beckham Infamous | subtitle switch and off | a | its only subtitle (index 0) was already selected (remembered), so "switch to a different track" found no eligible entry on **both** sides and Off never ran | select Off first, then switch the track on, then Off. PASS (`C-NAMED-DavidBeckhamInfamous-g/h.json`) |
| 7 | C-*-h (2026-09-22) | Highlander, Mercy, Beckham | subtitle off | a | followed from rows 5–6 (and the position-0 action-sheet trap of 2026-09-21); Off is always selected by `data-id="-1"` | PASS on both, server `SubtitleStreamIndex -1`, no showing track, empty overlay |
| 8 | B5 (iteration 4) | The Wheel of Time | default season list | a | 8 of 41 ids differ — all Series cards from *More like this*, whose selection the server varies per request | compare Season and Episode ids only. PASS |
| 9 | B6 (iteration 4) | Home | Continue Watching / Next Up | a | mod shows one merged row of 24 (stock's 12 + 9 + 3 more), no separate Next Up — the accepted design, UX.md 2026-09-04 "Continue watching + Next up become one row" | stock's two rows must both be inside the mod's merged row, which may hold only resumable or next-up items. PASS |
| 10 | T-play (iteration 4) | Lessons of Tolerance | TV Back stops playback | a | Backspace pressed on both sides; upstream maps Backspace to Back only on Hisense VIDAA; the TV layout's keyboard Back is Escape | Escape (up to three presses: the first may close the OSD). PASS, back lands on details, resume by keys on both |
| 11 | C-TWOVER (final Chromium pass) | Night of the Living Dead | version selection | — (unclassified flake) | `page.waitForFunction` 30 s timeout while reloading a page; the row passed alone right after | watch on the Chrome pass |

Also found and fixed in the harness, with no failure attached: the version selector, E-6 and B6 read from
hidden earlier pages (now scoped to `.page:not(.hide)`); C-TWOVER restored only the default version's user
data while version 2 is its own item (fixed; the one leaked value was restored by hand and proven below);
C-TVNEXT now records which item the server says is playing after the end.

## User-data restore proof

The run changes only `oleksii`'s user data on existing titles. Proof is at the database, not the DTO:
before the runs a copy of the acceptance `jellyfin.db` gave every `UserData` row of `oleksii` (5 143 rows,
every column, including the remembered `AudioStreamIndex` and `SubtitleStreamIndex` that the API does not
expose), and a copy of the plugin database gave `oleksii`'s `CompletionObservations`.

- After the final Chromium pass and the C-TWOVER re-run: **`diff` of all 5 143 `UserData` rows = empty**
  (exit 0), every column equal.
- Plugin `CompletionObservations`: 54 rows before and after, none added or removed; only the bookkeeping
  columns `ObservedAt` (4 rows) and `SourceReason` (3 rows) moved. `Played`, `IsFavorite`,
  `PlaybackPositionTicks`, `LastPlayedAt` and `CompletedAt` are unchanged.
- The runner's own check (`chromium/userdata-after.json`): 8 items, every DTO field and the effective
  remembered audio and subtitle index equal to the snapshot.

Two values were restored by hand during the iterations, from the pre-run evidence: *Lessons of Tolerance*
(a debugging play wrote a resume point and `PlayCount`; restored to the run-2 snapshot) and the 720p version
of *Night of the Living Dead* (`PlayCount` 14, `LastPlayedDate` 2026-09-22 04:19:41; restored). One value
is an inference: *Highlander*'s remembered subtitle before iteration run 3 was not recorded (no database
snapshot existed yet). Stock started it on subtitle 5, which the server does only if the stored value is 5 or
null; a stored `-1` would start it off. Any earlier play stores a value, so it was restored to 5 (audio 1).

## Hygiene

No `JellyfinMod`-prefixed title in any library or in `GET /JellyfinMod/Entries`; the entry set is the same
159 ids before and after; the takeover still `patched` on bundle `9fe379afd867`; the `layout` key restored.
Nothing was created on the server.

## How to re-run

```sh
JELLYFINMOD_TEST_URL=http://<test-host>:28096/ \
JELLYFINMOD_PARITY_OUT=<scratch dir> \
JELLYFINMOD_BROWSER=chrome \
JELLYFINMOD_PARITY_STREAM_MEMORY=<map of itemId -> {a, s} read from a copy of the database> \
node scripts/jellyfinmod-e2e/parity.mjs
```

`JELLYFINMOD_BROWSER` is `chromium` (default), `chrome` or `cdp`; `JELLYFINMOD_PARITY_AREAS` narrows areas
(any subset makes `fullAcceptance` false); `JELLYFINMOD_PARITY_TITLE_NAMES` names the titles that always get
the full playback sequence; a title that is not playing within `JELLYFINMOD_PARITY_START_LIMIT_MS` (90 s) is
NOT-VERIFIED, never PASS.
