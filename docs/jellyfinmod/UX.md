# JellyfinMod — web UX

The UI half of JellyfinMod, specified. `README.md` in this folder settles *what* is being
built and *why a plugin*; this file settles *what it looks like and how it behaves*, from the
Phase 1 catalog through the Phase 6 version selector.

There is a working click-through of everything below in
[`prototype/movies-prototype.html`](prototype/movies-prototype.html) — open it in a browser. It
runs Home with its two merged rows, the Movies grid with the file marks, the **Filter ▾** menu
with its File group actually filtering, the two-zone search, both shapes of entry page with the
collapsed history line, the release picker and the queue — and switches between the desktop,
tablet, mobile and webOS TV layouts, with arrow keys driving the TV one. (`prototype/superseded/`
holds the earlier design and is kept only for comparison.)

Read `README.md` first, then [`PHASE1.md`](PHASE1.md) for current implementation decisions and
technical gates. Catalog rows are not library items; existing movie and TV routes display them
without redirects. STRM placeholders are planned for reclaimed titles in the retention phase;
wanted entries stay plugin-only. Scope is movies and TV, and changes remain narrowly scoped.
Where this document implies something the README's data model or API surface does not yet
cover, it is called out explicitly as **[model change]** or **[API addition]** so the two stay
in sync.

---

## 1. Four principles

Every argument below is decided by one of these. They are listed in priority order — when two
conflict, the earlier one wins.

**0. Nothing upstream is removed.** Not a route, not a tab, not a menu item, not an option. Every
dropdown jellyfin-web ships — audio, video and subtitle track selection, artists, studios, genres,
collections, sort fields, filter groups, view modes, the version selector — stays exactly where it
is and keeps working. This design *adds*: one mark on a cover, one group in a menu, one action on
an entry page, one collapsed line, two merged Home rows. If a proposal reads as "replace X with Y",
it is the wrong proposal. Every other principle is subordinate to this one.

**1. The 95% case must look like nothing happened.** Almost every card in the grid is a film
you own and can play. That card gets no badge, no chip, no countdown, no colour. Catalog
affordances appear only where the state is *not* the boring one. A catalog-first UI that
decorates every poster is worse than the library view it replaced, and the README is explicit
that a prettier-but-worse browse is a downgrade.

**2. One title, one row, one place.** The same film can be a TMDB result, a catalog row and a
Jellyfin item simultaneously. The UI never shows it twice. Deduplication is by TMDB id, and
the highest-fidelity representation wins. This is the single rule that lets one search box
replace three.

**3. Focus is state.** On the TV the D-pad position *is* the user's place in the app. Any
change that unmounts a grid, reflows a row, or blanks a container throws focus to the top of
the page and loses it. Rendering rules that would be merely inelegant on a desktop are bugs on
the TV, and they are specified as bugs here.

**4. Keep the upstream diff small and explicit.** The earlier dozen-line estimate did not account
for combined queries, file-less detail loading or the accepted Home redesign. `PHASE1.md` §6
lists the proposed integration seams to prove before implementation. Reuse upstream components
where possible, keep feature logic in new files, and review each necessary mount separately.

---

## 1.1 Styling discipline

Principle 0 in CSS terms. `CLAUDE.md` carries the enforceable list; the reasoning is here.

Upstream's stylesheets are the fork's largest rebase surface and the app's whole identity. So the
catalog adds styles, it never edits them: **no existing selector is changed, no existing `.scss`
file is touched**, every new class is prefixed `jfmod-`, and every value — radius, spacing, colour,
type scale — is read out of `themes/_base/theme.ts`, `card.scss` or `librarybrowser.scss` rather
than chosen.

Two consequences worth stating, because they decide arguments:

**Everything sizes in `em`.** `.layout-tv{font-size:125%}` and `.layout-mobile{font-size:90%}` are
how the app scales for a TV and a phone. A `px` value opts out of both, silently, and only shows up
when someone drives the TV.

**The corners are already allocated.** `.cardIndicators` is `top/right: 0.225em` and holds the
played tick and unplayed count; mobile's `CardOverlayButtons` sit bottom-right. That is why the file
mark is top-left — not preference, availability.

When a design cannot be built under these rules, the design changes. The one deliberate exception is
recorded in §7.3: the top bar's presentation. It is a restyle, it is called out as such, and it is
the only one.

**Principle 0 exceptions on the detail page (user, 2026-10-07).** The 0.1.0.0 detail page design fix
(§7, [design record](design/episode-page-design-spec.md)) adds two more, each a DOM insert from the
mod's own `nativeEntryDetails.js`, with no upstream file or selector edited:

1. **A mod control inside a stock container.** The *Get a release* icon is inserted into upstream's
   `.mainDetailButtons` before `.btnUserRating`, styled entirely by upstream's own `button-flat
   detailButton` classes; the Played countdown badge is one `span` inside the stock `btnPlaystate`
   button. Both are the first mod content inside a stock container.
2. **The stock Version select is hidden while the file chooser is mounted** (the §7.3 kind): it stays
   in the DOM and keeps working, hidden by a mod class that exists only while the chooser does.
3. **The stock header Shuffle is hidden on a show that is not watched in any order** (P1.FU12, user
   2026-10-12; the §7.3 kind). On a series or season page, `btnShuffle` stays in the header only when
   the show's Jellyfin genres name comedy (sitcom), animation, reality, talk or game shows,
   documentaries, kids or news (case-insensitive, matched within the genre's name; a season page reads
   its series). Elsewhere a page class (`jfmod-shuffleInMore`, from `integration/shuffleMenu.ts`) hides
   the button, which stays in the DOM, and a *Shuffle* item in the stock More menu clicks it, so
   playback stays upstream's. Movies and other pages are untouched.

All need a parity check on every upstream merge: the insert points (`.mainDetailButtons >
.btnUserRating`, `.btnPlaystate .detailButton-content`, `.selectSourceContainer`,
`.selectVideoContainer`, `.mainDetailButtons .btnShuffle`) must still exist with the same meaning;
when one does not, the matching mod surface is simply absent and the stock page is unchanged.

---

## 2. Information architecture

### 2.1 Routes

One new route, in `src/apps/modern/routes/catalog/`:

| Path | File | Phase | Purpose |
| --- | --- | --- | --- |
| `/catalog/queue` | `queue.tsx` | 5 | Download monitor — the only screen with no upstream equivalent. |

**There is no redirect, and there are no new browse routes.** This supersedes README §9.1.

Once a title is one entry that may or may not have a file, `/movies` *is* the catalog — the same
route, the same `LibraryPage`, the same tabs — showing entries that happen to include some with
nothing on disk yet. There is nothing to redirect to and nothing to replace. `/tv` likewise.

What that leaves is genuinely small:

| Path | Change | Phase |
| --- | --- | --- |
| `/movies`, `/tv` | unchanged routes; the query behind them returns file-less entries too | 1 |
| `/details?id=` | unchanged; gains a **Search releases** action and a collapsed history line | 1 |
| `/search` | unchanged route; the results query stops filtering out file-less entries, and a leftovers section is appended | 1 |
| `/home` | unchanged route; two rows merge (§8) | 1 |
| `/catalog/queue` | **new** — the only new route in the design | 5 |

The upstream movie and show components are not deleted, not bypassed, and not left as dead code.
They are the product.

### 2.2 Navigation

The drawer's Libraries section is generated from `useUserViews` and its links come from
`appRouter.getRouteUrl(view)`, which already yields `/movies` and `/tv`. These routes stay. **The
Libraries section therefore needs no change at all.**

**Nothing is added to the navigation either.** There is no Catalog entry, because there is no
catalog to navigate to — Movies is it. The drawer, `UserViewNav`, and the overflow menu are all
untouched, and `MainDrawerContent.tsx` is no longer in the diff at all.

### 2.3 Library scoping — the one data-model consequence

`/movies` is per-library: it carries a `libraryId`, and a server can have several movie
libraries. The catalog has to answer the same question, and half its rows have no Jellyfin item
to derive a library from.

**[model change]** `catalog_item` gains `target_library_id` — the library the title belongs to,
set on add (defaulting from the quality profile or from media type when only one library of that
type exists) and reconciled from the real item once imported. Without it, catalog-only entries
either appear in every movie library at once or in none, and both are wrong.

Global search covers the requesting user's accessible libraries. There is no `/catalog` browse
route or Catalog drawer entry. Add-time placement and cross-library identity are specified as
Phase 1 contracts in `PHASE1.md` §1.

---

## 3. The state vocabulary

State is **one icon over the cover**, and nothing else. No text badge, no chip, no pill — a
silhouette, because a silhouette is what survives being 12px on a phone and being read from
three metres on a TV. There is exactly one mark per card and it answers one question: *is the
file there?*

| State | Mark | Reads as |
| --- | --- | --- |
| `imported`, `watched` | solid disc | it is here |
| `wanted` | dashed ring with a down-arrow | nothing here yet |
| `searching` | magnifier | looking for it |
| `grabbed` | arrow-to-line | queued at the client |
| `downloading` | progress ring + `%` | arriving, this far along |
| `reclaimed` | archive box | was here, disk reclaimed |

Two rules keep it from becoming noise:

**The "on disk" mark is quiet.** It is drawn at low contrast — present if you look for it,
invisible if you are not. That preserves Principle 1 without pretending the state does not
exist, and it means an entry never looks *unmarked* and therefore never looks unhandled.

**Dimming does the work at small sizes.** A card with no file sits at 60% opacity. At 390px,
where the icon is at the edge of legibility, the dimmed cover is what actually carries — you
read the shape of the grid before you read anything in it.

Watched state is not part of this vocabulary. It is upstream's played tick, unchanged, in
upstream's corner — see §3.1.

### 3.1 Badge placement

Verified in the current tree: `.cardIndicators` in `components/cardbuilder/card.scss` is
`top: 0.225em; right: 0.225em` (mirrored under RTL), and `CardImageContainer` fills it with the
played tick, child count, missing, timer and type indicators.

**The file mark therefore goes top-left, always.** The two indicator systems can never collide,
and the mark is a new absolutely-positioned sibling rather than an edit to
`CardImageContainer`, `CardOverlayButtons` or `CardInnerFooter`. Under RTL it mirrors to the
right, following the same `[dir]` pattern the stock rule uses.

`CardOptions.disableIndicators` already exists, so a catalog surface that wants only its own
badge — the release picker's poster thumbs, say — can suppress the stock set without a fork.

**Changed 2026-10-12 (user-approved design, P1.FU11): every mark sits top-right, and on disk shows
nothing.** The file mark leaves top-left and joins the top-right corner. On a card that has
upstream's `.cardIndicators`, the mark sits just before that cluster (the played tick or the count),
moved left by the cluster's width, so the two never collide, and above the desktop hover overlay so an
administrator's button stays clickable; a card without it gets the mark alone at the same spot. A list row (library list view, search list, season page) carries the mark in its action slot at
the row's end. The marks, one shared `FileStateMark` and one `fileStateMark.scss` everywhere:

| What | Mark | Administrators | Everyone else |
| --- | --- | --- | --- |
| On disk | none | — | — |
| No file (not downloaded, reclaimed, or unaired with no air date) | white icon (the existing glyph, a dark one on the light schemes) on the top bar's glass disc (§3.3, P4.FU7); a row's is the colour of upstream's round row icons since P1.FU22 (it was amber `#ffb74d`; amber is gone from the download design, P4.FU8) | a round button, tooltip *Download This Movie* / *Download This Series* / *Download This Season* / *Download This Episode*, that opens the release picker in that scope and stops the card's own click; hover scale 1.08 with no colour change (it was `#ffd180`), pressed 0.96, cyan keyboard ring, white TV ring | a plain indicator, tooltip *Not Downloaded*, no pointer, not a focus stop |
| Unaired, with an air date | clock + the short air date: `10 Aug` this year, `Aug ’27` in another (month in the viewer's locale) | not clickable; tooltip *Airs 10 Aug 2026* | the same |

The quiet on-disk mark and the 60 % dimming rule above are retired with this change; the file-less cards
keep their own dimmed artwork.

**Changed 2026-10-12 (P1.FU17, user-approved design A and option 1,
[`design/not-downloaded-mark.html`](design/not-downloaded-mark.html)): the glyph, and Not Downloaded beside the watched
tick.** The Not Downloaded glyph is a download arrow coming out of a small cloud (stroked in the icon colour, since P4.FU8 (amber before), on the same disc, at
the same sizes, with the same button, focus ring and tooltips; the header's Get a Release keeps its own icon). A season or an
episode with no file on disk shows Not Downloaded whatever its watched state: the tick says watched, the mark says no file,
and both show. Upstream's own season cards (a Jellyfin season item, for example one kept for an empty folder, which Jellyfin
reports as played) now carry the mark too: Not Downloaded when none of the season's episodes in the entry's list is on disk,
the Unaired clock when all of them are unaired with a date, nothing when one is on disk or the entry lists no episode of that
season (specials are not marked). The mark sits just left of upstream's tick or count (option 1, the slot the library grid's
cards use), clickable for administrators (the picker on that season, where packs are served) and a plain indicator for
everyone else, one more D-pad stop on the TV (Up on the card reaches it). On a list row the mark comes first in the end slot,
then upstream's played check.

