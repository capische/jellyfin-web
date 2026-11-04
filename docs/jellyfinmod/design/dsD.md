# dsD: native title pages, versions, download block and ratings

**Built, not accepted (2026-11-04).** User-authorized markup port in this worktree. No commit, branch, plugin, dependency,
setting, server or deployed environment changed. Existing partial work was retained and completed.

## What draws the page

`design/TitlePage.tsx` and `Head.tsx` draw the source `ground/art/fade/dhead/poster/col`, `itemName/by/meta`,
`actbar/play/dbtn`, `sect/rowt/rowx/cell/tile/post/capt` and `eps/ep/still/body/acts` for native and catalog-entry movies,
series, seasons, episodes and people. `BrowsePage.tsx` uses the same head and native rows for TMDB movie/show/season/episode
browse. `TitleRow.tsx` is source `sect` on upstream's scroller, so its rows have the arrows and focus walking of every other row (D252).
Live download marks take precedence over old clouds; watched/download bars and countdown/search markers retain their data.
Each caption has three fixed-height lines. Missing or failed lazy images retain their ratio and the source icon.

`TrackField.tsx`, `FileChooser.tsx` and `TrackDropdown.tsx` draw `gpk/seg/cap/val/vlist/vrow`, the source current-entry
check, marks and per-file icons. They change the original selects and dispatch their existing change events. The existing
device preference, viewer-choice guard, source-id filtering, binding-specific Keep/Remove/History and permissions remain.
Video uses video stream facts only, including on a title without a plugin entry; Audio/Subtitles retain their track facts,
roles, extra words and disabled/None states. The original form's hidden state still hides the strip. Narrow strips stack;
long lists scroll, and History consumes Back before the list behind it. Hidden ratings reserves and TV card children are
excluded from the focus manager's stops.

`DlBlock.tsx`/`DownloadBlock.tsx`, `Pending.tsx`/`PendingVersion.tsx`, `StateMark.tsx`, `MediaMarks.tsx`, `HistoryToggle.tsx`
and `FileHistoryPopover.tsx` draw source `dlb`, `pend`, `dm`, marks, `dsc/opn/er` and `hpop` markup. Existing queue projection,
pack-file calculation, polling, permissions, cancel/removal dialogs and import handoff remain. The current pack episode stays
identified by the file-N-of-M line and data attribute. Downloading has figures only on screen and its state in the accessible label.
Pending inside a list under 24em keeps D236's three lines. Series totals, retention exceptions, history and Trakt status retain
real data through source `dline`, `tags`, disclosures and `trakt` components.

`Ratings.tsx` paints `rgwrap/rgroup/ritem/rmenu/rrow` through the existing RatingsGroup reserve, scale, source preference,
late-answer/focus and Back logic. Stale cues and accessible provenance remain. `RatingsPreferencesPage.tsx` draws source
`pcol/ptitle/sect2/scard/srow2/tilei/tx/ctl/sw/fld` and saves through the same preference hooks. Its reset and service-error
states remain. Theme and layout markers update from the actual app without a reload.

## Existing controllers and commands

The legacy template is a **hidden controller host**, outside the painted `.jfds`. Its IDs, custom Played/Favourite buttons,
selects, item containers, native list loaders and metadata renderers remain. `titleModel.ts` reads their existing output;
it does not draw their elements. Stable slots keep controller portals alive across phone/desktop head restructuring.
`itemDetails/index.js` has a small dispatch adapter to its existing Play/Replay/Trailer/Shuffle/Download/More functions.
Play still reads `getPlayOptions` and calls playbackManager. New native card discs send the original shortcut Play command;
card hover/focus still triggers the existing release lookup. More receives the visible opener. Its mod additions, deletion
warning and deletion return still match the same item and permissions. `playedBadge.ts` still calculates/refreshes the badge.
`playbackStart.ts` retains its black screen, spinner, result/rejection and start/error/cancel/stop/navigation cleanup.

The invisible Page/view-manager/shell wrappers and legacy controller host remain. Specialized editors, recording dialogs,
release-picker content and unsupported native detail types retain their own upstream/custom content; the shared menu/dialog
API uses dsC where applicable. Dashboard, mod admin settings and setup wizard are unchanged.

The mockup has no complete fixture for chapter playback, specials/additional parts/collections, original titles, taglines,
metadata/tag links, series air time, extra secondary facts, recording command variants, binding-specific removal refusals,
locked Keep reasons, download failures, health outages, reset preferences or missing data. Existing commands and data remain:
extra card sections use the source cells, extra text uses source overview/tags/links/disclosures, and specialized dialogs
keep their existing controller. No sample recommendations, cast, dates or external ratings are fabricated. Discovery and
file-less children show only the ratings their current responses actually provide.

