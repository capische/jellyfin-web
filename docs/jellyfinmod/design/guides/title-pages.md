# Title pages and art ground

**Series and movie pages redesigned on a computer and the TV (ds.t20): approved by the user 2026-11-15/16 (workspace
`reviews/fable-design-review/REVIEW.md`, the approved section, rounds 6 to 6c), 2026-11-16 (animate the selection) and 2026-11-17
(round 7d, mockup `series7-bg.html?view=after&scrim=after2&fit=screen&cred=line`, replacing the poster head and the TV glide);
built, not accepted, first look on beta (computer and TV, dark).** B on a computer **grows with the screen** (round 7g, the user
2026-11-18, `scale=grow`): drawn for 1440 × 900 at 18 px, B = clamp(18 px, min(2vh, 1.25vw), 29.12 px) × `--jfmod-scale`, so
18 at 1440 × 900 and smaller, 21.6 at 1920 × 1080, 28.8 at 2560 × 1440; the page declares its tokens again under that B, and
the season pill's 40 px floor and the Dolby lockup's 16 px scale with it (40/18 B, 16/18 B). The bar keeps its own B and the page
keeps the bar's gutter (Bφ² of the bar's B), so their left edges stay aligned. 24.2 px on the TV (16.13 px on a
1280 × 720 screen, in proportion to its height; the bar keeps its own B), unchanged; every value Bφⁿ. The phone keeps its page
(`.jfmod-titleE` is set on a computer and the TV). Code: `design/Head.tsx` (`Hero`), `TitlePage.tsx` (`Screen1`), `TitleAbout.tsx`
(`useFitLines`), `SeriesEpisodes.tsx` (`EpisodeRow`, `useTvScreen`, `useTvKeys`), `titleTop.scss` (the ds.t20 and round 7d blocks).

