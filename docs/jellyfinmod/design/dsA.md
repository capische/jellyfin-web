# dsA: mockup markup foundation

Status: built, not accepted. User-authorized slice, 2026-11-04. No deployment or Jellyfin instance was changed.

The port lives in [design/](../../../src/apps/modern/features/jellyfinmod/design/). The read-only sources are
[ds.js](../../../../reviews/design-system/ds.js), [ds2.js](../../../../reviews/design-system/ds2.js),
[ds3.js](../../../../reviews/design-system/ds3.js), [ds.css](../../../../reviews/design-system/ds.css),
[spinner.css](../../../../reviews/design-system/spinner.css), and [chrome.css](../../../../reviews/tmdb-search-design/mockup/chrome.css).

## Ownership and behavior

- `Root` owns `.jfds`, device/layout classes, `data-theme`, and capability fallback `no-bf`. It observes the app's actual HTML markers and viewport without a reload. Menu portals get the same root.
- `Bar`/`BarSearch` draw `bar`, `tvbar`, `barsearch`, `bic`, `avatar`, and the original SVG paths. Native anchors and focusable controls make the mockup's decorative spans usable. Library links, extra libraries, configured menu links, native Back, Search, SyncPlay, cast, account actions and clock remain available. Existing menu controllers render through `MenuPresentation`; outside this context they still render MUI.
- `Cell` draws `.cell > .tile > .post` and `.capt`, including disc, foot pill, marks and three caption slots. The image is a lazy `img` inside the original ratio box; a missing/failed image uses the mockup icon set. Movies/Shows, their card-bearing tabs, and Favorites use it. It does not convert Home or title-page cards.
- `LibraryItems` and `LibraryToolbar` draw the original grid, alphabet rail, view picker and action pill. Existing library hooks, play/shuffle handlers, sort/view handlers and filter components remain the state/action owners. The phone's existing page commands move into the view menu, because its mockup pill has no paging icons. A library skeleton has the mockup's third skeleton caption line.
- `LibraryCast` retains its batched People read and page-size-0 guard. Every caption slot holds its height; the cast slot stays blank at page size 0. Existing queue projection, import handoff, link permissions, rating values, multi-select and playback-start cleanup remain in their existing owners.
- No backend, plugin, settings, dependency or admin/wizard changes.

## CSS adaptations: complete inventory

Every copied declaration value matches its source. The source copies keep their formatting and class names; stylelint is disabled only in those verbatim copies. Scope is Sass nesting at import in `design.scss`, in the source order chrome → spinner → ds.

1. Document selectors `:root` become `&`; `html…` becomes `&:not(html)…`; leading `.dev-*`/`.layout-*` selectors become `&.dev-*`/`&.layout-*`. This lets the page root carry the source's environment markers. The always-true `:not(html)` preserves the original type specificity on a div: losing it changed the library action pill's vertical margin. No declaration changes.
2. Keyframe names and their references gain `jfds-`, because Sass does not scope keyframe names and a global `spin` must not replace another page's animation.
3. Source font-face URLs are omitted; the already-bundled Noto Sans 400/600/700 (`jfmod-noto`) and Inter fonts supply the same faces. Toolbar furniture, notes, frame/body canvas, specimen walls, tuning controls, simulated slow/reduced-motion controls and historical demo-only mounts are omitted. The real reduced-motion media rules stay.
4. The additional/overriding rules are all in [_runtime.scss](../../../src/apps/modern/features/jellyfinmod/design/_runtime.scss); their complete selector inventory and reasons follow. No other copied CSS values are edited.

