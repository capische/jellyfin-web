# Detail page Video row: video facts only, size at the right end, Audio and Subtitles as matching dropdowns with the picker's marks — APPROVED 2026-10-17 (user: "Logos, A for size, tell parent to implement"; artifact v5)

Session: Row Icon State Designs (local_0162f905…). Artifact: https://claude.ai/artifact/3rvv21tbY1e36tZB9MZx2K (v1); file `video-row-file-size.html`; screenshots `video-row-file-size-{compare,phone,tv}.png` (compare = A closed one file, A open two files, B closed).

User: the Video trigger reads "1080p HEVC 10-BIT | AAC 5.1 783 MB"; audio facts belong in the Audio row; where does the size go?

## Recommendation — A: the size at the right end of the Video value, before the chevron

- **Video row, closed:** resolution word (weight 600) · video marks (codec, bit depth, HDR) … **size in the secondary colour at the right end**, just before the chevron. No audio.
- **Audio row:** upstream's text or select, unchanged ("English - HE-AAC - 5.1 - Default"); the AAC 5.1 chip is not repeated anywhere closed.
- **Open Video list:** each file is one row: resolution · video marks │ audio marks (muted, smaller — they tell two files apart) · extras (episode range, "removes 3 Nov") … size right-aligned at the row's end, then the row's icons (History, Keep, Remove). The selected row and the closed trigger read the same left to right, with the size in the same column.
- **Phone:** the row's audio and size drop to a second line; the trigger keeps the size at its right end and truncates the marks first, never the size.
- **TV:** same at 125 %; the trigger and each row stay focus stops.

Why: the size is a fact about the file and the Video value *is* the file (Audio and Subtitles are streams inside it); the right end gives the number its own column so closed and open line up; no extra line or element; it is the one number people glance at before Play, so it should be visible closed, including on a single-file title.

## Revision (2026-10-17, artifact v3): Audio and Subtitles are dropdowns drawn like the Video one

User: "I wanted Audio dropdown to look similar to Video with dts icons and so on." So:
- **Audio row** = the same custom dropdown as Video: the field-like trigger with chevron, the paper popover, the blue left bar on the current entry. Closed it shows the chosen track as **language (600) · audio marks · flags**: marks are the codec and layout in the mark style (DTS-HD MA, Atmos, TrueHD, DD+, AC3, AAC; 7.1 / 5.1 / 2.0), flags Default / Forced / Commentary as muted "· Default" text. Open: one row per track, drawn the same way. **One audio track:** the same field without a chevron, not clickable and not a focus stop — the block keeps its shape and the track's facts stay readable; plain text would break the column.
- **Subtitles row** = the same dropdown: "Off" first, then each subtitle as language (600) · format mark (SRT, PGS, ASS) · Default / Forced muted. With that, the three rows share one trigger, one list and one mark style and read as one block.
- The size recommendation stands (A, right end of the Video value): the Audio row now carries marks of its own, so the number has even less business there.
- **Marks are the release picker's, verbatim (v4, user: "are you using the same logos/icons as in torrent search?"):** `MediaMarks` from `ReleaseRowParts.tsx` with this fork's own SVGs in `assets/media-marks` — DD / DD+ icon-only filled chips, Vision / Atmos / TrueHD a half-disc + the word, DTS family the wave + the word, every other audio format a filled word chip (AAC), the channel count (and DTS-HD's MA tier) an outlined tag joined to the last audio chip, video marks as plain uppercase text (HEVC at 70 %, 10-BIT, HDR10) and a hairline divider between video and audio marks. The build reuses `MediaMarks` as is, fed from the media streams instead of the parsed release name.

Build: one shared `TrackDropdown` (trigger + popover + rows) used three times, fed by upstream's media streams (`MediaStream.Codec`, `Channels`/`ChannelLayout`, `Language`, `IsDefault`, `IsForced`, `Title` for commentary; subtitle `Codec` for SRT/PGS/ASS); selecting writes the same player defaults upstream's selects write (`setAudioStreamIndex` / `setSubtitleStreamIndex` on the detail controller). Upstream's native selects stay in the DOM hidden for parity. ~120 TSX + ~40 SCSS on top of the Video change.

## Alternative — B: a muted line under the Video row
Shorter trigger, but a fourth line in a three-row block, and the size then sits nowhere near the file's row in the open list, so closed and open stop matching. Only if the Video value ever gets so long the size would be cut.

## Not proposed
- A chip beside the audio chip: there is no audio chip in the Video row any more, and a size is not a stream property.
- List only: hides the number behind a click and never shows it for a single file.

## Build cost
`FileSummary` splits into video marks + size with the size pushed right (`margin-left: auto`) inside `.jfmod-videoTriggerText`'s flex; the row body gets the audio marks after a thin separator and the size as the last flex child before the icons; `MediaMarks` is called with the video subset for the trigger and the audio subset for the row. ~30 lines TSX, ~15 SCSS; no API change (`describeVersion` already separates video, audio and size).

## Decision for the user
A (recommended) or B.
