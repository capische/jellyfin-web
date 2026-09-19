# Phase 1 and 2 review follow-up

The review fixes are not a new phase-completion claim. Final acceptance requires the combined
plugin and built web bundle on the isolated Jellyfin instance. Production is not a test target.

## Web review fixes

- **W1/W5 native details:** bound cards retain native item links and TV actions. Saved entry
  links redirect to the bound native item. Catalog History augments the native metadata area;
  Search releases appears in the native More menu. Seasons, episodes and playback stay native.
- **W4 search state:** each server/user/library/query owns its pending additions. Repeated adds
  are guarded while a request is in flight; canonical results retire optimistic rows. An old
  request cannot restore focus in a new search. Failed adds return focus to Add.
- **W4 pagination:** discovery loads the next page when an entire page is excluded, and offers
  continuation controls after visible results. Movie and series pagination are independent.
- **W6 Home:** catalog queries use the same included libraries as native Latest feeds. Provider
  identities deduplicate copies across those libraries; the newest native copy wins.

## Repeatable browser checks

`scripts/jellyfinmod-e2e/browser-review.mjs` uses Playwright to drive a dedicated Chrome against
an actual built app and running Jellyfin. It never synthesizes successful API responses. Its
failed-add case blocks the actual transport; it does not create or delete catalog entries.

The runner is a self-contained package with its own lockfile and ignored `node_modules`, so the
app's dependencies stay untouched. It depends on `playwright-core` only and never downloads or
launches a browser; it attaches over CDP and opens a fresh tab in the signed-in profile.
`scripts/jellyfinmod-browser-review.mjs` forwards to it.

Prerequisites:

- Node 22 or newer, and `npm ci --prefix scripts/jellyfinmod-e2e` once.
- A dedicated Chrome profile with remote debugging enabled, by default on port 9223
  (`JELLYFINMOD_CDP_URL` overrides it).
- The isolated server on port 18096 with the review plugin and web builds deployed.
- Sign-in as `oleksii` with an empty password; the script handles the manual login form.
- A catalog entry bound to a native series with at least one native season.
- A TMDB query with an unheld result and a library accepting additions.

Run with environment variables (no credentials belong in the command):

```sh
JELLYFINMOD_TEST_URL="$test_url" \
JELLYFINMOD_NATIVE_ENTRY_ID="$bound_series_entry_id" \
JELLYFINMOD_LIBRARY_ID="$browser_test_library_id" \
JELLYFINMOD_SEARCH_QUERY=blade \
node scripts/jellyfinmod-e2e/browser-review.mjs
```

Retention and playback gates need `JELLYFINMOD_EXPECT_NORMAL_COUNTDOWN`,
`JELLYFINMOD_EXPECT_FILTER_COUNTDOWN`, `JELLYFINMOD_EXPECT_DUE_CARDS`,
`JELLYFINMOD_RETENTION_ENTRY_TITLE`, `JELLYFINMOD_RECLAIMED_ENTRY_ID` and
`JELLYFINMOD_NATIVE_PLAYBACK_ITEM_ID`. A run that skips any gate exits 2 unless
`JELLYFINMOD_ALLOW_SKIPS=true`; a failed check exits 1.

Each step prints its wall-clock duration as it finishes (`passed <step> (12.3s)`). The final JSON
has `timings` (step to seconds, plus `total`), `waits` (aggregated hard reloads, soft reloads,
networkIdle quiet waits, TMDB-backed discovery waits and fixture seeding/cleanup; these kinds
overlap) and `idleTimeouts` (requests still pending when a quiet wait timed out, by path only).
A failed run prints the partial timings to stderr.

`JELLYFINMOD_QUICK=true` runs a post-deploy smoke subset: native details and Keep by keyboard in
all four layouts, the retention countdown and Due filter, the reclaimed and native playback gates,
plugin transport outage, Home resume, the plugin-ID leak check and search scope, with a single
cache-bypassing reload. It skips the TMDB- and fixture-heavy checks (failed and in-flight Add, the
seeded empty discovery page, Home library exclusion) and lists them as `skippedByQuickMode`. Its
summary says `mode: "quick"` and `fullAcceptance: false`; it never replaces a full run. Failures
exit 1 and skipped gates exit 2, as in a full run.

The script checks native bookmark routing, season navigation presence, History and the More
menu in desktop, mobile, 1920×1080 TV and 1280×720 TV layouts. It also checks failed-add focus,
duplicate activation and switching to a different search query. It restores the browser's
layout and Latest-items settings, removes every fixture confirmed created by the run, and closes
its tab. These TV layouts do not establish physical-device compatibility.

The runner now performs the following live acceptance:

1. Hold a successful Add request in flight, change the query and library, then release it.
   Verify the old title never appears in the new scope, the current focus remains stable, and
   returning to the original query shows one canonical title. Rapid repeated activation must
   produce only one Add request. Remove only entries confirmed created by this test.
2. Seed all titles on the first remote discovery page as held entries. Search in the built app;
   verify it requests page two without user intervention and displays unheld results. Exercise
   the continuation button and verify no repeated titles or lost focus.
3. Exclude a library from the user's Latest items, with a recently added file-less title in it.
   Verify that title is absent from Home, then restore the original user configuration.
4. Use two included libraries containing the same provider title with distinct native IDs.
   Verify one Recently Added card, bound to the newest copy, while distinct provider titles
   remain separate. Check a file-less copy against an owned copy as well.
5. Remove plugin access or fail its transport and verify native details/search remain usable.
   Exercise Enter, arrows and Back on TV, followed by physical-device acceptance.

## Validation record

On 2026-09-18 the final review bundle passed TypeScript, scoped feature lint and the production
webpack build; webpack reported its existing asset/entrypoint size warnings. The browser runner
passed every live item above against the isolated Pi instance on port 18096. Native detail/search
remained usable with plugin transport blocked; cached detail augmentation may remain visible
until its query expires. Production was not changed. Physical webOS acceptance remains separate.

Plugin review fixes and their integration results are recorded in the plugin repository commits.
Phase 2 R4/R5 and their acceptance remain separate from remediation of R1–R3.
