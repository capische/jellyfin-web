# JellyfinMod: delays in every flow that changes files or state (imports, placeholders, removals)

Model and effort: Opus, high. Read-only audit; no repository edited. Measured on local environment `charlie` only
(lease claimed as "Import Audit" 14:51–15:17 Sydney, reset to baseline, stopped, released, FREE).

**Code audited:** plugin `plugin-nextrelease` @ `ab55fb0` (P = `plugin-nextrelease/JellyfinMod/`) and web
`jellyfin-web-nextrelease` @ `2e4f350124` (W = `jellyfin-web-nextrelease/src/apps/modern/features/jellyfinmod/`). That is
what the user has. Codex design = [no-delay-codex-design.md](/Users/kxalex/Projects/jellyfin-mod/jellyfin-web-nodelay/docs/jellyfinmod/design/no-delay-codex-design.md),
steps 1–14 (§7). In the tables, `P:Services/X.cs:123` means a file and line under that prefix.

## 0. What the user sees, in one line per flow

Every plugin write reaches Jellyfin and the screen through four slow links:

1. **Jellyfin's library monitor:** `ReportFileSystemChanged` waits `LibraryMonitorDelay` = 60 s. Each related change restarts
   that wait. Siblings merge into one refresh of the library root.
2. **The import poll:** 15 s (`P:Data/Acquisition.cs:307`, `P:Services/Import/ImportMonitor.cs:70,86`).
3. **The placeholder sync cadence:** a trigger every 5 min. A batch runs only while work is pending, or every 15 min when
   idle (`P:Services/Placeholders/PlaceholderTasks.cs:144,147,171-176`).
4. **Jellyfin's `LibraryChanged` batch, then the web's debounce:** the batch is 30 s. On top of it the web waits a further
   10 s after the last message (`W:integration/queryClientEventHandler.tsx:60-67`).

The plugin itself sends nothing to clients. There is no manual "file import" in the plugin at all; see §2.

## 1. Flows × delay, hops, design coverage, gap

"Now" is the current `next-release` build. **M** = measured here, **m** = measured earlier on charlie (`import-delay.mjs`
runs of 2026-10-17/18), **E** = estimated from code.

