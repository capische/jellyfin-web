#!/usr/bin/env python3
"""Live per-media retention acceptance on the isolated test instance (PHASE10 E5/E6/E8).

Runs on the host of the isolated instance, against disposable fixtures only. Nothing here may point at a
production instance: the base URL must be given explicitly and the fixtures live under a writable test root.
The session token is kept in a 0600 file and never printed; a disposable ordinary user's password is generated
in memory and never printed or stored.

Environment (all required unless noted):
  JFMOD_BASE             base URL of the isolated instance, for example http://localhost:<port>
  JFMOD_STATE_DIR        private directory for the token, the saved settings and evidence (created 0700)
  JFMOD_HOST_MEDIA       host directory that the container mounts as JFMOD_CONTAINER_MEDIA
  JFMOD_CONTAINER_MEDIA  the same directory as the container sees it
  JFMOD_SEED_RPC         URL the container uses to reach `seed-server` (a fake Transmission RPC)
  JFMOD_SEED_PORT        port `seed-server` listens on (optional, 19091)
  JFMOD_USER             administrator to sign in as (optional, oleksii; empty password)
  JFMOD_DB               the plugin database, read through an online backup copy by `late` (optional otherwise)
  JFMOD_CONTAINER        the isolated instance's container (optional, jellyfinmod-test)

Subcommands, in scenario order:
  login | logout
  save                    record the retention and seed settings to restore
  media                   create the fixture files (two library roots, a seeding copy, a two-file movie)
  library                 create the disposable libraries and wait for the scan
  reconcile               run the catalog reconciliation task
  backlog                 mark E05 played with a date before tracking
  configure MIN DAYS      enable retention: selected user, seed server, test window MIN minutes, DAYS days
  act                     the fast-window watches and Keeps (see FIXTURE)
  state | preview | hashes [LABEL] | run
  ordinary                disposable non-admin user: 403 checks, the warning's date, Add (RET-R2), then delete it
  refresh                 admin Refresh of the fixture series (RET-R2 adoption evidence)
  real                    real-window checks: one-day schedule, window editor, un-Keep restart, series Keep wins
  restore                 disable retention and restore the saved settings
  cleanup                 remove the libraries, fixture files, catalog entries and native items
  safe-finish             restore and cleanup, each retried, then verify-safe; writes safe.OK only when all passed
  verify-safe             prove from the instance: retention off, settings restored, no fixture left
  reacquire | unkeep-survivor | unkeep-finish | toggle | covered | late
                          the second review's acceptance checks (RET2-R1, R2, R5, R7, R3)
  merge | movie-check | movie-finish | replace | covered-refresh | lockcheck MIN DAYS
                          the third review's checks (RET3-R2 movie versions and C2 merge, R3, R5, the database lock)
  seed-server             serve the fake Transmission RPC in the foreground
"""
import hashlib, json, os, secrets, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

BASE = os.environ["JFMOD_BASE"].rstrip("/")
STATE = os.environ["JFMOD_STATE_DIR"]
HOST_MEDIA = os.environ.get("JFMOD_HOST_MEDIA", "")
CONTAINER_MEDIA = os.environ.get("JFMOD_CONTAINER_MEDIA", "")
ADMIN = os.environ.get("JFMOD_USER", "oleksii")
TOKEN_FILE = os.path.join(STATE, ".token")
RESTORE = os.path.join(STATE, "restore.json")
ENTRIES = os.path.join(STATE, "entries.json")
AUTH = 'MediaBrowser Client="JellyfinMod retention E2E", Device="host", DeviceId="jfmod-retention-e2e", Version="1.0"'
PLUGIN = "6f1a2b3c-4d5e-4f60-9a71-8b2c3d4e5f60"

# JFMOD_FIXTURE_TAG names a separate fixture set (default P10, the set the real-window job runs on). A second set with its
# own tag can be created, checked and removed while the first one waits, because every name and every clean-up query
# carries the tag. Pick a tag that does not start with another set's tag.
TAG = os.environ.get("JFMOD_FIXTURE_TAG", "P10")
tag = TAG.lower()
PREFIX = f"JellyfinMod {TAG}"
SHOW_LIBRARY = f"JellyfinMod {TAG} Shows"
MOVIE_LIBRARY = f"JellyfinMod {TAG} Movies"
MOVIE_LIBRARY_B = f"JellyfinMod {TAG} Movies B"  # a second library whose copy of a movie is merged into the first (C2)
SERIES_TMDB = 1418
MOVIE_TMDB = 603
SERIES_DIR = f"JellyfinMod {TAG} Show (2007) [tmdbid-1418]"
MOVIE_DIR = f"JellyfinMod {TAG} Movie (1999) [tmdbid-603]"
ROOTS = {"A": f"tv-{tag}a", "B": f"tv-{tag}b"}
SEED_DIR = f"{tag}-seed"
MOVIE_ROOT = f"movies-{tag}"
MOVIE_ROOT_B = f"movies-{tag}b"
BACKLOG_DIR = f"JellyfinMod {TAG} Backlog (2000) [tmdbid-807]"
MERGE_DIR = f"JellyfinMod {TAG} Merge (2002) [tmdbid-604]"
MERGE_TMDB = 604
BACKLOG_TMDB = 807
# A library root on a second filesystem inside the container (its own /dev/shm) was tried for RET2-R9 and dropped: Jellyfin
# 12 then presents the series through that root's copy and the plugin entry, bound to another copy, is hidden from the
# listing. The cross-filesystem move is verified in the real-Kestrel protection suite instead. Cleanup still removes it.
CONTAINER = os.environ.get("JFMOD_CONTAINER", "jellyfinmod-test")
EXTRA_ROOTS = (f"/dev/shm/tv-{tag}c",)

# RET4-R4: this script can switch retention on and removes directories, libraries and entries, so it refuses to start
# unless every target it is given is the isolated test instance: the base URL on port 18096, the container
# `jellyfinmod-test` publishing that port, and the media root a read-write mount of that container at the container path.
ISOLATED_PORT = 18096
ISOLATED_CONTAINER = "jellyfinmod-test"


def refuse(reason):
    sys.exit(f"REFUSED (not the isolated test instance): {reason}")


def guard_target():
    port = urllib.parse.urlsplit(BASE).port
    if port != ISOLATED_PORT:
        refuse(f"JFMOD_BASE must use port {ISOLATED_PORT}, not {port}")
    if CONTAINER != ISOLATED_CONTAINER:
        refuse(f"JFMOD_CONTAINER must be {ISOLATED_CONTAINER}")
    if not HOST_MEDIA or not CONTAINER_MEDIA:
        refuse("JFMOD_HOST_MEDIA and JFMOD_CONTAINER_MEDIA are required")
    try:
        inspected = json.loads(subprocess.run(["docker", "inspect", CONTAINER], capture_output=True, text=True, timeout=60,
                                              check=True).stdout)[0]
    except (OSError, subprocess.SubprocessError, ValueError, IndexError) as error:
        refuse(f"cannot inspect container {CONTAINER}: {type(error).__name__}")
    published = {binding.get("HostPort") for bindings in (inspected.get("NetworkSettings", {}).get("Ports") or {}).values()
                 for binding in (bindings or [])}
    if str(ISOLATED_PORT) not in published:
        refuse(f"container {CONTAINER} does not publish port {ISOLATED_PORT}")
    media = os.path.realpath(HOST_MEDIA)
    if not any(os.path.realpath(mount.get("Source", "")) == media and mount.get("Destination") == CONTAINER_MEDIA.rstrip("/")
               and mount.get("RW") for mount in inspected.get("Mounts") or []):
        refuse(f"JFMOD_HOST_MEDIA is not the read-write media mount of {CONTAINER} at JFMOD_CONTAINER_MEDIA")


guard_target()

# FIXTURE — key: (root, file name, what the fast run must do to it)
FIXTURE = {
    "E01-A": ("A", f"JellyfinMod {TAG} Show S01E01.mkv", "reclaimed"),        # watched copy of a two-binding episode
    "E01-B": ("B", f"JellyfinMod {TAG} Show S01E01.mkv", "kept"),             # the other copy, kept per file (Q3)
    "E02-A": ("A", f"JellyfinMod {TAG} Show S01E02.mkv", "reclaimed"),        # unwatched copy: any copy watched counts (Q7)
    "E02-B": ("B", f"JellyfinMod {TAG} Show S01E02.mkv", "reclaimed"),        # the watched copy
    "E03": ("A", f"JellyfinMod {TAG} Show S01E03.mkv", "kept"),               # unwatched sibling
    "E04": ("A", f"JellyfinMod {TAG} Show S01E04.mkv", "kept"),               # watched, kept at episode level
    "E05": ("A", f"JellyfinMod {TAG} Show S01E05.mkv", "kept"),               # backlog: played before tracking (Q1)
    "E06": ("A", f"JellyfinMod {TAG} Show S01E06.mkv", "kept"),               # watched, seeding below its goal
    "E07-E08": ("A", f"JellyfinMod {TAG} Show S01E07-E08.mkv", "reclaimed"),  # multi-episode file, fully due (Q5)
    "E09-E10": ("A", f"JellyfinMod {TAG} Show S01E09-E10.mkv", "kept"),       # multi-episode file, E10 not due
    "E10-B": ("B", f"JellyfinMod {TAG} Show S01E10.mkv", "kept"),             # E10's own copy, unwatched
    "E11": ("A", f"JellyfinMod {TAG} Show S01E11.mkv", "kept"),               # grouped with E11-E12 by Jellyfin 12 (C1)
    "E11-E12": ("A", f"JellyfinMod {TAG} Show S01E11-E12.mkv", "kept"),       # E12's only copy
    "E13": ("A", f"JellyfinMod {TAG} Show S01E13.mkv", "reclaimed"),          # watched on another device (synced)
    "E14-A": ("A", f"JellyfinMod {TAG} Show S01E14.mkv", "reclaimed"),        # unwatched copy of a two-binding episode
    "E14-B": ("B", f"JellyfinMod {TAG} Show S01E14.mkv", "kept"),             # the watched copy, kept per file (RET2-R2 later)
    "E16": ("A", f"JellyfinMod {TAG} Show S01E16.mkv", "kept"),               # arrives late, before any Refresh: a position row
    "E17": ("A", f"JellyfinMod {TAG} Show S01E17.mkv", "kept"),               # arrives after a Refresh listed TMDB's E17 (RET2-R3)
    "E18-E19": ("A", f"JellyfinMod {TAG} Show S01E18-E19.mkv", "kept"),       # a late double file: E19 gets a covered row (RET2-R7)
    # A two-file movie on Jellyfin 12 (RET3-R2): both files tracked, the 1080p kept by itself, the 720p goes first.
    "M-1080p": ("M", f"JellyfinMod {TAG} Movie (1999) [tmdbid-603] - 1080p.mkv", "kept"),
    "M-720p": ("M", f"JellyfinMod {TAG} Movie (1999) [tmdbid-603] - 720p.mkv", "reclaimed"),
    "MB": ("MB", f"JellyfinMod {TAG} Backlog (2000) [tmdbid-807].mkv", "kept"),  # a movie watched before tracking (decision 12)
    "MA": ("MA", f"JellyfinMod {TAG} Merge (2002) [tmdbid-604].mkv", "kept"),    # merged with its copy in library B: the
    "MM": ("MM", f"JellyfinMod {TAG} Merge (2002) [tmdbid-604].mkv", "kept"),    # other file is untracked, so both are blocked
}
SEEDED = ("E06",)
LATE = ("E16", "E17", "E18-E19")  # created later: E16 and E17 by `late`, E18-E19 by `double`
SIDECAR = ("A", f"JellyfinMod {TAG} Show S01E01.en.srt")
NFO = ("A", f"JellyfinMod {TAG} Show S01E01.nfo")  # titles E01 "Pilot", TMDB's own title: evidence for Refresh


