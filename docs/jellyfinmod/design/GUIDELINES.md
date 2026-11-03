# JellyfinMod design guidelines

**Status:** the whole design is approved by the user on 2026-11-02 (D212–D231) and is being built in slices: [PLAN.md](../PLAN.md), *Redesign*. Slice 1 (light glass, cards, the Movies and Shows grid) is built, not accepted; everything else here is approved and not yet built. Copied from the workspace's `reviews/design-system/GUIDELINES.md` (git-ignored); the live specimens and pages, the `*.html` links below, stay in that folder.

These rules apply to every page a signed-in user reaches outside the admin Dashboard, and to every new component. **Decided (D225–D226): the admin Dashboard and the mod's admin settings and wizard stay as they are.** The component guides in `jellyfin-web/docs/jellyfinmod/design/guides/` stay the reference for each component's own values; this document says how they fit together. Where the two differ the difference is listed under [Departures](#departures). An existing component keeps its approved values until it is next changed, and that change brings it onto this scale.

## 1. Base unit and the φ scale

The base unit is **1em = the layout's root font size**: phone 14.4 px, tablet and computer 14.88 px, TV 20 px. Every value is a power of φ ≈ 1.618 of it. A value off the scale is a named exception (section 9).

| Step | em | Used for |
| --- | --- | --- |
| φ⁻⁵ | 0.09 | a field's outline, the secondary button's outline |
| φ⁻³ | 0.236 | hairline bars (player bar, queue bar), tight line gaps, the TV's focus ring |
| φ⁻² | 0.382 | gaps inside a block: lines under a title, pill padding, caption gap, between glass pickers; corners of a thumb under 3em |
| φ⁻¹ | 0.618 | **every poster and still corner**, a settings tile, a list row, the current entry's check, small gaps, phone card gap |
| φ⁰ | 1 | body text, cell padding, horizontal gap poster to column, field gaps, corners of an open list |
| φ¹ | 1.618 | line pitch of reading text, H2 and phone title, glass picker radius, button side padding, vertical block gaps, corners of a card or dialog |
| φ² | 2.618 | wide title, settings tile, switch track width, sign-in padding, foot of a page |
| φ³ | 4.236 | avatar, settings row height |
| φ⁴ | 6.854 | person card width, minimum Play width, empty-state padding |
| φ⁵ | 11.09 | poster width on index pages, narrow-column threshold |
| φ⁶ | 17.94 | still width, minimum menu width |
| φ⁷ | 29.03 | sign-in sheet, empty-state text |
| φ⁸ | 46.98 | form column |

Rules: a vertical gap is the horizontal one × φ where both exist. **Corners nest:** a surface's corner is its inner corner plus its padding, so they run parallel. A settings tile's 0.618em + the row's 1em = a card's 1.618em; a list row's 0.618em + the list's 0.382em = an open list's 1em. Proportions divide by φ too: poster to column 1 : φ² (27.6 % : 72.4 %), a phone poster 61.8 % of its column, a Home hero 61.8 % of the screen, a fade over the bottom 38.2 %. On the phone a card row is 38.2 % or 61.8 % wide per card, so 2.618 or 1.618 cards show.

## 2. Surfaces

There are three. Each has one job.

| Surface | What it is | Use it for | Never |
| --- | --- | --- | --- |
| **Ground** | plain `#101010` (light `#f2f2f2`), or **art ground**: the title's art, blurred and darkened, behind the bar and the head, fading into plain ground | the page itself. Art ground only on a page about one thing (detail, person). The Home hero and the player show their art sharp, under a black scrim | art ground on index pages or forms |
| **Card glass** | the recipe of card-glass.md: bar colour at 12 % + `blur(12px) saturate(180%) contrast(0.7) brightness(0.85)`, white ink, no edge line or shadow. Light: **Light glass** below (D259, D262) | what floats over art or scrolling content and is **short**: the scrolled top bar, action pills, track pickers, the view picker, poster marks and discs, and the sign-in sheet (approved, D221–D224) | rows of small text; a second tint or darker disc |
| **Paper** | `#202020` (light `#e8e8e8`) | what you **read or choose from**: open lists, menus, dialogs, settings cards, the download block. Cards and dialogs have 1.618em corners and a faint 1 px outline | floating over art without a shadow; a gradient; a heavy border |

- **Art ground recipe:** `blur(22px) brightness(.45) saturate(1.1)` on the phone, `blur(40px) brightness(.4) saturate(1.1)` from tablet up; fade over the bottom 38.2 %. Light theme: `brightness(1.25) saturate(.8)` at 55 % opacity, ink stays dark.
- **Light glass (D259, D262):** in the light theme every control over art or the page is white glass: fill white 61.8 %, `blur(12px) saturate(170%) brightness(1.09)`, no contrast step, black 87 % ink, no edge line. That covers the disc at rest, the card's action pill, corner marks, the hero and detail pills, pickers, the scrolled top bar and the sign-in sheet; the ratings popup reads the same fill and filter with its own 1.618em blur. Play and the disc under the pointer stay dark. It supersedes `card-glass.md`'s light recipe until the build updates that guide. The values live in five tokens in `components/lightGlass.scss` (`ds.css` in the mockups): `--jfmod-light-glass-fill`, `-blur`, `-saturate`, `-brightness` and `-ink`. A small label on it uses the full ink, with no opacity stacked over it, so it meets 4.5:1 over black and white art. [Tune them live](page.html?page=light-controls). The dark theme and the TV do not use them. Known weakness: on a pale art ground the pill and pickers sit close to the ground, about 1.15 to 1.41:1 surface to ground, with no edge line by the guide and by the user's choice (D258).
- **Sharp art** (Home hero, player): text ink is white in both themes, on a black scrim; the controls on it follow the theme's glass (D259, replacing D251's dark hero pill). The player is always dark. **Where the bar sits over sharp art, a black fade runs over its top: 61.8 % to nothing over 6.854em (approved, D225–D226).** It keeps the bar, the search box and the icons readable on bright art.
- **TV:** the glass is solid `rgba(0,0,0,.66)` with no blur, as card-glass.md says. On the TV's plain dark ground it would disappear, so there it takes solid grey paper; on art ground the TV keeps the solid black (approved, D225–D226). Art ground stays on the TV; it is one static image, not a blur over moving content.
- **No `backdrop-filter` or `color-mix()`:** the same solid fallback as the TV: black 66 % with white ink on glass, paper on the bar, the search box and the ratings popup. The build gates the translucent recipes with `@supports` (D251).
- **The player's glass stays, and is measured for stutter when built. If it stutters, the player joins the TV's solid fallback** (D227).