**Changed 2026-10-13 (P1.FU19, user: "As for the clickable state icon, let's remove it for now"): every mark is an
indicator.** Not Downloaded (on cards, rows, the mod's pages), the Unaired clock, a row's failed red bang and every download disc
are plain indicators for everyone: not a button, no focus stop (no TV second stop, no Up/Right hop), no pointer, nothing
changes under the mouse (no brighten, no scale, no veil; user: "I don't think we need highlight / hover over non clickable
icon"); the tooltip stays (*Not Downloaded*, *Airs …*, the download figure, *Failed · reason* without "search again"). The
administrator's button of the table above and of option 1 is kept in the code behind one switch, `MARK_CLICKABLE` in
`constants/fileState.ts` (false), so it can come back. The picker opens from the card's hover Get a Release (§5.7, in the
centre of a card with nothing on disk), the card's and row's item menus and the page header's Get a Release.

**Changed 2026-10-13 (P1.FU19): a row's mark is the size of upstream's round row buttons** (user: "make the episode [state
icon] the same size as info and fav and heart icons"). Upstream's `.paper-icon-button-light` is its glyph (1.6696em) plus
0.556em of padding each side: a 2.7816em box (41.4px on the desktop, 40.1px on the phone, measured on a season page). Not
Downloaded, the Unaired clock (its height and glyph) and a row's failed bang take that box and glyph size, centred on the row
as the heart is; so does the download disc on a list row (§3.3). Cards keep the 1.6em disc.

**Changed 2026-10-13 (P1.FU22, user: "Replace yellow with white and add hover effect + click which open the picker for the
episode"): a row's Not Downloaded is white, and an administrator's button again.** On rows only (a missing episode's row on
the native and the mod's season pages, a library list row; the 2.7816em mark in the end slot): the glyph takes the colour of
upstream's round row icons beside it (their `color: inherit`, the row's text colour: white 70 % on the dark schemes, the dark
text on the light ones), for everyone. For administrators it is the button again (`MARK_CLICKABLE.row`; cards keep
`MARK_CLICKABLE.card` off): upstream's round-icon hover (`.paper-icon-button-light` in the base theme: the theme's primary
glyph over its veil, primary at the action-selected opacity, 0.2 s, no scale), the same pressed, a pointer, the cyan keyboard
ring; Enter and Space; named *Get a Release for Episode 1, 1923* (a library row: *Get a Release for* the title), its tooltip
still *Not Downloaded* (the mark's meaning, as before; the name says what the click does). It opens the release picker in the
row's scope: the episode (Episode, its season, All Seasons, as the episode page's Get a Release), or the title. On the TV the
row is the D-pad stop and the mark its second: Right on the row reaches it (focused: the primary glyph over its veil and the
white ring), Enter opens the picker, Left returns to the row; Down never lands on it. Everyone else's stays a plain indicator
(white, no hover, no pointer, no stop). Unchanged: the Unaired clock, the download disc in its states and a failure's red bang
stay indicators in their colours; a failure on an administrator's row disables the button meanwhile (no pointer, no stop,
nothing under the mouse) and gives it back when the failure clears. Cards are unchanged.

**Changed 2026-10-12 (P4.FU1): a download replaces the in-flight marks.** The grabbed arrow and the
downloading ring with its percentage are gone from `FileStateMark`; a title, season or episode on its way
shows the download of §3.3 instead (since 2026-10-13 the ring family's disc, P4.FU6), and in the corner that download wins
over Not Downloaded and Unaired (precedence downloading > Not Downloaded; on a row a failure takes the Not Downloaded button as
a red bang, never both). The magnifier while a title is searched for (no download exists
yet) and the retention countdown (a file on disk) keep their marks. A user who may not read the queue (403,
the queue kept to administrators) sees no download on cards or rows.

**Changed 2026-10-13 (P1.FU21, user: "it should be 10 episodes, screenshot showed nothing"): every season card says how
many episodes it has.** On a series page's Seasons row, upstream's own season cards (a Jellyfin season item, with or without
files) carry the same second line as the mod's missing season cards: `N episodes` (`1 episode`) under `Season N`, in the mod
cards' element and classes (`div.cardText.cardTextCentered.cardText-secondary` holding a `bdi`, 86 %), so both read alike. N is
the episodes Jellyfin has in that season (the season item's `ChildCount`, read with the page's own season list, no new wait);
for a season Jellyfin keeps with no episode (an empty folder) it is the entry's list for that season, as the mod's cards count.
No line when neither knows of an episode. A partly downloaded season shows Jellyfin's count alone: the mod's cards show no
"on disk of total" form, so neither does this line. The line is drawn into upstream's card (after its title; upstream's season
cards have no `.cardFooter`), so it goes and comes back with the card when upstream redraws it; nothing else on the card moves.
Only the native series page's Seasons row has it: season pages and library grids are unchanged.

### 3.2 Colour

State reads from shape and opacity first, colour second, because the TV is viewed at three
metres and the app has a dark theme with a user-set accent. Use the MUI theme's semantic slots,
never literal hex: `text.secondary` for wanted, `primary` for in flight, `text.disabled` outline
for archived. Nothing in the catalog introduces a new palette.

### 3.3 Downloads on cards and rows (P4.FU1, 2026-10-12; the ring family P4.FU6, user-approved 2026-10-13)

**The ring family** ([`design/download-state-ring-family.html`](design/download-state-ring-family.html), version 3 of the
artifact, its defaults; decisions in [`design/download-state-ring-family.md`](design/download-state-ring-family.md)) replaced
P4.FU1's white arrow in the count pill, the rows' bottom bar and the text figure at a row's end (user, 2026-10-13: "ring only,
arrow, time left: meta line + tooltip ... Redo all cards and details and rows with new approved design ... remove arrow from
the design but have two icons if the download in progress"). One disc, one arc, a glyph per state, drawn by one painter
(`components/DownloadStateMark.tsx`, `paintDownloadMark`; styles `downloadStateMark.scss`, `jfmod-dlmark-*`) everywhere:

| State | Glyph | Arc | Colour |
| --- | --- | --- | --- |
| Downloading | arrow, bobbing 0.2em every 1.4 s | the percent, from the top (`stroke-dashoffset = 100 − percent`), easing 0.35 s | the icon colour (P4.FU8) |
| Queued | clock | none | the icon colour |
| Importing | spinner arrow | a 28 % segment turning every 1.2 s | the icon colour |
| Stalled | pause | the percent at 55 % opacity | the icon colour at 55 % opacity |
| Failed | bang | none | red `#ff5a4f` (light scheme rows `#c62828`) |

**The icon colour (P4.FU8, user 2026-10-15: "replace yellow in this design to the color of icons, light for dark theme and dark
for light. Keeping it simple."; design: ring family artifact v12, *Revision 4* of
[`design/download-state-ring-family.md`](design/download-state-ring-family.md)).** Amber (`#ffb300`, `#ffb74d`, `#8a5a00`, `#ffd180`)
is gone from the whole download design; this supersedes every "amber" below and in §7.2.1 and §9.1. "The icon colour" is: on a
card the disc's glass ink (white; the light schemes' dark text); on a row the colour of upstream's round row icons beside it
(inherited, as the row's Not Downloaded mark since P1.FU22); on the episode page the page's text colour. The card's bar is that
colour at 85 %. Stalled is the same colour at 55 % opacity (arc, bar, number). The meta line's figures, the picker's added-row
figure and the detail line are the line's ordinary secondary text, with no colour of their own. Failed stays red. Accepted trade
(the design session's): a downloading row no longer stands out of a long list by colour alone; the full-opacity glyph beside
muted neighbours and the bobbing arrow carry it. The hover of a card disc is scale 1.08 only; a row's Not Downloaded keeps
P1.FU22's upstream round-icon hover (the primary glyph over its veil).

The figure is never inside the ring (the percent-inside and the caption and tooltip-only time placements stay in the artifact
for later, not built). It is on the **meta line** after the date, in upstream's own items: `42% · 12 min left` (`1 h 05 min
left` from an hour), `42% · stalled`, `queued`, `importing…`, `Failed · reason` (cut with an ellipsis); and in **every disc's
tooltip**, the only figure on a card: `Downloading · 42% · 12 min left · 3 MB/s` (the rate from the queue's
`downloadRateBytes`, the sum of the torrents downloading for a series or season), `Queued`, `Importing…`, `Stalled at 42%`,
`Failed · reason`. The queue has no position in the client's queue, so queued never says how many are ahead. One mapping words
both (`downloadProgress`, `aggregateProgress` and `describeDownload` in `constants/queue.ts`). A client that cannot be read keeps
its last value, the disc and figure dimmed.

- **Cards, everywhere cards are shown** (library grids, Home rows, search, Continue Watching and Next Up, season cards on the
  series page, upstream's season cards placed by P1.FU17, the mod's file-less and missing-season cards): a 1.6em **glass** disc
  (P4.FU7, user 2026-10-13: "switch from yellow to white card glyph, and use top bar's exact recipe"; a 1em white glyph, the arc over a
  white 30 % track) top right, the first of upstream's indicators, so it sits **left of
  upstream's played tick or count pill: two icons**, the pill untouched (no arrow in it); a card with no indicator cluster has
  it alone in the corner. The two-layer bar stays: 0.24em along the poster's bottom edge over a dark track, the download in
  the icon colour at 85 % beneath and the watched part in the primary on top (read from upstream's own bar, which hides meanwhile). A series or
  season card shows the mean of its episodes on their way (a pack counts once per episode it holds) and the liveliest state;
  queued draws the bar's track alone, importing a full bar breathing. A failed or finished download is not drawn on a card.
  The disc wins over Not Downloaded and Unaired in the corner (never both). A series or season card with nothing on disk and a download on its way
  keeps no Play: the administrator's cloud stays in its hover centre (§5.7, P1.FU19 and P1.FU23).

  **The card disc's glass (P4.FU7)** is the scrolled top bar's recipe, value for value (`homeChrome.scss`; `cardGlass.scss`
  shares it with the card's Not Downloaded and Unaired marks): the theme's bar colour (`--jf-palette-AppBar-defaultBg`) at 12 %
  over `blur(12px) saturate(180%) contrast(0.7) brightness(0.85)`; the light scheme 20 % with `saturate(170%)` and
  `brightness(1.1)`; Apple TV's lightened bar colour at 30 % with `brightness(1.15)`. The glyph and the arc take the bar's text
  colour: white on the dark schemes, the theme's dark text on the light schemes (track black 25 %); failed stays red (`#ff5a4f`,
  `#c62828` on the light schemes). Without `backdrop-filter` or `color-mix()`, and on the TV layout (where the bar itself stays
  blur-free), the disc is the solid black 66 % with the white glyph. Rows, bars, the picker, the Queue page, the detail line
  and the episode-page block took the icon colour in P4.FU8 (they were amber); the count pill and the played tick are unchanged. Not measured: the GPU cost of
  a blur per disc on a real phone or TV.
- **Rows** (the native and the mod's season page, the library list view and search lists): ring only, no bar. The disc is
  2.7816em with a 1.6696em glyph since P1.FU19, the box and glyph of upstream's round row buttons beside it (it was 2.5em and
  1.4em), transparent like upstream's round icons (the arc over the theme's track, filling the box), the **first round icon of the
  end slot**, before the Not Downloaded mark's place and upstream's own buttons; upstream's row padding, nothing added; nothing
  textual left of the icons. The figure goes into the row's meta line (upstream's `listItemMediaInfo` or the mod's), or, where
  the layout hides that line (upstream does below 50em, so the phone), as the last line of the row's text. A failure on a row
  that has the Not Downloaded mark takes that mark: the cloud replaced by a red bang, its tooltip `Failed · reason` (never the
  cloud and the bang both). Since P1.FU19 it is an indicator for everyone (no button, no D-pad stop, no "search again"); since
  P1.FU22 an administrator's row button there is disabled while the failure holds it. A failure on a row without one (a file on disk) is the red bang disc.
- **The episode detail line** (`QueueStatusLine`, also on a movie's and a series' page): the 2.5em disc, then `In the
  download queue · 42% · 12 min left`, then View queue where the queue may be opened. The mod's page for a missing episode
  showed it from P1.FU19 until P1.FU20 replaced it with the download block (§7.2.1).
- **The Queue page:** the disc in place of each row's state word (its tooltip the state, the reason line under it); a seeding
  copy keeps its word; the progress bar column stays.
- **The release picker's added row:** the disc takes the Add slot while the torrent downloads (the green tick when the queue
  cannot be read; the in-library row once imported); the X stays; the figure stays at the right end of the marks line; no bar.
  The Add slot is no control there: no pointer, no veil, no growth under the mouse (P1.FU19); the X keeps its hover.
