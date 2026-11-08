# Title pages and art ground

**Series page, rows and Download's glyph (ds.t14): approved by the user 2026-11-07 (workspace `reviews/title-golden/series.html`),
built, not accepted, gate 1 on beta (computer, dark).** A series page has **no season row and no season page from it**: under the
head, a **season pill** (card glass, the season's name at B / 600, an s0 chevron s-2 after it, padding s-1 with s0 on the left, at
least 40 px high, full round) and the slider's arrow pill (s-3 padding, s2 buttons, s0 glyphs) share the row title's line, then
**one continuous slider of every episode** in order (Jellyfin's episodes joined to the plugin's list: its file state, air dates
and the episodes Jellyfin lacks; TMDB-only specials stay out). The pill names the season of the first card wholly in view at the
left edge, so it switches once a season's last card has passed and back when scrolling left; its list (menus.md) scrolls the
slider smoothly to that season's first card and leaves the selection. A season's first card has s2 more before it (s3 in all).
Cards are the poster card's 16:9 cell ([poster-card.md](poster-card.md)): s6 stills s1 apart, `N. Title` in 700 and
`24m • ★ 7.9` below, no description. The **first unwatched** aired episode is selected (a 0.236em primary ring and a primary
title; hover keeps the 0.135em ring) and opens second from the left; a click selects. The pill's **main button follows the
selection**: **Play** (never Resume, no episode code; it resumes an episode in progress), **Download** (blue, first) for an
episode with no file, or a disabled **Airs 14 Nov** (clock, hairline, muted ink) for one not aired. The round cloud (Get Another
Quality) is in the pill only beside Play, before More. Episode Retention and History are gone from the series page for now.
Rows on every title page (computer): titles s1 at line 1, s2 above and s0 below, on the gutter; posters s5, people s4, stills
s6, s1 apart. Order: **Cast** (actors only), **Guest Stars** (a series page's: the selected episode's, titled with its
`S1:E1 · Title`), the rest, **More Like This** last. **Download's cloud is s1** (the round actions' glyph size; Play's triangle
stays s0) on every title head, movie and episode too (the user, 2026-11-07: it read smaller than the strip, tick and heart).
Code: `design/SeriesEpisodes.tsx`, `TitlePage.tsx`, `_golden.scss` (ds.t14), `titleTop.scss`.

**Home's hero on B (ds.t13), approved by the user 2026-11-07 (workspace `reviews/golden-pages/home.html`), built, not accepted.**
The hero takes the golden head's type and steps (`_golden.scss`) on every layout, on the page gutter, Bφ¹ above its foot:
title Bφ² at 700, line 1 (phone Bφ¹); the metadata at B with bullets and a plain-text rating; the ratings on their own card-glass
pill under it (the hero wraps them in `.jfmod-metaRatings`, as the head does), B below; the overview at B, at most Bφ⁸ wide, B
below the pill; the action pill Bφ¹ below, Play's words at B in its 3.333em, More Info B, round actions Bφ² with Bφ¹ glyphs. The
top fade over the art is Bφ⁴. The font of every page is Inter since ds.t13 (was Noto Sans for the title and reading text).

**Bigger poster and golden track strip (ds.t12): approved by the user 2026-11-07 ("bigger i like more"), built, not accepted,
gate 1 on beta.** On a computer the poster is no longer s6: **poster : column = 1 : φ²** of the head's inner width after the s1
gap (`width: calc((100% - s1) / 3.618)`, 2:3 kept): 319.7 / 837.0 px at a 1280 window, 363.9 / 952.8 at 1440, 496.6 / 1300.1 at
1920 (measured; reference `reviews/title-golden/`, "Poster 1 : φ²"). **Named exception:** a proportion of the window, so it does
not follow `--jfmod-scale`. The reading measure stays at most s8 (845.6 px); the track strip takes the whole column
([track-dropdown.md](track-dropdown.md), ds.t12: 60.88 px fields s-1 under the pill). An episode's 16:9 still keeps its rule.