## 3. Type

- **Font:** Noto Sans for what the page says (upstream's), at 400, 600 and 700, all loaded (D251). Inter for the mod's dense components: track pickers, media marks, the picker, the queue rows, dialogs. Release names are monospace. Two fonts, approved (D221–D224).
- **Sizes:** body 1em. Reading text at line pitch 1.618. Row title (H2) 1.618em, weight 400. Page title 1.618em, weight 600. Detail and hero title 2.618em, weight 600 (phone 1.618em). Captions 0.72em, 600, uppercase, letter-spacing 0.06em. Group title 0.8em, 600, uppercase, 0.06em.
- **Weights:** 400 and 600; 700 only for a card's title line and a main button's label.
- **Secondary text, as opacity of the ink:** 85.4 % (1 − φ⁻⁴) for a card's second line and for text on sharp art; 70 % for `text-70` body and muted figures (upstream's, dark theme only); 61.8 % (φ⁻¹) for the least important: rail letters, release names, caption labels.
- **Case:** buttons and menu actions in Title Case, never uppercase; help, status lines, notices and field labels in sentence case (buttons guide).

## 4. Colour

Colour is rare, and each colour has one meaning. Art supplies the rest.

| Colour | Value | Only for |
| --- | --- | --- |
| Primary | `#00a4dc` | **where you are**: the current entry, the active nav item, focus rings, a field under the pointer or open, a switch that is on, the watched tick and unwatched count (72 %, on glass), watched progress, links. Also the main button of a form or dialog |
| White Play | `rgba(255,255,255,.854)` with `#101010` ink; light theme `rgba(16,16,16,.854)` with white ink | the Play or Pause in a glass pill: detail page, Home hero, Play All, player (approved, D213, D221–D224). `#fff` under the pointer |
| Error | `#c62828`; on dark text `#ff7b72` | destroy buttons, failure text and figures. Nothing else. A failed **mark** is grey glass with a white `!`, not red |
| Star | `#f2b01e` | the rating star and the slow-setup warning |
| Indexer hues | indexer-colour.md | the picker's Sources and the indexer rows |

No gradient, tint, or brand colour on a surface. No amber in the download design.

## 5. Components

### Buttons

Three kinds, as the buttons guide, all pills of one size, the height of a field: **2.7816em** (the 40 px minimum at the phone's root; φ² would be 37.7 px), corners half of that, side padding 1.618em (φ¹), label 1em in Title Case, hugging the label. One main per view.

| Kind | Rest | Hover | TV focus | Disabled |
| --- | --- | --- | --- | --- |
| **main** (Save, Sign In, Authorize, Get a Release) | solid primary, white 700 label, no outline or shadow | a lighter fill, `#19b4ea` | a 0.16em ring in the ink, grown 1.08 | no fill, a hairline outline, ink at 61.8 % |
| **other** (Cancel, Add Image, Use Quick Connect) | no fill, a 0.09em neutral outline, 600 label | a 12 % tint | filled primary, white label, the same ring, grown 1.08 | as main |
| **destroy** (Remove, Delete the Download, Search Again) | solid `#c62828`, white 600 label | a lighter fill, `#d84343` | stays red, the same ring, grown 1.08 | as main |

Keyboard focus on a computer: a 0.15em primary outline, 0.15em off the pill. A refused action uses `aria-disabled` and keeps its focus stop (buttons guide). **Width:** buttons side by side hug their labels. **Buttons stacked in a column share one width, the widest's** (its label plus the side padding), centred, not the full sheet width: sign-in, and user select on the phone. The remove dialog keeps its full-width outcome buttons, as its guide says.

- **Action pill:** a card-glass pill, radius 3em, padding 0.382em, with white icons (dark in the light theme, D259; 3em box, 1.6em glyph, round; hover a white 12 % tint) and the one labelled **Play** in white. Its order is Play, then the page's actions, More last. Phone: full width with Play stretching. Tablet up: hugs its content, Play at least 6.854em.
- **The main button is white wherever a glass pill carries Play or Pause:** the detail page, the Home hero, Play All and the player (D213, D221–D224). Forms and dialogs keep the solid blue main pill above.
- **Row actions** stay round, transparent icons of at least 40 px: 2.5em in the mod's rows, 2.7816em on upstream's `.listItem`. State lives in the glyph.
- **Disclosure:** the group title's look, a chevron turning a quarter, closed by default.

### Pickers

A glass pill per cell, radius 1.618em, 0.382em apart, no border or dividers; a hover tint of white 12 %; TV solid. The open list is paper, 0.382em under its cell, and follows Dropdowns; every open cell's chevron points up (D251). Cells, widths, captions, runs and stacking stay as track-dropdown.md: the strip stacks where the Video cell would be under 11.7em (D251), and a closed Video mark shows whole or not at all (D251). A one-word picker (the library's view) is a 2.618em glass pill with a chevron. The closed pills do not change.

