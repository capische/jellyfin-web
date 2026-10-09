# Home top bar: frosted glass and label readability (design notes, 2026-10-09)

Notes from tuning the scrolled Home top bar (P7.S6) so the page shows through it while the nav labels stay readable.
The decision and its values live in `homeChrome.scss` and PHASE7 §S6; this file keeps the options that were tried, the
measurements and the pictures, so the choice can be revisited without redoing the work.

The comparison images are kept locally and are not published (they show artwork from a personal media library). All were taken from plain page loads of the Home page on the isolated
test instance (18096) as `oleksii` in Playwright Chromium, desktop 1920, dark and light themes, with candidate CSS
injected live into the deployed page (no playback, no user-data writes). Crops show the bar over the hero and over the
first poster row.

## What the user decided, in order

1. 2026-10-08: scrolled bar is frosted glass ("a little bit of blur"). First version: tint 35 %, brightness 0.48.
2. 2026-10-09: "make blur more opaque, so you can see through". Retune to 22 % / brightness 0.66: still near-black.
3. "Can it be more transparent?": tint 12 %, blur 12px, brightness 0.85, plus a text halo. Approved as a first look,
   then the hairline under the bar was removed ("a white line appears at the bottom").
4. Readability options tried on top of that (below). The user picked **flatten**: `contrast(0.7)` in the backdrop
   filter, no text halo, in every theme.

## How the numbers were taken

- **Show-through:** the regression slope of the bar's grey level on the grey level of the page beneath it, over 16 × 8 px
  blocks (1.00 would be a bar that is fully transparent; 0.27 is what the 2026-10-08 bar let through in the dark theme).
- **Label contrast, worst case:** the labels' colour against the bar's pixels with the labels hidden, using the brightest
  5 % of the 4 × 4 px blocks under each label; the worst label counts. This **leaves text shadows and outlines out**
  (they are painted on the labels), so it measures what the glass does, not the halo.
- **Edge-ring contrast** (halo sizes only): the label glyphs are found by painting them magenta; the bar is then captured
  with the label fill transparent (shadows still drawn); the contrast of the label colour is taken on a 2 px ring just
  outside the glyphs. This is what the eye sees at a letter's edge, and it is the only figure in which a halo shows.
- "Bright poster row" is the first Continue-watching row, whose label "Movies" sits over the brightest poster in this
  library. Over the hero, "Shows" or "Cast to Device" is the worst label.

## 1. Old bar against the see-through bar (halo, 12 %, brightness 0.85)

Compared as strips: old hero, new hero, old row, new row (images not published).

| Theme | Bar | Show-through, hero | Worst label, hero | Worst label, bright poster row |
| --- | --- | --- | --- | --- |
| Dark | old (35 %, 0.48) | 0.27 | 7.62 | 6.82 |
| Dark | see-through | 0.67 | 3.35 | 2.59 |
| Light | old | 0.42 | 6.47 | 9.85 |
| Light | see-through | 0.67 | 3.11 | 7.09 (worst row 3.70) |

The cost of the user's choice (see-through over the old 4.5:1 floor) is label contrast: below 4.5:1 over the brightest
poster in every dark theme. The options below try to win some of it back without darkening the bar.

## 2. Text halo against none

Images not published. The halo was `text-shadow: 0 0 3px rgba(0,0,0,.7),
0 1px 6px rgba(0,0,0,.5)` plus the same as a `drop-shadow` on the SVG icons (white in the light themes). It outlines the
labels and icons softly. Glass-only numbers are identical with and without it (the measure ignores shadows); in the
edge-ring measure it is worth 1.3–1.4 of a contrast point (section 6).

## 3. Thin text outline (`-webkit-text-stroke`, `paint-order: stroke fill`)

Compared as rows: halo, no halo, outline 1px, outline 1.5px (images not published).
Rejected: reads as a muddy, ghosted edge on the labels, and it does nothing for the SVG icons (heart, TV, clapper), so
labels and icons look inconsistent. The halo looked better.

## 4. Flatten the bright spots (`contrast(0.7)` in the backdrop filter) — chosen

Images not published. Columns: 1 halo (as deployed), 2 no halo, 3 flatten (no halo),
4 flatten + halo. Dark keeps brightness 0.85; light keeps 1.1.

| Theme | Variant | Show-through (hero / row 1) | Worst label, hero | Worst label, bright poster row |
| --- | --- | --- | --- | --- |
| Dark | 1, 2 (no flatten) | 0.67 / 0.57 | 3.35 | 2.59 |
| Dark | 3, 4 (flatten) | 0.47 / 0.40 | 3.95 | 3.27 |
| Light | 1, 2 (no flatten) | 0.67 / 0.57 | 3.11 | 7.09 |
| Light | 3, 4 (flatten) | 0.55 / 0.46 | 3.73 | 7.16 |

Flattening buys about 0.6–0.7 of a contrast point over the worst spots, because it squeezes the bright patches that wash
a label out while keeping the colours; the cost is 0.12–0.2 of show-through, and the dark bar reads slightly greyer over
the hero because the filter lifts the dark areas too. Neither variant reaches 4.5:1 over the brightest poster.
Flatten + halo (column 4) is the most readable of the four and was held back as an optional add-on (section 6).

## 5. Halo sizes

Images not published (columns: current 3px + 6px, smaller 2px + 4px,
smallest 1.5px + 2px, none). Visual comparison only.

## 6. A halo that is less noticeable but reads as well (edge-ring measure)

Images not published (columns: current, tight, tighter, none). What helps
reading is how dark the pixels are right at the letter edges; what is noticed is the radius. Dark theme, labels only,
mean contrast on the 2 px ring outside the glyphs:

| Halo | Over the hero | Over the bright poster row |
| --- | --- | --- |
| none | 4.79 | 3.85 |
| current: `0 0 3px .7, 0 1px 6px .5` | 6.22 | 5.17 |
| **tight: `0 0 1px .9, 0 0 3px .55`** | **6.59** | **5.58** |
| tighter: `0 0 2px .85` | 5.92 | 4.85 |
| flatten + tighter halo | 6.21 | 5.53 |

In the light theme tight is level with current (8.12 against 8.15 over the hero). A halo cannot help where the picture
is bright right under a label: the worst-5 % figure stays near 3.3:1 in dark whichever halo is used (flatten moves it
to about 4.0:1). If labels still need help after flatten, the tight halo is the one to add: it is smaller than the
original and measures better.

## Open options not tried

A soft backing behind the label clusters only (a faint radial or rounded dark patch behind the left nav labels and the
right icons), a stronger blur (about 20px, which averages the bright patches), bolder label weight, and checking the
nav links' own opacity. Listed in the order they were proposed.

## Result of the choice (flatten, no halo), deployed bundle `0251b4e71958`

Plain page loads of the deployed build, Chromium, over the hero and the first three poster rows. The full per-theme and
per-layout table is in PHASE7 §S6. Dark, desktop 1920: show-through 0.47 over the hero (0.40-0.48 over the rows), worst
label 3.95:1 over the hero and 3.27:1 over the brightest poster; light 0.55 with 3.73:1 / 4.27:1; Apple TV 0.50 with
4.42:1 / 5.01:1. Phone and the other dark themes follow the same pattern. TV is unchanged.
