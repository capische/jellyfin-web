# JellyfinMod: prompt placeholder recreation and import visibility

**Status:** proposed design only. No files changed; no live tests run. Target remains stock Jellyfin 12.0.0, .NET 10, plugin version **0.1.0.0**, with no database migration.

**Recommendation:** replace the delete WIP’s broad backfill with immediate repair of the affected title; discover changed files through bounded folder validation; notify clients directly through `ISessionManager`; keep the importing ring until the refreshed playable item is actually drawn.

## 1. Facts established from the code

References below distinguish `plugin-nextrelease` (**P**), `jellyfin-web-nextrelease` (**W**), and their named WIP worktrees. Jellyfin references identify types/members in the supplied `jf-src/jellyfin` source snapshot.

| Status | Finding and evidence |
| --- | --- |
| **Verified** | P targets .NET 10, Jellyfin Controller/Model 12.0.0 and version 0.1.0.0. [Project](./plugin-nextrelease/JellyfinMod/JellyfinMod.csproj:6), [build properties](./plugin-nextrelease/Directory.Build.props:3). |
| **Verified** | Stubs have the marker `<!-- JellyfinMod placeholder v1 -->`; recognition also checks extension, size and link status. Writes publish a complete temporary file using a non-overwriting hardlink. `PlaceholderStub.Marker`, `IsStubFile`; `PlaceholderService.WriteStub`. |
| **Verified** | Placeholder planning excludes episodes still marked on disk, bound to native items, or covered by open imports. Consequently, stale bindings prevent recreation. [Planner](./plugin-nextrelease/JellyfinMod/Services/Placeholders/PlaceholderService.cs:906). |
| **Verified** | The ordinary library listener ignores `Season`. It queues IDs, then looks up current native items; a deleted movie or series can no longer be resolved. [Listener](./plugin-nextrelease/JellyfinMod/Services/LibraryEventListener.cs:78), `JellyfinNativeTitleSource.GetItemWorkItems`. |
| **Verified** | Positive per-title reconciliation does not perform the complete absence pass. That pass normally belongs to the post-scan catalog run. `ReconciliationService.ConfirmAbsenceUnderLeaseAsync`, `CatalogPostScanTask.Run`. |
| **Verified** | Baseline absence checking rejects an empty nearest ancestor. The redelete WIP permits it when the recorded mount identity is still current. [Baseline](./plugin-nextrelease/JellyfinMod/Services/MediaStorageIdentity.cs:119), `plugin-redelete: ReconciliationService.IsProvenAbsent`. |
| **Verified** | `SyncEntryAsync` already avoids scheduled cadence and the batch’s scan-yield option. However, scheduled sync holds the library lease across multiple titles and their three-second pauses. [Sync](./plugin-nextrelease/JellyfinMod/Services/Placeholders/PlaceholderService.cs:194). |
| **Verified** | Redetele WIP repairs vanished bindings by inspecting all bindings and potentially running `CatalogBackfillRunner.RunAsync(confirmAbsence:true)`, then a general placeholder batch. `PlaceholderBackfill.RepairVanishedAsync`, `PlaceholderDeleteListener.ProcessAsync`. |
| **Verified** | The current redelete listener’s quiet period is **one second**; its design notes still describe five seconds. It still waits for scans and the general batch gate. `plugin-redelete: PlaceholderDeleteListener.Quiet`. |
| **Verified** | Import links and verifies the real file before removing marked stubs; it records recovery states before requesting discovery. `ImportService.MarkLinkedAsync`, `SwapPlaceholdersForImportAsync`, `RecoverLinkedAsync`. This is coordinated ordering, not a filesystem transaction encompassing both files. |
| **Verified** | Import completion currently finds a binding by destination path. The importdelay WIP adds immediate ancestor `ChangedExternally()` and wakes import processing after reconciliation changes. `ImportService.FindBindingAsync`, `RefreshNow`; `LibraryEventListener.ProcessAsync`. |
| **Verified** | Normal import ticks force a client read with `TimeSpan.Zero`. Queue reads share a three-second cache. Thus, additional binding-triggered full ticks can increase client traffic. `ImportService.TickAsync`, `ClientSnapshotCache.QueueFreshness`. |
| **Verified** | W uses five-second card queue polling and a ten-second library-change debounce. The importdelay WIP changes the latter to 250 ms. [Queue hook](./jellyfin-web-nextrelease/src/apps/modern/features/jellyfinmod/hooks/useQueue.ts:28), [event handler](./jellyfin-web-nextrelease/src/apps/modern/features/jellyfinmod/integration/queryClientEventHandler.tsx:60). |
| **Verified** | W already carries importing state across redraws for up to three minutes, but detects missing media through rendered marks. A mark temporarily absent during redraw can prematurely clear the ring. `downloadMarks.afterwards`, `showsNoFile`. |
| **Verified** | FU24–FU28 and FU10 are documented in W; FU29 and FU11 are documented in their respective WIP worktrees. Those documents describe built, unaccepted work. |
| **Inferred / unverified live** | The supplied 63–173 s delete timings, restart outlier, and before/after import measurements are credible acceptance baselines, but were not reproduced during this design session. |

