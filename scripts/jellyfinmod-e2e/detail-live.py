#!/usr/bin/env python3
"""Fixtures for the detail page design fix acceptance (fix/detail-page-design, 2026-10-07) on the isolated instance 18096.

Runs on the Pi against disposable fixtures only (titles `JellyfinMod DD ...` in two disposable libraries on the writable
test media root). Refuses any instance but jellyfinmod-test on 18096. Adapted from v1-live.py: before retention is
switched on, every binding outside the fixtures is kept per file (recorded, and released by `retention-restore`). The
session token is kept in a 0600 file and never printed.

Environment:
  JFMOD_BASE            http://127.0.0.1:18096
  JFMOD_STATE_DIR       private directory for the token and the saved settings (created 0700)
  JFMOD_HOST_ROOT       /mnt/4tb/jellyfin-mod/test/media (mounted read-write in the container at JFMOD_CONTAINER_ROOT)
  JFMOD_CONTAINER_ROOT  /test-media

Commands (in order): login | health | media | library | ids | fileless | user-add | save | protect | retention-on MIN |
  watch KEY | window KEY DAYS | state KEY | make KEY,KEY | retention-restore | cleanup | logout
"""
import json, os, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

BASE = os.environ["JFMOD_BASE"].rstrip("/")
STATE = os.environ["JFMOD_STATE_DIR"]
HOST_ROOT = os.environ["JFMOD_HOST_ROOT"].rstrip("/")
CONTAINER_ROOT = os.environ["JFMOD_CONTAINER_ROOT"].rstrip("/")
CONTAINER = "jellyfinmod-test"
PORT = 18096
ADMIN = "oleksii"
ORDINARY = "jfmod-dd-user"
TOKEN_FILE = os.path.join(STATE, "token")
RESTORE = os.path.join(STATE, "restore.json")
PLUGIN = "6f1a2b3c4d5e4f609a718b2c3d4e5f60"
AUTH = 'MediaBrowser Client="JellyfinMod DD live", Device="dd-live", DeviceId="jfmod-dd-live", Version="1"'

FIXTURE_DIR = "dd"
MOVIES = f"{FIXTURE_DIR}/movies"
SHOWS = f"{FIXTURE_DIR}/shows"
MOVIE_LIBRARY = "JellyfinMod DD Movies"
SHOW_LIBRARY = "JellyfinMod DD Shows"
MOVIE = "JellyfinMod DD Movie (2011) [tmdbid-9910001]"
SERIES = "JellyfinMod DD Show (2020) [tmdbid-9910100]"
SEASON = f"{SHOWS}/{SERIES}/Season 01"
EP = "JellyfinMod DD Show (2020)"
# key: (directory, file name, width, height, audio channels)
FIXTURE = {
    "Movie": (f"{MOVIES}/{MOVIE}", f"{MOVIE} - 1080p.mkv", 1920, 1080, 2),
    "E01": (SEASON, f"{EP} S01E01.mkv", 1920, 1080, 2),
    "E02-1080p": (SEASON, f"{EP} S01E02 - 1080p.mkv", 1920, 1080, 6),
    "E02-720p": (SEASON, f"{EP} S01E02 - 720p.mkv", 1280, 720, 2),
    "E03": (SEASON, f"{EP} S01E03.mkv", 1280, 720, 2),
    "E04-1080p": (SEASON, f"{EP} S01E04 - 1080p.mkv", 1920, 1080, 2),
    "E04-720p": (SEASON, f"{EP} S01E04 - 720p.mkv", 1280, 720, 2),
}
# A real TMDB film for the file-less page, used only if it is not already in the instance's libraries.
FILELESS_CANDIDATES = [653, 10331, 961, 3082]


def refuse(reason):
    sys.exit(f"REFUSED (not the isolated instance): {reason}")


