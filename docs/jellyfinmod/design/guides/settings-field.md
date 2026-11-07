# Settings field (label, required asterisk, help line)

**Review fixes (2026-11-04), built, not accepted:** Preferences walks the custom element's prototype chain for the value setter before emitting input/change, so dropdowns, text and CSS fields reach their original controller. Native form validation and controller `.quickConnectError` messages appear as error-coloured alerts. `integration/prefsPages.ts` unmounts the painted root (including its environment observers and 500 ms read timer) when the owning page is removed, on legacy `viewdestroy`, or when the painter stops. No save or setting semantics change.

**dsC (2026-11-04), built, not accepted:** native `design/Controls` fields keep the source `.fld > .lb + .box > .v` structure, with a real input replacing the inert value span; native select lists use `.pmenu`/`.mi`. Required stars remain outside the accessible name. Shared prompts and Remove After Watching use them; admin/wizard fields remain unchanged. [Scope and CSS delta](../dsC.md).

**rd2 presentation (approved D225–D227, built, not accepted):** in the signed-in chrome outside Dashboard and the mod's
admin settings/setup, `shell/sharedChrome.scss` gives fields a 2.7816em pill with a neutral .09em/32% outline at rest,
primary outline/14% fill under the pointer, .135em focus ring (.236em on TV), and .135em red refused ring. Labels sit above
at .854em, inset 1em, help retains its words and 1.618 pitch. Disabled ink 61.8%. Select chevrons turn on open. Required
asterisks and validation keep the rules below. Admin/wizard fields retain the filled floating-label presentation below.
No field contents, validation, secret handling or save behavior changes. See [shared chrome](shared-chrome.md).

**Status:** approved 2026-10-19 ("Go with asterisks everywhere", after the audit and the mockup); the asterisk moved from first to the END of the label the same day (user: "Asterics at the end - please redo"). Built on `feat/required-asterisk`
(P7.FU7, built, not accepted). Records: [audit](../required-fields-audit.md), [mockup](../optional-field-marker.html), [UX.md](../../UX.md)
§12.1. Code: `settings/settingsWidgets.tsx` (`FieldSpec`, `FieldForm`, `FieldControl`, `ListField`, `SecretField`,
`REQUIRED_SLOTS`, `FillExample`), `settings/settings.scss` (`.jfmod-required`, `.jfmod-example`, `.jfmod-fieldrow`). The clickable
example: user 2026-10-24 (P7.FU9). The secret's Key Page link now lives in [secret-field.md](secret-field.md). The layout rules
(fields sharing a row, a number field that carries its switch, Advanced): user 2026-11-07, below; Advanced without Remove Prowlarr: user 2026-11-07 ("Approve", ds.t9).

## What it is

One text, number, list, select or secret field of the settings area, the setup wizard and the settings dialogs: MUI's filled,
dense field with the label inside, one line with an ellipsis, and an optional help line under it. A field is marked only when
it is **required**; nothing is ever marked "(Optional)".

## Anatomy

- Label: MUI's floating label, one line with an ellipsis; it shrinks to 75 % once the field holds a value.
- Required: the label ends with **` *`**, drawn by `.jfmod-required::after` (`content: " *"` then `content: " *" / ""`), so
  the star takes the label's colour and scales with it and is not part of the accessible name. The input carries
  `aria-required="true"` (on a select, on its combobox, `REQUIRED_SELECT_SLOTS`). Never MUI's `required` prop: it adds an `aria-hidden` span with the star after the label, and the
  accessible name (and every runner's `getByLabel('Name', { exact: true })`) changes.
- Help line `fieldDescription` under the field: one or two sentences that say what to type or what empty means, never a
  repeat of the label.
- **A clickable example** (user, 2026-10-24, P7.FU9; the Prowlarr address): an example value in the help line may be a
  `FillExample` button (`.jfmod-example`) that fills the field with it through the field's own change, as if typed, and focuses
  the input; nothing is saved. It is an inline text button in the links' look (primary `#00a4dc`, weight 600, underline on hover
  and on keyboard focus), no button chrome; its name is "Use <value>". One per field at most, only for a value most people type.
