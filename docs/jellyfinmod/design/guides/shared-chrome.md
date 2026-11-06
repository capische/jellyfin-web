# Shared chrome

**Status — D281, approved by the user, 2026-11-06; implemented, live acceptance pending:** Series and Season Played actions
reuse `components/confirm/confirm` → `design/Dialogs.tsx`, the same confirm used by Remove/Replace. Existing
`dialog` / `dlghead` / `dlgbody` / `dlgfoot` markup, paper, sizes, motion and focus lifecycle remain. Cancel is the secondary
first button and starts focused on TV, as the Remove dialog's safe choice does; computers retain the shared confirm's focus.
The primary last button is **Mark Played** or **Mark Unplayed**. Cancel, Close, Escape and Back do not run the toggle.
Approved source: workspace `reviews/design-system/ds5.js`, Home states `played-series`, `played-season`, `unplayed-series`.

- Titles: **Mark {Series} Played?** / **Mark {Season name} Played?**, or **Unplayed**.
- Series body: `All {N} episodes in {S} seasons are marked played.` Season body:
  `All {N} episodes of {Series} {Season name} are marked played.` Use `1 episode` / `1 season` for singular counts.
- Unplayed bodies end `are marked unplayed, including the ones you have watched.`
- Counts are fetched at activation, never inferred from a visible row or unwatched badge. `GET /Items` with `parentId`,
  `recursive=true`, `includeItemTypes=Episode` and the current user follows the folder operation's recursive episode scope.
  No played-state filter: episodes already played also receive the folder write. Seasons are the distinct `SeasonId`s in
  that set, including specials when present; empty seasons do not count. No limit or page slice is requested.
- Match server `Folder.MarkPlayed`: non-virtual episodes, plus virtual aired episodes only when the user displays missing
  episodes (`locationTypes=Virtual`, `isUnaired=false`, with the date filtered by the server). Real unaired files still count.
  `Folder.MarkUnplayed` visits all recursive episodes, including virtual and unaired ones. These are episode items, not a
  sum of episode index ranges or alternate video files. `GET /Items/{id}` supplies names for sparse title-page command hosts.
- If a metadata/count read fails, still ask with no numeric count: `All episodes of {Series} are marked played.` or
  `All episodes of {Series} {Season name} are marked played.` Apply the same Unplayed ending. Names are escaped as text.
  Repeated activation while counting, confirming or running the original toggle is ignored by that action.