| Selectors (inside `.jfds` unless stated) | Reason for runtime rule |
| --- | --- |
| `.jfds`, `&.dev-phone`, `&.layout-tv` | Move the frame's font, pitch, ink, ground and root sizes to the real page root; use bundled font family. |
| `.cell`, `.bar button`, `.tvbar button`, `.pi`, `.disc`, `.mi`, `.rail button` | Remove browser control chrome from semantic/focusable controls; retain inherited font/ink. |
| `.mi` | Full-width real menu buttons, source 1em horizontal padding. |
| `.cell` (text decoration) | Native links must not acquire upstream link decoration. |
| `.post`, `.post::before` | Visible overflow for the hover ring/tooltips; rounded dim above a real image. |
| `.post > img`, `.post > .fallback` | Lazy image covers the stable source ratio box, with inherited corners; source-sized 2em fallback glyph centered in it. |
| `.cell:focus` | The source poster ring replaces the browser outline on the cell box. |
| `.rowx`, `.grid.itemsContainer` | Native scrolling rows and block grids must outrank upstream ItemsContainer's flex/margin rules. |
| `.ds-rowframe`, `.ds-rowframe .rowx`, `&.dev-phone .ds-rowframe` | Existing row scroller keeps its controller; source cell padding leaves room for the ring. Remove duplicated slider margin and preserve phone gutter. |
| `.capt .ln` | Fixed source line pitch even when empty, including no cast/page size 0. |
| `.barsearch input`, `.barsearch input::placeholder`, `.barsearch.typed::after` | Real input inherits the sketch's typography/chrome; native caret replaces the simulated caret. |
| `.bar .nav a`, `.bar .name`, `.bar .menu`, `.bar .avatar`, `.tvbar button` | Native link/button wrappers retain the source bar's ink, icon display and avatar fill. |
| `.bar [tabindex]:focus`, `.gpill:focus`, `.rail button:focus`, TV variants including `.tvbar button:focus` | Map real focus to source primary rings, .135em keyboard/.236em TV; box shadows follow corners on webOS. |
| `.libhead > .viewpicker`, `.menuhost` | Real open menus need their original control as the positioning anchor. |
| `.pmenu`, `&.dev-phone .pmenu.sheet`, `.sdim` | Long real menus scroll; phone sheet and scrim are fixed to the viewport, capped at 80vh. This deliberately overrides the mockup's `overflow:hidden` so the last entry is reachable. |
| `.rail button` | Full-width semantic button around each original rail span. |
| `.pi[aria-pressed='true']` | Reflect real Played/Favorite state using source primary ink. |
| `.glassy`, its `@supports` variant, `&[data-theme='dark'].layout-tv .plain .glassy` | Rulebook solid fallback until both capabilities exist; reuse source glass values and TV plain-page paper. Root `no-bf` also activates the copied fallback selectors. |
| `.post > .disc/.mark/.cmark/.hmenu/.pill2/.prog` | Keep overlays above lazy art and the dim. |
| `.pill2 ~ .mark`, `.pill2 ~ .cmark` | Source 2.1em corner offset keeps count/tick and file/download mark separate. |
| `.ds-downloading .post > .mark:not([data-ds-download])`, `.ds-downloading .post > .prog:not([data-ds-progress])` | Queue state replaces cloud/search mark; watched progress remains above a simultaneous download bar. |
| `.bar.glassbar`, `.barsearch`, their dark/light `@supports` variants and hover variants | Solid-paper fallback; restore the exact source glass/search recipes only when supported. |
| `&.menuportal`, `&.menuportal .pmenu` | Use the existing app modal stacking level; the anchor calculation already includes source .382em separation. |
| `.pmenu .mi:focus`, `.tx0 small` | Map real keyboard focus and dynamic secondary menu text to source row ring/type/opacity. |
| `.dm.card` | Remove upstream `.card` paint containment from the mockup download mark's own `card` size class. |
| `.jfmod-dsLegacyBar`, `.layout-tv .jfmod-dsLegacyBar` (host rules) | Mount the bar in the existing legacy header slot, fixed on computer/phone and scrolling with TV. |
| `.jfmod-libraryGridPage`, `.jfmod-legacyDs .jfmod-libraryGridPage`, its TV variant (host rules) | Modern shell already reserves its bar height; legacy pages reserve the source 3.226em/3.85em themselves. |
| `.jfmod-dsAppBar.MuiAppBar-root` (host rule) | Existing layout container supplies positioning only, with no second fill/shadow around the native bar. |
| `.cb`, `.cb input`, `.sw input` | Transparent real inputs sit over the original checkbox/switch artwork and keep label, keyboard and change behavior. |
| media query `max-width:1365px` → `.bar .name` | Port source page.js's `bar-noname` behavior to the real viewport. |
| `.jfds.barroot`, `&:not(.onart) .bar:not(.glassbar)`, `&.onart .bar/.tvbar`, `&.onart::before` | A separately positioned bar needs transparent root, plain ground under an unscrolled plain bar, and the rulebook's existing white ink/top fade over art. The mockup's transparent plain bar is otherwise over an opaque frame; the visible result is the same. |
| `.menuhost > .pmenu` | Keep real action menus aligned to their anchor's right edge. |

The old top-bar restyling files and their mount are removed. `cardDesign.scss` loses the replaced library-grid/caption rules; its remaining rules still serve the out-of-slice Home/title/search cards. Other rd2/rd3 rules remain for surfaces not ported here.

## Upstream markup retained

The shell's Page/AppBody/OffsetAppBar wrappers, hidden legacy header infrastructure, phone library drawer, scrolling controller and command container retain their lifecycle. They do not supply the new poster/bar appearance. Saved List view, specialized Suggestions/Genres/Upcoming content and creation/queue toolbars retain their upstream markup/actions; the mockup has no complete equivalent for these. The card adapter inside those specialized tabs still draws `Cell`. Existing More action sheets/dialogs retain their command renderer; this slice does not port the full action-sheet system. Extra Favorite media kinds, image options, permission-dependent menu commands, cast targets and SyncPlay groups remain accessible. No fields/options were removed to match the fixture's sample data.

## Validation and limits

- Passed: `npx tsc --noEmit -p .`, stylelint on changed SCSS, ESLint on changed TS/TSX, all 17 runner syntax checks and diff whitespace checks.
- Local headless browser contracts use the actual ported components with data/service boundaries substituted, plus the read-only mockup server. They exercise lazy/fallback ratios, three slots, Played/Favorite/Get delegation, row scrolling, real library play/shuffle/sort/filter/view handlers, live device/theme updates, D-pad menu containment/Back, and last-row phone sheet access.
- Compared widths/heights, four paddings, type size/weight, ink, fill, radius and backdrop filter at computer 1280/1440, tablet 768, phone 390, TV 1280/1920 in dark and light. Card/control differences are within 1px. Explained differences: plain fixed-bar background above; total phone grid height with 14 fixture cards versus 16 mockup cards. This is component parity, not server acceptance.
- [ds-parity.mjs](../../../scripts/jellyfinmod-e2e/ds-parity.mjs) accepts two URLs and selectors, optional `DS_CDP`, `DS_WIDTH`, `DS_HEIGHT`; exits 1 for differences, ignores pixel differences at most 1px. No files are written.
- Runners updated: browser-review, card-get-shuffle, card-progress, cloud-no-delay, home-hero, import-delay, live-queue, missing-as-media, p9-ratings, parity, placeholder-titles, queued-state, replacement-sweep, tv-shell, upgrade-sessions, whole-review-web. Changes accept native Cell/bar/menu selectors while retaining behavior assertions; `ds-parity` is new.
- Not run: server-backed runner suites, real playback/picker acquisition, physical LG webOS acceptance, deployed-app parity. The user's scope forbids touching other servers/environments. Home, detail pages, picker, Queue, player and Preferences remain future slices.
