# Configuration page — three directions

Proposals for replacing the look and structure of the plugin's Dashboard configuration page
(`plugin/JellyfinMod/Configuration/configPage.html`), prompted by the verdict *"the whole
configuration page UI is so ugly."* Nothing here is implemented; the plugin page is untouched.

Open the three mockups in a browser. They are self-contained static files: inline CSS, no build,
no network, dummy values only.

| File | Direction | One line |
| --- | --- | --- |
| [`option-a.html`](option-a.html) | **A · Ledger** | One dense page, ten numbered panels, a sticky index, each panel saves on its own. |
| [`option-b.html`](option-b.html) | **B · Checklist** | A persistent readiness rail in pipeline order is the navigation; one section at a time; list items edit in a sheet. |
| [`option-c.html`](option-c.html) | **C · Board** | Ten summary cards you read at a glance; open one to edit; essentials first, Advanced behind a toggle. |

The bar at the top of each file is mockup-only: **Desktop**, **Mobile 390 · 90%** and
**TV · 125% · arrows** apply the fork's real root sizing (`.layout-mobile{font-size:90%}`,
`.layout-tv{font-size:125%}`). In TV mode the arrow keys move focus geometrically among controls,
the way Jellyfin's `inputManager` does, and buttons take the stock `show-focus` fill. Tab works in
every mode. Secrets' **Replace** / **Clear**, the disclosures, B's rail and sheet and C's cards and
back link are live; Save and Test buttons are inert.

## What is wrong with the current page

Naming the causes, so the options can be judged on whether they remove them rather than on taste:

1. **No hierarchy.** Nine `h2`/`h3` headings of identical weight, fields at 110% size, `block`
   buttons the width of the column, every paragraph in `fieldDescription` grey. Nothing tells the eye
   what matters.
2. **Three save scopes with no visual boundary.** One `<form>` saves the XML configuration
   (TMDB, retention, seed protection); separate buttons save acquisition defaults, each indexer,
   each client, path mappings, each profile, import and automation. The API is genuinely shaped this
   way (each resource carries its own `revision`), but the page hides it, so it reads as one form that
   randomly has seven Save buttons.
3. **List editors are always-open blank forms.** Indexers, clients and profiles each show a full
   empty editor below a one-line list; the list rows are `textContent` strings with three raised
   buttons appended. Path mappings and the quality order are rows of bare inputs with `Up`/`Down`
   buttons.
4. **State is prose.** Readiness, blockers, budgets, breaker state and last-run results are
   concatenated into single sentences (`'Grabbing is off. Not ready: download_client_unverified.'`).
   The one thing an administrator opens this page to learn — *why is grabbing not working* — is the
   hardest thing to find.
5. **Secrets are placeholders.** A stored token is a password field whose placeholder says
   `Stored`, next to a "Remove the stored token" checkbox. Write-only is the right rule; the
   presentation makes it look like a bug.
6. **The Interface section is missing.** `InterfaceSettingsController` (takeover on/off, web
   root state, bundle ids, Restore stock) has no UI at all today.

## What all three share

These are constraints, not choices, and every option was drawn inside them.

- **Theme tokens only.** Ground `#101010`, paper `#202020`, primary `#00a4dc`, error `#c62828`,
  star `#f2b01e`, secondary text `rgba(255,255,255,.7)`, divider `rgba(255,255,255,.12)`, filled
  input `rgba(255,255,255,.09)`, raised button `#424242`, radius `0.2em`, Noto Sans. The mockups
  declare them as the same `--jf-palette-*` custom properties the fork's theme already emits, so the
  real page would consume the theme rather than restate it. **One stretch to flag:** the amber
  "attention" state reuses the star token, because the theme has no other warm colour. If that is
  unwelcome, warnings fall back to secondary text plus wording; nothing else changes.
- **Stock elements, new classes.** Inputs, selects, checkboxes and buttons are the `emby-*`
  elements the page already uses. Every new class is `jfmod-`prefixed; no upstream selector or
  `.scss` file changes. The one upstream rule that shapes all three is `form{max-width:54em}` at
  ≥50em (`site.scss`), which is why each option's main column caps at 56–60em and why rails, indices
  and card grids sit outside the `<form>` elements, one `<form>` per resource.
