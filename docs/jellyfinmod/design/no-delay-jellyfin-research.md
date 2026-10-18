# Jellyfin 12 delete path and plugin hooks: bringing placeholders back right after a delete

Source: [jellyfin/jellyfin tag v12.0](https://github.com/jellyfin/jellyfin/tree/v12.0) (commit `6c073e19`, `SharedVersion.cs` = 12.0.0),
cloned to `scratchpad/jf-src/jellyfin`. Every running instance (18096, 28096, local `echo` 12096) answers `Version 12.0.0`.
Their image label is `org.opencontainers.image.version=12.0`. Citations are `path:line` in that tree. **[S]** means I read it
in the source. **[L]** means I saw it in a live log or a read-only GET. **[I]** means inferred, not verified. Nothing was changed
on any instance.

## 0. Headline correction

**Jellyfin 12 *does* raise `ItemRemoved` for every descendant of a deleted Season or Series, children first, then the item
itself [S].** See `Emby.Server.Implementations/Library/LibraryManager.cs:554-556` (`children = folder.GetRecursiveChildren(false)`)
and `:618-624` (`// Announce the descendants before the item itself.` `foreach child → ReportItemRemoved(child, item)`, then
`ReportItemRemoved(item, parent)`). Two things make it look as if only the season is removed:
- Only the root item writes `Removing item, Type: …` (`:453-458`); the children are removed in silence. Live proof [L]: the
  28096 log for 2026-10-17 22:02:56.559 shows one `Removing item, Type: "Season" … /Season 01` line and one
  `Deleting item path` line, and nothing for its episodes.
- The plugin's `LibraryEventListener` turns an episode event into a reconcile of its **series**
  ([LibraryEventListener.cs:97](/Users/kxalex/Projects/jellyfin-mod/plugin-redelete/JellyfinMod/Services/LibraryEventListener.cs)),
  and that per-title reconcile never drops bindings. So the per-episode facts are thrown away inside the plugin.
  Jellyfin delivers them.

I did not decompile the shipped DLL; the instances run the v12.0 packaging, so this is source-verified only. A two-minute
live check is in the test plan (T1).

## 1. `DELETE /Items/{id}` step by step [S]

1. `Jellyfin.Api/Controllers/LibraryController.cs:362-397` `DeleteItem`: `GetItemById(itemId, user)` → `item.CanDelete(user)` →
   `_libraryManager.DeleteItem(item, new DeleteOptions { DeleteFileLocation = true }, true)` → `204`. `DELETE /Items?ids=`
   (`:406-444`) loops over the same call. It is **synchronous**: the 204 is sent only after every step below has finished,
   event handlers included.
2. `LibraryManager.DeleteItem(item, options, notifyParentItem)` (`:352-359`): `parent = item.GetOwner() ?? item.GetParent()`.
   `notifyParentItem` is not used anywhere in the body.
3. `DeleteItem(item, options, parent, notify)` (`:421-625`), in this order:
   - a. A primary or alternate video version is re-pointed first (`:461-552`). This does not apply to stubs.
   - b. `children = GetRecursiveChildren(false)` for a folder (`:554-556`). It is recursive through `Folder.Children`
     (`Folder.cs:1568-1608`): a Series yields its seasons and episodes, a Season its episodes.
   - c. Internal metadata folders (`/config/metadata/library/…`) of the item and every child are deleted (`:558-580`).
   - d. Files on disk, when `DeleteFileLocation && IsFileProtocol` (`:582-594`, `DeleteItemPath` `:627-679`,
     `Directory.Delete(recursive)` or `File.Delete`). The paths come from `GetDeletePaths()`:
     - Movie, a video not in a mixed folder: its whole **containing folder** (`Video.cs:727-741`).
     - Episode: the file plus same-name sidecars (`Episode.cs:288-297`, `BaseItem.cs:2577-2589`).
     - Season or Series: its folder, recursively (`BaseItem.cs:2569-2575`).
     The first path is required, so an `IOException` aborts the delete before any DB change.
   - e. `item.SetParent(null)` (`:596`). External data files (trickplay and similar) of the item and its children (`:598-603`).
   - f. **DB, one transaction** for the item and all its children: `ItemPersistenceService.DeleteItem`
     (`Jellyfin.Server.Implementations/Item/ItemPersistenceService.cs:50-149`). It adds owned descendants and extras, **parks
     UserData** (`ItemId := PlaceholderId 0…01`, `RetentionDate := now`, `:85-123`), and deletes ancestors, images,
     providers, people maps, streams, chapters, trickplay rows and the BaseItems.
   - g. The cache is evicted (`:606-610`). Then `parent.Children = null; parent.UserData = null` (`:612-616`).
   - h. **Events:** `ReportItemRemoved(child, item)` for every child, then `ReportItemRemoved(item, parent)` (`:618-624`).
4. `ReportItemRemoved` (`:2794-2813`) invokes the `ItemRemoved` multicast delegate **synchronously on the caller's thread**.
   `ItemChangeEventArgs` holds `{ Item, Parent }`; `UpdateReason` is never set on a removal
   (`MediaBrowser.Controller/Library/ItemChangeEventArgs.cs`).
   - The **Item** is the full in-memory BaseItem as it was: `Path`, `ProviderIds`, `IndexNumber`, `ParentIndexNumber`,
     `SeriesId` and the rest. It no longer exists in the DB or the cache, and its files are already gone.
   - **Parent** is the deleted root item for a child, and the surviving parent (series, season or library folder) for the root.
     So "parent still exists in the library" marks the root event, which is the last one.
   - One `try/catch` wraps the whole delegate. A handler that throws stops every handler after it, for example the
     LibraryMonitor's and the LibraryChangedNotifier's. **A plugin handler must never throw.**
5. Which thread `ItemRemoved` runs on [S]:
   - an API delete: the ASP.NET request thread;
   - the monitor's or a "Refresh metadata" refresh: the single refresh-queue consumer (`ProviderManager.cs:1163-1229`);
   - a library scan: the scheduled-task thread. A scan stops the LibraryMonitor for its whole duration
     (`LibraryManager.cs:1407-1422`, `LibraryMonitor.Stop()`).
   Scans and refreshes delete vanished items with `DeleteFileLocation = false` (`Folder.cs:499,575`). The same events fire
   for them.
6. Subscribers in core [S]:
   - `LibraryMonitor` stops a watcher only when the parent is the AggregateFolder (`LibraryMonitor.cs:164-170`).
   - `LibraryChangedNotifier` batches every removal, add and update for `LibraryUpdateDuration` (30 s). The window starts at
     the first event and is never extended. It then sends one `LibraryChanged` message to every user session, with episode
     ids included (`EntryPoints/LibraryChangedNotifier.cs:181-213`, `:195`, `:215-307`, `:355-368`).
   - `ItemAdded` is raised by `CreateItems` after the save, per item, with `Parent` (`LibraryManager.cs:2478-2516`).

## 2. Ways a plugin can react or intercept [S]

- **There is no pre-delete event.** I found no `ItemDeleting`, delete handler or pre-delete interface in the Controller.
  `ISupportsDelete` exists for channels only. `ItemRemoved` fires **after** the files, the DB rows and the cache entries are
  gone, but it carries the full item objects.
- **An MVC action filter is a real pre-delete and post-delete hook, and the plugin already has the plumbing.** Plugin service
  registrators run inside the host's `ConfigureServices` (`ApplicationHost.cs:490-492`), before `AddMvc`
  (`Jellyfin.Server/Extensions/ApiServiceCollectionExtensions.cs:120`). `services.Configure<MvcOptions>(o => o.Filters.AddService<…>())`
  is already proven live for `PlaceholderFilter`
  ([PluginServiceRegistrator.cs:111](/Users/kxalex/Projects/jellyfin-mod/plugin-redelete/JellyfinMod/PluginServiceRegistrator.cs)).
  Its action map keys are `Controller.Action`, so `Library.DeleteItem` and `Library.DeleteItems` can be added.
  - Before `next()`: the item still exists, so its path, ids and `GetRecursiveChildren(false)` can be read.
  - After `next()` with a `NoContentResult`: files, rows and events are done, and the HTTP response has **not** been sent yet.
  - This covers every client that uses the API (web, Swiftfin, Android). It does not cover a delete made on disk.
- **`ILibraryManager.ItemRemoved` / `ItemAdded` / `ItemUpdated`** cover every removal source (API, monitor, scan, other
  plugins). Subscribe in an `IHostedService`, as the plugin does now.
- **`ILibraryPostScanTask.Run`** (`ILibraryPostScanTask.cs:10-19`) runs after a full scan. It is a natural point for the
  "server was down" repair.
- **`ILibraryMonitor`** (`ILibraryMonitor.cs`):
  - `ReportFileSystemChanged(path)` (`LibraryMonitor.cs:356-393`) invalidates the DirectoryService entry, honours the ignore
    list, then `CreateRefresher` (`:395-437`) **waits `LibraryMonitorDelay`**. It does not speed anything up.
  - `ReportFileSystemChangeBeginning(path)` (`:76-81`) adds the path to an ignore list. Events on that path, below it, or on
    its direct parent are dropped (`:373-390`).
  - `ReportFileSystemChangeComplete(path, refresh)` (`:84-106`) removes the path from the list only after a **hard 45 s
    `Task.Delay`**, then optionally reports the change.
- **`DeleteOptions`** has only `DeleteFileLocation` and `DeleteFromExternalProvider` (`DeleteOptions.cs:5-16`). The API always
  sends `DeleteFileLocation = true`. Neither is visible to an `ItemRemoved` handler.
- **How the built-in watcher reacts** [S] [L]:
  - One `FileSystemWatcher` per library root, recursive, for Created, Deleted, Renamed and Changed (`LibraryMonitor.cs:221-274`),
    and only when `LibraryOptions.EnableRealtimeMonitor` is set (`:108-118`). It is on for Movies and Shows on 18096 and 28096 [L].
  - Each event joins a refresher for the same path, a parent, a child or a sibling, and **restarts its timer** to
    `LibraryMonitorDelay` (`FileRefresher.cs:63-86`). This is a debounce: every new event pushes the deadline out again.
  - When the timer fires, each path maps to `FindByPath` walking up to the nearest DB item, then to the first one that still
    exists on disk (`:163-189`). That item gets `ChangedExternally()` (`:130-156`).
  - So a deleted season folder means a refresh of its series 60 s later. Live [L]: deleted 22:02:56.6, `"Adolescence" … will be
    refreshed` at 22:03:56.7.
  - **Our own writes retrigger it** (they are ordinary Created events). Unless they are ignored through `…Beginning`, they
    push the timer out by another 60 s, which accounts for part of the 60–170 s observed.

## 3. Making Jellyfin pick up new files fast, by cost [S]

| Call | What it really does | Cost |
|---|---|---|
| `ILibraryMonitor.ReportFileSystemChanged(p)` | Queues a debounced refresher, then `ChangedExternally` after `LibraryMonitorDelay` | 60 s+ wait |
| `BaseItem.ChangedExternally()` (`BaseItem.cs:2246-2249`) | `QueueRefresh(Id, new MetadataRefreshOptions(new DirectoryService), High)`; the queue then runs `RefreshItem` = `item.RefreshMetadata` + `folder.ValidateChildren(recursive: true)` (`ProviderManager.cs:1134-1161,1231-1245`) | One **serial** queue for the whole server: waits behind the refresh that is running |
| `Folder.ValidateChildren(progress, opts, recursive, …)` (`Folder.cs:308-312`) | Resolves the folder's children from disk, deletes the vanished ones, `CreateItems` the new ones (`:454-583`), recurses into subfolders (`:713-732`), then **always** refreshes child metadata (`:734-771`) | On a **Series** (`IMetadataContainer`): `series.RefreshMetadata` plus `RefreshAllMetadata` of every season and episode (`:784-792`, `Series.cs:333-378`). On a library root: the whole library, almost a full scan |
| `IProviderManager.RefreshFullItem(item, opts, ct)` (`ProviderManager.cs:1291-1294`) | The same as the queue's `RefreshItem`, but **direct**, without the queue | Same as above, no queue wait |
| `ILibraryManager.ResolvePath(fileInfo, parent, ds, collectionType)` + `CreateItem(item, parent)` (`LibraryManager.cs:820-825,2430-2433`) | Jellyfin's own resolver: the Id comes from the path (`ResolverHelper.cs:73-76`, `GetNewItemId` `:792-817`), then it is saved and `ItemAdded` is raised. This is exactly what `ValidateChildren` does for one new child (`Folder.cs:504-505,582`) | Proportional to the recreated subtree only |
| `ValidateMediaLibrary` / `QueueLibraryScan` (`:1393-1400,3267-3270`) | Cancels and re-queues the full scan task | Full scan; also stops the monitor |
| `RefreshSingleItem` | `RefreshMetadata` of one item only; creates no children | Cheap, but no creation |

What the metadata refresh costs:
- A brand-new item (`DateLastRefreshed == MinValue`, `MetadataService.cs:95`) runs **all** providers, including TMDb remote
  metadata and images (`:650-654`), and on its first save **re-attaches parked user data** (`:261,308-314`).
- Existing items under `MetadataRefreshMode.Default` run only providers whose `HasChanged` says so (`:656-672`). That means
  local work only: image validation plus NFO and date checks.
- `.disc` stubs are never probed (`MediaInfo/ProbeProvider.cs:282`).
- The `Default` options are what `ChangedExternally` uses. Only `ReplaceAllMetadata` or `FullRefresh` force remote calls on
  existing items.

**Recommended call per case.** Always build the options as `new MetadataRefreshOptions(new DirectoryService(fileSystem))`
(Default mode); a fresh DirectoryService avoids the 5-minute singleton cache (`DirectoryService.cs:19`).
- **(a) Season folder recreated inside an existing series.** Nearest item: the **Series**.
  - Simplest: `await series.ValidateChildren(new Progress<double>(), opts, recursive: true, cancellationToken: ct)`. It creates
    the Season and its Episodes, which get their TMDb metadata, and the user data comes back. Every other season and episode
    gets only a local `RefreshMetadata`.
  - Cheaper and scoped: `season = library.ResolvePath(fs.GetDirectoryInfo(seasonDir), series, ds, CollectionType.tvshows)` →
    `library.CreateItem(season, series)` → `await providerManager.RefreshFullItem(season, opts, ct)`. `SeasonResolver`
    needs `Parent is Series` (`Resolvers/TV/SeasonResolver.cs:50-62`).
- **(b) Whole series folder recreated.** Nearest item: the library's **physical root Folder** (`FindByPath(location, true)`;
  `IsTopParent` because its parent is the AggregateFolder, `BaseItem.cs:763-766`). **Do not** refresh the root: that is
  `RefreshAllMetadata` for every series in the library. Instead: `ResolvePath(seriesDir, root, ds, tvshows)` (it picks up
  `[tmdbid-N]` from the folder name) → `CreateItem(series, root)` → `RefreshFullItem(series, opts)`. That refreshes the series
  and creates its seasons and episodes.