- **TV and phone:** sizes in `em`, so TV 125 % and phone 90 %; no flex gap, `min()` or `max()`; nothing waits for a hover; the
  discs are not focus stops (since P1.FU19 not even a failure on a row; an administrator's row Not Downloaded, P1.FU22, is the
  row's second stop only while no download holds it). Reduced motion stops the
  bob, the turning arc and the arc's easing.
- **Data:** one `GET /JellyfinMod/Queue` when a page opens (the shared queue query, so every card and row of the
  page costs one request), then every 5 s only while something on the page is on its way. Upstream cards
  and rows are found by `data-id`/`data-type` (a native season or episode is placed by one `/Items` read per
  batch of new items: its series and numbers; a title the queue names without a Jellyfin item, a file-less series
  whose series item Jellyfin already holds, is matched once by its name and confirmed with `GET /Entries?jellyfinItemId=`; a
  native season's or episode's own series item is looked up the same way once, because with a library's automatic series
  grouping one show kept in two folders has two series items and the series page lists seasons of both, P1.FU17); the mod's own carry `data-jfmod-entry-id` with
  `data-jfmod-season` or `data-jfmod-episode-id`. The still on the mod's page for a missing episode carried them from P1.FU19
  (user: "Why it has this icon when download is going in progress on episode page?") until P1.FU20: since then the still is
  plain, as a downloaded episode's (user 2026-10-13: "I see no sense in download cloud over the episode card in episode page,
  too much information"), and the page's download block says the state (§7.2.1). One component draws them all
  (`integration/downloadMarks.tsx`, mounted once by the mod shell).
- **A pack's episodes each show their own file** (P4.FU5, user 2026-10-12: "Is there way to show per episode
  progress if the whole season or all seasons are downloading?"). An episode's row, card and detail line take its own
  entry of the queue's `pack.episodes` (`progress`, `sizeBytes`, `importState`) instead of the pack's figure, in the same
  wording: `42% · 6 min left` (its remaining bytes at the pack's current download rate; only the percent when the client
  does not list its file's size), `queued` while its file has not started, `importing…` once its file is
  finished (also before the import starts) or being imported, `Failed · reason` for its own blocked, failed or skipped
  import, and nothing once it is in the library. A season or series card keeps one bar and disc for the pack (the pack's
  whole torrent, counted once per episode it holds). A plugin without per-episode progress keeps the pack's figure on
  every episode. The queue page and the release picker's added row keep the pack's figure. One function draws the view
  (`packEpisodeView` in `hooks/useQueue.ts`).

*Superseded 2026-10-13 (P4.FU6):* P4.FU1's white arrow inside upstream's count pill (`jfmod-countArrow`), the amber arrow disc
(`jfmod-dlDisc`), the rows' 0.28em bottom bar (`jfmod-dlRowBar`), the figure at a row's end (`jfmod-dlRowFigure`) and the
picker's added-row bar (`jfmod-addedBar`) are gone.

---

## 4. The entry — one shape, two artwork sources

Cards, rows and detail pages all take a single normalised view model. This is the piece that
makes it possible to reuse upstream's `Cards` component untouched.

```ts
// features/catalog/types/CatalogEntry.ts
interface CatalogEntry {
    catalogId: string;
    tmdbId: number;
    mediaType: 'movie' | 'series';
    title: string;
    year: number | null;
    overview: string | null;

    state: CatalogState;
    presentation: 'available' | 'inflight' | 'wanted' | 'archived';  // derived, never stored
    monitored: boolean;

    jellyfinItemId: string | null;      // set from `imported` onward
    jellyfinItem: BaseItemDto | null;   // hydrated only where the grid needs playback state

    posterUrl: string;                  // resolved, see below
    progress: number | null;            // 0..1, `downloading` only
    watchedAt: string | null;
    reclaimAt: string | null;           // computed server-side, not days-remaining
}
```

**Artwork resolution** is the only branch: if `jellyfinItemId` is set, use Jellyfin's image
endpoint (it is cached, sized, and blurhash-backed); otherwise use the TMDB path the plugin
stored. `features/catalog/utils/entry.ts` owns `resolvePoster()` and nothing else does.

**`reclaimAt` is an absolute timestamp, not a countdown.** A server-computed "5 days left" goes
stale in a cached response and is wrong on a client with a skewed clock; the client formats the
countdown from the timestamp at render time.

**Correction (review 2026-09-18):** the implemented plugin never writes `watchedAt` or
`reclaimAt`; both are always null on the Entry DTO. The countdown comes from `retention.deadline`
in the retention summary on entry and episode detail (see [`API.md`](API.md),
Automatic retention; it currently exposes other users' activity to ordinary users, tracked as T15
in [`PHASE3.md`](PHASE3.md); plugin-authz-entries#3, medium, single-source), which keeps the absolute-timestamp rule above. Removing or deprecating the
dead fields is P11 in `PHASE1.md` ([`REVIEW-2026-09-18.md`](REVIEW-2026-09-18.md):
tests-contract#8, low, verified).

**`presentation` is derived on the client** from `state`, in
`features/catalog/constants/state.ts`. One function, one place, so a new state added server-side
fails loudly in one file rather than rendering as a blank badge in six.

---

## 5. The catalog grid (Phase 1)

### 5.1 Anatomy

```
┌──────────────────────────────────────────────────────────────────────┐
│  [tab strip: Catalog · Suggestions · Favorites · Collections · … ]   │  upstream tabs
├──────────────────────────────────────────────────────────────────────┤
│  1,284 titles      [sort ▾] [filter ▾] [view ▾]        [play] [⇄]    │  upstream toolbar
│                          └── one new group inside it (§5.2)          │
├──────────────────────────────────────────────────────────────────────┤
│  ▤ ▤ ▤ ▤ ▤ ▤ ▤                                                       │
│  ▤ ▤ ▤ ▤ ▤ ▤ ▤        stock Cards / ItemsContainer, unmodified       │
│  ▤ ▤ ▤ ▤ ▤ ▤ ▤                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

### 5.2 State is a filter group — not a tab, and not a chip row

Two tempting shapes, both rejected.

**A "Wanted" tab.** `CLAUDE.md` records that at 1920x1080 — exactly what the TV reports — the
header collapses to one row and the tab strip becomes a fixed fraction of the width that
*scrolls once the tabs outgrow it*. This fork has spent three recent commits making that strip
behave under a D-pad. Adding a tab spends that budget again.

**A chip row under the toolbar.** Better than a tab, and still wrong. It is a permanent extra
D-pad row above the grid, traversed on every single visit, to reach something used perhaps
monthly. It is a new affordance where one already exists. And an *Expiring soon* chip in
particular is a control that is empty most weeks and shouts on the few it is not.

**File state goes in the `Filter ▾` menu**, which already carries Played, Genre, Official
rating, Status and Features, and which already exists on every one of these surfaces. It gains
one group:

```
FILE            PLAYED           RETENTION
[x] On disk     [ ] Played       [ ] Due within 7 days
[x] Not downloaded  [ ] Unplayed
[ ] Downloading
[ ] Reclaimed
```

Checkboxes, so they compose — "not downloaded **and** unplayed **and** 2024" is one query. A
single-select chip row cannot express that, which is the second reason it was the wrong shape.
Filters are already reflected in `LibraryViewSettings`, so a filtered library is linkable and
survives a reload with no new plumbing.

Nothing is added to the page. That is the point.

### 5.3 Reusing the upstream grid

Checked against the tree, because the obvious plan does not work: `Cards` maps items to `Card`
internally and `Card` takes no children and no render prop, so **there is no extension point for
a per-card overlay**. Adding one means editing `Card`, which Principle 4 forbids.

The additive route is one level lower, and it is cheap:

```
CatalogGrid
  ├─ setCardData(entries, cardOptions)        imported from cardBuilder, as Cards does
  └─ entries.map(entry =>
        CatalogCard                            NEW — ~15 lines
          ├─ useCard({ item, cardOptions })    imported, unmodified
          ├─ CardWrapper                       imported, unmodified
          │    └─ CardBox                      imported, unmodified
          └─ CatalogCardOverlay                NEW — the top-left badge
     )
```

`CatalogCard` replaces `Cards` + `Card` — about fifteen lines of mapping and prop plumbing —
and reuses everything below them untouched: the card box, image container, blurhash, footers,
hover menu, shapes and `CardOptions`. That is the whole cost of not editing upstream's card, and
it is the right trade.

Everything around the grid comes from `features/libraries` as leaf imports where possible —
`SortButton`, `FilterButton`, `ViewSettingsButton`, `Pagination`, `AlphabetPicker`,
`ItemsContainer`, `NoItemsMessage`. Where a component is bound to the `useLibrary` hook, the
catalog gets its own thin equivalent rather than a refactor of upstream's hook.

### 5.4 Never unmount the grid

Principle 3, stated as an implementation rule because it is the D-pad bug class that will
actually happen:

- Every catalog list query uses `placeholderData: keepPreviousData` (react-query 5.91 is
  already the pinned dependency; nothing in the fork uses it yet). Pressing a chip re-queries
  but must **not** blank the container.
- Loading state for a *filter change* is a toolbar-level indicator, never a full-page `Loading`
  spinner replacing the grid.
- Loading state for a *first paint* is skeleton cards at the real card dimensions, so the grid
  does not reflow when data lands.
- The grid keeps a stable `key` across filter changes. Changing the key remounts, and remounting
  loses focus.

### 5.5 Sorting

Default sort stays upstream's — the library opens exactly as it does today. When the *Not
downloaded* filter is the only one applied, the default becomes **date added, newest first**,
because a wishlist is read as a queue and a wishlist sorted alphabetically is a phone book.

Two sort options are added to the existing Sort menu: **Date watched** and **Reclaim date**. They
join the list; nothing is taken out of it.

### 5.6 Empty states

Each is a distinct message, because "no items" for four different reasons is four different
next actions:

| Situation | Message | Action offered |
| --- | --- | --- |
| Catalog is empty (pre-backfill) | "Nothing in the catalog yet." | Search to add a title; and, for admins, a pointer to the backfill task |
| Filtered to *not downloaded*, none | "Nothing waiting for a file." | Search |
| Filtered to *downloading*, none active | "Nothing downloading." | Link to the wishlist |
| Filtered to *due within 7 days*, none | "Nothing is due to be removed." | Retention settings |
| Filter yields nothing | Upstream's `NoItemsMessage` | Clear filters |

### 5.7 Card interaction

- **Click / Enter** navigates. Where it navigates depends on state, and this is deliberate:
  every entry goes to the **stock detail page** (`/details?id=`), whether or not it has a file.
  There is only one detail page — see §7.
- **Exactly one focusable element per card.** Upstream's hover menu is mouse-only and stays that
  way. Catalog actions on the TV come from the context menu (long-press / Menu key), never from
  a second tab stop inside a card.
- **Context menu** keeps every upstream entry and adds three below them: *Search releases*
  (Phase 4), *Keep* (Phase 3) and *Remove entry*.
- **Get a Release on a card** (P1.FU12, user-approved design 2026-10-12). For administrators, where
  the plugin serves release search, on movie, series, season and episode cards whose title the plugin
  has an entry for (series and seasons only with pack search): on the desktop an icon in upstream's
  hover overlay, after Favorite and before More (Play · Played · Favorite · Get a Release · More), the
  detail header's `cloud_download` glyph in the overlay's own round button classes, the stock hover,
  a cyan ring on keyboard focus; its tooltip is *Get a Release*, or *Get Another Quality* for a movie
  or episode on disk. The card's item menu carries the same item on every layout (the overlay's More,
  a right-click, the TV's Menu key, a phone card's More where upstream draws one). Choosing it opens
  the release picker in the card's scope, as the item's own page does (a series as the series page, a
  season on that season, an episode on that episode, a movie as the movie page), without leaving the
  page. Upstream's overlay is not edited: a `MutationObserver` inserts the icon into each
  `.cardOverlayContainer .cardOverlayButton-br` before its `data-action="menu"` button
  (`integration/cardGetRelease.tsx`); the menu item comes through `moreMenuItem.ts`'s card items,
  matched at the action sheet by the card it opens from. Not covered: the phone's library grids and a
  series page's season cards, where upstream draws only Play and a long press starts multi-select;
  there the item's own page has the header icon.
- **Get a Release is there when its card, menu or header is** (P1.FU23, user 2026-10-13: the season card's cloud "was not there
  and appeared after about 1 second ... Fix it everywhere"). Every cloud is drawn from what is known when its card, menu or
  header is drawn, never after a request: the administrator flag, the plugin's capabilities (the last Health answer is kept in
  this browser, so a start or a deploy does not wait for it; a failed read forgets it) and the card's or page's own type. The
  card icon is inserted by the observer in the same task that drew the card (and again after any redraw), so it is in the card's
  first frame; whether the title has an entry is asked when the card is first hovered or focused, and the rare card whose answer
  is no (no entry, a special) loses the icon then (on 28096 one title of 164, no season or episode). The card menu's item is in
  the sheet when it opens (it no longer waits for that answer: before, the TV's menu on a season card opened after about
  0.8 s); an answer already in gives its label or no item. A native page's header icon follows the page's item type until its
  entry is read, and is inserted in a layout effect, in the same frame; a press before the entry is in shows upstream's spinner
  and opens the picker when it is. Choosing a card's icon or item before its answer waits for it and opens the picker; a title
  without release search says "Get a Release is not available for this title." and the icon goes.
- **A card with nothing on disk has no Play** (P1.FU19, user 2026-10-13: "We don't need Play. Instead of Play there should be
  the Cloud to download the season"). Upstream's season cards on a series page with no episode on disk (P1.FU17's rule, a
  download in progress included) and a library entry's native card with nothing on disk carry `data-jfmod-nofile`: upstream's
  centre Play (and the phone's overlay Play) is hidden on them for everyone, and an administrator's Get a Release takes the
  centre in Play's own round classes (`cardOverlayFab-primary`, the same size, hover and place), with no second cloud in the
  bottom row; Played, Favorite and More stay where upstream puts them. The mod's own file-less title cards and missing-season cards get the same centre icon
  on the desktop hover, drawn in upstream's overlay classes (`CardHoverGet`; they have no other hover items). An ordinary user's
  centre stays empty; the card stays clickable as before. A season with a file keeps upstream's Play. Keyboard: Tab from the
  card reaches the centre icon, never a Play. TV and phone have no hover overlay: the card's menu item is the way there, and the
  mark is no second stop (§3.1).
- **Any series or season Jellyfin holds no episode of has no Play either** (P1.FU23, user 2026-10-13 on Kleo's library card:
  "Supposed to be Cloud download instead of Play button as nothing available to play"). P1.FU19 marked only the cards whose owner
  knew they had no file (a series page's season cards, the mod's entry cards); upstream's own cards elsewhere (library grids,
  search, Home rows) carried no mark, so Kleo, a series item with no season and no episode (its entry `none`), kept Play. Now one
  read per user lists every series whose recursive episode count is 0 and every season whose child count is 0 (two Jellyfin
  item reads, series with user data because that count is only filled with it; a season's own count, because with automatic
  series grouping a season's series id can name another series item of the same show), kept in this browser and read again
  when the catalog refreshes on a library change. Their cards carry `data-jfmod-empty` from their first frame, with the same
  effect as `data-jfmod-nofile`: no Play for anyone, an administrator's cloud in the centre. A series with any episode keeps Play
  (it has a file: Jellyfin has no virtual episodes here); movies and episodes always have a file in Jellyfin, and a reclaimed
  title's kept card keeps P1.FU19's rule. A download on its way does not change this (the card shows its download and the
  centre cloud).

---

## 6. Search

One box. **Two zones: what you have, and what is left over.**

The first zone is upstream's search, unchanged in shape and unchanged in headings — `Movies`,
`Shows`, `Episodes`, `People`, `Studios` and the rest, exactly as `useSearchItems` builds them
today. The only difference is that the `Movies` and `Shows` sections now also contain entries with
no file yet, because those are library entries like any other.

The second zone is **Add from TMDB**, appended at the end, and it is defined by subtraction:
every TMDB result carrying an id you already have is removed from it server-side. A title is
therefore in exactly one place, always, and the user never chooses an index or reads a heading to
work out which list a film is in.

### 6.1 Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│  🔍  blade                                                 [alpha]   │
├──────────────────────────────────────────────────────────────────────┤
│  MOVIES                                          (upstream heading)  │
│  ▤ Blade Runner 2049   ▤ Blade Runner ▣archived                      │
│                                                                      │
│  SHOWS                                           (upstream heading)  │
│  ▤ Blade Runner: Black Lotus ◌no file                                │
│                                                                      │
│  EPISODES · PEOPLE · STUDIOS · …                 (upstream, as-is)   │
├──────────────────────────────────────────────────────────────────────┤
│  ADD FROM TMDB — not in your library                      [skeleton] │
│  ▤ Blade  [+]   ▤ Blade II  [+]   ▤ Dangerous Days…  [+]             │
└──────────────────────────────────────────────────────────────────────┘
```

`Movies` and `Shows` are upstream's own section titles and they keep their upstream meaning:
everything of that type. The 2017 film you can play, the 1982 one whose file was reclaimed and the
series you have only asked for sit in the same row, sorted together, each carrying its file mark.

**Add from TMDB is last and it is the leftovers.** It is the only new heading on the page, and it
earns it by being defined as *not any of the above*.

### 6.2 What each zone queries

| Zone | Source | Covers | Phase |
| --- | --- | --- | --- |
| Everything upstream renders | stock `/Items` search, unchanged | every entry, file or no file | 1 |
| **Add from TMDB** | `GET /JellyfinMod/Discover/Search` | everything else in existence, minus your ids | 1 |

The first row of that table is the whole reason the STRM decision matters, and it now pays twice:
a reclaimed title is a real library item, so it comes back from the stock search index on every
client with no plugin involvement — and a *wanted* title, once it also has a placeholder, does the
same. "What did I watch two years ago" and "what did I ask for" are both answered by upstream's
own search.

**[model note]** For a wanted entry to appear in stock search it needs a library item, which means
extending the STRM placeholder from `reclaimed`-only (README §9.2.1) to `wanted` as well. That is a
change to the hybrid split in the README and should be taken deliberately: it makes the wishlist
visible in Kodi and Swiftfin, which README §9.2.1 explicitly did not want. The alternative is that
file-less entries are merged into the results client-side from the plugin, and the *headings* stay
unified even though the queries are not. **Recommended: merge client-side, keep placeholders for
`reclaimed` only.** The user sees one list either way; only Kodi can tell the difference.

### 6.3 Deduplication

One rule: **a TMDB result carrying an id you already have never appears.** The plugin knows every
id it holds, so the filtering happens server-side in `Discover/Search` and the client does no
merging at all.

**[API addition]** `GET /JellyfinMod/Discover/Search` takes the exclusion set from the plugin's own
table rather than from the request, and returns only leftovers.

Titles with no TMDB id — hand-added library items, mostly — cannot be excluded and may reappear as
a TMDB suggestion. Adding one then produces a second entry, which is the one duplicate this design
can create. It is rare, it is visible, and the fix is a "these look like the same film" merge on
the entry page rather than more machinery in search.

### 6.4 Timing, and why the layout must not jump

Tiers 1 and 2 are local and cheap. Tier 3 is a network call through the plugin to TMDB and will
land hundreds of milliseconds later.

- **Local tiers debounce at 250 ms**, minimum query length 1.
- **TMDB debounces at 600 ms**, minimum query length 2, and is never fired on a query that is
  still growing fast.
- **Tier 3 renders into a reserved slot from the moment there is a query** — a titled section
  with skeleton cards at final dimensions. It never appears from nothing and pushes the tiers
  above it down. On the TV, content arriving above the focused element moves the focus ring, which
  is Principle 3.

The stock page debounces everything at 500 ms in the route (not in `SearchFields`), so the new
route is free to choose its own values without touching upstream.

### 6.5 Reusing the stock sections without editing them

The catalog owns movies and series. Episodes, people, studios, artists, albums, songs, books and
live TV must keep working exactly as they do now.

`useSearchItems` returns an array of sections. The new search page calls it, **filters out the
`Movies` and `Shows` sections in its own code**, and renders the remainder with the stock
`SearchResultsRow` leaf component. Zero upstream files modified; the catalog tiers sit above, the
untouched rest sits below.

### 6.6 Adding from search — the interaction that has to be right

This is the flow that gets used most, and the temptation is to open a dialog. Don't.

1. `[+]` on an **Add from TMDB** card.
2. The card **transitions in place** up into the `Movies` or `Shows` section (optimistic update),
   because that is now where it lives — the entry exists the moment you press the button.
3. A snackbar confirms: *"Added to catalog"*. Admins also get **Undo**; ordinary users do not.
   Change profile belongs to the later phase that implements quality profiles.
4. **The search field keeps focus and keeps its query.** Three films can be added in a row
   without a single navigation.

No quality-profile dialog on add. The default profile is used, and the snackbar's *Change
profile* is the escape hatch. A modal per add makes batch adding impossible on a desktop and
genuinely painful on a D-pad, and the profile is the wrong one perhaps one time in twenty.

`Undo` removes a saved entry and is admin-only. Ordinary users cannot invoke it through another
endpoint either. A failed create still rolls back its optimistic UI for every user.

**Proposed (review 2026-09-18, not user-approved):** four search rules, tracked as W9 and W13 in
`PHASE1.md` ([`REVIEW-2026-09-18.md`](REVIEW-2026-09-18.md)):

- The **Add from TMDB** row is a horizontal `emby-scroller` row, like the stock sections, so every
  result — including later pages and series after many movie pages — is reachable by touch, mouse
  and D-pad. Today it is an `overflow: hidden` row that clips everything past the first screen
  width (web-library-search-details#2, high, verified; W9).
- The chosen target library persists for the session instead of resetting on every query edit
  (web-library-search-details#7, low, single-source; W13).
- A pending card, shown while its add request is in flight, stays focusable but is not
  navigable; it opens nothing until the real entry id arrives (web-library-search-details#8, low,
  single-source; W13).
- Admin **Undo** must be reachable on TV: focus moves to it, or it is an inline focusable control
  that outlives the 4-second toast (prior-L1, low, verified; W13).

### 6.7 Empty query

The stock page shows `SearchSuggestions`. The catalog page shows, in order: a **Wanted** row
(newest first, capped at ~12) then the stock suggestions. The wishlist is the thing you most
often open the search page to act on.

### 6.8 No results

If all three tiers are empty, one message with one action — retry against TMDB with the raw
query, unfiltered by media type. If tiers 1 and 2 have results and TMDB failed, the failure is
an **inline notice inside the Add from TMDB section only**. A TMDB outage must never blank a
search over your own library.

---

## 7. Detail pages

**There is one detail page: upstream's.** Principle 0. Cast, chapters, media info, trailers,
similar titles, the version selector, the audio / video / subtitle dropdowns, the More menu —
all of it stays exactly as it is, for every entry, whether or not a file exists.

An entry with no file simply has less to fill it with: no media info, no version selector, no
play button. In its place the page carries the one action that entry needs — **Search releases** —
and the same collapsed history line every entry gets (§7.2). That is the entire difference.

Sketch of a file-less entry on the stock page:

```
┌──────────────────────────────────────────────────────────────────────┐
│  [backdrop, TMDB]                                                    │
│                                                                      │
│   ▤   NOSFERATU                                                      │
│       2024 · Horror                                                  │
│                                                                      │
│       [Search releases]   [♥]   [⋯]      ← upstream's own button row,│
│                                            minus Play, plus one      │
│       Overview…                                                      │
│                                                                      │
│       › Added 12 Aug · last searched 2h ago                          │
│                                                                      │
│  ── CAST ── SIMILAR ── (every upstream section, unchanged) ──────    │
└──────────────────────────────────────────────────────────────────────┘
```

An entry that *has* a file is identical to today, plus the same two additions: **Search releases**
in the More menu (to get a better quality) and the history line.

For series, upstream's season and episode lists stay as they are; each episode row carries the
file mark from §3, and season rows gain a monitor toggle.

**Episode and movie pages as built since the 0.1.0.0 design fix (user, 2026-10-07).** The
[design record](design/episode-page-design-spec.md) is binding; in short:

- **Labels** follow the user's Title Case rule of 2026-10-08 (*Get a Release*, *Get Another Quality*, *Remove After
  Watching…*); row actions are round icon buttons and full-size buttons are red, blue or grey (see the design record).
- **Header.** Administrators get one stock-styled icon, *Get a release* (`cloud_download`), in
  upstream's button row before Favorite. It opens the release picker (the `addVersion` intent when
  the title has a file). With no file it leads the row, since Play and Played are absent.
- **Video row.** With two or more files the Video value is the file chooser (§11): a chevron opens a
  list of the files, one row each, with history, pin (Keep) and cross (Remove this version) icons and
  a last row *Get another quality*. With one file the Video row is upstream's, with the same three
  icons at its end. Pin and cross are administrators'; history is everyone's.
- **History** is per file, in a popover opened from that file's history icon (§7.2).
- **Retention** is a countdown badge on the stock Played tick (§8); the warning box is gone.
- **More menu.** Administrators find *Remove after watching…* in upstream's More (`⋯`) menu on an
  episode page; it opens a small dialog with the episode window select.
- **Gone from these pages:** the mod's button row (Search releases, Get another quality, Keep,
  Stop keeping, Keep *version*, Remove *version*, Search now), the History toggle and list, the
  retention warning box and the "Automatic removal is off." line. A one-line retention status stays
  only for a blocked or mixed state and the protection reasons, which the badge cannot show. The
  queue status line stays where it is.
- **No file** (the mod's file-less page): its button row goes; where the track block would be it shows
  one raised *Get a release* button for administrators, replaced by the queue line while a grab or
  download is in flight. Its header row holds the *Get a release* icon and a stock-style More (`⋯`)
  button with **Monitor** and **Remove entry** (user, 2026-10-07), administrators only. Ordinary users
  see the overview and, during a download, the queue line. A file-less series keeps its rows.
- The series page is unchanged (since P1.FU11 it also lists every season, §7.2.1).

**More-menu coupling (2026-10-07).** P7.S6 removed the More-menu hook. The design fix brings an
item back without an upstream edit: the mod's integration wraps `itemContextMenu.show` at runtime
for the open detail page only, adding its items to the action sheet that call opens (several at once
since P1.FU12: a series page's Keep Series and Shuffle). A card's menu does not pass through that
export (`shortcuts.js` calls the module's named `show`), so card items (P1.FU12, Get a Release) are
matched at the action sheet instead, by the movie, series, season or episode card it opens from. If the
wrap finds nothing to wrap, the menu is exactly upstream's and the item is simply absent. Parity check
on every upstream merge: `itemContextMenu`'s default export still has `show`, `show` still opens the
sheet through `actionSheet`'s default export, and a card's menu still opens it with `positionTo` inside
the card.

**Phase 1 scope accepted, 2026-09-06:** file-less shows also expose individually tracked episodes,
not only season summaries. Show missing versus unaired availability and persist episode monitoring
settings, editable by admins only. Existing downloaded episodes retain native navigation and
playback. Monitoring does not initiate downloads until acquisition is implemented. `PHASE1.md` §5
defines the identity, metadata-refresh and permission requirements.

### 7.1 Where Search releases lives

In upstream's existing button row for a file-less entry — where Play would be — and in the
**More** (`⋯`) menu for an entry that has a file. Both are insertion points that already exist. It
is also on the card's context menu in the grid, so it is reachable without opening the entry.

**Since the design fix (2026-10-07)** release search on an episode or movie page is the *Get a
release* header icon (§7), plus the raised *Get a release* button where the track block would be on
the file-less page. *Search now* is no longer on either detail page: the picker shows the releases
and grabs one, and automation searches on its own schedule (its API endpoint stays).

### 7.2 History is one line

The activity trail is what makes an entry a record rather than a queue — and it is worth reading
about twice a year. Given a whole section on the page it reads as though the app is proud of it.

So it is **one line**, in the metadata run where a watched date belongs, expanding only on click:

```
  › Watched 9 Mar 2024 · file removed 23 Mar
    ├ 4 Mar 2024   Grabbed 2160p WEB-DL from HDBits
    ├ 4 Mar 2024   Imported by hardlink · seeded to ratio 1.4
    ├ 9 Mar 2024   Watched
    └ 23 Mar 2024  File removed · 24.1 GB reclaimed · placeholder kept
```

Collapsed, it shows the one fact worth surfacing — **when you watched it** — which on an archived
title is the only thing the page can still tell you about your own use of it. Everything else is a
question you ask when something has gone wrong, and that is an expander, not a section.

On the TV it costs one focusable line instead of a section the D-pad travels through every visit.

**Superseded on episode and movie pages (user, 2026-10-07).** The one-line History toggle is gone
from the episode and movie pages. History is per file: the history icon on a file's row (or at the
end of the single Video row) opens a small MUI popover titled with the file's short description
(`1080p · HEVC 10-bit · 783 MB`), listing only that file's events, newest first, with short dates
(`28 Sep`, `28 Sep 2025` in another year) and action words without the file name: Grabbed, Imported,
Kept, Stopped keeping, Removed. Back closes it and focus returns to the icon (§13 rule 9). The
plugin stamps each history event about one file with that file's binding id (`bindingId`, Health
capability `history.files`); older events without one appear in no popover. Episode-level events
(monitoring changed, added to the catalog, window changed) are not shown on the episode page. The
series page and the file-less page keep their History line.

### 7.2.1 Native pages show every season and episode (P1.FU11, user-approved design 2026-10-12)

A series' native pages list every season and episode the plugin knows, not only those Jellyfin
holds. The plugin's list comes from the one entry read the page already makes, after the page-open
TMDB load (P1.FU9); nothing new is asked of the plugin. Since P1.FU14 (user, 2026-10-12: "those must be
imported too with all descriptions and related information - exact like when episode exists") they
look like items that exist: TMDB's art, overview, runtime, air date and rating, from the entry's own
data. Images come from `image.tmdb.org` (`<img loading="lazy">`, `object-fit: cover` in upstream's
image box, so nothing moves while they load); one that fails to load (offline, a blocked CDN) falls
back to the dashed placeholder with the number, as does a season or episode TMDB has no image for.

- **Series page.** For each plugin season (specials excluded) with no Jellyfin season item, a mod card
  in upstream's Seasons row (`#listChildrenCollapsible .itemsContainer`), in season order among
  upstream's cards, same size and card classes: TMDB's season poster (w342) in the card's image box,
  rounded as upstream's (else a dark placeholder with a 1px dashed edge and the season number), the
  mark top-right (§3.1), *Season N* and *8 episodes* (*1 episode*) as the footer.
  Clicking it (Enter on the TV, where the card is a focus stop) opens the mod's season page; on the desktop an
  administrator's hover shows Get a Release in its centre (§5.7, P1.FU19). Upstream's own season cards keep everything upstream draws (no footer rewrite); since P1.FU17
  they carry the mark when none of their episodes is on disk (§3.1).
- **Season page.** For each plugin episode with no Jellyfin episode at its number (a multi-episode
  file holds every number it spans) and not on disk, a mod row among upstream's `listView` rows in
  episode order: TMDB's still (w300, w500 on the TV) in upstream's row image box (else a dashed 16:9
  placeholder with the number), *4. Title*, the meta line in upstream's own items: the air date (*19
  May 2027*), the runtime in upstream's format (*42m*, *1h 2m*) and TMDB's rating with upstream's star
  (*★ 7.6*, only when TMDB rates it); unlike upstream's `listItemMediaInfo` it stays on the phone, so the
  air date does. The overview when the plugin has one (none on the phone, by upstream's own rule), no
  play overlay, and the mark at the row's end. Since P1.FU15 (user, 2026-10-12) the whole row opens the
  episode's page (below): a click anywhere on it, its title being the link for the keyboard. On the TV the row
  is a focus stop like upstream's rows (Enter opens the page). This replaces "rows are not stops". (Until P1.FU19 the
  administrator's icon was a second stop with its own click; the mark is an indicator now, §3.1.)
- **The mod's season page**, `#/details?entryId=<entry>&season=N`, for a season Jellyfin has no item
  for: upstream's detail template with the series' name, *Season N · 8 episodes · 2023* (the season's
  first air year), the TMDB season poster, TMDB's season overview where upstream puts an item's
  overview, Get a Release for the season in the header (administrators, where packs are served), and the
  season's episodes as the same mod rows in upstream's episode list.
- **The mod's episode page**, `#/details?entryId=<entry>&season=N&episode=M` (P1.FU15, user 2026-10-12: "it
  should be identical to what downloaded have"), for an episode Jellyfin has no item for, laid out as
  upstream's page for a downloaded episode: the series' name over *Season N - M. Title* (both links, to
  Jellyfin's series and season pages where it has them, else to the mod's), the meta line (the air date in
  upstream's short form, the runtime, TMDB's rating, and since P1.FU20 the series' certification as upstream's rating box),
  TMDB's still (w300, w500 on the TV) as the detail image, plain since P1.FU20 (else the dashed placeholder), the download block
  (below), the series' genres in upstream's genres line, the overview, the *Director* and *Writers* lines,
  **Cast & Crew** (the series' regular cast with "as Character", then the directors, writers and producers,
  one card per person with their roles joined by " / ", as upstream merges them) and **Guest Stars** (TMDB's
  order). Person cards are upstream's people cards: TMDB's portrait (w185) or the person icon on the default
  background, the name and the role; they link nowhere, as Jellyfin has no person items for these people
  (on the TV they are focus stops that only scroll their row, as upstream's are). Administrators get Get a
  Release for the episode in the header. Once Jellyfin has the episode, the route opens Jellyfin's own page.
  Differences from a downloaded episode's page, and why: no play, played, favourite or More buttons, media
  info or chapters (no file); the regulars are the series' current regulars from TMDB's series credits, not
  the episode's own cast list (one more request per episode otherwise); the series backdrop, not one of the
  episode's own; names are plain text, not links to person pages.
- **The download block** (P1.FU20, user-approved design 2026-10-13,
  [`design/missing-episode-page-download-block.html`](design/missing-episode-page-download-block.html) and
  [`.md`](design/missing-episode-page-download-block.md), version 2 of the artifact; user: "Looks good besides I see no sense in
  download cloud over the episode card in episode page, too much information"). One panel in the theme's paper where a
  downloaded episode's page has its Video / Audio / Subtitle selectors (before upstream's hidden `.trackSelections`, at most
  60em wide), drawn by `components/DownloadBlock.tsx` (`downloadBlock.scss`). On the left the ring family's disc at the `page`
  size: 4em, transparent, the percent inside (`42%`) while it downloads or stalls, else the state's glyph (cards and rows keep
  the arrow; 3.2em on the phone). On the right, by state:

  | State | Ring | State line | Lines below | Actions |
  | --- | --- | --- | --- | --- |
  | Downloading | `42%` inside, the arc in the page's text colour | **Downloading** `42% · 12 min left · 3.1 MB/s · 1.9 of 4.6 GB` (the text colour) | release, marks, pack line, bar | View Queue · Cancel Download (administrators) |
  | Stalled | `42%` dimmed, arc dimmed | **Stalled** `42% · no progress for 20 min` | release, marks, pack line, bar dimmed | the same |
  | Queued | clock | **Queued** `waiting to start` | release, marks, pack line | the same |
  | Importing | turning arc | **Importing** `identifying the file…` / `linking into the library…` / `waiting for the library scan…` | release, marks, full bar breathing | View Queue |
  | Failed | red bang | **Failed** the reason in red | release, marks | Search Again (red, administrators who may search) · View Queue |
  | Not downloaded | cloud in the text colour | **Not Downloaded** (`no release chosen yet` for everyone else) | — | Get a Release (blue, administrators who may search) |
  | Unaired (with an air date) | clock | **Unaired** `airs 19 May 2027 · in 7 months` (`in N days` under 30 days) | — | — |

  The release is the queue row's name in a small monospace line. Its marks are the picker's: quality and source
  (`1080p WEB-DL`), the codec and audio marks (`MediaMarks`), the languages, the release's size (a pack's whole torrent) and the
  indexer's name as plain text (the plugin keeps no release page link after a grab), then the client's Open icon for
  administrators (`Open Transmission`, not on the TV, as the picker). A pack's line reads `Season 1 pack · this episode is file
  6 of 10`, then one dot per pack episode: green imported, the text colour its file finished (importing), the text colour filled to its percent
  while it downloads, grey waiting, red failed; this episode's dot ringed. The bar is 0.28em. The figures are the episode's
  own file for a pack (P4.FU5, `packEpisodeView`); the rate has one decimal (`3.1 MB/s`). View Queue is a link for everyone who
  may read the queue; Cancel Download is upstream's grey raised button and asks the picker's *Remove the Torrent*
  (`DELETE /Queue/{id}` with `removeFromClient`, no blocklist; for a pack the whole torrent); Search Again and Get a Release
  open the picker on this episode. The ring, the marks and the strip are no stops; on the TV the D-pad goes from the header's
  Get a Release down to View Queue, right to Cancel Download, down to the person cards. Reduced motion stops the arc and the
  bar's breathing. Data: the shared queue read (every 3 s once a download was seen on the page, else once a minute and on each
  page open); while the queue cannot be read the entry's projected state shows the figures alone. **Imported:** when the queue's
  row reaches `seeding` the page reads its entry again; once the episode is on disk with its Jellyfin item, the page is replaced
  by Jellyfin's own episode page (its Video / Audio / Subtitle selectors and Play). A finished row for an episode that has no
  file now is history and not shown. **Metadata:** the series' certification (the US one, else the first TMDB lists) on the
  misc line, and its genres (`Comedy, Drama`) in upstream's genres line, from the entry's stored TMDB metadata; keywords,
  networks and production code are not shown.
- **Pickers**: the scopes the marks opened until P1.FU19 (a season on that season, *Season N*, *All Seasons*; an episode on
  that episode; a movie card as the movie page; a series card as the series page) are now opened by the cards' centre Get a
  Release (§5.7), the item menus and the pages' header icon; the marks are indicators (§3.1).
- **How it is mounted**: DOM inserts into upstream's list, placed again by a `MutationObserver` when
  upstream redraws the list, drawn by React through portals (`components/MissingChildren.tsx`). No
  upstream file is edited.

The season overview and the episode ratings are kept in the entry's TMDB metadata (`seasons[].overview`,
`episodeRatings` by TMDB episode id), not on the episode rows, so no column was added. A series whose
list was loaded before P1.FU14 has neither; opening it loads its list once more (the P1.FU9 load), and
an administrator's Refresh does the same. Cast, guest stars and crew came with P1.FU15: each episode's in the
nullable `Episodes.CreditsJson` column, the series' regulars as `cast` in its metadata; a series loaded before
loads its list once more the same way. Not shown for a missing episode: upstream's *Ends at* (nothing to play).

Not in this slice: the downloading states (the two-layer progress bar, the arrow in the count pill,
the row's percentage and time left; §3.3, P4.FU1, since replaced by the ring family, P4.FU6), the card hover Get a Release (§5.7) and the
Shuffle change (§1.1 exception 3), both P1.FU12.

---

## 7.3 Home: two merges, and a Netflix-shaped top bar

Home keeps Jellyfin's rows, cards and scrollers. Two sections merge, and the chrome above them
changes shape — the one place this design departs from upstream's look rather than adding to it.

**The top bar overlays the page, Netflix-style.** Text-only view links (no icons), muted until
active, sitting on a gradient over the content and turning solid `#101010` once you scroll past
~40px. Same items, same right-hand buttons, same routes — a restyle of `AppToolbar` /
`UserViewNav`, not a replacement, so Principle 0 holds.

**Scrolled, the bar is frosted glass on computer and phone, on every page (user, 2026-10-08; made more see-through twice on 2026-10-09; extended from Home to all pages 2026-10-10):**
the page shows through it, blurred and softened, instead of a solid colour. The first version held light text at 4.5:1
even over a plain white area of a poster, which kept the dark themes to about a quarter of the page showing through; the
user tried it and asked for more, then for more again. Readability no longer sets the limit: the bar barely tints or
darkens the page (the theme's bar colour at 12 %, page at 85 % brightness, blurred 12px; light themes 20 % with a lift,
Apple TV 30 % with its own lighter tint). What keeps the labels readable is flattening the page behind them,
`contrast(0.7)` in the backdrop filter in every theme, which squeezes the bright patches that wash a label out; the user
picked it over a text halo, an outline and a darker tint (options and measurements in
`design/topbar-glass-readability.md`). No line or shadow marks the bar's lower edge. Over real posters the worst label
still falls below 4.5:1 (PHASE7 §S6); the user accepted that trade-off. Wherever the engine has no `backdrop-filter` or
`color-mix()` the bar stays upstream's solid one.

**On TV the bar stays transparent (user, 2026-10-08):** its top-to-bottom dark scrim is its only treatment, with no fill
and no blur; a full-width blur would cost D-pad scrolling on the webOS engines. The TV's header is part of the page, not
fixed, so it scrolls away with Home: it sits on the page ground above the hero and is gone before any poster row reaches
the top of the screen, and the scrim fades to nothing at its lower edge, so there is no seam.

**It only works with a billboard under it.** A transparent bar over a row of thumbnails is
unreadable; over a full-bleed backdrop it is the whole point. So Home opens on a hero: one entry's
backdrop, its title, a short overview, **Play** and **More info**, fading into the first row. That
hero is the real cost of this decision — it is a new Home component, and it pushes the first row
below the fold. Worth it, but it is a trade, not a freebie.

Then the two merges:

**Continue watching + Next up become one row.** The distinction between "resume this film" and
"start the next episode" is an implementation detail of where the playback pointer sits; as a
person it is one list of what you are in the middle of. Splitting it means scrolling past films to
reach the episode you stopped on last night.

**Recently added merges Movies and TV Shows into one row.** A row per library reintroduces a
division that no longer exists anywhere else now that an entry is just an entry.

Entries with no file appear in Recently added — that is the point of the entry existing before the
download does — carrying the same mark as everywhere else; clicking one opens the entry, where
**Search releases** is. Everything else on Home is untouched.

**Proposed (review 2026-09-18, not user-approved):** ordering rules for the merged rows and the
hero, tracked as W10 and W12 in `PHASE1.md` and T14 in `PHASE3.md`
([`REVIEW-2026-09-18.md`](REVIEW-2026-09-18.md)):

- **Approved (user, 2026-10-08: "sort next up by when I last watched the show"):** in Continue
  watching, and so in the Home hero, a Next Up item's recency key is the date the user last played
  any episode of that series, not the episode's library `DateCreated`; a series with no play date
  keeps `DateCreated`, and resumed items keep their own last-played date. The Next Up query honours
  the user's *max days in Next Up* and *rewatching* settings as upstream does; the *episode images*
  setting is not applied to the merged row yet (web-home-rules-tv#5). Implementation and evidence:
  [`PHASE7.md`](PHASE7.md) §S6.
- Recently added sorts grouped series by `DateLastMediaAdded`, falling back to `DateCreated`, so a
  batch of new episodes of an old show is not buried (web-home-rules-tv#6, medium, verified).
- Reclaimed entries are excluded from Recently added; only file-less *wanted* entries appear there
  (critic-journeys#5, low, single-source).
- The hero honours Latest exclusions, shows Play only when `canPlay` allows it, uses translated
  labels and follows the selected theme (web-home-rules-tv#7, low, single-source).

**Correction (review 2026-09-18):** the top-bar styles above do not apply in the modern layout.
Its selectors target `.skinHeader`, which the modern layout hides, so desktop and mobile show the
stock opaque app bar (web-home-rules-tv#4, medium, single-source). The accepted redesign stands;
W12 in `PHASE1.md` makes it apply and re-verifies it in every layout.

---

## 8. Retention (Phase 3)

Read `PHASE3.md` for the current task plan and proposed refinements, including file-less
representation without STRM placeholders in place of the older assumption in §8.1 below.

**Watched-user setting, accepted 2026-09-11:** under the admin retention checkbox, show
**All users** (default), **Selected user** with an account picker (for example admin/oleksii),
or **Any user**. This setting determines whose completion starts the timer. Global disabling
still prevents expiry, and independent protection checks remain in force.

**Accepted:** expiry is automatic unless an admin disables retention. The scheduled job reclaims
eligible files without a confirmation for each title, preserving the catalog entry and history.
Admin-only removal controls do not prevent this server-side task from doing its work. The task
must honor the disabled setting even when run manually and retain all existing deletion safeguards.

Retention is the feature most likely to be designed as ambient anxiety. It must not be.

**The card shows nothing until it matters.** No countdown on a watched card with three weeks
left. A small countdown appears on the card only inside the **last 72 hours**, and on every card in
view when the *Due within 7 days* filter is applied. A grid where every poster is ticking is a grid
nobody enjoys browsing.

**The detail page always shows it**, as one line under the title: *"File will be removed in
5 days"* with a single **Keep** button beside it.

**Superseded on episode and movie pages (user, 2026-10-07).** The detail page shows a scheduled
removal as a **countdown badge on upstream's Played tick**: a bare bold number over the tick's
lower-right arm, white with a soft `#101010` halo, about 0.6em — the whole days until the deadline
(`5`), `0` on the day, `!` once the deadline has passed (the file goes at the next retention run),
and `∞` in primary `#00a4dc` while the file is kept. It is one `span` inside the stock
`btnPlaystate` button (§1.1 exceptions); the icon keeps its size and the stock click still toggles
played. It is computed from the absolute deadline the plugin returns, never cached as a count; with
several deadlines it shows the nearest. Everyone sees it (RET2-R10); its tooltip gives the date and
the cause ("Removed on 12 Oct unless kept · marked played"). It is read-only: **Keep is the pin on
the file's row** (§11), and the retention warning box with its Keep is gone from these pages. The
"Automatic removal is off." line is dropped; one retention line remains only for a blocked or mixed
state and the protection reasons. The episode's own window ("Remove this episode") moved into the
stock More menu as *Remove after watching…* (§7). The series page keeps its per-episode retention
list.

**Keep is admin-only, one action, no confirmation.** It sets the per-item retention policy to *never*. It
is the safety valve for an automated deletion system, and a safety valve behind a dialog is a
safety valve nobody reaches in time. Marking a title favourite exempts it too, per the README —
the detail page should say so where the retention line appears, so the two mechanisms do not
look like a bug.

**[API addition]** `POST /JellyfinMod/Catalog/{id}/Keep` — or a `reclaimAfterDays: null` PATCH,
but a named endpoint makes the audit entry in `history` honest.

**Correction (review 2026-09-18):** the implemented Keep route is
`POST /JellyfinMod/Entries/{id}/Keep` (administrator-only; see [`API.md`](API.md)), not
`/JellyfinMod/Catalog/{id}/Keep` (plan-ops#8, low, single-source, in
[`REVIEW-2026-09-18.md`](REVIEW-2026-09-18.md)).

**Keeping one file (PHASE10 Q3, 2026-09-24; RET2-R9).** An administrator can keep one file of a movie or episode
while its other versions expire. The Keep follows the file, not the version row: it matches by the file's path, or by
its device, inode and birth time. So it survives a rename or a move **within one filesystem**, and a new file written at
the kept path is kept too. A move to **another filesystem** gives the file a new device and inode and a new path; the
Keep no longer applies, the detail page shows the file as not kept, and the administrator keeps it again. Stopping a
file's Keep gives it a window of its own from that moment, never an old date that passed while it was kept (RET2-R2).

**Who sees what in the retention warning (Q8, Q11; RET2-R10).** Everyone who can see the title sees the date and the
cause in plain words ("marked played", "watched on another device (Trakt)"). Only administrators see the file names,
which can include library folders when two files share a name; ordinary users read "this episode" or "this movie". A
date that has passed reads as overdue: the file goes at the next retention run (RET2-R5).

### 8.1 Playing a reclaimed title

The file is gone; a `.strm` placeholder remains. On this fork, where the catalog state is known,
the primary button on a reclaimed title is **not** Play — it is **Get again**, which opens the
release picker. That single substitution is the main thing the web fork can do that no other
client can, and it is worth more than any badge.

On clients that cannot know (Kodi, Swiftfin, the mobile apps) the placeholder is played and
fails. The README's proposal — point the `.strm` at a plugin endpoint serving a short "not
downloaded" clip — is the right fix and belongs to the plugin, not here. Until it exists, the
archived mark in this fork is the only warning, and that asymmetry should be an accepted split,
not a surprise.

**Correction (review 2026-09-18):** no `.strm` placeholder exists. `PHASE3.md` chose the
plugin-only file-less representation ("File-less representation" row), so a reclaimed title is a
plugin entry, not a library item. **Get again** needs the release picker and therefore belongs to
Phase 4 (plan-ops#8, low, single-source, in [`REVIEW-2026-09-18.md`](REVIEW-2026-09-18.md)).

### 8.2 Continue Watching and reclaimed files

An open UX hole worth naming now: a partially-watched file that gets reclaimed leaves a resume
position pointing at nothing, and stock Continue Watching will happily offer it. Either
retention refuses to reclaim a title with a resume position under 90%, or the catalog filters
those rows out of its own Continue Watching. The first is simpler and belongs in the plugin.

**Correction (review 2026-09-18):** `PHASE3.md` answered this and rejected the 90% rule ("Partial
playback" row): any accessible user's active playback or unfinished resume protects the physical
media, and no separate completion threshold is used (plan-ops#8, low, single-source, in
[`REVIEW-2026-09-18.md`](REVIEW-2026-09-18.md)).

---

## 9. Release picker (Phase 4)

A **dialog**, not a route. Choosing a release is a transient decision made from somewhere else,
and it must return you to where you were.

```
┌── Releases for Blade Runner 2049 ───────────────────────────────┐
│  [1080p ▾ profile]                                 12 releases  │
│                                                                 │
│  ●  1080p BluRay x265  ·  FraMeSToR      8.4 GB   43↑  score 94 │
│     Blade.Runner.2049.2017.1080p.BluRay.x265-FraMeSToR          │
│  ●  2160p WEB-DL DV    ·  NTb           24.1 GB   11↑  score 88 │
│     …                                                           │
│                                                                 │
│  ▸ 6 rejected                                                   │
└─────────────────────────────────────────────────────────────────┘
```

Design rules:

- **Two lines per release.** Line one is the parsed summary — quality, source, codec, group,
  size, seeders, score. Line two is the **raw release title, always visible**. When a grab goes
  wrong, the raw title is the only diagnostic there is; hiding it behind a hover or an expander
  makes every future debugging session worse.
- **Sorted by score, descending, and the score is shown.** A scoring system whose output is
  invisible cannot be tuned or trusted.
- **Rejected releases are listed, collapsed, with their reject reason.** This is the thing Sonarr
  and Radarr get right and every lightweight clone gets wrong: the interesting question is
  usually "why did it not grab the obvious one".
  **A rejection is soft (user, 2026-10-10).** The profile and identity checks say why a release was rejected; the person
  decides. A rejected row ends with Add, and Replace where the row offers it, as their own D-pad stops; the row itself only
  reads, so a stray Enter never grabs it. Each action asks first and names the reasons ("The profile rejected this release: …").
  The grab request carries `acceptRejected`; the plugin honours it for a person only, never for automation, and a release with
  no torrent or magnet link stays refused because there is nothing to grab.
- **Freeleech, proper and repack get chips**, because they change the decision.
- **Enter grabs.** One keypress, no confirmation — the queue is where a mistake gets undone.
- **On the TV** the table becomes a single-column list, one focusable row each, parsed summary as
  the primary line and the raw title dimmed beneath. No horizontal scrolling table on a D-pad.

Opened from: the catalog card context menu, the catalog detail page, and (Phase 6) the version
list's *Get another quality*.

**Open question for the user (review 2026-09-18):** the *Enter grabs* rule rests on the queue
being where a mistake is undone, and that queue does not exist until Phase 5; `PHASE4.md` offers no
queue Undo. Options recorded in `PHASE4.md`: keep one Enter with no confirmation, add a short
server-side cancellable hold (`POST /Grabs/{id}/Cancel`), or require a second Enter on TV and
mobile. The rule above stays as written until the user decides (plan-ops#6, medium,
single-source, in
[`REVIEW-2026-09-18.md`](REVIEW-2026-09-18.md)).

### 9.1 The added row, its download, the release page link and Open Transmission (2026-10-12)

Approved design: the release picker's added-row sheet (2026-10-12). What the picker does now:

- **The added row.** The row a grab is about keeps its two action slots. While the grab is held (5 s) or being sent, Add
  shows a down arrow falling onto a tray (reduced motion: the arrow rests on it); once the client has the torrent, a green
  tick (`#81c784`, light `#2e7d32`). Neither is a focus stop. The Replace slot holds a red X (`#c62828`): during the hold it
  cancels at once (tooltip *Cancel*); afterwards it is *Remove from Queue* and asks first (*Remove the Torrent*: the
  download stops and the torrent leaves the client, anything downloaded stays; grey Cancel, red Remove), then removes the
  queue row torrent-only (`removeFromClient`, no blocklist). Removing is for administrators; anyone else sees the tick
  alone. On the TV the D-pad goes row, then X, with the white ring. The row's label ends with *, added*. The grab block
  under the row has no Cancel of its own. Other rows dim while a row is added and come back once it is cancelled, removed
  or imported. A failed grab shows a red bang for three seconds and the row's actions come back.
- **Found again on reopening.** The picker follows the search's active operation (`grab.activeOperationId`, then
  `GET /Grabs/{id}`) and marks the row whose infohash matches it; once the client has it, no block is shown.
- **Its download.** Once the client has the torrent, the picker reads `GET /Queue` right away and every 5 s while it is
  open, until the row is imported: the ring family's disc in the Add slot (§3.3, P4.FU6; the figure in its tooltip) and the
  figure at the right end of the marks line, `queued`, `42% · 12 min left`, `42% · stalled` (plain secondary text), `importing…` or
  `Failed · reason` (red, at the last value); an unreadable client keeps the last value dimmed. No bar since P4.FU6.
  Imported, the row reads as the in-library row (the green check after the quality, no actions).
- **The release page link.** Where the indexer gives a page (`detailsUrl`: Torznab `comments`, else an http `guid`; a URL
  carrying a credential is never passed on), the indexer name is a link that looks like the plain name at rest, with a
  pointer and an underline on hover and a thin cyan ring on keyboard focus, opening the page in a new tab (*Open on
  <indexer>*). It is one stop after the row's actions; plain text on the TV.
- **Open Transmission.** A round grey icon (this fork's own transmitting mark) between Show Names and Close opens the
  selected download client's web page in a new tab (*Open <client>*). Administrators only, read from the acquisition
  settings; not on the TV.

---

## 10. Download queue (Phase 5)

Route `/catalog/queue`. This is a **monitor, not a torrent client** — a scope decision worth
stating, because the alternative is slowly reimplementing qBittorrent's UI in React and owning
its bugs.

Columns: poster thumb · title · progress bar · size · speed · ETA · state · client.

Actions, and only these: **Remove** (with sub-options *remove from client* and *blocklist this
release*), and **Open in client** (a link out). No pause, no resume, no priority, no per-file
selection, no tracker editing. If you need those, you need qBittorrent, and it is one link away.

Progress updates by **polling `GET /JellyfinMod/Queue` every 3 seconds**, and only while the
queue route is mounted or a `downloading` card is on screen. No websocket in Phase 5; the Pi does
not need another persistent connection and the data is not worth one.

**[API addition]** `GET /JellyfinMod/Queue` must return `progress`, `downloadRateBytes`,
`etaSeconds`, `sizeBytes` and `client` per row, and the same `progress` value must be reachable
from the catalog list endpoint so `downloading` cards can draw their ring without a second query.

Queue empty state: *"Nothing downloading."* with a link to the wishlist — the natural next action
is to grab something.

---

## 11. Version selector (Phase 6)

Multi-version grouping is native (README §7.1); this is web-side polish. The selector stays — it
is one of the dropdowns Principle 0 protects — and it keeps working exactly as it does. What it
gains is detail on each row, because a bare `1080p` label is not enough once there are three files
and one of them is a 40 GB remux you do not want to stream to a phone.

Each row gains resolution, codec, audio and size:

```
  ●  2160p  HEVC 10-bit  ·  DTS-HD MA 7.1  ·  24.1 GB      DEFAULT
  ○  1080p  H.264        ·  AC3 5.1        ·   8.4 GB
     [ Get another quality ]
```

Requirements: resolution, codec, audio and size on every row; the default marked; every row a
D-pad stop; and *Get another quality* opening the release picker from inside the selector.

Implementation shape that keeps Principles 0 and 4: a richer row renderer passed to the existing
selector, not a replacement for it. Everything it does today it still does.

### 11.1 Versions on Jellyfin 12 (V1, 2026-09-28)

The rows list every file Jellyfin plays for the movie or episode, read from its media sources, so a
copy the plugin has not bound yet still shows (marked *not tracked yet*) and a multi-episode file
names the episodes it holds (`S01E01-E02`). *Default* is Jellyfin's own default copy.

**Which copy a device starts with** (user decision 4, answered 2026-09-28): on the TV layout the
page preselects the highest-resolution copy, high dynamic range first at equal resolution; on the
mobile layout the best copy at or below 1080p, standard dynamic range first; on desktop Jellyfin's
own default. The choice goes through the stock select and its `change` event, so Play sends that
copy's `MediaSourceId`. A copy the viewer is part-way through always wins, and a copy the viewer
picks on the select or a row is never replaced. Cards' Play buttons keep Jellyfin's default; the
full device presets are Phase 12.

**Remove this version** (decision 3, answered 2026-09-28): administrators get one *Remove* button
per file beside Keep, in the page's focus flow. Upstream's own confirmation says what goes and what
stays before anything happens: exactly that one file is deleted; the folder, subtitles, artwork,
`.nfo` and every other version stay, and the title stays in the library. Removing the **last** copy
says "This removes the last copy and stops monitoring": the folder and sidecars still stay, the title
shows *Not downloaded* and is no longer monitored, so automation does not fetch it again. Only a
per-file Keep, the file playing, a multi-part file, a file another title shares or unwritable media
refuse it, each in words.

**What stock Delete removes.** Upstream's *Delete media* in the More menu is unchanged. On a movie
in its own folder it deletes the **whole folder**: every version, subtitle, artwork and extra. On an
episode it deletes the selected file and every file whose name starts with it, which can include
another version's subtitles. When a title has more than one file, the new interface adds that
sentence inside the confirmation, and administrators see it under the version rows. File versions
are split by moving files into their own folders; *Split versions* only undoes a *Group versions*.

### 11.2 The Video row is the file chooser (design fix, 2026-10-07)

The version rows below the track block are replaced by a chooser in the **Video** row itself
([design record](design/episode-page-design-spec.md), step 2):

```
  Video      1080p HEVC SDR  ˅
             ○  2160p  HEVC 10-bit · DTS-HD 7.1 · 24.1 GB   DEFAULT   ⟲ 📌 ✕
             ●  1080p  HEVC 10-bit · AAC 5.1 · 783 MB · removes 12 Oct  ⟲ 📌 ✕
             +  Get another quality
  Audio      English - DTS-HD MA - 7.1 - Default
```

- With two or more files the Video value carries a chevron and toggles the list (a height transition;
  none under `prefers-reduced-motion`). Choosing a row selects that file and closes the list. Each row:
  mark, resolution, details from `describeVersion`, the `DEFAULT` chip on Jellyfin's default copy,
  `not tracked yet` and a multi-episode range as before, a scheduled removal as `· removes <date>`,
  then three icons: **history** (§7.2), **pin** (per-file Keep, filled in primary when kept) and
  **cross** (Remove this version with upstream's confirmation, as in §11.1). The last row is *Get
  another quality* for administrators with release search.
- The row's actions are round, icon-only buttons of at least 2.5em, each its own D-pad stop, named for their file
  ("Keep the 1080p file") with a Title Case tooltip: grey, the cross red, the pin in primary while kept (user UI rules,
  2026-10-08). Pin and cross are administrators'; history is everyone's.
- The chooser drives upstream's `.selectSource` exactly as the rows did: it sets the value and
  dispatches a bubbling `change`, so Play, audio and subtitles follow; the viewer's own choice is
  never replaced; the device preference (§11.1) still applies.
- **Upstream's Version select is hidden while the chooser is mounted** (§1.1 exception 2); it stays in
  the DOM, keeps working and reappears if the chooser does not mount.
- A file with several video streams keeps upstream's video-stream select visible under the chooser.
- With one file there is no chooser: the Video row stays upstream's and the three icons sit at its
  end.
- A plugin without `versions`, `versions.v1`, `retention.versionKeep`, `versions.remove` or
  `history.files` hides the matching part, never the page.

---

## 12. Settings

Split by audience, and the split keeps the fork small:

| Setting | Home | Why |
| --- | --- | --- |
| Indexers, download clients, quality profiles, global retention, TMDB key (optional since P1.FU13) | **The plugin's own Dashboard config page** | Admin-only, never used on a TV, and a plugin config page costs the fork exactly zero lines |
| Per-item monitor, per-item quality profile, per-item Keep | Catalog detail page | Per-title, used while browsing |
| Catalog view preferences (sort, card layout, show wanted in Home) | The fork's display preferences | Per-user, matches where the equivalent library settings already live |

Quality profile editing deserves a real UI and still belongs on the plugin's config page. It is
a once-a-quarter admin task, not a browsing surface.

### 12.1 Words and buttons in the settings area and on the Dashboard page (user, 2026-10-07/08)

- **Title Case** for button labels; page, section, group, card and dialog titles; rail item titles; menu items (the
  user menu's *JellyfinMod Settings*, the drawer, the setup banner's *Set Up*); and the wizard's step titles, as
  Jellyfin's own *Scan All Libraries* and *Scheduled Tasks* are. A short article, conjunction or preposition stays lower
  case unless it is the first or last word: a, an, the, and, but, or, nor, as, at, by, for, from, in, into, of, on, to,
  via, with (*Add from TMDB*, *Import and Seeding*, *Turn Grabbing On*). Product names keep their own spelling
  (JellyfinMod, TMDB, Prowlarr, Transmission).
- **Sentence case** for descriptions, help text, field labels, status lines, notices, errors, the rail's subtitles and
  status chips (*Default*, *verified*). Sentences the server sends are shown as they come.
- **Three kinds of button**, all the size of Save: red destroys, blue is the one main action of a view, grey is
  everything else (PHASE7, *Settings buttons: three kinds*).
- **List rows act through icons.** Every action of a list row (indexers, quality profiles, path mappings, a profile's
  quality order, blockers, episode conflicts) is a round icon of at least 40 px, as in a secret's box: Test
  `wifi` (states below), Edit pencil, Remove red bin, Make Default `star_border`, Move Up / Move Down arrows, Fix `build`,
  Rebind `link`, Keep `push_pin`. Each one's aria-label and tooltip name the row it acts on (*Remove Prowlarr 1337x*);
  on the TV it takes the focus ring and the arrows walk a row's icons left to right. A move with nowhere to go, or an
  action that is busy, is refused with `aria-disabled`, never `disabled`, so the remote keeps its place. Buttons outside
  rows (Save, Add Indexer, Sync Now, dialog buttons) stay labelled.
- **Settings polish (user, 2026-10-09)**, on the settings area and the Dashboard page alike. Where it differs from the
  rules above, the user's rule wins and the difference is said here:
  - **A Test icon shows what the test did.** Its glyph is `wifi` (it was `network_check`, which already carries a
    tick of its own); untested it is the plain glyph; while the test runs it is a spinner and the row's status reads
    "Testing…" (said once, politely); a pass puts a green tick on the glyph's corner, a failure after a pass a red
    cross, drawn as bare glyphs on the icon's corner with no disc behind them (the user, 2026-10-09; their final position and
    weight are a separate design session). Tick and cross are shapes as well as colours. The name stays "Test <row>"; the tooltip adds "last checked
    <date and time in the viewer's locale>" or why it failed. The date is no longer a line of the row ("verified
    10/9/2026, 10:06:58 PM" is now "verified").
  - **The TMDB token is optional (P1.FU13, user 2026-10-12).** Its note, in the settings area and on the Dashboard page,
    reads "Optional. Leave empty to use Jellyfin's built-in TMDb connection. A saved token is used instead, for JellyfinMod
    discovery only." Discovery's state names the source in use: "Using Jellyfin's TMDb connection" (no token saved), or
    "Using your token · tested …" / "Using your token · not tested since it changed". With no token there is no Test icon
    (it lives in the Configured box); the API's Test checks Jellyfin's connection then.
  - **A secret is one field.** Configured, it is the box with its icons (Test, Replace, Clear); Replace turns the box into
    the input, with its buttons inside it at the right: a round Save (only a secret that has a test of its own, the TMDB
    token, has one: it writes just that secret, then starts the Test; refused while the input is empty; Enter does the same)
    and a round Keep (cross) that turns the box back. The view's blue Save stays the one main action. Save is the one
    icon-only button outside a row or a secret's box; the other secrets are saved with the record they belong to.
  - **Icon hover** scales the icon to 1.08 and lightens it over 140 ms (transform and opacity only, no filter), and
    does neither under `prefers-reduced-motion`; a focused icon keeps its ring and fill.
  - **Number fields' spin arrows** are drawn for a dark field (the light colour scheme excepted), so they read at
    4.5:1 in all six schemes.
  - **Fields side by side start their inputs on one line**: on the Dashboard page every label of a row of columns
    takes the height of the tallest, whatever wraps at that width. The settings area has no such rows.
  - **Diagnostics entries** (episode conflicts, entries in removed libraries, a run's library reasons) scroll in a
    fixed-height area that is a tab stop with a ring, takes the arrow keys while it can scroll (a remote has no wheel),
    and carries a small dim time on every entry, newest first: *Detected* for a conflict, *Added* for an entry (the plugin
    records when it was catalogued, not when its library was removed), *Found* for a run's reason.

---

## 13. TV and D-pad rules

Collected here because they are the constraints most easily forgotten, and `CLAUDE.md` is
explicit that TV bugs are only reachable by D-pad at 1920x1080.

1. **Never unmount a focused container.** Filter changes, poll updates and optimistic writes all
   re-render in place. See §5.4.
2. **Nothing arrives above the focus ring.** Late-loading sections — Add from TMDB, most
   obviously — reserve their space from the first paint. See §6.4.
3. **One focusable element per card.** Overlay buttons stay mouse-only; the context menu carries
   catalog actions.
4. **No new D-pad rows.** This is why file state went into the Filter menu rather than a chip row:
   every permanent row above the grid is traversed on every visit. The only new focusable things
   in the whole design are one line on the entry page (the history expander) and the rows inside
   two dialogs.
5. **No dialog without a first-focus target.** The release picker focuses its top row on open and
   Back closes it, returning focus to the element that opened it.
6. **No horizontally-scrolling tables.** The release picker and queue become single-column lists
   under `layoutManager.tv`.
7. **Text input on the TV** uses the existing `AlphaPicker` path already in `SearchFields` — reuse
   that component, do not write a second on-screen keyboard.
8. **Verify at 1920x1080**, with `localStorage.setItem('layout','tv')`, driven by arrow keys.
   1280x720 gets a two-row header the TV never shows, and header work verified there is aimed at
   the wrong layout.
9. **MUI pop-ups obey the remote** (PHASE7 decision 13, 2026-09-24). Back closes the top menu,
   popover or dialog and nothing else, whichever key the remote sends; arrows move inside it and
   never into the page behind; Enter toggles checkboxes and switches; opening one focuses its first
   control. `shell/dpadModals.ts` does this for every MUI pop-up, so a new screen gets it by using
   MUI rather than by handling keys itself.

**Proposed (review 2026-09-18, not user-approved):** additional TV rules from
[`REVIEW-2026-09-18.md`](REVIEW-2026-09-18.md), tracked as T19 in `PHASE3.md` and W9 and W11 in
`PHASE1.md`:

- **No native `<details>` for History.** Legacy spatial navigation never focuses a `<summary>`,
  so History becomes a focusable toggle button with `aria-expanded` (critic-journeys#6, low,
  single-source; T19).
- **A control stays focusable while its own request runs.** Use the `aria-disabled` pattern Keep
  already uses, with a guard in the handler, instead of `disabled`, which drops focus to `<body>`
  (web-library-search-details#9, low, verified; T19).
- **Monitor toggles with Enter**, like every other D-pad control (T19).
- **Remove entry uses the stock confirm dialog**, because it also drops the entry's history
  (web-library-search-details#9; T19).
- **Horizontal card rows use `emby-scroller`**, so scrollManager can bring the focused card into
  view (web-library-search-details#2, high, verified; W9).
- **Avoid `display: contents` and flex `gap`** for old webOS engines: the first needs Chromium 65
  and the second Chromium 84. Use the container's own layout classes and child margins instead
  (critic-gaps#3, high, verified; web-home-rules-tv#8, low, verified; W11). How severe this is
  depends on the physical TV's webOS version, an open question in `PLAN.md`.

---

## 14. Failure and degradation

The catalog adds two dependencies the stock app does not have — the plugin and TMDB — and each
must fail to something usable rather than to a blank page.

| Failure | Behaviour |
| --- | --- |
| Plugin unreachable / not loaded | Catalog routes render one clear message naming the plugin, with a link to `/library/movies` and `/library/tv` (§2.1). Not a crash, not an infinite spinner. |
| Plugin returns 404 on an endpoint | Treated as "feature not in this plugin version" — that surface hides itself. A fork newer than the plugin must degrade, not break. |
| TMDB unreachable | Tier 3 shows an inline notice; tiers 1 and 2 unaffected (§6.8). Catalog browsing is unaffected. |
| Download client unreachable | Queue rows show `state: unknown` with the last known progress and a stale-since timestamp. Never show 0%; a wrong number is worse than an absent one. |
| Web/server version mismatch | Per README §7.1, the catalog UI uses only API surface present in **10.11**. Anything odd is suspected as mismatch fallout before it is debugged as a fork bug. |

Poster loading: TMDB images are remote and unblurhashed, so catalog-only cards get a neutral
placeholder at the card's exact dimensions. No layout shift when artwork lands.

---

## 15. File inventory and the rebase diff

### 15.1 New files

```
src/apps/modern/routes/catalog/
    queue.tsx                       Phase 5

src/apps/modern/features/catalog/
    components/
        CatalogCard.tsx             wraps Cards + Card, reuses everything below
        FileStateMark.tsx           the one top-left icon
        FileFilterGroup.tsx         the File group inside upstream's Filter menu
        AddFromTmdbSection.tsx      the leftovers section on the search page
        AddToCatalogButton.tsx
        SearchReleasesButton.tsx    entry page + context menu
        HistoryLine.tsx             collapsed, expands to `history`
        RetentionLine.tsx           Phase 3
        ReleasePickerDialog.tsx     Phase 4
        QueueTable.tsx              Phase 5
        VersionSelector.tsx         Phase 6
    hooks/api/
        useCatalogItems.ts
        useCatalogItem.ts
        useAddToCatalog.ts
        useDiscoverSearch.ts
        useReleases.ts              Phase 4
        useGrabRelease.ts           Phase 4
        useQueue.ts                 Phase 5
    utils/
        entry.ts                    normaliser + resolvePoster()
        dedupe.ts                   tier merge by TMDB id
    constants/
        state.ts                    CatalogState -> presentation class
    types/
        CatalogEntry.ts
```

### 15.2 Upstream files touched

**Historical estimate, superseded by `PHASE1.md` §6.** The table below predates the combined-query
and file-less-detail analysis and the accepted Home hero/top-bar implementation. It is not an
implementation scope limit or a complete list of required integration points.

| File | Change | Lines |
| --- | --- | --- |
| `routes/asyncRoutes/user.ts` | one route added: `catalog/queue` (Phase 5) | 1 |
| `features/libraries/components/filter/FilterButton.tsx` | mount the File group | ~2 |
| `components/cardbuilder/…` mount point | render `FileStateMark` over the cover | ~2 |
| legacy `itemDetails` view | mount `SearchReleasesButton` + `HistoryLine` | ~2 |
| home sections | merge Continue/Next up, merge Latest Movies/Shows | ~4 |

**Roughly eleven lines, across five insertion points, none of them deletions.** No redirect, no
nav entry, no replaced view, no dead code — because with one entry per title there is nothing to
replace. That is a smaller and safer diff than the README's original plan, and it is a direct
consequence of dropping the catalog/library split.

---

## 16. What each screen needs from the API

Cross-check against README §5 before starting a phase; **bold** rows are additions this design
implies.

| Screen | Endpoint | Phase |
| --- | --- | --- |
| Movies / TV grid | `GET /Catalog` **+ `mediaType`, `sortBy`, `startIndex`, `limit`, `targetLibraryId`** | 1 |
| Search, what you have | stock `/Items` (+ plugin merge for file-less entries) | 1 |
| Search, leftovers | `GET /Discover/Search` **excluding ids already held** | 1 |
| Add from search | `POST /Catalog` | 1 |
| Entry page additions | `GET /Catalog/{id}` (incl. `history`, seasons) | 1 |
| Monitor / profile toggles | `PATCH /Catalog/{id}` | 1 |
| Retention line, Keep | `GET /Catalog/{id}`, **`POST /Catalog/{id}/Keep`** | 3 |
| Due-within-7-days filter | `GET /Catalog?dueWithin=7` **(derived server-side)** | 3 |
| Release picker | `GET /Releases`, `POST /Releases/Grab` **incl. rejected + reject_reason + score** | 4 |
| Downloading card ring | `GET /Catalog` **with `progress`** | 5 |
| Queue | `GET /Queue` **with `progress`, rate, ETA, client**, `DELETE /Queue/{id}` | 5 |
| Version selector | stock `/Items` MediaSources | 6 |

**Correction (review 2026-09-18):** the `/Catalog` rows above predate the implemented contract.
All routes sit under `/JellyfinMod`: the Movies/TV grid uses `POST /JellyfinMod/Browse`, and the
Due-within-7-days filter is its `dueWithinDays` field; entry list, create, detail, monitor PATCH
and removal use `/JellyfinMod/Entries` and `/JellyfinMod/Entries/{id}`; Keep is
`POST /JellyfinMod/Entries/{id}/Keep`; leftovers use `GET /JellyfinMod/Discover/Search`.
[`API.md`](API.md) is the current contract (plan-ops#8, low, single-source, in
[`REVIEW-2026-09-18.md`](REVIEW-2026-09-18.md)).

---

## 17. Build order

Matching the README's phases, smallest useful increments first:

**Phase 1a** — `CatalogEntry`, `state.ts`, `entry.ts`, `FileStateMark`. File-less entries start
appearing in `/movies` and `/tv` with a mark. Nothing else changes anywhere.

**Phase 1b** — the entry page: `SearchReleasesButton` (stubbed) and `HistoryLine`.

**Phase 1c** — search: file-less entries in the Movies/Shows sections, plus the leftovers section
and `AddToCatalogButton`.

**Phase 1d** — `FileFilterGroup` in the Filter menu, and the two Home merges.

There is no one-way door in this list, because nothing is replaced. Every step is independently
revertible by removing one mount.

Phases 3–6 follow the README's ordering; each adds its components from §15.1 and nothing else.

---

## 18. Open UX questions

1. **Do wanted titles appear on Home?** One "Wanted" row is tempting and would be well used, but
   Home is stock and adding a row there is a real diff. Recommendation: no in Phase 1; revisit
   after Phase 2, and if yes, do it as a user-toggleable row, default off.
2. **Whose catalog is it? Answered 2026-09-06:** one shared catalog in Phase 1. Users see and
   may add titles only in libraries they can access; admins remove titles and change settings.
   This does not settle whose watched state drives retention. Undo in §6.6 is admin-only too;
   ordinary users get the add confirmation without a removal action.
3. **Do file-less entries get STRM placeholders too?** §6.2 recommends no — merge them client-side
   so the wishlist stays out of Kodi and Swiftfin, as README §9.2.1 intended. Revisit if the
   client-side merge turns out to fight sorting or paging.
4. **Reclaimed items in Continue Watching** — §8.2. Decide before Phase 3 ships, not after the
   first dead resume.
5. **Does the merged Continue watching row need a cap?** Continue and Next up separately are each
   naturally short; merged they can run long on a busy household. Probably a limit of 12 with the
   rest behind the row's own scroll.
6. **Does the `.strm` placeholder merge as a *version* of the real file** (README §9.2.1, unverified)?
   If it does, reclaim keeps a stable item id and the version selector in §11 becomes the natural
   place to show "archived" — which would simplify §8.1 considerably. Worth testing on the Pi
   before Phase 3 design is finalised.

**Correction (review 2026-09-18):** `PHASE3.md` has answered Q4 and Q6; they stay listed for the
record. Q4: partial playback (active playback or an unfinished resume) protects the physical
media, and no 90% rule is used. Q6: there are no STRM placeholders; reclaimed titles use the
plugin-only representation (plan-ops#8, low, single-source, in
[`REVIEW-2026-09-18.md`](REVIEW-2026-09-18.md)).

---

## Decision log

- **2026-09-06** — **Removal, including Undo, is admin-only.** Ordinary users may add titles but
  cannot delete saved entries. Phase 3 expiry runs automatically unless an admin disables retention;
  eligible media is reclaimed while catalog entries and history remain.

- **2026-09-06** — **Top-bar redesign and Home hero explicitly included in Phase 1 by the
  user**, alongside the two existing Home merge tasks. This is the narrow styling exception in
  §7.3, not a general application restyle. `PHASE1.md` records integration and fallback checks.

- **2026-09-06** — **Shared catalog permissions accepted.** Ordinary users may add titles to
  libraries they can access. Removal and settings changes are admin-only. Reads, discovery
  exclusions and writes must respect the requesting user's library access on the server.

- **2026-09-04** — **One entry per title.** There is no catalog separate from the library. An entry
  may or may not have a file behind it, and Movies *is* that list. Supersedes README §9.1's
  redirect plan: nothing is replaced, so nothing needs redirecting, and the fork's diff shrinks
  rather than grows.
- **2026-09-04** — **Nothing upstream is removed** (Principle 0). Every dropdown, menu, tab, sort
  field, filter group, view mode and track selector jellyfin-web ships stays and keeps working.
  The design only adds.
- **2026-09-04** — **Search is two zones, not three tiers.** Everything you have comes back under
  upstream's own `Movies` and `Shows` headings; **Add from TMDB** is appended last and is defined
  by subtraction — anything carrying an id you already hold is excluded server-side.
- **2026-09-04** — **File state is one icon over the cover**, not a text badge: disc / dashed ring /
  magnifier / queue arrow / progress ring / archive box. Dimming carries it at phone sizes.
- **2026-09-04** — **No chip row.** File state joins the existing `Filter ▾` menu as a *File* group
  of checkboxes, so it composes with Played, Genre and the rest. A chip row is a permanent extra
  D-pad row for a monthly task, and single-select cannot express "not downloaded and unplayed".
- **2026-09-04** — **No `Expiring soon` control.** It becomes a *Due within 7 days* checkbox in the
  same menu. A control that is empty most weeks should not be permanent furniture.
- **2026-09-04** — **History is one collapsed line** in the metadata run — "Watched 9 Mar 2024" —
  expanding to the full trail on click. Not a section.
- **2026-09-04** — **Home merges two pairs**: Continue watching with Next up, and Latest Movies with
  Latest TV Shows. Everything else on Home is untouched.
- **2026-09-05** — **Ratings become one control.** The bare community star and the separate
  IMDb / TMDB / Trakt links line merge into a row of chips in the info band — each carries that
  source's own mark and score and is the link to it. Google's score joins them. Removes a
  standalone links paragraph and answers "how is this rated" in one glance.
- **2026-09-05** — **Cover art is CSS, not image files.** Layered gradients plus a grain overlay,
  a vignette and printed poster typography (three layout variants, condensed or serif, sized to
  the longest word via container query units). Real posters are copyrighted artwork and are not
  embedded; on the real build these are replaced by Jellyfin's own image endpoints.
- **2026-09-05** — **Chrome and the entry page redrawn from screenshots of the running app**, not from
  guesses: logo-as-Home plus icon+label view links (Favorites / Shows / Movies); Queue lives in the
  avatar menu beside Profile, Settings, Dashboard, Metadata Manager, Quick Connect, Sign Out; the
  entry page is backdrop + logo, a horizontal info band with the poster or still overlapping it and
  icon actions right-aligned, then a label/value metadata block, then plain rows (More from Season,
  Cast & Crew, Scenes, More Like This). Card hover is a translucent blue play circle with a **Play**
  tooltip and ✓ ♥ ⋮ bottom-right — no dark scrim.
- **2026-09-05** — **The full upstream item menu is kept verbatim** — Play, Play all from here,
  Select, Add to collection, Add to playlist, Download, Copy Stream URL, Delete, Edit metadata,
  Edit images, Edit subtitles, Media Info, Refresh metadata. JellyfinMod adds one marked group
  (Search releases / Keep / Remove entry); it never removes or reorders an upstream entry.
- **2026-09-05** — **All state lives on the cover**: on disk or not, download progress, watch
  progress, days until reclaim. Not in metadata rows. The detail page's poster or still is a cover
  too and carries the same marks. The only metadata row JellyfinMod adds is **History**.
- **2026-09-05** — **Netflix-shaped top bar.** `AppToolbar` / `UserViewNav` restyled: text-only view
  links, muted until active, overlaying the page on a gradient and turning solid on scroll. Same
  items, same buttons, same routes — a restyle, not a replacement. Requires a hero billboard on
  Home to be readable, which is a new component and the real cost of the change.
- **2026-09-04** — **One detail page, upstream's**, for every entry. A file-less entry shows the same
  page with less in it, plus **Search releases** where Play would be.
- **2026-09-04** — `Cards`/`Card` have no per-card extension point, so the file mark is rendered by
  a thin `CatalogCard` over the unmodified `useCard` / `CardWrapper` / `CardBox` rather than by
  adding `children` to upstream's `Card`. Stock indicators are top-right, so the mark goes top-left.
- **2026-09-04** — `catalog_item.target_library_id` added so file-less entries can be scoped to a
  per-library view **[model change]**.
