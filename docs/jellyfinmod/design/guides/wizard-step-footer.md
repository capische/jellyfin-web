# Wizard step footer ("To continue, …")

**Status:** approved 2026-10-15 ("A, tell parent to implement it"). Built on `next-release` (P7.FU4). Records:
[design note](../wizard-step-blockers.md), artifact <https://claude.ai/artifact/CcPuncAsFokHMYhbnVCfa4>. Code:
`settings/settingsWidgets.tsx` (the section footer), `settings/SetupWizardPage.tsx` (the blocker list),
`settings/settings.scss` (`.jfmod-check-secfoot`, `.jfmod-wizardfoot`, `.jfmod-blockers`, `.jfmod-continue`).

## What it is

What blocks a setup step lives in the step card's footer, left of the buttons, as one muted sentence with a small lock
glyph. Continue is refused while it shows; when the step is done the sentence disappears and Continue is live. No banner,
no top notice, nothing to dismiss.

## Anatomy

- Footer `.jfmod-check-secfoot`: flex, `align-items: center`, wraps, `padding .9em 1.5em` (1em on narrow and phone),
  a hairline `border-top` in the divider colour; children `margin-right 1em`.
- Blockers `.jfmod-blockers`: `flex 1 1 12em`, secondary text at .9em, `line-height 1.4`, the lock glyph first; the lead
  **"To continue,"** in bold, then the instruction in sentence case ending with a full stop.
- Buttons at the right: Save (`[data-submit]`, `margin-left: auto`) then **Continue** (`.jfmod-continue`, Save's blue
  button, the one main action; [buttons-and-row-actions.md](buttons-and-row-actions.md)). Narrow, the buttons wrap under
  the sentence, still at the right.
- Continue while blocked: `aria-disabled="true"` (never `disabled`, so the remote keeps its place), 45 % opacity, tooltip
  **"Not yet: …"** with the same sentence.
- The rail keeps its short per-step status ("1 indexer · Prowlarr not tested", red) and the card's subtitle repeats it; the
  footer says what to do. Both come from the same blocker list.

## Copy

| Step | Beside Continue |
| --- | --- |
| Prowlarr and Indexers | To continue, test Prowlarr after saving it. / … add at least one indexer and turn it on. |
| Download Client | To continue, save a download client and test it. |
| Quality Profiles | To continue, add a profile (Add Predefined Profiles gives you 4K, 2K and 1080p) and choose a default with the star on its row. |
| Import Paths | To continue, point the import at a library folder Jellyfin can see and verify the mapping so hard links work. |
| Discovery | — (nothing blocks it; a token is optional) |

Two blockers join with "and"; three with commas and "and". Buttons are named in Title Case inside the sentence.

## Do not

- Bring back a top notice, a done banner, a checklist or a toast for the same information.
- Put the sentence under a field: blockers span several fields.