- **(c) Movie folder recreated.** Nearest item: the **physical root** (a Movie's `Path` is its file, so the folder has no
  item). Use `ResolvePath(movieDir, root, ds, movies)` → `CreateItem` → `RefreshFullItem(movie)`, which is only a
  `RefreshMetadata`.
  - Today's `FolderRefresh.Now` / `ImportService.RefreshNow` calls `root.ChangedExternally()`, which validates and refreshes
    every movie [S].
  - This is still acceptable for the import, but it is the expensive path [I].
- **(d) A library root that was emptied.** `IsLibraryFolderAccessible` **skips validating a top-level folder whose directory
  is empty** (`Folder.cs:383-388`, `DirectoryService.IsAccessible` = "has any entry", `DirectoryService.cs:181-184`). That is
  Jellyfin's unmounted-drive guard. The plugin's own refusal to treat an empty folder as proof of absence matches it and
  should stay.
  - Once a stub is written the root is non-empty again, so use case (b) or (c) against the root.
  - For an API delete the proof of absence is the delete itself (§7), not the disk.

## 4. Delays and batching settings [S] [L]

| Setting | Default | Where | Read when |
|---|---|---|---|
| `ServerConfiguration.LibraryMonitorDelay` | **60 s** (`ServerConfiguration.cs:172`) | `IServerConfigurationManager.Configuration` → `system.xml`; 60 on 18096 and 28096 [L] | Every timer (re)start (`FileRefresher.cs:79,83`), so a change applies live |
| `ServerConfiguration.LibraryUpdateDuration` | **30 s** (`:178`) | same; 30 on both [L] | At the start of each batch (`LibraryChangedNotifier.cs:195`), live |
| `LibraryOptions.EnableRealtimeMonitor` | per library (`LibraryOptions.cs:47`) | `root/default/<lib>/options.xml`; on for Movies and Shows [L] | When the monitor starts |
| `LibraryScanFanoutConcurrency` | 0 = auto (`:246`) | `system.xml` | Scan concurrency only, unrelated |

