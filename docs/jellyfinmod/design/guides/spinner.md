# Loading spinner

**Status:** D231 and rulebook Spinner/Motion, rd2 built, not accepted.

`src/apps/modern/features/jellyfinmod/shell/sharedChrome.scss` overrides upstream's `.docspinner` only in the active mod chrome.
Upstream loading markup, arc layers, animation and show/hide behavior remain intact; no upstream loading file is edited.

The centered box is **6.18vh**, offset by -3.09vh on both axes. The arc and full-circle track have the same upstream **.21em**
thickness. Dark: white arc, white 30% track. Light: black 87% arc and black 25% track. Player menus/pages are always dark in either
theme. Reduced motion stops the loops and shows layer 1 at 55%. TV retains upstream's composited spin. Admin and wizard unchanged.

Exceptions: the viewport-relative 6.18vh size and its centering halves, upstream .21em arc and animation timings, track opacities
and reduced-motion 55%. No backend changes.
