# Release picker: Add and Replace icon states (design, 2026-10-10)

**USER'S PICK (2026-10-10): option A with the circular Replace glyph, "circle, old one faint".** Add stays the plain +.
Everything in "Option A spec" below applies, with the Replace glyph and its working animation replaced by the section
right after this one. The user chose it directly in the design session.

Design only, nothing implemented. Session "Row Icon State Designs". Mockup (open the HTML for the animations):

- Live page with the animations: https://claude.ai/artifact/98qd18JkVogiCg87LQ6XaZ (first table is the chosen one).
- `release-picker-actions.html` / `release-picker-actions-circle.png` (chosen glyph) / `release-picker-actions.png`
  (earlier straight-arrow render) in this folder; generator `gen.py` in
  `/private/tmp/claude-501/-Users-kxalex-Projects-jellyfin-mod/0162f905-eb32-4c41-93bb-1753a3265e4c/scratchpad/grab/`.

## Chosen Replace glyph: two curved arrows in a circle, the outgoing one faint

Two 140° arcs of radius 8 around (12,12) with arrowheads, like Material `cached`, drawn as strokes so each arc can take
its own opacity: the **incoming** arc (right side, running clockwise from the top down to the bottom) is full strength,
the **outgoing** arc (left side, bottom up to the top) is at `opacity: 0.5`. Reading: the new file comes round, the old one
goes. Stroke 2.3, round caps and joins, 1.4em box, colour `error-main` #c62828 as today.

```html
<svg class="jfmod-releaseGlyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <g class="jfmod-releaseGlyph-swap">
    <g class="jfmod-releaseGlyph-in"><path d="M15.38 4.75A8 8 0 0 1 14.07 19.73"/><path d="M15.84 16.67L14.07 19.73L17.13 21.50"/></g>
    <g class="jfmod-releaseGlyph-out"><path d="M8.62 19.25A8 8 0 0 1 9.93 4.27"/><path d="M8.16 7.33L9.93 4.27L6.87 2.50"/></g>
  </g>
  <path class="jfmod-releaseGlyph-tick" d="M5 12.5L9.8 17.3L19 8"/>
  <g class="jfmod-releaseGlyph-bang"><path d="M12 5V14"/><circle cx="12" cy="18.6" r="1.4" fill="currentColor" stroke="none"/></g>
</svg>
```

```scss
.jfmod-releaseGlyph-out { opacity: 0.5; }
// working: the whole circle turns (replaces the "arrows slide" rule of the straight glyph)
.jfmod-releaseAction--working .jfmod-releaseGlyph-swap { animation: jfmod-releaseTurn 1.4s linear infinite; transform-origin: 12px 12px; }
@keyframes jfmod-releaseTurn { to { transform: rotate(360deg); } }
// done / failed: hide .jfmod-releaseGlyph-swap, show the tick / the bang, as in Option A below
// reduced motion: no turn; the glyph sits at 0.55 opacity while working, as in Option A
```

The Add button is unchanged from Option A (the + pulses while working). Hover, focus, done (green tick, stays while the
picker is open), failed (red `!` for 3 s, then idle), the state mapping and the a11y notes below all stand.

Code this maps onto: `ReleasePickerDialog.tsx` (`ReleaseRow`, `actionClass()`, `useGrab`, `GrabStatus`) and
`releasePicker.scss` (`.jfmod-releaseAction`, `--danger`) on the `next-release` worktree.

## Recommendation

**A · Glyph works**, with the **swap_horiz glyph kept** for Replace. It is the language the user chose for the Test icon
(motion in the glyph itself, whole glyph recolours, nothing added to the button), it is the cheapest (no extra element,
transform/opacity only), and the failed state works for Replace, which is already red, because the shape changes (`!`).
B is the fallback if keeping the +/⇄ visible after "done" matters more than consistency; C is the richest but the draining
rim animates `stroke-dashoffset`, which is outside the transform/opacity budget.

Replace glyph: keep `swap_horiz`. `find_replace` reads as text editing; the "faint outgoing arrow" variant says replace a
little better but is a one-off glyph nobody else uses. The red colour plus the confirmation dialog carry the "removes the
old file" meaning; the glyph only needs to say "swap".