- There is no Dashboard field for either delay in this web fork (a grep finds nothing). They can be changed through
  `POST /System/Configuration` (`ConfigurationController.cs:21,62-65`, admin, full object), by editing `system.xml`, or from a
  plugin (`config.Configuration.LibraryMonitorDelay = n; config.SaveConfiguration();`, persisted, raises `ConfigurationUpdated`).
- **Risk of lowering `LibraryMonitorDelay` to 1–5 s** [I, reasoned from the code comment at `ServerConfiguration.cs:166-170`
  and `FileRefresher`]:
  - A file that is still being written (a Transmission or qBittorrent move, a network copy that pauses for more than N s) is
    resolved half-written, and a large import causes refresh churn.
  - The setting is server-wide and also hits production habits.
  - It is not needed when the plugin creates the items itself, so **leave it alone.**
- **Websocket batching.** The `LibraryChanged` window cannot be shortened per client, only server-wide. The mod web adds its
  own **10 s debounce** on top (`queryClientEventHandler.tsx:60-67`). Real latency is therefore 30 s + 10 s after the change.
  - A plugin may push its own message at once:
    `ISessionManager.SendMessageToUserSessions(userIds, SessionMessageType.LibraryChanged, new LibraryUpdateInfo { ItemsAdded = … }, ct)`
    (`ISessionManager.cs:207`). The normal batch still follows, so clients refresh twice, which is harmless [I].
  - For the deleting client this is unnecessary when the 204 is held until the items exist (§7). `deleteHelper.js:58-63`
    navigates to the parent only after the 204 and re-reads it.

