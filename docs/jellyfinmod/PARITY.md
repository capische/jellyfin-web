# Parity acceptance — stock `/web` versus the JellyfinMod interface at `/web-mod`

Plan written 2026-09-20 (P7.S6). **This document plans and specifies a run; it is not evidence.**
Nothing here has been executed. It is written to be carried out by a different agent without any
further design decision: every selection rule, every threshold, every pass/fail rule and every
cleanup step is stated. Where a fact must be discovered on the host rather than assumed, the
document says how to discover it and requires the discovered value to be recorded.

Read before executing: [PLAN.md](PLAN.md) (non-negotiables, definition of done),
[README.md](README.md) §1, §7.1, §9.2, [UX.md](UX.md) §14 (degradation), [PHASE7.md](PHASE7.md)
§2.1–§2.3 (what the mod entry owns today), §3.2 (patch surface), §4.5 and its S3 evidence (how
the bundle is served), [REVIEW.md](REVIEW.md) (the acceptance-runner conventions this reuses),
and both `CLAUDE.md` files.

---

## 0. What this run answers

The user's requirement, in their words:

> compare original version with tv shows and movies, so all movies and tv shows available in a
> new one and work with choosing different tracks, subtitles, and other feature

So the question is not "does the new interface look right". It is: **is everything still there,
and does it still play, with the tracks and subtitles the user picks?** The run is an A/B between
two URLs on one server:

| | Address | What it is |
| --- | --- | --- |
| **Stock side** (`S`) | `http://<test-host>:<mod-port>/web/` | the host's own web root |
| **Mod side** (`M`) | `http://<test-host>:<mod-port>/web-mod/` | the bundle the plugin serves (PHASE7 §4.5) |

Same server, same account (`oleksii`, empty password), same libraries, same database, same files.
Every difference therefore comes from the interface, never from the data. That is what makes
data-level comparison the primary instrument and screenshots useless.

### 0.1 Read this before writing a single failure

**"Stock" on the test instance is the fork's stock entry, not vanilla upstream Jellyfin.** The
isolated compose bind-mounts this checkout's `dist/` over the container's web directory, so
`/web/` serves `dist/index.html` — upstream screens *plus* the Phase 1–6 additive mounts (file
marks, File filter group, two-zone search, detail augmentation, merged Home rows, hero and
top-bar restyle). That is deliberate: it is the product the user has today, and it is the correct
baseline for "did the new interface lose anything". The run must record which document each side
served (§1.4) so the report cannot be misread later.

**Today the mod entry owns no library screen.** `MOD_ROUTES` in
`src/apps/modern/features/jellyfinmod/shell/ModAppRouter.tsx` is an empty array. Home, Movies,
TV, search and details are upstream's own routes rendered inside the mod shell (`ModAppLayout`,
`ModToolbar`). Stage B (S6) has not landed. **The expected result of this run is therefore
near-total parity by construction.** Any inventory, detail or playback difference found today is
a shell, router or asset-rooting defect — a real failure, not a missing feature. That is exactly
why the run is worth doing now: it establishes the baseline that Stage B must not break, and it
is the cheapest moment to catch a bundle-serving defect (two were already found this way, S3).

---

## 1. Preconditions, hard limits and preflight

### 1.1 Hard limits — restated, not optional

- **Ports 18096 and 28096 only.** Production `jellyfin` on **8096** is never contacted, never
  restarted, never read from. The runner must refuse any other port at start-up, exactly as
  `browser-review.mjs` does (its `ISOLATED_PORTS` guard). Copy that guard verbatim.
- **No fixtures left behind.** This run creates **no** library item, **no** catalog entry, **no**
  indexer, **no** download client and **no** file. It changes only *user data* (played flags,
  favourites, resume points) on titles that already exist, and restores every one of them (§7).
  The final assertion is that no `JellyfinMod`-prefixed title exists in any library or in
  `GET /JellyfinMod/Entries` and that the user-data snapshot matches what it was at start.
- **The production Movies mount is read-only and stays read-only.** Playback reads those files.
  Nothing writes to them, nothing renames, nothing deletes.
- **No credentials in commands, logs, report or console.** Sign-in is `oleksii` with an empty
  password, handled the way `browser-review.mjs` handles it. Never print a token, never print the
  `Authorization`/`X-Emby-Token` header, never log a full API URL that carries `api_key`.
- **No unit tests.** This is a real browser against a running server, or it is not evidence.
- **No LAN address or host path in anything committed.** Use `<test-host>` in the report if the
  report is ever committed; the raw logs stay in the session scratchpad.

### 1.2 Environment

| Variable | Meaning | Required |
| --- | --- | --- |
| `JELLYFINMOD_TEST_URL` | `http://<test-host>:28096/` (or `:18096`) | yes |
| `JELLYFINMOD_CDP_URL` | the dedicated Chrome's debugging endpoint; defaults to loopback port 9223 | no |
| `JELLYFINMOD_TEST_USER` | default `oleksii` | no |
| `JELLYFINMOD_PARITY_OUT` | directory for logs and the report | yes |
| `JELLYFINMOD_PARITY_QUICK` | `true` runs the §9.2 subset | no |
| `JELLYFINMOD_PARITY_SAMPLE` | movies opened in area B, default `12` | no |
| `JELLYFINMOD_PARITY_SKIP_PLAYBACK` | `true` skips area C entirely; **never** for an acceptance run | no |
| `JELLYFINMOD_PARITY_TWO_VERSION_ID` | the item id holding a 1080p and a 720p version; discovered if unset | no |

Prerequisites, as in [REVIEW.md](REVIEW.md): Node 22+, `npm ci --prefix scripts/jellyfinmod-e2e`
once, and a dedicated Chrome with remote debugging on 9223 already signed in to the test server.
No browser is downloaded or launched; the runner attaches over CDP.