**Golden title head (ds.t10): approved by the user 2026-11-07, 18px base, built, not accepted.** Computer layout only (gate 1
on beta); phone, tablet and TV keep the D288–D295 values below. Reference: workspace `reviews/title-golden/`, its 18px proposal
and `NOTES.md`. Every length is a token of the golden scale in `design/_golden.scss`, declared on `.jfds.dev-computer:not(.layout-tv)`:
`--jfmod-scale` (unitless, default 1, the one zoom knob; set it on `.jfds`), `--jfmod-base` = 18px × scale (1.2097 × the 14.88px
root) and `--jfmod-s<n>` = base × φⁿ for n = −7 … 8 (written `sN` below; `s0` is the base). Plain px, so nothing compounds.
Code: `design/titleTop.scss` (the ds.t10 block), `Ratings.tsx`, `TitlePage.tsx`.

- Head: padding s1 / s2, font s0 (every em inside the head now reads 18px). Poster s6 wide until ds.t12, now 1 : φ² of the head (above) (2:3; an episode's 16:9 still keeps 27.6%),
  s-1 corners, shadow 0 s-1 s1 black 61.8%; column s1 from the poster.
- Title s2, weight 700, line height 1. Directed by s-2 below it, s0 at pitch φ, label and names in full ink, names underlined
  in currentColor, thickness s-6, offset s-5.
- Metadata s0 at pitch φ in 76.4% ink: year • runtime • R • Ends at • Watched, the rating a plain word (no box), bullets 61.8%
  ink with s-1 either side, lines s-2 apart. The watched check s0, s-3 before its words, same ink.
- Ratings on their own line s0 below the metadata ([ratings.md](ratings.md)), then the action pill s0 below them.
- Action pill padding s-2 on every side, so Play's round end nests in the pill's (the user, 2026-11-07: "Bad padding" on
  the proposal's s-2 / s-1). The end after the last round action is s-2 + (Play's 3.333em − s2) / 2 (13.31 px at 18 px), so that action's hover
  circle is as far from the pill's end as from its top and bottom (the user, 2026-11-07: "Padding"); a pill with no Play (`.short`)
  keeps s-2. Play s0 words, min width s4, side padding s0, glyph s0 with s-2 before its word, s-2 before the
  first icon; Play keeps 3.333em / 3em / 85.4% white. Icon buttons s2 round (40 px minimum), glyphs s1.
- Tracks s0 below the pill ([track-dropdown.md](track-dropdown.md)). Reading s1 below them, at most s8 wide: tagline s0/600 in full
  ink, s-2 to the overview, s0 at pitch φ in 76.4% ink; facts s0 below, s0 at pitch φ in full ink, s-2 apart, labels 61.8% with
  s-1 after them; tags still clamp at 3 lines.


**Status: approved 2026-11-06, D288–D295, built, not accepted.** Computer first look only; phone/TV specifics and full acceptance follow the user's first look. These values supersede the older presentation notes below.

## External links (D276/D277)

**Status: approved 2026-11-06, D276/D277, built, not accepted.** The bottom `.links` line shows only sources
without a displayed popup row: TVDB, other `ExternalUrls`, or an unticked/unavailable rating source. Shared
RT and Metacritic site links give way to either corresponding row. With no ratings (off, unsupported,
failed or empty), keep every link. Keep a one-line reservation while the ratings decision is pending,
then draw the remainder or collapse once; ratings off draws at once. File-less pages build IMDb, TMDB
and Trakt links from the entry's ids, including series ids for child pages, by [ratings.md](ratings.md).
Hide the line entirely when `layoutManager.tv || !appHost.supports(AppFeature.ExternalLinks)`; TV never
gets links from ratings either. No server metadata is changed by opening a link.

## Title head (D288–D295)

Base 1em (computer 14.88 px). The head remains stacked, never split. Top/bottom padding 1.618em (φ¹), poster 27.6%,
0.618em corners (φ⁻¹), poster/column gap 1.618em (φ¹). Title 2.618em/600 at pitch 1.236; Directed by 1em (φ⁰), its
label 85.4%, 0.382em below the title and 0.382em before meta items, spaced 1em. Meta to pill 1.618em.

Status and reading each stop at 46.98em (φ⁸); file track pickers retain the full column. Pill to status 1em; status (or pill
when absent) to reading 1.618em. Tagline 1em/600 at pitch 1.618; 0.382em to overview, 1em at pitch 1.618. Facts 1em
below, 0.854em at pitch 1.618, 0.382em apart, labels 61.8%, names 600. Tags clamp at 3 lines. Links 0.854em, 0.618em
below facts; keep only sources without ratings (D276), none on TV.

For a title with no file and no active download, Download is the blue `.play.mainb` with the cloud glyph, first in the pill,
and the status slot is empty. A user without download permission sees the slim Not Downloaded line; Unaired shows its date
line and no Download. Active states retain the compact paper card ([download block](download-block.md)).
With a file to play, the cloud (it gets another quality) sits at the pill's end, after the heart and before More (the user,
2026-11-07: "it goes to the end"): Play, trailer, Played, Favourite, Download, More.

