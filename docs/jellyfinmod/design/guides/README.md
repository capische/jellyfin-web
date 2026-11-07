# Component design guides

**Status: approved 2026-11-06, D288–D295, built, not accepted.** Computer first look only; phone/TV specifics and full acceptance follow the user's first look. These values supersede the older presentation notes below.


One short guide per reusable piece of JellyfinMod's interface: what it is for, its anatomy, sizes, colours, states, motion,
copy, and where it lives in the code. A guide is the **current, approved state** of a component, written so that a new
mockup, a brief or a build can reuse the component without re-deriving it. The history (what was tried, the measurements,
the user's words) stays in `UX.md` and in the design notes beside this folder; a guide links to them and repeats only the
values.

The design rulebook, how the components fit together: [GUIDELINES.md](../GUIDELINES.md).

| Guide | Component | Used by |
| --- | --- | --- |
| [title-pages.md](title-pages.md) | art-ground title head (golden scale tokens of `design/_golden.scss`, ds.t10), stable poster/still boxes, action pill, person facts and Add/Undo notice | movie, series, season, episode, person and TMDB browse pages |
| [shared-chrome.md](shared-chrome.md) | scoped type, colour, dialogs, switches, existing settings/list rows, motion and focus | signed-in mod shell, excluding admin and wizard |
| [menus.md](menus.md) | paper menus, anchored lists and scrolling phone sheets | More, user, library and player menus |
| [skip-button.md](skip-button.md) | Skip Intro, Skip Outro and Skip Recap in the player, drawn as Play | video player |
| [top-bar.md](top-bar.md) | glass top bar and its single URL-backed search | computer, tablet, phone and legacy TV header |
| [spinner.md](spinner.md) | smaller upstream loading spinner and theme ink | loading in the mod shell |
| [download-state-mark.md](download-state-mark.md) | the download state ring (disc, arc, glyph) in three sizes | cards, rows, the detail line, the Queue page, the picker's added row, the episode page block, the season and series headers |
| [card-glass.md](card-glass.md) | the frosted-glass recipe and its ink colours | the scrolled top bar, every mark on a poster, the poster's disc and foot pill |
| [poster-card.md](poster-card.md) | the poster: corners, the hover ring and dim, the centred glass disc, the foot pill, TV focus, the Movies and Shows grid and its three-line caption | every card in the mod shell |
| [media-marks.md](media-marks.md) | codec, HDR and audio marks (Dolby and DTS chips, channel tags) | the release picker, the Video / Audio / Subtitles dropdowns, the download block |
| [track-dropdown.md](track-dropdown.md) | the track strip and the custom dropdown: one field of Video / Audio / Subtitles segments, paper lists, blue bar on the current entry; the phone mark on the phones' file (accepted 2026-10-30, Phase 12) | the detail page's strip, Predefined in the profile dialog; the phone mark also on every Plays Everywhere quality profile ([quality-profiles.md](quality-profiles.md), D180) |
| [pending-version.md](pending-version.md) | another version on its way for a title that plays: ring, two lines, the Replace / Add flag, the admin's X | under the detail page's track strip, in its open Video list |
| [download-block.md](download-block.md) | slim missing/unaired status or compact active download card | movie and episode title pages |
| [quality-profiles.md](quality-profiles.md) | the Quality Profiles section rows and the Add / Edit dialog (Phase 12's Prefer, phone mark and order accepted 2026-10-30) | settings area, setup wizard |
| [wizard-step-footer.md](wizard-step-footer.md) | the "To continue, …" line beside Continue | the setup wizard |
| [settings-field.md](settings-field.md) | a settings field's label, the required asterisk and the help line; small fields sharing a row, a number field that carries its own on/off (empty is Off), the Advanced disclosure (2026-11-07) | settings area, setup wizard, settings dialogs |
| [secret-field.md](secret-field.md) | the write-only secret field: label line with Get a Key ↗ / Key Page ↗, Configured / Typing / Testing / Passed / Failed / Pending clear, Test of the value in the field (typed or saved, never stored), Save and Keep inside it (2026-11-07) | API keys, tokens and passwords in the settings area, setup wizard and dialogs |
| [buttons-and-row-actions.md](buttons-and-row-actions.md) | the three button kinds, the round icon-only row actions, and the group-title disclosure (▸ Rejected, ▸ Activity) | everywhere in the mod; the disclosure in the release picker and Settings › Trakt |
| [indexer-colour.md](indexer-colour.md) | each indexer's fixed colour: the eight-hue palette and how it is given | the picker's Sources and searching ring, the settings indexer rows |
| [tabs.md](tabs.md) | the tab control: a field-high outlined rail whose selected tab has a soft blue thumb (D273) | the player's Subtitle Appearance panel and the Preferences Subtitles page (Primary, Secondary) |
| [info-tip.md](info-tip.md) | the (i) that explains a short state: tooltip on a computer, popover on a click, the TV and the phone | the picker's Sources checklist (an indexer's failure); the Queue page's state discs on the phone |
| [release-picker-sources.md](release-picker-sources.md) | the picker's Sources icon, its dot and train, the checklist, and the searching ring's indexer colours | the release picker (Download, Get Another Quality) |
| [ratings.md](ratings.md) | the ratings group (on a computer its own glass pill under the metadata, ds.t10), its linked popup, the card rating and Refresh Ratings (D276/D277 built, not accepted; earlier Phase 9 accepted) | the movie and series detail pages, Movies and TV cards, the settings area's Ratings section |
| [search-card.md](search-card.md) | the search grid's card: seamless cells padded 1em, lit paper on hover and TV focus, the + shown on hover as a library poster's Play or cloud, the three-line caption, full matches with 100 or more votes first by date, the rest by votes (D253); the same cell with a two-line caption in the browse pages' rows (approved 2026-11-01, D200–D203; first look approved D232; built, not accepted) | the search page, the browse pages of a TMDB title |
| [trakt-direction-mark.md](trakt-direction-mark.md) | the Trakt disc with the direction: up sent to Trakt, down brought from it, pending dashed, failed red (accepted 2026-10-31) | Settings › Trakt's Activity rows |
| [sign-in.md](sign-in.md) | native glass sign-in form, wrong-password state and public users | the mod login route |

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