### Dropdowns

For a setting or a dialog's choice, on paper. Over art, use the glass picker above.

- **Closed (approved: neutral until used, D216–D218, D221–D224):** a pill field, 2.7816em high, a clear neutral 0.09em outline (white 32 %, light theme black 32 %) and no fill; the value, an optional leading icon, a chevron. No flags: a language is not a country.
- **Hover:** a 0.09em primary outline and a 14 % primary fill. **Keyboard focus or open:** a 0.135em ring. **TV focus:** a 0.236em ring. **Open:** the chevron flips. **Disabled:** a hairline outline, ink and glyphs at 61.8 %, no hover. **Refused:** a 0.135em red outline, the reason under it.
- **Open list:** a paper sheet 0.382em under the field, as wide as it or wider, 1em corners, 0.382em padding, rows 2.618em high with 0.618em corners and 1em left padding, a soft shadow.
- **Current entry (approved, D220):** the check and the blue name together. The name is in the primary, and a 0.618em primary check (stroke 4.2 on a 24 box, round caps) sits 0.236em from the row's left edge, in its padding, so it takes no space and nothing shifts. The marks, the size, a role mark, the row's actions and a trailing value keep the text colour. No tint, no trailing check, no bar. **Hover:** a grey fill. **TV focus:** a 0.236em primary ring inside the row, with the check and the blue name unchanged under it when it is the current one.
- A long list scrolls inside the sheet, at most 20em (as the track lists).

### Switches and checkboxes

- **A switch is for one on/off setting:** Remember Me, Show library backdrops, Blocklist this release, Fall back to lower quality. Track 2.618em by 1.618em, knob 1.236em and white. On: the track 38.2 % primary with a 0.09em primary outline. Off: neutral, 18 % white. The whole row or line is the control. Hover: a 12 % halo. Disabled: 45 %. The knob slides in 0.236 s; reduced motion stops it.
- **A multi-select list keeps checkboxes:** the picker's Sources and the quality matrix. A tick says "this one is in the set", and a column of switches would read as many separate settings. In Sources each box also carries the indexer's fixed colour, which a switch cannot. They stay as their guides draw them.

### Settings rows

One paper card, 1.618em corners, a faint outline, under a bold section heading (1.236em, 600). Each row is at least 4.236em high and padded 0.618em by 1em, with a hairline above it: a 2.618em tile with 0.618em corners (grey, approved D221–D224: the hover fill, the glyph in the ink), a title in 600, one muted line at 0.854em, the control at the end (a chevron, a switch, a 17.94em field). Hover: a grey fill. On the phone a field moves under the words, a switch stays at the end. Sign Out is a neutral row, like the others: it deletes nothing (D229). The whole row is the D-pad stop.

**Preferences use this full design (approved, D216–D218):** tiles and descriptions stay, and the mod owns those pages. The accepted costs: upstream's changes to these pages stop arriving by themselves, so each upstream merge has to be checked against them by hand; and the new words need translating.

### Cards