**Check the CDP Chrome is free before starting.** Other agents use the same browser. If a tab is
already driving 18096 or 28096, stop and say so rather than racing it.

### 1.3 The shared-origin hazard — read it once, honour it everywhere

`/web/` and `/web-mod/` are **the same origin** (`http://<test-host>:28096`). Three consequences
that will silently corrupt results if ignored:

1. **One `localStorage`, therefore one Jellyfin device id.** The server sees a single session for
   both tabs. **Never let both tabs play at the same time.** Every playback step is strictly
   serial: start on one side, capture, stop fully (`Sessions/Playing/Stopped` observed), only
   then touch the other side.
2. **One `layout` key.** Setting `localStorage.setItem('layout','tv')` puts *both* tabs in TV
   layout after reload. Set it, reload both, and restore with `removeItem('layout')` plus a
   reload of both at the end, as `browser-review.mjs` does.
3. **One set of user preferences and one query cache.** A display-preference change made while
   testing one side is visible on the other. The run changes no display preference; if a check
   ever needs one, it captures and restores it like the runner's `originalUserConfiguration`.

### 1.4 Preflight — a hard gate, abort on failure

1. Connect over CDP, open **two** tabs in the same context: `pageS` → `<base>/web/`,
   `pageM` → `<base>/web-mod/`. Wait for `window.ApiClient` and a visible `.page:not(.hide)` on
   each (`appReady`, copied from the runner).
2. Assert both are signed in as the same user: `ApiClient.getCurrentUserId()` is equal on both
   and `GET Users/{id}` returns `Name === 'oleksii'`. If not, drive the login form as the runner
   does and re-assert.
3. Record which document each side served, into the report header:
   - `pageS`: `document.querySelector('meta[name="jellyfinmod-web"]')?.content ?? null`,
     `window.__jfmodAssetRoot ?? null`, and whether the Phase 1–6 mounts are present
     (`!!document.querySelector('.jfmod-nativeEntryDetails, .jfmod-discovery, .jfmod-fileMark')`
     after visiting a detail page — recorded in area B, not here).
   - `pageM`: the same three, plus the bundle id the meta tag carries.
   - `GET JellyfinMod/Health` once: `Version`, `web.bundleId`, `webCommit`, `hostVersion`,
     `Capabilities`.
   - The local `git rev-parse --short HEAD` of this checkout.
4. Assert `pageM`'s network log contains **zero** requests under `/web/` other than the host's own
   (the S3 rule). A request to `/web/...` from the mod side is an asset-rooting regression.
5. Assert the user's view set is identical: `GET UserViews` from each tab returns the same
   `Items[].Id` set in the same order.

**Gate rule.** Preflight failure aborts the run with exit 1 and no further area is attempted. A
run that cannot establish the same user, the same views and a correctly rooted bundle cannot say
anything about parity.

---

## 2. Harness — one new script, and why

**Decision: add `scripts/jellyfinmod-e2e/parity.mjs` as a second script in the existing package.
Do not add a mode to `browser-review.mjs`, and do not refactor it.**

Reasons, so the executor does not relitigate this:

- `browser-review.mjs` is a **single-origin** acceptance of mod surfaces. Parity is inherently
  **two-origin and paired**: nearly every step runs the same action twice and diffs the results.
  Bolting that onto a linear single-page script would mean threading a second `page`, a second
  CDP session and a second network listener through nineteen existing steps that do not want
  them.
- Runtimes differ by an order of magnitude (≈75 s versus ≈50 min, §9). Merging them would make the
  post-deploy smoke run either slow or misleading.
- The file is ≈1 400 lines and **other agents have uncommitted work in this tree**. Extracting
  shared helpers into a module would touch it and risk their edits. Copy the preamble instead;
  duplication of a 120-line harness is the cheaper mistake.
- Failure domains should stay separate: "the mod's own surfaces regressed" and "the new interface
  lost a movie" are different verdicts and belong in different exit codes.

**What to copy verbatim** from `browser-review.mjs` (same names, same semantics, so the two scripts
stay readable side by side): the `ISOLATED_PORTS` guard; `seconds`, `timings`, `waits`, `timed`,
`step`; `sleep`, `ignore`, `poll`; the per-page request bookkeeping (`inflight`, `heldRequests`,
`lastNetworkActivity`, the navigation-cancels-pending rule) and `networkIdle`; `appReady`,
`navigate`, `reload`; `apiRequest`; `pressKey`, `enterFocused`; the `finally` block shape that
restores layout, unroutes, closes tabs and disconnects without killing the Chrome.

**What is new.** Every copied per-page helper becomes a factory taking a `page`, so the script can
hold two independent sets: `const S = harness(pageS, '<base>/web/')` and
`const M = harness(pageM, '<base>/web-mod/')`. Add to `package.json`:
`"parity": "node parity.mjs"`. Dependency stays `playwright-core` only.

**Output contract**, mirroring the runner's: per-step `passed <name> (12.3s)` lines, a final JSON
summary on stdout with `rows`, `skipped`, `timings`, `waits`, `idleTimeouts`, and exit codes
**0** = every row passed, **1** = at least one row failed, **2** = rows were skipped and
`JELLYFINMOD_ALLOW_SKIPS` is not `true`.

### 2.1 The comparison primitives

Three, and only three. Every check in §3–§6 is built from them.

```js
// 1. Reference data, straight from the API as the signed-in user. The truth both UIs are measured against.
const ref = await S.apiRequest('Items?...');           // either tab; the data is the same

// 2. What a UI actually rendered, as a SET of normalised ids.
const shown = page => page.evaluate(() => Array.from(document.querySelectorAll('.card[data-id], [data-id].listItem'))
    .map(node => node.dataset.id.replace(/-/g, '').toLowerCase()));

// 3. What a UI actually asked the server for, from the per-page request log.
//    Used to explain a difference, never to establish one.
```

