# Phase 13 — offline episode watches to Trakt

**Built (not accepted), 2026-10-28.** Outline recorded 2026-10-07; refined and built 2026-10-28 (see *Refinement and
build* below, which supersedes the outline's proposed behaviour and task list where they differ). Read [PLAN.md](PLAN.md), [PHASE7.md](PHASE7.md) §7.1 (Trakt integration),
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

## Refinement and build (2026-10-28)

Planned by an Opus 5.5 high agent (`reviews/phase13/PLAN.md` in the workspace, with the mockups); the six questions were
answered by the coordinator under the user's overnight instruction (workspace `reviews/overnight-2026-10-28/DECISIONS.md`
D16–D21): Q1 (a) the stock Trakt plugin stays the only writer and JellyfinMod schedules its export; Q2 (a) JellyfinMod
reads the plugin's per-user link state read-only (whether a token is present, never its value; its expiry; three
switches); Q3 (a) automatic sending off by default, Sync Now either way; Q4 (a) the collection side effect stays as the
user configured it and is said on the account row; Q5 (b) Settings › Trakt plus an administrator's Home notice; Q6 (a)
both lines the same, a Trakt plugin older than 33 explained with no automatic run and no Sync Now.

**What the stock plugin does (source at v33).** It scrobbles on `PlaybackStopped` and drops a failure, so a watch that
ends while Trakt is unreachable is lost. Its "Export library to trakt.tv" task (`TraktSyncLibraryTask`, no default trigger)
sends each episode played in Jellyfin that has no play on Trakt, with Jellyfin's `LastPlayedDate`; it never adds a second
play. Before a request it refreshes an expired token after blanking it in memory; a failed refresh (rejected, or no internet
at that moment) leaves the user without a token, and every path then skips that user until it is authorized again: the
2026-10-07 incident. v33 needs Jellyfin 12.1+: the items line (12.2) runs it, the stubs line (12.0) has 31/32.