## 5. Children and user data after a delete [S]

- Enumerating the removed children: no pre-query is needed. The plugin receives one `ItemRemoved` per descendant, with full
  objects (§1.3h).
  - Alternative 1: the MVC filter's pre-phase can take `GetRecursiveChildren(false)`, the same list.
  - Alternative 2, afterwards: compare bindings by path prefix (`binding.MediaPath` starts with `deletedRoot.Path + '/'`).
    This is the right fallback for a server-down delete, where no event ever arrives.
- **User data parking.** On delete, every UserData row of the item and its descendants moves to `PlaceholderId` with
  `RetentionDate = now` (`ItemPersistenceService.cs:85-123`). An older parked row with the same `(UserId, CustomDataKey)` is
  deleted first. **Re-attachment** moves the parked rows whose key is in the new item's `GetUserDataKeys()` back to that item
  (`:212-245`).
  - It runs on the new item's **first** metadata save (`MetadataService.cs:261,308-314`), and in `ValidateChildren` after a
    removal (`Folder.cs:685-697`).
  - Episode keys are `<series provider key> + SSS + EEE`, plus the episode Id (`Episode.cs:162-188`). Movie keys are the
    TMDb and IMDb ids plus the Id (`Video.cs:293-312`, `BaseItem.cs:1704-1718`). The Id itself comes from the path and the
    type (`LibraryManager.cs:792-817`).
  - So **recreating the same path, or the same provider ids, brings played, favourite and position back with no plugin
    code** (also design experiment X3).
  - Requirement: the parent series must have its provider ids when the episode first refreshes. That holds in (a). In (b) the
    resolver takes `[tmdbid-N]` from the folder name, and `RefreshFullItem` refreshes the series before its children [I].