def host_dir(root):
    if root == "M":
        return os.path.join(HOST_MEDIA, MOVIE_ROOT, MOVIE_DIR)
    if root == "MB":
        return os.path.join(HOST_MEDIA, MOVIE_ROOT, BACKLOG_DIR)
    if root == "MA":
        return os.path.join(HOST_MEDIA, MOVIE_ROOT, MERGE_DIR)
    if root == "MM":
        return os.path.join(HOST_MEDIA, MOVIE_ROOT_B, MERGE_DIR)
    if root == "S":
        return os.path.join(HOST_MEDIA, SEED_DIR)
    return os.path.join(HOST_MEDIA, ROOTS[root], SERIES_DIR, "Season 01")


def host_path(key):
    root, name, _ = FIXTURE[key]
    return os.path.join(host_dir(root), name)


def container_path(key):
    return host_path(key).replace(HOST_MEDIA, CONTAINER_MEDIA, 1)


def write_private(path, data):
    os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.write(fd, data.encode())
    os.close(fd)


def call(method, path, body=None, token=None, anonymous=False):
    headers = {"Content-Type": "application/json"}
    header = AUTH
    if not anonymous:
        token = token or open(TOKEN_FILE).read().strip()
        header += f', Token="{token}"'
    headers["Authorization"] = header
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(BASE + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            text = response.read().decode()
            return response.status, (json.loads(text) if text else None)
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode()[:400]
    except (urllib.error.URLError, OSError) as error:  # refused, reset, timed out: the instance is down or busy
        return 0, f"{type(error).__name__}: {error}"


def must(method, path, body=None, ok=(200, 201, 202, 204), token=None, tries=None, pause=15):
    """A GET is retried on a 5xx or no answer (a busy host answers `database is locked` while the plugin re-evaluates
    every target after a switch-on, RET3-R1); a write is not, because a revision it already applied would then 409."""
    tries = tries or (4 if method == "GET" else 1)
    for attempt in range(1, tries + 1):
        status, result = call(method, path, body, token)
        if status in ok:
            return result
        if attempt < tries and (status == 0 or status >= 500):
            print(f"RETRY {method} {path} -> {status} {str(result)[:160]}; attempt {attempt}/{tries}", flush=True)
            time.sleep(pause)
            continue
        sys.exit(f"FAIL {method} {path} -> {status} {str(result)[:300]}")


def attempt(label, action, tries, pause):
    """Runs a step that may exit or raise until it succeeds, at most `tries` times; True when it did."""
    for number in range(1, tries + 1):
        try:
            action()
            return True
        except SystemExit as stop:
            why = stop.code
        except Exception as error:  # noqa: BLE001 - every failure of a safety step is retried and reported
            why = f"{type(error).__name__}: {error}"
        print(f"RETRY {label} attempt {number}/{tries} failed: {str(why)[:300]}", flush=True)
        if number < tries:
            time.sleep(pause)
    return False


def check(condition, message):
    print(("PASS " if condition else "FAIL ") + message, flush=True)
    if not condition:
        sys.exit(1)


def library(name):
    # A library being created or refreshed can briefly be listed without its item id.
    for _ in range(40):
        found = next((f for f in must("GET", "/Library/VirtualFolders") if f["Name"] == name), None)
        if found is None or found.get("ItemId"):
            return found
        time.sleep(3)
    sys.exit(f"library {name} never got an item id")


def entry(name, tmdb):
    lib = library(name)
    if lib is None:
        return None, None
    items = must("GET", f"/JellyfinMod/Entries?targetLibraryId={lib['ItemId']}&limit=50")["items"]
    return lib, next((e for e in items if e["tmdbId"] == tmdb), None)


def series_detail():
    _, series = entry(SHOW_LIBRARY, SERIES_TMDB)
    return series, must("GET", f"/JellyfinMod/Entries/{series['id']}")


def episodes_by_file():
    """Native episode items of the fixture keyed by their file name and root."""
    lib = library(SHOW_LIBRARY)
    items = must("GET", f"/Items?ParentId={lib['ItemId']}&Recursive=true&IncludeItemTypes=Episode&Fields=Path")["Items"]
    return {item["Path"]: item for item in items}


def native_item(key):
    return episodes_by_file().get(container_path(key))


def tracked_episode(detail, number):
    return next(e for e in detail["episodes"] if e["seasonNumber"] == 1 and e["episodeNumber"] == number)


def version_of(episode, key):
    name = FIXTURE[key][1]
    root = ROOTS[FIXTURE[key][0]]
    candidates = [v for v in episode.get("versions") or []]
    for version in candidates:
        status, item = call("GET", f"/Items/{version['jellyfinItemId']}?Fields=Path")
        if status == 200 and item.get("Path", "").endswith(f"/{root}/{SERIES_DIR}/Season 01/{name}"):
            return version
    return None


def selected_user():
    return next(u for u in must("GET", "/Users") if u["Name"] == ADMIN)["Id"]


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
    sys.exit(f"TIMEOUT waiting for {key} (NOT VERIFIED)")


def wait_scan():
    time.sleep(5)
    for _ in range(200):
        if task("RefreshLibrary")["State"] == "Idle":
            return
        time.sleep(3)
    sys.exit("TIMEOUT waiting for the library scan")


def sha(path):
    if not os.path.exists(path):
        return "ABSENT"
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        digest.update(handle.read())
    return digest.hexdigest()


def fixture_hashes():
    result = {key: sha(host_path(key)) for key in FIXTURE}
    result["seed-copy-E06"] = sha(os.path.join(host_dir("S"), FIXTURE["E06"][1]))
    result["sidecar"] = sha(os.path.join(host_dir(SIDECAR[0]), SIDECAR[1]))
    return result


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


def cmd_save():
    if os.path.exists(RESTORE):
        sys.exit("restore file already exists; not overwriting")
    saved = {"retention": must("GET", "/JellyfinMod/Settings/Retention"),
             "seed": must("GET", "/JellyfinMod/Settings/SeedProtection"),
             "testWindowMinutes": must("GET", f"/Plugins/{PLUGIN}/Configuration").get("RetentionTestWindowMinutes", 0)}
    write_private(RESTORE, json.dumps(saved))
    print("saved: retention enabled", saved["retention"]["enabled"], "window", saved["testWindowMinutes"],
          "seed source", saved["seed"]["source"])


def make_video(target, index, key):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=duration=3:size=320x240:rate=10",
                    "-f", "lavfi", "-i", f"sine=frequency={300 + 70 * index}:duration=3", "-c:v", "libx264",
                    "-preset", "ultrafast", "-c:a", "aac", "-shortest", "-metadata", f"title=JellyfinMod {TAG} {key}",
                    target], check=True)


def cmd_media():
    # A file is created once: running this again adds new fixtures but never brings back a file retention reclaimed.
    marker = os.path.join(STATE, "media-created.json")
    created = set(json.load(open(marker))) if os.path.exists(marker) else set()
    for index, key in enumerate(FIXTURE):
        if key in created or key in LATE:
            continue
        root, name, _ = FIXTURE[key]
        directory = host_dir("S") if key in SEEDED else host_dir(root)
        os.makedirs(directory, exist_ok=True)
        target = os.path.join(directory, name)
        if not os.path.exists(target):
            make_video(target, index, key)
    for key in SEEDED:  # the library file is a hardlink of the seeding copy, as an import leaves it
        os.makedirs(host_dir(FIXTURE[key][0]), exist_ok=True)
        if not os.path.exists(host_path(key)):
            os.link(os.path.join(host_dir("S"), FIXTURE[key][1]), host_path(key))
    with open(os.path.join(host_dir(SIDECAR[0]), SIDECAR[1]), "w") as handle:
        handle.write("1\n00:00:00,000 --> 00:00:02,000\nJellyfinMod {TAG} sidecar\n")
    with open(os.path.join(host_dir(NFO[0]), NFO[1]), "w") as handle:
        handle.write("<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<episodedetails><title>Pilot</title>"
                     "<season>1</season><episode>1</episode></episodedetails>\n")
    write_private(marker, json.dumps(sorted(created | (set(FIXTURE) - set(LATE)))))
    print(json.dumps({key: os.stat(host_path(key)).st_nlink for key in FIXTURE if os.path.exists(host_path(key))}))


def library_options(paths):
    return {"LibraryOptions": {"EnableRealtimeMonitor": False, "EnableInternetProviders": False,
                               "TypeOptions": [{"Type": t, "MetadataFetchers": [], "ImageFetchers": []}
                                               for t in ("Series", "Season", "Episode", "Movie")],
                               "PathInfos": [{"Path": p} for p in paths]}}


def cmd_library():
    for name, kind, paths in ((SHOW_LIBRARY, "tvshows", [f"{CONTAINER_MEDIA}/{ROOTS['A']}", f"{CONTAINER_MEDIA}/{ROOTS['B']}"]),
                              (MOVIE_LIBRARY, "movies", [f"{CONTAINER_MEDIA}/{MOVIE_ROOT}"]),
                              (MOVIE_LIBRARY_B, "movies", [f"{CONTAINER_MEDIA}/{MOVIE_ROOT_B}"])):
        if library(name) is None:
            query = urllib.parse.urlencode({"name": name, "collectionType": kind, "refreshLibrary": "true"})
            must("POST", f"/Library/VirtualFolders?{query}", library_options(paths))
        else:
            refresh_library(name)
        wait_scan()
    shows = episodes_by_file()
    print("native episodes", len(shows))
    for path, item in sorted(shows.items()):
        print(" ", path.replace(CONTAINER_MEDIA, "<media>"), "S", item.get("ParentIndexNumber"), "E", item.get("IndexNumber"),
              "-", item.get("IndexNumberEnd"), item["Id"])