- **`em` everywhere.** No `px` in layout, so the 90% and 125% roots do their job.
- **State vocabulary.** Four glyphs: filled primary = fine, filled star = needs attention, filled
  error = broken or blocking, hollow = off. Colour is used only where the state is not the boring
  one (UX Principle 1 applied to an admin page).
- **Secrets are a component, not a password field.** `Configured · since <date>` with
  **Replace** and **Clear**; Replace reveals a write-only field; Clear marks the stored value for
  removal on save and offers Undo. The page never receives a value; it knows only
  `apiKeyConfigured` / `passwordConfigured` / `*Ref`, which is what the DTOs already return.
- **Refused controls stay focusable.** Anything the server would refuse (Enable grabbing while
  blocked, Delete on the default profile) is `aria-disabled` with the reason beside it, never
  `disabled`, so D-pad focus is not dropped (UX §13, T19 rule). Disclosures are buttons with
  `aria-expanded`, never `<details>`.
- **Per-section Save with revision echo.** Every section footer shows *Saved <when> · revision
  <n>*; a 409 shows as an inline notice with **Reload** (Import demonstrates it). This is the API's
  contract made visible, not decoration.
- **Blockers become sentences.** `download_client_unverified` → *The download client changed since
  its last successful test.* One map, shared by the readiness summary, the Grabbing section and the
  wizard later.
- **Same data in all three,** so you compare structure, not content: TMDB token configured; the
  download client edited after its last test (the blocker; its Test is shown mid-flight); one indexer
  with a `401` and an open circuit breaker; one path mapping failing `cross_filesystem`; three
  profiles with HD 1080p default; grabbing off and refused; import in a revision conflict; retention
  on with seed protection pointing at a different Transmission; automation off and paused;
  takeover applied; one episode conflict and one orphaned entry.

**Proposed, not yet in the API** (drawn so the layout can be judged with them, labelled here so
nobody mistakes them for done): a TMDB **Test** (PHASE7 §5, S7), *Use the download client's URL* for
seed protection (S7 `SeedProtectionSource`), *Test all* indexers (today tests are per indexer),
*Make default* on a profile row (today via the Grabbing defaults). Everything else on the mockups
maps to a field or endpoint that exists — including two the current page never shows: the retention
preview and latest run (`GET /JellyfinMod/Retention/Preview`, `Runs/Latest`) and the whole Interface
section (`GET/PATCH /JellyfinMod/Settings/Interface`, `RestoreStock`).

## Option A — Ledger

**Idea.** Keep the single page, make it read like a ledger: ten numbered panels in pipeline order,
each with a header (title, one-line state, header action), a body with quiet group titles, and its
own Save row. A sticky index on the left shows every section with its state dot and follows the
scroll. A one-line readiness strip at the top names the blocker and offers the fix.

**Optimises for** administrators who already know what they want: everything is one Ctrl-F away,
nothing is behind a click, the page is linkable to a section (`#s-indexers`), and it is the
smallest possible departure from the DOM that exists today.

**The awkward parts.**
- *Many settings:* density is deliberate — field spacing tightens from `1.8em` to `1.15em`
  inside `.jfmod-ledger`, numbers sit in two- and three-up grids, everything else is single column.
  It is still a long page; the index is what makes that acceptable.
- *Secrets:* the shared component.
- *Connection tests:* inline, next to the thing tested (`Test` beside the TMDB state, the busy
  `Testing…` beside the client connection fields, `Test import path` under the mappings).
- *Readiness:* the strip plus the state dots in the index. Both point at the client.
- *Long lists:* compact rows (name · chips · usage · state · flat actions) and an **inline editor
  that expands under the row being edited** (Ironwood and HD 1080p are shown open). No more blank
  editors. Quality profiles show the allowed qualities as an ordered list with an *Add to allowed*
  select for the other 20, instead of 24 checkboxes.

**Mobile.** The index becomes a sticky horizontal chip row under the app bar; grids collapse to
one column; row actions wrap under the row. No horizontal scroll at 390px.

**TV.** Index is the first column; Right enters the panels; every control is a stop. It is the
longest D-pad walk of the three, which for a page UX §12 calls "never used on a TV" is acceptable
but worth saying.

**Effort.** ~1.5–2 days including E2E on the three layouts. The existing 700 lines of wiring
survive almost unchanged; the work is markup restructuring, one CSS file and the inline-expand
behaviour for the three lists.

