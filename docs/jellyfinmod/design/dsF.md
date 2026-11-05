# dsE and dsF: Queue, picker, player and Preferences own their markup

**Built, not accepted (2026-11-04).** Live on bravo (12.0, port 9096). The record of the source is [dsA.md](dsA.md).

## dsE

Queue, release picker, sources, marks, Remove dialog and retention draw the mockup's markup through `design/Queue.tsx`, `ReleasePicker.tsx`, `Release.tsx`, `RemovalDialog.tsx` and `StateMark.tsx`. What each action does is unchanged; `scripts/jellyfinmod-e2e/ds-e.mjs` covers the requests offline.

The quality profile dialog stays in the mod's admin settings, which by rule keep their look. The picker's Quality Profile is the mockup's `fld`.

## dsF

**Player.** `playback/video/index.html` is the mockup's `.player > .low` (`h1`, `.sub`, `.tline`, `.ctrls`, two `.actbar`), every class the controller reads kept as a hook. `integration/playerDesign.ts` sets the root classes, always dark, the icons and the title line. The header row stays upstream's, because the controller shows and hides it; only its title is hidden. Playback, tracks and keys are untouched. `--player-glass-bg` and `--player-glass-filter` hold the glass; the TV and `no-bf` drop to the solid fallback.

The slider is still `emby-slider` inside `.track`, sized to the mockup's values, because it owns seeking, the bubble, chapter markers and buffer ranges.

**Preferences.** `design/PrefsMenu.tsx` replaces the menu route with every upstream destination and condition. `design/PrefsPage.tsx` paints `pcol/scard/srow2` from the page's own hidden form: selects, switches, inputs, list items and buttons write through to the controller's elements, so every field still reads and saves as it did (checked live: a switch saved, reloaded, restored). `integration/prefsPages.ts` mounts it on `viewshow` for the user's own pages only. Display always uses the legacy controller, which both layouts share. Admin pages are untouched.

## CSS changes from the mockup

All in `_runtime.scss`, under the `dsF` comments: the player's transparent frame and fixed `.low`, the slider's sizes, row ring on the TV by `:focus-within`, and the pointer rule that removes keyboard rings after a click. `dialogportal` aligns to the top as `dscrim` does.

## Behaviour the mockup has no place for

Kept and reachable: volume slider and mute, Favourite, chapter skip, previous track, record and AirPlay in the player; Studios and Tags on title pages; New Collection, New Playlist and Queue in the library head; Dashboard and Metadata Manager in the Preferences menu.

Dropped from view with a reason: the subtitle appearance preview in Preferences (a live sample with no row in the mockup). Its settings still save.

## Review corrections (2026-11-04)

All fourteen reported defects were present and are corrected in the worktree. Component guides record the behavior changes:
[Preferences](guides/settings-field.md), [sign-in](guides/sign-in.md), [menus/history](guides/menus.md),
[release rows](guides/release-picker-sources.md), [cards](guides/poster-card.md), [title commands](guides/title-pages.md)
and [player/chrome](guides/shared-chrome.md). The approved markup/look remains; removal and retention actions are unchanged.
The `/video` exemption covers both inline hiding props on AppHeader, including its toolbar.

Verification: `npx tsc --noEmit -p .`, ESLint on changed TS/TSX/JS (zero errors; two pre-existing nested-function warnings,
confirmed against HEAD), stylelint on `_runtime.scss`, and `JELLYFINMOD_PATCH_BASE=f0cd50572c node scripts/jellyfinmod-build/patchSurface.js`
pass; §3.2 matches 64 upstream files. Its already-listed context-menu and View Settings rows now state the actual reasons.

Offline Chromium suites pass with requests blocked: `ds-e.mjs` exercises row → Add → Replace, rejected confirmation, pending
Cancel, command navigation and the real focus manager at 1280 and 1920 TV widths; `ds-d.mjs` covers remote Play/Menu
consumption through the original shortcuts and scroll/Back/focus in long History. `ds-review-fixes.mjs` covers inherited
select/input/textarea setters, native validation and service errors, three page-removal cycles with timer/observer disposal,
body-focused Safari-style outside dismissal, view-control visibility, Quick Connect dismissal/Back/failure/late response/success
and reopening, the player's empty-state class, a visible seek focus change, and tab hiding only inside the mod scope.
Existing installed tooling was used through a temporary resolver; no dependency or package file changed.

No server, other worktree or deployed environment was touched. Live preference persistence, real Quick Connect service,
media playback/header actions, library Select, acquisition, browser/device acceptance and physical webOS remain unverified.
No files were staged or committed.