def library_paths(name):
    lib = library(name)
    if lib is None:
        return set()
    return {item.get("Path") for item in must("GET", f"/Items?ParentId={lib['ItemId']}&Recursive=true&Fields=Path")["Items"]}


def refresh_library(name, until=None, timeout=600):
    """Refreshes one library. An item refresh is not the RefreshLibrary task, so its end is observed instead: until
    `until(paths)` holds, or until the library's items stop changing."""
    must("POST", f"/Items/{library(name)['ItemId']}/Refresh?Recursive=true&MetadataRefreshMode=Default")
    begin, previous = time.time(), None
    while time.time() - begin < timeout:
        time.sleep(10)
        paths = library_paths(name)
        if until is not None and until(paths):
            return
        if until is None and paths == previous:
            return
        previous = paths
    sys.exit(f"TIMEOUT waiting for {name} to refresh")


def cmd_reconcile():
    print("reconcile", run_task("JellyfinModCatalogReconciliation"))


def movie_items(name=MOVIE_LIBRARY):
    lib = library(name)
    return {item["Path"]: item for item in must("GET", f"/Items?ParentId={lib['ItemId']}&Recursive=true&IncludeItemTypes=Movie"
                                                          "&Fields=Path")["Items"]}


def cmd_backlog():
    item = native_item("E05")
    must("POST", f"/UserPlayedItems/{item['Id']}?userId={selected_user()}&datePlayed=2026-09-01T10:00:00.000Z")
    print("E05 marked played with a date before tracking")
    # Decision 12: a movie finished before it was tracked (and before retention was ever switched on) is backlog too.
    backlog = movie_items()[container_path("MB")]
    must("POST", f"/UserPlayedItems/{backlog['Id']}?userId={selected_user()}&datePlayed=2026-09-01T10:00:00.000Z")
    print("MB (movie) marked played with a date before tracking")


def cmd_configure(minutes, days):
    port = os.environ.get("JFMOD_SEED_PORT", "19091")
    rpc = os.environ["JFMOD_SEED_RPC"]
    seed = must("GET", "/JellyfinMod/Settings/SeedProtection")
    if seed["source"] != "separate" or seed["rpcUrl"] != rpc:
        must("PATCH", "/JellyfinMod/Settings/SeedProtection", {"source": "separate", "rpcUrl": rpc, "username": "",
             "password": {"action": "unchanged"}, "revision": seed["revision"]})
    config = must("GET", f"/Plugins/{PLUGIN}/Configuration")
    config["RetentionTestWindowMinutes"] = minutes
    must("POST", f"/Plugins/{PLUGIN}/Configuration", config)
    retention = must("GET", "/JellyfinMod/Settings/Retention")
    result = must("PATCH", "/JellyfinMod/Settings/Retention", {"enabled": True, "reclaimAfterDays": days,
                  "watchedUserMode": "selectedUser", "selectedUserId": selected_user(), "exemptFavourites": True,
                  "revision": retention["revision"]})
    # The plugin records the switch-on when its listener reads the saved settings, a few seconds later; a watch before
    # that instant is, correctly, not a new watch.
    time.sleep(20)
    print("retention enabled", result["enabled"], result["watchedUserMode"], "days", result["reclaimAfterDays"],
          "window minutes", result.get("testWindowMinutes"), "seed port", port)


def mark_played(key, user):
    # Unplayed first: Jellyfin's MarkPlayed keeps an earlier last-played date, and only a date after the first
    # switch-on of retention counts for an episode (PHASE10 Q1/Q9).
    item = native_item(key)
    must("DELETE", f"/UserPlayedItems/{item['Id']}?userId={user}")
    must("POST", f"/UserPlayedItems/{item['Id']}?userId={user}")


def sync_watch(key, user):
    """Watched state written as the Trakt plugin's SyncFromTraktTask writes it: Played, a play count and the remote
    watched date as LastPlayedDate. From outside the server the save reason is UpdateUserData; Trakt itself saves with
    Import, which reads "watched on another device (Trakt)"."""
    item = native_item(key)
    now = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
    must("POST", f"/UserItems/{item['Id']}/UserData?userId={user}", {"Played": True, "LastPlayedDate": now, "PlayCount": 1})


def cmd_act():
    user = selected_user()
    series, detail = series_detail()
    # E01: watch copy A, keep copy B by itself (Q3).
    e01 = tracked_episode(detail, 1)
    check(len(e01.get("versions") or []) == 2, "E01 is one tracked episode with two bindings (RET-R5)")
    kept = version_of(e01, "E01-B")
    must("POST", f"/JellyfinMod/Entries/{series['id']}/Versions/{kept['bindingId']}/Keep")
    mark_played("E01-A", user)
    # E02: watch copy B only; copy A goes with it (Q7, any copy watched counts).
    check(len(tracked_episode(detail, 2).get("versions") or []) == 2, "E02 is one tracked episode with two bindings")
    mark_played("E02-B", user)
    # E04 watched and kept at episode level; E06 watched and seeding; the multi-episode files watched; E11 watched.
    must("POST", f"/JellyfinMod/Entries/{series['id']}/Episodes/{tracked_episode(detail, 4)['id']}/Keep")
    for key in ("E04", "E06", "E07-E08", "E09-E10", "E11"):
        mark_played(key, user)
    # E14: keep copy B by itself and watch only B; copy A goes by the any-copy rule (Q7), B stays kept (RET2-R2 later).
    e14 = tracked_episode(detail, 14)
    check(len(e14.get("versions") or []) == 2, "E14 is one tracked episode with two bindings")
    must("POST", f"/JellyfinMod/Entries/{series['id']}/Versions/{version_of(e14, 'E14-B')['bindingId']}/Keep")
    mark_played("E14-B", user)
    sync_watch("E13", user)
    act_movies(user)


def act_movies(user):
    # RET3-R2: the two-file movie. On Jellyfin 12 the plugin tracks both files; keep the 1080p by itself and watch the
    # movie, so the 720p goes at its deadline and the 1080p stays (lowest quality first, P6.M7).
    _, movie = entry(MOVIE_LIBRARY, MOVIE_TMDB)
    detail = must("GET", f"/JellyfinMod/Entries/{movie['id']}")
    versions = movie_versions(detail)
    print("movie versions:", {key: (v["bindingId"], v.get("kept")) for key, v in versions.items()})
    check(set(versions) == {"M-1080p", "M-720p"}, "both files of the two-file movie are tracked on Jellyfin 12 (RET3-R2)")
    must("POST", f"/JellyfinMod/Entries/{movie['id']}/Versions/{versions['M-1080p']['bindingId']}/Keep")
    main = movie_items()[container_path("M-1080p")]
    must("DELETE", f"/UserPlayedItems/{main['Id']}?userId={user}")
    must("POST", f"/UserPlayedItems/{main['Id']}?userId={user}")
    # C9: Jellyfin 12 marks the other version played too, without a last-played date.
    other = next(item for item in must("GET", f"/Items?ParentId={library(MOVIE_LIBRARY)['ItemId']}&Recursive=true"
                                          "&IncludeItemTypes=Movie&Fields=Path,MediaSources")["Items"]
                 if item["Id"] == main["Id"])
    source = next(s for s in other.get("MediaSources") or [] if s.get("Path") == container_path("M-720p"))
    data = must("GET", f"/UserItems/{source['Id']}/UserData?userId={user}")
    print("720p user data after finishing the 1080p: played", data.get("Played"), "last played", data.get("LastPlayedDate"))
    # The merged movie: watch the title (its copy in library B is a version Jellyfin plays but that entry does not track).
    merged = movie_items()[container_path("MA")]
    must("DELETE", f"/UserPlayedItems/{merged['Id']}?userId={user}")
    must("POST", f"/UserPlayedItems/{merged['Id']}?userId={user}")
    print("acted; movie entry", movie["id"])


def cmd_ret3():
    """The third review's live checks that need no deletion, on a fixture set of their own while the real-window set
    waits: the Jellyfin 12 two-file movie tracked with both files (RET3-R2), a merged movie blocked (versions_untracked),
    the movie backlog after a switch-on (decision 12), a scheduled file replaced in place (RET3-R3)."""
    user = selected_user()
    act_movies(user)
    sync_watch("E13", user)
    _, e13 = await_episode(13, lambda e: e["retention"]["state"] == "scheduled", timeout=300)
    print("E13 after a synced watch:", e13["retention"])
    cmd_replace()
    time.sleep(10)
    preview, rows = preview_rows()
    by_path = {r.get("path"): r for r in rows}
    for key in ("M-1080p", "M-720p", "MB", "MA", "MM"):
        r = by_path.get(container_path(key)) or {}
        print(f"  {key}: {r.get('state')}/{r.get('reason')} deadline {r.get('deadline')}")
    check((by_path.get(container_path("M-720p")) or {}).get("state") == "scheduled",
          "the 720p of the two-file movie is scheduled: both files are tracked and the watch counts (RET3-R2)")
    check((by_path.get(container_path("M-1080p")) or {}).get("reason") == "version_kept",
          "the 1080p, kept by itself, is held (RET3-R2, Q3)")
    check(all((by_path.get(container_path(key)) or {}).get("reason") == "versions_untracked" for key in ("MA", "MM")),
          "a movie that plays a file its entry does not track (a merged copy from another library) is blocked (C2)")
    backlog = by_path.get(container_path("MB")) or {}
    check(backlog.get("state") == "waiting", "a movie watched before it was tracked stays waiting after the switch-on "
                                              f"(decision 12): {backlog.get('state')}/{backlog.get('reason')}")
    _, movie = entry(MOVIE_LIBRARY, BACKLOG_TMDB)
    detail = must("GET", f"/JellyfinMod/Entries/{movie['id']}")
    print("backlog movie:", detail["retention"], "warning", detail.get("retentionWarning"))
    check(detail["retention"]["state"] == "waiting" and not detail.get("retentionWarning"),
          "the backlog movie shows no retention warning (decision 12)")


def movie_versions(detail):
    """The movie entry's tracked versions keyed by fixture key. A version row names the title a user opens (the main
    item) for every file, so the file is told apart by its resolution, which the fixture's file names carry."""
    return {f"M-{version.get('resolution')}": version for version in detail.get("versions") or []
            if f"M-{version.get('resolution')}" in ("M-1080p", "M-720p")}