**Source discrepancy:** the supplied Jellyfin snapshot explicitly announces descendants before the deleted root (`LibraryManager.DeleteItem`, lines 618–624). The fetched [v12.0 source](https://raw.githubusercontent.com/jellyfin/jellyfin/v12.0/Emby.Server.Implementations/Library/LibraryManager.cs) does likewise. That conflicts with the measured server’s root-only events. The installed binary’s exact provenance remains unverified. **The design must work with either event pattern.**

## 2. The delete path in Jellyfin 12

The verified source sequence is:

1. `DELETE /Items/{itemId}` enters `LibraryController.DeleteItem`.
2. It resolves the item in the user’s context and checks `CanDelete(user)`.
3. It calls `ILibraryManager.DeleteItem(item, new DeleteOptions { DeleteFileLocation = true }, true)`.
4. `LibraryManager.DeleteItem` handles alternate-version promotion/reference changes where applicable.
5. For a folder, it materializes physical recursive descendants with `Folder.GetRecursiveChildren(false)`.
6. It removes internal metadata paths, then filesystem locations from `item.GetDeletePaths()`.
7. It detaches the item from its parent, removes external item files, deletes persisted items and evicts cached objects.
8. It invalidates the surviving parent’s children/user-data caches.
9. In this snapshot, it raises `ItemRemoved` for descendants, then the root; finally the controller returns 204.

**What disappears:**

- A season or series path is deleted recursively, including media, stubs and other contents beneath that directory.
- `Video.GetDeletePaths` can delete the containing directory for a video outside a mixed folder; episode/movie deletion is therefore not universally “unlink only this file.”
- Persistence deletion also handles owned descendants and parks transferable user data. Recreated items receive data by Jellyfin’s normal keys, after refresh.
- Required filesystem deletion failures throw before successful completion. Missing files are tolerated. An event must never be interpreted as proof that every possible media representation vanished.

**Event timing:** `ItemRemoved` occurs after the relevant filesystem and persistence removal. It is a synchronous callback on Jellyfin’s calling thread. The removed object and `ItemChangeEventArgs.Parent` remain useful; looking up its deleted ID or walking its now-detached parent chain is unreliable.

**Supported plugin reactions:**

- Subscribe to `ILibraryManager.ItemRemoved` from an `IHostedService`.
- Capture an immutable descriptor immediately: item ID/type/path, parent ID/path, series identity, provider IDs and numbering.
- Enqueue processing; perform no database, filesystem traversal, refresh or websocket waits inside the callback.
- Resolve catalog ownership using durable bindings, the captured identity and library path boundaries. Expand a season/series event to its affected bindings yourself.

**Before deletion:** `ILibraryManager` exposes no general cancellable `ItemRemoving` event. A plugin MVC `IAsyncActionFilter` can capture information before stock HTTP delete actions and inspect their result afterward; P already registers global MVC filters. This covers those HTTP actions only, not every internal deletion. It must preserve stock authorization and errors.

**Recommendation:** do not intercept deletion initially. The post-delete descriptor plus durable bindings are sufficient; recreating inside a before-delete hook risks having Jellyfin delete the new stubs.

## 3. Fast, reliable discovery of new files and stubs

| API | What it actually does | Cost, limitations and recommendation |
| --- | --- | --- |
| `BaseItem.ChangedExternally()` | Queues `IProviderManager.QueueRefresh` at `RefreshPriority.High` with default refresh options. | Good small-change shortcut. Returns immediately; discovery is not complete. A folder refresh normally validates descendants recursively. Never blindly call it on a large physical library root. |
| `ILibraryMonitor.ReportFileSystemChanged(path)` | Invalidates directory information, coalesces paths and starts/restarts a delayed refresher. | Cheap eventual fallback, unsuitable for the latency-critical path. Related changes extend the quiet period. |
| `Folder.ValidateChildren(...)` | Resolves children, creates/removes native items, optionally recurses and refreshes child metadata. | Awaitable and scope-controllable. Use on a background worker with fresh directory services, `allowRemoveRoot:false`, and deliberate recursion. It can remove stale database items, so storage verification matters. |
| `ILibraryManager.ValidateMediaLibrary(...)` | In this snapshot, cancels/requeues the scheduled full-library refresh and returns a completed task. | Expensive; awaiting it does not await the scan. Do not use per change. |
| `IProviderManager.QueueRefresh(...)` | Enqueues refresh of an existing ID; its processor also validates folders. | Same fundamental route as `ChangedExternally`, with explicit options/priority. The inspected queue accepts duplicate entries. Coalesce before calling. |
| `IProviderManager.RefreshSingleItem(...)` | Refreshes one existing item’s metadata. | Useful after discovery/probing; does not replace parent enumeration when the new file has no item yet. |
| `ResolvePath` / `CreateItems` directly | Resolve or persist native objects through public APIs. | Would make the plugin responsible for parentage, grouping, replacement, caches and refresh ordering. Reject for this fix; do not hand-construct synthetic items or write Jellyfin tables. |

`ProviderManager.RefreshItem` treats `CollectionFolder` specially by visiting its physical folders. Calling **`CollectionFolder.ValidateChildren` directly is a no-op**. These are different operations.

**Recommended shared `FolderRefresh` behavior:**

| Filesystem change | Exact discovery scope |
| --- | --- |
| Episode swap or stub in an existing season | Await that physical `Season.ValidateChildren(..., recursive:false, allowRemoveRoot:false, cancellationToken:ct)`. |
| New/recreated season inside an existing series | Shallow-validate the existing series to discover the season; resolve the resulting physical season, then validate that season. Series metadata-container behavior may still refresh broader series metadata. |
| Entire series folder recreated | Shallow-validate its physical library root once; then recursively validate only the newly discovered series. |
| Movie folder recreated or movie stub swapped | Shallow-validate the physical movie-library root. Use `MetadataRefreshOptions.RefreshPaths` containing the changed resolved item/file paths to restrict ordinary sibling metadata refresh. Refresh the discovered movie if necessary. |
| Library root emptied, but its physical folder item survives | Use the same shallow physical-root procedure. Empty storage is valid only with independently verified mount availability. |
| Physical root item absent | Call public `ILibraryManager.ValidateTopLibraryFolders(ct, removeRoot:false)` once, then resolve the physical root and perform the targeted procedure. This is shallow bootstrap work across top folders, not recursive full-library validation. |

The bootstrap proposal is **source-supported but not live-verified**. Test it before accepting the design’s empty-root timing target. If it fails on the deployed binary, retain one coalesced full scan as a degraded fallback and report that case separately.

Use fresh `DirectoryService` instances and default, non-destructive metadata options: no forced replacement, image replacement or trickplay regeneration. A shallow root walk still enumerates direct siblings; it is not constant-cost.

## 4. Updating the web without waiting for library batching

**Use an early standard `LibraryChanged` notification.**

After committed catalog changes and confirmed native discovery, call:

`ISessionManager.SendMessageToUserSessions(userIds, SessionMessageType.LibraryChanged, libraryUpdateInfo, ct)`

This bypasses `LibraryChangedNotifier`’s batching timer and works with existing client subscriptions. Send a correctly shaped `LibraryUpdateInfo` containing affected visible items and parent folders.

- Coalesce for 250 ms from the **first** pending change, without extending the deadline.
- Partition recipients/payloads by visibility using `LibraryAccess`, native visibility and captured pre-removal scope.
- Include no filesystem paths, torrent details or user data.
- Notify after catalog absence repair to expose fallback missing rows, then after native recreation to expose placeholders.
- For imports, notify after readiness and import completion are committed.
- Native clients may still have their own refresh policies; immediate delivery does not guarantee immediate redraw in every app.

**Do not invent `SessionMessageType.JellyfinModChanged`.** The inspected APIs require an enum. A genuinely custom websocket protocol would require additional transport plumbing. It buys little here.

The web’s handler should invalidate relevant entry/native-detail/children queries within 250 ms. Queue completion remains an additional invalidation signal. Include the existing native children redraw adapter, not just React catalog queries.

**Polling fallback:** while an import is active or a page awaits its replacement item, poll the existing entry-detail endpoint once per second per entry, shared among consumers. Reconnect, tab visibility and navigation also refetch. Stop fast polling after convergence; after 30 seconds use five-second retries and show the importing state as delayed.

**No cloud gap:**

1. Queue completion changes the visual state to “awaiting playable item”; it does not clear it.
2. Keep that state by server/user/entry/episode/grab identity, across DOM replacements.
3. Add a response-only `playableItemId` to entry and episode detail DTOs. Populate it from current native readiness, not the stored availability flag alone.
4. Clear the ring only when a fresh native DTO for the corresponding playable item has been **drawn**, with `IsPlaceHolder != true`.
5. Use DTO/item identity as the authority; `.jfmod-mark--none` or a temporarily absent DOM mark is insufficient.
6. An explicit cancellation/failure ends the importing carry. A timeout alone must not silently turn a successful import into “Not Downloaded.”
7. On reload, reconcile current queue, entry readiness and native data before painting a missing-media state. Old seeding history must not restart a ring after a later genuine deletion.

For packs, readiness and ring removal are **per episode**. Preserve the existing approved ring appearance and aggregate rules.

## 5. Server settings

| Setting | Verified default/behavior | Decision |
| --- | --- | --- |
| `ServerConfiguration.LibraryMonitorDelay` | **60 seconds**; a quiet-period timer restarted by related filesystem changes. | Leave unchanged. Lowering globally can scan incomplete external copies and increase metadata/disk work. Plugin-controlled complete writes bypass it explicitly. |
| `LibraryOptions.EnableRealtimeMonitor` | Per-library boolean. The model’s unset value is false; the web’s new-library checkbox is checked. Actual saved configuration is authoritative. | Leave unchanged. Explicit discovery works even when filesystem watching is disabled. |
| `ServerConfiguration.LibraryUpdateDuration` | **30 seconds**, controlling stock library websocket batching. | Leave unchanged. Lowering increases messages and client refetches for all library work. Send bounded early notifications for plugin operations. |

Sources: `ServerConfiguration.LibraryMonitorDelay`, `LibraryUpdateDuration`; `LibraryMonitor.IsLibraryMonitorEnabled`; web `libraryoptionseditor.template.html`.

The inspected `FileRefresher` uses a one-shot quiet timer; the inspected provider queue starts processing immediately. **I could not verify an additional fixed 15-second Jellyfin discovery interval.** The plugin’s 15-second import poll is verified. Do not build timing calculations around an unexplained additional interval.

Avoid `ReportFileSystemChangeBeginning/Complete` as a latency fix: completion retains ignored paths for approximately **45 seconds** in this snapshot and can interfere with nearby changes.

## 6. Recommended end-to-end sequences

### DELETE

1. **Removal callback, approximately immediate:** capture the descriptor and enqueue affected scope. Accept either root-only or descendant events.
2. **Within 250 ms:** coalesce by library/title; a root descriptor subsumes descendant work. Use a fixed batch window so continuing deletions cannot postpone earlier work indefinitely.
3. **Under `ReconciliationLibraryLock`:** load only affected bindings and current representations. Prove each candidate path absent on its recorded, still-readable mount.
4. Remove only proven-gone bindings. Recompute entry/episode state from surviving representations, using the same retention-reset/history behavior as existing absence confirmation. A surviving version prevents a stub.
5. Still within the same title operation, run the existing placeholder planner/writer for that entry. Preserve the deleted title’s valid original directory where possible; do not rename it merely because its native ID disappeared.
6. Recheck entry existence, library opt-out, writability, symlink boundaries, real files and open import/retention work immediately before writing.
7. Commit and release the library lease. Queue discovery of the changed folders and send the first scoped notification.
8. The serialized refresh worker performs the procedure in section 3 **without plugin database leases held**.
9. Reconcile/stamp resulting items, repair transferred user-data caches through existing `PlaceholderUserData`, then send the ready notification.

**Targets for a healthy isolated instance:** stubs on disk within **1 second**; native items and open web surfaces restored within **5 seconds** for an episode, movie or four-episode season. A modest whole-series target is **10 seconds**. These are acceptance targets, not guarantees under arbitrary metadata/provider load.

Do not wait for `IsScanRunning` to become false before targeted binding repair and writing. An active scan may race native validation; mark that scope dirty and verify/retry after it settles. Defer missing-root bootstrap if it conflicts with top-folder scan work. An arbitrary long scan cannot coexist with an unconditional five-second guarantee.

### IMPORT

1. Poll download completion every **2 seconds while imports await downloads**, using one batched status request per client and shared snapshots. Leave seed-only/idle work on its existing slower cadence; respect an explicitly configured faster cadence.
2. Validate the completed source, hardlink and verify it, record `linked`, remove marked stubs, and record `scanning` using existing recovery ordering.
3. Enqueue affected paths only after the file/stub mutation is complete. Coalesce a pack’s same-folder changes.
4. The refresh worker discovers/probes the new media immediately.
5. Native events trigger targeted reconciliation. Reduce the affected-title coalescing window to 250 ms for pending imports.
6. After commit and lease release, wake a **local binding-observation pass**. It must not reread the download client or perform a full import tick.
7. Complete each import only when the destination matches a current, usable native media source; commit, then notify sessions.
8. The web refetches and replaces its placeholder; remove the ring when that replacement is drawn.

**Readiness:** verify destination identity still matches the recorded link; locate its matching source through `NativeVersions.Read`, including local/linked alternates; require a non-placeholder source with usable video media information and a valid playable owner. Do not require `owner.Path == destination`: alternate sources can belong to an owner at another path.

**Targets:** completion detection ≤2 seconds; playable and drawn within **8 seconds** of download completion for episode/movie/four-file fixtures; notification-to-draw ≤1 second. Provider/network failures must remain visible as importing/blocked states rather than false success.

### Locks, load and recovery

- Event handlers only enqueue. Hosted workers own cancellation and create DI scopes; never capture `ModDbContext` in a singleton.
- Keep existing lock order: import tick gate before library lease where both are required. Never acquire the import gate while holding a library lease.
- Add an internal under-lease placeholder entry operation; do not recursively acquire the same library semaphore.
- Scheduled backfill must release the library lease between titles and hold no lease during its three-second pause.
- One refresh worker runs at a time. Deduplicate scopes, retain a dirty bit for changes arriving during execution, and rerun once for those changes. Never recursively refresh a library root.
- Send at most one notification batch per affected scope/window. Keep a monitor report once per changed batch as eventual fallback; expect some harmless delayed duplicate discovery.
- Replace the WIP’s ten-minute ancestor-path suppression with pending removal identities consumed when observed. Safety also comes from current file/import/entry checks; suppression is not permission to recreate.
- On startup, after database readiness, page through durable bindings to find proven missing files; queue targeted repairs. Also start normal bounded placeholder reconciliation for missing unbound titles.
- Recover `linked`/`scanning` imports using their existing durable records; repeat discovery lost across restart. Memory queues are accelerators, not durable truth.
- If Jellyfin still lists a vanished file, targeted validation removes that stale native item before final convergence.
- Read-only locations receive no files, temporary files or directory creation. Missing/unverified mounts receive no absence cleanup or recreation.
- Remove Entry and opt-out serialize with the same library lease. Queued work rereads those facts immediately before writing. A removed entry or disabled library cannot recreate placeholders.

## 7. Implementation tasks and E2E acceptance

Paths are relative to the applicable plugin or web worktree. Implement sequentially; preserve unrelated WIP edits.

| Step | File / class / method | Required behavior and acceptance check |
| --- | --- | --- |
| 1 | `Services/MediaStorageIdentity.cs`; `ReconciliationService.IsProvenAbsent` | Retain the WIP’s verified-mount exception for empty directories. Missing identity, changed mount or unreadable storage stays conservative. Integration: an empty healthy mount permits cleanup; an unmounted replacement does not. |
| 2 | `Services/ReconciliationService.cs` — new targeted absence method | Accept library/title plus removed identity/path scope. Query only those bindings; remove only proven absences; preserve surviving versions and existing retention/history semantics. Season/series root-only deletion clears all affected child bindings exactly once. |
| 3 | `Services/Placeholders/PlaceholderTasks.cs` — `PlaceholderDeleteListener` | Queue descriptors instead of a global boolean; coalesce for 250 ms and call targeted repair. Remove its ordinary-delete dependency on `CatalogBackfillRunner` and `PlaceholderBackfill.TryRunAsync`. Check: one deletion processes one title despite unrelated pending backfill. |
| 4 | `PlaceholderService.SyncAsync`, `SyncEntryAsync`; `SeriesFolders` | Add an internal under-lease entry path, preserve captured valid destination folders, and move scheduled pauses outside library leases. Recheck opt-out/entry existence immediately before writes. Check: deletion completes promptly during backfill; no duplicate/nested lease acquisition. |
| 5 | Existing WIP `Services/FolderRefresh.cs` | Replace ancestor-only `Now` with the serialized, awaitable discovery procedure in section 3. Use fresh directory services, shallow parent discovery and title-only recursion. Check all five folder cases, especially absent physical roots. |
| 6 | `ImportService.RequestScanAsync`, swap/recovery paths; `PlaceholderService.ReportOnce` | Enqueue one discovery scope per changed batch after recording state and finishing mutation. Preserve monitor/restart fallback. Check: a four-file pack does not queue four recursive parent refreshes. |
| 7 | `Services/NativeVersions.cs`; `ImportService.FindBindingAsync`, `ObserveBindingAsync` | Add reusable destination-source readiness evaluation. Complete only after readiness; support alternate-source owner paths. Check: a pre-probe binding stays importing, while a correctly grouped alternate completes. |
| 8 | `ImportMonitor`, `ImportService.TickAsync`, `ClientSnapshotCache` | Add two-second active detection, shared client freshness and a coalesced local-only binding wake. Check: binding bursts issue zero extra client status requests; multiple browsers share client reads. |
| 9 | `LibraryEventListener`; `JellyfinItemReconciliationRunner`; `PlaceholderItemListener` | Wake pending imports after committed reconciliation, including readiness-relevant updates that the existing identity fingerprint would skip. Preserve stamping/user-data repair and prevent self-save wake loops. |
| 10 | `PluginServiceRegistrator`; new `Services/LibraryNotifications.cs` | Register a bounded/coalescing notification worker using the existing session API. Partition by access; send only after committed state. Check two users with different libraries/ratings and an inaccessible title: no leaked IDs. |
| 11 | `Api/Contracts/EntryContracts.cs`, `EpisodeDto.cs`; `EntriesController` | Add response-only `playableItemId`, computed with shared native readiness and existing access checks. Batch native reads per detail response. No EF model/schema change. Check stale bindings and alternate versions. |
| 12 | Web `integration/queryClientEventHandler.tsx`, `hooks/useEntries.ts`, `hooks/useQueue.ts`, `types/entry.ts` | Consume readiness, use 250 ms fixed-window notifications, retain queue-transition invalidation and poll pending entry details once/second. Check socket loss/reconnect and a completed import present on the first queue response. |
| 13 | Web `integration/downloadMarks.tsx`, `components/MissingChildren.tsx`, native detail components | Keep importing by logical target until fresh playable data is drawn; retain state through DOM replacement. Forget removed native IDs so same-ID recreation redraws. Check zero cloud frames and exactly one season/episode representation. |
| 14 | Existing integration suites and browser runners; PLAN/UX/design notes | Add acceptance cases below, then document measured results and remaining limitations. Keep status built/unaccepted until live gates pass; version remains 0.1.0.0. |

**E2E execution:** use an isolated leased instance with writable fixture libraries, real Jellyfin/plugin HTTP boundaries, real SQLite, a controlled download-client endpoint, and actual imported playable files. Browser traffic must not be intercepted or mocked.

Record monotonic timestamps for delete request/204, removal event, absence commit, stub publication, discovery, playable source, import completion, notification receipt and first correct browser frame. Sample visual transitions every animation frame; use real `PlaybackInfo` and a short playback start to prove playability.

| Matrix | Assertions |
| --- | --- |
| Delete episode, only season, one of several seasons, whole series, movie | Meet section 6 timing targets; recreated items are placeholders; no real media survives unexpectedly; watched/favourite/date remain correct. Measure from both request start and 204. |
| Delete last title; physical root present/absent | Healthy empty mount repairs; shallow bootstrap discovers the missing root. No recursive full scan on the normal path. |
| Root-only and descendant events | Exercise the deployed stock delete path and observe actual events. Both patterns converge without duplicate repair; do not manufacture unit-test events as acceptance evidence. |
| Import episode, movie, four-file pack, additional version | Playable/drawn ≤8 seconds in controlled fixtures; each pack episode transitions independently; **zero Not Downloaded frames** between importing and drawn playable media. |
| Delete/import concurrency; backfill and active scan | No deadlocks, lost dirty work, stub beside a real file, or repeated global scans. Report scan-contention timing separately. |
| Repeated deletion at the same path within ten minutes | Every genuine deletion repairs; the old suppression entry cannot swallow the next operation. |
| Remove Entry, opt-out, read-only mount, missing mount, symlink escape | No recreation and no unauthorized filesystem writes; unrelated files and user-owned `.disc` files remain untouched. |
| Restart after link, after stub removal, after discovery request; deletion while down | Recovery starts after readiness without waiting for scheduled cadence; single-fixture convergence ≤10 seconds on a healthy local instance. |
| Socket disconnected, reload, second browser, queue private to ordinary users | Entry/native polling converges; no wrong cloud gap or unauthorized queue disclosure. |
| 100 changed episodes and several viewers | One refresh at a time; same-folder changes coalesce; no per-episode full scans; batched client reads remain bounded to the active cadence. |

Run Chromium first, then real Chrome on desktop, phone and TV layouts at 1080p/720p. Verify a stock native client separately; report physical-TV evidence separately. Restore fixtures/configuration and release the lease.

## 8. Risks and open questions

- **WIP verdict:** immediate `ChangedExternally()` is a useful proven improvement, but the WIP is not a complete latency design. It leaves queued refresh latency, broad-root recursion, binding-versus-readiness ambiguity and UI handoff races.
- **Broad delete repair remains the main structural flaw:** scanning every binding and reconciling every title for one deletion adds work proportional to the catalog. Reducing its quiet period does not fix that.
- **Ten-minute path suppression is incorrect for repeated deletes.** A recreated folder can legitimately be deleted again inside that window. Consume specific expected removals rather than suppressing all descendants by time.
- **The WIP’s `_repairedGone` cache records attempted items before successful repair.** An unsuccessful check can then suppress later attempts while the same missing set persists. Only successful convergence should remove work from pending repair.
- **A binding is not sufficient proof of playability.** Conversely, requiring the owner’s primary path to equal the destination incorrectly rejects alternate versions. Check the matching source.
- **Queue-driven acceleration alone is insufficient.** It depends on a permitted, foreground viewer polling the queue. Completion detection must work with no web client and with a private queue.
- **Source/binary mismatch needs resolution:** verify the deployed Jellyfin revision and actual removal events before claiming version-wide event semantics.
- **Bootstrap needs live proof:** `ValidateTopLibraryFolders` is preferable to a full scan, but its absent-root behavior must pass on the actual binary.
- **Stock scans do not honor plugin locks.** Targeted validation can race them. Convergence is achievable; a strict few-second deadline during an arbitrarily long scan is not established.
- **Cold metadata and large recreated series can dominate timing.** Measure warm/cold runs separately. Do not promise thousands of placeholder episodes within five seconds.
- **User-data repair currently relies on a short delay after refresh.** Verify that accelerated notifications cannot expose stale watched state before reattachment/cache repair finishes.
- **Readiness proves server availability, not every client codec path.** Playback acceptance must include supported real files and the intended clients.
- **No migration is justified:** bindings, catalog rows, import states and opt-out configuration already provide durable recovery inputs; added readiness fields are response projections.