- **Shape:** posters and stills have **0.618em (φ⁻¹) corners**, one value on every card, row, grid and head: 9 px on a computer, 12 px on the TV, and the same as the approved head poster. φ⁻² (0.382em, about 6 px) barely reads as rounded at card size; φ⁰ (1em, about 15 px) starts to cut into the art and crowd the 1.6em corner marks. Only thumbs under 3em wide (the Queue, Up Next) take 0.382em, because 0.618em makes them pill-like.
- **Cell:** each cell is padded 1em, so posters sit 2em apart. Phone: flush, 0.618em between cards.
- **Caption:** left-aligned under the poster, 0.382em below it, 1em at pitch 1.618. Line 1 is the title in 700; line 2 is the year in 400, or the second fact at 85.4 %; search adds a third line. **The Movies and Shows grid has three lines too (D260):** line 3 is the two lead actors at 0.854em (1 − φ⁻⁴; 1em on a TV) and 85.4 % ink, cut with an ellipsis when they do not fit, and a title with no cast holds a blank line, so every card has the same height. Cast comes with one read per page of the grid, about 6 KB a title uncompressed, with no per-title requests (the plugin's combined browse carries no People, so the build reads the page's ids at once). With a page size of 0 no cast is asked for and the line stays blank; a title with no cast of its own, or no native item, has only its entry's cast, a series' regulars. The title line is at full ink at rest, and hover does not change it (D227).
- **Hover (approved, D216–D218):** a 0.135em primary ring follows the poster's corners with no gap; no panel, nothing shifts. Of the caption and the ring, hover changes only the ring (D227), and it fades, with no lift (D228, D229, section 7). This is the only hover. Under the pointer the poster also dims **23.6 %** (φ⁻³) and shows the centred **3.236em** glass disc (2φ¹; play, or the cloud without a file), which grows **1.146** when the pointer is on it (D248), and, on a computer or tablet, Watched, Favourite, Get a Release and More in one glass pill at its foot (approved). This is the middle between our old disc and upstream's, measured at 1440: ours 41 px growing to 45 px with no dim; upstream 58 px growing to 81 px with a 50 % dim; **this 48 px growing to 55 px with a 23.6 % dim** (D229, D248). A press takes the disc to 1.09 (D248). The search + is the same disc (D207), hidden at rest and added from the browse page on a phone or TV, as `search-card.md` says. Each icon in the pill is a 2em round button with its own tint and tooltip.
- **TV focus:** the same shape, the ring 0.236em (φ⁻³) in the primary; no pill (the actions come from the title's page).
- **Phone:** no hover and no ring. A tap opens the title; a press does nothing else.
- **Marks:** the corner marks follow download-state-mark.md: a 1.6em glass disc for Not Downloaded and a download; a date in the corner for Unaired (approved: no chips at the foot); the watched tick and the unwatched count in **strong blue glass** (approved, D221–D224): the primary at 72 %, the card glass's blur, a white glyph; TV the same colour, no blur; the light theme the same, because the mark sits on the poster, not the page. **Failed** is the grey glass with a bold white `!` (section 5, JellyfinMod surfaces). The foot bar is 0.28em. The search + stays centred (D202, D207).
- **Sizes:** in a row, poster 11.09em; still 17.94em; person 6.854em. **Movies and Shows grid (D260):** the count is automatic from a 16.18em target cell, stretched to fill the row: 5 a row at 1280, 6 at 1440, 8 at 1920, 10 at 2560, tablet 3, with no setting. TV: 6 posters or 4 stills a row. Phone: grid 2 a row with the rail; a row 38.2 % a poster, 61.8 % a still. Search keeps 5 a row (D200), because it shows fewer titles larger.

### Rows and lists

An episode row is padded 1em: still with 0.618em corners, title in 600, meta line, up to 3 lines of text, round actions at the end. Under the pointer the still takes the card's ring; TV focus the same, ring 0.236em. A status stays in the end slot and on the meta line, never over the still. A row with no still (the Queue, a release) takes a grey fill under the pointer, 0.618em corners on the Queue, and a 0.236em primary ring on the TV.

A settings row follows Settings rows above (D251).

### Dialogs, menus and sheets

- Paper, 1.618em corners, a faint outline, a soft shadow. Title 1.618em, weight 400, with the close X level with it on the right.
- Buttons at the foot, main last; the remove dialog keeps one full-width button per outcome.
- A menu or action sheet is the open list of Dropdowns. On a TV or phone, a dialog may go full screen.
- The release picker, the remove dialog and the quality profile dialog are mocked in these rules (JellyfinMod surfaces). Until they are built they keep their guides' values; departures 10, 12 and 13 list what changes.

### Menus

Every menu in one surface, whatever opens it. [The Menus page](page.html?page=menus) shows them all, open: until now the styles only existed as `state=menu-open` on other pages, so there was no place to see them. That page holds the detail and card More menus, the user menu, the library's Sort, Filter and view settings, the player's menus, and the track lists for reference.

- **Surface:** paper, 1em corners, 0.382em padding, a soft shadow; rows 2.618em high (2.7816em on a phone, the 40 px minimum) with 0.618em corners and 1em padding. A 1.4em icon where the row has one, 0.618em before the words.
- **Entry states:** hover a grey fill. Current: the check and the blue name. **Refused:** 45 %, a tooltip saying why, `aria-disabled`, keeps its stop. **Destructive:** the row in the failure colour, at the end of the list, only where data is lost (Delete Media). Sign Out is neutral (D229). A value sits at the row's end at 0.854em and 70 %. A chevron at the end opens a second list, with Back on top; the player's Settings is the only real submenu.
- **Groups:** a group title in the captions' type, or a hairline with 0.618em inset. A multi-select group keeps checkboxes; an on/off setting is a switch.
- **Computer:** floats from its button, 0.382em away, opening from the edge nearest it. **Phone:** a bottom sheet, 1em top corners, a grab handle, over a 61.8 % scrim. A field's own list stays under the field. **TV:** floats at its anchor; the focused row has the 0.236em ring and Back closes it. A menu scrolls inside at most 20em, with the focused entry kept in view (D251).
- **Player:** always dark, in the light theme too.

### Spinner

Upstream's spinner, one golden step smaller, everywhere it shows (D231). A CSS-only change to `components/loading/loading.scss`; the motion and the markup stay upstream's.

- **Size:** 6.18 % of the screen height (upstream 10 %). The box is `6.18vh`, centred.
- **Arc and circle:** a white arc on a faint full circle (white at 30 %), the same thickness: 0.21em, upstream's arc.
- **Light page:** the arc in the ink (black 87 %) on a black 25 % circle, the card glass's own light track, because white is invisible there. The player and the black screen are always dark, so the white version holds there in any theme.
- **Reduced motion:** it stops and dims to 55 %.
- **TV:** runs, since upstream's motion is only `transform` and `opacity`.

### Inputs

A text field is the dropdown's pill without the chevron. In a settings row the row's title is its label. Elsewhere the label sits above it at 0.854em, 1em in from the pill's end, and turns primary with focus. Required marked by the end asterisk (settings-field.md). Help line under it, 0.85em, one or two sentences. Search is the box in the top bar (below). On sign-in, where the fields sit on glass, a label stays in the ink and only the ring shows focus. A refused sign-in keeps the user name, marks the password field in the failure colour and says upstream's words under it. A search with no results keeps the query, with the empty layout (D251).

### Top bar

Favorites, Shows, Movies, then the icons and the avatar. The active item is primary. Over art it is transparent with white ink; scrolled it is card glass (card-glass.md). Plain pages draw it on the ground. Under a 1366 px window the bar drops the wordmark, as the tablet does, so the nav clears the centred search box (D254).

**The search box is in the bar (approved, D221–D224), and the search icon goes.** A pill at the bar's centre: 29.03em wide, at most 42 % of the bar, 2.618em high, 1.309em corners, padding 0 1em 0 0.618em, white 9 % with `blur(12px) saturate(180%)` (light theme black 6 %), a 1.382em glyph. It is one piece of glass with its own values, not the card glass.

- **Computer:** click the box and type. The first letter opens the Search page, with the results under the bar. There is no second box on that page. While you type the box has a 0.135em primary ring. Hover: white 14 %.
- **Tablet:** too tight to centre, so it fills the gap between the menu and the icons, and the server name goes.
- **Phone:** the icon stays, and the field is on the Search page.
- **TV:** back, home, title, the box, the icons, the clock, always transparent. The box is a focus stop in place of the icon: solid, paper on a plain page and black 66 % over art, with a 0.236em ring when focused. **Enter opens the Search page with focus in the box and starts the TV's own keyboard.** Nothing is typed in the bar except what that keyboard sends. The alphabet picker under the bar stays, for remotes that have no keyboard. Down moves to the results; Back closes the keyboard first, then leaves the page.

### JellyfinMod surfaces

Every surface the mod adds keeps its guide's content and states and takes these surfaces. Mockups: the "JellyfinMod surfaces" heading on [the index](index.html).

- **Release picker** (`release-picker-sources.md`, the picker's design note): a paper dialog, 76.01em (φ⁹) wide, full screen on the phone and the TV. Title row with Sources, Show Names, Open Transmission, Close; Search For and Quality Profile as pill fields; status line; rows on hairlines; Rejected as a closed disclosure; a grab's block under its row with a coloured left edge. A release row reads quality, flags, languages, then size, seeds, indexer in fixed columns, then + Add and the red ⟳ Replace, with the media marks on line 2. Indexer colours only in Sources and the search ring.
- **Download marks** (`download-state-mark.md`): glyph and arc in the glass ink on a poster or still (1.6em disc in the corner), in the row's icon colour at 2.5em or 2.7816em, 4em with the percent inside on a page. Bar at the foot 0.28em. Figures on the meta line in 600. **Failed** (approved, D216–D218): on posters, stills, rows, the pending entry and the download block, grey card glass with a bold white `!` (on the 24 box: stroke 4.4, round caps, dot radius 2.2, glyph scale 1.1; the light theme uses the glass's dark ink, the TV solid glass); figures and text stay red.
- **Download block** (`download-block.md`): one paper panel with 1.618em corners in the track pickers' place; ring, state line, release, marks, pack line, bar, actions.
- **Versions** (`track-dropdown.md`, `pending-version.md`): glass pickers; paper lists with the check and the blue name; the pending entry under the pickers or in the Video list.
- **Queue:** rows on the ground with a grey hover, disc-only State column, bar and figures. A TV has no tooltips, so a seeding row's facts are lines under its title, in `text-70` (D251).
- **Dialogs** (remove, quality, Remove After Watching): the dialog rules above, the three button kinds. On a TV the Remove dialog's safe choice starts focused, with the other button's focus (D251).
- **Add to Library:** a blue main action inside the glass pill, because it is not Play. Then Get a Release in the same place, with Undo beside the head.
- **Retention:** the countdown on the Played tick, `∞` in the primary when kept; Episode Retention and History as closed disclosures.
- **Ratings** (`ratings.md`; approved by the user on 2026-11-03, D243): usually three, always in this order: IMDb, RT critics, RT audience, then Trakt if ticked. A source with no value is simply not there. Each is a stack, the real mark over its number: mark 1em high, number 0.78em at 600, stacks 0.6em apart, marks from `RatingIcon` and never redrawn.
  - **Where:** the first metadata row of Home's banner and of movie, series, season, episode and Add to Library heads, replacing the ★ and the tomato. Order in the row: year, runtime, badge, group, Ends at. Episode rows keep the ★, because the guide puts no ratings there.
  - **When it does not fit:** nothing changes order. On a phone (390) the group stays on the first line and what follows wraps to the next, centred, and the group is 3em high for the finger. TV 1280 and every wider device hold one line. Trakt gives way first, as the guide says.
  - **On a card:** off by default; the user picks one source in Ratings Display, and it joins line 2 as `· <mark> <value>`, with no corner badge.
- **Ratings dropdown** (approved by the user on 2026-11-03, D243; [all sources](page.html?page=menus&state=ratings), [one missing](page.html?page=menus&state=ratings-missing), [open on the page](page.html?page=movie&state=ratings-open)): small and narrow, as wide as its content. One row per source in the same order, three aligned columns: mark, value at 600, muted count (`8.7`, `2.1M`). The mark is the label: the name and the word "votes" are only in the row's tooltip and `aria-label`. No heading, footer, links or actions.
  - **Surface:** glass, a departure from "lists you read are on paper" approved for this popup only (the user, 2026-11-02), so it matches the pill and pickers. Fill `#202020` at 38.2 % (light: the light glass tokens, D259), with the card glass's filter at a heavier blur of 1.618em, so what is behind reads as colour, not shapes. No hairline; a soft shadow of 0.236em by 1em. A caret in the same fill fills the 0.382em gap to the group, so they read as one shape, and the group is lit while it is open. **TV:** no blur, so solid paper with a paper caret.
  - **Size:** 0.618em corners, 0.382em by 0.618em padding, rows 1.382em (20.6 px on a computer). Marks 1em over values and counts 0.764em (14.9 px over 11.4 px on a computer), the same balance as the stacks. Counts are right-aligned in tabular figures at 70 % (85.4 % in the light theme).
  - **Display only:** no row lights up, shows the finger or takes focus.
  - **Computer:** opens on hovering the group, with the menu's motion. **Phone and tablet:** a tap on the group; a phone gets the same popover, not a sheet, because three short rows do not need one. **TV:** the same layout at the TV's root, OK opens it, focus stays on the group with the guide's fill and outline, and Back closes only the dropdown.
- **Notices on Home:** one paper strip with 1.618em corners, its text and its buttons; never a coloured banner.

### Focus and hover

- **Tooltips:** paper, 0.618em corners, 0.854em text, in Title Case naming the action, with the key where the player has one: *Fast Forward (L)*, *Rewind (J)*, *Skip to Next (Shift+N)*, *Full Screen (F)*. A 0.382 s wait, then a 0.236 s fade. None on a phone or a TV. The real player shows the browser's native `title` today, in upstream's sentence case (*Fast-forward (L)*); the mod's own styled tooltip replaces it.
- **Pointer:** a tint that fades and nothing else. Glass and icons take a 12 % tint; paper rows take the hover fill; posters and stills take the ring. Nothing grows except the poster discs (1.146, D248), which also fill like Play under the pointer: glass to white 85.4 % with a #101010 glyph, black 85.4 % with a white glyph in a light theme, fading with the growth on 0.236 s. **Icons in a glass pill over art take a stronger tint:** white 23.6 % (φ⁻³; light glass black 14.6 %), because 12 % does not read there; this covers the poster's pill and the detail page's action pill. A phone has no hover at all.
- **The finger:** everything that can be clicked shows `cursor: pointer`: Play and every button, a pill's icons, a poster's disc, a whole card or row, a menu row, a picker, a field, a switch, a link. Disabled things and anything display-only keep the arrow.
- **Keyboard on a computer:** a 0.135em primary ring on `:focus-visible`.
- **TV D-pad:** every action is a stop; the arrows walk in reading order; Back closes the top layer.
  - Play: a 0.15em primary ring, grown 1.08. A pill's icon: filled primary, grown 1.2.
  - Card or row with a still: a 0.236em primary ring on the poster or still. Other rows: the ring round the row.
  - A settings row: a 0.236em primary ring following the card's corners, and it is the only stop in the row; Enter toggles its switch or opens its list.
  - A field on its own: a 0.236em ring outside the pill and a stronger fill. An open list: arrows walk the rows, Enter chooses, Back closes and returns to the field.
  - A list row: a 0.236em ring inside the row; the current entry keeps its check and blue name under it.
  - A button: as the table in Buttons.
  - A row action: the white double ring (buttons guide). Indicators are never stops.
  - On arrival the first stop is Play on a detail page, the first card on an index page, Pause in the player.

## 6. Layout per device

| | Phone 390 | Tablet 768 | Computer 1440 | TV 1920 |
| --- | --- | --- | --- | --- |
| Root | 14.4 px | 14.88 px | 14.88 px | 20 px |
| Gutter | 5 % | 3.3 % | 3.3 % | 3.3 % |
| Detail head | poster first, centred, 61.8 % wide; pill full width | poster 27.6 % left of one left-aligned column | same | same |
| Track pickers | stacked | stacked (Video under 11.7em, D251) | a row of three | a row of three (stacked at 1280) |
| Index grid | 2 a row, rail (D260) | 3 | 5 at 1280, 6 at 1440, 8 at 1920 (D260) | 6 |
| Search grid | 2 | 4 | 5 | 5 |
| Search box | icon; field on the Search page | in the bar, fills the gap | in the bar, centred | in the bar, solid, a focus stop |
| Forms | gutter to gutter | 46.98em column | 46.98em column | 46.98em column |
| Card hover | none | ring and pill | ring and pill | focus ring only |
| Player | letterboxed; transport centred, tools under it | one row | one row | one row, solid pills |

Things stack when the column they share is too narrow to hold both at their guide's width, measured from the element itself (the D199 rule), never from the viewport alone.

## 7. Motion

Short, and only state. CSS only, no animation library. [The Motion page](page.html?page=motion) runs all of it live, with Replay and Slow (×5).

**Three durations, a short press and one easing, `cubic-bezier(0.236, 0, 0, 1)`:**

| Duration | Used for |
| --- | --- |
| **0.146 s** (φ⁻⁴) | a press, to 0.96 on Play and buttons, and the disc's press to 1.09 (D248), because it must answer the finger at once; and the TV's fades (see below). Nothing else |
| **0.236 s** (φ⁻³) | what answers the pointer: **every round icon button's hover tint, in and out** (player, action pills, the bar's icons, row actions), row lighting, a tooltip's fade, Play's hover, the disc's 1.146, a switch's knob, the check appearing, the black screen's fade; and everything leaving: hover off, a menu closing |
| **0.382 s** (φ⁻²) | what arrives: the card's hover (ring, dim, disc and action pill fading in together), a menu opening from its anchor (opacity, scale 0.964 to 1), the chevron flipping; and the phone's sheet going down. Also the wait before a tooltip, which is not an animation, so it did not slow down with the rest (the user, 2026-11-02) |
| **0.618 s** (φ⁻¹) | the phone's sheet coming up |

