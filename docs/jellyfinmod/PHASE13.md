# Phase 13 — offline episode watches to Trakt

**Planned, not scheduled.** Outline recorded 2026-10-07. No implementation or live acceptance
has started. Read [PLAN.md](PLAN.md), [PHASE7.md](PHASE7.md) §7.1 (Trakt integration),
[README.md](README.md) and [UX.md](UX.md) alongside it. The user requested this phase;
the implementation choices below are proposals, not accepted architecture.

## Accepted user request — 2026-10-07

> Now create a new phase for development which would sync trakt in mod version for episodes watched without internet

Outcome: an episode watched while Trakt is unreachable reaches the user's linked Trakt history
after connectivity returns, with its original watch time and without duplicate plays. The mod
interface also provides a way to sync missing watches now and explains when reconnecting is needed.

## Motivation and observed recovery

On 2026-10-07, Jellyfin held watched records for Peaky Blinders S06E01–E06. Trakt already held
E01–E03; E04–E06 were missing. Jellyfin's saved Trakt authorization was expired, and the separate
PlexTraktSync connection could not refresh. After the user authorized Jellyfin again, the three
missing episodes were added and verified in Trakt with Jellyfin's recorded watch times. Trakt
returned timestamps rounded down to the minute; E01–E03 were left unchanged.

This proves the recovery workflow for that incident, not an automatic retry mechanism in the
mod. Jellyfin's latest-play field alone cannot reconstruct every earlier play or rewatch.

## Scope and boundaries

- Initial scope: Jellyfin receives the episode playback/watched event over the local network,
  but the server cannot reach Trakt. Internet loss must not block playback or local watched state.
- A device disconnected from Jellyfin entirely is different: the server cannot observe that
  watch until the client uploads it. Client-side offline playback and upload are not promised by
  this outline; confirm the desired clients and their actual replay behaviour before expanding scope.
- Preserve the watch's original UTC time. Sending after reconnection must never substitute the
  sync time. Show dates in the user's locale; account for Trakt's observed minute precision.
- Episodes only in this phase. Movie history, collection export, ratings and unwatch deletion
  are outside the requested scope.
- Keep Phase 7 Q16's incoming-history indicator and import observation separate from outgoing
  pending/synced state. An imported watch must not be exported back as a new local watch.
- No retention or download behaviour changes. Pending records retain stable provider identity
  and watch time if their Jellyfin item or file later disappears.

## Proposed behaviour

1. Record each qualifying local episode watch durably before attempting its export. Persist
   user, linked-account identity, episode provider identity, original watch time, event identity
   and delivery state in plugin SQLite. A restart or prolonged outage must not lose it.
2. Retry pending records after connectivity returns, on a bounded scheduled cadence, and through
   **Sync missing watches** for the requesting user's selected show/season. Repeated clicks join
   the same work rather than starting concurrent exports.
3. Read the correct account's paginated Trakt history before sending. For a new captured event,
   compare episode identity and normalized watch time so a genuine later rewatch is preserved.
   Reconcile ambiguous outcomes such as a timeout after Trakt accepted the request before retrying.
4. For an explicit historical catch-up, preview watched episodes missing from Trakt with their
   available Jellyfin timestamps, then submit only the selected missing records. Do not turn a
   play count into invented timestamps or manufacture rewatches from a latest-play field. Report
   records with no trustworthy timestamp or provider identity instead of guessing.
5. Distinguish pending, checking, synced, retryable failure, reconnect required and unresolved
   identity. Mark synced only after the matching Trakt record is verified. Transient failure,
   rate limiting and partial batch acceptance preserve unsent records with bounded backoff.
6. Refresh an expired token through the authorized connection. A rejected refresh pauses that
   account's exports and offers **Reconnect Trakt**; resume after user authorization. Never switch
   silently to another application's credentials or export queued watches to a newly linked account.

## Ownership and implementation gates

Phase 13 owns outgoing episode recovery and its UI. Phase 7 Q16 continues to own observations
of incoming history. The stock Trakt plugin currently owns live scrobbling and account linking;
JellyfinMod currently neither reads its credentials nor calls Trakt directly.

Before implementation, an Opus 5.5 high planning agent must refine this outline and resolve:

- Whether the installed stock plugin exposes a supported export/retry integration, or the mod
  needs its own supported Trakt connection. Verify against the pinned Jellyfin/plugin versions.
  Do not assume private credential access is an accepted extension of Phase 7.
