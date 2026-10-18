# Card glass

**Status:** the top bar's recipe approved 2026-10-09 (flatten, no halo; [design note](../topbar-glass-readability.md)),
reused for every mark on a poster 2026-10-13 ("switch from yellow to white card glyph, and use top bar's exact recipe";
[ring family note, Revision 3](../download-state-ring-family.md)). Built on `next-release` (P7.S6, P4.FU7).
Records: [UX.md §7.3 and §3.3](../../UX.md). Code: `home/homeChrome.scss` (the bar), `components/_cardGlass.scss`
(mixins `card-ink`, `card-glass`), used by `downloadStateMark.scss` and `fileStateMark.scss`.

## What it is

One frosted-glass surface for everything that floats over artwork: the scrolled top bar on computer and phone, and the
1.6em discs on a poster (download state, Not Downloaded, Unaired). The recipe is the same value for value, so a disc looks
like a piece of the bar.

## The recipe

Gate: `@supports (backdrop-filter: blur(1px)) and (color: color-mix(in srgb, #000 50%, transparent))`. Autoprefixer adds
the `-webkit-` forms. The bar colour is the theme's `--jf-palette-AppBar-defaultBg`.

| Theme | Background | Backdrop filter | Ink (glyph, arc, text) | Track | Failed |
| --- | --- | --- | --- | --- | --- |
| dark schemes (default) | bar colour at **12 %** | `blur(12px) saturate(180%) contrast(0.7) brightness(0.85)` | `#fff` | white 30 % | `#ff5a4f` |
| `[data-theme='light']` | bar colour at **20 %** | `blur(12px) saturate(170%) contrast(0.7) brightness(1.1)` | `text-primary` (dark) | black 25 % | `#c62828` |
| `[data-theme='appletv']` | bar colour lightened 70 % → white, at **30 %** | `blur(12px) saturate(170%) contrast(0.7) brightness(1.15)` | `text-primary` | black 25 % | `#c62828` |
| **TV layout** (`.layout-tv`), any theme | solid `rgba(0,0,0,.66)` | none | `#fff` | white 30 % | `#ff5a4f` |
| no `backdrop-filter` or `color-mix()` | solid `rgba(0,0,0,.66)` (discs); upstream's solid bar | none | `#fff` | white 30 % | `#ff5a4f` |

The ink, track and failure colours are the custom properties `--jfmod-card-ink`, `--jfmod-card-track`,
`--jfmod-card-fail`, set by `card-ink` and changed per theme inside `card-glass`, so a mark's rules read them and never
name a colour. No line, shadow or highlight ring marks the edge of a glass surface.

## Rules

- Every element over a poster uses this and nothing else: no second tint, no darker disc, no faux highlight. The one
  alternative is the solid fallback above.
- Readability is the user's accepted trade: over a bright poster a 12 % disc reads about 1.4–1.7:1 for its white glyph
  (dark 30 % glass would be 3.6–4.1:1); the look was chosen anyway. Do not darken the recipe to win contrast back.
- Cost: on a 200-card grid the blurred discs roughly double the renderer's compositing work during a scroll, about
  0.1–0.2 ms of a 16.7 ms frame on a desktop or phone; the GPU-side cost on a real TV is unmeasured, which is why TV stays
  solid (the bar's full-width blur already cost D-pad scrolling on webOS). If the phone shows jank, the phone joins TV
  behind the same `.layout-tv`-style switch rather than getting a lighter blur.
- The glass never carries text smaller than the bar's labels; a disc holds a glyph or two digits at most.