def guard_target():
    target = urllib.parse.urlsplit(BASE)
    if target.port != PORT:
        refuse(f"JFMOD_BASE must use port {PORT}")
    # The API must be the inspected local container's published port, so API changes and file changes hit one instance.
    if target.hostname not in ("127.0.0.1", "localhost"):
        refuse("JFMOD_BASE must be the loopback address of this host's jellyfinmod-test")
    inspected = json.loads(subprocess.run(["docker", "inspect", CONTAINER], capture_output=True, text=True, timeout=60,
                                          check=True).stdout)[0]
    published = {binding.get("HostPort") for bindings in (inspected.get("NetworkSettings", {}).get("Ports") or {}).values()
                 for binding in (bindings or [])}
    if str(PORT) not in published:
        refuse(f"{CONTAINER} does not publish {PORT}")
    if not any(os.path.realpath(m.get("Source", "")) == os.path.realpath(HOST_ROOT) and m.get("Destination") == CONTAINER_ROOT
               and m.get("RW") for m in inspected.get("Mounts") or []):
        refuse("JFMOD_HOST_ROOT is not the read-write mount at JFMOD_CONTAINER_ROOT")


guard_target()


def write_private(path, data):
    os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.write(fd, data.encode())
    os.close(fd)


def call(method, path, body=None, anonymous=False):
    header = AUTH if anonymous else AUTH + f', Token="{open(TOKEN_FILE).read().strip()}"'
    request = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None, method=method,
                                     headers={"Content-Type": "application/json", "Authorization": header})
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            text = response.read().decode()
            return response.status, (json.loads(text) if text else None)
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode()[:600]
    except (urllib.error.URLError, OSError) as error:
        return 0, f"{type(error).__name__}: {error}"


def must(method, path, body=None, ok=(200, 201, 202, 204)):
    for _ in range(1, 5 if method == "GET" else 2):
        status, result = call(method, path, body)
        if status in ok:
            return result
        if method == "GET" and (status == 0 or status >= 500):
            time.sleep(10)
            continue
        break
    sys.exit(f"FAIL {method} {path} -> {status} {str(result)[:300]}")


def check(condition, message):
    print(("PASS " if condition else "FAIL ") + message, flush=True)
    if not condition:
        sys.exit(1)


def user_id(name=ADMIN):
    return next(u for u in must("GET", "/Users") if u["Name"] == name)["Id"]


def task(key):
    return next(t for t in must("GET", "/ScheduledTasks") if t["Key"] == key)


def run_task(key, timeout=900):
    started = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime())
    task_id = task(key)["Id"]
    must("POST", f"/ScheduledTasks/Running/{task_id}")
    begin = time.time()
    while time.time() - begin < timeout:
        time.sleep(3)
        current = must("GET", f"/ScheduledTasks/{task_id}")
        last = current.get("LastExecutionResult") or {}
        if current["State"] == "Idle" and last.get("StartTimeUtc", "") >= started:
            return last.get("Status")
    sys.exit(f"TIMEOUT waiting for {key}")


def wait_scan():
    time.sleep(5)
    for _ in range(300):
        if task("RefreshLibrary")["State"] == "Idle":
            return
        time.sleep(3)
    sys.exit("TIMEOUT waiting for the library scan")


def library(name):
    for _ in range(40):
        found = next((f for f in must("GET", "/Library/VirtualFolders") if f["Name"] == name), None)
        if found is None or found.get("ItemId"):
            return found
        time.sleep(3)
    sys.exit(f"library {name} never got an item id")


def host_path(key):
    directory, name = FIXTURE[key][:2]
    return os.path.join(HOST_ROOT, directory, name)


def container_path(key):
    directory, name = FIXTURE[key][:2]
    return f"{CONTAINER_ROOT}/{directory}/{name}"


def make_video(key):
    _, _, width, height, channels = FIXTURE[key]
    target = host_path(key)
    os.makedirs(os.path.dirname(target), exist_ok=True)
    if os.path.exists(target):
        return
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"testsrc=duration=20:size={width}x{height}:rate=5",
                    "-f", "lavfi", "-i", "sine=frequency=440:duration=20", "-c:v", "libx264", "-preset", "ultrafast",
                    "-c:a", "aac", "-ac", str(channels), "-shortest", "-metadata", f"title=JellyfinMod DD {key}", target], check=True)


def scan():
    must("POST", "/Library/Refresh")
    wait_scan()
    print("reconcile", run_task("JellyfinModCatalogReconciliation"))


def library_options(paths):
    return {"LibraryOptions": {"EnableRealtimeMonitor": False, "EnableInternetProviders": False,
                               "TypeOptions": [{"Type": t, "MetadataFetchers": [], "ImageFetchers": []}
                                               for t in ("Series", "Season", "Episode", "Movie")],
                               "PathInfos": [{"Path": p} for p in paths]}}