Normalise **every** id with `.replace(/-/g, '').toLowerCase()` before comparing; Jellyfin returns
both dashed and undashed forms depending on the route, and an un-normalised diff produces a
spectacular false failure.

**Never compare screenshots pixel-wise.** Screenshots are captured only as attachments to a row
that already failed, to help a human read the failure.

### 2.2 How a difference is reported

A set difference is reported **item by item**, never as a count:

```
FAIL  A2  Movies grid, sort Name asc
      stock: 187 ids    mod: 185 ids
      missing from mod (2):
        6f1c…  "Сталкер"          (Movie, /web-mod/#/details?id=6f1c…)
        a904…  "Tokyo Story"      (Movie, /web-mod/#/details?id=a904…)
      extra in mod (0):
      reference API set: 187
```

Every failure row carries: the **exact URL** of each side, the **item id(s)**, the **title**, and
**what differed**. A row that says "counts differ" and stops is not an acceptable result.

---

## 3. Area A — inventory parity (cheap, data-level, runs first)

**Why first:** it is the fail-fast area. It needs no playback, costs ≈7 minutes, and a real
mismatch here makes everything downstream uninteresting.

### A1 — library views and totals *(hard gate)*

- `GET UserViews` from each tab: identical `Id` sets, identical order, identical `CollectionType`.
- For each of the **Movies** and **TV** views, `GET Items?ParentId={viewId}&Recursive=true&
  IncludeItemTypes=Movie|Series&Limit=0` and read `TotalRecordCount`; it must be equal from both
  tabs (it is one server, so this really asserts that both tabs query as the same user with the
  same filters).
- Navigate `pageS` to `#/movies?topParentId={id}` and `pageM` to the same hash, let both settle,
  and compare each grid's own reported total (upstream renders it in the paging control; read it
  from the DOM, falling back to the count of rendered cards after full lazy-load, A2).

**Pass:** all three equal on both sides. **Fail (gate):** any inequality — abort the run, report
the numbers and the two URLs.

### A2 — item id **sets**, exhaustively, per library

For **Movies** and for **TV**:

1. Build the reference set from the API with explicit paging until `StartIndex >= TotalRecordCount`:
   `Items?ParentId={viewId}&Recursive=true&IncludeItemTypes=Movie` (or `Series`)
   `&SortBy=SortName&SortOrder=Ascending&Limit=200&StartIndex=…&Fields=ProviderIds`.
2. On each side, open the grid and **force full lazy-load**: scroll the item container to the
   bottom in a loop (`scrollTo(0, scrollHeight)` + `networkIdle()`) until the rendered id count
   stops growing across two consecutive iterations or 60 s elapses. If the view paginates rather
   than lazy-loads, walk every page and union the ids. Record which mode each side used.
3. Compare three sets: `S` vs `M`, `S` vs `ref`, `M` vs `ref`.

**Pass:** `S === M === ref` as sets.
**Fail:** any asymmetric difference, listed item by item per §2.2. A title present in `ref` but in
neither UI is reported as a *shared* gap (a server or query defect, not a parity defect) and does
not fail the parity row, but must appear in the report as `SHARED-GAP`.

### A3 — seasons and episodes

Series are the user's explicit concern, so this is exhaustive over the TV library (it is small
today) rather than sampled.

For every series id in the A2 TV set:
- `GET Shows/{id}/Seasons` and `GET Shows/{id}/Episodes?Fields=MediaSources` → reference sets.
- Open `#/details?id={seriesId}` on both sides; expand/enumerate the season list; open each
  season; collect the rendered episode id set.

**Pass:** the season id set and, per season, the episode id set are equal on `S`, `M` and `ref`.
**Fail:** any missing or extra season or episode, named with series title, season number, episode
number and id.

### A4 — sort orders

For the Movies grid, apply each of: `SortName` asc, `SortName` desc, `DateCreated` desc,
`PremiereDate` desc, `CommunityRating` desc. Use the upstream sort menu on both sides (it is the
same component), then read the rendered id **sequence** (not set) of the first 60 cards.

**Pass:** the sequences are identical between `S` and `M`, and both match the API's ordering for
the same `SortBy`/`SortOrder` (compare the first 60 ids of the API result).
**Fail:** the first index at which the sequences diverge, with the three ids at that index.

### A5 — filters

Apply, one at a time, through the upstream filter dialog on both sides, on the Movies library:

| Filter | Applied as |
| --- | --- |
| Genre | the first genre returned by `GET Genres?ParentId={movies}` that has ≥2 items |
| Year | the most populated year in the library (derive from the A2 reference set) |
| Played | `IsPlayed=true` |
| Unplayed | `IsPlayed=false` |
| Favourites | `IsFavorite=true` |
| **File** (mod-only) | the JellyfinMod File group, if the dialog offers it — see area E |

**Pass:** for each filter, the rendered id set is equal on `S` and `M`, and equal to the API set
for the equivalent query. A filter offered on one side and not the other is a failure **unless**
it is the mod-only File/Due group, which is area E's business.
**Fail:** per §2.2, naming the filter and the differing ids.

### A6 — collections / boxsets

- `GET Items?IncludeItemTypes=BoxSet&Recursive=true` → reference set.
- Open the Movies library's **Collections** tab on both sides; compare rendered boxset id sets.
- Open the first boxset on each side; compare its child id sets.

**Pass:** equal sets at both levels. **Fail:** per §2.2.

### A7 — non-Latin titles

From the A2 reference set, select every item whose `Name` contains a character outside
` -ɏ` (this catches the Cyrillic titles and anything CJK). For each:

- It appears in both UIs' rendered sets (already covered by A2 — this row asserts it explicitly
  so a regression is named rather than buried).
- Its rendered **text** is byte-equal on both sides: read the card's `aria-label`/text content and
  compare with `===`, after `String.prototype.normalize('NFC')` on both.
- Search for the exact title on both sides (`#/search?query=…`, URL-encoded) and assert the item
  appears in the results of both.

