# Setup wizard: where "what blocks this step" lives — APPROVED 2026-10-15: A, beside Continue (user: "A, tell parent to implement it")

Session: Row Icon State Designs (local_0162f905…). Artifact: https://claude.ai/artifact/CcPuncAsFokHMYhbnVCfa4 (v2); file `wizard-step-blockers.html`; screenshots `wizard-step-blockers-{compare,phone,done}.png` (compare = A, B, today stacked).

User: "design notice place or section or notification?" for the wizard's "This step is not done yet. <what blocks it>" message, now that the done banner is gone and Continue sits beside Save.

## Recommendation — A: one sentence beside Continue

The reason lives in the card footer, left of the buttons, as one muted sentence with a small lock glyph: **"To continue,** test Prowlarr after saving it and add at least one indexer and turn it on." Continue is refused (`aria-disabled`, 45 % opacity, tooltip "Not yet: …") while it shows; when the step is done the sentence disappears and Continue is live — no "done" banner, as the user asked. The rail keeps its per-step status line in the short form the other sections already use ("1 indexer · Prowlarr not tested", red) and the card's subtitle repeats it.

Why there: it is where the user looks when they want to move on, next to the button that refuses them; the card's first line stays the form, not a warning; nothing to dismiss and nothing shouting on a step the user opened on purpose; it wraps above the buttons on the phone and is a plain line on TV, where Continue stays a focus stop. The step is explained at most twice — rail (what is wrong, short) and footer (what to do, one sentence) — and both come from the same blocker list, so they cannot disagree.

## Alternative — B: a "This step needs" checklist under the title

A short list at the top of the body, one line per requirement, each turning into a green tick with its "met" wording as it is satisfied ("Prowlarr saved and tested"). More structure; better once a step has three or more requirements. Costs the first screen line on every visit, done or not, and repeats the rail. Not recommended for today's steps, which have one or two blockers each.

## Not proposed
- Today's top notice: first thing on the card whether or not the user came to fix it, reads like an error for a page in progress, far from the button it unlocks.
- Inline under the field: blockers span several fields (save + test + add a row), so there is no one field.
- Tooltip only: invisible on the phone and TV. Toast: gone before it is read. Rail only: tells what is wrong, not what to do.

## Copy (sentence case; buttons named in Title Case)

| step | rail status (short) | beside Continue | when met |
|---|---|---|---|
| Discovery | Using Jellyfin's TMDb connection | — (no blocker; a token is optional) | — |
| Prowlarr and Indexers | No indexer configured / 1 indexer · Prowlarr not tested | To continue, test Prowlarr after saving it. / … add at least one indexer and turn it on. | Prowlarr saved and tested / An indexer is enabled and verified |
| Download Client | No download client configured / Transmission · not tested since it changed | To continue, save a download client and test it. | A download client is saved / Tested |
| Quality Profiles | No quality profile / No default profile | To continue, add a profile (Add Preset Profiles gives you 4K, 2K and 1080p) and choose a default with the star on its row. | 3 profiles / Default: 4K |
| Import Paths | No library folder mapped / 1 unverified mapping | To continue, point the import at a library folder Jellyfin can see and verify the mapping so hard links work. | Library folder mapped / Mapping verified |

Two blockers join with "and"; three with commas and "and".

## Build cost (web only)

Small: the blocker list already exists (it fed the top notice). In `SetupWizardPage.tsx`, move its rendering from the notice slot to the card footer's left side (`jfmod-check-secfoot` already is a flex row: the helper takes `flex: 1 1 12em`, the buttons `margin-left: auto`), set `aria-disabled` + tooltip on Continue from the same list, and drop the notice. One function that turns the blocker codes into the instruction sentence (~25 lines; the rail words come from `summarise` as today). ~40 lines TSX, ~15 SCSS. B would add a list component (~60 lines) instead.

## Decision for the user
A (recommended) or B. Both keep the rail status; neither brings the done banner back.
