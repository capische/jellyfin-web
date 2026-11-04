# Menus and action sheets

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
