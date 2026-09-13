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

`scripts/jellyfinmod-browser-review.mjs` drives a dedicated Chromium debugging session against
an actual built app and running Jellyfin. It never synthesizes successful API responses. Its
failed-add case blocks the actual transport; it does not create or delete catalog entries.

Prerequisites:

- A dedicated Chromium profile with remote debugging enabled on port 9223.
- The isolated server on port 18096 with the review plugin and web builds deployed.
- Sign-in as `oleksii` with an empty password; the script handles the manual login form.
- A catalog entry bound to a native series with at least one native season.
- A TMDB query with an unheld result and a library accepting additions.

Run with environment variables (no credentials belong in the command):

```sh
JELLYFINMOD_TEST_URL="$test_url" \
JELLYFINMOD_NATIVE_ENTRY_ID="$bound_series_entry_id" \
JELLYFINMOD_SEARCH_QUERY=blade \
node scripts/jellyfinmod-browser-review.mjs
```

The script checks native bookmark routing, season navigation presence, History and the More
menu in desktop, mobile, 1920×1080 TV and 1280×720 TV layouts. It also checks failed-add keyboard
focus and switching to a different search query. It restores the browser's layout setting and
closes its tab. These TV layouts do not establish physical-device compatibility.

Additional live acceptance remains necessary:

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

The final review web build and TypeScript passed. Scoped lint passed with only existing legacy
controller warnings; webpack reported its asset/entrypoint size warnings. The browser runner has passed syntax checking
only; it has not passed live acceptance. The Pi refused SSH and test-page connections during
this review pass, so no review build was deployed and production was not changed.

Plugin review fixes and their integration results are recorded in the plugin repository commits.
Phase 2 R4/R5 and their acceptance remain separate from remediation of R1–R3.
