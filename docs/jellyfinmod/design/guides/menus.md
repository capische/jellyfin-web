# Menus and action sheets

**Selected Version group (ds.t12): approved by the user 2026-11-07, built, not accepted, gate 1 on beta.** The title's More menu
ends with a group for the file the Video field has selected: a divider, the caption **Selected Version** (`.cap0`), a context line
(the resolution in 600, then its video and size at .854em, 70 %; `.jfmod-menuContext`), then **File History**, **Keep This Version**
/ **Stop Keeping This Version** (the episode's or title's Keep keeps its own words: Keep the Episode, Keep the Movie, Kept …), a
divider and **Remove This Version…** in error ink, before Delete Media. Entries a viewer may not use are absent (History needs
`history.files`; Keep and Remove are an administrator's); a refused Keep (locked, or busy) stays `aria-disabled` at 45 % with its
reason as the tooltip. File History opens the popover from the More button and Back returns the focus there. The group's rows keep
this guide's row values (2.618em, 1.4em icons); the proposal's golden rows (s2, s0 icons, s6 width) wait for the menus' own golden
pass. The same group shows in the phone's bottom sheet and the TV's anchored menu. Code: `integration/moreMenuItem.ts` (`divider`,
`section`, `disabled`, `title`, `danger`, `run(opener)`), `design/ActionSheet.tsx`, `useVersionMenu` in `components/NativeEntryDetails.tsx`.

**Entry card More (2026-11-05, user brief), built, not accepted:** a non-pending design `Cell` with an entry and no
Jellyfin item uses the existing action sheet for **More Info** (its title page, where entry management remains) and,
when available, **View Queue**. Native-item More and the existing in-flight context menu retain their handlers.

**Review fixes (2026-11-04), built, not accepted:** outside dismissal excludes only the actual anchor or previously focused control, never `<body>` when Safari leaves focus there. File History has a focus scope/container: Up/Down scroll its existing 80% viewport surface, Left/Right and Tab stay inside, Back closes it and restores the file icon. Movies/Shows Primary grids omit Show Title, Show Year and Enable Card Layout (fixed D260 caption); List and other image types keep those controls.

**dsF sweep (2026-11-04), built, not accepted:** menus stay inside the page's 3.3% gutter. The user menu has the caption and the mockup's order (Queue and Ratings Display first, JellyfinMod Settings with the admin links). Action sheet entries are Title Case. A click no longer leaves a keyboard ring; `ds-pointer` on `html` marks pointer input.

**dsD (2026-11-04), built, not accepted:** title More and per-file history now use source `pmenu` and `hpop/hh/ol/li`
with real painted anchors. File history keeps binding-specific data, scrolls at 80% viewport height and consumes key/remote Back
before the list beneath it; focus returns to its original file icon. Monitor retains its menuitemcheckbox state. Card-menu
registrations recognize native cells/episode rows without changing their action logic. [Details and CSS inventory](../dsD.md).

**dsC (2026-11-04), built, not accepted:** shared action sheets now render the mockup’s own `.pmenu`/`.mi`/SVG markup through upstream’s API, including player settings and sublists. Phone sheets scroll; native motion classes, selected/refused rows, history, callback timing and Back/focus remain. The old chromeActionSheet decorator and action-sheet restyling are removed. [Scope, CSS delta and validation](../dsC.md).

**dsA (2026-11-04), built, not accepted:** Top-bar, library view/sort/filter/settings menus draw native `.pmenu`/`.mi` markup; phone sheets add the original scrim and grab handle and scroll to the last entry. View settings draw switches; sort retains every option and its original handler, including explicit order rows. Existing More action sheets remain in their current command renderer for this slice. [Runtime adapters and validation](../dsA.md).

**Status:** approved rulebook Menus and Dropdowns (D220, D225–D227, D251), rd2 built, not accepted.

Code: shell `sharedChrome.scss`, `motionChrome.scss`, `chromeActionSheet.ts`, `useChromeScope.ts`, `ChromeTheme.tsx`;
upstream `components/actionSheet/actionSheet.ts` is a thin presentation adapter. Applies only under `html.jfmod-chrome`.

- Paper, 1em corners, .382em padding, soft shadow; minimum 17.94em. Rows at least 2.618em (phone 2.7816em), .618em corners,
  1em horizontal padding; optional 1.4em icon with .618em to the name. Group labels .72em/600, uppercase, .06em tracking,
  61.8% ink. Dividers 1px with .618em inset. Trailing values .854em, 70% ink.
- Current: primary name plus the .618em primary check at .236em from the left; no selected fill, left bar or trailing check.
  Marks/icons and metadata keep their own ink. Legacy selection comes from the existing options; MUI selection comes from
  aria-selected/Mui-selected or its existing Check/Sort-direction icon, without changing what a row does.
- Hover: grey fill, .236s, pointer only. Keyboard: .135em inner primary ring. TV: .236em inner primary ring, instant;
  selection stays under the ring. Refused aria-disabled actions stay reachable and dim to 45%; their existing refusal remains.
  Only Delete Media is destructive and moved to the end in generic legacy menus; Sign Out stays neutral. No new actions or submenus.
- Computer/tablet: float .382em from the opener, flipping above when below would not fit, clamped to a 1em viewport margin.
  TV uses the same anchored menu, **at most 20em tall (400px at the TV root)**, internally scrolling; upstream focus scrolling/history
  and Back remain. Player menus use dark paper in either theme, without the old translucent video frost. Floating menus keep
  the page/video undimmed; their transparent backdrop retains outside-click dismissal.
- Phone: full-width bottom sheet, 1em top corners, 2.618em by .236em handle, 61.8% black scrim, at most 80vh. The sheet's
  flex child has min-height 0 and its list scrolls vertically, including on a short landscape phone; no entry is clipped away.
  Field-owned MUI Select and track lists remain anchored, never converted to sheets. Info and file-history popovers
  keep their own guide/anchor/width and are excluded from menu paper, caps and sheets.
- Opening/closing and reduced motion follow [shared-chrome.md](shared-chrome.md). No loops, no page-load motion.

Exceptions: the approved 40px phone row, 20em/400px TV height cap, 80vh phone cap, 1.4em icon, caption/trailing type,
1px dividers, opacity/shadow recipes, .135em keyboard ring, .964 menu scale, and half-sized handle geometry.
