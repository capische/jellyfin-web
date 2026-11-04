# dsB: Home, Search, browse and sign-in own their markup

**Built, not accepted (2026-11-04).** User-authorized implementation of the approved source functions, on `feat/redesign`.
No instance, deployment, dependency, setting, plugin, branch or commit was changed.

## Native surfaces and retained behavior

- `design/Hero.tsx` ports `P.home`'s `hero2`, `pic`, `scrim`, `foot`, `herotext`, metadata and action pill. `HomeHero` still chooses
  the title/backdrop from the same feeds, resolves episode artwork/overview and invokes the original playbackManager call.
  Played/Favorite use the existing mutations and refresh the existing query families. More uses ItemsContainer's command logic.
  Ratings reuse NativeRatingsLine and all of RatingsGroup's preference/value/reserve/focus/Back logic; `design/Ratings.tsx` supplies
  only `rgwrap`, `rgroup`, `ritem`, `rcentre`, `rmenu`, `rrow`, `rmk`, `rval`, `rvt`, `rcaret` presentation and the existing RatingIcon marks.
- `HomeMergedRow` now renders `Section` and `Cell`, not cardBuilder cards. Continue Watching keeps its merged Resume/Next Up ordering;
  Recently Added keeps library permissions, placeholder handling, deduplication and reclaimed exclusion. LibraryCast still owns its
  batch read and page-size-0 blank slot. Every caption has three fixed slots. Loading rows use the copied skeleton recipe.
  The source's sample Next Up row is not a duplicate feed: the existing merge remains authoritative.
- `HomeNotices`, SetupBanner and TraktReconnectNotice draw `noticex`, `tx`, `btn` with the original permission checks, polling,
  dismissal and links. Both notices sit after the hero. My Media tiles/buttons are omitted per D221–D224; all library targets remain
  in the bar/drawer. The TV settings/ratings footer keeps its original visibility/hooks/routes with native stacked buttons.
- Search uses `SearchBody`, `Suggestions`, `SearchCell`, the original `libgrid > grid.searchgrid`, the phone field and TV alphabet.
  Search ranking, retained order across paging/refetch, library choice, Add, duplicate/racing-Add protection and administrator Undo
  remain in CatalogSearchResults. No library/discovery query is replaced. Library cast reads are disabled at page size 0 and the third
  line stays blank for both native and TMDB results. The + exists only on computer hover/focus, never phone/tablet/TV. Images stay lazy;
  a missing/failed image retains its ratio and own SVG fallback. Added entries retain their identity and join the existing queue-mark projection.
  Extra search kinds and plugin-outage results use the same native Cell/Section, with their original query results and routes.
- `Head`, `Poster` and `BrowsePage` port `ground`, `dhead`, the phone structure of `head`, `P.browse` and season `ep` rows. The existing
  Discover Title response, Add handler, library chooser, permission handling, navigation/Undo handoff and focus ownership remain.
  Movie/show/season/episode browse heads, Seasons, Cast & Crew, Guest Stars and More from the season now render native markup.
  The view-manager template is hidden only on TMDB browse views; native/entry/person detail pages remain the next slice.
- `SignIn` ports default/wrong/users with real native fields/switch/buttons. A rejected password clears only the password, retains
  the username and focuses the password. Public users, passwordless login, remembered login, target URL and branding are retained.
  The original authentication/Quick Connect/navigation/sanitizer functions move into `integration/signInActions.js`; the stock controller
  imports them too. Quick Connect's existing poll can now be disposed when the React route leaves; a response after leaving cannot
  dereference a removed password field. Forgot Password, Cancel, Change Server and sanitized branding links stay accessible.
  `btnManual`, `manualLoginForm` and field IDs remain behavioral hooks only: no upstream field/button/card appearance is used.

## CSS: complete dsB delta from the mockup

**No copied declaration or value was changed in `_ds.scss`, `_chrome.scss` or `_spinner.scss`.** Their Sass import scope stays `.jfds`.
The dsA source-selector/keyframe/font/furniture adaptations remain as recorded in [dsA.md](dsA.md). All dsB additions are in `_runtime.scss`:

| Selectors | Necessary adaptation, using the source values |
| --- | --- |
| `.ep`, `.by a`, `.herotext h1 a`, `.rowt a`, `.actbar .txt`, `a.btn` | Semantic links inherit ink and lose browser/upstream decoration. The phone title retains former More Info navigation where the source pill omits its text button. |
| `.actbar .txt`, `.actbar > .itemAction` | Align the real detail link and the command-delegation host like the source text/icon controls. |
| `.fld input.v`, `.sfield input`, `.alpha button`, `.usr`, `.rgroup` | Remove native control chrome and inherit font/ink; inputs fill their source boxes, keep min-width 0 and use the source box's focus ring. |
| `.sfield input::placeholder` | Replace the decorative `i` with real placeholder ink at source opacity .618. |
| `.alpha button` | Real letter stops retain the source's letter spacing and pointer. |
| `.usr`, `.usr:focus` | Semantic user buttons retain 11.09em width/1em padding; the original avatar ring owns focus. |
| `.rgroup` | Restore source .1em/.2em padding after button reset; source state classes still own tint and ring. |
| `.rgroup .jfmod-ratingIcon`, `.rmenu .jfmod-ratingIcon`, `.rcentre` | Existing real marks take the source's 1em height, auto width, zero margin and popup ink. |
| `.rgroup[aria-hidden=true]` | Keep the existing hidden measurement reserve, never show invented stand-in values. |
| `.avatar2`, `.avatar2 img` | Real lazy user pictures fill/clip to the source avatar circle; failures reveal the person glyph. |
| `.poster .post`, `.poster.wide .post` | Ratio wrappers around real lazy head images reserve 150%/56.25% even without usable artwork. |
| `.still > img`, `.still > .fallback` | Absolute real image covers the original 16:9 pseudo-element box; centered 2em fallback matches the other native images. |
| `.ep:focus` | Source still ring replaces browser link outline. |
| `.searchend` | Keep the existing end-of-results message with source spacing 1.618em/0/.618em. |
| `.disc[aria-busy=true]`, `.disc > .dm` | Pending Add keeps the original disc visible; the source importing mark's turning arc fills it. |
| `.signbox`, capability-guarded non-TV variant | Solid 66% black fallback until both source glass capabilities exist; otherwise exact copied glass. Existing no-bf/TV variable fallbacks stay authoritative. |
| `.btn:focus`, `.alpha button:focus`, TV letter variant | Remove native button outline; Root maps focus to the copied `kf`/`tvf` classes (source .15em keyboard outline and .16em TV ink ring/1.08 scale). Alphabet stops use source control rings .135em/.236em. |
| `.page.jfmod-dsHomePage`, `.page.jfmod-searchPage`, `.page.jfmod-signinPage`, `.page.jfmod-dsBrowse`, legacy/TV variants | Neutralize upstream `!important` host padding. Search/browse reserve only the real 3.226em bar, 3.85em TV; sign-in/Home start at the top. `!important` is limited to beating those host rules. |
| `.jfmod-dsHomePage .homeSectionsContainer`, `.page.jfmod-dsHomePage .pageTabContent`, Home page footer | Source 2.618em foot spacing replaces upstream's duplicate 5em player/tab reserve. |
| `.jfmod-dsHomeShell > [aria-hidden=true]` | Suppress the shell's redundant AppBar spacer so the hero artwork starts under the real fixed bar. |
| `.jfmod-dsBrowse > :not(.jfmod-entryDetailsRoot)` | Hide the unused view-manager template; its wrapper/lifecycle remains. No upstream selector is restyled to draw the head. |
| `.jfmod-dsBrowse .ground`, TV variant | Source bar is mounted in the shell: matching negative margin and top padding (3.226em/3.85em) put art under it and retain the source content offset. |

The source HTML's inline sizing is preserved: hero height is `round(viewportHeight × .618)`, `.764` at 720px or shorter;
sign-in uses the real viewport rather than its specimen height and retains 4.236em/phone 2.618em vertical padding;
Search retains inline 3.3% right gutter. No new aesthetic values are introduced.

Deleted replaced styling: `homeChrome.scss`, `searchGrid.scss`, `tmdbDetails.scss`, `traktNotice.scss`, `tvSettingsLink.scss` and
obsolete Home/Search/browse selectors in cardDesign/sharedChrome/titlePages. The remaining overrides still serve other surfaces.

## Markup and behavior without a mockup slot

Lifecycle-only Page/AppBody/OffsetAppBar/view-manager/tab hosts, hidden legacy header infrastructure, Scroller and the plain
ItemsContainer command host remain. Scroller's existing design adapter draws source arrows; no MUI visual components render inside
these new surfaces. Extra Home audio/book/live-TV/recording/other-library sections retain their upstream loaders/markup because the
approved mockup specifies only the merged movie/show rows. Native/entry destination detail pages and existing More/Quick Connect/
library-choice dialogs remain their existing implementations. Dashboard, mod settings and setup wizard are unchanged.

The mockup has no passwordless/multiple-user policy, Cancel, Change Server, branding disclaimer, playback failure, end-of-results,
discovery outage, extra search kinds or TV settings footer sample; these behaviors remain. A phone reaches More Info on the hero title.
TMDB browse has only the API's community/episode rating: its existing star/facts remain rather than inventing the mockup's IMDb/RT values.
No fixture-only recommendations, dates or ratings are presented as real data.

## Runners and verification

Changed: `browser-review.mjs`, `home-hero.mjs`, `p9-design.mjs`, `replacement-sweep.mjs`, `retarget-smoke.mjs`, `setup-wizard.mjs`,
`tmdb-browse.mjs`, `trakt-export-matrix.mjs`, `trakt-export.mjs`, `tv-shell.mjs`, `undo-race.mjs`.
Selectors now address native cells/heads/notices while preserving action, permission, order, Undo, navigation and content checks.
Layout assertions measure the same visible parts through the new structure: source tile padding, the approved hero viewport-height
formula and crop, and the guarantee that a scrolled Seasons row never covers the poster (the source places it below the head).
No behavior check is removed or turned into an unconditional success.

Passed: TypeScript, ESLint for changed TS/TSX/JS, stylelint for changed SCSS, runner syntax and whitespace checks.
Isolated Chromium component checks passed 82 assertions with API/controller boundaries substituted: four layouts/two themes,
ratio/fallback/three slots/page-size-0, computer-only Add, original sign-in failure/session navigation, public users, Add/Undo identity,
original focus-manager Right/Down, and RatingsGroup's own toggle/Back handling. Computed-style comparisons against the read-only
mockup server found no differences in sampled padding/type/ink/fill/radius/filter properties on Home/Search/sign-in, at computer
1280/1440, tablet 768, phone 390 and TV 1280/1920 in dark and light. These are component contracts, not server acceptance.

Not run: server-backed suites, deployed-app acceptance, real playback/acquisition, real-Chrome full matrix or physical LG webOS.
The user's scope forbids touching other instances/environments. No deployment or acceptance is claimed.