**Pass:** all three for every such title. **Fail:** list each title, its id and which of the three
failed. Mojibake (`Ð¡Ñ‚Ð°Ð»ÐºÐµÑ€`) on either side is a failure even if the ids match.

---

## 4. Area B — detail parity

Cost control: the production Movies library has dozens of titles and opening each one costs
≈6–10 s per side. **Sample, do not exhaust.** Exhaustive coverage already happened at the id
level in A2.

### B0 — the sample, chosen deterministically

Take the A2 Movies reference set sorted by `Id` ascending. The sample is:

1. every item selected as a playback fixture in §5 (so detail and playback agree on the same
   items) — up to 7;
2. every non-Latin title from A7, capped at 3;
3. the two-version title (§5.8);
4. items at evenly spaced indices of the sorted set, until the sample reaches
   `JELLYFINMOD_PARITY_SAMPLE` (default **12**) distinct movies.

Plus **all** series in the TV library (it is small), and for the first series: one season and one
episode detail page.

Print the final sample ids at the top of the report. A later run with the same library must
produce the same sample; if it does not, the library changed and the report says so.

### B1 — metadata fields

For each sampled item, on both sides, read from the rendered detail page and compare with `===`
after trimming:

| Field | DOM source |
| --- | --- |
| Title | `.itemName` (primary), `.parentItemName` where present |
| Year / premiere date | `.itemMiscInfo` date element |
| Runtime | `.itemMiscInfo` runtime element |
| Official rating | `.mediaInfoOfficialRating` |
| Community / critic rating | `.starRatingContainer`, `.mediaInfoCriticRating` |
| Genres | `.genresGroup` link texts, as an ordered list |
| Overview | `.overview` text |
| Studios / tags | `.studiosGroup`, `.tagsGroup` |

Also compare each against the API reference (`GET Items/{id}?Fields=Overview,Genres,Studios,
Taglines,ProviderIds,MediaSources,MediaStreams`), so a field both UIs get wrong is reported as
`SHARED-GAP` rather than as parity.

**Pass:** every field equal between `S` and `M`. **Fail:** name the item id, the field, and both
values verbatim (truncated to 200 characters).

### B2 — artwork

Do **not** diff images. Compare the *resolved image URLs*, with the origin and the bundle path
stripped: primary, backdrop and logo `src` attributes must resolve to the same
`/Items/{id}/Images/{type}?…` path and the same `tag` query value on both sides. Then assert each
image element on both sides reports `naturalWidth > 0` (it loaded).

**Pass:** same image paths and tags, both loaded. **Fail:** a 404, a zero-width image, a different
tag, or an image rooted at `/web/` from the mod side.

### B3 — cast and crew

Compare the rendered people id sequence (`.peopleSection .card[data-id]`) and the count, against
each other and against `GET Items/{id}?Fields=People`.

**Pass:** identical sequences. **Fail:** per §2.2, plus the first differing index.

### B4 — media info (codec, resolution, HDR, audio, subtitles)

This is the row that most often exposes a real defect, and it is the bridge into area C.

For each sampled item, on both sides, open the media-info display (upstream renders
`.mediaInfoStreamType`/`.mediaInfoItem` rows, and the "media info" dialog where the detail page
offers one) and collect, per media source:

- container, video codec, width × height, `VideoRange` (HDR/SDR), bit rate;
- every audio stream's index, codec, channel layout and language;
- every subtitle stream's index, codec, language and `IsExternal`.

Compare as an ordered list against each other, **and** against
`GET Items/{id}?Fields=MediaSources` (`MediaSources[].MediaStreams[]`).

**Pass:** the per-source stream lists are equal between `S` and `M`, and each matches the API's
`Index`, `Codec`, `Language` and `IsExternal` for the same stream.
**Fail:** name the item, the media source id, the stream index and the differing attribute. A
stream that exists in the API and is rendered by one UI but not the other is a failure. A stream
missing from both is `SHARED-GAP`.

### B5 — episode lists and season navigation

On the sampled series, on both sides: the season selector lists the same seasons; selecting a
season renders the same episode id sequence; the "next"/"previous" season affordances behave the
same (record the mechanism each side used); an episode detail page shows the same series and
season parent links (same ids in the link hrefs).

**Pass:** identical id sequences and identical parent link targets.

### B6 — continue watching and next up

Prepare deterministically rather than hoping the account has state: pick one episode of the
sampled series, set a resume point through the API to 25 % of its runtime, and mark its
predecessor played (both captured for restoration, §7).

- `GET UserItems/Resume?limit=24&mediaTypes=Video` and `GET Shows/NextUp?limit=24` → reference.
- On both sides, open Home and read the **Continue watching** and **Next up** row id sequences.

**Pass:** both rows exist on both sides with the same id sequence, and each is a subset of the
corresponding reference in the same order. **Fail:** a row missing on one side, or a differing
sequence, named with the ids.

### B7 — version selector

On the two-version title (§5.8): both sides offer a version chooser; it lists the **same
`MediaSourceId` values** in the same order with the same labels; the default selection is the
same. Read the ids from the upstream `<select>` value set and, on the mod side, additionally from
`[data-jfmod-media-source-id]` if `VersionRows` is mounted (that is area E, and its presence is
additive, not a difference).

**Pass:** same media source id list, same order, same default.
**Fail:** a version missing on one side, a different default, or a different order — name the ids
and labels.

---

## 5. Area C — playback parity *(the user's emphasis; most of the runtime)*

Playback is upstream's own code in both UIs (the `video` route is Embed, PHASE7 §2.2), so a
difference here is a shell or bundle defect and is serious. Do not skip this area.

### 5.0 Fixture selection — automatic, from the library, no human input

Pull once: `GET Items?ParentId={moviesView}&Recursive=true&IncludeItemTypes=Movie&
Fields=MediaSources,MediaStreams,Path&Limit=…` (paged). Then select, by predicate, the **first
match sorted by `Id` ascending** so reruns are stable:

| Fixture | Predicate on `MediaSources[0]` / its `MediaStreams` |
| --- | --- |
| `C-4KHDR` | video stream `Width >= 3000` **and** `VideoRange !== 'SDR'` |
| `C-1080` | video stream `Width` in 1800–1999 and `VideoRange === 'SDR'` |
| `C-MULTIAUDIO` | ≥2 streams with `Type === 'Audio'`, preferably different `Language` |
| `C-EMBEDSUB` | ≥1 stream `Type === 'Subtitle'` with `IsExternal === false` |
| `C-EXTSUB` | ≥1 stream `Type === 'Subtitle'` with `IsExternal === true` (the `.srt` sidecar) |
| `C-M2TS` | `Container` matches `m2ts|mts` **or** item `VideoType === 'BluRay'` |
| `C-AVI` | `Container === 'avi'` |
| `C-TVNEXT` | first series with ≥2 episodes in one season, episode 1 |
| `C-TWOVER` | the item with ≥2 `MediaSources`, one ~1080p and one ~720p (§5.8) |

One item may satisfy several predicates; reuse it and say so. If a predicate matches nothing,
**skip that row with an explicit reason** (`SKIPPED: no AVI in the library`) — never substitute a
different file silently. Skipped rows make the run exit 2 unless `JELLYFINMOD_ALLOW_SKIPS=true`.

Print the chosen ids, titles, containers, resolutions and stream indices in the report header.

### 5.1 The per-fixture procedure — identical on both sides

Run the whole sequence on `S`, capture, stop, restore; then the whole sequence on `M`. **Never
interleave** (§1.3). Per side:

1. Snapshot the item's `UserData` (§7) before anything.
2. Navigate to `#/details?id={id}`; click **Play**.
3. Wait for the video element and for the first `POST /Sessions/Playing`. Capture from the
   **request body**: `ItemId`, `MediaSourceId`, `PlayMethod`, `AudioStreamIndex`,
   `SubtitleStreamIndex`, `PlaySessionId`.
4. Capture from the server, immediately: `GET Sessions` filtered to this device id →
   `NowPlayingItem.Id`, `PlayState.PlayMethod`, `PlayState.AudioStreamIndex`,
   `PlayState.SubtitleStreamIndex`, and whether `TranscodingInfo` is present (and its
   `TranscodeReasons`, `IsVideoDirect`, `IsAudioDirect`).
5. Capture the streaming request shape from the network log: a `/Videos/{id}/stream…static=true`
   request means direct play; `master.m3u8` / `main.m3u8` / `hls1/` means a transcode or remux.
6. **Seek:** reveal the OSD (mouse move or a key press), then press `ArrowRight` **10 times** with
   the OSD focused. Read `document.querySelector('video').currentTime` before and after, and the
   `PositionTicks` of the next `POST /Sessions/Playing/Progress`.
7. **Switch audio track** (fixtures with ≥2 audio streams): click `.btnAudio` in the OSD, choose
   the **second** entry in the action sheet, and capture the next `Progress` body's
   `AudioStreamIndex` plus `GET Sessions`' `PlayState.AudioStreamIndex`.
8. **Switch subtitle track:** click `.btnSubtitles`, choose the first non-"Off" entry; capture
   `SubtitleStreamIndex` the same way. Then verify **rendering**: seek into a region with cues and
   assert, within 15 s, either a non-empty `.videoSubtitlesInner` text node **or** a
   `video.textTracks` entry with `mode === 'showing'` and `activeCues.length > 0`. Record which of
   the two mechanisms fired. Then choose **Off** and assert both go away.
9. **Stop:** press `Escape` (or the OSD stop button); wait for `POST /Sessions/Playing/Stopped`
   and capture its `PositionTicks`.
10. **Resume:** reopen `#/details?id={id}`; assert a **Resume** action is offered and the position
    it advertises is within **5 s** of the stopped position. Click Resume; assert the first
    `Sessions/Playing` after it reports a `PositionTicks`/`StartPositionTicks` within 5 s of the
    stored resume point. Stop again.
11. Restore the `UserData` snapshot (§7) before moving to the other side, so each side starts from
    the same state.

### 5.2 Pass/fail rules for area C

Per fixture, comparing the `S` capture with the `M` capture:

| Row | Pass rule | Fail |
| --- | --- | --- |
| C-a start | both produce exactly **one** `Sessions/Playing` with the same `ItemId` and the same `MediaSourceId` | different media source, no play, or more than one session start |
| C-b play method | `PlayMethod` is **equal** on both sides, and the presence/absence of `TranscodingInfo` is equal | one side direct-plays and the other transcodes |
| C-c transcode reason | when both transcode, `TranscodeReasons` sets are equal | different reasons (a different capability was advertised) |
| C-d stream shape | both used the same streaming shape (both `static=true`, or both HLS) | mismatch |
| C-e seek | both advance `currentTime` by the same amount ±2 s for the same key sequence, and both report a `Progress` with the new position | one side does not seek, or does not report |
| C-f audio switch | both end at the **same** `AudioStreamIndex`, and both report it to the server | index differs, the control is missing, or the server is never told |
| C-g subtitle switch | both end at the same `SubtitleStreamIndex`, both report it, **and both render cues by the same mechanism** | index differs, no cues appear on one side, or one renders natively while the other uses the custom layer |
| C-h subtitle off | both return to `SubtitleStreamIndex` null/-1 and both stop rendering cues | cues persist on either side |
| C-i stop and resume | both write a resume point within 5 s of their stopped position; both offer **Resume** on reopen; both resume within 5 s of it | no Resume offered, or a resume point not written |
| C-j single reporting | per play, exactly one `Sessions/Playing` and one `Sessions/Playing/Stopped` on each side | a duplicate — a second reporter would double-count, including into Trakt (PHASE7 §7.1.5) |

