# Settings field (label, required asterisk, help line)

**Status:** approved 2026-10-19 ("Go with asterisks everywhere", after the audit and the mockup); the asterisk moved from first to the END of the label the same day (user: "Asterics at the end - please redo"). Built on `feat/required-asterisk`
(P7.FU7, built, not accepted). Records: [audit](../required-fields-audit.md), [mockup](../optional-field-marker.html), [UX.md](../../UX.md)
§12.1. Code: `settings/settingsWidgets.tsx` (`FieldSpec`, `FieldForm`, `FieldControl`, `ListField`, `SecretField`,
`REQUIRED_SLOTS`), `settings/settings.scss` (`.jfmod-required`).

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
- Secret (`SecretField`): the labelled, unconfigured field takes the mark with its `required` prop (Prowlarr's key,
  `required={!source?.apiKeyConfigured}`); once a secret is configured the Configured box, whose label is a plain span, has no
  mark.
- A field in a row of a list (a path mapping's two prefixes) takes the class and `aria-required` directly (`REQUIRED_SLOTS`).

## When a field is required

Mark it when a new record starts with the field empty and Save, Test or Add refuses without a value, or the feature cannot work
without it. A field with a default or a value it keeps (Priority, Label, Sync every, the Automation numbers, a profile's Name),
or that may stay empty (Username, Password, Web interface link, seed goals), has no mark. A field that is shown only in some
state (Selected user, a separate seed's RPC address) is marked only while shown. In a phone dialog the field is about 248 px
wide, so a marked label should fit with its two extra characters, or the cut takes the asterisk with the end of the label; a label that fits by little (*\* Download folder as Transmission sees it*, 1 px to spare at 360 px, became "Download folder in Transmission")
is shortened rather than allowed to cut.

## Spec in code

`FieldSpec.required?: boolean` marks a `FieldForm` field. `optional` stays, because it makes an emptied number go to the server
as null; it draws nothing.

## Do not

- Write "(Optional)", "(optional)" or "(required)" in a label or note, or add a "* Required" legend.
- Use MUI's `required`, or put the star in the label text.
- Mark the fields that hold a valid default just because they must not be emptied.