- **"90 days"**: `CleanupUserDataTask` deletes parked rows older than 90 days (`ScheduledTasks/Tasks/CleanupUserDataTask.cs:54-66`),
  but it has **no default trigger** (`:73-76`, `yield break`). By default parked data is kept until an admin runs that task.

## 6. Jellyfin's own missing episodes and `.disc` stubs [S]

- Jellyfin 12 core ships **`TmdbMissingEpisodeProvider`** (`MediaBrowser.Providers/Plugins/Tmdb/TV/TmdbMissingEpisodeProvider.cs:21`).
  - It is an `ICustomMetadataProvider<Series>`, opt-in per library: `ImportMissingEpisodes`, `ImportUnairedEpisodes`,
    `ImportSpecials`, `EnabledMissingEpisodeLibraries` (`Tmdb/Configuration/PluginConfiguration.cs:43-66`).
  - It creates path-less `IsVirtualItem` Seasons and Episodes (`:225-241,577-601`) and deletes them again when the feature is
    off (design E2).
- It writes no files, but it differs from stubs:
  - Virtual items are hidden unless the user turns on *Display missing episodes* (`TvShowsController.cs:231`,
    `Folder.cs:1883`, `Series.cs:250`).
  - They are excluded from Next Up (`NextUpService.cs:166,200,248`), from series counts (`ItemCountService.cs:484`) and from the
    web Favourites tab (`ExcludeLocationTypes=Virtual`, design E1).
  - There is **no virtual Movie and no virtual Series**: a series with no folder cannot exist.
  - Watched and favourite state is stored and re-attaches by key (E1, E3). iOS, Android TV and Kodi treat `LocationType Virtual`
    as "missing", and may hide it or show it dimmed [I].