`PlayMethod` and `TranscodeReasons` depend on the client's declared capabilities, which is why
this comparison is meaningful: if the mod bundle ships a different device profile, C-b or C-c will
catch it. A shared transcode on both sides is **not** a failure; an asymmetric one is.

### 5.3–5.7 — per-fixture notes

- **`C-4KHDR`:** expect a transcode on a Pi; assert only that both sides agree. Cap the play at
  ≈40 s per side to bound CPU time.
- **`C-M2TS` / `C-AVI`:** these are the containers most likely to expose a capability difference.
  Give them the full sequence including subtitle switching where streams exist.
- **`C-EXTSUB`:** the external `.srt` is fetched as its own request
  (`/Videos/{id}/{sourceId}/Subtitles/…`). Assert the request happened and returned 200 on both
  sides, and that neither side requested it from under `/web-mod/` or `/web/`.
- **`C-TVNEXT`:** play episode 1 to near the end (seek to `runtime - 20 s`), let it end, and record
  what each side does: auto-advance to episode 2, show a "next episode" affordance, or return to
  the detail page. **Pass:** the two sides do the same thing and land on the same item id.

### 5.8 — the two-version title

This is the title that currently holds a 1080p and a 720p version in one folder.

1. Resolve its id: `JELLYFINMOD_PARITY_TWO_VERSION_ID`, or the first Movie whose
   `MediaSources.length >= 2`. If none exists, **skip and say so** — see §8, this is a known
   in-flight defect.
2. On each side: open the detail page, explicitly select **version 1** in the version selector,
   press Play, and capture `MediaSourceId` from `Sessions/Playing`. Stop. Repeat with **version 2**.

**Pass:** on each side the played `MediaSourceId` equals the selected one (not the default), and
the `{selected → played}` mapping is identical between `S` and `M`.
**Fail:** either side plays the default regardless of selection, or the two sides map differently.
Name both media source ids, their resolutions and which side did what.

---

## 6. Areas D, E, F

### Area D — user-data parity

The point is not that each UI can toggle a flag; it is that both write to **one** server and
neither double-reports.

Pick two items: one movie from the B0 sample and one episode. For each, and for each direction
(`S → M` and `M → S`):

| D-row | Action | Assert |
| --- | --- | --- |
| D-1 | Mark **watched** on side X | `GET Items/{id}` shows `UserData.Played === true`; side Y shows it watched **after a normal refresh of side Y** (reload, not a cache clear) |
| D-2 | Mark **unwatched** on side X | reverts on the server and on side Y |
| D-3 | **Favourite** on side X | `UserData.IsFavorite === true`; appears in side Y's Favourites filter (A5) |
| D-4 | **Unfavourite** on side X | reverts on both |
| D-5 | Resume point written by a play on side X (from area C) | side Y's detail page offers Resume at the same position ±5 s |
| D-6 | **No double reporting** | each mark produces exactly **one** `POST` to the played/favourite route from the acting side, and **zero** from the other side |

**Pass:** every row. **Fail:** name the item id, the direction, the expected and observed
`UserData`, and the request count for D-6.

Restore every touched flag (§7).

### Area E — mod-only surfaces are additive, and stock is unchanged

These exist only in the JellyfinMod interface. They are **not** parity failures when absent from
stock — the failure mode is the opposite: a mod surface leaking into, or breaking, stock.

