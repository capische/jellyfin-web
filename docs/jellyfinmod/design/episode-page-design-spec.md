# Episode and movie detail page redesign — accepted design, 2026-10-07

Agreed with the user on 2026-10-07 after five rejected alternatives and seven mockup revisions.
The mockup page is `episode-page-redesign.html` beside this file (self-contained HTML). Both are the
design record of the **0.1.0.0 detail page design fix** (user, 2026-10-07): a fix of the released
page, framed like the settings design fix, not a phase. Branch `fix/detail-page-design` in both
repositories; commits use the whole-review scope (`fix(detail,wr)`, `feat(plugin,wr)`,
`test(detail,wr)`, `docs(detail,wr)`). The page as built is described in [UX.md](../UX.md) §7, §7.2,
§8 and §11; the implementation choices the spec left open and the acceptance evidence are at the
end of this file.

Applies to the native detail page of an episode and of a movie (the page `NativeEntryDetails.tsx`
mounts into), and to the mod's file-less page (`EntryDetails.tsx`) for step 5. Series pages are
unchanged.

## Step 1 — "Get a release" icon in the stock header row

- One button inserted into upstream's `.mainDetailButtons` row, immediately before
  `.btnUserRating` (Favorite). Administrators only (release search is admin-only today).
- It is a stock-styled button: `button-flat detailButton` with a `detailButton-content` holding a
  `material-icons detailButton-icon` of `cloud_download`. Icon only, no label, `title="Get a release"`.
  Nothing mod-styled; it must be indistinguishable from Play / Played / Favorite in size, padding,
  hover and TV focus. On TV add `show-focus` the way `raisedButtonClass` does.
