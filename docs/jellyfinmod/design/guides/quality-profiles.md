# Quality Profiles section and dialog

**Status:** approved 2026-10-15 ("Love quality profiles - implement it too"), revised the same day and 2026-10-16/17 to
artifact v12 (order list hidden, pretty names, Predefined as a dropdown, no Custom heading or provenance line). The 4K preset has no size limit (Large; user, 2026-10-19, P4.FU14). The profile selects' two-line options:
user, 2026-10-24 (P4.FU17, P4.FU19). The release picker's BDRip label and Full Disc: user, 2026-10-25 (P4.FU22). Built on
`next-release` (P4.FU9). **Phase 12** (user-approved 2026-10-29, D53–D56, D58; mockups `reviews/phase12/mockups/1-settings.html`,
`2-profile-dialog.html`; built 2026-10-29, not accepted): the Prefer field, the row's preference clause, the phone mark on the
quality profile for phones, the Quality profile for phones select, the 1080p preset's Plays Everywhere. Records: [design note](../quality-profiles-redesign.md), artifact
<https://claude.ai/artifact/M16LLzc8fK9axZtTwQtw1j>, [UX.md §12 and §12.1](../../UX.md). Code: `settings/qualityProfiles.tsx`,
`settings/qualityProfiles.scss` (`.jfmod-qp-*`), `settings/settingsSections.tsx` (`ProfileRow`, `QualityRow`).

## What it is

Simple by default, the whole model under Advanced. The 80 % path is open, pick a predefined profile, maybe rename, Save.

## Section rows

- The card, the blue *Add Profile* and the row icons stay ([buttons-and-row-actions.md](buttons-and-row-actions.md)):
  Make Default `star_border`, Edit pencil, Remove red bin.
- Each row says in one sentence what the profile does: **"4K first, then down to 720p · any size · no upgrades"**,
  never the quality list; a profile with a preference adds it before the upgrades: **"· best on my TVs"** or **"· plays
  everywhere"** (Phase 12). Chips: *Predefined* on the shipped profiles, the blue *Default* on the default.
- **The quality profile for phones** (D54) carries the phone mark after its name (`components/PhoneMark.tsx`, the
  [track dropdown](track-dropdown.md)'s mark: Material `smartphone`, 1.05em, 86 %, `.28em` after the name; label and tooltip
  **"Quality profile for phones"**) in its row, in both profile selects' options and closed values, and in the picker's Quality
  Profile field. No chip; not in the profile dialog (the choice is made in Grabbing).
- **Order (user, 2026-10-19):** profiles list best first, 4K, 2K, 1080p, 720p, SD, in the Settings list, the wizard step, the Default
  profile select and the release picker's Quality Profile dropdown alike. The plugin returns them in that order (by the resolution of
  each profile's best quality, then name); no list sorts on its own. The picker's dropdown has no "Title default" entry: the default
  profile reads **"4K (Default)"** and is selected unless the title has its own profile.
- A grey *Add Predefined Profiles* button shows while a predefined profile is missing (and in the empty state).

## Profile selects: Default quality profile (Grabbing) and the picker's Quality Profile

- (user, 2026-10-24, P4.FU17 and P4.FU19) In Grabbing (the wizard's *Turn Grabbing On* step and the settings section) and in the
  release picker, each option of the open menu is two lines: the profile's name in 600 (the picker's default as "4K (Default)")
  over the row's summary (`profileSummary`, the same words as the section's row) at 0.88em in the secondary text colour, a list
  row's sizes. One renderer, `components/detailOptions.tsx` (`detailMenuItems`, `detailLabelOf`; `.jfmod-optdetail`,
  `.jfmod-optdetail-text` in `detailOptions.scss`): an MUI menu, `white-space: normal`, so a long summary wraps on a phone instead
  of widening the menu. The closed select shows the name only (`renderValue`).