- **Leaving is faster than arriving,** except a button's tint, which is 0.236 s both ways because it answers the pointer. An entrance should be seen; leaving should get out of the way, so moving across a row of posters leaves no trail.
- **Nothing shifts the layout.** Neighbours and captions stay put. The caption does not change on hover (D227).
- **Starting playback (D230):** a short press to 0.96 (0.146 s), then a black screen with the spinner until the first frame. No spinner on the button, and no wait. The black screen needs a little code: the mod draws it on Play and removes it on `playbackManager`'s `playbackstart` or `playbackerror`. Upstream's `loading.show()` draws the spinner on top, and on a light theme the black screen must also set the always-dark spinner colours, so that part alone is not CSS-only.
- The download mark's bob and spin, and the spinner, are the only loops. Nothing slides or fades in on page load.

**Reduced motion:** everything is an instant change, except a menu or sheet, which fades in 0.146 s with no scale or slide. The disc does not grow (D248). Loops stop and dim the glyph.

**TV (webOS 6):** only `transform` and `opacity`, nothing during D-pad scrolling, no blur at all.

- **Runs:** a menu's fade (opacity, 0.146 s, closing instantly); a press on Play and on buttons (0.96, 0.146 s), and on a disc (0.96, at once, D248); the black screen's fade (0.146 s); the chevron (0.146 s); the spinner.
- **Does not run:** the focus ring, disc, dim, row focus and action pill on a card or row (instant, because they change on every D-pad step), row lighting, the knob, the check, the sheet (there is none).
- Not measured on a real TV yet: measure on the C1 when built, and cut the menu's fade first if it costs.