| # | Flow | Hops and waits (file:line) | Now (s) | Codex design | Gap / wrong state |
|---|---|---|---|---|---|
| 1 | **Torrent: one episode** | Client completes, then poll ≤15 s (`ImportMonitor.cs:70,86`). Identify, link, swap stub (`ImportService.cs:374-540,698-718`). `ReportFileSystemChanged` (`:781`), then 60 s monitor; the season is refreshed. `ItemAdded`, then `LibraryEventListener` 1 s debounce (`LibraryEventListener.cs:20`), then binding. Next tick ≤15 s, then `CompleteAsync` (`:962`). Web: queue 5 s poll (`W:hooks/useQueue.ts:63`, `W:integration/downloadMarks.tsx:522`) sees `seeding` and refetches EntryDetail only; the page then waits for LibraryChanged + 10 s. | **m** linked 12.9, playable 73.3, completed 88.0, Play shown 113. **22.4 s of Not Downloaded cloud.** | Steps 5–9, 12–13 (2 s detection, awaited folder validation, binding wake, readiness, notification, ring kept until drawn). Importdelay WIP alone: Play at 4.9 (**m**, 0 cloud). | Covered. |
| 2 | **Torrent: movie** | As #1, but the movie's folder has no Jellyfin item, so the refresher refreshes the **whole movie library root** (research §3(c)). | **m** playable 74.1, completed 89.0, Play 91.6 | Step 5 (shallow root + `RefreshPaths`). WIP: Play 3.1 (**m**). | Covered. |
| 3 | **Season pack (4 files)**, including per-episode early import, partial packs, specials and unaired episodes | Each episode imports once its own file is complete (`ImportService.cs:349-364,549-560`), with one report per episode. On the old host nothing refreshed, so the import escalated to a full library scan after `max(60, delay+30)` = 90 s (`:844-846,783`). A missing file fails only that episode (`pack_episode_missing`, `:460-465`). Specials get no stub (`P:Services/Placeholders/PlaceholderService.cs:418`). Unaired episodes are never claimed. | **m** linked 13.0, playable 103.5 (full scan), Play 105. The series-page card kept the ring until 120. | Step 6 (one scope per batch), step 7 (per-episode readiness), step 13 (per-episode ring). WIP: Play 4.5–4.8 (**m**). | Covered. Not measured: partial pack, a pack with specials. |
| 4 | **Series pack** | As #3 across several seasons. A new season folder's refresher lands on the series, which validates recursively. | **E** like #3, worst case the 90 s escalation | §3 table, "new season in an existing series". | Covered. |
| 5 | **Add another version** | Destination in the same folder with a label. The report finds the nearest item: the season for an episode, the library root for a movie. Grouping changes reach the listener through the alternates in its fingerprint (`LibraryEventListener.cs:105-114`). | **E** ≈ #1 and #2 (60–90 s) | Step 7 readiness through `NativeVersions`, alternate owner. | Covered. |
| 6 | **Replace / upgrade** | The import completes, then in the same tick `UpgradeService`/`PackReplaceService` run (`ImportMonitor.cs:34-43`). Then `ReplaceVersionAsync`: unlink and `DeleteItem(old)` (`P:Services/RetentionExecutor.cs:705,1044`). `SuccessorUnavailable` retries every tick (15 s) for up to 24 h. | **E** old version still listed about 40 s after removal (LibraryChanged 30 + 10) | Step 10 notifies after the import completes only. | **Gap:** no notification after the replacement removal, so the page shows two versions, then one about 40 s later. A pending replacement keeps the 15 s cadence. |
| 7 | **Identifying, linking, settling** (Transmission still moving files) | 10-min `SourceSettleGrace` (`ImportService.cs:415,507-518`), retried each poll (15 s). Restart in `linked`/`scanning`: repeat the request (`:743-770,817-825`). | **E** +0–15 s per retry | Steps 8 and 14 (2 s, restart recovery). | Covered. |
| 8 | **Seeding copies kept** | `SeedReleaseService` runs on the tick. The library file is untouched. | 0 visible | n/a | None. |
| 9 | **"File import": a real file appears in the library without a torrent** (user copy, other tool) | No plugin path; Jellyfin's monitor then reconciliation. **Measured beside a stub:** Jellyfin made the `.disc` stub a **second media source** of the same episode ("2 versions" in the catalog). It stays until the next placeholder sync removes the stub as `on_disk` (≤15 min idle cadence). | **M** item 60.2, bound 61.3, LibraryChanged 90.1. **Duplicate version (stub) for ≤15 min + 60.** Sync Now removed it at once; Jellyfin regrouped at 60.5. | Not covered. | **Gap:** a wrong version picker (a `.disc` source beside the real one, also in native clients), and a wrong version count. The 60 s is the stock monitor delay for external writes and stays (design §5). |
| 10 | **Library backfill of native titles** (`CatalogBackfillTask`, post-scan) | No default trigger (`P:Services/CatalogBackfillTask.cs:31`). Post-scan absence pass (`CatalogPostScanTask.cs`). | n/a | Step 2 (targeted absence). | None for delays. |
| 11 | **Retention reclaim** (daily 03:00, `RetentionReclamationTask.cs:35-36`, or Run now) | Unlink, then `TryRemoveNativeAsync` → `DeleteItem` **first** (`RetentionExecutor.cs:705,1044`). Commit, then `LeaveAfterReclaim` / `LeaveAfterMovieReclaim` write the stub and `ReportFileSystemChanged` (`PlaceholderService.cs:670,547`), then 60 s. | **E** episode or movie **absent from Jellyfin ≈60 s** (same mechanism as M-sync2: 60.5). Two LibraryChanged batches, so the web refreshes twice. | Not covered: those writers are static and call the monitor directly. The in-progress `DeleteRepair` sees the `ItemRemoved` but finds the stub already written. | **Gap:** a missing-episode or missing-movie window, Next Up and counts shift for about 60 s, and a wrong "missing" fallback row. |
| 12 | **Remove a version (file Remove icon), last copy** | `RemoveVersionAsync` unlinks, then `DeleteItem` (`RetentionExecutor.cs:210-261`). State becomes None and unmonitored. **No stub is written** (only the Retention provenance leaves one, `:766,823`). The web leaves through `leaveAfterRemove` (`W:components/NativeEntryDetails.tsx:151-164`). | **M** native item gone 0.2. **No stub in 150 s**; it returns only with the next sync (≤15 min) + 60. Sync Now: stub at 0.1, item at 60.5. | Only if the targeted repair (steps 2–5) also runs for the plugin's **own** `DeleteItem`, after the binding is already gone. Not stated in the design. | **Gap:** the episode or movie disappears from Jellyfin for up to 16 min. |
| 12b | Remove a version, not the last copy | Same path. The alternate is removed. | **M** 0.2 for the native item; the web re-reads | n/a | Notification (as #6). |
| 13 | **Stock Delete media** (season, episode, series, movie) | Research §1–2. | 63–173 (supplied, not re-measured) | Steps 1–5, 10, 13 (the main case). | Covered. |
| 14 | **Add entry** (new file-less title) | `EntriesController.cs:205`, then `PlaceholderSyncQueue`, then `SyncEntryAsync` (`PlaceholderTasks.cs:348-420`). Write, then `ReportOnce` (`PlaceholderService.cs:297,317-336`). A new title folder merges with its siblings into a **whole-root refresh** (log: "Resetting file refresher … to /test-media/tv", "tv will be refreshed"). An empty root → `QueueLibraryScan` (`:330-334,362`). Web: invalidates the mod keys and shows the mod card; the native page swaps in after LibraryChanged + 10 (`W:EntryDetails.tsx:86-90`). | **M** (same writer, through Sync Now): new series items 63 s after the write. New movie into an empty root: a full scan (1 s locally, minutes on the Pi). | Step 6 (ReportOnce → discovery), §3 bootstrap. | Covered once `ReportOnce` uses discovery. |
| 15 | **TMDb episode list adds seasons/episodes** | `EntriesController.cs:305`, then as #14. Web: `setQueryData(EntryDetail)` shows fallback rows at once; native stubs replace them after LibraryChanged + 10 (`W:NativeEntryDetails.tsx:523-525`, `W:components/MissingChildren.tsx:144-162`). | **E/M** 60 (existing season), 63+ (new season or series) | Step 6. | Covered. |
| 16 | **Sync Now and backfill batches** | One batch per library, 10 titles and a 3 s pause **inside the library lease** (`PlaceholderService.cs:135,138,215,260`). The batch yields to scans (`:220-231,262-269`). | **M:** answered at 0.2 s. The **Movies library ran first and queued a full scan** (empty root). **The TV batch of the same run then yielded to that scan** ("gave way to a library scan") and wrote nothing. The TV stubs came only 86 s later from the first-run starter (`PlaceholderTasks.cs:295`; normally the next 5-min trigger). Items at 149–150. | Step 4 (pauses out of the lease) and the bootstrap replace the scan. | **Gap:** the self-inflicted deferral. One library's own scan request postpones the others by up to 5 min. |
| 17 | **Opt in** (switch on) | `PlaceholdersController.cs:65-75` runs `SyncAsync` inline: up to 10 titles × 3 s pauses **inside the HTTP request** (≥27 s), then 60 s. The rest follows every 5 min. | **E** 27 s request, then +60 | Step 4 partly. | Small: queue it, do not hold the request. |
| 17b | **Opt out** (switch off) | Writes nothing; existing stubs stay (documented). | 0 | Recheck before writes (step 4). | None. |
| 18 | **Remove Placeholders** | `RemoveAllAsync`: unlink, then `Report()` per folder (`PlaceholderService.cs:383-402`), not `ReportOnce`. | **M** files gone 0.0. Native items removed at **60.1** (the monitor merged into a refresh of the "tv" root). LibraryChanged 90.1. Web settings reload at once; catalog after about 100. | Not covered: `Report`, not `ReportOnce`. | **Gap, and a risk with the new repair** (§3, R1). |
| 19 | **Remove Entry** | `EntriesController.cs:850` → `RemoveForEntryAsync` → `Report()` (`PlaceholderService.cs:489-524`). Web: `location.hash='#/home'` with **no invalidation** (`W:EntryDetails.tsx:186-189`). | **M:** stub-only movie, stub and folder gone at 0.1. **The native placeholder movie was still listed 4 min later**: the root became empty, and Jellyfin skips empty top folders (research §3(d)). With a non-empty root: **E** ≈60. | Design says only "cannot recreate". | **Gap:** a stale native item with no entry, for every user and native client. In an emptied root it never clears. |
| 20 | **Restore Watched State** | `SaveUserData` (`PlaceholderWatchedRestore.cs:143`), then Jellyfin `UserDataChanged`. Web handler: no debounce, but it invalidates the key `'NativeDetail'`, which no query uses. The real key is `'EntryDetail'` (`W:integration/queryClientEventHandler.tsx:42`, `W:hooks/useEntries.ts:62`). | **E** native ✓ fast. The mod's EntryDetail-driven surfaces wait for the 60 s staleTime or a refetch. | Not covered. | **Web bug:** a stale watched state on mod surfaces. It also hits every ✓ or ♥ change. |
| 21 | **Cancel or failed grab, client removal, blocklist, queue remove** | Queue 3–5 s polls (admins). A torrent removed in the client is blocked as `torrent_missing` at the next tick (`ImportService.cs:328-334`). Queue removal never deletes files (`QueueController.cs:265-380`). After a link, the file stays and is bound by reconciliation. | **E** 3–15 | n/a | None material. A row removed after `linked` shows the file only after LibraryChanged + 10. |
| 22 | **Restart mid-flow** | Repeat the scan request (`ImportService.cs:817-825`). Placeholders wait for the first-run starter (5 min) or the 5-min trigger. | **E** 60–300 | §6 recovery, step 14. | Covered. |

## 2. Inventory notes

- **There is no file-import feature.** Nothing imports files that are already on disk without a torrent: no manual import, no
  "import path", no adoption of existing downloads. `ImportPathProbe` only proves that hardlinks work
  (`P:Services/Import/ImportPathProbe.cs`).
- External files enter only through Jellyfin's monitor or a scan, then through reconciliation:
  - `LibraryEventListener` → `JellyfinItemReconciliationRunner`;
  - new native titles are backfilled into the catalog (`ReconciliationService.cs:556`);
  - placeholder-only series are guarded (`:552-555`).
- **Every plugin write path, and how it tells Jellyfin:**

| Path | How Jellyfin hears of it |
|---|---|
| Import (`ImportService.cs:711,781`) | `ReportFileSystemChanged`, plus a full-scan escalation at 90 s |
| `PlaceholderService.SyncAsync` (sync, backfill, add, episode list, opt in) | `ReportOnce` (`:297`), plus a full scan for an unknown root (`:362`) |
| `RemoveAllAsync`, `RemoveForEntryAsync` | `Report` (`:398,519`) |
| `LeaveAfterReclaim`, `LeaveAfterMovieReclaim` | Direct `ReportFileSystemChanged` (`:670,547`) |
| `RetentionExecutor` reclaim, version remove and replace | `DeleteItem(DeleteFileLocation=false)` (`:1044`); the only immediate one |

  The Codex design reroutes the import's calls and `ReportOnce` only.
- **The plugin sends no message to clients.** All push comes from Jellyfin's 30 s `LibraryChanged` batch, or a
  `UserDataChanged`.

## 3. Wrong intermediate states, and places that can lose or duplicate state

- **S1. Cloud between importing and playable (now):** 22.4 s on an episode (**m**). The ring is dropped at `seeding` before the
  page redraws (`W:integration/downloadMarks.tsx:473-485`). Design step 13 fixes it.
- **S2. Stub as a second version beside an external file:** **M**, for ≤15 min. A client can pick the `.disc` source. The
  placeholder filter shapes only whole stub items, not one source of a real item (`P:Api/Filters/PlaceholderFilter.cs:21-50`).
- **S3. A missing episode or movie in Jellyfin after a reclaim** (≈60 s), **or after removing the last version** (≤16 min, **M**).
  - Season counts, Next Up and the fallback "missing" rows change twice.
  - User data survives: Jellyfin parks it, and the stub's first refresh re-attaches it by key. The cleanup task has no
    default trigger (research §5).
- **S4. A stale native item with no entry after Remove Entry** (**M**, permanent in an emptied root).
  - No catalog row is recreated, because placeholder movies are excluded (`JellyfinNativeTitleSource.cs:64,327`).
  - Every user's Home and native clients still list it. PlaybackInfo is refused.
- **R1. Remove Placeholders can be undone at once by the new delete repair.**
  - The in-progress `feat/no-delay` notes each plugin removal as expected for only **2 min**
    (`ExpectedMemory`, `PlaceholderStub.cs:95-118` @ `80b4689`).
  - Jellyfin announces the removal only when the monitor fires: 60 s after the **last** related change, and every related
    change restarts it.
  - If the announcement comes later than 2 min (a busy folder, a scan in between, or the emptied-root case where it never
    comes), the repair treats it as a user delete. With the switch on, it rewrites the stubs the admin just removed.
  - Before this work the stubs came back only at the next sync (≤15 min, documented).
  - The same applies to the sync's own `on_disk` removals and to Remove Entry. The import swap is safe: its episode is
    excluded as an open import.
- **R2. Version removal relies on the repair reacting to the plugin's own `DeleteItem`.**
  - The binding is already deleted under the same lease (`RetentionExecutor.cs:750-752`).
  - The repair must therefore resolve the entry from the captured path or provider ids, not from bindings, and run the
    planner even though no binding was removed.
- **R3. Self-deferral of the backfill** (**M**, #16). Not a loss, but up to 5 min of nothing.
- **R4. Two LibraryChanged batches per reclaim or replacement**: one for the removal, one 60 s later for the add. The web
  redraws twice. With early notifications, the second one has to carry the add.
- **R5. Edge: a season deleted while an episode import of it is still `scanning`.** The hardlink goes with the season. The
  import waits for its two scans and then blocks `binding_not_observed`: a misleading reason. Retry relinks from the
  download (`ImportService.cs:743-770`).

## 4. Ordinary user, second browser, native clients

- **Ordinary user:**
  - The queue is private by default (`P:Data/Acquisition.cs:323`, 403 `queue_admin_only`).
  - `downloadMarks` stops on the 403, so there are **no rings**.
  - `QueueStatusLine` and `DownloadBlock` show the projection from the entry state (`W:components/QueueStatusLine.tsx:54-62`,
    `W:components/DownloadBlock.tsx:227-232`). `onChanged` never fires.
  - Their page moves only on LibraryChanged + 10 s, on focus, or on navigation. **Today: about 100–120 s after a download.**
  - The design's step 10 notification and step 12 entry polling cover them, but only if the 1 s poll is driven from entry
    detail state and not from the queue. Verify it (A7).
- **Second browser or tab:**
  - It has its own query client and websocket.
  - The ring appears only when its 60 s "slow" queue poll lands, unless one of its visible cards is already downloading
    (`W:integration/downloadMarks.tsx:522`), so **a grab made elsewhere shows up to 60 s late**.
  - A hidden tab pauses its intervals and refetches on `visibilitychange`.
  - Websocket messages missed during a reconnect are lost; there is no catch-up (design step 12 tests reconnect).
- **Native clients** (Swiftfin, Android TV, Infuse through the installed InfuseSync plugin):
  - They see only Jellyfin items, through the same 30 s `LibraryChanged`, and refresh by their own policy (**E**).
  - Every window in §3 is visible to them: S2 (the stub as a version), S3 (a missing item) and S4 (a stale item).
  - The iOS "Jellyfin" app is a wrapper around the server's web client, so it behaves like the mod web (**E**).
  - Early notifications (step 10) reach them, but redraw timing stays theirs.

## 5. Prioritised additional fixes

### A. Covered by the Codex design (keep; expected after, from the design and the WIP measurements)

| Flows | Steps | Expected after |
|---|---|---|
| Torrent movie, episode, packs, versions (#1–5, 7) | 5–9, 12, 13 | Play ≤8 s after completion (WIP already **m** 3–5 s), 0 cloud frames |
| Add entry, episode list, Sync Now writes (#14–16) | 6 (`ReportOnce` → discovery), §3 bootstrap instead of the full scan | ≤5 s |
| Stock deletes (#13) | 1–5, 10, 13 | ≤5 s; whole series ≤10 s |
| Restart (#22) | §6 recovery | — |

### B. Small additions to the design (same worktrees, same gates)

Ordered by user impact. Each item gives the place, the change, the expected delay after it, and the risk.

1. **B1: Plugin-own stub removals drop their native items directly, and mark them by item id, not by a 2-minute path memory.**
   - **Where:** [PlaceholderService.cs](/Users/kxalex/Projects/jellyfin-mod/plugin-nextrelease/JellyfinMod/Services/Placeholders/PlaceholderService.cs:383)
     `RemoveAllAsync`, `RemoveForEntryAsync` (`:489`) and the sync's removals.
   - **Change:** after a marked stub is unlinked, call `ILibraryManager.DeleteItem(stubItem, DeleteFileLocation=false)` for
     its item (the plugin already does this in `RetentionExecutor.cs:1044`). Then notify (step 10). Give the repair the
     removed item ids as "expected", consumed when the event arrives.
   - **After:** 0–1 s instead of 60 s, and permanent in an emptied root. Fixes S4 and R1 (#18, #19).
   - **Risk:** low to medium. Only items whose path `IsStubFile` was true and is now absent. Keep `Report()` as the fallback.
2. **B2: Reclaim and removing the last version leave the stub through the design's under-lease entry operation, before the
   native item goes, then validate that folder.**
   - **Where:** [RetentionExecutor.cs](/Users/kxalex/Projects/jellyfin-mod/plugin-nextrelease/JellyfinMod/Services/RetentionExecutor.cs:705)
     `ExecutePreparedUnderLeaseAsync`, `RemoveVersionAsync` (`:258-260`), `CompleteOneUnderLeaseAsync` (`:888-893`).
   - **Change:**
     - For `Retention` and for `VersionRemoved` with no copy left, write the stub with the entry planner, replacing the
       static `LeaveAfterReclaim` / `LeaveAfterMovieReclaim`.
     - Hand the folder to `FolderRefresh`: one validation removes the vanished item and adds the stub.
     - Keep `TryRemoveNativeAsync` only when no stub was written.
     - Notify after it.
   - **After:** ≤5 s and no missing-item frame, instead of ≈60 s (reclaim) or ≤16 min (version remove). Fixes S3 and R2.
   - **Risk:** medium. It sits on the retention delete path, so it gets the full gates and an adversarial review. Order
     matters: write only after the unlink is recorded, as now.
3. **B3: A binding gained by a real file removes that title's stubs at once.**
   - **Where:** the design's step-9 hook in `LibraryEventListener` / `JellyfinItemReconciliationRunner`.
   - **Change:** when a reconcile adds an episode or movie binding to an entry that has plugin stubs,
     `PlaceholderSyncQueue.Enqueue(library, entry)`. `SyncEntryAsync` then removes the `on_disk` stub and calls discovery.
   - **After:** the duplicate version is gone 1–2 s after Jellyfin indexes the file, instead of ≤15 min. Fixes S2 (#9).
   - **Risk:** low. The existing removal rule (`on_disk`) and the marker check are unchanged.
4. **B4: The backfill must not yield to the scan it requested itself.**
   - **Where:** [PlaceholderService.cs](/Users/kxalex/Projects/jellyfin-mod/plugin-nextrelease/JellyfinMod/Services/Placeholders/PlaceholderService.cs:220)
     and `:334/362`, `PlaceholderTasks.cs:191-241`.
   - **Change:** replace `AskForLibraryScan` with the design's `ValidateTopLibraryFolders` bootstrap. Until then, record that
     this run asked for the scan and skip the yield for the remaining libraries of the same run.
   - **After:** every library's stubs in the same run (0 s), instead of +5 min. Fixes R3 (#16).
   - **Risk:** low.
5. **B5: Notify after every committed plugin change, not only imports.**
   - **Where:** the step-10 `LibraryNotifications` worker.
   - **Change:** call it from the replace and upgrade removal (`PackReplaceService`, `UpgradeService`), version removal,
     reclaim, Remove Placeholders, Remove Entry, Sync Now and opt-in writes. For replacements, send one batch after the
     removal, not two.
   - **After:** web ≤1 s, instead of about 40 s (#6, #12b, #18, #19).
   - **Risk:** low.
6. **B6: Web fixes.**
   - **Change:**
     - Change the UserDataChanged key `'NativeDetail'` to `'EntryDetail'` in `W:integration/queryClientEventHandler.tsx:42`.
     - Remove Entry invalidates `['JellyfinMod',base,uid]` before navigating home (`W:EntryDetails.tsx:186-189`).
     - Sync Now and Remove Placeholders invalidate the catalog on success (`W:settings/PlaceholdersSection.tsx:130-145,313-329`).
   - **After:** immediate (#18–20).
   - **Risk:** low. One line each.
7. **B7: Fast entry polling for ordinary users.**
   - **Where:** step 12.
   - **Change:** start the 1 s entry-detail poll from the entry's own import or acquisition state, not from queue rows,
     because ordinary users get a 403 on the queue.
   - **After:** ≤2 s for non-admins, instead of about 100 s.
   - **Risk:** low. Check that no queue detail leaks to them.
8. **B8: A pending replacement counts as active work for the 2 s cadence** (`ImportMonitor`, step 8).
   - **After:** at most 2 s between a successor becoming playable and the old file going, instead of 15 s. Low risk.

### C. Separate work (not part of this design)

1. **C1: A grab made in another tab or by another user** shows its ring up to 60 s late (`downloadMarks` slow poll).
   - **Option:** send a notification when a grab is accepted.
   - **Loses:** nothing; it costs one message per grab.
2. **C2: Opt in runs one batch inside the HTTP request** (≥27 s, holding the library lease).
   - Move it to `PlaceholderSyncQueue` and answer with the plan.
3. **C3: Files written by anything other than the plugin wait for Jellyfin's 60 s `LibraryMonitorDelay`.**
   - Keep it as it is (design §5).
   - **Loses:** about 60 s for manual copies.
4. **C4: A season deleted during an open import** blocks with a misleading reason (R5).
   - Detect a destination that vanished in `ObserveBindingAsync` and relink from the download (`ImportService.cs:806-886`).

## 6. Measurements made (charlie, Chromium not needed, real HTTP and websocket, Jellyfin 12.0.0, plugin `ab55fb0`)

**Setup:**
- Fixtures were seeded in SQLite while charlie was stopped (`scratchpad/audit/seed.py`). Two series fixtures had 2 episodes
  each; one had a real S01E01 on disk, the other no files. The third fixture was a movie with no file.
- Metadata fetchers were off. Media lives under `/test-media` (virtiofs; writes made inside the container, so inotify fires).
- Harness: `scratchpad/audit/measure.mjs`. It polls `/Items` every 0.5 s, reads entry detail and the files on disk, and
  listens to `LibraryChanged` on the websocket.
- Times are seconds from the action.

| Step | Result |
|---|---|
| Library scan of the partial series | native items 0.8; binding 1.5 |
| Sync Now (3 stubs in Shows, 1 movie stub) | Answer 0.2. Movie stub at 0.2; its empty root made the plugin queue a full scan, so the movie item came at 0.2 after a 1 s scan. **The TV batch yielded to that scan.** TV stubs were written at 86.3 and 89.3 by the first-run starter. Native items at 149.4 (stub in an existing season, 60.1 after its write) and 150.0 (new series, 63.7 after its write; refreshed as the whole `/test-media/tv` root). LibraryChanged at 30.1 (movie). |
| External real S01E02 linked beside its stub | item 60.2; bound 61.3 **with 2 versions (the stub is one)**; LibraryChanged 90.1 |
| Remove the last version of S01E01 | answer 0.2; native item gone ≤0.2; **no stub written in 150 s**; LibraryChanged 30.1 (removed) and 90.1 (updated) |
| Sync Now after that | stub on disk 0.1 and the S01E02 duplicate stub removed; native stub item and 1 version at 60.5; LibraryChanged 90.1 |
| Remove Entry (stub-only movie) | 204 at 0.1; stub and folder gone 0.1; **native placeholder movie still listed after 150 s and still at 4 min** (emptied root) |
| Remove Placeholders (Shows, 3 stubs) | answer 0.0; files gone 0.0; native items removed 60.1 (refresh of the `tv` root); LibraryChanged 90.1 |

**Earlier torrent-import runs on charlie** (runner `import-delay.mjs`, summaries in
`jellyfin-web-importdelay/node_modules/.cache/import-delay/{before-summary-v2,after3-summary}.json`):
- **Before:**
  - episode: Play 113, cloud 22.4;
  - pack: Play 105;
  - movie: Play 91.6.
- **Importdelay WIP plus queue wake:**
  - episode: Play 4.9 (season rows) and 4.5 (series card);
  - pack: Play 4.8 and 4.5;
  - movie: Play 3.1;
  - 0 cloud samples.

**Not measured** (estimated from code):
- reclaim (needs watched state and a retention window);
- replace or upgrade;
- partial, special-episode and series packs;
- Restore Watched;
- opt in;
- TMDb list load (needs TMDb; same writer as Sync Now);
- non-admin and native-client timing;
- the Pi (60 s monitor, but a full scan there takes minutes).

**Harness note:** Jellyfin 12's `/socket` refuses `api_key=` with 403 "Token is required" and accepts `ApiKey=`. A node
client must answer `ForceKeepAlive` only. My first harness also answered `KeepAlive` and flooded charlie's log
(about 260 MB). The log was discarded with the reset.