- The picker's is an MUI `Select` in place of upstream's native select, drawn as the scope switch beside it: the small grey
  label over the value on a hairline and the same ▾, a blue hairline while focused (`.jfmod-releaseProfileField`). Its trigger
  keeps the id `jfmod-releaseProfile` and the `focusable` class (a TV focus stop; Enter opens the menu, `shell/dpadModals` drives
  it, Back closes only the menu); the menu (`.jfmod-releaseProfileMenu`) sits above upstream's dialog layer at z-index 1000000.
  Behaviour as before: the title's own profile, else the default, is selected; picking the profile the search already uses sends
  no override; another one sends `profileId` and searches once. On a title with no file at 1080p or below, Get Another Quality
  (the page's cloud icon) opens on the quality profile for phones; on the profile for phones the notice reads "Adds a 1080p copy
  for phones. The 4K stays." and only Add is offered (Phase 12, D57, D103).
- **Quality profile for phones** (Grabbing, after *Default quality profile*; Phase 12, D55): the same two-line select; help
  "Phones play a title's file at 1080p or below. Get Another Quality starts with this profile on a title that has none." Both
  selects mark the profile chosen for phones as the form has it, so the mark moves as it is chosen.

## Dialog, in order

1. **PREDEFINED** (uppercase group heading): the custom dropdown ([track-dropdown.md](track-dropdown.md), settings skin,
   `.jfmod-qp-pick*`) — the entry's name in 600 over its one-line description; entries 4K, 2K, 1080p, 720p, Any Quality, SD.
   Choosing one refills everything below. No "Custom" heading and no "filled from …" line follow it.
2. **Name** (`.jfmod-qp-input`): prefilled with the predefined name ("4K"); the user may keep it.
3. **Best quality I want**: segmented buttons (`.jfmod-qp-seg`, `.jfmod-qp-segbtn`, pressed = primary fill) 4K · 2K ·
   1080p · 720p · SD.
4. **Fall back to lower quality … down to [720p]** (checkbox + `.jfmod-qp-floor` select), on by default.
5. **File size**: Small · Balanced · Large (`.jfmod-qp-size`), each with its GB-per-hour range and the "2-hour film" figure.
6. **Prefer** (Phase 12, only with a plugin that has `copies`): three segmented buttons of the File size kind
   (`.jfmod-qp-seg.jfmod-qp-size`, `data-qp="prefer-tvs|prefer-everywhere|prefer-none"`), each a title over a small line:
   **Best on My TVs** (the ticked TVs' names, "LG C1, LG G2", or "best picture and sound" with none) · **Plays Everywhere**
   (phones, browsers) · **No Preference** (as before); a hint under them (`data-qp="prefer-hint"`) says what it prefers: "Among
   releases of the same quality: Dolby Vision first, then HDR10; Dolby Digital Plus and Dolby Digital sound first; DTS last." /
   "… no HDR and H.264 first; AAC, Dolby Digital and Dolby Digital Plus sound first; TrueHD and DTS last."
7. **Upgrade later when something better appears** (off; help "Needs Automation on").
8. **Summary** (`.jfmod-qp-sum`): one live sentence, a 0.2em primary left bar on a 12 % primary wash; with a preference it adds
   "among releases of the same quality takes the one that plays best on your TVs" / "… the one most devices play without the
   server converting it".
9. **Advanced** (`<details class="jfmod-qp-adv">`, collapsed): the source × resolution checkbox matrix (`.jfmod-qp-matrix`,
   Remux / Blu-ray / WEB-DL / WEBRip / HDTV / DVD × 2160p / 1440p / 1080p / 720p / 576p / 480p; impossible cells
   `.jfmod-qp-na` at 35 %), then **"Change the order tried ▸"** (`.jfmod-qp-ordertried`, collapsed) wrapping the ranked
   list with Move Up / Move Down / Remove icons and a one-line note that the matrix already sets the usual order, then
   cutoff, upgrade mode, minimum score, minimum seeders and the size limits as GB per hour.
10. Problems (`.jfmod-qp-problem`, red bar) and Save refused until they pass: at least one quality; the cutoff must be an
   allowed quality and upgrades need one; min size below max; a name.

Fields: label `.jfmod-qp-label` .88em secondary; inputs 6 % white fill with a bottom hairline, radius `.2em .2em 0 0`,
focus underline in the primary; every size in `em`; no `gap` outside the dialog's own flex rows that already use it.

## Words

- Quality ids are **pretty-printed** everywhere the user reads them: `remux-2160p` → **4K Remux**, `bluray-1080p` →
  **1080p Blu-ray**, `webdl-2160p` → **4K WEB-DL**, `hdtv-720p` → **720p HDTV**, `dvd-576p` → **576p DVD**, 1440p → **2K …**.
  One function; the raw id survives only as data and as the list item's `title`.
- A release in the picker whose name calls a Blu-ray encode a rip reads that word: **4K BDRip**, **1080p BRRip** (the
  same `bluray` tier as **4K Blu-ray**; a plain BluRay encode stays **4K Blu-ray**, a remux **4K Remux**). A whole disc
  (BD50, BDMV, BR-DISK, COMPLETE UHD BLURAY) reads **4K Full Disc** and is refused: "Full disc releases cannot be
  imported." (P4.FU22, user 2026-10-25).
- Sources read Remux › Blu-ray › WEB-DL › WEBRip › HDTV (DVD for SD). Title Case for buttons and headings, sentence case
  for help and the summary.

## Predefined profiles (data, not layout)

| Name | Best | Down to | GB per hour (small ≤ / balanced / large) | Upgrades |
| --- | --- | --- | --- | --- |
| 4K (default; prefers Best on My TVs) | 2160p | 720p | 8 / 8–20 / no max | off |
| 2K | 1440p (needs the parser's 1440p qualities) | 720p | 4 / 4–10 / — | off |
| 1080p (the profile for phones; prefers Plays Everywhere; "Full HD, the sensible middle. Plays on phones too. Falls back to 720p.") | 1080p | 720p | 2 / 2–6 / — | off |
| 720p | 720p | 720p | 1 / 1–3 / — | off |
| Any Quality | 2160p | 480p | no limit | off |
| SD | 576p (incl. DVD) | 480p | 0.5 / 0.5–1.5 / — | off |

Seeders ≥ 2, score empty, cutoff = the first quality of the order, `upgradeMode` replace unless Advanced says add. There is no
Mobile preset (D53); presets are copied when added, so an existing install's stored 1080p keeps No Preference until edited.

## Do not

- Show the quality list or "Order tried" anywhere by default; both are advanced.
- Rename a predefined profile when it is edited; the record becomes the user's, the name stays.
- Add presets, tiers or fields without approval; the GB figures are data in the presets.