def cmd_merge():
    """C2: a copy of the same movie in a second library, merged into the first by Jellyfin's own Merge versions. Each
    entry now plays a file it does not track, so both titles must stay blocked (versions_untracked)."""
    first = movie_items()[container_path("MA")]
    second = movie_items(MOVIE_LIBRARY_B)[container_path("MM")]
    must("POST", f"/Videos/MergeVersions?ids={first['Id']},{second['Id']}")
    refresh_library(MOVIE_LIBRARY)
    refresh_library(MOVIE_LIBRARY_B)
    cmd_reconcile()
    # Jellyfin picks which copy becomes the main item; that one lists both files as its media sources.
    counts = {}
    for label, item in (("MA", first), ("MM", second)):
        _, merged = call("GET", f"/Items/{item['Id']}?Fields=Path,MediaSources")
        sources = [source.get("Path", "").replace(CONTAINER_MEDIA, "<media>") for source in (merged or {}).get("MediaSources") or []]
        counts[label] = len(sources)
        print(f"{label} media sources:", sources)
    check(max(counts.values()) == 2, "Jellyfin plays both copies as versions of one movie")


def await_movie(tmdb, condition, timeout=300):
    begin = time.time()
    while True:
        _, movie = entry(MOVIE_LIBRARY, tmdb)
        detail = must("GET", f"/JellyfinMod/Entries/{movie['id']}")
        if condition(detail) or time.time() - begin > timeout:
            return detail
        time.sleep(5)


def cmd_ret3_fast():
    """The deleting half of the RET3 checks, after a switch to a test window of minutes: the two-file movie, the merged
    movie and E13 are watched again so each is scheduled one test window out; after the window the native task reclaims
    the 720p and E13, while the kept 1080p, the merged movie (versions_untracked, C2) and the movie backlog (decision 12)
    stay byte-identical. Needs this set's seed-server running."""
    user = selected_user()
    main = movie_items()[container_path("M-1080p")]
    merged = movie_items()[container_path("MA")]
    for item, tmdb in ((main, MOVIE_TMDB), (merged, MERGE_TMDB)):
        must("DELETE", f"/UserPlayedItems/{item['Id']}?userId={user}")
        # The plugin reads user data through a queue that folds repeated events for one item; wait for the unplayed state
        # to be read before playing again, so the watch is a new one and not the old schedule carried on.
        await_movie(tmdb, lambda detail: detail["retention"]["state"] != "scheduled")
        must("POST", f"/UserPlayedItems/{item['Id']}?userId={user}")
        await_movie(tmdb, lambda detail: detail["retention"]["state"] == "scheduled")
    e13 = native_item("E13")
    must("DELETE", f"/UserPlayedItems/{e13['Id']}?userId={user}")
    await_episode(13, lambda e: e["retention"]["state"] != "scheduled", timeout=300)
    sync_watch("E13", user)
    await_episode(13, lambda e: e["retention"]["state"] == "scheduled", timeout=300)
    time.sleep(15)
    _, rows = preview_rows()
    deadlines = [parse_time(r["deadline"]) for r in rows if r.get("deadline") and r["state"] == "scheduled" and
                 r.get("path") in (container_path("M-720p"), container_path("E13"), container_path("MA"))]
    print("scheduled:", [(r["path"].replace(CONTAINER_MEDIA, "<media>")[-40:], r["deadline"]) for r in rows if r["state"] == "scheduled"])
    check(len(deadlines) == 3 and max(deadlines) < now_utc() + __import__("datetime").timedelta(minutes=window_minutes() + 2),
          "the 720p, the merged movie and E13 are scheduled one test window out")
    wait = (max(deadlines) - now_utc()).total_seconds() + 20
    print("waiting", int(wait), "s for the test window")
    time.sleep(max(0, wait))
    cmd_hashes("ret3-before")
    cmd_preview()
    cmd_run()
    cmd_hashes("ret3-after")
    first = json.load(open(os.path.join(STATE, "hashes-ret3-before.json")))
    second = json.load(open(os.path.join(STATE, "hashes-ret3-after.json")))
    for key in ("M-720p", "E13"):
        check(first[key] != "ABSENT" and second[key] == "ABSENT", f"{key} was reclaimed after its window")
    for key in first:
        if key not in ("M-720p", "E13"):
            check(second[key] == first[key], f"{key} is unchanged ({'absent' if first[key] == 'ABSENT' else 'byte-identical'})")
    cmd_movie_check()


def cmd_merge_recheck():
    """C2 after the fix: the copy merged into the other library's title comes back, is merged again if Jellyfin dropped
    the link, is watched, and at the end of its window the native task leaves it byte-identical (versions_untracked)."""
    user = selected_user()
    if sha(host_path("MA")) == "ABSENT":
        make_video(host_path("MA"), 60, "MA-again")
    refresh_library(MOVIE_LIBRARY, lambda paths: container_path("MA") in paths)
    second = movie_items(MOVIE_LIBRARY_B)[container_path("MM")]
    if container_path("MA") not in movie_items():
        # Jellyfin re-resolved the returning copy as a hidden version of the merged title, which no entry tracks: split
        # the merge so the copy is a title of its own again and its entry binds it, then merge again.
        must("DELETE", f"/Videos/{second['Id']}/AlternateSources")
        refresh_library(MOVIE_LIBRARY, lambda paths: container_path("MA") in paths)
    cmd_reconcile()
    first = movie_items()[container_path("MA")]
    _, main = call("GET", f"/Items/{second['Id']}?Fields=Path,MediaSources")
    if len(main.get("MediaSources") or []) < 2:
        must("POST", f"/Videos/MergeVersions?ids={first['Id']},{second['Id']}")
    cmd_reconcile()
    check(container_path("MA") in movie_items(), "the merged copy is listed as a title of its own again")
    _, main = call("GET", f"/Items/{second['Id']}?Fields=Path,MediaSources")
    print("MM media sources:", [s.get("Path", "").replace(CONTAINER_MEDIA, "<media>") for s in main.get("MediaSources") or []])
    must("DELETE", f"/UserPlayedItems/{first['Id']}?userId={user}")
    await_movie(MERGE_TMDB, lambda detail: detail["retention"]["state"] != "scheduled")
    must("POST", f"/UserPlayedItems/{first['Id']}?userId={user}")
    detail = await_movie(MERGE_TMDB, lambda detail: detail["retention"]["state"] == "scheduled")
    deadline = detail["retention"].get("deadline")
    print("MA scheduled:", detail["retention"])
    check(bool(deadline), "the merged copy is watched and scheduled")
    time.sleep(max(0, (parse_time(deadline) - now_utc()).total_seconds() + 20))
    before = sha(host_path("MA"))
    row = next(r for r in preview_rows()[1] if r.get("path") == container_path("MA"))
    print("MA preview at its deadline:", row["state"], row["reason"])
    cmd_run()
    check(row["reason"] == "versions_untracked" and sha(host_path("MA")) == before != "ABSENT",
          "a file another tracked title plays as a merged version stays blocked and byte-identical at its deadline (C2)")


def cmd_probe_ids():
    """The browser probe's item ids for this fixture set, as environment assignments (retention-controls.mjs)."""
    _, detail = series_detail()
    series, _ = entry(SHOW_LIBRARY, SERIES_TMDB)
    ids = {key: (native_item(key) or {}).get("Id") for key in ("E03", "E04", "E06", "E10-B", "E01-A", "E02-B", "E07-E08")}
    print(f"JELLYFINMOD_WARNED=desktop:{ids['E03']},mobile:{ids['E04']},tv1080:{ids['E06']}")
    print(f"JELLYFINMOD_SYNCED={ids['E10-B']}")
    print(f"JELLYFINMOD_VERSIONED={ids['E01-A']}")
    lib = library(SHOW_LIBRARY)
    copies = must("GET", f"/Items?ParentId={lib['ItemId']}&Recursive=true&IncludeItemTypes=Series&Fields=Path")["Items"]
    chosen = next((c for c in copies if ROOTS["A"] in (c.get("Path") or "")), copies[0])
    print(f"JELLYFINMOD_SERIES={chosen['Id']}")
    print(f"JELLYFINMOD_OVERDUE={ids['E02-B']}")
    print(f"JELLYFINMOD_COVERING={ids['E07-E08']}:{tracked_episode(detail, 7)['id']}")


def cmd_movie_check():
    """After the fast run: the 720p went, the kept 1080p stayed, and the movie is still on disk (RET3-R2)."""
    _, movie = entry(MOVIE_LIBRARY, MOVIE_TMDB)
    detail = must("GET", f"/JellyfinMod/Entries/{movie['id']}")
    versions = movie_versions(detail)
    print("movie", movie["state"], detail["retention"], "versions", {k: v.get("kept") for k, v in versions.items()})
    check(set(versions) == {"M-1080p"} and versions["M-1080p"].get("kept") and movie["state"] == "onDisk",
          "the 720p was reclaimed first; the kept 1080p stays and the movie is still on disk (RET3-R2)")
    events = [h for h in detail["history"] if h["eventType"] in ("reclaimed", "version_kept")]
    for h in events:
        print("  history", h["createdAt"][:19], h["eventType"], "|", h["summary"])


def cmd_movie_finish():
    """RET3-R2, second half: stop keeping the 1080p; it gets a window of its own and goes at its end, and only then is the
    movie reclaimed."""
    _, movie = entry(MOVIE_LIBRARY, MOVIE_TMDB)
    versions = movie_versions(must("GET", f"/JellyfinMod/Entries/{movie['id']}"))
    must("DELETE", f"/JellyfinMod/Entries/{movie['id']}/Versions/{versions['M-1080p']['bindingId']}/Keep")
    time.sleep(5)
    detail = must("GET", f"/JellyfinMod/Entries/{movie['id']}")
    deadline = detail["retention"].get("deadline")
    print("movie after un-Keep:", detail["retention"])
    check(detail["retention"]["state"] == "scheduled" and deadline and parse_time(deadline) > now_utc(),
          "stopping the Keep gives the 1080p a window of its own from now")
    wait = (parse_time(deadline) - now_utc()).total_seconds() + 15
    print("waiting", int(wait), "s for the 1080p's window")
    time.sleep(max(0, wait))
    before = sha(host_path("M-1080p"))
    cmd_run()
    _, movie = entry(MOVIE_LIBRARY, MOVIE_TMDB)
    check(before != "ABSENT" and sha(host_path("M-1080p")) == "ABSENT" and movie["state"] == "reclaimed",
          f"the 1080p went at the end of its own window, and only then is the movie reclaimed ({movie['state']})")