**Upstream maintenance.** Lowest. Nothing but stock elements and layout classes; the index and
panels have no upstream counterpart to drift from.

**S8 reuse.** The CSS, the copy, the state vocabulary and the secret/list/notice components carry
over; the page shape does not. The in-app settings area wants a side navigation and one section at
a time (PHASE7 §5 lists eleven sections plus an Overview), so A's single scroll is the part that
gets thrown away — roughly the layout, about a third of the CSS.

## Option B — Checklist

**Idea.** The pipeline is a dependency chain, so the navigation *is* the readiness list. A
persistent rail lists the ten areas in the order things have to work, each with a numbered state
badge and a one-line summary; the head of the rail states the blocker. The main column shows one
section at a time with a *Step n of 10* eyebrow, header actions, the body, and a footer with Save,
the revision line and **Next: … →**. List items (indexers, profiles) edit in a sheet that slides in
from the right; Back/Escape closes it and returns focus to the row's Edit button.

**Optimises for** the two moments this page actually gets opened: first setup, and "why is
grabbing not working." Both are answered by the rail before a single field is read. It is also the
S10 wizard with the gates removed: the same rail, the same sections, the same Tests.

**The awkward parts.**
- *Many settings:* one section per screen gives each room; advanced groups sit under quiet
  subheadings rather than behind toggles, because the screen is no longer crowded.
- *Secrets:* the shared component; in the sheet, the two-column grid collapses to one so the
  `Configured · since` pill never wraps.
- *Connection tests:* the busy Test sits with the connection fields; the rail summary changes when
  it finishes. The header action slot holds the section-level verb (Open Transmission, New indexer,
  Run now).
- *Readiness:* the rail. It is never scrolled away on desktop, and the blocker text at its head is
  the first thing on the page.
- *Long lists:* rows with name, chips, URL, state and *Test* / *Edit*; the failing row carries a
  tinted band and its error sentence; the editor opens in the sheet so the list stays where it was
  (Principle 3: focus is state). Twenty indexers from a future Prowlarr sync are twenty rows, not
  twenty editors.

**Mobile.** The rail collapses to a card with a section `<select>` (`2. Download client — needs
attention`) and the blocker line; the section fills the width; the sheet is full-screen. **Next →**
in the footer is the primary way through on a phone.

**TV.** Rail on the left is column one, sections column two, Right crosses between them; the
sheet takes the full width with first focus inside it and Back closing it. One-dimensional lists,
no horizontal tables.

**Effort.** ~3–4 days plus half a day of E2E: a hash-driven section switcher, the rail with its
mobile picker, the sheet (the fork's `dialogHelper` can host it, which is cheaper but couples the
page to it), and the same markup restructuring as A. The wiring survives; each section's load/save
becomes a function keyed by section id, which the current code is already halfway to.

**Upstream maintenance.** Moderate. The sheet is the one piece with upstream overlap (dialogs), and
the choice is either own it (~80 lines) or ride `dialogHelper` and accept its changes.

**S8 reuse.** Highest. PHASE7 §5 describes the settings area as sections behind a navigation with an
Overview of "readiness per area with blockers"; that is B's rail and sections. The CSS, the section
markup, the sheet, the copy and the blocker map move across whole; only the vanilla event wiring is
replaced by React. And when the Dashboard page shrinks after S8 parity to "readiness, the Interface
section and a link" (PHASE7 §5), what remains is B's rail head plus one section — the residual page
is a subset of this design rather than a third design.

## Option C — Board

**Idea.** Land on a board of ten cards, one per area, each answering "is this fine and what is the
one fact I would ask about" — *Download client · Transmission on pi · changed since its last test*
— with quick actions on the card (Test, Run now, Restore stock, Enable). A page-level banner names
the blocker with **Fix it**; the header carries the primary verb, **Enable grabbing**, refused with
its reason. Opening a card replaces the board with that area's editor: essentials first, everything
else behind one **Advanced** disclosure, *← All settings* to return with focus restored to the card.
Indexers and profiles are sub-cards inside their area, each expanding in place.

**Optimises for** the 95% visit, which is a glance rather than an edit: it mirrors how Jellyfin's
own Dashboard home reads (cards of state and activity), so the plugin page stops looking like a
foreign form.