- The earlier choice of `.disc` stands for movies and whole series
  ([missing-media-user-actions.md:45-125](/Users/kxalex/Projects/jellyfin-mod/jellyfin-web-nextrelease/docs/jellyfinmod/design/missing-media-user-actions.md)).
  Stubs give real items with `IsPlaceHolder: true`, full metadata and counts for every client.
- Virtual episodes could only replace stubs for episodes of a series that has real files. It would cost Favourites tab
  visibility, counts and the plugin's Next Up shaping. Not recommended.

## 7. Recommended design

Principles:
- The decision is **state-based and idempotent**. A title's desired state comes from the catalog: an episode or movie with no
  real file should have exactly one plugin stub. Events are only triggers.
- That makes our own writes and removals harmless as loop sources. Running the routine a second time does nothing.
- `PlaceholderStub.NoteRemoved` remains only to save work, not to keep things correct.

Steps:
1. **API delete, synchronous: the "no gap" path.** Add `Library.DeleteItem` and `Library.DeleteItems` to the filter, or to a
   small sibling filter.
   - **Before `next()`:** resolve the item(s) and snapshot `{type, path, provider ids, library root, series path}`. Optionally
     call `libraryMonitor.ReportFileSystemChangeBeginning(deletePath)` so that neither Jellyfin's delete nor our recreation
     starts a 60 s monitor refresh. This matters most for a movie, whose refresher would refresh the whole movies root.
   - **After `next()` returns 204:**
     - a. In the catalog, drop the bindings of the deleted ids whose files are gone. The delete itself proves the absence, so
       no empty-folder check is needed.
     - b. Write the title's stubs (the existing sync code, for that one title).
     - c. Create the items directly, per §3: (a) `series.ValidateChildren`, or the scoped `ResolvePath + CreateItem +
       RefreshFullItem`; (b), (c), (d) `ResolvePath + CreateItem + RefreshFullItem` under the physical root.
     - d. `ReportFileSystemChangeComplete(deletePath, false)`.
     - Bound the wait with `await Task.WhenAny(work, Task.Delay(5 s))`. If it takes longer, return the 204 anyway and let the
       work finish in the background. Never throw into the action: catch, log and fall through.
   - The response then reaches the web after the items exist. `deleteHelper` re-reads the parent and the season or movie is
     there.