def cmd_replace():
    """RET3-R3: E13 is scheduled; its file is replaced at the same path with other bytes. The episode starts over, History
    says the file was replaced, and a new watch schedules it one window out."""
    _, detail = series_detail()
    e13 = tracked_episode(detail, 13)
    check(e13["retention"]["state"] == "scheduled", f"E13 is scheduled before the replacement ({e13['retention']})")
    target = host_path("E13")
    temporary = target + ".new.mkv"
    make_video(temporary, 99, "E13-replacement")
    os.replace(temporary, target)
    rescan()
    _, detail = series_detail()
    e13 = tracked_episode(detail, 13)
    r = e13["retention"]
    print("E13 after the replacement:", r)
    check(r["state"] == "waiting" and r["reason"] == "representation_reset" and not r.get("deadline"),
          "a file replaced in place starts over: waiting, no deadline (RET3-R3)")
    replaced = [h for h in detail["history"] if h["eventType"] == "retention_reset" and "replaced in place" in h["summary"]]
    for h in replaced:
        print("  history", h["createdAt"][:19], h["summary"])
    check(any("S01E13" in h["summary"] for h in replaced), "History says the file was replaced in place")
    row = next(r for r in preview_rows()[1] if (r.get("path") or "").endswith(FIXTURE["E13"][1]))
    check(row["state"] != "due", f"the preview does not list the replaced file as due ({row['state']}/{row['reason']})")
    started = now_utc()
    sync_watch("E13", selected_user())
    _, e13 = await_episode(13, lambda e: e["retention"]["state"] == "scheduled", timeout=300)
    deadline = e13["retention"].get("deadline")
    print("E13 after a new watch:", e13["retention"])
    check(e13["retention"]["state"] == "scheduled" and deadline and
          (parse_time(deadline) - started).total_seconds() >= window_minutes() * 60 - 5,
          "after a new watch the replaced file is scheduled one window out (RET3-R3)")


def cmd_lockcheck(minutes, days):
    """The `database is locked` 500: switch retention on and, at once, preview twice and save the seed settings while the
    plugin re-evaluates every target. Every request must answer 2xx."""
    import threading
    retention = must("GET", "/JellyfinMod/Settings/Retention")
    config = must("GET", f"/Plugins/{PLUGIN}/Configuration")
    config["RetentionTestWindowMinutes"] = minutes
    must("POST", f"/Plugins/{PLUGIN}/Configuration", config)
    retention = must("GET", "/JellyfinMod/Settings/Retention")
    results = {}

    def timed(label, method, path, body=None):
        begin = time.time()
        status, result = call(method, path, body)
        results[label] = (status, round(time.time() - begin, 1), str(result)[:200] if status >= 300 or status == 0 else "")

    must("PATCH", "/JellyfinMod/Settings/Retention", {"enabled": True, "reclaimAfterDays": days, "watchedUserMode": "selectedUser",
         "selectedUserId": selected_user(), "exemptFavourites": True, "revision": retention["revision"]})
    seed = must("GET", "/JellyfinMod/Settings/SeedProtection")
    body = {"source": seed["source"], "password": {"action": "unchanged"}, "revision": seed["revision"]}
    if seed["source"] == "separate":
        body.update({"rpcUrl": seed["rpcUrl"], "username": seed.get("username") or ""})
    threads = [threading.Thread(target=timed, args=("preview 1", "GET", "/JellyfinMod/Retention/Preview")),
               threading.Thread(target=timed, args=("seed settings PATCH", "PATCH", "/JellyfinMod/Settings/SeedProtection", body)),
               threading.Thread(target=lambda: (time.sleep(2), timed("preview 2", "GET", "/JellyfinMod/Retention/Preview")))]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    for label, (status, seconds, detail) in sorted(results.items()):
        print(f"  {label}: {status} in {seconds} s {detail}")
    check(all(200 <= status < 300 for status, _, _ in results.values()),
          "switching retention on and at once previewing and saving settings answers every request (no database is locked)")
    time.sleep(20)


def remember_entries():
    known = json.load(open(ENTRIES)) if os.path.exists(ENTRIES) else []
    for name, tmdb in ((SHOW_LIBRARY, SERIES_TMDB), (MOVIE_LIBRARY, MOVIE_TMDB), (MOVIE_LIBRARY, BACKLOG_TMDB),
                       (MOVIE_LIBRARY, MERGE_TMDB), (MOVIE_LIBRARY_B, MERGE_TMDB)):
        _, found = entry(name, tmdb)
        if found and found["id"] not in known:
            known.append(found["id"])
    write_private(ENTRIES, json.dumps(known))


def cmd_state():
    remember_entries()
    series, detail = series_detail()
    print("series", series["id"], series["state"], "policy", series["retentionPolicy"])
    for e in detail["episodes"]:
        r = e.get("retention") or {}
        w = e.get("retentionWarning")
        print(f"  S{e['seasonNumber']:02}E{e['episodeNumber']:02} tmdb={e['tmdbId']} state={e['state']} monitored={e['monitored']} "
              f"policy={e.get('retentionPolicy')} {r.get('state')}/{r.get('reason')} deadline={r.get('deadline')} "
              f"versions={[(v['resolution'], v.get('kept')) for v in e.get('versions') or []]}"
              + (f" WARNING {w['deadline']} {w['cause']} {w['files']}" if w else ""))
    for h in detail["history"][:40]:
        print("  history", h["createdAt"][:19], h["eventType"], "|", h["summary"])
    _, movie = entry(MOVIE_LIBRARY, MOVIE_TMDB)
    if movie:
        md = must("GET", f"/JellyfinMod/Entries/{movie['id']}")
        print("movie", movie["id"], movie["state"], md["retention"]["state"], md["retention"]["reason"],
              "versions", len(md.get("versions") or []), "warning", md.get("retentionWarning"))


def preview_rows():
    preview = must("GET", "/JellyfinMod/Retention/Preview")
    ids = set()
    for name, tmdb in ((SHOW_LIBRARY, SERIES_TMDB), (MOVIE_LIBRARY, MOVIE_TMDB), (MOVIE_LIBRARY, BACKLOG_TMDB),
                       (MOVIE_LIBRARY, MERGE_TMDB), (MOVIE_LIBRARY_B, MERGE_TMDB)):
        _, e = entry(name, tmdb)
        if e:
            ids.add(e["id"])
    return preview, [r for r in preview["items"] if r["entryId"] in ids]


def cmd_preview():
    preview, rows = preview_rows()
    for r in sorted(rows, key=lambda row: row.get("path") or ""):
        print(" ", (r.get("path") or "").replace(CONTAINER_MEDIA, "<media>"), r["state"], r["reason"], r.get("deadline"),
              "links", r.get("hardlinkCount"))
    others = {}
    for r in preview["items"]:
        if r not in rows:
            others[f"{r['state']}/{r['reason']}"] = others.get(f"{r['state']}/{r['reason']}", 0) + 1
    print("non-fixture rows:", others)
    print("totals due", preview["due"], "blocked", preview["blocked"], "scheduled", preview["scheduled"])


def cmd_hashes(label):
    result = fixture_hashes()
    write_private(os.path.join(STATE, f"hashes-{label}.json"), json.dumps(result, indent=1))
    for key, value in result.items():
        print(f"  {key:14} {value[:16]}")


def cmd_compare(before, after):
    first = json.load(open(os.path.join(STATE, f"hashes-{before}.json")))
    second = json.load(open(os.path.join(STATE, f"hashes-{after}.json")))
    for key, (_, _, expected) in FIXTURE.items():
        if key in LATE and first[key] == "ABSENT":
            continue
        if expected == "reclaimed":
            check(second[key] == "ABSENT" and first[key] != "ABSENT", f"{key} was unlinked")
        else:
            check(second[key] == first[key] != "ABSENT", f"{key} is byte-identical")
    for key in ("seed-copy-E06", "sidecar"):
        check(second[key] == first[key] != "ABSENT", f"{key} is byte-identical")


REAL_WINDOW_RECLAIMED = ("E04", "E09-E10", "E10-B")  # due one day after the real-window watches and restarts


def cmd_compare_real(before, after):
    first = json.load(open(os.path.join(STATE, f"hashes-{before}.json")))
    second = json.load(open(os.path.join(STATE, f"hashes-{after}.json")))
    for key in first:
        if key in REAL_WINDOW_RECLAIMED:
            check(first[key] != "ABSENT" and second[key] == "ABSENT", f"{key} was unlinked after its real one-day window")
        else:
            check(second[key] == first[key], f"{key} is unchanged ({'absent' if first[key] == 'ABSENT' else 'byte-identical'})")


def cmd_phase_b():
    """The real window's positive half, a day later: switch retention on again (Q9: the countdowns kept running), run
    the native task, compare, check series Keep wins, then switch retention off, restore and remove every fixture."""
    cmd_login()
    try:
        announced, _ = started_events()
        cmd_configure(0, 1)
        # Right after a switch-on the plugin re-evaluates every target; a preview then may meet `database is locked`
        # (RET3-R1). `must` retries the GET; this retries the whole preview once more after a longer pause.
        if not attempt("preview after switch-on", cmd_preview, 3, 60):
            sys.exit("FAIL the preview never answered after the switch-on")
        check(started_events()[0] == announced, "switching retention back on announced no window again (RET2-R5)")
        cmd_hashes("phaseb-run-before")
        cmd_run()
        cmd_hashes("phaseb-run-after")
        cmd_compare_real("phaseb-before", "phaseb-run-after")
        cmd_reconcile()
        _, detail = series_detail()
        check(not [h for h in detail["history"] if h["eventType"] in ("media_missing", "episode_media_missing")],
              "no missing-media event after the real-window reclaim")
        cmd_series_keep()
    finally:
        # One pass here; the cron wrapper then runs `safe-finish`, which retries and verifies, whatever happened here.
        try:
            attempt("restore", cmd_restore, 2, 20)
        finally:
            try:
                attempt("cleanup", cmd_cleanup, 1, 0)
            finally:
                cmd_logout()


def cmd_run():
    print("task", run_task("JellyfinModRetentionReclamation"))
    print("latest run", json.dumps(must("GET", "/JellyfinMod/Retention/Runs/Latest")))