**As built (simplified after the sixth Codex re-review, see below).** Plugin `TraktExportService` (hosted, ticks every
minute) starts the plugin's export, with the switch on, 10 minutes after a linked user's latest episode play (so the live
scrobble lands first), when an account is linked again after a failed sign-in, once a day as a safety net, and after a
run that was not clean; Sync Now starts it any time. Never while it runs; after a run that was not clean only after a
retry wait of 15 min doubling to at most 6 h. Durable state is the host's (user data, the task's last result) plus the
switch in the plugin XML; no table, no migration. `TraktPluginState` finds the task and reads the links. Refusals:
`not_installed`, `old_plugin`, `unknown`, `no_users`, `unwatched_history`. API in [API.md](API.md#missed-watches-to-trakt-phase-13).
Web: Settings › Trakt (step 11 of 13, after Missing Episodes) and `TraktReconnectNotice` under the Home hero (mounted
by `integration/homeTab.ts`), both from existing components; no guide changed. Live runner
`scripts/jellyfinmod-e2e/trakt-export.mjs`; stand-in `scripts/jellyfinmod-e2e/standins/trakt-export.mjs` (TLS as
api.trakt.tv); local environments answer api.trakt.tv with it under `JFMOD_TRAKT=1` (workspace `envs/compose.trakt.yaml`).

What the simple design loses: a rewatch during an outage is not sent; "completed" means the export ran with the user
linked, not a per-episode check; an episode deleted from the library before the next export is not sent.

Follow-ups (not in this phase): on the stubs line the stock plugin adds placeholder `.disc` episodes to a linked user's
Trakt collection when *Synchronize collections* is on; an upstream fix for the token trap (keep the old token on a failed
refresh and retry).

**Evidence, 2026-10-28 (built, not accepted).** Items line on local environment echo (Jellyfin 12.2.0, stock Trakt plugin
33.0.0.0, `JFMOD_TRAKT=1`, `TraktExportTestMinutes=1`), plugin `phase13-trakt-items` and web `phase13-trakt-items`:
`trakt-export.mjs` **50/50** in one run (offline plays, the automatic export failing and retrying while Trakt is down, a
restart keeping state, delivery at Jellyfin's watch times to the minute, no second play from two Sync Nows and a restart,
catch-up adding only the three missing episodes while the seeded ones keep their id and time, a live scrobble once and no
export duplicate, three 500s failing a run with a 60 s retry then two 429s ridden out, history on page 2 found, the
unwatched-history refusal with nothing removed, a rejected refresh shown as Reconnect needed in Settings and on Home and
the waiting watch sent once after reconnecting, 401 anonymous and 403 for an ordinary user, a disabled Trakt plugin
reported not installed). `trakt-export-matrix.mjs` **66/66 in Chromium and 66/66 in Google Chrome**: Settings › Trakt in
both states on desktop Dark and Light, phone 390 px and TV 1920×1080 and 1280×720 (D-pad Down reaches the switch, Sync
Now and Reconnect Trakt; the remote's Back leaves), the Home notice only while reconnect is needed, no sideways scroll,
text at 4.5:1 or more, no page error. Stubs line (Jellyfin 12.0.0, Trakt plugin 31.0.0.0): the export is refused as
`old_plugin` (Sync Now 409) and the section says to update the plugin. Plugin suites Phase 0 and 1 smoke and Q16 Trakt pass
on both lines (macOS). At the real pace (`TraktExportTestMinutes` 0) one watch while Trakt was down started the export 10 min after it ended, the failed run retried 15 min after it ended, and the watch reached Trakt once at its watch time. Not run: the Pi, a physical TV, the Codex review.

**Found in the stock plugin (not changed by this phase).** It sends one Trakt request at a time and retries each for about
90 s, so during an outage its queued scrobbles drain slowly; one still queued when Trakt returns lands with the return
time, not the watch time, and the export then leaves it alone because Trakt has a play. A Jellyfin restart during the
outage drops that queue, and the export then delivers the original times.

**Codex review fixes (2026-10-28).** Codex GPT-6.1 Sol high reviewed the items line (no P1, five P2; record in the
workspace, `reviews/phase13/codex-review.md`). Fixed on both lines, each shown failing on echo before the fix:
(1) a run counts as delivered only when the host says Completed and the plugin logged no Trakt error while it ran (the
plugin completes its task when Trakt refuses a history write); otherwise it is retried with the back-off. The signal is the
host's own file log; what it loses: an unrelated Trakt error during the run (a live scrobble failing) costs one extra
export, and a server without the file log retries at most every 6 hours. (2) The last confirmed run and the accounts owed
a catch-up after a reconnect live in the plugin XML, so a restart between a dead sign-in and its reconnect still sends the
waiting watches; no export runs while no account has a working sign-in. (3) The per-user settings are read only when
every field has the v31–v33 type; anything else is `unknown` and refused. (4) The runners prove their environment
(container, published port, server name, api.trakt.tv routed to the stand-in, the stand-in and the lease) before they
sign in, and take the address and restart target from it. (5) Settings › Trakt and the Home notice read the state again
every minute while open (every 5 s while the export runs).
After the fixes on echo: `trakt-export.mjs` **65/65** in one run (the earlier 50 checks plus a refused history write
retried and confirmed, a restart between a dead sign-in and its reconnect still delivering the waiting watch, no export
while no account is linked, and the Home notice and Settings following the state without a reload); before the fixes the
same new checks failed 8 of 14. `trakt-export-matrix.mjs` 66/66 in Chromium and 66/66 in Google Chrome again. The plugin
suite's new Phase 13 checks (refusals, link shapes, administrator-only state, no token in the answer) failed before fix 3
and pass on both lines; Phase 0 and 1 smoke pass. Stubs line on Jellyfin 12.0 with Trakt 31: still `old_plugin`, 409.

**Codex re-review fixes (2026-10-28).** The re-review of that fix delta (no P1, three P2, one P3; workspace
`reviews/phase13/codex-rereview.md`) is fixed on both lines. (1) A run is confirmed only from a log that holds it whole in
one file: JellyfinMod writes the run's start line, with a run id, when the host starts the task, and reads that file from
the start line to the host's end line (files over 160 MB are not read); a start or end not found, a run across a
rotation or a pruned file, is not confirmed and is retried once more. (2) The export's state is changed and saved only
under the plugin's configuration lock (`Plugin.ChangeTraktExportState`), and a settings save keeps the server's own
`TraktExportConfirmedAt` and `TraktExportCatchUpUserIds` whatever the submitted copy says. (3) Each run records the linked
accounts at its start with their link's fingerprint, the token expiry the plugin holds (a date, never a token); an
account caught up only when the same fingerprint is there at the end. What that loses: a token refresh during the run
also keeps the catch-up, which costs one more export. (4) The Settings rail's Trakt line reads the same live query as the
section. Also: when an account is linked again, the retry wait left from its failing sign-in is dropped, so its catch-up
starts within the quiet period (in memory; the catch-up itself is in the XML). A second re-review found one more P2, fixed the same way: a run that starts before the previous run's end was handled (a Dashboard start in the moment the host has set the task idle but not yet reported its end), or another run's start line between a run's start and end in the log, confirms nothing, and the catch-up is kept; what that loses: an overlapping manual run costs one more export. A third re-review found chained overlaps (A start, B start, A end, C start, B end, C end) still misconfirmed; JellyfinMod now matches each end to the context it captured at that run's start by the host's own start time (set right after the start event, within 2 s), and an end confirms nothing when no context matches, or another run started or ran inside its window. A fourth re-review found that a start whose end never comes (the host's history write throwing first) could leave a bare counter stuck; with the match by start time it only sits unused, and starts and ended windows are forgotten after 6 hours (an end that arrives later finds no context and confirms nothing). A fifth re-review found the match by start time still misconfirming when runs come close together (the host's end time taken before its end line, a start in that gap, slow start handlers), so the timing is gone and one rule reads only the log: the start lines and the host's end lines, in order, are grouped into clusters (one opens at a start and closes when starts and ends balance); an end makes JellyfinMod look at the latest finished cluster, and only a cluster with exactly one start, captured by JellyfinMod within the last 6 hours, and one end saying Completed, with no Trakt error between them, confirms. What that loses: any overlap of runs costs one more export. Before the fix the plugin suite's new nearest-time and slow-handler cases failed (its idle-gap cases already passed); all pass now on both lines.

**Simplified after the sixth Codex re-review (2026-10-28).** The sixth re-review found three more P2s in the log parser.
The coordinator stopped the parser chase on reading the stock export (v33 `SyncLibraryTask.cs`, lines 449–484): it compares
Jellyfin's plays with Trakt's on every run and sends only what Trakt lacks, so any later successful export repairs a missed
one, and proving that a run delivered is not needed. The run ids, log clusters, per-run account contexts, start-time
matching and overlap rules are gone, and so are the confirmed watermark and the per-account catch-up list in the plugin
XML (`TraktExportConfirmedAt`, `TraktExportCatchUpUserIds`) with the save-preservation they needed. Correctness now comes
from running the export again (the triggers above). A run's result is best effort, for pacing and the Settings line only:
clean when the host says Completed and the host's file log holds no ERR or FTL line from `Trakt.ScheduledTasks.SyncLibraryTask`
or `Trakt.Api.TraktApi` between the run's start and 5 s after its end; anything else is retried. Each run is judged once,
and a restart judges the last run again from the log. Accepted loss: a missed or misread run delays the missing watches
until the next export (at most a day), never loses them, because the stock export sends whatever Trakt lacks. The live
steps `stalesave` and `relinkmidrun` (they tested the removed catch-up list) are dropped; the plugin suite keeps the
refusals and checks a refused write retried then clean, a reconnect starting the export, nothing starting after a clean
run, and the daily safety-net export. Live on echo (items line, test pace) the steps this touches, `setup offline online catchup reconnect
writefail reconnectrestart refresh` with `relink pace`, passed **47/47**; after the restart in `reconnectrestart` the last
run was judged again from the log and its retry sent the waiting watch once. Plugin suites Phase 0 and 1 smoke and Q16
Trakt pass on both lines.

**Codex review of the simplified build (2026-10-28).** The design held (no authorization bypass, no token leaving, no
history-removal path); two P2 and one P3 are fixed on both lines. (1) On a TV the remote's OK (Enter) now toggles the
automatic-export switch: browsers toggle a checkbox on Space only, and the pop-up D-pad handler acts inside pop-ups only.
(2) A status read never reads the log: the background check judges each run, one at a time, and `GET` answers what it
found, or no result yet (at most a minute, 15 s at the test pace). (3) While a change of the switch is saved it stays
focusable (`aria-disabled`) and ignores presses, so a TV keeps its focus on it. Before the fixes the TV matrix rows failed
"Enter on the switch changes the server setting" and "the switch keeps the focus while Space saves it" (36/40), and the
plugin suite failed "a status read right after a run ends does not judge it"; after them the TV rows pass 40/40 in
Chromium, the plugin suites pass on both lines, and the live steps `relink pace writefail refresh` pass 13/13 on echo. The re-review of those fixes found two P2 and two P3, fixed on both lines: a
held OK (its repeated keydowns) changes the switch once, not again after the first save (the TV rows failed "a held OK
changes the switch exactly once" before, 40/42, and pass 42/42 after); the live `writefail` step waits for the retried run
to be the last one before reading its result; a Completed run not yet judged says "Checking the last run…" instead of
"Nothing is waiting" (D47); the plugin suite proves that no status request reads the host's log by recording who reads
the log folder (it failed on the earlier code, where the status read judged the run) instead of racing the background
check. Live `relink pace writefail refresh` 13/13 again.

**Final gate, partly run (2026-10-29).** Codex approved the fix delta, product code included: review-clean. On echo
(plugin `phase13-trakt-items` 0790bca, web bundle `754f698bedf0` built from the clean commit `774da11c90`, health marker
`WebCommit` `774da11c90`) the full live list `trakt-export.mjs`, every step at the test pace, passed 64/66: the two
`failures` checks read the retry before JellyfinMod's background check had judged the failed run ("Failed, failures 0, next
undefined"), a runner wait the move of judging out of the status read had left behind. With that step waiting for the
judgment, `relink pace failures` passed 6/6; the real pace is restored. Stubs line on bravo (Jellyfin 12.0, Trakt plugin
31, web `3d3d078bb1` / bundle `227763561652`): `old_plugin`, Sync Now 409, Settings says to update the plugin; bravo was
reset to its baseline and released. Not run: the layout matrix and the real-Chrome pass, stopped because the user asked
for a new Trakt UI (a Disconnect button, the account's avatar and username, a collapsed activity log), which a design
session mocks up first; they run once on that UI. Built (not accepted), waiting for the new UI and the user's own check.

**Trakt additions, gate 1 (2026-10-29).** The user approved the design ("Round red icon is fine, go ahead with Trakt build";
workspace `reviews/phase13/mockups-v2`, decisions D48–D50, D67–D74). Built on both lines: the account row's Trakt avatar
(the person glyph on the grey disc without one, dimmed while a reconnect is needed), "oleksii · <username> on Trakt", and a
round red `link_off` Disconnect that asks first (Cancel focused, red Disconnect; the confirmation also says the Trakt
plugin's settings for the user are reset) and then calls the Trakt plugin's own Deauthorize; Activity, closed by default,
with the last 20 runs, why each ran and what it sent. Plugin: the server's profile read (D49) and the activity with the
plugin's counts from each run's log lines (D50, D73); API above. Gate 1 is the computer layout, dark, on echo; the phone,
the TV, light and Chrome follow after the user's look. The user approved the first look ("Trakt design looks great").

**Trakt additions, gate 2 (2026-10-29).** On echo (plugin `e3ba762`, web bundle `2bff3332fdc0` from `c1b4bbb26b`; the later
web commits change only runners and docs): the full live list `trakt-export.mjs` **83/83** at the test pace (the earlier
steps plus profile, activity and disconnect), the real pace restored after it. The layout matrix `trakt-export-matrix.mjs`
**134/134 in Chromium and 134/134 in Google Chrome 156**: desktop dark and light, phone dark and light, TV 1920×1080 and
1280×720, in both states; the account row (avatar, "oleksii · <username> on Trakt", a round red Disconnect of 40 px or more,
under the text on the phone), Activity opening and keeping 4.5:1 on every layout, and on the TV the D-pad reaching
Disconnect and the Activity header, OK on Disconnect opening the confirmation on Cancel (Right reaches Disconnect, Back closes
it with nothing changed and the focus back on the icon), OK on the header opening Activity, Down reaching the run list whose
arrows scroll it. A first matrix run failed four desktop rows only because the section-button size check counted the Activity
disclosure (30 px, a group title with its own guide); the check now measures it apart (24 px or more). Stubs line on bravo
(Jellyfin 12.0, Trakt plugin 31, web `34ac91de91` / bundle `518a452c4c70`): still `old_plugin`, Sync Now 409, Settings shows
only the refusal (no account rows, no Disconnect, no Activity), `activity` empty; bravo was reset to its baseline and
released.

**Both ways: the import from Trakt (2026-10-29).** The user approved gate 3 ("Trakt - looks amazing") and asked for a
bidirectional sync. JellyfinMod now also runs the Trakt plugin's own import ("Import watched states and playback progress
from trakt.tv", no default trigger at v33) and still writes no Trakt data itself: on Sync Now (the import first, then the
export), after a reconnect (the same) and once a day while the automatic export is on, behind the switch "Also import
watches from Trakt", on by default. Checked in the v33 source before building: the import saves with
`UserDataSaveReason.Import`, and the plugin's ServerMediator acts on `TogglePlayed` only, so an imported watch is not sent
back as a new play; the export then finds the play on Trakt and leaves it. The stock per-user import settings are kept as
they are; while "skip unwatched import" is off for a linked user the import is refused (it would mark unwatched here
everything Trakt has no play of), and Sync Now runs the export alone. Activity lists import runs ("Import from Trakt") with
what each marked watched in Jellyfin and the playback positions it set. Decisions D109–D113 in the workspace log. Found on the way (upstream, not changed): after the import, Jellyfin 12.2's single-item answers (`/Items/{id}`, the detail page) can keep the watched state they cached before the import saved, while library lists show it; a restart clears it.

**Settings › Trakt v3: the account bar first and a per-title Activity (2026-10-29).** The user approved the v3 design
("looks good"; workspace `reviews/phase13/mockups-v3`, decisions D125–D130, D134–D136). The account bar is first in the
section; while nobody is linked it shows the signed-in user "· not connected to Trakt", an off pill and a main **Connect
Trakt** to the Trakt plugin's page, and the two switches and Sync Now stay in place, dimmed to 45 % and aria-disabled, under
"Connect a Trakt account to turn these on." (the no-account warning and Activity are left out then). Activity is one row per
title and direction with its latest state, "**Title** S02E04 · time · action", under Today / Yesterday / date headings, the
last 30 days, in the plugin's SQLite table `TraktActivity` (one forward-only migration; `trakt-activity.json` retired). A
watch here waits for the export that the next-export line names ("The next export runs at 10:51 PM, 10 minutes after the
last episode ended"), and reads marked watched on Trakt once a clean export that started after it has run; a title the
export logs as not found reads failed and no longer holds back the run (D135); the import's saves read marked watched in
Jellyfin or the playback position from Trakt; collection adds and a burst of more than 50 titles are one count row. A play
by a linked account whose Trakt plugin Scrobble is on reads "watching now on Trakt (reported live by the Trakt plugin)" while
it plays and "stopped at N % (…)" when it stops early, from Jellyfin's own playback events: the plugin reports it to Trakt
live, JellyfinMod does not confirm it (D134). *Retention and imported watches* (user, 2026-10-29: "If you know the time
from trakt - use it"): an imported watch keeps Trakt's watch time, and retention has no guard for it, so **with retention
on, a title imported as watched long ago can be reclaimed at the next retention run**. Gate 1 is the computer layout, dark,
on echo. Plugin suite PhaseSevenTraktIntegration (with smoke 0 and 1) passes on both lines; its new checks failed against the
code before each fix. Live list on echo: the new `activity`, `import` and `disconnect` checks failed 11 of 17 against the
previous build, and the full list `trakt-export.mjs` passed 89/92 on the new build, the three failures fixed or re-run in
`absent activity import` (25/25): a missing or too old Trakt plugin lost its refusal while the account bar shows Connect
(fixed), a stale import row matched the import check (the runner now waits for a new one), and a levelling run the runner
did not see (not reproduced). Built (not accepted); the phone, TV, light themes and Chrome follow after the user's look.
Not changed: the stand-in never keeps a collection, so every export there logs 15 collection adds and Activity shows a
"15 titles" row per run; real Trakt keeps the collection and logs only new adds.

**Activity v4 (2026-10-30).** The user approved the redesign (workspace `reviews/phase13/mockups-v4`, D153–D155) with option A
for the days (D159), and asked for the time first (D162; build details D163). Activity is a full-width group header in its own
space with a Material chevron and "ACTIVITY · N titles in the last 30 days"; each day is a band a shade lighter than the
section, pinned at the top of the list while its titles scroll; each row starts with its time in a right-aligned column.
Gate 1 is the computer layout, dark, on echo: the live `activity` and `import` steps pass (22/23, then `import` 11/11 after
the runner allowed for the environment's clock running a little behind the Mac's on a run of milliseconds); every time ends at
x 473 and every title starts at x 486 at 1440 px; the band is sticky and pins at the list's top. Built (not accepted).

**Activity's direction mark (2026-10-30).** The user, on v4: "What blue dot means? … so it's clear which direction was going",
then, after mockups v5 to v8, accepted the Glyph ("Trakt glyph accepted too"; D182, workspace `reviews/phase13/mockups-v8`,
guide `design/guides/trakt-direction-mark.md`). The state dot gives way to Trakt's disc with the check turned into the
direction, in its own column after the time: up sent to Trakt, down brought from it, in Trakt's brand violet `#6438d0`
(app.trakt.tv/branding); waiting or playing a dashed violet ring; failed a white cross on Trakt's red with the words red. The
words drop "on Trakt" and "(from Trakt)". The mark is a redrawn Trakt mark, against Trakt's branding rules (no altered or
recoloured logo); the user accepted that. Gate 1 is the computer layout, dark, on echo; built (not accepted).

**Gate 2 (2026-10-31).** The user accepted gate 1 of the mark ("Trakt glyph gate 1 accepted"). Both lines were rebased onto
the main tips (web `main-items` a6a98dc99d, `main-stubs` dd7d30b53b; plugin `main-items` ee726aaead, `main-stubs` 7f8d755d99),
with Phase 9's ratings and Phase 12's copies under them; the `TraktActivity` migration keeps its id and its designer was
regenerated on the merged model (no pending model changes). On echo, rebased build: the full live list `trakt-export.mjs`
**103/103**; the layout matrix **134/134 in Chromium and 134/134 in Google Chrome 156** (computer, phone, TV 1920 and 1280,
dark and light). Plugin suites on both lines: smoke 0 and 1, PhaseSevenTraktIntegration and PhaseNineRatingsIntegration pass
(PhaseSevenSettingsIntegration fails on macOS on `main-items` alone too, `destination_missing`, a Linux suite). Stubs line on
bravo (Jellyfin 12.2, Trakt plugin 33, no account linked, no stand-in): the account bar with Connect Trakt, the switches and
Sync Now dimmed, no Activity, Sync Now 409 `no_users`; bravo backed up, restored byte for byte and released. Two runner fixes
on the way: the steps read watched states from the library query (an import left the single-item answer stale and a later
run re-sent the episode), and the reconnect step's quiet window starts 3 s after the run that found the sign-in expired.
Built (not accepted); the Codex review of the Activity changes and the merge follow.