A played title with a valid `UserData.LastPlayedDate` ends its metadata with a blue 1.236em check, 0.236em before
`Watched <medium locale date>` at 85.4%. The user's build brief includes ` · N times` from `PlayCount >= 2` on this line
and the computer tip. No date adds no metadata; the button still says Watched. Unplayed keeps Mark Played.

Focus: Download (or first pill icon), right through the pill; ratings above; View Queue then the state action below,
then facts' linked names and Cast & Crew. Status line, ring, marks, pack and bar are not TV stops. Series/Season Played
confirmation (D281) is retained. Code: `design/TitlePage.tsx`, `Head.tsx`, `titleTop.scss`, `components/DownloadBlock.tsx`.


**Status — D281, approved by the user, 2026-11-06; implemented, live acceptance pending:** the Series/Season header's
Played button and title-page poster pill ask through the [shared confirm](shared-chrome.md) before awaiting an explicit
mutation for the captured item and direction. The same guard covers an episode row's Played action (immediate for an Episode).
Native custom controls keep their state update and refresh event; cancellation makes no change. Home hero Series/Season
Played uses the same guard (review fix, 2026-11-06; built, live acceptance pending).

**Review fixes (2026-11-04), built, not accepted:** painted episode rows and title cards forward cancellable remote `command` events with their detail to the original hidden card host, retaining the painted opener for menus. Consumption by upstream is reflected back to the original event so Play/Menu do not fall through to global playback actions. Click/context-menu behavior and approved markup stay unchanged.

**dsF sweep (2026-11-04), built, not accepted:** `by` reads `Directed by` / `Created by`; details are `.tags` lines (`Label: <b>value</b>`), links bold, More from Season below the cast; season and series show the mockup's counts; the phone's row drops Played and the state takes the heart's place; the bar lights the title's library. `renderOverview` selects `p.overview`, because a painted `div.overview` inside the view crashed the controller.

**dsD (2026-11-04): built, not accepted.** The user's native-markup instruction supersedes the earlier rd3 restyling.
Approved source: workspace design-system `head`, `actbar`, `sect`, `cell`, season/episode rows and title pages.
[Complete CSS delta, behavior, retained upstream infrastructure and runner inventory](../dsD.md).

`design/TitlePage.tsx`, `Head.tsx`, `TitleRow.tsx`, `TrackField.tsx`, `DlBlock.tsx`, `Pending.tsx`, `Ratings.tsx` and
`BrowsePage.tsx` own the visible movie, series, season, episode, person and TMDB browse markup under `.jfds`.
They output source elements/classes with the copied source stylesheets nested at import. They do not restyle the legacy template.
The original template remains hidden as the controller's data/select/command host. Upstream and mod data/actions remain owners.
Dashboard, mod settings, wizard and other native detail types retain their existing presentation.

