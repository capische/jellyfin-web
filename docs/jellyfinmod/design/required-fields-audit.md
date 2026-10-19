# Required Fields Audit (settings area, setup wizard, settings dialogs)

**Status:** audit of 2026-10-19; the user approved the asterisk on 2026-10-19 ("Go with asterisks everywhere") and it is built as P7.FU7 (built, not accepted); the rule now lives in [guides/settings-field.md](guides/settings-field.md). Question: replace the " (Optional)" label
suffix (cut off on phones) with an asterisk first in the label (`* Name`) on the fields that are truly required, and no
marker on the rest. Inputs: [optional-field-marker.html](optional-field-marker.html) (the earlier proposal) and
[UX.md §12.1](../UX.md) ("Optional fields say so").

**How each status was decided** (from the validation code; no live API run was needed, see *Method*):

- **REQUIRED**: a new record starts with this field empty, and Save, Test or Add refuses without a value (client or
  server), or the feature cannot work without it.
- **DEFAULTED**: it starts with a value (a client default, a preset, or the server's stored default), so the user can
  leave it. "must keep a value" means that emptying it is refused.
- **OPTIONAL**: it can stay empty and the feature still works.

Steps are the wizard's (Discovery 1, Indexers 2, Download Client 3, Quality Profile 4, Turn Grabbing On 5, Optional 6);
the settings area shows the same sections plus Import and Seeding and Missing Episodes.

## 1. Every editable field

| # | Location | Label today | "(Optional)" today | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | Step 1 / Discovery | TMDB API Read Access Token (Optional) | yes (by hand) | OPTIONAL | No token means Jellyfin's TMDb connection is used; an unchanged token is accepted. [settingsSections.tsx:672](../../../src/apps/modern/features/jellyfinmod/settings/settingsSections.tsx:672), [SettingsController.cs:56](../../../../plugin-nextrelease/JellyfinMod/Api/SettingsController.cs:56) |
| 2 | Step 2 / Indexers, Prowlarr card | Name | no | DEFAULTED, must keep a value | Starts as "Prowlarr"; empty is `invalid_name`. [settingsSections.tsx:1036](../../../src/apps/modern/features/jellyfinmod/settings/settingsSections.tsx:1036), [ProwlarrController.cs:241](../../../../plugin-nextrelease/JellyfinMod/Api/ProwlarrController.cs:241) |
| 3 | Step 2 / Prowlarr card | Prowlarr address | no | **REQUIRED** | Starts empty; must be an http(s) URL, else `invalid_prowlarr_url`. [ProwlarrController.cs:242](../../../../plugin-nextrelease/JellyfinMod/Api/ProwlarrController.cs:242) |
| 4 | Step 2 / Prowlarr card | Sync every (minutes) | no | DEFAULTED, must keep a value | Starts at 360; range 15–10080; empty sends null to an `int`. [AcquisitionSettingsContracts.cs:391](../../../../plugin-nextrelease/JellyfinMod/Api/Contracts/AcquisitionSettingsContracts.cs:391) |
| 5 | Step 2 / Prowlarr card | Sync on a schedule (switch) | no | DEFAULTED | On by default. [settingsSections.tsx:1036](../../../src/apps/modern/features/jellyfinmod/settings/settingsSections.tsx:1036) |
| 6 | Step 2 / Prowlarr card | API key (secret) | no | **REQUIRED** to add a source | Add Prowlarr without a key is `invalid_secret_change`; once configured it can be left as it is. [ProwlarrController.cs:246](../../../../plugin-nextrelease/JellyfinMod/Api/ProwlarrController.cs:246) |
| 7 | Step 2 / Add or Edit Indexer dialog | Name | no | **REQUIRED** | `invalid_name`. [AcquisitionSettingsController.cs:521](../../../../plugin-nextrelease/JellyfinMod/Api/AcquisitionSettingsController.cs:521) |
| 8 | Indexer dialog | Torznab address | no | **REQUIRED** | `invalid_indexer_url`. [AcquisitionSettingsController.cs:522](../../../../plugin-nextrelease/JellyfinMod/Api/AcquisitionSettingsController.cs:522) |
| 9 | Indexer dialog | Categories | no | DEFAULTED | Starts as 2000, 5000; an empty list is accepted and the search then sends no category. [settingsSections.tsx:941](../../../src/apps/modern/features/jellyfinmod/settings/settingsSections.tsx:941), [ReleaseSearchService.cs:342](../../../../plugin-nextrelease/JellyfinMod/Services/Acquisition/ReleaseSearchService.cs:342) |
| 10 | Indexer dialog | Priority (lower first) | no | DEFAULTED, must keep a value | Starts at 25; range 0–1000; empty sends null to an `int` (400). [AcquisitionSettingsContracts.cs:85](../../../../plugin-nextrelease/JellyfinMod/Api/Contracts/AcquisitionSettingsContracts.cs:85) |
| 11 | Indexer dialog | Extra download hosts | yes | OPTIONAL | Empty list accepted. [AcquisitionSettingsController.cs:524](../../../../plugin-nextrelease/JellyfinMod/Api/AcquisitionSettingsController.cs:524) |
| 12 | Indexer dialog | Minimum seed ratio | yes | OPTIONAL | Nullable, stored as given. [AcquisitionSettingsController.cs:581](../../../../plugin-nextrelease/JellyfinMod/Api/AcquisitionSettingsController.cs:581) |
| 13 | Indexer dialog | Minimum seeding minutes | yes | OPTIONAL | Nullable. [AcquisitionSettingsController.cs:582](../../../../plugin-nextrelease/JellyfinMod/Api/AcquisitionSettingsController.cs:582) |
| 14 | Indexer dialog | Seconds between searches | yes | DEFAULTED | Server default 10; empty sends null, which **keeps the saved value** rather than clearing it. [AcquisitionSettingsController.cs:583](../../../../plugin-nextrelease/JellyfinMod/Api/AcquisitionSettingsController.cs:583), [Acquisition.cs:59](../../../../plugin-nextrelease/JellyfinMod/Data/Acquisition.cs:59) |
| 15 | Indexer dialog | Searches per day | yes | DEFAULTED | Server default 200; empty keeps the saved value. [AcquisitionSettingsController.cs:584](../../../../plugin-nextrelease/JellyfinMod/Api/AcquisitionSettingsController.cs:584), [Acquisition.cs:62](../../../../plugin-nextrelease/JellyfinMod/Data/Acquisition.cs:62) |
| 16 | Indexer dialog | Search this indexer (switch) | no | DEFAULTED | On. [settingsSections.tsx:941](../../../src/apps/modern/features/jellyfinmod/settings/settingsSections.tsx:941) |
| 17 | Indexer dialog | Let automation grab title-and-year matches from it (switch) | no | DEFAULTED | Off. Same line. |
| 18 | Indexer dialog | API key (secret) | no | OPTIONAL | An unchanged (empty) key is accepted on create; no `apikey` is sent when none is stored. [AcquisitionSettingsController.cs:511](../../../../plugin-nextrelease/JellyfinMod/Api/AcquisitionSettingsController.cs:511), [TorznabClient.cs:208](../../../../plugin-nextrelease/JellyfinMod/Services/Acquisition/TorznabClient.cs:208) |
| 19 | Step 3 / Download Client | Name | no | **REQUIRED** | The new-client form has no name; `invalid_name`. [settingsSections.tsx:727](../../../src/apps/modern/features/jellyfinmod/settings/settingsSections.tsx:727), [AcquisitionSettingsController.cs:533](../../../../plugin-nextrelease/JellyfinMod/Api/AcquisitionSettingsController.cs:533) |
| 20 | Download Client | Transmission RPC address | no | **REQUIRED** | `invalid_client_url`. [AcquisitionSettingsController.cs:535](../../../../plugin-nextrelease/JellyfinMod/Api/AcquisitionSettingsController.cs:535) |
| 21 | Download Client | Username | no | OPTIONAL | Not required on the server; the runner saves a client with it blank (201). [AcquisitionSettingsContracts.cs:153](../../../../plugin-nextrelease/JellyfinMod/Api/Contracts/AcquisitionSettingsContracts.cs:153), [s11-fresh.mjs:234](../../../scripts/jellyfinmod-e2e/s11-fresh.mjs:234) |
| 22 | Download Client | Label added to every grab | no | DEFAULTED, must keep a value | Starts as "jellyfinmod"; must match `^[A-Za-z0-9._-]{1,64}$`. [settingsSections.tsx:727](../../../src/apps/modern/features/jellyfinmod/settings/settingsSections.tsx:727), [AcquisitionSettingsController.cs:536](../../../../plugin-nextrelease/JellyfinMod/Api/AcquisitionSettingsController.cs:536) |
| 23 | Download Client | Download folder in Transmission | no | **REQUIRED** | Absolute path, else `invalid_download_directory`. [AcquisitionSettingsController.cs:538](../../../../plugin-nextrelease/JellyfinMod/Api/AcquisitionSettingsController.cs:538) |
| 24 | Download Client | The same folder as this server sees it | no | **REQUIRED** | Absolute path, and on the libraries' filesystem. [AcquisitionSettingsController.cs:538](../../../../plugin-nextrelease/JellyfinMod/Api/AcquisitionSettingsController.cs:538), [AcquisitionSettingsController.cs:171](../../../../plugin-nextrelease/JellyfinMod/Api/AcquisitionSettingsController.cs:171) |
| 25 | Download Client | Web interface link | yes | OPTIONAL | Empty is stored as null and built from the RPC address. [AcquisitionSettingsController.cs:539](../../../../plugin-nextrelease/JellyfinMod/Api/AcquisitionSettingsController.cs:539) |
| 26 | Download Client | Send grabs to this client (switch) | no | DEFAULTED | On. [settingsSections.tsx:727](../../../src/apps/modern/features/jellyfinmod/settings/settingsSections.tsx:727) |
| 27 | Download Client | Password (secret) | no | OPTIONAL | No password is stored when it is left empty (Transmission with authentication off). [AcquisitionSettingsController.cs:175](../../../../plugin-nextrelease/JellyfinMod/Api/AcquisitionSettingsController.cs:175), [s11-fresh.mjs:234](../../../scripts/jellyfinmod-e2e/s11-fresh.mjs:234) |
| 28 | Download Client, Path Mappings row | Transmission path | no | **REQUIRED** in a row | A row needs both prefixes as absolute paths, else `invalid_mapping`. [QueueContracts.cs:218](../../../../plugin-nextrelease/JellyfinMod/Api/Contracts/QueueContracts.cs:218), [ImportPathProbe.cs:27](../../../../plugin-nextrelease/JellyfinMod/Services/Import/ImportPathProbe.cs:27) |
| 29 | Path Mappings row | Local path | no | **REQUIRED** in a row | Same check. |
| 30 | Path Mappings | A path as Transmission reports it | no | **REQUIRED** to run its test | Test Import Path is disabled while it is empty; a test input, not a stored setting. [settingsSections.tsx:907](../../../src/apps/modern/features/jellyfinmod/settings/settingsSections.tsx:907) |
| 31 | Step 4 / Add or Edit Quality Profile dialog | Predefined (picker) | no | DEFAULTED | Starts on the default preset. [qualityProfiles.tsx:235](../../../src/apps/modern/features/jellyfinmod/settings/qualityProfiles.tsx:235) |
| 32 | Profile dialog | Name | no | DEFAULTED, must keep a value | Filled with the preset's name; emptied, Save is disabled with "Give the profile a name.". [qualityProfiles.tsx:238](../../../src/apps/modern/features/jellyfinmod/settings/qualityProfiles.tsx:238), [qualityProfiles.tsx:138](../../../src/apps/modern/features/jellyfinmod/settings/qualityProfiles.tsx:138) |
| 33 | Profile dialog | Best quality I want (segments) | no | DEFAULTED | From the preset. |
| 34 | Profile dialog | Fall back to lower quality … down to (checkbox and select) | no | DEFAULTED | From the preset. |
| 35 | Profile dialog | File size (segments) | no | DEFAULTED | From the preset. |
| 36 | Profile dialog | Upgrade later when something better appears (checkbox) | no | DEFAULTED | From the preset. |
| 37 | Profile dialog, Advanced | Allowed qualities matrix | no | DEFAULTED, must keep one | Save disabled with none; `invalid_qualities`. [qualityProfiles.tsx:139](../../../src/apps/modern/features/jellyfinmod/settings/qualityProfiles.tsx:139), [AcquisitionSettingsController.cs:547](../../../../plugin-nextrelease/JellyfinMod/Api/AcquisitionSettingsController.cs:547) |
| 38 | Profile dialog, Advanced | Upgrade until (cutoff) | yes | OPTIONAL while upgrades are off | Needed when Upgrade later is on, but turning that on fills it with the first quality and the list has no empty choice. [qualityProfiles.tsx:290](../../../src/apps/modern/features/jellyfinmod/settings/qualityProfiles.tsx:290), [AcquisitionSettingsController.cs:552](../../../../plugin-nextrelease/JellyfinMod/Api/AcquisitionSettingsController.cs:552) |
| 39 | Profile dialog, Advanced | An upgrade (select) | no | DEFAULTED | "replace"; anything but replace or add is refused. [AcquisitionSettingsController.cs:554](../../../../plugin-nextrelease/JellyfinMod/Api/AcquisitionSettingsController.cs:554) |
| 40 | Profile dialog, Advanced | Minimum score for automatic grabs | yes | OPTIONAL | Nullable. [AcquisitionSettingsController.cs:612](../../../../plugin-nextrelease/JellyfinMod/Api/AcquisitionSettingsController.cs:612) |
| 41 | Profile dialog, Advanced | Minimum seeders | yes | OPTIONAL | Nullable (presets set 2). [AcquisitionSettingsController.cs:613](../../../../plugin-nextrelease/JellyfinMod/Api/AcquisitionSettingsController.cs:613) |
| 42 | Profile dialog, Advanced | Smallest file, GB per hour of runtime | yes | OPTIONAL | Nullable; only refused above the largest. [qualityProfiles.tsx:144](../../../src/apps/modern/features/jellyfinmod/settings/qualityProfiles.tsx:144) |
| 43 | Profile dialog, Advanced | Largest file, GB per hour of runtime | yes | OPTIONAL | Nullable (Large means none). Same line. |
| 44 | Profile dialog, Advanced | Change the order tried (rows) | no | DEFAULTED | Follows the matrix. |
| 45 | Step 5 / Grabbing | Allow grabs (switch) | no | DEFAULTED | Off; turning it on is refused until every step is ready. [AcquisitionSettingsController.cs:449](../../../../plugin-nextrelease/JellyfinMod/Api/AcquisitionSettingsController.cs:449) |
| 46 | Grabbing | Download client (select) | no | DEFAULTED | The first client saved is selected automatically; grabbing needs one (`no_download_client`). [AcquisitionSettingsController.cs:181](../../../../plugin-nextrelease/JellyfinMod/Api/AcquisitionSettingsController.cs:181) |
| 47 | Grabbing | Default quality profile (select) | no | DEFAULTED | A fresh install seeds the presets and makes 4K the default; grabbing needs one (`no_default_profile`). [QualityPresets.cs:51](../../../../plugin-nextrelease/JellyfinMod/Services/Acquisition/QualityPresets.cs:51) |
| 48 | Step 6 / Retention | Delete media files after they are watched (switch) | no | DEFAULTED | Off. |
| 49 | Retention | Days to keep a file after it is finished | no | DEFAULTED, must keep a value | 1–3650, else `invalid_reclaim_days`. [SettingsController.cs:220](../../../../plugin-nextrelease/JellyfinMod/Api/SettingsController.cs:220) |
| 50 | Retention | Start the window when (select) | no | DEFAULTED | One of three modes. [SettingsController.cs:221](../../../../plugin-nextrelease/JellyfinMod/Api/SettingsController.cs:221) |
| 51 | Retention, only with "A selected user" | Selected user (select) | no | **REQUIRED** while shown | Empty or unknown is `invalid_selected_user`. [SettingsController.cs:223](../../../../plugin-nextrelease/JellyfinMod/Api/SettingsController.cs:223) |
| 52 | Retention | Never reclaim favourites (switch) | no | DEFAULTED | |
| 53 | Retention, Seed Protection | Read seeding state from (select) | no | DEFAULTED | The download client. [SettingsController.cs:128](../../../../plugin-nextrelease/JellyfinMod/Api/SettingsController.cs:128) |
| 54 | Seed Protection, only with "A separate Transmission" | Transmission RPC address | no | **REQUIRED** while shown | `invalid_rpc_url`. [SettingsController.cs:131](../../../../plugin-nextrelease/JellyfinMod/Api/SettingsController.cs:131) |
| 55 | Seed Protection, separate | Username | no | OPTIONAL | Null becomes empty. [SettingsController.cs:133](../../../../plugin-nextrelease/JellyfinMod/Api/SettingsController.cs:133) |
| 56 | Seed Protection, separate | Password (secret) | no | OPTIONAL | Unchanged accepted. [SettingsController.cs:130](../../../../plugin-nextrelease/JellyfinMod/Api/SettingsController.cs:130) |
| 57 | Step 6 / Automation | Search and grab on a schedule (switch) | no | DEFAULTED | Off. |
| 58 | Automation | Run every (hours) | no | DEFAULTED, must keep a value | 6, range 1–168, `int`. [AutomationContracts.cs:112](../../../../plugin-nextrelease/JellyfinMod/Api/Contracts/AutomationContracts.cs:112) |
| 59 | Automation | Titles per run | no | DEFAULTED, must keep a value | 40. [AutomationContracts.cs:115](../../../../plugin-nextrelease/JellyfinMod/Api/Contracts/AutomationContracts.cs:115) |
| 60 | Automation | Wait after an episode airs (minutes) | no | DEFAULTED, must keep a value | 120. [AutomationContracts.cs:118](../../../../plugin-nextrelease/JellyfinMod/Api/Contracts/AutomationContracts.cs:118) |
| 61 | Automation | Automatic grabs per day | no | DEFAULTED, must keep a value | 6. [AutomationContracts.cs:121](../../../../plugin-nextrelease/JellyfinMod/Api/Contracts/AutomationContracts.cs:121) |
| 62 | Automation | Stop grabbing while this many imports are open | no | DEFAULTED, must keep a value | 3. [AutomationContracts.cs:124](../../../../plugin-nextrelease/JellyfinMod/Api/Contracts/AutomationContracts.cs:124) |
| 63 | Automation | Keep this much of the library disk free (%) | no | DEFAULTED, must keep a value | 10. [AutomationContracts.cs:127](../../../../plugin-nextrelease/JellyfinMod/Api/Contracts/AutomationContracts.cs:127) |
| 64 | Automation | And at least (bytes) | no | DEFAULTED, must keep a value | 25 GB. [AutomationContracts.cs:130](../../../../plugin-nextrelease/JellyfinMod/Api/Contracts/AutomationContracts.cs:130) |
| 65 | Automation | Decisions kept | no | DEFAULTED, must keep a value | 2000, range 100–100000. [AutomationContracts.cs:133](../../../../plugin-nextrelease/JellyfinMod/Api/Contracts/AutomationContracts.cs:133) |
| 66 | Automation | Upgrade episodes too (switch) | no | DEFAULTED | |
| 67 | Automation | Grab reclaimed titles again (switch) | no | DEFAULTED | |
| 68 | Step 6 / Interface | Serve this interface at /web (switch) | no | DEFAULTED | |
| 69 | Settings only / Import and Seeding | Import completed downloads (switch) | no | DEFAULTED | On. |
| 70 | Import and Seeding | Release the torrent from the client once its seed goals are met (switch) | no | DEFAULTED | |
| 71 | Import and Seeding | Seed at least to ratio | yes | OPTIONAL | Empty or 0 is stored as none. [ImportSettingsController.cs:56](../../../../plugin-nextrelease/JellyfinMod/Api/ImportSettingsController.cs:56) |
| 72 | Import and Seeding | Or for hours | yes | OPTIONAL | Same. [ImportSettingsController.cs:57](../../../../plugin-nextrelease/JellyfinMod/Api/ImportSettingsController.cs:57) |
| 73 | Import and Seeding | Check the client every (seconds) | no | DEFAULTED, must keep a value | 15, range 1–3600. [QueueContracts.cs:186](../../../../plugin-nextrelease/JellyfinMod/Api/Contracts/QueueContracts.cs:186) |
| 74 | Import and Seeding | Video file extensions | no | DEFAULTED, must keep one | An empty list is `invalid_video_extensions`. [ImportSettingsController.cs:43](../../../../plugin-nextrelease/JellyfinMod/Api/ImportSettingsController.cs:43) |
| 75 | Import and Seeding | Show a download as stalled after (hours) | no | DEFAULTED, must keep a value | 24. [QueueContracts.cs:192](../../../../plugin-nextrelease/JellyfinMod/Api/Contracts/QueueContracts.cs:192) |
| 76 | Import and Seeding | Ask for a library scan again after (minutes) | no | DEFAULTED, must keep a value | 10. [QueueContracts.cs:195](../../../../plugin-nextrelease/JellyfinMod/Api/Contracts/QueueContracts.cs:195) |
| 77 | Import and Seeding | Show the queue to every user with library access (switch) | no | DEFAULTED | |
| 78 | Settings only / Missing Episodes | Show missing episodes (or movies) as Jellyfin items (switch, per library) | no | DEFAULTED | |

Not counted: the settings page's *Section* picker (navigation), Overview and Diagnostics (no inputs), and the *Found in
Prowlarr* buttons (they fill fields and save nothing).

## 2. Counts

| Status | All 78 controls | The 55 labelled inputs (text, number, select, secret; no switches or segments; no test input) |
| --- | --- | --- |
| REQUIRED | 13 (12 settings + the import-path test input) | **12 (22 %)** |
| DEFAULTED | 48 (19 of them "must keep a value") | 26 |
| OPTIONAL | 17 | 17 |

Of the 12, two are conditional (Selected user, the separate seed RPC address), one only when adding (the Prowlarr key) and
two only inside a path-mapping row.

## 3. Where today's marker and the real status disagree

- **Marked "(Optional)" but not optional in the plain sense**: *Seconds between searches* and *Searches per day* (#14,
  #15) are defaults (10, 200), and emptying either keeps the saved value instead of clearing it. *Upgrade until
  (cutoff)* (#38) is needed whenever upgrades are on; the dialog fills it automatically, so the user never meets an
  empty one.
- **Optional but not marked**: client *Username* and *Password* (#21, #27), indexer *API key* (#18), and the separate
  seed *Username* and *Password* (#55, #56). Under today's rule they should say "(Optional)" and do not; under the new
  rule (no marker on non-required fields) they are right as they are.
- **Required and unmarked**: all 13 REQUIRED fields. That is consistent today; the new rule would mark them.

## 4. Labels cut on a 360 px phone

Measured in Playwright Chromium with Noto Sans at the phone's 14.4 px (root 90 %), against MUI 6.5's filled label, which is
one line with an ellipsis: room is the field width minus 24 px while the field is empty, and 1.33 times the width minus
24 px once it holds a value (the label shrinks to 75 %). A wizard or settings card field is about 307 px wide (3.3 % page
padding, 1 em card padding), so the label has 283 px empty and 385 px filled; a dialog field is about 248 px wide (MUI's 32 px
margin and 24 px padding), so 224 px empty and 306 px filled. Expect a few px either way.

- **REQUIRED fields with "* " added: none is cut.** The tightest was *\* Download folder as Transmission sees it* at 282 px of 283, so on 2026-10-19 the user had it shortened to "Download folder in Transmission". The rest have room: *\* The same folder as this server sees it* 261/283,
  *\* Transmission RPC address* 188/283, *\* Torznab address* 123/224.
- **Cut today because of "(Optional)"**, fixed by removing it: *Minimum seeding minutes* (252/224 empty), *Seconds between
  searches* (253/224 empty), and the TMDB token (it fits by width but runs under the field's Save icon; see the earlier
  mockup).
- **Cut while empty even with no marker** (a separate issue, not caused by the marker and not fixed by this change):
  *Minimum score for automatic grabs* (243/224), *Smallest file, GB per hour of runtime* (247/224), *Largest file, GB per
  hour of runtime* (240/224) in the profile dialog's Advanced, which are often empty; and *Stop grabbing while this many
  imports are open* (326/283) and *Ask for a library scan again after (minutes)* (286/283), which always hold a value, so
  their label is shrunk and fits.

## 5. Recommendation

Put the asterisk first on exactly the **12 REQUIRED settings fields**, about one labelled input in five, so it is a small
minority: Prowlarr address and API key (only while no key is saved), the indexer's Name and Torznab address, the download
client's Name, Transmission RPC address and both folders, a path mapping's two prefixes, and the conditional Selected user
and separate seed RPC address (only while they are shown). Drop " (Optional)" everywhere, including the TMDB token's
hand-written one; its note already says "Leave empty to use Jellyfin's built-in TMDb connection". Leave the import-path
test input unmarked: its button is greyed out until something is typed.

What this loses: the "must keep a value" defaults (Priority, Label, Prowlarr's Name, the profile's Name, the numbers in
Automation and Import) carry no asterisk, so a user who empties one learns it from the Save error rather than from the
label. They already hold a valid value, so this is rare.

No legend ("* Required"): the asterisk is the common convention, and screen readers hear "required" from
`aria-required`. One can be added later if the user wants it.

## 6. Change surface (for the build, after approval)

- `settingsWidgets.tsx`: `FieldSpec` gets `required?: boolean`. `FieldForm` stops appending " (Optional)"
  ([settingsWidgets.tsx:429](../../../src/apps/modern/features/jellyfinmod/settings/settingsWidgets.tsx:429)). `optional`
  stays, because `FieldControl` uses it to send null for an emptied number
  ([settingsWidgets.tsx:383](../../../src/apps/modern/features/jellyfinmod/settings/settingsWidgets.tsx:383)). For a
  `required` field, `FieldControl` and `ListField` pass `slotProps.inputLabel.className: 'jfmod-required'` and
  `slotProps.htmlInput['aria-required']: true`. `SecretField` gets a `required` prop for its labelled, unconfigured state
  ([settingsWidgets.tsx:281](../../../src/apps/modern/features/jellyfinmod/settings/settingsWidgets.tsx:281)), used by
  Prowlarr's key as `required={!source?.apiKeyConfigured}`.
- **Asterisk first, not MUI's `required`.** MUI's `required` draws " \*" after the label, as an `aria-hidden` span. Both
  that span and any DOM text break the runners. Tested in Playwright 1.63: with `Name<span aria-hidden="true"> *</span>`,
  `getByLabel('Name', { exact: true })` finds nothing, while a CSS `::before` asterisk keeps the match. About 39 runner
  lines match required fields by exact label (`s11-fresh.mjs` 25, `prowlarr-first.mjs` 6, `settings-changes.mjs` 3,
  `whole-review-web.mjs` 5). So draw it in `settings.scss` as `.jfmod-required::before { content: "* "; content: "* " / ""; }`.
  The second declaration keeps it out of the accessible name (Chrome otherwise reads "star Name"); an older webOS
  browser that does not know the `/ ""` form keeps the first. It takes the label's own colour and scales with the label.
- Field lists: add `required: true` in [settingsSections.tsx](../../../src/apps/modern/features/jellyfinmod/settings/settingsSections.tsx)
  for the client (lines 878–883), indexer (959–960), Prowlarr (1089), Selected user (1501) and seed RPC address (1518).
  The two `MappingRow` TextFields (696–700) get the class and `aria-required` directly. Change the TMDB label at line 672 to
  "TMDB API Read Access Token".
- Runners that depend on "(Optional)":
  [s11-fresh.mjs:962](../../../scripts/jellyfinmod-e2e/s11-fresh.mjs:962) and line 963 (*Seconds between searches*,
  *Searches per day*) and [whole-review-web.mjs:1924](../../../scripts/jellyfinmod-e2e/whole-review-web.mjs:1924)
  (*Minimum seeders*) lose the suffix. [s11-fresh.mjs:378](../../../scripts/jellyfinmod-e2e/s11-fresh.mjs:378), 385 and
  953 ask for "Upgrade until (Optional)" and an "Add a quality" list. Both are already stale since the P4.FU9 profile
  dialog (the label is "Upgrade until (cutoff)" and the list is now the matrix), so they need a fix of their own;
  it is listed here and not widened into this change.
- `UX.md` §12.1: the "Optional fields say so (user, 2026-10-15)" bullet and the TMDB bullet's "(Optional)" wording are
  replaced by the new rule.
- Guides: a new `guides/settings-field.md` covering the filled, dense field; its one-line label; the required asterisk first
  (class `jfmod-required`, `::before` with empty alt text, label colour, `aria-required`); when a field is required (the
  rule in this note, and conditional fields marked only while shown); no "(Optional)"; the help line under the field; and
  secrets. Plus a README row: `| [settings-field.md](settings-field.md) | a settings field's label, the required asterisk and
  the help line | settings area, setup wizard, settings dialogs |`.

## Method

Every field comes from reading `settingsSections.tsx`, `qualityProfiles.tsx`, `settingsWidgets.tsx` and `SetupWizardPage.tsx`
on `next-release`, and the plugin's request contracts and validators on `next-release`
(`AcquisitionSettingsController`, `ProwlarrController`, `SettingsController`, `ImportSettingsController`, the contracts and
entity defaults). The code was conclusive, and the passing `s11-fresh` runner shows that a blank username and password
save. So no local environment was leased and no API was called. An emptied number reaching an `int` property is reasoned,
not exercised: the form sends `parseInt('')`, which serialises as null, and System.Text.Json refuses null for an `int`.
The label widths and the Playwright label-matching behaviour were measured on a static page in headless Chromium, with no
instance involved.
