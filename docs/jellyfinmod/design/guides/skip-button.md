# Skip button

**Status — approved by the user, 2026-11-07 ("It should be the same" as Play); built, not accepted.** Computer first look;
phone and TV follow at gate 2.

Upstream's player button for media segments (Skip Intro, Skip Outro, Skip Recap and the rest: `.skip-button` in
`components/playback/skipsegment.ts`) is drawn as the title page's Play button ([title-pages.md](title-pages.md)). The player
sits outside `.jfds`, so the values are in rem: 0.9rem type at 600 in the mod font, 3rem high, 0.9rem side padding, fully
round, white 85.4 % with `#101010` ink, white on hover, a 1.26rem glyph after the label with a 0.27rem gap, minimum width
6.168rem, press 0.96 in 0.146 s (none with reduced motion), and the shared 0.15em primary keyboard ring 0.15em off it. The
player is always dark, so there is no light variant. Placement: its right edge lines up with the control pills (3.3 % in), and
it sits at 9.618rem from the bottom (upstream's 8rem + φ), clear of the remaining time. Upstream's show/hide fade and timing
are unchanged. Code: `shell/sharedChrome.scss`, the `html.jfmod-chrome.jfmod-chromePlayer` block.