- **Hero (round 7d), no poster in the head.** The ground runs up under the bar. The Backdrop covers a box from 23.6 % (φ⁻³) of the
  width to the right edge, top-anchored, **16:9 at its own width** (42.975 % of the hero's width high, `.jfmod-heroBox`), so the
  Backdrop is never zoomed past its cover at the box's width (the user, 2026-11-18: "Why matrix is so ugly on desktop?"): a hero
  shorter than the box crops its foot, a taller one (a narrow or tall window) shows the ground under the picture, whose foot fades
  out over Bφ⁴. Its left edge melts over 14.6 % (φ⁻⁴) of its width into the blurred copy, dimmed to brightness 0.236 (φ⁻³; the
  art ground's 0.4 read as a grey smear) so it reads as ground. One mask per element (the box's left melt, the picture's foot). Scrim: the foot (the ground at the box's foot, 61.8 %
  at Bφ², 23.6 % at Bφ³, gone at Bφ⁴) and the bar (76.4 % at the top, 61.8 % at its foot, gone Bφ³ under it). **Plates** behind
  the text, each as wide as its text plus a Bφ⁴ fade to the right: 38.2 % behind title, facts, ratings, actions and tracks
  (fading over Bφ³ above and below); 0 → 14.6 % → 38.2 % → 61.8 % → 76.4 % behind the description and credits, down to the stills.
  The title and reading glow with the ground (`0 0 Bφ⁻² 76.4 %, 0 0 B 61.8 %`; facts and tracks one tighter layer at 85.4 %).
  **No Backdrop:** the poster is the blurred ground and stands whole on the right, as tall as the column (an `<img>`, width auto),
  no plates. webOS 6: one mask per plate (the other fade in its background), no `aspect-ratio`, `inset`, flex `gap` or `min()`.
  Named exceptions: the 23.6 % / 14.6 % box (window proportions), 2:3 poster, 16:9 stills.
- **First screen (fit=screen):** on a series the hero and the episode row fill the screen (`jfmod-screen1`, the screen's height
  less the bar's): **Align Top** (round 7g, the user 2026-11-18, as a movie): the head's text starts B under the bar and the
  room left lies between the credits and the season pill, never less than Bφ¹ in any mode (fit, flow, TV; the user
  2026-11-19: "A gap should be between Starring and Season button"; the fit gives up description lines for it) (the lower plate fades out over Bφ⁴ at its foot, its top's steps in reverse, no visible line); the row's foot (the selected card's ring) Bφ² above the screen's foot (the
  TV's safe foot), Cast's title at the fold, and nothing below moves while a selection animates (the row's height is fixed). The
  description gives up whole lines, down to one, until the row fits, and takes them back when the hero has room under the head (`useFitLines`,
  computer, tablet and TV alike; it replaces the touch-only cut). A window too short even for one line scrolls (below ~776 px).
  **Window shape decides the fit (computer, the user 2026-11-18):** at 4:3 or wider the page fits the screen as above; a window
  narrower than 4:3 (portrait, near-square such as 1000 × 928, 5:4 such as 1280 × 1024; `@media (max-aspect-ratio: 3999/3000)`,
  `useFlowWindow`) **flows**: the hero is as tall as its content, the row, Cast and the rest follow straight after, the fit loop
  does not run and the description keeps its normal cap; movies flow the same way, and the picture keeps its 16:9 box. The TV
  always fits.
  **A movie:** its head sits at the hero's top and the hero ends Bφ² under the credits, at least φ⁻¹ (61.8 %) of the screen
  high (the user, 2026-11-18); Cast follows it on the first screen.
- **Column:** title; the **facts line** Bφ⁻² under it, `year • Genres • seasons or runtime • age rating • Ended|Continuing`
  (series only; never "TV Series"), B at pitch φ, 76.4% ink, bullets with Bφ⁻¹ either side; Genres three at most, and if the
  line would wrap *Science Fiction* becomes *Sci-Fi*, then genres drop from the end, keeping one (`FactsLine`). Then the ratings
  pill, the action pill, the track controls (each B apart; Bφ⁻¹ on the TV), the tagline and description Bφ¹ under the tracks (cut
  at 3 lines with **more**; below 1440 px wide, the build's choice, no tagline and 2 lines; the TV 2 lines with its tagline), and
  the **credits on one line** B under it: *Created by* (a movie: *Directed by*) and *Starring* (the first three actors), Bφ¹ apart,
  wrapping Bφ⁻² apart when they must; label 61.8% with Bφ⁻¹ after it, names 400 at 76.4%, linked (plain on the TV).
- **The remote, and the keyboard on a computer (round 7d, the user 2026-11-17):** the path is the Play row (Play and the buttons
  beside it, Left and Right between them) → the track controls (each with a choice is a stop, OK opening its list; one file or one audio track
  is a plain value and not a stop, the user 2026-11-23, replacing "Video is always a stop", [track-dropdown.md](track-dropdown.md); Left and Right between them) → the season pill (a stop; OK opens the season list) → the row → Cast, Up retracing it to the
  control last focused in each (`useDpad`; a Bφ⁻³ primary ring on the Play row's buttons, the track controls, the season pill and
  the focused card; on a computer the arrows move the focus there as the TV's do; the mouse is
  untouched). Focus entering the row lands on the selected episode; **selection follows focus** and rests in the row's second
  slot (the first when only one card fits): Left and Right slide the row one card under it while the arriving card grows Bφ⁵ → Bφ⁶ and the leaving one shrinks, a
  card leaving the row fades out and one entering fades in, --d2 on --ease (`useRowSlide`); at the row's ends the selection moves
  along instead. **OK plays the episode at once** (resuming one started), or on an episode with no file does what the head's
  button does (Download). The first screen opts out of the TV's scroll manager (`data-scroll-mode-*`), and focus coming back into
  it from Cast glides the page to the top (0.618 s, `--d3`, on `--ease`; instant with reduced motion; on a computer only when the
  keyboard moved it). The page opens with the selected episode in the second slot.
- **Selected is not focused (the user, 2026-11-18, cx2 of `series7-bg.html`):** the selected card keeps its Bφ⁶ size and band, and
  the band takes a **wash of the primary**, 38.2 % (φ⁻²) at its leading edge, gone at 61.8 % (φ⁻¹) of its width, over its glass
  (a plain linear-gradient, webOS 6), the ink unchanged; no ring is drawn round it. The blue Bφ⁻³ ring is the remote's or the
  keyboard's focus only and is added to the wash, so on the TV, where focus in the row selects, the focused card is the big card
  with the wash and the ring. On a computer the mouse shows the wash and no ring, and the pointer over a small card draws the Bφ⁻³ ring in the solid primary, the guidelines' field ring and the keyboard's, on every card on the page: the episodes (the
  selected one over its wash) and every row under them, Cast, Guest Stars, Next Up, More Like This and the rest; every other page
  keeps upstream's 0.135em hover (the user, 2026-11-18/19: "this is the thickness!", "Cast and Guest don't have the same hover
  including selected Episode", then every row; the
  user, 2026-11-18: "blue but somehow faded out? or thinner?"); the keyboard's ring stays Bφ⁻³ solid. The watch bar is clipped to the still's
  corners on every card. **No two rings touch:** at least Bφ⁻² of clear ground between rings; the season pill draws its ring
  inside its edge and sits Bφ⁻² above the stills, and the selected card has no ring at rest, so Bφ⁻² stays clear.
- **TV:** the description stops at Bφ⁸; the track controls are the computer's quiet ones at the TV's B, each a remote stop with
  the Bφ⁻³ ring round it, opening the TV's own list (the user, 2026-11-18, [track-dropdown.md](track-dropdown.md)); in the light
  theme the pills take the computer's white glass, webOS 6 and earlier keeping the dark ([card-glass.md](card-glass.md));
  *more* and the credit names are no D-pad stops; the season pill is B + 2 Bφ⁻¹ high with no 40 px floor. The selected card takes the wash above,
  the focused one the blue ring too; its band is the TV glass (black 66 %, white, no blur). iPadOS Safari's desktop-class user agent gets the computer
  page; an iPad that reports a mobile user agent gets the phone page, unchanged. **Tablets (the user, 2026-11-19):** a touch
  tablet under 900 px wide (iPadOS Safari's desktop-class agent in portrait) draws the title page as the computer's (`Root
  tabletAsComputer`), so it fits in landscape and flows in portrait as a computer window of that shape; the rest of the app keeps
  its tablet page. A swipe across the episode row pages it as the arrows do (`touch-action: pan-y`), and a tap selects a card as a
  click does (a card with no file shows the cloud disc, which a tap or a click on it opens).
- **Play (option E):** [buttons-and-row-actions.md](buttons-and-row-actions.md); never *Resume* (the user, 2026-11-17), on the older
  episode, season and other title pages' Play too (2026-11-18; the controller's command still resumes). Nothing sits beside the action pill.
- **Polish (P1–P7 of the Astra review, approved by the user 2026-11-21), built, not accepted:** in the light theme the hero's
  glow loses its B-wide layer (title and reading Bφ⁻², facts and tracks Bφ⁻³ and Bφ⁻²); the TV's Play small line 85.4 % on the
  unfilled part ([buttons-and-row-actions.md](buttons-and-row-actions.md)); the computer's episode pager a capsule of the
  season pill's height (40/18 B), arrows 40/18 B (≥ 40 px), chevrons Bφ⁻¹; the TV track list's rows
  ([track-dropdown.md](track-dropdown.md)); the episode cards' bullet at 61.8 % and the star Bφ⁻¹ centred on the score; the
  rating chip's chevron Bφ⁻¹, Bφ⁻² after the marks ([ratings.md](ratings.md)); the mouse's hover ring 4.25 px (Bφ⁻³ of the 18 px
  reference B) at every window size, the keyboard's focus growing with the page. The season list opens on the current season.
- **Episode row (series):** full width under the head on the gutter. The season pill (40 px high, a named exception) and the
  arrows on one line, *Next episode 21 Nov* B after the pill when Jellyfin knows an unaired episode; Bφ⁻² to the stills. Small
  stills Bφ⁵ (199.6 × 112.3) with their two lines under them (Bφ⁻² above); the **selected** episode, the one on Play, Bφ⁶
  (323 × 181.7) with the wash (above) and its two lines in a bottom card-glass band ([card-glass.md](card-glass.md)).
  Bφ⁻¹ apart, top-aligned; the row a fixed height, the selected still's, so nothing under it moves while a selection
  animates (the user, 2026-11-17). **Whole cards only:** k = 1 + ⌊(W − Bφ⁶) ÷ (Bφ⁵ + Bφ⁻¹)⌋
  (B grows with a computer's screen, so the count follows the window and B), the rest empty; the row opens at min(selected, N − k), so the selected episode sits near the
  start with earlier ones behind it. A click on a card selects it (Play, Ends and the track controls follow at once) and the
  change is animated: the new card grows Bφ⁵ → Bφ⁶ while the old one shrinks and the cards after them slide, over the mod's
  `--d2` (0.382 s) and `--ease`, each caption fading in at its new place, band or under the still; instant with reduced motion,
  and the row does not scroll. Its **title is a link to the episode's page**. The arrows page k − 1 cards; the pill names the
  first card's season and jumps to a season. No wider gap before a season's first card (whole cards only).
- **About ⟨title⟩** at the foot after the rows: row title Bφ¹ / 400 with Bφ² above and B below; two columns 61.8% : 38.2%,
  Bφ² apart; labels 61.8% in a Bφ⁴ column (the file's Bφ³), B before values at 400 / 76.4%, rows Bφ⁻² apart, a wrapped track
  hangs B; words only. Left: Created or Directed by, the details (Writers, Studios, …), Genres, Age rating, Tags, all of them,
  then the external links. Right, the selected file (the head's Video control, or the selected episode's): *Episode*, *Versions*
  (several files: one line each, the selected one in the primary with the check, a click selects it) or *Version*, *File*,
  *Video* (two lines), *Audio* (six lines, then *N more*), *Subtitles* (a paragraph per format).

**Video, Audio and Subtitles as quiet controls (ds.t19): approved by the user 2026-11-08, built, not accepted, computer first look.**
On a computer the track strip under the pill is three quiet controls with one chooser ([track-dropdown.md](track-dropdown.md)),
s0 under the pill; a series page shows them for the selected episode, and Play sends the episode's choices.

**Person page on the golden head (ds.t15), the user's brief 2026-11-07, built, not accepted, gate 1 on beta (computer, dark).**
On a computer a person's page takes the title head and rows below as they are (`jfmod-titleTop`, `TitlePage.tsx`): the photo at
poster : column = 1 : φ², the name s2 / 700, Born and Birth place as metadata words with a bullet between them, the ♥ ⋯ pill (a
`.short` pill, s-2 padding), the biography at B in the reading measure (at most s8), the IMDb / TMDB links at B, and the
filmography rows as the title rows (s1 titles, s5 posters, s1 apart). Phone, tablet and TV keep the person's old head.

**Ratings and progress on title pages (ds.t16), approved by the user 2026-11-07, built, not accepted.** The ratings pill on a
first open hands TMDb over to the fetched sources ([ratings.md](ratings.md)); a file-less page's ratings now follow the entry's
later reads (every 3 s while the plugin fetches). On the series page an episode card whose file is on its way shows the corner
download mark and, under the pointer, the card's progress ring ([download-state-mark.md](download-state-mark.md)); a click still
only selects it.

**Series page, rows and Download's glyph (ds.t14): approved by the user 2026-11-07 (workspace `reviews/title-golden/series.html`),
built, not accepted, gate 1 on beta (computer, dark).** A series page has **no season row and no season page from it**: under the
head, a **season pill** (card glass, the season's name at B / 600, an s0 chevron s-2 after it, padding s-1 with s0 on the left, at
least 40 px high, full round) and the slider's arrow pill (s-3 padding, s2 buttons, s0 glyphs) share the row title's line, then
**one continuous slider of every episode** in order (Jellyfin's episodes joined to the plugin's list: its file state, air dates
and the episodes Jellyfin lacks; TMDB-only specials stay out). The pill names the season of the first card wholly in view at the
left edge, so it switches once a season's last card has passed and back when scrolling left; its list (menus.md) scrolls the
slider smoothly to that season's first card and leaves the selection. A season's first card has s2 more before it (s3 in all).
Cards are the poster card's 16:9 cell ([poster-card.md](poster-card.md)): s6 stills s1 apart, `N. Title` in 700 and
`24m • ★ 7.9` below, no description. The episode the page was opened on (`episodeId`: on Home, as Netflix does it, a Continue Watching episode with a file plays from its card, resuming one started, and its name opens the series page this way; any other episode on Home opens it from the card; the user, 2026-11-10), else the **first unwatched** aired episode, is selected (a 0.236em primary ring and a primary
title; hover keeps the 0.135em ring) and opens second from the left, or first when the two cards do not both fit in the part of
the strip the window shows (a phone; the user 2026-11-23, the computer's rule); a click selects. The pill's **main button follows the
selection**: **Play** (never Resume, no episode code; it resumes an episode in progress), **Download** (blue, first) for an
episode with no file, or a disabled **Airs 14 Nov** (clock, hairline, muted ink) for one not aired. The round cloud (Get Another
Quality) is in the pill only beside Play, before More. Episode Retention, History and the per-episode download lines are gone
from the series page; the season total under the pill (`0 of 1 episode · 0% · 1 h 58 min left`) is the one download line
(the user, 2026-11-07). On a computer, hovering a card of an aired episode with no file and nothing on its way shows the poster
card's glass disc with the cloud: it opens the same Get a Release dialog as Download with that episode preselected in its scope
switch (`episodePage`); a click elsewhere on the card still only selects it.
**Phone, tablet and TV (the user, 2026-11-10, built, not accepted, gate 1 on beta):** the same pill and strip at each layout's
own B, with no arrow pill (touch swipes the strip; the TV's D-pad walks it, Enter selects). Pill row s1 above; phone stills s5
s0 apart, tablet and TV s6 s1 apart; a season's first card has s1 more. On the TV the selection keeps the 0.135em ring and the
focused card takes the 0.236em one; the pill takes an s-3 primary ring on focus (ds.t20's first screen on the computer and
the TV instead: the wash and the blue ring, as above).
A card selected while partly off the strip slides to its left edge, whole (the user, 2026-11-10).
**Description and Tags on phone and tablet (the user, 2026-11-10, built, not accepted, gate 1 on beta):** a description longer than
3 lines is cut at 3 and Tags at 1, with an ellipsis and a lowercase **more** (white 700, the text's own size, s-2 after it) at
the end of the last line; opened, the full text ends in **less**. A text that fits gets neither; the TV shows it whole, a computer
cuts Tags and a series' description since ds.t20 (below) (`Clamp` in TitlePage.tsx, `.jfmod-clamp` in titleTop.scss).
**Quieter facts on Season and Episode pages (ds.t20, the user, 2026-11-11, `reviews/fable-design-review` P2, built, not accepted):** on a
computer the fact values are 400 in the description's 76.4% ink, the labels stay 61.8%, and Tags take one line with **more** (white
700 in the dark theme, the text colour in the light). The series and movie pages moved these facts to About (below).
**The selected episode's tracks on phone, tablet and TV (the user, 2026-11-10, built, not accepted, gate 1 on beta):** under the
pill, the selected episode's track controls as a movie's (track-dropdown.md): the quiet controls and chooser on phone and tablet
(the user, 2026-11-11), the strip on the TV; they follow the selection and Play sends the choices, as on a computer. On a phone the
controls are centred under the centred head, the phone's Bφ⁻¹ (10.75 px) apart (the user 2026-11-23, option 2,
[track-dropdown.md](track-dropdown.md)).
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
  ink, s-2 to the overview, s0 at pitch φ in 76.4% ink; facts s0 below, s0 at pitch φ, s-2 apart, labels 61.8% with
  s-1 after them; values 400 in 76.4% ink and Tags one line with "more" since ds.t20 (above; was 600 in full ink, 3 lines).


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
