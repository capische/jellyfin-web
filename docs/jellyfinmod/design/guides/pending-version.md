# Pending version (another copy on its way for a title that plays)

**Status:** option 3 of workspace `reviews/upgrade-status-options/` (the user's pick 2026-10-28), placed under the track strip
(D9), with the admin's X (D10) and the Replace wording (D11, user: "use profile and I don't think you need `the`") of
`reviews/overnight-2026-10-28/DECISIONS.md`: **built overnight 2026-10-28, awaiting the user's approval**. Code:
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
- **First line:** the quality in 600 (`4K Remux`, from the grab's parsed name; else the queue's label), the release's media
  marks (cut first, never wrapped), the size muted at the right end (`64.0 GB`).
- **Second line** (86 %): the state text in treatment B (`42% · 12 min left`, `Queued`, `Stalled · 42%`, `Importing…`, a failure in
  red without its full stop) and the flag, muted (`.jfmod-fileExtra--dot`):

  | | Replace | Add |
  | --- | --- | --- |
  | on its way, importing | `· replaces 1080p`; two files `· replaces 1080p, 720p`; three or more (or two of one quality) `· replaces 3 files`; files not recorded (an older Replace) `· replaces the current file` | `· another version` |
  | failed | `· 1080p stays` (`· 1080p, 720p stay`, `· 3 files stay`) | none |

  A file is named by its own Video entry's resolution, else by the resolution of its file name (the queue's `replaces`).
- **X** (administrators, `.jfmod-fileIcons` + `.jfmod-fileIcon--danger`, the file rows' red round cross): a held grab is
  cancelled at once; a download asks the existing **Remove the Torrent** question (a pack whose episodes have started
  importing asks its keep-the-files form and keeps them, D39, [buttons-and-row-actions.md](buttons-and-row-actions.md)); a
  failure opens **Remove from Queue** with its options. No X while importing, nor while the grab is being sent. Its label: `Cancel Download` / `Remove from Queue`.
- When it ends, however it ends, the page reads its entry again; when the files it lists differ from upstream's Version select
  (an import added one, a Replace removed one) the page loads afresh on the title's main copy (as after Remove this version), so
  upstream's Version select and playback hold the new file (Add) or only it (Replace); a cancellation reloads nothing. Only on
  the address the page was opened on: not once the viewer started moving on (even while the destination still loads) or the page
  went away. The strip goes in the same render when the
  page lists no file. A queue that answers 403 hides the entry at once, and keeps it hidden until a read succeeds again.

## TV and phone

TV: one stop, the X, reached by Down from the strip (the ring is no stop there). Phone: the same two lines at 90 %, the marks
cut first.

## Do not

- Draw the full download block, a bar, the release name, the indexer or View Queue here: those are the Queue page's.
- Put a mark on the poster for it; the card's + is for cards.
