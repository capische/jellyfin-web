# dsC: shared menus, controls and dialogs

Built, not accepted (2026-11-04). The partial dsC work was retained and completed in the redesign worktree. No branch,
commit, server, plugin, dependency or setting was changed. Sources in `reviews/design-system` remain read-only.

## Presentation and behavior

- `ActionSheet` ports ds3's `.pmenu > .mi > svg + .tx0 + .sub`, group captions, dividers, selected checks, refused rows,
  destructive Delete Media and scrolling phone sheets with their grab handle. Existing user/library/filter/view/ratings
  components continue to draw their native dsA/dsB markup. Every item supplied by the real controller remains available.
- Upstream `actionSheet.show` dispatches to this renderer only in the active design shell. Callback/result IDs, selected focus,
  `resolveOnClick`, cancellation, timeout, history and action handlers retain their contracts. Player settings get the source
  icons, values and submenu chevrons; submenu Back reopens the existing player settings controller. Quality, aspect ratio,
  speed and repeat mutations remain upstream. The legacy TV player has no visible bar/DS page root: its signed-in
  `jfmod-chromePlayer` scope enables these DS portals too, always dark.
- `Controls` ports `field`, `sw`, `check`, all three `.btn` kinds and `.dialog > .dlghead + .dlgbody`.
  Real inputs replace inert value spans; labels/required markers, focus classes, ARIA, keyboard activation and tab stops
  supply behavior. `Dialog` keeps React-controlled dialogs on dialogHelper's history/focus lifecycle without reopening on
  rerenders. Nested field Back closes the list first; nested dialog Back closes only the top dialog. Focus returns to the opener.
- Upstream `dialog.show`/confirm/alert and `prompt` render the native dialog/footer/buttons/field through their existing APIs.
  Text and descriptions remain sanitized. The multi-version whole-folder delete warning follows its original More/Delete
  sequence using the new selectors, and still appears only in that confirmation.
- Removal dialogs port `P.remove`, with the existing removal plan's complete questions, facts, notes, choices and refusal
  retry. Blocklist uses the original default and API payload through a native switch. Safe focus, repeat-close protection,
  permissions and actual deletion logic remain in queueActions. Remove After Watching ports `P.retention('window-dialog')`
  using the existing choices and immediate save handler.
- `Spinner` ports the exact four-layer source spinner. `loading.show/hide` choose the design spinner in scope and upstream
  elsewhere; active loading transfers back to upstream when leaving for admin. Playback-start cleanup is unchanged.

## Complete CSS delta for this slice

No declaration/value in `_chrome.scss`, `_ds.scss` or `_spinner.scss` changed. They remain nested under `.jfds` at import;
the pre-existing root/keyframe/font adaptations are listed in [dsA.md](dsA.md). New runtime adaptations are:

| Selector | Reason |
| --- | --- |
| `.jfds .rb` in the existing semantic-control reset | A real button replaces the source's inert span: inherit font/ink and remove browser border/background/padding. Source hover/focus rules still apply. |
| `.jfmod-designDialogHost` | dialogHelper's invisible host fills its existing container and passes pointer input to the painted surface/backdrop. |
| `.jfds.dialogportal` | Full-size transparent flex host with source `2.618em 0` dialog padding; dialogHelper supplies the scrim and stacking. |
| `.jfds.dialogportal .dialog` | Non-shrinking surface, max-height 100%, vertical scrolling, pointer input; remove upstream `.dialog` paint containment so focus rings are visible. |
| `.jfds.dialogportal.dev-phone/.dev-tv` | Source zero-padding, paper, full-height scrim geometry on the real viewport. |
| `.jfds.dialogportal.sheetportal` and `.pmenu` | Zero-padding transparent sheet host; fixed real anchor, zero extra margin (the position calculation already adds `.382em`), pointer input, source 80% height with vertical scrolling. |
| `.jfds.dialogportal.sheetportal.layout-tv .pmenu` | Preserve source 20em TV cap. |
| `.jfds .pmenu.sheet.bottom` | `overflow-y:auto` replaces source hidden overflow so every phone entry is reachable. |
| `.jfds.menuportal.phonesheet` | Fixed four-edge viewport host for React phone sheets. |
| `.jfds.dialogportal .jfmod-removeOk` | Existing removal-plan success spans read source `--ok`. |
| `.jfds.loadingportal` | Transparent, pointer-transparent loading host. |
| `.jfmod-startingPlayback .jfds.loadingportal` | Source always-dark white arc/30% track during the existing black playback-start overlay. |

Motion uses the original `mn`/`msheet` classes and computed exit durations. The old `chromeActionSheet` decorator/positioner,
action-sheet selectors and sheet keyframes, spinner overrides and obsolete removal-safe-button override are removed.
Remaining rd2 dialog rules exclude `[data-ds-dialog]`; they still serve unported specialized surfaces.

## Retained upstream markup and scope limits

dialogHelper's invisible container/backdrop/history/focus infrastructure remains. Admin Dashboard, mod admin settings,
quality-profile editor and setup wizard retain their current markup and styles as explicitly requested.
The release picker's specialized frame/content, stock metadata/image/subtitle/identify/collection/playlist editors,
subtitle-offset/appearance dialogs, user preferences and track/version dropdowns still use their existing custom renderers.
They are not silently converted or removed by a generic DOM rewrite; their native page/content ports remain undone.
This slice ports the shared actionSheet/dialog/prompt APIs and the named mod dialogs, not every bespoke createDialog caller.
Extra library/filter options, secondary menu descriptions, cast targets, SyncPlay actions, callback timing, prompt help,
multi-version warnings and removal-refusal details have no complete fixture in the mockup; they remain functional.

## Runners and validation

Selectors were updated without removing behavior assertions in browser-review, card-get-shuffle, cloud-no-delay,
detail-design, live-queue, parity, placeholder-queues, queue-d6, queue-remove-delete, queue-remove-dialog, queue-state-discs,
queued-state, replacement-sweep, s11-fresh, v1-browser, v1-browser48 and whole-review-p1. `ds-c` is new.

`node scripts/jellyfinmod-e2e/ds-c.mjs` runs local Chromium against the real React components, dialogHelper, focusManager and
loading API, with router/layout/services substituted. It checks structure, SVGs, IDs, selection, arrows, focus restoration,
Back/dismissal, phone scrolling to entry 40, live device/theme, refusal/timeout, confirmations/prompts, blocklist payload,
safe focus, nested dialogs/fields, stable rerenders, multi-version warnings, TV player scope and transfer to upstream loading.
It compares settled dialog, button, field and switch type/ink/fill/padding/radius/shadow/height against the original read-only
CSS at computer 1440, tablet 768, phone 390 and TV 1280/1920 in both themes. `DS_MOCKUP` can override the source directory.
TypeScript, ESLint, changed-SCSS stylelint, runner syntax and diff whitespace are checked separately.

The mockup HTTP server was unreachable. Server-backed runners, real playback/acquisition and physical webOS validation
remain unrun under the instruction not to touch other environments. Local Chromium is not physical webOS acceptance.