## Real states → button states

From `useGrab` and `ReleasePickerDialog`:

| real state | where | button of the grabbed row | every other row's buttons |
|---|---|---|---|
| no operation, `grab.error` empty | — | **idle** | idle |
| `start()` called, request in flight (`activating`) | < 1 s | **working** (begin at once; do not wait for the response) | aria-disabled, 0.5 (as now) |
| `operation.state === 'pending'` (the hold, `holdUntil`, Cancel offered) | seconds | **working** | aria-disabled |
| `'submitting'` | ~1–2 s | **working** (same look; the status bar text changes) | aria-disabled |
| `'accepted'` | final | **done** — stays while the picker is open; `grabDisabled` already keeps every row disabled after acceptance, so nothing resets it. A new search (changed rows) unmounts the row; the status bar still carries "accepted". | aria-disabled |
| `'failed'` / `'unknown'` | final | **failed** for 3 s, then **idle** again (`activating` is false again, the row can retry). The status bar keeps the message. | back to idle |
| `'cancelled'` | final | **idle** (nothing to show: the user asked for it) | idle |
| `start()` rejected (`grab.error`, no operation, or a recovered one via `operationId`) | at once | **failed** 3 s → idle (same as above); with a recovered operation, follow its state | — |

Which row: `grab.releaseId` is the grabbed row; which button: pass the `mode` of the click (`'add'` / `'replace'`) up
with `releaseId` (one new field on the hook's state) so only the pressed button shows the state. Cancel stays the raised
button in the status bar; the icon does nothing while working (its `aria-disabled` is already true through `off`).

Screen readers: no new live text. `GrabStatus` is already `role=status aria-live=polite` and says each step once; the
icon's `aria-label` is unchanged ("Add <title> beside the files held" / "Replace the files held with <title>"); its `title`
(tooltip) may read "Add — In the Download Queue" / "Add — Failed" in the done/failed states (Title Case).

## Option A spec

Glyph: inline SVG strokes replacing the `material-icons` spans so the parts can move (same look at 1.4em, stroke 2.3,
round caps). Classes on the button: `jfmod-releaseAction--working`, `--done`, `--failed` (plus the existing `--danger`).

```html
<!-- Add -->
<svg class="jfmod-releaseGlyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" aria-hidden="true">
  <path class="jfmod-releaseGlyph-plus" d="M12 5.5V18.5M5.5 12H18.5"/>
  <path class="jfmod-releaseGlyph-tick" d="M5 12.5L9.8 17.3L19 8"/>
  <g class="jfmod-releaseGlyph-bang"><path d="M12 5V14"/><circle cx="12" cy="18.6" r="1.4" fill="currentColor" stroke="none"/></g>
</svg>
<!-- Replace: same, with the plus replaced by the two arrows -->
  <g class="jfmod-releaseGlyph-arrowTop"><path d="M4 8.5H19"/><path d="M15.5 5L19 8.5L15.5 12"/></g>
  <g class="jfmod-releaseGlyph-arrowBot"><path d="M20 15.5H5"/><path d="M8.5 12L5 15.5L8.5 19"/></g>
```

```scss
.jfmod-releaseGlyph { width: 1.4em; height: 1.4em; display: block; }
.jfmod-releaseGlyph-tick, .jfmod-releaseGlyph-bang { display: none; }

// hover: own colour, 1.08 and a veil of its own colour (UX §12.1 icon hover); beats upstream's blue
.jfmod-releaseAction.paper-icon-button-light { position: relative; transition: transform 0.14s ease-out; }
.jfmod-releaseAction.paper-icon-button-light::before { content: ""; position: absolute; inset: 0; border-radius: 50%; background: currentColor; opacity: 0; transition: opacity 0.14s ease-out; }
@media (hover: hover) {
  .jfmod-releaseAction.paper-icon-button-light:hover:not([aria-disabled="true"]):not(:focus) { transform: scale(1.08); color: var(--jf-palette-text-secondary, rgba(255,255,255,.7)); background: transparent; }
  .jfmod-releaseAction.paper-icon-button-light:hover:not([aria-disabled="true"]):not(:focus)::before { opacity: 0.12; }
  .jfmod-releaseAction--danger.paper-icon-button-light:hover:not([aria-disabled="true"]):not(:focus) { color: var(--jf-palette-error-main, #c62828); }
}
// focus: keep the existing cyan ring (desktop) / show-focus white ring (TV); hover must not override colour on focus

// working: Add pulses, Replace's arrows slide past each other
.jfmod-releaseAction--working .jfmod-releaseGlyph-plus { animation: jfmod-releasePulse 1.1s ease-in-out infinite; transform-origin: 12px 12px; }
@keyframes jfmod-releasePulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(0.78); opacity: 0.6; } }
.jfmod-releaseAction--working .jfmod-releaseGlyph-arrowTop { animation: jfmod-releaseSlideTop 1.2s ease-in-out infinite; }
.jfmod-releaseAction--working .jfmod-releaseGlyph-arrowBot { animation: jfmod-releaseSlideBot 1.2s ease-in-out infinite; }
@keyframes jfmod-releaseSlideTop { 0%, 100% { transform: translateX(-2.5px); } 50% { transform: translateX(2.5px); } }
@keyframes jfmod-releaseSlideBot { 0%, 100% { transform: translateX(2.5px); } 50% { transform: translateX(-2.5px); } }

// done: green tick, one pop
.jfmod-releaseAction--done { color: #81c784; }
.jfmod-releaseAction--done .jfmod-releaseGlyph-plus, .jfmod-releaseAction--done .jfmod-releaseGlyph-arrowTop, .jfmod-releaseAction--done .jfmod-releaseGlyph-arrowBot { display: none; }
.jfmod-releaseAction--done .jfmod-releaseGlyph-tick { display: block; animation: jfmod-releasePop 0.3s ease-out; transform-origin: 12px 12px; }
@keyframes jfmod-releasePop { from { transform: scale(1.35); } to { transform: scale(1); } }

// failed: red "!", 3 s (timer in the hook), then idle
.jfmod-releaseAction--failed { color: #ff7b72; }
.jfmod-releaseAction--failed .jfmod-releaseGlyph-plus, … arrows … { display: none; }
.jfmod-releaseAction--failed .jfmod-releaseGlyph-bang { display: block; }

// reduced motion: no pulse/slide/pop/hover-scale; working shows the glyph at 0.55 opacity instead
@media (prefers-reduced-motion: reduce) {
  .jfmod-releaseAction.paper-icon-button-light, .jfmod-releaseAction--working .jfmod-releaseGlyph-plus, … { animation: none; transform: none; transition: none; }
  .jfmod-releaseAction--working .jfmod-releaseGlyph { opacity: 0.55; }
}
```

Colours: idle grey = `text-secondary` (as now), Replace `error-main` #c62828; done #81c784 (light scheme: #2e7d32);
failed #ff7b72 (light: #c62828). On the dialog paper #202020: #c62828 3.4:1, #81c784 7.9:1, #ff7b72 5.9:1. TV: the
`show-focus` ring and the D-pad stops are unchanged; the working button stays focusable (`aria-disabled`).

## Option B spec (fallback)

Keep the Material glyph; add one overlay `<svg class="jfmod-releaseRing" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18.4" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/></svg>` positioned `absolute; inset: 0; pointer-events: none`, drawn inside the 2.5em circle.
- working: `stroke-dasharray: 30 86` on the circle, the svg rotates (`animation: jfmod-spin 1s linear infinite; transform-origin: 50% 50%`), glyph opacity 0.55. Reduced motion: the dashed ring stays still.
- done: full ring + glyph in #81c784; failed: full ring + glyph in #ff7b72 (the ring is the shape that differs from Replace's idle red). Same timings as A.

## Option C spec (not recommended)

As B while submitting; while held the ring drains: `stroke-dasharray: 116 116` and `stroke-dashoffset` set from `(holdUntil − now) / hold` each tick of the hook's 1 s timer with `transition: stroke-dashoffset 1s linear`. Done = A's tick; failed = red ring + A's `!`. The dashoffset transition is the extra cost and the reason this is third.
