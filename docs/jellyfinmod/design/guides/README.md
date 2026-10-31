# Component design guides

One short guide per reusable piece of JellyfinMod's interface: what it is for, its anatomy, sizes, colours, states, motion,
copy, and where it lives in the code. A guide is the **current, approved state** of a component, written so that a new
mockup, a brief or a build can reuse the component without re-deriving it. The history (what was tried, the measurements,
the user's words) stays in `UX.md` and in the design notes beside this folder; a guide links to them and repeats only the
values.

| Guide | Component | Used by |
| --- | --- | --- |
| [download-state-mark.md](download-state-mark.md) | the download state ring (disc, arc, glyph) in three sizes | cards, rows, the detail line, the Queue page, the picker's added row, the episode page block, the season and series headers |
| [card-glass.md](card-glass.md) | the frosted-glass recipe and its ink colours | the scrolled top bar, every mark on a poster |
| [media-marks.md](media-marks.md) | codec, HDR and audio marks (Dolby and DTS chips, channel tags) | the release picker, the Video / Audio / Subtitles dropdowns, the download block |
| [track-dropdown.md](track-dropdown.md) | the track strip and the custom dropdown: one field of Video / Audio / Subtitles segments, paper lists, blue bar on the current entry; the phone mark on the phones' file (accepted 2026-10-30, Phase 12) | the detail page's strip, Predefined in the profile dialog; the phone mark also on every Plays Everywhere quality profile ([quality-profiles.md](quality-profiles.md), D180) |
| [pending-version.md](pending-version.md) | another version on its way for a title that plays: ring, two lines, the Replace / Add flag, the admin's X | under the detail page's track strip, in its open Video list |
| [download-block.md](download-block.md) | a missing episode's download panel | the episode page |
| [quality-profiles.md](quality-profiles.md) | the Quality Profiles section rows and the Add / Edit dialog (Phase 12's Prefer, phone mark and order accepted 2026-10-30) | settings area, setup wizard |
| [wizard-step-footer.md](wizard-step-footer.md) | the "To continue, …" line beside Continue | the setup wizard |
| [settings-field.md](settings-field.md) | a settings field's label, the required asterisk and the help line | settings area, setup wizard, settings dialogs |
| [buttons-and-row-actions.md](buttons-and-row-actions.md) | the three button kinds, the round icon-only row actions, and the group-title disclosure (▸ Rejected, ▸ Activity) | everywhere in the mod; the disclosure in the release picker and Settings › Trakt |
| [indexer-colour.md](indexer-colour.md) | each indexer's fixed colour: the eight-hue palette and how it is given | the picker's Sources and searching ring, the settings indexer rows |
| [info-tip.md](info-tip.md) | the (i) that explains a short state: tooltip on a computer, popover on a click, the TV and the phone | the picker's Sources checklist (an indexer's failure); the Queue page's state discs on the phone |
| [release-picker-sources.md](release-picker-sources.md) | the picker's Sources icon, its dot and train, the checklist, and the searching ring's indexer colours | the release picker (Get a Release, Get Another Quality) |
| [ratings.md](ratings.md) | the ratings group in the first metadata row, its popup, the card rating and Refresh Ratings (accepted 2026-10-30) | the movie and series detail pages, Movies and TV cards, the settings area's Ratings section |
| [trakt-direction-mark.md](trakt-direction-mark.md) | the Trakt disc with the direction: up sent to Trakt, down brought from it, pending dashed, failed red (accepted 2026-10-31) | Settings › Trakt's Activity rows |

## How to use a guide

- **Before any design work** (a mockup, a proposal, a brief to another session, a build or a fix that changes how something
  looks), read the guides of the components the work touches. Draw and build them with the guide's values; a new surface
  reuses the component as it is. Departing from a guide is a design decision: propose it, and wait for the user's approval
  as for any design change.
- A guide gives values in `em` against the surface's font size (TV is 125 %, phone 90 %), colours as theme tokens or the
  exact literals the design fixed, and the class names the build uses. When a guide and the code disagree, that is a bug:
  fix the code or the guide, and say which.
- The workspace rules (`CLAUDE.md`, *Design*) make reading and updating these guides part of every design task.

## How to keep a guide true

- **A change to a component changes its guide in the same commit.** New or changed values, states, sizes, classes, files,
  copy or behaviour go into the guide, and the guide's *Status* line names the approval (date, the user's decision, the
  artifact or note). Nothing about a component is "documented later".
- A new component that will be reused gets a guide when its design is approved, and a row in the table above.
- Keep a guide short: one screen, values and rules, no history. Put the reasoning and the alternatives in the design note
  or `UX.md` and link to them.
- The design notes (`../*.md`, `../*.html`) and the artifacts are the record of the decision; the guide is the reference for
  the next piece of work. Do not edit a note to change a design; write the new decision into the guide and into `UX.md`.
