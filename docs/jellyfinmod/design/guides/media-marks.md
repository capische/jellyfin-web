# Media marks

**Golden list marks (ds.t12): approved by the user 2026-11-07, built, not accepted.** In the computer title head's open lists the
marks match the closed field: video marks s-1, s-3 apart, no tracking; the Atmos run s-1 with s-7 tracking (glyph 0.82em, s-3
after it, channels s-2 after the format); the subtitle chip s-1 type, s0 high, s-3 side padding, s-4 corners, in the field and the
list; the commentary role an s0 glyph, its own 16:14, no frame. Other role words keep their outline. See [track-dropdown.md](track-dropdown.md).

**Golden closed Video value (ds.t10): approved by the user 2026-11-07, built, not accepted.** On a computer title head the closed
Video marks are s-1 (base × φ⁻¹, 11.1 px at the 18px base), s-3 apart, without tracking; the Atmos run s-1. See
[track-dropdown.md](track-dropdown.md). Everywhere else the sizes below stay.


**dsD (2026-11-04), built, not accepted:** the title pickers, pending entry and download block now draw the source
SVG/chip markup with `design/MediaMarks.tsx` (`mk/codec/hdr/tag/join/ch/chs`). Existing stream/release parsers supply values;
Video and pending receive only video facts, Audio receives its own stream facts. Release-picker/admin renderers remain in place.
No mark is inferred from sample mockup content. [Port and CSS inventory](../dsD.md).

