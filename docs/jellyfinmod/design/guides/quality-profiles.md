# Quality Profiles section and dialog

**Status:** approved 2026-10-15 ("Love quality profiles - implement it too"), revised the same day and 2026-10-16/17 to
artifact v12 (order list hidden, pretty names, Predefined as a dropdown, no Custom heading or provenance line). Built on
`next-release` (P4.FU9). Records: [design note](../quality-profiles-redesign.md), artifact
<https://claude.ai/artifact/M16LLzc8fK9axZtTwQtw1j>, [UX.md §12 and §12.1](../../UX.md). Code: `settings/qualityProfiles.tsx`,
`settings/qualityProfiles.scss` (`.jfmod-qp-*`), `settings/settingsSections.tsx` (`ProfileRow`, `QualityRow`).

## What it is

Simple by default, the whole model under Advanced. The 80 % path is open, pick a predefined profile, maybe rename, Save.

## Section rows

- The card, the blue *Add Profile* and the row icons stay ([buttons-and-row-actions.md](buttons-and-row-actions.md)):
  Make Default `star_border`, Edit pencil, Remove red bin.
- Each row says in one sentence what the profile does: **"4K first, then down to 720p · 8–20 GB per hour · no upgrades"**,
  never the quality list. Chips: *Predefined* on the shipped profiles, the blue *Default* on the default.
- **Order (user, 2026-10-19):** profiles list best first, 4K, 2K, 1080p, 720p, SD, in the Settings list, the wizard step, the Default
  profile select and the release picker's Quality Profile dropdown alike. The plugin returns them in that order (by the resolution of
  each profile's best quality, then name); no list sorts on its own. The picker's dropdown has no "Title default" entry: the default
  profile reads **"4K (Default)"** and is selected unless the title has its own profile.
- A grey *Add Predefined Profiles* button shows while a predefined profile is missing (and in the empty state).

## Dialog, in order

1. **PREDEFINED** (uppercase group heading): the custom dropdown ([track-dropdown.md](track-dropdown.md), settings skin,
   `.jfmod-qp-pick*`) — the entry's name in 600 over its one-line description; entries 4K, 2K, 1080p, 720p, Any Quality, SD.
   Choosing one refills everything below. No "Custom" heading and no "filled from …" line follow it.
2. **Name** (`.jfmod-qp-input`): prefilled with the predefined name ("4K"); the user may keep it.
3. **Best quality I want**: segmented buttons (`.jfmod-qp-seg`, `.jfmod-qp-segbtn`, pressed = primary fill) 4K · 2K ·
   1080p · 720p · SD.
4. **Fall back to lower quality … down to [720p]** (checkbox + `.jfmod-qp-floor` select), on by default.
5. **File size**: Small · Balanced · Large (`.jfmod-qp-size`), each with its GB-per-hour range and the "2-hour film" figure.
6. **Upgrade later when something better appears** (off; help "Needs Automation on").
7. **Summary** (`.jfmod-qp-sum`): one live sentence, a 0.2em primary left bar on a 12 % primary wash.
8. **Advanced** (`<details class="jfmod-qp-adv">`, collapsed): the source × resolution checkbox matrix (`.jfmod-qp-matrix`,
   Remux / Blu-ray / WEB-DL / WEBRip / HDTV / DVD × 2160p / 1440p / 1080p / 720p / 576p / 480p; impossible cells
   `.jfmod-qp-na` at 35 %), then **"Change the order tried ▸"** (`.jfmod-qp-ordertried`, collapsed) wrapping the ranked
   list with Move Up / Move Down / Remove icons and a one-line note that the matrix already sets the usual order, then
   cutoff, upgrade mode, minimum score, minimum seeders and the size limits as GB per hour.
9. Problems (`.jfmod-qp-problem`, red bar) and Save refused until they pass: at least one quality; the cutoff must be an
   allowed quality and upgrades need one; min size below max; a name.

Fields: label `.jfmod-qp-label` .88em secondary; inputs 6 % white fill with a bottom hairline, radius `.2em .2em 0 0`,
focus underline in the primary; every size in `em`; no `gap` outside the dialog's own flex rows that already use it.

## Words

- Quality ids are **pretty-printed** everywhere the user reads them: `remux-2160p` → **4K Remux**, `bluray-1080p` →
  **1080p Blu-ray**, `webdl-2160p` → **4K WEB-DL**, `hdtv-720p` → **720p HDTV**, `dvd-576p` → **576p DVD**, 1440p → **2K …**.
  One function; the raw id survives only as data and as the list item's `title`.
- Sources read Remux › Blu-ray › WEB-DL › WEBRip › HDTV (DVD for SD). Title Case for buttons and headings, sentence case
  for help and the summary.

## Predefined profiles (data, not layout)

| Name | Best | Down to | GB per hour (small ≤ / balanced / large) | Upgrades |
| --- | --- | --- | --- | --- |
| 4K (default) | 2160p | 720p | 8 / 8–20 / no max | off |
| 2K | 1440p (needs the parser's 1440p qualities) | 720p | 4 / 4–10 / — | off |
| 1080p | 1080p | 720p | 2 / 2–6 / — | off |
| 720p | 720p | 720p | 1 / 1–3 / — | off |
| Any Quality | 2160p | 480p | no limit | off |
| SD | 576p (incl. DVD) | 480p | 0.5 / 0.5–1.5 / — | off |

Seeders ≥ 2, score empty, cutoff = the first quality of the order, `upgradeMode` replace unless Advanced says add.

## Do not

- Show the quality list or "Order tried" anywhere by default; both are advanced.
- Rename a predefined profile when it is edited; the record becomes the user's, the name stays.
- Add presets, tiers or fields without approval; the GB figures are data in the presets.