def all_entries():
    found, start = [], 0
    while True:
        page = must("GET", f"/JellyfinMod/Entries?startIndex={start}&limit=200")
        found += page["items"]
        start += len(page["items"])
        if not page["items"] or start >= page["totalRecordCount"]:
            return found


def item_by_path(key):
    items = must("GET", f"/Users/{user_id()}/Items?Recursive=true&IncludeItemTypes=Movie,Episode&Fields=Path,MediaSources"
                 f"&SearchTerm={urllib.parse.quote('JellyfinMod DD')}")["Items"]
    items += must("GET", f"/Users/{user_id()}/Items?Recursive=true&IncludeItemTypes=Episode&Fields=Path,MediaSources"
                  f"&ParentId={library(SHOW_LIBRARY)['ItemId']}")["Items"]
    target = container_path(key)
    for item in items:
        if item.get("Path") == target or any(s.get("Path") == target for s in item.get("MediaSources") or []):
            return item
    sys.exit(f"no item for {key}")


def series_entry():
    lib = library(SHOW_LIBRARY)
    items = must("GET", f"/JellyfinMod/Entries?targetLibraryId={lib['ItemId']}&limit=100")["items"]
    found = next((e for e in items if e["tmdbId"] == 9910100), None)
    return must("GET", f"/JellyfinMod/Entries/{found['id']}") if found else None


def episode_of(key):
    series = series_entry()
    number = int(key[1:3])
    return series, next(e for e in series["episodes"] if e["seasonNumber"] == 1 and e["episodeNumber"] == number)


def cmd_login():
    status, result = call("POST", "/Users/AuthenticateByName", {"Username": ADMIN, "Pw": ""}, anonymous=True)
    if status != 200:
        sys.exit(f"login failed {status}")
    write_private(TOKEN_FILE, result["AccessToken"])
    print("signed in as", result["User"]["Name"], "admin", result["User"]["Policy"]["IsAdministrator"])


def cmd_logout():
    if os.path.exists(TOKEN_FILE):
        call("POST", "/Sessions/Logout")
        os.remove(TOKEN_FILE)
    print("signed out")


def cmd_health():
    health = must("GET", "/JellyfinMod/Health")
    caps = set(health.get("Capabilities") or [])
    print("version", health.get("Version"), "bundle", (health.get("Web") or {}).get("BundleId"), "web",
          (health.get("Web") or {}).get("WebCommit"))
    check({"versions", "versions.v1", "versions.remove", "retention.versionKeep", "history.files"} <= caps,
          "Health lists versions, versions.v1, versions.remove, retention.versionKeep and history.files")


def cmd_media():
    for key in FIXTURE:
        make_video(key)
    print("fixtures", sum(os.path.exists(host_path(key)) for key in FIXTURE), "files")


def cmd_library():
    for name, kind, path in ((MOVIE_LIBRARY, "movies", f"{CONTAINER_ROOT}/{MOVIES}"),
                             (SHOW_LIBRARY, "tvshows", f"{CONTAINER_ROOT}/{SHOWS}")):
        if library(name) is None:
            query = urllib.parse.urlencode({"name": name, "collectionType": kind, "refreshLibrary": "true"})
            must("POST", f"/Library/VirtualFolders?{query}", library_options([path]))
        wait_scan()
    scan()


def cmd_ids():
    """The runner's environment: native item ids of the fixtures, and the file-less entry when it exists."""
    lines = {"JELLYFINMOD_DD_ONE": item_by_path("E01")["Id"], "JELLYFINMOD_DD_TWO": item_by_path("E02-1080p")["Id"],
             "JELLYFINMOD_DD_MOVIE": item_by_path("Movie")["Id"], "JELLYFINMOD_DD_REMOVE": item_by_path("E04-1080p")["Id"],
             "JELLYFINMOD_DD_E03": item_by_path("E03")["Id"]}
    saved = json.load(open(RESTORE)) if os.path.exists(RESTORE) else {}
    if saved.get("fileless"):
        lines["JELLYFINMOD_DD_FILELESS"] = saved["fileless"]
    for key, value in lines.items():
        print(f"{key}={value}")
    series = series_entry()
    for episode in series["episodes"]:
        print("episode", episode["episodeNumber"], "versions", len(episode.get("versions") or []), "state", episode["state"])


