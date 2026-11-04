# Loading spinner

**dsC (2026-11-04), built, not accepted:** `design/Spinner` renders the source’s four-layer markup under `.jfds`, using the copied spinner CSS. Upstream loading remains the API and handles admin; an active spinner transfers back to upstream when leaving the design scope. The old sharedChrome spinner overrides are removed. Playback-start cleanup and dark-on-black colours remain. [Scope and CSS delta](../dsC.md).

**rd3 playback start (approved rulebook §7/D230, built, not accepted):** `integration/playbackStart.ts` is a
small adapter around the unchanged playback start promise. Local Play in the mod shell shows black after the
.146s press, fading .236s (.146s TV), with `loading.show()`'s existing Jellyfin spinner. The starting marker
forces white arc/30% track even in light themes. Playback start, error, **playbackcancelled**, stop, a rejected or
resolved start, hash navigation, popstate and pagehide remove the screen, marker, spinner and listeners. A second
start dismisses the old one. Remote starts and an already-open player do not get this overlay. Reduced motion is
instant. The screen's z-index 9999998 is the named stacking exception below upstream's spinner at 9999999.

**Status:** D231 and rulebook Spinner/Motion, rd2 built, not accepted.

`src/apps/modern/features/jellyfinmod/shell/sharedChrome.scss` overrides upstream's `.docspinner` only in the active mod chrome.
Upstream loading markup, arc layers, animation and show/hide behavior remain intact; no upstream loading file is edited.

The centered box is **6.18vh**, offset by -3.09vh on both axes. The arc and full-circle track have the same upstream **.21em**
thickness. Dark: white arc, white 30% track. Light: black 87% arc and black 25% track. Player menus/pages are always dark in either
theme. Reduced motion stops the loops and shows layer 1 at 55%. TV retains upstream's composited spin. Admin and wizard unchanged.

Exceptions: the viewport-relative 6.18vh size and its centering halves, upstream .21em arc and animation timings, track opacities
and reduced-motion 55%. No backend changes.
