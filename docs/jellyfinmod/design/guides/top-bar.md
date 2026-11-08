# Top bar and search

**The bar on B (ds.t13), approved by the user 2026-11-07 ("Keep the wordmark, fold the labels first", "Looks good for me"; workspace
`reviews/golden-pages/`), built, not accepted.** Every layout draws the bar on the golden scale (`design/_golden.scss`), so
`--jfmod-scale` zooms it: one row of Bφ² controls with Bφ⁻² above and below (`--jfmod-bar`, 60.9 px at the computer's and tablet's
B = 18 px, 58.9 px on a phone at 17.4 px, 81.9 px on the TV at 24.2 px), its content on the page gutter (`--jfmod-gut`: computer
and TV Bφ², tablet Bφ¹, phone B), its own font B. Computer: logo disc Bφ¹, the wordmark at B 700 Bφ⁻² after it, Favorites, Shows
and Movies Bφ⁻¹ after that as Bφ²-high pills padded Bφ⁻² (glyph box 1.2 B, which draws the mockup's tight B icon; label B 600,
current one primary); the field Bφ⁷ wide (at most 42 %), Bφ² high, half-height corners, padding 0 B 0 Bφ⁻¹, Bφ¹ glyph Bφ⁻²
before the words, typed ring 0.135 B (TV Bφ⁻³); SyncPlay, Cast and the avatar Bφ² circles with Bφ¹ glyphs, Bφ⁻³ apart. **When
room runs short the labels fold first, then the wordmark goes:** `Bar.tsx` measures the bar's width against its own font and
adds `fold` below 88 B (1584 px at 18 px; Bφ² round stops, Bφ¹ glyphs, the name as tooltip) and `noname` below 68.5 B (1233 px);
both keep at least B between the links and the field, measured with the English labels. A 1440 computer at scale 1 shows the
wordmark and the icons; 1920 shows the labels. The tablet always folds both, its field filling the gap with Bφ¹ either side. The
phone's menu, SyncPlay, Cast, Search and avatar are Bφ² stops. The TV's back, home, Favorites, Shows and Movies are Bφ² stops,
the clock at B 600; **the TV's Search page shows no title in the bar** (the user, 2026-11-07). Page offsets follow the height:
`--jfmod-bar` inside `.jfds` (the title and browse grounds), `--jfmod-barh` on `html` for the legacy pages (`_runtime.scss`).
The old 1366 px wordmark and 1180 px label media queries are gone. This supersedes the sizes below (3.226em bar, 3em icons,
29.03em field) and D254's order.

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
  centered to filling the menu-to-icons gap.
- **A computer window under 1180 px** (the user, 2026-11-07: "I like when it's centered"; design by Fable, approved
  2026-11-07; built, not accepted): the field stays centred and 29.03em wide (at most 42 % of the bar) at every computer width,
  and focus changes no geometry. Instead the Favorites, Shows and Movies labels fold into their icons: 3em round stops like
  SyncPlay and Cast (exception: upstream's 3em icon button), 1.5em glyphs, `--tint` on hover, the link's name as its `[data-tip]`
  tooltip, the current page still primary blue. Smallest gap at 900 px: 80 px from the last icon to the field.
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