def cmd_ordinary():
    """Decision 7: a disposable non-admin user, whose password exists only in this process."""
    name = "jfmod-e2e-" + secrets.token_hex(4)
    password = secrets.token_urlsafe(24)
    created = must("POST", "/Users/New", {"Name": name, "Password": password})
    user_id = created["Id"]
    print("created disposable ordinary user", name)
    try:
        status, auth = call("POST", "/Users/AuthenticateByName", {"Username": name, "Pw": password}, anonymous=True)
        check(status == 200 and not auth["User"]["Policy"]["IsAdministrator"], "the disposable user signs in and is not an administrator")
        token = auth["AccessToken"]
        series, detail = series_detail()
        e03 = tracked_episode(detail, 3)
        binding = (tracked_episode(detail, 1).get("versions") or [{}])[0].get("bindingId") or "00000000-0000-0000-0000-000000000000"
        base = f"/JellyfinMod/Entries/{series['id']}"
        for method, path, body in (("POST", f"{base}/Episodes/{e03['id']}/Keep", None),
                                   ("DELETE", f"{base}/Episodes/{e03['id']}/Keep", None),
                                   ("PUT", f"{base}/Episodes/{e03['id']}/Retention", {"policy": "days", "reclaimAfterDays": 3}),
                                   ("POST", f"{base}/Versions/{binding}/Keep", None),
                                   ("DELETE", f"{base}/Versions/{binding}/Keep", None),
                                   ("POST", f"{base}/Keep", None),
                                   ("DELETE", base, None),
                                   ("PATCH", "/JellyfinMod/Settings/Retention", {"enabled": False, "revision": 0})):
            status, _ = call(method, path, body, token)
            check(status == 403, f"ordinary user {method} {path.replace(series['id'], '<series>')} -> {status}")
        seen = must("GET", base, token=token)
        warnings = [e["retentionWarning"] for e in seen["episodes"] if e.get("retentionWarning")]
        print("warnings the ordinary user sees:", [(w["deadline"], w["cause"], w.get("overdue")) for w in warnings])
        check(bool(warnings) and all(not w["files"] for w in warnings),
              "an ordinary user sees each warning's date and cause but no file names (RET2-R10)")
        # RET-R2: an ordinary user's Add of the existing series adopts and monitors nothing it holds by position.
        lib = library(SHOW_LIBRARY)
        status, added = call("POST", "/JellyfinMod/Entries", {"mediaType": "series", "tmdbId": SERIES_TMDB,
                                                              "targetLibraryId": lib["ItemId"]}, token)
        print("ordinary Add ->", status)
        _, after = series_detail()
        tracked = [e for e in after["episodes"] if e.get("versions")]
        check(all(e["tmdbId"] == 0 and not e["monitored"] for e in tracked),
              "after an ordinary Add every on-disk episode keeps TMDB id 0 and stays unmonitored")
        positions = [(e["seasonNumber"], e["episodeNumber"]) for e in after["episodes"]]
        check(len(positions) == len(set(positions)), "no second row was created at a position a position row holds")
    finally:
        must("DELETE", f"/Users/{user_id}")
        status, _ = call("GET", f"/Users/{user_id}")
        gone = status == 404 and all(u["Name"] != name for u in must("GET", "/Users"))
        check(gone, "the disposable user is deleted and gone")


def cmd_refresh():
    series, _ = series_detail()
    status, _ = call("POST", f"/JellyfinMod/Entries/{series['id']}/Refresh")
    print("admin Refresh ->", status)
    _, detail = series_detail()
    adopted = [h for h in detail["history"] if h["eventType"] == "episode_adopted"]
    for h in adopted:
        print("  ", h["summary"])
    e01, e03 = tracked_episode(detail, 1), tracked_episode(detail, 3)
    check(e01["tmdbId"] > 0 and any("S01E01" in h["summary"] for h in adopted),
          "Refresh adopted E01, whose title matches TMDB's, and recorded it")
    check(e03["tmdbId"] == 0, "Refresh left E03, with no matching title or date, tracked by position")
    check(not e01["monitored"], "the adopted row stays unmonitored")


def await_episode(number, condition, timeout=420):
    """The plugin reads user data through a queue that a busy host can take minutes to drain; poll rather than sleep."""
    begin = time.time()
    while True:
        _, detail = series_detail()
        episode = tracked_episode(detail, number)
        if condition(episode) or time.time() - begin > timeout:
            return detail, episode
        time.sleep(10)


def cmd_real():
    user = selected_user()
    series, detail = series_detail()
    base = f"/JellyfinMod/Entries/{series['id']}"
    e03 = tracked_episode(detail, 3)
    mark_played("E03", user)
    detail, e03 = await_episode(3, lambda e: e["retention"]["state"] == "scheduled" and e.get("retentionWarning"))
    deadline = e03["retention"].get("deadline")
    print("E03 scheduled", e03["retention"]["state"], deadline, "warning", e03.get("retentionWarning"))
    check(e03["retention"]["state"] == "scheduled" and e03.get("retentionWarning"), "E03 is scheduled with a warning")
    # A window started by a sync client (Trakt-style user data) names that cause in the warning and History (Q8).
    sync_watch("E10-B", user)
    detail, e10 = await_episode(10, lambda e: bool(e.get("retentionWarning")))
    print("E10 synced ->", e10["retention"]["state"], e10.get("retentionWarning"))
    check((e10.get("retentionWarning") or {}).get("cause") == "watched on another device (synced)",
          "a synced watch starts a window whose warning names the sync as the cause")
    changed = must("PUT", f"{base}/Episodes/{e03['id']}/Retention", {"policy": "days", "reclaimAfterDays": 2})
    print("E03 window 2 days ->", changed["retention"])
    e04 = tracked_episode(detail, 4)
    unkept = must("DELETE", f"{base}/Episodes/{e04['id']}/Keep")
    print("E04 un-kept ->", unkept["retentionPolicy"], unkept["retention"])
    cmd_hashes("real-before")
    cmd_run()
    cmd_hashes("real-after")
    first = json.load(open(os.path.join(STATE, "hashes-real-before.json")))
    second = json.load(open(os.path.join(STATE, "hashes-real-after.json")))
    check(first == second, "an immediate run with one- and two-day windows reclaims nothing")


def cmd_series_keep():
    series, detail = series_detail()
    base = f"/JellyfinMod/Entries/{series['id']}"
    e03 = tracked_episode(detail, 3)
    must("POST", f"{base}/Keep")
    _, detail = series_detail()
    e03 = tracked_episode(detail, 3)
    check(e03["retention"]["reason"] == "kept" and e03["retentionPolicy"] == "days",
          "series Keep wins over the episode's own two-day window (Q2)")


def cmd_restore():
    if os.environ.get("JFMOD_INJECT_RESTORE_FAILURE") == "1":  # rehearsal of the RET3-R1 failure path only
        sys.exit("INJECTED restore failure (JFMOD_INJECT_RESTORE_FAILURE=1)")
    retention = must("GET", "/JellyfinMod/Settings/Retention")
    if not os.path.exists(RESTORE):
        # Nothing saved to restore: still switch retention off, keeping every other setting as it is.
        body = {k: retention[k] for k in ("reclaimAfterDays", "watchedUserMode", "exemptFavourites", "selectedUserId")
                if retention.get(k) is not None}
        must("PATCH", "/JellyfinMod/Settings/Retention", dict(body, enabled=False, revision=retention["revision"]))
        check(must("GET", "/JellyfinMod/Settings/Retention")["enabled"] is False, "retention is disabled (no saved settings)")
        return
    saved = json.load(open(RESTORE))
    r = saved["retention"]
    body = {"enabled": False, "reclaimAfterDays": r["reclaimAfterDays"], "watchedUserMode": r["watchedUserMode"],
            "exemptFavourites": r["exemptFavourites"], "revision": retention["revision"]}
    if r.get("selectedUserId"):
        body["selectedUserId"] = r["selectedUserId"]
    must("PATCH", "/JellyfinMod/Settings/Retention", body)
    config = must("GET", f"/Plugins/{PLUGIN}/Configuration")
    config["RetentionTestWindowMinutes"] = saved["testWindowMinutes"]
    must("POST", f"/Plugins/{PLUGIN}/Configuration", config)
    s = saved["seed"]
    seed = must("GET", "/JellyfinMod/Settings/SeedProtection")
    patch = {"source": s["source"], "password": {"action": "unchanged"}, "revision": seed["revision"]}
    if s["source"] == "separate":
        patch.update({"rpcUrl": s["rpcUrl"], "username": s.get("username") or ""})
    must("PATCH", "/JellyfinMod/Settings/SeedProtection", patch)
    now = must("GET", "/JellyfinMod/Settings/Retention")
    print("restored: retention enabled", now["enabled"], "seed", must("GET", "/JellyfinMod/Settings/SeedProtection")["source"])
    check(now["enabled"] is False, "retention is disabled")


def cmd_cleanup():
    """Removes every fixture. The order matters: the plugin confirms a file's absence only in a library that still exists,
    so the files go first, the libraries are scanned and reconciled empty (which unbinds the entries), and only then are
    the libraries deleted and the entries removed. A library deleted earlier is recreated empty under its old name, which
    Jellyfin maps to the same library id, so a cleanup that was interrupted can always be finished."""
    import shutil
    roots = [os.path.join(HOST_MEDIA, ROOTS["A"]), os.path.join(HOST_MEDIA, ROOTS["B"]), os.path.join(HOST_MEDIA, MOVIE_ROOT),
             os.path.join(HOST_MEDIA, MOVIE_ROOT_B)]
    for directory in roots:
        if os.path.isdir(directory):
            shutil.rmtree(directory)
        os.makedirs(directory)
    if os.path.isdir(os.path.join(HOST_MEDIA, SEED_DIR)):
        shutil.rmtree(os.path.join(HOST_MEDIA, SEED_DIR))
    known = json.load(open(ENTRIES)) if os.path.exists(ENTRIES) else []
    # The plugin never confirms absence under an empty directory (it may be an unmounted mount point), so the extra root
    # keeps a marker until the scan has run.
    for extra in EXTRA_ROOTS:
        subprocess.run(["docker", "exec", CONTAINER, "sh", "-c", f"mkdir -p '{extra}' && touch '{extra}/.jfmod-present'"],
                       check=False)
    if known or any(library(name) is not None for name in (SHOW_LIBRARY, MOVIE_LIBRARY, MOVIE_LIBRARY_B)):
        cmd_library()
        # Absence is confirmed by the plugin's post-scan task, which only a full library scan runs; an item refresh does not.
        print("library scan", run_task("RefreshLibrary", timeout=1800))
        cmd_reconcile()
    for name in (SHOW_LIBRARY, MOVIE_LIBRARY, MOVIE_LIBRARY_B):
        if library(name) is not None:
            must("DELETE", "/Library/VirtualFolders?" + urllib.parse.urlencode({"name": name, "refreshLibrary": "true"}))
    wait_scan()
    for directory in roots:
        if os.path.isdir(directory):
            shutil.rmtree(directory)
    for extra in EXTRA_ROOTS:
        subprocess.run(["docker", "exec", CONTAINER, "rm", "-rf", extra], check=False)
    known = json.load(open(ENTRIES)) if os.path.exists(ENTRIES) else []
    remember_ever(known)
    left = [e["id"] for e in must("GET", "/JellyfinMod/Entries?limit=200&query=" + urllib.parse.quote(PREFIX))["items"]]
    for entry_id in dict.fromkeys(known + left):
        status, _ = call("DELETE", f"/JellyfinMod/Entries/{entry_id}")
        print("remove entry", entry_id, status)
    for entry_id in known:
        status, _ = call("GET", f"/JellyfinMod/Entries/{entry_id}")
        check(status == 404, f"fixture entry {entry_id} is gone")
    write_private(ENTRIES, json.dumps([]))
    remaining = must("GET", "/Items?Recursive=true&SearchTerm=" + urllib.parse.quote(PREFIX) + "&IncludeItemTypes=Movie,Series,Episode")["TotalRecordCount"]
    entries = must("GET", "/JellyfinMod/Entries?limit=200&query=" + urllib.parse.quote(PREFIX))["totalRecordCount"]
    files = [d for d in (ROOTS["A"], ROOTS["B"], MOVIE_ROOT, MOVIE_ROOT_B, SEED_DIR) if os.path.exists(os.path.join(HOST_MEDIA, d))]
    check(remaining == 0 and entries == 0 and not files, f"no {PREFIX} fixture left: items {remaining}, entries {entries}, dirs {files}")


