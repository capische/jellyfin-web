# Quality Profiles: section and Add / Edit dialog redesign — APPROVED 2026-10-15 (user: "Love quality profiles - implement it too"; open decisions default to the recommendations below: add 1440p to the parser so 2K is real, size tiers as drawn, presets as a radio list, Add Predefined Profiles only while a preset is missing)

Session: Row Icon State Designs (local_0162f905…). Artifact: https://claude.ai/artifact/M16LLzc8fK9axZtTwQtw1j (v1; file `quality-profiles-redesign.html`, screenshots `quality-profiles-*.png`).

User: "this is a mess … is it easy for dummies? More detailed stuff you can hide under an advanced section. But I'd like to see a couple of profiles for 4K and 2K and 1080p or so."

## In one paragraph

The section keeps its card, its blue *Add Profile* and its row icons (Make Default star, Edit pencil, Remove red bin, ≥ 40 px, Title Case tooltips); each row now says in one line what the profile does — "4K first, then down to 720p · 8–20 GB per hour · no upgrades" — instead of its 24-name list, presets carry a *Preset* chip, the default the blue *Default* chip, and a grey *Add Predefined Profiles* button appears while a preset is missing (and in the empty state). The dialog is **simple by default**: *Start from* (six presets as a radio list with a one-line description each), *Name* (prefilled), *Best quality I want* (4K / 2K / 1080p / 720p / SD), *Fall back to lower quality … down to [720p]* (on), *File size* Small / Balanced / Large with the GB-per-hour range for the chosen tier and "a 2-hour film at Balanced is about 16–40 GB", *Upgrade later when something better appears* (off; "Needs Automation on"), and a live blue summary sentence. **Advanced** (collapsed) holds the whole model: a source × resolution checkbox matrix (Remux / Blu-ray / WEB-DL / WEBRip / HDTV / DVD × 2160p / 1440p / 1080p / 720p / 576p / 480p) instead of the 24-line list, the order tried with Move Up / Move Down / Remove icons and an "Order tried: 1 …" line, cutoff, upgrade mode, minimum score, minimum seeders, and the size limits as GB per hour. The simple controls write the record; advanced edits mark it *Custom*. The server's two rules are checked live (at least one quality; the cutoff must be allowed, and upgrades need one) with Save refused until they pass. The 80 % path is: open, pick a preset, maybe rename, Save — three clicks.

## What the simple controls do to the model

| simple control | record |
|---|---|
| Start from | copies a preset's record; name prefilled |
| Best quality I want | the top resolution; its sources in the fixed order Remux › Blu-ray › WEB-DL › WEBRip › HDTV (DVD for SD) |
| Fall back, down to | appends every lower resolution to the floor in the same source order; off = the best resolution only |
| File size | per best tier (GB/h): 4K small ≤ 8, balanced 8–20, large no max; 2K 4 / 10; 1080p 2 / 6; 720p 1 / 3; SD 0.5 / 1.5 — stored as bytes per hour |
| Upgrade later | `upgradeAllowed`; cutoff = first quality of the order; `upgradeMode` replace unless Advanced says add |
| (always) | `minimumSeeders` 2 from the presets; `minimumAutoScore` empty |

## Starting profiles (the three the user asked for, plus the other presets' data)

4K · Default · Preset — 2160p first, down to 720p, Large (no size limit; user, 2026-10-19, was Balanced 8–20 GB/h), no upgrades, seeders ≥ 2 (order: remux-2160p, bluray-2160p, webdl-2160p, webrip-2160p, hdtv-2160p, …1440p…, …1080p…, …720p).
2K · Preset — 1440p first, down to 720p, 4–10 GB/h. **Needs 1440p in the plugin's quality list** (see decisions).
1080p · Preset — 1080p first, down to 720p, 2–6 GB/h.
720p, Any Quality (2160p → 480p, no size limit), SD (576p/480p incl. DVD) as the other presets.
Where the default is chosen: the star icon on a row and the Grabbing section's "Default quality profile" select (unchanged); the first profile created becomes the default.

## Revision (2026-10-15, artifact v2): "Order tried" is hidden behind a click

User: "The only thing 'Order tried: …' it makes sense to hide it and show only on click. Too much information. I'd treat it as debug." So: the long "Order tried: 1 remux-2160p, 2 …" sentence is not shown by default anywhere — in the dialog's Advanced section it sits behind a small "Order tried ▸" disclosure under the ranked list (the ranked list with its Move Up / Move Down icons stays, it is the control), and on the preset cards behind the same disclosure. Rows never show it.