- A secret (API key, token, password) is its own component: [secret-field.md](secret-field.md) (its label line, key page,
  states and Test). The unconfigured, labelled secret takes the required mark as any field does (Prowlarr's key,
  `required={!source?.apiKeyConfigured}`); the Configured box has none.
- A field in a row of a list (a path mapping's two prefixes) takes the class and `aria-required` directly (`REQUIRED_SLOTS`).

## When a field is required

Mark it when a new record starts with the field empty and Save, Test or Add refuses without a value, or the feature cannot work
without it. A field with a default or a value it keeps (Priority, Label, the Automation numbers, a profile's Name), one whose
emptiness means off (Sync every, below),
or that may stay empty (Username, Password, Web interface link, seed goals), has no mark. A field that is shown only in some
state (Selected user, a separate seed's RPC address) is marked only while shown. In a phone dialog the field is about 248 px
wide, so a marked label should fit with its two extra characters, or the cut takes the asterisk with the end of the label; a label that fits by little (*\* Download folder as Transmission sees it*, 1 px to spare at 360 px, became "Download folder in Transmission")
is shortened rather than allowed to cut.

## Phase 12 fields (user-approved 2026-10-29, D55, D56)

- Grabbing, **Quality profile for phones** (select, no mark: it has a value on a fresh install): "Phones play a title's file at
  1080p or below. Get Another Quality starts with this profile on a title that has none."
- Automation, **Also get a 1080p copy for phones** (switch, off), after the upgrades switch: "For a title whose only files are above
  1080p, look for one with the quality profile for phones (Grabbing). A copy that you or retention removed is never fetched again."
- Both are drawn only for a plugin that has them; a save to an older plugin never sends them.

## Layout rules (user, 2026-11-07, ds.t9; built, not accepted)

Approved with the Ratings and Prowlarr mockup (`reviews/ratings-settings/` in the workspace,
[ratings-settings](http://127.0.0.1:8770/ratings-settings/)).

- **Small fields share a row** (`.jfmod-fieldrow` around a `FieldForm`): two numbers side by side at 1fr 1fr (Ratings' *Fetch
  again after (days)* and *MDBList calls per day*), or an address beside its number at 1.618fr 1fr
  (`.jfmod-fieldrow-wide`: Prowlarr's address and *Sync every (minutes)*); a 1em column gap; one column under a 600 px window
  and on the phone layout.
- **A switch that only turns a number field on is not drawn: the field carries it** (the user's Option B, 2026-11-07; first case
  Prowlarr's *Sync every (minutes)*). A number means on at that value; an empty field means off and shows the placeholder
  **Off** (`FieldSpec.placeholder`, the label stays small above it); no help line explains it. Emptying it saves the feature's
  on/off flag as off and leaves the stored number as it was; typing a number saves on with that number. A value the server
  refuses keeps the server's own message. A switch that turns on several fields or a whole feature stays a switch.
- **Advanced**: a settings card's rarely changed fields go into a closed disclosure after its common part, drawn exactly as the
  quality profile dialog's (`<details className='jfmod-qp-adv'>`, summary **Advanced** in bold, no note beside it in the
  settings cards; 1.618em above it in a section, and no top line of its own there, since the list above it ends with its
  divider). Status and counters a user rarely reads go in it too. Ratings: the two numbers, the free-tier line and Fetching
  (today's calls, titles without ratings, the last run), after Ratings Shown. Indexers: the whole indexer list, synced and added by hand, then Add Indexer (no Remove Prowlarr: a cleared address and key disconnect, [buttons-and-row-actions.md](buttons-and-row-actions.md)); Prowlarr's Save and Sync Now, with the sync's state, are the section's bottom bar beside Next (the user, 2026-11-07). It opens by itself when it
  holds an error (a save refused over one of its fields) or the only way forward (Indexers without a Prowlarr source).

## Spec in code

`FieldSpec.required?: boolean` marks a `FieldForm` field. `optional` stays, because it makes an emptied number go to the server
as null; it draws nothing.

## Do not

- Write "(Optional)", "(optional)" or "(required)" in a label or note, or add a "* Required" legend.
- Use MUI's `required`, or put the star in the label text.
- Mark the fields that hold a valid default just because they must not be emptied.