EVER = os.path.join(STATE, "entries-ever.json")  # every fixture entry id ever remembered; cleanup empties ENTRIES


def remember_ever(ids):
    ever = json.load(open(EVER)) if os.path.exists(EVER) else []
    write_private(EVER, json.dumps(list(dict.fromkeys(ever + list(ids)))))


def verify_safe():
    """What `safe-finish` must prove from the instance itself before the job may call itself done."""
    retention = must("GET", "/JellyfinMod/Settings/Retention")
    check(retention["enabled"] is False, "retention is disabled")
    if os.path.exists(RESTORE):
        saved = json.load(open(RESTORE))
        window = must("GET", f"/Plugins/{PLUGIN}/Configuration").get("RetentionTestWindowMinutes", 0)
        check(window == saved["testWindowMinutes"], f"the test window is back to {saved['testWindowMinutes']} (now {window})")
        seed = must("GET", "/JellyfinMod/Settings/SeedProtection")
        check(seed["source"] == saved["seed"]["source"], f"the seed source is back to {saved['seed']['source']}")
    ever = json.load(open(EVER)) if os.path.exists(EVER) else []
    for entry_id in ever:
        status, _ = call("GET", f"/JellyfinMod/Entries/{entry_id}")
        check(status == 404, f"fixture entry {entry_id} is gone")
    entries = must("GET", "/JellyfinMod/Entries?limit=200&query=" + urllib.parse.quote(PREFIX))["totalRecordCount"]
    items = must("GET", "/Items?Recursive=true&SearchTerm=" + urllib.parse.quote(PREFIX) + "&IncludeItemTypes=Movie,Series,Episode")["TotalRecordCount"]
    libraries = [f["Name"] for f in must("GET", "/Library/VirtualFolders")
                 if f["Name"] in (SHOW_LIBRARY, MOVIE_LIBRARY, MOVIE_LIBRARY_B)]
    dirs = [d for d in (ROOTS["A"], ROOTS["B"], MOVIE_ROOT, MOVIE_ROOT_B, SEED_DIR) if os.path.exists(os.path.join(HOST_MEDIA, d))]
    check(entries == 0 and items == 0 and not libraries and not dirs,
          f"no {PREFIX} fixture left: entries {entries}, items {items}, libraries {libraries}, dirs {dirs}")


