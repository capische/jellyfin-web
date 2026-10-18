# Media marks

**Status:** brand-style marks approved 2026-10-10 (release picker row design), format chips 2026-10-11, reused verbatim
on the detail page's dropdowns 2026-10-17 ("are you using the same logos/icons as in torrent search?" — yes, by rule).
Built on `next-release`. Records: [release picker note](../release-picker-design.md), [Video row note](../video-row-file-size.md),
[UX.md §9 and §11.2](../../UX.md). Code: `components/ReleaseRowParts.tsx` (`MediaMarks`, `chipMark`),
`components/releasePicker.scss` (`.jfmod-releaseMark*`, `.jfmod-releaseTag*`, `.jfmod-releaseJoin`,
`.jfmod-releaseDivider`), SVGs in `assets/media-marks/` (`dolby-dd.svg`, `dolby-ddplus.svg`, `dolby-half.svg`,
`dts-family.svg`).

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
- Marks wrap as a group only where the design says so (the picker's line 2, the chooser's phone rows); elsewhere they are
  `nowrap` and are cut before a number beside them (a file size) is.
- The assets are trademarks drawn monochrome; the text-only fallback is the same chip without the icon.