- Exactly one coordinated writer per watch: stock live scrobbling and mod retries must not race
  into duplicate plays. If coordination requires a stock-plugin change, identify that dependency
  and obtain the design decision before implementing a competing exporter.
- Which real host events establish a completed local watch, how replayed client events are
  deduplicated, and how manual marks and imports are classified. Do not change Jellyfin's
  completion threshold. Decide whether manual marks enter the automatic queue.
- A reconciliation strategy for Trakt's minute precision, including genuine rewatches within
  one minute, accepted-but-unacknowledged writes, pagination and concurrent history changes.
- Account unlink/relink and user/library permission changes: pending data must not cross users,
  leak inaccessible titles or migrate to another Trakt account without explicit consent.

Use existing authenticated `/JellyfinMod` APIs, feature-local web components and durable plugin
storage. Credentials stay server-side and out of History, responses, logs and evidence. Publish
the final API contract in API.md during refinement. Phase 11 notifications may consume status
later but are not a dependency of this phase.

## Task outline (proposed)

| Task | Work | Verification |
| --- | --- | --- |
| O1 | Refine transport, connection and writer ownership; pin the host/plugin contracts and settle the gates above | Approved design with event and failure matrix; no unresolved duplicate writer |
| O2 | Capture qualifying local watches into a durable per-user queue with stable identity and original times | Real host playback while Trakt is unavailable; records survive restart and item removal |
| O3 | Reconcile history, export missing events and handle partial/ambiguous outcomes with bounded retries | Real HTTP/HTTPS boundary and SQLite; restored connectivity yields one matching record per event |
| O4 | Add explicit historical catch-up and reconnect flow | Preview matches local facts; existing history unchanged; rejected authorization pauses and reconnect resumes |
| O5 | Add outgoing status and actions to mod episode/show details | Desktop, mobile and TV; D-pad/Enter/Back; per-user access and incoming Q16 indicator preserved |
| O6 | Review, verify and record live acceptance | Codex GPT-6.1 Sol high review; integration/E2E, Chromium then real Chrome, isolated instance only |

## Live acceptance checklist

Run development and acceptance only on `jellyfinmod-test`, port `18096`, with dedicated fixture
media and a test Trakt account. Use an actual HTTP host, authentication, SQLite and a controlled
Trakt HTTPS boundary for deterministic failures; also verify the final path against Trakt's own
history with the authorized test account. No unit tests or production mutations.

1. Finish three episodes with Trakt unreachable. Local playback and watched state succeed;
   original watch times and identities remain queued across a server restart.
2. Restore connectivity. All three appear in Trakt at their original times, normalized only to
   the provider's demonstrated precision. Repeat sync and restart: no additional plays.
3. Seed a season with three existing watches and three missing watches. Historical catch-up
   adds only the missing three; existing timestamps and history IDs remain unchanged.
4. Watch the same episode again later. Each distinct supported watch is exported once. Exercise
   duplicate event delivery, simultaneous stock scrobbling and retry, and the same-minute case
   using the policy approved in O1.
5. Accept an export remotely but drop its response; also fail part of a batch. Recovery verifies
   accepted records before retrying and delivers the remaining ones without duplicates.
6. Exercise expired tokens, rejected refresh, reconnect, 429 and server errors. Queue survives;
   retry timing is bounded; reconnect resumes the intended account only.
7. Put relevant history beyond the first page. It is found before export. Missing provider ID
   or watch time is reported, not sent with a guessed identity or current timestamp.
8. Two users, account relink, anonymous requests and a hidden library prove isolation. Imports
   from Trakt create no outgoing watch. File/item removal does not erase pending provider identity.
9. In Chromium and real Chrome, exercise status, preview, sync and reconnect on desktop, mobile,
   TV 1920×1080 and TV 1280×720. Repeated actions remain safe; absent integration degrades cleanly.
10. Remove fixture media, test libraries and test-account watch entries created by the run;
    verify cleanup and record evidence before marking the phase accepted.

## Scheduling and release

Creating this outline authorizes planning only. No new product version starts, no version is
bumped, and the published `0.1.0.0` or `latest` image is not overwritten. Implementation starts
only when this phase is scheduled and its refinement is accepted under the workspace rules.