def cmd_fileless():
    """A file-less movie entry in the disposable movie library, from a real TMDB film the instance does not hold."""
    saved = json.load(open(RESTORE))
    if saved.get("fileless"):
        print("file-less entry exists")
        return
    lib = library(MOVIE_LIBRARY)
    held = {e["tmdbId"] for e in all_entries()}
    tmdb = next(t for t in FILELESS_CANDIDATES if t not in held)
    created = must("POST", "/JellyfinMod/Entries", {"mediaType": "movie", "tmdbId": tmdb, "targetLibraryId": lib["ItemId"]})
    entry = created["entry"]
    check(entry["state"] == "none", f"file-less entry {entry['title']} ({tmdb}) is not downloaded")
    saved["fileless"] = entry["id"]
    write_private(RESTORE, json.dumps(saved))


def cmd_user_add():
    """A disposable ordinary user with an empty password, on this test instance only; deleted by cleanup."""
    if any(u["Name"] == ORDINARY for u in must("GET", "/Users")):
        print("user exists")
        return
    created = must("POST", "/Users/New", {"Name": ORDINARY, "Password": ""})
    policy = must("GET", f"/Users/{created['Id']}")["Policy"]
    check(not policy["IsAdministrator"], f"{ORDINARY} is an ordinary user")


def cmd_save():
    if os.path.exists(RESTORE):
        sys.exit("restore file exists; not overwriting")
    saved = {"retention": must("GET", "/JellyfinMod/Settings/Retention"),
             "testWindowMinutes": must("GET", f"/Plugins/{PLUGIN}/Configuration").get("RetentionTestWindowMinutes", 0),
             "keeps": []}
    write_private(RESTORE, json.dumps(saved))
    print("saved: retention enabled", saved["retention"]["enabled"], "window", saved["testWindowMinutes"])


def fixture_libraries():
    return {lib["ItemId"].replace("-", "").lower() for lib in (library(MOVIE_LIBRARY), library(SHOW_LIBRARY)) if lib}


ORPHANS = set()


def unprotected():
    """Every binding outside the DD fixture libraries that nothing keeps per file (retention preview and every catalog page)."""
    missing = {}
    fixtures = fixture_libraries()
    for item in must("GET", "/JellyfinMod/Retention/Preview")["items"]:
        if (item.get("targetLibraryId") or "").replace("-", "").lower() in fixtures and \
                (item.get("path") or "").startswith(f"{CONTAINER_ROOT}/{FIXTURE_DIR}/"):
            continue
        if item.get("reason") == "version_kept":
            continue
        # A binding whose file under the writable test root no longer exists (an earlier run's fixture whose library and
        # files are gone) leaves retention nothing to delete; it is reported, not kept.
        path = item.get("path") or ""
        if path.startswith(CONTAINER_ROOT + "/") and not os.path.exists(HOST_ROOT + path[len(CONTAINER_ROOT):]):
            ORPHANS.add(item["bindingId"])
            continue
        missing[item["bindingId"]] = (item["entryId"], (item.get("path") or "no path").rsplit("/", 1)[-1])
    for entry_row in all_entries():
        if (entry_row.get("targetLibraryId") or "").replace("-", "").lower() in fixtures:
            continue
        detail = must("GET", f"/JellyfinMod/Entries/{entry_row['id']}")
        rows = list(detail.get("versions") or [])
        for episode_row in detail.get("episodes") or []:
            rows += episode_row.get("versions") or []
        for version in rows:
            if version.get("tracked") is not False and not version.get("kept"):
                missing.setdefault(version["bindingId"], (entry_row["id"], entry_row["title"]))
    return missing


def cmd_protect():
    saved = json.load(open(RESTORE))
    recorded = {binding for _, binding in saved["keeps"]}
    for binding_id, (entry_id, _) in unprotected().items():
        # Journalled once, before the first request: a Keep the server applied but whose answer was lost is still released
        # by restore. A binding still unprotected is asked again (the Keep is idempotent), so a failed attempt is retried.
        if binding_id not in recorded:
            saved["keeps"].append([entry_id, binding_id])
            write_private(RESTORE, json.dumps(saved))
        status, result = call("POST", f"/JellyfinMod/Entries/{entry_id}/Versions/{binding_id}/Keep")
        if status != 200:
            print("  could not keep", binding_id, status, str(result)[:120])
    print("kept for the session:", len(saved["keeps"]), "files outside the DD fixtures")
    verify_protection()