**The player's one bar (ds.t7, 2026-11-06), built, not accepted:** on a computer, tablet or phone the player has one top bar, upstream's video page's own (Back, then SyncPlay and Cast at the right, as the mockup draws it); its title is hidden, as the legacy header's was, because the controls carry it (`.jfmod-osdName`). The legacy header stays hidden there, as upstream hides it in the modern layout: its `/video` exemption from inline hiding drew a second bar under the first (the user's report). The TV keeps the legacy header in the player, its toolbar exempt on `/video`.

**Review fixes (2026-11-04), built, not accepted:** the legacy header's toolbar is exempt from inline hiding on `/video` (the header itself only on the TV since ds.t7), leaving Back, Cast and SyncPlay under the player's existing visibility classes. TV header-tab hiding is limited to `html.jfmod-chrome.layout-tv`. The native seek thumb retains upstream's `show-focus` growth. The player integration mirrors the original `.osdTitle` empty state to `.jfmod-empty` on its container, replacing `:has()` for older Safari/webOS without changing playback.

**dsF sweep (2026-11-04), built, not accepted:** dialogs are top-aligned as in the mockup (`dscrim`), not centred, so a picker does not jump when results arrive. Focus rings are for keys and the TV, not clicks. The player and Preferences own their markup: see [dsF.md](../dsF.md).
Confirms and alerts sit vertically centred on computers and tablets; growing dialogs stay top-aligned, and phone/TV keep their layouts (user, 2026-11-06).

**dsD (2026-11-04), built, not accepted:** title/picker restyling and obsolete file-history/picker exclusions are
removed; source markup owns those surfaces. Shared chrome still serves unported custom screens. Dashboard, mod admin settings
and wizard retain their current markup/presentation. [Removed files and complete scope](../dsD.md).

**dsC (2026-11-04), built, not accepted:** shared action sheets, confirmations/prompts, removal and retention-window dialogs, fields, switches, buttons and spinner now draw native design components. Their replaced rd2 overrides are removed/excluded; custom page/dialog content and admin keep the existing rules. [Complete scope, CSS delta and verification](../dsC.md).

**dsB (2026-11-04), built, not accepted:** Home, Search, TMDB browse and sign-in now own their mockup markup under `.jfds`. Their replaced restyling is removed. Native controls reuse the source CSS; lifecycle/command hosts and unmodeled actions remain. [Full scope, CSS inventory and validation](../dsB.md).

**dsA (2026-11-04), built, not accepted:** Ported bar/cards/library controls use `.jfds` on their own roots and portals, with copied mockup CSS in `design/`. The older `html.jfmod-chrome` rules below still serve the out-of-slice surfaces. Admin Dashboard and mod settings/setup remain excluded. [Complete scope and CSS exceptions](../dsA.md).

**Status:** approved redesign D212–D231, D251, D254, D259/D262; rd2 built, not accepted. Rulebook sections 1–9 and Departures.

`src/apps/modern/features/jellyfinmod/shell/sharedChrome.scss`, `chromeFont.scss`, `motionChrome.scss`, `ChromeTheme.tsx` and
`useChromeScope.ts` provide the shared presentation. The root `html.jfmod-chrome` marker exists only inside the signed-in mod
app layout, outside `/catalog/settings` (including setup); Dashboard, server wizard and public screens never acquire it.
This also scopes body portals. The marker and observers are removed on leaving the layout or entering an excluded route.

- Base 1em: Noto Sans, bundled real 400/600/700 under the isolated `jfmod-noto` family. Inter stays on dense controls and dialogs;
  release names stay monospace. Body pitch 1.618; row headings 1.618em/400; page titles 1.618em/600; hero 2.618em/600 (phone 1.618em).
- Paper and ink read upstream theme tokens; dark defaults #202020 and white, light #e8e8e8 and black 87%. Primary #00a4dc
  means selection/focus or a form's main action; failure ink #ff7b72 (light #c62828). Sign Out remains neutral.
- Dialogs: paper, 1.618em corners, faint 1px edge, soft shadow (0 by .382em by 1.618em, black 45%). Titles 1.618em/400,
  Inter; existing close controls remain level with them. Footer buttons retain their actions/order and use the button guide.
  Existing specialized dialog content and full-screen layouts stay; the remove dialog keeps full-width outcome buttons.
- Existing settings menu rows: at least 4.236em, .618em by 1em padding, .618em corners; grey 2.618em tiles with .618em corners.
  Existing words and controls are retained; no descriptions, page sections or settings are added in rd2. TV focus is a .236em ring.
  List titles use 600, secondary lines .854em/400 at 1.618 pitch, stills .618em corners.
- Independent on/off controls draw switches: 2.618em by 1.618em, white 1.236em knob centered with .191em offsets; its travel is 1em.
  Off is white 18% (black on light); on primary 38.2% and .09em primary edge. Existing checkbox inputs and whole-line labels still
  toggle them. MUI preferences' independent checkboxes draw the same switch. Multi-select lists, Sources and quality matrices
  keep checkboxes. Disabled 45%; knob .236s, instant on TV/reduced motion.
- MUI tooltips: paper, .618em corners, .854em type, .382s wait, .236s fade; none on phone/TV. Existing accessible names remain.
- Motion easing cubic-bezier(.236,0,0,1): tint .236s, press .146s to .96; menus .382s in/.236s out with .964 scale;
  phone sheets .618s up/.382s down. MUI lifetime timers match the CSS. Legacy dialog animationend/focus/history are preserved.
  TV menus fade .146s, close immediately (1ms lifecycle minimum), focus/knob changes instant. Reduced motion: menu/sheet
  .146s opacity only, other changed transitions instant, spinner stopped with its arc at 55%.

Named exceptions to pure φ powers: upstream root sizes/gutters; 40px targets; half-height radii and centered geometry;
1.236em knob and .854em secondary type; guide caption sizes/tracking; 1px paper hairlines; approved palette/alphas, glass filters,
shadows and easing coordinates; button/press/menu scales and focus widths; the 1ms TV lifecycle minimum. The track guide retains
its .18s desktop stacked-list slide; TV overrides that slide to an instant display change. See the linked button, field, menu,
top-bar, spinner and track guides for their exact values. No backend contract changes.
