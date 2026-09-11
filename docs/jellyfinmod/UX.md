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

### 3.2 Colour

State reads from shape and opacity first, colour second, because the TV is viewed at three
metres and the app has a dark theme with a user-set accent. Use the MUI theme's semantic slots,
never literal hex: `text.secondary` for wanted, `primary` for in flight, `text.disabled` outline
for archived. Nothing in the catalog introduces a new palette.

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

**Phase 1 scope accepted, 2026-09-06:** file-less shows also expose individually tracked episodes,
not only season summaries. Show missing versus unaired availability and persist episode monitoring
settings, editable by admins only. Existing downloaded episodes retain native navigation and
playback. Monitoring does not initiate downloads until acquisition is implemented. `PHASE1.md` §5
defines the identity, metadata-refresh and permission requirements.

### 7.1 Where Search releases lives

In upstream's existing button row for a file-less entry — where Play would be — and in the
**More** (`⋯`) menu for an entry that has a file. Both are insertion points that already exist. It
is also on the card's context menu in the grid, so it is reachable without opening the entry.

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

---

## 7.3 Home: two merges, and a Netflix-shaped top bar

Home keeps Jellyfin's rows, cards and scrollers. Two sections merge, and the chrome above them
changes shape — the one place this design departs from upstream's look rather than adding to it.

**The top bar overlays the page, Netflix-style.** Text-only view links (no icons), muted until
active, sitting on a gradient over the content and turning solid `#101010` once you scroll past
~40px. Same items, same right-hand buttons, same routes — a restyle of `AppToolbar` /
`UserViewNav`, not a replacement, so Principle 0 holds.

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

**Keep is admin-only, one action, no confirmation.** It sets the per-item retention policy to *never*. It
is the safety valve for an automated deletion system, and a safety valve behind a dialog is a
safety valve nobody reaches in time. Marking a title favourite exempts it too, per the README —
the detail page should say so where the retention line appears, so the two mechanisms do not
look like a bug.

**[API addition]** `POST /JellyfinMod/Catalog/{id}/Keep` — or a `reclaimAfterDays: null` PATCH,
but a named endpoint makes the audit entry in `history` honest.

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

### 8.2 Continue Watching and reclaimed files

An open UX hole worth naming now: a partially-watched file that gets reclaimed leaves a resume
position pointing at nothing, and stock Continue Watching will happily offer it. Either
retention refuses to reclaim a title with a resume position under 90%, or the catalog filters
those rows out of its own Continue Watching. The first is simpler and belongs in the plugin.

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
- **Freeleech, proper and repack get chips**, because they change the decision.
- **Enter grabs.** One keypress, no confirmation — the queue is where a mistake gets undone.
- **On the TV** the table becomes a single-column list, one focusable row each, parsed summary as
  the primary line and the raw title dimmed beneath. No horizontal scrolling table on a D-pad.

Opened from: the catalog card context menu, the catalog detail page, and (Phase 6) the version
list's *Get another quality*.

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

---

## 12. Settings

Split by audience, and the split keeps the fork small:

| Setting | Home | Why |
| --- | --- | --- |
| Indexers, download clients, quality profiles, global retention, TMDB key | **The plugin's own Dashboard config page** | Admin-only, never used on a TV, and a plugin config page costs the fork exactly zero lines |
| Per-item monitor, per-item quality profile, per-item Keep | Catalog detail page | Per-title, used while browsing |
| Catalog view preferences (sort, card layout, show wanted in Home) | The fork's display preferences | Per-user, matches where the equivalent library settings already live |

Quality profile editing deserves a real UI and still belongs on the plugin's config page. It is
a once-a-quarter admin task, not a browsing surface.

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
