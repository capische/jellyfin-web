# Pending version (another copy on its way for a title that plays)

**Status:** option 3 of workspace `reviews/upgrade-status-options/` (the user's pick 2026-10-28), placed under the track strip
(D9), with the admin's X (D10) and the Replace wording (D11, user: "use profile and I don't think you need `the`") of
`reviews/overnight-2026-10-28/DECISIONS.md`: **built overnight 2026-10-28, awaiting the user's approval**. Video marks only
(the user, 2026-10-29; D105): built 2026-10-29, gate 1 (computer, dark). The flag in the captions' type at .62em (D148):
built 2026-10-30, gate 1; centred on the status's figures (D156), built 2026-10-30. On the phone the X at 40 px in the file
rows' X column and the marks dropped whole (user, 2026-11-01: "Phone Video Dropdown - accepted, go implement it."; D197, mockup
workspace `reviews/video-dropdown-phone/mockup/`): built 2026-11-01, gate 1. **Stacked lines in a narrow Video list** (the user's
pick 2026-11-03, D236; drawing workspace `reviews/design-system/questions/pending-narrow.html`): first look approved 2026-11-03 (D238). Code:
`components/PendingVersion.tsx`, `components/pendingVersion.scss` (`.jfmod-pending`, `--<kind>`, `.jfmod-pendingBody`,
`.jfmod-pendingLine`, `.jfmod-pendingMeta`), `constants/queue.ts` (`isNewVersion`, `isReplace`, `replacedWords`, `versionFlag`,
`asNewVersion`).

## What it is

The picker's added row moved to where the file will land: on a movie's or an episode's page that already plays, while a new
version of it is queued, downloading, stalled, importing or failed (an Add or a Replace from Get Another Quality, an `add` /
`replace` pack on an episode that held a file, an automatic upgrade). Nothing in it is new: the row ring, the media marks,
treatment B, a muted flag and the picker's red X. It is not the [download block](download-block.md), which is a missing
title's page content.

## Anatomy

- **Where:** under the [track strip](track-dropdown.md), left-aligned with it (`padding-left .2em`); while the Video list is
  open it is that list's row instead, after the files, its ring where the rows' text starts.
- **Ring:** the [download state mark](download-state-mark.md) at the row size (2.5em), `.45em` before the text; downloading
  draws the **+**, the other states their own glyph; an administrator's ring opens the client (not on the TV).
- **First line:** the quality in 600 (`4K Remux`, from the grab's parsed name; else the queue's label), the release's **video**
  media marks only (codec, 10-BIT, HDR, Vision; no audio, as on the file rows, D105; the Queue page draws the whole release),
  cut first, never wrapped, the size muted at the right end (`64.0 GB`).
- **Second line** (86 %): the state text in treatment B (`42% · 12 min left`, `Queued`, `Stalled · 42%`, `Importing…`, a failure in
  red without its full stop) and the flag (`.jfmod-fileExtra--dot`) in the strip captions' type, smaller (D148, the user's
  pick 2026-10-30): uppercase, 600, `.06em` tracking, 62 %, at `.62em` of the row (`.7209em` of the 86 % line), so it reads
  `· REPLACES 1080P`; the failure's `· 1080P STAYS` is the same element and takes the same type. Its caps are centred on the
  status's figures (D156): the line aligns on the baseline and the flag rises `.14em` (half the two cap heights' difference):

  | | Replace | Add |
  | --- | --- | --- |
  | on its way, importing | `· replaces 1080p`; two files `· replaces 1080p, 720p`; three or more (or two of one quality) `· replaces 3 files`; files not recorded (an older Replace) `· replaces the current file` | `· another version` |
  | failed | `· 1080p stays` (`· 1080p, 720p stay`, `· 3 files stay`) | none |

  A file is named by its own Video entry's resolution, else by the resolution of its file name (the queue's `replaces`).
- **X** (administrators, `.jfmod-fileIcons` + `.jfmod-fileIcon--danger`, the file rows' red round cross): a held grab is
  cancelled at once; otherwise it opens the removal dialog for the row's state (D120, 2026-10-29;
  [buttons-and-row-actions.md](buttons-and-row-actions.md)), where a Replace adds "Your 1080p file stays.". No X while importing,
  nor while the grab is being sent. Its label: `Cancel Download` / `Remove from Queue`.
- When it ends, however it ends, the page reads its entry again; when the files it lists differ from upstream's Version select
  (an import added one, a Replace removed one) the page loads afresh on the title's main copy (as after Remove this version), so
  upstream's Version select and playback hold the new file (Add) or only it (Replace); a cancellation reloads nothing. Only on
  the address the page was opened on: not once the viewer started moving on (even while the destination still loads) or the page
  went away. The strip goes in the same render when the
  page lists no file. A queue that answers 403 hides the entry at once, and keeps it hidden until a read succeeds again.

## In a narrow Video list

Where the list is under **24em** (the file rows' measure, `.jfmod-fileList--narrow`: a computer window under about 1280 px
that is still a row, and a 360 px phone; 390 and 430 px phones and a stacked computer strip keep the two lines above), the entry
inside the list stacks, so nothing is sliced or ellipsised (D236). Under the strip, with the list closed, it stays as above.

- **Line 1:** the ring at **1.618em** (φ; the row's 2.5em ring scaled whole), centred on the line, `.236em` (φ⁻³) before the text; the
  quality in 600, the size and the marks after it when they fit, and the X at the end, in the file rows' X column. The line is the X's
  height (2.5em; phone 40 px) and its text keeps clear of the X's glyph (2em from the row's edge; phone 2.5em). The size is `.382em`
  (φ⁻²) off the X. **Size and marks drop whole:** the size goes when it does not fit beside the quality, and the marks go one by one
  before it. A quality too long for the line wraps, never cuts (`1080p WEB-DL` fits from the strip's first row width, 996 px, D238).
- **Line 2:** the state in treatment B under the quality, `.382em` over line 1's foot.
- **Line 3:** the flag under it, no dot, in the type above (uppercase, 600, `.06em` tracking, 62 %, `.62em` of the row).
- A longer state wraps as well. The ring's padding keeps it where the rows' text starts.

## TV and phone

TV: one stop, the X, reached by Down from the strip (the ring is no stop there). Phone: the same two lines at 90 %; a mark that
does not fit is dropped whole, never sliced ([media-marks.md](media-marks.md), D197), and the X is 40 px (2.7816em, glyph 1.39em,
[buttons-and-row-actions.md](buttons-and-row-actions.md)). In the phone's Video list (inside the card) the entry's padding is `.35em
.5em .15em .25em`, so the ring sits where the rows' text starts, and the X sits in the file rows' X column, `.25em` from the edge.

## Do not

- Draw the full download block, a bar, the release name, the indexer or View Queue here: those are the Queue page's.
- Put a mark on the poster for it; the card's + is for cards.