| E-row | Check | Pass rule |
| --- | --- | --- |
| E-1 | File-state marks | present on mod cards for file-less/reclaimed entries; **recorded, not required**, on the stock side (today the fork's stock entry mounts them too — record which) |
| E-2 | Retention countdown | the retention line renders on the mod detail page for an entry with a countdown; stock detail still renders its own actions with no layout break |
| E-3 | Queue | `#/catalog/queue` reachable from the mod user menu and renders; stock reaches it as it does today |
| E-4 | Search-and-add | the mod search shows the Add-from-TMDB zone **and** upstream's own result sections; the upstream sections' id set equals the stock side's for the same query |
| E-5 | Stock unchanged | with the mod tab closed, every area-A row re-checked on the stock side alone gives the same result as in the paired run |
| E-6 | Plugin absent | block `**/JellyfinMod/**` on the mod tab (the runner's `blockPlugin`), reload, and assert the shell renders, the library grid is the native list, and a detail page is usable — UX §14's degradation contract |
| E-7 | No id leak | no request outside `/JellyfinMod/**` carries a catalog entry id or `pending:` — the runner's existing rule, re-applied to **both** tabs |

E-4's id-set equality and E-7 are the two rows that can fail. The rest are presence records.

### Area F — TV layout: record, do not require

The mod shell deliberately falls through to upstream's legacy layout on TV
(`ModAppLayout`: `if (!layoutManager.modern) return <LegacyAppLayout />;`). So TV parity is
**recorded, not asserted**.

Set `localStorage.setItem('layout','tv')`, reload **both** tabs (§1.3), and at 1920×1080 and
1280×720 record, per side: does the app render; is the header the legacy `.skinHeader`; can
`ArrowRight`/`ArrowDown`/`Enter`/`Back` move focus and open a detail page; does a play start.

**Pass rule:** the row passes if **the mod side is no worse than the stock side**. A TV difference
that is the documented fallback is recorded as `EXPECTED-FALLBACK`, not as a failure. A mod side
that renders nothing, or cannot be navigated at all while stock can, **is** a failure.

Restore with `localStorage.removeItem('layout')` and reload both.

### Area G — reachability smoke for the stock-for-now screens

One row, cheap, catches shell routing breakage: on the mod side open `#/music`, `#/livetv`,
`#/books`, `#/playlists`, `#/boxsets`, `#/dashboard` and `#/mypreferencesmenu`. **Pass:** each
renders a non-empty page with no uncaught exception. Feature parity for these is out of scope
(§10).

---

## 7. User-data snapshot and restoration — mandatory

Nothing else in this run writes state, so this is the whole of cleanup, and it must be exact.

**Before touching an item**, snapshot: `GET Items/{itemId}?userId={userId}` → the whole
`UserData` object (`Played`, `PlayCount`, `PlaybackPositionTicks`, `IsFavorite`, `LastPlayedDate`,
`Rating`, `PlayedPercentage`). Keep it in an in-memory map keyed by item id, and **also write it
to `$JELLYFINMOD_PARITY_OUT/userdata-before.json` immediately**, so an aborted run leaves a
restore list on disk.

**Restoring.** Do not guess the route. Discover it once at start-up and record which was used:
prefer the app's own client (`ApiClient.updateUserItemUserData`, or
`ApiClient.markPlayed` / `markUnplayed` / `updateFavoriteStatus`) called through
`page.evaluate`, because it is by definition the route this server version accepts. If a direct
route is needed, read it from `GET /api-docs/openapi.json` on the test server rather than from
memory — the user-data update path moved between server versions.

**Verify the restore.** After restoring, re-read every touched item's `UserData` and assert it
equals the snapshot field by field. Write `$JELLYFINMOD_PARITY_OUT/userdata-after.json`. A
mismatch is reported as a **CLEANUP-FAILED** row with the item id and both values, and makes the
run exit 1 regardless of every other result.

**If the run aborts**, the `finally` block must still attempt the restore and print the remaining
list, exactly as `browser-review.mjs` prints its cleanup list.

**Final hygiene assertions** (PHASE7 decision 6):
- no `JellyfinMod`-prefixed title in any library (`GET Items?searchTerm=JellyfinMod&Recursive=true`
  returns nothing);
- `GET JellyfinMod/Entries?limit=200` holds no entry this run created (this run creates none, so
  the entry id set must be byte-equal to the set read at preflight);
- the `layout` key is back to its pre-run value on both tabs;
- both tabs closed, Chrome left running.

---

## 8. Known gaps at time of writing — do not report these as parity failures

Established from the tree on 2026-09-20 (`jellyfin-mod`, `3c053bc87f`). Each is work in flight.
Record them in the report's **Known gaps** section with whatever was observed, and keep them out
of the failure count.

1. **The mod entry owns no library screen yet.** `MOD_ROUTES` is `[]`; Stage B (S6) is unstarted.
   Home, Movies, TV, search and details on the mod side *are* upstream's screens inside the mod
   shell. Anything that looks like "the mod page is missing a mod feature" is this, not a defect.
2. **The `/web` takeover (S4) is not implemented.** The mod interface lives only at `/web-mod/`.
   `/web` serving stock is the current, correct state — not a failure. Do not attempt the
   takeover, do not write to the web root.
3. **The TV shell is deliberately upstream's legacy layout.** `ModAppLayout` returns
   `LegacyAppLayout` when `layoutManager.modern` is false, and `ModRootLayout` keeps upstream's
   `AppHeader` visible there for exactly that reason. Area F records; it does not require.
4. **The second-version import defect is being fixed by another agent.** If the two-version title
   shows only one media source, or its second version is missing or mis-bound, record it and
   **skip** §5.8 with that reason. Do not file it as a parity failure.
5. **"Stock" here is the fork's stock entry, not vanilla upstream** (§0.1). The Phase 1–6 additive
   mounts are present on both sides today. Their presence on the stock side is expected.
6. **No service worker on either side.** A LAN HTTP origin is not a secure context, so
   `navigator.serviceWorker` is `undefined` for both entries (S3 evidence). Not a difference.
7. **Physical TV devices are not covered.** Desktop TV emulation is not device evidence
   (PLAN definition of done 6).
8. **Phases 4–6 have live checklists still pending.** A retention, queue or automation surface
   behaving oddly is not this run's finding; note it and move on.

---

## 9. Ordering, runtime and what may be sampled

### 9.1 Order — cheapest and most decisive first

| # | Area | Kind | Est. | Gate? |
| --- | --- | --- | --- | --- |
| 0 | Preflight (§1.4) | data | 1 min | **abort on failure** |
| 1 | A1 counts | data | 1 min | **abort on failure** |
| 2 | A2 id sets, A3 seasons/episodes | data + lazy-load | 6 min | record, continue |
| 3 | A4 sorts, A5 filters, A6 collections, A7 non-Latin | UI | 6 min | record, continue |
| 4 | B1–B7 detail, on the §B0 sample | UI | 9 min | record, continue |
| 5 | D user data | mixed | 4 min | record, continue |
| 6 | **C playback**, 7–9 fixtures × 2 sides | UI, heavy | 22 min | record, continue |
| 7 | E mod-only + stock-unchanged | UI | 5 min | record, continue |
| 8 | F TV record, G reachability | UI | 4 min | record, continue |
| 9 | Restore, verify, hygiene, write report | data | 3 min | **exit 1 on cleanup failure** |

**Total ≈ 60 minutes** of automated run time; budget **75 minutes** wall clock and up to
**2 hours** including triage of whatever fails. Only preflight and A1 abort; everything else
records a verdict and continues, so one run yields the whole picture.

### 9.2 `JELLYFINMOD_PARITY_QUICK=true` — the ≈15-minute subset

Preflight, A1, A2, A4 (`SortName` asc only), B0–B1 and B4 on **3** sampled movies, C on
**`C-1080` and `C-MULTIAUDIO` only**, D-1/D-2, E-5, then restore and report. Its summary says
`mode: "quick"` and `fullAcceptance: false`; like the existing runner's quick mode, **it never
counts as acceptance**. Use it to validate the script itself before spending the full hour.

### 9.3 What is sampled rather than exhaustive, and why

| Exhaustive | Sampled |
| --- | --- |
| Movie and Series **id sets** (A2) — cheap, and the user's core question | Detail pages: **12** movies (§B0) — ≈15 s per item per side |
| **All** seasons and episodes of the TV library (A3) — it is small today | Media-info comparison: the same 12 |
| **All** non-Latin titles at the id level (A2), and **3** of them opened (A7/B0) | Playback: **one** item per fixture class (§5.0) |
| Every sort and filter listed in A4/A5 | Sorts: first **60** ids of each order |

If the TV library grows past ~40 series, switch A3 to the same evenly-spaced sampling as B0 and
say so in the report.

---

## 10. Out of scope, and why

- **TV / D-pad layout parity.** The mod shell intentionally falls through to upstream's legacy
  layout on TV (§8.3). Area F records behaviour; it asserts only "no worse than stock". Full TV
  parity belongs to the slice that brings the shell to TV, and to physical-device acceptance.
- **Music, Live TV, books, photos, home videos, playlists, mixed folders.** PHASE7 decision 10
  keeps these as upstream screens inside the mod shell for Phase 7. They are the same code on both
  sides, so feature parity is not a meaningful question; area G asserts only that they are
  reachable and render.
- **Collections** are in scope for **inventory** (A6) because the user asked whether everything is
  still visible, but their screen is upstream's and is not otherwise examined.
- **Physical devices** (webOS, Tizen, mobile apps). Desktop emulation is never device evidence.
- **The `/web` takeover, the Docker image, the archive shape.** S4 and S5 are not built; their
  acceptance is PHASE7's, not this document's.
- **Settings, wizard, Prowlarr** (Stage C, S7–S10): unbuilt.
- **Performance, bundle size, Lighthouse.** Not parity.
- **Pixel comparison of any kind.** Explicitly excluded; two entries with different shells are
  *expected* to differ visually.

---

## 11. Evidence and the report

### 11.1 Files, all under the session scratchpad

```
$JELLYFINMOD_PARITY_OUT/
  parity-report.md        the human-readable report (§11.2)
  parity-summary.json     the machine summary the script prints on stdout
  fixtures.json           the chosen item ids with titles, containers, resolutions, stream indices
  userdata-before.json    written before the first mutation
  userdata-after.json     written after restoration, with the verification result
  network/<row>.json      per failing row: the captured request/response summaries (paths only, never query strings with tokens)
  shots/<row>-{stock,mod}.png   screenshots, captured ONLY for rows that already failed
  console.log             the runner's stdout and stderr
```

### 11.2 The report — one row per checked feature

```markdown
# Parity report — <date>

Instance: <test-host>:28096 · user: oleksii · web HEAD: <sha> · plugin: <version>
Bundle: <bundleId> (<webCommit>) · host: <hostVersion> · mode: full | quick
Sample: 12 movies, N series · fixtures: see fixtures.json

| # | Area | Feature | Stock (/web) | Mod (/web-mod) | Verdict |
|---|------|---------|--------------|----------------|---------|
| A2 | Inventory | Movies id set | 187 ids | 187 ids | PASS |
| A7 | Inventory | Cyrillic titles render | 4/4 NFC-equal | 4/4 NFC-equal | PASS |
| C-f | Playback | Audio switch, C-MULTIAUDIO | idx 1 → 2, reported | idx 1 → 2, reported | PASS |
| C-b | Playback | Play method, C-AVI | DirectStream | Transcode | **FAIL** |
...

## Failures
### C-b — play method differs on C-AVI
item id: 3f2a… "…"  media source: 9b1c…
stock: #/details?id=3f2a… → PlayMethod DirectStream, no TranscodingInfo
mod:   /web-mod/#/details?id=3f2a… → PlayMethod Transcode, TranscodeReasons [VideoCodecNotSupported]
evidence: network/C-b.json, shots/C-b-{stock,mod}.png

## Skipped
C-AVI subtitle switch — no subtitle stream on the selected file

## Known gaps observed (not failures)
see PARITY.md §8

## Cleanup
12 items touched, 12 restored and verified — userdata-after.json
no JellyfinMod-prefixed title in any library; entry id set unchanged
```

Verdicts are exactly one of: `PASS`, `FAIL`, `SKIPPED`, `SHARED-GAP`, `EXPECTED-FALLBACK`,
`RECORDED`, `CLEANUP-FAILED`.

### 11.3 The overall verdict

**The run passes** when: preflight and A1 passed; every `FAIL` count is zero; cleanup verified;
and either no row was skipped or every skip is listed with a reason that §8 or §5.0 sanctions.
`SHARED-GAP`, `EXPECTED-FALLBACK` and `RECORDED` rows do not fail the run but must all appear in
the report.

**Say what was not proven.** A passing run proves parity for the sampled items, the fixtures
chosen, desktop and mobile, on this instance, at this bundle id. It does not prove Stage B parity
(unbuilt), TV parity, device parity, or anything about `/web` after a takeover.

---

## 12. Decide before the run

The executor must not resolve these alone; get an answer first.

1. **Which instance, and is it free?** `/web-mod` was verified on the acceptance instance; the
   runner accepts 18096 and 28096. Confirm which one carries the current bundle and that no other
   agent is using it or the CDP Chrome on 9223 for the ~75 minutes this needs.
2. **Is real playback of the production Movies mount acceptable now?** It reads real files and
   will start transcodes on the Pi. Confirm the timing.
3. **May this run set and revert watched flags, favourites and resume points on `oleksii`?** They
   are restored and verified, but an aborted run leaves the list in `userdata-before.json` for
   manual restoration.
4. **Is the Trakt plugin installed and authorised for `oleksii` on the test instance?** If it is,
   playing real movies **writes to the user's real Trakt history**, and that is **not revertible
   by this run** (PHASE7 §7.1.1). Either confirm it is absent/unconfigured there, or accept the
   scrobbles, or disable it for the duration.
5. **Is the two-version title's import defect fixed?** If not, §5.8 is skipped (§8.4).