**Cost:** `transform` and `opacity` are composited. The ring (`box-shadow`), Play's fill and a row's light repaint a small area while they run. The dim is composited. The disc and the pill keep their blur while they fade, so the browser resamples it for those 0.382 s, on one poster at a time; `visibility: hidden` at rest means a grid of posters pays nothing until one is hovered.

## 8. Theme

Every page has dark and light. Tokens come from `themes/_base/theme.ts`; the light glass and art recipes are in section 2. On a sharp picture the text ink is white in both themes; controls follow the light glass (D259). The player is always dark. In light, the Play is dark with white ink, except on the TV, where glass stays solid dark.

## 9. Known exceptions

- **Content's own ratio:** 2:3 poster, 16:9 still, portrait photos.
- **40 px touch minimum:** row actions 2.5em or 2.7816em; a phone's action row 2.7816em; on a phone the bar's icons, its menu and avatar, the view picker and a switch line, all 2.7816em with the glyphs where they were (D251).
- **Ratings dropdown rows 1.382em,** under the 40 px touch minimum: they are only read, and the group that opens them keeps its touch height.
- **Upstream values kept:** gutters 3.3 % and 5 %; 3em icon buttons with a 1.6em glyph; 3.226em bar; `text-70`.
- **Field and button height 2.7816em:** the 40 px touch minimum at the phone's root.
- **Library grid target cell 16.18em** (10 × φ, D260): the user's choice of 5 posters at 1280.
- **Even cell padding** of 1em, a named exception to "vertical = horizontal × φ" (D202).
- **Ring width 0.135em** on a computer, the guides' ring (the track pickers, the focused pill), a little under φ⁻⁴.
- **Guide values kept:** strip cells 17.8em and 13.2em, the 11.7em stacking threshold (D251), the 24em list threshold; 1.6em marks; 2.5em and 4em rings; 0.28em foot bar; 0.72em captions; 0.8em group title.
- **webOS:** no flex gap, `:has`, `:focus-within`, `min()`, `max()`, `inset` or CSS grid in built code; rings are `box-shadow` (old engines do not follow corners with `outline`); fields use `rgba`, not `color-mix()`; a native `<select>` cannot draw this sheet, so a custom list mounts over it, the select staying as the source of truth (track-dropdown.md); the knob's slide is off on the TV; solid glass on TV; root sizes as in section 1; a per-row count by media query, not `auto-fill`.
- **Upstream focus on the TV:** the stock blue fill and 1.2 growth stay where section 5 says.