**Second round (same day, artifact v3):** "the same applies to 'Order tried, best first' — I would assume order, and it's too advanced." So the ranked list with its Move Up / Move Down / Remove icons is also collapsed: Advanced shows the matrix, the cutoff, the upgrade mode, the score, seeders and size limits; the ranked list sits behind a "Change the order tried ▸" disclosure with a one-line note that the matrix already sets the usual order (higher resolution first, then Remux › Blu-ray › WEB-DL › WEBRip › HDTV) and the list is for exceptions such as WEB-DL before Blu-ray. The order itself is still stored and sent exactly as before; only its editor is hidden by default.

## Revision (2026-10-15, artifact v4): quality names are pretty-printed

User, with a screenshot of the cutoff select showing raw ids: "can these to be pretty printed? even for Order tried?" So every quality the user sees is written as resolution + source — `remux-2160p` → **4K Remux**, `bluray-1080p` → **1080p Blu-ray**, `webdl-2160p` → **4K WEB-DL**, `hdtv-720p` → **720p HDTV**, `dvd-576p` → **576p DVD**, 1440p → **2K …** — in the cutoff select, the order list and its disclosure, the preset cards, the summary sentence, the "Upgrade later" help, the row summaries and the icon tooltips. The raw id stays only in the data and as the `title` of the list item. One function: `pretty(id)` = `RESNAME[res] + ' ' + SRCNAME[src]` with RESNAME 2160p→4K, 1440p→2K, others as is, SRCNAME remux→Remux, bluray→Blu-ray, webdl→WEB-DL, webrip→WEBRip, hdtv→HDTV, dvd→DVD.

## Revision (2026-10-15, artifact v12): Predefined as a custom dropdown; no Custom heading, no provenance line

User, in order: "Start from should say something like 'Predefined'"; "Predefined + Dropdown"; "use custom dropdown (we already got one on details page) so you can keep the font weight size difference inside dropdown"; "Remove Custom and 'Filled from the predefined 4K…' — useless". Final state of the dialog body:

1. **PREDEFINED** (uppercase group heading) — a **custom dropdown** like the detail page's file chooser (§11): a field-like trigger showing the chosen entry as the name in weight 600 with its one-line description under it in the smaller muted size, a chevron at the right; the open list is a paper popover of the six entries drawn the same way (name bold, description muted), the current one marked with the blue left bar; choosing one refills the fields below. Entries: 4K, 2K, 1080p, 720p, Any Quality, SD with the descriptions in this note.
2. Then the fields, with **no** group heading and **no** "filled from" line: Name (the predefined profile's own name, "4K"), Best quality I want, Fall back … down to, File size, Upgrade later, the summary sentence (no chip), Advanced (collapsed; the order list behind "Change the order tried"; pretty names).

The row chip on the section reads **Predefined**; the grey button is *Add Predefined Profiles*.

## Decisions for the user

1. **2K / 1440p:** the plugin's quality list has no 1440p (ReleaseParser builds remux 2160p/1080p; bluray/webdl/webrip/hdtv at 2160p/1080p/720p/576p/480p; dvd 576p/480p). Either the plugin adds `bluray-1440p`, `webdl-1440p`, `webrip-1440p` (small parser change, and the 2K preset becomes real) or the 2K preset is dropped. The mock marks the column with *.
2. Size tiers: the GB-per-hour figures above are my estimates for typical releases; say if you want different ones (they are data in the presets).
3. Presets as a radio list with descriptions (as drawn) or as cards — the list is shorter on the phone and was chosen for that.
4. Keep *Add Predefined Profiles* visible only while a preset is missing (as drawn) or always.

## Build cost (web only; presets and API by the other agent)

Replace `ProfileDialog` in `settingsSections.tsx` (~150 lines today) with the simple form + an Advanced `<details>` (~300 lines TSX, ~120 SCSS under `jfmod-qp-*`), reusing `FieldForm`, `IconAction`, `useDraft`, the dialog shell and the existing `QualityRow`. New pieces: the simple→record mapping (a pure function, ~40 lines), the summary sentence (~20), the matrix (~40), the live validation (~15). `ProfileRow` gains the one-line summary (same function) and the *Preset* chip (needs `isPreset` or a preset id on the record from the other agent). Section head gains the grey *Add Predefined Profiles* button calling the admin action. No plugin change for the dialog itself; 1440p is the only plugin question.