**The awkward parts.**
- *Many settings:* two levels — card, then editor — and the Advanced toggle. That is progressive
  disclosure done honestly, and it is also the cost: two clicks to reach a limit field, and a
  field you cannot Ctrl-F until you open its area.
- *Secrets:* the shared component.
- *Connection tests:* on the card *and* in the editor; the busy state shows on the card so the
  board is a live status view.
- *Readiness:* the banner, the header CTA and the card stripes (error red, attention amber) all say
  the same thing. It is the loudest of the three, which is right for a blocked system and slightly
  much for a healthy one.
- *Long lists:* sub-cards with state and an expand-in-place editor; the failing one opens by
  default. Scales less well than B's rows past a dozen items.

**Mobile.** One card per row, the banner and CTA stack, the detail view is a full-width panel with
the same Advanced toggle. Fine at 390px; the board is a longer scroll than B's picker.

**TV.** The grid is a three-column focus matrix, each card one stop plus its quick actions; Enter
opens, Back returns to the same card. Comfortable with a D-pad but the most two-dimensional of the
three.

**Effort.** ~4–5 days plus E2E: card grid, card summaries (each needs its own data shaping), the
drill-in/back with focus restoration, disclosures, sub-cards, and the same restructuring. More
bespoke surface than A or B.

**Upstream maintenance.** Highest. The cards intentionally echo the Dashboard home, which is a
surface upstream changes; a mismatch there is visible in a way A's and B's neutral panels are not.

**S8 reuse.** Medium. The editors (with Advanced) and the components carry over; the card board
does not fit PHASE7 §5's sectioned area and would become an Overview page at most, so the summaries
and the grid are the throwaway part.

## Side by side

| | A · Ledger | B · Checklist | C · Board |
| --- | --- | --- | --- |
| Answers "why is grabbing off" | strip at top | rail head + badge, always visible | banner + CTA + card stripe |
| Reach any field | scroll / Ctrl-F | pick section | open card, maybe open Advanced |
| Long lists | inline expand | rows + sheet | sub-cards, expand in place |
| Mobile | chip index | picker + Next → | stacked cards |
| TV walk | longest | two columns | 3×4 matrix |
| Effort | 1.5–2 d | 3–4 d | 4–5 d |
| Upstream drift risk | lowest | moderate (sheet) | highest (cards) |
| Reusable for S8 | components, CSS | almost all | editors, components |
| Throwaway | page shape | vanilla wiring only | board and summaries |

## Recommendation

**Ship B.** It is the only one of the three whose structure is the same structure the product needs
twice more: PHASE7 §5's settings area (S8) and §7's wizard (S10) are both "the pipeline, in order,
with readiness per step and a Test at each." Building that shape once on the Dashboard page means
the CSS (`jfmod-settings*`, feature-local, `em`), the section markup, the sheet, the copy and the
blocker-to-sentence map are the S8 implementation's inputs rather than a second design to reconcile.
A is cheaper and would fix the ugliness, but its single scroll is exactly the part S8 cannot use;
C is the best looking when everything is healthy and the most work to maintain against upstream,
for a page whose whole purpose is the unhealthy moment.

**On the elephant — invest now, wait for S8, or serve both?** Serve both, and do not wait. S8 is
Stage C of Phase 7 and depends on S7 (the settings contract) and S2 (the shell), neither started;
meanwhile the Dashboard page is the only admin surface during user testing. So:

1. Rebuild the Dashboard page as B now, in the vanilla JS it already uses, keeping the existing
   wiring and adding the Interface section it is missing. Put the styles in one `jfmod-settings`
   stylesheet the page inlines today and the fork imports later.
2. When S8 lands, the React area imports that stylesheet and reimplements the section bodies
   against the same DTOs; the Dashboard page then shrinks per PHASE7 §5 to the rail head (readiness),
   the Interface section and a link — a subset of what was built, not a rewrite.
3. S10 reuses B's sections with gates added.

Two implementation notes for whoever picks this up, so the mockups are not mistaken for finished
CSS: the mockups use flex/grid `gap`, which UX §13's proposed W11 rule avoids for old webOS engines;
the real stylesheet should use child margins if this page must render on the physical TV (it need
only be reachable there per PHASE7 §5). And the mock stock-element styles are approximations of
`emby-input`/`emby-checkbox`/`emby-button`; the real page inherits the genuine ones and only adds
the `jfmod-` layer.