2. **Any other removal: deferred.** Examples are a delete on disk while the server runs, or one a scan or monitor finds. Keep
   an `ItemRemoved` listener that **only records** `(item.Id, item.Path, type, series path)` into a set. It must not block,
   query the DB or throw, because it can run on the refresh-queue consumer or the scan thread.
   - Detect the root event (`e.Parent` still exists) or use a 1 s quiet window.
   - Wait while `library.IsScanRunning` is true.
   - Then run the same per-title routine as in step 1, minus the HTTP hold.
   - Skip ids the filter already handled (a short-lived set), or just let idempotency make the second run a no-op.
3. **Server-down deletes.** At startup, after `IsScanRunning` turns false, and in an `ILibraryPostScanTask`, run the existing
   `RepairVanishedAsync`. It compares binding paths with the disk, keeps the empty-folder and mount guards, and feeds the
   same routine.
4. **Hazards:**
   - **Never wait on `QueueRefresh` or `ChangedExternally` from inside an `ItemRemoved` handler.** The queue has a single
     consumer that may be the thread running the handler, so the wait deadlocks it.
   - A slow or throwing handler blocks or silences the core subscribers (§1.4).
   - Serialise the per-title work with one `SemaphoreSlim` per title id, so the filter path and the listener path never write
     the same folder at once.
   - Racing a monitor-triggered `ValidateChildren` of the same folder is tolerable: Ids come from the path and `SaveItems`
     is an upsert [S]. A duplicate create collapses into one row [I].
   - The `…Beginning` ignore lasts at least 45 s. An import that writes a real file into that path within the window must
     use its own `RefreshNow`, which it already does.

Sequence for a season delete through the API:

```
Web DELETE /Items/{season}
 └ filter.pre: snapshot season (+episodes), monitor.Begin(seasonDir)
   └ LibraryManager.DeleteItem: rm -r seasonDir → DB txn (user data parked) → ItemRemoved ×(N eps) → ItemRemoved(season)
       └ listener: record only (cheap)
 └ filter.post(204): catalog drop bindings → write Season NN/*.disc → series.ValidateChildren(Default)
       → CreateItems(season, episodes) → ItemAdded → first refresh (TMDb) → ReattachUserData (✓/♥ back)
   monitor.Complete(seasonDir,false) → return 204
Web: showItem(series) → GET seasons → season present.  Other clients: LibraryChanged after 30 s (+10 s mod debounce)
```

## 8. Test plan

- **T1, verify §0 live (read-only apart from the test delete).** On a leased instance, add a temporary debug log to the
  `ItemRemoved` listener, delete one placeholder season through the API, and count one event per episode plus one for the
  season, with `Parent` being the season and then the series.
- **T2, E2E through the real API on a leased local environment or 18096.** For each case, measure the time from the start of
  the DELETE to the item appearing in `GET /Shows/{id}/Seasons`, `/Shows/{id}/Episodes` or `/Items?parentId=<root>`. Target:
  under 5 s, with the item present in the first GET after the 204.
  - Season of a series that has other real seasons.
  - Whole series.
  - Movie.
  - The last title in a library.
- **T3, user data.** Mark an episode, a movie and the series as played and favourite, delete, and check that played,
  favourite and date return on the new items.
- **T4, no loops.** After a recreation, nothing for 2 minutes: no further `Removing item`, no repeated writes, and at most one
  monitor refresh in the log (none with the `Beginning` suppression).
- **T5, plugin-own removals.** The import swap (stub → real file), *Remove Placeholders* and *Remove Entry* recreate nothing.
- **T6, disk delete while the server runs.** `rm -r` a season folder: the stubs return after the monitor delay plus about 1 s.
  **Server-down delete:** stop the container, `rm -r`, start it: the stubs return after startup without a full scan.
- **T7, guards.** On an unmounted or empty library root nothing is written, and the absence check refuses as before.
- **T8, timing.** Rerun the matrix on the Pi (Chromium first, then real Chrome) for the web re-read after the delete.
