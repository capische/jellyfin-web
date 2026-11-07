# Secret field (API keys, tokens and passwords)

**Status:** test a typed key before saving it, its in-field Save, the label-line key page and the words-only result: approved
by the user 2026-11-07 (mockup `reviews/ratings-settings/` in the workspace, served at
[ratings-settings](http://127.0.0.1:8770/ratings-settings/); ds.t9, gate 1, built, not accepted). Earlier parts: the write-only
box (PHASE7 §5.1), icon-only box actions (user, 2026-10-07), Save and Keep inside the field (2026-10-09), Key Page (P7.FU9,
2026-10-24). Code: `settings/settingsWidgets.tsx` (`SecretField`, `SecretHead`, `SecretInputButtons`, `TestIcon`),
`settings/settingsSections.tsx` (`useKeyTest`), `settings/settings.scss` (`.jfmod-secret*`, `.jfmod-keypage`).

## What it is

A write-only secret in the settings area, the setup wizard and the settings dialogs: an MDBList key, the TMDB read access token,
Prowlarr's API key, a manual indexer's key, the download client's and seed protection's passwords. The page never receives,
holds or logs a stored value; it only knows whether one is configured.

## Anatomy

- **Label line** (`.jfmod-secret-head`): the name at the left in the secondary text; at the right, when the secret has a page
  where it is found, a link in the links' look (`.jfmod-keypage`: primary, weight 600, underline on hover and keyboard focus)
  with a trailing `↗` (`aria-hidden`): **Get a Key ↗** (MDBList's Preferences) or **Key Page ↗** (Prowlarr's General settings,
  only while the address is an http(s) URL). New tab, `noopener`; its tooltip says where the key is ("Open MDBList's
  Preferences, where your API key is"). Shown in every state. 0.382em under the line.
- A secret with nothing stored and no key page keeps MUI's floating label instead of the line; a required one (Prowlarr's key
  before it is saved) puts the asterisk on whichever label it has ([settings-field.md](settings-field.md)).
- **The box**: the filled field's height (3.19em), its icons inside at the right end, round, at least 40 px
  ([buttons-and-row-actions.md](buttons-and-row-actions.md)).
- **Under the box**: the test's result as the settings `Notice` (dot and words), in words only: the server's sentence, never a
  raw code such as "(unauthorized)" or "(ok)".

## States

| State | Box | Icons, left to right |
| --- | --- | --- |
| Configured | lock and **Configured** | Test (when the section has a test), Replace (pencil), Clear (red bin; its tooltip says Clear) |
| No value yet | an empty field | Test and Save, refused (dimmed, focusable) until something is typed |
| Typing | the typed value, masked | Test, Save, and **Keep the Saved One** (×) when one is saved; Enter saves as Save does |
| Testing | as Typing or Configured | the Test gauge's needle sweeps |
| Passed | | the gauge turns green |
| Failed | | the gauge turns red and its needle drops |
| Pending clear | **Will be removed on save** in amber | Undo, a grey button the size of Save |

## Behaviour

- **Test checks the value in the field**, typed or saved, and never stores it. A typed key that passes starts nothing (no
  fetching, no sync); only Save stores it. For Prowlarr the test also takes the address in the form, typed or saved.
- **Save** inside the field saves the section's form with this secret (TMDB then tests the saved token, as before).
- A result belongs to the value and the revision it tested: typing again, a save or a Keep hides it.
- Typed-key wording: pass "MDBList accepted this key. Save it to start fetching ratings."; refusal "MDBList refused this key.
  Check it was copied completely." (TMDB: "TMDB refused this token. …"; Prowlarr: "Prowlarr refused this key. Copy it again
  from its General settings.", pass "Prowlarr accepted this key and has N enabled torrent indexer(s). Save it to sync with it.").
- A **password** follows the same states, with Test only where its section already has a test; the download client and
  seed protection passwords have none in the field.
- The manual indexer dialog's key has no Test (its dialog has none).

## Do not

- Show, compare or prefill a stored value, or put a secret in a URL.
- Add a separate Test button beside a secret field: the Test is the icon in the field.