## Complete CSS delta for dsD

The three copied source stylesheets are **unchanged** in this slice. All source values/class names remain, with `.jfds`
Sass import scoping and the previous [dsA](dsA.md), [dsB](dsB.md) and [dsC](dsC.md) selector/keyframe/font/fallback adapters.
Every additional rule below is in `design/_runtime.scss`; these are the entire dsD rule inventory.

| Selectors | Rule and reason |
| --- | --- |
| `.page.jfmod-dsTitle`; `.jfmod-legacyDs .page.jfmod-dsTitle`; `.layout-tv` variant | Override upstream host padding only: 0 for modern, existing bar reserves 3.226em/3.85em for legacy. `!important` only beats upstream host padding. |
| `.jfmod-dsTitle > :not(.jfmod-dsTitleHost):not(.jfmod-entryDetailsRoot)`; `.jfmod-dsTitle > .jfmod-entryDetailsRoot` | `display:none` for the private template/controller host, not a restyled page. |
| `.jfmod-dsTitle .ground`; `.layout-tv` variant | Existing shell renders the bar separately: matching negative margin/top padding 3.226em/3.85em puts the art under it. |
| `.titlefoot` | Source inline page-foot padding 2.618em becomes a class. |
| `.stillimage > img`; `.stillimage .fallback` | Absolute full-size lazy still with inherited corners; centered source 2em fallback, inside the existing 16:9 box. |
| `.ep .ib` | Real buttons inherit font/ink and remove native border/background; source action geometry remains. |
| `.rb`, `.dsc`; `.dsc` padding | Real buttons inherit font and lose browser border/padding/background; disclosure restores source .382em/.618em padding. The older generic `.rb` font reset is consolidated here. |
| `.seg:focus`, `.vrow:focus`, `.dsc:focus`; `.vrow:focus`, `.dsc:focus` shadow | Source classes/rings replace native outlines; row/disclosure keyboard focus uses source .236em primary inner ring. |
| `.trackextra` | Preserve existing extra track words/range/removal-date lines: full flex line, source .854em and .7 secondary opacity. |
| `.packdots`; `.packdots i` | Dynamic per-episode dots remain together and do not shrink. Their dimensions/fills are source rules. |
| `.historyportal` | Real anchor uses fixed positioning, 80% height cap and vertical scrolling so long histories stay reachable. |
| `.meta .jfmod-ratingsMount` | `display:contents` passes the existing controller mount through to the source metadata layout. |
| `.jfmod-ratings-hideStar > .star`; `.jfmod-ratings-hideCritic > .critic` | Existing ratings decision hides the corresponding source fallback score. |
| `.pend.narrow` and every descendant below | D236 survivor, copied from the former pending guide/CSS: relative, top-aligned, padding-right 0/left .374em. |
| `.pend.narrow > .dm` | Existing scaled ring: top .681em, right .365em, font .6472em. |
| `.pend.narrow .l1`; `.pend.narrow .l1 > .r` | Wrap/align the first line; height/min-height 2.5em, right clearance 2em, pitch 1.2; quality flex 0 1 auto, margin-right 0 and normal whitespace. |
| `.pend.narrow .marks`; `::before` | Existing whole-mark dropping: flex 1 1 0, wrapping/top alignment, min-width 0, .72em height, .615em left gap, hidden extra line; .72em alignment pseudo-element. |
| `.pend.narrow .sz2`; `.pend.narrow .l2` | Size right gap .382em; state block with -.382em top/.382em right, visible overflow and normal wrapping. |
| `.pend.narrow .dlf`, `.flag`; `.pend.narrow .flag` | Separate state/flag blocks; flag static with zero left margin. Its leading dot is omitted by the component. |
| `.pend.narrow > .rb` | Existing X placement: absolute .35em top, right 0. |
| `.dev-phone .pend.narrow > .dm`, `.l1`, `> .rb` | Existing phone exceptions: ring top .899em; first line 2.7816em/right clearance 2.5em; X right .25em. |
| `.gpk .vlist` | Existing track-guide 20em scroll cap, including phone and TV; final entry remains reachable. |
| `button.sw` | Native rating switches inherit font and remove border/padding. |
| `.jfmod-nativeEntryDetails`, `.jfmod-traktMount`, `.jfmod-ratingsMount` inside `.jfds` | Controller mount names must not override the source component's Noto/Inter choice or smoothing. |
| `.dbtn[aria-pressed=true]`, `.ib[aria-pressed=true]` | Existing real Played/Favourite state keeps source primary ink. |
| `.rgroup[data-ds-reserve-stack]`; descendant `.ritem` | Preserve the existing fallback reserve: inline grid, stand-ins in one grid cell, zero horizontal margins, so the width is the widest rating rather than their sum. Hidden stand-ins never become focus stops. |
| `.ritem[data-ds-stale]`; `.rrow[data-ds-stale] > :not(.jfmod-ratingsHidden)` | Preserve existing .55 stale-value opacity; provenance remains visually hidden through the existing accessibility utility. |
| `.itemName`; `.dev-phone .itemName` inside `.jfds` | Neutralize upstream's ellipsis with normal whitespace/visible overflow/clip text-overflow; outrank upstream `h1.itemName`'s 1.6em phone size with the source's exact 1.618em. |
| `.ep .still` | Visible overflow preserves the surviving focus-ring rule; actual art images retain inherited corners. |