## Departures

Numbers stay as they were, so a decision can be traced. All are approved. The component guides and the web repository's rules change when each is built.

- **Ratings dropdown and the group's reach** (D237, approved D243). `ratings.md` has paper, 0.2em corners, 86 % text, `250K votes` and at least 11em, and opens only as a popup; this one is glass with a caret, for this popup only, with 0.618em corners, 1em marks over 0.764em values, a bare count and its content's width, on the phone too. The guide's group is on movie and series pages and cards; here it also shows on Home's banner, the season and the episode.
- **Light glass** (D259, D262). `card-glass.md` has the light recipe at the bar colour at 20 % with `saturate(170%) contrast(0.7) brightness(1.1)`; here it is white 61.8 % with `saturate(170%) brightness(1.09)`, until the build updates that guide.
- **White Play and glass pickers** (D208, D211–D213), **poster corners 0.618em** on the head.
- **1. Rounded posters everywhere** (D214, D225–D226). The web repository's rule says card radius 0.2em. Supersedes D202's and D203's square paper panel and the 0.2em poster on the search and browse cards. The older mockups in `reviews/tmdb-search-design` and `reviews/tmdb-browse-design` stay as they are.
- **3. The white main button** wherever a glass pill carries Play or Pause (D221–D224).
- **4. The search field as a glass pill**, now the box in the top bar, replacing the search icon and the box above the results (D221–D224). Typing a letter on a computer opens Search (D225–D226).
- **5. TV panels:** solid grey paper on plain dark pages, the guide's solid black on art ground (D225–D226).
- **6. Hover actions in one glass pill** at the poster's foot (D216–D218). **The ring is the only hover. Unaired keeps the corner date.**
- **9. The failed mark**, from `download-state-mark.md`: on posters, stills and rows in grey card glass with a bold white `!` (D216–D218). Red stays for text and figures.
- **10–15. The mod's screens** (D225–D226): the release picker, the download block, the Remove dialog, the Quality dialog, ratings and Add to Library, with their changes from `release-picker-design.md`, `download-block.md`, `buttons-and-row-actions.md`, `quality-profiles.md`, `ratings.md` and D196/D210, as the mockups draw them.
- **17. The current entry**, from `track-dropdown.md`: the check and the blue name on every open list, replacing the blue left bar (D220). The closed glass pickers do not change.
- **18. Three button kinds as pills** (D225–D226), from `buttons-and-row-actions.md`: other outlined, main's label 700, TV focus grown 1.08 with a ring. Title Case stays. Stacked buttons share the widest's width (D221–D224).
- **19. The pill field** (D225–D226), from `settings-field.md`: the label outside it. Help, the asterisk and the rules on required fields stay. Neutral outline at rest, blue only on hover, focus or open (D216–D218, D221–D224).
- **21. Checkboxes become switches** for on/off settings (D225–D226). Multi-select lists keep checkboxes.
- **Preferences: the full design, mod-owned** (D216–D218). Grey tiles, two fonts, My Media dropped from Home (D221–D224).
- **The strong blue tick and count, and the glass sign-in sheet** (D221–D224), from `card-glass.md`.
- **The top-bar fade** over sharp art (D225–D226).

Decided: **the mod's admin settings and wizard stay as they are** (D225–D226).
- **Captions (D227):** full ink at rest, hover changes only the ring. What was departure 2 is withdrawn.
- **7. Left-aligned captions on Home and library rows** (D227).
- **8. Nested corners on paper:** cards and dialogs 1.618em, open lists 1em, against D211's 0.618em lists (D227).
- **16. Open lists 0.382em under their picker**, against `track-dropdown.md`'s flush lists (D100) (D227).
- **The player's glass** stays, measured when built, with the TV's solid fallback if it stutters (D227).

Nothing is open.

## History

Not part of the design. Kept so a removed idea can be seen again.

- **Ring on the poster's play disc** ([live, with its animation](page.html?page=motion&state=ring-history)): approved as D245, removed by D248 because it proved too much on the posters, kept for possible later use. A thin arc drew once round the disc as it filled, and a press opened it to the spinner's arc. Arc box 4em at -0.382em, stroke 3 in a 100 viewBox, sweep 0.382 s, press dashoffset 0.25 on 0.146 s. No arc on a TV or with reduced motion.