The source head has the poster and one column (27.6% / remainder, 1em gap). Phone: centered poster at 61.8%, title and metadata,
then the action pill and 5% content gutters. The source art ground, static image/filter/fade, title/reading text (Inter since ds.t13), Inter dense
controls, white Play, glass pickers and solid TV/capability fallback values are unchanged. Root observes real layout/theme markers
without a reload. A shared upstream heading rule is neutralized so it cannot truncate titles or replace the source phone size.

Real images stay lazy. Missing/failed images retain 2:3 poster or 16:9 still boxes and the source fallback glyph. Corners follow the
source .618em. Native cells hold three caption lines even when empty. Row/still focus and hover rings stay outside the art box;
no card paint containment is introduced. Lists and histories scroll to their final entry.

Actions dispatch the existing controller handlers. Play reads the same original source/audio/subtitle selects and resume mode;
card Play forwards the original shortcut command. Played awaits its captured mutation; Favourite still clicks its existing custom control. More carries the
real painted opener and retains mod registrations, deletion warnings/return and permissions. Download uses the same picker.
The existing playback black screen and spinner clean up on every success/error/cancel/rejection/navigation path.

Original titles, taglines, metadata/tag/external links, series air time and secondary facts remain. Native extra card sections keep
their original loaders and commands; missing seasons/episodes keep their ordering and import replacement. Person birth/death/place
facts and their links are read from the existing controller. Chapter playback keeps its position and sort context. A TMDB person
with no native destination remains an inert, reachable person cell. No fixture-only recommendations or ratings are invented.

Versions, tracks, download/pending states, retention badges/disclosures, per-file history, Trakt, Add/Undo and ratings preferences
follow their guides' dsD sections. Earlier `.jfmod-titlePage`/`titlePages.scss` visual measurements are superseded by the source CSS.

Verification uses the offline dsD/dsC browser runners with real components, original controller functions, source styles and blocked
network. Compiler/linter results are recorded with the slice. Server-backed and physical webOS acceptance remain unrun under the
user's environment restriction; this page documents a built slice, not accepted or deployed behavior.

Every row on a title or browse page (`TitleRow.tsx`) sits on upstream's scroller, with the same arrows and focus walking as Home's rows (D252).

**Row arrows (ds.t5, 2026-11-05, the user was told; built, not accepted):** the rows' arrows are the library toolbar's small glass pill and chevrons (`.actbar.static.glassy`, padding 0.236em, buttons 2.618em, 46 px tall at the computer's 14.88 px), not upstream's large buttons. They sit on the row title's line at the row's right edge, centred on the title's text (`top: 2.165em`) and entirely above the posters: 8 px clear at 1440 and 1280, dark and light. A computer only (`dev-computer` with a fine pointer) and only while the row can scroll: tablet, touch and TV have none and scroll by swipe or focus. At either end the arrow that cannot move is dimmed (`.dbtn.off`, 45 %). Home, title, browse, Search and Favorites rows draw the same pill (`emby-scrollbuttons/ScrollButtons.tsx`, `_runtime.scss`). The scroller re-measures when a row's cells change, because Home's skeletons give way to data without the frame changing size.

**Home hero height (ds.t4, 2026-11-05, built, not accepted):** on a computer the height follows the window's width like the mockup's frames: up to 1280 px wide 720 × 0.764 (550), up to 1919 px 900 × 0.618 (556), up to 2559 px 1080 × 0.618 (667), from 2560 px 1440 × 0.618 (890). Phone, tablet and TV use the window's height. Episode stills keep the mockup's `overflow: hidden`, so the image follows the ring's corners.