def verify_protection():
    missing = unprotected()
    for binding_id, (_, name) in list(missing.items())[:10]:
        print("  not kept:", binding_id, name)
    check(not missing, f"every binding outside the DD fixtures is kept per file ({len(missing)} not kept; "
          f"{len(ORPHANS)} bindings under the test root have no file left to delete)")


def cmd_retention_on(minutes):
    verify_protection()
    saved = json.load(open(RESTORE))
    saved["retentionChanged"] = True
    saved["retentionRestored"] = False
    write_private(RESTORE, json.dumps(saved))
    config = must("GET", f"/Plugins/{PLUGIN}/Configuration")
    config["RetentionTestWindowMinutes"] = int(minutes)
    must("POST", f"/Plugins/{PLUGIN}/Configuration", config)
    retention = must("GET", "/JellyfinMod/Settings/Retention")
    must("PATCH", "/JellyfinMod/Settings/Retention", {"enabled": True, "reclaimAfterDays": 1, "watchedUserMode": "selectedUser",
         "selectedUserId": user_id(), "exemptFavourites": True, "revision": retention["revision"]})
    time.sleep(20)
    print("retention on: selected user, test window", minutes, "min")


def play_to_end(item_id, source_id=None):
    info = must("GET", f"/Items/{item_id}?userId={user_id()}")
    ticks = info.get("RunTimeTicks") or 60_000_000
    body = {"ItemId": item_id, "MediaSourceId": source_id or item_id, "PositionTicks": 0, "PlayMethod": "DirectPlay",
            "PlaySessionId": "jfmod-dd-" + item_id[:8]}
    must("POST", "/Sessions/Playing", body)
    time.sleep(2)
    must("POST", "/Sessions/Playing/Stopped", dict(body, PositionTicks=ticks))


def cmd_watch(key):
    play_to_end(item_by_path(key)["Id"])
    time.sleep(15)
    cmd_state(key)


def cmd_window(key, days):
    series, episode = episode_of(key)
    count = int(days)
    must("PUT", f"/JellyfinMod/Entries/{series['entry']['id']}/Episodes/{episode['id']}/Retention",
         {"policy": "days" if count else "inherit", "reclaimAfterDays": count or None})
    time.sleep(5)
    cmd_state(key)


def cmd_state(key):
    _, episode = episode_of(key)
    print(key, "policy", episode.get("retentionPolicy"), episode.get("reclaimAfterDays"), "retention",
          (episode.get("retention") or {}).get("state"), (episode.get("retention") or {}).get("reason"),
          "warning", json.dumps(episode.get("retentionWarning")))


def cmd_retention_restore():
    saved = json.load(open(RESTORE))
    config = must("GET", f"/Plugins/{PLUGIN}/Configuration")
    config["RetentionTestWindowMinutes"] = saved["testWindowMinutes"]
    must("POST", f"/Plugins/{PLUGIN}/Configuration", config)
    retention = must("GET", "/JellyfinMod/Settings/Retention")
    old = saved["retention"]
    must("PATCH", "/JellyfinMod/Settings/Retention", {key: old.get(key) for key in
         ("enabled", "reclaimAfterDays", "watchedUserMode", "selectedUserId", "exemptFavourites")} | {"revision": retention["revision"]})
    unresolved = []
    for entry_id, binding_id in saved["keeps"]:
        status, result = call("DELETE", f"/JellyfinMod/Entries/{entry_id}/Versions/{binding_id}/Keep")
        if status != 200:
            # A 404 can also mean this account lost access; the record stays until a release is confirmed.
            unresolved.append([entry_id, binding_id])
            print("  not released:", binding_id, status, str(result)[:120])
    after = must("GET", "/JellyfinMod/Settings/Retention")
    check(after["enabled"] == old["enabled"], f"retention restored to enabled={after['enabled']}, window "
          f"{saved['testWindowMinutes']}, {len(saved['keeps'])} session keeps removed")
    saved["keeps"] = unresolved
    saved["retentionRestored"] = True
    write_private(RESTORE, json.dumps(saved))
    check(not unresolved, f"every session Keep released ({len(unresolved)} left recorded for a retry of retention-restore)")


