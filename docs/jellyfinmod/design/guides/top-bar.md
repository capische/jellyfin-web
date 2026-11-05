# Top bar and search

**dsF sweep (2026-11-04), built, not accepted:** a computer window under 600 px takes the phone's bar. The TV bar shows the page's title on Queue, Search and Preferences. The retained header tabs are hidden only while `html.jfmod-chrome.layout-tv` is active; upstream interfaces keep their tabs. On the TV the hero holds the page's top, so the bar stays on screen. The TV bar has a heart for Favorites, which replaces the header's retained Home and Favorites tabs; the mockup has no place for those tabs and they sat over the search field.

**TV libraries (ds.t6, built, needs the user's look):** Home no longer draws My Media and the mockup's TV bar has no library links, so the TV could not open Shows or Movies at all. The TV bar now has a Shows and a Movies icon after Favorites, the computer bar's icons, nothing else.

**TV search field (ds.t6, built, not accepted):** the arrows move the caret inside the words; at the words' edge Left and Right go on along the bar, and Down goes to the results, or to the page where there are none, so a D-pad can always leave the field.

**dsB (2026-11-04), built, not accepted:** The phone Search field is now the source `sfield > .in` with a real input. TV alphabet buttons and grid focus use the existing query/navigation path; the bar Down target follows native cells. The shell bar stays the one bar; Home art and browse ground reserve its exact source height. [Full CSS adapters](../dsB.md).

**dsA (2026-11-04), built, not accepted:** `design/Bar.tsx` and `BarSearch.tsx` now own the mockup bar markup and SVGs. Existing account/SyncPlay/cast controllers use native menu presentation only in this bar. `ChromeSearch.tsx`, `topbarChrome.scss` and `useModToolbarClass.ts` are removed. The bar is scoped by `.jfds`, with live layout/theme markers. [CSS exceptions and validation](../dsA.md).

**Status:** approved D221–D226, D251, D254, D259/D262; rd2 built, not accepted. Home scrolled/search-focus mockups.

Code: shell `ModToolbar.tsx`, `ChromeSearch.tsx`, `topbarChrome.scss`; mounted by `ModAppLayout.tsx` only on non-admin signed-in routes.
Navigation, library targets, SyncPlay, remote play, user menu and clock remain their original controls. CSS orders the main
links Favorites, Shows, Movies; other existing links follow them.

- Plain pages: theme ground. Scrolled: card glass, behind @supports for backdrop-filter AND color-mix, otherwise solid paper.
  Dark/Apple TV keep their card-glass recipes. Light uses all five `lightGlass.scss` tokens, with no contrast step.
- Sharp Home art: transparent with white ink and a black 61.8% top fade over 6.854em. TV bar stays transparent, never blurred; its fade holds the 61.8% to 38.2% of its height, so the bar's icons keep 4.5:1 over a white hero (ds.t7, the user's brief).
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

**Over art (ds.t4, 2026-11-05, built, not accepted):** the bar draws no layer of its own under the pill: the top gradient belongs to Home's hero (`.hero2 .pic::after`), and a title page has none. On Home the bar and search pill take the mockup's hero colours in both themes (white bar, pill `rgba(255,255,255,0.09)` with 85.4 % white text) until the bar turns to glass.
