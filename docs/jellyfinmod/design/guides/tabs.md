# Tabs

**Status: approved by the user, D273 (2026-11-05); built in ds.t7, not accepted.** Mockups in the workspace's `reviews/design-system` (page `tabs`, `player` state `subtitle-primary`, `prefs-subtitles`). Rulebook: `reviews/design-system/GUIDELINES.md`.

## What it is

One rail that switches what is under it: the same page place, a different panel. A few short names of equal weight, usually two. It does not choose a value: that is the segmented choice in `quality-profiles.md`, which stays filled, because a value is what you picked and a tab is where you are.

Used by: the player's Subtitle Appearance panel and the Subtitle Appearance section of Preferences (Primary, Secondary).

## Anatomy and values

Base unit 1em = the surface's font size.

| Part | Value | Step |
| --- | --- | --- |
| Rail height | 2.7816em, corners half | the field height, the named 40 px exception |
| Rail outline | 0.09em neutral (white 32 %, light black 32 %), no fill | as a closed field |
| Tab | an equal share of the rail, the whole height is the target | |
| Thumb inset | 0.236em | φ⁻³ |
| Label | 1em, 600, one line; selected 700, widths do not move | |
| Gap to what it switches | panel 1em, page 0.618em | φ⁰, φ⁻¹ |
| Width | panel: its column. Page: 17.94em. Phone page: full width | φ⁶ |

## States

| State | Look |
| --- | --- |
| Selected | blue name, thumb primary 20 % (light: `#fff` with a 0.09em by 0.236em shadow, black 23.6 %) |
| Not selected | ink name, no fill |
| Pointer on the unselected | 12 % tint on the thumb's place. Nothing grows |
| Keyboard focus | a 0.135em primary ring on the thumb's place, on `:focus-visible` |
| TV focus | filled primary, white label, a 0.16em ring in the ink, grown 1.08: the "other" button's TV focus |
| Disabled | does not exist: nothing turns a tab off |

Colour is not alone: the selected tab also has the thumb and the heavier weight.

Blue on the light thumb is 2.9:1, the same contrast as the main button's white on blue, and better than a current list entry's blue name on paper at 2.3:1.

## Motion

The fill and name fade over 0.236 s (`--d1`). No sliding thumb. TV: instant, only `transform` for the growth, no rail clipping (so no `overflow: hidden`), the ring is a `box-shadow`.

## Behaviour

- Click, tap or OK selects. Left and Right move and select at once, and wrap; Home and End go to the ends. This is the existing behaviour in `subtitlesettings.js`.
- On TV, Up and Down leave the rail for the rest of the form, as they do now.
- `role="tablist"`, `role="tab"`, `aria-selected`, and a `role="tabpanel"` for what it switches.

## Do not

- Use it to pick a value, or for more names than fit on one line: use a dropdown.
- Put a solid blue fill on a selected tab: on TV it could not be told from focus, and it competes with Save.
- Show a tab group away from what it switches.

## Build notes

- `design/PrefsPage.tsx` reads the page's own `[role=tablist]` as a `tabs` part and draws the rail right under its section's heading, the fields under it as the `role="tabpanel"`. A tab's press clicks the page's own tab, so `subtitlesettings.js` still switches the fields and keeps the other profile's unsaved values; Left, Right, Home and End move and select at once, wrapping.
- The player panel's upstream `.playerSubtitleSettings-profiles` take the same look from `design/_runtime.scss`, scoped to `.jfds.jfmod-dsPlayer`; the upstream SCSS files and their arrow-key handler are not edited, so the patch surface does not change.
- TV focus is `tvf` (`design/Root.tsx`) on the Preferences rail and `:focus` in the player panel.