- Click opens the release picker (`openReleasePicker`) for this episode or movie; with an existing
  file use the `addVersion` intent (same as today's Get another quality), with no file the plain
  search intent. Focus returns to the button when the picker closes.
- With no file, Play and Played are absent, so the new icon leads the row.
- DOM insert only (same technique as `versionsMount`): no upstream file edits. Record it in UX.md as
  the second Principle 0 exception (first mod control inside a stock container), with a parity check
  on every upstream merge.

## Step 2 — the Video row becomes the file chooser (two or more files)

- When the item has two or more media sources, the stock "Video" value (the text upstream renders
  when the video-stream select has one option) gains a chevron and becomes a toggle. Clicking it
  slides a list down (height transition, `prefers-reduced-motion` honoured) and clicking a row
  selects that file and slides it back.
- Row format, left to right: selection mark (● / ○ in primary `#00a4dc`), resolution in bold
  (`2160p`), details in secondary text (`HEVC 10-bit · DTS-HD 7.1 · 24.1 GB`, from `describeVersion`),
  a `DEFAULT` outlined chip on Jellyfin's default copy, then three small icons at the row end:
  `history` (opens the per-file history popover, step 3), `push_pin` (per-file Keep toggle;
  filled/primary when kept), `close` (Remove this version with the existing stock confirmation).
  Icons at about 60% opacity until hovered or focused on desktop; always visible on TV, each its own
  D-pad stop. Pin and cross are administrator-only; history shows to everyone.
- A row whose file has a scheduled removal appends it to the details: `· removes 12 Oct`.
  "not tracked yet" and a multi-episode range (`S01E01-E02`) stay as today.
- The last row is `+ Get another quality` (administrators with release search), opening the picker
  with the `addVersion` intent.
- The chooser drives the stock `.selectSource` exactly as `VersionRows` does today (set value,
  dispatch bubbling `change`, respect the viewer's own choice, device preference from V1 decision 4),
  so Play, audio and subtitles follow the selected file. Upstream's own Version select row
  (`.selectSourceContainer`) is HIDDEN while the chooser is mounted (user decision 2026-10-07; a
  Principle 0 exception of the §7.3 kind): it stays in the DOM and keeps working, hidden by a
  mod class on the mount's presence only, so it reappears if the chooser does not mount.
- Files with more than one video stream are rare: in that case upstream's video-stream select stays
  visible under the chooser trigger; do not try to merge them.
- One file: no chooser. The Video row stays as upstream renders it; the same three icons
  (history, pin, cross) sit at the end of the row, after the text, with the same visibility rules.
  The Keep follows the file (per-file Keep, PHASE10 Q3) when the plugin reports `versions.keep`;
  where only the entry/episode Keep exists, the pin toggles that.
- No file: no Video/Audio/Subtitles block exists; see step 5.

## Step 3 — history per file, in a popover

- The `history` icon opens a small MUI popover (so §13 rule 9 applies: Back closes it, focus returns
  to the icon) titled with the file's short description (`1080p · HEVC 10-bit · 783 MB`), listing
  only that file's events, newest first, short dates (`28 Sep`, `28 Sep 2025` when not this year),
  action words without the file name: Grabbed (indexer, size), Imported (release group / source),
  Kept, Stopped keeping, Removed.
- Plugin change: `HistoryRecord` gains a nullable `bindingId` (the file's binding) set on every event
  that concerns one file: grab once bound, import, keep file, unkeep file, remove version, retention
  reclaim of that file. Existing rows without one are not shown in any file popover. Expose it on the
  entry detail API; migration as the plugin's conventions require.
- Episode-level events (monitoring changed, added to catalog, window changed) are DROPPED from the
  episode page (user decision 2026-10-07). The old History toggle and list on the episode and movie
  pages go away. The series page keeps whatever it shows today.

## Step 4 — the Played tick wears a countdown badge

- When the episode or movie has a scheduled removal (the plugin's retention warning / `reclaimAt`),
  a small badge appears over the stock Played button's icon: a bare bold number, no pill, no fill,
  positioned over the tick's lower-right arm (roughly `right: 0.8em; bottom: 0.85em` of the
  button's content box in the mockup; tune on the real page), white, about 0.6em, with a soft
  text-shadow in the ground colour (`#101010`) so it reads over the red played tick.
- Values: the number of whole days until the deadline (`5`), `0` on the day, `!` when overdue
  (deadline passed; the file goes at the next retention run), `∞` in primary `#00a4dc` when the
  file is kept. Computed from the absolute deadline the plugin returns; never cached as a count.
- The icon is untouched and keeps its 1.6em size; the button is exactly as big as its neighbours.
- Implementation: one `span` inserted inside the stock `btnPlaystate` button as the second child of
  its `.detailButton-content`, absolutely positioned relative to that box. The stock element only
  touches the icon's classes and the title, so the span survives played toggles. The stock click is
  unchanged. If the markup is not found the badge is simply absent.
- Tooltip on the badge (its own `title`): "Removed on 12 Oct unless kept · marked played" using the
  warning's cause text. Everyone sees the badge (RET2-R10: every viewer sees the date).
- The badge is read-only. Keep lives on the pin only (user decision 2026-10-07). The retention
  warning box (`RetentionWarning`) is REMOVED from the episode and movie pages; the series page keeps
  its per-episode retention list.
- Several files with different dates: the badge shows the nearest; each chooser row shows its own.

## Step 5 — no file: the track block becomes "Get a release"

- A file-less episode or movie has no Jellyfin item, so it is the mod's file-less page
  (`EntryDetails.tsx`). It already mirrors the stock layout. Its current button row goes away;
  where `.trackSelections` would be it renders one raised stock button
  (`emby-button raised button-submit`, `cloud_download` icon + "Get a release"), administrators only.
  The step 1 header icon is also present on this page.
- While a grab or download is in flight the existing `QueueStatusLine` takes the raised button's
  place until the file lands.
- Non-administrators see the overview and, during a download, the status line; no button.

## Controls that disappear or move

| Today | In this design |
| --- | --- |
| `Search releases` button | step 1 icon (and the step 5 raised button) |
| `Get another quality` button | last chooser row; with one file the step 1 icon covers it |
| `Keep` / `Keep 1080p` / `Stop keeping` buttons | the pin |
| `Remove 1080p` buttons | the cross |
| History toggle and list | per-file popover |
| Retention warning box | the badge |
| `Automatic removal is off.` line | DROPPED (user, 2026-10-07). Scheduled and kept states are carried by the badge and the row text. Keep a one-line `RetentionStatus` only for `blocked`, `mixed` and the protection reasons, which the badge cannot show |
| `Remove this episode: Series default` window select | Moves into upstream's stock More (`⋯`) menu as an item "Remove after watching…" (administrators only) that opens a small MUI dialog holding the same select (user, 2026-10-07). This re-adds the More-menu hook that P7.S6 removed, but as a runtime wrap of `itemContextMenu.show` from the mod's own integration file, never an edit to upstream's controller; record it in UX.md as a coupling with a parity check, and degrade to no item if the wrap finds nothing to wrap |
| `Search now` (movies, automation) | DROPPED from both detail pages (user, 2026-10-07): the step 1 icon opens the picker, which shows the releases and grabs one; automation searches on its own schedule. The API endpoint stays |
| `QueueStatusLine` on a page with a file | stays where it is |

## Constraints that bind the implementation

- UX.md Principle 0 (nothing upstream removed) with the two recorded exceptions above; Principle 1
  (the 95% case shows nothing); §13 TV rules: no new D-pad rows beyond the chooser's rows, every
  control a stop, `aria-disabled` not `disabled`, no `<details>/<summary>`, MUI pop-ups for anything
  that pops, no `display: contents`, no flex `gap`, no `min()/max()`, `em` units only, `jfmod-`
  classes only, no edits to upstream `.scss` or selectors, values from the base theme.
- Keep the upstream patch surface unchanged: all of this is DOM inserts from the existing
  `nativeEntryDetails.js` integration plus mod components.
- Degrade: a plugin without `versions`, `versions.v1`, `versions.keep`, `versions.remove` or the
  new history field hides the matching surface, never breaks the page.

## Acceptance (live, on 18096, then real Chrome)

Desktop, mobile and TV (1920×1080, `layout=tv`, arrow keys only), each for:
1. Episode with one file: header icon present (admin) and absent (user); Video row with the three
   icons; pin toggles Keep and the plugin shows the file kept; cross removes with the stock
   confirmation; history popover lists only that file's events.
2. Episode with two files: stock Version select hidden; chooser opens and closes; picking a row
   changes `.selectSource` and Play uses that `MediaSourceId`; audio/subtitle selects follow; device
   preference still applies on TV and mobile; Get another quality opens the picker with addVersion.
3. Episode with no file: file-less page shows the raised Get a release button and the header icon;
   both open the picker; during a fake grab the queue line replaces the button.
4. Watched episode with retention scheduled (minute-scale window for the run): badge shows the
   days, `0` on the day, `!` after the deadline, `∞` after keeping via the pin; the warning box is
   gone; the played toggle still works.
5. Movie page: the same four cases where they apply.
6. No "Automatic removal is off." and no "Search now" anywhere; the More menu shows "Remove after watching…" to an admin and nothing extra to a user, and the dialog's select changes the episode window; no fixtures left behind (JellyfinMod titles removed,
   `GET /UserViews` for oleksii shows only Movies and Shows).
Plus `npx tsc --noEmit -p tsconfig.json`, `npx eslint src/apps/modern/features/jellyfinmod --ext .ts,.tsx`,
the plugin suites, and the Playwright runner in `scripts/jellyfinmod-e2e` extended with the above.

## Decisions taken after the spec

- **File-less page's other controls (user, 2026-10-07).** The file-less page's button row also held Monitor, Remove entry,
  Keep and (series only) Refresh metadata. On a file-less movie (or episode) page: Search releases, Search now and Keep
  go; a stock-style More button (`button-flat detailButton`, icon only, `more_vert`, title "More") joins upstream's
  header row next to the Get a release icon, administrators only, and opens an MUI menu holding **Monitor** (a toggle
  that shows its state) and **Remove entry** (upstream's confirmation, since it drops the entry's history). Back closes
  the menu and focus returns to the More button (`shell/dpadModals`). Ordinary users get no More button. File-less
  series pages are unchanged, apart from the two drops that apply to every detail page (no "Automatic removal is
  off.", no Search now).

- **UI rules (user, 2026-10-08), binding on these pages.** (a) Buttons, titles and menu entries use Jellyfin-style
  Title Case; short words (a, an, the, and, but, or, nor, as, at, by, for, from, in, into, of, on, to, via, with) stay
  lowercase unless first or last; descriptions, status text and field labels stay sentence case: "Get a Release", "Get
  Another Quality", "Remove After Watching…", "Remove This Version" / "Remove the Last Copy", "Remove Entry", "Refresh
  Metadata", "Monitor" / "Stop Monitoring", "Keep" / "Stop Keeping". (b) Actions on a list row are round, icon-only
  buttons of at least 2.5em (40px at the 16px desktop root; TV and mobile scale it), with an aria-label naming the row
  ("Keep the 1080p file", "Remove the 2160p file", "History of the 1080p file"), a title tooltip and the TV focus ring;
  grey, red when they destroy (the cross), the pin in primary while kept. This supersedes step 2's "60% opacity until
  hovered". The file-less series page's episode rows get the same round actions (Search Releases, Monitor). (c) Full-size
  buttons are red (destroys), blue (the view's one main action) or grey (the rest): the file-less page's raised "Get a
  Release" and the series pages' "Search Releases" are blue, "Remove Entry" red, the others grey. The labels in the steps
  above are written in the old sentence case; the page uses these rules.

## Implementation choices — proposed, not user-approved (2026-10-07)

The spec is silent on these; each is the smallest additive choice and changes nothing the user
decided. Ask the user before treating any as settled.

1. **Capability names.** The spec's `versions.keep` is the plugin's existing `retention.versionKeep`
   (PHASE10 Q3). The per-file history field is advertised as a new Health capability
   `history.files`; without it the history icon is absent.
2. **Order of work.** E1 plugin `bindingId` on history; E2 header icon; E3 Video-row chooser; E4
   history popover; E5 Played badge; E6 file-less raised button; E7 More-menu item; E8 removal of
   the old controls; E9 runner checks. These are work-order labels only, not plan task ids.
3. **Where the chooser lives.** The chooser renders inside upstream's `.selectVideoContainer`,
   after its select, in a mod mount. When the select has one option (one video stream, nearly
   always), a mod class on that container hides the disabled select's text and arrow while the
   trigger shows the same text (read from the select's selected option) plus the chevron, so the
   row reads as one value. When the select has several options (several video streams), the select
   stays visible and the chooser moves to its own row directly above it, labelled `Version` like the
   stock select it stands in for.
4. **If the track block is hidden** (upstream hides `.trackSelections` when the client cannot play
   the item), the chooser and the row icons are hidden with it; the stock Version select is hidden in
   that case too, so nothing upstream is lost.
5. **Row dates.** Retention runs per movie or per episode (V1 decision 1), so every scheduled,
   unkept file of a target shares one deadline: a row whose version retention is `scheduled` and
   which is not kept appends `· removes <date>` from that target's retention warning.
6. **The pin's target.** With `retention.versionKeep` and a tracked file, the pin is the per-file
   Keep. It also shows filled when the file is kept through its episode's own Keep or the title's
   Keep; clicking it then stops keeping the episode (`Stop keeping`), and a title-level Keep, which
   has no un-Keep route, makes the pin read-only (`aria-disabled`, titled with the reason). Without
   `retention.versionKeep` the pin toggles the episode Keep (episode pages with
   `retention.episodes`) or keeps the movie.
7. **`∞`.** *(Flagged: awaiting the user's ruling at acceptance.)* The badge shows `∞` whenever the page's file is kept and no removal is scheduled, played
   or not.
8. **More-menu item scope.** *(Flagged: awaiting the user's ruling at acceptance.)* "Remove after watching…" appears on episode pages only, where the
   episode window exists today (`retention.episodeControls`, episode not kept by itself); movies have
   no per-title window editor, so their menu is unchanged.
9. **Popover lines.** The plugin's event types give the action word (Grabbed, Imported, Kept,
   Stopped keeping, Removed); the detail is the event summary with the leading verb and any file
   name dropped: the quality and indexer for a grab, the version label and the release group for an
   import. New grabs also carry the release size in their summary (`· 783 MB`); grabs recorded
   before this fix have no size.
10. **Grab events** are written before any file exists; the import that binds the file stamps the
    grab's `bindingId` on that grab's event, so "Grabbed" shows in the file's popover.
11. **"Automatic removal is off." everywhere.** The one-line retention status renders nothing while
    retention is off, on every page that uses it (including the series page's per-episode list),
    so the line is gone from every detail page, as the acceptance list asks.
12. **Search now on the file-less series page** *(Flagged: awaiting the user's ruling at acceptance.)* goes too ("no Search now anywhere"); the rest of
    that page is unchanged.
13. **The raised button's label** is always "Get a release", also for a reclaimed movie (it read
    "Get again" before).
14. **Commits.** The native page's steps (header icon, chooser, popover, badge, More-menu item and
    the removals) change one component together, so they are one commit; the file-less page, the
    plugin field and the runner are separate commits.

## Acceptance checklist and evidence

Status: **built (not accepted)**. Every live item below passed on 18096 in Chromium and real Chrome on 2026-10-08,
except the queue line during a grab (NOT VERIFIED: 18096 has no download client or indexer). Acceptance and the three
flagged choices (implementation choices 7, 8 and 12) are the user's to rule on. Run on 18096 only
(`jellyfinmod-test`), desktop, mobile and TV (1920×1080, `layout=tv`, arrow keys, Enter and Back),
on Playwright's bundled Chromium first and then on real Google Chrome, with a minute-scale
retention window for item 4. The runner is
`scripts/jellyfinmod-e2e/detail-design.mjs`.

| # | Check | Chromium | Chrome |
| --- | --- | --- | --- |
| 1 | Episode, one file: header icon present (admin) and absent (user); Video row with history, pin, cross; pin toggles Keep and the plugin reports the file kept; cross removes with the stock confirmation; history popover lists only that file's events | pass (desktop 116/0, mobile, TV 1080/720; pin read back from the plugin; history = the plugin's events for that file, newest first) | pass |
| 2 | Episode, two files: stock Version select hidden; chooser opens and closes; a row changes `.selectSource` and Play uses that `MediaSourceId`; audio and subtitle selects follow; device preference on TV and mobile; Get another quality opens the picker with `addVersion` | pass (incl. Play's `MediaSourceId`, audio follows, device preference TV/mobile, Get another quality → picker) | pass |
| 3 | Episode, no file: file-less page shows the raised Get a release button and the header icon; both open the picker; during a fake grab the queue line replaces the button | pass, except the queue line: NOT VERIFIED (18096 has no download client or indexer, so no grab can be made) | pass, queue line NOT VERIFIED (same reason) |
| 4 | Watched episode with retention scheduled: badge shows days, `0` on the day, `!` after the deadline, `∞` after keeping via the pin; no warning box; the played toggle still works | pass: `7`, `0`, `!` (and an open page turns `0` into `!` at the deadline without reload), `∞` after the pin in every layout | pass (`7`, `∞`) |
| 5 | Movie page: the same cases where they apply | pass (header icon, row icons, history, More menu unchanged on a movie) | pass |
| 6 | No "Automatic removal is off." and no "Search now"; More menu shows "Remove after watching…" to an admin and nothing extra to a user; the dialog's select changes the episode window; no fixtures left (`GET /UserViews` for oleksii: Movies and Shows only) | pass; UserViews after cleanup and a restart: Movies, Shows | pass |
| 7 | Gates: `npx tsc --noEmit -p tsconfig.json`, feature eslint, stylelint on new scss, plugin build with warnings as errors, plugin suites | pass (see Evidence) | — |

### Evidence

Run 2026-10-08 on 18096 (`jellyfinmod-test`), Chromium 153.0.8010.12 then Google Chrome 153.0.8010.54.

- **Deployed:** plugin DLL from the temporary integration branch `tmp/detailfix-on-phase9` `4bc468d` (Phase 9 `e242a9d`
  + plugin `97e76ea`), sha256 `1193bd07a99cda40…`; web bundle `33d2bdc044c2` (web `b8b1cdb9e4`) for the full passes, then
  the final bundle `2de0648244d8` (web `77b1e78af0`, after the review 2 fixes and the rebase onto `jellyfin-mod`
  `70e790b26c`): desktop and TV 1080, admin and user, one-file, two-file, movie and the window dialog, 153 passed and
  0 failed in Chromium and in Chrome. Health: version 0.1.0.0, `history.files` advertised. Database
  migrations: … `WholeReviewQueueCleanupManifest`, `PhaseNineRatings`, `PhaseNineRatingsIdentity`, `DetailFileHistory`.
  Backup before deploy (plugin folder, XML, secret store, database): `/mnt/4tb/jellyfin-mod/test/build/dd-plug-backup`.
- **Gates:** `npx tsc --noEmit -p tsconfig.json` exit 0; `npx eslint src/apps/modern/features/jellyfinmod --ext .ts,.tsx`
  silent; stylelint silent; "JellyfinMod patch surface: §3.2 matches the 22 upstream file(s) this branch changes."; plugin
  Release build "0 Warning(s) 0 Error(s)"; "No changes have been made to the model since the last migration."; all 13 suites
  `exit=0` on the Pi (`df-run-all.sh`, Phase 5 through `df-run.sh` with the alias mounts).
- **Live, Chromium:** desktop admin + ordinary user 116 passed, 0 failed (pin, window dialog, cross on E04: exactly that
  copy removed, the other kept, the page moved to the remaining copy, which plays); mobile, TV 1080 and TV 720 291 passed
  and 2 failed, both the TV 720 file-less walk, then 32/32 after the walk fix; badges `0` and `!` on desktop, `∞` in every
  layout (72/72). **Real Chrome:** all four layouts, admin + user, 471 passed, 1 failed (the runner: after Play, real Chrome
  plays the fixture and the player covered the page), then 47/47 for that scenario after the runner left the player.
  NOT VERIFIED everywhere: the queue line during a grab (no client on 18096) and the movie's history (a fixture file with
  no events).
- **Product defects found live and fixed (2026-10-08):** on TV the one-file Video row's icons sat at the row's far end,
  where no header button's Down reached them (now the disabled select is as wide as its text and Down from Play lands on
  the history icon); on the file-less page Get a release landed after More and TV focus started on More (now an explicit
  order and the focus effect runs after the inserts; probed by keys at 1920×1080 and 1280×720).
- **Fixtures:** created by `scripts/jellyfinmod-e2e/detail-live.py` and removed by its cleanup. Retention was switched
  on only with every other binding kept per file (534, released afterwards); 36 orphan bindings from older runs had no file
  to delete. After cleanup the two DD libraries' collection folders survived (deleted with `refreshLibrary=false`) and came
  back as views after a restart; they were recreated and deleted with `refreshLibrary=true`, and the cleanup now does
  that. Proof after a restart: `GET /UserViews` for oleksii = Movies, Shows; no `JellyfinMod` items; no disposable user;
  no `dd` folder.
- **Codex (gpt-6.1-sol, high):** review 1 CHANGES REQUESTED (1 P1, 5 P2, 3 P3), all fixed; re-review 1 stopped at the usage
  limit after two findings, both fixed; re-review 2 of `4a3dc1c002..9699443e28` and the plugin diff: CHANGES REQUESTED
  (P1 and three P2 in the fixture tool, P2 in the menu wrap, P2 in the badge clock, P2 and P3 in the runner; no plugin
  finding), all fixed; re-review 3 of that fix delta: every finding confirmed fixed, two left in the fixture tool (P2 a
  404 on releasing a Keep treated as resolved, P3 a failed Keep not retried), both fixed afterwards; re-review 4 of
  `77b1e78af0..6767cec591` (those two fixes and the UI rules of 2026-10-08): both fixture-tool findings confirmed fixed,
  no P1 or P2, four P3 (a fallback pin's accessible name did not name its file; a monitored episode's bookmark turned
  primary; the series page's TV class was read once at module load; the runner's colour and tooltip checks accepted
  wrong values), all fixed; re-review 5 of that delta `6767cec591..121cc632e3`: APPROVE, no findings. Records: the
  session scratchpad `review-detailfix.md`, `review-detailfix-delta1.md` (stopped at the limit), `-delta2.md` to
  `-delta5.md`.

### State at hand-over — 2026-10-08

- **Branches** (not pushed, not merged): web `fix/detail-page-design` on `jellyfin-mod` `70e790b26c`; plugin
  `fix/detail-page-design` `a0ccd77` on `master` `a11d585`. Temporary `tmp/detailfix-on-phase9` `4bc468d` (worktree
  `plugin-tmpdd`) built the DLL now on 18096; never push or merge it; delete it when Phase 9 redeploys.
- **18096** runs that DLL and the web bundle `2de0648244d8`; migrations `PhaseNineRatings`, `PhaseNineRatingsIdentity`,
  `DetailFileHistory`; retention off; no fixtures (views Movies and Shows, checked after a restart); backup
  `/mnt/4tb/jellyfin-mod/test/build/dd-plug-backup` (its database lacks `DetailFileHistory`).
- **UI rules of 2026-10-08** (Title Case, round row actions, button kinds): re-checked live on 18096 (lease held by
  this session, 08 Oct 10:13–10:22 Sydney) with the tmp DLL (sha256 `1193bd07a99cda40…`, re-applying
  `DetailFileHistory`) and bundle `8c17355c3aba` (web `0c23a885e4`): one-file, two-file, movie, file-less, window dialog
  and the cross, desktop, mobile, TV 1080 and 720, admin and user: 378 passed, 0 failed in Chromium and 378 passed,
  0 failed in real Chrome. Row actions 41px on desktop, 40px on mobile, 56px on TV; grey `rgba(255,255,255,0.7)`, cross
  `rgb(198,40,40)`. The first run found that on TV, Down from the Video value landed on the first row's history icon
  (the 2.5em icons stood taller than the row's button); rows now stretch to the icons' height so Down lands on the row.
  Afterwards: fixtures removed, views Movies and Shows after a restart, retention off. 18096 was then handed back to
  Phase 9 with this DLL and bundle in place; `build/dd-plug-backup` holds Phase 9's state from before this deploy
  (migrations ending at `PhaseNineRatingsIdentity`), and the older backup is `build/dd-plug-backup-20261007`.
- **Open:** the queue line during a grab (needs a download client on the instance); a live re-run of the re-review 4
  fixes (fallback pin names, the bookmark's colour, the series page's TV class, the stricter runner checks), which needs
  the 18096 lease (held by Phase 9 when they were made); the user's acceptance and rulings on choices 7, 8 and 12;
  republishing is the user's decision.


