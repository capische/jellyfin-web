# Top bar and search

**dsF sweep (2026-11-04), built, not accepted:** a computer window under 600 px takes the phone's bar. The TV bar shows the page's title on Queue, Search and Preferences. On the TV the hero holds the page's top, so the bar stays on screen.

**dsB (2026-11-04), built, not accepted:** The phone Search field is now the source `sfield > .in` with a real input. TV alphabet buttons and grid focus use the existing query/navigation path; the bar Down target follows native cells. The shell bar stays the one bar; Home art and browse ground reserve its exact source height. [Full CSS adapters](../dsB.md).

**dsA (2026-11-04), built, not accepted:** `design/Bar.tsx` and `BarSearch.tsx` now own the mockup bar markup and SVGs. Existing account/SyncPlay/cast controllers use native menu presentation only in this bar. `ChromeSearch.tsx`, `topbarChrome.scss` and `useModToolbarClass.ts` are removed. The bar is scoped by `.jfds`, with live layout/theme markers. [CSS exceptions and validation](../dsA.md).

**Status:** approved D221–D226, D251, D254, D259/D262; rd2 built, not accepted. Home scrolled/search-focus mockups.

Code: shell `ModToolbar.tsx`, `ChromeSearch.tsx`, `topbarChrome.scss`; mounted by `ModAppLayout.tsx` only on non-admin signed-in routes.
Navigation, library targets, SyncPlay, remote play, user menu and clock remain their original controls. CSS orders the main
links Favorites, Shows, Movies; other existing links follow them.

- Plain pages: theme ground. Scrolled: card glass, behind @supports for backdrop-filter AND color-mix, otherwise solid paper.
  Dark/Apple TV keep their card-glass recipes. Light uses all five `lightGlass.scss` tokens, with no contrast step.
- Sharp Home art: transparent with white ink and a black 61.8% top fade over 6.854em. TV bar stays transparent, never blurred.
- Search: 29.03em, at most 42% of the toolbar, 2.618em high, 1.309em radius, .618em leading/1em trailing padding, 1.382em glyph.
  Its own glass is white 9%, blur 12px/saturate 180% (light black 6%); hover white 14%/light black 10%. Solid paper fallback.
  Active .135em primary ring; TV .236em, paper on plain ground and black 66% over art.
- Below **1366 window pixels** the server wordmark goes. The existing tablet drawer breakpoint (900px) switches search from
  centered to filling the menu-to-icons gap. No extra collision rule is introduced below 1100px.
- Computer: typing the first character navigates to the existing Search route, retaining the same field/caret, URL query and
  library scope. Search has no duplicate body field. `#searchTextInput` remains its ID on that route. Tablet uses the same field.
- Phone: the search icon and upstream page field stay; the hidden desktop input is not mounted. Targets remain at least 40px.
- TV: the field replaces the legacy header's search stop. OK uses the real input/native keyboard. Keyboard visibility events
  let Back blur/close it before a later Back leaves Search. Down reaches results; the existing alphabet picker stays on emulated
  TV clients. Existing legacy header navigation and upstream search data/debounce are preserved.

Exceptions: 1366/900px responsive thresholds; 42% cap, upstream 3.226em bar/3em icons, 1.382em search glyph, glass recipes,
half-height pill radius, .135em ring, 40px touch targets, existing search debounce. Native webOS keyboard timing and physical
C1 performance require device verification; rd2 did not contact a server or device.