**Status:** brand-style marks approved 2026-10-10 (release picker row design), format chips 2026-10-11, reused verbatim
on the detail page's dropdowns 2026-10-17 ("are you using the same logos/icons as in torrent search?" — yes, by rule).
Built on `next-release`. Records: [release picker note](../release-picker-design.md), [Video row note](../video-row-file-size.md),
[UX.md §9 and §11.2](../../UX.md). Code: `components/ReleaseRowParts.tsx` (`MediaMarks`, `chipMark`),
`components/releasePicker.scss` (`.jfmod-releaseMark*`, `.jfmod-releaseTag*`, `.jfmod-releaseJoin`,
`.jfmod-releaseDivider`), SVGs in `assets/media-marks/` (`dolby-dd.svg`, `dolby-ddplus.svg`, `dolby-half.svg`,
`dts-family.svg`). **Role marks** for a track's role (the track rows redesign, user's picks 2026-10-29, decisions D61–D63,
D79, D80 in workspace `reviews/overnight-2026-10-28/DECISIONS.md`): **built 2026-10-29, gate 1, awaiting the user's approval**;
code `constants/tracks.ts` (`trackRole`), `components/TrackDropdown.tsx` (`RoleMark`), `components/fileChooser.scss`
(`.jfmod-trackRoles`, `.jfmod-trackRole`, `--glyph`). **Marks dropped whole on the phone** (user, 2026-11-01: "Phone Video
Dropdown - accepted, go implement it."; D197, mockup workspace `reviews/video-dropdown-phone/mockup/`): built 2026-11-01, gate 1. The same in the
computer's and TV's two-line Video rows (the user, 2026-11-01; D198): built 2026-11-01, gate 1.

**Lighter audio marks in the Audio field and list** (option B, one glyph; the user, 2026-11-07: "Lighter audio marks - B one
glyph - implement it"; mockup workspace `reviews/dolby-marks/`): **built 2026-11-07, gate 1, awaiting the user's approval**. See
*Audio run (track field and list)* below. Code: `design/MediaMarks.tsx` (`AudioTrackMarks`), `design/_ds.scss` (`.atm`).

## What it is

The codec, HDR and audio facts of a file or a release as small uppercase marks on one line, brand-style rather than boxed
text: Dolby and DTS as their marks with the word beside, every other format as a word chip, the channel count as an
outlined tag joined to the last audio chip. One component (`MediaMarks`) draws them wherever media facts appear, fed from
the plugin's parsed release name in the picker and from Jellyfin's media streams on the detail page — never from a file
name there.

## Anatomy, in order

`codec · HDR marks │ Dolby group (Vision, Atmos, the audio format) · tier · channels`

| Mark | Kind | Example |
| --- | --- | --- |
| codec | plain text at 70 % (`--codec`) | HEVC, AVC, XVID |
| HDR | plain text at 90 % (`--hdr`) | HDR10, HDR10+, HDR |
| Dolby Vision, Atmos, TrueHD | filled chip: half-disc icon + word (`--half`) | ◖ VISION, ◖ ATMOS, ◖ TRUEHD |
| DD, DD+ | filled chip, **icon only** (`--dd`, `--ddplus`) | ▮▮, ▮▮+ |
| DTS, DTS-HD MA, DTS:X | filled chip: wave icon + word (`--wave`); DTS-HD's MA is an outlined **tier** piece joined after it | ≋ DTS-HD │ MA │ 7.1 |
| other audio formats | filled word chip | AAC, HE-AAC, FLAC, MP3 |
| channels | outlined tag (`--channels`), joined to the last audio chip (`.jfmod-releaseJoin`) | 7.1, 5.1, 2.0 |
| divider | a hairline between the video marks and the audio ones (`.jfmod-releaseDivider`) | │ |
| subtitle format (dropdowns only) | word chip | SRT, PGS, ASS, VOBSUB |

The first matching audio format wins; Atmos is a mark of its own beside it. A format without a mark is a word chip.

## Sizes and colour (against the host line's font size)

- `.jfmod-releaseMark`: `inline-flex`, height 1.2em, `margin-right .6em`, **60 %**, weight 700, uppercase,
  `letter-spacing .05em`, opacity .82, `white-space: nowrap`.
- `.jfmod-releaseTag` (filled chip): **52 %**, height 1.3em, `padding .1em .4em 0`, radius .3em, `background: currentColor`;
  its icon and word are knocked out in the host's paper colour `--jfmod-paper` (the picker sets the page ground `#101010`,
  the dropdowns and the download block the theme paper `#202020`). `role="img"` with the full name as `aria-label`.
- Icons (`.jfmod-releaseTag-icon`, `fill: currentColor`, `aria-hidden`): half-disc 0.54 × 0.75em; wave 1.125em wide;
  DD 1.3em and DD+ 2.04em wide at 0.865em tall, no word.
- `--channels` and `--tier`: height 1.3em, `border .1em solid currentColor`, radius .3em, `padding .1em .4em 0`; inside
  `.jfmod-releaseJoin` the chip squares its right side, the tag its left, one hairline between two outlined pieces, only
  the last piece rounds its right end.
- Divider: 0 wide, 1.1em tall, `1px solid currentColor`, `margin 0 .7em 0 .1em`.
- In the detail page's dropdowns the whole line is scaled **130 %** (`.jfmod-fileMarks`), so the chips match the row's text;
  the picker and the download block use them at 100 %.
- Colour is always `currentColor`: the marks take the line's text colour (secondary where the line is secondary) and
  never a colour of their own.

## Rules

- Marks come from `MediaMarks`; nothing redraws a Dolby or DTS mark, a chip or a channel tag by hand.
- The order above is fixed; video marks before the divider, audio after it.
- Marks wrap as a group only where the design says so (the picker's line 2); elsewhere they are `nowrap` and are cut before a
  number beside them (a file size) is.
- **In the Video value a mark is never sliced, on any layout** (D242, the user's pick 2026-11-03), and on the phone not in the Video
  list's rows or the pending entry either (D197): a mark that does not fit is dropped whole and comes back when there is room; so in
  every two-line Video row on the computer and the TV (D198), and in the pending entry in a list under 24em (D236). The marks shrink, wrap, and their box is one mark tall (`height .72em`, `overflow hidden`), so the
  marks that do not fit go to a hidden second line (the Audio cell's trick, D78); an empty first item (`::before`, a mark's
  height) sends even the first mark there when it alone does not fit. The size and the chevron never shrink.
- The assets are trademarks drawn monochrome; the text-only fallback is the same chip without the icon.

## Audio run (track field and list)

The Audio field and its list draw a track's audio with `AudioTrackMarks`, not `MediaMarks`: smaller, lighter, one glyph at most
(option B, 2026-11-07). Video marks, the release picker, the download block and the pending entry keep `MediaMarks` as above.

- **Words:** the stream's short format as `streamAudio` words it, uppercase: `DD+ ATMOS`, `DD`, `TRUEHD ATMOS`, `DTS-HD MA`,
  `DTS:X`, `AAC`, `OPUS`; Atmos is part of the format, never a mark of its own. Then the channels (`5.1`, `7.1`, `2.0`).
- **Glyph:** the Dolby half-disc before a Dolby format (DD, DD+, TrueHD), the DTS wave before a DTS one, none before any other.
  No chip, no box, no channel tag.
- **Sizes: the Video marks' own** (the user, 2026-11-07: "much better but can you make them a bit bigger the size of video
  marks"): words and channels **.78em** of the row (11.6 px on the computer, the marks' 130 % × `.mk`'s 60 %), glyph → word .25em, format → channels .3em, .6em after the run, language → run the `.r`'s .8em, letter-spacing
  .05em: all `.mk`'s values, a **named exception** to the golden ratio, so audio and video marks read at one size in the strip
  (the first look's .618em, φ⁻¹, 9.2 px, was too small). Lighter than `.mk`: weight 600, not 700.
- **Glyph: half a φ step under `.mk`'s** (the user, 2026-11-07: "can D be a bit smaller?", then of .65em "A bit bigger it's too
  small", 0.82em approved the same day): **.82em** of the words (`.mk`'s 1.05em ÷ √φ; 9.5 px on the computer, about the words'
  capital height; 12.2 px was too big, 7.5 px too small), centred on the words (`align-items: center`, the words at `line-height: 1`).
- **Ink:** `currentColor`; glyph and words at **.854** (1 − φ⁻⁴), channels at **.618** (φ⁻¹) (`.mk` is .82, codec .7). The chosen row's run keeps the
  text colour, not the primary (`.vrow.sel .atm`), as the marks did.
- `role="img"`, `aria-label` the spoken name and channels (`Dolby Digital Plus Atmos 5.1`, `DTS-HD Master Audio 5.1`).

## Role marks (Audio and Subtitles rows)

- **What:** one mark per track row saying what the track is for, after its format marks: audio `AD` (audio description), the
  commentary bubble, or the translation type as the release writes it (`DUB`, `MVO`, `DVO`, `AVO`, `VO`); subtitles `SIGNS`
  (the title says signs / songs / S&S / надписи), `FORCED` (the flag, or a word that starts as forced / forcé / forzado /
  форс… / erzwungen and is not right after not, non, no, pas, sin, keine, kein, nicht, не, без; "Castellano Forzados" is
  forced, "Español sin forzados", "non-forced" and "Нефорсированные" are not; D165, D167), `SDH` (hearing impaired, or the
  whole words SDH, CC, HI in any case: "English sdh", but not "hi-fi"; D165, D167).
- **Which one** (D63): the first that applies — audio AD › Commentary › translation; subtitles SIGNS › FORCED › SDH. Stream flags
  first (`IsForced`, `IsHearingImpaired`), then title words in en, ru, uk, de, fr, es, it, pt, ja (`trackRole`); a bare "VO" is
  never read.
- **Look:** the role family is outlined, the format family filled: a word mark is the channel tag standalone (`.jfmod-trackRole`:
  height 1.3em, `padding .1em .4em 0`, `border .1em solid currentColor`, radius .3em, 52 %, 700, letter-spacing .05em, 82 %)
  inside `.jfmod-trackRoles` (130 %, `.15em` after the marks); the commentary bubble (`--glyph`) is a filled 16×14 glyph, 1.5em
  tall, no border. `currentColor` throughout; the role's name is its tooltip.