`integration/playbackStart.scss` moves the **unchanged existing** black-overlay keyframes/geometry/z-index/timing out of
the deleted title restyling file: four-edge fixed #000, below the existing spinner, .236s/.146s delay/source easing,
TV .146s duration, reduced motion none. It has no mockup equivalent and preserves behavior rather than a new design.
No color-mix/inset/aspect-ratio/flex-gap dependency is added for TV; existing capability-gated solid fallbacks remain.

Deleted replaced files: `titlePages.scss`, `pickerChrome.scss`, `entryDetails.scss`, `downloadBlock.scss`, `fileChooser.scss`,
`fileHistory.scss`, `pendingVersion.scss`, `seasonTotal.scss`, `ratingsPreferences.scss`, `traktIndicator.scss`, `playedBadge.scss`
and the obsolete `titleEpisodeRows.ts` presentation mirror. Stale imports, queue-line styles and dead picker/history exclusions
in shared/motion chrome are removed. Remaining card/shared overrides serve other unported surfaces; their content is retained.
LibraryCast and its batched fetch/page-size-0 guard are untouched.

## Runners

Selectors and geometry probes now address painted source elements. Controller-redraw checks still mutate the **original**
controller nodes and inspect their native projection afterward; they never replace React's live children. Permission, action,
choice, order, fallback, focus, import and cleanup assertions remain. Geometry/motion assertions use the approved source
presentation (caption above value; figures-only Downloading accessible label; still importing bar and turning arc).

Changed runners (all in `scripts/jellyfinmod-e2e/`):
`browser-review.mjs`, `card-get-shuffle.mjs`, `card-progress.mjs`, `cloud-no-delay.mjs`, `detail-design.mjs`, `ds-c.mjs`,
`episode-retention.mjs`, `full-episode-list.mjs`, `home-hero.mjs`, `import-delay.mjs`, `live-play.mjs`, `missing-as-media.mjs`,
`missing-seasons-episodes.mjs`, `p9-design.mjs`, `p9-ratings.mjs`, `parity.mjs`, `picker-added-row.mjs`, `picker-compare.mjs`,
`placeholder-backfill.mjs`, `placeholder-queues.mjs`, `placeholder-titles.mjs`, `q16-trakt.mjs`, `quality-profiles.mjs`,
`queue-d6.mjs`, `queue-remove-delete.mjs`, `queue-remove-dialog.mjs`, `queued-state.mjs`, `replacement-sweep.mjs`, `s11-fresh.mjs`,
`takeover-off.mjs`, `tv-shell.mjs`, `v1-browser.mjs`, `v1-browser48.mjs`. Added: `ds-d.mjs`.

## Validation

The offline dsD runner uses the real template, upstream library CSS, native React components, focus manager, and the original
legacy Play/More/shortcut command functions; only data/service boundaries are substituted. Network requests are blocked and
no server starts. It compares sampled source head/pill/picker styles against the untouched source CSS in dark/light at
computer 1440, tablet 768, phones 320/375/390/414, and TV 1280/1920. It exercises native selects, preferred/viewer choices,
binding actions, fallback ratios, persistent slots/live environment, phone-list scrolling, real ratings reserve/stale/provenance/
held-focus/Back and every playback-start cleanup path. dsC covers shared menus/dialogs and the admin boundary.

Passed: `npx tsc --noEmit -p .`, ESLint on all changed TS/TSX, stylelint on all changed SCSS, runner syntax and diff whitespace
checks, plus the offline dsD and dsC browser suites. Extra ESLint on changed JS reports only four pre-existing warnings in the
legacy detail controller (two FIXME comments and two alphabetical-sort warnings); no new JS warning/error remains. Temporary
computer/phone/TV screenshots were visually inspected and removed. Live API round trips, real media playback,
acquisition, server-backed runner execution, physical LG webOS navigation/performance and deployed visual acceptance remain
unrun: this task explicitly forbids changing or using other environments for acceptance. Current-response rating limits above
also remain. This is a built slice, not a live acceptance claim.