def cmd_cleanup():
    """Files first while the libraries exist, then the entries, the libraries, the user and the folder (as v1-live.py)."""
    saved = json.load(open(RESTORE)) if os.path.exists(RESTORE) else {}
    if saved.get("keeps") or (saved.get("retentionChanged") and not saved.get("retentionRestored")):
        sys.exit("restore retention first (retention was changed or session keeps are still recorded)")
    for sub in (MOVIES, SHOWS):
        root = os.path.join(HOST_ROOT, sub)
        os.makedirs(root, exist_ok=True)
        for name in os.listdir(root):
            if name.startswith("JellyfinMod DD "):
                subprocess.run(["rm", "-rf", "--", os.path.join(root, name)], check=True)
        open(os.path.join(root, "jfmod-placeholder.txt"), "w").close()
    scan()
    removed, refused = 0, []
    fixtures = fixture_libraries()
    for item in all_entries():
        # Only entries in the two disposable DD libraries: nothing elsewhere in the catalog is ever removed here.
        if (item.get("targetLibraryId") or "").replace("-", "").lower() not in fixtures:
            continue
        if item["title"].startswith("JellyfinMod DD") or item["tmdbId"] in (9910001, 9910100) or item["id"] == saved.get("fileless"):
            status, _ = call("DELETE", f"/JellyfinMod/Entries/{item['id']}")
            removed += status in (200, 204)
            if status not in (200, 204):
                refused.append((item["title"], status))
    left = [i["title"] for i in all_entries() if (i.get("targetLibraryId") or "").replace("-", "").lower() in fixtures]
    check(not left, f"cleanup: {removed} entries removed; left {left[:3]} refused {refused[:3]}")
    for name in (MOVIE_LIBRARY, SHOW_LIBRARY):
        if library(name) is not None:
            # refreshLibrary=true: without the validation Jellyfin keeps the library's collection folder, and its view comes
            # back after a restart (seen on 18096, 2026-10-08).
            must("DELETE", f"/Library/VirtualFolders?name={urllib.parse.quote(name)}&refreshLibrary=true")
    ordinary = next((u for u in must("GET", "/Users") if u["Name"] == ORDINARY), None)
    if ordinary:
        must("DELETE", f"/Users/{ordinary['Id']}")
    subprocess.run(["rm", "-rf", "--", os.path.join(HOST_ROOT, FIXTURE_DIR)], check=True)
    scan()
    views = sorted(v["Name"] for v in must("GET", f"/Users/{user_id()}/Views")["Items"])
    check(views == ["Movies", "Shows"] and not os.path.exists(os.path.join(HOST_ROOT, FIXTURE_DIR))
          and not any(u["Name"] == ORDINARY for u in must("GET", "/Users")),
          f"cleanup: GET /UserViews for {ADMIN} = {views}; no DD library, file or user left")
    if os.path.exists(RESTORE):
        os.rename(RESTORE, RESTORE + ".done")


COMMANDS = {
    "login": cmd_login, "logout": cmd_logout, "health": cmd_health, "media": cmd_media, "library": cmd_library,
    "ids": cmd_ids, "fileless": cmd_fileless, "user-add": cmd_user_add, "save": cmd_save, "protect": cmd_protect,
    "retention-restore": cmd_retention_restore, "cleanup": cmd_cleanup, "reconcile": scan,
}

if __name__ == "__main__":
    os.makedirs(STATE, mode=0o700, exist_ok=True)
    name, arguments = sys.argv[1], sys.argv[2:]
    if name == "retention-on":
        cmd_retention_on(arguments[0])
    elif name == "watch":
        cmd_watch(arguments[0])
    elif name == "window":
        cmd_window(arguments[0], arguments[1])
    elif name == "state":
        cmd_state(arguments[0])
    elif name == "make":
        # Recreates exactly the named fixture files (keys of FIXTURE), then scans; nothing else is created.
        for key in arguments[0].split(","):
            make_video(key)
        scan()
    else:
        COMMANDS[name]()