def cmd_safe_finish():
    """RET3-R1: restore and clean up, each retried, then verify; writes safe.OK only when the instance is proven safe.
    Idempotent: after a successful run it only re-verifies."""
    marker = os.path.join(STATE, "safe.OK")
    if os.path.exists(marker):
        os.remove(marker)
    if os.path.exists(ENTRIES):
        remember_ever(json.load(open(ENTRIES)))
    signed_in = attempt("login", cmd_login, 5, 30)
    restored = signed_in and attempt("restore", cmd_restore, 6, 30)
    cleaned = signed_in and attempt("cleanup", cmd_cleanup, 3, 60)
    # Retention off comes first: even when the cleanup cannot finish, a restore that worked has made the instance safe
    # to leave, and the next tick finishes the rest.
    verified = signed_in and attempt("verify", verify_safe, 3, 30)
    try:
        cmd_logout()
    except Exception as error:  # noqa: BLE001
        print("logout failed:", type(error).__name__)
    if not (restored and cleaned and verified):
        print(f"!!! SAFE-FINISH FAILED: signed in {signed_in}, restored {restored}, cleaned {cleaned}, verified {verified}",
              flush=True)
        sys.exit(2)
    write_private(marker, time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    print("SAFE: retention off, settings restored, no fixture left", flush=True)


def cmd_seed_server():
    from http.server import BaseHTTPRequestHandler, HTTPServer
    directory = f"{CONTAINER_MEDIA}/{SEED_DIR}"
    name = FIXTURE["E06"][1]
    size = os.path.getsize(os.path.join(host_dir("S"), name))
    session = {"version": "4.0.6 (fake)", "seedRatioLimited": False, "seedRatioLimit": 2.0, "idle-seeding-limit-enabled": False,
               "idle-seeding-limit": 30, "incomplete-dir": "/downloads/incomplete", "incomplete-dir-enabled": False,
               "rename-partial-files": True}
    torrent = {"id": 1, "hashString": "10" * 20, "downloadDir": directory,
               "files": [{"name": name, "length": size, "bytesCompleted": size}],
               "fileStats": [{"wanted": True, "bytesCompleted": size, "priority": 0}], "leftUntilDone": 0, "percentDone": 1.0,
               "status": 6, "uploadRatio": 0.2, "secondsSeeding": 3600, "seedRatioMode": 1, "seedRatioLimit": 2.0,
               "seedIdleMode": 0, "seedIdleLimit": 30, "etaIdle": -1, "isFinished": False}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            if self.headers.get("Transfer-Encoding", "").lower() == "chunked":
                raw = b""
                while True:
                    length = int(self.rfile.readline().split(b";")[0], 16)
                    if length == 0:
                        self.rfile.readline()
                        break
                    raw += self.rfile.read(length)
                    self.rfile.readline()
            else:
                raw = self.rfile.read(int(self.headers.get("Content-Length", 0)))
            request = json.loads(raw or b"{}")
            method = request.get("method")
            arguments = {"torrents": [torrent]} if method == "torrent-get" else dict(session) if method == "session-get" else {}
            body = json.dumps({"result": "success" if method in ("torrent-get", "session-get") else "method not allowed",
                               "arguments": arguments, "tag": request.get("tag")}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("X-Transmission-Session-Id", "jfmod-e2e")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    HTTPServer(("0.0.0.0", int(os.environ.get("JFMOD_SEED_PORT", "19091"))), Handler).serve_forever()


# ---- Second delete-path review (RET2): the acceptance checks of REVIEW-2026-09-24-retention-2.md ----

def rescan(expect_path=None):
    refresh_library(SHOW_LIBRARY, (lambda paths: expect_path in paths) if expect_path else None)
    cmd_reconcile()
    time.sleep(5)


def parse_time(value):
    """A UTC instant from the API, to the second."""
    from datetime import datetime, timezone
    return datetime.fromisoformat(value[:19]).replace(tzinfo=timezone.utc)


def now_utc():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc)


def window_minutes():
    return must("GET", f"/Plugins/{PLUGIN}/Configuration").get("RetentionTestWindowMinutes", 0)


def cmd_reacquire():
    """RET2-R1: E01's watched copy A was reclaimed while its kept copy B stayed; A comes back at its path. Jellyfin gives
    it its old item id and play state, yet the episode must start over: waiting, no inherited completion or deadline."""
    check(sha(host_path("E01-A")) == "ABSENT", "E01-A was reclaimed by the fast run")
    make_video(host_path("E01-A"), 0, "E01-A")
    rescan(container_path("E01-A"))
    item = native_item("E01-A")
    data = must("GET", f"/UserItems/{item['Id']}/UserData?userId={selected_user()}")
    print("E01-A is back as", item["Id"], "played", data.get("Played"), "last played", data.get("LastPlayedDate"))
    _, detail = series_detail()
    e01 = tracked_episode(detail, 1)
    r = e01["retention"]
    print("E01 ->", r, "warning", e01.get("retentionWarning"))
    check(r["state"] == "waiting" and r["reason"] == "representation_reset" and not r.get("deadline") and
          not e01.get("retentionWarning"), "the re-acquired copy starts over: waiting, no deadline, no warning (RET2-R1)")
    resets = [h for h in detail["history"] if h["eventType"] == "retention_reset" and "new file arrived" in h["summary"]]
    for h in resets:
        print("  history", h["createdAt"][:19], h["summary"])
    check(any("S01E01" in h["summary"] for h in resets), "History says why: a new file arrived (RET2-R1)")
    _, rows = preview_rows()
    row = next(r for r in rows if (r.get("path") or "").endswith(f"/{ROOTS['A']}/{SERIES_DIR}/Season 01/{FIXTURE['E01-A'][1]}"))
    check(row["state"] == "waiting", f"the preview does not list E01-A as due ({row['state']}/{row['reason']})")
    cmd_hashes("reacquired")


def cmd_unkeep_survivor():
    """RET2-R2: E14's copy A went at its deadline while copy B was kept; stopping B's Keep gives B a window of its own."""
    series, detail = series_detail()
    e14 = tracked_episode(detail, 14)
    versions = e14.get("versions") or []
    check(len(versions) == 1 and versions[0].get("kept"), "only E14's kept copy B is left")
    print("E14 before ->", e14["retention"])
    started = now_utc()
    must("DELETE", f"/JellyfinMod/Entries/{series['id']}/Versions/{versions[0]['bindingId']}/Keep")
    time.sleep(3)
    _, detail = series_detail()
    e14 = tracked_episode(detail, 14)
    r, w = e14["retention"], e14.get("retentionWarning")
    print("E14 after ->", r, "warning", w)
    minutes = window_minutes()
    deadline = parse_time(r["deadline"]) if r.get("deadline") else None
    check(r["state"] == "scheduled" and deadline is not None and (deadline - started).total_seconds() >= minutes * 60 - 5,
          "stopping the Keep restarts the window from now, one window out (RET2-R2)")
    check(bool(w) and not w.get("overdue") and parse_time(w["deadline"]) > now_utc(),
          "the warning shows a future date, not an overdue one (RET2-R2)")
    write_private(os.path.join(STATE, "e14-deadline.txt"), r["deadline"])
    before = sha(host_path("E14-B"))
    cmd_run()
    check(sha(host_path("E14-B")) == before != "ABSENT", "an immediate run reclaims nothing: E14-B is byte-identical")


def cmd_unkeep_finish():
    """RET2-R2, second half: once B's own window has passed it is reclaimed."""
    deadline = parse_time(open(os.path.join(STATE, "e14-deadline.txt")).read().strip())
    wait = (deadline - now_utc()).total_seconds() + 10
    if wait > 0:
        print("waiting", int(wait), "s for E14-B's window")
        time.sleep(wait)
    cmd_run()
    check(sha(host_path("E14-B")) == "ABSENT", "after its own window E14-B is reclaimed (RET2-R2)")


def started_events():
    _, detail = series_detail()
    counts = {}
    for h in detail["history"]:
        if h["eventType"] == "retention_started":
            counts[h.get("episodeId")] = counts.get(h.get("episodeId"), 0) + 1
    return counts, detail


def cmd_toggle():
    """RET2-R5: switching retention off and on twice announces no window again; a passed date reads as overdue."""
    before, detail = started_events()
    for _ in range(2):
        retention = must("GET", "/JellyfinMod/Settings/Retention")
        body = {k: retention[k] for k in ("reclaimAfterDays", "watchedUserMode", "exemptFavourites") if k in retention}
        if retention.get("selectedUserId"):
            body["selectedUserId"] = retention["selectedUserId"]
        must("PATCH", "/JellyfinMod/Settings/Retention", dict(body, enabled=False, revision=retention["revision"]))
        time.sleep(10)
        retention = must("GET", "/JellyfinMod/Settings/Retention")
        must("PATCH", "/JellyfinMod/Settings/Retention", dict(body, enabled=True, revision=retention["revision"]))
        time.sleep(25)
        must("GET", "/JellyfinMod/Retention/Preview")
    after, detail = started_events()
    print("retention_started per episode before", sum(before.values()), "after", sum(after.values()))
    check(after == before, "switching retention off and on twice adds no retention_started event (RET2-R5)")
    overdue = [(e["episodeNumber"], e["retentionWarning"]) for e in detail["episodes"]
               if (e.get("retentionWarning") or {}).get("overdue")]
    print("overdue warnings:", overdue)
    check(any(number == 6 for number, _ in overdue), "E06, past its date and held by seeding, reads as overdue (RET2-R5)")


def cmd_covered():
    """RET2-R7: the episode a position-tracked double file covers has a row of its own."""
    _, detail = series_detail()
    e07, e08 = tracked_episode(detail, 7), tracked_episode(detail, 8)
    print("E07", e07["tmdbId"], e07["state"], len(e07.get("versions") or []), "E08", e08["tmdbId"], e08["state"],
          e08["monitored"], len(e08.get("versions") or []))
    check(e08["tmdbId"] == 0 and e08["state"] == "onDisk" and not e08["monitored"] and not e08.get("versions") and
          len(e07.get("versions") or []) == 1, "S01E08, covered by S01E07-E08, is tracked without a file of its own (RET2-R7)")


def db_rows(sql):
    """Reads the plugin database from a private online backup copy (never the live file)."""
    source = os.environ["JFMOD_DB"]
    copy = os.path.join(STATE, "db-read.db")
    subprocess.run(["sqlite3", source, f".backup '{copy}'"], check=True)
    rows = subprocess.run(["sqlite3", "-separator", "|", copy, sql], check=True, capture_output=True, text=True).stdout
    os.remove(copy)
    return [line.split("|") for line in rows.strip().splitlines() if line]


def cmd_late():
    """RET2-R3: a file arrives at a number for which a TMDB row exists without a file. E16 arrives first, while no row holds
    its number, and gets a position row of its own. Then an admin Refresh lists TMDB's episodes, creating a monitored
    file-less TMDB row at 17 (an ordinary user's Add of a title they can already see changes nothing), and E17 arrives: it
    binds to that TMDB row by its number only, so it is unverified and no upgrade can replace it."""
    make_video(host_path("E16"), 16, "E16")
    rescan(container_path("E16"))
    _, detail = series_detail()
    e16 = tracked_episode(detail, 16)
    check(e16["tmdbId"] == 0 and len(e16.get("versions") or []) == 1, "a file at a number no row holds gets a position row")
    cmd_refresh()
    _, detail = series_detail()
    e17 = tracked_episode(detail, 17)
    print("E17 before its file:", e17["tmdbId"], e17["state"], "monitored", e17["monitored"])
    check(e17["tmdbId"] > 0 and not e17.get("versions"), "the Refresh created a file-less TMDB row at 17")
    make_video(host_path("E17"), 17, "E17")
    rescan(container_path("E17"))
    _, detail = series_detail()
    e17 = tracked_episode(detail, 17)
    print("E17", e17["tmdbId"], e17["state"], "monitored", e17["monitored"], "versions", len(e17.get("versions") or []))
    check(e17["tmdbId"] > 0 and len(e17.get("versions") or []) == 1, "the late file binds to the TMDB row by its number")
    flags = db_rows("SELECT e.SeasonNumber, e.EpisodeNumber, e.TmdbId, b.IdentityUnverified FROM EpisodeBindings b JOIN "
                    "Episodes e ON e.Id = b.EpisodeId JOIN Entries n ON n.Id = e.EntryId WHERE n.TmdbId = 1418 ORDER BY 1, 2")
    for row in flags:
        print("  binding S%sE%s tmdb=%s unverified=%s" % tuple(row))
    check(any(r[1] == "17" and r[3] == "1" for r in flags), "the file bound by number only is unverified (RET2-R3)")
    check(all(r[3] == "0" for r in flags if r[2] == "0"), "files of position rows are not flagged")
    # Each file is verified by its own evidence: E01's copy whose title matches TMDB's is verified; a copy without that
    # evidence stays unverified, which only ever stops a replacement.
    e01 = [r for r in flags if r[1] == "1"]
    check(e01 and all(r[2] != "0" for r in e01) and any(r[3] == "0" for r in e01),
          "E01, adopted by the Refresh on its matching title, has its matching file verified")


def cmd_covered_refresh():
    """RET3-R5: after an admin Refresh no monitored row without a file of its own sits at a number a bound file covers:
    S01E12 (hidden by Jellyfin 12 as a version of E11), S01E08 and S01E10 (second numbers of double files)."""
    series, _ = series_detail()
    status, _ = call("POST", f"/JellyfinMod/Entries/{series['id']}/Refresh")
    print("admin Refresh ->", status)
    _, detail = series_detail()
    covered = {8, 10, 12}
    rows = [e for e in detail["episodes"] if e["seasonNumber"] == 1 and e["episodeNumber"] in covered]
    for e in rows:
        print(f"  S01E{e['episodeNumber']:02} tmdb={e['tmdbId']} monitored={e['monitored']} versions={len(e.get('versions') or [])}")
    check(rows and all(not e["monitored"] for e in rows if not e.get("versions")),
          "no monitored row without a file of its own at a number a bound file covers (RET3-R5)")
    unmonitored = [h for h in detail["history"] if h["eventType"] == "episode_unmonitored"]
    for h in unmonitored:
        print("  history", h["createdAt"][:19], h["summary"])


def cmd_double():
    """RET2-R7 for the web: a double file that arrives later gives the number it covers a row of its own, and the file's
    page must open the row that holds it (checked by the browser probe with the ids printed here)."""
    make_video(host_path("E18-E19"), 18, "E18-E19")
    rescan(container_path("E18-E19"))
    _, detail = series_detail()
    e18, e19 = tracked_episode(detail, 18), tracked_episode(detail, 19)
    item = native_item("E18-E19")
    print("E18-E19 item", item["Id"], "E18 row", e18["id"], "E19 row", e19["id"], "E19 points at", e19.get("jellyfinItemId"))
    check(len(e18.get("versions") or []) == 1 and not e19.get("versions") and e19["tmdbId"] == 0 and not e19["monitored"],
          "S01E19, covered by a late S01E18-E19, is tracked without a file of its own (RET2-R7)")
    write_private(os.path.join(STATE, "double.json"), json.dumps({"item": item["Id"], "row": e18["id"], "covered": e19["id"]}))

if __name__ == "__main__":
    os.makedirs(STATE, mode=0o700, exist_ok=True)
    args = sys.argv[1:] or ["help"]
    commands = {
        "login": cmd_login, "logout": cmd_logout, "save": cmd_save, "media": cmd_media, "library": cmd_library,
        "reconcile": cmd_reconcile, "backlog": cmd_backlog, "act": cmd_act, "state": cmd_state, "preview": cmd_preview,
        "run": cmd_run, "ordinary": cmd_ordinary, "refresh": cmd_refresh, "real": cmd_real, "series-keep": cmd_series_keep,
        "restore": cmd_restore, "cleanup": cmd_cleanup, "seed-server": cmd_seed_server,
        "reacquire": cmd_reacquire, "unkeep-survivor": cmd_unkeep_survivor, "unkeep-finish": cmd_unkeep_finish,
        "toggle": cmd_toggle, "covered": cmd_covered, "late": cmd_late, "double": cmd_double,
        "safe-finish": cmd_safe_finish, "verify-safe": verify_safe, "merge": cmd_merge, "movie-check": cmd_movie_check,
        "movie-finish": cmd_movie_finish, "ret3": cmd_ret3, "ret3-fast": cmd_ret3_fast, "merge-recheck": cmd_merge_recheck, "probe-ids": cmd_probe_ids, "replace": cmd_replace, "covered-refresh": lambda: cmd_covered_refresh(),
    }
    if args[0] == "configure":
        cmd_configure(int(args[1]), int(args[2]))
    elif args[0] == "lockcheck":
        cmd_lockcheck(int(args[1]), int(args[2]))
    elif args[0] == "hashes":
        cmd_hashes(args[1] if len(args) > 1 else "now")
    elif args[0] == "compare-real":
        cmd_compare_real(args[1], args[2])
    elif args[0] == "phase-b":
        cmd_phase_b()
    elif args[0] == "compare":
        cmd_compare(args[1], args[2])
    elif args[0] in commands:
        commands[args[0]]()
    else:
        sys.exit(__doc__)
