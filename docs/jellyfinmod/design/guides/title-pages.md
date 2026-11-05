# Title pages and art ground

**Review fixes (2026-11-04), built, not accepted:** painted episode rows and title cards forward cancellable remote `command` events with their detail to the original hidden card host, retaining the painted opener for menus. Consumption by upstream is reflected back to the original event so Play/Menu do not fall through to global playback actions. Click/context-menu behavior and approved markup stay unchanged.

**dsF sweep (2026-11-04), built, not accepted:** `by` reads `Directed by` / `Created by`; details are `.tags` lines (`Label: <b>value</b>`), links bold, More from Season below the cast; season and series show the mockup's counts; the phone's row drops Played and the state takes the heart's place; the bar lights the title's library. `renderOverview` selects `p.overview`, because a painted `div.overview` inside the view crashed the controller.

**dsD (2026-11-04): built, not accepted.** The user's native-markup instruction supersedes the earlier rd3 restyling.
Approved source: workspace design-system `head`, `actbar`, `sect`, `cell`, season/episode rows and title pages.
[Complete CSS delta, behavior, retained upstream infrastructure and runner inventory](../dsD.md).

`design/TitlePage.tsx`, `Head.tsx`, `TitleRow.tsx`, `TrackField.tsx`, `DlBlock.tsx`, `Pending.tsx`, `Ratings.tsx` and
`BrowsePage.tsx` own the visible movie, series, season, episode, person and TMDB browse markup under `.jfds`.
They output source elements/classes with the copied source stylesheets nested at import. They do not restyle the legacy template.
The original template remains hidden as the controller's data/select/command host. Upstream and mod data/actions remain owners.
Dashboard, mod settings, wizard and other native detail types retain their existing presentation.

The source head has the poster and one column (27.6% / remainder, 1em gap). Phone: centered poster at 61.8%, title and metadata,
then the action pill and 5% content gutters. The source art ground, static image/filter/fade, Noto title/reading text, Inter dense
controls, white Play, glass pickers and solid TV/capability fallback values are unchanged. Root observes real layout/theme markers
without a reload. A shared upstream heading rule is neutralized so it cannot truncate titles or replace the source phone size.

Real images stay lazy. Missing/failed images retain 2:3 poster or 16:9 still boxes and the source fallback glyph. Corners follow the
source .618em. Native cells hold three caption lines even when empty. Row/still focus and hover rings stay outside the art box;
no card paint containment is introduced. Lists and histories scroll to their final entry.

Actions dispatch the existing controller handlers. Play reads the same original source/audio/subtitle selects and resume mode;
card Play forwards the original shortcut command. Played/Favourite still click their existing custom controls. More carries the
real painted opener and retains mod registrations, deletion warnings/return and permissions. Get a Release uses the same picker.
The existing playback black screen and spinner clean up on every success/error/cancel/rejection/navigation path.

Original titles, taglines, metadata/tag/external links, series air time and secondary facts remain. Native extra card sections keep
their original loaders and commands; missing seasons/episodes keep their ordering and import replacement. Person birth/death/place
facts and their links are read from the existing controller. Chapter playback keeps its position and sort context. A TMDB person
with no native destination remains an inert, reachable person cell. No fixture-only recommendations or ratings are invented.

Versions, tracks, download/pending states, retention badges/disclosures, per-file history, Trakt, Add/Undo and ratings preferences
follow their guides' dsD sections. Earlier `.jfmod-titlePage`/`titlePages.scss` visual measurements are superseded by the source CSS.

Verification uses the offline dsD/dsC browser runners with real components, original controller functions, source styles and blocked
network. Compiler/linter results are recorded with the slice. Server-backed and physical webOS acceptance remain unrun under the
user's environment restriction; this page documents a built slice, not accepted or deployed behavior.

Every row on a title or browse page (`TitleRow.tsx`) sits on upstream's scroller, with the same arrows and focus walking as Home's rows (D252).

**Row arrows (ds.t5, 2026-11-05, the user was told; built, not accepted):** the rows' arrows are the library toolbar's small glass pill and chevrons (`.actbar.static.glassy`, padding 0.236em, buttons 2.618em, 46 px tall at the computer's 14.88 px), not upstream's large buttons. They sit on the row title's line at the row's right edge, centred on the title's text (`top: 2.165em`) and entirely above the posters: 8 px clear at 1440 and 1280, dark and light. A computer only (`dev-computer` with a fine pointer) and only while the row can scroll: tablet, touch and TV have none and scroll by swipe or focus. At either end the arrow that cannot move is dimmed (`.dbtn.off`, 45 %). Home, title, browse, Search and Favorites rows draw the same pill (`emby-scrollbuttons/ScrollButtons.tsx`, `_runtime.scss`). The scroller re-measures when a row's cells change, because Home's skeletons give way to data without the frame changing size.

**Home hero height (ds.t4, 2026-11-05, built, not accepted):** on a computer the height follows the window's width like the mockup's frames: up to 1280 px wide 720 × 0.764 (550), up to 1919 px 900 × 0.618 (556), up to 2559 px 1080 × 0.618 (667), from 2560 px 1440 × 0.618 (890). Phone, tablet and TV use the window's height. Episode stills keep the mockup's `overflow: hidden`, so the image follows the ring's corners.
